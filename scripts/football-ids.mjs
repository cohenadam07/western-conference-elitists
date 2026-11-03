// scripts/football-ids.mjs — the player-id crosswalk league sync uses to put a fantasy
// platform's players on Football Savant: public/football-ids.json.
//
//   node scripts/football-ids.mjs            (the football refresh workflow runs it weekly)
//
// Football Savant knows a player by the NFL's own id (gsis, e.g. 00-0030279). Fantasy platforms
// each use their own. Two public sources tie them together:
//   - DynastyProcess's id table (github.com/dynastyprocess/data, files/db_playerids.csv, MIT):
//     gsis next to the Sleeper, ESPN, MyFantasyLeague and Yahoo ids.
//   - Sleeper's own player list, which carries gsis for many of its players.
// Where the two disagree on a Sleeper id, Sleeper's own word wins.
//
// Written: { schema, generated, sources, count, sleeper: {id: gsis}, espn: {...}, mfl: {...},
// yahoo: {...} }. Only players Football Savant can know (QB, RB, WR, TE, K, FB) are kept.
// Fantrax is not in either source; league sync matches Fantrax players by name.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public/football-ids.json')
const DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
const SLEEPER = 'https://api.sleeper.app/v1/players/nfl'
const KEEP = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'PK', 'FB'])

// A small CSV reader: quoted fields, commas inside quotes.
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c; continue }
    if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...rest] = rows
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const GSIS = /^00-\d{7}$/
const ok = (v) => v && v !== 'NA' && v !== 'NULL'

async function main() {
  const [dpText, sleeper] = await Promise.all([
    fetch(DP).then((r) => { if (!r.ok) throw new Error(`DynastyProcess ${r.status}`); return r.text() }),
    fetch(SLEEPER).then((r) => { if (!r.ok) throw new Error(`Sleeper ${r.status}`); return r.json() }),
  ])
  const out = { sleeper: {}, espn: {}, mfl: {}, yahoo: {} }
  for (const r of parseCsv(dpText)) {
    if (!GSIS.test(r.gsis_id || '') || !KEEP.has(String(r.position || '').toUpperCase())) continue
    if (ok(r.sleeper_id)) out.sleeper[r.sleeper_id] = r.gsis_id
    if (ok(r.espn_id)) out.espn[r.espn_id] = r.gsis_id
    if (ok(r.mfl_id)) out.mfl[r.mfl_id] = r.gsis_id
    if (ok(r.yahoo_id)) out.yahoo[r.yahoo_id] = r.gsis_id
  }
  let fromSleeper = 0
  for (const [id, p] of Object.entries(sleeper)) {
    const g = String(p.gsis_id || '').trim()
    if (!GSIS.test(g) || !KEEP.has(String(p.position || '').toUpperCase())) continue
    if (out.sleeper[id] !== g) fromSleeper++
    out.sleeper[id] = g
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  const doc = {
    schema: 1,
    generated: new Date().toISOString(),
    sources: ['DynastyProcess db_playerids.csv (github.com/dynastyprocess/data, MIT)', 'Sleeper public player list (api.sleeper.app)'],
    note: 'Fantasy platform player id -> the NFL gsis id Football Savant uses. Fantrax is matched by name.',
    count: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.keys(v).length])),
    ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sorted(v)])),
  }
  // Only a change to the ids is a change: a new date alone would mean a commit, and a deploy,
  // every day.
  if (existsSync(OUT)) {
    try {
      const was = JSON.parse(readFileSync(OUT, 'utf8'))
      if (['sleeper', 'espn', 'mfl', 'yahoo'].every((k) => JSON.stringify(was[k]) === JSON.stringify(doc[k]))) { console.log('football-ids.json: no change'); return }
    } catch { /* rewrite it */ }
  }
  writeFileSync(OUT, JSON.stringify(doc) + '\n')
  console.log(`football-ids.json: ${JSON.stringify(doc.count)} (${fromSleeper} Sleeper ids taken from Sleeper itself)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
