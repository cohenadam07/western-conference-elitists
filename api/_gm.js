// api/_gm.js — NBA GM Savant, as answers. One section of the AI connector (api/mcp.js).
//
// It reads the page's own files under /gms/ (pipeline/basketball/gm/build_page.py writes them):
//   index.json        every GM and his spells, the headline boards (all-time, active), a board per skill, the
//                     executive tree, the repeatability verdicts, the page notes
//   g/<gm>.json       one GM: each spell's card, portfolio, inherited and left, his biggest moves with their asset
//                     trees, every decision with both grades
// What an answer always says: the headline's pool; that skills carry no percentile (only re-signing repeats, likely stars); that
// re-signing may reflect the stars he had; that grades are the model's view; where the page is.
// The upfront cost of these five tools is kept small: the connector's cap is 90,000 characters
// (tools/savant-mcp/check.mjs).
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, ordinal, prepare, rank } from './_core.js'

const files = makeLoader('gms', { what: 'NBA GM Savant', shape: (b) => b && typeof b === 'object' && (b.meta || b.spells) })
const SOURCE = 'NBA GM Savant, Western Conference Elitists (wcehoops.com)'
const PAGE = `${SITE}/nba-gm-savant`
export const gmUrl = (file) => `${PAGE}#g=${encodeURIComponent(file)}`
const loadIndex = () => files.load('index.json')
const loadGm = (file) => files.load(`g/${encodeURIComponent(file)}.json`)
const K = '0.05'
const sgn = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')}`)
const span = (s) => `${String(s.start).slice(0, 4)}-${s.end ? String(s.end).slice(0, 4) : 'now'}`
const POINTS = 'Savant points (31.7 = one win), ten seasons ahead at 5% a year'
const VIEW = "Grades are the model's view, not a verdict."
const tt = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 0.1 || v === 0 ? 2 : 3)}`)
// salaries: every field exists now, null until NBA GM Savant 1.1.0 (pipeline/basketball/gm/SALARY_SLOTS.md)
const SAL_SPELL = ['payroll_per_season', 'tax_paid', 'dead_money', 'value_per_dollar', 'cap_outlook']
const SAL_DEC = ['salary_cost', 'cap_hit', 'value_per_dollar', 'dead_money', 'years_of_control']
const pickNull = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k] ?? null]))
const SALNOTE = (m) => (m.salaries && m.salaries.available ? '' : `Salaries: not in NBA GM Savant yet (they arrive in ${(m.salaries && m.salaries.arrives) || '1.1.0'}); value is counted without what it cost, so the salary fields are null.`)
const TITLES = (m) => `expected titles: each season simulated on its real schedule, seeding and bracket; blended = points + ${Math.round(m.titles.lambda)} x expected titles added (one title = ${Math.round(m.titles.lambda)} points, set so each is half the spread across GM spells)`

let prepared = null
async function people() {
  const idx = await loadIndex()
  if (!prepared || prepared.idx !== idx) prepared = { idx, rows: prepare(idx.people) }
  return prepared.rows
}
async function find(gm) {
  const rows = await people()
  const exact = rows.find((r) => r.id === gm || r.file === gm)
  if (exact) return exact
  const hit = rank(rows, gm, (a, b) => (b.active - a.active))[0]
  if (!hit) throw new SavantError(`No GM in NBA GM Savant matches "${gm}". It covers every NBA front-office head since 1979-80; try nba_search_gms.`)
  return hit.row
}

export async function searchGms({ query, limit = 10 }) {
  const idx = await loadIndex()
  const ranked = rank(await people(), query, (a, b) => (b.active - a.active))
  const gms = ranked.slice(0, limit).map(({ row: r }) => ({ id: r.file, name: r.name, active: !!r.active,
    spells: r.spells.map((s) => ({ team: s.team, team_name: s.team_name || s.team, start: s.start, end: s.end, gm_value_added: s.gva, percentile: s.pct_all, ranked: !!s.ranked })), url: gmUrl(r.file) }))
  const structured = { query, total: ranked.length, count: gms.length, gms, data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
  if (!gms.length) return { structured, text: `No GM matches "${query}". NBA GM Savant covers every NBA front-office head since 1979-80.` }
  return { structured, text: `${gms.map((g, i) => `${i + 1}. ${g.name} (id ${g.id}): ${g.spells.map((s) => `${s.team_name} ${span(s)} ${sgn(s.gm_value_added)}${s.ranked ? ` (${ordinal(s.percentile)} pct)` : ' (not ranked)'}`).join('; ')}. ${g.url}`).join('\n')}\nGM Value Added in ${POINTS}; percentiles vs ${idx.meta.pool_all}.` }
}

function spellCard(s) {
  return { team: s.team, team_name: s.team_name || s.team, start: s.start, end: s.end, active: !!s.active, seasons: s.seasons, ranked: !!s.ranked, early_era: !!s.early_era,
    gm_value_added: s.gm_value_added, per_season: s.gm_value_added_per_season, percentile_all: s.pct_all, percentile_active: s.pct_active,
    player_value_line: s.gm_value_added_player[K], produced: s.produced_margin_adj, inherited: s.inherited[K], left: s.left[K],
    // finished tenures: what he inherited and left at what it went on to produce (the headline values them as projected)
    headline_basis: s.headline_basis,
    // finished tenures: the headline is as it turned out; this is the same on projection (active GMs: the headline itself)
    at_the_time: s.active ? null : { gm_value_added: s.gm_value_added_at_time[K], inherited: s.inherited_at_time[K], left: s.left_at_time[K] },
    not_counted_walked: s.walked_before_left, luck: s.detail && s.detail.luck ? { lottery: s.detail.luck.lottery, games_missed_value: s.detail.luck.games_missed_value, grade_gap: s.detail.luck.grade_gap } : null,
    skills: s.detail && s.detail.drafting ? { drafting_over_slot: s.detail.drafting.over_slot, picks: s.detail.drafting.picks, trades_turned_out: s.detail.trades.turned_out, trades_at_time: s.detail.trades.at_time, trades: s.detail.trades.n,
      free_agency: s.detail.free_agency.stars + s.detail.free_agency.role, role_players: s.detail.role_players, re_signing: s.detail.re_signing, development: s.detail.development.value_over_projection, coach_hiring: s.detail.coach_hiring } : null,
    shared_credit: s.splits.map((x) => ({ from: x.from, to: x.to, people: x.people.map((p) => ({ name: p[0], weight: p[1] })), why: x.why })),
    titles: { expected_titles_added: s.titles_added, at_the_time: s.active ? null : s.titles_added_at_time, while_in_charge: s.titles_produced_above_average, left: s.titles_left, inherited: s.titles_inherited,
      titles_won: s.titles_won, expected_titles: s.titles_expected, playoff_luck: s.playoff_luck, blended: s.blended, blended_percentile: s.pct_blended, titles_percentile: s.pct_titles },
    salaries: pickNull(s, SAL_SPELL),
    roster_built: s.roster_built ?? null, picks_owned: (s.picks_owned || []).map((a) => a.label), report: s.report,
    big_moves: s.big_moves.map((m) => ({ decision_id: m.id, date: m.date, what: m.label, at_time: m.at_time, turned_out: m.turned_out, titles_turned_out: m.titles_turned_out, blended: m.blended, weight: m.weight })) }
}

export async function gmProfile({ gm }) {
  const idx = await loadIndex()
  const r = await find(gm)
  const g = await loadGm(r.file)
  const spells = g.spells.map(spellCard)
  const structured = { gm: { id: r.file, name: g.name, url: gmUrl(r.file) }, spells, worked_under: g.under.map((u) => ({ under: u.under, team: u.team, from: u.from, to: u.to, title: u.title })),
    pool_all: idx.meta.pool_all, pool_active: idx.meta.pool_active, salaries: idx.meta.salaries || null, notes: idx.meta.notes.map(([k, v]) => `${k}: ${v}`), data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
  const L = [`${g.name}, NBA GM Savant (${gmUrl(r.file)}). GM Value Added = production above an average GM (margin, 30% of opponents' shooting luck out) + what he left - what he inherited, in ${POINTS}; finished tenures as they turned out, active ones on projection.`]
  for (const s of spells) {
    L.push(`${s.team_name} ${span(s)}: ${sgn(s.gm_value_added[K])} (${sgn(s.per_season)} a season; ${s.ranked ? `${ordinal(s.percentile_all)} percentile vs ${idx.meta.pool_all}` : 'under two seasons, not ranked'}); produced ${sgn(s.produced)}, left ${sgn(s.left)}, inherited ${sgn(s.inherited)}; player-value line ${sgn(s.player_value_line)}; at 0/10/20%: ${['0.0', '0.1', '0.2'].map((k) => sgn(s.gm_value_added[k])).join(' / ')}.`)
    L.push(s.at_the_time ? `  That headline is as it turned out (what he inherited and left at what it went on to produce). At the time, on projection: ${sgn(s.at_the_time.gm_value_added)}; inherited ${sgn(s.at_the_time.inherited)}, left ${sgn(s.at_the_time.left)}.`
      : '  Still in office: the headline values what he inherited and leaves on projection.')
    if (s.skills) L.push(`  What happened (no percentile: ${(idx.meta.repeat_sentence || 'no skill repeats').replace(/^Only/, 'only')}): drafting ${sgn(s.skills.drafting_over_slot)} over the slot (${s.skills.picks} picks); trades ${sgn(s.skills.trades_turned_out)} as they turned out, ${sgn(s.skills.trades_at_time)} at the time (${s.skills.trades}); free agency ${sgn(s.skills.free_agency)}; re-signing ${sgn(s.skills.re_signing)} (may reflect the stars he had); development ${sgn(s.skills.development)} (shared with the coach).`)
    L.push(`  Titles: expected titles added ${tt(s.titles.expected_titles_added)}${s.titles.blended_percentile == null ? '' : ` (${ordinal(s.titles.titles_percentile)} pct)`}; won ${s.titles.titles_won.toFixed(1)} against ${s.titles.expected_titles.toFixed(2)} expected (playoff luck ${tt(s.titles.playoff_luck)}); blended ${sgn(s.titles.blended)}${s.titles.blended_percentile == null ? '' : ` (${ordinal(s.titles.blended_percentile)} pct)`}.`)
    if (s.luck) L.push(`  Luck, apart: lottery ${sgn(s.luck.lottery)}, games missed ${sgn(-s.luck.games_missed_value)}, grade gap ${sgn(s.luck.grade_gap)}.`)
    if (s.shared_credit.length) L.push(`  Shared credit in ${s.shared_credit.length} stretch${s.shared_credit.length === 1 ? '' : 'es'}.`)
    L.push(`  ${s.report}`)
  }
  L.push(`Titles: ${TITLES(idx.meta)}; percentiles vs ${idx.meta.pool_all}.`)
  if (SALNOTE(idx.meta)) L.push(SALNOTE(idx.meta))
  L.push(VIEW)
  return { structured, text: L.join('\n') }
}

export async function gmLeaders({ board = 'all', limit = 10 }) {
  const idx = await loadIndex()
  const by = { all: 'blended', active: 'blended', points: 'gva', titles: 'titles_added' }[board]
  if (by) {
    const rows = idx.boards[board === 'active' ? 'active' : 'all'].slice().sort((a, b) => b[by] - a[by])
    const pick = (xs) => xs.map((x) => ({ id: x.file, name: x.name, team: x.team, start: x.start, end: x.end, blended: x.blended, gm_value_added: x.gva, per_season: x.per_season, percentile: x.pct_all,
      expected_titles_added: x.titles_added, titles_won: x.titles_won, expected_titles: x.titles_expected, playoff_luck: x.playoff_luck }))
    const structured = { board, ranked_by: by === 'gva' ? 'GM Value Added' : by === 'blended' ? 'blended at the default' : 'expected titles added', pool: board === 'active' ? idx.meta.pool_active : idx.meta.pool_all,
      top: pick(rows.slice(0, limit)), bottom: pick(rows.slice(-limit).reverse()), url: `${PAGE}#leaders`, data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
    const fmt = (xs) => xs.map((x, i) => `${i + 1}. ${x.name} ${x.team} ${span(x)} blended ${sgn(x.blended)}, points ${sgn(x.gm_value_added)}, expected titles added ${tt(x.expected_titles_added)}, won ${x.titles_won.toFixed(1)} v ${x.expected_titles.toFixed(2)} expected`).join('\n')
    return { structured, text: `NBA GM Savant, ranked by ${structured.ranked_by}, ${structured.pool}; points in ${POINTS}; ${TITLES(idx.meta)} (GM Value Added percentile is the points').\nTop:\n${fmt(structured.top)}\nBottom:\n${fmt(structured.bottom)}\n${VIEW}` }
  }
  const s = idx.skills[board]
  if (!s) throw new SavantError(`Pick a board: all, active, points, titles, or a skill (${Object.keys(idx.skills).join(', ')}).`)
  const pick = (xs) => xs.map((x) => ({ id: x.file, name: x.name, team: x.team, start: x.start, end: x.end, value: x.value }))
  const structured = { board, pool: 'spells of two or more seasons', verdict: s.verdict, top: pick(s.rows.slice(0, limit)), bottom: pick(s.rows.slice(-limit).reverse()), url: `${PAGE}#leaders`, data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
  return { structured, text: `${s.label}: ${s.verdict}, so no percentiles. Savant points, how it turned out.\nMost: ${structured.top.map((x) => `${x.name} ${x.team} ${sgn(x.value)}`).join('; ')}\nLeast: ${structured.bottom.map((x) => `${x.name} ${x.team} ${sgn(x.value)}`).join('; ')}` }
}

const TYPES = ['trade', 'draft', 'signing', 're-signing', 'extension', 'left in free agency', 'waiver', 'release', 'waiver claim', 'sign-and-trade', 'coach hire', 'coach firing']
export async function gmDecisions({ gm, type, team, limit = 25 }) {
  const idx = await loadIndex()
  const r = await find(gm)
  const g = await loadGm(r.file)
  const rows = g.decisions.filter((d) => (!type || d.type === type) && (!team || d.team === team))
  const by = rows.slice().sort((a, b) => Math.abs((b.turned_out || 0) * b.weight) - Math.abs((a.turned_out || 0) * a.weight)).slice(0, limit)
  const decisions = by.map((d) => ({ decision_id: d.id, date: d.date, official: d.official, type: d.type, team: d.team, what: d.label, at_time: d.at_time, turned_out: d.turned_out, weight: d.weight,
    titles_at_time: d.titles_at_time ?? null, titles_turned_out: d.titles_turned_out ?? null, blended_turned_out: d.blended_turned_out ?? null,
    at_time_note: d.at_time_note || null, low_confidence: d.low_confidence, models: d.models || [], grade_version: d.grade_version, ...pickNull(d, SAL_DEC) }))
  const structured = { gm: { id: r.file, name: g.name, url: gmUrl(r.file) }, total: rows.length, count: decisions.length, decisions, data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
  return { structured, text: `${g.name}: ${rows.length} decisions${type ? ` (${type})` : ''}, the ${decisions.length} biggest by how they turned out (${POINTS}; at the time | turned out | expected titles, turned out | blended):\n${decisions.map((d) => `${d.date} ${d.team} ${d.type}: ${d.what.slice(0, 160)} | ${d.at_time == null ? 'not graded at the time' : sgn(d.at_time)} | ${sgn(d.turned_out)} | ${tt(d.titles_turned_out)} | ${sgn(d.blended_turned_out)}${d.weight < 1 ? ` (his share ${Math.round(d.weight * 100)}%)` : ''}${d.low_confidence.length ? ' (low confidence)' : ''}`).join('\n')}\nEvery decision: savant_data nba gm_decisions.${SALNOTE(idx.meta) ? ` ${SALNOTE(idx.meta)}` : ''} ${VIEW}` }
}

function flat(a, depth = 0, out = []) {
  out.push(`${'  '.repeat(depth)}${a.label}`)
  for (const st of a.then || []) {
    out.push(`${'  '.repeat(depth + 1)}${st.how === 'became' ? 'became' : `traded to ${st.to}`} ${st.date}${st.sent_with.length ? ` with ${st.sent_with.map((x) => x.label).join('; ')}` : ''}:`)
    for (const x of st.got) flat(x, depth + 2, out)
  }
  return out
}
export async function gmAssetTree({ gm, move }) {
  const idx = await loadIndex()
  const r = await find(gm)
  const g = await loadGm(r.file)
  const moves = g.spells.flatMap((s) => s.big_moves.map((m) => ({ ...m, team: s.team })))
  const q = (move || '').toLowerCase()
  const m = moves.find((x) => x.id === move) || moves.find((x) => q && x.label.toLowerCase().includes(q)) || moves[0]
  if (!m || !m.tree) throw new SavantError(`${g.name} has no traded or drafted asset tree on file${move ? ` matching "${move}"` : ''}.`)
  const structured = { gm: { id: r.file, name: g.name, url: gmUrl(r.file) }, move: { decision_id: m.id, date: m.date, what: m.label, at_time: m.at_time, turned_out: m.turned_out }, tree: m.tree,
    other_moves: moves.filter((x) => x !== m).map((x) => ({ decision_id: x.id, date: x.date, what: x.label })), data_as_of: day(idx.meta.games_through || idx.meta.through), source: SOURCE }
  const lines = m.tree.got.flatMap((a) => flat(a))
  return { structured, text: `${g.name}, ${m.date}: ${m.label}\nAt the time ${m.at_time == null ? 'not graded' : sgn(m.at_time)}, as it turned out ${sgn(m.turned_out)}.\n${m.tree.gave.length ? `Gave: ${m.tree.gave.map((x) => x.label).join('; ')}\n` : ''}Got, and what became of it:\n${lines.join('\n')}` }
}

const gmIn = z.string().trim().min(1).max(80).describe('GM name or id, e.g. "Sam Presti".')
const anyOut = { gm: z.object({}).passthrough().optional(), data_as_of: z.string(), source: z.string() }
export const tools = [
  { name: 'nba_search_gms', config: { title: 'Search NBA GMs',
    description: 'Find NBA front-office heads since 1979-80 in NBA GM Savant (wcehoops.com): id, spells, GM Value Added, percentile, page link.',
    inputSchema: { query: z.string().trim().min(2).max(80).describe('Name or part of one.'), limit: z.number().int().min(1).max(25).default(10).describe('Most matches.') },
    outputSchema: { query: z.string(), total: z.number().int(), count: z.number().int(), gms: z.array(z.object({}).passthrough()), ...anyOut }, annotations: { title: 'Search NBA GMs', ...READ_ONLY } },
  run: ({ query, limit }) => searchGms({ query, limit }) },
  { name: 'nba_get_gm_profile', config: { title: "Get an NBA GM's profile",
    description: "One GM's NBA GM Savant card: GM Value Added per team (0-20% discounts, percentile and pool), produced, inherited, left, skills, luck, shared credit, scouting report.",
    inputSchema: { gm: gmIn }, outputSchema: { spells: z.array(z.object({}).passthrough()), worked_under: z.array(z.object({}).passthrough()), pool_all: z.string(), pool_active: z.string(), salaries: z.object({}).passthrough().nullable(), notes: z.array(z.string()), ...anyOut },
    annotations: { title: "Get an NBA GM's profile", ...READ_ONLY } }, run: ({ gm }) => gmProfile({ gm }) },
  { name: 'nba_gm_leaders', config: { title: 'Get NBA GM Savant leaders',
    description: 'NBA GM Savant boards: blended points and titles top and bottom (all-time or active, two-season minimum), by points or titles, or one skill board.',
    inputSchema: { board: z.string().default('all').describe('all, active, points, titles, or a skill.'), limit: z.number().int().min(1).max(50).default(10).describe('Rows per end.') },
    outputSchema: { board: z.string(), ranked_by: z.string().optional(), pool: z.string(), verdict: z.string().optional(), top: z.array(z.object({}).passthrough()), bottom: z.array(z.object({}).passthrough()), url: z.string(), ...anyOut },
    annotations: { title: 'Get NBA GM Savant leaders', ...READ_ONLY } }, run: ({ board, limit }) => gmLeaders({ board, limit }) },
  { name: 'nba_gm_decisions', config: { title: "Get a GM's decision log",
    description: "A GM's decisions, biggest first, each graded at the time and as it turned out, with his credit share and model version.",
    inputSchema: { gm: gmIn, type: z.enum(TYPES).optional().describe('Decision type.'), team: z.string().trim().length(3).optional().describe('Team code.'), limit: z.number().int().min(1).max(100).default(25).describe('Most rows.') },
    outputSchema: { total: z.number().int(), count: z.number().int(), decisions: z.array(z.object({}).passthrough()), ...anyOut },
    annotations: { title: "Get a GM's decision log", ...READ_ONLY } }, run: ({ gm, type, team, limit }) => gmDecisions({ gm, type, team, limit }) },
  { name: 'nba_gm_asset_tree', config: { title: 'Show an asset tree',
    description: "The asset tree of one of a GM's biggest moves: what he gave, what he got, and what each became, trade after trade.",
    inputSchema: { gm: gmIn, move: z.string().trim().max(120).optional().describe('Decision id or words from the move.') },
    outputSchema: { move: z.object({}).passthrough(), tree: z.object({}).passthrough(), other_moves: z.array(z.object({}).passthrough()), ...anyOut },
    annotations: { title: 'Show an asset tree', ...READ_ONLY } }, run: ({ gm, move }) => gmAssetTree({ gm, move }) },
]
