/* savant-cfb.js — College Football Savant's arithmetic: one copy, for the page and the connector.
   The page loads it with a script tag; api/_cfb.js and tools/savant-cfb/check.mjs import it. Every
   percentile on the site comes from pct() over pool(), so a connector answer cannot disagree with
   the card. Percentiles use Basketball Savant's rule: 100 × (below + half of ties) ÷ n, and are
   always within one season: eras are never pooled. */
(function (root, factory) {
  root.SavantCFB = factory()
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'
  const COL = { id: 0, name: 1, team: 2, slot: 3, cls: 4, jersey: 5, gp: 6, qual: 7, ht: 8, wt: 9, fr: 10, inferred: 11, head: 12, pos: 13 }
  const TCOL = { id: 0, school: 1, abbr: 2, conf: 3, w: 4, l: 5, cw: 6, cl: 7, rating: 8, off: 9, def: 10, st: 11, resume: 12, resume_rank: 13, sos: 14, talent: 15, talent_rank: 16, ret_off: 17, ret_def: 18, coach: 19, games: 20, rating_rank: 21 }
  const SCOL = { gid: 0, date: 1, week: 2, stype: 3, opp: 4, site: 5, conf: 6, final: 7, pf: 8, pa: 9, wp: 10, opp_rank: 11, opp_name: 12 }
  const SLOT_TABLE = { QB: 'qb', RB: 'rush', WR: 'rec', TE: 'rec', EDGE: 'dfn', IDL: 'dfn', LB: 'dfn', CB: 'dfn', S: 'dfn', K: 'kick', P: 'punt' }
  const ok = (v) => v !== null && v !== undefined && Number.isFinite(+v)

  function pct(values, v, lower) {
    if (!ok(v) || !values.length) return null
    let less = 0, eq = 0
    for (const x of values) { if (x < v) less++; else if (x === v) eq++ }
    const p = 100 * (less + 0.5 * eq) / values.length
    return Math.max(1, Math.min(99, Math.round(lower ? 100 - p : p)))
  }

  /* A stat's arrays cover only the slots that have it: `o<tag>` is the index of the first player. */
  function tagFor(c, { adj = true, gt = false } = {}) {
    if (!c) return null
    if (adj && c.a) return gt && c.ag ? 'ag' : 'a'
    return gt && c.rg ? 'rg' : 'r'
  }
  function val(doc, key, i, o) {
    const c = doc.values[key], t = tagFor(c, o)
    if (!t || !c[t]) return null
    const v = c[t][i - c['o' + t]]
    return ok(v) ? +v : null
  }
  const hasAdj = (doc, key) => !!(doc.values[key] && doc.values[key].a)
  function sample(doc, name, i, gt) {
    const s = (gt && doc.samples[name + '_g']) || doc.samples[name]
    if (!s) return null
    const v = s.v[i - s.o]
    return ok(v) ? +v : null
  }
  const confOf = (doc, j) => { const t = doc.teams[String(doc.players[j][COL.team])]; return t ? t[2] : null }
  const tracked = (stat, season) => season >= stat.start && !(stat.off || []).includes(season)

  /* 1.1.0: the returner pool. Anyone whose returns reach the qualifier (scaled to the season so far), whatever his slot. */
  function retPool(doc, reg) {
    if (doc._ret) return doc._ret
    const q = (reg.qual && reg.qual.RET) || ['returns', 12], need = q[1] * (doc.scale || 1), ids = []
    for (let j = 0; j < doc.players.length; j++) { const n = sample(doc, q[0], j, false); if (n !== null && n >= need) ids.push(j) }
    doc._ret = { ids, name: 'ret', widened: ids.length < reg.min_pool ? `only ${ids.length} qualified returners so far` : null }
    return doc._ret
  }
  const isRet = (stat) => !!stat && (stat.slots || []).includes('RET')

  /* The qualified players a percentile is against. A pool under the floor widens, and says so. */
  function pool(doc, reg, i, name) {
    const P = doc.players, me = P[i], slot = me[COL.slot], myConf = confOf(doc, i)
    const qual = []
    for (let j = 0; j < P.length; j++) if (P[j][COL.qual]) qual.push(j)
    const wide = reg.wider[slot]
    const f = {
      pos: (j) => P[j][COL.slot] === slot,
      p4: (j) => P[j][COL.slot] === slot && reg.power4.includes(confOf(doc, j)),
      conf: (j) => P[j][COL.slot] === slot && confOf(doc, j) === myConf,
      wide: (j) => reg.wider[P[j][COL.slot]] === wide,
    }
    name = f[name] && name !== 'wide' ? name : 'pos'
    let ids = qual.filter(f[name])
    if (ids.length >= reg.min_pool) return { ids, name, widened: null }
    const first = ids.length
    if (name !== 'pos') {
      ids = qual.filter(f.pos)
      if (ids.length >= reg.min_pool) return { ids, name: 'pos', widened: `only ${first} qualified players in that pool, so widened to all of FBS at the position` }
    }
    if (wide) {
      const w = qual.filter(f.wide)
      if (w.length > ids.length) return { ids: w, name: 'wide', widened: `only ${first} qualified players in that pool, so widened to ${reg.wider_name[wide]}` }
    }
    return { ids, name: 'pos', widened: ids.length < reg.min_pool ? `only ${ids.length} qualified players so far` : null }
  }

  function poolLabel(pool_, player, { adj, season, conf, reg }) {
    const slot = player[COL.slot]
    if (pool_.name === 'ret') return `vs FBS returners, raw, ${season}`
    const who = pool_.name === 'wide' ? reg.wider_name[reg.wider[slot]] : (reg.slot_name[slot] || 'players')
    const where = { pos: 'FBS', wide: 'FBS', p4: 'Power 4', conf: conf || 'conference' }[pool_.name]
    return `vs ${where} ${who}, ${adj ? 'opponent-adjusted' : 'raw'}, ${season}`
  }

  function valuesFor(doc, key, ids, o) {
    const c = doc.values[key], t = tagFor(c, o)
    if (!t || !c[t]) return []
    const a = c[t], off = c['o' + t], out = []
    for (const j of ids) { const v = a[j - off]; if (ok(v)) out.push(+v) }
    return out
  }

  /* The settle estimate: (n x + k prior) / (n + k), the prior being the pool's mean. */
  function likely(doc, stat, i, ids, o) {
    if (!stat.k || !stat.sample) return null
    const v = val(doc, stat.key, i, o), n = sample(doc, stat.sample, i, o.gt)
    if (v === null || n === null || n >= stat.k) return null
    const vs = valuesFor(doc, stat.key, ids, o)
    if (!vs.length) return null
    const prior = vs.reduce((a, b) => a + b, 0) / vs.length
    return (n * v + stat.k * prior) / (n + stat.k)
  }

  function display(stat, v) {
    if (!ok(v)) return null
    v = +v
    const sg = (d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(d))
    switch (stat.unit) {
      case 'epa': return sg(3)
      case 'pct1': return v.toFixed(1) + '%'
      case 'pct2': return v.toFixed(2) + '%'
      case 'per100': return v.toFixed(2)
      case 'num1': return v.toFixed(1)
      case 'num2': return v.toFixed(2)
      case 'sgn1': return sg(1)
      case 'sgn2': return sg(2)
      case 'wpa': return sg(2)
      case 'tot': return sg(1)
      case 'tot0': return String(Math.round(v))
      default: return String(v)
    }
  }

  /* One stat for one player: everything a row on the card shows. */
  function row(doc, reg, stat, i, o) {
    const { poolName = 'pos', adj = true, gt = false } = o || {}
    const pl = isRet(stat) ? retPool(doc, reg) : pool(doc, reg, i, poolName)
    if (!tracked(stat, doc.season)) {
      const reason = doc.season < stat.start ? `not tracked before ${stat.start}` : `not tracked in ${doc.season}`
      return { key: stat.key, tracked: false, reason, pool: pl }
    }
    const v = val(doc, stat.key, i, { adj, gt })
    if (v === null) return { key: stat.key, tracked: true, none: true, reason: 'no plays of this kind', pool: pl }
    const n = stat.sample ? sample(doc, stat.sample, i, gt) : null
    const vals = valuesFor(doc, stat.key, pl.ids, { adj, gt })
    const p = pct(vals, v, stat.lower)
    let raw = null
    if (adj && hasAdj(doc, stat.key)) raw = pct(valuesFor(doc, stat.key, pl.ids, { adj: false, gt }), val(doc, stat.key, i, { adj: false, gt }), stat.lower)
    const l = likely(doc, stat, i, pl.ids, { adj, gt })
    return {
      key: stat.key, tracked: true, value: v, shown: display(stat, v), pct: p, raw, n, poolN: vals.length, pool: pl,
      settling: l !== null, hatched: stat.verdict === 'hatched' || l !== null, context: stat.verdict === 'context',
      likely: l, likelyShown: l === null ? null : display(stat, l), likelyPct: l === null ? null : pct(vals, l, stat.lower),
    }
  }

  const statsFor = (reg, slot) => reg.stats.filter((s) => s.slots.includes(slot))
  /* The card's groups for a slot, in order (1.1.0), each with its stats. */
  const cardKey = (slot) => (['EDGE', 'IDL', 'LB', 'CB', 'S'].includes(slot) ? 'D' : slot)
  function cardGroups(reg, slot) {
    const st = statsFor(reg, slot), order = (reg.card_groups && reg.card_groups[cardKey(slot)]) || reg.groups
    return order.map((g) => ({ group: g, stats: st.filter((s) => (s.cgroup || s.group) === g) })).filter((x) => x.stats.length)
  }
  /* The five headline stats of a slot (Football Savant's profile score is their mean percentile). */
  function headline(reg, slot) {
    const h = reg.headline || {}, n = { EDGE: 'dl', IDL: 'dl', LB: 'lb' }[slot]
    const keys = slot === 'CB' || slot === 'S' ? h.DB : n ? (h.D || []).map((k) => k.replace('{p}', n)) : h[slot]
    const by = {}; for (const s of reg.stats) by[s.key] = s
    return (keys || []).map((k) => by[k]).filter(Boolean)
  }
  function profile(doc, reg, i, o) {
    const slot = doc.players[i][COL.slot], ps = []
    for (const s of headline(reg, slot)) { const r = row(doc, reg, s, i, o); if (r.tracked && !r.none && r.pct !== null) ps.push(r.pct) }
    return ps.length >= 3 ? { score: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length), n: ps.length } : null
  }

  /* Savant value: (shrunk rate − replacement rate) × volume, from the stored parts. */
  function valueLine(doc, i) {
    const V = doc.value, v = V.v[i]
    if (!ok(v)) return null
    const P = doc.players, slot = P[i][COL.slot]
    let rank = null, of = 0
    if (P[i][COL.qual]) {
      rank = 1
      for (let j = 0; j < P.length; j++) {
        if (!P[j][COL.qual] || P[j][COL.slot] !== slot || !ok(V.v[j])) continue
        of++
        if (V.v[j] > v) rank++
      }
    }
    return { value: +v, rate: V.rate[i], replacement: V.repl[slot] ?? null, volume: V.n[i], returns: V.ret[i] || 0, rank, of }
  }
  const recompute = (l) => (l.rate - l.replacement) * l.volume

  /* Totals over a set of game-log rows, and the line a split or a career row shows. */
  function total(rows, cols) {
    const t = {}
    cols.forEach((c, k) => { t[c] = 0; for (const r of rows) t[c] += +r[k + 1] || 0 })
    if (cols.includes('long')) t.long = rows.reduce((m, r) => Math.max(m, +r[cols.indexOf('long') + 1] || 0), 0)
    t.g = rows.length
    return t
  }
  const div = (a, b) => (b > 0 ? a / b : null)
  function line(table, t) {
    const f = (v, d = 1) => (v === null ? '—' : v.toFixed(d)), s = (v, d = 2) => (v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d))
    const pc = (a, b) => (b > 0 ? (100 * a / b).toFixed(1) + '%' : '—')
    switch (table) {
      case 'qb': return [['G', t.g], ['Cmp-Att', `${Math.round(t.cmp)}-${Math.round(t.att)}`], ['Cmp%', pc(t.cmp, t.att)], ['Yds', Math.round(t.yards)], ['Y/A', f(div(t.yards, t.att))], ['TD', Math.round(t.td)], ['INT', Math.round(t.ints)], ['Sacks', Math.round(t.sacks)], ['EPA/dropback', s(div(t.epa, t.db), 3)], ['Success', pc(t.succ, t.db)], ['Rush', `${Math.round(t.q_rush)} for ${Math.round(t.q_rush_yds)}`], ['Rush TD', Math.round(t.q_rush_td)]]
      case 'rush': return [['G', t.g], ['Rush', Math.round(t.rush)], ['Yds', Math.round(t.yards)], ['Y/R', f(div(t.yards, t.rush))], ['TD', Math.round(t.td)], ['EPA/rush', s(div(t.epa, t.rush), 3)], ['Success', pc(t.succ, t.rush)], ['Explosive', pc(t.expl, t.rush)], ['Stuffed', pc(t.stuff, t.rush)], ['Rec', Math.round(t.r_rec)], ['Rec yds', Math.round(t.r_yards)]]
      case 'rec': return [['G', t.g], ['Tgt', f(t.tgt_eff, 0)], ['Rec', Math.round(t.rec)], ['Yds', Math.round(t.yards)], ['Y/R', f(div(t.yards, t.rec))], ['TD', Math.round(t.td)], ['Yds/team att', f(div(t.yards, t.t_att), 2)], ['EPA/team dropback', s(div(t.epa_eff, t.t_db), 3)], ['Explosive', pc(t.expl, t.rec)]]
      case 'dfn': return [['G', t.g], ['Tkl', f(t.e_tkl, 0)], ['Sacks', f(t.e_sack)], ['TFL', f(t.e_tfl_all)], ['INT', f(t.int, 0)], ['PD', f(t.e_pd, 0)], ['FF', f(t.ff, 0)], ['Hurries', f(t.e_hur, 0)], ['Run stops', f(t.stop)], ['Disruptive per 100', f(div(100 * (t.e_tfl_all + t.e_pd + t.ff), t.dplays), 2)]]
      case 'kick': return [['G', t.g], ['FG', `${Math.round(t.made)}-${Math.round(t.fga)}`], ['FG%', pc(t.made, t.fga)], ['Long', Math.round(t.long || 0)], ['Over expected', s(t.fgoe)]]
      case 'punt': return [['G', t.g], ['Punts', Math.round(t.punts)], ['Avg', f(div(t.gross, t.punts))], ['Value over expected', s(div(t.poe, t.punts))]]
      default: return []
    }
  }

  /* Splits from a player's game log: site, conference, our top 25, month. rows[k][0] indexes sched. */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  function splits(rows, sched, cols, table) {
    const groups = [
      ['Home', (g) => g[SCOL.site] === 1], ['Road', (g) => g[SCOL.site] === -1], ['Neutral', (g) => g[SCOL.site] === 0],
      ['Conference', (g) => g[SCOL.conf] === 1], ['Non-conference', (g) => g[SCOL.conf] !== 1],
      ['vs our top 25', (g) => ok(g[SCOL.opp_rank]) && g[SCOL.opp_rank] <= 25],
    ]
    const months = [...new Set(rows.map((r) => +sched[r[0]][SCOL.date].slice(5, 7)))].sort((a, b) => ((a + 6) % 12) - ((b + 6) % 12))
    for (const m of months) groups.push([MONTHS[m - 1], (g) => +g[SCOL.date].slice(5, 7) === m])
    const out = []
    for (const [label, test] of groups) {
      const rs = rows.filter((r) => test(sched[r[0]]))
      if (!rs.length) continue
      const t = total(rs, cols)
      out.push({ label, games: rs.length, totals: t, line: line(table, t) })
    }
    return out
  }

  /* The nearest players at the same position and class, by the bars they share. */
  function comps(doc, reg, i, count = 5) {
    const P = doc.players, me = P[i], slot = me[COL.slot]
    if (!me[COL.qual]) return []
    const stats = statsFor(reg, slot).filter((s) => s.verdict !== 'context' && tracked(s, doc.season))
    const ids = []
    for (let j = 0; j < P.length; j++) if (P[j][COL.qual] && P[j][COL.slot] === slot) ids.push(j)
    const sameCls = ids.filter((j) => P[j][COL.cls] && P[j][COL.cls] === me[COL.cls])
    const cand = sameCls.length >= 8 ? sameCls : ids
    const pcts = (j) => stats.map((s) => { const v = val(doc, s.key, j, {}); return v === null ? null : pct(valuesFor(doc, s.key, ids, {}), v, s.lower) })
    const mine = pcts(i)
    const out = []
    for (const j of cand) {
      if (j === i) continue
      const p = pcts(j)
      let d = 0, n = 0
      for (let k = 0; k < p.length; k++) if (p[k] !== null && mine[k] !== null) { d += Math.abs(p[k] - mine[k]); n++ }
      if (n >= Math.max(2, Math.ceil(stats.length / 2))) out.push({ i: j, distance: d / n, shared: n })
    }
    out.sort((a, b) => a.distance - b.distance || P[a.i][COL.id] - P[b.i][COL.id])
    return out.slice(0, count).map((c) => ({ ...c, sameClass: cand === sameCls }))
  }

  /* Weakness comps (Football Savant's): qualified players at his position whose percentiles on HIS five lowest bars sit closest. */
  function weakComps(doc, reg, i, count = 5) {
    const P = doc.players, me = P[i], slot = me[COL.slot]
    if (!me[COL.qual]) return []
    const ids = []
    for (let j = 0; j < P.length; j++) if (P[j][COL.qual] && P[j][COL.slot] === slot) ids.push(j)
    const stats = statsFor(reg, slot).filter((s) => s.verdict !== 'context' && tracked(s, doc.season))
    const pc = (j, s) => { const v = val(doc, s.key, j, {}); return v === null ? null : pct(valuesFor(doc, s.key, ids, {}), v, s.lower) }
    const mine = stats.map((s) => [s, pc(i, s)]).filter((x) => x[1] !== null).sort((a, b) => a[1] - b[1] || (a[0].key < b[0].key ? -1 : 1)).slice(0, 5)
    if (mine.length < 3) return []
    const out = []
    for (const j of ids) {
      if (j === i) continue
      let d = 0, n = 0
      for (const [s, m] of mine) { const v = pc(j, s); if (v !== null) { d += Math.abs(v - m); n++ } }
      if (n >= 3) out.push({ i: j, distance: d / n, shared: n })
    }
    out.sort((a, b) => a.distance - b.distance || P[a.i][COL.id] - P[b.i][COL.id])
    return out.slice(0, count).map((c) => ({ ...c, on: mine.map((x) => x[0].key) }))
  }

  /* Teams: a stat's percentile among FBS teams that season, and its rank (1 = best). */
  function teamRow(doc, stat, i, adj) {
    const c = doc.values[stat.key]
    if (!c) return null
    const a = adj && c.a ? c.a : c.r, v = a[i]
    if (!ok(v)) return null
    const vals = a.filter(ok).map(Number)
    const better = vals.filter((x) => (stat.lower ? x < v : x > v)).length
    return { value: +v, shown: display(stat, v), pct: pct(vals, +v, stat.lower), rank: better + 1, of: vals.length, adjusted: !!(adj && c.a) }
  }

  /* A chance as text. Never "100%" or "0%" for something that has not happened. */
  const chance = (v) => (!ok(v) ? '—' : v >= 0.995 ? '>99%' : v < 0.005 ? '<1%' : Math.round(100 * v) + '%')

  const nth = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th') }

  return { COL, TCOL, SCOL, SLOT_TABLE, ok, pct, val, retPool, isRet, cardGroups, cardKey, headline, profile, weakComps, hasAdj, sample, confOf, tracked, pool, poolLabel, valuesFor, likely, display, row, statsFor, valueLine, recompute, total, line, splits, comps, teamRow, nth, chance, MONTHS }
})
