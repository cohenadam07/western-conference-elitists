// api/_league-pro.js — WCE Pro (beta): league sync, NFL. One section of the AI connector
// (api/mcp.js), registered only for a connection that carries a real WCE key (PRO_SECTIONS).
//
// nfl_league reads a fan's fantasy league (Sleeper, ESPN, MyFantasyLeague, Fantrax) through the
// site's own /api/league?sport=nfl (api/_league-nfl.js; the connector never calls a platform
// itself, which is why this tool is marked openWorldHint) and puts Football Savant on every
// player: what his scoring is built on, so an assistant can talk about the league the fan
// actually plays in.
//
// WHAT EACH PLAYER CARRIES (Adam, 3 Nov 2026: "Savant's why plus ranges", not a WCE projection
// sold as better than the experts; claude/football-savant-fantasy-xfp-backtest.md)
//   points    fantasy points a game this season, in the league's own reception scoring
//   opportunity  expected points a game (xfp): what an average player scores with his workload.
//                The part of scoring that repeats most (to-date vs rest of season, r about .7)
//   efficiency   points over expected a game, TD luck taken out (repeats about .25)
//   td_luck      touchdown points over expected a game (repeats about .05: mostly noise)
//   each with Football Savant's own percentile against his position this season
//
// MATCHING. Each platform's player id -> the NFL's gsis id through public/football-ids.json
// (scripts/football-ids.mjs). A player the table does not know, and every Fantrax player, is
// matched by name against this season's Football Savant rows: the full name at his position, or
// the full name alone when only one player has it. Anyone still unplaced is listed, not dropped.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError, day, makeLoader, miss, origin, ordinal } from './_core.js'
import * as nflMod from './_football.js'

const SOURCE = 'Football Savant, Western Conference Elitists (wcehoops.com); league read live from the platform'
const PAGE = 'https://wcehoops.com/football-savant.html'
const PLATFORM = { sleeper: 'Sleeper', espn: 'ESPN', mfl: 'MyFantasyLeague', fantrax: 'Fantrax' }
export const leagueRead = { timeoutMs: 25000 }

const idFiles = makeLoader('', { what: 'Football Savant', maxCached: 2, shape: (b) => b && typeof b === 'object' && b.sleeper && b.espn })
const loadIds = () => idFiles.load('football-ids.json')

// The reader's error codes, in words.
export const ERRORS = {
  'no-user': 'No Sleeper user with that username.',
  'no-leagues': 'That Sleeper account has no NFL leagues this season. Check the username, or give the league id (the long number in the league\'s web address).',
  'no-league': 'Could not read that league. Check the league id (and the season, for ESPN and MyFantasyLeague).',
  private: 'That league is private, so it cannot be read without signing in. On ESPN, the commissioner can make it viewable to the public (League settings > Basic settings > Make league viewable to public); private ESPN leagues and Yahoo are coming to WCE Pro next.',
  'not-nfl': 'That Sleeper league is not an NFL league.',
  empty: 'That league has no rosters yet.',
  'bad-code': 'That does not look like a username or league id: letters, numbers, dots, dashes and underscores only.',
  'bad-platform': 'platform is sleeper, espn, mfl or fantrax.',
}

async function readLeague(args) {
  const qs = new URLSearchParams({ sport: 'nfl', platform: args.platform, code: args.code })
  if (args.league) qs.set('league', args.league)
  if (args.season) qs.set('season', String(args.season))
  let res
  try {
    res = await fetch(`${origin()}/api/league?${qs}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(leagueRead.timeoutMs) })
  } catch (err) {
    console.error('[league-pro] league read failed:', err.message)
    throw new SavantError('The site\'s league reader could not be reached right now. Try again in a minute.')
  }
  let body = null
  try { body = JSON.parse(await res.text()) } catch { body = null }
  if (!body || typeof body !== 'object') throw new SavantError(`Could not read that ${PLATFORM[args.platform]} league right now. Try again in a minute.`)
  if (!body.ok) throw new SavantError(`${ERRORS[body.error] || 'Could not read that league.'} (${PLATFORM[args.platform]})`)
  return body
}

// ---- matching -----------------------------------------------------------------------------

const key = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ (jr|sr|ii|iii|iv|v)$/, '')
// The positions Football Savant ranks fantasy players at.
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

function matcher(ids, rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const byName = new Map()
  const byNamePos = new Map()
  for (const r of rows) {
    const k = key(r.name)
    byName.set(k, byName.has(k) ? null : r) // null: more than one player has the name
    const kp = `${k}|${r.pos}`
    byNamePos.set(kp, byNamePos.has(kp) ? null : r)
  }
  return (platform, p) => {
    if (!FANTASY.has(p.pos)) return { row: null, by: null }
    const g = p.gsis || (ids[platform] && ids[platform][p.pid]) || null
    if (g && byId.has(g)) return { row: byId.get(g), by: 'id' }
    const k = key(p.name)
    const hit = byNamePos.get(`${k}|${p.pos}`) || byName.get(k)
    if (hit) return { row: hit, by: 'name' }
    return { row: null, by: g ? 'id-no-season' : null }
  }
}

// ---- Football Savant's numbers, in the league's scoring -------------------------------------

const cell = (r, k) => (r && ((r.m && r.m[k]) || (r.xm && r.xm[k]))) || null
const low = (r, k) => !!r && ((r.low || []).includes(k) || (r.xlow || []).includes(k))
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

// Football Savant's fantasy points are PPR with 4-point passing TDs. A league that pays less per
// catch, or more to tight ends, gets the difference from his receptions a game.
function savantLine(row, scoring) {
  const games = row.d && row.d.g ? row.d.g : null
  const pts = cell(row, 'fppg')
  const xfp = cell(row, 'xfp')
  const oe = cell(row, 'fpoe')
  const td = cell(row, 'tdoe')
  const recPg = games && row.d.rec != null ? row.d.rec / games : 0
  const recAdj = scoring && scoring.rec != null ? (scoring.rec - 1) * recPg + (row.pos === 'TE' ? (scoring.te_rec_bonus || 0) * recPg : 0) : 0
  // TD luck in points: touchdowns over expected, per game, at Football Savant's own values
  // (4 for a quarterback's passing touchdowns, 6 for everyone else's)
  const tdPts = td && games ? (td[0] * (row.pos === 'QB' ? 4 : 6)) / games : null
  return {
    games,
    points: pts ? r1(pts[0] + recAdj) : null,
    points_ppr: pts ? r1(pts[0]) : null,
    points_pct: pts ? pts[1] ?? null : null,
    opportunity: xfp ? r1(xfp[0] + recAdj) : null,
    opportunity_pct: xfp ? xfp[1] ?? null : null,
    over_expected: oe ? r1(oe[0]) : null,
    td_luck: tdPts == null ? null : r1(tdPts),
    efficiency: oe && tdPts != null ? r1(oe[0] - tdPts) : null,
    low_sample: low(row, 'xfp') || low(row, 'fppg'),
  }
}

// ---- the tool -------------------------------------------------------------------------------

export async function nflLeague(args = {}) {
  if (!PLATFORM[args.platform]) throw new SavantError(ERRORS['bad-platform'])
  const body = await readLeague(args)
  // A username with several leagues: ask which.
  if (Array.isArray(body.leagues) && !body.teams) {
    const leagues = body.leagues.map((l) => ({ id: String(l.id), name: String(l.name), season: l.season || null }))
    return {
      structured: { platform: args.platform, mode: 'leagues', leagues, notes: ['Call again with one of these ids as "league".'], source: SOURCE },
      text: `That ${PLATFORM[args.platform]} account has ${leagues.length} NFL leagues:\n${leagues.map((l) => `- ${l.name} (league ${l.id})`).join('\n')}\nCall again with one of these ids as "league".`,
    }
  }
  const L = body.league
  const [meta, ids] = await Promise.all([nflMod.loadMeta(), loadIds().catch(() => ({ sleeper: {}, espn: {}, mfl: {}, yahoo: {} }))])
  const season = meta.seasons.includes(String(L.season)) ? String(L.season) : meta.latestSeason
  const file = await nflMod.loadSeason(season)
  const match = matcher(ids, file.players)
  const notes = []
  let matched = 0, fantasyPlayers = 0
  const unplaced = []

  const teams = body.teams.map((t) => {
    const players = t.players.map((p) => {
      const out = { pid: p.pid, name: p.name, pos: p.pos, nfl: p.nfl, slot: p.slot, injury: p.injury }
      if (!FANTASY.has(p.pos)) return out
      fantasyPlayers++
      const { row, by } = match(L.platform, p)
      if (!row) { unplaced.push(`${p.name} (${p.pos}${p.nfl ? `, ${p.nfl}` : ''})`); return { ...out, savant: null } }
      matched++
      return { ...out, savant: { id: row.id, matched_by: by, qualified: !!row.qualified, ...savantLine(row, L.scoring), url: nflMod.cardUrl ? nflMod.cardUrl(row.id, season) : `${PAGE}#p=${encodeURIComponent(row.id)}&s=${season}` } }
    })
    const starters = players.filter((p) => p.slot === 'start' && p.savant && p.savant.points != null)
    return { id: t.id, name: String(t.name || '').trim(), owner: t.owner ? String(t.owner).trim() : null, players, starter_points: starters.length ? r1(starters.reduce((a, p) => a + p.savant.points, 0)) : null }
  })

  if (L.scoring && L.scoring.rec != null && L.scoring.rec !== 1) notes.push(`Points are in this league's scoring: ${L.scoring.rec} a catch${L.scoring.te_rec_bonus ? `, plus ${L.scoring.te_rec_bonus} for a tight end's catch` : ''} (Football Savant's own numbers are full PPR; points_ppr keeps them).`)
  else if (L.scoring && L.scoring.rec == null) notes.push(`${PLATFORM[L.platform]} did not give this league's scoring, so points are full PPR.`)
  if (L.scoring && L.scoring.pass_td != null && L.scoring.pass_td !== 4) notes.push(`This league pays ${L.scoring.pass_td} points a passing touchdown; Football Savant's quarterback points use 4.`)
  if (String(L.season) !== season) notes.push(`Football Savant has no ${L.season} season, so these are ${season} numbers.`)
  if (file.week) notes.push(`${season} is in progress: through week ${file.week}. Rates on few games move a lot; low_sample marks them.`)
  if (unplaced.length) notes.push(`Not placed on Football Savant (${unplaced.length}): ${unplaced.slice(0, 15).join(', ')}${unplaced.length > 15 ? ', ...' : ''}. Usually a player who has not played this season.`)
  if (L.platform === 'mfl') notes.push('MyFantasyLeague does not say who is starting this week, so slot is left empty for its players.')
  if (L.platform === 'fantrax') notes.push('Fantrax players are matched by name; its feed did not give the league\'s scoring or lineup slots.')
  notes.push('What repeats (Football Savant\'s Oct 2026 backtest): opportunity most (to-date against rest of season r about .7), efficiency some (about .25), TD luck almost none (about .05). Defenses, IDP players and MyFantasyLeague team units are listed but not ranked.')

  // The text: the team asked for in full, the rest as a line each.
  const focus = args.team ? teams.find((t) => t.id === String(args.team) || t.name.toLowerCase() === String(args.team).toLowerCase() || (t.owner || '').toLowerCase() === String(args.team).toLowerCase()) : null
  if (args.team && !focus) notes.push(`No team "${args.team}" in this league. Teams: ${teams.map((t) => t.name).join(', ')}.`)
  const pline = (p) => {
    const s = p.savant
    if (!s) return `${p.name} (${p.pos}${p.nfl ? `, ${p.nfl}` : ''})${p.injury ? ` [${p.injury}]` : ''}${FANTASY.has(p.pos) ? ': not on Football Savant this season' : ''}`
    const pc = (v) => (v == null ? '' : ` (${ordinal(v)})`)
    return `${p.name} (${p.pos}, ${p.nfl || '—'}${p.slot ? `, ${p.slot}` : ''})${p.injury ? ` [${p.injury}]` : ''}: ${s.points ?? '—'} pts/g${pc(s.points_pct)}; opportunity ${s.opportunity ?? '—'}${pc(s.opportunity_pct)}, efficiency ${s.efficiency == null ? '—' : (s.efficiency >= 0 ? '+' : '') + s.efficiency}, TD luck ${s.td_luck == null ? '—' : (s.td_luck >= 0 ? '+' : '') + s.td_luck}${s.games ? `; ${s.games} g` : ''}${s.low_sample ? '*' : ''}`
  }
  const T = [
    `League sync (WCE Pro beta): ${L.name || 'league'} on ${PLATFORM[L.platform]}, ${L.season}. ${teams.length} teams; scoring ${L.scoring && L.scoring.label ? L.scoring.label : 'not given'}; starting slots ${L.slots && L.slots.length ? L.slots.map((s) => s.slot).join(', ') : 'not given'}.`,
    `${matched} of ${fantasyPlayers} rostered fantasy players are on Football Savant's ${season}${file.week ? ` (through week ${file.week})` : ''}. Percentiles are against his position, ${season}.`,
    '',
  ]
  for (const t of focus ? [focus] : teams) {
    T.push(`${t.name}${t.owner && t.owner !== t.name ? ` (${t.owner})` : ''}${t.starter_points != null ? `: starters ${t.starter_points} pts/g` : ''}`)
    const shown = focus ? t.players : t.players.filter((p) => p.slot === 'start' || (!p.slot && p.savant)).slice(0, 12)
    for (const p of shown) T.push(`  - ${pline(p)}`)
  }
  if (focus) T.push('', `Other teams: ${teams.filter((t) => t !== focus).map((t) => `${t.name}${t.starter_points != null ? ` ${t.starter_points}` : ''}`).join('; ')}.`)
  T.push('', ...notes, '* = low sample.', `Pages: ${PAGE}`, `Source: ${SOURCE}. Football Savant data as of ${day(meta.generated)}.`)

  return {
    structured: {
      platform: L.platform, mode: 'league',
      league: { id: L.id, name: L.name, season: L.season, size: teams.length, scoring: L.scoring, slots: L.slots },
      savant_season: season, through_week: file.week || null, matched, fantasy_players: fantasyPlayers,
      teams, unplaced, notes, url: PAGE, data_as_of: day(meta.generated), source: SOURCE,
    },
    text: T.join('\n'),
  }
}

const open = z.object({}).passthrough()

export const tools = [
  {
    name: 'nfl_league',
    config: {
      title: 'WCE Pro (beta): read an NFL fantasy league',
      description: 'WCE Pro (beta), for WCE key holders. Reads a fan\'s NFL fantasy league (Sleeper username or league id; ESPN, MyFantasyLeague or Fantrax league id) and puts Football Savant on every rostered player: points a game in the league\'s own scoring, and what they are built on (opportunity = expected points, efficiency, TD luck), each with his percentile at his position. Returns every team with its starters, bench and injuries, the league\'s scoring and starting slots. Give team (a name, owner or id) for one team in full. Public leagues only for now.',
      inputSchema: {
        platform: z.enum(['sleeper', 'espn', 'mfl', 'fantrax']).describe('The fantasy platform.'),
        code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/).describe('Sleeper username or league id; ESPN, MyFantasyLeague or Fantrax league id.'),
        league: z.string().max(64).regex(/^[A-Za-z0-9_.-]*$/).optional().describe('Sleeper: which of the user\'s leagues, by id.'),
        season: z.string().regex(/^\d{4}$/).optional().describe('The year the NFL season began. Default: the current one.'),
        team: z.string().max(80).optional().describe('One team in full: its name, owner or id.'),
      },
      outputSchema: {
        platform: z.string(), mode: z.enum(['league', 'leagues']),
        league: open.optional(), leagues: z.array(open).optional(), savant_season: z.string().optional(), through_week: z.number().int().nullable().optional(),
        matched: z.number().int().optional(), fantasy_players: z.number().int().optional(), teams: z.array(open).optional(), unplaced: z.array(z.string()).optional(),
        notes: z.array(z.string()).optional(), url: z.string().optional(), data_as_of: z.string().optional(), source: z.string(),
      },
      annotations: { title: 'WCE Pro (beta): read an NFL fantasy league', ...READ_ONLY, openWorldHint: true },
    },
    run: nflLeague,
  },
]
