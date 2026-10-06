// Check for the Football Savant section of the AI connector: the files the build writes
// (scripts/lib/savant-api-football.mjs) and the tools that read them (api/_football.js).
//
//   node --test tools/savant-football/check.mjs
//
// The files exist so that a machine can quote the number a fan sees on a Football Savant
// card. So the first question is not "does the slicer agree with itself" but "does it agree
// with the page". This lifts the page's own code out of public/football-savant.html —
// mergeData, prepData, poolVals, pctOf, panelWorthIt, and the functions that actually draw a
// card's bars (panelHTML, groupBlocks, barRow) — and runs it in a sandbox over the real data
// files. Every player-season's panels are rendered by the page's code, the percentile and the
// printed value are read off the HTML it produces, and both are compared with what the
// slicer wrote and with how the tool prints it. The all-time percentile, the profile score,
// the peak season and the pool sizes are compared the same way.
//
// Then the tools: every player-season's profile is fetched through api/_football.js from a
// local port and compared with the files; names are matched the way people type them; and
// the questions that cannot be answered come back saying what to try.
//
// If someone changes how the page ranks players, this fails until the slicer follows. If the
// page is restructured so a function can no longer be found, it fails with the name of the
// missing piece. Either way: fix the slicer or the section, do not relax the check.
//
// No network, no keys, no dependencies. It reads a 44 MB file and renders fifty thousand
// cards, so it takes a minute or so.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { BASE, buildFootballApi, mergeData, writeFootballApi } from '../../scripts/lib/savant-api-football.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const BUDGET = 15 * 1048576 // bytes on disk; Vercel keeps ~40 deployments, so every MB costs 40

const html = readFileSync(path.join(PUBLIC, 'football-savant.html'), 'utf8')
const commas = (n) => Number(n).toLocaleString('en-US')
const sha = (text) => createHash('sha256').update(text).digest('hex')

// MEMORY. The archive is 44 MB of JSON, and the built files are bigger still as objects, so
// this is careful about what it holds. Everything is loaded on first use rather than at the
// top of the file, so that the first test (writing to disk, which has to parse the archive
// again by itself) runs and finishes before any of it exists. And the built files are kept
// as the text that gets published, with one season parsed at a time.
let archive
let current
let json      // what the slicer builds, as published: { meta, players, seasons: { year: text } }
let meta      // meta.json, parsed
let index     // players.json, parsed
let metricOf
let page      // the page's own code, in a sandbox, over the same data
let seasons
function load() {
  if (json) return
  archive = JSON.parse(readFileSync(path.join(PUBLIC, 'football-savant-data.json'), 'utf8'))
  current = JSON.parse(readFileSync(path.join(PUBLIC, 'football-savant-current.json'), 'utf8'))
  // The slicer leaves its inputs alone, so the same parsed files then go to the page's own
  // mergeData, which does not.
  const built = buildFootballApi({ data: archive, current, html })
  json = {
    meta: JSON.stringify(built.meta),
    players: JSON.stringify(built.players),
    seasons: Object.fromEntries(Object.entries(built.seasons).map(([s, body]) => [s, JSON.stringify(body)])),
  }
  // Read back from the text, because that is what a reader gets (a -0 is a plain 0 in a file).
  meta = JSON.parse(json.meta)
  index = JSON.parse(json.players)
  metricOf = new Map(meta.metrics.map((m) => [m.key, m]))
  page = loadPage(archive, current)
  seasons = [...page.data.seasons] // a copy: arrays made inside the sandbox belong to another realm
}

// One season's file, parsed. The last two are kept; the tests walk season by season.
const parsed = []
function seasonFile(season) {
  let hit = parsed.find((x) => x.season === season)
  if (!hit) {
    assert.ok(json.seasons[season], `no season file for ${season}`)
    hit = { season, file: JSON.parse(json.seasons[season]) }
    parsed.unshift(hit)
    parsed.length = Math.min(parsed.length, 2)
  }
  return hit.file
}

// ---- lifting the page's code ---------------------------------------------------------

// Index of the bracket that closes the one at `open`, skipping strings, comments and regular
// expressions (the page's esc() has a quote inside one). A slash starts a regular expression
// when what came before it cannot end a value.
function closing(src, open) {
  const pairs = { '{': '}', '[': ']', '(': ')' }
  const stack = []
  let prev = ''
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
      if (i < 0) break
      continue
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1
      if (i < 1) break
      continue
    } else if (ch === '/' && '(,=:[!&|?{};'.includes(prev)) {
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

// `var NAME=<literal>;` — an object or array that may run over several lines.
function grabVar(name) {
  const at = html.search(new RegExp(`(^|\\n)var\\s+${name}\\s*=\\s*[{\\[]`))
  assert.ok(at >= 0, `the page no longer has var ${name}`)
  const open = at + html.slice(at).search(/[{[]/)
  const end = closing(html, open)
  assert.ok(end > open, `could not read var ${name} out of the page`)
  return `${html.slice(html.indexOf('var', at), end + 1)};`
}

// A whole line, found by how it starts. Used for the one-line state declarations, so the
// sandbox starts from the page's own defaults rather than from a copy of them.
function grabLine(start) {
  const at = html.indexOf(`\n${start}`)
  assert.ok(at >= 0, `the page no longer has a line starting "${start}"`)
  return html.slice(at + 1, html.indexOf('\n', at + 1))
}

const FUNCTIONS = [
  '_norm', 'miss', 'esc', 'prepData', 'seasonPlayers', 'rowFor', 'seasonsOf', 'yearOf', 'eraOK',
  'cohortKey', 'inCohort', 'bandOK', 'poolVals', 'pctRaw', 'pctOf', 'mix', 'rampAt', 'colorAt', 'blockBar',
  'inFt', 'signed', 'fmt', 'ordinal', 'sampleOf', 'isCareer', 'careerHigh', 'statBtn', 'barRow',
  'rowFor_metric', 'groupBlocks', 'notYet', 'panelHTML', 'commas', 'poolCount', 'profileScore',
  'careerArc', 'liveWeek', 'yr2', 'panelWorthIt', 'mergeData',
]

// The page's code and the globals it reads, wrapped so nothing leaks. Nothing here touches
// the document: the functions that draw a panel return HTML as a string.
const loadPage = (archiveData, currentData) => vm.runInNewContext(`(function (ARCHIVE, CURRENT) {
  ${grabLine('var DATA=null')}
  ${grabLine('var cur=null')}
  ${grabLine('var baseline=')}
  ${grabLine('var cohortMode=')}
  ${grabLine('var bandOn=')}
  ${grabLine('var cmp=')}
  ${grabLine('var SEASON_HAS=')}
  ${grabLine('var POOL_CACHE=')}
  ${grabLine('var BLOCKS=')}
  ${grabLine('var CAREER=')}
  ${grabLine('var ARC_CACHE=')}
  ${grabLine('var PANEL_FLOOR=')}
  ${grabVar('SIDE')}
  ${grabVar('RAMP')}
  ${grabVar('STATLINE')}
  ${grabVar('CTOT')}
  ${grabVar('GAPS_BY_POS')}
  ${grabVar('COHORT_WORD')}
  ${FUNCTIONS.map(grabFunction).join('\n  ')}
  // Career mode is out of scope; these are only ever reached through it.
  function careerRow() { throw new Error('career row asked for'); }
  function careerPool() { throw new Error('career pool asked for'); }
  var defaults = { baseline: baseline, cohortMode: cohortMode, bandOn: bandOn, compare: cmp.length };
  DATA = mergeData(ARCHIVE, CURRENT);
  prepData();
  return {
    data: DATA, cfg: CFG, defaults: defaults, cohortWord: COHORT_WORD, gaps: GAPS_BY_POS, floors: PANEL_FLOOR,
    mergeData: mergeData, miss: miss, fmt: fmt, pctOf: pctOf, poolCount: poolCount, notYet: notYet,
    panelWorthIt: panelWorthIt, seasonsOf: seasonsOf, names: NAMES,
    // One player-season on screen, the way selectPlayer()/setSeason() leave things.
    show: function (p, season) { cur = p; curId = p.id; curSeason = season; },
    panel: function (group, pos) { return panelHTML(group, pos, ''); },
    rankAgainst: function (v) { baseline = v; POOL_CACHE = {}; },
    pool: function (key, pos, season) { return poolVals(key, pos, season); },
    score: function (id, season) { return profileScore(id, season); },
    arc: function (id) { return careerArc(id); },
  };
})`)(archiveData, currentData)

// What the page's panel HTML says, row by row.
const ROW = /<div class="row (un)?" data-k="([^"]+)"[^>]*>.*?<div class="tag">([^<]*)<\/div>.*?<div class="pct">([^<]*)<\/div><div class="rv">([^<]*)<\/div>/g
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
function drawn(p, season) {
  page.show(p, season)
  const panels = (page.cfg.panels[p.pos] || ['ctx']).filter((g) => page.panelWorthIt(g, p, p.pos))
  const rows = []
  for (const g of panels) {
    for (const r of page.panel(g, p.pos).matchAll(ROW)) {
      rows.push({ key: r[2], low: r[1] === 'un', tag: r[3], pct: r[4] === '·' ? null : +r[4], shown: unesc(r[5]) })
    }
  }
  return { panels, rows }
}

// ---- 0. the files on disk -------------------------------------------------------------

// Runs first, and on its own: see load(). It keeps a fingerprint of every file it wrote; a
// later test holds them against what the slicer builds in memory.
let disk
test('the files are written to disk, gzipped where they should be, under the size budget', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-football-'))
  try {
    const r = writeFootballApi({ publicDir: PUBLIC, dist })
    const root = path.join(dist, BASE)
    assert.deepEqual(readdirSync(root).sort(), ['meta.json', 'players.json', 'seasons'])
    const written = readdirSync(path.join(root, 'seasons')).sort()
    for (const f of written) assert.match(f, /^\d{4}\.json\.gz$/, 'season file names must fit the rewrite pattern')
    disk = {
      meta: sha(readFileSync(path.join(root, 'meta.json'), 'utf8')),
      players: sha(readFileSync(path.join(root, 'players.json'), 'utf8')),
      seasons: Object.fromEntries(written.map((f) => [f.slice(0, 4), sha(gunzipSync(readFileSync(path.join(root, 'seasons', f))).toString('utf8'))])),
    }
    assert.equal(JSON.parse(readFileSync(path.join(root, 'meta.json'), 'utf8')).schema, 1)
    assert.equal(JSON.parse(readFileSync(path.join(root, 'players.json'), 'utf8')).schema, 1)
    assert.equal(r.files, written.length + 2)
    assert.match(r.summary, /^[\d,]+ players, [\d,]+ player-seasons, \d+ seasons/)
    console.log(`      ${r.files} files, ${(r.raw / 1048576).toFixed(1)} MB of season data, ${(r.bytes / 1048576).toFixed(2)} MB on disk (budget ${BUDGET / 1048576} MB): ${r.summary}`)
    assert.ok(r.bytes < BUDGET, `the files grew to ${(r.bytes / 1048576).toFixed(1)} MB`)
    assert.ok(r.raw > r.bytes)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('what was written to disk is what the slicer builds, file for file', (t) => {
  if (!disk) return t.skip('the disk test did not run')
  load()
  assert.equal(disk.meta, sha(json.meta), 'meta.json')
  assert.equal(disk.players, sha(json.players), 'players.json')
  assert.deepEqual(Object.keys(disk.seasons).sort(), [...seasons].sort())
  for (const s of seasons) {
    assert.ok(json.seasons[s].startsWith('{"schema":1,'), `seasons/${s}.json: every file carries the schema the loader asks for`)
    assert.equal(disk.seasons[s], sha(json.seasons[s]), `seasons/${s}.json`)
  }
})

// ---- 1. the page ---------------------------------------------------------------------

test('the page still works the way the slicer and the tools assume', () => {
  load()
  // The view a fan lands on: ranked against his position, in his season, no snap-share band.
  assert.deepEqual({ ...page.defaults }, { baseline: 'season', cohortMode: 'pos', bandOn: false, compare: 0 }, 'the page\'s default pool changed')
  // These rules live inline in render() and friends, not in a function that can be lifted, so
  // they are pinned by their text. If one changes, re-read that function before touching this.
  const pinned = [
    ['var pos=p.pos;', 'render() no longer ranks a player at the position on his own row'],
    ["var panels=(CFG.panels[pos]||['ctx']).filter(function(g){ return panelWorthIt(g,p,pos); });", 'how render() picks a card\'s panels changed'],
    ["var q='#p='+encodeURIComponent(curId)+'&s='+curSeason", 'the player link written by syncURL() changed'],
    ['if(!o.p||!PIDX[o.p]) return false;', 'how readURL() reads the player out of the link changed'],
    ['curSeason=(o.s&&(isCareer(o.s)||DATA.seasons.indexOf(o.s)>=0))?o.s:seasonsOf(o.p).slice(-1)[0];', 'how readURL() reads the season out of the link changed'],
    ["var tag=m.layer.toUpperCase()+(smp.ok?'':' · low sample');", 'the low-sample tag in barRow() changed'],
    ['if(!arc.pts.length||arc.pts.length<2){ btn.hidden=true; rail.hidden=true; return; }', 'when the career-arc button shows changed'],
    ["(mine&&mine.score!=null?Math.round(mine.score)+' this year':'this year unranked')", 'how the career-arc button prints the profile score changed'],
    ["'Some charting is published a season at a time, after it ends.'", 'the page\'s wording for stats not charted yet changed'],
    ["return 'Ranked against '+commas(poolCount(pos))+' qualified '+who+' '+when", 'the pool caption in cohortNote() changed'],
    ["? 'across every season each stat has existed'", 'the all-time pool caption in cohortNote() changed'],
    ['wk=top.week, wp=top.weekPlaying;', 'how the page reads the week of a season in progress changed'],
    [':((cur&&cur.comps)?cur.comps:null);', 'how renderComps() reads statistical comps changed'],
    ['fl=(cur&&cur.wflaws&&cur.wflaws.length)?cur.wflaws:null;', 'how renderWeak() reads "where he ranks worst" changed'],
    ['cs=(cur&&cur.wcomps&&cur.wcomps.length)?cur.wcomps:null;', 'how renderWeak() reads weakness comps changed'],
    [`var weak=best<=${meta.weakness.lowMatch};`, 'the low-match line under weakness comps changed'],
    // The facts in a profile's first lines, each read off the same field the card reads.
    ["var path=(p.tms&&p.tms.length>1)?p.tms:null;", 'how the card lists a traded player\'s teams changed'],
    ["if(p.exp!=null) meta.push(p.exp===0?'rookie':'year '+(p.exp+1));", 'how the card prints experience changed'],
    ["if(p.age) meta.push('age '+p.age);", 'how the card prints age changed'],
    ['var w=p.rec[0], l=p.rec[1], t=p.rec[2];', 'how the card reads the team record changed'],
    ["ordSuffix(a.r)+' in the NFL in ')+a.s+when)", 'how the card prints league ranks changed'],
    ["esc('Drafted '+(p.dy||'')+' — round '+p.dr+', pick '+(p.dp||'?')+(p.dt?' by '+p.dt:''))", 'how the card prints the draft pick changed'],
    ["esc(\"This week's injury report (week \"+p.inj.wk+'): '+p.inj.st", 'how the card prints the injury report changed'],
    ["cell('Height',inFt(m.ht)); cell('Weight',miss(m.wt)?'—':Math.round(m.wt));", 'how the card prints height and weight changed'],
    ["var title=smp.ok?'':('Only '+Math.round(smp.n)+' '+(CFG.denoms[m.den]||m.den)+' — below the '", 'what a low-sample bar says about its sample changed'],
  ]
  for (const [text, why] of pinned) assert.ok(html.includes(text), why)
})

test('the two data files are merged the way the page merges them', () => {
  load()
  assert.deepEqual(meta.seasons, [...seasons], 'season list')
  assert.equal(meta.latestSeason, seasons[0])
  const top = page.data.data[seasons[0]]
  assert.deepEqual(meta.live, top.week ? { season: seasons[0], week: top.week, weekPlaying: top.weekPlaying || null } : null, 'the season in progress')
  for (const s of seasons) {
    const block = page.data.data[s]
    assert.equal(seasonFile(s).week, block.week || null, `${s}: week`)
    assert.equal(seasonFile(s).players.length, block.players.length, `${s}: player count`)
    // The season in progress must be the twice-daily file's, not the archive's stale copy.
    const fromCurrent = current.data[s] === block
    assert.equal(seasonFile(s).generated, fromCurrent ? current.generated : archive.generated, `${s}: which file it came from`)
  }
  assert.ok(Object.keys(current.data).every((s) => page.data.data[s] === current.data[s]), 'the current file is expected to be the newer one in this checkout')
  assert.equal(meta.generated, current.generated)

  // The same rule on small made-up files, including the cases the real ones do not reach.
  const cfgA = { ...archive.cfg, tag: 'A' }
  const cfgB = { ...archive.cfg, tag: 'B' }
  const a = (generated, cfg = cfgA) => ({ generated, cfg, data: { 2024: { players: [], tag: 'a24' }, 2025: { players: [], tag: 'a25' } } })
  const b = (generated, cfg = cfgB) => ({ generated, cfg, data: { 2025: { players: [], week: 3, tag: 'b25' }, 2026: { players: [], tag: 'b26' } } })
  const cases = [
    [a('2026-09-01'), b('2026-10-01')],   // the usual: the current file is newer
    [a('2026-10-01'), b('2026-09-01')],   // a stale current file must not paper over the archive
    [a('2026-10-01'), b('2026-10-01')],   // a tie goes to the current file
    [a(undefined), b('2026-09-01')],
    [a('2026-10-01'), b(undefined)],
    [a('2026-10-01', undefined), b('2026-09-01')],
    [a('2026-10-01'), null],
    [a('2026-10-01'), { generated: '2026-11-01' }],
  ]
  for (const [base, cur] of cases) {
    const mine = mergeData(base, cur)
    const theirs = page.mergeData(structuredClone(base), structuredClone(cur))
    const where = `${base.generated} + ${cur && cur.generated}`
    assert.deepEqual(mine.seasons, [...(theirs.seasons || Object.keys(theirs.data).sort((x, y) => +y - +x))], `${where}: seasons`)
    for (const s of mine.seasons) assert.equal(mine.data[s].tag, theirs.data[s].tag, `${where}: season ${s}`)
    assert.equal((mine.cfg || {}).tag, (theirs.cfg || {}).tag, `${where}: stat table`)
  }
})

test('every bar on every card matches the page: which stats, the value as printed, both percentiles, the low-sample mark', async () => {
  load()
  const { display } = await import('../../api/_football.js')
  let cards = 0
  let bars = 0
  let empty = 0
  page.rankAgainst('season')
  for (const season of seasons) {
    const file = seasonFile(season)
    const rows = new Map(file.players.map((r) => [r.id, r]))
    for (const p of page.data.data[season].players) {
      const row = rows.get(p.id)
      const who = `${season} ${p.name} (${p.id})`
      assert.ok(row, `${who} is missing`)
      assert.equal(row.pos, p.pos, `${who}: position`)
      assert.equal(row.qualified, !!p.qualified, `${who}: qualified`)
      const card = drawn(p, season)
      cards++
      if (!card.rows.length) empty++
      // The same bars, in the same order, and nothing else.
      assert.deepEqual(Object.keys(row.m), card.rows.map((r) => r.key), `${who}: which bars the card has`)
      const off = (page.cfg.panels[p.pos] || ['ctx']).filter((g) => !card.panels.includes(g))
      assert.deepEqual(row.off || [], off, `${who}: panels the page leaves off`)
      for (const r of card.rows) {
        const cell = row.m[r.key]
        const m = metricOf.get(r.key)
        assert.equal(cell[0], p.m[r.key] + 0, `${who} ${r.key}: value`)   // + 0: the source has a few -0
        assert.equal(cell[1], r.pct, `${who} ${r.key}: percentile among ${p.pos} in ${season}`)
        assert.equal((row.low || []).includes(r.key), r.low, `${who} ${r.key}: low-sample mark`)
        assert.equal(r.tag.includes('low sample'), r.low, `${who} ${r.key}: the page's own tag and hollow bar disagree`)
        assert.equal(display(m.unit, cell[0]), r.shown, `${who} ${r.key}: the value as printed`)
        bars++
      }
    }
  }

  // The same cards against the page's other baseline, "All-time".
  page.rankAgainst('all')
  let allTime = 0
  for (const season of seasons) {
    for (const row of seasonFile(season).players) {
      for (const key of Object.keys(row.m)) {
        const m = metricOf.get(key)
        const cell = row.m[key]
        assert.equal(cell[2], page.pctOf(cell[0], page.pool(key, row.pos, season), m.lowerIsBetter), `${season} ${row.name} ${key}: all-time percentile among ${row.pos}`)
        allTime++
      }
    }
  }
  page.rankAgainst('season')
  console.log(`      ${commas(cards)} cards rendered by the page's code; ${commas(bars)} bars compared (value, printed value, season percentile, low-sample mark) and ${commas(allTime)} all-time percentiles: ${commas(bars * 4 + allTime)} values`)
  assert.ok(bars > 1000000, 'suspiciously few bars were compared')
  assert.equal(allTime, bars)
  assert.ok(empty < cards / 100, 'suspiciously many cards have no bars')
})

test('profile scores and peak seasons are the page\'s', () => {
  load()
  const rows = new Map(index.players.map((r) => [r[0], r]))
  const arcs = new Map()
  let peaks = 0
  for (const e of page.names) {
    const arc = page.arc(e.id)
    arcs.set(e.id, arc)
    assert.equal(rows.get(e.id)[7], arc.peak ? +arc.peak.season : 0, `${e.name}: peak season`)
    if (arc.peak) peaks++
  }
  let scored = 0
  for (const season of seasons) {
    for (const row of seasonFile(season).players) {
      const arc = arcs.get(row.id)
      const pt = arc.pts.find((x) => x.season === season)
      assert.equal(pt.score, page.score(row.id, season), `${season} ${row.name}: the arc and profileScore() disagree`)
      // The page prints the score on the career-arc button, which it hides for a one-season player.
      const expect = pt.score != null && arc.pts.length >= 2 ? Math.round(pt.score) : undefined
      assert.equal(row.score, expect, `${season} ${row.name}: profile score`)
      if (expect != null) scored++
    }
  }
  console.log(`      ${commas(scored)} profile scores and ${commas(peaks)} peak seasons compared`)
  assert.ok(scored > 20000)
})

test('pool sizes and stats not charted yet are the page\'s', () => {
  load()
  const positions = Object.keys(page.cfg.posLabel)
  page.rankAgainst('season')
  for (const season of seasons) {
    page.show(page.data.data[season].players[0], season)
    for (const pos of positions) {
      assert.equal(seasonFile(season).pools[pos] || 0, page.poolCount(pos), `${season} ${pos}: pool size`)
      assert.equal(meta.pools[season][pos] || 0, page.poolCount(pos), `${season} ${pos}: pool size in meta`)
      // notYet(): tracked by the era, but nobody in the season has one.
      for (const g of page.cfg.panels[pos]) {
        const mine = meta.metrics.filter((m) => m.group === g && m.positions.includes(pos) && seasonFile(season).notYet.includes(m.key)).map((m) => m.label)
        assert.deepEqual(mine, [...page.notYet(g, pos, season)], `${season} ${pos} ${g}: not charted yet`)
      }
    }
  }
  page.rankAgainst('all')
  for (const pos of positions) assert.equal(meta.pools.all[pos] || 0, page.poolCount(pos), `${pos}: all-time pool size`)
  page.rankAgainst('season')

})

test('the glossary, the positions and the index are consistent with the page and the data', () => {
  load()
  assert.deepEqual(meta.metrics.map((m) => m.key), page.cfg.metrics.map((m) => m.key))
  for (const m of meta.metrics) {
    const src = page.cfg.metrics.find((x) => x.key === m.key)
    assert.equal(m.lowerIsBetter, !!src.lower)
    assert.equal(m.since, src.since)
    assert.equal(m.lowSampleBelow, src.thr || null)
    assert.deepEqual(m.positions, [...src.pos])
    assert.ok(meta.units[m.unit], `unit "${m.unit}" has no description`)
    assert.ok(meta.groups[m.group], `group "${m.group}" has no label`)
    assert.ok(!m.den || meta.denoms[m.den], `denominator "${m.den}" has no word`)
  }
  for (const [pos, def] of Object.entries(meta.positions)) {
    assert.equal(def.label, page.cfg.posLabel[pos])
    assert.equal(def.peers, page.cohortWord[pos], `${pos}: the word for its pool`)
    assert.equal(def.cannotSee, page.gaps[pos] || null, `${pos}: what the page cannot see`)
    assert.deepEqual(def.panels, [...page.cfg.panels[pos]])
    assert.deepEqual([def.qualify.den, def.qualify.min], [...page.cfg.qualify[pos]])
  }
  assert.deepEqual(Object.keys(meta.positions), Object.keys(page.cfg.posLabel))
  assert.deepEqual(meta.panelFloor, JSON.parse(JSON.stringify(page.floors)))

  assert.deepEqual(index.cols, ['id', 'name', 'pos', 'team', 'from', 'to', 'seasons', 'peak', 'skip'])
  assert.equal(index.count, page.names.length)
  assert.equal(index.players.length, page.names.length)
  const rows = new Map(index.players.map((r) => [r[0], r]))
  for (const e of page.names) {
    const r = rows.get(e.id)
    assert.ok(r, `${e.name} is not in the index`)
    const mine = page.seasonsOf(e.id)
    const last = e.rows[mine[mine.length - 1]]
    assert.deepEqual([r[1], r[2], r[3]], [last.name, last.pos, last.team || null], `${e.name}: name, position and team of his last season`)
    assert.deepEqual([r[4], r[5], r[6]], [+mine[0], +mine[mine.length - 1], mine.length], `${e.name}: span`)
    const skip = []
    for (let y = +mine[0]; y <= +mine[mine.length - 1]; y++) if (!mine.includes(String(y))) skip.push(y)
    assert.deepEqual(r[8] || [], skip, `${e.name}: missed seasons`)
  }
})

// ---- 2. the tools --------------------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// The site's CDN: the three kinds of file, and the homepage for anything else (which is
// what the live catch-all rewrite does, with a 200).
let hits = 0
const cdn = http.createServer((req, res) => {
  hits++
  load()
  const p = decodeURIComponent(req.url).replace(`/${BASE}/`, '')
  const season = p.match(/^seasons\/(\d{4})\.json$/)
  const body = p === 'meta.json' ? json.meta : p === 'players.json' ? json.players : season ? json.seasons[season[1]] : null
  // connection: close, so that no idle socket is left for the next fetch to trip over. (The
  // big loop below goes seconds between fetches, and a kept-alive socket times out in five.)
  if (!body) { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(body)
})

let savant
before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  savant = { ...(await import('../../api/_core.js')), ...(await import('../../api/_football.js')) }
})
after(() => cdn.close())

const tool = (name) => savant.tools.find((t) => t.name === name)
const failure = async (args) => {
  try { await savant.playerProfile(args) } catch (e) { return e }
  assert.fail(`${JSON.stringify(args)} should not have an answer`)
}
// A message for the person asking: no stack trace, no file path, no internal address.
const clean = (e, args) => {
  assert.ok(e instanceof savant.SavantError, `${JSON.stringify(args)}: ${e && e.stack}`)
  assert.doesNotMatch(e.message, /ECONNREFUSED|127\.0\.0\.1|localhost|\.m?js\b|\bat .+:\d+|undefined|\[object/, JSON.stringify(args))
  return e.message
}
const cardLink = (id, season) => `https://wcehoops.com/football-savant.html#p=${id}&s=${season}`

test('the section declares its tools the way the connector expects', () => {
  load()
  assert.deepEqual(savant.tools.map((t) => t.name), ['nfl_search_players', 'nfl_get_player_profile', 'nfl_get_leaderboard', 'nfl_compare_players', 'nfl_get_player_career', 'nfl_list_stats'])
  for (const t of savant.tools) {
    assert.equal(typeof t.run, 'function')
    assert.ok(t.config.title && t.config.annotations.title, `${t.name}: title`)
    assert.ok(t.config.description.length > 80, `${t.name}: description`)
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(t.config.annotations[k], savant.READ_ONLY[k], `${t.name}: ${k}`)
    }
    for (const [k, shape] of Object.entries(t.config.inputSchema)) assert.ok(shape.description, `${t.name}.${k}: described`)
    assert.ok(Object.keys(t.config.outputSchema).length, `${t.name}: output schema`)
  }
  // What the descriptions and the `group` input promise has to stay true of the data.
  assert.equal(meta.seasons[meta.seasons.length - 1], '1999', 'the descriptions say 1999')
  assert.deepEqual(Object.values(savant.GROUPS).sort(), Object.keys(meta.groups).sort(), 'the group input and the page\'s panels differ')
  assert.deepEqual(meta.caveats.lineGames, { positions: ['OL', 'OT', 'OG', 'OC'], before: 2013 }, 'the lineman caution')

  // Inputs are bounded: sample inputs pass, out-of-range ones are refused by the schema.
  const search = z.object(tool('nfl_search_players').config.inputSchema)
  const profile = z.object(tool('nfl_get_player_profile').config.inputSchema)
  assert.deepEqual(search.parse({ query: '  Mahomes ' }), { query: 'Mahomes', limit: 10 })
  assert.deepEqual(profile.parse({ player: 'Lamar Jackson' }), { player: 'Lamar Jackson', group: 'all' })
  assert.deepEqual(profile.parse({ player: '00-0034796', season: '2024', group: 'rushing' }), { player: '00-0034796', season: '2024', group: 'rushing' })
  for (const g of Object.keys(savant.GROUPS)) assert.ok(profile.safeParse({ player: 'x', group: g }).success, g)
  for (const bad of [{ query: 'x' }, { query: 'a'.repeat(81) }, { query: 'Mahomes', limit: 0 }, { query: 'Mahomes', limit: 26 }, { query: 'Mahomes', limit: 2.5 }, {}]) {
    assert.ok(!search.safeParse(bad).success, JSON.stringify(bad))
  }
  for (const bad of [{ player: '' }, { player: 'a'.repeat(81) }, { player: 'x', group: 'defense' }, { player: 'x', season: '2024-2025-2026' }, { season: '2024' }]) {
    assert.ok(!profile.safeParse(bad).success, JSON.stringify(bad))
  }
  const board = z.object(tool('nfl_get_leaderboard').config.inputSchema)
  assert.deepEqual(board.parse({ position: 'QB' }), { position: 'QB', limit: 10, order: 'top', sample: 'settled' })
  assert.deepEqual(board.parse({ stat: 'rushing yards', season: '2024', limit: 5 }), { stat: 'rushing yards', season: '2024', limit: 5, order: 'top', sample: 'settled' })
  for (const bad of [{ position: 'QB', limit: 26 }, { position: 'QB', order: 'sideways' }, { position: 'QB', sample: 'some' }]) assert.ok(!board.safeParse(bad).success, JSON.stringify(bad))
  const compare = z.object(tool('nfl_compare_players').config.inputSchema)
  assert.ok(compare.safeParse({ players: ['a', 'b'] }).success)
  for (const bad of [{ players: ['a'] }, { players: ['a', 'b', 'c', 'd', 'e'] }, { players: ['a', 'b'], group: 'defense' }, { players: ['a', 'b'], stats: Array(13).fill('x') }]) assert.ok(!compare.safeParse(bad).success, JSON.stringify(bad))
  const career = z.object(tool('nfl_get_player_career').config.inputSchema)
  assert.ok(career.safeParse({ player: 'a' }).success && !career.safeParse({ player: 'a', stats: Array(9).fill('x') }).success)
})

test('a profile says what the files say, for every player in every season, and fits its declared shape', async () => {
  load()
  const shape = z.object(tool('nfl_get_player_profile').config.outputSchema).strict()
  const lineman = meta.caveats.lineGames
  let profiles = 0
  let cells = 0
  let longest = { length: 0 }
  for (const season of meta.seasons) {
    const file = seasonFile(season)
    const source = new Map(page.data.data[season].players.map((p) => [p.id, p]))
    for (const row of file.players) {
      const { structured: s, text } = await tool('nfl_get_player_profile').run({ player: row.id, season, group: 'all' })
      const who = `${season} ${row.name} (${row.id})`
      profiles++
      shape.parse(s)
      const pos = meta.positions[row.pos]
      assert.deepEqual([s.player.id, s.player.name, s.player.position_code, s.player.position, s.player.qualified, s.season],
        [row.id, row.name, row.pos, pos.label, row.qualified, season], who)
      assert.deepEqual(s.pools, { position_label: pos.peers, season: file.pools[row.pos] || 0, all_time: meta.pools.all[row.pos] || 0 }, `${who}: pools`)
      // Every bar in the file is in the profile, in the card's order, and nothing else is.
      assert.deepEqual(s.stats.map((x) => x.key), Object.keys(row.m), `${who}: stat list`)
      for (const x of s.stats) {
        const cell = row.m[x.key]
        const m = metricOf.get(x.key)
        const isLow = (row.low || []).includes(x.key)
        assert.deepEqual([x.value, x.season_percentile, x.all_time_percentile, x.low_sample, x.lower_is_better],
          [cell[0], cell[1], cell[2], isLow, m.lowerIsBetter], `${who} ${x.key}`)
        assert.deepEqual(x.sample, isLow ? { have: row.d[m.den], needed: m.lowSampleBelow, of: meta.denoms[m.den] } : null, `${who} ${x.key}: sample`)
        cells++
      }
      const untracked = pos.panels.flatMap((g) => meta.metrics.filter((m) => m.group === g && m.positions.includes(row.pos) && +season < m.since).map((m) => m.key))
      assert.deepEqual(s.not_tracked.map((m) => m.key), untracked, `${who}: not tracked`)
      assert.ok(s.not_tracked.every((m) => !row.m[m.key]), `${who}: a stat is both shown and not tracked`)
      assert.equal(s.profile_score ? s.profile_score.score : undefined, row.score, `${who}: profile score`)

      // The facts in the first lines are the data's own, field for field.
      const p = source.get(row.id)
      assert.deepEqual([s.player.team, s.player.age, s.player.experience, s.player.college], [p.team || null, p.age ?? null, p.exp ?? null, p.college || null], `${who}: team, age, experience, college`)
      assert.deepEqual(s.player.teams, p.tms && p.tms.length > 1 ? p.tms : p.team ? [p.team] : [], `${who}: teams`)
      assert.deepEqual(s.player.draft, p.dr ? { round: p.dr, pick: p.dp ?? null, year: p.dy ?? null, team: p.dt ?? null } : null, `${who}: draft`)
      assert.equal(s.player.undrafted, !p.dr && !!p.udfa, `${who}: undrafted`)
      assert.equal(s.player.height, row.m.ht ? page.fmt('ftin', p.m.ht) : null, `${who}: height`)
      assert.deepEqual(s.team_season, p.rec ? { wins: p.rec[0], losses: p.rec[1], ties: p.rec[2], result: p.po || null, coach: p.coach || null } : null, `${who}: team record`)
      assert.deepEqual(s.league_ranks, (p.acc || []).map((a) => ({ rank: a.r, stat: a.s })), `${who}: league ranks`)
      assert.deepEqual(s.injury, p.inj ? { status: p.inj.st, injury: p.inj.inj || null, week: p.inj.wk ?? null } : null, `${who}: injury report`)
      for (const d of s.sample) assert.deepEqual([d.value, d.label], [p.d[d.key], page.cfg.denoms[d.key]], `${who}: sample ${d.key}`)
      assert.equal(s.sample[0].key, 'g', `${who}: games come first`)

      // Comps and flaws are the page's own, names and all.
      assert.deepEqual((s.comps || []).map((c) => [c.id, c.name, c.team || '', c.match]), (p.comps || []).map((c) => [c.id, c.name, c.team, c.score]), `${who}: comps`)
      assert.deepEqual((s.weakness_comps || []).map((c) => [c.id, c.name, c.team || '', c.match]), (p.wcomps || []).map((c) => [c.id, c.name, c.team, c.score]), `${who}: weakness comps`)
      assert.deepEqual((s.weakest || []).map((f) => [f.key, f.percentile]), (p.wflaws || []).map((f) => [f.k, f.pct]), `${who}: where he ranks worst`)

      // The words carry the same thing: the pool by name, the link, and every caution.
      assert.equal(s.url, cardLink(row.id, season))
      assert.ok(text.includes(s.url), `${who}: the text links the card`)
      if (s.stats.length) assert.ok(text.includes(`vs. ${pos.peers}: `), `${who}: the text names the pool`)
      for (const note of s.notes) assert.ok(text.includes(note), `${who}: a note is missing from the text: ${note.slice(0, 60)}`)
      assert.ok(s.notes[0].includes(`qualified ${pos.peers} only`), `${who}: the first note names the pool`)
      assert.equal(/below the qualifying line/.test(text), !row.qualified, `${who}: the unqualified caution`)
      assert.equal(/still being played/.test(text), !!file.week, `${who}: the in-progress caution`)
      if (file.week) {
        assert.ok(text.split('\n')[0].includes(`through week ${file.week}`), `${who}: the first line says through which week`)
        assert.equal(s.in_progress.through_week, file.week)
      } else assert.equal(s.in_progress, null)
      assert.equal(/Caution for offensive linemen/.test(text), lineman.positions.includes(row.pos) && +season < lineman.before, `${who}: the lineman caution`)
      assert.equal(/"low sample" marks/.test(text), s.stats.some((x) => x.low_sample), `${who}: the low-sample explanation`)
      if ((file.pools[row.pos] || 0) < 2) assert.ok(s.stats.every((x) => x.season_percentile == null) && /shown as n\/a/.test(text), `${who}: an empty pool`)
      if (text.length > longest.length) longest = { length: text.length, who }
    }
  }
  console.log(`      ${commas(profiles)} profiles, ${commas(cells)} stats; the longest answer is ${commas(longest.length)} characters (${longest.who})`)
  assert.equal(profiles, index.players.reduce((n, r) => n + r[6], 0))
  assert.ok(longest.length < 12000, `an answer runs to ${longest.length} characters`)
})

test('a group is one panel of the card, and a panel the position lacks is said to be lacking', async () => {
  load()
  const labelOf = Object.fromEntries(Object.entries(savant.GROUPS).map(([name, g]) => [name, meta.groups[g]]))
  let checked = 0
  for (const season of [meta.seasons[0], '2019', '2003']) {
    const seen = new Set()
    for (const row of seasonFile(season).players) {
      if (seen.has(row.pos)) continue
      seen.add(row.pos)
      const all = (await savant.playerProfile({ player: row.id, season })).structured
      for (const name of Object.keys(savant.GROUPS)) {
        const { structured: s, text } = await savant.playerProfile({ player: row.id, season, group: name })
        assert.deepEqual(s.stats, all.stats.filter((x) => x.group === labelOf[name]), `${season} ${row.name} ${name}`)
        assert.equal(s.comps, undefined, 'comps stay home when one panel is asked for')
        if (!meta.positions[row.pos].panels.includes(savant.GROUPS[name])) assert.match(text, /card has no .* panel\. It has: /)
        checked++
      }
    }
    assert.ok(seen.size >= 12, `${season}: only ${seen.size} positions were seen`)
  }
  assert.ok(checked > 400)
})

test('position is the one he played that season, and every team he played for is named', async () => {
  load()
  // A lineman who moved: ranked as a guard one year and a tackle another.
  const spots = new Map() // id -> the line spots he has qualified at
  for (const s of meta.seasons) {
    for (const p of seasonFile(s).players) {
      if (!p.qualified || (p.pos !== 'OG' && p.pos !== 'OT')) continue
      if (!spots.has(p.id)) spots.set(p.id, new Set())
      spots.get(p.id).add(p.pos)
    }
  }
  const moved = [...spots.keys()].find((id) => spots.get(id).size === 2)
  assert.ok(moved, 'no lineman in the data has qualified at both guard and tackle')
  const labels = new Set()
  for (const s of meta.seasons) {
    const row = seasonFile(s).players.find((p) => p.id === moved)
    if (!row) continue
    const { structured, text } = await savant.playerProfile({ player: moved, season: s, group: 'blocking' })
    assert.equal(structured.pools.position_label, meta.positions[row.pos].peers)
    assert.equal(structured.pools.season, seasonFile(s).pools[row.pos] || 0)
    if (structured.stats.length) assert.ok(text.includes(`vs. ${meta.positions[row.pos].peers}: `))
    labels.add(structured.pools.position_label)
  }
  assert.ok(labels.has('guards') && labels.has('offensive tackles'), [...labels].join(', '))

  // A man traded in season: the card names both clubs, in order.
  const traded = seasonFile('2025').players.find((p) => p.tms && p.tms.length > 1)
  const { structured, text } = await savant.playerProfile({ player: traded.id, season: '2025', group: 'context' })
  assert.deepEqual(structured.player.teams, traded.tms)
  assert.equal(structured.player.team, traded.team)
  assert.ok(text.split('\n')[0].includes(traded.tms.join(' → ')))
})

test('search finds players the way people type their names', async () => {
  load()
  const shape = z.object(tool('nfl_search_players').config.outputSchema).strict()
  const find = async (query, limit) => {
    const r = await tool('nfl_search_players').run({ query, limit })
    shape.parse(r.structured)
    return r
  }
  const first = async (query) => (await find(query)).structured.players[0]?.name
  assert.equal(await first('Patrick Mahomes'), 'Patrick Mahomes')
  assert.equal(await first('mahomes'), 'Patrick Mahomes')
  assert.equal(await first('TJ Watt'), 'T.J. Watt')                    // punctuation
  assert.equal(await first('jamarr chase'), "Ja'Marr Chase")           // apostrophe
  assert.equal(await first('amon ra st brown'), 'Amon-Ra St. Brown')   // hyphen and full stop
  assert.equal(await first('Audric Estime'), 'Audric Estimé')          // accent
  assert.equal(await first('AUDRIC ESTIMÉ'), 'Audric Estimé')
  assert.equal(await first('Patrick Mahommes'), 'Patrick Mahomes')     // typo
  assert.equal(await first('Jalen Hurtz'), 'Jalen Hurts')              // typo
  assert.equal(await first('Kenneth Murray Jr'), 'Kenneth Murray, Jr.') // a comma in the data
  // A shared name comes back as separate men, most recent first, each with his own link.
  const jones = await find('Chris Jones')
  const same = jones.structured.players.filter((p) => p.name === 'Chris Jones')
  assert.ok(same.length >= 4)
  assert.equal(new Set(same.map((p) => p.id)).size, same.length)
  assert.equal(same[0].last_season, meta.latestSeason)
  assert.match(jones.text, /different men/)
  for (const p of jones.structured.players) {
    assert.equal(p.url, cardLink(p.id, p.last_season))
    assert.ok(jones.text.includes(p.url))
    const r = index.players.find((x) => x[0] === p.id)
    assert.deepEqual([p.name, p.position, p.team, +p.first_season, +p.last_season, p.seasons], [r[1], meta.positions[r[2]].label, r[3], r[4], r[5], r[6]])
  }
  const many = await find('smith', 7)
  assert.equal(many.structured.count, 7)
  assert.ok(many.structured.total > 7)
  assert.match(many.text, /showing the first 7/)
  const none = await find('zzzzqq')
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No player in Football Savant matches/)
})

test('a shared name lists the candidates with their ids, and a season settles it where it can', async () => {
  load()
  const shared = clean(await failure({ player: 'Chris Jones' }), 'Chris Jones')
  assert.match(shared, /4 players match "Chris Jones"/)
  for (const id of ['00-0032762', '00-0034641', '00-0028664', '00-0030106']) assert.ok(shared.includes(`id ${id}`), id)
  assert.match(shared, /Interior D-line, 2016 to 2026, last team KC/)
  assert.match(shared, /Punter, 2011 to 2020, last team DAL/)
  assert.match(shared, /Giving the season also settles it/)
  // Only the punter had stats in 2012; only the defensive tackle in 2023.
  assert.equal((await savant.playerProfile({ player: 'Chris Jones', season: '2012', group: 'kicking' })).structured.player.id, '00-0028664')
  assert.equal((await savant.playerProfile({ player: 'Chris Jones', season: '2023', group: 'context' })).structured.player.id, '00-0032762')
  // Three of them played in 2019, so the season narrows the list but cannot choose.
  const three = clean(await failure({ player: 'Chris Jones', season: '2019' }), '2019')
  assert.match(three, /3 players with stats in 2019 match "Chris Jones"/)
  assert.ok(!three.includes('00-0030106'))
  // The quarterback and a cornerback of the same name: never quietly the famous one.
  const lamar = clean(await failure({ player: 'Lamar Jackson' }), 'Lamar Jackson')
  assert.match(lamar, /Quarterback/)
  assert.match(lamar, /Cornerback/)
  assert.equal((await savant.playerProfile({ player: 'Lamar Jackson', season: '2019', group: 'context' })).structured.player.position, 'Quarterback')
  // An id is never ambiguous, and a unique name needs no id.
  assert.equal((await savant.playerProfile({ player: '00-0034796', group: 'context' })).structured.player.name, 'Lamar Jackson')
  assert.equal((await savant.playerProfile({ player: 'patrick mahomes', group: 'context' })).structured.player.name, 'Patrick Mahomes')
  assert.equal((await savant.playerProfile({ player: 'Odell Beckham', season: '2014', group: 'context' })).structured.player.name, 'Odell Beckham Jr.')
  // A near spelling never opens a card on its own, even when only one man is close: he is
  // named with his id instead, because a name one letter off may belong to someone who is
  // not in the data. Search still finds him.
  const hurtz = clean(await failure({ player: 'Jalen Hurtz' }), 'Jalen Hurtz')
  assert.match(hurtz, /"Jalen Hurtz" is not an exact match\. Call again with one of these ids:\n- Jalen Hurts \(id /)
  assert.equal((await savant.searchPlayers({ query: 'Jalen Hurtz', limit: 5 })).structured.players[0].name, 'Jalen Hurts')
  const typo = clean(await failure({ player: 'Brandon Marshal' }), 'Brandon Marshal')
  assert.match(typo, /2 players match "Brandon Marshal"/)
  assert.match(typo, /Wide receiver, 2006 to 2018/)
  assert.match(typo, /Linebacker, 2012 to 2018/)
  // A surname alone is hundreds of men: a few are listed, and the rest are counted.
  const smith = clean(await failure({ player: 'Smith' }), 'Smith')
  assert.match(smith, /\d+ players match "Smith"/)
  assert.match(smith, /\(\d+ more not shown/)
  assert.ok(smith.length < 1500)
})

test('questions that cannot be answered say what to try', async () => {
  load()
  const mahomes = index.players.find((r) => r[1] === 'Patrick Mahomes')
  const gap = index.players.find((r) => r[8] && r[8].length)
  const cases = [
    [{ player: '99-9999999' }, /No player has the id "99-9999999"\. Search by name/],
    [{ player: '12345' }, /No player has the id/],
    [{ player: 'Qwertyuiop Asdfgh' }, /No player matches "Qwertyuiop Asdfgh"/],
    [{ player: 'Patrick Mahomes', season: '1998' }, /has no 1998 season\. It covers 1999 through/],
    [{ player: 'Patrick Mahomes', season: '2040' }, /has no 2040 season/],
    [{ player: 'Patrick Mahomes', season: 'last year' }, /is not an NFL season\. Give the year the season began/],
    [{ player: 'Patrick Mahomes', season: '2024-26' }, /is not an NFL season/],
    [{ player: 'Patrick Mahomes', season: String(mahomes[4] - 1) }, new RegExp(`has no stats in ${mahomes[4] - 1}; it is outside his years in the data\\. Football Savant has him in ${mahomes[4]}-`)],
    [{ player: gap[0], season: String(gap[8][0]) }, /has no stats in \d{4}; he may not have played that season\. Football Savant has him in /],
  ]
  for (const [args, expect] of cases) assert.match(clean(await failure(args), args), expect, JSON.stringify(args))
  // "2024-25" and "2024/25" are the 2024 season.
  for (const season of ['2024', '2024-25', '2024/25', '2024-2025', ' 2024 ']) {
    assert.equal((await savant.playerProfile({ player: 'Patrick Mahomes', season, group: 'context' })).structured.season, '2024', season)
  }
})

test('files are fetched once and reused; when the data is down the answer says so plainly', async () => {
  load()
  savant.clearCache()
  const start = hits
  await savant.playerProfile({ player: '00-0034796', season: '2024' })
  await savant.playerProfile({ player: '00-0034796', season: '2024', group: 'rushing' })
  await savant.searchPlayers({ query: 'lamar jackson' })
  assert.equal(hits - start, 3, 'meta, players and one season: three fetches for three calls')

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // A season file that is not there comes back as the homepage, with a 200.
    savant.clearCache()
    const real = json.seasons['2010']
    delete json.seasons['2010']
    const gone = await failure({ player: 'Peyton Manning', season: '2010' })
    json.seasons['2010'] = real
    assert.match(clean(gone, 'missing file'), /Football Savant data could not be loaded right now/)

    // The whole origin is unreachable.
    savant.clearCache()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    const down = await failure({ player: 'Lamar Jackson', season: '2024' })
    assert.match(clean(down, 'origin down'), /could not be loaded right now\. Try again in a minute\./)
    let search
    try { await savant.searchPlayers({ query: 'mahomes' }) } catch (e) { search = e }
    assert.match(clean(search, 'origin down, search'), /could not be loaded right now/)
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    savant.clearCache()
  }
  assert.equal((await savant.searchPlayers({ query: 'mahomes' })).structured.players[0].name, 'Patrick Mahomes')
})

// ---- 3. beyond one card ----------------------------------------------------------------

// The page's stabilization rule (its sampleOf()), on the page's own merged data.
const settledOn = (p, m) => !(m.thr && m.den && (p.d || {})[m.den] != null && p.d[m.den] < m.thr)

// The page's Leaderboard Builder: lbPool() keeps the season's qualified players at one
// position; lbRender() drops anyone without the stat or (Sample: Settled, its default) with
// too little of the stat's denominator, and sorts. Worked out here from the page's own merged
// data and stat table, never from the files under test, and compared row for row.
test('a position leaderboard is the page\'s Leaderboard Builder: same pool, same order', async () => {
  load()
  const byKey = new Map(page.cfg.metrics.map((m) => [m.key, m]))
  let boards = 0
  let fellBack = 0
  for (const season of [meta.latestSeason, '2024', '2015', '2003']) {
    const players = page.data.data[season].players
    for (const pos of Object.keys(meta.positions)) {
      const mine = page.cfg.metrics.filter((m) => m.pos.includes(pos) && !['ath', 'ctx'].includes(m.grp))
      const head = (page.cfg.headline[pos] || [])[0]
      for (const key of [...new Set([head, ...mine.filter((_, i) => i % 9 === 4).map((m) => m.key)])].filter(Boolean)) {
        const m = byKey.get(key)
        if (+season < m.since) {
          await assert.rejects(() => savant.leaderboard({ position: pos, stat: key, season }), (e) => e instanceof savant.SavantError && e.message.includes(`tracked from ${m.since}`))
          continue
        }
        const pool = players.filter((p) => p.pos === pos && p.qualified && !page.miss(p.m[key]))
        const settled = pool.filter((p) => settledOn(p, m))
        const sort = (list) => list.map((p) => [p.id, p.m[key]]).sort((a, b) => (m.lower ? a[1] - b[1] : b[1] - a[1]))
        const { structured: st, text } = await savant.leaderboard({ position: pos, stat: key === head ? undefined : key, season, limit: 25 })
        boards++
        assert.equal(st.stat.key, key, `${season} ${pos}: the stat it opens on is the page's`)
        assert.equal(st.position, meta.positions[pos].label)
        // With nobody settled (the first weeks of a season) the board lists everyone and says so.
        const expected = settled.length || !pool.length ? settled : pool
        assert.equal(st.fell_back_to_everyone, !settled.length && pool.length > 0, `${season} ${pos} ${key}`)
        if (st.fell_back_to_everyone) { fellBack++; assert.match(text, /so this lists every qualified player and every place is on a low sample/) }
        assert.equal(st.ranked, expected.length, `${season} ${pos} ${key}: who is ranked`)
        assert.equal(st.hidden_low_sample, st.fell_back_to_everyone ? 0 : pool.length - settled.length)
        assert.deepEqual(st.leaders.map((l) => [l.id, l.value]), sort(expected).slice(0, 25), `${season} ${pos} ${key}`)
        for (const l of st.leaders) {
          assert.equal(l.rank, 1 + expected.filter((p) => (m.lower ? p.m[key] < l.value : p.m[key] > l.value)).length)
          // The value prints as the page prints it, and the percentile is the card's. A man
          // whose whole panel the page leaves off his card is still on the page's board: he is
          // listed, marked, with no percentile, because his card has no such bar.
          assert.equal(l.display, page.fmt(m.unit, l.value))
          const src = players.find((p) => p.id === l.id)
          assert.equal(l.on_card, page.panelWorthIt(m.grp, src, pos), `${season} ${pos} ${key} ${l.name}: on his card`)
          const cell = seasonFile(season).players.find((p) => p.id === l.id).m[key]
          assert.deepEqual([l.season_percentile, l.all_time_percentile], cell ? [cell[1], cell[2]] : [null, null])
          assert.equal(l.low_sample, !settledOn(src, m))
        }
        if (expected.length) assert.ok(text.includes(`${meta.positions[pos].label}s by ${m.label}, ${season}`), text.slice(0, 120))
      }
    }
  }
  assert.ok(boards > 150, `${boards} boards`)
  assert.ok(fellBack > 0, 'the season in progress should have at least one board with nobody settled yet')

  // "Everyone" lists the thin samples too, marked.
  const m = byKey.get('epadb')
  const all2024 = page.data.data['2024'].players.filter((p) => p.pos === 'QB' && p.qualified && !page.miss(p.m.epadb))
  const everyone = (await savant.leaderboard({ position: 'quarterback', stat: 'EPA / dropback', season: '2024', sample: 'everyone', limit: 25, order: 'bottom' })).structured
  assert.equal(everyone.ranked, all2024.length)
  assert.deepEqual(everyone.leaders.map((l) => l.low_sample), everyone.leaders.map((l) => !settledOn(all2024.find((p) => p.id === l.id), m)))
  assert.equal(everyone.leaders[0].rank, Math.max(...everyone.leaders.map((l) => l.rank)), 'the bottom of the board is numbered from the top, worst first')
  // One team, by name or by code. The link is the page's lbEncode() hash.
  const kc = (await savant.leaderboard({ position: 'WR', stat: 'ypt', season: '2024', team: 'Chiefs' })).structured
  assert.deepEqual(kc, (await savant.leaderboard({ position: 'wide receivers', stat: 'ypt', season: '2024', team: 'kc' })).structured)
  assert.ok(kc.leaders.length && kc.leaders.every((l) => l.team === 'KC'))
  // (With one team's receivers nobody may have a settled sample; then the link opens on Everyone.)
  assert.equal(kc.url, `https://wcehoops.com/football-savant.html#lb?s=2024&p=WR&r=ypt&n=10&t=KC${kc.fell_back_to_everyone ? '&x=all' : ''}`)
  assert.ok(html.includes("return '#lb?s='+LB.season+'&p='+LB.pos+'&r='+LB.rank+'&n='+LB.topN") && html.includes("(LB.team?'&t='+LB.team:'')") && html.includes("(LB.sample!=='settled'?'&x=all':'')"))
  // A position is its code, its name, or how a fan says it; without one, the answer says why.
  for (const [said, label] of [['rb', 'Running back'], ['running backs', 'Running back'], ['Edge', 'Edge'], ['corner', 'Cornerback'], ['safeties', 'Safety'], ['tight end', 'Tight end']]) {
    assert.equal((await savant.leaderboard({ position: said, season: '2024', limit: 1 })).structured.position, label, said)
  }
  await assert.rejects(() => savant.leaderboard({ season: '2024' }), /Give a position: Football Savant ranks players only against their own position/)
  await assert.rejects(() => savant.leaderboard({ position: 'goalkeeper' }), /is not a position Football Savant ranks/)
  await assert.rejects(() => savant.leaderboard({ position: 'CB', stat: 'pocket time' }), /No cornerback stat matches "pocket time"/)
})

// The data holds rates, not totals. The page derives a career's counting totals as "a rate
// times the volume that rate was built from" (its CTOT table and careerTotalOf()); a season's
// totals are the same arithmetic on one season. Three things hold that honest: the recipes
// are the page's own; the arithmetic is exact to the rounding; and the totals agree, place
// for place, with the league ranks the pipeline worked out from the real totals.
test('season totals are the page\'s recipes, and agree with the league ranks on the cards', async () => {
  load()
  // The recipes, read here straight off the page's text rather than by running it.
  const src = html.slice(html.indexOf('var CTOT={'), html.indexOf('CTOT.TE=CTOT.WR'))
  const read = {}
  for (const row of src.matchAll(/\n\s{2}(\w+):function\(r\)\{return \[([\s\S]*?)\];\},?/g)) {
    read[row[1]] = [...row[2].matchAll(/\['([^']+)',(careerTotalOf\(r,'(\w+)'(,1)?\)|careerDenomOf\(r,'(\w+)'\)|cflat\(r\.m\.(\w+)\))\]/g)].map((t) => (
      t[3] ? { label: t[1], kind: 'rate', key: t[3], pct: !!t[4] } : t[5] ? { label: t[1], kind: 'count', den: t[5] } : { label: t[1], kind: 'value', key: t[6] }))
  }
  assert.ok(Object.keys(read).length >= 9, 'the page\'s CTOT table could not be read')
  const known = new Set(page.cfg.metrics.map((m) => m.key))
  for (const pos of Object.keys(read)) {
    assert.deepEqual(meta.totals[pos], read[pos].filter((t) => (t.kind === 'count' ? page.cfg.denoms[t.den] : known.has(t.key))), `${pos}: recipes`)
  }
  assert.deepEqual([meta.totals.TE, meta.totals.DI, meta.totals.S, meta.totals.OT], [meta.totals.WR, meta.totals.ED, meta.totals.CB, meta.totals.OL])

  // The arithmetic, on every player-season: rate x volume, and the rates carry enough
  // decimals that the product lands on a whole (or half) number.
  const byKey = new Map(meta.metrics.map((m) => [m.key, m]))
  let derived = 0
  let off = 0
  for (const season of meta.seasons) {
    for (const row of seasonFile(season).players) {
      const totals = savant.totalsOf(meta, row)
      for (const t of totals) {
        const spec = meta.totals[row.pos].find((x) => x.label === t.label)
        if (spec.kind === 'count') { assert.equal(t.value, row.d[spec.den]); assert.equal(t.derived, false); continue }
        if (spec.kind === 'value') { assert.equal(t.value, row.m[spec.key][0]); continue }
        const exact = (row.m[spec.key][0] * row.d[byKey.get(spec.key).den]) / (spec.pct ? 100 : 1)
        assert.ok(Math.abs(exact - t.value) <= 0.25, `${season} ${row.name} ${t.label}: ${exact} vs ${t.value}`)
        derived++
        if (Math.abs(exact - t.value) > 0.06) off++
      }
    }
  }
  assert.ok(derived > 100000, `${derived} derived totals`)
  assert.ok(off / derived < 0.02, `${off} of ${derived} derived totals sit more than 0.06 from a whole or half number`)

  // The league ranks on the cards come from the pipeline's real totals. Every season, every
  // counting stat with a total: a better place never has a smaller total, and a shared place
  // is an equal total.
  let boards = 0
  let compared = 0
  for (const season of meta.seasons) {
    for (const stat of ['passing yards', 'passing TDs', 'pass attempts', 'rushing yards', 'carries', 'receiving yards', 'receptions', 'targets', 'receiving TDs', 'sacks', 'tackles for loss', 'QB hits', 'passes defended', 'interceptions']) {
      let board
      try { board = (await savant.leaderboard({ stat, season, limit: 25 })).structured } catch (e) { if (e instanceof savant.SavantError) continue; throw e }
      assert.equal(board.mode, 'league_leaders', `${season} ${stat}`)
      boards++
      const src2 = page.data.data[season].players
      for (const l of board.leaders) assert.ok(src2.find((p) => p.id === l.id).acc.some((a) => a.s === stat && a.r === l.rank), `${season} ${stat} ${l.name}: the place on his card`)
      const withTotal = board.leaders.filter((l) => l.total != null)
      for (let i = 1; i < withTotal.length; i++) {
        const [a, b] = [withTotal[i - 1], withTotal[i]]
        compared++
        if (a.rank < b.rank) assert.ok(a.total > b.total, `${season} ${stat}: #${a.rank} ${a.name} ${a.total}, #${b.rank} ${b.name} ${b.total}`)
        else assert.equal(a.total, b.total, `${season} ${stat}: tied at #${a.rank}, ${a.name} ${a.total} and ${b.name} ${b.total}`)
      }
    }
  }
  assert.ok(boards > 300 && compared > 2500, `${boards} boards, ${compared} pairs`)

  // And four seasons anyone can look up.
  const line = async (player, season) => Object.fromEntries((await savant.playerProfile({ player, season })).structured.totals.map((t) => [t.label, t.value]))
  assert.deepEqual(await line('Joe Burrow', '2024'), { Games: 17, Att: 652, 'Pass yds': 4918, 'Pass TD': 43, Int: 9, 'Rush yds': 201 })
  assert.deepEqual(await line('Patrick Mahomes', '2022'), { Games: 17, Att: 648, 'Pass yds': 5250, 'Pass TD': 41, Int: 12, 'Rush yds': 358 })
  assert.deepEqual(await line('Tom Brady', '2007'), { Games: 16, Att: 578, 'Pass yds': 4806, 'Pass TD': 50, Int: 8, 'Rush yds': 98 })
  const henry = await line('Derrick Henry', '2024')
  assert.deepEqual([henry.Carries, henry['Rush yds']], [325, 1921])
  const text = (await savant.playerProfile({ player: 'Joe Burrow', season: '2024' })).text
  assert.ok(text.includes('In 2024: 17 Games, 652 Att, 4,918 Pass yds, 43 Pass TD, 9 Int, 201 Rush yds. Derived: see the note on totals.'))
  assert.match(text, /can land a yard or two off the official book/)
})

test('a comparison and a career say what the cards say, and the glossary is the page\'s', async () => {
  load()
  const card = async (player, season, group = 'all') => (await savant.playerProfile({ player, season, group })).structured
  const qbs = seasonFile('2024').players.filter((p) => p.pos === 'QB' && p.qualified).slice(0, 2)
  const cmp = await savant.comparePlayers({ players: qbs.map((p) => p.id), seasons: ['2024'] })
  assert.deepEqual(cmp.structured.stats.map((x) => x.key), meta.positions.QB.headline)
  for (const [i, row] of qbs.entries()) {
    const c = await card(row.id, '2024')
    assert.deepEqual(cmp.structured.players[i].totals, c.totals)
    assert.deepEqual(cmp.structured.players[i].league_ranks, c.league_ranks)
    for (const st of cmp.structured.stats) {
      const on = c.stats.find((x) => x.key === st.key)
      const v = st.values[i]
      assert.deepEqual([v.status, v.value, v.display, v.season_percentile, v.all_time_percentile, v.low_sample], ['ok', on.value, on.display, on.season_percentile, on.all_time_percentile, on.low_sample], `${row.name} ${st.key}`)
      assert.equal(st.what, on.what)
    }
  }
  // Different positions: a stat that is not on the other man's card is said to be, not blanked.
  const rb = seasonFile('2024').players.find((p) => p.pos === 'RB' && p.qualified)
  const mixed = (await savant.comparePlayers({ players: [qbs[0].id, rb.id], seasons: ['2024'], stats: ['epadb', 'ypc'] })).structured
  assert.equal(mixed.stats[0].values[1].status, 'not a running back stat')
  assert.ok(mixed.notes.some((n) => /different positions/.test(n)))
  await assert.rejects(() => savant.comparePlayers({ players: [qbs[0].id, qbs[0].id], seasons: ['2024'] }), /is listed twice/)

  // A career: every season he has, oldest first, each line the card's own.
  const vet = index.players.map((r) => ({ id: r[0], name: r[1], pos: r[2], from: r[4], to: r[5], n: r[6] })).find((r) => r.pos === 'QB' && r.n >= 12 && r.to >= 2022)
  const career = (await savant.playerCareer({ player: vet.id })).structured
  assert.deepEqual(career.seasons.map((x) => x.season), [...page.seasonsOf(vet.id)])
  assert.deepEqual(career.stats.map((x) => x.key), meta.positions[vet.pos].headline)
  for (const sn of career.seasons.filter((_, i) => i % 4 === 0)) {
    const c = await card(vet.id, sn.season)
    assert.deepEqual([sn.team, sn.position, sn.qualified, sn.totals, sn.league_ranks], [c.player.team, c.player.position, c.player.qualified, c.totals, c.league_ranks], `${vet.name} ${sn.season}`)
    assert.equal(sn.profile_score, c.profile_score ? c.profile_score.score : null)
    for (const v of sn.stats) {
      const on = c.stats.find((x) => x.key === v.key)
      if (on) assert.deepEqual([v.status, v.value, v.display, v.season_percentile, v.all_time_percentile], ['ok', on.value, on.display, on.season_percentile, on.all_time_percentile])
      else assert.notEqual(v.status, 'ok')
    }
  }
  assert.equal(career.player.peak_season, String(index.players.find((r) => r[0] === vet.id)[7] || '') || null)
  const part = (await savant.playerCareer({ player: vet.id, from: String(vet.from + 1), to: String(vet.from + 3), stats: ['cpoe', 'Sack rate'] })).structured
  assert.ok(part.seasons.length <= 3 && part.seasons.every((x) => +x.season > vet.from && +x.season <= vet.from + 3))
  assert.deepEqual(part.stats.map((x) => x.key), ['cpoe', 'sackpct'])

  // The glossary: every stat on a position's card, with the data file's own explanation.
  const src = new Map(page.cfg.metrics.map((m) => [m.key, m]))
  for (const pos of ['QB', 'WR', 'CB', 'K']) {
    const g = (await savant.listStats({ position: pos })).structured
    assert.deepEqual(g.stats.map((x) => x.key), meta.positions[pos].panels.flatMap((grp) => meta.metrics.filter((m) => m.group === grp && m.positions.includes(pos)).map((m) => m.key)), pos)
    for (const x of g.stats) {
      const e = src.get(x.key).exp || {}
      assert.deepEqual([x.label, x.what, x.formula, x.why], [src.get(x.key).label, e.w || null, e.f || null, e.y || null], `${pos} ${x.key}`)
    }
  }
  const brief = (await savant.listStats({})).structured
  assert.equal(brief.count, meta.metrics.length)
  assert.ok(brief.stats.every((x) => x.what === null) && /names and keys only/.test(brief.notes[0]))
  assert.match((await savant.listStats({ query: 'cpoe' })).text, /CPOE \(key "cpoe"\)/)
})

test('the tools register with the MCP SDK and answer a real client, errors included', async () => {
  load()
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  // Registered the way api/mcp.js registers a section's tools.
  const server = new McpServer({ name: 'check', version: '0' })
  for (const t of savant.tools) {
    server.registerTool(t.name, t.config, async (args) => {
      try {
        const { text, structured } = await t.run(args)
        return { content: [{ type: 'text', text }], structuredContent: structured }
      } catch (err) {
        if (err instanceof savant.SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
        throw err
      }
    })
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'check', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  try {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), ['nfl_compare_players', 'nfl_get_leaderboard', 'nfl_get_player_career', 'nfl_get_player_profile', 'nfl_list_stats', 'nfl_search_players'])
    for (const t of tools) {
      assert.ok(t.name.length <= 64)
      assert.equal(t.annotations.readOnlyHint, true)
      assert.equal(t.inputSchema.type, 'object')
      assert.ok(t.outputSchema, `${t.name}: output schema`)
      for (const [k, prop] of Object.entries(t.inputSchema.properties)) assert.ok(prop.description, `${t.name}.${k}: described`)
    }
    // callTool validates structuredContent against the declared output schema.
    const found = await client.callTool({ name: 'nfl_search_players', arguments: { query: 'Lamar Jackson' } })
    assert.ok(!found.isError)
    assert.equal(found.structuredContent.players[0].url, cardLink('00-0034796', meta.latestSeason))
    const got = await client.callTool({ name: 'nfl_get_player_profile', arguments: { player: '00-0034796', season: '2019' } })
    assert.ok(!got.isError, got.content[0].text)
    assert.equal(got.structuredContent.player.position, 'Quarterback')
    assert.match(got.content[0].text, /EPA \/ dropback: [−.\d]+ \(vs\. quarterbacks: \d+(st|nd|rd|th) in 2019, \d+(st|nd|rd|th) all-time\)/)
    const twins = await client.callTool({ name: 'nfl_get_player_profile', arguments: { player: 'Lamar Jackson' } })
    assert.ok(twins.isError)
    assert.equal(twins.structuredContent, undefined)
    const bad = await client.callTool({ name: 'nfl_get_player_profile', arguments: { player: 'Lamar Jackson', group: 'defense' } })
    assert.ok(bad.isError, 'an unknown group is refused by the schema')
    // The rest of the section, each result held to its declared shape by callTool.
    for (const [name, args, expect] of [
      ['nfl_get_leaderboard', { position: 'QB', season: '2019' }, /Quarterbacks by EPA \/ dropback, 2019/],
      ['nfl_get_leaderboard', { position: 'RB' }, /Running backs by /],
      ['nfl_get_leaderboard', { stat: 'rushing yards', season: '2019', limit: 5 }, /NFL leaders in rushing yards, 2019/],
      ['nfl_compare_players', { players: ['00-0034796', 'Patrick Mahomes'], seasons: ['2019'] }, /side by side/],
      ['nfl_get_player_career', { player: '00-0034796' }, /Best season in each/],
      ['nfl_list_stats', { position: 'QB' }, /Football Savant stats? on a quarterback's card/],
      ['nfl_list_stats', {}, /names and keys only/],
    ]) {
      const r = await client.callTool({ name, arguments: args })
      assert.ok(!r.isError, `${name}: ${r.content[0].text.slice(0, 200)}`)
      assert.match(r.content[0].text, expect, name)
    }
    const nowhere = await client.callTool({ name: 'nfl_get_leaderboard', arguments: { stat: 'epadb' } })
    assert.ok(nowhere.isError && /Give a position/.test(nowhere.content[0].text))
  } finally {
    await client.close()
    await server.close()
  }
})
