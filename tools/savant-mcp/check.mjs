// End-to-end check for the AI connector (api/mcp.js) and its basketball section
// (api/_basketball.js, on api/_core.js).
//
//   npm run check:savant-mcp        (node --test tools/savant-mcp/check.mjs)
//
// Three questions, in order of how much they matter:
//
//   1. Does a profile say exactly what the Savant API files say, for every player in every
//      season? (check:savant-api already ties those files to the page, so together the two
//      checks tie an AI's answer to the card a fan sees.)
//   2. Does a real MCP client get on with the endpoint: handshake, tool list, tool calls,
//      results that fit their declared shape, and the HTTP manners the spec asks for?
//   3. When a question cannot be answered — a name three men share, a season that never
//      happened, the data being down — does it say what to do next rather than guess or
//      fall over?
//
// The data is built in memory from public/ and served from a local port, so there is no
// network and no dependence on what is live. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { buildSavantApi } from '../../scripts/lib/savant-api.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const html = readFileSync(path.join(ROOT, 'public/basketball-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(ROOT, 'public/savant-data.json'), 'utf8'))
// Through JSON once, because that is what gets published: the source has a few -0.0 values,
// which are plain 0 by the time they are a file.
const files = JSON.parse(JSON.stringify(buildSavantApi({ data, html })))
const latest = files.meta.latestSeason

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// The site's CDN: the three kinds of file, and the homepage for anything else (which is
// what the live catch-all rewrite does, with a 200).
let hits = 0
const cdn = http.createServer((req, res) => {
  hits++
  const p = decodeURIComponent(req.url).replace('/savant-api/basketball/v1/', '')
  const season = p.match(/^seasons\/(.+)\.json$/)
  const body = p === 'meta.json' ? files.meta : p === 'players.json' ? files.players : season ? files.seasons[season[1]] : null
  if (!body) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})

let savant
let handler
let app
let endpoint
let client

before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  savant = { ...(await import('../../api/_core.js')), ...(await import('../../api/_basketball.js')) }
  handler = (await import('../../api/mcp.js')).default
  // The function as Vercel calls it: the body is read and parsed before the handler runs,
  // and reading req.body throws when it is not JSON.
  app = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    Object.defineProperty(req, 'body', { get() { return raw ? JSON.parse(raw) : undefined } })
    handler(req, res)
  })
  endpoint = `http://127.0.0.1:${await listen(app)}/api/mcp`
  client = new Client({ name: 'check', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
})

after(async () => {
  await client.close()
  app.close()
  cdn.close()
})

const call = (name, args) => client.callTool({ name, arguments: args })
const textOf = (r) => r.content.map((c) => c.text).join('\n')
const post = (body, headers = {}) => fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

// ---- 1. the numbers ------------------------------------------------------------------

test('a profile says what the Savant API files say, for every player in every season', async () => {
  let profiles = 0
  let cells = 0
  for (const season of files.meta.seasons) {
    const file = files.seasons[season]
    const tracked = files.meta.metrics.filter((m) => +season.slice(0, 4) >= +m.since.slice(0, 4))
    for (const row of file.players) {
      const { structured: s, text } = await savant.playerProfile({ player: String(row.id), season })
      profiles++
      assert.equal(s.player.id, String(row.id))
      assert.equal(s.player.position, row.pos)
      assert.equal(s.player.qualified, row.qualified)
      assert.equal(s.season, season)
      assert.deepEqual(s.pools, { league: file.qualified.league, position: file.qualified[row.pos], position_label: { Guard: 'guards', Wing: 'wings', Big: 'bigs' }[row.pos] })
      // Every stat in the file is in the profile, and nothing else is.
      assert.deepEqual(s.stats.map((x) => x.key), tracked.map((m) => m.key).filter((k) => row.m[k]), `${season} ${row.name}: stat list`)
      for (const x of s.stats) {
        const cell = row.m[x.key]
        const where = `${season} ${row.name} ${x.key}`
        assert.equal(x.value, cell[0], `${where}: value`)
        assert.equal(x.league_percentile, cell[1], `${where}: league percentile`)
        assert.equal(x.position_percentile, cell[2], `${where}: position percentile`)
        assert.equal(x.low_sample, (row.low || []).includes(x.key), `${where}: low sample`)
        cells++
      }
      assert.deepEqual(s.not_tracked.map((m) => m.key), files.meta.metrics.filter((m) => !tracked.includes(m)).map((m) => m.key))
      assert.ok(text.includes(`vs. ${s.pools.position_label}`), `${season} ${row.name}: the text names the position pool`)
      assert.ok(text.includes(s.url), `${season} ${row.name}: the text links the card`)
      if (!row.qualified) assert.ok(/did not qualify/.test(text), `${season} ${row.name}: unqualified players carry the caution`)
    }
  }
  console.log(`      ${profiles.toLocaleString('en-US')} profiles, ${cells.toLocaleString('en-US')} stats`)
  assert.equal(profiles, files.players.players.reduce((n, p) => n + p.seasons, 0))
})

test('rolling windows read the window, not the season', async () => {
  const file = files.seasons[latest]
  let checked = 0
  for (const row of file.players.filter((p) => p.w).slice(0, 150)) {
    for (const w of Object.keys(row.w)) {
      const { structured: s, text } = await savant.playerProfile({ player: String(row.id), window: w })
      assert.equal(s.window, w)
      for (const x of s.stats) {
        assert.deepEqual([x.value, x.league_percentile, x.position_percentile], row.w[w].m[x.key], `${row.name} ${w} ${x.key}`)
        assert.equal(x.low_sample, (row.w[w].low || []).includes(x.key))
        checked++
      }
      assert.equal(s.stats.length, Object.keys(row.w[w].m).length)
      assert.ok(text.includes({ l10: 'last 10 games', l25: 'last 25 games', l75: 'last 75 games' }[w]))
      assert.equal(s.comps, undefined, 'comps are a season fact and stay out of window views')
    }
  }
  assert.ok(checked > 5000)
})

test('values print the way the page prints them, apart from the documented exceptions', () => {
  // The page's own formatter, lifted out of the HTML.
  const grab = (name) => {
    const at = html.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
    assert.ok(at >= 0, `the page no longer has function ${name}()`)
    let depth = 0
    for (let i = html.indexOf('{', at); i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1)
    }
    assert.fail(`could not read ${name}() out of the page`)
  }
  const page = vm.runInNewContext(`(function () { ${grab('miss')} ${grab('inFt')} ${grab('word')} ${grab('fmt')} return fmt })()`)
  const units = new Map(files.meta.metrics.map((m) => [m.key, m.unit]))
  const seen = new Set()
  let compared = 0
  for (const season of [latest, '2015-16', '1999-00', '1985-86']) {
    for (const row of files.seasons[season].players) {
      for (const [key, [v, league]] of Object.entries(row.m)) {
        const unit = units.get(key)
        seen.add(unit)
        const ours = savant.display(unit, v, league)
        const theirs =
          unit === 'sgn' ? page(unit, v, league).replace(/%$/, '')   // no "%": wrong for BPM on the page
          : unit === 'lb' ? `${page(unit, v, league)} lb`              // the unit, spelled out
          : unit === 'wnum' || unit === 'wsgn' ? page(unit, v, null)   // number only: both percentiles sit beside it
          : page(unit, v, league)
        assert.equal(ours, theirs, `${season} ${row.name} ${key} (${unit})`)
        compared++
      }
    }
  }
  for (const unit of new Set(units.values())) assert.ok(seen.has(unit), `no value seen for unit ${unit}`)
  assert.ok(compared > 50000)
})

test('the latest season carries comps, flaws and matchups, with their own pool named', async () => {
  const row = files.seasons[latest].players.find((p) => p.comps && p.wflaws && p.wcomps && p.guard)
  const { structured: s, text } = await savant.playerProfile({ player: String(row.id) })
  assert.deepEqual(s.comps.map((c) => [c.id, c.match]), row.comps.map((c) => [String(c.id), c.score]))
  assert.deepEqual(s.weakest.map((f) => [f.key, f.percentile]), row.wflaws.map((f) => [f.k, f.pct]))
  assert.deepEqual(s.weakness_comps.map((c) => c.id), row.wcomps.map((c) => String(c.id)))
  assert.deepEqual([s.defensive_matchups.guards, s.defensive_matchups.wings, s.defensive_matchups.bigs], [row.guard.g, row.guard.w, row.guard.b])
  assert.match(text, /with 500\+ minutes/)
  // Asking for one group is asking for less: the season extras stay home.
  const only = await savant.playerProfile({ player: String(row.id), group: 'defense' })
  assert.ok(only.structured.stats.length && only.structured.stats.every((x) => x.group === 'Defense'))
  assert.equal(only.structured.comps, undefined)
})

// ---- 2. the protocol -----------------------------------------------------------------

test('the handshake and tool list are what a directory reviewer expects', async () => {
  assert.equal(client.getServerVersion().name, 'wcehoops')
  assert.match(client.getInstructions(), /percentile/)
  const { tools } = await client.listTools()
  // Other sections have their own checks; this one owns the basketball tools.
  assert.deepEqual(tools.map((t) => t.name).filter((n) => n.startsWith('nba_') && !n.startsWith('nba_draft_')).sort(), ['nba_get_player_profile', 'nba_search_players'])
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, 'tool names are unique')
  for (const t of tools) {
    assert.ok(t.name.length <= 64)
    assert.ok(t.title && t.annotations.title, `${t.name}: title`)
    assert.equal(t.annotations.readOnlyHint, true, `${t.name}: read-only`)
    assert.equal(t.annotations.destructiveHint, false)
    assert.ok(t.description.length > 80, `${t.name}: description`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.outputSchema, `${t.name}: output schema`)
    for (const [k, prop] of Object.entries(t.inputSchema.properties)) assert.ok(prop.description, `${t.name}.${k}: described`)
  }
})

test('search and profile work through a real client, and results fit their declared shape', async () => {
  // callTool validates structuredContent against the tool's output schema and throws if not.
  const s = await call('nba_search_players', { query: 'Nikola Jokic' })
  assert.ok(!s.isError)
  assert.equal(s.structuredContent.players[0].name, 'Nikola Jokic')
  assert.equal(s.structuredContent.players[0].url, 'https://wcehoops.com/basketball-savant.html?p=203999')

  const p = await call('nba_get_player_profile', { player: 'Nikola Jokic' })
  assert.ok(!p.isError)
  assert.equal(p.structuredContent.season, latest)
  assert.equal(p.structuredContent.player.id, '203999')
  assert.match(textOf(p), /True shooting %: \.\d{3} \(league \d+(st|nd|rd|th), vs\. bigs \d+(st|nd|rd|th)\)/)

  // A profile of every kind of player fits the schema: old, unqualified, "br:" id, windowed.
  const old = files.seasons['1985-86'].players[0]
  const bench = files.seasons[latest].players.find((x) => !x.qualified)
  const br = files.players.players.find((x) => String(x.id).startsWith('br:'))
  for (const args of [
    { player: String(old.id), season: '1985-86' },
    { player: String(bench.id) },
    { player: String(br.id) },
    { player: 'Nikola Jokic', window: 'l10', group: 'offense' },
  ]) {
    const r = await call('nba_get_player_profile', args)
    assert.ok(!r.isError, `${JSON.stringify(args)}: ${textOf(r)}`)
  }
  // Bad arguments are refused by the schema before any basketball happens.
  const bad = await call('nba_search_players', { query: 'x' })
  assert.ok(bad.isError)
  const worse = await call('nba_get_player_profile', { player: 'Nikola Jokic', window: 'l5' })
  assert.ok(worse.isError)
})

test('names are matched the way people type them', async () => {
  const first = async (query) => (await savant.searchPlayers({ query })).structured.players[0]?.name
  assert.equal(await first('PJ Washington'), 'P.J. Washington')
  assert.equal(await first('dayron sharpe'), "Day'Ron Sharpe")
  assert.equal(await first('karl anthony towns'), 'Karl-Anthony Towns')
  assert.equal(await first('gilgeous'), 'Shai Gilgeous-Alexander')
  assert.equal(await first('Giannis Antetokounpo'), 'Giannis Antetokounmpo') // typo
  assert.equal(await first('james'), 'LeBron James')                         // surname counts as much as first name
  assert.equal(await first('JOKIĆ'), 'Nikola Jokic')
  const many = await savant.searchPlayers({ query: 'williams', limit: 7 })
  assert.equal(many.structured.count, 7)
  assert.ok(many.structured.total > 7)
  const none = await savant.searchPlayers({ query: 'zzzzqq' })
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No player/)
})

test('HTTP manners: stateless, POST only, CORS, clean errors', async () => {
  const get = await fetch(endpoint)
  assert.equal(get.status, 405)
  assert.match(get.headers.get('allow'), /POST/)
  assert.equal((await get.json()).jsonrpc, '2.0')
  assert.equal((await fetch(endpoint, { method: 'DELETE' })).status, 405)

  const options = await fetch(endpoint, { method: 'OPTIONS' })
  assert.equal(options.status, 204)
  assert.equal(options.headers.get('access-control-allow-origin'), '*')

  const garbage = await post('{not json')
  assert.equal(garbage.status, 400)
  assert.equal((await garbage.json()).error.code, -32700)

  // Any instance can answer any request: tools/list with no handshake and no session.
  const list = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(list.status, 200)
  assert.equal(list.headers.get('mcp-session-id'), null)
  assert.match(list.headers.get('content-type'), /application\/json/)
  assert.ok((await list.json()).result.tools.length >= 2)

  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(note.status, 202)
})

// ---- 3. when it cannot answer --------------------------------------------------------

test('a shared name lists the candidates, and a season settles it', async () => {
  const shared = await call('nba_get_player_profile', { player: 'Patrick Ewing' })
  assert.ok(shared.isError)
  assert.match(textOf(shared), /br:ewingpa01/)
  assert.match(textOf(shared), /id 121/)
  // The Hall of Famer's Knicks years live under the "br:" id; 1989-90 can only be him.
  const knick = await call('nba_get_player_profile', { player: 'Patrick Ewing', season: '1989-90', group: 'value' })
  assert.ok(!knick.isError)
  assert.equal(knick.structuredContent.player.id, 'br:ewingpa01')
  assert.equal(knick.structuredContent.player.team, 'NYK')
  // "Jaren Jackson" could be the father or the son: never quietly the father.
  const jj = await call('nba_get_player_profile', { player: 'Jaren Jackson' })
  assert.ok(jj.isError)
  assert.match(textOf(jj), /Jaren Jackson Jr\./)
  const jr = await call('nba_get_player_profile', { player: 'Jaren Jackson Jr.', group: 'context' })
  assert.equal(jr.structuredContent.player.id, '1628991')
})

test('impossible questions get an answer that says what to try', async () => {
  const cases = [
    [{ player: 'LeBron James', season: '2026' }, /ambiguous.*2025-26.*2026-27/s],
    [{ player: 'LeBron James', season: '1995-96' }, /was not in the league in 1995-96/],
    [{ player: 'LeBron James', season: '1970-71' }, /covers 1979-80 through/],
    [{ player: 'LeBron James', season: 'last year' }, /is not a season/],
    [{ player: 'Michael Jordan', season: '1997-98', window: 'l10' }, /exists only for/],
    [{ player: '999999999' }, /No player has the id/],
    [{ player: 'Qwertyuiop Asdfgh' }, /No player matches/],
  ]
  for (const [args, expect] of cases) {
    const r = await call('nba_get_player_profile', args)
    assert.ok(r.isError, JSON.stringify(args))
    assert.match(textOf(r), expect, JSON.stringify(args))
    assert.equal(r.structuredContent, undefined)
  }
  // Both spellings of a season are the same season.
  for (const season of ['2015-16', '2015-2016', '2015/16']) {
    const r = await call('nba_get_player_profile', { player: 'Stephen Curry', season, group: 'context' })
    assert.equal(r.structuredContent.season, '2015-16', season)
  }
})

test('files are fetched once and reused; when the data is down the answer is honest', async () => {
  savant.clearCache()
  const before = hits
  await savant.playerProfile({ player: '203999' })
  await savant.playerProfile({ player: '203999', group: 'offense' })
  await savant.searchPlayers({ query: 'jokic' })
  assert.equal(hits - before, 3, 'meta, players and one season: three fetches for three calls')

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // A season file that is not there comes back as the homepage, with a 200.
    savant.clearCache()
    const real = files.seasons['2010-11']
    delete files.seasons['2010-11']
    const gone = await call('nba_get_player_profile', { player: 'Kobe Bryant', season: '2010-11' })
    files.seasons['2010-11'] = real
    assert.ok(gone.isError)
    assert.match(textOf(gone), /could not be loaded right now/)

    // The whole origin is unreachable.
    savant.clearCache()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    const down = await call('nba_search_players', { query: 'jokic' })
    assert.ok(down.isError)
    assert.match(textOf(down), /could not be loaded right now/)
    assert.doesNotMatch(textOf(down), /ECONNREFUSED|127\.0\.0\.1|at .*\.js/)
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    savant.clearCache()
  }
  const back = await call('nba_search_players', { query: 'jokic' })
  assert.ok(!back.isError)
})
