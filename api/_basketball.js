// api/_basketball.js — Basketball Savant, as answers. One section of the AI connector
// (api/mcp.js): it knows basketball, the connector only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/basketball/v1/ (see
// scripts/lib/savant-api.mjs): a glossary, a player index, and one file per season in which
// every stat already carries its league and position percentile. Nothing is computed here
// that the page computes — percentiles are read, never re-derived — so an answer from this
// file is the number on the player's card. Loading, caching and name matching are shared
// with the other sections and live in api/_core.js.
//
// WHAT AN ANSWER ALWAYS SAYS
//   - which pool a percentile is from: the league, or his position ("vs. guards")
//   - when a stat is on too small a sample to trust (the page hatches those bars)
//   - when the season did not track a stat at all, or tracked it but has no number for him,
//     rather than showing a zero
//   - what a stat means, in the page's own words, wherever one panel or one stat is asked for
//   - where the card is: basketball-savant.html?p=<id>
//
// BEYOND ONE CARD
// The same season files answer four more kinds of question, and nothing new is worked out
// for any of them except an order:
//
//   leaderboard    who is top (or bottom) in a stat among that season's qualified players,
//                  the page's own Leaderboard Builder rules: same pool, same sort
//   compare        two to four player-seasons side by side on the same stats
//   career         one player season by season
//   list stats     the glossary: every stat's key, name and meaning
//
// A percentile stops at 99, which is four men in a pool of 349. So a profile also gives a
// stat's place among qualified players ("1st of 349") when that place is in the top ten: it
// is the same order the leaderboard lists, and it is the only way to say "he led the league".
//
// ONE DELIBERATE DIFFERENCE FROM THE PAGE: signed stats print without a percent sign. The
// page's signed format appends "%" to all of them, which is right for the two FG% diffs and
// wrong for Box Plus/Minus ("+14.2%"). A sign and a number is true for every one of them.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, boardSlice, day, findStat, makeLoader, mapLimit, miss, norm, ordinal, prepare, prepareStats, rank, ranked, signed, thousands, tidy, topTier } from './_core.js'

const files = makeLoader('savant-api/basketball/v1', { what: 'Basketball Savant' })

export const GROUPS = { context: 'ctx', offense: 'off', defense: 'def', value: 'val' }
const GROUP_ORDER = ['ctx', 'off', 'def', 'val']
const PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }
const WINDOW_TEXT = { season: 'full season', l10: 'last 10 games', l25: 'last 25 games', l75: 'last 75 games' }

const SOURCE = 'Basketball Savant, Western Conference Elitists (wcehoops.com)'

// Overall-value stats that belong to one end of the floor. Asked for "defense", a caller
// expects the one number that sums a defender up, and the page files it under Overall value;
// so each is also given with its own side, under its own heading.
const ALSO_IN = { off: ['obpm'], def: ['dbpm'] }

// The per-game line printed at the top of every card. Not Savant stats (they carry no
// percentile), but "who led the league in scoring" means points per game, so a leaderboard
// can be ranked by them.
const PER_GAME = [
  { key: 'ppg', label: 'Points per game', line: 'ppg' },
  { key: 'rpg', label: 'Rebounds per game', line: 'rpg' },
  { key: 'apg', label: 'Assists per game', line: 'apg' },
  { key: 'tpg', label: 'Turnovers per game', line: 'tpg' },
]
const PER_GAME_WHAT = 'From the per-game line at the top of his card. It is not a Savant stat, so it has no percentile.'

// What the page's own leaderboard shows when it opens, for when the build could not read it.
const COMMON = ['pts', 'ts', 'tp3', 'ast', 'reb75', 'usg', 'stl', 'blk', 'bpm']

const PER_75 = 'A stat labelled "/ 75" is per 75 possessions, which adjusts for pace so that players from fast and slow eras can be compared.'
// Stats that describe a player rather than grade him. Named one by one: the page's own tag
// ("ingredient", "context") does not sort them, since Block % and Defensive BPM are
// ingredients too and more of those is plainly better.
const DESCRIBES = new Set(['mpg', 'minshare', 'usg', 'tp3a', 'tp3r', 'fta', 'p3pt', 'drv', 'selfcr', 'mtch', 'ddiff', 'height', 'length', 'strength', 'reach'])
const STYLE = 'Not every stat is a grade. Some describe role, style or build rather than quality (usage, 3-point rate, share of points from three, matchup difficulty, minutes, height): on those a higher percentile means more of it, not better.'

const loadMeta = () => files.load('meta.json')
const loadSeason = (season) => files.load(`seasons/${season}.json`)

// The player index, with each name prepared for matching once per load.
const prepared = new WeakMap()
async function loadPlayers() {
  const file = await files.load('players.json')
  let rows = prepared.get(file)
  if (!rows) { rows = prepare(file.players); prepared.set(file, rows) }
  return rows
}

const startYear = (season) => +String(season).slice(0, 4)

// Among equally good name matches: the more recent player, then the longer career.
const recent = (a, b) => startYear(b.to) - startYear(a.to) || b.seasons - a.seasons

// ---- small formatting helpers ----------------------------------------------------------

export const cardUrl = (id) => `${SITE}/basketball-savant.html?p=${encodeURIComponent(id)}`

const tier = (p) => (p >= 82 ? 'elite' : p >= 62 ? 'high' : p >= 40 ? 'avg' : 'low') // the page's word()
const feetInches = (n) => { const f = Math.floor(n / 12); return `${f}'${Math.round(n - f * 12)}"` }

// A stat's value the way the page prints it (its fmt()), with the exceptions in the header:
// signed stats carry no "%", and the composite stats print their number without a tier word
// because both percentiles are stated beside it. Self-creation is the one stat the page
// shows as a word only; it does here too, from the league percentile, as on the default view.
export function display(unit, v, leaguePct) {
  if (miss(v)) return '—'
  switch (unit) {
    case 'pct3': return '.' + String(Math.round(v * 1000)).padStart(3, '0')
    case 'pct1': return (+v).toFixed(1) + '%'
    case 'num1': return (+v).toFixed(1)
    case 'num2': return (+v).toFixed(2)
    case 'num3': return (v < 0 ? '−' : '') + Math.abs(+v).toFixed(3).replace(/^0/, '')
    case 'num0': return String(Math.round(v))
    case 'sgn': return signed(v)
    case 'word': return leaguePct == null ? '—' : tier(leaguePct)
    case 'wnum': return (+v).toFixed(1)
    case 'wsgn': return signed(+v)
    case 'ftin': return feetInches(v)
    case 'lb': return `${Math.round(v)} lb`
    case 'sec': return (+v).toFixed(1) + 's'
    case 'inch': return (+v).toFixed(1) + '"'
    default: return String(v)
  }
}

// ---- places ----------------------------------------------------------------------------

// One season's qualified values for a stat, sorted, built once per loaded file. The same
// pool the build ranked the percentiles in (scripts/lib/savant-api.mjs).
const pooled = new WeakMap()
function poolOf(file, key) {
  let by = pooled.get(file)
  if (!by) { by = new Map(); pooled.set(file, by) }
  let pool = by.get(key)
  if (!pool) {
    const vals = []
    for (const p of file.players) { const c = p.qualified && p.m[key]; if (c && !miss(c[0])) vals.push(c[0]) }
    pool = Float64Array.from(vals).sort()
    by.set(key, pool)
  }
  return pool
}

// A qualified player's place in that pool: one more than the number of men with a better
// value, so equal values share a place. Null for a man who is not in the pool.
function placeOf(file, row, m) {
  const c = row.qualified && row.m[m.key]
  if (!c || miss(c[0])) return null
  const pool = poolOf(file, m.key)
  let better = 0
  if (m.lowerIsBetter) { while (better < pool.length && pool[better] < c[0]) better++ }
  else { let i = pool.length - 1; while (i >= 0 && pool[i] > c[0]) { better++; i-- } }
  return { rank: better + 1, of: pool.length }
}

// ---- teams -----------------------------------------------------------------------------

// The team codes in the data, with the names people use. A franchise that moved or renamed
// has a code for each era, so a name can fit several; the season settles which.
const TEAMS = {
  ATL: ['Atlanta Hawks'], BKN: ['Brooklyn Nets'], BOS: ['Boston Celtics'], CHA: ['Charlotte Hornets', 'Charlotte Bobcats'],
  CHH: ['Charlotte Hornets'], CHI: ['Chicago Bulls'], CLE: ['Cleveland Cavaliers', 'Cavs'], DAL: ['Dallas Mavericks', 'Mavs'],
  DEN: ['Denver Nuggets'], DET: ['Detroit Pistons'], GSW: ['Golden State Warriors'], HOU: ['Houston Rockets'],
  IND: ['Indiana Pacers'], KCK: ['Kansas City Kings'], LAC: ['Los Angeles Clippers', 'LA Clippers'], LAL: ['Los Angeles Lakers', 'LA Lakers'],
  MEM: ['Memphis Grizzlies'], MIA: ['Miami Heat'], MIL: ['Milwaukee Bucks'], MIN: ['Minnesota Timberwolves', 'Wolves'],
  NJN: ['New Jersey Nets'], NOH: ['New Orleans Hornets'], NOK: ['New Orleans Oklahoma City Hornets'], NOP: ['New Orleans Pelicans'],
  NYK: ['New York Knicks'], OKC: ['Oklahoma City Thunder'], ORL: ['Orlando Magic'], PHI: ['Philadelphia 76ers', 'Sixers'],
  PHO: ['Phoenix Suns'], PHX: ['Phoenix Suns'], POR: ['Portland Trail Blazers', 'Blazers'], SAC: ['Sacramento Kings'],
  SAS: ['San Antonio Spurs'], SDC: ['San Diego Clippers'], SEA: ['Seattle SuperSonics', 'Sonics'], TOR: ['Toronto Raptors'],
  UTA: ['Utah Jazz'], VAN: ['Vancouver Grizzlies'], WAS: ['Washington Wizards'], WSB: ['Washington Bullets'],
}
const teamName = (code) => (TEAMS[code] ? TEAMS[code][0] : code)

// The team a caller means, as the code that season's file uses. A code is taken as it is; a
// name ("Spurs", "San Antonio") has to land on one team that has players in that season.
function resolveTeam(input, file) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const here = [...new Set(file.players.map((p) => p.team).filter(Boolean))].sort()
  const code = here.find((c) => c.toLowerCase() === raw.toLowerCase())
  if (code) return code
  const q = norm(raw).split(' ').filter(Boolean)
  const fits = (c) => (TEAMS[c] || []).some((name) => { const words = norm(name).split(' '); return q.every((t) => words.includes(t)) })
  const hits = here.filter(fits)
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) throw new SavantError(`"${raw}" fits more than one team in ${file.season}: ${hits.map((c) => `${c} (${teamName(c)})`).join(', ')}. Call again with the code.`)
  const elsewhere = Object.keys(TEAMS).filter((c) => !here.includes(c) && (c.toLowerCase() === raw.toLowerCase() || fits(c)))
  if (elsewhere.length) throw new SavantError(`${elsewhere.map((c) => `${teamName(c)} (${c})`).join(', ')} had no players in ${file.season} in Basketball Savant. Teams that season: ${here.join(', ')}.`)
  throw new SavantError(`No NBA team matches "${raw}". Give a team code or name. Teams in ${file.season}: ${here.join(', ')}.`)
}

// ---- seasons -------------------------------------------------------------------------

// "2025-26" and "2025-2026" are a season. A bare year is not: "2026" means 2025-26 to
// Basketball Reference and 2026-27 to the league office, so it is refused with both spelled out.
function parseSeason(input, meta) {
  if (input == null || input === '') return null
  const s = String(input).trim().replace(/[‐-―/]/g, '-')
  let m = s.match(/^(\d{4})-(\d{2}|\d{4})$/)
  if (m) {
    const y = +m[1]
    const season = `${y}-${String((y + 1) % 100).padStart(2, '0')}`
    if (+m[2] % 100 !== (y + 1) % 100) throw new SavantError(`"${input}" is not a season. A season spans two years, written like ${season}.`)
    if (!meta.seasons.includes(season)) {
      throw new SavantError(`Basketball Savant has no ${season} season. It covers ${meta.seasons[meta.seasons.length - 1]} through ${meta.seasons[0]}.`)
    }
    return season
  }
  m = s.match(/^(\d{4})$/)
  if (m) {
    const y = +m[1]
    const two = (n) => String(n % 100).padStart(2, '0')
    throw new SavantError(`"${input}" is ambiguous. Give the season as two years: ${y - 1}-${two(y)} (ended in ${y}) or ${y}-${two(y + 1)} (began in ${y}).`)
  }
  throw new SavantError(`"${input}" is not a season. Write it like ${meta.latestSeason}.`)
}

const inSpan = (row, season) => startYear(season) >= startYear(row.from) && startYear(season) <= startYear(row.to)
const span = (row) => (row.from === row.to ? row.from : `${row.from} to ${row.to}`)
const candidateLine = (row) => `${row.name} (id ${row.id}): ${row.pos}, ${span(row)}, last team ${row.team}`

// ---- finding the player ----------------------------------------------------------------

// An id ("203999", "br:ewingpa01") or a name. A name has to land on one player; when it
// lands on several, the season is used to choose (a few careers are split across two ids),
// and failing that the candidates are listed so the caller can pick by id.
async function resolvePlayer(input, season) {
  const rows = await loadPlayers()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a player name or id.')

  const byId = rows.find((r) => String(r.id) === raw)
  if (byId) return byId
  if (/^-?\d+$/.test(raw) || /^br:/i.test(raw)) {
    throw new SavantError(`No player has the id "${raw}". Search by name with nba_search_players.`)
  }

  const ranked = rank(rows, raw, recent)
  if (!ranked.length) throw new SavantError(`No player matches "${raw}". Check the spelling, or search with nba_search_players.`)

  const top = ranked[0].score
  let best = topTier(ranked)
  if (best.length > 1 && season) {
    const there = best.filter((r) => inSpan(r, season))
    if (there.length === 1) return there[0]
    if (there.length > 1) best = there
  }
  // One clear answer: the only player at the top, matched on whole words or a prefix. A name
  // that matches only as a near spelling never resolves on its own, even alone: it may be
  // someone who is not in the data, one letter away from someone who is.
  if (best.length === 1 && top >= 60) return best[0]

  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  const why = best.length > 1 ? `${best.length} players match "${raw}"` : `"${raw}" is not an exact match`
  const tip = best.length > 1 && !season ? '\nGiving the season also settles it when only one of them played that year.' : ''
  throw new SavantError(`${why}. Call again with one of these ids:\n${list.map((r) => `- ${candidateLine(r)}`).join('\n')}${tip}`)
}

// ---- search --------------------------------------------------------------------------

export async function searchPlayers({ query, limit = 10 }) {
  const rows = await loadPlayers()
  const ranked = rank(rows, query, recent)
  const shown = ranked.slice(0, limit).map(({ row }) => ({
    id: String(row.id),
    name: row.name,
    position: row.pos,
    team: row.team,
    first_season: row.from,
    last_season: row.to,
    seasons: row.seasons,
    url: cardUrl(row.id),
  }))

  const structured = { query, total: ranked.length, count: shown.length, players: shown }
  if (!shown.length) {
    return { structured, text: `No player in Basketball Savant matches "${query}". It covers every player with stats since 1979-80. Check the spelling or try the last name alone.` }
  }
  const head = ranked.length === 1 ? `1 player matches "${query}":` : `${ranked.length} players match "${query}"${ranked.length > shown.length ? `, showing the first ${shown.length}` : ''}:`
  const lines = shown.map((p, i) =>
    `${i + 1}. ${p.name} (id ${p.id}): ${p.position}, ${p.first_season === p.last_season ? p.first_season : `${p.first_season} to ${p.last_season}`}, ${p.seasons} season${p.seasons === 1 ? '' : 's'}, last team ${p.team}. ${p.url}`)
  // Say so when one man is listed twice, so the caller does not read it as two players.
  const names = shown.map((p) => p.name)
  const twice = names.some((n, i) => names.indexOf(n) !== i)
  const note = twice
    ? '\nThe same name can be two different players, or one player listed twice: some careers that began before 1996-97 are split across two ids, the earlier seasons under an id that starts "br:".'
    : ''
  return { structured, text: `${head}\n${lines.join('\n')}${note}` }
}

// ---- profile -------------------------------------------------------------------------

export async function playerProfile({ player, season, window = 'season', group = 'all' }) {
  const meta = await loadMeta()
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted)
  const seasonId = wanted || who.to
  const file = await loadSeason(seasonId)
  const row = file.players.find((p) => String(p.id) === String(who.id))
  if (!row) {
    const where = inSpan(who, seasonId)
      ? `${who.name} has no stats in ${seasonId}; he may not have played that season.`
      : `${who.name} was not in the league in ${seasonId}.`
    throw new SavantError(`${where} Basketball Savant has him from ${span(who)}.`)
  }

  let src = row
  if (window !== 'season') {
    if (!file.windows.includes(window)) {
      throw new SavantError(`The ${WINDOW_TEXT[window]} view exists only for ${meta.latestSeason}, the latest season. Ask for the full season of ${seasonId} instead.`)
    }
    src = row.w && row.w[window]
    if (!src) throw new SavantError(`${row.name} has no ${WINDOW_TEXT[window]} numbers in ${seasonId}. Ask for the full season instead.`)
  }

  const groupKey = group === 'all' ? null : GROUPS[group]
  const peers = PEERS[row.pos] || 'his position'
  const low = new Set(src.low || [])
  const stats = []
  const notTracked = []
  const noValue = []
  // One panel is its own stats plus the overall-value stat for that end of the floor.
  const also = groupKey ? ALSO_IN[groupKey] || [] : []
  const inPanel = (m) => !groupKey || m.group === groupKey
  for (const m of [...meta.metrics.filter(inPanel), ...meta.metrics.filter((x) => also.includes(x.key))]) {
    if (startYear(seasonId) < startYear(m.since)) { notTracked.push({ key: m.key, label: m.label, since: m.since }); continue }
    const cell = src.m[m.key]
    // Tracked that season, but nothing for him: the page draws no bar. Said, not skipped.
    if (!cell) { noValue.push({ key: m.key, label: m.label }); continue }
    // His place among qualified players, full season only: the leaderboard's order.
    const place = window === 'season' ? placeOf(file, row, m) : null
    stats.push({
      key: m.key,
      label: m.label,
      group: meta.groups[m.group] || m.group,
      subgroup: m.sub || null,
      kind: m.layer || null,
      value: cell[0],
      display: display(m.unit, cell[0], cell[1]),
      league_percentile: cell[1],
      position_percentile: cell[2],
      league_rank: place ? place.rank : null,
      league_rank_of: place ? place.of : null,
      lower_is_better: m.lowerIsBetter,
      low_sample: low.has(m.key),
      what: m.explain || null,
    })
  }

  const pool = file.qualified || {}
  const structured = {
    player: {
      id: String(row.id),
      name: row.name,
      team: row.team,
      position: row.pos,
      age: tidy(row.age),
      experience: row.exp ?? null,
      qualified: row.qualified,
      games: row.gp,
      minutes: row.min,
    },
    season: seasonId,
    window,
    per_game: row.line
      ? { points: row.line.ppg ?? null, rebounds: row.line.rpg ?? null, assists: row.line.apg ?? null, turnovers: row.line.tpg ?? null, minutes: row.line.mpg ?? null }
      : null,
    pools: { league: pool.league ?? null, position: pool[row.pos] ?? null, position_label: peers },
    stats,
    not_tracked: notTracked,
    no_value: noValue,
    notes: [],
    url: cardUrl(row.id),
    data_as_of: day(meta.generated),
    source: SOURCE,
  }

  // ---- the same thing in words ----
  const L = []
  L.push(`${row.name} (${row.team}, ${row.pos}), ${seasonId}, ${WINDOW_TEXT[window]}`)
  const facts = []
  if (row.age != null) facts.push(`age ${tidy(row.age)}`)
  if (row.gp != null) facts.push(`${row.gp} games`)
  if (row.min != null) facts.push(`${thousands(row.min)} minutes`)
  if (facts.length) L.push(`${facts.join(', ').replace(/^a/, 'A')} in ${seasonId}.`)
  if (row.line) {
    const l = row.line
    const one = (v) => (miss(v) ? '\u2014' : (+v).toFixed(1))
    L.push(`Per game${window === 'season' ? '' : ' (full season)'}: ${one(l.ppg)} points, ${one(l.rpg)} rebounds, ${one(l.apg)} assists, ${one(l.tpg)} turnovers, ${one(l.mpg)} minutes.`)
  }
  L.push('')
  // The caveats. They go into the text and, as notes, into the structured result, so a
  // client that only passes one of the two along still carries them.
  const notes = structured.notes
  notes.push(`Each stat shows two percentiles. "league" is against all ${pool.league ?? ''} qualified players in ${seasonId}; "vs. ${peers}" is against the ${pool[row.pos] ?? ''} qualified ${peers}.${window === 'season' ? '' : ` Both compare his ${WINDOW_TEXT[window]} with everyone else's.`} Stats tagged "lower is better" are already flipped, so a higher percentile is the better mark there too.`)
  if (!row.qualified) {
    const q = meta.qualify || {}
    notes.push(`He did not qualify for those pools${q.min_mpg && q.min_gp ? ` (${q.min_mpg}+ minutes per game and ${q.min_gp}+ games)` : ''}, so his percentiles rank a small sample against qualified players. Treat them with caution.`)
  }
  notes.push(STYLE)
  L.push(...notes)

  let heading = null
  const crossed = new Set(also)
  for (const key of GROUP_ORDER) {
    for (const s of stats.filter((x) => x.group === (meta.groups[key] || key))) {
      // A stat brought in from Overall value says where it came from.
      const h = crossed.has(s.key) ? `${s.group} (the ${group} half)` : s.subgroup && s.subgroup !== s.group ? `${s.group}: ${s.subgroup}` : s.group
      if (h !== heading) { L.push('', h); heading = h }
      const pct = (p) => (p == null ? 'n/a' : ordinal(p))
      const tags = [s.lower_is_better ? 'lower is better' : null, s.low_sample ? 'low sample' : null].filter(Boolean)
      // The place is said only near the top, where a percentile can no longer tell men apart.
      const place = s.league_rank != null && s.league_rank <= 10 ? `; ${ordinal(s.league_rank)} of ${s.league_rank_of} qualified` : ''
      L.push(`- ${s.label}: ${s.display} (league ${pct(s.league_percentile)}, vs. ${peers} ${pct(s.position_percentile)}${place})${tags.length ? ` [${tags.join(', ')}]` : ''}`)
      // Asked for one panel, each stat is explained in the page's words.
      if (groupKey && s.what) L.push(`  ${s.what}`)
    }
  }
  if (!stats.length) L.push('', 'No stats in this group for that season.')
  if (stats.some((s) => s.league_rank != null && s.league_rank <= 10)) {
    notes.push(`A place such as "1st of ${pool.league ?? ''} qualified" is where his number falls among the qualified players who have that stat, the order nba_get_leaderboard lists. It is given for the top ten only; equal values share a place.`)
    L.push('', notes[notes.length - 1])
  }
  if (stats.some((s) => / 75\b/.test(s.label))) { notes.push(PER_75); L.push('', PER_75) }
  if (stats.some((s) => s.low_sample)) {
    notes.push('"low sample" means the stat sits below its stabilization threshold: too few attempts to trust yet.')
    L.push('', notes[notes.length - 1])
  }
  if (noValue.length) {
    notes.push(`No value for him in ${seasonId}${window === 'season' ? '' : ` over his ${WINDOW_TEXT[window]}`}, so the page draws no bar. That is a gap in the data, not a zero: ${noValue.map((m) => m.label).join(', ')}.`)
    L.push('', notes[notes.length - 1])
  }
  if (notTracked.length) L.push('', `Not tracked in ${seasonId}: ${notTracked.map((m) => `${m.label} (since ${m.since})`).join(', ')}.`)

  // Season facts the card shows under the bars. Latest season, players over the minutes floor.
  if (window === 'season' && group === 'all') {
    const dims = (meta.weakness && meta.weakness.dims) || {}
    const lowMatch = meta.weakness && meta.weakness.low_match
    const floor = (meta.weakness && meta.weakness.min_minutes) || 500
    const names = (list) => list.map((c) => `${c.name} (${c.team}, ${c.score}% match)`).join(', ')
    const extra = []
    if (row.comps) {
      structured.comps = row.comps.map((c) => ({ id: String(c.id), name: c.name, team: c.team, match: c.score }))
      extra.push(`Statistical comps, the closest profiles by usage, shooting, playmaking, rebounding and rim protection among players with ${floor}+ minutes: ${names(row.comps)}.`)
    }
    if (row.wflaws) {
      structured.weakest = row.wflaws.map((f) => ({ key: f.k, label: dims[f.k] || f.k, percentile: f.pct }))
      // These are ranked among peers with 500+ minutes, not among qualified players, so a
      // number here can sit a point or two off the same stat's "vs." percentile above.
      const pool500 = `${peers} with ${floor}+ minutes`
      notes.push(`"Where he ranks worst" is ranked among ${pool500}, a slightly different pool from the stat percentiles, so the two can differ by a few points.`)
      extra.push(`Where he ranks worst among ${pool500}: ${row.wflaws.map((f) => `${dims[f.k] || f.k} (${ordinal(f.pct)} percentile)`).join(', ')}. That pool differs slightly from the one behind the stat percentiles above, so the two can differ by a few points.`)
    }
    if (row.wcomps) {
      structured.weakness_comps = row.wcomps.map((c) => ({ id: String(c.id), name: c.name, team: c.team, match: c.score }))
      const best = Math.max(...row.wcomps.map((c) => c.score))
      const thin = lowMatch != null && best <= lowMatch
      extra.push(`Weakness comps, the players who share his flaws: ${names(row.wcomps)}.${thin ? ` That is a low match: nobody in ${seasonId} really shares this weakness profile.` : ''}`)
    }
    if (row.guard) {
      const g = row.guard
      structured.defensive_matchups = { guards: g.g, wings: g.w, bigs: g.b, possessions: g.poss ?? null }
      extra.push(`Who he guards, by share of his defensive matchups: guards ${Math.round(g.g)}%, wings ${Math.round(g.w)}%, bigs ${Math.round(g.b)}%${g.poss != null ? ` (${thousands(g.poss)} matchup possessions)` : ''}.`)
    }
    if (row.role && row.pos === 'Big') {
      const r = row.role
      structured.defensive_role = { perimeter_assignment_rate: r.perim ?? null, rim_contest_rate: r.contest ?? null, rim_fg_allowed_vs_expected: r.rimpm ?? null, possessions: r.poss ?? null, shots_defended: r.dfga ?? null }
      const bits = []
      if (!miss(r.perim)) bits.push(`Perimeter Assignment Rate ${(+r.perim).toFixed(1)}%`)
      if (!miss(r.contest)) bits.push(`Rim Contest Rate ${(+r.contest).toFixed(1)}%`)
      if (!miss(r.rimpm)) bits.push(`Rim FG% Allowed vs Expected ${signed(r.rimpm)} (lower is better)`)
      if (bits.length) extra.push(`Inferred defensive role: ${bits.join(', ')}. It reflects role, not ability: team scheme drives much of it, and matchup data is least reliable during switches.`)
    }
    if (extra.length) L.push('', ...extra)
  }

  L.push('', `Card: ${structured.url}`, `Source: ${structured.source}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- stats by name ---------------------------------------------------------------------

// Every stat a caller can name: the page's stats and the per-game line. Prepared for
// matching once per loaded glossary.
const statIndex = new WeakMap()
function statsOf(meta) {
  let rows = statIndex.get(meta)
  if (!rows) {
    rows = prepareStats([
      ...meta.metrics,
      ...PER_GAME.map((g) => ({ ...g, group: 'line', sub: null, layer: 'output', unit: 'num1', lowerIsBetter: g.key === 'tpg', since: meta.seasons[meta.seasons.length - 1], explain: PER_GAME_WHAT })),
    ])
    statIndex.set(meta, rows)
  }
  return rows
}
const statOf = (meta, input) => findStat(statsOf(meta), input, { tool: 'nba_list_stats' })
const headline = (meta) => ((meta.leaderboard && meta.leaderboard.common) || COMMON).filter((k) => meta.metrics.some((m) => m.key === k))

// A stat's cell for one player: [value, league percentile, position percentile], or null.
// The per-game line has a value and no percentiles.
function cellOf(row, m) {
  if (m.line) { const v = row.line ? row.line[m.line] : null; return miss(v) ? null : [v, null, null] }
  return row.m[m.key] || null
}

const perGame = (line) => (line
  ? { points: line.ppg ?? null, rebounds: line.rpg ?? null, assists: line.apg ?? null, turnovers: line.tpg ?? null, minutes: line.mpg ?? null }
  : null)
const one = (v) => (miss(v) ? '—' : (+v).toFixed(1))
const lineText = (l) => `${one(l.ppg)} points, ${one(l.rpg)} rebounds, ${one(l.apg)} assists a game`
const nth = (p) => (p == null ? 'n/a' : ordinal(p))

// ---- leaderboard -----------------------------------------------------------------------

// The page's Leaderboard Builder, as an answer: that season's QUALIFIED players who have the
// stat, best first (lowest first where lower is better), optionally only one position or one
// team. Its lbEligible() and lbRender(), with one difference: equal values share a place.
export async function leaderboard({ stat, season, position, team, limit = 10, order = 'top' }) {
  const meta = await loadMeta()
  const seasonId = parseSeason(season, meta) || meta.latestSeason
  const m = statOf(meta, stat)
  if (startYear(seasonId) < startYear(m.since)) {
    throw new SavantError(`${m.label} is tracked from ${m.since} on, so ${seasonId} has no leaderboard for it.`)
  }
  const file = await loadSeason(seasonId)
  const pos = position ? position[0].toUpperCase() + position.slice(1).toLowerCase() : null
  const code = resolveTeam(team, file)

  const cohort = file.players.filter((p) => p.qualified && (!pos || p.pos === pos) && (!code || p.team === code) && cellOf(p, m))
  const all = ranked(cohort, (p) => cellOf(p, m)[0], { lower: m.lowerIsBetter })
  const shown = boardSlice(all, limit, order)
  const low = (p) => (p.low || []).includes(m.key)
  const q = meta.qualify || {}
  const who = `qualified ${pos ? PEERS[pos] : 'players'}${code ? ` on ${teamName(code)} (${code})` : ''}`
  const qualifyText = q.min_mpg && q.min_gp ? ` (${q.min_mpg}+ minutes per game and ${q.min_gp}+ games)` : ''

  // The page's own leaderboard, opened on the same season, stat and filters.
  const url = m.line || order === 'bottom' || !meta.leaderboardUrl
    ? meta.page
    : meta.leaderboardUrl.replace('{season}', encodeURIComponent(seasonId)).replace('{stat}', m.key) + (pos ? `&pos=${pos}` : '') + (code ? `&tm=${code}` : '') + `&n=${limit}`

  const notes = [
    `Ranked among the ${all.length} ${who} in ${seasonId} who have a value for ${m.label}. Qualified means in Basketball Savant's percentile pools${qualifyText}; ${file.qualified.league} players qualified that season. A player below that line is not listed, whatever his number.`,
  ]
  if (m.lowerIsBetter) notes.push(`${m.label} is a lower-is-better stat, so the lowest value is 1st.`)
  if (order === 'bottom') notes.push(`This is the bottom of the board, worst first. Places are counted from the top: ${all.length ? ordinal(all[all.length - 1].rank) : 'last'} is last.`)
  if (shown.some((r) => r.tied)) notes.push('Equal values share a place.')
  if (m.line) notes.push(PER_GAME_WHAT)
  else if (DESCRIBES.has(m.key)) notes.push(`${m.label} describes role, style or build rather than quality: leading it means the most of it, not the best.`)
  if (/ 75\b/.test(m.label)) notes.push(PER_75)
  if (shown.some((r) => low(r.row))) notes.push('"low sample" means the stat sits below its stabilization threshold for that player: too few attempts to trust yet.')

  const structured = {
    stat: { key: m.key, label: m.label, what: m.explain || null, kind: m.layer || null, lower_is_better: m.lowerIsBetter },
    season: seasonId,
    order,
    filters: { position: pos, team: code },
    ranked: all.length,
    count: shown.length,
    leaders: shown.map((r) => {
      const p = r.row
      const c = cellOf(p, m)
      return {
        rank: r.rank,
        tied: r.tied,
        id: String(p.id),
        name: p.name,
        team: p.team,
        position: p.pos,
        value: c[0],
        display: display(m.unit, c[0], c[1]),
        league_percentile: c[1],
        position_percentile: c[2],
        games: p.gp ?? null,
        low_sample: low(p),
        url: cardUrl(p.id),
      }
    }),
    notes,
    url,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }

  const title = `${m.label}, ${seasonId}: ${order === 'bottom' ? 'the bottom' : 'the top'} ${shown.length} of ${all.length} ${who}`
  if (!shown.length) {
    const why = code && !file.players.some((p) => p.team === code && p.qualified && (!pos || p.pos === pos))
      ? `No ${pos ? PEERS[pos] : 'players'} on ${teamName(code)} qualified in ${seasonId}.`
      : `Nobody among the ${who} has a value for ${m.label} in ${seasonId}.`
    return { structured, text: `${why}\n\n${notes[0]}\n\nPage: ${url}\nSource: ${SOURCE}. Data as of ${structured.data_as_of}.` }
  }
  const L = [title]
  if (m.explain && !m.line) L.push(m.explain)
  L.push('')
  for (const r of structured.leaders) {
    const pcts = r.league_percentile == null ? '' : `, league ${nth(r.league_percentile)} percentile`
    L.push(`${r.tied ? 'T-' : ''}${r.rank}. ${r.name} (${r.team}, ${r.position}, id ${r.id}): ${r.display}${pcts}${r.games != null ? `, ${r.games} games` : ''}${r.low_sample ? ' [low sample]' : ''}`)
  }
  L.push('', ...notes, '', `On the site: ${url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- compare ---------------------------------------------------------------------------

// Which stats a comparison or a career shows: the ones asked for, one panel, or the page's
// own headline set (the columns its leaderboard opens with).
function pickStats(meta, { stats, group = 'headline', most }) {
  if (stats && stats.length) {
    if (stats.length > most) throw new SavantError(`Ask for at most ${most} stats at a time.`)
    const out = []
    for (const name of stats) { const m = statOf(meta, name); if (!out.includes(m)) out.push(m) }
    return out
  }
  const all = statsOf(meta)
  if (group === 'headline') return headline(meta).map((k) => all.find((m) => m.key === k))
  return all.filter((m) => m.group === GROUPS[group])
}

// One player-season, found the way a profile finds it.
async function playerSeason(meta, player, season) {
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted)
  const seasonId = wanted || who.to
  const file = await loadSeason(seasonId)
  const row = file.players.find((p) => String(p.id) === String(who.id))
  if (!row) throw new SavantError(`${who.name} has no stats in ${seasonId}. Basketball Savant has him from ${span(who)}.`)
  return { who, seasonId, file, row }
}

export async function comparePlayers({ players, seasons, group = 'headline', stats }) {
  const meta = await loadMeta()
  if (seasons && seasons.length > 1 && seasons.length !== players.length) {
    throw new SavantError(`Give one season for everyone, or one season per player in the same order: ${players.length} players, ${seasons.length} seasons.`)
  }
  const picked = pickStats(meta, { stats, group, most: 12 })
  const sides = []
  for (let i = 0; i < players.length; i++) {
    sides.push(await playerSeason(meta, players[i], seasons && seasons.length ? seasons[seasons.length === 1 ? 0 : i] : undefined))
  }
  const dup = sides.find((a, i) => sides.some((b, j) => j < i && b.row.id === a.row.id && b.seasonId === a.seasonId))
  if (dup) throw new SavantError(`${dup.row.name} in ${dup.seasonId} is listed twice. To compare one player with himself, give two different seasons.`)

  // A name for each side: the player, with his season when more than one season is in play.
  // Inside the table a shorter one: the surname, or the season alone when it is one man
  // against himself. A surname two of them share falls back to the full name.
  const several = new Set(sides.map((x) => x.seasonId)).size > 1
  const tag = (x) => `${x.row.name}${several ? ` ${x.seasonId}` : ''}`
  const oneMan = new Set(sides.map((x) => String(x.row.id))).size === 1
  const surname = (x) => x.row.name.split(' ').slice(1).join(' ') || x.row.name
  const clash = (x) => sides.some((y) => y.row.id !== x.row.id && surname(y) === surname(x))
  const short = (x) => (oneMan ? x.seasonId : `${clash(x) ? x.row.name : surname(x)}${several ? ` ${x.seasonId}` : ''}`)

  const rows = picked.map((m) => ({
    key: m.key,
    label: m.label,
    group: m.line ? 'Per game' : meta.groups[m.group] || m.group,
    kind: m.layer || null,
    lower_is_better: m.lowerIsBetter,
    what: m.explain || null,
    values: sides.map((x) => {
      if (startYear(x.seasonId) < startYear(m.since)) return { status: 'not tracked that season', value: null, display: null, league_percentile: null, position_percentile: null, league_rank: null, low_sample: false }
      const c = cellOf(x.row, m)
      if (!c) return { status: 'no value', value: null, display: null, league_percentile: null, position_percentile: null, league_rank: null, low_sample: false }
      const place = m.line ? null : placeOf(x.file, x.row, m)
      return { status: 'ok', value: c[0], display: display(m.unit, c[0], c[1]), league_percentile: c[1], position_percentile: c[2], league_rank: place ? place.rank : null, low_sample: (x.row.low || []).includes(m.key) }
    }),
  }))

  const notes = []
  const pools = [...new Set(sides.map((x) => x.seasonId))].map((sn) => `${sides.find((x) => x.seasonId === sn).file.qualified.league} qualified players in ${sn}`)
  notes.push(`Each stat shows the value, then two percentiles: against the league (${pools.join('; ')}) and against qualified players at his own position. Stats tagged "lower is better" are already flipped, so a higher percentile is the better mark there too.`)
  if (several) notes.push('Each percentile is inside that player\'s own season. Across seasons the league changes, so compare the raw values first: the same number can be a different percentile in a different year.')
  if (new Set(sides.map((x) => x.row.pos)).size > 1) notes.push('These players are at different positions, so their position percentiles are against different groups.')
  if (picked.some((m) => DESCRIBES.has(m.key))) notes.push(STYLE)
  const unqualified = sides.filter((x) => !x.row.qualified)
  if (unqualified.length) notes.push(`Below the qualifying line, so ranked against a pool he is not in: ${unqualified.map(tag).join(', ')}. Treat those percentiles with caution.`)
  if (rows.some((r) => / 75\b/.test(r.label))) notes.push(PER_75)

  const structured = {
    players: sides.map((x) => ({
      id: String(x.row.id),
      name: x.row.name,
      season: x.seasonId,
      team: x.row.team,
      position: x.row.pos,
      age: tidy(x.row.age),
      games: x.row.gp ?? null,
      minutes: x.row.min ?? null,
      qualified: x.row.qualified,
      per_game: perGame(x.row.line),
      url: cardUrl(x.row.id),
    })),
    stats: rows,
    notes,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }

  const L = [`${sides.map(tag).join(' vs. ')}: Basketball Savant, side by side`]
  for (const x of sides) {
    L.push(`${tag(x)} (${x.row.team}, ${x.row.pos}${several ? '' : `, ${x.seasonId}`}): ${x.row.gp ?? '?'} games${x.row.line ? `, ${lineText(x.row.line)}` : ''}.`)
  }
  L.push('')
  for (const r of rows) {
    const cells = r.values.map((v, i) => {
      const who = short(sides[i])
      if (v.status !== 'ok') return `${who} ${v.status}`
      const pct = v.league_percentile == null ? '' : ` (league ${nth(v.league_percentile)}, vs. ${PEERS[sides[i].row.pos]} ${nth(v.position_percentile)}${v.league_rank != null && v.league_rank <= 10 ? `; ${ordinal(v.league_rank)} in the league` : ''})`
      return `${who} ${v.display}${pct}${v.low_sample ? ' [low sample]' : ''}`
    })
    L.push(`- ${r.label}${r.lower_is_better ? ' [lower is better]' : ''}: ${cells.join(' | ')}`)
    if (r.what && !PER_GAME.some((g) => g.key === r.key)) L.push(`  ${r.what}`)
  }
  L.push('', ...notes, '', ...sides.map((x) => `${tag(x)}: ${cardUrl(x.row.id)}`), `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- career ----------------------------------------------------------------------------

// One player, season by season. A career is a file per season, so the files are read one
// after another, a few at a time, and not kept (see once() in api/_core.js).
export async function playerCareer({ player, stats, from, to }) {
  const meta = await loadMeta()
  const who = await resolvePlayer(player)
  const first = parseSeason(from, meta)
  const last = parseSeason(to, meta)
  if (first && last && startYear(first) > startYear(last)) throw new SavantError(`"from" (${first}) is after "to" (${last}).`)
  const picked = pickStats(meta, { stats, group: 'headline', most: 8 })

  // Oldest first: a career reads forwards.
  const span0 = meta.seasons.filter((sn) => inSpan(who, sn)).reverse()
  const wanted = span0.filter((sn) => (!first || startYear(sn) >= startYear(first)) && (!last || startYear(sn) <= startYear(last)))
  if (!wanted.length) throw new SavantError(`${who.name} has no seasons between ${first || span0[0]} and ${last || span0[span0.length - 1]}. Basketball Savant has him from ${span(who)}.`)

  const loaded = await mapLimit(wanted, 6, async (sn) => {
    const file = await files.once(`seasons/${sn}.json`)
    return { sn, file, row: file.players.find((p) => String(p.id) === String(who.id)) || null }
  })
  const have = loaded.filter((x) => x.row)
  if (!have.length) throw new SavantError(`${who.name} has no stats in those seasons. Basketball Savant has him from ${span(who)}.`)

  const seasons = have.map(({ sn, file, row }) => ({
    season: sn,
    team: row.team,
    position: row.pos,
    age: tidy(row.age),
    games: row.gp ?? null,
    minutes: row.min ?? null,
    qualified: row.qualified,
    qualified_players: file.qualified.league,
    per_game: perGame(row.line),
    stats: picked.map((m) => {
      if (startYear(sn) < startYear(m.since)) return { key: m.key, status: 'not tracked that season', value: null, display: null, league_percentile: null, position_percentile: null, low_sample: false }
      const c = cellOf(row, m)
      if (!c) return { key: m.key, status: 'no value', value: null, display: null, league_percentile: null, position_percentile: null, low_sample: false }
      return { key: m.key, status: 'ok', value: c[0], display: display(m.unit, c[0], c[1]), league_percentile: c[1], position_percentile: c[2], low_sample: (row.low || []).includes(m.key) }
    }),
  }))

  // His best season in each stat, among the seasons he qualified in: the earliest wins a tie.
  const bests = picked.map((m, i) => {
    let best = null
    for (const sn of seasons) {
      const v = sn.stats[i]
      if (!sn.qualified || v.status !== 'ok') continue
      if (!best || (m.lowerIsBetter ? v.value < best.value : v.value > best.value)) best = { season: sn.season, value: v.value, display: v.display, league_percentile: v.league_percentile }
    }
    return { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, best }
  })

  const notes = [
    'Each percentile is against the league\'s qualified players in that same season. The league changes from year to year, so the same number can be a different percentile in a different season: read the values to see how he changed, and the percentiles to see where he stood.',
  ]
  if (picked.some((m) => DESCRIBES.has(m.key))) notes.push(STYLE)
  const missed = loaded.filter((x) => !x.row).map((x) => x.sn)
  if (missed.length) notes.push(`No stats for him in ${missed.join(', ')}: he did not play, or the data has no line for him.`)
  const unq = seasons.filter((x) => !x.qualified).map((x) => x.season)
  if (unq.length) notes.push(`He was below the qualifying line in ${unq.join(', ')}, so those percentiles rank a small sample against qualified players and are left out of "best season".`)
  if (picked.some((m) => / 75\b/.test(m.label))) notes.push(PER_75)
  // A career that began before 1996-97 can sit under two ids. Nobody is merged on a name.
  const twin = (await loadPlayers()).filter((r) => r.n === who.n && String(r.id) !== String(who.id))
  if (twin.length) {
    notes.push(`Basketball Savant also lists ${twin.map((r) => `"${r.name}" under id ${r.id} (${span(r)})`).join(' and ')}. That may be another man with the same name, or the earlier part of this career: some careers that began before 1996-97 are split across two ids. If it is the same man, ask again with that id for those seasons.`)
  }

  const structured = {
    player: { id: String(who.id), name: who.name, first_season: who.from, last_season: who.to, url: cardUrl(who.id) },
    stats: picked.map((m) => ({ key: m.key, label: m.label, kind: m.layer || null, lower_is_better: m.lowerIsBetter, what: m.explain || null })),
    seasons,
    best_seasons: bests,
    notes,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }

  const L = [`${who.name}: ${seasons.length === 1 ? 'one season' : `${seasons.length} seasons`}, ${seasons[0].season}${seasons.length > 1 ? ` to ${seasons[seasons.length - 1].season}` : ''}`]
  L.push(`Each line: season, team, age, games, his per-game line, then ${picked.map((m) => m.label).join(', ')}. The number in brackets is the league percentile that season.`, '')
  for (const sn of seasons) {
    const head = `${sn.season} ${sn.team}${sn.age != null ? `, age ${sn.age}` : ''}${sn.games != null ? `, ${sn.games} g` : ''}${sn.qualified ? '' : ' (did not qualify)'}`
    const line = sn.per_game ? `${one(sn.per_game.points)} pts, ${one(sn.per_game.rebounds)} reb, ${one(sn.per_game.assists)} ast` : 'no per-game line'
    const cells = sn.stats.map((v, i) => `${picked[i].label} ${v.status === 'ok' ? `${v.display}${v.league_percentile == null ? '' : ` (${nth(v.league_percentile)})`}${v.low_sample ? '*' : ''}` : v.status === 'no value' ? 'no value' : 'not tracked'}`)
    L.push(`${head}: ${line} | ${cells.join(' · ')}`)
  }
  if (seasons.some((sn) => sn.stats.some((v) => v.low_sample))) { notes.push('A star (*) marks a stat below its stabilization threshold that season: too few attempts to trust yet.'); }
  const best = bests.filter((b) => b.best)
  if (best.length && seasons.length > 1) {
    L.push('', 'Best season in each (qualified seasons only):', ...best.map((b) => `- ${b.label}${b.lower_is_better ? ' [lower is better]' : ''}: ${b.best.display} in ${b.best.season}${b.best.league_percentile == null ? '' : ` (league ${nth(b.best.league_percentile)})`}`))
  }
  L.push('', ...notes, '', `Card: ${cardUrl(who.id)}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the glossary ----------------------------------------------------------------------

export async function listStats({ group, query } = {}) {
  const meta = await loadMeta()
  let rows = statsOf(meta)
  if (group) rows = rows.filter((m) => (group === 'per_game' ? m.line : m.group === GROUPS[group]))
  if (query) {
    const found = rank(rows, query, () => 0, (x) => x).map((r) => r.row)
    const q = norm(query)
    const inWhat = rows.filter((m) => !found.includes(m) && (m.key === q || norm(m.explain || '').includes(q)))
    rows = [...found, ...inWhat]
  }
  const groupLabel = (m) => (m.line ? 'Per-game line' : meta.groups[m.group] || m.group)
  const stats = rows.map((m) => ({
    key: m.key,
    label: m.label,
    group: groupLabel(m),
    subgroup: m.sub || null,
    kind: m.layer || null,
    lower_is_better: m.lowerIsBetter,
    since: m.since,
    low_sample_below: m.lowSampleBelow || null,
    what: m.explain || null,
  }))
  const notes = [
    PER_75,
    STYLE,
    'Any key or name here can be given to nba_get_leaderboard, nba_compare_players or nba_get_player_career.',
    `Stats are ranked among qualified players${meta.qualify && meta.qualify.min_mpg ? ` (${meta.qualify.min_mpg}+ minutes per game and ${meta.qualify.min_gp}+ games)` : ''}. "since" is the first season a stat exists; before it there is no number, not a zero.`,
  ]
  const structured = { count: stats.length, stats, notes, url: meta.page, source: SOURCE }
  if (!stats.length) return { structured, text: `No Basketball Savant stat matches "${query}". Call nba_list_stats with no query to see them all.` }
  const L = [`${stats.length} Basketball Savant stat${stats.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}:`]
  let heading = null
  for (const m of stats) {
    const h = m.subgroup && m.subgroup !== m.group ? `${m.group}: ${m.subgroup}` : m.group
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [m.kind, m.lower_is_better ? 'lower is better' : null, startYear(m.since) > startYear(meta.seasons[meta.seasons.length - 1]) ? `since ${m.since}` : null].filter(Boolean)
    L.push(`- ${m.label} (key "${m.key}")${tags.length ? ` [${tags.join('; ')}]` : ''}${m.what ? `: ${m.what}` : ''}`)
  }
  L.push('', ...notes, '', `Page: ${meta.page}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const comp = z.object({ id: z.string(), name: z.string(), team: z.string(), match: z.number() })
const statShape = z.object({ key: z.string(), label: z.string(), what: z.string().nullable().describe('What the stat is, in the page\'s words.'), kind: z.string().nullable(), lower_is_better: z.boolean() })
const lineShape = z.object({ points: z.number().nullable(), rebounds: z.number().nullable(), assists: z.number().nullable(), turnovers: z.number().nullable(), minutes: z.number().nullable() }).nullable().describe('Per-game line.')

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'nba_search_players',
    config: {
      title: 'Search NBA players',
      description:
        'Find NBA players in Basketball Savant (Western Conference Elitists, wcehoops.com) by name. Covers every player with stats from 1979-80 through the latest season. Returns each match with its id, position, most recent team, and first and last season, plus the link to his card. Matching ignores accents and punctuation and tolerates small typos. Some players whose careers began before 1996-97 appear under two ids, one for each part of the career.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Player name or part of one, e.g. "Jokic", "LeBron James", "Gilgeous".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many players matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        players: z.array(z.object({
          id: z.string().describe('Player id, for nba_get_player_profile.'),
          name: z.string(),
          position: z.string().describe('Guard, Wing or Big, in his most recent season.'),
          team: z.string().describe('Team in his most recent season.'),
          first_season: z.string(),
          last_season: z.string(),
          seasons: z.number().int().describe('Number of seasons with stats.'),
          url: z.string().describe('His Basketball Savant card.'),
        })),
      },
      annotations: { title: 'Search NBA players', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchPlayers({ query, limit }),
  },
  {
    name: 'nba_get_player_profile',
    config: {
      title: 'Get an NBA player\'s Savant profile',
      description:
        'Get one NBA player\'s Basketball Savant profile (Western Conference Elitists, wcehoops.com) for one season: his per-game line and every tracked stat with its value and two percentiles, one against all qualified players that season ("league") and one against qualified players at his position ("vs. guards", "vs. wings" or "vs. bigs"). Covers shooting, creation and playmaking, rebounding, defense, physical measurements and overall-value stats such as BPM. Defaults to his most recent season. For the latest season it can instead return his last 10, 25 or 75 games, and it adds his statistical comps, weakness comps and who he guards. Seasons from 1979-80 on; stats a season did not track are listed as not tracked. Includes the link to his card.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nba_search_players (e.g. "203999") or a full name (e.g. "Nikola Jokic"). If a name fits more than one player, the error lists their ids.'),
        season: z.string().trim().max(12).optional().describe('Season written as two years, e.g. "2025-26". Omit for his most recent season.'),
        window: z.enum(['season', 'l10', 'l25', 'l75']).default('season').describe('"season" for the full season (default). "l10", "l25" or "l75" for his last 10, 25 or 75 games, latest season only.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which stats to return: "all" (default), or one panel with each stat explained: "context" (minutes, availability), "offense" (with Offensive BPM), "defense" (with Defensive BPM) or "value" (BPM, win shares, VORP and similar).'),
      },
      outputSchema: {
        player: z.object({
          id: z.string(),
          name: z.string(),
          team: z.string(),
          position: z.string().describe('Guard, Wing or Big that season.'),
          age: z.number().nullable(),
          experience: z.number().nullable().describe('Years of NBA experience.'),
          qualified: z.boolean().describe('Whether he is in the percentile pools that season.'),
          games: z.number().nullable(),
          minutes: z.number().nullable(),
        }),
        season: z.string(),
        window: z.string().describe('season, l10, l25 or l75.'),
        per_game: z.object({
          points: z.number().nullable(),
          rebounds: z.number().nullable(),
          assists: z.number().nullable(),
          turnovers: z.number().nullable(),
          minutes: z.number().nullable(),
        }).nullable().describe('Full-season per-game line.'),
        pools: z.object({
          league: z.number().nullable().describe('Qualified players that season.'),
          position: z.number().nullable().describe('Qualified players at his position that season.'),
          position_label: z.string().describe('guards, wings or bigs.'),
        }),
        stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          subgroup: z.string().nullable(),
          kind: z.string().nullable().describe('The page\'s tag for the kind of number: output, ingredient, context or expected.'),
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          league_percentile: pct.describe('Against all qualified players that season. Higher is better.'),
          position_percentile: pct.describe('Against qualified players at his position. Higher is better.'),
          league_rank: z.number().int().nullable().describe('His place among qualified players with the stat (1 is best; equal values share a place). Null if he did not qualify, or for a last-N-games view.'),
          league_rank_of: z.number().int().nullable().describe('How many qualified players have the stat.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentiles are already flipped.'),
          low_sample: z.boolean().describe('True when the stat is below its stabilization threshold.'),
          what: z.string().nullable().describe('What the stat is, in the page\'s words.'),
        })),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string(), since: z.string() })).describe('Stats that season did not track.'),
        no_value: z.array(z.object({ key: z.string(), label: z.string() })).describe('Stats the season tracks but has no number for him. A gap, not a zero.'),
        notes: z.array(z.string()).describe('How to read the numbers: what the pools are, and any caution that applies to this player.'),
        comps: z.array(comp).optional().describe('Closest statistical profiles, among players with 500+ minutes.'),
        weakest: z.array(z.object({ key: z.string(), label: z.string(), percentile: z.number() })).optional().describe('Where he ranks worst among players at his position with 500+ minutes.'),
        weakness_comps: z.array(comp).optional().describe('Players who share his flaws.'),
        defensive_matchups: z.object({ guards: z.number(), wings: z.number(), bigs: z.number(), possessions: z.number().nullable() }).optional().describe('Share of his defensive matchups by position guarded, in percent.'),
        defensive_role: z.object({
          perimeter_assignment_rate: z.number().nullable(),
          rim_contest_rate: z.number().nullable(),
          rim_fg_allowed_vs_expected: z.number().nullable(),
          possessions: z.number().nullable(),
          shots_defended: z.number().nullable(),
        }).optional().describe('Bigs only. Reflects role, not ability.'),
        url: z.string().describe('His Basketball Savant card.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA player\'s Savant profile', ...READ_ONLY },
    },
    run: ({ player, season, window, group }) => playerProfile({ player, season, window, group }),
  },
  {
    name: 'nba_get_leaderboard',
    config: {
      title: 'Get an NBA leaderboard',
      description:
        'Rank NBA players by one stat in one season, by Basketball Savant\'s Leaderboard Builder rules (wcehoops.com). Use for "who led the league", "top ten" and "best on the team" questions instead of looking players up one by one. Lists qualified players only (15+ minutes a game, 20+ games) with place, value and league percentile; ties share a place. Takes any stat from nba_list_stats, or the per-game line (ppg, rpg, apg). Optional position and team filters. Seasons from 1979-80.',
      inputSchema: {
        stat: z.string().trim().min(1).max(60).describe('Key or name from nba_list_stats, e.g. "ts", "true shooting", "bpm", "dbpm", "blk"; or "ppg", "rpg", "apg".'),
        season: z.string().trim().max(12).optional().describe('Season written as two years, e.g. "2025-26". Omit for the latest season.'),
        position: z.enum(['guard', 'wing', 'big']).optional().describe('Only this position group.'),
        team: z.string().trim().max(40).optional().describe('Only this team, by code or name, e.g. "SAS", "Spurs".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Rows to list (default 10).'),
        order: z.enum(['top', 'bottom']).default('top').describe('Best first (default) or worst first.'),
      },
      outputSchema: {
        stat: statShape,
        season: z.string(),
        order: z.string(),
        filters: z.object({ position: z.string().nullable(), team: z.string().nullable() }),
        ranked: z.number().int().describe('How many qualified players the board ranks, after the filters.'),
        count: z.number().int(),
        leaders: z.array(z.object({
          rank: z.number().int().describe('Place on the board, counted from the top. Equal values share a place.'),
          tied: z.boolean(),
          id: z.string(),
          name: z.string(),
          team: z.string(),
          position: z.string(),
          value: z.number(),
          display: z.string().describe('The value as the site prints it.'),
          league_percentile: pct.describe('Against all qualified players that season. Null for the per-game line.'),
          position_percentile: pct,
          games: z.number().nullable(),
          low_sample: z.boolean(),
          url: z.string(),
        })),
        notes: z.array(z.string()).describe('Who is ranked, and how to read the board.'),
        url: z.string().describe('The same leaderboard on the site.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA leaderboard', ...READ_ONLY },
    },
    run: (args) => leaderboard(args),
  },
  {
    name: 'nba_compare_players',
    config: {
      title: 'Compare NBA players side by side',
      description:
        'Put two to four NBA player-seasons side by side on the same Basketball Savant stats (wcehoops.com): each stat\'s value with league and position percentile, and what the stat means. Use for "who was better", or name one player twice with two seasons to compare him with himself. Defaults to each player\'s latest season and the page\'s headline stats.',
      inputSchema: {
        players: z.array(z.string().trim().min(1).max(80)).min(2).max(4).describe('Two to four names or ids. Repeat a player to compare two of his seasons.'),
        seasons: z.array(z.string().trim().max(12)).min(1).max(4).optional().describe('One season for everyone, e.g. ["2025-26"], or one per player in order. Omit for each player\'s latest.'),
        group: z.enum(['headline', ...Object.keys(GROUPS)]).default('headline').describe('"headline" (default) or one panel.'),
        stats: z.array(z.string().trim().min(1).max(60)).max(12).optional().describe('Instead of a group: up to 12 stat keys or names.'),
      },
      outputSchema: {
        players: z.array(z.object({
          id: z.string(), name: z.string(), season: z.string(), team: z.string(), position: z.string(), age: z.number().nullable(),
          games: z.number().nullable(), minutes: z.number().nullable(), qualified: z.boolean(), per_game: lineShape, url: z.string(),
        })),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), kind: z.string().nullable(), lower_is_better: z.boolean(), what: z.string().nullable(),
          values: z.array(z.object({
            status: z.string().describe('"ok", "no value" (a gap, not a zero) or "not tracked that season".'),
            value: z.number().nullable(), display: z.string().nullable(), league_percentile: pct, position_percentile: pct,
            league_rank: z.number().int().nullable().describe('His place among qualified players that season.'), low_sample: z.boolean(),
          })).describe('One per player, in the order of players.'),
        })),
        notes: z.array(z.string()),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Compare NBA players side by side', ...READ_ONLY },
    },
    run: (args) => comparePlayers(args),
  },
  {
    name: 'nba_get_player_career',
    config: {
      title: 'Get an NBA player\'s career, season by season',
      description:
        'One NBA player season by season from Basketball Savant (wcehoops.com): team, age, games and per-game line each year, up to 8 chosen stats with value and league percentile, and his best season in each. Use for "how has he changed", "when did he peak", "has he fallen off". Defaults to his whole career and the page\'s headline stats.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id or full name.'),
        stats: z.array(z.string().trim().min(1).max(60)).max(8).optional().describe('Up to 8 stat keys or names, e.g. ["tp3", "ts"]. Omit for the headline stats.'),
        from: z.string().trim().max(12).optional().describe('First season to include, e.g. "2015-16".'),
        to: z.string().trim().max(12).optional().describe('Last season to include.'),
      },
      outputSchema: {
        player: z.object({ id: z.string(), name: z.string(), first_season: z.string(), last_season: z.string(), url: z.string() }),
        stats: z.array(z.object({ key: z.string(), label: z.string(), kind: z.string().nullable(), lower_is_better: z.boolean(), what: z.string().nullable() })),
        seasons: z.array(z.object({
          season: z.string(), team: z.string(), position: z.string(), age: z.number().nullable(), games: z.number().nullable(), minutes: z.number().nullable(),
          qualified: z.boolean(), qualified_players: z.number().int().describe('The size of the league pool that season.'), per_game: lineShape,
          stats: z.array(z.object({
            key: z.string(), status: z.string().describe('"ok", "no value" or "not tracked that season".'), value: z.number().nullable(), display: z.string().nullable(),
            league_percentile: pct, position_percentile: pct, low_sample: z.boolean(),
          })).describe('In the order of stats.'),
        })).describe('Oldest first.'),
        best_seasons: z.array(z.object({
          key: z.string(), label: z.string(), lower_is_better: z.boolean(),
          best: z.object({ season: z.string(), value: z.number(), display: z.string(), league_percentile: pct }).nullable(),
        })).describe('His best qualified season in each stat.'),
        notes: z.array(z.string()),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA player\'s career, season by season', ...READ_ONLY },
    },
    run: (args) => playerCareer(args),
  },
  {
    name: 'nba_list_stats',
    config: {
      title: 'List Basketball Savant\'s stats',
      description:
        'Basketball Savant\'s glossary (wcehoops.com): every stat\'s key, name, meaning in the page\'s words, panel, first season, and whether lower is better. Use to explain a stat ("what is points per 75") or to find the key for nba_get_leaderboard, nba_compare_players or nba_get_player_career.',
      inputSchema: {
        group: z.enum([...Object.keys(GROUPS), 'per_game']).optional().describe('Only one panel, or "per_game" for the per-game line.'),
        query: z.string().trim().min(2).max(60).optional().describe('Only stats whose name or meaning matches, e.g. "rebound".'),
      },
      outputSchema: {
        count: z.number().int(),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), subgroup: z.string().nullable(), kind: z.string().nullable(),
          lower_is_better: z.boolean(), since: z.string().describe('The first season the stat exists.'), low_sample_below: z.number().nullable(),
          what: z.string().nullable().describe('What the stat is, in the page\'s words.'),
        })),
        notes: z.array(z.string()),
        url: z.string(),
        source: z.string(),
      },
      annotations: { title: 'List Basketball Savant\'s stats', ...READ_ONLY },
    },
    run: (args) => listStats(args),
  },
]
