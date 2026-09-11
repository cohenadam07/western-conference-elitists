// Shared plumbing for the site's two real forms: the newsletter signup (api/newsletter.js)
// and the contact form (api/contact.js). Underscore-prefixed, so Vercel does not deploy it
// as a function of its own.
//
// Zero dependencies. Talks to Buttondown and Resend over plain fetch, and reuses the
// analytics archive's Upstash + password helpers so there is one admin password for every
// private page on the site (ANALYTICS_DASHBOARD_PASSWORD).

import { presentedSecret, timingSafeEqual } from './analytics/_lib.js'

/* ------------------------------------------------------------------ *
 * Config — read per call, never at import time, so a missing env var
 * degrades one request instead of crashing the module.
 * ------------------------------------------------------------------ */

export const kvConfigured = () =>
  Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL) &&
      (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN)
  )

export const buttondownConfigured = () => Boolean(process.env.BUTTONDOWN_API_KEY)
export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.CONTACT_NOTIFY_TO)

// Run one or many Upstash commands in one round trip. Returns plain results, in order.
// Short timeout on purpose: a hung Redis must fail fast so a signup can still go straight
// to Buttondown instead of dying with the whole function.
export async function kv(...commands) {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || '').replace(/\/$/, '')
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Upstash not configured')
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const rows = await res.json()
  const failed = rows.find((r) => r && r.error)
  if (failed) throw new Error(`Upstash command failed: ${failed.error}`)
  return rows.map((r) => r.result)
}

/* ------------------------------------------------------------------ *
 * Request helpers
 * ------------------------------------------------------------------ */

export const ipOf = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || ''

export function bodyOf(req) {
  let b
  try { b = req.body } catch { return {} } // malformed JSON: Vercel's getter throws
  if (!b || typeof b !== 'object' && typeof b !== 'string') return {}
  if (typeof b === 'string') {
    try { return JSON.parse(b) } catch { return {} }
  }
  return b
}

// Deliberately permissive — the provider does the real validation. This only stops
// obvious garbage from costing an API call.
export function cleanEmail(raw) {
  const e = String(raw ?? '').trim()
  if (e.length < 6 || e.length > 254) return null
  if (!/^[^\s@<>()[\],;:"?&=]+@[^\s@<>()[\],;:"?&=]+\.[a-z0-9-]{2,}$/i.test(e)) return null
  return e
}

// Placement tag for attribution ("home", "article", "contact", "newsletter-page", …).
export const cleanSource = (raw) => String(raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'site'

// Where the form was submitted from, without query strings (fbclid, utm, …): shorter,
// valid as a URL field, and nobody's tracking parameters get stored.
export function referrerOf(req) {
  try {
    const u = new URL(String(req.headers.referer || ''))
    return (u.origin + u.pathname).slice(0, 200)
  } catch {
    return undefined
  }
}

export function isAdmin(req) {
  const password = process.env.ANALYTICS_DASHBOARD_PASSWORD
  return Boolean(password) && timingSafeEqual(presentedSecret(req), password)
}

// Password gate for every admin endpoint. Refuses outright with no password configured,
// and locks an IP out for 10 minutes after 10 wrong guesses — checked BEFORE the password
// is compared, so a correct guess inside a lockout doesn't get through either.
// Returns true when the request may proceed; otherwise it has already responded.
export async function adminGate(req, res) {
  if (!process.env.ANALYTICS_DASHBOARD_PASSWORD) {
    res.status(500).json({ error: 'ANALYTICS_DASHBOARD_PASSWORD is not set — refusing to serve private data unprotected.' })
    return false
  }
  const ip = ipOf(req)
  const key = `wce:rl:auth:${ip}:${Math.floor(Date.now() / 600000)}`
  if (kvConfigured() && ip) {
    try {
      const [n] = await kv(['GET', key])
      if (Number(n) >= 10) { res.status(429).json({ error: 'Too many wrong passwords. Try again in 10 minutes.' }); return false }
    } catch { /* Redis down: fall through to the password check */ }
  }
  if (isAdmin(req)) return true
  if (kvConfigured() && ip) {
    try { await kv(['INCR', key], ['EXPIRE', key, 605]) } catch { /* best effort */ }
  }
  res.status(401).json({ error: 'unauthorized' })
  return false
}

// Fixed-window rate limit. Fails OPEN: if Redis is down, the form still works.
// Returns true when the caller is over the limit.
export async function overLimit(bucket, ip, limit, windowSec) {
  if (!kvConfigured() || !ip) return false
  try {
    const key = `wce:rl:${bucket}:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`
    const [n] = await kv(['INCR', key], ['EXPIRE', key, windowSec + 5])
    return Number(n) > limit
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Buttondown
 * ------------------------------------------------------------------ */

const BD_API = 'https://api.buttondown.com/v1'

export async function buttondown(method, path, body) {
  const res = await fetch(BD_API + path, {
    method,
    headers: {
      Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error page */ }
  return { status: res.status, ok: res.ok, json, text }
}

export const PUBLIC_ARCHIVE_URL = () =>
  process.env.BUTTONDOWN_USERNAME ? `https://buttondown.com/${process.env.BUTTONDOWN_USERNAME}` : null

// Classify Buttondown's answer strictly. Anything we don't positively recognise is
// `transient`: the address is held and retried, never dropped. Losing a real reader's
// signup to an error code we didn't anticipate is the one outcome this must not have.
const DUPLICATE_CODES = new Set(['email_already_exists', 'subscriber_already_exists'])
const REJECTED_CODES = new Set(['email_blocked', 'ip_address_spammy', 'subscriber_blocked', 'subscriber_suppressed', 'email_domain_blocked'])
const SUBSCRIBED_TYPES = new Set(['regular', 'premium', 'gifted', 'trialed', 'churning', 'past_due', 'unpaid', 'paused'])
const DEAD_TYPES = new Set(['spammy', 'removed', 'undeliverable', 'complained', 'blocked', 'disabled'])

/**
 * Put one address on the list. Never throws.
 *
 * Returns { outcome, … } where outcome is one of:
 *   confirm       new subscriber, Buttondown sent the double-opt-in email
 *   subscribed    new subscriber, no confirmation needed (double opt-in off)
 *   resent        signed up before but never confirmed — confirmation re-sent
 *   unconfirmed   signed up before, never confirmed, and a reminder already went out today
 *   existing      already a confirmed subscriber
 *   unsubscribed  previously unsubscribed; the API cannot re-add them (their call)
 *   invalid       Buttondown says the address is bad
 *   rejected      Buttondown refused it (firewall, blocked address, …)
 *   transient     anything else — outage, rate limit, bad key, unknown error. Retry later.
 */
export async function subscribeToButtondown({ email, source, ip, referrer }) {
  try {
    const created = await buttondown('POST', '/subscribers', {
      email_address: email,
      referrer_url: referrer || undefined,
      utm_source: 'wcehoops.com',
      utm_medium: 'site-form',
      utm_campaign: source,
      ip_address: ip || undefined,
    })
    const code = created.json?.code

    if (created.status === 201 || created.status === 200) {
      return { outcome: created.json?.type === 'regular' ? 'subscribed' : 'confirm' }
    }

    if (created.status === 409 || DUPLICATE_CODES.has(code)) {
      const found = await buttondown('GET', `/subscribers/${encodeURIComponent(email)}`)
      if (!found.ok) return { outcome: 'existing' } // Buttondown already told us it exists
      const type = found.json?.type
      if (type === 'unactivated') return await remind(email)
      if (SUBSCRIBED_TYPES.has(type)) return { outcome: 'existing' }
      if (type === 'unsubscribed') return { outcome: 'unsubscribed' }
      if (DEAD_TYPES.has(type)) return { outcome: 'rejected', detail: `subscriber type ${type}` }
      return { outcome: 'existing' }
    }

    if (code === 'email_invalid') return { outcome: 'invalid' }
    if (REJECTED_CODES.has(code)) return { outcome: 'rejected', detail: code }

    return { outcome: 'transient', detail: `buttondown ${created.status}${code ? ` ${code}` : ''}: ${created.json?.detail || created.text.slice(0, 160)}` }
  } catch (e) {
    return { outcome: 'transient', detail: `buttondown unreachable: ${e.message || e}` }
  }
}

// Re-send the confirmation email — at most once a day per address, so nobody can use the
// form to flood a stranger's inbox with "please confirm" emails.
async function remind(email) {
  if (kvConfigured()) {
    try {
      const [ok] = await kv(['SET', `wce:nl:remind:${email.toLowerCase()}`, '1', 'NX', 'EX', 86400])
      if (ok !== 'OK') return { outcome: 'unconfirmed' }
    } catch { /* Redis down: allow the reminder */ }
  }
  const r = await buttondown('POST', `/subscribers/${encodeURIComponent(email)}/send-reminder`)
  return { outcome: r.ok ? 'resent' : 'unconfirmed' }
}

/* ------------------------------------------------------------------ *
 * Pending-signup queue — a safety net, not a list.
 *
 * When Buttondown can't take an address right now (no key yet, outage, rate limit),
 * the address waits here until the admin page pushes it. One hash, keyed by the
 * lowercased address, so re-submits don't pile up duplicates.
 * ------------------------------------------------------------------ */

export const K_PENDING = 'wce:nl:pending'

// Deliberately does not keep the IP address: the queue has no expiry, so it holds only
// what's needed to finish the signup later.
export async function queueSignup({ email, source, referrer, reason }) {
  if (!kvConfigured()) return false
  try {
    await kv(['HSET', K_PENDING, email.toLowerCase(), JSON.stringify({ email, source, referrer, reason, ts: Date.now() })])
    return true
  } catch {
    return false
  }
}

export async function listPending() {
  const [flat] = await kv(['HGETALL', K_PENDING])
  const out = []
  const pairs = Array.isArray(flat) ? flat : Object.entries(flat || {}).flat()
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    try { out.push(JSON.parse(pairs[i + 1])) } catch { /* skip corrupt row */ }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/* ------------------------------------------------------------------ *
 * Resend — optional notification email for contact-form messages.
 * Without a verified domain, Resend only delivers from onboarding@resend.dev to the
 * address the Resend account was created with — which is exactly the use here.
 * ------------------------------------------------------------------ */

export async function notifyByEmail({ subject, text, replyTo }) {
  if (!resendConfigured()) return { sent: false, reason: 'not configured' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CONTACT_NOTIFY_FROM || 'WCE Contact Form <onboarding@resend.dev>',
        to: process.env.CONTACT_NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: replyTo,
        subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
        text,
      }),
      signal: AbortSignal.timeout(6000),
    })
    return res.ok ? { sent: true } : { sent: false, reason: `resend ${res.status}: ${(await res.text()).slice(0, 160)}` }
  } catch (e) {
    return { sent: false, reason: `resend unreachable: ${e.message || e}` }
  }
}
