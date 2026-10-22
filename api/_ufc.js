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
// THE PAGE'S OTHER VIEWS
// The profile also carries the page's "Everyone" cohort (every division of his sex), the
// "Fights like" and "Where he can be beaten" comps, the strike map, the round curve and the
// whole fight log. ufc_leaderboard and ufc_matchup are the page's Leaderboard (lbPool(),
// lbRender()) and head-to-head (renderMatchup()): filters and sorts over the same window
// rows, so they read all sixteen fighter files, keep the page's own fighter order (its sorts
// are stable, so that order settles ties) and read every percentile from the files — the
// leaderboard's from the fighter's own division, or from every division of his sex on the
// all-men and all-women boards, as the page colours it.
//
// Left out: the cage-time band (every setting of its slider is a different pool) and the
// round-by-round detail of a single fight (ufc-savant-fights.json, which the section's budget
// has no room for).
//
// Values print exactly the way the page prints them. Fight results are reported as the data
// has them and nothing is added: no reading of form, no prediction. The head-to-head's win
// probability is the page's, implied by the two ratings alone, and is labelled as such.
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
// two together ("Tank Abbott" is David Abbott, nicknamed Tank). A fighter named inside
// another's row (an opponent, a comp) is given by his place in this list.
const prepared = new WeakMap()
async function loadIndex() {
  const file = await files.load('fighters.json')
  let idx = prepared.get(file)
  if (!idx) {
    const nicked = file.fighters.filter((f) => f.nick)
    idx = {
      list: file.fighters,
      generated: file.generated,
      byId: new Map(file.fighters.map((f) => [f.id, f])),
      names: prepare(file.fighters),
      nicks: prepare(nicked, (f) => f.nick),
      both: prepare(nicked, (f) => `${f.name} ${f.nick}`),
    }
    prepared.set(file, idx)
  }
  return idx
}

// A fighter's row, with a guard: the index, the glossary and the fighter files come from one
// build, and a deploy in progress can briefly serve them from two.
const REFRESHING = 'UFC Savant\'s files are being refreshed and disagree with each other right now. Try again in a few minutes.'
async function fighterRow(meta, idx, id) {
  const shard = await loadShard(id)
  if (shard.generated !== idx.generated || shard.generated !== meta.generated) throw new SavantError(REFRESHING)
  return shard.fighters[id]
}

// Every fighter, in the order the page keeps them in (its NAMES): the leaderboard's sorts are
// stable, so on a tie this order decides.
async function everyFighter(meta, idx) {
  const shards = await Promise.all('0123456789abcdef'.split('').map((s) => files.load(`fighters/${s}.json`)))
  if (shards.some((s) => s.generated !== idx.generated || s.generated !== meta.generated)) throw new SavantError(REFRESHING)
  return shards.flatMap((s) => Object.values(s.fighters)).sort((a, b) => a.o - b.o)
}

// A window's cell for a stat: [value, ...one percentile per meta.views entry], or null.
const cellIndex = new WeakMap()
export function cellOf(meta, w, key) {
  let at = cellIndex.get(meta)
  if (!at) { at = new Map(meta.cells.map((k, i) => [k, i])); cellIndex.set(meta, at) }
  return at.has(key) ? w.c[at.get(key)] || null : null
}

// One fight of a log row, in words and numbers (the page's log table).
function fightOf(meta, idx, x) {
  const opp = idx.list[x[2]] || {}
  return {
    date: x[0],
    result: x[1],
    opponent: opp.name || 'unknown',
    opponent_id: opp.id || null,
    method: x[3],
    round: x[4],
    time: miss(x[5]) ? null : clock(x[5]),
    bout: x[6],
    title_bout: x[7] === 1,
    event: x[9] == null ? null : meta.events[x[9]] || null,
    bonuses: (x[8] || []).map((b) => meta.bonus[b] || b),
    sig_strikes_landed: x[10],
    sig_strikes_absorbed: x[11],
    knockdowns: x[12],
    takedowns: x[13],
    control: miss(x[14]) ? null : clock(x[14]),
    opponent_rating: x[15],
  }
}
function fightLine(x, i) {
  const bits = []
  if (!miss(x.sig_strikes_landed)) bits.push(`Sig. strikes ${x.sig_strikes_landed} landed, ${x.sig_strikes_absorbed} absorbed`)
  if (!miss(x.knockdowns)) bits.push(`knockdowns ${x.knockdowns}`)
  if (!miss(x.takedowns)) bits.push(`takedowns ${x.takedowns}`)
  if (x.control) bits.push(`control ${x.control}`)
  if (!miss(x.opponent_rating)) bits.push(`opponent's Savant rating going in ${x.opponent_rating}`)
  const how = [x.method, x.round != null ? `R${x.round}${x.time ? ` ${x.time}` : ''}` : null].filter(Boolean).join(', ')
  const where = [x.bout ? `${x.bout} bout` : null, x.event ? `at ${x.event}` : null].filter(Boolean).join(' ')
  const sentences = [where, bits.join('; ').replace(/^./, (c) => c.toUpperCase()), x.bonuses.length ? `Bonus: ${x.bonuses.join(', ')}` : ''].filter(Boolean)
  return `${i + 1}. ${x.date}: ${RESULT[x.result] || x.result} ${x.opponent} (${how}). ${sentences.join('. ')}.`
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
export const feetInches = (n) => { const t = Math.round(n), f = Math.floor(t / 12); return `${f}'${t - f * 12}"` }

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

// The profile's groups beyond the stat panels: "style" (Fights like, Where he can be beaten,
// the strike map and the round curve) and "fights" (the whole UFC fight log).
export const EXTRA_GROUPS = ['style', 'fights']
const COHORT = { division: 'div', everyone: 'all' }

// The page's strike map and round curve, from a window's sm and rc (see meta.row).
function strikeMap(sm) {
  const share = (a, t) => (t ? a / t : 0)
  const pct = (a, t) => (t ? Math.round((a / t) * 100) : null)
  const [hl, ha, bl, ba, ll, la, dl, da, cl, ca, gl, ga, oh, ob, ol, od, oc, og] = sm
  const landedT = hl + bl + ll
  const absorbedT = oh + ob + ol
  const landedP = dl + cl + gl
  const absorbedP = od + oc + og
  const target = (l, a, abs) => ({ landed: l, attempted: a, accuracy_pct: pct(l, a), share_pct: Math.round(share(l, landedT) * 100), absorbed: abs, absorbed_share_pct: Math.round(share(abs, absorbedT) * 100) })
  // The page draws position shares as bar widths (share * 100); to one decimal here.
  const position = (l, a, abs) => ({ landed: l, attempted: a, accuracy_pct: pct(l, a), share_pct: Math.round(share(l, landedP) * 100 * 10) / 10, absorbed: abs, absorbed_share_pct: Math.round(share(abs, absorbedP) * 100 * 10) / 10 })
  return {
    head: target(hl, ha, oh), body: target(bl, ba, ob), legs: target(ll, la, ol),
    distance: position(dl, da, od), clinch: position(cl, ca, oc), ground: position(gl, ga, og),
  }
}

export async function fighterProfile({ fighter, window, group = 'all', cohort = 'division' }) {
  const meta = await loadMeta()
  const win = window || meta.defaults.window
  if (!meta.windows[win]) {
    throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  }
  const extra = EXTRA_GROUPS.includes(group)
  const groupKey = group === 'all' || extra ? null : GROUPS[group]
  if (group !== 'all' && !extra && !meta.groups[groupKey]) throw new SavantError(`UFC Savant has no "${group}" group. Use one of: all, ${[...Object.keys(GROUPS), ...EXTRA_GROUPS].join(', ')}.`)
  const ck = COHORT[cohort]
  if (!ck) throw new SavantError(`UFC Savant has no "${cohort}" cohort. Use "division" or "everyone".`)

  const who = await resolveFighter(fighter, meta)
  const idx = await loadIndex()
  const row = await fighterRow(meta, idx, who.id)
  const w = row && row.w[win]
  if (!w) throw new SavantError(`UFC Savant has no ${meta.windows[win]} numbers for ${who.name} right now. Try again in a minute.`)

  const label = meta.windows[win]
  const career = row.w.career || w
  // The women's divisions are marked in the data; the wording follows.
  const sex = (meta.divisions.find((d) => d.key === w.div) || {}).sex || 'M'
  const woman = (meta.divisions.find((d) => d.key === career.div) || {}).sex === 'F'
  const [he, his, him] = woman ? ['she', 'her', 'her'] : ['he', 'his', 'him']
  // The page's stat explanations are written about a man ("strikes he lands", "both men").
  // They are quoted, not reworded, so on a woman's profile only the ones that fit are quoted.
  const fits = (text) => (text && (!woman || !/\b(he|his|him|himself|man|men)\b/i.test(text)) ? text : null)
  const cap = (word) => word[0].toUpperCase() + word.slice(1)
  const whole = win !== 'career' && w.n === career.n
  const division = divisionLabel(meta, w.div)
  const [minFights, minMinutes] = meta.qualify[win]
  const slot = { active: viewSlot(meta, 'active', ck), all: viewSlot(meta, 'all', ck) }
  const people = ck === 'all' ? (sex === 'F' ? 'women' : 'men') : peers(meta, w.div)
  const size = (baseline) => (((meta.pools[win] || {})[baseline] || {})[ck] || {})[ck === 'all' ? sex : w.div] || 0
  const pool = {
    active: { label: `active ${people}`, size: size('active') },
    all_time: { label: `all-time ${people}`, size: size('all') },
  }

  const low = w.low || {}
  const stats = []
  const noValue = []
  const notTracked = []
  if (!extra) {
    for (const m of meta.metrics) {
      if (groupKey && m.group !== groupKey) continue
      const cell = cellOf(meta, w, m.key)
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
    cohort,
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
  if (!extra) {
    if (ck === 'div') {
      say(`Each stat shows two percentiles, both inside ${his} division and both over each fighter's own ${lowerFirst(label)}. "vs. ${pool.active.label}" is against the qualified ${division} fighters who have fought in the UFC in the ${meta.activeMonths} months before ${meta.latest} (${sized(pool.active.size)}); it is the view the page opens in. "vs. ${pool.all_time.label}" is against every qualified ${division} fighter in UFC history (${sized(pool.all_time.size)}). Qualifying: ${minFights}+ fights and ${minMinutes}+ minutes of cage time in the window.`)
    } else {
      say(`Each stat shows two percentiles against every division of ${his} sex, the page's "${meta.cohorts.all}" cohort, both over each fighter's own ${lowerFirst(label)}. "vs. ${pool.active.label}" is against the qualified ${people} who have fought in the UFC in the ${meta.activeMonths} months before ${meta.latest} (${sized(pool.active.size)}). "vs. ${pool.all_time.label}" is against every qualified one in UFC history (${sized(pool.all_time.size)}). Qualifying: ${minFights}+ fights and ${minMinutes}+ minutes of cage time in the window. The page's own caution: "${meta.everyoneNote}"`)
    }
    const divisions = Object.entries(meta.windows).filter(([k]) => row.w[k]).map(([k, lab]) => [lab, divisionLabel(meta, row.w[k].div)])
    const moved = new Set(divisions.map((d) => d[1])).size > 1
    say(`${cap(his)} division is the weight class ${he} fought at most in the window (the most recent on ties).${moved ? ` It changes with the window: ${divisions.map(([lab, d]) => `${lowerFirst(lab)} ${d}`).join(', ')}.` : ''}`)
    say(`A percentile is where ${his} number falls in that pool, from 1 to 99. Stats marked "lower is better" are already flipped, so higher is the better mark. For style and context numbers (where ${his} strikes go, pace, fight length, how often ${he} goes to a decision) a percentile describes ${him}, it does not grade ${him}.`)
    for (const [key, p] of [['active', pool.active], ['all_time', pool.all_time]]) {
      if (p.size < 2) say(`There ${p.size === 1 ? 'is only 1 qualified fighter' : 'are no qualified fighters'} among ${p.label}, so no "vs. ${p.label}" percentile exists${key === 'active' && ck === 'div' ? `; the page shows no bars for ${him} in the view it opens in` : ''}.`)
    }
    if (!w.qualified) {
      const guide = (meta.metrics.find((m) => m.key === 'n') || {}).explain
      say(`${cap(he)} is below the qualifying line (${minFights} fights, ${minMinutes} minutes) for this window: ${he} is ranked against the pools but is not part of them. ${cap(he)} has ${fights(w.n)} in it.${fits(guide && guide.y) ? ` The page's own guide: "${guide.y}"` : ''}`)
    }
    if (!row.active) say(`${cap(he)} is inactive: no UFC fight in the ${meta.activeMonths} months before ${meta.latest}. ${cap(he)} is ranked against the active pool but is not part of it.`)
  }
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
  if (!extra && !stats.length) L.push('', 'No stats in this group for that window.')
  L.push('')

  if (!extra) {
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
  }

  // ---- style: who he fights like, where he can be beaten, where his strikes go ----
  if (group === 'style') {
    const comp = (c) => { const e = idx.list[c[0]] || {}; return { id: e.id || null, name: e.name || 'unknown', division: divisionLabel(meta, c[2]), active: !!e.active, score: c[1] } }
    const sm = w.sm ? strikeMap(w.sm) : null
    const rc = (w.rc || []).map((x, i) => (x ? { round: i + 1, landed_per_min: x[0], absorbed_per_min: x[1], minutes: x[2] } : null)).filter(Boolean)
    const fadeCell = cellOf(meta, w, 'fade')
    const fade = fadeCell ? fadeCell[0] : null
    structured.style = {
      fights_like: (w.comps || []).map(comp),
      weakest: (w.flaws || []).map(([key, p]) => ({ key, label: (meta.metrics.find((m) => m.key === key) || { label: key }).label, percentile: p })),
      shares_weaknesses: (w.wcomps || []).map(comp),
      strike_map: sm,
      round_curve: rc,
      late_fight_index: fade,
    }
    const st = structured.style
    if (st.fights_like.length) {
      L.push(`Fights like (${division}, ${lowerFirst(label)}, style similarity 0-100 across ${meta.styleDimensions} dimensions): ${st.fights_like.map((c) => `${c.name} ${c.score}${c.active ? '' : ' (inactive)'}`).join(', ')}.`)
    } else L.push(`No "Fights like" comps for ${him} in this window: the data has them only for a qualified fighter in a division with at least 8 qualified fighters in the window.`)
    if (st.weakest.length || st.shares_weaknesses.length) {
      L.push(`Where ${he} can be beaten: ${st.weakest.length ? `${his} weakest dimensions are ${st.weakest.map((x) => `${x.label} (${ordinal(x.percentile)} percentile)`).join(', ')}` : 'no dimension under the 40th percentile'}.${st.shares_weaknesses.length ? ` Fighters who share them: ${st.shares_weaknesses.map((c) => `${c.name} ${c.score}`).join(', ')}.` : ''}`)
      say(`The weakest dimensions are percentiles against every qualified ${division} fighter in UFC history over the same window: the lowest three at most, each under the 40th before rounding.`)
    }
    if (sm) {
      const t = (x, name) => `${name} ${thousands(x.landed)} landed${x.accuracy_pct == null ? '' : ` at ${x.accuracy_pct}%`} (${x.share_pct}% of the total)`
      L.push(`Strike map, significant strikes landed: ${t(sm.head, 'head')}, ${t(sm.body, 'body')}, ${t(sm.legs, 'legs')}. Absorbed: head ${sm.head.absorbed_share_pct}%, body ${sm.body.absorbed_share_pct}%, legs ${sm.legs.absorbed_share_pct}%.`)
      L.push(`By position, landed: ${t(sm.distance, 'distance')}, ${t(sm.clinch, 'clinch')}, ${t(sm.ground, 'ground')}. Absorbed: distance ${sm.distance.absorbed_share_pct}%, clinch ${sm.clinch.absorbed_share_pct}%, ground ${sm.ground.absorbed_share_pct}%.`)
    }
    if (rc.length) {
      L.push(`Round curve, significant strikes per minute: ${rc.map((r) => `R${r.round} ${r.landed_per_min.toFixed(2)} landed, ${r.absorbed_per_min.toFixed(2)} absorbed over ${r.minutes.toFixed(0)} min`).join('; ')}.${miss(fade) ? '' : ` Late-fight index ${fade.toFixed(2)}: ${fade >= 1.05 ? `${he} gets stronger` : fade <= 0.85 ? `${he} fades` : `${he} holds ${his} pace`}.`}`)
      say('Rounds 4 and 5 are title and main-event minutes only.')
    }
  }

  // ---- the fight log ----
  // The whole profile carries the most recent fights; the "fights" group, all of them.
  const log = row.log || []
  const listed = group === 'fights' ? log : group === 'all' ? log.slice(0, meta.recentFights) : []
  if (listed.length) {
    const rows = listed.map((x) => fightOf(meta, idx, x))
    if (group === 'fights') structured.fight_log = rows
    else structured.recent_fights = rows
    const all = rows.length >= career.n
    L.push('', career.n === 1 ? `${cap(his)} only UFC fight:` : all ? `All ${career.n} of ${his} UFC fights, newest first:` : `${cap(his)} ${rows.length} most recent UFC fights of ${career.n}, newest first:`)
    rows.forEach((x, i) => L.push(fightLine(x, i)))
  }

  // The belts belong to the whole profile. Asking for one group is asking for less.
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
  }

  L.push('', `Page: ${structured.url}`, `Source: ${SOURCE}. Data through ${meta.latest}, built ${structured.data_built}.`)
  return { structured, text: L.join('\n').replace(/\n{3,}/g, '\n\n') }
}

// ---- shared by the leaderboard and the head-to-head ----------------------------------

// Every stat by key, the profile's and the two the profile does not draw.
const statsBy = new WeakMap()
function statOf(meta, key) {
  let by = statsBy.get(meta)
  if (!by) { by = new Map([...meta.metrics, ...meta.boardMetrics].map((m) => [m.key, m])); statsBy.set(meta, by) }
  return by.get(key) || null
}
// A stat named by its key ("slpm") or its label ("Sig. strikes landed / min").
function statNamed(meta, input, what) {
  const raw = String(input || '').trim()
  const found = statOf(meta, raw) || meta.cells.map((k) => statOf(meta, k)).find((m) => m && (m.key.toLowerCase() === raw.toLowerCase() || norm(m.label) === norm(raw)))
  if (!found) throw new SavantError(`UFC Savant has no stat "${raw}" ${what}. Use a key: ${meta.cells.map((k) => `${k} (${statOf(meta, k).label})`).join(', ')}.`)
  return found
}
const ranking = (n) => (n == null ? '—' : n === 0 ? 'C' : n === 0.5 ? 'IC' : `#${n}`)   // the page's rankTxt()
const BASIS = { active: 'active', all_time: 'all' }
const SAMPLE = { settled: 'settled', everyone: 'all' }

// ---- leaderboard -------------------------------------------------------------------------

// The page's presets by a plain name: "Best differential" is best_differential.
export const presetId = (name) => norm(name).replace(/ /g, '_')
export const PRESETS = ['official_rankings', 'best_differential', 'power', 'wrestling', 'iron_chins', 'cardio', 'ratings', 'longest_reigns']

// The leaderboard's division picker: every division but open weight, plus all men and all
// women (ranked, when by ranking, on the pound-for-pound lists).
function boardDivision(meta, input) {
  const raw = norm(input).replace(/weights$/, 'weight')
  if (/^(all )?(men|mens)$/.test(raw)) return { key: 'M', label: 'All men' }
  if (/^(all )?(women|womens)$/.test(raw)) return { key: 'F', label: 'All women' }
  const d = meta.divisions.find((x) => x.key !== 'OPEN' && (norm(x.key) === raw || norm(x.label) === raw))
  if (!d) throw new SavantError(`The leaderboard has no "${input}" division. Use one of: ${meta.divisions.filter((x) => x.key !== 'OPEN').map((x) => `${x.label} (${x.key})`).join(', ')}, men or women.`)
  return { key: d.key, label: d.label }
}

export async function ufcLeaderboard(args = {}) {
  const meta = await loadMeta()
  const lb = meta.leaderboard
  const def = lb.defaults
  let preset = null
  if (args.preset) {
    preset = lb.presets.find((p) => presetId(p.name) === args.preset)
    if (!preset) throw new SavantError(`The leaderboard has no "${args.preset}" preset. Use one of: ${lb.presets.map((p) => presetId(p.name)).join(', ')}.`)
  }
  const win = args.window || def.win
  if (!meta.windows[win]) throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  const div = boardDivision(meta, args.division || def.div)
  const bySex = div.key === 'M' || div.key === 'F'
  const rankInput = args.rank_by || (preset ? preset.rank : def.rank)
  const byRank = /^(rank|official( ufc)? rank(ing)?|ufc rank(ing)?|pound for pound|p4p)$/.test(norm(rankInput))
  const m = byRank ? null : statNamed(meta, rankInput, 'to rank by')
  const rankKey = byRank ? 'rank' : m.key
  const picked = args.columns || (preset ? preset.cols : def.cols)
  const colKeys = [...new Set(picked.map((c) => statNamed(meta, c, 'for a column').key))].slice(0, 6)
  const basis = args.basis ? BASIS[args.basis] : def.basis
  const sample = args.sample ? SAMPLE[args.sample] : def.sample
  if (!basis || !sample) throw new SavantError('basis is "active" or "all_time"; sample is "settled" or "everyone".')
  const minMin = args.min_minutes || 0
  const minN = args.min_fights || 0
  let stance = ''
  if (args.stance) {
    stance = lb.stances.find((s) => s.toLowerCase() === String(args.stance).trim().toLowerCase())
    if (!stance) throw new SavantError(`The leaderboard's stance filter offers: ${lb.stances.join(', ')}.`)
  }
  const ageMin = args.age_min ?? null
  const ageMax = args.age_max ?? null
  const top = args.limit || def.top
  const reversed = !!args.reverse

  const idx = await loadIndex()
  const names = await everyFighter(meta, idx)
  // Which percentile colours the board: the fighter's own division, or every division of his
  // sex on the all-men and all-women boards (lbPct()).
  const cohort = bySex ? 'all' : 'div'
  const slot = viewSlot(meta, basis, cohort)
  const sexOf = (key) => (meta.divisions.find((d) => d.key === key) || {}).sex || 'M'
  const rankVal = (e) => (bySex ? e.p4p || null : (e.rks && e.rks[div.key] != null ? e.rks[div.key] : null))

  // lbPool()
  const pool = []
  for (const e of names) {
    const r = e.w[win]
    if (!r) continue
    if (basis === 'active' && !e.active) continue
    const ranked = byRank && rankVal(e) != null
    if (bySex) { if (sexOf(r.div) !== div.key) continue } else if (r.div !== div.key && !ranked) continue
    if (minMin && (r.dm || 0) < minMin) continue
    if (minN && r.n < minN) continue
    if (stance && e.stance !== stance) continue
    if (ageMin != null && (miss(e.age) || e.age < ageMin)) continue
    if (ageMax != null && (miss(e.age) || e.age > ageMax)) continue
    if (byRank) {
      if (rankVal(e) == null && sample === 'settled' && !r.qualified) continue
      pool.push(e)
      continue
    }
    if (!cellOf(meta, r, rankKey)) continue
    if (sample === 'settled' && (!r.qualified || rankKey in (r.low || {}))) continue
    pool.push(e)
  }
  // lbRender(): ranked fighters in official order, then everyone else by rating; or by the stat.
  const val = (e, key) => (cellOf(meta, e.w[win], key) || [null])[0]
  if (byRank) {
    pool.sort((a, b) => {
      const ra = rankVal(a), rb = rankVal(b)
      if (ra != null && rb != null) return ra - rb
      if (ra != null) return -1
      if (rb != null) return 1
      return (val(b, 'elo') || 0) - (val(a, 'elo') || 0)
    })
    if (reversed) pool.reverse()
  } else {
    pool.sort((a, b) => { const va = val(a, rankKey), vb = val(b, rankKey); return (m.lowerIsBetter ? va - vb : vb - va) * (reversed ? -1 : 1) })
  }
  const cols = (byRank ? [] : [rankKey]).concat(colKeys.filter((c) => c !== rankKey)).slice(0, 6)
  const shown = pool.slice(0, top)

  const rows = shown.map((e, i) => {
    const r = e.w[win]
    const row = {
      place: i + 1,
      id: e.id,
      name: e.name,
      division: divisionLabel(meta, r.div),
      fights: r.n,
      active: e.active,
      stats: cols.map((key) => {
        const cell = cellOf(meta, r, key)
        return { key, value: cell ? cell[0] : null, display: display(statOf(meta, key).unit, cell ? cell[0] : null), percentile: cell ? cell[slot] : null, low_sample: !!cell && key in (r.low || {}) }
      }),
    }
    if (byRank) row.ufc_rank = rankVal(e)
    return row
  })

  // The page's link to this board (lbEncode()). "Show top" is a menu, so the link asks for the
  // first of its options that shows at least as many rows.
  const n = lb.tops.find((t) => t >= top) || Math.max(...lb.tops)
  const url = `${meta.page}#lb=1&w=${win}&d=${div.key}&r=${rankKey}&n=${n}&mm=${minMin}&mn=${minN}&st=${encodeURIComponent(stance)}&a0=${ageMin ?? ''}&a1=${ageMax ?? ''}&c=${colKeys.join(',')}&disp=value&b=${basis}&s=${sample}&dir=${reversed ? 'asc' : 'desc'}`

  const label = meta.windows[win]
  const who = bySex ? (div.key === 'F' ? 'women' : 'men') : `${div.label} fighters`
  const basisWords = basis === 'active' ? `active (a UFC fight in the ${meta.activeMonths} months before ${meta.latest})` : 'all-time'
  const poolText = bySex
    ? `Each percentile is against every qualified ${basis === 'active' ? 'active ' : ''}${div.key === 'F' ? 'woman' : 'man'} in UFC history${basis === 'active' ? ` with a UFC fight in the ${meta.activeMonths} months before ${meta.latest}` : ''}, across all divisions, over the same window (the page's "${meta.cohorts.all}" cohort). ${meta.everyoneNote}`
    : `Each percentile is against the qualified ${basis === 'active' ? 'active ' : ''}fighters of that fighter's own division${basis === 'active' ? '' : ' in UFC history'}, over the same window, as the page colours it.`
  const rankWords = byRank
    ? (bySex ? `the official pound-for-pound ranking as of ${meta.rankingsAt}, then everyone else by Savant rating` : `the official UFC ranking as of ${meta.rankingsAt}, champion first, then everyone else by Savant rating`)
    : `${m.label}${m.lowerIsBetter ? ' (lower is better)' : ''}`
  const notes = [poolText]
  if (sample === 'settled') notes.push(byRank ? 'Settled sample: an unranked fighter must be qualified for the window. Ranked fighters are always in.' : `Settled sample: only fighters who are qualified for the window and whose ${m.label} sample has reached its threshold.`)
  else notes.push('Everyone: fighters below the qualifying line and thin samples are in too, flagged "thin sample".')
  if (byRank && !bySex) notes.push(`A fighter ranked at ${div.label} is listed even when ${div.label} is not the division he fought at most in the window.`)
  if (reversed) notes.push('Reversed: the page\'s column-header toggle, worst first.')

  const structured = {
    board: {
      window: { key: win, label },
      division: div,
      ranked_by: byRank ? { key: 'rank', label: bySex ? 'Pound-for-pound ranking' : 'Official UFC ranking', lower_is_better: false } : { key: m.key, label: m.label, lower_is_better: m.lowerIsBetter },
      preset: preset ? preset.name : null,
      basis: basis === 'all' ? 'all_time' : 'active',
      sample: sample === 'all' ? 'everyone' : 'settled',
      reversed,
      filters: { min_minutes: minMin, min_fights: minN, stance: stance || null, age_min: ageMin, age_max: ageMax },
    },
    total: pool.length,
    count: rows.length,
    columns: cols.map((key) => { const s = statOf(meta, key); return { key, label: s.label, lower_is_better: s.lowerIsBetter } }),
    rows,
    notes,
    url,
    data_through: meta.latest,
    data_built: day(meta.generated),
    source: SOURCE,
  }

  const filters = [
    minMin ? `${minMin}+ minutes of cage time in the window` : null,
    minN ? `${minN}+ UFC fights in the window` : null,
    stance ? `${stance} stance` : null,
    ageMin != null || ageMax != null ? `age ${ageMin ?? ''}${ageMax != null ? `-${ageMax}` : '+'}` : null,
  ].filter(Boolean)
  const L = [
    `UFC Savant leaderboard: ${div.label}, ${lowerFirst(label)}, ${basisWords}, ${sample === 'settled' ? 'settled samples only' : 'everyone'}${preset ? ` (preset "${preset.name}")` : ''}.`,
    `Ranked by ${rankWords}${reversed ? ', reversed' : ''}.${filters.length ? ` Filters: ${filters.join(', ')}.` : ''} ${thousands(pool.length)} fighter${pool.length === 1 ? '' : 's'} pass${pool.length === 1 ? 'es' : ''}; showing ${rows.length}.`,
    '',
  ]
  if (!rows.length) L.push('Nobody clears these filters. Loosen the sample or the cage-time floor.')
  const pct = (p) => (p == null ? 'n/a' : ordinal(p))
  for (const r of rows) {
    const cells = r.stats.map((s) => `${statOf(meta, s.key).label} ${s.display}${s.value == null ? '' : ` (${pct(s.percentile)})`}${s.low_sample ? ' [thin sample]' : ''}`)
    L.push(`${r.place}. ${byRank ? `${ranking(r.ufc_rank)} ` : ''}${r.name} (id ${r.id}), ${r.division}, ${r.fights} fight${r.fights === 1 ? '' : 's'}${r.active ? '' : ', inactive'}: ${cells.join('; ')}`)
  }
  L.push('', ...notes, 'Values print as the page prints them; the number in brackets is the percentile.', '', `Page: ${url}`, `Source: ${SOURCE}. Data through ${meta.latest}, built ${structured.data_built}.`)
  return { structured, text: L.join('\n') }
}

// ---- head-to-head --------------------------------------------------------------------

const eloProb = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400))   // the page's eloProb()

export async function ufcMatchup({ fighter_a, fighter_b, window, basis }) {
  const meta = await loadMeta()
  const win = window || meta.matchup.window
  if (!meta.windows[win]) throw new SavantError(`UFC Savant has no "${win}" window. Use one of: ${Object.entries(meta.windows).map(([k, label]) => `${k} (${label})`).join(', ')}.`)
  const base = basis ? BASIS[basis] : meta.matchup.basis
  if (!base) throw new SavantError('basis is "active" or "all_time".')
  const [whoA, whoB] = [await resolveFighter(fighter_a, meta), await resolveFighter(fighter_b, meta)]
  if (whoA.id === whoB.id) throw new SavantError(`Both corners are ${whoA.name}. Pick two different fighters.`)
  const idx = await loadIndex()
  const [A, B] = [await fighterRow(meta, idx, whoA.id), await fighterRow(meta, idx, whoB.id)]
  const [ra, rb] = [A.w[win], B.w[win]]
  if (!ra || !rb) throw new SavantError(`UFC Savant has no ${meta.windows[win]} numbers for ${!ra ? A.name : B.name} right now. Try again in a minute.`)
  // The head-to-head ranks in the page's starting cohort (his own division): it has no cohort switch.
  const slot = viewSlot(meta, base, meta.defaults.cohort)
  const label = meta.windows[win]

  const pa = eloProb(cellOf(meta, ra, 'elo')?.[0] || 1500, cellOf(meta, rb, 'elo')?.[0] || 1500)
  const best = (e) => { let b = null; for (const [d, n] of Object.entries(e.rks || {})) if (b == null || n < b.n) b = { div: d, n }; return b }
  const side = (e, r) => {
    const rk = best(e)
    const v = (key) => (cellOf(meta, r, key) || [null])[0]
    return {
      id: e.id,
      name: e.name,
      nickname: e.nick || null,
      division: divisionLabel(meta, r.div),
      pro_record: e.rec ? `${e.rec[0]}-${e.rec[1]}${e.rec[2] ? `-${e.rec[2]}` : ''}` : null,
      ufc_rank: rk ? { division: divisionLabel(meta, rk.div), rank: rk.n, text: ranking(rk.n) } : null,
      days_as_champion: v('beltdays') || 0,
      title_defenses: v('defenses') || 0,
      rating: Math.round(v('elo') || 1500),
      age: e.age ?? null,
      height: miss(e.ht) ? null : feetInches(e.ht),
      reach_inches: e.reach ?? null,
      stance: e.stance || null,
      fights_in_window: r.n,
      last_ufc_fight: e.last,
      url: fighterUrl(meta, e.id, win),
    }
  }
  const a = side(A, ra)
  const b = side(B, rb)

  // renderMatchup()'s rows: every stat in the page's order, less the context rows it leaves out
  // and any stat neither side has.
  const rows = []
  for (const key of meta.cells) {
    const m = statOf(meta, key)
    if (m.group === 'ctx' && meta.matchup.skip.includes(key)) continue
    const ca = cellOf(meta, ra, key), cb = cellOf(meta, rb, key)
    if (!ca && !cb) continue
    const one = (cell, r) => ({ value: cell ? cell[0] : null, display: display(m.unit, cell ? cell[0] : null), percentile: cell ? cell[slot] : null, low_sample: key in (r.low || {}) })
    const x = one(ca, ra), y = one(cb, rb)
    rows.push({
      key,
      label: m.label,
      group: meta.groupLabels[m.group] || m.group,
      tag: m.layer || null,
      lower_is_better: m.lowerIsBetter,
      a: x,
      b: y,
      edge: x.percentile != null && y.percentile != null && x.percentile !== y.percentile ? (x.percentile > y.percentile ? 'a' : 'b') : null,
    })
  }

  const people = (r) => peers(meta, r.div)
  const size = (r) => (((meta.pools[win] || {})[base] || {}).div || {})[r.div] || 0
  const basisWords = base === 'all' ? 'all-time' : 'active'
  const notes = [
    `Each side is ranked inside ${ra.div === rb.div ? 'the same division' : 'his own division'} over each fighter's own ${lowerFirst(label)}, against ${base === 'all' ? 'every qualified fighter of it in UFC history' : `the qualified fighters of it with a UFC fight in the ${meta.activeMonths} months before ${meta.latest}`}: ${basisWords} ${people(ra)} (${thousands(size(ra))})${ra.div === rb.div ? '' : ` and ${basisWords} ${people(rb)} (${thousands(size(rb))})`}. So fighters of different weights compare on percentiles, not raw numbers.`,
    'The win probability is implied only by the two Savant (Elo) ratings: it knows who they beat, not how the styles interact. Use the rows for that.',
    '"edge" marks the better percentile, as the page marks it in gold. Lower-is-better stats are already flipped.',
  ]
  for (const [e, r] of [[A, ra], [B, rb]]) {
    if (!r.qualified) notes.push(`${e.name} is below the qualifying line for the window (${meta.qualify[win][0]} fights, ${meta.qualify[win][1]} minutes), so is ranked against the pool but not part of it.`)
    if (!e.active) notes.push(`${e.name} is inactive: no UFC fight in the ${meta.activeMonths} months before ${meta.latest}.`)
  }
  if (rows.some((r) => r.a.low_sample || r.b.low_sample)) notes.push('"thin sample" marks a row where either side is under the sample the stat needs.')
  const url = meta.matchupUrl.replace('{a}', encodeURIComponent(A.id)).replace('{b}', encodeURIComponent(B.id)).replace('{window}', win)
  const structured = {
    window: { key: win, label },
    basis: base === 'all' ? 'all_time' : 'active',
    fighters: [a, b],
    win_probability: { a_pct: Math.round(pa * 100), b_pct: Math.round((1 - pa) * 100), a: Math.round(pa * 1000) / 1000 },
    rows,
    notes,
    url,
    data_through: meta.latest,
    data_built: day(meta.generated),
    source: SOURCE,
  }

  const pct = (p) => (p == null ? 'n/a' : ordinal(p))
  const reign = (s) => (s.days_as_champion ? `${span(s.days_as_champion)}, ${s.title_defenses} def` : '—')
  const rk = (s) => (s.ufc_rank ? `${s.ufc_rank.text}${s.ufc_rank.division !== s.division ? ` ${s.ufc_rank.division}` : ''}` : '—')
  const L = [
    `${a.name} vs. ${b.name}: UFC Savant head-to-head, ${lowerFirst(label)}, ${basisWords} pools.`,
    `Rating-implied win probability: ${a.name} ${structured.win_probability.a_pct}%, ${b.name} ${structured.win_probability.b_pct}%.`,
    '',
    'Tale of the tape (first | second):',
    `- Division: ${a.division} | ${b.division}`,
    `- Pro record: ${a.pro_record || '—'} | ${b.pro_record || '—'}`,
    `- UFC rank (as of ${meta.rankingsAt}): ${rk(a)} | ${rk(b)}`,
    `- Time as champion: ${reign(a)} | ${reign(b)}`,
    `- Savant rating: ${a.rating} | ${b.rating}`,
    `- Age: ${a.age ?? '—'} | ${b.age ?? '—'}; height ${a.height || '—'} | ${b.height || '—'}; reach ${a.reach_inches == null ? '—' : `${a.reach_inches}"`} | ${b.reach_inches == null ? '—' : `${b.reach_inches}"`}; stance ${a.stance || '—'} | ${b.stance || '—'}`,
    `- UFC fights in the window: ${a.fights_in_window} | ${b.fights_in_window}; last UFC fight ${a.last_ufc_fight} | ${b.last_ufc_fight}`,
  ]
  let heading = null
  for (const r of rows) {
    if (r.group !== heading) { L.push('', r.group); heading = r.group }
    const edge = r.edge ? `, edge ${r.edge === 'a' ? a.name : b.name}` : ''
    L.push(`- ${r.label}: ${r.a.display} (${pct(r.a.percentile)}) | ${r.b.display} (${pct(r.b.percentile)})${edge}${r.lower_is_better ? ' [lower is better]' : ''}${r.a.low_sample || r.b.low_sample ? ' [thin sample]' : ''}`)
  }
  L.push('', ...notes, '', `Page: ${url}`, `Source: ${SOURCE}. Data through ${meta.latest}, built ${structured.data_built}.`)
  return { structured, text: L.join('\n') }
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
const comp = z.object({ id: z.string().nullable(), name: z.string(), division: z.string(), active: z.boolean(), score: z.number() })
const side = z.object({ value: z.number().nullable(), display: z.string(), percentile: pct, low_sample: z.boolean() })
const fight = z.object({
  date: z.string(),
  result: z.string().describe('W, L, D or NC.'),
  opponent: z.string(),
  opponent_id: z.string().nullable(),
  method: z.string().nullable(),
  round: z.number().nullable().describe('The round the fight ended in.'),
  time: z.string().nullable().describe('Time into that round, minutes:seconds.'),
  bout: z.string().nullable().describe('Weight class or title, as ufcstats.com lists the bout.'),
  title_bout: z.boolean().describe('The page\'s TITLE tag.'),
  event: z.string().nullable(),
  bonuses: z.array(z.string()),
  sig_strikes_landed: z.number().nullable(),
  sig_strikes_absorbed: z.number().nullable(),
  knockdowns: z.number().nullable(),
  takedowns: z.number().nullable(),
  control: z.string().nullable().describe('Control time, minutes:seconds.'),
  opponent_rating: z.number().nullable().describe('The opponent\'s Savant rating going in.'),
})

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
        'Get one UFC fighter\'s UFC Savant profile (wcehoops.com) over a window of UFC fights: career, last 5 or last 3. Returns records, measurements, official ranking, and every stat the page draws with its value and two percentiles (active fighters, and all of UFC history), inside the fighter\'s division for that window or, with cohort "everyone", across every division of that sex. Also the 5 latest fights and title reigns. Group "style" gives Fights like, Where he can be beaten, the strike map and the round curve; group "fights" the whole fight log. Low samples, untracked stats and unqualified fighters are flagged. Includes the page link and the data date.',
      inputSchema: {
        fighter: z.string().trim().min(1).max(80).describe('Fighter id from ufc_search_fighters (16 hex characters) or a name or nickname (e.g. "Islam Makhachev"). If a name fits more than one fighter, the error lists their ids.'),
        window: z.enum(WINDOWS).default('career').describe('"career" for the whole UFC career (default), "l5" for the last 5 UFC fights, "l3" for the last 3.'),
        group: z.enum(['all', ...Object.keys(GROUPS), ...EXTRA_GROUPS]).default('all').describe('"all" (default: every stat, recent fights, title reigns); one panel with each stat explained: "context", "striking", "grappling", "finishing" or "rounds"; "style" (comps, weaknesses, strike map, round curve); or "fights" (every UFC fight).'),
        cohort: z.enum(Object.keys(COHORT)).default('division').describe('Who the percentiles are against: "division" (default, the page\'s opening view) or "everyone" (every division of the fighter\'s sex, the page\'s Everyone cohort).'),
      },
      outputSchema: {
        fighter: z.object({
          id: z.string(),
          name: z.string(),
          nickname: z.string().nullable(),
          division: z.string().describe('The weight class fought at most in this window.'),
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
        cohort: z.enum(Object.keys(COHORT)),
        pools: z.object({
          active: z.object({ label: z.string(), size: z.number().int() }).describe('Qualified fighters of the cohort with a UFC fight in the last 24 months.'),
          all_time: z.object({ label: z.string(), size: z.number().int() }).describe('Qualified fighters of the cohort in UFC history.'),
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
        style: z.object({
          fights_like: z.array(comp).describe('Style similarity 0-100 inside the division and window.'),
          weakest: z.array(z.object({ key: z.string(), label: z.string(), percentile: z.number() })),
          shares_weaknesses: z.array(comp),
          strike_map: z.record(z.string(), z.object({ landed: z.number(), attempted: z.number(), accuracy_pct: z.number().nullable(), share_pct: z.number(), absorbed: z.number(), absorbed_share_pct: z.number() })).nullable().describe('Significant strikes by target (head, body, legs) and position (distance, clinch, ground).'),
          round_curve: z.array(z.object({ round: z.number().int(), landed_per_min: z.number(), absorbed_per_min: z.number(), minutes: z.number() })),
          late_fight_index: z.number().nullable(),
        }).optional().describe('Group "style" only.'),
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
        recent_fights: z.array(fight).optional().describe('The 5 most recent UFC fights, newest first.'),
        fight_log: z.array(fight).optional().describe('Group "fights": every UFC fight, newest first.'),
        notes: z.array(z.string()).describe('How to read the numbers: what the pools are, and every caution that applies to this fighter.'),
        url: z.string().describe('The fighter\'s UFC Savant page, opened on this window.'),
        data_through: z.string().describe('Date of the latest UFC event in the data. Active status and age are counted from it.'),
        data_built: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get a UFC fighter\'s Savant profile', ...READ_ONLY },
    },
    run: ({ fighter, window, group, cohort }) => fighterProfile({ fighter, window, group, cohort }),
  },
  {
    name: 'ufc_leaderboard',
    config: {
      title: 'UFC Savant leaderboard',
      description:
        'Rank UFC fighters as the UFC Savant leaderboard (wcehoops.com) does: one division, or all men or all women, over a window (career, last 5, last 3), by the official UFC ranking (pound-for-pound for all men or women) or by any stat, with the page\'s presets and filters (cage minutes, fights, stance, age), active or all-time fighters, settled samples or everyone. Returns up to 6 stat columns per fighter with values as the page prints them and the percentile the page colours each by (own division, or every division of that sex), thin samples flagged, how many pass, the page link and the data date.',
      inputSchema: {
        preset: z.enum(PRESETS).optional().describe('One of the page\'s presets, which sets rank_by and columns.'),
        window: z.enum(WINDOWS).optional().describe('"career" (default), "l5" (last 5 fights) or "l3" (last 3).'),
        division: z.string().trim().min(1).max(40).optional().describe('Division name or key ("Lightweight", "LW"; default LW), or "men" or "women" for every division of that sex.'),
        rank_by: z.string().trim().min(1).max(60).optional().describe('"rank" (official ranking, default) or a stat key or label, e.g. "slpm". Overrides the preset.'),
        columns: z.array(z.string().trim().min(1).max(60)).min(1).max(6).optional().describe('Stat keys or labels beside the ranking stat, 6 columns in all. Default: the preset\'s, else the page\'s.'),
        basis: z.enum(Object.keys(BASIS)).optional().describe('"active" (default): a UFC fight in the last 24 months; "all_time": all of UFC history.'),
        sample: z.enum(Object.keys(SAMPLE)).optional().describe('"settled" (default): qualified, with enough sample in the ranking stat; or "everyone".'),
        reverse: z.boolean().optional().describe('Flip the order, worst first. Default false.'),
        min_minutes: z.number().min(0).max(600).optional().describe('Minimum cage minutes in the window.'),
        min_fights: z.number().int().min(0).max(50).optional().describe('Minimum UFC fights in the window.'),
        stance: z.string().trim().min(1).max(20).optional().describe('Orthodox, Southpaw or Switch. Default any.'),
        age_min: z.number().int().min(15).max(60).optional().describe('Minimum age; a fighter with no age is left out.'),
        age_max: z.number().int().min(15).max(60).optional().describe('Maximum age; a fighter with no age is left out.'),
        limit: z.number().int().min(1).max(100).optional().describe('Most rows (1-100, default 25).'),
      },
      outputSchema: {
        board: z.object({
          window: z.object({ key: z.string(), label: z.string() }),
          division: z.object({ key: z.string(), label: z.string() }).describe('M and F are all men and all women.'),
          ranked_by: z.object({ key: z.string(), label: z.string(), lower_is_better: z.boolean() }),
          preset: z.string().nullable(),
          basis: z.string(),
          sample: z.string(),
          reversed: z.boolean(),
          filters: z.object({ min_minutes: z.number(), min_fights: z.number(), stance: z.string().nullable(), age_min: z.number().nullable(), age_max: z.number().nullable() }),
        }),
        total: z.number().int().describe('Fighters who pass the filters.'),
        count: z.number().int(),
        columns: z.array(z.object({ key: z.string(), label: z.string(), lower_is_better: z.boolean() })),
        rows: z.array(z.object({
          place: z.number().int(),
          id: z.string(),
          name: z.string(),
          division: z.string().describe('Division in the window.'),
          fights: z.number().int().describe('UFC fights in the window.'),
          active: z.boolean(),
          ufc_rank: z.number().nullable().optional().describe('When ranked by ranking: 0 champion, 0.5 interim, else the number; null if unranked.'),
          stats: z.array(z.object({ key: z.string(), value: z.number().nullable(), display: z.string(), percentile: pct, low_sample: z.boolean() })),
        })),
        notes: z.array(z.string()).describe('The percentile pool and what the filters mean.'),
        url: z.string().describe('The page\'s leaderboard with these settings.'),
        data_through: z.string(),
        data_built: z.string(),
        source: z.string(),
      },
      annotations: { title: 'UFC Savant leaderboard', ...READ_ONLY },
    },
    run: (args) => ufcLeaderboard(args),
  },
  {
    name: 'ufc_matchup',
    config: {
      title: 'UFC Savant head-to-head',
      description:
        'Compare two UFC fighters as UFC Savant\'s head-to-head view does (wcehoops.com): the tale of the tape (record, official rank, time as champion, Savant rating, age, height, reach, stance), the win probability implied by the two Savant (Elo) ratings, and every stat side by side with values as the page prints them and each fighter\'s percentile inside his own division over the window, against active or all-time fighters, the better percentile marked and thin samples flagged. Includes the page link and the data date.',
      inputSchema: {
        fighter_a: z.string().trim().min(1).max(80).describe('First fighter: id from ufc_search_fighters or a name. A name that fits several fighters returns their ids.'),
        fighter_b: z.string().trim().min(1).max(80).describe('Second fighter, the same way.'),
        window: z.enum(WINDOWS).optional().describe('"l5" (last 5 fights, the default), "career" or "l3".'),
        basis: z.enum(Object.keys(BASIS)).optional().describe('"active" (default) or "all_time": who each percentile is against.'),
      },
      outputSchema: {
        window: z.object({ key: z.string(), label: z.string() }),
        basis: z.string(),
        fighters: z.array(z.object({
          id: z.string(),
          name: z.string(),
          nickname: z.string().nullable(),
          division: z.string().describe('Division in the window; the percentiles are inside it.'),
          pro_record: z.string().nullable().describe('Wins-losses(-draws), as the page shows it.'),
          ufc_rank: z.object({ division: z.string(), rank: z.number(), text: z.string() }).nullable().describe('Best official ranking: C champion, IC interim.'),
          days_as_champion: z.number(),
          title_defenses: z.number(),
          rating: z.number().int().describe('Savant (Elo) rating in the window.'),
          age: z.number().nullable(),
          height: z.string().nullable(),
          reach_inches: z.number().nullable(),
          stance: z.string().nullable(),
          fights_in_window: z.number().int(),
          last_ufc_fight: z.string().nullable(),
          url: z.string(),
        })).describe('[first, second].'),
        win_probability: z.object({ a_pct: z.number().int(), b_pct: z.number().int(), a: z.number().describe('First fighter, 0-1.') }).describe('Implied by the two ratings only.'),
        rows: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          tag: z.string().nullable(),
          lower_is_better: z.boolean(),
          a: side,
          b: side,
          edge: z.enum(['a', 'b']).nullable().describe('The better percentile.'),
        })),
        notes: z.array(z.string()),
        url: z.string().describe('The page\'s head-to-head for these two, on this window.'),
        data_through: z.string(),
        data_built: z.string(),
        source: z.string(),
      },
      annotations: { title: 'UFC Savant head-to-head', ...READ_ONLY },
    },
    run: ({ fighter_a, fighter_b, window, basis }) => ufcMatchup({ fighter_a, fighter_b, window, basis }),
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
