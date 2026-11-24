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
import { MORE, savantApiDir } from './analysis_tables.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const PUB = path.join(ROOT, 'public')
const HOSTED = path.resolve(ROOT, process.env.DATAROOM_HOSTED || 'out/dataroom')

let started = null
function start() {
  if (started) return started
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body) }
    if (url.startsWith('/savant-api/basketball/')) {
      // the per-season files the site build makes (scripts/lib/savant-api.mjs), built here from public/
      let f
      try { f = path.join(await savantApiDir(), url) } catch (e) { return send(500, String(e && e.message), 'text/plain') }
      if (existsSync(f)) return send(200, readFileSync(f))
      if (existsSync(f + '.gz')) return send(200, gunzipSync(readFileSync(f + '.gz')))
      return send(404, 'Not Found', 'text/plain')
    }
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

// Tables only the analysis engine reads (not in the Data Room catalog, so savant_data and
// savant_dictionary are unchanged): what a study needs that the Data Room's rows do not carry.
//   nba.player_seasons   Basketball Savant's own player-seasons: position (Guard / Wing / Big, as the page
//                        assigns it), the page's qualified flag, team, age, experience and the per-game line.
//                        It is what lets a stability study take its prior within position, as
//                        settle_points.py does, and lets SQL use the page's own qualification. Since Nov
//                        2026 it also carries the two matchup-difficulty stats side by side (mtch and
//                        mtchc with its three parts and its sample), so an AI can compare them; the
//                        columns the bio line does not explain carry a dictionary entry each.
const readJson = (rel) => JSON.parse(readFileSync(path.join(PUB, rel), 'utf8'))
const extSeason = (season) => { try { return readJson(`savant-ext/s/${season}.json`) } catch { return null } }
const MAT = 'NBA.com stats (stats.nba.com) matchup data (LeagueSeasonMatchups: who guarded whom, partial possessions)'
const MTCHC_FORMULA = 'average threat of the players he guarded, weighted by matchup possessions; threat = mean of three parts (Scoring: Points / 75 and points above league-average efficiency; Creation: Assist %, potential assists / 75, assist points created / 75, time of possession / 75; Overall: Offensive BPM and, from 2025-26, on-ball gravity, net of Scoring), each z-scored within the season against 500+ minute players and shrunk toward average by minutes / (minutes + k)'
const DICTIONARY = {
  mtch: { definition: 'Matchup difficulty: the scoring level of the players he guarded, the possession-weighted average of their season points per game.', unit: 'points per game', source: MAT, first_season: '2017-18', caveat: 'Context for his defense, not a measure of it. 2024-25 and 2025-26 are rebuilt from the NBA\'s revised matchup tables (Nov 2026). Hatched on the page under 530 matchup possessions.' },
  mtchc: { definition: `Matchup difficulty (creation-weighted): the ${MTCHC_FORMULA}.`, unit: 'average z-score (0 = a league-average assignment; qualified defenders run about -0.1 to +0.4)', source: `${MAT}; threat inputs are Basketball Savant's own stats`, first_season: '2017-18', caveat: 'Describes how hard his assignments are, not how well he defends them. Bigs who guard scoring bigs rank lower because bigs create less: compare bigs with bigs. Low sample under 560 matchup possessions; settles around 1,600. mtchc = (mtchc_score + mtchc_create + mtchc_overall) / 3.' },
  mtchc_score: { definition: 'The Scoring part of mtchc: the possession-weighted average Scoring part (Points / 75 and points above league-average efficiency) of the players he guarded.', unit: 'average z-score', source: MAT, first_season: '2017-18', caveat: 'Low sample under 600 matchup possessions.' },
  mtchc_create: { definition: 'The Creation part of mtchc: the possession-weighted average Creation part (Assist %, potential assists, assist points created, time of possession) of the players he guarded.', unit: 'average z-score', source: MAT, first_season: '2017-18', caveat: 'Time of possession is left out of 2024-25, when the NBA published it broken. Low sample under 500 matchup possessions.' },
  mtchc_overall: { definition: 'The Overall part of mtchc: the possession-weighted average Overall part (Offensive BPM and on-ball gravity, net of Scoring) of the players he guarded. Here so the total can be rebuilt from its parts; it is not on the page.', unit: 'average z-score', source: `${MAT}; OBPM from Basketball Reference; gravity from NBA.com Inside the Game, 2025-26 on`, first_season: '2017-18', caveat: 'Settles slowly: low sample under 1,200 matchup possessions.' },
  mhunt: { definition: 'Isolation targeting vs expected: Synergy isolation possessions he defended minus the isolations the players he guarded would produce (their own isolation rate across the season, pulled toward players like him, times the possessions he guarded them, scaled each season so the league adds up), per 100 matchup possessions. Positive: isolated more than his assignments explain (hunted); negative: avoided.', unit: 'isolations per 100 matchup possessions, vs expected', source: `NBA.com stats (stats.nba.com) Synergy play types (isolation, offense and defense) and ${MAT}`, first_season: '2017-18', caveat: 'A context stat, not a rating: stable season to season, but in our testing it does not predict better team defense (if anything, more-hunted defenders had slightly better on/off). Not in 2023-24 (the NBA\'s isolation-defense table is missing 35 regular defenders). mhunt_note "floor": under Synergy\'s 10-isolation floor, valued at 9 faced, so the real number is at most this; "not_tracked": left out of Synergy\'s isolation table, no value. Low sample under 1,100 matchup possessions; settles around 3,000.' },
  mhunt_faced: { definition: 'Synergy isolation possessions he defended per 100 matchup possessions (9 for a defender under Synergy\'s 10-isolation floor).', unit: 'isolations per 100 matchup possessions', source: 'NBA.com stats (stats.nba.com) Synergy play types (isolation defense)', first_season: '2017-18', caveat: 'mhunt = mhunt_faced − mhunt_exp. Not in 2023-24. Low sample under 1,400 matchup possessions.' },
  mhunt_exp: { definition: 'The isolations the players he guarded would produce per 100 of his matchup possessions, from how often they isolate everyone.', unit: 'isolations per 100 matchup possessions', source: `NBA.com stats (stats.nba.com) Synergy play types (isolation offense) and ${MAT}`, first_season: '2017-18', caveat: 'Not in 2023-24. Low sample under 500 matchup possessions.' },
  mhunt_note: { definition: 'Why mhunt is a bound or missing for this player-season: "floor" (under Synergy\'s 10-isolation floor, valued at its bound) or "not_tracked" (not in Synergy\'s isolation table). Null otherwise.', unit: 'text', source: 'Basketball Savant (pipeline/basketball/hunt.py)', first_season: '2017-18', caveat: 'Set only where it applies.' },
  matchup_poss: { definition: 'Matchup possessions: the partial possessions he spent guarding someone, the sample behind mtch and mtchc.', unit: 'possessions', source: MAT, first_season: '2017-18', caveat: 'A possession is shared among the defenders who guarded the ball handler or shooter, so the partial possessions add up to five per team possession.' },
}
export const EXTRA = {
  'nba.player_seasons': {
    row: 'player-season (Basketball Savant)',
    note: "Basketball Savant's player-seasons as the page holds them (public/savant-data.json and savant-current.json): pos is the page's position group (Guard, Wing, Big), qualified the page's flag (20+ games at 15+ minutes), and ppg/rpg/apg/mpg its per-game line. mtch, mtchc, its three parts and matchup_poss are the page's matchup-difficulty stats, and mhunt, its two parts and mhunt_note its isolation targeting (a context stat), 2017-18 on (null before, and for a player who guarded no one); the dictionary defines each. Join to nba.player_games on season and player_id.",
    dictionary: DICTIONARY,
    seasons: async () => {
      const d = readJson('savant-data.json'), c = readJson('savant-current.json')
      return [...new Set([...d.seasons.filter((s) => d.data[s]), ...c.seasons.filter((s) => c.data[s])])].sort()
    },
    read: async (season) => {
      const d = readJson('savant-data.json'), c = readJson('savant-current.json')
      const src = (c.data[season] || d.data[season])
      const ext = extSeason(season)
      const at = ext ? Object.fromEntries(['mtchc', 'mtchc_score', 'mtchc_create', 'mtchc_overall', 'mhunt', 'mhunt_faced', 'mhunt_exp'].map((k) => [k, ext.keys.indexOf(k)])) : {}
      const cell = (p, k) => { const r = ext && (ext.players[String(p.id)] || {}).season; const c = r && at[k] >= 0 ? r[at[k]] : null; return c || null }
      const columns = ['player_id', 'player', 'team', 'pos', 'age', 'exp', 'qualified', 'ppg', 'rpg', 'apg', 'mpg', 'mtch', 'mtchc', 'mtchc_score', 'mtchc_create', 'mtchc_overall', 'matchup_poss', 'mhunt', 'mhunt_faced', 'mhunt_exp', 'mhunt_note']
      const rows = (src.players || []).map((p) => [p.id, p.name, p.team ?? null, p.pos ?? null, p.age ?? null, p.exp ?? null, p.qualified === true, p.line?.ppg ?? null, p.line?.rpg ?? null, p.line?.apg ?? null, p.line?.mpg ?? null,
        p.m?.mtch?.season?.v ?? null, cell(p, 'mtchc')?.[0] ?? null, cell(p, 'mtchc_score')?.[0] ?? null, cell(p, 'mtchc_create')?.[0] ?? null, cell(p, 'mtchc_overall')?.[0] ?? null,
        cell(p, 'mtchc')?.[1] ?? p.m?.mtch?.season?.n ?? null,
        cell(p, 'mhunt')?.[0] ?? null, cell(p, 'mhunt_faced')?.[0] ?? null, cell(p, 'mhunt_exp')?.[0] ?? null, cell(p, 'mhunt')?.[2] ?? null])
      return { columns, rows, through: (c.data[season] && c.through) || null }
    },
  },
}

Object.assign(EXTRA, MORE(start))

export const SOURCES = { ...Object.fromEntries(Object.entries(catalog().sports).flatMap(([s, tt]) => Object.keys(tt).map((t) => [`${s}.${t}`, true]))), ...Object.fromEntries(Object.keys(EXTRA).map((k) => [k, true])) }

export function sourceFor(sport, table) {
  if (EXTRA[`${sport}.${table}`]) return EXTRA[`${sport}.${table}`]
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
