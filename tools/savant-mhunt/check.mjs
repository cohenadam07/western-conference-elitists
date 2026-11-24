// tools/savant-mhunt/check.mjs — Isolation targeting vs expected (mhunt), NBA Savant 2.8.0.
//
//   node --test tools/savant-mhunt/check.mjs      (part of npm run check:savant)
//
// 1. The math: tools/savant-mhunt/test_hunt.py (the hand-worked example) passes.
// 2. The files: mhunt = mhunt_faced − mhunt_exp in every cell; 2023-24 and a gated season in
//    progress are withheld with hunt.py's reason; notes are only "floor" or "not_tracked".
// 3. The connector holds the page's numbers: nba_leaderboard's values and percentiles are the
//    season file's values ranked the page's way (midrank among qualified players, higher =
//    targeted more); the profile marks it neutral, a floor player at_most, a not-tracked player
//    withheld with the reason; the career says why 2023-24 is missing; list_stats marks it neutral.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
const PUB = path.join(ROOT, 'public')
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-mhunt-'))
writeAll({ publicDir: PUB, dist, log: () => {} })
const json200 = (res, body) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.end(body) }
const html200 = (res) => { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); res.end('<!doctype html><title>WCE</title>') }
const cdn = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (/^\/(savant-ext)\/[\w/.-]+\.json$/.test(url)) {
    const f = path.join(PUB, url)
    return existsSync(f) ? json200(res, readFileSync(f)) : html200(res)
  }
  const file = path.join(dist, url)
  if (!file.startsWith(dist)) return html200(res)
  if (existsSync(file) && statSync(file).isFile()) return json200(res, readFileSync(file))
  if (existsSync(`${file}.gz`)) return json200(res, gunzipSync(readFileSync(`${file}.gz`)))
  return html200(res)
})
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let client
before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  const mcp = await import('../../api/mcp.js')
  const server = mcp.buildServer({ state: 'valid', id: 'abcdef012345' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  client = new Client({ name: 'check', version: '0' })
  await client.connect(b)
})
after(async () => { await client.close(); cdn.close(); rmSync(dist, { recursive: true, force: true }) })
const raw = async (name, args) => client.callTool({ name, arguments: args })
const call = async (name, args) => { const r = await raw(name, args); if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n')); return r.structuredContent ?? JSON.parse(r.content.map((c) => c.text).join('')) }
const errorOf = async (name, args) => { const r = await raw(name, args); assert.ok(r.isError, `${name} should refuse`); return r.content.map((c) => c.text).join('\n') }

const extFile = (s) => JSON.parse(readFileSync(path.join(PUB, 'savant-ext/s', `${s}.json`), 'utf8'))
const archive = JSON.parse(readFileSync(path.join(PUB, 'savant-data.json'), 'utf8')).data
const cellOf = (doc, id, key) => { const r = (doc.players[String(id)] || {}).season; return (r && r[doc.keys.indexOf(key)]) || null }
// the page's midrank percentile (ext_files._pct / pctOf): higher value = higher percentile here
const midrank = (v, pool) => { let less = 0, eq = 0; for (const x of pool) { if (x < v) less++; else if (x === v) eq++ } return Math.max(1, Math.min(99, Math.floor(100 * (less + 0.5 * eq) / pool.length + 0.5))) }
const S = '2025-26'

test('the hand-worked example (test_hunt.py) passes', () => {
  const out = execFileSync('python3', ['-W', 'ignore', path.join(ROOT, 'tools/savant-mhunt/test_hunt.py')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(true, out)
})

test('the season files: the parts add up, the notes are known, the withheld seasons say why', () => {
  for (const s of ['2017-18', '2021-22', '2024-25', S]) {
    const d = extFile(s)
    const [a, f, e] = ['mhunt', 'mhunt_faced', 'mhunt_exp'].map((k) => d.keys.indexOf(k))
    let n = 0
    for (const w of Object.values(d.players)) {
      const r = w.season
      if (!r || !r[a]) continue
      if (r[a].length > 2) assert.ok(['floor', 'not_tracked'].includes(r[a][2]), `${s}: note ${r[a][2]}`)
      if (r[a][0] == null) { assert.equal(r[a][2], 'not_tracked'); continue }
      assert.ok(Math.abs(r[a][0] - (r[f][0] - r[e][0])) < 0.002, `${s}: mhunt = faced − expected`)
      n++
    }
    assert.ok(n > 400, `${s}: ${n} defenders`)
    assert.ok(!d.withheld.mhunt, `${s}: not withheld`)
  }
  assert.match(extFile('2023-24').withheld.mhunt, /35 regular defenders/)
  assert.match(extFile('2026-27').withheld.mhunt, /isolation-defense table is still thin/)
})

test('nba_leaderboard is the season file ranked the page\'s way, and says it is context', async () => {
  const d = extFile(S)
  const q = new Set(archive[S].players.filter((p) => p.qualified).map((p) => String(p.id)))
  const pool = Object.entries(d.players).filter(([id]) => q.has(id)).map(([id]) => cellOf(d, id, 'mhunt')).filter((c) => c && c[0] != null).map((c) => c[0])
  const lb = await call('nba_leaderboard', { stat: 'mhunt', season: S, top: 15 })
  assert.equal(lb.stat.lower_is_better, false)
  assert.ok(lb.notes.some((n) => /context stat/.test(n)), 'says it is a context stat')
  for (const p of lb.players) {
    const c = cellOf(d, p.id, 'mhunt')
    assert.ok(Math.abs(p.value - c[0]) < 1e-9, `${p.name}: value`)
    assert.equal(p.percentile, midrank(c[0], pool), `${p.name}: percentile`)
  }
  assert.ok(lb.players[0].value >= lb.players[lb.players.length - 1].value, 'most targeted first')
  assert.match(await errorOf('nba_leaderboard', { stat: 'mhunt', season: '2023-24' }), /35 regular defenders/)
})

test('the profile: neutral, a bound, a reason', async () => {
  const d = extFile(S)
  const dort = (await call('nba_get_player_profile', { player: 'Luguentz Dort', season: S })).stats.find((x) => x.key === 'mhunt')
  assert.ok(dort && dort.neutral, 'Dort: mhunt, marked neutral')
  assert.ok(Math.abs(dort.value - cellOf(d, 1629652, 'mhunt')[0]) < 1e-9, 'Dort: the file\'s value')
  const q = new Set(archive[S].players.filter((p) => p.qualified).map((p) => String(p.id)))
  const byNote = (note) => Object.keys(d.players).find((id) => q.has(id) && (cellOf(d, id, 'mhunt') || [])[2] === note)
  const name = (id) => archive[S].players.find((p) => String(p.id) === id).name
  const fl = byNote('floor'), nt = byNote('not_tracked')
  assert.ok(fl && nt, 'a floor and a not-tracked qualified defender exist in 2025-26')
  const pf = await call('nba_get_player_profile', { player: name(fl), season: S })
  const fs = pf.stats.find((x) => x.key === 'mhunt')
  assert.ok(fs && fs.at_most && /10-isolation floor/.test(fs.note), `${name(fl)}: at most, with the reason`)
  const pn = await call('nba_get_player_profile', { player: name(nt), season: S })
  assert.ok(!pn.stats.some((x) => x.key === 'mhunt'), `${name(nt)}: no value`)
  assert.ok((pn.withheld || []).some((x) => x.key === 'mhunt' && /isolation table/.test(x.reason)), `${name(nt)}: says why`)
})

test('the career and list_stats', async () => {
  const car = await call('nba_player_career', { player: 'Luguentz Dort', stats: ['mhunt'] })
  const sr = car.series[0]
  assert.ok(sr.seasons.length >= 6, 'Dort: his mhunt seasons')
  assert.ok((sr.withheld || []).some((x) => x.season === '2023-24' && /35 regular defenders/.test(x.reason)), 'Dort: why 2023-24 is missing')
  const list = await call('savant_query', { dataset: 'nba_players', list_stats: true })
  const m = list.stats.find((x) => x.key === 'mhunt')
  assert.ok(m && m.neutral, 'list_stats: neutral')
  assert.ok(list.stats.find((x) => x.key === 'mhunt_faced') && list.stats.find((x) => x.key === 'mhunt_exp'), 'list_stats: its parts')
})
