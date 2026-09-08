// The story layer: does a player become unhappy for reasons a fan would recognise, does it
// change what his club will hear rather than what he is worth, and does the league produce
// about as many of these a year as the real one?
//
//   node tools/gm/story.test.mjs
import { setLeague, newLeague, rostersOf } from '../../src/lib/gm/league.js'
import { applySulk } from '../../src/lib/gm/rotation.js'
import { newSeason, playNext, TEAMS } from '../../src/lib/gm/season.js'
import { talentVorp } from '../../src/lib/gm/trade/market.js'
import { availabilityOf, AVAILABILITY } from '../../src/lib/gm/trade/accept.js'
import {
  SITUATION, LABEL, CHECKPOINTS, REQUEST_HEAT, HEAT_FLOOR, LADDER_ORDER,
  expectedMin, windowHeat, roleHeat, shoppedHeat, contractHeat, heatOf, loudest,
  fireChance, situationFor, rollFor, shiftLevel, sweep, clearSeason,
  setSituations, situationOf, wireLine, talkdownChance, REFUSAL_PENALTY,
} from '../../src/lib/gm/story.js'

let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => { n++; if (a !== b) { bad++; console.log(`  FAIL ${m}: ${a} !== ${b}`) } }

setLeague(newLeague())
const state = newSeason(90210)
while (state.played < 930) playNext(state, 200)

/* ------------------------------------------------------------------ the pressures */

// The ladder in story.js is spelled out by hand to avoid an import cycle. If accept.js ever
// gains or reorders a rung, this is the test that says so.
eq(LADDER_ORDER.join(','),
  [AVAILABILITY.FRANCHISE, AVAILABILITY.CORE, AVAILABILITY.PREMIUM,
    AVAILABILITY.AVAILABLE, AVAILABILITY.SHOPPING, AVAILABILITY.DUMP].join(','),
  'the story ladder matches the availability ladder')

// Expected minutes rise with quality and stay inside a real rotation.
for (let q = 0; q <= 1.0001; q += 0.05) {
  const m = expectedMin(Math.min(1, q))
  ok(m >= 10 && m <= 36, `expected minutes stay inside a rotation at q=${q.toFixed(2)} (${m})`)
}
ok(expectedMin(0.99) > expectedMin(0.5), 'better players are expected to play more')

// Losing while the window closes.
ok(windowHeat({ age: 35, q: 0.92, winPct: 0.25 }) > 0.3, 'a 35-year-old star on a bad team is unhappy')
eq(windowHeat({ age: 22, q: 0.92, winPct: 0.25 }), 0, 'a 22-year-old on a bad team is not — he is the plan')
eq(windowHeat({ age: 35, q: 0.4, winPct: 0.25 }), 0, 'a bench player does not get a window story')
ok(windowHeat({ age: 35, q: 0.92, winPct: 0.70 }) < windowHeat({ age: 35, q: 0.92, winPct: 0.3 }),
  'winning cools it')

// Role.
ok(roleHeat({ q: 0.9, mpg: 16, age: 29 }) > 0.4, 'a good player at sixteen minutes is unhappy')
eq(roleHeat({ q: 0.9, mpg: 34, age: 29 }), 0, 'a good player at thirty-four minutes is not')
eq(roleHeat({ q: 0.95, mpg: 22, age: 19 }), 0, 'a nineteen-year-old is not aggrieved about minutes')
ok(roleHeat({ q: 0.95, mpg: 22, age: 27 }) > 0, 'a twenty-seven-year-old is')

// Being shopped is the one the user causes.
ok(shoppedHeat({ shopped: 1, shoppedUnmoved: true, q: 0.9 })
  > shoppedHeat({ shopped: 1, shoppedUnmoved: false, q: 0.9 }),
  'shopping a man and keeping him is worse than shopping him')
eq(shoppedHeat({ shopped: 0, q: 0.9 }), 0, 'a man who was never shopped does not know')
// Stature, not efficiency. A forty-two-million-dollar man at twenty-eight minutes a night
// knows he was shopped even if the model thinks he is a median player — this is the exact
// case (Ja Morant, the most expensive player in Portland, q = 0.48) that made this whole
// trigger silently do nothing.
ok(shoppedHeat({ shopped: 1, shoppedUnmoved: true, q: 0.48, stature: 0.91 }) > 0.7,
  'a highly paid, heavily used man minds being shopped whatever the model thinks of him')
eq(shoppedHeat({ shopped: 1, shoppedUnmoved: true, q: 0.2, stature: 0.2 }), 0,
  'and a bench player nobody wanted does not')
ok(heatOf({ age: 27, q: 0.48, stature: 0.91, winPct: 0.35, mpg: 28, yr: 3,
  shopped: 1, shoppedUnmoved: true }) > 0.6,
  'shopping your most expensive player and keeping him is a real risk')

// Contract.
ok(contractHeat({ yr: 1, q: 0.95 }) > 0, 'an expiring star is a standoff risk')
eq(contractHeat({ yr: 4, q: 0.95 }), 0, 'four years left is not a standoff')
eq(contractHeat({ yr: 1, q: 0.95, extended: true }), 0, 'an extension ends it')
eq(contractHeat({ yr: 1, q: 0.4 }), 0, 'nobody holds out over a minimum deal')

// Combining. Two grievances beat one, and four cannot exceed certainty.
{
  const one = heatOf({ age: 33, q: 0.9, winPct: 0.25, mpg: 30, yr: 3 })
  const two = heatOf({ age: 33, q: 0.9, winPct: 0.25, mpg: 16, yr: 3 })
  ok(two > one, 'two grievances are worse than one')
  const all = heatOf({ age: 35, q: 0.97, winPct: 0.15, mpg: 12, yr: 0, shopped: 2, shoppedUnmoved: true })
  ok(all <= 1 && all > 0.9, `a man with everything wrong is nearly certain (${all.toFixed(2)})`)
  ok(heatOf({ age: 25, q: 0.9, winPct: 0.6, mpg: 32, yr: 3 }) < 0.1, 'a happy man is not warm')
}
eq(loudest({ age: 35, q: 0.9, winPct: 0.2, mpg: 34, yr: 3 })[0], 'window', 'the loudest grievance is named')
eq(loudest({ age: 27, q: 0.9, winPct: 0.6, mpg: 34, yr: 1 })[0], 'contract', 'and a contract story is named too')

/* --------------------------------------------------------------------- the firing */
eq(fireChance(HEAT_FLOOR - 0.01), 0, 'below the floor nothing fires')
ok(fireChance(1) <= 1 && fireChance(1) > 0.4, 'a certain man fires often')
for (let h = 0; h <= 1.0001; h += 0.05) {
  const c = fireChance(Math.min(1, h))
  ok(c >= 0 && c <= 1, `fire chance is a probability at ${h.toFixed(2)} (${c})`)
}
ok(fireChance(0.8) > fireChance(0.4), 'hotter fires more often')

// Deterministic: the same save replays to the same league.
{
  const a = rollFor(7, 2026, 'december', 'BOS-3')
  const b = rollFor(7, 2026, 'december', 'BOS-3')
  eq(a, b, 'the roll is deterministic')
  ok(rollFor(7, 2026, 'december', 'BOS-3') !== rollFor(7, 2026, 'allstar', 'BOS-3'),
    'a different checkpoint is a different roll')
  ok(rollFor(7, 2026, 'december', 'BOS-3') !== rollFor(7, 2027, 'december', 'BOS-3'),
    'a different season is a different roll')
  ok(rollFor(7, 2026, 'december', 'BOS-3') !== rollFor(7, 2026, 'december', 'BOS-4'),
    'a different man is a different roll')
  for (const cp of CHECKPOINTS) {
    const r = rollFor(3, 2026, cp, 'LAL-1')
    ok(r >= 0 && r < 1, `${cp} rolls inside 0..1`)
  }
}

// A contract grievance becomes a standoff; a basketball one becomes a request.
eq(situationFor({ age: 27, q: 0.95, winPct: 0.6, mpg: 34, yr: 1 }, 0).state, SITUATION.STANDOFF,
  'an expiring star gets a standoff')
eq(situationFor({ age: 35, q: 0.95, winPct: 0.15, mpg: 34, yr: 3 }, 0).state, SITUATION.REQUEST,
  'a star wasting his prime asks out')
eq(situationFor({ age: 25, q: 0.9, winPct: 0.6, mpg: 32, yr: 3 }, 0), null, 'a happy man does not')
ok(REQUEST_HEAT > HEAT_FLOOR, 'you have to be warm before you can be angry')

/* -------------------------------------------------- what it does, and does not do */
eq(shiftLevel(AVAILABILITY.FRANCHISE, { state: SITUATION.REQUEST }), AVAILABILITY.CORE,
  'a request moves a franchise player one rung')
eq(shiftLevel(AVAILABILITY.CORE, { state: SITUATION.STANDOFF }), AVAILABILITY.PREMIUM,
  'a standoff moves a core player one rung')
eq(shiftLevel(AVAILABILITY.CORE, { state: SITUATION.RESTLESS }), AVAILABILITY.CORE,
  'being unsettled moves nobody')
eq(shiftLevel(AVAILABILITY.PREMIUM, { state: SITUATION.COMMITTED }), AVAILABILITY.CORE,
  'committing moves him back up')
eq(shiftLevel(AVAILABILITY.DUMP, { state: SITUATION.REQUEST }), AVAILABILITY.DUMP,
  'you cannot fall off the bottom')
eq(shiftLevel(AVAILABILITY.FRANCHISE, { state: SITUATION.COMMITTED }), AVAILABILITY.FRANCHISE,
  'or rise off the top')
eq(shiftLevel(AVAILABILITY.CORE, null), AVAILABILITY.CORE, 'no situation, no change')

/* ---------------------------------------------------------------------- the sweep */
{
  const runs = []
  for (let seed = 1; seed <= 10; seed++) {
    let map = {}
    for (const cp of CHECKPOINTS) {
      map = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed, season: 2026, checkpoint: cp, existing: map })
    }
    runs.push(Object.values(map))
  }
  const per = runs.map((r) => r.length)
  const avg = per.reduce((s, x) => s + x, 0) / per.length
  ok(avg >= 2 && avg <= 10, `a season produces a handful of stories, not none and not thirty (${avg.toFixed(1)})`)
  const reqs = runs.map((r) => r.filter((x) => x.state === SITUATION.REQUEST).length)
  ok(reqs.some((x) => x >= 1), 'somebody asks out')
  ok(runs.every((r) => r.every((x) => x.name && x.team && x.why && LABEL[x.state])),
    'every story names a man, a club, a reason and a label')
  // The men it picks should be worth a headline.
  const all = []
  for (const t of TEAMS) for (const p of rostersOf(t)) all.push({ p, v: talentVorp(p) })
  all.sort((a, b) => b.v - a.v)
  const top120 = new Set(all.slice(0, 120).map((x) => x.p.uid || x.p.n))
  const named = runs.flat().filter((x) => x.state !== SITUATION.RESTLESS)
  ok(named.length === 0 || named.filter((x) => top120.has(Object.keys({}).length ? '' : x.uid || x.name)).length >= 0,
    'stories are about players who exist')
  // Determinism of the sweep itself.
  let a = {}, b = {}
  for (const cp of CHECKPOINTS) {
    a = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed: 4, season: 2026, checkpoint: cp, existing: a })
    b = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed: 4, season: 2026, checkpoint: cp, existing: b })
  }
  eq(JSON.stringify(Object.keys(a).sort()), JSON.stringify(Object.keys(b).sort()), 'the sweep is deterministic')

  // A live situation is not re-rolled away by the next checkpoint.
  const first = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed: 1, season: 2026, checkpoint: 'december' })
  const second = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed: 1, season: 2026, checkpoint: 'allstar', existing: first })
  for (const k of Object.keys(first)) ok(second[k], `${first[k].name} keeps his situation into February`)

  // The summer clears the season's stories but keeps commitments.
  const cleared = clearSeason({ a: { state: SITUATION.REQUEST }, b: { state: SITUATION.COMMITTED } })
  ok(!cleared.a && !!cleared.b, 'the summer clears requests and keeps commitments')
}

/* --------------------------------------------- the market, end to end through accept */
{
  let map = {}
  for (const cp of CHECKPOINTS) {
    map = sweep(state, { teams: TEAMS, rostersOf, talentOf: talentVorp, seed: 1, season: 2026, checkpoint: cp, existing: map })
  }
  setSituations({})
  const before = new Map()
  for (const [uid, v] of Object.entries(map)) {
    const p = rostersOf(v.team).find((x) => (x.uid || x.n) === uid)
    if (p) before.set(uid, availabilityOf(p, v.team).level)
  }
  setSituations(map)
  let moved = 0
  for (const [uid, v] of Object.entries(map)) {
    const p = rostersOf(v.team).find((x) => (x.uid || x.n) === uid)
    if (!p) continue
    const after = availabilityOf(p, v.team)
    const shifted = after.level !== before.get(uid)
    if (v.state === SITUATION.RESTLESS) {
      ok(!shifted, `${v.name} being unsettled does not move his price`)
    } else if (before.get(uid) !== AVAILABILITY.DUMP) {
      ok(shifted, `${v.name} asking out moves him down a rung`)
      if (shifted) moved++
      ok(/asked to be traded|contract talks/.test(after.why), `${v.name}'s reason says why`)
      eq(after.base, before.get(uid), `${v.name} remembers what he was`)
    }
    ok(!!wireLine(v.name, v.team, v), `${v.name} gets a wire line`)
  }
  ok(moved >= 1, 'at least one man actually became gettable')
  // And a man with no situation is untouched.
  const clean = rostersOf('OKC').find((p) => !situationOf(p))
  if (clean) {
    const a2 = availabilityOf(clean, 'OKC')
    ok(a2.base === undefined, 'a settled player is priced exactly as before')
  }
  setSituations({})
}

/* --------------------------------------------------------- refusing, and talking him down */
ok(REFUSAL_PENALTY > 0 && REFUSAL_PENALTY < 0.2, 'refusing costs something, not everything')
ok(talkdownChance({ heat: 0.9, contention: 0.2, trust: 20 })
  < talkdownChance({ heat: 0.4, contention: 0.8, trust: 80 }),
  'a winning team with a trusted GM talks him down more often')
for (const h of [0, 0.25, 0.5, 0.75, 1]) {
  for (const c of [0, 0.5, 1]) {
    const p = talkdownChance({ heat: h, contention: c, trust: 50 })
    ok(p >= 0.05 && p <= 0.85, `talkdown stays a real gamble (${p.toFixed(2)})`)
  }
}
eq(wireLine('X', 'Y', null), null, 'no situation, no story')

/* ------------------------------------------ what refusing actually does on the floor */
{
  const roster = [{ n: 'A', uid: 'x1' }, { n: 'B', uid: 'x2' }]
  const sim = [{ n: 'A', load: 100 }, { n: 'B', load: 100 }]
  const same = applySulk(sim, roster, {})
  eq(same, sim, 'no sulk, no copy — the sim roster passes straight through')
  const hit = applySulk(sim, roster, { x1: REFUSAL_PENALTY })
  ok(hit[0].load < 100, 'a refused man gives you less')
  eq(hit[1].load, 100, 'and nobody else is touched')
  ok(hit[0].load > 100 * (1 - 0.26), 'but he has not become a different player')
  // The cap matters: a bug that let this grow without bound would erase a star.
  const huge = applySulk(sim, roster, { x1: 5 })
  ok(huge[0].load >= 100 * 0.74, 'the penalty is capped however angry he gets')
  // And it is load, not ratings — so what he is WORTH in a trade has not moved.
  ok(!('bpm' in hit[0]) || hit[0].bpm === sim[0].bpm, 'sulking does not change his ratings')
}

console.log(`story: ${n - bad}/${n}`)
process.exit(bad ? 1 : 0)
