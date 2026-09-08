// THE CALENDAR.
//
// The schedule generator already produced a structurally real NBA season — four games
// against each division rival, four against six of the other conference teams and three
// against the remaining four, two against everybody in the other conference, ordered into
// rounds so nobody drifts five games ahead of the field. What it did not have was DATES,
// and without dates there is no All-Star break, no NBA Cup group stage, no back-to-backs
// and no way for the calendar screen to say what is on tonight.
//
// The real shape, which this reproduces:
//   - Opening night in the third week of October, last game in the second week of April.
//   - About 168 days for 82 games, so roughly one game every other night.
//   - Twelve to fifteen back-to-backs per team. Not zero: a schedule with no back-to-backs
//     removes the reason availability and rotation minutes matter in February.
//   - A five-day All-Star break in mid-February with no league games.
//   - NBA Cup group games on Tuesdays and Fridays in November, played as regular-season
//     games that also count in the group tables.

export const SEASON_START = { m: 10, d: 21 }     // third Tuesday of October
export const ALLSTAR_BREAK_DAYS = 5

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_NAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysIn = (y, m) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1])

// A plain day counter from the season's opening night, so arithmetic never needs Date and
// never disagrees between runtimes — the same reason everything else here avoids it.
export function dayToDate(startYear, offset) {
  let y = startYear, m = SEASON_START.m, d = SEASON_START.d + offset
  for (;;) {
    const dim = daysIn(y, m)
    if (d <= dim) break
    d -= dim
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return { y, m, d }
}

export const label = ({ m, d }) => `${MONTH_NAME[m - 1]} ${d}`
export const longLabel = ({ y, m, d }) => `${MONTH_NAME[m - 1]} ${d}, ${y}`

// Day of week for a date, 0 = Sunday. Zeller's congruence, so no Date object.
export function weekday({ y, m, d }) {
  const mm = m < 3 ? m + 12 : m
  const yy = m < 3 ? y - 1 : y
  const k = yy % 100, j = Math.floor(yy / 100)
  const h = (d + Math.floor((13 * (mm + 1)) / 5) + k + Math.floor(k / 4)
    + Math.floor(j / 4) + 5 * j) % 7
  return (h + 6) % 7
}
export const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The gap between one round and the next, in nights. Two nights is the ordinary rhythm; a
// one-night gap is a back-to-back for every team playing in both rounds. The pattern gives
// about thirteen back-to-backs a team across the year, which is where the real league sits.
// Fourteen nights of rhythm, summing to 29 — an average gap of 2.07, which puts opening
// night in the third week of October and the last game in the second week of April, where
// the real one sits. Two of the fourteen are single nights: those are the back-to-backs.
const GAP = [2, 2, 3, 1, 2, 2, 3, 2, 2, 1, 3, 2, 2, 2]

// Assign every round a day offset, with the All-Star break cut out of the middle.
export function assignDays(roundCount, opts = {}) {
  const breakAfter = opts.breakAfter ?? Math.round(roundCount * 0.63)
  const days = []
  let day = 0
  for (let i = 0; i < roundCount; i++) {
    days.push(day)
    let gap = GAP[i % GAP.length]
    if (i === breakAfter) gap += ALLSTAR_BREAK_DAYS
    day += gap
  }
  return { days, breakAfter, breakStart: days[breakAfter] + 1, length: day }
}

// The NBA Cup: group games are played on designated nights in November, which in this
// calendar means the rounds falling inside the first three and a half weeks of the season.
export const CUP_ROUNDS = 12
export const isCupRound = (i) => i >= 3 && i < 3 + CUP_ROUNDS

/* ---------------------------------------------------------------- what is coming up */
//
// The season has always known the date of every game. Nothing ever showed it: the top strip
// carried a fixed string from the phase table, so "Dec 25" sat there through the whole
// Christmas-to-deadline stretch while the league played on into January. A calendar you
// cannot read is not a calendar, it is a label.
//
// This turns the schedule into the thing a real front office has on the wall: today's date,
// tonight's game, and the dated events between here and the end of the year.

// Today, in the season's own terms — the day of the last game played, or opening night if
// nothing has been played yet.
export function today(state) {
  const day = state?.played > 0 ? (state.day?.[state.played - 1] ?? 0) : 0
  return { day, date: dayToDate(state?.startYear ?? 2026, day) }
}

// The user's next game: who, where, and how many nights away.
export function nextGame(state, team) {
  if (!state?.schedule) return null
  const from = today(state).day
  for (let i = state.played; i < state.schedule.length; i++) {
    const [home, away] = state.schedule[i]
    if (home !== team && away !== team) continue
    const day = state.day?.[i] ?? 0
    return {
      i,
      day,
      date: dayToDate(state.startYear ?? 2026, day),
      home,
      away,
      opponent: home === team ? away : home,
      at: home === team ? 'home' : 'away',
      cup: !!state.cup?.[i],
      inDays: Math.max(0, day - from),
    }
  }
  return null
}

// The day a team plays its Nth game — how the deadline and the All-Star break get real
// dates instead of assumed ones.
export function dayOfTeamGame(state, team, n) {
  if (!state?.schedule || n < 1) return null
  let seen = 0
  for (let i = 0; i < state.schedule.length; i++) {
    const [home, away] = state.schedule[i]
    if (home !== team && away !== team) continue
    seen += 1
    if (seen === n) return state.day?.[i] ?? 0
  }
  return null
}

// The dated events between here and the end of the regular season, nearest first. Marks are
// passed in rather than imported so this module stays a calendar and does not have to know
// what an All-Star break or a trade deadline is.
export function ahead(state, team, marks = [], limit = 5) {
  if (!state?.schedule) return []
  const from = today(state).day
  const out = []
  const g = nextGame(state, team)
  if (g) {
    out.push({
      kind: 'game',
      day: g.day,
      date: g.date,
      inDays: g.inDays,
      label: g.at === 'home' ? `${g.opponent} visit` : `at ${g.opponent}`,
      note: g.cup ? 'Cup group game' : null,
    })
  }
  for (const m of marks) {
    const day = m.game ? dayOfTeamGame(state, team, m.game) : m.day
    if (day == null || day < from) continue
    out.push({
      kind: m.kind || 'mark',
      day,
      date: dayToDate(state.startYear ?? 2026, day),
      inDays: Math.max(0, day - from),
      label: m.label,
      note: m.note || null,
    })
  }
  return out.sort((a, b) => a.day - b.day || (a.kind === 'game' ? -1 : 1)).slice(0, limit)
}

// "tonight" / "tomorrow" / "in 6 nights" — the way somebody talks about a schedule rather
// than the way a database stores one.
export const whenText = (inDays) => (inDays <= 0 ? 'tonight'
  : inDays === 1 ? 'tomorrow' : `in ${inDays} nights`)
