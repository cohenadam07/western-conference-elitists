// The Savant cleanup bundle held to itself: position labels, ages, same-age pools, With/Without.
//   npm run check:savant-cleanup
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('positions: each label stays within 5 points of its share before the change', () => {
  const was = { Guard: 0, Wing: 0, Big: 0 }, now = { Guard: 0, Wing: 0, Big: 0 }
  let n = 0
  for (const [, b] of Object.entries(archive.data)) {
    for (const p of b.players) { was[p.pos0 || p.pos]++; now[p.pos]++; n++ }
  }
  for (const k of Object.keys(was)) assert.ok(Math.abs(was[k] - now[k]) / n <= 0.05, `${k}: ${was[k]} -> ${now[k]} of ${n}`)
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
