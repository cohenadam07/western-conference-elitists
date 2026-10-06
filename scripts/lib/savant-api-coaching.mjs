// Coaching Savant, cut up for machines. Runs after `vite build` writes dist/.
//
// The Coaching Savant page downloads two files — the archive (public/coaching-savant-data.json,
// every head coach since 1999 and every play-caller since 2018) and the small in-season
// overlay (public/coaching-savant-current.json) — lays the second over the first, and works
// every ranking out in the browser. That is fine for a person with the page open and useless
// for an AI assistant: the raw files hold values only, so the thing a fan actually reads on a
// coach's page — "wins above expectation, 97th percentile against the head coaches with at
// least three seasons" — is nowhere in them.
//
// This writes that answer down, once per build, as a handful of small files:
//
//   dist/savant-api/coaching/v1/meta.json              the glossary: every stat the page ranks,
//                                                      the page's own explanation of it, the
//                                                      pools, the qualifying lines, the notes
//   dist/savant-api/coaching/v1/coaches.json           everyone with a page, for name search
//   dist/savant-api/coaching/v1/profiles/all.json.gz   each person's page: record, ranked
//                                                      career stats, fourth downs, seasons,
//                                                      lineage, and the units he called
//   dist/savant-api/coaching/v1/units/<year>.json.gz   one season's offences and defences, each
//                                                      credited to its play-caller, every stat
//                                                      with its percentile
//
// THE NUMBERS MUST MATCH THE PAGE. Everything the page decides is decided the same way here,
// and what can be read from the page is read from it rather than copied, so the two cannot
// drift quietly:
//
//   - the stat tables (METRICS, OFF_M, DEF_M and their groups), the three-season line, the
//     48-game line for fourth-down ranks, the round names and the "not in this season" notes
//     come out of public/coaching-savant.html. The page's script is run in a sandbox with its
//     last line (the one that starts the page) taken off, and the tables are read from it.
//   - the overlay is laid over the archive by the page's rule: coaches, callers, units and
//     league rows are replaced by name, unless the archive is the newer file
//   - a career stat is ranked only for a head coach with three seasons, against the other
//     head coaches with three; a fourth-down stat only with 48 games since 2014, against the
//     others with 48. Below those lines the page shows no rank and neither do these files.
//   - a unit (one man calling one side for one team over a run of weeks) is ranked against
//     the other units of its own season and side, never across years. A unit with too few
//     snaps keeps its values and gets no percentile.
//   - a percentile is the page's: midrank, flipped for lower-is-better stats, rounded, held
//     to 1..99
//   - a stat with no value is absent, never zero
//
// Two things on the page are hand-curated, not computed: who coached under whom, and who
// called the plays. The page says so wherever either appears, in the words carried in the
// data file (treeNote, callerNote); meta.json carries them on, and an "unconfirmed"
// play-caller stays marked unconfirmed.
//
// tools/savant-coaching/check.mjs proves the match: it runs the page's own code over every
// coach, caller and unit and compares what the page would draw with what is written here.
//
// Nothing here is committed. The files are rebuilt on every deploy, so the daily data refresh
// reaches them by itself. It is not a Vite plugin: the build calls writeCoachingApi().

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/coaching/v1'
export const SCHEMA = 1
export const SIDES = ['O', 'D']

// How the page prints each unit (its fmt()), in words, so a reader of the raw value knows
// what it is holding.
const UNITS_OF_MEASURE = {
  pct1: 'a percentage, already multiplied by 100 (64.2 means 64.2%)',
  num0: 'a whole number',
  num1: 'a number, shown to one decimal',
  sgn1: 'a signed number, shown with its sign to one decimal (+2.1)',
  sgn2: 'a signed number, shown with its sign to two decimals (+1.60)',
  sgn3: 'a signed number, shown with its sign to three decimals and no leading zero (+.046)',
  sec: 'seconds, shown to one decimal',
}

// ---- reading the page ----------------------------------------------------------------

const plain = (v) => JSON.parse(JSON.stringify(v))
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '')
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

// The page's script with its last line (init(), which fetches and draws) taken off, run in
// an empty sandbox. What is left only declares things, so the tables can be read from it.
function runPage(html) {
  const open = html.indexOf('<script>')
  const close = html.lastIndexOf('</script>')
  if (open < 0 || close < open) throw new Error('coaching-savant.html: no inline script found')
  const src = html.slice(open + '<script>'.length, close)
  const boot = /\binit\(\);\s*$/
  if (!boot.test(src)) throw new Error('coaching-savant.html: the script no longer ends by calling init()')
  const ctx = vm.createContext({})
  try {
    vm.runInContext(src.replace(boot, ''), ctx)
  } catch (e) {
    throw new Error(`coaching-savant.html: the script could not be read (${e.message})`, { cause: e })
  }
  return { ctx, src }
}

function metricRow(m, extra = {}) {
  if (!m || typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.grp !== 'string' || typeof m.unit !== 'string') {
    throw new Error(`coaching-savant.html: malformed metric ${JSON.stringify(m).slice(0, 80)}`)
  }
  if (!UNITS_OF_MEASURE[m.unit]) throw new Error(`coaching-savant.html: unknown unit "${m.unit}" on ${m.key}`)
  // `what` is the page's one-line "what it is" for the stat, the line a reader gets by
  // clicking its bar, and `formula` the page's line for how it is worked out: for a bare
  // signed number ("+10.4") the formula is what says it is a difference between two rates.
  // (The page also has a "why it matters"; the tools do not use it, so it is left out.)
  return { key: m.key, label: m.label, group: m.grp, unit: m.unit, lowerIsBetter: !!m.lower, ...extra, what: (m.exp && m.exp.w) || null, formula: (m.exp && m.exp.f) || null }
}

export function readPage(html) {
  const { ctx, src } = runPage(html)
  const list = (name) => {
    const v = ctx[name]
    if (!Array.isArray(v) || !v.length) throw new Error(`coaching-savant.html: ${name} is missing or empty`)
    return plain(v)
  }
  const number = (re, what) => {
    const m = src.match(re)
    if (!m) throw new Error(`coaching-savant.html: ${what} not found`)
    return +m[1]
  }

  const groups = list('GRPS')
  const metrics = list('METRICS').map((m) => metricRow(m))
  for (const m of metrics) if (!groups.includes(m.group)) throw new Error(`coaching-savant.html: ${m.key} is in a group the page does not draw (${m.group})`)

  const unitGroups = { O: list('OFF_GRPS'), D: list('DEF_GRPS') }
  const unitMetrics = {}
  for (const [side, name] of [['O', 'OFF_M'], ['D', 'DEF_M']]) {
    unitMetrics[side] = list(name).map((m) => metricRow(m, { style: !!m.style, pair: Array.isArray(m.pair) ? m.pair.slice(0, 2) : null }))
    for (const m of unitMetrics[side]) if (!unitGroups[side].includes(m.group)) throw new Error(`coaching-savant.html: unit stat ${m.key} is in a group the page does not draw (${m.group})`)
  }

  if (!Number.isInteger(ctx.MIN_SEASONS) || ctx.MIN_SEASONS < 1) throw new Error('coaching-savant.html: MIN_SEASONS is missing')
  const rounds = plain(ctx.ROUND_NAME || null)
  if (!rounds || !rounds[1] || !rounds[4]) throw new Error('coaching-savant.html: ROUND_NAME is missing')
  if (typeof ctx.missingNote !== 'function' || typeof ctx.unsureTag !== 'function') throw new Error('coaching-savant.html: missingNote() or unsureTag() is missing')

  // The page's own wording for a unit whose season lacks a data source, by era.
  const eraNote = (era) => unescapeHtml(stripTags(String(ctx.missingNote({ era }) || '').replace(/<b>[^<]*<\/b>/, ''))).trim()
  const unsure = String(ctx.unsureTag({ sure: false })).match(/title="([^"]*)"/)
  if (!unsure) throw new Error('coaching-savant.html: the "unconfirmed" tag lost its explanation')

  return {
    groups,
    metrics,
    unitGroups,
    unitMetrics,
    minSeasons: ctx.MIN_SEASONS,
    // Both lines live inline in the page: who is in a fourth-down pool, and when the
    // fourth-down panel says "small sample".
    d4MinGames: number(/key\.indexOf\('d4_'\)===0\s*\?\s*!\(c\.d4_g>=(\d+)\)\s*:\s*c\.seasons<MIN_SEASONS/, 'the fourth-down pool rule in pool()'),
    d4SmallSample: number(/car\.d4_n<(\d+)\?'<div class="panel-cap"><b>Small sample:<\/b>/, 'the small-sample line in d4Panel()'),
    rounds,
    eraNote,
    unconfirmed: unescapeHtml(unsure[1]),
  }
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

function lowerBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid }
  return lo
}
function upperBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid }
  return lo
}

// The page's pctOf(): midrank percentile against a pool sorted ascending, 1..99, whole
// numbers, flipped when lower is better.
export function percentile(v, sorted, lower) {
  const n = sorted.length
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

const ascending = (a) => a.sort((x, y) => x - y)

// The page's mergeCurrent(): the overlay replaces coaches, callers, units and league rows by
// name. It is skipped when the archive is the newer of the two files (a full rebuild has
// already taken the season in), but the season and week it names are kept either way.
export function overlay(data, current) {
  const out = {
    coaches: { ...data.coaches },
    callers: { ...(data.callers || {}) },
    units: { ...(data.units || {}) },
    league: { ...(data.league || {}) },
    current: null,
    overlaid: false,
  }
  if (!current) return out
  out.current = { season: current.season, week: current.week }
  if (data.generated && current.generated && current.generated < data.generated) return out
  Object.assign(out.coaches, current.coaches || {})
  Object.assign(out.units, current.units || {})
  Object.assign(out.callers, current.callers || {})
  Object.assign(out.league, current.league || {})
  out.overlaid = true
  return out
}

// The page's sbName(): the Super Bowl a season ends in, the way the NFL numbers it.
export function superBowl(season) {
  let n = +String(season).slice(0, 4) - 1965
  if (!Number.isFinite(n) || n < 1) return ''
  if (n === 50) return '50'
  const R = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of R) while (n >= v) { out += s; n -= v }
  return out
}

// The page's yearsLabel(): "2018, 2023–26" rather than a "2018–2026" that claims the years
// in between.
export function yearsLabel(years) {
  const ys = [...new Set(years)].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < ys.length;) {
    let j = i
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++
    out.push(i === j ? String(ys[i]) : `${ys[i]}–${String(ys[j]).slice(2)}`)
    i = j + 1
  }
  return out.join(', ')
}

// ---- building ------------------------------------------------------------------------

const isD4 = (key) => key.indexOf('d4_') === 0

export function buildCoachingApi({ data, current = null, html }) {
  if (!data || typeof data.coaches !== 'object' || !data.coaches || typeof data.tree !== 'object' || !data.tree || !Array.isArray(data.seasons)) {
    throw new Error('coaching-savant-data.json: expected { seasons, tree, coaches, callers, units }')
  }
  if (current && (typeof current.season !== 'number' || typeof current.coaches !== 'object')) {
    throw new Error('coaching-savant-current.json: expected { season, week, coaches, callers, units }')
  }
  const page = readPage(html)
  const { coaches: COACHES, callers: CALLERS, units: UNITS, league: LEAGUE, current: cur, overlaid } = overlay(data, current)
  const TREE = data.tree
  const generated = overlaid && current.generated ? current.generated : data.generated || null

  for (const [name, c] of Object.entries(COACHES)) {
    if (!c || !c.career || !Array.isArray(c.seasons) || typeof c.career.seasons !== 'number') throw new Error(`coaching data: head coach "${name}" has no career or seasons`)
  }
  for (const [id, u] of Object.entries(UNITS)) {
    if (!u || !u.m || !SIDES.includes(u.side) || typeof u.season !== 'number' || !Array.isArray(u.wk) || typeof u.caller !== 'string') throw new Error(`coaching data: unit "${id}" is malformed`)
  }

  const isPerson = (n) => !!(COACHES[n] || CALLERS[n])
  const seasons = data.seasons.map(Number)
  const firstSeason = Math.min(...seasons)
  const latestSeason = Math.max(...seasons)

  // ---- career pools: the page's pool() ----
  // Fourth-down stats: head coaches with 48 games in the seasons the model covers. Every
  // other stat: head coaches with three seasons. Either way, only those with a value.
  const inPool = (car, key) => (isD4(key) ? car.d4_g >= page.d4MinGames : !(car.seasons < page.minSeasons))
  const careerPool = {}
  for (const m of page.metrics) {
    const vals = []
    for (const c of Object.values(COACHES)) {
      if (!inPool(c.career, m.key)) continue
      const v = c.career[m.key]
      if (!miss(v)) vals.push(v)
    }
    careerPool[m.key] = ascending(vals)
  }

  // The first season any head coach carries a stat. A career that ended before it has no
  // value for that stat because it was not tracked yet.
  const since = {}
  for (const c of Object.values(COACHES)) {
    for (const s of c.seasons) {
      for (const m of page.metrics) {
        const has = isD4(m.key) ? !!s.d4_n : !miss(s[m.key])
        if (has && (since[m.key] == null || s.season < since[m.key])) since[m.key] = s.season
      }
    }
  }
  const d4Years = Object.keys(LEAGUE).filter((y) => LEAGUE[y] && LEAGUE[y].d4).map(Number)
  const unitYears = [...new Set(Object.values(UNITS).map((u) => u.season))].sort((a, b) => a - b)

  // ---- unit pools: the page's unitPool() ----
  // The other units of the same season and side that have enough snaps to rank.
  const unitPool = {} // season -> side -> key -> sorted values
  const ranked = {}   // season -> side -> how many units are ranked at all
  for (const u of Object.values(UNITS)) {
    const bySide = (unitPool[u.season] = unitPool[u.season] || { O: {}, D: {} })
    const count = (ranked[u.season] = ranked[u.season] || { O: 0, D: 0 })
    if (u.small) continue
    count[u.side]++
    for (const m of page.unitMetrics[u.side]) {
      const v = u.m[m.key]
      if (!miss(v)) (bySide[u.side][m.key] = bySide[u.side][m.key] || []).push(v)
    }
  }
  for (const bySide of Object.values(unitPool)) for (const side of SIDES) for (const k of Object.keys(bySide[side])) ascending(bySide[side][k])

  // The page's sortUnits(): newest season first, offence before defence, later weeks first.
  const sortUnits = (ids) => ids.filter((id) => UNITS[id]).sort((a, b) => {
    const x = UNITS[a]
    const y = UNITS[b]
    return y.season - x.season || (x.side < y.side ? 1 : x.side > y.side ? -1 : 0) || y.wk[0] - x.wk[0]
  })

  // ---- units ----
  const unitFiles = {}
  for (const season of unitYears) {
    unitFiles[season] = {
      schema: SCHEMA,
      season,
      generated,
      // Set when this is the season the overlay covers: the regular-season week it runs through.
      week: cur && cur.season === season ? cur.week ?? null : null,
      ranked: ranked[season],
      pools: { O: {}, D: {} },
      units: {},
    }
    for (const side of SIDES) for (const [k, vals] of Object.entries(unitPool[season][side])) unitFiles[season].pools[side][k] = vals.length
  }
  for (const u of Object.values(UNITS)) {
    const m = {}
    const pair = {}
    for (const mt of page.unitMetrics[u.side]) {
      const v = u.m[mt.key]
      if (miss(v)) continue
      // The page's unitPct(): no percentile for a unit too small to rank.
      m[mt.key] = [v, u.small ? null : percentile(v, unitPool[u.season][u.side][mt.key] || [], mt.lowerIsBetter)]
      if (mt.pair) {
        const a = u.m[mt.pair[0]]
        const b = u.m[mt.pair[1]]
        if (!miss(a) && !miss(b)) pair[mt.key] = [a, b]
      }
    }
    const row = {
      id: u.id,
      season: u.season,
      team: u.team,
      side: u.side,
      caller: u.caller,
      sure: u.sure !== false,
      wk: u.wk,
      hc: u.hc || [],
      era: u.era || null,
      small: !!u.small,
      plays: u.m.plays ?? null,
      games: u.m.games ?? null,
      m,
    }
    if (Object.keys(pair).length) row.pair = pair
    // Units that looked most like this one: [caller, season, team, share of pairs further apart].
    const comps = (u.comps || []).filter((c) => UNITS[c[0]]).map((c) => [UNITS[c[0]].caller, UNITS[c[0]].season, UNITS[c[0]].team, c[2]])
    if (comps.length) row.comps = comps
    if (u.arrival && Array.isArray(u.arrival.changes) && u.arrival.changes.length) {
      const prev = UNITS[u.arrival.prev]
      const known = new Set(page.unitMetrics[u.side].map((x) => x.key))
      row.arrival = {
        caller: u.arrival.prev_caller,
        prev: prev ? { season: prev.season, team: prev.team, side: prev.side, wk: prev.wk } : null,
        changes: u.arrival.changes.filter((c) => known.has(c[0])).map((c) => [c[0], c[1], c[2]]),
      }
    }
    unitFiles[u.season].units[u.id] = row
  }

  // ---- lineage: the page's chainOf() and kidsOf() ----
  const kidsOf = {}
  for (const [name, e] of Object.entries(TREE)) (kidsOf[e.mentor] = kidsOf[e.mentor] || []).push(name)
  for (const k of Object.keys(kidsOf)) kidsOf[k].sort()
  function lineage(name) {
    const steps = []
    const seen = new Set()
    let at = name
    while (at && TREE[at] && !seen.has(at)) {
      seen.add(at)
      steps.push(TREE[at].mentor)
      at = TREE[at].mentor
    }
    const first = TREE[name] || null
    return {
      // Mentor, his mentor, and so on back to the root of the tree. Each is [name, has a page].
      chain: steps.map((n) => [n, isPerson(n)]),
      role: first ? first.role : null,
      also: first && first.also ? first.also.map((a) => [a.mentor, a.role]) : [],
      root: steps.length ? at || steps[steps.length - 1] : null,
      kids: (kidsOf[name] || []).map((n) => [n, isPerson(n)]),
    }
  }

  // Men the tree names who have no page: ancestors whose careers predate the data, or who
  // never held a head job in it. Kept so that asking for one gets a true answer, not a
  // near-miss on somebody else's name.
  const ancestors = [...new Set(Object.entries(TREE).flatMap(([name, e]) => [name, e.mentor, ...(e.also || []).map((a) => a.mentor)]))]
    .filter((n) => !isPerson(n))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ name: n, under: (kidsOf[n] || []).map((k) => [k, isPerson(k)]) }))

  // ---- people ----
  const people = {}
  const index = []
  const names = [...new Set([...Object.keys(COACHES), ...Object.keys(CALLERS)])].sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    const c = COACHES[name]
    const k = CALLERS[name]
    const person = { name }
    const row = { name, hc: !!c, sides: [] }

    if (c) {
      const car = c.career
      // The page ranks a career only from three seasons on (renderCoach's `qualified`).
      const qualified = car.seasons >= page.minSeasons
      const m = {}
      const part = {}
      if (qualified) {
        for (const mt of page.metrics) {
          const v = car[mt.key]
          if (miss(v)) continue
          if (isD4(mt.key) && !(car.d4_g >= page.d4MinGames)) continue
          m[mt.key] = [v, percentile(v, careerPool[mt.key], mt.lowerIsBetter)]
          // A career figure is the games-weighted mean of the seasons that carry the number.
          // When some of his seasons do not, say how many did.
          const n = c.seasons.filter((s) => !miss(s[mt.key])).length
          if (n > 0 && n < c.seasons.length) part[mt.key] = n
        }
      }
      const hc = {
        teams: car.teams || [],
        first: car.first,
        last: car.last,
        seasons: car.seasons,
        w: car.w, l: car.l, t: car.t,
        winpct: car.winpct ?? null,
        pw: car.pw, pl: car.pl,
        po: car.po,
        sb: car.sb,
        // The page's badges: Super Bowls reached and lost, and his best regular season.
        sbLost: c.seasons.filter((s) => s.best === 4 && !s.sb).length,
        bestWins: c.seasons.length ? Math.max(...c.seasons.map((s) => s.w)) : null,
        waa: car.waa ?? null,
        qualified,
        m,
      }
      if (Object.keys(part).length) hc.part = part
      if (car.d4_n) {
        const yrs = c.seasons.filter((s) => s.d4_n)
        hc.d4 = {
          n: car.d4_n,
          g: car.d4_g ?? null,
          first: yrs.length ? yrs[0].season : null,
          last: yrs.length ? yrs[yrs.length - 1].season : null,
          follow: car.d4_follow ?? null, dg: car.d4_dg, dgGo: car.d4_dg_go,
          followP: car.d4_follow_p ?? null, pg: car.d4_pg, pgGo: car.d4_pg_go,
          lostG: car.d4_lost_g ?? null,
          small: car.d4_n < page.d4SmallSample,
          worst: (car.d4_worst || []).map((w) => ({ season: w.season, wk: w.wk, opp: w.opp, ytg: w.ytg, spot: w.spot, q: w.q, t: w.t, sd: w.sd ?? null, ch: w.ch, best: w.best, lost: w.lost })),
        }
      }
      // Season by season, oldest first, as the data has them. The page's table columns.
      hc.rows = c.seasons.map((s) => {
        const r = { season: s.season, team: s.team, w: s.w, l: s.l, t: s.t, best: s.best || 0, sb: s.sb ? 1 : 0 }
        for (const key of ['waa', 'off_epa', 'def_epa', 'pass_rate', 'proe', 'go_oe', 'd4_lost']) if (!miss(s[key])) r[key] = s[key]
        // Who called his team's plays: the page's callersCell(), in week order.
        if (s.units && s.units.length) {
          r.calls = {}
          for (const side of SIDES) {
            const ids = sortUnits(s.units.filter((id) => UNITS[id] && UNITS[id].side === side)).reverse()
            r.calls[side] = ids.map((id) => [UNITS[id].caller, UNITS[id].sure !== false, UNITS[id].wk[0], UNITS[id].wk[1]])
          }
        }
        return r
      })
      person.hc = hc
      Object.assign(row, { first: car.first, last: car.last, teams: car.teams || [], seasons: car.seasons, w: car.w, l: car.l, t: car.t, g: car.g || 0 })
    }

    if (k) {
      const ids = sortUnits(k.units || [])
      const calls = { seasons: new Set(ids.map((id) => UNITS[id].season)).size, units: [] }
      for (const side of SIDES) {
        const s = k[side]
        if (!s) continue
        row.sides.push(side)
        calls[side] = {
          units: s.units, plays: s.plays, games: s.games, teams: s.teams || [], first: s.first, last: s.last,
          unsure: s.unsure || 0,
          years: yearsLabel(ids.filter((id) => UNITS[id].side === side).map((id) => UNITS[id].season)),
          // Play-callers most like him: [name, share of caller pairs further apart].
          comps: (s.comps || []).map((x) => [x[0], x[2]]),
          // The same measure against the men the tree says he learned from: [name, share, primary mentor].
          mentors: (s.mentors || []).map((x) => [x[0], x[2], !!x[3]]),
        }
      }
      calls.units = ids.map((id) => {
        const u = UNITS[id]
        return { id, season: u.season, team: u.team, side: u.side, wk: u.wk, sure: u.sure !== false, small: !!u.small, plays: u.m.plays ?? null, games: u.m.games ?? null }
      })
      // The unit the page opens first (pickUnit): his newest one with enough snaps to rank.
      const pick = ids.find((id) => !UNITS[id].small) || ids[0]
      if (pick) calls.pick = pick
      person.calls = calls
      const g = Math.max(row.g || 0, ...SIDES.map((s) => (k[s] ? k[s].games || 0 : 0)))
      row.g = g
      if (!c) {
        const sides = SIDES.map((s) => k[s]).filter(Boolean)
        Object.assign(row, {
          first: Math.min(...sides.map((s) => s.first)),
          last: Math.max(...sides.map((s) => s.last)),
          teams: [...new Set(sides.flatMap((s) => s.teams || []))],
        })
      }
    }

    // The page draws the lineage on every head coach's page, and on a play-caller's only
    // when the tree has him or someone under him.
    if (c || TREE[name] || (kidsOf[name] || []).length) person.tree = lineage(name)

    people[name] = person
    index.push(row)
  }

  const meta = {
    schema: SCHEMA,
    name: 'Coaching Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/coaching-savant.html`,
    coachUrl: `${SITE}/coaching-savant.html#c={name}`,
    generated,
    source: data.source || null,
    seasons,
    firstSeason,
    latestSeason,
    // The season the in-season overlay covers and the regular-season week it runs through.
    // null when there is no overlay file.
    current: cur,
    overlaid,
    files: {
      coaches: `${SITE}/${BASE}/coaches.json`,
      profiles: `${SITE}/${BASE}/profiles/all.json`,
      units: `${SITE}/${BASE}/units/{season}.json`,
    },
    counts: { headCoaches: Object.keys(COACHES).length, playCallers: Object.keys(CALLERS).length, people: names.length, units: Object.keys(UNITS).length },
    rules: {
      minSeasons: page.minSeasons,
      d4MinGames: page.d4MinGames,
      d4SmallSample: page.d4SmallSample,
      d4From: d4Years.length ? Math.min(...d4Years) : null,
      callersFrom: unitYears.length ? unitYears[0] : null,
      unitSeasons: unitYears,
    },
    notes: {
      tree: data.treeNote || null,
      callers: data.callerNote || null,
      unconfirmed: page.unconfirmed,
      era: Object.fromEntries([...new Set(Object.values(UNITS).map((u) => u.era).filter(Boolean))].map((era) => [era, page.eraNote(era) || null])),
    },
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile always means the longer bar on the page.',
      career: `A head coach's career stats are ranked against the head coaches with at least ${page.minSeasons} seasons since ${firstSeason} who have a value for the stat. A coach with fewer seasons is not ranked.`,
      fourthDowns: `The fourth-down stats are ranked against the head coaches with at least ${page.d4MinGames} games in the seasons the fourth-down model covers. A coach with fewer is not ranked on them.`,
      units: 'A unit is ranked against the other units of the same season and the same side of the ball that have enough snaps to rank. A unit with too few snaps keeps its values and has no percentile.',
    },
    // How each kind of value is printed. (Called formats here: on this page a "unit" is an
    // offence or a defence.)
    formats: UNITS_OF_MEASURE,
    ancestors,
    rounds: page.rounds,
    superBowl: Object.fromEntries(seasons.map((s) => [s, superBowl(s)])),
    groups: page.groups,
    metrics: page.metrics.map((m) => ({ ...m, since: since[m.key] ?? null, pool: careerPool[m.key].length })),
    unitGroups: page.unitGroups,
    unitMetrics: page.unitMetrics,
    unitPools: ranked,
    row: {
      hc: 'Head-coaching record. w, l, t are regular season; pw, pl playoffs; po seasons that reached the playoffs; sb Super Bowls won; sbLost Super Bowls reached and lost; waa wins above what the closing spreads implied.',
      'hc.m': 'Career stats by key: [value, percentile]. Present only for a coach the page ranks. A stat that is absent has no value on the page; it is not zero.',
      'hc.part': 'For a career stat that some of his seasons do not carry: how many of his seasons it is averaged over.',
      'hc.d4': 'Fourth-down decisions scored by the nfl4th model. small is true under the small-sample line.',
      'hc.rows': 'Season by season. best is the playoff round reached (rounds), sb whether he won the Super Bowl. calls names who called the offence (O) and defence (D): [name, confirmed, first week, last week].',
      calls: 'What he called. units lists them newest first; pick is the one the page opens first.',
      tree: 'Hand-curated lineage (notes.tree). chain runs from his mentor back to the root; each entry is [name, whether he has a page].',
      ancestors: 'Men the tree names who have no page. under lists who the tree places directly under each: [name, whether he has a page].',
      'unit.m': 'Unit stats by key: [value, percentile]. The percentile is null for a unit with too few snaps to rank.',
      'unit.pair': 'For a few stats, EPA per snap with and without it: [with, without].',
      'unit.sure': 'false when no report names the play-caller (notes.unconfirmed).',
    },
  }

  const coaches = {
    schema: SCHEMA,
    generated,
    count: index.length,
    note: 'Everyone with a Coaching Savant page: head coaches since the first season, and play-callers since unit data begins. The name is the id. sides lists what he has called (O offence, D defence). g is games, used to order equally good name matches.',
    people: index,
  }

  const profiles = { schema: SCHEMA, generated, people }

  return { meta, coaches, profiles, units: unitFiles }
}

// ---- writing -------------------------------------------------------------------------

export function writeCoachingApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, 'coaching-savant-data.json')
  const currentFile = path.join(publicDir, 'coaching-savant-current.json')
  const pageFile = path.join(publicDir, 'coaching-savant.html')
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error('coaching-savant-data.json or coaching-savant.html is missing from public/')

  // The overlay is optional, as it is for the page: without it the archive stands alone.
  const out = buildCoachingApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    current: existsSync(currentFile) ? JSON.parse(readFileSync(currentFile, 'utf8')) : null,
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = []
  let raw = 0
  const add = (name, body, zip) => {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push(zip ? [`${name}.gz`, gzipSync(json, { level: 9 })] : [name, json])
  }
  add('meta.json', out.meta, false)
  add('coaches.json', out.coaches, false)
  add('profiles/all.json', out.profiles, true)
  for (const [season, body] of Object.entries(out.units)) add(`units/${season}.json`, body, true)

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'profiles'), { recursive: true })
  mkdirSync(path.join(root, 'units'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const n = out.meta.counts
  return {
    files: files.length,
    raw,
    bytes,
    summary: `${n.headCoaches} head coaches, ${n.playCallers} play-callers, ${n.units} units, ${out.meta.seasons.length} seasons`,
  }
}
