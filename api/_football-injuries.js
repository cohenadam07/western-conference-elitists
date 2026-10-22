// api/_football-injuries.js — Football Savant's live injury status. One section of the AI
// connector (api/mcp.js): the tool nfl_injury_report, and liveInjury(), which
// nfl_get_player_profile uses to put the same status on a player's profile.
//
// WHAT IT READS
// public/football-injuries/current.json, written by pipeline/football/injuries.py and
// refreshed through the day by .github/workflows/football-injuries.yml (ESPN every run,
// Sleeper once a day). It holds every flagged player keyed by GSIS id, the current week and
// the teams on bye. The connector reads it as published, with the loader's ten-minute cache.
//
// Injury status is a fact about this week. It never enters Savant value or the All-Savant
// Team; missed games already count there.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, makeLoader, norm } from './_core.js'

const FILE = 'football-injuries/current.json'
const files = makeLoader('', { what: 'Football Savant injury', maxCached: 1, shape: (b) => !!b.players })
const page = () => files.load(FILE)

const SOURCE = 'Football Savant injury status, Western Conference Elitists (wcehoops.com), from ESPN and Sleeper'
const cardUrl = (id, season) => `${SITE}/football-savant.html#p=${encodeURIComponent(id)}&s=${season}`
const ORDER = ['IR', 'PUP', 'Out', 'Suspended', 'Doubtful', 'Questionable']
const STATUS_WORD = { IR: 'injured reserve', PUP: 'PUP list', Out: 'out', Suspended: 'suspended', Doubtful: 'doubtful', Questionable: 'questionable' }
const shortDay = (t) => (t ? String(t).slice(0, 10) : null)

/** The live status for one player in one season, or null. Never throws: a missing file means
 *  the profile simply goes without it. */
export async function liveInjury(id, season) {
  let f
  try { f = await page() } catch { return null }
  if (!f || String(f.season) !== String(season)) return null
  const p = f.players[id]
  return {
    week: f.week ?? null,
    bye_teams: f.bye_teams || [],
    checked_at: f.generated_at || null,
    entry: p ? shape(id, p, season) : null,
  }
}

function shape(id, p, season) {
  return {
    id,
    name: p.name || null,
    team: p.team || null,
    position: p.pos || null,
    status: p.status,
    wont_play: !!p.out,
    body_part: p.body || null,
    side: /^(Left|Right)$/.test(p.side || '') ? p.side : null,
    note: p.note || null,
    estimated_return: p.return_est || null,
    source: p.source || null,
    updated_at: p.updated_at || null,
    url: cardUrl(id, season),
  }
}

/** One player's status as a sentence, for the profile's text and this tool's. */
export function injuryLine(e) {
  const where = [e.side, e.body_part].filter(Boolean).join(' ').toLowerCase()
  let s = `${upper(STATUS_WORD[e.status] || e.status)}${where ? ` (${where})` : ''}`
  s += e.wont_play ? ', will not play' : e.status === 'Doubtful' ? ', unlikely to play' : ', may play'
  if (e.updated_at) s += `; updated ${shortDay(e.updated_at)}${e.source ? ` via ${e.source}` : ''}`
  s += '.'
  if (e.note) s += ` ${e.note}`
  if (e.estimated_return) s += ` Estimated return: ${e.estimated_return}.`
  return s
}
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

async function injuryReport({ team, player, status, wont_play_only, limit }) {
  const f = await page()
  const season = String(f.season)
  let rows = Object.entries(f.players).map(([id, p]) => shape(id, p, season))
  if (team) {
    const t = team.toUpperCase()
    rows = rows.filter((r) => (r.team || '').toUpperCase() === t)
  }
  if (player) {
    const q = norm(player)
    rows = rows.filter((r) => r.id === player || norm(r.name || '').includes(q))
    if (!rows.length) {
      return {
        text: `${player} is not on the injury report: no current designation in ESPN's or Sleeper's feed (checked ${f.generated_at}).`
          + (f.week ? ` Week ${f.week}${f.bye_teams && f.bye_teams.length ? `; on bye: ${f.bye_teams.join(', ')}` : ''}.` : ''),
        structured: { season, week: f.week ?? null, bye_teams: f.bye_teams || [], players: [], checked_at: f.generated_at, source: SOURCE },
      }
    }
  }
  if (status) rows = rows.filter((r) => r.status === status)
  if (wont_play_only) rows = rows.filter((r) => r.wont_play)
  rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(b.updated_at).localeCompare(String(a.updated_at)))
  const total = rows.length
  rows = rows.slice(0, limit)

  const L = []
  L.push(`NFL injury status, ${season} season${f.week ? `, week ${f.week}` : ''} (checked ${f.generated_at}). ${total} player${total === 1 ? '' : 's'} match${team ? ` on ${team.toUpperCase()}` : ''}${total > rows.length ? `; the ${rows.length} shown are the most serious, then most recent` : ''}.`)
  if (f.bye_teams && f.bye_teams.length) L.push(`On bye this week: ${f.bye_teams.join(', ')}. A player on a bye team is not playing this week whatever his status.`)
  for (const r of rows) L.push(`- ${r.name} (${r.team || '?'}, ${r.position || '?'}): ${injuryLine(r)} ${r.url}`)
  L.push('Out, IR, PUP and Suspended mean he will not play; Questionable and Doubtful are game-day designations. Status comes from ESPN, with Sleeper filling gaps; the newer of the two wins when they disagree.')
  return {
    text: L.join('\n'),
    structured: { season, week: f.week ?? null, bye_teams: f.bye_teams || [], total, players: rows, checked_at: f.generated_at, source: SOURCE },
  }
}

const ENTRY = z.object({
  id: z.string(), name: z.string().nullable(), team: z.string().nullable(), position: z.string().nullable(),
  status: z.string().describe('IR, PUP, Out, Suspended, Doubtful or Questionable.'),
  wont_play: z.boolean().describe('True for IR, PUP, Out and Suspended.'),
  body_part: z.string().nullable(), side: z.string().nullable(), note: z.string().nullable(),
  estimated_return: z.string().nullable().describe('ESPN\'s estimated return date, where it gives one.'),
  source: z.string().nullable().describe('ESPN or Sleeper.'),
  updated_at: z.string().nullable(), url: z.string(),
})

export const tools = [
  {
    name: 'nfl_injury_report',
    config: {
      title: 'NFL injury report',
      description:
        'Current NFL injury status from Football Savant (Western Conference Elitists, wcehoops.com), refreshed through the day from ESPN\'s and Sleeper\'s public feeds: every player designated IR, PUP, Out, Suspended, Doubtful or Questionable, with body part, the latest note, an estimated return date where ESPN gives one, when it was updated, and his card link. Also returns the current week and the teams on bye, so a bye is never mistaken for an injury. Filter by team, player, or status. Use it before any start/sit, waiver or trade answer for the season in progress.',
      inputSchema: {
        team: z.string().trim().max(3).optional().describe('Team abbreviation as Football Savant writes it, e.g. "WAS", "KC", "LA" (Rams), "LV".'),
        player: z.string().trim().max(80).optional().describe('A name (or part of one) or a GSIS id. Returns his status, or says he is not on the report.'),
        status: z.enum(ORDER).optional().describe('Only this designation.'),
        wont_play_only: z.boolean().default(false).describe('Only IR, PUP, Out and Suspended.'),
        limit: z.number().int().min(1).max(200).default(40).describe('Most players to return (default 40), most serious first.'),
      },
      outputSchema: {
        season: z.string(),
        week: z.number().nullable().describe('The regular-season week in play.'),
        bye_teams: z.array(z.string()),
        total: z.number().int().optional(),
        players: z.array(ENTRY),
        checked_at: z.string().nullable().describe('When the feeds were last read.'),
        source: z.string(),
      },
      annotations: { title: 'NFL injury report', ...READ_ONLY },
    },
    run: async (a) => {
      try { return await injuryReport(a) } catch (e) {
        if (e instanceof SavantError) throw e
        throw new SavantError('The NFL injury report could not be loaded right now. Try again in a minute.')
      }
    },
  },
]
