// Check for the Coaching Savant section of the AI connector: the files
// scripts/lib/savant-api-coaching.mjs writes, and the tools in api/_coaching.js that read them.
//
//   node --test tools/savant-coaching/check.mjs
//
// The files exist so that a machine can quote what a fan reads on a coach's page. So the test
// is not "does the slicer agree with itself" but "does it agree with the page". It takes the
// page's own script out of public/coaching-savant.html, takes off the last line (the one that
// fetches and starts the page), and runs the rest in a sandbox with a stand-in for the one
// element the page draws into. Then it loads the real data the way the page does, lets the
// page lay the in-season file over the archive, and has the page DRAW every head coach, every
// play-caller and every unit. What the page drew — each bar's percentile and printed value,
// the record strip, the fourth-down strip, the season table, the lineage chain, who is marked
// unconfirmed, which units are too small to rank — is read back out of that HTML and compared
// with the files, and then with what the tools say.
//
// Because the page's inline rules are executed rather than re-typed here, a change to how the
// page ranks or hides something fails this test until the slicer follows. The sentences the
// tools quote or lean on are pinned by their text as well. If it fails: fix the slicer or the
// section, do not relax the check.
//
// No network, no keys, no new dependencies. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BASE, SIDES, buildCoachingApi, overlay, superBowl, writeCoachingApi, yearsLabel } from '../../scripts/lib/savant-api-coaching.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const BUDGET = 1.5 * 1048576 // bytes on disk; Vercel keeps ~40 deployments, so every MB costs 40

const html = readFileSync(path.join(PUBLIC, 'coaching-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(PUBLIC, 'coaching-savant-data.json'), 'utf8'))
const current = JSON.parse(readFileSync(path.join(PUBLIC, 'coaching-savant-current.json'), 'utf8'))

// Through JSON once, because that is what gets published.
const plain = (v) => JSON.parse(JSON.stringify(v))
const build = (d, c) => plain(buildCoachingApi({ data: d, current: c, html }))
const out = build(data, current)
const meta = out.meta
const people = out.profiles.people

// ---- the page, run without a browser ---------------------------------------------------

// The page's script minus its last line, in a sandbox, loaded with `d` and `c` the way the
// page's init() loads them. `el` stands in for the element the page draws a coach into.
function openPage(d, c) {
  const src = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))
  const boot = /\binit\(\);\s*$/
  assert.ok(boot.test(src), 'the page script no longer ends by calling init()')
  const el = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} }
  const ctx = vm.createContext({
    document: { getElementById: () => el, querySelectorAll: () => [], querySelector: () => null },
    window: { scrollTo() {} },
    __data: structuredClone(d),
    __cj: c ? structuredClone(c) : null,
  })
  vm.runInContext(src.replace(boot, ''), ctx)
  // What init() does once both files are in. Pinned below, so a change to it fails here.
  vm.runInContext('DATA=__data; COACHES=DATA.coaches; CALLERS=DATA.callers||{}; UNITS=DATA.units||{}; LEAGUE=DATA.league||{}; mergeCurrent(__cj);', ctx)
  return {
    ctx,
    coach: (name) => { ctx.renderCoach(name); return el.innerHTML },
    caller: (name) => { ctx.renderCaller(name); return el.innerHTML },
    unit: (id) => ctx.unitView(ctx.UNITS[id]),
  }
}

const page = openPage(data, current)
const fmt = (unit, v) => page.ctx.fmt(unit, v)

// ---- reading what the page drew --------------------------------------------------------

const unescape = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const textOf = (s) => unescape(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
const all = (s, re) => [...String(s).matchAll(re)]
function between(s, a, b) {
  const i = s.indexOf(a)
  if (i < 0) return null
  const j = b ? s.indexOf(b, i + a.length) : -1
  return s.slice(i + a.length, j < 0 ? undefined : j)
}

// The stat cells of the strips: label -> what is printed above it.
const strip = (s) => new Map(all(s, /<span class="st"><b>(.*?)<\/b>([^<]*)<\/span>/g).map((m) => [m[2], textOf(m[1])]))

// The bars: one per stat the page drew, with the percentile and value exactly as printed.
const BAR = /<div class="row" data-k="([^"]+)"><div class="rl" title="[^"]*"><div class="name">([^<]*)<\/div><div class="tag">([^<]*)<\/div><\/div><div class="track">.*?<\/div><div class="pct">([^<]*)<\/div><div class="rv">([^<]*)(?:<span class="pairv"[^>]*>([^<]*)<\/span>)?<\/div><\/div>/g
const bars = (s) => all(s, BAR).map((m) => ({ k: m[1], label: unescape(m[2]), tag: unescape(m[3]), pct: m[4], val: m[5], pair: m[6] ?? null }))

// Name chips: [name, has a page]. A "dead" chip is an ancestor with no page.
const chips = (s) => all(s, /<(button|span) class="chip ([^"]*)"[^>]*>([^<]*)<\/\1>/g).map((m) => [unescape(m[3]), !/\bdead\b/.test(m[2])])

const lastName = (n) => n.split(' ').pop()
const pctText = (p) => (p == null ? '·' : String(p))
const spanOf = (a, b) => (a === b ? String(a) : `${a}–${b}`)
const ordered = (groups, metrics) => groups.flatMap((g) => metrics.filter((m) => m.group === g))

let compared = 0
const same = (a, b, msg) => { compared++; assert.equal(a, b, msg) }
const sameDeep = (a, b, msg) => { compared++; assert.deepEqual(a, b, msg) }
// For the big keyed objects: say which entry differs rather than print both in full (a diff
// of two 2 MB objects takes the machine down with it).
const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function sameKeyed(mine, theirs, what) {
  sameDeep(Object.keys(mine).sort(), Object.keys(theirs).sort(), `${what}: who is in it`)
  for (const k of Object.keys(theirs)) { compared++; assert.ok(identical(mine[k], theirs[k]), `${what}: ${k} is not what the page holds`) }
}

// ---- 1. the page still works the way the slicer and the tools assume ------------------

test('the page still says and decides what this section leans on', () => {
  const has = (text, why) => assert.ok(html.includes(text), `${why}: the page no longer has "${text.slice(0, 70)}"`)
  // How the page loads its two files, which openPage() above repeats.
  has('DATA=j; COACHES=j.coaches;', 'init() loads the archive')
  has('CALLERS=j.callers||{}; UNITS=j.units||{}; LEAGUE=j.league||{};', 'init() loads the archive')
  has('mergeCurrent(CJ);', 'init() lays the in-season file over it')
  has('if(DATA.generated&&cj.generated&&cj.generated<DATA.generated) return;   // archive is newer', 'the overlay rule')
  // Who is ranked. These are executed by the checks below; pinned too, so the reason is named.
  has('var MIN_SEASONS=3;', 'the three-season line')
  has('var qualified=car.seasons>=MIN_SEASONS;', 'the three-season line in renderCoach()')
  has(`if(key.indexOf('d4_')===0 ? !(c.d4_g>=${meta.rules.d4MinGames}) : c.seasons<MIN_SEASONS) continue;`, 'who is in a career pool')
  has(`if(m.key.indexOf('d4_')===0 && !(car.d4_g>=${meta.rules.d4MinGames})) return;`, 'when a fourth-down bar is drawn')
  has('if(u.season!==season||u.side!==side||u.small) continue;', 'who is in a unit pool')
  has('if(u.small) return null;', 'a small unit has no percentile')
  // The deep link the tools hand out.
  has("(view==='coach' ? '#c='+encodeURIComponent(name) : '#')", 'the link to a coach')
  has("h.indexOf('c=')===0 && COACHES[h.slice(2)]", 'the route to a head coach')
  has("h.indexOf('c=')===0 && CALLERS[h.slice(2)]", 'the route to a play-caller')
  // Sentences the tools quote or restate. If the page rewords one, reword the tool with it.
  has('too short to rank against ', 'the unranked-career caption')
  has('other coaches without inventing precision.', 'the unranked-career caption')
  has('Career figures are weighted by games', 'the career caption')
  has('No mentor is recorded for him here. That means the lineage is missing, ', 'the root-of-his-own-line caption')
  has('not that he learned it alone.', 'the root-of-his-own-line caption')
  has('HEAD COACHES OFF HIS STAFF', 'the lineage heading')
  has('too few snaps to rank</b> — values shown, percentiles not', 'the small-unit caption')
  has("<b>Small sample:</b> '+car.d4_n+' fourth downs so far. Read these as what happened, not who he is yet.", 'the fourth-down small-sample caption')
  has('Every fourth down since 2014, ', 'the fourth-down caption')
  has('Clear "go" means going was worth 4+ points of win probability; a close call, 1 to 4.', 'the fourth-down caption')
  has("Injuries, his kicker beyond the league average, the wind on the day. '", 'what the fourth-down model cannot see')
  has("'A single call it dislikes can be right for reasons it doesn\\'t know, so read the career numbers, not one Sunday.", 'what the fourth-down model cannot see')
  has('Play-callers are recorded from 2018.', 'the season-table caption')
  has("The biggest moves relative to each season\\'s league; a new roster moves numbers too.", 'the arrival caption')
  has('Matched on style only', 'the unit-comps caption')
  has("return {key:key,label:label,grp:grp,unit:unit,lower:flags.indexOf('L')>=0,", 'how a unit stat is flagged')
  has("'+(m.style?'HOW MUCH':'HOW GOOD')+'", 'the how-much / how-good tag')
  assert.equal(meta.firstSeason, 1999, 'the data no longer starts in 1999; the tool descriptions say it does')
  assert.equal(meta.rules.d4From, 2014, 'the fourth-down model no longer starts in 2014; the page says it does')
  assert.equal(meta.rules.callersFrom, 2018, 'unit data no longer starts in 2018; the page says it does')
  assert.equal(meta.metrics.find((m) => m.key === 'proe').since, 2006, 'the page says pass rate over expected is available from 2006')
})

// ---- 2. laying the in-season file over the archive --------------------------------------

test('the in-season file is laid over the archive exactly as the page does it', () => {
  // The live pair, the archive on its own, and an archive newer than the in-season file.
  const newer = { ...data, generated: '2999-01-01T00:00:00+00:00' }
  const cases = [['as published', data, current, page], ['no in-season file', data, null, null], ['archive newer', newer, current, null]]
  for (const [what, d, c, opened] of cases) {
    const p = opened || openPage(d, c)
    const mine = plain(overlay(d, c))
    sameKeyed(mine.coaches, plain(p.ctx.COACHES), `${what}: head coaches`)
    sameKeyed(mine.callers, plain(p.ctx.CALLERS), `${what}: play-callers`)
    sameKeyed(mine.units, plain(p.ctx.UNITS), `${what}: units`)
    sameKeyed(mine.league, plain(p.ctx.LEAGUE), `${what}: league rows`)
    sameDeep(mine.current, plain(p.ctx.CURINFO), `${what}: the season and week in progress`)

    // And every career percentile under that pairing, straight from the page's pool() and pctOf().
    const built = opened ? out : build(d, c)
    for (const m of built.meta.metrics) {
      const pool = p.ctx.pool(m.key)
      same(m.pool, pool.length, `${what}: ${m.key} pool size`)
      for (const [name, coach] of Object.entries(plain(p.ctx.COACHES))) {
        const cell = built.profiles.people[name].hc.m[m.key]
        if (cell) same(cell[1], p.ctx.pctOf(coach.career[m.key], pool, m.lowerIsBetter), `${what}: ${name} ${m.key}`)
      }
    }
  }
  // The overlay really is in effect as published: the in-season numbers are the ones served.
  assert.equal(meta.overlaid, true)
  assert.deepEqual(meta.current, { season: current.season, week: current.week })
  assert.equal(build(data, null).meta.current, null)
  assert.equal(build({ ...data, generated: '2999-01-01T00:00:00+00:00' }, current).meta.overlaid, false)
})

// ---- 3. the glossary is the page's -----------------------------------------------------

test('the stat tables, pools and labels in meta.json are the page\'s', () => {
  const ctx = page.ctx
  const row = (m) => ({ key: m.key, label: m.label, group: m.grp, unit: m.unit, lowerIsBetter: !!m.lower, what: m.exp.w || null })
  sameDeep(meta.groups, plain(ctx.GRPS))
  sameDeep(meta.metrics.map(({ since: _s, pool: _p, ...m }) => m), plain(ctx.METRICS).map(row))
  sameDeep(meta.unitGroups, { O: plain(ctx.OFF_GRPS), D: plain(ctx.DEF_GRPS) })
  for (const [side, table] of [['O', ctx.OFF_M], ['D', ctx.DEF_M]]) {
    sameDeep(meta.unitMetrics[side].map(({ style: _s, pair: _p, ...m }) => m), plain(table).map(row), `${side} unit stats`)
    for (const m of plain(table)) {
      const mine = meta.unitMetrics[side].find((x) => x.key === m.key)
      same(mine.style, !!m.style, `${side} ${m.key}: how much or how good`)
      sameDeep(mine.pair, m.pair ? m.pair.slice(0, 2) : null, `${side} ${m.key}: EPA with and without`)
      assert.ok(meta.formats[m.unit], `value format "${m.unit}" has no description`)
    }
  }
  for (const m of meta.metrics) assert.ok(meta.formats[m.unit], `value format "${m.unit}" has no description`)
  same(meta.rules.minSeasons, ctx.MIN_SEASONS)
  sameDeep(meta.rounds, plain(ctx.ROUND_NAME))
  for (const s of meta.seasons) {
    same(meta.superBowl[s], ctx.sbName(s), `Super Bowl numeral for ${s}`)
    same(superBowl(s), ctx.sbName(s))
  }
  same(meta.notes.tree, data.treeNote)
  same(meta.notes.callers, data.callerNote)
  // The men the tree names who have no page, and who the page hangs directly under each.
  const named = new Set(Object.entries(data.tree).flatMap(([n, e]) => [n, e.mentor, ...(e.also || []).map((a) => a.mentor)]))
  sameDeep(meta.ancestors.map((a) => a.name), [...named].filter((n) => !ctx.isPerson(n)).sort((a, b) => a.localeCompare(b)), 'tree names with no page')
  for (const a of meta.ancestors) sameDeep(a.under, plain(ctx.kidsOf(a.name)).map((k) => [k, ctx.isPerson(k)]), `${a.name}: who the tree places under him`)
  for (const era of new Set(Object.values(plain(ctx.UNITS)).map((u) => u.era))) {
    const drawn = ctx.missingNote({ era })
    same(meta.notes.era[era], drawn ? textOf(between(drawn, '</b>', '</div>')) : null, `the "not in this season" note for ${era}`)
  }
  same(meta.notes.unconfirmed, ctx.unsureTag({ sure: false }).match(/title="([^"]*)"/)[1])
  sameDeep(meta.seasons, data.seasons.map(Number))

  // Unit pools, from the page's unitPool().
  for (const [season, file] of Object.entries(out.units)) {
    for (const side of SIDES) {
      const units = Object.values(plain(ctx.UNITS)).filter((u) => u.season === +season && u.side === side)
      same(file.ranked[side], units.filter((u) => !u.small).length, `${season} ${side}: ranked units`)
      sameDeep(meta.unitPools[season], file.ranked)
      for (const m of meta.unitMetrics[side]) {
        const n = ctx.unitPool(+season, side, m.key).length
        same(file.pools[side][m.key] ?? 0, n, `${season} ${side} ${m.key}: pool size`)
      }
    }
    same(file.week, +season === current.season ? current.week : null, `${season}: week in progress`)
  }
})

// ---- 4. every head coach ---------------------------------------------------------------

const CHOSE = { punt: 'Punted', fg: 'Kicked the field goal', go: 'Went for it' }
const MODEL = { punt: 'punt', fg: 'kick', go: 'go for it' }

// The lineage block of a page against a person's tree in the files.
function checkLineage(drawn, name, t) {
  const block = between(drawn, '<div class="lineage">', '<div class="curated"><b>ABOUT THE LINEAGE</b>')
  assert.ok(block, `${name}: the page drew no lineage`)
  const chain = chips(between(block, '<div class="chain">', '</div>'))
  sameDeep(chain[0], [name, true], `${name}: the chain starts with him`)
  sameDeep(chain.slice(1), t.chain, `${name}: lineage chain`)
  const role = textOf(between(block, '<div class="lin-role">', '</div>'))
  if (!t.chain.length) {
    same(role, 'No mentor is recorded for him here. That means the lineage is missing, not that he learned it alone.', `${name}: no mentor`)
    same(t.role, null)
    same(t.root, null)
  } else {
    same(role, `${t.chain[0][0]} — ${t.role}.${t.also.map((a) => ` Also shaped by ${a[0]}: ${a[1]}.`).join('')} Traces back to the ${t.root} tree.`, `${name}: mentor, role and root`)
  }
  const staff = between(block, 'HEAD COACHES OFF HIS STAFF</div><div class="protg">', '</div>')
  sameDeep(staff == null ? [] : chips(staff), t.kids, `${name}: coaches off his staff`)
  same(textOf(between(drawn, '<b>ABOUT THE LINEAGE</b>', '</div>')), meta.notes.tree, `${name}: the lineage caveat`)
}

// The "style match" plate against a person's calls in the files.
function checkStyleMatch(drawn, name, calls) {
  const block = between(drawn, '<h2 class="panel-h">Style match</h2>', '<div class="plate" id="scheme">') || ''
  const marks = { O: 'OFFENSIVE PLAY-CALLERS MOST LIKE HIM', D: 'DEFENSIVE PLAY-CALLERS MOST LIKE HIM' }
  for (const side of SIDES) {
    const at = block.indexOf(marks[side])
    const other = side === 'O' ? block.indexOf(marks.D) : -1
    const part = at < 0 ? '' : block.slice(at, other > at ? other : undefined)
    const s = calls[side] || { comps: [], mentors: [] }
    sameDeep(
      all(part, /<button class="chip" data-go="([^"]*)" title="Closer than ([^%]*)% of pairs">/g).map((m) => [unescape(m[1]), m[2]]),
      s.comps.map((x) => [x[0], page.ctx.capP(x[1])]),
      `${name}: ${side} play-callers most like him`,
    )
    sameDeep(
      all(part, /<div class="lin-role">Against (his mentor )?<b>([^<]*)<\/b>: closer than ([^%]*)% of (offence|defence) play-caller pairs\./g).map((m) => [unescape(m[2]), m[3], !!m[1]]),
      s.comps.length ? s.mentors.map((x) => [x[0], page.ctx.capP(x[1]), x[2]]) : [],
      `${name}: ${side} distance to his mentors`,
    )
  }
}

test('every head coach: what the page draws is what the files hold', () => {
  const rules = meta.rules
  const names = Object.keys(plain(page.ctx.COACHES))
  assert.equal(names.length, meta.counts.headCoaches)
  let ranked = 0
  for (const name of names) {
    const p = people[name]
    assert.ok(p && p.hc, `${name} is missing from the files`)
    const h = p.hc
    const drawn = page.coach(name)

    // The header and the record strip.
    same(textOf(between(drawn, '<h1 class="cname">', '</h1>')), name)
    same(textOf(between(drawn, '<div class="cmeta">', '</div>')), `${h.teams.join(' · ')} · ${spanOf(h.first, h.last)} · ${h.seasons} season${h.seasons === 1 ? '' : 's'}`, `${name}: teams, span and seasons`)
    const st = strip(drawn)
    same(st.get('RECORD'), `${h.w}–${h.l}${h.t ? `–${h.t}` : ''}`, `${name}: record`)
    same(st.get('WIN %'), h.winpct == null ? '—' : `${h.winpct.toFixed(1)}%`, `${name}: win %`)
    same(st.get('PLAYOFFS'), `${h.pw}–${h.pl}`, `${name}: playoff record`)
    same(st.get('PLAYOFF YEARS'), `${h.po}/${h.seasons}`, `${name}: playoff years`)
    same(st.get('WINS VS EXPECTED'), h.waa == null ? undefined : fmt('sgn1', h.waa), `${name}: wins vs expected`)

    // The badges.
    const badges = all(drawn, /<span class="badge[^"]*">([^<]*)<\/span>/g).map((m) => unescape(m[1]))
    const count = (re) => { const b = badges.map((x) => x.match(re)).find(Boolean); return b ? +(b[1] || 1) : 0 }
    same(count(/^(?:(\d+) × )?SUPER BOWL$/), h.sb, `${name}: Super Bowls won`)
    same(count(/^(?:(\d+) × )?SB APPEARANCE$/), h.sbLost, `${name}: Super Bowls lost`)
    same(count(/^(\d+) PLAYOFF YEARS?$/), h.po, `${name}: playoff years badge`)
    same(count(/^BEST YEAR (\d+) WINS$/), h.bestWins, `${name}: best year`)
    for (const side of SIDES) {
      const badge = badges.map((x) => x.match(side === 'O' ? /^CALLED THE OFFENCE (.*)$/ : /^CALLED THE DEFENCE (.*)$/)).find(Boolean)
      same(badge ? badge[1] : null, p.calls && p.calls[side] ? p.calls[side].years : null, `${name}: years calling the ${side === 'O' ? 'offence' : 'defence'}`)
    }

    // The career bars: which are drawn, in what order, with what percentile and value.
    const rows = bars(drawn).filter((r) => !r.k.startsWith('u:'))
    const mine = ordered(meta.groups, meta.metrics).filter((m) => h.m[m.key])
    same(h.qualified, !drawn.includes(`Fewer than ${rules.minSeasons} seasons — too short to rank`), `${name}: ranked or not`)
    sameDeep(rows.map((r) => r.k), mine.map((m) => m.key), `${name}: which career stats are drawn`)
    if (h.qualified) {
      ranked++
      const cap = drawn.match(/Ranked against the (\d+) head coaches with at least (\d+) seasons since (\d+)\./)
      sameDeep(cap.slice(1).map(Number), [meta.metrics[0].pool, rules.minSeasons, meta.firstSeason], `${name}: the pool the caption names`)
    } else {
      sameDeep(h.m, {}, `${name}: an unranked coach carries no ranked stats`)
    }
    rows.forEach((r, i) => {
      const m = mine[i]
      same(r.label, m.label, `${name} ${m.key}: label`)
      same(r.tag, m.group.toUpperCase(), `${name} ${m.key}: group`)
      same(r.pct, pctText(h.m[m.key][1]), `${name} ${m.key}: percentile`)
      same(r.val, fmt(m.unit, h.m[m.key][0]), `${name} ${m.key}: value`)
    })
    // "From N of his seasons": a career figure is the games-weighted mean of the seasons that
    // carry the number (pipeline/football/coaches.py), so N is how many of them do.
    const src = plain(page.ctx.COACHES)[name]
    for (const m of mine) {
      const n = src.seasons.filter((s) => s[m.key] != null).length
      same((h.part || {})[m.key] ?? null, n > 0 && n < src.seasons.length ? n : null, `${name} ${m.key}: seasons covered`)
      if (n > 0 && !m.key.startsWith('d4_')) {
        const games = src.seasons.filter((s) => s[m.key] != null).reduce((a, s) => a + s.g, 0)
        const mean = src.seasons.filter((s) => s[m.key] != null).reduce((a, s) => a + s[m.key] * s.g, 0) / games
        if (['Units', 'Style'].includes(m.group)) assert.ok(Math.abs(mean - h.m[m.key][0]) < 0.002, `${name} ${m.key}: career figure is no longer the mean of the seasons that carry it`)
      }
    }

    // Fourth downs.
    same(!!h.d4, drawn.includes('<h2 class="panel-h">Fourth downs</h2>'), `${name}: fourth-down panel`)
    if (h.d4) {
      const d = h.d4
      const pc = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)
      same(st.get('CLEAR GO SPOTS TAKEN'), `${pc(d.follow)} ${d.dgGo}/${d.dg}`, `${name}: clear go spots`)
      same(st.get('CLOSE CALLS TAKEN'), `${pc(d.followP)} ${d.pgGo}/${d.pg}`, `${name}: close calls`)
      same(st.get('WP GIVEN AWAY / GAME'), d.lostG == null ? '—' : `${d.lostG.toFixed(2)} pts`, `${name}: win probability given away`)
      same(st.get('FOURTH DOWNS JUDGED'), String(d.n), `${name}: fourth downs judged`)
      const cap = drawn.match(/Every fourth down since (\d+), ([\d–]+) for him/)
      sameDeep([+cap[1], cap[2]], [rules.d4From, spanOf(d.first, d.last)], `${name}: fourth-down seasons`)
      same(d.small, drawn.includes(`<b>Small sample:</b> ${d.n} fourth downs so far`), `${name}: small-sample flag`)
      same(d.small, d.n < rules.d4SmallSample)
      same(d.g, src.career.d4_g ?? null, `${name}: games with fourth downs judged`)
      // A coach is ranked on fourth downs only with the games the page asks for.
      same(!!h.m.d4_lost_g, h.qualified && d.g >= rules.d4MinGames && d.lostG != null, `${name}: fourth-down rank`)
      sameDeep(
        all(drawn, /<div class="worst">(.*?)<\/div>/g).map((m) => textOf(m[1].replace(/<\/span>/g, '</span>|'))),
        d.worst.map((w) => {
          const score = w.sd == null ? '' : w.sd > 0 ? `, up ${w.sd}` : w.sd < 0 ? `, down ${-w.sd}` : ', tied'
          return `${w.season} wk ${w.wk} vs ${w.opp}|4th & ${w.ytg} at ${w.spot}, Q${w.q} ${w.t}${score}|${CHOSE[w.ch]}. Model: ${MODEL[w.best]} — −${w.lost.toFixed(1)} WP|`
        }),
        `${name}: the calls the model liked least`,
      )
    }

    // The lineage, and the play-callers most like him.
    assert.ok(p.tree, `${name}: a head coach always has a lineage block`)
    checkLineage(drawn, name, p.tree)
    if (p.calls) {
      checkStyleMatch(drawn, name, p.calls)
      same(between(drawn, '<button class="uchip on" data-unit="', '"'), p.calls.pick, `${name}: the unit his page opens on`)
    }

    // Season by season: the last plain "seasons" table on the page, newest first.
    const table = drawn.slice(drawn.lastIndexOf('<table class="seasons">'))
    const trs = all(between(table, '<tbody>', '</tbody>'), /<tr>(.*?)<\/tr>/g).map((m) => all(m[1], /<td[^>]*>(.*?)<\/td>/g).map((c) => c[1]))
    same(trs.length, h.rows.length, `${name}: number of seasons`)
    h.rows.slice().reverse().forEach((r, i) => {
      const td = trs[i]
      const where = `${name} ${r.season}`
      same(td[0], String(r.season), `${where}: year`)
      same(textOf(td[1]), r.team, `${where}: team`)
      same(textOf(td[2]), r.best ? (r.best === 4 ? `SUPER BOWL ${meta.superBowl[r.season]}` : meta.rounds[r.best].toUpperCase()) : '', `${where}: playoff round`)
      same(td[2].includes('po-tag sb'), !!r.sb, `${where}: won the Super Bowl`)
      same(td[3], `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`, `${where}: record`)
      same(td[4], r.waa == null ? '—' : fmt('sgn1', r.waa), `${where}: wins vs expected`)
      same(td[5], r.off_epa == null ? '—' : fmt('sgn3', r.off_epa), `${where}: offence EPA`)
      same(td[6], r.def_epa == null ? '—' : fmt('sgn3', r.def_epa), `${where}: defence EPA`)
      same(td[7], r.pass_rate == null ? '—' : fmt('pct1', r.pass_rate), `${where}: pass rate`)
      same(td[8], r.proe == null ? '—' : fmt('sgn1', r.proe), `${where}: PROE`)
      same(td[9], r.go_oe == null ? '—' : fmt('sgn1', r.go_oe), `${where}: fourth-down aggression`)
      same(td[10], r.d4_lost == null ? '—' : `−${(+r.d4_lost).toFixed(1)}`, `${where}: fourth-down WP lost`)
      // Who called the plays: surname, a "?" when unconfirmed, the weeks when it changed hands.
      if (!r.calls) { same(td[11], '—', `${where}: no play-callers recorded`); return }
      const [off, def] = td[11].split('<br>')
      for (const [cell, list, side] of [[off, r.calls.O, 'offence'], [def, r.calls.D, 'defence']]) {
        const drawnCallers = all(cell, /<button class="ulink" data-unit="[^"]*">([^<]*?)(?: <i>([^<]*)<\/i>)?<\/button>/g).map((m) => [unescape(m[1]), m[2] ?? null])
        sameDeep(drawnCallers, list.map((c) => [`${lastName(c[0])}${c[1] ? '' : '?'}`, list.length > 1 ? `${c[2]}–${c[3]}` : null]), `${where}: who called the ${side}`)
      }
    })
  }
  assert.equal(ranked, meta.metrics[0].pool, 'the pool the page names is the coaches it ranks')
  console.log(`      ${names.length} head coaches, ${ranked} of them ranked`)
})

// ---- 5. every play-caller --------------------------------------------------------------

test('every play-caller: what the page draws is what the files hold', () => {
  const callers = plain(page.ctx.CALLERS)
  assert.equal(Object.keys(callers).length, meta.counts.playCallers)
  for (const name of Object.keys(callers)) {
    const p = people[name]
    assert.ok(p && p.calls, `${name} is missing from the files`)
    const c = p.calls
    const drawn = page.caller(name)
    same(textOf(between(drawn, '<h1 class="cname">', '</h1>')), name)
    sameDeep(
      between(drawn, '<div class="cmeta">', '</div>').split('<br>').map(textOf),
      SIDES.filter((s) => c[s]).map((s) => `Called the ${s === 'O' ? 'offence' : 'defence'} ${c[s].years} · ${c[s].teams.join(', ')}`),
      `${name}: what he called, when and for whom`,
    )
    const st = strip(drawn)
    same(st.get('SEASONS CALLING'), String(c.seasons), `${name}: seasons calling`)
    same(st.get('UNITS'), String(c.units.length), `${name}: units`)
    same(st.get('OFFENSIVE SNAPS'), c.O ? String(c.O.plays) : undefined, `${name}: offensive snaps`)
    same(st.get('DEFENSIVE SNAPS'), c.D ? String(c.D.plays) : undefined, `${name}: defensive snaps`)
    for (const side of SIDES) if (c[side]) same(c[side].years, yearsLabel(c.units.filter((u) => u.side === side).map((u) => u.season)), `${name}: years label`)
    const unsure = drawn.match(/<span class="badge">(\d+) UNCONFIRMED SEASONS?<\/span>/)
    same(unsure ? +unsure[1] : 0, (c.O ? c.O.unsure : 0) + (c.D ? c.D.unsure : 0), `${name}: unconfirmed units`)
    same((c.O ? c.O.unsure : 0) + (c.D ? c.D.unsure : 0), c.units.filter((u) => !u.sure).length, `${name}: unconfirmed units are the ones marked`)

    // His units, in the page's order, with the page's marks: "?" unconfirmed, weeks when partial.
    const chipsDrawn = all(between(drawn, '<div class="uchips">', '</div>'), /<button class="uchip( on)?" data-unit="([^"]*)">([^<]*)<\/button>/g)
    sameDeep(chipsDrawn.map((m) => m[2]), c.units.map((u) => u.id), `${name}: his units, newest first`)
    c.units.forEach((u, i) => {
      same(unescape(chipsDrawn[i][3]), `${u.season} ${u.team} ${u.side === 'O' ? 'OFF' : 'DEF'}${u.sure ? '' : '?'}${u.wk[0] > 1 || u.wk[1] < 17 ? ` · wk ${u.wk[0]}–${u.wk[1]}` : ''}`, `${name}: unit ${u.id}`)
      const src = page.ctx.UNITS[u.id]
      sameDeep([u.small, u.plays, u.games, u.sure], [!!src.small, src.m.plays, src.m.games, src.sure !== false], `${name}: unit ${u.id} facts`)
    })
    same(chipsDrawn.find((m) => m[1])[2], c.pick, `${name}: the unit his page opens on`)

    checkStyleMatch(drawn, name, c)
    // A play-caller's own page (the one a man with no head-coaching record gets) shows a
    // lineage only when the tree has him or someone under him.
    if (!p.hc) {
      same(drawn.includes('WHERE HE COMES FROM'), !!p.tree, `${name}: lineage shown or not`)
      if (p.tree) checkLineage(drawn, name, p.tree)
    }
  }
  console.log(`      ${Object.keys(callers).length} play-callers`)
})

// ---- 6. every unit ---------------------------------------------------------------------

test('every unit: every bar the page draws, with its percentile, is in the files', () => {
  const units = plain(page.ctx.UNITS)
  assert.equal(Object.keys(units).length, meta.counts.units)
  let cells = 0
  let unranked = 0
  for (const [id, src] of Object.entries(units)) {
    const file = out.units[src.season]
    const u = file.units[id]
    assert.ok(u, `unit ${id} is missing from the files`)
    const drawn = page.unit(id)
    const side = u.side === 'O' ? 'offence' : 'defence'

    same(textOf(between(drawn, '<div class="utitle">', '</div>')), `${u.season} ${u.team} ${side} · weeks ${u.wk[0]}${u.wk[1] !== u.wk[0] ? `–${u.wk[1]}` : ''}`, `${id}: title`)
    const [who, sample] = all(drawn, /<div class="umeta[^"]*">(.*?)<\/div>/g).map((m) => m[1])
    sameDeep(chips(who).map((c) => c[0]), [u.caller, ...u.hc], `${id}: play-caller and head coach`)
    same(who.includes('class="unsure"'), !u.sure, `${id}: unconfirmed tag`)
    same(textOf(sample), `${u.plays} snaps · ${u.games} game${u.games === 1 ? '' : 's'}${u.small ? ' · too few snaps to rank — values shown, percentiles not' : ''}`, `${id}: snaps, games, small`)
    const note = between(drawn, '<b>NOT IN THIS SEASON</b>', '</div>')
    same(note == null ? null : textOf(note), meta.notes.era[u.era], `${id}: the "not in this season" note`)

    const rows = bars(drawn)
    const mine = ordered(meta.unitGroups[u.side], meta.unitMetrics[u.side]).filter((m) => u.m[m.key])
    sameDeep(rows.map((r) => r.k), mine.map((m) => `u:${u.side}:${m.key}`), `${id}: which stats are drawn`)
    if (u.small) unranked++
    rows.forEach((r, i) => {
      const m = mine[i]
      const [v, pct] = u.m[m.key]
      same(r.label, m.label, `${id} ${m.key}: label`)
      same(r.tag, m.style ? 'HOW MUCH' : 'HOW GOOD', `${id} ${m.key}: how much or how good`)
      same(r.pct, pctText(pct), `${id} ${m.key}: percentile`)
      same(r.val, fmt(m.unit, v), `${id} ${m.key}: value`)
      const pair = u.pair && u.pair[m.key]
      same(r.pair == null ? null : unescape(r.pair), pair ? `${fmt('sgn3', pair[0])} / ${fmt('sgn3', pair[1])}` : null, `${id} ${m.key}: EPA with and without`)
      if (u.small) same(pct, null, `${id} ${m.key}: a small unit is not ranked`)
      cells++
    })

    sameDeep(
      all(drawn, /<div class="lrow" data-unit="[^"]*"><span class="ln">([^<]*)<\/span><span class="lv">(\d+) (\S+) · closer than ([^%]*)% of pairs<\/span><\/div>/g).map((m) => [unescape(m[1]), +m[2], m[3], m[4]]),
      (u.comps || []).map((c) => [c[0], c[1], c[2], page.ctx.capP(c[3])]),
      `${id}: units most like it`,
    )
    const arrived = between(drawn, 'WHAT CHANGED WHEN HE TOOK IT OVER</div>', null)
    same(!!arrived, !!u.arrival, `${id}: arrival block`)
    if (u.arrival) {
      const byKey = new Map(meta.unitMetrics[u.side].map((m) => [m.key, m]))
      sameDeep(
        all(arrived, /<div class="arr"><span class="al">([^<]*)<\/span><span class="av">([^<]*) <span class="arrow">▶<\/span> <b>([^<]*)<\/b><\/span><\/div>/g).map((m) => [unescape(m[1]), m[2], m[3]]),
        u.arrival.changes.map((c) => [byKey.get(c[0]).label, fmt(byKey.get(c[0]).unit, c[1]), fmt(byKey.get(c[0]).unit, c[2])]),
        `${id}: what changed`,
      )
      const prev = u.arrival.prev
      const before = prev ? `${prev.season} ${prev.team} ${prev.side === 'O' ? 'offence' : 'defence'} (weeks ${prev.wk[0]}${prev.wk[1] !== prev.wk[0] ? `–${prev.wk[1]}` : ''})` : 'unit before him'
      same(textOf(between(arrived, '<div class="panel-cap">', '</div>')).split('. The biggest')[0], `Against ${u.arrival.caller}'s ${before}`, `${id}: against whom`)
    }
  }
  console.log(`      ${Object.keys(units).length} units (${unranked} too small to rank), ${cells.toLocaleString('en-US')} bars`)
  assert.ok(cells > 15000, 'suspiciously few unit bars')
})

// ---- 7. the index, and what is on disk -------------------------------------------------

test('the index lists everyone the page can open, once', () => {
  const coaches = plain(page.ctx.COACHES)
  const callers = plain(page.ctx.CALLERS)
  const names = new Set([...Object.keys(coaches), ...Object.keys(callers)])
  assert.equal(out.coaches.count, names.size)
  assert.equal(out.coaches.people.length, names.size)
  assert.equal(new Set(out.coaches.people.map((r) => r.name)).size, names.size, 'a name is listed twice')
  assert.deepEqual(Object.keys(people).sort(), [...names].sort())
  for (const r of out.coaches.people) {
    assert.ok(page.ctx.isPerson(r.name), `${r.name} has no page`)
    same(r.hc, !!coaches[r.name], `${r.name}: head coach or not`)
    sameDeep(r.sides, SIDES.filter((s) => callers[r.name] && callers[r.name][s]), `${r.name}: sides called`)
    if (r.hc) {
      const car = coaches[r.name].career
      sameDeep([r.first, r.last, r.teams, r.seasons, r.w, r.l, r.t], [car.first, car.last, car.teams, car.seasons, car.w, car.l, car.t], `${r.name}: index row`)
    }
    // The page orders search results by this number: career games, or games called if more.
    const g = Math.max(coaches[r.name] ? coaches[r.name].career.g : 0, ...SIDES.map((s) => (callers[r.name] && callers[r.name][s] ? callers[r.name][s].games : 0)))
    same(r.g, g, `${r.name}: games`)
  }
  console.log(`      ${compared.toLocaleString('en-US')} values compared with the page so far`)
})

test('what is written to disk is what was built, and stays inside the budget', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-coaching-'))
  try {
    const r = writeCoachingApi({ publicDir: PUBLIC, dist })
    const root = path.join(dist, BASE)
    const gz = (f) => JSON.parse(gunzipSync(readFileSync(path.join(root, f))).toString('utf8'))
    const raw = (f) => JSON.parse(readFileSync(path.join(root, f), 'utf8'))
    assert.ok(identical(raw('meta.json'), out.meta), 'meta.json on disk is not what was built')
    assert.ok(identical(raw('coaches.json'), out.coaches), 'coaches.json on disk is not what was built')
    assert.ok(identical(gz('profiles/all.json.gz'), out.profiles), 'profiles/all.json.gz on disk is not what was built')
    assert.deepEqual(readdirSync(path.join(root, 'profiles')), ['all.json.gz'])
    assert.deepEqual(readdirSync(path.join(root, 'units')).sort(), Object.keys(out.units).map((s) => `${s}.json.gz`).sort())
    for (const s of Object.keys(out.units)) {
      assert.match(s, /^\d{4}$/)
      assert.ok(identical(gz(`units/${s}.json.gz`), out.units[s]), `units/${s}.json.gz on disk is not what was built`)
    }
    // Every file carries the schema the shared loader insists on.
    for (const body of [out.meta, out.coaches, out.profiles, ...Object.values(out.units)]) assert.equal(body.schema, 1)
    let bytes = 0
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else bytes += statSync(f).size } }
    walk(root)
    assert.equal(r.bytes, bytes, 'bytes reported is not bytes on disk')
    assert.equal(r.files, 3 + Object.keys(out.units).length)
    assert.ok(r.raw > r.bytes)
    assert.match(r.summary, /head coaches/)
    console.log(`      ${r.files} files, ${(r.raw / 1024).toFixed(0)} KB of JSON, ${(bytes / 1024).toFixed(0)} KB on disk (budget ${(BUDGET / 1024).toFixed(0)} KB)`)
    assert.ok(bytes < BUDGET, `the coaching files grew to ${(bytes / 1048576).toFixed(2)} MB`)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('a page or data file that changed shape is refused, with the reason', () => {
  assert.throws(() => buildCoachingApi({ data, current, html: html.replace('var MIN_SEASONS=3;', '') }), /coaching-savant\.html/)
  assert.throws(() => buildCoachingApi({ data, current, html: html.replace(/\binit\(\);\s*<\/script>/, '</script>') }), /no longer ends by calling init/)
  assert.throws(() => buildCoachingApi({ data, current, html: html.replace('!(c.d4_g>=48)', '!(c.d4_g>=LIMIT)') }), /fourth-down pool rule/)
  assert.throws(() => buildCoachingApi({ data, current, html: '<html></html>' }), /no inline script/)
  assert.throws(() => buildCoachingApi({ data: { coaches: {} }, current, html }), /coaching-savant-data\.json/)
  assert.throws(() => buildCoachingApi({ data, current: { week: 3 }, html }), /coaching-savant-current\.json/)
})

// ---- 8. the tools ----------------------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// The site's CDN: the files, and the homepage for anything else (which is what the live
// catch-all rewrite does, with a 200). Each answer closes its connection: a kept-alive socket
// that the server drops just as the next fetch reuses it fails that fetch, which on a busy
// machine made this check fail once for no reason of its own.
let hits = 0
const served = { meta: out.meta, coaches: out.coaches, profiles: out.profiles, units: { ...out.units } }
const cdn = http.createServer((req, res) => {
  hits++
  const p = decodeURIComponent(req.url).replace(`/${BASE}/`, '')
  const season = p.match(/^units\/(\d{4})\.json$/)
  const body = p === 'meta.json' ? served.meta : p === 'coaches.json' ? served.coaches : p === 'profiles/all.json' ? served.profiles : season ? served.units[season[1]] : null
  if (!body) { res.writeHead(200, { 'content-type': 'text/html', connection: 'close' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify(body))
})

let core
let api
let search
let profile
let client

before(async () => {
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(cdn)}`
  core = await import('../../api/_core.js')
  api = await import('../../api/_coaching.js')
  search = api.tools.find((t) => t.name === 'nfl_search_coaches')
  profile = api.tools.find((t) => t.name === 'nfl_get_coach_profile')

  // The tools as an MCP client meets them: registered the way api/mcp.js registers a section.
  const server = new McpServer({ name: 'check', version: '0' })
  for (const tool of api.tools) {
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

const ordinal = (n) => { const t = n % 100; return t >= 11 && t <= 13 ? `${n}th` : `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}` }
const textOfResult = (r) => r.content.map((c) => c.text).join('\n')
const sideWord = { O: 'offence', D: 'defence' }

// Run a tool the way the connector does: arguments through the input schema first, and the
// structured result has to fit the output schema.
async function run(tool, args) {
  const input = z.object(tool.config.inputSchema).parse(args)
  const r = await tool.run(input)
  z.object(tool.config.outputSchema).strict().parse(r.structured)
  return r
}
const fails = async (tool, args, re) => {
  await assert.rejects(run(tool, args), (err) => {
    assert.ok(err instanceof core.SavantError, `${JSON.stringify(args)}: expected a SavantError, got ${err && err.constructor.name}: ${err && err.message}`)
    for (const one of [re].flat()) assert.match(err.message, one, JSON.stringify(args))
    assert.doesNotMatch(err.message, /ECONNREFUSED|127\.0\.0\.1|\bat .*\.js|savant-api\//, 'an error leaked an internal detail')
    return true
  })
}

test('the two tools are declared the way the connector expects', async () => {
  assert.deepEqual(api.tools.map((t) => t.name), ['nfl_search_coaches', 'nfl_get_coach_profile'])
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['nfl_get_coach_profile', 'nfl_search_coaches'])
  for (const t of tools) {
    assert.ok(t.name.length <= 64)
    assert.ok(t.title && t.annotations.title, `${t.name}: title`)
    assert.equal(t.annotations.readOnlyHint, true, `${t.name}: read-only`)
    assert.equal(t.annotations.destructiveHint, false)
    assert.equal(t.annotations.openWorldHint, false)
    assert.ok(t.description.length > 80, `${t.name}: description`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.outputSchema, `${t.name}: output schema`)
    for (const [k, prop] of Object.entries(t.inputSchema.properties)) assert.ok(prop.description, `${t.name}.${k}: described`)
  }
  // Descriptions describe; they do not instruct.
  for (const t of api.tools) assert.doesNotMatch(t.config.description, /\b(always|never|must|should|make sure|be sure|prefer|use this)\b/i, `${t.name}: the description tells the model what to do`)
})

test('a profile says what the files hold and what the page draws, for every coach and caller', async () => {
  let profiles = 0
  let stats = 0
  let longest = 0
  for (const row of out.coaches.people) {
    const p = people[row.name]
    const { structured: s, text } = await run(profile, { coach: row.name })
    profiles++
    longest = Math.max(longest, text.length)
    const where = row.name

    assert.equal(s.coach.id, row.name)
    assert.equal(s.url, `https://wcehoops.com/coaching-savant.html#c=${encodeURIComponent(row.name)}`)
    assert.ok(text.includes(s.url), `${where}: the text links his page`)
    for (const note of s.notes) assert.ok(text.includes(note), `${where}: a caveat is in the notes but not in the text: ${note.slice(0, 60)}`)
    assert.equal(new Set(s.notes).size, s.notes.length, `${where}: a caveat is repeated`)
    assert.ok(text.length < 12000, `${where}: ${text.length} characters`)

    if (!p.hc) {
      assert.equal(s.head_coach, null)
      assert.equal(s.career_stats, undefined)
      assert.match(text, /No head-coaching record since 1999/)
    } else {
      const h = p.hc
      assert.deepEqual(
        [s.head_coach.wins, s.head_coach.losses, s.head_coach.ties, s.head_coach.win_pct, s.head_coach.playoff_wins, s.head_coach.playoff_losses, s.head_coach.playoff_seasons, s.head_coach.super_bowls_won, s.head_coach.super_bowls_lost, s.head_coach.wins_above_expectation, s.head_coach.seasons, s.head_coach.ranked],
        [h.w, h.l, h.t, h.winpct, h.pw, h.pl, h.po, h.sb, h.sbLost, h.waa, h.seasons, h.qualified],
        `${where}: record`,
      )
      // The record line, built from what the page's strip prints.
      const strp = strip(page.coach(row.name))
      assert.ok(text.includes(`Regular season ${strp.get('RECORD')} (${strp.get('WIN %')}). Playoffs ${strp.get('PLAYOFFS')}; reached the playoffs in ${h.po} of ${h.seasons} season`), `${where}: the record line`)
      assert.ok(text.includes(`Wins vs expected: ${strp.get('WINS VS EXPECTED')} `), `${where}: wins vs expected`)

      // Every ranked stat: the file's value and percentile, the page's printed value, the pool.
      const mine = ordered(meta.groups, meta.metrics).filter((m) => h.m[m.key])
      assert.deepEqual(s.career_stats.map((x) => x.key), mine.map((m) => m.key), `${where}: stat list`)
      for (const x of s.career_stats) {
        const m = meta.metrics.find((y) => y.key === x.key)
        assert.deepEqual([x.value, x.percentile], h.m[x.key], `${where} ${x.key}`)
        assert.equal(x.display, fmt(m.unit, x.value), `${where} ${x.key}: printed as the page prints it`)
        assert.equal(x.pool_size, m.pool)
        assert.equal(x.lower_is_better, m.lowerIsBetter)
        assert.equal(x.pool, x.key.startsWith('d4_') ? 'head coaches with at least 48 games in the fourth-down data, which starts in 2014' : 'head coaches with at least 3 seasons since 1999', `${where} ${x.key}: pool`)
        assert.ok(text.includes(`- ${m.label}: ${x.display} (${ordinal(x.percentile)} percentile)`), `${where} ${x.key}: the text line`)
        assert.equal(x.what, m.what)
        assert.ok(text.split(`- ${m.label}: `)[1].split('\n')[0].endsWith(`. ${m.what}`), `${where} ${x.key}: the page's explanation of the stat`)
        if (m.lowerIsBetter) assert.match(text.split(`- ${m.label}: `)[1].split('\n')[0], /lower is better/, `${where} ${x.key}: flip is flagged`)
        stats++
      }
      // Nothing the page hides is shown; everything it hides is listed with a reason.
      assert.deepEqual([...s.career_stats.map((x) => x.key), ...s.not_shown.map((x) => x.key)].sort(), h.qualified ? meta.metrics.map((m) => m.key).sort() : [], `${where}: shown plus not shown`)
      if (h.qualified) {
        assert.match(text, /ranked against head coaches with at least 3 seasons since 1999: 119 of them/, `${where}: the pool is named`)
        assert.match(text, /Fourth downs group is ranked in a different pool: head coaches with at least 48 games in the fourth-down data, which starts in 2014\./, `${where}: the second pool is named`)
      } else {
        assert.match(text, /not ranked for him: fewer than 3 seasons/, `${where}: an unranked career says so`)
        assert.deepEqual(s.career_stats, [])
      }
      if (h.part) assert.match(text, /of his \d+ seasons/, `${where}: a part-career average says so`)

      assert.equal(s.fourth_downs == null, !h.d4, `${where}: fourth downs`)
      if (h.d4) {
        assert.deepEqual([s.fourth_downs.judged, s.fourth_downs.clear_go_taken_pct, s.fourth_downs.close_calls_taken_pct, s.fourth_downs.win_probability_lost_per_game, s.fourth_downs.small_sample], [h.d4.n, h.d4.follow, h.d4.followP, h.d4.lostG, h.d4.small], `${where}: fourth-down strip`)
        if (h.d4.small) assert.match(text, /Small sample: \d+ fourth downs so far/, `${where}: small sample is flagged`)
      }

      assert.equal(s.seasons.length, h.rows.length)
      h.rows.slice().reverse().forEach((r, i) => {
        const x = s.seasons[i]
        assert.deepEqual([x.season, x.team, x.wins, x.losses, x.ties, x.won_super_bowl, x.wins_above_expectation ?? undefined, x.offence_epa ?? undefined], [r.season, r.team, r.w, r.l, r.t, !!r.sb, r.waa, r.off_epa], `${where} ${r.season}`)
        assert.equal(x.playoff_round, r.best ? meta.rounds[r.best] : null)
        assert.equal(x.through_week, r.season === meta.current.season ? meta.current.week : null, `${where} ${r.season}: season in progress`)
      })
    }

    // The lineage, always with the page's caveat beside it.
    assert.equal(s.lineage == null, !p.tree, `${where}: lineage`)
    if (p.tree) {
      assert.deepEqual(s.lineage.chain.map((c) => [c.name, c.has_page]), p.tree.chain)
      assert.equal(s.lineage.mentor, p.tree.chain.length ? p.tree.chain[0][0] : null)
      assert.equal(s.lineage.root, p.tree.root)
      assert.deepEqual(s.lineage.coached_under_him.map((c) => [c.name, c.has_page]), p.tree.kids)
      assert.ok(s.notes.includes(`About the lineage: ${data.treeNote}`), `${where}: the lineage came without its caveat`)
      assert.match(text, /Lineage \(hand-curated\)/)
    }

    // What he called, always with the page's caveat beside it.
    assert.equal(s.play_calling == null, !p.calls, `${where}: play-calling`)
    assert.ok(s.notes.includes(`About the play-callers: ${data.callerNote}`), `${where}: play-calling came without its caveat`)
    if (p.calls) {
      assert.deepEqual(s.play_calling.units.map((u) => [u.season, u.team, u.side, u.confirmed, u.ranked]), p.calls.units.map((u) => [u.season, u.team, sideWord[u.side], u.sure, !u.small]))
      assert.equal(s.units.length, 1, `${where}: one unit in full by default`)
      const picked = p.calls.units.find((u) => u.id === p.calls.pick)
      assert.deepEqual([s.units[0].season, s.units[0].team, s.units[0].side, s.units[0].first_week], [picked.season, picked.team, sideWord[picked.side], picked.wk[0]], `${where}: the unit his page opens on`)
    } else {
      assert.deepEqual(s.units, [])
    }

    const live = (p.hc && p.hc.last === meta.current.season) || (p.calls && p.calls.units.some((u) => u.season === meta.current.season))
    assert.deepEqual(s.season_in_progress, live ? { season: meta.current.season, through_week: meta.current.week } : null, `${where}: season in progress`)
    if (live) assert.match(text, new RegExp(`${meta.current.season} (is counted|play-calling is counted) through week ${meta.current.week} of (its|the) regular season`), `${where}: the partial season is not flagged`)
  }
  console.log(`      ${profiles} profiles, ${stats.toLocaleString('en-US')} ranked career stats, longest answer ${longest.toLocaleString('en-US')} characters`)
  assert.equal(profiles, meta.counts.people)
})

test('a unit in full says what the files hold and what the page draws, for every unit', async () => {
  let units = 0
  let cells = 0
  let longest = 0
  for (const [name, p] of Object.entries(people)) {
    if (!p.calls) continue
    for (const season of new Set(p.calls.units.map((u) => u.season))) {
      const { structured: s, text } = await run(profile, { coach: name, group: 'play_calling', season })
      longest = Math.max(longest, text.length)
      const wanted = p.calls.units.filter((u) => u.season === season)
      assert.equal(s.units.length, wanted.length, `${name} ${season}: units returned`)
      for (const note of s.notes) assert.ok(text.includes(note), `${name} ${season}: a caveat is in the notes but not in the text`)
      assert.equal(s.career_stats, undefined, 'asking for play-calling is asking for less')
      wanted.forEach((row, i) => {
        const file = out.units[season]
        const u = file.units[row.id]
        const x = s.units[i]
        const where = row.id
        const drawn = bars(page.unit(row.id))
        assert.deepEqual([x.season, x.team, x.side, x.first_week, x.last_week, x.caller, x.confirmed, x.snaps, x.games, x.ranked, x.pool_size], [u.season, u.team, sideWord[u.side], u.wk[0], u.wk[1], name, u.sure, u.plays, u.games, !u.small, file.ranked[u.side]], `${where}: unit facts`)
        assert.equal(x.pool, `${season} ${sideWord[u.side]}s`, `${where}: pool`)
        assert.equal(x.stats.length, drawn.length, `${where}: as many stats as the page draws`)
        x.stats.forEach((st, j) => {
          assert.deepEqual([st.value, st.percentile], u.m[st.key], `${where} ${st.key}`)
          assert.equal(`u:${u.side}:${st.key}`, drawn[j].k, `${where} ${st.key}: the page's order`)
          assert.equal(st.display, drawn[j].val, `${where} ${st.key}: printed as the page prints it`)
          assert.equal(pctText(st.percentile), drawn[j].pct, `${where} ${st.key}: the page's percentile`)
          assert.equal(st.kind, drawn[j].tag.toLowerCase(), `${where} ${st.key}: how much or how good`)
          assert.ok(text.includes(`- ${st.label}: ${st.display} (${st.percentile == null ? 'not ranked' : ordinal(st.percentile)}; ${st.kind}`), `${where} ${st.key}: the text line`)
          if (drawn[j].pair) assert.ok(text.includes(`EPA per snap with it ${unescape(drawn[j].pair).split(' / ')[0]}, without ${unescape(drawn[j].pair).split(' / ')[1]}`), `${where} ${st.key}: EPA with and without`)
          // Asked for on its own, each stat carries the page's explanation, once per answer.
          const what = meta.unitMetrics[u.side].find((m) => m.key === st.key).what
          assert.equal(st.what, what)
          assert.equal(text.split(`. ${what}\n`).length - 1, 1, `${where} ${st.key}: explained once`)
          cells++
        })
        // A stat with no value is listed as having none. It is never a zero.
        const all35 = meta.unitMetrics[u.side].map((m) => m.key)
        assert.deepEqual([...x.stats.map((st) => st.key), ...x.no_value.map((m) => m.key)].sort(), all35.slice().sort(), `${where}: shown plus no value`)
        // The flags the page puts on a unit, in words.
        if (!u.sure) { assert.match(text, /\(UNCONFIRMED\)/); assert.ok(s.notes.includes(`Unconfirmed: ${meta.notes.unconfirmed}`), `${where}: unconfirmed without its explanation`) }
        else assert.doesNotMatch(text.split('\n').find((l) => l.startsWith(`${u.season} ${u.team} ${sideWord[u.side]}, week`)), /UNCONFIRMED/)
        if (u.small) { assert.match(text, /too few snaps to rank: its values are shown, percentiles are not/); assert.ok(x.stats.every((st) => st.percentile === null), `${where}: a small unit was ranked`) }
        else assert.ok(text.includes(`ranked against the ${file.ranked[u.side]} ${sideWord[u.side]}s of ${season} with enough snaps to rank`), `${where}: the pool is named`)
        if (meta.notes.era[u.era]) assert.ok(text.includes(`Not in this season: ${meta.notes.era[u.era]}`), `${where}: the missing-source note`)
        assert.equal(x.through_week, season === meta.current.season ? meta.current.week : null)
        if (season === meta.current.season) assert.match(text, new RegExp(`The ${season} units are counted through week ${meta.current.week} of the regular season`), `${where}: the partial season is not flagged`)
        units++
      })
    }
  }
  console.log(`      ${units} units in full, ${cells.toLocaleString('en-US')} stats, longest answer ${longest.toLocaleString('en-US')} characters`)
  assert.equal(units, meta.counts.units)
  assert.ok(longest < 12000)
})

test('each part of a profile can be asked for alone, and every answer fits its shape', async () => {
  const reid = 'Andy Reid'
  const career = await run(profile, { coach: reid, group: 'career' })
  assert.ok(career.structured.career_stats.length > 15)
  for (const k of ['fourth_downs', 'seasons', 'lineage', 'play_calling', 'units']) assert.equal(career.structured[k], undefined, `career alone carries ${k}`)

  const fourth = await run(profile, { coach: reid, group: 'fourth_downs' })
  assert.equal(fourth.structured.fourth_downs.calls_the_model_liked_least.length, people[reid].hc.d4.worst.length)
  assert.match(fourth.text, /The calls the model liked least:/)
  assert.match(fourth.text, /What the model cannot see: injuries, his kicker beyond the league average, the wind on the day\./)
  assert.equal((await run(profile, { coach: reid })).structured.fourth_downs.calls_the_model_liked_least, undefined, 'single calls stay out of the overview')

  const seasons = await run(profile, { coach: reid, group: 'seasons' })
  const drawn = page.coach(reid)
  const table = drawn.slice(drawn.lastIndexOf('<table class="seasons">'))
  const trs = all(between(table, '<tbody>', '</tbody>'), /<tr>(.*?)<\/tr>/g).map((m) => all(m[1], /<td[^>]*>(.*?)<\/td>/g).map((c) => c[1]))
  for (const td of trs) {
    const line = seasons.text.split('\n').find((l) => l.startsWith(`${td[0]} ${td[1]} ${td[3]}`))
    assert.ok(line, `${td[0]}: no line for the season`)
    for (const [tag, cell] of [['W vs exp', td[4]], ['Off EPA', td[5]], ['Def EPA', td[6]], ['Pass', td[7]], ['PROE', td[8]], ['4th agg', td[9]], ['4th WP lost', td[10]]]) {
      assert.ok(line.includes(` · ${tag} ${cell}`), `${td[0]}: ${tag} should read ${cell} in "${line}"`)
    }
  }
  assert.match(seasons.text, /2024 KC 15–2 · lost Super Bowl LIX/)
  assert.match(seasons.text, /2023 KC 11–6 · won Super Bowl LVIII/)
  assert.match(seasons.text, /2021 KC 12–5 · playoffs: Conference championship/)
  assert.match(seasons.text, new RegExp(`${current.season} KC \\d+–\\d+ \\(through week ${current.week}\\)`))

  const lineage = await run(profile, { coach: reid, group: 'lineage' })
  assert.match(lineage.text, /Learned under Mike Holmgren: quarterbacks and assistant head coach, Green Bay Packers, 1992–98\./)
  assert.match(lineage.text, /Line: Andy Reid ← Mike Holmgren ← Bill Walsh ← Paul Brown\. Traces back to the Paul Brown tree\./)
  assert.ok(lineage.text.includes(data.treeNote))

  // Every kind of person, every group: the result fits the declared shape (run() checks it).
  const kinds = [
    reid,
    out.coaches.people.find((r) => r.hc && r.seasons < 3 && !r.sides.length).name,           // too short to rank
    out.coaches.people.find((r) => r.hc && r.last < 2006).name,                               // before PROE and the fourth-down model
    out.coaches.people.find((r) => !r.hc && r.sides.includes('D')).name,                      // a play-caller only
    out.coaches.people.find((r) => r.hc && !r.sides.length && r.last >= 2020).name,           // a head coach who does not call plays
    Object.keys(people).find((n) => people[n].hc && !people[n].tree.chain.length),            // no mentor recorded
    Object.keys(people).find((n) => people[n].calls && people[n].calls.units.some((u) => !u.sure)),
    'Jim Mora',
  ]
  for (const coach of kinds) for (const group of api.GROUPS) await run(profile, { coach, group })

  // A play-caller who was never a head coach has nothing in the head-coach groups, and says so.
  const only = out.coaches.people.find((r) => !r.hc).name
  const none = await run(profile, { coach: only, group: 'career' })
  assert.match(none.text, /no head-coaching record, so there is nothing in "career" for him/)
  // A head coach from before play-callers were recorded says that, not "he did not call plays".
  const old = await run(profile, { coach: out.coaches.people.find((r) => r.hc && r.last < 2018).name, group: 'play_calling' })
  assert.match(old.text, /Play-callers are recorded from 2018, after his last season/)
  assert.equal(old.structured.play_calling, null)
})

test('the cautions that apply to one coach reach the answer', async () => {
  // Two men, one page: the answer does not pass the sum off as one career.
  const mora = await run(profile, { coach: 'Jim Mora' })
  assert.match(mora.text, /two different head coaches under this one name: Jim E\. Mora .* and his son Jim L\. Mora/)
  assert.ok(mora.structured.notes.some((n) => /two different head coaches/.test(n)))
  const rows = people['Jim Mora'].hc.rows
  assert.ok(rows.some((r) => r.team === 'IND') && rows.some((r) => r.team === 'ATL'), 'the Jim Mora page is no longer two men; drop the note in api/_coaching.js')

  // A career average the page has only some seasons for says how many.
  const part = Object.entries(people).find(([, p]) => p.hc && p.hc.part && p.hc.part.off_epa)
  const partial = await run(profile, { coach: part[0], group: 'career' })
  assert.equal(partial.structured.career_stats.find((x) => x.key === 'off_epa').seasons_covered, part[1].hc.part.off_epa)
  assert.ok(partial.text.includes(`from ${part[1].hc.part.off_epa} of his ${part[1].hc.seasons} seasons`))

  // Ranked on his career but not on fourth downs: the reason is given, with his number.
  const short = Object.entries(people).find(([, p]) => p.hc && p.hc.qualified && p.hc.d4 && p.hc.d4.g < meta.rules.d4MinGames)
  const fourth = await run(profile, { coach: short[0], group: 'career' })
  assert.ok(fourth.text.includes(`ranked only with 48 games in the fourth-down data, which starts in 2014; the page has ${short[1].hc.d4.g} for him`))
  assert.ok(fourth.structured.not_shown.some((x) => x.key === 'd4_follow'))
  assert.ok(!fourth.structured.career_stats.some((x) => x.key.startsWith('d4_')))

  // A head coach whose season is in progress: it counts, and the answer says it counts.
  const active = Object.entries(people).find(([, p]) => p.hc && p.hc.last === meta.current.season && p.hc.seasons === meta.rules.minSeasons)
  if (active) {
    const r = await run(profile, { coach: active[0], group: 'career' })
    assert.match(r.text, /It still counts as one of his seasons: in the season count, in the playoff rate, and toward the 3-season line for ranking\./)
  }
})

test('values print the way the page prints them', () => {
  const units = new Set()
  let n = 0
  const check = (unit, v) => { units.add(unit); assert.equal(api.display(unit, v), fmt(unit, v), `${unit} ${v}`); n++ }
  for (const p of Object.values(people)) {
    if (!p.hc) continue
    for (const m of meta.metrics) if (p.hc.m[m.key]) check(m.unit, p.hc.m[m.key][0])
    for (const r of p.hc.rows) { check('sgn1', r.waa); check('sgn3', r.off_epa); check('pct1', r.pass_rate); check('sgn1', r.proe) }
  }
  for (const file of Object.values(out.units)) {
    for (const u of Object.values(file.units)) {
      for (const m of meta.unitMetrics[u.side]) if (u.m[m.key]) check(m.unit, u.m[m.key][0])
      for (const pair of Object.values(u.pair || {})) { check('sgn3', pair[0]); check('sgn3', pair[1]) }
      for (const c of u.comps || []) assert.equal(api.pairShare(c[3]), page.ctx.capP(c[3]))
    }
  }
  for (const unit of ['pct1', 'num0', 'num1', 'num2', 'sgn1', 'sgn2', 'sgn3', 'sec']) {
    for (const v of [0, -0.0004, 0.0004, -0.04, 0.05, -1, 1, 12.345, -12.345, 99.95, null, undefined, NaN]) check(unit, v)
  }
  for (const m of [...meta.metrics, ...meta.unitMetrics.O, ...meta.unitMetrics.D]) assert.ok(units.has(m.unit), `no value seen for unit ${m.unit}`)
  for (const v of [0, 0.4, 1, 49.5, 98.99, 99, 99.04, 99.95, 100]) assert.equal(api.pairShare(v), page.ctx.capP(v), `pair share ${v}`)
  console.log(`      ${n.toLocaleString('en-US')} values printed both ways`)
  assert.ok(n > 20000)
})

test('names are matched the way people type them', async () => {
  const first = async (query) => (await run(search, { query })).structured.coaches[0]?.name
  assert.equal(await first('andy reid'), 'Andy Reid')
  assert.equal(await first('REID'), 'Andy Reid')
  assert.equal(await first('Séan McVay'), 'Sean McVay')                  // accents
  assert.equal(await first('Kevin OConnell'), "Kevin O'Connell")         // punctuation
  assert.equal(await first('bill o’brien'), "Bill O'Brien")              // a curly apostrophe
  assert.equal(await first('oshea'), "Chad O'Shea")
  assert.equal(await first('Ken Norton'), 'Ken Norton Jr.')             // the suffix left off
  assert.equal(await first('Joe Whitt Jr'), 'Joe Whitt Jr.')
  assert.equal(await first('Sean McVey'), 'Sean McVay')                  // typos
  assert.equal(await first('Bill Belichik'), 'Bill Belichick')
  assert.equal(await first('Kyle Shanahn'), 'Kyle Shanahan')
  assert.equal(await first('lafleur'), 'Matt LaFleur')                   // the longer career first, as the page orders it

  // Two men, one surname: both come back, and the profile will not pick for you.
  for (const [surname, both] of [['Harbaugh', ['Jim Harbaugh', 'John Harbaugh']], ['Shanahan', ['Kyle Shanahan', 'Mike Shanahan']], ['Belichick', ['Bill Belichick', 'Steve Belichick']], ['Gruden', ['Jay Gruden', 'Jon Gruden']]]) {
    const r = await run(search, { query: surname })
    assert.deepEqual(r.structured.coaches.map((c) => c.name).sort(), both, surname)
    await fails(profile, { coach: surname }, [new RegExp(`^2 coaches match "${surname}"\\. Call again with one of these names:\\n- `), new RegExp(`\\n- ${both[0]}: `), new RegExp(`\\n- ${both[1]}: `)])
    const full = await run(profile, { coach: both[0], group: 'lineage' })
    assert.equal(full.structured.coach.name, both[0])
  }
  // One page for two men who share a name: the search result is one row, the profile carries the note.
  assert.deepEqual((await run(search, { query: 'Mora' })).structured.coaches.map((c) => c.name), ['Jim Mora'])

  const row = (await run(search, { query: 'Andy Reid' })).structured.coaches[0]
  const h = people['Andy Reid'].hc
  assert.deepEqual(row, {
    id: 'Andy Reid', name: 'Andy Reid', roles: ['head coach', 'offence play-caller'], teams: h.teams, first_season: h.first, last_season: h.last,
    head_coach_record: `${h.w}–${h.l}–${h.t}`, head_coach_seasons: h.seasons, url: 'https://wcehoops.com/coaching-savant.html#c=Andy%20Reid',
  })
  const caller = (await run(search, { query: 'Greg Roman' })).structured.coaches[0]
  assert.deepEqual([caller.roles, caller.head_coach_record, caller.head_coach_seasons], [['offence play-caller'], null, null])
  assert.equal(caller.url, 'https://wcehoops.com/coaching-savant.html#c=Greg%20Roman')
  assert.equal((await run(search, { query: "O'Connell" })).structured.coaches[0].url, "https://wcehoops.com/coaching-savant.html#c=Kevin%20O'Connell")

  const many = await run(search, { query: 'mike', limit: 5 })
  assert.equal(many.structured.count, 5)
  assert.ok(many.structured.total > 5)
  assert.match(many.text, /showing the first 5/)
  const none = await run(search, { query: 'zzzzqq' })
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No head coach or play-caller/)

  // Every name in the index finds itself, and is its own id.
  for (const r of out.coaches.people) {
    const hit = (await api.searchCoaches({ query: r.name, limit: 3 })).structured.coaches[0]
    assert.equal(hit.id, r.name, `searching "${r.name}"`)
  }
})

test('impossible questions get an answer that says what to try', async () => {
  await fails(profile, { coach: 'Qwertyuiop Asdfgh' }, /No head coach or play-caller matches "Qwertyuiop Asdfgh".*nfl_search_coaches/)
  // In the tree, but with no page: said plainly, and never answered with a near namesake.
  await fails(profile, { coach: 'Bill Walsh' }, [/Bill Walsh is named in Coaching Savant's hand-curated coaching tree but has no page of his own: he has no head-coaching record since 1999\./, /directly under him: .*Mike Holmgren/])
  await fails(profile, { coach: 'jim johnson' }, /^Jim Johnson is named in Coaching Savant's hand-curated coaching tree but has no page/)
  assert.equal((await run(profile, { coach: 'Jimmy Johnson', group: 'lineage' })).structured.coach.name, 'Jimmy Johnson')
  await fails(profile, { coach: 'Mike' }, /coaches match "Mike"\. Call again with one of these names:\n- Mike /)
  await fails(profile, { coach: 'Andy Reid', season: 2017 }, /play-calling units for 2018 through \d{4}, not 2017/)
  await fails(profile, { coach: 'Andy Reid', season: 2099 }, /play-calling units for 2018 through \d{4}, not 2099/)
  await fails(profile, { coach: 'Andy Reid', group: 'career', season: 2024 }, /"season" picks which of his play-calling units.*not "career"/)
  await fails(profile, { coach: 'John Harbaugh', season: 2024 }, /John Harbaugh is not credited with calling the offence or the defence in 2024\. He is not credited with calling plays in any season since 2018\./)
  await fails(profile, { coach: 'Greg Roman', season: 2023 }, /Greg Roman is not credited with calling the offence or the defence in 2023\. He called: 2025 LAC offence, /)

  // Bad arguments are refused by the schema before any football happens.
  const input = z.object(profile.config.inputSchema)
  for (const bad of [{}, { coach: '' }, { coach: 'x'.repeat(81) }, { coach: 'Andy Reid', group: 'everything' }, { coach: 'Andy Reid', season: '2024' }, { coach: 'Andy Reid', season: 2024.5 }, { coach: 'Andy Reid', season: 1066 }]) {
    assert.equal(input.safeParse(bad).success, false, JSON.stringify(bad))
  }
  const query = z.object(search.config.inputSchema)
  for (const bad of [{}, { query: 'x' }, { query: 'x'.repeat(81) }, { query: 'reid', limit: 0 }, { query: 'reid', limit: 26 }]) {
    assert.equal(query.safeParse(bad).success, false, JSON.stringify(bad))
  }
  assert.deepEqual(input.parse({ coach: '  Andy Reid  ' }), { coach: 'Andy Reid', group: 'all' })

  // Through a real MCP client: a refusal is an error result with the message, and nothing else.
  const r = await client.callTool({ name: 'nfl_get_coach_profile', arguments: { coach: 'Harbaugh' } })
  assert.ok(r.isError)
  assert.match(textOfResult(r), /2 coaches match "Harbaugh"/)
  assert.equal(r.structuredContent, undefined)
  const bad = await client.callTool({ name: 'nfl_get_coach_profile', arguments: { coach: 'Andy Reid', group: 'everything' } })
  assert.ok(bad.isError)
  // And a good call returns content that passes the client's own check of the output schema.
  const ok = await client.callTool({ name: 'nfl_get_coach_profile', arguments: { coach: 'Andy Reid' } })
  assert.ok(!ok.isError, textOfResult(ok))
  assert.equal(ok.structuredContent.coach.name, 'Andy Reid')
  const found = await client.callTool({ name: 'nfl_search_coaches', arguments: { query: 'Harbaugh' } })
  assert.equal(found.structuredContent.count, 2)
})

test('files are fetched once and reused; when the data is down the answer is honest', async () => {
  core.clearCache()
  const start = hits
  await api.coachProfile({ coach: 'Andy Reid' })
  await api.coachProfile({ coach: 'Andy Reid', group: 'career' })
  await api.searchCoaches({ query: 'reid' })
  assert.equal(hits - start, 4, 'the glossary, the index, the profiles and one season of units: four fetches for three calls')

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // A units file that is not there comes back as the homepage, with a 200.
    core.clearCache()
    const real = served.units['2022']
    delete served.units['2022']
    await fails(profile, { coach: 'Andy Reid', season: 2022 }, /Coaching Savant data could not be loaded right now\. Try again in a minute\./)
    served.units['2022'] = real

    // The whole origin is unreachable.
    core.clearCache()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    await fails(search, { query: 'reid' }, /Coaching Savant data could not be loaded right now/)
    await fails(profile, { coach: 'Andy Reid' }, /Coaching Savant data could not be loaded right now/)
    const down = await client.callTool({ name: 'nfl_search_coaches', arguments: { query: 'reid' } })
    assert.ok(down.isError)
    assert.doesNotMatch(textOfResult(down), /ECONNREFUSED|127\.0\.0\.1|at .*\.js/)
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    core.clearCache()
  }
  assert.equal((await run(search, { query: 'reid' })).structured.coaches[0].name, 'Andy Reid')
})
