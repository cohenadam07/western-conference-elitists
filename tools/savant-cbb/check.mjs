// Check for College Basketball Savant: the files pipeline/college/build.py writes under public/cbb/,
// the page, and the connector section (api/_cbb.js) that quotes them.
//
//   node --test tools/savant-cbb/check.mjs        (npm run check:savant-cbb)
//
// What it holds:
//   1. the files are whole: every season the index lists has a table, a teams file and team files;
//      every stat in a table is in the registry, and every registry stat has an explainer
//   2. nothing that must not ship is in the files: no birthdates, no Torvik ratings, no CBBD field
//   3. the numbers are sound: pools over the floor, percentiles 1..99, "not tracked" kept apart from
//      zero, and no season shows lineups it did not earn
//   4. every connector value is held to the page's own math: each tool is called through a real MCP
//      client against these very files, and its percentile is recomputed here with public/savant-cbb.js
//      over the same table the page reads
//   5. the page's script parses, and every percentile names its pool
//
// No network, no keys.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import '../../public/savant-cbb.js'

const M = globalThis.SavantCBB
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CBB = path.join(ROOT, 'public', 'cbb')
const read = (p) => JSON.parse(gunzipSync(readFileSync(path.join(CBB, p + '.gz'))).toString('utf8'))
const reg = read('registry.json')
const idx = read('index.json')
const byKey = Object.fromEntries(reg.stats.map((s) => [s.key, s]))

test('the registry is complete: every stat has its explainer', () => {
  assert.ok(reg.stats.length >= 40)
  for (const s of reg.stats) for (const k of ['label', 'group', 'kind', 'unit', 'what', 'formula', 'source', 'start']) assert.ok(s[k] !== undefined && s[k] !== '', `${s.key}: ${k}`)
  for (const s of reg.stats) assert.ok(reg.groups.includes(s.group), s.key)
})

test('every season the index lists has its files, and every stat in a table is in the registry', () => {
  for (const x of idx.seasons) {
    const d = read(`s/${x.season}.json`)
    for (const k of Object.keys(d.values)) assert.ok(byKey[k], `${x.season}: ${k} is not in the registry`)
    assert.equal(d.players.length, x.players)
    for (const c of Object.values(d.values)) for (const arr of Object.values(c)) assert.equal(arr.length, d.players.length)
    const t = read(`teams/${x.season}.json`)
    assert.ok(t.teams.length >= 2)
    for (const r of t.teams.slice(0, 12)) assert.ok(existsSync(path.join(CBB, 't', x.season, `${r.id}.json.gz`)), `${x.season} ${r.name}`)
  }
})

test('no birthdate, Torvik rating or CBBD field reaches public/cbb', () => {
  const banned = /"(dob|birthdate|dateOfBirth|porpag|bpm_torvik|usg_torvik|offensiveRating|gameSourceId|onFloor|shotInfo|athleteSourceId)"/i
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  const files = walk(CBB).filter((f) => f.endsWith('.gz'))
  for (const f of files.filter((_, i) => i % 7 === 0 || !/\/(t|p)\//.test(_))) assert.ok(!banned.test(gunzipSync(readFileSync(f)).toString('utf8')), f)
  for (const col of read(`s/${idx.seasons[0].season}.json`).cols) assert.ok(!/birth|dob/i.test(col))
})

test('pools are over the floor, or widened and labelled; percentiles sit in 1..99', () => {
  for (const x of idx.seasons) {
    const d = read(`s/${x.season}.json`)
    if (x.qualified < 300) continue
    let n = 0
    for (let i = 0; i < d.players.length; i += 41) {
      for (const pool of Object.keys(M.POOLS)) {
        const p = M.pool(d, reg, i, pool)
        if (p.name !== pool) assert.ok(p.widened, 'a changed pool must say so')
        assert.ok(p.ids.length >= reg.min_pool || d.players[i][M.COL.age] == null, `${x.season} ${pool}: ${p.ids.length}`)
        const label = M.poolLabel(p, d.players[i], { adj: true, season: x.season })
        assert.match(label, /^vs .+, (opponent-adjusted|raw), \d{4}-\d{2}$/)
      }
      for (const s of reg.stats) {
        const r = M.row(d, reg, s, i, { poolName: 'pos', adj: true, gt: false, per: 70 })
        if (r.pct != null) { assert.ok(r.pct >= 1 && r.pct <= 99, `${s.key} ${r.pct}`); n++ }
        if (r.tracked === false) assert.equal(r.value, undefined, 'not tracked is not zero')
      }
    }
    assert.ok(n > 1000, `${x.season}: only ${n} percentiles`)
  }
})

test('a season without lineups shows none', () => {
  for (const x of idx.seasons) {
    if (x.court) continue
    const d = read(`s/${x.season}.json`)
    for (const k of ['onoff', 'onoff_luck', 'rapm']) assert.ok(d.values[k].r.every((v) => v === null), `${x.season} ${k}`)
  }
})

test('the page parses, names its pool and starts itself', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'college-basketball-savant.html'), 'utf8')
  const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'))
  new Function(js) // eslint-disable-line no-new-func
  assert.match(js, /poolLabel/)
  assert.match(html, /Some birthdates come from T-Rank's public player file/)
  assert.match(html, /viewport-fit=cover/)
  assert.ok(!/fictional|dir-ledger|dir-terminal/.test(html))
})

// ---- the connector, against these files -----------------------------------------------
let server, client, S
before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0])
    const f = path.join(ROOT, 'public', u + '.gz')
    if (!existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(gunzipSync(readFileSync(f)))
  })
  await new Promise((r) => server.listen(0, r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  process.env.VERCEL_URL = ''
  const { tools } = await import('../../api/_cbb.js')
  S = tools
  const mcp = new McpServer({ name: 't', version: '0' })
  for (const t of tools) mcp.registerTool(t.name, t.config, async (a) => { const r = await t.run(a); return { content: [{ type: 'text', text: r.text }], structuredContent: r.structured } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'c', version: '0' })
  await Promise.all([mcp.connect(a), client.connect(b)])
})
after(() => server.close())
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`)
  return r.structuredContent
}

test('every connector value equals the page\'s math', async () => {
  const s = idx.default_season
  const d = read(`s/${s}.json`)
  const q = d.players.map((p, i) => [p, i]).filter(([p]) => p[M.COL.qual])
  let n = 0
  for (const [p, i] of q.filter((_, k) => k % Math.ceil(q.length / 12) === 0)) {
    for (const [pool, key] of [['position', 'pos'], ['all', 'all'], ['high_major', 'hm']]) {
      const a = await call('cbb_get_player_profile', { player: p[0], season: s, pool })
      assert.equal(a.player.id, p[0])
      assert.match(a.pool.name, /^vs /)
      for (const st of a.stats) {
        const r = M.row(d, reg, byKey[st.key], i, { poolName: key, adj: true, gt: false, per: 70 })
        assert.equal(st.percentile ?? null, r.pct ?? null, `${p[1]} ${st.key} ${pool}`)
        if (r.tracked && !r.low) assert.equal(st.shown, r.shown)
        if (!r.tracked) assert.equal(st.value, null)
        n++
      }
    }
  }
  assert.ok(n > 1000, `only ${n} values compared`)
})

test('RAPM says it is early, on the page and through the connector', async () => {
  assert.match(reg.rapm_early, /pools 2024-25 onward/)
  assert.match(reg.rapm_early, /firms up as the season goes/)
  for (const k of ['rapm', 'rapm_o', 'rapm_d']) assert.ok(byKey[k].note.includes(reg.rapm_early), `${k} explainer`)
  const html = readFileSync(path.join(ROOT, 'public', 'college-basketball-savant.html'), 'utf8')
  assert.match(html, /REG\.rapm_early/)
  const s = idx.default_season
  const d = read(`s/${s}.json`)
  const p = d.players.find((x) => x[M.COL.qual])
  const a = await call('cbb_get_player_profile', { player: p[0], season: s })
  for (const st of a.stats.filter((x) => x.key.startsWith('rapm'))) assert.equal(st.early, reg.rapm_early)
  assert.equal((await call('cbb_leaderboard', { stat: 'rapm', season: s })).early, reg.rapm_early)
})

test('the raw archive stays off GitHub, and rung 2 travels encrypted', () => {
  const yml = readFileSync(path.join(ROOT, '.github/workflows/college-basketball-savant-cloud.yml'), 'utf8')
  assert.ok(!/archive\.py|gh release/.test(yml), 'the workflow must not upload the archive')
  assert.ok(!/gh", "release/.test(readFileSync(path.join(ROOT, 'pipeline/college/archive.py'), 'utf8')), 'archive.py must not upload')
  assert.match(readFileSync(path.join(ROOT, 'pipeline/college/mac_pull.sh'), 'utf8'), /openssl enc -aes-256-cbc/)
})

test('every tool answers', async () => {
  const s = idx.default_season
  const d = read(`s/${s}.json`)
  const t = read(`teams/${s}.json`).teams[0]
  const p = d.players[0]
  const f = await call('cbb_search_players', { query: p[1] })
  assert.ok(f.players.some((x) => x.id === p[0]))
  const c = await call('cbb_player_career', { player: p[0] })
  assert.ok(c.seasons.length >= 1)
  const sp = await call('cbb_player_splits', { player: p[0], season: s })
  assert.ok(sp.games.length >= 1)
  const lb = await call('cbb_leaderboard', { stat: 'ts', season: s })
  const col = M.column(d, 'ts', { adj: true, gt: false })
  assert.ok(Math.abs(lb.rows[0].value - col[d.players.findIndex((x) => x[0] === lb.rows[0].id)]) < 1e-9)
  for (let i = 1; i < lb.rows.length; i++) assert.ok(lb.rows[i].value <= lb.rows[i - 1].value)
  const tp = await call('cbb_team_profile', { team: t.id, season: s })
  assert.equal(tp.team.net, t.net)
  const tr = await call('cbb_team_rankings', { season: s, limit: 5 })
  assert.equal(tr.teams[0].id, t.id)
  const lu = await call('cbb_lineups', { team: t.id, season: s, size: 5 })
  assert.equal(lu.tracked, !!idx.seasons.find((x) => x.season === s).court)
  const g = read(`games/${s}.json`).rows[0]
  const gg = await call('cbb_game', { game_id: g[0], season: s })
  assert.equal(gg.game.home_pts, g[4])
  const dr = await call('cbb_data', { table: 'games', season: s, limit: 5 })
  assert.equal(dr.count, 5)
  const dp = await call('cbb_data', { table: 'player_games', season: s, team: t.id, limit: 3 })
  assert.equal(dp.count, 3)
  const dd = await call('cbb_data_dictionary')
  assert.equal(dd.stats.length, reg.stats.length)
})
