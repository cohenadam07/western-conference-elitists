// api/_football.js — Football Savant, as answers. One section of the AI connector
// (api/mcp.js): it knows football, the connector only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/football/v1/ (see
// scripts/lib/savant-api-football.mjs): a glossary, a player index, and one file per season
// in which every bar on every card already carries its percentiles. Nothing is computed here
// that the page computes — percentiles, low-sample marks and which stats a card has are
// read, never re-derived — so an answer from this file is the number on the player's card.
// Loading, caching and name matching are shared with the other sections (api/_core.js).
//
// FOOTBALL IS NOT BASKETBALL, AND AN ANSWER HAS TO SAY SO
//   - There is no league-wide percentile. A cornerback and a center share no box score, so
//     every number is "vs. quarterbacks" or "vs. cornerbacks": qualified players at the
//     position he played that season. Each stat carries two, the page's two baselines: his
//     own season, and every season the stat has existed ("all-time").
//   - His position can change from one season to the next (a guard becomes a tackle), and
//     he is ranked with whichever he was that year.
//   - The latest season is usually still being played. Then the answer says through which
//     week, and that the qualifying line is pro-rated.
//   - A stat on too small a sample is marked with how much sample it has and needs; a stat
//     the season did not track is listed as not tracked rather than shown as zero; a pool
//     too small to rank in is called that.
//   - While a season is being played two more things are said. Some rows are estimates
//     (pass-play snaps, a lineman's unit numbers): they come from snap counts until the
//     lineups are published after the season, and are marked. And a stat on a small sample
//     carries where it is likely to settle - the diamond on the page's hollow bars - beside
//     the raw number, never instead of it.
//   - The card link is the page's own: football-savant.html#p=<id>&s=<season>
//
// ONE CAUTION THE PAGE DOES NOT PRINT: before snap counts (2013) an offensive lineman's
// games count is the games he was flagged in, not the games he played (the pipeline's own
// README says so). The numbers are passed through as the page shows them, with that said.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { ALSO_KNOWN, READ_ONLY, SITE, SavantError, day, makeLoader, miss, ordinal, prepare, rank, thousands, topTier } from './_core.js'

// A season file is a couple of megabytes once parsed, so only a handful are held at a time.
const files = makeLoader('savant-api/football/v1', { what: 'Football Savant', maxCached: 8 })

// The `group` input, and the page's panel each one means (meta.groups has the labels).
export const GROUPS = {
  context: 'ctx', passing: 'pass', rushing: 'rush', receiving: 'rec', returns: 'ret', blocking: 'block',
  pass_rush: 'prsh', run_defense: 'rdef', coverage: 'cov', kicking: 'kick', value: 'val', athletic: 'ath',
}

const SOURCE = 'Football Savant, Western Conference Elitists (wcehoops.com)'
// Counts that are worked out from snap share until a season's lineups are published.
const EST_COUNTS = new Set(['pblk', 'rblk', 'opsnap', 'dpsnap', 'drsnap', 'gaprun'])
const SMALL_POOL = 10 // under this many qualified players, an answer says the pool is small

// A card can now run past a hundred rows, and an answer that long is hard to use. When the
// whole card would run over LONG characters, the sections that are the heart of a position
// keep a full line per stat and the detail sections (splits by depth and situation, shares,
// mixes, schedule) are given in brief: value and this-season percentile. Nothing is dropped
// from the structured result, and asking for one panel always gets every line in full.
//
// How long a card runs depends on the calendar: in week 1 nearly every row carries a
// sample and an estimate, by December almost none do. So the shortening is a ladder, not
// one step. If the answer is still over MAX with the detail sections in brief, more
// sections give up their full lines one at a time (measurements first, the position's own
// first section never) until it fits. That makes MAX a ceiling by construction rather than
// a number this season's longest card happens to sit under.
const LONG = 11500
const MAX = 12400
const IN_FULL = new Set(['Efficiency', 'Pocket', 'Accuracy', 'Volume', 'Contact', 'After the catch', 'Hands',
  'Protection (unit, on his snaps)', 'Run game (unit, on his snaps)', 'Discipline', 'Workload', 'Pressure',
  'Finishing', 'Reliability', 'Stops', 'Coverage', 'Ball production', 'Kicking', 'Punting'])
// Panels with no sections of their own, in the order they give up their full lines.
const PANELS_FIRST = ['Athletic profile', 'Context', 'Value']
const sectionOf = (s) => (s.subgroup ? `${s.group}: ${s.subgroup}` : s.group)

// The order in which a card's sections go to "in brief", and how many of them are the
// detail sections that go first whenever a card is long at all.
function shorteningOrder(stats) {
  const seen = []
  const sub = new Map()
  for (const s of stats) { const h = sectionOf(s); if (!sub.has(h)) { sub.set(h, s.subgroup || null); seen.push(h) } }
  const detail = seen.filter((h) => sub.get(h) && !IN_FULL.has(sub.get(h)))
  const panels = seen.filter((h) => !sub.get(h))
  panels.sort((a, b) => (PANELS_FIRST.indexOf(a) + 1 || 99) - (PANELS_FIRST.indexOf(b) + 1 || 99))
  const core = seen.filter((h) => sub.get(h) && IN_FULL.has(sub.get(h))).reverse()
  const order = [...detail, ...panels, ...core]
  // whatever leads the card keeps its full lines to the end
  const keep = core.length ? core[core.length - 1] : seen[0]
  return { order: order.filter((h) => h !== keep), detail: detail.length }
}

const loadMeta = () => files.load('meta.json')

// The data keeps one code per franchise (LV for every Raiders season). What is said is what
// the club was called that season: OAK in 2003. meta.era has the last season of each old name.
const teamIn = (meta, season) => (t) => {
  const e = t && meta.era && meta.era[t]
  return e && +season <= e[0] ? e[1] : t
}
const loadSeason = (season) => files.load(`seasons/${season}.json`)

// The player index: rows arrive as arrays (the file's `cols` names them) and are turned into
// objects, with each name prepared for matching, once per load.
const prepared = new WeakMap()
async function loadPlayers() {
  const file = await files.load('players.json')
  let rows = prepared.get(file)
  if (!rows) {
    const at = Object.fromEntries(file.cols.map((c, i) => [c, i]))
    rows = prepare(file.players.map((r) => ({
      id: r[at.id], name: r[at.name], pos: r[at.pos], team: r[at.team], from: r[at.from], to: r[at.to],
      seasons: r[at.seasons], peak: r[at.peak] || null, skip: r[at.skip] || [],
    })))
    prepared.set(file, rows)
  }
  return rows
}

// One season's rows by player id, built once per loaded file.
const byId = new WeakMap()
function rowsOf(file) {
  let map = byId.get(file)
  if (!map) { map = new Map(file.players.map((p) => [p.id, p])); byId.set(file, map) }
  return map
}

// Among equally good name matches: the more recent player, then the longer career.
const recent = (a, b) => b.to - a.to || b.seasons - a.seasons

// ---- small formatting helpers ----------------------------------------------------------

// The page's own link (its syncURL()): the player and the season, in the hash.
export const cardUrl = (id, season) => `${SITE}/football-savant.html#p=${encodeURIComponent(id)}&s=${season}`

const feetInches = (n) => { const f = Math.floor(n / 12); return `${f}'${Math.round(n - f * 12)}"` }

// The page's signed(): the sign is decided after rounding, so a hair under zero prints as
// zero and not as "−.000".
function signed(v, dp, plus, strip) {
  const mag = Math.abs(v).toFixed(dp)
  const body = strip ? mag.replace(/^0/, '') : mag
  if (!/[1-9]/.test(mag)) return body
  return (v < 0 ? '−' : plus ? '+' : '') + body
}

// A stat's value exactly the way the page prints it (its fmt()).
export function display(unit, value) {
  if (miss(value)) return '—'
  const v = +value
  switch (unit) {
    case 'pct1': return v.toFixed(1) + '%'
    case 'num0': return String(Math.round(v) === 0 ? 0 : Math.round(v))
    case 'num1': return signed(v, 1, false, false)
    case 'num2': return signed(v, 2, false, false)
    case 'num3': return signed(v, 3, false, true)
    case 'sgn3': return signed(v, 3, true, true)
    case 'sgn1': return signed(v, 1, true, false)
    case 'sec': return v.toFixed(2) + 's'
    case 'inch': return v.toFixed(1) + '"'
    case 'lb': return Math.round(v) + ' lb'
    case 'ftin': return feetInches(v)
    default: return String(v)
  }
}

const count = (n) => thousands(Math.round(n * 10) / 10)
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
// "1 targets" -> "1 target", "1 carries" -> "1 carry", "1 targets defended" -> "1 target defended"
function singular(label) {
  const w = label.split(' ')
  for (let i = w.length - 1; i >= 0; i--) {
    if (/ies$/.test(w[i])) { w[i] = w[i].replace(/ies$/, 'y'); break }
    if (/[^s]s$/.test(w[i])) { w[i] = w[i].slice(0, -1); break }
  }
  return w.join(' ')
}
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

// ---- seasons -------------------------------------------------------------------------

// An NFL season is known by the year it starts in: "2025". "2025-26" is taken as 2025.
function parseSeason(input, meta) {
  if (input == null || input === '') return null
  const s = String(input).trim().replace(/[‐-―/]/g, '-')
  const m = s.match(/^(\d{4})(?:-(\d{2}|\d{4}))?$/)
  const last = meta.seasons[0]
  const first = meta.seasons[meta.seasons.length - 1]
  if (!m || (m[2] && +m[2] % 100 !== (+m[1] + 1) % 100)) {
    throw new SavantError(`"${input}" is not an NFL season. Give the year the season began, like ${last}.`)
  }
  if (!meta.seasons.includes(m[1])) throw new SavantError(`Football Savant has no ${m[1]} season. It covers ${first} through ${last}.`)
  return m[1]
}

const played = (row, season) => +season >= row.from && +season <= row.to && !row.skip.includes(+season)
const span = (row) => (row.from === row.to ? String(row.from) : `${row.from} to ${row.to}`)
// Every season he has stats in, as ranges: "2012-2014, 2016-2020".
function seasonsOf(row) {
  const out = []
  let start = null
  for (let y = row.from; y <= row.to + 1; y++) {
    const on = y <= row.to && !row.skip.includes(y)
    if (on && start == null) start = y
    if (!on && start != null) { out.push(start === y - 1 ? String(start) : `${start}-${y - 1}`); start = null }
  }
  return out.join(', ')
}
const candidateLine = (row, meta) =>
  `${row.name} (id ${row.id}): ${(meta.positions[row.pos] || {}).label || row.pos}, ${span(row)}, last team ${teamIn(meta, row.to)(row.team) || 'unknown'}`

// ---- finding the player ----------------------------------------------------------------

// An id ("00-0034796") or a name. A name has to land on one player. NFL names repeat a
// great deal (there are several Chris Joneses), so when a name lands on more than one the
// season is used to choose, and failing that the candidates are listed for the caller to
// pick by id. Nobody is guessed at.
async function resolvePlayer(input, season, meta) {
  const rows = await loadPlayers()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a player name or id.')

  const hit = rows.find((r) => r.id === raw)
  if (hit) return hit
  if (/^\d{2}-\d{4,}$/.test(raw) || /^\d+$/.test(raw)) {
    throw new SavantError(`No player has the id "${raw}". Search by name with nfl_search_players.`)
  }

  const ranked = rank(rows, raw, recent)
  if (!ranked.length) throw new SavantError(`No player matches "${raw}". Check the spelling, or search with nfl_search_players.`)

  const top = ranked[0].score
  let best = topTier(ranked)
  if (best.length > 1 && season) {
    const there = best.filter((r) => played(r, season))
    if (there.length === 1) return there[0]
    if (there.length > 1) best = there
  }
  // One clear answer: the only player at the top, matched on whole words or a prefix. A name
  // that matches only as a near spelling never resolves on its own, even alone: it may be
  // someone who is not in the data, one letter away from someone who is.
  if (best.length === 1 && top >= 60) return best[0]

  const shown = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  const why = best.length > 1
    ? `${best.length} players ${season && best.every((r) => played(r, season)) ? `with stats in ${season} ` : ''}match "${raw}"`
    : `"${raw}" is not an exact match`
  const more = best.length > shown.length ? `\n(${best.length - shown.length} more not shown; nfl_search_players lists them.)` : ''
  const tip = best.length > 1 && !season ? '\nGiving the season also settles it when only one of them played that year.' : ''
  throw new SavantError(`${why}. Call again with one of these ids:\n${shown.map((r) => `- ${candidateLine(r, meta)}`).join('\n')}${more}${tip}`)
}

// ---- search --------------------------------------------------------------------------

export async function searchPlayers({ query, limit = 10 }) {
  const [meta, rows] = await Promise.all([loadMeta(), loadPlayers()])
  const ranked = rank(rows, query, recent)
  const shown = ranked.slice(0, limit).map(({ row }) => ({
    id: row.id,
    name: row.name,
    position: (meta.positions[row.pos] || {}).label || row.pos,
    team: teamIn(meta, row.to)(row.team),
    first_season: String(row.from),
    last_season: String(row.to),
    seasons: row.seasons,
    url: cardUrl(row.id, row.to),
  }))

  const structured = { query, total: ranked.length, count: shown.length, players: shown }
  const first = meta.seasons[meta.seasons.length - 1]
  if (!shown.length) {
    return { structured, text: `No player in Football Savant matches "${query}". It covers NFL players with stats from ${first} through ${meta.latestSeason}. Check the spelling or try the last name alone.` }
  }
  const head = ranked.length === 1 ? `1 player matches "${query}":` : `${ranked.length} players match "${query}"${ranked.length > shown.length ? `, showing the first ${shown.length}` : ''}:`
  const lines = shown.map((p, i) =>
    `${i + 1}. ${p.name} (id ${p.id}): ${p.position}, ${p.first_season === p.last_season ? p.first_season : `${p.first_season} to ${p.last_season}`}, ${p.seasons} season${p.seasons === 1 ? '' : 's'}, last team ${p.team || 'unknown'}. ${p.url}`)
  // Say so when a name is listed twice, so the caller does not read it as one man.
  const names = shown.map((p) => p.name)
  const twice = names.some((n, i) => names.indexOf(n) !== i)
  const note = twice ? '\nPlayers listed under the same name are different men. Tell them apart by position, years and team, and ask for a profile by id.' : ''
  return { structured, text: `${head}\n${lines.join('\n')}\nPosition and team are from each player's last season.${note}` }
}

// ---- profile -------------------------------------------------------------------------

export async function playerProfile(args, { long = LONG, max = MAX } = {}) {
  const whole = await profile(args, null)
  // One panel is given whole unless it alone runs past the ceiling (a quarterback's passing
  // panel in a season being played does); the card as a whole is shortened sooner.
  const one = args.group && args.group !== 'all'
  if (whole.text.length <= (one ? max : long)) return whole
  const { order, detail } = shorteningOrder(whole.structured.stats)
  let n = Math.max(1, detail)
  let out = await profile(args, new Set(order.slice(0, n)))
  while (out.text.length > max && n < order.length) out = await profile(args, new Set(order.slice(0, ++n)))
  // a short card can come out longer in brief, since the brief form has to be explained
  return out.text.length < whole.text.length ? out : whole
}

// `brief` is the set of section headings to give on one line each, or null for none.
async function profile({ player, season, group = 'all' }, brief) {
  const meta = await loadMeta()
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted, meta)
  const seasonId = wanted || String(who.to)
  if (!played(who, seasonId)) {
    const where = +seasonId >= who.from && +seasonId <= who.to
      ? `${who.name} has no stats in ${seasonId}; he may not have played that season.`
      : `${who.name} has no stats in ${seasonId}; it is outside his years in the data.`
    // He may have been asked for by the first name people use rather than the one on file
    // ("Patrick Surtain" in 2024 is the son, filed as Pat): say who did play that season.
    const others = /\d{2}-\d{4,}/.test(String(player)) ? [] : rank(await loadPlayers(), String(player), recent)
      .filter((r) => r.score === ALSO_KNOWN && r.row.id !== who.id && played(r.row, seasonId)).map((r) => r.row).slice(0, 3)
    const also = others.length ? ` If you meant ${others.map((r) => `${r.name} (id ${r.id})`).join(' or ')}, call again with that id.` : ''
    throw new SavantError(`${where} Football Savant has him in ${seasonsOf(who)}.${also}`)
  }
  const file = await loadSeason(seasonId)
  const rows = rowsOf(file)
  const row = rows.get(who.id)
  if (!row) throw new SavantError(`${who.name} has no stats in ${seasonId}. Football Savant has him in ${seasonsOf(who)}.`)

  const pos = meta.positions[row.pos] || { label: row.pos, peers: row.pos, panels: [], headline: [] }
  const peers = pos.peers
  const groupKey = group === 'all' ? null : GROUPS[group]
  const onCard = pos.panels.filter((g) => !(row.off || []).includes(g))
  const groupLabel = (g) => meta.groups[g] || g
  const first = meta.seasons[meta.seasons.length - 1]
  const live = file.week ? { through_week: file.week, week_under_way: file.weekPlaying || null } : null
  const poolSeason = (file.pools || {})[row.pos] || 0
  const poolAll = ((meta.pools || {}).all || {})[row.pos] || 0
  const url = cardUrl(row.id, seasonId)
  const tm = teamIn(meta, seasonId)

  // ---- the stats, in the card's order: panel by panel, then the stat table's order ----
  const low = new Set(row.low || [])
  const est = new Set(row.est || [])
  const settle = row.settle || {}
  const notYet = new Set(file.notYet || [])
  const stats = []
  const notTracked = []
  const notCharted = []
  for (const g of pos.panels) {
    if (groupKey && g !== groupKey) continue
    for (const m of meta.metrics) {
      if (m.group !== g || !m.positions.includes(row.pos)) continue
      if (+seasonId < m.since) { notTracked.push({ key: m.key, label: m.label, group: groupLabel(g), since: m.since }); continue }
      const cell = row.m[m.key]
      if (!cell) {
        if (notYet.has(m.key) && onCard.includes(g)) notCharted.push({ key: m.key, label: m.label, group: groupLabel(g) })
        continue
      }
      const isLow = low.has(m.key)
      const need = (m.lowSampleBelowByPosition || {})[row.pos] ?? m.lowSampleBelow
      const lean = settle[m.key]
      stats.push({
        key: m.key,
        label: m.label,
        group: groupLabel(g),
        subgroup: m.sub || null,
        kind: m.layer,
        value: cell[0],
        display: display(m.unit, cell[0]),
        season_percentile: cell[1],
        all_time_percentile: cell[2],
        lower_is_better: m.lowerIsBetter,
        low_sample: isLow,
        sample: isLow ? { have: row.d[m.den], needed: need, of: meta.denoms[m.den] || m.den } : null,
        estimate: est.has(m.key),
        likely_to_settle: lean ? { value: lean[0], display: display(m.unit, lean[0]), percentile: lean[1] } : null,
      })
    }
  }

  // What his card's rates are built on: games first, then each denominator one of his stats
  // divides by. (The data carries others, such as a quarterback's snaps split by play type.)
  const dens = new Set(['g', pos.qualify && pos.qualify.den])
  for (const m of meta.metrics) if (row.m[m.key] && m.den) dens.add(m.den)
  // Only the counts a card is built on: the sample behind a single row (a depth band, a
  // kind of snap) is said on that row, where it is needed.
  const core = meta.denomCore || Object.keys(meta.denoms)
  const built = core.filter((k) => dens.has(k) && row.d[k] != null).sort((a, b) => (b === 'g') - (a === 'g'))

  const height = (row.m.ht || [])[0]
  const weight = (row.m.wt || [])[0]
  const structured = {
    player: {
      id: row.id,
      name: row.name,
      team: tm(row.team),
      teams: (row.tms || (row.team ? [row.team] : [])).map(tm),
      position: pos.label,
      position_code: row.pos,
      age: row.age ?? null,
      experience: row.exp ?? null,
      college: row.college || null,
      draft: row.draft || null,
      undrafted: !!row.udfa,
      height: miss(height) ? null : feetInches(height),
      weight_lb: miss(weight) ? null : Math.round(weight),
      qualified: row.qualified,
      depth_chart: row.role ? { spot: row.role.spot, listed: row.role.listed, at: row.role.at } : null,
      roster_status: row.st || null,
    },
    season: seasonId,
    in_progress: live,
    group,
    team_season: row.rec
      ? { wins: row.rec[0], losses: row.rec[1], ties: row.rec[2], result: row.po || null, coach: row.coach || null }
      : null,
    league_ranks: (row.acc || []).map((a) => ({ rank: a.r, stat: a.s })),
    injury: row.inj ? { status: row.inj.st, injury: row.inj.inj || null, week: row.inj.wk ?? null } : null,
    sample: built.map((k) => ({ key: k, label: meta.denoms[k], value: row.d[k] })),
    pools: { position_label: peers, season: poolSeason, all_time: poolAll },
    profile_score: row.score != null ? { score: row.score, headline_stats: pos.headline.length, peak_season: who.peak ? String(who.peak) : null } : null,
    stats,
    not_tracked: notTracked,
    not_charted_yet: notCharted,
    notes: [],
    url,
    data_as_of: day(file.generated || meta.generated),
    source: SOURCE,
  }

  // ---- the same thing in words ----
  const L = []
  const teams = row.tms && row.tms.length > 1 ? row.tms.map(tm).join(' → ') : tm(row.team) || 'no team listed'
  L.push(`${row.name} (${teams}, ${pos.label}), ${seasonId} regular season${live ? `, in progress: through week ${live.through_week}${live.week_under_way ? ` (week ${live.week_under_way} under way)` : ''}` : ''}`)

  const bio = []
  if (row.age) bio.push(`age ${row.age}`)
  if (row.exp != null) bio.push(row.exp === 0 ? 'rookie' : `year ${row.exp + 1} in the NFL`)
  if (structured.player.height) bio.push(structured.player.height)
  if (structured.player.weight_lb != null) bio.push(`${structured.player.weight_lb} lb`)
  if (row.college) bio.push(`college: ${row.college}`)
  if (row.draft) {
    const d = row.draft
    bio.push(`drafted${d.year ? ` in ${d.year}` : ''}, round ${d.round}, pick ${d.pick ?? '?'}${d.team ? `, by ${d.team}` : ''}`)
  } else if (row.udfa) bio.push('undrafted')
  if (bio.length) L.push(`${upperFirst(bio.join(', '))}.`)

  if (row.rec) {
    const [w, l, t] = row.rec
    const rec = `${w}-${l}${t ? `-${t}` : ''}`
    L.push(`${tm(row.team)} ${live ? `are ${rec} so far` : `went ${rec}`}${row.po ? `: ${lowerFirst(row.po)}` : ''}.${row.coach ? ` Head coach ${row.coach}.` : ''}`)
  }
  if (row.acc && row.acc.length) {
    L.push(`NFL ranks${live ? ` through week ${live.through_week}` : ` in ${seasonId}`}: ${row.acc.map((a) => `${ordinal(a.r)} in ${a.s}`).join(', ')}.`)
  }
  if (row.inj) L.push(`Injury report, week ${row.inj.wk}: ${row.inj.st}${row.inj.inj ? ` (${row.inj.inj})` : ''}.`)
  if (row.st) L.push(`Roster status in the latest week on file: ${row.st}.`)
  if (row.role) {
    // the page's badge: a spot where it says more than his position, a place in line only
    // for a man listed behind the starters
    const r = row.role
    L.push(`Depth chart: ${r.listed ? `listed ${ordinal(r.listed)} at ${r.at} at his best` : `a starter at ${r.at}`} (the order the depth chart lists the position in, not where he lined up on each play or how much he played).`)
  }
  if (structured.sample.length) L.push(`Built on: ${structured.sample.map((d) => `${EST_COUNTS.has(d.key) && file.est ? 'about ' : ''}${count(d.value)} ${d.value === 1 ? singular(d.label) : d.label}`).join(', ')}.`)
  if (structured.profile_score) {
    const ps = structured.profile_score
    L.push(`Profile score ${ps.score}: his mean percentile across the ${ps.headline_stats} headline ${lowerFirst(pos.label)} stats, ${live ? `each scored where it is likely to settle among ${seasonId}'s ${peers} (so it is not the average of the "in ${seasonId}" percentiles below, which rank the raw numbers)` : `each ranked inside ${seasonId}`}, skipping any the season lacks.${ps.peak_season ? ` His peak season by that score is ${ps.peak_season}${live && ps.peak_season === seasonId ? ', so far' : ''}.` : ''}`)
  }
  L.push('')

  // The caveats. They go into the text and, as notes, into the structured result, so a
  // client that only passes one of the two along still carries them.
  const notes = structured.notes
  // The page gives no percentile at all when fewer than two men are in the pool.
  const inSeason = poolSeason >= 2
    ? `"in ${seasonId}" is among the ${thousands(poolSeason)} ${peers} who qualified that season.`
    : `${poolSeason === 0 ? `No ${peers}` : `Only one of the ${peers}`} qualified in ${seasonId}, so there is no "in ${seasonId}" percentile (shown as n/a).`
  notes.push(
    `Every percentile is against qualified ${peers} only; football has no league-wide pool. ${inSeason} ` +
    `"all-time" is among ${thousands(poolAll)} qualified ${lowerFirst(pos.label)} seasons from ${first} on${meta.live ? `, the ${meta.live.season} season in progress included` : ''} (a stat first tracked later is ranked from that year on). ` +
    'A higher percentile is always the better mark: stats tagged "lower is better" are already flipped. Regular season only.',
  )
  if (poolSeason >= 2 && poolSeason < SMALL_POOL) {
    notes.push(`Only ${poolSeason} ${peers} qualified in ${seasonId}. A pool that small makes the "in ${seasonId}" percentiles coarse.`)
  }
  if (live) {
    notes.push(`The ${seasonId} season is still being played. These numbers run through week ${live.through_week}, on small samples, and the qualifying line is pro-rated to the games his team has played. The all-time percentiles set these few weeks against other players' full seasons, which says little for counting stats such as games played.`)
  }
  if (!row.qualified) {
    const q = pos.qualify
    const fb = pos.qualifyFallback
    const line = q ? ` (${thousands(q.min)} ${q.word}${live ? ' over a full season, pro-rated for now' : ' in a full season'}${fb ? `; ${fb.min} ${fb.word} where a season has no count of ${q.word}` : ''})` : ''
    notes.push(`He is below the qualifying line for ${peers}${line}, so he is not in the pools himself and his percentiles rank a small sample against players who qualified. Treat them with caution.`)
  }
  // Not on the page: before snap counts, a lineman's games are the games he was flagged in.
  const lineman = meta.caveats && meta.caveats.lineGames
  if (lineman && lineman.positions.includes(row.pos) && +seasonId < lineman.before) {
    notes.push(`Caution for offensive linemen before ${lineman.before}: there were no snap counts, so the games count here is the number of games in which he drew a penalty flag, not the games he played. Games played, availability and the per-game penalty rates are unreliable for ${seasonId}, and very few linemen reach the qualifying line.`)
  }
  L.push(...notes)

  let heading = null
  const nth = (p) => (p == null ? 'n/a' : ordinal(p))
  let short = null
  // which marks actually appear in the words, so that each is explained once and none is
  // explained that the reader cannot see
  const marks = { low: false, settle: false, est: false, tilde: false }
  for (const s of stats) {
    const h = sectionOf(s)
    if (brief && brief.has(h)) {
      // one line for the whole section: "label value (percentile)", * for a low sample,
      // ~ in front of a value that is an estimate until the season ends
      const item = `${s.label} ${s.estimate ? '~' : ''}${s.display} (${nth(s.season_percentile)}${s.low_sample ? '*' : ''})`
      if (s.estimate) marks.tilde = true
      if (h !== heading) { L.push('', `${h}, in brief: ${item}`); heading = h; short = L.length - 1 }
      else L[short] += `; ${item}`
      continue
    }
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [
      s.lower_is_better ? 'lower is better' : null,
      s.estimate ? 'estimate until the lineups are published' : null,
      s.low_sample ? `low sample: ${count(s.sample.have)} of ${thousands(s.sample.needed)} ${s.sample.of}` : null,
      s.likely_to_settle ? `likely to settle near ${s.likely_to_settle.display} (${nth(s.likely_to_settle.percentile)})` : null,
    ].filter(Boolean)
    if (s.estimate) marks.est = true
    if (s.low_sample) marks.low = true
    if (s.likely_to_settle) marks.settle = true
    L.push(`- ${s.label}: ${s.display} (vs. ${peers}: ${nth(s.season_percentile)} in ${seasonId}, ${nth(s.all_time_percentile)} all-time)${tags.length ? ` [${tags.join('; ')}]` : ''}`)
  }
  if (!stats.length) {
    L.push('', groupKey && !pos.panels.includes(groupKey)
      ? `A ${lowerFirst(pos.label)}'s card has no ${groupLabel(groupKey)} panel. It has: ${list(pos.panels.map(groupLabel))}.`
      : `No ${groupKey ? `${groupLabel(groupKey)} ` : ''}stats on his card for ${seasonId}.`)
  }
  if (brief && short != null) {
    notes.push(`Sections marked "in brief" give each stat's value and its percentile in ${seasonId} only, with * for a low sample${marks.tilde ? ' and ~ for an estimate until the lineups are published' : ''}; the ${groupKey ? 'panel' : 'card'} is long, so they are shortened here. ${groupKey ? 'The structured result carries every stat in full.' : `Ask for one panel with the group input to get every stat's all-time percentile${stats.some((x) => x.low_sample) ? ' and sample' : ''}${stats.some((x) => x.likely_to_settle) ? ' and where it is likely to settle' : ''} in full.`}`)
    L.push('', notes[notes.length - 1])
  }
  if (marks.low) {
    notes.push('"low sample" marks a stat that has not had enough of its denominator to settle; the page draws those bars hollow. The tag gives what he has and what the stat needs.')
    L.push('', notes[notes.length - 1])
  }
  if (marks.settle) {
    notes.push(`"likely to settle" is an estimate of where a low-sample stat will finish: his number so far, blended with what is normal at his position and with his own last season, weighted by how little there is so far. The rank in brackets after it is where that estimate stands among the same estimate for every qualified ${lowerFirst(pos.label)}. It is the diamond on the page's hollow bars. Quote it as an estimate beside the raw number, never in place of it.`)
    L.push('', notes[notes.length - 1])
  }
  if (marks.est || marks.tilde) {
    notes.push(`${marks.est ? '"estimate until the lineups are published"' : 'The ~'} marks a stat worked out from snap counts for now: who was on the field for each play is only published after the Super Bowl, and the number becomes a count then. Quote it as an estimate.`)
    L.push('', notes[notes.length - 1])
  }
  const off = (row.off || []).filter((g) => !groupKey || g === groupKey)
  if (off.length) {
    // Returns are two counts (kick and punt), and a man with none of either is simply not
    // a returner: there is no small sample to speak of, so nothing is said.
    const counted = off.map((g) => {
      const [den, floor] = meta.panelFloor[g]
      if (g === 'ret') return { g, floor, word: 'returns', have: (row.d.kr || 0) + (row.d.pr || 0), returns: true }
      return { g, floor, word: meta.denoms[den] || den, have: row.d[den] }
    }).filter((c) => !(c.returns && !c.have))
    if (counted.length) {
      const why = counted.map((c) => `${groupLabel(c.g)} (${c.have == null ? `no ${c.word} on record` : `${count(c.have)} ${c.have === 1 ? singular(c.word) : c.word}`}; the page needs ${c.floor})`)
      notes.push(`Left off his card, as on the page, for too small a sample: ${list(why)}.${counted.some((c) => c.have) ? ' That is not the same as zero.' : ''}`)
      L.push('', notes[notes.length - 1])
    }
  }
  if (notCharted.length) {
    notes.push(`Not charted yet in ${seasonId}: ${notCharted.map((m) => m.label).join('; ')}. ${live ? 'Some charting is published a season at a time, after it ends.' : 'Nobody in this season has one.'}`)
    L.push('', notes[notes.length - 1])
  }
  if (notTracked.length) {
    L.push('', `Not tracked in ${seasonId} (first season in brackets): ${notTracked.map((m) => `${m.label} (${m.since})`).join('; ')}.`)
  }

  // What the card shows under the bars. Left out when only one panel was asked for.
  if (group === 'all') {
    const named = (c) => { const r = rows.get(c[0]); return { id: c[0], name: r ? r.name : c[0], team: r ? tm(r.team) : null, match: c[1] } }
    const said = (cs) => cs.map((c) => `${c.name} (${c.team || '?'}, ${c.match}% match)`).join(', ')
    const extra = []
    if (row.comps) {
      structured.comps = row.comps.map(named)
      // Matched on the position's headline stats, as far as the season tracked them.
      const by = pos.headline.map((k) => meta.metrics.find((m) => m.key === k)).filter((m) => m && +seasonId >= m.since).map((m) => m.label)
      extra.push(`Statistical comps, the closest ${lowerFirst(pos.label)} profiles among those who qualified in ${seasonId}${by.length ? `, by ${by.join(', ')}` : ''}: ${said(structured.comps)}.`)
    }
    if (row.wflaws) {
      structured.weakest = row.wflaws.map(([k, p]) => ({ key: k, label: (meta.metrics.find((m) => m.key === k) || {}).label || k, percentile: p }))
      extra.push(`Where he ranks worst among qualified ${peers} in ${seasonId}: ${structured.weakest.map((f) => `${f.label} (${ordinal(f.percentile)} percentile)`).join(', ')}.`)
      // The pipeline works these out ahead of time and rounds a half to the even number,
      // where the bars round it up. The page shows both, a point apart; so does this.
      if (row.wflaws.some(([k, p]) => row.m[k] && row.m[k][1] !== p)) {
        notes.push('"Where he ranks worst" is worked out ahead of time by the site and rounds a half differently, so a number there can sit a point off the same stat\'s percentile above.')
        extra.push(notes[notes.length - 1])
      }
    }
    if (row.wcomps) {
      structured.weakness_comps = row.wcomps.map(named)
      const best = Math.max(...row.wcomps.map((c) => c[1]))
      const thin = meta.weakness && best <= meta.weakness.lowMatch
      extra.push(`Weakness comps, the ${peers} who share his flaws: ${said(structured.weakness_comps)}.${thin ? ` That is a low match: nobody in ${seasonId} really shares this weakness profile, so read these as loose.` : ''}`)
    }
    if (extra.length) L.push('', ...extra)
  }
  if (pos.cannotSee) {
    notes.push(`What the page says it cannot see for this position: ${pos.cannotSee}`)
    L.push('', notes[notes.length - 1])
  }

  L.push('', `Card: ${url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const comp = z.object({ id: z.string(), name: z.string(), team: z.string().nullable(), match: z.number() })

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'nfl_search_players',
    config: {
      title: 'Search NFL players',
      description:
        'Find NFL players in Football Savant (Western Conference Elitists, wcehoops.com) by name. Covers players with stats from 1999 through the latest season, at every position including offensive line, defense, kickers and punters. Returns each match with its id, position and team in his last season, and first and last season, plus the link to his card. Matching ignores accents and punctuation and tolerates small typos. Different players who share a name are listed separately.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Player name or part of one, e.g. "Mahomes", "Lamar Jackson", "St. Brown".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many players matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        players: z.array(z.object({
          id: z.string().describe('Player id, for nfl_get_player_profile.'),
          name: z.string(),
          position: z.string().describe('Position in his last season, e.g. Quarterback, Guard, Edge.'),
          team: z.string().nullable().describe('Team in his last season.'),
          first_season: z.string(),
          last_season: z.string(),
          seasons: z.number().int().describe('Number of seasons with stats.'),
          url: z.string().describe('His Football Savant card, at his last season.'),
        })),
      },
      annotations: { title: 'Search NFL players', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchPlayers({ query, limit }),
  },
  {
    name: 'nfl_get_player_profile',
    config: {
      title: 'Get an NFL player\'s Savant profile',
      description:
        'Get one NFL player\'s Football Savant profile (Western Conference Elitists, wcehoops.com) for one regular season: every stat on his card for the position he played that year, each with its value and two percentiles against qualified players at that same position, one within that season and one across all seasons since 1999 ("all-time"). There is no league-wide percentile. Which stats exist depends on position: passing, rushing, receiving, returns, blocking, pass rush, run defense, coverage, kicking and punting, plus context, value (expected fantasy points, win probability added, contract) and athletic measurements. While a season is in progress, low-sample stats also carry where they are likely to settle, and rows that are estimates for now are marked. Also returns his age, college and draft pick, his team\'s record and coach, where he ranked in the NFL in counting stats, the sample sizes his rates are built on, a profile score, statistical comps and weakness comps. Defaults to his most recent season, which may still be in progress; the result then says through which week. Seasons from 1999 on. Stats a season did not track are listed as not tracked, and stats on a small sample are marked. Includes the link to his card.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nfl_search_players (e.g. "00-0033873") or a full name (e.g. "Patrick Mahomes"). If a name fits more than one player, the error lists their ids.'),
        season: z.string().trim().max(12).optional().describe('The year the season began, e.g. "2024". Omit for his most recent season.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which panel of stats to return: "all" (default), "context" (games, snaps, penalties), "passing", "rushing", "receiving", "returns" (kick and punt returns), "blocking", "pass_rush", "run_defense", "coverage", "kicking" (kicking and punting), "value" (total EPA, fantasy points, win probability added, contract) or "athletic" (size and combine).'),
      },
      outputSchema: {
        player: z.object({
          id: z.string(),
          name: z.string(),
          team: z.string().nullable().describe('The team he finished that season with.'),
          teams: z.array(z.string()).describe('Every team he appeared for that season, in order.'),
          position: z.string().describe('The position he played that season. It can differ between seasons.'),
          position_code: z.string(),
          age: z.number().nullable(),
          experience: z.number().nullable().describe('NFL seasons before this one; 0 is a rookie.'),
          college: z.string().nullable(),
          draft: z.object({ round: z.number(), pick: z.number().nullable(), year: z.number().nullable(), team: z.string().nullable() }).nullable(),
          undrafted: z.boolean(),
          height: z.string().nullable(),
          weight_lb: z.number().nullable(),
          qualified: z.boolean().describe('Whether he is in his position\'s percentile pools that season.'),
          depth_chart: z.object({ spot: z.string().nullable(), listed: z.number().nullable(), at: z.string() }).nullable().optional().describe('The page\'s depth-chart badge (2025 on), or null where it shows none. spot: the named spot where it says more than his position (a left tackle, a nickel back), else null. listed: his best place in the order the chart lists the position in, when that is behind the starters (2 = listed second), else null. at: the spot or position in words. It is a listing, not where he lined up or how much he played.'),
          roster_status: z.string().nullable().optional().describe('Season in progress only: set when he is not on the active roster (injured reserve, practice squad and so on).'),
        }),
        season: z.string(),
        in_progress: z.object({
          through_week: z.number().describe('The numbers run through this week.'),
          week_under_way: z.number().nullable(),
        }).nullable().describe('Set when the season is still being played.'),
        group: z.string(),
        team_season: z.object({
          wins: z.number(),
          losses: z.number(),
          ties: z.number(),
          result: z.string().nullable().describe('How the team\'s season ended. Absent while it is in progress.'),
          coach: z.string().nullable(),
        }).nullable().describe('Regular-season record of the team he finished with.'),
        league_ranks: z.array(z.object({ rank: z.number().int(), stat: z.string() })).describe('Where he ranked in the whole NFL in counting stats.'),
        injury: z.object({ status: z.string(), injury: z.string().nullable(), week: z.number().nullable() }).nullable().describe('This week\'s injury report. Season in progress only.'),
        sample: z.array(z.object({ key: z.string(), label: z.string(), value: z.number() })).describe('What his rates are built on: games, dropbacks, carries, targets, snaps and so on.'),
        pools: z.object({
          position_label: z.string().describe('The pool every percentile is against, e.g. quarterbacks.'),
          season: z.number().describe('Qualified players at his position that season.'),
          all_time: z.number().describe('Qualified player-seasons at his position since 1999.'),
        }),
        profile_score: z.object({
          score: z.number().describe('Mean of his season percentiles across his position\'s headline stats.'),
          headline_stats: z.number().int(),
          peak_season: z.string().nullable().describe('His best qualified season by this score.'),
        }).nullable(),
        stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          subgroup: z.string().nullable(),
          kind: z.string().describe('The page\'s label for what kind of number it is: output, ingredient, expected or context.'),
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          season_percentile: pct.describe('Among qualified players at his position that season. Higher is better. Null when fewer than two qualified.'),
          all_time_percentile: pct.describe('Among qualified players at his position in every season that tracked the stat. Higher is better.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentiles are already flipped.'),
          low_sample: z.boolean().describe('True when the stat is below its stabilization threshold.'),
          sample: z.object({ have: z.number(), needed: z.number(), of: z.string() }).nullable().describe('For a low-sample stat: how much of its denominator he has and how much it needs.'),
          estimate: z.boolean().optional().describe('True when the stat is an estimate from snap counts while the season is being played. It becomes exact after the season.'),
          likely_to_settle: z.object({ value: z.number(), display: z.string(), percentile: pct }).nullable().optional().describe('Season in progress, low-sample stats only: where the number is likely to finish, and where that would rank among the same estimate for every qualified player at his position.'),
        })),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string(), group: z.string(), since: z.number() })).describe('Stats for his position that the season did not track.'),
        not_charted_yet: z.array(z.object({ key: z.string(), label: z.string(), group: z.string() })).describe('Stats the era tracks but nobody in this season has yet.'),
        notes: z.array(z.string()).describe('How to read the numbers: what the pools are, and every caution that applies to this player and season.'),
        comps: z.array(comp).optional().describe('Closest statistical profiles among qualified players at his position that season.'),
        weakest: z.array(z.object({ key: z.string(), label: z.string(), percentile: z.number() })).optional().describe('Where he ranks worst among qualified players at his position that season.'),
        weakness_comps: z.array(comp).optional().describe('Qualified players at his position who share his flaws.'),
        url: z.string().describe('His Football Savant card for that season.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NFL player\'s Savant profile', ...READ_ONLY },
    },
    run: ({ player, season, group }) => playerProfile({ player, season, group }),
  },
]
