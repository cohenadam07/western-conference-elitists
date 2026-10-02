// api/_usage.js — the AI connector's usage log: how many times each tool is called, by day,
// and which AI apps connect. api/mcp.js writes it; the private /analytics page reads it
// through api/analytics/history.js.
//
// WHAT IS KEPT
// Counts, and nothing else. For each day (UTC, like the rest of the analytics archive):
//
//   t:<tool>     calls to that tool
//   e:<tool>     calls that came back as "could not answer" (no such player, a name several
//                people share, the data being down)
//   c:<app>      connections, by the family of AI app that made them (see clientFamily)
//   limited      callers stopped by the rate limit, counted once per caller per minute
//   writes       how many times this log was written that day (the cap below)
//
// What was asked is never kept, nor who asked: no question, no player name, no address.
//
// WHAT IT COSTS, AND THE CAP
// The site's data store has a monthly allowance that the Dynasty board, Flappy Hoops races,
// the leaderboards and the forms all share. Every write here is ONE command (a small script
// that adds to the counts), and there is a ceiling: after DAILY_CAP writes in a day the log
// stops counting until tomorrow, and the page says the day was capped. So the worst a flood
// can cost is the cap, about a third of the allowance in a month of doing nothing else,
// instead of all of it in an afternoon. A capped day is itself the signal: either the
// connector got popular or somebody leaned on it.
//
// One hash per month (wce:mcp:usage:2026-10), fields "<day of month>|<count name>", kept
// 400 days. If the store is not set up, or is slow or down, nothing is counted and the
// answer goes out as normal: a write waits 700 ms at most, and after a failure the log
// leaves the store alone for a minute.
//
// Not a function itself: Vercel skips api files that start with an underscore.

const NS = 'wce:mcp:usage'
const FIRST_MONTH = '2026-10' // when the log began: nothing to read before it
const TTL_SECONDS = 400 * 24 * 60 * 60
const DAILY_CAP = 5000
const TIMEOUT_MS = 700
const PAUSE_MS = 60 * 1000
const MAX_MONTHS = 36

// KEYS[1] the month's hash. ARGV: the day's "writes" field, the hash's lifetime in seconds,
// the cap, then field/amount pairs. Returns the day's write count after this one.
const SCRIPT = `
local n = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if n > tonumber(ARGV[3]) then return n end
for i = 4, #ARGV, 2 do redis.call('HINCRBY', KEYS[1], ARGV[i], ARGV[i + 1]) end
return n
`

// Read per call, never at import, so a missing setting costs one count, not the function.
function store() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || '').replace(/\/$/, '')
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

export function dailyCap() {
  const n = Number(process.env.MCP_USAGE_DAILY_CAP)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DAILY_CAP
}

export const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const keyOf = (month) => `${NS}:${month}`

// Which AI app is connecting, from the name it gives when it says hello. A short fixed list
// on purpose: the name is whatever the caller types, and the log must not grow a field for
// every string somebody invents. Anything unrecognised is "other".
const FAMILIES = [
  ['claude', /claude|anthropic/],
  ['chatgpt', /chatgpt|openai/],
  ['gemini', /gemini/],
  ['cursor', /cursor/],
  ['copilot', /copilot/],
  ['vscode', /vs ?code|visual studio code/],
  ['windsurf', /windsurf|codeium/],
  ['inspector', /inspector/],
]
export function clientFamily(name) {
  const n = String(name ?? '').toLowerCase().slice(0, 80)
  for (const [family, re] of FAMILIES) if (re.test(n)) return family
  return 'other'
}

const EVENT = /^(?:[tec]:[a-z0-9_]{1,48}|limited)$/

let cappedDay = null // the day this copy of the function learned the cap had been reached
let pausedUntil = 0 // after a failed write, leave the store alone until then

// Forget what this copy has learned (tests).
export function resetUsage() { cappedDay = null; pausedUntil = 0 }

// Add one to each named count for today. Resolves true if it was written, false if not;
// never throws, and never takes longer than TIMEOUT_MS.
export async function count(events, now = Date.now()) {
  const names = events.filter((e) => EVENT.test(e))
  const db = store()
  if (!db || !names.length) return false
  const day = dayOf(now)
  if (cappedDay === day || now < pausedUntil) return false
  const dd = day.slice(8)
  const cap = dailyCap()
  try {
    const res = await fetch(db.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${db.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', SCRIPT, '1', keyOf(day.slice(0, 7)), `${dd}|writes`, String(TTL_SECONDS), String(cap), ...names.flatMap((e) => [`${dd}|${e}`, '1'])]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`store answered ${res.status}`)
    const body = await res.json()
    if (body.error) throw new Error(String(body.error).slice(0, 120))
    if (Number(body.result) > cap) { cappedDay = day; return false }
    return true
  } catch (err) {
    pausedUntil = now + PAUSE_MS
    console.error('[mcp usage] not counted:', err?.message || err)
    return false
  }
}

// ---- reading ---------------------------------------------------------------------------

const monthsBetween = (first, last) => {
  const out = []
  let [y, m] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  while ((y < ly || (y === ly && m <= lm)) && out.length < MAX_MONTHS) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

// Upstash returns a hash as a flat [field, value, ...] array or as an object, by version.
const toHash = (r) => {
  if (!r) return {}
  if (!Array.isArray(r)) return r
  const out = {}
  for (let i = 0; i < r.length; i += 2) out[r[i]] = r[i + 1]
  return out
}

// Turn the stored months into what the page shows. `months` is { '2026-10': hash, ... }.
// Pure, so it can be tested without a store.
export function summarise(months, { from = null, to = null, cap = dailyCap() } = {}) {
  const days = new Map()
  const tools = new Map()
  const clients = new Map()
  const totals = { calls: 0, errors: 0, connections: 0, limited: 0, days: 0 }
  for (const [month, hash] of Object.entries(months)) {
    for (const [field, raw] of Object.entries(hash || {})) {
      const cut = field.indexOf('|')
      const date = `${month}-${field.slice(0, cut)}`
      const name = field.slice(cut + 1)
      const n = Number(raw) || 0
      if (cut !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || n <= 0) continue
      if ((from && date < from) || (to && date > to)) continue
      const d = days.get(date) || { date, calls: 0, errors: 0, connections: 0, limited: 0, capped: false }
      days.set(date, d)
      const kind = name.slice(0, 2)
      const what = name.slice(2)
      if (name === 'writes') d.capped = n > cap
      else if (name === 'limited') { d.limited += n; totals.limited += n }
      else if (kind === 't:' || kind === 'e:') {
        const t = tools.get(what) || { key: what, calls: 0, errors: 0 }
        tools.set(what, t)
        if (kind === 't:') { t.calls += n; d.calls += n; totals.calls += n } else { t.errors += n; d.errors += n; totals.errors += n }
      } else if (kind === 'c:') {
        clients.set(what, (clients.get(what) || 0) + n)
        d.connections += n
        totals.connections += n
      }
    }
  }
  const daily = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  totals.days = daily.length
  return {
    cap,
    daily,
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key)),
    clients: [...clients.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    totals,
    cappedDays: daily.filter((d) => d.capped).map((d) => d.date),
  }
}

// The log between two days (YYYY-MM-DD, either may be left out). One round trip.
export async function readUsage({ from = null, to = null, now = Date.now() } = {}) {
  const db = store()
  if (!db) throw new Error('The data store is not set up.')
  const first = from && from.slice(0, 7) > FIRST_MONTH ? from.slice(0, 7) : FIRST_MONTH
  const months = monthsBetween(first, (to || dayOf(now)).slice(0, 7))
  if (!months.length) return summarise({}, { from, to })
  const res = await fetch(`${db.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(months.map((m) => ['HGETALL', keyOf(m)])),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`The data store answered ${res.status}.`)
  const rows = await res.json()
  const failed = rows.find((r) => r && r.error)
  if (failed) throw new Error(String(failed.error).slice(0, 200))
  return summarise(Object.fromEntries(months.map((m, i) => [m, toHash(rows[i]?.result)])), { from, to })
}
