// api/_keys.js — free connector keys. A key gives a fan their own address for the AI
// connector (https://wcehoops.com/mcp/<key>), so the site knows who its connector users are
// and can reach them later. Keys are free and optional: the public address
// (https://wcehoops.com/api/mcp) keeps working for everyone, forever.
//
// WHAT A KEY DOES
// - Its own rate-limit bucket. Without a key, everyone who arrives from Claude's servers
//   shares one bucket per network address; with one, the caller is counted on their own.
// - Its tool calls are counted per key per day, in the same write the usage log already makes
//   (api/_usage.js), so a keyed call costs the store nothing extra.
// - Whoever holds a key from before WCE Pro launches is a founding member (FOUNDING below).
// A key opens nothing else. The connector is read-only with or without one.
//
// WHAT IS STORED (Upstash, the site's store)
//   wce:mcp:keys           hash  <id> -> { h, email, created, newsletter, source }
//   wce:mcp:keys:pending   hash  <id> -> { email, key, ts }   a key waiting to be emailed
// The key itself is never stored once it has been emailed: only its SHA-256 (`h`). The id is
// the first 12 hex characters of that hash; it is what the usage log counts under (k:<id>)
// and what the private /analytics page uses to put an email next to a count. A key waiting
// in `pending` (because mail was not set up, or Resend was down) is held as written until it
// is sent, then removed.
//
// Losing a key is fine: asking again with the same email sends a new one, and the old one
// keeps working. Every key an email has asked for is that same person on /analytics.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readUsage } from './_usage.js'

export const K_KEYS = 'wce:mcp:keys'
export const K_PENDING_KEYS = 'wce:mcp:keys:pending'

// The promise made to everyone who gets a key before WCE Pro exists, in the words the
// homepage uses (one copy, in src/data/connector.js).
export { FOUNDING } from '../src/data/connector.js'

export const KEY_ADDRESS = (key) => `https://wcehoops.com/mcp/${key}`

const KEY_RE = /^wce_[a-f0-9]{32}$/
const ID_RE = /^[a-f0-9]{12}$/
const TIMEOUT_MS = 700
const GOOD_FOR_MS = 10 * 60 * 1000 // how long this copy trusts a key it has looked up
const BAD_FOR_MS = 60 * 1000 // ...and how long it remembers one that does not exist
const MAX_CACHED = 5000

export const isKey = (s) => typeof s === 'string' && KEY_RE.test(s)
export const isKeyId = (s) => typeof s === 'string' && ID_RE.test(s)
export const hashOf = (key) => createHash('sha256').update(key).digest('hex')
export const idOf = (key) => hashOf(key).slice(0, 12)
export const newKey = () => `wce_${randomBytes(16).toString('hex')}`

// Read per call, never at import, so a missing setting costs one request, not the function.
function store() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || '').replace(/\/$/, '')
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

async function send(db, command, timeout = TIMEOUT_MS) {
  const res = await fetch(db.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command.map(String)),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`store answered ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(String(body.error).slice(0, 120))
  return body.result
}

// ---- checking a key (api/mcp.js) -------------------------------------------------------

const cache = new Map() // hash -> { id, until } for a real key, { id: null, until } for none

// Forget what this copy has learned (tests).
export function resetKeys() { cache.clear() }

// What the connector should make of the key in its address.
//   { state: 'none' }                no key in the address
//   { state: 'valid', id }           a real key
//   { state: 'unknown' }             shaped like a key, but there is no such key
//   { state: 'unchecked' }           the store could not be asked; treated as no key
// Never throws, and never waits longer than TIMEOUT_MS.
export async function checkKey(raw, now = Date.now()) {
  if (raw == null || raw === '') return { state: 'none' }
  const key = String(raw).trim().toLowerCase()
  if (!isKey(key)) return { state: 'unknown' }
  const h = hashOf(key)
  const seen = cache.get(h)
  if (seen && seen.until > now) return seen.id ? { state: 'valid', id: seen.id } : { state: 'unknown' }
  const db = store()
  if (!db) return { state: 'unchecked' }
  try {
    const found = await send(db, ['HGET', K_KEYS, h.slice(0, 12)])
    let rec = null
    try { rec = found ? JSON.parse(found) : null } catch { rec = null }
    const ok = Boolean(rec && typeof rec.h === 'string' && rec.h.length === h.length &&
      timingSafeEqual(Buffer.from(rec.h), Buffer.from(h)))
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
    cache.set(h, ok ? { id: h.slice(0, 12), until: now + GOOD_FOR_MS } : { id: null, until: now + BAD_FOR_MS })
    return ok ? { state: 'valid', id: h.slice(0, 12) } : { state: 'unknown' }
  } catch (err) {
    console.error('[mcp keys] could not check a key:', err?.message || err)
    return { state: 'unchecked' }
  }
}

// ---- making a key (api/newsletter.js) --------------------------------------------------

// Make a key for an email and store it. Returns { key, id }. Throws if the store is not set
// up or does not answer: without the store there is no key.
export async function createKey({ email, newsletter = false, source = 'site', now = Date.now() }) {
  const db = store()
  if (!db) throw new Error('The data store is not set up.')
  for (let tries = 0; tries < 3; tries++) {
    const key = newKey()
    const h = hashOf(key)
    const id = h.slice(0, 12)
    const rec = { h, email: String(email).toLowerCase(), created: new Date(now).toISOString(), newsletter: Boolean(newsletter), source }
    // HSETNX: two keys with the same 12-character id would be counted as one person, so a
    // clash (about one in 280 trillion) draws again rather than overwriting.
    if (Number(await send(db, ['HSETNX', K_KEYS, id, JSON.stringify(rec)], 3000)) === 1) return { key, id }
  }
  throw new Error('Could not draw an unused key.')
}

// Hold a key that could not be emailed yet. The only place a key is ever stored as written.
export async function holdKey({ id, email, key, now = Date.now() }) {
  const db = store()
  if (!db) return false
  try {
    await send(db, ['HSET', K_PENDING_KEYS, id, JSON.stringify({ email, key, ts: now })], 3000)
    return true
  } catch (err) {
    console.error('[mcp keys] could not hold a key:', err?.message || err)
    return false
  }
}

export async function pendingKeys() {
  const db = store()
  if (!db) return []
  const flat = await send(db, ['HGETALL', K_PENDING_KEYS], 3000)
  const pairs = Array.isArray(flat) ? flat : Object.entries(flat || {}).flat()
  const out = []
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    try { out.push({ id: pairs[i], ...JSON.parse(pairs[i + 1]) }) } catch { /* skip a corrupt row */ }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

export async function releaseKey(id) {
  const db = store()
  if (db) await send(db, ['HDEL', K_PENDING_KEYS, id], 3000)
}

// ---- reading for /analytics -------------------------------------------------------------

// Every key, as { id, email, created, newsletter }. The hash is left out: the page has no use
// for it.
export async function readKeys() {
  const db = store()
  if (!db) return []
  const flat = await send(db, ['HGETALL', K_KEYS], 5000)
  const pairs = Array.isArray(flat) ? flat : Object.entries(flat || {}).flat()
  const out = []
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    try {
      const r = JSON.parse(pairs[i + 1])
      out.push({ id: pairs[i], email: r.email, created: r.created, newsletter: Boolean(r.newsletter) })
    } catch { /* skip a corrupt row */ }
  }
  return out
}

// Put people next to the usage log's per-key counts. `perKey` is the usage summary's
// { <id>: { calls, days: Set|[] , last } }. People, not keys: an email that asked for two
// keys is one person. Pure, so it can be tested without a store.
export function summariseKeys(keys, perKey, { now = Date.now(), top = 25 } = {}) {
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const people = new Map()
  for (const k of keys) {
    const p = people.get(k.email) || { email: k.email, keys: 0, created: k.created, newsletter: false, calls: 0, days: new Set(), last: null }
    people.set(k.email, p)
    p.keys++
    if (k.created < p.created) p.created = k.created
    p.newsletter = p.newsletter || k.newsletter
    const use = perKey[k.id]
    if (!use) continue
    p.calls += use.calls
    for (const d of use.days) p.days.add(d)
    if (use.last && (!p.last || use.last > p.last)) p.last = use.last
  }
  const all = [...people.values()]
  const known = new Set(keys.map((k) => k.id))
  const keyedCalls = Object.entries(perKey).reduce((n, [id, u]) => n + (known.has(id) ? u.calls : 0), 0)
  return {
    people: all.length,
    keys: keys.length,
    active30: all.filter((p) => p.last && p.last >= since).length,
    keyedCalls,
    top: all
      .filter((p) => p.calls > 0)
      .sort((a, b) => b.calls - a.calls || a.email.localeCompare(b.email))
      .slice(0, top)
      .map((p) => ({ email: p.email, calls: p.calls, days: p.days.size, last: p.last, since: p.created.slice(0, 10), keys: p.keys, newsletter: p.newsletter })),
    newest: all
      .sort((a, b) => (a.created < b.created ? 1 : -1))
      .slice(0, 10)
      .map((p) => ({ email: p.email, since: p.created.slice(0, 10), calls: p.calls })),
  }
}

// What /analytics shows about keys: every key, put next to every day of the usage log, so
// "active in the last 30 days" means the same thing whatever range the page is showing.
export async function readKeySummary({ now = Date.now() } = {}) {
  const [keys, usage] = await Promise.all([readKeys(), readUsage({ now })])
  return summariseKeys(keys, usage.perKey || {}, { now })
}
