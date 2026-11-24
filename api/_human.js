// api/_human.js — the server half of the human gate (public/wce-human.js, see BOT-SHIELD.md).
//
// Served at /api/human (vercel.json rewrites it to api/analytics/history.js?section=human, so it
// costs no function slot). Under /api/, so the firewall's bypass rule keeps it reachable.
//
//   POST { token }  ->  checks the Cloudflare Turnstile token with siteverify, then sets two cookies
//                       for 12 hours:
//                         wce_h   HttpOnly, signed (<expiry>.<hmac>): proof for any future
//                                 server-side check (Routing Middleware on the data files)
//                         wce_hh  readable by the page: "already checked", so the next page opens
//                                 without asking Cloudflare again
//                       answers { ok: true } | { ok: false, failed: true } (Cloudflare said no)
//                       | { ok: false, configured: false } (no secret set: the page falls back)
//
// Env: TURNSTILE_SECRET_KEY (server only). WCE_HUMAN_SECRET signs wce_h; without it the signing
// key is derived from the Turnstile secret, so one secret is enough.

import crypto from 'node:crypto'

const TTL = 12 * 60 * 60 // seconds
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function signingKey() {
  const own = process.env.WCE_HUMAN_SECRET
  if (own) return own
  return crypto.createHash('sha256').update('wce_h:' + process.env.TURNSTILE_SECRET_KEY).digest('hex')
}

export function signHuman(exp) {
  return crypto.createHmac('sha256', signingKey()).update('wce_h:' + exp).digest('base64url')
}

// For a future middleware: is this wce_h cookie value valid and unexpired?
export function checkHuman(value) {
  if (!value || !process.env.TURNSTILE_SECRET_KEY) return false
  const [exp, mac] = String(value).split('.')
  if (!/^\d+$/.test(exp || '') || !mac) return false
  if (Number(exp) * 1000 < Date.now()) return false
  const want = Buffer.from(signHuman(exp))
  const got = Buffer.from(mac)
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

export async function humanHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return res.status(200).json({ ok: false, configured: false })

  const token = String(readBody(req).token || '')
  if (!token || token.length > 2048) return res.status(400).json({ ok: false, failed: true })

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  let out
  try {
    const form = new URLSearchParams({ secret, response: token })
    if (ip) form.set('remoteip', ip)
    const r = await fetch(SITEVERIFY, { method: 'POST', body: form })
    out = await r.json()
  } catch {
    // Cloudflare unreachable: don't punish the visitor, let the page fall back to interaction.
    return res.status(200).json({ ok: false, configured: true, unavailable: true })
  }
  if (!out || !out.success) return res.status(200).json({ ok: false, failed: true })

  const exp = Math.floor(Date.now() / 1000) + TTL
  const base = `Path=/; Max-Age=${TTL}; Secure; SameSite=Lax`
  res.setHeader('Set-Cookie', [
    `wce_h=${exp}.${signHuman(exp)}; ${base}; HttpOnly`,
    `wce_hh=1; ${base}`,
  ])
  return res.status(200).json({ ok: true })
}
