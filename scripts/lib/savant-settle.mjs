// Likely to settle: the page's settleEst() / settlePoolVals(), for the connector build.
//
// While a season is being played, a rate on a small sample is mostly noise. The estimate is
//     (n * x + k * prior) / (n + k)
// n his sample, x his number, k the sample the stat needs, prior his position's qualified
// average this season moved toward his own last season by how much of last season there was.
// k comes from the page's SETTLE_K (measured by ~/Basketball-Savant/settle_points.py), read
// out of the page so the two can never carry different numbers. Only for the season in
// progress, full season, and only while n < k. The estimate is ranked against everyone
// else's estimate. tools/savant-api/check.mjs runs the page's own functions against this.

import vm from 'node:vm'

/** SETTLE_K out of basketball-savant.html: { key: [k with no last season, k with one] }. */
export function readSettleK(html) {
  const m = html.match(/const SETTLE_K=(\{[^;]*\});/)
  if (!m) throw new Error('savant-settle: SETTLE_K not found in basketball-savant.html')
  return vm.runInNewContext(`(${m[1]})`)
}

const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))
const cell = (p, k) => (p.m && p.m[k] && p.m[k].season) || null
const prevOf = (season) => { const y = parseInt(season, 10) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}` }

/**
 * @param data  merged Savant data (seasons, data, current)
 * @param K     readSettleK(html)
 * @param posOf (player) -> position after the page's overrides
 */
export function makeSettle(data, K, posOf) {
  const live = data.current && data.current.season
  const cache = new Map()
  const rowsOf = (season) => (data.data[season] || { players: [] }).players || []

  function posStat(key, pos, season) {
    const ck = `p|${key}|${pos}|${season}`
    if (cache.has(ck)) return cache.get(ck)
    let sum = 0, n = 0, lo = Infinity, hi = -Infinity
    for (const p of rowsOf(season)) {
      if (!p.qualified || posOf(p) !== pos) continue
      const c = cell(p, key)
      const v = c ? c.v : null
      if (miss(v)) continue
      sum += v; n++; if (v < lo) lo = v; if (v > hi) hi = v
    }
    const out = n >= 5 ? { m: sum / n, lo, hi } : null
    cache.set(ck, out)
    return out
  }
  function rowFor(id, season) {
    const ck = `r|${season}`
    let m = cache.get(ck)
    if (!m) { m = new Map(rowsOf(season).map((p) => [p.id, p])); cache.set(ck, m) }
    return m.get(id)
  }
  function estimate(p, key, season) {
    const k2 = K[key]
    if (!k2 || season !== live) return null
    const c = cell(p, key)
    if (!c) return null
    const x = c.v, n = c.n
    if (miss(x) || n == null || !(n > 0)) return null
    const pos = posOf(p)
    const st = posStat(key, pos, season)
    if (!st) return null
    let prior = st.m, k = k2[0], last = null
    const prev = prevOf(season)
    const q = rowFor(p.id, prev)
    if (q && posOf(q) === pos) {
      const cl = cell(q, key)
      const sp = posStat(key, pos, prev)
      if (cl && !miss(cl.v) && cl.n > 0 && sp) {
        k = k2[1]
        prior = st.m + (cl.n / (cl.n + k)) * (Math.max(sp.lo, Math.min(sp.hi, cl.v)) - sp.m)
        last = { v: cl.v, n: cl.n }
      }
    }
    prior = Math.max(st.lo, Math.min(st.hi, prior))
    if (n >= k) return null
    return { v: (n * x + k * prior) / (n + k), n, k, prior, last }
  }
  /** Everyone's estimate (or number) among the qualified players: pos null = league. */
  function pool(key, season, pos) {
    const ck = `pool|${key}|${season}|${pos || '*'}`
    if (cache.has(ck)) return cache.get(ck)
    const out = []
    for (const p of rowsOf(season)) {
      if (!p.qualified) continue
      if (pos && posOf(p) !== pos) continue
      const e = estimate(p, key, season)
      const v = e ? e.v : (cell(p, key) || {}).v
      if (!miss(v)) out.push(v)
    }
    const sorted = Float64Array.from(out).sort()
    cache.set(ck, sorted)
    return sorted
  }
  return { live, estimate, pool }
}
