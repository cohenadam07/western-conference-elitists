// Basketball Savant, cut up for machines. Runs after `vite build` writes dist/.
//
// The Savant page downloads one 67 MB file (public/savant-data.json) and works every
// percentile out in the browser. That is fine for a person with the page open and useless
// for anything else: an AI assistant, a script, or a server function cannot load 67 MB to
// answer "where does he rank in true shooting", and the raw file holds values only, so the
// number a fan actually sees on a card — "94th percentile vs. guards" — is nowhere in it.
//
// This writes that answer down, once per build, as small files:
//
//   dist/savant-api/basketball/v1/meta.json            seasons, the stat glossary, pool sizes
//   dist/savant-api/basketball/v1/players.json         every player: id, name, position, span
//   dist/savant-api/basketball/v1/seasons/<s>.json.gz  one season: every player's values with
//                                                      the league and position percentile
//
// THE NUMBERS MUST MATCH THE PAGE. Everything the page decides is decided the same way here,
// and read from the page itself rather than copied, so the two cannot drift quietly:
//
//   - the stat list (CFG.metrics), and which seasons track which stat, come out of
//     public/basketball-savant.html
//   - so do the position corrections (POS_FIX_ID / POS_FIX_NAME), which change who counts as
//     a guard and therefore every "vs. guards" number
//   - a percentile is the page's: midrank among that season's qualified players, flipped
//     for lower-is-better stats, rounded, held to 1..99
//   - a stat its era never tracked is left out, not zero; a stat on too few attempts is
//     flagged low sample, by the same threshold that hatches its bar
//
// `npm run check:savant-api` (tools/savant-api/check.mjs) proves it: it lifts the page's own
// functions out of the HTML, runs them over every player-season, and compares.
//
// Nothing here is committed. The files are rebuilt from savant-data.json on every deploy, so
// the nightly data push refreshes them by itself. Season files ship gzipped for the reason in
// compress-data.mjs (Deployment Storage); vercel.json rewrites <season>.json to the .gz.
//
// If the page changes shape and this can no longer read it, the build carries on without
// these files and says so in the log. The site is never held back by its own API.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeCoachingApi } from './savant-api-coaching.mjs'
import { writeDraftApi } from './savant-api-draft.mjs'
import { writeFootballApi } from './savant-api-football.mjs'
import { writeSiteApi } from './savant-api-site.mjs'
import { writeUfcApi } from './savant-api-ufc.mjs'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/basketball/v1'
export const SCHEMA = 1
export const POSITIONS = ['Guard', 'Wing', 'Big']

// The page's own labels for the four groups and the four windows.
const GROUPS = { ctx: 'Context', off: 'Offense', def: 'Defense', val: 'Overall value' }
const WINDOW_LABELS = { season: 'Full season', l10: 'Last 10', l25: 'Last 25', l75: 'Last 75' }

// How the page prints each unit (its fmt()), in words, so a reader of the raw value knows
// what it is holding.
const UNITS = {
  pct3: 'a rate from 0 to 1, shown to three places (.558)',
  pct1: 'a percentage, already multiplied by 100 (27.8 means 27.8%)',
  num0: 'a whole number',
  num1: 'a number, shown to one decimal',
  num2: 'a number, shown to two decimals',
  num3: 'a number, shown to three decimals (.142)',
  sgn: 'a signed number, shown with its sign to one decimal (+2.1)',
  ftin: 'inches (the page shows feet and inches)',
  lb: 'pounds',
  sec: 'seconds',
  inch: 'inches',
  word: 'the page shows only a tier word from the percentile: elite 82+, high 62+, avg 40+, low below 40',
  wnum: 'the page shows the tier word with the number in brackets',
  wsgn: 'the page shows the tier word with the signed number in brackets',
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
  throw new Error('unbalanced JSON in basketball-savant.html')
}

// `const NAME = { 1629029:'Guard' };` -> { 1629029: 'Guard' }
function posFix(html, name) {
  const m = html.match(new RegExp(`const\\s+${name}\\s*=\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`${name} not found in basketball-savant.html`)
  const out = {}
  const pair = /(?:'([^']*)'|"([^"]*)"|([\w.-]+))\s*:\s*(?:'([^']*)'|"([^"]*)")/g
  for (const p of m[1].matchAll(pair)) {
    const key = p[1] ?? p[2] ?? p[3]
    const pos = p[4] ?? p[5]
    if (!POSITIONS.includes(pos)) throw new Error(`${name}: unknown position "${pos}"`)
    out[key] = pos
  }
  return out
}

// The plain-language line behind each stat (the page's EXPL). Optional: a stat with no
// line simply has none.
function explanations(html) {
  const at = html.indexOf('const EXPL={')
  if (at < 0) return {}
  const end = html.indexOf('\n};', at)
  if (end < 0) return {}
  const out = {}
  for (const line of html.slice(at, end).split('\n')) {
    const m = line.match(/^\s*([a-z0-9_]+)\s*:\s*(".*")\s*,?\s*$/)
    if (!m) continue
    try { out[m[1]] = JSON.parse(m[2]) } catch { /* not a plain string: skip it */ }
  }
  return out
}

// The page's own leaderboard builder: the stat it opens ranked by, the columns it shows by
// default (LB_COMMON), and how many rows it lists. The connector's leaderboard and its
// side-by-side comparison start from the same stats, so "the headline stats" means the same
// thing in an answer as on the page. Optional: without it the connector falls back to its own
// short list.
function leaderboardDefaults(html, keys) {
  const state = html.match(/var\s+LB\s*=\s*\{[^}]*?rankKey\s*:\s*'(\w+)'[^}]*?topN\s*:\s*(\d+)/)
  const common = html.match(/var\s+LB_COMMON\s*=\s*\[([^\]]*)\]/)
  if (!state || !common) return null
  const list = [...common[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((k) => keys.has(k))
  if (!keys.has(state[1]) || !list.length) return null
  return { rank: state[1], common: list, rows: +state[2] }
}

export function readPageConfig(html) {
  const at = html.search(/const\s+CFG\s*=\s*\{/)
  if (at < 0) throw new Error('CFG not found in basketball-savant.html')
  const start = html.indexOf('{', at)
  const cfg = JSON.parse(html.slice(start, jsonEnd(html, start) + 1))
  if (!Array.isArray(cfg.metrics) || !cfg.metrics.length) throw new Error('CFG.metrics is empty')
  for (const m of cfg.metrics) {
    if (typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.since !== 'string') {
      throw new Error(`CFG.metrics: malformed entry ${JSON.stringify(m).slice(0, 80)}`)
    }
  }
  if (!Array.isArray(cfg.windows) || cfg.windows[0] !== 'season') throw new Error('CFG.windows changed')
  return {
    cfg,
    posFixId: posFix(html, 'POS_FIX_ID'),
    posFixName: posFix(html, 'POS_FIX_NAME'),
    explain: explanations(html),
    leaderboard: leaderboardDefaults(html, new Set(cfg.metrics.map((m) => m.key))),
  }
}

// ---- the page's arithmetic -------------------------------------------------------------

// The page's _norm(): lower case, accents stripped.
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// The page's miss(): null, NaN and Infinity are all "no data".
export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

const startYear = (season) => +String(season).slice(0, 4)

// A stat exists from its `since` season on. Before that the page hides the bar outright.
export const tracked = (metric, season) => startYear(season) >= startYear(metric.since)

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

// The page's pctOf(): midrank percentile against a pool, 1..99, whole numbers. `sorted` is
// the pool in ascending order; counting below and equal by bisection gives the same two
// counts the page gets by walking the pool.
export function percentile(v, sorted, lower) {
  const n = sorted.length
  if (v == null || n < 2) return null
  const less = lowerBound(sorted, v)
  const eq = upperBound(sorted, v) - less
  const pct = (100 * (less + 0.5 * eq)) / n
  return Math.max(1, Math.min(99, Math.round(lower ? 100 - pct : pct)))
}

const cell = (p, key, w) => { const c = p.m && p.m[key] && p.m[key][w]; return c || null }

// ---- building ------------------------------------------------------------------------

// One season, one window: every stat's sorted pool, league-wide and per position. A pool is
// that season's QUALIFIED players with a value for the stat — the page's poolVals().
function pools(players, metrics, w) {
  const out = {}
  for (const m of metrics) {
    const league = []
    const byPos = { Guard: [], Wing: [], Big: [] }
    for (const p of players) {
      if (!p.qualified) continue
      const c = cell(p, m.key, w)
      const v = c ? c.v : null
      if (miss(v)) continue
      league.push(v)
      if (byPos[p.pos]) byPos[p.pos].push(v)
    }
    const sort = (a) => Float64Array.from(a).sort()
    out[m.key] = { league: sort(league), Guard: sort(byPos.Guard), Wing: sort(byPos.Wing), Big: sort(byPos.Big) }
  }
  return out
}

// One player, one window -> { m: { key: [value, leaguePct, positionPct] }, low: [keys] }
function stats(p, season, metrics, pool, w) {
  const m = {}
  const low = []
  for (const mt of metrics) {
    if (!tracked(mt, season)) continue
    const c = cell(p, mt.key, w)
    const v = c ? c.v : null
    if (miss(v)) continue
    const ps = pool[mt.key]
    m[mt.key] = [v, percentile(v, ps.league, mt.lower), ps[p.pos] ? percentile(v, ps[p.pos], mt.lower) : null]
    // The page hatches a bar whose sample is under the stat's stabilization threshold.
    if (c.n != null && mt.thr && c.n < mt.thr) low.push(mt.key)
  }
  return { m, low }
}

const sampleOf = (p, key) => { const c = cell(p, key, 'season'); return c && c.n != null ? c.n : null }

export function buildSavantApi({ data, html }) {
  const { cfg, posFixId, posFixName, explain, leaderboard } = readPageConfig(html)
  if (!Array.isArray(data.seasons) || !data.data) throw new Error('savant-data.json: expected { seasons, data }')
  const metrics = cfg.metrics
  const latest = data.seasons[0]
  const rolling = cfg.windows.filter((w) => w !== 'season')

  const posOf = (p) => posFixId[p.id] || posFixName[norm(p.name)] || p.pos

  const seasons = {}
  const qualified = {}
  const index = new Map() // id -> search row; seasons run newest first, so first sight is newest

  for (const season of data.seasons) {
    const src = (data.data[season] || {}).players || []
    // Position corrections first: they move players between pools.
    const players = src.map((p) => ({ ...p, pos: posOf(p) }))
    const isLatest = season === latest
    const windows = isLatest ? cfg.windows : ['season']
    const pool = {}
    for (const w of windows) pool[w] = pools(players, metrics, w)

    const counts = { league: 0, Guard: 0, Wing: 0, Big: 0 }
    const rows = players.map((p) => {
      if (p.qualified) { counts.league++; if (p.pos in counts) counts[p.pos]++ }
      const full = stats(p, season, metrics, pool.season, 'season')
      const row = {
        id: p.id,
        name: p.name,
        team: p.team,
        pos: p.pos,
        age: p.age ?? null,
        exp: p.exp ?? null,
        qualified: !!p.qualified,
        gp: sampleOf(p, 'avail'),      // the page reads games played off Availability's sample
        min: sampleOf(p, 'minshare'),  // and minutes off Minutes share's
        line: p.line || null,
        m: full.m,
      }
      if (full.low.length) row.low = full.low
      if (isLatest) {
        const w = {}
        for (const k of rolling) {
          const s = stats(p, season, metrics, pool[k], k)
          if (!Object.keys(s.m).length) continue
          w[k] = s.low.length ? { m: s.m, low: s.low } : { m: s.m }
        }
        if (Object.keys(w).length) row.w = w
      }
      // Carried over untouched; meta.extras says what each one is.
      for (const k of ['comps', 'wcomps', 'wflaws', 'guard', 'role']) {
        if (p[k] != null && !(Array.isArray(p[k]) && !p[k].length)) row[k] = p[k]
      }

      const seen = index.get(p.id)
      if (seen) { seen.from = season; seen.seasons++ }
      else index.set(p.id, { id: p.id, name: p.name, pos: p.pos, team: p.team, from: season, to: season, seasons: 1 })
      return row
    })

    qualified[season] = counts
    seasons[season] = {
      schema: SCHEMA,
      season,
      generated: data.generated || null,
      latest: isLatest,
      windows,
      qualified: counts,
      players: rows,
    }
  }

  const meta = {
    schema: SCHEMA,
    name: 'Basketball Savant',
    by: 'Western Conference Elitists',
    site: SITE,
    page: `${SITE}/basketball-savant.html`,
    playerUrl: `${SITE}/basketball-savant.html?p={id}`,
    // The page's leaderboard builder, opened on a stat: its lbEncode() hash.
    leaderboardUrl: `${SITE}/basketball-savant.html#lb?s={season}&r={stat}`,
    leaderboard,
    generated: data.generated || null,
    source: data.source || null,
    latestSeason: latest,
    seasons: data.seasons,
    files: {
      players: `${SITE}/${BASE}/players.json`,
      season: `${SITE}/${BASE}/seasons/{season}.json`,
    },
    positions: POSITIONS,
    qualify: cfg.qualify || null,
    qualified,
    percentiles: {
      method: 'Midrank percentile, rounded to a whole number and held to 1-99. For a lower-is-better stat it is flipped, so a higher percentile is always the better mark.',
      pool: 'The qualified players of the same season who have a value for the stat. A player who did not qualify is still ranked against that pool, and is marked qualified: false.',
      league: 'Against every qualified player that season.',
      position: 'Against qualified players at his position that season: Guard, Wing or Big. Say which pool a number comes from ("vs. guards").',
    },
    windows: Object.fromEntries(cfg.windows.map((w) => [w, WINDOW_LABELS[w] || w])),
    windowSeasons: { season: data.seasons, ...Object.fromEntries(rolling.map((w) => [w, [latest]])) },
    units: UNITS,
    groups: GROUPS,
    metrics: metrics.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      sub: m.sub || null,
      layer: m.layer,
      unit: m.unit,
      lowerIsBetter: !!m.lower,
      since: m.since,
      lowSampleBelow: m.thr || null,
      explain: explain[m.key] || null,
    })),
    row: {
      id: 'Player id. Use it in playerUrl. Players from before 1996-97 without an NBA id carry a "br:" id.',
      pos: 'Guard, Wing or Big, for that season.',
      qualified: 'Whether he is in the percentile pools that season.',
      gp: 'Games played.',
      min: 'Minutes played.',
      line: 'Per-game line: ppg, apg, rpg, tpg (turnovers), mpg.',
      m: 'Full-season stats by key: [value, league percentile, position percentile]. A stat that is absent was not tracked that season or has no value for him. It is not zero.',
      low: 'Keys of stats whose sample is under the stabilization threshold (metrics[].lowSampleBelow). Quote them with that caveat.',
      w: 'Latest season only. The same m and low for each rolling window (l10, l25, l75), ranked against the same window for everyone else.',
    },
    extras: {
      note: 'Latest season only, and only for players over the minutes floor.',
      comps: 'Statistical Comps: the closest profiles by usage, shooting, playmaking, rebounding and rim protection, 500+ minutes. score is the percent statistical match.',
      wflaws: 'Where he ranks worst. k is a weakness dimension (weakness.dims), pct his percentile within his own Guard/Wing/Big group.',
      wcomps: 'Weakness Comps: who shares his flaws, ranked against others at his position. score is the percent match; at or under weakness.low_match nobody really shares the profile.',
      guard: 'Guardometer: the share of his defensive matchups spent on guards (g), wings (w) and bigs (b), in percent. poss is matchup possessions.',
      role: 'Inferred Defensive Role, bigs only. perim is Perimeter Assignment Rate, contest is Rim Contest Rate, rimpm is Rim FG% Allowed vs Expected (lower is better). poss is matchup possessions, dfga shots defended. It reflects role, not ability: team scheme drives much of it, and matchup data is least reliable during switches.',
    },
    weakness: cfg.weakness || null,
  }

  const players = {
    schema: SCHEMA,
    generated: data.generated || null,
    count: index.size,
    note: 'pos and team are from his most recent season (to). from and to are the first and last seasons he appears in.',
    players: [...index.values()],
  }

  return { meta, players, seasons }
}

// ---- writing -------------------------------------------------------------------------

export function writeSavantApi({ publicDir, dist }) {
  const dataFile = path.join(publicDir, 'savant-data.json')
  const pageFile = path.join(publicDir, 'basketball-savant.html')
  if (!existsSync(dataFile) || !existsSync(pageFile)) throw new Error('savant-data.json or basketball-savant.html is missing from public/')

  const out = buildSavantApi({
    data: JSON.parse(readFileSync(dataFile, 'utf8')),
    html: readFileSync(pageFile, 'utf8'),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = [
    ['meta.json', Buffer.from(JSON.stringify(out.meta))],
    ['players.json', Buffer.from(JSON.stringify(out.players))],
  ]
  let raw = 0
  for (const [season, body] of Object.entries(out.seasons)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push([`seasons/${season}.json.gz`, gzipSync(json, { level: 9 })])
  }

  const root = path.join(dist, BASE)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'seasons'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(root, name), buf); bytes += buf.length }

  const seasons = Object.keys(out.seasons).length
  return {
    seasons,
    players: out.players.count,
    files: files.length,
    raw,
    bytes,
    summary: `${out.players.count.toLocaleString('en-US')} players, ${seasons} seasons`,
  }
}

const mb = (n) => (n / 1048576).toFixed(1)

// Every section of the site that the AI connector (api/mcp.js) answers for. Each has its own
// slicer, built the same way as the one above and for the same reason: read the page's rules,
// work the rankings out once, write small files. Each has its own parity check in tools/.
//
//   basketball  this file                  tools/savant-api/check.mjs
//   football    savant-api-football.mjs    tools/savant-football/check.mjs
//   ufc         savant-api-ufc.mjs         tools/savant-ufc/check.mjs
//   coaching    savant-api-coaching.mjs    tools/savant-coaching/check.mjs
//   draft       savant-api-draft.mjs       tools/savant-draft/check.mjs
//   site        savant-api-site.mjs        tools/savant-site/check.mjs   (news, articles, boards)
export const SECTIONS = [
  ['basketball', writeSavantApi],
  ['football', writeFootballApi],
  ['ufc', writeUfcApi],
  ['coaching', writeCoachingApi],
  ['draft', writeDraftApi],
  ['site', writeSiteApi],
]

// Write every section. One failing never stops the others, and none of them ever fails the
// build: a section that cannot be written is simply absent from that deploy, and says so.
export function writeAll({ publicDir, dist, log = console.log, warn = console.warn }) {
  let bytes = 0
  let failed = 0
  for (const [name, write] of SECTIONS) {
    try {
      const r = write({ publicDir, dist })
      bytes += r.bytes
      log(`  savant-api/${name}: ${r.summary}, ${mb(r.raw)} MB → ${mb(r.bytes)} MB on disk`)
    } catch (e) {
      failed++
      warn(`  savant-api/${name}: SKIPPED, not written — ${e.message}`)
    }
  }
  log(`  savant-api: ${mb(bytes)} MB on disk in all${failed ? `, ${failed} section${failed === 1 ? '' : 's'} skipped` : ''}`)
  return { bytes, failed }
}

export default function savantApiPlugin() {
  let dist
  let publicDir
  return {
    name: 'wce-savant-api',
    apply: 'build',
    configResolved(c) {
      dist = path.resolve(c.root, c.build.outDir)
      publicDir = c.publicDir
    },
    closeBundle() { writeAll({ publicDir, dist }) },
  }
}
