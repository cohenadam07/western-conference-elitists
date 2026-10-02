// api/_savant.js — Basketball Savant, as answers. The half of the AI connector (api/mcp.js)
// that knows basketball; the other half only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/basketball/v1/ (see
// scripts/lib/savant-api.mjs): a glossary, a player index, and one file per season in which
// every stat already carries its league and position percentile. Nothing is computed here
// that the page computes — percentiles are read, never re-derived — so an answer from this
// file is the number on the player's card.
//
// The files come off the live site's CDN rather than out of the function bundle. That keeps
// the function small and means a nightly data push reaches the connector with no redeploy
// of its own. Parsed files are held in memory for ten minutes per warm instance; if a
// refresh fails, the last good copy is served rather than an error.
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

const ORIGIN = () => (process.env.SAVANT_API_ORIGIN || 'https://wcehoops.com').replace(/\/+$/, '')
const BASE = 'savant-api/basketball/v1'
const SCHEMA = 1
const TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const MAX_CACHED = 16 // meta + players + a dozen seasons; the latest season is ~2 MB parsed

export const GROUPS = { context: 'ctx', offense: 'off', defense: 'def', value: 'val' }
const GROUP_ORDER = ['ctx', 'off', 'def', 'val']
const PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }
const WINDOW_TEXT = { season: 'full season', l10: 'last 10 games', l25: 'last 25 games', l75: 'last 75 games' }

// An error whose message is meant for the person (or model) on the other end: it says what
// went wrong and what to try. Anything else that throws is a bug and is reported blandly.
export class SavantError extends Error {}

// ---- loading -------------------------------------------------------------------------

const cache = new Map() // path -> { at, value } | { at, pending }

async function fetchJson(path) {
  const res = await fetch(`${ORIGIN()}/${BASE}/${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  // A missing file falls through to the site's catch-all and comes back as HTML with a 200,
  // so "it parsed as JSON and carries our schema" is the only real success signal.
  const body = JSON.parse(await res.text())
  if (!body || body.schema !== SCHEMA) throw new Error(`${path}: unexpected schema`)
  return body
}

async function load(path) {
  const now = Date.now()
  const hit = cache.get(path)
  if (hit && hit.pending) return hit.pending
  if (hit && now - hit.at < TTL_MS) return hit.value

  const pending = fetchJson(path).then(
    (value) => {
      cache.set(path, { at: Date.now(), value })
      if (cache.size > MAX_CACHED) {
        const oldest = [...cache.entries()].filter(([, v]) => !v.pending).sort((a, b) => a[1].at - b[1].at)[0]
        if (oldest && oldest[0] !== path) cache.delete(oldest[0])
      }
      return value
    },
    (err) => {
      console.error('[savant] load failed:', err.message)
      if (hit && hit.value) {
        // Stale beats down. Hold it for a minute so an outage is not re-tried on every call.
        cache.set(path, { at: Date.now() - TTL_MS + 60 * 1000, value: hit.value })
        return hit.value
      }
      cache.delete(path)
      throw new SavantError('Basketball Savant data could not be loaded right now. Try again in a minute.')
    },
  )
  cache.set(path, { at: hit ? hit.at : now, value: hit && hit.value, pending })
  return pending
}

export function clearCache() { cache.clear() }

const loadMeta = () => load('meta.json')
const loadSeason = (season) => load(`seasons/${season}.json`)

// The player index, with each name prepared for matching once per load.
const prepared = new WeakMap()
async function loadPlayers() {
  const file = await load('players.json')
  let rows = prepared.get(file)
  if (!rows) {
    rows = file.players.map((p) => { const n = norm(p.name); return { ...p, n, tokens: n.split(' ') } })
    prepared.set(file, rows)
  }
  return rows
}

// ---- names ---------------------------------------------------------------------------

// "Day'Ron Sharpe" -> "dayron sharpe", "P.J. Washington" -> "pj washington",
// "Karl-Anthony Towns" -> "karl anthony towns", "Nikola Jokić" -> "nikola jokic"
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

// "jaren jackson jr" -> "jaren jackson"; a name with no suffix is returned as it is.
const SUFFIX = /\s(jr|sr|ii|iii|iv|v)$/
const base = (n) => n.replace(SUFFIX, '')

// How well a prepared name answers a query. 0 means not at all.
function matchScore(q, qTokens, row) {
  if (row.n === q) return 100
  // "Jaren Jackson" is also a fair way to ask for Jaren Jackson Jr. Scored just under an
  // exact match so that both men come back and the caller chooses, rather than the father
  // winning on spelling alone.
  if (!SUFFIX.test(q) && base(row.n) === q) return 95
  if (qTokens.every((t) => row.tokens.includes(t))) return 75
  if (qTokens.every((t) => row.tokens.some((n) => n.startsWith(t)))) return 60
  if (row.n.includes(q)) return 50
  // Typos: every word of the query is within a letter or two of a word in the name.
  const close = qTokens.every((t) => {
    const max = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0
    return row.tokens.some((n) => (max ? editDistance(t, n, max) <= max : n === t))
  })
  return close ? 30 : 0
}

const startYear = (season) => +String(season).slice(0, 4)

function rank(rows, query) {
  const q = norm(query)
  const qTokens = q.split(' ').filter(Boolean)
  if (!qTokens.length) return []
  const out = []
  for (const row of rows) {
    const score = matchScore(q, qTokens, row)
    if (score) out.push({ row, score })
  }
  // Best match first; among equals, the more recent and then the longer career.
  out.sort((a, b) => b.score - a.score
    || startYear(b.row.to) - startYear(a.row.to)
    || b.row.seasons - a.row.seasons
    || a.row.name.localeCompare(b.row.name))
  return out
}

// ---- small formatting helpers ----------------------------------------------------------

export const cardUrl = (id) => `https://wcehoops.com/basketball-savant.html?p=${encodeURIComponent(id)}`

export function ordinal(n) {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))
const tier = (p) => (p >= 82 ? 'elite' : p >= 62 ? 'high' : p >= 40 ? 'avg' : 'low') // the page's word()
const feetInches = (n) => { const f = Math.floor(n / 12); return `${f}'${Math.round(n - f * 12)}"` }
const signed = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)
const thousands = (n) => Number(n).toLocaleString('en-US')
const tidy = (n) => (n == null ? null : Math.round(n * 10) / 10)
const day = (iso) => (iso ? String(iso).slice(0, 10) : 'unknown')

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

  const ranked = rank(rows, raw)
  if (!ranked.length) throw new SavantError(`No player matches "${raw}". Check the spelling, or search with nba_search_players.`)

  const top = ranked[0].score
  // Exact matches and their Jr./Sr. namesakes are one tier: any of them could be meant.
  let best = ranked.filter((r) => (top >= 95 ? r.score >= 95 : r.score === top)).map((r) => r.row)
  if (best.length > 1 && season) {
    const there = best.filter((r) => inSpan(r, season))
    if (there.length === 1) return there[0]
    if (there.length > 1) best = there
  }
  // One clear answer: the only player at the top who matched on whole words or a prefix, or
  // the only player who matched at all (a typo that could be nobody else).
  if (best.length === 1 && (top >= 60 || ranked.length === 1)) return best[0]

  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  const why = best.length > 1 ? `${best.length} players match "${raw}"` : `"${raw}" is not an exact match`
  const tip = best.length > 1 && !season ? '\nGiving the season also settles it when only one of them played that year.' : ''
  throw new SavantError(`${why}. Call again with one of these ids:\n${list.map((r) => `- ${candidateLine(r)}`).join('\n')}${tip}`)
}

// ---- search --------------------------------------------------------------------------

export async function searchPlayers({ query, limit = 10 }) {
  const rows = await loadPlayers()
  const ranked = rank(rows, query)
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
  if (!row.qualified) {
    const q = meta.qualify || {}
    notes.push(`He did not qualify for those pools${q.min_mpg && q.min_gp ? ` (${q.min_mpg}+ minutes per game and ${q.min_gp}+ games)` : ''}, so his percentiles rank a small sample against qualified players. Treat them with caution.`)
  }
  L.push(...notes)

  let heading = null
  for (const key of GROUP_ORDER) {
    for (const s of stats.filter((x) => x.group === (meta.groups[key] || key))) {
      const h = s.subgroup && s.subgroup !== s.group ? `${s.group}: ${s.subgroup}` : s.group
      if (h !== heading) { L.push('', h); heading = h }
      const pct = (p) => (p == null ? 'n/a' : ordinal(p))
      const tags = [s.lower_is_better ? 'lower is better' : null, s.low_sample ? 'low sample' : null].filter(Boolean)
      L.push(`- ${s.label}: ${s.display} (league ${pct(s.league_percentile)}, vs. ${peers} ${pct(s.position_percentile)})${tags.length ? ` [${tags.join(', ')}]` : ''}`)
    }
  }
  if (!stats.length) L.push('', 'No stats in this group for that season.')
  if (stats.some((s) => s.low_sample)) {
    notes.push('"low sample" means the stat sits below its stabilization threshold: too few attempts to trust yet.')
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
