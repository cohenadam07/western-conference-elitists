// Parity check for the Savant API files (scripts/lib/savant-api.mjs).
//
//   npm run check:savant-api        (node --test tools/savant-api/check.mjs)
//
// The files exist so that a machine can quote the number a fan sees on a Basketball Savant
// card. So the test is not "does the slicer agree with itself" but "does it agree with the
// page". It lifts the page's own functions out of public/basketball-savant.html — poolVals,
// pctOf, the position corrections, the era rule — runs them in a sandbox over the real
// public/savant-data.json, and compares every stat of every player in every season, in both
// pools, against what the slicer wrote.
//
// If someone changes how the page ranks players, this fails until the slicer follows. If
// the page is restructured so the functions can no longer be found, it fails with the name
// of the missing piece. Either way: fix scripts/lib/savant-api.mjs, do not relax the check.
//
// No network, no keys, no dependencies. Takes a few seconds (it reads the 67 MB file).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { BASE, POSITIONS, buildSavantApi, writeSavantApi } from '../../scripts/lib/savant-api.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const html = readFileSync(path.join(PUBLIC, 'basketball-savant.html'), 'utf8')
const data = JSON.parse(readFileSync(path.join(PUBLIC, 'savant-data.json'), 'utf8'))
const out = buildSavantApi({ data, html })

// ---- lifting the page's code ---------------------------------------------------------

// Index of the brace that closes the one at `open`, skipping strings and comments.
function closing(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
      if (i < 0) break
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1
      if (i < 1) break
    } else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

function grabFunction(name) {
  const at = html.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
  assert.ok(at >= 0, `the page no longer has function ${name}()`)
  const end = closing(html, html.indexOf('{', html.indexOf(')', at)))
  assert.ok(end > at, `could not read function ${name}() out of the page`)
  return html.slice(at, end + 1)
}

function grabLine(start) {
  const at = html.indexOf(`\n${start}`)
  assert.ok(at >= 0, `the page no longer has a line starting "${start}"`)
  return html.slice(at + 1, html.indexOf('\n', at + 1))
}

function grabCfg() {
  const at = html.search(/const\s+CFG\s*=\s*\{/)
  assert.ok(at >= 0, 'the page no longer has CFG')
  const open = html.indexOf('{', at)
  return html.slice(open, closing(html, open) + 1)
}

// The page's functions, with the handful of globals they read, wrapped so nothing leaks.
// structuredClone: prepData() rewrites positions in place, and the slicer must be compared
// against a page that started from the same untouched file.
const page = vm.runInNewContext(`(function (DATA, CFG) {
  let cur = null, pop = 'league', curSeason = null, mpgOn = false, band = { min: 20, max: 40 };
  ${grabLine('const POS_FIX_ID')}
  ${grabLine('const POS_FIX_NAME')}
  ${grabFunction('_norm')}
  ${grabFunction('prepData')}
  ${grabLine('const val=')}
  ${grabLine('const smpl=')}
  ${grabFunction('miss')}
  ${grabFunction('poolVals')}
  ${grabFunction('pctRaw')}
  ${grabFunction('pctOf')}
  ${grabFunction('seasonTier')}
  prepData();
  return {
    data: DATA, cfg: CFG, val: val, smpl: smpl, miss: miss, pctOf: pctOf, seasonTier: seasonTier,
    pool: function (key, w, pos, season, mode) { pop = mode; return poolVals(key, w, { pos: pos }, season); },
  };
})`)(structuredClone(data), JSON.parse(grabCfg()))

// ---- the checks ----------------------------------------------------------------------

test('the page still decides low sample and untracked stats the way the slicer assumes', () => {
  // These two rules live inline in the page's barRow(), not in a function that can be
  // lifted, so they are pinned by their text. If either line changes, re-read barRow().
  assert.ok(
    html.includes('const stable=(n==null)||(m.thr?n>=m.thr:true);'),
    'the low-sample rule in barRow() changed',
  )
  assert.ok(
    html.includes("if((m.tier && seasonTier(curSeason) < m.tier) || miss(v)) return '';"),
    'the rule that hides a stat in barRow() changed',
  )
})

test('every percentile matches the page, for every player, season, stat and pool', () => {
  let compared = 0
  let ranked = 0
  for (const season of page.data.seasons) {
    const file = out.seasons[season]
    assert.ok(file, `no season file for ${season}`)
    const rows = new Map(file.players.map((r) => [r.id, r]))
    const players = page.data.data[season].players
    assert.equal(file.players.length, players.length, `${season}: player count`)

    for (const w of file.windows) {
      for (const m of page.cfg.metrics) {
        const hiddenByEra = !!(m.tier && page.seasonTier(season) < m.tier)
        const pools = { league: page.pool(m.key, w, null, season, 'league') }
        for (const pos of POSITIONS) pools[pos] = page.pool(m.key, w, pos, season, 'position')

        for (const p of players) {
          const row = rows.get(p.id)
          assert.ok(row, `${season}: ${p.name} is missing`)
          const got = w === 'season' ? row : (row.w && row.w[w]) || { m: {} }
          const v = page.val(p, m.key, w)
          const where = `${season} ${w} ${p.name} ${m.key}`
          compared++

          if (hiddenByEra || page.miss(v)) {
            assert.equal(got.m[m.key], undefined, `${where}: the page shows nothing, the file has a value`)
            continue
          }
          const cellGot = got.m[m.key]
          assert.ok(cellGot, `${where}: the page shows a value, the file has none`)
          assert.equal(row.pos, p.pos, `${where}: position`)
          assert.equal(cellGot[0], v, `${where}: value`)
          assert.equal(cellGot[1], page.pctOf(v, pools.league, m.lower), `${where}: league percentile`)
          assert.equal(cellGot[2], page.pctOf(v, pools[p.pos], m.lower), `${where}: ${p.pos} percentile`)

          const n = page.smpl(p, m.key, w)
          const stable = (n == null) || (m.thr ? n >= m.thr : true)
          assert.equal((got.low || []).includes(m.key), !stable, `${where}: low-sample flag`)
          ranked++
        }
      }
    }
  }
  console.log(`      ${compared.toLocaleString('en-US')} cells checked, ${ranked.toLocaleString('en-US')} with a value and two percentiles`)
  assert.ok(ranked > 500000, 'suspiciously few cells had values')
})

test('rolling windows exist for the latest season only, and only for it', () => {
  const latest = data.seasons[0]
  for (const season of data.seasons) {
    const file = out.seasons[season]
    const withWindows = file.players.filter((r) => r.w).length
    if (season === latest) {
      assert.deepEqual(file.windows, page.cfg.windows)
      assert.ok(withWindows > 0, 'the latest season has no rolling windows')
    } else {
      assert.deepEqual(file.windows, ['season'])
      assert.equal(withWindows, 0, `${season} carries rolling windows`)
    }
  }
})

test('pool sizes, the player index and the glossary are consistent with the data', () => {
  const ids = new Set()
  for (const season of data.seasons) {
    const players = page.data.data[season].players
    const q = players.filter((p) => p.qualified)
    const counts = { league: q.length }
    for (const pos of POSITIONS) counts[pos] = q.filter((p) => p.pos === pos).length
    assert.deepEqual(out.seasons[season].qualified, counts, `${season}: pool sizes`)
    assert.deepEqual(out.meta.qualified[season], counts, `${season}: pool sizes in meta`)
    for (const p of players) ids.add(p.id)
    // Games and minutes are read the way the page reads them.
    for (const p of players.slice(0, 25)) {
      const row = out.seasons[season].players.find((r) => r.id === p.id)
      assert.equal(row.gp, page.smpl(p, 'avail', 'season') ?? null)
      assert.equal(row.min, page.smpl(p, 'minshare', 'season') ?? null)
    }
  }
  assert.equal(out.players.count, ids.size)
  assert.equal(out.players.players.length, ids.size)
  for (const r of out.players.players) {
    assert.ok(ids.has(r.id))
    const mine = data.seasons.filter((s) => page.data.data[s].players.some((p) => p.id === r.id))
    assert.equal(r.to, mine[0], `${r.name}: last season`)
    assert.equal(r.from, mine[mine.length - 1], `${r.name}: first season`)
    assert.equal(r.seasons, mine.length, `${r.name}: season count`)
  }
  assert.deepEqual(out.meta.metrics.map((m) => m.key), page.cfg.metrics.map((m) => m.key))
  for (const m of out.meta.metrics) {
    const src = page.cfg.metrics.find((x) => x.key === m.key)
    assert.equal(m.lowerIsBetter, !!src.lower)
    assert.ok(out.meta.units[m.unit], `unit "${m.unit}" has no description`)
    assert.ok(out.meta.groups[m.group], `group "${m.group}" has no label`)
  }
  assert.deepEqual(out.meta.seasons, data.seasons)
})

test('what is written to disk is what was built, and stays small', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-api-'))
  try {
    const r = writeSavantApi({ publicDir: PUBLIC, dist })
    const root = path.join(dist, BASE)
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'meta.json'), 'utf8')), JSON.parse(JSON.stringify(out.meta)))
    assert.equal(JSON.parse(readFileSync(path.join(root, 'players.json'), 'utf8')).count, out.players.count)
    const files = readdirSync(path.join(root, 'seasons')).sort()
    assert.deepEqual(files, data.seasons.map((s) => `${s}.json.gz`).sort())
    const latest = data.seasons[0]
    const back = JSON.parse(gunzipSync(readFileSync(path.join(root, 'seasons', `${latest}.json.gz`))).toString('utf8'))
    assert.deepEqual(back, JSON.parse(JSON.stringify(out.seasons[latest])))
    // Deployment Storage: Vercel keeps ~40 deployments, so every MB here costs 40.
    assert.ok(r.bytes < 10 * 1048576, `the API files grew to ${(r.bytes / 1048576).toFixed(1)} MB`)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
