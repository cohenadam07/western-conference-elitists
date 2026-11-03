// Check for WCE Pro (beta): savant_query (api/_query.js), the assistant's own filters, groups and
// summaries over Basketball Savant and Football Savant.
//
//   npm run check:savant-query      (node --test tools/savant-mcp/query.mjs)
//
// Four questions, in order of how much they matter:
//
//   1. Who can see it. Only a connection with a real WCE key lists or calls savant_query. The
//      public address, an unknown key and a key the store could not check get exactly the
//      tools they had before.
//   2. Are its numbers the pages' numbers. Every value and every percentile it returns is the
//      one in the Savant API files (check:savant-api and check:savant-football tie those to the
//      pages); the October 2026 basketball additions are the ones extCells() ranks for the
//      profile and the leaderboard. It never makes a percentile of its own.
//   3. Does it do what it says. Its filters keep exactly the rows they should; its sort agrees
//      with the Leaderboard Builders; each group number is the arithmetic it claims, over the
//      players it claims, and is labeled computed.
//   4. When a question cannot be answered (a stat that is not there, a season before a stat
//      existed, a sum of a rate, too many seasons), it says what to do instead of guessing.
//
// The data is built from public/ and served from a local port, as check:savant-mcp does it, so
// there is no network and no dependence on what is live.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { writeAll } from '../../scripts/lib/savant-api.mjs'
import { startStore } from './redis.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-query-'))
writeAll({ publicDir: path.join(ROOT, 'public'), dist, log: () => {} })

const read = (rel) => {
  const f = path.join(dist, rel)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  return JSON.parse(gunzipSync(readFileSync(`${f}.gz`)))
}
const nbaMeta = read('savant-api/basketball/v1/meta.json')
const nflMeta = read('savant-api/football/v1/meta.json')
const nbaSeason = (s) => read(`savant-api/basketball/v1/seasons/${s}.json`)
const nflSeason = (s) => read(`savant-api/football/v1/seasons/${s}.json`)
// A finished season with full pools, for the numbers.
const FULL = nbaMeta.seasons.find((s) => ((nbaMeta.qualified[s] || {}).league || 0) >= 200 && !nbaSeason(s).in_progress)
const NFL_FULL = nflMeta.seasons.find((s) => !nflSeason(s).week)

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

const store = await startStore()
let Q, mcp, ext, core, nbaLists, nflLists, keyedClient

// A client on buildServer() directly, for a given key state.
async function clientFor(state) {
  const server = mcp.buildServer(state)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const c = new Client({ name: 'check', version: '0' })
  await c.connect(b)
  return c
}

before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  Q = await import('../../api/_query.js')
  mcp = await import('../../api/mcp.js')
  ext = await import('../../api/_basketball-ext.js')
  core = await import('../../api/_core.js')
  nbaLists = await import('../../api/_basketball-lists.js')
  nflLists = await import('../../api/_football-lists.js')
  keyedClient = await clientFor({ state: 'valid', id: 'abcdef012345' })
})

after(async () => {
  if (store) await store.stop()
  await keyedClient.close()
  cdn.close()
  rmSync(dist, { recursive: true, force: true })
})

// Through the real MCP server, so the result is held to the declared output shape.
async function ask(args) {
  const r = await keyedClient.callTool({ name: 'savant_query', arguments: args })
  if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n'))
  return r.structuredContent
}
async function refused(args, re) {
  const r = await keyedClient.callTool({ name: 'savant_query', arguments: args })
  assert.ok(r.isError, `expected a refusal for ${JSON.stringify(args)}`)
  assert.match(r.content.map((c) => c.text).join('\n'), re)
}

// ---- 1. who can see it -------------------------------------------------------------------

test('only a real key lists and calls savant_query; every other address gets the public list, unchanged', async () => {
  const names = async (state) => { const c = await clientFor(state); try { return (await c.listTools()).tools.map((t) => t.name) } finally { await c.close() } }
  const pub = await names({ state: 'none' })
  assert.ok(!pub.includes('savant_query'), 'the public address does not list it')
  for (const state of ['unknown', 'unchecked']) assert.deepEqual(await names({ state }), pub, `${state}: the same list as the public address`)
  const keyed = await names({ state: 'valid', id: 'abcdef012345' })
  assert.deepEqual(keyed.filter((n) => !mcp.PRO_TOOLS.includes(n)), pub, 'a key adds, never takes away')
  assert.deepEqual(keyed.filter((n) => !pub.includes(n)), mcp.PRO_TOOLS)
  assert.deepEqual(mcp.PRO_TOOLS, ['savant_query', 'nfl_league'])

  // Calling it without a key is refused like any tool the server does not have.
  const c = await clientFor({ state: 'none' })
  try {
    const r = await c.callTool({ name: 'savant_query', arguments: { dataset: 'nba_players' } }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }))
    assert.ok(r.isError)
  } finally { await c.close() }

  // What each address tells the AI.
  assert.match(mcp.instructionsFor('valid'), /opens the WCE Pro beta/)
  assert.match(mcp.instructionsFor('valid'), /list_stats: true/)
  assert.match(mcp.instructionsFor('none'), /A key also opens the WCE Pro beta/)
  assert.doesNotMatch(mcp.instructionsFor('unknown'), /Pro beta/)

  // Its description is the length the directory review expects, and it is read-only.
  const t = (await keyedClient.listTools()).tools.find((x) => x.name === 'savant_query')
  assert.ok(t.description.length > 80 && t.description.length < 1300, `description is ${t.description.length} characters`)
  // What Pro adds to what an assistant reads up front. The public list has its own budget in
  // check:savant-mcp; Pro may add at most this much on top of it.
  const pro = JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length
  assert.ok(pro < 4500, `savant_query adds ${pro} characters to what a key holder's assistant reads up front`)
  assert.equal(t.annotations.readOnlyHint, true)
  assert.equal(t.annotations.destructiveHint, false)
})

test('end to end: a real key in the address opens it; the public address and a made-up key do not', { skip: store ? false : 'redis-server is not installed here' }, async () => {
  const keys = await import('../../api/_keys.js')
  process.env.KV_REST_API_URL = store.url
  process.env.KV_REST_API_TOKEN = store.token
  await store.send(['FLUSHALL'])
  keys.resetKeys()
  const app = http.createServer(async (req, res) => {
    const chunks = []
    for await (const ch of req) chunks.push(ch)
    const raw = Buffer.concat(chunks).toString('utf8')
    Object.defineProperty(req, 'body', { get() { return raw ? JSON.parse(raw) : undefined } })
    mcp.default(req, res)
  })
  const endpoint = `http://127.0.0.1:${await listen(app)}/api/mcp`
  const listFrom = async (url) => {
    const c = new Client({ name: 'check', version: '0' })
    await c.connect(new StreamableHTTPClientTransport(new URL(url)))
    try { return { names: (await c.listTools()).tools.map((t) => t.name), c } } catch (e) { await c.close(); throw e }
  }
  try {
    const { key } = await keys.createKey({ email: 'fan@example.com', source: 'connector' })
    const pub = await listFrom(endpoint); await pub.c.close()
    const fake = await listFrom(`${endpoint}?key=wce_${'0'.repeat(32)}`); await fake.c.close()
    const own = await listFrom(`${endpoint}?key=${key}`)
    assert.ok(!pub.names.includes('savant_query'))
    assert.deepEqual(fake.names, pub.names)
    assert.ok(own.names.includes('savant_query'))
    const r = await own.c.callTool({ name: 'savant_query', arguments: { dataset: 'nba_players', season: FULL, limit: 3 } })
    assert.ok(!r.isError, JSON.stringify(r.content))
    assert.equal(r.structuredContent.rows.length, 3)
    await own.c.close()
  } finally {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    keys.resetKeys()
    app.close()
  }
})

// ---- 2. the numbers are the pages' numbers ---------------------------------------------------

test('NBA: every value, both percentiles and every low-sample flag are the file\'s, core stats and additions alike', async () => {
  const file = nbaSeason(FULL)
  const byId = new Map(file.players.map((p) => [String(p.id), p]))
  const extMetrics = nbaMeta.metrics.filter((m) => m.ext)
  const xf = JSON.parse(readFileSync(path.join(ROOT, 'public/savant-ext/s', `${FULL}.json`), 'utf8'))
  const cells = ext.extCells(xf, file, 'season', extMetrics)
  const core0 = nbaMeta.metrics.filter((m) => !m.ext && file.players.some((p) => p.m[m.key]))
  const ext0 = extMetrics.filter((m) => [...cells.values()].some((c) => c[m.key]))
  let checked = 0
  // Every stat on the card, ten at a time, for the 100 qualified players with the most minutes
  // and the 100 with the fewest.
  for (const set of [core0, ext0]) {
    for (let i = 0; i < set.length; i += 10) {
      const show = set.slice(i, i + 10).map((m) => m.key)
      const out = await ask({ dataset: 'nba_players', season: FULL, show, sort: { by: 'min', order: 'high' }, limit: 100 })
      const rest = await ask({ dataset: 'nba_players', season: FULL, show, sort: { by: 'min', order: 'low' }, limit: 100 })
      for (const row of [...out.rows, ...rest.rows]) {
        const p = byId.get(row.id)
        assert.ok(p && p.qualified, row.id)
        for (const key of show) {
          const m = nbaMeta.metrics.find((x) => x.key === key)
          const want = m.ext ? (cells.get(String(p.id)) || {})[key] : p.m[key]
          const got = row.stats[key]
          if (!want || want[0] == null) { assert.equal(got.value, null, `${p.name} ${key}`); continue }
          assert.equal(got.value, want[0], `${p.name} ${key} value`)
          assert.equal(got.pct_league, want[1] ?? null, `${p.name} ${key} league percentile`)
          assert.equal(got.pct_position, want[2] ?? null, `${p.name} ${key} position percentile`)
          const low = m.ext ? (want[3] != null && !!m.lowSampleBelow && want[3] < m.lowSampleBelow) : (p.low || []).includes(key)
          assert.equal(got.low_sample, low, `${p.name} ${key} low sample`)
          checked++
        }
      }
    }
  }
  assert.ok(checked > 20000, `checked ${checked} cells`)
})

test('NFL: every value, both percentiles and every low-sample flag are the file\'s', async () => {
  const file = nflSeason(NFL_FULL)
  const byId = new Map(file.players.map((p) => [String(p.id), p]))
  let checked = 0
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'CB', 'ED']) {
    // m and xm together, as nfl_leaderboard reads them (xm: numbers outside his own panels)
    const cellOf = (p, k) => (p.m && p.m[k]) || (p.xm && p.xm[k]) || null
    const keys = nflMeta.metrics.filter((m) => m.positions.includes(pos) && file.players.some((p) => p.pos === pos && cellOf(p, m.key))).map((m) => m.key)
    for (let i = 0; i < keys.length; i += 10) {
      const show = keys.slice(i, i + 10)
      const out = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: pos, show, limit: 100 })
      for (const row of out.rows) {
        const p = byId.get(row.id)
        assert.equal(p.pos, pos)
        for (const key of show) {
          const want = cellOf(p, key)
          const got = row.stats[key]
          if (!want || want[0] == null) { assert.equal(got.value, null); continue }
          assert.deepEqual([got.value, got.pct_season, got.pct_all_time, got.low_sample], [want[0], want[1] ?? null, want[2] ?? null, (p.low || []).includes(key) || (p.xlow || []).includes(key)], `${p.name} ${key}`)
          checked++
        }
      }
    }
  }
  assert.ok(checked > 5000, `checked ${checked} cells`)
})

// ---- 3. it does what it says ------------------------------------------------------------------

test('filters keep exactly the rows they should, on values, percentiles of either pool and fields', async () => {
  const file = nbaSeason(FULL)
  const wings = file.players.filter((p) => p.qualified && p.pos === 'Wing')
  const ts = (p) => p.m.ts
  const want = wings.filter((p) => ts(p) && ts(p)[2] >= 60 && ext.wholeAge(p, FULL) <= 25).map((p) => String(p.id)).sort()
  const out = await ask({ dataset: 'nba_players', season: FULL, position: 'Wing', where: [{ stat: 'ts', op: 'gte', value: 60, on: 'percentile' }, { stat: 'age', op: 'lte', value: 25 }], limit: 100 })
  assert.equal(out.matching, want.length)
  assert.deepEqual(out.rows.map((r) => r.id).sort(), want)
  for (const r of out.rows) assert.ok(r.stats.ts.pct_position >= 60 && r.age <= 25)

  // The league pool reads the league percentile, not the position one.
  const lg = await ask({ dataset: 'nba_players', season: FULL, where: [{ stat: 'ts', op: 'gte', value: 90, on: 'percentile', pool: 'league' }], limit: 100 })
  assert.equal(lg.matching, file.players.filter((p) => p.qualified && p.m.ts && p.m.ts[1] >= 90).length)

  // between, on a value; and qualified_only: false lets everyone in.
  const all = await ask({ dataset: 'nba_players', season: FULL, qualified_only: false, where: [{ stat: 'mpg', op: 'between', value: [10, 14.9] }], limit: 100 })
  assert.equal(all.matching, file.players.filter((p) => p.m.mpg && p.m.mpg[0] >= 10 && p.m.mpg[0] <= 14.9).length)
  assert.ok(all.rows.some((r) => !r.qualified))

  // NFL: the all-time pool is the second percentile; the season pool the first.
  const nf = nflSeason(NFL_FULL)
  const wr = nf.players.filter((p) => p.qualified && p.pos === 'WR')
  const at = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', where: [{ stat: 'epatgt', op: 'gte', value: 80, on: 'percentile', pool: 'all_time' }], limit: 100 })
  assert.equal(at.matching, wr.filter((p) => p.m.epatgt && p.m.epatgt[2] >= 80).length)
  const se = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', where: [{ stat: 'epatgt', op: 'gte', value: 80, on: 'percentile' }], limit: 100 })
  assert.equal(se.matching, wr.filter((p) => p.m.epatgt && p.m.epatgt[1] >= 80).length)
})

test('the sort agrees with the Leaderboard Builders, lower-is-better stats included', async () => {
  const lower = nbaMeta.metrics.find((m) => !m.ext && m.lowerIsBetter && nbaSeason(FULL).players.some((p) => p.qualified && p.m[m.key]))
  assert.ok(lower, 'a lower-is-better stat to test with')
  const extStat = nbaMeta.metrics.find((m) => m.ext && m.key === 'tmpts')
  for (const [stat, pos] of [['pts', 'All'], ['ts', 'Wing'], [lower.key, 'Guard'], [extStat.key, 'Big']]) {
    const lb = (await nbaLists.leaderboard({ stat, season: FULL, position: pos, estimate: 'raw', top: 40 })).structured
    const out = await ask({ dataset: 'nba_players', season: FULL, ...(pos === 'All' ? {} : { position: pos }), sort: { by: stat }, limit: 40 })
    const vals = (rows, f) => rows.map(f)
    assert.deepEqual(vals(out.rows, (r) => r.stats[stat].value), vals(lb.players, (r) => r.value), `${stat} ${pos}: the same values in the same order`)
    // Same players, once ties at the cut are set aside.
    const cut = lb.players[lb.players.length - 1].value
    const ids = (rows, v) => rows.filter((r) => v(r) !== cut).map((r) => r.id).sort()
    assert.deepEqual(ids(out.rows, (r) => r.stats[stat].value), ids(lb.players, (r) => r.value), `${stat} ${pos}: the same players`)
  }
  // 'worst' is the other end.
  const best = await ask({ dataset: 'nba_players', season: FULL, sort: { by: 'ts' }, limit: 5 })
  const worst = await ask({ dataset: 'nba_players', season: FULL, sort: { by: 'ts', order: 'worst' }, limit: 5 })
  assert.ok(best.rows[0].stats.ts.value > worst.rows[0].stats.ts.value)

  // NFL, against nfl_leaderboard. A finished season's board leaves out samples below the
  // stabilization threshold, which is what exclude_low_sample asks for; without it the thin
  // samples are kept and flagged.
  const lb = (await nflLists.leaderboard({ stat: 'epatgt', season: NFL_FULL, position: 'WR', top: 30 })).structured
  const out = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', sort: { by: 'epatgt' }, exclude_low_sample: true, limit: 30 })
  assert.deepEqual(out.rows.map((r) => r.stats.epatgt.value), lb.players.map((r) => r.value))
  assert.ok(out.rows.every((r) => !r.stats.epatgt.low_sample))
  const kept = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', sort: { by: 'epatgt' }, limit: 100 })
  assert.deepEqual(kept.rows.filter((r) => !r.stats.epatgt.low_sample).slice(0, 30).map((r) => r.stats.epatgt.value), lb.players.map((r) => r.value))
  assert.ok(kept.rows.some((r) => r.stats.epatgt.low_sample), 'without it, thin samples stay in, flagged')
})

test('each group number is the arithmetic it claims, over the players it claims, and is labeled computed', async () => {
  const file = nbaSeason(FULL)
  const q = file.players.filter((p) => p.qualified)
  const out = await ask({ dataset: 'nba_players', season: FULL, group_by: 'team', min_group_size: 1, limit: 100, summarize: [{ fn: 'count' }, { fn: 'mean', stat: 'ts' }, { fn: 'weighted_mean', stat: 'ts' }, { fn: 'median', stat: 'ts', on: 'percentile' }, { fn: 'max', stat: 'age' }] })
  assert.equal(out.mode, 'groups')
  assert.equal(out.matching, q.length)
  assert.equal(out.groups.reduce((n, g) => n + g.players, 0), q.length, 'every qualified player is in one group')
  assert.match(out.computed_note, /computed by this query/)
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} vs ${b}`)
  for (const g of out.groups) {
    const ps = q.filter((p) => p.team === g.group)
    assert.equal(g.players, ps.length, g.group)
    const [count, mean, wmean, med, maxAge] = g.aggregates
    assert.equal(count.value, ps.length)
    const v = ps.filter((p) => p.m.ts).map((p) => p.m.ts[0])
    close(mean.value, v.reduce((a, b) => a + b, 0) / v.length, `${g.group} mean`)
    const w = ps.filter((p) => p.m.ts && p.min > 0)
    close(wmean.value, w.reduce((a, p) => a + p.m.ts[0] * p.min, 0) / w.reduce((a, p) => a + p.min, 0), `${g.group} minutes-weighted mean`)
    const pc = ps.filter((p) => p.m.ts && p.m.ts[2] != null).map((p) => p.m.ts[2]).sort((a, b) => a - b)
    const mid = pc.length % 2 ? pc[(pc.length - 1) / 2] : (pc[pc.length / 2 - 1] + pc[pc.length / 2]) / 2
    close(med.value, mid, `${g.group} median position percentile`)
    assert.equal(maxAge.value, Math.max(...ps.map((p) => ext.wholeAge(p, FULL))))
    for (const a of g.aggregates.slice(1)) assert.equal(a.computed, true)
    assert.equal(wmean.weighting, 'weighted by minutes played')
  }
  // A stat some players have no value for: the mean is over the ones who do, and says how many.
  const gappy = nbaMeta.metrics.find((m) => !m.ext && m.unit !== 'word' && (() => { const have = q.filter((p) => p.m[m.key] && p.m[m.key][0] != null).length; return have > q.length / 2 && have < q.length - 10 })())
  assert.ok(gappy, 'a stat with gaps to test with')
  const gm = await ask({ dataset: 'nba_players', season: FULL, group_by: 'position', summarize: [{ fn: 'mean', stat: gappy.key }, { fn: 'min', stat: gappy.key }] })
  for (const g of gm.groups) {
    const v = q.filter((p) => p.pos === g.group && p.m[gappy.key] && p.m[gappy.key][0] != null).map((p) => p.m[gappy.key][0])
    assert.equal(g.aggregates[0].over, v.length, `${g.group}: over the players with a value`)
    close(g.aggregates[0].value, v.reduce((a, b) => a + b, 0) / v.length, `${g.group} mean ${gappy.key}, gaps left out`)
    close(g.aggregates[1].value, Math.min(...v), `${g.group} min ${gappy.key}`)
  }

  // Groups sort by the first summary unless told otherwise; count sorts high to low.
  const byCount = await ask({ dataset: 'nba_players', season: FULL, group_by: 'position', sort: { by: 'count' } })
  const counts = byCount.groups.map((g) => g.players)
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a))
  assert.deepEqual(byCount.groups.map((g) => g.group).sort(), ['Big', 'Guard', 'Wing'])
  // min_group_size leaves small groups out.
  const small = await ask({ dataset: 'nba_players', season: FULL, group_by: 'team', min_group_size: 13, summarize: [{ fn: 'count' }], limit: 100 })
  for (const g of small.groups) assert.ok(g.players >= 13)

  // NFL: weighted by the stat's own denominator.
  const nf = nflSeason(NFL_FULL)
  const g = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', group_by: 'team', min_group_size: 1, limit: 100, summarize: [{ fn: 'weighted_mean', stat: 'epatgt' }] })
  for (const grp of g.groups) {
    const ps = nf.players.filter((p) => p.qualified && p.pos === 'WR' && p.team === grp.group && p.m.epatgt && p.d && p.d.tgt > 0)
    if (!ps.length) continue
    close(grp.aggregates[0].value, ps.reduce((a, p) => a + p.m.epatgt[0] * p.d.tgt, 0) / ps.reduce((a, p) => a + p.d.tgt, 0), `${grp.group} target-weighted EPA/target`)
    assert.equal(grp.aggregates[0].weighting, 'weighted by targets')
    assert.equal(grp.aggregates[0].over, ps.length, `${grp.group}: over the players actually weighted`)
  }
})

test('several seasons at once: each row is from the range, and a stat that starts inside it is noted', async () => {
  const i = nbaMeta.seasons.indexOf(FULL)
  const range = nbaMeta.seasons.slice(i, i + 3)
  const out = await ask({ dataset: 'nba_players', season: range[2], through: range[0], group_by: 'season', summarize: [{ fn: 'count' }] })
  assert.deepEqual(out.seasons, range)
  assert.deepEqual(out.groups.map((g) => g.group).sort(), [...range].sort())
  for (const g of out.groups) assert.equal(g.players, nbaSeason(g.group).players.filter((p) => p.qualified).length)

  // A stat that begins in 1996-97, over a range that starts before it.
  const ts96 = nbaMeta.metrics.find((m) => !m.ext && m.since === '1996-97')
  const r = await ask({ dataset: 'nba_players', season: '1993-94', through: '1998-99', where: [{ stat: ts96.key, op: 'gte', value: -1e9 }], limit: 100 })
  assert.ok(r.rows.every((x) => +x.season.slice(0, 4) >= 1996))
  assert.ok(r.notes.some((n) => n.includes(`starts in 1996-97`)))
})

test('list_stats gives every key, and only the ones a position has', async () => {
  const n = await ask({ dataset: 'nba_players', list_stats: true })
  assert.equal(n.stats.length, nbaMeta.metrics.length)
  const wr = await ask({ dataset: 'nfl_players', list_stats: true, position: 'WR' })
  assert.equal(wr.stats.length, nflMeta.metrics.filter((m) => m.positions.includes('WR')).length)
  assert.ok(wr.stats.every((s) => s.positions.includes('WR')))
})

// ---- 4. when it cannot answer -----------------------------------------------------------------

test('it says what to do instead of guessing', async () => {
  await refused({ dataset: 'nba_players', season: FULL, show: ['zzz not a stat'] }, /No stat called "zzz not a stat".*list_stats/)
  await refused({ dataset: 'nba_players', season: FULL, show: ['rebound'] }, /fits \d+ stats/)
  await refused({ dataset: 'nba_players', season: '2000-01', through: FULL, limit: 5 }, /at most 10/)
  await refused({ dataset: 'nba_players', season: '1985-86', where: [{ stat: 'tmpts', op: 'gte', value: 1 }] }, /not tracked in 1985-86; it starts in 1996-97/)
  await refused({ dataset: 'nba_players', season: FULL, summarize: [{ fn: 'mean', stat: 'ts' }] }, /needs group_by/)
  await refused({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'sum', stat: 'ts' }] }, /sum adds up counts/)
  await refused({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'weighted_mean', stat: 'ts', on: 'percentile' }] }, /weighted_mean is for values/)
  await refused({ dataset: 'nba_players', season: FULL, where: [{ stat: 'ts', op: 'between', value: 5 }] }, /between takes two numbers/)
  await refused({ dataset: 'nba_players', season: FULL, where: [{ stat: 'age', op: 'gte', value: 20, on: 'percentile' }] }, /field, not a stat/)
  await refused({ dataset: 'nba_players', season: FULL, position: 'QB' }, /Guard, Wing or Big/)
  await refused({ dataset: 'nba_players', season: '2026' }, /season/i)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'QB', show: ['epatgt'] }, /not tracked for QB/)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, where: [{ stat: 'ts', op: 'gte', value: 1, on: 'percentile', pool: 'league' }] }, /No stat called "ts"|pool is season or all_time/)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', where: [{ stat: 'epatgt', op: 'gte', value: 50, on: 'percentile', pool: 'league' }] }, /pool is season or all_time/)
})

test('a season in progress says so', async () => {
  const live = nbaMeta.seasons.find((s) => nbaSeason(s).in_progress)
  if (!live) return
  const out = await ask({ dataset: 'nba_players', season: live, limit: 3 })
  assert.ok(out.notes.some((n) => /In progress/.test(n) && n.includes(live)))
})

// ---- the independent review's findings (3 Nov 2026), one test each -----------------------------

test('NFL: a weighted mean weighs only by a count every player has, and says over how many', async () => {
  // p2s is a rate of pressures faced, kept per player only for thin samples: refused, not misweighed
  const p2s = nflMeta.metrics.find((m) => m.den && !(nflMeta.denomCore || []).includes(m.den) && m.positions.includes('QB'))
  assert.ok(p2s, 'a QB stat with a non-core denominator')
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'QB', group_by: 'team', summarize: [{ fn: 'weighted_mean', stat: p2s.key }] }, /weigh the thin samples alone/)
  // NBA: over counts only the players with minutes to weigh by
  const out = await ask({ dataset: 'nba_players', season: FULL, qualified_only: false, group_by: 'position', summarize: [{ fn: 'weighted_mean', stat: 'ts' }] })
  const file = nbaSeason(FULL)
  for (const g of out.groups) assert.equal(g.aggregates[0].over, file.players.filter((p) => p.pos === g.group && p.m.ts && p.m.ts[0] != null && p.min > 0).length, g.group)
})

test('NFL: numbers outside a position\'s own panels (xm) count, as on nfl_leaderboard', async () => {
  const file = nflSeason(NFL_FULL)
  const wr = file.players.filter((p) => p.qualified && p.pos === 'WR')
  const key = nflMeta.metrics.filter((m) => m.positions.includes('WR')).map((m) => m.key).find((k) => wr.filter((p) => p.xm && p.xm[k] && !(p.m && p.m[k])).length > 10)
  assert.ok(key, 'a WR stat that lives in xm')
  const want = wr.filter((p) => (p.m && p.m[key]) || (p.xm && p.xm[key]))
  const out = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', where: [{ stat: key, op: 'gte', value: -1e9 }], limit: 100 })
  assert.equal(out.matching, want.length)
  const lb = (await nflLists.leaderboard({ stat: key, season: NFL_FULL, position: 'WR', top: 100, sample: 'raw' }).catch(() => nflLists.leaderboard({ stat: key, season: NFL_FULL, position: 'WR', top: 100 }))).structured
  for (const p of lb.players) assert.ok(out.rows.some((r) => r.id === String(p.id)) || out.matching > 100, `${p.name} is on nfl_leaderboard for ${key} and in the query`)
})

test('a percentile pool is held to the dataset\'s own, in filters, summaries and sorts alike', async () => {
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'QB', group_by: 'team', summarize: [{ fn: 'mean', stat: 'sav', on: 'percentile', pool: 'league' }] }, /pool is season or all_time/)
  await refused({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'mean', stat: 'ts', on: 'percentile', pool: 'all_time' }] }, /pool is position or league/)
  await refused({ dataset: 'nba_players', season: FULL, sort: { by: 'ts', on: 'percentile', pool: 'season' } }, /pool is position or league/)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'WR', sort: { by: 'epatgt', on: 'percentile', pool: 'position' } }, /pool is season or all_time/)
  // and a sort on a percentile shows that percentile, named
  const out = await ask({ dataset: 'nba_players', season: FULL, sort: { by: 'ts', on: 'percentile', pool: 'league' }, limit: 3 })
  assert.ok(out.rows.every((r) => r.stats.ts.pct_league != null))
  const text = (await keyedClient.callTool({ name: 'savant_query', arguments: { dataset: 'nba_players', season: FULL, sort: { by: 'ts', on: 'percentile', pool: 'league' }, limit: 3 } })).content[0].text
  assert.match(text, /sorted by True shooting % percentile vs\. league/)
  assert.match(text, /\(\d+(st|nd|rd|th) vs\. league\)/)
})

test('the sort stat is held to the same checks as every other stat named', async () => {
  await refused({ dataset: 'nba_players', season: '1985-86', sort: { by: 'tmpts' } }, /not tracked in 1985-86; it starts in 1996-97/)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'QB', sort: { by: 'epatgt' } }, /not tracked for QB/)
  const out = await ask({ dataset: 'nba_players', season: '1994-95', through: '1997-98', sort: { by: 'tmpts' }, limit: 5 })
  assert.ok(out.notes.some((n) => /sort last/.test(n)))
  assert.ok(out.rows.every((r) => r.stats.tmpts.value != null), 'the top of the sort has values')
})

test('groups sort by count even when count was not asked for; nothing asked to be shown is dropped', async () => {
  const g = await ask({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'mean', stat: 'ts' }], sort: { by: 'count' }, limit: 100 })
  const sizes = g.groups.map((x) => x.players)
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a))
  assert.equal(g.sort.by, 'count')

  const core0 = nbaMeta.metrics.filter((m) => !m.ext && m.since <= '1996-97' && nbaSeason(FULL).players.some((p) => p.qualified && p.m[m.key])).map((m) => m.key).filter((k) => k !== 'pts')
  const where = core0.slice(0, 8).map((k) => ({ stat: k, op: 'gte', value: -1e9 }))
  const show = core0.slice(8, 18)
  const out = await ask({ dataset: 'nba_players', season: FULL, qualified_only: false, where, show, sort: { by: 'pts' }, limit: 3 })
  for (const r of out.rows) for (const k of ['pts', ...core0.slice(0, 18)]) assert.ok(k in r.stats, `${k} is in the row`)
})

test('the NBA season in progress states its own qualifying line', async () => {
  const live = nbaMeta.seasons.find((s) => nbaSeason(s).in_progress && nbaSeason(s).qualify)
  if (!live) return
  const q = nbaSeason(live).qualify
  const out = await ask({ dataset: 'nba_players', season: live, limit: 1 })
  assert.match(out.scope, new RegExp(`${q.min_gp}\\+ games, pro-rated`))
  assert.doesNotMatch(out.scope, new RegExp(`${nbaMeta.qualify.min_gp}\\+ games\\)`))
})

test('names that are not stats, fields or positions are refused in words, never as a crash', async () => {
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await refused({ dataset: 'nba_players', season: FULL, where: [{ stat: bad, op: 'gte', value: 1 }] }, /No stat called/)
    await refused({ dataset: 'nba_players', season: FULL, sort: { by: bad } }, /No stat called/)
    await refused({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'mean', stat: bad }] }, /No stat called/)
    await refused({ dataset: 'nba_players', season: FULL, position: bad }, /Guard, Wing or Big/)
    await refused({ dataset: 'nfl_players', season: NFL_FULL, position: bad }, /position/)
    // the free nfl_leaderboard shares the position parser
    await assert.rejects(nflLists.leaderboard({ position: bad }), /not a Football Savant position/)
  }
  // a key in any case
  const out = await ask({ dataset: 'nba_players', season: FULL, show: ['TS'], limit: 1 })
  assert.ok('ts' in out.rows[0].stats)
})

test('NFL positions and teams: OL is the whole line, "edge" works, old codes and trades are found', async () => {
  const file = nflSeason(NFL_FULL)
  const ol = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'OL', sort: { by: 'g', order: 'high' }, limit: 100 })
  assert.equal(ol.matching, file.players.filter((p) => p.qualified && ['OL', 'OT', 'OG', 'OC'].includes(p.pos)).length)
  assert.ok(ol.matching > 0)
  assert.ok(ol.notes.some((n) => /OL covers the whole line/.test(n)))
  const ed = await ask({ dataset: 'nfl_players', season: NFL_FULL, position: 'edge', limit: 5 })
  assert.ok(ed.rows.every((r) => r.position === 'ED'))
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'team' }, /savant_query is for players/)

  // a player traded during the season is found under the team he left
  const traded = file.players.find((p) => p.qualified && Array.isArray(p.tms) && p.tms.length > 1 && p.tms[0] !== p.team)
  assert.ok(traded, 'a traded player to test with')
  const t = await ask({ dataset: 'nfl_players', season: NFL_FULL, team: traded.tms[0], position: traded.pos, limit: 100 })
  assert.ok(t.rows.some((r) => r.id === String(traded.id)), `${traded.name} counts for ${traded.tms[0]}`)

  // an old code finds the franchise in the seasons it was used, and is shown as it was
  const [now, [last, old]] = Object.entries(nflMeta.era).find(([, e]) => nflMeta.seasons.includes(String(e[0])))
  const was = await ask({ dataset: 'nfl_players', season: String(last), team: old, limit: 100 })
  assert.ok(was.matching > 0, `${old} in ${last}`)
  // shown as it was; a player who left during that season shows the team he finished with
  const then = new Map(nflSeason(String(last)).players.map((p) => [String(p.id), p]))
  assert.ok(was.rows.every((r) => r.team === old || ((then.get(r.id).tms || []).includes(now) && then.get(r.id).team !== now)))
  assert.ok(was.rows.some((r) => r.team === old))
  const same = await ask({ dataset: 'nfl_players', season: String(last), team: now, limit: 100 })
  assert.equal(same.matching, was.matching)
})

test('sum adds up counts only, and adds them right', async () => {
  await refused({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'sum', stat: 'syn' }] }, /sum adds up counts/)
  await refused({ dataset: 'nfl_players', season: NFL_FULL, position: 'K', group_by: 'team', summarize: [{ fn: 'sum', stat: 'fglong' }] }, /sum adds up counts/)
  const out = await ask({ dataset: 'nba_players', season: FULL, group_by: 'team', min_group_size: 1, limit: 100, summarize: [{ fn: 'sum', stat: 'min' }, { fn: 'sum', stat: 'gp' }] })
  const q = nbaSeason(FULL).players.filter((p) => p.qualified)
  for (const g of out.groups) {
    const ps = q.filter((p) => p.team === g.group)
    assert.equal(g.aggregates[0].value, ps.reduce((a, p) => a + p.min, 0), `${g.group} minutes`)
    assert.equal(g.aggregates[1].value, ps.reduce((a, p) => a + p.gp, 0), `${g.group} games`)
  }
})

test('NFL reads at most 8 seasons a call; group examples follow the order asked; between reads either way', async () => {
  const i = nflMeta.seasons.indexOf(NFL_FULL)
  const nine = nflMeta.seasons.slice(i, i + 9)
  await refused({ dataset: 'nfl_players', season: nine[8], through: nine[0] }, /at most 8/)

  const worst = await ask({ dataset: 'nba_players', season: FULL, group_by: 'team', summarize: [{ fn: 'mean', stat: 'ts' }], sort: { order: 'worst' }, limit: 1 })
  const g = worst.groups[0]
  const ts = (id) => nbaSeason(FULL).players.find((p) => String(p.id) === id).m.ts[0]
  const team = nbaSeason(FULL).players.filter((p) => p.qualified && p.team === g.group && p.m.ts).map((p) => p.m.ts[0]).sort((a, b) => a - b)
  assert.deepEqual(g.examples.map((e) => ts(e.id)), team.slice(0, 3), 'the worst team\'s examples are its worst shooters')

  const a = await ask({ dataset: 'nba_players', season: FULL, where: [{ stat: 'mpg', op: 'between', value: [30, 9] }], limit: 1 })
  const b = await ask({ dataset: 'nba_players', season: FULL, where: [{ stat: 'mpg', op: 'between', value: [9, 30] }], limit: 1 })
  assert.equal(a.matching, b.matching)
  assert.match(a.filters[0], /between 9 and 30/)
})
