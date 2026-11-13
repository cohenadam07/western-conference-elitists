// api/_hoops.js — Flappy Hoops accounts and all-time records, behind the race endpoint (api/race.js
// routes POST actions `acct.*` and `rec.*`, and GET ?rec=, here). Not a function itself: Vercel skips
// api files that start with an underscore, and Hobby's twelve-function cap is nearly full.
//
// ACCOUNTS: a name and a four-digit PIN. Signing in on any device (the iPhone home-screen app keeps its
// own storage) brings your progress with you: bests, flags (what you've finished and found), tickets,
// balls and trails. The game keeps working on its own copy and syncs: the server merges (better best,
// union of what's owned and found, tickets by what each device earned or spent since it last synced).
//
//   fha:n:<nameKey>       → user id (the name lowercased, without spaces . _ -)
//   fha:u:<id>            hash: name, salt, ph (scrypt of the PIN), at
//   fha:t:<sha256(token)> → "<id>|<name>", 400 days, renewed on every use (GETEX)
//   fha:tk:<id>           set of that user's token hashes (so a PIN reset or a deletion signs them out)
//   fha:s:<id>, fha:sv:<id>   the save (JSON) and its version; writes are compare-and-set on the version
//   fha:bad:<id>          wrong PINs in the last 15 minutes (5 locks the name for the rest of them)
//   fha:ip:<ip>           sign-ups and sign-ins from that address in the last 10 minutes (20 at most)
//
// RECORDS: two boards on every hole. f, Fewest Flaps (level on flaps: faster wins); s, Fastest (level
// on time: fewer flaps wins). Level on both and the holder keeps it: you have to beat a record to take
// it. Flaps and time come from the server's own replay of the run's taps with the game's rules
// (public/flappy-hoops/server/sim.mjs, written by the game's build next to the game), never from the
// game's say-so. Race runs replay with the ghost-hole doors shut, as they were in the race.
// KNOCKOUT RECORDS (2.12), kept apart from all of the above (they never touch fhrec, the bests or par tickets):
//   fhko         hash  <hole> → "<steps>|<flaps>|<entry JSON>": Fastest in Knockout (level on time, fewer flaps wins;
//                      level on both, the holder keeps it); entry { n, u, k, f, at }
//   fhko:log:<hole>, fhko:c   every holder (oldest first, 500 kept), and "<breaks>|<hands>", as for the normal boards
//   fhko:run     hash  <hole> → the run that set it: { seed, inputs } (every player's: the hole, played again)
//   fhkom        hash  <world> → "<kos>|<entry JSON>": Most KOs in a match (level, the holder keeps it); entry { n, u, ko, at }
//   fhkom:log:<world>, fhkom:c
// Nothing goes up from what a game says: the race server replays the hole (or the match's every hole) itself with the
// game's own rules (server/sim.mjs, koReplay) and these take its numbers (api/_race.js koVerify).
// Knockout runs (2.11) never count: balls hit each other there, so a run isn't one ball's taps any more.
// rec.submit refuses one whatever the game says: a run marked Knockout (mode/ko), a run from a party
// whose race is Knockout (pc: the party's code), and any run with an item in it (U) all come back 403.
//
//   fhrec        hash  <hole>|<b> → "<flaps>|<steps>|<entry JSON>" (the prefix lets Lua compare
//                      without cjson); entry { n, u, f, k, at, r? }
//   fhrec:in     hash  <hole>|<b> → that run's taps, [[step, dir], ...]
//   fhrec:h:<hole>|<b>  list: earlier holders, newest first ("<stored value>\n<taps>"), 25 kept, so a
//                      record taken down by the admin key hands the board back to the one before it
//   fhrec:log:<hole>|<b>  list: every holder the board has had, oldest first (the stored values, 500 kept),
//                      for the record's history (GET ?rec=history)
//   fhrec:c      hash  <hole>|<b> → "<breaks>|<hands>": how many times it's been broken (the first
//                      make doesn't count) and how many of those went to someone else (changed hands)
//
// Redis per call: GET ?rec=all 2 · GET ?rec=history 1 · GET ?rec=watch 1 · rec.submit 2 · acct.sync 3 · acct.signin 4 ·
// acct.create 2 · acct.me 1 · acct.signout 1.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { makeLimiter } from './_limit.js'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra } }
const bad = (status, msg, extra) => { throw new HttpError(status, msg, extra) }

/* ------------------------------------------------------------ the rules */

export const MAX_STEPS = 36000          // five minutes of play (120 steps a second)
export const MAX_INPUTS = 4000
export const MAX_BODY = 900 * 1024
const TOKEN_TTL = 400 * 86400
const LOCK_AFTER = 5, LOCK_S = 900
const IP_MAX = 20, IP_S = 600
const HIST = 25
const LOG = 500
const SUBMITS_A_MINUTE = 30

const HOLE_RE = /^[a-z0-9.-]{1,40}$/
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/
const ITEM_RE = /^[A-Za-z0-9._-]{1,40}$/

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
const isBadName = (name) => {
  try { const s = String(name); return matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, '')) } catch { return false }
}

// A name as it's shown, or an error saying which rule it broke.
export function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 3 || name.length > 12) return { error: 'A name is 3 to 12 characters.' }
  if (!/^[A-Za-z0-9 ._-]+$/.test(name)) return { error: 'A name can use letters, numbers, spaces, dots, dashes and underscores.' }
  if (!/[A-Za-z0-9]/.test(name)) return { error: 'A name needs a letter or a number.' }
  if (isBadName(name)) return { error: 'Pick a different name.' }
  return { name }
}
export const nameKey = (name) => String(name).toLowerCase().replace(/[\s._-]/g, '')
export const validPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin)

function scrypt(pin, salt) {
  return new Promise((ok, no) => scryptCb(pin, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k))))
}
const sha = (s) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(24).toString('base64url')
const newId = () => { const b = randomBytes(10); let s = ''; for (const x of b) s += '0123456789abcdefghijklmnopqrstuvwxyz'[x % 36]; return s }
const int = (v, lo, hi, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

export const emptySave = () => ({
  bests: {}, flags: {},
  wallet: { tickets: 0, earned: 0, balls: ['classic'], trails: ['streak'], ball: 'classic', trail: 'streak', spins: 0, drops: 0,
    booms: ['bucket'], boom: 'bucket', pulls: 0, lfree: 0 },
})

// Taps as the game sends them: [[step, dir], ...], steps never going back, dir -1 / 0 / 1.
export function cleanInputs(raw, { required = true } = {}) {
  if (!Array.isArray(raw)) return required ? null : []
  if (raw.length > MAX_INPUTS) return null
  const out = []
  let last = 0
  for (const x of raw) {
    if (!Array.isArray(x) || x.length !== 2) return null
    const [st, d] = x
    if (!Number.isInteger(st) || st < 0 || st > MAX_STEPS || st < last) return null
    if (d !== -1 && d !== 0 && d !== 1) return null
    out.push([st, d]); last = st
  }
  return out
}

// A save from a game, cut down to what a save holds (anything else is dropped).
export function cleanSave(raw) {
  const S = emptySave()
  const r = raw && typeof raw === 'object' ? raw : {}
  const bests = r.bests && typeof r.bests === 'object' ? r.bests : {}
  let n = 0
  for (const [id, b] of Object.entries(bests)) {
    if (n >= 2000) break
    if (!KEY_RE.test(id) || !b || typeof b !== 'object') continue
    const flaps = int(b.flaps, 0, 9999, -1)
    if (flaps < 0) continue
    S.bests[id] = { flaps, stars: int(b.stars, 0, 3), inputs: cleanInputs(b.inputs, { required: false }) || [] }
    n++
  }
  const flags = r.flags && typeof r.flags === 'object' ? r.flags : {}
  n = 0
  for (const [k, v] of Object.entries(flags)) {
    if (n >= 3000) break
    if (KEY_RE.test(k) && v) { S.flags[k] = 1; n++ }
  }
  const w = r.wallet && typeof r.wallet === 'object' ? r.wallet : {}
  const list = (xs, d) => (Array.isArray(xs) ? [...new Set(xs.filter((x) => typeof x === 'string' && ITEM_RE.test(x)))].slice(0, 500) : d)
  S.wallet = {
    tickets: int(w.tickets, 0, 1e9), earned: int(w.earned, 0, 1e9),
    balls: list(w.balls, ['classic']), trails: list(w.trails, ['streak']),
    ball: typeof w.ball === 'string' && ITEM_RE.test(w.ball) ? w.ball : 'classic',
    trail: typeof w.trail === 'string' && ITEM_RE.test(w.trail) ? w.trail : 'streak',
    spins: int(w.spins, 0, 1e6), drops: int(w.drops, 0, 1e6),
    // (goal explosions, Flappy Hoops 2.10: what you own and have on, Draft Lottery pulls and free pulls used)
    booms: list(w.booms, ['bucket']),
    boom: typeof w.boom === 'string' && ITEM_RE.test(w.boom) ? w.boom : 'bucket',
    pulls: int(w.pulls, 0, 1e6), lfree: int(w.lfree, 0, 1e6),
  }
  if (!S.wallet.booms.includes('bucket')) S.wallet.booms.unshift('bucket')
  if (!S.wallet.booms.includes(S.wallet.boom)) S.wallet.boom = 'bucket'
  return S
}

// The server's copy S and a device's copy C, merged. delta: what that device earned (tickets, earned)
// since its last sync, spends counted negative. eq: the device changed what it has on.
export function mergeSave(S, C, delta = {}, eq = false) {
  const out = cleanSave(S)
  const c = cleanSave(C)
  for (const [id, b] of Object.entries(c.bests)) {
    const s = out.bests[id]
    if (!s || b.flaps < s.flaps) out.bests[id] = { ...b, stars: Math.max(b.stars, s ? s.stars : 0) }
    else s.stars = Math.max(s.stars, b.stars)
  }
  for (const k of Object.keys(c.flags)) out.flags[k] = 1
  const W = out.wallet, cw = c.wallet
  for (const id of cw.balls) if (!W.balls.includes(id)) W.balls.push(id)
  for (const id of cw.trails) if (!W.trails.includes(id)) W.trails.push(id)
  for (const id of cw.booms) if (!W.booms.includes(id)) W.booms.push(id)
  W.tickets = Math.max(0, W.tickets + int(delta.tickets, -1e7, 1e7))
  W.earned = W.earned + Math.max(0, int(delta.earned, -1e7, 1e7))
  W.spins = Math.max(W.spins, cw.spins)
  W.drops = Math.max(W.drops, cw.drops)
  W.pulls = Math.max(W.pulls, cw.pulls)
  W.lfree = Math.max(W.lfree, cw.lfree)
  if (eq === true) {
    if (W.balls.includes(cw.ball)) W.ball = cw.ball
    if (W.trails.includes(cw.trail)) W.trail = cw.trail
    if (W.booms.includes(cw.boom)) W.boom = cw.boom
  }
  return out
}

// Who takes the board: 1 if the new run (f, k) beats the holder (cf, ck) on board b, 0 if it's level
// on both (the holder keeps it), -1 if it's worse. The Lua below does the same.
export function beats(b, f, k, cf, ck) {
  if (f === cf && k === ck) return 0
  if (b === 'f') return f < cf || (f === cf && k < ck) ? 1 : -1
  return k < ck || (k === ck && f < cf) ? 1 : -1
}

/* ------------------------------------------------------------ Lua */

const ONE_IN = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n`
// KEYS name, user, token, tokens; ARGV id, name, salt, ph, at, tokenValue, ttl, tokenHash
const CREATE = `if redis.call('SET', KEYS[1], ARGV[1], 'NX') == false then return 0 end
redis.call('HSET', KEYS[2], 'name', ARGV[2], 'salt', ARGV[3], 'ph', ARGV[4], 'at', ARGV[5])
redis.call('SET', KEYS[3], ARGV[6], 'EX', tonumber(ARGV[7]))
redis.call('SADD', KEYS[4], ARGV[8])
return 1`
// KEYS bad, user → { wrong PINs so far, name, salt, ph }
const SIGNIN_READ = `local b = tonumber(redis.call('GET', KEYS[1]) or '0')
local u = redis.call('HMGET', KEYS[2], 'name', 'salt', 'ph')
return { b, u[1] or '', u[2] or '', u[3] or '' }`
// KEYS bad, token, tokens, save; ARGV tokenValue, ttl, tokenHash → the save (or false)
const SIGNIN_OK = `redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SADD', KEYS[3], ARGV[3])
return redis.call('GET', KEYS[4])`
// KEYS save, version → { save or '', version }
const SAVE_READ = `return { redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or '0' }`
// KEYS save, version; ARGV expected version, new save, new version
const SAVE_CAS = `if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return 1`
// KEYS fhrec, fhrec:in, hist f, hist s, log f, log s, fhrec:c; ARGV field f, field s, value, taps, flaps, steps, user id
// → per board { 1 if it's yours now, 1 if level on both, what was there ('' if nothing) }
const SUBMIT = `local f, k = tonumber(ARGV[5]), tonumber(ARGV[6])
local out = {}
for b = 1, 2 do
  local field = ARGV[b]
  local cur = redis.call('HGET', KEYS[1], field)
  local better, tied = 0, 0
  if not cur then better = 1 else
    local cf, ck = string.match(cur, '^(%d+)|(%d+)|')
    cf, ck = tonumber(cf), tonumber(ck)
    if f == cf and k == ck then tied = 1
    elseif b == 1 then if f < cf or (f == cf and k < ck) then better = 1 end
    else if k < ck or (k == ck and f < cf) then better = 1 end end
  end
  if better == 1 then
    if cur then
      redis.call('LPUSH', KEYS[2 + b], cur .. '\\n' .. (redis.call('HGET', KEYS[2], field) or '[]'))
      redis.call('LTRIM', KEYS[2 + b], 0, ${HIST - 1})
    end
    redis.call('HSET', KEYS[1], field, ARGV[3])
    redis.call('HSET', KEYS[2], field, ARGV[4])
    redis.call('RPUSH', KEYS[4 + b], ARGV[3])
    redis.call('LTRIM', KEYS[4 + b], -${LOG}, -1)
    local c = redis.call('HGET', KEYS[7], field) or '0|0'
    local br, ha = string.match(c, '^(%d+)|(%d+)$')
    br, ha = tonumber(br or '0'), tonumber(ha or '0')
    if cur then
      br = br + 1
      if not string.find(cur, '"u":"' .. ARGV[7] .. '"', 1, true) then ha = ha + 1 end
    end
    redis.call('HSET', KEYS[7], field, br .. '|' .. ha)
  end
  out[b] = { better, tied, cur or '' }
end
return out`
// KEYS fhrec, fhrec:in; ARGV field → { record, taps }
const WATCH = `return { redis.call('HGET', KEYS[1], ARGV[1]) or '', redis.call('HGET', KEYS[2], ARGV[1]) or '' }`
// KEYS fhrec, fhrec:in, hist; ARGV field → { what was dropped, what's there now }
const DROP = `local cur = redis.call('HGET', KEYS[1], ARGV[1]) or ''
local item = redis.call('LPOP', KEYS[3])
if item then
  local nl = string.find(item, '\\n', 1, true)
  redis.call('HSET', KEYS[1], ARGV[1], string.sub(item, 1, nl - 1))
  redis.call('HSET', KEYS[2], ARGV[1], string.sub(item, nl + 1))
  return { cur, string.sub(item, 1, nl - 1) }
end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return { cur, '' }`

/* ------------------------------------------------------------ helpers */

const K = {
  name: (key) => 'fha:n:' + key, user: (id) => 'fha:u:' + id, token: (h) => 'fha:t:' + h, tokens: (id) => 'fha:tk:' + id,
  save: (id) => 'fha:s:' + id, ver: (id) => 'fha:sv:' + id, bad: (id) => 'fha:bad:' + id, ip: (ip) => 'fha:ip:' + ip,
}
const REC = 'fhrec', REC_IN = 'fhrec:in', hist = (field) => 'fhrec:h:' + field
const REC_C = 'fhrec:c', recLog = (field) => 'fhrec:log:' + field

// Breaks and changes of hands, worked out from a board's log (oldest first)
export function countLog(entries) {
  let br = 0, ha = 0
  for (let i = 1; i < entries.length; i++) { br++; if (!entries[i - 1] || !entries[i] || entries[i].u !== entries[i - 1].u) ha++ }
  return [br, ha]
}
// After an admin drop: the dropped holder (the last in the log) comes off it, and the counts are worked out again
async function afterDrop(field) {
  await redis(['RPOP', recLog(field)])
  const log = ((await redis(['LRANGE', recLog(field), 0, -1])) || []).map(unpackRecord)
  const [br, ha] = countLog(log)
  if (log.length) await redis(['HSET', REC_C, field, `${br}|${ha}`]); else await redis(['HDEL', REC_C, field])
}

function ipOf(req) {
  const h = (req && req.headers) || {}
  const xf = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim()
  return (xf || 'local').slice(0, 64)
}

// "flaps|steps|json" → the entry
export function unpackRecord(v) {
  if (!v) return null
  const a = v.indexOf('|'), b = v.indexOf('|', a + 1)
  if (a < 0 || b < 0) return null
  try { return JSON.parse(v.slice(b + 1)) } catch { return null }
}

async function whoIs(t) {
  if (typeof t !== 'string' || t.length < 20 || t.length > 64) bad(401, 'You’re signed out. Sign in again.')
  const v = await redis(['GETEX', K.token(sha(t)), 'EX', String(TOKEN_TTL)])
  if (!v) bad(401, 'You’re signed out. Sign in again.')
  const i = v.indexOf('|')
  return { id: v.slice(0, i), name: v.slice(i + 1) }
}

async function ipLimit(req) {
  const n = Number(await redis(['EVAL', ONE_IN, 1, K.ip(ipOf(req)), String(IP_S)]))
  if (n > IP_MAX) bad(429, 'Too many tries from here. Wait ten minutes and try again.')
}

let SIM = null
async function sim() {
  if (!SIM) SIM = import(pathToFileURL(path.join(process.cwd(), 'public', 'flappy-hoops', 'server', 'sim.mjs')).href)
  try { return await SIM } catch (e) { SIM = null; throw e }
}

const ADMIN = () => process.env.WCE_STATUS_KEY || ''
function isAdmin(key) {
  const want = ADMIN()
  if (!want || typeof key !== 'string') return false
  const a = Buffer.from(sha(key)), b = Buffer.from(sha(want))
  return timingSafeEqual(a, b)
}
const adminTries = makeLimiter({ windowMs: 10 * 60 * 1000 })

/* ------------------------------------------------------------ accounts */

async function create(body, req) {
  await ipLimit(req)
  const c = cleanName(body.name)
  if (c.error) bad(400, c.error)
  if (!validPin(body.pin)) bad(400, 'A PIN is four digits.')
  const id = newId(), salt = randomBytes(16).toString('hex')
  const ph = (await scrypt(body.pin, salt)).toString('hex')
  const t = newToken(), th = sha(t)
  const ok = Number(await redis(['EVAL', CREATE, 4, K.name(nameKey(c.name)), K.user(id), K.token(th), K.tokens(id),
    id, c.name, salt, ph, String(Date.now()), id + '|' + c.name, String(TOKEN_TTL), th]))
  if (ok !== 1) bad(409, 'That name is taken. Pick another, or sign in if it’s yours.')
  return { ok: true, t, name: c.name, save: emptySave() }
}

const NO_MATCH = 'That name and PIN don’t match.'
async function signin(body, req) {
  await ipLimit(req)
  const pin = typeof body.pin === 'string' ? body.pin : ''
  const id = await redis(['GET', K.name(nameKey(String(body.name ?? '').trim()))])
  if (!id) { await scrypt(pin || '0000', 'x'.repeat(32)); bad(401, NO_MATCH) }     // (as slow as a wrong PIN)
  const [wrong, name, salt, ph] = await redis(['EVAL', SIGNIN_READ, 2, K.bad(id), K.user(id)])
  if (Number(wrong) >= LOCK_AFTER) bad(429, 'Too many wrong PINs for that name. Try again in 15 minutes.')
  if (!name || !salt || !ph) bad(401, NO_MATCH)
  const got = await scrypt(pin, salt)
  if (!validPin(pin) || !timingSafeEqual(got, Buffer.from(ph, 'hex'))) {
    await redis(['EVAL', ONE_IN, 1, K.bad(id), String(LOCK_S)])
    bad(401, NO_MATCH)
  }
  const t = newToken(), th = sha(t)
  const raw = await redis(['EVAL', SIGNIN_OK, 4, K.bad(id), K.token(th), K.tokens(id), K.save(id), id + '|' + name, String(TOKEN_TTL), th])
  let save = emptySave()
  if (raw) try { save = cleanSave(JSON.parse(raw)) } catch { /* keep the empty one */ }
  return { ok: true, t, name, save }
}

// What a device says it already has: { hole: [flaps, stars] } (no taps), plus the bests it just sent.
export function deviceHas(have, sent) {
  const out = {}
  let n = 0
  if (have && typeof have === 'object' && !Array.isArray(have)) {
    for (const [id, v] of Object.entries(have)) {
      if (n >= 2000) break
      if (!KEY_RE.test(id) || !Array.isArray(v)) continue
      const flaps = int(v[0], 0, 9999, -1)
      if (flaps < 0) continue
      out[id] = [flaps, int(v[1], 0, 3)]; n++
    }
  }
  for (const [id, b] of Object.entries((sent && sent.bests) || {})) {
    const h = out[id]
    out[id] = h ? [Math.min(h[0], b.flaps), Math.max(h[1], b.stars)] : [b.flaps, b.stars]
  }
  return out
}
// Only the bests the device doesn't already have as good: missing, fewer flaps, or more stars.
export function bestsFor(merged, has) {
  const out = {}
  for (const [id, b] of Object.entries(merged.bests)) {
    const h = has[id]
    if (!h || b.flaps < h[0] || b.stars > h[1]) out[id] = b
  }
  return out
}

async function sync(body) {
  const me = await whoIs(body.t)
  const sent = cleanSave(body.save)
  for (let tries = 0; tries < 3; tries++) {
    const [raw, ver] = await redis(['EVAL', SAVE_READ, 2, K.save(me.id), K.ver(me.id)])
    let S = emptySave()
    if (raw) try { S = JSON.parse(raw) } catch { /* start again from empty */ }
    const merged = mergeSave(S, body.save, body.delta || {}, body.eq === true)
    const next = String(Number(ver || 0) + 1)
    if (Number(await redis(['EVAL', SAVE_CAS, 2, K.save(me.id), K.ver(me.id), String(ver || '0'), JSON.stringify(merged), next])) === 1) {
      // (a save with every best's taps can run past 100 KB, and a game syncs every few seconds while
      // it's played: send back only what this device is missing)
      return { ok: true, name: me.name, save: { ...merged, bests: bestsFor(merged, deviceHas(body.have, sent)) } }
    }
  }
  bad(503, 'Couldn’t save just now. Your progress is safe on this device; it’ll sync next time.')
}

async function revokeAll(id) {
  const hs = (await redis(['SMEMBERS', K.tokens(id)])) || []
  if (hs.length) await redis(['DEL', ...hs.map((h) => K.token(h))])
  await redis(['DEL', K.tokens(id)])
}

async function acctAdmin(body, req) {
  if (!adminTries.take(ipOf(req), 20).ok) bad(429, 'Too many tries. Wait a few minutes.')
  if (!isAdmin(body.key)) bad(403, 'That key isn’t right.')
  const id = await redis(['GET', K.name(nameKey(String(body.name ?? '').trim()))])
  if (!id) bad(404, 'No account has that name.')
  if (body.op === 'resetpin') {
    if (!validPin(body.pin)) bad(400, 'A PIN is four digits.')
    const salt = randomBytes(16).toString('hex'), ph = (await scrypt(body.pin, salt)).toString('hex')
    await redis(['HSET', K.user(id), 'salt', salt, 'ph', ph])
    await redis(['DEL', K.bad(id)])
    await revokeAll(id)
    return { ok: true, name: await redis(['HGET', K.user(id), 'name']), signedOut: true }
  }
  if (body.op === 'delete') {
    // the account, its save and its sessions; and any record it holds goes back to the one before
    const name = await redis(['HGET', K.user(id), 'name'])
    await revokeAll(id)
    await redis(['DEL', K.name(nameKey(name || body.name)), K.user(id), K.save(id), K.ver(id), K.bad(id)])
    const dropped = []
    const all = (await redis(['HGETALL', REC])) || []
    for (let i = 0; i + 1 < all.length; i += 2) {
      let field = all[i], e = unpackRecord(all[i + 1])
      for (let n = 0; e && e.u === id && n < HIST + 1; n++) {
        const [, now] = await redis(['EVAL', DROP, 3, REC, REC_IN, hist(field), field])
        await afterDrop(field)
        dropped.push(field)
        e = unpackRecord(now)
      }
    }
    return { ok: true, deleted: name, recordsDropped: dropped }
  }
  bad(400, 'Unknown op.')
}

/* ------------------------------------------------------------ records */

async function submit(body) {
  const me = await whoIs(body.t)
  if (!submits.take(me.id, SUBMITS_A_MINUTE).ok) bad(429, 'Slow down a little.')
  await notKnockout(body)
  const h = String(body.h || '')
  if (!HOLE_RE.test(h)) bad(400, 'That isn’t a hole.')
  const inputs = cleanInputs(body.in)
  if (!inputs) bad(400, 'That run’s taps don’t make sense.')
  const S = await sim()
  if (!Object.prototype.hasOwnProperty.call(S.HOLES, h)) bad(400, 'That hole isn’t in this version of the game. Reload to get the latest.', { stale: true })
  const world = S.compileLevel(S.HOLES[h])
  if (body.race === true) world.portals = []          // (in a race the ghost-hole doors are shut)
  const { state } = S.simulate(world, inputs, MAX_STEPS, { stopOnScore: true })
  if (!(state.scored >= 0)) bad(422, 'That run doesn’t sink it on this version of the game.', { stale: typeof body.b === 'string' && body.b !== S.BUILD })
  const f = state.flaps, k = state.scored
  const entry = { n: me.name, u: me.id, f, k, at: Date.now() }
  if (body.race === true) entry.r = 1
  const value = `${f}|${k}|${JSON.stringify(entry)}`
  const res = await redis(['EVAL', SUBMIT, 7, REC, REC_IN, hist(h + '|f'), hist(h + '|s'), recLog(h + '|f'), recLog(h + '|s'), REC_C,
    h + '|f', h + '|s', value, JSON.stringify(inputs), String(f), String(k), me.id])
  const board = ([set, tied, was]) => {
    const prev = unpackRecord(was)
    return { set: Number(set) === 1, tied: Number(tied) === 1, cur: Number(set) === 1 ? entry : prev, prev: Number(set) === 1 ? prev : null }
  }
  return { ok: true, f, k, boards: { f: board(res[0]), s: board(res[1]) } }
}
const submits = makeLimiter()

/* ------------------------------------------------------------ Knockout records (2.12) */

// KEYS board, log, counts; ARGV field, value, a (primary), b (secondary), user id, better = 'lt' (fewer wins) or 'gt'
// → { 1 if it's theirs now, 1 if level, what was there }. The holder keeps it when level (on both, for Fastest).
const KO_SUBMIT = `local cur = redis.call('HGET', KEYS[1], ARGV[1])
local a, b = tonumber(ARGV[3]), tonumber(ARGV[4])
local better, tied = 0, 0
if not cur then better = 1 else
  local ca, cb = string.match(cur, '^(%d+)|(%d+)|')
  if not ca then ca = string.match(cur, '^(%d+)|'); cb = '0' end
  ca, cb = tonumber(ca), tonumber(cb)
  if a == ca and b == cb then tied = 1
  elseif ARGV[6] == 'lt' then if a < ca or (a == ca and b < cb) then better = 1 end
  else if a > ca then better = 1 end end
end
if better == 1 then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('RPUSH', KEYS[2], ARGV[2])
  redis.call('LTRIM', KEYS[2], -${LOG}, -1)
  local c = redis.call('HGET', KEYS[3], ARGV[1]) or '0|0'
  local br, ha = string.match(c, '^(%d+)|(%d+)$')
  br, ha = tonumber(br or '0'), tonumber(ha or '0')
  if cur then
    br = br + 1
    if not string.find(cur, '"u":"' .. ARGV[5] .. '"', 1, true) then ha = ha + 1 end
  end
  redis.call('HSET', KEYS[3], ARGV[1], br .. '|' .. ha)
end
return { better, tied, cur or '' }`
const KO = 'fhko', KO_C = 'fhko:c', KO_RUN = 'fhko:run', koLog = (h) => 'fhko:log:' + h
const KOM = 'fhkom', KOM_C = 'fhkom:c', komLog = (w) => 'fhkom:log:' + w
const unpackKO = (v) => { if (!v) return null; const m = /^\d+\|(?:\d+\|)?(\{.*\})$/.exec(v); try { return m ? JSON.parse(m[1]) : null } catch { return null } }

// A Knockout hole's verified finishes (from the server's own replay): each one that beats the board takes it.
// cands [{ hole, u, n, k, f }], run { seed, inputs } (kept with a record that's set). Returns what happened to each.
export async function koSubmitHole(cands, run) {
  const out = []
  for (const c of cands || []) {
    if (!HOLE_RE.test(c.hole) || !c.u) continue
    const entry = { n: c.n, u: c.u, k: c.k, f: c.f, at: Date.now() }
    const value = `${c.k}|${c.f}|${JSON.stringify(entry)}`
    const [set, tied, was] = await redis(['EVAL', KO_SUBMIT, 3, KO, koLog(c.hole), KO_C, c.hole, value, String(c.k), String(c.f), c.u, 'lt'])
    if (Number(set) === 1 && run) await redis(['HSET', KO_RUN, c.hole, JSON.stringify(run).slice(0, 200000)])
    out.push({ hole: c.hole, u: c.u, set: Number(set) === 1, tied: Number(tied) === 1, prev: unpackKO(was) })
  }
  return out
}
// A Knockout match's verified KOs: the world's Most KOs board. cands [{ world, u, n, ko }]
export async function koSubmitMatch(cands) {
  const out = []
  for (const c of cands || []) {
    if (!/^[a-z0-9-]{2,24}$/.test(c.world) || !c.u || !(c.ko > 0)) continue
    const entry = { n: c.n, u: c.u, ko: c.ko, at: Date.now() }
    const [set, tied, was] = await redis(['EVAL', KO_SUBMIT, 3, KOM, komLog(c.world), KOM_C, c.world, `${c.ko}|${JSON.stringify(entry)}`, String(c.ko), '0', c.u, 'gt'])
    out.push({ world: c.world, u: c.u, set: Number(set) === 1, tied: Number(tied) === 1, prev: unpackKO(was) })
  }
  return out
}
// The account on a race player (a token checked once, when they join), or null.
export async function acctOf(t) { try { return await whoIs(t) } catch { return null } }
// The game's rules, for the race server's replays.
export const loadSim = () => sim()

// A Knockout run doesn't go on the board (see the top of this file).
const KO_NO = 'Knockout runs don’t count for the all-time records.'
export const KO_PARTY_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/
export function koMarked(body) {
  if (!body || typeof body !== 'object') return false
  if (body.mode === 'knockout' || body.ko === true || body.ko === 1) return true
  // (an item in the taps: only Knockout has those)
  if (Array.isArray(body.in) && body.in.some((x) => Array.isArray(x) && x[1] === 'U')) return true
  return false
}
async function notKnockout(body) {
  if (koMarked(body)) bad(403, KO_NO, { ko: true })
  // (a race run says which party it was in: if that party's race is Knockout, it doesn't count either)
  const pc = typeof body.pc === 'string' ? body.pc.toUpperCase() : ''
  if (body.race === true && KO_PARTY_RE.test(pc)) {
    let mode = ''
    try { const j = await redis(['HGET', 'fhr:' + pc, 'j']); mode = j ? JSON.parse(j).mode || '' : '' } catch { /* no party: nothing to refuse */ }
    if (mode === 'knockout') bad(403, KO_NO, { ko: true })
  }
}

async function recAdmin(body, req) {
  if (!adminTries.take(ipOf(req), 20).ok) bad(429, 'Too many tries. Wait a few minutes.')
  if (!isAdmin(body.key)) bad(403, 'That key isn’t right.')
  if (body.op === 'rebuildlog') {
    // once, for boards set before the log existed: their history (newest first) then the holder, oldest first
    const all = (await redis(['HGETALL', REC])) || [], done = []
    for (let i = 0; i + 1 < all.length; i += 2) {
      const field = all[i]
      if (Number(await redis(['LLEN', recLog(field)])) > 0) continue
      const older = ((await redis(['LRANGE', hist(field), 0, -1])) || []).map((x) => x.slice(0, x.indexOf('\n'))).reverse()
      const vals = [...older, all[i + 1]]
      await redis(['RPUSH', recLog(field), ...vals])
      const [br, ha] = countLog(vals.map(unpackRecord))
      await redis(['HSET', REC_C, field, `${br}|${ha}`])
      done.push(field)
    }
    return { ok: true, rebuilt: done }
  }
  const h = String(body.h || ''), b = String(body.b || '')
  if (!HOLE_RE.test(h) || (b !== 'f' && b !== 's')) bad(400, 'Say which hole (h) and which board (b: f or s).')
  const field = h + '|' + b
  if (body.op === 'list') {
    const cur = await redis(['HGET', REC, field])
    const items = (await redis(['LRANGE', hist(field), 0, -1])) || []
    return { ok: true, cur: unpackRecord(cur), history: items.map((x) => unpackRecord(x.slice(0, x.indexOf('\n')))) }
  }
  if (body.op === 'drop') {
    const [was, now] = await redis(['EVAL', DROP, 3, REC, REC_IN, hist(field), field])
    await afterDrop(field)
    return { ok: true, dropped: unpackRecord(was), cur: unpackRecord(now) }
  }
  bad(400, 'Unknown op.')
}

/* ------------------------------------------------------------ the two doors */

const send = (res, status, obj) => res.status(status).json(obj)
function fail(res, e) {
  if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) })
  return send(res, 500, { error: 'Something went wrong on our end. Try again.' })
}

// GET /api/race?rec=all · ?rec=watch&h=<hole>&b=f|s
export async function hoopsGet(req, res) {
  const q = req.query || {}
  try {
    if (q.rec === 'all') {
      const all = (await redis(['HGETALL', REC])) || []
      const records = {}
      for (let i = 0; i + 1 < all.length; i += 2) { const e = unpackRecord(all[i + 1]); if (e) records[all[i]] = e }
      const cs = (await redis(['HGETALL', REC_C])) || [], counts = {}
      for (let i = 0; i + 1 < cs.length; i += 2) { const m = /^(\d+)\|(\d+)$/.exec(cs[i + 1]); if (m) counts[cs[i]] = [Number(m[1]), Number(m[2])] }
      let build = null
      try { build = (await sim()).BUILD } catch { /* no rules on this deployment */ }
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
      return send(res, 200, { ok: true, build, records, counts })
    }
    if (q.rec === 'ko') {
      // (Knockout's own boards: Fastest per hole, Most KOs per world, and how often each has been broken)
      const [a, ac, m, mc] = await Promise.all([redis(['HGETALL', KO]), redis(['HGETALL', KO_C]), redis(['HGETALL', KOM]), redis(['HGETALL', KOM_C])])
      const pairs = (x, f) => { const o = {}; for (let i = 0; i + 1 < (x || []).length; i += 2) { const v = f(x[i + 1]); if (v) o[x[i]] = v } return o }
      const cnt = (v) => { const z = /^(\d+)\|(\d+)$/.exec(v); return z ? [Number(z[1]), Number(z[2])] : null }
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
      return send(res, 200, { ok: true, holes: pairs(a, unpackKO), counts: pairs(ac, cnt), worlds: pairs(m, unpackKO), wcounts: pairs(mc, cnt) })
    }
    if (q.rec === 'kohistory') {
      const h = String(q.h || ''), w = String(q.w || '')
      if (!HOLE_RE.test(h) && !/^[a-z0-9-]{2,24}$/.test(w)) bad(400, 'Say which hole (h) or world (w).')
      const items = (await redis(['LRANGE', h ? koLog(h) : komLog(w), 0, -1])) || []
      const entries = items.map(unpackKO).filter(Boolean)
      const [breaks, hands] = countLog(entries)
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
      return send(res, 200, { ok: true, entries, breaks, hands })
    }
    if (q.rec === 'history') {
      // every holder the board has had, oldest first, and how many times it's been broken / changed hands
      const h = String(q.h || ''), b = String(q.b || '')
      if (!HOLE_RE.test(h) || (b !== 'f' && b !== 's')) bad(400, 'Say which hole (h) and which board (b: f or s).')
      const items = (await redis(['LRANGE', recLog(h + '|' + b), 0, -1])) || []
      const entries = items.map(unpackRecord).filter(Boolean)
      const [breaks, hands] = countLog(entries)
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
      return send(res, 200, { ok: true, entries, breaks, hands })
    }
    if (q.rec === 'watch') {
      const h = String(q.h || ''), b = String(q.b || '')
      if (!HOLE_RE.test(h) || (b !== 'f' && b !== 's')) bad(400, 'Say which hole (h) and which board (b: f or s).')
      const [v, taps] = await redis(['EVAL', WATCH, 2, REC, REC_IN, h + '|' + b])
      const entry = unpackRecord(v)
      if (!entry) bad(404, 'Nobody holds that record yet.')
      let inputs = []
      try { inputs = JSON.parse(taps || '[]') } catch { /* none */ }
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
      return send(res, 200, { ok: true, entry, inputs })
    }
    bad(400, 'Unknown request.')
  } catch (e) { return fail(res, e) }
}

// POST { a: 'acct.*' | 'rec.*', ... }
export async function hoopsPost(body, req, res) {
  try {
    if (JSON.stringify(body).length > MAX_BODY) bad(413, 'That’s too much to save at once.')
    const a = String(body.a || '')
    let out
    if (a === 'acct.create') out = await create(body, req)
    else if (a === 'acct.signin') out = await signin(body, req)
    else if (a === 'acct.sync') out = await sync(body)
    else if (a === 'acct.me') { const me = await whoIs(body.t); out = { ok: true, name: me.name } }
    else if (a === 'acct.signout') {
      if (typeof body.t === 'string' && body.t.length >= 20 && body.t.length <= 64) await redis(['DEL', K.token(sha(body.t))])
      out = { ok: true }
    }
    else if (a === 'acct.admin') out = await acctAdmin(body, req)
    else if (a === 'rec.submit') out = await submit(body)
    else if (a === 'rec.admin') out = await recAdmin(body, req)
    // (the site's tests only, never on a deployment: the Most KOs board's own rules, given a match the replay counted)
    else if (a === 'rec.kotest' && process.env.RACE_TEST === '1') out = { ok: true, res: await koSubmitMatch(body.cands) }
    else bad(400, 'Unknown request.')
    return send(res, 200, out)
  } catch (e) { return fail(res, e) }
}
