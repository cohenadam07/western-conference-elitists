// api/_basketball-ext.js — the October 2026 additions to Basketball Savant, for the connector:
// ~145 more stats (shot profile, tracking, hustle, matchups, fouls, clutch, consistency, win
// probability...) and the breakdown panels under the card (shot menu, shot splits, touches,
// passing network, defensive play types, clutch, splits, on/off four factors, turnover mix,
// Handle Score, Dunk Score, position estimate).
//
// WHERE THEY COME FROM. Not from savant-api/basketball/v1: the additions ship beside the archive,
// in the page's own public/savant-ext/ (pipeline/basketball/ext_files.py), and the connector reads
// the same files the page does:
//   savant-ext/s/<season>.json       every player's values (all four windows for the season in
//                                    progress, the full season for a finished one)
//   savant-ext/panels/<season>.json  every player's breakdown panels
//   savant-ext/p/<id>.json           one player's finished seasons with both percentiles
//
// THE ONE THING COMPUTED HERE: the percentile of a season file's value. It is the page's pctOf()
// over the page's poolVals(): midrank among that season's qualified players who have a value,
// flipped for lower-is-better stats, rounded and held to 1..99, league-wide or at his position;
// qualified and position come from the season's API file, which already applies the page's
// position fixes. tools/savant-mcp/check.mjs lifts the page's functions and holds this to them.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { makeLoader, miss } from './_core.js'

const files = makeLoader('savant-ext', {
  what: 'Basketball Savant',
  maxCached: 24,
  shape: (b) => !!b && typeof b === 'object' && (Array.isArray(b.keys) || (b.players && typeof b.players === 'object')),
})

// A file that is not there (a season the additions do not reach, the data being down) is an
// answer without the additions, not an error: the callers say so in a note.
const soft = (p) => files.load(p).catch(() => null)
export const loadExtSeason = (season) => soft(`s/${season}.json`)
export const loadExtPanels = (season) => soft(`panels/${season}.json`)
export const loadExtPlayer = (id) => soft(`p/${id}.json`)
export const clearExt = () => files.clear()

function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid } return lo }
function upperBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid } return lo }
function pctOf(v, sorted, lower) {
  const n = sorted.length
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

// season file + core season file + window -> Map(id -> { key: [value, league pct, position pct, sample] })
const ranked = new WeakMap()
export function extCells(extFile, seasonFile, window, metrics) {
  if (!extFile || !seasonFile) return null
  let byWin = ranked.get(extFile)
  if (!byWin) { byWin = new Map(); ranked.set(extFile, byWin) }
  const ck = `${window}|${seasonFile.season}`
  if (byWin.has(ck)) return byWin.get(ck)
  const idx = new Map(extFile.keys.map((k, i) => [k, i]))
  const rows = seasonFile.players.map((p) => ({ p, r: (extFile.players[p.id] || extFile.players[String(p.id)] || {})[window] || null }))
  const out = new Map()
  for (const m of metrics) {
    const i = idx.get(m.key)
    if (i == null) continue
    const league = []
    const byPos = { Guard: [], Wing: [], Big: [] }
    for (const { p, r } of rows) {
      if (!p.qualified || !r || !r[i]) continue
      const v = r[i][0]
      if (miss(v)) continue
      league.push(v)
      if (byPos[p.pos]) byPos[p.pos].push(v)
    }
    const sort = (a) => Float64Array.from(a).sort()
    const pl = sort(league)
    const pp = { Guard: sort(byPos.Guard), Wing: sort(byPos.Wing), Big: sort(byPos.Big) }
    for (const { p, r } of rows) {
      if (!r || !r[i] || miss(r[i][0])) continue
      const v = r[i][0]
      let o = out.get(String(p.id))
      if (!o) { o = {}; out.set(String(p.id), o) }
      o[m.key] = [v, pctOf(v, pl, m.lowerIsBetter), pp[p.pos] ? pctOf(v, pp[p.pos], m.lowerIsBetter) : null, r[i][1] ?? null]
    }
  }
  byWin.set(ck, out)
  return out
}

// One player's additions in one season and window, with the season's file loaded on demand.
export async function extFor(seasonFile, id, window, metrics) {
  const f = await loadExtSeason(seasonFile.season)
  if (!f) return { available: false, cells: {} }
  if (!(f.windows || ['season']).includes(window)) return { available: true, window_missing: true, cells: {} }
  const cells = extCells(f, seasonFile, window, metrics)
  return { available: true, cells: cells.get(String(id)) || {}, through: f.through || null }
}

// ---- the breakdown panels, as words and tables ----------------------------------------------
const SM = { dunk: 'Dunks', layup: 'Layups', floater: 'Floaters', hook: 'Hook shots', stepback: 'Step-backs', fadeaway: 'Fadeaways', turnaround: 'Turnarounds', pullup: 'Pull-ups', alleyoop: 'Alley-oops', putback: 'Putbacks and tips', cutting: 'Cuts', driving: 'Drives' }
const TOV = { badpass: 'bad pass', lostball: 'lost ball', travel: 'traveling', offfoul: 'offensive foul', threesec: '3 seconds', shotclock: 'shot clock', oob: 'out of bounds', handle: 'ball handling', other: 'other' }
const SP = { start: 'starting', bench: 'off the bench', home: 'home', away: 'away', win: 'wins', loss: 'losses', b2b: 'back-to-backs', rest1: 'one day of rest', rest2: 'two or more days of rest' }
const SS = { drib: 'dribbles before the shot', touch: 'touch time', clock: 'shot clock', def: 'closest defender' }
const PT = { Isolation: 'Isolation', Transition: 'Transition', PRBallHandler: 'Pick-and-roll ball handler', PRRollman: 'Pick-and-roll roll man', Postup: 'Post-up', Spotup: 'Spot-up', Handoff: 'Handoff', Cut: 'Cut', OffScreen: 'Off screen', OffRebound: 'Putbacks', Misc: 'Misc' }
const f1 = (v) => (miss(v) ? '—' : (+v).toFixed(1))
const p1 = (v) => (miss(v) ? '—' : `${(+v).toFixed(1)}%`)
const sg1 = (v) => (miss(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`)

// view name -> [panel key, title]
export const PANEL_VIEWS = {
  shot_menu: ['sm', 'Shot menu'],
  shot_splits: ['ss', 'Shot splits'],
  touches: ['tp', 'Touches'],
  passing: ['pn', 'Passing network'],
  defensive_play_types: ['dpt', 'Defensive play types'],
  clutch: ['cl', 'Clutch'],
  game_splits: ['sp', 'Splits'],
  on_off_four_factors: ['off4', 'On/off four factors'],
  turnover_mix: ['tm', 'Turnover mix'],
  handle_score: ['hs', 'Handle Score'],
  dunk_score: ['dk', 'Dunk Score'],
  position_estimate: ['pe', 'Position estimate'],
}

// panel data -> { data (structured), lines (text) }
export function describePanel(key, d) {
  switch (key) {
    case 'sm': {
      const rows = Object.entries(d).map(([k, v]) => ({ shot: SM[k] || k, attempts: v[0], made: v[1], fg_pct: v[0] ? +(100 * v[1] / v[0]).toFixed(1) : null, small_sample: v[0] < 20 })).sort((a, b) => b.attempts - a.attempts)
      return { data: rows, lines: rows.map((r) => `- ${r.shot}: ${r.made} of ${r.attempts} (${p1(r.fg_pct)})${r.small_sample ? ' [under 20 attempts]' : ''}`).concat('A shot can sit in two families: a driving floater is a floater and a drive.') }
    }
    case 'ss': {
      const data = {}
      const lines = []
      for (const [k, label] of Object.entries(SS)) {
        if (!d[k]) continue
        data[label] = Object.entries(d[k]).map(([b, v]) => ({ split: b, share: v[0], efg_pct: v[1], fga: v[2], small_sample: v[2] < 25 }))
        lines.push(`${label[0].toUpperCase()}${label.slice(1)}: ${data[label].map((r) => `${r.split} ${p1(r.share)} of shots, ${p1(r.efg_pct)} eFG (${r.fga} FGA)`).join('; ')}`)
      }
      return { data, lines }
    }
    case 'tp': {
      const N = { elbow: 'Elbow', post: 'Post', paint: 'Paint' }
      const rows = Object.entries(d).map(([k, v]) => ({ touch: N[k] || k, per_75: v[0], points_per_touch: v[1], fg_pct: v[2], pass_pct: v[3], assist_pct: v[4], turnover_pct: v[5], foul_pct: v[6], touches: v[7] }))
      return { data: rows, lines: rows.map((r) => `- ${r.touch}: ${f1(r.per_75)} per 75 (${r.touches} touches), ${miss(r.points_per_touch) ? '—' : r.points_per_touch.toFixed(2)} points per touch, FG ${p1(r.fg_pct)}, passes ${p1(r.pass_pct)}, assists ${p1(r.assist_pct)}, turnovers ${p1(r.turnover_pct)}, fouled ${p1(r.foul_pct)}`) }
    }
    case 'pn': {
      const conv = (rows) => (rows || []).map((r) => ({ teammate_id: String(r[0]), teammate: r[1], passes: r[2], assists: r[3], fgm: r[4], fga: r[5], fg3m: r[6], fg3a: r[7] }))
      const data = { passes_to: conv(d.made), passes_from: conv(d.recv) }
      const line = (r) => `${r.teammate} ${r.passes} passes, ${r.assists} assists${r.fga ? `, ${r.fgm}/${r.fga} FG off them` : ''}`
      return { data, lines: [`He passes to: ${data.passes_to.map(line).join('; ') || '—'}`, `He gets passes from: ${data.passes_from.map(line).join('; ') || '—'}`] }
    }
    case 'dpt': {
      const rows = Object.entries(d).map(([k, v]) => ({ type: PT[k] || k, share: v[0], points_allowed_per_possession: v[1], percentile: v[2] ?? null, possessions: v[3] })).sort((a, b) => b.share - a.share)
      return { data: rows, lines: rows.map((r) => `- ${r.type}: ${p1(r.share)} of his defensive possessions (${r.possessions}), ${r.points_allowed_per_possession.toFixed(2)} points allowed per possession${r.percentile == null ? '' : ` (${r.percentile}th percentile; higher = fewer allowed)`}`).concat('Synergy charges the defender on the final action of a possession only.') }
    }
    case 'cl': return { data: d, lines: [`${d.gp} games, ${f1(d.min)} clutch minutes: ${d.pts} points, ${d.fgm}/${d.fga} FG, ${d.fg3m}/${d.fg3a} 3P, ${d.ftm}/${d.fta} FT, TS ${p1(d.ts)}, ${d.ast} assists, ${d.tov} turnovers, ${sg1(d.pm).replace('.0', '')} plus-minus${d.usg != null ? `, usage ${p1(d.usg)}` : ''}${d.net != null ? `, net rating ${sg1(d.net)}` : ''}.`, 'Clutch time: the last five minutes of the fourth quarter or overtime with the score within five. Samples are tiny; read it as what happened.'] }
    case 'sp': {
      const rows = Object.entries(d).map(([k, v]) => ({ split: SP[k] || k, games: v[0], minutes: v[1], points: v[2], rebounds: v[3], assists: v[4], ts_pct: v[5], plus_minus: v[6] }))
      return { data: rows, lines: rows.map((r) => `- ${r.split} (${r.games} games): ${f1(r.points)} pts, ${f1(r.rebounds)} reb, ${f1(r.assists)} ast in ${f1(r.minutes)} min, TS ${p1(r.ts_pct)}, ${sg1(r.plus_minus)} per game`) }
    }
    case 'off4': {
      const L = ['eFG%', 'turnover %', 'offensive rebound %', 'free-throw rate']
      const rows = L.map((l, i) => ({ factor: l, team_on: d.on[i], team_off: d.off[i], opponent_on: d.on[i + 4], opponent_off: d.off[i + 4] }))
      return { data: { minutes_on: d.min[0], minutes_off: d.min[1], factors: rows }, lines: rows.map((r) => `- ${r.factor}: his team ${f1(r.team_on)} on / ${f1(r.team_off)} off; opponents ${f1(r.opponent_on)} on / ${f1(r.opponent_off)} off`).concat(`${d.min[0]} minutes on, ${d.min[1]} off. Lineups drive this as much as he does.`) }
    }
    case 'tm': return { data: { turnovers: d.n, live_ball_pct: d.live, mix: d.mix }, lines: [`${d.n} turnovers: ${Object.entries(d.mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${TOV[k] || k} ${p1(v)}`).join(', ')}. ${p1(d.live)} were live-ball (a steal on the play).`] }
    case 'hs': return { data: d, lines: [`${d.n} scored dribble sequences, average Handle Score ${f1(d.avg)}, best ${f1(d.max)}.`, ...(d.top || []).map((r) => `- ${f1(r[0])}: ${r[1]} dribbles, ${r[2]} through the legs, ${r[3]} behind the back, ${r[4]} spins, ${r[5]} hand switches${r[6] != null ? `, top speed ${f1(r[6])} mph` : ''} (${r[10]}, ${r[9]})`)] }
    case 'dk': return { data: d, lines: [`${d.n} scored dunks, average Dunk Score ${f1(d.avg)}, best ${f1(d.max)}${d.vert != null ? `, top vertical ${f1(d.vert)}"` : ''}${d.hang != null ? `, top hang time ${(+d.hang).toFixed(2)}s` : ''}.`, ...(d.top || []).map((r) => `- ${f1(r[0])} (jump ${f1(r[1])}, power ${f1(r[2])}, style ${f1(r[3])}, contest ${f1(r[4])}) ${r[8]}, ${r[7]}`)] }
    case 'pe': {
      const L = ['PG', 'SG', 'SF', 'PF', 'C']
      return { data: Object.fromEntries(L.map((l, i) => [l, d[i]])), lines: [`Share of his minutes by position (estimated from his lineups): ${L.map((l, i) => `${l} ${d[i]}%`).join(', ')}.`] }
    }
    default: return { data: d, lines: [] }
  }
}
