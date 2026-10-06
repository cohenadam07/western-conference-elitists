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
//   - The card link is the page's own: football-savant.html#p=<id>&s=<season>
//
// BEYOND ONE CARD
// The same season files answer four more kinds of question:
//
//   leaderboard    the page's Leaderboard Builder: qualified players at one position, ranked
//                  by one of that position's stats, settled samples only unless asked. And
//                  the NFL's top ten in a counting stat (rushing yards, sacks), which the
//                  site records as a rank on each leader's card
//   compare        two to four player-seasons side by side
//   career         one player season by season
//   list stats     the glossary: every stat's key, name and meaning
//
// COUNTING TOTALS ARE DERIVED, AND SAID TO BE
// The data holds rates, not totals: yards per attempt, not passing yards. The page derives a
// career's totals as "a rate times the volume that rate was built from" and marks them
// "derived". A season's totals are the same arithmetic on one season, by the page's own
// recipes (meta.totals), and carry the page's own warning that they can land a yard or two
// off the official book.
//
// ONE CAUTION THE PAGE DOES NOT PRINT: before snap counts (2013) an offensive lineman's
// games count is the games he was flagged in, not the games he played (the pipeline's own
// README says so). The numbers are passed through as the page shows them, with that said.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, boardSlice, day, findStat, makeLoader, mapLimit, miss, norm, ordinal, prepare, prepareStats, rank, ranked, statNorm, thousands, topTier } from './_core.js'

// A season file is a couple of megabytes once parsed, so only a handful are held at a time.
const files = makeLoader('savant-api/football/v1', { what: 'Football Savant', maxCached: 8 })

// The `group` input, and the page's panel each one means (meta.groups has the labels).
export const GROUPS = {
  context: 'ctx', passing: 'pass', rushing: 'rush', receiving: 'rec', blocking: 'block', pass_rush: 'prsh',
  run_defense: 'rdef', coverage: 'cov', kicking: 'kick', value: 'val', athletic: 'ath',
}

const SOURCE = 'Football Savant, Western Conference Elitists (wcehoops.com)'
const SMALL_POOL = 10 // under this many qualified players, an answer says the pool is small

const DERIVED = 'Totals are derived the way the page derives a career\'s: counts of attempts, carries, targets and snaps come straight from the data, and yardage and touchdown figures are a rate times the volume that rate was built from, so they can land a yard or two off the official book.'
const KINDS = 'Not every stat is a grade: some describe how a player plays or is used (depth of target, time to throw, checkdown rate, cushion, snap share), and there a percentile says how much of it, not how good. The page tags each stat by kind (output, ingredient, context, expected), and nfl_list_stats says what each one means.'

const loadMeta = () => files.load('meta.json')
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
  `${row.name} (id ${row.id}): ${(meta.positions[row.pos] || {}).label || row.pos}, ${span(row)}, last team ${row.team || 'unknown'}`

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
    team: row.team,
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

// ---- counting totals -------------------------------------------------------------------

// A player-season's counting totals, by the page's own recipes for his position (see the
// header). A total whose stat or denominator he lacks that season is left out, not zeroed.
export function totalsOf(meta, row) {
  const list = (meta.totals || {})[row.pos]
  if (!list) return []
  const out = []
  for (const t of list) {
    if (t.kind === 'count') {
      const v = (row.d || {})[t.den]
      if (!miss(v)) out.push({ label: t.label, value: v, display: thousands(v), derived: false })
      continue
    }
    const m = meta.metrics.find((x) => x.key === t.key)
    const cell = row.m[t.key]
    if (!m || !cell || miss(cell[0])) continue
    if (t.kind === 'value') { out.push({ label: t.label, value: cell[0], display: display(m.unit, cell[0]), derived: false }); continue }
    const vol = (row.d || {})[m.den]
    if (miss(vol)) continue
    // To the nearest half, since a sack can be shared; everything else lands on a whole number.
    const v = Math.round(((cell[0] * vol) / (t.pct ? 100 : 1)) * 2) / 2
    out.push({ label: t.label, value: v, display: thousands(v), derived: true })
  }
  return out
}
const totalsText = (totals) => totals.map((t) => `${t.display} ${t.label}`).join(', ')

// ---- profile -------------------------------------------------------------------------

export async function playerProfile({ player, season, group = 'all' }) {
  const meta = await loadMeta()
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted, meta)
  const seasonId = wanted || String(who.to)
  if (!played(who, seasonId)) {
    const where = +seasonId >= who.from && +seasonId <= who.to
      ? `${who.name} has no stats in ${seasonId}; he may not have played that season.`
      : `${who.name} has no stats in ${seasonId}; it is outside his years in the data.`
    throw new SavantError(`${where} Football Savant has him in ${seasonsOf(who)}.`)
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

  // ---- the stats, in the card's order: panel by panel, then the stat table's order ----
  const low = new Set(row.low || [])
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
        sample: isLow ? { have: row.d[m.den], needed: m.lowSampleBelow, of: meta.denoms[m.den] || m.den } : null,
        what: m.what || null,
      })
    }
  }
  const totals = totalsOf(meta, row)

  // What his card's rates are built on: games first, then each denominator one of his stats
  // divides by. (The data carries others, such as a quarterback's snaps split by play type.)
  const dens = new Set(['g', pos.qualify && pos.qualify.den])
  for (const m of meta.metrics) if (row.m[m.key] && m.den) dens.add(m.den)
  const built = Object.keys(meta.denoms).filter((k) => dens.has(k) && row.d[k] != null).sort((a, b) => (b === 'g') - (a === 'g'))

  const height = (row.m.ht || [])[0]
  const weight = (row.m.wt || [])[0]
  const structured = {
    player: {
      id: row.id,
      name: row.name,
      team: row.team,
      teams: row.tms || (row.team ? [row.team] : []),
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
    totals,
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
  const teams = row.tms && row.tms.length > 1 ? row.tms.join(' → ') : row.team || 'no team listed'
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
    L.push(`${row.team} ${live ? `are ${rec} so far` : `went ${rec}`}${row.po ? `: ${lowerFirst(row.po)}` : ''}.${row.coach ? ` Head coach ${row.coach}.` : ''}`)
  }
  if (row.acc && row.acc.length) {
    L.push(`NFL ranks${live ? ` through week ${live.through_week}` : ` in ${seasonId}`}, among players at every position: ${row.acc.map((a) => `${ordinal(a.r)} in ${a.s}`).join(', ')}. (The site lists a top-ten place only, and at most six a player; players level on a stat share a place.)`)
  }
  if (totals.length) L.push(`${live ? 'So far' : `In ${seasonId}`}: ${totalsText(totals)}.${totals.some((t) => t.derived) ? ' Derived: see the note on totals.' : ''}`)
  if (row.inj) L.push(`Injury report, week ${row.inj.wk}: ${row.inj.st}${row.inj.inj ? ` (${row.inj.inj})` : ''}.`)
  if (structured.sample.length) L.push(`Built on: ${structured.sample.map((d) => `${count(d.value)} ${d.value === 1 ? singular(d.label) : d.label}`).join(', ')}.`)
  if (structured.profile_score) {
    const ps = structured.profile_score
    L.push(`Profile score ${ps.score}: his mean percentile across the ${ps.headline_stats} headline ${lowerFirst(pos.label)} stats, each ranked inside ${seasonId}, skipping any the season lacks.${ps.peak_season ? ` His peak season by that score is ${ps.peak_season}${live && ps.peak_season === seasonId ? ', so far' : ''}.` : ''}`)
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
    'Stats tagged "lower is better" are already flipped, so a higher percentile is the better mark there too. Regular season only.',
  )
  notes.push(KINDS)
  if (totals.some((t) => t.derived)) notes.push(DERIVED)
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
  for (const s of stats) {
    const h = s.subgroup ? `${s.group}: ${s.subgroup}` : s.group
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [
      s.lower_is_better ? 'lower is better' : null,
      s.low_sample ? `low sample: ${count(s.sample.have)} of ${thousands(s.sample.needed)} ${s.sample.of}` : null,
    ].filter(Boolean)
    L.push(`- ${s.label}${s.kind && s.kind !== 'output' ? ` (${s.kind})` : ''}: ${s.display} (vs. ${peers}: ${nth(s.season_percentile)} in ${seasonId}, ${nth(s.all_time_percentile)} all-time)${tags.length ? ` [${tags.join('; ')}]` : ''}`)
    // Asked for one panel, each stat is explained in the page's words.
    if (groupKey && s.what) L.push(`  ${s.what}`)
  }
  if (!stats.length) {
    L.push('', groupKey && !pos.panels.includes(groupKey)
      ? `A ${lowerFirst(pos.label)}'s card has no ${groupLabel(groupKey)} panel. It has: ${list(pos.panels.map(groupLabel))}.`
      : `No ${groupKey ? `${groupLabel(groupKey)} ` : ''}stats on his card for ${seasonId}.`)
  }
  if (stats.some((s) => s.low_sample)) {
    notes.push('"low sample" marks a stat that has not had enough of its denominator to settle; the page draws those bars hollow. The tag gives what he has and what the stat needs.')
    L.push('', notes[notes.length - 1])
  }
  const off = (row.off || []).filter((g) => !groupKey || g === groupKey)
  if (off.length) {
    const why = off.map((g) => {
      const [den, floor] = meta.panelFloor[g]
      const word = meta.denoms[den] || den
      const have = row.d[den]
      return `${groupLabel(g)} (${have == null ? `no ${word} on record` : `${count(have)} ${have === 1 ? singular(word) : word}`}; the page needs ${floor})`
    })
    notes.push(`Left off his card, as on the page, for too small a sample: ${list(why)}. That is not the same as zero.`)
    L.push('', notes[notes.length - 1])
  }
  if (notCharted.length) {
    notes.push(`Not charted yet in ${seasonId}: ${notCharted.map((m) => m.label).join(', ')}. ${live ? 'Some charting is published a season at a time, after it ends.' : 'Nobody in this season has one.'}`)
    L.push('', notes[notes.length - 1])
  }
  if (notTracked.length) {
    L.push('', `Not tracked in ${seasonId} (first season in brackets): ${notTracked.map((m) => `${m.label} (${m.since})`).join(', ')}.`)
  }

  // What the card shows under the bars. Left out when only one panel was asked for.
  if (group === 'all') {
    const named = (c) => { const r = rows.get(c[0]); return { id: c[0], name: r ? r.name : c[0], team: r ? r.team : null, match: c[1] } }
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

// ---- positions, teams and stats by name ------------------------------------------------

// How people say a position, beyond its code (QB), its label (Quarterback) and the page's
// word for its players (quarterbacks), which are all read from the data.
const POSITION_WORDS = {
  QB: ['passer'], RB: ['running back', 'halfback', 'back', 'tailback'], WR: ['receiver', 'wideout', 'wide receiver'],
  TE: ['tight end'], OL: ['offensive line', 'offensive lineman', 'lineman', 'o line'], OT: ['tackle', 'offensive tackle', 'left tackle', 'right tackle'],
  OG: ['guard', 'offensive guard'], OC: ['center', 'centre'], ED: ['edge', 'edge rusher', 'pass rusher', 'defensive end', 'de', 'olb'],
  DI: ['defensive tackle', 'interior', 'interior defensive line', 'dt', 'nose tackle', 'defensive lineman'], LB: ['linebacker', 'off ball linebacker'],
  CB: ['corner', 'cornerback'], S: ['safety', 'free safety', 'strong safety'], K: ['kicker', 'placekicker'], P: ['punter'],
}
function resolvePosition(input, meta) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const codes = Object.keys(meta.positions)
  const code = codes.find((c) => c.toLowerCase() === raw.toLowerCase())
  if (code) return code
  const q = norm(raw).replace(/s$/, '')
  const names = (c) => [meta.positions[c].label, meta.positions[c].peers, ...(POSITION_WORDS[c] || [])].map((w) => norm(w).replace(/s$/, ''))
  const hits = codes.filter((c) => names(c).includes(q))
  if (hits.length === 1) return hits[0]
  throw new SavantError(`"${raw}" is not a position Football Savant ranks. Use one of: ${codes.map((c) => `${c} (${meta.positions[c].label})`).join(', ')}.`)
}

// The team a caller means, as the code that season's file uses.
function resolveTeam(input, meta, file) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const here = [...new Set(file.players.map((p) => p.team).filter(Boolean))].sort()
  const code = here.find((c) => c.toLowerCase() === raw.toLowerCase())
  if (code) return code
  const q = norm(raw).split(' ').filter(Boolean)
  const fits = (c) => { const words = norm((meta.teams || {})[c] || '').split(' '); return q.every((t) => words.includes(t)) }
  const hits = here.filter(fits)
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) throw new SavantError(`"${raw}" fits more than one team: ${hits.map((c) => `${c} (${meta.teams[c]})`).join(', ')}. Call again with the code.`)
  throw new SavantError(`No NFL team with players in ${file.season} matches "${raw}". Give a team code or name. Teams that season: ${here.join(', ')}.`)
}
const teamName = (meta, code) => (meta.teams || {})[code] || code

// The stats on one position's card, in the page's order, prepared for matching once per
// loaded glossary.
const statIndex = new WeakMap()
function statsOf(meta, pos) {
  let by = statIndex.get(meta)
  if (!by) { by = new Map(); statIndex.set(meta, by) }
  let rows = by.get(pos)
  if (!rows) {
    const panels = pos ? meta.positions[pos].panels : Object.keys(meta.groups)
    const list = panels.flatMap((g) => meta.metrics.filter((m) => m.group === g && (!pos || m.positions.includes(pos))))
    rows = prepareStats(list)
    by.set(pos, rows)
  }
  return rows
}
const headlineOf = (meta, pos) => (meta.positions[pos].headline || []).map((k) => statsOf(meta, pos).find((m) => m.key === k)).filter(Boolean)
const nth = (p) => (p == null ? 'n/a' : ordinal(p))
const liveOf = (file) => (file.week ? { through_week: file.week, week_under_way: file.weekPlaying || null } : null)
const liveText = (file, seasonId) => (file.week ? `The ${seasonId} season is still being played: these numbers run through week ${file.week}, on small samples.` : null)

// ---- leaderboard -----------------------------------------------------------------------

// The counting stats the site ranks across the whole NFL, as they appear on leaders' cards
// (row.acc): who holds each top-ten place. A card keeps at most six, so a list can have a
// gap, and says so. `total` names the page's counting total that is the same number, at the
// positions where it means the same thing, so a leader's total can sit beside his rank.
const LEADER_TOTALS = {
  'passing yards': { label: 'Pass yds', positions: ['QB'] },
  'passing TDs': { label: 'Pass TD', positions: ['QB'] },
  'pass attempts': { label: 'Att', positions: ['QB'] },
  'rushing yards': { label: 'Rush yds', positions: ['RB', 'QB'] },
  carries: { label: 'Carries', positions: ['RB'] },
  'receiving yards': { label: 'Rec yds', positions: ['WR', 'TE', 'RB'] },
  receptions: { label: 'Rec', positions: ['WR', 'TE', 'RB'] },
  targets: { label: 'Targets', positions: ['WR', 'TE'] },
  'receiving TDs': { label: 'Rec TD', positions: ['WR', 'TE'] },
  sacks: { label: 'Sacks', positions: ['ED', 'DI', 'LB'] },
  'tackles for loss': { label: 'TFL', positions: ['ED', 'DI', 'LB'] },
  'QB hits': { label: 'QB hits', positions: ['ED', 'DI'] },
  'passes defended': { label: 'PD', positions: ['LB', 'CB', 'S'] },
  interceptions: { label: 'Int', positions: ['CB', 'S'] },
}
const leaderIndex = new WeakMap()
function leadersOf(file) {
  let by = leaderIndex.get(file)
  if (!by) {
    by = new Map()
    for (const p of file.players) for (const a of p.acc || []) { if (!by.has(a.s)) by.set(a.s, []); by.get(a.s).push({ rank: a.r, row: p }) }
    for (const list of by.values()) list.sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name))
    leaderIndex.set(file, by)
  }
  return by
}

async function leagueLeaders(meta, file, seasonId, name, { team, limit }) {
  const all = leadersOf(file).get(name)
  const code = resolveTeam(team, meta, file)
  const rows = all.filter((x) => !code || x.row.team === code).slice(0, limit)
  const live = liveOf(file)
  const spec = LEADER_TOTALS[name]
  const totalFor = (row) => {
    if (!spec || !spec.positions.includes(row.pos)) return null
    return totalsOf(meta, row).find((t) => t.label === spec.label) || null
  }
  const leaders = rows.map((x) => {
    const t = totalFor(x.row)
    return {
      rank: x.rank,
      tied: all.filter((y) => y.rank === x.rank).length > 1,
      id: x.row.id,
      name: x.row.name,
      team: x.row.team,
      position: (meta.positions[x.row.pos] || {}).label || x.row.pos,
      total: t ? t.value : null,
      total_derived: t ? t.derived : null,
      games: (x.row.d || {}).g ?? null,
      url: cardUrl(x.row.id, seasonId),
    }
  })
  const notes = [
    `These are the NFL's top-ten places in ${name}${live ? ` through week ${live.through_week} of ${seasonId}` : ` in ${seasonId}`}, among players at every position, as Football Savant records them on each leader's card. Players level on the stat share a place.`,
    'A card keeps at most six of a player\'s league ranks, his best ones, so a place can be missing from this list. A missing place is a gap in the list, not a vacancy.',
  ]
  if (leaders.some((l) => l.total != null)) notes.push(`The totals beside the places are ${leaders.every((l) => l.total == null || !l.total_derived) ? 'counted' : 'derived'}. ${DERIVED}`)
  else notes.push('The site records the place, not the number behind it, for this stat.')
  if (live) notes.push(liveText(file, seasonId))
  const structured = {
    mode: 'league_leaders',
    stat: { key: name, label: name, what: `Where a player ranks in the whole NFL in ${name}.`, kind: 'output', lower_is_better: false },
    season: seasonId,
    in_progress: live,
    position: null,
    order: 'top',
    sample: null,
    filters: { team: code },
    ranked: all.length,
    hidden_low_sample: 0,
    fell_back_to_everyone: false,
    count: leaders.length,
    leaders: leaders.map((l) => ({ ...l, value: l.total, display: l.total == null ? null : thousands(l.total), season_percentile: null, all_time_percentile: null, low_sample: false, on_card: true, columns: [] })),
    notes,
    url: meta.page,
    data_as_of: day(file.generated || meta.generated),
    source: SOURCE,
  }
  if (!leaders.length) return { structured, text: `Nobody${code ? ` on ${teamName(meta, code)}` : ''} holds a top-ten place in ${name} in ${seasonId}.\n\n${notes.join('\n')}\n\nSource: ${SOURCE}.` }
  const L = [`NFL leaders in ${name}, ${seasonId}${live ? `, through week ${live.through_week}` : ''}${code ? `, ${teamName(meta, code)} only` : ''}`, '']
  for (const l of leaders) L.push(`${l.tied ? 'T-' : ''}${l.rank}. ${l.name} (${l.team || '?'}, ${l.position}, id ${l.id})${l.total == null ? '' : `: ${thousands(l.total)}`}${l.games != null ? `${l.total == null ? ':' : ','} ${l.games} game${l.games === 1 ? '' : 's'}` : ''}`)
  L.push('', ...notes, '', `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// The page's Leaderboard Builder, as an answer: qualified players at one position, ranked by
// one of that position's stats. Its lbPool() and lbRender(): "settled" (the page's default)
// leaves out anyone whose sample for the ranking stat is under its threshold, because a rate
// on a handful of plays tops every list; "everyone" lists them, marked.
export async function leaderboard({ position, stat, season, team, limit = 10, order = 'top', sample = 'settled' }) {
  const meta = await loadMeta()
  const seasonId = parseSeason(season, meta) || meta.latestSeason
  const file = await loadSeason(seasonId)

  // A counting stat the site ranks league-wide ("rushing yards") needs no position.
  if (stat) {
    const q = statNorm(stat)
    const name = [...leadersOf(file).keys()].find((k) => statNorm(k) === q)
    if (name) return leagueLeaders(meta, file, seasonId, name, { team, limit })
  }
  const pos = resolvePosition(position, meta)
  if (!pos) {
    const counting = [...leadersOf(file).keys()].sort()
    throw new SavantError(`Give a position: Football Savant ranks players only against their own position (${Object.keys(meta.positions).join(', ')}). Without one, "stat" can be a counting stat the site ranks across the whole NFL${counting.length ? `: ${counting.join(', ')}` : ''}.`)
  }
  const P = meta.positions[pos]
  const m = stat ? findStat(statsOf(meta, pos), stat, { tool: 'nfl_list_stats', what: `${P.label.toLowerCase()} stat` }) : headlineOf(meta, pos)[0]
  if (!m) throw new SavantError(`Football Savant has no headline stat for ${P.peers}. Name a stat: nfl_list_stats lists them.`)
  if (+seasonId < m.since) throw new SavantError(`${m.label} is tracked from ${m.since} on, so ${seasonId} has no leaderboard for it.`)
  const code = resolveTeam(team, meta, file)
  const live = liveOf(file)

  // A player's value for the ranking stat: the one on his card, or, where the page leaves the
  // whole panel off his card for too small a sample (a back with a handful of targets), the
  // value the files keep for exactly this (row.x). The page's board ranks him either way.
  const valueOf = (p) => (p.m[m.key] ? p.m[m.key][0] : p.x ? p.x[m.key] : null)
  const offCard = (p) => !p.m[m.key]
  const pool = file.players.filter((p) => p.pos === pos && p.qualified && (!code || p.team === code) && !miss(valueOf(p)))
  const isLow = (p) => (p.low || []).includes(m.key) || (p.xlow || []).includes(m.key)
  const thin = pool.filter(isLow)
  // Early in a season nobody has a settled sample yet. An empty board answers nothing, so
  // it falls back to everyone, marked, and says that it did.
  const fellBack = sample === 'settled' && pool.length > 0 && thin.length === pool.length
  if (fellBack) sample = 'everyone'
  const eligible = sample === 'settled' ? pool.filter((p) => !isLow(p)) : pool
  const all = ranked(eligible, valueOf, { lower: m.lowerIsBetter })
  const shown = boardSlice(all, limit, order)
  // Beside the ranking stat, the position's headline stats: the columns the page opens with.
  const cols = headlineOf(meta, pos).filter((h) => h.key !== m.key && +seasonId >= h.since).slice(0, 4)
  const denWord = meta.denoms[m.den] || m.den

  const canLink = meta.leaderboardUrl && order === 'top' && !['ctx', 'ath'].includes(m.group)
  const url = canLink
    ? meta.leaderboardUrl.replace('{season}', seasonId).replace('{pos}', pos).replace('{stat}', m.key).replace('{n}', String(limit)) + (code ? `&t=${code}` : '') + (sample === 'settled' ? '' : '&x=all')
    : meta.page

  const who = `qualified ${P.peers}${code ? ` on ${teamName(meta, code)} (${code})` : ''}`
  const notes = [
    `Ranked among the ${all.length} ${who} in ${seasonId}${sample === 'settled' ? ` with a settled sample for ${m.label}` : ''}. Football has no league-wide pool: a player is ranked only against his own position. ${(file.pools || {})[pos] || 0} ${P.peers} qualified that season${P.qualify ? ` (${thousands(P.qualify.min)} ${P.qualify.word} over a full season${live ? ', pro-rated while the season is being played' : ''})` : ''}.`,
  ]
  if (fellBack) notes.push(`Nobody has reached ${m.lowSampleBelow} ${denWord} yet, the point where ${m.label} settles down, so this lists every qualified player and every place is on a low sample: the rates are real, the places are not yet earned.`)
  if (sample === 'settled' && thin.length) notes.push(`${thin.length} more qualified ${thin.length === 1 ? 'player is' : 'players are'} left off: fewer than ${m.lowSampleBelow} ${denWord}, the point where ${m.label} settles down. Ask for sample "everyone" to list them, marked.`)
  if (shown.some((r) => offCard(r.row))) {
    const [den, floor] = meta.panelFloor[m.group] || []
    notes.push(`"not on his card" marks a player whose whole ${meta.groups[m.group] || m.group} panel the page leaves off his card${floor ? ` for too small a sample (fewer than ${floor} ${meta.denoms[den] || den})` : ''}. The page's leaderboard still ranks him, so he is listed, with no percentile.`)
  }
  if (sample !== 'settled' && !fellBack && shown.some((r) => isLow(r.row))) notes.push(`"low sample" marks a player with fewer than ${m.lowSampleBelow} ${denWord}: the rate is real, the place is not yet earned.`)
  if (m.lowerIsBetter) notes.push(`${m.label} is a lower-is-better stat, so the lowest value is 1st.`)
  if (order === 'bottom') notes.push(`This is the bottom of the board, worst first. Places are counted from the top: ${all.length ? ordinal(all[all.length - 1].rank) : 'last'} is last.`)
  if (m.layer === 'context') notes.push(`The page tags ${m.label} as "context": it describes how a player is used or the situation he plays in, so leading it is not the same as being the best.`)
  if (shown.some((r) => r.tied)) notes.push('Equal values share a place.')
  if (live) notes.push(liveText(file, seasonId))

  const structured = {
    mode: 'position_stat',
    stat: { key: m.key, label: m.label, what: m.what || null, kind: m.layer || null, lower_is_better: m.lowerIsBetter },
    season: seasonId,
    in_progress: live,
    position: P.label,
    order,
    sample,
    filters: { team: code },
    ranked: all.length,
    hidden_low_sample: sample === 'settled' ? thin.length : 0,
    fell_back_to_everyone: fellBack,
    count: shown.length,
    leaders: shown.map((r) => {
      const p = r.row
      const c = p.m[m.key] || [r.value, null, null]
      return {
        rank: r.rank,
        tied: r.tied,
        id: p.id,
        name: p.name,
        team: p.team,
        position: P.label,
        value: c[0],
        display: display(m.unit, c[0]),
        season_percentile: c[1],
        all_time_percentile: c[2],
        total: null,
        total_derived: null,
        games: (p.d || {}).g ?? null,
        low_sample: isLow(p),
        on_card: !offCard(p),
        columns: cols.map((h) => { const x = p.m[h.key]; return { key: h.key, label: h.label, display: x ? display(h.unit, x[0]) : null, season_percentile: x ? x[1] : null } }),
        url: cardUrl(p.id, seasonId),
      }
    }),
    notes,
    url,
    data_as_of: day(file.generated || meta.generated),
    source: SOURCE,
  }
  if (!shown.length) {
    const why = !pool.length
      ? `No ${who} ${file.notYet && file.notYet.includes(m.key) ? `have a ${m.label} yet in ${seasonId}: some charting is published only once a season ends` : `have a value for ${m.label} in ${seasonId}`}.`
      : `No ${who} has reached ${m.lowSampleBelow} ${denWord} in ${seasonId}. Ask for sample "everyone" to list the ${pool.length} who have a value, marked low sample.`
    return { structured, text: `${why}\n\n${notes.join('\n')}\n\nOn the site: ${url}\nSource: ${SOURCE}.` }
  }
  const L = [`${P.label}s by ${m.label}, ${seasonId}${live ? `, through week ${live.through_week}` : ''}: the ${order === 'bottom' ? 'bottom' : 'top'} ${shown.length} of ${all.length} ${who}`]
  if (m.what) L.push(m.what)
  if (cols.length) L.push(`Each line also gives his ${cols.map((h) => h.label).join(', ')}, with the percentile among ${P.peers} that season in brackets.`)
  L.push('')
  for (const l of structured.leaders) {
    const extra = l.columns.filter((x) => x.display != null).map((x) => `${x.label} ${x.display} (${nth(x.season_percentile)})`).join(' · ')
    const pcts = l.on_card ? ` (${nth(l.season_percentile)} in ${seasonId}, ${nth(l.all_time_percentile)} all-time)` : ''
    L.push(`${l.tied ? 'T-' : ''}${l.rank}. ${l.name} (${l.team || '?'}, id ${l.id}): ${l.display}${pcts}${l.games != null ? `, ${l.games} g` : ''}${l.low_sample && !fellBack ? ' [low sample]' : ''}${l.on_card ? '' : ' [not on his card]'}${extra ? ` | ${extra}` : ''}`)
  }
  L.push('', ...notes, '', `On the site: ${url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- compare ---------------------------------------------------------------------------

// One player-season, found the way a profile finds it.
async function playerSeason(meta, player, season) {
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted, meta)
  const seasonId = wanted || String(who.to)
  if (!played(who, seasonId)) throw new SavantError(`${who.name} has no stats in ${seasonId}. Football Savant has him in ${seasonsOf(who)}.`)
  const file = await loadSeason(seasonId)
  const row = rowsOf(file).get(who.id)
  if (!row) throw new SavantError(`${who.name} has no stats in ${seasonId}. Football Savant has him in ${seasonsOf(who)}.`)
  return { who, seasonId, file, row }
}

export async function comparePlayers({ players, seasons, group = 'headline', stats }) {
  const meta = await loadMeta()
  if (seasons && seasons.length > 1 && seasons.length !== players.length) {
    throw new SavantError(`Give one season for everyone, or one season per player in the same order: ${players.length} players, ${seasons.length} seasons.`)
  }
  const sides = []
  for (let i = 0; i < players.length; i++) {
    sides.push(await playerSeason(meta, players[i], seasons && seasons.length ? seasons[seasons.length === 1 ? 0 : i] : undefined))
  }
  const dup = sides.find((a, i) => sides.some((b, j) => j < i && b.row.id === a.row.id && b.seasonId === a.seasonId))
  if (dup) throw new SavantError(`${dup.row.name} in ${dup.seasonId} is listed twice. To compare one player with himself, give two different seasons.`)

  // The stats: the ones asked for, one panel, or each side's headline stats. A stat is looked
  // up on every position in play, since a tight end and a receiver share most of a card.
  const positions = [...new Set(sides.map((x) => x.row.pos))]
  const everyStat = positions.flatMap((pos) => statsOf(meta, pos)).filter((m, i, a) => a.findIndex((x) => x.key === m.key) === i)
  let picked
  if (stats && stats.length) {
    picked = []
    for (const name of stats) { const m = findStat(everyStat, name, { tool: 'nfl_list_stats' }); if (!picked.includes(m)) picked.push(m) }
  } else if (group === 'headline') {
    picked = positions.flatMap((pos) => headlineOf(meta, pos)).filter((m, i, a) => a.findIndex((x) => x.key === m.key) === i)
  } else {
    picked = everyStat.filter((m) => m.group === GROUPS[group])
    if (!picked.length) throw new SavantError(`None of these players has a ${meta.groups[GROUPS[group]] || group} panel on his card.`)
  }

  const several = new Set(sides.map((x) => x.seasonId)).size > 1
  const tag = (x) => `${x.row.name}${several ? ` ${x.seasonId}` : ''}`
  const oneMan = new Set(sides.map((x) => x.row.id)).size === 1
  const surname = (x) => x.row.name.split(' ').slice(1).join(' ') || x.row.name
  const clash = (x) => sides.some((y) => y.row.id !== x.row.id && surname(y) === surname(x))
  const short = (x) => (oneMan ? x.seasonId : `${clash(x) ? x.row.name : surname(x)}${several ? ` ${x.seasonId}` : ''}`)
  const posOf = (x) => meta.positions[x.row.pos]

  const rows = picked.map((m) => ({
    key: m.key,
    label: m.label,
    group: meta.groups[m.group] || m.group,
    kind: m.layer || null,
    lower_is_better: m.lowerIsBetter,
    what: m.what || null,
    values: sides.map((x) => {
      const blank = { value: null, display: null, season_percentile: null, all_time_percentile: null, low_sample: false }
      if (!m.positions.includes(x.row.pos)) return { status: `not a ${posOf(x).label.toLowerCase()} stat`, ...blank }
      if (+x.seasonId < m.since) return { status: 'not tracked that season', ...blank }
      const c = x.row.m[m.key]
      if (!c) return { status: 'no value', ...blank }
      return { status: 'ok', value: c[0], display: display(m.unit, c[0]), season_percentile: c[1], all_time_percentile: c[2], low_sample: (x.row.low || []).includes(m.key) }
    }),
  }))

  const notes = []
  const pools = sides.map((x) => `${(x.file.pools || {})[x.row.pos] || 0} qualified ${posOf(x).peers} in ${x.seasonId}`).filter((t, i, a) => a.indexOf(t) === i)
  notes.push(`Each stat shows the value, then its percentile among qualified players at his own position in his own season (${pools.join('; ')}), then all-time among every season since ${meta.seasons[meta.seasons.length - 1]}. Football has no league-wide pool. Stats tagged "lower is better" are already flipped, so a higher percentile is the better mark there too. Regular season only.`)
  if (positions.length > 1) notes.push('These players are at different positions, so their percentiles are against different groups and a stat can be on one card and not the other.')
  if (several) notes.push('Across seasons, compare the raw values and the all-time percentiles: a season percentile is inside that one year.')
  if (rows.some((r) => r.kind && r.kind !== 'output')) notes.push(KINDS)
  const live = sides.filter((x) => x.file.week)
  for (const text of [...new Set(live.map((x) => liveText(x.file, x.seasonId)))]) notes.push(`${text} Against a finished season, the counting totals are not like for like.`)
  const unq = sides.filter((x) => !x.row.qualified)
  if (unq.length) notes.push(`Below the qualifying line, so ranked against a pool he is not in: ${unq.map(tag).join(', ')}. Treat those percentiles with caution.`)
  const totals = sides.map((x) => totalsOf(meta, x.row))
  if (totals.some((t) => t.some((x) => x.derived))) notes.push(DERIVED)
  if (rows.some((r) => r.values.some((v) => v.low_sample))) notes.push('"low sample" marks a stat that has not had enough of its denominator to settle.')

  const structured = {
    players: sides.map((x, i) => ({
      id: x.row.id,
      name: x.row.name,
      season: x.seasonId,
      in_progress: liveOf(x.file),
      team: x.row.team,
      position: posOf(x).label,
      age: x.row.age ?? null,
      games: (x.row.d || {}).g ?? null,
      qualified: x.row.qualified,
      profile_score: x.row.score ?? null,
      league_ranks: (x.row.acc || []).map((a) => ({ rank: a.r, stat: a.s })),
      totals: totals[i],
      url: cardUrl(x.row.id, x.seasonId),
    })),
    stats: rows,
    notes,
    data_as_of: day(meta.generated),
    source: SOURCE,
  }

  const L = [`${sides.map(tag).join(' vs. ')}: Football Savant, side by side`]
  sides.forEach((x, i) => {
    const bits = [`${x.row.team || 'no team listed'}, ${posOf(x).label}${several ? '' : `, ${x.seasonId}`}${x.file.week ? `, through week ${x.file.week}` : ''}`]
    if (totals[i].length) bits.push(totalsText(totals[i]))
    if (x.row.acc && x.row.acc.length) bits.push(`NFL ranks: ${x.row.acc.map((a) => `${ordinal(a.r)} in ${a.s}`).join(', ')}`)
    L.push(`${tag(x)} (${bits[0]}): ${bits.slice(1).join('. ') || 'no totals on his card'}.`)
  })
  L.push('')
  for (const r of rows) {
    const cells = r.values.map((v, i) => {
      const who = short(sides[i])
      if (v.status !== 'ok') return `${who} ${v.status}`
      return `${who} ${v.display} (${nth(v.season_percentile)} in ${sides[i].seasonId}, ${nth(v.all_time_percentile)} all-time)${v.low_sample ? ' [low sample]' : ''}`
    })
    L.push(`- ${r.label}${r.kind && r.kind !== 'output' ? ` (${r.kind})` : ''}${r.lower_is_better ? ' [lower is better]' : ''}: ${cells.join(' | ')}`)
    if (r.what) L.push(`  ${r.what}`)
  }
  L.push('', ...notes, '', ...sides.map((x) => `${tag(x)}: ${cardUrl(x.row.id, x.seasonId)}`), `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- career ----------------------------------------------------------------------------

// One player, season by season. A career is a file per season, each a couple of megabytes
// once read, so they are read a few at a time and not kept (once() in api/_core.js).
export async function playerCareer({ player, stats, from, to }) {
  const meta = await loadMeta()
  const who = await resolvePlayer(player, null, meta)
  const first = parseSeason(from, meta)
  const last = parseSeason(to, meta)
  if (first && last && +first > +last) throw new SavantError(`"from" (${first}) is after "to" (${last}).`)

  const span0 = meta.seasons.filter((sn) => played(who, sn)).reverse()
  const wanted = span0.filter((sn) => (!first || +sn >= +first) && (!last || +sn <= +last))
  if (!wanted.length) throw new SavantError(`${who.name} has no seasons between ${first || span0[0]} and ${last || span0[span0.length - 1]}. Football Savant has him in ${seasonsOf(who)}.`)

  const loaded = await mapLimit(wanted, 4, async (sn) => {
    const file = await files.once(`seasons/${sn}.json`)
    const row = file.players.find((p) => p.id === who.id) || null
    // Keep only what the answer needs, so the file itself can be let go.
    return { sn, row, week: file.week || null, pools: file.pools || {}, generated: file.generated }
  })
  const have = loaded.filter((x) => x.row)
  if (!have.length) throw new SavantError(`${who.name} has no stats in those seasons. Football Savant has him in ${seasonsOf(who)}.`)

  // The stats: the ones asked for, or the headline stats of the position he played last.
  const positions = [...new Set(have.map((x) => x.row.pos))]
  const lastPos = have[have.length - 1].row.pos
  const everyStat = positions.flatMap((pos) => statsOf(meta, pos)).filter((m, i, a) => a.findIndex((x) => x.key === m.key) === i)
  let picked
  if (stats && stats.length) {
    picked = []
    for (const name of stats) { const m = findStat(everyStat, name, { tool: 'nfl_list_stats' }); if (!picked.includes(m)) picked.push(m) }
  } else picked = headlineOf(meta, lastPos)

  const seasons = have.map(({ sn, row, week, pools }) => {
    const pos = meta.positions[row.pos]
    return {
      season: sn,
      through_week: week,
      team: row.team,
      teams: row.tms || (row.team ? [row.team] : []),
      position: pos.label,
      age: row.age ?? null,
      games: (row.d || {}).g ?? null,
      qualified: row.qualified,
      qualified_at_position: pools[row.pos] || 0,
      profile_score: row.score ?? null,
      team_record: row.rec ? `${row.rec[0]}-${row.rec[1]}${row.rec[2] ? `-${row.rec[2]}` : ''}` : null,
      totals: totalsOf(meta, row),
      league_ranks: (row.acc || []).map((a) => ({ rank: a.r, stat: a.s })),
      stats: picked.map((m) => {
        const blank = { key: m.key, value: null, display: null, season_percentile: null, all_time_percentile: null, low_sample: false }
        if (!m.positions.includes(row.pos)) return { ...blank, status: `not a ${pos.label.toLowerCase()} stat` }
        if (+sn < m.since) return { ...blank, status: 'not tracked that season' }
        const c = row.m[m.key]
        if (!c) return { ...blank, status: 'no value' }
        return { key: m.key, status: 'ok', value: c[0], display: display(m.unit, c[0]), season_percentile: c[1], all_time_percentile: c[2], low_sample: (row.low || []).includes(m.key) }
      }),
    }
  })

  const bests = picked.map((m, i) => {
    let best = null
    for (const sn of seasons) {
      const v = sn.stats[i]
      if (!sn.qualified || v.status !== 'ok' || v.low_sample) continue
      if (!best || (m.lowerIsBetter ? v.value < best.value : v.value > best.value)) best = { season: sn.season, value: v.value, display: v.display, all_time_percentile: v.all_time_percentile }
    }
    return { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter, best }
  })

  const notes = [
    `Each stat shows the value, then its percentile among qualified players at his position in that same season, in brackets. Football has no league-wide pool, and his position is the one he played that year${positions.length > 1 ? ` (it changed: ${positions.map((p) => meta.positions[p].label).join(', ')})` : ''}. Regular season only.`,
    'Profile score is his mean percentile across his position\'s headline stats that season, as on the page\'s career arc. It is given for qualified seasons, and only for players with two or more seasons.',
  ]
  if (who.peak) notes.push(`His peak season by profile score is ${who.peak}.`)
  if (seasons.some((x) => x.totals.some((t) => t.derived))) notes.push(DERIVED)
  const live = seasons.find((x) => x.through_week)
  if (live) notes.push(`The ${live.season} season is still being played: its line runs through week ${live.through_week}, on small samples, and its totals are not a full season's.`)
  const unq = seasons.filter((x) => !x.qualified).map((x) => x.season)
  if (unq.length) notes.push(`He was below the qualifying line in ${unq.join(', ')}, so those percentiles rank a small sample against players who qualified and are left out of "best season".`)
  if (seasons.some((x) => x.stats.some((v) => v.low_sample))) notes.push('A star (*) marks a stat on too small a sample that season to have settled; those are left out of "best season" too.')
  if (picked.some((m) => m.layer && m.layer !== 'output')) notes.push(KINDS)
  const lineman = meta.caveats && meta.caveats.lineGames
  if (lineman && seasons.some((x) => lineman.positions.includes(have.find((h) => h.sn === x.season).row.pos) && +x.season < lineman.before)) {
    notes.push(`Before ${lineman.before} there were no snap counts, so an offensive lineman's games count is the games in which he drew a penalty flag, not the games he played.`)
  }

  const structured = {
    player: { id: who.id, name: who.name, first_season: String(who.from), last_season: String(who.to), peak_season: who.peak ? String(who.peak) : null, url: cardUrl(who.id, who.to) },
    stats: picked.map((m) => ({ key: m.key, label: m.label, kind: m.layer || null, lower_is_better: m.lowerIsBetter, what: m.what || null })),
    seasons,
    best_seasons: bests,
    notes,
    data_as_of: day(have[have.length - 1].generated || meta.generated),
    source: SOURCE,
  }

  const L = [`${who.name}: ${seasons.length === 1 ? 'one season' : `${seasons.length} seasons`}, ${seasons[0].season}${seasons.length > 1 ? ` to ${seasons[seasons.length - 1].season}` : ''}`]
  L.push(`Each line: season, team, position, age, his totals, then ${picked.map((m) => m.label).join(', ')}. The number in brackets is his percentile among his position that season.`, '')
  for (const sn of seasons) {
    const head = `${sn.season} ${sn.teams.join('/') || '?'} ${have.find((h) => h.sn === sn.season).row.pos}${sn.age != null ? `, age ${sn.age}` : ''}${sn.through_week ? `, through week ${sn.through_week}` : ''}${sn.qualified ? '' : ' (did not qualify)'}${sn.profile_score != null ? `, profile score ${sn.profile_score}` : ''}`
    const cells = sn.stats.map((v, i) => `${picked[i].label} ${v.status === 'ok' ? `${v.display} (${nth(v.season_percentile)})${v.low_sample ? '*' : ''}` : v.status === 'ok' ? '' : v.status === 'no value' ? 'no value' : v.status === 'not tracked that season' ? 'not tracked' : 'n/a'}`)
    L.push(`${head}: ${sn.totals.length ? totalsText(sn.totals) : 'no totals'} | ${cells.join(' · ')}`)
  }
  const best = bests.filter((b) => b.best)
  if (best.length && seasons.length > 1) {
    L.push('', 'Best season in each (qualified seasons with a settled sample):', ...best.map((b) => `- ${b.label}${b.lower_is_better ? ' [lower is better]' : ''}: ${b.best.display} in ${b.best.season} (${nth(b.best.all_time_percentile)} all-time)`))
  }
  L.push('', ...notes, '', `Card: ${structured.player.url}`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- the glossary ----------------------------------------------------------------------

export async function listStats({ position, group, query } = {}) {
  const meta = await loadMeta()
  const pos = resolvePosition(position, meta)
  let rows = statsOf(meta, pos)
  if (group) rows = rows.filter((m) => m.group === GROUPS[group])
  if (query) {
    const q = norm(query)
    const hit = new Set(rank(rows, query, () => 0, statNorm).map((r) => r.row.key))
    rows = rows.filter((m) => hit.has(m.key) || m.key === q || norm(`${m.what || ''} ${m.why || ''}`).includes(q))
  }
  // Without a position or a query the whole glossary is a few hundred stats: keys and names
  // only, and a word on how to get the meanings.
  const brief = !pos && !query
  const stats = rows.map((m) => ({
    key: m.key,
    label: m.label,
    group: meta.groups[m.group] || m.group,
    subgroup: m.sub || null,
    kind: m.layer || null,
    positions: m.positions,
    lower_is_better: m.lowerIsBetter,
    since: m.since,
    low_sample_below: m.lowSampleBelow ? `${m.lowSampleBelow} ${meta.denoms[m.den] || m.den}` : null,
    what: brief ? null : m.what || null,
    formula: brief ? null : m.formula || null,
    why: brief ? null : m.why || null,
  }))
  const counting = Object.keys(LEADER_TOTALS)
  const notes = [
    'Every stat is ranked only against qualified players at the same position: football has no league-wide pool.',
    KINDS,
    'Any key or name here can be given to nfl_get_leaderboard (with a position), nfl_compare_players or nfl_get_player_career.',
    `nfl_get_leaderboard also takes a counting stat with no position, for the NFL's top ten: ${counting.join(', ')} and a few others.`,
  ]
  if (brief) notes.unshift('This is the whole list, names and keys only. Give a position (for example "QB") or a query to get what each stat means.')
  const structured = { position: pos ? meta.positions[pos].label : null, count: stats.length, stats, notes, url: meta.page, source: SOURCE }
  if (!stats.length) return { structured, text: `No Football Savant stat${pos ? ` on a ${meta.positions[pos].label.toLowerCase()}'s card` : ''} matches${query ? ` "${query}"` : ' that'}. Call nfl_list_stats with only a position to see that position's stats.` }
  const L = [`${stats.length} Football Savant stat${stats.length === 1 ? '' : 's'}${pos ? ` on a ${meta.positions[pos].label.toLowerCase()}'s card` : ''}${query ? ` matching "${query}"` : ''}:`]
  let heading = null
  for (const m of stats) {
    const h = m.subgroup ? `${m.group}: ${m.subgroup}` : m.group
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [m.kind, m.lower_is_better ? 'lower is better' : null, m.since > +meta.seasons[meta.seasons.length - 1] ? `since ${m.since}` : null, pos ? null : m.positions.join('/')].filter(Boolean)
    L.push(`- ${m.label} (key "${m.key}")${tags.length ? ` [${tags.join('; ')}]` : ''}${m.what ? `: ${m.what}${m.why ? ` ${m.why}` : ''}` : ''}`)
  }
  L.push('', ...notes, '', `Page: ${meta.page}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const comp = z.object({ id: z.string(), name: z.string(), team: z.string().nullable(), match: z.number() })
const totalsShape = z.array(z.object({
  label: z.string(),
  value: z.number(),
  display: z.string(),
  derived: z.boolean().describe('True when it is a rate times the volume the rate was built from, which can land a yard or two off the official book. False when it is counted.'),
})).describe('Counting totals for the season, by the page\'s own recipes for his position.')

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
        'Get one NFL player\'s Football Savant profile (Western Conference Elitists, wcehoops.com) for one regular season: every stat on his card for the position he played that year, each with its value and two percentiles against qualified players at that same position, one within that season and one across all seasons since 1999 ("all-time"). There is no league-wide percentile. Which stats exist depends on position: passing, rushing, receiving, blocking, pass rush, run defense, coverage, kicking and punting, plus context, value and athletic measurements. Also returns his age, college and draft pick, his team\'s record and coach, where he ranked in the NFL in counting stats, the sample sizes his rates are built on, a profile score, statistical comps and weakness comps. Defaults to his most recent season, which may still be in progress; the result then says through which week. Seasons from 1999 on. Stats a season did not track are listed as not tracked, and stats on a small sample are marked. Includes the link to his card.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nfl_search_players (e.g. "00-0033873") or a full name (e.g. "Patrick Mahomes"). If a name fits more than one player, the error lists their ids.'),
        season: z.string().trim().max(12).optional().describe('The year the season began, e.g. "2024". Omit for his most recent season.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which panel of stats to return: "all" (default), or one panel with each stat explained: "context" (games, snaps, penalties), "passing", "rushing", "receiving", "blocking", "pass_rush", "run_defense", "coverage", "kicking" (kicking and punting), "value" (total EPA, fantasy points) or "athletic" (size and combine).'),
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
        league_ranks: z.array(z.object({ rank: z.number().int(), stat: z.string() })).describe('Where he ranked in the whole NFL in counting stats. Top-ten places only, at most six a player.'),
        injury: z.object({ status: z.string(), injury: z.string().nullable(), week: z.number().nullable() }).nullable().describe('This week\'s injury report. Season in progress only.'),
        sample: z.array(z.object({ key: z.string(), label: z.string(), value: z.number() })).describe('What his rates are built on: games, dropbacks, carries, targets, snaps and so on.'),
        totals: totalsShape,
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
          what: z.string().nullable().describe('What the stat is, in the page\'s words.'),
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
  {
    name: 'nfl_get_leaderboard',
    config: {
      title: 'Get an NFL leaderboard',
      description:
        'Rank NFL players in one regular season, by Football Savant\'s Leaderboard Builder rules (wcehoops.com). Use for "who leads the NFL in", "top five running backs" and "best on the team" questions instead of looking players up one by one. Two kinds: with a position, qualified players at it ranked by one of its stats (omit the stat for its main one), each with value, percentile at the position and its other headline stats; or with a counting stat and no position ("rushing yards", "passing TDs", "receptions", "sacks"), the NFL\'s top ten across all positions with totals where the site can derive them. The latest season may be in progress; the result says through which week. Seasons from 1999.',
      inputSchema: {
        position: z.string().trim().max(40).optional().describe('QB, RB, WR, TE, OL, OT, OG, OC, ED (edge), DI (interior line), LB, CB, S, K or P, or a name such as "running back". Needed unless stat is an NFL-wide counting stat.'),
        stat: z.string().trim().max(60).optional().describe('A stat on that position\'s card by key or name (e.g. "epadb", "yards after contact"), or with no position a counting stat (e.g. "rushing yards", "sacks"). Omit for the position\'s main stat.'),
        season: z.string().trim().max(12).optional().describe('The year the season began, e.g. "2024". Omit for the latest.'),
        team: z.string().trim().max(40).optional().describe('Only this team, by code or name, e.g. "KC", "Chiefs".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Rows to list (default 10).'),
        order: z.enum(['top', 'bottom']).default('top').describe('Best first (default) or worst first. Position boards only.'),
        sample: z.enum(['settled', 'everyone']).default('settled').describe('"settled" (default) leaves out samples too small to trust, as the page does; "everyone" lists them, marked.'),
      },
      outputSchema: {
        mode: z.string().describe('"position_stat" or "league_leaders".'),
        stat: z.object({ key: z.string(), label: z.string(), what: z.string().nullable(), kind: z.string().nullable(), lower_is_better: z.boolean() }),
        season: z.string(),
        in_progress: z.object({ through_week: z.number(), week_under_way: z.number().nullable() }).nullable().describe('Set when the season is still being played.'),
        position: z.string().nullable(),
        order: z.string(),
        sample: z.string().nullable(),
        filters: z.object({ team: z.string().nullable() }),
        ranked: z.number().int().describe('How many players the board ranks, after the filters.'),
        hidden_low_sample: z.number().int().describe('Qualified players left off for too small a sample.'),
        fell_back_to_everyone: z.boolean().describe('True when nobody had a settled sample, so everyone is listed.'),
        count: z.number().int(),
        leaders: z.array(z.object({
          rank: z.number().int().describe('Place, counted from the top. Equal values share a place.'),
          tied: z.boolean(),
          id: z.string(),
          name: z.string(),
          team: z.string().nullable(),
          position: z.string(),
          value: z.number().nullable().describe('The ranking stat\'s value; for league leaders, the total where the site can derive it.'),
          display: z.string().nullable(),
          season_percentile: pct.describe('Among qualified players at his position that season.'),
          all_time_percentile: pct,
          total: z.number().nullable(),
          total_derived: z.boolean().nullable(),
          games: z.number().nullable(),
          low_sample: z.boolean(),
          on_card: z.boolean().describe('False when the page leaves the stat\'s whole panel off his card for too small a sample: he is ranked, with no percentile.'),
          columns: z.array(z.object({ key: z.string(), label: z.string(), display: z.string().nullable(), season_percentile: pct })).describe('The position\'s other headline stats.'),
          url: z.string(),
        })),
        notes: z.array(z.string()).describe('Who is ranked, and how to read the board.'),
        url: z.string().describe('The same leaderboard on the site, where the page can show it.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NFL leaderboard', ...READ_ONLY },
    },
    run: (args) => leaderboard(args),
  },
  {
    name: 'nfl_compare_players',
    config: {
      title: 'Compare NFL players side by side',
      description:
        'Put two to four NFL player-seasons side by side on the same Football Savant stats (wcehoops.com): counting totals and NFL ranks, then each stat\'s value with his percentile at his position (that season and all-time) and what the stat means. Use for "who has been better", or name one player twice with two seasons. Defaults to each player\'s latest season and his position\'s headline stats. Best for players at the same position.',
      inputSchema: {
        players: z.array(z.string().trim().min(1).max(80)).min(2).max(4).describe('Two to four names or ids. Repeat a player to compare two of his seasons.'),
        seasons: z.array(z.string().trim().max(12)).min(1).max(4).optional().describe('One season for everyone, e.g. ["2024"], or one per player in order. Omit for each player\'s latest.'),
        group: z.enum(['headline', ...Object.keys(GROUPS)]).default('headline').describe('"headline" (default) or one panel.'),
        stats: z.array(z.string().trim().min(1).max(60)).max(12).optional().describe('Instead of a group: up to 12 stat keys or names.'),
      },
      outputSchema: {
        players: z.array(z.object({
          id: z.string(), name: z.string(), season: z.string(),
          in_progress: z.object({ through_week: z.number(), week_under_way: z.number().nullable() }).nullable(),
          team: z.string().nullable(), position: z.string(), age: z.number().nullable(), games: z.number().nullable(), qualified: z.boolean(),
          profile_score: z.number().nullable(), league_ranks: z.array(z.object({ rank: z.number().int(), stat: z.string() })), totals: totalsShape, url: z.string(),
        })),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), kind: z.string().nullable(), lower_is_better: z.boolean(), what: z.string().nullable(),
          values: z.array(z.object({
            status: z.string().describe('"ok", "no value" (a gap, not a zero), "not tracked that season", or that the stat is not on his position\'s card.'),
            value: z.number().nullable(), display: z.string().nullable(), season_percentile: pct, all_time_percentile: pct, low_sample: z.boolean(),
          })).describe('One per player, in the order of players.'),
        })),
        notes: z.array(z.string()),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Compare NFL players side by side', ...READ_ONLY },
    },
    run: (args) => comparePlayers(args),
  },
  {
    name: 'nfl_get_player_career',
    config: {
      title: 'Get an NFL player\'s career, season by season',
      description:
        'One NFL player season by season from Football Savant (wcehoops.com): team, position, age, counting totals (yards, touchdowns, sacks; derived from rates as the page derives them), NFL ranks and profile score each year, up to 8 chosen stats with value and percentile at his position, and his best season in each. Use for "how has he changed", "when did he peak". Defaults to his whole career and his position\'s headline stats. Seasons from 1999.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id or full name.'),
        stats: z.array(z.string().trim().min(1).max(60)).max(8).optional().describe('Up to 8 stat keys or names, e.g. ["epadb", "cpoe"]. Omit for his position\'s headline stats.'),
        from: z.string().trim().max(12).optional().describe('First season to include, e.g. "2018".'),
        to: z.string().trim().max(12).optional().describe('Last season to include.'),
      },
      outputSchema: {
        player: z.object({ id: z.string(), name: z.string(), first_season: z.string(), last_season: z.string(), peak_season: z.string().nullable().describe('His best qualified season by profile score.'), url: z.string() }),
        stats: z.array(z.object({ key: z.string(), label: z.string(), kind: z.string().nullable(), lower_is_better: z.boolean(), what: z.string().nullable() })),
        seasons: z.array(z.object({
          season: z.string(), through_week: z.number().nullable().describe('Set on a season still being played.'), team: z.string().nullable(), teams: z.array(z.string()),
          position: z.string(), age: z.number().nullable(), games: z.number().nullable(), qualified: z.boolean(), qualified_at_position: z.number().int(),
          profile_score: z.number().nullable(), team_record: z.string().nullable(), totals: totalsShape,
          league_ranks: z.array(z.object({ rank: z.number().int(), stat: z.string() })),
          stats: z.array(z.object({
            key: z.string(), status: z.string(), value: z.number().nullable(), display: z.string().nullable(), season_percentile: pct, all_time_percentile: pct, low_sample: z.boolean(),
          })).describe('In the order of stats.'),
        })).describe('Oldest first.'),
        best_seasons: z.array(z.object({
          key: z.string(), label: z.string(), lower_is_better: z.boolean(),
          best: z.object({ season: z.string(), value: z.number(), display: z.string(), all_time_percentile: pct }).nullable(),
        })).describe('His best qualified season in each stat, settled samples only.'),
        notes: z.array(z.string()),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NFL player\'s career, season by season', ...READ_ONLY },
    },
    run: (args) => playerCareer(args),
  },
  {
    name: 'nfl_list_stats',
    config: {
      title: 'List Football Savant\'s stats',
      description:
        'Football Savant\'s glossary (wcehoops.com): the stats on a position\'s card, each with key, name, meaning and why it matters in the page\'s words, formula, first season, the sample it needs, and whether lower is better. Use to explain a stat ("what is CPOE") or to find the key for nfl_get_leaderboard, nfl_compare_players or nfl_get_player_career. Give a position or a query; with neither it lists names and keys only.',
      inputSchema: {
        position: z.string().trim().max(40).optional().describe('A position code or name, e.g. "QB", "edge".'),
        group: z.enum(Object.keys(GROUPS)).optional().describe('Only one panel.'),
        query: z.string().trim().min(2).max(60).optional().describe('Only stats whose name or meaning matches, e.g. "pressure".'),
      },
      outputSchema: {
        position: z.string().nullable(),
        count: z.number().int(),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), subgroup: z.string().nullable(), kind: z.string().nullable(), positions: z.array(z.string()),
          lower_is_better: z.boolean(), since: z.number(), low_sample_below: z.string().nullable(),
          what: z.string().nullable(), formula: z.string().nullable(), why: z.string().nullable(),
        })),
        notes: z.array(z.string()),
        url: z.string(),
        source: z.string(),
      },
      annotations: { title: 'List Football Savant\'s stats', ...READ_ONLY },
    },
    run: (args) => listStats(args),
  },
]
