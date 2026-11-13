// api/_race.js — the rules of a Flappy Hoops race party, with no storage in them. api/race.js reads
// the party out of Redis, hands it here with the time, and writes back whatever changed.
//
// A PARTY, START TO FINISH
//   lobby   friends join with the four-letter code (up to eight). The host starts the vote.
//   vote    everyone gets 15 seconds: four worlds drawn at random from every city in the game, and
//           the mode (speed: first one in wins; flaps: fewest flaps wins; knockout, 2.11: speed, but
//           live balls can hit each other). The most votes wins; a tie is settled at random among the
//           tied; no votes at all is a random pick. Knockout needs every game here to know it (2.11 on):
//           if one doesn't, it's speed or flaps, whichever of those had more votes.
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
//
// KNOCKOUT (2.11). Every game simulates every ball from everyone's inputs (the game's
// src/game/knockout.js), so each hole gets a seed here (for the item rolls and the box respawns, the
// same on every game). The inputs gain `U` (use the item you hold). A finish is reported and checked as
// in speed, and ranked as speed is. KOs are a stat, not a tiebreaker: each game reports the KOs it has
// settled for everyone (`kt`), and the board takes the most any game reported for each player.
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
export const MODES = ['speed', 'flaps', 'knockout']
export const KO_VERSION = 2           // a game that knows Knockout says so (kv) with every poll (2: 2.12's rules)
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
// (2.12: up to 3,000 a hole: a two-minute Knockout brawl can run to hundreds of taps)
const INPUTS_RE = /^(\d{1,6}:(-1|0|1|R|U|K|L|G)(,\d{1,6}:(-1|0|1|R|U|K|L|G)){0,2999})?$/
const INPUTS_MAX = 30000
const NONCE_RE = /^[a-z0-9]{4,10}$/
const WORLD_RE = /^[a-z0-9-]{2,24}$/
// what a player has on: "<ball>:<trail>", ids out of the game's shop catalog
const LOOK_RE = /^[a-z0-9]{1,16}:[a-z0-9]{1,16}$/

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
    opts: [], tally: null, world: '', mode: '', holes: 9, hole: -1, startAt: 0, capAt: 0, racers: [], results: [], totals: {}, final: null, seed: 0 }
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
  // (null: inputs came that don't fit; they can't be sealed with a finish, so a Knockout hole with them isn't replayed)
  const inp = typeof m.in === 'string' && m.in.length <= INPUTS_MAX && INPUTS_RE.test(m.in) ? m.in : typeof m.in === 'string' && m.in ? null : ''
  // (n: a name for this load of the page, new on every reload: the other games connect to it directly,
  // and a new one tells them to connect again)
  return { t: now, m: int(m.m, 0, 1e6), h: int(m.h, -1, 64), k: int(m.k, 0, 1e6), f: int(m.f, 0, 9999), in: inp,
    vw: typeof m.vw === 'string' && WORLD_RE.test(m.vw) ? m.vw : '', vm: MODES.includes(m.vm) ? m.vm : '',
    n: typeof m.n === 'string' && NONCE_RE.test(m.n) ? m.n : '',
    // (lk: the ball and trail they have on, so everyone else's game draws their ball the way they see it)
    lk: typeof m.lk === 'string' && LOOK_RE.test(m.lk) ? m.lk : '',
    // (ex: their goal explosion, Flappy Hoops 2.10, so it goes off when their ball goes in on everyone's screen)
    ex: typeof m.ex === 'string' && /^[a-z0-9]{1,16}$/.test(m.ex) ? m.ex : '',
    // (Knockout, 2.11: kv, this game knows it; kt, the KOs it has settled this hole, "<id>:<n>,...")
    kv: int(m.kv, 0, 9), kt: cleanTally(m.kt),
    // (d: how this game's links to the others are doing, in its own words: only ever read back by
    // someone asking after the party by its code, to find out why two games didn't connect)
    d: typeof m.d === 'string' ? m.d.replace(/[^\x20-\x7e]/g, '').slice(0, 600) : '' }
}

// A game's KO tally for the hole: "<id>:<n>,..." → { id: n }, at most eight players, each count bounded.
export function cleanTally(raw) {
  const out = {}
  if (typeof raw !== 'string' || raw.length > 200) return out
  for (const part of raw.split(',').slice(0, MAX_PLAYERS)) {
    const [pid, n] = part.split(':')
    if (ID_RE.test(pid || '') && /^\d{1,3}$/.test(n || '')) out[pid] = Number(n)
  }
  return out
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

// A finish, as stored: "steps:flaps:when" (a give-up is "x:0:when"). From 2.12, "|inputs" after it: that player's
// inputs for the hole as they were when they finished or gave up (all of them: nothing they do after counts), so a
// Knockout hole can be replayed by the server once everyone's are in.
export function finValue(fin, now, ins = '') {
  if (!fin || typeof fin !== 'object') return null
  // (inputs that don't fit, null: no seal at all, so the hole isn't replayed; none at all: sealed empty)
  const tail = ins === null ? '' : typeof ins === 'string' && ins && INPUTS_RE.test(ins) ? '|' + ins : '|'
  if (fin.dnf) return `x:0:${now}` + tail
  const k = Math.floor(Number(fin.k)), f = Math.floor(Number(fin.f))
  if (!Number.isFinite(k) || !Number.isFinite(f) || k < 1 || k > 1e6 || f < 0 || f > 9999) return null
  return `${k}:${f}:${now}` + tail
}
export function parseFin(str) {
  const raw = String(str || ''), bar = raw.indexOf('|')
  const [a, b, c] = (bar < 0 ? raw : raw.slice(0, bar)).split(':')
  const at = Number(c)
  if (!Number.isFinite(at)) return null
  const ins = bar < 0 ? undefined : raw.slice(bar + 1)          // (undefined: a finish from before 2.12, no inputs with it)
  if (a === 'x') return { dnf: 1, at, ...(ins !== undefined ? { in: ins } : {}) }
  const k = Number(a), f = Number(b)
  return Number.isInteger(k) && Number.isInteger(f) ? { k, f, at, ...(ins !== undefined ? { in: ins } : {}) } : null
}
const parseInputs = (str) => (str ? str.split(',').map((x) => { const [t, d] = x.split(':'); return [Number(t), /^[RUKLG]$/.test(d) ? d : Number(d)] }) : [])
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
    hole: -1, startAt: 0, capAt: 0, racers: [], results: [], totals: {}, final: null, kov: [], koV: {}, koVbad: 0, koRec: [], koMatch: [] })
  return { ok: true }
}

// Can this party play Knockout? Only if every game that's here knows it (a page from before 2.11 would
// be lost in it).
export const koReady = (room, live, now) => room.players.filter((p) => isHere(room, live, p.id, now)).every((p) => live[p.id] && live[p.id].kv >= KO_VERSION)

function endVote(room, live, now, rnd) {
  const mine = room.players.map((p) => live[p.id]).filter((l) => l && l.m === room.match)
  const w = pick(room.opts.map((o) => o.id), mine.map((l) => l.vw), rnd)
  let m = pick(MODES, mine.map((l) => l.vm), rnd), koOff = false
  let koOld = null
  if (m.winner === 'knockout' && !koReady(room, live, now)) {
    // (someone here is on a game from before this Knockout: it's whichever of the other two had more votes, and the
    // reveal names who should reload)
    const count = m.count
    m = pick(['speed', 'flaps'], mine.map((l) => l.vm), rnd)
    m.count = count; koOff = true
    koOld = room.players.filter((p) => isHere(room, live, p.id, now) && !(live[p.id] && live[p.id].kv >= KO_VERSION)).map((p) => p.name)
  }
  room.world = w.winner; room.mode = m.winner
  room.holes = (room.opts.find((o) => o.id === w.winner) || { n: 9 }).n
  room.tally = { world: w.count, mode: m.count, tieWorld: w.tied, tieMode: m.tied, ...(koOff ? { koOff: true, koOld } : {}) }
  room.phase = 'reveal'; room.until = now + REVEAL_MS
}

function startHole(room, live, i, now, rnd = Math.random) {
  room.phase = 'hole'; room.hole = i; room.until = 0
  // (Knockout: the hole's seed, for everything random in it, the same on every game)
  room.seed = room.mode === 'knockout' ? 1 + Math.floor(rnd() * 2147483646) : 0
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

// The KOs on a hole: for each player, the most that any game in the party reported for them (every game
// settles the same ones; the one that heard the most, latest, has them all).
export function koCounts(room, live) {
  const out = {}
  for (const p of room.players) {
    const l = live && live[p.id]
    if (!l || l.m !== room.match || l.h !== room.hole || !l.kt) continue
    for (const [id, n] of Object.entries(l.kt)) if (n > (out[id] || 0)) out[id] = n
  }
  return out
}

// Rank a finished hole. Speed and Knockout: fewest steps (then flaps). Flaps: fewest flaps (then steps).
// Knockout (2.12): the server plays the hole again itself, once it has every racer's inputs (each sealed with their
// finish or give-up), with the game's own rules (kor.replay: server/sim.mjs's koReplay). What comes back, the tick each
// ball went in, its flaps and the KOs, is what the Knockout records are made of; never what a game says.
// Returns null (nothing verified) when someone's inputs are missing: a racer who left, or went quiet without finishing.
export function koVerify(room, fins, kor) {
  if (!kor || room.mode !== 'knockout') return null
  const inParty = new Set(room.players.map((p) => p.id))
  const ids = room.racers
  if (!ids.length || ids.some((id) => !inParty.has(id) || !fins[id] || fins[id].in === undefined)) return null
  const inputs = {}
  let last = 0
  for (const id of ids) {
    inputs[id] = parseInputs(fins[id].in)
    // (a last ball opened because someone left without a word, L: not a hole anyone's record can come from)
    if (inputs[id].some((x) => x[1] === 'L')) return null
    for (const [t] of inputs[id]) if (t > last) last = t
    if (!fins[id].dnf && fins[id].k > last) last = fins[id].k
  }
  const until = Math.min(Math.ceil(CAP_MS / 1000 * HZ), last + 600)
  const hole = kor.holeOf(room.world, room.hole)
  if (!hole) return null
  const res = kor.replay({ hole, seed: room.seed, inputs, until })
  if (res) room.koRunTmp = { seed: room.seed, inputs }     // (kept with a record it sets; never saved with the party)
  return res ? { hole, ...res } : null
}

export function scoreHole(room, fins, live, kor) {
  const inParty = new Set(room.players.map((p) => p.id))
  const rows = room.racers.filter((id) => inParty.has(id)).map((id) => {
    const f = fins[id]
    return plausible(f, room) ? { id, k: f.k, f: f.f, at: f.at } : { id, dnf: 1 }
  })
  const ko = room.mode === 'knockout' ? koCounts(room, live) : null
  const vr = koVerify(room, fins, kor)
  if (ko) for (const r of rows) r.ko = vr ? vr.kos[r.id] || 0 : ko[r.id] || 0     // (verified: the server's own count)
  if (room.mode === 'knockout') {
    room.kov = room.kov || []
    room.kov[room.hole] = vr ? { T: vr.T, hash: vr.hash } : null
    room.koV = room.koV || {}
    if (vr) for (const id of Object.keys(vr.kos)) room.koV[id] = (room.koV[id] || 0) + vr.kos[id]
    else room.koVbad = 1
    // the Knockout record candidates from this hole: everyone the replay saw go in, who has an account to hold it
    room.koRec = vr ? Object.entries(vr.fins).filter(([, f]) => f).map(([id, f]) => {
      const p = room.players.find((q) => q.id === id)
      return p && p.acct ? { hole: vr.hole, u: p.acct.u, n: p.acct.n, k: f.k, f: f.f } : null
    }).filter(Boolean) : []
  }
  const done = rows.filter((r) => !r.dnf)
  done.sort(room.mode === 'flaps' ? (a, b) => a.f - b.f || a.k - b.k || a.at - b.at : (a, b) => a.k - b.k || a.f - b.f || a.at - b.at)
  done.forEach((r, i) => { r.place = i + 1; r.pts = PTS[i] ?? 0; r.tix = TIX[i] ?? TIX[TIX.length - 1]; delete r.at })
  const out = [...done, ...rows.filter((r) => r.dnf).map((r) => ({ ...r, place: 0, pts: 0, tix: TIX_DNF }))]
  for (const r of out) {
    const t = room.totals[r.id] || (room.totals[r.id] = { pts: 0, wins: 0, k: 0, f: 0, dnf: 0, tix: 0, holes: 0 })
    t.pts += r.pts; t.tix += r.tix; t.holes++
    if (ko) t.ko = (t.ko || 0) + r.ko
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
  return rows.map((r, i) => ({ id: r.id, place: i + 1, pts: r.pts, wins: r.wins, k: r.k, f: r.f, dnf: r.dnf, tix: r.tix, bonus: BONUS[i] || 0,
    ...(room.mode === 'knockout' ? { ko: r.ko || 0 } : {}) }))
}

export function toLobby(room) {
  Object.assign(room, { phase: 'lobby', until: 0, opts: [], tally: null, hole: -1, startAt: 0, capAt: 0, racers: [] })
}

// Move the party along as far as the clock says. Serverless has no timers: whichever request
// arrives first past a deadline does this (clients poll about once a second while they're in).
// Returns { changed, clear } (clear: the finishes from the match just ended can be dropped).
export function advance(room, live, fins, now, rnd = Math.random, kor = null) {
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
      if (now >= room.until) startHole(room, live, 0, now, rnd)
    } else if (room.phase === 'hole') {
      const inParty = new Set(room.players.map((p) => p.id))
      const racers = room.racers.filter((id) => inParty.has(id))
      const allDone = racers.every((id) => fins[id] || !here(id))
      if (now >= room.capAt + GRACE_MS || (now >= room.startAt && allDone)) {
        scoreHole(room, fins, live, kor)
        room.phase = 'board'; room.until = now + BOARD_MS
      }
    } else if (room.phase === 'board') {
      if (now >= room.until) {
        if (room.hole + 1 < room.holes) { startHole(room, live, room.hole + 1, now, rnd); fins = {} }
        else {
          room.final = finalOrder(room); room.phase = 'final'; room.until = now + FINAL_MS
          // (Knockout: the most KOs in the match, for the world's record: only when every hole was replayed by the server)
          room.koMatch = room.mode === 'knockout' && !room.koVbad ? room.players.filter((p) => p.acct && (room.koV || {})[p.id] > 0)
            .map((p) => ({ world: room.world, u: p.acct.u, n: p.acct.n, ko: room.koV[p.id] })) : []
        }
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
  // (and during the hole's board: a game hearing through the server still gets the last flaps of whoever finished
  // last, and, in Knockout, plays them into its world: the hole ended on that finish, in the same request)
  const racing = room.phase === 'hole' || room.phase === 'board'
  const players = room.players.map((p) => {
    const l = live[p.id], cur = l && l.m === room.match
    const o = { id: p.id, name: p.name, color: p.color, here: isHere(room, live, p.id, now) }
    if (p.acct) o.ac = 1                  // (signed in: can hold a Knockout record)
    if (l && l.n) o.n = l.n
    if (l && l.lk) o.lk = l.lk
    if (l && l.ex) o.ex = l.ex
    if (room.phase === 'vote' && cur) { o.vw = l.vw; o.vm = l.vm }
    // (Knockout: your own inputs too, so a game reloaded mid-hole can put them back and stay in the same world)
    if (racing && cur && l.h === room.hole) { o.k = l.k; o.f = l.f; if (p.id !== you || room.mode === 'knockout') o.in = l.in }
    // (Knockout: once someone's inputs are sealed with their finish or give-up, those are what every game gets, during
    // the hole and its board: exactly what the server replays, and never a later poll's that no longer carries them)
    if (racing && room.mode === 'knockout' && fins[p.id] && typeof fins[p.id].in === 'string') o.in = fins[p.id].in
    if (racing && fins[p.id]) o.fin = fins[p.id].dnf ? { dnf: 1 } : { k: fins[p.id].k, f: fins[p.id].f }
    return o
  })
  return { ok: true, now, you, code: room.code, host: room.host, phase: room.phase, until: room.until, match: room.match,
    opts: room.opts, tally: room.tally, world: room.world, mode: room.mode, holes: room.holes, hole: room.hole,
    startAt: room.startAt, capAt: room.capAt, racers: room.racers, players, seed: room.seed || 0, kov: room.kov || [],
    results: room.results, totals: room.totals, final: room.final }
}
