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
// And for the questions that go beyond one card (who led, side by side, over the years, what
// a stat means): is the leaderboard the page's own Leaderboard Builder, row for row, and do
// a comparison and a career repeat the cards rather than work anything out afresh?
//
// It also makes one pass over the whole connector: every tool of every section, called
// through the real endpoint, against files written the way the build writes them and served
// the way Vercel serves them (x.json answered from x.json.gz). Each section's own check, in
// the folder beside this one, is where its numbers are held to its page.
//
// The data is built from public/ and served from a local port, so there is no network and no
// dependence on what is live. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { buildSavantApi, writeAll } from '../../scripts/lib/savant-api.mjs'
import { CONNECTOR_URL, EXAMPLE, PROMPTS } from '../../src/data/connector.js'
import { startStore } from './redis.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const html = readFileSync(path.join(ROOT, 'public/basketball-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(ROOT, 'public/savant-data.json'), 'utf8'))
// Through JSON once, because that is what gets published: the source has a few -0.0 values,
// which are plain 0 by the time they are a file.
const files = JSON.parse(JSON.stringify(buildSavantApi({ data, html })))
const latest = files.meta.latestSeason

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// Every section's files, written to a scratch folder exactly as the build writes them.
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-mcp-'))
const built = writeAll({ publicDir: path.join(ROOT, 'public'), dist, log: () => {} })

// The site's CDN. Basketball comes from the in-memory build above, so a test can take a file
// away. Every other section comes off the scratch folder the way Vercel serves it: x.json is
// answered from x.json.gz when that is what was written. Anything else gets the homepage
// with a 200, which is what the live catch-all rewrite does. The Dynasty board's live
// endpoint answers as the real one does when its store is not set up.
let hits = 0
const html200 = (res) => { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); res.end('<!doctype html><title>WCE</title>') }
const json200 = (res, body) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.end(body) }
const cdn = http.createServer((req, res) => {
  hits++
  const url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/api/dynasty') return json200(res, JSON.stringify({ configured: false }))
  if (url.startsWith('/savant-api/basketball/v1/')) {
    const p = url.replace('/savant-api/basketball/v1/', '')
    const season = p.match(/^seasons\/(.+)\.json$/)
    const body = p === 'meta.json' ? files.meta : p === 'players.json' ? files.players : season ? files.seasons[season[1]] : null
    return body ? json200(res, JSON.stringify(body)) : html200(res)
  }
  const file = path.join(dist, url)
  if (!file.startsWith(dist)) return html200(res)
  if (existsSync(file) && statSync(file).isFile()) return json200(res, readFileSync(file))
  if (existsSync(`${file}.gz`)) return json200(res, gunzipSync(readFileSync(`${file}.gz`)))
  return html200(res)
})

// A real, throwaway data store for the usage log's tests; null where redis-server is missing.
const store = await startStore()

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
  if (store) await store.stop()
  await client.close()
  app.close()
  cdn.close()
  rmSync(dist, { recursive: true, force: true })
})

const ordinalOf = (n) => { const t = n % 100; return `${n}${t >= 11 && t <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}` }
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
  // Asking for one group is asking for less: the season extras stay home. The panel is its
  // own stats plus the one overall-value stat for that end of the floor, which the page files
  // elsewhere: a caller asking for "defense" expects Defensive BPM to be there.
  const only = await savant.playerProfile({ player: String(row.id), group: 'defense' })
  assert.ok(only.structured.stats.length)
  assert.deepEqual(only.structured.stats.filter((x) => x.group !== 'Defense').map((x) => x.key), row.m.dbpm ? ['dbpm'] : [])
  assert.match(only.text, /Overall value \(the defense half\)\n- Defensive BPM: /)
  assert.equal(only.structured.comps, undefined)
  const offense = await savant.playerProfile({ player: String(row.id), group: 'offense' })
  assert.deepEqual(offense.structured.stats.filter((x) => x.group !== 'Offense').map((x) => x.key), row.m.obpm ? ['obpm'] : [])
  // One panel explains each stat in the page's words; the whole card keeps its lines short.
  const explained = only.structured.stats.find((x) => x.what)
  assert.ok(only.text.includes(`\n  ${explained.what}`))
  assert.ok(!text.includes(`\n  ${explained.what}`))
})

// A stat the season tracks but has no number for is a gap, and has to be said: a missing
// line reads as "not applicable", and for off-ball gravity (which the data holds for only
// some players) that is exactly what a fan would ask about.
test('a stat with no number for him is named as a gap, never skipped and never zero', async () => {
  let checked = 0
  for (const season of [latest, files.meta.seasons[10], files.meta.seasons[files.meta.seasons.length - 1]]) {
    const file = files.seasons[season]
    const tracked = files.meta.metrics.filter((m) => +season.slice(0, 4) >= +m.since.slice(0, 4))
    for (const row of file.players.filter((_, i) => i % 23 === 0)) {
      const { structured: s, text } = await savant.playerProfile({ player: String(row.id), season })
      const gaps = tracked.filter((m) => !row.m[m.key])
      assert.deepEqual(s.no_value.map((x) => x.key), gaps.map((m) => m.key), `${season} ${row.name}`)
      // Every tracked stat is accounted for exactly once: on the card, or named as a gap.
      assert.equal(s.stats.length + s.no_value.length, tracked.length)
      if (gaps.length) {
        assert.ok(text.includes(`No value for him in ${season}, so the page draws no bar. That is a gap in the data, not a zero: ${gaps.map((m) => m.label).join(', ')}.`), `${season} ${row.name}`)
        checked++
      } else assert.doesNotMatch(text, /No value for him/)
    }
  }
  assert.ok(checked > 20)
  // The case that prompted it: a qualified star with no gravity number in the latest season.
  const grav = files.meta.metrics.find((m) => m.key === 'grav')
  const star = files.seasons[latest].players.find((p) => p.qualified && !p.m.grav && p.line && p.line.ppg > 20)
  if (grav && star) {
    const { structured: s } = await savant.playerProfile({ player: String(star.id), group: 'offense' })
    assert.ok(s.no_value.some((x) => x.key === 'grav'))
    assert.ok(!s.stats.some((x) => x.key === 'grav'))
  }
})

// ---- 1b. beyond one card ---------------------------------------------------------------

// The leaderboard is the page's Leaderboard Builder: lbEligible() keeps the season's
// qualified players (and a position or a team when one is chosen), lbRender() sorts them by
// the stat, highest first, lowest first for a lower-is-better stat. Worked out here straight
// from the page's data file, with the page's position corrections applied as the page applies
// them, and compared row for row.
test('a leaderboard is the page\'s Leaderboard Builder: same pool, same order', async () => {
  const cfg = files.meta
  let boards = 0
  const cases = []
  for (const season of [latest, '2015-16', '1995-96', '1983-84']) {
    for (const m of cfg.metrics.filter((_, i) => i % 3 === 0)) cases.push({ season, m })
    cases.push({ season, m: cfg.metrics.find((x) => x.key === 'ts'), position: 'guard' })
    cases.push({ season, m: cfg.metrics.find((x) => x.key === 'blk'), position: 'big' })
    cases.push({ season, m: cfg.metrics.find((x) => x.key === 'tov'), position: 'wing' })
  }
  for (const { season, m, position } of cases) {
    if (+season.slice(0, 4) < +m.since.slice(0, 4)) {
      await assert.rejects(() => savant.leaderboard({ stat: m.key, season }), (e) => e instanceof savant.SavantError && e.message.includes(`tracked from ${m.since}`))
      continue
    }
    const pos = position ? position[0].toUpperCase() + position.slice(1) : null
    // files.seasons carries the corrected positions; the values are the data file's own.
    const src = files.seasons[season].players.filter((p) => p.qualified && (!pos || p.pos === pos) && p.m[m.key])
    const expected = src.map((p) => ({ id: String(p.id), v: p.m[m.key][0] })).sort((a, b) => (m.lowerIsBetter ? a.v - b.v : b.v - a.v))
    const { structured: s, text } = await savant.leaderboard({ stat: m.key, season, position, limit: 25 })
    boards++
    assert.equal(s.ranked, expected.length, `${season} ${m.key}`)
    assert.deepEqual(s.leaders.map((l) => [l.id, l.value]), expected.slice(0, 25).map((x) => [x.id, x.v]), `${season} ${m.key} ${position || ''}`)
    // A place is one more than the number of men with a better value, so ties share it.
    for (const l of s.leaders) {
      assert.equal(l.rank, 1 + expected.filter((x) => (m.lowerIsBetter ? x.v < l.value : x.v > l.value)).length)
      assert.equal(l.tied, expected.filter((x) => x.v === l.value).length > 1)
    }
    const who = `qualified ${pos ? { Guard: 'guards', Wing: 'wings', Big: 'bigs' }[pos] : 'players'}`
    // A stat the era tracks but the data has no values for yet is an empty board, said plainly.
    if (!expected.length) { assert.ok(text.startsWith(`Nobody among the ${who} has a value for ${m.label} in ${season}.`), `${season} ${m.key}`); continue }
    assert.ok(text.includes(`${m.label}, ${season}: the top ${s.count} of ${expected.length} ${who}`), `${season} ${m.key}`)
    if (m.lowerIsBetter) assert.match(text, /lower-is-better stat, so the lowest value is 1st/)
  }
  assert.ok(boards > 60)

  // And against the raw data file, for the page's default board: nothing in between.
  const raw = data.data[latest].players.filter((p) => p.qualified && p.m.pts && p.m.pts.season && p.m.pts.season.v != null)
    .sort((a, b) => b.m.pts.season.v - a.m.pts.season.v).slice(0, 10).map((p) => String(p.id))
  const pts = await savant.leaderboard({ stat: 'pts', limit: 10 })
  assert.deepEqual(pts.structured.leaders.map((l) => l.id), raw)
  // The link is the page's own lbEncode() hash, which its lbParseHash() reads back.
  assert.equal(pts.structured.url, `https://wcehoops.com/basketball-savant.html#lb?s=${latest}&r=pts&n=10`)
  assert.ok(html.includes("add('s',LB.season)") && html.includes("add('r',LB.rankKey)") && html.includes("add('pos',LB.pos==='All'?'':LB.pos)") && html.includes("add('tm',LB.team)"), 'the page no longer writes its leaderboard link this way')
  assert.deepEqual(cfg.leaderboard.common, [...html.match(/var LB_COMMON=\[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
})

test('a leaderboard: one team, the per-game line, the bottom of the board, and stats by name', async () => {
  const file = files.seasons[latest]
  // One team, by name or by code: the same board.
  const team = file.players.find((p) => p.qualified && p.team === 'SAS') ? 'SAS' : file.players.find((p) => p.qualified).team
  const byCode = await savant.leaderboard({ stat: 'dbpm', team, limit: 25 })
  const mine = file.players.filter((p) => p.qualified && p.team === team && p.m.dbpm).sort((a, b) => b.m.dbpm[0] - a.m.dbpm[0])
  assert.deepEqual(byCode.structured.leaders.map((l) => l.id), mine.map((p) => String(p.id)))
  assert.equal(byCode.structured.filters.team, team)
  if (team === 'SAS') {
    for (const name of ['Spurs', 'san antonio', 'San Antonio Spurs', 'sas']) assert.deepEqual((await savant.leaderboard({ stat: 'dbpm', team: name, limit: 25 })).structured.leaders, byCode.structured.leaders, name)
  }
  // The league percentile beside a team's players is still the league's, not the team's.
  for (const l of byCode.structured.leaders) assert.equal(l.league_percentile, file.players.find((p) => String(p.id) === l.id).m.dbpm[1])
  await assert.rejects(() => savant.leaderboard({ stat: 'ts', team: 'Sonics' }), /Seattle SuperSonics \(SEA\) had no players in/)
  await assert.rejects(() => savant.leaderboard({ stat: 'ts', team: 'Hornets', season: '2005-06' }), /fits more than one team in 2005-06: CHA .* NOK /)
  await assert.rejects(() => savant.leaderboard({ stat: 'ts', team: 'Harlem Globetrotters' }), /No NBA team matches/)

  // The per-game line: the number at the top of the card, with no percentile to quote.
  const ppg = await savant.leaderboard({ stat: 'points per game', limit: 5 })
  const scorers = file.players.filter((p) => p.qualified && p.line && p.line.ppg != null).sort((a, b) => b.line.ppg - a.line.ppg)
  assert.deepEqual(ppg.structured.leaders.map((l) => [l.id, l.value, l.league_percentile]), scorers.slice(0, 5).map((p) => [String(p.id), p.line.ppg, null]))
  assert.match(ppg.text, /It is not a Savant stat, so it has no percentile/)
  assert.equal(ppg.structured.url, 'https://wcehoops.com/basketball-savant.html')
  assert.equal((await savant.leaderboard({ stat: 'ppg', limit: 5 })).text, ppg.text)

  // The bottom of the board is numbered from the top, worst first.
  const all = file.players.filter((p) => p.qualified && p.m.ts)
  const bottom = await savant.leaderboard({ stat: 'ts', order: 'bottom', limit: 3 })
  assert.deepEqual(bottom.structured.leaders.map((l) => l.value), all.map((p) => p.m.ts[0]).sort((a, b) => a - b).slice(0, 3))
  assert.ok(bottom.structured.leaders[0].rank >= bottom.structured.leaders[1].rank && bottom.structured.leaders[0].rank > all.length - 3)
  assert.match(bottom.text, /the bottom 3 of \d+ qualified players/)

  // A stat is its key, its label, or the way a fan says it. A name that fits several is not guessed.
  for (const [said, key] of [['TS', 'ts'], ['True shooting %', 'ts'], ['true shooting percentage', 'ts'], ['three point percentage', 'tp3'], ['3P%', 'tp3'], ['points per 75', 'pts'], ['free throw percentage', 'ft'], ['Box Plus/Minus', 'bpm'], ['defensive bpm', 'dbpm'], ['usage', 'usg']]) {
    assert.equal((await savant.leaderboard({ stat: said, limit: 1 })).structured.stat.key, key, said)
  }
  await assert.rejects(() => savant.leaderboard({ stat: 'rebound' }), (e) => e instanceof savant.SavantError && /could be more than one stat/.test(e.message) && /key "oreb"/.test(e.message) && /key "dreb"/.test(e.message))
  await assert.rejects(() => savant.leaderboard({ stat: 'clutch gene' }), /No stat matches "clutch gene"\. nba_list_stats lists every stat/)
})

// "99th percentile" is four men in a pool of 349, so a card also says a stat's place when it
// is in the top ten. It has to be the leaderboard's place, or the two tools contradict each
// other on the one question (did he lead the league?) a place exists to answer.
test('a place on a card is the place on the leaderboard', async () => {
  let seen = 0
  for (const season of [latest, '2009-10']) {
    for (const key of ['ts', 'bpm', 'blk', 'tov', 'usg', 'ast']) {
      const board = (await savant.leaderboard({ stat: key, season, limit: 25 })).structured
      for (const l of board.leaders.filter((_, i) => i % 4 === 0)) {
        const { structured: s, text } = await savant.playerProfile({ player: l.id, season })
        const stat = s.stats.find((x) => x.key === key)
        assert.deepEqual([stat.league_rank, stat.league_rank_of], [l.rank, board.ranked], `${season} ${key} ${l.name}`)
        const said = text.includes(`; ${ordinalOf(l.rank)} of ${board.ranked} qualified)`)
        assert.equal(said, l.rank <= 10, `${season} ${key} ${l.name}: the place is printed for the top ten only`)
        seen++
      }
    }
  }
  assert.ok(seen > 60)
  // A man who did not qualify is in no pool, so he has no place.
  const out = files.seasons[latest].players.find((p) => !p.qualified && p.m.ts)
  assert.ok((await savant.playerProfile({ player: String(out.id) })).structured.stats.every((x) => x.league_rank === null))
})

test('a comparison and a career say what the cards say', async () => {
  const file = files.seasons[latest]
  const [a, b] = file.players.filter((p) => p.qualified && p.line && p.line.ppg > 25).slice(0, 2)
  const cmp = await savant.comparePlayers({ players: [String(a.id), b.name] })
  assert.deepEqual(cmp.structured.players.map((x) => [x.id, x.season]), [[String(a.id), latest], [String(b.id), latest]])
  // The page's headline stats, in the page's order.
  assert.deepEqual(cmp.structured.stats.map((x) => x.key), files.meta.leaderboard.common)
  for (const [i, row] of [a, b].entries()) {
    const card = (await savant.playerProfile({ player: String(row.id) })).structured
    for (const st of cmp.structured.stats) {
      const on = card.stats.find((x) => x.key === st.key)
      const v = st.values[i]
      if (!on) { assert.equal(v.status, 'no value'); continue }
      assert.deepEqual([v.status, v.value, v.display, v.league_percentile, v.position_percentile, v.league_rank, v.low_sample], ['ok', on.value, on.display, on.league_percentile, on.position_percentile, on.league_rank, on.low_sample], `${row.name} ${st.key}`)
      assert.equal(st.what, on.what)
    }
  }
  // One man against himself in two seasons, and a stat one of those seasons did not track.
  const veteran = files.players.players.filter((p) => p.seasons >= 12 && +p.from.slice(0, 4) < 2010 && +p.to.slice(0, 4) >= 2018 && !String(p.id).startsWith('br:'))[0]
  const self = await savant.comparePlayers({ players: [String(veteran.id), String(veteran.id)], seasons: [veteran.from, veteran.to], stats: ['ts', 'defl'] })
  assert.deepEqual(self.structured.players.map((x) => x.season), [veteran.from, veteran.to])
  assert.equal(self.structured.stats[1].values[0].status, 'not tracked that season')
  assert.match(self.text, /Each percentile is inside that player's own season/)
  await assert.rejects(() => savant.comparePlayers({ players: [a.name, a.name] }), /is listed twice\. To compare one player with himself, give two different seasons/)
  await assert.rejects(() => savant.comparePlayers({ players: [a.name, b.name], seasons: [latest, latest, latest] }), /one season per player in the same order: 2 players, 3 seasons/)

  // A career: every season he has, oldest first, each line the card's own numbers.
  const career = await savant.playerCareer({ player: String(veteran.id), stats: ['ts', 'usg', 'bpm', 'defl'] })
  const mine = files.meta.seasons.filter((sn) => files.seasons[sn].players.some((p) => String(p.id) === String(veteran.id))).reverse()
  assert.deepEqual(career.structured.seasons.map((x) => x.season), mine)
  for (const sn of career.structured.seasons.filter((_, i) => i % 3 === 0)) {
    const card = (await savant.playerProfile({ player: String(veteran.id), season: sn.season })).structured
    assert.deepEqual([sn.team, sn.position, sn.games, sn.qualified, sn.per_game], [card.player.team, card.player.position, card.player.games, card.player.qualified, card.per_game])
    sn.stats.forEach((v) => {
      const on = card.stats.find((x) => x.key === v.key)
      if (on) assert.deepEqual([v.status, v.value, v.display, v.league_percentile], ['ok', on.value, on.display, on.league_percentile])
      else assert.ok(['no value', 'not tracked that season'].includes(v.status))
    })
  }
  // His best season in each stat is the best of the lines above, qualified seasons only.
  for (const [i, best] of career.structured.best_seasons.entries()) {
    const vals = career.structured.seasons.filter((sn) => sn.qualified && sn.stats[i].status === 'ok').map((sn) => sn.stats[i].value)
    assert.equal(best.best ? best.best.value : null, vals.length ? Math.max(...vals) : null, best.key)
  }
  const part = await savant.playerCareer({ player: String(veteran.id), from: mine[2], to: mine[4] })
  assert.deepEqual(part.structured.seasons.map((x) => x.season), mine.slice(2, 5))
  await assert.rejects(() => savant.playerCareer({ player: String(veteran.id), from: mine[4], to: mine[2] }), /"from" \(.*\) is after "to"/)
  // A career split across two ids is not merged on a name: the other id is pointed to.
  const split = files.players.players.find((p) => String(p.id).startsWith('br:') && files.players.players.some((q) => q.name === p.name && q.id !== p.id))
  if (split) assert.match((await savant.playerCareer({ player: String(split.id) })).text, /also lists ".*" under id .*If it is the same man, ask again with that id/)
})

test('the glossary gives every stat its key and the page\'s own explanation', async () => {
  const all = (await savant.listStats({})).structured
  assert.deepEqual(all.stats.filter((x) => x.group !== 'Per-game line').map((x) => [x.key, x.label, x.what]), files.meta.metrics.map((m) => [m.key, m.label, m.explain]))
  // The explanations are the page's EXPL table, word for word.
  const expl = vm.runInNewContext(`(${html.slice(html.indexOf('const EXPL={') + 'const EXPL='.length, html.indexOf('\n};', html.indexOf('const EXPL={')) + 2)})`)
  for (const m of all.stats.filter((x) => x.group !== 'Per-game line')) assert.equal(m.what, expl[m.key] || null, m.key)
  assert.deepEqual(all.stats.filter((x) => x.group === 'Per-game line').map((x) => x.key), ['ppg', 'rpg', 'apg', 'tpg'])
  const per75 = (await savant.listStats({ query: '75' })).structured
  assert.ok(per75.stats.length >= 5 && per75.stats.every((x) => /75/.test(x.label) || /75/.test(x.what)))
  assert.ok(per75.notes.some((n) => /per 75 possessions/.test(n)))
  assert.deepEqual((await savant.listStats({ group: 'value' })).structured.stats.map((x) => x.key), files.meta.metrics.filter((m) => m.group === 'val').map((m) => m.key))
  assert.match((await savant.listStats({ query: 'zzzz' })).text, /No Basketball Savant stat matches "zzzz"/)
})

// ---- 2. the protocol -----------------------------------------------------------------

test('the handshake and tool list are what a directory reviewer expects', async () => {
  assert.equal(client.getServerVersion().name, 'wcehoops')
  assert.match(client.getInstructions(), /percentile/)
  const { tools } = await client.listTools()
  // The whole list, by name. Adding or dropping a tool should be a decision, not a side effect.
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'nba_compare_players', 'nba_draft_get_prospect_profile', 'nba_draft_search_prospects',
    'nba_get_leaderboard', 'nba_get_player_career', 'nba_get_player_profile', 'nba_list_stats', 'nba_search_players',
    'nfl_compare_players', 'nfl_get_coach_leaderboard', 'nfl_get_coach_profile', 'nfl_get_leaderboard',
    'nfl_get_player_career', 'nfl_get_player_profile', 'nfl_list_stats', 'nfl_search_coaches', 'nfl_search_players',
    'ufc_compare_fighters', 'ufc_get_fighter_profile', 'ufc_get_leaderboard', 'ufc_get_upcoming_cards', 'ufc_list_stats', 'ufc_search_fighters',
    'wce_get_article', 'wce_get_big_board', 'wce_get_dynasty_rankings', 'wce_get_news', 'wce_search_articles',
  ])
  // Every Savant answers the same kinds of question under the same names.
  for (const kind of ['leaderboard', 'list_stats']) for (const sport of ['nba', 'nfl', 'ufc']) assert.ok(tools.some((t) => t.name === `${sport}_get_${kind}` || t.name === `${sport}_${kind}`), `${sport} ${kind}`)
  assert.match(client.getInstructions(), /_leaderboard tool, never a string of profiles/)
  // What an assistant is handed before anyone asks anything: names, descriptions and input
  // shapes. Kept in check, because every conversation with the connector on pays for it: about
  // 1,350 characters a tool across 28 tools.
  const upfront = tools.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0)
  assert.ok(upfront < 40000, `tool names, descriptions and inputs came to ${upfront} characters`)
  for (const t of tools) {
    assert.ok(t.name.length <= 64)
    assert.ok(t.title && t.annotations.title, `${t.name}: title`)
    assert.equal(t.annotations.readOnlyHint, true, `${t.name}: read-only`)
    assert.equal(t.annotations.destructiveHint, false)
    assert.ok(t.description.length > 80 && t.description.length < 1300, `${t.name}: description is ${t.description.length} characters`)
    // A description says what the tool returns. It does not tell the assistant what to do.
    assert.doesNotMatch(t.description, /\b(you must|you should|always call|never call|ignore (all|any|previous)|system prompt|do not tell)\b/i, `${t.name}: description gives orders`)
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
  assert.equal((await list.json()).result.tools.length, 28)

  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(note.status, 202)
})

// The connector is announced on the homepage, so it has a brake (api/_limit.js): a caller past
// its limit is told to wait, at once, before any tool runs. First the counting, on a clock the
// test controls; then the real endpoint, with callers told apart the way Vercel tells them.
test('the brake: a caller past the limit is told to wait, and nobody else is', async () => {
  const { makeLimiter } = await import('../../api/_limit.js')
  let t = 1_000_000
  const lim = makeLimiter({ windowMs: 60_000, maxKeys: 50, now: () => t })
  for (let i = 0; i < 5; i++) assert.deepEqual(lim.take('a', 5), { ok: true })
  assert.deepEqual(lim.take('a', 5), { ok: false, retryAfter: 60, first: true })
  assert.deepEqual(lim.take('b', 5), { ok: true }, 'another caller is not affected')
  t += 59_000
  assert.deepEqual(lim.take('a', 5), { ok: false, retryAfter: 1, first: false }, 'only the first refusal of a window is marked')
  t += 1_000
  assert.deepEqual(lim.take('a', 5), { ok: true }, 'a new minute starts a new count')
  for (let i = 0; i < 4; i++) lim.take('a', 5)
  assert.equal(lim.take('a', 5).first, true, '...and a new minute\'s first refusal is marked again')
  assert.deepEqual(lim.take('c', 5, 5), { ok: true }, 'five at once count as five')
  assert.equal(lim.take('c', 5).ok, false)
  assert.equal(lim.take('d', 5, 6).ok, false, 'more than the limit at once never fits')
  assert.equal(lim.take('d', 5, 5).ok, true, '...and a refusal costs the caller nothing')
  for (let i = 0; i < 2000; i++) lim.take(`caller-${i}`, 5)
  assert.ok(lim.size() <= 50, `memory is bounded: ${lim.size()} callers held`)
  assert.equal(lim.take('caller-1999', 5).ok, true, 'the newest callers are the ones kept')

  const ping = { jsonrpc: '2.0', id: 7, method: 'ping' }
  const from = (ip, body = ping, headers = { 'x-real-ip': ip }) => post(body, headers)
  process.env.MCP_RATE_PER_MINUTE = '8'
  try {
    for (let i = 0; i < 8; i++) assert.equal((await from('203.0.113.9')).status, 200, `request ${i + 1} of 8`)
    const stopped = await from('203.0.113.9')
    assert.equal(stopped.status, 429)
    const wait = Number(stopped.headers.get('retry-after'))
    assert.ok(wait >= 1 && wait <= 60, `Retry-After: ${wait}`)
    assert.match(stopped.headers.get('access-control-expose-headers'), /Retry-After/)
    const said = await stopped.json()
    assert.equal(said.id, 7, 'the refusal answers the request that was asked')
    assert.equal(said.error.code, -32000)
    assert.match(said.error.message, new RegExp(`Wait ${wait} seconds`))
    assert.doesNotMatch(JSON.stringify(said), /203\.0\.113/, 'the caller\'s address is not echoed back')

    // A stopped caller's tool call does not run: nothing is fetched for it.
    savant.clearCache()
    const before = hits
    const profile = { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nba_get_player_profile', arguments: { player: 'Nikola Jokic' } } }
    assert.equal((await from('203.0.113.9', profile)).status, 429)
    assert.equal(hits, before, 'a refused tool call fetched data')
    // Somebody else, at the same moment, is answered.
    const other = await from('203.0.113.10', profile)
    assert.equal(other.status, 200)
    assert.ok(hits > before)
    assert.ok(!(await other.json()).result.isError)

    // Without x-real-ip the first address in x-forwarded-for is the caller.
    for (let i = 0; i < 8; i++) assert.equal((await from(null, ping, { 'x-forwarded-for': '203.0.113.20, 10.0.0.1' })).status, 200)
    assert.equal((await from(null, ping, { 'x-forwarded-for': '203.0.113.20, 10.0.0.2' })).status, 429)

    // Several messages in one request count as several.
    const five = [1, 2, 3, 4, 5].map((id) => ({ jsonrpc: '2.0', id, method: 'ping' }))
    assert.notEqual((await from('203.0.113.30', five)).status, 429, 'five of eight')
    const over = await from('203.0.113.30', five)
    assert.equal(over.status, 429, 'ten of eight')
    assert.equal((await over.json()).id, null)

    // An id that is not a string or a number is not echoed back.
    for (let i = 0; i < 8; i++) await from('203.0.113.40')
    assert.equal((await (await from('203.0.113.40', { jsonrpc: '2.0', id: { evil: true }, method: 'ping' })).json()).id, null)
  } finally {
    delete process.env.MCP_RATE_PER_MINUTE
  }

  // Back on the real limit, the caller stopped above is still inside its minute but well
  // under 300, so it is answered again: the number is read on every request.
  assert.equal((await from('203.0.113.9')).status, 200)
  process.env.MCP_RATE_PER_MINUTE = 'not a number'
  try { assert.equal((await from('203.0.113.9')).status, 200, 'a bad setting falls back to the default') } finally { delete process.env.MCP_RATE_PER_MINUTE }

  // A body too big to be a real request is refused by its stated size.
  const big = await post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } })
  assert.equal(big.status, 413)
  assert.equal((await big.json()).error.code, -32600)
})

// ---- the usage log -------------------------------------------------------------------
// The connector keeps a tally of its own use (api/_usage.js). Two things have to be true of
// it: it holds counts and nothing else, and it can never cost the site more than its cap or
// get in the way of an answer.

test('the usage log: which app is which, and the summary the page shows', async () => {
  const usage = await import('../../api/_usage.js')
  for (const [name, family] of [
    ['claude-ai', 'claude'], ['Claude Code', 'claude'], ['Anthropic/ClaudeAI', 'claude'],
    ['openai-mcp', 'chatgpt'], ['ChatGPT', 'chatgpt'], ['gemini-cli-mcp-client', 'gemini'],
    ['cursor-vscode', 'cursor'], ['Visual Studio Code', 'vscode'], ['github-copilot-developer', 'copilot'],
    ['windsurf-client', 'windsurf'], ['mcp-inspector', 'inspector'],
    ['check', 'other'], ['', 'other'], [undefined, 'other'], [null, 'other'], [{ name: 'claude' }, 'other'],
    ['x'.repeat(500) + 'claude', 'other'],
  ]) assert.equal(usage.clientFamily(name), family, String(name).slice(0, 30))

  const months = {
    '2026-10': {
      '02|t:nba_get_player_profile': '7', '02|e:nba_get_player_profile': '2', '02|t:wce_get_news': '1',
      '02|c:claude': '3', '02|c:other': '1', '02|writes': '12',
      '03|t:nfl_search_players': '4', '03|limited': '2', '03|writes': '5001',
      junk: '9', '3|t:short_day': '1', '02|t:nothing': '0', '02|t:not_a_number': 'abc',
    },
    '2026-11': { '01|t:nba_get_player_profile': '5', '01|writes': '5' },
  }
  const all = usage.summarise(months, { cap: 5000 })
  assert.deepEqual(all.totals, { calls: 17, errors: 2, connections: 4, limited: 2, days: 3 })
  assert.deepEqual(all.daily, [
    { date: '2026-10-02', calls: 8, errors: 2, connections: 4, limited: 0, capped: false },
    { date: '2026-10-03', calls: 4, errors: 0, connections: 0, limited: 2, capped: true },
    { date: '2026-11-01', calls: 5, errors: 0, connections: 0, limited: 0, capped: false },
  ])
  assert.deepEqual(all.tools, [
    { key: 'nba_get_player_profile', calls: 12, errors: 2 },
    { key: 'nfl_search_players', calls: 4, errors: 0 },
    { key: 'wce_get_news', calls: 1, errors: 0 },
  ])
  assert.deepEqual(all.clients, [{ key: 'claude', count: 3 }, { key: 'other', count: 1 }])
  assert.deepEqual(all.cappedDays, ['2026-10-03'])
  assert.equal(all.cap, 5000)
  // A range keeps only its own days.
  const late = usage.summarise(months, { from: '2026-10-03', to: '2026-10-31', cap: 5000 })
  assert.deepEqual(late.totals, { calls: 4, errors: 0, connections: 0, limited: 2, days: 1 })
  assert.deepEqual(late.tools.map((t) => t.key), ['nfl_search_players'])
  assert.deepEqual(usage.summarise({}, {}).totals, { calls: 0, errors: 0, connections: 0, limited: 0, days: 0 })

  // With no store set up, counting is a quiet no-op.
  assert.equal(await usage.count(['t:wce_get_news']), false)
})

test('the usage log: counts only, one command a write, capped, and never in the way', { skip: store ? false : 'redis-server is not installed here' }, async () => {
  const usage = await import('../../api/_usage.js')
  const today = usage.dayOf(Date.now())
  const dd = today.slice(8)
  const key = `wce:mcp:usage:${today.slice(0, 7)}`
  // What the store holds for today, with the day prefix taken off.
  const stored = async (k = key, day = dd) => {
    const flat = await store.send(['HGETALL', k])
    const out = {}
    for (let i = 0; i < flat.length; i += 2) if (flat[i].startsWith(`${day}|`)) out[flat[i].slice(3)] = Number(flat[i + 1])
    return out
  }
  const ping = { jsonrpc: '2.0', id: 7, method: 'ping' }
  const hello = (name) => post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } } })

  process.env.KV_REST_API_URL = store.url
  process.env.KV_REST_API_TOKEN = store.token
  usage.resetUsage()
  try {
    // A call that works: one count, one command.
    let before = store.commands
    assert.ok(!(await call('nba_get_player_profile', { player: 'Nikola Jokic' })).isError)
    assert.equal(store.commands - before, 1, 'a call costs one command')
    assert.deepEqual(await stored(), { writes: 1, 't:nba_get_player_profile': 1 })

    // A call that cannot be answered is a call and an error.
    before = store.commands
    assert.ok((await call('nba_get_player_profile', { player: 'Zzyzx Nobody' })).isError)
    assert.equal(store.commands - before, 2)

    // Listing the tools and pinging are not use: nothing is counted.
    before = store.commands
    await client.listTools()
    await client.ping()
    assert.equal(store.commands - before, 0)

    // Apps saying hello are counted by family.
    for (const name of ['claude-ai', 'claude-ai', 'ChatGPT', 'Some New App 9000']) assert.equal((await hello(name)).status, 200)

    // The brake is logged once per caller per minute, not once per refusal.
    process.env.MCP_RATE_PER_MINUTE = '2'
    const statuses = []
    for (let i = 0; i < 6; i++) statuses.push((await post(ping, { 'x-real-ip': '203.0.113.77' })).status)
    delete process.env.MCP_RATE_PER_MINUTE
    assert.deepEqual(statuses, [200, 200, 429, 429, 429, 429])

    assert.deepEqual(await stored(), {
      writes: 8,
      't:nba_get_player_profile': 2,
      'e:nba_get_player_profile': 1,
      'c:claude': 2,
      'c:chatgpt': 1,
      'c:other': 1,
      limited: 1,
    })

    // Counts and nothing else. The whole store, searched for anything a caller sent.
    assert.deepEqual(await store.send(['KEYS', '*']), [key])
    assert.doesNotMatch(JSON.stringify(await store.send(['HGETALL', key])), /jokic|zzyzx|nobody|203\.0\.113|127\.0\.0\.1|new app|9000/i)
    const ttl = await store.send(['TTL', key])
    assert.ok(ttl > 399 * 86400 && ttl <= 400 * 86400, `kept 400 days: ${ttl}s`)

    // Reading it back is one command a month, and the private page's endpoint carries it.
    before = store.commands
    const log = await usage.readUsage()
    assert.equal(store.commands - before, 1)
    assert.deepEqual(log.totals, { calls: 2, errors: 1, connections: 4, limited: 1, days: 1 })
    assert.deepEqual(log.daily, [{ date: today, calls: 2, errors: 1, connections: 4, limited: 1, capped: false }])
    assert.deepEqual(log.clients, [{ key: 'claude', count: 2 }, { key: 'chatgpt', count: 1 }, { key: 'other', count: 1 }])

    const history = (await import('../../api/analytics/history.js')).default
    const ask = async (headers) => {
      let status = 200
      let body
      const res = { setHeader() {}, status(c) { status = c; return res }, json(b) { body = b; return res } }
      await history({ url: '/api/analytics/history', method: 'GET', headers }, res)
      return { status, body }
    }
    process.env.ANALYTICS_DASHBOARD_PASSWORD = 'the-password'
    assert.equal((await ask({})).status, 401, 'the page\'s endpoint is still behind its password')
    assert.equal((await ask({ 'x-analytics-key': 'wrong' })).body.connector, undefined)
    const page = await ask({ 'x-analytics-key': 'the-password' })
    assert.equal(page.status, 200)
    assert.deepEqual(page.body.connector.totals, log.totals)
    assert.deepEqual(page.body.connector.tools, [{ key: 'nba_get_player_profile', calls: 2, errors: 1 }])

    // The cap. After it, the store counts nothing more that day, and this copy stops asking.
    await store.send(['FLUSHALL'])
    usage.resetUsage()
    process.env.MCP_USAGE_DAILY_CAP = '3'
    for (let i = 0; i < 3; i++) assert.equal(await usage.count(['t:wce_get_news']), true)
    before = store.commands
    assert.equal(await usage.count(['t:wce_get_news']), false, 'the write past the cap counts nothing')
    assert.equal(store.commands - before, 1)
    assert.equal(await usage.count(['t:wce_get_news']), false)
    assert.ok(!(await call('wce_get_big_board', {})).isError, 'a capped day still answers')
    assert.equal(store.commands - before, 1, 'once it knows, it sends nothing more that day')
    assert.deepEqual(await stored(), { writes: 4, 't:wce_get_news': 3 })
    // Another copy of the function finds out with one command of its own.
    usage.resetUsage()
    assert.equal(await usage.count(['t:wce_get_news']), false)
    assert.equal(await usage.count(['t:wce_get_news']), false)
    assert.equal(store.commands - before, 2)
    assert.deepEqual(await stored(), { writes: 5, 't:wce_get_news': 3 })
    const capped = await usage.readUsage()
    assert.deepEqual(capped.cappedDays, [today])
    assert.equal(capped.cap, 3)
    // Tomorrow it counts again.
    assert.equal(await usage.count(['t:wce_get_news'], Date.now() + 24 * 60 * 60 * 1000), true)
    delete process.env.MCP_USAGE_DAILY_CAP

    // Days are UTC days, and a month is its own hash.
    await store.send(['FLUSHALL'])
    usage.resetUsage()
    assert.equal(await usage.count(['t:nba_search_players'], Date.UTC(2026, 9, 31, 23, 59, 59)), true)
    assert.equal(await usage.count(['t:nba_search_players'], Date.UTC(2026, 10, 1, 0, 0, 1)), true)
    assert.deepEqual((await store.send(['KEYS', '*'])).sort(), ['wce:mcp:usage:2026-10', 'wce:mcp:usage:2026-11'])
    assert.deepEqual(await stored('wce:mcp:usage:2026-10', '31'), { writes: 1, 't:nba_search_players': 1 })
    before = store.commands
    const two = await usage.readUsage({ from: '2026-10-01', to: '2026-11-30' })
    assert.equal(store.commands - before, 2, 'one command a month')
    assert.deepEqual(two.daily.map((d) => [d.date, d.calls]), [['2026-10-31', 1], ['2026-11-01', 1]])
    assert.deepEqual((await usage.readUsage({ from: '2026-11-01', to: '2026-11-30' })).daily.map((d) => d.date), ['2026-11-01'])

    // Only the names it knows are ever written, whatever it is handed.
    before = store.requests
    assert.equal(await usage.count(['t:Nikola Jokic', 'q:who', `t:${'a'.repeat(60)}`, 'limited ', '']), false)
    assert.equal(store.requests, before)

    // The store is down: the answer still goes out, and the store is left alone for a minute.
    usage.resetUsage()
    store.down = true
    before = store.requests
    assert.ok(!(await call('wce_get_big_board', {})).isError)
    assert.equal(store.requests - before, 1)
    assert.ok(!(await call('wce_get_big_board', {})).isError)
    assert.equal(store.requests - before, 1, 'after a failure the store is left alone')
    store.down = false
    assert.equal(await usage.count(['t:wce_get_big_board'], Date.now() + 30 * 1000), false, 'still left alone 30 seconds on')
    assert.equal(await usage.count(['t:wce_get_big_board'], Date.now() + 61 * 1000), true, 'and tried again after a minute')

    // The store is slow: the call does not wait for it past 700 ms.
    usage.resetUsage()
    store.delay = 1500
    const started = Date.now()
    assert.ok(!(await call('wce_get_big_board', {})).isError)
    const took = Date.now() - started
    assert.ok(took >= 650 && took < 1300, `a slow store held the answer ${took} ms`)
    store.delay = 0
    await new Promise((r) => setTimeout(r, 1000)) // let the held request finish before the store stops
  } finally {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.MCP_RATE_PER_MINUTE
    delete process.env.MCP_USAGE_DAILY_CAP
    delete process.env.ANALYTICS_DASHBOARD_PASSWORD
    usage.resetUsage()
  }
})

test('every tool of every section answers through the endpoint', async () => {
  assert.equal(built.failed, 0, 'a section failed to write its files')
  // callTool validates each result against its tool's declared output shape.
  const ok = async (name, args, expect) => {
    const r = await call(name, args)
    const text = textOf(r)
    assert.ok(!r.isError, `${name} ${JSON.stringify(args)}: ${text.slice(0, 300)}`)
    assert.match(text, expect, `${name} ${JSON.stringify(args)}`)
    assert.ok(text.length < 13000, `${name}: ${text.length} characters`)
    assert.match(text, /wcehoops\.com/, `${name}: links to the site`)
    return r.structuredContent
  }
  await ok('nba_search_players', { query: 'jokic' }, /Nikola Jokic/)
  await ok('nba_get_player_profile', { player: 'Nikola Jokic' }, /vs\. bigs/)
  await ok('nba_get_player_profile', { player: 'Nikola Jokic', group: 'defense' }, /Defensive BPM/)
  await ok('nba_get_leaderboard', { stat: 'true shooting' }, /True shooting %, .*: the top 10 of \d+ qualified players/)
  await ok('nba_get_leaderboard', { stat: 'ppg', position: 'guard', limit: 3, order: 'bottom' }, /the bottom 3 of \d+ qualified guards/)
  await ok('nba_compare_players', { players: ['Nikola Jokic', 'Shai Gilgeous-Alexander'] }, /side by side/)
  await ok('nba_compare_players', { players: ['Stephen Curry', 'Stephen Curry'], seasons: ['2015-16', '2024-25'], group: 'value' }, /2015-16 .* \| 2024-25 /)
  await ok('nba_get_player_career', { player: 'Stephen Curry', stats: ['tp3', 'ts'] }, /Best season in each/)
  await ok('nba_list_stats', { query: 'gravity' }, /Off-ball gravity \(key "grav"\)/)

  const qb = await ok('nfl_search_players', { query: 'patrick mahomes' }, /Patrick Mahomes/)
  await ok('nfl_get_player_profile', { player: qb.players[0].id }, /vs\. quarterbacks/)
  await ok('nfl_get_player_profile', { player: 'Patrick Mahomes', season: '2022', group: 'passing' }, /2022 regular season/)
  await ok('nfl_get_leaderboard', { position: 'QB', season: '2022' }, /Quarterbacks by EPA \/ dropback, 2022: the top 10 of \d+ qualified quarterbacks/)
  await ok('nfl_get_leaderboard', { stat: 'passing yards', season: '2022', limit: 3 }, /NFL leaders in passing yards, 2022\n\n1\. Patrick Mahomes .*: 5,250, 17 games/)
  await ok('nfl_get_leaderboard', { position: 'running back' }, /Running backs by /)
  await ok('nfl_compare_players', { players: ['Patrick Mahomes', 'Josh Allen'], seasons: ['2022'] }, /side by side/)
  await ok('nfl_get_player_career', { player: 'Patrick Mahomes', to: '2020' }, /Patrick Mahomes: 4 seasons, 2017 to 2020/)
  await ok('nfl_list_stats', { position: 'QB', query: 'cpoe' }, /CPOE \(key "cpoe"\)/)

  await ok('nfl_search_coaches', { query: 'shanahan' }, /Kyle Shanahan/)
  await ok('nfl_get_coach_profile', { coach: 'Andy Reid' }, /hand-curated/)
  await ok('nfl_get_coach_profile', { coach: 'Andy Reid', group: 'fourth_downs' }, /How he ranks on fourth down\n- Fourth-down aggression: /)
  await ok('nfl_get_coach_leaderboard', { stat: 'fourth-down aggression', limit: 5 }, /NFL head coaches by Fourth-down aggression: the top 5 of \d+/)

  const fighter = await ok('ufc_search_fighters', { query: 'makhachev' }, /Islam Makhachev/)
  await ok('ufc_get_fighter_profile', { fighter: fighter.fighters[0].id }, /vs\. active /)
  await ok('ufc_get_fighter_profile', { fighter: 'Islam Makhachev', window: 'l3', group: 'striking' }, /last 3 fights/i)
  // Whatever today is: cards still to come, or word that every listed card has been fought.
  await ok('ufc_get_upcoming_cards', {}, /UFC cards? still to come|has already happened/)
  await ok('ufc_get_upcoming_cards', { which: 'all' }, /UFC cards? in the list/)
  await ok('ufc_get_leaderboard', { division: 'lightweight' }, /official UFC Lightweight ranking/)
  await ok('ufc_get_leaderboard', { stat: 'takedown defense', division: 'LW', limit: 5 }, /Takedown defense, UFC career: the top 5 of \d+ active fighters in Lightweight/)
  await ok('ufc_compare_fighters', { fighters: ['Islam Makhachev', 'Charles Oliveira'] }, /side by side/)
  await ok('ufc_list_stats', { query: 'takedown' }, /Takedown defense \(key "tddef"\)/)

  const prospect = await ok('nba_draft_search_prospects', { query: 'flagg' }, /Cooper Flagg/)
  await ok('nba_draft_get_prospect_profile', { prospect: prospect.prospects[0].id }, /not NBA stats/)

  await ok('wce_get_news', { section: 'headlines', limit: 3 }, /generated \d{4}-\d{2}-\d{2}/)
  const articles = await ok('wce_search_articles', {}, /WCE article/)
  if (articles.articles.length) await ok('wce_get_article', { article: articles.articles[0].slug }, /wcehoops\.com\/articles\//)
  await ok('wce_get_big_board', {}, /Big Board/)

  // The Dynasty board is live. With its store not set up it must say so plainly, not guess.
  const board = await call('wce_get_dynasty_rankings', {})
  assert.ok(board.isError)
  assert.doesNotMatch(textOf(board), /127\.0\.0\.1|ECONNREFUSED|\.js:\d+/)
})

// The homepage shows one worked answer and three questions to try (src/data/connector.js,
// drawn by AiConnector.jsx and Gateway.jsx). The answer is presented as real, so it has to
// be: every figure on it is held here to what the connector says for that player and season.
test('what the homepage says about the connector is true', async () => {
  const r = await call('nba_get_player_profile', { player: EXAMPLE.id, season: EXAMPLE.season })
  assert.ok(!r.isError, textOf(r))
  const p = r.structuredContent
  assert.equal(p.player.name, EXAMPLE.name)
  assert.equal(p.player.team, EXAMPLE.team)
  assert.equal(p.player.qualified, true)
  assert.equal(p.pools.league, EXAMPLE.pool)
  for (const k of ['points', 'rebounds', 'assists']) assert.equal(p.per_game[k], EXAMPLE.perGame[k], k)
  for (const shown of EXAMPLE.stats) {
    const got = p.stats.find((x) => x.key === shown.key)
    assert.ok(got, `${shown.key} is a stat on his profile`)
    assert.equal(got.label, shown.label)
    assert.equal(got.display, shown.display, shown.key)
    assert.equal(got.league_percentile, shown.percentile, shown.key)
    assert.equal(got.low_sample, false, shown.key)
  }
  assert.equal(p.url, `https://wcehoops.com${EXAMPLE.card}`)

  // The address the homepage hands out is this endpoint's.
  assert.equal(CONNECTOR_URL, 'https://wcehoops.com/api/mcp')

  // Each suggested question has a tool that answers it.
  assert.equal(PROMPTS.length, 3)
  const brown = await call('nfl_search_players', { query: 'Chase Brown' })
  assert.ok(!brown.isError && brown.structuredContent.players.some((x) => x.name === 'Chase Brown'), PROMPTS[0])
  const cards = await call('ufc_get_upcoming_cards', {})
  assert.ok(!cards.isError, PROMPTS[1])
  const boardTop = await call('wce_get_big_board', {})
  assert.ok(!boardTop.isError, PROMPTS[2])
  assert.match(textOf(boardTop), /\b1\. /, 'the Big Board has a No. 1')
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
  // A near spelling never opens a card on its own, even when only one man is close: he is
  // named with his id instead, because a name one letter off may belong to someone who is
  // not in the data.
  const typo = await call('nba_get_player_profile', { player: 'Nikola Jokich' })
  assert.ok(typo.isError)
  assert.match(textOf(typo), /"Nikola Jokich" is not an exact match\. Call again with one of these ids:\n- Nikola Jokic \(id 203999\)/)
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
