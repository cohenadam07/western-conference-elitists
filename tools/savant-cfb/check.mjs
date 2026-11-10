// College Football Savant: the published files, the page and the connector, held to each other.
//
//   node --test tools/savant-cfb/check.mjs        (npm run check:savant-cfb; in check:savant)
//
//  1. the registry: every stat has its label, group, verdict, unit, explainer, source and start season
//  2. the files: every season has its files and a file per team; arrays line up; nothing over 15 MB
//  3. nothing that must not be served is in them: a CFBD row, a recruit's composite rating, an AP
//     pick, FPI, PPA, a committee ranking
//  4. pools: at least the floor or widened and labelled; percentiles 1 to 99; "not tracked" is never a value
//  5. Savant value is (rate - replacement) x volume from the stored parts
//  6. All-Savant: the AP shape, nobody twice, the pre-2024 defensive warning where it applies
//  7. the playoff field obeys every rule in every season; today's odds add up
//  8. the page: parses, names pools, respects reduced motion, carries version, credit and connector link
//  9. the connector: every value equals the page's math (public/savant-cfb.js); every answer names its
//     pool, its data date and a link; defenders before 2024 carry the warning; every tool answers
// 10. the refresh workflow keeps raw ESPN off GitHub (Adam, Nov 10 2026)

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import '../../public/savant-cfb.js'

const M = globalThis.SavantCFB, C = M.COL
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CFB = path.join(ROOT, 'public', 'cfb')
const raw = (p) => gunzipSync(readFileSync(path.join(CFB, p + '.gz'))).toString('utf8')
const read = (p) => JSON.parse(raw(p))
const reg = read('registry.json')
const idx = read('index.json')
const byKey = Object.fromEntries(reg.stats.map((s) => [s.key, s]))
const SEASONS = idx.seasons.map((s) => s.season).sort()
const SAMPLE = [SEASONS[0], 2019, 2022, 2024, idx.current].filter((s, i, a) => SEASONS.includes(s) && a.indexOf(s) === i)
const P4 = new Set(reg.power4)
const G6 = new Set(['American Athletic', 'Conference USA', 'Mid-American', 'Mountain West', 'Sun Belt', 'Pac-12'])

test('the registry explains every stat', () => {
  assert.match(reg.version, /^\d+\.\d+\.\d+$/)
  assert.ok(reg.stats.length >= 80)
  for (const s of reg.stats) {
    for (const k of ['label', 'group', 'verdict', 'unit', 'what', 'formula', 'source', 'start']) assert.ok(s[k] !== undefined && s[k] !== '', `${s.key}.${k}`)
    assert.ok(['full', 'hatched', 'context'].includes(s.verdict), s.key)
    assert.ok(reg.groups.includes(s.group), s.key)
    assert.ok(s.slots.every((x) => reg.slots.includes(x)), s.key)
    assert.ok(s.k > 0 && s.sample, `${s.key}: settle point`)
  }
  for (const s of reg.team_stats) assert.ok(s.label && s.what && ['full', 'hatched', 'context', 'luck'].includes(s.verdict), s.key)
  // BUILD decision 3: every RB rate is hatched; receiver per-target stats, interception rate, forced fumbles and kicking are CONTEXT
  for (const s of reg.stats.filter((x) => x.slots.includes('RB') && x.group === 'Rushing')) assert.equal(s.verdict, 'hatched', s.key)
  for (const k of ['wr_epa_tgt', 'wr_catch', 'te_epa_tgt', 'te_catch', 'qb_int_rate', 'dl_ff', 'lb_ff', 'db_ff', 'k_fgoe', 'k_fg_pct']) assert.equal(byKey[k].verdict, 'context', k)
  for (const k of ['giveaways', 'takeaways', 'to_margin', 'fum_rec']) assert.equal(reg.team_stats.find((s) => s.key === k).verdict, 'luck', k)
})

test('every season has its files, a file per team, and arrays that line up', () => {
  assert.deepEqual(SEASONS, Array.from({ length: idx.current - idx.first_season + 1 }, (_, i) => idx.first_season + i))
  for (const s of SEASONS) {
    const d = read(`s/${s}.json`), T = read(`teams/${s}.json`)
    for (const f of ['allsavant', 'playoff', 'games']) assert.ok(existsSync(path.join(CFB, f, `${s}.json.gz`)), `${f}/${s}`)
    assert.equal(d.season, s)
    assert.ok(d.players.length > 3500, `${s}: ${d.players.length} players`)
    const n = d.players.length
    for (const [k, c] of Object.entries(d.values)) for (const tag of ['r', 'a', 'rg', 'ag']) if (c[tag]) assert.ok(c['o' + tag] >= 0 && c['o' + tag] + c[tag].length <= n, `${s} ${k}.${tag}`)
    for (const [k, c] of Object.entries(d.samples)) assert.ok(c.o + c.v.length <= n, `${s} sample ${k}`)
    for (const k of ['v', 'rate', 'n', 'ret']) assert.equal(d.value[k].length, n, `${s} value.${k}`)
    for (const row of T.teams) assert.ok(existsSync(path.join(CFB, 't', String(s), `${row[0]}.json.gz`)), `t/${s}/${row[0]}`)
    assert.equal(Object.keys(d.teams).length, T.teams.length)
    for (const p of d.players) assert.ok(reg.slots.includes(p[C.slot]) && typeof p[C.name] === 'string' && p[C.name].trim() && p[C.id] > 0, `${s}: ${p}`)
  }
})

test('no file is over 15 MB and none carries a NaN', () => {
  let n = 0
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else { n++; assert.ok(statSync(p).size < 15e6, p) } } }
  walk(CFB)
  assert.ok(n > 1800, `${n} files`)
  for (const f of ['s/2019.json', `s/${idx.current}.json`, 'p/07.json', `teams/${idx.current}.json`, `playoff/${idx.current}.json`]) assert.doesNotMatch(raw(f), /\bNaN\b|\bInfinity\b/, f)
})

test('nothing that must not be served is in the files', () => {
  const banned = /"(fpi|ppa|predicted_points_added|committee_rank|cfp_rank|ap_rank|ap_team|ap_first|composite_rating|recruit_rating|rating_247|on3|espn_rating|athleteId|committedTo|stateProvince)"/i
  for (const f of ['registry.json', 'index.json', 'search.json', 'honours.json', `s/${idx.current}.json`, 's/2020.json', `teams/${idx.current}.json`, 'teams/2018.json', `playoff/${idx.current}.json`, 'playoff/2021.json', `allsavant/${idx.current}.json`, 'p/00.json', 'p/42.json', `games/${idx.current}.json`]) assert.doesNotMatch(raw(f), banned, f)
  for (const sh of ['p/00.json', 'p/37.json', 'p/99.json']) {
    for (const [id, o] of Object.entries(read(sh))) {
      const r = o.bio.recruit                      // stars, national class rank, class year: never the composite rating itself
      if (r) { assert.equal(r.length, 3, id); assert.ok(Number.isInteger(r[0]) && r[0] >= 1 && r[0] <= 5 && (r[1] === null || Number.isInteger(r[1])) && r[2] >= 2009, `${id}: ${r}`) }
    }
  }
  const P = read(`playoff/${idx.current}.json`)
  assert.doesNotMatch(JSON.stringify(P).toLowerCase(), /committee/)
})

test('pools hold the floor or widen and say so; percentiles stay within 1 to 99', () => {
  let rows = 0
  for (const s of SAMPLE) {
    const d = read(`s/${s}.json`)
    const pick = d.players.map((p, i) => i).filter((i) => i % 97 === 0)
    for (const i of pick) for (const name of ['pos', 'p4', 'conf']) {
      const pl = M.pool(d, reg, i, name)
      assert.ok(pl.ids.length >= reg.min_pool || pl.widened, `${s} ${d.players[i][C.name]} ${name}: ${pl.ids.length} players, not widened`)
      for (const st of M.statsFor(reg, d.players[i][C.slot])) {
        const r = M.row(d, reg, st, i, { poolName: name })
        if (!r.tracked) { assert.match(r.reason, /^not tracked (before|in) \d{4}$/); assert.equal(r.value, undefined); continue }
        if (r.none) continue
        assert.ok(r.pct >= 1 && r.pct <= 99, `${s} ${st.key}: ${r.pct}`)
        if (r.settling) assert.ok(r.likelyPct >= 1 && r.likelyPct <= 99 && r.hatched)
        rows++
      }
    }
  }
  assert.ok(rows > 2500, `${rows} rows`)
})

test('"not tracked" is kept apart from zero', () => {
  const d19 = read('s/2019.json'), d22 = read('s/2022.json'), d25 = read('s/2025.json')
  assert.ok(!d19.values.qb_cpoe || !d19.values.qb_cpoe.r, 'completion % over expected has values before 2025')
  assert.ok(d25.values.qb_cpoe.r.some((v) => v !== null))
  for (const k of ['db_pd', 'lb_pd', 'dl_disrupt']) assert.ok(!d22.values[k] || !d22.values[k].r, `${k} has values in 2022`)
  for (const k of ['dl_hur', 'lb_tkl']) assert.ok(!d19.values[k] || !d19.values[k].r, `${k} has values in 2019`)
  const qb = d19.players.findIndex((p) => p[C.slot] === 'QB' && p[C.qual])
  assert.deepEqual(M.row(d19, reg, byKey.qb_cpoe, qb, {}).reason, 'not tracked before 2025')
  const cb = d22.players.findIndex((p) => p[C.slot] === 'CB' && p[C.qual])
  assert.deepEqual(M.row(d22, reg, byKey.db_pd, cb, {}).reason, 'not tracked in 2022')
})

test('Savant value is (rate - replacement) x volume', () => {
  let n = 0
  for (const s of SAMPLE) {
    const d = read(`s/${s}.json`)
    d.players.forEach((p, i) => {
      if (!p[C.qual] || i % 23) return
      const l = M.valueLine(d, i)
      if (!l || l.replacement === null) return
      assert.ok(Math.abs(M.recompute(l) - l.value) < 0.06 + 0.002 * Math.abs(l.volume) * 0.01, `${s} ${p[C.name]}: ${M.recompute(l)} vs ${l.value}`)
      assert.ok(l.rank >= 1 && l.rank <= l.of)
      n++
    })
  }
  assert.ok(n > 500, `${n} values`)
})

const SHAPE = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 1, K: 1, AP: 1, EDGE: 2, IDL: 2, LB: 3, CB: 2, S: 2, DB: 1, P: 1 }
test('All-Savant: the AP shape, nobody twice, the warning before 2024', () => {
  for (const s of SEASONS) {
    const A = read(`allsavant/${s}.json`), d = read(`s/${s}.json`)
    const seen = new Set()
    for (const t of ['1', '2', '3']) {
      const count = {}
      for (const r of A.national[t]) { count[r.slot] = (count[r.slot] || 0) + 1; if (r.pid) { assert.ok(!seen.has(r.pid), `${s}: ${r.name} twice`); seen.add(r.pid) } }
      assert.deepEqual(count, SHAPE, `${s} team ${t}`)
    }
    assert.equal(A.national['1'].filter((r) => r.slot === 'OL')[0].pid, null)
    assert.ok(Object.keys(A.conference).length >= 9 && !Object.keys(A.conference).some((c) => /Independent/.test(c)), `${s} conferences`)
    for (const [c, rows] of Object.entries(A.conference)) for (const r of rows) assert.equal(d.teams[String(r.team)][2], c, `${s} ${c}: ${r.name || r.team}`)
    assert.ok(A.freshman.length >= 15 && !A.freshman.some((r) => r.slot === 'OL'))
    const best = Math.max(...d.players.map((p, i) => (p[C.qual] && M.ok(d.value.v[i]) ? d.value.v[i] : -1e9)))
    assert.equal(A.heisman[0].value, best, `${s}: the Savant Heisman is the highest Savant value`)
    assert.notEqual(A.non_qb[0].slot, 'QB')
    assert.equal(A.warning, s < 2024 ? reg.pre_box_warning : null, `${s} warning`)
    assert.equal(A.final ? A.standing : /^as of week \d+$/.test(A.standing), A.final ? null : true, `${s} standing`)
  }
})

test('the playoff field obeys every rule in every season', () => {
  for (const s of SEASONS) {
    const P = read(`playoff/${s}.json`), d = read(`s/${s}.json`)
    const conf = (t) => d.teams[String(t)][2]
    const rank = new Map(P.table.map((r) => [r[0], r[1]]))
    assert.deepEqual(P.field.map((f) => f.seed), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${s} seeds`)
    assert.equal(new Set(P.field.map((f) => f.team)).size, 12)
    const inF = new Set(P.field.map((f) => f.team))
    const power = new Set([...P4, ...(s <= 2023 ? ['Pac-12'] : [])])
    const champs = P.champions || Object.fromEntries(Object.entries(P.leaders).map(([c, L]) => [c, L.first]))
    for (const c of power) if (champs[c]) assert.ok(inF.has(champs[c]), `${s}: the ${c} champion is not in the field`)
    const g6 = P.table.filter((r) => G6.has(conf(r[0])) && !power.has(conf(r[0])))
    assert.ok(inF.has(g6[0][0]), `${s}: the best Group of Six team is not in`)
    const nd = P.table.find((r) => r[0] === 87 && /Independent/.test(conf(87)))
    if (nd) assert.equal(inF.has(87), nd[1] <= 12 || P.field.some((f) => f.team === 87 && f.how === 'at large'), `${s}: Notre Dame ranked ${nd[1]}`)
    const auto = P.field.filter((f) => f.how !== 'at large' && !/Notre Dame/.test(f.how))
    const low = auto.filter((f) => f.rank > 12)
    assert.deepEqual(P.field.slice(12 - low.length).map((f) => f.team).sort(), low.map((f) => f.team).sort(), `${s}: qualifiers from outside the top 12 go at the bottom`)
    const top = P.field.slice(0, 12 - low.length).map((f) => f.rank)
    assert.deepEqual(top, [...top].sort((a, b) => a - b), `${s}: straight seeding`)
    for (const f of P.field) assert.equal(f.rank, rank.get(f.team))
    assert.ok(!inF.has(P.first_out[0]) && P.first_out.length === 4)
    assert.equal(P.rules.length, 6)
  }
})

test('today\'s odds add up and the leaders are named', () => {
  const P = read(`playoff/${idx.current}.json`)
  if (!P.odds) return
  const sum = (k) => Object.values(P.odds).reduce((n, o) => n + o[k], 0)
  assert.ok(Math.abs(sum(0) - 12) < 0.01 && Math.abs(sum(1) - 4) < 0.01 && Math.abs(sum(2) - 4) < 0.01, `field ${sum(0)}, byes ${sum(1)}, hosts ${sum(2)}`)
  assert.equal(P.sims, 20000)
  for (const o of Object.values(P.odds)) for (const v of o) assert.ok(v >= 0 && v <= 1)
  for (const c of P4) { assert.ok(P.leaders[c] && P.leaders[c].first !== P.leaders[c].second, c); for (const h of Object.values(P.leaders[c].how)) if (h) assert.ok(h.name && typeof h.outside === 'boolean') }
  assert.ok(Math.abs(sum(3) - Object.keys(P.leaders).length) < 0.01, 'one champion per conference')
})

test('the page parses, names its pools and carries the footer every product page does', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'college-football-savant.html'), 'utf8')
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
  assert.doesNotThrow(() => new Function(js))
  for (const re of [/poolLabel/, /POOL: /, /viewport-fit=cover/, /prefers-reduced-motion:reduce/, /Ask it in Claude with the WCE connector/, /id="ver"/, /New in 1\.0\.0/, /ESPN play-by-play/, /wce-nav\.js/, /savant-cfb\.js/, /Margin never enters the résumé score/, /not tracked/, /the model\\'s view, not a verdict|The model\\'s view, not a verdict/]) assert.match(html, re)
  assert.match(html, /family=Anton/)
  assert.doesNotMatch(html, /x-dc|support\.js|Harbor State|Marcus Delane/, 'the mockups\' runtime or invented names shipped')
  assert.match(js, /No committee ranking is used anywhere on this page/)
})

// ---- the connector, against these files -----------------------------------------------
let server, client, TOOLS
before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0])
    const f = path.join(ROOT, 'public', u + '.gz')
    if (!existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(gunzipSync(readFileSync(f)))
  })
  await new Promise((r) => server.listen(0, r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  process.env.VERCEL_URL = ''
  const { tools } = await import('../../api/_cfb.js')
  TOOLS = tools
  const mcp = new McpServer({ name: 't', version: '0' })
  for (const t of tools) mcp.registerTool(t.name, t.config, async (a) => { try { const r = await t.run(a); return { content: [{ type: 'text', text: r.text }], structuredContent: r.structured } } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'c', version: '0' })
  await Promise.all([mcp.connect(a), client.connect(b)])
})
after(() => server.close())
const callRaw = (name, args = {}) => client.callTool({ name, arguments: args })
const call = async (name, args = {}) => {
  const r = await callRaw(name, args)
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`)
  // The size cap for cfb_ answers (raised for these tools with Adam's approval, Nov 10 2026: a playoff
  // answer carries a 12-team field, the leaders and the odds).
  assert.ok(r.content[0].text.length < 9000, `${name}: ${r.content[0].text.length} characters`)
  return Object.assign(r.structuredContent, { _text: r.content[0].text })
}

test('every connector value equals the page\'s math', async () => {
  let n = 0
  for (const s of SAMPLE) {
    const d = read(`s/${s}.json`)
    const q = d.players.map((p, i) => [p, i]).filter(([p]) => p[C.qual])
    for (const [p, i] of q.filter((_, k) => k % Math.ceil(q.length / 9) === 3)) {
      for (const [pool, key, adjusted, garbage_time] of [['position', 'pos', true, false], ['power_4', 'p4', true, false], ['conference', 'conf', false, true]]) {
        const a = await call('cfb_get_player_profile', { player: String(p[C.id]), season: s, pool, adjusted, garbage_time })
        assert.equal(a.player.id, p[C.id])
        assert.match(a.pool.name, /^vs /)
        assert.equal(a.stats.length, M.statsFor(reg, p[C.slot]).length)
        for (const st of a.stats) {
          const r = M.row(d, reg, byKey[st.key], i, { poolName: key, adj: adjusted, gt: garbage_time })
          assert.equal(st.percentile ?? null, r.pct ?? null, `${s} ${p[C.name]} ${st.key} ${pool}`)
          if (r.tracked && !r.none) { assert.equal(st.shown, r.shown); assert.equal(st.low_sample, r.settling) } else assert.equal(st.value, null)
          n++
        }
        const v = M.valueLine(d, i)
        assert.equal(a.savant_value.value, v.value)
        assert.equal(a.savant_value.rank, v.rank)
      }
    }
  }
  assert.ok(n > 1000, `only ${n} values compared`)
})

test('answers name the pool, the data date and a link; old defenders carry the warning', async () => {
  const d = read('s/2018.json'), cur = read(`s/${idx.current}.json`)
  const edge = d.players.find((p) => p[C.slot] === 'EDGE' && p[C.qual]), qb = cur.players.find((p) => p[C.slot] === 'QB' && p[C.qual])
  const a = await call('cfb_get_player_profile', { player: String(edge[C.id]), season: 2018 })
  assert.equal(a.warning, reg.pre_box_warning)
  assert.ok(a._text.includes(reg.pre_box_warning) && a._text.includes('college-football-savant.html#player-') && /2018 season, final/.test(a._text))
  const hur = a.stats.find((x) => x.key === 'dl_hur')
  assert.deepEqual([hur.tracked, hur.value, hur.note], [false, null, 'not tracked before 2024'])
  const b = await call('cfb_get_player_profile', { player: String(qb[C.id]) })
  assert.equal(b.warning, null)
  assert.match(b._text, /Percentiles vs FBS quarterbacks, opponent-adjusted, \d{4}, garbage time excluded \(\d+ qualified players\)/)
  assert.match(b.data_through, /^\d{4}-\d{2}-\d{2}$/)
  const lb = await call('cfb_leaderboard', { stat: 'dl_sack', season: 2018 })
  assert.equal(lb.warning, reg.pre_box_warning)
  const nt = await call('cfb_leaderboard', { stat: 'qb_cpoe', season: 2019 })
  assert.deepEqual([nt.tracked, nt.count, nt.note], [false, 0, 'not tracked before 2025'])
})

test('team answers are the page\'s numbers', async () => {
  const s = idx.current, D = read(`teams/${s}.json`)
  let n = 0
  for (const i of [0, 17, 51, 88, 120].filter((k) => k < D.teams.length)) {
    const a = await call('cfb_team_profile', { team: String(D.teams[i][0]), season: s })
    for (const st of a.stats) { const r = M.teamRow(D, reg.team_stats.find((x) => x.key === st.key), i, true); assert.equal(st.percentile, r ? r.pct : null, st.key); assert.equal(st.rank, r ? r.rank : null); n++ }
    assert.match(a.pool, /^vs all \d+ FBS teams/)
    assert.ok(a.schedule.length >= 10 && a.top_players.length > 5)
  }
  assert.ok(n > 150)
  const r = await call('cfb_team_rankings', { sort: 'power', limit: 10 })
  const top = [...D.teams].sort((a, b) => b[M.TCOL.rating] - a[M.TCOL.rating])[0]
  assert.equal(r.teams[0].id, top[0])
})

test('every tool answers, and says what it must', async () => {
  const names = TOOLS.map((t) => t.name).sort()
  assert.deepEqual(names, ['cfb_all_savant_team', 'cfb_game', 'cfb_get_player_profile', 'cfb_leaderboard', 'cfb_player_career', 'cfb_player_splits', 'cfb_playoff_field', 'cfb_search_players', 'cfb_team_profile', 'cfb_team_rankings'])
  const cur = read(`s/${idx.current}.json`)
  const star = cur.players.map((p, i) => [p, cur.value.v[i]]).filter(([p]) => p[C.qual] && p[C.slot] === 'WR').sort((a, b) => b[1] - a[1])[0][0]
  const sp = await call('cfb_search_players', { query: star[C.name] })
  assert.ok(sp.players.some((p) => p.id === star[C.id]))
  const car = await call('cfb_player_career', { player: String(star[C.id]) })
  assert.ok(car.seasons.length >= 1 && car.seasons.at(-1).season === idx.current && car.seasons.at(-1).in_progress)
  const spl = await call('cfb_player_splits', { player: String(star[C.id]) })
  assert.ok(spl.splits.length >= 3 && spl.games.length === star[C.gp])
  const all = await call('cfb_all_savant_team', { season: 2019 })
  assert.equal(all.picks.length, 23)
  assert.equal(all.warning, reg.pre_box_warning)
  assert.equal((await call('cfb_all_savant_team', { season: 2025 })).warning, null)
  const conf = await call('cfb_all_savant_team', { team: 'conference', conference: 'sec' })
  assert.match(conf.team, /All-SEC Savant/)
  assert.match(conf._text, /a standing, not yet an award|All-SEC Savant, \d{4}\./)
  const po = await call('cfb_playoff_field', {})
  assert.equal(po.field.length, 12)
  assert.match(po._text, /Margin never enters it\. No committee ranking is used\./)
  if (po.live) { assert.equal(po.simulated_seasons, 20000); assert.ok(po.conference_leaders.length >= 9) }
  const old = await call('cfb_playoff_field', { season: 2014 })
  assert.equal(old.live, false)
  assert.match(old._text, /Ours, not the field that was played/)
  const tp = await call('cfb_team_profile', { team: 'Ohio State' })
  const gm = await call('cfb_game', { game_id: String(tp.schedule.find((g) => g.result).game_id) })
  assert.ok(gm.game.final && (gm.game.home === 'Ohio State' || gm.game.away === 'Ohio State'))
  const lb = await call('cfb_leaderboard', { stat: 'value', position: 'QB', limit: 5 })
  assert.equal(lb.leaders.length, 5)
  for (const [name, args, re] of [['cfb_get_player_profile', { player: 'zzzz qqqq' }, /No FBS player found/], ['cfb_team_profile', { team: 'zzzzqq' }, /No FBS team found/], ['cfb_leaderboard', { stat: 'nope' }, /No stat "nope"/], ['cfb_playoff_field', { season: 2090 }, /is not on file/], ['cfb_game', { game_id: '1' }, /No FBS game/]]) {
    const r = await callRaw(name, args)
    assert.ok(r.isError && re.test(r.content[0].text), `${name}: ${r.content[0].text}`)
  }
})

test('the refresh keeps raw ESPN off GitHub', () => {
  const f = path.join(ROOT, '.github', 'workflows', 'college-football-savant-refresh.yml')
  if (!existsSync(f)) return
  const y = readFileSync(f, 'utf8')
  assert.doesNotMatch(y, /gh release|upload-release-asset|cfb-raw/)
  assert.match(y, /pipeline\.cfb\.build refresh/)
})
