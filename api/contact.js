// Contact form — messages land in Upstash and show up on the private /inbox page.
// Optionally also emails a copy (Resend), with Reply-To set to the sender, so hitting
// Reply in your mail app answers them directly.
//
//   POST /api/contact                   { name, email, reason, message, subscribe, website }
//   GET  /api/contact                   (x-analytics-key) → messages, newest first
//   POST /api/contact?action=read|unread|delete   (x-analytics-key) { id }
//
// Storage: wce:contact:msg  HASH  id → JSON message
//          wce:contact:ids  ZSET  id scored by timestamp (ordering + trimming)
//
// Either store is enough for a message to count as received. If Upstash and Resend are
// both unavailable, the sender gets an honest error instead of a fake "sent".

import {
  adminGate,
  bodyOf,
  cleanEmail,
  ipOf,
  kv,
  kvConfigured,
  notifyByEmail,
  overLimit,
  queueSignup,
  referrerOf,
  buttondownConfigured,
  subscribeToButtondown,
} from './_forms.js'

export const config = { maxDuration: 30 }

const K_MSG = 'wce:contact:msg'
const K_IDS = 'wce:contact:ids'
const KEEP = 2000

// Must match the <select> on the Contact page.
export const REASONS = [
  'General',
  'Writing / Contributor Pitch',
  'Consulting / Scouting Work',
  'Partnership / Collaboration',
  'Press / Media',
]

// Trim, cap, and drop control characters (newlines and tabs survive).
// eslint-disable-next-line no-control-regex
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

async function submit(req, res) {
  const b = bodyOf(req)
  if (b.website) { // honeypot
    console.warn('[contact] honeypot tripped')
    return res.status(200).json({ ok: true })
  }

  const name = clip(b.name, 100)
  const email = cleanEmail(b.email)
  const reason = REASONS.includes(b.reason) ? b.reason : 'General'
  const message = clip(b.message, 5000)

  const errors = {}
  if (!name) errors.name = 'required'
  if (!email) errors.email = 'invalid'
  if (message.length < 2) errors.message = 'required'
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, error: 'fields', fields: errors })

  const ip = ipOf(req)
  if (await overLimit('contact', ip, 4, 600)) return res.status(429).json({ ok: false, error: 'rate' })

  const ts = Date.now()
  const msg = {
    id: newId(),
    ts,
    name,
    email,
    reason,
    message,
    read: false,
    country: String(req.headers['x-vercel-ip-country'] || '') || undefined,
  }

  let stored = false
  if (kvConfigured()) {
    try {
      const [, , total] = await kv(['HSET', K_MSG, msg.id, JSON.stringify(msg)], ['ZADD', K_IDS, ts, msg.id], ['ZCARD', K_IDS])
      stored = true
      if (Number(total) > KEEP) {
        const [old] = await kv(['ZRANGE', K_IDS, 0, Number(total) - KEEP - 1])
        if (old?.length) await kv(['HDEL', K_MSG, ...old], ['ZREM', K_IDS, ...old])
      }
    } catch (e) {
      console.error('[contact] store failed:', e.message || e)
    }
  }

  // The email copy and the optional newsletter signup run side by side, so the reader
  // waits for the slower of the two rather than both in a row.
  const signup = b.subscribe ? { email, source: 'contact-form', ip, referrer: referrerOf(req) } : null
  const [note, newsletter] = await Promise.all([
    notifyByEmail({
      subject: `[WCE] ${reason} — ${name}`,
      replyTo: email,
      text: `${message}\n\n— ${name} <${email}>\nReason: ${reason}\nSent ${new Date(ts).toUTCString()} from wcehoops.com/contact`,
    }),
    // Only once the message itself is safe; best effort, never fails the message.
    signup && stored ? newsletterFor(signup) : Promise.resolve(undefined),
  ])
  if (!note.sent && note.reason !== 'not configured') console.error('[contact] notify failed:', note.reason)

  if (!stored && !note.sent) return res.status(503).json({ ok: false, error: 'unavailable' })

  // Redis was down but the email copy went out: the message counts as received, and the
  // newsletter signup can go now.
  if (signup && !stored) return res.status(200).json({ ok: true, newsletter: await newsletterFor(signup) })

  return res.status(200).json({ ok: true, newsletter })
}

async function newsletterFor(signup) {
  const r = buttondownConfigured() ? await subscribeToButtondown(signup) : { outcome: 'transient', detail: 'BUTTONDOWN_API_KEY not set' }
  if (r.outcome !== 'transient') return r.outcome
  return (await queueSignup({ ...signup, reason: r.detail })) ? 'queued' : 'failed'
}

async function list(req, res) {
  if (!kvConfigured()) return res.status(200).json({ configured: false, messages: [], total: 0, unread: 0 })
  const [ids] = await kv(['ZREVRANGE', K_IDS, 0, 199])
  const [total] = await kv(['ZCARD', K_IDS])
  let messages = []
  if (ids?.length) {
    const rows = await kv(...ids.map((id) => ['HGET', K_MSG, id]))
    messages = rows.map((r) => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
  }
  return res.status(200).json({
    configured: true,
    total: Number(total) || 0,
    unread: messages.filter((m) => !m.read).length,
    messages,
  })
}

async function act(req, res, action) {
  const id = clip(bodyOf(req).id, 40)
  if (!id) return res.status(400).json({ error: 'id required' })
  if (action === 'delete') {
    await kv(['HDEL', K_MSG, id], ['ZREM', K_IDS, id])
    return res.status(200).json({ ok: true })
  }
  const [raw] = await kv(['HGET', K_MSG, id])
  if (!raw) return res.status(404).json({ error: 'not found' })
  const msg = JSON.parse(raw)
  msg.read = action === 'read'
  await kv(['HSET', K_MSG, id, JSON.stringify(msg)])
  return res.status(200).json({ ok: true, message: msg })
}

export default async function handler(req, res) {
  try {
    const action = String(req.query?.action || '')
    if (req.method === 'POST' && !action) return await submit(req, res)

    // Everything else is the private inbox.
    if (!(await adminGate(req, res))) return
    if (req.method === 'GET') return await list(req, res)
    if (req.method === 'POST' && ['read', 'unread', 'delete'].includes(action)) {
      if (!kvConfigured()) return res.status(400).json({ error: 'Upstash is not configured.' })
      return await act(req, res, action)
    }
    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[contact] unhandled:', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
}
