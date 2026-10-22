// Football Savant, cut up for machines. The NFL sibling of savant-api.mjs.
//
// The Football Savant page downloads a 44 MB archive (public/football-savant-data.json) plus
// a small file for the season in progress (public/football-savant-current.json), lays the
// second over the first, and works every percentile out in the browser. An AI assistant or a
// server function cannot do that to answer "where did he rank in EPA per dropback", and the
// raw files hold values only: the number a fan reads off a bar — "88th among quarterbacks"
// — is nowhere in them.
//
// This writes that answer down, once per build, as small files:
//
//   savant-api/football/v1/meta.json              seasons, positions, the stat glossary, pools
//   savant-api/football/v1/players.json           every player: id, name, position, span
//   savant-api/football/v1/seasons/<year>.json.gz one season: every player's bars, each with
//                                                 its percentile among his position that
//                                                 season and among his position all-time
//
// THE NUMBERS MUST MATCH THE PAGE. Football is not basketball, and the differences are the
// whole job:
//
//   - There is no league-wide pool. A cornerback and a center share no box score, so a bar is
//     ranked against QUALIFIED PLAYERS AT HIS POSITION (the page's default, "Position"), in
//     his season ("This season") or across every season the stat has existed ("All-time").
//     Both are written; the page's other switches (side of ball, the snap-share band) are not.
//   - His position is the one on that season's row. A lineman can be a guard one year and a
//     tackle the next, and is ranked with whichever he was.
//   - Which bars a card has is decided by position: cfg.panels says which panels a position
//     gets, cfg.metrics which stats sit in each, and the page drops a panel whose whole
//     sample is a rounding error (a receiver's three carries). The same rules are applied
//     here, so a file holds exactly the bars the card draws and nothing else.
//   - The two data files are merged the way the page merges them (its mergeData), so the
//     season in progress here is the twice-daily file, not the archive's stale copy.
//   - A percentile is the page's: midrank, flipped for lower-is-better stats, rounded, held
//     to 1..99, and absent when fewer than two men are in the pool.
//   - A stat its era never tracked is left out, not zero. A stat on too small a sample is
//     flagged, by the threshold that hollows out its bar.
//
// Almost every rule lives in the data file's own cfg block, so it is read from there. The
// few that live in the page (the words for each position's pool, the panel floors, the
// low-match line under weakness comps, the "what this page can't see" notes) are read out
// of public/football-savant.html at build time rather than copied.
//
// tools/savant-football/check.mjs proves all of it: it lifts the page's own functions out of
// the HTML, runs them over every player-season, and compares.
//
// Nothing here is committed. It is rebuilt from the data on every deploy, so the twice-daily
// refresh reaches these files by itself. Season files ship gzipped (Deployment Storage: see
// compress-data.mjs) and are requested as seasons/<year>.json.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/football/v1'
export const SCHEMA = 1
const PAGE = 'football-savant.html'

// How the page prints each unit (its fmt()), in words, so a reader of the raw value knows
// what it is holding.
const UNITS = {
  pct1: 'a percentage, already multiplied by 100 (27.8 means 27.8%)',
  num0: 'a whole number',
  num1: 'a number, shown to one decimal',
  num2: 'a number, shown to two decimals',
  num3: 'a number, shown to three decimals without its leading zero (.142)',
  sgn1: 'a signed number, shown with its sign to one decimal (+2.1)',
  sgn3: 'a signed number, shown with its sign to three decimals (+.142)',
  sec: 'seconds, shown to two decimals',
  inch: 'inches',
  lb: 'pounds',
  ftin: 'inches (the page shows feet and inches)',
}

// ---- reading the page ----------------------------------------------------------------

// Index of the brace that closes the one at `open`, skipping strings.
function closing(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

// `var NAME={ ... };` in the page, as the object it describes. These are plain literals
// (strings, numbers, arrays, a few strings joined with +), so evaluating one runs no code
// of the page's; it only saves re-typing its contents here.
function literal(html, name) {
  const at = html.search(new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\{`))
  if (at < 0) throw new Error(`${name} not found in ${PAGE}`)
  const open = html.indexOf('{', at)
  const end = closing(html, open)
  if (end < 0) throw new Error(`${name} could not be read out of ${PAGE}`)
  let value
  try { value = vm.runInNewContext(`(${html.slice(open, end + 1)})`, {}, { timeout: 1000 }) } catch (e) {
    throw new Error(`${name} in ${PAGE} is no longer a plain object: ${e.message}`)
  }
  // Out of the sandbox and into ordinary objects.
  return JSON.parse(JSON.stringify(value))
}

export function readPage(html) {
  const cohortWord = literal(html, 'COHORT_WORD')   // QB -> "quarterbacks"
  const panelFloor = literal(html, 'PANEL_FLOOR')   // rush -> ['car', 12]
  const gaps = literal(html, 'GAPS_BY_POS')         // "What this page can't see", by position
  // prepData() copies the line's entries onto tackle, guard and centre.
  const clone = html.match(/\[([^\]]*)\]\.forEach\(function\(k\)\{\s*SIDE\[k\]=SIDE\.OL;[^}]*GAPS_BY_POS\[k\]=GAPS_BY_POS\.OL;/)
  if (!clone) throw new Error(`the line-position cloning in prepData() changed in ${PAGE}`)
  const line = ['OL', ...(clone[1].match(/[A-Z]+/g) || [])]   // the line, and its three spots
  for (const k of line) if (gaps.OL && !gaps[k]) gaps[k] = gaps.OL
  // renderWeak(): at or under this best match, the page says nobody shares the profile.
  const low = html.match(/var\s+weak\s*=\s*best\s*<=\s*(\d+)\s*;/)
  if (!low) throw new Error(`the low-match line in renderWeak() changed in ${PAGE}`)
  // The depth-chart badge: which spots mean something at which position (ROLE_OK), their
  // names, and how many of a position's list are starters (three receivers).
  const roleWord = literal(html, 'ROLE_WORD')
  const roleOk = literal(html, 'ROLE_OK')
  const roleStarters = literal(html, 'ROLE_STARTERS')
  // regressed(): the stats whose last season is not carried into this season's estimate
  const noCarry = literal(html, 'NO_CARRY')
  // The stats the page's per-stat chart has no game-by-game version of (drawWeekly())
  const seasonOnly = Object.keys(literal(html, 'SEASON_TOTAL_ONLY'))
  // Career mode's rules: which stats add up, which are a best, which never change, and how
  // much more than a season's qualifying line a career needs to join the ranking pool
  const careerSum = literal(html, 'CAREER_SUM')
  const careerMax = literal(html, 'CAREER_MAX')
  const careerConst = literal(html, 'CAREER_CONST')
  const mult = html.match(/var\s+CAREER_POOL_MULT\s*=\s*(\d+(?:\.\d+)?)\s*;/)
  if (!mult) throw new Error(`CAREER_POOL_MULT not found in ${PAGE}`)
  const career = { sum: careerSum, max: careerMax, constant: careerConst, mult: +mult[1] }
  // The team stats' words: [key, label, unit, lower is better], read off TEAM_METRICS
  const tmAt = html.indexOf('var TEAM_METRICS=[')
  if (tmAt < 0) throw new Error(`TEAM_METRICS not found in ${PAGE}`)
  const tmEnd = html.indexOf('\n];', tmAt)
  const teamMetrics = [...html.slice(tmAt, tmEnd).matchAll(/\['([a-z_0-9]+)','([^']+)','([a-z0-9]+)',(true|false),function/g)]
    .map((x) => [x[1], x[2], x[3], x[4] === 'true'])
  if (teamMetrics.length < 20) throw new Error(`TEAM_METRICS in ${PAGE} could not be read`)
  // The All-Savant Team's shape: [position, slot, how many] for offense, defense, specials
  const ast = literal(html, 'AST')
  for (const side of ['off', 'def', 'st']) {
    if (!Array.isArray(ast[side]) || !ast[side].every((sl) => Array.isArray(sl) && sl.length === 3)) {
      throw new Error(`AST.${side} in ${PAGE} is no longer a list of [position, slot, count]`)
    }
  }
  return { cohortWord, panelFloor, gaps, line, lowMatch: +low[1], roleWord, roleOk, roleStarters, noCarry, ast, teamMetrics, career, seasonOnly }
}

// The page's roleSpot() and roleLabel(): what its depth-chart badge says about a man, or
// null where it shows no badge. The depth-chart file draws every defense on one template,
// so a spot is only named where it agrees with the position he is ranked at (a 4-3 end
// filed as a "weak-side linebacker" is not called one), and a rank is only mentioned for
// a man listed behind the starters.
export function roleOf(p, page, posLabel) {
  if (!p.role || !p.role[0]) return null
  const [code, rank] = p.role
  const spot = ` ${page.roleOk[p.pos] || ''} `.includes(` ${code} `) ? (page.roleWord[code] || code) : null
  const behind = rank != null && rank > (page.roleStarters[code] || 1)
  if (!spot && !behind) return null
  return { spot, listed: behind ? rank : null, at: (spot || posLabel[p.pos] || p.pos).toLowerCase() }
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

const yearOf = (season) => +String(season).slice(0, 4)

// The page's eraOK(): a stat exists from its `since` year on. Before that the bar is absent.
export const tracked = (metric, season) => yearOf(season) >= metric.since

// The page's mergeData(): the season in progress lives in its own small file. Where both
// files carry a season the more recently generated one wins, and the stat table comes from
// whichever was built last. Returns a new object; neither input is touched.
export function mergeData(base, cur) {
  const data = { ...base.data }
  const from = Object.fromEntries(Object.keys(data).map((s) => [s, base.generated || null]))
  let cfg = base.cfg
  let generated = base.generated || null
  if (cur && cur.data) {
    const newer = !base.generated || !cur.generated || cur.generated >= base.generated
    for (const s of Object.keys(cur.data)) {
      if (!data[s] || newer) { data[s] = cur.data[s]; from[s] = cur.generated || null }
    }
    if (cur.cfg && (newer || !cfg)) cfg = cur.cfg
    if (newer && cur.generated) generated = cur.generated
  }
  const seasons = Object.keys(data).sort((a, b) => +b - +a)
  return { seasons, data, cfg, from, generated, source: base.source || (cur && cur.source) || null }
}

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

// The page's pctRaw() and pctOf(): midrank percentile against a sorted pool, 1..99, whole
// numbers; nothing at all when the pool has fewer than two values.
export function percentile(v, sorted, lower) {
  const n = sorted ? sorted.length : 0
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

// The page's thrFor(): a stat's sample line for one position. Most stats have one line; a
// few carry a line per position (150 targets is a wide receiver's season and more than any
// running back has ever had).
export const thrFor = (metric, pos) => (metric.thrp && metric.thrp[pos] != null ? metric.thrp[pos] : metric.thr)

// The page's sampleOf(): a stat is on too small a sample when its denominator is known and
// under the stat's threshold for his position.
export function lowSample(p, metric) {
  const thr = thrFor(metric, p.pos)
  if (!thr || !metric.den) return false
  const n = (p.d || {})[metric.den]
  return n != null && n < thr
}

// The page's panelWorthIt(): a panel whose whole denominator is a rounding error is dropped.
// Running is a back's and a quarterback's job and catching a receiver's, thin or not.
export function panelWorthIt(group, p, pos, floors) {
  const f = floors[group]
  if (!f) return true
  // returns are two counts, and either one makes him a returner
  if (group === 'ret') { const dd = p.d || {}; return (dd.kr || 0) + (dd.pr || 0) >= f[1] }
  if (group === 'rush' && (pos === 'RB' || pos === 'QB')) return true
  if (group === 'rec' && (pos === 'WR' || pos === 'TE')) return true
  const d = p.d || {}
  let have = d[f[0]]
  if (have == null && group === 'rec') have = d.rec   // before 2012 there are no targets
  return have != null && have >= f[1]
}

// ---- checking the inputs ---------------------------------------------------------------

function checkConfig(cfg, page) {
  if (!cfg || !Array.isArray(cfg.metrics) || !cfg.metrics.length) throw new Error('football data: cfg.metrics is missing or empty')
  for (const m of cfg.metrics) {
    const ok = typeof m.key === 'string' && typeof m.label === 'string' && typeof m.grp === 'string' &&
      typeof m.unit === 'string' && Array.isArray(m.pos) && Number.isFinite(m.since)
    if (!ok) throw new Error(`football data: malformed metric ${JSON.stringify(m).slice(0, 80)}`)
  }
  for (const k of ['panels', 'posLabel', 'groupLabel', 'headline', 'qualify', 'denoms']) {
    if (!cfg[k] || typeof cfg[k] !== 'object') throw new Error(`football data: cfg.${k} is missing`)
  }
  for (const pos of Object.keys(cfg.posLabel)) {
    if (!page.cohortWord[pos]) throw new Error(`${PAGE}: COHORT_WORD has no word for ${pos}`)
    if (!Array.isArray(cfg.panels[pos])) throw new Error(`football data: cfg.panels has no ${pos}`)
  }
}

// ---- building ------------------------------------------------------------------------

const sorted = (a) => Float64Array.from(a).sort()

export function buildFootballApi({ data, current = null, html }) {
  if (!data || !data.data || typeof data.data !== 'object') throw new Error('football-savant-data.json: expected { data, cfg }')
  const page = readPage(html)
  const merged = mergeData(data, current)
  const cfg = merged.cfg
  checkConfig(cfg, page)

  const metrics = cfg.metrics
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]))
  const positions = Object.keys(cfg.posLabel)
  // Savant value: the parts of the job per position group (tackles, guards and centres share one)
  const VALUE_GROUP = { OT: 'OL', OG: 'OL', OC: 'OL' }
  const valueParts = (cfg.award && cfg.award.pos) || {}
  const latest = merged.seasons[0]
  const playersOf = (season) => merged.data[season].players
  for (const season of merged.seasons) {
    if (!/^\d{4}$/.test(season)) throw new Error(`football data: "${season}" is not a season`)
    if (!Array.isArray((merged.data[season] || {}).players)) throw new Error(`football data: season ${season} has no players`)
    for (const p of playersOf(season)) {
      if (typeof p.id !== 'string' || !p.name || !cfg.posLabel[p.pos]) {
        throw new Error(`football data: ${season} has a row with no id, no name or an unknown position (${JSON.stringify([p.id, p.name, p.pos])})`)
      }
    }
  }

  // ---- pools: the page's poolVals(), for both of its baselines ----
  // seasonPool[season][pos][key] and allPool[pos][key]: the qualified players at the position
  // who have a value, from seasons that tracked the stat.
  const seasonPool = {}
  const allRaw = {}
  const poolCount = { all: {} }
  const seasonHas = {}
  for (const season of merged.seasons) {
    const raw = {}
    const count = {}
    const has = new Set()
    for (const p of playersOf(season)) {
      const mm = p.m || {}
      for (const k in mm) if (mm[k] != null) has.add(k)
      if (!p.qualified) continue
      count[p.pos] = (count[p.pos] || 0) + 1
      const mine = (raw[p.pos] = raw[p.pos] || {})
      for (const k in mm) {
        const m = byKey[k]
        if (!m || !tracked(m, season) || miss(mm[k])) continue
        ;(mine[k] = mine[k] || []).push(mm[k])
      }
    }
    seasonPool[season] = {}
    for (const pos of Object.keys(raw)) {
      seasonPool[season][pos] = {}
      const all = (allRaw[pos] = allRaw[pos] || {})
      for (const k of Object.keys(raw[pos])) {
        seasonPool[season][pos][k] = sorted(raw[pos][k])
        ;(all[k] = all[k] || []).push(raw[pos][k])
      }
    }
    poolCount[season] = count
    for (const pos of Object.keys(count)) poolCount.all[pos] = (poolCount.all[pos] || 0) + count[pos]
    seasonHas[season] = has
  }
  const allPool = {}
  for (const pos of Object.keys(allRaw)) {
    allPool[pos] = {}
    for (const k of Object.keys(allRaw[pos])) allPool[pos][k] = sorted(allRaw[pos][k].flat())
  }

  // ---- the stats a position's card can carry, in the page's order ----
  // render() walks cfg.panels[pos]; groupBlocks() takes the metrics of that panel whose
  // `pos` lists the position, in table order.
  const card = {}
  for (const pos of positions) {
    card[pos] = (cfg.panels[pos] || ['ctx']).map((g) => [g, metrics.filter((m) => m.grp === g && m.pos.includes(pos))])
  }

  // ---- where an unsettled number is likely to end up: the page's regressed() ----
  // Only a season still being played has anything to estimate. The estimate is what he has
  // done so far, weighted by how much of it there is, blended with a prior weighted by the
  // sample the stat needs (its line, k). The prior is the position's average this season,
  // moved toward his own last season by how much of last season there was.
  const isLive = (season) => !!(merged.data[season] || {}).week
  // The page's isEst(): rows worked out from snap counts stay estimates until the season's
  // play-by-play lineups are published, a month after its last week is in.
  const isEst = (season) => { const b = merged.data[season] || {}; return !!(b.est || b.week) }
  const rowsById = {}
  const rowFor = (id, season) => {
    if (!merged.data[season]) return null
    if (!rowsById[season]) rowsById[season] = new Map(playersOf(season).map((p) => [p.id, p]))
    return rowsById[season].get(id) || null
  }
  // The page's posStat(): the position's average for a stat that season, with the lowest
  // and highest any qualified player has posted. Nothing with fewer than five to average.
  const means = new Map()
  function posStat(key, pos, season) {
    const ck = `${key}|${pos}|${season}`
    if (means.has(ck)) return means.get(ck)
    let sum = 0
    let n = 0
    let lo = Infinity
    let hi = -Infinity
    for (const p of merged.data[season] ? playersOf(season) : []) {
      if (!p.qualified || p.pos !== pos) continue
      const v = (p.m || {})[key]
      if (!miss(v)) { sum += v; n++; if (v < lo) lo = v; if (v > hi) hi = v }
    }
    const out = n >= 5 ? { m: sum / n, lo, hi } : null
    means.set(ck, out)
    return out
  }
  function regressed(p, m, season) {
    if (!isLive(season)) return null
    const k = thrFor(m, p.pos)
    if (!k || !m.den) return null
    const x = (p.m || {})[m.key]
    const n = (p.d || {})[m.den]
    if (miss(x) || n == null) return null
    const st = posStat(m.key, p.pos, season)
    if (!st) return null
    const mu = st.m
    let prior = mu
    let last = null
    const prev = String(yearOf(season) - 1)
    const q = rowFor(p.id, prev)
    // Last season counts for as much as there was of it, held inside what qualified
    // players posted that year; last year's schedule is not carried at all (NO_CARRY).
    if (q && q.pos === p.pos && tracked(m, prev) && !page.noCarry[m.key]) {
      const xl = (q.m || {})[m.key]
      const nl = (q.d || {})[m.den]
      const sp = posStat(m.key, p.pos, prev)
      if (!miss(xl) && nl > 0 && sp) {
        prior = mu + (nl / (nl + k)) * (Math.max(sp.lo, Math.min(sp.hi, xl)) - sp.m)
        last = { v: xl, n: nl }
      }
    }
    // the prior stays inside what qualified players have actually posted this season
    prior = Math.max(st.lo, Math.min(st.hi, prior))
    return { v: (n * x + k * prior) / (n + k), prior, last, n, k }
  }
  // The page's estValue() and estPool(): an estimate is ranked against everyone else's
  // estimate (a settled number stands as it is), never against their raw numbers.
  function estValue(p, m, season) {
    const v = (p.m || {})[m.key]
    if (miss(v)) return null
    if (!lowSample(p, m)) return v
    const e = regressed(p, m, season)
    return e ? e.v : null
  }
  const estPools = new Map()
  function estPool(key, pos, season) {
    const ck = `${key}|${pos}|${season}`
    if (estPools.has(ck)) return estPools.get(ck)
    const m = byKey[key]
    const out = []
    for (const p of playersOf(season)) {
      if (!p.qualified || p.pos !== pos) continue
      const ev = estValue(p, m, season)
      if (ev != null) out.push(ev)
    }
    const pool = sorted(out)
    estPools.set(ck, pool)
    return pool
  }

  // ---- the profile score behind the page's career arc: profileScore() ----
  // The mean season percentile across the position's headline stats. Settled stats are
  // preferred; with fewer than two of those it falls back to whatever exists. While a
  // season is being played almost nothing has settled, so each headline stat is scored
  // where it is likely to settle instead, among everyone's estimates.
  function profileScore(p, season) {
    if (!p.qualified) return null
    const strict = []
    const loose = []
    const live = isLive(season)
    for (const k of cfg.headline[p.pos] || []) {
      const m = byKey[k]
      if (!m || !tracked(m, season)) continue
      const v = (p.m || {})[k]
      if (miss(v)) continue
      let pct = percentile(v, ((seasonPool[season] || {})[p.pos] || {})[k], m.lower)
      if (pct == null) continue
      let settled = !lowSample(p, m)
      if (live) {
        const ev = estValue(p, m, season)
        const ep = ev == null ? null : percentile(ev, estPool(k, p.pos, season), m.lower)
        if (ep != null) { pct = ep; settled = true }
      }
      loose.push(pct)
      if (settled) strict.push(pct)
    }
    const use = strict.length >= 2 ? strict : loose.length ? loose : null
    return use ? use.reduce((a, b) => a + b, 0) / use.length : null
  }

  // ---- the index, and each man's peak ----
  // Seasons run newest first, so first sight of a player is his most recent season.
  const index = new Map()
  const scores = new Map() // id -> { season: raw score }
  for (const season of merged.seasons) {
    for (const p of playersOf(season)) {
      const seen = index.get(p.id)
      if (seen) { seen.from = season; seen.all.push(season) }
      else index.set(p.id, { id: p.id, name: p.name, pos: p.pos, team: p.team || null, from: season, to: season, all: [season] })
      const sc = profileScore(p, season)
      if (sc != null) {
        if (!scores.has(p.id)) scores.set(p.id, {})
        scores.get(p.id)[season] = sc
      }
    }
  }
  // careerArc(): the peak is his best score, and the earliest season wins a tie.
  for (const [id, mine] of scores) {
    let peak = null
    for (const season of Object.keys(mine).sort()) if (peak == null || mine[season] > mine[peak]) peak = season
    index.get(id).peak = peak
  }

  // ---- the All-Savant Team: the page's allSavantTeams() and astPick() ----
  // The page picks it in the browser from the same rows, so it is picked here the same way
  // and written into each season file. tools/savant-football/check.mjs runs the page's own
  // allSavantTeams() over the real data and compares every pick.
  const ast = page.ast
  // The page's teamGamesOf() and heavyUse(): only asked of a season with no Savant value.
  const teamGamesOf = (p) => { const g = (p.m || {}).g || 0; const a = (p.m || {}).avail; return (!miss(a) && a > 0) ? g * 100 / a : null }
  function heavyUse(p) {
    const mm = p.m || {}
    const g = mm.g || 0
    const tg = teamGamesOf(p)
    if (p.pos === 'K' || p.pos === 'P') return tg ? g >= 0.75 * tg : g >= 12
    if (/^O[LTGC]$/.test(p.pos)) {
      if (!miss(mm.starts) && tg) return mm.starts >= 0.75 * tg
      return tg ? g >= 0.75 * tg : g >= 12
    }
    if (!miss(mm.snapshr) && mm.snapshr > 0) return mm.snapshr >= 55
    return tg ? g >= 0.75 * tg : g >= 12
  }
  const hasValue = (season) => playersOf(season).some((p) => !miss((p.m || {}).sav))
  // The page's rankedAt(): qualified men at a position, best Savant value first; a season
  // from before the value existed falls back to the profile score among heavy users.
  function rankedAt(season, pos) {
    const out = []
    const val = hasValue(season)
    for (const p of playersOf(season)) {
      if (p.pos !== pos || !p.qualified) continue
      if (val) { if (!miss((p.m || {}).sav)) out.push({ p, raw: p.m.sav, value: true }); continue }
      if (!heavyUse(p)) continue
      const sc = profileScore(p, season)
      if (sc != null) out.push({ p, raw: sc, value: false })
    }
    // Array.prototype.sort is stable, as the page's is, so ties keep the data's order.
    return out.sort((a, b) => b.raw - a.raw)
  }
  function astPick(season, nth, used) {
    const blk = merged.data[season] || {}
    const pick = (slot, it) => ({ slot, id: it.p.id, name: it.p.name, team: it.p.team || null, by: it.value ? 'value' : 'score', v: it.raw })
    function fill(list) {
      const out = []
      for (const [pos, slot, n] of list) {
        let k = 0
        for (const it of rankedAt(season, pos)) {
          if (k >= n) break
          if (used[it.p.id]) continue
          used[it.p.id] = 1; k++
          out.push(pick(slot, it))
        }
      }
      return out
    }
    let off = fill(ast.off)
    let line = null
    // Linemen one by one wherever the season has blocking numbers for them (2016 on), else
    // the best line as a unit (the second-best on the 2nd team).
    const withPrs = playersOf(season).filter((p) => {
      if (p.pos !== 'OT' || !p.qualified) return false
      if (miss((p.m || {}).sav)) return !miss((p.m || {}).prsallow)
      return (p.savb || []).some((x) => x[0] === 'pp')
    }).length
    if (withPrs >= 16) {
      off = off.concat(fill([['OT', 'T', 2], ['OG', 'G', 2], ['OC', 'C', 1]]))
    } else if (blk.lines && blk.lines[nth]) {
      const L = blk.lines[nth]
      line = { team: L.tm, games: L.g ?? null, sack_rate: L.sackr, hit_rate: L.hitr, rush_success: L.runsr, pct: L.pct }
      for (const f of L.five) {
        used[f.id] = 1
        off.push({ slot: f.slot, id: f.id, name: f.name, team: L.tm, by: 'line', v: null })
      }
    }
    // From 2025 the depth charts name the slot corner: the nickel spot goes to the best man
    // listed there and the two outside spots to outside corners.
    const hasSlot = playersOf(season).some((p) => p.pos === 'CB' && p.role && p.role[0] === 'NB')
    let def
    if (hasSlot) {
      def = fill(ast.def.filter((sl) => sl[0] !== 'CB' && sl[0] !== 'S'))
      const outside = []
      let nb = null
      for (const it of rankedAt(season, 'CB')) {
        if (used[it.p.id]) continue
        const slot = it.p.role && it.p.role[0] === 'NB'
        if (slot && !nb) nb = it
        else if (!slot && outside.length < 2) outside.push(it)
      }
      for (const it of outside.concat(nb ? [nb] : [])) {
        used[it.p.id] = 1
        def.push(pick(nb && it === nb ? 'NB' : 'CB', it))
      }
      def = def.concat(fill(ast.def.filter((sl) => sl[0] === 'S')))
    } else def = fill(ast.def)
    const st = fill(ast.st)
    // Returners are graded apart, so a man on either team can still be its returner.
    for (const [k, slot] of [['kr', 'KR'], ['pr', 'PR']]) {
      const r = ((blk.ret || {})[k] || [])[nth]
      if (!r) continue
      const p = rowFor(r.id, season) || {}
      st.push({ slot, id: r.id, name: p.name || r.id, team: r.tm || null, by: 'returns', v: null,
        returns: { n: r.n, yards_per: r.ypr, epa_per: r.epa, pct: r.pct } })
    }
    return { off, def, st, line }
  }
  const allSavantTeams = (season) => { const used = {}; return [astPick(season, 0, used), astPick(season, 1, used)] }

  // ---- teams: the page's teamStats(), teamRank() and openTeam() ----
  // Every team's offense and defense from the season's team block (sums, so the rates and
  // ranks are taken here, as the page takes them), its line grade, and its roster in the
  // page's order. tools/savant-football/check.mjs renders the page's own team panel over
  // the same data and compares.
  const tdiv = (a, b, k) => ((miss(a) || !b) ? null : a / b * (k || 1))
  const TEAM_METRICS = [
    ['o_epa', (e) => tdiv(e.o.epa, e.o.plays)], ['o_succ', (e) => tdiv(e.o.succ, e.o.plays, 100)],
    ['o_pepa', (e) => tdiv(e.o.pepa, e.o.db)], ['o_repa', (e) => tdiv(e.o.repa, e.o.run)],
    ['o_ypc', (e) => tdiv(e.o.ryds, e.o.run)], ['o_sk', (e) => tdiv(e.o.sk || 0, e.o.db, 100)],
    ['o_hit', (e) => tdiv(e.o.hit || 0, e.o.db, 100)], ['o_d3', (e) => tdiv(e.o.d3c || 0, e.o.d3, 100)],
    ['o_x20', (e) => tdiv(e.o.x20 || 0, e.g)], ['o_to', (e) => tdiv(e.o.to || 0, e.g)],
    ['d_epa', (e) => tdiv(e.d.epa, e.d.plays)], ['d_succ', (e) => tdiv(e.d.succ, e.d.plays, 100)],
    ['d_pepa', (e) => tdiv(e.d.pepa, e.d.db)], ['d_repa', (e) => tdiv(e.d.repa, e.d.run)],
    ['d_ypc', (e) => tdiv(e.d.ryds, e.d.run)], ['d_sk', (e) => tdiv(e.d.sk || 0, e.d.db, 100)],
    ['d_hit', (e) => tdiv(e.d.hit || 0, e.d.db, 100)], ['d_d3', (e) => tdiv(e.d.d3c || 0, e.d.d3, 100)],
    ['d_x20', (e) => tdiv(e.d.x20 || 0, e.g)], ['d_to', (e) => tdiv(e.d.to || 0, e.g)],
    ['d_wr', (e) => tdiv(e.d.tWR_y, e.d.tWR_n)], ['d_te', (e) => tdiv(e.d.tTE_y, e.d.tTE_n)],
    ['d_rbt', (e) => tdiv(e.d.tRB_y, e.d.tRB_n)], ['d_rb', (e) => tdiv(e.d.rRB_y, e.d.rRB_n)],
    ['d_qb', (e) => tdiv(e.d.rQB_y, e.d.rQB_n)],
    ['net', (e) => { const a = tdiv(e.o.epa, e.o.plays); const b = tdiv(e.d.epa, e.d.plays); return (a == null || b == null) ? null : a - b }],
    ['sd', (e) => (miss(e.sd) ? null : e.sd)], ['so', (e) => (miss(e.so) ? null : e.so)],
  ]
  const teamMeta = page.teamMetrics   // [key, label, unit, lower], read out of the page
  {
    const mine = TEAM_METRICS.map((t) => t[0]).join(' ')
    const theirs = teamMeta.map((t) => t[0]).join(' ')
    if (mine !== theirs) throw new Error(`TEAM_METRICS in ${PAGE} changed (${theirs}); the slicer has ${mine}`)
  }
  const LOWER = Object.fromEntries(teamMeta.map((t) => [t[0], t[3]]))
  const TEAM_UNITS = [['Offense', ['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'OC', 'OL']], ['Defense', ['ED', 'DI', 'LB', 'CB', 'S']], ['Specialists', ['K', 'P']]]
  const LINE_ORDER = { LT: 0, LG: 1, C: 2, RG: 3, RT: 4 }
  const onTeam = (p, t) => p.team === t || (p.tms && p.tms.indexOf(t) >= 0)
  // The page's roleSpot(): the depth-chart spot, only where it agrees with his position.
  const roleSpot = (p) => (p.role && p.role[0] && ` ${page.roleOk[p.pos] || ''} `.includes(` ${p.role[0]} `) ? (page.roleWord[p.role[0]] || p.role[0]) : null)
  function teamsOf(season) {
    const blk = merged.data[season] || {}
    const stats = {}
    for (const t of Object.keys(blk.tm || {})) {
      const e = blk.tm[t]
      if (!e.o || !e.d) continue
      const row = {}
      for (const [k, f] of TEAM_METRICS) { const v = f(e); if (v != null && Number.isFinite(v)) row[k] = v }
      stats[t] = { g: e.g, row }
    }
    const pool = {}
    for (const [k] of TEAM_METRICS) pool[k] = Object.values(stats).map((x) => x.row[k]).filter((v) => v != null)
    // teamRank(): 1 is best, the high end or the low end where lower is better
    const rankOf = (k, v) => {
      const a = pool[k]
      if (v == null || !a.length) return null
      let better = 0
      for (const x of a) if (LOWER[k] ? x < v : x > v) better++
      return [v, better + 1, a.length, a.length > 1 ? Math.round(100 * (a.length - 1 - better) / (a.length - 1)) : 50]
    }
    const lines = blk.lines || []
    // the team block's own order first (the order the page's boards keep for a tie), then
    // any club that only appears on a roster
    const extra = new Set()
    for (const p of playersOf(season)) { if (p.team) extra.add(p.team); for (const t of p.tms || []) extra.add(t) }
    const teams = [...Object.keys(stats), ...[...extra].filter((t) => !stats[t]).sort()]
    const out = {}
    for (const t of teams) {
      if (!cfg.teams || !cfg.teams[t] || (cfg.alias && cfg.alias[t])) continue
      const ps = playersOf(season).filter((p) => onTeam(p, t))
      let rec = null
      let coach = null
      for (const p of ps) if (p.team === t && p.rec && !rec) { rec = p.rec; coach = p.coach || null }
      const line = lines.filter((L) => L.tm === t)[0]
      const team = {
        g: stats[t] ? stats[t].g : null,
        rec, coach,
        stats: stats[t] ? Object.fromEntries(TEAM_METRICS.map(([k]) => [k, rankOf(k, stats[t].row[k])]).filter((x) => x[1])) : null,
        line: line ? { score: line.score, rank: 1 + lines.filter((L) => L.score > line.score).length, of: lines.length } : null,
        roster: [],
      }
      for (const [unit, list] of TEAM_UNITS) {
        const mine = ps.filter((p) => list.includes(p.pos))
        mine.sort((a, b) => {
          const d = list.indexOf(a.pos) - list.indexOf(b.pos)
          if (unit === 'Offense' && /^O[LTGC]$/.test(a.pos) && /^O[LTGC]$/.test(b.pos)) {
            const ra = a.role ? LINE_ORDER[a.role[0]] : null
            const rb = b.role ? LINE_ORDER[b.role[0]] : null
            const sa = ((a.m || {}).snapshr || 0) >= 50
            const sb = ((b.m || {}).snapshr || 0) >= 50
            if (sa !== sb) return sa ? -1 : 1
            if (sa && ra != null && rb != null && ra !== rb) return ra - rb
            return ((b.m || {}).snapshr || 0) - ((a.m || {}).snapshr || 0)
          }
          if (d) return d
          return ((b.m || {}).snapshr || (b.m || {}).g || 0) - ((a.m || {}).snapshr || (a.m || {}).g || 0)
        })
        for (const p of mine) {
          const sc = p.qualified ? profileScore(p, season) : null
          const mm = p.m || {}
          team.roster.push({
            unit, id: p.id, name: p.name, pos: p.pos, spot: roleSpot(p),
            snap: miss(mm.snapshr) ? null : Math.round(mm.snapshr),
            score: sc == null ? null : Math.round(sc),
            st: p.st || null,
            now: p.team !== t ? (p.team || null) : undefined,
          })
        }
      }
      out[t] = team
    }
    return out
  }

  // ---- careers: the page's careerRow() and careerPool() ----
  // A career is his seasons added together and divided once: every rate is the
  // denominator-weighted mean of his season rates, a few stats add up or take a best, and
  // availability is his games over his teams' games. A career joins the ranking pool with
  // CAREER_POOL_MULT times a season's qualifying volume, and is ranked among the other
  // careers at the position he played most (by games).
  const careerRows = new Map()
  {
    const bySeasons = new Map() // id -> [[season, row]] oldest first
    for (const season of [...merged.seasons].sort()) {
      for (const p of playersOf(season)) {
        if (!bySeasons.has(p.id)) bySeasons.set(p.id, [])
        bySeasons.get(p.id).push([season, p])
      }
    }
    const C = page.career
    for (const [id, list] of bySeasons) {
      const ss = list.map((x) => x[0])
      const rowAt = Object.fromEntries(list)
      const last = rowAt[ss[ss.length - 1]]
      const D = {}
      for (const [, r] of list) for (const k in (r.d || {})) D[k] = (D[k] || 0) + r.d[k]
      const byPos = {}
      for (const [, r] of list) byPos[r.pos] = (byPos[r.pos] || 0) + ((r.d && r.d.g) || 1)
      let bestPos = last.pos
      let bestG = -1
      for (const pk in byPos) if (byPos[pk] > bestG) { bestG = byPos[pk]; bestPos = pk }
      const out = { id, name: last.name, pos: bestPos, posmix: byPos, seasons: ss, d: D, m: {}, cov: {}, dw: {} }
      for (const mt of metrics) {
        if (!mt.pos.includes(bestPos)) continue
        const key = mt.key
        if (C.constant[key]) {
          for (let a = ss.length - 1; a >= 0; a--) { const cv = (rowAt[ss[a]].m || {})[key]; if (!miss(cv)) { out.m[key] = cv; break } }
          continue
        }
        let acc = 0, wt = 0, n = 0, lo = null
        const seen = []
        for (const s of ss) {
          const r = rowAt[s]
          if (yearOf(s) < mt.since) continue
          const v = (r.m || {})[key]
          if (miss(v)) continue
          if (C.sum[key]) { acc += v; n++; seen.push(s); continue }
          if (C.max[key]) { if (lo == null || (mt.lower ? v < lo : v > lo)) lo = v; n++; seen.push(s); continue }
          const w = (r.d || {})[mt.den]
          if (miss(w) || w <= 0) continue
          acc += v * w; wt += w; n++; seen.push(s)
        }
        if (!n) continue
        let val
        if (C.sum[key]) val = acc
        else if (C.max[key]) val = lo
        else if (wt > 0) { val = acc / wt; out.dw[key] = wt }
        else continue
        out.m[key] = val
        out.cov[key] = [n, seen[0], seen[seen.length - 1]]
      }
      let pg = 0, tg = 0
      for (const [, r] of list) {
        const g = (r.m || {}).g, av = (r.m || {}).avail
        if (miss(g) || miss(av) || av <= 0) continue
        pg += g; tg += g / (av / 100)
      }
      if (tg > 0) { out.m.avail = 100 * pg / tg; out.cov.avail = [ss.length, ss[0], ss[ss.length - 1]] }
      let W = 0, L = 0, T = 0, po = 0
      const rings = [], sbLost = [], teams = [], tseen = {}
      for (const [s, r] of list) {
        if (r.rec) { W += r.rec[0]; L += r.rec[1]; T += r.rec[2] || 0 }
        const pp = r.po || ''
        if (pp.indexOf('Won Super Bowl') === 0) rings.push(s)
        else if (pp === 'Lost Super Bowl') sbLost.push(s)
        if (pp && pp !== 'Missed the playoffs') po++
        if (r.team && !tseen[r.team]) { tseen[r.team] = 1; teams.push(r.team) }
      }
      Object.assign(out, { rec: [W, L, T], rings, sbLost, poyears: po, teams })
      const accm = {}
      for (const [s, r] of list) {
        if (isLive(s) || !r.acc) continue
        for (const x of r.acc) {
          const slot = accm[x.s] || (accm[x.s] = { s: x.s, led: 0, top: 0, best: 99, years: [], ledYears: [] })
          if (x.r === 1) { slot.led++; slot.ledYears.push(s) }
          slot.top++
          if (x.r < slot.best) slot.best = x.r
          slot.years.push(s)
        }
      }
      out.acc = Object.values(accm).sort((a, b) => (b.led - a.led) || (b.top - a.top) || (a.best - b.best))
      const q = cfg.qualify[bestPos]
      const qf = (cfg.qualifyFallback || {})[bestPos]
      let ok = false
      if (q && !miss(D[q[0]]) && D[q[0]] >= q[1] * C.mult) ok = true
      if (!ok && qf && !miss(D[qf[0]]) && D[qf[0]] >= qf[1] * C.mult) ok = true
      out.poolOK = ok
      careerRows.set(id, out)
    }
  }
  // careerPool(): the careers at a position that are in the pool, by stat
  const careerPools = {}
  for (const r of careerRows.values()) {
    if (!r.poolOK) continue
    const mine = (careerPools[r.pos] = careerPools[r.pos] || {})
    for (const k in r.m) if (!miss(r.m[k])) (mine[k] = mine[k] || []).push(r.m[k])
  }
  for (const pos of Object.keys(careerPools)) for (const k of Object.keys(careerPools[pos])) careerPools[pos][k] = sorted(careerPools[pos][k])
  // The page's sampleOf() on a career: a rate built from fewer of its denominator than the
  // stat needs is a thin sample, counted over the seasons that tracked it.
  function careerLow(r, mt) {
    const thr = thrFor(mt, r.pos)
    if (!thr || !mt.den) return false
    let n = (r.d || {})[mt.den]
    if (r.dw[mt.key] != null) n = r.dw[mt.key]
    return n != null && n < thr
  }
  const awards = data.awards || {}
  const careerFiles = {}
  const careerWhere = {}
  // In the page's own order (its NAMES: newest season first, the data's order inside it),
  // so that a board's ties fall the way the page's do.
  for (const r of [...index.keys()].map((id) => careerRows.get(id)).filter(Boolean)) {
    // A one-season career outside the pool is that season's card; it is left out of the
    // files (the tools answer it from the season). One that is in the pool (a season with
    // three seasons' volume) stays: it is on the page's career boards.
    if (r.seasons.length < 2 && !r.poolOK) continue
    const m = {}
    const low = []
    for (const mt of metrics) {
      const v = r.m[mt.key]
      if (v == null || miss(v)) continue
      // Kept whole: rounded to any number of places a career total can land on the far side
      // of a half and print a digit off from the page (+167.05 for its +167.0499).
      m[mt.key] = [v, percentile(v, (careerPools[r.pos] || {})[mt.key], mt.lower)]
      if (careerLow(r, mt)) low.push(mt.key)
    }
    const span = r.seasons.length
    const cov = Object.fromEntries(Object.entries(r.cov).filter(([, c]) => c[0] < span))
    const row = {
      id: r.id, name: r.name, pos: r.pos, qualified: r.poolOK, seasons: r.seasons.map(Number),
      d: Object.fromEntries(Object.entries(r.d).filter(([k]) => (cfg.denomCore || Object.keys(cfg.denoms)).includes(k))),
      m,
    }
    if (low.length) row.low = low
    if (Object.keys(cov).length) row.cov = cov
    if (Object.keys(r.posmix).length > 1) row.posmix = r.posmix
    if (r.rec[0] + r.rec[1] + r.rec[2]) row.rec = r.rec
    if (r.rings.length) row.rings = r.rings.map(Number)
    if (r.sbLost.length) row.sbLost = r.sbLost.map(Number)
    if (r.poyears) row.poyears = r.poyears
    row.teams = r.teams
    if (r.acc.length) row.acc = r.acc.map((a) => ({ s: a.s, led: a.led, top: a.top, best: a.best, led_in: a.ledYears.map(Number) }))
    if (awards[r.id]) row.aw = awards[r.id]
    // careerArc(): his profile score season by season (null below the qualifying line)
    const sc = scores.get(r.id) || {}
    row.arc = r.seasons.map((s) => [+s, sc[s] == null ? null : Math.round(sc[s] * 10) / 10])
    ;(careerFiles[r.pos] = careerFiles[r.pos] || []).push(row)
    const idx = index.get(r.id)
    if (idx && idx.pos !== r.pos) careerWhere[r.id] = r.pos
  }

  // ---- season files ----
  const seasons = {}
  for (const season of merged.seasons) {
    const block = merged.data[season]
    const pool = seasonPool[season]
    // Position by position, in the page's order: rows of one shape sit together, which is
    // worth a sixth of the file once it is gzipped. Within a position the data's order stands.
    const inOrder = playersOf(season).map((p, i) => [p, i])
      .sort((a, b) => positions.indexOf(a[0].pos) - positions.indexOf(b[0].pos) || a[1] - b[1])
    const rows = inOrder.map(([p]) => {
      const pos = p.pos
      const d = p.d || {}
      const mine = (pool[pos] || {})
      const every = allPool[pos] || {}
      const m = {}
      const low = []
      const off = []
      const est = []
      const settle = {}
      const estNow = isEst(season)
      // For the Leaderboard Builder: the stats of a panel the card drops for a thin sample
      // still rank on the page's boards (a receiver's yards per carry), so they are kept
      // apart from the card, in the same shape. ep: the page's "likely to settle" board
      // colours a settled number by where it stands among everyone's estimates.
      const xm = {}
      const xlow = []
      const xsettle = {}
      const ep = {}
      const live = isLive(season)
      for (const [group, list] of card[pos] || []) {
        if (!panelWorthIt(group, p, pos, page.panelFloor)) {
          off.push(group)
          for (const mt of list) {
            const v = (p.m || {})[mt.key]
            if (!tracked(mt, season) || miss(v)) continue
            xm[mt.key] = [v, percentile(v, mine[mt.key], mt.lower), percentile(v, every[mt.key], mt.lower)]
            if (lowSample(p, mt)) {
              xlow.push(mt.key)
              const e = regressed(p, mt, season)
              if (e) xsettle[mt.key] = [e.v, percentile(e.v, estPool(mt.key, pos, season), mt.lower)]
            } else if (live) {
              const pe = percentile(v, estPool(mt.key, pos, season), mt.lower)
              if (pe != null) ep[mt.key] = pe
            }
          }
          continue
        }
        for (const mt of list) {
          const v = (p.m || {})[mt.key]
          if (!tracked(mt, season) || miss(v)) continue   // barRow(): absent, not zero
          m[mt.key] = [v, percentile(v, mine[mt.key], mt.lower), percentile(v, every[mt.key], mt.lower)]
          if (estNow && mt.est) est.push(mt.key)         // the page tags the row "est."
          if (lowSample(p, mt)) {
            low.push(mt.key)
            // the second mark on a hollow bar: where the number is likely to settle
            const e = regressed(p, mt, season)
            // Kept whole. Rounded to any number of places it can land on the far side of a
            // half and print a digit off from the page (.065 as "0.07" where the page,
            // holding .06499999, prints "0.06").
            if (e) settle[mt.key] = [e.v, percentile(e.v, estPool(mt.key, pos, season), mt.lower)]
          } else if (live) {
            const pe = percentile(v, estPool(mt.key, pos, season), mt.lower)
            if (pe != null) ep[mt.key] = pe
          }
        }
      }

      const row = { id: p.id, name: p.name, team: p.team || null, pos, qualified: !!p.qualified }
      if (p.tms && p.tms.length > 1) row.tms = p.tms
      for (const k of ['age', 'exp', 'college', 'rec', 'po', 'coach', 'acc', 'inj', 'st']) if (p[k] != null) row[k] = p[k]
      // the depth-chart badge as the page words it: null where the page shows none
      const role = roleOf(p, page, cfg.posLabel)
      if (role) row.role = role
      if (p.dr) row.draft = { round: p.dr, pick: p.dp ?? null, year: p.dy ?? null, team: p.dt ?? null }
      else if (p.udfa) row.udfa = true
      // The counts a card is built on, plus the sample behind any row that is short of its
      // line (a reader needs "40 of 60 play-action dropbacks" to quote that row honestly).
      // The sample behind a settled split is left out: it would double every file.
      const core = new Set(cfg.denomCore || Object.keys(cfg.denoms))
      for (const k of low) core.add(byKey[k].den)
      // a returner's two counts, for the men short of the returns panel's floor
      if ((card[pos] || []).some(([g]) => g === 'ret')) { core.add('kr'); core.add('pr') }
      row.d = Object.fromEntries(Object.keys(cfg.denoms).filter((k) => core.has(k) && d[k] != null).map((k) => [k, d[k]]))
      row.m = m
      if (low.length) row.low = low
      if (off.length) row.off = off
      if (est.length) row.est = est
      if (Object.keys(settle).length) row.settle = settle
      if (Object.keys(xm).length) row.xm = xm
      if (xlow.length) row.xlow = xlow
      if (Object.keys(xsettle).length) row.xsettle = xsettle
      if (Object.keys(ep).length) row.ep = ep
      // The page prints the score on the career-arc button, which needs two seasons to exist.
      const sc = (scores.get(p.id) || {})[season]
      if (sc != null && index.get(p.id).all.length >= 2) row.score = Math.round(sc)
      // Comps are men from the same season file, so an id and a score is all they need.
      if (p.comps && p.comps.length) row.comps = p.comps.map((c) => [c.id, c.score])
      if (p.wflaws && p.wflaws.length) row.wflaws = p.wflaws.map((f) => [f.k, f.pct])
      if (p.wcomps && p.wcomps.length) row.wcomps = p.wcomps.map((c) => [c.id, c.score])
      // Savant value by part of the job, in the order meta.value lists them for his position
      if (p.savb && p.savb.length) {
        const parts = valueParts[VALUE_GROUP[pos] || pos] || []
        const by = Object.fromEntries(p.savb)
        row.val = parts.map((f) => (by[f.key] == null ? null : by[f.key]))
      }
      return row
    })

    seasons[season] = {
      schema: SCHEMA,
      season,
      generated: merged.from[season],
      week: block.week || null,
      weekPlaying: block.weekPlaying || null,
      // true while the rows in each player's `est` are still estimates (see meta.rows.est)
      est: isEst(season),
      pools: poolCount[season],
      // The page's notYet(): tracked by this era, but nobody in the season has one.
      notYet: metrics.filter((m) => tracked(m, season) && !seasonHas[season].has(m.key)).map((m) => m.key),
      allSavant: allSavantTeams(season),
      teams: teamsOf(season),
      players: rows,
    }
  }

  const top = merged.data[latest] || {}
  const word = (k) => cfg.denoms[k] || k
  const meta = {
    schema: SCHEMA,
    name: 'Football Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/${PAGE}`,
    playerUrl: `${SITE}/${PAGE}#p={id}&s={season}`,
    generated: merged.generated,
    source: merged.source,
    latestSeason: latest,
    // Set while the latest season is still being played: the page says "through week N".
    live: top.week ? { season: latest, week: top.week, weekPlaying: top.weekPlaying || null } : null,
    seasons: merged.seasons,
    files: {
      players: `${SITE}/${BASE}/players.json`,
      season: `${SITE}/${BASE}/seasons/{season}.json`,
    },
    positions: Object.fromEntries(positions.map((pos) => [pos, {
      label: cfg.posLabel[pos],
      peers: page.cohortWord[pos],
      panels: cfg.panels[pos],
      headline: cfg.headline[pos] || [],
      qualify: cfg.qualify[pos] ? { den: cfg.qualify[pos][0], word: word(cfg.qualify[pos][0]), min: cfg.qualify[pos][1] } : null,
      qualifyFallback: (cfg.qualifyFallback || {})[pos]
        ? { den: cfg.qualifyFallback[pos][0], word: word(cfg.qualifyFallback[pos][0]), min: cfg.qualifyFallback[pos][1] }
        : null,
      cannotSee: page.gaps[pos] || null,
    }])),
    groups: cfg.groupLabel,
    denoms: cfg.denoms,
    // The counts a card is built on. The rest of denoms are the samples behind single rows
    // (a depth band, a kind of snap), which a "built on" line has no business listing.
    denomCore: cfg.denomCore || Object.keys(cfg.denoms),
    // What a franchise was called before it moved: code -> [last season under the old name,
    // old code, old name]. The data keeps one code per franchise; answers say the old one
    // for the seasons it applies to.
    era: cfg.era || {},
    units: UNITS,
    panelFloor: page.panelFloor,
    pools: poolCount,
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile is always the better mark. With fewer than two players in the pool there is no percentile.',
      pool: 'Qualified players at the same position who have a value for the stat. Position is the one he played that season. A player who did not qualify is still ranked against that pool, and is marked qualified: false.',
      season: 'Against qualified players at his position in the same season. This is what the page shows first ("Rank against: This season").',
      allTime: 'Against qualified players at his position in every season that tracked the stat, the season in progress included ("Rank against: All-time").',
      qualify: 'The qualifying line is a full-season count for the position (positions[].qualify). Where a season has no such count for him it falls back to positions[].qualifyFallback. While a season is being played the line is pro-rated to the games his team has played.',
    },
    metrics: metrics.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.grp,
      sub: m.sub || null,
      layer: m.layer,
      unit: m.unit,
      positions: m.pos,
      lowerIsBetter: !!m.lower,
      since: m.since,
      den: m.den || null,
      lowSampleBelow: m.thr || null,
      // where the line differs by position: { RB: 75, TE: 115 }
      lowSampleBelowByPosition: m.thrp || null,
      // true: an estimate from snap counts while a season is being played, exact after it
      estimateInSeason: !!m.est,
      what: (m.exp && m.exp.w) || null,
      formula: (m.exp && m.exp.f) || null,
      why: (m.exp && m.exp.y) || null,
    })),
    weakness: { lowMatch: page.lowMatch },
    // Stats with no one-game version: the per-stat chart shows them over a season only
    seasonOnly: page.seasonOnly,
    // Career mode: a career joins the ranking pool with this many seasons' qualifying volume
    careerPoolMultiple: page.career.mult,
    // Every club's name, by the code the data keeps (era names are in era)
    teamNames: Object.fromEntries(Object.entries(cfg.teams || {}).filter(([t]) => !(cfg.alias && cfg.alias[t])).map(([t, v]) => [t, v[0]])),
    // The team page's and team leaderboards' stats, in the page's order
    teamStats: page.teamMetrics.map(([key, label, unit, lower]) => ({ key, label, unit, lowerIsBetter: lower })),
    // Savant value (the stat `sav`): what the All-Savant Team is picked on. For each
    // position, the parts of the job it is built from, in the order a row's `val` lists them.
    value: cfg.award ? {
      what: 'Expected points a player has been worth in one season above a replacement-level player at his position (the ' + cfg.award.replacement + 'th percentile of qualified players). This season only, on the snaps he actually played. Each stat counts by how well it follows a player to a new team and by how much it says about points; a small sample is pulled toward average.',
      learnedOn: cfg.award.fit,
      linemen: VALUE_GROUP,
      // shareThatIsHis: of the part that repeats from season to season, how much follows a
      // player to a new team. A stand-in (used in the seasons that never tracked the parts
      // it names) has none of its own: it is scaled to the parts it stands in for.
      parts: Object.fromEntries(Object.entries(cfg.award.pos).map(([g, fs]) => [g, fs.map((f) => (
        f.standin ? { key: f.key, label: f.label, shareThatIsHis: null, standsInFor: f.standin }
          : { key: f.key, label: f.label, shareThatIsHis: f.credit }))])),
    } : null,
    caveats: {
      // Not printed on the page; from pipeline/football/README.md. A lineman's games count
      // is only right where snap counts exist. Before them it is the games he was flagged in.
      lineGames: byKey.snaps ? { positions: page.line.filter((pos) => cfg.posLabel[pos]), before: byKey.snaps.since } : null,
    },
    row: {
      id: 'Player id. Use it in playerUrl.',
      pos: 'His position that season (positions has the labels). It can change from one season to the next.',
      team: 'The team he finished the season with. tms lists every team he appeared for that season, in order, when there was more than one.',
      qualified: 'Whether he is in the percentile pools that season.',
      d: 'What his rates are built on, by denominator (denoms has the words): games, dropbacks, carries, targets, snaps and so on (denomCore), plus the sample behind any stat listed in low.',
      m: 'The bars on his card, by stat key: [value, percentile among his position that season, percentile among his position all-time]. A stat that is absent was not tracked that season, has no value for him, or belongs to a panel the page drops for too small a sample. It is not zero.',
      off: 'Panels the page leaves off his card because their whole sample is under the floor in panelFloor (a receiver\'s three carries).',
      low: 'Keys of stats whose denominator is under the stabilization threshold (metrics[].lowSampleBelow of metrics[].den, or his position\'s line in lowSampleBelowByPosition). Quote them with that caveat.',
      est: 'Keys of stats that are estimates for now: they are worked out from snap counts until the season\'s play-by-play lineups are published, which is after the Super Bowl (the season file\'s own `est` is true until then). The page tags these rows "est.".',
      xm: 'Stats from panels the card drops for a thin sample (see off), in the same shape as m. The page\'s Leaderboard Builder still ranks them. xlow and xsettle are low and settle for these.',
      ep: 'Season in progress only: for each settled stat (in m or xm), its percentile among every qualified player\'s "likely to settle" estimate at his position. The Leaderboard Builder colours a settled number this way when it ranks on where numbers are likely to settle.',
      settle: 'Season in progress only, for the stats in low: [where the number is likely to settle, its percentile among the same estimate for every qualified player at his position]. The estimate is his number so far blended with what is normal at his position and with his own last season, weighted by how little there is so far. It is the diamond on a hollow bar.',
      role: 'The page\'s depth-chart badge, 2025 on, or absent where the page shows none: {spot, listed, at}. spot is the named spot where it says more than his position does (a left tackle, a nickel back), else null; listed is his best place in the chart\'s order when that is behind the starters (2 = listed second), else null; at is the spot or position in words. It is the order a depth chart lists a position in, not where he lined up on each play or how much he played.',
      st: 'Season in progress only: his roster status in the latest week on file when he is not on the active roster (injured reserve, practice squad and so on).',
      val: 'Savant value (m.sav) by part of the job, in expected points against an AVERAGE player at his position that season: one number per entry of value.parts for his position (linemen share OL), null where a season did not track that part. The parts are against average and the total is against a replacement player, so they do not add up to it.',
      score: 'Profile score: the mean season percentile across his position\'s headline stats (positions[].headline), as on the page\'s career-arc button. Qualified seasons only, and only for players with two or more seasons. While a season is being played each headline stat is scored where it is likely to settle (see settle), not on its raw value.',
      rec: 'His team\'s record: [wins, losses, ties]. po is how its season ended; coach is its head coach.',
      acc: 'Where he ranked in the whole NFL in a counting stat: r is the rank, s the stat.',
      inj: 'This week\'s injury report, season in progress only: st the status, inj the injury, wk the week.',
      draft: 'Round, overall pick, year and team. udfa: true means he went undrafted.',
    },
    extras: {
      comps: 'Statistical Comps: the closest profiles among qualified players at his position that season, by the position\'s headline stats. [id, percent match]; the id is another player in the same season file.',
      wflaws: 'Where he ranks worst: [stat key, percentile among qualified players at his position that season], below the 40th only, worst first.',
      wcomps: 'Weakness Comps: the qualified players at his position who share his flaws. [id, percent match]. At or under weakness.lowMatch the page says nobody really shares the profile.',
    },
    season: {
      allSavant: 'The All-Savant Team, [1st team, 2nd team], as the page picks it: { off, def, st, line }. Each pick is { slot, id, name, team, by, v }: by "value" means picked on Savant value (v, the stat sav), "score" on the profile score (seasons with no value), "line" as one of the best line\'s five starters (before 2016; line has the unit\'s numbers), "returns" on yards and EPA per return (returns has them). Nobody is on both teams, except that a returner can also hold a position spot. While a season is being played it is a standing, not an honour.',
      teams: 'Every team that season, by code: { g, rec, coach, stats, line, roster }. stats: by teamStats key, [value, rank (1 is best), teams ranked, percentile]; for sd and so (schedule) 1st is the hardest slate. line: the offensive line\'s grade, its rank and how many lines. roster: everyone who took a snap or recorded a stat for the team, in the page\'s order (unit, then position, the line left to right), with spot (depth-chart spot in words, where it agrees with his position), snap (snap share, %), score (profile score, qualified players only), st (roster status) and now (the team he finished with, when that is another).',
      week: 'Set while the season is being played: the numbers run through this week.',
      weekPlaying: 'Set when a later week is under way.',
      pools: 'Qualified players at each position that season.',
      notYet: 'Stats the era tracks but nobody in this season has yet. Some charting is published a season at a time, after it ends.',
    },
  }

  // The index is the one file every question loads, so it is kept lean: arrays rather than
  // objects, years as numbers, and the rare list of missed seasons only where there is one.
  const have = new Set(merged.seasons)
  const cols = ['id', 'name', 'pos', 'team', 'from', 'to', 'seasons', 'peak', 'skip']
  const players = {
    schema: SCHEMA,
    generated: merged.generated,
    count: index.size,
    note: 'One row per player, as arrays in the order of cols. pos and team are from his most recent season (to). from and to are the first and last seasons he appears in and seasons is how many. peak is his best qualified season by profile score (0 if he never had one). skip, present only when needed, lists the seasons in between with no stats.',
    cols,
    players: [...index.values()].map((r) => {
      const mine = new Set(r.all)
      const skip = []
      for (let y = +r.from + 1; y < +r.to; y++) if (have.has(String(y)) && !mine.has(String(y))) skip.push(y)
      const row = [r.id, r.name, r.pos, r.team, +r.from, +r.to, r.all.length, r.peak ? +r.peak : 0]
      if (skip.length) row.push(skip)
      return row
    }),
  }

  const careers = {
    where: { schema: SCHEMA, generated: merged.generated, note: 'Players whose career is filed under another position than his latest season\'s (the position he played most, by games): id -> position.', where: careerWhere },
    files: Object.fromEntries(Object.entries(careerFiles).map(([pos, rows]) => [pos, {
      schema: SCHEMA, generated: merged.generated, pos, pool: rows.filter((r) => r.qualified).length, players: rows,
    }])),
  }
  return { meta, players, seasons, careers }
}

// ---- writing -------------------------------------------------------------------------

const commas = (n) => Number(n).toLocaleString('en-US')

export function writeFootballApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, 'football-savant-data.json')
  const currentFile = path.join(publicDir, 'football-savant-current.json')
  const pageFile = path.join(publicDir, PAGE)
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error(`football-savant-data.json or ${PAGE} is missing from public/`)

  // The page carries on without the current file, so this does too.
  let current = null
  if (existsSync(currentFile)) {
    try { current = JSON.parse(readFileSync(currentFile, 'utf8')) } catch { current = null }
  }
  const out = buildFootballApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    current,
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = [
    ['meta.json', Buffer.from(JSON.stringify(out.meta))],
    ['players.json', Buffer.from(JSON.stringify(out.players))],
  ]
  let raw = 0
  let rows = 0
  for (const [season, body] of Object.entries(out.seasons)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    rows += body.players.length
    files.push([`seasons/${season}.json.gz`, gzipSync(json, { level: 9 })])
  }
  // careers: one file per position (a career is ranked among careers at its position), and
  // the few whose career position is not their latest season's
  files.push(['careers/where.json', Buffer.from(JSON.stringify(out.careers.where))])
  for (const [pos, body] of Object.entries(out.careers.files)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push([`careers/${pos}.json.gz`, gzipSync(json, { level: 9 })])
  }

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'seasons'), { recursive: true })
  mkdirSync(path.join(root, 'careers'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const live = out.meta.live ? `, ${out.meta.live.season} through week ${out.meta.live.week}` : ''
  return {
    files: files.length,
    raw,
    bytes,
    summary: `${commas(out.players.count)} players, ${commas(rows)} player-seasons, ${Object.keys(out.seasons).length} seasons${live}`,
  }
}
