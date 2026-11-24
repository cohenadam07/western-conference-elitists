// pipeline/dataroom/analysis_tables.mjs — more tables only the analysis engine reads (savant_sql /
// savant_analyze), added Nov 2026. Like nba.player_seasons they are not in the Data Room catalog, so
// savant_data and savant_dictionary are unchanged; parquet.mjs writes them from the same files the
// site already serves, and every number in them is one a Savant page or the connector already shows.
//
//   nba.games              one row per game: both ids (ESPN's and the NBA's), the game type (regular
//                          season, playoffs, play-in), both teams, score, possessions. It is the join
//                          between the tables that carry the NBA's game id and the ones that carry ESPN's,
//                          and the playoff flag the stint tables lack.
//   nba.player_game_onoff  one row per player-game, 2002-03 on, summed from the stints: counted (not
//                          estimated) possessions on the floor each way, the score while he was on, and
//                          his team's game totals (so off-court is a subtraction).
//   nba.player_stats       one row per player-season-stat: every stat on an NBA Savant card with its
//                          value, both percentiles and its low-sample flag, exactly as savant_query serves
//                          it (the same code path: api/_query.js DATASETS.nba_players).
//   cbb.player_seasons     one row per college player-season: team, position, class, age, size, games,
//                          minutes, possessions, the page's qualified flag, recruiting.
//   cbb.player_stats       one row per college player-season-stat: the raw and the opponent-adjusted
//                          value and its sample, as public/cbb/s/<season> holds them.
//   cbb.pro_links          one row per college player who reached the NBA: his CBB Savant
//                          id and his NBA Savant (NBA) id.
//
// Tall tables on purpose (player_stats): a new stat on a card is a new row, never a new column, so a
// refresh can never fail the stored schema.

import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const PUB = path.join(ROOT, 'public')

const gz = (rel) => JSON.parse(gunzipSync(readFileSync(path.join(PUB, rel))).toString('utf8'))
const json = (rel) => JSON.parse(readFileSync(path.join(PUB, rel), 'utf8'))
const seasonsIn = (dir) => (existsSync(path.join(PUB, dir)) ? readdirSync(path.join(PUB, dir)).filter((f) => /^\d{4}-\d{2}\.json\.gz$/.test(f)).map((f) => f.slice(0, 7)).sort() : [])
const tableOf = (rel) => { const d = gz(rel); const ix = Object.fromEntries(d.columns.map((c, i) => [c, i])); return { rows: d.rows, at: (r, c) => (ix[c] === undefined || r[ix[c]] === undefined ? null : r[ix[c]]) } }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// The season NBA Savant is still playing: its player_games and shots carry ESPN's game id.
const inProgress = () => { try { return new Set(json('savant-current.json').seasons || []) } catch { return new Set() } }

// ---- nba.games ---------------------------------------------------------------------------------
const BCS = 'bcs/data'
const stintsOf = (season) => (existsSync(path.join(PUB, BCS, 'stints', `${season}.json.gz`)) ? tableOf(`${BCS}/stints/${season}.json.gz`) : null)

function readGames(season) {
  const g = tableOf(`${BCS}/games/${season}.json.gz`)
  const st = stintsOf(season)
  const stintHome = new Map()
  if (st) for (const r of st.rows) { const k = st.at(r, 'gid') || st.at(r, 'nba_gid'); if (!stintHome.has(k)) stintHome.set(k, st.at(r, 'home')) }
  const by = new Map()
  for (const r of g.rows) { const k = g.at(r, 'gid') || g.at(r, 'nba_gid'); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
  const live = inProgress().has(season)
  const columns = ['game_id', 'gid', 'nba_gid', 'date', 'type', 'phase', 'home', 'away', 'home_pts', 'away_pts', 'home_poss', 'away_poss', 'ot', 'neutral', 'home_coach', 'away_coach', 'home_spread', 'total', 'attendance', 'has_stints']
  const rows = []
  for (const [k, pair] of by) {
    if (pair.length !== 2) continue                       // a game with one side on file is not a game row
    if (!pair.some((r) => num(g.at(r, 'pts')) > 0)) continue   // on the schedule, never played (2012-13 Celtics-Pacers)
    let h = pair.find((r) => g.at(r, 'home') === true)
    if (!h) { const code = stintHome.get(k); h = pair.find((r) => g.at(r, 'team') === code) || [...pair].sort((a, b) => String(g.at(a, 'team')).localeCompare(String(g.at(b, 'team'))))[0] }
    const a = pair.find((r) => r !== h)
    const type = g.at(h, 'type')
    // game_id: the id nba.player_games and nba.shots use for this game (regular season only there)
    const gameId = type === 'RS' ? (live ? g.at(h, 'gid') : g.at(h, 'nba_gid')) : null
    rows.push([gameId, g.at(h, 'gid'), g.at(h, 'nba_gid'), g.at(h, 'date'), type, g.at(h, 'phase'), g.at(h, 'team'), g.at(a, 'team'),
      num(g.at(h, 'pts')), num(g.at(a, 'pts')), num(g.at(h, 'poss')), num(g.at(a, 'poss')), g.at(h, 'ot') === true || (g.at(h, 'ot') === null ? null : false),
      g.at(h, 'home') !== true, g.at(h, 'coach'), g.at(a, 'coach'), num(g.at(h, 'spread')), num(g.at(h, 'ou')), num(g.at(h, 'attendance')), stintHome.has(k)])
  }
  let through = null
  for (const r of rows) if (r[3] && (!through || r[3] > through)) through = r[3]
  return { columns, rows, through }
}

// ---- nba.player_game_onoff ---------------------------------------------------------------------
const ids = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : [])

function readOnOff(season) {
  const st = stintsOf(season)
  if (!st) throw new Error(`nba player_game_onoff ${season}: no stints file`)
  const g = tableOf(`${BCS}/games/${season}.json.gz`)
  const typeOf = new Map()
  for (const r of g.rows) typeOf.set(g.at(r, 'gid') || g.at(r, 'nba_gid'), g.at(r, 'type'))
  const live = inProgress().has(season)
  const games = new Map()   // key -> { gid, nba_gid, date, home, away, tot: {home, away}, players: Map }
  for (const r of st.rows) {
    const k = st.at(r, 'gid') || st.at(r, 'nba_gid')
    let G = games.get(k)
    if (!G) { G = { gid: st.at(r, 'gid'), nba: st.at(r, 'nba_gid'), date: st.at(r, 'date'), home: st.at(r, 'home'), away: st.at(r, 'away'), sec: 0, h: [0, 0], a: [0, 0], players: new Map() }; games.set(k, G) }
    const sec = num(st.at(r, 'seconds')) || 0
    const ph = num(st.at(r, 'poss_home')) || 0, pa = num(st.at(r, 'poss_away')) || 0
    const sh = num(st.at(r, 'pts_home')) || 0, sa = num(st.at(r, 'pts_away')) || 0
    G.sec += sec; G.h[0] += ph; G.h[1] += sh; G.a[0] += pa; G.a[1] += sa
    for (const [side, five] of [['h', ids(st.at(r, 'home5'))], ['a', ids(st.at(r, 'away5'))]]) {
      for (const p of five) {
        if (p === null || p === undefined) continue      // a slot the play-by-play could not name
        const key = `${side}${p}`
        let P = G.players.get(key)
        if (!P) { P = { id: p, side, sec: 0, po: 0, pd: 0, pf: 0, pa: 0, n: 0 }; G.players.set(key, P) }
        P.sec += sec; P.n += 1
        if (side === 'h') { P.po += ph; P.pd += pa; P.pf += sh; P.pa += sa } else { P.po += pa; P.pd += ph; P.pf += sa; P.pa += sh }
      }
    }
  }
  const columns = ['game_id', 'gid', 'nba_gid', 'date', 'type', 'player_id', 'team', 'opponent', 'home', 'stints', 'sec_on', 'poss_off_on', 'poss_def_on', 'pts_for_on', 'pts_against_on', 'plus_minus_on', 'game_sec', 'team_poss_off', 'team_poss_def', 'team_pts', 'opp_pts']
  const rows = []
  let through = null
  for (const [k, G] of games) {
    const type = typeOf.get(k) || null
    const gameId = type === 'RS' ? (live ? G.gid : G.nba) : null
    if (G.date && (!through || G.date > through)) through = G.date
    for (const P of G.players.values()) {
      const mine = P.side === 'h' ? G.h : G.a, theirs = P.side === 'h' ? G.a : G.h
      rows.push([gameId, G.gid, G.nba, G.date, type, Number(P.id), P.side === 'h' ? G.home : G.away, P.side === 'h' ? G.away : G.home, P.side === 'h',
        P.n, Math.round(P.sec * 10) / 10, P.po, P.pd, P.pf, P.pa, P.pf - P.pa, Math.round(G.sec * 10) / 10, mine[0], theirs[0], mine[1], theirs[1]])
    }
  }
  return { columns, rows, through }
}

// ---- nba.player_stats --------------------------------------------------------------------------
// Read through the query tool's own dataset (api/_query.js), over savant-api files built here from
// public/ the way the site build makes them, so a value or percentile in this table is the one
// savant_query answers with. `serve` (parquet_sources.mjs) points the connector code at them.
let api = null
export function savantApiDir() {
  if (api) return api
  api = (async () => {
    const dist = mkdtempSync(path.join(os.tmpdir(), 'dataroom-savant-api-'))
    const { writeSavantApi } = await import('../../scripts/lib/savant-api.mjs')
    writeSavantApi({ publicDir: PUB, dist })
    return dist
  })()
  return api
}
let nbaSet = null
async function nbaDataset(start) {
  if (!nbaSet) nbaSet = (async () => { await start(); const Q = await import('../../api/_query.js'); const ds = Q.DATASETS.nba_players; const meta = await ds.loadMeta(); return { ds, meta, metrics: ds.metrics(meta) } })()
  return nbaSet
}
async function readNbaStats(season, start) {
  const { ds, meta, metrics } = await nbaDataset(start)
  const s = await ds.season(meta, season, metrics)
  const columns = ['player_id', 'player', 'team', 'pos', 'qualified', 'stat', 'label', 'stat_group', 'unit', 'lower_better', 'value', 'pct_league', 'pct_position', 'low_sample']
  const rows = []
  for (const r of s.rows) {
    for (const m of metrics) {
      const c = ds.cell(s, r, m)
      if (!c) continue
      rows.push([String(r.id), r.name, r.team ?? null, r.pos ?? null, r.qualified === true, m.key, m.label, m.group ?? null, m.unit ?? null, m.neutral ? null : !!m.lower, c[0], c[1], c[2], !!c[3]])
    }
  }
  return { columns, rows, through: (s.file && (s.file.through || s.file.data_through)) || null }
}

// ---- college basketball ------------------------------------------------------------------------
const cbbSeasons = () => seasonsIn('cbb/s')
let cbbReg = null
const registry = () => (cbbReg ||= Object.fromEntries(gz('cbb/registry.json.gz').stats.map((s) => [s.key, s])))

async function readCbbSeasons(season, start) {
  const { CB } = await start()
  const team = new Map(await CB.teamList())
  const d = gz(`cbb/s/${season}.json.gz`)
  const C = Object.fromEntries(d.cols.map((c, i) => [c, i]))
  const poss = (d.samples || {}).poss || []
  const columns = ['player_id', 'player', 'team_id', 'team', 'pos', 'class', 'age', 'height_in', 'weight_lb', 'gp', 'gs', 'min', 'poss', 'qualified', 'conf_id', 'stars', 'recruit_rank', 'adj_confidence', 'tier']
  const rows = d.players.map((p, i) => [String(p[C.id]), p[C.name], String(p[C.team]), team.get(String(p[C.team])) ?? null, p[C.pos] ?? null, p[C.cls] ?? null, num(p[C.age]), num(p[C.ht]), num(p[C.wt]),
    num(p[C.gp]), num(p[C.gs]), num(p[C.min]), num(poss[i]), p[C.qual] === 1, p[C.conf] == null ? null : String(p[C.conf]), num(p[C.stars]), num(p[C.recruit_rank]), num((d.adjconf || [])[i]), d.tier ?? null])
  return { columns, rows, through: d.through || null }
}

function readCbbStats(season) {
  const d = gz(`cbb/s/${season}.json.gz`)
  const C = Object.fromEntries(d.cols.map((c, i) => [c, i]))
  const reg = registry()
  const columns = ['player_id', 'player', 'team_id', 'pos', 'qualified', 'stat', 'label', 'stat_group', 'unit', 'lower_better', 'raw', 'adjusted', 'sample', 'sample_of']
  const rows = []
  for (const [key, v] of Object.entries(d.values || {})) {
    const st = reg[key] || {}
    const smp = st.sample && d.samples ? d.samples[st.sample] : null
    for (let i = 0; i < d.players.length; i++) {
      const raw = num((v.r || [])[i]), adj = num((v.a || [])[i])
      if (raw === null && adj === null) continue
      const p = d.players[i]
      rows.push([String(p[C.id]), p[C.name], String(p[C.team]), p[C.pos] ?? null, p[C.qual] === 1, key, st.label ?? key, st.group ?? null, st.unit ?? null, st.kind === 'context' ? null : !!st.lower, raw, adj, smp ? num(smp[i]) : null, smp ? st.sample : null])
    }
  }
  return { columns, rows, through: d.through || null }
}

function readProLinks() {
  const links = gz('cbb/links.json.gz')
  const name = new Map(), last = new Map()
  for (const s of cbbSeasons()) {
    const d = gz(`cbb/s/${s}.json.gz`)
    const C = Object.fromEntries(d.cols.map((c, i) => [c, i]))
    for (const p of d.players) { name.set(String(p[C.id]), p[C.name]); last.set(String(p[C.id]), [s, String(p[C.team])]) }
  }
  const matched = existsSync(path.join(PUB, 'dataroom/pro_links.json.gz')) ? gz('dataroom/pro_links.json.gz').links : {}
  const columns = ['cbb_player_id', 'nba_player_id', 'player', 'last_college_season', 'last_team_id', 'method']
  const rows = []
  const seen = new Set()
  for (const [cbb, nba] of Object.entries(links.nba || {})) { seen.add(cbb); rows.push([cbb, Number(nba), name.get(cbb) ?? null, (last.get(cbb) || [])[0] ?? null, (last.get(cbb) || [])[1] ?? null, 'site']) }
  for (const [cbb, nba] of Object.entries(matched)) if (!seen.has(cbb)) rows.push([cbb, Number(nba), name.get(cbb) ?? null, (last.get(cbb) || [])[0] ?? null, (last.get(cbb) || [])[1] ?? null, 'matched'])
  return { columns, rows, through: null }
}

// ---- definitions -------------------------------------------------------------------------------
const def = (definition, unit, source, first_season, caveat = null) => ({ definition, unit, source, first_season, ...(caveat ? { caveat } : {}) })
const BCSRC = 'NBA Coaching Savant (WCE, from play-by-play: the NBA\'s through the last finished season, ESPN\'s in the season in progress)'
const GAME_ID = 'The id nba.player_games and nba.shots use for this game: the NBA\'s 10-digit id in finished seasons, ESPN\'s event id in the season in progress. Null for playoff and play-in games (those two tables are regular season only).'

export const MORE = (start) => ({
  'nba.games': {
    row: 'game (both ids, game type, teams, score)',
    note: 'One row per NBA game, 1996-97 on, from NBA Coaching Savant\'s team-games. It joins the tables that carry the NBA\'s game id (nba.player_games and nba.shots in finished seasons) to the ones that carry ESPN\'s (the coaching tables\' gid), and carries the game type the stint tables lack: type is RS (regular season), PO (playoffs) or PI (play-in). Join nba.player_games or nba.shots on season and game_id; join the coaching tables on season and gid (2002-03 on) or nba_gid. Play-in games have no nba_gid. gid is null before 2002-03.',
    sort: ['date', 'home'],
    seasons: async () => seasonsIn(`${BCS}/games`),
    read: async (season) => readGames(season),
    dictionary: {
      game_id: def(GAME_ID, 'id', BCSRC, '1996-97'),
      gid: def('ESPN\'s event id, the id every nba.coaching_ table uses.', 'id', BCSRC, '2002-03', 'Null before 2002-03.'),
      nba_gid: def('The NBA\'s 10-digit game id (002 regular season, 004 playoffs).', 'id', BCSRC, '1996-97', 'Null for play-in games.'),
      type: def('RS regular season, PO playoffs, PI play-in.', 'text', BCSRC, '1996-97'),
      phase: def('Part of the season: first10, pre_asb, post_asb, last10, play_in, playoffs.', 'text', BCSRC, '1996-97'),
      home: def('Home team (at a neutral site, the team the play-by-play lists as home).', 'team', BCSRC, '1996-97'),
      away: def('Away team.', 'team', BCSRC, '1996-97'),
      home_poss: def('Home team\'s possessions, counted from the play-by-play.', 'possessions', BCSRC, '2002-03', 'Null before 2002-03.'),
      away_poss: def('Away team\'s possessions, counted from the play-by-play.', 'possessions', BCSRC, '2002-03', 'Null before 2002-03.'),
      neutral: def('Neutral site.', 'flag', BCSRC, '1996-97'),
      home_spread: def('Closing point spread from the home team\'s side (negative = favoured).', 'points', BCSRC, 'where held'),
      total: def('Closing over/under.', 'points', BCSRC, 'where held'),
      has_stints: def('Whether nba.coaching_stints (and so nba.player_game_onoff) holds this game.', 'flag', BCSRC, '2002-03'),
    },
  },
  'nba.player_game_onoff': {
    row: 'player-game, on-court totals from the stints',
    note: 'One row per player per game, 2002-03 on, summed from nba.coaching_stints: counted possessions on the floor each way (not the box-score estimate in nba.player_games), the score while he was on, and his team\'s game totals, so off-court is team minus on. Regular season, play-in and playoffs (type). On-court net per 100 = 100 * (pts_for_on / poss_off_on - pts_against_on / poss_def_on). Join nba.player_games on season, game_id and player_id (regular season). Games without stints (nba.games.has_stints false) are absent, not zero. The stints cover every second of a game but not always every point or possession (see team_pts): totals here run about one possession a game under nba.games.',
    sort: ['date', 'team', 'player_id'],
    seasons: async () => seasonsIn(`${BCS}/stints`),
    read: async (season) => readOnOff(season),
    dictionary: {
      game_id: def(GAME_ID, 'id', BCSRC, '2002-03'),
      type: def('RS regular season, PO playoffs, PI play-in.', 'text', BCSRC, '2002-03'),
      stints: def('Stints he was on the floor for.', 'count', BCSRC, '2002-03'),
      sec_on: def('Seconds on the floor.', 'seconds', BCSRC, '2002-03'),
      poss_off_on: def('His team\'s possessions while he was on the floor.', 'possessions', BCSRC, '2002-03', 'A possession that spans a substitution is credited to both stints, as the NBA credits it to both players, so a team\'s stint possessions add up to slightly more than its game total.'),
      poss_def_on: def('The opponent\'s possessions while he was on the floor.', 'possessions', BCSRC, '2002-03'),
      pts_for_on: def('His team\'s points while he was on the floor.', 'points', BCSRC, '2002-03'),
      pts_against_on: def('The opponent\'s points while he was on the floor.', 'points', BCSRC, '2002-03'),
      plus_minus_on: def('pts_for_on - pts_against_on, from the stints.', 'points', BCSRC, '2002-03', 'Rebuilt from the stints, not the official number: it equals the box score\'s plus_minus (nba.player_games) in about 40% of player-games and is within 2 points in about 93% (2024-25), because the stints credit free throws around a substitution differently and leave out a point or more in about one team-game in seven. Use nba.player_games.plus_minus for the official figure; use this for per-possession on-court rates.'),
      game_sec: def('Seconds of the game the stints cover.', 'seconds', BCSRC, '2002-03'),
      team_poss_off: def('His team\'s possessions in the game, summed over stints.', 'possessions', BCSRC, '2002-03'),
      team_poss_def: def('The opponent\'s possessions in the game, summed over stints.', 'possessions', BCSRC, '2002-03'),
      team_pts: def('His team\'s points in the stints.', 'points', BCSRC, '2002-03', 'Equals the final score in about 86% of team-games (2024-25; 65% in 2010-11); otherwise it is short, usually by one point. nba.games has the final score.'),
      opp_pts: def('The opponent\'s points in the stints.', 'points', BCSRC, '2002-03'),
    },
  },
  'nba.player_stats': {
    row: 'player-season-stat (every NBA Savant card stat)',
    note: 'One row per player, season and stat: every stat on an NBA Savant card (box, tracking, play-finishing, hustle, shot zones, impact and the Oct 2026 additions) with its value, the page\'s league and position percentiles and its low-sample flag, exactly as savant_query returns them. A stat with no row for a player-season was not tracked then or has no value for him: it is not zero. Percentiles are the page\'s (midrank among that season\'s qualified players, flipped for lower-is-better stats, so higher is always better); never average percentiles as if they were values. To put two stats side by side, join the table to itself on season and player_id, or use PIVOT. stat keys: SELECT DISTINCT stat, label, stat_group, unit FROM nba.player_stats WHERE season = \'2025-26\'.',
    sort: ['stat', 'team', 'player_id'],
    seasons: async () => { const { meta } = await nbaDataset(start); return [...meta.seasons].sort() },
    read: async (season) => readNbaStats(season, start),
    dictionary: {
      player_id: def('NBA Savant\'s player id as text, as in nba.player_seasons: the NBA person id, or "br:<Basketball Reference id>" for the few pre-1996 players the NBA\'s index lacks.', 'id', 'NBA Savant', '1979-80', 'Cast to join nba.player_games: CAST(g.player_id AS VARCHAR) = s.player_id.'),
      stat: def('The stat\'s key, as savant_query and nba_leaderboard take it.', 'text', 'NBA Savant', '1979-80'),
      value: def('The stat\'s value for the season, in the unit column\'s unit.', 'see unit', 'NBA Savant', '1979-80'),
      pct_league: def('The page\'s percentile against every qualified player that season (1-99, higher is better).', 'percentile', 'NBA Savant', '1979-80', 'Null where the page ranks no pool for it.'),
      pct_position: def('The page\'s percentile against qualified players at his position (Guard, Wing, Big) that season.', 'percentile', 'NBA Savant', '1979-80'),
      low_sample: def('True when his sample is under the stat\'s stabilization threshold (the hatched bar on the page).', 'flag', 'NBA Savant', '1979-80'),
      lower_better: def('True when a lower value is the better mark; null for a context stat with no better direction.', 'flag', 'NBA Savant', '1979-80'),
      qualified: def('The page\'s qualified flag for the player-season (in the percentile pools).', 'flag', 'NBA Savant', '1979-80'),
    },
  },
  'cbb.player_seasons': {
    row: 'college player-season (CBB Savant)',
    note: 'One row per men\'s D1 player-season as CBB Savant holds it: team, position group, class, age, size, games, starts, minutes, possessions, the page\'s qualified flag, recruiting, and how sure his opponent adjustment is. 2009-10 on; 2011-12 and 2012-13 are not on the site (ESPN never recorded enough of their box scores to pass the 98% gate). Join cbb.player_games or cbb.player_stats on season and player_id.',
    sort: ['team', 'player_id'],
    seasons: async () => cbbSeasons(),
    read: async (season) => readCbbSeasons(season, start),
    dictionary: {
      player_id: def('ESPN athlete id, the id every cbb table uses.', 'id', 'CBB Savant', '2009-10'),
      pos: def('Guard, Wing or Big, as the page assigns it.', 'text', 'CBB Savant', '2009-10'),
      age: def('Age on the season\'s reference date.', 'years', 'CBB Savant', '2009-10', 'Null where no birthdate is known.'),
      poss: def('Possessions he was on the floor for (the sample behind per-70 rates).', 'possessions', 'CBB Savant', '2009-10'),
      qualified: def('The page\'s qualified flag (in the percentile pools).', 'flag', 'CBB Savant', '2009-10'),
      adj_confidence: def('How sure his opponent adjustment is, 0-100.', 'score', 'CBB Savant', '2009-10'),
      tier: def('"full" or "box": a box season has box-score stats only.', 'text', 'CBB Savant', '2009-10'),
    },
  },
  'cbb.player_stats': {
    row: 'college player-season-stat (every CBB Savant card stat)',
    note: 'One row per college player, season and stat: the raw value (garbage time out) and the opponent-adjusted value the page ranks by default, with the stat\'s sample. A stat whose unit is "per" is per possession: multiply by 70 for the per-70 number the page shows. No percentiles here: the cbb_ tools return the page\'s, each with its pool. A stat with no row was not tracked that season (box seasons have box stats only; lineup and shot-location stats start later) or has no value for him. stat keys: SELECT DISTINCT stat, label, stat_group, unit FROM cbb.player_stats WHERE season = \'2025-26\'.',
    sort: ['stat', 'team_id', 'player_id'],
    seasons: async () => cbbSeasons(),
    read: async (season) => readCbbStats(season),
    dictionary: {
      raw: def('The stat before opponent adjustment, garbage time left out.', 'see unit', 'CBB Savant', '2009-10'),
      adjusted: def('The stat adjusted for the opponents he faced: the value the page ranks by default.', 'see unit', 'CBB Savant', '2009-10', 'Null for stats that are not adjusted.'),
      sample: def('The stat\'s sample (what sample_of names: attempts, possessions and so on).', 'count', 'CBB Savant', '2009-10'),
      lower_better: def('True when lower is better; null for a context stat.', 'flag', 'CBB Savant', '2009-10'),
    },
  },
  'cbb.pro_links': {
    row: 'college player who reached the NBA (both ids)',
    note: 'One row per college player whose NBA identity is known: his CBB Savant id (cbb tables\' player_id) and his NBA Savant id (nba tables\' player_id). One file (season = \'all\'). method "site" is the link the two sites already show; "matched" is WCE\'s match on name and age (college age against NBA birthdate), graded against the site links before it is written: 393 of 394 found, all the same player (Nov 2026). A player with no row is not known to have reached the NBA: absence is not proof.',
    sort: ['cbb_player_id'],
    seasons: async () => ['all'],
    read: async () => readProLinks(),
    dictionary: {
      cbb_player_id: def('ESPN college athlete id (cbb.player_seasons.player_id).', 'id', 'CBB Savant', '2009-10'),
      nba_player_id: def('NBA person id (nba.player_seasons.player_id).', 'id', 'NBA Savant', '2009-10'),
      method: def('"site": linked on the pages; "matched": matched by WCE on name and age.', 'text', 'WCE', '2009-10'),
    },
  },
})
