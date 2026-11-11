// Freshness for every connector tool and every Data Room table: is what an assistant gets as new
// as the source it should match? (research/data-room/BUILD.md §3)
//
//   node tools/savant-mcp/freshness.mjs                        (npm run check:freshness) this repo's files
//   node tools/savant-mcp/freshness.mjs --site https://wcehoops.com      the live site and release assets
//   options: --json (print the results)  --out FILE (write them)  --only nba,nfl
//            --today YYYY-MM-DD (judge as of that day)  --lag SPORT (push that sport's reference a
//            week on, to prove the check catches lag: the deliberate failure)
//
// References, one per sport, and how far behind a table or tool may be:
//   nba   Basketball Savant's newest game (savant-current.json through)         1 day
//   nfl   the last completed NFL game day (nflverse's schedule): due by the
//         Tuesday after its game week                                          the Tuesday after
//   cfb   the college football refresh's through (data/cfb-refresh.json)        3 days
//   cbb   the college basketball build's through, or Basketball Savant's newest
//         game while the college season runs, whichever is newer                3 days
//   ufc   the last event (the newest event date in UFC Savant's fights)         2 days after it
// Each sport is exempt, and says so, outside its season (offseason).
//
// What is checked, per sport: every Data Room table of the season in progress (its newest row),
// the six older Data Room tables, and the site files each tool family reads (their own `through`,
// the date the tools stamp their answers with since Nov 2026; a file that only carries a build
// time is judged by that day). In --site mode the release-asset tables are fetched from GitHub.
//
// Exits 1 and prints ::error:: lines (GitHub annotations) when anything lags; 0 when all are
// fresh or exempt. No dependencies beyond node itself, so the freshness workflow runs it without
// npm ci. The connector-freshness workflow checks each sport in with the Control Room (/control).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const SITE = args.includes('--site') ? opt('site', 'https://wcehoops.com').replace(/\/$/, '') : null
const PUBLIC = path.resolve(opt('local', path.join(ROOT, 'public')))
const HOSTED = path.resolve(opt('hosted', process.env.DATAROOM_HOSTED || path.join(ROOT, 'out', 'dataroom')))
const ASSETS = (process.env.DATAROOM_ASSETS || 'https://github.com/cohenadam07/western-conference-elitists/releases/download/dataroom').replace(/\/$/, '')
const ONLY = opt('only', '') ? opt('only', '').split(',') : null
const LAG = opt('lag', '')
export const TOLERANCE = { nba: 1, cbb: 3, cfb: 3, ufc: 2 }       // days; nfl: the Tuesday after its game week
export const BCS_TABLES = ['games', 'stints', 'rotation', 'decisions', 'units']

const ymd = (d) => d.toISOString().slice(0, 10)
const TODAY = opt('today', null) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (s, n) => ymd(new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000))
export const lagDays = (ref, got) => (got ? Math.round((Date.parse(ref) - Date.parse(got)) / 86400000) : Infinity)

// ---- reading files: the site (or public/), the release assets (or out/dataroom), the repo ----
async function load(rel) {
  if (SITE) {
    const res = await fetch(`${SITE}/${rel}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
    return JSON.parse(await res.text())
  }
  const p = path.join(PUBLIC, rel)
  if (existsSync(p + '.gz')) return JSON.parse(gunzipSync(readFileSync(p + '.gz')).toString('utf8'))
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
  throw new Error(`${rel}: not in ${PUBLIC}`)
}
async function loadAsset(sport, table, season) {
  if (SITE) {
    const res = await fetch(`${ASSETS}/${sport}-${table}-${season}.json.gz`, { signal: AbortSignal.timeout(60000), redirect: 'follow' })
    if (!res.ok) throw new Error(`${sport}-${table}-${season}.json.gz: HTTP ${res.status}`)
    let b = Buffer.from(await res.arrayBuffer())
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b)
    return JSON.parse(b.toString('utf8'))
  }
  const p = path.join(HOSTED, sport, table, `${season}.json.gz`)
  if (!existsSync(p)) throw new Error(`${sport} ${table} ${season}: not in ${HOSTED}`)
  return JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'))
}
const repoJson = (rel) => (existsSync(path.join(ROOT, rel)) ? JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) : null)

// The newest date a table covers: its `through` stamp, else the newest `date` in its rows.
export function newest(file, onlyType = null) {
  if (file && file.through && !onlyType) return String(file.through).slice(0, 10)
  const cols = file.columns || file.cols || []
  const i = cols.indexOf('date'), t = cols.indexOf('season_type')
  if (i < 0) return file && file.through ? String(file.through).slice(0, 10) : null
  let best = null
  for (const r of file.rows || []) if (r[i] && (!best || r[i] > best) && (!onlyType || r[t] === onlyType)) best = r[i]
  return best ? String(best).slice(0, 10) : null
}
const dayOf = (s) => (s ? String(s).slice(0, 10) : null)

// ---- the references ------------------------------------------------------------------------
async function nbaRef() {
  const cur = await load('savant-current.json')
  const season = cur.seasons && cur.seasons[0]
  const m = +TODAY.slice(5, 7), d = +TODAY.slice(8, 10)
  const inSeason = (m === 10 && d >= 20) || [11, 12, 1, 2, 3].includes(m) || (m === 4 && d <= 15)
  return { season, ref: dayOf(cur.through), inSeason }
}
async function nflRef() {
  // nflverse's schedule: the newest completed game whose game week's Tuesday has passed
  const local = process.env.NFL_SCHEDULES && existsSync(process.env.NFL_SCHEDULES) ? readFileSync(process.env.NFL_SCHEDULES, 'utf8') : null
  const csv = local || await (await fetch('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv', { signal: AbortSignal.timeout(30000) })).text()
  const lines = csv.trim().split('\n')
  const head = lines[0].split(',')
  const ix = Object.fromEntries(head.map((c, i) => [c, i]))
  let latestDue = null, latestPlayed = null, season = null
  for (const l of lines.slice(1)) {
    const c = l.split(',')
    if (c[ix.home_score] === '' || c[ix.home_score] === 'NA' || c[ix.game_type] !== 'REG') continue
    const g = c[ix.gameday]
    if (g > TODAY) continue
    // due: the Tuesday after the game (a Thursday-to-Monday week is due that Tuesday)
    const dow = new Date(`${g}T12:00:00Z`).getUTCDay()            // 0 Sunday .. 6 Saturday
    const due = addDays(g, ((2 - dow + 7) % 7) || 7)
    if (!latestPlayed || g > latestPlayed) { latestPlayed = g; season = c[ix.season] }
    if (due < TODAY && (!latestDue || g > latestDue)) latestDue = g
  }
  const m = +TODAY.slice(5, 7)
  return { season, ref: latestDue, played: latestPlayed, inSeason: [9, 10, 11, 12, 1].includes(m) || (m === 2 && +TODAY.slice(8, 10) <= 14) }
}
async function cfbRef() {
  const beat = repoJson('data/cfb-refresh.json') || {}
  const t = TODAY.slice(5)
  return { season: beat.season ? String(beat.season) : null, ref: dayOf(beat.through), inSeason: t >= '08-28' || t <= '01-25' }
}
async function cbbRef(nbaThrough) {
  const idx = await load('cbb/index.json')
  const cs = idx.current
  const row = (idx.seasons || []).find((s) => s.season === cs)
  const end = `${+cs.slice(0, 4) + 1}-04-08`                    // the title game is the first Monday of April
  const own = row && row.through ? dayOf(row.through) : null
  const ref = [own, nbaThrough && nbaThrough < end ? nbaThrough : null].filter(Boolean).sort().pop()
  const m = +TODAY.slice(5, 7)
  return { season: cs, ref, started: !!(row && row.games), inSeason: [11, 12, 1, 2, 3].includes(m) || (m === 4 && +TODAY.slice(8, 10) <= 12) }
}
async function ufcRef() {
  const fights = await load('ufc-savant-fights.json')
  let last = null
  for (const f of Object.values(fights)) if (f.date && f.date <= TODAY && (!last || f.date > last)) last = f.date
  return { season: last ? last.slice(0, 4) : null, ref: last, inSeason: true }       // UFC has no offseason
}

// ---- the checks ----------------------------------------------------------------------------
const results = []
function judge(sport, kind, name, season, through, R, tol, err) {
  let ref = R.ref
  if (LAG === sport && ref) ref = addDays(ref, 7)               // the deliberate failure
  if (!R.inSeason && !LAG) return results.push({ sport, kind, name, season, through, ref, lag: null, ok: true, note: 'offseason (exempt)' })
  if (err) return results.push({ sport, kind, name, season, through: null, ref, lag: Infinity, ok: false, error: err })
  const lag = lagDays(ref, through)
  const ok = ref == null ? true : through != null && lag <= tol
  results.push({ sport, kind, name, season, through, ref, lag, ok, tol, ...(ref == null ? { note: 'no reference yet' } : {}) })
}
async function check(sport, kind, name, season, R, tol, read) {
  let through = null, err = null
  try { through = await read() } catch (e) { err = e.message }
  judge(sport, kind, name, season, through, R, tol, err)
}

async function main() {
  const rel = path.relative(process.cwd(), PUBLIC)
  console.log(`${SITE || (rel && !rel.startsWith('..') ? rel : PUBLIC)}: judged as of ${TODAY}${LAG ? ` (with ${LAG}'s reference pushed a week on, on purpose)` : ''}`)
  const want = (s) => !ONLY || ONLY.includes(s)
  const cat = await load('dataroom/catalog.json').catch(() => null)
  const roomTables = (sport) => Object.entries(((cat || {}).sports || {})[sport] || {}).filter(([, v]) => v.hosting !== 'site')
  const roomTable = (sport, table, season, R, tol, onlyType) => check(sport, 'table', `savant_data ${sport} ${table}`, season, R, tol, async () => {
    const e = cat.sports[sport][table]
    if (!e.seasons || !e.seasons[season]) throw new Error(`no ${season} in the catalog`)
    const doc = e.hosting === 'release' ? await loadAsset(sport, table, season) : await load(`dataroom/${sport}/${table}/${season}.json`)
    // and no stamp ahead of its data: the file's `through` is its newest row
    const rowsNewest = newest({ ...doc, through: null })
    if (doc.through && rowsNewest && doc.through !== rowsNewest) throw new Error(`stamp ${doc.through} but newest row ${rowsNewest}`)
    return onlyType ? newest(doc, onlyType) : newest(doc)
  })

  // The Parquet copies (savant_sql, savant_analyze; pipeline/dataroom/parquet.mjs): each table's season in
  // progress, judged like its JSON. A copy that lags its JSON is stale the same way.
  const pq = await load('dataroom/parquet.json').catch(() => null)
  const parquetTables = async (sport, R, tol) => {
    for (const [key, v] of Object.entries((pq || {}).tables || {}).filter(([k]) => k.startsWith(`${sport}.`))) {
      await check(sport, 'table', `savant_sql ${key} (Parquet)`, R.season, R, tol, async () => {
        const s = v.seasons[R.season] || v.seasons.all     // coaching_programs is one file of every season
        if (!s) throw new Error(`no ${R.season} Parquet copy`)
        return s.through ? dayOf(s.through) : R.ref      // a table with no dates (units) carries its build's
      })
    }
  }

  const nba = await nbaRef()
  if (want('nba')) {
    const R = nba, tol = TOLERANCE.nba
    console.log(`nba: Basketball Savant ${R.season} through ${R.ref}`)
    for (const [t] of roomTables('nba')) await roomTable('nba', t, R.season, R, tol)
    for (const t of BCS_TABLES) await check('nba', 'table', `savant_data nba coaching_${t}`, R.season, R, tol, async () => {
      const f = await load(`bcs/data/${t}/${R.season}.json`); const n = newest(f)
      if (n == null && t === 'units') return R.ref      // units carry no date; the build stamps them with its own
      return n
    })
    await check('nba', 'tool', 'nba_* profiles, leaderboards, careers, splits (savant-api meta)', R.season, R, tol, async () => {
      if (!SITE) return dayOf((await load('savant-current.json')).through)
      const m = await load('savant-api/basketball/v1/meta.json'); return dayOf(m.through || m.generated)
    })
    await check('nba', 'tool', 'nba_fantasy_*, nba_injury_report, nba_schedule (savant-proj.json)', R.season, R, tol, async () => { const p = await load('savant-proj.json'); return dayOf(p.through || p.generated) })
    await check('nba', 'tool', 'nba_team_profile, nba_lineups (savant-teams-current.json)', R.season, R, tol, async () => { const t = await load('savant-teams-current.json'); return dayOf(t.through || t.generated) })
    await check('nba', 'tool', 'nba_*_coach*, nba_coaching_* (bcs/index.json)', R.season, R, tol, async () => { const i = await load('bcs/index.json'); return dayOf(i.meta.through || i.meta.generated) })
    await parquetTables('nba', R, tol)
  }
  if (want('nfl')) {
    const R = await nflRef()
    console.log(`nfl: last completed regular-season game ${R.played}; due through ${R.ref} (the Tuesday after its week has passed)`)
    // The Data Room's games and plays carry the postseason; the comparison is to regular-season days.
    for (const [t] of roomTables('nfl')) await roomTable('nfl', t, R.season, R, 0, 'REG')
    await parquetTables('nfl', R, 0)
    await check('nfl', 'tool', 'nfl_* players, leaderboards, teams, games (savant-api football meta)', R.season, R, 0, async () => {
      if (SITE) { const m = await load('savant-api/football/v1/meta.json'); return dayOf(m.through || m.generated) }
      const c = await load('football-savant-current.json')
      if (c.through) return dayOf(c.through)
      return newest(await load(`dataroom/nfl/games/${R.season}.json`), 'REG')
    })
    await check('nfl', 'tool', 'nfl_*coach* (savant-api coaching meta)', R.season, R, 0, async () => {
      if (SITE) { const m = await load('savant-api/coaching/v1/meta.json'); return dayOf(m.through || m.generated) }
      return newest(await load(`dataroom/nfl/games/${R.season}.json`), 'REG')
    })
  }
  if (want('cfb')) {
    const R = await cfbRef(), tol = TOLERANCE.cfb
    console.log(`cfb: the college football refresh's through ${R.ref}`)
    for (const [t] of roomTables('cfb')) await roomTable('cfb', t, R.season, R, tol)
    await parquetTables('cfb', R, tol)
    await check('cfb', 'tool', 'cfb_* (cfb season file)', R.season, R, tol, async () => dayOf((await load(`cfb/s/${R.season}.json`)).through))
  }
  if (want('cbb')) {
    const R = await cbbRef(nba.ref), tol = TOLERANCE.cbb
    console.log(`cbb: ${R.season} reference ${R.ref}`)
    if (!R.started) results.push({ sport: 'cbb', kind: 'table', name: 'savant_data cbb games', season: R.season, through: null, ref: R.ref, lag: null, ok: true, note: 'season not started' })
    else {
      await check('cbb', 'table', 'savant_data cbb games (and player_games, units, possessions: the same build)', R.season, R, tol, async () => newest(await load(`cbb/games/${R.season}.json`)))
      await check('cbb', 'table', 'savant_data cbb coaching_games', R.season, R, tol, async () => newest(await load(`cbcs/data/games/${R.season}.json`)))
      await check('cbb', 'tool', 'cbb_* (cbb/index.json)', R.season, R, tol, async () => { const i = await load('cbb/index.json'); const row = i.seasons.find((s) => s.season === R.season); return dayOf(row && row.through) })
      await check('cbb', 'tool', 'cbb_*coach* (cbcs/index.json)', R.season, R, tol, async () => { const i = await load('cbcs/index.json'); return dayOf(i.meta.through || i.meta.generated) })
      await parquetTables('cbb', R, tol)
    }
  }
  if (want('ufc')) {
    const R = await ufcRef(), tol = TOLERANCE.ufc
    console.log(`ufc: last event ${R.ref}`)
    for (const [t] of roomTables('ufc')) await roomTable('ufc', t, R.season, R, tol)
    await parquetTables('ufc', R, tol)
    await check('ufc', 'tool', 'ufc_* (ufc-savant-data.json cfg.latest)', R.season, R, tol, async () => dayOf((await load('ufc-savant-data.json')).cfg.latest))
  }

  for (const r of results) {
    const tol = r.tol == null ? '' : r.sport === 'nfl' ? '; due by the Tuesday after its week' : `; allowed ${r.tol}`
    const line = `${r.sport} ${r.name} ${r.season ?? ''}: through ${r.through ?? '—'} (reference ${r.ref ?? '—'}${r.lag != null && Number.isFinite(r.lag) ? `, ${r.lag} day${r.lag === 1 ? '' : 's'} behind` : ''}${tol})`
    if (r.ok) console.log(`ok    ${line}${r.note ? ` — ${r.note}` : ''}`)
    else console.log(`::error::STALE ${line}${r.error ? ` — ${r.error}` : ''}`)
  }
  if (opt('out', null)) writeFileSync(opt('out'), JSON.stringify({ today: TODAY, site: SITE, results }, null, 1))
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 1))
  const bad = results.filter((r) => !r.ok)
  if (bad.length) { console.log(`${bad.length} table(s) or tool(s) behind: ${[...new Set(bad.map((r) => r.sport))].join(', ')}.`); process.exit(1) }
  console.log(`every table and tool is fresh (${results.length} checked)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`::error::freshness check could not run: ${e.message}`); process.exit(1) })
}
