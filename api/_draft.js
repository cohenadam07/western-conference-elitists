// api/_draft.js — Draft Savant, as answers. One section of the AI connector (api/mcp.js): it
// knows the draft page, the connector only speaks the protocol.
//
// It reads the small files the build writes under /savant-api/draft/v1/ (see
// scripts/lib/savant-api-draft.mjs): a glossary, a prospect index, and one file per draft
// class in which every stat already carries its percentile in each of the page's six pools.
// Nothing is computed here that the page computes — percentiles are read, never re-derived —
// so an answer from this file is the number on the prospect's card. Loading, caching and name
// matching are shared with the other sections and live in api/_core.js.
//
// This is COLLEGE AND PRE-DRAFT data. It is a different thing from Basketball Savant
// (api/_basketball.js, nba_*), which is NBA seasons; the tool names here start nba_draft_.
//
// WHAT AN ANSWER ALWAYS SAYS
//   - which pool a percentile is from, on every line, and how many prospects in that pool
//     actually have the stat: the page's default pool is his own draft class, but its two
//     controls can narrow it to his position or his age, or swap in the pooled past drafts
//   - where the data comes from, in its own words: a compiled file, partly transcribed by
//     hand, and it says so
//   - what is missing: a stat with no value is listed as missing, never shown as zero, and
//     the answer separates "missing for him" from "nobody in his class has it"
//   - that the current class is "Projected" on the page, so its pick is not a draft result
//   - that the page's "Draft-day age" is really his age on February 1 of the draft year,
//     when the build has confirmed that against the data
//
// WHAT IT LEAVES OUT: birth dates, the page's written scouting takes and its "Predictive
// signals" panel. It reports what the page measures and adds no opinion about anyone's
// draft prospects.
//
// ONE DELIBERATE DIFFERENCE FROM THE PAGE: heights. The page rounds the inches after taking
// the feet, so 83.5 inches prints as 6'12". Here that is 7'0", the same height written
// properly.
//
// THE PAGE HAS NO LINK THAT OPENS ONE PROSPECT (it always starts on its home screen), so an
// answer links to the page itself and says so.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError, makeLoader, miss, ordinal, prepare, rank, topTier } from './_core.js'

// Every file of this section is small, and there is one per draft class. The loader keeps
// them all, with room for classes to come, so the glossary is never pushed out by a run of
// questions about different years.
const files = makeLoader('savant-api/draft/v1', { what: 'Draft Savant', maxCached: 40 })

// The tools' words for the page's two controls and three columns, and the page's own values.
export const COMPARE = { all: 'all', position: 'pos', age: 'age' }
export const POOL = { class: 'class', past: 'past5' }
export const GROUPS = { context: 'ctx', offense: 'off', defense: 'def' }
const PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }
const SOURCE = 'Draft Savant, Western Conference Elitists (wcehoops.com)'

const loadMeta = () => files.load('meta.json')
const loadClass = (year) => files.load(`classes/${year}.json`)

// The prospect index, with each name prepared for matching once per load.
const prepared = new WeakMap()
async function loadProspects() {
  const file = await files.load('prospects.json')
  let rows = prepared.get(file)
  if (!rows) { rows = prepare(file.prospects); prepared.set(file, rows) }
  return rows
}

// Among equally good name matches: the more recent class, then the higher pick.
const recent = (a, b) => b.year - a.year || a.pick - b.pick

// ---- small formatting helpers ----------------------------------------------------------

// Feet and inches. The page prints 83.5 as 6'12"; this carries the twelve (see the header).
export function feetInches(n) {
  let feet = Math.floor(n / 12)
  let inches = Math.round(n - feet * 12)
  if (inches === 12) { feet++; inches = 0 }
  return `${feet}'${inches}"`
}

// A stat's value the way the page prints it (its fmt()), with two additions: the height fix
// above, and "lb" after a weight, which the page prints as a bare number.
export function display(unit, v) {
  if (miss(v)) return '—'
  switch (unit) {
    case 'pct3': return '.' + String(Math.round(v * 1000)).padStart(3, '0')
    case 'pct1': return (+v).toFixed(1) + '%'
    case 'num1': return (+v).toFixed(1)
    case 'ftin': return feetInches(v)
    case 'lb': return `${Math.round(v)} lb`
    case 'inch': return (+v).toFixed(1) + '"'
    default: return String(v)
  }
}

const one = (v) => (miss(v) ? '—' : (+v).toFixed(1))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// "Projected No. 1 · Washington Wizards" or "2015 · No. 4 · New York Knicks": the page's badge.
const badge = (r, projected) => `${projected ? 'Projected ' : `${r.year} · `}No. ${r.pick}${r.team ? ` · ${r.team}` : ''}`

// The same fact as a sentence. Only a past class is called drafted.
const drafted = (r, projected) => (projected
  ? `${r.year} class: projected No. ${r.pick}${r.team ? `, ${r.team}` : ''}`
  : `Drafted No. ${r.pick} in ${r.year}${r.team ? ` by ${r.team}` : ''}`)

const where = (r) => r.college || 'no college or pre-draft team listed'

// Where the numbers come from, in plain words and then in the data's own. The plain words are
// read off the file's own tag and note, so they change when those do.
function provenance(meta) {
  const fixed = /hardcoded/i.test(meta.source || '')
  const byHand = /transcrib|by hand|manual/i.test(meta.note || '')
  const what = `${fixed ? 'a fixed data file compiled by WCE' : 'a data file compiled by WCE'}${byHand ? ', some of it transcribed by hand' : ''}`
  const tag = meta.source ? ` (the file is tagged "${meta.source}")` : ''
  const note = meta.note ? ` Its own note reads: "${String(meta.note).replace(/\.\s*$/, '')}".` : ''
  return `Provenance: this is ${what}, not a live or official feed${tag}.${note} Read these as WCE's compiled pre-draft figures, not official statistics.`
}

// "the 2026 class and first-round picks of the 2010 to 2025 drafts"
function coverage(meta) {
  const years = meta.past.years
  if (!years.length) return `the ${meta.currentClass} class`
  const span = years.length > 1 ? `${years[0]} to ${years[years.length - 1]} drafts` : `${years[0]} draft`
  return `the ${meta.currentClass} class and ${meta.past.firstRoundOnly ? 'first-round picks' : 'picks'} of the ${span}`
}

const projectedNote = (year) => `The page shows the ${year} class as "Projected": the pick and team are what the page lists, not a confirmed draft result.`
const linkNote = (meta) => `Page: ${meta.page} (it has no link that opens one prospect; search his name there).`

// ---- finding the prospect --------------------------------------------------------------

const candidateLine = (r, meta) => `${r.name} (id ${r.id}): ${r.pos}, ${where(r)}, ${drafted(r, r.year === meta.currentClass).replace(/^D/, 'd')}`

// An id ("dybantsa", "john-wall-2010") or a name. A name has to land on one prospect; when
// it lands on several they are listed, so the caller can pick by id. Some of the page's ids
// are a bare surname ("barnes" is Scottie Barnes), so an id match also reports anyone else
// the same word could have meant.
//
// A near miss is never taken for a hit. The page holds one draft class and the first rounds
// before it, so plenty of well-known players are simply not here, and the closest spelling
// to a missing player is somebody else: "Nikola Jokic" is one letter from Nikola Jović. A
// name that only matches as a typo or a fragment is answered with the closest names, not
// with one of their profiles.
async function resolveProspect(input, meta) {
  const rows = await loadProspects()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give a prospect name or id.')

  const ranked = rank(rows, raw, recent)
  const byId = rows.find((r) => r.id === raw)
  if (byId) return { row: byId, namesakes: ranked.filter((r) => r.row.id !== byId.id && r.score >= 75).map((r) => r.row) }

  const scope = `Draft Savant covers ${coverage(meta)}`
  if (!ranked.length) {
    const what = /^[a-z0-9]+([_-][a-z0-9]+)+$/.test(raw) ? `No prospect has the id "${raw}"` : `No prospect matches "${raw}"`
    throw new SavantError(`${what}. ${scope}. Check the spelling, or search with nba_draft_search_prospects.`)
  }

  const top = ranked[0].score
  const best = topTier(ranked)
  // One clear answer: the only prospect at the top, matched on whole words or a prefix.
  if (best.length === 1 && top >= 60) return { row: best[0], namesakes: [] }

  const list = best.slice(0, 12)
  const lines = list.map((r) => `- ${candidateLine(r, meta)}`).join('\n')
  const more = best.length > list.length ? `\n(${best.length - list.length} more: search with nba_draft_search_prospects.)` : ''
  if (top >= 60) throw new SavantError(`${best.length} prospects match "${raw}". Call again with one of these ids:\n${lines}${more}`)
  throw new SavantError(`No prospect is named "${raw}". The closest ${best.length === 1 ? 'name is' : 'names are'}:\n${lines}${more}\nCall again with an id only if that is who is meant. ${scope}, so a player picked outside it is not here.`)
}

// ---- search --------------------------------------------------------------------------

// A name that matched only as a near spelling (a typo's distance away) is marked as such:
// it may be the prospect who was meant, or a different person altogether.
const CLOSE = 50

export async function searchProspects({ query, limit = 10 }) {
  const meta = await loadMeta()
  const rows = await loadProspects()
  const ranked = rank(rows, query, recent)
  const shown = ranked.slice(0, limit).map(({ row, score }) => ({
    id: row.id,
    name: row.name,
    position: row.pos,
    college: row.college,
    draft_year: row.year,
    pick: row.pick,
    team: row.team,
    projected: row.year === meta.currentClass,
    close_match: score < CLOSE,
    url: meta.page,
  }))

  const close = shown.filter((p) => p.close_match).length
  const notes = ['Draft Savant holds college and other pre-draft data, not NBA stats.']
  if (close) notes.push(`A close spelling can be a different person. Draft Savant covers ${coverage(meta)}, so a player picked outside it is not here.`)
  if (shown.some((p) => p.projected)) notes.push(projectedNote(meta.currentClass))
  notes.push(provenance(meta))
  const structured = { query, total: ranked.length, count: shown.length, prospects: shown, notes, url: meta.page, source: SOURCE }

  if (!shown.length) {
    const text = `No prospect in Draft Savant matches "${query}". It covers ${coverage(meta)}. Check the spelling or try the last name alone.\n${notes[notes.length - 1]}`
    return { structured, text }
  }
  const more = ranked.length > shown.length ? `, showing the first ${shown.length}` : ''
  let head
  if (close === shown.length) head = `No prospect's name matches "${query}" as typed. The closest ${ranked.length === 1 ? 'spelling is' : `spellings are${more}`}:`
  else head = ranked.length === 1 ? `1 prospect matches "${query}":` : `${ranked.length} prospects match "${query}"${more}:`
  const lines = shown.map((p, i) => `${i + 1}. ${p.name} (id ${p.id}): ${p.position}, ${where(p)}. ${drafted({ year: p.draft_year, pick: p.pick, team: p.team }, p.projected)}.${p.close_match && close !== shown.length ? ' [close spelling only]' : ''}`)
  return { structured, text: [head, ...lines, '', ...notes, linkNote(meta)].join('\n') }
}

// ---- the pool --------------------------------------------------------------------------

// Who the percentiles are against, three ways: a full sentence, a few words for each stat
// line, and the number of prospects in it.
function describePool(meta, cls, row, field, cohort) {
  const index = meta.pools.findIndex((p) => p.field === field && p.cohort === cohort)
  const size = row.sizes[index]
  const peers = PEERS[row.pos] || `${String(row.pos || 'same-position').toLowerCase()}s`
  const age = row.m.age ? row.m.age[0] : null
  // The page ranks a prospect with no age against the whole field, and says so.
  const ageless = cohort === 'age' && age == null
  const narrow = ageless ? 'all' : cohort

  let whole
  let brief
  let people = 'players'
  if (field === 'past5') {
    const years = meta.past.years
    const span = years.length > 1 ? `${years[0]} to ${years[years.length - 1]}` : `${years[0]}`
    const tag = years.length > 1 ? `${years[0]}-${String(years[years.length - 1]).slice(2)}` : `${years[0]}`
    const first = meta.past.firstRoundOnly
    whole = `${first ? 'first-round picks' : 'players'} from the ${span} draft${years.length > 1 ? 's' : ''}`
    brief = narrow === 'pos' ? `${tag} ${first ? 'first-round ' : ''}${peers}` : `${tag} ${first ? 'first-rounders' : 'draftees'}`
  } else if (cls.projected) {
    people = 'prospects'
    whole = `the ${cls.year} draft class as the page lists it`
    brief = narrow === 'pos' ? `${cls.year}-class ${peers}` : `the ${cls.year} class`
  } else {
    const first = cls.picks[1] <= meta.firstRound
    whole = first ? `the ${cls.year} first round` : `the ${cls.year} draft class`
    brief = narrow === 'pos' ? `${cls.year} ${first ? 'first-round ' : ''}${peers}` : `the ${cls.year} ${first ? 'first round' : 'class'}`
  }

  const n = plural(size, people.slice(0, -1))
  const band = `${meta.ageBand} year${meta.ageBand === 1 ? '' : 's'}`
  let label
  if (ageless) label = `He has no age on file, so the page ranks each stat against all of ${whole}: ${n}.`
  else if (cohort === 'pos') label = `Percentiles rank each stat against the ${peers} among ${whole}: ${n}.`
  else if (cohort === 'age') label = `Percentiles rank each stat against those among ${whole} whose age is within ${band} of his (${one(age)}): ${n}.`
  else label = `Percentiles rank each stat against ${whole}: ${n}, all positions.`
  if (cohort === 'age' && !ageless) brief += ' near his age'

  const isDefault = field === 'class' && cohort === 'all'
  const view = isDefault
    ? 'This is the page\'s default view.'
    : `On the page this is "${meta.cohorts[cohort]}" under Compare against, with "${meta.fields[field]}" under Pool.`
  return { index, size, people, label: `${label} ${view}`, short: `vs. ${brief}`, isDefault }
}

// ---- profile -------------------------------------------------------------------------

export async function prospectProfile({ prospect, compare = 'all', pool = 'class', group = 'all' }) {
  const meta = await loadMeta()
  const { row: who, namesakes } = await resolveProspect(prospect, meta)
  const cls = await loadClass(who.year)
  const row = cls.players.find((p) => p.id === who.id)
  // The index and the class file come from one build; a deploy in progress can split them.
  if (!row) throw new SavantError(`Draft Savant's files are being refreshed and disagree about ${who.name}. Try again in a few minutes.`)

  const field = POOL[pool]
  const cohort = COMPARE[compare]
  const p = describePool(meta, cls, row, field, cohort)
  const counts = meta.pools.length
  const groupKey = group === 'all' ? null : GROUPS[group]
  const unconfirmed = new Set(row.unconfirmed || [])

  const stats = []
  const missing = []
  const notTracked = []
  for (const m of meta.metrics) {
    if (groupKey && m.group !== groupKey) continue
    const cell = row.m[m.key]
    if (!cell) {
      const inEra = (m.validFrom == null || cls.year >= m.validFrom) && (m.validTo == null || cls.year <= m.validTo)
      if (!inEra) notTracked.push({ key: m.key, label: m.label })
      else missing.push({ key: m.key, label: m.label, whole_class: !cls.have[m.key] })
      continue
    }
    const stat = {
      key: m.key,
      label: m.label,
      group: meta.groups[m.group] || m.group,
      subgroup: m.sub || null,
      kind: m.layer || null,
      value: cell[0],
      display: display(m.unit, cell[0]),
      percentile: cell[1 + p.index],
      ranked: cell[1 + counts + p.index],
      lower_is_better: m.lowerIsBetter,
    }
    if (unconfirmed.has(m.key)) stat.source_unconfirmed = true
    if (m.key === 'bpm' && row.torvik != null) stat.alternate = { source: 'Torvik', value: row.torvik, display: (+row.torvik).toFixed(1) }
    if (m.key === 'sos' && row.sosAsOf) stat.as_of = row.sosAsOf
    stats.push(stat)
  }

  // The five measurements in the page's header.
  const meas = row.meas || {}
  const measures = [
    ['height', 'height_in', meas.height, 'ftin'],
    ['wingspan', 'wingspan_in', meas.wing, 'ftin'],
    ['reach', 'standing_reach_in', meas.reach, 'ftin'],
    ['max vert', 'max_vertical_in', meas.vert, 'inch'],
    ['weight', 'weight_lb', meas.weight, 'lb'],
  ]

  const structured = {
    prospect: {
      id: row.id,
      name: row.name,
      college: row.college,
      conference: row.conf,
      position: row.pos,
      archetype: row.arch,
      games: row.gp,
      reduced_sample: !!row.thin,
    },
    draft: { year: cls.year, pick: row.pick, team: row.team, projected: cls.projected, label: badge({ ...row, year: cls.year }, cls.projected) },
    per_game: row.line
      ? { points: row.line.ppg, rebounds: row.line.rpg, assists: row.line.apg, turnovers: row.line.tpg }
      : null,
    measurements: Object.fromEntries(measures.map(([, key, v]) => [key, miss(v) ? null : v])),
    pool: { compare, pool, label: p.label, short_label: p.short, size: p.size, page_default: p.isDefault },
    stats,
    missing,
    not_tracked: notTracked,
    notes: [],
    url: meta.page,
    source: SOURCE,
  }

  // ---- the same thing in words ----
  const L = []
  L.push(`${row.name}: Draft Savant pre-draft profile (college and combine data, not NBA stats)`)
  L.push(`${drafted({ ...row, year: cls.year }, cls.projected)}.`)
  const facts = [row.pos, row.conf ? `${where(row)} (${row.conf})` : where(row)]
  if (row.gp != null) facts.push(plural(row.gp, 'game'))
  L.push(`${facts.join(', ')}.`)
  if (row.arch) L.push(`Archetype, as the page labels it: ${row.arch}.`)
  if (row.line) {
    const l = row.line
    L.push(`Per game: ${one(l.ppg)} points, ${one(l.rpg)} rebounds, ${one(l.apg)} assists${l.tpg != null ? `, ${one(l.tpg)} turnovers` : ''}.`)
  } else L.push('Per game: no line on file.')
  const sized = measures.filter(([, , v]) => !miss(v))
  L.push(sized.length ? `Measurements: ${sized.map(([name, , v, unit]) => `${name} ${display(unit, v)}`).join(', ')}.` : 'Measurements: none on file.')
  L.push('')

  // The caveats. They go into the text and, as notes, into the structured result, so a
  // client that only passes one of the two along still carries them.
  const notes = structured.notes
  notes.push(p.label)
  notes.push(`A higher percentile is always the better mark: stats tagged "lower is better" are already flipped. "ranked" is how many ${p.people} in that pool have a value for the stat; the percentile is among those.`)
  notes.push('These are pre-draft numbers. The page says its bars use "pre-draft college rate stats, shot-location and combine data — never NBA stats".')
  if (cls.projected) notes.push(projectedNote(cls.year))
  if (row.thin) notes.push(`The page flags a reduced sample: a ${row.gp}-game season, so read the rate stats with a little caution.`)
  const has = (key) => stats.some((s) => s.key === key)
  if (has('age') && meta.ageAsOf) {
    notes.push(`The page labels his age "${stats.find((s) => s.key === 'age').label}", but the figure in its data is his age on ${meta.ageAsOf}, not on draft night.`)
  }
  if (has('sos')) {
    notes.push(`Strength of schedule is his team's national schedule rank, which the page credits to KenPom: a lower number is a tougher schedule.${row.sosAsOf ? ` The data dates it ${row.sosAsOf}.` : ''}`)
  }
  if (has('bpm')) {
    notes.push(`The page says BPM comes from different sources for different prospects, so compare it across players loosely.${unconfirmed.has('bpm') ? ' His is one the page tags "source unconfirmed": treat it as approximate.' : ''}`)
  }
  if (namesakes.length) {
    notes.push(`"${row.id}" is ${row.name}'s id. The same word also fits ${namesakes.slice(0, 5).map((r) => `${r.name} (id ${r.id})`).join(', ')}.`)
  }
  L.push(...notes)

  // Each line names its pool. The page draws no number when fewer than two in the pool have
  // the stat, and neither does this.
  let heading = null
  const standing = (s) => (s.percentile == null
    ? `no percentile ${p.short}: ${s.ranked ? `only ${s.ranked}` : 'none'} ranked`
    : `${ordinal(s.percentile)} ${p.short}, ${s.ranked} ranked`)
  for (const s of stats) {
    const h = s.subgroup && s.subgroup !== s.group ? `${s.group}: ${s.subgroup}` : s.group
    if (h !== heading) { L.push('', h); heading = h }
    const extra = [
      s.alternate ? `the page also shows ${s.alternate.source} ${s.alternate.display}` : null,
      s.as_of ? `as of ${s.as_of}` : null,
    ].filter(Boolean)
    const tags = [s.lower_is_better ? 'lower is better' : null, s.source_unconfirmed ? 'source unconfirmed' : null].filter(Boolean)
    L.push(`- ${s.label}: ${s.display} (${standing(s)}${extra.length ? `; ${extra.join('; ')}` : ''})${tags.length ? ` [${tags.join(', ')}]` : ''}`)
  }
  if (!stats.length) L.push('', group === 'all' ? 'The page has no ranked stats for him.' : 'No stats in this group for him.')

  // What is not there, and why: nobody in his class has it, or only he lacks it.
  const scope = group === 'all' ? 'stats the page ranks' : `${group} stats the page ranks`
  const tally = `On file for him: ${stats.length} of the ${stats.length + missing.length + notTracked.length} ${scope}.`
  const his = missing.filter((m) => !m.whole_class)
  const everyones = missing.filter((m) => m.whole_class)
  const gaps = [tally]
  if (his.length) gaps.push(`No value for him, so the page shows no bar: ${his.map((m) => m.label).join(', ')}.`)
  if (everyones.length) gaps.push(`Not on file for anyone in the ${cls.year} class: ${everyones.map((m) => m.label).join(', ')}.`)
  if (notTracked.length) gaps.push(`Not tracked for the ${cls.year} class: ${notTracked.map((m) => m.label).join(', ')}.`)
  const gapNote = gaps.join(' ')
  const source = provenance(meta)
  notes.push(gapNote, source)

  L.push('', gapNote, '', source, linkNote(meta), `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const pct = z.number().int().min(1).max(99).nullable()
const inches = z.number().nullable()

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'nba_draft_search_prospects',
    config: {
      title: 'Search NBA draft prospects',
      description:
        'Find NBA draft prospects and past draftees in Draft Savant (Western Conference Elitists, wcehoops.com) by name. Covers the 2026 class as the page lists it, which the page shows as projected, and the first-round picks of each draft from 2010 through 2025. Returns each match with its id, position, college or other pre-draft team, draft year, and the pick and team the page shows. This is college and pre-draft data, not NBA stats. Matching ignores accents and punctuation; a name that matches only as a near spelling is returned marked as a close match. The data is a file compiled by WCE, partly by hand, not an official feed, and every result carries its provenance note. The page has no link that opens one prospect, so results link to the page itself.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Prospect name or part of one, e.g. "Dybantsa", "Cooper Flagg", "Wembanyama".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many prospects matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        prospects: z.array(z.object({
          id: z.string().describe('Prospect id, for nba_draft_get_prospect_profile.'),
          name: z.string(),
          position: z.string().nullable().describe('Guard, Wing or Big.'),
          college: z.string().nullable().describe('College or other pre-draft team, as the page names it. Null when the page lists none.'),
          draft_year: z.number().int(),
          pick: z.number().int().describe('Pick number as the page shows it.'),
          team: z.string().nullable().describe('Team as the page shows it.'),
          projected: z.boolean().describe('True when the page shows this class as projected: the pick is not a draft result.'),
          close_match: z.boolean().describe('True when the name matched only as a near spelling. It may be a different person.'),
          url: z.string().describe('The Draft Savant page. It has no per-prospect link.'),
        })),
        notes: z.array(z.string()).describe('What the data is and where it comes from.'),
        url: z.string().describe('The Draft Savant page.'),
        source: z.string(),
      },
      annotations: { title: 'Search NBA draft prospects', ...READ_ONLY },
    },
    run: ({ query, limit }) => searchProspects({ query, limit }),
  },
  {
    name: 'nba_draft_get_prospect_profile',
    config: {
      title: 'Get an NBA draft prospect\'s Draft Savant profile',
      description:
        'Get one prospect\'s Draft Savant profile (Western Conference Elitists, wcehoops.com): his college or other pre-draft production and his measurements as the page shows them. This is not NBA data. Returns his per-game line, games played, measurements, the page\'s archetype label, the pick and team the page shows (shown as projected for the 2026 class; first-round picks only for 2010 through 2025), and each stat the page ranks with its value and one percentile against a named pool, with how many prospects in that pool have the stat. The pool defaults to everyone the page lists from his own draft year; it can be narrowed to his position or to prospects within a year of his age, and it can be switched to the pooled 2010-2025 first rounds. Stats cover age, strength of schedule, scoring, shooting, playmaking, steals, blocks, rebounding, BPM and physical measurements. Stats with no value for him are listed as missing, and whether his whole class lacks them. The data is a file compiled by WCE, partly by hand, not an official feed, and every result carries its provenance note. The page has no link that opens one prospect, so the result links to the page itself.',
      inputSchema: {
        prospect: z.string().trim().min(1).max(80).describe('Prospect id from nba_draft_search_prospects (e.g. "dybantsa") or a full name (e.g. "AJ Dybantsa"). If a name fits more than one prospect, the error lists their ids.'),
        compare: z.enum(Object.keys(COMPARE)).default('all').describe('Who within the pool he is ranked against: "all" (default), "position" for only Guards, Wings or Bigs like him, or "age" for only prospects within a year of his age. The page\'s "Compare against" control.'),
        pool: z.enum(Object.keys(POOL)).default('class').describe('"class" (default) ranks him against his own draft year as the page lists it. "past" ranks him against the pooled first-round picks of every past draft on the page. The page\'s "Pool" control.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which stats to return: "all" (default), "context" (age, strength of schedule), "offense", or "defense" (steals, blocks, defensive rebounding, BPM and physical measurements).'),
      },
      outputSchema: {
        prospect: z.object({
          id: z.string(),
          name: z.string(),
          college: z.string().nullable().describe('College or other pre-draft team, as the page names it.'),
          conference: z.string().nullable(),
          position: z.string().nullable().describe('Guard, Wing or Big.'),
          archetype: z.string().nullable().describe('The page\'s archetype label, word for word.'),
          games: z.number().nullable().describe('Games in the pre-draft season on file.'),
          reduced_sample: z.boolean().describe('True when the page flags his season as a reduced sample.'),
        }),
        draft: z.object({
          year: z.number().int(),
          pick: z.number().int(),
          team: z.string().nullable(),
          projected: z.boolean().describe('True when the page shows the pick as projected, not a draft result.'),
          label: z.string().describe('The pick badge as the page prints it.'),
        }),
        per_game: z.object({
          points: z.number().nullable(),
          rebounds: z.number().nullable(),
          assists: z.number().nullable(),
          turnovers: z.number().nullable(),
        }).nullable().describe('Pre-draft per-game line. Null when the page shows none.'),
        measurements: z.object({
          height_in: inches.describe('Height without shoes, in inches.'),
          wingspan_in: inches,
          standing_reach_in: inches,
          max_vertical_in: inches,
          weight_lb: z.number().nullable(),
        }).describe('Null where the page has no measurement.'),
        pool: z.object({
          compare: z.string().describe('all, position or age.'),
          pool: z.string().describe('class or past.'),
          label: z.string().describe('Who the percentiles are against, in a sentence.'),
          short_label: z.string().describe('The same in a few words, e.g. "vs. the 2026 class".'),
          size: z.number().int().describe('How many prospects are in the pool.'),
          page_default: z.boolean().describe('True when this is the view the page opens with.'),
        }),
        stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          subgroup: z.string().nullable(),
          kind: z.string().nullable().describe('The page\'s tag for the row: context, output or ingredient.'),
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          percentile: pct.describe('Against the pool named in pool.label. Higher is better. Null when fewer than two prospects in the pool have the stat.'),
          ranked: z.number().int().describe('How many prospects in the pool have a value for this stat.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentile is already flipped.'),
          source_unconfirmed: z.boolean().optional().describe('True when the page tags the value "source unconfirmed".'),
          alternate: z.object({ source: z.string(), value: z.number(), display: z.string() }).optional().describe('A second figure the page prints under the value.'),
          as_of: z.string().optional().describe('The date the figure was taken.'),
        })),
        missing: z.array(z.object({
          key: z.string(),
          label: z.string(),
          whole_class: z.boolean().describe('True when nobody in his draft class has this stat on file.'),
        })).describe('Stats with no value for him. The page shows no bar for these; they are not zero.'),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string() })).describe('Stats the page does not apply to his draft year.'),
        notes: z.array(z.string()).describe('How to read the numbers: the pool, the cautions that apply to him, what is missing, and where the data comes from.'),
        url: z.string().describe('The Draft Savant page. It has no per-prospect link.'),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA draft prospect\'s Draft Savant profile', ...READ_ONLY },
    },
    run: ({ prospect, compare, pool, group }) => prospectProfile({ prospect, compare, pool, group }),
  },
]
