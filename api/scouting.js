// /api/scouting — a private page behind its own logins. Nothing here is the page or its data: both
// live in private storage (Upstash, uploaded by the nightly job; a local folder when
// SCOUTING_LOCAL_DIR is set, for running it on the Mac). This file only checks who is asking.
//
// Its logins are its own (SCOUTING_USERS) and are never the analytics / Edge Lab password, which this
// endpoint does not accept; its session cookie is scoped to /api/scouting, so it opens nothing else.
//
//   GET  /api/scouting                 the page, or the sign-in form
//   POST /api/scouting?a=login         user + password -> session cookie
//   GET  /api/scouting?a=logout        clears it
//   GET  /api/scouting?f=<file>        one of the page's files (signed in only)
//   PUT  /api/scouting?a=put&f=<file>  the nightly job's upload: body = base64 of the gzipped file,
//                                      header x-scouting-upload = SCOUTING_UPLOAD_TOKEN
//   GET  /api/scouting?a=get&f=<file>  the same job reading back what it needs (same header)
//
// The upload token is a third secret: it can write and read the page's files and nothing else, it
// never opens the page for a browser, and a viewer's login can never upload. It exists so the
// Upstash credentials stay inside Vercel: neither the Mac nor the cloud job ever holds them.
//
// Env: SCOUTING_USERS   JSON {"user": "scrypt$<salt hex>$<hash hex>"}  (make one with the helper the
//                       owner keeps privately; never a plain password)
//      SCOUTING_SESSION_SECRET   32+ random bytes, hex
//      SCOUTING_LOCAL_DIR        local runs only

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { kv, kvConfigured, ipOf, bodyOf } from './_forms.js'

const COOKIE = 'sc_s'
const BASE = '/api/scouting'
const DAYS = 7
const FILE_RE = /^(app\.html|index\.json|s\/\d{4}-\d{2}\.json|blind\/sheet-\d{4}-\d{2}\.csv)$/
const JOB_RE = /^(app\.html|index\.json|s\/\d{4}-\d{2}\.json|blind\/sheet-\d{4}-\d{2}\.csv|base\/[a-z0-9-]+\.json)$/ // base/: the job's own inputs, never served to a browser
const MAX_UPLOAD = 4_000_000

function jobAllowed(req) {
  const want = process.env.SCOUTING_UPLOAD_TOKEN || ''
  const got = String(req.headers['x-scouting-upload'] || '')
  return want.length >= 32 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

async function writeFile(name, b64) {
  const buf = zlib.gunzipSync(Buffer.from(b64, 'base64')) // refuses anything that is not a gzip
  if (local()) {
    const p = path.join(local(), name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, buf)
    return buf.length
  }
  await kv(['SET', `scouting:f:${name}`, b64])
  return buf.length
}
const TYPES = { html: 'text/html; charset=utf-8', json: 'application/json', csv: 'text/csv; charset=utf-8' }

function users() {
  try { return JSON.parse(process.env.SCOUTING_USERS || '{}') } catch { return {} }
}

function checkPassword(stored, password) {
  const [kind, salt, hash] = String(stored || '').split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const got = crypto.scryptSync(String(password || ''), Buffer.from(salt, 'hex'), 32)
  const want = Buffer.from(hash, 'hex')
  return want.length === got.length && crypto.timingSafeEqual(got, want)
}

// A session names its user and, through the HMAC, his current password hash: changing or removing
// his entry in SCOUTING_USERS ends every session he has.
function sign(user, exp, stored) {
  const secret = process.env.SCOUTING_SESSION_SECRET || ''
  return crypto.createHmac('sha256', secret).update(`${user}.${exp}.${stored}`).digest('hex')
}

function cookies(req) {
  const out = {}
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=')
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim())
  }
  return out
}

function session(req) {
  const v = cookies(req)[COOKIE]
  if (!v) return null
  const [user, exp, mac] = v.split('.')
  const stored = users()[user]
  if (!stored || !exp || Number(exp) < Date.now()) return null
  const want = sign(user, exp, stored)
  if (!mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null
  return user
}

function headers(res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

const local = () => process.env.SCOUTING_LOCAL_DIR

async function readFile(name) {
  if (local()) {
    const p = path.join(local(), name)
    return fs.existsSync(p) ? fs.readFileSync(p) : null
  }
  if (!kvConfigured()) return null
  const [v] = await kv(['GET', `scouting:f:${name}`])
  return v ? zlib.gunzipSync(Buffer.from(v, 'base64')) : null
}

function signInPage(msg = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Sign in</title>
<style>:root{--ground:#EEF1F5;--surface:#FFFFFF;--text:#131416;--muted:#555B65;--border:#E1E5EB;--primary:#17263D;--gold:#C2A263;--red:#BC3A2C}
body{margin:0;background:var(--ground);color:var(--text);font:15px/1.5 'IBM Plex Sans',system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
form{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:28px;width:100%;max-width:360px;box-sizing:border-box}
h1{font:600 24px/1.2 Newsreader,Georgia,serif;margin:0 0 4px;padding-bottom:10px;border-bottom:2px solid var(--gold)}
p{color:var(--muted);margin:10px 0 18px;font-size:13px}label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
input{width:100%;box-sizing:border-box;height:42px;border:1px solid #C7CED8;border-radius:6px;padding:0 10px;font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
button{margin-top:18px;width:100%;height:44px;border:0;border-radius:6px;background:var(--primary);color:#fff;font:600 15px 'IBM Plex Sans',sans-serif;cursor:pointer}
.err{color:var(--red);font-size:13px;margin-top:12px}</style></head><body>
<form method="post" action="${BASE}?a=login"><h1>Sign in</h1><p>A private page. Your login opens this page only.</p>
<label for="u">User</label><input id="u" name="user" autocomplete="username" required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button>${msg ? `<div class="err" role="alert">${msg}</div>` : ''}</form></body></html>`
}

async function limited(req, user) {
  if (!kvConfigured()) return false
  const ip = ipOf(req)
  const slot = Math.floor(Date.now() / 600000)
  try {
    const [a, b] = await Promise.all([kv(['GET', `scouting:rl:ip:${ip}:${slot}`]), kv(['GET', `scouting:rl:u:${user}:${slot}`])])
    return Number(a?.[0]) >= 10 || Number(b?.[0]) >= 10
  } catch { return false }
}

async function miss(req, user) {
  if (!kvConfigured()) return
  const slot = Math.floor(Date.now() / 600000)
  try {
    await kv(['INCR', `scouting:rl:ip:${ipOf(req)}:${slot}`], ['EXPIRE', `scouting:rl:ip:${ipOf(req)}:${slot}`, 900],
      ['INCR', `scouting:rl:u:${user}:${slot}`], ['EXPIRE', `scouting:rl:u:${user}:${slot}`, 900])
  } catch { /* the check still ran */ }
}

export default async function handler(req, res) {
  headers(res)
  if (!process.env.SCOUTING_SESSION_SECRET || process.env.SCOUTING_SESSION_SECRET.length < 32 || !Object.keys(users()).length) {
    res.status(500).send('This page is not configured.')
    return
  }
  const q = req.query || {}
  if (q.a === 'put' || q.a === 'get') {
    if (!jobAllowed(req)) { res.status(403).json({ error: 'forbidden' }); return }
    const name = String(q.f || '')
    if (!JOB_RE.test(name)) { res.status(400).json({ error: 'bad file name' }); return }
    if (q.a === 'get') {
      const buf = await readFile(name)
      if (!buf) { res.status(404).json({ error: 'not found' }); return }
      res.setHeader('Content-Type', 'application/octet-stream')
      res.status(200).send(buf)
      return
    }
    if (req.method !== 'PUT' && req.method !== 'POST') { res.status(405).json({ error: 'PUT' }); return }
    const body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
    if (!body || body.length > MAX_UPLOAD) { res.status(413).json({ error: 'empty or too large' }); return }
    try {
      const n = await writeFile(name, body.trim())
      res.status(200).json({ ok: true, file: name, bytes: n })
    } catch (e) {
      res.status(400).json({ error: 'not a base64 gzip', detail: String(e.message || e).slice(0, 120) })
    }
    return
  }
  if (q.a === 'login' && req.method === 'POST') {
    const b = (await bodyOf(req)) || {}
    const user = String(b.user || '').trim().toLowerCase().slice(0, 40)
    if (await limited(req, user)) { res.status(429).setHeader('Content-Type', TYPES.html); res.send(signInPage('Too many tries. Wait ten minutes.')); return }
    const stored = users()[user]
    if (!stored || !checkPassword(stored, b.password)) {
      await miss(req, user)
      res.status(401).setHeader('Content-Type', TYPES.html)
      res.send(signInPage('That user and password do not match.'))
      return
    }
    const exp = Date.now() + DAYS * 86400000
    const secure = local() ? '' : '; Secure'
    res.setHeader('Set-Cookie', `${COOKIE}=${user}.${exp}.${sign(user, exp, stored)}; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=${DAYS * 86400}${secure}`)
    res.status(303).setHeader('Location', BASE)
    res.send('')
    return
  }
  if (q.a === 'logout') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=0`)
    res.status(303).setHeader('Location', BASE)
    res.send('')
    return
  }
  const user = session(req)
  if (!user) {
    if (q.f) { res.status(401).json({ error: 'sign in' }); return }
    res.status(200).setHeader('Content-Type', TYPES.html)
    res.send(signInPage())
    return
  }
  const name = q.f ? String(q.f) : 'app.html'
  if (!FILE_RE.test(name)) { res.status(404).json({ error: 'not found' }); return }
  const buf = await readFile(name)
  if (!buf) { res.status(404).json({ error: 'not found' }); return }
  res.setHeader('Content-Type', TYPES[name.split('.').pop()] || 'application/octet-stream')
  if (name.endsWith('.csv')) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(name)}"`)
  res.status(200).send(buf)
}
