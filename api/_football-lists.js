// api/_football-lists.js — Football Savant's lists: the Leaderboard Builder, the team page and
// a player's career. One section of the AI connector (api/mcp.js), beside api/_football.js,
// whose files, loader and name matching it shares.
//
// WHAT IT READS
//   seasons/<year>.json   every player's bars (m), plus the stats of panels the card drops for
//                         a thin sample (xm), which the page's boards still rank; the team
//                         table, ranks, line grades and rosters (teams)
//   careers/<POS>.json    every career of two seasons or more filed at the position he played
//                         most, with each stat ranked among careers at that position
//   the page's own football-weekly/<season>/form-<n>.json, for a board over a player's last
//   4, 8 or 17 games in the season being played
//
// THE NUMBERS ARE THE PAGE'S. A board is the page's lbRender(): qualified players at one
// position, ranked on one stat, "settled" (enough of the stat's own sample to mean it),
// "likely to settle" (in the season being played, ranked where each number is likely to
// finish) or "everyone". The percentiles are the ones the build wrote. The one thing worked
// out here is a window board: the page ranks the last N games against everyone else's same
// stretch, from a file the connector reads as published, so the rank is taken here with the
// page's own midrank. tools/savant-football/check.mjs holds every board, every team page and
// every career to the page's own code.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, norm, ordinal, thousands } from './_core.js'
import {
  SOURCE, cardUrl, display, files, loadMeta, loadSeason, parseSeason, played, resolvePlayer, rowsOf, seasonsOf, teamIn,
} from './_football.js'

// The page's own weekly files, read as published (they carry no schema field).
const pageFiles = makeLoader('football-weekly', { what: 'Football Savant', maxCached: 4, shape: (b) => b.players && typeof b.players === 'object' })
const loadCareers = (pos) => files.load(`careers/${pos}.json`)
const loadWhere = () => files.load('careers/where.json')

const WINDOWS = [4, 8, 17]
const BOARD_GROUPS_OFF = new Set(['ath', 'ctx'])   // the page's lbMetrics(): no measurements, no context
const STATIC = (m) => m.group === 'ath' || m.key === 'apy' || m.key === 'capshr'   // STATIC_ROW()

// ---- the page's midrank percentile (pctOf over a sorted pool) ---------------------------
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

// ---- reading what the caller asked for ------------------------------------------------------

// "WR", "wide receiver", "receivers", "edge", "IDL", "corner" -> the page's position code.
const EXTRA_POS = {
  edge: 'ED', edges: 'ED', 'edge rusher': 'ED', 'edge rushers': 'ED', idl: 'DI', 'interior defensive lineman': 'DI', 'defensive tackle': 'DI', 'defensive tackles': 'DI', dt: 'DI', dl: 'DI',
  tackle: 'OT', tackles: 'OT', 'offensive tackle': 'OT', t: 'OT', guard: 'OG', guards: 'OG', g: 'OG', center: 'OC', centre: 'OC', centers: 'OC', c: 'OC',
  corner: 'CB', corners: 'CB', cornerback: 'CB', safety: 'S', safeties: 'S', kicker: 'K', punter: 'P', back: 'RB', backs: 'RB', 'running back': 'RB', linebacker: 'LB',
  team: 'TEAM', teams: 'TEAM', 'team offense': 'TEAM', 'team defense': 'TEAM',
}
export function parsePosition(input, meta) {
  const q = norm(input)
  if (!q) throw new SavantError('Give a position, e.g. QB, WR, edge or CB, or "team" for team boards.')
  for (const [code, p] of Object.entries(meta.positions)) {
    if (norm(code) === q || norm(p.label) === q || norm(p.peers) === q || `${norm(p.label)}s` === q) return code
  }
  if (EXTRA_POS[q]) return EXTRA_POS[q]
  const codes = Object.entries(meta.positions).map(([c, p]) => `${c} (${p.label})`)
  throw new SavantError(`"${input}" is not a Football Savant position. Use one of: ${codes.join(', ')}, or "team".`)
}

// A stat by its key ("epadb") or its label ("EPA / dropback"), among the stats a position's
// board can rank on. A near miss lists the closest labels rather than guessing.
export function parseStat(input, choices) {
  const q = norm(input)
  const exact = choices.find((m) => m.key === String(input).trim() || norm(m.label) === q)
  if (exact) return exact
  const hits = choices.filter((m) => norm(m.label).includes(q) || q.split(' ').every((w) => norm(m.label).includes(w)))
  if (hits.length === 1) return hits[0]
  const show = (hits.length ? hits : choices).slice(0, 25).map((m) => `${m.key} (${m.label})`)
  throw new SavantError(`${hits.length ? `"${input}" fits ${hits.length} stats` : `No stat called "${input}" for this board`}. Give a key or the full label: ${show.join('; ')}${hits.length > 25 || (!hits.length && choices.length > 25) ? '; ...' : ''}.`)
}

const teamName = (meta, season) => (t) => {
  const e = t && meta.era && meta.era[t]
  if (e && +season <= e[0]) return e[2]
  return (meta.teamNames || {})[t] || t
}
const thrOf = (m, pos) => ((m.lowSampleBelowByPosition || {})[pos] ?? m.lowSampleBelow)
const onTeam = (r, t) => r.team === t || (r.tms && r.tms.includes(t)) || (r.teams && r.teams.includes(t))
const cell = (r, key) => (r.m && r.m[key]) || (r.xm && r.xm[key]) || null
const isLow = (r, key) => (r.low || []).includes(key) || (r.xlow || []).includes(key)
const settleOf = (r, key) => (r.settle && r.settle[key]) || (r.xsettle && r.xsettle[key]) || null

// ---- the Leaderboard Builder -------------------------------------------------------------

export async function leaderboard(args) {
  const meta = await loadMeta()
  const pos = parsePosition(args.position, meta)
  if (pos === 'TEAM') return teamBoard(args, meta)
  const career = /^career$/i.test(String(args.season || '').trim())
  const season = career ? null : (parseSeason(args.season, meta) || meta.latestSeason)
  const top = args.top || 25
  const choices = meta.metrics.filter((m) => m.positions.includes(pos) && !BOARD_GROUPS_OFF.has(m.group))
  const m = args.stat ? parseStat(args.stat, choices) : choices.find((x) => x.key === 'sav') || choices[0]
  const extra = (args.columns || []).map((c) => parseStat(c, meta.metrics.filter((x) => x.positions.includes(pos)))).filter((x) => x.key !== m.key).slice(0, 5)
  const peers = meta.positions[pos].peers
  const label = meta.positions[pos].label

  let rows, live = null, win = null, file = null, tm = (t) => t, weekNote = ''
  if (career) {
    const cf = await loadCareers(pos).catch(() => null)
    rows = cf ? cf.players.filter((r) => r.qualified) : []
  } else {
    file = await loadSeason(season)
    tm = teamIn(meta, season)
    live = file.week || null
    if (args.window) {
      if (!live) throw new SavantError(`A last-${args.window}-games board is only for the season being played, and ${season} is over. Leave out window for the full season.`)
      win = await windowRows(file, season, args.window)
      weekNote = `, over their last ${args.window} games`
      rows = win.rows.filter((r) => r.qualified)
    } else rows = file.players.filter((r) => r.qualified)
    rows = rows.filter((r) => r.pos === pos)
  }
  if (!career && +season < m.since) throw new SavantError(`${m.label} was not tracked in ${season}; it starts in ${m.since}.`)

  // the page's filters
  if (args.team) {
    const t = String(args.team).trim().toUpperCase()
    rows = rows.filter((r) => onTeam(r, t))
  }
  if (args.min_snap_share) rows = rows.filter((r) => { const c = cell(r, 'snapshr'); return c && c[0] >= args.min_snap_share })
  if (args.age_min != null) rows = rows.filter((r) => r.age != null && r.age >= args.age_min)
  if (args.age_max != null) rows = rows.filter((r) => r.age != null && r.age <= args.age_max)
  const expOf = (r) => (career ? r.seasons.length : r.exp)
  if (args.exp_min != null) rows = rows.filter((r) => expOf(r) != null && expOf(r) >= args.exp_min)
  if (args.exp_max != null) rows = rows.filter((r) => expOf(r) != null && expOf(r) <= args.exp_max)

  const all = rows.filter((r) => cell(r, m.key))
  const sample = args.sample || (live && !win ? 'likely_to_settle' : 'settled')
  const settleable = !!(thrOf(m, pos) && m.den)
  const useEst = sample === 'likely_to_settle' && !!live && !win && settleable
  const strict = !win && (sample === 'settled' || (sample === 'likely_to_settle' && !useEst))
  const thin = all.filter((r) => isLow(r, m.key))
  const pick = strict ? all.filter((r) => !isLow(r, m.key)) : all
  const estOf = (r) => { if (!isLow(r, m.key)) return cell(r, m.key)[0]; const e = settleOf(r, m.key); return e ? e[0] : cell(r, m.key)[0] }
  const by = (r) => (useEst ? estOf(r) : cell(r, m.key)[0])
  const ranked = [...pick].sort((a, b) => (m.lowerIsBetter ? by(a) - by(b) : by(b) - by(a)))
  const basis = args.basis === 'all_time' && !career && !win ? 2 : 1
  const pctOf = (r, key) => { const c = cell(r, key); return c ? c[basis] ?? null : null }
  const shown = ranked.slice(0, top).map((r, i) => {
    const c = cell(r, m.key)
    const out = {
      rank: i + 1, id: r.id, name: r.name, team: career ? (r.teams || []).map((t) => tm(t)).join(', ') : tm(r.team),
      value: c[0], display: display(m.unit, c[0]), percentile: pctOf(r, m.key),
      low_sample: isLow(r, m.key) ? sampleOf(r, m, pos, meta) : null,
    }
    if (useEst) {
      const e = isLow(r, m.key) ? settleOf(r, m.key) : null
      out.likely_to_settle = e ? { value: e[0], display: display(m.unit, e[0]), percentile: e[1] } : { value: c[0], display: display(m.unit, c[0]), percentile: (r.ep || {})[m.key] ?? null }
    }
    if (extra.length) {
      out.columns = extra.map((x) => { const xc = cell(r, x.key); return { key: x.key, label: x.label, value: xc ? xc[0] : null, display: xc ? display(x.unit, xc[0]) : null, percentile: xc ? xc[basis] ?? null : null } })
    }
    if (win) out.window = { games: r.games, reaches_back_into: r.from }
    out.url = career ? cardUrl(r.id, 'career') : cardUrl(r.id, season)
    return out
  })

  const where = career ? 'over whole careers' : `in ${season}${live ? ` through week ${live}` : ''}${weekNote}`
  const notes = []
  notes.push(career
    ? `Careers of two seasons or more, at the position each played most, that have ${meta.careerPoolMultiple || 3} times a season's qualifying volume. A career rate is every play of his career added together; the percentile is against the other careers at the position.`
    : win
      ? `Each player's last ${args.window} games, reaching back into last season where he has played fewer this year, against every qualified ${label.toLowerCase()}'s same stretch. A window has no settled or unsettled: everyone who qualifies is shown, and a short window is form, not who a player is.`
      : `Qualified ${peers} only. The percentile is ${basis === 2 ? 'against every qualified season at the position since the stat was first tracked' : `against qualified ${peers} in ${season}`}.`)
  if (useEst) notes.push(`Ranked on where each number is likely to settle, not on the raw number: a man below ${thrOf(m, pos)} ${meta.denoms[m.den] || m.den} is pulled toward what is normal at his position and toward his own last season, by how far short he is. sample "everyone" gives the raw order.`)
  else if (strict && thin.length) notes.push(`${thin.length} player${thin.length === 1 ? '' : 's'} hidden: fewer than ${thrOf(m, pos)} ${meta.denoms[m.den] || m.den}, the point where ${m.label.toLowerCase()} stops wobbling. sample "everyone" shows them, marked.`)
  else if (shown.some((r) => r.low_sample)) notes.push(`Rows marked low sample are below ${thrOf(m, pos)} ${meta.denoms[m.den] || m.den}: the rate is real, the ranking is not yet earned.`)
  if (m.lowerIsBetter) notes.push('Lower is better for this stat, so the board runs low to high.')
  const what = [m.what, m.why].filter(Boolean).join(' ')

  const structured = {
    board: career ? 'career' : season,
    position: label,
    stat: { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, what: what || null },
    sample: win ? 'window' : useEst ? 'likely_to_settle' : strict ? 'settled' : 'everyone',
    window: win ? args.window : null,
    in_progress: live && !career ? { through_week: live } : null,
    total: pick.length,
    players: shown,
    notes,
    url: `${SITE}/football-savant.html`,
    data_as_of: day((file && file.generated) || meta.generated),
    source: SOURCE,
  }
  if (!shown.length) {
    const why = strict && thin.length
      ? `Nobody has reached ${thrOf(m, pos)} ${meta.denoms[m.den] || m.den} yet. Ask with sample "${live ? 'likely_to_settle" or "' : ''}everyone".`
      : 'Nobody clears these filters. Loosen them.'
    return { structured, text: `No ${peers} to rank by ${m.label} ${where}. ${why}` }
  }
  const L = [`${m.label}${m.lowerIsBetter ? ' (lower is better)' : ''}: ${label.toLowerCase()} leaderboard ${where}`]
  for (const r of shown) {
    const lean = r.likely_to_settle && r.low_sample ? `, likely to settle near ${r.likely_to_settle.display} (${r.likely_to_settle.percentile == null ? 'n/a' : ordinal(r.likely_to_settle.percentile)})` : ''
    const thinMark = r.low_sample ? ` [low sample: ${thousands(Math.round(r.low_sample.have))} of ${r.low_sample.needed} ${r.low_sample.of}]` : ''
    const cols = (r.columns || []).map((c) => `${c.label} ${c.display ?? 'n/a'}${c.percentile == null ? '' : ` (${ordinal(c.percentile)})`}`).join('; ')
    L.push(`${r.rank}. ${r.name} (${r.team || '?'}) ${r.display}${r.percentile == null ? '' : ` (${ordinal(r.percentile)} pct)`}${lean}${thinMark}${cols ? `. ${cols}` : ''}`)
  }
  L.push('', ...notes)
  if (what) L.push(`${m.label}: ${what}`)
  L.push('', `Page: ${structured.url} (Build a Leaderboard)`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

function sampleOf(r, m, pos, meta) {
  const need = thrOf(m, pos)
  const have = r.dw && r.dw[m.key] != null ? r.dw[m.key] : (r.d || {})[m.den]
  return { have: have ?? null, needed: need, of: meta.denoms[m.den] || m.den }
}

// The page's formRow(): a window row wears the season row's identity and the window's
// numbers; what no stretch of games can change (measurements, a contract) stays the season's.
// Its rank is taken against everyone's same stretch at the position (formPool()).
async function windowRows(file, season, n) {
  if (!WINDOWS.includes(n)) throw new SavantError(`window is 4, 8 or 17 games.`)
  const meta = await loadMeta()
  const f = await pageFiles.load(`${season}/form-${n}.json`)
  const base = rowsOf(file)
  const pools = new Map()
  const poolOf = (key, pos) => {
    const k = `${key}|${pos}`
    if (!pools.has(k)) {
      const a = []
      for (const id in f.players) { const r = f.players[id]; if (r.q && r.pos === pos && !miss((r.m || {})[key])) a.push(r.m[key]) }
      pools.set(k, Float64Array.from(a).sort())
    }
    return pools.get(k)
  }
  const byKey = Object.fromEntries(meta.metrics.map((x) => [x.key, x]))
  const rows = []
  for (const id in f.players) {
    const w = f.players[id]
    const b = base.get(id)
    if (!w || !b) continue
    const m = {}
    for (const key in w.m || {}) {
      const mt = byKey[key]
      if (!mt || STATIC(mt) || miss(w.m[key])) continue
      m[key] = [w.m[key], percentile(w.m[key], poolOf(key, b.pos), mt.lowerIsBetter)]
    }
    for (const key in b.m) if (byKey[key] && STATIC(byKey[key])) m[key] = b.m[key]
    rows.push({ ...b, m, xm: null, low: null, xlow: null, d: w.d || {}, qualified: !!w.q, games: w.n, from: w.from || null })
  }
  return { rows }
}

// ---- team boards and the team page --------------------------------------------------------

async function teamBoard(args, meta) {
  const season = parseSeason(args.season, meta) || meta.latestSeason
  const file = await loadSeason(season)
  const stats = meta.teamStats
  const pick = args.stat ? parseStat(args.stat, stats) : stats.find((x) => x.key === 'o_epa')
  const tname = teamName(meta, season)
  const teams = Object.entries(file.teams || {}).filter(([, t]) => t.stats && t.stats[pick.key])
  if (!teams.length) throw new SavantError(`No team totals on file for ${season} yet.`)
  teams.sort((a, b) => (pick.lowerIsBetter ? a[1].stats[pick.key][0] - b[1].stats[pick.key][0] : b[1].stats[pick.key][0] - a[1].stats[pick.key][0]))
  const extra = (args.columns || []).map((c) => parseStat(c, stats)).filter((x) => x.key !== pick.key).slice(0, 5)
  const rows = teams.slice(0, args.top || 32).map(([code, t], i) => ({
    rank: i + 1, team: code, name: tname(code), games: t.g,
    value: t.stats[pick.key][0], display: display(pick.unit, t.stats[pick.key][0]), league_rank: t.stats[pick.key][1], of: t.stats[pick.key][2],
    columns: extra.map((x) => { const c = t.stats[x.key]; return { key: x.key, label: x.label, value: c ? c[0] : null, display: c ? display(x.unit, c[0]) : null, league_rank: c ? c[1] : null } }),
  }))
  const live = file.week || null
  const structured = {
    board: season, position: 'Teams', stat: { key: pick.key, label: pick.label, lower_is_better: pick.lowerIsBetter, what: null },
    sample: 'everyone', window: null, in_progress: live ? { through_week: live } : null, total: teams.length, players: [], teams: rows,
    notes: ['Kneel-downs and spikes are left out; a scramble counts as a pass play.', 'For the schedule stats (defenses faced, offenses faced) 1st is the hardest slate.'],
    url: `${SITE}/football-savant.html`, data_as_of: day(file.generated || meta.generated), source: SOURCE,
  }
  const L = [`${pick.label}${pick.lowerIsBetter ? ' (lower is better)' : ''}: all ${teams.length} teams in ${season}${live ? ` through week ${live}` : ''}`]
  for (const r of rows) L.push(`${r.rank}. ${r.name} ${r.display}${r.columns.length ? `. ${r.columns.map((c) => `${c.label} ${c.display ?? 'n/a'}${c.league_rank ? ` (${ordinal(c.league_rank)})` : ''}`).join('; ')}` : ''}`)
  L.push('', ...structured.notes, '', `Page: ${structured.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// The page's team codes and names, either way round: "BUF", "Bills", "Buffalo Bills", "Raiders".
function parseTeam(input, meta, season) {
  const q = norm(input)
  const names = meta.teamNames || {}
  const alias = { oak: 'LV', sd: 'LAC', stl: 'LA', lar: 'LA', jac: 'JAX', wsh: 'WAS', ari: 'ARI' }
  for (const code of Object.keys(names)) if (norm(code) === q) return code
  if (alias[q]) return alias[q]
  for (const [code, e] of Object.entries(meta.era || {})) if (norm(e[1]) === q || norm(e[2]) === q) return code
  const hits = Object.entries(names).filter(([, n]) => norm(n) === q || norm(n).endsWith(` ${q}`) || norm(n).startsWith(`${q} `))
  if (hits.length === 1) return hits[0][0]
  throw new SavantError(`"${input}" is not an NFL team I know. Give a code (BUF) or a name (Bills).`)
}

export async function teamProfile({ team, season }) {
  const meta = await loadMeta()
  const s = parseSeason(season, meta) || meta.latestSeason
  const code = parseTeam(team, meta, s)
  const file = await loadSeason(s)
  const t = (file.teams || {})[code]
  if (!t) throw new SavantError(`${(meta.teamNames || {})[code] || code} has no ${s} season in Football Savant.`)
  const tname = teamName(meta, s)
  const live = file.week || null
  const words = Object.fromEntries(meta.teamStats.map((x) => [x.key, x]))
  const stat = (key, label) => {
    const c = t.stats && t.stats[key]
    return c ? { key, label: label || words[key].label, value: c[0], display: display(words[key].unit, c[0]), rank: c[1], of: c[2], percentile: c[3] } : null
  }
  const group = (keys) => keys.map(([k, l]) => stat(k, l)).filter(Boolean)
  const units = t.stats ? {
    offense: group([['o_epa', 'EPA / play'], ['o_succ', 'Success rate'], ['o_pepa', 'EPA / dropback'], ['o_repa', 'EPA / designed run'], ['o_sk', 'Sack rate allowed'], ['o_hit', 'QB-hit rate allowed'], ['o_d3', '3rd/4th-down conversion'], ['o_x20', '20+ yard plays / game'], ['o_to', 'Giveaways / game']]),
    defense: group([['d_epa', 'EPA / play allowed'], ['d_succ', 'Success rate allowed'], ['d_pepa', 'EPA / dropback allowed'], ['d_repa', 'EPA / designed run allowed'], ['d_sk', 'Sack rate'], ['d_hit', 'QB-hit rate'], ['d_d3', '3rd/4th-down conversion allowed'], ['d_x20', '20+ yard plays allowed / game'], ['d_to', 'Takeaways / game']]),
    gives_up: group([['d_wr', 'Yards / target to wide receivers'], ['d_te', 'Yards / target to tight ends'], ['d_rbt', 'Yards / target to backs'], ['d_rb', 'Yards / carry to backs'], ['d_qb', 'Yards / carry to quarterbacks']]),
    schedule: group([['sd', 'Defenses its offense has faced'], ['so', 'Offenses its defense has faced'], ['net', 'Net EPA / play']]),
  } : null
  const roster = (t.roster || []).map((p) => ({
    unit: p.unit, id: p.id, name: p.name, position: (meta.positions[p.pos] || {}).label || p.pos, spot: p.spot,
    snap_share: p.snap, profile_score: p.score, roster_status: p.st, finished_with: p.now ? teamIn(meta, s)(p.now) : null, url: cardUrl(p.id, s),
  }))
  const structured = {
    team: code, name: tname(code), season: s, in_progress: live ? { through_week: live } : null,
    record: t.rec ? { wins: t.rec[0], losses: t.rec[1], ties: t.rec[2] } : null, coach: t.coach,
    games: t.g, units, line: t.line, roster,
    notes: [
      'Ranks are among all the teams with totals that season; 1st is best, except for the schedule rows, where 1st means the hardest slate. Opponents are measured by what they do in their other games.',
      `The profile score is the average percentile of a man's headline stats against his position${live ? ', with unsettled stats scored where they are likely to settle' : ''}; qualified players only.`,
    ],
    url: `${SITE}/football-savant.html#t=${code}&s=${s}`, data_as_of: day(file.generated || meta.generated), source: SOURCE,
  }
  const L = [`${structured.name}, ${s}${live ? ` through week ${live}` : ''}${t.rec ? `: ${t.rec[0]}-${t.rec[1]}${t.rec[2] ? `-${t.rec[2]}` : ''}` : ''}${t.coach ? `. Head coach ${t.coach}` : ''}.`]
  if (units) {
    const line = (x) => `- ${x.label}: ${x.display} (${ordinal(x.rank)} of ${x.of})`
    L.push('', 'Offense:', ...units.offense.map(line), '', 'Defense:', ...units.defense.map(line), '', 'What this defense gives up:', ...units.gives_up.map(line), '', `${live ? 'Schedule so far' : 'Schedule'} (1st is the hardest):`, ...units.schedule.map(line))
  } else L.push('', `No team totals on file for ${s} yet.`)
  if (t.line) L.push('', `Offensive line grade ${t.line.score} (${ordinal(t.line.rank)} of ${t.line.of}).`)
  for (const unit of ['Offense', 'Defense', 'Specialists']) {
    const ps = roster.filter((p) => p.unit === unit)
    if (!ps.length) continue
    L.push('', `${unit} roster, in depth-chart order:`)
    L.push(ps.map((p) => `${p.name} (${p.spot || p.position}${p.snap_share != null ? `, ${p.snap_share}% of snaps` : ''}${p.profile_score != null ? `, score ${p.profile_score}` : ''}${p.roster_status ? `, ${p.roster_status}` : ''}${p.finished_with ? `, ${live ? 'now' : 'later'} ${p.finished_with}` : ''})`).join('; '))
  }
  L.push('', ...structured.notes, '', `Page: ${structured.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- a career ------------------------------------------------------------------------------

export async function playerCareer({ player, stat }) {
  const meta = await loadMeta()
  const who = await resolvePlayer(player, null, meta)
  const where = await loadWhere()
  const pos = (where.where || {})[who.id] || who.pos
  const cf = await loadCareers(pos).catch(() => null)
  const row = cf && cf.players.find((r) => r.id === who.id)
  const posLabel = (meta.positions[pos] || {}).label || pos
  const peers = (meta.positions[pos] || {}).peers || pos
  const byKey = Object.fromEntries(meta.metrics.map((m) => [m.key, m]))
  const SAVANT = `${SITE}/football-savant.html#p=${encodeURIComponent(who.id)}&s=career`

  // one stat, season by season: the page's per-stat chart ("Seasons")
  let series = null
  if (stat) {
    const choices = meta.metrics.filter((m) => m.positions.includes(pos) || m.positions.includes(who.pos))
    const m = parseStat(stat, choices)
    const ss = Array.from({ length: who.to - who.from + 1 }, (_, i) => String(who.from + i)).filter((s) => played(who, s) && +s >= m.since)
    const files = await Promise.all(ss.map((s) => loadSeason(s)))
    series = { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, seasons: [] }
    ss.forEach((s, i) => {
      const r = rowsOf(files[i]).get(who.id)
      const c = r && cell(r, m.key)
      if (!c) return
      series.seasons.push({ season: s, team: teamIn(meta, s)(r.team), position: r.pos, value: c[0], display: display(m.unit, c[0]), percentile: c[1], low_sample: isLow(r, m.key), in_progress: !!files[i].week })
    })
  }

  if (!row) {
    // one season, or none filed: the season card is the career
    const structured = { player: { id: who.id, name: who.name, position: posLabel }, seasons: [String(who.from)], one_season: true, series, url: cardUrl(who.id, who.to), data_as_of: day(meta.generated), source: SOURCE }
    const text = `${who.name} has ${who.seasons === 1 ? 'one season' : 'no career'} on file (${seasonsOf(who)}), so his career is that season's card: ask nfl_get_player_profile.${series && series.seasons.length ? `\n${series.label}: ${series.seasons.map((x) => `${x.season} ${x.display} (${x.percentile == null ? 'n/a' : ordinal(x.percentile)})`).join(', ')}.` : ''}`
    return { structured, text }
  }

  const stats = []
  const lowSet = new Set(row.low || [])
  for (const m of meta.metrics) {
    const c = row.m[m.key]
    if (!c) continue
    const cov = (row.cov || {})[m.key]
    stats.push({
      key: m.key, label: m.label, group: meta.groups[m.group] || m.group, value: c[0], display: display(m.unit, c[0]), career_percentile: c[1],
      lower_is_better: m.lowerIsBetter, low_sample: lowSet.has(m.key), seasons_counted: cov ? { seasons: cov[0], from: String(cov[1]), to: String(cov[2]) } : null,
    })
  }
  const aw = row.aw || null
  const awards = aw ? {
    mvp: aw.mvp || 0, offensive_player_of_year: aw.opoy || 0, defensive_player_of_year: aw.dpoy || 0, offensive_rookie_of_year: aw.oroy || 0, defensive_rookie_of_year: aw.droy || 0,
    first_team_all_pro: aw.allpro ?? null, pro_bowls: aw.probowl ?? null, hall_of_fame: !!aw.hof, years: aw.years || {},
  } : null
  const structured = {
    player: { id: row.id, name: row.name, position: posLabel, teams: row.teams.map((t) => teamIn(meta, String(row.seasons[row.seasons.length - 1]))(t)) },
    seasons: row.seasons.map(String),
    in_pool: row.qualified,
    pool_size: cf.pool,
    built_on: Object.entries(row.d).map(([k, v]) => ({ key: k, label: meta.denoms[k] || k, value: v })),
    record: row.rec ? { wins: row.rec[0], losses: row.rec[1], ties: row.rec[2] } : null,
    playoff_seasons: row.poyears || 0,
    super_bowls_won: (row.rings || []).map(String),
    super_bowls_lost: (row.sbLost || []).map(String),
    awards,
    led_nfl: (row.acc || []).filter((a) => a.led && a.s !== 'fantasy points').map((a) => ({ stat: a.s, times: a.led, seasons: a.led_in.map(String) })),
    top_ten: (row.acc || []).map((a) => ({ stat: a.s, times: a.top, best: a.best })),
    arc: row.arc.map(([s, sc]) => ({ season: String(s), profile_score: sc })),
    peak_season: who.peak ? String(who.peak) : null,
    stats,
    series,
    notes: [],
    url: SAVANT, data_as_of: day(cf.generated || meta.generated), source: SOURCE,
  }
  const notes = structured.notes
  notes.push(`A career here is every play of his ${row.seasons.length} seasons added together and divided once: each rate is weighted by its own sample, so a big season outweighs a small one. Games, starts and total EPA add up; the longest field goal is a best; availability is his games over his teams' games.`)
  notes.push(row.qualified
    ? `Every percentile is against the ${thousands(cf.pool)} careers at ${peers.replace(/s$/, '')} with at least three seasons' qualifying volume, since 1999.`
    : `His career is under three seasons' qualifying volume, so it is not in the career pool itself; its percentiles rank it against the ${thousands(cf.pool)} careers that are. Treat them with caution.`)
  if (stats.some((x) => x.seasons_counted)) notes.push('A stat first tracked after his career began counts only the seasons that tracked it; seasons_counted says which.')
  if (aw && aw.pbScope !== 'career' && !aw.probowl) notes.push('Pro Bowl and All-Pro counts come from a draft-pick table, which has no row for an undrafted player; his individual awards are complete.')
  if (structured.seasons.includes(meta.latestSeason) && meta.live) notes.push(`It includes the ${meta.latestSeason} season in progress.`)

  const L = [`${row.name}, career (${posLabel}, ${row.seasons[0]} to ${row.seasons[row.seasons.length - 1]}, ${row.seasons.length} seasons; ${structured.player.teams.join(', ')})`]
  const acc = []
  if (row.rec) acc.push(`team record ${row.rec[0]}-${row.rec[1]}${row.rec[2] ? `-${row.rec[2]}` : ''}`)
  if (row.poyears) acc.push(`${row.poyears} playoff season${row.poyears === 1 ? '' : 's'}`)
  if (row.rings) acc.push(`won Super Bowl${row.rings.length > 1 ? 's' : ''} in ${row.rings.join(', ')}`)
  if (row.sbLost) acc.push(`lost the Super Bowl in ${row.sbLost.join(', ')}`)
  if (awards) {
    const a = []
    for (const [k, w] of [['mvp', 'MVP'], ['opoy', 'Offensive Player of the Year'], ['dpoy', 'Defensive Player of the Year'], ['oroy', 'Offensive Rookie of the Year'], ['droy', 'Defensive Rookie of the Year']]) {
      if (aw[k]) a.push(`${aw[k] > 1 ? `${aw[k]}x ` : ''}AP ${w}${aw.years && aw.years[k] ? ` (${aw.years[k].join(', ')})` : ''}`)
    }
    if (aw.allpro) a.push(`${aw.allpro} first-team All-Pro`)
    if (aw.probowl) a.push(`${aw.probowl} Pro Bowl${aw.probowl === 1 ? '' : 's'}${aw.pbScope === 'career' ? ' (career, including any before 1999)' : ''}`)
    if (aw.hof) a.push('Hall of Fame')
    if (a.length) acc.push(a.join(', '))
  }
  if (acc.length) L.push(`${acc.join('; ')}.`)
  if (structured.led_nfl.length) L.push(`Led the NFL in: ${structured.led_nfl.map((x) => `${x.stat} ${x.times}x (${x.seasons.join(', ')})`).join('; ')}.`)
  L.push(`Season by season, profile score: ${structured.arc.map((x) => `${x.season} ${x.profile_score == null ? '—' : Math.round(x.profile_score)}`).join(', ')}${structured.peak_season ? `. Peak: ${structured.peak_season}` : ''}.`)
  L.push(`Built on: ${structured.built_on.map((x) => `${thousands(Math.round(x.value))} ${x.label}`).join(', ')}.`)
  let heading = null
  for (const x of stats) {
    if (x.group !== heading) { L.push('', x.group); heading = x.group }
    L.push(`- ${x.label}: ${x.display} (${x.career_percentile == null ? 'n/a' : ordinal(x.career_percentile)} among careers)${x.lower_is_better ? ' [lower is better]' : ''}${x.low_sample ? ' [low sample]' : ''}${x.seasons_counted ? ` [${x.seasons_counted.from} on]` : ''}`)
  }
  if (series) {
    L.push('', `${series.label}, season by season (percentile within each season, against that season's qualified players at his position):`)
    L.push(series.seasons.length ? series.seasons.map((x) => `${x.season} ${x.display} (${x.percentile == null ? 'n/a' : ordinal(x.percentile)})${x.low_sample ? '*' : ''}${x.in_progress ? ' so far' : ''}`).join(', ') : 'none on file.')
  }
  L.push('', ...notes, '', `Career card: ${SAVANT}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -------------------------------------------------------------------------------

const row = z.record(z.string(), z.any())
export const tools = [
  {
    name: 'nfl_leaderboard',
    config: {
      title: 'NFL leaderboard',
      description:
        'Football Savant\'s Leaderboard Builder (wcehoops.com): the top players at one position by any stat on their card, for a season since 1999, over whole careers ("career"), or over the last 4, 8 or 17 games of the season being played; or all 32 teams by a team stat (position "team"). Same order and percentiles as the page. Filters: team, snap share, age, years in the league. Sample: "settled" (enough of the stat\'s own sample), "likely_to_settle" (the season being played, ranked where numbers will likely finish; the default then) or "everyone".',
      inputSchema: {
        position: z.string().trim().min(1).max(30).describe('QB, RB, WR, TE, OT, OG, OC, ED (edge), DI (interior line), LB, CB, S, K, P, or "team".'),
        stat: z.string().trim().max(80).optional().describe('A stat key or label, e.g. "epadb" or "EPA / dropback". Omit for Savant value (o_epa for teams).'),
        season: z.string().trim().max(12).optional().describe('Year the season began, e.g. "2024", or "career". Omit for the latest.'),
        window: z.union([z.literal(4), z.literal(8), z.literal(17)]).optional().describe('Last N games, season in progress only.'),
        sample: z.enum(['settled', 'likely_to_settle', 'everyone']).optional().describe('Which players a rate stat ranks (see description).'),
        team: z.string().trim().max(4).optional().describe('Only this team\'s players (code, e.g. "BUF"), any team they played for that season.'),
        min_snap_share: z.number().min(0).max(100).optional().describe('Only players on at least this share of snaps, %.'),
        age_min: z.number().optional().describe('Minimum age.'),
        age_max: z.number().optional().describe('Maximum age.'),
        exp_min: z.number().int().optional().describe('Minimum years in the league (seasons, for careers).'),
        exp_max: z.number().int().optional().describe('Maximum years in the league.'),
        basis: z.enum(['season', 'all_time']).optional().describe('Percentile against that season (default) or every season.'),
        columns: z.array(z.string().max(80)).max(5).optional().describe('Up to 5 more stats to show beside the one ranked.'),
        top: z.number().int().min(1).max(100).default(25).describe('How many (default 25).'),
      },
      outputSchema: {
        board: z.string(), position: z.string(), stat: row, sample: z.string(), window: z.number().nullable(),
        in_progress: row.nullable(), total: z.number(), players: z.array(row), teams: z.array(row).optional(),
        notes: z.array(z.string()), url: z.string(), data_as_of: z.string(), source: z.string(),
      },
      annotations: { title: 'NFL leaderboard', ...READ_ONLY },
    },
    run: (args) => leaderboard(args),
  },
  {
    name: 'nfl_team_profile',
    config: {
      title: 'NFL team page',
      description:
        'One NFL team\'s season on Football Savant (wcehoops.com): how its offense and defense rank (EPA, success rate, sack and pressure rates, conversions, explosive plays, turnovers), what its defense gives up to receivers, tight ends, backs and quarterbacks, the schedule it has faced, its offensive line grade, and its roster in depth-chart order with snap shares and profile scores. Seasons from 1999.',
      inputSchema: {
        team: z.string().trim().min(2).max(40).describe('Code ("BUF") or name ("Bills").'),
        season: z.string().trim().max(12).optional().describe('Year the season began. Omit for the latest.'),
      },
      outputSchema: {
        team: z.string(), name: z.string(), season: z.string(), in_progress: row.nullable(), record: row.nullable(), coach: z.string().nullable(),
        games: z.number().nullable(), units: row.nullable(), line: row.nullable(), roster: z.array(row), notes: z.array(z.string()),
        url: z.string(), data_as_of: z.string(), source: z.string(),
      },
      annotations: { title: 'NFL team page', ...READ_ONLY },
    },
    run: (args) => teamProfile(args),
  },
  {
    name: 'nfl_player_career',
    config: {
      title: 'NFL player career',
      description:
        'An NFL player\'s whole career on Football Savant (wcehoops.com): every stat pooled across his seasons and ranked among careers at his position, his team record, playoff seasons, Super Bowls, AP awards (MVP, Player and Rookie of the Year, All-Pro, Pro Bowls, Hall of Fame), the categories he led the NFL in, and his profile score season by season. Give a stat to also get it season by season with each season\'s percentile.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nfl_search_players or a full name.'),
        stat: z.string().trim().max(80).optional().describe('A stat key or label to follow season by season.'),
      },
      outputSchema: {
        player: row, seasons: z.array(z.string()), one_season: z.boolean().optional(), in_pool: z.boolean().optional(), pool_size: z.number().optional(),
        built_on: z.array(row).optional(), record: row.nullable().optional(), playoff_seasons: z.number().optional(), super_bowls_won: z.array(z.string()).optional(),
        super_bowls_lost: z.array(z.string()).optional(), awards: row.nullable().optional(), led_nfl: z.array(row).optional(), top_ten: z.array(row).optional(),
        arc: z.array(row).optional(), peak_season: z.string().nullable().optional(), stats: z.array(row).optional(), series: row.nullable(),
        notes: z.array(z.string()).optional(), url: z.string(), data_as_of: z.string(), source: z.string(),
      },
      annotations: { title: 'NFL player career', ...READ_ONLY },
    },
    run: (args) => playerCareer(args),
  },
]
