// Check for the rest of Basketball Savant in the AI connector: the Leaderboard Builder, the
// career arc and honours, a team's depth chart, the Teams table, play types, with/without and
// months (api/_basketball-lists.js, the honours on api/_basketball.js profiles, and what
// scripts/lib/savant-api.mjs writes for them).
//
//   node --test tools/savant-api/more.mjs
//
// As in check.mjs beside it, the page's own code decides what is right: lbRender(),
// careerArc(), accolades() and openTeam() are lifted out of public/basketball-savant.html, and
// renderTeams() out of public/savant-teams.js, run in a sandbox over the real data, and read
// back off the HTML they write. The tools are called through a local copy of the site's files.
// Fix the tool or the slicer when this fails; do not relax it.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { writeSavantApi } from '../../scripts/lib/savant-api.mjs'
import { readSavantData } from '../../scripts/lib/savant-merge.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const html = readFileSync(path.join(PUBLIC, 'basketball-savant.html'), 'utf8')
const teamsJs = readFileSync(path.join(PUBLIC, 'savant-teams.js'), 'utf8')
const commas = (n) => Number(n).toLocaleString('en-US')
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&middot;/g, '·')
const clone = (x) => JSON.parse(JSON.stringify(x))   // out of the sandbox's realm

const DIST = mkdtempSync(path.join(os.tmpdir(), 'basketball-more-'))
const cdn = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  const file = path.join(url.startsWith('/savant-api/') ? DIST : PUBLIC, url)
  let body = null
  if (existsSync(file) && !file.endsWith('/')) body = readFileSync(file)
  else if (existsSync(`${file}.gz`)) body = gunzipSync(readFileSync(`${file}.gz`))
  if (!body) { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); return res.end('<!doctype html>') }
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(body)
})
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let lists, bb, core
before(async () => {
  writeSavantApi({ publicDir: PUBLIC, dist: DIST })
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  core = await import('../../api/_core.js')
  bb = await import('../../api/_basketball.js')
  lists = await import('../../api/_basketball-lists.js')
})
after(() => { cdn.close(); rmSync(DIST, { recursive: true, force: true }) })
const built = (rel) => JSON.parse(gunzipSync(readFileSync(path.join(DIST, `${rel}.gz`))).toString())
const builtPlain = (rel) => JSON.parse(readFileSync(path.join(DIST, rel), 'utf8'))

// ---- lifting the page's code ------------------------------------------------------------
// Index of the bracket that closes the one at `open`, skipping strings, comments and regular
// expressions (esc() has a quote inside one).
function closing(src, open) {
  const pairs = { '{': '}', '[': ']', '(': ')' }
  const stack = []
  let prev = ''
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    else if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; if (i < 1) break; continue }
    else if (ch === '/' && '(,=:[!&|?{};'.includes(prev)) {
      for (let cls = false, j = i + 1; j < src.length; j++) {
        if (src[j] === '\\') j++
        else if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        else if (src[j] === '/' && !cls) { i = j; break }
      }
    } else if (pairs[ch]) stack.push(pairs[ch])
    else if (ch === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i }
    if (!/\s/.test(ch)) prev = src[i]
  }
  return -1
}
function grab(src, name) {
  const at = src.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
  assert.ok(at >= 0, `no longer has function ${name}()`)
  const end = closing(src, src.indexOf('{', src.indexOf(')', at)))
  return src.slice(at, end + 1)
}
function grabLine(src, start) {
  const at = src.indexOf(`\n${start}`)
  assert.ok(at >= 0, `no longer has a line starting "${start}"`)
  return src.slice(at + 1, src.indexOf('\n', at + 1))
}
function grabBlock(src, start) {          // a var whose value runs over several lines
  const at = src.indexOf(`\n${start}`)
  assert.ok(at >= 0, `no longer has "${start}"`)
  const open = src.indexOf(src.slice(at).match(/[{[]/)[0], at)
  const pairs = { '{': '}', '[': ']' }
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "'" || src[i] === '"') { const q = src[i]; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; continue }
    if (src[i] === src[open]) depth++
    else if (src[i] === pairs[src[open]] && --depth === 0) return src.slice(at + 1, i + 1) + ';'
  }
  throw new Error(`could not read ${start}`)
}
function grabCfg() {
  const at = html.search(/const\s+CFG\s*=\s*\{/)
  const open = html.indexOf('{', at)
  return html.slice(open, closing(html, open) + 1)
}
function grabAwards() {
  const at = html.search(/const\s+AWARDS\s*=\s*\{/)
  const open = html.indexOf('{', at)
  return html.slice(open, closing(html, open) + 1)
}
function makeEl(id) {
  return { id, innerHTML: '', textContent: '', hidden: false, value: '', dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, appendChild() {} }
}

let page
function load() {
  if (page) return
  const els = {}
  const sandbox = { document: { getElementById: (id) => (els[id] = els[id] || makeEl(id)), querySelectorAll: () => [], createElement: () => makeEl('') }, history: { replaceState() {} }, location: { hash: '' }, window: {}, console }
  vm.createContext(sandbox)
  const fns = ['_norm', 'prepData', 'buildIndex', 'miss', 'poolVals', 'pctRaw', 'pctOf', 'seasonTier', 'settleLive', 'settlePrev', 'settlePos', 'settleRow', 'settleEst', 'settleVal', 'settlePoolVals',
    'rowFor', 'seasonPlayers', 'byKey', 'mix', 'colorAt', 'inFt', 'word', 'fmt', 'lbSeasonPlayers', 'lbSettling', 'lbVal', 'lbEligible', 'lbLeaguePool', 'lbPoolVals', 'lbPct', 'lbEncode', 'lbSyncURL', 'lbTextColor', 'lbRender',
    'peakEligible', 'peakWhy', 'trendPctOf', 'careerArc', 'accolades', 'openTeam']
  const code = `(function (DATA, CFG) {
    ${grabLine(html, 'const POS_FIX_ID')}
    ${grabLine(html, 'const POS_FIX_NAME')}
    const METRICS = CFG.metrics;
    let curSeason = null;
    let cur=null, curId=null, pop='league', win='season', band={min:20,max:40}, mpgOn=false;
    ${grabLine(html, 'let PIDX=')}
    ${grabLine(html, 'const val=')}
    ${grabLine(html, 'const smpl=')}
    ${grabLine(html, 'const SETTLE_K=')}
    ${grabLine(html, 'let SETTLE_CACHE=')}
    ${grabBlock(html, 'var LB=')}
    ${grabLine(html, 'const PEAK_MIN_GP=')}
    ${grabLine(html, 'const PEAK_MIN_SHARE=')}
    ${grabLine(html, 'const QUAL_GP=')}
    ${grabLine(html, 'const ARC_CACHE=')}
    ${grabBlock(html, 'const ACC_ORDER=')}
    const AWARDS = ${grabAwards()};
    function astHonour() { return null; }
    function headSrc() { return ''; } function headRetry() { return false; } function selectPlayer() {} function asId(x) { return x; } function pickHome() {}
    // The boards here rank the card's stats; a board on an addition waits for its season file
    // (savant-ext/), and those numbers are held to the page in tools/savant-mcp/check.mjs.
    function extKnown() { return true; } function extLoad() { return Promise.resolve(); }
    ${fns.map((f) => grab(html, f)).join('\n    ')}
    prepData();
    buildIndex();
    return {
      data: DATA, cfg: CFG,
      board: function (o) { for (var k in o) LB[k] = o[k]; SETTLE_CACHE = {}; lbRender(); return document.getElementById('lbTable').innerHTML; },
      arc: function (id) { return careerArc(id); },
      honours: function (id, s) { return accolades(id, s); },
      team: function (s, t) { curSeason = s; openTeam(t); return document.getElementById('teamPanel').innerHTML; },
    };
  })`
  page = vm.runInContext(code, sandbox)(withExt(clone(readSavantData(PUBLIC))), JSON.parse(grabCfg()))
}

// The October 2026 additions, laid into the rows the way the page's extLoad() does when a
// reader opens a season: every savant-ext/s/<season>.json in public/, every window it carries.
function withExt(data) {
  for (const season of data.seasons) {
    const f = path.join(PUBLIC, 'savant-ext', 's', `${season}.json`)
    if (!existsSync(f)) continue
    const x = JSON.parse(readFileSync(f, 'utf8'))
    for (const p of data.data[season].players) {
      const w = x.players[p.id]
      if (!w) continue
      for (const [win, r] of Object.entries(w)) r.forEach((c, i) => { if (c) (p.m[x.keys[i]] ||= {})[win] = { v: c[0], n: c[1] } })
    }
  }
  return data
}

// lbRender(): one <tr> a player: rank, name (data-id), the ranked stat, the columns
function boardRows(table) {
  return [...table.matchAll(/<tr><td class="lb-rank">(\d+)<\/td><td><span class="lb-name" data-id="([^"]+)">.*?<\/td>(.*?)<\/tr>/g)]
    .map((m) => ({ id: m[2], cells: [...m[3].matchAll(/<td class="lb-cell[^"]*"[^>]*>(.*?)<\/td>/g)].map((c) => ({ text: unesc(c[1].replace(/<span class="lb-est".*?<\/span>/, '').replace(/<[^>]*>/g, '')), est: c[1].includes('lb-est') })) }))
}
const norm = (unit, s) => (unit === 'sgn' ? s.replace('%', '') : unit === 'lb' ? s.replace(' lb', '') : s)

test('every basketball leaderboard is the page\'s: the same players, the same order, the same numbers', async () => {
  load()
  const meta = builtPlain('savant-api/basketball/v1/meta.json')
  const by = Object.fromEntries(meta.metrics.map((m) => [m.key, m]))
  const latest = meta.seasons[0]
  const cases = []
  for (const season of [latest, meta.seasons[1], '2015-16', '2002-03', '1988-89']) {
    for (const m of meta.metrics) {
      if (+season.slice(0, 4) < +String(m.since).slice(0, 4)) continue
      // an addition is ranked from its season's savant-ext file: only where one is built
      if (m.ext && !existsSync(path.join(PUBLIC, 'savant-ext', 's', `${season}.json`))) continue
      for (const pos of ['All', 'Guard', 'Big']) {
        if (pos !== 'All' && cases.length % 3) continue
        cases.push({ season, rankKey: m.key, pos, window: 'season', est: 'settled' })
        if (season === latest) { cases.push({ season, rankKey: m.key, pos, window: 'season', est: 'raw' }); if (pos === 'All') cases.push({ season, rankKey: m.key, pos, window: 'l10', est: 'settled' }) }
      }
    }
  }
  // the filters, on a sample
  for (const [i, f] of [{ team: 'BOS' }, { ageMax: 23 }, { expMin: 10 }, { minMpg: 30 }, { qualOnly: false }, { basis: 'league' }].entries()) {
    for (const k of ['pts', 'ts', 'ast', 'blk', 'bpm', 'usg']) cases.push({ season: meta.seasons[1], rankKey: k, pos: i % 2 ? 'Wing' : 'All', window: 'season', est: 'settled', ...f })
  }
  let rows = 0
  for (const c of cases) {
    const lb = { season: c.season, window: c.window, rankKey: c.rankKey, cols: [], pos: c.pos, team: c.team || '', ageMin: null, ageMax: c.ageMax ?? null, expMin: c.expMin ?? null, expMax: null, minMpg: c.minMpg || 0, qualOnly: c.qualOnly ?? true, topN: 25, basis: c.basis || 'cohort', est: c.est }
    const v = boardRows(page.board({ ...lb, display: 'value' }))
    const p = boardRows(page.board({ ...lb, display: 'pct' }))
    const got = await lists.leaderboard({ stat: c.rankKey, season: c.season, window: c.window, position: c.pos, team: c.team, age_max: c.ageMax, exp_min: c.expMin, min_mpg: c.minMpg, qualified_only: c.qualOnly, basis: c.basis, estimate: c.est, top: 25 })
    const ps = got.structured.players
    const tag = JSON.stringify(c)
    assert.deepEqual(ps.map((x) => x.id), v.map((x) => x.id), `${tag}: order`)
    const unit = by[c.rankKey].unit
    ps.forEach((x, k) => {
      if (!['word'].includes(unit)) assert.equal(norm(unit, x.display), norm(unit, v[k].cells[0].text), `${tag} ${x.name}: value`)
      assert.equal(x.percentile, p[k].cells[0].text === '—' ? null : +p[k].cells[0].text, `${tag} ${x.name}: percentile`)
      assert.equal(!!x.still_settling, v[k].cells[0].est, `${tag} ${x.name}: still settling`)
    })
    rows += ps.length
  }
  console.log(`      ${commas(cases.length)} boards and ${commas(rows)} rows compared`)
  assert.ok(cases.length > 400)
})

test('a career arc, its peak and every season\'s honours are the page\'s', async () => {
  load()
  const meta = builtPlain('savant-api/basketball/v1/meta.json')
  const index = builtPlain('savant-api/basketball/v1/players.json').players
  let careers = 0, seasons = 0, honours = 0
  // honours: every player, every season
  for (const s of meta.seasons) {
    const file = built(`savant-api/basketball/v1/seasons/${s}.json`)
    for (const r of file.players) {
      const want = clone(page.honours(r.id, s))
      assert.deepEqual(r.aw || [], want, `${s} ${r.name}: honours`)
      honours += want.length
    }
  }
  const sample = index.filter((_, i) => i % 23 === 0).slice(0, 160)
  for (const row of sample) {
    const got = await lists.playerCareer({ player: row.id })
    const arc = clone(page.arc(row.id))
    assert.deepEqual(got.structured.arc.map((p) => [p.season, p.counts, p.bpm]), arc.pts.map((p) => [p.s, p.ok, p.b]), `${row.name}: arc`)
    assert.deepEqual(got.structured.peak ? got.structured.peak.season : null, arc.peak ? arc.peak.season : null, `${row.name}: peak`)
    got.structured.arc.forEach((p, i) => { if (p.counts) assert.equal(p.bpm_position_percentile, Math.round(arc.pts[i].pct), `${row.name} ${p.season}: BPM percentile`) })
    careers++
    seasons += arc.pts.length
  }
  console.log(`      ${commas(honours)} honours, ${careers} careers and ${commas(seasons)} career seasons compared`)
  assert.ok(careers > 100 && honours > 3000)
})

test('a team\'s depth chart is the page\'s, and the Teams table is savant-teams.js\'s', async () => {
  load()
  const meta = builtPlain('savant-api/basketball/v1/meta.json')
  let teams = 0
  for (const s of [meta.seasons[1], '2010-11']) {
    const file = built(`savant-api/basketball/v1/seasons/${s}.json`)
    for (const t of [...new Set(file.players.map((p) => p.team))].filter(Boolean)) {
      const panel = page.team(s, t)
      const want = [...panel.matchAll(/<div class="trow" data-id="([^"]+)".*?<div class="rs">([\d.]+) MPG &middot; ([^ ]+) PPG<\/div>/g)].map((m) => [m[1], m[2], m[3]])
      const got = await lists.teamRankings({ season: s, team: t, top: 1 })
      const mine = got.structured.depth_chart.groups.flatMap((g) => g.players).map((p) => [p.id, p.mpg.toFixed(1), p.ppg == null ? '—' : p.ppg.toFixed(1)])
      assert.deepEqual(mine, want, `${s} ${t}: depth chart`)
      teams++
    }
  }
  // the Teams table: renderTeams() from savant-teams.js, every sort, every column
  const els = {}
  const sb = { document: { getElementById: (id) => (els[id] = els[id] || makeEl(id)) }, window: {}, console }
  vm.createContext(sb)
  const teamFile = JSON.parse(readFileSync(path.join(PUBLIC, 'savant-teams.json'), 'utf8'))
  const cur = existsSync(path.join(PUBLIC, 'savant-teams-current.json')) ? JSON.parse(readFileSync(path.join(PUBLIC, 'savant-teams-current.json'), 'utf8')) : null
  const tbl = vm.runInContext(`(function (A, C) {
    var D = document; function $(id) { return D.getElementById(id); }
    ${['esc', 'ok', 'f1', 'f0', 'pc', 'sg', 'th', 'xk', 'mergeTeams', 'rankOf', 'getv', 'renderTeams'].map((f) => grab(teamsJs, f)).join('\n')}
    ${grabLine(teamsJs, 'var LOW_GOOD=')}
    var T = { data: mergeTeams(A, C), sort: 'adjnet', team: null };
    return function (season, sort) { T.season = season; T.sort = sort; renderTeams(); return $('svTm').innerHTML; };
  })`, sb)(teamFile, cur)
  let tables = 0
  for (const s of [...new Set([teamFile.seasons[0], teamFile.seasons[3], teamFile.seasons[teamFile.seasons.length - 1]])]) {
    for (const sort of ['w', 'adjnet', 'net', 'drtg', 'pace', 'efg', 'tov', 'oefg', 'luck', 'xw', 'fg3r']) {
      const htmlOut = tbl(s, sort)
      const want = [...htmlOut.matchAll(/<tr><td>(\d+)<\/td><td class="l"><span class="pl" data-team="([A-Z]+)">[^<]*<\/span><\/td>(.*?)<\/tr>/g)].map((m) => [m[2], [...m[3].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => unesc(c[1]))])
      const got = await lists.teamRankings({ season: s, sort })
      const mine = got.structured.teams.map((t) => [t.team, got.structured.columns.map((c) => t.values[c.key])])
      assert.deepEqual(mine, want, `${s} by ${sort}: the Teams table`)
      tables++
    }
  }
  console.log(`      ${teams} depth charts and ${tables} Teams tables compared`)
  assert.ok(teams > 50 && tables >= 22)
})

test('play types, with/without and months are what the page holds, and the new tools are lean and plain', async () => {
  load()
  const meta = builtPlain('savant-api/basketball/v1/meta.json')
  const s = meta.seasons[1]
  const file = built(`savant-api/basketball/v1/seasons/${s}.json`)
  const raw = new Map(page.data.data[s].players.map((p) => [String(p.id), p]))
  let n = 0
  for (const r of file.players.filter((p) => p.pt).slice(0, 60)) {
    const got = await lists.playerSplits({ player: r.id, season: s, view: 'play_types' })
    const want = clone(raw.get(String(r.id)).pt)
    const sortRows = (a) => a.map((x) => JSON.stringify(x)).sort()
    assert.deepEqual(sortRows(got.structured.play_types.map((t) => [t.share, t.points_per_possession, t.percentile, t.possessions])), sortRows(Object.values(want)), `${r.name}: play types`)
    assert.equal(got.structured.play_types.length, Object.keys(want).length)
    n++
  }
  for (const r of file.players.filter((p) => p.ww).slice(0, 40)) {
    const got = await lists.playerSplits({ player: r.id, season: s, view: 'with_without' })
    assert.deepEqual(got.structured.with_without.map((x) => [x.teammate_id, x.games_with, x.games_without]), clone(raw.get(String(r.id)).ww).map((x) => [String(x.id), x.gw, x.gwo]), `${r.name}: with/without`)
    n++
  }
  assert.ok(n > 60)
  for (const t of lists.tools) {
    assert.ok(t.config.description.length <= 700, `${t.name}: description is ${t.config.description.length} characters`)
    for (const [k, shape] of Object.entries(t.config.inputSchema)) assert.ok(shape.description, `${t.name}.${k}: described`)
    assert.equal(t.config.annotations.readOnlyHint, true)
  }
  for (const f of [() => lists.leaderboard({ stat: 'zzzz' }), () => lists.leaderboard({ window: 'l10', season: '2010-11' }), () => lists.teamRankings({ sort: 'nope' }), () => lists.playerSplits({ player: 'Bill Russell', view: 'play_types' })]) {
    try { await f(); assert.fail('should not have an answer') } catch (e) { assert.ok(e instanceof core.SavantError, String(e && e.stack)) }
  }
  // and the profile carries the season's honours
  const jokic = await bb.playerProfile({ player: 'Nikola Jokic', season: '2023-24', group: 'value' })
  assert.ok(jokic.structured.league_honours.some((h) => h.award === 'Most Valuable Player'))
})
