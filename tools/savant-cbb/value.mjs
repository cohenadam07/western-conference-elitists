// Check for Savant value and the All-Savant Teams: every player, every season.
//
//   node --test tools/savant-cbb/value.mjs        (part of check:savant-cbb and check:savant)
//
// tools/savant-cbb/expected-value.json.gz is the Python's own answer (college_value.py dump), and it
// holds, for every player-season on the site:
//   1. the table the page reads, and the page's arithmetic in public/savant-cbb.js
//   2. the connector's value line
// and for every player on any team, through a real MCP client, BY NAME as a person would ask:
//   3. cbb_get_player_profile and cbb_all_savant_team
// plus:
//   4. the published teams are what the table's values pick, in the page's shape
//   5. honours are only for finished seasons; player pages and Draft cards carry the same list
//
// The Python's answer is held only for FINISHED seasons: a season in progress is rebuilt every day, so a
// dump of it is stale by the next refresh (it was, Nov 3 to Nov 6: 165 players against 3,532). A season in
// progress is held to its own structure instead, and to the page's arithmetic on the same day's file.
// When a season ends, `python3 pipeline/college/college_value.py dump` adds it to the dump.
//
// No network, no keys.
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
import '../../public/savant-cbb.js'
import { collegeHonours } from '../../scripts/lib/player-pages.mjs'

const M = globalThis.SavantCBB, C = M.COL
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CBB = path.join(ROOT, 'public', 'cbb')
const read = (p) => JSON.parse(gunzipSync(readFileSync(path.join(CBB, p + '.gz'))).toString('utf8'))
const expected = JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'tools/savant-cbb/expected-value.json.gz'))).toString('utf8'))
const idx = read('index.json')
const seasons = idx.seasons.map((x) => x.season)
const docs = Object.fromEntries(seasons.map((s) => [s, read(`s/${s}.json`)]))
const teams = Object.fromEntries(seasons.map((s) => [s, read(`allsavant/${s}.json`)]))
const honours = read('honours.json')
const finished = (s) => teams[s].final === true
const valueAt = (s, i) => (finished(s) ? expected[s].value[i] : docs[s].values.value.r[i])

test('every player on the site: table, page math and Python agree', () => {
  let n = 0
  for (const s of seasons) {
    const d = docs[s], e = expected[s]
    if (finished(s)) {
      assert.ok(e, `${s}: finished, but no expected values: python3 pipeline/college/college_value.py dump`)
      assert.deepEqual(d.players.map((p) => p[C.id]), e.ids, `${s}: player order`)
      assert.deepEqual(d.repl, e.repl, `${s}: replacement`)
    } else {
      const ids = d.players.map((p) => p[C.id])
      assert.equal(new Set(ids).size, ids.length, `${s}: a player twice`)
      assert.equal(d.values.value.r.length, d.players.length, `${s}: values line up with players`)
      assert.deepEqual(Object.keys(d.repl).sort(), ['Big', 'Guard', 'Wing'], `${s}: replacement positions`)
      for (const v of Object.values(d.repl)) assert.ok(Number.isFinite(v), `${s}: replacement ${v}`)
    }
    for (let i = 0; i < d.players.length; i++) {
      const line = M.valueLine(d, i)
      assert.equal(line ? line.value : null, valueAt(s, i), `${s} ${d.players[i][C.name]}`)
      if (line) { assert.ok(Math.abs(M.recompute(line) - line.value) < 0.6, `${s} ${d.players[i][C.name]}: rate × possessions`); n++ }
    }
  }
  assert.ok(n > 50000, `only ${n} player-seasons`)
})

test('the published teams are what the values pick', () => {
  for (const s of seasons) {
    const d = docs[s], V = d.values.value.r, P = d.players, t = teams[s]
    const q = P.map((_, i) => i).filter((i) => P[i][C.qual] && V[i] !== null && P[i][C.pos]).sort((a, b) => V[b] - V[a] || (P[a][0] < P[b][0] ? -1 : 1))
    const used = new Set()
    for (const k of ['1', '2', '3']) {
      const want = []
      for (const [pos, n] of [['Guard', 2], ['Wing', 2], ['Big', 1]]) {
        let got = 0
        for (const i of q) { if (got === n) break; if (P[i][C.pos] === pos && !used.has(i)) { want.push(P[i][0]); used.add(i); got++ } }
      }
      assert.deepEqual(t.national[k].map((x) => x.id), want, `${s} team ${k}`)
      if (want.length === 5) assert.deepEqual(t.national[k].map((x) => x.slot), ['Guard', 'Guard', 'Wing', 'Wing', 'Big'])
    }
    assert.equal(new Set(['1', '2', '3'].flatMap((k) => t.national[k].map((x) => x.id))).size, ['1', '2', '3'].reduce((a, k) => a + t.national[k].length, 0), `${s}: one national team only`)
    assert.equal(t.poy.id, P[q[0]][0], `${s}: POY is the single highest value`)
    for (const [c, team] of Object.entries(t.conference)) {
      for (const x of team) {
        const p = P.find((y) => y[0] === x.id)
        assert.equal(String(p[C.conf]), c, `${s} conf ${c}: ${x.name}`)
        if (!x.filled) assert.equal(p[C.pos], x.slot)
      }
    }
    for (const x of t.freshman) assert.equal(x.cls, 'Fr', `${s}: ${x.name} is not a freshman`)
  }
})

test('a season in progress is a standing, and only finished seasons give honours', () => {
  for (const [id, list] of Object.entries(honours)) for (const [s] of list) assert.ok(teams[s].final, `${id}: an honour in ${s}, which is not over`)
  for (const s of seasons) if (s < '2026-27') assert.equal(teams[s].final, true, s)
  const cur = idx.seasons[idx.seasons.length - 1].season
  assert.equal(teams[cur].so_far, !teams[cur].final)
})

test('player pages and Draft cards carry the same honours', () => {
  const links = read('links.json')
  const map = collegeHonours(ROOT)
  let n = 0
  for (const [nba, c] of map) {
    assert.deepEqual(c.list, honours[c.eid].map((h) => `${h[2]} ${h[0]}`), nba)
    assert.equal(String(links.nba[c.eid]), nba)
    n++
  }
  assert.ok(n > 20, `only ${n} NBA players carry a college honour`)
  for (const [d, list] of Object.entries(links.draft_honours)) assert.deepEqual(list, honours[links.by_draft[d]], d)
  assert.ok(Object.keys(links.draft_honours).length > 10)
  assert.match(readFileSync(path.join(ROOT, 'public/draft-savant.html'), 'utf8'), /draft_honours/)
})

let server, client
before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, 'public', decodeURIComponent(req.url.split('?')[0]) + '.gz')
    if (!existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(gunzipSync(readFileSync(f)))
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
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, `${name} ${JSON.stringify(args)}: ${r.content?.[0]?.text}`); return r.structuredContent }

test('the connector, by name, on every national team player', { timeout: 300000 }, async () => {
  let n = 0
  for (const s of seasons) {
    const d = docs[s], t = teams[s]
    for (const k of [['first', '1'], ['second', '2'], ['third', '3']]) {
      const a = await call('cbb_all_savant_team', { season: s, team: k[0] })
      assert.deepEqual(a.players.map((x) => x.id), t.national[k[1]].map((x) => x.id))
      for (const x of t.national[k[1]]) {
        const i = d.players.findIndex((p) => p[0] === x.id)
        const r = await call('cbb_get_player_profile', { player: x.name, season: s, group: 'impact' })
        assert.equal(r.player.id, x.id, `${s}: "${x.name}" resolved to ${r.player.name}`)
        assert.equal(r.savant_value.value, valueAt(s, i))
        assert.equal(r.tier, d.tier)
        assert.ok(r.adjustment_confidence && r.schedule_strength, `${s} ${x.name}`)
        n++
      }
    }
    const f = await call('cbb_all_savant_team', { season: s, team: 'freshman' })
    assert.deepEqual(f.players.map((x) => x.id), t.freshman.map((x) => x.id))
    const p = await call('cbb_all_savant_team', { season: s, team: 'player_of_the_year' })
    assert.equal(p.players[0].id, t.poy.id)
  }
  assert.ok(n >= 100)
})

test('box-score seasons say so', async () => {
  const s = seasons.find((x) => docs[x].tier === 'box')
  const d = docs[s], p = d.players.find((x) => x[C.qual])
  const r = await call('cbb_get_player_profile', { player: p[0], season: s })
  const by = Object.fromEntries(r.stats.map((x) => [x.key, x]))
  assert.equal(by.rapm.tracked, false)
  assert.match(by.rapm.note, /not tracked before 2024-25/)
  assert.equal(by.pts.tracked, true)
  const z = await call('cbb_get_player_profile', { player: p[0], season: s, group: 'shooting' })
  assert.equal(Object.fromEntries(z.stats.map((x) => [x.key, x])).rim_fg.tracked, false)
})
