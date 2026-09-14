// The record book: does a finished season survive into the archive, and does the archive
// answer the questions a franchise mode is played for.
//
// This exists because the engine produced a complete statistical account of every game from
// the day box.js was written and the offseason threw it away — so the failure being guarded
// against is not a wrong number, it is a correct number that reaches nobody.
import { newSeason, playNext } from '../../src/lib/gm/season.js'
import { allLines } from '../../src/lib/gm/box.js'
import {
  emptyHistory, archiveSeason, seasonLines, careerFor, careerTotals,
  leaders, allTimeCareers, allTimeSeasons, nameOf, honourRoll,
} from '../../src/lib/gm/history.js'
import { emptyLedger, record, bySeason, countOf } from '../../src/lib/gm/ledger.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  FAIL  ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m} — got ${a}, wanted ${b}`)

/* ------------------------------------------------------------------ the gamelog */

const st = newSeason(20260927, { cup: false })
playNext(st, 400, { logTeam: 'OKC' })

ok(st.gamelog.length > 0, 'games the user played are logged')
eq(st.gamelog.every((g) => g.home === 'OKC' || g.away === 'OKC'), true,
  'only the logged team\'s games are kept')
const g0 = st.gamelog[0]
ok(g0.lines.length >= 14, 'both sides of a game appear in its box score')
ok(g0.lines.some((l) => l.side === 'home') && g0.lines.some((l) => l.side === 'away'),
  'a box score has two teams in it')
const scored = g0.lines.reduce((t, l) => t + l.pts, 0)
eq(scored, g0.hs + g0.as, 'the box score adds up to the final score')
eq(g0.lines.filter((l) => l.side === 'home' && l.st).length, 5, 'five men start for the home side')

// REPLAY. The season is never persisted — it is rebuilt from its seed on load — so a log
// that did not reproduce would mean every box score vanished on refresh.
const again = newSeason(20260927, { cup: false })
playNext(again, 400, { logTeam: 'OKC' })
eq(JSON.stringify(again.gamelog), JSON.stringify(st.gamelog),
  'the same seed rebuilds identical box scores')

/* ------------------------------------------------------------------ the archive */

let H = emptyHistory()
H = archiveSeason(H, { season: '2026-27', stats: st.stats, rec: st.rec, champion: 'OKC',
  honours: [{ who: 'Shai Gilgeous-Alexander', name: 'MVP' }], team: 'OKC' })

const lines = seasonLines(H, '2026-27')
ok(lines.length > 300, 'every club\'s players are archived, not only the user\'s')
eq(H.seasons.length, 1, 'one season archived')

// Idempotent: a career resumed from its progress marker re-runs the rollover.
H = archiveSeason(H, { season: '2026-27', stats: st.stats, rec: st.rec, champion: 'OKC',
  honours: [], team: 'OKC' })
eq(H.seasons.length, 1, 'archiving the same season twice does not double it')

const live = allLines(st.stats)
const top = live.slice().sort((a, b) => b.pts - a.pts)[0]
const arch = lines.find((r) => r.id === top.id)
ok(arch, 'the season\'s leading scorer survives into the archive')
eq(Math.round(arch.pts), Math.round(top.totals ? top.totals.pts : 0) || arch.pts,
  'archived totals are totals, not averages')
eq(nameOf(H, top.id), top.n, 'the name dictionary resolves an archived id')

const career = careerFor(H, top.id)
eq(career.length, 1, 'a one-season career has one row')
ok(Math.abs(career[0].pts - top.pts) < 0.6, 'the archived per-game line matches what was played')

// A second season, so the counting-stat leaderboard has something to count.
const st2 = newSeason(20270927, { cup: false })
playNext(st2, 400, { logTeam: 'OKC' })
H = archiveSeason(H, { season: '2027-28', stats: st2.stats, rec: st2.rec, champion: 'BOS',
  honours: [{ who: 'Anthony Edwards', name: 'MVP' }], team: 'OKC' })

eq(H.seasons.length, 2, 'two seasons archived')
const tot = careerTotals(H, top.id)
ok(tot && tot.seasons >= 1, 'career totals span the seasons he appeared in')
if (tot && tot.seasons === 2) {
  const a = careerFor(H, top.id)
  eq(tot.totals.pts, a[0].totals.pts + a[1].totals.pts, 'career points are the sum of the seasons')
}

const scorers = allTimeCareers(H, 'pts', { n: 5 })
eq(scorers.length, 5, 'an all-time list comes back')
ok(scorers[0].total >= scorers[4].total, 'the all-time list is ranked')
ok(scorers.every((r) => r.name && !r.name.startsWith('#')), 'every all-time entry has a name')

const bestYear = allTimeSeasons(H, 'pts', { n: 3, min: 10 })
ok(bestYear.length === 3 && bestYear[0].season, 'the best single seasons carry the year they happened')

eq(honourRoll(H).length, 2, 'every award ever won is retrievable')

// THE QUALIFYING FLOOR. Without one the percentage boards are led by a man who took one shot.
const mostGames = Math.max(...lines.map((r) => r.g))
const floor = Math.round(mostGames * 0.8)
const noFloor = leaders(lines, 'fg3Pct', { n: 1, min: 1 })
const withFloor = leaders(lines, 'fg3Pct', { n: 1, min: floor })
ok(withFloor.length && withFloor[0].g >= floor, 'the floor is applied')
ok(leaders(lines, 'fg3Pct', { n: 2000, min: floor }).length
   < leaders(lines, 'fg3Pct', { n: 2000, min: 1 }).length,
  'the floor removes small-sample shooters')
ok(noFloor.length, 'without a floor there is still a leader — just a worse one')

// Size. A save lives in localStorage and a twenty-season career has to fit in it.
const perSeason = JSON.stringify(H).length / H.seasons.length
ok(perSeason < 90000, `a season costs under 90KB archived — ${Math.round(perSeason / 1024)}KB`)

/* ------------------------------------------------------------------- the ledger */

let L = emptyLedger()
L = record(L, { season: '2026-27', kind: 'trade', text: 'Traded A for B', day: 60 })
L = record(L, { season: '2026-27', kind: 'draft', text: 'Drafted C', day: 5 })
L = record(L, { season: '2027-28', kind: 'sign', text: 'Signed D' })
const by = bySeason(L)
eq(by.size, 2, 'the ledger indexes by season')
eq(by.get('2026-27')[0].text, 'Drafted C', 'a season\'s moves are ordered by when they happened')
eq(countOf(L, 'trade'), 1, 'moves can be counted by kind')

// It is append-only and bounded, so a twenty-year career cannot grow without limit.
let big = emptyLedger()
for (let i = 0; i < 1200; i++) big = record(big, { season: 's', kind: 'trade', text: `t${i}` })
eq(big.entries.length, 1000, 'the ledger is capped')
eq(big.entries[big.entries.length - 1].text, 't1199', 'the cap keeps the most recent moves')

console.log(`history: ${pass}/${pass + fail}`)
if (fail) process.exit(1)
