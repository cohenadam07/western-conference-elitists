// Check for the rest of Football Savant in the AI connector: the Leaderboard Builder, the team
// page and team boards, career mode, the game-by-game chart and recent form, splits, field
// maps, route trees and the postseason game pages (api/_football-lists.js and
// api/_football-games.js, and what scripts/lib/savant-api-football.mjs writes for them).
//
//   node --test tools/savant-football/more.mjs
//
// The rule is the same as check.mjs beside it: the page's own code, lifted out of
// public/football-savant.html and run in a sandbox over the real data files, decides what is
// right. Each board is rendered by the page's lbRender() and read back off the HTML it writes;
// each team page by openTeam(); each game chart by drawWeekly(); each splits table by
// renderSplits(). The tools are called through a local copy of the site's files, and every
// row is compared.
//
// If a page changes how it ranks or what it shows, this fails until the connector follows:
// fix the tool or the slicer, do not relax the check.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { writeFootballApi } from '../../scripts/lib/savant-api-football.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const html = readFileSync(path.join(PUBLIC, 'football-savant.html'), 'utf8')
const commas = (n) => Number(n).toLocaleString('en-US')
const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// ---- the files, built once and served the way the site serves them ------------------------
const DIST = mkdtempSync(path.join(os.tmpdir(), 'football-more-'))
let served = 0
const cdn = http.createServer((req, res) => {
  served++
  const url = decodeURIComponent(req.url.split('?')[0])
  const inDist = url.startsWith('/savant-api/')
  const file = path.join(inDist ? DIST : PUBLIC, url)
  let body = null
  if (existsSync(file) && !file.endsWith('/')) body = readFileSync(file)
  else if (existsSync(`${file}.gz`)) body = gunzipSync(readFileSync(`${file}.gz`))
  if (!body) { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); return res.end('<!doctype html>') }
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(body)
})
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let lists, games, core
before(async () => {
  writeFootballApi({ publicDir: PUBLIC, dist: DIST })
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  core = await import('../../api/_core.js')
  lists = await import('../../api/_football-lists.js')
  games = await import('../../api/_football-games.js')
})
after(() => { cdn.close(); rmSync(DIST, { recursive: true, force: true }) })
const readJson = (rel) => JSON.parse(readFileSync(path.join(PUBLIC, rel), 'utf8'))
const builtJson = (rel) => { const f = path.join(DIST, rel); return JSON.parse(existsSync(f) ? readFileSync(f, 'utf8') : gunzipSync(readFileSync(`${f}.gz`)).toString()) }

// ---- lifting the page's code (as in check.mjs) --------------------------------------------
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
function grabFunction(name) {
  const at = html.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
  assert.ok(at >= 0, `the page no longer has function ${name}()`)
  const end = closing(html, html.indexOf('{', html.indexOf(')', at)))
  assert.ok(end > at, `could not read function ${name}() out of the page`)
  return html.slice(at, end + 1)
}
function grabVar(name) {
  const at = html.search(new RegExp(`(^|\\n)var\\s+${name}\\s*=\\s*[{\\[]`))
  assert.ok(at >= 0, `the page no longer has var ${name}`)
  const open = at + html.slice(at).search(/[{[]/)
  const end = closing(html, open)
  assert.ok(end > open, `could not read var ${name} out of the page`)
  return `${html.slice(html.indexOf('var', at), end + 1)};`
}
function grabLine(start) {
  const at = html.indexOf(`\n${start}`)
  assert.ok(at >= 0, `the page no longer has a line starting "${start}"`)
  return html.slice(at + 1, html.indexOf('\n', at + 1))
}

const FUNCTIONS = [
  'miss', 'esc', 'prepData', 'seasonPlayers', 'rowFor', 'seasonsOf', 'yearOf', 'eraOK', 'onTeam', 'inSpan',
  'cohortKey', 'inCohort', 'bandOK', 'expBucket', 'isLive', 'isEst', 'estOn', 'baseMode', 'STATIC_ROW', 'poolVals',
  'eraOf', 'teamName', 'teamAbbr', 'roleSpot', 'roleLabel', 'ordSuffix',
  'formKey', 'formData', 'formPool', 'formRow', 'paceData', 'pacePool', 'posStat', 'posMean', 'regressed', 'estValue', 'estPool',
  'pctRaw', 'pctOf', 'mix', 'rampAt', 'colorAt', 'onColorIsDark', 'inFt', 'signed', 'fmt', 'ordinal', 'thrFor', 'sampleOf', 'isCareer',
  'commas', 'profileScore', 'careerArc', 'liveWeek', 'mergeData', 'posWord', '_norm', 'nameAlts',
  'careerRow', 'buildCareers', 'careerPool',
  'lbMetrics', 'lbAllMetrics', 'lbRows', 'lbPool', 'lbPct', 'lbTextColor', 'lbRender', 'lbRenderPlayers', 'lbRenderTeams', 'lbEncode', 'lbSyncURL',
  'tdiv', 'teamStats', 'teamRank', 'teamStatRow', 'openTeam',
  'spPct', 'splFmt', 'splRank', 'splLedgers', 'splLoad', 'renderSplits',
  'median', 'drawWeekly', 'wkSeasonFor', 'kpi', 'legendHtml',
  'rtPos', 'rtYears', 'rtSum', 'rtStats', 'rtLean', 'rtSide',
  'mapKindFor', 'throwSide', 'gapSide',
]

function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false, value: '', dataset: {}, style: {}, isConnected: true,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => [], querySelector: () => ({ innerHTML: '', textContent: '', style: {}, setAttribute() {} }),
    setAttribute() {}, scrollIntoView() {}, insertAdjacentElement() {}, appendChild() {}, remove() {},
  }
}
function loadPage(archive, current) {
  const els = {}
  const document = {
    getElementById: (id) => (els[id] = els[id] || makeEl(id)),
    querySelectorAll: () => [], querySelector: () => null, createElement: () => makeEl(''),
  }
  const sandbox = { document, history: { replaceState() {} }, location: { origin: 'https://wcehoops.com', pathname: '/football-savant.html', hash: '' }, navigator: {}, console, Promise, setTimeout }
  vm.createContext(sandbox)
  const code = `(function (ARCHIVE, CURRENT) {
  ${grabLine('var DATA=null')}
  ${grabLine('var cur=null')}
  ${grabLine('var openStat=null')}
  ${grabLine('var baseline=')}
  ${grabLine('var formWin=')}
  ${grabLine('var expRef=')}
  ${grabLine('var FORM=')}
  ${grabLine('var PACE=')}
  ${grabLine('var NO_CARRY=')}
  ${grabLine('var MEAN_CACHE=')}
  ${grabVar('ROLE_WORD')}
  ${grabVar('ROLE_OK')}
  ${grabLine('var ROLE_STARTERS=')}
  ${grabLine('var KNOWN_AS=')}
  ${grabLine('var AWARD_GROUP=')}
  ${grabLine('var ESTPOOL_CACHE=')}
  ${grabVar('NICK_GROUPS')}
  ${grabLine('var NICK=')}
  ${html.slice(html.indexOf('NICK_GROUPS.forEach('), html.indexOf('function nameAlts('))}
  ${grabLine('var cohortMode=')}
  ${grabLine('var bandOn=')}
  ${grabLine('var cmp=')}
  ${grabLine('var SEASON_HAS=')}
  ${grabLine('var POOL_CACHE=')}
  ${grabLine('var BLOCKS=')}
  ${grabLine('var CAREER=')}
  ${grabLine('var CAREER_SUM=')}
  ${grabLine('var CAREER_MAX=')}
  ${grabLine('var CAREER_CONST=')}
  ${grabLine('var CAREER_POOL_MULT=')}
  ${grabLine('var CROW_CACHE=')}
  ${grabLine('var CPOOL_CACHE=')}
  ${grabLine('var ARC_CACHE=')}
  ${grabLine('var PANEL_FLOOR=')}
  ${grabVar('SIDE')}
  ${grabVar('RAMP')}
  ${grabVar('STATLINE')}
  ${grabVar('CTOT')}
  ${grabVar('GAPS_BY_POS')}
  ${grabVar('COHORT_WORD')}
  ${grabVar('LB')}
  ${grabLine('var TEAMPOS=')}
  ${grabLine('var curTeam=')}
  ${grabVar('TEAM_METRICS')}
  ${grabLine('var TEAM_MBY=')}
  ${html.slice(html.indexOf('TEAM_METRICS.forEach(function(t){ TEAM_MBY'), html.indexOf('\n', html.indexOf('TEAM_METRICS.forEach(function(t){ TEAM_MBY')))}
  ${grabLine('var TSTAT_CACHE=')}
  ${grabVar('TEAM_UNITS')}
  ${grabVar('LINE_ORDER')}
  ${grabLine('var SPL_INDEX=')}
  ${grabVar('SPL_LEDGER')}
  ${grabLine('var chartMode=')}
  ${grabVar('SEASON_TOTAL_ONLY')}
  ${grabLine('var RT_INDEX=')}
  ${grabVar('RT_SLOTS')}
  ${grabVar('RT_LABEL')}
  ${grabLine('var RT_K=')}
  ${grabVar('CELLS')}
  ${grabVar('BAND_LABEL')}
  ${grabVar('GAP_LABEL')}
  ${FUNCTIONS.map(grabFunction).join('\n  ')}
  // the look of a team, a face and a chart: none of it decides a number
  function teamInk() { return '#000'; } function faceURL() { return null; } function faceSwap() { return null; }
  function hideLB() {} function hideHome() {} function selectPlayer() {} function setSeason() {} function syncURL() {}
  var WEEKLY = {};
  function wkRoot() { return Promise.resolve(WEEKLY.root); }
  function wkIndex(s) { return Promise.resolve(WEEKLY.idx[s] || null); }
  function wkPlayer(s, id) { return Promise.resolve(WEEKLY.player(s, id)); }
  var PLOT = null;
  function setPlotState(el, state) { PLOT = state; }
  DATA = mergeData(ARCHIVE, CURRENT);
  prepData();
  return {
    data: DATA, cfg: CFG,
    board: function (o) {
      for (var k in o) LB[k] = o[k];
      POOL_CACHE = {}; ESTPOOL_CACHE = {};
      lbRender();
      return { table: document.getElementById('lbTable').innerHTML, hint: document.getElementById('lbHint').innerHTML };
    },
    form: function (season, n, json) { FORM[formKey(season, n)] = json; },
    pace: function (week, json) { PACE[week] = json; },
    pacePct: function (id, key, season) {
      var p = rowFor(id, season), m = MBY[key], keep = baseline;
      baseline = 'pace'; POOL_CACHE = {};
      var r = miss(p.m[key]) ? null : pctOf(p.m[key], poolVals(key, p.pos, season), m.lower);
      baseline = keep; POOL_CACHE = {};
      return r;
    },
    team: function (season, t) { curSeason = season; openTeam(t); return document.getElementById('teamPanel').innerHTML; },
    career: function (id) { return careerRow(id); },
    careerPct: function (v, key, pos, lower) { return pctOf(v, careerPool(key, pos), lower); },
    arc: function (id) { return careerArc(id); },
    splits: function (season, id, mode, pack) {
      curSeason = season; curId = id; cur = rowFor(id, season); cmp = []; splMode = mode;
      SPL_INDEX = [String(season)];
      SPL_CACHE[season] = pack;
      renderSplits();
      return document.getElementById('splits').innerHTML;
    },
    weekly: function (season, id, key, files) {
      WEEKLY = files; PLOT = null; chartMode = 'week'; curId = id; curSeason = season; cur = rowFor(id, season);
      var el = { dataset: { key: key }, isConnected: true };
      return Promise.resolve(drawWeekly(el, key, MBY[key])).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(function () { return PLOT; });
    },
    route: function (packs, ys, id, pos) { var s = rtSum(packs, ys, id, pos); return s ? { sum: s, side: rtSide(s, pos) } : null; },
    lean: function (me, lg, mode) { return rtLean(me, lg, mode); },
    throwSide: function (rec, kind) { return throwSide(rec, kind); },
    gapSide: function (rec) { return gapSide(rec); },
  };
})`
  return vm.runInContext(code, sandbox)(archive, current)
}

let page, seasons, latest, meta
function load() {
  if (page) return
  page = loadPage(readJson('football-savant-data.json'), readJson('football-savant-current.json'))
  seasons = [...page.data.seasons]
  latest = seasons[0]
  meta = builtJson('savant-api/football/v1/meta.json')
}

// ---- reading the page's tables back --------------------------------------------------------
// lbRenderPlayers(): one <tr> a player: rank, name (data-id), team, [estimate], columns
function boardRows(table) {
  const out = []
  for (const tr of table.matchAll(/<tr([^>]*)>(.*?)<\/tr>/g)) {
    if (!/data-id="/.test(tr[2])) continue
    const tds = [...tr[2].matchAll(/<td([^>]*)>(.*?)<\/td>/g)].map((m) => ({ attr: m[1], text: unesc(m[2].replace(/<[^>]*>/g, '')) }))
    out.push({ id: unesc(tr[2].match(/data-id="([^"]+)"/)[1]), thin: /class="thin"/.test(tr[1]), cells: tds })
  }
  return out
}

test('every leaderboard is the page\'s: the same players, in the same order, with the same numbers', async () => {
  load()
  const pickSeasons = [latest, '2025', '2016', '2008']
  let boards = 0, rows = 0
  const positions = Object.keys(page.cfg.panels)
  for (const season of [...pickSeasons, 'career']) {
    const live = season === latest && !!(page.data.data[season] || {}).week
    for (const pos of positions) {
      const stats = page.cfg.metrics.filter((m) => m.pos.includes(pos) && m.grp !== 'ath' && m.grp !== 'ctx')
      const every = season === latest || season === '2025' ? 1 : 3
      for (let i = 0; i < stats.length; i += every) {
        const m = stats[i]
        if (season !== 'career' && +season < m.since) continue
        const modes = season === 'career' ? ['settled', 'everyone'] : live ? ['est', 'settled', 'everyone'] : ['settled', 'everyone']
        for (const mode of modes) {
          const base = { season: season === 'career' ? 'career' : season, pos, rank: m.key, topN: 25, team: '', share: 0, ageMin: null, ageMax: null, expMin: null, expMax: null, win: 0, basis: 'season', sample: mode, sampleSet: true, cols: [m.key] }
          const v = boardRows(page.board({ ...base, display: 'value' }).table)
          const p = boardRows(page.board({ ...base, display: 'pct' }).table)
          const sample = mode === 'est' ? 'likely_to_settle' : mode
          let got
          try { got = await lists.leaderboard({ position: pos, stat: m.key, season, sample, top: 25 }) } catch (e) {
            assert.fail(`${season} ${pos} ${m.key} ${mode}: the tool refused (${e.message}) where the page shows ${v.length} rows`)
          }
          const ps = got.structured.players
          assert.deepEqual(ps.map((x) => x.id), v.map((x) => x.id), `${season} ${pos} ${m.key} ${mode}: the order differs`)
          const useEst = v.length && v[0].cells.length === 5
          ps.forEach((x, k) => {
            const vc = v[k].cells, pc = p[k].cells
            const at = useEst ? 4 : 3
            assert.equal(x.display, vc[at].text === '—' ? x.display : vc[at].text, `${season} ${pos} ${m.key} ${mode} ${x.name}: value`)
            const pagePct = pc[at].text === '·' || pc[at].text === '—' ? null : +pc[at].text
            assert.equal(x.percentile, pagePct, `${season} ${pos} ${m.key} ${mode} ${x.name}: percentile`)
            if (useEst) {
              assert.equal(x.likely_to_settle.display, vc[3].text, `${season} ${pos} ${m.key} ${x.name}: likely to settle`)
              assert.equal(x.likely_to_settle.percentile, pc[3].text === '·' ? null : +pc[3].text, `${season} ${pos} ${m.key} ${x.name}: likely-to-settle percentile`)
            }
            assert.equal(!!x.low_sample, v[k].thin || (useEst && !!x.low_sample), `${season} ${pos} ${m.key} ${mode} ${x.name}: low-sample mark`)
          })
          boards++
          rows += ps.length
        }
      }
    }
  }
  console.log(`      ${commas(boards)} boards and ${commas(rows)} rows compared`)
  assert.ok(boards > 2000)
})

test('the board filters are the page\'s: team, snap share, age, experience, all-time basis, extra columns', async () => {
  load()
  const season = '2025'
  const cases = [
    { pos: 'WR', rank: 'ypt', team: 'CIN' }, { pos: 'QB', rank: 'epadb', share: 70 }, { pos: 'RB', rank: 'ryoe', ageMax: 24 },
    { pos: 'CB', rank: 'ycs', expMin: 5 }, { pos: 'ED', rank: 'prsssnap', basis: 'all' }, { pos: 'TE', rank: 'wopr', cols: ['wopr', 'tgtshr', 'ypt'] },
  ]
  for (const c of cases) {
    const cols = c.cols || [c.rank]
    const base = { season, pos: c.pos, rank: c.rank, topN: 25, team: c.team || '', share: c.share || 0, ageMin: null, ageMax: c.ageMax ?? null, expMin: c.expMin ?? null, expMax: null, win: 0, basis: c.basis || 'season', sample: 'settled', sampleSet: true, cols }
    const v = boardRows(page.board({ ...base, display: 'value' }).table)
    const p = boardRows(page.board({ ...base, display: 'pct' }).table)
    const got = await lists.leaderboard({ position: c.pos, stat: c.rank, season, team: c.team, min_snap_share: c.share, age_max: c.ageMax, exp_min: c.expMin, basis: c.basis === 'all' ? 'all_time' : 'season', columns: cols.filter((k) => k !== c.rank), sample: 'settled' })
    const ps = got.structured.players
    assert.deepEqual(ps.map((x) => x.id), v.map((x) => x.id), `${JSON.stringify(c)}: order`)
    assert.ok(ps.length > 0, JSON.stringify(c))
    ps.forEach((x, k) => {
      cols.forEach((key, j) => {
        const mine = key === c.rank ? { display: x.display, percentile: x.percentile } : x.columns.find((y) => y.key === key)
        const txt = v[k].cells[3 + j].text
        if (txt !== '—') assert.equal(mine.display, txt, `${JSON.stringify(c)} ${x.name} ${key}: value`)
        const pt = p[k].cells[3 + j].text
        assert.equal(mine.percentile ?? null, pt === '·' || pt === '—' ? null : +pt, `${JSON.stringify(c)} ${x.name} ${key}: percentile`)
      })
    })
  }
})

test('a last-4, -8 and -17 games board is the page\'s, ranked against everyone\'s same stretch', async () => {
  load()
  const season = latest
  if (!(page.data.data[season] || {}).week) return
  let boards = 0
  for (const n of [4, 8, 17]) {
    const file = path.join(PUBLIC, `football-weekly/${season}/form-${n}.json`)
    if (!existsSync(file)) continue
    page.form(season, n, JSON.parse(readFileSync(file, 'utf8')))
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'ED', 'CB']) {
      for (const key of [...page.cfg.metrics.filter((m) => m.pos.includes(pos) && m.grp !== 'ath' && m.grp !== 'ctx').map((m) => m.key)].slice(0, 25)) {
        const base = { season, pos, rank: key, topN: 25, team: '', share: 0, ageMin: null, ageMax: null, expMin: null, expMax: null, win: n, basis: 'season', sample: 'settled', sampleSet: true, cols: [key] }
        const v = boardRows(page.board({ ...base, display: 'value' }).table)
        const p = boardRows(page.board({ ...base, display: 'pct' }).table)
        const got = await lists.leaderboard({ position: pos, stat: key, window: n })
        const ps = got.structured.players
        assert.deepEqual(ps.map((x) => x.id), v.map((x) => x.id), `last ${n} ${pos} ${key}: order`)
        ps.forEach((x, k) => {
          assert.equal(x.display, v[k].cells[3].text, `last ${n} ${pos} ${key} ${x.name}: value`)
          assert.equal(x.percentile, p[k].cells[3].text === '·' ? null : +p[k].cells[3].text, `last ${n} ${pos} ${key} ${x.name}: percentile`)
        })
        boards++
      }
    }
  }
  console.log(`      ${boards} window boards compared`)
  assert.ok(boards > 100)
})

test('"same point" ranks every stat against past seasons through the same week, as the page does', async () => {
  load()
  const season = latest
  const week = (page.data.data[season] || {}).week
  if (!week) return
  const w = Math.max(1, Math.min(17, week))
  page.pace(week, readJson(`football-pace/w${String(w).padStart(2, '0')}.json`))
  const { playerProfile } = await import('../../api/_football.js')
  const file = builtJson(`savant-api/football/v1/seasons/${season}.json`)
  let cells = 0
  for (const r of file.players.filter((x) => x.qualified).filter((_, i) => i % 11 === 0).slice(0, 80)) {
    const got = await playerProfile({ player: r.id, season, rank_against: 'same_point' })
    for (const st of got.structured.stats) {
      assert.equal(st.same_point_percentile, page.pacePct(r.id, st.key, season), `${r.name} ${st.key}: same point`)
      cells++
    }
    assert.match(got.text, /at the same point of past seasons/)
  }
  console.log(`      ${commas(cells)} same-point percentiles compared`)
  assert.ok(cells > 2000)
})

test('team boards and team pages are the page\'s: every stat, every rank, the line grade and the roster in order', async () => {
  load()
  let teams = 0, statsCompared = 0, men = 0
  for (const season of [latest, '2025', '2016', '2003']) {
    // boards: every team stat, all 32
    for (const st of meta.teamStats) {
      const base = { season, pos: 'TEAM', rank: st.key, topN: 25, cols: [st.key], display: 'value' }
      const tbl = page.board(base).table
      const want = [...tbl.matchAll(/<td data-team="([A-Z]+)"[^>]*>([^<]*)<\/td><td>(\d+)<\/td><td[^>]*>([^<]*)<\/td>/g)].map((m) => [m[1], unesc(m[4])])
      const got = await lists.leaderboard({ position: 'team', stat: st.key, season, top: 32 })
      assert.deepEqual(got.structured.teams.map((t) => [t.team, t.display]), want, `${season} ${st.key}: team board`)
      statsCompared++
    }
    // pages
    const file = builtJson(`savant-api/football/v1/seasons/${season}.json`)
    for (const t of Object.keys(file.teams)) {
      const panel = page.team(season, t)
      const prof = await lists.teamProfile({ team: t, season })
      const rows = [...panel.matchAll(/<div class="tm-stat"><span>([^<]*)<\/span><b>([^<]*)<\/b><span[^>]*>(\d+)\w\w of (\d+)<\/span><\/div>/g)].map((m) => [unesc(m[1]), unesc(m[2]), +m[3], +m[4]])
      const mine = prof.structured.units ? [...prof.structured.units.offense, ...prof.structured.units.defense, ...prof.structured.units.gives_up, ...prof.structured.units.schedule].map((x) => [x.label, x.display, x.rank, x.of]) : []
      assert.deepEqual(mine, rows, `${season} ${t}: unit ranks`)
      const roster = [...panel.matchAll(/<button type="button" class="tm-pl[^"]*" data-id="([^"]+)"/g)].map((m) => unesc(m[1]))
      assert.deepEqual(prof.structured.roster.map((p) => p.id), roster, `${season} ${t}: roster order`)
      const scores = [...panel.matchAll(/<span class="tm-ps[^"]*"[^>]*>([^<]*)<\/span>/g)].map((m) => (m[1] === '—' ? null : +m[1]))
      assert.deepEqual(prof.structured.roster.map((p) => p.profile_score), scores, `${season} ${t}: profile scores`)
      const line = panel.match(/line grade (\d+(?:\.\d+)?) \((\d+)\w\w of (\d+)\)/)
      assert.deepEqual(prof.structured.line ? [prof.structured.line.score, prof.structured.line.rank, prof.structured.line.of] : null, line ? [+line[1], +line[2], +line[3]] : null, `${season} ${t}: line grade`)
      teams++
      men += roster.length
    }
  }
  console.log(`      ${statsCompared} team boards, ${teams} team pages and ${commas(men)} roster places compared`)
  assert.ok(teams > 120)
})

test('every career on file is the page\'s career row: every stat, every career percentile, the record and the résumé', async () => {
  load()
  let careers = 0, cells = 0
  const byKey = Object.fromEntries(page.cfg.metrics.map((m) => [m.key, m]))
  for (const f of readdirSync(path.join(DIST, 'savant-api/football/v1/careers')).filter((x) => x.endsWith('.json.gz'))) {
    const file = builtJson(`savant-api/football/v1/careers/${f.replace('.gz', '')}`)
    for (const r of file.players) {
      const c = JSON.parse(JSON.stringify(page.career(r.id)))   // out of the sandbox's realm
      assert.equal(r.pos, c.pos, `${r.name}: career position`)
      assert.equal(r.qualified, c.poolOK, `${r.name}: in the career pool`)
      assert.deepEqual(r.seasons.map(String), c.seasons, `${r.name}: seasons`)
      for (const k of Object.keys(c.m)) {
        if (!byKey[k] || miss(c.m[k])) continue
        assert.ok(r.m[k], `${r.name}: ${k} missing`)
        assert.equal(r.m[k][0], c.m[k], `${r.name} ${k}: career value`)
        assert.equal(r.m[k][1], page.careerPct(c.m[k], k, c.pos, byKey[k].lower), `${r.name} ${k}: career percentile`)
        cells++
      }
      assert.deepEqual(r.rec || [0, 0, 0], c.rec, `${r.name}: record`)
      assert.deepEqual((r.rings || []).map(String), c.rings, `${r.name}: rings`)
      assert.deepEqual((r.acc || []).map((a) => [a.s, a.led, a.top]), c.acc.map((a) => [a.s, a.led, a.top]), `${r.name}: NFL leader finishes`)
      const arc = JSON.parse(JSON.stringify(page.arc(r.id)))
      assert.deepEqual(r.arc.map(([s, sc]) => [String(s), sc == null ? null : Math.round(sc)]), arc.pts.map((p) => [p.season, p.score == null ? null : Math.round(Math.round(p.score * 10) / 10)]), `${r.name}: career arc`)
      careers++
    }
  }
  console.log(`      ${commas(careers)} careers and ${commas(cells)} career stats compared`)
  assert.ok(careers > 5000)
  // and the tool says what the file says
  const brady = await lists.playerCareer({ player: 'Tom Brady' })
  assert.equal(brady.structured.super_bowls_won.length, 7)
  assert.ok(brady.structured.awards.mvp >= 3 && brady.structured.stats.length > 30)
})
test('a game log is the page\'s weekly chart: every game\'s number, its level, the bye weeks, the best and last game', async () => {
  load()
  const root = readJson('football-weekly/index.json')
  const idx = {}
  const player = (s, id) => {
    const ix = idx[s] || (idx[s] = existsSync(path.join(PUBLIC, `football-weekly/${s}/index.json`)) ? readJson(`football-weekly/${s}/index.json`) : null)
    if (!ix) return null
    if (!ix.pack) return existsSync(path.join(PUBLIC, `football-weekly/${s}/${id}.json`)) ? readJson(`football-weekly/${s}/${id}.json`) : null
    const pk = readJson(`football-weekly/${s}/pack-${String(id).slice(-ix.pack)}.json`)
    return pk[id] || null
  }
  let nGames = 0, players = 0
  for (const season of [latest, '2025', '2012', '2001']) {
    idx[season] = readJson(`football-weekly/${season}/index.json`)
    const file = builtJson(`savant-api/football/v1/seasons/${season}.json`)
    const sample = file.players.filter((r) => r.qualified && ['QB', 'RB', 'WR', 'TE', 'ED', 'CB'].includes(r.pos)).filter((_, i) => i % 9 === 0).slice(0, 40)
    for (const r of sample) {
      const got = await games.playerGames({ player: r.id, season })
      for (const st of got.structured.stats) {
        const drawn = await page.weekly(season, r.id, st.key, { root, idx, player })
        const plot = drawn && { pts: JSON.parse(JSON.stringify(drawn.pts || null)) }   // out of the sandbox's realm
        assert.ok(plot && plot.pts, `${season} ${r.name} ${st.key}: the page drew nothing`)
        const want = plot.pts.map((p) => (p.kind === 'val' ? [p.w, p.v, p.pct] : [p.w, null, null]))
        const mine = got.structured.games.map((g) => (g.status === 'played' && g.stats[st.key] ? [g.week, g.stats[st.key].value, g.stats[st.key].level] : [g.week, null, null]))
        assert.deepEqual(mine, want, `${season} ${r.name} ${st.key}: game by game`)
        nGames += want.length
      }
      players++
    }
  }
  console.log(`      ${players} players and ${commas(nGames)} games compared`)
  assert.ok(nGames > 3000)
})

test('splits are the page\'s: every row, every rate, every rank among players with a real sample', async () => {
  load()
  let tables = 0, rows = 0
  for (const season of [latest, '2025', '2018', '2004']) {
    const pack = readJson(`football-splits/${season}.json`)
    const file = builtJson(`savant-api/football/v1/seasons/${season}.json`)
    const sample = file.players.filter((r) => /^(QB|RB|WR|TE)$/.test(r.pos) && r.qualified).filter((_, i) => i % 7 === 0).slice(0, 30)
    for (const r of sample) {
      for (const ledger of ['q', 'r', 't']) {
        if (!pack[ledger] || !pack[ledger][r.id]) continue
        const htmlOut = page.splits(season, r.id, ledger, pack)
        if (!htmlOut.includes(`aria-pressed="true"`) && !htmlOut.includes('<table')) continue
        const got = await games.playerSplits({ player: r.id, season, view: 'splits', ledger })
        if (got.structured.ledger !== ledger) continue
        const pageRows = [...htmlOut.matchAll(/<tr(?: class="thin"[^>]*)?><td>([^<]*)<\/td>(.*?)<td class="lg">([^<]*)<\/td><\/tr>/g)].map((m) => {
          const tds = [...m[2].matchAll(/<td([^>]*)>([^<]*)<\/td>/g)].map((x) => [unesc(x[2]), (x[1].match(/title="(\d+)\w\w percentile among (\d+)/) || []).slice(1).map(Number)])
          return [unesc(m[1]), tds, unesc(m[3])]
        })
        const mine = got.structured.groups.flatMap((g) => g.rows).map((x) => [x.split, x.columns.map((c) => [c.display, c.percentile != null ? [c.percentile, c.ranked_among] : []]), x.league ? x.league.display : '—'])
        assert.deepEqual(mine, pageRows, `${season} ${r.name} ${ledger}: splits`)
        tables++
        rows += mine.length
      }
    }
  }
  console.log(`      ${tables} split tables and ${commas(rows)} rows compared`)
  assert.ok(tables > 60)
})

test('maps and route trees are the page\'s, for a season and over a career', async () => {
  load()
  const mapIdx = readJson('football-maps/index.json')
  const rtIdx = readJson('football-routes/index.json')
  let maps = 0, trees = 0
  const ids = Object.keys(mapIdx).filter((_, i) => i % 97 === 0).slice(0, 60)
  for (const id of ids) {
    for (const kind of Object.keys(mapIdx[id])) {
      const ys = mapIdx[id][kind].slice().sort()
      for (const career of [false, true]) {
        const use = career ? ys : [ys[ys.length - 1]]
        let rec = null
        for (const y of use) {
          const r = (readJson(`football-maps/${y}.json`)[kind] || {})[id]
          if (!r) continue
          if (!rec) rec = { n: 0, z: null, g: null }
          rec.n += r.n || 0
          for (const f of ['z', 'g']) { if (!r[f]) continue; if (!rec[f]) rec[f] = r[f].map((c) => c.map(() => 0)); r[f].forEach((c, ci) => c.forEach((v, vi) => { rec[f][ci][vi] += v || 0 })) }
        }
        if (!rec) continue
        const view = kind === 'rush' ? 'rush_map' : kind === 'qb' ? 'throw_map' : 'target_map'
        let got
        try { got = await games.playerSplits({ player: id, season: career ? 'career' : String(use[0]), view }) } catch (e) { continue }   // his position that season has no such map
        // the page draws one map a card, the one his position's job calls for (mapKindFor())
        if (got.structured.view !== view && !(view === 'throw_map' && got.structured.view === 'target_map')) continue
        if ((kind === 'qb') !== (got.structured.view === 'throw_map')) continue
        const side = kind === 'rush' ? page.gapSide(rec) : page.throwSide(rec, kind)
        const pairs = [...side.matchAll(/<span>([^<]*)<\/span><b>([^<]*)<\/b>/g)].map((m) => [unesc(m[1]), unesc(m[2])])
        if (kind === 'rush') {
          const s = got.structured.sides
          const mine = [['Left side', s.left], ['Middle', s.middle], ['Right side', s.right]].map(([l, x]) => [l, `${x.share}%${x.yards_per_carry != null ? ` · ${x.yards_per_carry.toFixed(1)} ypc` : ''}`])
          if (got.structured.best_gap) mine.push(['Best gap', `${got.structured.best_gap.gap} · ${got.structured.best_gap.yards_per_carry.toFixed(1)}`])
          assert.deepEqual(mine, pairs, `${id} ${kind}${career ? ' career' : ''}: rushing map`)
        } else {
          const b = got.structured.bands
          const mine = b.map((x) => [x.depth.replace('0-9', '0–9').replace('10-19', '10–19'), `${x.share}%${x.yards_per_attempt != null ? ` · ${x.yards_per_attempt.toFixed(1)} y` : ''}`])
          mine.push(['Left / Middle / Right', `${got.structured.directions.left} / ${got.structured.directions.middle} / ${got.structured.directions.right}`])
          assert.deepEqual(mine, pairs, `${id} ${kind}${career ? ' career' : ''}: throw map`)
        }
        maps++
      }
    }
  }
  const rids = Object.keys(rtIdx).filter((_, i) => i % 23 === 0).slice(0, 90)
  for (const id of rids) {
    const ys = rtIdx[id].slice().sort()
    const packs = Object.fromEntries(ys.map((y) => [y, readJson(`football-routes/${y}.json`)]))
    let got
    try { got = await games.playerSplits({ player: id, season: 'career', view: 'route_tree' }) } catch (e) { continue }
    const pos = got.structured.player.position === 'Wide receiver' ? 'WR' : got.structured.player.position === 'Tight end' ? 'TE' : 'RB'
    const theirs = page.route(packs, ys, id, pos)
    const sideRows = [...theirs.side.matchAll(/<div class="rt-row[^"]*"><span>([^<]*)<\/span><span>(\d+)<\/span>/g)].map((m) => [unesc(m[1]), +m[2]])
    assert.deepEqual(got.structured.routes.map((r) => [r.route, r.targets]), sideRows, `${id}: route tree`)
    for (const r of got.structured.routes) {
      const i = ['Screen', 'Flat / swing', 'Slant', 'Quick out', 'Deep out', 'Out', 'Hitch / curl', 'Crosser / drag', 'In / dig', 'Corner', 'Post', 'Go', 'Wheel', 'Angle'].indexOf(r.route)
      const lean = page.lean(theirs.sum.me[i], theirs.sum.lg[i], 'epa')
      assert.ok(lean == null ? r.vs_position.epa_per_target == null : Math.abs(lean.d - r.vs_position.epa_per_target) < 1e-12, `${id} ${r.route}: against the position`)
    }
    trees++
  }
  console.log(`      ${maps} maps and ${trees} route trees compared`)
  assert.ok(maps > 40 && trees > 30)
})

test('every postseason game opens, and a search finds it by season and teams', async () => {
  const idx = readJson('football-games/index.json')
  let n = 0
  for (const [id, g] of Object.entries(idx)) {
    const got = await games.nflGame({ game: id })
    const x = got.structured.game
    assert.equal(x.away.score, g.as, `${id}: away score`)
    assert.equal(x.home.score, g.hs, `${id}: home score`)
    const found = await games.nflGame({ season: String(g.s), team: g.a, opponent: g.h })
    assert.equal(found.structured.game ? found.structured.game.id : null, id, `${id}: found by season and teams`)
    n++
  }
  const list = await games.nflGame({ season: '2024', team: 'Chiefs' })
  assert.ok(list.structured.games.length >= 3)
  console.log(`      ${n} postseason games opened`)
  assert.ok(n > 300)
})

test('the new tools declare lean, bounded inputs and answer bad questions plainly', async () => {
  const all = [...lists.tools, ...games.tools]
  assert.deepEqual(all.map((t) => t.name), ['nfl_leaderboard', 'nfl_team_profile', 'nfl_player_career', 'nfl_player_games', 'nfl_player_splits', 'nfl_game'])
  for (const t of all) {
    assert.ok(t.config.description.length <= 700, `${t.name}: description is ${t.config.description.length} characters`)
    for (const [k, shape] of Object.entries(t.config.inputSchema)) assert.ok(shape.description, `${t.name}.${k}: described`)
    assert.equal(t.config.annotations.readOnlyHint, true)
  }
  const bad = [
    () => lists.leaderboard({ position: 'goalie' }),
    () => lists.leaderboard({ position: 'QB', stat: 'zzzz' }),
    () => lists.leaderboard({ position: 'QB', season: '2010', window: 4 }),
    () => lists.teamProfile({ team: 'Spartans' }),
    () => games.playerSplits({ player: 'Patrick Mahomes', season: 'career', view: 'splits' }),
  ]
  for (const f of bad) {
    try { await f(); assert.fail('should not have an answer') } catch (e) {
      assert.ok(e instanceof core.SavantError, String(e && e.stack))
      assert.doesNotMatch(e.message, /127\.0\.0\.1|undefined|\[object/)
    }
  }
})

test('the new tools register with the MCP SDK and every answer fits its declared shape', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = new McpServer({ name: 'check', version: '0' })
  for (const t of [...lists.tools, ...games.tools]) {
    server.registerTool(t.name, t.config, async (args) => {
      try {
        const { text, structured } = await t.run(args)
        return { content: [{ type: 'text', text }], structuredContent: structured }
      } catch (err) {
        if (err instanceof core.SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
        throw err
      }
    })
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'check', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  try {
    const calls = [
      ['nfl_leaderboard', { position: 'QB', stat: 'epadb', season: '2024' }],
      ['nfl_leaderboard', { position: 'WR', season: 'career', stat: 'ypt', columns: ['catch'] }],
      ['nfl_leaderboard', { position: 'team', stat: 'd_epa' }],
      ['nfl_leaderboard', { position: 'RB', window: 4 }],
      ['nfl_team_profile', { team: 'Chiefs', season: '2023' }],
      ['nfl_player_career', { player: 'Tom Brady', stat: 'cpoe' }],
      ['nfl_player_games', { player: 'Josh Allen', season: '2025' }],
      ['nfl_player_splits', { player: 'Josh Allen', season: '2025' }],
      ['nfl_player_splits', { player: 'Derrick Henry', season: 'career', view: 'rush_map' }],
      ['nfl_player_splits', { player: 'Puka Nacua', season: '2025', view: 'route_tree' }],
      ['nfl_game', { season: '2025', team: 'Seahawks', opponent: 'Patriots' }],
      ['nfl_game', { season: '2024', team: 'Chiefs' }],
    ]
    for (const [name, args] of calls) {
      const got = await client.callTool({ name, arguments: args })
      assert.ok(!got.isError, `${name} ${JSON.stringify(args)}: ${got.content[0].text}`)
      assert.ok(got.content[0].text.length < 16000, `${name}: answer is ${got.content[0].text.length} characters`)
    }
  } finally {
    await client.close()
    await server.close()
  }
})
