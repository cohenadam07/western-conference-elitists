// api/_core.js — what every section of the AI connector (api/mcp.js) shares: loading the
// small data files the build writes under /savant-api/, matching names the way people type
// them, and the handful of formatting helpers every answer uses.
//
// A section (api/_basketball.js, api/_football.js, ...) owns its own tools and its own
// wording. It comes here for three things:
//
//   makeLoader(base)   fetch + cache for one section's files
//   prepare / rank     name search that ignores accents, punctuation and small typos
//   SavantError        an error whose message is written for the person asking
//
// THE LOADER
// Files come off the live site's CDN rather than out of the function bundle. That keeps the
// function small and means a data push reaches the connector with no redeploy of its own.
// Parsed files are held in memory for ten minutes per warm instance; if a refresh fails,
// the last good copy is served rather than an error.
//
// Not a function itself: Vercel skips api files that start with an underscore.

export const SITE = 'https://wcehoops.com'

const ORIGIN = () => (process.env.SAVANT_API_ORIGIN || SITE).replace(/\/+$/, '')
const SCHEMA = 1
const TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

// Every tool here only looks things up.
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

// An error whose message is meant for the person (or model) on the other end: it says what
// went wrong and what to try. Anything else that throws is a bug and is reported blandly.
export class SavantError extends Error {}

// ---- loading -------------------------------------------------------------------------

const loaders = new Set()

// A loader for one section's files, e.g. makeLoader('savant-api/basketball/v1').
//   load(path)  -> the parsed file, from memory when fresh
//   clear()     -> forget everything (tests)
// `what` names the data in the error a caller sees when it cannot be loaded.
// `maxCached` bounds memory: the oldest file is dropped past it.
export function makeLoader(base, { what = 'Savant', maxCached = 16 } = {}) {
  const cache = new Map() // path -> { at, value } | { at, value, pending }

  async function fetchJson(path) {
    const res = await fetch(`${ORIGIN()}/${base}/${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    // A missing file falls through to the site's catch-all and comes back as HTML with a 200,
    // so "it parsed as JSON and carries our schema" is the only real success signal.
    const body = JSON.parse(await res.text())
    if (!body || body.schema !== SCHEMA) throw new Error(`${path}: unexpected schema`)
    return body
  }

  async function load(path) {
    const now = Date.now()
    const hit = cache.get(path)
    if (hit && hit.pending) return hit.pending
    if (hit && now - hit.at < TTL_MS) return hit.value

    const pending = fetchJson(path).then(
      (value) => {
        cache.set(path, { at: Date.now(), value })
        if (cache.size > maxCached) {
          const oldest = [...cache.entries()].filter(([, v]) => !v.pending).sort((a, b) => a[1].at - b[1].at)[0]
          if (oldest && oldest[0] !== path) cache.delete(oldest[0])
        }
        return value
      },
      (err) => {
        console.error(`[savant] ${base}/${path} failed:`, err.message)
        if (hit && hit.value) {
          // Stale beats down. Hold it for a minute so an outage is not re-tried on every call.
          cache.set(path, { at: Date.now() - TTL_MS + 60 * 1000, value: hit.value })
          return hit.value
        }
        cache.delete(path)
        throw new SavantError(`${what} data could not be loaded right now. Try again in a minute.`)
      },
    )
    cache.set(path, { at: hit ? hit.at : now, value: hit && hit.value, pending })
    return pending
  }

  const loader = { load, clear: () => cache.clear() }
  loaders.add(loader)
  return loader
}

// Forget every section's files (tests).
export function clearCache() { for (const l of loaders) l.clear() }

// ---- names ---------------------------------------------------------------------------

// "Day'Ron Sharpe" -> "dayron sharpe", "P.J. Washington" -> "pj washington",
// "Karl-Anthony Towns" -> "karl anthony towns", "Nikola Jokić" -> "nikola jokic"
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

// "jaren jackson jr" -> "jaren jackson"; a name with no suffix is returned as it is.
const SUFFIX = /\s(jr|sr|ii|iii|iv|v)$/
const base = (n) => n.replace(SUFFIX, '')

// How well a prepared name answers a query. 0 means not at all.
//   100  the name, exactly
//    95  the name without its Jr./Sr./III (see below)
//    75  every word of the query is a word of the name
//    60  every word of the query starts a word of the name
//    50  the query appears somewhere in the name
//    30  every word is within a letter or two of a word in the name (typos)
function matchScore(q, qTokens, row) {
  if (row.n === q) return 100
  // "Jaren Jackson" is also a fair way to ask for Jaren Jackson Jr. Scored just under an
  // exact match so that both men come back and the caller chooses, rather than the father
  // winning on spelling alone.
  if (!SUFFIX.test(q) && base(row.n) === q) return 95
  if (qTokens.every((t) => row.tokens.includes(t))) return 75
  if (qTokens.every((t) => row.tokens.some((n) => n.startsWith(t)))) return 60
  if (row.n.includes(q)) return 50
  const close = qTokens.every((t) => {
    const max = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0
    return row.tokens.some((n) => (max ? editDistance(t, n, max) <= max : n === t))
  })
  return close ? 30 : 0
}

// Rows ready for rank(): each gains `n` (its normalised name) and `tokens`.
export function prepare(rows, nameOf = (r) => r.name) {
  return rows.map((r) => { const n = norm(nameOf(r)); return { ...r, n, tokens: n.split(' ') } })
}

// Prepared rows that answer `query`, best first: [{ row, score }]. `tiebreak(a, b)` orders
// rows whose scores are equal (the more recent, the more prominent — the section decides).
export function rank(rows, query, tiebreak = () => 0) {
  const q = norm(query)
  const qTokens = q.split(' ').filter(Boolean)
  if (!qTokens.length) return []
  const out = []
  for (const row of rows) {
    const score = matchScore(q, qTokens, row)
    if (score) out.push({ row, score })
  }
  out.sort((a, b) => b.score - a.score || tiebreak(a.row, b.row) || a.row.name.localeCompare(b.row.name))
  return out
}

// The rows a name could mean, from rank()'s output: exact matches and their Jr./Sr.
// namesakes are one tier, since any of them could be meant; otherwise everything tied for
// the best score.
export function topTier(ranked) {
  if (!ranked.length) return []
  const top = ranked[0].score
  return ranked.filter((r) => (top >= 95 ? r.score >= 95 : r.score === top)).map((r) => r.row)
}

// ---- small formatting helpers ----------------------------------------------------------

export function ordinal(n) {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

export const miss = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))
export const signed = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)
export const thousands = (n) => Number(n).toLocaleString('en-US')
export const tidy = (n) => (n == null ? null : Math.round(n * 10) / 10)
export const day = (iso) => (iso ? String(iso).slice(0, 10) : 'unknown')
