#!/usr/bin/env node
// pipeline/dataroom/parquet.mjs — Parquet copies of the Data Room's tables, for the analysis engine
// (savant_sql / savant_analyze, api/_sql.js; research/analysis/BUILD.md §2).
//
//   node pipeline/dataroom/parquet.mjs <sport> <table> [season ...] [--all] [--out out/parquet]
//
// The JSON files stay exactly as they are (savant_data reads them); this writes a second copy of
// each season, one Parquet file per sport, table and season, sorted so the usual filters skip the
// most data (date first, then team, then player), statistics on, ~64k-row groups, zstd.
//
// THE ROWS ARE THE JSON'S ROWS. Each season is read the way savant_data reads it (the same file, or
// for the older site tables the same loader), so the copy cannot drift from what the connector
// already serves; a `season` column is added in front. After writing, the file is read back and
// checked against the JSON: the same row count, then the same checksum of the sorted rows
// (checksum() below). A season that fails is not kept.
//
// TYPES. One schema per table, shared by every season (the engine's view is a UNION ALL of the
// seasons, so their columns must line up). It lives in public/dataroom/parquet.json.gz with each
// season's rows, bytes and newest date, and is inferred once over every season (--all) and then
// held: a refresh of one season writes to the stored schema, and a value that does not fit it
// fails that season loudly instead of quietly changing a type.
//   integers -> BIGINT, other numbers -> DOUBLE, true/false -> BOOLEAN, YYYY-MM-DD -> DATE,
//   arrays and objects -> VARCHAR holding their JSON, anything else (or a mix) -> VARCHAR.
//
// Disk and memory: one season at a time, written and checked, then dropped.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { DuckDBInstance } from '@duckdb/node-api'
import { SOURCES, sourceFor } from './parquet_sources.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const MANIFEST = path.join(ROOT, 'public/dataroom/parquet.json.gz')
const ROW_GROUP = 65536
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Sort keys per table: season is the file; then date, team, player, and whatever keeps a game's
// plays in order. Columns a table lacks are skipped.
export const SORT = {
  'nfl.plays': ['date', 'posteam', 'game_id', 'play_id'],
  'nfl.player_games': ['date', 'team', 'player_id'],
  'nfl.games': ['date', 'team'],
  'nba.player_games': ['date', 'team', 'player_id'],
  'nba.shots': ['date', 'team', 'player_id', 'game_id', 'event_id'],
  'cfb.plays': ['date', 'offense_id', 'game_id', 'play_id'],
  'cfb.games': ['date', 'team_id'],
  'ufc.fights': ['date', 'fighter_id', 'fight_id'],
  'ufc.rounds': ['date', 'fighter_id', 'fight_id', 'round'],
}
const DEFAULT_SORT = ['date', 'game_date', 'team', 'team_id', 'player_id', 'coach_id', 'gid', 'game_id']

// ---- types ---------------------------------------------------------------------------------------
const kindOf = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return 'BOOLEAN'
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? 'BIGINT' : 'DOUBLE'
  if (typeof v === 'string') return DATE_RE.test(v) ? 'DATE' : 'VARCHAR'
  return 'JSON'
}
// Two kinds meeting in one column: numbers widen to DOUBLE, everything else to VARCHAR.
function widen(a, b) {
  if (!a) return b
  if (!b || a === b) return a
  if ((a === 'BIGINT' && b === 'DOUBLE') || (a === 'DOUBLE' && b === 'BIGINT')) return 'DOUBLE'
  if (a === 'JSON' || b === 'JSON') return 'JSON'
  return 'VARCHAR'
}
export function inferKinds(columns, rows, kinds = {}) {
  for (let j = 0; j < columns.length; j++) {
    let k = kinds[columns[j]] || null
    for (let i = 0; i < rows.length; i++) { const v = rows[i][j]; if (v !== null && v !== undefined) k = widen(k, kindOf(v)) }
    kinds[columns[j]] = k
  }
  return kinds
}
// The SQL type a kind is stored as. A column that is null in every season is VARCHAR (it says so in
// the dictionary: e.g. NBA shots `assisted`).
export const sqlType = (k) => (k === 'JSON' || !k ? 'VARCHAR' : k)

// ---- the checksum both sides are held to --------------------------------------------------------
// Every value is written as text by its stored kind, so a JSON 3 and a Parquet BIGINT 3 agree, a
// DOUBLE is compared at full precision (JS's shortest round-trip form on both sides), and a JSON
// array is compared as the JSON the column stores. Rows are sorted as text, then hashed.
export function canon(kind, v) {
  if (v === null || v === undefined) return '\u0000'
  switch (kind) {
    case 'BIGINT': return typeof v === 'bigint' ? v.toString() : String(Math.trunc(Number(v))) === String(v) ? String(v) : `!${v}`
    case 'DOUBLE': return String(Number(v))
    case 'BOOLEAN': return v === true || v === 'true' ? 't' : 'f'
    case 'DATE': return String(v).slice(0, 10)
    case 'JSON': return typeof v === 'string' ? v : JSON.stringify(v)
    default: return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}
export function checksum(kinds, rows) {
  const lines = rows.map((r) => r.map((v, j) => canon(kinds[j], v)).join('\u0001'))
  lines.sort()
  const h = createHash('sha256')
  for (const l of lines) h.update(l).update('\n')
  return h.digest('hex')
}

// ---- writing one season ------------------------------------------------------------------------
const q = (name) => `"${String(name).replace(/"/g, '""')}"`

function append(appender, kind, v) {
  if (v === null || v === undefined) return appender.appendNull()
  switch (kind) {
    case 'BIGINT': return appender.appendBigInt(BigInt(v))
    case 'DOUBLE': return appender.appendDouble(Number(v))
    case 'BOOLEAN': return appender.appendBoolean(Boolean(v))
    case 'DATE': return appender.appendVarchar(String(v)) // cast on insert (the staging column is VARCHAR)
    case 'JSON': return appender.appendVarchar(typeof v === 'string' ? v : JSON.stringify(v))
    default: return appender.appendVarchar(typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
}

// Check a value fits the stored kind before it is written (a refresh must not change a type).
function fits(kind, v) {
  if (v === null || v === undefined) return true
  const k = kindOf(v)
  if (k === kind) return true
  if (kind === 'DOUBLE' && k === 'BIGINT') return true
  if (kind === 'VARCHAR' || kind === 'JSON') return true   // text holds anything (arrays as their JSON)
  return false
}

export async function writeSeason(con, { sport, table, season, columns, rows, kinds, out, prepend = true }) {
  const key = `${sport}.${table}`
  const all = prepend ? ['season', ...columns] : columns.slice()
  const k = prepend ? ['VARCHAR', ...columns.map((c) => kinds[c])] : columns.map((c) => kinds[c])
  for (let j = 0; j < columns.length; j++) {
    const kind = kinds[columns[j]]
    for (let i = 0; i < rows.length; i++) if (!fits(kind || 'VARCHAR', rows[i][j])) throw new Error(`${key} ${season}: column ${columns[j]} holds ${JSON.stringify(rows[i][j])}, which is not ${kind}. Widen the stored schema (--all) on purpose.`)
  }
  await con.run('DROP TABLE IF EXISTS stage')
  // Staging columns: DATE goes in as text and is cast when copied out.
  await con.run(`CREATE TABLE stage (${all.map((c, j) => `${q(c)} ${k[j] === 'DATE' ? 'VARCHAR' : sqlType(k[j])}`).join(', ')})`)
  const ap = await con.createAppender('stage')
  const o = prepend ? 1 : 0
  for (const r of rows) {
    if (prepend) ap.appendVarchar(season)
    for (let j = 0; j < columns.length; j++) append(ap, k[j + o], r[j])
    ap.endRow()
  }
  ap.closeSync()
  const sortCols = (SORT[key] || DEFAULT_SORT).filter((c) => columns.includes(c))
  const select = all.map((c, j) => (k[j] === 'DATE' ? `CAST(${q(c)} AS DATE) AS ${q(c)}` : q(c))).join(', ')
  mkdirSync(path.dirname(out), { recursive: true })
  const tmp = `${out}.tmp`
  await con.run(`COPY (SELECT ${select} FROM stage${sortCols.length ? ` ORDER BY ${sortCols.map(q).join(', ')}` : ''}) TO '${tmp.replace(/'/g, "''")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${ROW_GROUP})`)
  await con.run('DROP TABLE stage')

  // Read it back and hold it to the JSON.
  const back = await con.runAndReadAll(`SELECT * FROM read_parquet('${tmp.replace(/'/g, "''")}')`)
  const got = back.getRows()
  const want = prepend ? rows.map((r) => [season, ...r]) : rows
  if (got.length !== want.length) { rmSync(tmp); throw new Error(`${key} ${season}: ${got.length} rows read back, ${want.length} in the JSON`) }
  const toJs = (v) => (v && typeof v === 'object' && typeof v.toString === 'function' && !(Array.isArray(v)) ? v.toString() : v)
  const a = checksum(k, want), b = checksum(k, got.map((r) => r.map(toJs)))
  if (a !== b) { rmSync(tmp); throw new Error(`${key} ${season}: the read-back checksum differs from the JSON's`) }
  // Each column's compressed size, for the engine's scan budget (api/_sql.js planBytes).
  const sizes = await con.runAndReadAll(`SELECT path_in_schema, sum(total_compressed_size) FROM parquet_metadata('${tmp.replace(/'/g, "''")}') GROUP BY 1`)
  const colBytes = Object.fromEntries(sizes.getRows().map(([c, b]) => [String(c), Number(b)]))
  renameSync(tmp, out)
  return { rows: rows.length, bytes: statSync(out).size, sha256: a, colBytes, fileSha: createHash('sha256').update(readFileSync(out)).digest('hex') }
}

// ---- the manifest ----------------------------------------------------------------------------
export function readManifest(file = MANIFEST) {
  if (!existsSync(file)) return { schema: 1, note: 'Parquet copies of the Data Room tables, for savant_sql and savant_analyze. Written by pipeline/dataroom/parquet.mjs.', tables: {} }
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'))
}
export function writeManifest(m, file = MANIFEST) {
  const sorted = { ...m, tables: Object.fromEntries(Object.entries(m.tables).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, seasons: Object.fromEntries(Object.entries(v.seasons).sort(([a], [b]) => a.localeCompare(b))) }])) }
  writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 }))
}
export const parquetName = (sport, table, season) => `${sport}-${table}-${season}.parquet`

// ---- the command -------------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2)
  const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
  const out = path.resolve(ROOT, flag('--out') || 'out/parquet')
  const all = argv.includes('--all'); if (all) argv.splice(argv.indexOf('--all'), 1)
  const verify = argv.includes('--verify'); if (verify) argv.splice(argv.indexOf('--verify'), 1)
  if (verify) return verifyAll(argv, out)
  const [sport, table, ...only] = argv
  if (!sport || !table) { console.error(`usage: parquet.mjs <sport> <table> [season ...] [--all]\ntables: ${Object.keys(SOURCES).join(', ')}`); process.exit(2) }
  const key = `${sport}.${table}`
  const src = sourceFor(sport, table)
  const manifest = readManifest()
  const seasons = only.length ? only : await src.seasons()
  const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '2GB' })
  const con = await db.connect()

  let entry = manifest.tables[key]
  if (all || !entry) {
    // Infer the schema over every season the source has, one season in memory at a time.
    const kinds = {}
    let columns = null
    for (const s of await src.seasons()) {
      const t = await src.read(s)
      if (!columns) columns = t.columns.slice()
      for (const c of t.columns) if (!columns.includes(c)) columns.push(c)
      const local = inferKinds(t.columns, t.rows)
      for (const [c, v] of Object.entries(local)) kinds[c] = widen(kinds[c] || null, v)
    }
    // A table with its own season column: where it always equals the file's season it is dropped (the
    // added `season` is the same value); where it varies (coaching_programs, one file of every season)
    // it is kept as the season and nothing is added.
    let ownSeason = false
    if (columns.includes('season')) {
      for (const s of await src.seasons()) {
        const t = await src.read(s); const i = t.columns.indexOf('season')
        if (t.rows.some((r) => String(r[i]) !== s)) { ownSeason = true; break }
      }
      if (!ownSeason) columns = columns.filter((c) => c !== 'season')
      else kinds.season = 'VARCHAR'
    }
    entry = { columns: columns.map((c) => [c, kinds[c] || null]), own_season: ownSeason, ...(src.row ? { analysis_only: true, row: src.row, note: src.note } : {}), sort: (SORT[key] || DEFAULT_SORT).filter((c) => columns.includes(c)), seasons: all ? {} : (entry?.seasons || {}) }
    manifest.tables[key] = entry
  }
  const kinds = Object.fromEntries(entry.columns)
  const names = entry.columns.map(([c]) => c)
  let bad = 0
  for (const s of seasons) {
    const t = await src.read(s)
    // Same columns, in the stored order (a column a season lacks is null there).
    const ix = names.map((c) => t.columns.indexOf(c))
    const extra = t.columns.filter((c) => !names.includes(c) && !(c === 'season' && !entry.own_season))
    if (extra.length) { console.error(`::warning::${key} ${s}: columns not in the stored schema: ${extra.join(', ')} (run with --all)`); bad++; continue }
    const si = t.columns.indexOf('season')
    if (!entry.own_season && si >= 0 && t.rows.some((r) => String(r[si]) !== s)) { console.error(`::warning::${key} ${s}: its season column no longer always equals ${s} (run with --all)`); bad++; continue }
    const rows = t.rows.map((r) => ix.map((i) => (i < 0 ? null : r[i] === undefined ? null : r[i])))
    try {
      const r = await writeSeason(con, { sport, table, season: s, columns: names, rows, kinds, out: path.join(out, parquetName(sport, table, s)), prepend: !entry.own_season })
      let through = null
      const di = names.indexOf('date')
      if (di >= 0) for (const row of rows) if (row[di] && (!through || row[di] > through)) through = row[di]
      entry.seasons[s] = { rows: r.rows, bytes: r.bytes, sha256: r.sha256, file_sha256: r.fileSha, through: t.through || through || null, col_bytes: r.colBytes }
      console.log(`${key} ${s}: ${r.rows} rows, ${(r.bytes / 1e6).toFixed(2)} MB, checksum ok`)
    } catch (e) { console.error(`::warning::${e.message}`); bad++ }
  }
  writeManifest(manifest)
  con.closeSync?.()
  if (bad) process.exitCode = 1
}

// --verify [sport table]: every season's Parquet file read back and held to its JSON as it is now (the row
// count, then the checksum of the sorted rows) and to the manifest. Nothing is written.
async function verifyAll(argv, out) {
  const manifest = readManifest()
  const keys = argv.length >= 2 ? [`${argv[0]}.${argv[1]}`] : Object.keys(manifest.tables)
  const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '2GB' })
  const con = await db.connect()
  let bad = 0, n = 0
  for (const key of keys) {
    const [sport, table] = key.split('.')
    const entry = manifest.tables[key]
    const src = sourceFor(sport, table)
    const names = entry.columns.map(([c]) => c)
    const kinds = entry.own_season ? names.map((c) => Object.fromEntries(entry.columns)[c]) : ['VARCHAR', ...names.map((c) => Object.fromEntries(entry.columns)[c])]
    let ok = 0
    for (const s of Object.keys(entry.seasons).sort()) {
      n++
      const t = await src.read(s)
      const ix = names.map((c) => t.columns.indexOf(c))
      const rows = t.rows.map((r) => { const x = ix.map((i) => (i < 0 ? null : r[i] === undefined ? null : r[i])); return entry.own_season ? x : [s, ...x] })
      const file = path.join(out, parquetName(sport, table, s)).replace(/'/g, "''")
      const back = (await con.runAndReadAll(`SELECT * FROM read_parquet('${file}')`)).getRows().map((r) => r.map((v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v.toString === 'function' ? v.toString() : v)))
      const a = checksum(kinds, rows), b = checksum(kinds, back)
      const why = back.length !== rows.length ? `${back.length} Parquet rows, ${rows.length} JSON rows` : a !== b ? 'checksums differ' : a !== entry.seasons[s].sha256 ? 'the JSON has changed since the Parquet was written (rewrite it)' : null
      if (why) { bad++; console.error(`::warning::${key} ${s}: ${why}`) } else ok++
    }
    console.log(`${key}: ${ok} of ${Object.keys(entry.seasons).length} seasons identical`)
  }
  console.log(`${n - bad} of ${n} season files identical to their JSON`)
  if (bad) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
