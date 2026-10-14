// Basketball Savant ships in two files, the same split Football Savant uses:
//
//   public/savant-data.json      the archive: every finished season (1979-80 on), ~67 MB,
//                                rebuilt by the full pipeline in ~/Basketball-Savant
//   public/savant-current.json   the season in progress, ~3 MB, rebuilt every night by
//                                refresh_current.py and committed by publish_current.sh
//
// Both have the same shape ({ seasons, generated, source, data: { season: { players } } }),
// and the current file adds `through` (last game date) and `qualify` (the pro-rated
// games-played bar for that season). Laying one over the other is this function. The page
// carries an identical copy (mergeSavant in basketball-savant.html); `npm run check:players`
// and tools/savant-api/check.mjs exercise both.
//
// Rules:
//   - a season in the current file replaces the archive's copy, unless the archive is newer
//     (the season has since been folded into a full rebuild, and that rebuild wins)
//   - seasons stay newest first
//   - `generated` is the newer of the two, so "data as of" reflects the latest refresh
//   - a missing, empty or malformed current file leaves the archive untouched

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const when = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0 }
const startYear = (s) => parseInt(String(s), 10) || 0

export function mergeSavantData(archive, current) {
  if (!archive || !Array.isArray(archive.seasons) || !archive.data) return archive
  if (!current || !Array.isArray(current.seasons) || !current.data) return archive
  const data = { ...archive.data }
  const qualify = { ...(archive.qualify || {}) }
  const taken = []
  for (const s of current.seasons) {
    const block = current.data[s]
    if (!block || !Array.isArray(block.players) || block.players.length === 0) continue
    if (archive.data[s] && when(archive.generated) >= when(current.generated)) continue
    data[s] = block
    if (current.qualify && current.qualify[s]) qualify[s] = current.qualify[s]
    taken.push(s)
  }
  if (taken.length === 0) return archive
  const seasons = [...new Set([...taken, ...archive.seasons])].sort((a, b) => startYear(b) - startYear(a))
  const newer = when(current.generated) > when(archive.generated)
  return {
    ...archive,
    seasons,
    data,
    qualify,
    generated: newer ? current.generated : archive.generated,
    current: { season: taken[0], generated: current.generated || null, through: current.through || null },
  }
}

/** Read public/savant-data.json and, when present, lay public/savant-current.json over it. */
export function readSavantData(publicDir) {
  const archive = JSON.parse(readFileSync(path.join(publicDir, 'savant-data.json'), 'utf8'))
  const curFile = path.join(publicDir, 'savant-current.json')
  if (!existsSync(curFile)) return archive
  let current = null
  try { current = JSON.parse(readFileSync(curFile, 'utf8')) } catch (e) {
    console.warn(`savant-current.json is not valid JSON (${e.message}); using the archive alone`)
    return archive
  }
  return mergeSavantData(archive, current)
}

/**
 * For the check suites. Their per-player tests compare against the newest season's pools, so
 * in the first days of a season (a current file whose season has fewer than `minPool`
 * qualified players) they run on the archive alone; the opening-week behaviour has its own
 * scenario test in tools/players/check.mjs. Once the new season has a pool, they test the
 * merged data the site actually serves.
 */
export function readSavantDataForChecks(publicDir, minPool = 30) {
  const merged = readSavantData(publicDir)
  const cur = merged.current && merged.current.season
  if (!cur) return merged
  const q = ((merged.data[cur] || {}).players || []).filter((p) => p.qualified).length
  return q >= minPool ? merged : JSON.parse(readFileSync(path.join(publicDir, 'savant-data.json'), 'utf8'))
}
