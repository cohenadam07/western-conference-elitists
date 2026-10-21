// Savant Sunday — newsletter endpoint. Buttondown is the list; this is the door.
//
//   POST /api/newsletter                    { email, source, website, sports } → subscribe
//   GET  /api/newsletter                                                  → public archive of sent issues
//   GET  /api/newsletter?prefs=<subscriber id>                            → that reader's sports
//   POST /api/newsletter?prefs=<subscriber id>  { sports }                → change them
//   GET  /api/newsletter?admin=1            (x-analytics-key)             → list health for /inbox
//   POST /api/newsletter?admin=flush        (x-analytics-key)             → push queued signups to Buttondown
//
// `sports` is a list of 'nba' | 'nfl' | 'ufc' (at least one). Left out, it means all three.
//
// Env: BUTTONDOWN_API_KEY (required for real signups), BUTTONDOWN_USERNAME (optional —
// only used to link people to the hosted archive), plus the Upstash vars already on the
// project. Degrades rather than breaks: with no Buttondown key, or during a Buttondown
// outage, addresses are held in Upstash (see _forms.js) and nobody's signup is lost.

import {
  PUBLIC_ARCHIVE_URL,
  DEAD_TYPES,
  K_PENDING,
  adminGate,
  bodyOf,
  buttondown,
  buttondownConfigured,
  cleanEmail,
  cleanSource,
  cleanSports,
  ipOf,
  kv,
  kvConfigured,
  listPending,
  overLimit,
  queueSignup,
  referrerOf,
  resendConfigured,
  setSports,
  sportsFromMetadata,
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

  const sports = cleanSports(b.sports)
  if (sports && !sports.length) return res.status(400).json({ ok: false, error: 'sports' })

  const ip = ipOf(req)
  if (await overLimit('nl', ip, 6, 600)) return res.status(429).json({ ok: false, error: 'rate' })

  const signup = {
    email,
    source: cleanSource(b.source),
    ip,
    referrer: referrerOf(req),
    sports,
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

// ── a reader's sports ──────────────────────────────────────────────────────
//
// Every issue ends with wcehoops.com/newsletter/sports?id={{ subscriber.id }}. The
// subscriber ID is the key: it is long and random, and it only ever appears in that
// reader's own emails. Looking someone up by email address is refused on purpose, so
// nobody can read or change another person's choice by typing their address.
const SUB_ID = /^(?:sub_[a-z0-9]{8,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// Enough to recognise your own address, not enough to learn a stranger's from a leaked link.
const maskEmail = (e) => {
  const [user, domain] = String(e || '').split('@')
  return domain ? `${user.slice(0, 1)}•••@${domain}` : ''
}

async function prefs(req, res, id) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'method' })
  }
  if (!SUB_ID.test(id)) return res.status(404).json({ ok: false, error: 'notfound' })
  if (await overLimit('nlp', ipOf(req), 30, 600)) return res.status(429).json({ ok: false, error: 'rate' })
  if (!buttondownConfigured()) return res.status(503).json({ ok: false, error: 'unavailable' })

  let sports = null
  if (req.method === 'POST') {
    sports = cleanSports(bodyOf(req).sports)
    if (!sports || !sports.length) return res.status(400).json({ ok: false, error: 'sports' })
  }

  let found
  try {
    found = await buttondown('GET', `/subscribers/${encodeURIComponent(id)}`)
  } catch (e) {
    console.error('[newsletter] prefs lookup failed:', e.message || e)
    return res.status(503).json({ ok: false, error: 'unavailable' })
  }
  if (found.status === 404) return res.status(404).json({ ok: false, error: 'notfound' })
  if (!found.ok) {
    console.error('[newsletter] prefs lookup failed:', found.status, found.text.slice(0, 160))
    return res.status(503).json({ ok: false, error: 'unavailable' })
  }
  const s = found.json || {}
  // Only an exact ID match counts, whatever else Buttondown's lookup might accept.
  if (String(s.id || '').toLowerCase() !== id.toLowerCase()) return res.status(404).json({ ok: false, error: 'notfound' })
  if (s.type === 'unsubscribed' || DEAD_TYPES.has(s.type)) {
    const out = { ok: false, error: 'unsubscribed' }
    if (PUBLIC_ARCHIVE_URL()) out.resubscribeUrl = PUBLIC_ARCHIVE_URL()
    return res.status(410).json(out)
  }

  const out = { ok: true, email: maskEmail(s.email_address), confirmed: s.type !== 'unactivated' }
  if (sports) {
    const r = await setSports(s, sports)
    if (!r.ok) {
      console.error('[newsletter] prefs save failed:', r.detail)
      return res.status(503).json({ ok: false, error: 'unavailable' })
    }
    out.sports = r.sports
    out.saved = true
  } else {
    out.sports = sportsFromMetadata(s.metadata)
  }
  return res.status(200).json(out)
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
      archiveUrl: PUBLIC_ARCHIVE_URL(),
    },
    subscribers: null,
    pending: [],
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
      return res.status(405).json({ error: 'method not allowed' })
    }
    if (req.query?.prefs !== undefined) return await prefs(req, res, String(req.query.prefs).trim())
    if (req.method === 'POST') return await subscribe(req, res)
    if (req.method === 'GET') return await archive(req, res)
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[newsletter] unhandled:', e)
    return res.status(500).json({ ok: false, error: 'server' })
  }
}
