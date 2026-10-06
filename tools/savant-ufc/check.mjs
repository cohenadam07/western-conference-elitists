// Check for the UFC Savant API files (scripts/lib/savant-api-ufc.mjs) and the UFC section of
// the AI connector (api/_ufc.js).
//
//   node --test tools/savant-ufc/check.mjs
//
// The files and the tools exist so that a machine can quote the number a fan sees on a UFC
// Savant page. So the test is not "does the slicer agree with itself" but "does it agree
// with the page". It takes the page's whole script out of public/ufc-savant.html, runs it in
// a sandbox with a stand-in for the browser's document, hands it the real
// public/ufc-savant-data.json, and then uses the page the way a reader does: it switches
// window and population, draws every fighter's bars, opens every fighter by the link the
// tool gives, and reads what the page wrote. Four questions, in order of how much they
// matter:
//
//   1. Is every percentile, value and low-sample mark in the files the one the page draws,
//      for every fighter, in every window, in both views?
//   2. Does a profile from the tool say what the files say, and does the rest of it (records,
//      measurements, rankings, belts, the fight log) say what the page shows?
//   3. Are names matched the way people type them, and when a question cannot be answered —
//      a name two men share, a window that does not exist, the data being down — does the
//      tool say what to do next rather than guess or fall over?
//   4. Do the files stay small?
//
// If someone changes how the page ranks fighters, this fails until the slicer follows. Rules
// that live in the page's click handlers or in the middle of render(), where the sandbox does
// not reach them, are pinned by their source text. Either way: fix the slicer or the tool, do
// not relax the check.
//
// No network, no keys, no new dependencies. It reads a 17 MB file and draws about twenty
// thousand profiles, so it takes a little while.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BASE, RECENT_FIGHTS, SHARDS, VIEWS, buildUfcApi, cleanNick, readPage, shardOf, writeUfcApi } from '../../scripts/lib/savant-api-ufc.mjs'
import { SavantError, clearCache } from '../../api/_core.js'
import { GROUPS, WINDOWS, cardDay, clock, compareFighters, display, feetInches, fighterProfile, leaderboard, listStats, matchupUrl, searchFighters, span, tools, upcomingCards } from '../../api/_ufc.js'

const BUDGET = 4 * 1048576 // bytes on disk; Vercel keeps about forty deployments
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const html = readFileSync(path.join(PUBLIC, 'ufc-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(PUBLIC, 'ufc-savant-data.json'), 'utf8'))
const out = buildUfcApi({ data, html })
// Through JSON once, because that is what gets published.
const files = JSON.parse(JSON.stringify(out))
const meta = files.meta
const ids = Object.keys(data.fighters)
const built = (id) => files.shards[shardOf(id)].fighters[id]
const count = (n) => n.toLocaleString('en-US')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---- the page, running ---------------------------------------------------------------

// The page's script with just enough of a browser around it: elements that remember what
// was written into them, a location, and a history that records the links the page writes.
// The data is handed over where the page would have fetched it.
function openPage() {
  const start = html.indexOf('<script>', html.indexOf('<body'))
  const end = html.indexOf('</script>', start)
  assert.ok(start > 0 && end > start, 'the page no longer has its script block')
  const els = {}
  const element = (...classes) => {
    const cls = new Set(classes)
    return {
      innerHTML: '', textContent: '', hidden: false, value: '', placeholder: '', style: {}, dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)),
        contains: (c) => cls.has(c),
      },
      querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, addEventListener() {}, focus() {}, remove() {}, after() {},
    }
  }
  const bodyClass = html.match(/<body class="([^"]*)">/)
  const document = {
    body: element(...(bodyClass ? bodyClass[1].split(/\s+/) : [])), createElement: () => element(), addEventListener() {},
    getElementById: (id) => (els[id] = els[id] || element()),
    querySelectorAll: () => [], querySelector: () => null,
  }
  const location = { hash: '', pathname: '/ufc-savant.html' }
  const written = []
  const ctx = vm.createContext({
    document, location, console,
    window: { addEventListener() {}, scrollTo() {} },
    history: { replaceState: (_state, _title, url) => written.push(url) },
    navigator: {}, requestAnimationFrame() {}, setTimeout() {},
    fetch: () => new Promise(() => {}), // never answers: the data is put in place below
  })
  vm.runInContext(html.slice(start + '<script>'.length, end), ctx, { filename: 'ufc-savant.html' })
  // What the page starts with, before anything touches it.
  const defaults = { window: ctx.win, baseline: ctx.baseline, cohort: ctx.cohortMode, band: ctx.bandOn }
  ctx.DATA = structuredClone(data)
  vm.runInContext('prepData()', ctx)
  return {
    ctx, els, location, written, defaults,
    // What the "Rank against" and "Cohort" buttons do (pinned in the first test).
    population(baseline, cohort) { ctx.baseline = baseline; ctx.cohortMode = cohort; ctx.POOL_CACHE = {} },
    // Open a link the way the page does on load.
    open(url) { location.hash = new URL(url).hash; return ctx.readURL() },
  }
}
const page = openPage()
const { ctx } = page

const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// The bars in a piece of the page's HTML, in the order drawn, each with the panel and
// subheading it sits under.
function bars(markup) {
  const rows = []
  let group = null
  let sub = null
  const token = /<h2 class="col-h">([^<]*)<\/h2>|<div class="group-h">([^<]*)<\/div>|<div class="row (un)?" data-k="(\w+)" title="([^"]*)"><div class="rl" title="[^"]*"><div class="name">([^<]*)<\/div><div class="tag">([^<]*)<\/div><\/div>.*?<div class="pct" style="[^"]*">([^<]*)<\/div><div class="rv">([^<]*)<\/div>/g
  for (const m of markup.matchAll(token)) {
    if (m[1] != null) { group = unesc(m[1]); sub = null } else if (m[2] != null) sub = unesc(m[2])
    else rows.push({ key: m[4], low: m[3] === 'un', title: unesc(m[5]), label: unesc(m[6]), tag: unesc(m[7]), pct: m[8], value: m[9], group, sub })
  }
  return rows
}
const panels = (e, r, div) => bars(ctx.CFG.panels.map((g) => ctx.panelHTML(g, e, r, div, '')).join(''))

// ---- the files, served ---------------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// The site's CDN: the four kinds of file, and the homepage for anything else (which is what
// the live catch-all rewrite does, with a 200). One connection per request: the long loops
// below never let an idle connection's timers run, and a reused one would be found dead.
let hits = 0
const cdn = http.createServer((req, res) => {
  hits++
  const p = decodeURIComponent(req.url).replace(`/${BASE}/`, '')
  const shard = p.match(/^fighters\/([0-9a-f])\.json$/)
  const body = p === 'meta.json' ? files.meta : p === 'fighters.json' ? files.fighters : p === 'upcoming.json' ? files.upcoming : shard ? files.shards[shard[1]] : null
  if (!body) { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify(body))
})

const tool = Object.fromEntries(tools.map((t) => [t.name, t]))
const shape = Object.fromEntries(tools.map((t) => [t.name, { input: z.object(t.config.inputSchema).strict(), output: z.object(t.config.outputSchema).strict() }]))
// A tool called the way the connector calls it: arguments through the input schema, the
// result held to the output schema.
async function call(name, args = {}) {
  const r = await tool[name].run(shape[name].input.parse(args))
  shape[name].output.parse(r.structured)
  return r
}
const fails = async (name, args, pattern) => {
  await assert.rejects(() => tool[name].run(args), (err) => {
    assert.ok(err instanceof SavantError, `${JSON.stringify(args)}: expected a SavantError, got ${err && err.constructor.name}: ${err && err.message}`)
    assert.match(err.message, pattern, JSON.stringify(args))
    assert.doesNotMatch(err.message, /127\.0\.0\.1|ECONNREFUSED|savant-api|\.js:\d+|at \w+ \(/, 'no stack trace or internal address')
    return true
  })
}

before(async () => { process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}` })
after(() => { cdn.close() })

// ---- 1. the page ---------------------------------------------------------------------

test('the page still works the way the slicer and this test assume', () => {
  // What the page opens in is read out of its source by the slicer; here it is read off the
  // running page.
  const read = readPage(html)
  assert.deepEqual(read.defaults, { window: page.defaults.window, baseline: page.defaults.baseline, cohort: page.defaults.cohort })
  assert.equal(page.defaults.band, false, 'the cage-time band now starts switched on')
  assert.deepEqual(meta.defaults, read.defaults)
  assert.equal(shape.ufc_get_fighter_profile.input.parse({ fighter: 'x' }).window, meta.defaults.window, 'the tool and the page open in the same window')
  assert.deepEqual(VIEWS[0], [page.defaults.baseline, page.defaults.cohort], 'the first percentile in a cell is the view the page opens in')
  assert.deepEqual(read.baselines, { active: 'Active', all: 'All-time' })
  assert.deepEqual(read.cohorts, { div: 'Division', all: 'Everyone' })

  // The windows, panels and qualifying line come from the data file.
  assert.deepEqual(Object.keys(meta.windows), data.cfg.windows.map((w) => w[0]))
  assert.deepEqual(WINDOWS, Object.keys(meta.windows), 'the tool offers exactly the page\'s windows')
  assert.deepEqual(Object.values(GROUPS), data.cfg.panels, 'the tool offers exactly the page\'s panels')
  assert.deepEqual(meta.metrics.map((m) => m.key), data.cfg.panels.flatMap((g) => data.cfg.metrics.filter((m) => m.grp === g).map((m) => m.key)))
  assert.deepEqual(meta.qualify, data.cfg.qualify)

  // Rules that sit in click handlers or inside render(), pinned by their text. If one of
  // these fails, re-read that part of the page before touching anything else.
  const pinned = [
    ['var r=row(e.id); if(!r){ r=e.w.career; }', 'which window render() draws'],
    ['var div=divOf(e);', 'which division render() ranks him in'],
    ["var html=panelHTML(g,e,r,div,g==='ctx'?cohortNote(div):'');", 'how render() draws the panels'],
    ['CFG.panels.forEach(function(g){', 'which panels render() draws'],
    ['baseline=b.dataset.v; POOL_CACHE={};', 'what the "Rank against" buttons do'],
    ['cohortMode=b.dataset.v; POOL_CACHE={};', 'what the "Cohort" buttons do'],
    ['bandOn=!bandOn; POOL_CACHE={};', 'what the cage-time switch does'],
    ["if(cmp.length===0 && miss(v)) return '';", 'the rule that hides a stat with no value'],
    ["if(r.since<2000) notes.push('Control time was not tracked before 2000", 'the era note'],
    ["(m.since>1994?' · tracked since '+m.since:'')", 'which stats count as era-gated'],
    ['function eraOK(m,r){ return !r||!m.since||true; }', 'the page trusting the data to leave untracked stats out'],
    ['FIGHTS_P=fetch(\'/ufc-savant-fights.json\')', 'the second data file loading only when a fight is opened'],
  ]
  for (const [code, what] of pinned) assert.ok(html.includes(code), `${what} changed: the page no longer has \`${code}\``)

  // The era gate, as data: only the control stats, only from 2000, and nothing predates the rest.
  const gated = data.cfg.metrics.filter((m) => m.since > meta.eraBase)
  assert.equal(meta.eraBase, 1994)
  assert.ok(gated.length && gated.every((m) => m.since === 2000 && /^ctrl/.test(m.key)), 'a stat other than control time is now era-gated')
  assert.ok(ids.every((id) => data.fighters[id].w.career.since >= meta.eraBase), 'a fight now predates the base era')
  // What the tool descriptions state as fact.
  assert.match(meta.earliest, /^1994-03-/, 'the data no longer starts in March 1994: update the tool descriptions')
  assert.match(Object.values(data.events).find((ev) => ev.date === meta.earliest).name, /^UFC 2:/, 'the first event is no longer UFC 2: update the tool descriptions')
  assert.equal(meta.activeMonths, 24, 'active is no longer 24 months: update the tool descriptions')
  assert.deepEqual(meta.windows, { career: 'UFC career', l5: 'Last 5 fights', l3: 'Last 3 fights' }, 'the windows changed: update the tool descriptions')
  assert.equal(RECENT_FIGHTS, 5, 'the tool descriptions say five recent fights')
})

test('every bar matches the page: every fighter, window, stat and view', () => {
  const unit = Object.fromEntries(meta.metrics.map((m) => [m.key, m]))
  let compared = 0
  let percentiles = 0
  let profiles = 0
  for (const w of Object.keys(meta.windows)) {
    ctx.setWin(w) // the page's own window switch
    VIEWS.forEach(([baseline, cohort], i) => {
      page.population(baseline, cohort)
      for (const id of ids) {
        const e = ctx.F[id]
        const r = ctx.row(id) || e.w.career
        const div = ctx.divOf(e)
        const mine = built(id).w[w]
        const where = `${e.name} ${w} ${baseline}/${cohort}`
        assert.equal(mine.div, div, `${where}: division`)
        assert.equal(mine.qualified, !!r.qualified, `${where}: qualified`)
        assert.equal(mine.n, r.n, `${where}: fights`)
        const drawn = panels(e, r, div)
        // The same bars in the same order: a stat the page hides is absent from the file.
        assert.deepEqual(drawn.map((b) => b.key), meta.metrics.filter((m) => mine.m[m.key]).map((m) => m.key), `${where}: which stats have a bar`)
        for (const b of drawn) {
          const cell = mine.m[b.key]
          const m = unit[b.key]
          // == rather than Object.is: the source has a few -0.0 values, which are plain 0 in a file.
          assert.ok(cell[0] === r.m[b.key], `${where} ${b.key}: value ${cell[0]} is not the page's ${r.m[b.key]}`)
          assert.equal(b.pct, cell[i + 1] == null ? '·' : String(cell[i + 1]), `${where} ${b.key}: percentile`)
          assert.equal(b.value, display(m.unit, cell[0]), `${where} ${b.key}: the value as printed`)
          assert.equal(b.label, m.label, `${where} ${b.key}: label`)
          assert.equal(b.group, meta.groups[m.group], `${where} ${b.key}: panel`)
          assert.equal(b.sub || null, m.sub, `${where} ${b.key}: subheading`)
          const low = mine.low && b.key in mine.low
          assert.equal(b.low, !!low, `${where} ${b.key}: low-sample mark`)
          assert.equal(b.tag, m.layer.toUpperCase() + (low ? ' · low sample' : ''), `${where} ${b.key}: tag`)
          if (low) {
            const said = b.title.match(/^Only (\d+) (.+) — below the (\d+) this stat needs before it settles down\.$/)
            assert.ok(said, `${where} ${b.key}: the page's low-sample note changed: ${b.title}`)
            assert.equal(+said[1], Math.round(mine.low[b.key]), `${where} ${b.key}: sample`)
            assert.equal(+said[3], m.lowSampleBelow, `${where} ${b.key}: threshold`)
          } else assert.equal(b.title, '')
          compared++
          if (cell[i + 1] != null) percentiles++
        }
        profiles++
      }
      // Pool sizes, from the note the page prints over the bars.
      for (const d of meta.divisions) {
        const note = ctx.cohortNote(d.key)
        const said = note.match(/^Ranked against ([\d,]+) qualified /)
        assert.ok(said, `the cohort note changed: ${note}`)
        assert.equal(+said[1].replace(/,/g, ''), ((meta.pools[w][baseline] || {})[cohort] || {})[d.key] || 0, `${w} ${baseline} ${d.key}: pool size`)
        assert.ok(note.includes(`Qualifying: ${meta.qualify[w][0]}+ fights and ${meta.qualify[w][1]}+ minutes.`), 'the qualifying line')
        if (baseline === 'active') assert.ok(note.includes(`who have fought in the last ${meta.activeMonths} months`), 'what active means')
        else assert.ok(note.includes('in UFC history'), 'what all-time means')
      }
    })
  }
  page.population(page.defaults.baseline, page.defaults.cohort)
  ctx.setWin(page.defaults.window)
  console.log(`      ${count(compared)} bars compared over ${count(profiles)} drawn profiles (${count(ids.length)} fighters x ${Object.keys(meta.windows).length} windows x ${VIEWS.length} views), ${count(percentiles)} with a percentile`)
  assert.ok(compared > 500000, 'suspiciously few bars')
})

test('qualifying, activity and era notes match the page, for every fighter and window', () => {
  const gated = meta.metrics.filter((m) => m.since > meta.eraBase).map((m) => m.key)
  let checked = 0
  for (const w of Object.keys(meta.windows)) {
    ctx.setWin(w)
    for (const id of ids) {
      const e = ctx.F[id]
      const r = ctx.row(id)
      const mine = built(id).w[w]
      ctx.renderGapNote(e, r)
      const note = page.els.gapnote.innerHTML
      assert.equal(note.includes('Below the qualifying line'), !mine.qualified, `${e.name} ${w}: unqualified note`)
      const era = (mine.untracked || []).concat(mine.partial || [])
      assert.equal(note.includes('Control time was not tracked before 2000'), era.length > 0, `${e.name} ${w}: era note`)
      // Every gated stat is either untracked (no value) or partial (a value from part of the window).
      if (era.length) assert.deepEqual([...era].sort(), [...gated].sort(), `${e.name} ${w}: era stats`)
      for (const k of mine.untracked || []) assert.equal(mine.m[k], undefined)
      for (const k of mine.partial || []) assert.ok(mine.m[k])
      assert.equal(mine.since, r.since)
      // The qualifying line itself, from the data.
      const [fights, minutes] = meta.qualify[w]
      assert.equal(mine.qualified, r.d.n >= fights && r.d.min >= minutes && mine.div != null, `${e.name} ${w}: qualifying line`)
      checked++
    }
  }
  for (const id of ids) assert.equal(built(id).active, data.fighters[id].last >= meta.activeCut, `${data.fighters[id].name}: active`)
  ctx.setWin(page.defaults.window)
  console.log(`      ${count(checked)} fighter-windows`)
})

// ---- 2. the tools --------------------------------------------------------------------

test('a profile says what the files say, for every fighter in every window', async () => {
  let profiles = 0
  let cells = 0
  let longest = 0
  const slotOf = (baseline) => VIEWS.findIndex((v) => v[0] === baseline && v[1] === 'div') + 1
  for (const id of ids) {
    const row = built(id)
    for (const w of WINDOWS) {
      const { structured: s, text } = await call('ufc_get_fighter_profile', { fighter: id, window: w })
      const mine = row.w[w]
      const where = `${row.name} ${w}`
      profiles++
      longest = Math.max(longest, text.length)
      assert.equal(s.fighter.id, id)
      assert.equal(s.window.key, w)
      assert.equal(s.window.fights, mine.n)
      assert.equal(s.window.qualified, mine.qualified)
      const label = meta.divisions.find((d) => d.key === mine.div).label
      assert.equal(s.fighter.division, label, `${where}: division`)
      assert.deepEqual([s.pools.active.size, s.pools.all_time.size], [(meta.pools[w].active.div[mine.div] || 0), (meta.pools[w].all.div[mine.div] || 0)], `${where}: pool sizes`)
      // Every stat in the file is in the profile, and nothing else is.
      assert.deepEqual(s.stats.map((x) => x.key), meta.metrics.filter((m) => mine.m[m.key]).map((m) => m.key), `${where}: stat list`)
      for (const x of s.stats) {
        const cell = mine.m[x.key]
        assert.equal(x.value, cell[0], `${where} ${x.key}: value`)
        assert.equal(x.active_percentile, cell[slotOf('active')], `${where} ${x.key}: active percentile`)
        assert.equal(x.all_time_percentile, cell[slotOf('all')], `${where} ${x.key}: all-time percentile`)
        assert.equal(x.low_sample, !!(mine.low && x.key in mine.low), `${where} ${x.key}: low sample`)
        if (x.low_sample) assert.equal(x.sample.have, mine.low[x.key])
        cells++
      }
      // A stat with no bar is listed as not tracked or as having no value: never as a zero.
      const missing = meta.metrics.filter((m) => !mine.m[m.key]).map((m) => m.key)
      assert.deepEqual(s.not_tracked.map((m) => m.key), mine.untracked || [], `${where}: not tracked`)
      assert.deepEqual(s.not_tracked.map((m) => m.key).concat(s.no_value.map((m) => m.key)).sort(), missing.sort(), `${where}: stats with no value`)
      // The words carry the same caveats.
      assert.ok(text.includes(`vs. ${s.pools.active.label}`) && text.includes(`vs. ${s.pools.all_time.label}`), `${where}: the text names both pools`)
      assert.ok(s.pools.active.label.startsWith('active ') && s.pools.all_time.label.startsWith('all-time ') && s.pools.active.label.includes(label.toLowerCase()), `${where}: pool labels`)
      assert.ok(text.includes(s.url) && s.url.endsWith(`#f=${id}&w=${w}`), `${where}: link`)
      assert.ok(text.includes(`Data through ${meta.latest}`), `${where}: the data date`)
      assert.equal(/below the qualifying line/.test(text), !mine.qualified, `${where}: unqualified fighters carry the caution`)
      assert.equal(/is inactive: no UFC fight/.test(text), !row.active, `${where}: inactive fighters are told so`)
      assert.equal(s.stats.some((x) => x.low_sample), /\[.*low sample: \d+ of the \d+ /.test(text), `${where}: low samples are flagged in the text`)
      assert.equal(/no "vs\. active .*" percentile exists/.test(text), s.pools.active.size < 2, `${where}: an empty active pool is explained`)
      if (s.pools.active.size < 2) assert.ok(s.stats.every((x) => x.active_percentile == null))
      for (const n of s.notes) assert.ok(text.includes(n), `${where}: a note is missing from the text`)
      assert.doesNotMatch(text, /undefined|NaN|\[object/, where)
    }
  }
  console.log(`      ${count(profiles)} profiles, ${count(cells)} stats, longest text ${count(longest)} characters`)
  assert.equal(profiles, ids.length * WINDOWS.length)
  assert.ok(longest < 12000, `a profile ran to ${longest} characters`)
})

test('every fighter opens by the tool\'s link, and the page shows what the profile says', async () => {
  const date = (iso) => ctx.fmtDate(iso)
  let opened = 0
  let facts = 0
  for (const id of ids) {
    const { structured: s, text } = await fighterProfile({ fighter: id })
    const f = s.fighter
    // The link, opened the way the page opens one on load, lands on this fighter and window,
    // and the page writes the same link back.
    page.written.length = 0
    assert.equal(page.open(s.url), true, `${f.name}: the page did not take ${s.url}`)
    assert.equal(ctx.curId, id, `${f.name}: the link opened someone else`)
    assert.equal(ctx.win, s.window.key)
    assert.equal(page.written.pop(), new URL(s.url).pathname + new URL(s.url).hash, `${f.name}: the page writes a different link`)
    opened++

    const head = page.els.idbody.innerHTML
    const one = (re) => { const m = head.match(re); return m ? unesc(m[1]) : null }
    assert.equal(one(/<div class="id-name">([^<]*)<\/div>/), f.name)
    assert.equal(one(/<span class="id-nick">“([^<]*)”<\/span>/), f.nickname, `${f.name}: nickname`)
    assert.equal(f.nickname, ctx.nickOf(ctx.F[id]) || null)
    assert.equal(f.nickname || '', cleanNick(data.fighters[id].nick))
    const line = head.match(/<div class="id-meta"><b>([^<]*)<\/b> · UFC debut ([^·]*) · last fight ([^<]*)<\/div>/)
    assert.deepEqual([unesc(line[1]), line[2], line[3]], [f.division, date(f.ufc_debut), date(f.last_ufc_fight)], `${f.name}: division and dates`)
    const recs = [...head.matchAll(/<span class="tr-rec"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1].replace(/–/g, '-'))
    assert.equal(recs[0], f.pro_record ? f.pro_record.text : '—', `${f.name}: pro record`)
    assert.equal(recs[1], f.ufc_record.text.replace(/ \(\d+ NC\)$/, ''), `${f.name}: UFC record`)
    const log = data.fighters[id].log
    assert.deepEqual([f.ufc_record.wins, f.ufc_record.losses, f.ufc_record.draws, f.ufc_record.no_contests], ['W', 'L', 'D', 'NC'].map((res) => log.filter((x) => x.res === res).length))

    const stat = Object.fromEntries(s.stats.map((x) => [x.key, x]))
    const measured = Object.fromEntries([...head.matchAll(/<div class="ml">([^<]*)<\/div><div class="mv">([^<]*)<\/div>/g)].map((m) => [m[1], unesc(m[2])]))
    assert.deepEqual(measured, {
      Height: f.height || '—',
      Reach: f.reach_inches == null ? '—' : `${f.reach_inches}"`,
      Weight: f.weight_lb == null ? '—' : `${f.weight_lb} lb`,
      Stance: f.stance || '—',
      Age: f.age == null ? '—' : String(f.age),
      Fights: String(s.window.fights),
      'Cage time': stat.min ? stat.min.display : '—',
      Rating: stat.elo ? stat.elo.display : '—',
    }, `${f.name}: measurements`)

    // Badges the profile repeats: official ranking, pound-for-pound, inactive, unqualified.
    const badges = [...head.matchAll(/<span class="acco[^"]*"(?: title="([^"]*)")?>([^<]*)<\/span>/g)].map((m) => ({ title: unesc(m[1] || ''), text: unesc(m[2]) }))
    const said = badges.map((b) => b.text).filter((t) => / champion$|^UFC #|pound-for-pound$|^Inactive$|^Unqualified$/.test(t))
    const expect = f.rankings.map((r) => (r.rank === 0 ? `★ ${r.division} champion` : r.rank === 0.5 ? `★ ${r.division} interim champion` : `UFC #${r.rank} · ${r.division}`))
    if (f.pound_for_pound != null) expect.push(`#${f.pound_for_pound} pound-for-pound`)
    if (!f.active) expect.push('Inactive')
    if (!s.window.qualified) expect.push('Unqualified')
    assert.deepEqual(said, expect, `${f.name}: badges`)
    const ranked = badges.find((b) => b.title.startsWith('Official UFC ranking as of'))
    if (ranked) assert.equal(ranked.title, `Official UFC ranking as of ${date(f.rankings_as_of)}`)
    const inactive = badges.find((b) => b.text === 'Inactive')
    if (inactive) assert.equal(inactive.title, `No UFC fight in the last ${meta.activeMonths} months`)

    // Belts. The page lists the longest first; the profile lists them in order.
    const belts = [...head.matchAll(/<span class="belt-lab">([^<]*)(?:<span class="defs"[^>]*>[^<]*<\/span>)?<small>([^<]*)<\/small><\/span><span class="belt-bar">.*?<\/span><span class="belt-len">([^<]*)<\/span>/g)].map((m) => [unesc(m[1]), unesc(m[2]), m[3]].join(' | '))
    const reigns = (s.title_reigns || []).map((b) => [
      `${b.division}${b.interim ? ' interim' : ''} champion`,
      `${date(b.start)} – ${b.end ? date(b.end) : 'present'} · ${b.ended}${b.defenses ? ` · ${b.defenses} defense${b.defenses > 1 ? 's' : ''}` : ''}`,
      b.length,
    ].join(' | '))
    assert.deepEqual(belts.sort(), reigns.sort(), `${f.name}: title reigns`)
    for (const b of s.title_reigns || []) assert.equal(b.length, ctx.spanTxt(b.days))
    // The reigns come from title fights and the rankings from the UFC: where they disagree
    // about today, the answer says so instead of calling a 1996 belt a current title.
    const src = data.fighters[id]
    const holds = (div, interim) => (src.rks || {})[div] === (interim ? 0.5 : 0)
    assert.deepEqual((s.title_reigns || []).map((b) => b.in_official_ranking), src.belts.map((b) => (b.how === 'current' ? holds(b.div, b.interim) : null)), `${f.name}: running reigns against the official ranking`)
    assert.equal(/marked as running in the data, but the official ranking does not list/.test(text), src.belts.some((b) => b.how === 'current' && !holds(b.div, b.interim)), `${f.name}: an unbacked running reign is called out`)
    assert.equal(/but no running reign is listed for it/.test(text), Object.entries(src.rks || {}).some(([div, n]) => n < 1 && !src.belts.some((b) => b.div === div && b.how === 'current' && !!b.interim === (n === 0.5))), `${f.name}: a champion with no reign in the data is called out`)

    // The fight log: the page shows all of it, the profile the most recent few.
    const fights = [...page.els.log.innerHTML.matchAll(/<tr class="fr" data-fid="[^"]*">(.*?)<\/tr>/g)].map((m) => m[1])
    assert.equal(fights.length, s.window.fights, `${f.name}: fights in the log`)
    assert.equal((s.recent_fights || []).length, Math.min(RECENT_FIGHTS, fights.length))
    ;(s.recent_fights || []).forEach((x, i) => {
      const tr = fights[i]
      const cell = (re) => { const m = tr.match(re); assert.ok(m, `${f.name} fight ${i + 1}: the log row changed shape`); return m.slice(1).map((v) => (v == null ? v : unesc(v))) }
      assert.deepEqual(cell(/<span class="res (\w+)">(\w+)<\/span>/), [x.result, x.result])
      assert.deepEqual(cell(/<span class="opp" data-id="([^"]*)">([^<]*)<\/span>/), [x.opponent_id, x.opponent])
      assert.equal(tr.includes('<span class="title">TITLE</span>'), x.title_bout)
      const bonus = tr.match(/<span class="bonus" title="([^"]*)">/)
      assert.deepEqual(bonus ? unesc(bonus[1]).split(', ') : [], x.bonuses, `${f.name} fight ${i + 1}: bonuses`)
      assert.deepEqual(cell(/<td class="ev">([^<]*)<br><span[^>]*>([^<]*)<\/span><\/td>/), [x.event || '', date(x.date)])
      assert.deepEqual(cell(/<td>([^<]*)<br><span[^>]*>R(\d+) ([^<]*)<\/span><\/td>/), [x.method || '', String(x.round), x.time || '—'])
      const dash = (v) => (v == null ? '—' : String(v))
      const numbers = [...tr.matchAll(/<td class="n">(.*?)<\/td>/g)].map((m) => m[1].replace(/<span[^>]*>/, '').replace('</span>', ''))
      assert.deepEqual(numbers, [
        x.sig_strikes_landed == null ? '—' : `${x.sig_strikes_landed}/${x.sig_strikes_absorbed}`,
        dash(x.knockdowns), dash(x.takedowns), dash(x.control), dash(x.opponent_rating),
      ], `${f.name} fight ${i + 1}: numbers`)
      assert.equal(x.bout, log[i].wc)
      facts += 14
    })

    // The bars of the whole rendered page are the ones the profile lists, in its default view.
    const drawn = bars(page.els.ctxrow.innerHTML + page.els.panels.innerHTML)
    assert.deepEqual(drawn.map((b) => [b.key, b.value, b.pct, b.low, b.group, b.sub || null]), s.stats.map((x) => [x.key, x.display, x.active_percentile == null ? '·' : String(x.active_percentile), x.low_sample, x.group, x.subgroup]), `${f.name}: the rendered bars`)
    assert.deepEqual(drawn.map((b) => b.tag.replace(' · low sample', '').toLowerCase()), s.stats.map((x) => x.tag))
    const note = unesc(page.els.ctxrow.innerHTML.match(/<div class="col-cap">([^<]*)<\/div>/)[1])
    assert.ok(note.startsWith(`Ranked against ${count(s.pools.active.size)} qualified ${f.division} fighters who have fought in the last ${meta.activeMonths} months, each over their own `), `${f.name}: the pool the page names: ${note}`)
    assert.ok(unesc(page.els.gapnote.innerHTML).includes(`through ${date(s.data_through)}`), 'the date the page says its data runs through')
    facts += 16 + drawn.length
  }
  console.log(`      ${count(opened)} fighter links opened, ${count(facts)} facts compared with the rendered page`)
})

test('a window link opens that window, and a fighter who changed weight is ranked where the page ranks him', async () => {
  const movers = ids.filter((id) => new Set(WINDOWS.map((w) => built(id).w[w].div)).size > 1)
  assert.ok(movers.length > 50, 'expected plenty of fighters whose division changes with the window')
  let opened = 0
  for (const id of movers) {
    for (const w of WINDOWS) {
      const { structured: s, text } = await fighterProfile({ fighter: id, window: w })
      assert.equal(page.open(s.url), true)
      assert.deepEqual([ctx.curId, ctx.win], [id, w])
      const key = page.els.idbody.innerHTML.match(/<span class="posbadge[^"]*">([^<]*)<\/span>/)[1]
      assert.equal(key, built(id).w[w].div, `${s.fighter.name} ${w}: the division badge`)
      assert.equal(s.fighter.division, meta.divisions.find((d) => d.key === key).label)
      assert.match(text, /It changes with the window: /)
      const drawn = bars(page.els.ctxrow.innerHTML + page.els.panels.innerHTML)
      assert.deepEqual(drawn.map((b) => [b.key, b.value, b.pct]), s.stats.map((x) => [x.key, x.display, x.active_percentile == null ? '·' : String(x.active_percentile)]), `${s.fighter.name} ${w}`)
      opened++
    }
  }
  // A window the page does not have falls back to the career, as the tool's link never asks it to.
  page.location.hash = `#f=${movers[0]}&w=nope`
  ctx.readURL()
  assert.equal(ctx.win, 'career')
  console.log(`      ${movers.length} fighters whose division changes with the window, ${opened} window links opened`)
})

test('values and lengths print the way the page prints them', () => {
  // The page's own formatters, against the tool's, on every value in the data and then some.
  const units = [...new Set(data.cfg.metrics.map((m) => m.unit))]
  let compared = 0
  for (const m of meta.metrics) {
    for (const id of ids) {
      for (const w of WINDOWS) {
        const v = data.fighters[id].w[w].m[m.key]
        if (v == null) continue
        assert.equal(display(m.unit, v), ctx.fmt(m.unit, v), `${m.key} ${v}`)
        compared++
      }
    }
  }
  for (const u of [...units, 'pct1', 'inch', 'ftin']) {
    for (const v of [0, -0, 0.004, -0.004, 0.005, -0.005, 0.5, -0.5, 1.005, 59.5, 59.99, 60, 71.5, 99.95, 100, 1234.56, -3.456, null, NaN]) {
      assert.equal(display(u, v), ctx.fmt(u, v), `${u} ${v}`)
      compared++
    }
  }
  for (let s = 0; s < 4000; s += 7) assert.equal(clock(s), ctx.mmss(s))
  for (let n = 55; n < 90; n += 0.5) assert.equal(feetInches(n), ctx.inFt(n))
  for (let d = 0; d < 12000; d++) assert.equal(span(d), ctx.spanTxt(d), `${d} days`)
  console.log(`      ${count(compared)} values`)
})

test('one group is that panel only, with each stat explained', async () => {
  let checked = 0
  let women = 0
  let kept = 0
  const groups = Object.keys(GROUPS)
  for (const [i, id] of ids.entries()) {
    const group = groups[i % groups.length]
    const w = WINDOWS[i % WINDOWS.length]
    const { structured: s, text } = await call('ufc_get_fighter_profile', { fighter: id, window: w, group })
    const mine = built(id).w[w]
    const wanted = meta.metrics.filter((m) => m.group === GROUPS[group])
    assert.deepEqual(s.stats.map((x) => x.key), wanted.filter((m) => mine.m[m.key]).map((m) => m.key))
    assert.ok(s.stats.every((x) => x.group === meta.groups[GROUPS[group]]))
    assert.deepEqual(s.no_value.concat(s.not_tracked).map((m) => m.key).sort(), wanted.filter((m) => !mine.m[m.key]).map((m) => m.key).sort())
    assert.equal(s.recent_fights, undefined, 'the fight log stays with the whole profile')
    assert.equal(s.title_reigns, undefined)
    // Each stat is explained in the page's words, never reworded. The page writes every
    // explanation about a man, so on a woman's profile only the ones that fit are quoted.
    const woman = (meta.divisions.find((d) => d.key === built(id).w.career.div) || {}).sex === 'F'
    for (const x of s.stats) {
      const pages = data.cfg.metrics.find((m) => m.key === x.key).exp.w
      const male = /\b(he|his|him|himself|man|men)\b/i.test(pages)
      if (woman && male) {
        assert.equal(x.what, null, `${x.key}: a male-worded explanation on a woman's profile`)
        assert.ok(!text.includes(pages), `${x.key}: a male-worded explanation on a woman's profile`)
      } else {
        assert.equal(x.what, pages, `${x.key}: explained in the page's words`)
        assert.ok(text.includes(`\n  ${x.what}`), `${x.key}: explained in the page's words`)
      }
      if (woman) { women++; if (x.what) kept++ }
    }
    checked++
  }
  assert.ok(women > 1000 && kept > 0 && kept < women, 'women\'s profiles were covered, with some explanations kept and some left out')
  // The explanations are the data file's own.
  const man = ids.find((id) => (meta.divisions.find((d) => d.key === built(id).w.career.div) || {}).sex !== 'F')
  const { structured: s } = await call('ufc_get_fighter_profile', { fighter: man, group: 'context' })
  for (const x of s.stats) assert.equal(x.what, data.cfg.metrics.find((m) => m.key === x.key).exp.w)
  const whole = await call('ufc_get_fighter_profile', { fighter: ids[0] })
  assert.ok(whole.text.includes(`Savant rating: ${data.cfg.metrics.find((m) => m.key === 'elo').exp.w}`), 'the rating is described in the page\'s own words')
  assert.equal(checked, ids.length)
})

test('the caveats a fan needs are in the answer', async () => {
  const pick = (ok) => ids.find((id) => ok(built(id), data.fighters[id]))
  // Below the qualifying line: said the way the page says it.
  const thin = pick((r) => r.w.career.n === 2 && r.active)
  const a = await call('ufc_get_fighter_profile', { fighter: thin })
  assert.match(a.text, /is below the qualifying line \(3 fights, 15 minutes\) for this window: (he|she) is ranked against the pools but is not part of them\. (He|She) has 2 fights in it\./)
  assert.ok(a.text.includes(data.cfg.metrics.find((m) => m.key === 'n').exp.y), 'the page\'s own guide to small samples')
  assert.ok(a.structured.stats.filter((x) => x.low_sample).length > 10)
  assert.match(a.text, /All 2 of (his|her) UFC fights, newest first:/)
  // Asking for a longer window than the career says so.
  const b = await call('ufc_get_fighter_profile', { fighter: thin, window: 'l5' })
  assert.match(b.text, /has 2 fights in the UFC, so "Last 5 fights" is (his|her) whole UFC career/)
  // A division with no active pool: values, no active percentile, and the reason.
  const open = pick((r) => r.w.career.div === 'OPEN' && r.w.career.qualified)
  const c = await call('ufc_get_fighter_profile', { fighter: open })
  assert.equal(c.structured.pools.active.size, 0)
  assert.ok(c.structured.stats.length > 20 && c.structured.stats.every((x) => x.active_percentile === null) && c.structured.stats.some((x) => x.all_time_percentile !== null))
  assert.match(c.text, /There are no qualified fighters among active open weight fighters, so no "vs\. active open weight fighters" percentile exists/)
  assert.match(c.text, /vs\. active open weight fighters n\/a, vs\. all-time open weight fighters \d+(st|nd|rd|th)/)
  // Fights from before control time was tracked: not tracked, never zero.
  const old = pick((r) => (r.w.career.untracked || []).length)
  const d = await call('ufc_get_fighter_profile', { fighter: old })
  assert.equal(d.structured.not_tracked.length, 3)
  assert.ok(d.structured.not_tracked.every((m) => m.since === 2000 && !d.structured.stats.some((x) => x.key === m.key)))
  assert.match(d.text, /Not tracked: every fight in this window is from before these stats were recorded, so they have no value rather than a zero: Control time \/ 15 min \(since 2000\)/)
  const straddle = pick((r) => (r.w.career.partial || []).length)
  const e = await call('ufc_get_fighter_profile', { fighter: straddle })
  assert.match(e.text, /Not tracked before 2000, so these cover only (his|her) fights from 2000 on: Control time \/ 15 min, Control differential \/ 15, Controlled \/ 15 min\./)
  // A woman is not called "he".
  const woman = pick((r) => r.w.career.div === 'WSW' && !r.active && !r.w.career.qualified)
  const f = await call('ufc_get_fighter_profile', { fighter: woman })
  assert.match(f.text, /She is inactive/)
  assert.match(f.text, /She is below the qualifying line/)
  assert.doesNotMatch(f.structured.notes.join(' ').replace(/The page's own guide: ".*?"/, ''), /\b(he|his|him)\b/i, 'a woman\'s profile, outside the page\'s quoted wording')
  // Dates: age and activity are counted to the data date, never to today.
  assert.match(a.text, new RegExp(`as of ${meta.latest}`))
  assert.equal(meta.latest, data.cfg.latest)
  for (const id of ids.slice(0, 300)) {
    const p = await fighterProfile({ fighter: id, group: 'context' })
    assert.equal(p.structured.fighter.age, data.fighters[id].age ?? null)
    assert.equal(p.structured.fighter.active, data.fighters[id].active)
    assert.equal(p.structured.data_through, data.cfg.latest)
    const f = p.structured.fighter
    if (f.age != null) assert.ok(p.text.includes(f.active ? `age ${f.age} as of ${meta.latest} (born ${f.born})` : `born ${f.born} (${f.age} years before ${meta.latest})`), `${f.name}: age is tied to the data date`)
    if (!f.active) assert.doesNotMatch(p.text, /\bage \d/, `${f.name}: no age in words for a fighter who may not be living`)
  }
})

// The list of scheduled cards is only as fresh as the last data build, so its first entry can
// be a card that has already been fought. Both the page and the tool judge each card against
// today's date on the US west coast; the test sets that date, on both, and walks it past each
// card in turn.
const dayAfter = (iso, n = 1) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
test('the cards are the ones in the data, and "next" is the first not yet fought, on the page and in the tool', async () => {
  const cards = data.upcoming.cards
  assert.ok(cards.length && cards.every((c) => c.date), 'the data lists scheduled cards with dates')
  // The page's clock and the tool's are the same clock.
  assert.equal(meta.nextCardZone, 'America/Los_Angeles')
  assert.equal(cardDay(Date.now(), meta.nextCardZone), vm.runInContext('todayPT()', ctx))
  assert.equal(cardDay(Date.parse('2026-10-04T06:59:00Z')), '2026-10-03', 'a card stays current until midnight on the west coast')
  assert.equal(cardDay(Date.parse('2026-10-04T07:01:00Z')), '2026-10-04')

  // Everything in the list, whatever the date: the cards and bouts are the data's.
  const before = dayAfter(cards[0].date, -1)
  const { structured: s, text } = await upcomingCards({ which: 'all', today: before })
  shape.ufc_get_upcoming_cards.output.parse(s)
  assert.equal(s.count, cards.length)
  assert.deepEqual(s.cards.map((c) => [c.event, c.date, c.location]), cards.map((c) => [c.name, c.date, c.location]))
  s.cards.forEach((c, i) => {
    assert.deepEqual(c.bouts.map((b) => b.bout), cards[i].bouts.map((b) => b.wc))
    c.bouts.forEach((b, j) => {
      const src = cards[i].bouts[j].f
      assert.deepEqual(b.fighters.map((x) => [x.name, x.id, x.in_ufc_savant]), src.map((x) => [x.name, x.known ? x.id : null, !!x.known]))
      for (const x of b.fighters) assert.equal(x.id != null, !!data.fighters[x.id])
      assert.equal(b.matchup_url != null, src.every((x) => x.known))
    })
    assert.ok(text.includes(`${c.event}, ${c.date}, ${c.location}`))
    // The main event is the bout the card is named for, and at most one bout is.
    const main = c.bouts.filter((b) => b.main_event)
    assert.ok(main.length <= 1)
    if (main.length) for (const x of main[0].fighters) assert.ok(x.name.split(' ').some((w) => c.event.toLowerCase().includes(w.toLowerCase())), `${c.event}: ${x.name}`)
  })
  assert.ok(s.cards.some((c) => c.bouts.some((b) => b.main_event)), 'no card had a main event that could be told from its name')
  assert.ok(text.includes(`when the data was built on ${s.data_built}`) && s.data_built === data.upcoming.generated.slice(0, 10))

  // Walk the date: the day before the first card, each card's own day, the day after each,
  // and the day after the last. The page's home screen and the tool have to agree every time.
  const days = [before, ...cards.flatMap((c) => [c.date, dayAfter(c.date)])]
  for (const today of days) {
    const expected = cards.find((c) => c.date >= today) || null
    const all = (await upcomingCards({ which: 'all', today })).structured
    const upcoming = (await upcomingCards({ today })).structured
    const next = (await upcomingCards({ which: 'next', today })).structured
    assert.deepEqual(all.cards.map((c) => c.status), cards.map((c) => (c.date < today ? 'past' : c.date === today ? 'today' : 'upcoming')), today)
    assert.deepEqual(all.cards.map((c) => c.next), cards.map((c) => c === expected), `${today}: which card is next`)
    assert.deepEqual(upcoming.cards.map((c) => c.event), cards.filter((c) => c.date >= today).map((c) => c.name), `${today}: a card already fought is not listed as still to come`)
    assert.deepEqual(next.cards.map((c) => c.event), expected ? [expected.name] : [])
    for (const r of [all, upcoming, next]) {
      assert.deepEqual(r.next_card, expected ? { event: expected.name, date: expected.date, location: expected.location } : null)
      assert.equal(r.past_cards_listed, cards.filter((c) => c.date < today).length)
      assert.equal(r.today, today)
    }
    // The page: its home screen names the same card, or hides the block when none is left.
    ctx.todayPT = () => today
    ctx.renderHome()
    const head = page.els.homeCard.innerHTML.match(/<b>Next card · ([^<]*)<\/b><span>([^<]*)<\/span>/)
    if (!expected) { assert.equal(page.els.homeCard.hidden, true, `${today}: no card left, so the page shows none`); continue }
    assert.equal(page.els.homeCard.hidden, false)
    assert.deepEqual([unesc(head[1]), unesc(head[2])], [expected.name, `${ctx.fmtDate(expected.date)} · ${expected.location}`], today)
  }
  // What the answer says when a listed card has gone by, and when they all have.
  const stale = await upcomingCards({ today: dayAfter(cards[0].date) })
  assert.ok(stale.text.includes(`already happened and is left out here: ${cards[0].name} (${cards[0].date})`))
  assert.doesNotMatch(stale.text.split('\n').slice(0, 3).join('\n'), new RegExp(escapeRe(cards[0].name)), 'a card already fought is not the first thing a reader sees')
  if (cards[0].date > meta.latest) assert.ok(stale.text.includes(`not in UFC Savant yet: the fight data runs through ${meta.latest}`))
  const none = await upcomingCards({ today: dayAfter(cards[cards.length - 1].date) })
  assert.equal(none.structured.count, 0)
  assert.match(none.text, /^Every card UFC Savant lists has already happened/)
  // Through the tool, on today's real date: it runs, and fits its declared shape.
  const live = await call('ufc_get_upcoming_cards', {})
  assert.equal(live.structured.today, cardDay(Date.now(), meta.nextCardZone))

  // The home screen draws the next card. Read it off the page, on the day before the first.
  ctx.todayPT = () => before
  ctx.renderHome()
  const home = page.els.homeCard.innerHTML
  const first = s.cards[0]
  const drawn = [...home.matchAll(/<div class="bout">(.*?)<\/div>/g)].map((m) => m[1])
  assert.equal(drawn.length, first.bouts.length)
  drawn.forEach((row, j) => {
    const names = [...row.matchAll(/<span class="bf (?:r|l)( unknown)?" (?:data-id="([^"]*)")?>([^<]*)<\/span>/g)].map((m) => [unesc(m[3]), m[2] || null, !m[1]])
    assert.deepEqual(names, first.bouts[j].fighters.map((x) => [x.name, x.id, x.in_ufc_savant]), `bout ${j + 1}`)
    assert.equal(unesc(row.match(/<span class="wcl">([^<]*)<\/span>/)[1]), first.bouts[j].bout.replace("Women's", 'W.'))
    // Clicking "vs" opens the head-to-head; the page then writes the link the tool gives.
    const vs = row.match(/<span class="vs" data-a="([^"]*)" data-b="([^"]*)"/)
    assert.equal(!!vs, first.bouts[j].matchup_url != null)
    if (vs) {
      page.written.length = 0
      ctx.openMatchup(vs[1], vs[2], meta.matchupWindow)
      const url = new URL(first.bouts[j].matchup_url)
      assert.equal(page.written.pop(), url.pathname + url.hash)
      assert.equal(first.bouts[j].matchup_url, matchupUrl(meta, vs[1], vs[2]))
    }
  })
  // And the link opens that head-to-head on load.
  const bout = s.cards.flatMap((c) => c.bouts).find((b) => b.matchup_url)
  ctx.mu.a = null
  ctx.mu.b = null
  assert.equal(page.open(bout.matchup_url), true)
  assert.deepEqual([ctx.mu.a, ctx.mu.b, ctx.mu.win], [bout.fighters[0].id, bout.fighters[1].id, meta.matchupWindow])
})

// ufcstats marks a fight-night bonus on the fight, not on the fighter. Fight of the Night is
// paid to both; Performance, KO and Submission of the Night are one fighter's, and the build
// (pipeline/ufc/build.py, bonus_for) gives them to the winner. A loser shown with a
// Performance of the Night bonus is the bug this guards against.
test('an individual fight-night bonus is on the winner\'s log only, in the data and in an answer', async () => {
  const names = meta.bonus
  assert.deepEqual(Object.keys(names).sort(), ['fight', 'ko', 'perf', 'sub'])
  const seen = { fight: {}, perf: {}, ko: {}, sub: {} }
  const fights = new Map()
  for (const id of ids) for (const f of data.fighters[id].log) {
    if (!fights.has(f.id)) fights.set(f.id, [])
    fights.get(f.id).push(f)
    for (const b of f.bonus) seen[b][f.res] = (seen[b][f.res] || 0) + 1
  }
  for (const b of ['perf', 'ko', 'sub']) assert.deepEqual(Object.keys(seen[b]), ['W'], `${names[b]} is on a fighter who did not win: ${JSON.stringify(seen[b])}`)
  assert.ok(seen.perf.W > 1000 && seen.fight.W > 500)
  // Fight of the Night is the fight's: both logs carry it, or neither.
  for (const [fid, rows] of fights) {
    if (rows.length !== 2) continue
    assert.equal(rows[0].bonus.includes('fight'), rows[1].bonus.includes('fight'), `fight ${fid}`)
  }
  // And in an answer: a fighter's recent losses never carry an individual bonus.
  let losses = 0
  for (const id of ids.filter((_, i) => i % 9 === 0)) {
    const { structured: s, text } = await fighterProfile({ fighter: id })
    for (const x of s.recent_fights || []) {
      if (x.result === 'W') continue
      losses++
      assert.deepEqual(x.bonuses.filter((b) => b !== names.fight), [], `${s.fighter.name} ${x.date}`)
    }
    assert.doesNotMatch(text, /: (loss to|draw with|no contest with) [^\n]*Bonus: (?!Fight of the Night\.)/, s.fighter.name)
  }
  assert.ok(losses > 300)
})

// ---- 3. names, and questions that cannot be answered ---------------------------------------

test('names are matched the way people type them', async () => {
  const first = async (query) => (await call('ufc_search_fighters', { query })).structured.fighters[0]?.name
  const one = async (fighter) => (await call('ufc_get_fighter_profile', { fighter, group: 'context' })).structured.fighter.name
  // Accents: ufcstats spells every name without them.
  assert.equal(await one('José Aldo'), 'Jose Aldo')
  assert.equal(await one('Jiří Procházka'), 'Jiri Prochazka')
  assert.equal(await one('Benoît Saint-Denis'), 'Benoit Saint Denis')
  // Punctuation and case.
  assert.equal(await one("sean o'malley"), "Sean O'Malley")
  assert.equal(await one('Sean OMalley'), "Sean O'Malley")
  assert.equal(await one('B.J. Penn'), 'BJ Penn')
  assert.equal(await one('Georges St Pierre'), 'Georges St-Pierre')
  assert.equal(await one('KHALIL ROUNTREE'), 'Khalil Rountree Jr.')
  // Family name first, the way some are said.
  assert.equal(await one('Weili Zhang'), 'Zhang Weili')
  // Typos. Search finds the fighter. The profile never opens one on a near spelling alone,
  // even when only one fighter is close: it names him and asks for the id, because a name
  // one letter off may belong to someone who is not in the data.
  assert.equal(await first('Islam Makachev'), 'Islam Makhachev')
  assert.equal(await first('Volkanovsky'), 'Alexander Volkanovski')
  await fails('ufc_get_fighter_profile', { fighter: 'Islam Makachev', window: 'career', group: 'context' }, /"Islam Makachev" is not an exact match\. Call again with one of these ids:\n- Islam Makhachev \(id 275aca31f61ba28c\)/)
  await fails('ufc_get_fighter_profile', { fighter: 'Volkanovsky', window: 'career', group: 'context' }, /is not an exact match[\s\S]*Alexander Volkanovski/)
  // Nicknames, alone and with the surname.
  assert.equal(await one('Rampage'), 'Quinton Jackson')
  assert.equal(await one('Rampage Jackson'), 'Quinton Jackson')
  assert.equal(await one('Tank Abbott'), 'David Abbott')
  assert.equal(await one('Mirko Cro Cop'), 'Mirko Filipovic')
  assert.equal(await one('The Notorious'), 'Conor McGregor')
  assert.equal(await one('Cris Cyborg'), 'Cristiane Justino')
  // Single-word names and ids.
  assert.equal(await one('Sumudaerji'), 'Sumudaerji')
  assert.equal(await one('275ACA31F61BA28C'), 'Islam Makhachev')
  // Search finds a fighter by his own name, first (or second, for the one shared name):
  // every name with punctuation, a suffix or a single word, and every ninth of the rest.
  let searched = 0
  for (const [i, id] of ids.entries()) {
    const e = data.fighters[id]
    if (i % 9 && /^[A-Za-z]+( [A-Za-z]+)+$/.test(e.name) && !/ (Jr|Sr|II|III)$/.test(e.name)) continue
    const r = await searchFighters({ query: e.name, limit: 3 })
    assert.ok(r.structured.fighters.slice(0, 2).some((x) => x.id === id), `${e.name}: not found by name`)
    searched++
  }
  assert.ok(searched > 300)
  assert.equal(await first('makhachev'), 'Islam Makhachev')
  assert.equal(await first('Suga'), "Sean O'Malley")
  const many = await call('ufc_search_fighters', { query: 'silva', limit: 7 })
  assert.equal(many.structured.count, 7)
  assert.ok(many.structured.total > 7)
  assert.ok(many.structured.fighters.every((x) => x.url.endsWith(`#f=${x.id}&w=career`)))
  const none = await call('ufc_search_fighters', { query: 'zzzzqq' })
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No fighter in UFC Savant matches/)
  // A search row says what the index says.
  const row = many.structured.fighters[0]
  const src = files.fighters.fighters.find((x) => x.id === row.id)
  assert.deepEqual([row.name, row.ufc_fights, row.active, row.first_ufc_fight, row.last_ufc_fight], [src.name, data.fighters[row.id].log.length, data.fighters[row.id].active, data.fighters[row.id].first, data.fighters[row.id].last])
})

test('a shared name lists the candidates instead of guessing', async () => {
  // Every name carried by more than one fighter.
  const byName = new Map()
  for (const id of ids) { const n = data.fighters[id].name.toLowerCase(); byName.set(n, (byName.get(n) || []).concat(id)) }
  const shared = [...byName.values()].filter((list) => list.length > 1)
  assert.ok(shared.length >= 1, 'the data has no shared names to test with')
  for (const list of shared) {
    const name = data.fighters[list[0]].name
    await fails('ufc_get_fighter_profile', { fighter: name }, new RegExp(`${list.length} fighters match "${escapeRe(name)}"\\. Call again with one of these ids:`))
    await assert.rejects(() => fighterProfile({ fighter: name }), (err) => list.every((id) => err.message.includes(`id ${id}`)))
    for (const id of list) assert.equal((await call('ufc_get_fighter_profile', { fighter: id, group: 'context' })).structured.fighter.id, id)
    const found = await call('ufc_search_fighters', { query: name })
    assert.deepEqual(found.structured.fighters.slice(0, list.length).map((x) => x.id).sort(), [...list].sort())
    assert.ok(found.structured.notes.some((n) => /share a name/.test(n)))
  }
  // A nickname several fighters carry.
  await fails('ufc_get_fighter_profile', { fighter: 'Tank' }, /3 fighters match "Tank"\. Call again with one of these ids:\n- .*"Tank" \(id [0-9a-f]{16}\)/)
  // A surname alone.
  await fails('ufc_get_fighter_profile', { fighter: 'Nurmagomedov' }, /fighters match "Nurmagomedov"\. Call again with one of these ids:/)
  // A former name is not in the data: say so and offer the surname.
  await fails('ufc_get_fighter_profile', { fighter: 'Bobby Green' }, /No fighter matches "Bobby Green"\. Fighters named "Green":\n- King Green \(id 887961364be5ceb3\)[\s\S]*former or alternate name is not found/)
})

test('impossible questions get an answer that says what to try', async () => {
  const p = 'ufc_get_fighter_profile'
  await fails(p, { fighter: 'ffffffffffffffff' }, /No fighter has the id "ffffffffffffffff"\. Search by name with ufc_search_fighters\./)
  await fails(p, { fighter: 'Qwertyuiop Asdfgh' }, /No fighter matches "Qwertyuiop Asdfgh"\. Check the spelling/)
  await fails(p, { fighter: '   ' }, /Give a fighter name or id/)
  await fails(p, { fighter: 'Jon Jones', window: 'l10' }, /UFC Savant has no "l10" window\. Use one of: career \(UFC career\), l5 \(Last 5 fights\), l3 \(Last 3 fights\)\./)
  await fails(p, { fighter: 'Jon Jones', window: '2024' }, /has no "2024" window/)
  await fails(p, { fighter: 'Jon Jones', group: 'defense' }, /has no "defense" group\. Use one of: all, context, striking, grappling, finishing, rounds\./)
  // The schema refuses the same things before any of that runs.
  for (const bad of [{ fighter: 'Jon Jones', window: 'l10' }, { fighter: 'Jon Jones', group: 'defense' }, { fighter: '' }, { fighter: 'x'.repeat(81) }, {}, { fighter: 'Jon Jones', season: '2024' }]) {
    assert.equal(shape[p].input.safeParse(bad).success, false, JSON.stringify(bad))
  }
  for (const bad of [{ query: 'x' }, { query: 'jones', limit: 0 }, { query: 'jones', limit: 26 }, { query: 'x'.repeat(81) }, {}]) {
    assert.equal(shape.ufc_search_fighters.input.safeParse(bad).success, false, JSON.stringify(bad))
  }
  assert.equal(shape.ufc_get_upcoming_cards.input.safeParse({ when: 'now' }).success, false)
  // And accepts what it should, with the defaults filled in.
  assert.deepEqual(shape[p].input.parse({ fighter: ' Jon Jones ' }), { fighter: 'Jon Jones', window: 'career', group: 'all' })
  assert.deepEqual(shape.ufc_search_fighters.input.parse({ query: 'jones' }), { query: 'jones', limit: 10 })
  for (const w of WINDOWS) for (const g of ['all', ...Object.keys(GROUPS)]) assert.ok(shape[p].input.safeParse({ fighter: 'Jon Jones', window: w, group: g }).success)
})

test('files are fetched once and reused; when the data is down the answer is honest', async () => {
  clearCache()
  const before = hits
  await fighterProfile({ fighter: '275aca31f61ba28c' })
  await fighterProfile({ fighter: 'Islam Makhachev', window: 'l3', group: 'striking' })
  await searchFighters({ query: 'makhachev' })
  assert.equal(hits - before, 3, 'meta, the index and one fighter file: three fetches for three calls')
  await upcomingCards()
  assert.equal(hits - before, 4)
  // A leaderboard reads every fighter file once; after that, boards cost nothing.
  await leaderboard({ stat: 'tddef', division: 'LW' })
  assert.equal(hits - before, 4 + SHARDS.length - 1, 'the fifteen fighter files not yet read')
  await leaderboard({ stat: 'slpm', division: 'women', window: 'l5' })
  await leaderboard({ division: 'HW' })
  await compareFighters({ fighters: ['Islam Makhachev', 'Charles Oliveira'] })
  await listStats({})
  assert.equal(hits - before, 4 + SHARDS.length - 1)

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // A fighter file that is not there comes back as the homepage, with a 200.
    clearCache()
    const real = files.shards['2']
    delete files.shards['2']
    await fails('ufc_get_fighter_profile', { fighter: '275aca31f61ba28c' }, /UFC Savant data could not be loaded right now\. Try again in a minute\./)
    files.shards['2'] = real

    // The whole origin is unreachable.
    clearCache()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    await fails('ufc_search_fighters', { query: 'jones', limit: 10 }, /UFC Savant data could not be loaded right now/)
    await fails('ufc_get_fighter_profile', { fighter: 'Jon Jones' }, /UFC Savant data could not be loaded right now/)
    await fails('ufc_get_upcoming_cards', {}, /UFC Savant data could not be loaded right now/)
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    clearCache()
  }
  assert.equal((await call('ufc_search_fighters', { query: 'jon jones' })).structured.fighters[0].name, 'Jon Jones')
})

// ---- 3b. beyond one fighter --------------------------------------------------------------

// The page's Leaderboard Builder, run in the sandbox: its own lbPool() says who is on the
// board for a window, a division, a pool and a sample; lbRender() sorts them by the stat. The
// tool's board has to be the same fighters in the same order.
test('a leaderboard is the page\'s Leaderboard Builder: same fighters, same order', async () => {
  const pagePool = (lb) => {
    Object.assign(ctx.lb, { win: 'career', div: 'LW', rank: 'rank', top: 25, minMin: 0, ageMin: null, ageMax: null, stance: '', minN: 0, basis: 'active', sample: 'settled', dir: 'desc' }, lb)
    return vm.runInContext('lbPool().map(function(e){ return e.id; })', ctx)
  }
  const byKey = new Map(data.cfg.metrics.map((m) => [m.key, m]))
  let boards = 0
  const cases = []
  for (const key of ['tddef', 'slpm', 'sapm', 'diff', 'elo', 'kd15', 'ctrl15', 'finrate', 'koloss100', 'fade', 'beltdays', 'defenses', 'n']) {
    cases.push({ key, div: 'LW' }, { key, div: 'M' }, { key, div: 'F', win: 'l5' }, { key, div: 'HW', basis: 'all' }, { key, div: 'WSW', sample: 'all', win: 'l3' }, { key, div: 'BW', basis: 'all', sample: 'all' })
  }
  for (const c of cases) {
    const m = byKey.get(c.key)
    const win = c.win || 'career'
    const idsOnPage = [...pagePool({ win, div: c.div, rank: c.key, basis: c.basis || 'active', sample: c.sample || 'settled' })]
    const valueOf = (id) => data.fighters[id].w[win].m[c.key]
    const expected = idsOnPage.map((id) => [id, valueOf(id)]).sort((a, b) => (m.lower ? a[1] - b[1] : b[1] - a[1]))
    const division = c.div === 'M' ? 'men' : c.div === 'F' ? 'women' : c.div
    const { structured: st, text } = await call('ufc_get_leaderboard', { stat: c.key, division, window: win, pool: c.basis === 'all' ? 'all_time' : 'active', sample: c.sample === 'all' ? 'everyone' : 'settled', limit: 25 })
    boards++
    const tag = `${c.key} ${c.div} ${win} ${c.basis || 'active'} ${c.sample || 'settled'}`
    assert.equal(st.ranked, expected.length, `${tag}: who is on the board`)
    // Equal values can sit in either order; everything else is fixed.
    assert.deepEqual(st.leaders.map((l) => l.value), expected.slice(0, 25).map((x) => x[1]), tag)
    for (const l of st.leaders) {
      assert.equal(valueOf(l.id), l.value, `${tag} ${l.name}`)
      assert.ok(idsOnPage.includes(l.id), `${tag}: ${l.name} is not on the page's board`)
      assert.equal(l.rank, 1 + expected.filter((x) => (m.lower ? x[1] < l.value : x[1] > l.value)).length)
      assert.equal(l.display, ctx.fmt(m.unit, l.value))
      // The percentiles beside a fighter are his card's, in his own division.
      const cell = built(l.id).w[win].m[c.key]
      if (cell) assert.deepEqual([l.active_percentile, l.all_time_percentile], [cell[1], cell[2]], `${tag} ${l.name}`)
    }
    if (expected.length) assert.ok(text.includes(`${m.label}, ${meta.windows[win]}: the top ${st.count} of ${expected.length} `), text.slice(0, 160))
    // The link is the page's own, and the page opens it on the same board.
    page.written.length = 0
    assert.equal(page.open(st.url), true, `${tag}: the page opens the link`)
    assert.deepEqual([ctx.lb.win, ctx.lb.div, ctx.lb.rank, ctx.lb.basis, ctx.lb.sample], [win, c.div, c.key, c.basis || 'active', c.sample || 'settled'], tag)
  }
  assert.ok(boards > 70)

  // The official ranking: the UFC's own list as the data holds it, champion first.
  for (const d of data.cfg.divisions.filter((x) => x.key !== 'OPEN')) {
    const ranked = ids.filter((id) => (data.fighters[id].rks || {})[d.key] != null).sort((a, b) => data.fighters[a].rks[d.key] - data.fighters[b].rks[d.key])
    const { structured: st, text } = await call('ufc_get_leaderboard', { division: d.label, limit: 25 })
    assert.equal(st.mode, 'official_ranking')
    assert.deepEqual(st.leaders.map((l) => [l.id, l.rank]), ranked.slice(0, 25).map((id) => [id, data.fighters[id].rks[d.key]]), d.label)
    for (const l of st.leaders) assert.equal(l.rank_text, ctx.rankTxt(l.rank) === 'C' ? 'champion' : ctx.rankTxt(l.rank) === 'IC' ? 'interim champion' : ctx.rankTxt(l.rank))
    if (ranked.length) assert.ok(text.includes(`as of ${data.cfg.rankingsAt}`))
  }
  const p4p = (await call('ufc_get_leaderboard', {})).structured
  assert.deepEqual(p4p.leaders.map((l) => l.id), ids.filter((id) => data.fighters[id].p4p != null && (data.cfg.divisions.find((d) => d.key === data.fighters[id].w.career.div) || {}).sex !== 'F').sort((a, b) => data.fighters[a].p4p - data.fighters[b].p4p).slice(0, 10))

  // A title reign the data never closed is marked, not passed off as thirty years as champion.
  const reigns = (await call('ufc_get_leaderboard', { stat: 'days as champion', pool: 'all_time', limit: 25 })).structured
  for (const l of reigns.leaders) {
    const e = data.fighters[l.id]
    const open = (e.belts || []).some((b) => b.how === 'current' && (e.rks || {})[b.div] !== (b.interim ? 0.5 : 0))
    assert.equal(l.open_reign, open, l.name)
  }
  if (reigns.leaders.some((l) => l.open_reign)) assert.ok(reigns.notes.some((n) => /Marked "open reign"/.test(n)))
  // Divisions and stats by the names people use.
  for (const [said, label] of [['lightweights', 'Lightweight'], ['LW', 'Lightweight'], ['155', 'Lightweight'], ["women's strawweight", "Women's Strawweight"], ['heavyweight division', 'Heavyweight'], ['women', "all women's divisions"], ['pound for pound', "all men's divisions"]]) {
    assert.equal((await call('ufc_get_leaderboard', { stat: 'elo', division: said, limit: 1 })).structured.division, label, said)
  }
  await fails('ufc_get_leaderboard', { stat: 'elo', division: 'cruiserweight' }, /is not a UFC division\. Use one of: /)
  await fails('ufc_get_leaderboard', { stat: 'chin', division: 'LW' }, /No stat matches "chin"\. ufc_list_stats lists every stat/)
  // A women's division quotes only the explanations that fit: the page writes them about a man.
  const women = (await call('ufc_get_leaderboard', { stat: 'tddef', division: 'women' })).structured
  assert.equal(women.stat.what, /\b(he|his|him)\b/i.test(byKey.get('tddef').exp.w) ? null : byKey.get('tddef').exp.w)
})

test('a comparison says what the profiles say, and lists the fights between them', async () => {
  // Two fighters who met in one of their last five: found from the data, not named here.
  let pair = null
  for (const id of ids) {
    const e = data.fighters[id]
    const f = e.active && e.log.slice(0, RECENT_FIGHTS).find((x) => data.fighters[x.opp] && data.fighters[x.opp].log.slice(0, RECENT_FIGHTS).some((y) => y.id === x.id))
    if (f && e.w.career.qualified && data.fighters[f.opp].w.career.qualified) { pair = [id, f.opp]; break }
  }
  assert.ok(pair, 'no two qualified fighters met in their recent fights')
  for (const win of WINDOWS) {
    const { structured: st, text } = await call('ufc_compare_fighters', { fighters: pair, window: win })
    assert.deepEqual(st.fighters.map((f) => f.id), pair)
    assert.deepEqual(st.stats.map((x) => x.key), meta.headline)
    for (const [i, id] of pair.entries()) {
      const p = (await fighterProfile({ fighter: id, window: win })).structured
      assert.deepEqual([st.fighters[i].division, st.fighters[i].fights_in_window, st.fighters[i].qualified, st.fighters[i].pools.active, st.fighters[i].pools.all_time],
        [p.fighter.division, p.window.fights, p.window.qualified, p.pools.active.size, p.pools.all_time.size])
      for (const row of st.stats) {
        const on = p.stats.find((x) => x.key === row.key)
        const v = row.values[i]
        if (!on) { assert.notEqual(v.status, 'ok'); continue }
        assert.deepEqual([v.status, v.value, v.display, v.active_percentile, v.all_time_percentile, v.low_sample], ['ok', on.value, on.display, on.active_percentile, on.all_time_percentile, on.low_sample], `${win} ${p.fighter.name} ${row.key}`)
      }
    }
    // Every fight between them in either man's last five, once each, as the data has it.
    const met = data.fighters[pair[0]].log.slice(0, RECENT_FIGHTS).filter((x) => x.opp === pair[1])
    assert.deepEqual(st.meetings.map((m) => [m.date, m.winner_id]), met.map((x) => [x.date, x.res === 'W' ? pair[0] : x.res === 'L' ? pair[1] : null]))
    assert.ok(text.includes('Fights between them, newest first:'))
    // The head-to-head link opens the page on the same two fighters over the window compared.
    assert.equal(st.matchup_url, matchupUrl(meta, pair[0], pair[1], win))
    ctx.mu.a = null
    ctx.mu.b = null
    assert.equal(page.open(st.matchup_url), true)
    assert.deepEqual([ctx.mu.a, ctx.mu.b, ctx.mu.win], [pair[0], pair[1], win], `${win}: the page opened another head-to-head`)
  }
  const chosen = (await call('ufc_compare_fighters', { fighters: pair, stats: ['takedown defense', 'slpm'] })).structured
  assert.deepEqual(chosen.stats.map((x) => x.key), ['tddef', 'slpm'])
  assert.deepEqual((await call('ufc_compare_fighters', { fighters: pair, group: 'grappling' })).structured.stats.map((x) => x.key), meta.metrics.filter((m) => m.group === 'grap').map((m) => m.key))
  await fails('ufc_compare_fighters', { fighters: [pair[0], pair[0]] }, /is listed twice/)
  await fails('ufc_compare_fighters', { fighters: [pair[0], 'Nobody Atall'] }, /No fighter matches "Nobody Atall"/)
})

test('the glossary gives every stat its key and the page\'s own explanation', async () => {
  const all = (await call('ufc_list_stats', {})).structured
  const every = [...meta.metrics, ...meta.boardMetrics]
  assert.deepEqual(all.stats.map((x) => x.key), every.map((m) => m.key))
  const src = new Map(data.cfg.metrics.map((m) => [m.key, m]))
  for (const x of all.stats) {
    const e = src.get(x.key).exp || {}
    assert.deepEqual([x.label, x.what, x.formula, x.why, x.lower_is_better], [src.get(x.key).label, e.w || null, e.f || null, e.y || null, !!src.get(x.key).lower], x.key)
  }
  assert.deepEqual(all.stats.filter((x) => x.leaderboard_only).map((x) => x.key), data.cfg.metrics.filter((m) => !data.cfg.panels.includes(m.grp)).map((m) => m.key))
  assert.deepEqual((await call('ufc_list_stats', { group: 'grappling' })).structured.stats.map((x) => x.key), meta.metrics.filter((m) => m.group === 'grap').map((m) => m.key))
  assert.match((await call('ufc_list_stats', { query: 'rating' })).text, /Savant rating \(key "elo"\)/)
  assert.match((await call('ufc_list_stats', { query: 'zzzz' })).text, /No UFC Savant stat matches "zzzz"/)
})

test('the tools are declared the way the connector expects, and work through a real MCP client', async () => {
  assert.deepEqual(tools.map((t) => t.name), ['ufc_search_fighters', 'ufc_get_fighter_profile', 'ufc_get_upcoming_cards', 'ufc_get_leaderboard', 'ufc_compare_fighters', 'ufc_list_stats'])
  // Registered exactly as api/mcp.js registers a section.
  const server = new McpServer({ name: 'check', version: '0' })
  for (const t of tools) {
    server.registerTool(t.name, t.config, async (args) => {
      try {
        const { text, structured } = await t.run(args)
        return { content: [{ type: 'text', text }], structuredContent: structured }
      } catch (err) {
        if (err instanceof SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
        throw err
      }
    })
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'check', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  try {
    const listed = (await client.listTools()).tools
    assert.equal(listed.length, 6)
    for (const t of listed) {
      assert.ok(t.name.length <= 64 && /^ufc_[a-z_]+$/.test(t.name))
      assert.ok(t.title && t.annotations.title, `${t.name}: title`)
      assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint, t.annotations.openWorldHint], [true, false, true, false])
      assert.ok(t.description.length > 80 && t.description.length < 1200, `${t.name}: description`)
      assert.doesNotMatch(t.description, /\b(always|never|must|should|you)\b/i, `${t.name}: a description describes, it does not instruct`)
      assert.equal(t.inputSchema.type, 'object')
      assert.ok(t.outputSchema, `${t.name}: output schema`)
      for (const [k, prop] of Object.entries(t.inputSchema.properties || {})) assert.ok(prop.description, `${t.name}.${k}: described`)
    }
    // callTool validates structuredContent against the tool's output schema and throws if not.
    const text = (r) => r.content.map((c) => c.text).join('\n')
    const found = await client.callTool({ name: 'ufc_search_fighters', arguments: { query: 'Makhachev' } })
    assert.equal(found.structuredContent.fighters[0].url, 'https://wcehoops.com/ufc-savant.html#f=275aca31f61ba28c&w=career')
    const prof = await client.callTool({ name: 'ufc_get_fighter_profile', arguments: { fighter: 'Islam Makhachev' } })
    assert.ok(!prof.isError)
    assert.match(text(prof), /Takedown defense: \d+% \(vs\. active lightweights \d+(st|nd|rd|th), vs\. all-time lightweights \d+(st|nd|rd|th)\)/)
    const cards = await client.callTool({ name: 'ufc_get_upcoming_cards', arguments: { which: 'all' } })
    assert.equal(cards.structuredContent.count, data.upcoming.cards.length)
    for (const [name, args, expect] of [
      ['ufc_get_leaderboard', { division: 'lightweight' }, /official UFC Lightweight ranking/],
      ['ufc_get_leaderboard', { stat: 'takedown defense', division: 'LW' }, /Takedown defense, UFC career: the top 10 of \d+ active fighters in Lightweight/],
      ['ufc_compare_fighters', { fighters: ['Islam Makhachev', 'Charles Oliveira'] }, /side by side/],
      ['ufc_list_stats', { group: 'titles' }, /Days as champion \(key "beltdays"\)/],
    ]) {
      const r = await client.callTool({ name, arguments: args })
      assert.ok(!r.isError, `${name}: ${text(r).slice(0, 200)}`)
      assert.match(text(r), expect, name)
    }
    const shared = await client.callTool({ name: 'ufc_get_fighter_profile', arguments: { fighter: 'Bruno Silva' } })
    assert.ok(shared.isError)
    assert.match(text(shared), /2 fighters match/)
    assert.equal(shared.structuredContent, undefined)
    const bad = await client.callTool({ name: 'ufc_get_fighter_profile', arguments: { fighter: 'Jon Jones', window: 'l10' } })
    assert.ok(bad.isError)
  } finally {
    await client.close()
    await server.close()
  }
})

// ---- 4. the files --------------------------------------------------------------------

test('the index, the pools and the glossary are consistent with the data', () => {
  assert.equal(files.fighters.count, ids.length)
  assert.deepEqual(files.fighters.fighters.map((f) => f.id), ids)
  assert.equal(Object.values(files.shards).reduce((n, s) => n + Object.keys(s.fighters).length, 0), ids.length)
  for (const f of files.fighters.fighters) {
    const e = data.fighters[f.id]
    assert.deepEqual([f.name, f.div, f.active, f.n, f.first, f.last], [e.name, e.w.career.div, e.active, e.log.length, e.first, e.last])
    assert.ok(built(f.id), `${e.name} is in the file its id points to`)
    assert.equal(built(f.id).fights.length, Math.min(RECENT_FIGHTS, e.log.length))
  }
  // Pool sizes, counted straight from the data.
  for (const [w] of data.cfg.windows) {
    for (const baseline of ['active', 'all']) {
      const expect = {}
      for (const id of ids) {
        const e = data.fighters[id]
        if (!e.w[w].qualified || (baseline === 'active' && !e.active)) continue
        expect[e.w[w].div] = (expect[e.w[w].div] || 0) + 1
      }
      assert.deepEqual(meta.pools[w][baseline].div, expect, `${w} ${baseline}: pool sizes`)
    }
  }
  for (const m of meta.metrics) {
    const src = data.cfg.metrics.find((x) => x.key === m.key)
    assert.deepEqual([m.label, m.lowerIsBetter, m.since, m.lowSampleBelow, m.sample, m.explain], [src.label, !!src.lower, src.since, src.thr || null, src.den, src.exp])
    assert.ok(meta.units[m.unit], `unit "${m.unit}" has no description`)
    assert.ok(meta.groups[m.group], `group "${m.group}" has no label`)
  }
  // Every file carries the schema mark the shared loader insists on.
  for (const f of [files.meta, files.fighters, files.upcoming, ...Object.values(files.shards)]) assert.equal(f.schema, 1)
  assert.deepEqual(Object.keys(files.shards), SHARDS)
})

test('a page or data file the slicer cannot read stops it with a reason', () => {
  const broken = (change, pattern) => assert.throws(() => buildUfcApi(change({ data, html })), pattern)
  broken((x) => ({ ...x, html: x.html.replace('id="baseseg"', 'id="gone"') }), /control #baseseg not found/)
  broken((x) => ({ ...x, html: x.html.replace('var bandOn=false', 'var bandOn=true') }), /cage-time band now starts switched on/)
  broken((x) => ({ ...x, html: x.html.replace("h='#f='+curId+'&w='+win", "h='#fighter='+curId") }), /fighter link written by syncURL\(\) changed/)
  broken((x) => ({ ...x, html: x.html.replace('<button data-v="div" aria-pressed="true">Division</button>', '<button data-v="class" aria-pressed="true">Class</button>') }), /"Cohort" options changed/)
  broken((x) => ({ ...x, data: { ...x.data, cfg: undefined } }), /expected \{ cfg, fighters \}/)
  broken((x) => ({ ...x, data: { ...x.data, cfg: { ...x.data.cfg, metrics: x.data.cfg.metrics.map((m, i) => (i ? m : { ...m, unit: 'furlongs' })) } } }), /a unit this file cannot describe \("furlongs"\)/)
  broken((x) => ({ ...x, data: { ...x.data, cfg: { ...x.data.cfg, qualify: { career: [3, 15] } } } }), /cfg\.qualify has no line for "l5"/)
})

test('what is written to disk is what was built, and stays small', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-ufc-'))
  try {
    const r = writeUfcApi({ publicDir: PUBLIC, dist })
    const root = path.join(dist, BASE)
    assert.deepEqual(readdirSync(root).sort(), ['fighters', 'fighters.json', 'meta.json', 'upcoming.json'])
    assert.deepEqual(readdirSync(path.join(root, 'fighters')).sort(), SHARDS.map((s) => `${s}.json.gz`))
    assert.ok(readdirSync(path.join(root, 'fighters')).every((f) => /^[0-9a-f]\.json\.gz$/.test(f)), 'fighter files match the pattern the rewrite uses')
    for (const name of ['meta', 'fighters', 'upcoming']) assert.deepEqual(JSON.parse(readFileSync(path.join(root, `${name}.json`), 'utf8')), files[name])
    for (const s of SHARDS) assert.deepEqual(JSON.parse(gunzipSync(readFileSync(path.join(root, 'fighters', `${s}.json.gz`))).toString('utf8')), files.shards[s])
    assert.equal(r.files, 3 + SHARDS.length)
    assert.match(r.summary, /^[\d,]+ fighters, 3 windows, \d+ upcoming cards?$/)
    // Deployment Storage: Vercel keeps ~40 deployments, so every MB here costs 40.
    console.log(`      ${(r.raw / 1048576).toFixed(2)} MB of JSON, ${(r.bytes / 1048576).toFixed(2)} MB on disk, ${r.files} files`)
    assert.ok(r.bytes < BUDGET, `the UFC API files grew to ${(r.bytes / 1048576).toFixed(2)} MB, over the ${BUDGET / 1048576} MB budget`)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
