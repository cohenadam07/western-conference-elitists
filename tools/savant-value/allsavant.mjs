// node --test tools/savant-value/allsavant.mjs      (part of npm run check:savant)
//
// The All-Savant Team by All-NBA's rules for the era (Basketball Savant 2.9.0):
//   through 2022-23  2 guards, 2 forwards, 1 center, eligible at a slot with 30%+ of his minutes there
//                    (public/savant-allsavant.json), the highest total value those slots allow
//   2023-24 on       positionless, the five highest values, then the next five
// Holds two hand-checked seasons to their picks, checks the optimiser against brute force in every
// positional season, and checks the eligibility file against the position-estimate panels.
// (check.mjs still holds SavantValue.team, the old fixed shape, to value.py: the model's own test.)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../../public/savant-value.js'
import { readSavantData } from '../../scripts/lib/savant-merge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(HERE, '..', '..', 'public')
const SV = globalThis.SavantValue
const model = JSON.parse(fs.readFileSync(path.join(PUB, 'savant-value.json'), 'utf8'))
const slots = JSON.parse(fs.readFileSync(path.join(PUB, 'savant-allsavant.json'), 'utf8'))
const data = readSavantData(PUB)
const teamsOf = (season) => {
  const ps = data.data[season].players
  const res = SV.season(ps, model)
  return { ps, res, teams: SV.allSavant(ps, res, season, slots, 2) }
}
const short = (t) => t.map((x) => [String(x.p.id), x.slot])

test('the eligibility file: 30% cutoff, positionless from 2023-24, every qualified player of every positional season', () => {
  assert.equal(slots.cutoff, 30)
  assert.equal(slots.positionless_from, '2023-24')
  for (const season of data.seasons) {
    if (season >= '2023-24') { assert.equal(slots.seasons[season], undefined, season); continue }
    const rows = slots.seasons[season]
    assert.ok(rows, season)
    for (const p of data.data[season].players) if (p.qualified) assert.match(rows[String(p.id)] || '', /^G?F?C?\|/, `${season} ${p.name}`)
  }
})

test('eligibility follows the position estimate: 30% or more of his minutes at the slot', () => {
  for (const season of ['1996-97', '2010-11', '2022-23']) {
    const pe = JSON.parse(fs.readFileSync(path.join(PUB, 'savant-ext', 'panels', `${season}.json`), 'utf8')).players
    let n = 0
    for (const [id, row] of Object.entries(slots.seasons[season])) {
      const p = pe[id] && pe[id].pe
      if (!p || !(p.reduce((a, b) => a + b, 0) > 0)) continue
      const g = p[0] + p[1], f = p[2] + p[3], c = p[4]
      const want = (g >= 30 ? 'G' : '') + (f >= 30 ? 'F' : '') + (c >= 30 ? 'C' : '')
      assert.equal(row.split('|')[0], want, `${season} ${id}`)
      n++
    }
    assert.ok(n > 200, `${season}: ${n} checked`)
  }
})

// Hand-checked, Nov 19 2026. 2010-11: the three best guard-eligible values are Paul 531, Wade 370 and
// Ginobili 361 (58% of his minutes at guard, 42% at forward), so with the guard slots full he takes a
// forward slot beside LeBron and Pierce (319) drops to the 2nd team. Love is forward only there (25%
// at center), Gasol center only (29% at forward). Lowry and Nowitzki tie at 260 in different slots.
test('2010-11 (positional, a dual-eligible pick): the hand-checked teams', () => {
  const { teams } = teamsOf('2010-11')
  assert.deepEqual(short(teams[0]), [['101108', 'G'], ['2548', 'G'], ['2544', 'F'], ['1938', 'F'], ['2730', 'C']])
  assert.deepEqual(short(teams[1]), [['959', 'G'], ['200768', 'G'], ['1718', 'F'], ['201567', 'F'], ['2200', 'C']])
  const manu = teams[0][3]
  assert.equal(manu.p.name, 'Manu Ginobili')
  assert.equal(manu.el, 'GF')
  assert.deepEqual(manu.sh, [58, 42, 0])
})

// Hand-checked: the ten highest values in order; Reaves and Chris Paul tie at 214 for the last two,
// Dyson Daniels (203) is 11th. No 65-game rule: Dončić is 2nd-team No. 1 on 50 games.
test('2024-25 (positionless): the hand-checked teams, by value', () => {
  const { teams } = teamsOf('2024-25')
  assert.deepEqual(teams[0].map((x) => x.p.name), ['Nikola Jokić', 'Shai Gilgeous-Alexander', 'Giannis Antetokounmpo', 'Tyrese Haliburton', 'Stephen Curry'])
  assert.deepEqual(teams[1].map((x) => x.p.name), ['Luka Dončić', 'James Harden', 'Jimmy Butler III', 'Austin Reaves', 'Chris Paul'])
  for (const t of teams) {
    assert.deepEqual(t.map((x) => x.slot), [null, null, null, null, null])
    assert.deepEqual(t.map((x) => x.rank), [1, 2, 3, 4, 5])
  }
})

// Independent of the optimiser: every 5 from the five best eligible at each slot (an optimal team only
// ever uses those: a pick outside them could be swapped for one of the five not already on the team),
// any legal slotting, highest total.
function brute(cands) {
  const top = [...new Set(['G', 'F', 'C'].flatMap((s) => cands.filter((c) => c.el.includes(s)).slice(0, 5)))]
  let best = -Infinity
  const fits = (five) => {
    const need = ['G', 'G', 'F', 'F', 'C']
    const go = (i, left) => i === five.length || left.some((s, j) => five[i].el.includes(s) && go(i + 1, left.filter((_, k) => k !== j)))
    return go(0, need)
  }
  const pick = (start, chosen, sum) => {
    if (chosen.length === 5) { if (sum > best + 1e-9 && fits(chosen)) best = sum; return }
    for (let i = start; i < top.length; i++) pick(i + 1, [...chosen, top[i]], sum + top[i].value)
  }
  pick(0, [], 0)
  return best
}

test('every positional season: both teams are the highest total the slots allow (brute force), each pick eligible where he plays', () => {
  for (const season of data.seasons) {
    const { ps, res, teams } = teamsOf(season)
    assert.equal(teams.length, 2, season)
    if (SV.positionless(season, slots)) {
      const q = [...res.values()].filter((v) => v.q).sort((a, b) => b.value - a.value).slice(0, 10).map((v) => v.id)
      assert.deepEqual(teams.flat().map((x) => x.p.id), q, season)
      continue
    }
    const used = new Set()
    for (const t of teams) {
      assert.deepEqual(t.map((x) => x.slot), ['G', 'G', 'F', 'F', 'C'], season)
      for (const x of t) assert.ok(x.el.includes(x.slot), `${season} ${x.p.name} at ${x.slot} (eligible ${x.el})`)
      const cands = ps.map((p) => res.get(p.id)).filter((v) => v && v.q && !used.has(v.id))
        .sort((a, b) => b.value - a.value).map((v) => ({ value: v.value, el: SV.eligible(season, v.id, v.pos, slots).el }))
      const got = t.reduce((a, x) => a + x.v.value, 0)
      assert.ok(Math.abs(got - brute(cands)) < 1e-6, `${season}: ${got} vs brute ${brute(cands)}`)
      t.forEach((x) => used.add(x.p.id))
    }
  }
})
