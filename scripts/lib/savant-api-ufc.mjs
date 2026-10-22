// UFC Savant, cut up for machines. The UFC counterpart of savant-api.mjs.
//
// The UFC Savant page downloads one 17 MB file (public/ufc-savant-data.json) and works every
// percentile out in the browser, against whichever population the reader picks. The file
// holds values only, so the number a fan actually sees on a fighter's bars — "81st
// percentile among active lightweights" — is nowhere in it, and no AI assistant or server
// function can load 17 MB to work it out.
//
// This writes that answer down, once per build, as small files:
//
//   <dist>/savant-api/ufc/v1/meta.json                the stat glossary, the pools and their
//                                                     sizes, the page's defaults, the dates
//   <dist>/savant-api/ufc/v1/fighters.json            every fighter: id, name, nickname,
//                                                     division, record, first and last fight
//   <dist>/savant-api/ufc/v1/upcoming.json            the scheduled cards and their bouts
//   <dist>/savant-api/ufc/v1/fighters/<x>.json.gz     sixteen files, one per first character
//                                                     of the fighter id (0-9, a-f): each
//                                                     fighter's three windows with every
//                                                     percentile, his whole fight log, his
//                                                     belts, his comps, strike map and round
//                                                     curve
//
// A FIGHTER HAS NO SEASON. The page's unit is a window of his UFC fights (career, last 5,
// last 3), his cohort is his division in that window, and each stat is ranked against the
// same window of everyone else in it. The reader can then move the population. Four of the
// page's views are written beside each value (VIEWS):
//
//   Active, Division         qualified fighters of his division who have fought in the UFC
//                            in the last 24 months. This is the view the page opens in.
//   All-time, Division       every qualified fighter of his division in UFC history.
//   Active, Everyone         the same, across every division of his sex (the page's
//   All-time, Everyone       "Everyone" cohort, and the colour of its all-men and all-women
//                            leaderboards).
//
// One more control exists on the page and is NOT written here: the cage-time band, a
// two-handled slider that is off unless the reader turns it on. Every setting of it is a
// different pool, so there is no fixed set of percentiles to write.
//
// THE LEADERBOARD AND THE HEAD-TO-HEAD (api/_ufc.js) are filters and sorts over these same
// numbers, so they need no files of their own: every fighter's every stat, its percentiles,
// his cage minutes and his place in the page's order are here. The page's starting settings,
// its presets and its stance and "show top" options are read out of the page into meta.json,
// as is its home screen's "best now" fighter per division.
//
// THE NUMBERS MUST MATCH THE PAGE. Almost every rule is carried by the data file itself
// (cfg: the stat list, which panels the page draws, who qualifies, each stat's low-sample
// threshold and era) and is read from there, never copied. What the data file cannot say is
// read out of public/ufc-savant.html: which view the page opens in, what its two population
// controls are called, the names of the fight-night bonuses, the words for how a title reign
// ended, and that the fighter link still works the way this assumes. The arithmetic is the
// page's: a division is the weight class a fighter fought at most in the window; a pool is
// the qualified fighters of that cohort with a value for the stat; a percentile is the
// midrank, flipped for lower-is-better stats, rounded, held to 1..99, and absent when the
// pool has fewer than two fighters.
//
// tools/savant-ufc/check.mjs proves it: it runs the page's own script in a sandbox, has it
// draw every fighter's bars in every window and both views, and compares what it prints.
//
// Nothing here is committed and nothing here is a Vite plugin: the build calls writeUfcApi()
// after dist/ exists. If the page or the data changes shape so that this can no longer read
// it, it throws, and the caller decides what to do (the site should ship without these files
// rather than with wrong ones). The page's second file, ufc-savant-fights.json, is the
// round-by-round detail a reader gets by clicking a fight. It is not carried: about 0.9 MB
// gzipped even cut to the rounds alone, which this section's 4 MB budget has no room for.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/ufc/v1'
export const SCHEMA = 1
const PAGE = 'ufc-savant.html'
const DATA = 'ufc-savant-data.json'

// How many of a fighter's most recent fights a whole profile lists: the ones his "last 5"
// window is made of. The full log is in the files too, for the profile's "fights" group.
export const RECENT_FIGHTS = 5

// The populations a percentile is worked out against, in this order: [baseline, cohort], in
// the page's own keys. A window holds one list of percentiles per view (p[0], p[1], ...).
// The first two are the profile's two numbers (his division, active and all-time); the
// other two are the page's "Everyone" cohort (every division of his sex), which the
// leaderboard's all-men and all-women pools colour by.
export const VIEWS = [['active', 'div'], ['all', 'div'], ['active', 'all'], ['all', 'all']]

// Fighters are split across files by the first character of their id.
export const SHARDS = '0123456789abcdef'.split('')
export const shardOf = (id) => String(id)[0]

// How the page prints each unit (its fmt()), in words, so a reader of the raw value knows
// what it is holding. A unit that is not here stops the build: better no file than a value
// printed the wrong way.
const UNITS = {
  num0: 'a whole number',
  num1: 'a number, shown to one decimal',
  num2: 'a number, shown to two decimals',
  sgn2: 'a signed number, shown with its sign to two decimals (+0.86)',
  pct0: 'a percentage, already multiplied by 100, shown as a whole percent (58.3 is 58%)',
  pct1: 'a percentage, already multiplied by 100, shown to one decimal',
  mins: 'minutes, shown as minutes:seconds (11.75 is 11:45)',
  sgnm: 'minutes, shown as signed minutes:seconds (6.59 is +6:35)',
  inch: 'inches',
  ftin: 'inches (the page shows feet and inches)',
}

// ---- reading the page ----------------------------------------------------------------

function capture(html, re, what) {
  const m = html.match(re)
  if (!m) throw new Error(`${PAGE}: ${what} not found`)
  return m[1]
}

// The buttons of one of the page's segmented controls: [{ key, label, on }].
function segment(html, id) {
  const at = html.indexOf(`id="${id}"`)
  if (at < 0) throw new Error(`${PAGE}: control #${id} not found`)
  const block = html.slice(at, html.indexOf('</div>', at))
  const out = [...block.matchAll(/<button\s+data-v="(\w+)"\s+aria-pressed="(true|false)"\s*>([^<]+)<\/button>/g)]
    .map((m) => ({ key: m[1], label: m[3].trim(), on: m[2] === 'true' }))
  if (out.length < 2) throw new Error(`${PAGE}: control #${id} has no options`)
  return out
}

// `{perf:'Performance of the Night',fight:'Fight of the Night'}` following `marker`.
function wordMap(html, marker, what) {
  const at = html.indexOf(marker)
  if (at < 0) throw new Error(`${PAGE}: ${what} not found`)
  const open = html.indexOf('{', at + marker.length - 1)
  const body = html.slice(open + 1, html.indexOf('}', open))
  const out = {}
  for (const m of body.matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out[m[1]] = m[2]
  if (!Object.keys(out).length) throw new Error(`${PAGE}: ${what} is empty`)
  return out
}

// A literal the page's script assigns (`var lb={...}`, `var LB_PRESETS=[...]`), evaluated on
// its own in an empty sandbox: data only, nothing of the page runs.
function literal(html, marker, what) {
  const at = html.indexOf(marker)
  if (at < 0) throw new Error(`${PAGE}: ${what} not found`)
  const open = at + marker.length - 1
  const pair = { '{': '}', '[': ']' }[html[open]]
  let depth = 0
  let end = -1
  for (let i = open; i < html.length; i++) {
    const ch = html[i]
    if (ch === "'" || ch === '"') { for (i++; i < html.length && html[i] !== ch; i++) if (html[i] === '\\') i++ }
    else if (ch === html[open]) depth++
    else if (ch === pair && --depth === 0) { end = i; break }
  }
  if (end < 0) throw new Error(`${PAGE}: ${what} could not be read`)
  try {
    return JSON.parse(JSON.stringify(vm.runInNewContext(`(${html.slice(open, end + 1)})`, Object.create(null), { timeout: 1000 })))
  } catch (e) {
    throw new Error(`${PAGE}: ${what} could not be read (${e.message})`, { cause: e })
  }
}

// The page's leaderboard and head-to-head views: what they open with, and what they offer.
function readBoards(html) {
  const lb = literal(html, 'var lb={', 'the leaderboard\'s starting settings')
  const presets = literal(html, 'var LB_PRESETS=[', 'the leaderboard presets')
  if (!Array.isArray(presets) || !presets.every((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && Array.isArray(p[2]))) throw new Error(`${PAGE}: the leaderboard presets changed shape`)
  for (const k of ['win', 'div', 'rank', 'top', 'cols', 'basis', 'sample', 'dir']) if (lb[k] == null) throw new Error(`${PAGE}: the leaderboard has no starting "${k}"`)
  const mu = literal(html, 'var mu={', 'the head-to-head\'s starting settings')
  // The context rows a head-to-head leaves out.
  const skip = capture(html, /if\(m\.grp==='ctx'&&\[([^\]]*)\]\.indexOf\(m\.key\)>=0\) return;/, 'the rows the head-to-head leaves out')
  const stances = [...capture(html, /<select id="lbStance">([\s\S]*?)<\/select>/, 'the leaderboard\'s stance filter').matchAll(/<option(?: value="([^"]*)")?>([^<]*)<\/option>/g)].map((m) => m[1] ?? m[2]).filter(Boolean)
  const tops = [...capture(html, /<select id="lbTopN">([\s\S]*?)<\/select>/, 'the leaderboard\'s "Show top"').matchAll(/<option(?: value="(\d+)")?(?: selected)?>([^<]*)<\/option>/g)].map((m) => +(m[1] || m[2]))
  if (!tops.length || tops.some((n) => !(n > 0))) throw new Error(`${PAGE}: the leaderboard's "Show top" options could not be read`)
  // The two switches the tool offers by name. lbPool() tests for exactly these keys.
  const switches = (id) => [...capture(html, new RegExp(`<span class="lb-seg" id="${id}">([\\s\\S]*?)<\\/span>`), `the leaderboard's #${id} switch`).matchAll(/data-v="(\w+)"/g)].map((m) => m[1]).sort().join(',')
  if (switches('lbBasis') !== 'active,all') throw new Error(`${PAGE}: the leaderboard's "Rank against" options changed (${switches('lbBasis')})`)
  if (switches('lbSample') !== 'all,settled') throw new Error(`${PAGE}: the leaderboard's sample options changed (${switches('lbSample')})`)
  if (switches('muBasis') !== 'active,all') throw new Error(`${PAGE}: the head-to-head's "Rank against" options changed (${switches('muBasis')})`)
  return {
    leaderboard: { defaults: lb, presets: presets.map((p) => ({ name: p[0], rank: p[1], cols: p[2] })), stances, tops },
    matchup: { window: mu.win, basis: mu.basis, skip: [...skip.matchAll(/'(\w+)'/g)].map((m) => m[1]) },
    // The caution the page prints over the bars when the "Everyone" cohort is on.
    everyoneNote: capture(html, /\(cohortMode==='all' \? ' ([^']*)' : ''\)/, 'the "Everyone" cohort\'s caution'),
  }
}

// The order the page keeps its fighters in (prepData()'s NAMES), which the leaderboard's
// stable sorts fall back on for ties: the data file's order, then sorted by this comparator.
const NAMES_SORT = 'NAMES.sort(function(a,b){return (b.last||\'\')<(a.last||\'\')?-1:1;});'

export function readPage(html) {
  if (!html.includes(NAMES_SORT)) throw new Error(`${PAGE}: the order prepData() keeps its fighters in changed`)
  const defaults = {
    window: capture(html, /\bvar\s+cur\s*=\s*null\s*,\s*curId\s*=\s*null\s*,\s*win\s*=\s*'(\w+)'/, 'the starting window'),
    baseline: capture(html, /\bvar\s+baseline\s*=\s*'(\w+)'/, 'the starting baseline'),
    cohort: capture(html, /\bvar\s+cohortMode\s*=\s*'(\w+)'/, 'the starting cohort'),
  }
  // The cage-time band narrows every pool when it is on. This file assumes it starts off.
  if (capture(html, /\bvar\s+bandOn\s*=\s*(true|false)\b/, 'the cage-time band switch') !== 'false') {
    throw new Error(`${PAGE}: the cage-time band now starts switched on, so the default pools are no longer the ones written here`)
  }

  const baselines = segment(html, 'baseseg')
  const cohorts = segment(html, 'cohortseg')
  const keys = (list) => list.map((o) => o.key).sort().join(',')
  // poolVals() and inCohort() test for exactly these keys; the views are built on them.
  if (keys(baselines) !== 'active,all') throw new Error(`${PAGE}: the "Rank against" options changed (${keys(baselines)})`)
  if (keys(cohorts) !== 'all,div') throw new Error(`${PAGE}: the "Cohort" options changed (${keys(cohorts)})`)
  if (!baselines.find((o) => o.key === defaults.baseline) || !cohorts.find((o) => o.key === defaults.cohort)) {
    throw new Error(`${PAGE}: the page starts in a view its controls do not offer`)
  }

  // The links. syncURL() writes them and readURL() opens them; both must still be there.
  const linkCode = [
    ["h='#f='+curId+'&w='+win", 'the fighter link written by syncURL()'],
    ['if(q.f&&F[q.f])', 'the fighter link read by readURL()'],
    ["return '#mu='+(mu.a||'')+','+(mu.b||'')+'&w='+mu.win;", 'the head-to-head link written by muEncode()'],
    ['if(q.mu)', 'the head-to-head link read by readURL()'],
    ["return '#lb=1&w='+lb.win+'&d='+lb.div+'&r='+lb.rank+'&n='+lb.top+'&mm='+lb.minMin+'&mn='+lb.minN+'&st='+encodeURIComponent(lb.stance)", 'the leaderboard link written by lbEncode()'],
    ["+'&a0='+(lb.ageMin==null?'':lb.ageMin)+'&a1='+(lb.ageMax==null?'':lb.ageMax)+'&c='+lb.cols.join(',')+'&disp='+lb.display+'&b='+lb.basis+'&s='+lb.sample+'&dir='+lb.dir;", 'the rest of the leaderboard link'],
    ['if(q.lb!=null){ lbParseHash(q); openLB(); return true; }', 'the leaderboard link read by readURL()'],
  ]
  for (const [code, what] of linkCode) if (!html.includes(code)) throw new Error(`${PAGE}: ${what} changed`)

  return {
    defaults,
    baselines: Object.fromEntries(baselines.map((o) => [o.key, o.label])),
    cohorts: Object.fromEntries(cohorts.map((o) => [o.key, o.label])),
    bonus: wordMap(html, 'f.bonus.map(function(b){return {', 'the bonus names in the fight log'),
    beltEnd: wordMap(html, 'var how={', 'the words for how a title reign ended'),
    // The window the page opens a head-to-head in when a bout on the next card is clicked.
    matchupWindow: capture(html, /openMatchup\(s\.dataset\.a,s\.dataset\.b,'(\w+)'\)/, 'the head-to-head window'),
    ...readBoards(html),
  }
}

// ---- reading the data ----------------------------------------------------------------

function readConfig(data) {
  const cfg = data && data.cfg
  if (!cfg || !data.fighters || typeof data.fighters !== 'object') throw new Error(`${DATA}: expected { cfg, fighters }`)
  if (!Array.isArray(cfg.metrics) || !cfg.metrics.length) throw new Error(`${DATA}: cfg.metrics is empty`)
  for (const m of cfg.metrics) {
    if (typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.grp !== 'string' || typeof m.since !== 'number') {
      throw new Error(`${DATA}: malformed metric ${JSON.stringify(m).slice(0, 80)}`)
    }
    if (!UNITS[m.unit]) throw new Error(`${DATA}: metric ${m.key} has a unit this file cannot describe ("${m.unit}")`)
  }
  if (!Array.isArray(cfg.panels) || !cfg.panels.length) throw new Error(`${DATA}: cfg.panels is empty`)
  if (!Array.isArray(cfg.windows) || !cfg.windows.every((w) => Array.isArray(w) && w.length === 2)) throw new Error(`${DATA}: cfg.windows changed shape`)
  if (!Array.isArray(cfg.divisions) || !cfg.divisions.every((d) => d.key && d.label && d.sex)) throw new Error(`${DATA}: cfg.divisions changed shape`)
  for (const [w] of cfg.windows) {
    if (!Array.isArray(cfg.qualify && cfg.qualify[w]) || cfg.qualify[w].length !== 2) throw new Error(`${DATA}: cfg.qualify has no line for "${w}"`)
  }
  for (const k of ['activeMonths', 'activeCut', 'latest']) if (cfg[k] == null) throw new Error(`${DATA}: cfg.${k} is missing`)
  return cfg
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

function lowerBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid }
  return lo
}
function upperBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid }
  return lo
}

// The page's pctOf(): midrank percentile against a sorted pool, 1..99, whole numbers, and
// nothing at all when the pool has fewer than two fighters.
export function percentile(v, sorted, lower) {
  const n = sorted ? sorted.length : 0
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

// The page's nickOf(): quotes and spaces trimmed off both ends, and a single letter is no
// nickname.
export function cleanNick(nick) {
  const n = String(nick || '').replace(/["“”'\s]+$/, '').replace(/^["“”'\s]+/, '')
  return n.length > 1 ? n : ''
}

// The page's sampleOf(): the denominator a stat's sample is judged on, and whether it has
// reached the stat's threshold. A stat with no threshold is never low.
function sampleOf(r, m) {
  if (!m.thr || !m.den) return { n: null, ok: true }
  const n = (r.d || {})[m.den]
  if (n == null) return { n: null, ok: true }
  return { n, ok: n >= m.thr }
}

// ---- building ------------------------------------------------------------------------

export function buildUfcApi({ data, html }) {
  const page = readPage(html)
  const cfg = readConfig(data)
  const windows = cfg.windows.map((w) => w[0])
  if (!windows.includes(page.defaults.window)) throw new Error(`${PAGE}: the page starts in a window the data does not have ("${page.defaults.window}")`)
  if (!windows.includes(page.matchupWindow)) throw new Error(`${PAGE}: the head-to-head window "${page.matchupWindow}" is not in the data`)

  // The profile draws the panels in cfg.panels and nothing else. Stats in any other group
  // (the two title stats) are drawn only by the leaderboard and the head-to-head, which run
  // over every stat; they are carried after the panels' stats and kept out of the profile.
  const metrics = cfg.panels.flatMap((g) => cfg.metrics.filter((m) => m.grp === g))
  if (!metrics.length) throw new Error(`${DATA}: no stat belongs to a panel the page draws`)
  const boardOnly = cfg.metrics.filter((m) => !cfg.panels.includes(m.grp))
  // A window's cells hold every stat in the data file's order, which is the page's METRICS:
  // the order the head-to-head lists its rows and the leaderboard offers its columns in.
  const cells = cfg.metrics
  for (const g of cfg.panels) if (!(cfg.groupLabel && cfg.groupLabel[g])) throw new Error(`${DATA}: panel "${g}" has no label`)
  // Every stat carries a `since` year, but only those above the earliest are a real era
  // gate (control time). The page treats them the same way.
  const baseEra = Math.min(...cfg.metrics.map((m) => m.since))

  const sex = Object.fromEntries(cfg.divisions.map((d) => [d.key, d.sex]))
  const sexOf = (div) => sex[div] || 'M'
  const fighters = Object.entries(data.fighters).map(([id, e]) => ({ ...e, id }))
  for (const e of fighters) {
    if (!SHARDS.includes(shardOf(e.id))) throw new Error(`${DATA}: fighter id "${e.id}" does not start with a hex digit`)
    if (!e.w || !e.w.career || typeof e.name !== 'string') throw new Error(`${DATA}: fighter ${e.id} has no career window or no name`)
  }
  // The page's divOf(): the window's division, falling back to the career one.
  const divOf = (e, w) => (e.w[w] && e.w[w].div) || e.w.career.div || null

  // ---- pools: per window, per view, per stat ----
  const cohortKey = (cohort, div) => (cohort === 'all' ? `S:${sexOf(div)}` : `D:${div}`)
  const pools = {}   // window -> "baseline|cohortKey" -> stat -> sorted values
  const sizes = {}   // window -> baseline -> cohort -> division or sex -> qualified fighters
  for (const w of windows) {
    const lists = new Map()
    const count = {}
    for (const e of fighters) {
      const r = e.w[w]
      if (!r || !r.qualified) continue
      const div = divOf(e, w)
      for (const [baseline, cohort] of VIEWS) {
        if (baseline === 'active' && !e.active) continue
        const ck = cohortKey(cohort, div)
        const bucket = ((count[baseline] = count[baseline] || {})[cohort] = count[baseline][cohort] || {})
        bucket[ck.slice(2)] = (bucket[ck.slice(2)] || 0) + 1
        const id = `${baseline}|${ck}`
        let byStat = lists.get(id)
        if (!byStat) { byStat = {}; lists.set(id, byStat) }
        for (const m of cells) {
          const v = r.m[m.key]
          if (!miss(v)) (byStat[m.key] = byStat[m.key] || []).push(v)
        }
      }
    }
    pools[w] = {}
    for (const [id, byStat] of lists) {
      pools[w][id] = Object.fromEntries(Object.entries(byStat).map(([k, vals]) => [k, Float64Array.from(vals).sort()]))
    }
    sizes[w] = count
  }

  // ---- the order the page keeps its fighters in ----
  // prepData() pushes the fighters in the data file's order and sorts them with the
  // comparator pinned in readPage(); the leaderboard's sorts are stable, so on a tie this
  // order decides. The comparator is the page's own text, run here.
  const comparator = vm.runInNewContext(`(${NAMES_SORT.slice('NAMES.sort('.length, -2)})`, Object.create(null))
  const order = [...fighters].sort((a, b) => comparator({ last: a.last }, { last: b.last }))
  const position = new Map(order.map((e, i) => [e.id, i]))
  // A fighter named in another fighter's row is given by his place in fighters.json.
  const ix = new Map(fighters.map((e, i) => [e.id, i]))
  const byId = new Map(fighters.map((e) => [e.id, e]))
  const at = (id, what) => {
    if (!ix.has(id)) throw new Error(`${DATA}: ${what} names a fighter the data does not hold (${id})`)
    return ix.get(id)
  }

  // ---- one fighter, one window ----
  // Every stat in meta.cells order, as a cell [value, ...one percentile per view], or null
  // for a stat with no value in the window: absent, not zero.
  function windowRow(e, w) {
    const r = e.w[w]
    if (!r) return null
    const div = divOf(e, w)
    const c = []
    const low = {}
    const untracked = []
    const partial = []
    for (const mt of cells) {
      const val = r.m[mt.key]
      const gated = mt.since > baseEra && r.since < mt.since
      // A thin sample is marked whether or not the stat has a value: the head-to-head marks a
      // row thin when either side's sample is, value or none.
      const s = sampleOf(r, mt)
      if (!s.ok) low[mt.key] = s.n
      if (miss(val)) {
        if (gated) untracked.push(mt.key)
        c.push(null)
        continue
      }
      if (gated) partial.push(mt.key)
      c.push([val, ...VIEWS.map(([baseline, cohort]) => percentile(val, (pools[w][`${baseline}|${cohortKey(cohort, div)}`] || {})[mt.key], mt.lower))])
    }
    const row = { div, qualified: !!r.qualified, since: r.since, n: r.n, dm: r.d && !miss(r.d.min) ? r.d.min : null, c }
    if (Object.keys(low).length) row.low = low
    if (untracked.length) row.untracked = untracked
    if (partial.length) row.partial = partial
    // The rest of the profile: "Fights like", "Where he can be beaten", the strike map and
    // the round curve, as the data file carries them for the page to draw.
    // A comp comes with his own division in the same window, which is what the page prints
    // under his name.
    const comp = (c, what) => [at(c.id, what), c.score, divOf(byId.get(c.id), w)]
    if (r.comps && r.comps.length) row.comps = r.comps.map((c) => comp(c, `${e.name}'s comps`))
    if (r.wflaws && r.wflaws.length) row.flaws = r.wflaws.map((f) => [f.k, f.pct])
    if (r.wcomps && r.wcomps.length) row.wcomps = r.wcomps.map((c) => comp(c, `${e.name}'s weakness comps`))
    if (r.sm) {
      if (!Array.isArray(r.sm.t) || r.sm.t.length !== 3 || !Array.isArray(r.sm.p) || r.sm.p.length !== 3) throw new Error(`${DATA}: ${e.name}'s strike map changed shape`)
      row.sm = [...r.sm.t.flat(), ...r.sm.p.flat(), ...(r.sm.ot || [0, 0, 0]), ...(r.sm.op || [0, 0, 0])]
    }
    if (r.rc) row.rc = r.rc
    return row
  }

  // ---- the fight log ----
  // Every UFC fight, newest first, as the page's log table shows it. The event by its place in
  // meta.events, the opponent by his place in fighters.json.
  const events = data.events || {}
  const eventKeys = Object.keys(events)
  const evIndex = new Map(eventKeys.map((k, i) => [k, i]))
  const logRow = (e, f) => [
    f.date, f.res, at(f.opp, `${e.name}'s fight log`), f.method ?? null, f.rnd ?? null, f.time ?? null, f.wc ?? null,
    f.title ? 1 : 0, f.bonus && f.bonus.length ? f.bonus : 0, evIndex.has(f.ev) ? evIndex.get(f.ev) : null,
    f.ss ?? null, f.oss ?? null, f.kd ?? null, f.td ?? null, f.ctrl ?? null, f.oelo ?? null,
  ]

  const shards = Object.fromEntries(SHARDS.map((s) => [s, { schema: SCHEMA, generated: data.generated || null, fighters: {} }]))
  const index = []
  for (const e of fighters) {
    const log = e.log || []
    const count = (res) => log.filter((f) => f.res === res).length
    const w = {}
    for (const k of windows) { const row = windowRow(e, k); if (row) w[k] = row }
    const nick = cleanNick(e.nick)
    const row = {
      id: e.id,
      name: e.name,
      nick,
      ht: e.ht ?? null,
      wt: e.wt ?? null,
      reach: e.reach ?? null,
      stance: e.stance ?? null,
      dob: e.dob ?? null,
      age: e.age ?? null,
      rec: e.rec || null,
      ufc: [count('W'), count('L'), count('D'), count('NC')],
      first: e.first ?? null,
      last: e.last ?? null,
      active: !!e.active,
      o: position.get(e.id),
      log: log.map((f) => logRow(e, f)),
      w,
    }
    if (e.rks && Object.keys(e.rks).length) row.rks = e.rks
    if (e.p4p != null) row.p4p = e.p4p
    if (e.belts && e.belts.length) row.belts = e.belts
    shards[shardOf(e.id)].fighters[e.id] = row
    index.push({ id: e.id, name: e.name, nick, div: e.w.career.div || null, active: !!e.active, n: e.w.career.n ?? log.length, rec: e.rec || null, first: e.first ?? null, last: e.last ?? null })
  }

  // ---- the home screen's "best now" chips (the page's bestNow()) ----
  // Each division but open weight: its champion in the official ranking (the last one in the
  // page's order, should two be listed), else its highest-rated active, qualified fighter over
  // a career (the first in the page's order on a tie).
  const rankOf = (e, div) => (e.rks && e.rks[div] != null ? e.rks[div] : null)
  const bestNow = []
  for (const d of cfg.divisions) {
    if (d.key === 'OPEN') continue
    let best = null
    for (const e of order) if (rankOf(e, d.key) === 0) best = e
    if (!best) {
      for (const e of order) {
        const r = e.w.career
        if (!e.active || !r.qualified || r.div !== d.key) continue
        if (!best || (r.m.elo || 0) > (best.w.career.m.elo || 0)) best = e
      }
    }
    if (best) bestNow.push([d.key, best.id, rankOf(best, d.key) === 0])
  }

  const cards = ((data.upcoming && data.upcoming.cards) || []).map((c) => ({
    name: c.name,
    date: c.date ?? null,
    location: c.location || null,
    bouts: (c.bouts || []).map((b) => ({
      wc: b.wc || null,
      div: b.div || null,
      f: (b.f || []).map((x) => ({ id: x.id || null, name: x.name || null, known: !!x.known })),
    })),
  }))

  const describe = (m) => ({
    key: m.key,
    label: m.label,
    group: m.grp,
    sub: m.sub || null,
    layer: m.layer || null,
    unit: m.unit,
    lowerIsBetter: !!m.lower,
    since: m.since,
    sample: m.den || null,
    lowSampleBelow: m.thr || null,
    explain: m.exp || null,
  })

  const meta = {
    schema: SCHEMA,
    name: 'UFC Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/${PAGE}`,
    fighterUrl: `${SITE}/${PAGE}#f={id}&w={window}`,
    matchupUrl: `${SITE}/${PAGE}#mu={a},{b}&w={window}`,
    leaderboardUrl: `${SITE}/${PAGE}#lb=1`,
    matchupWindow: page.matchupWindow,
    generated: data.generated || null,
    earliest: fighters.map((e) => e.first).filter(Boolean).sort()[0] || null,
    latest: cfg.latest,
    activeMonths: cfg.activeMonths,
    activeCut: cfg.activeCut,
    rankingsAt: cfg.rankingsAt || null,
    recentFights: RECENT_FIGHTS,
    files: {
      fighters: `${SITE}/${BASE}/fighters.json`,
      upcoming: `${SITE}/${BASE}/upcoming.json`,
      shard: `${SITE}/${BASE}/fighters/{first character of the id}.json`,
    },
    windows: Object.fromEntries(cfg.windows),
    defaults: page.defaults,
    baselines: page.baselines,
    cohorts: page.cohorts,
    views: VIEWS,
    divisions: cfg.divisions,
    qualify: cfg.qualify,
    pools: sizes,
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile is always the better mark. There is no percentile when fewer than two fighters in the pool have the stat.',
      pool: 'The qualified fighters of the cohort who have a value for the stat, each over the same window. A fighter who is not qualified, or not active, is still ranked against the pool but is not part of it.',
      division: 'A fighter\'s division in a window is the weight class he fought at most in it (the most recent on ties), so a fighter who has changed weight can be in one division for his career and another for his last 3 fights.',
      views: 'meta.views lists the populations, in the order of a window\'s percentile lists (p[0], p[1], ...): baseline (active = a UFC fight on or after activeCut, all = everyone in UFC history) and cohort (div = his division in that window, all = every division of his sex, the page\'s "Everyone").',
      notWritten: 'The page can also narrow any pool to a band of cage time with a two-handled slider. That is not covered here: every setting of it is a different pool.',
    },
    units: UNITS,
    groups: Object.fromEntries(cfg.panels.map((g) => [g, cfg.groupLabel[g]])),
    groupLabels: cfg.groupLabel,
    denoms: cfg.denoms || {},
    eraBase: baseEra,
    metrics: metrics.map(describe),
    // Stats the profile does not draw but the leaderboard and the head-to-head do.
    boardMetrics: boardOnly.map(describe),
    // Every stat, in the page's order: the order of a window's cells.
    cells: cells.map((m) => m.key),
    // "style similarity across N dimensions"
    styleDimensions: Array.isArray(cfg.headline) ? cfg.headline.length : null,
    events: eventKeys.map((k) => events[k].name || null),
    bestNow,
    leaderboard: page.leaderboard,
    matchup: page.matchup,
    everyoneNote: page.everyoneNote,
    bonus: page.bonus,
    beltEnd: page.beltEnd,
    row: {
      id: 'Fighter id (ufcstats). Use it in fighterUrl.',
      nick: 'Nickname, or an empty string.',
      'ht, wt, reach': 'Height and reach in inches, listed weight in pounds.',
      age: 'Age on the date in meta.latest, worked out from dob when the data was built.',
      rec: 'Professional record: [wins, losses, draws, no contests].',
      ufc: 'UFC record counted from his fight log: [wins, losses, draws, no contests].',
      active: 'Whether he has a UFC fight on or after meta.activeCut.',
      o: 'His place in the order the page keeps its fighters in; the leaderboard\'s sorts keep it on a tie.',
      rks: 'Official UFC ranking by division key, as of meta.rankingsAt: 0 is the champion, 0.5 the interim champion.',
      p4p: 'Official pound-for-pound ranking.',
      belts: 'Title reigns, oldest first: div, start, end (null while reigning), days, defenses, how (a key of meta.beltEnd), interim.',
      log: 'Every UFC fight, newest first: [date, result, opponent (his place in fighters.json), method, round, seconds into that round, bout, title (1/0), bonus keys (meta.bonus) or 0, event (its place in meta.events), sig. strikes landed, absorbed, knockdowns, takedowns, seconds of control, the opponent\'s Savant rating going in].',
      w: 'One entry per window. div is his division in that window, n the fights in it, since the year of its earliest fight, dm his cage minutes in it (the leaderboard\'s floor). c holds every stat in meta.cells order as [value, ...percentiles in meta.views order], or null for a stat with no value in that window: it is not zero.',
      low: 'Stats whose sample is under the threshold (metrics[].lowSampleBelow), with the sample they are on, whether or not the stat has a value.',
      untracked: 'Stats the fights in the window predate (metrics[].since).',
      partial: 'Stats that cover only the fights in the window from their since year on.',
      comps: '"Fights like": [fighter (his place in fighters.json), style similarity 0-100, that fighter\'s division in the window], inside his division and window.',
      flaws: '"Where he can be beaten": his weakest dimensions, [stat key, percentile].',
      wcomps: 'Fighters who share those weaknesses: [fighter, similarity 0-100, his division in the window].',
      sm: 'Strike map: significant strikes [head landed, head attempted, body landed, body attempted, legs landed, legs attempted, distance landed, attempted, clinch landed, attempted, ground landed, attempted, absorbed to the head, body, legs, absorbed at distance, in the clinch, on the ground].',
      rc: 'Round curve: per round 1-5, [landed per minute, absorbed per minute, minutes], or null for a round he has not fought.',
    },
  }

  return {
    meta,
    fighters: { schema: SCHEMA, generated: data.generated || null, count: index.length, fighters: index },
    upcoming: { schema: SCHEMA, generated: (data.upcoming && data.upcoming.generated) || data.generated || null, cards },
    shards,
  }
}

// ---- writing -------------------------------------------------------------------------

const thousands = (n) => Number(n).toLocaleString('en-US')

export function writeUfcApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, DATA)
  const pageFile = path.join(publicDir, PAGE)
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error(`${DATA} or ${PAGE} is missing from public/`)

  const out = buildUfcApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  let raw = 0
  const json = (body) => { const buf = Buffer.from(JSON.stringify(body)); raw += buf.length; return buf }
  const files = [
    ['meta.json', json(out.meta)],
    ['fighters.json', json(out.fighters)],
    ['upcoming.json', json(out.upcoming)],
  ]
  for (const [key, body] of Object.entries(out.shards)) files.push([`fighters/${key}.json.gz`, gzipSync(json(body), { level: 9 })])

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'fighters'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const cards = out.upcoming.cards.length
  return {
    files: files.length,
    raw,
    bytes,
    summary: `${thousands(out.fighters.count)} fighters, ${Object.keys(out.meta.windows).length} windows, ${cards} upcoming card${cards === 1 ? '' : 's'}`,
  }
}
