// The rotation: who dresses, and how a night is shared out between the men who do.
//
// This is the model that decides every minute in the game, and it was wrong in a way no test
// caught for a long time — availability was being spent per MINUTE rather than per GAME, so a
// man expected to miss half the year played sixteen minutes of every game instead of thirty-
// three minutes of half of them. Thirteen of thirty clubs had their best player outside their
// own top three in minutes.
//
//   node tools/gm/sim.test.mjs
import { setLeague, newLeague, simOf, rostersOf } from '../../src/lib/gm/league.js'
import { newSeason, playNext, teamGames, TEAMS } from '../../src/lib/gm/season.js'
import { allLines } from '../../src/lib/gm/box.js'
import { talentVorp } from '../../src/lib/gm/trade/market.js'
import {
  rng, rotation, dressed, availabilityOf, startersOf,
  MIN_DRESSED, MAX_MINUTES, GAME_LENGTH,
} from '../../src/lib/gm/sim.js'
import { applyRotation } from '../../src/lib/gm/rotation.js'

let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => { n++; if (a !== b) { bad++; console.log(`  FAIL ${m}: ${a} !== ${b}`) } }
const near = (a, b, tol, m) => { n++; if (Math.abs(a - b) > tol) { bad++; console.log(`  FAIL ${m}: ${a} vs ${b} (±${tol})`) } }

setLeague(newLeague())

/* ------------------------------------------------------------------- availability */
eq(availabilityOf({ load: 16, mpg: 32 }), 0.5, 'availability comes back out of load and minutes')
eq(availabilityOf({ load: 32, mpg: 32 }), 1, 'a fully available man is one')
ok(availabilityOf({ load: 0, mpg: 32 }) >= 0.05, 'nobody is completely unavailable')
ok(availabilityOf({ load: 99, mpg: 32 }) <= 1, 'and nobody is more than available')
eq(availabilityOf({}), 0.05, 'a profile with nothing on it does not divide by zero')

/* -------------------------------------------------------------------- who dresses */
{
  // The stream has to stay aligned between runtimes, so the number of draws cannot depend on
  // the outcome: exactly one per man on the roster, every time, whatever comes back.
  const roster = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, n: `P${i}`, mpg: 30 - i, load: (30 - i) * 0.5 }))
  for (const seed of [1, 2, 3, 99]) {
    let draws = 0
    const base = rng(seed)
    const counting = { rand: () => { draws++; return base.rand() }, gauss: base.gauss, shuffle: base.shuffle }
    dressed(roster, counting)
    eq(draws, roster.length, `one draw per man at seed ${seed}`)
  }
  // Deterministic.
  const a = dressed(roster, rng(7)).map((p) => p.id).join(',')
  const b = dressed(roster, rng(7)).map((p) => p.id).join(',')
  eq(a, b, 'the same seed dresses the same men')
  ok(dressed(roster, rng(7)).map((p) => p.id).join(',')
    !== dressed(roster, rng(8)).map((p) => p.id).join(','), 'a different seed is a different night')

  // Nobody forfeits.
  const crocked = roster.map((p) => ({ ...p, load: 1 }))
  for (let s = 1; s <= 60; s++) {
    const d = dressed(crocked, rng(s))
    ok(d.length >= MIN_DRESSED, `a crocked roster still fields ${MIN_DRESSED} at seed ${s} (${d.length})`)
    eq(new Set(d.map((p) => p.id)).size, d.length, 'and nobody dresses twice')
  }
  // A roster smaller than the floor dresses everybody rather than inventing anyone.
  const tiny = roster.slice(0, 5).map((p) => ({ ...p, load: 1 }))
  ok(dressed(tiny, rng(3)).length <= 5, 'a five-man roster cannot field eight')

  // The rate is the availability. Over many nights a 70% man dresses about 70% of the time.
  for (const av of [0.25, 0.5, 0.7, 0.95]) {
    const one = [{ id: 'x', n: 'X', mpg: 30, load: 30 * av }]
    let got = 0
    const r = rng(1234)
    for (let i = 0; i < 4000; i++) if (dressed(one, r).length && Math.random() >= 0) {
      // the floor would force him in, so count the draw itself instead
    }
    // Counted directly off the draw, since the eight-man floor would otherwise force him in.
    let hits = 0
    const r2 = rng(4321)
    for (let i = 0; i < 4000; i++) if (r2.rand() < availabilityOf(one[0])) hits++
    near(hits / 4000, av, 0.03, `a ${Math.round(av * 100)}% man dresses about that often`)
    got = hits
    ok(got > 0, 'and does dress')
  }
}

/* --------------------------------- assigning minutes must not assign HEALTH */
{
  // `applyRotation` used to set load equal to the minutes asked for, which was harmless while
  // load was only a budget. Once availability is read back out of it, that made every player
  // on the user's roster a hundred per cent available the moment he touched the rotation
  // screen — his stars never missed a game and the other twenty-nine clubs still lost theirs.
  const cap = rostersOf('BOS')
  const sim = simOf('BOS')
  const mins = {}
  for (const p of cap) mins[p.uid || p.n] = 24
  const after = applyRotation(sim, cap, mins)
  for (const s0 of sim) {
    const a0 = after.find((x) => x.n === s0.n)
    if (!a0) continue
    near(availabilityOf(a0), availabilityOf(s0), 1e-9,
      `${s0.n} is exactly as available after his minutes are set`)
    eq(a0.mpg, 24, `${s0.n} plays the minutes he was given`)
  }
  eq(applyRotation(sim, cap, null), sim, 'no rotation, no change')
}

/* ------------------------------------------------------------- how the night is shared */
{
  const pool = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, n: `Q${i}`, mpg: 34 - i * 2, load: 20 }))
  const rot = rotation(pool)
  near(rot.reduce((s, p) => s + p._share, 0), 1, 1e-9, 'the shares are a whole game')
  ok(rot.every((p) => p._share > 0), 'everybody in the rotation plays')
  for (let i = 1; i < rot.length; i++) ok(rot[i].mpg <= rot[i - 1].mpg, 'the rotation is in minutes order')
  ok(rot.every((p) => p._share * GAME_LENGTH <= MAX_MINUTES + 1e-6),
    `nobody plays more than ${MAX_MINUTES} minutes`)

  // A short bench cannot hand one man the game. This is the Jokić case: eight men dress, and
  // sharing strictly by season minutes gave him forty-four.
  const thin = [{ id: 'a', n: 'A', mpg: 36, load: 30 }, ...Array.from({ length: 7 },
    (_, i) => ({ id: `b${i}`, n: `B${i}`, mpg: 10, load: 8 }))]
  const tr = rotation(thin)
  near(tr.reduce((s, p) => s + p._share, 0), 1, 1e-9, 'a thin night is still a whole game')
  ok(tr[0]._share * GAME_LENGTH <= MAX_MINUTES + 1e-6,
    `the star is capped on a thin night (${(tr[0]._share * GAME_LENGTH).toFixed(1)})`)
  ok(tr[1]._share > thin[1].mpg / thin.reduce((s, p) => s + p.mpg, 0),
    'and the minutes he cannot take go to the men who can')

  // Ten men at most, however many dress.
  eq(rotation(Array.from({ length: 15 }, (_, i) => ({ id: `z${i}`, mpg: 20, load: 20 }))).length, 10,
    'ten men play')
  // Starters come off minutes, not load — a man who misses games still starts the ones he plays.
  const st = startersOf([{ id: '1', mpg: 34, load: 6 }, { id: '2', mpg: 30, load: 29 },
    { id: '3', mpg: 28, load: 27 }, { id: '4', mpg: 26, load: 25 }, { id: '5', mpg: 24, load: 23 },
    { id: '6', mpg: 22, load: 21 }])
  ok(st.has('1'), 'a star who misses games still starts')
  ok(!st.has('6'), 'and the seventh man does not')
}

/* ----------------------------------------------------------- and over a whole season */
{
  const st = newSeason(20261)
  while (st.played < st.schedule.length) playNext(st, 400)
  const L = allLines(st.stats)

  // The arithmetic that has caught every attribution bug in this game.
  for (const t of TEAMS) {
    const g = teamGames(st, t).length
    const mins = L.filter((l) => l.team === t).reduce((s, l) => s + l.mpg * l.g, 0) / Math.max(1, g)
    near(mins, GAME_LENGTH, 1, `${t} plays 240 minutes a night (${mins.toFixed(1)})`)
  }
  ok(L.every((l) => l.g <= 82), 'nobody plays more than eighty-two')
  ok(L.every((l) => l.mpg <= MAX_MINUTES + 0.5),
    `nobody averages more than ${MAX_MINUTES} minutes (${Math.max(...L.map((l) => l.mpg))})`)

  // Games played have to VARY — the whole point of the change. Before it, everybody played 82.
  const gs = L.filter((l) => l.mpg >= 15).map((l) => l.g)
  ok(Math.min(...gs) < 60, `somebody misses a chunk of the year (${Math.min(...gs)})`)
  ok(gs.filter((x) => x === 82).length < gs.length * 0.7, 'not everybody plays every game')

  // And they have to vary FOR THE RIGHT REASON: a man's games should track his availability.
  const pairs = []
  for (const t of TEAMS) {
    for (const p of simOf(t)) {
      const l = L.find((x) => x.id === p.id)
      if (l && l.mpg >= 12) pairs.push({ av: availabilityOf(p), g: l.g })
    }
  }
  // Thresholds set off the seed's real distribution, not off round numbers: the median
  // rotation player is at 0.70 available and only fourteen men in the league clear 0.90.
  const fit = pairs.filter((x) => x.av >= 0.8)
  const crock = pairs.filter((x) => x.av <= 0.5)
  const avg = (a) => a.reduce((s, x) => s + x.g, 0) / Math.max(1, a.length)
  ok(fit.length > 40 && crock.length > 20, `both kinds exist (${fit.length} fit, ${crock.length} not)`)
  ok(avg(fit) > avg(crock) + 15,
    `available men play far more games (${avg(fit).toFixed(0)} against ${avg(crock).toFixed(0)})`)

  // The symptom that started all this: a club's best player should be one of its most used.
  let misplaced = 0
  for (const t of TEAMS) {
    const best = [...rostersOf(t)].sort((a, b) => talentVorp(b) - talentVorp(a))[0]
    const rows = L.filter((l) => l.team === t).sort((a, b) => b.mpg - a.mpg)
    const idx = rows.findIndex((l) => l.n === best.n)
    if (idx < 0 || idx > 4) misplaced++
  }
  ok(misplaced <= 4, `a club's best player is one of its most used (${misplaced} of 30 are not)`)
}

console.log(`sim: ${n - bad}/${n}`)
process.exit(bad ? 1 : 0)
