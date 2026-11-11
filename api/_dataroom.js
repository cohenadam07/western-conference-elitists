// api/_dataroom.js — the WCE Data Room, every sport, behind two tools (research/data-room/BUILD.md).
//
//   savant_dictionary   the catalog (every sport's tables, what a row is, seasons, row counts), or one
//                       table's columns: definition, unit, source, first season, caveat
//   savant_data         rows: one season of one table, filtered, sorted, paged (500 a call)
//
// They replace the six per-sport tools (nba_coaching_data / _dictionary, cbb_data /
// cbb_data_dictionary, cbb_coaching_data / _dictionary): one narrow pair instead of six, so an
// assistant reads less tool text up front and has fewer wrong picks to make. The old tools' tables
// are here under their sport (nba coaching_games, cbb player_games, cbb coaching_programs ...)
// and answer with the same rows (tools/dataroom/check.mjs holds the two to each other).
//
// Where the rows live:
//   site      the six older tables: the coaching pages' own files (bcs/data, cbcs/data) and College
//             Basketball Savant's team files (cbb/), read as those pages read them
//   public    small new tables (UFC fights and rounds, NFL and CFB team-games): /dataroom/<sport>/<table>/<season>.json
//   release   large new tables (NFL plays and player-games, NBA player-games and shots, CFB plays):
//             GitHub release assets on this repository (tag "dataroom"), fetched at run time and
//             cached. Free, out of git, and a refresh replaces a season in place.
// public/dataroom/catalog.json says which seasons exist and how many rows each holds;
// public/dataroom/dictionary.json defines every column of the new tables.
//
// One call reads at most one season's file of one table (the Vercel function's memory is the
// limit that binds), and an answer's "data through" is the newest row of that season, never the
// day it was read.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader } from './_core.js'
import { matches, tableAsOf as bcsTableAsOf, coachingDictionary as bcsDictionary } from './_bcoaching.js'
import { cbbTable, CBB_TABLES, dictionary as cbbDictionary } from './_cbb.js'
import { coachingDictionary as cbcsDictionary } from './_cbcoaching.js'

export const SPORTS = ['nba', 'nfl', 'cfb', 'cbb', 'ufc']
export const OPS = ['eq', 'ne', 'in', 'gte', 'lte', 'gt', 'lt', 'contains', 'null', 'notnull']
const MAX_ROWS = 500
const SOURCE = 'The WCE Data Room, Western Conference Elitists (wcehoops.com)'
const SEASON_FORMAT = { nba: /^\d{4}-\d{2}$/, cbb: /^\d{4}-\d{2}$/, nfl: /^\d{4}$/, cfb: /^\d{4}$/, ufc: /^\d{4}$/ }
const SEASON_EXAMPLE = { nba: '2024-25', cbb: '2025-26', nfl: '2025', cfb: '2025', ufc: '2025 (a calendar year)' }
const SPORT_NAME = { nba: 'Basketball Savant', nfl: 'Football Savant', cfb: 'College Football Savant', cbb: 'College Basketball Savant', ufc: 'UFC Savant' }

// The six tables that came from the per-sport tools: name here -> where their rows are.
const LEGACY = {
  nba: Object.fromEntries(['games', 'stints', 'units', 'rotation', 'decisions'].map((t) => [`coaching_${t}`, { src: 'bcs', table: t }])),
  cbb: {
    ...Object.fromEntries(CBB_TABLES.map((t) => [t, { src: 'cbb', table: t }])),
    ...Object.fromEntries(['games', 'stints', 'units', 'rotation', 'decisions', 'roster_moves', 'programs'].map((t) => [`coaching_${t}`, { src: 'cbcs', table: t }])),
  },
}
// The page-stat dictionaries the old dictionary tools served, reachable through savant_dictionary.
const STAT_DICTS = {
  'cbb:stats': () => cbbDictionary(),
  'nba:coaching_stats': () => bcsDictionary({}),
  'cbb:coaching_stats': () => cbcsDictionary({}),
}

const room = makeLoader('dataroom', { what: 'The Data Room', maxCached: 12, shape: (b) => b && typeof b === 'object' && (b.sports || b.columns) })
const bcs = makeLoader('bcs', { what: 'Basketball Coaching Savant', maxCached: 4, shape: (b) => b && typeof b === 'object' && (b.meta || b.columns || b.tables) })
const cbcs = makeLoader('cbcs', { what: 'College Basketball Coaching Savant', maxCached: 4, shape: (b) => b && typeof b === 'object' && (b.meta || b.cols || b.tables) })
const catalog = () => room.load('catalog.json')
const dictionary = () => room.load('dictionary.json')

// ---- the release-asset tables ---------------------------------------------------------------
// GitHub serves a release asset as gzip bytes (application/octet-stream, no Content-Encoding):
// they are unzipped here. Two parsed seasons are kept at most; the biggest is ~55 MB of JSON.
const ASSET_TTL_MS = 10 * 60 * 1000
const ASSET_TIMEOUT_MS = 15000
const MAX_ASSETS = 2
const assets = new Map()
export const assetBase = () => (process.env.DATAROOM_ASSETS || 'https://github.com/cohenadam07/western-conference-elitists/releases/download/dataroom').replace(/\/+$/, '')
export const assetName = (sport, table, season) => `${sport}-${table}-${season}.json.gz`
export let loads = 0   // how many table files this process has read (the one-file-a-call check)

async function loadAsset(sport, table, season) {
  const key = assetName(sport, table, season)
  const hit = assets.get(key)
  if (hit && (hit.pending || Date.now() - hit.at < ASSET_TTL_MS)) { hit.used = Date.now(); return hit.pending || hit.value }
  const pending = (async () => {
    const res = await fetch(`${assetBase()}/${key}`, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS), redirect: 'follow' })
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
    let buf = Buffer.from(await res.arrayBuffer())
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
    const doc = JSON.parse(buf.toString('utf8'))
    if (!doc || doc.schema !== 1 || !Array.isArray(doc.columns)) throw new Error(`${key}: unexpected shape`)
    return doc
  })()
  assets.set(key, { pending, used: Date.now() })
  try {
    const value = await pending
    assets.set(key, { value, at: Date.now(), used: Date.now() })
    while (assets.size > MAX_ASSETS) {
      const idle = [...assets.entries()].filter(([k, v]) => !v.pending && k !== key).sort((a, b) => a[1].used - b[1].used)[0]
      if (!idle) break
      assets.delete(idle[0])
    }
    return value
  } catch (e) {
    console.error(`[dataroom] ${key} failed:`, e.message)
    if (hit && hit.value) { assets.set(key, { value: hit.value, at: Date.now() - ASSET_TTL_MS + 60000, used: Date.now() }); return hit.value }
    assets.delete(key)
    throw new SavantError(`The Data Room's ${sport} ${table} ${season} file could not be loaded right now. Try again in a minute.`)
  }
}
export function clearAssets() { assets.clear() }

// ---- one season of one table, every row ------------------------------------------------------
const pageUrl = (path) => `${SITE}${path}`

function checkSeason(sport, table, season, seasons) {
  const list = Object.keys(seasons || {}).sort()
  if (season == null || season === '') {
    if (!list.length) throw new SavantError(`${sport} ${table} has no seasons on file yet.`)
    return list[list.length - 1]
  }
  if (table === 'coaching_programs') return 'all'
  if (!SEASON_FORMAT[sport].test(season)) throw new SavantError(`Give a ${sport} season as ${SEASON_EXAMPLE[sport]}.`)
  if (list.length && !list.includes(season)) throw new SavantError(`No ${sport} ${table} for ${season}. It covers ${list[0]} to ${list[list.length - 1]}${list.length < (+list[list.length - 1].slice(0, 4) - +list[0].slice(0, 4) + 1) ? ` (seasons on file: ${list.join(', ')})` : ''}.`)
  return season
}

// -> { columns, rows, through, definition(s), legend, url, season, row }
async function readTable(sport, table, season, team) {
  const cat = await catalog()
  const tables = (cat.sports || {})[sport]
  if (!tables) throw new SavantError(`Pick a sport: ${SPORTS.join(', ')}.`)
  const entry = tables[table]
  if (!entry) throw new SavantError(`No ${sport} table "${table}". Tables: ${Object.keys(tables).join(', ')}.`)
  const s = checkSeason(sport, table, season, entry.seasons)
  const legacy = (LEGACY[sport] || {})[table]
  loads++
  if (!legacy) {
    const doc = entry.hosting === 'release' ? await loadAsset(sport, table, s) : await room.load(`${sport}/${table}/${s}.json`)
    const dict = (await dictionary()).sports[sport][table]
    return { s, columns: doc.columns, rows: doc.rows, through: doc.through || null, defs: dict.columns, note: dict.note, row: entry.row, url: pageUrl(entry.page) }
  }
  if (legacy.src === 'bcs') {
    const [file, idx, dict] = await Promise.all([bcs.load(`data/${legacy.table}/${s}.json`), bcs.load('index.json'), bcs.load('data/dictionary.json')])
    return { s, columns: file.columns, rows: file.rows, through: bcsTableAsOf(file, idx), definition: dict.tables[legacy.table], legend: file.legend || null, row: entry.row, url: pageUrl(entry.page) }
  }
  if (legacy.src === 'cbcs') {
    const path = legacy.table === 'programs' ? 'data/programs.json' : `data/${legacy.table}/${s}.json`
    const [file, idx, dict] = await Promise.all([cbcs.load(path), cbcs.load('index.json'), cbcs.load('data/dictionary.json')])
    const through = file.through ? day(file.through) : day(idx.meta.through || idx.meta.generated)
    return { s: legacy.table === 'programs' ? null : s, columns: file.cols, rows: file.rows, through, definition: dict.tables[legacy.table]?.note || '', row: entry.row, url: pageUrl(entry.page) }
  }
  // College Basketball Savant's own tables: built from its season and team files (needs a team but for games)
  if (legacy.table !== 'games' && !team) throw new SavantError(`cbb ${table} is kept per team-season: give team (e.g. "Duke").`)
  const t = await cbbTable({ table: legacy.table, season: s, team })
  const di = t.cols.indexOf('date')
  let through = null
  if (di >= 0) for (const r of t.rows) if (r[di] && (!through || r[di] > through)) through = r[di]
  return { s: t.s, columns: t.cols, rows: t.rows, through: through || entry.seasons?.[s]?.through || null, definition: CBB_DEFS[legacy.table], row: entry.row, url: pageUrl(entry.page) }
}

const CBB_DEFS = {
  games: 'One row per D1 game: ids, date, home and away team (ids and names), scores, overtime, site, postseason, closing line and data-quality flags. Every number WCE-derived.',
  player_games: 'One row per player per game for one team-season (box score): minutes, points, shooting, rebounds, assists, turnovers, steals, blocks, fouls, starter, opponent and date. Non-D1 opponents are marked.',
  units: 'Five-man units for one team-season: the five, seconds together, possessions each way, points each way and opponents\' threes and free throws. 2024-25 on.',
  possessions: 'Every possession of one team-season (2025-26 on): how it began, the timeout before it (media, own or the opponent\'s), points, clutch, and the five on the floor each way.',
}

// ---- sort and page ---------------------------------------------------------------------------
function sortRows(rows, k, descending) {
  const num = (x) => (typeof x === 'number' ? x : x != null && x !== '' && Number.isFinite(+x) ? +x : null)
  return rows.slice().sort((a, b) => {
    const x = a[k], y = b[k]
    if (x == null || y == null) return (x == null) - (y == null)
    const p = num(x), q = num(y)
    const c = p != null && q != null ? p - q : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
    return descending ? -c : c
  })
}

export async function savantData({ sport, table, season, team, filters = [], columns, sort, descending = false, limit = 100, offset = 0 } = {}) {
  if (!SPORTS.includes(sport)) throw new SavantError(`Pick a sport: ${SPORTS.join(', ')}.`)
  const t = await readTable(sport, table, season, team)
  const cols = t.columns
  const want = columns && columns.length ? columns : cols
  const bad = want.filter((c) => !cols.includes(c))
  if (bad.length) throw new SavantError(`No column ${bad.map((c) => `"${c}"`).join(', ')} in ${sport} ${table}. Columns: ${cols.join(', ')}.`)
  for (const f of filters || []) {
    if (!cols.includes(f.column)) throw new SavantError(`No column "${f.column}" in ${sport} ${table}. Columns: ${cols.join(', ')}.`)
    if (!OPS.includes(f.op)) throw new SavantError(`Unknown op "${f.op}". Use ${OPS.join(', ')}.`)
  }
  let all = filters && filters.length ? t.rows.filter((r) => matches(r, cols, filters)) : t.rows
  if (sort) {
    const k = cols.indexOf(sort)
    if (k < 0) throw new SavantError(`Can't sort by "${sort}": no such column in ${sport} ${table}. Columns: ${cols.join(', ')}.`)
    all = sortRows(all, k, descending)
  }
  const lim = Math.min(MAX_ROWS, Math.max(1, limit))
  const idxs = want.map((c) => cols.indexOf(c))
  const page = all.slice(offset, offset + lim).map((r) => idxs.map((i) => (r[i] === undefined ? null : r[i])))
  const definitions = t.defs ? Object.fromEntries(want.map((c) => [c, t.defs[c] || null])) : { table: t.definition }
  const next = offset + lim < all.length ? offset + lim : null
  const structured = {
    sport, table, season: t.s, row: t.row, columns: want, rows: page, total_matching: all.length, offset, limit: lim, next_offset: next,
    definitions, ...(t.note ? { note: t.note } : {}), ...(t.legend ? { legend: t.legend } : {}),
    data_through: t.through ? day(t.through) : null, url: t.url, source: SOURCE,
  }
  const defLine = t.defs ? `Columns: ${want.map((c) => { const d = t.defs[c]; return d ? `${c} (${d.unit || 'value'})` : c }).join(', ')}.` : `Columns: ${want.join(', ')}. ${t.definition || ''}`
  const text = [
    `${SPORT_NAME[sport]} Data Room, ${table}${t.s ? ` ${t.s}` : ''}${team ? ` (${team})` : ''}: ${all.length} row${all.length === 1 ? '' : 's'} match${filters && filters.length ? ' the filters' : ''}; rows ${page.length ? offset + 1 : 0}–${offset + page.length}${next != null ? ` (next offset ${next})` : ''}. One row per ${t.row}.`,
    defLine, t.note || '', t.legend ? `Legend: ${JSON.stringify(t.legend)}` : '', '',
    ...page.slice(0, 50).map((r) => JSON.stringify(r)), page.length > 50 ? `… ${page.length - 50} more rows in the structured result` : '', '',
    `Data through ${structured.data_through || 'unknown'} (the newest row of the season). Page: ${t.url}. Source: ${SOURCE}. Column definitions: savant_dictionary.`,
  ].filter((x) => x !== '').join('\n')
  return { structured, text }
}

// ---- the dictionary --------------------------------------------------------------------------
export async function savantDictionary({ sport, table } = {}) {
  const cat = await catalog()
  if (sport && !SPORTS.includes(sport)) throw new SavantError(`Pick a sport: ${SPORTS.join(', ')}.`)
  if (!table) {
    const sports = sport ? [sport] : SPORTS
    const out = {}
    const L = [sport ? `${SPORT_NAME[sport]}'s Data Room tables.` : 'The WCE Data Room: every sport\'s tables. Read a table\'s columns with savant_dictionary(sport, table) before pulling rows with savant_data.', '']
    for (const s of sports) {
      const tables = (cat.sports || {})[s] || {}
      out[s] = {}
      L.push(`${s} (${SPORT_NAME[s]}):`)
      for (const [t, v] of Object.entries(tables)) {
        const ss = Object.keys(v.seasons || {}).sort()
        const rows = Object.values(v.seasons || {}).reduce((n, x) => n + (x.rows || 0), 0)
        out[s][t] = { row: v.row, seasons: ss.length ? `${ss[0]} to ${ss[ss.length - 1]}` : null, season_count: ss.length, rows, latest: ss.length ? { season: ss[ss.length - 1], rows: v.seasons[ss[ss.length - 1]].rows, through: v.seasons[ss[ss.length - 1]].through || null } : null, ...(v.note && sport ? { note: v.note } : {}) }
        L.push(`- ${t}: one row per ${v.row}; ${ss.length ? `${ss[0]}${ss.length > 1 ? ` to ${ss[ss.length - 1]}` : ''}` : 'no seasons yet'}; ${rows.toLocaleString('en-US')} rows${out[s][t].latest?.through ? `, newest ${out[s][t].latest.through}` : ''}.`)
      }
      for (const k of Object.keys(STAT_DICTS).filter((k) => k.startsWith(`${s}:`))) L.push(`- ${k.split(':')[1]}: the definitions of the ${k.includes('coaching') ? 'coach-page' : 'player-page'} stats (savant_dictionary(${s}, ${k.split(':')[1]}))`)
      L.push('')
    }
    L.push(`Source: ${SOURCE}.`)
    return { structured: { sports: out, stat_dictionaries: Object.keys(STAT_DICTS).filter((k) => !sport || k.startsWith(`${sport}:`)), source: SOURCE }, text: L.join('\n') }
  }
  if (!sport) throw new SavantError('Give the sport with the table.')
  const statKey = `${sport}:${table}`
  if (STAT_DICTS[statKey]) {
    const r = await STAT_DICTS[statKey]()
    return { structured: { sport, table, ...r.structured }, text: r.text }
  }
  const tables = (cat.sports || {})[sport] || {}
  const entry = tables[table]
  if (!entry) throw new SavantError(`No ${sport} table "${table}". Tables: ${[...Object.keys(tables), ...Object.keys(STAT_DICTS).filter((k) => k.startsWith(`${sport}:`)).map((k) => k.split(':')[1])].join(', ')}.`)
  const ss = Object.keys(entry.seasons || {}).sort()
  const base = { sport, table, row: entry.row, first_season: entry.first_season, seasons: ss, rows_by_season: Object.fromEntries(ss.map((s) => [s, entry.seasons[s].rows])), url: pageUrl(entry.page), source: SOURCE }
  const legacy = (LEGACY[sport] || {})[table]
  if (!legacy) {
    const d = (await dictionary()).sports[sport][table]
    const L = [`${sport} ${table}: one row per ${entry.row}, ${ss[0]} to ${ss[ss.length - 1]}. ${d.note}`, '', 'Columns (name — what; unit; source; first season; caveat):',
      ...Object.entries(d.columns).map(([c, v]) => `- ${c} — ${v.what}; ${v.unit || '—'}; ${v.source}${v.since != null ? `; from ${v.since}` : ''}${v.caveat ? `; ${v.caveat}` : ''}`), '', `Page: ${base.url}. Source: ${SOURCE}.`]
    return { structured: { ...base, note: d.note, columns: d.columns }, text: L.join('\n') }
  }
  if (legacy.src === 'cbb') {
    const r = await cbbDictionary()
    return { structured: { ...base, definition: CBB_DEFS[legacy.table], stats_dictionary: `savant_dictionary(cbb, stats): ${r.structured.stats.length} player stats` }, text: `cbb ${table}: ${CBB_DEFS[legacy.table]} Seasons ${ss[0]} to ${ss[ss.length - 1]}. ${legacy.table === 'games' ? '' : 'Kept per team-season: savant_data needs team. '}The stat keys and definitions: savant_dictionary(cbb, stats). Source: ${SOURCE}.` }
  }
  const r = legacy.src === 'bcs' ? await bcsDictionary({ table: legacy.table }) : await cbcsDictionary({ table: legacy.table })
  return { structured: { ...base, ...r.structured, sport, table }, text: r.text }
}

// ---- the tools -------------------------------------------------------------------------------
const filterShape = z.object({ column: z.string(), op: z.enum(OPS), value: z.any().optional() })
const open = z.object({}).passthrough()

export const tools = [
  {
    name: 'savant_dictionary',
    config: {
      title: 'Read the WCE Data Room catalog and column definitions',
      description: 'The catalog of the WCE Data Room (wcehoops.com): every sport\'s tables (NBA player-games, shots and coaching tables; NFL plays, player-games and team-games; college football plays and team-games; college basketball games, player-games, units, possessions and coaching tables; UFC fights and rounds), what one row is, the seasons covered and row counts. With a sport and table: every column\'s definition, unit, source, first season and caveat. Also the page-stat dictionaries: cbb stats (the keys cbb_leaderboard takes), nba and cbb coaching_stats. Read before savant_data.',
      inputSchema: {
        sport: z.enum(SPORTS).optional().describe('nba, nfl, cfb, cbb or ufc; omit for every sport.'),
        table: z.string().trim().min(1).max(40).optional().describe('A table from the catalog, or stats / coaching_stats.'),
      },
      // An open shape: a table's answer carries its columns, a page-stat dictionary its stats and fits.
      outputSchema: z.object({ sports: open.optional(), stat_dictionaries: z.array(z.string()).optional(), sport: z.string().optional(), table: z.string().optional(), row: z.string().optional(), columns: z.any().optional(), seasons: z.array(z.string()).optional(), url: z.string().optional(), source: z.string().optional() }).passthrough(),
      annotations: { title: 'Read the WCE Data Room catalog and column definitions', ...READ_ONLY },
    },
    run: (args) => savantDictionary(args),
  },
  {
    name: 'savant_data',
    config: {
      title: 'Pull rows from the WCE Data Room',
      description: 'Raw rows behind every Savant on wcehoops.com, for your own splits, comparisons and regressions: one season of one table (savant_dictionary lists them), filtered on any column, chosen columns, sorted, paged 500 rows a call. Every answer gives the returned columns\' definitions, the rows that match, the next offset, "data through" (the newest row of that season) and the page link. Coaching tables sit under their sport (nba coaching_games, cbb coaching_programs). College basketball player_games, units and possessions need a team.',
      inputSchema: {
        sport: z.enum(SPORTS).describe('nba, nfl, cfb, cbb or ufc.'),
        table: z.string().trim().min(1).max(40).describe('A table from savant_dictionary, e.g. plays, player_games, shots, fights, coaching_games.'),
        season: z.string().trim().max(9).optional().describe('NBA and college basketball "2024-25"; NFL, college football "2025"; UFC a year. Default: the newest.'),
        team: z.string().trim().min(2).max(60).optional().describe('College basketball team-season tables only.'),
        filters: z.array(filterShape).max(12).default([]).describe('{column, op, value}; ops eq, ne, in, gte, lte, gt, lt (numbers, and dates as YYYY-MM-DD), contains, null, notnull.'),
        columns: z.array(z.string()).max(80).optional().describe('Columns to return (default all).'),
        sort: z.string().max(40).optional().describe('One column to sort by.'),
        descending: z.boolean().default(false).describe('Sort high to low.'),
        limit: z.number().int().min(1).max(MAX_ROWS).default(100).describe('Rows per call.'),
        offset: z.number().int().min(0).default(0).describe('Row to start at.'),
      },
      outputSchema: { sport: z.string(), table: z.string(), season: z.string().nullable(), row: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.any())), total_matching: z.number().int(), offset: z.number().int(), limit: z.number().int(), next_offset: z.number().int().nullable(), definitions: open, note: z.string().optional(), legend: z.any().optional(), data_through: z.string().nullable(), url: z.string(), source: z.string() },
      annotations: { title: 'Pull rows from the WCE Data Room', ...READ_ONLY },
    },
    run: (args) => savantData(args),
  },
]

