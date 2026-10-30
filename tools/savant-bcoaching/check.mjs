// Check for Basketball Coaching Savant: the files pipeline/basketball/coaching/build.py writes
// under public/bcs/, the page that draws them, and the connector section (api/_bcoaching.js)
// that quotes them.
//
//   node --test tools/savant-bcoaching/check.mjs        (npm run check:savant-bcoaching)
//
// What it holds:
//   1. the files are whole: the index, a page for every coach it lists, a team-season file for
//      every season row that has a Rotation Map, the Data Room tables and the dictionary, and
//      every stat key on a page is in the registry
//   2. the numbers are the page's: percentiles are 1..99 and name a pool; a career stat below
//      its settle point is flagged; a Leaders row points at a coach with a page; the tree's
//      mentors are coaches; each Rotation Map row's shares are 0..100 and its windows sit at
//      60%+; a unit's minutes add up with the stints behind it
//   3. the connector answers every tool through a real MCP client, against these very files
//      (served from a local HTTP server), and every number it quotes is read back from the file
//   4. the page's script still parses and still ends by starting itself
//
// No network, no keys. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BCS = path.join(ROOT, 'public', 'bcs')
const readJson = (p) => JSON.parse(p.endsWith('.gz') ? gunzipSync(readFileSync(p)).toString('utf8') : readFileSync(p, 'utf8'))
const gz = (p) => (existsSync(p) ? p : existsSync(p + '.gz') ? p + '.gz' : null)

const index = readJson(path.join(BCS, 'index.json'))
const stats = new Map(index.stats.map((s) => [s.key, s]))
const pages = Object.fromEntries(index.coaches.map((c) => [c.id, readJson(path.join(BCS, 'c', `${c.id}.json`))]))
const nodes = index.tree.nodes

// ---- 1 + 2. the files and the numbers ------------------------------------------------------
test('the index lists every coach once and every coach has a page', () => {
  const ids = index.coaches.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'a coach is listed twice')
  for (const id of ids) assert.ok(pages[id], `no page for ${id}`)
  assert.ok(index.coaches.filter((c) => c.hc).length > 300, 'the index should hold every head coach since 1946-47')
  assert.ok(index.meta.rules.career_pool >= 60, 'the career pool is suspiciously small')
  for (const k of ['talent', 'parts']) assert.ok(index.meta.fits[k], `the ${k} fit is missing from meta`)
})

test('every stat on a page is in the registry, every percentile names a pool and sits in 1..99', () => {
  let n = 0
  for (const [id, p] of Object.entries(pages)) {
    for (const [key, v] of Object.entries(p.career.stats)) {
      const s = stats.get(key)
      assert.ok(s, `${id}: career stat ${key} is not in the registry`)
      if (v.pct != null) { assert.ok(v.pct >= 1 && v.pct <= 99, `${id} ${key}: percentile ${v.pct}`); assert.ok(v.pool >= 2, `${id} ${key}: a percentile without a pool`) }
      assert.equal(typeof v.v, 'number', `${id} ${key}: value`)
      n++
    }
    for (const srow of p.seasons) {
      for (const key of Object.keys(srow.values)) assert.ok(stats.get(key), `${id} ${srow.season}: season stat ${key} is not in the registry`)
      for (const [key, pct] of Object.entries(srow.pct)) assert.ok(pct >= 1 && pct <= 99 && stats.get(key), `${id} ${srow.season}: ${key} ${pct}`)
      if (!srow.ranked) assert.equal(Object.keys(srow.pct).length, 0, `${id} ${srow.season}: ranked below ${index.meta.rules.min_season_games} games`)
    }
    if (!p.career.eligible) assert.ok(Object.values(p.career.stats).every((v) => v.pct == null), `${id}: ranked without being eligible`)
  }
  assert.ok(n > 5000, `only ${n} career stats`)
})

test('every Leaders row points at a coach with a page, and every board names its pool', () => {
  for (const b of index.leaders) {
    assert.ok(b.pool && b.pool.length > 10, `${b.id}: pool`)
    for (const r of b.rows) assert.ok(pages[r.id], `${b.id}: ${r.name} has no page`)
    const vals = b.rows.map((r) => r.value)
    const s = stats.get(b.id)
    const lower = s ? s.lower : false
    for (let i = 1; i < vals.length; i++) assert.ok(lower ? vals[i] >= vals[i - 1] : vals[i] <= vals[i - 1], `${b.id}: not in the page's order at row ${i}`)
  }
})

test('the tree is whole: every mentor is a coach, sizes add up, roots have no mentor', () => {
  for (const [id, n] of Object.entries(nodes)) {
    if (n.mentor) assert.ok(nodes[n.mentor], `${id}: mentor ${n.mentor} is not in the tree`)
    for (const k of n.kids) assert.equal(nodes[k].mentor, id, `${id}: ${k} is a kid but does not name him`)
    assert.equal(n.size, 1 + n.kids.reduce((s, k) => s + nodes[k].size, 0), `${id}: size`)
  }
  for (const r of index.tree.roots) assert.equal(nodes[r].mentor, null, `${r} is a root with a mentor`)
})

test('a team-season file exists for every season row with a Rotation Map, and its map is sound', () => {
  let files = 0, units = 0
  for (const [id, p] of Object.entries(pages)) {
    for (const s of p.seasons) {
      if (!s.rotation) continue
      const f = gz(path.join(BCS, 't', `${s.team}-${s.season}.json`))
      assert.ok(f, `${id} ${s.season}: no team-season file ${s.team}-${s.season}`)
      if (files++ % 40) continue   // a sample is read in full
      const file = readJson(f)
      const t = file.coaches.find((e) => e.coach === id)
      assert.ok(t, `${s.team} ${s.season}: no entry for ${id}`)
      const fileCoaches = file.coaches.map((e) => e.coach)
      assert.equal(new Set(fileCoaches).size, fileCoaches.length, `${s.team} ${s.season}: a coach twice`)
      for (const r of t.rotation.rows) {
        assert.ok(r.played.length === 48 && r.all.length === 48, `${s.team} ${s.season} ${r.name}: 48 minutes`)
        assert.ok(r.played.every((v) => v >= 0 && v <= 100), `${s.team} ${s.season} ${r.name}: shares`)
        for (const [a, b] of r.windows) for (let m = a; m <= b; m++) assert.ok(r.played[m] >= 60, `${s.team} ${s.season} ${r.name}: a window minute under 60%`)
        assert.ok(r.min >= 100, `${s.team} ${s.season} ${r.name}: under 100 minutes on the map`)
      }
      for (const g of t.rotation.game_rows) assert.ok(g.share >= 0 && g.share <= 1 && g.causes.length === 4, `${s.team} ${s.season} ${g.date}: off-script share`)
      for (const u of t.units5) { assert.equal(u.ids.length, 5); assert.ok(u.min >= 25); units++ }
      assert.equal(t.rotation.off_script, s.rotation.off_script, `${s.team} ${s.season}: the page row and the file disagree on off-script`)
    }
  }
  assert.ok(files > 700, `only ${files} team-season files`)
  assert.ok(units > 0)
})

test('the Data Room has every table for every season it claims, with its columns, and the dictionary covers them', () => {
  const dict = readJson(path.join(BCS, 'data', 'dictionary.json'))
  for (const t of ['games', 'stints', 'units', 'rotation', 'decisions']) {
    assert.ok(dict.tables[t], `${t} is not defined`)
    const dir = path.join(BCS, 'data', t)
    const seasons = readdirSync(dir).filter((f) => f.endsWith('.json.gz')).map((f) => f.slice(0, 7))
    assert.ok(seasons.length >= (t === 'games' ? 30 : 24), `${t}: ${seasons.length} seasons`)
    const f = readJson(path.join(dir, `${seasons[seasons.length - 2]}.json.gz`))
    assert.equal(f.table, t)
    assert.ok(Array.isArray(f.columns) && f.rows.length > 100, `${t}: rows`)
    for (const r of f.rows.slice(0, 50)) assert.equal(r.length, f.columns.length, `${t}: a row with the wrong number of columns`)
  }
  assert.equal(dict.stats.length, index.stats.length)
  assert.ok(existsSync(path.join(BCS, 'data', 'coaches.json')))
})

test('the page script parses and still ends by starting itself', async () => {
  const html = readFileSync(path.join(ROOT, 'public', 'basketball-coaching-savant.html'), 'utf8')
  const src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  assert.ok(/\binit\(\);\s*$/.test(src))
  assert.doesNotThrow(() => new Function(src))
  for (const f of ['renderRotation', 'renderPairs', 'renderQuadrant', 'renderMVI', 'renderManagement', 'renderSplits', 'renderDevelopment', 'renderStaff', 'openTree']) assert.ok(src.includes(`function ${f}(`), f)
})

// ---- 3. the connector ----------------------------------------------------------------------
let server, client, mod
before(async () => {
  // serve public/ over HTTP the way the live site does, .json.gz answering for .json
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const f = gz(path.join(ROOT, 'public', url))
    if (!f) { res.statusCode = 404; return res.end('not found') }
    const body = f.endsWith('.gz') ? gunzipSync(readFileSync(f)) : readFileSync(f)
    res.setHeader('content-type', 'application/json'); res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  mod = await import('../../api/_bcoaching.js')
  const srv = new McpServer({ name: 't', version: '0' })
  for (const t of mod.tools) srv.registerTool(t.name, t.config, async (a) => { try { const { text, structured } = await t.run(a); return { content: [{ type: 'text', text }], structuredContent: structured } } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await srv.connect(a)
  client = new Client({ name: 'check', version: '0' })
  await client.connect(b)
})
after(async () => { await client?.close(); server?.close() })
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { ...r, text: r.content.map((c) => c.text).join('\n') } }

test('the six tools are declared and listed', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['nba_coaching_data', 'nba_coaching_dictionary', 'nba_coaching_leaders', 'nba_coaching_tree', 'nba_get_coach_profile', 'nba_search_coaches'])
})

test('search finds a coach by last name and by id, and says what it covers when it finds nobody', async () => {
  let r = await call('nba_search_coaches', { query: 'Popovich' })
  assert.ok(!r.isError && r.structuredContent.coaches[0].id === 'popovgr99c', r.text)
  r = await call('nba_search_coaches', { query: 'zzqx' })
  assert.ok(!r.isError && r.structuredContent.count === 0 && /1946-47/.test(r.text))
})

test('a profile quotes the page: record, every career stat with its pool, the rotation season, the lineage', async () => {
  const id = index.leaders.find((b) => b.id === 'most_wins').rows[0].id
  const p = pages[id]
  const r = await call('nba_get_coach_profile', { coach: id })
  assert.ok(!r.isError, r.text)
  const s = r.structuredContent
  assert.equal(s.coach.id, id)
  assert.equal(s.all_time.w, p.career.all_time.w)
  assert.equal(s.career_stats.length, Object.keys(p.career.stats).length)
  for (const row of s.career_stats) { const v = p.career.stats[row.key]; assert.equal(row.value, v.v); assert.equal(row.percentile, v.pct ?? null); assert.equal(row.pool_size, v.pool ?? null); assert.ok(row.pool.includes('head coaches'), row.key) }
  assert.ok(r.text.includes(`${p.career.all_time.w}–${p.career.all_time.l}`))
  assert.ok(/percentile of \d+/.test(r.text))
  assert.ok(r.text.includes(index.meta.model_note), 'the model caveat reaches the answer')
  assert.ok(r.text.includes(index.tree.note), 'the tree caveat reaches the answer')
  if (s.rotation) { const last = p.seasons.slice().reverse().find((x) => x.rotation); assert.equal(s.rotation.season, last.season); assert.equal(s.rotation.on_script_pct, +(100 * (1 - last.rotation.off_script)).toFixed(1)) }
  for (const g of ['career', 'rotation', 'game_management', 'identity', 'context', 'development', 'staff', 'seasons', 'lineage']) { const x = await call('nba_get_coach_profile', { coach: id, group: g }); assert.ok(!x.isError, `${g}: ${x.text}`) }
})

test('an ambiguous name lists the candidates; an unknown one explains', async () => {
  const r = await call('nba_get_coach_profile', { coach: 'Brown' })
  assert.ok(r.isError && /Call again with one of these ids/.test(r.text))
  const u = await call('nba_get_coach_profile', { coach: 'Nobody Atall Xq' })
  assert.ok(u.isError && /nba_search_coaches/.test(u.text))
})

test('the Leaders tool reads every board from its first row down, as the page orders it', async () => {
  const r = await call('nba_coaching_leaders', { limit: 50 })
  assert.ok(!r.isError, r.text)
  for (const b of r.structuredContent.boards) {
    const mine = index.leaders.find((x) => x.id === b.id)
    assert.deepEqual(b.rows.map((x) => [x.id, x.value]), mine.rows.slice(0, 50).map((x) => [x.id, x.value]), b.id)
  }
})

test('the tree tool gives a coach his line and his branch', async () => {
  const root = index.tree.roots[0]
  const r = await call('nba_coaching_tree', { coach: root, depth: 2 })
  assert.ok(!r.isError, r.text)
  assert.equal(r.structuredContent.coach.branch_size, nodes[root].size - 1)
  const all = await call('nba_coaching_tree', {})
  assert.ok(!all.isError && all.structuredContent.trees.length === index.tree.roots.length)
})

test('the Data Room pulls rows with filters, columns and paging, and the dictionary defines the tables', async () => {
  const season = readdirSync(path.join(BCS, 'data', 'games')).filter((f) => f.endsWith('.json.gz')).map((f) => f.slice(0, 7)).sort().slice(-2)[0]
  const r = await call('nba_coaching_data', { table: 'games', season, filters: [{ column: 'type', op: 'eq', value: 'RS' }, { column: 'b2b', op: 'eq', value: true }], columns: ['date', 'team', 'opp', 'w', 'margin', 'rest_days'], limit: 20 })
  assert.ok(!r.isError, r.text)
  const s = r.structuredContent
  assert.deepEqual(s.columns, ['date', 'team', 'opp', 'w', 'margin', 'rest_days'])
  assert.ok(s.total_matching > 100 && s.rows.length === 20 && s.rows.every((row) => row[5] === 0))
  const file = readJson(path.join(BCS, 'data', 'games', `${season}.json.gz`))
  const ci = Object.fromEntries(file.columns.map((c, i) => [c, i]))
  const expect = file.rows.filter((row) => row[ci.type] === 'RS' && row[ci.b2b] === true).length
  assert.equal(s.total_matching, expect)
  const bad = await call('nba_coaching_data', { table: 'games', season, filters: [{ column: 'nope', op: 'eq', value: 1 }] })
  assert.ok(bad.isError && /No column "nope"/.test(bad.text))
  const d = await call('nba_coaching_dictionary', {})
  assert.ok(!d.isError && d.structuredContent.stats.length === index.stats.length && d.structuredContent.tables.games)
  for (const t of ['stints', 'units', 'rotation', 'decisions']) { const x = await call('nba_coaching_data', { table: t, season, limit: 3 }); assert.ok(!x.isError && x.structuredContent.rows.length === 3, `${t}: ${x.text}`) }
})
