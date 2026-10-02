// Draft Savant, cut up for machines. The draft section of the Savant API files.
//
// The Draft Savant page (public/draft-savant.html) downloads public/data.json — every
// prospect on the page, each with his college line, measurements and rate stats — and works
// out every percentile in the browser. The file holds values only, so the number a fan
// actually reads on a card, "88th against his draft class", is nowhere in it. An AI
// assistant or a script cannot run the page, so this writes the answer down once per build:
//
//   dist/savant-api/draft/v1/meta.json              the stat list, the pools, the provenance note
//   dist/savant-api/draft/v1/prospects.json         every prospect: id, name, class, pick
//   dist/savant-api/draft/v1/classes/<year>.json.gz one draft class: every prospect's values
//                                                   with his percentile in all six pools
//
// THE NUMBERS MUST MATCH THE PAGE. The page has two controls, and between them six pools:
//
//   "Compare against"   All | Same position | Similar age       (the page's `pop`)
//   "Pool"              This class | Past drafts                (the page's `poolPop`)
//
// The default view is All x This class: a prospect is ranked against everyone the data holds
// from his own draft year. Every stat here carries all six percentiles, each with how many
// prospects in that pool have a value for the stat, because a percentile among eight players
// is not the same thing as one among sixty. Everything the page decides is decided the same
// way, and read out of the page rather than copied, so the two cannot drift quietly:
//
//   - the stat list, each stat's lower-is-better flag and the draft years it applies to
//     (CFG.metrics, valid_from / valid_to)
//   - which class is the "current" one, shown as projected and left out of "Past drafts"
//   - how wide "Similar age" is (AGE_BAND), how few games make a reduced sample, and how
//     many picks the page's board counts as the first round
//   - the names on the two controls and the two columns
//   - a percentile is the page's pctOf(): midrank against the pool, flipped for lower-is-
//     better stats, rounded, held to 1..99, and none at all when the pool has under two values
//   - a stat with no value is left out, never zero; when BPM is missing but a Barttorvik
//     figure exists the page shows that instead, marked "source unconfirmed", and so does this
//
// tools/savant-draft/check.mjs proves it: it lifts the page's own functions out of the HTML,
// renders every prospect in every pool in a sandbox, and compares what the page would draw
// with what is written here.
//
// TWO THINGS ARE DELIBERATELY NOT CARRIED OVER.
//   - Birth dates. data.json has them; nothing here does. They are read once, to learn what
//     date the age figure is measured at (meta.ageAsOf), and dropped. Age itself is kept at
//     the one decimal the page prints: two decimals and a known date would give the birthday
//     back to within a few days. Percentiles are still worked out on the full figure.
//   - Fields the page never shows (per, usg_torvik) and its written scouting takes.
//
// THE DATA IS A COMPILED FILE, PARTLY TRANSCRIBED BY HAND, and says so (source
// "hardcoded-v1", plus a note). Both go into meta.json untouched so that every answer built
// on these files can repeat them.
//
// Nothing here is committed. It is not a Vite plugin; the build calls writeDraftApi().

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/draft/v1'
export const SCHEMA = 1

const PAGE = 'draft-savant.html'
const DATA = 'data.json'

// The page's two controls, by the values its buttons carry. The six pools are every pairing,
// in this order: it is the order of the six percentiles (and six counts) on every stat.
export const FIELDS = ['class', 'past5']
export const COHORTS = ['all', 'pos', 'age']
export const POOLS = FIELDS.flatMap((field) => COHORTS.map((cohort) => ({ field, cohort })))
export const poolIndex = (field, cohort) => FIELDS.indexOf(field) * COHORTS.length + COHORTS.indexOf(cohort)

// The five measurements in the page's header (its render()). Four of them also have a bar;
// max vertical is shown in the header only. The header prints them whatever a stat's draft
// years are, so they are carried apart from the bars.
const HEADER = ['height', 'wing', 'reach', 'vert', 'weight']

// How the page prints each unit (its fmt()), in words.
const UNITS = {
  pct3: 'a rate from 0 to 1, shown to three places (.558)',
  pct1: 'a percentage, already multiplied by 100 (27.8 means 27.8%)',
  num0: 'a whole number, shown as it is',
  num1: 'a number, shown to one decimal',
  ftin: 'inches (the page shows feet and inches)',
  lb: 'pounds (the page shows the bare number)',
  inch: 'inches',
}

// ---- reading the page ----------------------------------------------------------------

// End of the JSON value that starts at `start` (an opening brace). Skips braces in strings.
function jsonEnd(src, start) {
  let depth = 0
  let inStr = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  throw new Error(`unbalanced JSON in ${PAGE}`)
}

// Text as a browser shows it. The page writes its strings into the document as HTML, so an
// "&amp;" in the page or in the data ("Texas A&amp;M") reaches the fan as "&".
const plain = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim()
const text = (s) => (typeof s === 'string' && s.trim() ? plain(s) : null)

// One number out of the page's script, by the line that sets it.
function pageNumber(html, re, what) {
  const m = html.match(re)
  if (!m) throw new Error(`${what} not found in ${PAGE}`)
  return +m[1]
}

// The buttons of one of the page's two controls: { value: label }.
function control(html, id, expected) {
  const at = html.indexOf(`id="${id}"`)
  const end = at < 0 ? -1 : html.indexOf('</div>', at)
  if (end < 0) throw new Error(`the #${id} control was not found in ${PAGE}`)
  const out = {}
  for (const m of html.slice(at, end).matchAll(/<button data-v="([^"]+)"[^>]*>([^<]+)<\/button>/g)) out[m[1]] = plain(m[2])
  if (Object.keys(out).join() !== expected.join()) {
    throw new Error(`the #${id} control in ${PAGE} offers "${Object.keys(out).join()}", expected "${expected.join()}"`)
  }
  return out
}

export function readPageConfig(html) {
  const at = html.search(/const\s+CFG\s*=\s*\{/)
  if (at < 0) throw new Error(`CFG not found in ${PAGE}`)
  const start = html.indexOf('{', at)
  const cfg = JSON.parse(html.slice(start, jsonEnd(html, start) + 1))
  if (!Array.isArray(cfg.metrics) || !cfg.metrics.length) throw new Error('CFG.metrics is empty')
  for (const m of cfg.metrics) {
    if (typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.group !== 'string' || typeof m.unit !== 'string') {
      throw new Error(`CFG.metrics: malformed entry ${JSON.stringify(m).slice(0, 80)}`)
    }
    if (!UNITS[m.unit]) throw new Error(`CFG.metrics: ${m.key} has a unit this file cannot describe ("${m.unit}")`)
  }

  // The class the page treats as not yet drafted. It says so in two places — "Past drafts"
  // leaves it out, and the pick badge calls it projected — and they have to agree.
  const currentClass = pageNumber(html, /PAST_YEARS\s*=\s*YEARS\.filter\(\s*y\s*=>\s*y\s*!==\s*(\d{4})\s*\)/, 'the "past drafts" rule')
  const badgeClass = pageNumber(html, /\(p\.draft_year===(\d{4})\?'Projected ':/, 'the "Projected" pick badge')
  if (badgeClass !== currentClass) throw new Error(`${PAGE} disagrees with itself about the current class (${currentClass} and ${badgeClass})`)

  // The two columns' headings. The context card above them has no heading on the page.
  const groups = { ctx: 'Context' }
  for (const m of html.matchAll(/<h2 class="col-h">([^<]+)<\/h2><div id="(\w+)">/g)) groups[m[2]] = plain(m[1])
  for (const m of cfg.metrics) if (!groups[m.group]) throw new Error(`${PAGE} has no heading for the "${m.group}" group`)

  return {
    cfg,
    currentClass,
    ageBand: pageNumber(html, /const\s+AGE_BAND\s*=\s*([\d.]+)\s*;/, 'AGE_BAND'),
    thinBelow: pageNumber(html, /const\s+thin\s*=\s*\(p\.gp!=null\s*&&\s*p\.gp<(\d+)\)/, 'the reduced-sample rule'),
    // The page's draft board files picks 1 to this number under the first round.
    firstRound: pageNumber(html, /const\s+r1\s*=\s*rows\(1,\s*(\d+)\)/, 'the draft board\'s first round'),
    cohortLabels: control(html, 'popseg', COHORTS),
    fieldLabels: control(html, 'poolseg', FIELDS),
    groups,
  }
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

// The page's val(): a stat's value, or null.
const val = (p, key) => { const c = p.m[key]; return c ? c.v : null }

// The page's validEra(): a stat applies to the draft years valid_from..valid_to, inclusive.
export function validEra(m, year) {
  const from = m.valid_from == null ? -Infinity : m.valid_from
  const to = m.valid_to == null ? Infinity : m.valid_to
  return year >= from && year <= to
}

// The page's pctOf(): midrank percentile against a pool, 1..99, whole numbers. None when the
// pool holds fewer than two values.
export function percentile(v, pool, lower) {
  const n = pool.length
  if (v == null || n < 2) return null
  let less = 0
  let eq = 0
  for (const x of pool) { if (x < v) less++; else if (x === v) eq++ }
  let pct = (100 * (less + 0.5 * eq)) / n
  if (lower) pct = 100 - pct
  return Math.max(1, Math.min(99, Math.round(pct)))
}

// What the page puts on a stat's row: its value, or nothing. BPM alone has a second source:
// when the labelled figure is missing and a Barttorvik one exists, the page shows that and
// tags the row "source unconfirmed". The pools are built from the labelled figure only.
function shown(p, key) {
  const v = val(p, key)
  if (key === 'bpm' && miss(v) && p.bpm_torvik != null) return { v: p.bpm_torvik, unconfirmed: true }
  return { v, unconfirmed: false }
}

// What date is the age figure measured at? The page labels it "Draft-day age" and explains it
// as an age on February 1. This checks the explanation against the birth dates: if every
// prospect's figure is his age on February 1 of his draft year, say so; if not, say nothing.
function ageAsOf(players) {
  let checked = 0
  for (const p of players) {
    const age = val(p, 'age')
    const born = p.birthdate ? Date.parse(`${p.birthdate}T00:00:00Z`) : NaN
    if (miss(age) || !Number.isFinite(born)) continue
    const feb1 = (Date.UTC(p.draft_year, 1, 1) - born) / 86400000 / 365.25
    if (Math.abs(feb1 - age) > 0.0051) return null
    checked++
  }
  return checked ? 'February 1 of the draft year' : null
}

// ---- building ------------------------------------------------------------------------

function checkData(data) {
  if (!data || !Array.isArray(data.players) || !data.players.length) throw new Error(`${DATA}: expected { players: [...] }`)
  const seen = new Set()
  for (const p of data.players) {
    const ok = p && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name
      && Number.isInteger(p.draft_year) && Number.isInteger(p.draft_pick)
      && p.m && typeof p.m === 'object' && p.line && typeof p.line === 'object'
    if (!ok) throw new Error(`${DATA}: a prospect is missing id, name, draft_year, draft_pick, line or m (${JSON.stringify(p).slice(0, 80)})`)
    if (seen.has(p.id)) throw new Error(`${DATA}: two prospects share the id "${p.id}"`)
    seen.add(p.id)
  }
}

export function buildDraftApi({ data, html }) {
  const page = readPageConfig(html)
  checkData(data)
  const metrics = page.cfg.metrics
  const players = data.players

  // The page's YEARS (newest first) and PAST_YEARS.
  const years = [...new Set(players.map((p) => p.draft_year))].sort((a, b) => b - a)
  const pastYears = years.filter((y) => y !== page.currentClass)

  // The page's populationOf() and poolFor(): who a prospect is ranked against.
  const byYear = new Map(years.map((y) => [y, players.filter((p) => p.draft_year === y)]))
  const past = players.filter((p) => pastYears.includes(p.draft_year))
  function poolFor(ref, field, cohort) {
    const pool = field === 'past5' ? past : byYear.get(ref.draft_year)
    if (cohort === 'pos') return pool.filter((p) => p.pos === ref.pos)
    if (cohort === 'age') {
      const a = val(ref, 'age')
      if (miss(a)) return pool
      return pool.filter((p) => { const b = val(p, 'age'); return !miss(b) && Math.abs(b - a) <= page.ageBand })
    }
    return pool
  }

  function row(p) {
    const pools = POOLS.map(({ field, cohort }) => poolFor(p, field, cohort))
    const m = {}
    const unconfirmed = []
    for (const mt of metrics) {
      if (!validEra(mt, p.draft_year)) continue
      const cell = shown(p, mt.key)
      if (miss(cell.v)) continue
      const pcts = []
      const counts = []
      for (const pool of pools) {
        // The page's poolVals(): the pool's labelled values for this stat.
        const values = []
        for (const q of pool) { const v = val(q, mt.key); if (!miss(v)) values.push(v) }
        pcts.push(percentile(cell.v, values, mt.lower))
        counts.push(values.length)
      }
      // Age is kept at the one decimal the page prints (see the header).
      m[mt.key] = [mt.key === 'age' ? +(+cell.v).toFixed(1) : cell.v, ...pcts, ...counts]
      if (cell.unconfirmed) unconfirmed.push(mt.key)
    }

    const meas = {}
    for (const key of HEADER) { const v = val(p, key); if (!miss(v)) meas[key] = v }

    const line = p.line
    const hasLine = line.ppg != null || line.rpg != null || line.apg != null
    const out = {
      id: p.id,
      name: text(p.name),
      college: text(p.college),
      conf: text(p.conference),
      pos: text(p.pos),
      pick: p.draft_pick,
      team: text(p.draft_team),
      arch: text(p.archetype),
      gp: p.gp ?? null,
      line: hasLine ? { ppg: line.ppg ?? null, rpg: line.rpg ?? null, apg: line.apg ?? null, tpg: line.tpg ?? null } : null,
      meas,
      sizes: pools.map((pool) => pool.length),
      m,
    }
    // The page's reduced-sample note: a season of fewer games than the page's line.
    if (p.gp != null && p.gp < page.thinBelow) out.thin = true
    if (unconfirmed.length) out.unconfirmed = unconfirmed
    // The page prints Barttorvik's BPM under the labelled one when it has both.
    if (m.bpm && !unconfirmed.includes('bpm') && p.bpm_torvik != null) out.torvik = p.bpm_torvik
    if (m.sos && p.sos_asof) out.sosAsOf = p.sos_asof
    return out
  }

  const classes = {}
  const summary = []
  for (const year of years) {
    const rows = byYear.get(year).map(row).sort((a, b) => a.pick - b.pick)
    const picks = rows.map((r) => r.pick)
    const have = {}
    for (const mt of metrics) have[mt.key] = rows.filter((r) => r.m[mt.key]).length
    const projected = year === page.currentClass
    const info = { year, projected, count: rows.length, picks: [Math.min(...picks), Math.max(...picks)] }
    summary.push(info)
    classes[year] = { schema: SCHEMA, ...info, have, players: rows }
  }

  const pastPlayers = summary.filter((c) => !c.projected)
  const meta = {
    schema: SCHEMA,
    name: 'Draft Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/${PAGE}`,
    prospectUrl: null, // the page has no link that opens one prospect
    source: data.source || null,
    note: data.note || null,
    files: {
      prospects: `${SITE}/${BASE}/prospects.json`,
      class: `${SITE}/${BASE}/classes/{year}.json`,
    },
    currentClass: page.currentClass,
    classes: summary,
    past: {
      years: [...pastYears].sort((a, b) => a - b),
      count: past.length,
      firstRoundOnly: pastPlayers.length > 0 && pastPlayers.every((c) => c.picks[1] <= page.firstRound),
    },
    firstRound: page.firstRound,
    fields: page.fieldLabels,
    cohorts: page.cohortLabels,
    pools: POOLS,
    ageBand: page.ageBand,
    ageAsOf: ageAsOf(players),
    thinBelow: page.thinBelow,
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile is always the better mark. Null when fewer than two prospects in the pool have a value.',
      default: 'class x all: everyone in the data from the same draft year. It is what the page shows before either control is touched.',
      class: 'His own draft year as the data holds it (classes[] says how many, and which picks).',
      past5: 'Every draft year in the data except the current class, pooled.',
      all: 'Everyone in that field.',
      pos: 'Only the prospects in that field listed at his position: Guard, Wing or Big.',
      age: 'Only the prospects in that field whose age figure is within ageBand years of his. When he has no age on file the page falls back to the whole field.',
    },
    units: UNITS,
    groups: page.groups,
    metrics: metrics.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      sub: m.sub || null,
      layer: m.layer || null,
      unit: m.unit,
      lowerIsBetter: !!m.lower,
      validFrom: m.valid_from ?? null,
      validTo: m.valid_to ?? null,
    })),
    row: {
      id: 'The page\'s own id for the prospect.',
      pos: 'Guard, Wing or Big.',
      pick: 'Pick number. For the current class the page labels it projected.',
      arch: 'Archetype label, exactly as the page shows it.',
      gp: 'Games played in the pre-draft season on file.',
      line: 'Per-game line: ppg, rpg, apg, tpg (turnovers). Null when the page shows no line.',
      meas: 'The measurements in the page\'s header, where on file: height, wing (wingspan), reach and vert (max vertical) in inches, weight in pounds. Max vertical has no bar and no percentile.',
      sizes: 'How many prospects are in each of the six pools (the order of pools[]), whether or not they have any one stat.',
      m: 'Stats by key: [value, six percentiles, six counts], both in the order of pools[]. A count is how many prospects in that pool have a value for the stat; the percentile is among them. A stat that is absent has no value for him or does not apply to his draft year. It is not zero.',
      thin: 'True when his season is under thinBelow games; the page then warns of a reduced sample.',
      unconfirmed: 'Keys whose value the page tags "source unconfirmed".',
      torvik: 'Barttorvik\'s BPM, which the page prints under the labelled BPM when it has both.',
      sosAsOf: 'The date the strength-of-schedule rank was taken.',
    },
    class: {
      projected: 'True for the current class: the page shows its picks as projected.',
      picks: 'Lowest and highest pick number in the class as the data holds it.',
      have: 'For each stat, how many prospects in the class have a value.',
    },
  }

  const prospects = {
    schema: SCHEMA,
    count: players.length,
    prospects: years.flatMap((y) => classes[y].players.map((r) => ({
      id: r.id, name: r.name, pos: r.pos, college: r.college, year: y, pick: r.pick, team: r.team,
    }))),
  }

  return { meta, prospects, classes }
}

// ---- writing -------------------------------------------------------------------------

export function writeDraftApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, DATA)
  const pageFile = path.join(publicDir, PAGE)
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error(`${DATA} or ${PAGE} is missing from public/`)

  const out = buildDraftApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = [
    ['meta.json', Buffer.from(JSON.stringify(out.meta))],
    ['prospects.json', Buffer.from(JSON.stringify(out.prospects))],
  ]
  let raw = files[0][1].length + files[1][1].length
  for (const [year, body] of Object.entries(out.classes)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push([`classes/${year}.json.gz`, gzipSync(json, { level: 9 })])
  }

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'classes'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const classes = Object.keys(out.classes).length
  return {
    files: files.length,
    raw,
    bytes,
    summary: `${out.prospects.count.toLocaleString('en-US')} prospects, ${classes} draft classes`,
  }
}
