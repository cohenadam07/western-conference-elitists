// tools/accents/connector.mjs — accented names out, unaccented names in (Basketball Savant 2.8.1).
//
//   node --test tools/accents/connector.mjs      (part of npm run check:savant)
//
// Now that the files carry "Nikola Jokić", "Luka Dončić", "Kristaps Porziņģis" and "Audric
// Estimé", the connector must still resolve the plain spellings people type, and answer with the
// accented ones: nba_search_players, nba_get_player_profile and nba_player_career by name, and
// nfl_search_players / nfl_get_player_profile for Estimé. savant_query takes no player name (it
// filters by stats, team and position), so its check is that its rows carry the accented spelling.
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
const PUB = path.join(ROOT, 'public')
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-accents-'))
writeAll({ publicDir: PUB, dist, log: () => {}, warn: () => {} })
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
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  if (r.isError) throw new Error(`${name} ${JSON.stringify(args)}: ${r.content.map((c) => c.text).join('\n')}`)
  return r.structuredContent ?? JSON.parse(r.content.map((c) => c.text).join(''))
}

const NBA = [['Nikola Jokic', 'Nikola Jokić'], ['Luka Doncic', 'Luka Dončić'], ['Kristaps Porzingis', 'Kristaps Porziņģis']]

test('NBA: typed without accents, found and answered with them', async () => {
  for (const [typed, shown] of NBA) {
    const s = await call('nba_search_players', { query: typed })
    assert.equal(s.players[0].name, shown, `search "${typed}"`)
    const p = await call('nba_get_player_profile', { player: typed })
    assert.equal(p.player.name, shown, `profile "${typed}"`)
    const c = await call('nba_player_career', { player: typed })
    assert.equal(c.player.name, shown, `career "${typed}"`)
  }
  const lower = await call('nba_search_players', { query: 'jokic' })
  assert.equal(lower.players[0].name, 'Nikola Jokić', 'search "jokic"')
})

test('savant_query takes no name; its rows carry the accented spelling', async () => {
  const q = await call('savant_query', { dataset: 'nba_players', season: '2025-26', team: 'DEN', sort: { by: 'pts', order: 'high' }, limit: 5 })
  const names = JSON.stringify(q)
  assert.match(names, /Nikola Jokić/)
  assert.doesNotMatch(names, /Nikola Jokic\b/)
})

test('Football Savant: "Audric Estime" finds Audric Estimé', async () => {
  const s = await call('nfl_search_players', { query: 'Audric Estime' })
  assert.equal(s.players[0].name, 'Audric Estimé')
  const p = await call('nfl_get_player_profile', { player: 'Audric Estime' })
  assert.equal(p.player.name, 'Audric Estimé')
})
