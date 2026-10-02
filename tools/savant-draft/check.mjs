// Check for the Draft Savant section of the AI connector: the files the build writes
// (scripts/lib/savant-api-draft.mjs) and the tools that read them (api/_draft.js).
//
//   node --test tools/savant-draft/check.mjs
//
// The point of the section is that an assistant can quote the number a fan sees on a Draft
// Savant card. So the test is not "does the slicer agree with itself" but "does it agree
// with the page", twice over:
//
//   1. It lifts the page's own code out of public/draft-savant.html — render(), barRow(),
//      poolFor(), pctOf(), the lot — runs it in a sandbox over the real public/data.json
//      with a stand-in for the document, and reads back what the page would have drawn for
//      every prospect in each of its six pools. Every value, percentile and pool size in the
//      built files is compared with that drawing.
//   2. It then asks the tools for every prospect in every pool and compares each answer with
//      the same drawing, so what an assistant is told is tied to the card itself and not
//      only to the files in between.
//
// A few of the page's rules never fire on today's data (no stat is limited to some draft
// years, nobody's BPM is the unconfirmed kind). Those are checked on a doctored copy of the
// page and the data, where they do fire, and pinned by their source text besides.
//
// If someone changes how the page ranks prospects, this fails until the slicer follows. If
// the page is restructured so its functions can no longer be found, it fails with the name
// of the missing piece. Either way: fix the slicer or the section, do not relax the check.
//
// No network, no keys, no new dependencies. Takes about half a minute: it draws every
// prospect's card in every pool four times over.

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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BASE, COHORTS, FIELDS, POOLS, buildDraftApi, poolIndex, readPageConfig, writeDraftApi } from '../../scripts/lib/savant-api-draft.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const html = readFileSync(path.join(PUBLIC, 'draft-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(PUBLIC, 'data.json'), 'utf8'))
const BUDGET = 1048576 // bytes on disk: Vercel keeps ~40 deployments, so every MB costs 40

// Through JSON once, because that is what gets published.
const publish = (out) => JSON.parse(JSON.stringify(out))
const out = publish(buildDraftApi({ data, html }))
const N = POOLS.length
const count = (n) => n.toLocaleString('en-US')

// ---- lifting the page's code ---------------------------------------------------------

// Index of the brace that closes the one at `open`, skipping strings and comments.
function closing(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
      if (i < 0) break
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1
      if (i < 1) break
    } else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

// The page's CFG object, as the text between its braces.
function cfgText(page) {
  const at = page.search(/const\s+CFG\s*=\s*\{/)
  assert.ok(at >= 0, 'the page no longer has CFG')
  const open = page.indexOf('{', at)
  return page.slice(open, closing(page, open) + 1)
}

// The page, running. Its own functions are lifted out of `page` and wrapped with the few
// globals they read; `document` is a stand-in that only remembers what was written to it.
// draw() selects a prospect and a pool exactly as clicking would, calls the page's render(),
// and returns the HTML the page produced.
function openPage(page, players) {
  const grabFunction = (name) => {
    const at = page.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
    assert.ok(at >= 0, `the page no longer has function ${name}()`)
    const end = closing(page, page.indexOf('{', page.indexOf(')', at)))
    assert.ok(end > at, `could not read function ${name}() out of the page`)
    return page.slice(at, end + 1)
  }
  const grabLine = (start) => {
    const at = page.indexOf(`\n${start}`)
    assert.ok(at >= 0, `the page no longer has a line starting "${start.trim()}"`)
    return page.slice(at + 1, page.indexOf('\n', at + 1))
  }

  const dom = new Map()
  const element = () => ({ innerHTML: '', textContent: '', hidden: false, style: {}, closest: () => ({ style: {} }) })
  const document = {
    getElementById: (id) => { if (!dom.has(id)) dom.set(id, element()); return dom.get(id) },
    querySelector: () => ({ style: {} }),
    querySelectorAll: () => [],
  }

  const run = vm.runInNewContext(`(function (DATA, CFG, document) {
    const METRICS = CFG.metrics;
    let PLAYERS = DATA.players;
    let pop = 'all', poolPop = 'class', curId = null, YEARS = [], PAST_YEARS = [];
    ${grabFunction('byId')}
    ${grabLine('const val=')}
    ${grabFunction('miss')}
    ${grabLine('const AGE_BAND=')}
    ${grabFunction('populationOf')}
    ${grabFunction('poolFor')}
    ${grabFunction('poolVals')}
    ${grabFunction('pctOf')}
    ${grabFunction('mix')}
    ${grabFunction('colorAt')}
    ${grabFunction('inFt')}
    ${grabFunction('fmt')}
    ${grabLine('const PREDICTIVE=')}
    ${grabFunction('shortLabel')}
    ${grabFunction('validEra')}
    ${grabFunction('barRow')}
    ${grabFunction('groupBlocks')}
    ${grabFunction('byKey')}
    ${grabFunction('stat')}
    ${grabFunction('updatePoolNote')}
    ${grabFunction('render')}
    function renderSignals() {}
    function animateFills() {}
    ${grabLine('  YEARS=')}
    ${grabLine('  PAST_YEARS=')}
    return {
      metrics: METRICS, val: val, miss: miss, fmt: fmt, byId: byId,
      draw: function (id, cohort, field) { curId = id; pop = cohort; poolPop = field; render(); },
      size: function (id, cohort, field) { pop = cohort; poolPop = field; return poolFor(byId(id)).length; },
      count: function (key, id, cohort, field) { pop = cohort; poolPop = field; return poolVals(key, byId(id)).length; },
    };
  })`)(structuredClone({ players }), JSON.parse(cfgText(page)), document)

  const get = (id) => document.getElementById(id)
  return {
    ...run,
    draw(id, cohort, field) {
      run.draw(id, cohort, field)
      return { head: get('idbody').innerHTML, bars: [get('ctx').innerHTML, get('off').innerHTML, get('def').innerHTML], note: get('poolnote').textContent }
    },
  }
}

// ---- reading what the page drew ------------------------------------------------------

// Text as a browser shows it: tags gone, entities decoded.
const shown = (s) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const first = (src, re) => { const m = src.match(re); return m ? shown(m[1]) : null }

const ROW = /<div class="group-h">([^<]*)<\/div>|<div class="row" data-k="([^"]+)" title="([^"]*)">[\s\S]*?<div class="tag">([^<]*)<\/div>[\s\S]*?<div class="pnum"[^>]*>([^<]*)<\/div><\/div><div class="rv">([^<]*)(?:<div class="rv-sub">([^<]*)<\/div>)?<\/div><\/div>/g

// One drawn card -> its header and its bars, as plain facts.
function readCard(drawn) {
  const head = drawn.head
  const rows = []
  for (const block of drawn.bars) {
    let sub = null
    let found = 0
    for (const m of block.matchAll(ROW)) {
      if (m[1] != null) { sub = shown(m[1]); continue }
      found++
      rows.push({ key: m[2], title: m[3], sub, tag: shown(m[4]), pct: m[5] === '·' ? null : +m[5], value: shown(m[6]), alt: m[7] ?? null })
    }
    // A row the pattern above could not read would otherwise go unchecked.
    assert.equal(found, (block.match(/<div class="row"/g) || []).length, 'could not read every bar the page drew')
  }
  const size = drawn.note.match(/\((\d+)\)/)
  return {
    badge: first(head, /<div class="pickbadge">(.*?)<\/div>/),
    name: first(head, /<div class="id-name">(.*?)<\/div>/),
    meta: first(head, /<div class="id-meta">(.*?)<\/div>/),
    arch: first(head, /<span class="archline">(.*?)<\/span>/),
    line: [...head.matchAll(/<span class="st"><b>(.*?)<\/b> (\w+)<\/span>/g)].map((m) => [m[2], m[1]]),
    sample: first(head, /<div class="samplenote">(.*?)<\/div>/),
    measures: Object.fromEntries([...head.matchAll(/<div class="ml">(.*?)<\/div><div class="mv">(.*?)<\/div>/g)].map((m) => [m[1], shown(m[2])])),
    rows,
    size: size ? +size[1] : null,
    note: drawn.note,
  }
}

const one = (v) => (v == null ? '—' : (+v).toFixed(1))

// Every prospect, every pool: the built files against what the page draws. Returns how many
// values were compared.
function compareWithPage(page, built) {
  const metrics = new Map(built.meta.metrics.map((m) => [m.key, m]))
  const order = built.meta.metrics.map((m) => m.key)
  let values = 0
  let prospects = 0
  let noPercentile = 0
  for (const cls of Object.values(built.classes)) {
    for (const row of cls.players) {
      prospects++
      const who = `${row.name} (${cls.year})`
      const src = page.byId(row.id)

      for (const { field, cohort } of POOLS) {
        const i = poolIndex(field, cohort)
        const card = readCard(page.draw(row.id, cohort, field))
        const where = `${who}, ${field}/${cohort}`

        // The bars: the same stats, in the same order, and nothing else.
        assert.deepEqual(card.rows.map((r) => r.key), order.filter((k) => row.m[k]), `${where}: which stats have a bar`)
        for (const bar of card.rows) {
          const m = metrics.get(bar.key)
          const cell = row.m[bar.key]
          const fallback = bar.tag.includes('source unconfirmed')
          assert.equal(cell.length, 1 + 2 * N, `${where} ${bar.key}: a value, six percentiles, six counts`)
          assert.equal(cell[1 + i], bar.pct, `${where} ${bar.key}: percentile`)
          assert.equal(cell[1 + N + i], page.count(bar.key, row.id, cohort, field), `${where} ${bar.key}: how many are ranked`)
          // The stored value prints, through the page's own formatter, as what the page printed.
          assert.equal(String(page.fmt(m.unit, cell[0])), bar.value, `${where} ${bar.key}: value as printed`)
          const raw = fallback ? src.bpm_torvik : page.val(src, bar.key)
          if (bar.key === 'age') assert.ok(Math.abs(cell[0] - raw) <= 0.05 + 1e-9, `${where}: age is the page's figure to one decimal`)
          else assert.equal(cell[0], raw, `${where} ${bar.key}: value`)
          assert.equal(bar.sub, m.sub, `${where} ${bar.key}: the heading it sits under`)
          assert.equal(bar.tag, `${m.layer.toUpperCase()}${fallback ? ' · source unconfirmed' : ''}`, `${where} ${bar.key}: tag`)
          assert.equal(fallback, (row.unconfirmed || []).includes(bar.key), `${where} ${bar.key}: unconfirmed flag`)
          assert.equal(bar.alt, bar.key === 'bpm' && row.torvik != null ? `Torvik ${row.torvik.toFixed(1)}` : null, `${where} ${bar.key}: second figure`)
          if (bar.pct == null) noPercentile++
          values += 3
        }
        // The pool: its size by the page's poolFor(), and by the number in the page's own note.
        assert.equal(row.sizes[i], page.size(row.id, cohort, field), `${where}: pool size`)
        assert.equal(row.sizes[i], card.size, `${where}: pool size in the page's note`)
        values++

        if (i > 0) continue
        // The header does not change with the pool: check it once.
        assert.equal(card.badge, `${cls.projected ? 'Projected ' : `${cls.year} · `}No. ${row.pick} · ${row.team}`, `${who}: pick badge`)
        assert.equal(card.name, row.name, `${who}: name`)
        const meta = [row.conf ? `${row.college || ''} (${row.conf})` : (row.college || ''), row.pos]
        if (row.gp != null) meta.push(`${row.gp} GP`)
        assert.equal(card.meta, meta.join(' · '), `${who}: school, position, games`)
        assert.equal(card.arch, row.arch, `${who}: archetype`)
        const line = row.line
          ? [['PPG', one(row.line.ppg)], ['RPG', one(row.line.rpg)], ['APG', one(row.line.apg)], ...(row.line.tpg != null ? [['TPG', one(row.line.tpg)]] : [])]
          : []
        assert.deepEqual(card.line, line, `${who}: per-game line`)
        assert.equal(card.sample != null, !!row.thin, `${who}: reduced-sample note`)
        if (row.thin) assert.ok(card.sample.startsWith(`${row.gp}-game season`), `${who}: reduced-sample note names his games`)
        const meas = row.meas
        assert.deepEqual(card.measures, {
          Height: meas.height == null ? '—' : page.fmt('ftin', meas.height),
          Wingspan: meas.wing == null ? '—' : page.fmt('ftin', meas.wing),
          Reach: meas.reach == null ? '—' : page.fmt('ftin', meas.reach),
          'Max vert': meas.vert == null ? '—' : `${meas.vert.toFixed(1)}"`,
          Weight: meas.weight == null ? '—' : String(Math.round(meas.weight)),
        }, `${who}: measurements`)
        values += 7 + line.length + Object.keys(meas).length
      }
    }
  }
  return { values, prospects, noPercentile }
}

// ---- the files, against the page -------------------------------------------------------

const page = openPage(html, data.players)
const cfg = readPageConfig(html)

test('the rules that live inline in the page are still written the way the slicer reads them', () => {
  const pinned = [
    // The default view: All x This class.
    ["let pop='all';", 'the default "Compare against"'],
    ["let poolPop='class';", 'the default "Pool"'],
    ['<button data-v="all" aria-pressed="true">All</button>', 'the default "Compare against" button'],
    ['<button data-v="class" aria-pressed="true">This class</button>', 'the default "Pool" button'],
    // The current class: left out of "Past drafts", and shown as projected.
    ['PAST_YEARS=YEARS.filter(y=>y!==2026);', 'which class is left out of "Past drafts"'],
    ["(p.draft_year===2026?'Projected ':p.draft_year+' · ')+'<b>No. '+p.draft_pick+'</b> · '+p.draft_team", 'the pick badge'],
    // What gets a bar, and BPM's second source.
    ["if(!validEra(m,ref)) return '';", 'the draft-year gate in barRow()'],
    ["if(m.key==='bpm' && miss(v) && ref.bpm_torvik!=null){ v=ref.bpm_torvik; torvikFallback=true; }", 'the BPM fallback in barRow()'],
    ["if(miss(v)) return '';", 'the rule that hides an empty bar in barRow()'],
    ["if(m.key==='bpm' && !torvikFallback && ref.bpm_torvik!=null) sub='<div class=\"rv-sub\">Torvik '+ref.bpm_torvik.toFixed(1)+'</div>';", 'the second BPM figure in barRow()'],
    // The header.
    ['const thin=(p.gp!=null && p.gp<30);', 'the reduced-sample rule'],
    ['const r1=rows(1,30), r2=rows(31,60);', 'which picks the draft board calls the first round'],
    ['const hasLine=p.line.ppg!=null||p.line.rpg!=null||p.line.apg!=null;', 'when the per-game line is shown'],
    ["'<div class=\"m\"><div class=\"ml\">Max vert</div><div class=\"mv\">'+(miss(vt)?'—':vt.toFixed(1)+'\"')+'</div></div>'", 'max vertical in the header'],
    // Words the tools quote or lean on.
    ["' Bars use pre-draft college rate stats, shot-location and combine data — never NBA stats;", 'the sentence the profile quotes'],
    ['age:"Decimal age as of Feb 1,', 'the page\'s own account of the age figure'],
    ["this prospect's team's national SOS rank (KenPom,", 'the page\'s account of strength of schedule'],
    ['Source varies by player here', 'the page\'s caution about BPM'],
  ]
  for (const [text, what] of pinned) assert.ok(html.includes(text), `${what} changed in draft-savant.html: re-read it, then update the slicer and this line`)

  // What the slicer read out of the page.
  assert.equal(cfg.currentClass, 2026)
  assert.equal(cfg.ageBand, 1)
  assert.equal(cfg.thinBelow, 30)
  assert.equal(cfg.firstRound, 30)
  assert.deepEqual(cfg.cohortLabels, { all: 'All', pos: 'Same position', age: 'Similar age' })
  assert.deepEqual(cfg.fieldLabels, { class: 'This class', past5: 'Past drafts' })
  assert.deepEqual(cfg.groups, { ctx: 'Context', off: 'Offense', def: 'Defense & tools' })
  assert.deepEqual(out.meta.metrics.map((m) => m.key), page.metrics.map((m) => m.key))
  for (const m of out.meta.metrics) {
    const src = page.metrics.find((x) => x.key === m.key)
    assert.equal(m.lowerIsBetter, !!src.lower, `${m.key}: lower is better`)
    assert.deepEqual([m.validFrom, m.validTo], [src.valid_from ?? null, src.valid_to ?? null], `${m.key}: draft years`)
    assert.ok(out.meta.units[m.unit], `unit "${m.unit}" has no description`)
    assert.ok(out.meta.groups[m.group], `group "${m.group}" has no label`)
  }
})

test('the page still has no link that opens one prospect', () => {
  // The tools link to the page itself because the page reads nothing from its address: it
  // always starts on the home screen, and "#p" only records that the home screen was left.
  // If the page learns to open a prospect from its address, the tools should link to him.
  assert.deepEqual((html.match(/location\.(?:search|hash|href|pathname)/g) || []).sort(), [
    'location.hash', 'location.hash', 'location.href',
    'location.pathname', 'location.pathname', 'location.pathname',
    'location.search', 'location.search', 'location.search',
  ], 'the page reads its address in a new way')
  assert.ok(!html.includes('URLSearchParams'), 'the page now parses its query string')
  assert.ok(html.includes("if(location.hash==='#p'){ document.body.classList.remove('home-open'); }"), 'what "#p" means changed')
  assert.ok(html.includes('wireHome(); showHome();'), 'the page no longer always starts on its home screen')
  assert.equal(out.meta.prospectUrl, null)
  assert.equal(out.meta.page, 'https://wcehoops.com/draft-savant.html')
})

test('every value, percentile and pool size matches the page, for every prospect in all six pools', () => {
  const r = compareWithPage(page, out)
  console.log(`      ${count(r.values)} values compared with the page's own drawing: ${count(r.prospects)} prospects x ${N} pools (${count(r.noPercentile)} bars where the page shows no percentile)`)
  assert.equal(r.prospects, data.players.length)
  assert.ok(r.values > 180000, 'suspiciously few values were compared')
  assert.ok(r.noPercentile > 0, 'the real data should include bars with no percentile')
})

test('classes, the index and the provenance are what the data says', () => {
  const years = [...new Set(data.players.map((p) => p.draft_year))].sort((a, b) => b - a)
  assert.deepEqual(Object.keys(out.classes).map(Number).sort((a, b) => b - a), years)
  assert.deepEqual(out.meta.classes.map((c) => c.year), years)
  for (const year of years) {
    const cls = out.classes[year]
    const src = data.players.filter((p) => p.draft_year === year)
    assert.equal(cls.schema, 1)
    assert.equal(cls.projected, year === cfg.currentClass)
    assert.equal(cls.count, src.length)
    assert.deepEqual(cls.players.map((r) => r.id), [...src].sort((a, b) => a.draft_pick - b.draft_pick).map((p) => p.id), `${year}: every prospect, in pick order`)
    assert.deepEqual(cls.picks, [Math.min(...src.map((p) => p.draft_pick)), Math.max(...src.map((p) => p.draft_pick))])
    for (const m of out.meta.metrics) assert.equal(cls.have[m.key], cls.players.filter((r) => r.m[m.key]).length, `${year} ${m.key}: how many have it`)
  }
  assert.deepEqual(out.meta.past.years, years.filter((y) => y !== cfg.currentClass).sort((a, b) => a - b))
  assert.equal(out.meta.past.count, data.players.filter((p) => p.draft_year !== cfg.currentClass).length)
  assert.equal(out.meta.past.firstRoundOnly, data.players.every((p) => p.draft_year === cfg.currentClass || p.draft_pick <= cfg.firstRound))

  assert.equal(out.prospects.count, data.players.length)
  assert.equal(new Set(out.prospects.prospects.map((r) => r.id)).size, data.players.length)
  for (const r of out.prospects.prospects) {
    const src = data.players.find((p) => p.id === r.id)
    assert.deepEqual([r.year, r.pick], [src.draft_year, src.draft_pick], `${r.name}: class and pick`)
  }

  // The data's own account of itself travels untouched.
  assert.equal(out.meta.source, data.source)
  assert.equal(out.meta.note, data.note)
  assert.ok(out.meta.source && out.meta.note, 'data.json lost its source or its note: the tools quote both')
})

test('the age figure is the age on February 1 of the draft year, and birth dates stay out', () => {
  // The claim the tools make about "Draft-day age" is one the build works out, not one it
  // assumes. This re-derives it, and shows it is not the age on a June draft night.
  let checked = 0
  let wouldBeDraftNight = 0
  for (const p of data.players) {
    const age = p.m.age && p.m.age.v
    if (age == null || !p.birthdate) continue
    const born = Date.parse(`${p.birthdate}T00:00:00Z`)
    const on = (month, day) => (Date.UTC(p.draft_year, month - 1, day) - born) / 86400000 / 365.25
    assert.ok(Math.abs(on(2, 1) - age) <= 0.0051, `${p.name}: age ${age} is not his age on February 1, ${p.draft_year}`)
    if (Math.abs(on(6, 25) - age) <= 0.05) wouldBeDraftNight++
    checked++
  }
  assert.ok(checked > 500)
  assert.equal(wouldBeDraftNight, 0)
  assert.equal(out.meta.ageAsOf, 'February 1 of the draft year')
  // Move one birthday and the build stops making the claim.
  const moved = structuredClone(data)
  moved.players[0].birthdate = '2006-06-15'
  assert.equal(buildDraftApi({ data: moved, html }).meta.ageAsOf, null)

  const all = JSON.stringify(out)
  assert.ok(!/birth/i.test(all.replace(JSON.stringify(out.meta.note), '')), 'a birth-date field reached the files')
  for (const p of data.players) if (p.birthdate) assert.ok(!all.includes(p.birthdate), `${p.name}'s birth date reached the files`)
  for (const cls of Object.values(out.classes)) {
    for (const r of cls.players) if (r.m.age) assert.equal(r.m.age[0], +r.m.age[0].toFixed(1), `${r.name}: age is kept to one decimal`)
  }
})

test('a page or data file that has changed shape is refused, by name', () => {
  const bad = (page, expect) => assert.throws(() => buildDraftApi({ data, html: page }), expect)
  bad(html.replace('const CFG', 'const CONFIG'), /CFG not found/)
  bad(html.replace('const AGE_BAND=', 'const AGEBAND='), /AGE_BAND not found/)
  bad(html.replace('y=>y!==2026', 'y=>y<2026'), /"past drafts" rule not found/)
  bad(html.replace("p.draft_year===2026?'Projected '", "p.draft_year===2027?'Projected '"), /disagrees with itself/)
  bad(html.replace('p.gp<30', 'p.gp<=30'), /reduced-sample rule not found/)
  bad(html.replace('const r1=rows(1,30)', 'const r1=rows(first)'), /draft board's first round not found/)
  bad(html.replace('<button data-v="age"', '<button data-v="archetype"'), /#popseg control/)
  bad(html.replace('"unit": "pct3"', '"unit": "furlongs"'), /unit this file cannot describe/)
  assert.throws(() => buildDraftApi({ data: { players: [] }, html }), /expected \{ players/)
  const twice = structuredClone(data)
  twice.players[1].id = twice.players[0].id
  assert.throws(() => buildDraftApi({ data: twice, html }), /share the id/)
})

// ---- rules today's data never exercises ------------------------------------------------

// A copy of the page whose stats are limited to some draft years, and a copy of the data in
// which BPM's fallback, the reduced-sample line, the age band's edge and a one-player pool
// all occur. Built once; used against the page here and against the tools further down.
function doctored() {
  const c = JSON.parse(cfgText(html))
  const set = (key, patch) => Object.assign(c.metrics.find((m) => m.key === key), patch)
  set('ts', { valid_from: 2015 })               // older classes lose it
  set('ator', { valid_to: 2020 })               // newer classes lose it
  set('reach', { valid_from: 2021, valid_to: 2025 })
  set('sos', { valid_from: null, valid_to: null })
  const page2 = html.replace(cfgText(html), JSON.stringify(c))

  const d = structuredClone(data)
  const by = (id) => d.players.find((p) => p.id === id)
  const inClass = (year) => d.players.filter((p) => p.draft_year === year)
  by('boozer').m.bpm.v = null                   // has a Torvik figure: the page falls back to it
  const wall = by('john-wall-2010')
  delete wall.m.bpm                             // no cell at all, and a Torvik figure
  wall.bpm_torvik = 3.3
  wall.gp = 29                                  // one game under the line
  by('evan-turner-2010').gp = 30                // on the line: not a reduced sample
  const twelve = inClass(2012)
  twelve.forEach((p, i) => { if (i > 0) delete p.m.wing })   // a pool of one
  twelve[0].m.wing = { v: 80, n: null }
  const [a, b, far] = inClass(2013)
  a.m.age = { v: 20, n: null }
  b.m.age = { v: 21, n: null }                  // exactly one year older: inside the band
  far.m.age = { v: 21.01, n: null }             // a hair more: outside it
  return { page: page2, data: d, ids: { fallback: 'boozer', bare: wall.id, onLine: 'evan-turner-2010', alone: twelve[0].id, others: twelve[1].id, a: a.id, b: b.id, far: far.id } }
}
const alt = doctored()
const altOut = publish(buildDraftApi({ data: alt.data, html: alt.page }))

test('rules today\'s data never exercises still match the page: draft-year gates, the BPM fallback, edges', () => {
  const page2 = openPage(alt.page, alt.data.players)
  const r = compareWithPage(page2, altOut)
  console.log(`      ${count(r.values)} values compared on the doctored page and data`)

  const find = (id) => Object.values(altOut.classes).flatMap((c) => c.players).find((p) => p.id === id)
  const i = poolIndex('class', 'all')
  // Draft-year gates: the stat is gone for the classes outside its years and kept inside.
  assert.equal(find(alt.ids.bare).m.ts, undefined, 'a 2010 prospect keeps a stat that starts in 2015')
  assert.ok(find('kristaps-porzingis-2015') && altOut.classes[2015].players.some((p) => p.m.ts), '2015 lost the stat that starts in 2015')
  assert.ok(altOut.classes[2026].players.every((p) => !p.m.ator && !p.m.reach), '2026 keeps stats that ended before it')
  assert.ok(altOut.classes[2020].players.every((p) => !p.m.reach), '2020 keeps a stat that starts in 2021')
  // The header still prints a measurement whose bar is gated.
  assert.ok(altOut.classes[2026].players.some((p) => p.meas.reach != null))
  // BPM falls back to the Torvik figure, flagged, and is ranked against labelled BPM only.
  for (const id of [alt.ids.fallback, alt.ids.bare]) {
    const row = find(id)
    assert.deepEqual(row.unconfirmed, ['bpm'], `${id}: unconfirmed`)
    assert.equal(row.torvik, undefined, `${id}: no second figure beside a fallback`)
  }
  assert.equal(find(alt.ids.fallback).m.bpm[0], 20.1)
  assert.equal(find(alt.ids.bare).m.bpm[0], 3.3)
  assert.equal(find(alt.ids.bare).m.bpm[1 + N + i], 28, 'the fallback value is not in its own pool')
  // The reduced-sample line is "fewer than", not "up to".
  assert.equal(find(alt.ids.bare).thin, true)
  assert.equal(find(alt.ids.onLine).thin, undefined)
  // A pool of one has no percentile.
  assert.deepEqual([find(alt.ids.alone).m.wing[1 + i], find(alt.ids.alone).m.wing[1 + N + i]], [null, 1])
  // "Within a year" includes exactly a year.
  const age = poolIndex('class', 'age')
  const near = (id) => alt.data.players.filter((p) => p.draft_year === 2013 && p.m.age && Math.abs(p.m.age.v - alt.data.players.find((q) => q.id === id).m.age.v) <= 1).length
  assert.equal(find(alt.ids.a).sizes[age], near(alt.ids.a))
  assert.ok(near(alt.ids.a) < 30 && near(alt.ids.a) >= 2)
})

// ---- the tools -----------------------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// The site's CDN: the three kinds of file, and the homepage for anything else (which is
// what the live catch-all rewrite does, with a 200). `served` can be swapped for the
// doctored build.
let served = out
let hits = 0
const cdn = http.createServer((req, res) => {
  hits++
  const p = decodeURIComponent(req.url).replace(`/${BASE}/`, '')
  const cls = p.match(/^classes\/(\d{4})\.json$/)
  const body = p === 'meta.json' ? served.meta : p === 'prospects.json' ? served.prospects : cls ? served.classes[cls[1]] : null
  if (!body) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})

let draft
let core
let client
let search
let profile

before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  core = await import('../../api/_core.js')
  draft = await import('../../api/_draft.js')
  search = draft.tools.find((t) => t.name === 'nba_draft_search_prospects')
  profile = draft.tools.find((t) => t.name === 'nba_draft_get_prospect_profile')

  // The tools as the connector registers them (api/mcp.js does exactly this), reached by a
  // real MCP client over an in-process pipe.
  const server = new McpServer({ name: 'check', version: '0' })
  for (const tool of draft.tools) {
    server.registerTool(tool.name, tool.config, async (args) => {
      try {
        const { text, structured } = await tool.run(args)
        return { content: [{ type: 'text', text }], structuredContent: structured }
      } catch (err) {
        if (err instanceof core.SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
        throw err
      }
    })
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'check', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
})

after(async () => {
  await client.close()
  cdn.close()
})

const call = (name, args) => client.callTool({ name, arguments: args })
const textOf = (r) => r.content.map((c) => c.text).join('\n')
const input = (tool, args) => z.object(tool.config.inputSchema).parse(args)
const output = (tool, structured) => z.object(tool.config.outputSchema).strict().parse(structured)

// Run a tool the way the connector does: the arguments through its input shape (which fills
// the defaults), the result through its output shape.
async function run(tool, args) {
  const r = await tool.run(input(tool, args))
  output(tool, r.structured)
  return r
}
const fails = async (tool, args, expect) => {
  await assert.rejects(() => run(tool, args), (err) => {
    assert.ok(err instanceof core.SavantError, `${JSON.stringify(args)}: expected a SavantError, got ${err}`)
    assert.match(err.message, expect, JSON.stringify(args))
    assert.doesNotMatch(err.message, /127\.0\.0\.1|localhost|ECONN|at .*\.js|savant-api\//, 'an internal detail leaked')
    return true
  })
}

const COMPARE = { all: 'all', pos: 'position', age: 'age' }
const FIELD = { class: 'class', past5: 'past' }
const provenanceOf = (meta) => String(meta.note).replace(/\.\s*$/, '')

// Every prospect in every pool: the tool's answer against the built files, and against the
// page's drawing when a page is given. Returns the counts.
async function compareTools(built, page) {
  const metrics = built.meta.metrics
  const unit = new Map(metrics.map((m) => [m.key, m.unit]))
  let profiles = 0
  let stats = 0
  let longest = 0
  for (const cls of Object.values(built.classes)) {
    const inEra = (m) => (m.validFrom == null || cls.year >= m.validFrom) && (m.validTo == null || cls.year <= m.validTo)
    for (const row of cls.players) {
      for (const { field, cohort } of POOLS) {
        const i = poolIndex(field, cohort)
        const where = `${row.name} (${cls.year}), ${field}/${cohort}`
        const { structured: s, text } = await run(profile, { prospect: row.id, compare: COMPARE[cohort], pool: FIELD[field] })
        profiles++
        longest = Math.max(longest, text.length)

        assert.equal(s.prospect.id, row.id)
        assert.deepEqual(
          [s.prospect.name, s.prospect.college, s.prospect.conference, s.prospect.position, s.prospect.archetype, s.prospect.games, s.prospect.reduced_sample],
          [row.name, row.college, row.conf, row.pos, row.arch, row.gp, !!row.thin], `${where}: who he is`)
        assert.deepEqual([s.draft.year, s.draft.pick, s.draft.team, s.draft.projected], [cls.year, row.pick, row.team, cls.projected], `${where}: draft`)
        assert.deepEqual(s.per_game, row.line ? { points: row.line.ppg, rebounds: row.line.rpg, assists: row.line.apg, turnovers: row.line.tpg } : null, `${where}: per-game line`)
        assert.deepEqual(s.measurements, {
          height_in: row.meas.height ?? null, wingspan_in: row.meas.wing ?? null, standing_reach_in: row.meas.reach ?? null,
          max_vertical_in: row.meas.vert ?? null, weight_lb: row.meas.weight ?? null,
        }, `${where}: measurements`)
        assert.deepEqual([s.pool.compare, s.pool.pool, s.pool.size, s.pool.page_default], [COMPARE[cohort], FIELD[field], row.sizes[i], i === 0], `${where}: pool`)

        // Every stat in the file is in the profile, and nothing else is; the rest is
        // accounted for as missing or not tracked, never as a zero.
        assert.deepEqual(s.stats.map((x) => x.key), metrics.map((m) => m.key).filter((k) => row.m[k]), `${where}: stat list`)
        assert.deepEqual(s.missing.map((x) => [x.key, x.whole_class]), metrics.filter((m) => !row.m[m.key] && inEra(m)).map((m) => [m.key, cls.have[m.key] === 0]), `${where}: missing`)
        assert.deepEqual(s.not_tracked.map((x) => x.key), metrics.filter((m) => !inEra(m)).map((m) => m.key), `${where}: not tracked`)
        for (const x of s.stats) {
          const cell = row.m[x.key]
          assert.deepEqual([x.value, x.percentile, x.ranked], [cell[0], cell[1 + i], cell[1 + N + i]], `${where} ${x.key}: value, percentile, ranked`)
          assert.equal(!!x.source_unconfirmed, (row.unconfirmed || []).includes(x.key), `${where} ${x.key}: unconfirmed`)
          assert.deepEqual(x.alternate, x.key === 'bpm' && row.torvik != null ? { source: 'Torvik', value: row.torvik, display: row.torvik.toFixed(1) } : undefined)
          assert.equal(x.as_of, x.key === 'sos' ? row.sosAsOf : undefined)
          // The pool is named on the stat's own line.
          const line = text.split('\n').find((l) => l.startsWith(`- ${x.label}: `))
          assert.ok(line, `${where} ${x.key}: has a line`)
          const standing = x.percentile == null
            ? `no percentile ${s.pool.short_label}: ${x.ranked ? `only ${x.ranked}` : 'none'} ranked`
            : `${core.ordinal(x.percentile)} ${s.pool.short_label}, ${x.ranked} ranked`
          assert.ok(line.includes(`(${standing}`), `${where} ${x.key}: "${line}" names its pool`)
          assert.equal(x.percentile == null, x.ranked < 2, `${where} ${x.key}: no percentile exactly when fewer than two are ranked`)
          stats++
        }

        // What every answer says.
        assert.equal(s.notes[0], s.pool.label)
        for (const note of s.notes) assert.ok(text.includes(note), `${where}: the text carries every note`)
        assert.ok(text.includes(String(row.sizes[i])), `${where}: the text gives the pool size`)
        assert.ok(s.notes.some((n) => n.includes(provenanceOf(built.meta)) && n.includes(built.meta.source)), `${where}: provenance`)
        assert.ok(/not NBA stats/.test(text), `${where}: says it is not NBA data`)
        assert.ok(text.includes(built.meta.page) && s.url === built.meta.page, `${where}: links the page`)
        assert.equal(cls.projected, /"Projected"/.test(text), `${where}: only the current class is called projected`)
        assert.equal(cls.projected, !/Drafted No\./.test(text), `${where}: only past classes are called drafted`)
        assert.equal(!!row.thin, /reduced sample/.test(text), `${where}: reduced-sample caution`)
        // The claim about the age figure is made only when the build could confirm it.
        assert.equal(!!row.m.age && !!built.meta.ageAsOf, /not on draft night/.test(text), `${where}: what the age figure is`)
        assert.ok(text.length < 12000, `${where}: ${text.length} characters`)
        const src = (page ? page.byId(row.id) : null) || {}
        if (src.birthdate) assert.ok(!text.includes(src.birthdate) && !JSON.stringify(s).includes(src.birthdate), `${where}: no birth date`)

        if (!page) continue
        // And against the card itself.
        const card = readCard(page.draw(row.id, cohort, field))
        assert.equal(s.draft.label, card.badge, `${where}: pick badge`)
        assert.equal(s.prospect.reduced_sample, card.sample != null, `${where}: the page's reduced-sample note`)
        assert.equal(s.prospect.archetype, card.arch, `${where}: archetype on the page`)
        assert.equal(s.pool.size, card.size, `${where}: pool size on the page`)
        assert.deepEqual(s.stats.map((x) => x.key), card.rows.map((r) => r.key), `${where}: the page's bars`)
        s.stats.forEach((x, k) => {
          const bar = card.rows[k]
          assert.equal(x.percentile, bar.pct, `${where} ${x.key}: percentile on the page`)
          // The two documented differences in how a value is printed.
          const u = unit.get(x.key)
          const carried = bar.value.match(/^(\d+)'12"$/)
          const theirs = u === 'lb' ? `${bar.value} lb` : carried ? `${+carried[1] + 1}'0"` : bar.value
          assert.equal(x.display, theirs, `${where} ${x.key}: value as the page prints it`)
        })
      }
    }
  }
  return { profiles, stats, longest }
}

test('a profile says what the files and the page say, for every prospect in all six pools', async () => {
  core.clearCache()
  const start = hits
  const r = await compareTools(out, page)
  console.log(`      ${count(r.profiles)} profiles, ${count(r.stats)} stats, each checked against the files and the page; longest answer ${count(r.longest)} characters`)
  assert.equal(r.profiles, data.players.length * N)
  // Every file is fetched once and kept: a run across all the classes does not push the
  // glossary out of memory and fetch it again.
  assert.equal(hits - start, Object.keys(out.classes).length + 2, 'files were fetched more than once')
})

test('the tools follow the doctored page too: not tracked, unconfirmed, one-player pools', async () => {
  served = altOut
  core.clearCache()
  try {
    const r = await compareTools(altOut, openPage(alt.page, alt.data.players))
    assert.equal(r.profiles, alt.data.players.length * N)

    const wall = await run(profile, { prospect: alt.ids.bare })
    assert.deepEqual(wall.structured.not_tracked.map((x) => x.key), ['ts', 'reach'])
    assert.match(wall.text, /Not tracked for the 2010 class: True shooting %, Standing reach\./)
    assert.match(wall.text, /- BPM: 3\.3 \(.*\) \[source unconfirmed\]/)
    assert.match(wall.text, /"source unconfirmed": treat it as approximate/)
    assert.match(wall.text, /a 29-game season/)
    assert.doesNotMatch((await run(profile, { prospect: alt.ids.onLine })).text, /reduced sample/)
    const alone = await run(profile, { prospect: alt.ids.alone, group: 'defense' })
    assert.match(alone.text, /- Wingspan: 6'8" \(no percentile vs\. the 2012 first round: only 1 ranked\)/)
    const other = await run(profile, { prospect: alt.ids.others, group: 'defense' })
    assert.deepEqual(other.structured.missing.find((x) => x.key === 'wing'), { key: 'wing', label: 'Wingspan', whole_class: false })
    // A gated bar does not take the measurement out of the header.
    const gated = altOut.classes[2026].players.find((p) => p.meas.reach != null)
    const g = await run(profile, { prospect: gated.id })
    assert.equal(g.structured.measurements.standing_reach_in, gated.meas.reach)
    assert.ok(g.structured.not_tracked.some((x) => x.key === 'reach'))
  } finally {
    served = out
    core.clearCache()
  }
})

test('the answer reads the way a fan would need it to', async () => {
  const top = out.classes[cfg.currentClass].players[0]
  const { structured: s, text } = await run(profile, { prospect: top.name })
  assert.equal(s.prospect.id, top.id)
  assert.equal(s.pool.short_label, `vs. the ${cfg.currentClass} class`)
  assert.match(s.pool.label, new RegExp(`against the ${cfg.currentClass} draft class as the page lists it: ${top.sizes[0]} prospects, all positions\\. This is the page's default view\\.`))
  assert.match(text, new RegExp(`^${top.name}: Draft Savant pre-draft profile \\(college and combine data, not NBA stats\\)\\n${cfg.currentClass} class: projected No\\. ${top.pick}, ${top.team}\\.`))
  assert.match(text, /Provenance: this is a fixed data file compiled by WCE, some of it transcribed by hand, not a live or official feed \(the file is tagged "hardcoded-v1"\)\. Its own note reads: "2026 top-3 prospects: /)
  assert.match(text, /it has no link that opens one prospect/)
  // Nothing the page does not show as a number: no grade, no comparison, no scouting take.
  const src = data.players.find((p) => p.id === top.id)
  assert.ok(src.scouting && !text.includes(src.scouting.slice(0, 40)), 'the scouting take is not carried')
  assert.doesNotMatch(text, /composite|grade|\bcomps?\b|should (draft|pick)/i)
  assert.doesNotMatch(text, /\bPER\b|Predictive|Scouting/)

  // Each control changes the pool, and the answer says which one it used.
  const cases = [
    [{ compare: 'position' }, /^vs\. \d{4}-class (guards|wings|bigs)$/, /"Same position" under Compare against, with "This class" under Pool/],
    [{ compare: 'age' }, /^vs\. the \d{4} class near his age$/, /whose age is within 1 year of his \(\d+\.\d\)/],
    [{ pool: 'past' }, /^vs\. \d{4}-\d{2} first-rounders$/, /first-round picks from the \d{4} to \d{4} drafts: \d+ players, all positions/],
    [{ compare: 'position', pool: 'past' }, /^vs\. \d{4}-\d{2} first-round (guards|wings|bigs)$/, /"Same position" under Compare against, with "Past drafts" under Pool/],
    [{ compare: 'age', pool: 'past' }, /^vs\. \d{4}-\d{2} first-rounders near his age$/, /"Similar age" under Compare against, with "Past drafts" under Pool/],
  ]
  for (const [args, short, label] of cases) {
    const r = await run(profile, { prospect: top.id, ...args })
    assert.match(r.structured.pool.short_label, short, JSON.stringify(args))
    assert.match(r.structured.pool.label, label, JSON.stringify(args))
    assert.equal(r.structured.pool.page_default, false)
  }
  // A past class is "the first round", because that is all the page holds of it.
  const old = out.classes[2015].players[0]
  const o = await run(profile, { prospect: old.id })
  assert.equal(o.structured.pool.short_label, 'vs. the 2015 first round')
  assert.match(o.text, new RegExp(`^${old.name}: .*\\nDrafted No\\. 1 in 2015 by ${old.team}\\.`))
  assert.match(o.text, /Not on file for anyone in the 2015 class: /)

  // No age on file: the page ranks him against the whole field, and the answer says so.
  const ageless = Object.values(out.classes).flatMap((c) => c.players).find((p) => !p.m.age)
  assert.ok(ageless, 'the real data should include a prospect with no age')
  const a = await run(profile, { prospect: ageless.id, compare: 'age' })
  assert.match(a.structured.pool.label, /^He has no age on file, so the page ranks each stat against all of /)
  assert.doesNotMatch(a.structured.pool.short_label, /near his age/)

  // One group is asked for: only that group comes back, and the tally says which.
  const off = await run(profile, { prospect: top.id, group: 'offense' })
  assert.ok(off.structured.stats.length && off.structured.stats.every((x) => x.group === 'Offense'))
  assert.match(off.text, /of the \d+ offense stats the page ranks/)
  const groups = await Promise.all(['context', 'offense', 'defense'].map((group) => run(profile, { prospect: top.id, group })))
  assert.equal(groups.reduce((n, g) => n + g.structured.stats.length, 0), s.stats.length)

  // Heights: the page's 6'12" is written 7'0".
  const tall = Object.values(out.classes).flatMap((c) => c.players).find((p) => p.meas.wing === 83.5)
  assert.ok(tall, 'the real data should include an 83.5-inch wingspan')
  assert.equal(page.fmt('ftin', 83.5), '6\'12"')
  assert.match((await run(profile, { prospect: tall.id })).text, /wingspan 7'0"/)
  assert.equal(draft.feetInches(83.4), '6\'11"')
  assert.equal(draft.feetInches(84), '7\'0"')
})

test('search finds prospects the way people type them', async () => {
  const names = async (query, limit) => (await run(search, limit ? { query, limit } : { query })).structured.prospects.map((p) => p.name)
  const top = async (query) => (await names(query))[0]
  // Accents.
  assert.equal(await top('Luka Doncic'), 'Luka Dončić')
  assert.equal(await top('porzingis'), 'Kristaps Porziņģis')
  assert.equal(await top('Alperen Sengun'), 'Alperen Şengün')
  assert.equal(await top('PORZIŅĢIS'), 'Kristaps Porziņģis')
  // Punctuation.
  assert.equal(await top('DeAaron Fox'), "De'Aaron Fox")
  assert.equal(await top('karl anthony towns'), 'Karl-Anthony Towns')
  assert.equal(await top('RJ Hampton'), 'R.J. Hampton')
  assert.equal(await top('Kelel Ware'), "Kel'el Ware")
  assert.equal(await top('gilgeous'), 'Shai Gilgeous-Alexander')
  // Typos are found, and marked as near spellings so that nobody takes one for an exact hit.
  assert.equal(await top('Dybansta'), 'AJ Dybantsa')
  assert.equal(await top('Wembenyama'), 'Victor Wembanyama')
  assert.equal(await top('Cooper Flag'), 'Cooper Flagg')
  const typo = await run(search, { query: 'Dybansta' })
  assert.deepEqual(typo.structured.prospects.map((p) => p.close_match), [true])
  assert.match(typo.text, /^No prospect's name matches "Dybansta" as typed\. The closest spelling is:\n1\. AJ Dybantsa /)
  // Nikola Jokić was a second-round pick, so he is not on the page; Nikola Jović is.
  const jokic = await run(search, { query: 'Nikola Jokic' })
  assert.deepEqual(jokic.structured.prospects.map((p) => [p.name, p.close_match]), [['Nikola Jović', true]])
  assert.match(jokic.text, /^No prospect's name matches "Nikola Jokic" as typed\./)
  assert.match(jokic.text, /A close spelling can be a different person\. Draft Savant covers the 2026 class and first-round picks of the 2010 to 2025 drafts, so a player picked outside it is not here\./)
  assert.ok((await run(search, { query: 'williams' })).structured.prospects.every((p) => !p.close_match))
  // Shared names come back together, newest class first.
  const williams = await run(search, { query: 'williams', limit: 4 })
  assert.equal(williams.structured.count, 4)
  assert.ok(williams.structured.total > 4)
  assert.match(williams.text, /prospects match "williams", showing the first 4/)
  const years = williams.structured.prospects.map((p) => p.draft_year)
  assert.deepEqual(years, [...years].sort((a, b) => b - a))
  assert.deepEqual((await names('thompson')).sort(), ['Amen Thompson', 'Ausar Thompson', 'Klay Thompson', 'Tristan Thompson'])
  // What a result carries.
  const r = await run(search, { query: 'Cooper Flagg' })
  const src = data.players.find((p) => p.name === 'Cooper Flagg')
  assert.deepEqual(r.structured.prospects, [{
    id: src.id, name: src.name, position: src.pos, college: src.college, draft_year: src.draft_year, pick: src.draft_pick,
    team: src.draft_team, projected: false, close_match: false, url: 'https://wcehoops.com/draft-savant.html',
  }])
  assert.match(r.text, new RegExp(`1\\. Cooper Flagg \\(id ${src.id}\\): ${src.pos}, ${src.college}\\. Drafted No\\. ${src.draft_pick} in ${src.draft_year} by ${src.draft_team}\\.`))
  assert.match(r.text, /not NBA stats/)
  assert.ok(r.text.includes(provenanceOf(out.meta)))
  assert.doesNotMatch(r.text, /close spelling/i)
  assert.doesNotMatch(r.text, /"Projected"/)
  // The current class is never called drafted.
  const now = await run(search, { query: out.classes[cfg.currentClass].players[0].name })
  assert.equal(now.structured.prospects[0].projected, true)
  assert.match(now.text, new RegExp(`${cfg.currentClass} class: projected No\\. 1, `))
  assert.match(now.text, /shows the \d{4} class as "Projected"/)
  assert.doesNotMatch(now.text, /Drafted No\./)
  // An entity in the data ("Texas A&amp;M") is shown as the page shows it.
  assert.ok(data.players.some((p) => p.college.includes('&amp;')), 'the real data should still include an escaped ampersand')
  assert.ok(!JSON.stringify(out).includes('&amp;'))
  assert.equal((await run(search, { query: 'Robert Williams' })).structured.prospects[0].college, 'Texas A&M')
  // Nothing found is an answer, not an error.
  const none = await run(search, { query: 'zzzzqq' })
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No prospect in Draft Savant matches "zzzzqq"/)
  // Every prospect is found by his own name and by his id.
  for (const p of out.prospects.prospects) {
    const got = await run(search, { query: p.name })
    assert.equal(got.structured.prospects[0].id, p.id, `searching "${p.name}"`)
    assert.equal((await run(profile, { prospect: p.name, group: 'context' })).structured.prospect.id, p.id, `profile of "${p.name}"`)
  }
})

test('a name that fits several prospects lists them; an id that is also a surname says so', async () => {
  await fails(profile, { prospect: 'Williams' }, /^10 prospects match "Williams"\. Call again with one of these ids:\n- Cody Williams \(id cody_williams\): Wing, Colorado, drafted No\. 10 in 2024 by Utah Jazz\n/)
  await fails(profile, { prospect: 'Barnes' }, /2 prospects match "Barnes".*\(id barnes\).*\(id harrison-barnes-2012\)/s)
  await fails(profile, { prospect: 'Thompson' }, /4 prospects match/)
  await fails(profile, { prospect: 'Johnson' }, /11 prospects match "Johnson"/)
  // The page's id for Scottie Barnes is the bare word "barnes". Asked for by that id he is
  // returned, and the answer names the other Barnes rather than hiding him.
  const scottie = await run(profile, { prospect: 'barnes', group: 'context' })
  assert.equal(scottie.structured.prospect.name, 'Scottie Barnes')
  assert.match(scottie.text, /"barnes" is Scottie Barnes's id\. The same word also fits Harrison Barnes \(id harrison-barnes-2012\)\./)
  // Every id that is also somebody else's name carries that note; no other profile does.
  const rows = out.prospects.prospects
  const word = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  let shared = 0
  for (const p of rows) {
    const clash = rows.some((q) => q.id !== p.id && word(q.name).includes(p.id))
    const r = await run(profile, { prospect: p.id, group: 'context' })
    assert.equal(r.structured.prospect.id, p.id, `an id always returns its own prospect (${p.id})`)
    assert.equal(/The same word also fits/.test(r.text), clash, `${p.id}: namesake note`)
    if (clash) shared++
  }
  assert.ok(shared >= 10, 'the real data should include ids that are also surnames')
  // A father's name is a fair way to ask for the son when only the son is here.
  assert.equal((await run(profile, { prospect: 'Jaren Jackson', group: 'context' })).structured.prospect.name, 'Jaren Jackson Jr.')
  // A surname or the start of one that can only be one prospect is him.
  assert.equal((await run(profile, { prospect: 'Wembanyama', group: 'context' })).structured.prospect.name, 'Victor Wembanyama')
  assert.equal((await run(profile, { prospect: 'Wemb', group: 'context' })).structured.prospect.name, 'Victor Wembanyama')
  // A near miss is never taken for a hit. Nikola Jokić was a second-round pick and is not on
  // the page; the closest spelling is another man, and he is offered, not returned.
  assert.ok(!data.players.some((p) => /Joki/.test(p.name)))
  await fails(profile, { prospect: 'Nikola Jokic' }, /^No prospect is named "Nikola Jokic"\. The closest name is:\n- Nikola Jović \(id \S+\): .*\nCall again with an id only if that is who is meant\. Draft Savant covers the 2026 class and first-round picks of the 2010 to 2025 drafts, so a player picked outside it is not here\.$/)
  await fails(profile, { prospect: 'Dybansta' }, /^No prospect is named "Dybansta"\. The closest name is:\n- AJ Dybantsa \(id dybantsa\)/)
  await fails(profile, { prospect: 'Jonson' }, /^No prospect is named "Jonson"\. The closest names are:\n(- .* Johnson.*\n){11}Call again/)
  // No profile is ever returned for a name that only matched as a typo or a fragment.
  for (const p of out.prospects.prospects.slice(0, 120)) {
    const typo = p.name.replace(/[aeiou](?=[a-z]*$)/, 'x')
    if (typo === p.name) continue
    const r = await profile.run(input(profile, { prospect: typo })).then((x) => x.structured.prospect.name, (err) => err)
    assert.ok(r instanceof core.SavantError, `"${typo}" returned ${r} without asking`)
  }
})

test('questions that cannot be answered say what to try', async () => {
  await fails(profile, { prospect: 'zz-top-1999' }, /^No prospect has the id "zz-top-1999"\. Draft Savant covers the 2026 class and first-round picks of the 2010 to 2025 drafts\. .*nba_draft_search_prospects/)
  await fails(profile, { prospect: 'Qwertyuiop Asdfgh' }, /^No prospect matches "Qwertyuiop Asdfgh"\./)
  await fails(profile, { prospect: 'LeBron James' }, /^No prospect matches "LeBron James"\. Draft Savant covers the 2026 class and first-round picks of the 2010 to 2025 drafts\./)
  // Arguments outside what the page offers are refused by the input shape, before any lookup.
  for (const args of [{ prospect: 'dybantsa', compare: 'archetype' }, { prospect: 'dybantsa', pool: '2015' }, { prospect: 'dybantsa', pool: 'past5' }, { prospect: 'dybantsa', group: 'value' }, { prospect: '' }, { prospect: 'x'.repeat(81) }, {}]) {
    assert.ok(!z.object(profile.config.inputSchema).safeParse(args).success, JSON.stringify(args))
  }
  for (const args of [{ query: 'x' }, { query: 'x'.repeat(81) }, { query: 'flagg', limit: 0 }, { query: 'flagg', limit: 26 }, { query: 'flagg', limit: 2.5 }, {}]) {
    assert.ok(!z.object(search.config.inputSchema).safeParse(args).success, JSON.stringify(args))
  }
  assert.deepEqual(input(profile, { prospect: '  dybantsa ' }), { prospect: 'dybantsa', compare: 'all', pool: 'class', group: 'all' })
  assert.deepEqual(input(search, { query: ' flagg ' }), { query: 'flagg', limit: 10 })
})

test('files are fetched once and reused; when the data is down the answer is honest', async () => {
  core.clearCache()
  const start = hits
  await run(profile, { prospect: 'dybantsa' })
  await run(profile, { prospect: 'dybantsa', compare: 'age', pool: 'past' })
  await run(search, { query: 'dybantsa' })
  assert.equal(hits - start, 3, 'meta, the index and one class: three fetches for three calls')

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // A class file that is not there comes back as the homepage, with a 200.
    core.clearCache()
    const real = out.classes[2015]
    delete out.classes[2015]
    try { await fails(profile, { prospect: 'kristaps-porzingis-2015' }, /^Draft Savant data could not be loaded right now\. Try again in a minute\.$/) } finally { out.classes[2015] = real }

    // The whole origin is unreachable.
    core.clearCache()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    await fails(search, { query: 'flagg' }, /^Draft Savant data could not be loaded right now\. Try again in a minute\.$/)
    await fails(profile, { prospect: 'flagg' }, /could not be loaded right now/)
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    core.clearCache()
  }
  assert.equal((await run(search, { query: 'flagg' })).structured.count, 1)
})

test('the two tools register, describe themselves and answer through a real MCP client', async () => {
  assert.deepEqual(draft.tools.map((t) => t.name), ['nba_draft_search_prospects', 'nba_draft_get_prospect_profile'])
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name), draft.tools.map((t) => t.name))
  const years = out.meta.past.years
  for (const t of tools) {
    assert.ok(t.name.startsWith('nba_draft_') && t.name.length <= 64)
    assert.ok(t.title && t.annotations.title, `${t.name}: title`)
    assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint, t.annotations.openWorldHint], [true, false, true, false])
    assert.ok(t.description.length > 80, `${t.name}: description`)
    // This is not Basketball Savant, and the description has to make that plain.
    assert.match(t.description, /not NBA (stats|data)/, `${t.name}: says it is not NBA data`)
    assert.match(t.description, /pre-draft/)
    assert.match(t.description, /compiled by WCE, partly by hand, not an official feed/)
    // The years in the description are the years in the data. When a class is added, both move.
    for (const y of [cfg.currentClass, years[0], years[years.length - 1]]) assert.ok(t.description.includes(String(y)), `${t.name}: the description should mention ${y}`)
    assert.doesNotMatch(t.description, /\b(you should|always|must|never use|best|powerful)\b/i, `${t.name}: describes, does not instruct or promote`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.outputSchema, `${t.name}: output schema`)
    for (const [k, prop] of Object.entries(t.inputSchema.properties)) assert.ok(prop.description, `${t.name}.${k}: described`)
  }

  // callTool validates structuredContent against the tool's output schema and throws if not.
  const s = await call('nba_draft_search_prospects', { query: 'Victor Wembanyama' })
  assert.ok(!s.isError)
  assert.equal(s.structuredContent.prospects[0].name, 'Victor Wembanyama')
  const p = await call('nba_draft_get_prospect_profile', { prospect: 'AJ Dybantsa', compare: 'position' })
  assert.ok(!p.isError, textOf(p))
  assert.equal(p.structuredContent.prospect.id, 'dybantsa')
  assert.match(textOf(p), /- True shooting %: \.\d{3} \(\d+(st|nd|rd|th) vs\. 2026-class wings, \d+ ranked\)/)
  // Errors come back as tool errors with the message and nothing else.
  const shared = await call('nba_draft_get_prospect_profile', { prospect: 'Williams' })
  assert.ok(shared.isError)
  assert.match(textOf(shared), /Call again with one of these ids/)
  assert.equal(shared.structuredContent, undefined)
  const bad = await call('nba_draft_get_prospect_profile', { prospect: 'dybantsa', pool: 'archetype' })
  assert.ok(bad.isError)
  const short = await call('nba_draft_search_prospects', { query: 'x' })
  assert.ok(short.isError)
})

// ---- what is written to disk -----------------------------------------------------------

test('what is written to disk is what was built, in a few small files, under budget', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-draft-'))
  try {
    const r = writeDraftApi({ publicDir: PUBLIC, dist })
    const root = path.join(dist, BASE)
    assert.deepEqual(readdirSync(root).sort(), ['classes', 'meta.json', 'prospects.json'])
    const classFiles = readdirSync(path.join(root, 'classes')).sort()
    assert.deepEqual(classFiles, Object.keys(out.classes).map((y) => `${y}.json.gz`).sort())
    for (const f of classFiles) assert.match(f, /^\d{4}\.json\.gz$/)

    const meta = readFileSync(path.join(root, 'meta.json'))
    const index = readFileSync(path.join(root, 'prospects.json'))
    assert.deepEqual(JSON.parse(meta), out.meta)
    assert.deepEqual(JSON.parse(index), out.prospects)
    let bytes = meta.length + index.length
    let raw = meta.length + index.length
    for (const f of classFiles) {
      const gz = readFileSync(path.join(root, 'classes', f))
      const json = gunzipSync(gz)
      const body = JSON.parse(json)
      assert.equal(body.schema, 1, `${f}: schema`)
      assert.deepEqual(body, out.classes[f.slice(0, 4)], `${f}: round trip`)
      bytes += gz.length
      raw += json.length
    }
    assert.equal(JSON.parse(meta).schema, 1)
    assert.equal(JSON.parse(index).schema, 1)
    assert.deepEqual([r.files, r.raw, r.bytes], [classFiles.length + 2, raw, bytes])
    assert.equal(r.summary, `${count(data.players.length)} prospects, ${classFiles.length} draft classes`)
    console.log(`      ${r.files} files, ${count(r.raw)} bytes of JSON, ${count(r.bytes)} bytes on disk (budget ${count(BUDGET)})`)
    assert.ok(r.bytes < BUDGET, `the Draft Savant files grew to ${count(r.bytes)} bytes on disk`)
    // Writing again replaces the folder rather than adding to it.
    writeDraftApi({ publicDir: PUBLIC, dist })
    assert.equal(readdirSync(path.join(root, 'classes')).length, classFiles.length)
    assert.throws(() => writeDraftApi({ publicDir: dist, dist }), /is missing from public/)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
  assert.deepEqual(POOLS.map((p) => `${p.field}/${p.cohort}`), FIELDS.flatMap((f) => COHORTS.map((c) => `${f}/${c}`)))
  assert.deepEqual(out.meta.pools, POOLS)
})
