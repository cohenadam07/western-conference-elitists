// api/mcp.js — the AI connector. An MCP server at https://wcehoops.com/api/mcp that lets an
// assistant such as Claude look up Basketball Savant numbers in the middle of a conversation
// and link back to the player's card.
//
// Anyone can add it by URL as a custom connector; there is no sign-in and nothing to
// configure. It is READ-ONLY: every tool only looks numbers up. Nothing here can vote,
// write, or change anything on the site.
//
// HOW IT RUNS
// Stateless Streamable HTTP, JSON responses. Each POST is one JSON-RPC exchange handled by
// a fresh server object, so there are no sessions to store and any instance can answer any
// request. GET (which would open a server-to-client stream this server never uses) and
// DELETE (which would end a session it never starts) answer 405, as the MCP spec asks of a
// server that offers neither.
//
// The protocol is the official SDK's. What the tools know and how they phrase it lives in
// api/_savant.js, which reads the percentile files the build writes (scripts/lib/savant-api.mjs).
//
// TOOLS
//   nba_search_players      find players by name -> ids, positions, seasons
//   nba_get_player_profile  one player, one season -> every stat with its league and
//                           position percentile, comps, and the link to his card
//
// tools/savant-mcp/check.mjs talks to this handler with a real MCP client.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { GROUPS, SavantError, playerProfile, searchPlayers } from './_savant.js'

const SERVER = { name: 'wce-basketball-savant', title: 'Basketball Savant (Western Conference Elitists)', version: '1.0.0' }

const INSTRUCTIONS = [
  'Basketball Savant by Western Conference Elitists (wcehoops.com): NBA player stats as percentiles, from 1979-80 to the latest season.',
  'Every percentile belongs to a pool, and results label which: "league" is against all qualified players that season, and "vs. guards", "vs. wings" or "vs. bigs" is against qualified players at the same position. A percentile is only meaningful with its pool.',
  'Rate stats are per 75 possessions or percentages, not totals. A stat marked low sample is below its stabilization threshold. A stat a season did not track is listed as not tracked rather than shown as zero.',
  'Each profile includes the link to the player\'s card on wcehoops.com.',
].join(' ')

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const pct = z.number().int().min(1).max(99).nullable()
const comp = z.object({ id: z.string(), name: z.string(), team: z.string(), match: z.number() })

// Run a tool and turn what it returns, or throws, into an MCP result. A SavantError carries
// a message written for the caller; anything else is a bug and is logged, not leaked.
async function answer(run) {
  try {
    const { text, structured } = await run()
    return { content: [{ type: 'text', text }], structuredContent: structured }
  } catch (err) {
    if (err instanceof SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
    console.error('[mcp] tool failed:', err)
    return { isError: true, content: [{ type: 'text', text: 'Basketball Savant hit an unexpected error answering that. Try again, or try a different player or season.' }] }
  }
}

export function buildServer() {
  const server = new McpServer(SERVER, { instructions: INSTRUCTIONS })

  server.registerTool(
    'nba_search_players',
    {
      title: 'Search NBA players',
      description:
        'Find NBA players in Basketball Savant (Western Conference Elitists, wcehoops.com) by name. Covers every player with stats from 1979-80 through the latest season. Returns each match with its id, position, most recent team, and first and last season, plus the link to his card. Matching ignores accents and punctuation and tolerates small typos. Some players whose careers began before 1996-97 appear under two ids, one for each part of the career.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).describe('Player name or part of one, e.g. "Jokic", "LeBron James", "Gilgeous".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most matches to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int().describe('How many players matched in all.'),
        count: z.number().int().describe('How many are returned here.'),
        players: z.array(z.object({
          id: z.string().describe('Player id, for nba_get_player_profile.'),
          name: z.string(),
          position: z.string().describe('Guard, Wing or Big, in his most recent season.'),
          team: z.string().describe('Team in his most recent season.'),
          first_season: z.string(),
          last_season: z.string(),
          seasons: z.number().int().describe('Number of seasons with stats.'),
          url: z.string().describe('His Basketball Savant card.'),
        })),
      },
      annotations: { title: 'Search NBA players', ...READ_ONLY },
    },
    ({ query, limit }) => answer(() => searchPlayers({ query, limit })),
  )

  server.registerTool(
    'nba_get_player_profile',
    {
      title: 'Get an NBA player\'s Savant profile',
      description:
        'Get one NBA player\'s Basketball Savant profile (Western Conference Elitists, wcehoops.com) for one season: his per-game line and every tracked stat with its value and two percentiles, one against all qualified players that season ("league") and one against qualified players at his position ("vs. guards", "vs. wings" or "vs. bigs"). Covers shooting, creation and playmaking, rebounding, defense, physical measurements and overall-value stats such as BPM. Defaults to his most recent season. For the latest season it can instead return his last 10, 25 or 75 games, and it adds his statistical comps, weakness comps and who he guards. Seasons from 1979-80 on; stats a season did not track are listed as not tracked. Includes the link to his card.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nba_search_players (e.g. "203999") or a full name (e.g. "Nikola Jokic"). If a name fits more than one player, the error lists their ids.'),
        season: z.string().trim().max(12).optional().describe('Season written as two years, e.g. "2025-26". Omit for his most recent season.'),
        window: z.enum(['season', 'l10', 'l25', 'l75']).default('season').describe('"season" for the full season (default). "l10", "l25" or "l75" for his last 10, 25 or 75 games, latest season only.'),
        group: z.enum(['all', ...Object.keys(GROUPS)]).default('all').describe('Which stats to return: "all" (default), "context" (minutes, availability), "offense", "defense" or "value" (BPM, win shares, VORP and similar).'),
      },
      outputSchema: {
        player: z.object({
          id: z.string(),
          name: z.string(),
          team: z.string(),
          position: z.string().describe('Guard, Wing or Big that season.'),
          age: z.number().nullable(),
          experience: z.number().nullable().describe('Years of NBA experience.'),
          qualified: z.boolean().describe('Whether he is in the percentile pools that season.'),
          games: z.number().nullable(),
          minutes: z.number().nullable(),
        }),
        season: z.string(),
        window: z.string().describe('season, l10, l25 or l75.'),
        per_game: z.object({
          points: z.number().nullable(),
          rebounds: z.number().nullable(),
          assists: z.number().nullable(),
          turnovers: z.number().nullable(),
          minutes: z.number().nullable(),
        }).nullable().describe('Full-season per-game line.'),
        pools: z.object({
          league: z.number().nullable().describe('Qualified players that season.'),
          position: z.number().nullable().describe('Qualified players at his position that season.'),
          position_label: z.string().describe('guards, wings or bigs.'),
        }),
        stats: z.array(z.object({
          key: z.string(),
          label: z.string(),
          group: z.string(),
          subgroup: z.string().nullable(),
          value: z.number().describe('Raw value.'),
          display: z.string().describe('The value as the site prints it.'),
          league_percentile: pct.describe('Against all qualified players that season. Higher is better.'),
          position_percentile: pct.describe('Against qualified players at his position. Higher is better.'),
          lower_is_better: z.boolean().describe('True when a lower raw value is better. The percentiles are already flipped.'),
          low_sample: z.boolean().describe('True when the stat is below its stabilization threshold.'),
        })),
        not_tracked: z.array(z.object({ key: z.string(), label: z.string(), since: z.string() })).describe('Stats that season did not track.'),
        notes: z.array(z.string()).describe('How to read the numbers: what the pools are, and any caution that applies to this player.'),
        comps: z.array(comp).optional().describe('Closest statistical profiles, among players with 500+ minutes.'),
        weakest: z.array(z.object({ key: z.string(), label: z.string(), percentile: z.number() })).optional().describe('Where he ranks worst among players at his position with 500+ minutes.'),
        weakness_comps: z.array(comp).optional().describe('Players who share his flaws.'),
        defensive_matchups: z.object({ guards: z.number(), wings: z.number(), bigs: z.number(), possessions: z.number().nullable() }).optional().describe('Share of his defensive matchups by position guarded, in percent.'),
        defensive_role: z.object({
          perimeter_assignment_rate: z.number().nullable(),
          rim_contest_rate: z.number().nullable(),
          rim_fg_allowed_vs_expected: z.number().nullable(),
          possessions: z.number().nullable(),
          shots_defended: z.number().nullable(),
        }).optional().describe('Bigs only. Reflects role, not ability.'),
        url: z.string().describe('His Basketball Savant card.'),
        data_as_of: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get an NBA player\'s Savant profile', ...READ_ONLY },
    },
    ({ player, season, window, group }) => answer(() => playerProfile({ player, season, window, group })),
  )

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
    return send(res, 405, rpcError(-32000, 'This is the Basketball Savant MCP server. It answers JSON-RPC over POST; add this URL to an MCP client such as Claude as a custom connector.'))
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
