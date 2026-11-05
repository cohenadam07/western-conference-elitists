// Freshness check for the connector's Data Rooms: are the rows an assistant pulls as new as the
// site's own numbers?
//
//   node tools/savant-mcp/freshness.mjs                 (npm run check:freshness) the repo's public/
//   node tools/savant-mcp/freshness.mjs --site https://wcehoops.com     the live site
//   options: --days N (NBA tolerance, default 1)  --cbb-days N (college, default 3)  --json
//
// The reference is Basketball Savant's newest game (savant-current.json `through`, written by
// the cloud refresh after every slate). Against it:
//   - Basketball Coaching Savant's Data Room (nba_coaching_data, api/_bcoaching.js): games,
//     stints, rotation, decisions and units for the season in progress, each table's newest date
//     (its `through` stamp, or the newest `date` in its rows) within --days of the reference.
//     Nov 2026: the cloud refresh logged rc=0 every pass while the Data Room sat at Oct 31.
//   - College Basketball Savant's Data Room (cbb_data, api/_cbb.js): the games table for the
//     season in progress against the newer of the college build's own `through` and Basketball
//     Savant's newest game (capped at the college season's end, early April), within --cbb-days.
//     College days with no D1 games (Christmas, exam weeks) are why its tolerance is wider.
//
// Exits 1 and prints ::error:: lines (GitHub annotations) when a table lags; 0 when all are
// fresh. No dependencies beyond node itself, so the freshness workflow runs it without npm ci.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const SITE = args.includes('--site') ? opt('site', 'https://wcehoops.com').replace(/\/$/, '') : null
const PUBLIC = path.resolve(opt('local', path.join(ROOT, 'public')))
const NBA_DAYS = +opt('days', 1)
const CBB_DAYS = +opt('cbb-days', 3)
export const BCS_TABLES = ['games', 'stints', 'rotation', 'decisions', 'units']

// A file by its served path (bcs/data/games/2026-27.json): from the site, or from public/ where
// most are kept gzipped beside the name the site serves them under (vercel.json rewrites).
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

// The newest date a Data Room table covers: its `through` stamp (build.py writes one since Nov
// 2026), else the newest `date` in its rows.
export function newest(file) {
  if (file && file.through) return String(file.through).slice(0, 10)
  const cols = file.columns || file.cols || []
  const i = cols.indexOf('date')
  if (i < 0) return null
  let best = null
  for (const r of file.rows || []) if (r[i] && (!best || r[i] > best)) best = r[i]
  return best ? String(best).slice(0, 10) : null
}

export const lagDays = (ref, got) => (got ? Math.round((Date.parse(ref) - Date.parse(got)) / 86400000) : Infinity)

async function main() {
  const rel = path.relative(process.cwd(), PUBLIC)
  const where = SITE || (rel && !rel.startsWith('..') ? rel : PUBLIC)
  const results = []
  const cur = await load('savant-current.json')
  const season = cur.seasons && cur.seasons[0]
  const ref = cur.through ? String(cur.through).slice(0, 10) : null
  if (!season || !ref) throw new Error('savant-current.json has no season or through date')
  console.log(`${where}: Basketball Savant ${season} through ${ref}`)

  for (const table of BCS_TABLES) {
    const rel = `bcs/data/${table}/${season}.json`
    let got = null, err = null
    try { got = newest(await load(rel)) } catch (e) { err = e.message }
    // units have no date column; a file from before the `through` stamp can't be dated
    if (!err && got == null && table === 'units') { results.push({ section: 'nba_coaching_data', table, season, through: null, ref, lag: null, ok: true, note: 'no through stamp yet (written by the next coaching build)' }); continue }
    const lag = err ? Infinity : lagDays(ref, got)
    results.push({ section: 'nba_coaching_data', table, season, through: got, ref, lag, ok: !err && lag <= NBA_DAYS, error: err })
  }

  try {
    const idx = await load('cbb/index.json')
    const cs = idx.current
    const row = (idx.seasons || []).find((s) => s.season === cs)
    const end = `${+cs.slice(0, 4) + 1}-04-08`              // the title game is the first Monday of April
    const own = row && row.through ? String(row.through).slice(0, 10) : null
    const cref = [own, ref < end ? ref : end].filter(Boolean).sort().pop()
    if (!row || !row.games) {
      results.push({ section: 'cbb_data', table: 'games', season: cs, through: null, ref: cref, lag: null, ok: true, note: 'season not started' })
    } else {
      let got = null, err = null
      try { got = newest(await load(`cbb/games/${cs}.json`)) } catch (e) { err = e.message }
      const lag = err ? Infinity : lagDays(cref, got)
      results.push({ section: 'cbb_data', table: 'games', season: cs, through: got, ref: cref, lag, ok: !err && lag <= CBB_DAYS, error: err })
    }
  } catch (e) {
    results.push({ section: 'cbb_data', table: 'games', season: null, through: null, ref: null, lag: Infinity, ok: false, error: e.message })
  }

  for (const r of results) {
    const tol = r.section === 'cbb_data' ? CBB_DAYS : NBA_DAYS
    const line = `${r.section} ${r.table} ${r.season ?? ''}: through ${r.through ?? '—'} (reference ${r.ref ?? '—'}${r.lag != null && Number.isFinite(r.lag) ? `, ${r.lag} day${r.lag === 1 ? '' : 's'} behind` : ''}; allowed ${tol})`
    if (r.ok) console.log(`ok    ${line}${r.note ? ` — ${r.note}` : ''}`)
    else console.log(`::error::STALE ${line}${r.error ? ` — ${r.error}` : ''}`)
  }
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 1))
  const bad = results.filter((r) => !r.ok)
  if (bad.length) { console.log(`${bad.length} Data Room table(s) behind. See the Basketball Savant cloud refresh run's coaching lines (pipeline/basketball/coaching/refresh_live.py).`); process.exit(1) }
  console.log('every Data Room table is fresh')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`::error::freshness check could not run: ${e.message}`); process.exit(1) })
}
