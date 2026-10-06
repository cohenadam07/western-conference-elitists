// api/_ufc.js — UFC Savant, as answers. One section of the AI connector (api/mcp.js): it
// knows the fight game, the connector only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/ufc/v1/ (see
// scripts/lib/savant-api-ufc.mjs): a glossary, a fighter index, the scheduled cards, and
// sixteen files of fighters in which every stat already carries its percentiles. Nothing is
// computed here that the page computes — percentiles are read, never re-derived — so an
// answer from this file is the number on the fighter's bars. Loading, caching and name
// matching are shared with the other sections and live in api/_core.js.
//
// HOW UFC SAVANT DIFFERS FROM THE OTHER SAVANTS
// A fighter has no season. A profile is a window of his UFC fights (career, last 5, last 3)
// and he is ranked inside his division, which is the weight class he fought at most in that
// window. So a man who moved up can be a lightweight over his career and a welterweight
// over his last three, and the answer says which.
//
// WHAT AN ANSWER ALWAYS SAYS
//   - which pool each percentile is from, on every line: "vs. active lightweights" (the
//     view the page opens in) and "vs. all-time lightweights" (its All-time switch)
//   - how big those pools are, and when one is too small to give a percentile at all
//   - when the fighter is below the qualifying line, or inactive, and so is ranked against
//     a pool he is not part of
//   - when a stat is on too small a sample to trust (the page hatches those bars), and
//     what the sample is
//   - when his fights predate a stat, rather than showing a zero
//   - the date the data runs through, because "active" and his age are counted from it
//   - where the page is: ufc-savant.html#f=<id>&w=<window>
//
// Values print exactly the way the page prints them. Fight results are reported as the data
// has them and nothing is added: no reading of form, no prediction.
//
// BEYOND ONE FIGHTER
//   leaderboard    the page's Leaderboard Builder: a division (or all men, all women), a
//                  window, active fighters or all-time, ranked by a stat or by the official
//                  UFC ranking; settled samples only unless asked
//   compare        two to four fighters side by side, with any recent fights between them
//   list stats     the glossary: every stat's key, name and meaning
//
// THE NEXT CARD IS JUDGED AGAINST TODAY
// The list of scheduled cards is only as fresh as the last data build, so its first entry
// can be a card that has already been fought. Each card is marked past, today or upcoming
// against today's date on the US west coast, as the page does, and "next" is the first that
// is not past. Past cards are left out unless asked for.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError, boardSlice, day, findStat, makeLoader, miss, norm, ordinal, prepare, prepareStats, rank, ranked, statNorm, thousands, topTier } from './_core.js'

// Meta, the index, the cards and all sixteen fighter files fit, so nothing is ever evicted.
const files = makeLoader('savant-api/ufc/v1', { what: 'UFC Savant', maxCached: 20 })

export const WINDOWS = ['career', 'l5', 'l3']
export const GROUPS = { context: 'ctx', striking: 'strike', grappling: 'grap', finishing: 'fin', rounds: 'rounds' }
const SOURCE = 'UFC Savant, Western Conference Elitists (wcehoops.com). Fight data: ufcstats.com'

const loadMeta = () => files.load('meta.json')
const loadUpcoming = () => files.load('upcoming.json')
const loadShard = (id) => files.load(`fighters/${String(id)[0]}.json`)

// The fighter index, prepared for matching once per load: by name, by nickname, and by the
// two together ("Tank Abbott" is David Abbott, nicknamed Tank).
const prepared = new WeakMap()
async function loadIndex() {
  const file = await files.load('fighters.json')
  let idx = prepared.get(file)
  if (!idx) {
    const nicked = file.fighters.filter((f) => f.nick)
    idx = {
      byId: new Map(file.fighters.map((f) => [f.id, f])),
      names: prepare(file.fighters),
      nicks: prepare(nicked, (f) => f.nick),
      both: prepare(nicked, (f) => `${f.name} ${f.nick}`),
    }
    prepared.set(file, idx)
  }
  return idx
}

// Among equally good name matches: active fighters first, then the longer UFC career, then
// the more recent. The page's own search leans the same way.
const prominent = (a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.n || 0) - (a.n || 0) || String(b.last).localeCompare(String(a.last))

// Everyone a query could mean, best first: [{ row, score }]. A name may be misspelled by a
// letter or two; a nickname has to be typed as it is, or it would match half the roster.
function findFighters(idx, query) {
  const best = new Map()
  const take = (found, floor) => {
    for (const { row, score } of found) {
      if (score < floor) continue
      const had = best.get(row.id)
      if (!had || score > had.score) best.set(row.id, { row: idx.byId.get(row.id), score })
    }
  }
  take(rank(idx.names, query), 1)
  take(rank(idx.nicks, query), 50)
  take(rank(idx.both, query), 50)
  return [...best.values()].sort((a, b) => b.score - a.score || prominent(a.row, b.row) || a.row.name.localeCompare(b.row.name))
}

// ---- small formatting helpers ----------------------------------------------------------

export const fighterUrl = (meta, id, window) => meta.fighterUrl.replace('{id}', encodeURIComponent(id)).replace('{window}', window || meta.defaults.window)
export const matchupUrl = (meta, a, b) => meta.matchupUrl.replace('{a}', encodeURIComponent(a)).replace('{b}', encodeURIComponent(b)).replace('{window}', meta.matchupWindow)

// The page's mmss(), signed() and inFt().
export const clock = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function signedNumber(v, dp, plus) {
  const mag = Math.abs(v).toFixed(dp)
  if (!/[1-9]/.test(mag)) return mag
  return (v < 0 ? '−' : plus ? '+' : '') + mag
}
export const feetInches = (n) => { const f = Math.floor(n / 12); return `${f}'${Math.round(n - f * 12)}"` }

// A stat's value the way the page prints it (its fmt()).
export function display(unit, v) {
  if (miss(v)) return '—'
  const n = +v
  switch (unit) {
    case 'pct0': return `${Math.round(n)}%`
    case 'pct1': return `${n.toFixed(1)}%`
    case 'num0': return String(Math.round(n))
    case 'num1': return signedNumber(n, 1, false)
    case 'num2': return signedNumber(n, 2, false)
    case 'sgn2': return signedNumber(n, 2, true)
    case 'sgnm': return (n < 0 ? '−' : '+') + clock(Math.abs(n) * 60)
    case 'mins': return clock(n * 60)
    case 'inch': return `${n.toFixed(0)}"`
    case 'ftin': return feetInches(n)
    default: return String(n)
  }
}

// The page's spanTxt(): a reign's length in words — "26d", "11m", "2y 4m".
export function span(days) {
  if (days == null) return '—'
  if (days < 60) return `${days}d`
  const mo = Math.round(days / 30.44)
  if (mo < 24) return `${mo}m`
  let y = Math.floor(days / 365.25)
  let m = Math.round((days - y * 365.25) / 30.44)
  if (m >= 12) { y++; m = 0 }
  return `${y}y${m ? ` ${m}m` : ''}`
}

// [wins, losses, draws, no contests] -> "29-1", "15-2-3", "28-1 (1 NC)"
export function recordText(rec) {
  if (!rec) return null
  const [w, l, d, nc] = rec
  return `${w}-${l}${d ? `-${d}` : ''}${nc ? ` (${nc} NC)` : ''}`
}
const recordOf = (rec) => (rec ? { wins: rec[0], losses: rec[1], draws: rec[2] || 0, no_contests: rec[3] || 0, text: recordText(rec) } : null)

const divisionLabel = (meta, key) => { const d = meta.divisions.find((x) => x.key === key); return d ? d.label : key || 'no division' }
// "Lightweight" -> "lightweights", "Women's Strawweight" -> "women's strawweights",
// "Open weight" -> "open weight fighters"
function peers(meta, key) {
  const l = divisionLabel(meta, key).toLowerCase()
  return /\Sweight$/.test(l) ? `${l}s` : `${l} fighters`
}

// The page's badge wording: champion, interim champion, or a number.
const rankText = (n) => (n === 0 ? 'champion' : n === 0.5 ? 'interim champion' : `#${n}`)

// "Last 5 fights" -> "last 5 fights"; "UFC career" stays as it is.
const lowerFirst = (label) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label)

const RESULT = { W: 'win over', L: 'loss to', D: 'draw with', NC: 'no contest with' }

// Which slot of a stat's cell holds a view's percentile. Slot 0 is the value.
function viewSlot(meta, baseline, cohort) {
  const i = meta.views.findIndex((v) => v[0] === baseline && v[1] === cohort)
  if (i < 0) throw new Error(`ufc: the ${baseline}/${cohort} view is not in the files`)
  return i + 1
}
const poolSize = (meta, window, baseline, div) => (((meta.pools[window] || {})[baseline] || {}).div || {})[div] || 0

// ---- finding the fighter ---------------------------------------------------------------

const years = (row) => { const a = String(row.first).slice(0, 4); const b = String(row.last).slice(0, 4); return a === b ? a : `${a} to ${b}` }
const candidateLine = (meta, row) =>
  `${row.name}${row.nick ? ` "${row.nick}"` : ''} (id ${row.id}): ${divisionLabel(meta, row.div)}, ${row.n} UFC fight${row.n === 1 ? '' : 's'}, ${years(row)}, ${row.active ? 'active' : 'inactive'}`

// An id (sixteen hex characters) or a name. A name has to land on one fighter; when it could
// be several, they are listed so the caller can pick by id.
async function resolveFighter(input, meta) {
  const idx = await loadIndex()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a fighter name or id.')

  if (/^[0-9a-f]{16}$/i.test(raw)) {
    const byId = idx.byId.get(raw.toLowerCase())
    if (byId) return byId
    throw new SavantError(`No fighter has the id "${raw}". Search by name with ufc_search_fighters.`)
  }

  const ranked = findFighters(idx, raw)
  if (!ranked.length) {
    // UFC Savant lists each fighter under one name. Someone asked for by a former or
    // alternate name usually still shares the surname, so offer those.
    const surname = raw.split(/\s+/).pop()
    const near = norm(surname).length >= 3 && norm(surname) !== norm(raw) ? findFighters(idx, surname).filter((r) => r.score >= 60).slice(0, 6) : []
    const tail = near.length
      ? ` Fighters named "${surname}":\n${near.map((r) => `- ${candidateLine(meta, r.row)}`).join('\n')}\nUFC Savant lists each fighter under one name, so a former or alternate name is not found.`
      : ' Check the spelling, try the last name alone, or search with ufc_search_fighters. UFC Savant lists each fighter under one name, so a former or alternate name is not found.'
    throw new SavantError(`No fighter matches "${raw}".${tail}`)
  }

  const top = ranked[0].score
  const best = topTier(ranked)
  // One clear answer: the only fighter at the top, matched on whole words or a prefix. A name
  // that matches only as a near spelling never resolves on its own, even alone: it may be
  // someone who is not in the data, one letter away from someone who is.
  if (best.length === 1 && top >= 60) return best[0]

  const list = (best.length > 1 ? best : ranked.slice(0, 6).map((r) => r.row)).slice(0, 8)
  const why = best.length > 1 ? `${best.length} fighters match "${raw}"` : `"${raw}" is not an exact match`
  throw new SavantError(`${why}. Call again with one of these ids:\n${list.map((r) => `- ${candidateLine(meta, r)}`).join('\n')}`)
}

// ---- search --------------------------------------------------------------------------

export async function searchFighters({ query, limit = 10 }) {
  const [meta, idx] = await Promise.all([loadMeta(), loadIndex()])
  const ranked = findFighters(idx, query)
  const shown = ranked.slice(0, limit).map(({ row }) => ({
    id: row.id,
    name: row.name,
    nickname: row.nick || null,
    division: divisionLabel(meta, row.div),
    active: row.active,
    ufc_fights: row.n,
    pro_record: recordText(row.rec),
    first_ufc_fight: row.first,
    last_ufc_fight: row.last,
    url: fighterUrl(meta, row.id),
  }))

  const structured = {
    query,
    total: ranked.length,
    count: shown.length,
    fighters: shown,
    notes: [],
    data_through: meta.latest,
    source: SOURCE,
  }
  const dates = `Data through ${meta.latest}. "Active" means a UFC fight in the ${meta.activeMonths} months before that date.`
  structured.notes.push(dates)
  if (!shown.length) {
    structured.notes.push('UFC Savant lists each fighter under one name, so a former or alternate name is not found.')
    return { structured, text: `No fighter in UFC Savant matches "${query}". It covers everyone with a UFC fight from ${meta.earliest} through ${meta.latest}, under the name ufcstats.com lists them by, so a former or alternate name is not found. Check the spelling or try the last name alone.` }
  }
  const head = ranked.length === 1 ? `1 fighter matches "${query}":` : `${ranked.length} fighters match "${query}"${ranked.length > shown.length ? `, showing the first ${shown.length}` : ''}:`
  const lines = shown.map((f, i) =>
    `${i + 1}. ${f.name}${f.nickname ? ` "${f.nickname}"` : ''} (id ${f.id}): ${f.division}, ${f.active ? 'active' : 'inactive'}, ${f.ufc_fights} UFC fight${f.ufc_fights === 1 ? '' : 's'} from ${f.first_ufc_fight} to ${f.last_ufc_fight}${f.pro_record ? `, pro record ${f.pro_record}` : ''}. ${f.url}`)
  structured.notes.push('Division is the weight class fought at most over the UFC career.')
  const names = shown.map((f) => f.name)
  if (names.some((n, i) => names.indexOf(n) !== i)) structured.notes.push('Two different fighters can share a name. Tell them apart by division and dates, and use the id.')
  return { structured, text: `${head}\n${lines.join('\n')}\n\n${structured.notes.slice(1).join(' ')} ${dates}` }
}

// ---- profile -------------------------------------------------------------------------

export async function fighterProfile({ fighter, window, group = 'all' }) {
  const meta = await loadMeta()
  const win = window || meta.defaults.window
  if (!meta.windows[win]) {
    throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  }
  const groupKey = group === 'all' ? null : GROUPS[group]
  if (group !== 'all' && !meta.groups[groupKey]) throw new SavantError(`UFC Savant has no "${group}" group. Use one of: all, ${Object.keys(GROUPS).join(', ')}.`)

  const who = await resolveFighter(fighter, meta)
  const row = (await loadShard(who.id)).fighters[who.id]
  const w = row && row.w[win]
  if (!w) throw new SavantError(`UFC Savant has no ${meta.windows[win]} numbers for ${who.name} right now. Try again in a minute.`)

  const label = meta.windows[win]
  const career = row.w.career || w
  // The women's divisions are marked in the data; the wording follows.
  const woman = (meta.divisions.find((d) => d.key === career.div) || {}).sex === 'F'
  const [he, his, him] = woman ? ['she', 'her', 'her'] : ['he', 'his', 'him']
  // The page's stat explanations are written about a man ("strikes he lands", "both men").
  // They are quoted, not reworded, so on a woman's profile only the ones that fit are quoted.
  const fits = (text) => (text && (!woman || !/\b(he|his|him|himself|man|men)\b/i.test(text)) ? text : null)
  const cap = (word) => word[0].toUpperCase() + word.slice(1)
  const whole = win !== 'career' && w.n === career.n
  const division = divisionLabel(meta, w.div)
  const [minFights, minMinutes] = meta.qualify[win]
  const slot = { active: viewSlot(meta, 'active', 'div'), all: viewSlot(meta, 'all', 'div') }
  const pool = {
    active: { label: `active ${peers(meta, w.div)}`, size: poolSize(meta, win, 'active', w.div) },
    all_time: { label: `all-time ${peers(meta, w.div)}`, size: poolSize(meta, win, 'all', w.div) },
  }

  const low = w.low || {}
  const stats = []
  const noValue = []
  const notTracked = []
  for (const m of meta.metrics) {
    if (groupKey && m.group !== groupKey) continue
    const cell = w.m[m.key]
    if (!cell) {
      if ((w.untracked || []).includes(m.key)) notTracked.push({ key: m.key, label: m.label, since: m.since })
      else noValue.push({ key: m.key, label: m.label })
      continue
    }
    const thin = m.key in low
    stats.push({
      key: m.key,
      label: m.label,
      group: meta.groups[m.group] || m.group,
      subgroup: m.sub || null,
      tag: m.layer || null,
      value: cell[0],
      display: display(m.unit, cell[0]),
      active_percentile: cell[slot.active],
      all_time_percentile: cell[slot.all],
      lower_is_better: m.lowerIsBetter,
      low_sample: thin,
      sample: thin ? { have: low[m.key], needs: m.lowSampleBelow, of: meta.denoms[m.sample] || m.sample } : null,
      what: fits(m.explain && m.explain.w),
    })
  }

  const rankings = Object.entries(row.rks || {})
    .sort((a, b) => a[1] - b[1])
    .map(([div, n]) => ({ division: divisionLabel(meta, div), rank: n, text: n === 0 || n === 0.5 ? `${divisionLabel(meta, div)} ${rankText(n)}` : `UFC ${rankText(n)} at ${divisionLabel(meta, div)}` }))

  const structured = {
    fighter: {
      id: row.id,
      name: row.name,
      nickname: row.nick || null,
      division,
      career_division: divisionLabel(meta, career.div),
      height_inches: row.ht ?? null,
      height: miss(row.ht) ? null : feetInches(row.ht),
      reach_inches: row.reach ?? null,
      weight_lb: row.wt ?? null,
      stance: row.stance || null,
      born: row.dob || null,
      age: row.age ?? null,
      pro_record: recordOf(row.rec),
      ufc_record: recordOf(row.ufc),
      ufc_debut: row.first,
      last_ufc_fight: row.last,
      active: row.active,
      rankings,
      pound_for_pound: row.p4p ?? null,
      rankings_as_of: rankings.length || row.p4p != null ? meta.rankingsAt : null,
    },
    window: { key: win, label, fights: w.n, earliest_year: w.since, qualified: w.qualified, division },
    pools: pool,
    stats,
    no_value: noValue,
    not_tracked: notTracked,
    notes: [],
    url: fighterUrl(meta, row.id, win),
    data_through: meta.latest,
    data_built: day(meta.generated),
    source: SOURCE,
  }

  // ---- the same thing in words ----
  const L = []
  const fights = (n) => `${n} fight${n === 1 ? '' : 's'}`
  L.push(`${row.name}${row.nick ? ` "${row.nick}"` : ''}: ${division}, ${label} (${fights(w.n)}${win === 'career' ? '' : `, the earliest in ${w.since}`})`)
  const f = structured.fighter
  const facts = []
  if (f.pro_record) facts.push(`Pro record ${f.pro_record.text}`)
  facts.push(`UFC record ${f.ufc_record.text}`)
  facts.push(`UFC debut ${row.first}, last UFC fight ${row.last}`)
  L.push(`${facts.join('. ')}. ${row.active ? 'Active' : 'Inactive'} as of ${meta.latest}.`)
  const body = []
  if (f.height) body.push(`height ${f.height}`)
  if (!miss(row.reach)) body.push(`reach ${row.reach}"`)
  if (!miss(row.wt)) body.push(`listed weight ${row.wt} lb`)
  if (row.stance) body.push(`stance ${row.stance}`)
  // The page prints an age for everyone, counted from the date of birth to the data date. The
  // data does not say whether a fighter from long ago is living, so only an active fighter
  // is given an age in words.
  if (!miss(row.age) && row.active) body.push(`age ${row.age} as of ${meta.latest}${row.dob ? ` (born ${row.dob})` : ''}`)
  else if (row.dob) body.push(`born ${row.dob}${miss(row.age) ? '' : ` (${row.age} years before ${meta.latest})`}`)
  if (body.length) L.push(`${body.join(', ').replace(/^./, (c) => c.toUpperCase())}.`)
  if (rankings.length || row.p4p != null) {
    const bits = rankings.map((r) => r.text)
    if (row.p4p != null) bits.push(`#${row.p4p} pound-for-pound`)
    L.push(`Official UFC ranking as of ${meta.rankingsAt}: ${bits.join('; ')}.`)
  }
  L.push('')

  // The caveats. They go into the text and, as notes, into the structured result, so a
  // client that only passes one of the two along still carries them.
  const notes = structured.notes
  const say = (...lines) => { for (const s of lines) { notes.push(s); L.push(s) } }
  const sized = (n) => `${thousands(n)} fighter${n === 1 ? '' : 's'}`
  say(`Each stat shows two percentiles, both inside ${his} division and both over each fighter's own ${lowerFirst(label)}. "vs. ${pool.active.label}" is against the qualified ${division} fighters who have fought in the UFC in the ${meta.activeMonths} months before ${meta.latest} (${sized(pool.active.size)}); it is the view the page opens in. "vs. ${pool.all_time.label}" is against every qualified ${division} fighter in UFC history (${sized(pool.all_time.size)}). Qualifying: ${minFights}+ fights and ${minMinutes}+ minutes of cage time in the window.`)
  const divisions = Object.entries(meta.windows).filter(([k]) => row.w[k]).map(([k, lab]) => [lab, divisionLabel(meta, row.w[k].div)])
  const moved = new Set(divisions.map((d) => d[1])).size > 1
  say(`${cap(his)} division is the weight class ${he} fought at most in the window (the most recent on ties).${moved ? ` It changes with the window: ${divisions.map(([lab, d]) => `${lowerFirst(lab)} ${d}`).join(', ')}.` : ''}`)
  say(`A percentile is where ${his} number falls in that pool, from 1 to 99. Stats marked "lower is better" are already flipped, so higher is the better mark. For style and context numbers (where ${his} strikes go, pace, fight length, how often ${he} goes to a decision) a percentile describes ${him}, it does not grade ${him}.`)
  for (const [key, p] of [['active', pool.active], ['all_time', pool.all_time]]) {
    if (p.size < 2) say(`There ${p.size === 1 ? 'is only 1 qualified fighter' : 'are no qualified fighters'} among ${p.label}, so no "vs. ${p.label}" percentile exists${key === 'active' ? `; the page shows no bars for ${him} in the view it opens in` : ''}.`)
  }
  if (!w.qualified) {
    const guide = (meta.metrics.find((m) => m.key === 'n') || {}).explain
    say(`${cap(he)} is below the qualifying line (${minFights} fights, ${minMinutes} minutes) for this window: ${he} is ranked against the pools but is not part of them. ${cap(he)} has ${fights(w.n)} in it.${fits(guide && guide.y) ? ` The page's own guide: "${guide.y}"` : ''}`)
  }
  if (!row.active) say(`${cap(he)} is inactive: no UFC fight in the ${meta.activeMonths} months before ${meta.latest}. ${cap(he)} is ranked against the active pool but is not part of it.`)
  if (whole) say(`${cap(he)} has ${fights(career.n)} in the UFC, so "${label}" is ${his} whole UFC career.`)

  let heading = null
  const pct = (p) => (p == null ? 'n/a' : ordinal(p))
  for (const s of stats) {
    const h = s.subgroup && s.subgroup !== s.group ? `${s.group}: ${s.subgroup}` : s.group
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [
      s.lower_is_better ? 'lower is better' : null,
      s.low_sample ? `low sample: ${Math.round(s.sample.have)} of the ${s.sample.needs} ${s.sample.of} it needs` : null,
    ].filter(Boolean)
    L.push(`- ${s.label}: ${s.display} (vs. ${pool.active.label} ${pct(s.active_percentile)}, vs. ${pool.all_time.label} ${pct(s.all_time_percentile)})${tags.length ? ` [${tags.join('; ')}]` : ''}`)
    if (groupKey && s.what) L.push(`  ${s.what}`)
  }
  if (!stats.length) L.push('', 'No stats in this group for that window.')
  L.push('')

  const shown = new Set(stats.map((s) => s.key))
  if (meta.metrics.some((m) => (m.unit === 'mins' || m.unit === 'sgnm') && shown.has(m.key))) say('Times print as minutes:seconds.')
  if (stats.some((s) => s.low_sample)) say('"low sample" means the stat has not reached the sample it needs before it settles down. The page hatches those bars.')
  const rating = stats.find((s) => s.key === 'elo')
  if (rating && rating.what && !groupKey) say(`${rating.label}: ${rating.what}`)
  const partial = meta.metrics.filter((m) => (w.partial || []).includes(m.key) && shown.has(m.key))
  for (const since of [...new Set(partial.map((m) => m.since))]) {
    say(`Not tracked before ${since}, so these cover only ${his} fights from ${since} on: ${partial.filter((m) => m.since === since).map((m) => m.label).join(', ')}.`)
  }
  if (notTracked.length) {
    const s = `Not tracked: every fight in this window is from before these stats were recorded, so they have no value rather than a zero: ${notTracked.map((m) => `${m.label} (since ${m.since})`).join(', ')}.`
    say(s)
  }
  if (noValue.length) say(`No value in this window, so the page draws no bar (nothing to compute it from, for example no takedown attempts, no wins or no third rounds; not a zero): ${noValue.map((m) => m.label).join(', ')}.`)

  // The fight log and the belts belong to the whole profile. Asking for one group is asking
  // for less.
  if (group === 'all') {
    // The reigns are rebuilt from title fights; the official rankings are a separate source.
    // Where the two disagree about who holds a belt today, say so rather than pick one.
    const champion = (div, interim) => (row.rks || {})[div] === (interim ? 0.5 : 0)
    if (row.belts && row.belts.length) {
      structured.title_reigns = row.belts.map((b) => ({
        division: divisionLabel(meta, b.div),
        interim: !!b.interim,
        start: b.start,
        end: b.end ?? null,
        days: b.days ?? null,
        length: span(b.days),
        defenses: b.defenses || 0,
        ended: meta.beltEnd[b.how] || b.how,
        in_official_ranking: b.how === 'current' ? champion(b.div, b.interim) : null,
      }))
      L.push('', 'Title reigns:')
      for (const b of structured.title_reigns) {
        const running = b.in_official_ranking ? `${b.ended} as of ${meta.latest}` : `marked as running in the data, but the official ranking does not list ${him} as that champion`
        L.push(`- ${b.division}${b.interim ? ' interim' : ''} champion: ${b.start} to ${b.end || `present (${running})`}, ${b.length} (${thousands(b.days)} days), ${b.defenses} defense${b.defenses === 1 ? '' : 's'}${b.end ? `, ${b.ended}` : ''}.`)
      }
      L.push('')
      const gaveUp = row.belts.some((b) => b.how === 'vacated')
      say(`Title reigns are rebuilt from the title-fight record, so a title given without a fight (an interim champion promoted, for example) is not listed. A running reign is counted to ${meta.latest}.${gaveUp ? ` "${meta.beltEnd.vacated || 'vacated'}" covers a belt given up or stripped: the real day is not recorded, so the reign is closed at the next title fight in the division (or at ${meta.latest}) and its length is an estimate.` : ''}`)
      if (structured.title_reigns.some((b) => b.in_official_ranking === false)) {
        say('A reign marked as running that the official ranking does not back was never closed in the data: no later title fight in that division ended it. It is not evidence of a current UFC title, and its length is not reliable.')
      }
    }
    const unbacked = Object.entries(row.rks || {}).filter(([div, n]) => (n === 0 || n === 0.5) && !(row.belts || []).some((b) => b.div === div && b.how === 'current' && !!b.interim === (n === 0.5)))
    for (const [div, n] of unbacked) {
      say(`The official ranking lists ${him} as ${divisionLabel(meta, div)} ${rankText(n)}, but no running reign is listed for it: title reigns are rebuilt from title fights, and this title did not come from one in the data.`)
    }
    if (row.fights && row.fights.length) {
      structured.recent_fights = row.fights.map((x) => ({
        date: x.date,
        result: x.res,
        opponent: x.oppname,
        opponent_id: x.opp,
        method: x.method,
        round: x.rnd,
        time: miss(x.time) ? null : clock(x.time),
        bout: x.wc,
        title_bout: x.title,
        event: x.event,
        bonuses: (x.bonus || []).map((b) => meta.bonus[b] || b),
        sig_strikes_landed: x.ss,
        sig_strikes_absorbed: x.oss,
        knockdowns: x.kd,
        takedowns: x.td,
        control: miss(x.ctrl) ? null : clock(x.ctrl),
        opponent_rating: x.oelo,
      }))
      const all = row.fights.length >= career.n
      L.push('', career.n === 1 ? `${cap(his)} only UFC fight:` : all ? `All ${career.n} of ${his} UFC fights, newest first:` : `${cap(his)} ${row.fights.length} most recent UFC fights of ${career.n}, newest first:`)
      structured.recent_fights.forEach((x, i) => {
        const bits = []
        if (!miss(x.sig_strikes_landed)) bits.push(`Sig. strikes ${x.sig_strikes_landed} landed, ${x.sig_strikes_absorbed} absorbed`)
        if (!miss(x.knockdowns)) bits.push(`knockdowns ${x.knockdowns}`)
        if (!miss(x.takedowns)) bits.push(`takedowns ${x.takedowns}`)
        if (x.control) bits.push(`control ${x.control}`)
        if (!miss(x.opponent_rating)) bits.push(`opponent's Savant rating going in ${x.opponent_rating}`)
        const how = [x.method, x.round != null ? `R${x.round}${x.time ? ` ${x.time}` : ''}` : null].filter(Boolean).join(', ')
        const where = [x.bout ? `${x.bout} bout` : null, x.event ? `at ${x.event}` : null].filter(Boolean).join(' ')
        const sentences = [where, bits.join('; ').replace(/^./, (c) => c.toUpperCase()), x.bonuses.length ? `Bonus: ${x.bonuses.join(', ')}` : ''].filter(Boolean)
        L.push(`${i + 1}. ${x.date}: ${RESULT[x.result] || x.result} ${x.opponent} (${how}). ${sentences.join('. ')}.`)
      })
    }
  }

  L.push('', `Page: ${structured.url}`, `Source: ${SOURCE}. Data through ${meta.latest}, built ${structured.data_built}.`)
  return { structured, text: L.join('\n').replace(/\n{3,}/g, '\n\n') }
}

// ---- everyone at once ------------------------------------------------------------------

// Every fighter's row, for a question about the whole roster. The sixteen files are held in
// memory once read (see `files` above), so after the first leaderboard this is free.
const SHARDS = '0123456789abcdef'.split('')
const everyone = new WeakMap()
async function loadEveryone() {
  const shards = await Promise.all(SHARDS.map((c) => files.load(`fighters/${c}.json`)))
  // Rebuilt only when a file has been re-read.
  let all = everyone.get(shards[0])
  if (!all || all.from.some((f, i) => f !== shards[i])) {
    all = { from: shards, rows: shards.flatMap((f) => Object.values(f.fighters)) }
    everyone.set(shards[0], all)
  }
  return all.rows
}

// Stats that describe a fighter rather than grade him: how much he fights, where his strikes
// go, how his fights end up. Named one by one, since the page's own tags do not sort them
// (takedown defense is an "ingredient" too, and more of it is plainly better).
const DESCRIBES = new Set(['n', 'min', 'avgtime', 'act', 'pace', 'headshr', 'bodyshr', 'legshr', 'distshr', 'clinchshr', 'groundshr', 'decrate'])

// Stats a caller can name: the profile's, and the leaderboard-only title stats.
const statIndex = new WeakMap()
function statsOf(meta) {
  let rows = statIndex.get(meta)
  if (!rows) {
    rows = prepareStats([...meta.metrics, ...(meta.boardMetrics || []).map((m) => ({ ...m, board: true }))])
    statIndex.set(meta, rows)
  }
  return rows
}
const sexOf = (meta, div) => (meta.divisions.find((d) => d.key === div) || {}).sex || 'M'
// The page's stat explanations are written about a man ("strikes he lands"). They are quoted,
// not reworded, so where a woman is among those described only the ones that fit are quoted.
const fitsWomen = (text) => (text && !/\b(he|his|him|himself|man|men)\b/i.test(text) ? text : null)

// A division the way people say it: a key (LW), a label (Lightweight), a plural, the short
// forms fans use, or "men" / "women" for all of one sex. Returns { key, label, all }.
const DIVISION_WORDS = { FLW: ['125'], BW: ['135'], FW: ['145'], LW: ['155'], WW: ['170'], MW: ['185'], LHW: ['205', 'light heavy'], HW: ['heavy', '265'], WSW: ['115', 'strawweight', 'womens strawweight'], WFLW: ['womens flyweight'], WBW: ['womens bantamweight'], WFW: ['womens featherweight'] }
function resolveDivision(input, meta) {
  const raw = String(input || '').trim()
  const q = norm(raw).replace(/\bdivision\b/, '').trim().replace(/s$/, '')
  if (!q || ['men', 'all men', 'man', 'male', 'm', 'pound for pound', 'p4p'].includes(q)) return { key: 'M', label: 'all men\'s divisions', all: true }
  if (['women', 'all women', 'woman', 'female', 'f', 'womens', 'womens pound for pound'].includes(q)) return { key: 'F', label: 'all women\'s divisions', all: true }
  const hit = meta.divisions.filter((d) => d.key.toLowerCase() === raw.toLowerCase() || norm(d.label).replace(/s$/, '') === q || (DIVISION_WORDS[d.key] || []).includes(q))
  if (hit.length === 1) return { key: hit[0].key, label: hit[0].label, all: false }
  throw new SavantError(`"${raw}" is not a UFC division. Use one of: ${meta.divisions.map((d) => `${d.key} (${d.label})`).join(', ')}, or "men" or "women" for every division of one sex.`)
}

// ---- leaderboard -----------------------------------------------------------------------

// The page's Leaderboard Builder, as an answer (its lbPool() and lbRender()). A fighter is on
// the board if he has the window, is active (unless all-time is asked for), fights in the
// division in that window, and has a value; "settled" (the page's default) also wants him
// qualified and the stat past its sample threshold. Ranked by "rank", the board is the
// official UFC ranking instead: champion, then the numbered contenders.
export async function leaderboard({ stat = 'rank', division, window, pool = 'active', sample = 'settled', limit = 10, order = 'top' }) {
  const meta = await loadMeta()
  const win = window || meta.defaults.window
  if (!meta.windows[win]) throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  const div = resolveDivision(division, meta)
  const rows = await loadEveryone()
  const label = meta.windows[win]
  const inDiv = (d) => (div.all ? sexOf(meta, d) === div.key : d === div.key)
  const url = (key) => (meta.leaderboardUrl
    ? meta.leaderboardUrl.replace('{window}', win).replace('{division}', div.key).replace('{stat}', key).replace('{n}', String(limit)).replace('{baseline}', pool === 'all_time' ? 'all' : 'active').replace('{sample}', sample === 'settled' ? 'settled' : 'all').replace('{dir}', order === 'bottom' ? 'asc' : 'desc')
    : meta.page)
  const base = (r, w) => ({
    id: r.id,
    name: r.name,
    nickname: r.nick || null,
    division: divisionLabel(meta, w ? w.div : (r.w.career || {}).div),
    active: r.active,
    ufc_fights: w ? w.n : (r.w.career || {}).n ?? null,
    official_rank: Object.entries(r.rks || {}).sort((a, b) => a[1] - b[1]).map(([d, n]) => (n === 0 || n === 0.5 ? `${divisionLabel(meta, d)} ${rankText(n)}` : `${rankText(n)} at ${divisionLabel(meta, d)}`))[0] || null,
    url: fighterUrl(meta, r.id, win),
  })

  // ---- the official ranking ----
  if (norm(stat) === 'rank' || /^official( ufc)? rank(ing)?s?$/.test(norm(stat))) {
    const place = (r) => (div.all ? (sexOf(meta, (r.w.career || {}).div) === div.key ? r.p4p ?? null : null) : (r.rks || {})[div.key] ?? null)
    const listed = rows.filter((r) => place(r) != null).sort((a, b) => place(a) - place(b))
    const shown = boardSlice(listed, limit, order)
    const what = div.all ? `the official UFC ${div.key === 'F' ? 'women\'s ' : 'men\'s '}pound-for-pound ranking` : `the official UFC ${div.label} ranking`
    const notes = [
      `This is ${what} as of ${meta.rankingsAt}, as UFC Savant holds it (read from the published UFC rankings). It is the UFC's own list, not a Savant stat.`,
      'Each line adds the fighter\'s Savant rating, UFC Savant\'s own Elo-style number from fight results.',
    ]
    const structured = {
      mode: 'official_ranking',
      stat: { key: 'rank', label: div.all ? 'Official UFC pound-for-pound ranking' : 'Official UFC ranking', what: null, lower_is_better: true },
      window: { key: win, label },
      division: div.label,
      pool: null,
      sample: null,
      order,
      ranked: listed.length,
      hidden_low_sample: 0,
      count: shown.length,
      leaders: shown.map((r) => {
        const w = r.w[win] || r.w.career
        const elo = w && w.m.elo ? w.m.elo[0] : null
        const n = place(r)
        return { rank: n, rank_text: div.all ? `#${n}` : rankText(n), tied: false, ...base(r, w), value: elo, display: elo == null ? null : display('num0', elo), active_percentile: null, all_time_percentile: null, low_sample: false, open_reign: false }
      }),
      notes,
      url: url('rank'),
      rankings_as_of: meta.rankingsAt,
      data_through: meta.latest,
      source: SOURCE,
    }
    if (!shown.length) return { structured, text: `UFC Savant holds no ${what.replace('the ', '')}.\n\nPage: ${meta.page}\nSource: ${SOURCE}.` }
    const L = [`${what[0].toUpperCase()}${what.slice(1)}, as of ${meta.rankingsAt}:`, '']
    for (const l of structured.leaders) L.push(`${l.rank_text === 'champion' ? 'Champion' : l.rank_text === 'interim champion' ? 'Interim champion' : l.rank_text}. ${l.name}${l.nickname ? ` "${l.nickname}"` : ''} (id ${l.id})${div.all ? `, ${l.division}` : ''}: Savant rating ${l.display ?? 'n/a'}, ${l.ufc_fights} UFC fights${l.active ? '' : ', inactive'}`)
    L.push('', ...notes, '', `On the site: ${structured.url}`, `Source: ${SOURCE}.`)
    return { structured, text: L.join('\n') }
  }

  // ---- a stat ----
  const m = findStat(statsOf(meta), stat, { tool: 'ufc_list_stats' })
  const valueOf = (w) => { const c = m.board ? (w.x || {})[m.key] : w.m[m.key]; return c == null ? null : m.board ? c : c[0] }
  const pooled = []
  for (const r of rows) {
    const w = r.w[win]
    if (!w || !inDiv(w.div)) continue
    if (pool === 'active' && !r.active) continue
    if (miss(valueOf(w))) continue
    pooled.push({ r, w })
  }
  const isLow = (x) => !!(x.w.low && m.key in x.w.low)
  const settled = pooled.filter((x) => x.w.qualified && !isLow(x))
  const eligible = sample === 'settled' ? settled : pooled
  const all = ranked(eligible, (x) => valueOf(x.w), { lower: m.lowerIsBetter })
  const shown = boardSlice(all, limit, order)
  const slot = m.board ? null : { active: viewSlot(meta, 'active', 'div'), all: viewSlot(meta, 'all', 'div') }
  const [minFights, minMinutes] = meta.qualify[win]
  const who = `${pool === 'active' ? 'active' : 'all-time'} fighters in ${div.label}`
  const notes = [
    `Ranked among the ${all.length} ${who} over each fighter's own ${lowerFirst(label)}${sample === 'settled' ? ', settled samples only' : ''}. A fighter's division is the weight class fought at most in that window. ${pool === 'active' ? `Active means a UFC fight in the ${meta.activeMonths} months before ${meta.latest}.` : 'All-time is every fighter in UFC history.'}`,
  ]
  if (sample === 'settled') {
    const left = pooled.length - settled.length
    notes.push(`Settled means qualified (${minFights}+ fights and ${minMinutes}+ minutes of cage time in the window)${m.lowSampleBelow ? ` and at least ${m.lowSampleBelow} ${meta.denoms[m.sample] || m.sample} behind this stat` : ''}.${left ? ` ${left} more ${left === 1 ? 'fighter has' : 'fighters have'} a value on too little to trust and ${left === 1 ? 'is' : 'are'} left off; ask for sample "everyone" to list them, marked.` : ''}`)
  } else if (shown.some((x) => isLow(x.row) || !x.row.w.qualified)) notes.push('"low sample" marks a fighter below the qualifying line or below the sample this stat needs: the number is real, the place is not yet earned.')
  if (m.lowerIsBetter) notes.push(`${m.label} is a lower-is-better stat, so the lowest value is 1st.`)
  if (order === 'bottom') notes.push(`This is the bottom of the board, worst first. Places are counted from the top: ${all.length ? ordinal(all[all.length - 1].rank) : 'last'} is last.`)
  if (DESCRIBES.has(m.key)) notes.push(`${m.label} is a style or context number: it describes a fighter, so leading it means the most of it, not the best.`)
  // A reign is closed by the next title fight in its division. One that never had one is
  // still open in the data, and counts days to today.
  const openReign = (r) => (r.belts || []).some((b) => b.how === 'current' && (r.rks || {})[b.div] !== (b.interim ? 0.5 : 0))
  if (m.board && shown.some((x) => openReign(x.row.r))) notes.push(`Marked "open reign": the data still counts a title reign as running although the official ranking does not list that fighter as champion. Reigns are rebuilt from title fights, and no later title fight in that division closed this one, so its length runs to ${meta.latest} and is not reliable.`)
  if (shown.some((x) => x.tied)) notes.push('Equal values share a place.')
  if (!m.board) notes.push('The two percentiles on each line are inside the fighter\'s own division: against its active fighters, then all-time. They are ranked among qualified fighters, so they do not move with the filters here.')
  if (meta.metrics.some((x) => x.key === m.key && (x.unit === 'mins' || x.unit === 'sgnm'))) notes.push('Times print as minutes:seconds.')

  const women = div.all ? div.key === 'F' : sexOf(meta, div.key) === 'F'
  const what = (m.explain && m.explain.w) || null
  const structured = {
    mode: 'stat',
    stat: { key: m.key, label: m.label, what: women ? fitsWomen(what) : what, lower_is_better: m.lowerIsBetter },
    window: { key: win, label },
    division: div.label,
    pool,
    sample,
    order,
    ranked: all.length,
    hidden_low_sample: sample === 'settled' ? pooled.length - settled.length : 0,
    count: shown.length,
    leaders: shown.map((x) => {
      const { r, w } = x.row
      const c = m.board ? null : w.m[m.key]
      return {
        rank: x.rank,
        rank_text: `${x.tied ? 'T-' : ''}${x.rank}`,
        tied: x.tied,
        ...base(r, w),
        value: x.value,
        display: display(m.unit, x.value),
        active_percentile: c ? c[slot.active] : null,
        all_time_percentile: c ? c[slot.all] : null,
        low_sample: isLow(x.row) || !w.qualified,
        open_reign: m.board ? openReign(r) : false,
      }
    }),
    notes,
    url: url(m.key),
    rankings_as_of: meta.rankingsAt,
    data_through: meta.latest,
    source: SOURCE,
  }
  const title = `${m.label}, ${label}: the ${order === 'bottom' ? 'bottom' : 'top'} ${shown.length} of ${all.length} ${who}`
  if (!shown.length) {
    const why = pooled.length ? `No ${who} has a settled sample for ${m.label} over ${lowerFirst(label)}; ${pooled.length} have a value. Ask for sample "everyone".` : `No ${who} has a value for ${m.label} over ${lowerFirst(label)}.`
    return { structured, text: `${why}\n\n${notes.join('\n')}\n\nSource: ${SOURCE}. Data through ${meta.latest}.` }
  }
  const L = [title]
  if (structured.stat.what) L.push(structured.stat.what)
  L.push('')
  const pct = (p) => (p == null ? 'n/a' : ordinal(p))
  for (const l of structured.leaders) {
    const pcts = m.board ? '' : ` (in ${div.all ? `${l.division}` : 'the division'}: active ${pct(l.active_percentile)}, all-time ${pct(l.all_time_percentile)})`
    L.push(`${l.rank_text}. ${l.name}${l.nickname ? ` "${l.nickname}"` : ''} (id ${l.id}${div.all ? `, ${l.division}` : ''}): ${l.display}${pcts}, ${l.ufc_fights} fight${l.ufc_fights === 1 ? '' : 's'}${l.active ? '' : ', inactive'}${l.official_rank ? `, UFC ${l.official_rank}` : ''}${l.low_sample ? ' [low sample]' : ''}${l.open_reign ? ' [open reign]' : ''}`)
  }
  L.push('', ...notes, '', `On the site: ${structured.url}`, `Source: ${SOURCE}. Data through ${meta.latest}.`)
  return { structured, text: L.join('\n') }
}

// ---- compare ---------------------------------------------------------------------------

export async function compareFighters({ fighters, window, group = 'headline', stats }) {
  const meta = await loadMeta()
  const win = window || meta.defaults.window
  if (!meta.windows[win]) throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  const label = meta.windows[win]
  const sides = []
  for (const name of fighters) {
    const who = await resolveFighter(name, meta)
    const row = (await loadShard(who.id)).fighters[who.id]
    const w = row && row.w[win]
    if (!w) throw new SavantError(`UFC Savant has no ${label} numbers for ${who.name} right now.`)
    if (sides.some((x) => x.row.id === row.id)) throw new SavantError(`${row.name} is listed twice. Name two to four different fighters.`)
    sides.push({ row, w })
  }

  const every = prepareStats(meta.metrics)
  let picked
  if (stats && stats.length) {
    picked = []
    for (const name of stats) { const m = findStat(every, name, { tool: 'ufc_list_stats' }); if (!picked.some((x) => x.key === m.key)) picked.push(m) }
  } else if (group === 'headline') {
    picked = (meta.headline && meta.headline.length ? meta.headline : ['slpm', 'sapm', 'sacc', 'sdef', 'td15', 'tddef']).map((k) => every.find((m) => m.key === k)).filter(Boolean)
  } else picked = every.filter((m) => m.group === GROUPS[group])

  const slot = { active: viewSlot(meta, 'active', 'div'), all: viewSlot(meta, 'all', 'div') }
  const surname = (x) => x.row.name.split(' ').slice(1).join(' ') || x.row.name
  const short = (x) => (sides.some((y) => y !== x && surname(y) === surname(x)) ? x.row.name : surname(x))
  const women = sides.some((x) => sexOf(meta, (x.row.w.career || x.w).div) === 'F')
  const rows = picked.map((m) => ({
    key: m.key,
    label: m.label,
    group: meta.groups[m.group] || m.group,
    tag: m.layer || null,
    lower_is_better: m.lowerIsBetter,
    what: women ? fitsWomen(m.explain && m.explain.w) : (m.explain && m.explain.w) || null,
    values: sides.map((x) => {
      const c = x.w.m[m.key]
      if (!c) return { status: (x.w.untracked || []).includes(m.key) ? 'not tracked in those fights' : 'no value', value: null, display: null, active_percentile: null, all_time_percentile: null, low_sample: false }
      return { status: 'ok', value: c[0], display: display(m.unit, c[0]), active_percentile: c[slot.active], all_time_percentile: c[slot.all], low_sample: !!(x.w.low && m.key in x.w.low) }
    }),
  }))

  // Fights between them, as far as each fighter's kept fights go (his most recent few).
  const meetings = []
  for (const x of sides) for (const f of x.row.fights || []) {
    const other = sides.find((y) => y.row.id === f.opp)
    if (!other || meetings.some((mt) => mt.date === f.date && [mt.winner_id, mt.loser_id, ...mt.ids].includes(x.row.id))) continue
    meetings.push({
      date: f.date,
      ids: [x.row.id, other.row.id],
      fighters: [x.row.name, other.row.name],
      result: f.res === 'W' ? `${x.row.name} won` : f.res === 'L' ? `${other.row.name} won` : f.res === 'D' ? 'draw' : 'no contest',
      winner_id: f.res === 'W' ? x.row.id : f.res === 'L' ? other.row.id : null,
      loser_id: f.res === 'W' ? other.row.id : f.res === 'L' ? x.row.id : null,
      method: f.method,
      round: f.rnd,
      time: miss(f.time) ? null : clock(f.time),
      bout: f.wc,
      event: f.event,
    })
  }
  meetings.sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const divisions = [...new Set(sides.map((x) => x.w.div))]
  const [minFights, minMinutes] = meta.qualify[win]
  const notes = [
    `Each stat shows the value, then two percentiles inside that fighter's own division over the fighter's own ${lowerFirst(label)}: against active fighters (a UFC fight in the ${meta.activeMonths} months before ${meta.latest}), then against everyone in UFC history. A fighter's division is the weight class fought at most in the window.`,
  ]
  if (divisions.length > 1) notes.push(`These fighters are in different divisions for this window (${sides.map((x) => `${short(x)}: ${divisionLabel(meta, x.w.div)}`).join('; ')}), so their percentiles are against different groups. Compare the values.`)
  notes.push('Stats marked "lower is better" are already flipped, so a higher percentile is the better mark there too. For style and context numbers (where the strikes go, pace, fight length) a percentile describes a fighter, it does not grade one.')
  const unq = sides.filter((x) => !x.w.qualified)
  if (unq.length) notes.push(`Below the qualifying line for this window (${minFights} fights, ${minMinutes} minutes), so ranked against a pool the fighter is not part of: ${unq.map((x) => x.row.name).join(', ')}.`)
  if (rows.some((r) => r.values.some((v) => v.low_sample))) notes.push('"low sample" means the stat has not reached the sample it needs before it settles down.')
  if (picked.some((m) => m.unit === 'mins' || m.unit === 'sgnm')) notes.push('Times print as minutes:seconds.')
  notes.push(`Fights between them are looked for in each fighter's ${meta.recentFights} most recent UFC fights only, so an older meeting is not listed.${meetings.length ? '' : ' None is among those.'}`)

  const structured = {
    window: { key: win, label },
    fighters: sides.map((x) => {
      const r = x.row
      const rankings = Object.entries(r.rks || {}).sort((a, b) => a[1] - b[1]).map(([d, n]) => (n === 0 || n === 0.5 ? `${divisionLabel(meta, d)} ${rankText(n)}` : `UFC ${rankText(n)} at ${divisionLabel(meta, d)}`))
      return {
        id: r.id,
        name: r.name,
        nickname: r.nick || null,
        division: divisionLabel(meta, x.w.div),
        fights_in_window: x.w.n,
        qualified: x.w.qualified,
        active: r.active,
        pro_record: recordText(r.rec),
        ufc_record: recordText(r.ufc),
        age: r.active ? r.age ?? null : null,
        height: miss(r.ht) ? null : feetInches(r.ht),
        reach_inches: r.reach ?? null,
        stance: r.stance || null,
        official_rank: rankings,
        pools: { active: poolSize(meta, win, 'active', x.w.div), all_time: poolSize(meta, win, 'all', x.w.div) },
        url: fighterUrl(meta, r.id, win),
      }
    }),
    stats: rows,
    meetings: meetings.map(({ ids: _ids, ...rest }) => rest),
    matchup_url: sides.length === 2 ? matchupUrl(meta, sides[0].row.id, sides[1].row.id) : null,
    notes,
    data_through: meta.latest,
    source: SOURCE,
  }

  const L = [`${sides.map((x) => x.row.name).join(' vs. ')}: UFC Savant, side by side over each fighter's ${lowerFirst(label)}`]
  for (const f of structured.fighters) {
    const body = [f.height ? `height ${f.height}` : null, f.reach_inches != null ? `reach ${f.reach_inches}"` : null, f.stance ? f.stance : null, f.age != null ? `age ${f.age}` : null].filter(Boolean).join(', ')
    L.push(`${f.name}${f.nickname ? ` "${f.nickname}"` : ''}: ${f.division}, ${f.fights_in_window} fight${f.fights_in_window === 1 ? '' : 's'} in the window${f.active ? '' : ', inactive'}. Pro record ${f.pro_record || 'n/a'}, UFC ${f.ufc_record}.${f.official_rank.length ? ` ${f.official_rank.join('; ')} (as of ${meta.rankingsAt}).` : ''}${body ? ` ${body[0].toUpperCase()}${body.slice(1)}.` : ''} Ranked against ${thousands(f.pools.active)} active and ${thousands(f.pools.all_time)} all-time ${peers(meta, sides.find((x) => x.row.id === f.id).w.div)}.`)
  }
  L.push('')
  const pct = (p) => (p == null ? 'n/a' : ordinal(p))
  for (const r of rows) {
    const cells = r.values.map((v, i) => (v.status !== 'ok' ? `${short(sides[i])} ${v.status}` : `${short(sides[i])} ${v.display} (active ${pct(v.active_percentile)}, all-time ${pct(v.all_time_percentile)})${v.low_sample ? ' [low sample]' : ''}`))
    L.push(`- ${r.label}${r.lower_is_better ? ' [lower is better]' : ''}: ${cells.join(' | ')}`)
    if (r.what) L.push(`  ${r.what}`)
  }
  if (meetings.length) {
    L.push('', 'Fights between them, newest first:')
    for (const mt of meetings) L.push(`- ${mt.date}: ${mt.result} (${[mt.method, mt.round != null ? `R${mt.round}${mt.time ? ` ${mt.time}` : ''}` : null].filter(Boolean).join(', ')})${mt.bout ? `. ${mt.bout} bout` : ''}${mt.event ? ` at ${mt.event}` : ''}.`)
  }
  L.push('', ...notes, '')
  if (structured.matchup_url) L.push(`Head-to-head on the site: ${structured.matchup_url}`)
  L.push(...structured.fighters.map((f) => `${f.name}: ${f.url}`), `Source: ${SOURCE}. Data through ${meta.latest}.`)
  return { structured, text: L.join('\n') }
}

// ---- the glossary ----------------------------------------------------------------------

export async function listStats({ group, query } = {}) {
  const meta = await loadMeta()
  let rows = statsOf(meta)
  if (group) rows = rows.filter((m) => (group === 'titles' ? m.board : m.group === GROUPS[group]))
  if (query) {
    const q = norm(query)
    const hit = new Set(rank(rows, query, () => 0, statNorm).map((r) => r.row.key))
    rows = rows.filter((m) => hit.has(m.key) || m.key === q || norm(`${(m.explain || {}).w || ''} ${(m.explain || {}).y || ''}`).includes(q))
  }
  const stats = rows.map((m) => ({
    key: m.key,
    label: m.label,
    group: m.board ? 'Titles (leaderboard only)' : meta.groups[m.group] || m.group,
    subgroup: m.sub || null,
    tag: m.layer || null,
    lower_is_better: m.lowerIsBetter,
    low_sample_below: m.lowSampleBelow ? `${m.lowSampleBelow} ${meta.denoms[m.sample] || m.sample}` : null,
    since: m.since > meta.eraBase ? m.since : null,
    leaderboard_only: !!m.board,
    what: (m.explain && m.explain.w) || null,
    formula: (m.explain && m.explain.f) || null,
    why: (m.explain && m.explain.y) || null,
  }))
  const notes = [
    'Every stat is worked out over a window of a fighter\'s UFC fights (career, last 5 or last 3) and ranked inside the fighter\'s division for that window. The explanations are the page\'s, which are written about a man.',
    'For style and context numbers (where the strikes go, pace, fight length, how often a fight goes to a decision) a percentile describes a fighter, it does not grade one.',
    'Any key or name here can be given to ufc_get_leaderboard or ufc_compare_fighters. ufc_get_leaderboard also takes "rank" for the official UFC ranking.',
  ]
  const structured = { count: stats.length, stats, notes, url: meta.page, source: SOURCE }
  if (!stats.length) return { structured, text: `No UFC Savant stat matches "${query}". Call ufc_list_stats with no query to see them all.` }
  const L = [`${stats.length} UFC Savant stat${stats.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}:`]
  let heading = null
  for (const m of stats) {
    const h = m.subgroup && m.subgroup !== m.group ? `${m.group}: ${m.subgroup}` : m.group
    if (h !== heading) { L.push('', h); heading = h }
    const tags = [m.tag, m.lower_is_better ? 'lower is better' : null, m.since ? `since ${m.since}` : null].filter(Boolean)
    L.push(`- ${m.label} (key "${m.key}")${tags.length ? ` [${tags.join('; ')}]` : ''}${m.what ? `: ${m.what}${m.why ? ` ${m.why}` : ''}` : ''}`)
  }
  L.push('', ...notes, '', `Page: ${meta.page}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- upcoming cards --------------------------------------------------------------------

// Today's date where the page's "Next card" is judged: the US west coast, so a card stays
// current through its own evening everywhere in the country.
export function cardDay(now = Date.now(), zone = 'America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
}

// The bout a card is named for: "UFC 332: Silva vs. Wang" is headlined by the bout between
// a Silva and a Wang. Null when the name does not settle it on exactly one bout.
function headliner(card) {
  const m = String(card.name || '').match(/([^:]+?)\s+vs\.?\s+(.+)$/i)
  const title = m && [m[1].replace(/^.*:\s*/, ''), m[2]].map((x) => norm(x))
  if (!title || title.some((x) => !x)) return null
  const has = (name, word) => norm(name).split(' ').some((w) => word.split(' ').includes(w))
  const hits = card.bouts.map((b, i) => [b, i]).filter(([b]) => {
    const [x, y] = b.f.map((f) => (f && f.name) || '')
    return (has(x, title[0]) && has(y, title[1])) || (has(x, title[1]) && has(y, title[0]))
  })
  return hits.length === 1 ? hits[0][1] : null
}

// `which`: "upcoming" (default) the cards that have not happened, "next" only the first of
// them, "all" everything in the list, past cards included and marked. `today` is for tests.
export async function upcomingCards({ which = 'upcoming', today } = {}) {
  const [meta, file, idx] = await Promise.all([loadMeta(), loadUpcoming(), loadIndex()])
  const now = today || cardDay(Date.now(), meta.nextCardZone || undefined)
  const every = file.cards.map((c) => {
    const main = headliner(c)
    return {
      event: c.name,
      date: c.date,
      location: c.location,
      status: !c.date ? 'upcoming' : c.date < now ? 'past' : c.date === now ? 'today' : 'upcoming',
      next: false,
      bouts: c.bouts.map((b, i) => {
        const corner = (x) => {
          const known = !!(x && x.known && idx.byId.has(x.id))
          return { name: (x && x.name) || 'TBA', id: known ? x.id : null, in_ufc_savant: known, url: known ? fighterUrl(meta, x.id) : null }
        }
        const [a, b2] = [corner(b.f[0]), corner(b.f[1])]
        return { bout: b.wc, main_event: i === main, fighters: [a, b2], matchup_url: a.id && b2.id ? matchupUrl(meta, a.id, b2.id) : null }
      }),
    }
  })
  const next = every.find((c) => c.status !== 'past') || null
  if (next) next.next = true
  const past = every.filter((c) => c.status === 'past')
  const cards = which === 'all' ? every : which === 'next' ? (next ? [next] : []) : every.filter((c) => c.status !== 'past')

  const built = day(file.generated)
  const notes = [
    `These are the cards ufcstats.com listed as upcoming when the data was built on ${built}; a card can change after that date. Each is judged against today, ${now} on the US west coast: "past" has already been fought, and the next card is the first that has not.`,
  ]
  if (past.length) {
    const stale = past.filter((c) => c.date > meta.latest)
    const one = past.length === 1
    notes.push(`${one ? 'One listed card has' : `${past.length} listed cards have`} already happened${which === 'all' ? '' : one ? ' and is left out here' : ' and are left out here'}: ${past.map((c) => `${c.event} (${c.date})`).join(', ')}.${stale.length ? ` ${stale.length === past.length ? (one ? 'Its results are' : 'Their results are') : `Results from ${stale.map((c) => c.date).join(', ')} are`} not in UFC Savant yet: the fight data runs through ${meta.latest}.` : ''}`)
  }
  if (cards.some((c) => c.bouts.some((b) => b.main_event))) notes.push('The main event is the bout the card is named for. The other bouts are in the order ufcstats.com lists them.')
  notes.push('A fighter with no UFC fights in the data has no UFC Savant page yet and is listed by name only.')
  const structured = {
    today: now,
    which,
    count: cards.length,
    next_card: next ? { event: next.event, date: next.date, location: next.location } : null,
    cards,
    past_cards_listed: past.length,
    notes,
    url: meta.page,
    data_built: built,
    data_through: meta.latest,
    source: SOURCE,
  }

  if (!cards.length) {
    const why = every.length
      ? `Every card UFC Savant lists has already happened (the list was built on ${built}): ${past.map((c) => `${c.event}, ${c.date}`).join('; ')}. The next card will appear when the data is next refreshed.`
      : `UFC Savant lists no upcoming cards as of ${built}.`
    return { structured, text: `${why}\n\nPage: ${meta.page}\nSource: ${SOURCE}.` }
  }
  const L = [which === 'next' ? `The next UFC card, as of ${now}:` : `${cards.length} UFC card${cards.length === 1 ? '' : 's'}${which === 'all' ? ' in the list' : ' still to come'}, as of ${now} (list built ${built}):`]
  for (const c of cards) {
    const mark = c.status === 'past' ? ' [ALREADY HAPPENED]' : c.next ? (c.status === 'today' ? ' [NEXT CARD: TODAY]' : ' [NEXT CARD]') : ''
    L.push('', `${c.event}, ${c.date || 'date not listed'}${c.location ? `, ${c.location}` : ''} (${c.bouts.length} bout${c.bouts.length === 1 ? '' : 's'})${mark}`)
    for (const b of c.bouts) {
      const name = (x) => `${x.name}${x.id ? ` (id ${x.id})` : x.name === 'TBA' ? '' : ' (no UFC Savant page yet)'}`
      L.push(`- ${b.main_event ? 'Main event, ' : ''}${b.bout ? `${b.bout}: ` : ''}${name(b.fighters[0])} vs. ${name(b.fighters[1])}`)
    }
  }
  // One line for the links rather than one per bout: thirty-odd long URLs would bury the cards.
  const links = `A fighter's page is ${meta.fighterUrl.replace('{id}', '<id>').replace('{window}', meta.defaults.window)}. The head-to-head view for a bout between two fighters with ids is ${meta.matchupUrl.replace('{a}', '<id>').replace('{b}', '<id>').replace('{window}', meta.matchupWindow)}; ufc_compare_fighters gives the same two fighters side by side.`
  L.push('', ...notes, links, '', `Page: ${meta.page}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const record = z.object({ wins: z.number().int(), losses: z.number().int(), draws: z.number().int(), no_contests: z.number().int(), text: z.string() })

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'ufc_search_fighters',
    config: {
      title: 'Search UFC fighters',
      description:
        'Find UFC fighters in UFC Savant (Western Conference Elitists, wcehoops.com) by name or nickname. Covers every fighter with a UFC fight in the site data, which runs from UFC 2 in March 1994 to the latest event. Returns each match with its id, nickname, division (the weight class fought at most over the UFC career), whether the fighter is active, number of UFC fights with first and last dates, professional record, and the link to the fighter\'s page. Matching ignores accents and punctuation and tolerates small typos in names. Each fighter is listed under one name, so a former name is not found.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Fighter name, part of one, or a nickname, e.g. "Makhachev", "Jon Jones", "Rampage".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many fighters matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        fighters: z.array(z.object({
          id: z.string().describe('Fighter id, for ufc_get_fighter_profile.'),
          name: z.string(),
          nickname: z.string().nullable(),
          division: z.string().describe('The weight class fought at most over the UFC career.'),
          active: z.boolean().describe('Whether the fighter has a UFC fight in the 24 months before data_through.'),
          ufc_fights: z.number().int(),
          pro_record: z.string().nullable().describe('Professional record as wins-losses-draws, with no contests in brackets.'),
          first_ufc_fight: z.string().nullable(),
          last_ufc_fight: z.string().nullable(),
          url: z.string().describe('The fighter\'s UFC Savant page.'),
        })),
        notes: z.array(z.string()).describe('How to read the list.'),
        data_through: z.string().describe('Date of the latest UFC event in the data.'),
        source: z.string(),
      },
      annotations: { title: 'Search UFC fighters', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchFighters({ query, limit }),
  },
  {
    name: 'ufc_get_fighter_profile',
    config: {
      title: 'Get a UFC fighter\'s Savant profile',
      description:
        'Get one UFC fighter\'s UFC Savant profile (Western Conference Elitists, wcehoops.com) over a window of UFC fights: the whole UFC career, the last 5 fights or the last 3. Returns professional and UFC records, height, reach, listed weight, stance, age, official UFC ranking, and every stat the page draws with its value and two percentiles, both inside the fighter\'s division for that window (the weight class fought at most in it): one against active fighters (a UFC fight in the 24 months up to the latest event in the data; the view the page opens in) and one against everyone in UFC history. Stats cover striking, grappling, finishing and durability, round-by-round output, and context such as the Savant rating. Also returns the 5 most recent UFC fights with results and any title reigns. Low samples, stats the fights predate, and fighters below the qualifying line are flagged. The page\'s "Everyone" cohort and cage-time filter are not included. Includes the link to the fighter\'s page and the date the data runs through.',
      inputSchema: {
        fighter: z.string().trim().min(1).max(80).describe('Fighter id from ufc_search_fighters (16 hex characters) or a name or nickname (e.g. "Islam Makhachev"). If a name fits more than one fighter, the error lists their ids.'),
        window: z.enum(WINDOWS).default('career').describe('"career" for the whole UFC career (default), "l5" for the last 5 UFC fights, "l3" for the last 3.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which stats to return: "all" (default, with recent fights and title reigns), or one panel with each stat explained: "context", "striking", "grappling", "finishing" or "rounds".'),
      },
      outputSchema: {
        fighter: z.object({
          id: z.string(),
          name: z.string(),
          nickname: z.string().nullable(),
          division: z.string().describe('The weight class fought at most in this window. Percentiles are inside it.'),
          career_division: z.string().describe('The weight class fought at most over the UFC career.'),
          height_inches: z.number().nullable(),
          height: z.string().nullable().describe('Feet and inches.'),
          reach_inches: z.number().nullable(),
          weight_lb: z.number().nullable().describe('Listed weight.'),
          stance: z.string().nullable(),
          born: z.string().nullable(),
          age: z.number().nullable().describe('Whole years from the date of birth to data_through, as the page shows it. The data does not record whether a retired fighter is living.'),
          pro_record: record.nullable().describe('Professional record.'),
          ufc_record: record.describe('Record in the UFC only.'),
          ufc_debut: z.string().nullable(),
          last_ufc_fight: z.string().nullable(),
          active: z.boolean().describe('Whether the fighter has a UFC fight in the 24 months before data_through.'),
          rankings: z.array(z.object({
            division: z.string(),
            rank: z.number().describe('0 is the champion, 0.5 the interim champion, otherwise the ranking.'),
            text: z.string(),
          })).describe('Official UFC ranking by division.'),
          pound_for_pound: z.number().nullable().describe('Official pound-for-pound ranking.'),
          rankings_as_of: z.string().nullable(),
        }),
        window: z.object({
          key: z.string().describe('career, l5 or l3.'),
          label: z.string(),
          fights: z.number().int().describe('UFC fights in the window.'),
          earliest_year: z.number().nullable().describe('Year of the earliest fight in the window.'),
          qualified: z.boolean().describe('Whether the fighter is in the percentile pools for this window.'),
          division: z.string(),
        }),
        pools: z.object({
          active: z.object({ label: z.string(), size: z.number().int() }).describe('Qualified fighters of the division with a UFC fight in the last 24 months.'),
          all_time: z.object({ label: z.string(), size: z.number().int() }).describe('Qualified fighters of the division in UFC history.'),
        }),
        stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          subgroup: z.string().nullable(),
          tag: z.string().nullable().describe('The page\'s tag for the kind of number: output, ingredient or context.'),
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          active_percentile: pct.describe('Against the active pool. Null when that pool has fewer than two fighters with the stat.'),
          all_time_percentile: pct.describe('Against the all-time pool. Null when that pool has fewer than two fighters with the stat.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentiles are already flipped.'),
          low_sample: z.boolean().describe('True when the stat is below the sample it needs.'),
          sample: z.object({ have: z.number(), needs: z.number(), of: z.string() }).nullable().describe('For a low-sample stat: the sample it is on and the sample it needs.'),
          what: z.string().nullable().describe('What the stat is, in the page\'s words.'),
        })),
        no_value: z.array(z.object({ key: z.string(), label: z.string() })).describe('Stats with no value in this window. Not zero.'),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string(), since: z.number() })).describe('Stats the fights in this window predate.'),
        title_reigns: z.array(z.object({
          division: z.string(),
          interim: z.boolean(),
          start: z.string(),
          end: z.string().nullable().describe('Null while the reign is running.'),
          days: z.number().nullable(),
          length: z.string().describe('The length as the site prints it, e.g. "2y 8m".'),
          defenses: z.number().int(),
          ended: z.string().describe('How it ended, or "reigning".'),
          in_official_ranking: z.boolean().nullable().describe('For a reign still running in the data: whether the official ranking lists the fighter as that champion. Null for a reign that has ended.'),
        })).optional().describe('UFC title reigns, oldest first.'),
        recent_fights: z.array(z.object({
          date: z.string(),
          result: z.string().describe('W, L, D or NC.'),
          opponent: z.string(),
          opponent_id: z.string(),
          method: z.string().nullable(),
          round: z.number().nullable().describe('The round the fight ended in.'),
          time: z.string().nullable().describe('Time into that round, minutes:seconds.'),
          bout: z.string().nullable().describe('Weight class or title, as ufcstats.com lists the bout.'),
          title_bout: z.boolean().describe('The page\'s TITLE tag: a UFC title fight or a tournament final, as named in bout.'),
          event: z.string().nullable(),
          bonuses: z.array(z.string()),
          sig_strikes_landed: z.number().nullable(),
          sig_strikes_absorbed: z.number().nullable(),
          knockdowns: z.number().nullable(),
          takedowns: z.number().nullable(),
          control: z.string().nullable().describe('Control time, minutes:seconds.'),
          opponent_rating: z.number().nullable().describe('The opponent\'s Savant rating going into the fight.'),
        })).optional().describe('The 5 most recent UFC fights, newest first.'),
        notes: z.array(z.string()).describe('How to read the numbers: what the pools are, and every caution that applies to this fighter.'),
        url: z.string().describe('The fighter\'s UFC Savant page, opened on this window.'),
        data_through: z.string().describe('Date of the latest UFC event in the data. Active status and age are counted from it.'),
        data_built: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get a UFC fighter\'s Savant profile', ...READ_ONLY },
    },
    run: ({ fighter, window, group }) => fighterProfile({ fighter, window, group }),
  },
  {
    name: 'ufc_get_upcoming_cards',
    config: {
      title: 'Get upcoming UFC cards',
      description:
        'Get the next UFC card, or every card still to come, from UFC Savant (wcehoops.com): event, date, location, and each bout with weight class and both fighters, the main event marked. Cards are checked against today\'s date, so a card already fought is not given as the next one. Fighters with a UFC Savant page come with id and link. The list is as scraped from ufcstats.com at the last data build; that date is returned.',
      inputSchema: {
        which: z.enum(['upcoming', 'next', 'all']).default('upcoming').describe('"upcoming" (default): cards not yet fought. "next": only the next one. "all": everything listed, past cards marked.'),
      },
      outputSchema: {
        today: z.string().describe('The date the cards were judged against (US west coast).'),
        which: z.string(),
        count: z.number().int(),
        next_card: z.object({ event: z.string(), date: z.string().nullable(), location: z.string().nullable() }).nullable().describe('The first listed card that has not happened. Null when every listed card is past.'),
        past_cards_listed: z.number().int().describe('Listed cards that have already happened.'),
        data_through: z.string().describe('Date of the latest UFC event whose results are in the data.'),
        cards: z.array(z.object({
          event: z.string(),
          date: z.string().nullable(),
          location: z.string().nullable(),
          status: z.string().describe('"upcoming", "today" or "past", against today\'s date.'),
          next: z.boolean().describe('True on the next card.'),
          bouts: z.array(z.object({
            bout: z.string().nullable().describe('Weight class, as ufcstats.com lists the bout.'),
            main_event: z.boolean().describe('True on the bout the card is named for.'),
            fighters: z.array(z.object({
              name: z.string(),
              id: z.string().nullable().describe('Fighter id for ufc_get_fighter_profile, when the fighter has a UFC Savant page.'),
              in_ufc_savant: z.boolean().describe('False for a fighter with no UFC fights in the data yet.'),
              url: z.string().nullable(),
            })),
            matchup_url: z.string().nullable().describe('The page\'s head-to-head view for the two fighters, when both have a page.'),
          })),
        })),
        notes: z.array(z.string()),
        url: z.string().describe('The UFC Savant page.'),
        data_built: z.string().describe('The date the list was scraped.'),
        source: z.string(),
      },
      annotations: { title: 'Get upcoming UFC cards', ...READ_ONLY },
    },
    run: ({ which }) => upcomingCards({ which }),
  },
  {
    name: 'ufc_get_leaderboard',
    config: {
      title: 'Get a UFC leaderboard',
      description:
        'Rank UFC fighters by UFC Savant\'s Leaderboard Builder rules (wcehoops.com): one division, or all men or all women, by a stat (takedown defense, strike differential, Savant rating, days as champion) or by the official UFC ranking. Use for "who has the best", "top five" and "who is champion / ranked at lightweight" questions instead of looking fighters up one by one. Default: active fighters, whole UFC career, settled samples. Each fighter comes with place, value and percentile inside his own division.',
      inputSchema: {
        stat: z.string().trim().min(1).max(60).default('rank').describe('"rank" (default) for the official UFC ranking, or a stat key or name, e.g. "tddef", "takedown defense", "slpm", "elo", "beltdays".'),
        division: z.string().trim().max(40).optional().describe('A division, e.g. "lightweight", "LW"; or "men" (default) or "women" for all of one sex (with "rank": pound-for-pound).'),
        window: z.enum(WINDOWS).default('career').describe('Career (default), last 5 or last 3 UFC fights.'),
        pool: z.enum(['active', 'all_time']).default('active').describe('Active fighters (default: a UFC fight in the last 24 months) or everyone in UFC history.'),
        sample: z.enum(['settled', 'everyone']).default('settled').describe('"settled" (default) lists only samples big enough to trust, as the page does; "everyone" lists the rest, marked.'),
        limit: z.number().int().min(1).max(25).default(10).describe('Rows to list (default 10).'),
        order: z.enum(['top', 'bottom']).default('top').describe('Best first (default) or worst first.'),
      },
      outputSchema: {
        mode: z.string().describe('"stat" or "official_ranking".'),
        stat: z.object({ key: z.string(), label: z.string(), what: z.string().nullable(), lower_is_better: z.boolean() }),
        window: z.object({ key: z.string(), label: z.string() }),
        division: z.string(),
        pool: z.string().nullable(),
        sample: z.string().nullable(),
        order: z.string(),
        ranked: z.number().int().describe('How many fighters the board ranks.'),
        hidden_low_sample: z.number().int(),
        count: z.number().int(),
        leaders: z.array(z.object({
          rank: z.number().describe('Place on the board, counted from the top. In the official ranking: 0 is the champion, 0.5 the interim champion.'),
          rank_text: z.string(),
          tied: z.boolean(),
          id: z.string(),
          name: z.string(),
          nickname: z.string().nullable(),
          division: z.string().describe('The weight class fought at most in the window.'),
          active: z.boolean(),
          ufc_fights: z.number().nullable().describe('UFC fights in the window.'),
          official_rank: z.string().nullable().describe('The fighter\'s best official UFC ranking, if ranked.'),
          value: z.number().nullable().describe('The ranking stat; in the official ranking, the Savant rating.'),
          display: z.string().nullable(),
          active_percentile: pct.describe('Inside the fighter\'s own division, against active fighters.'),
          all_time_percentile: pct,
          low_sample: z.boolean(),
          open_reign: z.boolean().describe('Title stats only: the data still counts a reign as running that the official ranking does not back.'),
          url: z.string(),
        })),
        notes: z.array(z.string()).describe('Who is ranked, and how to read the board.'),
        url: z.string().describe('The same leaderboard on the site.'),
        rankings_as_of: z.string().nullable(),
        data_through: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get a UFC leaderboard', ...READ_ONLY },
    },
    run: (args) => leaderboard(args),
  },
  {
    name: 'ufc_compare_fighters',
    config: {
      title: 'Compare UFC fighters side by side',
      description:
        'Put two to four UFC fighters side by side on the same UFC Savant stats (wcehoops.com): records, official ranking, height and reach, each stat\'s value with percentile inside the fighter\'s own division, what the stat means, and any fights between them among their recent UFC fights. Use for matchups and "who is the better striker / wrestler". Defaults to the whole UFC career and the page\'s headline stats.',
      inputSchema: {
        fighters: z.array(z.string().trim().min(1).max(80)).min(2).max(4).describe('Two to four names, nicknames or ids.'),
        window: z.enum(WINDOWS).default('career').describe('Career (default), last 5 or last 3 UFC fights.'),
        group: z.enum(['headline', ...Object.keys(GROUPS)]).default('headline').describe('"headline" (default) or one panel.'),
        stats: z.array(z.string().trim().min(1).max(60)).max(12).optional().describe('Instead of a group: up to 12 stat keys or names.'),
      },
      outputSchema: {
        window: z.object({ key: z.string(), label: z.string() }),
        fighters: z.array(z.object({
          id: z.string(), name: z.string(), nickname: z.string().nullable(), division: z.string(), fights_in_window: z.number().int(), qualified: z.boolean(), active: z.boolean(),
          pro_record: z.string().nullable(), ufc_record: z.string().nullable(), age: z.number().nullable(), height: z.string().nullable(), reach_inches: z.number().nullable(), stance: z.string().nullable(),
          official_rank: z.array(z.string()), pools: z.object({ active: z.number().int(), all_time: z.number().int() }).describe('Qualified fighters in his division for this window.'), url: z.string(),
        })),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), tag: z.string().nullable(), lower_is_better: z.boolean(), what: z.string().nullable(),
          values: z.array(z.object({
            status: z.string().describe('"ok", "no value" (not a zero) or "not tracked in those fights".'),
            value: z.number().nullable(), display: z.string().nullable(), active_percentile: pct, all_time_percentile: pct, low_sample: z.boolean(),
          })).describe('One per fighter, in the order of fighters.'),
        })),
        meetings: z.array(z.object({
          date: z.string(), fighters: z.array(z.string()), result: z.string(), winner_id: z.string().nullable(), loser_id: z.string().nullable(),
          method: z.string().nullable(), round: z.number().nullable(), time: z.string().nullable(), bout: z.string().nullable(), event: z.string().nullable(),
        })).describe('Fights between them among each fighter\'s most recent UFC fights, newest first.'),
        matchup_url: z.string().nullable().describe('The page\'s head-to-head view, for two fighters.'),
        notes: z.array(z.string()),
        data_through: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Compare UFC fighters side by side', ...READ_ONLY },
    },
    run: (args) => compareFighters(args),
  },
  {
    name: 'ufc_list_stats',
    config: {
      title: 'List UFC Savant\'s stats',
      description:
        'UFC Savant\'s glossary (wcehoops.com): every stat\'s key, name, meaning and why it matters in the page\'s words, formula, the sample it needs, and whether lower is better. Use to explain a stat ("what is the Savant rating") or to find the key for ufc_get_leaderboard or ufc_compare_fighters.',
      inputSchema: {
        group: z.enum([...Object.keys(GROUPS), 'titles']).optional().describe('Only one panel, or "titles" for the leaderboard-only title stats.'),
        query: z.string().trim().min(2).max(60).optional().describe('Only stats whose name or meaning matches, e.g. "takedown".'),
      },
      outputSchema: {
        count: z.number().int(),
        stats: z.array(z.object({
          key: z.string(), label: z.string(), group: z.string(), subgroup: z.string().nullable(), tag: z.string().nullable(), lower_is_better: z.boolean(),
          low_sample_below: z.string().nullable(), since: z.number().nullable().describe('Set when the stat is only recorded from that year on.'), leaderboard_only: z.boolean(),
          what: z.string().nullable(), formula: z.string().nullable(), why: z.string().nullable(),
        })),
        notes: z.array(z.string()),
        url: z.string(),
        source: z.string(),
      },
      annotations: { title: 'List UFC Savant\'s stats', ...READ_ONLY },
    },
    run: (args) => listStats(args),
  },
]
