// THE INJURY MODEL, AND THE ONE NUMBER IT HAS TO HIT.
//
// The calibration is not a preference. `av` in the seed is the share of team games each player
// was actually available for, measured from real data, and the model's job is to reproduce the
// part of that absence which is genuinely injury — leaving TOTAL absence exactly where the
// data put it, so the possession engine's own calibration is untouched.
//
// Everything else here guards the properties that make it a simulation rather than a dice
// roll: that a replay produces the same casualty list, that nobody is indestructible, that a
// club is never left unable to field a rotation, and that the engine was not disturbed.
import { newSeason, playNext, TEAMS } from '../../src/lib/gm/season.js'
import { playableSim } from '../../src/lib/gm/league.js'
import { allLines } from '../../src/lib/gm/box.js'
import {
  injuryShare, baseHazard, residualAvailability, hazardFor, availableRoster, isOut, outFor,
  MEAN_GAMES, SEVERITY, PARTS, B2B_FACTOR, MIN_AVAILABLE, HAZARD_SCALE, gamesLeft,
} from '../../src/lib/gm/injury.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  FAIL  ' + m) } }

/* ------------------------------------------------------------------ the tables */

ok(Math.abs(SEVERITY.reduce((s, x) => s + x.p, 0) - 1) < 1e-9, 'severity weights sum to one')
ok(Math.abs(PARTS.reduce((s, x) => s + x.p, 0) - 1) < 1e-9, 'body part weights sum to one')
ok(MEAN_GAMES > 6 && MEAN_GAMES < 14, `mean injury length is plausible (${MEAN_GAMES.toFixed(1)})`)
ok(SEVERITY.every((x) => x.lo <= x.hi), 'every severity band is ordered')

// The split by role is the finding this model turns on: a star's absences are injuries, a
// deep reserve's are mostly the rotation.
ok(injuryShare(36) > injuryShare(10) * 2, 'a starter\'s absence is far more often an injury')
ok(injuryShare(36) < 1 && injuryShare(4) > 0, 'the share stays a share')

/* ----------------------------------------------- absence is counted exactly once */

// This is the property that keeps the possession engine's calibration valid. Whatever the
// model takes out as injury, the engine's nightly draw must stop taking out.
for (const [av, mpg] of [[0.95, 34], [0.72, 30], [0.65, 20], [0.5, 12], [0.85, 8]]) {
  const injGames = 82 * baseHazard(av, mpg) * MEAN_GAMES
  const residGames = 82 * (1 - residualAvailability(av, mpg))
  ok(Math.abs((injGames + residGames) - 82 * (1 - av)) < 0.25,
    `av ${av} @ ${mpg}mpg: total absence preserved (${(injGames + residGames).toFixed(1)} vs ${(82 * (1 - av)).toFixed(1)})`)
}

/* ---------------------------------------------------------------- the multipliers */

const P = { id: 1, n: 'X', mpg: 30, load: 21, _av: 0.7 }
ok(hazardFor(P, { minutes: 36 }) > hazardFor(P, { minutes: 14 }), 'more minutes, more risk')
ok(Math.abs(hazardFor(P, { b2b: true }) / hazardFor(P, { b2b: false }) - B2B_FACTOR) < 1e-9,
  'the second night of a back-to-back carries the stated penalty')
ok(hazardFor(P, { wear: 25 }) > hazardFor(P, { wear: 0 }), 'riding a man raises his risk')
ok(hazardFor({ ...P, _av: 0.5 }) > hazardFor({ ...P, _av: 0.9 }),
  'a fragile player is more fragile — which is what makes availability a thing to trade on')

// Nobody is indestructible. A profile whose load exceeds its minutes used to imply an
// availability above 1.0, which zeroed both the residual and the hazard.
const impossible = { id: 2, n: 'Y', mpg: 10, load: 30 }
const fit = availableRoster([impossible], {}, 0)
ok(fit[0]._av <= 0.995, `availability is clamped to a probability (${fit[0]._av})`)
ok(hazardFor(fit[0]) > 0, 'and such a player can still get hurt')

/* --------------------------------------------------------------- over a season */

const st = newSeason(515151, { cup: false })
playNext(st, st.schedule.length)

ok(st.injuryLog.length > 300, `a season produces a real casualty list (${st.injuryLog.length})`)
ok(st.injuryLog.every((x) => x.games >= 1 && x.games <= 82), 'every injury has a sane length')
ok(st.injuryLog.every((x) => x.until > x.since), 'and a return date after it started')
ok(st.injuryLog.every((x) => x.partLabel && x.sevLabel), 'every injury has a diagnosis')
ok(new Set(st.injuryLog.map((x) => x.team)).size === 30, 'every club loses somebody')

// The bug that a single log line exposed: seeding on the game index alone handed both clubs
// the same stream, so the first man down on each side had the identical diagnosis.
const pairs = new Map()
for (const x of st.injuryLog) {
  const k = `${x.game}`
  if (!pairs.has(k)) pairs.set(k, [])
  pairs.get(k).push(`${x.partLabel}/${x.games}`)
}
// Coincidence is expected — thirteen body parts by a few dozen lengths is a small space, and
// a season produces hundreds of injuries. What is being ruled out is the systematic case,
// where the two clubs shared a stream and EVERY pair matched.
const sameGame = [...pairs.values()].filter((v) => v.length === 2)
const twins = sameGame.filter((v) => v[0] === v[1]).length
ok(sameGame.length === 0 || twins / sameGame.length < 0.15,
  `the two clubs in a game draw independently (${twins} of ${sameGame.length} pairs identical)`)

// Severity is a distribution, not a constant, and the rare band stays rare.
const bySev = {}
for (const x of st.injuryLog) bySev[x.sev] = (bySev[x.sev] || 0) + 1
ok(Object.keys(bySev).length >= 4, 'the whole severity range occurs')
ok((bySev.severe || 0) / st.injuryLog.length < 0.05, 'season-enders stay rare')
ok((bySev.knock || 0) > (bySev.major || 0), 'and most of it is the boring kind')

// A club is never left unable to field a rotation.
let worst = 99
for (let d = 0; d < 200; d += 7) {
  for (const t of TEAMS) {
    const size = playableSim(t).length
    const out = outFor(st.injuries, d, t).length
    worst = Math.min(worst, size - out)
  }
}
ok(worst >= MIN_AVAILABLE - 1, `nobody is left short of a rotation (worst was ${worst} fit)`)

/* -------------------------------------------------------------- the calibration */

let target = 0
for (const t of TEAMS) for (const p of playableSim(t)) {
  const av = Math.min(0.995, (p.load || 0) / Math.max(1, p.mpg || 1))
  target += 82 * (1 - Math.max(0.3, av)) * injuryShare(p.mpg)
}
let missed = 0
for (const x of st.injuryLog) {
  for (let g = 0; g < st.schedule.length; g++) {
    const [h, a] = st.schedule[g]
    if (h !== x.team && a !== x.team) continue
    const d = st.day[g]
    if (d >= x.since && d < x.until) missed++
  }
}
const ratio = missed / target
ok(ratio > 0.82 && ratio < 1.18,
  `league games lost to injury matches the measured availability — ${missed} vs ${Math.round(target)} (${ratio.toFixed(2)}x)`)
ok(missed > 4200 && missed < 8200,
  `and lands in the right order for an NBA season (${missed})`)

/* ------------------------------------------------------------------- the replay */
//
// The server verifies a claimed season by replaying it through this same loop. A casualty
// list that did not reproduce would make every career unverifiable.
const again = newSeason(515151, { cup: false })
playNext(again, again.schedule.length)
ok(JSON.stringify(again.injuryLog) === JSON.stringify(st.injuryLog),
  'the same seed produces the identical casualty list')
ok(again.rec.OKC.w === st.rec.OKC.w, 'and the identical standings')

/* ------------------------------------------- the engine was not disturbed */

const off = newSeason(515151, { cup: false, injuries: false })
playNext(off, off.schedule.length)
ok(Object.keys(off.injuries || {}).length === 0, 'the layer can be turned off entirely')
const lines = allLines(st.stats), linesOff = allLines(off.stats)
const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length
ok(Math.abs(mean(lines, 'pts') - mean(linesOff, 'pts')) < 1.2,
  'scoring is unchanged with injuries on — absence moved, it did not multiply')
const totW = TEAMS.reduce((s, t) => s + st.rec[t].w, 0)
ok(totW === 1230, `every game still has exactly one winner (${totW})`)

/* ---------------------------------------------------------------- the read side */

const one = st.injuryLog[0]
ok(isOut(st.injuries, one.id, one.since) || st.injuries[one.id].since > one.since,
  'a man is out on the day he goes down')
ok(gamesLeft({ ...one, until: one.since + 20 }, one.since) > 0, 'games remaining counts down')
ok(HAZARD_SCALE > 0.5 && HAZARD_SCALE < 4, 'the solved scale is in a sane range')

console.log(`injury: ${pass}/${pass + fail}`)
if (fail) process.exit(1)
