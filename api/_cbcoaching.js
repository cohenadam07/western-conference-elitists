// api/_cbcoaching.js — College Basketball Coaching Savant, as answers. One section of the AI connector
// (api/mcp.js): it knows men's D1 head coaches; the connector only speaks the protocol.
//
// It reads the page's own files under /cbcs/ (pipeline/college/coaching/build.py writes them,
// gzipped, served as .json):
//   index.json          every coach, the Leaders boards, the tree, league medians, the stat registry
//   c/<coach>.json      one coach's page: record, seasons, the ranked career card, lineage, similar players
//   t/<team>-<season>.json   a team-season: the Rotation Map, pairs, units, minutes vs Savant rate
//   data/<table>/<season>.json   the Data Room (games, stints, units, rotation, decisions, roster_moves)
//   data/programs.json  every program-season; data/dictionary.json every column, defined
//   fit.json            player profiles and coaches' systems: the similarity math, the page's own
// Every percentile is already in those files with its pool, so an answer here is the number on the
// coach's page; the similarity is recomputed with the build's formula, so it equals the page's too.
//
// What an answer always says: which pool a percentile is from; when a season is too short to rank;
// when a stat has no value (never a zero); that the rotation verdicts are the model's view; that a
// row is unconfirmed or an interim; that similar players are not a prediction (the fit test failed);
// that CollegeBasketballData rows are inputs only (none is served raw); where the page is.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, ordinal, prepare, rank, topTier } from './_core.js'
import { display, matches } from './_bcoaching.js'

const files = makeLoader('cbcs', { what: 'College Basketball Coaching Savant', shape: (b) => b && typeof b === 'object' && (b.meta || b.id || b.cols || b.stats || b.coaches || b.systems || b.tables) })
const SOURCE = 'College Basketball Coaching Savant, Western Conference Elitists (wcehoops.com)'
export const GROUPS = ['all', 'career', 'rotation', 'game_management', 'identity', 'development', 'roster_building', 'tournament', 'resources', 'context', 'staff', 'seasons']
export const TABLES = ['games', 'stints', 'units', 'rotation', 'decisions', 'roster_moves', 'programs']
const MAX_ROWS = 500
const PAGE = `${SITE}/college-basketball-coaching-savant.html`
export const coachUrl = (id, season) => `${PAGE}#c=${encodeURIComponent(id)}${season ? `&season=${season}` : ''}`
const cbbPlayerUrl = (eid, season) => `${SITE}/college-basketball-savant.html#player-${eid}/${season}`

const loadIndex = () => files.load('index.json')
const loadCoach = (id) => files.load(`c/${encodeURIComponent(id)}.json`)
const loadTeam = (team, season) => files.load(`t/${team}-${season}.json`)
const loadTable = (table, season) => files.load(table === 'programs' ? 'data/programs.json' : `data/${table}/${season}.json`)
const loadDict = () => files.load('data/dictionary.json')
const loadFit = () => files.load('fit.json')

export const asOf = (idx) => day(idx.meta.through || idx.meta.generated)
const record = (w, l) => `${w}–${l}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const teamName = (idx, t) => idx.teams?.[t]?.name || t
function say(notes, lines, note) { if (!notes.includes(note)) { notes.push(note); lines.push(note) } }

// ---- finding the coach -----------------------------------------------------------------
const prepared = new WeakMap()
async function people() {
  const idx = await loadIndex()
  let rows = prepared.get(idx)
  if (!rows) { rows = prepare(idx.coaches.map((c) => ({ ...c }))); prepared.set(idx, rows) }
  return rows
}
const longer = (a, b) => (b.all_g || 0) - (a.all_g || 0)
const candidateLine = (idx, r) => `${r.name} (id ${r.id}): head coach ${r.first}–${r.last}, ${record(r.all_w, r.all_l)}, ${plural(r.all_seasons, 'season')}${r.teams?.length ? `, ${r.teams.map((t) => teamName(idx, t)).join(', ')}` : ''}`

async function resolveCoach(input) {
  const idx = await loadIndex()
  const rows = await people()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a coach\'s name or id.')
  const byId = rows.find((r) => r.id === raw)
  if (byId) return byId
  const ranked = rank(rows, raw, longer)
  if (!ranked.length) throw new SavantError(`No men's D1 head coach matches "${raw}". College Basketball Coaching Savant covers every D1 head coach on record in Wikipedia's program histories and ESPN's season coaches. Check the spelling, or search with cbb_search_coaches.`)
  const best = topTier(ranked)
  if (best.length === 1 && ranked[0].score >= 60) return best[0]
  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  throw new SavantError(`${best.length > 1 ? `${best.length} coaches match "${raw}"` : `"${raw}" is not an exact match`}. Call again with one of these ids:\n${list.map((r) => `- ${candidateLine(idx, r)}`).join('\n')}`)
}

export async function searchCoaches({ query, limit = 10 }) {
  const idx = await loadIndex()
  const rows = await people()
  const ranked = rank(rows, query, longer)
  const shown = ranked.slice(0, limit).map(({ row: r }) => ({
    id: r.id, name: r.name, teams: (r.teams || []).map((t) => teamName(idx, t)), first_season: r.first ?? null, last_season: r.last ?? null,
    record_all_time: record(r.all_w, r.all_l), seasons: r.all_seasons ?? null, ncaa_appearances: r.ncaa ?? 0, titles: r.titles ?? 0,
    ranked_career: !!r.eligible, active: !!r.active, url: coachUrl(r.id),
  }))
  const structured = { query, total: ranked.length, count: shown.length, coaches: shown }
  if (!shown.length) return { structured, text: `No men's D1 head coach matches "${query}". Check the spelling or try the last name alone.` }
  return { structured, text: `${ranked.length} coach${ranked.length === 1 ? '' : 'es'} match "${query}"${ranked.length > shown.length ? `, showing ${shown.length}` : ''}:\n${shown.map((c, i) => `${i + 1}. ${c.name} (id ${c.id}): ${c.first_season}–${c.last_season}, ${c.record_all_time}, ${plural(c.seasons, 'season')}${c.teams.length ? `, ${c.teams.join(', ')}` : ''}${c.ncaa_appearances ? `, ${plural(c.ncaa_appearances, 'NCAA appearance')}` : ''}. ${c.url}`).join('\n')}\nThe id is what cbb_get_coach_profile takes.` }
}

// ---- the profile -----------------------------------------------------------------------
const GROUP_OF = { career: null, rotation: ['rotation'], game_management: ['management'], identity: ['offense', 'defense'], development: ['development'], roster_building: ['roster'], tournament: ['tournament'], resources: ['resources'], context: ['context'] }

export function statRows(idx, values, pctMap, poolsMap, keys, careerPool) {
  const out = []
  for (const s of idx.stats) {
    if (keys && !keys.includes(s.group)) continue
    const v = values[s.key]
    if (!v) continue
    const val = Array.isArray(v) ? v[0] : v.v
    const n = Array.isArray(v) ? v[1] : v.n
    if (miss(val)) continue
    const p = Array.isArray(v) ? pctMap?.[s.key] : v.pct
    const pool = Array.isArray(v) ? poolsMap?.[s.key] : v.pool
    out.push({ key: s.key, label: s.label, group: s.group, kind: s.kind === 'good' ? 'how good' : 'how much', value: val, display: showStat(s, val), percentile: p ?? null,
      pool: careerPool || null, pool_size: pool ?? null, sample: n, small_sample: n < (s.thr > 1 ? s.thr : 1), lower_is_better: !!s.lower, since: s.first, what: s.what })
  }
  return out
}
// a value with its unit, as the page prints it (config.U): "1.16 PPP", "No. 49"
function showStat(s, v) {
  if (v == null) return display(s.unit, v)
  if (s.unit === 'rank') return `No. ${Math.round(v)}`
  if (s.unit === 'pctile') return `${ordinal(Math.round(v))} percentile`
  const t = display(s.unit, v)
  return s.u && s.u !== '%' ? `${t} ${s.u}` : t
}
const statLine = (r) => `- ${r.label}: ${r.display} (${r.percentile == null ? 'not ranked' : `${ordinal(r.percentile)} percentile of ${r.pool_size}`}; ${r.kind}${r.lower_is_better ? '; lower is better' : ''}${r.small_sample ? '; small sample' : ''})`

export async function coachProfile({ coach, group = 'all', season }) {
  const idx = await loadIndex()
  const r = await resolveCoach(coach)
  const p = await loadCoach(r.id)
  const notes = []
  const L = [`${p.name}: College Basketball Coaching Savant`, coachUrl(p.id)]
  const at = p.career.all_time
  L.push(`Head coach ${at.first}–${at.last}: ${record(at.w, at.l)} over ${plural(at.seasons, 'season')}; ${plural(at.ncaa, 'NCAA Tournament appearance')} (2002-03 on), ${at.f4} Final Four${at.f4 === 1 ? '' : 's'}, ${plural(at.titles, 'title')}.`)
  const unconf = (p.records || []).filter((x) => !x.confirmed)
  if (unconf.length) say(notes, L, `${plural(unconf.length, 'season')} of his record ${unconf.length === 1 ? 'is' : 'are'} unconfirmed (no season-specific source names him): ${unconf.slice(0, 6).map((x) => `${x.season} ${teamName(idx, x.team)}`).join(', ')}.`)
  const interim = (p.records || []).filter((x) => x.interim)
  if (interim.length) say(notes, L, `Interim seasons: ${interim.map((x) => `${x.season} ${teamName(idx, x.team)}`).join(', ')}.`)
  const out = { coach: { id: p.id, name: p.name, url: coachUrl(p.id) }, group, bio: p.bio, all_time: at, stints: p.stints.map((s) => ({ ...s, team_name: teamName(idx, s.team) })), notes }
  const want = (g) => group === 'all' || group === g
  const sr = season ? p.seasons.find((s) => s.season === season) : (p.seasons.find((s) => s.season === idx.meta.current) || p.seasons[p.seasons.length - 1])
  if (season && !sr) throw new SavantError(`${p.name} has no season ${season} as a D1 head coach with game data. His seasons: ${p.seasons.map((s) => s.season).join(', ') || 'none from 2009-10'}.`)
  if (want('career')) {
    L.push('', 'Career card')
    if (!p.career.eligible) say(notes, L, `His career is not ranked: fewer than ${idx.meta.rules.min_career_seasons} seasons or ${idx.meta.rules.min_career_games} games from ${idx.meta.rules.stats_from}. His seasons carry the numbers.`)
    else {
      say(notes, L, `Career figures are games-weighted over his coach-team-seasons (sums per 30 games for wins above an expectation) and ranked among the ${idx.meta.rules.career_pool} head coaches with ${idx.meta.rules.min_career_seasons}+ seasons and ${idx.meta.rules.min_career_games}+ games from ${idx.meta.rules.stats_from}; each stat names its pool size.`)
      out.career_stats = statRows(idx, p.career.stats, null, null, null, `ranked careers, ${idx.meta.rules.stats_from} on`)
      for (const s of out.career_stats) L.push(statLine(s))
    }
  }
  if (sr) {
    const live = sr.in_progress && !sr.ranked
    const pct = sr.ranked ? sr.pct : (sr.live_pct || {})
    const pools = sr.ranked ? (idx.league[sr.season]?.pools || {}) : (sr.live_pools || {})
    out.season = { season: sr.season, team: sr.team, team_name: teamName(idx, sr.team), g: sr.g, w: sr.w, l: sr.l, ranked: !!sr.ranked, provisional: !!live, url: coachUrl(p.id, sr.season),
      pool: live ? `${sr.season} D1 head coaches with ${idx.meta.rules.min_live_games}+ games, provisional` : `${sr.season} D1 head coaches with ${idx.meta.rules.min_season_games}+ games`, expectation: sr.exp || null }
    L.push('', `${sr.season} ${teamName(idx, sr.team)}: ${record(sr.w, sr.l)} in ${sr.g} games${live ? ' (in progress, ranked provisionally)' : ''}${!sr.ranked && !live ? ' (under the line, not ranked)' : ''}.`)
    if (sr.exp?.exp_net != null) L.push(`Roster model: expected net ${display('sgn1', sr.exp.exp_net)}, ${sr.exp.exp_w?.toFixed?.(1) ?? '—'} expected wins; ${display('sgn1', sr.exp.w_roster)} above the roster. AP context: preseason ${sr.exp.ap_pre ? '#' + sr.exp.ap_pre : 'unranked'}, peak ${sr.exp.ap_peak ? '#' + sr.exp.ap_peak : '—'}, final ${sr.exp.ap_final ? '#' + sr.exp.ap_final : '—'} (never the baseline).`)
    for (const [g, keys] of Object.entries(GROUP_OF)) {
      if (!keys || !want(g)) continue
      const rows = statRows(idx, sr.values || {}, pct, pools, keys)
      out[g] = { stats: rows }
      if (rows.length) { L.push(`${g.replace('_', ' ')}`); for (const s of rows) L.push(statLine(s)) }
    }
    if (want('rotation') && sr.rotation) {
      out.rotation.summary = sr.rotation
      say(notes, L, idx.meta.model_note)
      try {
        const tf = await loadTeam(sr.team, sr.season)
        const e = (tf.coaches || []).find((x) => x.coach === p.id)
        if (e?.rotation) {
          const early = e.rotation.games < (e.rotation.windows_from || 8)
          out.rotation.games = e.rotation.games
          out.rotation.windows_settled = !early
          out.rotation.map = e.rotation.rows.map((x) => ({ id: x.id, name: x.name, gp: x.gp, starts: x.starts, mpg: x.mpg, usual: x.text, off_script: x.off, off_by_choice: x.off_choice, savant_rate: x.rate }))
          if (early) say(notes, L, `The Rotation Map is based on ${e.rotation.games} lineup game${e.rotation.games === 1 ? '' : 's'}. Usual windows from fewer than ${e.rotation.windows_from || 8} games are a guess (about three in five still hold at the season's end), so read who plays when, not his script; last season's map is the better guide for now.`)
          L.push(`Rotation Map, ${sr.season} (${e.rotation.games} lineup games): on script ${display('pct1', 100 * (1 - e.rotation.off_script))}; off script by cause ${Object.entries(e.rotation.by_cause).map(([k, v]) => `${k} ${display('pct1', 100 * v)}`).join(', ')}.`)
          for (const x of out.rotation.map.slice(0, 10)) L.push(`  ${x.name}: ${x.mpg} mpg, ${x.usual}`)
        }
      } catch { /* no lineup file for this season */ }
    } else if (want('rotation') && !sr.rotation) say(notes, L, `No Rotation Map for ${sr.season}: College Savant's lineups begin in 2023-24 and need the games its lineup gate passes.`)
    if (want('roster_building') && sr.roster) out.roster_building.detail = sr.roster
    if (want('tournament') && sr.tournament) out.tournament.detail = sr.tournament
    if (want('resources') && sr.resources) { out.resources.detail = sr.resources; if (sr.resources.nil_era) say(notes, L, 'EADA spending misses NIL and collective money; from 2021-22 it is a weaker read.') }
    if (want('development') && sr.development) out.development.players = sr.development.players.slice(0, 15).map((x) => ({ id: x[0], name: x[1], step: x[2], rate_before: x[3], rate_after: x[4], expected_change: x[5], above_expected: x[6], weight: x[7], arrived: x[8] }))
    if (want('context') && sr.splits) out.context.splits = sr.splits
    if (want('game_management') && sr.management) out.game_management.detail = sr.management
  } else if (group !== 'career' && group !== 'staff' && group !== 'seasons') say(notes, L, 'He has no season with game data (2009-10 on); only his record and lineage are on file.')
  if (want('staff')) {
    out.staff = { lineage: p.lineage, assistant_stints: p.assistant, staffs: p.seasons.filter((s) => s.staff?.length).map((s) => ({ season: s.season, team: teamName(idx, s.team), staff: s.staff.map((a) => a.name), source: s.staff[0].src })) }
    if (p.lineage?.mentor) L.push('', `Suggested mentor (from the record, not a verdict): ${p.lineage.mentor_name}, ${p.lineage.role || ''}${p.lineage.tie ? '; a tie in the record' : ''}.`)
    else L.push('', 'No D1 staff stint on record before his first head job, so no mentor is suggested.')
    if (p.lineage?.kids?.length) L.push(`Head coaches off his staff: ${p.lineage.kids.map((k) => k[1]).join(', ')}.`)
    if (p.bio?.nba) L.push(`Also an NBA head coach: ${SITE}/basketball-coaching-savant.html#c=${p.bio.nba}`)
  }
  if (want('seasons')) out.seasons = p.records.map((x) => ({ season: x.season, team: teamName(idx, x.team), w: x.w, l: x.l, interim: x.interim, confirmed: x.confirmed, ncaa_seed: x.seed ?? null, ncaa_result: x.ncaa ?? null, source: (x.src || [])[0] || null }))
  const sc = sr && sr.season === idx.meta.current && p.scouting_season ? p.scouting_season.lines : p.scouting
  if (sc?.length) { out.scouting = sc.map((x) => x.text); L.push('', 'Scouting report (written by rule, each line with its sample):', ...sc.map((x) => `- ${x.text}`)) }
  out.url = coachUrl(p.id, sr?.season)
  out.data_as_of = asOf(idx)
  out.source = SOURCE
  L.push('', `Source: ${SOURCE}. Data as of ${out.data_as_of}. ${idx.meta.credit}`)
  return { structured: out, text: L.join('\n') }
}

// ---- leaders, tree -----------------------------------------------------------------------
export async function coachingLeaders({ board = 'all', limit = 10 } = {}) {
  const idx = await loadIndex()
  const boards = board === 'all' ? idx.leaders : idx.leaders.filter((b) => b.id === board)
  if (!boards.length) throw new SavantError(`No board "${board}". Boards: ${idx.leaders.map((b) => b.id).join(', ')}.`)
  const out = boards.map((b) => ({ id: b.id, title: b.title, kind: b.kind, season: b.season ?? null, pool: b.pool, note: b.note ?? null,
    rows: b.rows.slice(0, limit).map((r, i) => ({ rank: i + 1, id: r.id ?? null, name: r.name, team: r.team ?? null, value: r.value ?? null, display: r.display })) }))
  const L = out.flatMap((b) => [`${b.title} (${b.pool})${b.note ? ` — ${b.note}` : ''}`, ...b.rows.map((r) => `${r.rank}. ${r.name}${r.team ? ` (${r.team})` : ''}: ${r.display}`), ''])
  return { structured: { board, limit, boards: out, url: `${PAGE}#leaders`, data_as_of: asOf(idx), source: SOURCE }, text: [...L, `Source: ${SOURCE}. Data as of ${asOf(idx)}.`].join('\n') }
}

export async function coachingTree({ coach, depth = 3 } = {}) {
  const idx = await loadIndex()
  const N = idx.tree.nodes
  if (!coach) {
    const size = (id, seen = new Set()) => { if (seen.has(id)) return 0; seen.add(id); return 1 + (N[id]?.kids || []).reduce((a, k) => a + size(k, seen), 0) }
    const trees = idx.tree.roots.map((id) => ({ root: id, name: N[id]?.name, size: size(id), url: coachUrl(id) }))
    return { structured: { trees, note: idx.tree.note, url: `${PAGE}#tree`, data_as_of: asOf(idx), source: SOURCE }, text: [`${trees.length} coaching trees (the biggest first). ${idx.tree.note}`, ...trees.slice(0, 30).map((t) => `- ${t.name}: ${t.size} coaches`), '', `Source: ${SOURCE}. Data as of ${asOf(idx)}.`].join('\n') }
  }
  const r = await resolveCoach(coach)
  const n = N[r.id] || { name: r.name, kids: [] }
  const line = []
  let at = n.mentor, guard = 0
  while (at && N[at] && guard++ < 15) { line.push({ id: at, name: N[at].name }); at = N[at].mentor }
  const branch = []
  const walk = (id, d) => { if (d > depth) return; for (const k of N[id]?.kids || []) { branch.push({ id: k, name: N[k]?.name, generation: d, mentor: id }); walk(k, d + 1) } }
  walk(r.id, 1)
  const L = [`${r.name}'s place in the college coaching tree. ${idx.tree.note}`, n.mentor ? `Mentor: ${N[n.mentor]?.name}${n.tie ? ' (a tie in the record)' : ''}. Line to the root: ${line.map((x) => x.name).join(' ← ')}.` : 'No mentor on record.', branch.length ? `Beneath him (${branch.length} within ${depth} generations): ${branch.map((b) => `${b.name} (gen ${b.generation})`).join(', ')}.` : 'No head coaches off his staff on record.', '', `Source: ${SOURCE}. Data as of ${asOf(idx)}.`]
  return { structured: { coach: { id: r.id, name: r.name, mentor: n.mentor || null, tie: !!n.tie, line, url: coachUrl(r.id) }, depth, branch, note: idx.tree.note, url: `${PAGE}#tree=${r.id}`, data_as_of: asOf(idx), source: SOURCE }, text: L.join('\n') }
}

// ---- system fit: similar players, either way ----------------------------------------------
// The build's math (pipeline/college/coaching/fit.py): RMS distance over the profile tracks both have,
// to the coach's minutes-weighted system at the player's position; the score is the share of all
// current player-coach pairs the pair is closer than (fit.json's quantiles).
export function fitDistance(z, sys) {
  let s = 0, n = 0
  for (let i = 0; i < z.length; i++) { if (z[i] == null || sys[i] == null) continue; s += (z[i] - sys[i]) ** 2; n++ }
  return n ? Math.sqrt(s / n) : null
}
export function fitScore(d, q) {
  if (d == null || !q?.length) return null
  let lo = 0, hi = q.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (q[m] < d) lo = m + 1; else hi = m }
  return Math.round((100 - lo * 100 / (q.length - 1)) * 10) / 10
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export async function coachingFit({ player, coach, limit = 10 } = {}) {
  const idx = await loadIndex()
  const F = await loadFit()
  if (!player && !coach) throw new SavantError('Give a player (College Savant name or ESPN id), a coach, or both.')
  const label = F.label === 'fit score' ? 'fit score' : 'similarity, not a prediction'
  const caveat = F.label === 'fit score' ? '' : `The fit test on ${F.test?.n ?? '—'} transfers did not beat the roster model out of sample (${F.test?.rmse_fit?.toFixed?.(3)} vs ${F.test?.rmse_roster_model?.toFixed?.(3)}), so this is "players like the ones he uses", not a forecast of how a player will do.`
  let pid = null
  if (player) {
    const raw = String(player).trim()
    if (F.players[raw]) pid = raw
    else {
      const q = norm(raw)
      const hits = Object.entries(F.players).filter(([, v]) => norm(v[4]) === q)
      const part = hits.length ? hits : Object.entries(F.players).filter(([, v]) => norm(v[4]).includes(q))
      if (!part.length) throw new SavantError(`No College Basketball Savant player with 200+ minutes in ${Object.values(F.players)[0]?.[2] ?? 'the latest season'} or this season matches "${raw}". Use cbb_search_players for the id.`)
      if (part.length > 1 && !hits.length) throw new SavantError(`"${raw}" matches ${part.length} players: ${part.slice(0, 8).map(([e, v]) => `${v[4]} (id ${e}, ${teamName(idx, v[1])} ${v[2]})`).join('; ')}. Call again with the id.`)
      pid = part[0][0]
    }
  }
  let cid = null, cname = null
  if (coach) { const r = await resolveCoach(coach); cid = r.id; cname = r.name }
  const P = pid ? F.players[pid] : null
  const L = []
  const structured = { label, caveat, features: F.features, data_as_of: asOf(idx), source: SOURCE }
  if (P && cid) {
    const sys = F.systems[cid]?.[P[0]]
    if (!sys) throw new SavantError(`${cname} has no ${P[0].toLowerCase()} system on file (fewer than four players at the position under him since 2009-10).`)
    const d = fitDistance(P[3], sys[0])
    structured.pair = { player: { id: pid, name: P[4], pos: P[0], team: teamName(idx, P[1]), season: P[2], url: cbbPlayerUrl(pid, P[2]) }, coach: { id: cid, name: cname, url: coachUrl(cid) }, distance: d == null ? null : +d.toFixed(4), match: fitScore(d, F.scale), system_players: sys[2], system_minutes: sys[1] }
    L.push(`${P[4]} (${P[0]}, ${teamName(idx, P[1])}, ${P[2]}) against ${cname}'s ${P[0].toLowerCase()} system: match ${structured.pair.match ?? '—'} of 100 (distance ${d?.toFixed(2) ?? '—'}, over ${sys[2]} players he has used there).`)
  } else if (P) {
    const rows = Object.entries(F.systems).filter(([, by]) => by[P[0]]).map(([c, by]) => [c, fitDistance(P[3], by[P[0]][0])]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]).slice(0, limit)
    const names = Object.fromEntries(idx.coaches.map((c) => [c.id, c.name]))
    structured.player = { id: pid, name: P[4], pos: P[0], team: teamName(idx, P[1]), season: P[2], url: cbbPlayerUrl(pid, P[2]) }
    structured.coaches = rows.map(([c, d], i) => ({ rank: i + 1, id: c, name: names[c] || c, match: fitScore(d, F.scale), distance: +d.toFixed(4), url: coachUrl(c) }))
    L.push(`Current D1 head coaches whose systems used players most like ${P[4]} (${P[0]}, ${teamName(idx, P[1])}, ${P[2]}):`, ...structured.coaches.map((c) => `${c.rank}. ${c.name}: match ${c.match}`))
  } else {
    const p = await loadCoach(cid)
    const rows = (p.fits?.rows || []).slice(0, limit)
    structured.coach = { id: cid, name: cname, url: coachUrl(cid) }
    structured.players = rows.map((r, i) => ({ rank: i + 1, id: r.eid, name: r.name, pos: r.pos, team: teamName(idx, r.team), season: r.season, match: r.match, most_like_under_him: (r.like || []).map((l) => ({ id: l[0], name: l[3], season: l[1] })), url: cbbPlayerUrl(r.eid, r.season) }))
    if (!rows.length) L.push(`${cname} has no current system on file (he is not a D1 head coach this season, or has too few players at each position).`)
    else L.push(`Players most like the ones ${cname} uses:`, ...structured.players.map((r) => `${r.rank}. ${r.name} (${r.pos}, ${r.team}, ${r.season}): match ${r.match}${r.most_like_under_him.length ? `; most like ${r.most_like_under_him.map((x) => `${x.name} ${x.season}`).join(', ')}` : ''}`))
  }
  if (caveat) L.push('', caveat)
  L.push(`Source: ${SOURCE}. Data as of ${asOf(idx)}.`)
  return { structured, text: L.join('\n') }
}

// ---- the Data Room -----------------------------------------------------------------------
export async function coachingData({ table, season, filters = [], columns, limit = 100, offset = 0 } = {}) {
  const idx = await loadIndex()
  if (!TABLES.includes(table)) throw new SavantError(`Pick a table: ${TABLES.join(', ')}.`)
  if (table !== 'programs' && !/^\d{4}-\d{2}$/.test(season || '')) throw new SavantError('Give the season as YYYY-YY, e.g. 2025-26.')
  let file
  try { file = await loadTable(table, season) } catch { throw new SavantError(`No ${table} table for ${season}. games and decisions run 2013-14 on, roster_moves 2009-10 on, stints, units and rotation 2023-24 on (the lineup seasons); programs is one table for every season.`) }
  const cols = file.cols
  const want = columns && columns.length ? columns : cols
  const idxs = want.map((c) => { const i = cols.indexOf(c); if (i < 0) throw new SavantError(`No column "${c}" in ${table}. Columns: ${cols.join(', ')}.`); return i })
  const all = file.rows.filter((r) => matches(r, cols, filters))
  const lim = Math.min(MAX_ROWS, Math.max(1, limit))
  const page = all.slice(offset, offset + lim).map((r) => idxs.map((i) => r[i]))
  const dict = await loadDict()
  const structured = { table, season: season || null, columns: want, rows: page, total_matching: all.length, offset, limit: lim, next_offset: offset + lim < all.length ? offset + lim : null, definition: dict.tables[table]?.note || '', data_as_of: file.through ? day(file.through) : asOf(idx), source: SOURCE }
  const text = [`${table}${season ? ' ' + season : ''}: ${all.length} rows match${filters.length ? ' the filters' : ''}; rows ${offset + 1}–${offset + page.length}${structured.next_offset != null ? ` (next offset ${structured.next_offset})` : ''}. Columns: ${want.join(', ')}.`, structured.definition, '', ...page.slice(0, 50).map((r) => JSON.stringify(r)), page.length > 50 ? `… ${page.length - 50} more rows in the structured result` : '', '', `Source: ${SOURCE}. Data as of ${structured.data_as_of}. Only WCE-computed numbers: no CollegeBasketballData row is served raw.`].filter((x) => x !== '').join('\n')
  return { structured, text }
}

export async function coachingDictionary({ table } = {}) {
  const idx = await loadIndex()
  const dict = await loadDict()
  if (table && !dict.tables[table]) throw new SavantError(`No table "${table}". Tables: ${Object.keys(dict.tables).join(', ')}.`)
  const tables = table ? { [table]: dict.tables[table] } : dict.tables
  const stats = dict.stats.map((s) => ({ key: s.key, label: s.label, group: s.group, kind: s.kind === 'good' ? 'how good' : 'how much', unit: s.unit, lower_is_better: !!s.lower, settle_point: s.thr, since: s.first, what: s.what, formula: s.formula, source: s.source, sample: s.sample }))
  const L = ['College Basketball Coaching Savant data dictionary.', '', 'Tables (cbb_coaching_data):', ...Object.entries(tables).map(([k, v]) => `- ${k}: ${v.note} Columns: ${v.cols.join(', ')}.`), '', `Stats on the coach pages (${stats.length}):`, ...(table ? [] : stats.map((s) => `- ${s.key} (${s.label}; ${s.kind}; ${s.unit}${s.lower_is_better ? '; lower is better' : ''}; from ${s.since}; settles at ${s.settle_point}): ${s.what} Formula: ${s.formula}`)), '', dict.pools, idx.meta.model_note, `Source: ${SOURCE}. Data as of ${asOf(idx)}.`]
  return { structured: { tables, stats: table ? [] : stats, fits: idx.meta.fits, rules: idx.meta.rules, first_seasons: idx.meta.first_seasons, note: idx.meta.model_note, credit: idx.meta.credit, data_as_of: asOf(idx), source: SOURCE }, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------
const filterShape = z.object({ column: z.string(), op: z.enum(['eq', 'ne', 'in', 'gte', 'lte', 'gt', 'lt', 'contains', 'null', 'notnull']), value: z.any().optional() })
const loose = z.object({}).passthrough()

export const tools = [
  {
    name: 'cbb_search_coaches',
    config: {
      title: 'Search men\'s college basketball coaches',
      description: 'Find men\'s D1 head coaches in College Basketball Coaching Savant (wcehoops.com) by name: id, record, seasons, schools, NCAA appearances and page link. Tolerates accents and small typos.',
      inputSchema: { query: z.string().trim().min(2).max(80).describe('Coach name or part of one, e.g. "Scheyer", "Tom Izzo".'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return.') },
      outputSchema: { query: z.string(), total: z.number().int(), count: z.number().int(), coaches: z.array(loose) },
      annotations: { title: 'Search men\'s college basketball coaches', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchCoaches({ query, limit }),
  },
  {
    name: 'cbb_get_coach_profile',
    config: {
      title: 'Get a college coach\'s Savant profile',
      description: 'One men\'s D1 head coach in College Basketball Coaching Savant (wcehoops.com): record (unconfirmed and interim rows tagged); wins above the roster model, AP context and the market; the ranked career card and a season\'s card, each stat with its percentile and pool; Rotation Map (2023-24 on); game management; identity; development; roster building and the portal; NCAA Tournament vs seed and odds; spending (EADA); splits; staff and mentor; scouting report.',
      inputSchema: { coach: z.string().trim().min(1).max(80).describe('Coach name or id.'), group: z.enum(GROUPS).default('all').describe('Which part to return.'), season: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('A season (default: the current one, else his latest).') },
      outputSchema: { coach: loose, group: z.string(), bio: loose, all_time: loose, stints: z.array(loose), notes: z.array(z.string()), career_stats: z.array(loose).optional(), season: loose.optional(),
        rotation: loose.optional(), game_management: loose.optional(), identity: loose.optional(), development: loose.optional(), roster_building: loose.optional(), tournament: loose.optional(),
        resources: loose.optional(), context: loose.optional(), staff: loose.optional(), seasons: z.array(loose).optional(), scouting: z.array(z.string()).optional(), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get a college coach\'s Savant profile', ...READ_ONLY },
    },
    run: ({ coach, group, season }) => coachProfile({ coach, group, season }),
  },
  {
    name: 'cbb_coaching_leaders',
    config: {
      title: 'Get College Basketball Coaching Savant\'s Leaders boards',
      description: 'The Leaders boards of College Basketball Coaching Savant (wcehoops.com): beat the roster model, best developers, portal hit rate, March vs expectation, did more with less, wins above resources, rising assistants (context, not credit), and this season\'s. Each names its pool.',
      inputSchema: { board: z.string().default('all').describe('A board id, or "all".'), limit: z.number().int().min(1).max(50).default(10).describe('Rows per board.') },
      outputSchema: { board: z.string(), limit: z.number().int(), boards: z.array(loose), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get College Basketball Coaching Savant\'s Leaders boards', ...READ_ONLY },
    },
    run: ({ board, limit }) => coachingLeaders({ board, limit }),
  },
  {
    name: 'cbb_coaching_tree',
    config: {
      title: 'Get the college coaching tree',
      description: 'The men\'s D1 coaching tree (wcehoops.com): each coach\'s mentor suggested from Wikipedia\'s staffs (the D1 head coach he served under most before his first head job), ties flagged. With a coach: mentor, line to the root, everyone beneath him. Without one: every tree and its size.',
      inputSchema: { coach: z.string().trim().min(1).max(80).optional().describe('A coach name or id; omit for every tree.'), depth: z.number().int().min(1).max(10).default(3).describe('Generations beneath him.') },
      outputSchema: { coach: loose.nullable().optional(), depth: z.number().int().optional(), branch: z.array(loose).optional(), trees: z.array(loose).optional(), note: z.string(), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get the college coaching tree', ...READ_ONLY },
    },
    run: ({ coach, depth }) => coachingTree({ coach, depth }),
  },
  {
    name: 'cbb_coaching_fit',
    config: {
      title: 'Match college players and coaches\' systems',
      description: 'College Basketball Coaching Savant (wcehoops.com): how a College Basketball Savant player\'s profile (usage, shot diet, rebounding, free throws, turnovers, tempo) matches a coach\'s system at his position. Give a player for his closest current coaches, a coach for the players most like the ones he uses, or both for one match (0-100). Labelled as similarity: the out-of-sample test on transfers did not earn a fit score.',
      inputSchema: { player: z.string().trim().min(1).max(80).optional().describe('Player name or ESPN id.'), coach: z.string().trim().min(1).max(80).optional().describe('Coach name or id.'), limit: z.number().int().min(1).max(30).default(10).describe('Rows to return.') },
      outputSchema: { label: z.string(), caveat: z.string(), features: z.array(z.string()), pair: loose.optional(), player: loose.optional(), coaches: z.array(loose).optional(), coach: loose.optional(), players: z.array(loose).optional(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Match college players and coaches\' systems', ...READ_ONLY },
    },
    run: (args) => coachingFit(args),
  },
  {
    name: 'cbb_coaching_data',
    config: {
      title: 'Pull rows from the College Basketball Coaching Savant Data Room',
      description: 'The Data Room behind College Basketball Coaching Savant (wcehoops.com): rows for your own analysis. Tables: games and decisions (2013-14 on), stints, units and rotation (2023-24 on), roster_moves (2009-10 on), programs (every season). Filter on any column, pick columns, page (500 rows a call). WCE-computed rows only. Read cbb_coaching_dictionary first.',
      inputSchema: { table: z.enum(TABLES).describe('Which table.'), season: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('e.g. 2025-26 (not needed for programs).'), filters: z.array(filterShape).max(12).default([]).describe('{column, op, value}; ops eq, ne, in, gte, lte, gt, lt, contains, null, notnull.'), columns: z.array(z.string()).max(40).optional().describe('Columns to return.'), limit: z.number().int().min(1).max(MAX_ROWS).default(100).describe('Rows per call.'), offset: z.number().int().min(0).default(0).describe('Row to start at.') },
      outputSchema: { table: z.string(), season: z.string().nullable(), columns: z.array(z.string()), rows: z.array(z.array(z.any())), total_matching: z.number().int(), offset: z.number().int(), limit: z.number().int(), next_offset: z.number().int().nullable(), definition: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Pull rows from the College Basketball Coaching Savant Data Room', ...READ_ONLY },
    },
    run: (args) => coachingData(args),
  },
  {
    name: 'cbb_coaching_dictionary',
    config: {
      title: 'Get the College Basketball Coaching Savant data dictionary',
      description: 'Every Data Room column and every coach-page stat defined (what, formula, unit, direction, settle point, source, first season), plus the fits behind the build and each module\'s first season. Read before cbb_coaching_data.',
      inputSchema: { table: z.enum(TABLES).optional().describe('One table only.') },
      outputSchema: { tables: loose, stats: z.array(loose), fits: loose, rules: loose, first_seasons: loose, note: z.string(), credit: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get the College Basketball Coaching Savant data dictionary', ...READ_ONLY },
    },
    run: ({ table }) => coachingDictionary({ table }),
  },
]
