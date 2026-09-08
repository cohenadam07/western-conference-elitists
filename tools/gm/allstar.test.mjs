// All-Star weekend: the selections have to read like a ballot, and the two contests have to
// be winnable without being free.
import assert from 'node:assert'
import { rng } from '../../src/lib/gm/sim.js'
import {
  candidates, squads, threeField, dunkField, weekend, playGame,
  makeRate, shootRound, dunkRound, judge, landChance,
  DUNKS, RACKS, BALLS, MAX_THREE, STARTERS, RESERVES, SQUAD, ALLSTAR_GAME, needFor, SIDE_SWING,
} from '../../src/lib/gm/allstar.js'
import { setLeague, newLeague } from '../../src/lib/gm/league.js'
import { newSeason, playNext } from '../../src/lib/gm/season.js'

let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => { n++; if (a !== b) { bad++; console.log(`  FAIL ${m}: ${a} !== ${b}`) } }

// A season stopped where the break falls: about three-quarters of the way to the deadline
// plus a fortnight, which is 930 of the league's 1230 games.
setLeague(newLeague())
const state = newSeason(90210)
while (state.played < 930) playNext(state, 200)

/* ------------------------------------------------------------------- selections */
const cands = candidates(state)
ok(cands.length > 120, `candidate pool is a league, got ${cands.length}`)
ok(cands[0].score >= cands[cands.length - 1].score, 'candidates come back sorted')
ok(cands.every((c) => c.g >= 6), 'nobody with six games is on a ballot')

const sq = squads(state)
for (const c of ['East', 'West']) {
  eq(sq[c].squad.length, SQUAD, `${c} names twelve`)
  eq(sq[c].starters.length, STARTERS, `${c} starts five`)
  eq(sq[c].reserves.length, RESERVES, `${c} has seven reserves`)
  ok(sq[c].squad.every((p) => p.conf === c), `${c} squad is all ${c}`)
  const ids = new Set(sq[c].squad.map((p) => p.id))
  eq(ids.size, SQUAD, `${c} names twelve different men`)
  // Two guards and three frontcourt, unless the conference ran out of one.
  const bigs = sq[c].starters.filter((p) => p.big).length
  ok(bigs >= 2 && bigs <= 4, `${c} starting five is shaped like a ballot (${bigs} bigs)`)
  // Merit: a starter should out-produce the last reserve.
  ok(sq[c].starters[0].score > sq[c].reserves[RESERVES - 1].score,
    `${c} best starter beats the last reserve`)
}
const east = new Set(sq.East.squad.map((p) => p.id))
ok(!sq.West.squad.some((p) => east.has(p.id)), 'nobody is an All-Star in both conferences')

/* ---------------------------------------------------------------------- contests */
const three = threeField(state)
eq(three.length, 8, 'eight shooters')
ok(three.every((s) => (s.cap.sh ?? 0) >= 45, 'only shooters are invited'))
ok(three[0].shot >= three[7].shot, 'the field is seeded')

const dunk = dunkField(state)
eq(dunk.length, 4, 'four dunkers')
ok(dunk.every((d) => (d.cap.a ?? 30) <= 27), 'nobody enters the dunk contest at 30')
ok(dunk.every((d) => (d.cap.sz ?? 50) <= 74), 'no seven-footers in the dunk contest')

// The scoring bands. A round cannot exceed the racks and cannot go negative.
{
  const r = rng(7)
  let hi = 0, lo = 99
  for (const s of three) {
    for (let i = 0; i < 40; i++) {
      const { total } = shootRound(s, r)
      ok(total >= 0 && total <= MAX_THREE, `round inside 0..${MAX_THREE}, got ${total}`)
      hi = Math.max(hi, total); lo = Math.min(lo, total)
    }
  }
  ok(hi >= 20, `somebody shoots a good round eventually (best ${hi})`)
  ok(lo <= 20, `and somebody has a bad one (worst ${lo})`)
}
eq(MAX_THREE, 34, 'a perfect round is thirty-four')

// Make rate is bounded and monotone in the shooting rating.
ok(makeRate({ cap: { sh: 99 } }) > makeRate({ cap: { sh: 50 } }), 'better shooters make more')
ok(makeRate({ cap: { sh: 0 } }) >= 0.3 && makeRate({ cap: { sh: 99 } }) <= 0.82,
  'make rate stays inside its band')

// Dunks: harder is worth more and lands less.
for (let i = 1; i < DUNKS.length; i++) {
  const a = DUNKS[i - 1], b = DUNKS[i]
  if (b.tough > a.tough) ok(b.ceiling >= a.ceiling, `${b.name} is worth more than ${a.name}`)
}
ok(landChance(DUNKS[DUNKS.length - 1], 0.5) < landChance(DUNKS[0], 0.5),
  'the hardest dunk lands least often')
// The choice has to be real: four dunks within a few points of each other on expectation,
// so the hard one is a gamble rather than a trap or a free lunch.
{
  const r = rng(21)
  const evs = DUNKS.map((d) => {
    const need = needFor(d)
    let t = 0
    for (let i = 0; i < 4000; i++) {
      const acc = 1 - Math.abs(((i * 2654435761) % 1000) / 1000 - 0.5) * 2
      t += judge(d, acc >= need, 0.7, r)
    }
    return t / 4000
  })
  ok(Math.max(...evs) - Math.min(...evs) < 6,
    `no dunk dominates on expectation (${evs.map((x) => x.toFixed(1)).join(', ')})`)
  for (let i = 1; i < DUNKS.length; i++) ok(needFor(DUNKS[i]) > needFor(DUNKS[i - 1]),
    'a harder dunk needs a better stop')
  ok(needFor(DUNKS[DUNKS.length - 1]) < 0.85, 'even the hardest dunk is landable')
}
{
  const r = rng(11)
  for (const d of DUNKS) {
    for (let i = 0; i < 60; i++) {
      const s = judge(d, true, 0.7, r)
      ok(s >= 24 && s <= 50, `judges score out of fifty, got ${s}`)
      ok(judge(d, false, 0.7, r) < s + 3, 'a missed dunk scores worse than a clean one')
    }
  }
}

/* ---------------------------------------------------------------- the weekend */
const wk = weekend(state, 'OKC', 4)
eq(wk.threeScores.length, 8, 'every shooter shot')
eq(wk.dunkScores.length, 4, 'every dunker dunked')
ok(wk.yoursIn.game.every((p) => p.team === 'OKC'), 'your All-Stars are yours')
ok(wk.yoursIn.game.length >= 1, 'a 62-game contender has an All-Star')

// Determinism: the same season and the same seed give the same weekend, twice.
{
  const a = weekend(state, 'OKC', 4)
  const b = weekend(state, 'OKC', 4)
  eq(JSON.stringify(a.threeScores.map((x) => x.total)),
    JSON.stringify(b.threeScores.map((x) => x.total)), 'the weekend is deterministic')
  const c = weekend(state, 'OKC', 5)
  ok(JSON.stringify(a.threeScores.map((x) => x.total))
    !== JSON.stringify(c.threeScores.map((x) => x.total)), 'a different seed is a different night')
}

// The game: a scoreline in the right neighbourhood, and an MVP from the winning side.
{
  const r = rng(3)
  let lo = 999, hi = 0, east = 0, worst = 0
  for (let i = 0; i < 300; i++) {
    const g = playGame(sq, r)
    lo = Math.min(lo, g.east, g.west); hi = Math.max(hi, g.east, g.west)
    worst = Math.max(worst, Math.abs(g.east - g.west))
    if (g.winner === 'East') east++
    ok(g.mvp && sq[g.winner].squad.some((p) => p.id === g.mvp.id),
      'the MVP played for the winner')
  }
  ok(lo >= 120 && hi <= 230, `All-Star scores look like All-Star scores (${lo}..${hi})`)
  ok(worst <= 45, `and nobody wins one by fifty (worst margin ${worst})`)
  ok(east > 20 && east < 280, `neither conference wins every time (East ${east}/300)`)
}

eq(ALLSTAR_GAME, 57, 'the break lands just after the deadline')

console.log(`allstar: ${n - bad}/${n}`)
process.exit(bad ? 1 : 0)
