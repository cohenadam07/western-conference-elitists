// api/_basketball-lists.js — Basketball Savant's lists and the views below a season card: the
// Leaderboard Builder, the all-30 Teams table with a team's depth chart, a player's career
// (arc, peak, honours, a stat season by season, career highs) and his play types,
// with/without teammates and month-by-month splits. One section of the AI connector
// (api/mcp.js), beside api/_basketball.js, whose files, loader and name matching it shares.
//
// WHAT IT READS
//   savant-api/basketball/v1/seasons/<season>.json   every player's values with league and
//       position percentiles, rolling windows for the latest season, "likely to settle"
//       estimates for the season in progress, play types (pt), with/without (ww), honours (aw)
//   the page's own public files, as published: savant-teams.json and savant-teams-current.json
//       (the Teams tab), months/<id>.json (the per-stat chart by month)
//
// THE NUMBERS ARE THE PAGE'S. A board is the page's lbRender(): qualified players by default,
// ranked on one stat over the season or a rolling window, on where numbers are likely to settle
// while a season is young; its percentile is the page's default "vs. cohort" (everyone the
// filters let through) or "vs. league". The cohort percentile depends on the filters, so it is
// taken here with the page's own midrank. A career arc is the page's careerArc(): Box Plus/Minus
// season by season, a season counting only with 58 games or 70% of his team's. The Teams table
// is savant-teams.js's renderTeams(). tools/savant-api/check.mjs holds all of it to the page's
// own code.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, norm, ordinal, thousands } from './_core.js'
import { PEERS, WINDOW_TEXT, cardUrl, display, inSpan, loadMeta, loadSeason, parseSeason, resolvePlayer, startYear } from './_basketball.js'
import { PANEL_VIEWS, describePanel, extCells, loadExtPanels, loadExtPlayer, loadExtSeason } from './_basketball-ext.js'

const page = makeLoader('', { what: 'Basketball Savant', maxCached: 8, shape: () => true })
const SOURCE = 'Basketball Savant, Western Conference Elitists (wcehoops.com)'

// ---- the page's midrank percentile --------------------------------------------------------
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid } return lo }
function upperBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid } return lo }
export function percentile(v, sorted, lower) {
  const n = sorted ? sorted.length : 0
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

// A stat by key ("ts") or label ("True shooting %"); a near miss lists candidates.
function parseStat(input, metrics) {
  const q = norm(input)
  const exact = metrics.find((m) => m.key === String(input).trim() || norm(m.label) === q)
  if (exact) return exact
  const hits = metrics.filter((m) => norm(m.label).includes(q) || q.split(' ').every((w) => norm(m.label).includes(w)))
  if (hits.length === 1) return hits[0]
  const show = (hits.length ? hits : metrics).slice(0, 25).map((m) => `${m.key} (${m.label})`)
  throw new SavantError(`${hits.length ? `"${input}" fits ${hits.length} stats` : `No stat called "${input}"`}. Give a key or the full label: ${show.join('; ')}${hits.length > 25 || (!hits.length && metrics.length > 25) ? '; ...' : ''}.`)
}
const POS = { guard: 'Guard', guards: 'Guard', g: 'Guard', wing: 'Wing', wings: 'Wing', w: 'Wing', big: 'Big', bigs: 'Big', b: 'Big', all: 'All' }

// the season the Leaderboard Builder opens on: the newest with 30 qualified players
// (the page's defaultSeason())
async function defaultSeason(meta) {
  for (const s of meta.seasons) if ((meta.qualified[s] || {}).league >= 30) return s
  return meta.latestSeason
}

// ---- the Leaderboard Builder ----------------------------------------------------------------

export async function leaderboard(args) {
  const meta = await loadMeta()
  const season = parseSeason(args.season, meta) || await defaultSeason(meta)
  const file = await loadSeason(season)
  const m = args.stat ? parseStat(args.stat, meta.metrics) : meta.metrics.find((x) => x.key === 'pts')
  const windowKey = args.window || 'season'
  if (windowKey !== 'season' && !file.latest) throw new SavantError(`Rolling windows (last 10, 25, 75 games) are only kept for the latest season, ${meta.latestSeason}.`)
  const since = m.ext ? (m.first || m.since) : m.since
  if (startYear(season) < startYear(since)) throw new SavantError(`${m.label} was not tracked in ${season}; it starts in ${since}.`)
  const pos = args.position ? POS[norm(args.position)] : 'All'
  if (!pos) throw new SavantError('position is Guard, Wing, Big or All.')
  const settling = (args.estimate || 'settled') !== 'raw' && windowKey === 'season' && !!file.in_progress
  const valOf = (r, key) => {
    if (windowKey === 'season') {
      if (settling && r.settle && r.settle[key]) return r.settle[key][0]
      return r.m[key] ? r.m[key][0] : null
    }
    const w = r.w && r.w[windowKey]
    return w && w.m[key] ? w.m[key][0] : null
  }
  const mpgOf = (r) => (r.m.mpg ? r.m.mpg[0] : null)
  // The October 2026 additions (m.ext) come from savant-ext/s/<season>.json, never "settled"
  const extra0 = (args.columns || []).map((c) => parseStat(c, meta.metrics))
  let xcells = null
  if (m.ext || extra0.some((c) => c.ext)) {
    const xf = await loadExtSeason(season)
    if (!xf) throw new SavantError(`The added stats for ${season} could not be loaded right now, or do not reach that season. Try again in a minute, or pick a stat from the card's core.`)
    if (!(xf.windows || ['season']).includes(windowKey)) throw new SavantError(`${m.label} is a full-season number for ${season}; ask for the full season.`)
    xcells = extCells(xf, file, windowKey, meta.metrics.filter((x) => x.ext))
  }
  const baseVal = valOf
  const valOfAll = (r, key) => {
    const mt = meta.metrics.find((x) => x.key === key)
    if (mt && mt.ext) { const c = xcells && xcells.get(String(r.id)); return c && c[key] ? c[key][0] : null }
    return baseVal(r, key)
  }
  // lbEligible()
  const qualOnly = args.qualified_only !== false
  const cohort = file.players.filter((r) => {
    if (qualOnly && !r.qualified) return false
    if (pos !== 'All' && r.pos !== pos) return false
    if (args.team && r.team !== String(args.team).trim().toUpperCase()) return false
    const age = parseFloat(r.age)
    if (args.age_min != null && !(age >= args.age_min)) return false
    if (args.age_max != null && !(age <= args.age_max)) return false
    const exp = parseInt(r.exp, 10)
    if (args.exp_min != null && !(exp >= args.exp_min)) return false
    if (args.exp_max != null && !(exp <= args.exp_max)) return false
    if (args.min_mpg > 0) { const mp = mpgOf(r); if (miss(mp) || mp < args.min_mpg) return false }
    return true
  })
  const rows = cohort.map((r) => ({ r, v: valOfAll(r, m.key) })).filter((x) => !miss(x.v))
  rows.sort((a, b) => (m.lowerIsBetter ? a.v - b.v : b.v - a.v))
  const top = rows.slice(0, args.top || 25)
  // lbPct(): against the filtered cohort (the page's default) or every qualified player
  const basis = args.basis === 'league' ? 'league' : 'cohort'
  const src = basis === 'league' ? file.players.filter((r) => r.qualified) : cohort
  const pools = new Map()
  const poolOf = (key) => {
    if (!pools.has(key)) pools.set(key, Float64Array.from(src.map((r) => valOfAll(r, key)).filter((v) => !miss(v))).sort())
    return pools.get(key)
  }
  const extra = extra0.filter((x) => x.key !== m.key).slice(0, 5)
  const players = top.map((x, i) => {
    const r = x.r
    const est = !m.ext && settling && r.settle && r.settle[m.key]
    const out = {
      rank: i + 1, id: String(r.id), name: r.name, team: r.team, position: r.pos,
      value: x.v, display: display(m.unit, x.v, null), percentile: percentile(x.v, poolOf(m.key), m.lowerIsBetter),
      still_settling: est ? { actual: r.m[m.key][0], display: display(m.unit, r.m[m.key][0], null) } : null,
      url: cardUrl(r.id),
    }
    if (extra.length) out.columns = extra.map((c) => { const v = valOfAll(r, c.key); return { key: c.key, label: c.label, value: miss(v) ? null : v, display: display(c.unit, v, null), percentile: miss(v) ? null : percentile(v, poolOf(c.key), c.lowerIsBetter) } })
    return out
  })
  const notes = [
    `${qualOnly ? 'Qualified players' : 'Every player'}${pos !== 'All' ? ` at ${pos.toLowerCase()}` : ''}${args.team ? ` on ${String(args.team).toUpperCase()}` : ''}, ${windowKey === 'season' ? `${season}` : `${WINDOW_TEXT[windowKey]} of ${season}`}. The percentile is ${basis === 'league' ? 'against every qualified player that season' : 'against everyone these filters let through (the page\'s "vs. cohort")'}.`,
  ]
  if (settling) notes.push('Season in progress: a number still on a small sample is ranked where it is likely to settle (his number so far blended with his position\'s average, moved toward his own last season); still_settling gives what he has actually done. estimate "raw" ranks the raw numbers.')
  if (m.lowerIsBetter) notes.push('Lower is better for this stat, so the board runs low to high.')
  const what = m.explain && (typeof m.explain === 'string' ? m.explain : m.explain.what)
  const structured = {
    season, window: windowKey, position: pos, stat: { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, what: what || null, settles_around: m.settle ? { sample: m.settle.last, unit: m.settle.unit, hatched_under: m.settle.mean, measured: m.settle.how } : null },
    basis, total: rows.length, players, notes, url: `${SITE}/basketball-savant.html#lb`, data_as_of: day(file.through || file.generated || meta.generated), source: SOURCE,
  }
  if (!players.length) return { structured, text: `No players to rank by ${m.label} with these filters in ${season}.` }
  const L = [`${m.label}${m.lowerIsBetter ? ' (lower is better)' : ''}: Basketball Savant leaderboard, ${windowKey === 'season' ? season : `${season}, ${WINDOW_TEXT[windowKey]}`}${pos !== 'All' ? `, ${PEERS[pos]}` : ''}`]
  for (const p of players) {
    const cols = (p.columns || []).map((c) => `${c.label} ${c.display}${c.percentile == null ? '' : ` (${ordinal(c.percentile)})`}`).join('; ')
    L.push(`${p.rank}. ${p.name} (${p.team}, ${p.position}) ${p.display}${p.percentile == null ? '' : ` (${ordinal(p.percentile)} pct)`}${p.still_settling ? ` [likely to settle; ${p.still_settling.display} so far]` : ''}${cols ? `. ${cols}` : ''}`)
  }
  L.push('', ...notes)
  if (what) L.push(`${m.label}: ${what}`)
  if (m.settle) L.push(`It settles around ${m.settle.last.toLocaleString('en-US')} ${m.settle.unit} (hatched under ${m.settle.mean.toLocaleString('en-US')}; measured ${m.settle.how}).`)
  L.push('', `Page: ${structured.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the Teams table, and a team's depth chart ------------------------------------------------
const TEAM_COLS = [['w', 'W-L'], ['net', 'Net rating'], ['adjnet', 'Luck-adjusted net'], ['ortg', 'Offensive rating'], ['drtg', 'Defensive rating'], ['pace', 'Pace'],
  ['pythw', 'Pythagorean wins'], ['xw', 'Expected wins'], ['luck', 'Luck'], ['efg', 'eFG%'], ['tov', 'TOV%'], ['orb', 'ORB%'], ['ftr', 'FT rate'],
  ['oefg', 'Opp eFG%'], ['otov', 'Opp TOV%'], ['drb', 'DRB%'], ['oftr', 'Opp FT rate'], ['fg3r', '3PA rate']]
const SCHED_COLS = [['left', 'Games left'], ['next7', 'Next 7 days'], ['b2b', 'Back-to-backs left'], ['oppb2b', 'Opponents on a back-to-back'], ['sos', 'Strength of schedule']]
// savant-teams.js LOW_GOOD and getv(): which columns rank low to high, and where each lives
export const LOW_GOOD = { drtg: 1, tov: 1, oefg: 1, oftr: 1, b2b: 1, sos: 1, adjd: 1 }
async function teamsData() {
  const [a, c] = await Promise.all([page.load('savant-teams.json').catch(() => null), page.load('savant-teams-current.json').catch(() => null)])
  if (!a && !c) throw new SavantError('Team data could not be loaded right now. Try again in a minute.')
  // savant-teams.js mergeTeams()
  const out = { seasons: (a && a.seasons ? a.seasons.slice() : []), data: Object.assign({}, a && a.data), upcoming: null, current: null }
  if (c && c.data) {
    for (const s of c.seasons || []) {
      const b = c.data[s]
      if (!b) continue
      if (b.preseason) { out.upcoming = { season: s, sched: {} }; for (const t of b.teams || []) out.upcoming.sched[t.abbr] = t.sched; continue }
      out.data[s] = b
      if (!out.seasons.includes(s)) out.seasons.unshift(s)
      out.current = s
    }
  }
  out.seasons.sort((x, y) => parseInt(y, 10) - parseInt(x, 10))
  return out
}
const ok = (v) => v != null && Number.isFinite(v)
function getv(t, k) {
  const ff = t.ff || {}
  switch (k) {
    case 'efg': return ff.efg
    case 'tov': return ff.tov
    case 'orb': return ff.orb
    case 'ftr': return ff.ftr
    case 'oefg': return ff.oefg
    case 'otov': return ff.otov
    case 'drb': return ok(ff.oorb) ? 1 - ff.oorb : null
    case 'oftr': return ff.oftr
    case 'wpct': return t.gp ? t.w / t.gp : null
    case 'left': case 'b2b': case 'sos': case 'oppb2b': case 'next7': return t.sched ? t.sched[k] : null
    default: return t[k]
  }
}
function teamFmt(k, t) {
  const x = getv(t, k)
  const f1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—')
  if (k === 'w') return `${t.w}-${t.l}`
  if (['efg', 'tov', 'orb', 'ftr', 'oefg', 'otov', 'drb', 'oftr', 'fg3r'].includes(k)) return ok(x) ? (x * 100).toFixed(1) : '—'
  if (['net', 'adjnet', 'luck', 'sos'].includes(k)) { if (!ok(x)) return '—'; const s = Math.abs(x).toFixed(1); return (x > 0.0001 ? '+' : x < -0.0001 ? '−' : '') + s }
  if (['left', 'b2b', 'oppb2b', 'next7'].includes(k)) return ok(x) ? String(Math.round(x)) : '—'
  return f1(x)
}

export async function teamRankings({ season, sort = 'adjnet', team, top }) {
  const d = await teamsData()
  let s = season ? null : d.seasons[0]
  let noTable = false
  if (season) {
    const meta = await loadMeta()
    s = parseSeason(season, meta)
    if (!d.data[s]) {
      if (!team) throw new SavantError(`The Teams table has no ${s}. It covers ${d.seasons[d.seasons.length - 1]} through ${d.seasons[0]}.`)
      noTable = true
    }
  } else {
    const b = d.data[s]
    if (b && b.teams && b.teams.length && b.teams[0].gp < 10 && d.seasons[1]) s = d.seasons[1]
  }
  const b = d.data[s] || { teams: [] }
  const up = d.upcoming && d.seasons[0] === s ? d.upcoming : null
  const teams = b.teams.map((t) => { const c = { ...t }; if (up && up.sched[t.abbr]) c.sched = up.sched[t.abbr]; return c })
  const hasSched = teams.some((t) => t.sched)
  const cols = hasSched ? [...TEAM_COLS, ...SCHED_COLS] : TEAM_COLS
  const col = cols.find((c) => c[0] === sort || norm(c[1]) === norm(sort))
  if (!col) throw new SavantError(`sort is one of: ${cols.map((c) => `${c[0]} (${c[1]})`).join(', ')}.`)
  const sk = col[0]
  const lowg = LOW_GOOD[sk]
  teams.sort((a, b2) => { const x = getv(a, sk === 'w' ? 'wpct' : sk), y = getv(b2, sk === 'w' ? 'wpct' : sk); if (!ok(x)) return 1; if (!ok(y)) return -1; return lowg ? x - y : y - x })
  const rows = teams.slice(0, top || 30).map((t, i) => ({ rank: i + 1, team: t.abbr, name: t.name || t.abbr, values: Object.fromEntries(cols.map((c) => [c[0], teamFmt(c[0], t)])) }))
  const structured = { season: s, sort: sk, columns: cols.map((c) => ({ key: c[0], label: c[1] })), teams: rows, depth_chart: null, schedule_season: up ? up.season : null, url: `${SITE}/basketball-savant.html#teams`, source: SOURCE }
  const L = [noTable ? `The Teams table starts in ${d.seasons[d.seasons.length - 1]}, so there is no ${s} table; here is the depth chart.` : `NBA teams, ${s}, by ${col[1]}${lowg ? ' (lower is better)' : ''}${up ? ` (schedule columns are ${up.season})` : ''}:`]
  for (const r of rows) L.push(`${r.rank}. ${r.name}: ${col[1]} ${r.values[sk]}; ${cols.filter((c) => c[0] !== sk).slice(0, 6).map((c) => `${c[1]} ${r.values[c[0]]}`).join(', ')}`)
  // a team's depth chart: the page's openTeam(), Basketball Savant's own players
  if (team) {
    const meta = await loadMeta()
    const code = String(team).trim().toUpperCase()
    const sf = await loadSeason(meta.seasons.includes(s) ? s : meta.latestSeason)
    const ps = sf.players.filter((p) => p.team === code)
    if (!ps.length) throw new SavantError(`No ${code} players in Basketball Savant's ${sf.season}. Give the team's three-letter code, e.g. BOS.`)
    const mp = (p) => (p.m.mpg ? p.m.mpg[0] : 0)
    const groups = ['Guard', 'Wing', 'Big', 'Other'].map((g) => ({ group: g, players: ps.filter((p) => (g === 'Other' ? !['Guard', 'Wing', 'Big'].includes(p.pos) : p.pos === g)).sort((a, b2) => mp(b2) - mp(a)) }))
      .filter((g) => g.players.length)
      .map((g) => ({ group: g.group, players: g.players.map((p) => ({ id: String(p.id), name: p.name, mpg: +mp(p).toFixed(1), ppg: p.line && !miss(p.line.ppg) ? +(+p.line.ppg).toFixed(1) : null, rpg: p.line ? p.line.rpg ?? null : null, apg: p.line ? p.line.apg ?? null : null, url: cardUrl(p.id) })) }))
    structured.depth_chart = { team: code, season: sf.season, groups }
    L.push('', `${code} depth chart, ${sf.season} (by minutes per game):`)
    for (const g of groups) L.push(`${g.group === 'Other' ? 'Other' : `${g.group}s`}: ${g.players.map((p) => `${p.name} (${p.mpg.toFixed(1)} mpg${p.ppg != null ? `, ${p.ppg.toFixed(1)} ppg` : ''})`).join(', ')}`)
  }
  L.push('', 'Net and luck-adjusted net are points per 100 possessions; expected wins come from the luck-adjusted rating. nba_team_profile has one team in full: four factors, shot diet, play types and the schedule ahead.', '', `Page: ${structured.url}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- a career --------------------------------------------------------------------------------
const PEAK_MIN_GP = 58
const PEAK_MIN_SHARE = 70

export async function playerCareer({ player, stats }) {
  const meta = await loadMeta()
  const who = await resolvePlayer(player, null)
  const seasons = meta.seasons.filter((s) => inSpan(who, s)).slice().reverse()   // oldest first
  const files = await Promise.all(seasons.map((s) => loadSeason(s)))
  const rows = []
  seasons.forEach((s, i) => { const r = files[i].players.find((p) => String(p.id) === String(who.id)); if (r) rows.push({ s, r, file: files[i] }) })
  if (!rows.length) throw new SavantError(`No seasons on file for ${who.name}.`)
  // careerArc(): BPM season by season; a season counts with 58 games or 70% of his team's
  const eligible = (r) => {
    if (!r.qualified) return false
    const gp = r.m.avail ? r.gp : null
    const share = r.m.avail ? r.m.avail[0] : null
    return (!miss(gp) && gp >= PEAK_MIN_GP) || (!miss(share) && share >= PEAK_MIN_SHARE)
  }
  // trendPctOf(): his Box Plus/Minus inside his position's qualified pool, unclamped
  const posPct = (r, file) => {
    const v = r.m.bpm ? r.m.bpm[0] : null
    if (miss(v)) return null
    const pool = file.players.filter((q) => q.qualified && q.pos === r.pos && q.m.bpm && !miss(q.m.bpm[0])).map((q) => q.m.bpm[0])
    if (pool.length < 2) return null
    if (!r.qualified) pool.push(v)
    let less = 0, eq = 0
    for (const x of pool) { if (x < v) less++; else if (x === v) eq++ }
    return 100 * (less + 0.5 * eq) / pool.length
  }
  const pts = rows.map(({ s, r, file }) => {
    const okk = eligible(r)
    const b = okk && r.m.bpm ? r.m.bpm[0] : null
    const good = okk && !miss(b)
    const why = okk ? null : !r.qualified ? 'under the 20 games / 15 minutes qualifier' : `${r.gp == null ? 'too few games' : `${r.gp} games`}${r.m.avail ? ` (${r.m.avail[0].toFixed(0)}% of the team's)` : ''}, under the ${PEAK_MIN_GP}-game floor`
    const pp = good ? posPct(r, file) : null
    return { season: s, team: r.team, position: r.pos, games: r.gp ?? null, bpm: good ? b : null, bpm_position_percentile: pp == null ? null : Math.round(pp), counts: good, why_not: why, honours: r.aw || [] }
  })
  let peak = null
  for (const p of pts) if (p.counts && (!peak || p.bpm > peak.bpm)) peak = p
  const word = (c) => ((meta.awards || {}).labels || {})[c] || ((meta.awards || {}).short || {})[c] || c
  const honours = []
  for (const { s, r, file } of rows) {
    for (const c of r.aw || []) honours.push({ season: s, award: word(c) })
    // the All-Savant Team, once a season is over
    if (file.all_savant && !file.in_progress) file.all_savant.forEach((t, i) => { if (t.some((id) => String(id) === String(who.id))) honours.push({ season: s, award: `All-Savant ${i ? '2nd' : '1st'} Team` }) })
  }
  // any stats asked for, season by season, with his career high over seasons that count
  const asked = (stats || []).slice(0, 6).map((x) => parseStat(x, meta.metrics))
  // The additions (m.ext): finished seasons from his own file (savant-ext/p/<id>.json, both
  // percentiles ranked at build time), the season in progress from that season's file.
  let xp = null
  const xlive = {}
  if (asked.some((m) => m.ext)) {
    xp = await loadExtPlayer(who.id)
    const live = rows.find(({ file }) => file.in_progress)
    if (live) {
      const xf = await loadExtSeason(live.s)
      const cells = xf ? extCells(xf, live.file, 'season', meta.metrics.filter((m) => m.ext)) : null
      if (cells && cells.get(String(who.id))) xlive[live.s] = cells.get(String(who.id))
    }
  }
  const extCell = (m, s) => {
    if (xlive[s]) return xlive[s][m.key] || null
    if (!xp || !xp.seasons || !xp.seasons[s]) return null
    const i = xp.keys.indexOf(m.key)
    return i >= 0 ? xp.seasons[s][i] : null
  }
  const series = asked.map((m) => {
    const cellOf = (s, r) => (m.ext ? extCell(m, s) : r.m[m.key])
    const by = rows.filter(({ s }) => startYear(s) >= startYear(m.since)).map(({ s, r }) => { const c = cellOf(s, r); return c ? { season: s, value: c[0], display: display(m.unit, c[0], c[1]), league_percentile: c[1], position_percentile: c[2], counts: eligible(r) } : null }).filter(Boolean)
    let high = null
    for (const x of by) if (x.counts && (high == null || (m.lowerIsBetter ? x.value < high.value : x.value > high.value))) high = x
    return { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, seasons: by, career_high: high ? { season: high.season, value: high.value, display: high.display } : null }
  })
  const structured = {
    player: { id: String(who.id), name: who.name, from: who.from, to: who.to },
    arc: pts, peak: peak ? { season: peak.season, bpm: peak.bpm } : null, honours, series,
    notes: [`The arc is Box Plus/Minus season by season. A season counts toward his peak and career highs with at least ${PEAK_MIN_GP} games or ${PEAK_MIN_SHARE}% of his team's games, and only once he qualifies (20 games, 15 minutes a game). BPM is a model estimate, not a measurement.`],
    url: cardUrl(who.id), source: SOURCE,
  }
  const sg = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)
  const L = [`${who.name}, career (${who.from} to ${who.to}, ${rows.length} seasons)`]
  L.push(`Box Plus/Minus by season: ${pts.map((p) => `${p.season} ${p.counts ? `${sg(p.bpm)} (${p.bpm_position_percentile == null ? 'n/a' : ordinal(p.bpm_position_percentile)} vs. ${PEERS[p.position] || p.position})` : `— (${p.why_not})`}`).join('; ')}.`)
  L.push(peak ? `Peak season: ${peak.season}, ${sg(peak.bpm)} BPM.` : 'No season clears the floor for a peak.')
  if (honours.length) L.push(`Honours: ${honours.map((h) => `${h.award} ${h.season}`).join(', ')}.`)
  for (const sr of series) {
    L.push('', `${sr.label}, season by season (league percentile):`)
    L.push(sr.seasons.map((x) => `${x.season} ${x.display} (${x.league_percentile == null ? 'n/a' : ordinal(x.league_percentile)})${x.counts ? '' : '*'}`).join(', '))
    L.push(sr.career_high ? `Career high (seasons that count): ${sr.career_high.display} in ${sr.career_high.season}.${sr.seasons.some((x) => !x.counts) ? ' * = a season under the floor.' : ''}` : 'No season that counts has it.')
  }
  L.push('', ...structured.notes, '', `Card: ${structured.url}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- play types, with/without, by month, shots ---------------------------------------------
const PT_NAME = { Isolation: 'Isolation', Transition: 'Transition', PRBallHandler: 'Pick-and-roll ball handler', PRRollman: 'Pick-and-roll roll man', Postup: 'Post-up', Spotup: 'Spot-up', Handoff: 'Handoff', Cut: 'Cut', OffScreen: 'Off screen', OffRebound: 'Putbacks', Misc: 'Misc' }

// Basketball Coaching Savant's team-season files (pipeline/basketball/coaching/build.py): the
// Rotation Map row for one player, for the card's rotation strip and the "rotation" view.
const bcsFiles = makeLoader('bcs', { what: 'Basketball Coaching Savant', shape: (b) => b && typeof b === 'object' && Array.isArray(b.coaches) })
const ROT_ALIAS = { NJN: 'BKN', BRK: 'BKN', SEA: 'OKC', VAN: 'MEM', CHH: 'CHA', CHO: 'CHA', NOH: 'NOP', NOK: 'NOP', NO: 'NOP', PHO: 'PHX', GS: 'GSW', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', WSB: 'WAS' }

export async function playerSplits({ player, season, view = 'play_types' }) {
  const meta = await loadMeta()
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted)
  const s = wanted || who.to
  const file = await loadSeason(s)
  const r = file.players.find((p) => String(p.id) === String(who.id))
  if (!r) throw new SavantError(`${who.name} has no ${s} season in Basketball Savant (${who.from} to ${who.to}).`)
  const base = { player: { id: String(who.id), name: who.name, team: r.team, position: r.pos }, season: s, view, url: cardUrl(who.id), source: SOURCE }
  // The breakdown panels (the October 2026 additions): savant-ext/panels/<season>.json
  if (PANEL_VIEWS[view]) {
    const [key, title] = PANEL_VIEWS[view]
    const pf = await loadExtPanels(s)
    const d = pf && pf.players && (pf.players[who.id] || pf.players[String(who.id)])
    const pd = d && d[key]
    if (!pd || (Array.isArray(pd) ? !pd.some(Boolean) : !Object.keys(pd).length)) {
      throw new SavantError(`No ${title.toLowerCase()} for ${who.name} in ${s}.${pf ? ` ${EXT_REACH[key] || ''}` : ' The breakdowns could not be loaded right now; try again in a minute.'}`.trim())
    }
    const { data, lines } = describePanel(key, pd)
    const what = ((meta.panels || {})[key] || {}).what
    const text = [`${who.name}, ${s}: ${title}`, ...lines, ...(what ? ['', what] : []), '', `Card: ${base.url}`, `Source: ${SOURCE}.`]
    return { structured: { ...base, breakdown: { title, data } }, text: text.join('\n') }
  }
  if (view === 'play_types') {
    // The cutoffs travel with the data: seasons/<season>.json carries play_types for the
    // season in progress (~/Basketball-Savant/extras_engine.playtype_meta). A finished season
    // has none — its percentile is the NBA's and is always there.
    const ptm = file.play_types || null
    const floor = (ptm && ptm.nba_min_poss) || 10
    if (!r.pt) {
      throw new SavantError(`No play-type numbers for ${who.name} in ${s}. The NBA publishes a player's play type only once he has ${floor} possessions of it, so nothing he has run less than that appears${ptm ? ' — and the season is only a few games old' : ''}. Synergy play types start in 2015-16.`)
    }
    // how each play type ends (the card's More columns), from savant-ext/panels when it is there
    const pf = await loadExtPanels(s)
    const ptx = (pf && pf.players && ((pf.players[who.id] || pf.players[String(who.id)] || {}).ptx)) || {}
    const types = Object.entries(r.pt).map(([k, v]) => {
      const small = ptm != null && v[3] < ptm.sample_flag
      const t = { type: PT_NAME[k] || k, share: v[0], points_per_possession: v[1], percentile: v[2] ?? null, possessions: v[3] }
      const x = ptx[k]
      if (x) t.endings = { efg_pct: x[5], scored_pct: x[4], turnover_pct: x[0], free_throw_pct: x[1], shooting_foul_pct: x[2], and_one_pct: x[3] }
      if (ptm) t.small_sample = small
      if (t.percentile == null && ptm) {
        t.percentile_note = small
          ? `No percentile: ${v[3]} possessions, under the ${ptm.sample_flag} a percentile needs.`
          : `No percentile: only ${(ptm.pools && ptm.pools[k]) || 0} players have ${ptm.sample_flag}+ possessions of this play type, under the ${ptm.pool_min} a ranking needs.`
      }
      return t
    }).sort((a, b) => b.share - a.share)
    const pctTxt = (t) => (t.percentile == null ? (t.small_sample ? 'small sample, no percentile' : 'no percentile') : `${ordinal(t.percentile)} percentile`)
    const notes = ptm
      ? [`The season is in progress. The percentile ranks his points per possession on that play type against the players with ${ptm.sample_flag}+ possessions of it, league-wide, and is null under that — a play type marked small_sample is a real number on too little sample, not a ranking. The NBA publishes a player's play type only once he has ${floor} possessions of it, so a type he has run less than that is missing rather than zero. Synergy credits the finisher of a possession, not the man who set it up.`]
      : ['The percentile ranks his points per possession on that play type against other players with enough of it. Synergy credits the finisher of a possession, not the man who set it up.']
    const ends = (t) => (t.endings ? `; eFG ${t.endings.efg_pct.toFixed(1)}%, scored on ${t.endings.scored_pct.toFixed(1)}%, turnover on ${t.endings.turnover_pct.toFixed(1)}%, free throws on ${t.endings.free_throw_pct.toFixed(1)}%` : '')
    const text = [`${who.name}, ${s} play types (Synergy):`, ...types.map((t) => `- ${t.type}: ${t.share.toFixed(1)}% of his possessions (${thousands(t.possessions)}), ${t.points_per_possession.toFixed(3)} points per possession (${pctTxt(t)})${ends(t)}`),
      '', ...notes, '', `Card: ${base.url}`, `Source: ${SOURCE}.`]
    return { structured: { ...base, ...(ptm ? { cutoffs: ptm } : {}), play_types: types }, text: text.join('\n') }
  }
  if (view === 'with_without') {
    if (!r.ww || !r.ww.length) throw new SavantError(`No with/without split for ${who.name} in ${s}: it needs teammates who missed enough games.`)
    const ww = r.ww.map((x) => ({ teammate: x.name, teammate_id: String(x.id), games_with: x.gw, games_without: x.gwo, with: x.w, without: x.wo, change: x.d ?? null }))
    const line = (o) => ['min', 'pts', 'reb', 'ast', 'usg'].filter((k) => o[k] != null).map((k) => `${o[k]} ${k}`).join(', ')
    const text = [`${who.name}, ${s}: with and without teammates`, ...ww.map((x) => `- With ${x.teammate} (${x.games_with} games): ${line(x.with)}. Without (${x.games_without} games): ${line(x.without)}.`),
      '', 'Per-game lines in the games each teammate played and missed. Games apart are few and the schedule differs, so read them as hints, not effects.', '', `Card: ${base.url}`, `Source: ${SOURCE}.`]
    return { structured: { ...base, with_without: ww }, text: text.join('\n') }
  }
  if (view === 'rotation') {
    if (s < '2002-03') throw new SavantError(`The rotation data begins in 2002-03; ${who.name}'s ${s} is before it.`)
    const key = `${ROT_ALIAS[r.team] || r.team}-${s}`
    let file
    try { file = await bcsFiles.load(`t/${key}.json`) } catch (e) { throw new SavantError(`No Rotation Map for ${r.team} in ${s} yet.`) }
    // the coach he played the most games for that season
    let t = null, row = null
    for (const e of file.coaches || []) { const x = e.rotation.rows.find((y) => String(y.id) === String(who.id)); if (x && (!row || x.gp > row.gp)) { row = x; t = e } }
    if (!row) throw new SavantError(`${who.name} is not on a ${r.team} Rotation Map for ${s}: under 100 minutes with the team, or his minutes came with another team that season.`)
    const rotation = { coach: t.coach_name, coach_id: t.coach, team: file.team, games_played: row.gp, starts: row.starts, minutes: row.min, mpg: row.mpg, usual_windows: row.text, windows_minutes: row.windows, on_share_by_minute: row.played, on_script_pct: row.off != null ? +(100 * (1 - row.off)).toFixed(1) : null, off_by_choice_pct: row.off_choice != null ? +(100 * row.off_choice).toFixed(1) : null, page: `${SITE}/basketball-coaching-savant.html#c=${encodeURIComponent(t.coach)}&season=${s}` }
    const text = [`${who.name}, ${s}, under ${t.coach_name} (${t.team}): ${row.text}.`, `${row.mpg} minutes a game over ${row.gp} games (${row.starts} starts).${rotation.on_script_pct != null ? ` ${rotation.on_script_pct}% of his scripted minutes went to the coach's script${rotation.off_by_choice_pct != null ? `, ${rotation.off_by_choice_pct}% off it by choice (no absence, blowout or foul trouble to explain it)` : ''}.` : ''}`, `Share of the games he played that he was on the floor, by minute (Q1 to Q4, measured on minutes still in the balance): ${row.played.map((v, i) => (i % 12 === 0 ? `| Q${i / 12 + 1}: ` : '') + v).join(' ')}`, 'His usual windows are the minutes where that share is 60% or better. The model\'s view, not a verdict: it cannot see fatigue, minor injuries, match-ups or development plans.', '', `Rotation Map: ${rotation.page}`, `Card: ${base.url}`, `Source: ${SOURCE}; Basketball Coaching Savant.`]
    return { structured: { ...base, rotation }, text: text.join('\n') }
  }
  if (view === 'months') {
    const idx = await page.load('months/index.json').catch(() => ({}))
    if (!idx || !idx[who.id] || !idx[who.id].includes(s)) throw new SavantError(`No month-by-month split for ${who.name} in ${s}.`)
    const md = await page.load(`months/${who.id}.json`)
    const sm = md[s] || {}
    const months = Object.keys(sm).sort().map((mk) => ({ month: mk, games: sm[mk].gp, minutes: sm[mk].min, stats: Object.fromEntries(Object.entries(sm[mk]).filter(([k]) => k !== 'gp' && k !== 'min')) }))
    const by = Object.fromEntries(meta.metrics.map((m) => [m.key, m]))
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const show = ['pts', 'ts', 'usg', 'ast', 'reb75', 'tov', 'tp3', 'mpg'].filter((k) => by[k])
    const text = [`${who.name}, ${s} by month:`, ...months.map((x) => `- ${MON[+x.month.slice(5, 7) - 1]} ${x.month.slice(0, 4)} (${x.games} games): ${show.filter((k) => x.stats[k] != null).map((k) => `${by[k].label} ${display(by[k].unit, x.stats[k], null)}`).join('; ')}`),
      '', 'Box-score and derived stats split by calendar month. Model and tracking stats (BPM, PER, hustle, Synergy) have no monthly form. Months carry no percentiles: a month is too small a sample to rank.', '', `Card: ${base.url}`, `Source: ${SOURCE}.`]
    return { structured: { ...base, months }, text: text.join('\n') }
  }
  // shots: the page draws a heatmap, not numbers
  const idx = await page.load('shots/index.json').catch(() => ({}))
  if (!idx || !idx[who.id] || !idx[who.id].includes(s)) throw new SavantError(`No shot chart for ${who.name} in ${s}. Shot locations exist from 1996-97 on.`)
  const sd = (await page.load(`shots/${who.id}.json`))[s]
  const text = [`${who.name}, ${s}: a shot chart of ${thousands(+sd.n)} field-goal attempts is on his card, drawn as a heatmap of where he shoots more or less often than a league-average player and how efficiently against the league from each spot. It is a picture, not a table: open the card to read it. His shooting splits by distance and type are in nba_get_player_profile, group "offense".`, '', `Card: ${base.url}`]
  return { structured: { ...base, shots: { attempts: +sd.n } }, text: text.join('\n') }
}

// what a missing breakdown means, by panel
const EXT_REACH = {
  sm: 'Shot types come from every attempt\'s play-by-play tag, 1996-97 on.',
  ss: 'Shot splits are NBA tracking, 2013-14 on.',
  tp: 'Touches are NBA tracking, 2013-14 on.',
  pn: 'Passing networks are NBA tracking, 2013-14 on, for players with 300+ minutes; teammates under 50 passes are left out.',
  dpt: 'Defensive play types are Synergy, 2015-16 on.',
  cl: 'Clutch needs minutes in the last five minutes of a game within five points.',
  sp: 'Splits come from his game logs.',
  off4: 'On/off four factors need minutes both on and off the floor.',
  tm: 'The turnover mix comes from ESPN play-by-play, 2002-03 on.',
  hs: 'Handle Score is the NBA\'s, 2025-26 on.',
  dk: 'Dunk Score is the NBA\'s, 2024-25 on.',
  pe: 'The position estimate is Basketball Reference\'s, 1996-97 on.',
}

// ---- the tools ---------------------------------------------------------------------------------
const row = z.record(z.string(), z.any())
export const tools = [
  {
    name: 'nba_leaderboard',
    config: {
      title: 'NBA leaderboard',
      description:
        'Basketball Savant\'s Leaderboard Builder (wcehoops.com): the top NBA players by any of its ~200 stats, for a season from 1979-80 or the latest season\'s last 10, 25 or 75 games. Filters: position, team, age, years in the league, minutes per game, qualified only. While a season is young it ranks where numbers are likely to settle. The percentile is against the filtered group (the page\'s default) or the whole league.',
      inputSchema: {
        stat: z.string().trim().max(80).optional().describe('Stat key or label, e.g. "ts" or "True shooting %". Omit for points.'),
        season: z.string().trim().max(12).optional().describe('e.g. "2025-26". Omit for the page\'s default season.'),
        window: z.enum(['season', 'l10', 'l25', 'l75']).optional().describe('Latest season only: last 10, 25 or 75 games.'),
        position: z.string().trim().max(10).optional().describe('Guard, Wing, Big or All (default).'),
        team: z.string().trim().max(3).optional().describe('Team abbreviation, e.g. "BOS".'),
        age_min: z.number().optional().describe('Minimum age.'),
        age_max: z.number().optional().describe('Maximum age.'),
        exp_min: z.number().int().optional().describe('Minimum years in the league.'),
        exp_max: z.number().int().optional().describe('Maximum years in the league.'),
        min_mpg: z.number().min(0).max(48).optional().describe('Minimum minutes per game.'),
        qualified_only: z.boolean().optional().describe('Default true.'),
        basis: z.enum(['cohort', 'league']).optional().describe('Percentile against the filtered group (default) or every qualified player.'),
        estimate: z.enum(['settled', 'raw']).optional().describe('Season in progress: rank where numbers are likely to settle (default) or the raw numbers.'),
        columns: z.array(z.string().max(80)).max(5).optional().describe('Up to 5 more stats to show.'),
        top: z.number().int().min(1).max(100).default(25).describe('How many (default 25).'),
      },
      outputSchema: { season: z.string(), window: z.string(), position: z.string(), stat: row, basis: z.string(), total: z.number(), players: z.array(row), notes: z.array(z.string()), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'NBA leaderboard', ...READ_ONLY },
    },
    run: (args) => leaderboard(args),
  },
  {
    name: 'nba_team_rankings',
    config: {
      title: 'NBA teams table',
      description:
        'Basketball Savant\'s Teams table (wcehoops.com): all 30 NBA teams for a season from 1996-97, sorted by any column: record, net and luck-adjusted net rating, offensive and defensive rating, pace, expected wins, luck, the four factors on both ends, 3-point rate, and the schedule ahead. Give a team for its depth chart (players by position, by minutes).',
      inputSchema: {
        sort: z.string().trim().max(40).default('adjnet').describe('Column key or name, e.g. "adjnet", "drtg", "pace", "xw". Default luck-adjusted net.'),
        season: z.string().trim().max(12).optional().describe('e.g. "2024-25". Omit for the page\'s default.'),
        team: z.string().trim().max(3).optional().describe('A team abbreviation for its depth chart, e.g. "OKC".'),
        top: z.number().int().min(1).max(30).optional().describe('How many teams (default all 30).'),
      },
      outputSchema: { season: z.string(), sort: z.string(), columns: z.array(row), teams: z.array(row), depth_chart: row.nullable(), schedule_season: z.string().nullable(), url: z.string(), source: z.string() },
      annotations: { title: 'NBA teams table', ...READ_ONLY },
    },
    run: (args) => teamRankings(args),
  },
  {
    name: 'nba_player_career',
    config: {
      title: 'NBA player career',
      description:
        'An NBA player\'s career on Basketball Savant (wcehoops.com): his Box Plus/Minus season by season with each season\'s percentile against his position, his peak season (58+ games), and his honours (MVP, All-NBA, All-Star, champion, All-Savant Team and the rest). Give up to 6 stats to follow them season by season with his career high.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nba_search_players or a full name.'),
        stats: z.array(z.string().max(80)).max(6).optional().describe('Stat keys or labels to follow season by season.'),
      },
      outputSchema: { player: row, arc: z.array(row), peak: row.nullable(), honours: z.array(row), series: z.array(row), notes: z.array(z.string()), url: z.string(), source: z.string() },
      annotations: { title: 'NBA player career', ...READ_ONLY },
    },
    run: (args) => playerCareer(args),
  },
  {
    name: 'nba_player_splits',
    config: {
      title: 'NBA player play types and splits',
      description:
        'Below an NBA player\'s season card on Basketball Savant (wcehoops.com). "play_types": Synergy play types (share, points per possession, percentile, how each ends; thin samples are marked). "with_without": his line with and without teammates. "months": month by month. "shots": whether his shot chart exists. "rotation": his row of his coach\'s Rotation Map (Basketball Coaching Savant): when he usually plays and how often his minutes go off script. Breakdowns: shot_menu, shot_splits (dribbles, touch time, shot clock, defender), touches, passing, defensive_play_types, clutch, game_splits (home/away, wins, rest), on_off_four_factors, turnover_mix, handle_score, dunk_score, position_estimate.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nba_search_players or a full name.'),
        view: z.enum(['play_types', 'with_without', 'months', 'shots', 'rotation', ...Object.keys(PANEL_VIEWS)]).default('play_types').describe('Which view: play_types, with_without, months, shots, rotation (his row of the coach\'s Rotation Map: usual windows, on-floor share by minute, on-script rate; 2002-03 on), or a breakdown: shot_menu, shot_splits, touches, passing, defensive_play_types, clutch, game_splits, on_off_four_factors, turnover_mix, handle_score, dunk_score, position_estimate.'),
        season: z.string().trim().max(12).optional().describe('e.g. "2025-26". Omit for his latest.'),
      },
      outputSchema: {
        player: row, season: z.string(), view: z.string(), url: z.string(), source: z.string(),
        play_types: z.array(row).optional(), with_without: z.array(row).optional(), months: z.array(row).optional(), shots: row.optional(), rotation: row.optional(), breakdown: row.optional(), cutoffs: row.optional(),
      },
      annotations: { title: 'NBA player play types and splits', ...READ_ONLY },
    },
    run: (args) => playerSplits(args),
  },
]
