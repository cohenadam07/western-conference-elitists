// tools/savant-withheld/check.mjs — Basketball Savant 2.7.1: withheld stats say why, Synergy ids
// filed wrong are matched by name, players the Synergy feed leaves out are labelled.
//
//   node --test tools/savant-withheld/check.mjs      (part of npm run check:savant)
//
// 1. Every season file's "withheld" map is the rule (ext_files.withheld): each withheld stat has
//    no value for anyone that season; swr is withheld every season it exists; the five columns
//    the NBA published broken in 2024-25 carry the broken reason.
// 2. The connector says the reason: the profile lists it, the career series marks the seasons,
//    the leaderboard and savant_query refuse with it, list_stats marks it.
// 3. Teodosic 2017-18 has play types (Synergy id 267634 matched by name); Cedi Osman 2018-19 (left
//    out of every Synergy table by the NBA) gets the "not in the NBA's Synergy tables" answer.
// 4. The page carries the reason row, the builder's withheld chip and the Synergy label.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { writeAll } from '../../scripts/lib/savant-api.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUB = path.join(ROOT, 'public')
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-withheld-'))
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
const call = async (name, args) => {
  const r = await raw(name, args)
  if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n'))
  return r.structuredContent ?? JSON.parse(r.content.map((c) => c.text).join(''))
}
const errorOf = async (name, args) => { const r = await raw(name, args); assert.ok(r.isError, `${name} should refuse`); return r.content.map((c) => c.text).join('\n') }

const SDIR = path.join(PUB, 'savant-ext', 's')
const seasonFile = (s) => JSON.parse(readFileSync(path.join(SDIR, `${s}.json`), 'utf8'))
const SWR_SEASONS = ['2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27']
const SWR_WHY = 'The NBA published switches as zero in every game this season'

test('every season file says which stats nobody has, and only those', () => {
  let files = 0
  for (const fn of readdirSync(SDIR).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(path.join(SDIR, fn), 'utf8'))
    assert.ok(d.withheld && typeof d.withheld === 'object', `${fn}: carries a withheld map`)
    for (const k of Object.keys(d.withheld)) {
      const i = d.keys.indexOf(k)
      assert.ok(i >= 0, `${fn}: ${k} is a key`)
      const someone = Object.values(d.players).some((w) => w.season && w.season[i] && w.season[i][0] != null)
      assert.ok(!someone, `${fn}: ${k} is withheld but someone has it`)
      assert.ok(d.withheld[k].length > 20, `${fn}: ${k} has a reason`)
    }
    files++
  }
  assert.ok(files >= 30, `${files} season files`)
  for (const s of SWR_SEASONS) assert.match(seasonFile(s).withheld.swr || '', new RegExp(SWR_WHY), `${s}: swr withheld with its reason`)
  const b = seasonFile('2024-25').withheld
  for (const k of ['drvft', 'drvpts', 'top75', 'spt', 'ftast75']) assert.match(b[k] || '', /broken/, `2024-25 ${k}: the broken reason`)
  for (const s of ['2010-11', '2016-17']) assert.deepEqual(seasonFile(s).withheld, {}, `${s}: nothing withheld`)
  const w = JSON.parse(readFileSync(path.join(PUB, 'savant-ext', 'withheld.json'), 'utf8'))
  assert.ok(w.keys.includes('swr') && w.seasons['2025-26'].swr, 'withheld.json carries the finished seasons')
})

test('the connector gives the reason instead of a blank', async () => {
  const prof = await call('nba_get_player_profile', { player: 'Luguentz Dort', season: '2025-26' })
  const wh = (prof.withheld || []).find((x) => x.key === 'swr')
  assert.ok(wh && wh.reason.includes(SWR_WHY), 'profile lists swr as withheld, with the reason')
  assert.ok(!(prof.stats || []).some((x) => x.key === 'swr'), 'and shows no swr value')

  const car = await call('nba_player_career', { player: 'Luguentz Dort', stats: ['swr', 'mtov'] })
  const sw = car.series.find((x) => x.key === 'swr'), mt = car.series.find((x) => x.key === 'mtov')
  assert.deepEqual(sw.seasons, [], 'no swr values in any season')
  assert.ok(sw.withheld && sw.withheld.length >= 7 && sw.withheld.every((x) => x.reason.includes(SWR_WHY)), 'career marks the withheld seasons')
  assert.ok(!mt.withheld && mt.seasons.length >= 7, 'a stat with values is untouched')

  assert.match(await errorOf('nba_leaderboard', { stat: 'swr', season: '2025-26' }), new RegExp(SWR_WHY), 'leaderboard refuses with the reason')
  assert.match(await errorOf('savant_query', { dataset: 'nba_players', season: '2025-26', sort: { by: 'swr', order: 'high' } }), new RegExp(SWR_WHY), 'savant_query refuses with the reason')
  const list = await call('savant_query', { dataset: 'nba_players', list_stats: true })
  const ls = list.stats.find((x) => x.key === 'swr')
  assert.ok(ls && ls.withheld && ls.withheld.reason.includes(SWR_WHY), 'list_stats marks it')
  assert.ok(!list.stats.find((x) => x.key === 'mtov').withheld, 'and nothing else that has values')
})

test('Synergy: a wrong id is matched by name; a player the feed leaves out is labelled', async () => {
  const t = await call('nba_player_splits', { player: 'Milos Teodosic', season: '2017-18', view: 'play_types' })
  assert.ok(JSON.stringify(t).includes('PRBallHandler') || JSON.stringify(t).toLowerCase().includes('pick-and-roll'), 'Teodosic 2017-18 has play types')
  const d = await call('nba_player_splits', { player: 'Mike James', season: '2020-21', view: 'defensive_play_types' })
  assert.ok(JSON.stringify(d).toLowerCase().includes('spot'), 'Mike James 2020-21 has defensive play types')
  assert.match(await errorOf('nba_player_splits', { player: 'Cedi Osman', season: '2018-19', view: 'play_types' }), /not in the NBA's Synergy tables/, 'Osman 2018-19: says why')
  assert.match(await errorOf('nba_player_splits', { player: 'Cedi Osman', season: '2018-19', view: 'defensive_play_types' }), /not in the NBA's Synergy tables/, 'and for defense')
  const pan = JSON.parse(readFileSync(path.join(PUB, 'savant-ext', 'panels', '2018-19.json'), 'utf8')).players
  assert.equal((pan['1626224'] || {}).nis, 1, 'Osman 2018-19 is flagged in the panels file')
  assert.ok(!(pan['1628462'] || {}).nis && (pan['1628462'] || {}).dpt, 'Teodosic 2018-19 is not flagged and has his defensive play types')
})

test('the page says the reason on the card and in the builder', () => {
  const html = readFileSync(path.join(PUB, 'basketball-savant.html'), 'utf8')
  for (const s of ['function withheldRow(m,why)', 'EXT.wh[season]=j.withheld||{};', "lb-colchip'+(LB.cols.indexOf(k)>=0?' on':'')+(why?' wh':'')",
    'var rwhy=rm&&rm.ext?extWithheld(rm.key,LB.season):null;', 'const NIS_TEXT=', "if(pan.nis&&!pan.dpt)", "var VERSION='2.7.1';"]) {
    assert.ok(html.includes(s), `page: ${s}`)
  }
})
