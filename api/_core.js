// api/_core.js — what every section of the AI connector (api/mcp.js) shares: loading the
// small data files the build writes under /savant-api/, matching names the way people type
// them, and the handful of formatting helpers every answer uses.
//
// A section (api/_basketball.js, api/_football.js, ...) owns its own tools and its own
// wording. It comes here for three things:
//
//   makeLoader(base)   fetch + cache for one section's files
//   prepare / rank     name search that ignores accents, punctuation and small typos
//   findStat           a stat by the name a person gives it ("true shooting", "ts")
//   ranked             a leaderboard's order, with ties sharing a place
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

// Where the data files (and the site's own read-only endpoints) are fetched from. The live
// site, unless a test or a local run points somewhere else.
export const origin = () => (process.env.SAVANT_API_ORIGIN || SITE).replace(/\/+$/, '')
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
let clock = 0 // a counter, not a time: orders reads for eviction

// A loader for one section's files, e.g. makeLoader('savant-api/basketball/v1').
//   load(path)  -> the parsed file, from memory when fresh
//   clear()     -> forget everything (tests)
// `what` names the data in the error a caller sees when it cannot be loaded.
// `maxCached` bounds memory: past it, the file that has gone longest without being read is
// dropped. By last read, not by age, so a section's glossary and index (read on every call)
// outlive the bulk files around them.
export function makeLoader(base, { what = 'Savant', maxCached = 16 } = {}) {
  const cache = new Map() // path -> { at, used, value } | { at, used, value, pending }

  async function fetchJson(path) {
    const res = await fetch(`${origin()}/${base}/${path}`, {
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
    if (hit) hit.used = ++clock
    if (hit && hit.pending) return hit.pending
    if (hit && now - hit.at < TTL_MS) return hit.value

    const pending = fetchJson(path).then(
      (value) => {
        cache.set(path, { at: Date.now(), used: ++clock, value })
        while (cache.size > maxCached) {
          const idle = [...cache.entries()].filter(([k, v]) => !v.pending && k !== path).sort((a, b) => a[1].used - b[1].used)[0]
          if (!idle) break
          cache.delete(idle[0])
        }
        return value
      },
      (err) => {
        console.error(`[savant] ${base}/${path} failed:`, err.message)
        if (hit && hit.value) {
          // Stale beats down. Hold it for a minute so an outage is not re-tried on every call.
          cache.set(path, { at: Date.now() - TTL_MS + 60 * 1000, used: ++clock, value: hit.value })
          return hit.value
        }
        cache.delete(path)
        throw new SavantError(`${what} data could not be loaded right now. Try again in a minute.`)
      },
    )
    cache.set(path, { at: hit ? hit.at : now, used: ++clock, value: hit && hit.value, pending })
    return pending
  }

  // One read that is not kept, for a question that walks many bulk files once: a career is
  // a file per season. A copy already in memory is used; otherwise the file is fetched, read
  // and let go, so a twenty-season career cannot push the index and the glossary (which
  // every call needs) out of the cache.
  async function once(path) {
    const hit = cache.get(path)
    if (hit && hit.pending) return hit.pending
    if (hit && hit.value && Date.now() - hit.at < TTL_MS) { hit.used = ++clock; return hit.value }
    try { return await fetchJson(path) } catch (err) {
      console.error(`[savant] ${base}/${path} failed:`, err.message)
      if (hit && hit.value) return hit.value
      throw new SavantError(`${what} data could not be loaded right now. Try again in a minute.`)
    }
  }

  const loader = { load, once, clear: () => cache.clear() }
  loaders.add(loader)
  return loader
}

// Run `fn` over `items`, at most `limit` at a time, keeping the order of the results.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
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

// Edits between two words, giving up past `max`. A letter added, dropped or changed is one
// edit, and so is two neighbouring letters swapped ("Ried" for "Reid").
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let before = null
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1)
      if (cur[j] < best) best = cur[j]
    }
    // A swap can still pull the next row under `max`, so only give up when the row before
    // was out of reach as well.
    if (best > max && (!before || Math.min(...prev) > max)) return max + 1
    before = prev
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
export function rank(rows, query, tiebreak = () => 0, normalise = norm) {
  const q = normalise(query)
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

// ---- stats by name ---------------------------------------------------------------------

// A stat's name the way people say it. On top of norm(): "percentage" and "per" are dropped
// (the labels write % and /, which norm() already strips), and the few spellings that differ
// between a fan and a label are brought together. "Three point percentage" and "3-point %"
// both come out as "3 point"; "points per game" and "Points / game" both as "points g".
const STAT_WORDS = [
  [/\b(percentage|percent|pct)\b/g, ' '],
  [/\bper\b/g, ' '],
  [/\bsignificant\b/g, 'sig'],
  [/\bgames?\b/g, 'g'],
  [/\bminutes?\b/g, 'min'],
  [/\bthree\b/g, '3'],
  [/\btwo\b/g, '2'],
  [/\b3 ?(pt|p|pointers?|points)\b/g, '3 point'],
  [/\b2 ?(pt|p|pointers?|points)\b/g, '2 point'],
  [/\bfree throws?\b/g, 'ft'],
  [/\bfield goals?\b/g, 'fg'],
  [/\btouchdowns?\b/g, 'td'],
  [/\byards\b/g, 'yds'],
]
export function statNorm(s) {
  let n = norm(s)
  for (const [re, to] of STAT_WORDS) n = n.replace(re, to)
  return n.replace(/\s+/g, ' ').trim()
}

// Stats ready for findStat(): each row is { key, label, ... } and gains its searchable name.
export function prepareStats(stats) {
  return stats.map((m) => { const n = statNorm(m.label); return { ...m, name: m.label, n, tokens: n.split(' ') } })
}

// The stat a caller means: its key, its label, or something close to the label. A name that
// could be several stats is not guessed at: the error lists them by key. `tool` names the
// tool that lists every stat, for the error to point at.
export function findStat(rows, input, { tool = null, what = 'stat' } = {}) {
  const raw = String(input || '').trim()
  const hint = tool ? ` ${tool} lists every stat with its key.` : ''
  if (!raw) throw new SavantError(`Give a ${what}: its key or its name.${hint}`)
  const byKey = rows.find((r) => r.key.toLowerCase() === raw.toLowerCase())
  if (byKey) return byKey
  const q = statNorm(raw)
  const exact = rows.filter((r) => r.n === q)
  if (exact.length === 1) return exact[0]
  const found = rank(rows, raw, () => 0, statNorm)
  if (!found.length) throw new SavantError(`No ${what} matches "${raw}".${hint}`)
  const best = found.filter((r) => r.score === found[0].score)
  if (best.length === 1 && found[0].score >= 60) return best[0].row
  const near = best.length > 1 ? best : found
  const list = near.slice(0, 8).map((r) => `- ${r.row.label} (key "${r.row.key}")`)
  // One loose match is a guess, and is offered as one, not acted on.
  if (near.length === 1) throw new SavantError(`No ${what} is called "${raw}". The closest is ${near[0].row.label} (key "${near[0].row.key}"): call again with that key if it is the one meant.${hint}`)
  throw new SavantError(`"${raw}" could be more than one ${what}. Call again with one of these keys:\n${list.join('\n')}`)
}

// ---- leaderboards ----------------------------------------------------------------------

// Rows in leaderboard order by `valueOf`, each with its place. Equal values share a place and
// the next one skips ahead (1, 2, 2, 4), so a tie is never passed off as a win. `lower` puts
// the smallest value first, for stats where less is better.
export function ranked(rows, valueOf, { lower = false } = {}) {
  const dir = lower ? 1 : -1
  const sorted = rows.map((row) => ({ row, value: valueOf(row) })).sort((a, b) => dir * (a.value - b.value))
  let place = 0
  return sorted.map((r, i) => {
    if (i === 0 || r.value !== sorted[i - 1].value) place = i + 1
    return { ...r, rank: place, tied: (i > 0 && sorted[i - 1].value === r.value) || (i + 1 < sorted.length && sorted[i + 1].value === r.value) }
  })
}

// The rows a leaderboard shows: the first `limit`, or with order "bottom" the last `limit`,
// worst first. A place is always counted from the top, so the bottom of a board of 178 reads
// 178, 177, 176.
export const boardSlice = (all, limit, order) => (order === 'bottom' ? all.slice(-limit).reverse() : all.slice(0, limit))

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
