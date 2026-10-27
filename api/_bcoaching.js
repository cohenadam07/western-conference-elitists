// api/_bcoaching.js — Basketball Coaching Savant, as answers. One section of the AI connector
// (api/mcp.js): it knows NBA coaches, the connector only speaks the protocol.
//
// It reads the page's own files under /bcs/ (pipeline/basketball/coaching/build.py writes them):
//   index.json          every coach, the Leaders boards, the tree, league trends, the stat registry
//   c/<coach>.json      one coach's page: bio, records, seasons, the ranked career card, lineage
//   t/<team>-<season>.json   a team-season: the Rotation Map, pairs, units, minutes vs impact
//   data/<table>/<season>.json   the Data Room (games, stints, units, rotation, decisions)
//   data/dictionary.json         every column, defined
// Every percentile is already in those files with its pool, so an answer from here is the
// number on the coach's page. Loading, caching and name matching are shared (api/_core.js).
//
// What an answer always says: which pool a percentile is from; when a coach or a season is too
// short to rank; when a stat has no value (never a zero); that the rotation verdicts are the
// model's view; that the lineage is suggested from the record and where it was set by hand;
// where the page is (basketball-coaching-savant.html#c=<id>).
//
// The Data Room (nba_coaching_data) hands over rows, not conclusions, so an assistant can run its
// own splits and regressions: pick a table, a season, filters on any column, the columns wanted,
// and page through. nba_coaching_dictionary returns the definitions alone, to plan a pull.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, ordinal, prepare, rank, topTier } from './_core.js'

const files = makeLoader('bcs', { what: 'Basketball Coaching Savant', shape: (b) => b && typeof b === 'object' && (b.meta || b.id || b.table || b.stats || b.coaches) })
const SOURCE = 'Basketball Coaching Savant, Western Conference Elitists (wcehoops.com)'
export const GROUPS = ['all', 'career', 'rotation', 'game_management', 'identity', 'context', 'development', 'staff', 'seasons', 'lineage']
export const TABLES = ['games', 'stints', 'units', 'rotation', 'decisions']
const MAX_ROWS = 500

const loadIndex = () => files.load('index.json')
const loadCoach = (id) => files.load(`c/${encodeURIComponent(id)}.json`)
const loadTeam = (team, season) => files.load(`t/${team}-${season}.json`)
const loadTable = (table, season) => files.load(`data/${table}/${season}.json`)
const loadDict = () => files.load('data/dictionary.json')

export const coachUrl = (id) => `${SITE}/basketball-coaching-savant.html#c=${encodeURIComponent(id)}`
const PAGE = `${SITE}/basketball-coaching-savant.html`

export function display(unit, v) {
  if (miss(v)) return '—'
  v = +v
  const sgn = (dp) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp)
  switch (unit) {
    case 'pct1': return v.toFixed(1) + '%'
    case 'num0': return String(Math.round(v))
    case 'num1': return v.toFixed(1)
    case 'num2': return v.toFixed(2)
    case 'sgn1': return sgn(1)
    case 'sgn2': return sgn(2)
    default: return String(v)
  }
}
const record = (w, l) => `${w}–${l}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
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
const candidateLine = (r) => `${r.name} (id ${r.id}): ${r.hc ? `head coach ${r.first}–${r.last}, ${record(r.all_w, r.all_l)}, ${plural(r.all_seasons, 'season')}` : 'assistant'}${r.teams && r.teams.length ? `, ${r.teams.join(', ')}` : ''}`

async function resolveCoach(input) {
  const rows = await people()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a coach\'s name or id.')
  const byId = rows.find((r) => r.id === raw)
  if (byId) return byId
  const ranked = rank(rows, raw, longer)
  if (!ranked.length) throw new SavantError(`No NBA coach matches "${raw}". Basketball Coaching Savant covers every head coach since 1946-47 and the assistants in its staff tables. Check the spelling, or search with nba_search_coaches.`)
  const best = topTier(ranked)
  if (best.length === 1 && ranked[0].score >= 60) return best[0]
  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  throw new SavantError(`${best.length > 1 ? `${best.length} coaches match "${raw}"` : `"${raw}" is not an exact match`}. Call again with one of these ids:\n${list.map((r) => `- ${candidateLine(r)}`).join('\n')}`)
}

export async function searchCoaches({ query, limit = 10 }) {
  const rows = await people()
  const ranked = rank(rows, query, longer)
  const shown = ranked.slice(0, limit).map(({ row: r }) => ({
    id: r.id, name: r.name, head_coach: !!r.hc, assistant: !!r.assistant, teams: r.teams || [], first_season: r.first ?? null, last_season: r.last ?? null,
    record_all_time: r.hc ? record(r.all_w, r.all_l) : null, seasons: r.all_seasons ?? null, games_since_1996: r.g ?? 0, ranked_career: !!r.eligible, active: !!r.active, url: coachUrl(r.id),
  }))
  const structured = { query, total: ranked.length, count: shown.length, coaches: shown }
  if (!shown.length) return { structured, text: `No NBA coach in Basketball Coaching Savant matches "${query}". It covers every head coach since 1946-47 and the assistants in the NBA's staff tables. Check the spelling or try the last name alone.` }
  return { structured, text: `${ranked.length} coach${ranked.length === 1 ? '' : 'es'} match "${query}"${ranked.length > shown.length ? `, showing ${shown.length}` : ''}:\n${shown.map((c, i) => `${i + 1}. ${c.name} (id ${c.id}): ${c.head_coach ? `head coach ${c.first_season}–${c.last_season}, ${c.record_all_time}, ${plural(c.seasons, 'season')}` : 'assistant'}${c.teams.length ? `, ${c.teams.join(', ')}` : ''}. ${c.url}`).join('\n')}\nThe id is what nba_get_coach_profile takes.` }
}

// ---- the profile -----------------------------------------------------------------------
function careerBlock(idx, p, notes) {
  const L = ['Career profile']
  const stats = []
  if (!p.career.eligible) {
    say(notes, L, `Career stats are not ranked for him: fewer than ${idx.meta.rules.min_career_seasons} seasons or ${idx.meta.rules.min_career_games} games as a head coach since 1996-97. His seasons carry the numbers.`)
    return { stats, lines: L }
  }
  say(notes, L, `Career figures are games-weighted over his coach-team-seasons since 1996-97 and ranked among head coaches with ${idx.meta.rules.min_career_seasons}+ seasons and ${idx.meta.rules.min_career_games}+ games inside each stat's own window; each stat gives its pool. A "how good" stat is better at a higher percentile (lower-is-better stats are already flipped); a "how much" stat is a tendency: higher means more of it, not better. A sample under the stat's settle point is flagged.`)
  for (const g of idx.groups) {
    const rows = idx.stats.filter((s) => s.group === g && p.career.stats[s.key])
    if (!rows.length) continue
    L.push(`${idx.group_labels[g]}`)
    for (const s of rows) {
      const v = p.career.stats[s.key]
      const row = { key: s.key, label: s.label, group: g, kind: s.kind === 'good' ? 'how good' : 'how much', value: v.v, display: display(s.unit, v.v), percentile: v.pct ?? null, pool: `head coaches with ${idx.meta.rules.min_career_seasons}+ seasons and ${idx.meta.rules.min_career_games}+ games, ${s.first} on`, pool_size: v.pool ?? null, sample: v.n, seasons_covered: v.seasons, small_sample: v.n < s.thr, lower_is_better: !!s.lower, since: s.first, what: s.what }
      stats.push(row)
      L.push(`- ${s.label}: ${row.display} (${row.percentile == null ? 'not ranked' : `${ordinal(row.percentile)} percentile of ${row.pool_size}`}; ${row.kind}${s.lower ? '; lower is better' : ''}${row.small_sample ? '; small sample' : ''}; ${row.seasons_covered} season${row.seasons_covered === 1 ? '' : 's'})`)
    }
  }
  return { stats, lines: L }
}

function seasonLines(idx, p, full) {
  const L = ['Season by season, newest first']
  const rows = []
  for (const s of p.seasons.slice().reverse()) {
    const e = s.exp || {}, r = s.rotation || {}, m = s.management || {}
    rows.push({ season: s.season, team: s.team, games: s.g, wins: s.w, losses: s.l, playoff_record: s.pg ? record(s.pw, s.pl) : null, playoff_rounds: s.rounds, title: !!s.title, in_progress: !!s.in_progress, ranked: !!s.ranked,
      net_rating: s.net, talent_expected_wins_per_82: e.exp_w82 ?? null, wins_above_talent_per_82: e.w_talent ?? null, preseason_win_total: e.market_total ?? null, wins_above_market_per_82: e.w_market ?? null, wins_above_spread: e.w_spread ?? null,
      on_script_pct: r.off_script != null ? +(100 * (1 - r.off_script)).toFixed(1) : null, chosen_deviation_pct: r.by_cause?.choice != null ? +(100 * r.by_cause.choice).toFixed(1) : null, depth_10min: r.shape?.depth10 ?? null,
      timeouts_per_game: m.to_g ?? null, ato_ppp: m.ato_own ?? null, challenge_success: m.ch_success != null ? +(100 * m.ch_success).toFixed(1) : null, pace: s.identity?.pace ?? s.nba?.stats?.pace ?? null, season_percentiles: full ? s.pct : undefined,
      staff: (s.staff || []).map((a) => a.name) })
    const bits = [`${s.season} ${s.team} ${record(s.w, s.l)}${s.in_progress ? ' (in progress)' : ''}`]
    if (s.pg) bits.push(`playoffs ${record(s.pw, s.pl)}${s.title ? ', won the title' : ''}`)
    bits.push(`net ${display('sgn1', s.net)}`)
    if (e.w_talent != null) bits.push(`vs talent ${display('sgn1', e.w_talent)}/82`)
    if (e.w_market != null) bits.push(`vs market ${display('sgn1', e.w_market)}/82`)
    if (r.off_script != null) bits.push(`on script ${(100 * (1 - r.off_script)).toFixed(0)}%${s.pct?.stability ? ` (${ordinal(s.pct.stability)} of the season)` : ''}`)
    if (full) {
      if (m.to_g != null) bits.push(`${m.to_g} timeouts/g`, `ATO ${display('num2', m.ato_own)}`)
      if (m.ch_success != null) bits.push(`challenges ${(100 * m.ch_success).toFixed(0)}%`)
    }
    L.push(bits.join(' · '))
  }
  L.push(`Percentiles in a season are among that season's coaches with ${idx.meta.rules.min_season_games}+ games. "vs talent" and "vs market" are per 82 games.`)
  return { rows, lines: L }
}

async function rotationBlock(idx, p, season, notes) {
  const srow = (season ? p.seasons.find((s) => s.season === season) : p.seasons.slice().reverse().find((s) => s.rotation)) || null
  const L = ['The Rotation Map']
  if (!srow || !srow.rotation) { L.push(season ? `No play-by-play season ${season} for him (the rotation data begins in 2002-03).` : 'No play-by-play seasons for him (the rotation data begins in 2002-03).'); return { structured: null, lines: L } }
  const file = await loadTeam(srow.team, srow.season)
  const entry = (file.coaches || []).find((e) => e.coach === p.id)
  if (!entry) { L.push(`The ${srow.season} ${srow.team} file has no entry for him.`); return { structured: null, lines: L } }
  const t = { ...entry, names: file.names }
  const r = srow.rotation, bc = r.by_cause || {}
  say(notes, L, idx.meta.model_note)
  L.push(`${srow.season} ${srow.team}, ${r.games} games: ${(100 * (1 - r.off_script)).toFixed(1)}% of scripted player-minutes went to script${srow.pct?.stability ? ` (${ordinal(srow.pct.stability)} percentile of the season)` : ''}. Off script by cause: absence ${(100 * (bc.absence || 0)).toFixed(1)}%, blowout ${(100 * (bc.blowout || 0)).toFixed(1)}%, foul trouble ${(100 * (bc.foul || 0)).toFixed(1)}%, choice ${(100 * (bc.choice || 0)).toFixed(1)}%.`)
  if (r.after_loss != null && r.after_win != null) L.push(`After a loss the rotation ran ${display('sgn1', 100 * (r.after_loss - r.after_win))} points more off script than after a win.`)
  if (r.hot?.n) L.push(`Hot hand: ${display('sgn1', r.hot.extra_q4)} fourth-quarter minutes against his usual windows on ${r.hot.n} nights a man was 8+ over his average through three (a tendency).`)
  const sh = r.shape || {}
  L.push(`Shape: ${sh.depth10} men at 10+ minutes a game, top five ${(100 * sh.top5).toFixed(0)}% of minutes, starters ${sh.starters_min} minutes between them, first substitution at ${sh.first_sub != null ? (sh.first_sub / 60).toFixed(1) : '—'} minutes, stints ${sh.spell} minutes, ${sh.all_bench} all-bench minutes a game.`)
  const cl = t.rotation.closing || {}
  if (cl.gap_n) L.push(`Closing: in ${cl.gap_n} close games the five on the floor at the end sat ${cl.gap} points per 100 of Σ BPM below the best five available; ${cl.near} of those had four or more of the best five.`)
  const windows = t.rotation.rows.map((x) => ({ id: x.id, name: x.name, games: x.gp, starts: x.starts, mpg: x.mpg, usual: x.text, windows: x.windows, on_share_by_minute: x.played, bpm: x.bpm }))
  L.push('Usual windows (60%+ of the games he played, minutes still in the balance):')
  for (const w of windows.slice(0, 10)) L.push(`- ${w.name} (${w.mpg} mpg, ${w.games} g): ${w.usual}`)
  const structured = { season: srow.season, team: srow.team, games: r.games, on_script_pct: +(100 * (1 - r.off_script)).toFixed(1), season_percentile: srow.pct?.stability ?? null, off_script_by_cause: { absence: bc.absence, blowout: bc.blowout, foul_trouble: bc.foul, choice: bc.choice }, after_loss_minus_after_win: r.after_loss != null && r.after_win != null ? +(100 * (r.after_loss - r.after_win)).toFixed(1) : null, hot_hand: r.hot, shape: sh, closing: cl, players: windows,
    games_detail: t.rotation.game_rows.map((g) => ({ gid: g.gid, date: g.date, opp: g.opp, home: g.home, margin: g.margin, off_script_share: g.share, causes: Object.fromEntries(['absence', 'blowout', 'foul_trouble', 'choice'].map((c, i) => [c, g.causes[i]])), scripted_player_minutes: g.scripted, garbage_time: g.garbage, overtime: g.ot })),
    pairs_top: t.matrix.slice(0, 12).map(([a, b, min, est, adj, poss]) => ({ a: t.names[String(a)] || a, b: t.names[String(b)] || b, minutes: min, net_sample_adjusted: est, net_luck_adjusted: adj, possessions: poss })),
    units_top: t.units5.slice(0, 8).map((u) => ({ players: u.ids.map((i) => t.names[String(i)] || i), minutes: u.min, possessions: u.poss, net: u.net, luck_adjusted: u.adj, sample_adjusted: u.est, projected_from_parts: u.proj ?? null, sum_bpm: u.sum_bpm })),
    left_on_table_gap: r.left_table ?? null, overplayed_minutes: r.overplay ?? null, page: `${coachUrl(p.id)}&season=${srow.season}` }
  if (t.units5.length) L.push(`Lineups: ${t.units5.length} five-man units with 25+ minutes. Most used: ${t.units5[0].ids.map((i) => t.names[String(i)] || i).join(', ')} (${t.units5[0].min} min, net ${display('sgn1', t.units5[0].adj)} luck-adjusted, projected ${display('sgn1', t.units5[0].proj)} from the parts). Minutes-weighted gap to his best used arrangement: ${r.left_table ?? '—'} per 100 (lower is better).`)
  return { structured, lines: L }
}

function managementBlock(idx, p) {
  const S = p.seasons.filter((s) => s.management)
  const L = ['Game management (2002-03 on; challenges 2019-20 on)']
  if (!S.length) { L.push('No play-by-play seasons for him.'); return { structured: null, lines: L } }
  const keys = ['to_g', 'to_run', 'unused', 'run_stop', 'ato', 'ato_vs', 'ato_late', 'ato_d', 'halftime', 'ch_g', 'ch_success', 'ch_q4', 'foul_up3', 'two41', 'eoq', 'chase', 'adv_to', 'clutch_net']
  const stats = []
  for (const k of keys) {
    const s = idx.stats.find((x) => x.key === k), v = p.career.stats[k]
    if (!s || !v) continue
    stats.push({ key: k, label: s.label, value: v.v, display: display(s.unit, v.v), percentile: v.pct ?? null, pool_size: v.pool ?? null, sample: v.n, small_sample: v.n < s.thr, lower_is_better: !!s.lower, what: s.what })
    L.push(`- ${s.label}: ${display(s.unit, v.v)}${v.pct != null ? ` (${ordinal(v.pct)} of ${v.pool})` : ' (not ranked)'}${v.n < s.thr ? ', small sample' : ''}`)
  }
  const ch = S.reduce((a, s) => { for (const [k, v] of Object.entries(s.management.challenges || {})) a[k] = (a[k] || 0) + v; return a }, {})
  if (ch.n) L.push(`Challenges: ${ch.n} in all, ${ch.overturned || 0} overturned, ${ch.supported || 0} upheld, ${ch.stands || 0} stood; ${ch.q4 || 0} in the fourth or overtime; ${ch.to_lost || 0} cost a timeout.`)
  return { structured: { stats, challenges: ch.n ? ch : null }, lines: L }
}

function identityBlock(idx, p) {
  const L = ['Identity (offense and defense)']
  const stats = []
  for (const g of ['offense', 'defense']) {
    for (const s of idx.stats.filter((x) => x.group === g)) {
      const v = p.career.stats[s.key]; if (!v) continue
      stats.push({ key: s.key, label: s.label, group: g, value: v.v, display: display(s.unit, v.v), percentile: v.pct ?? null, pool_size: v.pool ?? null, kind: s.kind === 'good' ? 'how good' : 'how much', since: s.first })
    }
  }
  if (!stats.length) { L.push('No identity stats for him (none of his seasons has them).'); return { structured: null, lines: L } }
  for (const s of stats) L.push(`- ${s.label}: ${s.display}${s.percentile != null ? ` (${ordinal(s.percentile)} of ${s.pool_size}, ${s.kind})` : ''}`)
  const fp = p.fingerprint ? Object.entries(p.fingerprint).map(([k, v]) => ({ key: k, label: idx.stats.find((s) => s.key === k)?.label || k, percentile: v })) : []
  const comps = (p.comps || []).map(([id, d, closer, name]) => ({ id, name, closer_than_pct_of_pairs: closer }))
  if (comps.length) L.push(`Coaches most like him on the fingerprint (tendencies only): ${comps.map((c) => `${c.name} (closer than ${c.closer_than_pct_of_pairs}% of pairs)`).join(', ')}.`)
  const arrivals = (p.arrivals || []).map((a) => ({ team: a.team, before: a.before_season, first: a.first_season, after: a.after_season, changes: a.rows }))
  for (const a of arrivals) L.push(`Arrival at ${a.team}: ${a.before || '—'} → ${a.first} → ${a.after || 'still there'}: net ${(a.changes.net || []).map((v) => display('sgn1', v)).join(' → ')}, pace ${(a.changes.pace || []).map((v) => display('num1', v)).join(' → ')}, 3PA rate ${(a.changes.fg3r || []).map((v) => display('pct1', v)).join(' → ')} (team-season figures, whoever coached).`)
  return { structured: { stats, fingerprint: fp, comps, arrivals }, lines: L }
}

function contextBlock(idx, p) {
  const S = p.seasons.filter((s) => s.splits && s.g >= 20)
  const L = ['Situation by situation (net rating in each bucket minus his net that season, games-weighted over his career)']
  if (!S.length) { L.push('Too few games for splits.'); return { structured: null, lines: L } }
  const agg = {}
  for (const s of S) for (const [split, buckets] of Object.entries(s.splits)) {
    if (!buckets || typeof buckets !== 'object' || ['tempo', 'market_n', 'wp', 'officials', 'fouls'].includes(split)) continue
    for (const [b, v] of Object.entries(buckets)) {
      if (!v || v.net == null || s.net == null) continue
      const x = ((agg[split] = agg[split] || {})[b] = agg[split][b] || { g: 0, w: 0, gap: 0, lg: 0 })
      x.g += v.g; x.w += v.w; x.gap += (v.net - s.net) * v.g; const lg = idx.league?.[s.season]?.split_gaps?.[split]?.[b]; if (lg != null) x.lg += lg * v.g
    }
  }
  const out = {}
  for (const [split, buckets] of Object.entries(agg)) {
    out[split] = Object.fromEntries(Object.entries(buckets).map(([b, x]) => [b, { games: x.g, record: record(x.w, x.g - x.w), net_gap: +(x.gap / x.g).toFixed(2), league_typical_gap: +(x.lg / x.g).toFixed(2) }]))
    L.push(`- ${split}: ${Object.entries(out[split]).map(([b, v]) => `${b} ${v.record}, ${display('sgn1', v.net_gap)} (league ${display('sgn1', v.league_typical_gap)})`).join('; ')}`)
  }
  const tc = S.filter((s) => s.splits.tempo?.toward_own != null)
  const tempo = tc.length ? tc.reduce((a, s) => a + s.splits.tempo.toward_own * s.splits.tempo.n, 0) / tc.reduce((a, s) => a + s.splits.tempo.n, 0) : null
  if (tempo != null) L.push(`Tempo control: the game's pace sat ${(100 * tempo).toFixed(0)}% of the way from the opponent's usual pace to his.`)
  return { structured: { splits: out, tempo_control: tempo }, lines: L }
}

function developmentBlock(idx, p) {
  const L = ['Players under him (1997-98 on)']
  const a = p.career.stats.aging, y = p.career.stats.aging_young
  if (!a) { L.push('No development figure: too few players with 500 minutes in consecutive seasons.'); return { structured: null, lines: L } }
  L.push(`Beats the aging curve: ${display('sgn1', a.v)} percentile points of position-adjusted BPM per player-season against age expectation${a.pct != null ? ` (${ordinal(a.pct)} of ${a.pool})` : ''}, ${Math.round(a.n).toLocaleString()} weighted minutes.${y ? ` Players 24 and under: ${display('sgn1', y.v)}${y.pct != null ? ` (${ordinal(y.pct)} of ${y.pool})` : ''}.` : ''} Selection, the team's development staff and regression to the mean all live in this number.`)
  const rows = p.seasons.flatMap((s) => (s.development?.players || []).map((r) => ({ season: s.season, player_id: r[0], age: r[1], bpm_before: r[2], bpm_after: r[3], expected_change: r[4], weight_minutes: r[5] }))).sort((x, z) => (z.bpm_after - z.bpm_before - z.expected_change) - (x.bpm_after - x.bpm_before - x.expected_change))
  const mv = p.seasons.filter((s) => s.mvi)
  const youth = mv.length ? mv.reduce((s_, s) => s_ + s.mvi.young_min_share * s.g, 0) / mv.reduce((s_, s) => s_ + s.g, 0) : null
  if (youth != null) L.push(`Minutes to players 23 and under: ${(100 * youth).toFixed(1)}% of his teams' minutes.`)
  return { structured: { aging: a, aging_young: y || null, young_minutes_share: youth, players: rows.slice(0, 15) }, lines: L }
}

function staffBlock(idx, p, notes) {
  const L = ['Staff and lineage']
  const Lg = p.lineage || {}
  say(notes, L, idx.tree.note)
  if (Lg.mentor) L.push(`Suggested mentor: ${Lg.mentor_name} (${Lg.role})${Lg.override ? ', set by hand' : ', from the record'}${Lg.tie ? '; a tie in the record' : ''}${Lg.unconfirmed ? '; UNCONFIRMED' : ''}${Lg.mentor_closer_than != null ? `; on style, closer than ${Lg.mentor_closer_than}% of pairs` : ''}.`)
  else L.push('No NBA assistant stint on record, so no mentor is suggested.')
  if (Lg.also?.length) L.push(`Also served under: ${Lg.also.map((a) => `${a[1]} (${a[2]})`).join(', ')}.`)
  if (Lg.kids?.length) L.push(`Head coaches off his staff: ${Lg.kids.map((k) => k[1]).join(', ')}.`)
  const staffs = p.seasons.filter((s) => s.staff && s.staff.length).map((s) => ({ season: s.season, team: s.team, assistants: s.staff.map((a) => ({ name: a.name, id: a.id, role: a.role, sources: a.src })) }))
  for (const s of staffs.slice().reverse().slice(0, 6)) L.push(`${s.season} ${s.team} staff: ${s.assistants.map((a) => a.name).join(', ')}.`)
  if (staffs.length > 6) L.push(`(${staffs.length - 6} more staffs in the structured result.)`)
  if (p.assistant?.length) L.push(`His own stints as an assistant: ${p.assistant.map((a) => `${a.season} ${a.team}${a.role && a.role !== 'Assistant Coach' ? ` (${a.role})` : ''}`).join(', ')}.`)
  return { structured: { mentor: Lg.mentor ? { id: Lg.mentor, name: Lg.mentor_name, role: Lg.role, by_hand: !!Lg.override, tie: !!Lg.tie, unconfirmed: !!Lg.unconfirmed, closer_than_pct_of_pairs: Lg.mentor_closer_than ?? null } : null, also_served_under: (Lg.also || []).map((a) => ({ id: a[0], name: a[1], role: a[2] })), every_head_coach_served_under: (Lg.suggested || []).map((u) => ({ id: u[0], seasons: u[1] })), coached_under_him: (Lg.kids || []).map((k) => ({ id: k[0], name: k[1] })), staffs, own_assistant_stints: p.assistant || [] }, lines: L }
}

export async function coachProfile({ coach, group = 'all', season }) {
  const idx = await loadIndex()
  const who = await resolveCoach(coach)
  const p = await loadCoach(who.id)
  const want = (g) => group === 'all' || group === g
  const notes = []
  const at = p.career.all_time
  const L = [`${p.name}: NBA head coach${p.career.g ? '' : ' (no games since 1996-97)'}`]
  const b = p.bio
  const bio = [b.born ? `born ${b.born}${b.birthplace ? ' in ' + b.birthplace : ''}` : null, b.college ? `college ${b.college}` : null, b.played ? `played ${b.player_games ? b.player_games + ' NBA games' : 'in the NBA'}` : 'did not play in the NBA', b.age_first_hc ? `first head job at ${b.age_first_hc}` : null, b.assistant_seasons_before ? `${b.assistant_seasons_before} assistant seasons before it` : null].filter(Boolean)
  L.push(bio.join('; ') + '.')
  L.push(`All-time (Basketball-Reference): ${record(at.w, at.l)} over ${plural(at.seasons, 'season')} ${at.first}–${at.last}, ${plural(at.po_seasons, 'playoff season')}, ${plural(at.titles, 'title')}${at.coy.length ? `, Coach of the Year ${at.coy.join(', ')}` : ''}. Since 1996-97 (the games here): ${record(p.career.w, p.career.l)}, playoffs ${record(p.career.pw, p.career.pl)}${p.career.eligible ? `, ${display('sgn1', p.career.w_talent_sum_raw)} wins above talent and ${display('sgn1', p.career.w_market_sum_raw)} above the market, added up` : ''}.`)
  if (p.stints.some((s) => s.acting_for)) for (const s of p.stints.filter((s) => s.acting_for)) say(notes, L, `Acting coach, ${s.first_season} ${s.team} (${s.first} to ${s.last}): ${s.note} Source: ${s.source}`)
  const structured = { coach: { id: p.id, name: p.name, url: coachUrl(p.id) }, group, bio: p.bio, all_time: at, since_1996: { games: p.career.g, wins: p.career.w, losses: p.career.l, playoff_wins: p.career.pw, playoff_losses: p.career.pl, playoff_seasons: p.career.po_seasons, titles: p.career.titles, wins_above_talent: p.career.w_talent_sum_raw, wins_above_market: p.career.w_market_sum_raw, ranked_career: p.career.eligible }, stints: p.stints, awards: p.awards, notes, url: coachUrl(p.id), data_as_of: day(idx.meta.generated), source: SOURCE }
  if (p.seasons.some((s) => s.in_progress)) say(notes, L, `${idx.meta.current} is in progress and counts as it stands.`)
  if (want('career')) { const c = careerBlock(idx, p, notes); structured.career_stats = c.stats; L.push('', ...c.lines) }
  if (want('rotation')) { const r = await rotationBlock(idx, p, season, notes); structured.rotation = r.structured; L.push('', ...r.lines) }
  if (want('game_management')) { const m = managementBlock(idx, p); structured.game_management = m.structured; L.push('', ...m.lines) }
  if (want('identity')) { const i = identityBlock(idx, p); structured.identity = i.structured; L.push('', ...i.lines) }
  if (want('context')) { const c = contextBlock(idx, p); structured.context = c.structured; L.push('', ...c.lines) }
  if (want('development')) { const d = developmentBlock(idx, p); structured.development = d.structured; L.push('', ...d.lines) }
  if (want('staff') || want('lineage')) { const s = staffBlock(idx, p, notes); structured.staff = s.structured; L.push('', ...s.lines) }
  if (want('seasons')) { const s = seasonLines(idx, p, group === 'seasons'); structured.seasons = s.rows; L.push('', ...s.lines) }
  if (p.scouting?.length && group === 'all') { L.push('', 'Scouting report (written by rule from the card):', ...p.scouting.map((l) => `- ${l.text}`)); structured.scouting = p.scouting.map((l) => l.text) }
  L.push('', `Page: ${structured.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- leaders, tree, data room, dictionary -------------------------------------------------
export async function coachingLeaders({ board = 'all', limit = 10 } = {}) {
  const idx = await loadIndex()
  const boards = board === 'all' ? idx.leaders : idx.leaders.filter((b) => b.id === board)
  if (!boards.length) throw new SavantError(`No "${board}" board. Boards: ${idx.leaders.map((b) => b.id).join(', ')}.`)
  const out = boards.map((b) => ({ id: b.id, title: b.title, kind: b.kind, season: b.season, pool: b.pool, pool_size: b.rows.length, note: b.note, rows: b.rows.slice(0, limit).map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, team: r.team, value: r.value, display: r.display })) }))
  const L = [`Basketball Coaching Savant's ${out.length === 1 ? `"${out[0].title}" board` : `${out.length} Leaders boards`}, in the page's order (the page shows ten).`]
  for (const b of out) { L.push('', `${b.title} (${b.pool}; ${b.pool_size} in all${b.pool_size > b.rows.length ? `, top ${b.rows.length} shown` : ''})`); for (const r of b.rows) L.push(`${r.rank}. ${r.name}${r.team ? ` (${r.team})` : ''}: ${r.display}`); if (b.note) L.push(b.note) }
  L.push('', `Page: ${PAGE}`, `Source: ${SOURCE}. Data as of ${day(idx.meta.generated)}.`)
  return { structured: { board, limit, boards: out, url: PAGE, data_as_of: day(idx.meta.generated), source: SOURCE }, text: L.join('\n') }
}

export async function coachingTree({ coach, depth = 3 } = {}) {
  const idx = await loadIndex()
  const N = idx.tree.nodes
  const note = idx.tree.note
  if (!coach) {
    const trees = idx.tree.roots.map((r) => ({ root: r, name: N[r].name, size: N[r].size, branches: N[r].kids.map((k) => ({ id: k, name: N[k].name, size: N[k].size })) }))
    const L = [`The coaching tree: ${trees.length} trees with more than one coach (${trees.reduce((s, t) => s + t.size, 0)} coaches in them). ${note}`, '']
    for (const t of trees.slice(0, 40)) L.push(`- ${t.name} tree: ${t.size} coaches. Under him: ${t.branches.map((b) => `${b.name} (${b.size})`).join(', ')}.`)
    L.push('', `Page: ${PAGE}#tree`, `Source: ${SOURCE}. Data as of ${day(idx.meta.generated)}.`)
    return { structured: { trees, note, url: `${PAGE}#tree`, data_as_of: day(idx.meta.generated), source: SOURCE }, text: L.join('\n') }
  }
  const who = await resolveCoach(coach)
  const me = N[who.id]
  if (!me) throw new SavantError(`${who.name} is not in the tree.`)
  const line = []
  for (let at = me.mentor, seen = new Set([who.id]); at && N[at] && !seen.has(at); at = N[at].mentor) { seen.add(at); line.push({ id: at, name: N[at].name }) }
  const branch = []
  let deeper = 0
  const walk = (n, d) => { for (const k of N[n].kids) { if (d > depth) { deeper += N[k].size; continue } branch.push({ id: k, name: N[k].name, depth: d, under: N[n].name, role: N[k].role, branch_size: N[k].size, by_hand: !!N[k].override }); walk(k, d + 1) } }
  walk(who.id, 1)
  const L = [`${who.name} in the coaching tree. ${note}`, '']
  L.push(me.mentor ? `Suggested mentor: ${N[me.mentor].name} (${me.role})${me.override ? ', set by hand' : ', from the record'}${me.unconfirmed ? '; UNCONFIRMED' : ''}.` : 'No mentor suggested: no NBA assistant stint on record.')
  if (line.length) L.push(`Line back to the root: ${[who.name, ...line.map((l) => l.name)].join(' ← ')}.`)
  if (!branch.length) L.push('Nobody in the tree is placed under him.')
  else { L.push(`Beneath him: ${me.size - 1}${deeper ? ` (${branch.length} shown to depth ${depth}, ${deeper} deeper)` : ''}:`); for (const b of branch) L.push(`${'  '.repeat(b.depth - 1)}- ${b.name}${b.branch_size > 1 ? ` (${b.branch_size - 1} beneath)` : ''}${b.depth === 1 && b.role ? ` · ${b.role}` : ''}`) }
  L.push('', `Tree: ${PAGE}#tree=${who.id}`, `His page: ${coachUrl(who.id)}`, `Source: ${SOURCE}. Data as of ${day(idx.meta.generated)}.`)
  return { structured: { coach: { id: who.id, name: who.name, mentor: me.mentor ? { id: me.mentor, name: N[me.mentor].name, role: me.role, by_hand: !!me.override, unconfirmed: !!me.unconfirmed } : null, line, branch_size: me.size - 1 }, depth, branch, not_shown: deeper, note, url: `${PAGE}#tree=${who.id}`, data_as_of: day(idx.meta.generated), source: SOURCE }, text: L.join('\n') }
}

function matches(row, cols, filters) {
  for (const f of filters || []) {
    const i = cols.indexOf(f.column)
    if (i < 0) throw new SavantError(`No column "${f.column}". Columns: ${cols.join(', ')}.`)
    const v = row[i]
    switch (f.op) {
      case 'eq': if (String(v) !== String(f.value)) return false; break
      case 'ne': if (String(v) === String(f.value)) return false; break
      case 'in': if (!(Array.isArray(f.value) ? f.value : String(f.value).split(',')).map(String).includes(String(v))) return false; break
      case 'gte': if (v == null || +v < +f.value) return false; break
      case 'lte': if (v == null || +v > +f.value) return false; break
      case 'gt': if (v == null || +v <= +f.value) return false; break
      case 'lt': if (v == null || +v >= +f.value) return false; break
      case 'contains': if (!JSON.stringify(v ?? '').toLowerCase().includes(String(f.value).toLowerCase())) return false; break
      case 'null': if (v != null) return false; break
      case 'notnull': if (v == null) return false; break
      default: throw new SavantError(`Unknown op "${f.op}". Use eq, ne, in, gte, lte, gt, lt, contains, null, notnull.`)
    }
  }
  return true
}

export async function coachingData({ table, season, filters = [], columns, limit = 100, offset = 0 } = {}) {
  const idx = await loadIndex()
  if (!TABLES.includes(table)) throw new SavantError(`Pick a table: ${TABLES.join(', ')}.`)
  if (!/^\d{4}-\d{2}$/.test(season || '')) throw new SavantError('Give the season as YYYY-YY, e.g. 2024-25.')
  let file
  try { file = await loadTable(table, season) } catch (e) { throw new SavantError(`No ${table} table for ${season}. The games table runs 1996-97 on; stints, units, rotation and decisions 2002-03 on.`) }
  const cols = file.columns
  const want = columns && columns.length ? columns : cols
  const idxs = want.map((c) => { const i = cols.indexOf(c); if (i < 0) throw new SavantError(`No column "${c}" in ${table}. Columns: ${cols.join(', ')}.`); return i })
  const all = file.rows.filter((r) => matches(r, cols, filters))
  const lim = Math.min(MAX_ROWS, Math.max(1, limit))
  const page = all.slice(offset, offset + lim).map((r) => idxs.map((i) => r[i]))
  const dict = await loadDict()
  const structured = { table, season, columns: want, rows: page, total_matching: all.length, offset, limit: lim, next_offset: offset + lim < all.length ? offset + lim : null, definition: dict.tables[table], legend: file.legend || null, data_as_of: day(idx.meta.generated), source: SOURCE }
  const text = [`${table} ${season}: ${all.length} rows match${filters.length ? ' the filters' : ''}; rows ${offset + 1}–${offset + page.length}${structured.next_offset != null ? ` (next offset ${structured.next_offset})` : ''}. Columns: ${want.join(', ')}.`, dict.tables[table], file.legend ? `Legend: ${JSON.stringify(file.legend)}` : '', '', ...page.slice(0, 50).map((r) => JSON.stringify(r)), page.length > 50 ? `… ${page.length - 50} more rows in the structured result` : '', '', `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`].filter((x) => x !== '').join('\n')
  return { structured, text }
}

export async function coachingDictionary({ table } = {}) {
  const idx = await loadIndex()
  const dict = await loadDict()
  const stats = dict.stats.map((s) => ({ key: s.key, label: s.label, group: s.group, kind: s.kind === 'good' ? 'how good' : 'how much', unit: s.unit, lower_is_better: !!s.lower, settle_point: s.thr, since: s.first, what: s.what, formula: s.formula, source: s.source, sample: s.sample }))
  const tables = table ? { [table]: dict.tables[table] } : dict.tables
  if (table && !dict.tables[table]) throw new SavantError(`No table "${table}". Tables: ${Object.keys(dict.tables).join(', ')}.`)
  const L = ['Basketball Coaching Savant data dictionary.', '', 'Tables (nba_coaching_data):', ...Object.entries(tables).map(([k, v]) => `- ${k}: ${v}`), '', `Stats on the coach pages (${stats.length}); each with its kind, unit, direction, settle point and first season:`, ...(table ? [] : stats.map((s) => `- ${s.key} (${s.label}; ${s.kind}; ${s.unit}${s.lower_is_better ? '; lower is better' : ''}; from ${s.since}): ${s.what} Formula: ${s.formula}`)), '', `Fits in this build: talent line ${JSON.stringify(idx.meta.fits.talent)}; projection from parts ${JSON.stringify(idx.meta.fits.parts)}.`, idx.meta.model_note, `Source: ${SOURCE}. Data as of ${day(idx.meta.generated)}.`]
  return { structured: { tables, stats: table ? [] : stats, fits: idx.meta.fits, rules: idx.meta.rules, note: idx.meta.model_note, tree_note: idx.tree.note, data_as_of: day(idx.meta.generated), source: SOURCE }, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------
const pct = z.number().int().min(1).max(99).nullable()
const statShape = z.object({ key: z.string(), label: z.string(), group: z.string().optional(), kind: z.string().optional(), value: z.number().nullable(), display: z.string(), percentile: pct.optional(), pool: z.string().optional(), pool_size: z.number().int().nullable().optional(), sample: z.number().nullable().optional(), seasons_covered: z.number().int().optional(), small_sample: z.boolean().optional(), lower_is_better: z.boolean().optional(), since: z.string().optional(), what: z.string().nullable().optional() }).passthrough()
const filterShape = z.object({ column: z.string(), op: z.enum(['eq', 'ne', 'in', 'gte', 'lte', 'gt', 'lt', 'contains', 'null', 'notnull']), value: z.any().optional() })

export const tools = [
  {
    name: 'nba_search_coaches',
    config: {
      title: 'Search NBA coaches',
      description: 'Find NBA head coaches (every one since 1946-47) and assistants in Basketball Coaching Savant (wcehoops.com) by name. Returns id, record, seasons, teams and page link. Tolerates accents, punctuation and small typos.',
      inputSchema: { query: z.string().trim().min(2).max(80).describe('Coach name or part of one, e.g. "Popovich", "Erik Spoelstra".'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return.') },
      outputSchema: { query: z.string(), total: z.number().int(), count: z.number().int(), coaches: z.array(z.object({ id: z.string().describe('The id nba_get_coach_profile takes (his Basketball-Reference slug).'), name: z.string(), head_coach: z.boolean(), assistant: z.boolean(), teams: z.array(z.string()), first_season: z.string().nullable(), last_season: z.string().nullable(), record_all_time: z.string().nullable(), seasons: z.number().int().nullable(), games_since_1996: z.number().int(), ranked_career: z.boolean(), active: z.boolean(), url: z.string() })) },
      annotations: { title: 'Search NBA coaches', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchCoaches({ query, limit }),
  },
  {
    name: 'nba_get_coach_profile',
    config: {
      title: 'Get an NBA coach\'s Savant profile',
      description: 'One NBA head coach\'s Basketball Coaching Savant profile (wcehoops.com): record and bio; wins above two expectations (roster talent, the market); the ranked career card, each stat with its percentile and pool; the Rotation Map for a season (usual windows, off-script minutes and why, closing, pairs, lineups from their parts); game management (timeouts vs runs, after-timeout offense, challenges, halftime, late game); identity, comps, arrival effect; situational splits; players vs the aging curve; staffs and suggested lineage; seasons. Rotation verdicts are the model\'s view and say so.',
      inputSchema: { coach: z.string().trim().min(1).max(80).describe('Coach name or id, e.g. "Gregg Popovich" or "popovgr99c".'), group: z.enum(GROUPS).default('all').describe('Which part to return.'), season: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('The season whose Rotation Map to return (default: his latest).') },
      outputSchema: { coach: z.object({ id: z.string(), name: z.string(), url: z.string() }), group: z.string(), bio: z.object({}).passthrough(), all_time: z.object({}).passthrough(), since_1996: z.object({}).passthrough(), stints: z.array(z.object({}).passthrough()), awards: z.array(z.array(z.string())), career_stats: z.array(statShape).optional(), rotation: z.object({}).passthrough().nullable().optional(), game_management: z.object({}).passthrough().nullable().optional(), identity: z.object({}).passthrough().nullable().optional(), context: z.object({}).passthrough().nullable().optional(), development: z.object({}).passthrough().nullable().optional(), staff: z.object({}).passthrough().nullable().optional(), seasons: z.array(z.object({}).passthrough()).optional(), scouting: z.array(z.string()).optional(), notes: z.array(z.string()), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get an NBA coach\'s Savant profile', ...READ_ONLY },
    },
    run: ({ coach, group, season }) => coachProfile({ coach, group, season }),
  },
  {
    name: 'nba_coaching_leaders',
    config: {
      title: 'Get Basketball Coaching Savant\'s Leaders boards',
      description: 'Basketball Coaching Savant\'s Leaders boards (wcehoops.com), in the page\'s order: career boards (win %, most wins, wins above talent and the market, playoff rate, rotation stability, run stopping, after-timeout bump, challenge success, halftime adjustment, aging curve, pace, 3-point rate and more) and this season\'s. Each names its pool.',
      inputSchema: { board: z.string().default('all').describe('A board id, or "all".'), limit: z.number().int().min(1).max(50).default(10).describe('Rows per board.') },
      outputSchema: { board: z.string(), limit: z.number().int(), boards: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), season: z.string().nullable(), pool: z.string(), pool_size: z.number().int(), note: z.string().nullable(), rows: z.array(z.object({ rank: z.number().int(), id: z.string(), name: z.string(), team: z.string().nullable(), value: z.number().nullable(), display: z.string() })) })), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get Basketball Coaching Savant\'s Leaders boards', ...READ_ONLY },
    },
    run: ({ board, limit }) => coachingLeaders({ board, limit }),
  },
  {
    name: 'nba_coaching_tree',
    config: {
      title: 'Get the NBA coaching tree',
      description: 'The NBA coaching tree (wcehoops.com): each coach\'s mentor suggested from the record (the head coach he served under most), hand corrections marked. With a coach: mentor, line to the root, everyone beneath him. Without one: every tree and its size.',
      inputSchema: { coach: z.string().trim().min(1).max(80).optional().describe('A coach name or id; omit for every tree.'), depth: z.number().int().min(1).max(10).default(3).describe('Generations beneath him to list.') },
      outputSchema: { coach: z.object({}).passthrough().nullable().optional(), depth: z.number().int().optional(), branch: z.array(z.object({}).passthrough()).optional(), not_shown: z.number().int().optional(), trees: z.array(z.object({}).passthrough()).optional(), note: z.string(), url: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get the NBA coaching tree', ...READ_ONLY },
    },
    run: ({ coach, depth }) => coachingTree({ coach, depth }),
  },
  {
    name: 'nba_coaching_data',
    config: {
      title: 'Pull rows from the Basketball Coaching Savant Data Room',
      description: 'The Data Room behind Basketball Coaching Savant (wcehoops.com): rows for your own splits and regressions, one file a season. Tables: games (team-game with every context column: opponent strength as of the date, rest, travel, altitude, missing regulars, officials, closing line, win probability, phase; 1996-97 on), stints, units, rotation (player-game on-floor intervals and off-script minutes by cause), decisions (timeouts, challenges, runs, late-game calls, foul trouble). Filter on any column, pick columns, page (500 rows a call). Call nba_coaching_dictionary first.',
      inputSchema: { table: z.enum(TABLES).describe('Which table.'), season: z.string().regex(/^\d{4}-\d{2}$/).describe('e.g. 2024-25'), filters: z.array(filterShape).max(12).default([]).describe('{column, op, value}; ops eq, ne, in, gte, lte, gt, lt, contains, null, notnull.'), columns: z.array(z.string()).max(60).optional().describe('Columns to return (default all).'), limit: z.number().int().min(1).max(MAX_ROWS).default(100).describe('Rows per call.'), offset: z.number().int().min(0).default(0).describe('Row to start at.') },
      outputSchema: { table: z.string(), season: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.any())), total_matching: z.number().int(), offset: z.number().int(), limit: z.number().int(), next_offset: z.number().int().nullable(), definition: z.string(), legend: z.any().nullable(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Pull rows from the Basketball Coaching Savant Data Room', ...READ_ONLY },
    },
    run: (args) => coachingData(args),
  },
  {
    name: 'nba_coaching_dictionary',
    config: {
      title: 'Get the Basketball Coaching Savant data dictionary',
      description: 'Every Data Room column and every coach-page stat defined (what, formula, unit, direction, settle point, source, first season), plus the fits behind the build. Read before nba_coaching_data.',
      inputSchema: { table: z.enum(TABLES).optional().describe('One table only.') },
      outputSchema: { tables: z.record(z.string()), stats: z.array(z.object({}).passthrough()), fits: z.object({}).passthrough(), rules: z.object({}).passthrough(), note: z.string(), tree_note: z.string(), data_as_of: z.string(), source: z.string() },
      annotations: { title: 'Get the Basketball Coaching Savant data dictionary', ...READ_ONLY },
    },
    run: ({ table }) => coachingDictionary({ table }),
  },
]
