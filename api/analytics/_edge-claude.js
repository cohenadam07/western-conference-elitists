// Edge Lab — the two Claude arms.
//
//   claude_wce  Claude with WCE's analytics: the WCE projection and the WCE model's own
//               probability for every market, Basketball Savant percentiles, team ratings,
//               who sits tonight with ESPN's news blurb, and what each player's numbers did
//               in past games his injured teammates missed.
//   claude_box  Claude with what any box-score reader has: per-game averages, the last five
//               lines, and who is listed out.
//
// Neither arm sees a price. Both answer through a forced tool call, one probability per
// market, conditional on the player playing (Kalshi voids the market if he doesn't). The
// API is called with plain fetch; ANTHROPIC_API_KEY switches the arms on, EDGE_CLAUDE_MODEL
// picks the model.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { monotone } from './_edge-model.js'
import { STAT_SHORT } from './_edge-markets.js'

const api = () => `${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`
export const DEFAULT_MODEL = 'claude-sonnet-5-5'

export const claudeModel = () => process.env.EDGE_CLAUDE_MODEL || DEFAULT_MODEL
export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

const SYSTEM = `You forecast NBA player prop markets for a private research log.

Each market asks whether one player reaches a threshold tonight, for example "25+ points". If the player does not play, the market is voided, so every probability you give is conditional on him playing.

Work only from the information in the message. It is what was known roughly two hours before tip-off. You are not shown market prices, and nothing you say is advice to anyone.

Be calibrated: of all the markets you put at 70%, about 70% should hit. Keep each player's lines coherent: a higher threshold of the same stat is never likelier than a lower one. Give a probability for every market listed, using its id.

Answer only by calling the record_forecasts tool. Put two to five sentences in "notes" first, on what (if anything) moved you away from a plain average-based read for this game.`

const TOOL = {
  name: 'record_forecasts',
  description: 'Record a probability for every listed market.',
  input_schema: {
    type: 'object',
    properties: {
      notes: { type: 'string', description: 'Two to five sentences on what moved your numbers, if anything.' },
      forecasts: {
        type: 'array',
        description: 'One entry per market id listed in the message.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            p: { type: 'number', minimum: 0, maximum: 1, description: 'Probability the player reaches the threshold, if he plays.' },
          },
          required: ['id', 'p'],
        },
      },
    },
    required: ['notes', 'forecasts'],
  },
}

const r1 = (x) => (x == null || !Number.isFinite(x) ? '?' : (Math.round(x * 10) / 10).toFixed(1))
const pct = (x) => (x == null ? '?' : `${Math.round(x * 100)}%`)
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

const tipText = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'

function averages(rows, ix) {
  const n = rows.length
  if (!n) return null
  const s = (k) => rows.reduce((a, r) => a + (r[ix[k]] || 0), 0) / n
  return { n, min: s('min'), pts: s('pts'), reb: s('reb'), ast: s('ast'), fg3m: s('fg3m') }
}
const avgText = (a) => `${r1(a.min)} min, ${r1(a.pts)} pts, ${r1(a.reb)} reb, ${r1(a.ast)} ast, ${r1(a.fg3m)} 3PM`
const lineText = (r, ix) => `${r[ix.pts]}p ${r[ix.reb]}r ${r[ix.ast]}a ${r[ix.fg3m]}×3 (${r[ix.min]}m)`

function marketsText(markets, withModel) {
  return markets
    .map((m) => `${m.id} ${STAT_SHORT[m.stat]} ${m.k}+${withModel && m.pModel != null ? ` [WCE ${pct(m.pModel)}]` : ''}`)
    .join(' · ')
}

// outs: { TEAM: ['Name (Out)', 'Name (Day-To-Day)', ...] }
function outsText(outs) {
  return Object.entries(outs)
    .map(([team, list]) => `${team}: ${list.length ? list.join(', ') : 'nobody listed'}`)
    .join('\n')
}

// One player's card for the WCE arm.
function wceCard(p, ix) {
  const lines = []
  const head = [`${p.name} (${p.team}, ${p.pos || '?'}${p.age ? `, ${r1(p.age)}` : ''}${p.rookie ? ', rookie' : ''})`]
  if (p.status) head.push(`status: ${p.status}${p.statusNote ? ` — "${p.statusNote}"` : ''}`)
  lines.push(head.join(' · '))
  if (p.proj) {
    const j = p.proj
    lines.push(`  WCE projection per game: ${r1(j.min)} min, ${r1(j.pts)} pts, ${r1(j.reb)} reb, ${r1(j.ast)} ast, ${r1(j.fg3m)} 3PM, ${r1(j.fga)} FGA, ${r1(j.fta)} FTA`)
  }
  const log = (p.log || []).filter((r) => (r[ix.min] || 0) > 0)
  if (log.length) {
    const l10 = averages(log.slice(-10), ix)
    lines.push(`  Last ${l10.n}: ${avgText(l10)} | last 5: ${log.slice(-5).map((r) => lineText(r, ix)).join('; ')}`)
  }
  if (p.savant?.length) lines.push(`  Basketball Savant ${p.savantSeason} vs ${p.peers}: ${p.savant.map((s) => `${s.label} ${s.value} (${ordinal(s.pct)})`).join(' · ')}`)
  for (const b of p.beneficiary || []) lines.push(`  ${b}`)
  lines.push(`  Markets: ${marketsText(p.markets, true)}`)
  return lines.join('\n')
}

// One player's card for the box-score arm.
function boxCard(p, ix) {
  const lines = [`${p.name} (${p.team})${p.status ? ` · status: ${p.status}` : ''}`]
  const log = (p.log || []).filter((r) => (r[ix.min] || 0) > 0)
  if (log.length) {
    const all = averages(log, ix)
    lines.push(`  Last ${all.n} games: ${avgText(all)} | last 5: ${log.slice(-5).map((r) => lineText(r, ix)).join('; ')}`)
  } else {
    lines.push('  No NBA games on record.')
  }
  lines.push(`  Markets: ${marketsText(p.markets, false)}`)
  return lines.join('\n')
}

// The user message for one arm and one game.
export function buildPrompt(arm, { game, players, ix, teams, outs }) {
  const head = `${game.away} at ${game.home}, tip ${tipText(game.tip)}.`
  if (arm === 'claude_wce') {
    return [
      head,
      '',
      'Each market shows the WCE model\'s probability in brackets. That model is the WCE projection plus the player\'s own game-to-game spread. It knows nothing about tonight: not the injuries, not the opponent, not the news. Treat it as a starting point and move off it for reasons you can name.',
      '',
      'TEAMS (ranks out of 30: 1st is the fastest pace, and the best mark for everything else)',
      ...teams,
      '',
      'INJURY LIST (ESPN, current)',
      outsText(outs),
      '',
      'PLAYERS',
      ...players.map((p) => wceCard(p, ix)),
    ].join('\n')
  }
  return [
    head,
    '',
    'INJURY LIST (ESPN, current)',
    outsText(outs),
    '',
    'PLAYERS',
    ...players.map((p) => boxCard(p, ix)),
  ].join('\n')
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

// Asks one arm about one game. Returns { probs: Map(id -> p), notes, usage, ms } or throws.
// `ids` is every market id in the prompt; `markets` carries { id, playerKey, stat, k } so the
// answers can be made coherent per player and stat.
export async function askClaude(prompt, markets, { deadline = Date.now() + 120000, maxTokens = 8000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const body = JSON.stringify({
    model: claudeModel(),
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: prompt }],
  })
  const started = Date.now()
  let lastErr = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const left = deadline - Date.now()
    if (left < 5000) break
    let res
    try {
      res = await fetch(api(), {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(Math.min(left, 150000)),
      })
    } catch (err) {
      lastErr = String(err?.message || err)
      continue
    }
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`
      const ra = Number(res.headers.get('retry-after'))
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 4000 * 2 ** attempt, Math.max(0, deadline - Date.now() - 5000)))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 300)}`)
    const json = JSON.parse(text)
    return { ...parseAnswer(json, markets), usage: json.usage || null, ms: Date.now() - started }
  }
  throw new Error(`Anthropic call did not complete (${lastErr || 'out of time'})`)
}

// The tool call's forecasts, clamped, then made coherent per player and stat.
export function parseAnswer(json, markets) {
  if (json.stop_reason === 'max_tokens') throw new Error('The answer ran out of room before every market was priced (max_tokens)')
  const call = (json.content || []).find((c) => c.type === 'tool_use' && c.name === TOOL.name)
  if (!call) throw new Error(`No ${TOOL.name} call in the answer (stop_reason ${json.stop_reason})`)
  const byId = new Map(markets.map((m) => [m.id, m]))
  const raw = new Map()
  for (const f of call.input?.forecasts || []) {
    const p = Number(f?.p)
    // Anything outside 0..1 (a percent, say) is not a probability: left out, not guessed at.
    if (byId.has(f?.id) && Number.isFinite(p) && p >= 0 && p <= 1) raw.set(f.id, Math.min(0.99, Math.max(0.01, p)))
  }
  const groups = new Map()
  for (const [id, p] of raw) {
    const m = byId.get(id)
    const g = `${m.playerKey}|${m.stat}`
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push({ id, k: m.k, p })
  }
  const probs = new Map()
  for (const items of groups.values()) for (const it of monotone(items)) probs.set(it.id, it.p)
  return { probs, notes: String(call.input?.notes || '').slice(0, 1200), missing: markets.length - probs.size }
}
