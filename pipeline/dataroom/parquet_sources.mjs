// pipeline/dataroom/parquet_sources.mjs — where parquet.mjs reads each table's rows: the same rows
// savant_data serves, read through the connector's own code (api/_dataroom.js readTable) so the
// Parquet copy and the JSON cannot drift apart.
//
// A small file server inside this process stands in for the site and for the release: public/ is
// served the way Vercel serves it (x.json from x.json.gz) and the release-asset tables from
// DATAROOM_HOSTED (default out/dataroom, where the Data Room's builds and publish.sh keep them).
// SAVANT_API_ORIGIN / DATAROOM_ASSETS point the connector at it, as tools/dataroom/check.mjs does.
//
// College basketball's player_games, units and possessions are kept per team-season on the site,
// so their Parquet season is every team's rows together, with `team_id` and `team` in front.

import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const PUB = path.join(ROOT, 'public')
const HOSTED = path.resolve(ROOT, process.env.DATAROOM_HOSTED || 'out/dataroom')

let started = null
function start() {
  if (started) return started
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body) }
    const m = url.match(/^\/assets\/([a-z]+)-([a-z_]+)-([0-9-]+)\.json\.gz$/)
    if (m) {
      const f = path.join(HOSTED, m[1], m[2], `${m[3]}.json.gz`)
      return existsSync(f) ? send(200, readFileSync(f), 'application/octet-stream') : send(404, 'Not Found', 'text/plain')
    }
    const p = path.join(PUB, url)
    if (!p.startsWith(PUB)) return send(404, '')
    if (existsSync(p + '.gz')) return send(200, gunzipSync(readFileSync(p + '.gz')))
    if (existsSync(p) && p.endsWith('.json')) return send(200, readFileSync(p))
    send(404, 'Not Found', 'text/plain')
  })
  started = new Promise((resolve) => server.listen(0, '127.0.0.1', async () => {
    server.unref()
    const port = server.address().port
    process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${port}`
    process.env.DATAROOM_ASSETS = `http://127.0.0.1:${port}/assets`
    const D = await import('../../api/_dataroom.js')
    const CB = await import('../../api/_cbb.js')
    resolve({ D, CB })
  }))
  return started
}

const catalog = () => JSON.parse(gunzipSync(readFileSync(path.join(PUB, 'dataroom/catalog.json.gz'))).toString('utf8'))
const PER_TEAM = new Set(['player_games', 'units', 'possessions'])

export const SOURCES = Object.fromEntries(Object.entries(catalog().sports).flatMap(([s, tt]) => Object.keys(tt).map((t) => [`${s}.${t}`, true])))

export function sourceFor(sport, table) {
  const entry = (catalog().sports[sport] || {})[table]
  if (!entry) throw new Error(`No Data Room table ${sport}.${table}. Tables: ${Object.keys(SOURCES).join(', ')}`)
  const seasons = async () => Object.keys(entry.seasons || {}).sort()
  if (sport === 'cbb' && PER_TEAM.has(table)) {
    return {
      seasons,
      async read(season) {
        const { D, CB } = await start()
        const teams = await CB.teamList()
        let columns = null
        const rows = []
        let through = null
        for (const [id, name] of teams) {
          let t
          try { t = await D.readTable(sport, table, season, id) } catch { continue }   // no file for that team-season
          if (!columns) columns = ['team_id', 'team', ...t.columns]
          for (const r of t.rows) rows.push([id, name, ...r])
          if (t.through && (!through || t.through > through)) through = t.through
        }
        if (!columns) throw new Error(`cbb ${table} ${season}: no team files`)
        return { columns, rows, through }
      },
    }
  }
  return {
    seasons,
    async read(season) {
      const { D } = await start()
      const t = await D.readTable(sport, table, season)
      return { columns: t.columns, rows: t.rows, through: t.through || null }
    },
  }
}
