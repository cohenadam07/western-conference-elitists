// Regression check for the newsletter + contact endpoints.
//
//   node --test tools/forms/check.mjs
//
// Runs api/newsletter.js and api/contact.js in-process against fakes of Buttondown,
// Upstash and Resend (tools/forms/mocks.mjs). No network, no keys, no dependencies.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installFetchMock, resetMocks, state, TEST_ENV } from './mocks.mjs'

installFetchMock()
const newsletter = (await import('../../api/newsletter.js')).default
const contact = (await import('../../api/contact.js')).default

let ipCounter = 0
const freshIp = () => `203.0.113.${++ipCounter}`

function call(handler, { method = 'GET', query = {}, body, headers = {}, ip } = {}) {
  const req = {
    method,
    query,
    body,
    url: '/api/x?' + new URLSearchParams(query),
    headers: { 'x-forwarded-for': ip || freshIp(), referer: 'https://wcehoops.com/articles/some-piece', ...headers },
    socket: {},
  }
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {}, body: undefined }
    const res = {
      status(n) { out.status = n; return res },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res },
      json(o) { out.body = o; resolve(out); return res },
      send(o) { out.body = o; resolve(out); return res },
      end() { resolve(out); return res },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}
const admin = { 'x-analytics-key': TEST_ENV.ANALYTICS_DASHBOARD_PASSWORD }
const env = (over = {}) => {
  for (const k of Object.keys(TEST_ENV)) delete process.env[k]
  Object.assign(process.env, TEST_ENV)
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
const sub = (email, extra = {}) => call(newsletter, { method: 'POST', body: { email, source: 'home', ...extra } })
const pending = () => [...(state.kv.get('wce:nl:pending') || new Map()).keys()]
const bdSubscribeCalls = () => state.bd.calls.filter((c) => c.method === 'POST' && c.path === '/v1/subscribers')

test.beforeEach(() => { resetMocks(); env() })

// ── newsletter: subscribe ──────────────────────────────────────────────────

test('new address → confirmation email, attribution passed through', async () => {
  const r = await sub('Reader@Example.com', { source: 'Article!' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true, status: 'confirm' })
  const [c] = bdSubscribeCalls()
  assert.equal(c.body.email_address, 'Reader@Example.com')
  assert.equal(c.body.utm_campaign, 'article')
  assert.equal(c.body.utm_source, 'wcehoops.com')
  assert.equal(c.body.referrer_url, 'https://wcehoops.com/articles/some-piece')
  assert.ok(c.body.ip_address)
  assert.equal(c.body.type, undefined, 'must not bypass double opt-in')
})

test('signing up twice before confirming re-sends the confirmation', async () => {
  await sub('twice@example.com')
  const r = await sub('twice@example.com')
  assert.deepEqual(r.body, { ok: true, status: 'resent' })
  assert.equal(state.bd.subs.get('twice@example.com').reminders, 1)
})

test('already-confirmed subscriber is told so', async () => {
  state.bd.subs.set('fan@example.com', { id: 's1', email_address: 'fan@example.com', type: 'regular' })
  const r = await sub('fan@example.com')
  assert.deepEqual(r.body, { ok: true, status: 'existing' })
})

test('previously unsubscribed → 409 with a link to resubscribe on Buttondown', async () => {
  state.bd.subs.set('gone@example.com', { id: 's2', email_address: 'gone@example.com', type: 'unsubscribed' })
  const r = await sub('gone@example.com')
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'unsubscribed')
  assert.equal(r.body.resubscribeUrl, 'https://buttondown.com/wcehoops')
})

test('obvious garbage never reaches Buttondown', async () => {
  for (const bad of ['', 'nope', 'a@b', 'x y@z.com', 'a'.repeat(250) + '@x.com']) {
    const r = await sub(bad)
    assert.equal(r.status, 400, bad)
    assert.equal(r.body.error, 'invalid')
  }
  assert.equal(bdSubscribeCalls().length, 0)
})

test('Buttondown-invalid and firewall-rejected addresses get distinct errors', async () => {
  assert.equal((await sub('who@invalid.test')).body.error, 'invalid')
  const r = await sub('bot@spam.test')
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'rejected')
})

test('honeypot: bots get a success response and nothing is stored', async () => {
  const r = await sub('bot@example.com', { website: 'http://spam' })
  assert.deepEqual(r.body, { ok: true, status: 'confirm' })
  assert.equal(bdSubscribeCalls().length, 0)
  assert.equal(pending().length, 0)
})

for (const mode of ['down', 'ratelimit', 'unreachable']) {
  test(`Buttondown ${mode} → signup held in the queue, reader still succeeds`, async () => {
    state.bd.mode = mode
    const r = await sub('patient@example.com')
    assert.deepEqual(r.body, { ok: true, status: 'queued' })
    assert.deepEqual(pending(), ['patient@example.com'])
  })
}

test('bad API key is treated as our problem: queued, not shown to the reader as an error', async () => {
  env({ BUTTONDOWN_API_KEY: 'wrong' })
  const r = await sub('keyless@example.com')
  assert.equal(r.body.status, 'queued')
})

test('no Buttondown key yet → queued with the reason recorded', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  const r = await sub('early@example.com')
  assert.equal(r.body.status, 'queued')
  const row = JSON.parse(state.kv.get('wce:nl:pending').get('early@example.com'))
  assert.match(row.reason, /BUTTONDOWN_API_KEY/)
  assert.equal(row.source, 'home')
})

test('re-submitting while queued does not duplicate', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  await sub('Same@Example.com'); await sub('same@example.com')
  assert.deepEqual(pending(), ['same@example.com'])
})

test('nowhere to put it (no key, no Redis) → honest 503', async () => {
  env({ BUTTONDOWN_API_KEY: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined })
  const r = await sub('lost@example.com')
  assert.equal(r.status, 503)
  assert.equal(r.body.ok, false)
})

test('Redis outage alone does not block signups (rate limit fails open)', async () => {
  state.kvDown = true
  const r = await sub('fine@example.com')
  assert.equal(r.body.status, 'confirm')
})

test('Redis and Buttondown both down → 503, not a fake success', async () => {
  state.kvDown = true; state.bd.mode = 'down'
  assert.equal((await sub('unlucky@example.com')).status, 503)
})

test('rate limit: 6 signups per IP per 10 minutes', async () => {
  const ip = '198.51.100.7'
  for (let i = 0; i < 6; i++) {
    const r = await call(newsletter, { method: 'POST', ip, body: { email: `n${i}@example.com` } })
    assert.equal(r.status, 200)
  }
  const r = await call(newsletter, { method: 'POST', ip, body: { email: 'n7@example.com' } })
  assert.equal(r.status, 429)
  assert.equal(r.body.error, 'rate')
})

// ── newsletter: admin ──────────────────────────────────────────────────────

test('admin endpoints refuse without the password, and refuse to run with none set', async () => {
  assert.equal((await call(newsletter, { query: { admin: '1' } })).status, 401)
  assert.equal((await call(newsletter, { query: { admin: '1' }, headers: { 'x-analytics-key': 'nope' } })).status, 401)
  env({ ANALYTICS_DASHBOARD_PASSWORD: undefined })
  assert.equal((await call(newsletter, { query: { admin: '1' }, headers: admin })).status, 500)
})

test('health reports config, subscriber counts and the queue', async () => {
  state.bd.subs.set('a@example.com', { type: 'regular' })
  state.bd.subs.set('b@example.com', { type: 'regular' })
  state.bd.subs.set('c@example.com', { type: 'unactivated' })
  state.bd.mode = 'down'; await sub('q@example.com'); state.bd.mode = 'ok'
  const r = await call(newsletter, { query: { admin: '1' }, headers: admin })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.config, { buttondown: true, kv: true, notifications: true, archiveUrl: 'https://buttondown.com/wcehoops' })
  assert.deepEqual(r.body.subscribers, { confirmed: 2, unconfirmed: 1 })
  assert.deepEqual(r.body.pending.map((p) => p.email), ['q@example.com'])
})

test('flush pushes queued signups, drops permanent failures, keeps transient ones', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  for (const e of ['one@example.com', 'two@example.com', 'bad@invalid.test']) await sub(e)
  state.bd.subs.set('two@example.com', { type: 'regular' })
  env()
  const r = await call(newsletter, { method: 'POST', query: { admin: 'flush' }, headers: admin })
  assert.deepEqual(r.body, { ok: true, added: 1, existing: 1, dropped: 1, stillWaiting: 0, remaining: 0 })
  assert.equal(pending().length, 0)
  assert.equal(state.bd.subs.get('one@example.com').utm_campaign, 'home', 'original placement survives the queue')

  env({ BUTTONDOWN_API_KEY: undefined }); await sub('later@example.com'); env()
  state.bd.mode = 'down'
  const again = await call(newsletter, { method: 'POST', query: { admin: 'flush' }, headers: admin })
  assert.equal(again.body.stillWaiting, 1)
  assert.equal(again.body.remaining, 1)
  assert.deepEqual(pending(), ['later@example.com'])
})

test('flush with no key explains itself', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  const r = await call(newsletter, { method: 'POST', query: { admin: 'flush' }, headers: admin })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /BUTTONDOWN_API_KEY/)
})

// ── newsletter: archive ────────────────────────────────────────────────────

test('archive lists only sent, public issues and is edge-cached', async () => {
  state.bd.emails.push(
    { id: 'e1', status: 'sent', email_type: 'public', subject: 'Issue 1', description: 'd1', publish_date: '2026-09-03T12:00:00Z', absolute_url: 'https://buttondown.com/wcehoops/archive/issue-1' },
    { id: 'e2', status: 'draft', email_type: 'public', subject: 'Draft' },
    { id: 'e3', status: 'sent', email_type: 'private', subject: 'Private' },
    { id: 'e4', status: 'sent', email_type: 'public', archival_mode: 'disabled', subject: 'Unarchived' },
  )
  const r = await call(newsletter)
  assert.equal(r.body.configured, true)
  assert.deepEqual(r.body.issues.map((i) => i.subject), ['Issue 1'])
  assert.equal(r.body.issues[0].url, 'https://buttondown.com/wcehoops/archive/issue-1')
  assert.match(r.headers['cache-control'], /s-maxage/)
})

test('archive without a key is an empty, well-formed answer', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  const r = await call(newsletter)
  assert.deepEqual(r.body, { configured: false, issues: [], archiveUrl: null })
})

test('archive survives a Buttondown outage', async () => {
  state.bd.mode = 'down'
  const r = await call(newsletter)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.issues, [])
  assert.equal(r.body.error, 'unavailable')
})

test('unsupported method → 405', async () => {
  assert.equal((await call(newsletter, { method: 'PUT' })).status, 405)
})

// ── contact ────────────────────────────────────────────────────────────────

const msg = (over = {}) => ({ name: 'Jordan', email: 'jordan@example.com', reason: 'Press / Media', message: 'Loved the Jaylen piece.\nCan we talk?', ...over })
const send = (over, extra) => call(contact, { method: 'POST', body: msg(over), ...extra })
const inbox = () => call(contact, { headers: admin })

test('a message is stored and a notification goes out with Reply-To set', async () => {
  const r = await send()
  assert.deepEqual(r.body, { ok: true, newsletter: undefined })
  const list = (await inbox()).body
  assert.equal(list.total, 1)
  assert.equal(list.unread, 1)
  assert.equal(list.messages[0].message, 'Loved the Jaylen piece.\nCan we talk?')
  const [mail] = state.resend.sent
  assert.equal(mail.reply_to, 'jordan@example.com')
  assert.deepEqual(mail.to, ['owner@example.com'])
  assert.match(mail.subject, /Press \/ Media — Jordan/)
})

test('missing fields come back field by field', async () => {
  const r = await send({ name: ' ', email: 'nope', message: '' })
  assert.equal(r.status, 400)
  assert.deepEqual(r.body.fields, { name: 'required', email: 'invalid', message: 'required' })
  assert.equal((await inbox()).body.total, 0)
})

test('unknown reason falls back to General; control characters are stripped, newlines kept', async () => {
  await send({ reason: 'Hax', message: 'line one\u0000\u0007\nline two' })
  const m = (await inbox()).body.messages[0]
  assert.equal(m.reason, 'General')
  assert.equal(m.message, 'line one\nline two')
})

test('contact honeypot stores nothing', async () => {
  const r = await send({ website: 'x' })
  assert.equal(r.body.ok, true)
  assert.equal((await inbox()).body.total, 0)
  assert.equal(state.resend.sent.length, 0)
})

test('"also subscribe me" signs them up with contact-form attribution', async () => {
  const r = await send({ subscribe: true })
  assert.equal(r.body.newsletter, 'confirm')
  assert.equal(state.bd.subs.get('jordan@example.com').utm_campaign, 'contact-form')
})

test('"also subscribe me" with no Buttondown key queues the address', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  const r = await send({ subscribe: true })
  assert.equal(r.body.newsletter, 'queued')
  assert.deepEqual(pending(), ['jordan@example.com'])
})

test('either store is enough; neither is an honest failure', async () => {
  state.kvDown = true
  assert.equal((await send()).body.ok, true, 'Redis down, email works')
  state.kvDown = false; state.resend.mode = 'down'
  assert.equal((await send()).body.ok, true, 'email down, Redis works')
  state.kvDown = true
  assert.equal((await send()).status, 503, 'both down')
  env({ KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, RESEND_API_KEY: undefined })
  assert.equal((await send()).status, 503, 'nothing configured')
})

test('works with Redis only (no Resend configured)', async () => {
  env({ RESEND_API_KEY: undefined })
  assert.equal((await send()).body.ok, true)
  assert.equal((await inbox()).body.total, 1)
})

test('contact rate limit: 4 per IP per 10 minutes', async () => {
  const ip = '198.51.100.9'
  for (let i = 0; i < 4; i++) assert.equal((await send({}, { ip })).status, 200)
  assert.equal((await send({}, { ip })).status, 429)
})

test('inbox: newest first, read/unread/delete, all behind the password', async () => {
  await send({ name: 'First' })
  await new Promise((r) => setTimeout(r, 5))
  await send({ name: 'Second' })
  assert.equal((await call(contact)).status, 401)
  let list = (await inbox()).body
  assert.deepEqual(list.messages.map((m) => m.name), ['Second', 'First'])
  const id = list.messages[1].id
  await call(contact, { method: 'POST', query: { action: 'read' }, body: { id }, headers: admin })
  list = (await inbox()).body
  assert.equal(list.unread, 1)
  assert.equal(list.messages[1].read, true)
  await call(contact, { method: 'POST', query: { action: 'unread' }, body: { id }, headers: admin })
  assert.equal((await inbox()).body.unread, 2)
  await call(contact, { method: 'POST', query: { action: 'delete' }, body: { id }, headers: admin })
  list = (await inbox()).body
  assert.deepEqual(list.messages.map((m) => m.name), ['Second'])
  assert.equal(list.total, 1)
  const nope = await call(contact, { method: 'POST', query: { action: 'read' }, body: { id: 'missing' }, headers: admin })
  assert.equal(nope.status, 404)
  const unauth = await call(contact, { method: 'POST', query: { action: 'delete' }, body: { id } })
  assert.equal(unauth.status, 401)
})

test('inbox keeps the newest 2,000 messages', async () => {
  env({ RESEND_API_KEY: undefined })
  for (let i = 0; i < 2003; i++) await send({ name: 'n' + i })
  assert.equal(state.kv.get('wce:contact:ids').size, 2000)
  assert.equal(state.kv.get('wce:contact:msg').size, 2000)
  assert.equal((await inbox()).body.total, 2000)
})

// ── newsletter drafts (scripts/lib/newsletter.mjs) ─────────────────────────

const { buildDraft, createButtondownDraft } = await import('../../scripts/lib/newsletter.mjs')
const art = (over) => ({
  slug: 'a', title: 'A & B', category: 'Draft', author: 'Ezra Berke', readTime: '4 min read', excerpt: 'Dek <here>',
  html: '<p>One two three.</p>\n<p>See: <img src="/articles/a/img-1.png" alt="" /> and <a href="/rankings">the board</a>.</p>',
  publishedAt: '2026-09-10T00:00:00Z', ...over,
})

test('one article → a feature draft with absolute image/link URLs and a read-more link', () => {
  const d = buildDraft([art()])
  assert.equal(d.subject, 'A & B')
  assert.match(d.body, /src="https:\/\/wcehoops\.com\/articles\/a\/img-1\.png"/)
  assert.match(d.body, /href="https:\/\/wcehoops\.com\/rankings"/)
  assert.match(d.body, /Keep reading on WCE/)
  assert.match(d.body, /utm_source=newsletter/)
})

test('several articles → a digest with an intro placeholder, escaped titles, and a subscribe footer', () => {
  const d = buildDraft([art(), art({ slug: 'b', title: 'Second <script>' })])
  assert.match(d.subject, /^The Weekly Board: A & B$/)
  assert.match(d.body, /\[Your intro/)
  assert.match(d.body, /Second &lt;script&gt;/)
  assert.doesNotMatch(d.body, /<script>/)
  assert.match(d.body, /Dek &lt;here&gt;/)
  assert.match(d.body, /\/newsletter\?utm_source/)
  assert.equal(buildDraft([art(), art({ slug: 'b' })], { subject: 'Custom' }).subject, 'Custom')
})

test('drafts are created as DRAFTS, never sent', async () => {
  await createButtondownDraft(buildDraft([art()]), 'test-bd-key')
  const [e] = state.bd.emails
  assert.equal(e.status, 'draft')
  assert.equal(e.subject, 'A & B')
  await assert.rejects(() => createButtondownDraft(buildDraft([art()]), 'bad-key'), /Buttondown said 401/)
})

// ── hardening (from review) ────────────────────────────────────────────────

test('unknown Buttondown errors hold the signup instead of guessing', async () => {
  for (const e of ['who@weird.test', 'who@404.test']) {
    const r = await sub(e)
    assert.deepEqual(r.body, { ok: true, status: 'queued' }, e)
  }
  assert.deepEqual(pending().sort(), ['who@404.test', 'who@weird.test'])
})

test('flush never drops an address on an unknown error, and one bad address does not block the rest', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  await sub('odd@weird.test')
  await new Promise((r) => setTimeout(r, 2))
  await sub('fine@example.com')
  env()
  const r = await call(newsletter, { method: 'POST', query: { admin: 'flush' }, headers: admin })
  assert.equal(r.body.added, 1)
  assert.equal(r.body.stillWaiting, 1)
  assert.equal(r.body.remaining, 1)
  assert.deepEqual(pending(), ['odd@weird.test'])
})

test('flush backs off after three failures in a row', async () => {
  env({ BUTTONDOWN_API_KEY: undefined })
  for (let i = 0; i < 6; i++) await sub(`q${i}@example.com`)
  env()
  state.bd.mode = 'down'
  const r = await call(newsletter, { method: 'POST', query: { admin: 'flush' }, headers: admin })
  assert.equal(r.body.stillWaiting, 3)
  assert.equal(r.body.remaining, 6)
  assert.equal(bdSubscribeCalls().length, 3, 'stopped calling a struggling Buttondown')
})

test('confirmation reminders are capped at one per address per day', async () => {
  await sub('twice@example.com')
  assert.equal((await sub('twice@example.com')).body.status, 'resent')
  assert.equal((await sub('twice@example.com')).body.status, 'unconfirmed')
  assert.equal(state.bd.subs.get('twice@example.com').reminders, 1)
})

test('admin password lockout: 10 wrong guesses block even the right one for a while', async () => {
  const ip = '192.0.2.50'
  for (let i = 0; i < 10; i++) {
    const r = await call(contact, { ip, headers: { 'x-analytics-key': 'guess' + i } })
    assert.equal(r.status, 401)
  }
  assert.equal((await call(contact, { ip, headers: admin })).status, 429)
  assert.equal((await call(newsletter, { ip, query: { admin: '1' }, headers: admin })).status, 429)
  assert.equal((await call(contact, { headers: admin })).status, 200, 'other IPs unaffected')
})

test('malformed JSON body is a 400, not a 500', async () => {
  const req = { method: 'POST', query: {}, url: '/api/newsletter', headers: { 'x-forwarded-for': freshIp() }, socket: {} }
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Unexpected token') } })
  const r = await new Promise((resolve) => {
    const out = {}
    const res = { status(n) { out.status = n; return res }, setHeader() { return res }, json(o) { out.body = o; resolve(out) } }
    newsletter(req, res)
  })
  assert.equal(r.status, 400)
})

test('referrer is stored without query strings, and held signups keep no IP', async () => {
  await call(newsletter, { method: 'POST', body: { email: 'ref@example.com', source: 'article' }, headers: { referer: 'https://wcehoops.com/articles/x?fbclid=abc123&utm_source=ig' } })
  assert.equal(state.bd.subs.get('ref@example.com').referrer_url, 'https://wcehoops.com/articles/x')
  env({ BUTTONDOWN_API_KEY: undefined })
  await sub('held@example.com')
  const row = JSON.parse(state.kv.get('wce:nl:pending').get('held@example.com'))
  assert.equal(row.ip, undefined)
})

test('archive is an allow-list: unknown email types and non-sent rows stay private', async () => {
  state.bd.emails.push(
    { id: 'p', status: 'sent', email_type: 'public', subject: 'Public', publish_date: '2026-09-01T00:00:00Z' },
    { id: 'h', status: 'sent', email_type: 'hidden', subject: 'Hidden' },
    { id: 'a', status: 'sent', email_type: 'archival', subject: 'Archival' },
  )
  const r = await call(newsletter)
  assert.deepEqual(r.body.issues.map((i) => i.subject), ['Public', 'Archival'])
})

test('contact: newsletter box still works when Redis is down but the email copy went out', async () => {
  state.kvDown = true
  const r = await send({ subscribe: true })
  assert.equal(r.body.ok, true)
  assert.equal(r.body.newsletter, 'confirm')
})

test('emails with URL-ish characters are rejected before they reach anything', async () => {
  const r = await sub('a?bcc=x%40y.com&subject=hi@z.io')
  assert.equal(r.status, 400)
  assert.equal((await sub('reader@example.xn--p1ai')).body.status, 'confirm', 'punycode TLDs are fine')
})
