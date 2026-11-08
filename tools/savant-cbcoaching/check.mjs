// Check for College Basketball Coaching Savant: the files pipeline/college/coaching/build.py writes under
// public/cbcs/, the page that draws them, and the connector section (api/_cbcoaching.js) that quotes them.
//
//   node --test tools/savant-cbcoaching/check.mjs        (npm run check:savant-cbcoaching)
//
// What it holds (spec §7 and §8 step 11):
//   1. the files are whole: the index, a page for every coach it lists, a team-season file for every
//      season row with a Rotation Map, the Data Room tables and the dictionary
//   2. the numbers are the page's: every stat is in the registry, percentiles sit in 1..99 and name a
//      pool, Leaders rows point at coaches with pages, the tree's mentors are coaches
//   3. the game rules: one head coach per team-game; team minutes in the stints = 200 + 25 per overtime;
//      team timeouts within the most any game allows (6 + 1 per overtime), in games where ESPN logged TV timeouts; challenges only from 2025-26,
//      at most two a game and a second only after a first that won
//   4. no CollegeBasketballData row is published raw (recruit ratings, portal rows, birthdates)
//   5. the connector answers every tool through a real MCP client against these very files (served
//      from a local HTTP server, .json answered from .json.gz), and its numbers are the files' and the
//      page's own math: career and season stats, Leaders, the tree, the similarity scores, the Data Room
//   6. the page's script parses and ends by starting itself; College Savant's page links back
//
// No network, no keys.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CB = path.join(ROOT, 'public', 'cbcs')
const readGz = (p) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'))
const J = (rel) => readGz(path.join(CB, rel + '.gz'))

const index = J('index.json')
const stats = new Map(index.stats.map((s) => [s.key, s]))
const pages = Object.fromEntries(index.coaches.map((c) => [c.id, J(`c/${c.id}.json`)]))
const seasons = index.meta.seasons
const table = (t, s) => { const p = path.join(CB, 'data', t, `${s}.json.gz`); return existsSync(p) ? readGz(p) : null }

// ESPN's mislabelled challenge results: 11 of 158 second challenges in 2025-26 follow a first that,
// read from the parenthetical, failed (Rule 11-4.1.d allows a second only after a win).
const NOISE_SECOND_AFTER_LOSS = 11 / 158
// P(X >= k) for X ~ Binomial(n, p): the chance the noise alone gives k or more.
export function binomTail(k, n, p) {
  if (k <= 0) return 1
  let term = (1 - p) ** n, tail = 0                     // P(X = 0), then each next term from the last
  for (let i = 0; i <= n; i++) { if (i >= k) tail += term; term *= ((n - i) / (i + 1)) * (p / (1 - p)) }
  return Math.min(1, tail)                              // summed upward: exact in the small tail
}

// ---- 1 + 2 ------------------------------------------------------------------------------
test('the index lists every coach once and every coach has a page', () => {
  const ids = index.coaches.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'a coach is listed twice')
  for (const id of ids) assert.ok(pages[id], `no page for ${id}`)
  assert.ok(index.coaches.filter((c) => c.hc).length > 2000, 'the index should hold every D1 head coach on record')
  assert.ok(index.meta.rules.career_pool >= 150, `the career pool is suspiciously small (${index.meta.rules.career_pool})`)
  for (const k of ['roster', 'parts', 'development', 'fit', 'resources']) assert.ok(index.meta.fits[k], `the ${k} fit is missing from meta`)
  assert.equal(index.meta.fits.roster.headline, true, 'the roster model is the headline only if it beat both baselines')
  assert.ok(index.meta.fits.roster.vs_last.ours_rmse < index.meta.fits.roster.vs_last.baseline_rmse)
  assert.ok(index.meta.fits.roster.vs_ap.ours_rmse < index.meta.fits.roster.vs_ap.baseline_rmse)
  assert.ok(Math.abs(index.meta.fits.development.check.weighted_mean_residual) < 0.05, 'development residuals do not sum to about zero')
})

test('every stat is in the registry, every percentile sits in 1..99 and names a pool', () => {
  let n = 0
  for (const [id, p] of Object.entries(pages)) {
    for (const [key, v] of Object.entries(p.career.stats)) {
      assert.ok(stats.get(key), `${id}: career stat ${key} is not in the registry`)
      if (v.pct != null) { assert.ok(v.pct >= 1 && v.pct <= 99, `${id} ${key}: ${v.pct}`); assert.ok(v.pool >= 2, `${id} ${key}: no pool`) }
      n++
    }
    if (!p.career.eligible) assert.ok(Object.values(p.career.stats).every((v) => v.pct == null), `${id}: ranked without being eligible`)
    for (const s of p.seasons) {
      for (const k of Object.keys(s.values)) assert.ok(stats.get(k), `${id} ${s.season}: ${k} not in the registry`)
      const pools = s.ranked ? index.league[s.season]?.pools || {} : s.live_pools || {}
      for (const [k, pct] of Object.entries(s.ranked ? s.pct : s.live_pct || {})) { assert.ok(pct >= 1 && pct <= 99, `${id} ${s.season} ${k}: ${pct}`); assert.ok(pools[k] >= 2, `${id} ${s.season} ${k}: no pool`) }
      if (!s.ranked) assert.equal(Object.keys(s.pct || {}).length, 0, `${id} ${s.season}: ranked under the line`)
    }
  }
  assert.ok(n > 10000, `only ${n} career stats`)
  for (const s of index.stats) for (const f of ['what', 'formula', 'source', 'sample', 'first']) assert.ok(s[f], `${s.key}: no ${f}`)
})

test('Leaders rows point at coaches with pages; every board names its pool; the tree is made of coaches', () => {
  for (const b of index.leaders) {
    assert.ok(b.pool && b.pool.length > 10, `${b.id}: pool`)
    for (const r of b.rows) if (r.id) assert.ok(pages[r.id], `${b.id}: ${r.name} has no page`)
  }
  for (const [id, n] of Object.entries(index.tree.nodes)) {
    if (n.mentor) assert.ok(index.tree.nodes[n.mentor], `${id}: mentor ${n.mentor} is not a node`)
    for (const k of n.kids) assert.equal(index.tree.nodes[k]?.mentor, id, `${id}: kid ${k} does not name him`)
  }
})

test('a team-season file for every season row with a Rotation Map; Data Room tables for every season', () => {
  for (const [id, p] of Object.entries(pages)) for (const s of p.seasons) if (s.rotation) {
    const f = path.join(CB, 't', `${s.team}-${s.season}.json.gz`)
    assert.ok(existsSync(f), `${id} ${s.season}: no team-season file`)
    const e = readGz(f).coaches.find((x) => x.coach === id)
    assert.ok(e && e.rotation, `${id} ${s.season}: not in its team-season file`)
    for (const r of e.rotation.rows) { assert.equal(r.played.length, 40); assert.ok(r.played.every((v) => v >= 0 && v <= 100)); for (const [a, b] of r.windows) for (let m = a; m <= b; m++) assert.ok(r.played[m] >= 60, `${id} ${s.season} ${r.name}: window minute ${m} at ${r.played[m]}`) }
  }
  for (const s of seasons.filter((x) => x >= '2013-14')) for (const t of ['games', 'decisions', 'roster_moves']) assert.ok(table(t, s), `no ${t} table for ${s}`)
  for (const s of seasons.filter((x) => x >= '2023-24')) for (const t of ['stints', 'units', 'rotation']) assert.ok(table(t, s), `no ${t} table for ${s}`)
  const d = J('data/dictionary.json')
  for (const t of ['games', 'decisions', 'stints', 'units', 'rotation', 'roster_moves', 'programs']) assert.ok(d.tables[t]?.cols?.length, `the dictionary lacks ${t}`)
  for (const s of seasons.filter((x) => x >= '2013-14')) { const g = table('games', s); assert.deepEqual(g.cols, d.tables.games.cols, `${s}: games columns differ from the dictionary`) }
})

// ---- 3. the rules --------------------------------------------------------------------------
test('one head coach per team-game', () => {
  for (const s of seasons.filter((x) => x >= '2013-14')) {
    const g = table('games', s), I = (k) => g.cols.indexOf(k)
    const seen = new Set()
    for (const r of g.rows) {
      const k = r[I('gid')] + '|' + r[I('team')]
      assert.ok(!seen.has(k), `${s}: team-game ${k} has two rows`)
      seen.add(k)
      assert.ok(r[I('coach')], `${s}: ${k} has no head coach`)
    }
  }
})

test('team minutes in the stints are 200 a game plus 25 per overtime', () => {
  for (const s of seasons.filter((x) => x >= '2023-24')) {
    const st = table('stints', s), g = table('games', s)
    const ot = new Map(g.rows.map((r) => [r[g.cols.indexOf('gid')], r[g.cols.indexOf('ot')]]))
    const I = (k) => st.cols.indexOf(k)
    const sec = new Map()
    for (const r of st.rows) { const k = r[I('gid')] + '|' + r[I('team')]; sec.set(k, (sec.get(k) || 0) + (r[I('start')] - r[I('end')]) * r[I('five')].length) }
    let ok = 0
    for (const [k, v] of sec) { const want = 200 + 25 * (ot.get(k.split('|')[0]) || 0); ok += Math.abs(v / 60 - want) <= 1 }
    assert.ok(ok / sec.size >= 0.995, `${s}: ${(100 * ok / sec.size).toFixed(2)}% of team-games add to 200 + 25 per OT`)
  }
})

test('timeouts and challenges sit inside each season\'s rules', () => {
  for (const s of seasons.filter((x) => x >= '2013-14')) {
    const d = table('decisions', s), g = table('games', s), I = (k) => d.cols.indexOf(k)
    const ot = new Map(g.rows.map((r) => [r[g.cols.indexOf('gid')], r[g.cols.indexOf('ot')]]))
    const to = new Map(), ch = new Map()
    for (const r of d.rows) {
      const k = r[I('gid')] + '|' + r[I('team')]
      if (String(r[I('kind')]).startsWith('timeout') && r[I('tv_logged')] === 1) to.set(k, (to.get(k) || 0) + 1)
      else if (r[I('kind')] === 'challenge') { (ch.get(k) || ch.set(k, []).get(k)).push(r) }
    }
    let over = 0
    for (const [k, n] of to) over += n > 6 + (ot.get(k.split('|')[0]) || 0)
    // games where ESPN logged the TV timeouts separately (the stats use only these); measured Nov 6 2026:
    // 16 of 9,048 team-games over in 2013-14, 5 a season after, none from 2021-22
    assert.ok(over / Math.max(1, to.size) <= 0.002, `${s}: ${over} of ${to.size} team-games over the most timeouts any game allows (6 + 1 per OT)`)
    if (s < '2025-26') assert.equal(ch.size, 0, `${s}: challenges before the men's challenge existed`)
    let pairs = 0, after_loss = 0
    for (const [k, rows] of ch) {
      assert.ok(rows.length <= 2, `${s} ${k}: ${rows.length} challenges`)
      if (rows.length === 2) { pairs++; after_loss += rows[0][I('challenge_won')] !== 1 }
    }
    // A second challenge is allowed only after a first that won (Rule 11-4.1.d). Read from the
    // parenthetical, 11 of 158 pairs in 2025-26 still break it on every signal ESPN gives: feed noise,
    // listed in the build notes. So the test is whether a season's count is more than that noise can
    // explain: one-sided binomial at ESPN's measured rate, 11/158, failing below p = 0.01. A fixed bound
    // did not hold up: "no more than 2 below 30 pairs" failed 2026-27 at 3 of 11 (p = 0.036 at that rate,
    // nothing wrong), and "8% from 30 pairs" passes or fails a few pairs either side of the same noise.
    // The reading this guards against, the timeout clause, broke it 41 of 158 times (p = 1e-13).
    const p = binomTail(after_loss, pairs, NOISE_SECOND_AFTER_LOSS)
    assert.ok(p >= 0.01, `${s}: ${after_loss} of ${pairs} second challenges follow a failed first; ESPN's noise (${(100 * NOISE_SECOND_AFTER_LOSS).toFixed(1)}%) explains that with p = ${p.toPrecision(2)} (fails below 0.01)`)
  }
})

// ---- 4. nothing from CBBD raw ------------------------------------------------------------
test('against the spread: covers and losses fit inside the games with a line, and the page\'s ATS rate agrees', () => {
  // Nov 2026: `covered` was the roster model's places filled (out of 5), published beside spread_g, and
  // read as covers (Jon Scheyer 2026-27: covered 5, spread_g 2). It is now covers; the roster figure is roster_places.
  let n = 0
  for (const [id, p] of Object.entries(pages)) {
    for (const sr of p.seasons || []) {
      const x = sr.exp
      if (!x || x.spread_g == null) continue
      const tag = `${id} ${sr.season} ${sr.team}`
      n++
      for (const k of ['covered', 'ats_l']) assert.ok(Number.isInteger(x[k]) && x[k] >= 0, `${tag}: ${k} ${x[k]}`)
      assert.ok(x.covered <= x.spread_g, `${tag}: covered ${x.covered} > spread_g ${x.spread_g}`)
      assert.ok(x.covered + x.ats_l <= x.spread_g, `${tag}: ${x.covered}-${x.ats_l} against the spread in ${x.spread_g} games with a line`)
      if (x.roster_places != null) assert.ok(x.roster_places >= 0 && x.roster_places <= 5, `${tag}: roster_places ${x.roster_places}`)
      // the page's ATS stat counts this coach's games without pushes: never more than the team's decided ones,
      // and the same rate when he coached all of them
      const a = sr.values?.ats
      if (a && a[1] != null) {
        const decided = x.covered + x.ats_l
        assert.ok(a[1] <= decided, `${tag}: ATS stat on ${a[1]} games, team decided ${decided}`)
        if (a[1] === decided && decided) assert.ok(Math.abs(a[0] - 100 * x.covered / decided) < 0.15, `${tag}: ATS ${a[0]} vs ${x.covered}/${decided}`)
      }
    }
  }
  assert.ok(n > 1000, `only ${n} coach-seasons with a line`)
})

test('no CollegeBasketballData row is published raw', () => {
  const banned = /"(committedTo|athleteId|heightInches|weightPounds|dateOfBirth|sourceId|yearsRemaining|eligibility|rrating|rating)"\s*:/
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.gz')) { const s = gunzipSync(readFileSync(p)).toString('utf8'); assert.ok(!banned.test(s), `${path.relative(CB, p)} carries a CBBD field`) } } }
  walk(CB)
})

// ---- 5. the connector --------------------------------------------------------------------
let server, client, mod
before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const f = path.join(ROOT, 'public', url)
    const p = existsSync(f) ? f : existsSync(f + '.gz') ? f + '.gz' : null
    if (!p) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('content-type', 'application/json'); res.end(p.endsWith('.gz') ? gunzipSync(readFileSync(p)) : readFileSync(p))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  mod = await import('../../api/_cbcoaching.js')
  const srv = new McpServer({ name: 't', version: '0' })
  for (const t of mod.tools) srv.registerTool(t.name, t.config, async (a) => { try { const { text, structured } = await t.run(a); return { content: [{ type: 'text', text }], structuredContent: structured } } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await srv.connect(a)
  client = new Client({ name: 'check', version: '0' })
  await client.connect(b)
})
after(async () => { await client?.close(); server?.close() })
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { ...r, text: r.content.map((c) => c.text).join('\n') } }

test('the seven tools are declared and listed', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['cbb_coaching_data', 'cbb_coaching_dictionary', 'cbb_coaching_fit', 'cbb_coaching_leaders', 'cbb_coaching_tree', 'cbb_get_coach_profile', 'cbb_search_coaches'])
  for (const t of mod.tools) assert.ok(t.config.description.length <= 700, `${t.name}: description over 700 characters`)
})

test('search finds coaches by name and by id, and says so when it finds nobody', async () => {
  const top = index.coaches.filter((c) => c.eligible).slice(0, 25)
  for (const c of top) {
    const r = await call('cbb_search_coaches', { query: c.name })
    assert.ok(!r.isError && r.structuredContent.coaches.some((x) => x.id === c.id), `${c.name}: ${r.text.slice(0, 200)}`)
  }
  const r = await call('cbb_search_coaches', { query: 'zzqxv' })
  assert.ok(!r.isError && r.structuredContent.count === 0)
})

test('the profile quotes the page: career stats and the current season\'s, value for value and percentile for percentile', async () => {
  const sample = index.coaches.filter((c) => c.eligible).slice(0, 40).concat(index.coaches.filter((c) => c.active && !c.eligible).slice(0, 10))
  for (const c of sample) {
    const p = pages[c.id]
    const r = await call('cbb_get_coach_profile', { coach: c.id })
    assert.ok(!r.isError, `${c.id}: ${r.text.slice(0, 300)}`)
    const S = r.structuredContent
    if (p.career.eligible) for (const row of S.career_stats) { const v = p.career.stats[row.key]; assert.equal(row.value, v.v, `${c.id} ${row.key}`); assert.equal(row.percentile, v.pct ?? null, `${c.id} ${row.key} pct`); assert.equal(row.pool_size, v.pool ?? null) }
    const sr = p.seasons.find((x) => x.season === index.meta.current) || p.seasons[p.seasons.length - 1]
    if (sr && S.season) {
      assert.equal(S.season.season, sr.season)
      const x = S.season.expectation
      if (x?.spread_g != null) assert.ok(x.covered <= x.spread_g && x.covered + x.ats_l <= x.spread_g, `${c.id} ${sr.season}: connector says ${x.covered}-${x.ats_l} in ${x.spread_g} with a line`)
      const pct = sr.ranked ? sr.pct : sr.live_pct || {}
      for (const g of ['rotation', 'game_management', 'identity', 'development', 'roster_building', 'tournament', 'resources', 'context']) for (const row of S[g]?.stats || []) { assert.equal(row.value, sr.values[row.key][0], `${c.id} ${sr.season} ${row.key}`); assert.equal(row.percentile, pct[row.key] ?? null, `${c.id} ${sr.season} ${row.key} pct`) }
    }
  }
})

test('Leaders and the tree are the index\'s own', async () => {
  const r = await call('cbb_coaching_leaders', { board: 'all', limit: 10 })
  assert.ok(!r.isError)
  for (const b of r.structuredContent.boards) { const ib = index.leaders.find((x) => x.id === b.id); b.rows.forEach((row, i) => { assert.equal(row.name, ib.rows[i].name); assert.equal(row.display, ib.rows[i].display) }) }
  const withKids = Object.entries(index.tree.nodes).filter(([, n]) => n.kids.length).slice(0, 10)
  for (const [id, n] of withKids) { const t = await call('cbb_coaching_tree', { coach: id, depth: 1 }); assert.ok(!t.isError); assert.deepEqual(t.structuredContent.branch.map((b) => b.id).sort(), [...n.kids].sort()) }
})

test('similar players: the connector\'s scores are the page\'s and College Savant\'s cards\'', async () => {
  const F = J('fit.json'), PF = J('player-fits.json')
  assert.ok(['fit score', 'similar players under him'].includes(F.label))
  assert.equal(F.label, index.meta.fits.fit.ships_as)
  let n = 0
  for (const [cid, p] of Object.entries(pages)) {
    if (!p.fits?.rows?.length || n >= 8) continue
    n++
    const r = await call('cbb_coaching_fit', { coach: cid, limit: 10 })
    assert.ok(!r.isError, r.text)
    r.structuredContent.players.forEach((x, i) => { assert.equal(x.id, p.fits.rows[i].eid); assert.equal(x.match, p.fits.rows[i].match) })
    for (const row of p.fits.rows.slice(0, 3)) {
      const P = F.players[row.eid], sys = F.systems[cid][P[0]]
      assert.equal(mod.fitScore(mod.fitDistance(P[3], sys[0]), F.scale), row.match, `${cid} ${row.eid}: the connector's math differs from the build's`)
    }
  }
  assert.ok(n >= 5, 'too few current coaches with similar players')
  const eids = Object.keys(PF.rows).slice(0, 15)
  for (const e of eids) {
    const r = await call('cbb_coaching_fit', { player: e, limit: 5 })
    assert.ok(!r.isError, r.text)
    assert.deepEqual(r.structuredContent.coaches.map((c) => [c.id, c.match]), PF.rows[e], `${e}: the connector's coaches differ from the card's`)
  }
})

test('the Data Room hands back the file\'s rows, filtered and paged', async () => {
  const s = '2025-26', g = table('games', s)
  const r = await call('cbb_coaching_data', { table: 'games', season: s, filters: [{ column: 'team', op: 'eq', value: '150' }], limit: 500 })
  assert.ok(!r.isError, r.text)
  const want = g.rows.filter((x) => x[g.cols.indexOf('team')] === '150')
  assert.equal(r.structuredContent.total_matching, want.length)
  assert.deepEqual(r.structuredContent.rows, want.slice(0, 500))
  const d = await call('cbb_coaching_dictionary', {})
  assert.ok(!d.isError && d.structuredContent.stats.length === index.stats.length)
  const bad = await call('cbb_coaching_data', { table: 'stints', season: '2015-16' })
  assert.ok(bad.isError && /2023-24/.test(bad.text), 'a season without lineups should say when they begin')
})

// ---- 6. the pages ----------------------------------------------------------------------------
test('the page parses, reads /cbcs and starts itself; College Savant links back', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'college-basketball-coaching-savant.html'), 'utf8')
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(js))
  assert.ok(/const BASE = '\/cbcs';/.test(js))
  assert.ok(/init\(\);\s*$/.test(js.trim() + '\n'))
  const cbb = readFileSync(path.join(ROOT, 'public', 'college-basketball-savant.html'), 'utf8')
  assert.ok(cbb.includes('/college-basketball-coaching-savant.html'), 'College Savant does not link to the coaching page')
  assert.ok(cbb.includes("loadCB('player-fits.json')") && cbb.includes("loadCB('links.json')"))
})
