// Play context (pipeline/college/context.py) held to its own arithmetic, and the connector to the files.
//
//   node --test tools/savant-cbb/context.mjs        (part of npm run check:savant-cbb)

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CBB = path.join(ROOT, 'public', 'cbb')
const read = (p) => JSON.parse(gunzipSync(readFileSync(path.join(CBB, p + '.gz'))).toString('utf8'))
const idx = read('index.json')
const FULL = idx.seasons.filter((x) => x.context === 'full').map((x) => x.season)
const ROT = idx.seasons.filter((x) => x.context === 'rotation').map((x) => x.season)
const teamsOf = (s) => readdirSync(path.join(CBB, 'ctx', s)).filter((f) => f !== 'league.json.gz').map((f) => f.replace('.json.gz', ''))
const sum = (a) => a.reduce((n, v) => n + v, 0)
let server, tools

before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, 'public', decodeURIComponent(req.url.split('?')[0]) + '.gz')
    if (!existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(gunzipSync(readFileSync(f)))
  })
  await new Promise((r) => server.listen(0, r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  tools = (await import('../../api/_cbb.js')).tools
})
after(() => server.close())
const run = (name, a) => tools.find((t) => t.name === name).run(a)

test('every season the index marks has its context files, and only D1 teams', () => {
  assert.ok(FULL.length >= 1, 'a season with full play context')
  for (const s of [...FULL, ...ROT]) {
    assert.ok(existsSync(path.join(CBB, 'ctx', s, 'league.json.gz')), s)
    const d1 = new Set(read(`teams/${s}.json`).teams.map((t) => t.id))
    for (const t of teamsOf(s)) assert.ok(d1.has(t), `${s}: ${t} is not a D1 team`)
  }
})

test('possession starts add up to the possessions, and the league to its teams', () => {
  for (const s of FULL) {
    const L = read(`ctx/${s}/league.json`)
    assert.equal(sum(Object.values(L.starts).map((v) => v[0])), L.poss[0])
    assert.equal(sum(Object.values(L.starts).map((v) => v[1])), L.poss[1])
    let n = 0
    for (const t of teamsOf(s)) {
      const d = read(`ctx/${s}/${t}.json`)
      assert.equal(sum(Object.values(d.starts.own).map((v) => v[0])), d.poss[0], `${s} ${t}`)
      assert.equal(sum(Object.values(d.starts.own).map((v) => v[1])), d.poss[1], `${s} ${t}`)
      assert.ok(d.transition.own[0] <= d.transition.own[2] && d.transition.own[2] <= d.poss[0])
      for (const r of Object.values(d.ranks || {})) assert.ok(r[1] >= 1 && r[1] <= r[2])
      n += d.poss[0]
    }
    assert.equal(n, L.poss[0], `${s}: D1 teams' possessions ${n} vs league ${L.poss[0]}`)
    const p = L.poss[1] / L.poss[0]
    assert.ok(p > 0.9 && p < 1.2, `D1 points per possession ${p}`)
  }
})

test('shot bins agree with the shot-clock counts, and players with their team', () => {
  for (const s of FULL) {
    for (const t of teamsOf(s).filter((_, i) => i % 9 === 0)) {
      const d = read(`ctx/${s}/${t}.json`)
      const bins = sum(d.shots.own.map((b) => b[2])), fga = sum(Object.values(d.clock.own).map((v) => v[0]))
      assert.ok(bins <= fga && bins >= 0.9 * fga, `${s} ${t}: ${bins} located of ${fga}`)
      const pb = sum(Object.values(d.players).map((p) => sum((p.shots || []).map((b) => b[2]))))
      assert.ok(Math.abs(pb - bins) <= 0.02 * bins + 2, `${s} ${t}: players ${pb} vs team ${bins}`)
      for (const b of d.shots.own) assert.ok(b[3] <= b[2] && b[0] >= 0 && b[0] < 25 && b[1] >= 0 && b[1] < 21)
    }
  }
})

// After own timeouts (Nov 6 2026): only the team's own timeouts count, so the possessions behind the number
// are a subset of the Data Room's possessions after a timeout the team called, garbage time out.
test('after own timeouts counts only possessions after the team\'s own timeout', () => {
  for (const s of FULL) {
    for (const team of teamsOf(s).slice(0, 60)) {
      const d = read(`ctx/${s}/${team}.json`)
      if (!d.pbp) continue
      const pos = read(`pos/${s}/${team}.json`), c = Object.fromEntries(pos.cols.map((k, i) => [k, i]))
      const own = pos.rows.filter((r) => r[c.timeout_before] === 'own' && !r[c.garbage]).length
      assert.ok(d.ato[0] <= own, `${s} ${team}: ${d.ato[0]} after own timeouts, but ${own} possessions after one`)
      assert.ok(pos.rows.every((r) => ['none', 'media', 'own', 'opponent', 'team'].includes(r[c.timeout_before])), `${s} ${team}: an unknown timeout_before`)
    }
  }
})

test('a rotation map adds up to five men for forty minutes', () => {
  for (const s of [...FULL, ...ROT]) {
    let checked = 0
    for (const t of teamsOf(s)) {
      const d = read(`ctx/${s}/${t}.json`)
      if ((d.games || 0) < 8) continue
      const total = sum(Object.values(d.rotation).map((a) => sum(a)))
      assert.ok(total > 190 && total <= 200.5, `${s} ${t}: ${total.toFixed(1)} minutes a game on the map`)
      for (const a of Object.values(d.rotation)) { assert.equal(a.length, 40); for (const v of a) assert.ok(v >= 0 && v <= 1.0001) }
      checked++
    }
    if (teamsOf(s).some((t) => (read(`ctx/${s}/${t}.json`).games || 0) >= 8)) assert.ok(checked > 100, `${s}: ${checked} teams checked`)
  }
})

test('the connector says what the files say', async () => {
  const s = FULL.filter((x) => x < idx.seasons.slice(-1)[0].season).slice(-1)[0] || FULL[0]
  const t = teamsOf(s).find((x) => read(`ctx/${s}/${x}.json`).poss[0] > 1500)
  const d = read(`ctx/${s}/${t}.json`)
  const c = await run('cbb_play_context', { team: t, season: s })
  assert.equal(c.structured.possessions.own, d.poss[0])
  assert.equal(c.structured.after_timeout.possessions, d.ato[0])
  for (const r of c.structured.starts) assert.equal(r.own_poss, d.starts.own[r.start][0])
  const L = read(`ctx/${s}/league.json`)
  for (const r of c.structured.starts) {   // each start is shown against its own D1 average, in the text the assistant reads
    const d1 = (L.starts[r.start][1] / L.starts[r.start][0]).toFixed(2)
    assert.ok(c.text.includes(`${r.label} ${r.own_ppp.toFixed(2)} on ${r.own_poss} (allowed ${r.opp_ppp.toFixed(2)}; D1 ${d1})`), `${r.label} vs D1 ${d1}`)
  }
  const sc = await run('cbb_shot_chart', { team: t, season: s, side: 'own' })
  assert.equal(sum(sc.structured.areas.map((a) => a.fga)), sum(d.shots.own.map((b) => b[2])))
  const ro = await run('cbb_rotation', { team: t, season: s })
  assert.equal(ro.structured.players.length, Object.keys(d.rotation).length)
  const pos = await run('cbb_data', { table: 'possessions', team: t, season: s, filters: [{ column: 'garbage', op: 'eq', value: 0 }], limit: 1, offset: 0 })
  assert.equal(pos.structured.total, d.poss[0], 'the Data Room rows are the possessions counted')
  const pl = Object.entries(d.players).sort((a, b) => b[1].fga - a[1].fga)[0]
  const sp = await run('cbb_player_splits', { player: pl[0], season: s })
  assert.equal(sum(Object.values(sp.structured.context.shot_clock).map((v) => v.fga)), pl[1].fga)
})

test('rotation-only seasons answer rotation, and say play context starts later', async () => {
  for (const s of ROT) {
    const t = teamsOf(s)[0]
    assert.ok((await run('cbb_rotation', { team: t, season: s })).structured.players.length > 0)
    await assert.rejects(run('cbb_play_context', { team: t, season: s }), /rotation maps only/)
  }
})
