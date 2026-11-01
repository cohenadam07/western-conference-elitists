// The Savant cleanup bundle held to itself: position labels, ages, same-age pools, With/Without.
//   npm run check:savant-cleanup
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../../public/savant-ww.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pub = (f) => JSON.parse(readFileSync(path.join(ROOT, 'public', f), 'utf8'))
const archive = pub('savant-data.json')
const current = pub('savant-current.json')
const seasons = () => [...Object.entries(archive.data), ...Object.entries(current.data)]

// position_labels.py, the rule's edges, as percentages
const groups = (pe) => {
  const t = pe.reduce((a, b) => a + b, 0) || 1
  const p = pe.map((x) => (100 * x) / t)
  return { Guard: p[0] + p[1], Wing: p[2] + p[3], Big: p[3] + p[4], C: p[4] }
}

test('positions: Bona and Diabate are bigs in every season the estimate covers', () => {
  for (const [s, b] of seasons()) {
    if (s < '1996-97') continue
    for (const p of b.players) if (p.name === 'Adem Bona' || p.name === 'Moussa Diabate') assert.equal(p.pos, 'Big', `${p.name} ${s}`)
  }
})

test('positions: the label never contradicts the estimate the card shows', () => {
  let n = 0
  for (const [s, b] of seasons()) {
    if (s < '1996-97') continue
    const panels = pub(`savant-ext/panels/${s}.json`).players
    for (const p of b.players) {
      const pe = (p.posx && p.posx.pe) || (panels[p.id] && panels[p.id].pe)
      if (!pe || !pe.some(Boolean)) continue
      const g = groups(pe)
      n++
      // the estimate rules a label out when the label's group is nearly empty
      if (p.pos === 'Guard') assert.ok(g.Guard >= 25, `${p.name} ${s} Guard on ${pe}`)
      if (p.pos === 'Big') assert.ok(g.Big >= 25, `${p.name} ${s} Big on ${pe}`)
      if (p.pos === 'Wing') assert.ok(g.Wing >= 25, `${p.name} ${s} Wing on ${pe}`)
    }
  }
  assert.ok(n > 14000, `only ${n} rows checked`)
})

test('positions: Guard holds its share; heavy-PF players move from Wing to Big, and no further', () => {
  // Nov 1, 2026: a player who plays mostly at the 4 and the 5 is a Big, so Big was meant to move by
  // more than the 5 points the first rule held to. Guard still holds, and the other two are bounded.
  const was = { Guard: 0, Wing: 0, Big: 0 }, now = { Guard: 0, Wing: 0, Big: 0 }
  let n = 0
  for (const [, b] of Object.entries(archive.data)) {
    for (const p of b.players) { was[p.pos0 || p.pos]++; now[p.pos]++; n++ }
  }
  assert.ok(Math.abs(was.Guard - now.Guard) / n <= 0.05, `Guard: ${was.Guard} -> ${now.Guard} of ${n}`)
  assert.ok((now.Big - was.Big) / n <= 0.1, `Big: ${was.Big} -> ${now.Big} of ${n}`)
  assert.ok(now.Wing / n >= 0.25, `Wing: ${now.Wing} of ${n}`)
})

// savant_config.whole_age / _age_from_birthdate
const onFeb1 = (season) => Date.UTC(+season.slice(0, 4) + 1, 1, 1)
const decimal = (bd, season) => Math.round(((onFeb1(season) - Date.parse(`${bd}T00:00:00Z`)) / 864e5 / 365.25) * 100) / 100

test('ages: every row with a birth date is exact on February 1 of its season', () => {
  let n = 0
  for (const [s, b] of seasons()) {
    for (const p of b.players) {
      if (!p.birthdate) continue
      n++
      assert.ok(Math.abs(p.age - decimal(p.birthdate, s)) < 0.0101, `${p.name} ${s}: ${p.age} vs ${decimal(p.birthdate, s)}`)
    }
  }
  assert.ok(n > 14900)
})

test('ages: the spot checks, against birth dates checked by hand', () => {
  const want = [
    ['Adem Bona', '2003-03-28', '2026-27', 23.85], ['Shai Gilgeous-Alexander', '1998-07-12', '2025-26', 27.56],
    ['Nikola Jokic', '1995-02-19', '2025-26', 30.95], ['LeBron James', '1984-12-30', '2025-26', 41.09],
    ['Stephen Curry', '1988-03-14', '2025-26', 37.89], ['Victor Wembanyama', '2004-01-04', '2025-26', 22.08],
    ['Giannis Antetokounmpo', '1994-12-06', '2025-26', 31.16], ['Luka Doncic', '1999-02-28', '2025-26', 26.93],
    ['Kevin Durant', '1988-09-29', '2025-26', 37.34], ['Jayson Tatum', '1998-03-03', '2025-26', 27.92],
    ['Anthony Edwards', '2001-08-05', '2025-26', 24.49], ['Chet Holmgren', '2002-05-01', '2025-26', 23.76],
    ['Jalen Williams', '2001-04-14', '2025-26', 24.8], ['Cooper Flagg', '2006-12-21', '2025-26', 19.12],
    ['Scoot Henderson', '2004-02-03', '2025-26', 22], ['Samuel Dalembert', '1981-05-10', '2007-08', 26.73],
    ['Luke Schenscher', '1982-12-31', '2005-06', 23.09], ['Tim Duncan', '1976-04-25', '2010-11', 34.77],
    ['Kobe Bryant', '1978-08-23', '2005-06', 27.45], ['Kevin Garnett', '1976-05-19', '2003-04', 27.71],
  ]
  for (const [name, bd, s, age] of want) {
    const block = archive.data[s] || current.data[s]
    const p = block.players.find((q) => q.name === name)
    assert.ok(p, `${name} ${s}`)
    assert.equal(p.birthdate, bd, name)
    assert.ok(Math.abs(p.age - age) < 0.0101, `${name} ${s}: ${p.age} vs ${age}`)
  }
})

const ageIndex = pub('savant-ext/age/index.json')
const agePool = (age) => pub(`savant-ext/age/${age}.json`)

test('same age: the pools hold every qualified player-season once, finished seasons, from 1996-97', () => {
  const count = {}
  for (const [s, b] of Object.entries(archive.data)) {
    if (s < '1996-97' || current.data[s]) continue
    for (const p of b.players) {
      if (!p.qualified) continue
      const [y, m, d] = p.birthdate.split('-').map(Number)
      const a = +s.slice(0, 4) + 1 - y - (m > 2 || (m === 2 && d > 1) ? 1 : 0)
      count[a] = (count[a] || 0) + 1
    }
  }
  assert.deepEqual(Object.fromEntries(Object.entries(ageIndex.ages).map(([k, v]) => [k, v.n])), count)
  for (const v of Object.values(ageIndex.ages)) assert.equal(v.n, v.Guard + v.Wing + v.Big)
  assert.equal(ageIndex.first, '1996-97')
  assert.ok(!Object.keys(current.data).some((s) => ageIndex.last >= s), 'the season in progress stays out')
})

test('same age: sorted, and the thin ends sit under the minimums', () => {
  const ages = Object.keys(ageIndex.ages).map(Number)
  for (const a of ages) {
    for (const lists of Object.values(agePool(a).v)) for (const l of lists) for (let i = 1; i < l.length; i++) assert.ok(l[i - 1] <= l[i])
  }
  assert.ok(ageIndex.ages[18].n < ageIndex.min_age)
  assert.ok(ageIndex.ages[39].n < ageIndex.min_age)
  assert.ok(ageIndex.ages[19].n >= ageIndex.min_age && ageIndex.ages[38].n >= ageIndex.min_age)
  assert.ok(ageIndex.ages[19].Big < ageIndex.min_age_pos)
})

test('same age: a known extreme lands at the top of his age', () => {
  // Wembanyama's 2024-25 blocks at 21, against every 21-year-old since 1996-97
  const w = archive.data['2024-25'].players.find((p) => p.name === 'Victor Wembanyama')
  const blk = w.m.blk.season.v
  const vals = agePool(21).v.blk.flat().sort((a, b) => a - b)
  assert.ok(vals.filter((x) => x < blk).length / vals.length > 0.97)
})

// ---- With / Without ------------------------------------------------------------------------
const WW = globalThis.SavantWW
const wwFile = (f) => JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public/bcs/ww', f))))
const SGA = 1628983, JDUB = 1631114

test('with/without: SGA and Jalen Williams, 2025-26, add up to his season in both modes', () => {
  const doc = wwFile('OKC-2025-26.json.gz')
  const card = archive.data['2025-26'].players.find((p) => p.id === SGA)
  for (const mode of ['floor', 'games']) {
    const r = WW.split(doc, SGA, [JDUB], mode)
    assert.ok(Math.abs(r.with.minutes + r.without.minutes - card.m.minshare.season.n) < 1, `${mode} minutes`)
    const pts = r.with.totals.pts + r.without.totals.pts, ast = r.with.totals.ast + r.without.totals.ast
    const gp = card.m.avail.season.n
    assert.equal(Math.round((10 * pts) / gp) / 10, card.line.ppg, `${mode} points`)
    assert.equal(Math.round((10 * ast) / gp) / 10, card.line.apg, `${mode} assists`)
    assert.equal(WW.split(doc, SGA, [JDUB], mode).rows.length, r.rows.length)
  }
  // the bug this view exists to fix: he is a pick now, and he missed real time
  assert.ok(WW.teammates(doc, SGA).some((m) => m.id === JDUB))
  assert.ok(WW.split(doc, SGA, [JDUB], 'games').without.games >= 35)
})

test('with/without: several teammates at once, and Without means none of them', () => {
  const doc = wwFile('OKC-2025-26.json.gz')
  const CHET = doc.players.find((p) => p[1] === 'Chet Holmgren')[0]
  const one = WW.split(doc, SGA, [JDUB], 'floor'), two = WW.split(doc, SGA, [JDUB, CHET], 'floor')
  assert.ok(two.without.sec < one.without.sec, 'without both is a subset of without one')
  assert.equal(two.with.sec + two.without.sec, one.with.sec + one.without.sec)
})

test('with/without: every player-season from 2007-08 adds up to his card', () => {
  for (const [s, b] of Object.entries(archive.data)) {
    if (s < '2007-08') continue
    const sec = {}
    for (const f of readdirSync(path.join(ROOT, 'public/bcs/ww')).filter((x) => x.endsWith(`-${s}.json.gz`) && !x.startsWith('index-'))) {
      const d = wwFile(f)
      for (const u of d.units) for (const i of u[0]) sec[d.players[i][0]] = (sec[d.players[i][0]] || 0) + u[1]
    }
    const miss = []
    for (const p of b.players) {
      const mn = p.m.minshare && p.m.minshare.season && p.m.minshare.season.n
      if (mn >= 500 && sec[p.id] != null && Math.abs(sec[p.id] / 60 - mn) > 0.05 * mn) miss.push(`${p.name} ${Math.round(sec[p.id] / 60)}/${mn}`)
    }
    assert.ok(miss.length <= 2, `${s}: ${miss.join(', ')}`)
  }
})

test('with/without: every stat has a settle point, and tracking is never shown as a number', () => {
  const doc = wwFile('OKC-2025-26.json.gz')
  const r = WW.split(doc, SGA, [JDUB], 'floor')
  for (const x of r.rows) assert.ok(x.settles_at > 0, `${x.key} has no settle point`)
  assert.deepEqual(r.not_splittable.map((n) => n[0]), ['Tracking', 'Synergy', 'Hustle'])
  for (const k of ['drv', 'potast', 'defl', 'syn']) assert.ok(!r.rows.some((x) => x.key === k))
})

// ---- the connector's wrappers ---------------------------------------------------------------
// A tool's `run` is what the connector calls. Calling playerProfile directly skips it, which is how
// `pool` went missing from nba_get_player_profile with every check green.
const MODULES = ['_basketball.js', '_basketball-lists.js', '_football.js', '_football-lists.js', '_football-games.js', '_ufc.js', '_coaching.js', '_bcoaching.js', '_draft.js', '_site.js', '_fantasy.js']

test('connector: every input a tool declares reaches its handler', async () => {
  const lost = []
  let n = 0
  for (const m of MODULES) {
    const file = path.join(ROOT, 'api', m)
    if (!existsSync(file)) continue
    const { tools } = await import(file)
    for (const tool of tools || []) {
      const keys = Object.keys((tool.config && tool.config.inputSchema) || tool.inputSchema || {})
      const src = tool.run.toString()
      const named = src.match(/^(?:async\s*)?\(\{([^}]*)\}/)
      n++
      if (!named) continue                       // (args) => ...: everything goes through
      const has = named[1].split(',').map((s) => s.split(/[:=]/)[0].trim()).filter(Boolean)
      for (const k of keys) if (!has.includes(k)) lost.push(`${tool.name}: ${k}`)
    }
  }
  assert.ok(n > 40, `only ${n} tools found`)
  assert.deepEqual(lost, [])
})

test('connector: same-age pools through the tool itself', async () => {
  const { tools } = await import(path.join(ROOT, 'api', '_basketball.js'))
  const tool = tools.find((t) => t.name === 'nba_get_player_profile')
  const std = await tool.run({ player: 'Victor Wembanyama', season: '2024-25', group: 'defense' })
  assert.equal(std.structured.pools.selected, undefined)
  for (const [pool, mark] of [['same_age', /21-year-olds/], ['same_age_position', /21-year-old bigs|bigs/]]) {
    const { structured: s } = await tool.run({ player: 'Victor Wembanyama', season: '2024-25', group: 'defense', pool })
    assert.equal(s.pools.selected.pool, pool)
    assert.equal(s.pools.selected.age, 21)
    assert.match(s.pools.selected.label, mark)
    assert.ok(s.stats.some((x) => x.pool_percentile != null))
  }
})

// ---- the position rule ----------------------------------------------------------------------
const seasonsOf = (name) => seasons().flatMap(([s, b]) => b.players.filter((p) => p.name === name).map((p) => ({ s, ...p })))

test('positions: a player who lives at the 4 and the 5 is a Big', () => {
  for (const [name, season] of [['Giannis Antetokounmpo', '2020-21'], ['Giannis Antetokounmpo', '2025-26'], ['Carlos Boozer', '2013-14'], ['Tim Duncan', '1997-98']]) {
    assert.equal(seasonsOf(name).find((r) => r.s === season).pos, 'Big', `${name} ${season}`)
  }
  assert.equal(seasonsOf('Cameron Boozer').find((r) => r.s === '2026-27').pos, 'Big')
})

test('positions: stretch-4 wings stay off Big', () => {
  for (const name of ['Jaylen Brown', 'DeMar DeRozan', 'Mikal Bridges']) {
    const rows = seasonsOf(name)
    assert.ok(rows.length > 5, name)
    assert.deepEqual(rows.filter((r) => r.pos === 'Big').map((r) => r.s), [], name)
  }
})

test('positions: the season in progress has its estimates and value bars', () => {
  const s = Object.keys(current.data)[0]
  const panels = pub(`savant-ext/panels/${s}.json`).players
  const rows = current.data[s].players
  assert.ok(Object.values(panels).filter((p) => p.pe && p.pe.some(Boolean)).length / rows.length > 0.9, 'position estimates are missing')
  assert.ok(rows.filter((p) => p.m.bpm && p.m.bpm.season && p.m.bpm.season.v != null).length / rows.length > 0.8, 'value bars are missing')
})

test('positions: search follows the most recent season', async () => {
  const { readSavantData } = await import(path.join(ROOT, 'scripts/lib/savant-merge.mjs'))
  const { buildSavantApi } = await import(path.join(ROOT, 'scripts/lib/savant-api.mjs'))
  const data = readSavantData(path.join(ROOT, 'public'))
  const out = buildSavantApi({ data, html: readFileSync(path.join(ROOT, 'public/basketball-savant.html'), 'utf8') })
  const newest = new Map()
  for (const season of data.seasons) for (const p of out.seasons[season].players) if (!newest.has(p.id)) newest.set(p.id, p.pos)
  for (const p of out.players.players) assert.equal(p.pos, newest.get(p.id), p.name)
  assert.equal(out.players.players.find((p) => p.name === 'Carlos Boozer').pos, 'Big')
})

test('pipeline: a run without Basketball Reference keeps the last good run, and the fallback chain works', () => {
  const out = execFileSync('python3', ['-W', 'ignore', path.join(ROOT, 'tools/savant-cleanup/keep.py')], { encoding: 'utf8' })
  assert.match(out, /ok/)
})
