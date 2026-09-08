// Play-in, bracket and series — the browser port of season_engine.py's postseason.
import { SEED } from './seed.js'
import { playableSim } from './league.js'
import { withForm } from './form.js'
import { simulate, rng } from './sim.js'
import { standings } from './season.js'

const gseed = (a, b) => (Math.imul(a ^ (b + 1), 0x9e3779b1) >>> 0) % 2147483647

function playGame(home, away, seed) {
  const { score } = simulate(
    withForm(playableSim(home), seed), withForm(playableSim(away), seed ^ 0x5f5f), seed)
  return { home, away, hs: score.home, as: score.away, winner: score.home >= score.away ? home : away }
}

// 2-2-1-1-1 home court to the higher seed.
export function playSeries(hi, lo, seed, bestOf = 7) {
  const pattern = [hi, hi, lo, lo, hi, lo, hi]
  const w = { [hi]: 0, [lo]: 0 }
  const games = []
  const need = Math.floor(bestOf / 2) + 1
  for (let g = 0; g < bestOf; g++) {
    const home = bestOf === 1 ? hi : pattern[g]
    const away = home === hi ? lo : hi
    const res = playGame(home, away, gseed(seed, g))
    w[res.winner]++
    games.push(res)
    if (w[res.winner] === need) break
  }
  const winner = w[hi] > w[lo] ? hi : lo
  return { hi, lo, winner, loser: winner === hi ? lo : hi, w: { ...w }, games }
}

// 7/8 winner takes the 7 seed; 9/10 winner plays that loser for the 8.
function playIn(order, seed) {
  const [s7, s8, s9, s10] = [order[6], order[7], order[8], order[9]]
  const a = playSeries(s7, s8, gseed(seed, 101), 1)
  const b = playSeries(s9, s10, gseed(seed, 102), 1)
  const c = playSeries(a.loser, b.winner, gseed(seed, 103), 1)
  return { seven: a.winner, eight: c.winner, games: [a, b, c] }
}

export function runPlayoffs(state) {
  const tab = standings(state)
  const out = { conf: {}, rounds: [], playIn: {} }
  const field = {}
  for (const c of ['East', 'West']) {
    const order = tab[c].map((r) => r.team)
    const pi = playIn(order, state.seed + (c === 'East' ? 7 : 13))
    out.playIn[c] = pi
    field[c] = [...order.slice(0, 6), pi.seven, pi.eight]
  }
  const names = ['First round', 'Conference semifinal', 'Conference final']
  for (const c of ['East', 'West']) {
    let r = field[c]
    let round = 0
    while (r.length > 1) {
      const next = []
      for (let i = 0; i < r.length / 2; i++) {
        const s = playSeries(r[i], r[r.length - 1 - i], gseed(state.seed + round * 31, i + (c === 'East' ? 0 : 50)))
        out.rounds.push({ conf: c, name: names[round], ...s })
        next.push(s.winner)
      }
      r = next
      round++
    }
    out.conf[c] = r[0]
  }
  const finals = playSeries(out.conf.East, out.conf.West, gseed(state.seed, 999))
  out.rounds.push({ conf: 'Finals', name: 'NBA Finals', ...finals })
  out.champion = finals.winner
  out.field = field
  return out
}

// How far a given team got — used for the owner's evaluation and the record book.
export function teamRun(po, team) {
  const mine = po.rounds.filter((r) => r.hi === team || r.lo === team)
  const wins = mine.filter((r) => r.winner === team).length
  return {
    made: !!mine.length,
    seriesWon: wins,
    confTitle: po.conf.East === team || po.conf.West === team,
    champion: po.champion === team,
    path: mine.map((r) => ({
      name: r.name,
      opp: r.hi === team ? r.lo : r.hi,
      w: r.w[team],
      l: r.w[r.hi === team ? r.lo : r.hi],
      won: r.winner === team,
    })),
  }
}

// ------------------------------------------------------------ the staged bracket
//
// `runPlayoffs` above resolves the whole postseason in one call, which is right for the
// soak runs and wrong for a person: the complaint was that the playoffs went past in a
// single click, with no sense that anything had happened. April to June is the part of the
// year everyone remembers, and it should take longer than the trade deadline.
//
// So the same engine, held open. A bracket is a state machine over named rounds; the user
// steps it one GAME at a time, one SERIES at a time, or a whole round if they would rather.
// The rounds are named the way the league names them, and East and West stay apart until
// the Finals, because that separation is most of the drama.

export const ROUNDS = [
  { key: 'playin', name: 'Play-in tournament', short: 'Play-in',
    blurb: 'Seventh through tenth, one game at a time. Two nights decide who gets in and who goes home.' },
  { key: 'r1', name: 'Conference quarterfinals', short: 'Quarterfinals',
    blurb: 'Sixteen teams, eight series, best of seven. The first round is where the seedings get tested.' },
  { key: 'r2', name: 'Conference semifinals', short: 'Semifinals',
    blurb: 'Eight left. From here every series is between teams that have already won one.' },
  { key: 'cf', name: 'Conference finals', short: 'Conference finals',
    blurb: 'Four teams, two series, and the winners go to the Finals.' },
  { key: 'finals', name: 'The Finals', short: 'Finals',
    blurb: 'East against West. Four wins from a banner.' },
]
export const roundName = (key) => (ROUNDS.find((r) => r.key === key) || {}).name || key

const PATTERN = (hi, lo) => [hi, hi, lo, lo, hi, lo, hi]

export function newSeries(hi, lo, seed, bestOf = 7, meta = {}) {
  return { hi, lo, seed, bestOf, w: { [hi]: 0, [lo]: 0 }, games: [], winner: null, loser: null, ...meta }
}

// One game. The seeds are derived from the series seed and the game number, so a series
// played game by game and the same series played in one go produce identical results —
// which is what keeps the replay fixtures honest.
export function stepSeries(s) {
  if (s.winner) return s
  const g = s.games.length
  const home = s.bestOf === 1 ? s.hi : PATTERN(s.hi, s.lo)[g]
  const away = home === s.hi ? s.lo : s.hi
  const res = playGame(home, away, gseed(s.seed, g))
  s.w[res.winner]++
  s.games.push(res)
  const need = Math.floor(s.bestOf / 2) + 1
  if (s.w[res.winner] === need) {
    s.winner = res.winner
    s.loser = res.winner === s.hi ? s.lo : s.hi
  }
  return s
}

export function finishSeries(s) {
  let guard = 0
  while (!s.winner && guard++ < 9) stepSeries(s)
  return s
}

export const seriesDone = (s) => !!s.winner
export const seriesLabel = (s) => `${s.hi} ${s.w[s.hi]}–${s.w[s.lo]} ${s.lo}`

// Open the postseason without playing any of it.
export function openBracket(state) {
  const tab = standings(state)
  const seedOf = {}
  const order = {}
  for (const c of ['East', 'West']) {
    order[c] = tab[c].map((r) => r.team)
    order[c].forEach((t, i) => { seedOf[t] = i + 1 })
  }
  const po = {
    stage: 'playin', seed: state.seed, seedOf, order,
    rec: Object.fromEntries(Object.entries(state.rec).map(([k, v]) => [k, { w: v.w, l: v.l }])),
    series: [], rounds: [], conf: {}, playIn: {}, field: {}, champion: null,
  }
  // The play-in is three one-game series per conference, and the second depends on the
  // first — so only the two that can be played now are opened.
  for (const c of ['East', 'West']) {
    const o = order[c]
    const s = state.seed + (c === 'East' ? 7 : 13)
    po.series.push(
      newSeries(o[6], o[7], gseed(s, 101), 1, { conf: c, round: 'playin', slot: 'a',
        stake: 'Winner takes the seventh seed' }),
      newSeries(o[8], o[9], gseed(s, 102), 1, { conf: c, round: 'playin', slot: 'b',
        stake: 'Loser is eliminated' }),
    )
  }
  return po
}

const live = (po) => po.series.filter((s) => s.round === po.stage && !s.winner)
export const playableNow = live
export const roundSeries = (po, round = po.stage) => po.series.filter((s) => s.round === round)

// Advance the bracket by exactly one game, wherever the next game is.
export function stepBracket(po) {
  const open = live(po)
  if (!open.length) return advanceRound(po)
  // Play the series with the fewest games so far, so the round moves forward together
  // rather than resolving one matchup at a time while the rest sit untouched.
  const s = open.reduce((a, b) => (b.games.length < a.games.length ? b : a))
  stepSeries(s)
  return live(po).length ? po : advanceRound(po)
}

export function playRound(po) {
  for (const s of live(po)) finishSeries(s)
  return advanceRound(po)
}

export function playThisSeries(po, s) {
  finishSeries(s)
  return live(po).length ? po : advanceRound(po)
}

// A round is over. Work out who survived and open the next one.
function advanceRound(po) {
  if (po.stage === 'playin') {
    // The third play-in game exists only once the first two are done.
    const needThird = ['East', 'West'].filter((c) => !po.series.some((s) => s.conf === c && s.slot === 'c'))
    if (needThird.length) {
      for (const c of needThird) {
        const a = po.series.find((s) => s.conf === c && s.slot === 'a')
        const b = po.series.find((s) => s.conf === c && s.slot === 'b')
        po.series.push(newSeries(a.loser, b.winner, gseed(po.seed + (c === 'East' ? 7 : 13), 103), 1,
          { conf: c, round: 'playin', slot: 'c', stake: 'Winner takes the eighth seed' }))
      }
      return po
    }
    for (const c of ['East', 'West']) {
      const a = po.series.find((s) => s.conf === c && s.slot === 'a')
      const cc = po.series.find((s) => s.conf === c && s.slot === 'c')
      po.playIn[c] = { seven: a.winner, eight: cc.winner }
      po.field[c] = [...po.order[c].slice(0, 6), a.winner, cc.winner]
    }
    return openRound(po, 'r1')
  }
  const order = ['r1', 'r2', 'cf', 'finals']
  const i = order.indexOf(po.stage)
  if (i < 0) return po
  if (po.stage === 'finals') {
    const f = po.series.find((s) => s.round === 'finals')
    po.champion = f.winner
    po.stage = 'done'
    po.rounds = po.series.filter((s) => s.round !== 'playin')
      .map((s) => ({ ...s, name: nameFor(s) }))
    return po
  }
  const next = order[i + 1]
  const survivors = {}
  for (const c of ['East', 'West']) {
    survivors[c] = po.series.filter((s) => s.round === po.stage && s.conf === c).map((s) => s.winner)
  }
  if (next === 'finals') {
    po.conf.East = survivors.East[0]
    po.conf.West = survivors.West[0]
    po.series.push(newSeries(po.conf.East, po.conf.West, gseed(po.seed, 999), 7,
      { conf: 'Finals', round: 'finals', stake: 'The championship' }))
    po.stage = 'finals'
    return po
  }
  return openRound(po, next, survivors)
}

function openRound(po, round, survivors) {
  po.stage = round
  for (const c of ['East', 'West']) {
    const teams = survivors ? survivors[c] : po.field[c]
    for (let i = 0; i < teams.length / 2; i++) {
      const a = teams[i]
      const b = teams[teams.length - 1 - i]
      const hi = (po.seedOf[a] ?? 99) <= (po.seedOf[b] ?? 99) ? a : b
      const lo = hi === a ? b : a
      po.series.push(newSeries(hi, lo, gseed(po.seed + ROUNDS.findIndex((r) => r.key === round) * 31,
        i + (c === 'East' ? 0 : 50)), 7, { conf: c, round }))
    }
  }
  return po
}

const nameFor = (s) => (s.round === 'finals' ? 'NBA Finals' : roundName(s.round))

// The finished shape `teamRun` and the season report already understand.
export function bracketResult(po) {
  return {
    conf: po.conf,
    champion: po.champion,
    field: po.field,
    playIn: po.playIn,
    rounds: po.series.filter((s) => s.round !== 'playin').map((s) => ({ ...s, name: nameFor(s) })),
  }
}
