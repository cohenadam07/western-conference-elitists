// The Weekly Board — newsletter endpoint. Buttondown is the list; this is the door.
//
//   POST /api/newsletter                    { email, source, website }   → subscribe
//   GET  /api/newsletter                                                  → public archive of sent issues
//   GET  /api/newsletter?admin=1            (x-analytics-key)             → list health for /inbox
//   POST /api/newsletter?admin=flush        (x-analytics-key)             → push queued signups to Buttondown
//   POST /api/newsletter?action=key         { email, newsletter, source, website } → email a connector key
//   POST /api/newsletter?admin=flush-keys   (x-analytics-key)             → email keys that were held
//
// Connector keys (api/_keys.js) live here, not in a function of their own: the site is at
// 11 of the 12 functions the Hobby plan allows, and a key sign-up is the same kind of door,
// an email address and a honeypot, with the newsletter as an optional tick-box.
//
// Env: BUTTONDOWN_API_KEY (required for real signups), BUTTONDOWN_USERNAME (optional —
// only used to link people to the hosted archive), plus the Upstash vars already on the
// project. Degrades rather than breaks: with no Buttondown key, or during a Buttondown
// outage, addresses are held in Upstash (see _forms.js) and nobody's signup is lost.

import { createHash } from 'node:crypto'
import { FOUNDING, KEY_ADDRESS, createKey, holdKey, pendingKeys, releaseKey } from './_keys.js'
import {
  PUBLIC_ARCHIVE_URL,
  K_PENDING,
  adminGate,
  bodyOf,
  buttondown,
  buttondownConfigured,
  cleanEmail,
  cleanSource,
  ipOf,
  kv,
  keyMailConfigured,
  kvConfigured,
  listPending,
  overLimit,
  queueSignup,
  referrerOf,
  resendConfigured,
  sendKeyMail,
  subscribeToButtondown,
} from './_forms.js'

export const config = { maxDuration: 30 }

// What the browser gets back for each outcome. `ok` drives the success panel; the copy
// itself lives in the component so it can match the page it sits on.
const REPLY = {
  confirm: [200, { ok: true, status: 'confirm' }],
  subscribed: [200, { ok: true, status: 'subscribed' }],
  resent: [200, { ok: true, status: 'resent' }],
  unconfirmed: [200, { ok: true, status: 'unconfirmed' }],
  existing: [200, { ok: true, status: 'existing' }],
  queued: [200, { ok: true, status: 'queued' }],
  unsubscribed: [409, { ok: false, error: 'unsubscribed' }],
  invalid: [400, { ok: false, error: 'invalid' }],
  rejected: [400, { ok: false, error: 'rejected' }],
}

async function subscribe(req, res) {
  const b = bodyOf(req)

  // Honeypot: a field real people never see. Bots that fill it get a cheerful lie.
  // Logged, so a browser autofill that trips it by mistake would show up in Vercel logs.
  if (b.website) {
    console.warn('[newsletter] honeypot tripped:', JSON.stringify({ source: b.source, len: String(b.website).length }))
    return res.status(200).json({ ok: true, status: 'confirm' })
  }

  const email = cleanEmail(b.email)
  if (!email) return res.status(400).json({ ok: false, error: 'invalid' })

  const ip = ipOf(req)
  if (await overLimit('nl', ip, 6, 600)) return res.status(429).json({ ok: false, error: 'rate' })

  const signup = {
    email,
    source: cleanSource(b.source),
    ip,
    referrer: referrerOf(req),
  }

  if (buttondownConfigured()) {
    const r = await subscribeToButtondown(signup)
    if (r.outcome !== 'transient') {
      const [code, json] = REPLY[r.outcome]
      const out = { ...json }
      if (r.outcome === 'unsubscribed' && PUBLIC_ARCHIVE_URL()) out.resubscribeUrl = PUBLIC_ARCHIVE_URL()
      return res.status(code).json(out)
    }
    console.error('[newsletter] holding signup after transient failure:', r.detail)
    signup.reason = r.detail
  } else {
    signup.reason = 'BUTTONDOWN_API_KEY not set'
  }

  // Buttondown couldn't take it right now — hold it so it isn't lost.
  if (await queueSignup(signup)) return res.status(200).json(REPLY.queued[1])
  return res.status(503).json({ ok: false, error: 'unavailable' })
}

// A connector key, by email. The key is created first, then mailed; if mail is not set up
// yet, or Resend is down, the key is held and goes out from /inbox later, so a sign-up is
// never lost. The newsletter tick-box goes through the same door as a normal signup,
// Buttondown's confirmation email included, and never decides whether the key works.
async function getKey(req, res) {
  const b = bodyOf(req)
  if (b.website) {
    console.warn('[keys] honeypot tripped:', JSON.stringify({ source: b.source, len: String(b.website).length }))
    return res.status(200).json({ ok: true, status: 'sent' })
  }
  const email = cleanEmail(b.email)
  if (!email) return res.status(400).json({ ok: false, error: 'invalid' })

  const ip = ipOf(req)
  if (await overLimit('key', ip, 5, 3600)) return res.status(429).json({ ok: false, error: 'rate' })
  // At most three keys a day to one inbox, so nobody can use the form to flood someone
  // else's. Counted under a hash of the address, not the address.
  const inbox = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)
  if (await overLimit('keymail', inbox, 3, 86400)) return res.status(429).json({ ok: false, error: 'rate' })

  if (!kvConfigured()) return res.status(503).json({ ok: false, error: 'unavailable' })
  const source = cleanSource(b.source || 'connector')
  const newsletter = b.newsletter === true || b.newsletter === 'true' || b.newsletter === 'on'
  let made
  try {
    made = await createKey({ email, newsletter, source })
  } catch (e) {
    console.error('[keys] could not make a key:', e.message || e)
    return res.status(503).json({ ok: false, error: 'unavailable' })
  }

  const jobs = [sendKeyMail({ email, key: made.key, address: KEY_ADDRESS(made.key), founding: FOUNDING })]
  if (newsletter && buttondownConfigured()) {
    const signup = { email, source: 'connector-key', ip, referrer: referrerOf(req) }
    jobs.push(
      subscribeToButtondown(signup)
        .then((r) => (r.outcome === 'transient' ? queueSignup({ ...signup, reason: r.detail }) : null))
        .catch((e) => console.error('[keys] newsletter tick-box failed:', e.message || e))
    )
  } else if (newsletter) {
    jobs.push(queueSignup({ email, source: 'connector-key', referrer: referrerOf(req), reason: 'BUTTONDOWN_API_KEY not set' }).catch(() => {}))
  }
  const [mail] = await Promise.all(jobs)
  if (mail.sent) return res.status(200).json({ ok: true, status: 'sent' })
  if (mail.reason !== 'not configured') console.error('[keys] holding a key after a failed send:', mail.reason)
  if (await holdKey({ id: made.id, email, key: made.key })) return res.status(200).json({ ok: true, status: 'queued' })
  return res.status(503).json({ ok: false, error: 'unavailable' })
}

// Email every held key. Same shape as flush() above: a time budget, and it stops after three
// failures in a row.
async function flushKeys(req, res) {
  if (!keyMailConfigured()) return res.status(400).json({ error: 'Key emails are not set up yet: RESEND_API_KEY and KEYS_MAIL_FROM are both needed, with wcehoops.com verified in Resend.' })
  if (!kvConfigured()) return res.status(400).json({ error: 'Upstash is not configured.' })
  const deadline = Date.now() + 18000
  const held = await pendingKeys()
  const tally = { sent: 0, stillWaiting: 0 }
  let streak = 0
  for (const k of held) {
    if (Date.now() > deadline || streak >= 3) break
    const r = await sendKeyMail({ email: k.email, key: k.key, address: KEY_ADDRESS(k.key), founding: FOUNDING })
    if (!r.sent) { tally.stillWaiting++; tally.error = r.reason; streak++; continue }
    streak = 0
    await releaseKey(k.id)
    tally.sent++
  }
  return res.status(200).json({ ok: true, ...tally, remaining: held.length - tally.sent })
}

// Sent, public issues, newest first. Cached at the edge — the archive changes weekly.
async function archive(req, res) {
  if (!buttondownConfigured()) return res.status(200).json({ configured: false, issues: [], archiveUrl: null })
  try {
    const r = await buttondown('GET', '/emails?status=sent&ordering=-publish_date')
    if (!r.ok) throw new Error(`buttondown ${r.status}`)
    const issues = (r.json?.results || [])
      // Allow-list, not block-list: an email type we don't know about stays private.
      .filter((e) => e.status === 'sent' && ['public', 'archival', undefined, null].includes(e.email_type) && e.archival_mode !== 'disabled')
      .slice(0, 24)
      .map((e) => ({
        id: e.id,
        subject: e.subject,
        description: e.description || '',
        date: e.publish_date || e.creation_date,
        url: e.absolute_url,
      }))
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400')
    return res.status(200).json({ configured: true, issues, archiveUrl: PUBLIC_ARCHIVE_URL() })
  } catch (e) {
    console.error('[newsletter] archive failed:', e.message || e)
    return res.status(200).json({ configured: true, issues: [], error: 'unavailable', archiveUrl: PUBLIC_ARCHIVE_URL() })
  }
}

// ── admin ──────────────────────────────────────────────────────────────────

async function countOf(type) {
  const r = await buttondown('GET', `/subscribers?type=${type}&page_size=1`)
  return r.ok ? Number(r.json?.count) || 0 : null
}

async function health(req, res) {
  const out = {
    config: {
      buttondown: buttondownConfigured(),
      kv: kvConfigured(),
      notifications: resendConfigured(),
      keyMail: keyMailConfigured(),
      archiveUrl: PUBLIC_ARCHIVE_URL(),
    },
    subscribers: null,
    pending: [],
    // Connector keys waiting to be emailed: addresses and when, never the keys themselves.
    pendingKeys: [],
  }
  const jobs = []
  if (out.config.buttondown) {
    jobs.push(
      Promise.all([countOf('regular'), countOf('unactivated')])
        .then(([confirmed, unconfirmed]) => { out.subscribers = { confirmed, unconfirmed } })
        .catch(() => { out.subscribers = null })
    )
  }
  if (out.config.kv) jobs.push(listPending().then((p) => { out.pending = p }).catch(() => {}))
  if (out.config.kv) jobs.push(pendingKeys().then((p) => { out.pendingKeys = p.map(({ email, ts }) => ({ email, ts })) }).catch(() => {}))
  await Promise.all(jobs)
  return res.status(200).json(out)
}

// Push queued signups through. Bounded by a time budget (well inside maxDuration), and it
// backs off after three failures in a row: if Buttondown is struggling, hammering it with
// the rest of the queue only makes that worse. The page calls again while progress is made.
async function flush(req, res) {
  if (!buttondownConfigured()) return res.status(400).json({ error: 'BUTTONDOWN_API_KEY is not set, so there is nowhere to push to yet.' })
  if (!kvConfigured()) return res.status(400).json({ error: 'Upstash is not configured.' })
  const deadline = Date.now() + 18000
  const pending = await listPending()
  const tally = { added: 0, existing: 0, dropped: 0, stillWaiting: 0 }
  let done = 0
  let streak = 0 // consecutive transient failures
  for (const s of pending) {
    if (Date.now() > deadline || streak >= 3) break
    const r = await subscribeToButtondown(s)
    if (r.outcome === 'transient') {
      // Skip it and keep going — one odd address shouldn't block the queue behind it —
      // but three failures in a row means Buttondown itself is struggling: stop.
      tally.stillWaiting++
      tally.error = r.detail
      streak++
      continue
    }
    streak = 0
    if (['confirm', 'subscribed', 'resent', 'unconfirmed'].includes(r.outcome)) tally.added++
    else if (r.outcome === 'existing') tally.existing++
    else tally.dropped++ // invalid / rejected / unsubscribed — Buttondown's definite answer
    await kv(['HDEL', K_PENDING, s.email.toLowerCase()])
    done++
  }
  return res.status(200).json({ ok: true, ...tally, remaining: pending.length - done })
}

export default async function handler(req, res) {
  const admin = String(req.query?.admin || '')
  try {
    if (admin) {
      if (!(await adminGate(req, res))) return
      if (req.method === 'GET') return await health(req, res)
      if (req.method === 'POST' && admin === 'flush') return await flush(req, res)
      if (req.method === 'POST' && admin === 'flush-keys') return await flushKeys(req, res)
      return res.status(405).json({ error: 'method not allowed' })
    }
    if (req.method === 'POST' && String(req.query?.action || '') === 'key') return await getKey(req, res)
    if (req.method === 'POST') return await subscribe(req, res)
    if (req.method === 'GET') return await archive(req, res)
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[newsletter] unhandled:', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
}
