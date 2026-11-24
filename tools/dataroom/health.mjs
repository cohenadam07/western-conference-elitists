#!/usr/bin/env node
// tools/dataroom/health.mjs — does the basketball Data Room still add up?
//
//   node tools/dataroom/health.mjs                       the two newest seasons, files from the release
//   node tools/dataroom/health.mjs --seasons 2010-11     any seasons
//   node tools/dataroom/health.mjs --dir out/parquet     files already on disk (nothing downloaded)
//   node tools/dataroom/health.mjs --out health.json     the results as JSON too
//
// Freshness (tools/savant-mcp/freshness.mjs) asks "is the newest row new enough". This asks the other
// question: are the rows right. Each check is one a person ran by hand on Nov 24, 2026 through
// savant_sql and found either clean or broken; here they run every day so a break is caught the
// morning after, not when an analysis comes out wrong.
//
//   hard  must hold, or the job fails (GitHub emails it): shots add up to the box score's attempts,
//         no player-game twice, two teams a game, college box points add up to the score
//   soft  a ::warning:: with the number: known gaps we want to watch (blank columns in the season in
//         progress, games without stints, stint points short of the final score, college lineups)
//
// The files are the Parquet copies savant_sql reads (the "dataroom" release); the seasons come from
// public/dataroom/parquet.json.gz in the checkout. DuckDB only reads local files here.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DuckDBInstance } from '@duckdb/node-api'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const REPO = process.env.GITHUB_REPOSITORY || 'cohenadam07/western-conference-elitists'
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1] }
const dirGiven = flag('--dir')
const dir = dirGiven ? path.resolve(dirGiven) : mkdtempSync(path.join(os.tmpdir(), 'dataroom-health-'))
const manifest = JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'public/dataroom/parquet.json.gz'))).toString('utf8'))

const TABLES = { nba: ['player_games', 'shots', 'coaching_stints', 'coaching_games'], cbb: ['games', 'player_games'] }
const seasonsOf = (key) => Object.keys((manifest.tables[key] || {}).seasons || {}).sort()
const want = flag('--seasons') ? flag('--seasons').split(',') : null
const pick = (sport) => want || seasonsOf(`${sport}.player_games`).slice(-2)

function file(sport, table, season) {
  const name = `${sport}-${table}-${season}.parquet`
  const f = path.join(dir, name)
  if (existsSync(f)) return f
  if (dirGiven || !seasonsOf(`${sport}.${table}`).includes(season)) return null
  try { execFileSync('curl', ['-sSfL', '--retry', '3', '-m', '180', '-o', f, `https://github.com/${REPO}/releases/download/dataroom/${name}`], { stdio: 'pipe' }); return f } catch { return null }
}

const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '2GB' })
const con = await db.connect()
const one = async (sql) => { const r = (await con.runAndReadAll(sql)).getRows()[0] || []; return r.map((v) => (typeof v === 'bigint' ? Number(v) : v)) }
const results = []
const add = (sport, season, name, kind, ok, value, limit, note = null) => results.push({ sport, season, name, kind, ok: !!ok, value, limit, ...(note ? { note } : {}) })
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null)
const q = (f) => `'${f.replace(/'/g, "''")}'`

for (const season of pick('nba')) {
  const [pg, sh, st, cg] = TABLES.nba.map((t) => file('nba', t, season))
  const live = season === seasonsOf('nba.player_games').slice(-1)[0]
  if (!pg) { add('nba', season, 'player_games file', 'hard', false, 'missing', 'present'); continue }
  const [rows, dups, fga, nullPfd, nullBlka, games, lopsided] = await one(`SELECT count(*), count(*) - count(DISTINCT game_id || '|' || player_id), sum(fga), sum((pfd IS NULL)::INT), sum((blka IS NULL)::INT), count(DISTINCT game_id), (SELECT count(*) FROM (SELECT game_id FROM ${q(pg)} GROUP BY 1 HAVING count(DISTINCT team) <> 2)) FROM ${q(pg)}`)
  add('nba', season, 'no player-game twice', 'hard', dups === 0, dups, 0)
  add('nba', season, 'two teams in every game', 'hard', lopsided === 0, lopsided, 0)
  add('nba', season, 'fouls drawn filled', 'soft', nullPfd === 0, `${pct(rows - nullPfd, rows)}%`, '100%', live ? 'the season in progress is built from ESPN, whose box score has no fouls drawn' : null)
  add('nba', season, 'shots blocked-against filled', 'soft', nullBlka === 0, `${pct(rows - nullBlka, rows)}%`, '100%', live ? 'ESPN\'s box score has no blocked attempts' : null)
  if (sh) {
    const [shots, nullXy, nullAst, made] = await one(`SELECT count(*), sum((x IS NULL OR y IS NULL)::INT), sum((assisted IS NULL AND made = 1)::INT), sum(made) FROM ${q(sh)}`)
    const off = Math.abs(shots - fga)
    add('nba', season, 'shots add up to box-score attempts', 'hard', live ? off <= Math.max(25, 0.001 * fga) : off === 0, `${shots} shots, ${fga} attempts`, live ? 'within 0.1%' : 'equal')
    add('nba', season, 'shot locations filled', 'soft', nullXy <= 0.001 * shots, `${pct(shots - nullXy, shots)}%`, '99.9%')
    add('nba', season, 'assisted flag on made shots', 'soft', nullAst === 0, `${pct(made - nullAst, made)}%`, '100%', 'not built yet: the shot chart carries no assist')
  } else add('nba', season, 'shots file', 'hard', false, 'missing', 'present')
  if (st && cg) {
    const [rs, withStints] = await one(`SELECT count(DISTINCT g.gid), count(DISTINCT s.gid) FROM (SELECT DISTINCT gid FROM ${q(cg)} WHERE type = 'RS' AND gid IS NOT NULL AND pts > 0) g LEFT JOIN (SELECT DISTINCT gid FROM ${q(st)}) s USING (gid)`)
    add('nba', season, 'regular-season games with stints', 'soft', withStints >= 0.97 * rs, `${withStints} of ${rs}`, '97%')
    const [teamGames, exact, worst] = await one(`WITH s AS (SELECT gid, home AS team, sum(pts_home) pts FROM ${q(st)} GROUP BY 1, 2 UNION ALL SELECT gid, away, sum(pts_away) FROM ${q(st)} GROUP BY 1, 2) SELECT count(*), sum((s.pts = g.pts)::INT), max(abs(g.pts - s.pts)) FROM s JOIN ${q(cg)} g ON g.gid = s.gid AND g.team = s.team`)
    add('nba', season, 'stint points equal the final score', 'soft', exact >= 0.8 * teamGames, `${pct(exact, teamGames)}% of ${teamGames} team-games (worst miss ${worst})`, '80%', 'the rest are short, usually by one point')
  }
}

for (const season of pick('cbb')) {
  const [g, pg] = TABLES.cbb.map((t) => file('cbb', t, season))
  if (!g || !pg) { add('cbb', season, 'games and player_games files', 'hard', false, 'missing', 'present'); continue }
  const full = +season.slice(0, 4) >= 2025     // ESPN logs substitutions from Feb 2025
  const [games, box, pbp, lineup, d1] = await one(`SELECT count(*), sum(box_ok), sum(pbp_ok), sum(lineup_ok), sum((non_d1 = 0)::INT) FROM ${q(g)}`)
  add('cbb', season, 'box scores passing', 'soft', box >= 0.98 * games, `${pct(box, games)}%`, '98%')
  if (full) add('cbb', season, 'play-by-play passing', 'soft', pbp >= 0.95 * games, `${pct(pbp, games)}%`, '95%')
  if (full) add('cbb', season, 'lineups passing', 'soft', lineup >= 0.85 * games, `${pct(lineup, games)}%`, '85%')
  const [dups] = await one(`SELECT count(*) - count(DISTINCT gid || '|' || team_id || '|' || player_id) FROM ${q(pg)}`)
  add('cbb', season, 'no player-game twice', 'hard', dups === 0, dups, 0)
  const [teamGames, adds] = await one(`SELECT count(*), sum((pts = team_pts)::INT) FROM (SELECT gid, team_id, sum(pts) pts, max(team_pts) team_pts FROM ${q(pg)} GROUP BY 1, 2)`)
  add('cbb', season, 'box points add up to the score', 'hard', adds >= 0.99 * teamGames, `${pct(adds, teamGames)}% of ${teamGames} team-games`, '99%')
  const [both] = await one(`SELECT count(*) FROM ${q(g)} g WHERE non_d1 = 0 AND box_ok = 1 AND (SELECT count(DISTINCT team_id) FROM ${q(pg)} p WHERE p.gid = g.gid) = 2`)
  const [need] = await one(`SELECT count(*) FROM ${q(g)} WHERE non_d1 = 0 AND box_ok = 1`)
  add('cbb', season, 'both teams\' box score in D1 games', 'hard', both >= 0.99 * need, `${both} of ${need}`, '99%')
  void d1
}

const hard = results.filter((r) => r.kind === 'hard' && !r.ok), soft = results.filter((r) => r.kind === 'soft' && !r.ok)
for (const r of results) console.log(`${r.ok ? 'ok  ' : r.kind === 'hard' ? 'FAIL' : 'warn'}  ${r.sport} ${r.season}  ${r.name}: ${r.value} (wants ${r.limit})${r.note ? ` — ${r.note}` : ''}`)
for (const r of soft) console.log(`::warning::Data Room health: ${r.sport} ${r.season} ${r.name}: ${r.value} (wants ${r.limit})`)
for (const r of hard) console.log(`::error::Data Room health: ${r.sport} ${r.season} ${r.name}: ${r.value} (wants ${r.limit})`)
console.log(`${results.length} checks: ${results.length - hard.length - soft.length} ok, ${soft.length} to watch, ${hard.length} failed`)
if (flag('--out')) writeFileSync(flag('--out'), JSON.stringify({ generated: new Date().toISOString(), results }, null, 1))
process.exit(hard.length ? 1 : 0)
