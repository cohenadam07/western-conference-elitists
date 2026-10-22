// api/_coaching.js — Coaching Savant, as answers. One section of the AI connector
// (api/mcp.js): it knows NFL coaches, the connector only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/coaching/v1/ (see
// scripts/lib/savant-api-coaching.mjs): a glossary, an index of everyone with a page, each
// person's page, and one file per season of units (one man calling one side for one team).
// Every percentile is already in those files. Nothing is ranked here, so an answer from this
// file is the number on the coach's page. Loading, caching and name matching are shared with
// the other sections and live in api/_core.js.
//
// A coach's page is several different kinds of claim, and an answer keeps them apart:
//
//   plain facts      his record, playoff history, wins against the closing spread
//   ranked stats     each with its percentile AND the pool it was ranked in. There are three
//                    pools and they are never mixed: head coaches with three seasons, head
//                    coaches with 48 games since the fourth-down model begins, and the other
//                    units of the same season and side
//   hand-curated     who he learned under, and who called the plays. No dataset records
//                    either. Both carry the page's own caveat every time they appear, and a
//                    play-caller the page marks "unconfirmed" stays marked
//
// WHAT AN ANSWER ALWAYS SAYS
//   - which pool a percentile is from
//   - when a coach or a unit is too short to rank (the page shows no rank, so neither do we)
//   - when a stat has no value, rather than showing a zero
//   - when the season in progress is in the numbers, and through which week
//   - where the page is: coaching-savant.html#c=<name>
//
// A unit's numbers are given under the man who called it, as the page credits them. A head
// coach's answer names who called his offence and defence each season; it does not hand him
// their numbers. An offence also carries the two charting panels its page draws: the route
// mix (the targeted receiver's route, against the season's league) and the tell grid.
//
// TWO MORE VIEWS OF THE PAGE
//   nfl_coaching_leaders   the front screen's Leaders boards, from leaders.json, which the
//                          build draws with the page's own renderLeaders(). Nothing is sorted
//                          here: a board is read from its first row down.
//   nfl_coaching_tree      the #tree view, from tree.json, which the build grows with the
//                          page's own layoutForest(). It covers the men the tree names who have
//                          no page (Bill Walsh), which a profile cannot.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, norm, ordinal, prepare, rank, thousands, topTier } from './_core.js'

const files = makeLoader('savant-api/coaching/v1', { what: 'Coaching Savant' })

export const GROUPS = ['all', 'career', 'fourth_downs', 'seasons', 'play_calling', 'lineage']
const SIDE = { O: 'offence', D: 'defence' }
const SIDE_PLURAL = { O: 'offences', D: 'defences' }
const SOURCE = 'Coaching Savant, Western Conference Elitists (wcehoops.com)'

const loadMeta = () => files.load('meta.json')
const loadProfiles = () => files.load('profiles/all.json')
const loadUnits = (season) => files.load(`units/${season}.json`)
const loadLeaders = () => files.load('leaders.json')
const loadTree = () => files.load('tree.json')

// The Leaders boards, by the ids leaders.json gives them (the slicer's BOARDS).
export const BOARD_IDS = ['most_wins', 'wins_above_expectation', 'playoff_rate', 'fourth_down_aggression', 'pass_rate_over_expected', 'tempo', 'fourth_down_decisions', 'motion', 'blitz', 'hardest_to_read']

// The index of everyone with a page, with each name prepared for matching once per load.
const prepared = new WeakMap()
async function loadPeople() {
  const file = await files.load('coaches.json')
  let rows = prepared.get(file)
  if (!rows) { rows = prepare(file.people); prepared.set(file, rows) }
  return rows
}

// Among equally good name matches: the man with the longer career, as the page's search does.
const longer = (a, b) => (b.g || 0) - (a.g || 0)

// ---- small formatting helpers ----------------------------------------------------------

// The page routes on the hash: #c=<the name, URI-encoded>.
export const coachUrl = (name) => `${SITE}/coaching-savant.html#c=${encodeURIComponent(name)}`

// A value the way the page prints it (its fmt()).
export function display(unit, v) {
  if (miss(v)) return '—'
  v = +v
  const signed = (dp, plus, strip) => {
    const mag = Math.abs(v).toFixed(dp)
    const body = strip ? mag.replace(/^0/, '') : mag
    if (!/[1-9]/.test(mag)) return body // a zero carries no sign
    return (v < 0 ? '−' : plus ? '+' : '') + body
  }
  switch (unit) {
    case 'pct1': return v.toFixed(1) + '%'
    case 'num1': return signed(1, false, false)
    case 'num2': return signed(2, false, false)
    case 'sgn1': return signed(1, true, false)
    case 'sgn2': return signed(2, true, false)
    case 'sgn3': return signed(3, true, true)
    case 'num0': return String(Math.round(v))
    case 'sec': return v.toFixed(1) + 's'
    default: return String(v)
  }
}

// "Closer than N% of pairs", the way the page prints N (its capP()).
export const pairShare = (p) => (p >= 99 ? Math.min(99.9, Math.floor(p * 10) / 10).toFixed(1) : String(Math.max(1, Math.round(p))))

// A caveat is said once: it goes into the notes (for a client that reads only the structured
// result) and into the text at the point it applies.
function say(notes, lines, note) {
  if (notes.includes(note)) return
  notes.push(note)
  lines.push(note)
}

const record = (w, l, t) => `${w}–${l}${t ? `–${t}` : ''}`
const span = (a, b) => (a === b ? String(a) : `${a}–${b}`)
const weeks = (wk) => (wk[0] === wk[1] ? `week ${wk[0]}` : `weeks ${wk[0]}–${wk[1]}`)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const rolesOf = (row) => [row.hc ? 'head coach' : null, ...(row.sides || []).map((s) => `${SIDE[s]} play-caller`)].filter(Boolean)
const unitTitle = (u) => `${u.season} ${u.team} ${SIDE[u.side]}`

function candidateLine(row) {
  const bits = [rolesOf(row).join(' and ')]
  if (row.first != null) bits.push(span(row.first, row.last))
  if (row.teams && row.teams.length) bits.push(row.teams.join(', '))
  if (row.hc) bits.push(record(row.w, row.l, row.t))
  return `${row.name}: ${bits.join(', ')}`
}

// ---- finding the coach -----------------------------------------------------------------

// The name is the id: Coaching Savant keys every page by it. A name has to land on one man;
// when it could be several, they are listed so the caller can pick.
async function resolveCoach(input) {
  const rows = await loadPeople()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a coach\'s name.')

  const exact = rows.find((r) => r.name === raw)
  if (exact) return exact

  // A man the coaching tree names but who has no page (Bill Walsh, Jim Johnson). Said
  // plainly, before a near-miss on his name can land on somebody else (Jimmy Johnson).
  const q = norm(raw)
  const meta = await loadMeta()
  const ancestor = (meta.ancestors || []).find((a) => norm(a.name) === q)
  if (ancestor && !rows.some((r) => r.n === q)) {
    const under = ancestor.under.length ? ` The tree places these coaches directly under him: ${ancestor.under.map((k) => k[0]).join(', ')}.` : ''
    throw new SavantError(`${ancestor.name} is named in Coaching Savant's hand-curated coaching tree but has no page of his own: he has no head-coaching record since ${meta.firstSeason}.${under}`)
  }

  const ranked = rank(rows, raw, longer)
  if (!ranked.length) throw new SavantError(`No head coach or play-caller matches "${raw}". Coaching Savant covers NFL head coaches since 1999 and play-callers since 2018. Check the spelling, or search with nfl_search_coaches.`)

  const top = ranked[0].score
  const best = topTier(ranked)
  // One clear answer: the only man at the top, matched on whole words or a prefix. A name
  // that matches only as a near spelling never resolves on its own, even alone: it may be
  // someone who is not in the data, one letter away from someone who is.
  if (best.length === 1 && top >= 60) return best[0]

  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  const why = best.length > 1 ? `${best.length} coaches match "${raw}"` : `"${raw}" is not an exact match`
  throw new SavantError(`${why}. Call again with one of these names:\n${list.map((r) => `- ${candidateLine(r)}`).join('\n')}`)
}

// ---- search --------------------------------------------------------------------------

export async function searchCoaches({ query, limit = 10 }) {
  const rows = await loadPeople()
  const ranked = rank(rows, query, longer)
  const shown = ranked.slice(0, limit).map(({ row }) => ({
    id: row.name,
    name: row.name,
    roles: rolesOf(row),
    teams: row.teams || [],
    first_season: row.first ?? null,
    last_season: row.last ?? null,
    head_coach_record: row.hc ? record(row.w, row.l, row.t) : null,
    head_coach_seasons: row.hc ? row.seasons : null,
    url: coachUrl(row.name),
  }))

  const structured = { query, total: ranked.length, count: shown.length, coaches: shown }
  if (!shown.length) {
    return { structured, text: `No head coach or play-caller in Coaching Savant matches "${query}". It covers NFL head coaches since 1999 and play-callers since 2018. Check the spelling or try the last name alone.` }
  }
  const head = ranked.length === 1 ? `1 coach matches "${query}":` : `${ranked.length} coaches match "${query}"${ranked.length > shown.length ? `, showing the first ${shown.length}` : ''}:`
  const lines = shown.map((c, i) => {
    const bits = [c.roles.join(' and ')]
    if (c.first_season != null) bits.push(span(c.first_season, c.last_season))
    if (c.teams.length) bits.push(c.teams.join(', '))
    if (c.head_coach_record) bits.push(`${c.head_coach_record} as head coach (regular season)`)
    return `${i + 1}. ${c.name}: ${bits.join(', ')}. ${c.url}`
  })
  return { structured, text: `${head}\n${lines.join('\n')}\nThe name is the id. Years and teams are his head-coaching seasons when he has any, otherwise the seasons he called plays.` }
}

// ---- the pieces of a profile -----------------------------------------------------------

// Two different men filed under one name. The data keys a coach by his name, so a father
// and son who share one become one page, with one record and one set of rankings. Nothing
// here can split them; the answer says so rather than passing the sum off as one career.
// The note applies only while the page still shows the merged entry (its seasons span the
// teams of both men), so it retires itself when the data is fixed.
const SHARED = {
  'Jim Mora': {
    when: (rows) => rows.some((r) => r.team === 'IND') && rows.some((r) => r.team === 'ATL' || r.team === 'SEA'),
    note: 'Coaching Savant files two different head coaches under this one name: Jim E. Mora (Indianapolis, 1999–2001 in this data) and his son Jim L. Mora (Atlanta 2004–06, Seattle 2009). The record, the rankings and the lineage here are the page\'s, and they mix the two men. The season list shows which seasons belong to which.',
  },
}

function inProgress(meta, p) {
  const cur = meta.current
  if (!cur || cur.week == null) return null
  const hc = p.hc && p.hc.last === cur.season
  const calls = p.calls && p.calls.units.some((u) => u.season === cur.season)
  return hc || calls ? { season: cur.season, through_week: cur.week, hc: !!hc } : null
}

function headCoach(meta, p, notes) {
  const h = p.hc
  const structured = {
    teams: h.teams,
    first_season: h.first,
    last_season: h.last,
    seasons: h.seasons,
    wins: h.w,
    losses: h.l,
    ties: h.t,
    win_pct: h.winpct,
    playoff_wins: h.pw,
    playoff_losses: h.pl,
    playoff_seasons: h.po,
    super_bowls_won: h.sb,
    super_bowls_lost: h.sbLost,
    best_season_wins: h.bestWins,
    wins_above_expectation: h.waa,
    ranked: h.qualified,
  }
  const L = []
  L.push(`Head coach ${span(h.first, h.last)} (${h.teams.join(', ')}), ${plural(h.seasons, 'season')}.`)
  const sb = h.sb || h.sbLost ? ` Super Bowls: won ${h.sb}, lost ${h.sbLost}.` : ''
  L.push(`Regular season ${record(h.w, h.l, h.t)}${h.winpct == null ? '' : ` (${h.winpct.toFixed(1)}%)`}. Playoffs ${h.pw}–${h.pl}; reached the playoffs in ${h.po} of ${plural(h.seasons, 'season')}.${sb}${h.bestWins == null ? '' : ` Best season: ${plural(h.bestWins, 'win')}.`}`)
  if (h.waa != null) L.push(`Wins vs expected: ${display('sgn1', h.waa)} (wins beyond what the closing betting spreads implied, added up over his career).`)
  const shared = SHARED[p.name]
  if (shared && shared.when(h.rows)) say(notes, L, shared.note)
  return { structured, lines: L }
}

function careerStats(meta, p, notes) {
  const h = p.hc
  const rules = meta.rules
  const stats = []
  const notRanked = []
  const L = []
  if (!h.qualified) {
    const note = `Career stats are not ranked for him: fewer than ${rules.minSeasons} seasons as a head coach, too short to rank against other coaches without inventing precision. His seasons carry the numbers.`
    L.push('Career profile')
    say(notes, L, note)
    return { stats, notRanked, lines: L }
  }

  const d4 = (m) => m.key.startsWith('d4_')
  const poolOf = (m) => (d4(m)
    ? `head coaches with at least ${rules.d4MinGames} games in the fourth-down data, which starts in ${rules.d4From}`
    : `head coaches with at least ${rules.minSeasons} seasons since ${meta.firstSeason}`)
  const main = meta.metrics.find((m) => !d4(m))
  const d4Main = meta.metrics.find(d4)

  const note = `Career stats are ranked against ${poolOf(main)}: ${main.pool} of them, fewer on a stat not all of them have a value for, so each group below gives its pool size. Career figures are weighted by games.${d4Main ? ` The Fourth downs group is ranked in a different pool: ${poolOf(d4Main)}.` : ''} A higher percentile means a higher value, except on a stat tagged "lower is better", where the page flips it.`
  L.push('Career profile')
  say(notes, L, note)

  for (const group of meta.groups) {
    const shown = []
    for (const m of meta.metrics.filter((x) => x.group === group)) {
      const cell = h.m[m.key]
      if (!cell) {
        let reason = 'no value on the page'
        if (d4(m) && h.d4 && !(h.d4.g >= rules.d4MinGames)) reason = `ranked only with ${rules.d4MinGames} games in the fourth-down data, which starts in ${rules.d4From}; the page has ${h.d4.g} for him`
        else if (m.since && h.last < m.since) reason = `tracked from ${m.since}, after his last season`
        notRanked.push({ key: m.key, label: m.label, reason })
        continue
      }
      shown.push({
        key: m.key,
        label: m.label,
        group,
        value: cell[0],
        display: display(m.unit, cell[0]),
        percentile: cell[1],
        pool: poolOf(m),
        pool_size: m.pool,
        lower_is_better: m.lowerIsBetter,
        seasons_covered: h.part && h.part[m.key] != null ? h.part[m.key] : null,
        what: m.what,
      })
    }
    if (!shown.length) continue
    stats.push(...shown)
    // What most rows of the group share goes in its heading; a row that differs says so itself.
    const usualOf = (vals) => vals.slice().sort((x, y) => vals.filter((v) => v === y).length - vals.filter((v) => v === x).length)[0]
    const pool = usualOf(shown.map((s) => s.pool_size))
    const covered = usualOf(shown.map((s) => s.seasons_covered))
    L.push(`${group} (pool of ${pool}${d4Main && group === d4Main.group ? `: ${poolOf(d4Main)}` : ''}${covered == null ? '' : `; from ${covered} of his ${h.seasons} seasons`})`)
    for (const s of shown) {
      const tags = [
        s.pool_size !== pool ? `pool of ${s.pool_size}` : null,
        s.lower_is_better ? 'lower is better' : null,
        s.seasons_covered === covered ? null : s.seasons_covered == null ? `all ${h.seasons} seasons` : `from ${s.seasons_covered} of his ${h.seasons} seasons`,
      ].filter(Boolean)
      L.push(`- ${s.label}: ${s.display} (${s.percentile == null ? 'not ranked' : `${ordinal(s.percentile)} percentile`})${tags.length ? ` [${tags.join('; ')}]` : ''}${s.what ? `. ${s.what}` : ''}`)
    }
  }
  if (stats.some((s) => s.seasons_covered != null)) {
    const partial = '"From N of his seasons" means the figure is averaged over only the seasons the page has a number for.'
    say(notes, L, partial)
  }
  if (notRanked.length) {
    const reasons = [...new Set(notRanked.map((m) => m.reason))]
    L.push(`Not shown for him: ${reasons.map((r) => `${notRanked.filter((m) => m.reason === r).map((m) => m.label).join(', ')} (${r})`).join('; ')}.`)
  }
  return { stats, notRanked, lines: L }
}

const CHOICE = { punt: 'punted', fg: 'kicked the field goal', go: 'went for it' }
const BEST = { punt: 'punt', fg: 'kick', go: 'go for it' }

function fourthDowns(meta, p, notes, full) {
  const d = p.hc.d4
  const rules = meta.rules
  if (!d) {
    const why = p.hc.last < rules.d4From
      ? `The fourth-down model covers ${rules.d4From} on, after his last season as a head coach.`
      : 'The page has no fourth downs judged for him.'
    return { structured: null, lines: ['Fourth-down decisions', why] }
  }
  const structured = {
    first_season: d.first,
    last_season: d.last,
    judged: d.n,
    games: d.g,
    clear_go_taken_pct: d.follow,
    clear_go_taken: d.dgGo,
    clear_go_spots: d.dg,
    close_calls_taken_pct: d.followP,
    close_calls_taken: d.pgGo,
    close_call_spots: d.pg,
    win_probability_lost_per_game: d.lostG,
    small_sample: d.small,
  }
  const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
  const L = ['Fourth-down decisions']
  L.push(`${thousands(d.n)} fourth downs ${span(d.first, d.last)}, scored by the nfl4th model (the win probability of going, punting and kicking). Clear "go" spots taken: ${pct(d.follow)} (${d.dgGo} of ${d.dg}; going was worth 4+ points of win probability). Close calls taken: ${pct(d.followP)} (${d.pgGo} of ${d.pg}; going was worth 1 to 4). Win probability given away per game: ${d.lostG == null ? '—' : `${d.lostG.toFixed(2)} points`}.`)
  if (d.small) {
    say(notes, L, `Small sample: ${d.n} fourth downs so far. Read these as what happened, not who he is yet.`)
  }
  if (full && d.worst.length) {
    structured.calls_the_model_liked_least = d.worst.map((w) => ({
      season: w.season, week: w.wk, opponent: w.opp, to_go: w.ytg, spot: w.spot, quarter: w.q, clock: w.t,
      score_margin: w.sd, chose: w.ch, model_preferred: w.best, win_probability_lost: w.lost,
    }))
    L.push('The calls the model liked least:')
    for (const w of d.worst) {
      const score = w.sd == null ? '' : w.sd > 0 ? `, up ${w.sd}` : w.sd < 0 ? `, down ${-w.sd}` : ', tied'
      L.push(`- ${w.season} week ${w.wk} vs ${w.opp}: 4th & ${w.ytg} at ${w.spot}, Q${w.q} ${w.t}${score}. He ${CHOICE[w.ch] || w.ch}; the model preferred to ${BEST[w.best] || w.best} (−${w.lost.toFixed(1)} points of win probability).`)
    }
    const cannot = 'What the model cannot see: injuries, his kicker beyond the league average, the wind on the day. A single call it dislikes can be right for reasons it does not know, so read the career numbers, not one Sunday.'
    say(notes, L, cannot)
  }
  return { structured, lines: L }
}

function seasonRows(meta, p, full) {
  const cur = meta.current
  const rows = []
  const L = []
  const callers = (list) => list.map((c) => `${c[0]}${c[1] ? '' : ' (unconfirmed)'}${list.length > 1 ? ` ${weeks([c[2], c[3]])}` : ''}`).join(', ') || '—'
  // Newest first, as the page lists them.
  for (const r of p.hc.rows.slice().reverse()) {
    const round = r.best ? meta.rounds[r.best] || null : null
    const sbName = r.best === 4 ? `Super Bowl ${meta.superBowl[r.season] || ''}`.trim() : null
    const result = r.best === 4 ? `${r.sb ? 'won' : 'lost'} ${sbName}` : round ? `playoffs: ${round}` : null
    const partial = cur && cur.week != null && r.season === cur.season ? cur.week : null
    const called = r.calls
      ? { offence: r.calls.O.map((c) => ({ name: c[0], confirmed: c[1], first_week: c[2], last_week: c[3] })), defence: r.calls.D.map((c) => ({ name: c[0], confirmed: c[1], first_week: c[2], last_week: c[3] })) }
      : null
    rows.push({
      season: r.season,
      team: r.team,
      wins: r.w,
      losses: r.l,
      ties: r.t,
      playoff_round: round,
      won_super_bowl: !!r.sb,
      through_week: partial,
      wins_above_expectation: r.waa ?? null,
      offence_epa: r.off_epa ?? null,
      defence_epa: r.def_epa ?? null,
      pass_rate: r.pass_rate ?? null,
      pass_rate_over_expected: r.proe ?? null,
      fourth_down_aggression: r.go_oe ?? null,
      fourth_down_wp_lost: r.d4_lost ?? null,
      plays_called_by: called,
    })
    const bits = [`${r.season} ${r.team} ${record(r.w, r.l, r.t)}${partial == null ? '' : ` (through week ${partial})`}`]
    if (result) bits.push(result)
    bits.push(`W vs exp ${display('sgn1', r.waa)}`)
    if (full) {
      bits.push(
        `Off EPA ${display('sgn3', r.off_epa)}`,
        `Def EPA ${display('sgn3', r.def_epa)}`,
        `Pass ${display('pct1', r.pass_rate)}`,
        `PROE ${display('sgn1', r.proe)}`,
        `4th agg ${display('sgn1', r.go_oe)}`,
        `4th WP lost ${r.d4_lost == null ? '—' : `−${(+r.d4_lost).toFixed(1)}`}`,
      )
    }
    if (r.calls) bits.push(`Off: ${callers(r.calls.O)}`, `Def: ${callers(r.calls.D)}`)
    L.push(bits.join(' · '))
  }
  const legend = full
    ? `Columns: regular-season record; playoff round reached; wins vs expected (W vs exp, against the closing spread); offence and defence EPA per play; pass rate in neutral situations; pass rate over expected (PROE); fourth-down aggression (4th agg); win probability his fourth-down calls gave away (4th WP lost); and who called the offence and defence. A dash means the page has no number for that season. PROE starts in 2006, the fourth-down model in ${meta.rules.d4From}, play-callers in ${meta.rules.callersFrom}.`
    : `Record, playoff round reached, wins vs expected (against the closing spread), and who called the offence and defence (recorded from ${meta.rules.callersFrom}).`
  return { rows, lines: ['Season by season, newest first', legend, ...L] }
}

function lineage(meta, p, notes) {
  const t = p.tree
  if (!t) return { structured: null, lines: ['Lineage', 'No lineage is recorded for him on Coaching Savant.'] }
  const structured = {
    mentor: t.chain.length ? t.chain[0][0] : null,
    role_under_mentor: t.role,
    also_shaped_by: t.also.map((a) => ({ name: a[0], role: a[1] })),
    chain: t.chain.map((c) => ({ name: c[0], has_page: c[1] })),
    root: t.root,
    coached_under_him: t.kids.map((c) => ({ name: c[0], has_page: c[1] })),
  }
  const L = ['Lineage (hand-curated)']
  if (!t.chain.length) {
    L.push('No mentor is recorded for him here. That means the lineage is missing, not that he learned it alone.')
  } else {
    L.push(`Learned under ${t.chain[0][0]}: ${t.role}.${t.also.map((a) => ` Also shaped by ${a[0]}: ${a[1]}.`).join('')}`)
    L.push(`Line: ${[p.name, ...t.chain.map((c) => c[0])].join(' ← ')}. Traces back to the ${t.root} tree.`)
    const noPage = t.chain.filter((c) => !c[1]).map((c) => c[0])
    if (noPage.length) L.push(`No page here for ${noPage.join(', ')}: no head-coaching record since ${meta.firstSeason}.`)
  }
  if (t.kids.length) L.push(`Head coaches off his staff: ${t.kids.map((c) => c[0]).join(', ')}.`)
  if (meta.notes.tree) say(notes, L, `About the lineage: ${meta.notes.tree}`)
  return { structured, lines: L }
}

function playCalling(meta, p, notes) {
  const c = p.calls
  const rules = meta.rules
  const L = ['Play-calling (hand-curated)']
  if (!c) {
    const hcYears = p.hc ? p.hc.rows.filter((r) => r.season >= rules.callersFrom).length : 0
    L.push(hcYears
      ? `He is not credited with calling the offence or the defence in any season since ${rules.callersFrom}. The season list names who called each side for his teams.`
      : `Play-callers are recorded from ${rules.callersFrom}, after his last season. Before then the page shows style under the head coach: the Style rows of his career profile.`)
    if (meta.notes.callers) say(notes, L, `About the play-callers: ${meta.notes.callers}`)
    return { structured: null, lines: L }
  }
  const side = (key) => {
    const s = c[key]
    if (!s) return null
    return {
      years: s.years,
      teams: s.teams,
      units: s.units,
      snaps: s.plays,
      games: s.games,
      unconfirmed_units: s.unsure,
      most_similar: s.comps.map((x) => ({ name: x[0], closer_than_pct_of_pairs: x[1] })),
      vs_mentors: s.mentors.map((x) => ({ name: x[0], closer_than_pct_of_pairs: x[1], primary_mentor: x[2] })),
    }
  }
  const structured = {
    seasons_calling: c.seasons,
    offence: side('O'),
    defence: side('D'),
    units: c.units.map((u) => ({
      season: u.season, team: u.team, side: SIDE[u.side], first_week: u.wk[0], last_week: u.wk[1],
      snaps: u.plays, games: u.games, confirmed: u.sure, ranked: !u.small,
    })),
  }
  for (const key of ['O', 'D']) {
    const s = c[key]
    if (!s) continue
    L.push(`Called the ${SIDE[key]} ${s.years} (${s.teams.join(', ')}): ${plural(s.units, 'unit')}, ${thousands(s.plays)} snaps, ${plural(s.games, 'game')}.${s.unsure ? ` ${plural(s.unsure, 'unit')} unconfirmed.` : ''}`)
    if (s.comps.length) L.push(`${key === 'O' ? 'Offensive' : 'Defensive'} play-callers most like him, on style only: ${s.comps.map((x) => `${x[0]} (closer than ${pairShare(x[1])}% of pairs)`).join(', ')}.`)
    for (const m of s.mentors) L.push(`Against ${m[2] ? 'his mentor ' : ''}${m[0]}: closer than ${pairShare(m[1])}% of ${SIDE[key]} play-caller pairs.`)
  }
  L.push(`Units he called, newest first: ${c.units.map((u) => `${unitTitle(u)} (${weeks(u.wk)}, ${thousands(u.plays)} snaps${u.sure ? '' : ', unconfirmed'}${u.small ? ', too few snaps to rank' : ''})`).join('; ')}.`)
  if (c.units.some((u) => !u.sure)) say(notes, L, `Unconfirmed: ${meta.notes.unconfirmed}`)
  if (meta.notes.callers) say(notes, L, `About the play-callers: ${meta.notes.callers}`)
  return { structured, lines: L }
}

// One unit, in full: every stat the page draws for it, with its percentile among the other
// units of its season and side. `explained` is set when the page's one-line explanation of
// each stat goes into the text, and holds the stats already explained in this answer, so two
// units of one season explain each stat once.
function unitDetail(meta, file, u, notes, explained) {
  const defs = meta.unitMetrics[u.side]
  const peers = `${u.season} ${SIDE_PLURAL[u.side]}`
  const n = file.ranked[u.side]
  const stats = []
  const missing = []
  const L = []
  const partial = file.week != null ? file.week : null

  L.push(`${unitTitle(u)}, ${weeks(u.wk)}. Called by ${u.caller}${u.sure ? '' : ' (UNCONFIRMED)'}${u.hc.length ? `; head coach ${u.hc.join(', ')}` : ''}. ${thousands(u.plays)} snaps, ${plural(u.games, 'game')}.`)
  if (!u.sure) say(notes, L, `Unconfirmed: ${meta.notes.unconfirmed}`)
  if (partial != null) say(notes, L, `The ${u.season} units are counted through week ${partial} of the regular season, and are ranked against each other as they stand.`)
  if (u.small) {
    say(notes, L, `The ${unitTitle(u)} (${weeks(u.wk)}) has too few snaps to rank: its values are shown, percentiles are not.`)
  } else {
    const note = `The ${unitTitle(u)} is ranked against the ${n} ${SIDE_PLURAL[u.side]} of ${u.season} with enough snaps to rank, never across years. A "how good" row is better at a higher percentile. A "how much" row is a tendency: a higher percentile means more of it, not better. "Lower is better" rows are already flipped.`
    say(notes, L, note)
  }
  if (meta.notes.era[u.era]) say(notes, L, `Not in this season: ${meta.notes.era[u.era]}`)

  for (const group of meta.unitGroups[u.side]) {
    const rows = []
    for (const m of defs.filter((x) => x.group === group)) {
      const cell = u.m[m.key]
      if (!cell) { missing.push({ key: m.key, label: m.label }); continue }
      const pair = u.pair && u.pair[m.key] ? u.pair[m.key] : null
      const pool = file.pools[u.side][m.key] ?? null
      const s = {
        key: m.key,
        label: m.label,
        group,
        kind: m.style ? 'how much' : 'how good',
        value: cell[0],
        display: display(m.unit, cell[0]),
        percentile: cell[1],
        pool: peers,
        pool_size: pool,
        lower_is_better: m.lowerIsBetter,
        epa_with: pair ? pair[0] : null,
        epa_without: pair ? pair[1] : null,
        what: m.what,
      }
      stats.push(s)
      const tags = [s.kind, m.lowerIsBetter ? 'lower is better' : null, s.percentile != null && pool !== n ? `pool of ${pool}` : null].filter(Boolean)
      const tell = explained && m.what && !explained.has(`${u.side}:${m.key}`)
      if (tell) explained.add(`${u.side}:${m.key}`)
      rows.push(`- ${m.label}: ${s.display} (${s.percentile == null ? 'not ranked' : ordinal(s.percentile)}; ${tags.join('; ')})${pair ? ` EPA per snap with it ${display('sgn3', pair[0])}, without ${display('sgn3', pair[1])}` : ''}${tell ? `. ${m.what}` : ''}`)
    }
    if (rows.length) L.push(group, ...rows)
  }
  if (missing.length) L.push(`No value for this unit: ${missing.map((m) => m.label).join(', ')}.`)

  const structured = {
    season: u.season,
    team: u.team,
    side: SIDE[u.side],
    first_week: u.wk[0],
    last_week: u.wk[1],
    caller: u.caller,
    confirmed: u.sure,
    head_coaches: u.hc,
    snaps: u.plays,
    games: u.games,
    ranked: !u.small,
    pool: peers,
    pool_size: n,
    through_week: partial,
    stats,
    no_value: missing,
  }
  // The two charting panels an offence's page draws below its bars.
  if (u.routes) {
    structured.route_mix = u.routes.map((r) => ({ route: r[0].toLowerCase(), share_pct: r[1], league_pct: r[2] }))
    if (explained) {
      L.push(`Where the ball went, by the targeted receiver's route (his share, then the ${u.season} league average): ${structured.route_mix.map((r) => `${r.route} ${r.share_pct.toFixed(1)}%${r.league_pct == null ? '' : ` (lg ${r.league_pct.toFixed(1)}%)`}`).join(', ')}.`)
      say(notes, L, 'Route mix: only the targeted receiver\'s route is charted publicly, so this is the route tree of his completions and incompletions, not his play designs.')
    }
  }
  if (u.looks) {
    const k = u.looks
    const lean = (c) => (c[3] == null ? null : c[2] - c[3])
    structured.tell_grid = {
      looks: k.cells.map((c) => ({ look: c[0], snaps: c[1], pass_pct: c[2], league_pass_pct: c[3], lean: lean(c), play_action_pct: c[4], epa_per_snap: c[5] })),
      shown_snaps: k.shown,
      total_snaps: k.total,
      predictability: k.pred ? { from_situation: k.pred[0], from_league_by_look: k.pred[1], from_his_tendencies: k.pred[2] } : null,
      what_a_look_is: meta.notes.looks[u.era] || null,
    }
    if (explained) {
      const pc = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)
      const signedLean = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}`)
      L.push(`The tell grid, first and second down with the game in the balance: his ${k.cells.length} most-used looks (${thousands(k.shown)} of ${thousands(k.total)} snaps). ${meta.notes.looks[u.era] || ''}`.trim())
      if (k.pred) L.push(`A defence calling run or pass would be right ${k.pred[0].toFixed(0)}% of the time from the situation alone, ${k.pred[1].toFixed(0)}% knowing the league's tendencies by look, ${k.pred[2].toFixed(0)}% knowing his.`)
      for (const c of k.cells) L.push(`- ${c[0]}: ${c[1]} snaps, pass ${pc(c[2])} against ${pc(c[3])} for the league from the same spots (lean ${signedLean(lean(c))}), play-action ${pc(c[4])}, EPA/snap ${display('sgn3', c[5])}`)
      say(notes, L, 'Tell grid: a positive lean means he passes more than the league does from the same look in the same down, distance, score and clock; a negative lean, that he runs more.')
    }
  }
  if (u.comps) {
    structured.most_similar_units = u.comps.map((c) => ({ caller: c[0], season: c[1], team: c[2], closer_than_pct_of_pairs: c[3] }))
    L.push(`${u.side === 'O' ? 'Offences' : 'Defences'} that looked most like this one, matched on style only: ${u.comps.map((c) => `${c[0]}'s ${c[1]} ${c[2]} (closer than ${pairShare(c[3])}% of pairs)`).join(', ')}.`)
  }
  if (u.arrival && u.arrival.changes.length) {
    const a = u.arrival
    const byKey = new Map(defs.map((m) => [m.key, m]))
    const before = a.prev ? `${a.caller}'s ${unitTitle(a.prev)} (${weeks(a.prev.wk)})` : `${a.caller}'s unit before him`
    structured.changed_on_arrival = {
      previous_caller: a.caller,
      changes: a.changes.map((c) => ({ key: c[0], label: byKey.get(c[0]).label, before: c[1], after: c[2] })),
    }
    L.push(`What changed when he took it over, against ${before}: ${a.changes.map((c) => `${byKey.get(c[0]).label} ${display(byKey.get(c[0]).unit, c[1])} to ${display(byKey.get(c[0]).unit, c[2])}`).join('; ')}. These are the biggest moves relative to each season's league; a new roster moves numbers too.`)
  }
  return { structured, lines: L }
}

// ---- profile -------------------------------------------------------------------------

export async function coachProfile({ coach, group = 'all', season }) {
  const meta = await loadMeta()
  const who = await resolveCoach(coach)
  const p = (await loadProfiles()).people[who.name]
  if (!p) throw new SavantError(`Coaching Savant has no page for ${who.name} right now. Try again in a minute.`)

  const rules = meta.rules
  const want = (g) => group === 'all' || group === g
  const wantsUnits = want('play_calling')

  // Which units to give in full: his for the season asked for, else the one the page opens.
  let unitRows = []
  if (season != null) {
    if (!wantsUnits) throw new SavantError(`"season" picks which of his play-calling units to return, so it goes with group "play_calling" or "all", not "${group}".`)
    const years = rules.unitSeasons
    if (!years.includes(season)) throw new SavantError(`Coaching Savant has play-calling units for ${years[0]} through ${years[years.length - 1]}, not ${season}.`)
    const mine = p.calls ? p.calls.units : []
    unitRows = mine.filter((u) => u.season === season)
    if (!unitRows.length) {
      const called = mine.length ? ` He called: ${mine.map((u) => unitTitle(u)).join(', ')}.` : ` He is not credited with calling plays in any season since ${rules.callersFrom}.`
      throw new SavantError(`${p.name} is not credited with calling the offence or the defence in ${season}.${called}`)
    }
  } else if (wantsUnits && p.calls && p.calls.pick) {
    unitRows = p.calls.units.filter((u) => u.id === p.calls.pick)
  }

  const notes = []
  const roles = rolesOf(who)
  const structured = {
    coach: { id: p.name, name: p.name, roles, url: coachUrl(p.name) },
    group,
    season_in_progress: null,
    head_coach: null,
    notes,
    url: coachUrl(p.name),
    data_as_of: day(meta.generated),
    source: SOURCE,
  }
  const L = [`${p.name}: NFL ${roles.join(' and ')}`]

  const live = inProgress(meta, p)
  if (p.hc) {
    const h = headCoach(meta, p, notes)
    structured.head_coach = h.structured
    L.push(...h.lines)
  } else {
    L.push(`No head-coaching record since ${meta.firstSeason} on Coaching Savant.`)
  }
  if (live) {
    structured.season_in_progress = { season: live.season, through_week: live.through_week }
    const note = live.hc
      ? `${live.season} is counted through week ${live.through_week} of its regular season. It still counts as one of his seasons: in the season count, in the playoff rate, and toward the ${rules.minSeasons}-season line for ranking.`
      : `His ${live.season} play-calling is counted through week ${live.through_week} of the regular season.`
    say(notes, L, note)
  }

  if (p.hc && want('career')) {
    const c = careerStats(meta, p, notes)
    structured.career_stats = c.stats
    structured.not_shown = c.notRanked
    L.push('', ...c.lines)
  }
  if (p.hc && want('fourth_downs')) {
    const d = fourthDowns(meta, p, notes, group === 'fourth_downs')
    structured.fourth_downs = d.structured
    L.push('', ...d.lines)
  }
  if (want('lineage')) {
    const t = lineage(meta, p, notes)
    structured.lineage = t.structured
    L.push('', ...t.lines)
  }
  if (p.hc && want('seasons')) {
    const s = seasonRows(meta, p, group === 'seasons')
    structured.seasons = s.rows
    L.push('', ...s.lines)
  }
  if (want('play_calling')) {
    const c = playCalling(meta, p, notes)
    structured.play_calling = c.structured
    L.push('', ...c.lines)
    structured.units = []
    // Asked for on its own, play-calling explains each stat; in the overview the rows stay short.
    const explained = group === 'play_calling' ? new Set() : null
    for (const row of unitRows) {
      const file = await loadUnits(row.season)
      const u = file.units[row.id]
      if (!u) throw new SavantError(`Coaching Savant's ${row.season} units could not be read right now. Try again in a minute.`)
      const d = unitDetail(meta, file, u, notes, explained)
      structured.units.push(d.structured)
      L.push('', ...d.lines)
    }
    if (p.calls && p.calls.units.length > unitRows.length) {
      L.push('', `That is ${unitRows.length === 1 ? 'one' : unitRows.length} of the ${p.calls.units.length} units he called${season == null ? ', the one his page opens on' : ''}. Give "season" for another.`)
    }
  }
  if (!p.hc && !want('play_calling') && !want('lineage')) {
    L.push('', `He has no head-coaching record, so there is nothing in "${group}" for him. His page is play-calling: ask for group "play_calling".`)
  }

  L.push('', `Page: ${structured.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the Leaders boards ----------------------------------------------------------------

// The boards on the page's front screen, as leaders.json holds them: every row, in the
// page's order. The page shows ten.
export async function coachingLeaders({ board = 'all', limit = 10 } = {}) {
  const [meta, file] = await Promise.all([loadMeta(), loadLeaders()])
  const boards = board === 'all' ? file.boards : file.boards.filter((b) => b.id === board)
  if (!boards.length) throw new SavantError(`Coaching Savant has no "${board}" board right now. It has: ${file.boards.map((b) => b.id).join(', ')}.`)

  const notes = []
  const L = []
  const out = boards.map((b) => {
    const rows = b.rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      team: r.team || null,
      season: b.season,
      value: r.value,
      display: r.display,
      confirmed: b.kind === 'unit' ? r.sure : null,
    }))
    L.push('', `${b.title}${b.season ? ` — ${b.season}` : ''} (${b.kind === 'unit' ? 'play-callers' : 'head coaches'}; pool: ${b.pool}, ${b.rows.length} in all${b.rows.length > rows.length ? `, top ${rows.length} shown` : ''})`)
    for (const r of rows) L.push(`${r.rank}. ${r.name}${r.team ? ` (${r.team})` : ''}${r.confirmed === false ? ' (unconfirmed)' : ''}: ${r.display}`)
    if (b.note) L.push(b.note)
    return { id: b.id, title: b.title, kind: b.kind === 'unit' ? 'unit' : 'coach', season: b.season, pool: b.pool, pool_size: b.rows.length, note: b.note, rows }
  })
  const head = boards.length === 1 ? `Coaching Savant's "${boards[0].title}" board` : `Coaching Savant's ${boards.length} Leaders boards`
  const lines = [`${head}, as the page's front screen orders them (the page shows the top ${file.shown}).`]
  if (boards.some((b) => b.kind !== 'unit') && file.current && file.current.week != null) {
    notes.push(`Career figures include the ${file.current.season} season, counted through week ${file.current.week}.`)
  }
  if (boards.some((b) => b.kind === 'unit')) {
    notes.push('The play-caller boards rank one season\'s units (one man calling one side for one team), credited to the man the page names as calling them.')
    if (meta.notes.callers) notes.push(`About the play-callers: ${meta.notes.callers}`)
    if (out.some((b) => b.rows.some((r) => r.confirmed === false))) notes.push(`Unconfirmed: ${meta.notes.unconfirmed}`)
  }
  const structured = { board, limit, boards: out, notes, url: file.page, data_as_of: day(meta.generated), source: SOURCE }
  const text = [...lines, ...notes, ...L, '', `Page: ${file.page}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`]
  return { structured, text: text.join('\n').replace(/\n{3,}/g, '\n\n') }
}

// ---- the tree --------------------------------------------------------------------------

const preparedTree = new WeakMap()
async function loadTreeIndex() {
  const file = await loadTree()
  let rows = preparedTree.get(file)
  if (!rows) { rows = prepare(Object.keys(file.nodes).map((name) => ({ name }))); preparedTree.set(file, rows) }
  return { file, rows }
}

// The coaching tree on the #tree page: with no coach, the trees and how big each is; with a
// coach, his line back to the root of his tree and everyone beneath him, to a depth.
export async function coachingTree({ coach, depth = 3 } = {}) {
  const [meta, { file, rows }, people] = await Promise.all([loadMeta(), loadTreeIndex(), loadPeople()])
  const N = file.nodes
  const byName = new Map(people.map((r) => [r.name, r]))
  const recordOf = (name) => { const r = byName.get(name); return r && r.hc ? `${record(r.w, r.l, r.t)}, ${plural(r.seasons, 'season')}` : null }
  const caveat = `About the lineage: ${file.note}`
  const notes = [caveat]

  if (!coach) {
    const trees = file.roots.filter((r) => r[1] > 1)
    const sprouts = file.roots.filter((r) => r[1] === 1).map((r) => r[0])
    const structured = {
      coach: null,
      trees: trees.map(([name, size]) => ({ root: name, size, has_page: N[name].p, branches: N[name].k.map((k) => ({ name: k, size: N[k].s })) })),
      no_lineage: sprouts,
      notes,
      url: file.page,
      data_as_of: day(meta.generated),
      source: SOURCE,
    }
    const L = [`Coaching Savant's coaching tree: ${trees.reduce((n, t) => n + t[1], 0)} coaches in ${trees.length} trees, biggest first, and ${sprouts.length} head coaches with no recorded lineage.`, caveat, '']
    for (const t of structured.trees) L.push(`- ${t.root} tree: ${t.size} coaches. Under him: ${t.branches.map((b) => `${b.name} (${b.size})`).join(', ')}.`)
    L.push('', `No recorded lineage: ${sprouts.join(', ')}.`, '', 'A number in brackets is the size of that coach\'s branch, himself included.', `Page: ${file.page}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
    return { structured, text: L.join('\n') }
  }

  // The name has to be one person in the tree.
  const raw = String(coach).trim()
  let name = N[raw] ? raw : null
  if (!name) {
    const ranked = rank(rows, raw)
    const best = topTier(ranked)
    if (best.length === 1 && ranked[0].score >= 60) name = best[0].name
    else if (ranked.length) {
      const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
      throw new SavantError(`${best.length > 1 ? `${best.length} coaches in the tree match "${raw}"` : `"${raw}" is not an exact match`}. Call again with one of these names:\n${list.map((r) => `- ${r.name}${recordOf(r.name) ? `: head coach, ${recordOf(r.name)}` : ''}`).join('\n')}`)
    }
  }
  if (!name) {
    const caller = rank(people, raw).find((r) => r.score >= 60)
    if (caller) throw new SavantError(`${caller.row.name} is not in Coaching Savant's coaching tree: the tree holds head coaches and the men they learned under, and no lineage is recorded for him. His page: ${coachUrl(caller.row.name)}`)
    throw new SavantError(`Nobody in Coaching Savant's coaching tree matches "${raw}". Call with no coach for the list of trees, or search with nfl_search_coaches.`)
  }

  const me = N[name]
  const line = []
  for (let at = me.m, seen = new Set([name]); at && !seen.has(at); at = N[at] ? N[at].m : null) { seen.add(at); line.push(at) }
  const root = line.length ? line[line.length - 1] : name
  const branch = []
  let deeper = 0
  const walk = (n, d) => {
    for (const k of N[n].k) {
      if (d > depth) { deeper += N[k].s; continue }
      branch.push({ name: k, depth: d, under: n, role: N[k].r, branch_size: N[k].s, has_page: N[k].p, record: recordOf(k) })
      walk(k, d + 1)
    }
  }
  walk(name, 1)

  const structured = {
    coach: {
      name,
      has_page: me.p,
      url: me.p ? coachUrl(name) : null,
      record: recordOf(name),
      mentor: me.m,
      role_under_mentor: me.r,
      also_shaped_by: me.a.map((a) => ({ name: a[0], role: a[1] })),
      line: line.map((n) => ({ name: n, has_page: N[n].p })),
      root,
      branch_size: me.s - 1,
    },
    depth,
    branch,
    not_shown: deeper,
    notes,
    url: file.page,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }
  const L = [`${name} in Coaching Savant's coaching tree${structured.coach.record ? ` (head coach, ${structured.coach.record})` : me.p ? '' : ' (no head-coaching record since 1999, so no page of his own)'}.`, caveat, '']
  if (me.m) L.push(`Learned under ${me.m}: ${me.r}.${me.a.map((a) => ` Also shaped by ${a[0]}: ${a[1]}.`).join('')}`)
  L.push(line.length ? `Line back to the root: ${[name, ...line].join(' ← ')}. Traces back to the ${root} tree.` : `He is the root of his own tree: no mentor is recorded for him, which means the lineage is missing, not that he learned it alone.`)
  if (!branch.length) L.push('', 'Nobody in the tree learned under him.')
  else {
    L.push('', `Beneath him: ${plural(me.s - 1, 'coach', 'coaches')}${deeper ? `, ${branch.length} shown to depth ${depth} (${deeper} deeper)` : ''}, the biggest branch first as the page draws them:`)
    for (const b of branch) {
      L.push(`${'  '.repeat(b.depth - 1)}- ${b.name}${b.record ? ` (${b.record})` : b.has_page ? '' : ' (no page)'}${b.branch_size > 1 ? `, ${b.branch_size - 1} beneath him` : ''}${b.depth === 1 && b.role ? `. Under ${name}: ${b.role}` : ''}`)
    }
  }
  L.push('', `Tree: ${file.page}${me.p ? `\nHis page: ${coachUrl(name)}` : ''}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const named = z.object({ name: z.string(), has_page: z.boolean().describe('Whether Coaching Savant has a page for him.') })
const similar = z.object({ name: z.string(), closer_than_pct_of_pairs: z.number().describe('Share of play-caller pairs that sit further apart on style.') })
const calledBy = z.array(z.object({ name: z.string(), confirmed: z.boolean(), first_week: z.number().int(), last_week: z.number().int() }))

const sideShape = z.object({
  years: z.string(),
  teams: z.array(z.string()),
  units: z.number().int(),
  snaps: z.number().int(),
  games: z.number().int(),
  unconfirmed_units: z.number().int().describe('Units where no report names the play-caller.'),
  most_similar: z.array(similar),
  vs_mentors: z.array(similar.extend({ primary_mentor: z.boolean() })),
}).nullable()

const unitShape = z.object({
  season: z.number().int(),
  team: z.string(),
  side: z.string().describe('offence or defence.'),
  first_week: z.number().int(),
  last_week: z.number().int(),
  caller: z.string(),
  confirmed: z.boolean().describe('False when no report names the play-caller.'),
  head_coaches: z.array(z.string()),
  snaps: z.number().nullable(),
  games: z.number().nullable(),
  ranked: z.boolean().describe('False when the unit has too few snaps to rank.'),
  pool: z.string().describe('What the percentiles are ranked against.'),
  pool_size: z.number().int().describe('Units of that season and side with enough snaps to rank.'),
  through_week: z.number().int().nullable().describe('Set on a unit of the season the in-season data covers: the regular-season week it runs through.'),
  stats: z.array(z.object({
    key: z.string(),
    label: z.string(),
    group: z.string(),
    kind: z.string().describe('"how good" (a higher percentile is better) or "how much" (a tendency: higher means more of it).'),
    value: z.number(),
    display: z.string().describe('The value as the site prints it.'),
    percentile: pct.describe('Among the other units of the same season and side. Null when the unit is not ranked.'),
    pool: z.string(),
    pool_size: z.number().int().nullable(),
    lower_is_better: z.boolean().describe('True when a lower value ranks higher. The percentile is already flipped.'),
    epa_with: z.number().nullable().describe('EPA per snap when he used it.'),
    epa_without: z.number().nullable().describe('EPA per snap when he did not.'),
    what: z.string().nullable().describe('The site\'s one-line explanation of the stat.'),
  })),
  no_value: z.array(z.object({ key: z.string(), label: z.string() })).describe('Stats the page has no value for on this unit. Not zero.'),
  route_mix: z.array(z.object({ route: z.string(), share_pct: z.number(), league_pct: z.number().nullable() })).optional().describe('Offences: the targeted receiver\'s route, his share and the season\'s league average, biggest first.'),
  tell_grid: z.object({
    looks: z.array(z.object({
      look: z.string(), snaps: z.number().int(), pass_pct: z.number(), league_pass_pct: z.number().nullable(),
      lean: z.number().nullable().describe('pass_pct minus league_pass_pct: positive leans pass.'),
      play_action_pct: z.number().nullable(), epa_per_snap: z.number().nullable(),
    })),
    shown_snaps: z.number().int(),
    total_snaps: z.number().int(),
    predictability: z.object({ from_situation: z.number(), from_league_by_look: z.number(), from_his_tendencies: z.number() }).nullable().describe('How often run or pass would be called right, in %.'),
    what_a_look_is: z.string().nullable(),
  }).optional().describe('Offences: his most-used looks on early downs with the game in the balance.'),
  most_similar_units: z.array(z.object({ caller: z.string(), season: z.number().int(), team: z.string(), closer_than_pct_of_pairs: z.number() })).optional(),
  changed_on_arrival: z.object({
    previous_caller: z.string(),
    changes: z.array(z.object({ key: z.string(), label: z.string(), before: z.number(), after: z.number() })),
  }).optional(),
})

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'nfl_search_coaches',
    config: {
      title: 'Search NFL coaches',
      description:
        'Find NFL head coaches and play-callers in Coaching Savant (Western Conference Elitists, wcehoops.com) by name. Covers every head coach since 1999 and every offensive and defensive play-caller since 2018. Returns each match with his roles, teams, first and last season, head-coaching record if he has one, and the link to his page. The name is the id. Matching ignores accents and punctuation and tolerates small typos.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Coach name or part of one, e.g. "Reid", "Sean McVay", "Harbaugh".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many coaches matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        coaches: z.array(z.object({
          id: z.string().describe('His name, which is the id for nfl_get_coach_profile.'),
          name: z.string(),
          roles: z.array(z.string()).describe('head coach, offence play-caller, defence play-caller.'),
          teams: z.array(z.string()),
          first_season: z.number().int().nullable(),
          last_season: z.number().int().nullable(),
          head_coach_record: z.string().nullable().describe('Regular-season wins–losses(–ties) as a head coach since 1999.'),
          head_coach_seasons: z.number().int().nullable(),
          url: z.string().describe('His Coaching Savant page.'),
        })),
      },
      annotations: { title: 'Search NFL coaches', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchCoaches({ query, limit }),
  },
  {
    name: 'nfl_get_coach_profile',
    config: {
      title: 'Get an NFL coach\'s Savant profile',
      description:
        'Get one NFL head coach\'s or play-caller\'s Coaching Savant profile (Western Conference Elitists, wcehoops.com). For a head coach since 1999: regular-season and playoff record, Super Bowls, wins against what the closing betting spreads expected, his career stats each with a percentile against the head coaches with at least three seasons, his fourth-down decisions scored by the nfl4th model, his seasons one by one with who called the offence and defence, and the coach he learned under. For a play-caller since 2018: the units he called, and one unit in full, every stat with its percentile against the other offences or defences of that season. Each percentile is returned with the pool it was ranked in. Coaches and units too short to rank are returned unranked. The lineage and the play-caller attribution are hand-curated and are returned with that caveat. Includes the link to his page.',
      inputSchema: {
        coach: z.string().trim().min(1).max(80).describe('Coach name, e.g. "Andy Reid". If a name fits more than one coach, the error lists them.'),
        group: z.enum(GROUPS).default('all').describe('Which part to return: "all" (default), "career" (ranked career stats), "fourth_downs" (with the calls the model liked least), "seasons" (season by season, every column), "play_calling" (what he called, one unit in full with each stat explained) or "lineage".'),
        season: z.number().int().min(1990).max(2100).optional().describe('With "play_calling" or "all": the season whose unit to return in full, e.g. 2024. Omit for the unit his page opens on, his most recent one with enough snaps to rank.'),
      },
      outputSchema: {
        coach: z.object({ id: z.string(), name: z.string(), roles: z.array(z.string()), url: z.string() }),
        group: z.string(),
        season_in_progress: z.object({ season: z.number().int(), through_week: z.number().int() }).nullable().describe('Set when his numbers include the season the in-season data covers: that season, and the regular-season week it runs through.'),
        head_coach: z.object({
          teams: z.array(z.string()),
          first_season: z.number().int(),
          last_season: z.number().int(),
          seasons: z.number().int().describe('Seasons as a head coach since 1999, a season in progress included.'),
          wins: z.number().int().describe('Regular season.'),
          losses: z.number().int(),
          ties: z.number().int(),
          win_pct: z.number().nullable().describe('Regular season, in percent.'),
          playoff_wins: z.number().int(),
          playoff_losses: z.number().int(),
          playoff_seasons: z.number().int().describe('Seasons that reached the playoffs.'),
          super_bowls_won: z.number().int(),
          super_bowls_lost: z.number().int(),
          best_season_wins: z.number().int().nullable(),
          wins_above_expectation: z.number().nullable().describe('Wins beyond what the closing betting spreads implied, over his career.'),
          ranked: z.boolean().describe('Whether he has the three seasons the page asks for before ranking a career.'),
        }).nullable().describe('Null for someone who has only called plays.'),
        career_stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string().describe('Record, Units, Style or Fourth downs.'),
          value: z.number(),
          display: z.string().describe('The value as the site prints it.'),
          percentile: pct.describe('Within the pool named beside it.'),
          pool: z.string().describe('What the percentile is ranked against.'),
          pool_size: z.number().int(),
          lower_is_better: z.boolean().describe('True when a lower value ranks higher. The percentile is already flipped.'),
          seasons_covered: z.number().int().nullable().describe('Set when the figure is averaged over only some of his seasons.'),
          what: z.string().nullable().describe('The site\'s one-line explanation of the stat.'),
        })).optional(),
        not_shown: z.array(z.object({ key: z.string(), label: z.string(), reason: z.string() })).optional().describe('Career stats the page does not show for him, and why. Not zero.'),
        fourth_downs: z.object({
          first_season: z.number().int().nullable(),
          last_season: z.number().int().nullable(),
          judged: z.number().int().describe('Fourth downs scored by the model.'),
          games: z.number().int().nullable(),
          clear_go_taken_pct: z.number().nullable(),
          clear_go_taken: z.number().int(),
          clear_go_spots: z.number().int().describe('Fourth downs where going was worth 4+ points of win probability.'),
          close_calls_taken_pct: z.number().nullable(),
          close_calls_taken: z.number().int(),
          close_call_spots: z.number().int().describe('Fourth downs where going was worth 1 to 4 points.'),
          win_probability_lost_per_game: z.number().nullable(),
          small_sample: z.boolean(),
          calls_the_model_liked_least: z.array(z.object({
            season: z.number().int(), week: z.number().int(), opponent: z.string(), to_go: z.number().int(), spot: z.string(),
            quarter: z.number().int(), clock: z.string(), score_margin: z.number().nullable(), chose: z.string(),
            model_preferred: z.string(), win_probability_lost: z.number(),
          })).optional(),
        }).nullable().optional(),
        seasons: z.array(z.object({
          season: z.number().int(),
          team: z.string(),
          wins: z.number().int(),
          losses: z.number().int(),
          ties: z.number().int(),
          playoff_round: z.string().nullable().describe('The furthest round reached.'),
          won_super_bowl: z.boolean(),
          through_week: z.number().int().nullable().describe('Set on the season the in-season data covers: the regular-season week it runs through.'),
          wins_above_expectation: z.number().nullable(),
          offence_epa: z.number().nullable(),
          defence_epa: z.number().nullable(),
          pass_rate: z.number().nullable(),
          pass_rate_over_expected: z.number().nullable(),
          fourth_down_aggression: z.number().nullable(),
          fourth_down_wp_lost: z.number().nullable(),
          plays_called_by: z.object({ offence: calledBy, defence: calledBy }).nullable().describe('Recorded from 2018.'),
        })).optional().describe('Newest first. A null is a number the page does not have, not a zero.'),
        lineage: z.object({
          mentor: z.string().nullable(),
          role_under_mentor: z.string().nullable(),
          also_shaped_by: z.array(z.object({ name: z.string(), role: z.string() })),
          chain: z.array(named).describe('His mentor, that man\'s mentor, and so on back to the root.'),
          root: z.string().nullable(),
          coached_under_him: z.array(named),
        }).nullable().optional().describe('Hand-curated. Null when none is recorded.'),
        play_calling: z.object({
          seasons_calling: z.number().int(),
          offence: sideShape,
          defence: sideShape,
          units: z.array(z.object({
            season: z.number().int(), team: z.string(), side: z.string(), first_week: z.number().int(), last_week: z.number().int(),
            snaps: z.number().nullable(), games: z.number().nullable(), confirmed: z.boolean(), ranked: z.boolean(),
          })),
        }).nullable().optional().describe('Null when he is not credited with calling plays.'),
        units: z.array(unitShape).optional().describe('The unit or units returned in full.'),
        notes: z.array(z.string()).describe('How to read the numbers: the pools, what is hand-curated, and any caution that applies to this coach.'),
        url: z.string().describe('His Coaching Savant page.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NFL coach\'s Savant profile', ...READ_ONLY },
    },
    run: ({ coach, group, season }) => coachProfile({ coach, group, season }),
  },
  {
    name: 'nfl_coaching_leaders',
    config: {
      title: 'Get Coaching Savant\'s Leaders boards',
      description:
        'The Leaders boards on Coaching Savant\'s front screen (Western Conference Elitists, wcehoops.com), in the page\'s order. Head coaches since 1999 with three or more seasons: most wins, wins above what the closing spreads expected, playoff rate, fourth-down aggression, pass rate over expected, fastest tempo; with 48+ games of fourth-down data: best fourth-down decisions. Play-callers, latest season: most pre-snap motion, most blitzing defence, hardest offence to read. Each board names its pool and its size. The page shows ten a board; more can be asked for.',
      inputSchema: {
        board: z.enum(['all', ...BOARD_IDS]).default('all').describe(`One board, or "all" (default): ${BOARD_IDS.join(', ')}.`),
        limit: z.number().int().min(1).max(50).default(10).describe('Rows per board (1-50, default 10, as on the page).'),
      },
      outputSchema: {
        board: z.string(),
        limit: z.number().int(),
        boards: z.array(z.object({
          id: z.string(),
          title: z.string().describe('As the page prints it.'),
          kind: z.string().describe('"coach" for a career board, "unit" for one season\'s play-calling units.'),
          season: z.number().int().nullable().describe('Unit boards: the season ranked.'),
          pool: z.string().describe('Who is ranked.'),
          pool_size: z.number().int(),
          note: z.string().nullable().describe('The page\'s caption under the board.'),
          rows: z.array(z.object({
            rank: z.number().int(),
            name: z.string().describe('Coach or play-caller; the id for nfl_get_coach_profile.'),
            team: z.string().nullable(),
            season: z.number().int().nullable(),
            value: z.number(),
            display: z.string().describe('As the page prints it.'),
            confirmed: z.boolean().nullable().describe('Unit boards: false when no report names the play-caller.'),
          })),
        })),
        notes: z.array(z.string()),
        url: z.string(),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get Coaching Savant\'s Leaders boards', ...READ_ONLY },
    },
    run: ({ board, limit }) => coachingLeaders({ board, limit }),
  },
  {
    name: 'nfl_coaching_tree',
    config: {
      title: 'Get the NFL coaching tree',
      description:
        'Coaching Savant\'s coaching tree (Western Conference Elitists, wcehoops.com): who learned under whom among NFL head coaches since 1999 and the men they learned from, back to roots such as Paul Brown. With a coach: his mentor and role under him, his line back to the root of his tree, and everyone beneath him to a depth, biggest branch first as the page draws it, with head-coaching records. Without one: every tree and its size. Covers men with no page of their own, such as Bill Walsh. The lineage is hand-curated, not from a dataset, and comes with the page\'s caveat.',
      inputSchema: {
        coach: z.string().trim().min(1).max(80).optional().describe('A name in the tree, e.g. "Bill Walsh" or "Andy Reid". Omit for every tree. If a name fits more than one coach, the error lists them.'),
        depth: z.number().int().min(1).max(10).default(3).describe('How many generations beneath him to list (1-10, default 3).'),
      },
      outputSchema: {
        coach: z.object({
          name: z.string(),
          has_page: z.boolean(),
          url: z.string().nullable(),
          record: z.string().nullable().describe('Regular-season head-coaching record since 1999 and seasons.'),
          mentor: z.string().nullable(),
          role_under_mentor: z.string().nullable(),
          also_shaped_by: z.array(z.object({ name: z.string(), role: z.string() })),
          line: z.array(z.object({ name: z.string(), has_page: z.boolean() })).describe('His mentor, that man\'s mentor, and so on to the root.'),
          root: z.string(),
          branch_size: z.number().int().describe('Everyone beneath him, at any depth.'),
        }).nullable(),
        depth: z.number().int().optional(),
        branch: z.array(z.object({
          name: z.string(), depth: z.number().int().describe('1 learned under him directly.'), under: z.string(),
          role: z.string().nullable().describe('His role under the coach above him.'), branch_size: z.number().int().describe('Himself and everyone beneath him.'),
          has_page: z.boolean(), record: z.string().nullable(),
        })).optional().describe('Depth first, biggest branch first.'),
        not_shown: z.number().int().optional().describe('Coaches beneath him deeper than depth.'),
        trees: z.array(z.object({ root: z.string(), size: z.number().int(), has_page: z.boolean(), branches: z.array(z.object({ name: z.string(), size: z.number().int() })) })).optional().describe('Without a coach: every tree, biggest first.'),
        no_lineage: z.array(z.string()).optional().describe('Without a coach: head coaches with no recorded mentor and nobody under them.'),
        notes: z.array(z.string()),
        url: z.string(),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get the NFL coaching tree', ...READ_ONLY },
    },
    run: ({ coach, depth }) => coachingTree({ coach, depth }),
  },
]
