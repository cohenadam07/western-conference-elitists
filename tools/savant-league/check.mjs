// Check for WCE Pro (beta) league sync, NFL: the readers (api/_league-nfl.js, behind
// /api/league?sport=nfl) and the connector tool nfl_league (api/_league-pro.js).
//
//   npm run check:savant-league      (node --test tools/savant-league/check.mjs)
//
// The platforms are played by a local server answering from fixtures/: trimmed copies of real
// Sleeper, ESPN and MyFantasyLeague replies from 3 Nov 2026 (league, team and owner names
// replaced), and a Fantrax league in that feed's shape with real Fantrax player ids. The site is
// played by a second server: api/league.js itself, the public files, and the Savant API files
// built from public/ the way the build writes them. No network.
//
// Five questions:
//   1. Does each reader put its platform into the one shape: teams, players, positions, NFL
//      teams, starters / bench / IR, injuries, starting slots, scoring?
//   2. When a league cannot be read (private, missing, a username with several leagues), does
//      it say which?
//   3. Is every number nfl_league puts on a player Football Savant's own, in the league's
//      scoring, with the split (opportunity, efficiency, TD luck) adding up?
//   4. Are players placed on the right Football Savant player, by id first and by name only
//      where the name is unambiguous at his position?
//   5. Only a real WCE key sees it.

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
const FX = path.join(ROOT, 'tools/savant-league/fixtures')
const fx = (n) => JSON.parse(readFileSync(path.join(FX, n), 'utf8'))
const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-league-'))
writeAll({ publicDir: path.join(ROOT, 'public'), dist, log: () => {} })
const read = (rel) => { const f = path.join(dist, rel); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : JSON.parse(gunzipSync(readFileSync(`${f}.gz`))) }
const nflMeta = read('savant-api/football/v1/meta.json')
const SEASON = nflMeta.latestSeason
const seasonFile = read(`savant-api/football/v1/seasons/${SEASON}.json`)
const rowById = new Map(seasonFile.players.map((p) => [p.id, p]))
const ids = JSON.parse(readFileSync(path.join(ROOT, 'public/football-ids.json'), 'utf8'))

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', connection: 'close' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) }

// ---- the platforms, from fixtures -------------------------------------------------------------
const SL_LEAGUE = fx('sleeper_league.json').league_id
const platformHits = []
const platforms = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname
  platformHits.push(p + u.search)
  // Sleeper
  if (p === '/sleeper/players/nfl') return json(res, fx('sleeper_players.json'))
  if (p === `/sleeper/league/${SL_LEAGUE}`) return json(res, fx('sleeper_league.json'))
  if (p === `/sleeper/league/${SL_LEAGUE}/rosters`) return json(res, fx('sleeper_rosters.json'))
  if (p === `/sleeper/league/${SL_LEAGUE}/users`) return json(res, fx('sleeper_users.json'))
  if (p === '/sleeper/user/fixturefan') return json(res, { user_id: 'u1' })
  if (p === '/sleeper/user/onefan') return json(res, { user_id: 'u2' })
  if (p === '/sleeper/user/nobody') return json(res, 'null')
  if (/^\/sleeper\/user\/u1\/leagues\/nfl\/\d{4}$/.test(p)) return json(res, [{ league_id: SL_LEAGUE, name: 'Fixture League (Sleeper)' }, { league_id: '1350000000000000002', name: 'Another league' }])
  if (/^\/sleeper\/user\/u2\/leagues\/nfl\/\d{4}$/.test(p)) return json(res, [{ league_id: SL_LEAGUE, name: 'Fixture League (Sleeper)' }])
  if (p.startsWith('/sleeper/league/')) return json(res, 'null')
  // ESPN
  const em = p.match(/^\/espn\/seasons\/(\d{4})\/segments\/0\/leagues\/(\d+)$/)
  if (em) {
    if (em[2] === '1000001') return json(res, fx('espn_league.json'))
    if (em[2] === '1000002') return json(res, fx('espn_league_half.json'))
    if (em[2] === '1000003') return json(res, { messages: ['You are not authorized to view this League.'] }, 401)
    return json(res, { messages: ['Not Found'] }, 404)
  }
  // MyFantasyLeague
  const mm = p.match(/^\/mfl\/(\d{4})\/export$/)
  if (mm) {
    const T = u.searchParams.get('TYPE')
    const L = u.searchParams.get('L')
    if (T === 'players') return json(res, fx('mfl_players.json'))
    if (L === '90002') return json(res, { error: { $t: 'This league is private. Please log in.' } })
    if (L !== '90001') return json(res, { error: { $t: 'Invalid league ID' } })
    if (T === 'league') return json(res, fx('mfl_league.json'))
    if (T === 'rosters') return json(res, fx('mfl_rosters.json'))
    if (T === 'rules') return json(res, fx('mfl_rules.json'))
  }
  // Fantrax
  if (p === '/fantrax/getPlayerIds') return json(res, fx('fantrax_players.json'))
  if (p === '/fantrax/getTeamRosters') return u.searchParams.get('leagueId') === 'fx1' ? json(res, fx('fantrax_rosters.json')) : json(res, { error: 'Invalid league' })
  json(res, { error: 'not in the fixtures' }, 404)
})

// ---- the site --------------------------------------------------------------------------------
let leagueHandler
const site = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/league') {
    const r = { status(c) { res.statusCode = c; return r }, setHeader: (k, v) => res.setHeader(k, v), json(b) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)) } }
    return leagueHandler({ query: Object.fromEntries(u.searchParams) }, r)
  }
  for (const f of [path.join(ROOT, 'public', u.pathname), path.join(dist, u.pathname)]) {
    if (!f.startsWith(ROOT) && !f.startsWith(dist)) break
    if (existsSync(f) && statSync(f).isFile()) return json(res, readFileSync(f))
    if (existsSync(`${f}.gz`)) return json(res, gunzipSync(readFileSync(`${f}.gz`)))
  }
  res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); res.end('<!doctype html>')
})

let NFL, PRO, mcp, keyed
async function clientFor(state) {
  const server = mcp.buildServer(state)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const c = new Client({ name: 'check', version: '0' })
  await c.connect(b)
  return c
}

before(async () => {
  const pp = await listen(platforms)
  process.env.LEAGUE_NFL_BASES = JSON.stringify({ sleeper: `http://127.0.0.1:${pp}/sleeper`, espn: `http://127.0.0.1:${pp}/espn`, mfl: `http://127.0.0.1:${pp}/mfl`, fantrax: `http://127.0.0.1:${pp}/fantrax` })
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(site)}`
  delete process.env.KV_REST_API_URL
  delete process.env.UPSTASH_REDIS_REST_URL
  NFL = await import('../../api/_league-nfl.js')
  leagueHandler = (await import('../../api/league.js')).default
  PRO = await import('../../api/_league-pro.js')
  mcp = await import('../../api/mcp.js')
  keyed = await clientFor({ state: 'valid', id: 'abcdef012345' })
})

after(async () => {
  await keyed.close()
  platforms.close()
  site.close()
  rmSync(dist, { recursive: true, force: true })
})

const ask = async (args) => {
  const r = await keyed.callTool({ name: 'nfl_league', arguments: args })
  if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n'))
  return r.structuredContent
}
const refused = async (args, re) => {
  const r = await keyed.callTool({ name: 'nfl_league', arguments: args })
  assert.ok(r.isError, `expected a refusal for ${JSON.stringify(args)}`)
  assert.match(r.content.map((c) => c.text).join('\n'), re)
}
const all = (out) => out.teams.flatMap((t) => t.players)

// ---- 1. the readers ---------------------------------------------------------------------------

test('Sleeper: every roster, starters / bench / IR from the league, slots and scoring', async () => {
  const out = await NFL.readNflLeague({ platform: 'sleeper', code: SL_LEAGUE })
  const ro = fx('sleeper_rosters.json')
  const lg = fx('sleeper_league.json')
  assert.equal(out.teams.length, ro.length)
  for (const r of ro) {
    const t = out.teams.find((x) => x.id === String(r.roster_id))
    const want = (r.players || []).filter((p) => p !== '0')
    assert.deepEqual(t.players.map((p) => p.pid).sort(), want.map(String).sort())
    for (const p of t.players) {
      const status = (r.starters || []).includes(p.pid) ? 'start' : (r.reserve || []).includes(p.pid) ? 'ir' : (r.taxi || []).includes(p.pid) ? 'taxi' : 'bench'
      assert.equal(p.slot, status, `${p.name} slot`)
    }
  }
  assert.deepEqual(out.league.slots.map((s) => s.slot), lg.roster_positions.filter((x) => !['BN', 'IR', 'TAXI'].includes(x)).map((x) => (x === 'IDP_FLEX' ? 'IDP' : x)))
  assert.deepEqual(out.league.slots.find((s) => s.slot === 'FLEX').eligible, ['RB', 'WR', 'TE'])
  assert.equal(out.league.scoring.rec, lg.scoring_settings.rec)
  assert.equal(out.league.scoring.pass_td, lg.scoring_settings.pass_td)
  assert.equal(out.league.scoring.label, 'PPR')
  // positions and teams in Football Savant's words
  const ps = out.teams.flatMap((t) => t.players)
  assert.ok(ps.every((p) => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDP'].includes(p.pos)), JSON.stringify([...new Set(ps.map((p) => p.pos))]))
  assert.ok(ps.every((p) => p.nfl == null || /^[A-Z]{2,3}$/.test(p.nfl)))
  assert.ok(!ps.some((p) => ['LAR', 'WSH', 'JAC'].includes(p.nfl)))
  // a team's own name where the owner set one, the owner's name where not
  assert.ok(out.teams.some((t) => /^Sleeper Team/.test(t.name)) && out.teams.some((t) => /^owner/.test(t.name)))
})

test('ESPN: slots from lineupSlotCounts, bench and IR from the lineup slot, injury words, scoring', async () => {
  const out = await NFL.readNflLeague({ platform: 'espn', code: '1000001' })
  const e = fx('espn_league.json')
  assert.equal(out.teams.length, e.teams.length)
  assert.equal(out.teams.reduce((n, t) => n + t.players.length, 0), e.teams.reduce((n, t) => n + t.roster.entries.length, 0))
  const counts = e.settings.rosterSettings.lineupSlotCounts
  const starters = Object.entries(counts).filter(([id]) => !['20', '21', '1', '19', '22', '24', '18'].includes(id)).reduce((n, [, c]) => n + c, 0)
  assert.equal(out.league.slots.length, starters)
  for (const t of e.teams) {
    const mine = out.teams.find((x) => x.id === String(t.id))
    for (const en of t.roster.entries) {
      const p = mine.players.find((x) => x.pid === String(en.playerPoolEntry.player.id))
      assert.equal(p.slot, en.lineupSlotId === 20 ? 'bench' : en.lineupSlotId === 21 ? 'ir' : 'start')
      if (['ACTIVE', 'NORMAL', undefined].includes(en.playerPoolEntry.player.injuryStatus)) assert.equal(p.injury, null, `${p.name}: ACTIVE is no injury`)
    }
  }
  assert.ok(out.teams.every((t) => t.owner && /^espnowner/.test(t.owner)))
  assert.equal(out.league.scoring.rec, 1)
  const half = await NFL.readNflLeague({ platform: 'espn', code: '1000002' })
  assert.equal(half.league.scoring.rec, 0.5)
  assert.equal(half.league.scoring.te_rec_bonus, 0.5)
  assert.equal(half.league.scoring.label, 'Half PPR')
})

test('MyFantasyLeague: rosters, IR and taxi, starters with their flex, points a catch, team units apart', async () => {
  const out = await NFL.readNflLeague({ platform: 'mfl', code: '90001', season: '2026' })
  const r = fx('mfl_rosters.json').rosters.franchise
  assert.equal(out.teams.length, r.length)
  for (const f of r) {
    const t = out.teams.find((x) => x.id === f.id)
    assert.deepEqual(t.players.map((p) => p.pid).sort(), [].concat(f.player).map((p) => String(p.id)).sort())
    for (const p of [].concat(f.player)) assert.equal(t.players.find((x) => x.pid === p.id).slot, p.status === 'INJURED_RESERVE' ? 'ir' : p.status === 'TAXI_SQUAD' ? 'taxi' : null)
  }
  const st = fx('mfl_league.json').league.starters
  assert.equal(out.league.slots.length, Number(st.count))
  assert.ok(out.league.slots.some((s) => s.slot === 'FLEX'))
  assert.equal(out.league.scoring.rec, 1)
  // a team kicker unit is not one player
  const units = out.teams.flatMap((t) => t.players).filter((p) => p.pos === 'TEAM')
  assert.ok(units.length > 0 && units.every((p) => /[A-Za-z]/.test(p.name)))
  assert.ok(!out.teams.flatMap((t) => t.players).some((p) => p.nfl === 'LVR'), 'LVR is LV')
  // names "Last, First" read the right way round
  assert.ok(out.teams.flatMap((t) => t.players).every((p) => !p.name.includes(',')))
})

test('Fantrax: rosters by status, names the right way round, no-team players have no team', async () => {
  const out = await NFL.readNflLeague({ platform: 'fantrax', code: 'fx1' })
  assert.equal(out.teams.length, 2)
  const a = out.teams.find((t) => t.id === 'A')
  assert.deepEqual(a.players.map((p) => p.slot), ['start', 'start', 'start', 'start', 'bench', 'bench'])
  assert.ok(a.players.some((p) => p.name === 'Patrick Mahomes' && p.pos === 'QB' && p.nfl === 'KC'))
  assert.ok(a.players.some((p) => p.name === 'Justin Jefferson' && p.pos === 'IDP'), 'the linebacker Justin Jefferson is IDP')
})

// ---- 2. when a league cannot be read ----------------------------------------------------------

test('it says which: private, missing, several leagues, no such user, bad input', async () => {
  assert.deepEqual(await NFL.readNflLeague({ platform: 'espn', code: '1000003' }), { error: 'private' })
  assert.deepEqual(await NFL.readNflLeague({ platform: 'espn', code: '42' }), { error: 'no-league' })
  assert.deepEqual(await NFL.readNflLeague({ platform: 'mfl', code: '90002' }), { error: 'private' })
  assert.deepEqual(await NFL.readNflLeague({ platform: 'mfl', code: '777' }), { error: 'no-league' })
  assert.deepEqual(await NFL.readNflLeague({ platform: 'sleeper', code: 'nobody' }), { error: 'no-user' })
  assert.deepEqual(await NFL.readNflLeague({ platform: 'fantrax', code: 'nope' }), { error: 'no-league' })
  const pick = await NFL.readNflLeague({ platform: 'sleeper', code: 'fixturefan' })
  assert.equal(pick.leagues.length, 2)
  const one = await NFL.readNflLeague({ platform: 'sleeper', code: 'onefan' })
  assert.equal(one.league.id, SL_LEAGUE, 'one league: read it straight away')

  // through the connector, in words
  await refused({ platform: 'espn', code: '1000003' }, /private.*viewable to the public/)
  await refused({ platform: 'espn', code: '42' }, /Could not read that league/)
  await refused({ platform: 'sleeper', code: 'nobody' }, /No Sleeper user/)
  const leagues = await ask({ platform: 'sleeper', code: 'fixturefan' })
  assert.equal(leagues.mode, 'leagues')
  assert.equal(leagues.leagues.length, 2)
  const pickOne = await ask({ platform: 'sleeper', code: 'fixturefan', league: SL_LEAGUE })
  assert.equal(pickOne.league.id, SL_LEAGUE)
  // the endpoint refuses what is not a code
  const r = await fetch(`${process.env.SAVANT_API_ORIGIN}/api/league?sport=nfl&platform=espn&code=${encodeURIComponent('1; drop')}`)
  assert.equal(r.status, 400)
})

// ---- 3. the numbers are Football Savant's -----------------------------------------------------

const r1 = (v) => Math.round(v * 10) / 10
const cell = (row, k) => (row.m && row.m[k]) || (row.xm && row.xm[k]) || null

function holdsNumbers(out, scoring) {
  let n = 0
  for (const p of all(out).filter((x) => x.savant)) {
    const row = rowById.get(p.savant.id)
    assert.ok(row, `${p.name}: ${p.savant.id} is a ${SEASON} row`)
    const g = row.d.g
    const rpg = row.d.rec != null ? row.d.rec / g : 0
    const adj = (scoring.rec - 1) * rpg + (row.pos === 'TE' ? scoring.te * rpg : 0)
    const fp = cell(row, 'fppg'), xf = cell(row, 'xfp'), oe = cell(row, 'fpoe'), td = cell(row, 'tdoe')
    assert.equal(p.savant.points, fp ? r1(fp[0] + adj) : null, `${p.name} points`)
    assert.equal(p.savant.points_ppr, fp ? r1(fp[0]) : null)
    assert.equal(p.savant.points_pct, fp ? fp[1] ?? null : null, `${p.name} points percentile`)
    assert.equal(p.savant.opportunity, xf ? r1(xf[0] + adj) : null, `${p.name} opportunity`)
    assert.equal(p.savant.opportunity_pct, xf ? xf[1] ?? null : null)
    const tdPts = td ? (td[0] * (row.pos === 'QB' ? 4 : 6)) / g : null
    assert.equal(p.savant.td_luck, tdPts == null ? null : r1(tdPts), `${p.name} TD luck`)
    assert.equal(p.savant.efficiency, oe && tdPts != null ? r1(oe[0] - tdPts) : null, `${p.name} efficiency`)
    // the split adds up: efficiency + TD luck = over expected (to rounding)
    if (oe && tdPts != null) assert.ok(Math.abs(p.savant.efficiency + p.savant.td_luck - r1(oe[0])) <= 0.11)
    assert.equal(p.savant.games, g)
    n++
  }
  return n
}

test('every number on every player is Football Savant\'s, in the league\'s scoring', async () => {
  const ppr = await ask({ platform: 'espn', code: '1000001' })
  assert.ok(holdsNumbers(ppr, { rec: 1, te: 0 }) > 100)
  const half = await ask({ platform: 'espn', code: '1000002' })
  assert.ok(holdsNumbers(half, { rec: 0.5, te: 0.5 }) > 100)
  assert.ok(half.notes.some((n) => /0\.5 a catch, plus 0\.5 for a tight end/.test(n)))
  // a receiver loses half a point a catch; a tight end in a TE-premium league does not
  const wr = all(half).find((p) => p.savant && p.pos === 'WR' && rowById.get(p.savant.id).d.rec > 10)
  assert.ok(wr.savant.points < wr.savant.points_ppr)
  const te = all(half).find((p) => p.savant && p.pos === 'TE' && rowById.get(p.savant.id).d.rec > 5)
  assert.equal(te.savant.points, te.savant.points_ppr)
  // a team's starters add up
  for (const t of half.teams) {
    const s = t.players.filter((p) => p.slot === 'start' && p.savant && p.savant.points != null)
    if (s.length) assert.equal(t.starter_points, r1(s.reduce((a, p) => a + p.savant.points, 0)))
  }
  // Sleeper's 6-point passing touchdowns are said, not silently mixed in
  const sl = await ask({ platform: 'sleeper', code: SL_LEAGUE })
  assert.ok(holdsNumbers(sl, { rec: 1, te: 0 }) > 80)
  assert.ok(sl.notes.some((n) => /6 points a passing touchdown/.test(n)))
  const mf = await ask({ platform: 'mfl', code: '90001', season: '2026' })
  assert.ok(holdsNumbers(mf, { rec: 1, te: 0 }) > 100)
})

// ---- 4. the right player ----------------------------------------------------------------------

test('players are placed by id first, by an unambiguous name at their position otherwise', async () => {
  for (const [platform, code] of [['espn', '1000001'], ['sleeper', SL_LEAGUE], ['mfl', '90001']]) {
    const out = await ask({ platform, code, season: '2026' })
    assert.ok(out.matched / out.fantasy_players > 0.9, `${platform}: ${out.matched} of ${out.fantasy_players}`)
    for (const p of all(out).filter((x) => x.savant)) {
      const row = rowById.get(p.savant.id)
      assert.equal(row.pos, p.pos === 'K' ? 'K' : row.pos)
      // by id: the table's (or, for Sleeper, its own list's) gsis for that platform id
      if (p.savant.matched_by === 'id' && ids[platform][p.pid]) assert.equal(p.savant.id, ids[platform][p.pid], `${platform} ${p.name} by id`)
      else assert.equal(row.name.toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, ''), p.name.toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, ''), `${platform} ${p.name} by name`)
    }
    // most are placed by id where the table knows the player
    const byId = all(out).filter((x) => x.savant && x.savant.matched_by === 'id').length
    assert.ok(byId / out.matched > 0.8, `${platform}: ${byId} of ${out.matched} by id`)
  }
  // Fantrax is by name, and the Justin Jefferson at receiver is the Vikings receiver
  const fx1 = await ask({ platform: 'fantrax', code: 'fx1' })
  const jj = all(fx1).find((p) => p.name === 'Justin Jefferson' && p.pos === 'WR')
  assert.ok(jj && jj.savant, 'the Fantrax receiver Justin Jefferson is placed')
  assert.equal(rowById.get(jj.savant.id).name, 'Justin Jefferson')
  assert.equal(rowById.get(jj.savant.id).pos, 'WR')
  assert.equal(jj.savant.matched_by, 'name')
  assert.ok(fx1.matched >= 7, `Fantrax: ${fx1.matched} of ${fx1.fantasy_players} placed`)
  assert.ok(!all(fx1).some((p) => p.pos === 'IDP' && p.savant), 'defensive players are listed, not ranked')
  assert.ok(fx1.notes.some((n) => /Fantrax players are matched by name/.test(n)))

  // the id table itself
  for (const k of ['sleeper', 'espn', 'mfl', 'yahoo']) {
    assert.ok(Object.keys(ids[k]).length > 2000, `${k}: ${Object.keys(ids[k]).length}`)
    assert.ok(Object.values(ids[k]).every((g) => /^00-\d{7}$/.test(g)))
  }
})

test('one team in full; the rest summed; a team that is not there is said', async () => {
  const out = await ask({ platform: 'espn', code: '1000001', team: 'ESPN Team 3' })
  const text = (await keyed.callTool({ name: 'nfl_league', arguments: { platform: 'espn', code: '1000001', team: 'ESPN Team 3' } })).content[0].text
  const t3 = out.teams.find((t) => t.name === 'ESPN Team 3')
  for (const p of t3.players) assert.ok(text.includes(p.name), `${p.name} is in the text`)
  assert.match(text, /Other teams: /)
  const none = await ask({ platform: 'espn', code: '1000001', team: 'No Such Team' })
  assert.ok(none.notes.some((n) => /No team "No Such Team"/.test(n)))
})

// ---- 5. who sees it ---------------------------------------------------------------------------

test('only a real key lists nfl_league, and it is marked as reading the outside world', async () => {
  const names = async (state) => { const c = await clientFor(state); try { return (await c.listTools()).tools } finally { await c.close() } }
  for (const state of [{ state: 'none' }, { state: 'unknown' }, { state: 'unchecked' }]) assert.ok(!(await names(state)).some((t) => t.name === 'nfl_league'), state.state)
  const t = (await names({ state: 'valid', id: 'abcdef012345' })).find((x) => x.name === 'nfl_league')
  assert.ok(t)
  assert.equal(t.annotations.readOnlyHint, true)
  assert.equal(t.annotations.openWorldHint, true)
  assert.ok(mcp.PRO_TOOLS.includes('nfl_league'))
  const size = JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length
  assert.ok(size < 2500, `nfl_league adds ${size} characters up front`)
  assert.match(mcp.instructionsFor('valid'), /nfl_league/)
})
