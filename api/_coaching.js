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
// their numbers.
//
// THE FOURTH-DOWN VIEW CARRIES EVERY FOURTH-DOWN NUMBER
// The page files "Fourth-down aggression" and "Fourth-down go rate" under Style, in the career
// profile, and the model's verdicts under Fourth downs. Asked for fourth downs, a caller
// wants both, so group "fourth_downs" gives the model's verdicts and then all six ranked
// fourth-down stats, each with its percentile and its own pool.
//
// LEADERBOARD
// nfl_get_coach_leaderboard ranks head coaches by one career stat, by the rule the page's
// front-page boards use: head coaches with three seasons (and, for the fourth-down model's
// stats, 48 games in its data) who have a value.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, boardSlice, day, findStat, makeLoader, miss, norm, ordinal, prepare, prepareStats, rank, ranked, thousands, topTier } from './_core.js'

const files = makeLoader('savant-api/coaching/v1', { what: 'Coaching Savant' })

export const GROUPS = ['all', 'career', 'fourth_downs', 'seasons', 'play_calling', 'lineage']
const SIDE = { O: 'offence', D: 'defence' }
const SIDE_PLURAL = { O: 'offences', D: 'defences' }
const SOURCE = 'Coaching Savant, Western Conference Elitists (wcehoops.com)'

const loadMeta = () => files.load('meta.json')
const loadProfiles = () => files.load('profiles/all.json')
const loadUnits = (season) => files.load(`units/${season}.json`)

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

// The pool a career stat is ranked in, in words.
const isD4 = (m) => m.key.startsWith('d4_')
const poolText = (meta, m) => (isD4(m)
  ? `head coaches with at least ${meta.rules.d4MinGames} games in the fourth-down data, which starts in ${meta.rules.d4From}`
  : `head coaches with at least ${meta.rules.minSeasons} seasons since ${meta.firstSeason}`)

// Every ranked stat about fourth downs, wherever the page files it: the two under Style and
// the model's four. Each with its percentile and the pool it was ranked in.
const FOURTH_DOWN_STYLE = ['go_oe', 'go_rate']
function fourthDownRanks(meta, p, notes) {
  const h = p.hc
  const wanted = meta.metrics.filter((m) => FOURTH_DOWN_STYLE.includes(m.key) || isD4(m))
  const L = ['How he ranks on fourth down']
  if (!h.qualified) {
    say(notes, L, `Career stats are not ranked for him: fewer than ${meta.rules.minSeasons} seasons as a head coach, too short to rank against other coaches without inventing precision. His seasons carry the numbers.`)
    return { stats: [], lines: L }
  }
  const stats = []
  const missing = []
  for (const m of wanted) {
    const cell = h.m[m.key]
    if (!cell) { missing.push(m); continue }
    stats.push({
      key: m.key,
      label: m.label,
      value: cell[0],
      display: display(m.unit, cell[0]),
      percentile: cell[1],
      pool: poolText(meta, m),
      pool_size: m.pool,
      lower_is_better: m.lowerIsBetter,
      what: m.what,
    })
  }
  for (const st of stats) {
    L.push(`- ${st.label}: ${st.display} (${st.percentile == null ? 'not ranked' : `${ordinal(st.percentile)} percentile`} among ${st.pool_size} ${st.pool})${st.lower_is_better ? ' [lower is better]' : ''}${st.what ? `. ${st.what}` : ''}`)
  }
  if (new Set(stats.map((st) => st.pool)).size > 1) say(notes, L, 'These come from two pools, so the same percentile means a different thing in each: aggression and go rate cover his whole head-coaching career back to 1999, the model\'s stats only the seasons it covers.')
  say(notes, L, 'A higher percentile means a higher value, except on a stat tagged "lower is better", where the page flips it. Aggression and go rate are tendencies: higher means he goes for it more, which is not the same as deciding better. The model\'s stats are the ones that judge the decisions.')
  if (missing.length) L.push(`Not shown for him: ${missing.map((m) => m.label).join(', ')} (ranked only with ${meta.rules.d4MinGames} games in the fourth-down data, which starts in ${meta.rules.d4From}).`)
  return { stats, lines: L }
}

// ---- leaderboard -----------------------------------------------------------------------

// Head coaches ranked by one career stat, the way the page's front-page boards do it: coaches
// with three seasons who have a value, best first (lowest first where lower is better). The
// files hold a ranked stat only for a coach who is in its pool, so "has the stat" is the pool.
const WINS = { key: 'wins', label: 'Wins', group: 'Record', unit: 'num0', lowerIsBetter: false, what: 'Regular-season games he has won as a head coach since 1999.', record: true }
const statIndex = new WeakMap()
function statsOf(meta) {
  let rows = statIndex.get(meta)
  if (!rows) { rows = prepareStats([WINS, ...meta.metrics]); statIndex.set(meta, rows) }
  return rows
}

export async function coachLeaderboard({ stat, limit = 10, order = 'top' }) {
  const meta = await loadMeta()
  const stats = statsOf(meta)
  let m
  try { m = findStat(stats, stat, { what: 'coaching stat' }) } catch (err) {
    if (!(err instanceof SavantError) || /could be more than one/.test(err.message)) throw err
    throw new SavantError(`${err.message} The career stats Coaching Savant ranks: ${stats.map((x) => `${x.label} (key "${x.key}")`).join(', ')}.`)
  }
  const people = Object.values((await loadProfiles()).people).filter((p) => p.hc && p.hc.qualified)
  const valueOf = (p) => (m.record ? p.hc.w : p.hc.m[m.key] ? p.hc.m[m.key][0] : null)
  const pool = people.filter((p) => !miss(valueOf(p)))
  const all = ranked(pool, valueOf, { lower: m.lowerIsBetter })
  const shown = boardSlice(all, limit, order)
  const cur = meta.current

  const notes = [
    `Ranked among the ${all.length} ${m.record ? `head coaches with at least ${meta.rules.minSeasons} seasons since ${meta.firstSeason}` : poolText(meta, m)}. Career figures are weighted by games. A coach with a shorter record is not ranked, whatever his number.`,
  ]
  if (m.lowerIsBetter) notes.push(`${m.label} is a lower-is-better stat, so the lowest value is 1st.`)
  if (order === 'bottom') notes.push(`This is the bottom of the board, worst first. Places are counted from the top: ${all.length ? ordinal(all[all.length - 1].rank) : 'last'} is last.`)
  if (m.group === 'Style') notes.push(`${m.label} is a tendency: leading it means the most of it, not the best.`)
  if (m.since && m.since > meta.firstSeason) notes.push(`${m.label} is tracked from ${m.since}, so earlier seasons are not in it.`)
  if (cur && cur.week != null) notes.push(`${cur.season} is counted through week ${cur.week} of its regular season for coaches active now.`)
  if (shown.some((r) => r.tied)) notes.push('Equal values share a place.')

  const structured = {
    stat: { key: m.key, label: m.label, group: m.group, what: m.what || null, lower_is_better: m.lowerIsBetter },
    order,
    ranked: all.length,
    count: shown.length,
    leaders: shown.map((r) => {
      const h = r.row.hc
      const cell = m.record ? null : h.m[m.key]
      return {
        rank: r.rank,
        tied: r.tied,
        name: r.row.name,
        value: r.value,
        display: m.record ? record(h.w, h.l, h.t) : display(m.unit, r.value),
        percentile: cell ? cell[1] : null,
        seasons: h.seasons,
        first_season: h.first,
        last_season: h.last,
        teams: h.teams,
        record: record(h.w, h.l, h.t),
        url: coachUrl(r.row.name),
      }
    }),
    notes,
    url: meta.page,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }
  if (!shown.length) return { structured, text: `No head coach has a ranked value for ${m.label}.\n\n${notes.join('\n')}\n\nSource: ${SOURCE}.` }
  const L = [`NFL head coaches by ${m.label}: the ${order === 'bottom' ? 'bottom' : 'top'} ${shown.length} of ${all.length}`]
  if (m.what) L.push(m.what)
  L.push('')
  for (const l of structured.leaders) {
    L.push(`${l.tied ? 'T-' : ''}${l.rank}. ${l.name}: ${l.display}${l.percentile == null ? '' : ` (${ordinal(l.percentile)} percentile)`}, ${span(l.first_season, l.last_season)} (${l.teams.join(', ')}), ${plural(l.seasons, 'season')}${m.record ? '' : `, ${l.record}`}`)
  }
  L.push('', ...notes, '', `Page: ${meta.page}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
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
    // Asked for on its own, the view also carries every ranked fourth-down stat (see the
    // header). In the overview the career profile already has them.
    if (group === 'fourth_downs') {
      const r = fourthDownRanks(meta, p, notes)
      structured.fourth_down_ranks = r.stats
      L.push('', ...r.lines)
    }
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
        group: z.enum(GROUPS).default('all').describe('Which part to return: "all" (default), "career" (ranked career stats), "fourth_downs" (the model\'s verdicts, every ranked fourth-down stat including aggression and go rate, and the calls the model liked least), "seasons" (season by season, every column), "play_calling" (what he called, one unit in full with each stat explained) or "lineage".'),
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
        fourth_down_ranks: z.array(z.object({
          key: z.string(), label: z.string(), value: z.number(), display: z.string(), percentile: pct, pool: z.string(), pool_size: z.number().int(),
          lower_is_better: z.boolean(), what: z.string().nullable(),
        })).optional().describe('With group "fourth_downs": every ranked fourth-down stat (aggression, go rate, and the model\'s four), each with its percentile and pool.'),
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
    name: 'nfl_get_coach_leaderboard',
    config: {
      title: 'Get an NFL head-coach leaderboard',
      description:
        'Rank NFL head coaches by one career stat from Coaching Savant (wcehoops.com), as the page\'s front-page boards do. Use for "which coach is most aggressive on fourth down", "who beats the spread most" instead of looking coaches up one by one. Ranks head coaches since 1999 with three or more seasons; each comes with place, value, percentile, years, teams and record.',
      inputSchema: {
        stat: z.string().trim().min(1).max(60).describe('Key or name: "wins", "winpct", "porate" (playoff rate), "waa" (wins above expectation), "mov_oe" (points vs the spread), "off_epa", "def_epa", "proe" (pass rate over expected), "go_oe" (fourth-down aggression), "go_rate", "sec_play" (tempo), "d4_follow" (follows the fourth-down model), "d4_lost_g" (win probability given away).'),
        limit: z.number().int().min(1).max(25).default(10).describe('Rows to list (default 10).'),
        order: z.enum(['top', 'bottom']).default('top').describe('Best first (default) or worst first.'),
      },
      outputSchema: {
        stat: z.object({ key: z.string(), label: z.string(), group: z.string(), what: z.string().nullable(), lower_is_better: z.boolean() }),
        order: z.string(),
        ranked: z.number().int().describe('How many head coaches the board ranks.'),
        count: z.number().int(),
        leaders: z.array(z.object({
          rank: z.number().int().describe('Place, counted from the top. Equal values share a place.'),
          tied: z.boolean(),
          name: z.string().describe('His name, which is the id for nfl_get_coach_profile.'),
          value: z.number(),
          display: z.string().describe('The value as the site prints it.'),
          percentile: pct,
          seasons: z.number().int(),
          first_season: z.number().int(),
          last_season: z.number().int(),
          teams: z.array(z.string()),
          record: z.string().describe('Regular-season wins–losses(–ties) as a head coach since 1999.'),
          url: z.string(),
        })),
        notes: z.array(z.string()).describe('Who is ranked, and how to read the board.'),
        url: z.string(),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NFL head-coach leaderboard', ...READ_ONLY },
    },
    run: (args) => coachLeaderboard(args),
  },
]
