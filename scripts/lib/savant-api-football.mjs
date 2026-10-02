// Football Savant, cut up for machines. The NFL sibling of savant-api.mjs.
//
// The Football Savant page downloads a 44 MB archive (public/football-savant-data.json) plus
// a small file for the season in progress (public/football-savant-current.json), lays the
// second over the first, and works every percentile out in the browser. An AI assistant or a
// server function cannot do that to answer "where did he rank in EPA per dropback", and the
// raw files hold values only: the number a fan reads off a bar — "88th among quarterbacks"
// — is nowhere in them.
//
// This writes that answer down, once per build, as small files:
//
//   savant-api/football/v1/meta.json              seasons, positions, the stat glossary, pools
//   savant-api/football/v1/players.json           every player: id, name, position, span
//   savant-api/football/v1/seasons/<year>.json.gz one season: every player's bars, each with
//                                                 its percentile among his position that
//                                                 season and among his position all-time
//
// THE NUMBERS MUST MATCH THE PAGE. Football is not basketball, and the differences are the
// whole job:
//
//   - There is no league-wide pool. A cornerback and a center share no box score, so a bar is
//     ranked against QUALIFIED PLAYERS AT HIS POSITION (the page's default, "Position"), in
//     his season ("This season") or across every season the stat has existed ("All-time").
//     Both are written; the page's other switches (side of ball, the snap-share band) are not.
//   - His position is the one on that season's row. A lineman can be a guard one year and a
//     tackle the next, and is ranked with whichever he was.
//   - Which bars a card has is decided by position: cfg.panels says which panels a position
//     gets, cfg.metrics which stats sit in each, and the page drops a panel whose whole
//     sample is a rounding error (a receiver's three carries). The same rules are applied
//     here, so a file holds exactly the bars the card draws and nothing else.
//   - The two data files are merged the way the page merges them (its mergeData), so the
//     season in progress here is the twice-daily file, not the archive's stale copy.
//   - A percentile is the page's: midrank, flipped for lower-is-better stats, rounded, held
//     to 1..99, and absent when fewer than two men are in the pool.
//   - A stat its era never tracked is left out, not zero. A stat on too small a sample is
//     flagged, by the threshold that hollows out its bar.
//
// Almost every rule lives in the data file's own cfg block, so it is read from there. The
// few that live in the page (the words for each position's pool, the panel floors, the
// low-match line under weakness comps, the "what this page can't see" notes) are read out
// of public/football-savant.html at build time rather than copied.
//
// tools/savant-football/check.mjs proves all of it: it lifts the page's own functions out of
// the HTML, runs them over every player-season, and compares.
//
// Nothing here is committed. It is rebuilt from the data on every deploy, so the twice-daily
// refresh reaches these files by itself. Season files ship gzipped (Deployment Storage: see
// compress-data.mjs) and are requested as seasons/<year>.json.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/football/v1'
export const SCHEMA = 1
const PAGE = 'football-savant.html'

// How the page prints each unit (its fmt()), in words, so a reader of the raw value knows
// what it is holding.
const UNITS = {
  pct1: 'a percentage, already multiplied by 100 (27.8 means 27.8%)',
  num0: 'a whole number',
  num1: 'a number, shown to one decimal',
  num2: 'a number, shown to two decimals',
  num3: 'a number, shown to three decimals without its leading zero (.142)',
  sgn1: 'a signed number, shown with its sign to one decimal (+2.1)',
  sgn3: 'a signed number, shown with its sign to three decimals (+.142)',
  sec: 'seconds, shown to two decimals',
  inch: 'inches',
  lb: 'pounds',
  ftin: 'inches (the page shows feet and inches)',
}

// ---- reading the page ----------------------------------------------------------------

// Index of the brace that closes the one at `open`, skipping strings.
function closing(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

// `var NAME={ ... };` in the page, as the object it describes. These are plain literals
// (strings, numbers, arrays, a few strings joined with +), so evaluating one runs no code
// of the page's; it only saves re-typing its contents here.
function literal(html, name) {
  const at = html.search(new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\{`))
  if (at < 0) throw new Error(`${name} not found in ${PAGE}`)
  const open = html.indexOf('{', at)
  const end = closing(html, open)
  if (end < 0) throw new Error(`${name} could not be read out of ${PAGE}`)
  let value
  try { value = vm.runInNewContext(`(${html.slice(open, end + 1)})`, {}, { timeout: 1000 }) } catch (e) {
    throw new Error(`${name} in ${PAGE} is no longer a plain object: ${e.message}`)
  }
  // Out of the sandbox and into ordinary objects.
  return JSON.parse(JSON.stringify(value))
}

export function readPage(html) {
  const cohortWord = literal(html, 'COHORT_WORD')   // QB -> "quarterbacks"
  const panelFloor = literal(html, 'PANEL_FLOOR')   // rush -> ['car', 12]
  const gaps = literal(html, 'GAPS_BY_POS')         // "What this page can't see", by position
  // prepData() copies the line's entries onto tackle, guard and centre.
  const clone = html.match(/\[([^\]]*)\]\.forEach\(function\(k\)\{\s*SIDE\[k\]=SIDE\.OL;[^}]*GAPS_BY_POS\[k\]=GAPS_BY_POS\.OL;/)
  if (!clone) throw new Error(`the line-position cloning in prepData() changed in ${PAGE}`)
  const line = ['OL', ...(clone[1].match(/[A-Z]+/g) || [])]   // the line, and its three spots
  for (const k of line) if (gaps.OL && !gaps[k]) gaps[k] = gaps.OL
  // renderWeak(): at or under this best match, the page says nobody shares the profile.
  const low = html.match(/var\s+weak\s*=\s*best\s*<=\s*(\d+)\s*;/)
  if (!low) throw new Error(`the low-match line in renderWeak() changed in ${PAGE}`)
  return { cohortWord, panelFloor, gaps, line, lowMatch: +low[1] }
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

const yearOf = (season) => +String(season).slice(0, 4)

// The page's eraOK(): a stat exists from its `since` year on. Before that the bar is absent.
export const tracked = (metric, season) => yearOf(season) >= metric.since

// The page's mergeData(): the season in progress lives in its own small file. Where both
// files carry a season the more recently generated one wins, and the stat table comes from
// whichever was built last. Returns a new object; neither input is touched.
export function mergeData(base, cur) {
  const data = { ...base.data }
  const from = Object.fromEntries(Object.keys(data).map((s) => [s, base.generated || null]))
  let cfg = base.cfg
  let generated = base.generated || null
  if (cur && cur.data) {
    const newer = !base.generated || !cur.generated || cur.generated >= base.generated
    for (const s of Object.keys(cur.data)) {
      if (!data[s] || newer) { data[s] = cur.data[s]; from[s] = cur.generated || null }
    }
    if (cur.cfg && (newer || !cfg)) cfg = cur.cfg
    if (newer && cur.generated) generated = cur.generated
  }
  const seasons = Object.keys(data).sort((a, b) => +b - +a)
  return { seasons, data, cfg, from, generated, source: base.source || (cur && cur.source) || null }
}

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

// The page's pctRaw() and pctOf(): midrank percentile against a sorted pool, 1..99, whole
// numbers; nothing at all when the pool has fewer than two values.
export function percentile(v, sorted, lower) {
  const n = sorted ? sorted.length : 0
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

// The page's sampleOf(): a stat is on too small a sample when its denominator is known and
// under the stat's threshold.
export function lowSample(p, metric) {
  if (!metric.thr || !metric.den) return false
  const n = (p.d || {})[metric.den]
  return n != null && n < metric.thr
}

// The page's panelWorthIt(): a panel whose whole denominator is a rounding error is dropped.
// Running is a back's and a quarterback's job and catching a receiver's, thin or not.
export function panelWorthIt(group, p, pos, floors) {
  const f = floors[group]
  if (!f) return true
  if (group === 'rush' && (pos === 'RB' || pos === 'QB')) return true
  if (group === 'rec' && (pos === 'WR' || pos === 'TE')) return true
  const d = p.d || {}
  let have = d[f[0]]
  if (have == null && group === 'rec') have = d.rec   // before 2012 there are no targets
  return have != null && have >= f[1]
}

// ---- checking the inputs ---------------------------------------------------------------

function checkConfig(cfg, page) {
  if (!cfg || !Array.isArray(cfg.metrics) || !cfg.metrics.length) throw new Error('football data: cfg.metrics is missing or empty')
  for (const m of cfg.metrics) {
    const ok = typeof m.key === 'string' && typeof m.label === 'string' && typeof m.grp === 'string' &&
      typeof m.unit === 'string' && Array.isArray(m.pos) && Number.isFinite(m.since)
    if (!ok) throw new Error(`football data: malformed metric ${JSON.stringify(m).slice(0, 80)}`)
  }
  for (const k of ['panels', 'posLabel', 'groupLabel', 'headline', 'qualify', 'denoms']) {
    if (!cfg[k] || typeof cfg[k] !== 'object') throw new Error(`football data: cfg.${k} is missing`)
  }
  for (const pos of Object.keys(cfg.posLabel)) {
    if (!page.cohortWord[pos]) throw new Error(`${PAGE}: COHORT_WORD has no word for ${pos}`)
    if (!Array.isArray(cfg.panels[pos])) throw new Error(`football data: cfg.panels has no ${pos}`)
  }
}

// ---- building ------------------------------------------------------------------------

const sorted = (a) => Float64Array.from(a).sort()

export function buildFootballApi({ data, current = null, html }) {
  if (!data || !data.data || typeof data.data !== 'object') throw new Error('football-savant-data.json: expected { data, cfg }')
  const page = readPage(html)
  const merged = mergeData(data, current)
  const cfg = merged.cfg
  checkConfig(cfg, page)

  const metrics = cfg.metrics
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]))
  const positions = Object.keys(cfg.posLabel)
  const latest = merged.seasons[0]
  const playersOf = (season) => merged.data[season].players
  for (const season of merged.seasons) {
    if (!/^\d{4}$/.test(season)) throw new Error(`football data: "${season}" is not a season`)
    if (!Array.isArray((merged.data[season] || {}).players)) throw new Error(`football data: season ${season} has no players`)
    for (const p of playersOf(season)) {
      if (typeof p.id !== 'string' || !p.name || !cfg.posLabel[p.pos]) {
        throw new Error(`football data: ${season} has a row with no id, no name or an unknown position (${JSON.stringify([p.id, p.name, p.pos])})`)
      }
    }
  }

  // ---- pools: the page's poolVals(), for both of its baselines ----
  // seasonPool[season][pos][key] and allPool[pos][key]: the qualified players at the position
  // who have a value, from seasons that tracked the stat.
  const seasonPool = {}
  const allRaw = {}
  const poolCount = { all: {} }
  const seasonHas = {}
  for (const season of merged.seasons) {
    const raw = {}
    const count = {}
    const has = new Set()
    for (const p of playersOf(season)) {
      const mm = p.m || {}
      for (const k in mm) if (mm[k] != null) has.add(k)
      if (!p.qualified) continue
      count[p.pos] = (count[p.pos] || 0) + 1
      const mine = (raw[p.pos] = raw[p.pos] || {})
      for (const k in mm) {
        const m = byKey[k]
        if (!m || !tracked(m, season) || miss(mm[k])) continue
        ;(mine[k] = mine[k] || []).push(mm[k])
      }
    }
    seasonPool[season] = {}
    for (const pos of Object.keys(raw)) {
      seasonPool[season][pos] = {}
      const all = (allRaw[pos] = allRaw[pos] || {})
      for (const k of Object.keys(raw[pos])) {
        seasonPool[season][pos][k] = sorted(raw[pos][k])
        ;(all[k] = all[k] || []).push(raw[pos][k])
      }
    }
    poolCount[season] = count
    for (const pos of Object.keys(count)) poolCount.all[pos] = (poolCount.all[pos] || 0) + count[pos]
    seasonHas[season] = has
  }
  const allPool = {}
  for (const pos of Object.keys(allRaw)) {
    allPool[pos] = {}
    for (const k of Object.keys(allRaw[pos])) allPool[pos][k] = sorted(allRaw[pos][k].flat())
  }

  // ---- the stats a position's card can carry, in the page's order ----
  // render() walks cfg.panels[pos]; groupBlocks() takes the metrics of that panel whose
  // `pos` lists the position, in table order.
  const card = {}
  for (const pos of positions) {
    card[pos] = (cfg.panels[pos] || ['ctx']).map((g) => [g, metrics.filter((m) => m.grp === g && m.pos.includes(pos))])
  }

  // ---- the profile score behind the page's career arc: profileScore() ----
  // The mean season percentile across the position's headline stats. Settled stats are
  // preferred; with fewer than two of those it falls back to whatever exists.
  function profileScore(p, season) {
    if (!p.qualified) return null
    const strict = []
    const loose = []
    for (const k of cfg.headline[p.pos] || []) {
      const m = byKey[k]
      if (!m || !tracked(m, season)) continue
      const v = (p.m || {})[k]
      if (miss(v)) continue
      const pct = percentile(v, ((seasonPool[season] || {})[p.pos] || {})[k], m.lower)
      if (pct == null) continue
      loose.push(pct)
      if (!lowSample(p, m)) strict.push(pct)
    }
    const use = strict.length >= 2 ? strict : loose.length ? loose : null
    return use ? use.reduce((a, b) => a + b, 0) / use.length : null
  }

  // ---- the index, and each man's peak ----
  // Seasons run newest first, so first sight of a player is his most recent season.
  const index = new Map()
  const scores = new Map() // id -> { season: raw score }
  for (const season of merged.seasons) {
    for (const p of playersOf(season)) {
      const seen = index.get(p.id)
      if (seen) { seen.from = season; seen.all.push(season) }
      else index.set(p.id, { id: p.id, name: p.name, pos: p.pos, team: p.team || null, from: season, to: season, all: [season] })
      const sc = profileScore(p, season)
      if (sc != null) {
        if (!scores.has(p.id)) scores.set(p.id, {})
        scores.get(p.id)[season] = sc
      }
    }
  }
  // careerArc(): the peak is his best score, and the earliest season wins a tie.
  for (const [id, mine] of scores) {
    let peak = null
    for (const season of Object.keys(mine).sort()) if (peak == null || mine[season] > mine[peak]) peak = season
    index.get(id).peak = peak
  }

  // ---- season files ----
  const seasons = {}
  for (const season of merged.seasons) {
    const block = merged.data[season]
    const pool = seasonPool[season]
    // Position by position, in the page's order: rows of one shape sit together, which is
    // worth a sixth of the file once it is gzipped. Within a position the data's order stands.
    const inOrder = playersOf(season).map((p, i) => [p, i])
      .sort((a, b) => positions.indexOf(a[0].pos) - positions.indexOf(b[0].pos) || a[1] - b[1])
    const rows = inOrder.map(([p]) => {
      const pos = p.pos
      const d = p.d || {}
      const mine = (pool[pos] || {})
      const every = allPool[pos] || {}
      const m = {}
      const low = []
      const off = []
      for (const [group, list] of card[pos] || []) {
        if (!panelWorthIt(group, p, pos, page.panelFloor)) { off.push(group); continue }
        for (const mt of list) {
          const v = (p.m || {})[mt.key]
          if (!tracked(mt, season) || miss(v)) continue   // barRow(): absent, not zero
          m[mt.key] = [v, percentile(v, mine[mt.key], mt.lower), percentile(v, every[mt.key], mt.lower)]
          if (lowSample(p, mt)) low.push(mt.key)
        }
      }

      const row = { id: p.id, name: p.name, team: p.team || null, pos, qualified: !!p.qualified }
      if (p.tms && p.tms.length > 1) row.tms = p.tms
      for (const k of ['age', 'exp', 'college', 'rec', 'po', 'coach', 'acc', 'inj']) if (p[k] != null) row[k] = p[k]
      if (p.dr) row.draft = { round: p.dr, pick: p.dp ?? null, year: p.dy ?? null, team: p.dt ?? null }
      else if (p.udfa) row.udfa = true
      // Only the denominators the page has a word for.
      row.d = Object.fromEntries(Object.keys(cfg.denoms).filter((k) => d[k] != null).map((k) => [k, d[k]]))
      row.m = m
      if (low.length) row.low = low
      if (off.length) row.off = off
      // The page prints the score on the career-arc button, which needs two seasons to exist.
      const sc = (scores.get(p.id) || {})[season]
      if (sc != null && index.get(p.id).all.length >= 2) row.score = Math.round(sc)
      // Comps are men from the same season file, so an id and a score is all they need.
      if (p.comps && p.comps.length) row.comps = p.comps.map((c) => [c.id, c.score])
      if (p.wflaws && p.wflaws.length) row.wflaws = p.wflaws.map((f) => [f.k, f.pct])
      if (p.wcomps && p.wcomps.length) row.wcomps = p.wcomps.map((c) => [c.id, c.score])
      return row
    })

    seasons[season] = {
      schema: SCHEMA,
      season,
      generated: merged.from[season],
      week: block.week || null,
      weekPlaying: block.weekPlaying || null,
      pools: poolCount[season],
      // The page's notYet(): tracked by this era, but nobody in the season has one.
      notYet: metrics.filter((m) => tracked(m, season) && !seasonHas[season].has(m.key)).map((m) => m.key),
      players: rows,
    }
  }

  const top = merged.data[latest] || {}
  const word = (k) => cfg.denoms[k] || k
  const meta = {
    schema: SCHEMA,
    name: 'Football Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/${PAGE}`,
    playerUrl: `${SITE}/${PAGE}#p={id}&s={season}`,
    generated: merged.generated,
    source: merged.source,
    latestSeason: latest,
    // Set while the latest season is still being played: the page says "through week N".
    live: top.week ? { season: latest, week: top.week, weekPlaying: top.weekPlaying || null } : null,
    seasons: merged.seasons,
    files: {
      players: `${SITE}/${BASE}/players.json`,
      season: `${SITE}/${BASE}/seasons/{season}.json`,
    },
    positions: Object.fromEntries(positions.map((pos) => [pos, {
      label: cfg.posLabel[pos],
      peers: page.cohortWord[pos],
      panels: cfg.panels[pos],
      headline: cfg.headline[pos] || [],
      qualify: cfg.qualify[pos] ? { den: cfg.qualify[pos][0], word: word(cfg.qualify[pos][0]), min: cfg.qualify[pos][1] } : null,
      qualifyFallback: (cfg.qualifyFallback || {})[pos]
        ? { den: cfg.qualifyFallback[pos][0], word: word(cfg.qualifyFallback[pos][0]), min: cfg.qualifyFallback[pos][1] }
        : null,
      cannotSee: page.gaps[pos] || null,
    }])),
    groups: cfg.groupLabel,
    denoms: cfg.denoms,
    units: UNITS,
    panelFloor: page.panelFloor,
    pools: poolCount,
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile is always the better mark. With fewer than two players in the pool there is no percentile.',
      pool: 'Qualified players at the same position who have a value for the stat. Position is the one he played that season. A player who did not qualify is still ranked against that pool, and is marked qualified: false.',
      season: 'Against qualified players at his position in the same season. This is what the page shows first ("Rank against: This season").',
      allTime: 'Against qualified players at his position in every season that tracked the stat, the season in progress included ("Rank against: All-time").',
      qualify: 'The qualifying line is a full-season count for the position (positions[].qualify). Where a season has no such count for him it falls back to positions[].qualifyFallback. While a season is being played the line is pro-rated to the games his team has played.',
    },
    metrics: metrics.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.grp,
      sub: m.sub || null,
      layer: m.layer,
      unit: m.unit,
      positions: m.pos,
      lowerIsBetter: !!m.lower,
      since: m.since,
      den: m.den || null,
      lowSampleBelow: m.thr || null,
      what: (m.exp && m.exp.w) || null,
      formula: (m.exp && m.exp.f) || null,
      why: (m.exp && m.exp.y) || null,
    })),
    weakness: { lowMatch: page.lowMatch },
    caveats: {
      // Not printed on the page; from pipeline/football/README.md. A lineman's games count
      // is only right where snap counts exist. Before them it is the games he was flagged in.
      lineGames: byKey.snaps ? { positions: page.line.filter((pos) => cfg.posLabel[pos]), before: byKey.snaps.since } : null,
    },
    row: {
      id: 'Player id. Use it in playerUrl.',
      pos: 'His position that season (positions has the labels). It can change from one season to the next.',
      team: 'The team he finished the season with. tms lists every team he appeared for that season, in order, when there was more than one.',
      qualified: 'Whether he is in the percentile pools that season.',
      d: 'What his rates are built on, by denominator (denoms has the words): games, dropbacks, carries, targets, snaps and so on.',
      m: 'The bars on his card, by stat key: [value, percentile among his position that season, percentile among his position all-time]. A stat that is absent was not tracked that season, has no value for him, or belongs to a panel the page drops for too small a sample. It is not zero.',
      off: 'Panels the page leaves off his card because their whole sample is under the floor in panelFloor (a receiver\'s three carries).',
      low: 'Keys of stats whose denominator is under the stabilization threshold (metrics[].lowSampleBelow of metrics[].den). Quote them with that caveat.',
      score: 'Profile score: the mean season percentile across his position\'s headline stats (positions[].headline), as on the page\'s career-arc button. Qualified seasons only, and only for players with two or more seasons.',
      rec: 'His team\'s record: [wins, losses, ties]. po is how its season ended; coach is its head coach.',
      acc: 'Where he ranked in the whole NFL in a counting stat: r is the rank, s the stat.',
      inj: 'This week\'s injury report, season in progress only: st the status, inj the injury, wk the week.',
      draft: 'Round, overall pick, year and team. udfa: true means he went undrafted.',
    },
    extras: {
      comps: 'Statistical Comps: the closest profiles among qualified players at his position that season, by the position\'s headline stats. [id, percent match]; the id is another player in the same season file.',
      wflaws: 'Where he ranks worst: [stat key, percentile among qualified players at his position that season], below the 40th only, worst first.',
      wcomps: 'Weakness Comps: the qualified players at his position who share his flaws. [id, percent match]. At or under weakness.lowMatch the page says nobody really shares the profile.',
    },
    season: {
      week: 'Set while the season is being played: the numbers run through this week.',
      weekPlaying: 'Set when a later week is under way.',
      pools: 'Qualified players at each position that season.',
      notYet: 'Stats the era tracks but nobody in this season has yet. Some charting is published a season at a time, after it ends.',
    },
  }

  // The index is the one file every question loads, so it is kept lean: arrays rather than
  // objects, years as numbers, and the rare list of missed seasons only where there is one.
  const have = new Set(merged.seasons)
  const cols = ['id', 'name', 'pos', 'team', 'from', 'to', 'seasons', 'peak', 'skip']
  const players = {
    schema: SCHEMA,
    generated: merged.generated,
    count: index.size,
    note: 'One row per player, as arrays in the order of cols. pos and team are from his most recent season (to). from and to are the first and last seasons he appears in and seasons is how many. peak is his best qualified season by profile score (0 if he never had one). skip, present only when needed, lists the seasons in between with no stats.',
    cols,
    players: [...index.values()].map((r) => {
      const mine = new Set(r.all)
      const skip = []
      for (let y = +r.from + 1; y < +r.to; y++) if (have.has(String(y)) && !mine.has(String(y))) skip.push(y)
      const row = [r.id, r.name, r.pos, r.team, +r.from, +r.to, r.all.length, r.peak ? +r.peak : 0]
      if (skip.length) row.push(skip)
      return row
    }),
  }

  return { meta, players, seasons }
}

// ---- writing -------------------------------------------------------------------------

const commas = (n) => Number(n).toLocaleString('en-US')

export function writeFootballApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, 'football-savant-data.json')
  const currentFile = path.join(publicDir, 'football-savant-current.json')
  const pageFile = path.join(publicDir, PAGE)
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error(`football-savant-data.json or ${PAGE} is missing from public/`)

  // The page carries on without the current file, so this does too.
  let current = null
  if (existsSync(currentFile)) {
    try { current = JSON.parse(readFileSync(currentFile, 'utf8')) } catch { current = null }
  }
  const out = buildFootballApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    current,
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = [
    ['meta.json', Buffer.from(JSON.stringify(out.meta))],
    ['players.json', Buffer.from(JSON.stringify(out.players))],
  ]
  let raw = 0
  let rows = 0
  for (const [season, body] of Object.entries(out.seasons)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    rows += body.players.length
    files.push([`seasons/${season}.json.gz`, gzipSync(json, { level: 9 })])
  }

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'seasons'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const live = out.meta.live ? `, ${out.meta.live.season} through week ${out.meta.live.week}` : ''
  return {
    files: files.length,
    raw,
    bytes,
    summary: `${commas(out.players.count)} players, ${commas(rows)} player-seasons, ${Object.keys(out.seasons).length} seasons${live}`,
  }
}
