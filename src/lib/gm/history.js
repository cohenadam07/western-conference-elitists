// WHAT THE LEAGUE REMEMBERS.
//
// The engine has produced a complete box score for every game since box.js was written, and
// the season has folded it into an accumulator every night. Then the offseason threw the
// whole thing away: `rollSeason` kept the record, the seed and the playoff run, and dropped
// `state.stats` on the floor. So a career could tell you it had won 340 games and could not
// tell you who scored them.
//
// That is the gap this file closes. Season by season, the league's statistical record is
// archived onto the save, and everything a franchise mode is actually played for — a career
// line, an all-time leaderboard, a Hall of Fame case, the question of whether the man you
// traded in 2029 turned into anything — is a read against it.
//
// SIZE IS THE DESIGN CONSTRAINT. A save lives in localStorage, which is a handful of
// megabytes for the whole origin, shared across three franchise slots. Thirty teams is about
// 550 statistical lines a year; stored as objects with fourteen named keys that is ~100KB a
// season and a twenty-year career would not fit. So a line is stored as a FIXED-ORDER ARRAY
// of integers and names live once in a dictionary keyed by player id. Same information,
// about a fifth of the bytes, and the field order is declared in one place below so the
// encoding can never drift from the decoding.
import { perGame } from './box.js'

// The archived field order. Append only — never reorder, never remove. An old save decodes
// by position, so moving a column silently rewrites history.
export const FIELDS = ['g', 'started', 'min', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'tov',
  'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'stl', 'blk']

export const HISTORY_VERSION = 1

const int = (x) => Math.round(x || 0)

// One accumulator row → [id, team, ...FIELDS]. Minutes are the only field worth a decimal
// and they are not worth one at season scale, so everything rounds to an integer.
const encodeLine = (b) => [b.id, b.team, ...FIELDS.map((k) => int(b[k]))]

const decodeLine = (row) => {
  const out = { id: row[0], team: row[1] }
  FIELDS.forEach((k, i) => { out[k] = row[i + 2] || 0 })
  return out
}

export const emptyHistory = () => ({ v: HISTORY_VERSION, names: {}, seasons: [] })

// Read side of the dictionary. A player who has never appeared anywhere is still worth
// naming rather than rendering as an id.
export const nameOf = (history, id) => history?.names?.[id] || `#${id}`

// FOLD A FINISHED SEASON ONTO THE SAVE.
//
// Called once, from the offseason rollover, with the season state that was actually played.
// Idempotent by season key: replaying the same year cannot double it, because a career that
// is resumed from a progress marker re-runs the rollover.
export function archiveSeason(history, { season, stats, rec, champion, honours, team }) {
  const h = history && history.v === HISTORY_VERSION ? history : emptyHistory()
  const names = { ...h.names }
  const lines = []
  for (const b of Object.values(stats || {})) {
    if (!b || !b.g) continue
    if (b.n) names[b.id] = b.n
    lines.push(encodeLine(b))
  }
  // Standings kept as [w, l] per team — enough for "who won the West in 2031" without
  // carrying a second copy of the schedule.
  const table = {}
  for (const [t, r] of Object.entries(rec || {})) table[t] = [r.w || 0, r.l || 0]
  // Re-archiving a season must not ERASE what it is not handed. A career resumed from its
  // progress marker re-runs the rollover, and the awards are counted at a different moment
  // from the stats — so a second pass with no ballot in hand would quietly wipe the record of
  // every award that season produced. Keep what is there unless something replaces it.
  const prior = h.seasons.find((s) => s.season === season)
  const seasons = h.seasons.filter((s) => s.season !== season)
  seasons.push({ season, team, champion: champion || prior?.champion || null, lines, table,
    honours: (honours && honours.length) ? honours : (prior?.honours || []) })
  seasons.sort((a, b) => String(a.season).localeCompare(String(b.season)))
  return { v: HISTORY_VERSION, names, seasons }
}

// ---------------------------------------------------------------------------
// Reading

export const seasonsOf = (history) => (history?.seasons || [])

export function seasonLines(history, season) {
  const s = seasonsOf(history).find((x) => x.season === season)
  return s ? s.lines.map(decodeLine) : []
}

// Everything one player ever did, newest last, with per-game rates computed at read time so
// the archive stays additive totals and never has to be re-rounded.
export function careerFor(history, id) {
  const rows = []
  for (const s of seasonsOf(history)) {
    const row = s.lines.find((r) => r[0] === id)
    if (!row) continue
    const b = decodeLine(row)
    rows.push({ season: s.season, ...rates(b) })
  }
  return rows
}

// Career totals, and the averages that go under a career table's last line.
export function careerTotals(history, id) {
  const acc = { id, g: 0 }
  FIELDS.forEach((k) => { acc[k] = 0 })
  let seasons = 0
  for (const s of seasonsOf(history)) {
    const row = s.lines.find((r) => r[0] === id)
    if (!row) continue
    seasons += 1
    const b = decodeLine(row)
    FIELDS.forEach((k) => { acc[k] += b[k] || 0 })
  }
  return seasons ? { ...rates(acc), seasons } : null
}

// Totals → the language the game is argued in.
export function rates(b) {
  const per = (k, d = 1) => Math.round(perGame(b, k) * 10 ** d) / 10 ** d
  return {
    id: b.id, team: b.team, g: b.g, started: b.started || 0,
    totals: b,
    mpg: per('min'), pts: per('pts'), reb: per('reb'), ast: per('ast'),
    stl: per('stl'), blk: per('blk'), tov: per('tov'),
    fgPct: b.fga ? b.fgm / b.fga : 0,
    fg3Pct: b.fg3a ? b.fg3m / b.fg3a : 0,
    ts: (b.fga || b.fta) ? (b.pts || 0) / (2 * ((b.fga || 0) + 0.44 * (b.fta || 0))) : 0,
  }
}

// LEADERS, for one season or for all of them.
//
// `min` is a games floor, and it is not decoration: without one the three-point percentage
// leaderboard is a man who took one shot in November. The NBA's own qualifiers are rate
// floors per game played, which is the same idea.
const RATE_KEYS = new Set(['pts', 'reb', 'ast', 'stl', 'blk', 'mpg', 'tov'])

export function leaders(lines, key, { n = 10, min = 20, asc = false } = {}) {
  const rows = lines
    .map((b) => (b.totals ? b : rates(b)))
    .filter((r) => r.g >= min)
    .filter((r) => (key === 'fg3Pct' ? (r.totals.fg3a || 0) >= r.g : true))
    .filter((r) => (key === 'fgPct' || key === 'ts' ? (r.totals.fga || 0) >= r.g * 3 : true))
  rows.sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]))
  return rows.slice(0, n)
}

// All-time: every player-season ever archived, ranked as single seasons. "The best year
// anybody has had while you ran this franchise" is a more interesting record than a career
// total, and it is the one a record book leads with.
export function allTimeSeasons(history, key, opts = {}) {
  const rows = []
  for (const s of seasonsOf(history))
    for (const row of s.lines) rows.push({ season: s.season, ...rates(decodeLine(row)) })
  return leaders(rows, key, opts).map((r) => ({ ...r, name: nameOf(history, r.id) }))
}

// All-time on career totals — the counting-stat leaderboard, which is the one that takes
// twenty seasons to mean anything and is the reason this file exists.
export function allTimeCareers(history, key, { n = 10 } = {}) {
  const acc = new Map()
  for (const s of seasonsOf(history))
    for (const row of s.lines) {
      const b = decodeLine(row)
      let a = acc.get(b.id)
      if (!a) { a = { id: b.id, g: 0 }; FIELDS.forEach((k) => { a[k] = 0 }); acc.set(b.id, a) }
      FIELDS.forEach((k) => { a[k] += b[k] || 0 })
    }
  const rows = [...acc.values()].map((a) => ({ ...rates(a), total: a[key] || 0 }))
  rows.sort((x, y) => y.total - x.total)
  return rows.slice(0, n).map((r) => ({ ...r, name: nameOf(history, r.id) }))
}

// Every award ever won, flattened, so the record book can answer "who has the most MVPs".
export function honourRoll(history) {
  const out = []
  for (const s of seasonsOf(history))
    for (const h of s.honours || []) out.push({ season: s.season, ...h })
  return out
}
