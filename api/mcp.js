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
//   api/_basketball.js   Basketball Savant        nba_search_players, nba_get_player_profile
//   api/_football.js     Football Savant          nfl_search_players, nfl_get_player_profile
//   api/_coaching.js     Coaching Savant          nfl_search_coaches, nfl_get_coach_profile
//   api/_ufc.js          UFC Savant               ufc_search_fighters, ufc_get_fighter_profile,
//                                                 ufc_get_upcoming_cards
//   api/_draft.js        Draft Savant             nba_draft_search_prospects,
//                                                 nba_draft_get_prospect_profile
//   api/_site.js         News, articles, boards   wce_get_news, wce_search_articles,
//                                                 wce_get_article, wce_get_big_board,
//                                                 wce_get_dynasty_rankings
//
// A section's run() returns { text, structured }: the answer in words, and the same answer
// as data. To add a section, write its module and add it to SECTIONS below.
//
// Every section answers from small files the build writes under /savant-api/ (see
// scripts/lib/savant-api.mjs), with one exception: the Dynasty board is live, so that tool
// reads the site's own /api/dynasty, and only ever its read-only board.
//
// tools/savant-mcp/check.mjs talks to this handler with a real MCP client; each section has
// its own check beside it in tools/.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SavantError } from './_core.js'
import { tools as basketball } from './_basketball.js'
import { tools as coaching } from './_coaching.js'
import { tools as draft } from './_draft.js'
import { tools as football } from './_football.js'
import { tools as site } from './_site.js'
import { tools as ufc } from './_ufc.js'

const SECTIONS = [basketball, football, coaching, ufc, draft, site]

const SERVER = { name: 'wcehoops', title: 'Western Conference Elitists (wcehoops.com)', version: '2.0.0' }

const INSTRUCTIONS = [
  'Western Conference Elitists (wcehoops.com): sports analytics in the style of Baseball Savant, plus the site\'s own news, articles and rankings. Tools are grouped by prefix.',
  'nba_ is Basketball Savant: NBA player stats as percentiles, 1979-80 to the latest season, ranked against the league and against the same position.',
  'nfl_ is Football Savant and Coaching Savant: NFL players since 1999, ranked only against the same position, within a season and all-time; and NFL head coaches and play-callers.',
  'ufc_ is UFC Savant: fighters ranked inside their division, against active fighters and all-time.',
  'nba_draft_ is Draft Savant: college and pre-draft data on draft prospects, not NBA stats.',
  'wce_ is the site itself: its news page, its articles, its draft Big Board and its crowd-priced Dynasty board.',
  'Every percentile belongs to a pool, and each result names it. A percentile is only meaningful with its pool.',
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
      server.registerTool(tool.name, tool.config, (args) => answer(() => tool.run(args)))
    }
  }
  return server
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null })

// Any site's page or tool may call this: it is public, read-only, and carries no cookies.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version')
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

  // Vercel parses the JSON body on first access and throws if it is malformed.
  let body
  try { body = req.body } catch { return send(res, 400, rpcError(-32700, 'Parse error: the request body is not valid JSON.')) }
  if (body == null || typeof body !== 'object') return send(res, 400, rpcError(-32700, 'Parse error: expected a JSON-RPC message.'))

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
