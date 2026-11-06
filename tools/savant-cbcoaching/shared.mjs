// College Basketball Coaching Savant against College Basketball Savant: every stat the two pages share.
//
//   node --test tools/savant-cbcoaching/shared.mjs        (npm run check:savant-cbcoaching-shared)
//
// A coach page and a College Savant team page can show the same team-season. Where they show a stat under
// the same name it must be the same number; where the two sites measure different things the Coaching
// page must use a different name and say, in the stat's explainer, how it differs. Oklahoma 2025-26 is
// why this exists (Nov 6 2026): after-timeout offense 1.16 against 1.171 and clutch net -20.8 against
// -18.5, both under one name.
//
// Compared: every team-season one head coach ran from start to finish (an interim's games are not the
// team's), in every completed season both sites publish: every figure must match. The season in progress is
// compared team by team where both sites hold the same games, and fails only on broad disagreement (its test
// says why).
//
// No network, no keys. Reads public/cbcs/ and public/cbb/ as published.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const gz = (p) => (existsSync(p) ? JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) : null)
const CB = (rel) => gz(path.join(ROOT, 'public', 'cbcs', rel + '.gz'))
const CS = (rel) => gz(path.join(ROOT, 'public', 'cbb', rel + '.gz'))

const index = CB('index.json')
const stats = new Map(index.stats.map((s) => [s.key, s]))
const through = index.meta.through

// (season, team) -> the coach rows for it
const rows = new Map()
for (const c of index.coaches) {
  const p = CB(`c/${c.id}.json`)
  if (!p) continue
  for (const s of p.seasons) {
    const k = `${s.season}|${s.team}`
    if (!rows.has(k)) rows.set(k, [])
    rows.get(k).push({ coach: c.id, row: s })
  }
}

const ppp = (x) => (x && x[0] ? x[1] / x[0] : null)
// Coaching key -> College Savant's figure for the team-season, and how close the two must be: College
// Savant's team table rounds to one decimal; its play context publishes counts, so those are exact.
const SAME = [
  ['net', 'Net rating', (t) => t.net, 0.05],
  ['ortg', 'Offense', (t) => t.adjo, 0.05],
  ['drtg', 'Defense', (t) => t.adjd, 0.05],
  ['pace', 'Pace', (t) => t.tempo, 0.05],
  ['tov_pct', 'TOV%', (t) => t.tov, 0.05],
  ['o_tov', 'TOV% allowed', (t) => t.otov, 0.05],
  ['orb_pct', 'Reb% (offense)', (t) => t.orb, 0.05],
  ['drb_pct', 'Reb% (defense)', (t) => t.drb, 0.05],
  ['ftr', 'FT rate', (t) => t.ftr, 0.05],
  ['o_ftr', 'FT rate allowed', (t) => t.oftr, 0.05],
  ['o_efg', 'eFG% allowed', (t) => t.oefg, 0.05],
  ['rim', 'Rim', (t) => t.rim, 0.05],
  ['o_rim', 'Rim allowed', (t) => t.orim, 0.05],
  ['clutch_net', 'Clutch net', (t, c) => (c && c.clutch.own[0] && c.clutch.opp[0] ? 100 * (ppp(c.clutch.own) - ppp(c.clutch.opp)) : null), 0.001],
  ['ppp_stl', 'After a steal (PPP)', (t, c) => (c ? ppp(c.starts.own.steal) : null), 0.0001],
  ['ppp_dreb', 'After a defensive rebound (PPP)', (t, c) => (c ? ppp(c.starts.own.dreb) : null), 0.0001],
]
// Coaching keys that measure something College Savant measures differently: [key, College Savant's name]
const DIFFERENT = [
  ['ato', 'After timeouts'],
  ['mid', 'Mid'],
  ['o_mid', 'Mid'],
  ['fg3r', 'Three'],
  ['o_fg3r', 'Three'],
  ['ppp_made', 'After a made basket'],
  ['trans', 'How often they run'],
  ['o_trans', 'Transition defense'],
  ['early', 'Early shots (estimated)'],
  ['winpct', 'W–L'],
]

const seasons = index.meta.seasons.filter((s) => CS(`teams/${s}.json`))
const live = index.meta.current || seasons[seasons.length - 1]

function compareSeason(season, sameGames = false) {
  const T = new Map(CS(`teams/${season}.json`).teams.map((t) => [t.id, t]))
  const games = CB(`data/games/${season}.json`)
  const gcol = games ? Object.fromEntries(games.cols.map((c, i) => [c, i])) : null
  const out = { n: 0, bad: [], skipped: 0 }
  for (const [k, list] of rows) {
    const [s, team] = k.split('|')
    if (s !== season || !T.has(team) || list.length !== 1) continue
    const { coach, row } = list[0]
    const t = T.get(team)
    // the season in progress: compare a team only where both sites hold the same games (a refresh can land
    // while a night's late games are still being played, so one site has a game the other does not yet)
    if (sameGames) {
      const pos = CS(`pos/${season}/${team}.json`)
      const theirs = new Set((pos?.rows || []).map((r) => r[0]))
      const ours = new Set(games.rows.filter((r) => r[gcol.team] === team).map((r) => r[gcol.gid]))
      if (theirs.size !== ours.size || [...ours].some((g) => !theirs.has(g))) { out.skipped++; continue }
    }
    const ctx = CS(`ctx/${season}/${team}.json`)
    const c = ctx && ctx.pbp ? ctx : null
    for (const [key, name, f, tol] of SAME) {
      const v = row.values[key]?.[0]
      const w = f(t, c)
      if (v == null || w == null) continue
      out.n++
      if (Math.abs(v - w) > tol + 1e-6) out.bad.push(`${season} ${t.name} (${coach}): ${stats.get(key).label} ${v} here, College Savant's ${name} ${w}`)
    }
    // the record: College Savant's team pages count D1-against-D1 games; the coach's, every game
    if (games) {
      const mine = games.rows.filter((r) => r[gcol.team] === team && T.has(r[gcol.opp]))
      const w = mine.filter((r) => r[gcol.pts] > r[gcol.opp_pts]).length
      const l = mine.length - w
      out.n++
      if (w !== t.w || l !== t.l) out.bad.push(`${season} ${t.name} (${coach}): ${w}-${l} against D1 opponents here, ${t.w}-${t.l} on College Savant`)
    }
  }
  return out
}

test('every shared stat says the same number on both pages, for every team one coach ran all season', (t) => {
  let n = 0
  const bad = []
  for (const season of seasons.filter((s) => s !== live)) {
    const r = compareSeason(season)
    n += r.n
    bad.push(...r.bad)
  }
  t.diagnostic(`${n.toLocaleString()} figures compared across ${seasons.length - 1} completed seasons`)
  assert.ok(n > 50000, `only ${n} figures compared: the files did not load`)
  assert.deepEqual(bad.slice(0, 25), [], `${bad.length} shared figures disagree`)
})

// The season in progress runs on the same code, so the completed seasons above are what prove a definition.
// Here the two sites can hold different ESPN pulls of the same night (a refresh lands while late games are
// on; ESPN revises a game's play-by-play afterwards), which no definition can fix. In the cloud both are
// built from one cache in one run, so this should be quiet there; locally it reports and fails only if the
// disagreement is broad enough (over 2%) to be a definition rather than a pull.
test('the season in progress agrees wherever both sites hold the same games', (t) => {
  const lg = CS(`ctx/${live}/league.json`)
  if (!lg || lg.through !== through) return t.skip(`College Savant's data run through ${lg?.through ?? 'nothing'}, the coaching page's through ${through}`)
  const r = compareSeason(live, true)
  t.diagnostic(`${live}: ${r.n.toLocaleString()} figures compared, ${r.skipped} teams skipped (their games not yet the same on both sites), ${r.bad.length} disagree`)
  for (const b of r.bad.slice(0, 10)) t.diagnostic(b)
  assert.ok(r.bad.length <= 0.02 * r.n, `${r.bad.length} of ${r.n} figures disagree in ${live}: that is a definition, not a refresh`)
})

test('a stat College Savant measures differently has a different name and says how it differs', () => {
  for (const [key, theirs] of DIFFERENT) {
    const s = stats.get(key)
    assert.ok(s, `${key} is not in the registry`)
    assert.notEqual(s.label.toLowerCase(), theirs.toLowerCase(), `${key} shares College Savant's name "${theirs}"`)
    assert.match(s.what, /College Basketball Savant/, `${key} ("${s.label}") does not say how it differs from College Savant's ${theirs}`)
  }
  for (const [key] of SAME) assert.ok(stats.has(key), `${key} is not in the registry`)
})

test('the season in progress is the same data on both pages', (t) => {
  const lg = CS(`ctx/${live}/league.json`)
  if (!lg) return t.skip(`College Savant has no play context for ${live}`)
  if (lg.through !== through) t.diagnostic(`${live}: College Savant through ${lg.through}, the coaching page through ${through}; they refresh separately`)
  assert.ok(lg.through >= through, `the coaching page (${through}) runs past College Savant (${lg.through}), which it is built from`)
})
