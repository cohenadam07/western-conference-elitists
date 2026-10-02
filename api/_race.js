// api/_race.js — the rules of a Flappy Hoops race party, with no storage in them. api/race.js reads
// the party out of Redis, hands it here with the time, and writes back whatever changed.
//
// A PARTY, START TO FINISH
//   lobby   friends join with the four-letter code (up to eight). The host starts the vote.
//   vote    everyone gets 15 seconds: four worlds drawn at random from every city in the game, and
//           the mode (speed: first one in wins; flaps: fewest flaps wins). The most votes wins;
//           a tie is settled at random among the tied; no votes at all is a random pick.
//   reveal  the winning world and mode, for a moment.
//   hole    all nine holes of that world, one after another. Everyone starts together on the same
//           clock. A hole ends when everyone still here has sunk it or given up, or at the cap.
//   board   the hole's leaderboard, after every hole.
//   final   the match standings and the bonus. Then back to the lobby.
//
// WHAT TRAVELS. Flaps, not positions: the game's sim is deterministic at 120 steps a second, so a
// run is "which side, on which step". Every player's game replays the others' flaps and draws their
// balls. A finish is what that player's game reports (steps and flaps); this file checks it's
// plausible against the clock, it does not replay it. This is a party with a code between friends,
// and the tickets live in each player's own browser.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'

export const MAX_PLAYERS = 8
export const MIN_START = 2
// (the clocks can be set from the environment: RACE_LEAD_MS and so on; the tests on a slow machine do)
const env = (k, d) => { const n = Number(typeof process !== 'undefined' && process.env ? process.env[k] : 0); return n > 0 ? n : d }
export const VOTE_MS = env('RACE_VOTE_MS', 15000)     // Adam: "every person in the lobby has 15 seconds to vote"
export const REVEAL_MS = env('RACE_REVEAL_MS', 4500)
export const LEAD_MS = env('RACE_LEAD_MS', 6000)      // from "hole n" to step 0: time to load the hole, pan, and 3-2-1
export const CAP_MS = env('RACE_CAP_MS', 120000)      // a hole's time limit
export const GRACE_MS = 2500          // a finish just before the cap can still arrive after it
export const BOARD_MS = env('RACE_BOARD_MS', 9000)    // the leaderboard after each hole
export const FINAL_MS = 180000        // the final standings, before the party drops back to the lobby
// not heard from for this long: away (doesn't hold a hole or a vote up). Games connected directly ask
// every 4 or 5 seconds, so this leaves room for a slow phone to miss a couple.
export const AWAY_MS = env('RACE_AWAY_MS', 20000)
export const RACER_MS = 60000         // heard from this recently: still dealt in for the next hole
export const GONE_MS = 150000         // in the lobby, not heard from for this long: off the list
export const TTL = 3 * 3600           // seconds a party outlives its last request
export const HZ = 120
export const MODES = ['speed', 'flaps']
// Tickets by place on each hole, and the match bonus (the way Flappy Golf 2 pays out a race).
export const TIX = [8, 6, 5, 4, 3, 3, 3, 3]
export const TIX_DNF = 1
export const BONUS = [20, 12, 6]
// Match points by place on each hole: the standings. Didn't finish: none.
export const PTS = [10, 8, 6, 5, 4, 3, 2, 1]
export const NAME_MAX = 12
export const OPTIONS = 4              // Adam: "you should be shown 4 of the worlds"
// Party codes: consonants only, so no code spells anything.
export const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
export const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/
export const ID_RE = /^[a-z0-9]{6,10}$/
const INPUTS_RE = /^(\d{1,6}:(-1|0|1|R)(,\d{1,6}:(-1|0|1|R)){0,699})?$/
const NONCE_RE = /^[a-z0-9]{4,10}$/
const WORLD_RE = /^[a-z0-9-]{2,24}$/

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
export function cleanName(raw) {
  const s = String(raw || '').replace(/[^\w \-.'!]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim()
  if (!s) return 'Player'
  try {
    if (matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, ''))) return 'Player'
  } catch { /* the filter isn't available: the stripped name stands */ }
  return s
}

export const makeCode = (rnd = Math.random) => Array.from({ length: 4 }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join('')
const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo }

export function newRoom(code, now) {
  return { code, host: '', created: now, players: [], phase: 'lobby', until: 0, match: 0,
    opts: [], tally: null, world: '', mode: '', holes: 9, hole: -1, startAt: 0, capAt: 0, racers: [], results: [], totals: {}, final: null }
}

// Add a player (or find them again by id). Returns { player } or { error }.
export function addPlayer(room, id, rawName, now) {
  const had = room.players.find((p) => p.id === id)
  if (had) { had.joined = now; return { player: had, again: true } }      // (back again: heard from just now)
  if (room.players.length >= MAX_PLAYERS) return { error: 'That party is full (eight players).', status: 409 }
  let name = cleanName(rawName)
  const taken = (n) => room.players.some((p) => p.name.toLowerCase() === n.toLowerCase())
  if (taken(name)) { let k = 2; while (taken(`${name.slice(0, NAME_MAX - 2)} ${k}`)) k++; name = `${name.slice(0, NAME_MAX - 2)} ${k}` }
  const used = new Set(room.players.map((p) => p.color))
  let color = 0; while (used.has(color)) color++
  const player = { id, name, color, joined: now }
  room.players.push(player)
  if (!room.host) room.host = id
  return { player }
}

export function removePlayer(room, id) {
  room.players = room.players.filter((p) => p.id !== id)
  room.racers = room.racers.filter((r) => r !== id)
  if (room.host === id) room.host = room.players[0] ? room.players[0].id : ''
}

// What a player's game says about itself on every poll, cleaned. `t` is ours (the server's clock).
export function cleanLive(me, now) {
  const m = me && typeof me === 'object' ? me : {}
  const inp = typeof m.in === 'string' && m.in.length <= 9000 && INPUTS_RE.test(m.in) ? m.in : ''
  // (n: a name for this load of the page, new on every reload: the other games connect to it directly,
  // and a new one tells them to connect again)
  return { t: now, m: int(m.m, 0, 1e6), h: int(m.h, -1, 64), k: int(m.k, 0, 1e6), f: int(m.f, 0, 9999), in: inp,
    vw: typeof m.vw === 'string' && WORLD_RE.test(m.vw) ? m.vw : '', vm: MODES.includes(m.vm) ? m.vm : '',
    n: typeof m.n === 'string' && NONCE_RE.test(m.n) ? m.n : '',
    // (d: how this game's links to the others are doing, in its own words: only ever read back by
    // someone asking after the party by its code, to find out why two games didn't connect)
    d: typeof m.d === 'string' ? m.d.replace(/[^\x20-\x7e]/g, '').slice(0, 600) : '' }
}

// What a party's games say about their links to each other (GET /api/race?diag=CODE).
export function diag(room, live, now) {
  return { ok: true, code: room.code, phase: room.phase, match: room.match, hole: room.hole,
    players: room.players.map((p) => { const l = live[p.id] || {}; return { name: p.name, here: isHere(room, live, p.id, now), seen: l.t ? Math.round((now - l.t) / 1000) : null, d: l.d || '' } }) }
}

// Notes one game leaves for another so the two can connect directly (a WebRTC offer or answer):
// [{ to, v }], v a short JSON string this file never looks inside. A handful at most, each bounded.
export function cleanNotes(list, from) {
  const out = []
  for (const n of Array.isArray(list) ? list.slice(0, 2 * MAX_PLAYERS) : []) {
    if (!n || typeof n.to !== 'string' || !ID_RE.test(n.to) || n.to === from) continue
    if (typeof n.v !== 'string' || n.v.length < 2 || n.v.length > 12000) continue      // (an offer with a relay's routes in it runs to a few thousand)
    out.push({ to: n.to, v: n.v })
  }
  return out
}

// Where the games look to find a way to each other: public STUN servers by default. RACE_ICE (JSON,
// the iceServers list) replaces them, which is how a TURN relay would be added later.
export function iceServers() {
  try {
    const v = JSON.parse((typeof process !== 'undefined' && process.env && process.env.RACE_ICE) || 'null')
    if (Array.isArray(v) && v.length && v.length <= 6) return v
  } catch { /* not JSON: the defaults stand */ }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
}

// A finish, as stored: "steps:flaps:when" (a give-up is "x:0:when").
export function finValue(fin, now) {
  if (!fin || typeof fin !== 'object') return null
  if (fin.dnf) return `x:0:${now}`
  const k = Math.floor(Number(fin.k)), f = Math.floor(Number(fin.f))
  if (!Number.isFinite(k) || !Number.isFinite(f) || k < 1 || k > 1e6 || f < 0 || f > 9999) return null
  return `${k}:${f}:${now}`
}
export function parseFin(str) {
  const [a, b, c] = String(str || '').split(':')
  const at = Number(c)
  if (!Number.isFinite(at)) return null
  if (a === 'x') return { dnf: 1, at }
  const k = Number(a), f = Number(b)
  return Number.isInteger(k) && Number.isInteger(f) ? { k, f, at } : null
}
export const finField = (match, hole, id) => `d:${match}:${hole}:${id}`

// The worlds the host's game knows (so this file never has to be told about a new city).
export function cleanWorlds(list) {
  const out = [], seen = new Set()
  for (const w of Array.isArray(list) ? list.slice(0, 64) : []) {
    const id = w && typeof w.id === 'string' ? w.id : ''
    if (!WORLD_RE.test(id) || seen.has(id)) continue
    seen.add(id); out.push({ id, n: int(w.n, 1, 18) })
  }
  return out
}

// When a player was last heard from: their last poll, or the moment they (re)joined.
const seenAt = (room, live, id) => Math.max((live[id] && live[id].t) || 0, (room.players.find((p) => p.id === id) || {}).joined || 0)
export const isHere = (room, live, id, now) => now - seenAt(room, live, id) < AWAY_MS

// The most votes wins; a tie is picked at random among the tied; no votes is a random pick.
export function pick(options, votes, rnd = Math.random) {
  const count = Object.fromEntries(options.map((o) => [o, 0]))
  for (const v of votes) if (v in count) count[v]++
  const top = Math.max(...options.map((o) => count[o]))
  const tied = options.filter((o) => count[o] === top)
  return { winner: tied[Math.floor(rnd() * tied.length)], count, tied: tied.length > 1 }
}

// The host starts the vote: four worlds at random out of everything the game has.
export function startVote(room, live, worlds, now, rnd = Math.random) {
  const here = room.players.filter((p) => isHere(room, live, p.id, now))
  if (here.length < MIN_START) return { error: `A race needs at least ${MIN_START} players.`, status: 409 }
  const pool = cleanWorlds(worlds)
  if (!pool.length) return { error: 'No worlds to vote on.', status: 400 }
  const opts = []
  while (opts.length < OPTIONS && pool.length) opts.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
  Object.assign(room, { phase: 'vote', until: now + VOTE_MS, match: room.match + 1, opts, tally: null, world: '', mode: '',
    hole: -1, startAt: 0, capAt: 0, racers: [], results: [], totals: {}, final: null })
  return { ok: true }
}

function endVote(room, live, now, rnd) {
  const mine = room.players.map((p) => live[p.id]).filter((l) => l && l.m === room.match)
  const w = pick(room.opts.map((o) => o.id), mine.map((l) => l.vw), rnd)
  const m = pick(MODES, mine.map((l) => l.vm), rnd)
  room.world = w.winner; room.mode = m.winner
  room.holes = (room.opts.find((o) => o.id === w.winner) || { n: 9 }).n
  room.tally = { world: w.count, mode: m.count, tieWorld: w.tied, tieMode: m.tied }
  room.phase = 'reveal'; room.until = now + REVEAL_MS
}

function startHole(room, live, i, now) {
  room.phase = 'hole'; room.hole = i; room.until = 0
  room.startAt = now + LEAD_MS; room.capAt = room.startAt + CAP_MS
  room.racers = room.players.filter((p) => now - seenAt(room, live, p.id) < RACER_MS).map((p) => p.id)
}

// Is a reported finish believable? The sim never runs faster than the clock, so the steps can't
// exceed the time since the hole began (with slack for the report's own trip here).
export function plausible(fin, room) {
  if (!fin || fin.dnf) return false
  if (fin.at < room.startAt) return false
  if (fin.k > CAP_MS / 1000 * HZ + HZ) return false
  return fin.k <= (fin.at - room.startAt) / 1000 * HZ * 1.15 + 3 * HZ
}

// Rank a finished hole. Speed: fewest steps (then flaps). Flaps: fewest flaps (then steps).
export function scoreHole(room, fins) {
  const inParty = new Set(room.players.map((p) => p.id))
  const rows = room.racers.filter((id) => inParty.has(id)).map((id) => {
    const f = fins[id]
    return plausible(f, room) ? { id, k: f.k, f: f.f, at: f.at } : { id, dnf: 1 }
  })
  const done = rows.filter((r) => !r.dnf)
  done.sort(room.mode === 'flaps' ? (a, b) => a.f - b.f || a.k - b.k || a.at - b.at : (a, b) => a.k - b.k || a.f - b.f || a.at - b.at)
  done.forEach((r, i) => { r.place = i + 1; r.pts = PTS[i] ?? 0; r.tix = TIX[i] ?? TIX[TIX.length - 1]; delete r.at })
  const out = [...done, ...rows.filter((r) => r.dnf).map((r) => ({ ...r, place: 0, pts: 0, tix: TIX_DNF }))]
  for (const r of out) {
    const t = room.totals[r.id] || (room.totals[r.id] = { pts: 0, wins: 0, k: 0, f: 0, dnf: 0, tix: 0, holes: 0 })
    t.pts += r.pts; t.tix += r.tix; t.holes++
    if (r.dnf) t.dnf++; else { t.k += r.k; t.f += r.f; if (r.place === 1) t.wins++ }
  }
  room.results.push(out)
  return out
}

// The match: most points; then most holes won; then fewest unfinished; then the mode's own measure.
export function finalOrder(room) {
  const zero = { pts: 0, wins: 0, k: 0, f: 0, dnf: 0, tix: 0, holes: 0 }
  const rows = room.players.map((p, i) => ({ id: p.id, i, ...(room.totals[p.id] || zero) })).filter((r) => r.holes > 0)
  rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.dnf - b.dnf
    || (room.mode === 'flaps' ? a.f - b.f || a.k - b.k : a.k - b.k || a.f - b.f) || a.i - b.i)
  return rows.map((r, i) => ({ id: r.id, place: i + 1, pts: r.pts, wins: r.wins, k: r.k, f: r.f, dnf: r.dnf, tix: r.tix, bonus: BONUS[i] || 0 }))
}

export function toLobby(room) {
  Object.assign(room, { phase: 'lobby', until: 0, opts: [], tally: null, hole: -1, startAt: 0, capAt: 0, racers: [] })
}

// Move the party along as far as the clock says. Serverless has no timers: whichever request
// arrives first past a deadline does this (clients poll about once a second while they're in).
// Returns { changed, clear } (clear: the finishes from the match just ended can be dropped).
export function advance(room, live, fins, now, rnd = Math.random) {
  let changed = false, clear = false
  const here = (id) => isHere(room, live, id, now)
  // the host has gone quiet: the next one who's here takes over
  if (!room.players.some((p) => p.id === room.host) || !here(room.host)) {
    const next = room.players.find((p) => here(p.id))
    if (next && next.id !== room.host) { room.host = next.id; changed = true }
  }
  if (room.phase === 'lobby') {
    const keep = room.players.filter((p) => now - seenAt(room, live, p.id) < GONE_MS)
    if (keep.length !== room.players.length) {
      room.players = keep
      if (!keep.some((p) => p.id === room.host)) room.host = keep[0] ? keep[0].id : ''
      changed = true
    }
  }
  for (let guard = 0; guard < 8; guard++) {
    const was = room.phase + ':' + room.hole
    if (room.phase === 'vote') {
      const voters = room.players.filter((p) => here(p.id))
      const all = voters.length > 0 && voters.every((p) => {
        const l = live[p.id]
        return l && l.m === room.match && room.opts.some((o) => o.id === l.vw) && MODES.includes(l.vm)
      })
      if (now >= room.until || all) endVote(room, live, now, rnd)
    } else if (room.phase === 'reveal') {
      if (now >= room.until) startHole(room, live, 0, now)
    } else if (room.phase === 'hole') {
      const inParty = new Set(room.players.map((p) => p.id))
      const racers = room.racers.filter((id) => inParty.has(id))
      const allDone = racers.every((id) => fins[id] || !here(id))
      if (now >= room.capAt + GRACE_MS || (now >= room.startAt && allDone)) {
        scoreHole(room, fins)
        room.phase = 'board'; room.until = now + BOARD_MS
      }
    } else if (room.phase === 'board') {
      if (now >= room.until) {
        if (room.hole + 1 < room.holes) { startHole(room, live, room.hole + 1, now); fins = {} }
        else { room.final = finalOrder(room); room.phase = 'final'; room.until = now + FINAL_MS }
      }
    } else if (room.phase === 'final') {
      if (now >= room.until) { toLobby(room); clear = true }
    }
    if (room.phase + ':' + room.hole === was) break
    changed = true
  }
  return { changed, clear }
}

// What a player's game gets back on every request.
export function view(room, live, fins, you, now) {
  const racing = room.phase === 'hole'
  const players = room.players.map((p) => {
    const l = live[p.id], cur = l && l.m === room.match
    const o = { id: p.id, name: p.name, color: p.color, here: isHere(room, live, p.id, now) }
    if (l && l.n) o.n = l.n
    if (room.phase === 'vote' && cur) { o.vw = l.vw; o.vm = l.vm }
    if (racing && cur && l.h === room.hole) { o.k = l.k; o.f = l.f; if (p.id !== you) o.in = l.in }
    if (racing && fins[p.id]) o.fin = fins[p.id].dnf ? { dnf: 1 } : { k: fins[p.id].k, f: fins[p.id].f }
    return o
  })
  return { ok: true, now, you, code: room.code, host: room.host, phase: room.phase, until: room.until, match: room.match,
    opts: room.opts, tally: room.tally, world: room.world, mode: room.mode, holes: room.holes, hole: room.hole,
    startAt: room.startAt, capAt: room.capAt, racers: room.racers, players,
    results: room.results, totals: room.totals, final: room.final }
}
