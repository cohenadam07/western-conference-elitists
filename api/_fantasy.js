// api/_fantasy.js — the Fantasy, Teams and Lineups tabs of Basketball Savant, as connector tools.
//
// Same files the page reads: savant-proj.json (projections, rebuilt every refresh),
// savant-teams.json + savant-teams-current.json and lineups/<season>.json (teams_engine.py),
// and the crowd Dynasty board (/api/dynasty). The math mirrors public/savant-fantasy.js line for
// line; tools/savant-api/check.mjs runs both on the same data and fails if they disagree.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, norm, origin } from './_core.js'

const TTL_MS = 10 * 60 * 1000
const cache = new Map()
async function getJson(path, check) {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  try {
    const res = await fetch(`${origin()}/${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = JSON.parse(await res.text())   // a missing file comes back as the site's HTML: JSON.parse fails
    if (check && !check(body)) throw new Error('unexpected shape')
    cache.set(path, { at: Date.now(), value: body })
    return body
  } catch (err) {
    if (hit) return hit.value
    return null
  }
}
export const clearFantasyCache = () => cache.clear()

// ---------------------------------------------------------------- the model (mirrors savant-fantasy.js)
export const PRESETS = {
  sleeper: { pts: 0.5, reb: 1, ast: 1, stl: 2, blk: 2, tov: -1, fg3m: 0.5, dd: 1, td: 2, b40: 2, b50: 2 },
  espn: { pts: 1, fg3m: 1, fga: -1, fgm: 2, fta: -1, ftm: 1, reb: 1, ast: 2, stl: 4, blk: 4, tov: -2 },
  yahoo: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1 },
}
const EVENTS = ['dd', 'td', 'b40', 'b50', 'a15', 'r20']
const CATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'tov', 'fgi', 'fti']
const DYN_W = [1, 0.8, 0.6]
const COUNT = ['min', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'fgm', 'fga', 'ftm', 'fta']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function todayET(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dow = (s) => new Date(s + 'T12:00:00Z').getUTCDay()

export function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x > 0 ? 1 - p : p
}
export function ninv(p) {
  if (p <= 0) return -8
  if (p >= 1) return 8
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  let q, r
  if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 0.97575) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  q = p - 0.5; r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/* A model bound to one projections file and one "today". */
export function makeModel(proj, today = todayET()) {
  const ix = {}
  ;(proj.log_cols || []).forEach((c, i) => { ix[c] = i })
  let first = null
  for (const t of Object.keys(proj.sched || {})) { const s = proj.sched[t]; if (s.length && (!first || s[0][0] < first)) first = s[0][0] }
  const list = Object.keys(proj.players).map((id) => Object.assign(proj.players[id], { id: +id, _ev: {} }))
  const byId = new Map(list.map((p) => [p.id, p]))

  function events(p, line) {
    const key = line === p.pre ? 'pre' : line === p.ros ? 'ros' : null
    if (key && p._ev[key]) return p._ev[key]
    const L = p.log || [], n = L.length, out = { dd: 0, td: 0, b40: 0, b50: 0, a15: 0, r20: 0, n }
    if (n) {
      const S = ['pts', 'reb', 'ast', 'stl', 'blk'], sc = {}
      for (const k of S) { let s = 0; for (let i = 0; i < n; i++) s += L[i][ix[k]]; const m = s / n; sc[k] = m > 0.05 ? Math.max(0.5, Math.min(2, (line[k] || 0) / m)) : 1 }
      for (let i = 0; i < n; i++) {
        const g = L[i], v = {}; let tens = 0
        for (const k of S) { v[k] = g[ix[k]] * sc[k]; if (v[k] >= 9.5) tens++ }
        if (tens >= 2) out.dd++
        if (tens >= 3) out.td++
        if (v.pts >= 39.5) out.b40++
        if (v.pts >= 49.5) out.b50++
        if (v.ast >= 14.5) out.a15++
        if (v.reb >= 19.5) out.r20++
      }
      const shrink = n / (n + 5)
      for (const e of EVENTS) out[e] = out[e] / n * shrink
    }
    if (key) p._ev[key] = out
    return out
  }
  const statOf = (line, k) => k === 'fgmi' ? (line.fga || 0) - (line.fgm || 0) : k === 'ftmi' ? (line.fta || 0) - (line.ftm || 0)
    : k === 'tpmi' ? (line.fg3a || 0) - (line.fg3m || 0) : (line[k] || 0)
  function fpPerGame(p, line, w) {
    const ev = events(p, line); let s = 0
    for (const k of Object.keys(w)) s += w[k] * (EVENTS.includes(k) ? (ev[k] || 0) : statOf(line, k))
    return s
  }
  function fpGames(p, line, w) {
    const L = p.log || [], n = L.length
    if (n < 8) return null
    const S = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'tov', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb'], sc = {}
    for (const k of S) { let s = 0; for (let i = 0; i < n; i++) s += L[i][ix[k]]; const m = s / n; sc[k] = m > 0.05 ? Math.max(0.4, Math.min(2.5, (line[k] || 0) / m)) : 1 }
    const out = []
    for (let i = 0; i < n; i++) {
      const g = L[i], v = {}
      for (const k of S) v[k] = g[ix[k]] * sc[k]
      v.fg3a = v.fg3m * ((line.fg3a || 0) / Math.max(0.01, line.fg3m || 0.01))
      let tens = 0
      for (const k of ['pts', 'reb', 'ast', 'stl', 'blk']) if (v[k] >= 9.5) tens++
      const e = { dd: tens >= 2 ? 1 : 0, td: tens >= 3 ? 1 : 0, b40: v.pts >= 39.5 ? 1 : 0, b50: v.pts >= 49.5 ? 1 : 0, a15: v.ast >= 14.5 ? 1 : 0, r20: v.reb >= 19.5 ? 1 : 0 }
      let s = 0
      for (const k of Object.keys(w)) s += w[k] * (EVENTS.includes(k) ? e[k] : statOf(v, k))
      out.push(s)
    }
    return out
  }
  function weekBounds() {
    let t = today
    if (first && t < first) t = first
    let start = addDays(t, -((dow(t) + 6) % 7))
    if (first && start < first) start = first
    return [start, addDays(t, (7 - dow(t)) % 7)]
  }
  function teamGames(p, win) {
    const s = (proj.sched || {})[p.team] || [], t = today
    if (win === 'next7') { const e = addDays(t, 7); return s.filter((g) => g[0] >= t && g[0] < e) }
    if (win === 'week') { const b = weekBounds(); return s.filter((g) => g[0] >= b[0] && g[0] <= b[1] && g[0] >= t) }
    return s.filter((g) => g[0] >= t)
  }
  function playProbs(p, games) {
    const r = Math.min(1, p.gp_rate || 0.8), st = p.status || ''
    return games.map((g, i) => {
      if (st === 'IR' || st === 'Sus' || st === 'Suspended') return g[0] < addDays(today, 14) ? 0 : r
      if (st === 'Out' || st === 'OUT') return i === 0 ? 0 : (g[0] < addDays(today, 7) ? r * 0.5 : r)
      if (i === 0 && st) return p.play != null ? p.play : r
      return r
    })
  }
  const expGames = (p, games) => playProbs(p, games).reduce((a, b) => a + b, 0)
  function lineFor(p, scope, basis, w) {
    const L = { G: 0, fp: 0 }
    for (const k of COUNT) L[k] = 0
    if (scope === 'dyn') {
      ;(p.y3 || []).forEach((s, i) => {
        const g = 82 * Math.min(1, p.gp_rate || 0.8) * (DYN_W[i] || 0), ln = s.pg
        for (const k of COUNT) L[k] += (ln[k] || 0) * g
        L.fp += fpPerGame(p, ln, w) * g; L.G += g
      })
    } else {
      const ln = scope === 'pre' ? p.pre : p.ros
      const G = scope === 'pre' ? 82 * Math.min(1, p.gp_rate || 0.8) : expGames(p, teamGames(p, scope === 'ros' ? 'ros' : scope))
      for (const k of COUNT) L[k] = (ln[k] || 0) * G
      L.fp = fpPerGame(p, ln, w) * G; L.G = G
    }
    if (basis === 'pg' && L.G > 0) { const g0 = L.G; for (const k of COUNT) L[k] /= g0; L.fp /= g0; L.pg = true }
    return L
  }
  function valueAll({ scope = 'ros', basis = 'total', fmt = 'points', w = PRESETS.sleeper, teams = 12, roster = 13, punt = [] } = {}) {
    let rows = list.map((p) => ({ p, L: lineFor(p, scope, basis, w) })).filter((r) => r.L.G > 0 || scope === 'pre')
    const N = Math.max(1, teams * roster)
    let lg = null
    if (fmt === 'points') rows.forEach((r) => { r.v = r.L.fp })
    else {
      rows.sort((a, b) => (b.L.pts + b.L.reb + b.L.ast) - (a.L.pts + a.L.reb + a.L.ast))
      let pool = rows.slice(0, N)
      for (let it = 0; it < 3; it++) {
        let sf = 0, sa = 0, tf = 0, ta = 0
        pool.forEach((r) => { sf += r.L.fgm; sa += r.L.fga; tf += r.L.ftm; ta += r.L.fta })
        const lgFG = sa ? sf / sa : 0.47, lgFT = ta ? tf / ta : 0.78
        rows.forEach((r) => { r.c = { pts: r.L.pts, reb: r.L.reb, ast: r.L.ast, stl: r.L.stl, blk: r.L.blk, fg3m: r.L.fg3m, tov: r.L.tov, fgi: r.L.fgm - r.L.fga * lgFG, fti: r.L.ftm - r.L.fta * lgFT } })
        const mu = {}, sd = {}
        for (const k of CATS) { let s = 0, s2 = 0; pool.forEach((r) => { s += r.c[k]; s2 += r.c[k] * r.c[k] }); mu[k] = s / pool.length; sd[k] = Math.sqrt(Math.max(1e-9, s2 / pool.length - mu[k] * mu[k])) }
        rows.forEach((r) => { r.z = {}; let t = 0; for (const k of CATS) { let z = (r.c[k] - mu[k]) / sd[k]; if (k === 'tov') z = -z; r.z[k] = z; if (!punt.includes(k)) t += z } r.v = t })
        rows.sort((a, b) => b.v - a.v); pool = rows.slice(0, N)
        lg = { fg: lgFG, ft: lgFT }
      }
    }
    rows.sort((a, b) => b.v - a.v)
    const repl = rows[Math.min(rows.length - 1, N)], rv = repl ? repl.v : 0
    rows.forEach((r, i) => { r.rank = i + 1; r.vor = r.v - rv })
    rows.repl = rv; rows.lg = lg
    return rows
  }
  function lockDist(p, w) {
    const xs = fpGames(p, p.ros, w)
    if (xs && xs.length) return { xs, emp: true }
    const m = fpPerGame(p, p.ros, w), sd = Math.max(1, 0.38 * m), out = []
    for (let i = 0; i < 40; i++) out.push(Math.max(0, m + sd * ninv((i + 0.5) / 40)))
    return { xs: out, emp: false }
  }
  function lockPlan(p, w, margin = null, sigma = null) {
    const b = weekBounds(), all = ((proj.sched || {})[p.team] || []).filter((g) => g[0] >= b[0] && g[0] <= b[1])
    const future = all.filter((g) => g[0] >= today), dist = lockDist(p, w), xs = dist.xs, n = xs.length
    const mean = xs.reduce((a, x) => a + x, 0) / n
    const q = playProbs(p, future), k = future.length
    const V = new Array(k + 1), U = new Array(k + 1), th = [], thW = [], useW = margin != null && sigma > 0
    const win = (y) => ncdf((margin + y) / sigma)
    if (k) {
      V[k - 1] = q[k - 1] * mean
      if (useW) { let s = 0; xs.forEach((x) => { s += win(x) }); U[k - 1] = q[k - 1] * s / n + (1 - q[k - 1]) * win(0) }
      for (let i = k - 2; i >= 0; i--) {
        let e = 0, eu = 0
        xs.forEach((x) => { e += Math.max(x, V[i + 1]); if (useW) eu += Math.max(win(x), U[i + 1]) })
        V[i] = q[i] * e / n + (1 - q[i]) * V[i + 1]
        if (useW) U[i] = q[i] * eu / n + (1 - q[i]) * U[i + 1]
      }
      for (let j = 0; j < k; j++) {
        th.push(j < k - 1 ? V[j + 1] : null)
        thW.push(useW && j < k - 1 ? Math.max(0, sigma * ninv(Math.min(0.9999, Math.max(0.0001, U[j + 1]))) - margin) : null)
      }
    }
    return { all, future, q, th, thW, ev: k ? V[0] : 0, evLast: k ? q[k - 1] * mean : 0, mean, emp: dist.emp, win: useW && k ? U[0] : null,
      sd: Math.sqrt(xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / n), week: b }
  }
  return { proj, list, byId, today, first, events, fpPerGame, fpGames, weekBounds, teamGames, playProbs, expGames, lineFor, valueAll, lockPlan }
}

// ---------------------------------------------------------------- loading + lookups
const loadProj = () => getJson('savant-proj.json', (b) => b && b.players && b.sched)
async function model() {
  const proj = await loadProj()
  if (!proj) throw new SavantError('Basketball Savant projections are not available right now. They rebuild with every refresh; try again in a few minutes.')
  if (!proj._model || proj._model.today !== todayET()) proj._model = makeModel(proj)
  return proj._model
}
async function crowdBoard() {
  const j = await getJson('api/dynasty?action=board&limit=600', (b) => b && Array.isArray(b.board))
  const m = new Map()
  for (const r of (j && j.board) || []) m.set(String(r.id), { rank: r.rank, value: Math.round(10000 * Math.exp(-r.rank / 40)) })
  return m
}
function findPlayer(M, q) {
  const s = String(q).trim()
  if (/^\d+$/.test(s)) { const p = M.byId.get(+s); if (p) return p }
  const n = norm(s)
  let hits = M.list.filter((p) => norm(p.name) === n)
  if (!hits.length) hits = M.list.filter((p) => norm(p.name).includes(n))
  if (!hits.length) {
    const parts = n.split(' ').filter(Boolean)
    hits = M.list.filter((p) => parts.every((x) => norm(p.name).includes(x)))
  }
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new SavantError(`No current NBA player matches "${s}" in the projections (rostered players only).`)
  throw new SavantError(`"${s}" matches ${hits.length} players: ${hits.slice(0, 8).map((p) => `${p.name} (${p.team}, id ${p.id})`).join('; ')}. Use the id.`)
}
function weightsOf(scoring) {
  if (!scoring || scoring === 'sleeper') return { w: PRESETS.sleeper, label: 'Sleeper default' }
  if (typeof scoring === 'string') {
    if (!PRESETS[scoring]) throw new SavantError(`Unknown scoring "${scoring}". Use sleeper, espn, yahoo, or an object of weights.`)
    return { w: PRESETS[scoring], label: { sleeper: 'Sleeper default', espn: 'ESPN default', yahoo: 'Yahoo default' }[scoring] }
  }
  const ok = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'fgm', 'fga', 'fgmi', 'ftm', 'fta', 'ftmi', 'tpmi', ...EVENTS]
  const bad = Object.keys(scoring).filter((k) => !ok.includes(k))
  if (bad.length) throw new SavantError(`Unknown scoring keys: ${bad.join(', ')}. Allowed: ${ok.join(', ')}.`)
  return { w: scoring, label: 'custom' }
}
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)
const cardUrl = (id) => `${SITE}/basketball-savant.html?p=${id}`
const pgLine = (ln) => ({ min: r1(ln.min), pts: r1(ln.pts), reb: r1(ln.reb), ast: r1(ln.ast), stl: r1(ln.stl), blk: r1(ln.blk), fg3m: r1(ln.fg3m), tov: r1(ln.tov),
  fg_pct: ln.fga ? r1(100 * ln.fgm / ln.fga) : null, ft_pct: ln.fta ? r1(100 * ln.ftm / ln.fta) : null })
const WINDOWS = { ros: 'rest of season', next7: 'next 7 days', week: 'rest of this fantasy week (Mon-Sun)', pre: 'a full 82-game season', dyn: 'three seasons, weighted 1 / 0.8 / 0.6' }
const asOf = (M) => `Projections generated ${String(M.proj.generated || '').slice(0, 16).replace('T', ' ')} UTC; today ${M.today} ET. ${SITE}/basketball-savant.html#fantasy`

// ---------------------------------------------------------------- tool bodies
export async function fantasyRankings({ format = 'points', scoring, window = 'ros', per_game = false, position, team, teams = 12, roster = 13, limit = 25, players, punt = [] }) {
  const M = await model(), { w, label } = weightsOf(scoring)
  const P2 = { fg_pct: 'fgi', ft_pct: 'fti', fgi: 'fgi', fti: 'fti' }
  const rows = M.valueAll({ scope: window, basis: per_game ? 'pg' : 'total', fmt: format === 'cats' ? 'cats' : 'points', w, teams, roster, punt: punt.map((k) => P2[k] || k) })
  const crowd = window === 'dyn' ? await crowdBoard() : null
  let pick = rows
  if (players && players.length) { const ids = new Set(players.map((q) => findPlayer(M, q).id)); pick = rows.filter((r) => ids.has(r.p.id)) }
  if (position) pick = pick.filter((r) => r.p.pos.toLowerCase() === position.toLowerCase())
  if (team) pick = pick.filter((r) => r.p.team === team.toUpperCase())
  pick = pick.slice(0, limit)
  const out = pick.map((r) => {
    const G = r.L.pg ? 1 : Math.max(r.L.G, 1e-9), pgl = {}
    for (const k of COUNT) pgl[k] = r.L[k] / G
    const c = crowd && crowd.get(String(r.p.id))
    return {
      rank: r.rank, id: String(r.p.id), name: r.p.name, team: r.p.team, position: r.p.pos, age: r.p.age, status: r.p.status || null,
      expected_games: r.L.pg ? null : r1(r.L.G), per_game: pgLine(pgl),
      fantasy_points_per_game: format === 'cats' ? null : r1(r.L.fp / G), fantasy_points: format === 'cats' || r.L.pg ? null : r1(r.L.fp),
      value: format === 'cats' ? r2(r.v) : r1(r.v), value_over_replacement: format === 'cats' ? r2(r.vor) : r1(r.vor),
      z: r.z ? Object.fromEntries(Object.entries(r.z).map(([k, v]) => [k === 'fgi' ? 'fg_pct' : k === 'fti' ? 'ft_pct' : k, r2(v)])) : null,
      crowd_rank: c ? c.rank : null, url: cardUrl(r.p.id),
    }
  })
  const head = `${format === 'cats' ? `9-cat (sum of z-scores${punt.length ? `, punting ${punt.join(', ')}` : ''})` : `Points (${label})`}, ${WINDOWS[window]}${per_game ? ', per game' : ''}; ${teams} teams x ${roster}.`
  const text = [head, ...out.map((r) => `${r.rank}. ${r.name} (${r.team}, ${r.position}${r.status ? `, ${r.status}` : ''}): `
    + (format === 'cats' ? `value ${r.value} (+${r.value_over_replacement} over replacement)` : `${r.fantasy_points_per_game} FP/G${r.fantasy_points != null ? `, ${r.fantasy_points} FP over ${r.expected_games} games` : ''}`)
    + ` | ${r.per_game.pts} pts ${r.per_game.reb} reb ${r.per_game.ast} ast ${r.per_game.min} min`), asOf(M),
  'Method: Marcel-style projections (3 seasons 5/4/3, regressed by measured settle points, aged), blended with this season; backtested at 2.39 preseason points MAE vs 2.52 for last season. Explainers: wcehoops.com/basketball-savant.html#fantasy (click any column).'].join('\n')
  return { text, structured: { format, scoring: label, window, per_game: !!per_game, replacement_level: format === 'cats' ? r2(rows.repl) : r1(rows.repl), players: out, data_as_of: M.proj.generated, url: `${SITE}/basketball-savant.html#fantasy` } }
}

export async function fantasyPlayer({ player, scoring }) {
  const M = await model(), { w, label } = weightsOf(scoring), p = findPlayer(M, player)
  const ros = M.valueAll({ scope: 'ros', fmt: 'points', w }).find((r) => r.p.id === p.id)
  const n7 = M.teamGames(p, 'next7'), wk = M.teamGames(p, 'week')
  const crowd = (await crowdBoard()).get(String(p.id))
  const s = {
    id: String(p.id), name: p.name, team: p.team, position: p.pos, age: p.age, rookie: !!p.rookie, status: p.status || null, games_played: p.gp,
    rest_of_season: { per_game: pgLine(p.ros), fantasy_points_per_game: r1(M.fpPerGame(p, p.ros, w)), expected_games: r1(M.expGames(p, M.teamGames(p, 'ros'))), points_rank: ros ? ros.rank : null },
    next_7_days: { games: n7.map((g) => `${g[0]} ${g[2] ? 'vs' : '@'} ${g[1]}`), expected_games: r1(M.expGames(p, n7)), fantasy_points: r1(M.fpPerGame(p, p.ros, w) * M.expGames(p, n7)) },
    this_week: { games: wk.map((g) => `${g[0]} ${g[2] ? 'vs' : '@'} ${g[1]}`), fantasy_points: r1(M.fpPerGame(p, p.ros, w) * M.expGames(p, wk)) },
    three_seasons: (p.y3 || []).map((y) => ({ season: y.season, per_game: pgLine(y.pg), fantasy_points_per_game: r1(M.fpPerGame(p, y.pg, w)) })),
    crowd_dynasty_rank: crowd ? crowd.rank : null, crowd_dynasty_value: crowd ? crowd.value : null,
    scoring: label, url: cardUrl(p.id), data_as_of: M.proj.generated,
  }
  const l = s.rest_of_season.per_game
  const text = [`${p.name} (${p.team}, ${p.pos}${p.status ? `, ${p.status}` : ''}) — ${M.proj.season} projection per game: ${l.min} min, ${l.pts} pts, ${l.reb} reb, ${l.ast} ast, ${l.stl} stl, ${l.blk} blk, ${l.fg3m} 3PM, ${l.tov} TO, ${l.fg_pct}% FG, ${l.ft_pct}% FT.`,
    `${label} scoring: ${s.rest_of_season.fantasy_points_per_game} FP/G; rest of season ~${s.rest_of_season.expected_games} games, points rank #${s.rest_of_season.points_rank}.`,
    `Next 7 days: ${s.next_7_days.games.join(', ') || 'no games'} (${s.next_7_days.fantasy_points} FP expected).`,
    `Three seasons: ${s.three_seasons.map((y) => `${y.season} ${y.per_game.pts} pts / ${y.fantasy_points_per_game} FP/G`).join('; ')}.`,
    crowd ? `WCE Dynasty crowd board: #${crowd.rank}.` : 'Not on the WCE Dynasty crowd board.', asOf(M), s.url].join('\n')
  return { text, structured: s }
}

export async function fantasyTrade({ side_a, side_b, format = 'points', scoring, teams = 12, roster = 13 }) {
  const M = await model(), { w, label } = weightsOf(scoring), fmt = format === 'cats' ? 'cats' : 'points'
  const ros = new Map(M.valueAll({ scope: 'ros', fmt, w, teams, roster }).map((r) => [r.p.id, r]))
  const dyn = new Map(M.valueAll({ scope: 'dyn', fmt, w, teams, roster }).map((r) => [r.p.id, r]))
  const nx = new Map(M.valueAll({ scope: 'next7', fmt: 'points', w, teams, roster }).map((r) => [r.p.id, r]))
  const crowd = await crowdBoard()
  const side = (qs) => {
    const t = { rest_of_season: 0, dynasty_model: 0, dynasty_crowd: 0, next_7_fp: 0, players: [] }
    for (const q of qs) {
      const p = findPlayer(M, q), a = ros.get(p.id), b = dyn.get(p.id), c = crowd.get(String(p.id)), n = nx.get(p.id)
      const row = { id: String(p.id), name: p.name, team: p.team, rest_of_season: a ? (fmt === 'cats' ? r2(a.vor) : r1(a.vor)) : null,
        dynasty_model: b ? (fmt === 'cats' ? r2(b.vor) : r1(b.vor)) : null, dynasty_crowd: c ? c.value : null, crowd_rank: c ? c.rank : null, next_7_fp: n ? r1(n.L.fp) : 0 }
      t.rest_of_season += a ? a.vor : 0; t.dynasty_model += b ? b.vor : 0; t.dynasty_crowd += c ? c.value : 0; t.next_7_fp += n ? n.L.fp : 0
      t.players.push(row)
    }
    for (const k of ['rest_of_season', 'dynasty_model', 'next_7_fp']) t[k] = fmt === 'cats' && k !== 'next_7_fp' ? r2(t[k]) : r1(t[k])
    return t
  }
  const A = side(side_a), B = side(side_b)
  const verdict = (a, b) => { const d = a - b, base = Math.max(Math.abs(a), Math.abs(b), 1e-9); return Math.abs(d) / base < 0.05 ? 'about even' : `${d > 0 ? 'side A' : 'side B'} by ${Math.abs(d).toFixed(fmt === 'cats' ? 2 : 1)}` }
  const v = { rest_of_season: verdict(A.rest_of_season, B.rest_of_season), dynasty_model: verdict(A.dynasty_model, B.dynasty_model),
    dynasty_crowd: verdict(A.dynasty_crowd, B.dynasty_crowd), next_7_days: verdict(A.next_7_fp, B.next_7_fp) }
  const disagree = (A.dynasty_model - B.dynasty_model) * (A.dynasty_crowd - B.dynasty_crowd) < 0
  const text = [`Trade (${fmt === 'cats' ? '9-cat z-score value' : `points, ${label}`}; ${teams} teams x ${roster}). Values are over replacement, so extra players pay for the roster spot.`,
    `Side A gets ${A.players.map((p) => p.name).join(' + ')}; side B gets ${B.players.map((p) => p.name).join(' + ')}.`,
    `Rest of season: ${v.rest_of_season} (${A.rest_of_season} vs ${B.rest_of_season}).`,
    `Dynasty, our 3-season model: ${v.dynasty_model} (${A.dynasty_model} vs ${B.dynasty_model}).`,
    `Dynasty, WCE crowd board: ${v.dynasty_crowd} (${A.dynasty_crowd} vs ${B.dynasty_crowd}).`,
    `Next 7 days: ${v.next_7_days} (${A.next_7_fp} vs ${B.next_7_fp} FP).`,
    disagree ? 'Our model and the crowd disagree on the dynasty side of this deal: age, role changes and injuries are the usual reasons.' : '', asOf(M)].filter(Boolean).join('\n')
  return { text, structured: { format: fmt, scoring: label, side_a: A, side_b: B, verdicts: v, model_and_crowd_disagree: disagree, data_as_of: M.proj.generated, url: `${SITE}/basketball-savant.html#fantasy/trade` } }
}

export async function lockIn({ player, scoring, scored_unlocked, my_other_slots, opponent_total, uncertainty }) {
  const M = await model(), { w, label } = weightsOf(scoring), p = findPlayer(M, player)
  const margin = my_other_slots != null && opponent_total != null ? my_other_slots - opponent_total : null
  const pl = M.lockPlan(p, w, margin, margin != null ? (uncertainty || 60) : null)
  const games = pl.all.map((g) => {
    const j = pl.future.indexOf(g)
    if (j < 0) return { date: g[0], opponent: g[1], home: !!g[2], played: true }
    return { date: g[0], opponent: g[1], home: !!g[2], played: false, plays_pct: Math.round(pl.q[j] * 100),
      lock_if_at_least: pl.th[j] == null ? null : r1(pl.th[j]), lock_if_at_least_to_win: pl.thW[j] == null ? null : r1(pl.thW[j]), last_game: pl.th[j] == null }
  })
  let now = null
  if (scored_unlocked != null) {
    const later = pl.future.filter((g) => g[0] > M.today).length
    const wait = later ? (later === pl.future.length ? pl.ev : pl.th[pl.future.length - later - 1]) : null
    now = wait == null ? { decision: 'counts either way', reason: 'That was his last game this week.' }
      : { decision: scored_unlocked >= wait ? 'lock' : 'wait', value_of_waiting: r1(wait) }
  }
  const s = { player: p.name, team: p.team, scoring: label, week: { start: pl.week[0], end: pl.week[1] }, games,
    per_game_mean: r1(pl.mean), per_game_sd: r1(pl.sd), spread_from: pl.emp ? 'his last 60 games, rescaled to his projection' : 'a normal curve at his projection (too few NBA games)',
    expected_smart_locking: r1(pl.ev), expected_never_locking: r1(pl.evLast), win_probability: pl.win == null ? null : Math.round(pl.win * 100), now, url: `${SITE}/basketball-savant.html#fantasy/lock` }
  const text = [`Sleeper Lock-In plan for ${p.name} (${label} scoring), week ${s.week.start} to ${s.week.end}. One game counts; unlocked, his last game counts (zero if he sits).`,
    ...games.map((g) => g.played ? `${g.date} ${g.home ? 'vs' : '@'} ${g.opponent}: played.`
      : `${g.date} ${g.home ? 'vs' : '@'} ${g.opponent} (plays ${g.plays_pct}%): ${g.last_game ? 'counts if nothing is locked' : `lock if he scores ${g.lock_if_at_least}+`}${g.lock_if_at_least_to_win != null ? ` (to maximize win chance: ${g.lock_if_at_least_to_win}+)` : ''}.`),
    `Expected with smart locking ${s.expected_smart_locking} vs ${s.expected_never_locking} never locking.${s.win_probability != null ? ` Win chance ${s.win_probability}%.` : ''}`,
    now ? (now.decision === 'counts either way' ? now.reason : `He scored ${scored_unlocked}: ${now.decision.toUpperCase()} (waiting is worth ${now.value_of_waiting}).`) : '',
    'Method: backward induction, V_i = q_i E[max(X, V_(i+1))] + (1 - q_i) V_(i+1); matchup mode runs it on win probability.', asOf(M)].filter(Boolean).join('\n')
  return { text, structured: s }
}

export async function streamers({ window = 'next7', format = 'points', scoring, exclude = [], teams = 12, roster = 13, limit = 20 }) {
  const M = await model(), { w, label } = weightsOf(scoring), fmt = format === 'cats' ? 'cats' : 'points'
  const rows = M.valueAll({ scope: window, fmt, w, teams, roster })
  const ros = new Map(M.valueAll({ scope: 'ros', fmt, w, teams, roster }).map((r) => [r.p.id, r]))
  const ex = new Set(exclude.map((q) => { try { return findPlayer(M, q).id } catch { return null } }).filter(Boolean))
  const N = teams * roster
  const list = rows.filter((r) => !ex.has(r.p.id) && (exclude.length ? true : (ros.get(r.p.id)?.rank || 1e9) > N * 0.75) && r.L.G > 0.5).slice(0, limit)
  const out = list.map((r, i) => {
    const gs = M.teamGames(r.p, window)
    return { rank: i + 1, id: String(r.p.id), name: r.p.name, team: r.p.team, position: r.p.pos, status: r.p.status || null,
      games: gs.map((g, j) => `${DOW[dow(g[0])]} ${g[2] ? 'vs' : '@'} ${g[1]}${j > 0 && gs[j - 1][0] === addDays(g[0], -1) ? ' (B2B)' : ''}`),
      expected_games: r1(r.L.G), window_value: fmt === 'cats' ? r2(r.v) : r1(r.L.fp), fantasy_points_per_game: fmt === 'cats' ? null : r1(r.L.fp / Math.max(r.L.G, 1e-9)),
      rest_of_season_rank: ros.get(r.p.id)?.rank ?? null, url: cardUrl(r.p.id) }
  })
  const text = [`Streamers for the ${window === 'week' ? 'rest of this week' : 'next 7 days'} (${fmt === 'cats' ? '9-cat' : label}). ${exclude.length ? 'Excluding the players you listed.' : `Players ranked outside the top ${Math.round(N * 0.75)} rest-of-season (likely available).`}`,
    ...out.map((r) => `${r.rank}. ${r.name} (${r.team}${r.status ? `, ${r.status}` : ''}): ${r.games.join(', ')} -> ${r.window_value}${fmt === 'cats' ? ' z' : ' FP'}`), asOf(M)].join('\n')
  return { text, structured: { window, format: fmt, scoring: label, players: out, data_as_of: M.proj.generated } }
}

export async function injuryReport({ team, limit = 25 }) {
  const M = await model(), w = PRESETS.sleeper
  const ros = new Map(M.valueAll({ scope: 'ros', fmt: 'points', w }).map((r) => [r.p.id, r]))
  const inv = (M.proj.ww_inv && M.proj.ww_inv.by) || {}
  let hurt = M.list.filter((p) => p.status && (!team || p.team === team.toUpperCase()))
  hurt.sort((a, b) => (ros.get(b.id)?.v ?? -1e9) - (ros.get(a.id)?.v ?? -1e9))
  hurt = hurt.slice(0, limit)
  const out = hurt.map((p) => ({
    id: String(p.id), name: p.name, team: p.team, status: p.status, plays_next_game_pct: Math.round((p.play ?? 1) * 100), rest_of_season_rank: ros.get(p.id)?.rank ?? null,
    beneficiaries: (inv[String(p.id)] || []).filter((b) => M.byId.get(b.id)?.team === p.team)
      .map((b) => ({ id: String(b.id), name: M.byId.get(b.id).name, games_without: b.gwo, minutes_change: b.d.min, pts36_change: b.d.pts, reb36_change: b.d.reb, ast36_change: b.d.ast, usage36_change: b.d.usg }))
      .sort((a, b) => (b.pts36_change + b.reb36_change + b.ast36_change) - (a.pts36_change + a.reb36_change + a.ast36_change)),
  }))
  const text = [`Injury designations from Sleeper's feed${team ? ` for ${team.toUpperCase()}` : ''}, best players first, with teammates who gained in the games each missed (${(M.proj.ww_inv && M.proj.ww_inv.season) || 'latest'} game logs).`,
    ...out.map((p) => `${p.name} (${p.team}) ${p.status}, plays next game ~${p.plays_next_game_pct}%. ${p.beneficiaries.length ? 'When he sat: ' + p.beneficiaries.map((b) => `${b.name} ${b.minutes_change >= 0 ? '+' : ''}${b.minutes_change} min, ${b.pts36_change >= 0 ? '+' : ''}${b.pts36_change} pts/36 (${b.games_without} g)`).join('; ') : 'No clear beneficiary.'}`), asOf(M)].join('\n')
  return { text, structured: { players: out, data_as_of: M.proj.generated, url: `${SITE}/basketball-savant.html#fantasy/inj` } }
}

// ---------------------------------------------------------------- teams + lineups
async function teamsData() {
  const [a, c] = await Promise.all([getJson('savant-teams.json', (b) => b && b.data), getJson('savant-teams-current.json', (b) => b && b.data)])
  if (!a && !c) throw new SavantError('Team data is not available right now.')
  const data = Object.assign({}, a ? a.data : {}), seasons = new Set(a ? a.seasons : [])
  let upcoming = null, current = null
  for (const s of (c && c.seasons) || []) {
    const b = c.data[s]
    if (b.preseason) { upcoming = { season: s, sched: Object.fromEntries((b.teams || []).map((t) => [t.abbr, t.sched])) }; continue }
    data[s] = b; seasons.add(s); current = s
  }
  return { data, seasons: [...seasons].sort((x, y) => parseInt(y, 10) - parseInt(x, 10)), upcoming, current, k: (a || c).k }
}
function pickSeason(T, season) {
  if (season) { if (!T.data[season]) throw new SavantError(`No team data for ${season}. Seasons: ${T.seasons[T.seasons.length - 1]} to ${T.seasons[0]}.`); return season }
  const s = T.seasons[0], b = T.data[s]
  return b && b.teams && b.teams[0] && b.teams[0].gp < 10 && T.seasons[1] ? T.seasons[1] : s
}
function findTeam(teams, q) {
  const n = norm(q)
  const t = teams.find((t) => norm(t.abbr) === n) || teams.find((t) => norm(t.name) === n) || teams.find((t) => norm(t.name).includes(n))
  if (!t) throw new SavantError(`No team matches "${q}". Use an abbreviation like BOS or a name like Celtics.`)
  return t
}
export async function teamProfile({ team, season }) {
  const T = await teamsData(), s = pickSeason(T, season), teams = T.data[s].teams, t = Object.assign({}, findTeam(teams, team))
  if (T.upcoming && s === T.seasons[0] && T.upcoming.sched[t.abbr]) t.sched_upcoming = { season: T.upcoming.season, ...T.upcoming.sched[t.abbr] }
  const rk = (k, low) => { const vals = teams.map((x) => x[k]).filter((v) => v != null).sort((a, b) => (low ? a - b : b - a)); return vals.indexOf(t[k]) + 1 }
  const ranks = { net: rk('net'), adjnet: rk('adjnet'), ortg: rk('ortg'), drtg: rk('drtg', true), pace: rk('pace') }
  const text = [`${t.name} ${s}: ${t.w}-${t.l}. Net ${t.net} (${ranks.net} of 30), luck-adjusted net ${t.adjnet} (${ranks.adjnet}); ORtg ${t.ortg} (${ranks.ortg}), DRtg ${t.drtg} (${ranks.drtg}), pace ${t.pace}.`,
    `Pythagorean wins ${t.pythw}, luck-adjusted expected wins ${t.xw}. Opponent shooting luck ${t.luck} per 100.`,
    t.ff ? `Four factors — offense eFG ${(100 * t.ff.efg).toFixed(1)}%, TOV ${(100 * t.ff.tov).toFixed(1)}%, ORB ${(100 * t.ff.orb).toFixed(1)}%, FT rate ${t.ff.ftr}; defense allowed eFG ${(100 * t.ff.oefg).toFixed(1)}%, forced TOV ${(100 * t.ff.otov).toFixed(1)}%, DRB ${(100 * (1 - t.ff.oorb)).toFixed(1)}%, opp FT rate ${t.ff.oftr}.` : '',
    t.diet ? `Shot diet (share of FGA, FG%): ${Object.entries(t.diet).map(([z, v]) => `${z} ${v[0]}% @ ${(100 * v[1]).toFixed(1)}`).join(', ')}.` : '',
    (t.sched || t.sched_upcoming) ? (() => { const sc = t.sched || t.sched_upcoming; return `Schedule ahead: ${sc.left} games left, ${sc.b2b} back-to-backs, ${sc.oppb2b} vs opponents on a B2B, SOS ${sc.sos}; next 7 days ${sc.next7} games.` })() : '',
    `Luck adjustment: opponents' 3P% and FT% set to league average. ${SITE}/basketball-savant.html#teams`].filter(Boolean).join('\n')
  return { text, structured: { season: s, team: t, ranks, url: `${SITE}/basketball-savant.html#teams` } }
}
export async function lineups({ team, season, size = 5, min_minutes, sort = 'sample_adjusted', player, limit = 15 }) {
  const T = await teamsData(), s = pickSeason(T, season)
  if (parseInt(s, 10) < 2007) throw new SavantError('Lineup data starts in 2007-08.')
  const L = await getJson(`lineups/${s}.json`, (b) => b && b.units)
  if (!L) throw new SavantError(`No lineup file for ${s}.`)
  let units = L.units[String(size)] || []
  // A season in progress carries its own default floors, pro-rated to the games played
  // (teams_engine.py view_min); finished seasons use 50 / 200.
  const vm = L.view_min && L.view_min[String(size)]
  const floor = min_minutes != null ? min_minutes : (vm != null ? vm : (size === 5 ? 50 : 200))
  if (team) { const t = findTeam(T.data[s].teams, team); units = units.filter((u) => u.t === t.abbr) }
  if (player) { const n = norm(player).split(' ').pop(); units = units.filter((u) => u.names.some((x) => norm(x).includes(n))) }
  units = units.filter((u) => u.min >= floor)
  const key = { sample_adjusted: 'est', luck_adjusted: 'adj', raw: 'net', minutes: 'min' }[sort] || 'est'
  units = units.slice().sort((a, b) => b[key] - a[key]).slice(0, limit)
  const k = (L.k || {})[String(size)]
  const text = [`${size}-man units, ${s}${team ? `, ${team.toUpperCase()}` : ''}, ${floor}+ minutes, sorted by ${sort.replace('_', '-')} net. Sample-adjusted = luck-adjusted net pulled toward the team's by k = ${k} possessions (measured from split-season reliability).`,
    ...units.map((u, i) => `${i + 1}. ${u.names.join(' / ')} (${u.t}): ${u.min} min, ${u.poss} poss; net ${u.net}, luck-adj ${u.adj}, sample-adj ${u.est}; ORtg ${u.ortg}, DRtg ${u.drtg}.`), `${SITE}/basketball-savant.html#lineups`].join('\n')
  return { text, structured: { season: s, size, k, units, url: `${SITE}/basketball-savant.html#lineups` } }
}
export async function schedule({ window = 'next7', limit = 30 }) {
  const M = await model(), out = []
  const b = M.weekBounds()
  for (const [abbr, games] of Object.entries(M.proj.sched || {})) {
    const gs = window === 'week' ? games.filter((g) => g[0] >= b[0] && g[0] <= b[1] && g[0] >= M.today) : games.filter((g) => g[0] >= M.today && g[0] < addDays(M.today, 7))
    const b2b = gs.filter((g, j) => games.some((x) => x[0] === addDays(g[0], -1))).length
    out.push({ team: abbr, games: gs.length, back_to_backs: b2b, home: gs.filter((g) => g[2]).length, slate: gs.map((g) => `${DOW[dow(g[0])]} ${g[2] ? 'vs' : '@'} ${g[1]}`) })
  }
  out.sort((a, b2) => b2.games - a.games || a.back_to_backs - b2.back_to_backs)
  const text = [`Games per team, ${window === 'week' ? `rest of the fantasy week (${b[0]} to ${b[1]})` : 'next 7 days'}: more games = more fantasy points; second nights of back-to-backs are when stars rest.`,
    ...out.slice(0, limit).map((t) => `${t.team}: ${t.games} games (${t.back_to_backs} B2B) — ${t.slate.join(', ')}`), asOf(M)].join('\n')
  return { text, structured: { window, teams: out.slice(0, limit), data_as_of: M.proj.generated } }
}

// ---------------------------------------------------------------- tool registrations
const scoringArg = z.union([z.enum(['sleeper', 'espn', 'yahoo']), z.record(z.string(), z.number())]).optional()
  .describe('"sleeper" (default), "espn", "yahoo", or weights per stat, e.g. {"pts":1,"reb":1.2,"tov":-1,"dd":1}.')
const league = {
  teams: z.number().int().min(4).max(30).default(12).describe('Teams (default 12).'),
  roster: z.number().int().min(5).max(30).default(13).describe('Roster spots (default 13).'),
}
const loose = z.record(z.string(), z.any())
const pre = 'Basketball Savant Fantasy (wcehoops.com): '

export const tools = [
  {
    name: 'nba_fantasy_rankings',
    config: {
      title: 'NBA fantasy rankings',
      description: pre + 'Rank NBA players from our projections for points leagues (any scoring) or 9-cat (z-scores, punts), over the rest of season, next 7 days, this week, a full season or dynasty (3 seasons). Per-game lines, expected games, fantasy points, value over replacement, crowd dynasty rank.',
      inputSchema: {
        format: z.enum(['points', 'cats']).default('points').describe('"points" or "cats" (9-cat H2H/roto: PTS REB AST STL BLK 3PM TO FG% FT%).'),
        scoring: scoringArg,
        window: z.enum(['ros', 'next7', 'week', 'pre', 'dyn']).default('ros').describe('ros = rest of season; next7; week = rest of this Mon-Sun week; pre = full 82-game season; dyn = three seasons weighted 1/0.8/0.6.'),
        per_game: z.boolean().default(false).describe('Rank per game instead of totals.'),
        position: z.enum(['Guard', 'Wing', 'Big']).optional().describe('Only this position group.'),
        team: z.string().trim().max(3).optional().describe('Team abbreviation, e.g. "BOS".'),
        players: z.array(z.string().trim().min(1).max(80)).max(30).optional().describe('Only these players (names or ids).'),
        punt: z.array(z.enum(['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'tov', 'fg_pct', 'ft_pct'])).max(4).default([]).describe('9-cat only: categories to punt (left out of the value), e.g. ["fg_pct", "tov"].'),
        limit: z.number().int().min(1).max(200).default(25).describe('Most players to return (default 25).'),
        ...league,
      },
      outputSchema: { format: z.string(), scoring: z.string(), window: z.string(), per_game: z.boolean(), replacement_level: z.number().nullable(), players: z.array(loose), data_as_of: z.string().nullable(), url: z.string() },
      annotations: { title: 'NBA fantasy rankings', ...READ_ONLY },
    },
    run: (a) => fantasyRankings(a),
  },
  {
    name: 'nba_fantasy_player',
    config: {
      title: 'NBA player fantasy projection',
      description: pre + 'One player\'s projection: rest-of-season per-game line, expected games, fantasy points per game, next 7 days and this week, a three-season outlook, injury status and WCE Dynasty crowd rank.',
      inputSchema: { player: z.string().trim().min(1).max(80).describe('Player name or NBA id, e.g. "Victor Wembanyama".'), scoring: scoringArg },
      outputSchema: { id: z.string(), name: z.string(), team: z.string(), position: z.string(), age: z.number().nullable(), rookie: z.boolean(), status: z.string().nullable(), games_played: z.number(),
        rest_of_season: loose, next_7_days: loose, this_week: loose, three_seasons: z.array(loose), crowd_dynasty_rank: z.number().nullable(), crowd_dynasty_value: z.number().nullable(), scoring: z.string(), url: z.string(), data_as_of: z.string().nullable() },
      annotations: { title: 'NBA player fantasy projection', ...READ_ONLY },
    },
    run: (a) => fantasyPlayer(a),
  },
  {
    name: 'nba_fantasy_trade',
    config: {
      title: 'Evaluate an NBA fantasy trade',
      description: pre + 'Value a fantasy trade four ways: rest of season and dynasty (our 3-season model), as value over replacement so 2-for-1s pay for the roster spot; the WCE crowd Dynasty board; and the next 7 days. Flags model-crowd disagreement.',
      inputSchema: {
        side_a: z.array(z.string().trim().min(1).max(80)).min(1).max(8).describe('Players side A receives (names or ids).'),
        side_b: z.array(z.string().trim().min(1).max(80)).min(1).max(8).describe('Players side B receives.'),
        format: z.enum(['points', 'cats']).default('points').describe('"points" (default) or "cats" for 9-category value.'), scoring: scoringArg, ...league,
      },
      outputSchema: { format: z.string(), scoring: z.string(), side_a: loose, side_b: loose, verdicts: loose, model_and_crowd_disagree: z.boolean(), data_as_of: z.string().nullable(), url: z.string() },
      annotations: { title: 'Evaluate an NBA fantasy trade', ...READ_ONLY },
    },
    run: (a) => fantasyTrade(a),
  },
  {
    name: 'nba_fantasy_lock_in',
    config: {
      title: 'Sleeper Lock-In plan',
      description: pre + 'Sleeper Lock-In (one game per player counts; unlocked, his last game counts): the score worth locking in each of his remaining games this week, by backward induction on his game log. Optionally matchup-aware, and answers "he just scored X: lock or wait?".',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player name or NBA id.'), scoring: scoringArg,
        scored_unlocked: z.number().optional().describe('Fantasy points he just scored in a game you have not locked.'),
        my_other_slots: z.number().optional().describe('Your other slots\' total (locked + projected).'),
        opponent_total: z.number().optional().describe('Opponent\'s total (locked + projected).'),
        uncertainty: z.number().positive().optional().describe('SD of the rest of the matchup in fantasy points (default 60).'),
      },
      outputSchema: { player: z.string(), team: z.string(), scoring: z.string(), week: loose, games: z.array(loose), per_game_mean: z.number().nullable(), per_game_sd: z.number().nullable(), spread_from: z.string(),
        expected_smart_locking: z.number().nullable(), expected_never_locking: z.number().nullable(), win_probability: z.number().nullable(), now: loose.nullable(), url: z.string() },
      annotations: { title: 'Sleeper Lock-In plan', ...READ_ONLY },
    },
    run: (a) => lockIn(a),
  },
  {
    name: 'nba_fantasy_streamers',
    config: {
      title: 'NBA fantasy streamers',
      description: pre + 'Best pickups for the next 7 days or the rest of this week: per-game projection x games x availability, back-to-backs marked. Pass rostered players in exclude to see only free agents.',
      inputSchema: {
        window: z.enum(['next7', 'week']).default('next7').describe('"next7" (default) or "week" for the rest of this Monday-Sunday fantasy week.'), format: z.enum(['points', 'cats']).default('points').describe('"points" or "cats" (9-category).'), scoring: scoringArg,
        exclude: z.array(z.string().trim().min(1).max(80)).max(400).default([]).describe('Rostered players to leave out (names or ids). Empty = players ranked outside the top 75% of rosterable players.'),
        limit: z.number().int().min(1).max(60).default(20).describe('Most players to return (default 20).'), ...league,
      },
      outputSchema: { window: z.string(), format: z.string(), scoring: z.string(), players: z.array(loose), data_as_of: z.string().nullable() },
      annotations: { title: 'NBA fantasy streamers', ...READ_ONLY },
    },
    run: (a) => streamers(a),
  },
  {
    name: 'nba_injury_report',
    config: {
      title: 'NBA injury report with beneficiaries',
      description: pre + 'Current injury designations (Sleeper), best players first, each with the teammates whose minutes and per-36 production rose in games he missed.',
      inputSchema: { team: z.string().trim().max(3).optional().describe('Team abbreviation, e.g. "LAL".'), limit: z.number().int().min(1).max(100).default(25).describe('Most injured players to return (default 25).') },
      outputSchema: { players: z.array(loose), data_as_of: z.string().nullable(), url: z.string() },
      annotations: { title: 'NBA injury report with beneficiaries', ...READ_ONLY },
    },
    run: (a) => injuryReport(a),
  },
  {
    name: 'nba_team_profile',
    config: {
      title: 'NBA team profile',
      description: 'Basketball Savant Teams (wcehoops.com): a team\'s season: ratings and ranks, luck-adjusted net and expected wins, four factors, shot diet by zone (own and allowed), play types, and the schedule ahead (back-to-backs, strength of schedule). 1996-97 on.',
      inputSchema: { team: z.string().trim().min(2).max(40).describe('Abbreviation (BOS) or name (Celtics).'), season: z.string().trim().max(12).optional().describe('Season as two years, e.g. "2025-26". Omit for the latest with 10+ games.') },
      outputSchema: { season: z.string(), team: loose, ranks: loose, url: z.string() },
      annotations: { title: 'NBA team profile', ...READ_ONLY },
    },
    run: (a) => teamProfile(a),
  },
  {
    name: 'nba_lineups',
    config: {
      title: 'NBA lineup ratings',
      description: 'Basketball Savant Lineups (wcehoops.com): 5-man units or 2-man pairs with minutes, ratings, luck-adjusted net, and a sample-adjusted net pulled toward the team by a measured k. Filter by team or player. 2007-08 on.',
      inputSchema: {
        team: z.string().trim().max(40).optional().describe('Abbreviation or name; omit for every team.'), season: z.string().trim().max(12).optional().describe('e.g. "2025-26"; 2007-08 on.'), size: z.union([z.literal(5), z.literal(2)]).default(5).describe('5 for five-man lineups (default), 2 for two-man pairs.'),
        min_minutes: z.number().min(0).optional().describe('Minutes floor (default 50 for 5-man, 200 for 2-man; lower early in a season in progress, pro-rated to the games played).'), sort: z.enum(['sample_adjusted', 'luck_adjusted', 'raw', 'minutes']).default('sample_adjusted').describe('Sort by sample-adjusted net (default), luck-adjusted net, raw net, or minutes.'),
        player: z.string().trim().max(80).optional().describe('Only units including this player (last name is enough).'), limit: z.number().int().min(1).max(100).default(15).describe('Most units to return (default 15).'),
      },
      outputSchema: { season: z.string(), size: z.number(), k: z.number().nullable().optional(), units: z.array(loose), url: z.string() },
      annotations: { title: 'NBA lineup ratings', ...READ_ONLY },
    },
    run: (a) => lineups(a),
  },
  {
    name: 'nba_schedule',
    config: {
      title: 'NBA schedule for fantasy',
      description: 'Basketball Savant (wcehoops.com): games per team in the next 7 days or the rest of this fantasy week, with back-to-backs, most games first.',
      inputSchema: { window: z.enum(['next7', 'week']).default('next7').describe('"next7" (default) or "week" (rest of this Monday-Sunday week).'), limit: z.number().int().min(1).max(30).default(30).describe('Teams to return (default all 30).') },
      outputSchema: { window: z.string(), teams: z.array(loose), data_as_of: z.string().nullable() },
      annotations: { title: 'NBA schedule for fantasy', ...READ_ONLY },
    },
    run: (a) => schedule(a),
  },
]
