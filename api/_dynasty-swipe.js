// api/_dynasty-swipe.js — Dynasty Exchange's swipe mode, server side. api/dynasty.js routes the
// three swipe actions here; the underscore keeps Vercel from counting this as a function of
// its own (the Hobby plan allows twelve).
//
// THE GAME
// You hold a player (the champion). You are shown another (the challenger) and swipe: right
// if the challenger is better, left if your champion is. Whoever wins is your champion for
// the next card. Each swipe is ONE head-to-head result and goes through the same Elo the
// four-player ballots use (eloUpdates in dynasty.js), so the two modes price the same market.
//
// DEALING
// The browser cannot be trusted to choose its own matchups (or anyone could feed one player
// nothing but scrubs). So the server deals: a start player and a deck of challengers, stored
// under a nonce. The browser chooses the ORDER it shows them in, so the next card can sit
// near the champion's price without a round trip per swipe, but every matchup it submits has
// to be one this deck allows. Most of the deck is drawn near the champion's rank and a little
// above it, because a run climbs; the rest is wildcards from anywhere in the mode's pool.
//
// WHAT A SWIPE IS WORTH
// One swipe is one pairwise result, against six for a four-player ballot. Two things damp it
// further, because one person's run is not twenty independent opinions:
//   - a champion defending again is the same judgement repeated. The nth swipe a champion
//     sits in, in a row, is worth 1/sqrt(n): his first defence counts in full, his tenth a
//     third. Twenty straight wins add up to about 7.6 results, not 20.
//   - a daily budget, per browser and per network address. Past it a swipe still counts for
//     your own history, but moves the market at a tenth of the weight. The browser id is a
//     random string anyone can mint, which is why the address has a budget too.
//   - a daily cap per PLAYER, per browser and per address. The budget alone let someone who
//     took the same player run after run lift him from #151 to #25 in a day (the simulation
//     found it). With the cap, one browser can move one player about one ballot's worth a
//     day, however many runs it plays; after that, swipes on him are history only.
// tools/dynasty-swipe/check.mjs simulates both and prints what a run can and cannot do.
// Swipes read the momentum streaks (they set K, as for a ballot) but never write them: a
// champion strings wins together by construction, and that is not the crowd's momentum.
//
// WHAT IT COSTS
// The store's monthly allowance is shared with the rest of the site, so a swipe never costs a
// command of its own. The browser sends its swipes in batches (a deck at a time, and whatever
// is left when the tab closes), and a batch is: one pipeline of reads, then ONE script that
// spends the nonce and writes every price, count and log line atomically. About ten commands
// for a run of fifteen, where fifteen four-player ballots would cost well over three hundred.
//
// YOUR HISTORY
// Every batch is kept against the browser's id, newest first, the last LOG_KEEP of them:
// which matchup, who you took, how long you looked. `swipe-me` reads it back. Nothing else is
// tied to it: no name, no address, no account. How that history gets used is undecided, so it
// is stored raw and complete enough to answer questions nobody has asked yet.
//
// PREVIEWS DO NOT TRADE
// A preview deployment shares the production store. On anything but production, a batch is
// checked and priced exactly as it would be, the answer shows what WOULD have moved, and
// nothing is written to the market. History and budgets go under their own prefix.
//
// KEYS (prefix dyn: in production, dynpv: on previews, except the market keys)
//   dyn:sw:g:<nonce>          STR   the dealt deck, 30 min TTL — spent by the batch that uses it
//   dyn:sw:b:<day>:u:<uid>    STR   weight spent today by that browser
//   dyn:sw:b:<day>:ip:<ip>    STR   weight spent today from that address
//   dyn:sw:n                  STR   all-time swipes
//   dyn:u:<uid>:sw            LIST  that browser's batches, newest first
//   dyn:u:<uid>               HASH  swipes, batches, runs, first, last
//   market (production only): dyn:rating, dyn:seen, dyn:recent — the same keys ballots write

export const MODES = {
  all: { label: 'All players', test: () => true },
  guard: { label: 'Guards', test: (e) => e[0] === 'Guard' },
  wing: { label: 'Wings', test: (e) => e[0] === 'Wing' },
  big: { label: 'Bigs', test: (e) => e[0] === 'Big' },
  rookie: { label: 'Rookies', test: (e) => e[1] === 1 },
  u25: { label: 'Under 25', test: (e) => e[2] != null && e[2] < 25 },
}

export const DECK = 30               // challengers per deal
export const NEAR_SHARE = 0.7        // of the deck drawn near the champion
export const NEAR_ABOVE = 30         // ranks above him the near draw reaches (a run climbs)
export const NEAR_BELOW = 15         // ranks below
export const MAX_STEPS = DECK        // a batch can never hold more swipes than its deck
export const BUDGET_UID = 40         // weight per browser per day before damping
export const BUDGET_IP = 120         // weight per address per day before damping
export const OVER_BUDGET = 0.1       // what a swipe is worth past either budget
// No one moves one player's price more than about one honest ballot's worth a day. Weight in
// any swipe involving him counts toward it, and past it his swipes count for history only.
export const PLAYER_CAP_UID = 6      // per browser, per player, per day
export const PLAYER_CAP_IP = 18      // per address, per player, per day
export const LOG_KEEP = 200          // batches of history kept per browser
const DECK_TTL = 1800
const DAY_TTL = 2 * 86400
const MS_MAX = 120000

const NONCE_RE = /^[a-z0-9]{8,40}$/i
export const UID_RE = /^[a-z0-9]{6,64}$/i
const RUN_RE = /^[a-z0-9]{4,24}$/i

// ---------------------------------------------------------------- the pool

let poolCache = null
let poolAt = 0

// id -> [Guard|Wing|Big, rookie, age], written at build time by scripts/lib/dynasty-cards.mjs.
// Fetched from this deployment, because it is a build output and not in the function bundle.
// A protected preview answers that fetch with its login page, so the fallback is the board's
// own player file (bundled with the function through vercel.json includeFiles), with the
// board's PG..C folded into guards, wings and bigs.
export async function loadPool(req, fallbackPlayers) {
  if (poolCache && Date.now() - poolAt < 3600e3) return poolCache
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}
    const r = await fetch(`${proto}://${host}/dynasty/swipe-pool.json`, { headers })
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const doc = await r.json()
      if (doc && doc.players && Object.keys(doc.players).length) {
        poolCache = doc.players; poolAt = Date.now(); return poolCache
      }
    }
  } catch { /* fall through */ }
  let players = fallbackPlayers || []
  if (!players.length) {
    try {
      const { readFileSync } = await import('node:fs')
      const path = await import('node:path')
      players = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'dynasty', 'players.json'), 'utf8')).players || []
    } catch { players = [] }
  }
  const map = { PG: 'Guard', SG: 'Guard', SF: 'Wing', PF: 'Big', C: 'Big' }
  const out = {}
  for (const p of players) out[p.id] = [map[p.pos] || null, p.rookie ? 1 : 0, p.age ?? null]
  return out
}

// ---------------------------------------------------------------- dealing

/**
 * ids: the board, best first. entry(id) -> pool entry. Returns { start, deck } or null.
 * champ: carry an existing champion into a fresh deck. exclude: champions already crowned
 * this session ("go again for your #2").
 */
export function dealDeck(ids, entry, { mode = 'all', champ = null, exclude = [], rnd = Math.random } = {}) {
  const test = (MODES[mode] || MODES.all).test
  const ex = new Set(exclude.map(String))
  const pool = ids.filter((id) => !ex.has(id) && entry(id) && test(entry(id)))
  if (pool.length < 2) return null

  let start = champ != null && pool.includes(String(champ)) ? String(champ) : null
  // A fresh run opens somewhere in the top 60% of the mode's pool: a name people have an
  // opinion on, with room above him to climb.
  if (!start) start = pool[Math.floor(rnd() * Math.max(1, Math.ceil(pool.length * 0.6)))]
  const at = pool.indexOf(start)

  const rest = pool.filter((id) => id !== start)
  const want = Math.min(DECK, rest.length)
  const nearWant = Math.round(want * NEAR_SHARE)
  const take = (list, k, picked) => {
    const bag = list.filter((id) => !picked.has(id))
    while (k-- > 0 && bag.length) picked.add(bag.splice(Math.floor(rnd() * bag.length), 1)[0])
  }
  const picked = new Set()
  const near = pool.slice(Math.max(0, at - NEAR_ABOVE), at + NEAR_BELOW + 1).filter((id) => id !== start)
  take(near, nearWant, picked)
  take(rest.slice(0, Math.max(want, Math.ceil(rest.length * 0.75))), want - picked.size, picked)
  take(rest, want - picked.size, picked)
  return { start, deck: [...picked] }
}

// ---------------------------------------------------------------- checking a batch

// steps: [[champion, challenger, took (1 = challenger, 0 = champion), ms], ...]
// Valid only if it replays as one unbroken chain from the dealt start through dealt cards,
// each challenger shown once.
export function checkSteps(start, deck, steps) {
  if (!Array.isArray(steps) || !steps.length) return { error: 'no swipes' }
  if (steps.length > MAX_STEPS) return { error: 'too many swipes' }
  const allowed = new Set(deck.map(String))
  const used = new Set()
  let champ = String(start)
  const clean = []
  for (const s of steps) {
    if (!Array.isArray(s) || s.length < 3) return { error: 'bad swipe' }
    const c = String(s[0]), x = String(s[1]), took = Number(s[2])
    const ms = Math.max(0, Math.min(MS_MAX, Math.round(Number(s[3]) || 0)))
    if (c !== champ) return { error: 'broken chain' }
    if (!allowed.has(x) || used.has(x) || x === c) return { error: 'not dealt' }
    if (took !== 0 && took !== 1) return { error: 'bad pick' }
    used.add(x)
    clean.push([c, x, took, ms])
    champ = took ? x : c
  }
  return { steps: clean, champ }
}

// ---------------------------------------------------------------- pricing a batch

/**
 * Prices a batch in order, each swipe against the prices the previous one left, exactly as
 * if the swipes had been submitted one at a time. Returns per-player deltas, the weight spent
 * and, per swipe, what the market thought before it (the challenger's chance of being taken).
 */
export function priceSteps(steps, ratings, streaks, seen, eloUpdates,
  { spentUid = 0, spentIp = 0, playerUid = {}, playerIp = {} } = {}) {
  const r = { ...ratings }
  const delta = {}
  const odds = []
  const perPlayer = {}
  const left = (id) => Math.max(0, Math.min(
    PLAYER_CAP_UID - (Number(playerUid[id] || 0) + (perPlayer[id] || 0)),
    PLAYER_CAP_IP - (Number(playerIp[id] || 0) + (perPlayer[id] || 0))))
  let run = 0, prev = null, spent = 0
  for (const [c, x, took] of steps) {
    // How many swipes in a row this champion has now sat in. The swipe that dethrones him is
    // still part of his run; the new champion starts his own at 1.
    run = c === prev ? run + 1 : 1
    prev = c
    let w = 1 / Math.sqrt(run)
    const over = spentUid + spent + w > BUDGET_UID || spentIp + spent + w > BUDGET_IP
    if (over) w *= OVER_BUDGET
    w = Math.min(w, left(c), left(x))
    const rc = r[c] ?? 1500, rx = r[x] ?? 1500
    odds.push(Math.round(100 / (1 + Math.pow(10, (rc - rx) / 400))))
    const winner = took ? x : c, loser = took ? c : x
    const d = eloUpdates([winner, loser], r, streaks, seen)
    for (const id of [winner, loser]) {
      const v = d[id] * w
      r[id] = (r[id] ?? 1500) + v
      delta[id] = (delta[id] || 0) + v
    }
    spent += w
    if (w > 0) for (const id of [c, x]) perPlayer[id] = (perPlayer[id] || 0) + w
  }
  return { delta, spent, odds, after: r, perPlayer }
}

// ---------------------------------------------------------------- the one write

// KEYS: 1 deck  2 rating  3 seen  4 recent  5 log  6 meta  7 budget uid  8 budget ip  9 count
//       10 per-player uid  11 per-player ip
// ARGV: 1 market(0|1)  2 nDelta  [id, delta]...  nSeen  [id]...  log  recent  spent  dayTTL
//       logKeep  nSwipes  ts  runDone(0|1)  nPlayer  [id, weight]...
// Returns -1 when the deck was already spent (a resubmit, or a race with another tab).
export const APPLY = `
if redis.call('DEL', KEYS[1]) == 0 then return -1 end
local i = 2
local market = ARGV[1] == '1'
local nd = tonumber(ARGV[i]); i = i + 1
for j = 1, nd do
  if market then redis.call('ZINCRBY', KEYS[2], ARGV[i + 1], ARGV[i]) end
  i = i + 2
end
local ns = tonumber(ARGV[i]); i = i + 1
for j = 1, ns do
  if market then redis.call('HINCRBY', KEYS[3], ARGV[i], 1) end
  i = i + 1
end
local log, recent, spent, ttl, keep = ARGV[i], ARGV[i + 1], ARGV[i + 2], ARGV[i + 3], tonumber(ARGV[i + 4])
local n, ts, done = tonumber(ARGV[i + 5]), ARGV[i + 6], ARGV[i + 7]
if market and recent ~= '' then
  redis.call('LPUSH', KEYS[4], recent)
  redis.call('LTRIM', KEYS[4], 0, 49)
end
if market then redis.call('INCRBY', KEYS[9], n) end
redis.call('INCRBYFLOAT', KEYS[7], spent)
redis.call('EXPIRE', KEYS[7], ttl)
redis.call('INCRBYFLOAT', KEYS[8], spent)
redis.call('EXPIRE', KEYS[8], ttl)
local np = tonumber(ARGV[i + 8])
local k = i + 9
for j = 1, np do
  redis.call('HINCRBYFLOAT', KEYS[10], ARGV[k], ARGV[k + 1])
  redis.call('HINCRBYFLOAT', KEYS[11], ARGV[k], ARGV[k + 1])
  k = k + 2
end
if np > 0 then
  redis.call('EXPIRE', KEYS[10], ttl)
  redis.call('EXPIRE', KEYS[11], ttl)
end
redis.call('LPUSH', KEYS[5], log)
redis.call('LTRIM', KEYS[5], 0, keep - 1)
redis.call('HINCRBY', KEYS[6], 'swipes', n)
redis.call('HINCRBY', KEYS[6], 'batches', 1)
if done == '1' then redis.call('HINCRBY', KEYS[6], 'runs', 1) end
redis.call('HSETNX', KEYS[6], 'first', ts)
redis.call('HSET', KEYS[6], 'last', ts)
return 1
`

// ---------------------------------------------------------------- handlers

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '')
const parse = (req) => (req.method === 'POST'
  ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))
  : {})
const makeNonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

/**
 * ctx: { redis, pipe, orderedIds, ensureSeeded, eloUpdates, rateLimited, ipOf, seedPlayers,
 *        production }
 */
export async function swipeAction(action, req, res, ctx) {
  const P = ctx.production ? 'dyn:' : 'dynpv:'

  // ---- deal ---------------------------------------------------------------
  if (action === 'swipe-deal') {
    const q = req.query || {}
    const mode = MODES[q.mode] ? String(q.mode) : 'all'
    const exclude = String(q.ex || '').split(',').filter((x) => /^[0-9]{1,12}$/.test(x)).slice(0, 50)
    const champ = /^[0-9]{1,12}$/.test(String(q.champ || '')) ? String(q.champ) : null
    await ctx.ensureSeeded(req)
    const [{ ids }, pool] = await Promise.all([ctx.orderedIds(), loadPool(req, await ctx.seedPlayers(req))])
    const dealt = dealDeck(ids, (id) => pool[id], { mode, champ, exclude })
    if (!dealt) { res.status(409).json({ error: 'not enough players left in this mode' }); return }
    const nonce = makeNonce()
    await ctx.redis(['SET', P + 'sw:g:' + nonce, JSON.stringify({ s: dealt.start, d: dealt.deck, m: mode }), 'EX', DECK_TTL])
    res.status(200).json({ ok: true, nonce, mode, start: dealt.start, deck: dealt.deck, preview: !ctx.production })
    return
  }

  // ---- your history -------------------------------------------------------
  if (action === 'swipe-me') {
    const uid = String((req.query || {}).uid || '')
    if (!UID_RE.test(uid)) { res.status(400).json({ error: 'bad uid' }); return }
    const [log, meta] = await ctx.pipe([
      ['LRANGE', P + 'u:' + uid + ':sw', 0, Math.min(LOG_KEEP, Number((req.query || {}).n) || 50) - 1],
      ['HGETALL', P + 'u:' + uid],
    ])
    const m = {}
    for (let i = 0; i + 1 < (meta || []).length; i += 2) m[meta[i]] = meta[i + 1]
    res.status(200).json({
      ok: true,
      swipes: Number(m.swipes || 0), batches: Number(m.batches || 0), runs: Number(m.runs || 0),
      first: m.first ? Number(m.first) : null, last: m.last ? Number(m.last) : null,
      log: (log || []).map((s) => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean),
    })
    return
  }

  // ---- submit a batch -----------------------------------------------------
  if (action === 'swipe-submit' && req.method === 'POST') {
    let b
    try { b = parse(req) } catch { res.status(400).json({ error: 'bad json' }); return }
    const nonce = String(b.nonce || '')
    const uid = String(b.uid || '')
    const run = RUN_RE.test(String(b.run || '')) ? String(b.run) : ''
    const done = b.done ? 1 : 0
    if (!NONCE_RE.test(nonce) || !UID_RE.test(uid)) { res.status(400).json({ error: 'bad payload' }); return }

    const ip = ctx.ipOf(req)
    const day = dayKey()
    const kU = P + 'sw:b:' + day + ':u:' + uid
    const kIp = P + 'sw:b:' + day + ':ip:' + ip
    if (await ctx.rateLimited(ip)) { res.status(429).json({ error: 'slow down' }); return }
    const [stored, spentU, spentIp] = await ctx.pipe([['GET', P + 'sw:g:' + nonce], ['GET', kU], ['GET', kIp]])
    if (!stored) { res.status(409).json({ error: 'expired' }); return }
    let dealt
    try { dealt = JSON.parse(stored) } catch { res.status(409).json({ error: 'expired' }); return }

    const chk = checkSteps(dealt.s, dealt.d, b.steps)
    if (chk.error) { res.status(400).json({ error: chk.error }); return }
    const steps = chk.steps

    const ids = [...new Set(steps.flatMap(([c, x]) => [c, x]))]
    const kPU = P + 'sw:p:' + day + ':u:' + uid
    const kPIp = P + 'sw:p:' + day + ':ip:' + ip
    const [scores, st, sn, pu, pip] = await ctx.pipe([
      ['ZMSCORE', 'dyn:rating', ...ids],
      ['HMGET', 'dyn:streak', ...ids],
      ['HMGET', 'dyn:seen', ...ids],
      ['HMGET', kPU, ...ids],
      ['HMGET', kPIp, ...ids],
    ])
    const ratings = {}, streaks = {}, seen = {}, playerUid = {}, playerIp = {}
    ids.forEach((id, i) => {
      ratings[id] = scores && scores[i] != null ? Number(scores[i]) : 1500
      streaks[id] = st && st[i] != null ? Number(st[i]) : 0
      seen[id] = sn && sn[i] != null ? Number(sn[i]) : 0
      playerUid[id] = pu && pu[i] != null ? Number(pu[i]) : 0
      playerIp[id] = pip && pip[i] != null ? Number(pip[i]) : 0
    })
    const priced = priceSteps(steps, ratings, streaks, seen, ctx.eloUpdates,
      { spentUid: Number(spentU || 0), spentIp: Number(spentIp || 0), playerUid, playerIp })

    const ts = Date.now()
    const log = JSON.stringify({ t: ts, r: run, m: dealt.m, s: steps.map(([c, x, k, ms], i) => [+c, +x, k, ms, priced.odds[i]]), ...(done ? { f: +chk.champ } : {}) })
    const recent = done ? JSON.stringify({ order: [chk.champ], ts, swipe: true, n: steps.length, mode: dealt.m }) : ''
    const dIds = Object.keys(priced.delta)
    const args = [
      ctx.production ? '1' : '0',
      String(dIds.length), ...dIds.flatMap((id) => [id, priced.delta[id].toFixed(4)]),
      String(ids.length), ...ids,
      log, recent, priced.spent.toFixed(4), String(DAY_TTL), String(LOG_KEEP), String(steps.length), String(ts), String(done),
      String(Object.keys(priced.perPlayer).length), ...Object.entries(priced.perPlayer).flatMap(([id, w]) => [id, w.toFixed(4)]),
    ]
    const keys = [P + 'sw:g:' + nonce, 'dyn:rating', 'dyn:seen', 'dyn:recent', P + 'u:' + uid + ':sw', P + 'u:' + uid, kU, kIp, 'dyn:sw:n', kPU, kPIp]
    const ok = Number(await ctx.redis(['EVAL', APPLY, String(keys.length), ...keys, ...args]))
    if (ok === -1) { res.status(409).json({ error: 'already submitted' }); return }

    res.status(200).json({
      ok: true, preview: !ctx.production, champ: chk.champ, swipes: steps.length,
      spent: Number(priced.spent.toFixed(3)),
      budget: { uid: BUDGET_UID, used: Number((Number(spentU || 0) + priced.spent).toFixed(2)) },
      moved: dIds.map((id) => ({ id, delta: Math.round(priced.delta[id] * 10) / 10, rating: Math.round(priced.after[id]) })),
      odds: priced.odds,
    })
    return
  }

  res.status(405).json({ error: 'method' })
}
