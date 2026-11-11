// The analyst exam's engine (tools/savant-mcp/exam/): reading the data files, the recipes that turn
// rows into an answer, and talking to the connector.
//
// A question is a recipe and its parameters. The same recipe answers it twice:
//   gold      from the data files themselves, read here with this file's own filter and sums
//             (nothing from api/ is imported), so the gold is independent of the connector's code
//   through   the connector's tools, called as an assistant would call them (savant_data paged to
//             the end, or a profile or leaderboard tool), over MCP
// and the self-check says whether the two agree within the question's tolerance.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// ---- files: local (public/, out/dataroom) or live (the site, the release assets) ----------------
export function makeFiles({ site = null, hosted = path.join(ROOT, 'out', 'dataroom'), assets = 'https://github.com/cohenadam07/western-conference-elitists/releases/download/dataroom' } = {}) {
  const memo = new Map()
  async function json(rel) {
    if (memo.has(rel)) return memo.get(rel)
    let v
    if (site) {
      const res = await fetch(`${site}/${rel}`, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
      v = JSON.parse(await res.text())
    } else {
      const p = path.join(ROOT, 'public', rel)
      v = existsSync(p + '.gz') ? JSON.parse(gunzipSync(readFileSync(p + '.gz'))) : JSON.parse(readFileSync(p, 'utf8'))
    }
    memo.set(rel, v)
    return v
  }
  async function asset(sport, table, season) {
    const key = `${sport}-${table}-${season}`
    if (memo.has(key)) return memo.get(key)
    let b
    if (site) {
      const res = await fetch(`${assets}/${key}.json.gz`, { signal: AbortSignal.timeout(60000), redirect: 'follow' })
      if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
      b = Buffer.from(await res.arrayBuffer())
    } else b = readFileSync(path.join(hosted, sport, table, `${season}.json.gz`))
    const v = JSON.parse((b[0] === 0x1f ? gunzipSync(b) : b).toString('utf8'))
    if (memo.size > 6) memo.delete(memo.keys().next().value)
    memo.set(key, v)
    return v
  }
  return { json, asset }
}

// ---- one table's rows, as objects ----------------------------------------------------------------
const HOSTED_TABLES = new Set(['nba/player_games', 'nba/shots', 'nfl/plays', 'nfl/player_games', 'cfb/plays'])
export async function tableRows(F, { sport, table, season, team }) {
  let cols, rows
  if (HOSTED_TABLES.has(`${sport}/${table}`)) { const d = await F.asset(sport, table, season); cols = d.columns; rows = d.rows }
  else if (['nfl/games', 'cfb/games', 'ufc/fights', 'ufc/rounds'].includes(`${sport}/${table}`)) { const d = await F.json(`dataroom/${sport}/${table}/${season}.json`); cols = d.columns; rows = d.rows }
  else if (sport === 'nba' && table.startsWith('coaching_')) { const d = await F.json(`bcs/data/${table.slice(9)}/${season}.json`); cols = d.columns; rows = d.rows }
  else if (sport === 'cbb' && table.startsWith('coaching_')) { const t = table.slice(9); const d = await F.json(t === 'programs' ? 'cbcs/data/programs.json' : `cbcs/data/${t}/${season}.json`); cols = d.cols; rows = d.rows }
  else if (sport === 'cbb' && table === 'games') {
    const d = await F.json(`cbb/games/${season}.json`)
    const names = new Map((await F.json('cbb/search.json')).teams.map((t) => [t[0], t[1]]))
    const tid = team ? await cbbTeamId(F, team) : null
    const h = d.cols.indexOf('home'), a = d.cols.indexOf('away')
    cols = [...d.cols, 'home_team', 'away_team']
    rows = d.rows.filter((r) => !tid || r[h] === tid || r[a] === tid).map((r) => [...r, names.get(r[h]) || 'Non-D1', names.get(r[a]) || 'Non-D1'])
  } else if (sport === 'cbb' && table === 'possessions') {
    const tid = await cbbTeamId(F, team)
    const d = await F.json(`cbb/pos/${season}/${tid}.json`); cols = d.cols; rows = d.rows
  } else throw new Error(`the exam has no reader for ${sport} ${table}`)
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]))
  return rows.map((r) => new Proxy(r, { get: (o, k) => (k in ix ? o[ix[k]] : undefined) }))
}
export async function cbbTeamId(F, team) {
  const s = await F.json('cbb/search.json')
  const q = String(team).toLowerCase()
  const t = s.teams.find((x) => String(x[0]) === q || String(x[1]).toLowerCase() === q) || s.teams.find((x) => String(x[1]).toLowerCase().startsWith(q))
  if (!t) throw new Error(`no cbb team ${team}`)
  return t[0]
}

// ---- this file's own filter (the connector's ops, written again, not imported) ------------------
const num = (x) => (typeof x === 'number' ? x : x != null && x !== '' && Number.isFinite(+x) ? +x : null)
function cmp(v, x) { if (v == null || x == null) return null; const a = num(v), b = num(x); if (a != null && b != null) return a - b; return String(v) < String(x) ? -1 : String(v) > String(x) ? 1 : 0 }
const eq = (v, x) => { const c = cmp(v, x); return c == null ? String(v) === String(x) : c === 0 }
export function keep(r, filters = []) {
  for (const f of filters) {
    const v = r[f.column]
    const c = ['gte', 'lte', 'gt', 'lt'].includes(f.op) ? cmp(v, f.value) : null
    if (f.op === 'eq' && !eq(v, f.value)) return false
    if (f.op === 'ne' && eq(v, f.value)) return false
    if (f.op === 'in' && !f.value.some((x) => eq(v, x))) return false
    if (f.op === 'gte' && (c == null || c < 0)) return false
    if (f.op === 'lte' && (c == null || c > 0)) return false
    if (f.op === 'gt' && (c == null || c <= 0)) return false
    if (f.op === 'lt' && (c == null || c >= 0)) return false
    if (f.op === 'contains' && !String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase())) return false
    if (f.op === 'null' && v != null) return false
    if (f.op === 'notnull' && v == null) return false
  }
  return true
}

// ---- the recipes: rows -> answer -------------------------------------------------------------------
// metric: {fn: count | sum | mean | max | min | ratio | rate, col, num, den}
//   ratio  sum(num) / sum(den)    rate  share of rows where col is 1 (or truthy)
export function measure(rows, m) {
  const vals = (c) => rows.map((r) => num(r[c])).filter((v) => v != null)
  switch (m.fn) {
    case 'count': return rows.length
    case 'sum': return vals(m.col).reduce((a, b) => a + b, 0)
    case 'mean': { const v = vals(m.col); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    case 'max': { const v = vals(m.col); return v.length ? Math.max(...v) : null }
    case 'min': { const v = vals(m.col); return v.length ? Math.min(...v) : null }
    case 'ratio': { const d = vals(m.den).reduce((a, b) => a + b, 0); return d ? vals(m.num).reduce((a, b) => a + b, 0) / d : null }
    case 'ratio_count': { return rows.length ? vals(m.num).reduce((a, b) => a + b, 0) / rows.length : null }
    case 'rate': { const v = rows.map((r) => r[m.col]).filter((x) => x != null); return v.length ? v.filter((x) => x === 1 || x === true || x === 'W').length / v.length : null }
    default: throw new Error(`metric ${m.fn}`)
  }
}

// answer(rows, spec): spec.group -> groups; pick (max|min) -> {key, value}; key -> that group's value;
// rank_of -> its rank (1 = highest unless ascending); having -> {fn, col, min} a group must clear.
export function answer(rows, spec) {
  if (!spec.group) return { value: measure(rows, spec.metric) }
  const g = new Map()
  for (const r of rows) { const k = spec.group.map((c) => r[c]).join(' | '); if (!g.has(k)) g.set(k, []); g.get(k).push(r) }
  let list = [...g.entries()].map(([k, rs]) => ({ key: k, value: measure(rs, spec.metric), n: spec.having ? measure(rs, spec.having) : rs.length }))
  if (spec.having) list = list.filter((x) => x.n >= spec.having.min)
  list = list.filter((x) => x.value != null).sort((a, b) => (spec.ascending ? a.value - b.value : b.value - a.value) || (a.key < b.key ? -1 : 1))
  if (spec.key != null) { const i = list.findIndex((x) => x.key === String(spec.key)); return spec.rank_of ? { value: i + 1, of: list.length } : { value: i >= 0 ? list[i].value : null } }
  if (spec.pick) { const x = list[0]; return x ? { key: x.key, value: x.value } : { key: null, value: null } }
  return { value: list.slice(0, spec.top || 5).map((x) => [x.key, x.value]) }
}

// The columns a recipe needs (so the tool calls ask for just those)
export function needed(q) {
  const s = new Set()
  const list = (x) => (Array.isArray(x) ? x : [])
  for (const f of [...(q.filters || []), ...list(q.a), ...list(q.b)]) s.add(f.column)
  for (const m of [q.metric, q.having, Array.isArray(q.a) ? null : q.a, Array.isArray(q.b) ? null : q.b].filter(Boolean)) for (const k of ['col', 'num', 'den']) if (m[k]) s.add(m[k])
  for (const k of ['num', 'den', 'value', 'weight', 'col']) if (typeof q[k] === 'string') s.add(q[k])
  if (q.metric && q.metric.fn === 'ts') ['pts', 'fga', 'fta'].forEach((c) => s.add(c))
  for (const c of q.group || []) s.add(c)
  return [...s]
}

// ---- comparing ---------------------------------------------------------------------------------------
export function agrees(gold, got, tol) {
  if (gold == null || got == null) return gold === got
  if (typeof gold === 'number') return typeof got === 'number' && Math.abs(gold - got) <= (tol ?? 1e-9)
  if (Array.isArray(gold)) return Array.isArray(got) && gold.length === got.length && gold.every((x, i) => agrees(x, got[i], tol))
  if (typeof gold === 'object') return Object.keys(gold).every((k) => agrees(gold[k], got[k], typeof gold[k] === 'number' ? tol : undefined))
  return String(gold) === String(got)
}
export const round = (v, d = 4) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : Array.isArray(v) ? v.map((x) => round(x, d)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x, d)])) : v)
