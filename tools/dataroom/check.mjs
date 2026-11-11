// The Data Room tools (api/_dataroom.js): savant_data and savant_dictionary, against the files as
// the site and the release assets serve them.
//
//   node --test tools/dataroom/check.mjs           (part of npm run check:savant)
//
// What it holds them to (research/data-room/BUILD.md §5, "The tool" and "Parity"):
//   - every table in the catalog is reachable, its newest season and its oldest
//   - every filter op works, dates included
//   - paging covers every row exactly once
//   - unknown sports, tables, columns, ops and seasons say what the valid choices are
//   - no call reads more than one season's file of one table
//   - every answer has its columns' definitions, the match count, the next offset, data through
//     (the newest row, never the day it was read) and the page link
//   - parity: the same rows as the six tools it replaced (nba_coaching_data, cbb_data,
//     cbb_coaching_data and their dictionaries), on the same inputs
//
// Files come from public/ (served the way Vercel serves them: x.json from x.json.gz) and the
// release-asset tables from out/dataroom (served as GitHub serves an asset: gzip bytes, no
// Content-Encoding). Tables not built on this machine are skipped by name, never silently.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUB = path.join(ROOT, 'public')
const HOSTED = process.env.DATAROOM_HOSTED || path.join(ROOT, 'out', 'dataroom')
let hits = []

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  hits.push(url)
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, connection: 'close' }); res.end(body) }
  const m = url.match(/^\/assets\/([a-z]+)-([a-z_]+)-([0-9-]+)\.json\.gz$/)
  if (m) {
    const f = path.join(HOSTED, m[1], m[2], `${m[3]}.json.gz`)
    return existsSync(f) ? send(200, readFileSync(f), 'application/octet-stream') : send(404, 'Not Found', 'text/plain')
  }
  const p = path.join(PUB, url)
  if (!p.startsWith(PUB)) return send(404, '')
  if (existsSync(p + '.gz')) return send(200, gunzipSync(readFileSync(p + '.gz')))
  if (existsSync(p) && p.endsWith('.json')) return send(200, readFileSync(p))
  send(200, '<!doctype html><title>WCE</title>', 'text/html')   // the live catch-all
})

let D, B, CB, CC, cat
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${port}`
  process.env.DATAROOM_ASSETS = `http://127.0.0.1:${port}/assets`
  D = await import('../../api/_dataroom.js')
  B = await import('../../api/_bcoaching.js')
  CB = await import('../../api/_cbb.js')
  CC = await import('../../api/_cbcoaching.js')
  cat = JSON.parse(gunzipSync(readFileSync(path.join(PUB, 'dataroom', 'catalog.json.gz'))).toString('utf8'))
})
after(() => server.close())

const hostedHas = (sport, table, season) => existsSync(path.join(HOSTED, sport, table, `${season}.json.gz`))
const tableFiles = () => hits.filter((u) => /^\/(assets\/|dataroom\/[a-z]+\/|bcs\/data\/[a-z_]+\/|cbcs\/data\/[a-z_]+\/|cbb\/(t|pos|games)\/)/.test(u) || u === '/cbcs/data/programs.json')

test('every table in the catalog answers, newest and oldest season', async () => {
  const skipped = []
  for (const [sport, tables] of Object.entries(cat.sports)) {
    for (const [table, entry] of Object.entries(tables)) {
      const ss = Object.keys(entry.seasons).sort()
      for (const season of [...new Set([ss[ss.length - 1], ss[0]])]) {
        if (entry.hosting === 'release' && !hostedHas(sport, table, season)) { skipped.push(`${sport} ${table} ${season}`); continue }
        const team = sport === 'cbb' && ['player_games', 'units', 'possessions'].includes(table) ? 'Duke' : undefined
        hits = []
        const { structured: r, text } = await D.savantData({ sport, table, season: table === 'coaching_programs' ? undefined : season, team, limit: 5 })
        assert.equal(r.sport, sport)
        assert.ok(r.total_matching > 0, `${sport} ${table} ${season}: no rows`)
        assert.ok(r.rows.length <= 5 && r.rows.every((x) => x.length === r.columns.length))
        assert.ok(r.definitions && Object.keys(r.definitions).length, `${sport} ${table}: definitions`)
        assert.ok(r.url.startsWith('https://wcehoops.com/'), `${sport} ${table}: page link`)
        if (entry.hosting !== 'site') {
          assert.equal(r.data_through, entry.seasons[season].through, `${sport} ${table} ${season}: data through is the newest row`)
          for (const c of r.columns) assert.ok(r.definitions[c], `${sport} ${table}: column ${c} has no definition`)
        }
        assert.match(text, /Data through/)
        // one season's file of one table, at most
        // (cbb possessions also read the team-season's roster file for the names in the fives)
        const files = tableFiles().filter((u) => !(table === 'possessions' && u.startsWith('/cbb/t/')))
        assert.ok(files.length <= 1, `${sport} ${table} ${season} read ${files.length} table files: ${files.join(', ')}`)
      }
    }
  }
  if (skipped.length) console.log(`  not built on this machine (skipped): ${skipped.join('; ')}`)
})

test('every filter op works, dates included', async () => {
  const q = (filters, extra = {}) => D.savantData({ sport: 'ufc', table: 'fights', season: '2024', filters, limit: 500, ...extra }).then((x) => x.structured)
  const first = await q([])
  const ix = Object.fromEntries(first.columns.map((c, i) => [c, i]))
  const rows = [...first.rows]
  for (let off = first.next_offset; off != null;) { const p = await q([], { offset: off }); rows.push(...p.rows); off = p.next_offset }
  assert.equal(rows.length, first.total_matching)
  const count = (fn) => rows.filter(fn).length
  assert.equal((await q([{ column: 'result', op: 'eq', value: 'W' }])).total_matching, count((r) => r[ix.result] === 'W'))
  assert.equal((await q([{ column: 'result', op: 'ne', value: 'W' }])).total_matching, count((r) => r[ix.result] !== 'W'))
  assert.equal((await q([{ column: 'finish', op: 'in', value: ['KO', 'SUB'] }])).total_matching, count((r) => ['KO', 'SUB'].includes(r[ix.finish])))
  assert.equal((await q([{ column: 'ss', op: 'gte', value: 50 }])).total_matching, count((r) => r[ix.ss] != null && r[ix.ss] >= 50))
  assert.equal((await q([{ column: 'ss', op: 'lt', value: 10 }])).total_matching, count((r) => r[ix.ss] != null && r[ix.ss] < 10))
  assert.equal((await q([{ column: 'round', op: 'gt', value: 3 }])).total_matching, count((r) => r[ix.round] > 3))
  assert.equal((await q([{ column: 'round', op: 'lte', value: 1 }])).total_matching, count((r) => r[ix.round] <= 1))
  assert.equal((await q([{ column: 'event', op: 'contains', value: 'fight night' }])).total_matching, count((r) => String(r[ix.event]).toLowerCase().includes('fight night')))
  assert.equal((await q([{ column: 'bonus', op: 'null' }])).total_matching, count((r) => r[ix.bonus] == null))
  assert.equal((await q([{ column: 'bonus', op: 'notnull' }])).total_matching, count((r) => r[ix.bonus] != null))
  // dates compare as dates, not as NaN (the Nov 2026 coaching bug)
  const d = await q([{ column: 'date', op: 'gte', value: '2024-07-01' }, { column: 'date', op: 'lt', value: '2024-08-01' }])
  assert.equal(d.total_matching, count((r) => r[ix.date] >= '2024-07-01' && r[ix.date] < '2024-08-01'))
  assert.ok(d.total_matching > 0 && d.total_matching < rows.length)
  // sort
  const s = await q([], { sort: 'ss', descending: true, columns: ['fighter', 'ss'], limit: 3 })
  assert.ok(s.rows[0][1] >= s.rows[1][1] && s.rows[1][1] >= s.rows[2][1])
})

test('paging covers every row exactly once', async () => {
  const seen = new Set()
  let offset = 0, total = null, pages = 0
  while (offset != null) {
    const { structured: r } = await D.savantData({ sport: 'ufc', table: 'rounds', season: '2023', columns: ['fight_id', 'fighter_id', 'round'], limit: 500, offset })
    total = r.total_matching
    for (const row of r.rows) { const k = row.join('|'); assert.ok(!seen.has(k), `row ${k} twice`); seen.add(k) }
    offset = r.next_offset
    pages++
  }
  assert.equal(seen.size, total)
  assert.ok(pages > 1)
})

test('unknown names say what to pick', async () => {
  const err = async (args, re) => { await assert.rejects(D.savantData(args), (e) => { assert.match(e.message, re); return true }) }
  await err({ sport: 'mlb', table: 'plays' }, /Pick a sport: nba, nfl, cfb, cbb, ufc/)
  await err({ sport: 'nfl', table: 'drives' }, /No nfl table "drives"\. Tables: plays, player_games, games/)
  await err({ sport: 'ufc', table: 'fights', season: '2024', columns: ['punches'] }, /No column "punches" in ufc fights\. Columns: fight_id, date/)
  await err({ sport: 'ufc', table: 'fights', season: '2024', filters: [{ column: 'kicks', op: 'eq', value: 1 }] }, /No column "kicks".*Columns:/)
  await err({ sport: 'ufc', table: 'fights', season: '2024', sort: 'kicks' }, /Can't sort by "kicks"/)
  await err({ sport: 'nfl', table: 'games', season: '1980' }, /No nfl games for 1980\. It covers 1999 to/)
  await err({ sport: 'nba', table: 'coaching_games', season: '2024' }, /Give a nba season as 2024-25/)
  await err({ sport: 'cbb', table: 'player_games', season: '2025-26' }, /give team/)
  await assert.rejects(D.savantDictionary({ sport: 'nfl', table: 'drives' }), /Tables: plays, player_games, games/)
})

test('the dictionary: the catalog, and every column of a table', async () => {
  const { structured: c, text } = await D.savantDictionary({})
  for (const s of D.SPORTS) assert.ok(Object.keys(c.sports[s]).length, s)
  assert.ok(c.sports.nfl.plays.rows > 1e6 && c.sports.nfl.plays.seasons === '1999 to ' + Object.keys(cat.sports.nfl.plays.seasons).sort().pop())
  assert.match(text, /savant_data/)
  const { structured: t } = await D.savantDictionary({ sport: 'nfl', table: 'plays' })
  for (const k of ['epa', 'cpoe', 'formation', 'play_action']) for (const f of ['what', 'unit', 'source', 'since']) assert.ok(t.columns[k][f] != null, `nfl plays ${k}.${f}`)
  assert.equal(t.columns.formation.since, 2016)
  assert.equal(t.columns.play_action.since, 2022)
})

// ---- parity with the six tools savant_data replaced ------------------------------------------
const strip = (o) => JSON.parse(JSON.stringify(o))

test('parity: nba_coaching_data and savant_data give the same rows', async () => {
  const season = Object.keys(cat.sports.nba.coaching_games.seasons).sort().pop()
  const cases = [
    { table: 'games', season, limit: 50 },
    { table: 'games', season, filters: [{ column: 'date', op: 'gte', value: `${season.slice(0, 4)}-11-01` }], columns: ['date', 'team', 'opp', 'pts'], limit: 500 },
    { table: 'decisions', season, limit: 500, offset: 100 },
    { table: 'stints', season: '2023-24', filters: [{ column: 'home', op: 'eq', value: 'BOS' }], limit: 200 },
    { table: 'rotation', season: '2015-16', limit: 300 },
    { table: 'units', season: '2008-09', limit: 100 },
  ]
  for (const c of cases) {
    const old = (await B.coachingData(c)).structured
    const now = (await D.savantData({ sport: 'nba', ...c, table: `coaching_${c.table}` })).structured
    assert.deepEqual(now.columns, old.columns, `${c.table}: columns`)
    assert.deepEqual(strip(now.rows), strip(old.rows), `${c.table}: rows`)
    assert.equal(now.total_matching, old.total_matching)
    assert.equal(now.next_offset, old.next_offset)
    assert.equal(now.data_through, old.data_as_of)
    assert.equal(now.definitions.table, old.definition)
  }
  const od = (await B.coachingDictionary({})).structured
  const nd = (await D.savantDictionary({ sport: 'nba', table: 'coaching_stats' })).structured
  assert.deepEqual(strip({ ...nd, sport: undefined, table: undefined }), strip({ ...od, sport: undefined, table: undefined }))
  const ot = (await B.coachingDictionary({ table: 'stints' })).structured
  const nt = (await D.savantDictionary({ sport: 'nba', table: 'coaching_stints' })).structured
  assert.deepEqual(nt.tables, ot.tables)
})

test('parity: cbb_coaching_data and savant_data give the same rows', async () => {
  const season = Object.keys(cat.sports.cbb.coaching_games.seasons).sort().pop()
  const cases = [
    { table: 'games', season, limit: 100 },
    { table: 'games', season: '2024-25', filters: [{ column: 'conf', op: 'eq', value: 1 }], limit: 500, offset: 500 },
    { table: 'decisions', season: '2019-20', limit: 200 },
    { table: 'roster_moves', season: '2014-15', limit: 100 },
    { table: 'programs', limit: 100, filters: [{ column: 'team', op: 'contains', value: 'du' }] },
  ]
  for (const c of cases) {
    const old = (await CC.coachingData(c)).structured
    const now = (await D.savantData({ sport: 'cbb', ...c, table: `coaching_${c.table}` })).structured
    assert.deepEqual(now.columns, old.columns, `${c.table}: columns`)
    assert.deepEqual(strip(now.rows), strip(old.rows), `${c.table}: rows`)
    assert.equal(now.total_matching, old.total_matching)
    assert.equal(now.next_offset, old.next_offset)
    assert.equal(now.data_through, old.data_as_of)
  }
  const od = (await CC.coachingDictionary({})).structured
  const nd = (await D.savantDictionary({ sport: 'cbb', table: 'coaching_stats' })).structured
  assert.deepEqual(strip({ ...nd, sport: undefined, table: undefined }), strip({ ...od, sport: undefined, table: undefined }))
})

test('parity: cbb_data and savant_data give the same rows', async () => {
  const season = Object.keys(cat.sports.cbb.games.seasons).sort().pop()
  const cases = [
    { table: 'games', season, limit: 100 },
    { table: 'games', season: '2024-25', team: 'Duke', sort: 'date', descending: true, limit: 50 },
    { table: 'player_games', season: '2024-25', team: 'Duke', filters: [{ column: 'pts', op: 'gte', value: 20 }], limit: 100 },
    { table: 'units', season: '2024-25', team: 'Houston', sort: 'seconds', descending: true, limit: 20 },
    { table: 'possessions', season: '2025-26', team: 'Auburn', limit: 200, offset: 400 },
  ]
  for (const c of cases) {
    const old = (await CB.data({ offset: 0, descending: false, ...c })).structured
    const now = (await D.savantData({ sport: 'cbb', ...c })).structured
    assert.deepEqual(now.columns, old.columns, `${c.table}: columns`)
    assert.deepEqual(strip(now.rows), strip(old.rows.map((r) => old.columns.map((k) => r[k]))), `${c.table}: rows`)
    assert.equal(now.total_matching, old.total)
  }
  const od = (await CB.dictionary()).structured
  const nd = (await D.savantDictionary({ sport: 'cbb', table: 'stats' })).structured
  assert.deepEqual(strip({ ...nd, sport: undefined, table: undefined }), strip(od))
})
