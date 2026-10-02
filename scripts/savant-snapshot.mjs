#!/usr/bin/env node
/**
 * savant-snapshot.mjs — save where every Basketball Savant player stands today.
 *
 *   npm run savant-snapshot              # writes data/savant-snapshots/<season>/<date>.json
 *   npm run savant-snapshot -- --force   # overwrite the snapshot for that date
 *
 * The weekly movers email (npm run movers-draft) compares two of these. The date is the day
 * the data was generated, so running it twice between refreshes writes nothing the second
 * time, and early in a season (before enough players clear the games floor) it writes nothing
 * at all. Run weekly by .github/workflows/savant-weekly.yml.
 */

import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveSnapshot, takeSnapshot } from './lib/movers.mjs'
import { loadSavant } from './lib/player-pages.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')

const { eng, slugs } = loadSavant(ROOT)
const snap = takeSnapshot(eng, slugs)
const r = saveSnapshot(ROOT, snap, { force })
// Tells the weekly workflow whether there is anything new to build a movers draft from.
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `written=${r.written}\n`)
if (r.written) console.log(`✓ Snapshot saved: ${path.relative(ROOT, r.file)} (${snap.season}, ${snap.pool} qualified players)`)
else console.log(`– No snapshot written: ${r.reason}.`)
