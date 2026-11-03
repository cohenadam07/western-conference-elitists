// api/_query.js — WCE Pro (beta): savant_query, the assistant's own question over every
// player-season on Basketball Savant and Football Savant. One section of the AI connector
// (api/mcp.js), registered ONLY for a connection that carries a real WCE key: the public
// address never lists it.
//
// WHAT IT DOES
// The other tools answer the questions the pages already ask (a card, a leaderboard on one
// stat). This one lets the assistant ask its own: filter on any stat's value or percentile,
// choose the stats to show, sort, or group players by team, position, season, age or
// experience and summarize each group (count, mean, median, min, max, sum, weighted mean).
// Up to MAX_SEASONS seasons in one call (fewer for Football Savant; see below).
//
// THE NUMBERS RULE (Adam, 3 Nov 2026)
// - Values and percentiles are the pages' own, read from the same Savant API files every other
//   tool reads (savant-api/basketball/v1, savant-api/football/v1). No percentile is ever
//   worked out here. The October 2026 basketball additions are ranked by extCells(), the
//   page-parity code nba_leaderboard and the profile already use.
// - Group numbers are new: no page shows "the Celtics' mean true shooting". They are plain
//   arithmetic over those stored numbers, and every one is labeled computed, with what it
//   was computed over.
//
// WHAT IT READS
//   NBA  seasons/<season>.json  m: { key: [value, league pct, position pct] }, low: [keys]
//        savant-ext s/<season>.json, ranked by extCells()  { key: [value, league, position, sample] }
//   NFL  seasons/<season>.json  m and xm: { key: [value, season pct, all-time pct] }, low and
//        xlow: [keys], read together the way nfl_leaderboard reads them (xm holds a player's
//        numbers outside his position's own panels, such as a receiver's carries).
//        Both NFL percentiles are against the same position: Football Savant never ranks a
//        player league-wide.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError, day, miss, norm, ordinal } from './_core.js'
import * as nbaMod from './_basketball.js'
import * as nflMod from './_football.js'
import { parsePosition as nflPosition } from './_football-lists.js'
import { extCells, loadExtSeason, wholeAge } from './_basketball-ext.js'

export const MAX_SEASONS = 10
const LOAD_AT_ONCE = 4 // season files fetched in parallel
const MAX_ROWS = 100
const MAX_COLS = 19 // 8 conditions + 10 shown stats + the sort stat: nothing asked for is dropped
const TEXT_ROWS = 50 // rows written out in words; every row is in the structured result
const SOURCES = {
  nba: 'Basketball Savant, Western Conference Elitists (wcehoops.com)',
  nfl: 'Football Savant, Western Conference Elitists (wcehoops.com)',
}
export const COMPUTED_NOTE = 'Group numbers are computed by this query (plain arithmetic over the values and percentiles the pages store); no page shows them. Every percentile itself is the page\'s own, never recomputed.'

const own = (o, k) => o != null && Object.hasOwn(o, k)
const dict = (o) => Object.assign(Object.create(null), o)

// ---- the two datasets, behind one shape ------------------------------------------------------

const NBA_POS = dict({ guard: 'Guard', guards: 'Guard', g: 'Guard', wing: 'Wing', wings: 'Wing', w: 'Wing', big: 'Big', bigs: 'Big', b: 'Big' })
const nbaYear = (s) => +String(s).slice(0, 4)

const nba = {
  sport: 'nba',
  name: 'Basketball Savant',
  pools: dict({ position: 'vs. position', league: 'vs. league' }),
  defaultPool: 'position',
  maxSeasons: MAX_SEASONS,
  fields: dict({
    age: { label: 'Age (whole years on February 1 of the season)', get: (r, season) => wholeAge(r, season) },
    exp: { label: 'Years in the league', get: (r) => (miss(r.exp) ? null : +r.exp) },
    gp: { label: 'Games played', get: (r) => (miss(r.gp) ? null : +r.gp) },
    min: { label: 'Minutes played', get: (r) => (miss(r.min) ? null : +r.min) },
  }),
  // what `sum` may add up: counts, never rates or grades
  summable: new Set(['gp', 'min', 'tech']),
  loadMeta: () => nbaMod.loadMeta(),
  async defaultSeason(meta) {
    for (const s of meta.seasons) if ((meta.qualified[s] || {}).league >= 30) return s
    return meta.latestSeason
  },
  parseSeason: (input, meta) => nbaMod.parseSeason(input, meta),
  year: nbaYear,
  metrics(meta) {
    return meta.metrics.map((m) => ({ key: m.key, label: m.label, group: m.group, unit: m.unit, lower: !!m.lowerIsBetter, since: nbaYear(m.ext ? (m.first || m.since) : m.since), sinceText: m.ext ? (m.first || m.since) : m.since, ext: !!m.ext, lowSampleBelow: m.lowSampleBelow || null, positions: null }))
  },
  position(input) {
    const q = norm(input)
    if (!own(NBA_POS, q)) throw new SavantError('For nba_players, position is Guard, Wing or Big.')
    return { code: NBA_POS[q], match: new Set([NBA_POS[q]]), words: `${NBA_POS[q]}s` }
  },
  async season(meta, season, metrics) {
    const file = await nbaMod.loadSeason(season)
    let ext = null
    if (metrics.some((m) => m.ext)) {
      const xf = await loadExtSeason(season)
      if (xf) ext = extCells(xf, file, 'season', meta.metrics.filter((m) => m.ext))
    }
    return { season, file, ext, rows: file.players, inProgress: !!file.in_progress, week: null }
  },
  // [value, primary pct, secondary pct, low sample] for a player and a stat, or null
  cell(s, r, m) {
    if (m.ext) {
      const c = s.ext && s.ext.get(String(r.id))
      const x = c && c[m.key]
      if (!x || miss(x[0])) return null
      return [x[0], x[1] ?? null, x[2] ?? null, x[3] != null && !!m.lowSampleBelow && x[3] < m.lowSampleBelow]
    }
    const x = r.m && r.m[m.key]
    if (!x || miss(x[0])) return null
    return [x[0], x[1] ?? null, x[2] ?? null, Array.isArray(r.low) && r.low.includes(m.key)]
  },
  // which slot of the cell a pool reads
  slot: (pool) => (pool === 'league' ? 1 : 2),
  poolWords(meta, season, pos, pool) {
    const q = meta.qualified[season] || {}
    if (pool === 'league') return `vs. qualified players, ${season} (${q.league ?? '?'})`
    return `vs. qualified ${String(pos).toLowerCase()}s, ${season} (${q[pos] ?? '?'})`
  },
  onTeam: (r, code) => String(r.team || '').toUpperCase() === code,
  teamOf: (r) => r.team || '—',
  teamNote: 'Team is the one Basketball Savant lists for him that season (a player traded during it is listed with his latest team, and his whole season counts there).',
  // what a weighted mean weighs by: minutes, for every stat
  weightable: () => null,
  weight: (r) => (miss(r.min) ? null : +r.min),
  weightWords: () => 'weighted by minutes played',
  display: (m, v, cell) => nbaMod.display(m.unit, v, cell ? cell[1] : null),
  url: (meta, r) => String(meta.playerUrl).replace('{id}', encodeURIComponent(r.id)),
  urlNote: (meta, seasons) => (seasons.some((s) => s !== meta.latestSeason) ? 'A Basketball Savant link opens the player\'s card on his latest season; pick the season on the card.' : null),
  qualifyWords(meta, loaded) {
    const base = `${meta.qualify.min_mpg}+ minutes a game and ${meta.qualify.min_gp}+ games`
    const live = loaded.filter((s) => s.file.in_progress && s.file.qualify)
    const liveWords = live.map((s) => `in ${s.season}, still being played: ${s.file.qualify.min_mpg}+ minutes a game and ${s.file.qualify.min_gp}+ games, pro-rated to the games played so far`)
    if (live.length === loaded.length) return `qualified players only (${liveWords.join('; ')})`
    return `qualified players only (${base}${liveWords.length ? `; ${liveWords.join('; ')}` : ''})`
  },
  sortDefault: 'pts',
}

const OL_SPOTS = ['OL', 'OT', 'OG', 'OC']

const nfl = {
  sport: 'nfl',
  name: 'Football Savant',
  pools: dict({ season: 'this season', all_time: 'all-time' }),
  defaultPool: 'season',
  // Football Savant's loader keeps 8 season files in memory (api/_football.js): an NFL call
  // reads no more than that, so a repeat of it is served warm.
  maxSeasons: 8,
  fields: dict({
    age: { label: 'Age', get: (r) => (miss(r.age) ? null : +r.age) },
    exp: { label: 'Years in the league', get: (r) => (miss(r.exp) ? null : +r.exp) },
  }),
  summable: new Set(['g', 'starts']),
  loadMeta: () => nflMod.loadMeta(),
  defaultSeason: async (meta) => meta.latestSeason,
  parseSeason: (input, meta) => nflMod.parseSeason(input, meta),
  year: (s) => +s,
  metrics(meta) {
    return meta.metrics.map((m) => ({ key: m.key, label: m.label, group: m.group, unit: m.unit, lower: !!m.lowerIsBetter, since: +m.since, sinceText: String(m.since), ext: false, den: m.den || null, lowSampleBelow: m.lowSampleBelow || null, positions: m.positions || null }))
  },
  // The positions nfl_leaderboard takes ("edge", "corner"...), players only. OL is the line as a
  // whole: rows carry the spot (OT, OG, OC) once the data has it, so OL matches all four.
  position(input, meta) {
    const p = nflPosition(input, meta)
    if (p === 'TEAM') throw new SavantError('savant_query is for players. For team numbers, use nfl_team_profile or nfl_leaderboard with position "team".')
    if (typeof p !== 'string' || !own(meta.positions, p)) throw new SavantError(`For nfl_players, position is one of ${Object.keys(meta.positions).join(', ')}.`)
    if (p === 'OL') return { code: 'OL', match: new Set(OL_SPOTS), words: 'offensive linemen (OL, OT, OG and OC)' }
    return { code: p, match: new Set([p]), words: p }
  },
  async season(meta, season) {
    const file = await nflMod.loadSeason(season)
    return { season, file, ext: null, rows: file.players, inProgress: !!file.week, week: file.week || null }
  },
  cell(s, r, m) {
    const x = (r.m && r.m[m.key]) || (r.xm && r.xm[m.key])
    if (!x || miss(x[0])) return null
    const low = (Array.isArray(r.low) && r.low.includes(m.key)) || (Array.isArray(r.xlow) && r.xlow.includes(m.key))
    return [x[0], x[1] ?? null, x[2] ?? null, low]
  },
  slot: (pool) => (pool === 'all_time' ? 2 : 1),
  poolWords(meta, season, pos, pool) {
    const peers = (meta.positions[pos] || {}).peers || `${pos}s`
    if (pool === 'all_time') return `vs. qualified ${peers}, every season that tracked it`
    return `vs. qualified ${peers}, ${season} (${((meta.pools || {})[season] || {})[pos] ?? '?'})`
  },
  // A team as asked (an old code such as OAK works for the seasons it was used), matched the
  // way nfl_leaderboard does: the team he finished with, or any team he played for that season.
  onTeam: (r, code, meta, season) => {
    let c = code
    for (const [now, e] of Object.entries(meta.era || {})) if (e && e[1] === code && +season <= e[0]) c = now
    return r.team === c || (Array.isArray(r.tms) && r.tms.includes(c))
  },
  teamOf: (r, meta, season) => nflMod.teamIn(meta, season)(r.team) || '—',
  teamNote: 'Team is the one he finished the season with (a filter on team also finds players who played for it earlier that season); old codes such as OAK are used for the seasons they were.',
  // A rate is weighed by what it is a rate of. The files keep every player's count only for the
  // core denominators (meta.denomCore); any other is there only for thin samples, so a mean
  // weighted by it would weigh the thin samples alone.
  weightable: (m, meta) => (m.den && (meta.denomCore || []).includes(m.den) ? null : `${m.label} is a rate of ${(meta.denoms || {})[m.den] || m.den || 'nothing the files keep for every player'}, which the files keep for every player only for the core counts; a weighted mean would weigh the thin samples alone. Use mean or median.`),
  weight: (r, m) => {
    const w = m && m.den && r.d ? r.d[m.den] : null
    return miss(w) ? null : +w
  },
  weightWords: (m, meta) => `weighted by ${(meta.denoms || {})[m.den] || m.den}`,
  display: (m, v) => nflMod.display(m.unit, v),
  url: (meta, r, season) => String(meta.playerUrl).replace('{id}', encodeURIComponent(r.id)).replace('{season}', season),
  urlNote: () => null,
  qualifyWords: () => 'qualified players only (each position\'s qualifying line, pro-rated while a season is being played)',
  sortDefault: 'sav',
}

export const DATASETS = dict({ nba_players: nba, nfl_players: nfl })

// ---- small helpers ---------------------------------------------------------------------------

// A stat by key or label; a field (age, exp...) by name. A near miss lists candidates.
function resolve(input, ds, metrics, { fieldsOk = true } = {}) {
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('A stat is missing its name.')
  const lower = raw.toLowerCase()
  if (fieldsOk && own(ds.fields, lower)) return { field: lower, label: ds.fields[lower].label }
  const q = norm(raw)
  // A key wins over a label: Football Savant has a stat keyed "int" and another labeled "INT %".
  // Then the label, then the key in any case ("TS" is ts).
  const exact = metrics.find((m) => m.key === raw) || metrics.find((m) => norm(m.label) === q) || metrics.find((m) => m.key.toLowerCase() === lower)
  if (exact) return { metric: exact, label: exact.label }
  // Near misses by whole words: "rebound" finds "Offensive rebounds" and the rest, but a two-letter
  // query does not match every label that happens to contain those letters.
  const words = q.split(' ').filter(Boolean)
  const hits = words.some((w) => w.length >= 3) ? metrics.filter((m) => { const lw = norm(m.label).split(' '); return words.every((w) => lw.some((x) => x === w || (w.length >= 3 && x.startsWith(w)))) }) : []
  if (hits.length === 1) return { metric: hits[0], label: hits[0].label }
  const show = hits.slice(0, 20).map((m) => `${m.key} (${m.label})`)
  if (hits.length) throw new SavantError(`"${raw}" fits ${hits.length} stats: ${show.join('; ')}${hits.length > 20 ? '; ...' : ''}. Use the key.`)
  throw new SavantError(`No stat called "${raw}" in ${ds.name}. Call savant_query with list_stats: true for every key${fieldsOk ? `, or use one of the fields ${Object.keys(ds.fields).join(', ')}` : ''}.`)
}

// A percentile's pool, held to the ones the dataset has, wherever one is asked for.
function poolOf(ds, dataset, pool) {
  const p = pool || ds.defaultPool
  if (!own(ds.pools, p)) throw new SavantError(`For ${dataset}, a percentile's pool is ${Object.keys(ds.pools).join(' or ')}.`)
  return p
}

function seasonsFor(args, ds, meta) {
  const first = args.season ? ds.parseSeason(args.season, meta) : null
  const last = args.through ? ds.parseSeason(args.through, meta) : null
  if (!first && last) throw new SavantError('through needs a season to start from.')
  if (!first) return null
  if (!last) return [first]
  const lo = Math.min(ds.year(first), ds.year(last))
  const hi = Math.max(ds.year(first), ds.year(last))
  const out = meta.seasons.filter((s) => ds.year(s) >= lo && ds.year(s) <= hi)
  if (out.length > ds.maxSeasons) throw new SavantError(`That is ${out.length} seasons; one ${ds.name} call reads at most ${ds.maxSeasons}. Split it into ranges of ${ds.maxSeasons} or fewer.`)
  return out
}

// Load in parallel, a few at a time, keeping the order asked.
async function loadAll(items, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }
  await Promise.all(Array.from({ length: Math.min(LOAD_AT_ONCE, items.length) }, worker))
  return out
}

const OPS = { gte: (a, b) => a >= b, lte: (a, b) => a <= b, gt: (a, b) => a > b, lt: (a, b) => a < b, eq: (a, b) => a === b, ne: (a, b) => a !== b }

function check(v, c) {
  if (v == null) return false
  if (c.op === 'between') return v >= c.lo && v <= c.hi
  return OPS[c.op](v, +c.value)
}

const OP_WORDS = { gte: 'at least', lte: 'at most', gt: 'above', lt: 'below', eq: 'equal to', ne: 'not equal to' }

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length }
function median(a) { const b = [...a].sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2 }
const round = (v, places = 3) => (v == null ? null : Math.round(v * 10 ** places) / 10 ** places)

// best/worst follow a stat's direction; a field (age, years) has none, so best is high.
function direction(order, lowerBetter) {
  if (order === 'high') return -1
  if (order === 'low') return 1
  if (order === 'worst') return lowerBetter ? -1 : 1
  return lowerBetter ? 1 : -1
}
// nulls last, whichever way the sort runs
const byValue = (dir) => (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : dir * (a - b))

// ---- the query -------------------------------------------------------------------------------

export async function query(args = {}) {
  const ds = own(DATASETS, args.dataset) ? DATASETS[args.dataset] : null
  if (!ds) throw new SavantError(`dataset is one of ${Object.keys(DATASETS).join(', ')}.`)
  const meta = await ds.loadMeta()
  const metrics = ds.metrics(meta)
  const source = SOURCES[ds.sport]
  const asOf = day(meta.generated)

  // The stat list, so the assistant can plan a query.
  if (args.list_stats) {
    const pos = args.position ? ds.position(args.position, meta) : null
    const list = metrics
      .filter((m) => !pos || !m.positions || m.positions.includes(pos.code))
      .map((m) => ({ key: m.key, label: m.label, group: m.group, unit: m.unit, lower_is_better: m.lower, since: m.sinceText, ...(m.positions ? { positions: m.positions } : {}) }))
    const fields = Object.entries(ds.fields).map(([k, f]) => ({ key: k, label: f.label }))
    const text = [
      `${ds.name}: ${list.length} stats${pos ? ` tracked for ${pos.code}` : ''} for savant_query (key, label, unit; first season).`,
      `Fields you can also filter, sort and group on: ${fields.map((f) => `${f.key} (${f.label})`).join('; ')}.`,
      `Percentile pools: ${Object.entries(ds.pools).map(([k, v]) => `${k} (${v})`).join(', ')}; default ${ds.defaultPool}. Up to ${ds.maxSeasons} seasons a call.`,
      '',
      ...list.map((m) => `- ${m.key}: ${m.label} (${m.unit}${m.lower_is_better ? ', lower is better' : ''}; from ${m.since})`),
      '',
      `Source: ${source}. Data as of ${asOf}.`,
    ].join('\n')
    return { text, structured: { dataset: args.dataset, mode: 'stats', stats: list, fields, data_as_of: asOf, source } }
  }

  const seasons = seasonsFor(args, ds, meta) || [await ds.defaultSeason(meta)]
  const pos = args.position ? ds.position(args.position, meta) : null
  const team = args.team ? String(args.team).trim().toUpperCase() : null
  const qualifiedOnly = args.qualified_only !== false
  const group = args.group_by || null
  const notes = []

  // Resolve every stat the query names, once.
  const where = (args.where || []).map((c) => {
    const at = resolve(c.stat, ds, metrics)
    if (at.field && c.on === 'percentile') throw new SavantError(`${c.stat} is a field, not a stat: it has no percentile.`)
    const on = at.field ? 'value' : (c.on || 'value')
    const pool = on === 'percentile' ? poolOf(ds, args.dataset, c.pool) : null
    if (c.op === 'between' && !(Array.isArray(c.value) && c.value.length === 2 && c.value.every((x) => Number.isFinite(+x)))) throw new SavantError('between takes two numbers: value: [low, high].')
    if (c.op !== 'between' && !Number.isFinite(+c.value)) throw new SavantError(`${c.stat}: the value to compare with must be a number${on === 'percentile' ? ' (a percentile, 1-99)' : ''}.`)
    const lo = c.op === 'between' ? Math.min(+c.value[0], +c.value[1]) : null
    const hi = c.op === 'between' ? Math.max(+c.value[0], +c.value[1]) : null
    return { ...c, ...at, on, pool, lo, hi }
  })
  const show = (args.show || []).map((s) => resolve(s, ds, metrics, { fieldsOk: false }).metric)
  if (group && show.length) notes.push('show is for rows; a group lists up to three of its players instead.')
  if (group === 'position' && pos && pos.match.size === 1) notes.push('Grouped by position with one position chosen: there is one group.')
  const summarize = (args.summarize || []).map((a) => {
    if (a.fn === 'count') return { fn: 'count' }
    if (!a.stat) throw new SavantError(`${a.fn} needs a stat.`)
    const at = resolve(a.stat, ds, metrics)
    if (at.field && a.on === 'percentile') throw new SavantError(`${a.stat} is a field, not a stat: it has no percentile.`)
    const on = at.field ? 'value' : (a.on || 'value')
    const pool = on === 'percentile' ? poolOf(ds, args.dataset, a.pool) : null
    if (a.fn === 'sum' && (on === 'percentile' || !ds.summable.has(at.field || at.metric.key))) throw new SavantError(`sum adds up counts; ${at.label}${on === 'percentile' ? ' percentile' : ''} is not one. Counts for ${args.dataset}: ${[...ds.summable].join(', ')}. Use mean or median for anything else.`)
    if (a.fn === 'weighted_mean') {
      if (at.field) throw new SavantError(`weighted_mean is for stats; ${a.stat} is a field. Use mean.`)
      if (on === 'percentile') throw new SavantError('weighted_mean is for values. For percentiles, use mean or median.')
      const no = ds.weightable(at.metric, meta)
      if (no) throw new SavantError(no)
    }
    return { ...a, ...at, on, pool }
  })
  if (summarize.length && !group) throw new SavantError('summarize needs group_by (team, position, season, age or exp).')
  if (group && !summarize.length) summarize.push({ fn: 'count' })

  // Sorting: by a stat or field, its value or a percentile; best/worst read the stat's direction.
  const sortSpec = (() => {
    const s = args.sort || {}
    if (group) {
      if (s.on || s.pool) notes.push('Groups sort on the summary named in sort.by; sort.on and sort.pool are for rows and were not used.')
      const by = s.by == null ? null : String(s.by)
      if (by === 'count') {
        let idx = summarize.findIndex((a) => a.fn === 'count')
        if (idx < 0) { summarize.push({ fn: 'count' }); idx = summarize.length - 1 }
        return { agg: idx, order: s.order || 'high' }
      }
      const idx = by == null ? 0 : summarize.findIndex((a) => (a.metric && (a.metric.key === by || a.metric.key.toLowerCase() === by.toLowerCase() || norm(a.metric.label) === norm(by))) || (a.field && a.field === by.toLowerCase()))
      if (idx < 0) throw new SavantError(`Groups sort by count or by a stat you summarize; "${by}" is neither.`)
      return { agg: idx, order: s.order || (summarize[idx].fn === 'count' ? 'high' : 'best') }
    }
    // the first stat filtered on, else the first shown, else the page's default
    const firstWhere = where.find((c) => c.metric)
    const firstStat = s.by || (firstWhere && firstWhere.stat) || (show[0] && show[0].key) || ds.sortDefault
    const at = resolve(firstStat, ds, metrics)
    const fromWhere = !s.by && firstWhere && firstWhere.stat === firstStat ? firstWhere : null
    if (at.field && s.on === 'percentile') throw new SavantError(`${firstStat} is a field, not a stat: it has no percentile.`)
    const on = at.field ? 'value' : (s.on || (fromWhere ? fromWhere.on : 'value'))
    const pool = on === 'percentile' ? poolOf(ds, args.dataset, s.pool || (fromWhere && fromWhere.pool)) : null
    const order = s.order || 'best'
    return { ...at, on, pool, order: at.field ? (order === 'best' ? 'high' : order === 'worst' ? 'low' : order) : order }
  })()

  // A stat the chosen position never has (Football Savant tracks stats by position).
  const named = [...where.filter((c) => c.metric).map((c) => c.metric), ...show, ...summarize.filter((a) => a.metric).map((a) => a.metric), ...(sortSpec.metric ? [sortSpec.metric] : [])]
  const uniq = [...new Map(named.map((m) => [m.key, m])).values()]
  if (pos) for (const m of uniq) {
    if (m.positions && ![...pos.match].some((p) => m.positions.includes(p))) throw new SavantError(`${m.label} is not tracked for ${pos.code} on ${ds.name}. It is tracked for ${m.positions.join(', ')}.`)
  }

  // Stats a season did not track yet.
  for (const m of uniq.filter((x) => seasons.some((s) => ds.year(s) < x.since))) {
    if (seasons.every((s) => ds.year(s) < m.since)) throw new SavantError(`${m.label} was not tracked in ${seasons.length > 1 ? 'those seasons' : seasons[0]}; it starts in ${m.sinceText}.`)
    const why = where.some((c) => c.metric && c.metric.key === m.key) ? ', so they add no rows to a filter on it' : sortSpec.metric && sortSpec.metric.key === m.key ? ', so their rows sort last' : ''
    notes.push(`${m.label} starts in ${m.sinceText}: seasons before it have no value for it${why}.`)
  }

  // Read the seasons and keep the rows that pass.
  const rows = []
  const inProgress = []
  const thinStats = [...new Map([...where.filter((c) => c.metric).map((c) => c.metric), ...(!group && sortSpec.metric ? [sortSpec.metric] : [])].map((m) => [m.key, m])).values()]
  if (args.exclude_low_sample) notes.push(`Left out: player-seasons below the stabilization threshold on ${thinStats.length ? thinStats.map((m) => m.label).join(', ') : 'the stats filtered or sorted on (none here, so nothing was left out)'}.`)
  const loaded = await loadAll(seasons, (season) => ds.season(meta, season, uniq))
  let teamSeen = false
  for (const s of loaded) {
    const season = s.season
    if (s.inProgress) inProgress.push(ds.sport === 'nfl' && s.week ? `${season} (through week ${s.week})` : season)
    if (uniq.some((m) => m.ext && ds.year(season) >= m.since) && !s.ext) notes.push(`The October 2026 additions could not be loaded for ${season}; its rows have no value for them.`)
    for (const r of s.rows) {
      if (qualifiedOnly && !r.qualified) continue
      if (pos && !pos.match.has(r.pos)) continue
      if (team) { if (!ds.onTeam(r, team, meta, season)) continue; teamSeen = true }
      const valueOf = (x) => {
        if (x.field) return ds.fields[x.field].get(r, season)
        const c = ds.cell(s, r, x.metric)
        if (!c) return null
        return x.on === 'percentile' ? c[ds.slot(x.pool)] : c[0]
      }
      if (!where.every((c) => check(valueOf(c), c))) continue
      // The Leaderboard Builders' default: a number below its stat's stabilization threshold is
      // left out. Here only on request, and only for the stats the query filters or sorts on.
      if (args.exclude_low_sample && thinStats.some((m) => { const c = ds.cell(s, r, m); return c && c[3] })) continue
      rows.push({ season, r, s, valueOf })
    }
  }
  if (team && !teamSeen) notes.push(`No ${qualifiedOnly ? 'qualified ' : ''}player was on ${team} in ${seasons.length > 1 ? 'those seasons' : seasons[0]}${pos ? ` at ${pos.code}` : ''}. Check the abbreviation.`)
  if (team || group === 'team') notes.push(ds.teamNote)
  if (pos && pos.code === 'OL') notes.push('OL covers the whole line: OT, OG and OC, and OL where the data has no spot. Each lineman is ranked against his own spot.')

  const cellOut = (row, m) => {
    const c = ds.cell(row.s, row.r, m)
    if (!c) return { value: null, display: ds.year(row.season) < m.since ? 'not tracked' : '—' }
    const out = { value: c[0], display: ds.display(m, c[0], c), low_sample: !!c[3] }
    for (const pool of Object.keys(ds.pools)) out[`pct_${pool}`] = c[ds.slot(pool)]
    return out
  }
  const scopeWords = [
    `${ds.name}, ${seasons.length > 1 ? `${seasons[seasons.length - 1]} through ${seasons[0]}` : seasons[0]}`,
    pos ? pos.words : null,
    team ? `team ${team}` : null,
    qualifiedOnly ? ds.qualifyWords(meta, loaded) : 'qualified or not (a player who did not qualify is still ranked against the qualified pool)',
  ].filter(Boolean).join('; ')
  const whereWords = where.map((c) => `${c.label}${c.on === 'percentile' ? ` percentile ${ds.pools[c.pool]}` : ''} ${c.op === 'between' ? `between ${c.lo} and ${c.hi}` : `${OP_WORDS[c.op]} ${c.value}`}`)
  if (inProgress.length) notes.push(`In progress: ${inProgress.join(', ')}. Numbers are to date, raw (not where they are likely to settle), and low-sample stats are flagged.`)

  // ---- groups ----
  if (group) {
    const keyOf = (row) => {
      switch (group) {
        case 'team': return ds.teamOf(row.r, meta, row.season)
        case 'position': return row.r.pos || '—'
        case 'season': return row.season
        case 'age': { const a = ds.fields.age.get(row.r, row.season); return a == null ? '—' : String(a) }
        case 'exp': return miss(row.r.exp) ? '—' : String(row.r.exp)
        default: throw new SavantError('group_by is team, position, season, age or exp.')
      }
    }
    const byKey = new Map()
    for (const row of rows) { const k = keyOf(row); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(row) }
    const minSize = args.min_group_size ?? 3
    const groups = []
    for (const [k, members] of byKey) {
      if (members.length < minSize) continue
      const aggs = summarize.map((a) => {
        if (a.fn === 'count') return { fn: 'count', value: members.length, display: String(members.length), over: members.length }
        const getter = (row) => row.valueOf(a)
        const vals = members.map(getter).filter((v) => v != null)
        let value = null
        let over = vals.length
        let note = null
        if (a.fn === 'weighted_mean') {
          let num = 0, den = 0
          over = 0
          for (const row of members) { const v = getter(row); const w = ds.weight(row.r, a.metric); if (v == null || w == null || w <= 0) continue; num += v * w; den += w; over++ }
          value = den > 0 ? num / den : null
          note = ds.weightWords(a.metric, meta)
        } else if (vals.length) {
          if (a.fn === 'mean') value = mean(vals)
          else if (a.fn === 'median') value = median(vals)
          else if (a.fn === 'min') value = Math.min(...vals)
          else if (a.fn === 'max') value = Math.max(...vals)
          else if (a.fn === 'sum') value = vals.reduce((x, y) => x + y, 0)
        }
        // a computed mean or median keeps a decimal even when the stat is a whole number
        const averaged = ['mean', 'median', 'weighted_mean'].includes(a.fn)
        const display = value == null ? '—'
          : a.on === 'percentile' ? `${round(value, 1)} (${ds.pools[a.pool]} percentile)`
          : a.field || a.metric.unit === 'word' || (averaged && a.metric.unit === 'num0') ? String(round(value, 1))
          : ds.display(a.metric, value, null)
        return { fn: a.fn, stat: a.metric ? a.metric.key : a.field, label: a.label, on: a.on, ...(a.pool ? { pool: a.pool } : {}), value: round(value, 4), display, over, computed: true, ...(note ? { weighting: note } : {}) }
      })
      groups.push({ group: k, players: members.length, aggregates: aggs, members })
    }
    // sort groups
    const sa = summarize[sortSpec.agg]
    const lowerBetter = !!(sa && sa.on === 'value' && sa.metric && sa.metric.lower)
    const dir = direction(sortSpec.order, lowerBetter)
    const cmp = byValue(dir)
    groups.sort((x, y) => cmp(x.aggregates[sortSpec.agg].value, y.aggregates[sortSpec.agg].value) || String(x.group).localeCompare(String(y.group)))
    const limit = Math.min(MAX_ROWS, Math.max(1, args.limit || 25))
    const top = groups.slice(0, limit)
    // up to three named players a group: the ones at the same end of the sorted stat as the order
    const memberVal = sa && sa.fn !== 'count' ? (row) => row.valueOf(sa) : null
    const shaped = top.map((g, i) => {
      const ms = [...g.members]
      if (memberVal) ms.sort((p, q) => cmp(memberVal(p), memberVal(q)) || p.r.name.localeCompare(q.r.name))
      return { rank: i + 1, group: g.group, players: g.players, aggregates: g.aggregates, examples: ms.slice(0, 3).map((row) => ({ id: String(row.r.id), name: row.r.name, team: ds.teamOf(row.r, meta, row.season), season: row.season })) }
    })
    const pools = summarize.filter((a) => a.on === 'percentile').map((a) => `${a.label}: ${ds.pools[a.pool]} percentiles`)
    const sortWords = sa.fn === 'count' ? 'count' : `${sa.fn} ${sa.label}${sa.on === 'percentile' ? ' percentile' : ''}`
    const L = [
      `savant_query (WCE Pro beta). ${scopeWords}.`,
      where.length ? `Filters: ${whereWords.join('; ')}.` : 'No filters.',
      `${rows.length} player-seasons match, in ${byKey.size} ${group} groups; ${groups.length} have at least ${minSize} players${top.length < groups.length ? `, top ${top.length} shown` : ''}; sorted by ${sortWords} (${sortSpec.order}).`,
      '',
      ...shaped.map((g) => `${g.rank}. ${g.group} (${g.players} players): ${g.aggregates.filter((a) => a.fn !== 'count').map((a) => `${a.fn === 'weighted_mean' ? `mean ${a.label} (${a.weighting})` : `${a.fn} ${a.label}${a.on === 'percentile' ? ' percentile' : ''}`} ${a.display}${a.over < g.players ? ` [over ${a.over} of them]` : ''}`).join('; ') || 'count only'}. e.g. ${g.examples.map((e) => e.name).join(', ')}`),
      '',
      COMPUTED_NOTE,
      ...(pools.length ? [`Percentile pools: ${pools.join('; ')}; each player against his own pool (${ds.sport === 'nba' ? 'his position or the league, that season' : 'his position'}).`] : []),
      ...notes,
      `Source: ${source}. Data as of ${asOf}.`,
    ]
    return {
      text: L.join('\n'),
      structured: { dataset: args.dataset, mode: 'groups', seasons, scope: scopeWords, filters: whereWords, group_by: group, matching: rows.length, groups_total: groups.length, min_group_size: minSize, sort: { by: sa.fn === 'count' ? 'count' : sa.metric ? sa.metric.key : sa.field, fn: sa.fn, order: sortSpec.order }, groups: shaped, computed_note: COMPUTED_NOTE, notes, url: meta.page, data_as_of: asOf, source },
    }
  }

  // ---- rows ----
  const lowerBetter = !!(sortSpec.metric && sortSpec.on === 'value' && sortSpec.metric.lower)
  const cmp = byValue(direction(sortSpec.order, lowerBetter))
  const keyed = rows.map((row) => ({ row, v: row.valueOf(sortSpec) }))
  keyed.sort((x, y) => cmp(x.v, y.v) || x.row.r.name.localeCompare(y.row.r.name) || x.row.season.localeCompare(y.row.season))
  const limit = Math.min(MAX_ROWS, Math.max(1, args.limit || 25))
  const top = keyed.slice(0, limit)
  // what each row shows: the sort stat, then the filtered stats, then the asked-for ones
  const cols = [...new Map([...(sortSpec.metric ? [sortSpec.metric] : []), ...where.filter((c) => c.metric).map((c) => c.metric), ...show].map((m) => [m.key, m])).values()].slice(0, MAX_COLS)
  const fieldCols = [...new Set([...(sortSpec.field ? [sortSpec.field] : []), ...where.filter((c) => c.field).map((c) => c.field)])]
  const shaped = top.map(({ row }, i) => {
    const fields = Object.fromEntries(fieldCols.map((f) => [f, ds.fields[f].get(row.r, row.season)]))
    return {
      rank: i + 1, id: String(row.r.id), name: row.r.name, team: ds.teamOf(row.r, meta, row.season), position: row.r.pos, season: row.season,
      age: ds.fields.age.get(row.r, row.season), qualified: !!row.r.qualified, ...fields,
      stats: Object.fromEntries(cols.map((m) => [m.key, cellOut(row, m)])),
      url: ds.url(meta, row.r, row.season),
    }
  })
  const shownPool = sortSpec.pool || (where.find((c) => c.pool) || {}).pool || ds.defaultPool
  const pctWords = (c) => (c[`pct_${shownPool}`] == null ? '' : ` (${ordinal(c[`pct_${shownPool}`])} ${ds.pools[shownPool]})`)
  const poolExample = shaped.length ? ds.poolWords(meta, shaped[0].season, shaped[0].position, shownPool) : null
  const urlNote = ds.urlNote(meta, seasons)
  const L = [
    `savant_query (WCE Pro beta). ${scopeWords}.`,
    where.length ? `Filters: ${whereWords.join('; ')}.` : 'No filters.',
    `${rows.length} player-seasons match; sorted by ${sortSpec.label}${sortSpec.on === 'percentile' ? ` percentile ${ds.pools[sortSpec.pool]}` : ''} (${sortSpec.order})${top.length < rows.length ? `, top ${top.length} shown` : ''}.`,
    '',
    ...shaped.slice(0, TEXT_ROWS).map((x) => `${x.rank}. ${x.name} (${[x.team, x.position, seasons.length > 1 ? x.season : null, x.age != null ? `age ${x.age}` : null].filter(Boolean).join(', ')}${x.qualified ? '' : ', not qualified'}): ${fieldCols.filter((f) => f !== 'age').map((f) => `${f} ${x[f]}`).concat(cols.map((m) => { const c = x.stats[m.key]; return `${m.label} ${c.display}${c.value != null ? pctWords(c) : ''}${c.low_sample ? '*' : ''}` })).join('; ')}`),
    ...(shaped.length > TEXT_ROWS ? [`… ${shaped.length - TEXT_ROWS} more rows in the structured result.`] : []),
    '',
    `Percentiles shown are ${ds.pools[shownPool]}${poolExample ? ` (the first row's pool: ${poolExample})` : ''}; each row's structured stats carry ${Object.keys(ds.pools).map((p) => `pct_${p}`).join(' and ')}. * = below the stat's stabilization threshold (low sample).`,
    ...notes,
    ...(urlNote ? [urlNote] : []),
    `Pages: ${meta.page}`,
    `Source: ${source}. Data as of ${asOf}.`,
  ]
  return {
    text: L.join('\n'),
    structured: { dataset: args.dataset, mode: 'rows', seasons, scope: scopeWords, filters: whereWords, matching: rows.length, sort: { by: sortSpec.metric ? sortSpec.metric.key : sortSpec.field, on: sortSpec.on, ...(sortSpec.pool ? { pool: sortSpec.pool } : {}), order: sortSpec.order }, pools: Object.keys(ds.pools).map((p) => `pct_${p}`), rows: shaped, notes: urlNote ? [...notes, urlNote] : notes, url: meta.page, data_as_of: asOf, source },
  }
}

// ---- the tool --------------------------------------------------------------------------------

const open = z.object({}).passthrough()
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)])
const POOLS = ['position', 'league', 'season', 'all_time']
const condition = z.object({
  stat: z.string().min(1).max(80).describe('Stat key or label, or a field (age, exp; NBA also gp, min).'),
  op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'ne', 'between']),
  value: z.union([num, z.array(num).length(2)]).describe('A number; for between, [low, high].'),
  on: z.enum(['value', 'percentile']).optional().describe('Default value.'),
  pool: z.enum(POOLS).optional().describe('Percentile pool. NBA: position (default) or league. NFL: season (default) or all_time, both at his position.'),
})
const aggregate = z.object({
  fn: z.enum(['count', 'mean', 'median', 'min', 'max', 'sum', 'weighted_mean']),
  stat: z.string().min(1).max(80).optional(),
  on: z.enum(['value', 'percentile']).optional(),
  pool: z.enum(POOLS).optional(),
})

export const tools = [
  {
    name: 'savant_query',
    config: {
      title: 'WCE Pro (beta): query Basketball and Football Savant',
      description: 'WCE Pro (beta), for WCE key holders. Your own question over every player-season on Basketball Savant (nba_players, 1979-80 on) or Football Savant (nfl_players, 1999 on): filter on any stat\'s value or percentile, choose the stats to show and the sort, or group by team, position, season, age or exp and summarize (count, mean, median, min, max, sum of counts, weighted mean). Up to 10 NBA or 8 NFL seasons a call (season through through). Call with list_stats: true first for the keys. Percentiles are the pages\' own, never recomputed: NBA vs. position (default) or league; NFL at his position, this season (default) or all-time. Group numbers are plain arithmetic over them, labeled computed. Qualified players only unless qualified_only is false. Every answer names its pools and flags low samples.',
      inputSchema: {
        dataset: z.enum(['nba_players', 'nfl_players']).describe('Which players.'),
        list_stats: z.boolean().optional().describe('Return the stat keys instead of running a query.'),
        season: z.string().max(12).optional().describe('NBA "2025-26"; NFL "2025". Default: the newest season.'),
        through: z.string().max(12).optional().describe('Last season of a range (inclusive).'),
        position: z.string().max(24).optional().describe('NBA Guard, Wing or Big; NFL QB, RB, WR, TE, OL (or OT, OG, OC), ED, DI, LB, CB, S, K, P.'),
        team: z.string().max(4).optional().describe('Team abbreviation.'),
        qualified_only: z.boolean().optional().describe('Default true.'),
        exclude_low_sample: z.boolean().optional().describe('Leave out player-seasons below the stabilization threshold on the stats filtered or sorted on (the Leaderboard Builders\' default). Default false: kept, flagged.'),
        where: z.array(condition).max(8).optional().describe('Conditions, all must hold.'),
        show: z.array(z.string().max(80)).max(10).optional().describe('More stats to return per row.'),
        group_by: z.enum(['team', 'position', 'season', 'age', 'exp']).optional(),
        summarize: z.array(aggregate).max(6).optional().describe('Per group. weighted_mean weighs NBA by minutes, NFL by the stat\'s denominator.'),
        min_group_size: z.number().int().min(1).max(50).optional().describe('Groups smaller than this are left out. Default 3.'),
        sort: z.object({ by: z.string().max(80).optional(), on: z.enum(['value', 'percentile']).optional(), pool: z.enum(POOLS).optional(), order: z.enum(['best', 'worst', 'high', 'low']).optional() }).optional().describe('Rows: a stat or field. Groups: count or a summarized stat. best/worst follow the stat\'s direction.'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional().describe('Rows or groups to return. Default 25.'),
      },
      outputSchema: {
        dataset: z.string(), mode: z.enum(['rows', 'groups', 'stats']),
        seasons: z.array(z.string()).optional(), scope: z.string().optional(), filters: z.array(z.string()).optional(),
        matching: z.number().int().optional(), rows: z.array(open).optional(), groups: z.array(open).optional(), stats: z.array(open).optional(), fields: z.array(open).optional(),
        group_by: z.string().optional(), groups_total: z.number().int().optional(), min_group_size: z.number().int().optional(), sort: open.optional(), pools: z.array(z.string()).optional(),
        computed_note: z.string().optional(), notes: z.array(z.string()).optional(), url: z.string().optional(), data_as_of: z.string(), source: z.string(),
      },
      annotations: { title: 'WCE Pro (beta): query Basketball and Football Savant', ...READ_ONLY },
    },
    run: query,
  },
]
