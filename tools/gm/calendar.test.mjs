// The calendar: does the season know what day it is, and does what it says match what it
// then does?
//
//   node tools/gm/calendar.test.mjs
import { setLeague, newLeague } from '../../src/lib/gm/league.js'
import { newSeason, playNext, teamGames, TEAMS } from '../../src/lib/gm/season.js'
import { DEADLINE_GAME } from '../../src/lib/gm/deadline.js'
import { ALLSTAR_GAME } from '../../src/lib/gm/allstar.js'
import {
  today, nextGame, dayOfTeamGame, ahead, whenText,
  dayToDate, label, longLabel, weekday, DAY_NAME, SEASON_START,
} from '../../src/lib/gm/calendar.js'

let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => { n++; if (a !== b) { bad++; console.log(`  FAIL ${m}: ${a} !== ${b}`) } }

setLeague(newLeague())
const st = newSeason(90210)

/* ------------------------------------------------------------------ dates are dates */
eq(label(dayToDate(2026, 0)), `Oct ${SEASON_START.d}`, 'day zero is opening night')
{
  // Walk a full year one day at a time and make sure the date never goes backwards or
  // produces a day outside its month. This is the arithmetic everything else trusts.
  let prev = dayToDate(2026, 0)
  for (let i = 1; i <= 400; i++) {
    const d = dayToDate(2026, i)
    ok(d.d >= 1 && d.d <= 31, `day ${i} has a real day-of-month (${JSON.stringify(d)})`)
    ok(d.m >= 1 && d.m <= 12, `day ${i} has a real month`)
    const fwd = d.y > prev.y || (d.y === prev.y && (d.m > prev.m || (d.m === prev.m && d.d > prev.d)))
    ok(fwd, `day ${i} comes after day ${i - 1}`)
    prev = d
  }
  // February in a leap year, since 2028 is one and a season started in 2027 runs into it.
  eq(label(dayToDate(2027, 131)), 'Feb 29', 'a leap day exists when it should')
  eq(label(dayToDate(2026, 131)), 'Mar 1', 'and does not when it should not')
}
// Weekdays. Opening night 2026 is a known date; check the congruence against it and a few more.
eq(DAY_NAME[weekday({ y: 2026, m: 10, d: 21 })], 'Wed', 'Oct 21 2026 is a Wednesday')
eq(DAY_NAME[weekday({ y: 2000, m: 1, d: 1 })], 'Sat', 'Jan 1 2000 was a Saturday')
eq(DAY_NAME[weekday({ y: 2024, m: 2, d: 29 })], 'Thu', 'Feb 29 2024 was a Thursday')
ok(/^\w{3} \d{1,2}, \d{4}$/.test(longLabel({ y: 2026, m: 12, d: 25 })), 'the long label reads like a date')

/* ------------------------------------------------------------- today, and what is next */
eq(today(st).day, 0, 'an unplayed season is on opening night')
playNext(st, 700)
{
  const t = today(st)
  ok(t.day > 0, 'a played season has moved off opening night')
  ok(t.date.m === 12 || t.date.m === 1 || t.date.m === 2 || t.date.m === 11,
    `700 games in is midwinter (${label(t.date)})`)
}

for (const team of ['BOS', 'OKC', 'SAS']) {
  const g = nextGame(st, team)
  ok(!!g, `${team} has a next game`)
  if (!g) continue
  ok(g.home === team || g.away === team, `${team} is in his own next game`)
  eq(g.at === 'home', g.home === team, `${team}'s venue is read the right way round`)
  ok(g.opponent !== team, `${team} does not play himself`)
  ok(g.inDays >= 0, `${team}'s next game is not in the past`)
  ok(g.inDays <= 6, `${team} plays within the week (${g.inDays})`)
  ok(g.i >= st.played, `${team}'s next game has not already been played`)
}

/* ------------------------------------------------ the marks are where they say they are */
{
  const dl = dayOfTeamGame(st, 'BOS', DEADLINE_GAME)
  const as = dayOfTeamGame(st, 'BOS', ALLSTAR_GAME)
  const end = dayOfTeamGame(st, 'BOS', 82)
  ok(dl != null && as != null && end != null, 'the marks all have days')
  ok(dl < as, 'the deadline comes before the All-Star break')
  ok(as < end, 'and the break comes before the last game')
  const dld = dayToDate(st.startYear ?? 2026, dl)
  const asd = dayToDate(st.startYear ?? 2026, as)
  const endd = dayToDate(st.startYear ?? 2026, end)
  eq(dld.m, 2, `the trade deadline falls in February (${label(dld)})`)
  eq(asd.m, 2, `All-Star weekend falls in February (${label(asd)})`)
  ok(endd.m === 4 || endd.m === 3, `the season ends in spring (${label(endd)})`)
  // Every team's 82nd game should land in the same fortnight — a schedule where one club
  // finishes three weeks before another is not a schedule.
  const ends = TEAMS.map((t) => dayOfTeamGame(st, t, 82)).filter((x) => x != null)
  eq(ends.length, 30, 'all thirty teams play eighty-two')
  ok(Math.max(...ends) - Math.min(...ends) <= 14,
    `everybody finishes within a fortnight of everybody else (${Math.max(...ends) - Math.min(...ends)})`)
  eq(dayOfTeamGame(st, 'BOS', 0), null, 'there is no zeroth game')
  eq(dayOfTeamGame(st, 'BOS', 999), null, 'and no nine-hundred-and-ninety-ninth')
}

/* -------------------------------------------------------------------- what is ahead */
{
  const marks = [
    { kind: 'deadline', game: DEADLINE_GAME, label: 'Trade deadline' },
    { kind: 'allstar', game: ALLSTAR_GAME, label: 'All-Star weekend' },
    { kind: 'end', game: 82, label: 'Last game' },
  ]
  const rows = ahead(st, 'BOS', marks, 5)
  ok(rows.length > 0, 'something is coming up')
  ok(rows.length <= 5, 'and the list is capped')
  for (let i = 1; i < rows.length; i++) ok(rows[i].day >= rows[i - 1].day, 'the list is in order')
  ok(rows.every((r) => r.inDays >= 0), 'nothing on the list has already happened')
  ok(rows.every((r) => r.label && r.date), 'everything on the list has a name and a date')
  eq(rows[0].kind, 'game', 'the next thing is a game')
  // What it says must match what the season then does.
  const g = nextGame(st, 'BOS')
  const before = teamGames(st, 'BOS').length
  playNext(st, 40)
  eq(teamGames(st, 'BOS').length > before, true, 'playing on plays his games')
  const played = st.games?.[g.i] || st.schedule[g.i]
  ok(!!played, 'the game the calendar promised exists in the schedule')
  // A season played to its end has nothing ahead of it.
  playNext(st, st.schedule.length)
  eq(nextGame(st, 'BOS'), null, 'a finished season has no next game')
  eq(ahead(st, 'BOS', marks, 5).length, 0, 'and nothing coming up')
}

/* -------------------------------------------- the schedule has a real rhythm to read */
{
  // A calendar is only worth surfacing if the dates behind it behave. This is the check that
  // the break is a real hole in the year rather than a label, and that a February week off is
  // the break rather than the schedule falling apart.
  const fresh = newSeason(4242)
  const gaps = {}
  let b2b = 0, longest = 0
  const breakGaps = []
  for (const t of TEAMS) {
    const days = []
    for (let i = 0; i < fresh.schedule.length; i++) {
      const [h, a] = fresh.schedule[i]
      if (h === t || a === t) days.push(fresh.day[i])
    }
    days.sort((x, y) => x - y)
    eq(days.length, 82, `${t} plays eighty-two`)
    for (let i = 1; i < days.length; i++) {
      const g = days[i] - days[i - 1]
      gaps[g] = (gaps[g] || 0) + 1
      if (g === 1) b2b++
      if (g > longest) longest = g
      if (g >= 5) {
        const d = dayToDate(fresh.startYear ?? 2026, days[i - 1])
        breakGaps.push({ m: d.m, g })
      }
    }
  }
  const perTeam = b2b / TEAMS.length
  ok(perTeam >= 8 && perTeam <= 18, `about a dozen back-to-backs a team (${perTeam.toFixed(1)})`)
  ok((gaps[2] || 0) > (gaps[1] || 0), 'every-other-night is the ordinary rhythm')
  ok(longest <= 12, `nobody sits idle for a fortnight (${longest})`)
  // The All-Star break is the one week off every club gets, so February is far and away the
  // biggest month for long gaps. The rest are April: the round packer thins out as the last
  // games are placed, which is bounded by the "everybody finishes within a fortnight" check
  // above rather than by this one.
  const byMonth = {}
  for (const x of breakGaps) byMonth[x.m] = (byMonth[x.m] || 0) + 1
  const feb = byMonth[2] || 0
  ok(feb >= 25, `nearly every club gets the All-Star break off (${feb} of 30)`)
  const others = Object.entries(byMonth).filter(([m]) => Number(m) !== 2).map(([, c]) => c)
  ok(feb > Math.max(0, ...others),
    `February is the biggest month for a week off (${JSON.stringify(byMonth)})`)
}

eq(whenText(0), 'tonight', 'tonight is tonight')
eq(whenText(1), 'tomorrow', 'tomorrow is tomorrow')
eq(whenText(6), 'in 6 nights', 'and the rest are nights')
eq(ahead(null, 'BOS').length, 0, 'a missing season has nothing ahead')
eq(nextGame(null, 'BOS'), null, 'nor a next game')

console.log(`calendar: ${n - bad}/${n}`)
process.exit(bad ? 1 : 0)
