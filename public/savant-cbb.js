/* savant-cbb.js — College Basketball Savant's arithmetic: one copy, for the page and the connector.
   The page loads it with a script tag; api/_cbb.js and tools/savant-cbb/check.mjs import it. Every
   percentile on the site comes from pct() over pool(), so a connector answer cannot disagree with
   the card. Percentiles use Basketball Savant's rule: 100 × (below + half of ties) ÷ n. */
(function (root, factory) {
  root.SavantCBB = factory()
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'
  const COL = { id: 0, name: 1, team: 2, pos: 3, cls: 4, age: 5, ht: 6, wt: 7, gp: 8, gs: 9, min: 10, qual: 11, conf: 12, head: 13, jersey: 14, home: 15, stars: 16, rrank: 17, hs: 18 }
  const ok = (v) => v !== null && v !== undefined && Number.isFinite(+v)

  function pct(values, v, lower) {
    if (!ok(v) || !values.length) return null
    let less = 0, eq = 0
    for (const x of values) { if (x < v) less++; else if (x === v) eq++ }
    const p = 100 * (less + 0.5 * eq) / values.length
    return Math.max(1, Math.min(99, Math.round(lower ? 100 - p : p)))
  }

  /* Which array of a stat. Adjusted where the stat has one, garbage time in or out. */
  function column(doc, key, { adj = true, gt = false } = {}) {
    const c = doc.values[key]
    if (!c) return null
    if (adj && c.a) return gt ? (c.ag || c.a) : c.a
    return gt ? (c.rg || c.r) : c.r
  }
  const hasAdj = (doc, key) => !!(doc.values[key] && doc.values[key].a)

  const POOLS = { pos: 'position', all: 'all', hm: 'high-major', conf: 'conference', age: 'age' }
  const plural = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }

  /* The qualified players a percentile is against. A pool under the floor widens, and says so. */
  function pool(doc, reg, i, name) {
    const P = doc.players, me = P[i]
    const qual = []
    for (let j = 0; j < P.length; j++) if (P[j][COL.qual]) qual.push(j)
    const f = {
      all: () => true,
      pos: (j) => P[j][COL.pos] === me[COL.pos],
      hm: (j) => reg.high_major.includes(String(P[j][COL.conf])),
      conf: (j) => P[j][COL.conf] === me[COL.conf],
      age: (j) => ok(me[COL.age]) && ok(P[j][COL.age]) && Math.abs(P[j][COL.age] - me[COL.age]) <= 0.5,
    }
    let ids = qual.filter(f[name] || f.pos)
    let used = name
    if (name === 'age' && !ok(me[COL.age])) return { ids: qual.filter(f.pos), name: 'pos', widened: 'no birthdate on file, so no same-age pool' }
    if (ids.length < reg.min_pool) {
      const wider = name === 'pos' ? 'all' : 'pos'
      ids = qual.filter(f[wider]); used = wider
      return { ids, name: used, widened: `only ${qual.filter(f[name] || f.pos).length} players in that pool, so widened` }
    }
    return { ids, name: used, widened: null }
  }

  function poolLabel(pool_, player, { adj, season, conf }) {
    const pos = plural[player[COL.pos]] || 'players'
    const who = { pos: `D1 ${pos}`, all: 'all D1 players', hm: 'high-major players', conf: `${conf || 'conference'} players`, age: 'D1 players within half a year of age' }[pool_.name]
    return `vs ${who}, ${adj ? 'opponent-adjusted' : 'raw'}, ${season}`
  }

  function valuesFor(doc, key, ids, o) {
    const c = column(doc, key, o)
    if (!c) return []
    const out = []
    for (const j of ids) if (ok(c[j])) out.push(+c[j])
    return out
  }

  /* The settle estimate: (n x + k prior) / (n + k). The prior is the position's mean, or for 3P%
     the fit on FT% and three-point rate (settle.py). */
  function likely(doc, reg, stat, i, ids, o) {
    if (!stat.k || !stat.sample) return null
    const c = column(doc, stat.key, o), s = doc.samples[stat.sample]
    if (!c || !s || !ok(c[i]) || !ok(s[i])) return null
    const n = +s[i]
    if (n >= stat.k) return null
    let prior
    if (stat.key === 'fg3' && reg.three_prior) {
      const ft = (doc.values.ft && doc.values.ft.r[i]), tp = (doc.values.tpar && doc.values.tpar.r[i])
      prior = 100 * (reg.three_prior[0] + reg.three_prior[1] * (ok(ft) ? ft / 100 : 0.7) + reg.three_prior[2] * (ok(tp) ? tp / 100 : 0.3))
    } else {
      const v = valuesFor(doc, stat.key, ids, o)
      prior = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    if (prior === null) return null
    return (n * +c[i] + stat.k * prior) / (n + stat.k)
  }

  function display(stat, v, per = 70) {
    if (!ok(v)) return null
    v = +v
    const sg = (d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(d))
    switch (stat.unit) {
      case 'pct1': return v.toFixed(1) + '%'
      case 'per': return (v * per).toFixed(1)
      case 'num1': return v.toFixed(1)
      case 'num2': return v.toFixed(2)
      case 'sgn1': return sg(1)
      default: return String(v)
    }
  }

  /* One stat for one player: everything a row on the card shows. */
  function row(doc, reg, stat, i, o) {
    const { poolName = 'pos', adj = true, gt = false, per = 70 } = o || {}
    const pl = pool(doc, reg, i, poolName)
    const v = (column(doc, stat.key, { adj, gt }) || [])[i]
    const started = doc.season >= stat.start
    if (!started || !ok(v)) return { key: stat.key, tracked: false, reason: started ? 'no value' : `not tracked before ${stat.start}`, pool: pl }
    const nArr = stat.sample ? doc.samples[stat.sample] : null
    const n = nArr ? nArr[i] : null
    const min = stat.key.startsWith('rapm') ? reg.rapm_min : 0
    if (min && (!ok(n) || n < min)) return { key: stat.key, tracked: true, low: true, value: +v, shown: display(stat, v, per), pool: pl, n, reason: 'low sample' }
    const refIds = min ? pl.ids.filter((j) => (nArr[j] || 0) >= min) : pl.ids
    const vals = valuesFor(doc, stat.key, refIds, { adj, gt })
    const p = pct(vals, +v, stat.lower)
    let raw = null
    if (adj && hasAdj(doc, stat.key)) raw = pct(valuesFor(doc, stat.key, refIds, { adj: false, gt }), +column(doc, stat.key, { adj: false, gt })[i], stat.lower)
    const l = likely(doc, reg, stat, i, refIds, { adj, gt })
    return { key: stat.key, tracked: true, value: +v, shown: display(stat, v, per), pct: p, raw, n, poolN: vals.length, pool: pl, settling: l !== null, likely: l, likelyShown: l === null ? null : display(stat, l, per), likelyPct: l === null ? null : pct(vals, l, stat.lower) }
  }

  /* With/Without: a team's fives, summed over any men on or off. On a line by possessions, net of
     opponents' shooting luck when lg3 and lgft are given. fives rows: [ids, sec, poss, opp poss,
     pts, opp pts, opp 3PA, opp 3PM, opp FTA, opp FTM]. */
  function withWithout(fives, withIds, withoutIds) {
    const t = { sec: 0, p: 0, q: 0, pts: 0, opts: 0 }
    for (const f of fives) {
      const ids = f[0]
      if (!withIds.every((a) => ids.includes(a))) continue
      if (withoutIds.some((a) => ids.includes(a))) continue
      t.sec += f[1]; t.p += f[2]; t.q += f[3]; t.pts += f[4]; t.opts += f[5]
    }
    const ortg = t.p ? 100 * t.pts / t.p : null, drtg = t.q ? 100 * t.opts / t.q : null
    return { min: t.sec / 60, poss: t.p, ortg, drtg, net: ortg === null || drtg === null ? null : ortg - drtg }
  }

  return { COL, ok, pct, column, hasAdj, POOLS, pool, poolLabel, valuesFor, likely, display, row, withWithout }
})
