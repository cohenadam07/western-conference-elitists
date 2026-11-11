// The analyst exam (research/data-room/BUILD.md §4).
//
//   node tools/savant-mcp/exam/exam.mjs gold                    compute every gold answer from the data
//                                                               files; write questions.json
//   node tools/savant-mcp/exam/exam.mjs check                   the self-check: answer each non-trap
//                                                               question through the connector (local
//                                                               files), compare with the gold
//   node tools/savant-mcp/exam/exam.mjs check --site https://wcehoops.com     the same, on the live address
//   options: --only nba-01,x-03   --json   --out FILE
//
// questions.src.json holds the questions as written (a recipe and its parameters each); gold writes
// questions.json: the same, plus each gold value, its tolerance and the tool calls that reach it.
// A question about the season in progress (in_progress) recomputes its gold on every check, from
// the same files the check reads. Traps have no gold: the right answer says the data can't answer;
// where a trap names a proof (a count that must be zero), the check runs it both ways.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { ROOT, agrees, answer, keep, makeFiles, measure as baseMeasure, needed, round, tableRows } from './lib.mjs'

const HERE = path.join(ROOT, 'tools', 'savant-mcp', 'exam')
const args = process.argv.slice(2)
const cmd = args[0] || 'check'
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const SITE = args.includes('--site') ? opt('site', 'https://wcehoops.com').replace(/\/$/, '') : null
const ONLY = opt('only', '') ? new Set(opt('only').split(',')) : null

// ---- metrics beyond lib's -------------------------------------------------------------------------
function measure(rows, m) {
  const n = (v) => (v == null || v === '' ? null : +v)
  if (m.fn === 'ts') { let p = 0, a = 0; for (const r of rows) { p += n(r.pts) || 0; a += (n(r.fga) || 0) + 0.44 * (n(r.fta) || 0) } return a ? p / (2 * a) : null }
  if (m.fn === 'share_eq') { const v = rows.filter((r) => r[m.col] != null); return v.length ? v.filter((r) => String(r[m.col]) === String(m.value)).length / v.length : null }
  if (m.fn === 'sum_div') return rows.reduce((s, r) => s + (n(r[m.col]) || 0), 0) / m.div
  if (m.fn === 'mean_div') { const v = rows.map((r) => n(r[m.col])).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length / m.div : null }
  if (m.fn === 'count_distinct') return new Set(rows.map((r) => r[m.col])).size
  return baseMeasure(rows, m)
}
function answerWith(rows, q) {
  if (!q.group) return { value: measure(rows, q.metric) }
  const g = new Map()
  for (const r of rows) { const k = q.group.map((c) => (c === '@season' ? r['@season'] : r[c])).join(' | '); if (!g.has(k)) g.set(k, []); g.get(k).push(r) }
  let list = [...g.entries()].map(([k, rs]) => ({ key: k, value: measure(rs, q.metric) })).filter((x) => x.value != null)
  list.sort((a, b) => (q.ascending ? a.value - b.value : b.value - a.value) || (a.key < b.key ? -1 : 1))
  if (q.key != null) { const i = list.findIndex((x) => x.key === String(q.key)); return q.rank_of ? { value: i + 1, of: list.length } : { value: i >= 0 ? list[i].value : null } }
  if (q.pick) return list[0] ? { key: list[0].key, value: list[0].value } : { key: null, value: null }
  return { value: list.slice(0, q.top || 5).map((x) => [x.key, x.value]) }
}
void answer
const nin = (r, f) => f.op === 'nin' ? !f.value.map(String).includes(String(r[f.column])) : keep(r, [f])
const keepAll = (r, fs = []) => fs.every((f) => nin(r, f))

// ---- the seasons a question names ----------------------------------------------------------------
async function currentSeason(F, which) {
  const cat = await F.json('dataroom/catalog.json')
  const last = (s, t) => Object.keys(cat.sports[s][t].seasons).sort().pop()
  return { '@current_nba': () => F.json('savant-current.json').then((c) => c.seasons[0]), '@current_nfl': () => last('nfl', 'games'), '@current_cbb': () => F.json('cbb/index.json').then((i) => i.current), '@current_cfb': () => last('cfb', 'games'), '@current_ufc': () => last('ufc', 'fights') }[which]()
}
async function seasonsOf(F, q) { const out = []; for (const s of q.seasons || []) out.push(s.startsWith('@') ? await currentSeason(F, s) : s); return out }

// ---- two ways to get rows: the files (gold) and the connector (the check) -------------------------
function goldSource(F) {
  return async ({ sport, table, season, team, filters }) => (await tableRows(F, { sport, table, season, team })).filter((r) => keepAll(r, filters)).map((r) => ({ ...Object.fromEntries(Object.keys(r).length ? [] : []), __r: r }))
}
// Proxy rows don't spread: read them through a small accessor
const rowOf = (x) => (x.__r ? new Proxy({}, { get: (o, k) => (k === '@season' ? x['@season'] : x.__r[k]) }) : x)

function toolSource(call, calls) {
  return async ({ sport, table, season, team, filters, columns }) => {
    const serverFilters = (filters || []).filter((f) => f.op !== 'nin')
    const out = []
    let offset = 0, pages = 0
    const base = { sport, table, ...(season && season !== 'all' ? { season } : {}), ...(team ? { team } : {}), filters: serverFilters, columns, limit: 500 }
    calls.push({ tool: 'savant_data', args: base, paged: true })
    while (offset != null) {
      const r = await call('savant_data', { ...base, offset })
      if (r.isError) throw new Error(`savant_data ${sport} ${table} ${season}: ${r.content[0].text}`)
      const s = r.structuredContent
      for (const row of s.rows) out.push(Object.fromEntries(s.columns.map((c, i) => [c, row[i]])))
      offset = s.next_offset
      if (++pages > 400) throw new Error('more than 400 pages')
    }
    return out.filter((r) => keepAll(r, (filters || []).filter((f) => f.op === 'nin')))
  }
}

// ---- the recipes --------------------------------------------------------------------------------
async function rowsFor(src, F, q, sport, seasons, filters, extraCols = []) {
  const all = []
  const columns = [...new Set([...needed({ ...q, filters }), ...extraCols])].filter((c) => c !== '@season')
  for (const season of seasons) for (const r of await src({ sport, table: q.table, season, team: q.team, filters, columns })) { const o = rowOf(r); all.push(new Proxy({}, { get: (_, k) => (k === '@season' ? season : o[k]) })) }
  return all
}
const ratio = (rows, num, den) => { let a = 0, b = 0; for (const r of rows) { a += +r[num] || 0; b += +r[den] || 0 } return b ? a / b : null }

async function solve(q, src, F) {
  const sport = q.data_sport || q.sport
  const seasons = await seasonsOf(F, q)
  switch (q.recipe) {
    case 'agg': return answerWith(await rowsFor(src, F, q, sport, seasons, q.filters), q)
    case 'split': {
      const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [...q.a, ...q.b].map((f) => f.column).concat(q.metric.fn === 'ts' ? ['pts', 'fga', 'fta'] : []))
      return { value: { a: measure(rows.filter((r) => keepAll(r, q.a)), q.metric), b: measure(rows.filter((r) => keepAll(r, q.b)), q.metric) } }
    }
    case 'split_share': { const rows = await rowsFor(src, F, q, sport, seasons, q.filters, q.a.map((f) => f.column)); return { value: rows.length ? rows.filter((r) => keepAll(r, q.a)).length / rows.length : null } }
    case 'share_by': {
      const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [...q.group, ...q.a.map((f) => f.column)])
      const g = new Map(); for (const r of rows) { const k = r[q.group[0]]; if (!g.has(k)) g.set(k, [0, 0]); const x = g.get(k); x[1]++; if (keepAll(r, q.a)) x[0]++ }
      const list = [...g.entries()].filter(([, x]) => x[1] >= q.min).map(([k, x]) => ({ key: k, value: x[0] / x[1] })).sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1))
      return { key: list[0]?.key ?? null, value: list[0]?.value ?? null }
    }
    case 'split_ratio': { const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [q.a.num, q.a.den, q.b.num, q.b.den]); return { value: { a: ratio(rows, q.a.num, q.a.den), b: ratio(rows, q.b.num, q.b.den) } } }
    case 'split_ratio_rows': { const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [q.num, q.den, ...q.a.map((f) => f.column)]); return { value: { a: ratio(rows.filter((r) => keepAll(r, q.a)), q.num, q.den), b: ratio(rows.filter((r) => keepAll(r, q.b)), q.num, q.den) } } }
    case 'weighted': { const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [q.value, q.weight]); let a = 0, w = 0; for (const r of rows) { a += (+r[q.value] || 0) * (+r[q.weight] || 0); w += +r[q.weight] || 0 } return { value: w ? a / w : null } }
    case 'weighted_by': {
      const rows = await rowsFor(src, F, q, sport, seasons, q.filters, [q.value, q.weight, ...q.group])
      const g = new Map(); for (const r of rows) { const k = r[q.group[0]]; if (!g.has(k)) g.set(k, [0, 0, 0]); const x = g.get(k); x[0] += (+r[q.value] || 0) * (+r[q.weight] || 0); x[1] += +r[q.weight] || 0; x[2]++ }
      const list = [...g.entries()].filter(([, x]) => x[2] >= q.min_games && x[1]).map(([k, x]) => ({ key: k, value: x[0] / x[1] })).sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1))
      return { key: list[0]?.key ?? null, value: list[0]?.value ?? null }
    }
    case 'per_team_game_diff': {
      const per = []
      for (const s of seasons) { const rows = await rowsFor(src, F, q, sport, [s], [], [q.col, 'game_id', 'team']); const tg = new Set(rows.map((r) => `${r.game_id}|${r.team}`)); per.push(rows.reduce((a, r) => a + (+r[q.col] || 0), 0) / tg.size) }
      return { value: { first: per[0], last: per[1], diff: per[1] - per[0] } }
    }
    case 'cover_rate': {
      const rows = await rowsFor(src, F, q, sport, seasons, [{ column: 'season_type', op: 'eq', value: 'REG' }, { column: 'favored_by', op: 'gt', value: 0 }], ['points', 'opp_points', 'favored_by'])
      let c = 0, n = 0; for (const r of rows) { const m = r.points - r.opp_points; if (m === r.favored_by) continue; n++; if (m > r.favored_by) c++ }
      return { value: n ? c / n : null, of: n }
    }
    case 'team_margin': {
      const rows = await rowsFor(src, F, q, sport, seasons, [{ column: 'non_d1', op: 'eq', value: 0 }], ['home', 'away', 'home_pts', 'away_pts'])
      const m = rows.map((r) => (String(r.home) === q.team ? r.home_pts - r.away_pts : r.away_pts - r.home_pts))
      return { value: m.length ? m.reduce((a, b) => a + b, 0) / m.length : null, of: m.length }
    }
    case 'home_win_rate': {
      const rows = await rowsFor(src, F, q, sport, seasons, [{ column: 'non_d1', op: 'eq', value: 0 }, { column: 'neutral', op: 'eq', value: 0 }], ['home_pts', 'away_pts'])
      const done = rows.filter((r) => r.home_pts != null && r.away_pts != null && r.home_pts !== r.away_pts)
      return { value: done.length ? done.filter((r) => r.home_pts > r.away_pts).length / done.length : null, of: done.length }
    }
    case 'cbb_home_fav_cover': {
      const rows = await rowsFor(src, F, q, sport, seasons, [{ column: 'site', op: 'eq', value: 'H' }, { column: 'spread', op: 'lt', value: 0 }], ['pts', 'opp_pts', 'spread'])
      let c = 0, n = 0; for (const r of rows) { const m = r.pts - r.opp_pts; if (m === -r.spread) continue; n++; if (m > -r.spread) c++ }
      return { value: n ? c / n : null, of: n }
    }
    case 'with_without': {
      const g = await rowsFor(src, F, { table: 'coaching_games' }, 'nba', [q.season], [{ column: 'team', op: 'eq', value: q.team }, { column: 'type', op: 'eq', value: 'RS' }], ['nba_gid', 'w'])
      const p = await rowsFor(src, F, { table: 'player_games' }, 'nba', [q.season], [{ column: 'player_id', op: 'eq', value: q.player_id }, { column: 'min', op: 'gt', value: 0 }], ['game_id'])
      const played = new Set(p.map((r) => String(r.game_id)))
      const rate = (xs) => (xs.length ? xs.filter((r) => r.w === true || r.w === 1).length / xs.length : null)
      return { value: { with: rate(g.filter((r) => played.has(String(r.nba_gid)))), without: rate(g.filter((r) => !played.has(String(r.nba_gid)))) } }
    }
    case 'two': { const out = []; for (const part of q.parts) out.push((await solve({ ...part, id: q.id }, src, F)).value); return { value: out } }
    case 'curry_threes': {
      const rows = await rowsFor(src, F, { table: 'player_games' }, 'nba', ['2024-25'], [{ column: 'player_id', op: 'eq', value: 201939 }], ['pts', 'fg3m'])
      const pts = rows.reduce((a, r) => a + r.pts, 0), t = rows.reduce((a, r) => a + 3 * r.fg3m, 0)
      return { value: pts ? t / pts : null }
    }
    case 'nuggets_points': {
      const g = await rowsFor(src, F, { table: 'coaching_games' }, 'nba', ['2024-25'], [{ column: 'team', op: 'eq', value: 'DEN' }, { column: 'type', op: 'eq', value: 'RS' }], ['pts'])
      const p = await rowsFor(src, F, { table: 'player_games' }, 'nba', ['2024-25'], [{ column: 'team', op: 'eq', value: 'DEN' }], ['pts'])
      return { value: { coaching_games: g.reduce((a, r) => a + r.pts, 0), player_games: p.reduce((a, r) => a + r.pts, 0) } }
    }
    default: throw new Error(`no recipe ${q.recipe}`)
  }
}

// Questions answered by a page tool, not savant_data: the call, what to read off it, and the gold
// from the file the page itself reads.
const FIELDS = {
  cbb_top_net: {
    calls: [{ tool: 'cbb_team_rankings', args: { season: '2024-25', sort: 'net', limit: 1 } }],
    gold: async (F) => { const t = (await F.json('cbb/teams/2024-25.json')).teams.filter((x) => x.net != null).sort((a, b) => b.net - a.net)[0]; return { key: t.name, value: t.net } },
    read: (rs) => { const t = rs[0].teams[0]; return { key: t.name || t.team, value: t.net ?? t.value } },
  },
  ufc_slpm_vs_room: {
    calls: [{ tool: 'ufc_get_fighter_profile', args: { fighter: 'Islam Makhachev' } }],
    gold: async (F) => { const d = await F.json('ufc-savant-data.json'); const f = Object.values(d.fighters).find((x) => x.name === 'Islam Makhachev'); return { value: f.w.career.m.slpm } },
    read: async (rs, call, calls) => {
      // the Data Room's own count: every fight he had, landed over minutes
      let ss = 0, secs = 0
      for (let y = 2015; y <= 2026; y++) {
        const args = { sport: 'ufc', table: 'fights', season: String(y), filters: [{ column: 'fighter', op: 'eq', value: 'Islam Makhachev' }], columns: ['ss', 'fight_seconds', 'stats'], limit: 500 }
        calls.push({ tool: 'savant_data', args })
        const r = await call('savant_data', args)
        if (r.isError) continue
        for (const row of r.structuredContent.rows) { if (row[2]) ss += row[0] || 0; secs += row[1] || 0 }
      }
      return { value: secs ? ss / (secs / 60) : null }
    },
  },
  nfl_team_plays_vs_room: {
    calls: [{ tool: 'savant_data', args: { sport: 'nfl', table: 'games', season: '2024', filters: [{ column: 'team', op: 'eq', value: 'BUF' }, { column: 'season_type', op: 'eq', value: 'REG' }], columns: ['plays'], limit: 500 } }],
    gold: async () => { const d = JSON.parse(readFileSync(path.join(ROOT, 'public', 'football-savant-data.json'), 'utf8')); return { value: d.data['2024'].tm.BUF.o.plays } },
    read: (rs) => ({ value: rs[0].rows.reduce((a, r) => a + r[0], 0) }),
  },
}

// ---- the connector: local (an in-process server on this repo's files) or the live address ---------
async function connector() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const client = new Client({ name: 'wce-exam', version: '1' })
  if (SITE) {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    await client.connect(new StreamableHTTPClientTransport(new URL(`${SITE}/api/mcp`)))
    // The analysis questions need a founder-tier key's address (WCE_EXAM_KEY); without one they are skipped.
    const key = process.env.WCE_EXAM_KEY
    let founder = null, fc = null
    if (key) { fc = new Client({ name: 'wce-exam', version: '1' }); await fc.connect(new StreamableHTTPClientTransport(new URL(`${SITE}/mcp/${key}`))); founder = (name, a) => fc.callTool({ name, arguments: a }) }
    return { call: (name, a) => client.callTool({ name, arguments: a }), founder, whyNoFounder: 'skipped: the analysis questions need a founder-tier key (WCE_EXAM_KEY)', close: async () => { await client.close(); if (fc) await fc.close() } }
  }
  // the site's files as Vercel serves them: dist (the build's savant-api files), then public/, then the
  // release-asset tables from out/dataroom
  const { writeAll } = await import('../../../scripts/lib/savant-api.mjs')
  const dist = mkdtempSync(path.join(os.tmpdir(), 'wce-exam-'))
  writeAll({ publicDir: path.join(ROOT, 'public'), dist, log: () => {} })
  const HOSTED = path.join(ROOT, 'out', 'dataroom')
  const { serveParquet, hasParquet } = await import('../../analysis/serve.mjs')
  process.env.SQL_TMP = process.env.SQL_TMP || mkdtempSync(path.join(os.tmpdir(), 'wce-sql-'))
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const send = (b, t = 'application/json') => { res.writeHead(200, { 'content-type': t, connection: 'close' }); res.end(b) }
    if (serveParquet && serveParquet(req, res, url)) return
    const m = url.match(/^\/assets\/([a-z]+)-([a-z_]+)-([0-9-]+)\.json\.gz$/)
    if (m) { const f = path.join(HOSTED, m[1], m[2], `${m[3]}.json.gz`); if (existsSync(f)) return send(readFileSync(f), 'application/octet-stream'); res.writeHead(404); return res.end() }
    for (const base of [dist, path.join(ROOT, 'public')]) {
      const f = path.join(base, url)
      if (existsSync(f + '.gz')) return send(gunzipSync(readFileSync(f + '.gz')))
      if (existsSync(f) && f.endsWith('.json')) return send(readFileSync(f))
    }
    send('<!doctype html>', 'text/html')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  process.env.DATAROOM_ASSETS = `http://127.0.0.1:${server.address().port}/assets`
  const { buildServer } = await import('../../../api/mcp.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const srv = buildServer({ state: 'none' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await srv.connect(a)
  await client.connect(b)
  // a founder-tier address for the analysis questions: the same handler code, the founder's listing
  const fsrv = buildServer({ state: 'valid', id: 'exam00000000', tier: 'founder' })
  const fc = new Client({ name: 'wce-exam-founder', version: '1' })
  const [c2, d2] = InMemoryTransport.createLinkedPair()
  await fsrv.connect(c2)
  await fc.connect(d2)
  const founder = hasParquet() ? (name, x) => fc.callTool({ name, arguments: x }) : null
  return { call: (name, x) => client.callTool({ name, arguments: x }), founder, whyNoFounder: 'skipped: the Parquet copies are not built on this machine (out/parquet)', close: async () => { await client.close(); await fc.close(); server.close() } }
}

// ---- gold -----------------------------------------------------------------------------------------
// The analysis questions (a-01 …, savant_sql and savant_analyze, founder tier): gold from
// analysis_gold.py, pandas and statsmodels over the JSON tables, never from the tools under test.
let ANALYSIS_GOLD = null
function analysisGold() {
  if (ANALYSIS_GOLD) return ANALYSIS_GOLD
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'wce-gold-')), 'gold.json')
  const r = spawnSync('python3', [path.join(HERE, 'analysis_gold.py'), '--out', out], { encoding: 'utf8', timeout: 3600000 })
  if (r.status !== 0) throw new Error(`analysis_gold.py failed: ${(r.stderr || '').slice(-400)}`)
  ANALYSIS_GOLD = JSON.parse(readFileSync(out, 'utf8'))
  return ANALYSIS_GOLD
}
// What a question reads off a tool's structured answer: a dotted path, or {name: path}.
const at = (o, p) => String(p).split('.').reduce((x, k) => (x == null ? x : x[/^\d+$/.test(k) ? +k : k]), o)
const readOff = (sc, spec) => (typeof spec === 'string' ? at(sc, spec) : Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, at(sc, p)])))

async function gold(q, F) {
  if (q.recipe === 'analysis') return round(analysisGold()[q.id], 6)
  if (q.recipe === 'trap') return null
  if (q.recipe === 'field') return round(await FIELDS[q.field].gold(F), 6)
  return round(await solve(q, goldSource(F), F), 6)
}
async function trapProof(q, src, F) {
  if (!q.proof || q.proof.recipe !== 'agg') return null
  return (await solve({ ...q.proof, sport: q.sport, id: q.id }, src, F)).value
}

async function main() {
  const src = JSON.parse(readFileSync(path.join(HERE, 'questions.src.json'), 'utf8'))
  const qs = src.questions.filter((q) => !ONLY || ONLY.has(q.id))
  if (cmd === 'gold') {
    const F = makeFiles({})
    const out = []
    for (const q of src.questions) {
      const g = await gold(q, F).catch((e) => ({ error: e.message }))
      const proof = q.recipe === 'trap' ? await trapProof(q, goldSource(F), F).catch((e) => ({ error: e.message })) : undefined
      const calls = q.recipe === 'field' ? FIELDS[q.field].calls : q.recipe === 'trap' ? [] : q.recipe === 'analysis' ? [q.call] : planCalls(q)
      out.push({ ...q, gold: g, ...(proof !== undefined && proof !== null ? { proof_value: proof } : {}), calls })
      console.log(`${q.id.padEnd(7)} ${q.recipe === 'trap' ? 'trap' : JSON.stringify(g).slice(0, 110)}`)
    }
    writeFileSync(path.join(HERE, 'questions.json'), JSON.stringify({ about: 'The analyst exam: 100 questions (80 for every address, 20 analysis questions for founder-tier addresses, answered with savant_sql and savant_analyze, their gold from analysis_gold.py: pandas and statsmodels over the JSON tables), each with its gold answer computed from the data files by tools/savant-mcp/exam/exam.mjs (never typed), its tolerance and the tool calls that reach it. Traps have no gold: the right answer says the data cannot answer, and why (reason). Regenerate: node tools/savant-mcp/exam/exam.mjs gold. Take the exam: RUN.md.', generated_from: 'questions.src.json', count: out.length, questions: out }, null, 1) + '\n')
    return
  }
  // check
  const stored = JSON.parse(readFileSync(path.join(HERE, 'questions.json'), 'utf8')).questions
  const byId = new Map(stored.map((q) => [q.id, q]))
  const F = makeFiles({ site: SITE })
  const C = await connector()
  const results = []
  for (const q0 of qs) {
    const q = { ...q0, ...(byId.get(q0.id) ? { gold: byId.get(q0.id).gold } : {}) }
    const calls = []
    const t0 = Date.now()
    try {
      if (q.recipe === 'trap') {
        const p = q.proof && q.proof.recipe === 'agg' ? await trapProof(q, toolSource(C.call, calls), F) : null
        const ok = p == null || agrees(q.proof.expect, p, 0)
        results.push({ id: q.id, sport: q.sport, kind: 'trap', ok, note: p == null ? 'trap (no proof to run)' : `proof ${JSON.stringify(p)} (expect ${q.proof.expect})` })
        continue
      }
      const want = q.in_progress ? await gold(q, F) : q.gold
      let got
      if (q.recipe === 'analysis') {
        if (!C.founder) { results.push({ id: q.id, sport: q.sport, kind: 'analysis', ok: true, skipped: true, note: C.whyNoFounder }); continue }
        calls.push(q.call)
        const r = await C.founder(q.call.tool, q.call.args)
        if (r.isError) throw new Error(r.content[0].text)
        got = round(readOff(r.structuredContent, q.read), 6)
      } else if (q.recipe === 'field') {
        const f = FIELDS[q.field]
        const rs = []
        for (const c of f.calls) { calls.push(c); const r = await C.call(c.tool, c.args); if (r.isError) throw new Error(r.content[0].text); rs.push(r.structuredContent) }
        got = round(await f.read(rs, C.call, calls), 6)
      } else got = round(await solve(q, toolSource(C.call, calls), F), 6)
      const ok = agrees(want, got, q.tolerance ?? 0)
      results.push({ id: q.id, sport: q.sport, kind: q.kind, ok, gold: want, got, calls: calls.length, ms: Date.now() - t0 })
    } catch (e) {
      results.push({ id: q.id, sport: q.sport, kind: q.kind, ok: false, error: e.message.slice(0, 300), calls: calls.length })
    }
    const r = results[results.length - 1]
    console.log(`${r.skipped ? 'skip' : r.ok ? 'ok  ' : 'FAIL'}  ${q.id.padEnd(7)} ${r.kind.padEnd(10)} ${r.error ? r.error : r.note || `gold ${JSON.stringify(r.gold).slice(0, 70)}  got ${JSON.stringify(r.got).slice(0, 70)}  (${r.calls} calls, ${r.ms} ms)`}`)
  }
  await C.close()
  const answerable = results.filter((r) => r.kind !== 'trap' && !r.skipped)
  const score = answerable.filter((r) => r.ok).length
  const an = results.filter((r) => r.kind === 'analysis')
  const summary = { where: SITE || 'local files', answerable: answerable.length, answered: score, analysis: { asked: an.filter((r) => !r.skipped).length, answered: an.filter((r) => r.ok && !r.skipped).length, skipped: an.filter((r) => r.skipped).length }, traps: results.filter((r) => r.kind === 'trap').length, traps_proved: results.filter((r) => r.kind === 'trap' && r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.id) }
  console.log(`self-check: ${score} of ${answerable.length} answerable questions answered through the connector (${summary.traps} traps, ${summary.traps_proved} with their proof holding; analysis ${summary.analysis.answered} of ${summary.analysis.asked}${summary.analysis.skipped ? `, ${summary.analysis.skipped} skipped` : ''})`)
  if (opt('out', null)) writeFileSync(opt('out'), JSON.stringify({ summary, results }, null, 1))
  if (args.includes('--json')) console.log(JSON.stringify(summary))
  process.exit(summary.failed.length ? 1 : 0)
}

// The calls a recipe makes, recorded with the gold (what an assistant would call)
function planCalls(q) {
  const one = (part) => (part.seasons || [part.season]).map((s) => ({ tool: 'savant_data', args: { sport: part.data_sport || part.sport || q.sport, table: part.table, season: s, ...(part.team || q.team ? { team: part.team || q.team } : {}), filters: (part.filters || []).filter((f) => f.op !== 'nin'), columns: needed(part), limit: 500 }, paged: true }))
  if (q.recipe === 'two') return q.parts.flatMap(one)
  if (q.recipe === 'with_without') return [{ tool: 'savant_data', args: { sport: 'nba', table: 'coaching_games', season: q.season, filters: [{ column: 'team', op: 'eq', value: q.team }], columns: ['nba_gid', 'w'] }, paged: true }, { tool: 'savant_data', args: { sport: 'nba', table: 'player_games', season: q.season, filters: [{ column: 'player_id', op: 'eq', value: q.player_id }], columns: ['game_id'] }, paged: true }]
  if (['curry_threes', 'nuggets_points'].includes(q.recipe)) return [{ tool: 'savant_data', args: { sport: 'nba', table: 'player_games', season: '2024-25' }, paged: true }, ...(q.recipe === 'nuggets_points' ? [{ tool: 'savant_data', args: { sport: 'nba', table: 'coaching_games', season: '2024-25' }, paged: true }] : [])]
  return one(q)
}

main().catch((e) => { console.error(e); process.exit(1) })
