// mtchc through the connector: the four tools that expose mtch return mtchc the same way
// (value, both percentiles, the low-sample flag), held to the page's own math; its parts are
// listed for leaderboards; mtchc_overall (data-only) is listed nowhere.
//
//   node --test tools/savant-mtchc/connector.mjs
//
// The same set-up as tools/savant-mcp/query.mjs: the connector's files are built from public/
// into a scratch folder and served from a local port, so there is no network.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { writeAll } from '../../scripts/lib/savant-api.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-mtchc-'))
writeAll({ publicDir: path.join(ROOT, 'public'), dist, log: () => {} })
const json200 = (res, body) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.end(body) }
const html200 = (res) => { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); res.end('<!doctype html><title>WCE</title>') }
const cdn = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (/^\/(savant-ext)\/[\w/.-]+\.json$/.test(url)) {
    const f = path.join(ROOT, 'public', url)
    return existsSync(f) ? json200(res, readFileSync(f)) : html200(res)
  }
  const file = path.join(dist, url)
  if (!file.startsWith(dist)) return html200(res)
  if (existsSync(file) && statSync(file).isFile()) return json200(res, readFileSync(file))
  if (existsSync(`${file}.gz`)) return json200(res, gunzipSync(readFileSync(`${file}.gz`)))
  return html200(res)
})
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let client, pub
async function clientFor(mcp, state) {
  const server = mcp.buildServer(state)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const c = new Client({ name: 'check', version: '0' })
  await c.connect(b)
  return c
}
before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  const mcp = await import('../../api/mcp.js')
  client = await clientFor(mcp, { state: 'valid', id: 'abcdef012345' })
})
after(async () => { await client.close(); cdn.close(); rmSync(dist, { recursive: true, force: true }) })
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n'))
  return r.structuredContent ?? JSON.parse(r.content.map((c) => c.text).join(''))
}

if (process.env.MTCHC_PEEK) {
  test('peek', async () => {
    const out = {}
    out.list = (await call('savant_query', { dataset: 'nba_players', list_stats: true })).stats.filter((s) => /mtch/.test(s.key))
    out.lb = await call('nba_leaderboard', { stat: 'mtchc', season: '2025-26', limit: 3 })
    out.prof = await call('nba_get_player_profile', { player: 'Luguentz Dort', season: '2025-26' })
    out.career = await call('nba_player_career', { player: 'Luguentz Dort', stats: ['mtch', 'mtchc'] })
    out.q = await call('savant_query', { dataset: 'nba_players', season: '2025-26', sort: { by: 'mtchc', order: 'best' }, show: ['mtchc_score', 'mtchc_create', 'mtch'], limit: 3 })
    ;(await import('node:fs')).writeFileSync(process.env.MTCHC_PEEK, JSON.stringify(out))
  })
}

const extFile = (s) => JSON.parse(readFileSync(path.join(ROOT, 'public/savant-ext/s', `${s}.json`), 'utf8'))
const cellOf = (doc, id, key) => { const r = (doc.players[String(id)] || {}).season; const c = r && r[doc.keys.indexOf(key)]; return c || null }
const THR = { mtchc: 560, mtchc_score: 600, mtchc_create: 500 }

test('list_stats carries mtchc and its two leaderboard parts from 2017-18, and never the data-only part', async () => {
  const stats = (await call('savant_query', { dataset: 'nba_players', list_stats: true })).stats
  const by = Object.fromEntries(stats.map((s) => [s.key, s]))
  for (const k of ['mtchc', 'mtchc_score', 'mtchc_create']) {
    assert.ok(by[k], `${k} listed`)
    assert.equal(by[k].since, '2017-18')
    assert.equal(by[k].lower_is_better, false)
  }
  assert.equal(by.mtchc.label, 'Matchup difficulty (creation-weighted)')
  assert.ok(!by.mtchc_overall, 'mtchc_overall is the Data Room\'s only')
})

test('a profile gives mtchc and its parts as the season file has them, low-sample flag at the measured threshold', async () => {
  const doc = extFile('2025-26')
  for (const player of ['Luguentz Dort', 'Stephon Castle', 'Dean Wade']) {
    const p = await call('nba_get_player_profile', { player, season: '2025-26' })
    const by = Object.fromEntries(p.stats.map((s) => [s.key, s]))
    assert.ok(!by.mtchc_overall, 'no data-only part on a profile')
    for (const k of Object.keys(THR)) {
      const c = cellOf(doc, p.player.id, k)
      assert.ok(c, `${player} ${k} in the file`)
      assert.equal(by[k].value, c[0], `${player} ${k} value`)
      assert.equal(by[k].low_sample, c[1] < THR[k], `${player} ${k} flag`)
      assert.ok(by[k].league_percentile >= 1 && by[k].league_percentile <= 99)
    }
    // the total rebuilds from its three parts (the Overall part is in the file for exactly this)
    const parts = ['mtchc_score', 'mtchc_create', 'mtchc_overall'].map((k) => cellOf(doc, p.player.id, k)[0])
    assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) / 3 - cellOf(doc, p.player.id, 'mtchc')[0]) < 0.002, `${player}: mtchc = mean of its parts`)
  }
})

test('the leaderboard and savant_query rank mtchc the way the season file does', async () => {
  const lb = await call('nba_leaderboard', { stat: 'mtchc', season: '2025-26' })
  assert.equal(lb.stat.settles_around.sample, 1600)
  assert.equal(lb.stat.settles_around.hatched_under, 560)
  assert.match(lb.stat.what, /not how well he defends them/)
  const vals = lb.players.map((r) => r.value)
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), 'best first')
  const doc = extFile('2025-26')
  for (const r of lb.players) assert.equal(r.value, cellOf(doc, r.id, 'mtchc')[0], r.name)
  const q = await call('savant_query', { dataset: 'nba_players', season: '2025-26', sort: { by: 'mtchc', order: 'best' }, show: ['mtchc_score', 'mtchc_create', 'mtch'], limit: 10 })
  // the same ten through savant_query, in the same order of value (ties may fall either way)
  const top = lb.players.slice(0, 10)
  assert.deepEqual(q.rows.map((r) => r.stats.mtchc.value), top.map((r) => r.value), 'same values, same order')
  assert.deepEqual(new Set(q.rows.map((r) => r.id)), new Set(top.map((r) => r.id)), 'same ten defenders')
  for (const r of q.rows) for (const k of ['mtchc_score', 'mtchc_create']) assert.equal(r.stats[k].value, cellOf(doc, r.id, k)[0])
})

test('in the season in progress a defender under 560 matchup possessions is flagged low sample', async () => {
  const q = await call('savant_query', { dataset: 'nba_players', season: '2026-27', sort: { by: 'mtchc', order: 'best' }, limit: 100 })
  const doc = extFile('2026-27')
  let low = 0
  for (const r of q.rows) {
    const c = cellOf(doc, r.id, 'mtchc')
    if (!c) continue
    assert.equal(r.stats.mtchc.low_sample, c[1] < 560, r.name)
    if (c[1] < 560) low++
  }
  assert.ok(low > 0, 'early in the season some qualified defenders are still under the threshold')
})

test('the career series starts in 2017-18 at the earliest, and follows mtch season for season', async () => {
  const c = await call('nba_player_career', { player: 'Jrue Holiday', stats: ['mtch', 'mtchc'] })
  const [m, mc] = c.series
  assert.equal(mc.key, 'mtchc')
  assert.ok(mc.seasons.every((s) => s.season >= '2017-18'), 'nothing before the matchup data')
  assert.deepEqual(mc.seasons.map((s) => s.season), m.seasons.map((s) => s.season), 'the seasons mtch has')
})
