// npm run check:tiles
//
// The homepage tiles each show one true, current fact (scripts/lib/tile-data.mjs). This checks
// every fact against the file its tool reads, so a tile can never say something its tool does
// not, and that the homepage draws a fact on each tile that has one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { gather } from '../../scripts/lib/tile-data.mjs'
import { buildSavantApi } from '../../scripts/lib/savant-api.mjs'
import { readAllSavantSlots, readValueModel } from '../../scripts/lib/savant-value.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUB = path.join(ROOT, 'public')
const json = (rel) => {
  const b = readFileSync(path.join(PUB, rel))
  return JSON.parse(rel.endsWith('.gz') ? zlib.gunzipSync(b) : b)
}
const warnings = []
const tiles = gather(ROOT, (m) => warnings.push(m))
const KEYS = ['nba', 'nfl', 'ufc', 'cbb', 'cfb', 'nbac', 'cbbc', 'nflc', 'draft', 'news']

test('every tile that should have a fact has one, read without a warning', () => {
  assert.deepEqual(warnings, [])
  assert.deepEqual(Object.keys(tiles).sort(), [...KEYS].sort())
  for (const [k, f] of Object.entries(tiles)) {
    assert.ok(f.label && !/undefined|null|NaN/.test(JSON.stringify(f.rows || f.text)), `${k}: an empty or broken value`)
    if (f.rows) {
      assert.ok(f.rows.length >= 3 && f.rows.length <= 5, `${k}: ${f.rows.length} rows`)
      for (const r of f.rows) assert.ok(r.name && r.show, `${k}: a row without a name or a number`)
    } else assert.ok(f.text, `${k}: neither rows nor text`)
  }
})

test('NBA Savant: the tile is the page\'s own All-Savant 1st Team, with the page\'s values', () => {
  const cur = json('savant-current.json')
  const out = buildSavantApi({ data: cur, html: readFileSync(path.join(PUB, 'basketball-savant.html'), 'utf8'), valueModel: readValueModel(PUB), allSavantSlots: readAllSavantSlots(PUB) })
  const s = out.seasons[cur.seasons[0]]
  const by = new Map(s.players.map((p) => [p.id, p]))
  const want = s.all_savant[0].map((id) => [by.get(id).name, by.get(id).sv[0]]).sort((a, b) => b[1] - a[1])
  assert.deepEqual(tiles.nba.rows.map((r) => [r.name, r.value]), want)
  assert.equal(tiles.nba.through, cur.through)
})

test('NFL Savant: the three highest Savant values among qualified players', () => {
  const d = json('football-savant-current.json')
  const q = d.data[d.seasons[0]].players.filter((p) => p.qualified && Number.isFinite(p.m?.sav)).sort((a, b) => b.m.sav - a.m.sav)
  assert.deepEqual(tiles.nfl.rows.map((r) => r.name), q.slice(0, 3).map((p) => p.name))
  assert.ok(q.slice(3).every((p) => p.m.sav <= tiles.nfl.rows[2].value))
})

test('CFB Savant: seeds one to four of the playoff field, by school name and record', () => {
  const season = json('cfb/index.json.gz').current
  const p = json(`cfb/playoff/${season}.json.gz`)
  assert.deepEqual(tiles.cfb.rows.map((r) => r.show), p.field.slice(0, 4).map((f) => `${f.w}-${f.l}`))
  assert.deepEqual(p.field.slice(0, 4).map((f) => f.seed), [1, 2, 3, 4])
  assert.equal(tiles.cfb.label.includes('if the season ended today'), !p.final)
})

test('CBB Savant shows the season being played, not the one the page still opens on', () => {
  const idx = json('cbb/index.json.gz')
  assert.equal(tiles.cbb.season, idx.current)
  const a = json(`cbb/allsavant/${idx.current}.json.gz`)
  assert.deepEqual(new Set(tiles.cbb.rows.map((r) => r.name)), new Set(a.national['1'].map((p) => p.name)))
})

test('the coaching tiles print the top of a Leaders board as the page prints it', () => {
  const b = json('bcs/index.json').leaders.find((x) => x.id === 'season_w_talent')
  assert.deepEqual(tiles.nbac.rows.map((r) => r.name), b.rows.slice(0, 3).map((r) => r.name))
  const c = json('cbcs/index.json.gz').leaders.find((x) => x.id === 'cur_w_roster')
  assert.deepEqual(tiles.cbbc.rows.map((r) => r.name), c.rows.slice(0, 3).map((r) => r.name))
  const d = json('coaching-savant-current.json')
  const best = Math.max(...Object.values(d.coaches).map((x) => x.seasons.find((s) => s.season === d.season)?.waa ?? -Infinity))
  assert.equal(tiles.nflc.rows[0].value, best)
})

test('the homepage draws a fact on each of those tiles, sorted under six headers', () => {
  const jsx = readFileSync(path.join(ROOT, 'src/components/Gateway.jsx'), 'utf8')
  for (const k of [...KEYS, 'analysis']) assert.equal(jsx.split(`<Live k="${k}" />`).length - 1, 1, `the ${k} tile should draw its fact once`)
  const heads = [...jsx.matchAll(/<h2 className="gh g-[a-z]+"><span>([^<]+)<\/span>/g)].map((m) => m[1])
  assert.deepEqual(heads, ['NBA', 'NFL', 'College', 'UFC', 'Games', 'Read'])
  assert.equal(jsx.split('<a className="card ').length - 1, 16, 'a tile went missing')
})

test('every fact with a season is about the season being played', () => {
  const current = {
    nba: json('savant-current.json').seasons[0],
    nfl: json('football-savant-current.json').seasons[0],
    cbb: json('cbb/index.json.gz').current,
    cfb: json('cfb/index.json.gz').current,
    nbac: json('bcs/index.json').meta.current,
    cbbc: json('cbcs/index.json.gz').meta.current,
  }
  for (const [k, season] of Object.entries(current)) assert.equal(String(tiles[k].season), String(season), `the ${k} tile is not on the current season`)
  assert.ok(tiles.nflc.label.includes(String(json('coaching-savant-current.json').season)))
  for (const [k, f] of Object.entries(tiles)) assert.ok(!/career|all-time/i.test(`${f.label} ${f.sub || ''}`), `the ${k} tile shows a career number`)
})
