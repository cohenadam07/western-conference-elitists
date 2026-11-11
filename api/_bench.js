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
        const r = await S.runSql(QUERIES[k])
        out.results[k] = { ms: Date.now() - t, engine_setup_ms: r.setup_ms, rows: r.total, first: r.rows.slice(0, 3), bytes_read: r.bytes_read, planned_bytes: Math.round(r.planned_bytes), peak_memory: r.peak_memory, scanned: r.scanned }
      } catch (e) { out.results[k] = { ms: Date.now() - t, error: e.message } }
    }
    out.engines = S.stats.engines
    out.rss_mb = Math.round(process.memoryUsage().rss / 1e6)
  } catch (e) { out.error = String(e && e.stack || e).slice(0, 1500) }
  res.end(JSON.stringify(out))
}
