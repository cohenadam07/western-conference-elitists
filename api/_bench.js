// api/_bench.js — the §1 spike and the final speed check for the analysis engine
// (research/analysis/BUILD.md §1, §5 "Speed"). It runs a FIXED list of benchmark queries through
// api/_sql.js and reports timings, bytes read, memory and the deployment's size: nothing a caller
// sends reaches the engine. api/mcp.js hands it GET /api/mcp?bench=... on preview deployments only;
// production never reaches it (a GET there is the 405 it always was).

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const BOOT = Date.now()
let served = 0

const QUERIES = {
  narrow: "SELECT count(*) AS fga, avg(made) AS fg_pct, avg(CASE WHEN zone LIKE '%Corner 3' THEN 1 ELSE 0 END) AS corner3_share FROM nba.shots WHERE season = '2024-25' AND player = 'Stephen Curry'",
  season_league: "SELECT team, count(*) AS fga, avg(made) AS fg_pct FROM nba.shots WHERE season = '2024-25' GROUP BY team ORDER BY fg_pct DESC",
  all_one_stat: "SELECT season, avg(CASE WHEN zone LIKE '%Corner 3' THEN 1.0 ELSE 0 END) AS corner3_share FROM nba.shots GROUP BY season ORDER BY season",
  all_league: "SELECT season, team, count(*) AS fga, avg(made) AS fg_pct, avg(distance) AS dist FROM nba.shots GROUP BY season, team ORDER BY season, team",
  b2b: "WITH g AS (SELECT DISTINCT season, team, game_id, date FROM nba.player_games), t AS (SELECT season, team, game_id, date, date - lag(date) OVER (PARTITION BY season, team ORDER BY date) AS rest FROM g), s AS (SELECT p.season, p.team, p.game_id, sum(p.fgm) AS fgm, sum(p.fga) AS fga FROM nba.player_games p GROUP BY 1, 2, 3) SELECT CASE WHEN t.rest = 1 THEN 'second night' ELSE 'rested' END AS night, count(*) AS games, sum(s.fgm) / sum(s.fga) AS fg_pct FROM s JOIN t USING (season, team, game_id) WHERE t.season >= '2010-11' GROUP BY 1",
  heavy_memory: 'SELECT player_id, game_id, count(*) AS n FROM nba.shots GROUP BY ALL ORDER BY n DESC LIMIT 5',
  nfl_narrow: "SELECT passer, count(*) AS dropbacks, avg(qb_epa) AS epa_db FROM nfl.plays WHERE season = '2024' AND season_type = 'REG' AND qb_dropback = 1 AND passer = 'J.Allen' GROUP BY passer",
  nfl_season_league: "SELECT posteam, avg(epa) AS epa_play, avg(success) AS sr FROM nfl.plays WHERE season = '2024' AND season_type = 'REG' AND play_type IN ('pass', 'run') GROUP BY posteam ORDER BY epa_play DESC",
  nfl_all: "SELECT season, avg(qb_epa) FILTER (WHERE qb_dropback = 1) AS epa_db, avg(epa) FILTER (WHERE play_type = 'run') AS epa_run FROM nfl.plays WHERE season_type = 'REG' GROUP BY season ORDER BY season",
  cfb_all: "SELECT season, avg(epa) AS epa_play, avg(CASE WHEN pass = 1 THEN 1.0 ELSE 0 END) AS pass_rate FROM cfb.plays WHERE scrimmage = 1 GROUP BY season ORDER BY season",
  ufc_all: "SELECT division, count(*) AS fights, avg(ss * 60.0 / fight_seconds) AS slpm FROM ufc.fights WHERE stats = 1 AND fight_seconds >= 60 GROUP BY division ORDER BY fights DESC",
  cbb_season_league: "SELECT team_id, sum(pts) * 1.0 / count(DISTINCT gid) AS ppg FROM cbb.player_games WHERE season = '2024-25' GROUP BY team_id ORDER BY ppg DESC LIMIT 10",
  study_compare: { study: 'compare', sql: "WITH g AS (SELECT DISTINCT season, team, game_id, date FROM nba.player_games WHERE season >= '2010-11'), t AS (SELECT *, date - lag(date) OVER (PARTITION BY season, team ORDER BY date) AS rest FROM g), s AS (SELECT season, team, game_id, sum(fgm) * 1.0 / sum(fga) AS fg FROM nba.player_games WHERE season >= '2010-11' GROUP BY 1, 2, 3) SELECT s.game_id, s.fg, CASE WHEN t.rest = 1 THEN 'b2b' ELSE 'rested' END AS night FROM s JOIN t USING (season, team, game_id)", outcome: 'fg', group: 'night', cluster: 'game_id', reference: 'rested' },
  study_regress: { study: 'regress', sql: "SELECT game_id, epa, shotgun, no_huddle, ydstogo FROM nfl.plays WHERE season BETWEEN '2016' AND '2025' AND season_type = 'REG' AND play_type IN ('pass', 'run') AND epa IS NOT NULL", outcome: 'epa', predictors: ['shotgun', 'no_huddle', 'ydstogo'], cluster: 'game_id' },
  study_logit: { study: 'regress', model: 'logistic', sql: "SELECT game_id, made, distance FROM nba.shots WHERE season BETWEEN '2020-21' AND '2025-26' AND distance IS NOT NULL", outcome: 'made', predictors: ['distance'], cluster: 'game_id' },
  study_trend: { study: 'trend', sql: "SELECT season, game_id, CASE WHEN zone LIKE '%Corner 3' THEN 1 ELSE 0 END AS c3 FROM nba.shots WHERE season >= '2000-01'", outcome: 'c3', period: 'season', cluster: 'game_id' },
  study_stability: { study: 'stability', sql: "SELECT g.season, g.player_id, g.team, g.date, g.fg3m, g.fg3a, s.pos FROM nba.player_games g JOIN nba.player_seasons s USING (season, player_id) WHERE s.qualified AND g.season BETWEEN '2010-11' AND '2025-26'", player: 'player_id', season: 'season', date: 'date', numerator: 'fg3m', denominator: 'fg3a', window: 'team_last_25', team: 'team', pool: 'pos', stat: 'tp3' },
}

function du(dir, depth = 0) {
  let n = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 12) n += du(p, depth + 1) } else { try { n += statSync(p).size } catch { /* gone */ } }
    }
  } catch { /* unreadable */ }
  return n
}

export async function bench(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (process.env.VERCEL_ENV === 'production') { res.statusCode = 404; return res.end('{"error":"not here"}') }
  const cold = served++ === 0
  const sinceBoot = Date.now() - BOOT
  const url = new URL(req.url || '/', 'https://x')
  const which = url.searchParams.get('q')
  const fresh = url.searchParams.get('fresh') === '1'
  const out = { cold, since_boot_ms: sinceBoot, region: process.env.VERCEL_REGION || null, node: process.version }
  try {
    const t0 = Date.now()
    const S = await import('./_sql.js')
    out.import_ms = Date.now() - t0
    if (url.searchParams.get('size') === '1') {
      out.task_bytes = du(process.cwd())
      out.duckdb_bytes = du(path.join(process.cwd(), 'node_modules', '@duckdb'))
      out.cwd = process.cwd()
    }
    if (fresh) S.resetEngine()
    const runs = which ? [which] : []
    out.results = {}
    for (const k of runs) {
      if (!QUERIES[k]) { out.results[k] = { error: 'unknown' }; continue }
      const t = Date.now()
      try {
        if (typeof QUERIES[k] === 'object') {
          const A = await import('./_analyze.js')
          const r = await A.analyze(QUERIES[k])
          out.results[k] = { ms: Date.now() - t, observations: r.observations, bytes_read: r.bytes_read, interpretation: r.interpretation.slice(0, 200) }
        } else {
          const r = await S.runSql(QUERIES[k])
          out.results[k] = { ms: Date.now() - t, engine_setup_ms: r.setup_ms, rows: r.total, first: r.rows.slice(0, 3), bytes_read: r.bytes_read, planned_bytes: Math.round(r.planned_bytes), peak_memory: r.peak_memory, scanned: r.scanned }
        }
      } catch (e) { out.results[k] = { ms: Date.now() - t, error: e.message } }
    }
    out.engines = S.stats.engines
    out.rss_mb = Math.round(process.memoryUsage().rss / 1e6)
  } catch (e) { out.error = String(e && e.stack || e).slice(0, 1500) }
  res.end(JSON.stringify(out))
}
