// npm run check:search
//
// The ribbon's search box (public/wce-nav.js) opens a card in whichever tool has it. Its name
// lists are written by scripts/lib/site-search.mjs. This checks that every address it writes is
// the address the tool's own connector prints for the same person, that the real files in
// public/ still read, and that the ribbon ranks names the way people type them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import * as S from '../../scripts/lib/site-search.mjs'
import { cardUrl as nbaUrl } from '../../api/_basketball.js'
import { cardUrl as nflUrl } from '../../api/_football.js'
import { coachUrl as nflCoachUrl } from '../../api/_coaching.js'
import { coachUrl as nbaCoachUrl } from '../../api/_bcoaching.js'
import { coachUrl as cbbCoachUrl } from '../../api/_cbcoaching.js'
import { playerUrl as cbbUrl, teamUrl as cbbTeamUrl } from '../../api/_cbb.js'
import { playerUrl as cfbUrl, teamUrl as cfbTeamUrl } from '../../api/_cfb.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE = 'https://wcehoops.com'

// A stand-in for the player lists the build writes into dist/savant-api before this runs.
const dist = mkdtempSync(path.join(os.tmpdir(), 'wce-search-'))
const put = (rel, obj) => { mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); writeFileSync(path.join(dist, rel), JSON.stringify(obj)) }
put('savant-api/basketball/v1/players.json', { players: [{ id: 1629029, name: 'Luka Dončić', pos: 'Guard', team: 'LAL', from: '2018-19', to: '2026-27' }] })
put('savant-api/football/v1/players.json', { cols: ['id', 'name', 'pos', 'team', 'from', 'to', 'seasons', 'peak', 'skip'], players: [['00-0034857', 'Josh Allen', 'QB', 'BUF', 2018, 2026, 9, 2024, 0]] })
put('savant-api/ufc/v1/fighters.json', { fighters: [{ id: '1338e2c7480bdf9e', name: 'Israel Adesanya', div: 'MW', active: true, rec: [24, 5, 0, 0], last: '2026-02-01' }] })
put('savant-api/coaching/v1/coaches.json', { people: [{ name: 'Andy Reid', hc: true, first: 1999, last: 2026, teams: ['PHI', 'KC'] }] })
const warnings = []
const { core, college } = S.buildSearch({ publicDir: path.join(ROOT, 'public'), dist, warn: (m) => warnings.push(m) })
const one = (rows, kind, name) => rows.find((r) => r[1] === kind && (!name || r[0] === name))
test.after(() => rmSync(dist, { recursive: true, force: true }))

test('every source reads, and every row has a name, a known kind and an address on this site', () => {
  assert.deepEqual(warnings, [])
  for (const kind of ['nba', 'nfl', 'ufc', 'nflc', 'nbac', 'cbbc', 'nbat', 'nflt']) assert.ok(one(core, kind), `core has no ${kind} rows`)
  for (const kind of ['cbb', 'cbbt', 'cfb', 'cfbt']) assert.ok(one(college, kind), `college has no ${kind} rows`)
  for (const r of [...core, ...college]) {
    assert.ok(r[0] && S.KINDS[r[1]] && typeof r[2] === 'string' && Number.isInteger(r[4]), `a bad row: ${JSON.stringify(r)}`)
    assert.match(r[3], /^\/(nba|nfl|ufc|cbb|cfb)-(savant|coaching-savant)[?#]/, `${r[0]}: not a card address (${r[3]})`)
  }
})

test('an address is the one the tool\'s own connector prints', () => {
  assert.equal(SITE + one(core, 'nba', 'Luka Dončić')[3], nbaUrl(1629029))
  assert.equal(SITE + one(core, 'nfl', 'Josh Allen')[3], nflUrl('00-0034857', 2026))
  assert.equal(SITE + one(core, 'nflc', 'Andy Reid')[3], nflCoachUrl('Andy Reid'))
  assert.equal(one(core, 'ufc')[3], '/ufc-savant#f=1338e2c7480bdf9e') // the page reads #f=<id>; the window defaults to career
  const pop = one(core, 'nbac', 'Gregg Popovich')
  assert.equal(SITE + pop[3], nbaCoachUrl(pop[3].split('#c=')[1]))
  const cc = one(core, 'cbbc')
  assert.equal(SITE + cc[3], cbbCoachUrl(decodeURIComponent(cc[3].split('#c=')[1])))
  const p = one(college, 'cbb')
  const [, pid, season] = /#player-([^/]+)\/(.+)$/.exec(p[3])
  assert.equal(SITE + p[3], cbbUrl(pid, season))
  const t = one(college, 'cbbt')
  assert.equal(SITE + t[3], cbbTeamUrl(t[3].split('#team-')[1]))
  const f = one(college, 'cfbt')
  assert.equal(SITE + f[3], cfbTeamUrl(f[3].split('#team-')[1]))
  const fp = college.find((r) => r[1] === 'cfb' && /\/\d{4}$/.test(r[3]))
  if (fp) { const m = /#player-([^/]+)\/(\d{4})$/.exec(fp[3]); assert.equal(SITE + fp[3], cfbUrl(m[1], Number(m[2]), 'not this season')) }
})

test('college players go back four seasons and no further; teams are all there', () => {
  for (const kind of ['cbb', 'cfb']) {
    const years = college.filter((r) => r[1] === kind).map((r) => r[4])
    assert.equal(Math.max(...years) - Math.min(...years), S.COLLEGE_SEASONS - 1, `${kind}: not ${S.COLLEGE_SEASONS} seasons`)
  }
  assert.ok(college.filter((r) => r[1] === 'cbbt').length > 300 && college.filter((r) => r[1] === 'cfbt').length > 100)
})

test('CFB players of the season being played are in the list, on this season and their current team', () => {
  const idx = JSON.parse(zlib.gunzipSync(readFileSync(path.join(ROOT, 'public/cfb/index.json.gz'))))
  const now = JSON.parse(zlib.gunzipSync(readFileSync(path.join(ROOT, `public/cfb/s/${idx.current}.json.gz`))))
  const rows = college.filter((r) => r[1] === 'cfb')
  const thisSeason = rows.filter((r) => r[4] === idx.current)
  assert.equal(thisSeason.length, now.players.length, 'the list should hold everyone in this season\'s file')
  // this season's cards have no season in their address: the tool leaves it off for the current one
  for (const r of thisSeason.slice(0, 200)) assert.match(r[3], /^\/cfb-savant#player-[^/]+$/, `${r[0]}: ${r[3]}`)
})

test('the ribbon has the search box, and its file still reads in Node for the player pages', () => {
  const src = readFileSync(path.join(ROOT, 'public/wce-nav.js'), 'utf8')
  const ctx = {}
  ctx.globalThis = ctx
  vm.runInContext(src, vm.createContext(ctx))
  assert.ok(ctx.WCE_NAV.fallbackHTML().includes('/nba-savant'))
  for (const need of ['class="find"', 'class="sbox"', "'/search/' + name + '.json'", 'four seasons']) assert.ok(src.includes(need), `wce-nav.js lost: ${need}`)
  assert.ok(!/key === '\/'/.test(src), 'the ribbon must not take the "/" key: NFL Savant uses it')
  assert.ok(readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8').includes('savantApi(), siteSearch()'), 'siteSearch must run straight after savantApi')
})
