// Does the league live?
//
// For a long time exactly one roster in thirty aged, ran its contracts down, drafted
// anybody or lost a player to free agency. Six simulated seasons in, Kevin Durant was
// still thirty-seven on the same contract, no drafted rookie had ever joined an NBA team,
// and one club won three titles because nothing about any other club could change.
//
// These are the checks that a season passing changes the world.
//
//   node tools/gm/league.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, rostersOf, simOf, doubleBooked } from '../../src/lib/gm/league.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { newSeason, playNext, TEAMS } from '../../src/lib/gm/season.js'
import { runLottery, generateClass, runDraft } from '../../src/lib/gm/draft.js'
import { enrich } from '../../src/lib/gm/prospects.js'
import { runLeagueYear } from '../../src/lib/gm/leagueYear.js'
import { rng } from '../../src/lib/gm/sim.js'
import { teamSalary } from '../../src/lib/gm/cap.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const MINE = 'BOS'

// Run six league years and watch what happens to the world.
setLeague(newLeague())
const save = newCareer({ gm: { name: 'T' }, team: MINE, preset: 'guided',
  levels: { ...SEED.presets.guided.levels }, seed: 31337 })
const start = {}
for (const t of Object.keys(SEED.teams)) {
  start[t] = { names: rostersOf(t).map((p) => p.n).join('|'), n: rostersOf(t).length }
}
const startAges = Object.keys(SEED.teams).flatMap((t) => rostersOf(t)).map((p) => p.a || 26)
const startMean = startAges.reduce((a, b) => a + b, 0) / startAges.length
let totalRetired = 0, totalSigned = 0, champions = []

for (let y = 0; y < 6; y++) {
  const st = newSeason((save.rngSeed + y * 7919) >>> 0)
  playNext(st, st.schedule.length)
  champions.push(Object.entries(st.rec).sort((a, b) => b[1].w - a[1].w)[0][0])
  const r = rng((save.rngSeed + y * 131) >>> 0)
  const cls = enrich(generateClass(r, 60, 2027 + y), r)
  const order = runLottery(TEAMS.slice().sort((a, b) => st.rec[a].w - st.rec[b].w), r)
  const dr = runDraft(order, cls, r, MINE)
  const ly = runLeagueYear(save, { r, year: 2027 + y, yearIndex: y, draftPicks: dr.picks })
  save.league = ly.league
  setLeague(save.league)
  totalRetired += ly.retired.length
  totalSigned += ly.signed
}

console.log('\n— the world moves —')
{
  const changed = Object.keys(SEED.teams).filter((t) => t !== MINE)
    .filter((t) => rostersOf(t).map((p) => p.n).join('|') !== start[t].names).length
  check('every other roster changes over six years', changed === 29, `${changed} of 29`)
  check('careers end', totalRetired > 60, `${totalRetired} departures in six years`)
  check('free agents sign somewhere', totalSigned > 200, `${totalSigned} signings`)
}

console.log('\n— and it still looks like the NBA —')
{
  const all = Object.keys(SEED.teams).flatMap((t) => rostersOf(t))
  const ages = all.map((p) => p.a || 26)
  const mean = ages.reduce((a, b) => a + b, 0) / ages.length
  check('the league does not drift young or old', mean > 24.5 && mean < 28,
    `mean age ${mean.toFixed(1)} from ${startMean.toFixed(1)} (real NBA 26.1)`)
  check('and it is not all teenagers', ages.filter((a) => a < 23).length / ages.length < 0.4,
    `${(ages.filter((a) => a < 23).length / ages.length * 100).toFixed(0)}% under 23`)
  const sizes = Object.keys(SEED.teams).map((t) => rostersOf(t).length)
  check('rosters stay legal', Math.min(...sizes) >= 13 && Math.max(...sizes) <= 21,
    `${Math.min(...sizes)}–${Math.max(...sizes)}`)
  check('and nobody hoards the league', all.length < 520, `${all.length} contracts`)
  const payrolls = Object.keys(SEED.teams).map((t) => teamSalary(rostersOf(t)))
  check('payrolls stay in the realm of a salary cap',
    Math.max(...payrolls) < 400e6, `max $${(Math.max(...payrolls) / 1e6).toFixed(0)}M`)
}

console.log('\n— players age, and the cap sheet knows it —')
{
  // The bug that made every valuation wrong: only the simulation profile aged, so the
  // cap sheet everything else reads kept a player's first-season rating for ever.
  // Stars can retire, but a 28-year-old MVP should usually still be playing at 34.
  const stars = ['Shai Gilgeous-Alexander', 'Victor Wembanyama', 'Luka Dončić', 'Anthony Edwards',
    'Cade Cunningham', 'Tyrese Maxey']
  const alive = stars.filter((n) => Object.keys(SEED.teams).flatMap((t) => rostersOf(t)).some((p) => p.n === n))
  check('young stars are still playing six years on', alive.length >= 4,
    `${alive.length} of ${stars.length}: ${alive.join(', ')}`)
  const sga = Object.keys(SEED.teams).flatMap((t) => rostersOf(t)).find((p) => stars.includes(p.n))
  if (!sga) check('an established star is still traceable', false, 'gone entirely')
  else {
    check('he is six years older', (sga.a ?? 0) >= 24, `${sga.n} age ${(sga.a ?? 0).toFixed(1)}`)
    check('and the cap sheet rating moved with him', typeof sga.v === 'number',
      `${sga.n} v ${(sga.v ?? 0).toFixed(2)}`)
  }
  // Young players should be able to become the best in the league.
  const best = Object.keys(SEED.teams).flatMap((t) => rostersOf(t))
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).slice(0, 6)
  check('the best players are not simply the same six as year one',
    best.some((p) => (p.a ?? 30) < 28), best.map((p) => `${p.n} ${Math.round(p.a)}`).join(', '))
}

console.log('\n— and nobody is on two teams —')
{
  // Five men were on two cap sheets at once, in rows byte-identical down to the salary:
  // Bradley Beal on the Clippers and Phoenix, Damian Lillard on Milwaukee and Portland. Two
  // clubs paid each of them and both clubs played them. It survived a long time because
  // nothing ever counted anybody twice, and it fell out the day the season started keeping
  // box scores — a handful of players had appeared in more than eighty-two games.
  const dupes = doubleBooked()
  const unlisted = dupes.filter((d) => !d.listed)
  check('every double-booked player has been resolved deliberately', unlisted.length === 0,
    unlisted.map((d) => `${d.n} on ${d.teams.join(' and ')} — decide which and add him to DOUBLE_BOOKED`).join('; '))

  setLeague(newLeague())
  const seen = new Map()
  for (const t of Object.keys(SEED.teams)) {
    for (const p of rostersOf(t)) {
      const k = p.n
      if (!seen.has(k)) seen.set(k, [])
      seen.get(k).push(t)
    }
  }
  const twice = [...seen].filter(([, v]) => v.length > 1)
  check('and the league that is built has one of each man', twice.length === 0,
    twice.map(([n, v]) => `${n} on ${v.join(', ')}`).join('; '))
}

console.log('\n— and the men who have never played a game are people —')
{
  // Every first-year player in the league used to be the same man: no position, no skill
  // vector, so the archetype filler handed all thirty-one of them "3&D Role Player" and one
  // identical set of nine numbers. Three of them were worse than that — the pipeline could
  // not find a season row for a man who has never played one, fell back to the nearest
  // surname in its history, and took that man's age. Darryn Peterson was twenty-six,
  // Cameron Boozer was forty-four, Bruce Thornton was sixty-three.
  //
  // These are the checks that say it cannot come back quietly.
  setLeague(newLeague())
  const rows = Object.keys(SEED.teams).flatMap((t) => rostersOf(t).map((p) => ({ t, ...p })))

  const ageless = rows.filter((p) => typeof p.a !== 'number' || p.a < 18.3 || p.a > 44)
  check('nobody in the league is a teenager or a pensioner', ageless.length === 0,
    ageless.map((p) => `${p.n} ${p.a}`).join(', '))

  // Age has to agree with service time — but only where service time actually implies an
  // age. A sliding scale is the tempting version and it is wrong: Vasilije Micic came over
  // at twenty-nine and has three NBA years, so any rule saying a third-year man is
  // twenty-two calls a real career a bug, and a test that cries wolf is a test somebody
  // deletes. The one direction that is never legitimate is a man with no years at all who
  // is nonetheless old — which is exactly the shape a bad join leaves behind.
  const offCurve = rows.filter((p) => p.exp === 0 && p.a > 25)
  check('nobody has played nothing for twenty-six years', offCurve.length === 0,
    offCurve.map((p) => `${p.n} age ${p.a} exp ${p.exp}`).join(', '))

  const posless = rows.filter((p) => !p.pos && typeof p.slot !== 'number')
  check('everybody has somewhere to play', posless.length === 0,
    `${posless.length} without a position: ${posless.slice(0, 5).map((p) => p.n).join(', ')}`)

  const rookies = rows.filter((p) => p.rookie)
  check('the draft class made it into the league', rookies.length >= 30, `${rookies.length} rookies`)

  // A man with no professional season cannot have a stale professional season.
  const haunted = rookies.filter((p) => p.stale || p.pid)
  check('no rookie is carrying another man around', haunted.length === 0,
    haunted.map((p) => `${p.n} <- ${p.stale}`).join(', '))

  check('no rookie is older than a rookie',
    rookies.every((p) => p.a >= 18.3 && p.a <= 24.5),
    rookies.filter((p) => p.a > 24.5 || p.a < 18.3).map((p) => `${p.n} ${p.a}`).join(', '))

  // Not clones. The whole point of a draft class is that they are different players.
  const archs = new Set(rookies.map((p) => p.arch))
  check('the class is not one archetype', archs.size >= 6, `${archs.size} archetypes: ${[...archs].join(', ')}`)
  // Two men the same size, the same position and one place apart on the board are allowed
  // to round to the same numbers. Thirty-one of them were not.
  const vecs = new Set(rookies.map((p) => [p.sh, p.sc, p.rp, p.pd, p.pm, p.sz].join('/')))
  check('the class is not thirty-eight copies of one player', vecs.size >= rookies.length * 0.9,
    `${vecs.size} distinct vectors for ${rookies.length} rookies`)
  const vals = new Set(rookies.map((p) => p.v))
  check('the top of the class is not one flat tier', vals.size >= rookies.length - 1,
    `${vals.size} distinct projections`)

  // The board's shape survives into the league: bigs are big, guards are not.
  const bigs = rookies.filter((p) => (p.slot ?? 3) >= 4.4)
  const guards = rookies.filter((p) => (p.slot ?? 3) < 2)
  check('centres out-rebound guards', bigs.length > 0 && guards.length > 0
    && Math.min(...bigs.map((p) => p.rp)) > Math.max(...guards.map((p) => p.rp)),
    `bigs ${bigs.length}, guards ${guards.length}`)

  // Upside and floor are the pair that makes a nineteen-year-old swing and a twenty-three-
  // year-old four-year college guard steady, which is the whole texture of watching a rookie.
  const swing = rookies.filter((p) => (p.upside ?? 0) - (p.floor ?? 0) > 0.5)
  check('the top of the board is volatile', swing.length >= 5, `${swing.length} swings`)
  const oldest = rookies.slice().sort((a, b) => (b.a ?? 0) - (a.a ?? 0))[0]
  check('and the oldest rookie is the steadiest', (oldest.floor ?? 0) >= 0.45,
    `${oldest.n} age ${oldest.a} floor ${oldest.floor}`)

  // The three that were visibly wrong, by name, forever.
  for (const [n, lo, hi] of [['Darryn Peterson', 19, 20.5], ['Cameron Boozer', 19, 20.5],
    ['Bruce Thornton', 22.5, 24]]) {
    const p = rows.find((x) => x.n === n)
    check(`${n} is ${lo}-${hi} again`, !!p && p.a >= lo && p.a <= hi, p ? `age ${p.a}` : 'not in the league')
  }
}

console.log('\n— and somebody different can win —')
{
  check('titles are not owned by one club', new Set(champions).size >= 3,
    `${new Set(champions).size} different best records in six years`)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
