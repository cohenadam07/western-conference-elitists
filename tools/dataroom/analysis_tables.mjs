// tools/dataroom/analysis_tables.mjs — the analysis-only tables added Nov 2026
// (pipeline/dataroom/analysis_tables.mjs): nba.games, nba.player_game_onoff, nba.player_stats,
// cbb.player_seasons, cbb.player_stats, cbb.pro_links. Each is read the way parquet.mjs reads it and
// held to the files it is made from, so a table can't drift from what the pages and the connector show.
//
//   node --test tools/dataroom/analysis_tables.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DuckDBInstance } from '@duckdb/node-api'
import { EXTRA } from '../../pipeline/dataroom/parquet_sources.mjs'
import { savantApiDir } from '../../pipeline/dataroom/analysis_tables.mjs'
import { inferKinds, writeSeason } from '../../pipeline/dataroom/parquet.mjs'
import { missingSeasons } from '../../api/_dataroom.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const gz = (rel) => JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public', rel))).toString('utf8'))
const objs = (t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])))
const uniq = (rows, key) => new Set(rows.map(key)).size === rows.length
// the newest finished season the stints cover
const stintSeasons = await EXTRA['nba.player_game_onoff'].seasons()
const DONE = stintSeasons[stintSeasons.length - 2]
const LIVE = stintSeasons[stintSeasons.length - 1]

test('every new table is analysis-only, with a row, a note and definitions', () => {
  for (const k of ['nba.games', 'nba.player_game_onoff', 'nba.player_stats', 'cbb.player_seasons', 'cbb.player_stats', 'cbb.pro_links']) {
    const e = EXTRA[k]
    assert.ok(e && e.row && e.note && e.dictionary && typeof e.read === 'function', k)
    for (const [c, d] of Object.entries(e.dictionary)) assert.ok(d.definition && d.unit && d.source && d.first_season, `${k}.${c}`)
  }
})

test('nba.games: one row a game, both ids, the type, and the id the box-score tables use', async () => {
  const rows = objs(await EXTRA['nba.games'].read(DONE))
  assert.ok(uniq(rows, (r) => r.gid || r.nba_gid))
  const rs = rows.filter((r) => r.type === 'RS')
  assert.ok(rs.length >= 990 && rs.length <= 1230, `${rs.length} regular-season games`)
  assert.ok(rs.every((r) => r.game_id && r.game_id === r.nba_gid), 'a finished season joins on the NBA id')
  assert.ok(rows.filter((r) => r.type !== 'RS').every((r) => r.game_id === null), 'no box-score id for playoffs and the play-in')
  assert.ok(rows.some((r) => r.type === 'PO'))
  assert.ok(rows.every((r) => r.home && r.away && r.home !== r.away && r.home_pts > 0 && r.away_pts > 0))
  const live = objs(await EXTRA['nba.games'].read(LIVE))
  assert.ok(live.filter((r) => r.type === 'RS').every((r) => r.game_id === r.gid), 'the season in progress joins on ESPN\'s id')
  // a game on the schedule that was never played is not a game (2012-13 Celtics-Pacers)
  assert.equal(objs(await EXTRA['nba.games'].read('2012-13')).filter((r) => r.type === 'RS').length, 1229)
})

test('nba.player_game_onoff: the stints, summed; five on the floor; never more points than the final score', async () => {
  const rows = objs(await EXTRA['nba.player_game_onoff'].read(DONE))
  const games = new Map(objs(await EXTRA['nba.games'].read(DONE)).map((g) => [g.gid, g]))
  const st = gz(`bcs/data/stints/${DONE}.json.gz`)
  const ix = Object.fromEntries(st.columns.map((c, i) => [c, i]))
  assert.equal(new Set(rows.map((r) => r.gid)).size, new Set(st.rows.map((r) => r[ix.gid])).size, 'every stint game')
  const tg = new Map()
  for (const r of rows) { const k = `${r.gid}|${r.team}`; const t = tg.get(k) || { sec: 0, game: r.game_sec, pts: r.team_pts, team: r.team, gid: r.gid }; t.sec += r.sec_on; tg.set(k, t) }
  const five = [...tg.values()].filter((t) => Math.abs(t.sec - 5 * t.game) < 1).length
  assert.ok(five >= 0.99 * tg.size, `${five} of ${tg.size} team-games with exactly five on the floor`)
  let known = 0, over = 0
  for (const t of tg.values()) { const g = games.get(t.gid); if (!g) continue; known++; if (t.pts > (t.team === g.home ? g.home_pts : g.away_pts)) over++ }
  assert.ok(known >= 0.99 * tg.size, 'the stint games are in nba.games')
  assert.ok(over <= 0.002 * known, `${over} team-games with more stint points than the final score`)
  // one stint by hand: its points and possessions land on its ten players
  const s0 = st.rows[0], gid = s0[ix.gid], p = s0[ix.home5][0]
  const mine = st.rows.filter((r) => r[ix.gid] === gid && r[ix.home5].includes(p))
  const row = rows.find((r) => r.gid === gid && r.player_id === p)
  assert.equal(row.pts_for_on, mine.reduce((n, r) => n + r[ix.pts_home], 0))
  assert.equal(row.poss_def_on, mine.reduce((n, r) => n + r[ix.poss_away], 0))
  assert.equal(row.stints, mine.length)
  assert.equal(row.plus_minus_on, row.pts_for_on - row.pts_against_on)
})

test('nba.player_stats: every value and both percentiles are the season file\'s', async () => {
  const t = await EXTRA['nba.player_stats'].read(DONE)
  const rows = objs(t)
  assert.ok(uniq(rows, (r) => `${r.player_id}|${r.stat}`), 'one row per player and stat')
  const dist = await savantApiDir()
  const f = path.join(dist, `savant-api/basketball/v1/seasons/${DONE}.json`)
  const file = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : JSON.parse(gunzipSync(readFileSync(`${f}.gz`)))
  const by = new Map(rows.map((r) => [`${r.player_id}|${r.stat}`, r]))
  let n = 0
  for (const p of file.players) {
    for (const [k, v] of Object.entries(p.m || {})) {
      if (v[0] == null) continue
      const r = by.get(`${p.id}|${k}`)
      assert.ok(r, `${p.name} ${k}`)
      assert.deepEqual([r.value, r.pct_league, r.pct_position], [v[0], v[1] ?? null, v[2] ?? null], `${p.name} ${k}`)
      assert.equal(r.low_sample, (p.low || []).includes(k), `${p.name} ${k} low sample`)
      n++
    }
  }
  assert.ok(n > 20000, `${n} cells compared`)
  assert.ok(rows.every((r) => r.pct_league === null || (r.pct_league >= 1 && r.pct_league <= 99)))
  // a pre-1996 player the NBA's index lacks keeps his own id, not a blank
  const old = objs(await EXTRA['nba.player_stats'].read('1995-96'))
  assert.ok(old.every((r) => r.player_id && r.player_id !== 'NaN') && uniq(old, (r) => `${r.player_id}|${r.stat}`))
})

test('cbb.player_seasons and cbb.player_stats: the season file, row for row', async () => {
  const seasons = await EXTRA['cbb.player_seasons'].seasons()
  const s = seasons[seasons.length - 2]
  const d = gz(`cbb/s/${s}.json.gz`)
  const C = Object.fromEntries(d.cols.map((c, i) => [c, i]))
  const ps = objs(await EXTRA['cbb.player_seasons'].read(s))
  assert.equal(ps.length, d.players.length)
  assert.ok(uniq(ps, (r) => r.player_id))
  assert.equal(ps.filter((r) => r.qualified).length, d.players.filter((p) => p[C.qual] === 1).length)
  assert.ok(ps.every((r) => r.team), 'every team has a name')
  const stats = objs(await EXTRA['cbb.player_stats'].read(s))
  assert.ok(uniq(stats, (r) => `${r.player_id}|${r.stat}`))
  const at = new Map(d.players.map((p, i) => [String(p[C.id]), i]))
  for (const r of stats.filter((_, i) => i % 97 === 0)) {
    const v = d.values[r.stat], i = at.get(r.player_id)
    assert.equal(r.raw, v.r[i] ?? null, `${r.player} ${r.stat} raw`)
    assert.equal(r.adjusted, (v.a || [])[i] ?? null, `${r.player} ${r.stat} adjusted`)
  }
  assert.deepEqual(new Set(stats.map((r) => r.stat)), new Set(Object.keys(d.values).filter((k) => d.values[k].r.some((x) => x != null) || (d.values[k].a || []).some((x) => x != null))))
})

test('cbb.pro_links: one college player, one NBA player; the site\'s links all there; the match graded', async () => {
  const rows = objs(await EXTRA['cbb.pro_links'].read('all'))
  assert.ok(uniq(rows, (r) => r.cbb_player_id) && uniq(rows, (r) => r.nba_player_id))
  const site = gz('cbb/links.json.gz').nba
  for (const [c, n] of Object.entries(site)) assert.equal(rows.find((r) => r.cbb_player_id === c)?.nba_player_id, Number(n))
  const m = gz('dataroom/pro_links.json.gz')
  assert.equal(m.test.site_links_agree, m.test.site_links_found, 'every match that has a site link agrees with it')
  assert.ok(m.test.site_links_found >= 0.98 * m.test.site_links_in_reach, 'and nearly all of the site\'s links are found')
  assert.equal(rows.filter((r) => r.method === 'matched').length, Object.keys(m.links).length)
})

test('a season writes to Parquet and reads back the same', async () => {
  const t = await EXTRA['nba.games'].read(DONE)
  const con = await (await DuckDBInstance.create(':memory:')).connect()
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'analysis-tables-')), 'g.parquet')
  const r = await writeSeason(con, { sport: 'nba', table: 'games', season: DONE, columns: t.columns, rows: t.rows, kinds: inferKinds(t.columns, t.rows), out, sort: EXTRA['nba.games'].sort })
  assert.equal(r.rows, t.rows.length)
})

test('a table\'s seasons say what is missing between the first and the last', () => {
  assert.equal(missingSeasons(['2009-10', '2010-11', '2013-14']), ' (not 2011-12, 2012-13)')
  assert.equal(missingSeasons(['2024', '2025', '2026']), '')
  assert.equal(missingSeasons(['all']), '')
})
