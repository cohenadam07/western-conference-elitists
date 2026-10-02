// api/race.js — Flappy Hoops online races: the party's storage and its one endpoint. The rules
// (lobby, vote, nine holes, boards, tickets) are in ./_race.js; read that first.
//
// Redis (the same Upstash the rest of the site uses), one hash per party, fhr:<CODE>:
//   v            the party's version: every change to `j` is compare-and-set on it
//   j            the party itself, as JSON (who's in, the phase and its clock, the results)
//   p:<id>       what that player's game last said about itself (overwritten on every poll; only
//                that player writes it, so it never contends): its vote, its flaps so far
//   d:<m>:<h>:<id>   that player's finish on hole h of match m, "steps:flaps:when" (first one stands)
//   s:<to>:<from>    a note from one player's game to another's: the handshake that lets the two connect
//                to each other directly (WebRTC: an offer, an answer). Handed over on the addressee's
//                next poll and deleted as it's handed over. Once two games are connected, flaps go
//                straight between them and this endpoint is polled much less.
//
// A poll is ONE Redis command (an EVAL: store my blob, maybe my finish, post and collect notes,
// return the whole hash). Phase changes are a second one (compare-and-set), and only the request
// that notices the deadline pays for it. With everyone connected directly, a four-player match is
// roughly 800 commands; on the fallback (polling about once a second), roughly 2,000.
import { createHmac, randomBytes } from 'node:crypto'
import {
  CODE_RE, ID_RE, TTL, makeCode, newRoom, addPlayer, removePlayer, cleanLive, finValue, parseFin, finField,
  startVote, toLobby, advance, view, cleanNotes, iceServers, diag,
} from './_race.js'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const SECRET = process.env.RACE_SECRET || TOKEN || ''

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

const K = (code) => 'fhr:' + code
// store my blob (ARGV 1,2), my finish if I have one and none is stored (ARGV 3,4), leave my notes for
// the other games (ARGV 7.. in pairs; only for someone who's in the party, so the hash can't be
// filled with notes to nobody), read it all, and take the notes addressed to me out of it
// (ARGV 6 is "s:<me>:")
const POLL = `local k = KEYS[1]
if redis.call('EXISTS', k) == 0 then return false end
if ARGV[1] ~= '' then redis.call('HSET', k, ARGV[1], ARGV[2]) end
if ARGV[3] ~= '' then redis.call('HSETNX', k, ARGV[3], ARGV[4]) end
local j = redis.call('HGET', k, 'j') or ''
for i = 7, #ARGV, 2 do
  local c = string.find(ARGV[i], ':', 3, true)
  if c and string.find(j, '"id":"' .. string.sub(ARGV[i], 3, c - 1) .. '"', 1, true) then redis.call('HSET', k, ARGV[i], ARGV[i + 1]) end
end
redis.call('EXPIRE', k, tonumber(ARGV[5]))
local all = redis.call('HGETALL', k)
local n = string.len(ARGV[6])
for i = 1, #all, 2 do
  if string.sub(all[i], 1, n) == ARGV[6] then redis.call('HDEL', k, all[i]) end
end
return all`
// write the party if nobody else has since I read it (ARGV: old version, new version, json, ttl, fields to drop...)
const CAS = `local k = KEYS[1]
if redis.call('HGET', k, 'v') ~= ARGV[1] then return 0 end
redis.call('HSET', k, 'v', ARGV[2], 'j', ARGV[3])
for i = 5, #ARGV do redis.call('HDEL', k, ARGV[i]) end
redis.call('EXPIRE', k, tonumber(ARGV[4]))
return 1`
const CREATE = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'v', '1', 'j', ARGV[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1`

// Where the games look for a way to each other. With a relay's two settings on the deployment
// (Cloudflare's TURN: RACE_TURN_KEY_ID and RACE_TURN_API_TOKEN), each player is handed short-lived
// credentials for it along with the party, so two games can connect by way of the relay on networks
// where they can't reach each other directly (which turned out to be most of them). The credentials
// are made at most once every ten minutes per server instance and last three hours (as long as a party).
const TURN_ID = process.env.RACE_TURN_KEY_ID || '', TURN_TOKEN = process.env.RACE_TURN_API_TOKEN || ''
let turn = { at: 0, ice: null }
async function iceFor() {
  if (process.env.RACE_ICE || !TURN_ID || !TURN_TOKEN) return iceServers()
  if (turn.ice && Date.now() - turn.at < 600e3) return turn.ice
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_ID}/credentials/generate-ice-servers`, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${TURN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 3 * 3600 }),
    })
    clearTimeout(timer)
    const j = r.ok ? await r.json() : null
    const list = j && Array.isArray(j.iceServers) ? j.iceServers : null
    if (!list) throw new Error('turn ' + r.status)
    // (browsers won't open port 53, and a url that can't be opened only slows the handshake down)
    const ice = list.map((s) => ({ ...s, urls: [].concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length)
    turn = { at: Date.now(), ice: [{ urls: ['stun:stun.l.google.com:19302'] }, ...ice] }
    return turn.ice
  } catch (e) {
    console.error('race: no relay credentials', String((e && e.message) || e))
    return iceServers()
  }
}

const keyFor = (code, id) => createHmac('sha256', SECRET).update(code + ':' + id).digest('hex').slice(0, 20)
const newId = () => randomBytes(6).toString('hex').slice(0, 8)

// The hash, unpacked: the party, everyone's blobs, the finishes of the hole being played, and (for
// `me`) the notes waiting for that player.
function unpack(flat, me) {
  const h = {}
  for (let i = 0; i + 1 < (flat || []).length; i += 2) h[flat[i]] = flat[i + 1]
  let room = null
  try { room = JSON.parse(h.j) } catch { /* a party with no body is no party */ }
  if (!room) return null
  const live = {}, fins = {}, old = [], sig = []
  const mine = `d:${room.match}:${room.hole}:`
  const inParty = new Set(room.players.map((p) => p.id))
  for (const f in h) {
    if (f.startsWith('p:')) { try { live[f.slice(2)] = JSON.parse(h[f]) } catch { /* skip */ } }
    else if (f.startsWith('d:')) {
      if (f.startsWith(mine)) { const v = parseFin(h[f]); if (v) fins[f.slice(mine.length)] = v }
      if (!f.startsWith(`d:${room.match}:`)) old.push(f)
    } else if (f.startsWith('s:')) {
      const [, to, from] = f.split(':')
      if (to === me) sig.push({ from, v: h[f] })
      else if (!inParty.has(to) || !inParty.has(from)) old.push(f)     // (a note to or from someone who's gone)
    }
  }
  return { v: h.v, room, live, fins, old, sig, fields: Object.keys(h) }
}

const read = async (code) => unpack(await redis(['HGETALL', K(code)]))
const cas = (code, v, room, drop = []) => redis(['EVAL', CAS, 1, K(code), String(v), String(Number(v) + 1), JSON.stringify(room), String(TTL), ...drop])

// Read the party, change it, write it back; if someone else got there first, read again.
async function mutate(code, fn) {
  for (let t = 0; t < 6; t++) {
    const S = await read(code)
    if (!S) return { error: 'That party is gone.', status: 404 }
    const now = Date.now()
    const r = fn(S, now) || {}
    if (r.error) return r
    if (r.gone) { await redis(['DEL', K(code)]); return { gone: true } }
    const drop = r.drop || []
    if (Number(await cas(code, S.v, S.room, drop)) === 1) return { S, now, extra: r }
  }
  return { error: 'The party is busy. Try again.', status: 503 }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!URL_ || !TOKEN) { res.status(503).json({ error: 'Racing is not set up on this deployment.' }); return }
  if (req.method !== 'POST') {
    // (how a party's games say their links are doing, for whoever has its code)
    const q = String((req.query && req.query.diag) || '').toUpperCase()
    if (CODE_RE.test(q)) {
      try { const S = await read(q); res.status(S ? 200 : 404).json(S ? { ...diag(S.room, S.live, Date.now()), relay: !!(TURN_ID && TURN_TOKEN) || !!process.env.RACE_ICE } : { error: 'No party has that code.' }) }
      catch (e) { res.status(500).json({ error: String((e && e.message) || e) }) }
      return
    }
    res.status(200).json({ ok: true, races: true, relay: !!(TURN_ID && TURN_TOKEN) || !!process.env.RACE_ICE }); return
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const a = String(body.a || 'poll')
    const fail = (status, error) => res.status(status).json({ error })

    // ---- start a party --------------------------------------------------------
    if (a === 'create') {
      const now = Date.now(), id = newId()
      for (let t = 0; t < 10; t++) {
        const code = makeCode()
        const room = newRoom(code, now)
        addPlayer(room, id, body.name, now)
        if (Number(await redis(['EVAL', CREATE, 1, K(code), JSON.stringify(room), String(TTL)])) === 1) {
          res.status(200).json({ ...view(room, {}, {}, id, now), key: keyFor(code, id), ice: await iceFor() })
          return
        }
      }
      return fail(503, 'Could not open a party. Try again.')
    }

    const code = String(body.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
    if (!CODE_RE.test(code)) return fail(400, 'That isn’t a party code (four letters).')

    // ---- join one (or come back to it) -----------------------------------------
    if (a === 'join') {
      const back = ID_RE.test(String(body.id || '')) && body.key === keyFor(code, body.id)
      const id = back ? body.id : newId()
      // (someone coming back keeps what their game last said: a reload mid-hole still has its flaps)
      const r = await mutate(code, (S, now) => {
        const add = addPlayer(S.room, id, body.name, now)
        if (add.error) return add
      })
      if (r.error) return fail(r.status || 400, r.status === 404 ? 'No party has that code.' : r.error)
      res.status(200).json({ ...view(r.S.room, r.S.live, r.S.fins, id, r.now), key: keyFor(code, id), ice: await iceFor() })
      return
    }

    const id = String(body.id || '')
    if (!ID_RE.test(id) || body.key !== keyFor(code, id)) return fail(403, 'Join the party first.')

    // ---- leave ----------------------------------------------------------------
    if (a === 'leave') {
      const r = await mutate(code, (S) => {
        removePlayer(S.room, id)
        if (!S.room.players.length) return { gone: true }
        return { drop: ['p:' + id, ...S.fields.filter((f) => f.startsWith('s:') && f.split(':').slice(1).includes(id))] }
      })
      if (r.error && r.status !== 404) return fail(r.status || 400, r.error)
      res.status(200).json({ ok: true, left: true })
      return
    }

    // ---- the host starts the vote, or takes everyone back to the lobby -----------
    if (a === 'start' || a === 'lobby') {
      const r = await mutate(code, (S, now) => {
        if (S.room.host !== id) return { error: 'Only the host can do that.', status: 403 }
        if (a === 'start') {
          if (S.room.phase !== 'lobby' && S.room.phase !== 'final') return { error: 'A race is already on.', status: 409 }
          const st = startVote(S.room, S.live, body.worlds, now)
          if (st.error) return st
        } else {
          if (S.room.phase !== 'final') return { error: 'The race isn’t over yet.', status: 409 }
          toLobby(S.room)
        }
        // the last match's finishes aren't needed any more
        return { drop: S.fields.filter((f) => f.startsWith('d:')) }
      })
      if (r.error) return fail(r.status || 400, r.error)
      res.status(200).json(view(r.S.room, r.S.live, {}, id, r.now))
      return
    }

    // ---- poll: say where I am, hear where everyone is --------------------------
    const now = Date.now()
    const mine = body.me ? cleanLive(body.me, now) : null
    const fv = mine && body.fin ? finValue(body.fin, now) : null
    // (notes for the other games: a few at a time, each bounded)
    const notes = cleanNotes(body.sig, id)
    const got = await redis(['EVAL', POLL, 1, K(code), mine ? 'p:' + id : '', mine ? JSON.stringify(mine) : '',
      fv ? finField(mine.m, mine.h, id) : '', fv || '', String(TTL), 's:' + id + ':', ...notes.flatMap((n) => ['s:' + n.to + ':' + id, n.v])])
    let S = got ? unpack(got, id) : null
    if (!S) return fail(404, 'That party is gone.')
    const sig = S.sig
    if (!S.room.players.some((p) => p.id === id)) return fail(410, 'You’re not in that party any more.')
    const was = S.room.match + ':' + S.room.hole
    const step = advance(S.room, S.live, S.fins, now)
    if (step.changed) {
      const drop = step.clear ? S.fields.filter((f) => f.startsWith('d:')) : S.old
      if (Number(await cas(code, S.v, S.room, drop)) !== 1) {
        S = await read(code)                 // someone else moved it along first: theirs stands
        if (!S) return fail(404, 'That party is gone.')
      } else if (S.room.match + ':' + S.room.hole !== was) S.fins = {}   // (a new hole: nobody's in yet)
    }
    const out = view(S.room, S.live, S.fins, id, now)
    if (sig.length) out.sig = sig
    res.status(200).json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
