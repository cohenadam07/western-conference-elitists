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
//                                                     percentile, his recent fights, his belts
//
// A FIGHTER HAS NO SEASON. The page's unit is a window of his UFC fights (career, last 5,
// last 3), his cohort is his division in that window, and each stat is ranked against the
// same window of everyone else in it. The reader can then move the population. Two of the
// page's views are written beside each value:
//
//   Rank against: Active     qualified fighters of his division who have fought in the UFC
//                            in the last 24 months. This is the view the page opens in.
//   Rank against: All-time   every qualified fighter of his division in UFC history.
//
// Two more controls exist on the page and are NOT written here, to keep these files small
// (Vercel keeps about forty deployments, so every megabyte costs forty): the "Everyone"
// cohort, which ranks a fighter against every division of the same sex, and the cage-time
// band, a slider that is off unless the reader turns it on. Adding the cohort back is one
// line here (VIEWS), the wording in api/_ufc.js, and about 0.6 MB.
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
// round-by-round detail a reader gets by clicking a fight. Nothing here needs it.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/ufc/v1'
export const SCHEMA = 1
const PAGE = 'ufc-savant.html'
const DATA = 'ufc-savant-data.json'

// How many of a fighter's most recent fights are kept: the ones his "last 5" window is made
// of. His UFC record is counted from the whole log before the rest is dropped.
export const RECENT_FIGHTS = 5

// The populations written beside every value, in this order: [baseline, cohort], in the
// page's own keys. A cell is [value, ...one percentile per view]. The page also offers
// ['active', 'all'] and ['all', 'all'] (cohort "Everyone"); the code below handles them.
export const VIEWS = [['active', 'div'], ['all', 'div']]

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

export function readPage(html) {
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
    // The Leaderboard Builder: its link (lbEncode() writes it, readURL() opens it) and what
    // it starts on. Optional: the connector's leaderboard works without the link.
    board: html.includes("return '#lb=1&w='+lb.win+'&d='+lb.div+'&r='+lb.rank+'&n='+lb.top") && html.includes('if(q.lb!=null){ lbParseHash(q); openLB(); return true; }'),
    // "Next card" is the first card that has not happened, judged on this clock.
    nextCardZone: (html.match(/function todayPT\(\)\{[\s\S]{0,200}?timeZone:'([A-Za-z_/]+)'/) || [])[1] || null,
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
  // (the two title stats) exist only on the leaderboard and are left out.
  const metrics = cfg.panels.flatMap((g) => cfg.metrics.filter((m) => m.grp === g))
  if (!metrics.length) throw new Error(`${DATA}: no stat belongs to a panel the page draws`)
  // The rest: stats the page's leaderboard offers and its profiles do not (its lbMetrics()
  // is every stat in the data).
  const boardOnly = cfg.metrics.filter((m) => !cfg.panels.includes(m.grp))
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
        for (const m of metrics) {
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

  // ---- one fighter, one window ----
  function windowRow(e, w) {
    const r = e.w[w]
    if (!r) return null
    const div = divOf(e, w)
    const m = {}
    const low = {}
    const untracked = []
    const partial = []
    for (const mt of metrics) {
      const v = r.m[mt.key]
      const gated = mt.since > baseEra && r.since < mt.since
      if (miss(v)) { if (gated) untracked.push(mt.key); continue }
      if (gated) partial.push(mt.key)
      const cell = [v]
      for (const [baseline, cohort] of VIEWS) {
        const pool = (pools[w][`${baseline}|${cohortKey(cohort, div)}`] || {})[mt.key]
        cell.push(percentile(v, pool, mt.lower))
      }
      m[mt.key] = cell
      const s = sampleOf(r, mt)
      if (!s.ok) low[mt.key] = s.n
    }
    const row = { div, qualified: !!r.qualified, since: r.since, n: r.n, m }
    // Stats the page's leaderboard can rank by that are not on a profile (the title stats).
    const x = {}
    for (const mt of boardOnly) if (!miss(r.m[mt.key])) x[mt.key] = r.m[mt.key]
    if (Object.keys(x).length) row.x = x
    if (Object.keys(low).length) row.low = low
    if (untracked.length) row.untracked = untracked
    if (partial.length) row.partial = partial
    return row
  }

  const events = data.events || {}
  const fightRow = (f) => ({
    date: f.date,
    res: f.res,
    opp: f.opp,
    oppname: f.oppname,
    method: f.method ?? null,
    rnd: f.rnd ?? null,
    time: f.time ?? null,
    wc: f.wc ?? null,
    title: !!f.title,
    bonus: f.bonus || [],
    event: (events[f.ev] || {}).name || null,
    ss: f.ss ?? null,
    oss: f.oss ?? null,
    kd: f.kd ?? null,
    td: f.td ?? null,
    ctrl: f.ctrl ?? null,
    oelo: f.oelo ?? null,
  })

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
      fights: log.slice(0, RECENT_FIGHTS).map(fightRow),
      w,
    }
    if (e.rks && Object.keys(e.rks).length) row.rks = e.rks
    if (e.p4p != null) row.p4p = e.p4p
    if (e.belts && e.belts.length) row.belts = e.belts
    shards[shardOf(e.id)].fighters[e.id] = row
    index.push({ id: e.id, name: e.name, nick, div: e.w.career.div || null, active: !!e.active, n: e.w.career.n ?? log.length, rec: e.rec || null, first: e.first ?? null, last: e.last ?? null })
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
    matchupWindow: page.matchupWindow,
    // The page's Leaderboard Builder opened on a window, a division (or M / F for all men /
    // all women), a stat ("rank" is the official UFC ranking), a pool and a sample.
    leaderboardUrl: page.board ? `${SITE}/${PAGE}#lb=1&w={window}&d={division}&r={stat}&n={n}&b={baseline}&s={sample}&dir={dir}` : null,
    nextCardZone: page.nextCardZone,
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
      views: 'meta.views lists the populations, in the order the percentiles follow the value in a cell: baseline (active = a UFC fight on or after activeCut, all = everyone in UFC history) and cohort (div = his division in that window).',
      notWritten: 'The page can also rank a fighter against every division of the same sex (cohort "Everyone"), and narrow any pool to a band of cage time. Neither is covered here.',
    },
    units: UNITS,
    groups: Object.fromEntries(cfg.panels.map((g) => [g, cfg.groupLabel[g]])),
    denoms: cfg.denoms || {},
    eraBase: baseEra,
    metrics: metrics.map(describe),
    // The page's headline stats: the ones its comps are matched on. A side-by-side starts here.
    headline: (cfg.headline || []).filter((k) => metrics.some((m) => m.key === k)),
    // Leaderboard-only stats (the title stats). Their values are in a window's `x`.
    boardMetrics: boardOnly.map(describe),
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
      rks: 'Official UFC ranking by division key, as of meta.rankingsAt: 0 is the champion, 0.5 the interim champion.',
      p4p: 'Official pound-for-pound ranking.',
      belts: 'Title reigns, oldest first: div, start, end (null while reigning), days, defenses, how (a key of meta.beltEnd), interim.',
      fights: `His ${RECENT_FIGHTS} most recent UFC fights, newest first. time is seconds into the final round; ss/oss significant strikes landed and absorbed; ctrl seconds of control; oelo the opponent's Savant rating going in; bonus keys are in meta.bonus.`,
      w: 'One entry per window. div is his division in that window, n the fights in it, since the year of its earliest fight. m holds each stat as [value, ...percentiles in meta.views order]. A stat that is absent has no value in that window: it is not zero.',
      x: 'Leaderboard-only stats (boardMetrics) by key: the raw value, no percentile.',
      low: 'Stats whose sample is under the threshold (metrics[].lowSampleBelow), with the sample they are on.',
      untracked: 'Stats the fights in the window predate (metrics[].since).',
      partial: 'Stats that cover only the fights in the window from their since year on.',
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
