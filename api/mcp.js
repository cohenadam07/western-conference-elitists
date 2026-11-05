// api/mcp.js — the AI connector. An MCP server at https://wcehoops.com/api/mcp that lets an
// assistant such as Claude look things up on Western Conference Elitists in the middle of a
// conversation — Savant numbers, rankings, headlines — and link back to the page.
//
// Anyone can add it by URL as a custom connector; there is no sign-in and nothing to
// configure. It is READ-ONLY: every tool only looks things up. Nothing here can vote,
// write, or change anything on the site.
//
// TWO ADDRESSES, ONE CONNECTOR
//   https://wcehoops.com/api/mcp          the public address. Works for everyone, forever.
//   https://wcehoops.com/mcp/<key>        a fan's own address, with a free key from the
//                                         homepage (vercel.json rewrites it to
//                                         /api/mcp?key=<key>). Same tools, same answers.
// A key gets its own rate-limit bucket, has its calls counted per day, and marks its holder
// as a founding member (api/_keys.js). A key that does not exist, or that cannot be checked
// because the store is down, is served exactly like the public address: an address in
// someone's Claude never stops working because of its key.
//
// HOW IT RUNS
// Stateless Streamable HTTP, JSON responses. Each POST is one JSON-RPC exchange handled by
// a fresh server object, so there are no sessions to store and any instance can answer any
// request. GET (which would open a server-to-client stream this server never uses) and
// DELETE (which would end a session it never starts) answer 405, as the MCP spec asks of a
// server that offers neither.
//
// The protocol is the official SDK's. This file knows no sport. Each section of the site is
// one module that declares its own tools — name, description, input and output shape, and
// the function that answers — and this file registers whatever they declare:
//
//   api/_basketball.js   Basketball Savant        nba_search_players, nba_get_player_profile,
//                                                 nba_all_savant_team
//   api/_basketball-lists.js  its lists         nba_leaderboard, nba_team_rankings,
//                                                 nba_player_career, nba_player_splits
//   api/_fantasy.js      Savant Fantasy/Teams     nba_fantasy_*, nba_injury_report, nba_schedule, nba_team_profile, nba_lineups
//   api/_bcoaching.js    Basketball Coaching Savant  nba_search_coaches, nba_get_coach_profile,
//                                                 nba_coaching_leaders, nba_coaching_tree,
//                                                 nba_coaching_data, nba_coaching_dictionary
//   api/_football.js     Football Savant          nfl_search_players, nfl_get_player_profile,
//                                                 nfl_all_savant_team
//   api/_football-lists.js  its lists            nfl_leaderboard, nfl_team_profile,
//                                                 nfl_player_career
//   api/_football-games.js  below the season     nfl_player_games, nfl_player_splits, nfl_game
//   api/_coaching.js     Coaching Savant          nfl_search_coaches, nfl_get_coach_profile,
//                                                 nfl_coaching_leaders, nfl_coaching_tree
//   api/_ufc.js          UFC Savant               ufc_search_fighters, ufc_get_fighter_profile,
//                                                 ufc_leaderboard, ufc_matchup,
//                                                 ufc_get_upcoming_cards
//   api/_draft.js        Draft Savant             nba_draft_search_prospects,
//                                                 nba_draft_get_prospect_profile
//   api/_cbb.js          College Basketball Savant  cbb_search_players, cbb_get_player_profile,
//                                                 cbb_player_career, cbb_player_splits, cbb_leaderboard,
//                                                 cbb_team_profile, cbb_team_rankings, cbb_lineups,
//                                                 cbb_all_savant_team, cbb_game, cbb_data, cbb_data_dictionary
//   api/_site.js         News, articles, boards   wce_get_news, wce_search_articles,
//                                                 wce_get_article, wce_get_big_board,
//                                                 wce_get_dynasty_rankings, wce_get_trending,
//                                                 wce_whats_new, nba_fantasy_league
//
//   api/_ambiguous.js    (no tools)               names shared by an NBA and a college team
//                                                 ("Oklahoma"): a note saying which, and to ask
//
// WCE PRO (BETA), FOR KEY HOLDERS ONLY
//   api/_query.js        savant_query             the assistant's own filters, groups and
//                                                 summaries over Basketball and Football Savant
// PRO sections are registered only when the address carries a real key (key.state 'valid').
// The public address, and an address whose key is unknown or could not be checked, list
// exactly the tools they listed before: nothing a fan uses today moves behind a key. While
// WCE Pro is in beta, every key holder gets it free (claude/wce-monetization-plan.md).
//
// A section's run() returns { text, structured }: the answer in words, and the same answer
// as data. To add a section, write its module and add it to SECTIONS below.
//
// Every section answers from small files the build writes under /savant-api/ (see
// scripts/lib/savant-api.mjs) or from the pages' own public data files, with three
// exceptions in api/_site.js that change by the minute and are read live from the site's own
// read-only endpoints, with a GET and nothing else: the Dynasty board
// (/api/dynasty?action=board), the most-searched lists (/api/trending?ns=bs and ?ns=dr) and a
// fan's fantasy league (/api/league, the site's proxy to Sleeper, ESPN and Fantrax; the
// connector never calls those platforms itself, which is why nba_fantasy_league is the one
// tool marked openWorldHint).
//
// THE COVERAGE CHECK
// tools/savant-mcp/coverage.mjs finds every feature of the site from source and holds it to
// tools/savant-mcp/coverage.json: the tools that answer it, or why it is left out. A weekly
// scheduled run builds what is missing and opens a pull request for approval.
//
// LIMITS
// It is public and announced on the homepage, so it has a brake (api/_limit.js): each caller
// gets RATE_PER_MINUTE requests a minute, counted by network address, and past that a
// request is answered at once with HTTP 429 and "wait N seconds" before any tool runs. The
// number is generous on purpose. People who use it through Claude all arrive from Claude's
// servers, not their own homes, so one address can be many fans at once; the limit is there
// to stop a loop or a script, not a busy evening. MCP_RATE_PER_MINUTE on Vercel overrides
// it. A request body past MAX_BODY_BYTES is refused unread: real requests are a few hundred
// bytes. None of this is a firewall; api/_limit.js says what it cannot do.
//
// COUNTING
// It keeps a tally of its own use (api/_usage.js): calls per tool per day, how many of them
// could not be answered, which AI apps connect, how often the brake came on, and, for
// callers with a key, how many calls each key made each day. Never what was asked, and
// never who asked unless they chose to get a key. This tally is the one thing the
// connector writes, and it is about the connector, not the site: READ-ONLY above still
// holds for everything a caller can reach. The private /analytics page shows it.
//
// tools/savant-mcp/check.mjs talks to this handler with a real MCP client; each section has
// its own check beside it in tools/.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SavantError } from './_core.js'
import { FOUNDING, checkKey } from './_keys.js'
import { makeLimiter } from './_limit.js'
import { clientFamily, count } from './_usage.js'
import { tools as basketball } from './_basketball.js'
import { tools as basketballLists } from './_basketball-lists.js'
import { tools as bcoaching } from './_bcoaching.js'
import { tools as coaching } from './_coaching.js'
import { tools as draft } from './_draft.js'
import { tools as cbb } from './_cbb.js'
import { tools as fantasy } from './_fantasy.js'
import { tools as football } from './_football.js'
import { tools as footballGames } from './_football-games.js'
import { tools as footballLists } from './_football-lists.js'
import { tools as site } from './_site.js'
import { tools as ufc } from './_ufc.js'
import { tools as pro } from './_query.js'
import { nbaOnly, teamNote, notFoundNote } from './_ambiguous.js'

const SECTIONS = [basketball, basketballLists, fantasy, bcoaching, football, footballLists, footballGames, coaching, ufc, draft, cbb, site]
const PRO_SECTIONS = [pro]
export const PRO_TOOLS = PRO_SECTIONS.flat().map((t) => t.name)

const RATE_PER_MINUTE = 300
const MAX_BODY_BYTES = 64 * 1024
const limiter = makeLimiter()

// Read per request, so a change on Vercel takes effect without touching the code.
function ratePerMinute() {
  const n = Number(process.env.MCP_RATE_PER_MINUTE)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : RATE_PER_MINUTE
}

// Who is calling, for counting only. Vercel sets both headers itself and overwrites
// anything the caller sent, so they cannot be forged from outside.
const callerOf = (req) =>
  String(req.headers['x-real-ip'] || '').trim() ||
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress ||
  'unknown'

// The key in the address, wherever the platform put it: Vercel hands the rewrite's
// destination query to the function as req.query, and the URL is read as a fallback (a
// plain Node server in the checks, or a request to /mcp/<key> that reached the function
// without the rewrite's query).
function keyIn(req) {
  const q = req.query?.key
  if (typeof q === 'string' && q) return q
  try {
    const url = new URL(req.url || '/', 'https://wcehoops.com')
    const p = url.searchParams.get('key')
    if (p) return p
    const m = url.pathname.match(/^\/(?:api\/)?mcp\/([^/]+)\/?$/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

const SERVER = { name: 'wcehoops', title: 'Western Conference Elitists (wcehoops.com)', version: '3.5.2' }

const INSTRUCTIONS = [
  'Western Conference Elitists (wcehoops.com): sports analytics in the style of Baseball Savant, plus the site\'s own news, articles and rankings. Tools are grouped by prefix.',
  'nba_ is Basketball Savant: NBA player stats as percentiles, 1979-80 to the latest season, ranked against the league and against the same position; its leaderboards, All-Savant Team, careers and honours, play types, with/without and monthly splits, and the all-30 teams table.',
  'nba_search_coaches, nba_get_coach_profile, nba_coaching_leaders, nba_coaching_tree, nba_coaching_data and nba_coaching_dictionary are Basketball Coaching Savant: every NBA head coach since 1946-47, with the Rotation Map (each man\'s usual windows and how often and why the coach goes off-script), lineups judged from their parts, timeouts, after-timeout plays and challenges, wins against the roster\'s talent and against the market, situation-by-situation splits, players against the aging curve, staffs and the suggested coaching tree; and a Data Room of the rows themselves (games, stints, units, rotation, decisions) with its dictionary, for an assistant\'s own analysis.',
  'nba_fantasy_, nba_injury_report and nba_schedule are its fantasy side: projections (rest of season, next 7 days, dynasty), points and 9-cat rankings, trades, streamers and Sleeper Lock-In plans. nba_team_profile and nba_lineups are its team and lineup ratings, with luck and sample adjustments.',
  'nfl_ is Football Savant and Coaching Savant: NFL players since 1999, ranked only against the same position, within a season and all-time; its All-Savant Team, leaderboards, team pages, careers, game logs and recent form, splits, maps and route trees, and postseason games; and NFL head coaches and play-callers, with Coaching Savant\'s Leaders boards and coaching tree.',
  'ufc_ is UFC Savant: fighters ranked inside their division (or, on request, against every division of their sex), against active fighters and all-time, plus its leaderboard and head-to-head views.',
  'nba_draft_ is Draft Savant: college and pre-draft data on draft prospects, not NBA stats.',
  'cbb_ is College Basketball Savant: every men\'s Division I player and team since 2013-14, opponent-adjusted percentiles against D1 at the same position by default, per 70 possessions, with RAPM, shot zones, lineups and team ratings computed by WCE; from 2025-26, play context (possession starts, transition, after timeouts, clutch, an estimated shot clock), shot charts and a possessions Data Room, and rotation maps from 2023-24; schedules read live from ESPN.',
  'wce_ is the site itself: its news page, its articles, its draft Big Board, its crowd-priced Dynasty board, its most-searched players and prospects, and what is new on its homepage. nba_fantasy_league values a fan\'s Sleeper, ESPN or Fantrax league on that Dynasty board.',
  'Some names belong to both an NBA team and a D1 college team: Oklahoma (the Thunder or the Sooners), Memphis, Utah, Houston, Indiana, Miami, Charlotte, Denver, Portland, Washington, Minnesota, Milwaukee and others. When the person uses one of these without saying which league and the conversation has not made it clear, ask them which team they mean before answering; do not assume.',
  'Every percentile belongs to a pool, and each result names it. A percentile is only meaningful with its pool.',
  'A stat marked low sample is below its stabilization threshold. A stat a season did not track is listed as not tracked rather than shown as zero. Results state the date of their data and link to the matching page on wcehoops.com.',
].join(' ')

// One more sentence, by what the address carried. Nothing extra while the store cannot be
// asked: a key holder should never be told to go and get a key.
const ABOUT_KEY = {
  valid: `This connection uses the person's own WCE key, so they are a founding member. ${FOUNDING} The key also opens the WCE Pro beta, free while it is in beta: savant_query runs your own filters, sorts, groups and summaries over every player-season on Basketball Savant and Football Savant. Reach for it when a question needs more than one player or one stat (who fits several conditions, how a team, age or position group compares); call it with list_stats: true first for the stat keys.`,
  none: `This connection uses the public address, with no WCE key. Keys are free at https://wcehoops.com/#ai: a key gives the person their own connector address and makes them a founding member. ${FOUNDING} A key also opens the WCE Pro beta (savant_query: an assistant's own filters, groups and summaries over Basketball and Football Savant), free while it is in beta. If it fits naturally you may mention this once, for instance when a question needs a filter or a comparison across many players that these tools cannot run; never let it get in the way of an answer.`,
  unknown: 'The key in this connection\'s address is not one wcehoops.com knows, so it is being served like the public address. If the person asks, a working key is emailed free from https://wcehoops.com/#ai.',
  unchecked: '',
}
export const instructionsFor = (state) => [INSTRUCTIONS, ABOUT_KEY[state] || ''].filter(Boolean).join(' ')

// Run a tool and turn what it returns, or throws, into an MCP result. A SavantError carries
// a message written for the caller; anything else is a bug and is logged, not leaked.
async function answer(run) {
  try {
    const { text, structured } = await run()
    return { content: [{ type: 'text', text }], structuredContent: structured }
  } catch (err) {
    if (err instanceof SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
    console.error('[mcp] tool failed:', err)
    return { isError: true, content: [{ type: 'text', text: 'wcehoops.com hit an unexpected error answering that. Try again, or try a different name or season.' }] }
  }
}

// `key` is what checkKey made of the address: { state, id }.
export function buildServer(key = { state: 'none' }) {
  const server = new McpServer(SERVER, { instructions: instructionsFor(key.state) })
  const byKey = key.state === 'valid' ? [`k:${key.id}`] : []
  // WCE Pro (beta): only for a real key. Anything else gets the public list, unchanged.
  const sections = key.state === 'valid' ? [...SECTIONS, ...PRO_SECTIONS] : SECTIONS
  for (const section of sections) {
    for (const tool of section) {
      server.registerTool(tool.name, tool.config, async (args) => {
        // The tally is written while the tool runs, not after it, so it adds no wait of its
        // own; it cannot fail the call and gives up after 700 ms (api/_usage.js). A keyed
        // call is counted for its key in the same write.
        const counted = count([`t:${tool.name}`, ...byKey])
        const turnBack = nbaOnly(tool.name, args)
        const result = turnBack ? { isError: true, content: [{ type: 'text', text: turnBack }] } : await answer(() => tool.run(args))
        // "Oklahoma" is the Thunder and the Sooners: say which one this is, and to ask if unclear.
        const t0 = result.content && result.content[0]
        if (t0 && !result.isError) { const n = teamNote(tool.name, args); if (n) t0.text = `${n}\n\n${t0.text}` }
        if (t0 && result.isError && args && args.team && /^No (D1 )?team (found|matches)/.test(t0.text)) { const n = notFoundNote(tool.name); if (n) t0.text += ` ${n}` }
        await counted
        if (result.isError) await count([`e:${tool.name}`])
        return result
      })
    }
  }
  return server
}

const rpcError = (code, message, id = null) => ({ jsonrpc: '2.0', error: { code, message }, id })

// Any site's page or tool may call this: it is public, read-only, and carries no cookies.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  cors(res)
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return send(res, 405, rpcError(-32000, 'This is the Western Conference Elitists MCP server. It answers JSON-RPC over POST; add this URL to an MCP client such as Claude as a custom connector.'))
  }

  // Too big to be a real request: refuse it by its stated size, without reading it.
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    return send(res, 413, rpcError(-32600, 'Request too large for the Western Conference Elitists connector.'))
  }

  // Vercel parses the JSON body on first access and throws if it is malformed.
  let body
  try { body = req.body } catch { return send(res, 400, rpcError(-32700, 'Parse error: the request body is not valid JSON.')) }
  if (body == null || typeof body !== 'object') return send(res, 400, rpcError(-32700, 'Parse error: expected a JSON-RPC message.'))

  // The key, if the address has one. Looked up once per copy of the function every ten
  // minutes (api/_keys.js); a key that is not real, or cannot be checked, is no key.
  const key = await checkKey(keyIn(req))

  // The brake. Several messages sent as one request count as several. A real key is its
  // own bucket; everyone else is counted by network address.
  const messages = Array.isArray(body) ? body : [body]
  const bucket = key.state === 'valid' ? `key:${key.id}` : callerOf(req)
  const turn = limiter.take(bucket, ratePerMinute(), Math.max(1, messages.length))
  if (!turn.ok) {
    if (turn.first) await count(['limited'])
    res.setHeader('Retry-After', String(turn.retryAfter))
    // Answer the request that was asked, so the caller can tell which one to send again.
    const asked = messages.length === 1 && messages[0] ? messages[0].id : null
    const id = typeof asked === 'string' || typeof asked === 'number' ? asked : null
    return send(res, 429, rpcError(-32000, `Too many requests to the Western Conference Elitists connector. Wait ${turn.retryAfter} seconds, then try again.`, id))
  }

  // An app saying hello: note which family of app it is. Only the family is kept.
  const hellos = messages.filter((m) => m && m.method === 'initialize').map((m) => `c:${clientFamily(m.params?.clientInfo?.name)}`)
  if (hellos.length) await count(hellos)

  const server = buildServer(key)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err) {
    console.error('[mcp] request failed:', err)
    if (!res.headersSent) send(res, 500, rpcError(-32603, 'Internal server error.'))
  }
}
