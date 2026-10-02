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
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError, day, makeLoader, miss, norm, ordinal, prepare, rank, thousands, topTier } from './_core.js'

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

// ---- upcoming cards --------------------------------------------------------------------

export async function upcomingCards() {
  const [meta, file, idx] = await Promise.all([loadMeta(), loadUpcoming(), loadIndex()])
  const cards = file.cards.map((c) => ({
    event: c.name,
    date: c.date,
    location: c.location,
    bouts: c.bouts.map((b) => {
      const corner = (x) => {
        const known = !!(x && x.known && idx.byId.has(x.id))
        return { name: (x && x.name) || 'TBA', id: known ? x.id : null, in_ufc_savant: known, url: known ? fighterUrl(meta, x.id) : null }
      }
      const [a, b2] = [corner(b.f[0]), corner(b.f[1])]
      return { bout: b.wc, fighters: [a, b2], matchup_url: a.id && b2.id ? matchupUrl(meta, a.id, b2.id) : null }
    }),
  }))

  const built = day(file.generated)
  const notes = [
    `These are the cards ufcstats.com listed as upcoming when the data was built on ${built}. A card dated before today has already happened, and a card can change after that date.`,
    'A fighter with no UFC fights in the data has no UFC Savant page yet and is listed by name only.',
    'The UFC Savant home screen shows the first of these cards as "Next card".',
  ]
  const structured = { count: cards.length, cards, notes, url: meta.page, data_built: built, source: SOURCE }

  if (!cards.length) return { structured, text: `UFC Savant lists no upcoming cards as of ${built}.\n\nPage: ${meta.page}\nSource: ${SOURCE}.` }
  const L = [`${cards.length} upcoming UFC card${cards.length === 1 ? '' : 's'} listed as of ${built}:`]
  for (const c of cards) {
    L.push('', `${c.event}, ${c.date || 'date not listed'}${c.location ? `, ${c.location}` : ''} (${c.bouts.length} bout${c.bouts.length === 1 ? '' : 's'})`)
    for (const b of c.bouts) {
      const name = (x) => `${x.name}${x.id ? ` (id ${x.id})` : x.name === 'TBA' ? '' : ' (no UFC Savant page yet)'}`
      L.push(`- ${b.bout ? `${b.bout}: ` : ''}${name(b.fighters[0])} vs. ${name(b.fighters[1])}`)
    }
  }
  // One line for the links rather than one per bout: thirty-odd long URLs would bury the cards.
  const links = `A fighter's page is ${meta.fighterUrl.replace('{id}', '<id>').replace('{window}', meta.defaults.window)}. The head-to-head view for a bout between two fighters with ids is ${meta.matchupUrl.replace('{a}', '<id>').replace('{b}', '<id>').replace('{window}', meta.matchupWindow)}.`
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
        'Get the upcoming UFC cards listed in UFC Savant (Western Conference Elitists, wcehoops.com): each event\'s name, date and location, and its bouts with weight class and both fighters. Fighters who have a UFC Savant page come with their id and link, and a bout between two of them comes with the link to the page\'s head-to-head view. The list is as scraped from ufcstats.com when the data was last built, and that date is returned.',
      inputSchema: {},
      outputSchema: {
        count: z.number().int(),
        cards: z.array(z.object({
          event: z.string(),
          date: z.string().nullable(),
          location: z.string().nullable(),
          bouts: z.array(z.object({
            bout: z.string().nullable().describe('Weight class, as ufcstats.com lists the bout.'),
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
    run: () => upcomingCards(),
  },
]
