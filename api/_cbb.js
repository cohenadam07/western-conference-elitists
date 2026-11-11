// api/_cbb.js — College Basketball Savant, as answers. One section of the AI connector (api/mcp.js).
//
// It reads the page's own files under /cbb/ (pipeline/college/build.py) and does its arithmetic
// with public/savant-cbb.js, the same copy the page runs, so an answer is the number on the card.
//
// What an answer always says: which pool a percentile is from; when a sample is low; "not tracked"
// (with the season it starts) rather than a zero; the data date; a link to the page. Birthdates,
// Torvik fields and CBBD rows are not in these files, so nothing here can serve them.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, ordinal, prepare, rank, topTier } from './_core.js'
import '../public/savant-cbb.js'

const M = globalThis.SavantCBB
const C = M.COL
const files = makeLoader('cbb', { what: 'College Basketball Savant', maxCached: 40, shape: (b) => b && typeof b === 'object' && (b.stats || b.seasons || b.players || b.teams || b.roster || b.rows || Object.keys(b).length) })
const PAGE = `${SITE}/college-basketball-savant.html`
const SOURCE = 'College Basketball Savant, Western Conference Elitists (wcehoops.com)'
const SEASON_RE = /^\d{4}-\d{2}$/
export const POOLS = ['position', 'all', 'high_major', 'conference', 'same_age']
const POOLKEY = { position: 'pos', all: 'all', high_major: 'hm', conference: 'conf', same_age: 'age' }
const TABLES = ['games', 'player_games', 'units', 'possessions']
const SPLIT_COLS = ['games', 'minutes', 'possessions', 'pts_per_poss', 'ts', 'efg', 'fg3', 'ast_per_poss', 'reb_per_poss', 'tov_pct', 'usg', 'stl_pct', 'blk_pct']

const reg = () => files.load('registry.json')
const index = () => files.load('index.json')
const search = () => files.load('search.json')
const seasonDoc = (s) => files.load(`s/${s}.json`)
const teamsDoc = (s) => files.load(`teams/${s}.json`)
const teamDoc = (s, t) => files.load(`t/${s}/${t}.json`)
const career = (id) => files.load(`p/${String(id).slice(-2)}.json`)
const ctxDoc = (s, t) => files.load(`ctx/${s}/${t}.json`)
const ctxLeague = (s) => files.load(`ctx/${s}/league.json`)
const possDoc = (s, t) => files.load(`pos/${s}/${t}.json`)
// College Basketball Coaching Savant's two files the College Savant page reads (1.4.0): the head coach of
// record per team-season, and each player's coaches whose systems used players most like him. Optional: if
// they cannot be read, the answer says so and everything else stands.
const cbcs = makeLoader('cbcs', { what: 'College Basketball Coaching Savant', maxCached: 4, shape: (b) => b && typeof b === 'object' && (b.ts || b.rows) })
const CBCS_PAGE = `${SITE}/college-basketball-coaching-savant.html`
const coachUrl = (id, s) => `${CBCS_PAGE}#c=${encodeURIComponent(id)}${s ? `&season=${s}` : ''}`
async function headCoaches(team, s) {
  const L = await cbcs.load('links.json').catch(() => null)
  if (!L) return null
  return (L.ts[`${team}|${s}`] || []).map(([id, name, interim]) => ({ id, name, interim: !!interim, url: coachUrl(id, s) }))
}
async function coachesLikeHim(id) {
  const F = await cbcs.load('player-fits.json').catch(() => null)
  if (!F) return null
  return { label: F.label, coaches: (F.rows[id] || []).map(([c, match]) => ({ id: c, name: F.names[c] || c, match, url: coachUrl(c) })) }
}
export const playerUrl = (id, s) => `${PAGE}#player-${id}${s ? `/${s}` : ''}`
export const teamUrl = (id, s) => `${PAGE}#team-${id}${s ? `/${s}` : ''}`

async function pickSeason(season) {
  const idx = await index()
  const s = season || idx.default_season
  if (!idx.seasons.some((x) => x.season === s)) throw new SavantError(`College Basketball Savant has ${idx.seasons.map((x) => x.season).join(', ')}. ${s} is not on file yet.`)
  return { s, idx, row: idx.seasons.find((x) => x.season === s) }
}

async function findPlayer(q, season) {
  const d = await search()
  const direct = d.players.find((p) => p[0] === q)
  if (direct) return direct
  const rows = prepare(d.players.map((p) => ({ p, name: p[1] })))
  const hits = topTier(rank(rows, q, (a, b) => String(b.p[3]).localeCompare(a.p[3]) || b.p[5] - a.p[5]))
  if (!hits.length) throw new SavantError(`No men's D1 player found for "${q}". Try cbb_search_players.`)
  if (season && hits.length > 1) {          // two men can share a name: take the one who played that season, the better one if both did
    const doc = await seasonDoc(season)
    const val = (doc.values.value || {}).r || []
    const mins = new Map(doc.players.map((x, i) => [x[C.id], val[i] ?? x[C.min] ?? 0]))   // the better of them
    const inS = hits.filter((h) => mins.has(h.p[0])).sort((a, b) => mins.get(b.p[0]) - mins.get(a.p[0]))
    if (inS.length) return inS[0].p
  }
  return hits[0].p
}
async function findTeam(q) {
  const d = await search()
  const hit = d.teams.find((t) => t[0] === q)
  if (hit) return hit
  // A team answers to its short name ("Oklahoma"), its full name with the mascot ("Oklahoma
  // Sooners", from the newest season's ratings) and its code ("OU").
  const code = String(q).trim().toUpperCase()
  const byCode = d.teams.filter((t) => String(t[2]).toUpperCase() === code)
  if (byCode.length === 1) return byCode[0]
  const full = await fullNames()
  const rows = d.teams.map((t) => ({ t, name: t[1] })).concat(d.teams.filter((t) => full.has(t[0])).map((t) => ({ t, name: full.get(t[0]) })))
  const hits = topTier(rank(prepare(rows), q))
  if (!hits.length) throw new SavantError(`No D1 team found for "${q}".`)
  return hits[0].t
}
let FULL = null
async function fullNames() {              // team id -> "Oklahoma Sooners", from the last full season and the current one (a team that hasn't played yet isn't in the current file)
  if (FULL) return FULL
  const idx = await index()
  const docs = await Promise.all([...new Set([idx.default_season, idx.current])].map((s) => teamsDoc(s).catch(() => ({ teams: [] }))))
  FULL = new Map(docs.flatMap((t) => (t.teams || []).filter((r) => r.full).map((r) => [r.id, r.full])))
  return FULL
}
const tname = async (id) => { const d = await search(); return (d.teams.find((t) => t[0] === id) || [])[1] || 'Non-D1' }
const HIGH_MAJOR = new Set(['2', '4', '7', '8', '21', '23'])         // ACC, Big East, Big Ten, Big 12, Pac-12 while it played, SEC
const confId = (q) => { const k = String(q).toLowerCase().replace(/[^a-z0-9]/g, ''); return Object.keys(CONFS).find((c) => CONFS[c].toLowerCase().replace(/[^a-z0-9]/g, '') === k) || Object.keys(CONFS).find((c) => CONFS[c].toLowerCase().replace(/[^a-z0-9]/g, '').includes(k)) || null }
const fullDate = (s, md) => (String(md).length === 5 ? `${+md.slice(0, 2) >= 7 ? s.slice(0, 4) : `20${s.slice(5)}`}-${md}` : md)    // a log's "11-03" in its season
async function prevSeason(s) { const idx = await index(); const all = idx.seasons.map((x) => x.season).sort(); const k = all.indexOf(s); return k > 0 ? all[k - 1] : null }
async function lastTeams(s) {                       // player id -> team id, the season before
  const ps = await prevSeason(s)
  if (!ps) return null
  const d = await seasonDoc(ps)
  return new Map(d.players.map((x) => [x[C.id], x[C.team]]))
}

// ---- answers --------------------------------------------------------------------------
function statLine(s, r, R) {
  const b = { key: s.key, label: s.label, group: s.group, context: s.kind === 'context', lower_is_better: s.lower, tracked: r.tracked }
  if (s.key.startsWith('rapm')) b.early = R.rapm_early
  if (!r.tracked) return { ...b, value: null, percentile: null, note: r.reason }
  if (r.low) return { ...b, value: r.value, shown: r.shown, percentile: null, low_sample: true, sample: r.n, note: 'low sample' }
  return { ...b, value: r.value, shown: r.shown, percentile: r.pct, before_adjustment: r.raw, sample: r.n, low_sample: r.settling, likely_to_settle_at: r.likelyShown }
}

async function searchPlayers({ query, limit }) {
  const d = await search()
  const hits = rank(prepare(d.players.map((p) => ({ p, name: p[1] }))), query, (a, b) => String(b.p[3]).localeCompare(a.p[3]))
  const out = []
  for (const h of hits.slice(0, limit)) { const p = h.row.p; out.push({ id: p[0], name: p[1], team: await tname(p[2]), team_id: p[2], latest_season: p[3], position: p[4], url: playerUrl(p[0]) }) }
  return { text: out.length ? out.map((p) => `${p.name}, ${p.team}, ${p.latest_season} (id ${p.id})`).join('\n') : `No match for "${query}".`, structured: { query, total: hits.length, count: out.length, players: out } }
}

async function profile({ player, season, pool, adjusted, garbage_time, per, group }) {
  const p = await findPlayer(player, season)
  const { s } = await pickSeason(season || p[3])
  const [R, d] = await Promise.all([reg(), seasonDoc(s)])
  const i = d.players.findIndex((x) => x[C.id] === p[0])
  if (i < 0) throw new SavantError(`${p[1]} has no line in ${s}. Try cbb_player_career.`)
  const pl = d.players[i]
  const o = { poolName: POOLKEY[pool], adj: adjusted, gt: garbage_time, per }
  const rows = R.stats.filter((x) => group === 'all' || x.group.toLowerCase() === group).map((x) => statLine(x, M.row(d, R, x, i, o), R))
  const pp = M.pool(d, R, i, POOLKEY[pool])
  const label = M.poolLabel(pp, pl, { adj: adjusted, season: s })
  const team = await tname(pl[C.team])
  const hon = ((await files.load('honours.json'))[pl[C.id]] || []).map((x) => ({ season: x[0], key: x[1], label: x[2] }))
  const val = M.valueLine(d, i), sched = M.schedule(d, i), conf_ = M.confidence(d, i)
  const T_ = await teamDoc(s, pl[C.team]).catch(() => null)
  const qr = T_ ? ((T_.splits[String(T_.roster.findIndex((r) => r[0] === pl[C.id]))] || {}).quality || []) : []
  const quality = qr.map((r) => ({ split: r[0], ...Object.fromEntries(SPLIT_COLS.map((c, k) => [c, r[k + 1]])) }))
  const cr = await career(pl[C.id]).then((x) => x[pl[C.id]]).catch(() => null)
  const cs = cr ? (cr.r.find((r) => r.s === s && r.t === pl[C.team]) || cr.r.find((r) => r.s === s)) : null
  const comps = cs ? (cs.cmp || []).map((x) => ({ id: x[0], name: x[1], season: x[2], match: Math.round(x[4] * 100), url: playerUrl(x[0], x[2]) })) : []
  const like = await coachesLikeHim(pl[C.id])
  const lines = [`${pl[C.name]}, ${team}, ${s}. ${pl[C.pos] || 'position unknown'}, ${pl[C.cls] || ''}, age ${miss(pl[C.age]) ? 'unknown' : pl[C.age].toFixed(1)} on Feb 1.`, `Percentiles ${label} (${pp.ids.length} players).${pp.widened ? ` ${pp.widened}.` : ''} Rates per ${per} possessions.`]
  for (const r of rows) lines.push(r.tracked ? `${r.label}${r.context ? ' (context)' : ''}: ${r.shown ?? '—'}${r.percentile == null ? (r.note ? ` (${r.note})` : '') : `, ${ordinal(r.percentile)} percentile`}${r.likely_to_settle_at ? `, likely to settle at ${r.likely_to_settle_at}` : ''}` : `${r.label}: ${r.note}`)
  if (rows.some((r) => r.early)) lines.push(`RAPM: ${R.rapm_early}`)
  if (val) lines.push(`Savant value: ${val.value.toFixed(1)} points over a replacement ${String(pl[C.pos]).toLowerCase()}${val.on_floor_part ? '' : ' (box score only: lineups start in 2024-25)'}.`)
  if (sched) lines.push(`${sched.text}.`)
  if (conf_) lines.push(`Adjustment confidence: ${conf_.text}.`)
  if ((pl[C.gp] || 0) < 5 && s === (await index()).seasons.map((x) => x.season).sort().slice(-1)[0]) lines.splice(2, 0, `EARLY SEASON: ${pl[C.gp] || 0} game${pl[C.gp] === 1 ? '' : 's'} played. Percentiles this early are noise; judge him on last season until about 10 games.`)
  if (comps.length) lines.push(`Nearest comparable player-seasons (match out of 100, as on the page; same position, within a year of age): ${comps.map((x) => `${x.name} ${x.season} (${x.match})`).join(', ')}.`)
  if (hon.length) lines.push(`Honours: ${hon.map((h) => `${h.label} ${h.season}`).join(', ')}.`)
  if (like && like.coaches.length) lines.push(`Coaches who used players like him (College Basketball Coaching Savant, match out of 100, as on the page): ${like.coaches.map((c) => `${c.name} (${c.match ?? '—'})`).join(', ')}. ${like.label} Detail: cbb_coaching_fit.`)
  else if (!like) lines.push('Coaches who used players like him: College Basketball Coaching Savant could not be read just now.')
  if (d.tier === 'box') lines.push(`${s} is a box-score season: shot zones, lineups, on/off and RAPM are not tracked.`)
  lines.push(`Data through ${day(d.through)}. ${playerUrl(pl[C.id], s)}`)
  return { text: lines.join('\n'), structured: { player: { id: pl[C.id], name: pl[C.name], team, team_id: pl[C.team], position: pl[C.pos], class: pl[C.cls], age_feb_1: pl[C.age], height_in: pl[C.ht], weight_lb: pl[C.wt], hometown: pl[C.home], recruit: pl[C.rrank] ? { stars: pl[C.stars], rank: pl[C.rrank], high_school: pl[C.hs] } : null, games: pl[C.gp], minutes: pl[C.min], qualified: !!pl[C.qual], url: playerUrl(pl[C.id], s) }, season: s, tier: d.tier || 'full', pool: { name: label, players: pp.ids.length, widened: pp.widened }, per, stats: rows, savant_value: val, honours: hon, schedule_strength: sched, adjustment_confidence: conf_, quality_splits: quality, comps, coaches_like_him: like, data_through: day(d.through), source: SOURCE } }
}

async function playerCareer({ player }) {
  const p = await findPlayer(player)
  const c = (await career(p[0]))[p[0]]
  const R = await reg()
  const by = Object.fromEntries(R.stats.map((s) => [s.key, s]))
  const seasons = []
  for (const r of c.r) {
    seasons.push({ season: r.s, team: await tname(r.t), team_id: r.t, position: r.p, class: r.c, games: r.g, minutes: r.m, transferred: seasons.length > 0 && seasons[seasons.length - 1].team_id !== r.t, stats: Object.fromEntries(Object.entries(r.v).map(([k, v]) => [k, { value: v[0], shown: M.display(by[k], v[0], 70), percentile: v[1] }])), comps: (r.cmp || []).map((x) => ({ id: x[0], name: x[1], season: x[2], match: Math.round(x[4] * 100) })) })
  }
  const lines = [`${c.b[0]}: ${seasons.map((s) => `${s.season} ${s.team}${s.transferred ? ' (transfer)' : ''}`).join('; ')}. Percentiles vs D1 at position, per season, adjusted where the stat has it.`]
  for (const s of seasons) {
    lines.push(`${s.season}: ${s.games} games, ${Object.entries(s.stats).filter(([, v]) => v.percentile != null).map(([k, v]) => `${by[k].label} ${v.shown} (${ordinal(v.percentile)})`).join(', ')}`)
    if (s.comps.length) lines.push(`  Nearest comparable player-seasons (match out of 100): ${s.comps.map((x) => `${x.name} ${x.season} (${x.match})`).join(', ')}`)
  }
  lines.push(playerUrl(p[0]))
  return { text: lines.join('\n'), structured: { player: { id: p[0], name: c.b[0], url: playerUrl(p[0]) }, pool: 'vs D1 at position, adjusted where the stat has it, same season', seasons } }
}

async function playerSplits({ player, season }) {
  const p = await findPlayer(player, season)
  const { s } = await pickSeason(season || p[3])
  const d = await seasonDoc(s)
  const row = d.players.find((x) => x[C.id] === p[0])
  if (!row) throw new SavantError(`${p[1]} has no line in ${s}.`)
  const T = await teamDoc(s, row[C.team])
  const ix = T.roster.findIndex((r) => r[0] === p[0])
  const sp = T.splits[String(ix)] || {}
  const splits = Object.fromEntries(Object.entries(sp).map(([k, rows]) => [k, rows.map((r) => ({ split: r[0], ...Object.fromEntries(SPLIT_COLS.map((c, i) => [c, r[i + 1]])) }))]))
  const names = new Map((await search()).teams.map((t) => [t[0], t[1]]))
  const games = (T.log[String(ix)] || []).map((g) => ({ gid: g[0], date: fullDate(s, g[1]), opponent_id: g[2], opponent: g[22] ? 'Non-D1' : names.get(g[2]) || 'Non-D1', home: !!g[3], neutral: !!g[4], team_pts: g[5], opp_pts: g[6], min: g[7], pts: g[8], fgm: g[9], fga: g[10], fg3m: g[11], fg3a: g[12], ftm: g[13], fta: g[14], reb: g[15], ast: g[16], tov: g[17], stl: g[18], blk: g[19], pf: g[20], non_d1: !!g[22], postseason: !!g[23] }))
  const lines = [`${row[C.name]}, ${s} splits (D1 opponents; no percentiles on splits; NET quads ${sp.quad ? 'by venue' : 'not tracked this season'}).`]
  for (const [k, rows] of Object.entries(splits)) lines.push(`${k}: ${rows.map((r) => `${r.split} ${r.games}g, ${(r.pts_per_poss * 70).toFixed(1)} pts/70, ${r.ts}% TS`).join('; ')}`)
  const cx = await ctxDoc(s, row[C.team]).catch(() => null)
  const me = cx && cx.pbp ? (cx.players || {})[row[C.id]] : null
  const context = me ? {
    shot_clock: Object.fromEntries(Object.entries(me.clock || {}).map(([k, v]) => [k, { fga: v[0], fgm: v[1], efg: v[0] ? Math.round(500 * v[2] / v[0]) / 10 : null }])),
    clutch_shooting: me.clutch_fg ? { fga: me.clutch_fg[0], fgm: me.clutch_fg[1], efg: me.clutch_fg[0] ? Math.round(500 * me.clutch_fg[2] / me.clutch_fg[0]) / 10 : null } : null,
    clutch_on_floor: me.clutch_on ? { own_poss: me.clutch_on[0], own_pts: me.clutch_on[1], opp_poss: me.clutch_on[2], opp_pts: me.clutch_on[3], net_per_100: me.clutch_on[0] && me.clutch_on[2] ? Math.round(10 * (100 * me.clutch_on[1] / me.clutch_on[0] - 100 * me.clutch_on[3] / me.clutch_on[2])) / 10 : null } : null,
    after_timeout: me.ato_fg ? { fga: me.ato_fg[0], fgm: me.ato_fg[1] } : null,
  } : null
  if (context) {
    lines.push(`Shot clock (estimated from possession start): ${Object.entries(context.shot_clock).map(([k, v]) => `${CLOCK_LABEL[k]} ${v.fga} FGA, ${v.efg ?? '—'}% eFG`).join('; ')}.`)
    if (context.clutch_shooting) lines.push(`Clutch (last 5 min within 5): ${context.clutch_shooting.fgm}/${context.clutch_shooting.fga} FG${context.clutch_on_floor && context.clutch_on_floor.net_per_100 != null ? `; team ${context.clutch_on_floor.net_per_100 > 0 ? '+' : ''}${context.clutch_on_floor.net_per_100} per 100 with him on the floor over ${context.clutch_on_floor.own_poss + context.clutch_on_floor.opp_poss} possessions` : ''}${context.clutch_shooting.fga < 20 ? ' (small sample)' : ''}.`)
  }
  if (games.length) lines.push(`Game log (${games.length}): ${games.slice(-8).map((g) => `${g.date} ${g.home ? 'vs' : g.neutral ? 'vs' : 'at'} ${g.opponent} ${g.pts} pts, ${g.min} min`).join('; ')}${games.length > 8 ? '; the full log is in games' : ''}.`)
  lines.push(playerUrl(p[0], s))
  return { text: lines.join('\n'), structured: { player: { id: row[C.id], name: row[C.name], url: playerUrl(row[C.id], s) }, season: s, splits, context, games, data_through: day(d.through) } }
}

async function leaderboard({ stat, season, position, min_possessions, min_sample, offset = 0, adjusted, garbage_time, per, limit, conference, level, class: cls, team, transfers_only, returning_only }) {
  const R = await reg()
  const st = R.stats.find((x) => x.key === stat)
  if (!st) throw new SavantError(`Unknown stat "${stat}". savant_dictionary (sport cbb, table stats) lists them.`)
  const { s } = await pickSeason(season)
  const d = await seasonDoc(s)
  const c = M.column(d, st.key, { adj: adjusted, gt: garbage_time })
  if (!c) throw new SavantError(`${st.label} is not tracked in ${s}.`)
  const cid = conference ? confId(conference) : null
  if (conference && !cid) throw new SavantError(`No conference matches "${conference}". Try one of: ${Object.values(CONFS).join(', ')}.`)
  const tid = team ? (await findTeam(team))[0] : null
  const before = transfers_only || returning_only ? await lastTeams(s) : null
  if ((transfers_only || returning_only) && !before) throw new SavantError(`${s} is the first season on file, so transfers can't be told apart.`)
  const ids = []
  for (let i = 0; i < d.players.length; i++) {
    if (miss(c[i]) || (d.samples.poss[i] || 0) < min_possessions) continue
    if (min_sample && st.sample && (d.samples[st.sample] || [])[i] < min_sample) continue
    if (position !== 'all' && d.players[i][C.pos] !== position) continue
    const P = d.players[i]
    if (cid && String(P[C.conf]) !== cid) continue
    if (level === 'high_major' && !HIGH_MAJOR.has(String(P[C.conf]))) continue
    if (level === 'mid_major' && HIGH_MAJOR.has(String(P[C.conf]))) continue
    if (cls && P[C.cls] !== cls) continue
    if (tid && P[C.team] !== tid) continue
    if (transfers_only && !(before.has(P[C.id]) && before.get(P[C.id]) !== P[C.team])) continue
    if (returning_only && before.get(P[C.id]) !== P[C.team]) continue
    if (st.key.startsWith('rapm') && (d.samples.rapm_n[i] || 0) < R.rapm_min) continue
    ids.push(i)
  }
  ids.sort((a, b) => (st.lower ? c[a] - c[b] : c[b] - c[a]))
  const rows = []
  for (const [k0, i] of ids.slice(offset, offset + limit).entries()) {
    const k = k0 + offset
    const p = d.players[i]
    const r = M.row(d, R, st, i, { poolName: position === 'all' ? 'all' : 'pos', adj: adjusted, gt: garbage_time, per })
    rows.push({ rank: k + 1, id: p[C.id], name: p[C.name], team: await tname(p[C.team]), conference: CONFS[p[C.conf]] || null, class: p[C.cls], ...(before ? { last_season_team: before.has(p[C.id]) ? await tname(before.get(p[C.id])) : null } : {}), position: p[C.pos], ...(st.sample && st.sample_unit && d.samples[st.sample] ? { sample: d.samples[st.sample][i], sample_unit: st.sample_unit } : {}), value: +c[i], shown: M.display(st, c[i], per), percentile: r.pct ?? null, url: playerUrl(p[C.id], s) })
  }
  const pool = `vs D1 ${position === 'all' ? 'players' : `${position.toLowerCase()}s`}, ${adjusted && M.hasAdj(d, st.key) ? 'opponent-adjusted' : M.hasAdj(d, st.key) ? 'raw' : 'as computed (no separate opponent-adjusted version)'}, ${s}`
  const early = st.key.startsWith('rapm') ? R.rapm_early : null
  const only = [cid && CONFS[cid], level && level !== 'all' && level.replace('_', '-'), cls, tid && (await tname(tid)), transfers_only && 'transfers (new school this season)', returning_only && 'returning to the same school'].filter(Boolean)
  return { text: [`${st.label} leaders, ${pool}, min ${min_possessions} possessions${min_sample && st.sample_unit ? `, min ${min_sample} ${st.sample_unit}` : ''}${only.length ? `; only ${only.join(', ')}` : ''} (${ids.length} players)${only.length ? '. Percentiles stay against the full pool' : ''}:`, ...rows.map((r) => `${r.rank}. ${r.name}, ${r.team} (${r.conference || 'D1'}, ${r.class || '?'}${r.last_season_team && r.last_season_team !== r.team ? `, from ${r.last_season_team}` : ''}): ${r.shown}${r.sample != null ? ` on ${Math.round(r.sample)} ${r.sample_unit}` : ''}${r.percentile == null ? '' : `, ${ordinal(r.percentile)} percentile`}`), ...(early ? [`RAPM: ${early}`] : []), `Data through ${day(d.through)}. ${PAGE}#leaders`].join('\n'), structured: { stat: st.key, label: st.label, season: s, pool, players: ids.length, offset, ...(offset + rows.length < ids.length ? { next_offset: offset + rows.length } : {}), rows, data_through: day(d.through), ...(early ? { early } : {}) } }
}

const CONFS = { 1: 'America East', 2: 'ACC', 3: 'A-10', 4: 'Big East', 5: 'Big Sky', 6: 'Big South', 7: 'Big Ten', 8: 'Big 12', 9: 'Big West', 10: 'CAA', 11: 'CUSA', 12: 'Ivy', 13: 'MAAC', 14: 'MAC', 16: 'MEAC', 18: 'MVC', 19: 'NEC', 20: 'OVC', 21: 'Pac-12', 22: 'Patriot', 23: 'SEC', 24: 'SoCon', 25: 'Southland', 26: 'SWAC', 27: 'Sun Belt', 29: 'WCC', 30: 'WAC', 44: 'Mountain West', 45: 'Horizon', 46: 'ASUN', 49: 'Summit', 62: 'American' }
export const ALL_SAVANT = ['first', 'second', 'third', 'conference', 'freshman', 'player_of_the_year']

async function allSavant({ season, team, conference }) {
  const { s, idx } = await pickSeason(season)
  const t = await files.load(`allsavant/${s}.json`)
  const line = async (p) => ({ id: p.id, name: p.name, team: await tname(p.team), team_id: p.team, seat: p.slot, position: p.pos, class: p.cls, savant_value: p.value, filled_seat: !!p.filled, url: playerUrl(p.id, s) })
  const many = async (rows) => { const out = []; for (const r of rows) out.push(await line(r)); return out }
  let rows, label
  if (team === 'player_of_the_year') { rows = t.poy ? [t.poy] : []; label = 'Savant Player of the Year' } else if (team === 'freshman') { rows = t.freshman; label = 'All-Freshman team' } else if (team === 'conference') {
    if (!conference) throw new SavantError(`Name a conference: ${Object.keys(t.conference).map((c) => CONFS[c] || c).join(', ')}.`)
    const q = String(conference).toLowerCase()
    const id = Object.keys(t.conference).find((c) => String(CONFS[c] || c).toLowerCase() === q) || Object.keys(t.conference).find((c) => String(CONFS[c] || c).toLowerCase().includes(q))
    if (!id) throw new SavantError(`No conference matches "${conference}" in ${s}.`)
    rows = t.conference[id]; label = `All-${CONFS[id] || id} team`
  } else { rows = t.national[{ first: '1', second: '2', third: '3' }[team]]; label = `All-Savant ${team} team` }
  const players = await many(rows)
  const status = t.final ? 'final' : `standing so far, through ${day(t.through)}; honours come after the national championship`
  const lines = [`${label}, ${s} (${status}). By Savant value, points over a replacement player at the position. The model's view, not a verdict.`, ...players.map((p) => `${p.seat}: ${p.name}, ${p.team}, ${p.savant_value.toFixed(1)}${p.filled_seat ? ` (filled seat, a ${String(p.position).toLowerCase()})` : ''}`)]
  if (t.note) lines.push(t.note)
  lines.push(s >= '2024-25' ? 'Value includes the on-floor part.' : 'Value is box score only: lineups start in 2024-25.', `${PAGE}#all-savant`)
  return { text: lines.join('\n'), structured: { season: s, team, label, final: t.final, so_far: t.so_far, players, replacement: t.replacement, default_season: idx.default_season } }
}

// best-first direction for each rankable team column (true = lower is better for the team)
const TEAM_SORTS = { net: false, adjo: false, adjd: true, market: false, bpi: false, luck: false, sos: false, tempo: false, efg: false, oefg: true, tov: true, otov: false, orb: false, drb: false, ftr: false, oftr: true, rim: false, mid: false, three: false, orim: false, omid: false, othree: false }
const TEAM_LABEL = { net: 'adjusted net', adjo: 'adjusted offense', adjd: 'adjusted defense (lower is better)', market: 'the market', bpi: 'BPI', luck: 'luck (wins above expected)', sos: 'strength of schedule', tempo: 'pace', efg: 'eFG%', oefg: 'eFG% allowed (lower is better)', tov: 'turnover rate (lower is better)', otov: 'turnovers forced', orb: 'offensive rebound %', drb: 'defensive rebound %', ftr: 'free-throw rate', oftr: 'free-throw rate allowed (lower is better)', rim: 'share of shots at the rim', mid: 'share of shots that are non-rim twos', three: 'share of shots from three', orim: 'share of opponent shots at the rim', omid: 'share of opponent shots that are twos away from the rim', othree: 'share of opponent shots from three' }
async function teamRankings({ season, limit, sort, conference, level, ascending }) {
  const { s } = await pickSeason(season)
  const t = await teamsDoc(s)
  const cid = conference ? confId(conference) : null
  if (conference && !cid) throw new SavantError(`No conference matches "${conference}". Try one of: ${Object.values(CONFS).join(', ')}.`)
  const low = TEAM_SORTS[sort]
  const best = t.teams.filter((r) => r[sort] != null).slice().sort((a, b) => (low ? a[sort] - b[sort] : b[sort] - a[sort]))
  const d1 = new Map(best.map((r, i) => [r.id, 1 + best.filter((x) => (low ? x[sort] < r[sort] : x[sort] > r[sort])).length]))
  const all = ascending ? best.slice().reverse() : best
  const pool = all.filter((r) => (!cid || String(r.conf) === cid) && (level !== 'high_major' || HIGH_MAJOR.has(String(r.conf))) && (level !== 'mid_major' || !HIGH_MAJOR.has(String(r.conf))))
  const rows = pool.slice(0, limit)
  const scope = [cid && CONFS[cid], level && level !== 'all' && level.replace('_', '-')].filter(Boolean).join(', ')
  return { text: [`D1 teams, ${s}, by ${TEAM_LABEL[sort]}, ${ascending ? 'worst' : 'best'} first${scope ? `; only ${scope} (${pool.length} teams)` : ''}. "D1 rank" is among all ${all.length}:`, ...rows.map((r, i) => `${i + 1}. ${r.name} (${CONFS[r.conf] || 'D1'}) ${r.w}-${r.l}: ${TEAM_LABEL[sort].split(' (')[0]} ${r[sort]} (D1 rank ${d1.get(r.id)}); net ${r.net}, off ${r.adjo}, def ${r.adjd}`), `${PAGE}#teams`].join('\n'), structured: { season: s, sort, conference: cid ? CONFS[cid] : null, level: level || 'all', teams: rows.map((r) => ({ ...r, conference: CONFS[r.conf] || null, d1_rank: d1.get(r.id) })) } }
}

async function teamProfile({ team, season }) {
  const t = await findTeam(team)
  const { s } = await pickSeason(season)
  const [tb, T] = await Promise.all([teamsDoc(s), teamDoc(s, t[0])])
  const r = tb.teams.find((x) => x.id === t[0])
  if (!r) throw new SavantError(`${t[1]} has no line in ${s}.`)
  const roster = T.roster.map((x) => ({ id: x[0], name: x[1], position: x[2], class: x[3], minutes: x[4] }))
  const results = []
  for (const g of T.results) results.push({ gid: g[0], date: g[1], opponent_id: g[2], opponent: g[7] ? 'Non-D1' : await tname(g[2]), home: !!g[3], neutral: !!g[4], pts: g[5], opp_pts: g[6], non_d1: !!g[7], postseason: !!g[8], ot: g[9] })
  const offRank = 1 + tb.teams.filter((x) => x.adjo > r.adjo).length, defRank = 1 + tb.teams.filter((x) => x.adjd < r.adjd).length
  // D1 rank of each factor, 1 = best for this team (higher own eFG, lower eFG allowed, ...)
  const LOW = { oefg: 1, tov: 1, ftr: 0, oftr: 1, orb: 0, drb: 0, otov: 0, efg: 0 }
  const fr = (k) => (r[k] == null ? null : 1 + tb.teams.filter((x) => x[k] != null && (LOW[k] ? x[k] < r[k] : x[k] > r[k])).length)
  const n = tb.teams.length
  const ranks = Object.fromEntries(Object.keys(LOW).map((k) => [k, fr(k)]))
  const rk = (k) => (ranks[k] ? ` (${ordinal(ranks[k])})` : '')
  const last = results.slice(-5).map((g) => `${g.pts > g.opp_pts ? 'W' : 'L'} ${g.pts}-${g.opp_pts} ${g.neutral ? 'vs' : g.home ? 'vs' : 'at'} ${g.opponent}`)
  const earlyTeam = (r.gp || 0) < 5 && s === (await index()).seasons.map((x) => x.season).sort().slice(-1)[0]
  const hc = await headCoaches(t[0], s)
  const hcLine = hc === null ? 'Head coach: College Basketball Coaching Savant could not be read just now.' : hc.length ? `Head coach: ${hc.map((c) => `${c.name}${c.interim ? ' (interim)' : ''}`).join(', ')} (College Basketball Coaching Savant's head coach of record; cbb_get_coach_profile for his record and style).` : null
  return { text: [...(earlyTeam ? [`EARLY SEASON: ${r.gp} game${r.gp === 1 ? '' : 's'} played. Ratings and ranks this early are mostly noise; use last season for judgments.`] : []), `${r.full || r.name} (${CONFS[r.conf] || r.conf}), ${s}: ${r.w}-${r.l} vs D1, ranked ${ordinal(r.rank)}. Net ${r.net}, offense ${r.adjo}, defense ${r.adjd}, pace ${r.tempo}. The market: ${r.market ?? 'no line'}. BPI ${r.bpi ?? '—'}. NCAA NET rank ${r.netrank ?? 'not tracked'}. Luck ${r.luck}. SOS ${r.sos}.`, ...(hcLine ? [hcLine] : []), `Offense ranks ${ordinal(offRank)} and defense ${ordinal(defRank)} of ${tb.teams.length} D1 teams.`, `Four factors with D1 rank of ${n} (1st = best for this team). Offense: eFG ${r.efg}%${rk('efg')}, turnover rate ${r.tov}%${rk('tov')}, offensive rebounding ${r.orb}%${rk('orb')}, free-throw rate ${r.ftr}${rk('ftr')}. Defense: eFG allowed ${r.oefg}%${rk('oefg')}, turnovers forced ${r.otov}%${rk('otov')}, defensive rebounding ${r.drb}%${rk('drb')}, free-throw rate allowed ${r.oftr}${rk('oftr')}.`, `Shot diet, share of shots taken / allowed: rim ${r.rim}% / ${r.orim}%, midrange ${r.mid}% / ${r.omid}%, three ${r.three}% / ${r.othree}%.`, `Roster by minutes: ${roster.slice(0, 8).map((x) => x.name).join(', ')}.`, ...((await index()).seasons.find((x) => x.season === s && x.context === 'full') ? ['Play context (possession starts, transition, after timeouts, clutch, shot clock) is in cbb_play_context; shot charts in cbb_shot_chart; the rotation in cbb_rotation.'] : []), ...(last.length ? [`Latest results: ${last.join('; ')}.`] : []), teamUrl(t[0], s)].join('\n'), structured: { team: { ...r, conference: CONFS[r.conf] || null, off_rank: offRank, def_rank: defRank, factor_ranks: ranks }, season: s, head_coach: hc, roster, results, url: teamUrl(t[0], s) } }
}

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)
function pickIdx(T, names, t, s) {
  return (names || []).map((n) => {
    const q = String(n).toLowerCase()
    const hits = T.roster.map((r, i) => [r, i]).filter(([r]) => r[1].toLowerCase() === q || r[0] === n)
    const i = hits.length ? hits[0][1] : T.roster.findIndex((r) => r[1].toLowerCase().includes(q))
    if (i < 0) throw new SavantError(`${n} is not on ${t[1]}'s ${s} roster.`)
    return i
  })
}

async function lineups({ team, season, size, with: withNames, without }) {
  const t = await findTeam(team)
  const { s, row } = await pickSeason(season)
  if (!row.court) return { text: `Lineups are not tracked in ${s}: they start in 2024-25.`, structured: { team: t[1], season: s, tracked: false, units: [], with_without: null } }
  const T = await teamDoc(s, t[0])
  const name = (i) => (T.roster[i] || [])[1] || '?'
  const wi = pickIdx(T, withNames, t, s), wo = pickIdx(T, without, t, s)
  const units = (T.units[String(size)] || []).filter((u) => wi.every((i) => u.ids.includes(i)) && !wo.some((i) => u.ids.includes(i))).slice(0, 20).map((u) => ({ players: u.ids.map(name), possessions: u.poss, minutes: u.min, ortg: u.ortg, drtg: u.drtg, net: u.net, luck_adjusted: u.adj, shrunk: u.est }))
  const w = M.withWithout(T.fives, wi, wo)
  const filtered = wi.length || wo.length
  const rest = filtered ? (() => {
    const t = { sec: 0, p: 0, q: 0, pts: 0, opts: 0 }
    for (const f of T.fives) {
      if (wi.every((i) => f[0].includes(i)) && !wo.some((i) => f[0].includes(i))) continue
      t.sec += f[1]; t.p += f[2]; t.q += f[3]; t.pts += f[4]; t.opts += f[5]
    }
    const ortg = t.p ? 100 * t.pts / t.p : null, drtg = t.q ? 100 * t.opts / t.q : null
    return { minutes: t.sec / 60, possessions: t.p, ortg, drtg, net: ortg === null || drtg === null ? null : ortg - drtg }
  })() : null
  const lines = [`${t[1]} ${s}, ${size}-man units (min ${size === 5 ? 30 : 60} possessions, garbage time out; net per 100; shrunk pulls small samples toward the team):`, ...units.slice(0, 8).map((u) => `${u.players.join(', ')}: ${u.possessions} poss, net ${u.net}, shrunk ${u.shrunk}`)]
  if (filtered) lines.push(`With ${(withNames || []).join(', ') || 'anyone'}, without ${(without || []).join(', ') || 'nobody'}: ${Math.round(w.poss)} possessions, offense ${w.ortg === null ? '—' : w.ortg.toFixed(1)}, defense ${w.drtg === null ? '—' : w.drtg.toFixed(1)}, net ${w.net === null ? '—' : w.net.toFixed(1)} per 100. The rest of the time: ${Math.round(rest.possessions)} possessions, net ${rest.net === null ? '—' : rest.net.toFixed(1)}. Raw, not luck-adjusted; the units above are the ones matching the filter.`)
  lines.push(teamUrl(t[0], s))
  return { text: lines.join('\n'), structured: { team: t[1], season: s, tracked: true, size, units, with_without: { with: withNames || [], without: without || [], minutes: r1(w.min), possessions: Math.round(w.poss), ortg: r1(w.ortg), drtg: r1(w.drtg), net: r1(w.net), rest_of_the_time: rest && { minutes: r1(rest.minutes), possessions: Math.round(rest.possessions), ortg: r1(rest.ortg), drtg: r1(rest.drtg), net: r1(rest.net) }, luck_adjusted: false } } }
}

async function game({ game_id, season }) {
  const { s } = await pickSeason(season)
  const d = await files.load(`games/${s}.json`)
  const ix = Object.fromEntries(d.cols.map((c, i) => [c, i]))
  const r = d.rows.find((x) => x[0] === game_id)
  if (!r) throw new SavantError(`No game ${game_id} in ${s}. Game ids come from cbb_team_profile's results.`)
  const g = Object.fromEntries(d.cols.map((c, i) => [c, r[i]]))
  g.home_team = await tname(g.home); g.away_team = await tname(g.away)
  return { text: `${g.date}: ${g.away_team} ${g.away_pts}, ${g.home_team} ${g.home_pts}${g.ot ? ` (${g.ot} OT)` : ''}${g.neutral ? ', neutral site' : ''}${g.postseason ? ', postseason' : ''}.${miss(r[ix.home_spread]) ? '' : ` Home spread ${r[ix.home_spread]}.`}`, structured: { game: g, season: s } }
}

const OPS = { eq: (a, b) => a === b, gte: (a, b) => a >= b, lte: (a, b) => a <= b, gt: (a, b) => a > b, lt: (a, b) => a < b, contains: (a, b) => String(a).includes(String(b)) }

// A Data Room table's every row for a season (and team, where the rows are kept per team-season),
// with names and dates joined in: what savant_data (api/_dataroom.js) filters, sorts and pages.
// Split out of data() (Nov 2026), which keeps its own filters for the parity check against it.
export const CBB_TABLES = TABLES
export async function cbbTable({ table, season, team }) {
  if (!TABLES.includes(table)) throw new SavantError(`No college basketball table "${table}". Tables: ${TABLES.join(', ')}.`)
  const { s } = await pickSeason(season)
  let cols, rows
  const names = new Map((await search()).teams.map((t) => [t[0], t[1]]))
  if (table === 'games') {
    const d = await files.load(`games/${s}.json`); const h = d.cols.indexOf('home'), a = d.cols.indexOf('away')
    const tid = team ? (await findTeam(team))[0] : null
    cols = [...d.cols, 'home_team', 'away_team']; rows = d.rows.filter((r) => !tid || r[h] === tid || r[a] === tid).map((r) => [...r, names.get(r[h]) || 'Non-D1', names.get(r[a]) || 'Non-D1'])
  } else {
    if (!team) throw new SavantError(`${table} needs a team: the rows are kept per team-season.`)
    const t = await findTeam(team)
    const T = await teamDoc(s, t[0])
    if (table === 'possessions') {
      const pd = await possDoc(s, t[0]).catch(() => { throw new SavantError(`The possessions table starts in 2025-26.`) })
      const nm = new Map(T.roster.map((r) => [r[0], r[1]]))
      const fi = pd.cols.indexOf('five'), oi = pd.cols.indexOf('opp_five'), op = pd.cols.indexOf('opp')
      cols = [...pd.cols.slice(0, op + 1), 'opp_team', ...pd.cols.slice(op + 1)]
      rows = pd.rows.map((r) => { const x = r.slice(); x[fi] = (x[fi] || []).map((e) => nm.get(e) || e).join(', '); x[oi] = (x[oi] || []).length; x.splice(op + 1, 0, names.get(r[op]) || 'Non-D1'); return x })
    } else if (table === 'units') { cols = ['players', 'seconds', 'poss', 'opp_poss', 'pts', 'opp_pts', 'opp_fg3a', 'opp_fg3m', 'opp_fta', 'opp_ftm']; rows = T.fives.map((f) => [f[0].map((i) => T.roster[i][1]).join(', '), ...f.slice(1)]) } else {
      cols = ['player_id', 'player', 'gid', 'date', 'opponent_id', 'opponent', 'home', 'neutral', 'team_pts', 'opp_pts', 'min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'tov', 'stl', 'blk', 'pf', 'starter', 'non_d1', 'postseason']
      rows = []
      for (const [k, list] of Object.entries(T.log)) for (const g of list) rows.push([T.roster[k][0], T.roster[k][1], g[0], fullDate(s, g[1]), g[2], g[22] ? 'Non-D1' : names.get(g[2]) || 'Non-D1', ...g.slice(3)])
    }
  }
  return { s, cols, rows }
}

// The tool cbb_data answered with until savant_data replaced it; kept for the parity check
// (tools/dataroom/check.mjs) and nothing else.
export async function data({ table, season, team, filters, columns, offset = 0, limit = 100, sort, descending }) {
  const t = await cbbTable({ table, season, team })
  const s = t.s, cols = t.cols
  let rows = t.rows
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]))
  for (const f of filters || []) { if (!(f.column in ix)) throw new SavantError(`No column ${f.column} in ${table}.`); rows = rows.filter((r) => OPS[f.op](r[ix[f.column]], f.value)) }
  if (sort) { if (!(sort in ix)) throw new SavantError(`No column ${sort} in ${table}.`); const k = ix[sort]; rows = rows.slice().sort((a, b) => (a[k] == null) - (b[k] == null) || (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (descending ? -1 : 1)) }
  const total = rows.length
  const want = columns && columns.length ? columns : cols
  const bad = want.filter((c) => !(c in ix)); if (bad.length) throw new SavantError(`No column ${bad.join(', ')} in ${table}. Columns: ${cols.join(', ')}.`)
  const page = rows.slice(offset, offset + limit).map((r) => Object.fromEntries(want.map((c) => [c, r[ix[c]]])))
  return { text: `${table}, ${s}: ${total} rows match; ${page.length} returned from ${offset}${offset + page.length < total ? ` (next offset ${offset + page.length})` : ''}. Columns: ${want.join(', ')}. All numbers are WCE-derived.\n${page.slice(0, 40).map((r) => JSON.stringify(want.map((c) => r[c]))).join('\n')}${page.length > 40 ? '\n… the rest are in rows' : ''}`, structured: { table, season: s, total, offset, count: page.length, columns: want, rows: page } }
}

// ---- the schedule: ESPN's team schedule, read live (finals, and games still to play) ----------
const ESPN_SCHED = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams'
const schedCache = new Map()
async function espnSchedule(teamId, s) {
  const key = `${teamId}|${s}`, hit = schedCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000)
  try {
    const res = await fetch(`${ESPN_SCHED}/${encodeURIComponent(teamId)}/schedule?season=${+s.slice(0, 4) + 1}`, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const v = await res.json()
    schedCache.set(key, { at: Date.now(), v })
    if (schedCache.size > 200) schedCache.delete(schedCache.keys().next().value)
    return v
  } finally { clearTimeout(timer) }
}

async function schedule({ team, season, upcoming_only }) {
  const t = await findTeam(team)
  const idx = await index()
  const s = season || idx.seasons.map((x) => x.season).sort().slice(-1)[0]
  if (!SEASON_RE.test(s)) throw new SavantError(`Season looks like "2026-27".`)
  let raw
  try { raw = await espnSchedule(t[0], s) } catch (e) { throw new SavantError(`The schedule could not be read just now (${e.message}). Played games are in cbb_team_profile's results.`) }
  const [ratings, names] = await Promise.all([teamsDoc(s).catch(() => null), search()])
  const rk = new Map((ratings ? ratings.teams : []).map((r) => [r.id, r]))
  const known = new Set(names.teams.map((x) => x[0]))
  const games = (raw.events || []).map((e) => {
    const c = (e.competitions || [])[0] || {}
    const me = (c.competitors || []).find((x) => String(x.team && x.team.id) === t[0]) || {}
    const op = (c.competitors || []).find((x) => x !== me) || {}
    const oid = String((op.team || {}).id || '')
    const done = !!(((c.status || {}).type || {}).completed)
    const score = (x) => (x.score && typeof x.score === 'object' ? +x.score.value : x.score == null ? null : +x.score)
    const r = rk.get(oid)
    return { gid: String(e.id), date: e.date ? new Date(e.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null, tipoff_utc: e.date || null, opponent: (op.team || {}).displayName || (op.team || {}).location || 'TBD', opponent_id: oid || null, d1: known.has(oid), home: me.homeAway === 'home' && !c.neutralSite, neutral: !!c.neutralSite, venue: (c.venue || {}).fullName || null, completed: done, result: done ? (score(me) > score(op) ? 'W' : 'L') : null, pts: done ? score(me) : null, opp_pts: done ? score(op) : null, opponent_rank: r ? r.rank : null, opponent_net: r ? r.net : null }
  })
  const list = upcoming_only ? games.filter((g) => !g.completed) : games
  const ratedNote = ratings ? `Dates are US Eastern. Opponent rank and net are our ${s} ratings, which are early until about 10 games.` : ''
  const lines = [`${t[1]} schedule, ${s} (${games.filter((g) => g.completed).length} played, ${games.filter((g) => !g.completed).length} to play). ${ratedNote}`]
  for (const g of list.slice(0, 40)) lines.push(`${g.date} ${g.home ? 'vs' : g.neutral ? 'vs (neutral)' : 'at'} ${g.opponent}${g.opponent_rank ? ` (our #${g.opponent_rank})` : g.d1 ? '' : ' (non-D1)'}${g.completed ? `: ${g.result} ${g.pts}-${g.opp_pts}` : ''}`)
  lines.push(`Source: ESPN schedule, read live. ${teamUrl(t[0], s)}`)
  return { text: lines.join('\n'), structured: { team: t[1], team_id: t[0], season: s, games: list, source: 'ESPN schedule (live)' } }
}

// ---- play context (pipeline/college/context.py): possession starts, transition, after timeouts,
// clutch, the shot clock (estimated), shot charts and rotation maps. 2025-26 on; 2023-24 and
// 2024-25 have rotation maps only.
const KIND_LABEL = { made: 'after a made basket', dreb: 'after a defensive rebound', steal: 'after a steal', tov: 'after a dead-ball turnover', ft: 'after made free throws', period: 'at the start of a half', other: 'start not logged' }
const CLOCK_LABEL = { early: '0-10 s', mid: '10-20 s', late: '20+ s' }
const ppp = (x) => (x && x[0] ? x[1] / x[0] : null)
const f2 = (x) => (x == null ? '—' : x.toFixed(2))
async function contextSeasons() { const idx = await index(); return idx.seasons.filter((x) => x.context).map((x) => [x.season, x.context]) }
async function pickContext(season, need = 'full') {
  const have = await contextSeasons()
  const ok = have.filter(([, c]) => need === 'rotation' || c === 'full').map(([s]) => s).sort()
  const s = season || ok.slice(-1)[0]
  if (!ok.includes(s)) throw new SavantError(`Play context ${need === 'rotation' ? 'and rotation maps are' : 'is'} on file for ${ok.join(', ') || 'no season yet'}${need === 'full' ? ' (2023-24 and 2024-25 have rotation maps only)' : ''}.`)
  return s
}
const RANK_LABEL = { transition_ppp: 'transition points per possession', transition_share: 'share of live-ball possessions run in transition', transition_ppp_allowed: 'transition points allowed per possession (lower is better)', ato_ppp: 'points per possession after own timeouts', clutch_net: 'clutch net per 100 possessions', early_share: 'share of shots in the first 10 seconds', late_efg: 'eFG% on shots 20+ seconds in' }
const rk = (r) => (r ? ` (${ordinal(r[1])} of ${r[2]})` : '')

async function playContext({ team, season }) {
  const t = await findTeam(team)
  const s = await pickContext(season)
  const [d, L] = await Promise.all([ctxDoc(s, t[0]), ctxLeague(s)])
  const R = d.ranks || {}
  const lp = ppp(L.poss)
  const kinds = Object.keys(KIND_LABEL).filter((k) => k !== 'other')
  const starts = kinds.map((k) => ({ start: k, label: KIND_LABEL[k], own_poss: d.starts.own[k][0], own_ppp: ppp(d.starts.own[k]), opp_poss: d.starts.opp[k][0], opp_ppp: ppp(d.starts.opp[k]), d1_ppp: ppp(L.starts[k]) }))
  const clock = Object.keys(CLOCK_LABEL).map((k) => ({ bucket: k, label: CLOCK_LABEL[k], fga: d.clock.own[k][0], efg: d.clock.own[k][0] ? 50 * d.clock.own[k][2] / d.clock.own[k][0] : null, opp_fga: d.clock.opp[k][0], opp_efg: d.clock.opp[k][0] ? 50 * d.clock.opp[k][2] / d.clock.opp[k][0] : null, d1_efg: L.clock[k][0] ? 50 * L.clock[k][2] / L.clock[k][0] : null }))
  const clutch = { own_poss: d.clutch.own[0], own_ppp: ppp(d.clutch.own), opp_poss: d.clutch.opp[0], opp_ppp: ppp(d.clutch.opp), games: d.clutch.games, net_per_100: R.clutch_net ? R.clutch_net[0] : null }
  const lines = [`${t[1]} ${s} play context (garbage time out; through ${day(d.through)}). D1 average ${f2(lp)} points per possession. Ranks are among D1 teams, 1st = best for the team.`,
    `Possession starts, own points per possession (allowed; D1 average for that start): ${starts.map((x) => `${x.label} ${f2(x.own_ppp)} on ${x.own_poss} (allowed ${f2(x.opp_ppp)}; D1 ${f2(x.d1_ppp)})`).join('; ')}. Judge each start against its own D1 average, not the overall one: possessions after a steal score well above the rest everywhere.`,
    `Transition (a live-ball start, first action within 8 s): ${d.transition.own[0]} possessions, ${f2(ppp(d.transition.own))} per possession${rk(R.transition_ppp)}; ${d.transition.own[2] ? Math.round(100 * d.transition.own[0] / d.transition.own[2]) : 0}% of live-ball possessions${rk(R.transition_share)}; allowed ${f2(ppp(d.transition.opp))}${rk(R.transition_ppp_allowed)}.`,
    `After own timeouts (the team's own timeouts, not media timeouts or the opponent's; first action a shot or a turnover): ${d.ato[0]} possessions, ${f2(ppp(d.ato))} per possession${rk(R.ato_ppp)} (D1 ${f2(ppp(L.ato))}).`,
    `Clutch (last 5 minutes within 5, ${d.clutch.games} games): offense ${f2(clutch.own_ppp)} on ${clutch.own_poss}, defense ${f2(clutch.opp_ppp)} on ${clutch.opp_poss}${R.clutch_net ? `, net ${R.clutch_net[0] > 0 ? '+' : ''}${R.clutch_net[0].toFixed(1)} per 100${rk(R.clutch_net)}` : ' (too few possessions to rank)'}.`,
    `Shot clock (estimated from when each possession began; the feed has no shot clock): ${clock.map((x) => `${x.label} ${x.fga} FGA at ${x.efg == null ? '—' : x.efg.toFixed(1)}% eFG (D1 ${x.d1_efg == null ? '—' : x.d1_efg.toFixed(1)}%)`).join('; ')}.`,
    teamUrl(t[0], s)]
  return { text: lines.join('\n'), structured: { team: t[1], season: s, through: d.through, possessions: { own: d.poss[0], own_pts: d.poss[1], opp: d.poss[2], opp_pts: d.poss[3] }, d1_ppp: lp, starts, transition: { own: d.transition.own, opp: d.transition.opp, columns: ['possessions', 'points', 'live-ball possessions'] }, after_timeout: { possessions: d.ato[0], ppp: ppp(d.ato), d1_ppp: ppp(L.ato) }, clutch, shot_clock: clock, ranks: R, url: teamUrl(t[0], s) } }
}

// shot areas from 2-ft bins: approximate at the edges
function area(c, r) {
  const x = c * 2 + 1, y = r * 2 - 1, dx = x - 25, d = Math.hypot(dx, y)
  if (y <= 8 && Math.abs(dx) >= 21.5) return dx < 0 ? 'corner_3_left' : 'corner_3_right'
  if (d >= 22.1) return 'above_break_3'
  if (d < 4) return 'rim'
  if (Math.abs(dx) <= 6 && y <= 13.75) return 'paint'
  return d < 15 ? 'short_mid' : 'long_mid'
}
const AREA_LABEL = { rim: 'at the rim (within 4 ft)', paint: 'paint, outside 4 ft', short_mid: 'short midrange', long_mid: 'long two', corner_3_left: 'left corner three', corner_3_right: 'right corner three', above_break_3: 'above-the-break three' }
function areas(bins) {
  const out = Object.fromEntries(Object.keys(AREA_LABEL).map((k) => [k, [0, 0]]))
  for (const [c, r, a, m] of bins || []) { const k = area(c, r); out[k][0] += a; out[k][1] += m }
  return out
}

async function shotChart({ player, team, season, side }) {
  if (!player && !team) throw new SavantError('Name a player or a team.')
  const s = await pickContext(season)
  const L = await ctxLeague(s)
  const lg = areas(L.bins)
  let who, bins, url, tid
  if (player) {
    const p = await findPlayer(player, s)
    const d = await seasonDoc(s)
    const row = d.players.find((x) => x[C.id] === p[0])
    if (!row) throw new SavantError(`${p[1]} has no line in ${s}.`)
    tid = row[C.team]
    const doc = await ctxDoc(s, tid)
    const me = (doc.players || {})[p[0]]
    if (!me || !me.fga) throw new SavantError(`${row[C.name]} has no field-goal attempts on file in ${s}.`)
    who = `${row[C.name]} (${await tname(tid)})`; bins = me.shots; url = playerUrl(p[0], s)
  } else {
    const t = await findTeam(team); tid = t[0]
    const doc = await ctxDoc(s, tid)
    bins = side === 'allowed' ? doc.shots.opp : doc.shots.own
    who = `${t[1]}${side === 'allowed' ? ', shots allowed' : ''}`; url = teamUrl(tid, s)
  }
  const a = areas(bins), tot = Object.values(a).reduce((n, v) => n + v[0], 0)
  const rows = Object.entries(a).map(([k, [att, made]]) => ({ area: k, label: AREA_LABEL[k], fga: att, fgm: made, share: tot ? Math.round(1000 * att / tot) / 10 : 0, fg_pct: att ? Math.round(1000 * made / att) / 10 : null, d1_fg_pct: lg[k][0] ? Math.round(1000 * lg[k][1] / lg[k][0]) / 10 : null, d1_share: Math.round(1000 * lg[k][0] / Object.values(lg).reduce((n, v) => n + v[0], 0)) / 10 }))
  const lines = [`${who} shot chart, ${s}: ${tot} located field-goal attempts, garbage time out. Areas are read from 2-ft squares, so edges are approximate.`,
    ...rows.filter((r) => r.fga).map((r) => `${r.label}: ${r.fga} FGA (${r.share}% of shots; D1 ${r.d1_share}%), ${r.fg_pct}% (D1 ${r.d1_fg_pct}%)${r.fga < 25 ? ', small sample' : ''}`),
    url]
  return { text: lines.join('\n'), structured: { who, season: s, fga: tot, areas: rows, bins, bin_feet: 2, bin_origin: { x: 0, y: -2 }, hoop: { x: 25, y: 0 }, url } }
}

async function rotationMap({ team, season }) {
  const t = await findTeam(team)
  const s = await pickContext(season, 'rotation')
  const [d, sd] = await Promise.all([ctxDoc(s, t[0]), seasonDoc(s)])
  const nm = new Map(sd.players.map((x) => [x[C.id], x[C.name]]))
  const rows = Object.entries(d.rotation || {}).map(([e, arr]) => {
    const mpg = arr.reduce((n, v) => n + v, 0)
    const windows = []
    let st = null
    arr.forEach((v, m) => { if (v >= 0.5 && st === null) st = m; if ((v < 0.5 || m === arr.length - 1) && st !== null) { windows.push([st, v >= 0.5 && m === arr.length - 1 ? m + 1 : m]); st = null } })
    return { id: e, name: nm.get(e) || e, minutes_per_game: Math.round(mpg * 10) / 10, usual_windows: windows.map(([a, b]) => `${a}-${b}`), by_minute: arr }
  }).sort((a, b) => b.minutes_per_game - a.minutes_per_game)
  // under 8 games a usual window is a guess: about two in five would not hold to the season's end (Nov 6 2026)
  const early = (d.games || 0) < 8
  const lines = [`${t[1]} rotation, ${s}: based on ${d.games} game${d.games === 1 ? '' : 's'} with clean lineups, regulation only. Usual windows are game minutes where he was on the floor in at least half of games${early ? ' (EARLY: under 8 games they are a guess; read who plays, not his script, and ask for last season\'s map to scout)' : ''}:`,
    ...rows.slice(0, 12).map((r) => `${r.name}: ${r.minutes_per_game} min a game; usually on ${r.usual_windows.join(', ') || 'no fixed window'}`), teamUrl(t[0], s)]
  return { text: lines.join('\n'), structured: { team: t[1], season: s, games: d.games, windows_settled: !early, players: rows } }
}

const TEAM_FIELDS = {
  rank: 'WCE rank by adjusted net among D1 teams', net: 'adjusted offense minus adjusted defense, points per 100 possessions', adjo: 'adjusted offensive efficiency, points scored per 100 possessions vs an average D1 defense', adjd: 'adjusted defensive efficiency, points allowed per 100 vs an average D1 offense (lower is better)',
  tempo: 'possessions per 40 minutes', luck: 'wins vs D1 minus the wins our game-by-game ratings expected (site included); positive = luckier, so expected wins = w minus luck', sos: 'strength of schedule: the average adjusted net of the D1 opponents played', market: 'the betting market\'s rating, from closing lines', bpi: 'ESPN BPI, for reference', netrank: 'the NCAA NET rank, for reference',
  efg: 'effective FG%: (FGM + 0.5 × 3PM) ÷ FGA', oefg: 'eFG% allowed (lower is better)', tov: 'turnovers per 100 plays (lower is better)', otov: 'opponent turnovers per 100 plays (forced)', orb: 'share of own misses rebounded', drb: 'share of opponent misses rebounded', ftr: 'FTA ÷ FGA', oftr: 'opponent FTA ÷ FGA (lower is better)',
  rim: 'share of own shots at the rim', mid: 'share of own shots that are twos away from the rim (paint and midrange)', three: 'share of own shots from three', orim: 'share of opponent shots at the rim', omid: 'share of opponent shots that are twos away from the rim', othree: 'share of opponent shots from three',
  w: 'wins vs D1', l: 'losses vs D1', cw: 'conference wins', cl: 'conference losses', gp: 'games vs D1', conf: 'conference id (conference gives the name)',
}

export async function dictionary() {
  const R = await reg()
  const stats = R.stats.map((s) => ({ key: s.key, label: s.label, group: s.group, context: s.kind === 'context', lower_is_better: s.lower, what: s.what, formula: s.formula, source: s.source, from: s.start, settles_at: s.k, sample_unit: s.sample_unit }))
  const team_fields = TEAM_FIELDS
  return { text: `College Basketball Savant ${R.version}: ${stats.length} player stats, ${Object.keys(team_fields).length} team fields. Tables: ${TABLES.join(', ')}.`, structured: { version: R.version, stats, team_fields, tables: TABLES, qualified: `${R.qual_min_share * 100}% of team minutes`, pools: POOLS } }
}

// ---- the tools ------------------------------------------------------------------------
const season = z.string().regex(SEASON_RE).optional().describe('Season, e.g. "2025-26". Default: the newest with full pools.')
const open = z.object({}).passthrough()
const who = z.string().trim().min(2).max(80).describe('Player name or ESPN id, e.g. "Cameron Boozer".')
const school = z.string().trim().min(2).max(60).describe('Team name or ESPN team id, e.g. "Duke".')
const opts = { pool: z.enum(POOLS).default('position').describe('Percentile pool.'), adjusted: z.boolean().default(true).describe('Opponent-adjusted where the stat has it.'), garbage_time: z.boolean().default(false).describe('Include garbage time.'), per: z.union([z.literal(70), z.literal(100)]).default(70).describe('Rates per 70 or per 100 possessions.') }
const tool = (name, title, description, inputSchema, outputSchema, run) => ({ name, config: { title, description, inputSchema, outputSchema, annotations: { title, ...READ_ONLY } }, run })

export const tools = [
  tool('cbb_search_players', 'Search men\'s college players', 'Find men\'s Division I players in College Basketball Savant (wcehoops.com) by name, 2009-10 on (2011-12 and 2012-13 are not on the site). Tolerates accents and small typos.', { query: z.string().trim().min(2).max(80).describe('Player name or part of one.'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return.') }, { query: z.string(), total: z.number().int(), count: z.number().int(), players: z.array(open) }, searchPlayers),
  tool('cbb_get_player_profile', 'Get a college player\'s Savant profile', 'One men\'s D1 player-season: percentile bars by group (impact, scoring, shooting, playmaking, rebounding, defense, context), each with its pool, sample and settle estimate, plus Savant value, honours, schedule strength, adjustment confidence, opponent-quality splits the nearest comparable player-seasons and coaches who used players like him. Seasons before 2022-23 are box-score seasons. Default pool: opponent-adjusted, D1 at the player\'s position, same season.', { player: who, season, ...opts, group: z.enum(['all', 'impact', 'scoring', 'shooting', 'playmaking', 'rebounding', 'defense', 'context']).default('all').describe('Which group of stats.') }, { player: open, season: z.string(), tier: z.string(), pool: open, per: z.number(), stats: z.array(open), savant_value: open.nullable(), honours: z.array(open), schedule_strength: open.nullable(), adjustment_confidence: open.nullable(), quality_splits: z.array(open), comps: z.array(open), coaches_like_him: open.nullable(), data_through: z.string(), source: z.string() }, profile),
  tool('cbb_player_career', 'Get a college player\'s career', 'Every season on file across schools, transfers marked, with percentiles per season and nearest comparable players.', { player: who }, { player: open, pool: z.string(), seasons: z.array(open) }, playerCareer),
  tool('cbb_player_splits', 'Get a college player\'s splits', 'Home, road and neutral; conference; opponent quality (vs our top 50, top 100 and NCAA tournament teams); Quad 1-4 where NET is on file; month; garbage time; postseason flagged; and the game log with opponent names and dates.', { player: who, season }, { player: open, season: z.string(), splits: open, context: open.nullable(), games: z.array(open), data_through: z.string() }, playerSplits),
  tool('cbb_leaderboard', 'College Basketball Savant leaders', 'Leaders in any stat (keys: savant_dictionary cbb stats), filtered by position, sample, conference, high/mid-major, class, team, transfers or returners.', { stat: z.string().min(1).max(20).default('bi').describe('Stat key.'), season, position: z.enum(['all', 'Guard', 'Wing', 'Big']).default('all').describe('Position bucket.'), min_possessions: z.number().int().min(0).max(3000).default(300).describe('Minimum possessions.'), min_sample: z.number().int().min(0).max(5000).optional().describe('Minimum of the stat\'s own sample (for 3-point %, attempts). Each row says its sample.'), offset: z.number().int().min(0).default(0).describe('Rows to skip.'), adjusted: opts.adjusted, garbage_time: opts.garbage_time, per: opts.per, limit: z.number().int().min(1).max(100).default(25).describe('Rows to return.'), conference: z.string().trim().min(2).max(40).optional().describe('Only this conference, e.g. "SEC".'), level: z.enum(['all', 'high_major', 'mid_major']).default('all').describe('high_major = ACC, Big East, Big Ten, Big 12, SEC (Pac-12 while it played).'), class: z.enum(['Fr', 'So', 'Jr', 'Sr', 'Gr']).optional().describe('Only this class.'), team: school.optional().describe('Only this team.'), transfers_only: z.boolean().default(false).describe('New school this season.'), returning_only: z.boolean().default(false).describe('Same school as last season.') }, { stat: z.string(), label: z.string(), season: z.string(), pool: z.string(), players: z.number().int(), offset: z.number().int().optional(), next_offset: z.number().int().optional(), rows: z.array(open), data_through: z.string(), early: z.string().optional() }, leaderboard),
  tool('cbb_team_profile', 'Get a D1 team\'s profile', 'A team-season: ratings, the market\'s view, BPI and NET as reference, four factors, shot diet, luck, schedule, head coach, roster and results.', { team: school, season }, { team: open, season: z.string(), head_coach: z.array(open).nullable(), roster: z.array(open), results: z.array(open), url: z.string() }, teamProfile),
  tool('cbb_team_rankings', 'Rank D1 teams', 'Rank D1 teams by any rating, four factor (own or allowed) or shot share, best first, with each row\'s D1 rank. Filter by conference or high/mid-major.', { season, sort: z.enum(Object.keys(TEAM_SORTS)).default('net').describe('Column; o-prefixed ones are opponents\' (savant_dictionary cbb stats, team_fields).'), ascending: z.boolean().default(false).describe('Reverse the order (worst first).'), conference: z.string().trim().min(2).max(40).optional().describe('Only this conference, e.g. "SEC".'), level: z.enum(['all', 'high_major', 'mid_major']).default('all').describe('As in cbb_leaderboard.'), limit: z.number().int().min(1).max(370).default(25).describe('Teams to return.') }, { season: z.string(), sort: z.string(), conference: z.string().nullable(), level: z.string(), teams: z.array(open) }, teamRankings),
  tool('cbb_lineups', 'Get a D1 team\'s lineups', '2- to 5-man units, luck- and sample-adjusted, and With/Without for any players (units matching it, plus the rest of the time). From 2024-25.', { team: school, season, size: z.number().int().min(2).max(5).default(5).describe('Players in the unit.'), with: z.array(z.string()).max(4).optional().describe('Players on the floor.'), without: z.array(z.string()).max(4).optional().describe('Players off the floor.') }, { team: z.string(), season: z.string(), tracked: z.boolean(), size: z.number().optional(), units: z.array(open), with_without: open.nullable() }, lineups),
  tool('cbb_all_savant_team', 'College All-Savant Teams', 'The All-Savant Teams by Savant value, 2009-10 on (not 2011-12 or 2012-13): national 1st, 2nd and 3rd teams of 2 guards, 2 wings and a big, a team per conference, the All-Freshman team and the Savant Player of the Year. Before the national championship it is a standing, not an honour.', { season, team: z.enum(ALL_SAVANT).default('first').describe('Which team.'), conference: z.string().trim().min(2).max(40).optional().describe('Conference name, for team "conference".') }, { season: z.string(), team: z.string(), label: z.string(), final: z.boolean(), so_far: z.boolean(), players: z.array(open), replacement: open.nullable(), default_season: z.string() }, allSavant),
  tool('cbb_game', 'Get a college game', 'One men\'s college game by ESPN event id: the score, site, overtime, closing line and data-quality flags.', { game_id: z.string().regex(/^\d+$/).describe('ESPN event id.'), season }, { game: open, season: z.string() }, game),
  tool('cbb_schedule', 'Get a D1 team\'s schedule', 'A team\'s season schedule, played and still to play, with site and our opponent rating. Live from ESPN.', { team: school, season, upcoming_only: z.boolean().default(false).describe('Only games still to play.') }, { team: z.string(), team_id: z.string(), season: z.string(), games: z.array(open), source: z.string() }, schedule),
  tool('cbb_play_context', 'A D1 team\'s play context', 'Possession starts with points per possession (own and allowed), transition, after own timeouts, clutch and the shot clock (estimated), each ranked in D1. 2025-26 on.', { team: school, season }, { team: z.string(), season: z.string(), through: z.string().nullable(), possessions: open, d1_ppp: z.number().nullable(), starts: z.array(open), transition: open, after_timeout: open, clutch: open, shot_clock: z.array(open), ranks: open, url: z.string() }, playContext),
  tool('cbb_shot_chart', 'A college shot chart', 'Where a player or team shoots (or allows shots) and how well, by court area against D1, plus the 2-ft bins. 2025-26 on.', { player: who.optional(), team: school.optional(), season, side: z.enum(['own', 'allowed']).default('own').describe('For a team: its shots or opponents\'.') }, { who: z.string(), season: z.string(), fga: z.number(), areas: z.array(open), bins: z.array(z.array(z.number())), bin_feet: z.number(), bin_origin: open, hoop: open, url: z.string() }, shotChart),
  tool('cbb_rotation', 'A D1 team\'s rotation map', 'Who is on the floor in each minute of regulation, as a share of games, with each player\'s usual windows. 2023-24 on.', { team: school, season }, { team: z.string(), season: z.string(), games: z.number().nullable(), windows_settled: z.boolean().optional(), players: z.array(open) }, rotationMap),
]
