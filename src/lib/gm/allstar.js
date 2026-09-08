// ALL-STAR WEEKEND.
//
// The break was already in the calendar — five days with no games in the middle of February —
// and nothing happened in it. A season that stops for a weekend and then just resumes is a
// season with a hole in it, and the weekend is one of the few times a general manager gets to
// find out what the rest of the league thinks of his players.
//
// Everything here is chosen off what actually happened, the same as the awards: the season's
// box scores decide who goes, who starts, and who is invited to the contests. Nothing is
// seeded and nothing is scripted.
//
// The contests are the part the user plays. If one of his men is in the three-point shootout
// or the dunk contest, he shoots it himself — against a field of real players whose scores
// come from what those players can actually do.
import { SEED } from './seed.js'
import { rostersOf, simOf } from './league.js'
import { line as boxLine } from './box.js'
import { rng } from './sim.js'

const TEAMS = () => Object.keys(SEED.teams)
// Mid-February. The trade deadline is game 55, so the break lands just after it — which is the
// real order: you make your moves, then everybody stops for five days.
export const ALLSTAR_GAME = 57

export const conf = (t) => SEED.teams[t]?.conf
export const STARTERS = 5
export const RESERVES = 7
export const SQUAD = STARTERS + RESERVES

/* ------------------------------------------------------------------ who goes */

// One row per player who has played enough of the first half to be considered.
export function candidates(state) {
  const rows = []
  for (const team of TEAMS()) {
    const rec = state.rec?.[team] || { w: 0, l: 0 }
    const gp = rec.w + rec.l
    const winPct = gp ? rec.w / gp : 0
    const sims = simOf(team)
    for (const cap of rostersOf(team)) {
      const sim = sims.find((x) => x.n === cap.n)
      const b = state.stats?.[sim?.id]
      const l = boxLine(b)
      if (!l || l.g < Math.max(6, gp * 0.5)) continue
      rows.push({
        ...l, cap, sim, team, conf: conf(team), winPct,
        // Coaches pick All-Stars off production and the standings, in that order, and they
        // have never once picked a man because of his contract.
        score: (l.pts * 1.0 + l.reb * 0.55 + l.ast * 0.95 + l.stl * 1.5 + l.blk * 1.2 - l.tov * 0.9)
          * (0.72 + winPct * 0.56),
        big: (cap.slot ?? 3) >= 3.6,
      })
    }
  }
  return rows.sort((a, b) => b.score - a.score)
}

// Twelve a conference: five starters — the ballot has always been two guards and three
// frontcourt players — and seven reserves taken on merit alone.
export function squads(state) {
  const all = candidates(state)
  const out = {}
  for (const c of ['East', 'West']) {
    const pool = all.filter((r) => r.conf === c)
    const guards = pool.filter((r) => !r.big)
    const bigs = pool.filter((r) => r.big)
    const starters = [...guards.slice(0, 2), ...bigs.slice(0, 3)]
    const taken = new Set(starters.map((r) => r.id))
    // A short conference can leave the frontcourt unfilled; take the best available rather
    // than starting four men.
    for (const r of pool) {
      if (starters.length >= STARTERS) break
      if (!taken.has(r.id)) { starters.push(r); taken.add(r.id) }
    }
    const reserves = pool.filter((r) => !taken.has(r.id)).slice(0, RESERVES)
    out[c] = { starters, reserves, squad: [...starters, ...reserves] }
  }
  return out
}

/* ---------------------------------------------------------------- the contests */

// Eight shooters, chosen the way the league chooses them: men who take a lot of threes and
// make them. Volume matters — a 44% shooter on two attempts a night is not invited.
export function threeField(state, n = 8) {
  return candidates(state)
    .filter((r) => (r.cap.sh ?? 0) >= 45)
    .map((r) => ({ ...r, shot: (r.cap.sh ?? 50) * 0.62 + (r.cap.gr ?? 50) * 0.38 }))
    .sort((a, b) => b.shot - a.shot)
    .slice(0, n)
}

// Four dunkers: young, springy, and living at the rim. Nobody has ever entered this at 34.
export function dunkField(state, n = 4) {
  return candidates(state)
    // Young, and not seven foot four. The first version had Victor Wembanyama entered, which
    // is a sentence that explains itself: the contest is for men who jump, and length is not
    // the same thing as hops. Size helps up to a point and then stops being an advantage.
    .filter((r) => (r.cap.a ?? 30) <= 27 && (r.cap.slot ?? 3) <= 4.3 && (r.cap.sz ?? 50) <= 74)
    .map((r) => ({ ...r, hops: (r.cap.rpr ?? 50) * 0.62 + (r.cap.sz ?? 50) * 0.1
      + Math.max(0, 28 - (r.cap.a ?? 26)) * 2.4 + (r.cap.body?.vert ?? 34) * 0.7 }))
    .sort((a, b) => b.hops - a.hops)
    .slice(0, n)
}

/* --------------------------------------------------- the three-point shootout */
//
// Five racks of five. Four ordinary balls and a money ball on each rack, and the last rack is
// all money balls — so a round is worth 34 at most, and the difference between a good round
// and a winning one is almost entirely the money balls.
export const RACKS = 5
export const BALLS = 5
// Four racks of four ones and a money ball is six apiece, and the last rack is all money
// balls, which is ten. Thirty-four, and the money balls are more than a third of it.
export const MAX_THREE = (RACKS - 1) * ((BALLS - 1) + 2) + BALLS * 2

// What this man makes on a rack, as a probability per ball. A contest is a different shot from
// a game shot — nobody is closing out — so the floor is high and the spread is narrower than
// a season's three-point percentage.
export const makeRate = (shooter) => Math.max(0.3, Math.min(0.82,
  0.34 + ((shooter?.cap?.sh ?? 50) / 100) * 0.46))

// A CPU shooter's round, ball by ball, so the scoreboard can show where he lost it.
export function shootRound(shooter, r) {
  const p = makeRate(shooter)
  const racks = []
  let total = 0
  for (let i = 0; i < RACKS; i++) {
    const money = i === RACKS - 1
    const balls = []
    for (let j = 0; j < BALLS; j++) {
      const worth = money || j === BALLS - 1 ? 2 : 1
      const made = r.rand() < p
      if (made) total += worth
      balls.push({ made, worth })
    }
    racks.push(balls)
  }
  return { total, racks }
}

/* -------------------------------------------------------------- the dunk contest */

// Four dunks to choose from, and the choice is the game: the harder it is, the more it is
// worth and the less often it lands.
//
// The first table had them at 44, 47, 49 and 50 with a floor of 30 for a miss, which made the
// choice a lie — the easy dunk was worth 44 nine times in ten and the hard one 50 half the
// time with 30-odd as the consolation, so nothing but the windmill was ever correct. The
// spread has to be wide at BOTH ends: a clean windmill is a good-not-great forty, a clean 360
// is a fifty, and a blown 360 is a twenty-five while a blown windmill is still a thirty-four.
// That puts the four of them within a couple of points of each other on expectation and
// leaves the difference where it belongs, in the variance.
export const DUNKS = [
  { key: 'windmill', name: 'Windmill from the dotted line', tough: 0.20, ceiling: 40 },
  { key: 'between', name: 'Between the legs, one hand', tough: 0.34, ceiling: 44 },
  { key: 'over', name: 'Over a team-mate, reverse', tough: 0.48, ceiling: 47 },
  { key: 'twohonour', name: 'Off the side of the backboard, 360', tough: 0.62, ceiling: 50 },
]

// How well the user has to stop the bar to land it. The UI quotes 1 - this as his odds, so
// the number on the button is the number he is actually playing against — the CPU's own
// landChance below is a different thing and quoting THAT at him was simply wrong.
export const needFor = (dunk) => 0.22 + dunk.tough * 0.55

// Judges score out of ten, five of them, so a dunk is out of fifty. A clean hard dunk is a
// fifty; a clean easy one is a forty; a miss costs more the more you were reaching for.
export function judge(dunk, clean, hops, r) {
  const base = dunk.ceiling - (1 - hops) * 6
  const noise = r.gauss(0, 1.6)
  const score = clean ? base + noise : base - 6 - dunk.tough * 14 - Math.abs(noise) * 2
  return Math.max(24, Math.min(50, Math.round(score)))
}

// Whether a CPU dunker lands it. Springs help; difficulty hurts.
export const landChance = (dunk, hops) => Math.max(0.25, Math.min(0.95, 0.94 - dunk.tough * 0.9 + (hops - 0.5) * 0.3))

export function dunkRound(dunker, r, hops) {
  const dunk = DUNKS[Math.min(DUNKS.length - 1, Math.floor(r.rand() * DUNKS.length * 0.9 + 0.6))]
  const clean = r.rand() < landChance(dunk, hops)
  return { dunk, clean, score: judge(dunk, clean, hops, r) }
}

/* ------------------------------------------------------------------ the weekend */

// Everything that happens over the weekend, in one object, decided from one seed so a
// replayed season produces the same weekend.
export function weekend(state, mine, seed = 0) {
  const r = rng((seed ^ 0xa11a2) >>> 0)
  const sq = squads(state)
  const three = threeField(state)
  const dunk = dunkField(state)
  const norm = (x) => Math.max(0, Math.min(1, x))
  const hopsOf = (d) => norm(((d.hops ?? 50) - 40) / 55)

  // The contests are played by the CPU up front; if one of them is yours the app throws away
  // that man's round and lets the user shoot it himself.
  const threeScores = three.map((s) => ({ who: s, ...shootRound(s, r) }))
  const dunkScores = dunk.map((d) => ({ who: d, ...dunkRound(d, r, hopsOf(d)) }))

  const yoursIn = {
    three: three.filter((s) => s.team === mine),
    dunk: dunk.filter((d) => d.team === mine),
    game: [...sq.East.squad, ...sq.West.squad].filter((s) => s.team === mine),
  }
  return { squads: sq, three, dunk, threeScores, dunkScores, yoursIn, seed }
}

// Which conference won the game, and who took it over. Played off the two squads rather than
// simulated possession by possession — an All-Star game is not a basketball game and pretending
// otherwise gives you a 92-88 defensive struggle in February.
//
// Twelve men share two hundred and forty minutes, so nobody plays his usual load; but nobody
// guards anybody either, so what he does play he does at a rate he could never sustain. The two
// roughly cancel at about six-tenths of the squad's combined scoring, which lands a game in the
// hundred-and-forties where it belongs.
// ONE roll, applied to the two sides in opposite directions — a tilt rather than two guesses.
// Two independent draws a fifth wide can land a fifth apart and produce a fifty-point All-Star
// game, which has never happened.
export const SIDE_SWING = 0.075
export const GAME_SCALE = 0.57
// How much of the gap between the two squads actually shows up on the scoreboard. Almost none
// of it, and that is not cynicism: an All-Star game is an exhibition, the better squad does not
// try harder, and the twelve men on the losing side are also the best players alive. Left
// undamped, a fourteen per cent difference in combined scoring beat a seven per cent tilt every
// time and the East won forty-five games out of six hundred.
export const TALENT_WEIGHT = 0.35
export function playGame(sq, r) {
  const tilt = (r.rand() - 0.5) * 2 * SIDE_SWING
  const raw = (rows) => rows.reduce((s, x) => s + x.pts * (0.95 + r.rand() * 0.1), 0)
  const rawE = raw(sq.East.squad)
  const rawW = raw(sq.West.squad)
  const mid = (rawE + rawW) / 2
  const damp = (x) => mid + (x - mid) * TALENT_WEIGHT
  const east = Math.round(damp(rawE) * GAME_SCALE * (1 + tilt))
  const west = Math.round(damp(rawW) * GAME_SCALE * (1 - tilt))
  const winner = east >= west ? 'East' : 'West'
  const pool = sq[winner].squad
  const mvp = pool.map((p) => ({ p, n: p.pts * (0.7 + r.rand() * 0.8) }))
    .sort((a, b) => b.n - a.n)[0]?.p
  return { east, west, winner, mvp }
}
