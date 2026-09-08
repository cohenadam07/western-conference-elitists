// Schedule, standings and the season loop — the browser port of season_engine.py.
//
// The real 82-game formula:
//   16  4 games vs each of 4 division opponents
//   24  4 games vs 6 of the 10 other conference teams
//   12  3 games vs the remaining 4
//   30  2 games vs all 15 in the other conference
//
// Which conference opponents get four is decided by position-within-division:
// 4 games <=> (p_i - p_j) mod 5 in {0,1,4}. That set is closed under negation mod 5, so
// the relation is symmetric, and it picks 3 of 5 positions in each of the 2 other
// divisions — exactly six 4-game opponents per team.
import { SEED } from './seed.js'
import { playableSim } from './league.js'
import { withForm } from './form.js'
import { simulate, rng } from './sim.js'
import { accrue } from './box.js'
import { drawGroups, groupPairings, qualifiers, openKnockout, advanceKnockout } from './cup.js'
import { assignDays, dayToDate } from './calendar.js'

export const TEAMS = Object.keys(SEED.teams).sort()
const conf = (t) => SEED.teams[t].conf
const div = (t) => SEED.teams[t].div
const pos = (t) => SEED.teams[t].pos

// Who hosts the extra game in a 3-game series is an Eulerian orientation: every team has
// four such opponents and needs exactly two at 2-1 home to reach 41 home games. A hash
// leaves teams at 39-43 and quietly hands some of them extra home court all season.
function threeGameHosts() {
  const hosts = new Map()
  for (const c of ['East', 'West']) {
    const adj = new Map()
    const inConf = TEAMS.filter((t) => conf(t) === c)
    inConf.forEach((a) => adj.set(a, []))
    for (let i = 0; i < inConf.length; i++)
      for (let j = i + 1; j < inConf.length; j++) {
        const a = inConf[i], b = inConf[j]
        if (div(a) === div(b)) continue
        const d = (((pos(a) - pos(b)) % 5) + 5) % 5
        if (d === 0 || d === 1 || d === 4) continue
        adj.get(a).push(b); adj.get(b).push(a)
      }
    const used = new Set()
    const key = (x, y) => [x, y].sort().join('|')
    const stack = [inConf[0]], circuit = []
    while (stack.length) {
      const v = stack[stack.length - 1]
      const next = (adj.get(v) || []).find((u) => !used.has(key(v, u)))
      if (next === undefined) circuit.push(stack.pop())
      else { used.add(key(v, next)); stack.push(next) }
    }
    circuit.reverse()
    for (let i = 0; i + 1 < circuit.length; i++)
      hosts.set(key(circuit[i], circuit[i + 1]), circuit[i])
  }
  return hosts
}

let HOSTS = null

export function buildSchedule(seed = 0, opts = {}) {
  if (!HOSTS) HOSTS = threeGameHosts()
  // Cup group games have to be PLAYED IN NOVEMBER, which means the pairings cannot be left
  // to the shuffle — a group opponent drawn into March is not a group game. They are placed
  // into the opening rounds first and everything else fills in around them.
  const cupPairs = new Set((opts.cupPairings || []).map((p) => [p.a, p.b].sort().join('|')))
  const key = (x, y) => [x, y].sort().join('|')
  const games = []
  for (let i = 0; i < TEAMS.length; i++)
    for (let j = i + 1; j < TEAMS.length; j++) {
      const a = TEAMS[i], b = TEAMS[j]
      let n, homeA
      if (conf(a) !== conf(b)) { n = 2; homeA = 1 }
      else if (div(a) === div(b)) { n = 4; homeA = 2 }
      else {
        const d = (((pos(a) - pos(b)) % 5) + 5) % 5
        if (d === 0 || d === 1 || d === 4) { n = 4; homeA = 2 }
        else { n = 3; homeA = HOSTS.get(key(a, b)) === a ? 2 : 1 }
      }
      for (let k = 0; k < n; k++) games.push(k < homeA ? [a, b] : [b, a])
    }
  // Order into ROUNDS — each team plays at most once per round — instead of shuffling
  // flat. A flat shuffle leaves teams 5+ games apart mid-season, so the standings show
  // 42-13 next to 43-17 and cannot be read against each other. This is also how a real
  // schedule behaves: everyone moves through the calendar together.
  const r = rng(seed || 1)
  r.shuffle(games)
  // Cup games go to the front of the queue, so the round packer places them in the opening
  // rounds — which the calendar dates into November, where they belong.
  const isCup = (g) => cupPairs.has([g[0], g[1]].sort().join('|'))
  const cupFirst = [...games.filter(isCup), ...games.filter((g) => !isCup(g))]
  const rounds = []
  const pending = cupFirst.map((g, i) => ({ g, i, used: false }))
  let remaining = pending.length
  while (remaining > 0) {
    const busy = new Set()
    const round = []
    for (const item of pending) {
      if (item.used) continue
      const [h, a] = item.g
      if (busy.has(h) || busy.has(a)) continue
      busy.add(h); busy.add(a)
      round.push(item.g)
      item.used = true
      remaining--
    }
    rounds.push(round)
  }
  // Flat, for everything that already reads `schedule[i]`, with the round index and the day
  // each game falls on carried alongside — dates are what make an All-Star break, a Cup
  // group stage and a back-to-back possible at all.
  const cal = assignDays(rounds.length)
  const flat = [], roundOf = [], dayOf = [], cupOf = []
  // A group pairing meets three or four times across the year and exactly ONE of those is
  // the Cup game. Flagging every meeting gave teams fifteen group games apiece; the first
  // meeting — which the packer has already put in November — is the one that counts.
  const claimed = new Set()
  rounds.forEach((round, ri) => {
    for (const g of round) {
      const k = [g[0], g[1]].sort().join('|')
      const cup = isCup(g) && !claimed.has(k)
      if (cup) claimed.add(k)
      flat.push(g); roundOf.push(ri); dayOf.push(cal.days[ri]); cupOf.push(cup)
    }
  })
  return { games: flat, round: roundOf, day: dayOf, cup: cupOf, cal, rounds: rounds.length }
}

export function newSeason(seed, opts = {}) {
  // The Cup is drawn BEFORE the schedule, because its group games have to land in November
  // and the packer needs to know which pairings to place first. Drawing it afterwards put
  // group opponents in March, which is a fixture, not a group game.
  const cupR = opts.cup === false ? null : rng((seed ^ 0x0c07) >>> 0)
  const groups = cupR ? drawGroups(cupR, opts.lastYear || null) : null
  const built = buildSchedule(seed, { ...opts, cupPairings: groups ? groupPairings(groups) : [] })
  const rec = {}
  TEAMS.forEach((t) => { rec[t] = { w: 0, l: 0, pf: 0, pa: 0 } })
  return {
    seed,
    schedule: built.games,
    round: built.round,
    day: built.day,
    cup: built.cup,
    cal: built.cal,
    startYear: opts.startYear ?? parseInt(SEED.season, 10),
    played: 0,
    rec,
    // The Cup, carried on the season rather than on the save: it belongs to this year and it
    // is rebuilt with the schedule when a career is replayed from its progress marker.
    cupGroups: groups,
    cupResults: [],
    knockout: null,
    results: [],
    // What actually happened, player by player, folded forward game by game. Everything
    // voted on at the end of the year is argued from this and nothing else.
    stats: {},
    last: null,
  }
}

// Where we are in the year, and what the date is.
export const dayOfGame = (state, i) => state.day?.[i] ?? 0
export const currentDay = (state) => (state.played > 0 ? dayOfGame(state, state.played - 1) : 0)
export const dateOf = (state, day) => dayToDate(state.startYear ?? 2026, day ?? 0)
export const isCupGame = (state, i) => !!state.cup?.[i]

// Deterministic per-game seed: derived from the season seed and the game index, so the
// same season always produces the same games regardless of how it was stepped through.
const gameSeed = (seasonSeed, i) => (Math.imul(seasonSeed ^ (i + 1), 0x9e3779b1) >>> 0) % 2147483647

export function playNext(state, n = 1, opts = {}) {
  const out = []
  for (let k = 0; k < n && state.played < state.schedule.length; k++) {
    const i = state.played
    const [h, a] = state.schedule[i]
    const wantTrace = opts.traceTeam && (h === opts.traceTeam || a === opts.traceTeam)
    // Form is applied to the profiles, never inside the engine — see form.js.
    const hs = withForm(playableSim(h), gameSeed(state.seed, i))
    const as = withForm(playableSim(a), gameSeed(state.seed, i) ^ 0x5f5f)
    const { score, box, nPoss, trace, lineups } = simulate(hs, as, gameSeed(state.seed, i), !!wantTrace)
    // Keep the box. The engine hands one back for every game and the season used to drop
    // it on the floor, which meant nothing that happened on a Tuesday in January could ever
    // be referred to again.
    if (state.stats) {
      accrue(state.stats, h, hs, box, lineups?.home)
      accrue(state.stats, a, as, box, lineups?.away)
    }
    // A Cup group game is an ordinary league game that also counts twice. Recording the
    // result here rather than deriving it later means the group table is a fold over what
    // was actually played, and a replayed season rebuilds it identically.
    if (state.cupGroups && state.cup?.[i]) {
      state.cupResults.push({ home: h, away: a, hs: score.home, as: score.away })
    }
    const homeWin = score.home >= score.away
    state.rec[h].w += homeWin ? 1 : 0; state.rec[h].l += homeWin ? 0 : 1
    state.rec[a].w += homeWin ? 0 : 1; state.rec[a].l += homeWin ? 1 : 0
    state.rec[h].pf += score.home; state.rec[h].pa += score.away
    state.rec[a].pf += score.away; state.rec[a].pa += score.home
    const g = { i, home: h, away: a, hs: score.home, as: score.away, nPoss }
    state.results.push(g)
    if (wantTrace) state.last = { ...g, trace, box }
    out.push(g)
    state.played++
  }
  return out
}

export function standings(state) {
  const by = { East: [], West: [] }
  TEAMS.forEach((t) => {
    const r = state.rec[t]
    const gp = r.w + r.l
    by[conf(t)].push({
      team: t, ...r, gp,
      pct: gp ? r.w / gp : 0,
      diff: gp ? (r.pf - r.pa) / gp : 0,
    })
  })
  for (const c of ['East', 'West'])
    by[c].sort((x, y) => y.pct - x.pct || y.diff - x.diff)
  return by
}

export const teamGames = (state, team) =>
  state.results.filter((g) => g.home === team || g.away === team)

/* ------------------------------------------------------------------- the Cup */

// The group stage is over when all sixty group games have been played. Sixty and not
// "everybody has four" because a team can be idle for a fortnight while the rest catch up,
// and opening the bracket on a partial table would seed it off half a group.
export const cupGroupDone = (state) => !!state.cupGroups && (state.cupResults?.length ?? 0) >= 60

// One knockout tie, played with the same engine and the same form the league uses. Single
// elimination, so a tie is one game — and a draw is impossible, which is why the loop that
// resolves them can be this short.
export function playCupTie(state, tie, i = 0) {
  const seed = (Math.imul(state.seed ^ (0x0c07 + i), 0x9e3779b1) >>> 0) % 2147483647
  const hs = withForm(playableSim(tie.hi), seed)
  const as = withForm(playableSim(tie.lo), seed ^ 0x5f5f)
  const { score, box } = simulate(hs, as, seed)
  // Vegas is neutral, so nobody gets the building — but the engine's home advantage is baked
  // into the profiles it is handed, not into a flag, so the only honest neutral is to play it
  // and let the seed decide. The higher seed keeps the nominal home slot for display.
  const homeWin = score.home >= score.away
  return { ...tie, hs: score.home, as: score.away, winner: homeWin ? tie.hi : tie.lo,
    loser: homeWin ? tie.lo : tie.hi, box }
}

// Play every tie in the current round at once. The Cup is a two-week tournament, not a
// series, and the rounds are what the pageantry hangs off.
export function playCupRound(state, kn) {
  const next = { ...kn, ties: kn.ties.map((t) => ({ ...t })) }
  let i = 0
  next.ties = next.ties.map((t) => (t.round === next.stage && !t.winner
    ? playCupTie(state, t, i++) : t))
  return advanceKnockout(next)
}
