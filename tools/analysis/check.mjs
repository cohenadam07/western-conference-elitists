// tools/analysis/check.mjs — WCE Pro analysis (savant_sql, savant_analyze): the locks, the limits, the
// gating and the listing (research/analysis/BUILD.md §5). Runs in check:savant.
//
//   node --test tools/analysis/check.mjs
//
// The engine reads the Parquet copies in out/parquet through a local stand-in for the release
// (tools/analysis/serve.mjs, with range requests); without them the engine tests are skipped, as the Data
// Room's own check skips without out/dataroom. The parity checks are separate scripts (they compare
// against the pages and statsmodels): sql_parity.py, stats_parity.py, stability_parity.py.
//
// SECURITY. Every way out is tried twice: through runSql (the checker refuses it before the engine sees
// it), and straight at the locked engine past the checker (the engine itself refuses it). Both must hold.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ROOT, hasParquet, start } from './serve.mjs'

process.env.SQL_MEMORY = '512MB'          // a small cap, so the memory test is quick
const DATA = hasParquet()
const skip = DATA ? false : 'out/parquet is not here (pipeline/dataroom/parquet.mjs writes it)'
let srv, S, mcp, A
before(async () => {
  srv = await start()
  S = await import('../../api/_sql.js')
  A = await import('../../api/_analysis.js')
  mcp = await import('../../api/mcp.js')
})
after(async () => { await srv?.close() })

const refused = async (sql, re, opts) => {
  await assert.rejects(() => S.runSql(sql, opts), (e) => { assert.match(e.message, re, `${sql}\n→ ${e.message}`); return true })
}
// Straight at the engine, past checkSql: the engine's own locks must refuse it.
const raw = async (sql) => {
  const e = await S._engineForTests()
  try { await e.con.runAndReadAll(sql); return null } catch (err) { return String(err.message || err) }
}
const LOCKED = /Permission Error|disabled|locked|Cannot change|does not exist|Catalog Error|not allowed/i

// ---- 1. security ------------------------------------------------------------------------------------
test('writes are refused: INSERT, CREATE, COPY, UPDATE, DELETE, DROP, CREATE MACRO', { skip }, async () => {
  for (const q of ['INSERT INTO nba.shots VALUES (1)', 'CREATE TABLE x AS SELECT 1', "COPY (SELECT 1) TO '/tmp/x.csv'", 'UPDATE nba.shots SET made = 1', 'DELETE FROM nba.shots', 'DROP VIEW nba.shots', 'CREATE MACRO f(x) AS x', 'CREATE TEMP TABLE t (a INT)']) {
    await refused(q, /Read-only|only a single SELECT/)
  }
  // the engine: a write to a file is a file the allowlist does not hold
  assert.match(await raw("COPY (SELECT 1) TO '/tmp/wce-sql-copy-test.csv'"), LOCKED)
})

test('ATTACH, INSTALL, LOAD, SET, PRAGMA, RESET, CALL, DETACH, EXPORT are refused', { skip }, async () => {
  for (const q of ["ATTACH '/tmp/x.db'", 'INSTALL spatial', 'LOAD spatial', "SET threads = 64", "SET enable_external_access = true", 'PRAGMA threads = 8', 'RESET threads', 'CALL pragma_version()', 'DETACH memory', "EXPORT DATABASE '/tmp/x'", 'CHECKPOINT']) {
    await refused(q, /Read-only|only a single SELECT|does not parse|One statement/)
  }
  for (const q of ["ATTACH '/tmp/wce-attach-test.db'", 'INSTALL spatial', 'LOAD spatial', 'SET threads = 64', "SET enable_external_access = true", "SET allowed_paths = ['/']", 'PRAGMA threads = 8', 'RESET lock_configuration']) {
    const err = await raw(q)
    assert.ok(err && LOCKED.test(err), `engine let "${q}" through: ${err}`)
  }
})

test('no URL or path outside the allowlist: other sites, local files, globs, traversal, the release\'s other files', { skip }, async () => {
  const base = process.env.DATAROOM_ASSETS
  const tries = [
    "SELECT * FROM read_parquet('https://example.com/x.parquet')", "SELECT * FROM read_csv('/etc/passwd')", "SELECT * FROM read_text('/etc/hosts')",
    "SELECT * FROM '/etc/passwd'", "SELECT * FROM 'https://example.com/a.csv'", "SELECT * FROM glob('/*')", "SELECT * FROM read_blob('/etc/passwd')",
    `SELECT * FROM read_parquet('${base}/nba-shots-2024-25.parquet')`, `SELECT * FROM read_parquet('${base}/../../etc/passwd')`, `SELECT * FROM parquet_metadata('${base}/nba-shots-2024-25.parquet')`,
    "SELECT * FROM read_json_auto('https://wcehoops.com/api/status')", "SELECT * FROM sniff_csv('/etc/passwd')", "SELECT * FROM query('SELECT 1')", "SELECT * FROM query_table('nba.shots')",
    "SELECT json_execute_serialized_sql(json_serialize_sql('SELECT 1'))",
  ]
  for (const q of tries) await refused(q, /Only the Data Room tables can be read|not available here|does not parse/)
  for (const q of ["SELECT * FROM read_text('/etc/hosts')", "SELECT * FROM read_csv('/etc/passwd')", "SELECT * FROM read_parquet('https://example.com/x.parquet')", `SELECT * FROM read_parquet('${base}/nba-shots-2023-24.parquet')`, `SELECT * FROM read_parquet('${base}/nba-shots-2024-25.parquet?p=/season=2024-25/../../x')`, "SELECT * FROM glob('/tmp/*')"]) {
    const err = await raw(q)
    assert.ok(err && LOCKED.test(err), `engine read "${q}": ${err}`)
  }
})

test('no way to see the environment or the settings: getenv, current_setting, duckdb_settings, secrets, extensions', { skip }, async () => {
  process.env.WCE_SQL_CANARY = 'canary-must-not-leak'
  for (const q of ["SELECT getenv('HOME')", "SELECT getenv('WCE_SQL_CANARY')", "SELECT current_setting('home_directory')", 'SELECT * FROM duckdb_settings()', 'SELECT * FROM duckdb_secrets()', 'SELECT * FROM duckdb_extensions()', "SELECT which_secret('s3://x', 's3')", 'SELECT * FROM pragma_database_list', 'SELECT * FROM information_schema.tables', 'SELECT version()']) {
    await refused(q, /Only the Data Room tables can be read|not available here|does not parse/)
  }
  // the engine has no getenv at all (it is a shell function), so nothing past the checker reads one either
  assert.match(await raw("SELECT getenv('WCE_SQL_CANARY')"), /does not exist|Catalog Error/)
})

test('one statement per call', { skip }, async () => {
  await refused('SELECT 1; SELECT 2', /One statement per call/)
  await refused("SELECT season FROM nba.shots WHERE season = '2024-25' LIMIT 1; DROP VIEW nba.shots", /One statement per call/)
})

test('a query built to exhaust memory is stopped with a way to narrow it', { skip }, async () => {
  await refused('SELECT list(r) FROM range(400000000) t(r)', /memory/)
  // and the engine is still there for the next caller
  const r = await S.runSql("SELECT count(*) FROM nba.shots WHERE season = '2024-25'")
  assert.equal(r.rows[0][0], 219527)
})

test('a query built to run past the time limit is interrupted with a way to narrow it', { skip }, async () => {
  const t = Date.now()
  await refused('SELECT sum(hash(a.range * b.range)) FROM range(200000) a, range(200000) b', /second limit/, { wallMs: 2500 })
  assert.ok(Date.now() - t < 9000, `took ${Date.now() - t} ms to stop`)
  const r = await S.runSql('SELECT 42 AS x')
  assert.equal(r.rows[0][0], 42)
})

test('every way to reach an outside file through a view the engine made is closed: views are not writable, the profile path holds nothing', { skip }, async () => {
  await refused('SELECT * FROM nba.shots_v2', /Only the Data Room tables/)
  await refused("SELECT * FROM memory.main.x", /Only the Data Room tables|no other databases/)
  await refused("SELECT * FROM system.main.duckdb_tables()", /Only the Data Room tables|not available|does not parse/)
})

// ---- 2. limits and the answer ------------------------------------------------------------------
test('rows are capped at 500 with the full count; a wide scan is refused with how to narrow it', { skip }, async () => {
  const r = await A.savantSql({ sql: "SELECT player_id, game_id FROM nba.shots WHERE season = '2024-25'" })
  assert.equal(r.structured.rows.length, 500)
  assert.equal(r.structured.row_count, 219527)
  assert.equal(r.structured.truncated, true)
  assert.match(r.text, /capped at 500/)
  await assert.rejects(() => A.savantSql({ sql: 'SELECT * FROM nfl.plays' }), /budget.*Narrow it/)
})

test('every answer: rows, the count, rows scanned, data through per table, the time, labelled computed', { skip }, async () => {
  const r = await A.savantSql({ sql: "SELECT s.team, count(*) AS fga, avg(s.made) AS fg FROM nba.shots s JOIN nba.player_games g USING (season, game_id, player_id) WHERE s.season = '2024-25' GROUP BY 1 ORDER BY 3 DESC" })
  const x = r.structured
  assert.equal(x.row_count, 30)
  assert.deepEqual(x.tables.sort(), ['nba.player_games', 'nba.shots'])
  for (const t of x.tables) assert.match(x.data_through[t], /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(x.scanned.row_groups_read > 0 && x.scanned.bytes_fetched >= 0)
  assert.ok(x.ms > 0)
  assert.equal(x.computed, true)
  assert.match(r.text, /Every number here is computed/)
  assert.match(r.text, /Data through: nba\.(player_games|shots) through \d{4}/)
})

test('season filters read only those seasons\' files (the hive trick)', { skip }, async () => {
  const log = []
  const keep = { a: process.env.DATAROOM_ASSETS, o: process.env.SAVANT_API_ORIGIN }
  const one = await start({ log })
  S.resetEngine()
  try {
    await S.runSql("SELECT count(*) FROM nba.shots WHERE season = '2019-20'")
    const files = new Set(log.filter((u) => u.includes('nba-shots-')).map((u) => u.split('/').pop()))
    // the season asked for, and the newest season's footer (where the view takes its columns from)
    const newest = Object.keys(JSON.parse((await import('node:zlib')).gunzipSync(readFileSync(path.join(ROOT, 'public/dataroom/parquet.json.gz')))).tables['nba.shots'].seasons).sort().pop()
    assert.deepEqual([...files].sort(), ['nba-shots-2019-20.parquet', `nba-shots-${newest}.parquet`].sort())
  } finally { await one.close(); process.env.DATAROOM_ASSETS = keep.a; process.env.SAVANT_API_ORIGIN = keep.o; S.resetEngine() }
})

test('savant_analyze: every study answers in words first, with samples, warnings and what it cannot account for', { skip }, async () => {
  const t = A.tools.find((x) => x.name === 'savant_analyze')
  const g = await t.run({ study: 'compare' })
  assert.match(g.text, /compare: columns outcome/)
  const r = await t.run({ study: 'compare', sql: "SELECT game_id, made, CASE WHEN distance >= 24 THEN 'long' ELSE 'short' END AS d FROM nba.shots WHERE season = '2024-25' AND zone LIKE '%3'", columns: { outcome: 'made', group: 'd', cluster: 'game_id' }, options: { reference: 'short' } })
  const x = r.structured
  assert.ok(x.interpretation.length > 40 && r.text.startsWith(x.interpretation))
  assert.ok(x.groups.every((gr) => gr.n > 0))
  assert.ok(Array.isArray(x.cannot_account_for) && x.cannot_account_for.length)
  assert.ok(!/\bcauses?\b/.test(x.interpretation.replace(/not (proof of )?(a |its )?cause/g, '')), x.interpretation)
  const few = await t.run({ study: 'compare', sql: "SELECT game_id, made, CASE WHEN player = 'Stephen Curry' THEN 'curry' ELSE 'rest' END AS who FROM nba.shots WHERE season = '2024-25' AND game_id IN (SELECT DISTINCT game_id FROM nba.shots WHERE season = '2024-25' AND player = 'Stephen Curry' LIMIT 3)", columns: { outcome: 'made', group: 'who', cluster: 'game_id' }, options: { stat: 'tp2' } })
  assert.equal(few.structured.tests[0].verdict, 'too few')
  assert.ok(few.structured.warnings.some((w) => /settle point/.test(w)), few.structured.warnings.join(' | '))
})

test('multiple comparisons are adjusted and said so', { skip }, async () => {
  const r = await A.tools.find((x) => x.name === 'savant_analyze').run({ study: 'compare', sql: "SELECT game_id, success, down FROM nfl.plays WHERE season = '2024' AND play_type IN ('pass', 'run') AND down IS NOT NULL", columns: { outcome: 'success', group: 'down', cluster: 'game_id' }, options: { reference: 1 } })
  assert.equal(r.structured.tests.length, 3)
  assert.match(r.structured.multiple_comparisons, /Holm/)
})

// ---- 3. gating ------------------------------------------------------------------------------------
async function listing(key) {
  const server = mcp.buildServer(key)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'check', version: '1' })
  await client.connect(b)
  const { tools } = await client.listTools()
  const t = tools.map((x) => ({ name: x.name, title: x.title, description: x.description, inputSchema: x.inputSchema, annotations: x.annotations }))
  const out = { names: t.map((x) => x.name), tools: t, instructions: client.getInstructions(), upfront: t.reduce((n, x) => n + JSON.stringify({ name: x.name, description: x.description, inputSchema: x.inputSchema }).length, 0), client }
  return out
}
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const MAIN = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'analysis', 'public-main.json'), 'utf8'))

test('the public address, unknown and unchecked keys, and ordinary key holders list exactly what main lists, with main\'s up-front text', async () => {
  delete process.env.PRO_ANALYSIS_OPEN
  for (const [label, key] of [['public', { state: 'none' }], ['unknown', { state: 'unknown' }], ['unchecked', { state: 'unchecked' }], ['key', { state: 'valid', id: 'aaaaaaaaaaaa', tier: null }]]) {
    const l = await listing(key)
    assert.ok(!l.names.includes('savant_sql') && !l.names.includes('savant_analyze'), label)
    assert.equal(sha(l.tools), MAIN[label].tools_sha256, `${label}: the tool list differs from main's (tools/analysis/snapshot-main.mjs)`)
    assert.equal(sha(l.instructions), MAIN[label].instructions_sha256, `${label}: the up-front instructions differ from main's`)
    await l.client.close()
  }
})

test('founder keys list both tools, under the 90,000-character cap, with savant_data and savant_dictionary folded into savant_sql', async () => {
  delete process.env.PRO_ANALYSIS_OPEN
  const l = await listing({ state: 'valid', id: 'bbbbbbbbbbbb', tier: 'founder' })
  assert.ok(l.names.includes('savant_sql') && l.names.includes('savant_analyze'))
  assert.ok(l.names.includes('savant_query'))
  assert.ok(!l.names.includes('savant_data') && !l.names.includes('savant_dictionary'))
  assert.ok(l.upfront < 90000, `the founder listing is ${l.upfront} characters`)
  assert.match(l.instructions, /savant_sql with dictionary/)
  for (const n of ['savant_sql', 'savant_analyze']) {
    const t = l.tools.find((x) => x.name === n)
    assert.equal(t.annotations.readOnlyHint, true)
    assert.equal(t.annotations.destructiveHint, false)
  }
  await l.client.close()
})

test('the one switch opens both tools to every key holder, and only key holders; off again, it closes', async () => {
  process.env.PRO_ANALYSIS_OPEN = '1'
  try {
    const k = await listing({ state: 'valid', id: 'aaaaaaaaaaaa', tier: null })
    assert.ok(k.names.includes('savant_sql') && k.names.includes('savant_analyze'))
    assert.ok(k.upfront < 90000, `${k.upfront}`)
    await k.client.close()
    for (const key of [{ state: 'none' }, { state: 'unknown' }, { state: 'unchecked' }]) {
      const p = await listing(key)
      assert.ok(!p.names.includes('savant_sql'), key.state)
      assert.equal(sha(p.tools), MAIN[key.state === 'none' ? 'public' : key.state].tools_sha256)
      await p.client.close()
    }
  } finally { delete process.env.PRO_ANALYSIS_OPEN }
  const k = await listing({ state: 'valid', id: 'aaaaaaaaaaaa', tier: null })
  assert.ok(!k.names.includes('savant_sql'))
  await k.client.close()
})

// A stand-in for the Upstash REST store: the commands api/_keys.js and api/_usage.js send.
function fakeStore() {
  const hashes = new Map()
  const h = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k) }
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case 'HGET': return h(a[0]).get(a[1]) ?? null
      case 'HSET': h(a[0]).set(a[1], a[2]); return 1
      case 'HSETNX': if (h(a[0]).has(a[1])) return 0; h(a[0]).set(a[1], a[2]); return 1
      case 'HGETALL': return [...h(a[0]).entries()].flat()
      case 'HDEL': return h(a[0]).delete(a[1]) ? 1 : 0
      case 'EVAL': return 1
      default: return null
    }
  }
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url.endsWith('/pipeline') ? body.map((c) => ({ result: run(c) })) : { result: run(body) }))
  })
  return { server, hashes }
}

test('end to end through the handler: a founder key\'s address lists and runs both; the public address and an ordinary key do not, and a call fails cleanly', async () => {
  const keys = await import('../../api/_keys.js')
  const { retier } = await import('../keys/tier.mjs')
  const store = fakeStore()
  await new Promise((r) => store.server.listen(0, '127.0.0.1', r))
  process.env.KV_REST_API_URL = `http://127.0.0.1:${store.server.address().port}`
  process.env.KV_REST_API_TOKEN = 'test'
  keys.resetKeys()
  const app = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    Object.defineProperty(req, 'body', { get() { return raw ? JSON.parse(raw) : undefined } })
    mcp.default(req, res)
  })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const endpoint = `http://127.0.0.1:${app.address().port}/api/mcp`
  const connect = async (url) => { const c = new Client({ name: 'check', version: '0' }); await c.connect(new StreamableHTTPClientTransport(new URL(url))); return c }
  try {
    const founder = await keys.createKey({ email: 'founder@example.com', source: 'test' })
    const fan = await keys.createKey({ email: 'fan@example.com', source: 'test' })
    // tools/keys/tier.mjs's own logic sets the tier, on every key that email holds
    const recs = [...store.hashes.get(keys.K_KEYS).entries()]
    const { held, changes } = retier(recs, 'Founder@Example.com', 'founder')
    assert.equal(held, 1); assert.equal(changes.length, 1)
    for (const [id, json] of changes) store.hashes.get(keys.K_KEYS).set(id, json)
    assert.ok(!JSON.stringify(changes).includes(founder.key), 'the tier change never carries the key itself')
    keys.resetKeys()
    const pub = await connect(endpoint)
    const fanC = await connect(`${endpoint}?key=${fan.key}`)
    const own = await connect(`${endpoint}?key=${founder.key}`)
    const names = async (c) => (await c.listTools()).tools.map((t) => t.name)
    assert.ok(!(await names(pub)).includes('savant_sql'))
    assert.ok(!(await names(fanC)).includes('savant_sql'))
    assert.ok((await names(fanC)).includes('savant_query'))
    assert.ok((await names(own)).includes('savant_sql') && (await names(own)).includes('savant_analyze'))
    for (const c of [pub, fanC]) {
      const r = await c.callTool({ name: 'savant_sql', arguments: { sql: 'SELECT 1' } })
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /founder-tier keys/)
      const z = await c.callTool({ name: 'savant_analyze', arguments: { study: 'compare' } })
      assert.equal(z.isError, true)
    }
    if (DATA) {
      const r = await own.callTool({ name: 'savant_sql', arguments: { sql: "SELECT count(*) AS n FROM ufc.fights WHERE season = '2024'" } })
      assert.ok(!r.isError, JSON.stringify(r.content))
      assert.ok(r.structuredContent.rows[0][0] > 0)
    }
    // none takes it away again
    const back = retier([...store.hashes.get(keys.K_KEYS).entries()], 'founder@example.com', 'none')
    for (const [id, json] of back.changes) store.hashes.get(keys.K_KEYS).set(id, json)
    keys.resetKeys()
    const again = await connect(`${endpoint}?key=${founder.key}`)
    assert.ok(!(await names(again)).includes('savant_sql'))
    for (const c of [pub, fanC, own, again]) await c.close()
  } finally {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    keys.resetKeys()
    app.close(); store.server.close()
  }
})

// ---- 4. the copies the engine relies on ------------------------------------------------------------
test('the settle-point copy is the page\'s SETTLE_K', async () => {
  const { SETTLE_K } = await import('../../api/_analyze.js')
  const html = readFileSync(path.join(ROOT, 'public', 'basketball-savant.html'), 'utf8')
  const m = html.match(/const SETTLE_K=(\{[^;]*\});/)
  const page = Object.fromEntries([...m[1].matchAll(/(\w+):\[(\d+),(\d+)\]/g)].map(([, k, a, b]) => [k, [+a, +b]]))
  assert.deepEqual(SETTLE_K, page)
})

test('the Parquet manifest covers every Data Room table and season, with the catalog\'s row counts', async () => {
  const { gunzipSync } = await import('node:zlib')
  const cat = JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public/dataroom/catalog.json.gz'))))
  const man = JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public/dataroom/parquet.json.gz'))))
  const missing = []
  for (const [sport, tables] of Object.entries(cat.sports)) for (const [t, v] of Object.entries(tables)) {
    const m = man.tables[`${sport}.${t}`]
    if (!m) { missing.push(`${sport}.${t}`); continue }
    const newest = Object.keys(v.seasons || {}).sort().pop()
    for (const [s, x] of Object.entries(v.seasons || {})) {
      const p = m.seasons[s]
      // The season in progress can be ahead of the catalog's count (the site's files refresh between its
      // rescans), never behind; College Basketball's per-team tables count differently in the catalog.
      const perTeam = sport === 'cbb' && ['player_games', 'units', 'possessions'].includes(t)
      if (!p) missing.push(`${sport}.${t} ${s}`)
      else if (x.rows != null && !perTeam && (s === newest ? p.rows < x.rows : p.rows !== x.rows)) missing.push(`${sport}.${t} ${s}: ${p.rows} rows, catalog ${x.rows}`)
    }
  }
  assert.deepEqual(missing, [])
})
