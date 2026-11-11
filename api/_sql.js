// api/_sql.js — the analysis engine behind savant_sql and savant_analyze (WCE Pro, founder tier;
// research/analysis/BUILD.md). Read-only SQL over every Data Room table, run on WCE's server so a
// whole-league question is one call instead of thousands of savant_data pages.
//
// THE ENGINE
// DuckDB (@duckdb/node-api), in this function, reading the Parquet copies of the Data Room tables
// (pipeline/dataroom/parquet.mjs) straight off the GitHub release with HTTP range requests: a query
// reads only the columns and row groups it needs. One schema per sport (nba, nfl, cfb, cbb, ufc), one
// view per table over all its seasons. Each season's URL carries `?p=/season=<s>/`, which GitHub
// ignores and DuckDB reads as a hive partition, so `WHERE season = '2024-25'` skips the other
// seasons' files without opening them (measured: research/analysis/BUILD.md §1, ANALYSIS.md).
//
// THE LOCKS (the AI writes the SQL, so the SQL is untrusted)
//   1. Before the engine sees it (checkSql): one statement; it must serialize as a SELECT
//      (json_serialize_sql refuses anything else: INSERT, CREATE, COPY, ATTACH, SET, PRAGMA, INSTALL,
//      LOAD ...); every table it names must be a Data Room view or one of its own CTEs; the only table
//      functions are range, generate_series and unnest; system and file functions are refused by name.
//   2. The engine itself: external access off, with an allowlist of exactly the Data Room files (and
//      the profiler's own output file); extensions can't be installed, loaded or autoloaded;
//      configuration locked once set up; a memory limit and a thread count that fit the function.
//      Even SQL that got past (1) cannot read another URL or path, or change a setting.
//   3. Limits: 500 rows returned (and how many there were), a wall-time cap with an interrupt, a
//      scan budget checked from the plan before anything is read, and one query at a time per copy.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { SavantError, day, makeLoader } from './_core.js'
import { assetBase } from './_dataroom.js'

export const SCHEMAS = ['nba', 'nfl', 'cfb', 'cbb', 'ufc']
export const MAX_ROWS = 500
const MAX_SQL = 20000
export const LIMITS = {
  wallMs: Number(process.env.SQL_WALL_MS) || 22000,       // the function's limit is 30 s (vercel.json)
  memory: process.env.SQL_MEMORY || '1GB',                // the function has 2 GB
  threads: Number(process.env.SQL_THREADS) || 4,          // I/O-bound over HTTP: more threads than cores pays
  scanBytes: Number(process.env.SQL_SCAN_BYTES) || 25e6,  // compressed column bytes a scan may plan to read: SELECT * over every season of NFL plays (39 MB), CFB plays (40), NFL player-games (28) or NBA shots (57) is past it; a handful of columns league-wide is well inside
  engineTtlMs: 10 * 60 * 1000,                            // a fresh engine every 10 minutes: replaced files, new seasons
}
const TABLE_FUNCTIONS = new Set(['range', 'generate_series', 'unnest'])
// Functions refused by name, whatever the engine would make of them: files, URLs, settings, the
// catalog, SQL-in-a-string, extensions, secrets.
const DENY = /^(read_|parquet_|glob$|getenv$|current_setting$|duckdb_|pragma_|sniff_csv$|query$|query_table$|iceberg|delta_|which_secret$|load_extension|install_extension|enable_|disable_|checkpoint$|force_checkpoint$|export_|import_|json_execute_serialized_sql$|json_deserialize_sql$|json_serialize_sql$|json_serialize_plan$|setseed$|sql_auto_complete$|ducklake|http_|s3_|gcs_|azure_|postgres_|mysql_|sqlite_|current_database$|current_schemas?$|current_catalog$|pg_|has_.*_privilege$|txid_current$|nextval$|currval$|finalize$|combine$|test_|stats$|icu_|summary$|repeat$|repeat_row$|version$|platform$|current_user$|session_user$|user$|current_role$)/i

// ---- the manifest: tables, columns, seasons ----------------------------------------------------
const room = makeLoader('dataroom', { what: 'The Data Room', maxCached: 4, shape: (b) => b && typeof b === 'object' && b.tables })
function bundledManifest() {
  const p = path.join(process.cwd(), 'public', 'dataroom', 'parquet.json.gz')
  return existsSync(p) ? JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) : null
}
export async function manifest() {
  try { return await room.load('parquet.json') } catch { const b = bundledManifest(); if (b) return b; throw new SavantError('The analysis tables could not be read right now. Try again in a minute.') }
}
export const parquetUrl = (sport, table, season) => `${assetBase()}/${sport}-${table}-${season}.parquet?p=/season=${season}/`

// ---- the engine --------------------------------------------------------------------------------
let current = null   // { at, db, con, profile, tables, ready }
let queue = Promise.resolve()
export const stats = { engines: 0, lastSetupMs: null }

const CA_BUNDLES = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem', '/etc/ssl/cert.pem']
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`

async function setup() {
  const t0 = Date.now()
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const m = await manifest()
  const tmp = process.env.SQL_TMP || '/tmp'
  const extDir = path.join(tmp, 'wce-duckdb-ext')
  const profile = path.join(tmp, `wce-sql-profile-${process.pid}-${stats.engines}.json`)
  const db = await DuckDBInstance.create(':memory:', {
    threads: String(LIMITS.threads),
    memory_limit: LIMITS.memory,
    max_temp_directory_size: '0B',          // never spill to /tmp: a query past the memory cap fails, cleanly
    extension_directory: extDir,
    home_directory: tmp,                    // the function's home is read-only; /tmp is its one writable place
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    allow_community_extensions: 'false',
    allow_unsigned_extensions: 'false',
    allow_persistent_secrets: 'false',      // no secrets directory to read (or to be locked out of)
  })
  const con = await db.connect()
  // httpfs is the one extension: DuckDB's own signed build, fetched once per copy into /tmp.
  try { await con.run('LOAD httpfs') } catch { await con.run('INSTALL httpfs'); await con.run('LOAD httpfs') }
  const urls = []
  const tables = {}
  for (const sport of SCHEMAS) await con.run(`CREATE SCHEMA ${sport}`)
  for (const [key, t] of Object.entries(m.tables)) {
    const [sport, table] = key.split('.')
    const seasons = Object.keys(t.seasons).sort()
    if (!seasons.length) continue
    // Newest first: DuckDB takes a view's columns from the first file's footer, so a question about the
    // season in progress (the commonest) opens one file, and any other season opens two footers at most.
    const list = seasons.slice().reverse().map((s) => parquetUrl(sport, table, s))
    urls.push(...list)
    // A table that carries its own season column (coaching_programs: one file, every season) is read as it is.
    const hive = t.own_season ? '' : ", hive_partitioning = true, hive_types = {'season': VARCHAR}"
    // The view is made the first time a query names the table (ensureViews): making it reads a footer
    // over HTTP, and 26 of them up front cost 3 to 8 seconds of every new copy's first call.
    tables[key] = { sport, table, seasons, view: `CREATE VIEW ${sport}.${ident(table)} AS SELECT * FROM read_parquet([${list.map(sqlStr).join(', ')}]${hive})`, made: false, columns: t.columns.map(([c, k]) => [c, k === 'JSON' || !k ? 'VARCHAR' : k]), through: Object.fromEntries(seasons.map((s) => [s, t.seasons[s].through || null])), rows: Object.fromEntries(seasons.map((s) => [s, t.seasons[s].rows])), bytes: Object.fromEntries(seasons.map((s) => [s, t.seasons[s].bytes])), colBytes: Object.fromEntries(seasons.map((s) => [s, t.seasons[s].col_bytes || null])) }
  }
  // httpfs sets up its secret storage on first use; do it now, before the lock, since views are made later.
  await con.run('SELECT count(*) FROM duckdb_secrets()')
  // HTTPS needs the system's CA bundle, read when a connection is first made, which is now after the lock:
  // the one file outside the Data Room the engine may read (public certificates, nothing of WCE's).
  const ca = CA_BUNDLES.find((f) => existsSync(f))
  if (ca) await con.run(`SET ca_cert_file = ${sqlStr(ca)}`)
  for (const s of [
    'SET enable_http_metadata_cache = true',
    'SET parquet_metadata_cache = true',
    'SET http_timeout = 15000',
    'SET http_retries = 2',
    "SET enable_profiling = 'json'",
    `SET profiling_output = ${sqlStr(profile)}`,
    'SET preserve_insertion_order = false',
    `SET allowed_paths = [${[...urls, profile, ...(ca ? [ca] : [])].map(sqlStr).join(', ')}]`,
    'SET enable_external_access = false',
    'SET lock_configuration = true',
  ]) await con.run(s)
  stats.engines++
  stats.lastSetupMs = Date.now() - t0
  return { at: Date.now(), db, con, profile, tables, setupMs: Date.now() - t0 }
}

async function engine() {
  if (current && Date.now() - current.at < LIMITS.engineTtlMs) return current.ready
  const old = current
  const ready = setup()
  current = { at: Date.now(), ready }
  ready.catch(() => { if (current && current.ready === ready) current = null })
  if (old) old.ready.then((e) => { try { e.con.closeSync(); e.db.closeSync?.() } catch { /* already gone */ } }).catch(() => {})
  return ready
}
export function resetEngine() { current = null }
// The locked engine itself, for tools/analysis/check.mjs: SQL sent here skips checkSql, to prove the
// engine's own locks hold without it. Nothing in the connector calls it.
export const _engineForTests = () => engine()

// Make the views a query names (once per engine), each reading one footer. On the engine's own
// connection, one after another: views made on parallel connections race in httpfs's secret storage
// ("Secret Storage with name 'memory' already registered", DuckDB 2.0).
async function ensureViews(e, used) {
  for (const t of used.map((k) => e.tables[k]).filter((x) => x && !x.made)) {
    try { await e.con.run(t.view) } catch (err) { if (!/already exists/i.test(String(err.message))) throw err }
    t.made = true
  }
}

// One query at a time per copy of the function: it has one CPU, and the profiler writes one file.
function serial(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

// ---- checking the SQL before the engine runs it -----------------------------------------------
function walk(node, visit) {
  if (Array.isArray(node)) { for (const x of node) walk(x, visit); return }
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

export async function checkSql(con, sql, tables) {
  if (typeof sql !== 'string' || !sql.trim()) throw new SavantError('Give the SQL to run: one SELECT (or WITH … SELECT) statement.')
  if (sql.length > MAX_SQL) throw new SavantError(`That SQL is ${sql.length.toLocaleString('en-US')} characters; the limit is ${MAX_SQL.toLocaleString('en-US')}.`)
  let n
  try { n = (await con.extractStatements(sql)).count } catch (e) { throw new SavantError(`That SQL does not parse: ${clean(e.message)}`) }
  if (n !== 1) throw new SavantError(`One statement per call (this has ${n}). Only SELECT and WITH … SELECT are allowed.`)
  const r = await con.runAndReadAll('SELECT json_serialize_sql($1::VARCHAR)', [sql])
  const ast = JSON.parse(r.getRows()[0][0])
  if (ast.error) {
    const msg = String(ast.error_message || '')
    if (/only select/i.test(msg) || /not.*serializ/i.test(msg)) throw new SavantError('Read-only: only a single SELECT (or WITH … SELECT) statement is allowed. Writes, COPY, ATTACH, INSTALL, LOAD, SET and PRAGMA are refused.')
    throw new SavantError(`That SQL does not parse: ${clean(msg)}`)
  }
  if (!Array.isArray(ast.statements) || ast.statements.length !== 1) throw new SavantError('One SELECT statement per call.')
  const ctes = new Set()
  walk(ast, (x) => { if (x.cte_map && Array.isArray(x.cte_map.map)) for (const e of x.cte_map.map) if (e && e.key) ctes.add(String(e.key).toLowerCase()) })
  const used = new Set()
  const problems = []
  walk(ast, (x) => {
    if (x.type === 'BASE_TABLE') {
      const schema = String(x.schema_name || '').toLowerCase(), name = String(x.table_name || '').toLowerCase(), cat = String(x.catalog_name || '').toLowerCase()
      if (cat && cat !== 'memory') problems.push(`"${x.catalog_name}.${schema}.${name}" (no other databases)`)
      else if (!schema && ctes.has(name)) { /* its own CTE */ }
      else if (tables[`${schema}.${name}`]) used.add(`${schema}.${name}`)
      else problems.push(schema ? `${schema}.${name}` : name)
    } else if (x.type === 'TABLE_FUNCTION') {
      const fn = x.function && (x.function.function_name || '')
      if (!TABLE_FUNCTIONS.has(String(fn).toLowerCase())) problems.push(`${fn}() (table functions allowed: ${[...TABLE_FUNCTIONS].join(', ')})`)
    }
    if (typeof x.function_name === 'string' && (DENY.test(x.function_name) || (x.schema && !['', 'main'].includes(String(x.schema).toLowerCase()) && x.class === 'FUNCTION'))) problems.push(`${x.function_name}() (not available here)`)
  })
  if (problems.length) {
    const uniq = [...new Set(problems)]
    throw new SavantError(`Only the Data Room tables can be read. Not allowed: ${uniq.slice(0, 6).join(', ')}. Tables are <sport>.<table>, e.g. nba.shots, nfl.plays, cfb.games, cbb.player_games, ufc.fights (savant_dictionary lists them all).`)
  }
  return [...used]
}

const clean = (m) => String(m || '').replace(/\s+/g, ' ').replace(/https?:\/\/\S+/g, '<file>').replace(/\/(tmp|var|private)\/\S+/g, '<path>').slice(0, 400)

// ---- the scan budget, from the plan --------------------------------------------------------------
// EXPLAIN binds the query (reading only Parquet footers, which the next run needs anyway) and names
// each scan's files and columns. Their compressed size, from the manifest, is what the query would
// read at most; past the budget the query is refused with a way to narrow it.
async function planBytes(e, sql, used) {
  const r = await e.con.runAndReadAll(`EXPLAIN (FORMAT json) ${sql}`)
  const plan = JSON.parse(r.getRows()[0][1])
  let bytes = 0
  walk(plan, (x) => {
    const info = x.extra_info
    if (!info || !/READ_PARQUET/i.test(String(info.Function || x.name || ''))) return
    const proj = [].concat(info.Projections || []).flatMap((p) => String(p).split('\n')).map((p) => p.trim()).filter(Boolean)
    const filt = String(info.Filters || '')
    const m = String(info['Scanning Files'] || '').match(/(\d+)\s*\/\s*(\d+)/)
    // Which table this scan is: one the query names, with that many seasons, holding those columns.
    const fits = used.map((k) => e.tables[k]).filter((t) => (!m || t.seasons.length === +m[2]) && proj.every((c) => c === 'season' || t.columns.some(([n]) => n === c)))
    // The columns the scan reads (its projections and filters), at their compressed size in the files
    // it does not skip. DuckDB fetches in larger ranges than one column chunk, so the bytes it really
    // reads run higher on a narrow scan (ANALYSIS.md); the budget is about wide scans, where this is close.
    let most = 0
    for (const t of fits) {
      const cols = t.columns.map(([n]) => n).filter((c) => proj.includes(c) || new RegExp(`\\b${c}\\b`).test(filt))
      let total = 0
      for (const s of t.seasons) { const cb = t.colBytes[s]; total += cb ? (cols.length ? cols : Object.keys(cb)).reduce((n, c) => n + (cb[c] || 0), 0) : t.bytes[s] || 0 }
      most = Math.max(most, m ? (total * +m[1]) / +m[2] : total)
    }
    bytes += most
  })
  return { bytes }
}

// ---- running a query ---------------------------------------------------------------------------
const INT_TYPES = new Set(['BIGINT', 'INTEGER', 'SMALLINT', 'TINYINT', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT', 'UHUGEINT'])
const DEC_TYPES = /^(DECIMAL|DOUBLE|FLOAT|REAL)/
function toJson(v, type) {
  if (v === null || v === undefined) return null
  if (INT_TYPES.has(type) && (typeof v === 'string' || typeof v === 'bigint')) { const n = Number(v); return Number.isSafeInteger(n) ? n : String(v) }
  if (DEC_TYPES.test(type) && typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : v }
  return v
}

// -> { columns, types, rows, total, truncated, tables, scanned, bytes_read, ms }
export async function runSql(sql, { maxRows = MAX_ROWS, wallMs = LIMITS.wallMs, budget = LIMITS.scanBytes } = {}) {
  const t0 = Date.now()
  const e = await engine()
  return serial(async () => {
    const left = () => wallMs - (Date.now() - t0)
    const used = await checkSql(e.con, sql, e.tables)
    await ensureViews(e, used)
    const { JsonDuckDBValueConverter } = await import('@duckdb/node-api')
    let timer = null, timedOut = false
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; try { e.con.interrupt() } catch { /* done */ } }, Math.max(1, left())) }
    try {
      arm()
      const plan = await planBytes(e, sql, used).catch((err) => { if (timedOut) throw err; throw new SavantError(`That SQL could not be planned: ${clean(err.message)}`) })
      if (plan.bytes > budget) {
        throw new SavantError(`That query would read about ${(plan.bytes / 1e6).toFixed(0)} MB of compressed data, past this tool's ${(budget / 1e6).toFixed(0)} MB budget. Narrow it: filter on season (WHERE season = '2024-25', or season IN (...)), name only the columns you need instead of SELECT *, or aggregate in SQL instead of returning rows.`)
      }
      try { rmSync(e.profile, { force: true }) } catch { /* fine */ }
      const result = await e.con.stream(sql)
      const columns = result.columnNames()
      const types = result.columnTypes().map((t) => String(t.toString()).toUpperCase())
      const rows = []
      let total = 0
      for (;;) {
        const chunk = await result.fetchChunk()
        if (!chunk || chunk.rowCount === 0) break
        for (let i = 0; i < chunk.rowCount && rows.length < maxRows; i++) rows.push(chunk.convertRowValues(i, JsonDuckDBValueConverter).map((v, j) => toJson(v, types[j])))
        total += chunk.rowCount
      }
      clearTimeout(timer)
      let prof = null
      try { prof = JSON.parse(readFileSync(e.profile, 'utf8')) } catch { prof = null }
      const scanned = rowsRead(prof)
      return {
        columns, types, rows, total, truncated: total > rows.length, tables: used,
        through: Object.fromEntries(used.map((k) => [k, newest(e.tables[k])])),
        scanned, bytes_read: prof?.io?.total_bytes_read ?? null, planned_bytes: plan.bytes,
        peak_memory: prof?.system?.peak_buffer_memory ?? null,
        ms: Date.now() - t0, setup_ms: e.setupMs,
      }
    } catch (err) {
      clearTimeout(timer)
      throw failure(err, timedOut, wallMs)
    }
  })
}

// What a failed query tells the caller: the engine's own words for a mistake in the SQL, a way to
// narrow it for the limits, and never a path or URL.
function failure(err, timedOut, wallMs) {
  if (err instanceof SavantError) return err
  const msg = String(err && err.message || err)
  if (timedOut || /interrupt/i.test(msg)) return new SavantError(`That query ran past this tool's ${(wallMs / 1000).toFixed(0)}-second limit and was stopped. Narrow it: filter on season or a few seasons, on a team or player, fewer columns, or aggregate first (GROUP BY) instead of returning rows.`)
  if (/out of memory|memory limit|could not allocate|failed to allocate/i.test(msg)) return new SavantError(`That query needed more than this tool's ${LIMITS.memory} of memory and was stopped. Narrow it: fewer seasons, fewer columns, aggregate before joining, or avoid joining two large tables row by row.`)
  if (/permission|disabled by configuration|cannot access|locked/i.test(msg)) return new SavantError('Not allowed: this tool reads only the Data Room tables, and its settings cannot be changed.')
  if (/Binder Error|Catalog Error|Parser Error|Conversion Error|Invalid Input|Not implemented|Out of Range|Type Error/i.test(msg)) return new SavantError(`DuckDB could not run that: ${clean(msg)}`)
  console.error('[sql] query failed:', msg)
  return new SavantError(`The query failed: ${clean(msg)}`)
}

// ---- the studies' way in (api/_analyze.js) ----------------------------------------------------
// The caller's SELECT goes through every lock above, then lands in a temporary in-memory table the
// study reads with its own SQL (sums and products for a regression, cluster totals for a bootstrap),
// so millions of rows never have to cross into JavaScript. Column names the caller gives are checked
// against that table and quoted; nothing the caller wrote is ever pasted into the study's SQL.
let seq = 0
export async function withObservations(sql, fn, { wallMs = LIMITS.wallMs, budget = LIMITS.scanBytes, maxRows = 7e6 } = {}) {
  const t0 = Date.now()
  const e = await engine()
  return serial(async () => {
    const used = await checkSql(e.con, sql, e.tables)
    await ensureViews(e, used)
    const { JsonDuckDBValueConverter } = await import('@duckdb/node-api')
    let timer = null, timedOut = false
    timer = setTimeout(() => { timedOut = true; try { e.con.interrupt() } catch { /* done */ } }, Math.max(1, wallMs - (Date.now() - t0)))
    const name = `obs_${++seq}`
    try {
      const plan = await planBytes(e, sql, used).catch((err) => { if (timedOut) throw err; throw new SavantError(`That SQL could not be planned: ${clean(err.message)}`) })
      if (plan.bytes > budget) throw new SavantError(`That study would read about ${(plan.bytes / 1e6).toFixed(0)} MB of compressed data, past the ${(budget / 1e6).toFixed(0)} MB budget. Narrow its SQL: filter on season, name only the columns the study uses.`)
      try { rmSync(e.profile, { force: true }) } catch { /* fine */ }
      await e.con.run(`CREATE TEMP TABLE ${name} AS SELECT * FROM (${sql}) AS q`)
      let prof = null
      try { prof = JSON.parse(readFileSync(e.profile, 'utf8')) } catch { prof = null }
      const n = Number((await e.con.runAndReadAll(`SELECT count(*) FROM ${name}`)).getRows()[0][0])
      if (n > maxRows) throw new SavantError(`That SQL returns ${n.toLocaleString('en-US')} rows; a study takes at most ${maxRows.toLocaleString('en-US')}. Aggregate in the SQL first (one row per game or per player-game) or filter it.`)
      const cols = (await e.con.runAndReadAll(`DESCRIBE ${name}`)).getRows().map((r) => [String(r[0]), String(r[1]).toUpperCase()])
      const q = async (internal) => {
        const r = await e.con.runAndReadAll(internal.replaceAll('$T', name))
        const types = r.columnTypes().map((t) => String(t.toString()).toUpperCase())
        return { columns: r.columnNames(), rows: r.convertRowsSync ? r.convertRowsSync(JsonDuckDBValueConverter) : r.getRows().map((row) => row.map((v, j) => toJson(jsonish(v), types[j]))) }
      }
      const out = await fn({ name, cols, n, q, ident, deadline: t0 + wallMs })
      clearTimeout(timer)
      return { ...out, tables: used, through: Object.fromEntries(used.map((k) => [k, newest(e.tables[k])])), observations: n, bytes_read: prof?.io?.total_bytes_read ?? null, ms: Date.now() - t0 }
    } catch (err) {
      clearTimeout(timer)
      throw failure(err, timedOut, wallMs)
    } finally {
      try { await e.con.run(`DROP TABLE IF EXISTS ${name}`) } catch { /* the engine is gone */ }
    }
  })
}
const jsonish = (v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v)) : v && typeof v === 'object' && !Array.isArray(v) && typeof v.toDouble === 'function' ? v.toDouble() : v && typeof v === 'object' && !Array.isArray(v) ? String(v) : v)

const newest = (t) => { let best = null; for (const s of t.seasons) { const d = t.through[s]; if (d && (!best || d > best)) best = d } return best ? day(best) : null }

// Rows read from storage: every row of each row group the scans did not skip, from the profile.
function rowsRead(prof) {
  if (!prof) return null
  const q = prof.query || {}
  return { rows_out_of_scans: q.total_rows_scanned ?? null, row_groups_read: q.total_row_groups_scanned ?? null, row_groups_in_files: q.total_row_groups_to_scan ?? null, rows_per_group: 65536 }
}

// For the dictionary and the tool text: each table's columns and seasons.
export async function catalogForSql() {
  const e = await engine()
  return e.tables
}
