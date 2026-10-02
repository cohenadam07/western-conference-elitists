// The percentile maths behind Basketball Savant, without the browser.
//
// public/basketball-savant.html works every number out in the reader's browser, which is why
// search engines and link-preview bots see a page with no players on it. The player pages
// (scripts/lib/player-pages.mjs) and the weekly snapshot (scripts/savant-snapshot.mjs) need the
// same numbers at build time, so this file mirrors the page's rules exactly:
//
//   pool      qualified players in that season; "position" narrows it to the same Guard/Wing/Big
//   rank      midrank percentile (ties count half), flipped for lower-is-better stats
//   display   rounded, clamped to 1..99
//   hidden    a stat the era didn't track (tier) or the player has no value for
//
// The metric list, labels, award codes and position overrides are READ OUT OF THE PAGE rather
// than copied here, so a stat added to the tool shows up on the player pages by itself.
// `npm run check:players` runs the page's own functions against this file and fails on any
// difference — run it after touching the percentile code on either side.

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

export const BASES = ['league', 'position']

// ---------------------------------------------------------------- reading the page's config

function grab(html, re, what) {
  const m = html.match(re)
  if (!m) throw new Error(`savant-core: could not find ${what} in basketball-savant.html`)
  return m[0]
}

/** Pull the inline config out of the hand-built page. Throws if the page's shape has changed. */
export function loadPageConfig(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8')
  const start = html.search(/const CFG\s*=/)
  const end = html.indexOf('function _norm(')
  if (start < 0 || end < 0 || end < start) throw new Error('savant-core: CFG block not found in basketball-savant.html')
  const src = [
    html.slice(start, end), // CFG, AWARDS, POS_FIX_ID, POS_FIX_NAME
    grab(html, /const ACC_ORDER=\[[\s\S]*?\];/, 'ACC_ORDER'),
    grab(html, /const ACC_MAJOR=\{[\s\S]*?\};/, 'ACC_MAJOR'),
    grab(html, /const ACC_SHORT=\{[\s\S]*?\};/, 'ACC_SHORT'),
    grab(html, /const PEAK_MIN_GP=\d+;/, 'PEAK_MIN_GP'),
    grab(html, /const PEAK_MIN_SHARE=\d+;/, 'PEAK_MIN_SHARE'),
    ';({CFG,AWARDS,POS_FIX_ID,POS_FIX_NAME,ACC_ORDER,ACC_MAJOR,ACC_SHORT,PEAK_MIN_GP,PEAK_MIN_SHARE})',
  ].join('\n')
  const cfg = vm.runInNewContext(src, {}, { timeout: 5000 })
  if (!cfg.CFG || !Array.isArray(cfg.CFG.metrics) || !cfg.CFG.metrics.length) throw new Error('savant-core: CFG.metrics is empty')
  return cfg
}

// ---------------------------------------------------------------- small helpers (same as the page)

export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const miss = (v) => v == null || (typeof v === 'number' && !isFinite(v))
export const val = (p, k, w = 'season') => { const c = p.m && p.m[k] && p.m[k][w]; return c ? c.v : null }
export const smpl = (p, k, w = 'season') => { const c = p.m && p.m[k] && p.m[k][w]; return c ? c.n : null }
export const seasonTier = (s) => { const y = +String(s).slice(0, 4); return y >= 2016 ? 4 : y >= 2013 ? 3 : y >= 1996 ? 2 : 1 }
export const word = (p) => (p >= 82 ? 'elite' : p >= 62 ? 'high' : p >= 40 ? 'avg' : 'low')
export const inFt = (n) => { if (miss(n)) return '—'; const f = Math.floor(n / 12); return f + "'" + Math.round(n - f * 12) + '"' }

export function ordinal(n) {
  const t = n % 100
  if (t >= 11 && t <= 13) return n + 'th'
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
}

/** The value column, formatted exactly as the tool prints it. */
export function fmt(unit, v, pct) {
  if (miss(v)) return '—'
  switch (unit) {
    case 'pct3': return '.' + String(Math.round(v * 1000)).padStart(3, '0')
    case 'pct1': return (+v).toFixed(1) + '%'
    case 'num1': return (+v).toFixed(1)
    case 'num2': return (+v).toFixed(2)
    case 'num3': return (v < 0 ? '−' : '') + Math.abs(+v).toFixed(3).replace(/^0/, '')
    case 'num0': return String(Math.round(v))
    case 'sgn': return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'
    case 'word': return pct == null ? '—' : word(pct)
    case 'wnum': return pct == null ? (+v).toFixed(1) : word(pct) + ' (' + (+v).toFixed(1) + ')'
    case 'wsgn': { const s = (v >= 0 ? '+' : '−') + Math.abs(+v).toFixed(1); return pct == null ? s : word(pct) + ' (' + s + ')' }
    case 'ftin': return inFt(v)
    case 'lb': return String(Math.round(v))
    case 'sec': return (+v).toFixed(1) + 's'
    case 'inch': return (+v).toFixed(1) + '"'
  }
  return String(v)
}

/** Blue → grey → red, the tool's percentile ramp. */
export function colorAt(p) {
  const LO = [28, 78, 134], MID = [194, 192, 182], HI = [188, 58, 44]
  const mix = (a, b, u) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * u))
  const t = Math.max(0, Math.min(100, p)) / 100
  const c = t < 0.5 ? mix(LO, MID, t / 0.5) : mix(MID, HI, (t - 0.5) / 0.5)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// ---------------------------------------------------------------- the engine

function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid } return lo }
function upperBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid } return lo }

/** Midrank percentile against a SORTED pool: unclamped, unrounded. null when the pool is too thin. */
export function pctRaw(v, sorted, lower) {
  const n = sorted.length
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return lower ? 100 - pct : pct
}
export function pctOf(v, sorted, lower) {
  const pct = pctRaw(v, sorted, lower)
  return pct == null ? null : Math.max(1, Math.min(99, Math.round(pct)))
}

/**
 * Wrap the parsed savant-data.json. `cfg` comes from loadPageConfig().
 * Applies the page's position overrides to the rows in place, as the page does on load.
 */
export function createEngine(DATA, cfg) {
  const { CFG, AWARDS, POS_FIX_ID, POS_FIX_NAME, ACC_ORDER, ACC_MAJOR, ACC_SHORT, PEAK_MIN_GP, PEAK_MIN_SHARE } = cfg
  if (!DATA.seasons) { // the old single-season shape the page still accepts
    const s = DATA.season || 'current'
    DATA = { seasons: [s], source: DATA.source, generated: DATA.generated, data: { [s]: { players: DATA.players || [] } } }
  }
  const seasons = DATA.seasons // newest first
  const metrics = CFG.metrics
  const metricBy = Object.fromEntries(metrics.map((m) => [m.key, m]))
  const playersOf = (s) => (DATA.data[s] || { players: [] }).players || []

  for (const s of seasons) for (const p of playersOf(s)) {
    const fix = POS_FIX_ID[p.id] || POS_FIX_NAME[norm(p.name)]
    if (fix) p.pos = fix
  }

  // id -> { id, name, rows{season:row}, seasons[] newest-first, newest, oldest }
  const index = new Map()
  for (const s of seasons) for (const p of playersOf(s)) {
    let e = index.get(p.id)
    if (!e) { e = { id: p.id, name: p.name, rows: {}, seasons: [] }; index.set(p.id, e) }
    if (!e.rows[s]) { e.rows[s] = p; e.seasons.push(s) }
  }
  for (const e of index.values()) { e.newest = e.seasons[0]; e.oldest = e.seasons[e.seasons.length - 1] }

  const pools = new Map()
  function pool(season, key, basis, pos) {
    const id = season + '|' + key + '|' + (basis === 'position' ? pos : '*')
    let a = pools.get(id)
    if (!a) {
      const out = []
      for (const p of playersOf(season)) {
        if (!p.qualified) continue
        if (basis === 'position' && p.pos !== pos) continue
        const v = val(p, key)
        if (!miss(v)) out.push(v)
      }
      a = Float64Array.from(out).sort()
      pools.set(id, a)
    }
    return a
  }
  const qualifiedCount = (season, pos) => playersOf(season).reduce((n, p) => n + (p.qualified && (!pos || p.pos === pos) ? 1 : 0), 0)

  /** Is this stat shown for this player-season? (Same rule as the tool's bars.) */
  const shown = (row, season, m) => !((m.tier && seasonTier(season) < m.tier) || miss(val(row, m.key)))

  /** Displayed percentile (1..99) or null. basis: 'league' | 'position'. */
  function pct(row, season, key, basis = 'league') {
    const m = metricBy[key]
    if (!m || !shown(row, season, m)) return null
    return pctOf(val(row, key), pool(season, key, basis, row.pos), m.lower)
  }

  /** Every visible stat for one player-season: value, both percentiles, sample flag. */
  function profile(row, season) {
    const out = []
    for (const m of metrics) {
      if (!shown(row, season, m)) continue
      const v = val(row, m.key)
      const league = pctOf(v, pool(season, m.key, 'league'), m.lower)
      const position = pctOf(v, pool(season, m.key, 'position', row.pos), m.lower)
      const n = smpl(row, m.key)
      out.push({ key: m.key, label: m.label, group: m.group, sub: m.sub, layer: m.layer, unit: m.unit, v, n, league, position, stable: n == null || (m.thr ? n >= m.thr : true), text: fmt(m.unit, v, league) })
    }
    return out
  }

  // Career-best season: highest BPM among seasons that clear the games floor. Same as the tool's ribbon.
  function peakEligible(row) {
    if (!row || !row.qualified) return false
    const gp = smpl(row, 'avail'), share = val(row, 'avail')
    return (!miss(gp) && gp >= PEAK_MIN_GP) || (!miss(share) && share >= PEAK_MIN_SHARE)
  }
  function peakSeason(id) {
    const e = index.get(id)
    if (!e) return null
    let peak = null
    for (const s of [...e.seasons].reverse()) { // oldest -> newest, first of equals wins
      const row = e.rows[s]
      if (!peakEligible(row)) continue
      const b = val(row, 'bpm')
      if (!miss(b) && (!peak || b > peak.b)) peak = { season: s, b }
    }
    return peak ? peak.season : null
  }

  /** Season honours in prestige order, as [{ code, short, full, major }]. */
  function accolades(id, season) {
    const by = AWARDS && AWARDS.players && AWARDS.players[String(id)]
    const got = by && by[season]
    if (!got || !got.length) return []
    const codes = ACC_ORDER.filter((c) => got.includes(c)).concat(got.filter((c) => !ACC_ORDER.includes(c)))
    return codes.map((c) => ({ code: c, short: ACC_SHORT[c] || c, full: (AWARDS.labels && AWARDS.labels[c]) || ACC_SHORT[c] || c, major: !!ACC_MAJOR[c] }))
  }

  return {
    DATA, CFG, seasons, metrics, metricBy, index, playersOf,
    pool, qualifiedCount, shown, pct, profile, peakSeason, accolades,
    generated: DATA.generated || null,
  }
}

// ---------------------------------------------------------------- player URLs

const FOLD = { ð: 'd', đ: 'd', þ: 'th', ø: 'o', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i' }

/**
 * "Shai Gilgeous-Alexander" -> shai-gilgeous-alexander, "D'Angelo Russell" -> dangelo-russell,
 * "P.J. Tucker" -> pj-tucker. Written without modern syntax: the same text is shipped to the
 * browser (player-links.client.js) so the tool and the build can never disagree on a URL.
 */
export function slugify(name) {
  var s = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  s = s.replace(/[ðđþøłßæœı]/g, function (c) { return FOLD[c] || c })
  s = s.replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'player'
}

/**
 * id -> slug for every player. When two players share a name, the one who debuted first keeps
 * the plain slug and the others get their debut year (glen-rice, glen-rice-2013), so a URL that
 * exists today keeps pointing at the same man when a namesake enters the league later.
 */
export function assignSlugs(engine) {
  const groups = new Map()
  for (const e of engine.index.values()) {
    const s = slugify(e.name)
    if (!groups.has(s)) groups.set(s, [])
    groups.get(s).push(e)
  }
  const out = new Map()
  const taken = new Set()
  const debut = (e) => +String(e.oldest).slice(0, 4)
  for (const [base, list] of groups) {
    list.sort((a, b) => debut(a) - debut(b) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))
    list.forEach((e, i) => {
      let s = i === 0 ? base : `${base}-${debut(e)}`
      if (taken.has(s) || groups.has(s) && s !== base) s = `${base}-${String(e.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
      taken.add(s)
      out.set(e.id, s)
    })
  }
  return out
}
