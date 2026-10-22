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
//   - when the season did not track a stat at all, rather than showing a zero
//   - where the card is: basketball-savant.html?p=<id>
//
// ONE DELIBERATE DIFFERENCE FROM THE PAGE: signed stats print without a percent sign. The
// page's signed format appends "%" to all of them, which is right for the two FG% diffs and
// wrong for Box Plus/Minus ("+14.2%"). A sign and a number is true for every one of them.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, ordinal, prepare, rank, signed, thousands, tidy, topTier } from './_core.js'

const files = makeLoader('savant-api/basketball/v1', { what: 'Basketball Savant' })

export const GROUPS = { context: 'ctx', offense: 'off', defense: 'def', value: 'val' }
const GROUP_ORDER = ['ctx', 'off', 'def', 'val']
const PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }
const WINDOW_TEXT = { season: 'full season', l10: 'last 10 games', l25: 'last 25 games', l75: 'last 75 games' }

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
const feetInches = (n) => { const t = Math.round(n), f = Math.floor(t / 12); return `${f}'${t - f * 12}"` }

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
  // Season in progress, full season only: where a small-sample number is likely to settle.
  const settle = (window === 'season' && row.settle) || {}
  const stats = []
  const notTracked = []
  for (const m of meta.metrics) {
    if (groupKey && m.group !== groupKey) continue
    if (startYear(seasonId) < startYear(m.since)) { notTracked.push({ key: m.key, label: m.label, since: m.since }); continue }
    const cell = src.m[m.key]
    if (!cell) continue
    stats.push({
      key: m.key,
      label: m.label,
      group: meta.groups[m.group] || m.group,
      subgroup: m.sub || null,
      value: cell[0],
      display: display(m.unit, cell[0], cell[1]),
      league_percentile: cell[1],
      position_percentile: cell[2],
      lower_is_better: m.lowerIsBetter,
      low_sample: low.has(m.key),
      ...(settle[m.key] ? { likely_to_settle: { value: settle[m.key][0], display: display(m.unit, settle[m.key][0], settle[m.key][1]), league_percentile: settle[m.key][1], position_percentile: settle[m.key][2] } } : {}),
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
    notes: [],
    url: cardUrl(row.id),
    data_as_of: day(meta.generated),
    source: 'Basketball Savant, Western Conference Elitists (wcehoops.com)',
  }

  // Savant value and the All-Savant Team (full season only; savant-value.js on the page).
  const sv = window === 'season' && row.sv && meta.savant_value ? savantValueOf(row, file, meta) : null
  if (sv) structured.savant_value = sv

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
  notes.push(`Each stat shows two percentiles. "league" is against all ${pool.league ?? ''} qualified players in ${seasonId}; "vs. ${peers}" is against the ${pool[row.pos] ?? ''} qualified ${peers}.${window === 'season' ? '' : ` Both compare his ${WINDOW_TEXT[window]} with everyone else's.`} A higher percentile is always the better mark: stats tagged "lower is better" are already flipped.`)
  if (file.in_progress) {
    notes.push(`${seasonId} is still being played${file.through ? ` (data through ${file.through})` : ''}. Early-season rates rest on small samples and move a lot; the "low sample" tags mark the ones not to lean on yet.`)
    if ((pool.league ?? 0) < 30) {
      notes.push(`Only ${pool.league ?? 0} players have played enough to qualify so far, too few for percentiles to mean anything. For a percentile view, ask for the previous season.`)
    }
  }
  if (!row.qualified) {
    const q = file.qualify || meta.qualify || {}
    notes.push(`He did not qualify for those pools${q.min_mpg && q.min_gp ? ` (${q.min_mpg}+ minutes per game and ${q.min_gp}+ games${file.qualify ? ', pro-rated to the games played so far' : ''})` : ''}, so his percentiles rank a small sample against qualified players. Treat them with caution.`)
  }
  L.push(...notes)

  let heading = null
  for (const key of GROUP_ORDER) {
    for (const s of stats.filter((x) => x.group === (meta.groups[key] || key))) {
      const h = s.subgroup && s.subgroup !== s.group ? `${s.group}: ${s.subgroup}` : s.group
      if (h !== heading) { L.push('', h); heading = h }
      const pct = (p) => (p == null ? 'n/a' : ordinal(p))
      const tags = [s.lower_is_better ? 'lower is better' : null, s.low_sample ? 'low sample' : null].filter(Boolean)
      const st = s.likely_to_settle
      const toward = st ? `; likely to settle near ${st.display} (league ${pct(st.league_percentile)}, vs. ${peers} ${pct(st.position_percentile)})` : ''
      L.push(`- ${s.label}: ${s.display} (league ${pct(s.league_percentile)}, vs. ${peers} ${pct(s.position_percentile)})${toward}${tags.length ? ` [${tags.join(', ')}]` : ''}`)
    }
  }
  if (!stats.length) L.push('', 'No stats in this group for that season.')
  if (stats.some((s) => s.low_sample)) {
    notes.push('"low sample" means the stat sits below its stabilization threshold: too few attempts to trust yet.')
    L.push('', notes[notes.length - 1])
  }
  if (stats.some((s) => s.likely_to_settle)) {
    notes.push('"likely to settle near" is where a number on a small sample is headed: his number so far blended with his position\'s average, moved toward his own last season, weighted by how much sample the stat needs (measured on 16 seasons). Quote his actual number as what he has done, and this as the better guess at what it will be.')
    L.push('', notes[notes.length - 1])
  }
  if (notTracked.length) L.push('', `Not tracked in ${seasonId}: ${notTracked.map((m) => `${m.label} (since ${m.since})`).join(', ')}.`)
  if (sv) L.push('', savantValueText(row, sv, seasonId, peers))
  // The league's honours that season, as the card's chips show them (accolades())
  if (row.aw && row.aw.length && meta.awards) {
    const word = (c) => (meta.awards.labels || {})[c] || (meta.awards.short || {})[c] || c
    structured.league_honours = row.aw.map((c) => ({ code: c, award: word(c) }))
    L.push('', `League honours, ${seasonId}: ${structured.league_honours.map((h) => h.award).join(', ')}.`)
  }

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

// ---- Savant value and the All-Savant Team -----------------------------------------------

const ONE = { Guard: 'guard', Wing: 'wing', Big: 'big' }
const TEAM_WORD = ['1st', '2nd']
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v)
const sgnInt = (v) => sgn(Math.round(v)).replace(/\d+/, (d) => (+d).toLocaleString('en-US'))
const sgn1 = (v) => (v >= 0.05 ? '+' : v <= -0.05 ? '\u2212' : '') + Math.abs(v).toFixed(1)

function savantValueOf(row, file, meta) {
  const [value, rate, rank, parts] = row.sv
  const keys = meta.savant_value.parts
  const onTeam = (file.all_savant || []).findIndex((t) => t.some((id) => String(id) === String(row.id)))
  return {
    points_over_replacement: value,
    per_100_vs_average: rate,
    position_rank: rank,
    qualified_at_position: (file.value_count || {})[row.pos] ?? null,
    parts_per_100: Object.fromEntries(keys.map((k, i) => [k.key, parts[i]])),
    all_savant_team: onTeam >= 0 ? TEAM_WORD[onTeam] : null,
    // An honour once the season is over (the page's rule: a full 82 played); a standing before.
    all_savant_final: !(file.in_progress && seasonGames(file) < 82),
  }
}

function savantValueText(row, sv, season, peers) {
  const one = ONE[row.pos] || 'player'
  const parts = Object.entries(sv.parts_per_100).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${PART_LABEL[k] || k} ${sgn1(v)}`)
  return `Savant value: ${sgnInt(sv.points_over_replacement)} points over a replacement ${one} in ${season} `
    + `(${sgn1(sv.per_100_vs_average)} per 100 possessions vs. an average ${one})`
    + (sv.position_rank ? `, ${ordinal(sv.position_rank)} of ${sv.qualified_at_position} qualified ${peers}` : ', not qualified')
    + (sv.all_savant_team
      ? (sv.all_savant_final ? `. All-Savant ${sv.all_savant_team} Team.` : `. On the All-Savant ${sv.all_savant_team} Team so far; it becomes an honour when the season ends.`)
      : '.')
    + ` By part, per 100: ${parts.join(', ')}. It counts only the possessions he played, so missed games cost him.`
}
const PART_LABEL = { scoring: 'scoring', playmaking: 'playmaking', rebounding: 'rebounding', defense: 'defense', floor: 'on-floor impact' }

// The season the team is shown for when none is asked: the newest with two full teams, the
// season in progress included from the night it can name them (the page's rule).
function seasonGames(file) {
  const most = {}
  for (const p of file.players) if (p.team && (p.gp || 0) > (most[p.team] || 0)) most[p.team] = p.gp
  const g = Object.values(most).sort((a, b) => a - b)
  return g.length ? g[Math.floor(g.length / 2)] : 0
}

export async function allSavantTeam({ season, team = 'both' }) {
  const meta = await loadMeta()
  if (!meta.savant_value) throw new SavantError('The All-Savant Team is not in this build of Basketball Savant yet.')
  let seasonId = parseSeason(season, meta)
  let file
  const notes = []
  const full = (f) => Array.isArray(f.all_savant) && f.all_savant.length === 2 && f.all_savant.every((t) => t.length === 5)
  if (!seasonId) {
    // The page's rule: the newest season with two full teams, the one in progress included.
    for (const s of meta.seasons) {
      const f = await loadSeason(s)
      if (!full(f)) continue
      seasonId = s
      file = f
      break
    }
    if (!seasonId) throw new SavantError('No season has a full All-Savant Team yet.')
  } else file = await loadSeason(seasonId)
  if (!file.all_savant) throw new SavantError(`No All-Savant Team for ${seasonId}.`)
  const byId = new Map(file.players.map((p) => [String(p.id), p]))
  const want = team === '1' ? [0] : team === '2' ? [1] : [0, 1]
  const teams = want.map((t) => ({
    team: TEAM_WORD[t],
    players: (file.all_savant[t] || []).map((id) => {
      const p = byId.get(String(id))
      return {
        id: String(id), name: p.name, team: p.team, position: p.pos, games: p.gp ?? null,
        points_over_replacement: p.sv[0], per_100_vs_average: p.sv[1],
        url: cardUrl(id),
      }
    }),
  }))
  if (file.in_progress) notes.push(`${seasonId} is still being played${file.through ? ` (data through ${file.through})` : ''}. The value is a season total, so the team moves as games pile up.`)
  notes.push('Two guards, two wings and a big per team: the highest Savant value at each spot among qualified players; a player makes one team only. Positions are Basketball Savant\'s (Guard, Wing, Big), so this is not the league\'s positionless All-NBA ballot.')
  const structured = {
    season: seasonId,
    in_progress: !!file.in_progress,
    teams,
    method: meta.savant_value.what,
    notes,
    url: `${SITE}/basketball-savant.html`,
    data_as_of: day(meta.generated),
    source: 'Basketball Savant, Western Conference Elitists (wcehoops.com)',
  }
  const L = [`The All-Savant Team, ${seasonId}${file.in_progress && file.through ? ` (through ${file.through})` : ''}`]
  for (const t of teams) {
    L.push('', `${t.team} team:`)
    for (const x of t.players) {
      L.push(`- ${x.position}: ${x.name} (${x.team}${x.games ? `, ${x.games} games` : ''}), ${sgnInt(x.points_over_replacement)} points over a replacement ${ONE[x.position]} (${sgn1(x.per_100_vs_average)} per 100 vs. an average ${ONE[x.position]}). ${x.url}`)
    }
  }
  L.push('', meta.savant_value.what, ...notes, '', `Page: ${structured.url}`, `Source: ${structured.source}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const comp = z.object({ id: z.string(), name: z.string(), team: z.string(), match: z.number() })

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
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which stats to return: "all" (default), "context" (minutes, availability), "offense", "defense" or "value" (BPM, win shares, VORP and similar).'),
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
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          league_percentile: pct.describe('Against all qualified players that season. Higher is better.'),
          position_percentile: pct.describe('Against qualified players at his position. Higher is better.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentiles are already flipped.'),
          low_sample: z.boolean().describe('True when the stat is below its stabilization threshold.'),
          likely_to_settle: z.object({
            value: z.number(),
            display: z.string(),
            league_percentile: pct,
            position_percentile: pct,
          }).optional().describe('Season in progress only, while his sample is smaller than the stat needs: where the number is likely to settle, and its percentiles among everyone\'s same estimate.'),
        })),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string(), since: z.string() })).describe('Stats that season did not track.'),
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
        league_honours: z.array(z.object({ code: z.string(), award: z.string() })).optional().describe('The league\'s honours that season: MVP, All-NBA, All-Defensive, All-Star, All-Rookie, Champion and the rest.'),
        savant_value: z.object({
          points_over_replacement: z.number().describe('Points he added that season above a replacement-level player at his position.'),
          per_100_vs_average: z.number().describe('Points per 100 possessions vs. an average player at his position.'),
          position_rank: z.number().int().nullable().describe('Rank by value among qualified players at his position; null if not qualified.'),
          qualified_at_position: z.number().int().nullable(),
          parts_per_100: z.record(z.string(), z.number()).describe('Scoring, playmaking, rebounding, defense, on-floor impact, per 100 vs. an average player at his position.'),
          all_savant_team: z.string().nullable().describe('"1st" or "2nd" when he is on the All-Savant Team that season.'),
          all_savant_final: z.boolean().describe('True once the season is over, when the All-Savant Team is an honour; false while it is a standing.'),
        }).optional().describe('Full season only: Savant value, the number the All-Savant Team is picked on.'),
        url: z.string().describe('His Basketball Savant card.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA player\'s Savant profile', ...READ_ONLY },
    },
    run: ({ player, season, window, group }) => playerProfile({ player, season, window, group }),
  },
  {
    name: 'nba_all_savant_team',
    config: {
      title: 'Get the All-Savant Team',
      description:
        'Get Basketball Savant\'s All-Savant Team (Western Conference Elitists, wcehoops.com) for one season: an All-NBA 1st and 2nd team picked by the numbers alone, two guards, two wings and a big each. Every pick is the highest Savant value at his spot among qualified players: the points he added that season above a replacement-level player at his position, built from his own box stats and luck-adjusted on/off, counting only the possessions he played. Returns each player with his value, team, games and card link. Seasons from 1979-80 on; defaults to the newest season, or the last full one while a new season is in its first 10 games.',
      inputSchema: {
        season: z.string().trim().max(12).optional().describe('Season written as two years, e.g. "2025-26". Omit for the current team.'),
        team: z.enum(['1', '2', 'both']).default('both').describe('"1" for the 1st team, "2" for the 2nd, "both" (default).'),
      },
      outputSchema: {
        season: z.string(),
        in_progress: z.boolean().describe('True while that season is still being played.'),
        teams: z.array(z.object({
          team: z.string().describe('"1st" or "2nd".'),
          players: z.array(z.object({
            id: z.string(),
            name: z.string(),
            team: z.string(),
            position: z.string().describe('Guard, Wing or Big.'),
            games: z.number().nullable(),
            points_over_replacement: z.number(),
            per_100_vs_average: z.number(),
            url: z.string(),
          })),
        })),
        method: z.string(),
        notes: z.array(z.string()),
        url: z.string(),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get the All-Savant Team', ...READ_ONLY },
    },
    run: ({ season, team }) => allSavantTeam({ season, team }),
  },
]

// For the other basketball sections (api/_basketball-lists.js): the same files, loader,
// cache and way of finding a player and a season.
export { files, loadMeta, loadSeason, loadPlayers, resolvePlayer, parseSeason, PEERS, WINDOW_TEXT, startYear, inSpan, recent }
