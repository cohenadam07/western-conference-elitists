// api/_cfb.js — College Football Savant, as answers. One section of the AI connector (api/mcp.js).
//
// It reads the page's own files under /cfb/ (pipeline/cfb/site.py) and does its arithmetic with
// public/savant-cfb.js, the same copy the page runs, so an answer is the number on the card.
//
// What an answer always says: which pool a percentile is from; when a sample is low or a stat is
// noisy in any one season; "not tracked" (with the season it starts) rather than a zero; the
// data date; a link to the page; and, for any defender or defensive pick before 2024, that
// those seasons depend on each school's stat crew. Never served, because none of it is in these
// files: a CollegeFootballData row, an AP pick, ESPN's FPI, CFBD's PPA, a committee ranking.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, ordinal, prepare, rank, topTier } from './_core.js'
import '../public/savant-cfb.js'

const M = globalThis.SavantCFB
const C = M.COL, T = M.TCOL, SC = M.SCOL
const files = makeLoader('cfb', { what: 'College Football Savant', maxCached: 60, shape: (b) => b && typeof b === 'object' && (b.stats || b.seasons || b.players || b.teams || b.roster || b.rows || b.field || b.national || Object.keys(b).length) })
const PAGE = `${SITE}/college-football-savant.html`
export const POOLS = ['position', 'power_4', 'conference']
const POOLKEY = { position: 'pos', power_4: 'p4', conference: 'conf' }
export const SETS = ['first', 'second', 'third', 'conference', 'freshman']

const reg = () => files.load('registry.json')
const index = () => files.load('index.json')
const search = () => files.load('search.json')
const seasonDoc = (s) => files.load(`s/${s}.json`)
const teamsDoc = (s) => files.load(`teams/${s}.json`)
const teamDoc = (s, t) => files.load(`t/${s}/${t}.json`)
const shard = (id) => files.load(`p/${String(Math.abs(id) % 100).padStart(2, '0')}.json`).then((d) => d[String(id)] || null).catch(() => null)
export const playerUrl = (id, s, cur) => `${PAGE}#player-${id}${s && s !== cur ? `/${s}` : ''}`
export const teamUrl = (id, s, cur) => `${PAGE}#team-${id}${s && s !== cur ? `/${s}` : ''}`
const sg = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d))
const pc = (v) => M.chance(v)

async function pickSeason(season) {
  const idx = await index()
  const s = season || idx.current
  const row = idx.seasons.find((x) => x.season === s)
  if (!row) throw new SavantError(`College Football Savant has ${idx.first_season} to ${idx.current} except ${Object.keys(idx.not_on_site || {}).filter((y) => +y >= idx.first_season).join(', ') || 'none'}. ${s} is not on file${(idx.not_on_site || {})[s] ? `: ${idx.not_on_site[s]}` : ''}.`)
  return { s, idx, row }
}
// The warning a defender (or a list of defenders) carries in a season, or null.
const defWarning = (R, s) => (s < 2024 ? R.pre_box_warning + (R.no_tacklers.includes(s) ? ` ${R.early_def_note}` : '') : null)
const asOf = (d) => (d.final ? `${d.season} season, final` : `through ${day(d.through)} (week ${d.week})`)

// Everyone the site has a card for: careers through last season, plus this season's players.
async function everyone() {
  const [d, idx] = await Promise.all([search(), index()])
  const cur = await seasonDoc(idx.current)
  const by = new Map(d.players.map((p) => [p[0], { id: p[0], name: p[1], slot: p[2], team: p[3], first: p[4], last: p[5] }]))
  for (const p of cur.players) {
    const o = by.get(p[C.id])
    if (o) { o.last = idx.current; o.team = p[C.team]; o.slot = p[C.slot] } else by.set(p[C.id], { id: p[C.id], name: p[C.name], slot: p[C.slot], team: p[C.team], first: idx.current, last: idx.current })
  }
  return { list: [...by.values()], teams: d.teams, idx }
}
const tname = (S, id) => { const t = S.teams.find((x) => x[0] === id); return t ? t[1] : 'a non-FBS team' }
const dname = (d, id) => (d.teams[String(id)] || [])[0] || null

async function findPlayer(q, season) {
  const S = await everyone()
  const n = /^-?\d+$/.test(String(q).trim()) ? +q : null
  const direct = n !== null && S.list.find((p) => p.id === n)
  if (direct) return { p: direct, S }
  let hits = topTier(rank(prepare(S.list.map((p) => ({ p, name: p.name }))), q, (a, b) => b.p.last - a.p.last || a.p.id - b.p.id))
  if (!hits.length) throw new SavantError(`No FBS player found for "${q}" since ${S.idx.first_season}. Try cfb_search_players.`)
  if (season) { const inS = hits.filter((h) => h.p.first <= season && h.p.last >= season); if (inS.length) hits = inS }
  return { p: hits[0].p, S, others: hits.slice(1, 4).map((h) => h.p) }
}
async function findTeam(q, season) {
  const d = await search()
  const n = /^\d+$/.test(String(q).trim()) ? +q : null
  let t = n !== null && d.teams.find((x) => x[0] === n)
  if (!t) {
    const rows = prepare(d.teams.flatMap((x) => [{ t: x, name: x[1] }, { t: x, name: `${x[1]} ${x[5] || ''}`.trim() }, { t: x, name: x[2] }]))
    const hits = topTier(rank(rows, q, (a, b) => b.t[4] - a.t[4] || a.name.length - b.name.length))
    if (!hits.length) throw new SavantError(`No FBS team found for "${q}".`)
    t = hits[0].t
  }
  return t
}

// ---- answers --------------------------------------------------------------------------
function statLine(s, r) {
  const b = { key: s.key, label: s.label, group: s.cgroup || s.group, context: s.verdict === 'context', lower_is_better: s.lower, tracked: r.tracked, ...(s.tier === 'B' ? { charted: true } : {}) }
  if (!r.tracked) return { ...b, value: null, percentile: null, note: r.reason }
  if (r.none) return { ...b, value: null, percentile: null, note: r.reason }
  return { ...b, value: r.value, shown: r.shown, percentile: r.pct, before_adjustment: r.raw, sample: r.n, sample_unit: s.unit_n, low_sample: r.settling, noisy_in_one_season: s.verdict === 'hatched', likely_to_settle_at: r.likelyShown }
}
const lineText = (r) => (r.tracked && r.percentile != null ? `${r.label}${r.context ? ' (context)' : ''}: ${r.shown}, ${ordinal(r.percentile)} percentile${r.lower_is_better ? ' (lower is better, flipped)' : ''}${r.likely_to_settle_at ? `, low sample, likely to settle at ${r.likely_to_settle_at}` : r.noisy_in_one_season ? ', noisy in one season' : ''}` : `${r.label}: ${r.note}`)

function bioOf(P, S) {
  const b = (P && P.bio) || {}
  const schools = (b.schools || []).map((x) => ({ season: x[0], team: tname(S, x[1]), team_id: x[1], transferred_in: !!x[2], ...(x[3] ? { came_from: x[3] } : {}) }))
  return {
    hometown: b.city ? `${b.city}${b.state ? `, ${b.state}` : ''}` : null,
    recruit: b.recruit ? { stars: b.recruit[0], class_rank: b.recruit[1], class_year: b.recruit[2], source: 'stars and national class rank from CollegeFootballData\'s composite' } : null,
    schools, transfers: schools.filter((x) => x.transferred_in).map((x) => `to ${x.team} in ${x.season}`),
    nfl: b.nfl ? { football_savant_id: b.nfl[0], url: `${SITE}/football-savant.html#p=${encodeURIComponent(b.nfl[0])}${b.nfl[1] ? `&s=${b.nfl[1]}` : ''}` } : null,
  }
}
function standingOf(A, id) {
  const out = [], tag = A.final ? `${A.season}` : `${A.season} standing, ${A.standing}`
  if (A.heisman[0] && A.heisman[0].pid === id) out.push(`Savant Heisman (${tag})`)
  if (A.non_qb[0] && A.non_qb[0].pid === id) out.push(`Non-QB Player of the Year (${tag})`)
  for (const t of ['1', '2', '3']) if (A.national[t].some((r) => r.pid === id)) out.push(`${['', '1st', '2nd', '3rd'][+t]}-team All-Savant (${tag})`)
  for (const c of Object.keys(A.conference)) if (A.conference[c].some((r) => r.pid === id)) out.push(`All-${c} Savant (${tag})`)
  if (A.freshman.some((r) => r.pid === id)) out.push(`Freshman All-Savant (${tag})`)
  return out
}

async function searchPlayers({ query, limit }) {
  const S = await everyone()
  const hits = rank(prepare(S.list.map((p) => ({ p, name: p.name }))), query, (a, b) => b.p.last - a.p.last || a.p.id - b.p.id)
  const out = hits.slice(0, limit).map((h) => { const p = h.row.p; return { id: p.id, name: p.name, position: p.slot, team: tname(S, p.team), team_id: p.team, first_season: p.first, last_season: p.last, url: playerUrl(p.id) } })
  return { text: out.length ? out.map((p) => `${p.name}, ${p.position}, ${p.team}, ${p.first_season === p.last_season ? p.first_season : `${p.first_season} to ${p.last_season}`} (id ${p.id})`).join('\n') : `No match for "${query}".`, structured: { query, total: hits.length, count: out.length, players: out } }
}

async function profile({ player, season, pool, adjusted, garbage_time, group }) {
  const { p, S, others } = await findPlayer(player, season)
  const { s, idx } = await pickSeason(season || p.last)
  const [R, d] = await Promise.all([reg(), seasonDoc(s)])
  const i = d.players.findIndex((x) => x[C.id] === p.id)
  if (i < 0) throw new SavantError(`${p.name} has no graded plays in ${s} (he is on file ${p.first} to ${p.last}). Try cfb_player_career.`)
  const pl = d.players[i], slot = pl[C.slot], team = pl[C.team]
  const o = { poolName: POOLKEY[pool], adj: adjusted, gt: garbage_time }
  const g0 = group.toLowerCase(), inG = (x) => g0 === 'all' || (x.cgroup || x.group).toLowerCase().includes(g0) || x.group.toLowerCase() === g0
  const stats = M.cardGroups(R, slot).flatMap((G) => G.stats).filter(inG)
  const rows = stats.map((x) => statLine(x, M.row(d, R, x, i, o)))
  const nret = M.sample(d, 'returns', i, false)
  const retRows = nret ? M.cardGroups(R, 'RET').flatMap((G) => G.stats).filter((x) => g0 === 'all' || g0.startsWith('ret')).map((x) => statLine(x, M.row(d, R, x, i, o))) : []
  const prof = M.profile(d, R, i, o)
  const weak = M.weakComps(d, R, i, 5).map((c) => ({ id: d.players[c.i][C.id], name: d.players[c.i][C.name], team: dname(d, d.players[c.i][C.team]), match: Math.round(100 - c.distance) }))
  const ped = await files.load(`x/pedigree/${s}.json`).then((x) => x.rows.find((r) => r[0] === p.id) || null).catch(() => null)
  const pp = M.pool(d, R, i, POOLKEY[pool])
  const label = M.poolLabel(pp, pl, { adj: adjusted, season: s, conf: M.confOf(d, i), reg: R })
  const [P, A] = await Promise.all([shard(p.id), files.load(`allsavant/${s}.json`).catch(() => null)])
  const bio = bioOf(P, S), val = M.valueLine(d, i)
  const q = R.qual[slot], qn = q ? M.sample(d, q[0], i, true) : null
  const honours = [...(A ? standingOf(A, p.id) : []), ...((P && P.honours) || []).filter((h) => h[0] !== s).map((h) => `${h[2]} (${h[0]})`)]
  const comps = M.comps(d, R, i, 5).map((c) => ({ id: d.players[c.i][C.id], name: d.players[c.i][C.name], team: dname(d, d.players[c.i][C.team]), match: Math.round(100 - c.distance), same_class: c.sameClass, url: playerUrl(d.players[c.i][C.id], s, idx.current) }))
  const isDef = M.SLOT_TABLE[slot] === 'dfn', warn = isDef ? defWarning(R, s) : null
  const lines = [`${pl[C.name]}, ${slot}, ${dname(d, team)} (${M.confOf(d, i)}), ${s}${pl[C.cls] ? `, ${pl[C.cls]}` : ''}. ${asOf(d)}.`,
    `Percentiles ${label}, garbage time ${garbage_time ? 'included' : 'excluded'} (${pp.ids.length} qualified players).${pp.widened ? ` ${pp.widened}.` : ''}`]
  if (!pl[C.qual] && q) lines.push(`LOW SAMPLE: ${Math.round(qn || 0)} ${q[0] === 'tgt' ? 'targets' : q[0]}, under the qualifying ${Math.round(q[1] * (d.scale || 1))}. His percentiles show where his numbers would sit among qualified players.`)
  if (prof) lines.push(`Profile score ${prof.score}: the mean of his percentiles on his position's ${prof.n} headline stats.`)
  for (const r of rows) lines.push(lineText(r) + (r.charted ? ' [charted, from 2025 week 9]' : ''))
  if (retRows.length) { lines.push(`Returner (${Math.round(nret)} returns; pool: FBS returners, raw):`); for (const r of retRows) lines.push(lineText(r)) }
  if (val) lines.push(`Savant value: ${sg(val.value)} expected points above a replacement ${R.slot_name[slot].replace(/s$/, '')}${val.rank ? `, ${ordinal(val.rank)} of ${val.of} qualified ${R.slot_name[slot]}` : ''}.`)
  if (bio.recruit) lines.push(`Recruit: ${bio.recruit.stars} stars${bio.recruit.class_rank ? `, No. ${bio.recruit.class_rank} in the ${bio.recruit.class_year} class` : ''}.`)
  if (bio.transfers.length) lines.push(`Transferred ${bio.transfers.join(', ')}.`)
  if (honours.length) lines.push(`All-Savant: ${honours.join('; ')}.`)
  if (comps.length) lines.push(`Nearest players this season (match out of 100, as on the page): ${comps.map((c) => `${c.name}, ${c.team} (${c.match})`).join('; ')}.`)
  if (weak.length) lines.push(`Weakness comps (closest on his five lowest bars): ${weak.map((c) => `${c.name}, ${c.team} (${c.match})`).join('; ')}.`)
  if (ped) lines.push(`Production vs pedigree: ${ped[3] > 0 ? '+' : ''}${Math.round(ped[3])} (Savant value ${ordinal(Math.round(ped[1]))} percentile at his position, recruiting rating ${ordinal(Math.round(ped[2]))}).`)
  if (isDef) lines.push(R.defender_note)
  if (warn) lines.push(warn)
  if (pl[C.inferred]) lines.push(`Position: the roster lists him as ${pl[C.pos] || 'no position'}; ${slot} is read from his size and plays.`)
  if (others && others.length) lines.push(`Also on file under that name: ${others.map((x) => `${x.name}, ${tname(S, x.team)} ${x.last} (id ${x.id})`).join('; ')}.`)
  lines.push(`FBS-vs-FBS games only. ${playerUrl(p.id, s, idx.current)}`)
  return { text: lines.join('\n'), structured: { player: { id: p.id, name: pl[C.name], position: slot, roster_position: pl[C.pos], position_inferred: !!pl[C.inferred], team: dname(d, team), team_id: team, conference: M.confOf(d, i), class: pl[C.cls], jersey: pl[C.jersey], height_in: pl[C.ht], weight_lb: pl[C.wt], games: pl[C.gp], qualified: !!pl[C.qual], ...bio }, season: s, final: d.final, data_through: day(d.through), pool: { name: label, players: pp.ids.length, widened: pp.widened, adjusted, garbage_time }, stats: rows, returner: retRows.length ? { returns: nret, stats: retRows } : null, profile_score: prof ? prof.score : null, weakness_comps: weak, production_vs_pedigree: ped ? { gap: ped[3], production_pct: ped[1], pedigree_pct: ped[2] } : null, savant_value: val ? { value: val.value, rank: val.rank, of: val.of, rate: val.rate, replacement: val.replacement, volume: val.volume } : null, honours, comparable_players: comps, warning: warn, url: playerUrl(p.id, s, idx.current) } }
}

const lineObj = (table, tot) => Object.fromEntries(M.line(table, tot))
async function playerCareer({ player }) {
  const { p, S } = await findPlayer(player)
  const [P, R, idx] = await Promise.all([shard(p.id), reg(), index()])
  const rows = ((P && P.seasons) || []).map((r) => ({ season: r[0], team_id: r[1], slot: r[2], cls: r[3], games: r[4], qualified: !!r[5], value: r[6], rank: r[7], of: r[8], tot: r[9] }))
  if (p.last === idx.current && !rows.some((r) => r.season === idx.current)) {
    const d = await seasonDoc(idx.current), i = d.players.findIndex((x) => x[C.id] === p.id)
    if (i >= 0) {
      const pl = d.players[i], tab = M.SLOT_TABLE[pl[C.slot]], F = await teamDoc(idx.current, pl[C.team]).catch(() => null), v = M.valueLine(d, i)
      const logs = F && F.logs[String(p.id)], tt = logs ? M.total(logs, R.logcols[tab]) : null
      rows.push({ season: idx.current, team_id: pl[C.team], slot: pl[C.slot], cls: pl[C.cls], games: pl[C.gp], qualified: !!pl[C.qual], value: v ? v.value : null, rank: v ? v.rank : null, of: v ? v.of : null, tot: tt ? R.logcols[tab].map((c) => tt[c]) : null, live: true })
    }
  }
  if (!rows.length) throw new SavantError(`${p.name} is on a roster but has no graded plays in an FBS-vs-FBS game.`)
  const seasons = rows.map((r) => {
    const tab = M.SLOT_TABLE[r.slot], cols = R.logcols[tab], t = r.tot ? { g: r.games, ...Object.fromEntries(cols.map((c, k) => [c, r.tot[k]])) } : null
    return { season: r.season, team: tname(S, r.team_id), team_id: r.team_id, position: r.slot, class: r.cls, games: r.games, qualified: r.qualified, savant_value: r.value, rank_at_position: r.rank, qualified_at_position: r.of, line: t ? lineObj(tab, t) : null, in_progress: !!r.live, defense_warning: tab === 'dfn' && r.season < 2024, url: playerUrl(p.id, r.season, idx.current) }
  })
  const bio = bioOf(P, S)
  const lines = [`${p.name}: ${seasons.length} season${seasons.length === 1 ? '' : 's'} on file${bio.transfers.length ? `, transferred ${bio.transfers.join(', ')}` : ''}.`]
  for (const r of seasons) lines.push(`${r.season} ${r.team}, ${r.position}${r.class ? ` ${r.class}` : ''}: ${r.games} games, Savant value ${sg(r.savant_value)}${r.rank_at_position ? ` (${ordinal(r.rank_at_position)} of ${r.qualified_at_position} ${R.slot_name[r.position]})` : ' (below the qualifying sample)'}${r.line ? `; ${Object.entries(r.line).slice(1, 7).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}${r.in_progress ? ' (season in progress)' : ''}`)
  if (seasons.some((r) => r.defense_warning)) lines.push(R.pre_box_warning)
  if (seasons.some((r) => r.defense_warning && R.no_tacklers.includes(r.season))) lines.push(R.early_def_note)
  lines.push(`Ranks are within each season: seasons are never pooled. Games are FBS-vs-FBS games with a recorded play. ${playerUrl(p.id)}`)
  return { text: lines.join('\n'), structured: { player: { id: p.id, name: p.name, ...bio, honours: ((P && P.honours) || []).map((h) => ({ season: h[0], label: h[2] })) }, seasons, url: playerUrl(p.id) } }
}

async function playerSplits({ player, season }) {
  const { p } = await findPlayer(player, season)
  const { s, idx } = await pickSeason(season || p.last)
  const [R, d] = await Promise.all([reg(), seasonDoc(s)])
  const i = d.players.findIndex((x) => x[C.id] === p.id)
  if (i < 0) throw new SavantError(`${p.name} has no graded plays in ${s}.`)
  const pl = d.players[i], tab = M.SLOT_TABLE[pl[C.slot]], cols = R.logcols[tab]
  const F = await teamDoc(s, pl[C.team])
  const rows = F.logs[String(p.id)] || []
  if (!rows.length) throw new SavantError(`${p.name} has no game log in ${s}.`)
  const splits = M.splits(rows, F.sched, cols, tab).map((x) => ({ split: x.label, games: x.games, line: Object.fromEntries(x.line) }))
  const games = rows.map((r) => { const g = F.sched[r[0]]; return { game_id: g[SC.gid], date: g[SC.date], opponent: dname(d, g[SC.opp]) || g[SC.opp_name], site: g[SC.site] === 1 ? 'home' : g[SC.site] === -1 ? 'road' : 'neutral', conference_game: !!g[SC.conf], result: g[SC.final] ? `${g[SC.pf] > g[SC.pa] ? 'W' : 'L'} ${g[SC.pf]}-${g[SC.pa]}` : null, opponent_power_rank: g[SC.opp_rank], line: Object.fromEntries(M.line(tab, M.total([r], cols)).slice(1)) } })
  const lines = [`${pl[C.name]}, ${pl[C.slot]}, ${dname(d, pl[C.team])}, ${s}. Raw totals, garbage time included, ${asOf(d)}.`]
  for (const x of splits) lines.push(`${x.split} (${x.games} g): ${Object.entries(x.line).slice(1, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  lines.push(`"Our top 25" is the top 25 of WCE's power rating ${d.final ? 'at season\'s end' : 'today'}. A split is a few games: a record of what happened, not a skill. ${playerUrl(p.id, s, idx.current)}`)
  return { text: lines.join('\n'), structured: { player: { id: p.id, name: pl[C.name], position: pl[C.slot], team: dname(d, pl[C.team]) }, season: s, data_through: day(d.through), splits, games, url: playerUrl(p.id, s, idx.current) } }
}

async function leaderboard({ stat, season, position, pool, adjusted, garbage_time, qualified_only, conference, limit }) {
  const { s, idx } = await pickSeason(season)
  const [R, d] = await Promise.all([reg(), seasonDoc(s)])
  const isValue = stat === 'value'
  const st = isValue ? null : R.stats.find((x) => x.key === stat)
  if (!isValue && !st) throw new SavantError(`No stat "${stat}". Keys: value, ${R.stats.map((x) => x.key).join(', ')}.`)
  if (isValue && position === 'RET') throw new SavantError('Returners have no Savant value of their own; ask for a returner stat (ret_epa, ret_kyds, ret_pyds, ret_20, ret_td, ret_fc, ret_muff).')
  const slots = position ? [position] : isValue ? R.slots.filter((x) => x !== 'OL') : st.slots
  const ret = slots.includes('RET'), rp = ret ? M.retPool(d, R) : null
  if (st && position && !st.slots.includes(position)) throw new SavantError(`${st.label} is a stat for ${st.slots.join(' and ')}, not ${position}.`)
  if (st && !M.tracked(st, s)) return { text: `${st.label}: ${s < st.start ? `not tracked before ${st.start}` : `not tracked in ${s}`}.${st.note ? ` ${st.note}` : ''}`, structured: { stat: stat, label: st.label, season: s, tracked: false, note: s < st.start ? `not tracked before ${st.start}` : `not tracked in ${s}`, pool: null, count: 0, leaders: [] } }
  const o = { poolName: POOLKEY[pool], adj: adjusted, gt: garbage_time }
  const out = []
  d.players.forEach((p, i) => {
    if (ret) { if (!M.sample(d, 'returns', i, false) || (qualified_only && !rp.ids.includes(i))) return }
    else { if (!slots.includes(p[C.slot])) return; if (qualified_only && !p[C.qual]) return }
    if (conference && String(M.confOf(d, i)).toLowerCase() !== conference.toLowerCase()) return
    if (isValue) { const v = d.value.v[i]; if (M.ok(v)) out.push({ i, v: +v }) } else { const r = M.row(d, R, st, i, o); if (r.tracked && !r.none && r.pct != null) out.push({ i, v: r.value, r }) }
  })
  const lower = st && st.lower
  out.sort((a, b) => (lower ? a.v - b.v : b.v - a.v) || d.players[a.i][C.id] - d.players[b.i][C.id])
  const leaders = out.slice(0, limit).map((x, k) => { const p = d.players[x.i]; return { rank: k + 1, id: p[C.id], name: p[C.name], position: p[C.slot], team: dname(d, p[C.team]), conference: M.confOf(d, x.i), qualified: !!p[C.qual], value: x.v, shown: isValue ? sg(x.v) : x.r.shown, percentile: isValue ? null : x.r.pct, sample: isValue ? null : x.r.n, low_sample: isValue ? false : x.r.settling, url: playerUrl(p[C.id], s, idx.current) } })
  const who = ret ? 'returners' : slots.length === 1 ? R.slot_name[slots[0]] : slots.length > 4 ? 'players at every position' : slots.map((x) => R.slot_name[x]).join(' and ')
  const poolText = isValue ? `Savant value (expected points above a replacement player at his position, opponent-adjusted), ${s}` : `percentiles vs ${pool === 'conference' ? 'each player\'s own conference' : pool === 'power_4' ? 'Power 4' : 'FBS'} ${who}, ${adjusted && st.adj ? 'opponent-adjusted' : 'raw'}, garbage time ${garbage_time ? 'included' : 'excluded'}, ${s}`
  const isDef = slots.some((x) => M.SLOT_TABLE[x] === 'dfn'), warn = isDef ? defWarning(R, s) : null
  const lines = [`${isValue ? 'Savant value' : st.label} leaders, ${who}${conference ? `, ${conference}` : ''}, ${asOf(d)}. ${poolText[0].toUpperCase()}${poolText.slice(1)}.${qualified_only ? ' Qualified players only.' : ''}`]
  for (const l of leaders) lines.push(`${l.rank}. ${l.name}, ${l.position}, ${l.team}: ${l.shown}${l.percentile != null ? ` (${ordinal(l.percentile)} percentile${l.low_sample ? ', low sample' : ''})` : ''}`)
  if (st && st.verdict !== 'full') lines.push(st.verdict === 'context' ? 'A CONTEXT stat: it says how much, or is too noisy to grade in one season.' : 'Noisy in any one season.')
  if (warn) lines.push(warn)
  lines.push(`${PAGE}#leaders${s !== idx.current ? `/${s}` : ''}`)
  return { text: lines.join('\n'), structured: { stat, label: isValue ? 'Savant value' : st.label, season: s, tracked: true, note: null, pool: poolText, data_through: day(d.through), count: leaders.length, leaders, warning: warn } }
}

async function teamProfile({ team, season, adjusted }) {
  const t = await findTeam(team, season)
  const { s, idx } = await pickSeason(season || Math.min(t[4], (await index()).current))
  const [R, D, d] = await Promise.all([reg(), teamsDoc(s), seasonDoc(s)])
  const ti = D.teams.findIndex((r) => r[T.id] === t[0])
  if (ti < 0) throw new SavantError(`${t[1]} was not an FBS team in ${s}.`)
  const r = D.teams[ti], F = await teamDoc(s, t[0])
  const stats = R.team_stats.map((x) => { const v = M.teamRow(D, x, ti, adjusted); return { key: x.key, label: x.label, group: x.group, luck: x.verdict === 'luck', context: x.verdict === 'context', lower_is_better: x.lower, value: v ? v.value : null, shown: v ? v.shown : null, percentile: v ? v.pct : null, rank: v ? v.rank : null, of: v ? v.of : null, adjusted: v ? v.adjusted : false } })
  const PD = s === idx.current ? await files.load(`playoff/${s}.json`).catch(() => null) : null
  const odds = PD && PD.odds && PD.odds[String(t[0])] ? { make_field: PD.odds[String(t[0])][0], bye: PD.odds[String(t[0])][1], host_first_round: PD.odds[String(t[0])][2], win_conference: PD.odds[String(t[0])][3], simulated_seasons: PD.sims } : null
  const schedule = F.sched.map((g) => ({ game_id: g[SC.gid], date: g[SC.date], week: g[SC.week], opponent: dname(d, g[SC.opp]) || g[SC.opp_name], site: g[SC.site] === 1 ? 'home' : g[SC.site] === -1 ? 'road' : 'neutral', conference_game: !!g[SC.conf], result: g[SC.final] ? `${g[SC.pf] > g[SC.pa] ? 'W' : 'L'} ${g[SC.pf]}-${g[SC.pa]}` : null, pregame_win_chance: g[SC.wp], opponent_power_rank: g[SC.opp_rank] }))
  const roster = F.roster.filter((p) => p[12] != null).sort((a, b) => b[12] - a[12]).slice(0, 15).map((p) => ({ id: p[0], name: p[1], position: p[3], class: p[5], savant_value: p[12], url: playerUrl(p[0], s, idx.current) }))
  const key = (k) => stats.find((x) => x.key === k)
  const lines = [`${r[T.school]} (${r[T.conf]}), ${s}: ${r[T.w]}-${r[T.l]} (${r[T.cw]}-${r[T.cl]} in conference). ${asOf(D)}.`,
    `Power rating ${sg(r[T.rating])} points per game against an average FBS team (${ordinal(r[T.rating_rank])} of ${D.teams.length}): offense ${sg(r[T.off])}, defense ${sg(r[T.def])}, special teams ${sg(r[T.st])}.`,
    `Résumé rank ${r[T.resume_rank] ? ordinal(r[T.resume_rank]) : '—'} (wins and losses against the schedule; margin never enters). Schedule: the bubble team would lose ${pc(r[T.sos])} of these games.`,
    `Percentiles vs all ${D.teams.length} FBS teams, ${adjusted ? 'opponent-adjusted where the stat has it' : 'raw'}, garbage time excluded, ${s}:`]
  for (const k of ['off_epa', 'def_epa', 'off_sr', 'def_sr', 'off_expl', 'def_havoc', 'off_ppo', 'pace']) { const x = key(k); if (x && x.percentile != null) lines.push(`${x.label}: ${x.shown}, ${ordinal(x.percentile)} percentile${x.lower_is_better ? ' (lower is better, flipped)' : ''}`) }
  const tm = key('to_margin'); if (tm && tm.value != null) lines.push(`Turnover margin per game: ${tm.shown} (luck: it barely repeats).`)
  if (r[T.talent_rank]) lines.push(`Team talent: ${ordinal(r[T.talent_rank])}, WCE's own, computed from the recruiting stars and class ranks on the roster.${r[T.ret_off] != null ? ` Returning: ${pc(r[T.ret_off])} of last season's offensive touches, ${pc(r[T.ret_def])} of its tackles.` : ''}`)
  if (F.coach && F.coach.length) lines.push(`Head coach: ${F.coach.join(', ')}.`)
  if (F.ol) lines.push(`Offensive line as a unit: ${sg(F.ol.value)} points (${ordinal(F.ol.rank)} of ${F.ol.of}).`)
  if (odds) lines.push(`Playoff odds from ${odds.simulated_seasons.toLocaleString('en-US')} simulated seasons: makes the field ${pc(odds.make_field)}, bye ${pc(odds.bye)}, hosts a first-round game ${pc(odds.host_first_round)}, wins its conference ${pc(odds.win_conference)}. The model's view, not a verdict.`)
  lines.push(`Top players by Savant value: ${roster.slice(0, 6).map((p) => `${p.name} (${p.position}, ${sg(p.savant_value)})`).join(', ')}.`)
  lines.push(teamUrl(t[0], s, idx.current))
  return { text: lines.join('\n'), structured: { team: { id: t[0], name: r[T.school], conference: r[T.conf], record: `${r[T.w]}-${r[T.l]}`, conference_record: `${r[T.cw]}-${r[T.cl]}`, head_coach: F.coach || [], power_rating: r[T.rating], power_rank: r[T.rating_rank], offense: r[T.off], defense: r[T.def], special_teams: r[T.st], resume_rank: r[T.resume_rank], resume_score: r[T.resume], schedule_strength: r[T.sos], talent_rank: r[T.talent_rank], returning_offense: r[T.ret_off], returning_defense: r[T.ret_def], offensive_line: F.ol }, season: s, final: D.final, data_through: day(D.through), pool: `vs all ${D.teams.length} FBS teams, ${adjusted ? 'opponent-adjusted where the stat has it' : 'raw'}, garbage time excluded, ${s}`, stats, playoff_odds: odds, schedule, top_players: roster, url: teamUrl(t[0], s, idx.current) } }
}

const TEAM_COLS = { power: 'rating', offense: 'off', defense: 'def', special_teams: 'st', resume: 'resume_rank', schedule: 'sos', talent: 'talent_rank' }
async function teamRankings({ season, sort, ascending, conference, adjusted, limit }) {
  const { s, idx } = await pickSeason(season)
  const [R, D] = await Promise.all([reg(), teamsDoc(s)])
  const st = R.team_stats.find((x) => x.key === sort)
  if (!st && !TEAM_COLS[sort]) throw new SavantError(`No team column "${sort}". Use one of ${Object.keys(TEAM_COLS).join(', ')}, or a team stat key: ${R.team_stats.map((x) => x.key).join(', ')}.`)
  const lowerFirst = st ? st.lower : (sort === 'resume' || sort === 'talent')
  const get = (i) => (st ? (M.teamRow(D, st, i, adjusted) || {}).value : D.teams[i][T[TEAM_COLS[sort]]])
  let rows = D.teams.map((r, i) => ({ r, i, v: get(i) })).filter((x) => x.v != null)
  rows.sort((a, b) => (lowerFirst ? a.v - b.v : b.v - a.v) || a.r[T.school].localeCompare(b.r[T.school]))
  rows.forEach((x, k) => { x.rank = k + 1 })
  if (ascending) rows.reverse()
  if (conference) rows = rows.filter((x) => String(x.r[T.conf]).toLowerCase() === conference.toLowerCase())
  if (conference && !rows.length) throw new SavantError(`No ${s} FBS conference called "${conference}". Conferences: ${[...new Set(D.teams.map((r) => r[T.conf]))].sort().join(', ')}.`)
  const label = st ? st.label : { power: 'Power rating (points per game vs an average FBS team)', offense: 'Offense rating', defense: 'Defense rating', special_teams: 'Special-teams rating', resume: 'Résumé rank', schedule: 'Schedule strength (share of these games the bubble team would lose)', talent: 'Team talent rank (WCE\'s own, from recruiting stars)' }[sort]
  const teams = rows.slice(0, limit).map((x) => ({ fbs_rank: x.rank, id: x.r[T.id], team: x.r[T.school], conference: x.r[T.conf], record: `${x.r[T.w]}-${x.r[T.l]}`, value: x.v, shown: st ? M.display(st, x.v) : sort === 'schedule' ? pc(x.v) : (sort === 'resume' || sort === 'talent') ? ordinal(x.v) : sg(x.v), power_rating: x.r[T.rating], resume_rank: x.r[T.resume_rank], url: teamUrl(x.r[T.id], s, idx.current) }))
  const lines = [`${label}, ${s}, ${asOf(D)}${conference ? `, ${conference}` : ''}. Ranked among all ${D.teams.length} FBS teams${st ? `, ${adjusted && st.adj ? 'opponent-adjusted' : 'raw'}, garbage time excluded` : ''}.${st && st.verdict === 'luck' ? ' Labeled luck: it barely repeats.' : ''}`]
  for (const x of teams) lines.push(`${x.fbs_rank}. ${x.team} (${x.record}): ${x.shown}`)
  lines.push(`${PAGE}#teams${s !== idx.current ? `/${s}` : ''}`)
  return { text: lines.join('\n'), structured: { season: s, sort, label, data_through: day(D.through), count: teams.length, teams } }
}

async function game({ game_id, season }) {
  const idx = await index()
  const order = season ? [season] : idx.seasons.map((x) => x.season)
  let G = null, row = null
  for (const y of order) { const g = await files.load(`games/${y}.json`).catch(() => null); if (!g) continue; const r = g.rows.find((x) => String(x[0]) === String(game_id)); if (r) { G = g; row = r; break } }
  if (!row) throw new SavantError(`No FBS game with ESPN event id ${game_id}${season ? ` in ${season}` : ''}. cfb_team_profile lists a team's games with their ids.`)
  const c = Object.fromEntries(G.cols.map((k, i) => [k, row[i]])), s = G.season
  const [d, R] = await Promise.all([seasonDoc(s), reg()])
  const nm = (id) => dname(d, id) || G.names[String(id)] || 'a non-FBS team'
  const side = (p) => (c[`${p}_plays`] == null ? null : { plays: c[`${p}_plays`], epa_per_play: c[`${p}_epa`], success_rate: c[`${p}_sr`], explosive_rate: c[`${p}_expl`], turnovers: c[`${p}_to`], yards: c[`${p}_yards`] })
  const players = {}
  for (const [k, id] of [['home', c.home], ['away', c.away]]) {
    const F = d.teams[String(id)] ? await teamDoc(s, id).catch(() => null) : null
    players[k] = []
    if (!F) continue
    const gi = F.sched.findIndex((g) => g[SC.gid] === c.gid), names = new Map(F.roster.map((p) => [String(p[0]), p]))
    for (const [pid, logs] of Object.entries(F.logs)) {
      const r = logs.find((x) => x[0] === gi), p = names.get(pid)
      if (!r || !p || !p[3]) continue
      const tab = M.SLOT_TABLE[p[3]], tot = M.total([r], R.logcols[tab])
      const vol = { qb: tot.db, rush: tot.rush, rec: tot.tgt_eff, dfn: tot.e_tkl, kick: tot.fga, punt: tot.punts }[tab]
      players[k].push({ id: +pid, name: p[1], position: p[3], volume: vol, line: Object.fromEntries(M.line(tab, tot).slice(1)) })
    }
    const lim = { QB: 2, RB: 3, WR: 4, TE: 2, K: 1, P: 1 }
    const seen = {}
    players[k] = players[k].sort((a, b) => b.volume - a.volume).filter((p) => { const key = lim[p.position] ? p.position : 'D'; seen[key] = (seen[key] || 0) + 1; return seen[key] <= (lim[p.position] || 6) }).map(({ volume, ...p }) => p)
  }
  const fin = !!c.final
  const lines = [`${nm(c.away)} ${fin ? c.ap : ''}${fin ? ',' : ' at'} ${nm(c.home)} ${fin ? c.hp : ''}${c.neutral ? ' (neutral site)' : ''}, ${c.date}, week ${c.week}${c.conf ? ', conference game' : ''}${fin ? '' : ' (not played yet)'}.`.replace(/\s+,/g, ',').replace(/\s+/g, ' ')]
  if (c.wp_home != null) lines.push(`Our pregame view: ${nm(c.home)} ${pc(c.wp_home)} to win. The model's view, not a verdict.`)
  for (const [k, id] of [['away', c.away], ['home', c.home]]) { const x = side(k === 'home' ? 'h' : 'a'); if (x) lines.push(`${nm(id)}: ${x.plays} plays, EPA per play ${sg(x.epa_per_play, 3)}, success rate ${x.success_rate}%, explosive plays ${x.explosive_rate}%, ${x.turnovers} turnover${x.turnovers === 1 ? '' : 's'}.`) }
  for (const [k, id] of [['away', c.away], ['home', c.home]]) for (const p of players[k].slice(0, 6)) lines.push(`${p.name} (${p.position}, ${nm(id)}): ${Object.entries(p.line).slice(0, 6).map(([a, b]) => `${a} ${b}`).join(', ')}`)
  if (!side('h') && fin) lines.push('No team line: this is not an FBS-vs-FBS game with play-by-play, so it is left out of every stat.')
  lines.push(`Garbage time is included in a game's own line. Data through ${day(G.through)}. ${PAGE}`)
  return { text: lines.join('\n'), structured: { game: { id: c.gid, season: s, date: c.date, week: c.week, home: nm(c.home), home_id: c.home, away: nm(c.away), away_id: c.away, home_points: c.hp, away_points: c.ap, neutral_site: !!c.neutral, conference_game: !!c.conf, final: fin, pregame_home_win_chance: c.wp_home }, home: side('h'), away: side('a'), players, season: s } }
}

async function allSavant({ season, team, conference }) {
  const { s, idx } = await pickSeason(season)
  const [A, d] = await Promise.all([files.load(`allsavant/${s}.json`), seasonDoc(s)])
  let rows, name
  if (team === 'conference') {
    const c = Object.keys(A.conference).find((k) => k.toLowerCase() === String(conference || '').toLowerCase())
    if (!c) throw new SavantError(`Name a conference for that team. ${s} conferences: ${Object.keys(A.conference).sort().join(', ')}.`)
    rows = A.conference[c]; name = `All-${c} Savant`
  } else if (team === 'freshman') { rows = A.freshman; name = 'Freshman All-Savant' } else { const t = { first: '1', second: '2', third: '3' }[team]; rows = A.national[t]; name = `${['', '1st', '2nd', '3rd'][+t]}-team All-Savant` }
  const pick = (r) => (r.slot === 'OL' ? { slot: 'OL unit', id: null, name: `${dname(d, r.team)} offensive line`, team: dname(d, r.team), team_id: r.team, savant_value: r.value, url: teamUrl(r.team, s, idx.current) } : { slot: r.slot === 'AP' ? 'All-purpose' : r.slot === 'DB' ? 'DB' : r.slot, position: r.pos, id: r.pid, name: r.name, class: r.cls, team: dname(d, r.team), team_id: r.team, savant_value: r.value, url: playerUrl(r.pid, s, idx.current) })
  const picks = rows.map(pick), award = (r) => (r ? { id: r.pid, name: r.name, position: r.slot, team: dname(d, r.team), savant_value: r.value, url: playerUrl(r.pid, s, idx.current) } : null)
  const lines = [`${name}, ${s}${A.final ? '' : ` (${A.standing}: a standing, not yet an award)`}. Pure individual Savant value, no credit for team success; the offensive line is picked as one unit.`]
  for (const p of picks) lines.push(`${p.slot}: ${p.name}${p.id ? `, ${p.team}` : ''} (${sg(p.savant_value)})`)
  const h = award(A.heisman[0]), n = award(A.non_qb[0])
  if (h) lines.push(`Savant Heisman${A.final ? '' : ' leader'}: ${h.name}, ${h.position}, ${h.team} (${sg(h.savant_value)}).`)
  if (n) lines.push(`Non-QB Player of the Year${A.final ? '' : ' leader'}: ${n.name}, ${n.position}, ${n.team} (${sg(n.savant_value)}).`)
  if (A.warning) lines.push(A.warning)
  lines.push(`${A.note} ${PAGE}#all-savant${s !== idx.current ? `/${s}` : ''}`)
  return { text: lines.join('\n'), structured: { season: s, team: name, final: A.final, standing: A.standing, data_through: day(A.through), picks, savant_heisman: h, heisman_race: A.heisman.slice(0, 5).map(award), non_qb_player_of_the_year: n, warning: A.warning, note: A.note } }
}

async function playoffField({ season, teams }) {
  const { s, idx } = await pickSeason(season)
  const [P, d] = await Promise.all([files.load(`playoff/${s}.json`), seasonDoc(s)])
  const nm = (id) => dname(d, id), cur = !!P.odds
  const field = P.field.map((f) => ({ seed: f.seed, team: nm(f.team), team_id: f.team, how: f.how, record: `${f.w}-${f.l}`, resume_rank: f.rank, resume_score: f.resume, power_rating: f.rating, bye: f.seed <= 4, hosts_first_round: f.seed >= 5 && f.seed <= 8 }))
  const table = P.table.slice(0, teams).map((r) => ({ rank: r[1], team: nm(r[0]), team_id: r[0], record: `${r[2]}-${r[3]}`, resume_score: r[4], power_rating: r[5], power_rank: r[6], schedule_strength: r[7], ...(cur && P.odds[String(r[0])] ? { make_field: P.odds[String(r[0])][0], bye: P.odds[String(r[0])][1], host_first_round: P.odds[String(r[0])][2], win_conference: P.odds[String(r[0])][3] } : {}) }))
  const leaders = cur ? Object.entries(P.leaders).map(([c, L]) => ({ conference: c, first: nm(L.first), second: nm(L.second), title_game_set: !!L.set, tiebreakers: Object.entries(L.how || {}).filter(([, h]) => h).map(([t, h]) => ({ team: nm(+t), decided_by: h.name, outside_number: !!h.outside, level_with: h.tied_with.map(nm) })) })) : null
  const lines = [cur ? `The objective playoff field if the season ended today, ${s}, through ${day(P.through)} (week ${P.week}). Conference leaders hold the champions' places until the title games are played.` : `The ${s} objective field under the 2026 rules, with the champions that season had. Ours, not the field that was played.`]
  for (const f of field) lines.push(`${f.seed}. ${f.team} (${f.record}, ${f.how}, résumé rank ${f.resume_rank})`)
  lines.push(`First round at the higher seed: 12 at 5, 11 at 6, 10 at 7, 9 at 8. Seeds 1 to 4 have byes. A Power 4 champion is in whatever its record; one ranked outside the top 12 is seeded at the bottom.`)
  lines.push(`First out: ${P.first_out.map(nm).join(', ')}.`)
  if (cur) {
    const flagged = leaders.flatMap((L) => L.tiebreakers.map((t) => `${t.team} (${L.conference}: ${t.decided_by})`))
    if (flagged.length) lines.push(`Places that rest on a tiebreaker: ${flagged.join('; ')}.`)
    lines.push(`Odds from ${P.sims.toLocaleString('en-US')} simulated seasons (make the field / bye / host / win conference): ${table.filter((t) => t.make_field >= 0.05).slice(0, 16).map((t) => `${t.team} ${pc(t.make_field)}/${pc(t.bye)}/${pc(t.host_first_round)}/${pc(t.win_conference)}`).join('; ')}. The model's view, not a verdict.`)
  }
  lines.push(`Seeded by résumé score: the chance the bubble team (12th-best by our power rating) would match this record against this schedule. Margin never enters it. No committee ranking is used. ${PAGE}#playoff${s !== idx.current ? `/${s}` : ''}`)
  return { text: lines.join('\n'), structured: { season: s, live: cur, data_through: day(P.through), field, first_out: P.first_out.map(nm), conference_leaders: leaders, ranking: table, simulated_seasons: cur ? P.sims : null, rules: P.rules, champions: P.champions ? Object.fromEntries(Object.entries(P.champions).map(([c, t]) => [c, nm(t)])) : null } }
}

async function nflComps({ player }) {
  const { p } = await findPlayer(player)
  const [X, N, idx] = await Promise.all([files.load(`x/comps/${String(Math.abs(p.id) % 100).padStart(2, '0')}.json`).catch(() => ({})), files.load('x/nfl.json'), index()])
  const me = X[String(p.id)]
  if (!me) throw new SavantError(`${p.name} has no qualified college season to compare.`)
  const show = N.show_outcomes && !(N.show_by_slot && N.show_by_slot[me.slot] === false)
  const comps = me.comps.map(([id, dist]) => { const q = N.players[String(id)]; return q && { id, name: q[0], position: q[1], final_college_season: q[2], drafted: q[5] ? (q[5][1] ? { year: q[5][0], round: q[5][1], pick: q[5][2], team: q[5][3] } : { year: q[5][0], undrafted: true }) : null, nfl_seasons: q[6].length, nfl_value_per_season: show ? q[7] : null, nfl_value_by_season: show ? q[6] : null, distance: dist, url: playerUrl(id, q[2], idx.current) } }).filter(Boolean)
  const combine = N.combine[String(p.id)] || null
  const vals = comps.map((c) => c.nfl_value_per_season).filter((v) => v != null)
  const lines = [`${p.name}: the five final college seasons at his position most like his ${me.season} profile, among players who reached the NFL. A comparison, not a projection.`]
  for (const c of comps) lines.push(`${c.name} (${c.final_college_season}): ${c.drafted ? (c.drafted.undrafted ? `undrafted ${c.drafted.year}` : `round ${c.drafted.round}, pick ${c.drafted.pick}, ${c.drafted.year}`) : 'undrafted'}; ${c.nfl_seasons} NFL seasons${c.nfl_value_per_season != null ? `, ${sg(c.nfl_value_per_season)} NFL Savant value per season` : ''}`)
  if (show && vals.length) lines.push(`Comp average: ${sg(vals.reduce((a, b) => a + b, 0) / vals.length)} per season. Tested on ${N.test.players} NFL players' 2014-2021 college finals: rank correlation ${N.test.spearman.toFixed(2)} with their own NFL value.`)
  else lines.push('NFL outcome averages are not shown: on 2014-2021 college finals they did not track the player\'s own at his position.')
  if (combine) lines.push(`His NFL combine (Football Savant): ${Object.entries(combine).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
  return { text: lines.join('\n'), structured: { player: { id: p.id, name: p.name }, profile_season: me.season, label: 'comparison, not a projection', comps, comp_average: show && vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, test: N.test, combine, url: playerUrl(p.id, me.season, idx.current) } }
}

// ---- the tools ------------------------------------------------------------------------
const season = z.number().int().min(2004).max(2100).optional().describe('Season year, e.g. 2025. Default: the season being played.')
const open = z.object({}).passthrough()
const who = z.string().trim().min(2).max(80).describe('Player name or ESPN athlete id, e.g. "Jeremiah Smith".')
const school = z.string().trim().min(2).max(60).describe('Team name or ESPN team id, e.g. "Ohio State".')
const SLOTS = ['QB', 'RB', 'WR', 'TE', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'K', 'P', 'RET']
const opts = { pool: z.enum(POOLS).default('position').describe('Percentile pool: FBS at his position, Power 4 only, or his conference.'), adjusted: z.boolean().default(true).describe('Opponent-adjusted where the stat has it.'), garbage_time: z.boolean().default(false).describe('Include garbage time.') }
const tool = (name, title, description, inputSchema, outputSchema, run) => ({ name, config: { title, description, inputSchema, outputSchema, annotations: { title, ...READ_ONLY } }, run })

export const tools = [
  tool('cfb_search_players', 'Search college football players', 'Find FBS players in College Football Savant (wcehoops.com) by name, 2009 on (2013 is not on the site). Tolerates accents and small typos.', { query: z.string().trim().min(2).max(80).describe('Player name or part of one.'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return.') }, { query: z.string(), total: z.number(), count: z.number(), players: z.array(open) }, searchPlayers),
  tool('cfb_get_player_profile', 'Get a college football player\'s Savant profile', 'One FBS player-season: percentile bars by card group against his position, each with pool, sample and settle estimate; profile score, Savant value, recruiting, transfers, honours, nearest and weakness comps. Seasons are never pooled.', { player: who, season, ...opts, group: z.string().max(30).default('all').describe('A card group, or all.') }, { player: open, season: z.number(), final: z.boolean(), data_through: z.string(), pool: open, stats: z.array(open), returner: open.nullable(), profile_score: z.number().nullable(), weakness_comps: z.array(open), production_vs_pedigree: open.nullable(), savant_value: open.nullable(), honours: z.array(z.string()), comparable_players: z.array(open), warning: z.string().nullable(), url: z.string() }, profile),
  tool('cfb_player_career', 'Get a college football player\'s career', 'Every season on file across schools since 2009, transfers marked, with Savant value, rank at his position each season and his totals.', { player: who }, { player: open, seasons: z.array(open), url: z.string() }, playerCareer),
  tool('cfb_player_splits', 'Get a college football player\'s splits', 'Home, road and neutral; conference and non-conference; against our top 25; by month; and the game log with opponents and results.', { player: who, season }, { player: open, season: z.number(), data_through: z.string(), splits: z.array(open), games: z.array(open), url: z.string() }, playerSplits),
  tool('cfb_leaderboard', 'College Football Savant leaders', 'Leaders in any stat, or in Savant value, for a season: by position, pool, conference and sample. Stat keys are in each profile\'s stats (e.g. qb_epa_db); "value" is Savant value.', { stat: z.string().min(1).max(24).default('value').describe('Stat key, or "value".'), season, position: z.enum(SLOTS).optional().describe('Position. Default: the stat\'s own positions.'), ...opts, qualified_only: z.boolean().default(true).describe('Only players with the qualifying sample.'), conference: z.string().max(40).optional().describe('Only this conference, e.g. "SEC".'), limit: z.number().int().min(1).max(50).default(15).describe('Rows to return.') }, { stat: z.string(), label: z.string(), season: z.number(), tracked: z.boolean(), note: z.string().nullable(), pool: z.string().nullable(), data_through: z.string().optional(), count: z.number(), leaders: z.array(open), warning: z.string().nullable().optional() }, leaderboard),
  tool('cfb_team_profile', 'Get an FBS team\'s profile', 'A team-season: record, WCE power rating by unit, résumé rank, schedule strength, team stats as percentiles among FBS, head coach, talent, playoff odds in the season being played, schedule with pregame win chances, and its best players.', { team: school, season, adjusted: opts.adjusted }, { team: open, season: z.number(), final: z.boolean(), data_through: z.string(), pool: z.string(), stats: z.array(open), playoff_odds: open.nullable(), schedule: z.array(open), top_players: z.array(open), url: z.string() }, teamProfile),
  tool('cfb_team_rankings', 'Rank FBS teams', 'Rank FBS teams by power rating, offense, defense, special teams, résumé, schedule, talent or any team stat key (off_epa, def_sr, def_havoc, to_margin and so on), best first, with each row\'s FBS rank. Filter by conference.', { season, sort: z.string().min(2).max(24).default('power').describe('power, offense, defense, special_teams, resume, schedule, talent, or a team stat key.'), ascending: z.boolean().default(false).describe('Worst first.'), conference: z.string().max(40).optional().describe('Only this conference.'), adjusted: opts.adjusted, limit: z.number().int().min(1).max(140).default(25).describe('Rows to return.') }, { season: z.number(), sort: z.string(), label: z.string(), data_through: z.string(), count: z.number(), teams: z.array(open) }, teamRankings),
  tool('cfb_game', 'Get a college football game', 'One game by ESPN event id: score, site, our pregame win chance, each team\'s plays, EPA per play, success rate and turnovers, and the main players\' lines.', { game_id: z.string().regex(/^\d+$/).describe('ESPN event id (cfb_team_profile lists them).'), season }, { game: open, home: open.nullable(), away: open.nullable(), players: open, season: z.number() }, game),
  tool('cfb_all_savant_team', 'College football All-Savant teams', 'The All-Savant teams by Savant value, 2009 on (not 2013), in the AP shape with the offensive line as one unit: national 1st, 2nd and 3rd teams, a team per conference, a Freshman team, the Savant Heisman and the Non-QB Player of the Year. Before the final week it is a standing.', { season, team: z.enum(SETS).default('first').describe('Which team.'), conference: z.string().max(40).optional().describe('For team "conference", e.g. "Big Ten".') }, { season: z.number(), team: z.string(), final: z.boolean(), standing: z.string().nullable(), data_through: z.string(), picks: z.array(open), savant_heisman: open.nullable(), heisman_race: z.array(open.nullable()), non_qb_player_of_the_year: open.nullable(), warning: z.string().nullable(), note: z.string() }, allSavant),
  tool('cfb_nfl_comps', 'College-to-NFL comparisons', 'NFL players whose final college seasons were most like his: draft slot, NFL value. A comparison, not a projection.', { player: who }, { player: open, profile_season: z.number(), label: z.string(), comps: z.array(open), comp_average: z.number().nullable(), test: open, combine: open.nullable(), url: z.string() }, nflComps),
  tool('cfb_playoff_field', 'The objective College Football Playoff field', 'WCE\'s own 12-team field under the 2026 rules, seeded by résumé score (wins and losses against the schedule, never margin): today\'s field with conference leaders, tiebreaker flags and odds from 20,000 simulated seasons, or any past season since 2009 (not 2013) as history. No committee ranking is used.', { season, teams: z.number().int().min(12).max(60).default(25).describe('Rows of the résumé ranking to return.') }, { season: z.number(), live: z.boolean(), data_through: z.string(), field: z.array(open), first_out: z.array(z.string().nullable()), conference_leaders: z.array(open).nullable(), ranking: z.array(open), simulated_seasons: z.number().nullable(), rules: z.array(z.string()), champions: open.nullable() }, playoffField),
]
