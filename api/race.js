// api/race.js — live Flap Hoops races. A party plays a whole world; each hole is a race,
// places score points, and the highest total after the last hole wins the match.
//
// WHAT TRAVELS. Not ball positions — flaps. `src/lib/hoopsPhysics.js` is deterministic at a
// fixed 120Hz, so a player's entire run is described by which buttons they pressed and on
// which step. Every client replays everyone else's flaps through that identical module and
// gets a pixel-identical ball, at full framerate, with no interpolation. It is a few bytes
// per flap instead of a position broadcast ten times a second, and the same property lets
// this file re-run a claimed finish and reject one that does not reproduce.
//
// Redis (the same Upstash the rest of the site uses):
//   race:<code>            HASH  host, world, status, hole, startAt, firstAt, deadline
//   race:<code>:m          HASH  uid -> display name
//   race:<code>:pts        HASH  uid -> points so far
//   race:<code>:h<n>:in    HASH  uid -> "12:1,45:-1,90:1"   (that player's flaps, this hole)
//   race:<code>:h<n>:fin   HASH  uid -> "<steps>:<flaps>"   (verified finishes)
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { LEVELS, WORLDS, DEFAULTS, simulate } from '../src/lib/hoopsPhysics.js'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const TTL = 4 * 3600
const MAX_PLAYERS = 8            // ghosts stay readable, and everyone gets a colour
const MIN_START = 2
/* Lead-in before step 0. Long enough for the opening shot — hold on the hoop, pan to the
   ball — and then the 3-2-1. The client derives those phases from this, so it ships in the
   payload rather than being hardcoded in two places that can quietly drift apart. */
const COUNTDOWN_MS = 5200
const CHASE_MS = 20000           // once someone sinks, this is how long the rest have
const HOLE_CAP_MS = 120000       // nobody has sunk it and the hole has to end sometime
const POINTS = [10, 6, 4, 3, 2, 1]   // by finishing place; anyone unfinished scores nothing
const MAX_INPUTS = 400           // a run is ~10-30 flaps; this is a wildly generous ceiling
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const NAME_MAX = 18

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
function cleanName(raw) {
  const s = String(raw || '').replace(/[^\w \-.'#!]/g, '').trim().slice(0, NAME_MAX)
  if (!s) return 'Anonymous'
  try {
    if (matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, ''))) return 'Anonymous'
  } catch { /* filter unavailable — the stripped name still stands */ }
  return s
}

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}
async function pipe(cmds) {
  if (!cmds.length) return []
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  if (!r.ok) throw new Error('redis pipeline ' + r.status)
  return (await r.json()).map((x) => x.result)
}
function unflatten(flat) {
  const o = {}
  for (let i = 0; i + 1 < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]
  return o
}

const K = (code, suffix = '') => 'race:' + code + suffix
const makeCode = () => Array.from({ length: 4 },
  () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

// holes of a world, as indices into LEVELS
const holesOf = (world) => LEVELS.map((L, i) => (L.world === world ? i : -1)).filter((i) => i >= 0)

/* "12:1,45:-1" -> [{s,d}]. Hostile input is the norm on a public endpoint, so this is strict:
   anything malformed yields an empty run rather than throwing mid-verification. */
function parseInputs(str) {
  const out = []
  for (const part of String(str || '').split(',')) {
    if (!part) continue
    const [s, d] = part.split(':')
    const step = Number(s), dir = Number(d)
    if (!Number.isInteger(step) || step < 0 || step > 100000) return null
    if (dir !== 1 && dir !== -1) return null
    out.push({ s: step, d: dir })
    if (out.length > MAX_INPUTS) return null
  }
  return out
}
const encodeInputs = (arr) => arr.map((i) => `${i.s}:${i.d}`).join(',')

/* Replay a claimed run. This is the whole anti-cheat story: the client says "I sank it on
   step 412 in 9 flaps"; we run its own inputs through the same physics and see. */
function verify(levelIndex, inputsStr) {
  const inputs = parseInputs(inputsStr)
  if (!inputs) return null
  const r = simulate(levelIndex, DEFAULTS, inputs, 40000)
  return r.sank ? { steps: r.steps, flaps: r.flaps } : null
}

/* Score a finished hole: sort by finishing step, hand out POINTS by place. Unfinished players
   score nothing — the incentive is to actually sink it, not to be tidily last. */
function scoreHole(finishes, roster) {
  const done = Object.entries(finishes)
    .map(([uid, v]) => { const [steps, flaps] = String(v).split(':').map(Number); return { uid, steps, flaps } })
    .filter((f) => Number.isFinite(f.steps))
    .sort((a, b) => a.steps - b.steps || a.flaps - b.flaps)
  const rows = done.map((f, i) => ({ ...f, place: i + 1, points: POINTS[i] ?? 0 }))
  for (const uid of Object.keys(roster)) {
    if (!rows.some((r) => r.uid === uid)) rows.push({ uid, steps: null, flaps: null, place: null, points: 0 })
  }
  return rows
}

export default async function handler(req, res) {
  if (!URL_ || !TOKEN) { res.status(503).json({ error: 'racing is not configured on this deployment' }); return }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const body = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))
      : {}
    const action = String((req.query && req.query.action) || 'state')
    const uid = String((req.query.uid ?? body.uid) || '').slice(0, 64)
    const code = String((req.query.code ?? body.code) || '').toUpperCase().slice(0, 4)
    if (!uid) { res.status(400).json({ error: 'no uid' }); return }

    // ---- create ------------------------------------------------------------
    if (req.method === 'POST' && action === 'create') {
      let made = ''
      for (let t = 0; t < 8 && !made; t++) {
        const c = makeCode()
        const [ok] = await pipe([['HSETNX', K(c), 'host', uid]])
        if (Number(ok) === 1) made = c
      }
      if (!made) { res.status(503).json({ error: 'could not allocate a code' }); return }
      const world = WORLDS[body.world] ? body.world : 'dallas'
      await pipe([
        ['HSET', K(made), 'world', world, 'status', 'lobby', 'hole', '-1',
          'startAt', '0', 'firstAt', '', 'deadline', '0'],
        ['HSET', K(made, ':m'), uid, cleanName(body.name)],
        ['HSET', K(made, ':pts'), uid, '0'],
        ['EXPIRE', K(made), TTL], ['EXPIRE', K(made, ':m'), TTL], ['EXPIRE', K(made, ':pts'), TTL],
      ])
      res.status(200).json({ ok: true, code: made, created: true })
      return
    }

    if (!CODE_RE.test(code)) { res.status(400).json({ error: 'bad code' }); return }
    let meta = unflatten(await redis(['HGETALL', K(code)]))
    if (!meta.status) { res.status(404).json({ error: 'no such party' }); return }
    const roster = unflatten(await redis(['HGETALL', K(code, ':m')]))
    let hole = Number(meta.hole)
    const holes = holesOf(meta.world)

    // ---- join --------------------------------------------------------------
    if (req.method === 'POST' && action === 'join') {
      if (!roster[uid]) {
        if (Object.keys(roster).length >= MAX_PLAYERS) { res.status(409).json({ error: 'party is full' }); return }
        if (meta.status !== 'lobby') { res.status(409).json({ error: 'that match already started' }); return }
        await pipe([
          ['HSET', K(code, ':m'), uid, cleanName(body.name)],
          ['HSET', K(code, ':pts'), uid, '0'],
          ['EXPIRE', K(code, ':m'), TTL], ['EXPIRE', K(code, ':pts'), TTL],
        ])
        roster[uid] = cleanName(body.name)
      }
    }

    // ---- host starts the match, or the next hole ---------------------------
    if (req.method === 'POST' && (action === 'start' || action === 'next')) {
      if (uid !== meta.host) { res.status(403).json({ error: 'only the host can do that' }); return }
      if (action === 'start' && Object.keys(roster).length < MIN_START) {
        res.status(409).json({ error: `need at least ${MIN_START} players` }); return
      }
      const nextHole = action === 'start' ? 0 : hole + 1
      if (nextHole >= holes.length) {
        await pipe([['HSET', K(code), 'status', 'finished'], ['EXPIRE', K(code), TTL]])
        meta.status = 'finished'
      } else {
        const startAt = Date.now() + COUNTDOWN_MS
        await pipe([
          ['DEL', K(code, `:h${nextHole}:in`)], ['DEL', K(code, `:h${nextHole}:fin`)],
          ['HSET', K(code), 'status', 'running', 'hole', String(nextHole),
            'startAt', String(startAt), 'firstAt', '', 'deadline', String(startAt + HOLE_CAP_MS)],
          ['EXPIRE', K(code), TTL],
        ])
        meta = { ...meta, status: 'running', hole: String(nextHole), startAt: String(startAt),
          firstAt: '', deadline: String(startAt + HOLE_CAP_MS) }
        hole = nextHole
      }
    }

    const inKey = K(code, `:h${hole}:in`), finKey = K(code, `:h${hole}:fin`)

    // ---- a flap ------------------------------------------------------------
    // The client sends its WHOLE input string every time rather than appending. Idempotent,
    // so a retried or out-of-order request can never interleave two players' flaps or
    // duplicate one, which an append-based design has to work hard to avoid.
    if (req.method === 'POST' && action === 'input') {
      if (meta.status !== 'running') { res.status(409).json({ error: 'no hole is running' }); return }
      if (!roster[uid]) { res.status(403).json({ error: 'join first' }); return }
      if (parseInputs(body.inputs) === null) { res.status(400).json({ error: 'bad inputs' }); return }
      await pipe([['HSET', inKey, uid, String(body.inputs || '')], ['EXPIRE', inKey, TTL]])
    }

    // ---- a claimed finish, verified by replay ------------------------------
    if (req.method === 'POST' && action === 'finish') {
      if (meta.status !== 'running') { res.status(409).json({ error: 'no hole is running' }); return }
      if (!roster[uid]) { res.status(403).json({ error: 'join first' }); return }
      const already = await redis(['HGET', finKey, uid])
      if (already) { res.status(409).json({ error: 'already finished' }); return }
      const v = verify(holes[hole], body.inputs)
      if (!v) { res.status(400).json({ error: 'that run does not replay as a make' }); return }
      const cmds = [
        ['HSET', inKey, uid, String(body.inputs || '')],
        ['HSET', finKey, uid, `${v.steps}:${v.flaps}`],
        ['EXPIRE', inKey, TTL], ['EXPIRE', finKey, TTL],
      ]
      // first one home starts the chase clock for everybody else
      if (!meta.firstAt) {
        const dl = Date.now() + CHASE_MS
        cmds.push(['HSET', K(code), 'firstAt', String(Date.now()), 'deadline', String(dl)])
        meta.firstAt = String(Date.now()); meta.deadline = String(dl)
      }
      await pipe(cmds)
    }

    // ---- lazily close the hole --------------------------------------------
    // Serverless has no timers, so whichever request arrives first past the deadline does the
    // scoring. Clients poll while a hole is live, so that lands within a second of the buzzer.
    let inputs = unflatten(await redis(['HGETALL', inKey]))
    let finishes = unflatten(await redis(['HGETALL', finKey]))
    let table = null
    if (meta.status === 'running' && hole >= 0) {
      const everyone = Object.keys(roster).length > 0 && Object.keys(roster).every((u) => finishes[u])
      const expired = Date.now() > Number(meta.deadline || 0)
      if (everyone || expired) {
        table = scoreHole(finishes, roster)
        const cmds = [['HSET', K(code), 'status', 'hole-done'], ['EXPIRE', K(code), TTL]]
        for (const row of table) if (row.points) cmds.push(['HINCRBY', K(code, ':pts'), row.uid, row.points])
        await pipe(cmds)
        meta.status = 'hole-done'
      }
    }

    const pts = unflatten(await redis(['HGETALL', K(code, ':pts')]))
    if (!table && (meta.status === 'hole-done' || meta.status === 'finished') && hole >= 0) {
      table = scoreHole(finishes, roster)
    }
    const standings = Object.keys(roster)
      .map((u) => ({ uid: u, name: roster[u], points: Number(pts[u] || 0) }))
      .sort((a, b) => b.points - a.points)

    res.status(200).json({
      ok: true, code, you: uid, host: meta.host === uid, world: meta.world,
      status: meta.status, hole, holeCount: holes.length,
      levelIndex: hole >= 0 ? holes[hole] : null,
      startAt: Number(meta.startAt || 0), deadline: Number(meta.deadline || 0), lead: COUNTDOWN_MS,
      firstAt: meta.firstAt ? Number(meta.firstAt) : null,
      now: Date.now(),                 // lets a client correct for its own clock skew
      roster, inputs, finishes, table, standings,
      winner: meta.status === 'finished' ? (standings[0] || null) : null,
    })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}

export { parseInputs, encodeInputs, scoreHole, holesOf, POINTS }
