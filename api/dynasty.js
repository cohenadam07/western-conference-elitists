// api/dynasty.js — crowd-sourced dynasty rankings, backed by Upstash Redis (Vercel KV),
// the same store behind api/trending.js and api/leaderboard.js. Until KV is configured this
// returns { configured: false } and the page falls back to the static seed board, so the
// tab always renders something. The pool syncs additively on read, so a new draft class
// appears without touching a price the crowd has already set.
//
// THE MODEL
// A submitted ranking of four players is not one datapoint, it is six pairwise results
// (1>2, 1>3, 1>4, 2>3, 2>4, 3>4). Each pair runs through an Elo update, so a player's value
// is a price set by head-to-head demand rather than an average of raw positions — beating
// someone far above you moves you a lot, beating someone far below you moves you barely at
// all. That is what makes it behave like a stock instead of a poll.
//
// MOMENTUM
// A player who keeps landing first (or keeps landing last) is repriced in bigger jumps: we
// track a signed streak of extreme finishes and scale that player's K-factor, quadratically,
// so a run has to be sustained before it earns a real move. The same streak also widens their
// matchmaking — a hot player gets drawn against opponents further up the board, so the crowd
// is asked the harder question rather than re-confirming one it has already answered.
//
// KEYS
//   dyn:rating           ZSET  pid -> rating (the live price)
//   dyn:prev             HASH  pid -> rating snapshot, rolled once a day (movement arrows)
//   dyn:streak           HASH  pid -> signed run of extreme finishes (+first / -last)
//   dyn:seen             HASH  pid -> times shown (sample size behind a price)
//   dyn:n                STR   all-time pick count
//   dyn:recent           LIST  last 50 submitted picks, newest first
//   dyn:g:<nonce>        STR   the group we served, 10 min TTL — a submission must match one
//   dyn:daily:<day>      STR   that day's four ids (same for everyone)
//   dyn:daily:<day>:res  HASH  pid -> "rankSum:count" for the post-submit averages
//   dyn:daily:<day>:u    SET   client ids that already played today (one attempt each)
//   dyn:rl:<ip>:<min>    STR   per-minute rate limit
//   dyn:lob:<code>       HASH  a lobby: group, host, status, createdAt, result
//   dyn:lob:<code>:m     HASH  uid -> display name (members)
//   dyn:lob:<code>:s     HASH  uid -> submitted order

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const GROUP = 4                 // players per pick
// A single ranking should nudge a settled player, not relocate him. K_BASE is the step for
// an established asset with no momentum; two multipliers sit on top of it:
//
//   momentum   1x -> 3x, but QUADRATIC in the streak, so two results in a row barely register
//              and only a sustained run earns a real jump. This is the "unless they have a lot
//              of momentum" clause: the crowd has to keep saying it.
//   provisional up to 2.5x while a player has almost no picks behind him, decaying to 1x by
//              PROVISIONAL_N. Standard Elo practice, and it is what lets a mis-seeded rookie
//              find his level in a few books instead of a few hundred — without which a low
//              K_BASE would freeze the seed's mistakes in place.
const K_BASE = 10
const K_MOMENTUM_MAX = 3.0
const K_PROVISIONAL_MAX = 2.5
const PROVISIONAL_N = 40        // picks after which a player is considered settled
const STREAK_CAP = 5
const RECENT_KEEP = 50
const RATE_PER_MIN = 40         // picks per IP per minute
const BOARD_MAX = 600         // must exceed the pool, or the tail is unreachable
const NONCE_TTL = 600           // a served group is submittable for 10 minutes

const ID_RE = /^[0-9]{1,12}$/
const NONCE_RE = /^[a-z0-9]{8,40}$/i

// ---------------------------------------------------------------- lobbies
// A room where everyone ranks the SAME four and the room's answer settles as one result.
//
// LOBBY_W_CAP is the whole safety story, so it is worth being explicit about. A room's vote
// is worth sqrt(members) x agreement single votes, capped here. sqrt because the tenth person
// to say the same thing is not as informative as the second; agreement because a room split
// four ways has told us nothing and should move nothing; and the cap because `uid` is a
// localStorage string — anyone can mint a hundred of them in a loop. With the cap, the worst
// a brigade achieves is six ordinary votes, which the board absorbs. Without it, the same
// brigade owns the market.
const LOBBY_TTL = 6 * 3600      // rooms are an evening's argument, not a fixture
const LOBBY_MAX = 200           // members per room
const LOBBY_W_CAP = 6           // max single-votes one room can be worth, globally
const LOBBY_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/          // no O/0/I/L/1 — these get read aloud
const NAME_MAX = 24

async function redis(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

// Upstash pipeline: one round trip for many commands. Returns an array of results.
async function pipe(cmds) {
  if (!cmds.length) return []
  const r = await fetch(URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  if (!r.ok) throw new Error('redis pipeline ' + r.status)
  return (await r.json()).map((x) => x.result)
}

const dayKey = (d = new Date()) =>
  '' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0')

const ipOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'anon'

// Deterministic per-day shuffle so every visitor gets the identical daily group.
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashStr = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

async function rateLimited(ip) {
  const key = 'dyn:rl:' + ip + ':' + Math.floor(Date.now() / 60000)
  const [n] = await pipe([['INCR', key], ['EXPIRE', key, 120]])
  return Number(n) > RATE_PER_MIN
}

// ---------------------------------------------------------------- seeding
// The board is empty until the Hashtag Basketball baseline is installed. Rather than a
// protected admin route and a secret to manage, seed lazily on first read from the static
// file this deployment already serves. ZADD sets (not increments) fixed scores, so two
// requests racing to seed converge on the same board instead of doubling it; and because
// live ratings are ZINCRBY'd on top, a re-seed can never silently reset crowd work — the
// ZCARD guard means it only ever runs while the board is genuinely empty.
let poolCache = null              // module scope: warm lambdas skip the fetch entirely

async function ensureSeeded(req) {
  const n = Number(await redis(['ZCARD', 'dyn:rating']))
  if (n > 0 && poolCache && n >= poolCache.length) return n   // nothing new to add
  let players = poolCache
  if (!players) {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const r = await fetch(`${proto}://${host}/dynasty/players.json`)
    if (!r.ok) return n
    // A protected preview answers this with the SSO login page: fetch follows the 302, so
    // the status is a cheerful 200 and only the content type gives it away. Parsing that as
    // JSON throws and takes the whole endpoint down with it, which reads as the board being
    // unconfigured rather than unreachable. Seeding is optional — bail and keep serving.
    if (!(r.headers.get('content-type') || '').includes('json')) return n
    const doc = await r.json().catch(() => null)
    if (!doc) return n
    players = (doc.players || []).filter((p) => p.id != null)
    if (!players.length) return n
    poolCache = players
  }
  if (n >= players.length) return n

  // ZADD NX adds only members that are absent, so a rookie class can be dropped into a live
  // board without disturbing a single price the crowd has already set. Re-running is a no-op.
  const prevFlat = await redis(['HGETALL', 'dyn:prev'])
  const hasPrev = new Set()
  for (let i = 0; i + 1 < (prevFlat || []).length; i += 2) hasPrev.add(prevFlat[i])

  for (let i = 0; i < players.length; i += 120) {
    const chunk = players.slice(i, i + 120)
    const zadd = ['ZADD', 'dyn:rating', 'NX']
    const hset = ['HSET', 'dyn:prev']
    let anyPrev = false
    chunk.forEach((p) => {
      zadd.push(String(p.rating), String(p.id))
      // only seed a baseline for players who have none, or an existing asset would have its
      // 24h reference quietly reset to today and show flat when it had actually moved
      if (!hasPrev.has(String(p.id))) { hset.push(String(p.id), String(p.rating)); anyPrev = true }
    })
    await pipe(anyPrev ? [zadd, hset] : [zadd])
  }
  return players.length
}

// ---------------------------------------------------------------- board
async function readBoard(limit) {
  const [flat, prev, streak, seen, total] = await pipe([
    ['ZREVRANGE', 'dyn:rating', 0, Math.max(0, limit - 1), 'WITHSCORES'],
    ['HGETALL', 'dyn:prev'],
    ['HGETALL', 'dyn:streak'],
    ['HGETALL', 'dyn:seen'],
    ['GET', 'dyn:n'],
  ])
  const toMap = (f) => {
    const m = {}
    for (let i = 0; i + 1 < (f || []).length; i += 2) m[f[i]] = f[i + 1]
    return m
  }
  const P = toMap(prev), S = toMap(streak), N = toMap(seen)
  const rows = []
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    const id = flat[i], rating = Number(flat[i + 1])
    const was = P[id] === undefined ? null : Number(P[id])
    rows.push({
      id,
      rating: Math.round(rating),
      rank: rows.length + 1,
      delta: was === null ? 0 : Math.round(rating - was),
      streak: Number(S[id] || 0),
      seen: Number(N[id] || 0),
    })
  }
  // rank movement needs yesterday's ORDER, not just yesterday's price
  const prevOrder = Object.keys(P).sort((a, b) => Number(P[b]) - Number(P[a]))
  const prevRank = {}
  prevOrder.forEach((id, i) => { prevRank[id] = i + 1 })
  rows.forEach((r) => { r.rankDelta = prevRank[r.id] ? prevRank[r.id] - r.rank : 0 })
  return { rows, total: Number(total || 0) }
}

// ---------------------------------------------------------------- lobby helpers
const LOBBY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const makeCode = () => Array.from({ length: 4 },
  () => LOBBY_ALPHABET[Math.floor(Math.random() * LOBBY_ALPHABET.length)]).join('')

const lobK = (code, suffix = '') => 'dyn:lob:' + code + suffix

// The room's four, drawn the same deterministic way the daily group is drawn — seeded on the
// code instead of the date. Same guarantee (everyone who opens this room sees the identical
// four) with no new mechanism, and it means a code is the only state a person needs to join.
function lobbyGroup(code, ids) {
  const rnd = mulberry(hashStr('wce-lobby-' + code))
  const poolSize = Math.min(ids.length, 120)         // top of the board: a real argument
  const picks = []
  let guard = 0
  while (picks.length < GROUP && guard++ < 500) {
    const c = ids[Math.floor(rnd() * poolSize)]
    if (!picks.includes(c)) picks.push(c)
  }
  return picks
}

// Borda across every submitted ranking, plus how much the room actually agreed.
//
// Points are (GROUP-1) for a first-place vote down to 0 for last, so a player's total is his
// support. `agreement` is the spread of those totals measured against the spread a unanimous
// room would produce: 1 when everyone submitted the identical order, 0 when the room split so
// evenly that every player drew level. That zero is the case worth naming — four friends
// picking four different guys is the example that started this, and it falls out of the maths
// rather than needing a rule of its own. Nobody agreed, so nothing moves.
export function borda(orders, group) {
  const pts = {}
  group.forEach((id) => { pts[id] = 0 })
  orders.forEach((o) => o.forEach((id, i) => {
    if (pts[id] !== undefined) pts[id] += (GROUP - 1 - i)
  }))
  const n = orders.length || 1
  const consensus = group.slice().sort((a, b) => (pts[b] - pts[a]) || (a < b ? -1 : 1))

  const mean = n * (GROUP - 1) / 2
  let dev = 0
  group.forEach((id) => { dev += Math.abs(pts[id] - mean) })
  let maxDev = 0
  for (let r = 0; r < GROUP; r++) maxDev += Math.abs(n * (GROUP - 1 - r) - mean)
  const agreement = maxDev > 0 ? Math.min(1, dev / maxDev) : 0

  return { consensus, pts, agreement }
}

// What the room is worth as a multiplier on one ordinary vote. See LOBBY_W_CAP above.
export const lobbyWeight = (n, agreement) =>
  Math.min(LOBBY_W_CAP, Math.sqrt(Math.max(1, n)) * agreement)

// Upstash returns hashes as a flat [k, v, k, v] array.
function unflatten(flat) {
  const o = {}
  for (let i = 0; i + 1 < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]
  return o
}

// Same filter api/leaderboard.js uses — these names are shown to the whole room.
const nameMatcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
function cleanName(raw) {
  const s = String(raw || '').replace(/[^\w \-.'#!]/g, '').trim().slice(0, NAME_MAX)
  if (!s) return 'Anonymous'
  try {
    if (nameMatcher.hasMatch(s) || nameMatcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, ''))) return 'Anonymous'
  } catch { /* filter unavailable — fall through with the stripped name */ }
  return s
}

// Settle a room: one consensus, one Elo update, weighted as described at LOBBY_W_CAP.
// Deliberately a single application rather than one per member — n members re-answering the
// same question is not n independent results, which is the same reasoning behind the daily
// group's damping further down.
async function settleLobby(code, group, orders) {
  const { consensus, pts, agreement } = borda(orders, group)
  const weight = lobbyWeight(orders.length, agreement)

  const [scores, sflat, nflat] = await pipe([
    ['ZMSCORE', 'dyn:rating', ...consensus],
    ['HGETALL', 'dyn:streak'],
    ['HGETALL', 'dyn:seen'],
  ])
  const ratings = {}
  consensus.forEach((id, i) => { ratings[id] = scores && scores[i] != null ? Number(scores[i]) : 1500 })
  const streaks = unflatten(sflat), seenCounts = unflatten(nflat)

  const delta = eloUpdates(consensus, ratings, streaks, seenCounts)
  Object.keys(delta).forEach((k) => { delta[k] *= weight })

  const cmds = []
  // A room that could not agree has produced no information, so it writes nothing at all —
  // no rating change, no streak flip, no seen count. It still gets its result screen.
  if (weight > 0) {
    consensus.forEach((id, idx) => {
      cmds.push(['ZINCRBY', 'dyn:rating', delta[id].toFixed(4), id])
      cmds.push(['HINCRBY', 'dyn:seen', id, 1])
      const prev = Number(streaks[id] || 0)
      let next = 0
      if (idx === 0) next = prev > 0 ? prev + 1 : 1
      else if (idx === GROUP - 1) next = prev < 0 ? prev - 1 : -1
      cmds.push(['HSET', 'dyn:streak', id, String(Math.max(-STREAK_CAP * 2, Math.min(STREAK_CAP * 2, next)))])
    })
    cmds.push(['INCR', 'dyn:n'])
    cmds.push(['LPUSH', 'dyn:recent', JSON.stringify({ order: consensus, ts: Date.now(), lobby: code })])
    cmds.push(['LTRIM', 'dyn:recent', 0, RECENT_KEEP - 1])
  }
  const result = {
    consensus, pts, agreement: Number(agreement.toFixed(3)), weight: Number(weight.toFixed(2)),
    voters: orders.length,
    moved: consensus.map((id) => ({
      id, delta: Math.round(delta[id] || 0), rating: Math.round(ratings[id] + (delta[id] || 0)),
    })),
  }
  cmds.push(['HSET', lobK(code), 'status', 'settled', 'result', JSON.stringify(result)])
  cmds.push(['EXPIRE', lobK(code), LOBBY_TTL])
  await pipe(cmds)
  return { result }
}

// ---------------------------------------------------------------- matchmaking
// Anchor on a random player, then draw the rest from a rating band around them. A player on
// a streak gets a wider band: the crowd is asked to price them against tougher company
// instead of re-answering a question it has already settled.
export function buildGroup(ids, ratings, streaks, seen = {}) {
  const n = ids.length
  // Sample a few candidates and anchor on the least-priced of them. Pure random anchoring
  // leaves most of a 350-player pool barely sampled while a handful get asked repeatedly —
  // demand is only meaningful if the whole board is actually being traded.
  let anchorIdx = Math.floor(Math.random() * n)
  for (let t = 0; t < 5; t++) {
    const c = Math.floor(Math.random() * n)
    if (Number(seen[ids[c]] || 0) < Number(seen[ids[anchorIdx]] || 0)) anchorIdx = c
  }
  const anchor = ids[anchorIdx]
  const hot = Math.min(STREAK_CAP, Math.abs(Number(streaks[anchor] || 0)))
  const band = Math.round(12 + hot * 14)            // neighbours by rank distance
  const lo = Math.max(0, anchorIdx - band)
  const hi = Math.min(n - 1, anchorIdx + band)
  const pool = []
  for (let i = lo; i <= hi; i++) if (i !== anchorIdx) pool.push(ids[i])
  const picked = [anchor]
  while (picked.length < GROUP && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  }
  // tiny pools (shouldn't happen with 348) — top up from anywhere
  while (picked.length < GROUP) {
    const c = ids[Math.floor(Math.random() * n)]
    if (!picked.includes(c)) picked.push(c)
  }
  for (let i = picked.length - 1; i > 0; i--) {     // present in random order
    const j = Math.floor(Math.random() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }
  return picked
}

async function orderedIds() {
  const flat = await redis(['ZREVRANGE', 'dyn:rating', 0, BOARD_MAX - 1, 'WITHSCORES'])
  const ids = [], ratings = {}
  for (let i = 0; i + 1 < (flat || []).length; i += 2) { ids.push(flat[i]); ratings[flat[i]] = Number(flat[i + 1]) }
  return { ids, ratings }
}

// ---------------------------------------------------------------- pick submission
export function eloUpdates(order, ratings, streaks, seen = {}) {
  const delta = {}
  order.forEach((id) => { delta[id] = 0 })
  const kOf = (id) => {
    const st = Math.min(STREAK_CAP, Math.abs(Number(streaks[id] || 0)))
    const momentum = 1 + (K_MOMENTUM_MAX - 1) * Math.pow(st / STREAK_CAP, 2)
    const n = Number(seen[id] || 0)
    const provisional = 1 + (K_PROVISIONAL_MAX - 1) * Math.max(0, 1 - n / PROVISIONAL_N)
    return K_BASE * momentum * provisional
  }
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const w = order[i], l = order[j]
      const rw = ratings[w] ?? 1500, rl = ratings[l] ?? 1500
      const exp = 1 / (1 + Math.pow(10, (rl - rw) / 400))
      const k = (kOf(w) + kOf(l)) / 2
      const move = k * (1 - exp)
      delta[w] += move
      delta[l] -= move
    }
  }
  return delta
}

export default async function handler(req, res) {
  if (!URL || !TOKEN) { res.status(200).json({ configured: false }); return }
  res.setHeader('Cache-Control', 'no-store')

  try {
    const action = String((req.query && req.query.action) || 'board')

    // ---- lobbies ----------------------------------------------------------
    // dyn:lob:<code>    HASH  group, host, status, createdAt, result (JSON, once settled)
    // dyn:lob:<code>:m  HASH  uid -> display name
    // dyn:lob:<code>:s  HASH  uid -> submitted order, comma separated
    if (action.startsWith('lobby')) {
      const body = req.method === 'POST'
        ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))
        : {}
      const code = String((req.query.code ?? body.code) || '').toUpperCase().slice(0, 4)
      const uid = String((req.query.uid ?? body.uid) || '').slice(0, 64)
      const name = cleanName(body.name)
      if (!uid) { res.status(400).json({ error: 'no uid' }); return }

      if (req.method === 'POST' && action === 'lobby-create') {
        if (await rateLimited(ipOf(req))) { res.status(429).json({ error: 'slow down' }); return }
        await ensureSeeded(req)
        const { ids } = await orderedIds()
        if (!ids.length) { res.status(200).json({ seeded: false }); return }
        // Collide-and-retry rather than trusting 923k combinations: rooms are short-lived and
        // a collision would drop two groups into one argument.
        let made = ''
        for (let t = 0; t < 8 && !made; t++) {
          const c = makeCode()
          const [ok] = await pipe([['HSETNX', lobK(c), 'host', uid]])
          if (Number(ok) === 1) made = c
        }
        if (!made) { res.status(503).json({ error: 'could not allocate a code' }); return }
        const group = lobbyGroup(made, ids)
        await pipe([
          ['HSET', lobK(made), 'group', group.join(','), 'status', 'open', 'createdAt', String(Date.now())],
          ['HSET', lobK(made, ':m'), uid, name],
          ['EXPIRE', lobK(made), LOBBY_TTL],
          ['EXPIRE', lobK(made, ':m'), LOBBY_TTL],
        ])
        // Return the full room shape, not just the code: the creator is already a member, and
        // a response missing roster/status leaves the host staring at "0/0 ranked" until the
        // first poll lands.
        res.status(200).json({
          ok: true, code: made, group, host: true, status: 'open',
          roster: { [uid]: name }, submitted: [], result: null,
        })
        return
      }

      if (!LOBBY_CODE_RE.test(code)) { res.status(400).json({ error: 'bad code' }); return }
      const [meta, members, subs] = await pipe([
        ['HGETALL', lobK(code)], ['HGETALL', lobK(code, ':m')], ['HGETALL', lobK(code, ':s')],
      ])
      const m = unflatten(meta)
      if (!m.group) { res.status(404).json({ error: 'no such lobby' }); return }
      const roster = unflatten(members), submitted = unflatten(subs)
      const group = String(m.group).split(',')

      if (req.method === 'POST' && action === 'lobby-join') {
        if (!roster[uid] && Object.keys(roster).length >= LOBBY_MAX) {
          res.status(409).json({ error: 'lobby full' }); return
        }
        if (!roster[uid]) {
          await pipe([['HSET', lobK(code, ':m'), uid, name], ['EXPIRE', lobK(code, ':m'), LOBBY_TTL]])
          roster[uid] = name
        }
      }

      if (req.method === 'POST' && action === 'lobby-submit') {
        const order = Array.isArray(body.order) ? body.order.map(String) : []
        if (m.status !== 'open') { res.status(409).json({ error: 'already settled' }); return }
        if (!roster[uid]) { res.status(403).json({ error: 'join first' }); return }
        if (order.length !== GROUP || new Set(order).size !== GROUP
            || !order.every((id) => group.includes(id))) {
          res.status(400).json({ error: 'bad order' }); return
        }
        await pipe([
          ['HSET', lobK(code, ':s'), uid, order.join(',')],
          ['EXPIRE', lobK(code, ':s'), LOBBY_TTL],
        ])
        submitted[uid] = order.join(',')
      }

      // Settle once every member present has ranked. The host can also close early via
      // lobby-close, because somebody always wanders off mid-argument.
      const everyoneIn = Object.keys(roster).length > 0
        && Object.keys(roster).every((u) => submitted[u])
      const wantClose = action === 'lobby-close' && uid === m.host
      if (m.status === 'open' && (everyoneIn || wantClose) && Object.keys(submitted).length > 0) {
        const settled = await settleLobby(code, group, Object.values(submitted).map((s) => s.split(',')))
        res.status(200).json({ ok: true, code, group, status: 'settled', roster, submitted: Object.keys(submitted), ...settled })
        return
      }

      res.status(200).json({
        ok: true, code, group, status: m.status || 'open', host: m.host === uid,
        roster, submitted: Object.keys(submitted),
        result: m.result ? JSON.parse(m.result) : null,
      })
      return
    }

    // ---- GET board (+ totals + recent feed) -------------------------------
    if (req.method === 'GET' && action === 'board') {
      await ensureSeeded(req)
      const limit = Math.min(BOARD_MAX, Math.max(1, Number(req.query.limit) || 100))
      const [{ rows, total }, recent] = await Promise.all([
        readBoard(limit),
        redis(['LRANGE', 'dyn:recent', 0, 9]),
      ])
      res.status(200).json({
        configured: true, seeded: rows.length > 0, total, board: rows,
        recent: (recent || []).map((s) => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean),
      })
      return
    }

    // ---- GET next group (daily first, then endless) -----------------------
    if (req.method === 'GET' && action === 'next') {
      await ensureSeeded(req)
      const uid = String(req.query.uid || '').slice(0, 64)
      const day = dayKey()
      const { ids, ratings } = await orderedIds()
      if (!ids.length) { res.status(200).json({ configured: true, seeded: false }); return }

      const [dailyRaw, played] = await pipe([
        ['GET', 'dyn:daily:' + day],
        uid ? ['SISMEMBER', 'dyn:daily:' + day + ':u', uid] : ['GET', 'dyn:__none'],
      ])
      let group, isDaily = false
      const alreadyPlayedDaily = Number(played) === 1

      if (!alreadyPlayedDaily) {
        isDaily = true
        if (dailyRaw) {
          group = String(dailyRaw).split(',')
        } else {
          const rnd = mulberry(hashStr('wce-dynasty-' + day))
          const picks = []
          // daily draws from the top of the board so it's a question everyone has an opinion on
          const poolSize = Math.min(ids.length, 120)
          while (picks.length < GROUP) {
            const c = ids[Math.floor(rnd() * poolSize)]
            if (!picks.includes(c)) picks.push(c)
          }
          group = picks
          await pipe([['SET', 'dyn:daily:' + day, group.join(','), 'EX', 172800]])
        }
      } else {
        const [sflat, nflat] = await pipe([['HGETALL', 'dyn:streak'], ['HGETALL', 'dyn:seen']])
        const streaks = {}, seen = {}
        for (let i = 0; i + 1 < (sflat || []).length; i += 2) streaks[sflat[i]] = sflat[i + 1]
        for (let i = 0; i + 1 < (nflat || []).length; i += 2) seen[nflat[i]] = nflat[i + 1]
        group = buildGroup(ids, ratings, streaks, seen)
      }

      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
      await pipe([['SET', 'dyn:g:' + nonce, group.join(',') + '|' + (isDaily ? 'd' : 'e'), 'EX', NONCE_TTL]])
      res.status(200).json({ configured: true, seeded: true, nonce, daily: isDaily, group, day })
      return
    }

    // ---- POST a completed ranking ----------------------------------------
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const nonce = String(b.nonce || '')
      const order = Array.isArray(b.order) ? b.order.map(String) : []
      const uid = String(b.uid || '').slice(0, 64)
      if (!NONCE_RE.test(nonce) || order.length !== GROUP || !order.every((x) => ID_RE.test(x))) {
        res.status(400).json({ error: 'bad payload' }); return
      }
      if (new Set(order).size !== GROUP) { res.status(400).json({ error: 'duplicate ids' }); return }

      const ip = ipOf(req)
      if (await rateLimited(ip)) { res.status(429).json({ error: 'slow down' }); return }

      // the group must be one we actually served, and the submission a permutation of it
      const stored = await redis(['GET', 'dyn:g:' + nonce])
      if (!stored) { res.status(409).json({ error: 'expired' }); return }
      const [gs, kind] = String(stored).split('|')
      const served = gs.split(',')
      if (served.length !== GROUP || !order.every((id) => served.includes(id))) {
        res.status(400).json({ error: 'group mismatch' }); return
      }
      await redis(['DEL', 'dyn:g:' + nonce])              // one submission per served group

      const day = dayKey()
      const isDaily = kind === 'd'
      let dailyN = 0
      if (isDaily) {
        if (uid) {
          const [added] = await pipe([['SADD', 'dyn:daily:' + day + ':u', uid], ['EXPIRE', 'dyn:daily:' + day + ':u', 172800]])
          if (Number(added) === 0) { res.status(409).json({ error: 'daily already played' }); return }
        }
        const [c] = await pipe([['INCR', 'dyn:daily:' + day + ':cnt'], ['EXPIRE', 'dyn:daily:' + day + ':cnt', 172800]])
        dailyN = Number(c || 1)
      }
      // Everyone's first pick of the day is the SAME four players, so without this the daily
      // group absorbs one vote per visitor while the rest of the board sees almost none — four
      // players would rocket on volume alone. Repeating an identical matchup is not new
      // information, it is the same question asked again, so each further daily vote is worth
      // less: the crowd's answer converges instead of compounding. Endless picks are unweighted.
      const weight = isDaily ? 1 / (1 + (dailyN - 1) / 10) : 1

      // current prices + streaks for the four
      const [scores, sflat, nflat] = await pipe([
        ['ZMSCORE', 'dyn:rating', ...order],
        ['HGETALL', 'dyn:streak'],
        ['HGETALL', 'dyn:seen'],
      ])
      const seenCounts = {}
      for (let i = 0; i + 1 < (nflat || []).length; i += 2) seenCounts[nflat[i]] = nflat[i + 1]
      const ratings = {}
      order.forEach((id, i) => { ratings[id] = scores && scores[i] != null ? Number(scores[i]) : 1500 })
      const streaks = {}
      for (let i = 0; i + 1 < (sflat || []).length; i += 2) streaks[sflat[i]] = sflat[i + 1]

      const delta = eloUpdates(order, ratings, streaks, seenCounts)
      if (weight !== 1) Object.keys(delta).forEach((k) => { delta[k] *= weight })

      const cmds = []
      order.forEach((id, idx) => {
        cmds.push(['ZINCRBY', 'dyn:rating', delta[id].toFixed(4), id])
        cmds.push(['HINCRBY', 'dyn:seen', id, 1])
        // streak: +1 for finishing first, -1 for last, reset in the middle. Same direction
        // compounds; the opposite result flips it rather than merely decrementing.
        const prev = Number(streaks[id] || 0)
        let next = 0
        if (idx === 0) next = prev > 0 ? prev + 1 : 1
        else if (idx === GROUP - 1) next = prev < 0 ? prev - 1 : -1
        cmds.push(['HSET', 'dyn:streak', id, String(Math.max(-STREAK_CAP * 2, Math.min(STREAK_CAP * 2, next)))])
        if (isDaily) cmds.push(['HINCRBY', 'dyn:daily:' + day + ':res', id + ':sum', idx + 1])
        if (isDaily) cmds.push(['HINCRBY', 'dyn:daily:' + day + ':res', id + ':n', 1])
      })
      cmds.push(['INCR', 'dyn:n'])
      cmds.push(['LPUSH', 'dyn:recent', JSON.stringify({ order, ts: Date.now(), daily: isDaily })])
      cmds.push(['LTRIM', 'dyn:recent', 0, RECENT_KEEP - 1])
      if (isDaily) cmds.push(['EXPIRE', 'dyn:daily:' + day + ':res', 172800])
      const out = await pipe(cmds)
      const total = Number(out[out.length - (isDaily ? 4 : 3)] || 0)

      let averages = null
      if (isDaily) {
        const flat = await redis(['HGETALL', 'dyn:daily:' + day + ':res'])
        const m = {}
        for (let i = 0; i + 1 < (flat || []).length; i += 2) m[flat[i]] = Number(flat[i + 1])
        averages = order.map((id) => ({
          id, avg: m[id + ':n'] ? m[id + ':sum'] / m[id + ':n'] : null, n: m[id + ':n'] || 0,
        })).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9))
      }

      res.status(200).json({
        ok: true, daily: isDaily, total,
        moved: order.map((id) => ({ id, delta: Math.round(delta[id]), rating: Math.round(ratings[id] + delta[id]) })),
        averages,
      })
      return
    }

    // ---- POST-less seeding: install the static baseline once ---------------
    if (req.method === 'GET' && action === 'seedcheck') {
      const n = await redis(['ZCARD', 'dyn:rating'])
      res.status(200).json({ configured: true, count: Number(n || 0) })
      return
    }

    res.status(405).json({ error: 'method' })
  } catch (e) {
    res.status(200).json({ configured: false, error: String(e && e.message || e) })
  }
}
