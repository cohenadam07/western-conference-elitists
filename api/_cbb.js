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
const TABLES = ['games', 'player_games', 'units']
const SPLIT_COLS = ['games', 'minutes', 'possessions', 'pts_per_poss', 'ts', 'efg', 'fg3', 'ast_per_poss', 'reb_per_poss', 'tov_pct', 'usg', 'stl_pct', 'blk_pct']
const MAX_ROWS = 500

const reg = () => files.load('registry.json')
const index = () => files.load('index.json')
const search = () => files.load('search.json')
const seasonDoc = (s) => files.load(`s/${s}.json`)
const teamsDoc = (s) => files.load(`teams/${s}.json`)
const teamDoc = (s, t) => files.load(`t/${s}/${t}.json`)
const career = (id) => files.load(`p/${String(id).slice(-2)}.json`)
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
  const hits = topTier(rank(prepare(d.teams.map((t) => ({ t, name: t[1] }))), q))
  if (!hits.length) throw new SavantError(`No D1 team found for "${q}".`)
  return hits[0].t
}
const tname = async (id) => { const d = await search(); return (d.teams.find((t) => t[0] === id) || [])[1] || 'Non-D1' }

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
  const lines = [`${pl[C.name]}, ${team}, ${s}. ${pl[C.pos] || 'position unknown'}, ${pl[C.cls] || ''}, age ${miss(pl[C.age]) ? 'unknown' : pl[C.age].toFixed(1)} on Feb 1.`, `Percentiles ${label} (${pp.ids.length} players).${pp.widened ? ` ${pp.widened}.` : ''} Rates per ${per} possessions.`]
  for (const r of rows) lines.push(r.tracked ? `${r.label}${r.context ? ' (context)' : ''}: ${r.shown ?? '—'}${r.percentile == null ? (r.note ? ` (${r.note})` : '') : `, ${ordinal(r.percentile)} percentile`}${r.likely_to_settle_at ? `, likely to settle at ${r.likely_to_settle_at}` : ''}` : `${r.label}: ${r.note}`)
  if (rows.some((r) => r.early)) lines.push(`RAPM: ${R.rapm_early}`)
  if (val) lines.push(`Savant value: ${val.value.toFixed(1)} points over a replacement ${String(pl[C.pos]).toLowerCase()}${val.on_floor_part ? '' : ' (box score only: lineups start in 2024-25)'}.`)
  if (sched) lines.push(`${sched.text}.`)
  if (conf_) lines.push(`Adjustment confidence: ${conf_.text}.`)
  if (hon.length) lines.push(`Honours: ${hon.map((h) => `${h.label} ${h.season}`).join(', ')}.`)
  if (d.tier === 'box') lines.push(`${s} is a box-score season: shot zones, lineups, on/off and RAPM are not tracked.`)
  lines.push(`Data through ${day(d.through)}. ${playerUrl(pl[C.id], s)}`)
  return { text: lines.join('\n'), structured: { player: { id: pl[C.id], name: pl[C.name], team, team_id: pl[C.team], position: pl[C.pos], class: pl[C.cls], age_feb_1: pl[C.age], height_in: pl[C.ht], weight_lb: pl[C.wt], hometown: pl[C.home], recruit: pl[C.rrank] ? { stars: pl[C.stars], rank: pl[C.rrank], high_school: pl[C.hs] } : null, games: pl[C.gp], minutes: pl[C.min], qualified: !!pl[C.qual], url: playerUrl(pl[C.id], s) }, season: s, tier: d.tier || 'full', pool: { name: label, players: pp.ids.length, widened: pp.widened }, per, stats: rows, savant_value: val, honours: hon, schedule_strength: sched, adjustment_confidence: conf_, quality_splits: quality, data_through: day(d.through), source: SOURCE } }
}

async function playerCareer({ player }) {
  const p = await findPlayer(player)
  const c = (await career(p[0]))[p[0]]
  const R = await reg()
  const by = Object.fromEntries(R.stats.map((s) => [s.key, s]))
  const seasons = []
  for (const r of c.r) {
    seasons.push({ season: r.s, team: await tname(r.t), team_id: r.t, position: r.p, class: r.c, games: r.g, minutes: r.m, transferred: seasons.length > 0 && seasons[seasons.length - 1].team_id !== r.t, stats: Object.fromEntries(Object.entries(r.v).map(([k, v]) => [k, { value: v[0], shown: M.display(by[k], v[0], 70), percentile: v[1] }])), comps: (r.cmp || []).map((x) => ({ id: x[0], name: x[1], season: x[2], match: x[4] })) })
  }
  const lines = [`${c.b[0]}: ${seasons.map((s) => `${s.season} ${s.team}${s.transferred ? ' (transfer)' : ''}`).join('; ')}. Percentiles vs D1 at position, per season, adjusted where the stat has it.`]
  for (const s of seasons) lines.push(`${s.season}: ${s.games} games, ${Object.entries(s.stats).filter(([, v]) => v.percentile != null).slice(0, 6).map(([k, v]) => `${by[k].label} ${v.shown} (${ordinal(v.percentile)})`).join(', ')}`)
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
  const games = (T.log[String(ix)] || []).map((g) => ({ gid: g[0], date: g[1], opponent_id: g[2], home: !!g[3], neutral: !!g[4], team_pts: g[5], opp_pts: g[6], min: g[7], pts: g[8], fgm: g[9], fga: g[10], fg3m: g[11], fg3a: g[12], ftm: g[13], fta: g[14], reb: g[15], ast: g[16], tov: g[17], stl: g[18], blk: g[19], pf: g[20], non_d1: !!g[22], postseason: !!g[23] }))
  const lines = [`${row[C.name]}, ${s} splits (D1 opponents; no percentiles on splits; NET quads ${sp.quad ? 'by venue' : 'not tracked this season'}).`]
  for (const [k, rows] of Object.entries(splits)) lines.push(`${k}: ${rows.map((r) => `${r.split} ${r.games}g, ${(r.pts_per_poss * 70).toFixed(1)} pts/70, ${r.ts}% TS`).join('; ')}`)
  lines.push(playerUrl(p[0], s))
  return { text: lines.join('\n'), structured: { player: { id: row[C.id], name: row[C.name], url: playerUrl(row[C.id], s) }, season: s, splits, games, data_through: day(d.through) } }
}

async function leaderboard({ stat, season, position, min_possessions, adjusted, garbage_time, per, limit }) {
  const R = await reg()
  const st = R.stats.find((x) => x.key === stat)
  if (!st) throw new SavantError(`Unknown stat "${stat}". cbb_data_dictionary lists them.`)
  const { s } = await pickSeason(season)
  const d = await seasonDoc(s)
  const c = M.column(d, st.key, { adj: adjusted, gt: garbage_time })
  if (!c) throw new SavantError(`${st.label} is not tracked in ${s}.`)
  const ids = []
  for (let i = 0; i < d.players.length; i++) {
    if (miss(c[i]) || (d.samples.poss[i] || 0) < min_possessions) continue
    if (position !== 'all' && d.players[i][C.pos] !== position) continue
    if (st.key.startsWith('rapm') && (d.samples.rapm_n[i] || 0) < R.rapm_min) continue
    ids.push(i)
  }
  ids.sort((a, b) => (st.lower ? c[a] - c[b] : c[b] - c[a]))
  const rows = []
  for (const [k, i] of ids.slice(0, limit).entries()) {
    const p = d.players[i]
    const r = M.row(d, R, st, i, { poolName: position === 'all' ? 'all' : 'pos', adj: adjusted, gt: garbage_time, per })
    rows.push({ rank: k + 1, id: p[C.id], name: p[C.name], team: await tname(p[C.team]), position: p[C.pos], value: +c[i], shown: M.display(st, c[i], per), percentile: r.pct ?? null, url: playerUrl(p[C.id], s) })
  }
  const pool = `vs D1 ${position === 'all' ? 'players' : `${position.toLowerCase()}s`}, ${adjusted && M.hasAdj(d, st.key) ? 'opponent-adjusted' : 'raw'}, ${s}`
  const early = st.key.startsWith('rapm') ? R.rapm_early : null
  return { text: [`${st.label} leaders, ${pool}, min ${min_possessions} possessions:`, ...rows.map((r) => `${r.rank}. ${r.name}, ${r.team}: ${r.shown}`), ...(early ? [`RAPM: ${early}`] : []), `Data through ${day(d.through)}. ${PAGE}#leaders`].join('\n'), structured: { stat: st.key, label: st.label, season: s, pool, players: ids.length, rows, data_through: day(d.through), ...(early ? { early } : {}) } }
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

async function teamRankings({ season, limit, sort }) {
  const { s } = await pickSeason(season)
  const t = await teamsDoc(s)
  const rows = t.teams.slice().sort((a, b) => (sort === 'adjd' ? a.adjd - b.adjd : (b[sort] ?? -999) - (a[sort] ?? -999))).slice(0, limit)
  return { text: [`D1 teams, ${s}, by ${sort}:`, ...rows.map((r, i) => `${i + 1}. ${r.name} ${r.w}-${r.l}: net ${r.net}, off ${r.adjo}, def ${r.adjd}, market ${r.market ?? '—'}, BPI ${r.bpi ?? '—'}, NET ${r.netrank ?? 'not tracked'}`), `${PAGE}#teams`].join('\n'), structured: { season: s, sort, teams: rows.map((r) => ({ ...r, conference: CONFS[r.conf] || null })) } }
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
  const last = results.slice(-5).map((g) => `${g.pts > g.opp_pts ? 'W' : 'L'} ${g.pts}-${g.opp_pts} ${g.neutral ? 'vs' : g.home ? 'vs' : 'at'} ${g.opponent}`)
  return { text: [`${r.full || r.name} (${CONFS[r.conf] || r.conf}), ${s}: ${r.w}-${r.l} vs D1, ranked ${ordinal(r.rank)}. Net ${r.net}, offense ${r.adjo}, defense ${r.adjd}, pace ${r.tempo}. The market: ${r.market ?? 'no line'}. BPI ${r.bpi ?? '—'}. NET ${r.netrank ?? 'not tracked'}. Luck ${r.luck}. SOS ${r.sos}.`, `Offense ranks ${ordinal(offRank)} and defense ${ordinal(defRank)} of ${tb.teams.length} D1 teams.`, `Four factors, own / opponents: eFG ${r.efg}% / ${r.oefg}%, turnover rate ${r.tov}% / ${r.otov}%, free-throw rate ${r.ftr} / ${r.oftr}. Offensive rebounding ${r.orb}%, defensive rebounding ${r.drb}%.`, `Shot diet, share of shots taken / allowed: rim ${r.rim}% / ${r.orim}%, midrange ${r.mid}% / ${r.omid}%, three ${r.three}% / ${r.othree}%.`, `Roster by minutes: ${roster.slice(0, 8).map((x) => x.name).join(', ')}.`, ...(last.length ? [`Latest results: ${last.join('; ')}.`] : []), teamUrl(t[0], s)].join('\n'), structured: { team: { ...r, conference: CONFS[r.conf] || null, off_rank: offRank, def_rank: defRank }, season: s, roster, results, url: teamUrl(t[0], s) } }
}

async function lineups({ team, season, size, with: withNames, without }) {
  const t = await findTeam(team)
  const { s, row } = await pickSeason(season)
  if (!row.court) return { text: `Lineups are not tracked in ${s}: they start in 2024-25.`, structured: { team: t[1], season: s, tracked: false, units: [], with_without: null } }
  const T = await teamDoc(s, t[0])
  const name = (i) => (T.roster[i] || [])[1] || '?'
  const units = (T.units[String(size)] || []).slice(0, 20).map((u) => ({ players: u.ids.map(name), possessions: u.poss, minutes: u.min, ortg: u.ortg, drtg: u.drtg, net: u.net, luck_adjusted: u.adj, shrunk: u.est }))
  const pick = (names) => (names || []).map((n) => { const i = T.roster.findIndex((r) => r[1].toLowerCase().includes(String(n).toLowerCase())); if (i < 0) throw new SavantError(`${n} is not on ${t[1]}'s ${s} roster.`); return i })
  const w = M.withWithout(T.fives, pick(withNames), pick(without))
  const lines = [`${t[1]} ${s}, ${size}-man units (min ${size === 5 ? 30 : 60} possessions, garbage time out; net per 100; shrunk pulls small samples toward the team):`, ...units.slice(0, 8).map((u) => `${u.players.join(', ')}: ${u.possessions} poss, net ${u.net}, shrunk ${u.shrunk}`)]
  if ((withNames || []).length || (without || []).length) lines.push(`With ${(withNames || []).join(', ') || 'anyone'}, without ${(without || []).join(', ') || 'nobody'}: ${w.poss} possessions, net ${w.net === null ? '—' : w.net.toFixed(1)}.`)
  lines.push(teamUrl(t[0], s))
  return { text: lines.join('\n'), structured: { team: t[1], season: s, tracked: true, size, units, with_without: { with: withNames || [], without: without || [], minutes: w.min, possessions: w.poss, ortg: w.ortg, drtg: w.drtg, net: w.net } } }
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
async function data({ table, season, team, filters, columns, offset, limit }) {
  const { s } = await pickSeason(season)
  let cols, rows
  if (table === 'games') { const d = await files.load(`games/${s}.json`); cols = d.cols; rows = d.rows } else {
    if (!team) throw new SavantError(`${table} needs a team: the rows are kept per team-season.`)
    const t = await findTeam(team)
    const T = await teamDoc(s, t[0])
    if (table === 'units') { cols = ['players', 'seconds', 'poss', 'opp_poss', 'pts', 'opp_pts', 'opp_fg3a', 'opp_fg3m', 'opp_fta', 'opp_ftm']; rows = T.fives.map((f) => [f[0].map((i) => T.roster[i][1]).join(', '), ...f.slice(1)]) } else {
      cols = ['player_id', 'player', 'gid', 'date', 'opponent_id', 'home', 'neutral', 'team_pts', 'opp_pts', 'min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'tov', 'stl', 'blk', 'pf', 'starter', 'non_d1', 'postseason']
      rows = []
      for (const [k, list] of Object.entries(T.log)) for (const g of list) rows.push([T.roster[k][0], T.roster[k][1], ...g])
    }
  }
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]))
  for (const f of filters || []) { if (!(f.column in ix)) throw new SavantError(`No column ${f.column} in ${table}.`); rows = rows.filter((r) => OPS[f.op](r[ix[f.column]], f.value)) }
  const total = rows.length
  const want = columns && columns.length ? columns : cols
  const page = rows.slice(offset, offset + limit).map((r) => Object.fromEntries(want.map((c) => [c, r[ix[c]]])))
  return { text: `${table}, ${s}: ${total} rows; ${page.length} returned from ${offset}. All numbers are WCE-derived.`, structured: { table, season: s, total, offset, count: page.length, columns: want, rows: page } }
}

async function dictionary() {
  const R = await reg()
  const stats = R.stats.map((s) => ({ key: s.key, label: s.label, group: s.group, context: s.kind === 'context', lower_is_better: s.lower, what: s.what, formula: s.formula, source: s.source, from: s.start, settles_at: s.k, sample_unit: s.sample_unit }))
  return { text: `College Basketball Savant ${R.version}: ${stats.length} stats. Tables: ${TABLES.join(', ')}.`, structured: { version: R.version, stats, tables: TABLES, qualified: `${R.qual_min_share * 100}% of team minutes`, pools: POOLS } }
}

// ---- the tools ------------------------------------------------------------------------
const season = z.string().regex(SEASON_RE).optional().describe('Season, e.g. "2025-26". Default: the newest with full pools.')
const open = z.object({}).passthrough()
const who = z.string().trim().min(2).max(80).describe('Player name or ESPN id, e.g. "Cameron Boozer".')
const school = z.string().trim().min(2).max(60).describe('Team name or ESPN team id, e.g. "Duke".')
const opts = { pool: z.enum(POOLS).default('position').describe('Percentile pool.'), adjusted: z.boolean().default(true).describe('Opponent-adjusted where the stat has it.'), garbage_time: z.boolean().default(false).describe('Include garbage time.'), per: z.union([z.literal(70), z.literal(100)]).default(70).describe('Rates per 70 or per 100 possessions.') }
const tool = (name, title, description, inputSchema, outputSchema, run) => ({ name, config: { title, description, inputSchema, outputSchema, annotations: { title, ...READ_ONLY } }, run })
const filterShape = z.object({ column: z.string(), op: z.enum(['eq', 'gte', 'lte', 'gt', 'lt', 'contains']), value: z.any() })

export const tools = [
  tool('cbb_search_players', 'Search men\'s college players', 'Find men\'s Division I players in College Basketball Savant (wcehoops.com) by name, 2009-10 on (2011-12 and 2012-13 are not on the site). Tolerates accents and small typos.', { query: z.string().trim().min(2).max(80).describe('Player name or part of one.'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return.') }, { query: z.string(), total: z.number().int(), count: z.number().int(), players: z.array(open) }, searchPlayers),
  tool('cbb_get_player_profile', 'Get a college player\'s Savant profile', 'One men\'s D1 player-season: percentile bars by group (impact, scoring, shooting, playmaking, rebounding, defense, context), each with its pool, sample and settle estimate, plus Savant value, honours, schedule strength, adjustment confidence and opponent-quality splits. Seasons before 2022-23 are box-score seasons. Default pool: opponent-adjusted, D1 at the player\'s position, same season.', { player: who, season, ...opts, group: z.enum(['all', 'impact', 'scoring', 'shooting', 'playmaking', 'rebounding', 'defense', 'context']).default('all').describe('Which group of stats.') }, { player: open, season: z.string(), tier: z.string(), pool: open, per: z.number(), stats: z.array(open), savant_value: open.nullable(), honours: z.array(open), schedule_strength: open.nullable(), adjustment_confidence: open.nullable(), quality_splits: z.array(open), data_through: z.string(), source: z.string() }, profile),
  tool('cbb_player_career', 'Get a college player\'s career', 'Every season on file across schools, transfers marked, with percentiles per season and nearest comparable players.', { player: who }, { player: open, pool: z.string(), seasons: z.array(open) }, playerCareer),
  tool('cbb_player_splits', 'Get a college player\'s splits', 'Home, road and neutral; conference; opponent quality (vs our top 50, top 100 and NCAA tournament teams); Quad 1-4 where NET is on file; month; garbage time; postseason flagged; and the game log.', { player: who, season }, { player: open, season: z.string(), splits: open, games: z.array(open), data_through: z.string() }, playerSplits),
  tool('cbb_leaderboard', 'College Basketball Savant leaders', 'Leaders in any stat, season, position and minimum sample. Stat keys come from cbb_data_dictionary.', { stat: z.string().min(1).max(20).default('bi').describe('Stat key.'), season, position: z.enum(['all', 'Guard', 'Wing', 'Big']).default('all').describe('Position bucket.'), min_possessions: z.number().int().min(0).max(3000).default(300).describe('Minimum possessions.'), adjusted: opts.adjusted, garbage_time: opts.garbage_time, per: opts.per, limit: z.number().int().min(1).max(100).default(25).describe('Rows to return.') }, { stat: z.string(), label: z.string(), season: z.string(), pool: z.string(), players: z.number().int(), rows: z.array(open), data_through: z.string(), early: z.string().optional() }, leaderboard),
  tool('cbb_team_profile', 'Get a D1 team\'s profile', 'A team-season: ratings, the market\'s view, BPI and NET as reference, four factors, shot diet, luck, schedule, roster and results.', { team: school, season }, { team: open, season: z.string(), roster: z.array(open), results: z.array(open), url: z.string() }, teamProfile),
  tool('cbb_team_rankings', 'Rank D1 teams', 'All D1 teams by our adjusted net, offense, defense, the market, BPI, luck or strength of schedule.', { season, sort: z.enum(['net', 'adjo', 'adjd', 'market', 'bpi', 'luck', 'sos', 'tempo']).default('net').describe('Column to rank by.'), limit: z.number().int().min(1).max(370).default(25).describe('Teams to return.') }, { season: z.string(), sort: z.string(), teams: z.array(open) }, teamRankings),
  tool('cbb_lineups', 'Get a D1 team\'s lineups', '2- to 5-man units, sample- and luck-adjusted, and With/Without for any players. From 2024-25.', { team: school, season, size: z.number().int().min(2).max(5).default(5).describe('Players in the unit.'), with: z.array(z.string()).max(4).optional().describe('Players on the floor.'), without: z.array(z.string()).max(4).optional().describe('Players off the floor.') }, { team: z.string(), season: z.string(), tracked: z.boolean(), size: z.number().optional(), units: z.array(open), with_without: open.nullable() }, lineups),
  tool('cbb_all_savant_team', 'College All-Savant Teams', 'The All-Savant Teams by Savant value, 2009-10 on (not 2011-12 or 2012-13): national 1st, 2nd and 3rd teams of 2 guards, 2 wings and a big, a team per conference, the All-Freshman team and the Savant Player of the Year. Before the national championship it is a standing, not an honour.', { season, team: z.enum(ALL_SAVANT).default('first').describe('Which team.'), conference: z.string().trim().min(2).max(40).optional().describe('Conference name, for team "conference".') }, { season: z.string(), team: z.string(), label: z.string(), final: z.boolean(), so_far: z.boolean(), players: z.array(open), replacement: open.nullable(), default_season: z.string() }, allSavant),
  tool('cbb_game', 'Get a college game', 'One men\'s college game by ESPN event id: the score, site, overtime, closing line and data-quality flags.', { game_id: z.string().regex(/^\d+$/).describe('ESPN event id.'), season }, { game: open, season: z.string() }, game),
  tool('cbb_data', 'College Basketball Savant Data Room', 'Rows for your own analysis: games, player_games and units. WCE-derived numbers only. player_games and units need a team.', { table: z.enum(TABLES).describe('Which table.'), season, team: school.optional(), filters: z.array(filterShape).max(6).optional().describe('Row filters.'), columns: z.array(z.string()).max(40).optional().describe('Columns wanted; default all.'), offset: z.number().int().min(0).default(0).describe('Rows to skip.'), limit: z.number().int().min(1).max(MAX_ROWS).default(100).describe('Rows to return.') }, { table: z.string(), season: z.string(), total: z.number().int(), offset: z.number().int(), count: z.number().int(), columns: z.array(z.string()), rows: z.array(open) }, data),
  tool('cbb_data_dictionary', 'College Basketball Savant dictionary', 'Every stat defined: what it is, the formula, the source, the sample, the season it starts.', {}, { version: z.string(), stats: z.array(open), tables: z.array(z.string()), qualified: z.string(), pools: z.array(z.string()) }, dictionary),
]
