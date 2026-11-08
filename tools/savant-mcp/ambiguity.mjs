// Names shared by an NBA team and a D1 college team ("Oklahoma"): the connector must say which
// team an answer is about and tell the assistant to ask when the league is unclear. Runs the
// real server (api/mcp.js buildServer) against this checkout's public/ files.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let server, client, mod
before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0])
    for (const f of [path.join(ROOT, 'public', u + '.gz'), path.join(ROOT, 'public', u)]) {
      if (existsSync(f)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(f.endsWith('.gz') ? gunzipSync(readFileSync(f)) : readFileSync(f)); return }
    }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(0, r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  process.env.VERCEL_URL = ''
  mod = await import('../../api/mcp.js')
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'c', version: '0' })
  await Promise.all([mod.buildServer({ state: 'none' }).connect(a), client.connect(b)])
})
after(() => server.close())
const text = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text

test('the instructions tell the assistant to ask when a name is shared', () => {
  const s = mod.instructionsFor('none')
  assert.match(s, /Oklahoma \(the Thunder or the Sooners\)/)
  assert.match(s, /ask them which team they mean/)
})

test('a bare "Oklahoma" on the college side says it is the Sooners and to ask', async () => {
  const t = await text('cbb_team_profile', { team: 'Oklahoma', season: '2025-26' })
  assert.match(t, /^Note: "Oklahoma" names both the NBA's Oklahoma City Thunder and the college Oklahoma Sooners\. This answer is about the college Oklahoma Sooners\. If the person has not made clear which they mean, ask them/)
  assert.match(t, /Oklahoma/)
})

test('a bare "Oklahoma" on the NBA side says it is the Thunder and to ask', async () => {
  const t = await text('nba_team_profile', { team: 'Oklahoma' })
  assert.match(t, /^Note: "Oklahoma" names both .*This answer is about the NBA's Oklahoma City Thunder\./)
  assert.match(t, /Oklahoma City Thunder \d{4}-\d{2}:/)
})

test('clear names get no note, and land on the right team', async () => {
  for (const [n, a, want] of [['nba_team_profile', { team: 'OKC' }, /^Oklahoma City Thunder /], ['nba_team_profile', { team: 'Thunder' }, /^Oklahoma City Thunder /],
    ['cbb_team_profile', { team: 'Sooners', season: '2025-26' }, /^Oklahoma Sooners \(/], ['cbb_team_profile', { team: 'Oklahoma Sooners', season: '2025-26' }, /^Oklahoma Sooners \(/],
    ['cbb_team_profile', { team: 'OU', season: '2025-26' }, /^Oklahoma Sooners \(/], ['cbb_team_profile', { team: 'Oklahoma State', season: '2025-26' }, /^Oklahoma State Cowboys \(/],
    ['cbb_team_profile', { team: 'Oklahoma State Cowboys', season: '2025-26' }, /^Oklahoma State Cowboys \(/], ['cbb_team_profile', { team: 'Miami (OH)', season: '2025-26' }, /^Miami \(OH\) RedHawks \(/]]) {
    const r = await client.callTool({ name: n, arguments: a })
    assert.ok(!r.isError, `${n} ${a.team}: ${r.content[0].text}`)
    assert.match(r.content[0].text, want, `${n} ${a.team}`)
  }
})

test('the team the note names is the team a follow-up call finds', async () => {
  // The note says "the college Oklahoma Sooners"; an assistant that takes that name back to a
  // cbb_ tool must land on the same team, not on "No D1 team found".
  const { SHARED_NAMES } = await import('../../api/_ambiguous.js')
  for (const [, [, col]] of Object.entries(SHARED_NAMES)) {
    const r = await client.callTool({ name: 'cbb_team_profile', arguments: { team: col, season: '2025-26' } })
    assert.ok(!r.isError, `${col}: ${r.content[0].text}`)
    assert.ok(r.content[0].text.split('\n')[0].includes(col), `${col}: ${r.content[0].text.slice(0, 60)}`)
  }
})

test('an NBA-only name on the college side is turned back, not fuzzy-matched', async () => {
  for (const team of ['Thunder', 'OKC', 'Oklahoma City', 'Golden State', 'Celtics', 'Philadelphia 76ers']) {
    const r = await client.callTool({ name: 'cbb_team_profile', arguments: { team, season: '2025-26' } })
    assert.ok(r.isError, team)
    assert.match(r.content[0].text, /is an NBA team .*the nba_ tools have it.*ask them/, team)
  }
})

test('an NBA name on the college side points to the other league', async () => {
  const r = await client.callTool({ name: 'cbb_team_profile', arguments: { team: 'Brooklyn Nets Basketball Club', season: '2025-26' } })
  assert.ok(r.isError)
  assert.match(r.content[0].text, /No D1 team found .*If the person meant an NBA team, the nba_ tools have it; if it is not clear which league they mean, ask them\./)
})

test('every shared name has a college team on file', async () => {
  const { SHARED_NAMES } = await import('../../api/_ambiguous.js')
  const search = JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public/cbb/search.json.gz'))))
  const names = search.teams.map((t) => String(t[1]).toLowerCase())
  for (const [k, [, col]] of Object.entries(SHARED_NAMES)) {
    const first = col.toLowerCase().split(' ')[0]
    assert.ok(names.some((n) => n.replace(/[^a-z]/g, '').startsWith(k) || n.startsWith(first)), `${k}: ${col}`)
  }
})

test('a bare "Oklahoma" gets the ask from every nba_ and cbb_ tool that takes a team, answer or error', async () => {
  // Nov 2026: the NBA side lost it without any check noticing, because the season in progress named
  // teams by code ("OKC") and "Oklahoma" matched nothing; only the generic not-found line was left.
  const { tools } = await client.listTools()
  // (a `team` that is an enum is not a basketball team: nba_all_savant_team's first or second team)
  const want = tools.filter((t) => /^(nba|cbb)_/.test(t.name) && t.inputSchema?.properties?.team && !t.inputSchema.properties.team.enum && (t.inputSchema.required || []).every((k) => k === 'team'))
  assert.ok(want.length >= 8, `only ${want.length} tools take a team alone`)
  for (const t of want) {
    const r = await client.callTool({ name: t.name, arguments: { team: 'Oklahoma' } })
    const side = t.name.startsWith('cbb_') ? "the college Oklahoma Sooners" : "the NBA's Oklahoma City Thunder"
    assert.match(r.content[0].text, new RegExp(`^Note: "Oklahoma" names both .*This answer is about ${side.replace(/[()]/g, '\\$&')}\\. If the person has not made clear which they mean, ask them`), `${t.name}: ${r.content[0].text.slice(0, 200)}`)
  }
})

