// node --test tools/savant-value/check.mjs
//
// Holds the page's Savant value (public/savant-value.js) to the fitter's math (value.py):
// every player's rate and value, and both All-Savant teams, for the seasons in
// expected.json (written by `python3 value.py expected`). Then runs every season in the
// archive and requires a full, finite team of five, twice over.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../../public/savant-value.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(HERE, '..', '..', 'public')
const SV = globalThis.SavantValue
const model = JSON.parse(fs.readFileSync(path.join(PUB, 'savant-value.json'), 'utf8'))
const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'expected.json'), 'utf8'))
const data = JSON.parse(fs.readFileSync(path.join(PUB, 'savant-data.json'), 'utf8'))
const html = fs.readFileSync(path.join(PUB, 'basketball-savant.html'), 'utf8')

// The page's position overrides, applied the way prepData() does.
const grab = (name) => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*(\\{[^;]*\\});`))
  return m ? Function(`return (${m[1]})`)() : {}
}
const FIX_ID = grab('POS_FIX_ID'), FIX_NAME = grab('POS_FIX_NAME')
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const posOf = (p) => FIX_ID[p.id] || FIX_NAME[norm(p.name)] || p.pos

test('model file is the one the fixture was made from', () => {
  assert.equal(expected.model_version, model.version)
  for (const k of ['beta', 'credit', 'settle', 'parts', 'scale', 'repl_pct', 'shape']) assert.ok(model[k] != null, k)
})

for (const [season, exp] of Object.entries(expected.seasons)) {
  test(`${season}: every value matches value.py`, () => {
    const players = data.data[season].players
    const res = SV.season(players, model, posOf)
    let n = 0
    for (const [id, [rate, value]] of Object.entries(exp.values)) {
      const got = res.get(/^-?\d+$/.test(id) ? +id : id)
      assert.ok(got, `missing ${id}`)
      assert.ok(Math.abs(got.rate - rate) < 1e-6, `${season} ${id} rate ${got.rate} vs ${rate}`)
      assert.ok(Math.abs(got.value - value) < 1e-4, `${season} ${id} value ${got.value} vs ${value}`)
      n++
    }
    assert.equal(n, res.size)
  })
  test(`${season}: the same two teams as value.py`, () => {
    const players = data.data[season].players
    const res = SV.season(players, model, posOf)
    const teams = SV.team(players, res, model, posOf, 2).map((t) => t.map((x) => x.p.id))
    assert.deepEqual(teams, exp.teams)
  })
}

test('every season in the archive fields two full teams with finite values', () => {
  for (const season of data.seasons) {
    const players = data.data[season].players
    const res = SV.season(players, model, posOf)
    const teams = SV.team(players, res, model, posOf, 2)
    assert.equal(teams.length, 2, season)
    for (const t of teams) {
      assert.equal(t.length, 5, `${season} team of ${t.length}`)
      assert.deepEqual(t.map((x) => x.pos), ['Guard', 'Guard', 'Wing', 'Wing', 'Big'], season)
      for (const x of t) assert.ok(Number.isFinite(x.v.value) && Number.isFinite(x.v.rate), `${season} ${x.p.name}`)
    }
  }
})

test('a one-game opening week does not break it', () => {
  // the newest season cut to a night's worth of sample: tiny n everywhere, few qualified
  const src = data.data[data.seasons[0]].players.slice(0, 40)
  const tiny = src.map((p) => {
    const m = {}
    for (const [k, c] of Object.entries(p.m || {})) {
      const s = c.season || {}
      m[k] = { season: { v: s.v, n: s.n == null ? null : Math.max(1, Math.round(s.n / 70)) } }
    }
    return { ...p, m, qualified: true }
  })
  const res = SV.season(tiny, model, posOf)
  for (const v of res.values()) assert.ok(Number.isFinite(v.value) && Number.isFinite(v.rate))
})
