// The standing college test: what a GM's staff asks, held to answers an assistant can see.
//
// Each test is one of the questions in QUESTIONS.md that a single connector call should answer,
// run through a real MCP client over this repo's public/cbb files. A failure means the connector
// lost a capability a fresh assistant needed in the Nov 5, 2026 blind test.
//
//   node --test tools/savant-cbb/questions.mjs        (part of npm run check:savant-cbb)

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public', 'cbb', p + '.gz'))).toString('utf8'))
const idx = read('index.json')
const DONE = idx.seasons.map((x) => x.season).filter((s) => read(`teams/${s}.json`).teams.some((t) => t.gp >= 25)).sort().slice(-1)[0]
let server, client

before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, 'public', decodeURIComponent(req.url.split('?')[0]) + '.gz')
    if (!existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(gunzipSync(readFileSync(f)))
  })
  await new Promise((r) => server.listen(0, r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  const { tools } = await import('../../api/_cbb.js')
  const mcp = new McpServer({ name: 't', version: '0' })
  for (const t of tools) mcp.registerTool(t.name, t.config, async (a) => { try { const r = await t.run(a); return { content: [{ type: 'text', text: r.text }], structuredContent: r.structured } } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'c', version: '0' })
  await Promise.all([mcp.connect(a), client.connect(b)])
})
after(() => server.close())
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`)
  return { s: r.structuredContent, text: r.content[0].text }
}
const teamWith = (pred) => read(`teams/${DONE}.json`).teams.find(pred)

test('Q1/Q20: one conference ranked by adjusted defense, each with its D1 rank', async () => {
  const { s, text } = await call('cbb_team_rankings', { season: DONE, sort: 'adjd', conference: 'SEC', limit: 30 })
  assert.ok(s.teams.length >= 10 && s.teams.every((t) => t.conference === 'SEC'))
  for (let i = 1; i < s.teams.length; i++) assert.ok(s.teams[i].adjd >= s.teams[i - 1].adjd, 'lower adjd is better, so it comes first')
  assert.ok(s.teams.every((t) => Number.isInteger(t.d1_rank)))
  assert.match(text, /D1 rank/)
})

test('Q2: worst high-major defensive rebounding, worst first', async () => {
  const { s } = await call('cbb_team_rankings', { season: DONE, sort: 'drb', level: 'high_major', ascending: true, limit: 5 })
  for (let i = 1; i < s.teams.length; i++) assert.ok(s.teams[i].drb >= s.teams[i - 1].drb)
  assert.ok(s.teams[0].d1_rank > 250, 'the worst high-major glass team ranks near the bottom of D1')
})

test('Q3/Q5/Q13: leaderboards filter by level, class and the stat\'s own sample', async () => {
  const hm = await call('cbb_leaderboard', { stat: 'drb_pct', season: DONE, position: 'Big', level: 'high_major', limit: 10 })
  assert.ok(hm.s.rows.length === 10 && hm.s.rows.every((r) => ['ACC', 'Big East', 'Big Ten', 'Big 12', 'SEC', 'Pac-12'].includes(r.conference)))
  const g3 = await call('cbb_leaderboard', { stat: 'fg3', season: DONE, position: 'Guard', min_sample: 150, limit: 10 })
  assert.ok(g3.s.rows.every((r) => r.sample >= 150 && r.sample_unit === '3PA'))
  const fr = await call('cbb_leaderboard', { stat: 'value', season: DONE, class: 'Fr', limit: 5 })
  assert.ok(fr.s.rows.every((r) => r.class === 'Fr'))
})

test('Q4/Q25: transfers and returners are told apart, with last season\'s school', async () => {
  const later = idx.seasons.map((x) => x.season).sort().filter((x) => x > idx.seasons.map((y) => y.season).sort()[0]).slice(-2)[0]
  const tr = await call('cbb_leaderboard', { stat: 'value', season: later, transfers_only: true, min_possessions: 0, limit: 10 })
  assert.ok(tr.s.rows.length && tr.s.rows.every((r) => r.last_season_team && r.last_season_team !== r.team))
  const rt = await call('cbb_leaderboard', { stat: 'value', season: later, returning_only: true, min_possessions: 0, limit: 10 })
  assert.ok(rt.s.rows.every((r) => r.last_season_team === r.team))
})

test('Q8: With/Without keeps only matching units and gives the rest of the time', async () => {
  const t = teamWith((x) => x.gp >= 25 && x.net > 15)
  const five = (await call('cbb_lineups', { team: t.id, season: DONE, size: 5 })).s.units[0]
  const who = five.players[0]
  const w = await call('cbb_lineups', { team: t.id, season: DONE, size: 5, with: [who] })
  assert.ok(w.s.units.every((u) => u.players.includes(who)))
  const wo = await call('cbb_lineups', { team: t.id, season: DONE, size: 5, without: [who] })
  assert.ok(wo.s.units.every((u) => !u.players.includes(who)))
  assert.ok(w.s.with_without.rest_of_the_time.possessions > 0)
  assert.ok(Math.abs(w.s.with_without.rest_of_the_time.possessions - wo.s.with_without.possessions) <= 1, 'the rest of the time with him is the time without him')
})

test('Q10/Q28: a team profile states the four factors with D1 ranks in its text', async () => {
  const { text, s } = await call('cbb_team_profile', { team: 'Florida', season: DONE })
  assert.match(text, /defensive rebounding [\d.]+% \(\d+(st|nd|rd|th)\)/)
  assert.ok(Number.isInteger(s.team.factor_ranks.drb) && s.team.conference === 'SEC')
})

test('Q11/Q19/Q24: game logs and box scores carry opponent names and full dates', async () => {
  const t = teamWith((x) => x.gp >= 25)
  const pg = await call('cbb_data', { table: 'player_games', team: t.id, season: DONE, columns: ['player', 'date', 'opponent', 'pts'], limit: 5 })
  assert.ok(pg.s.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.opponent && !/^\d+$/.test(r.opponent)))
  const first = pg.s.rows[0].date
  const later = await call('cbb_data', { table: 'player_games', team: t.id, season: DONE, filters: [{ column: 'date', op: 'gt', value: first }], limit: 500 })
  assert.ok(later.s.rows.every((r) => r.date > first), 'date filters work on full dates')
  const games = await call('cbb_data', { table: 'games', team: t.id, season: DONE, limit: 100 })
  assert.ok(games.s.total >= 25 && games.s.total < 50, 'games honour team')
  assert.ok(games.s.rows.every((r) => r.home === t.id || r.away === t.id) && games.s.rows[0].home_team)
})

test('Q6: a profile carries its comps, out of 100', async () => {
  const p = read(`s/${DONE}.json`).players.find((x) => x[11] && x[5])
  const { s, text } = await call('cbb_get_player_profile', { player: p[0], season: DONE })
  assert.ok(s.comps.length >= 1 && s.comps.every((c) => c.match >= 0 && c.match <= 100))
  assert.match(text, /Nearest comparable/)
})

test('Q16/Q17: the dictionary defines team fields, luck included', async () => {
  const { s } = await call('cbb_data_dictionary', {})
  for (const k of ['luck', 'sos', 'drb', 'oefg', 'othree', 'netrank']) assert.ok(s.team_fields[k], k)
})

test('Q9: the schedule tool answers, or fails cleanly when ESPN cannot be reached', async () => {
  const r = await client.callTool({ name: 'cbb_schedule', arguments: { team: 'Oklahoma' } })
  if (r.isError) assert.match(r.content[0].text, /could not be read just now/)
  else assert.ok(r.structuredContent.games.length >= 20 && r.structuredContent.games.every((g) => g.date && g.opponent))
})

test('Q31-33 (1.3.0): play context, a shot chart and a rotation map answer in one call each', async () => {
  const full = idx.seasons.filter((x) => x.context === 'full').map((x) => x.season).filter((s) => s <= DONE).slice(-1)[0]
  if (!full) return
  const t = read(`teams/${full}.json`).teams.find((x) => x.gp >= 25)
  const pc = await call('cbb_play_context', { team: t.id, season: full })
  assert.match(pc.text, /Transition/); assert.match(pc.text, /estimated/)
  const sc = await call('cbb_shot_chart', { team: t.id, season: full })
  assert.ok(sc.s.areas.some((a) => a.area === 'rim' && a.fga > 100))
  const ro = await call('cbb_rotation', { team: t.id, season: full })
  assert.ok(ro.s.players.length >= 7)
})
