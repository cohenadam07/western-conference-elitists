// Matchup difficulty (creation-weighted): the threat math on a hand-worked league, and the
// wiring held to what was approved. The connector's side is tools/savant-mtchc/connector.mjs.
//
//   node --test tools/savant-mtchc/check.mjs        (part of npm run check:savant)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const html = readFileSync(path.join(ROOT, 'public/basketball-savant.html'), 'utf8')
const cfg = (() => {
  const i = html.indexOf('const CFG  = ') + 'const CFG  = '.length
  let d = 0
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++
    else if (html[j] === '}' && --d === 0) return JSON.parse(html.slice(i, j + 1))
  }
})()
const metric = (k) => cfg.metrics.find((m) => m.key === k)
const ext = (s) => JSON.parse(readFileSync(path.join(ROOT, 'public/savant-ext/s', `${s}.json`), 'utf8'))
const settle = JSON.parse(readFileSync(path.join(ROOT, 'tools/savant-settle/settle.json'), 'utf8')).stats

test('threat and weighting math: three offensive players and one defender, worked by hand', () => {
  const out = execFileSync('python3', ['-W', 'ignore', path.join(ROOT, 'tools/savant-mtchc/threat_check.py')], { encoding: 'utf8' })
  assert.match(out, /ok/)
})

test('the card: mtchc beside mtch, percentile-led, its two parts in the tooltip; the parts on the leaderboards only', () => {
  const m = metric('mtchc')
  assert.equal(m.label, 'Matchup difficulty (creation-weighted)')
  assert.equal(m.group, 'def')
  assert.equal(m.beside, 'mtch')
  assert.equal(m.lead, 'pct')
  assert.deepEqual(m.parts, ['mtchc_score', 'mtchc_create'])
  assert.equal(m.first, '2017-18')
  assert.equal(m.thr, 560)
  assert.deepEqual([m.settle.mean, m.settle.last, m.settle.unit], [560, 1600, 'matchup possessions'])
  for (const k of ['mtchc_score', 'mtchc_create']) assert.equal(metric(k).scope, 'board', k)
  assert.equal(metric('mtchc_overall'), undefined, 'the Overall part is the Data Room\'s only')
  assert.match(html, /for\(const x of \(XBESIDE\[m\.key\]\|\|\[\]\)\) subRows\+=barRow\(x\);/, 'the main card draws it after mtch')
  assert.equal(metric('mtch').since, '2017-18')
})

test('the explainer says what it is and what it is not', () => {
  const line = html.split('\n').find((l) => l.startsWith(' mtchc:{'))
  assert.ok(line, 'mtchc has an explainer')
  assert.match(line, /not how well he defends them/)
  assert.match(line, /Bigs who mostly guard scoring bigs rank lower, because bigs create less; for a big, the position percentile is the fair read/)
  assert.match(line, /Settles around 1,600 matchup possessions/)
  assert.match(line, /Hatched under 560 matchup possessions/)
})

test('the settle points are measured for the four keys, and nothing before 2017-18 carries a value', () => {
  for (const [k, mean, last] of [['mtchc', 560, 1600], ['mtchc_score', 600, 1700], ['mtchc_create', 500, 1400], ['mtchc_overall', 1200, 3300]]) {
    assert.deepEqual([settle[k].show_mean, settle[k].show_last, settle[k].method], [mean, last, 'season'], k)
  }
  const keys = ['mtchc', 'mtchc_score', 'mtchc_create', 'mtchc_overall']
  for (const f of readdirSync(path.join(ROOT, 'public/savant-ext/s')).filter((f) => f.endsWith('.json'))) {
    const s = f.slice(0, -5), doc = ext(s)
    const at = keys.map((k) => doc.keys.indexOf(k))
    assert.ok(at.every((i) => i >= 0), `${s}: laid out on the current key list`)
    const n = Object.values(doc.players).filter((w) => w.season && w.season[at[0]]).length
    if (s < '2017-18') assert.equal(n, 0, `${s}: no mtchc before the matchup data`)
    else assert.ok(n > 400, `${s}: ${n} defenders`)
    for (const w of Object.values(doc.players)) {
      const r = w.season
      if (!r || !r[at[0]]) continue
      const [t, a, b, c] = at.map((i) => r[i][0])
      assert.ok(Math.abs((a + b + c) / 3 - t) < 0.002, `${s}: mtchc is the mean of its parts`)
    }
  }
})
