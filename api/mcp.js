// api/mcp.js — the AI connector. An MCP server at https://wcehoops.com/api/mcp that lets an
// assistant such as Claude look things up on Western Conference Elitists in the middle of a
// conversation — Savant numbers, rankings, headlines — and link back to the page.
//
// Anyone can add it by URL as a custom connector; there is no sign-in and nothing to
// configure. It is READ-ONLY: every tool only looks things up. Nothing here can vote,
// write, or change anything on the site.
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
//                                                 nba_get_leaderboard, nba_compare_players,
//                                                 nba_get_player_career, nba_list_stats
//   api/_football.js     Football Savant          nfl_search_players, nfl_get_player_profile,
//                                                 nfl_get_leaderboard, nfl_compare_players,
//                                                 nfl_get_player_career, nfl_list_stats
//   api/_coaching.js     Coaching Savant          nfl_search_coaches, nfl_get_coach_profile,
//                                                 nfl_get_coach_leaderboard
//   api/_ufc.js          UFC Savant               ufc_search_fighters, ufc_get_fighter_profile,
//                                                 ufc_get_upcoming_cards, ufc_get_leaderboard,
//                                                 ufc_compare_fighters, ufc_list_stats
//   api/_draft.js        Draft Savant             nba_draft_search_prospects,
//                                                 nba_draft_get_prospect_profile
//   api/_site.js         News, articles, boards   wce_get_news, wce_search_articles,
//                                                 wce_get_article, wce_get_big_board,
//                                                 wce_get_dynasty_rankings
//
// A section's run() returns { text, structured }: the answer in words, and the same answer
// as data. To add a section, write its module and add it to SECTIONS below.
//
// Each Savant answers the same five kinds of question, and its tools are named for them:
// search (find someone), profile (one card), leaderboard (who is top), compare (side by side)
// and career (one player over the years), plus list_stats, the glossary. A leaderboard is the
// page's own Leaderboard Builder: the same pool and the same order, never a new ranking.
//
// Every section answers from small files the build writes under /savant-api/ (see
// scripts/lib/savant-api.mjs), with one exception: the Dynasty board is live, so that tool
// reads the site's own /api/dynasty, and only ever its read-only board.
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
// could not be answered, which AI apps connect, and how often the brake came on. Counts
// only: never what was asked, and never who asked. This tally is the one thing the
// connector writes, and it is about the connector, not the site: READ-ONLY above still
// holds for everything a caller can reach. The private /analytics page shows it.
//
// tools/savant-mcp/check.mjs talks to this handler with a real MCP client; each section has
// its own check beside it in tools/.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SavantError } from './_core.js'
import { makeLimiter } from './_limit.js'
import { clientFamily, count } from './_usage.js'
import { tools as basketball } from './_basketball.js'
import { tools as coaching } from './_coaching.js'
import { tools as draft } from './_draft.js'
import { tools as football } from './_football.js'
import { tools as site } from './_site.js'
import { tools as ufc } from './_ufc.js'

const SECTIONS = [basketball, football, coaching, ufc, draft, site]

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

const SERVER = { name: 'wcehoops', title: 'Western Conference Elitists (wcehoops.com)', version: '2.1.0' }

const INSTRUCTIONS = [
  'Western Conference Elitists (wcehoops.com): sports analytics in the style of Baseball Savant, plus the site\'s own news, articles and rankings. Tools are grouped by prefix.',
  'nba_ is Basketball Savant: NBA player stats as percentiles, 1979-80 to the latest season, ranked against the league and against the same position.',
  'nfl_ is Football Savant and Coaching Savant: NFL players since 1999, ranked only against the same position, within a season and all-time; and NFL head coaches and play-callers.',
  'ufc_ is UFC Savant: fighters ranked inside their division, against active fighters and all-time.',
  'nba_draft_ is Draft Savant: college and pre-draft data on draft prospects, not NBA stats.',
  'wce_ is the site itself: its news page, its articles, its draft Big Board and its crowd-priced Dynasty board.',
  'Pick the tool by the question. One named player, coach or fighter: a _profile tool. "Who led", "top ten", "best on the team": a _leaderboard tool, never a string of profiles. Two or more players or fighters side by side: a _compare tool (for two coaches, one profile each). One player over the years: a _career tool. What a stat means, or its key: a _list_stats tool.',
  'Every percentile belongs to a pool, and each result names it. A percentile is only meaningful with its pool. A percentile stops at 99, so "led the league" comes from a leaderboard or a stated place, not from a 99th percentile.',
  'A stat marked low sample is below its stabilization threshold. A stat a season did not track is listed as not tracked rather than shown as zero. Results state the date of their data and link to the matching page on wcehoops.com.',
].join(' ')

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

export function buildServer() {
  const server = new McpServer(SERVER, { instructions: INSTRUCTIONS })
  for (const section of SECTIONS) {
    for (const tool of section) {
      server.registerTool(tool.name, tool.config, async (args) => {
        // The tally is written while the tool runs, not after it, so it adds no wait of its
        // own; it cannot fail the call and gives up after 700 ms (api/_usage.js).
        const counted = count([`t:${tool.name}`])
        const result = await answer(() => tool.run(args))
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

  // The brake. Several messages sent as one request count as several.
  const messages = Array.isArray(body) ? body : [body]
  const turn = limiter.take(callerOf(req), ratePerMinute(), Math.max(1, messages.length))
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

  const server = buildServer()
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
