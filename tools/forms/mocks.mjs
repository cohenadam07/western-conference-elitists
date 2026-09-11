// In-process fakes for the three services the forms talk to, installed by swapping
// globalThis.fetch. Used by tools/forms/check.mjs. No network, no dependencies.
//
//   https://mock-upstash/…      Upstash REST (only the commands the site uses)
//   https://api.buttondown.com  Buttondown v1 (subscribers + emails), with failure modes
//   https://api.resend.com      Resend (records what would have been sent)

export const state = {
  kv: new Map(),
  ttl: new Map(),
  kvDown: false,
  bd: { mode: 'ok', subs: new Map(), emails: [], calls: [], nextId: 1 },
  resend: { mode: 'ok', sent: [] },
}

export function resetMocks() {
  state.kv.clear(); state.ttl.clear(); state.kvDown = false
  Object.assign(state.bd, { mode: 'ok', subs: new Map(), emails: [], calls: [], nextId: 1 })
  Object.assign(state.resend, { mode: 'ok', sent: [] })
}

const kv = state.kv
const alive = (k) => { const t = state.ttl.get(k); if (t && t < Date.now()) { kv.delete(k); state.ttl.delete(k) } return kv.get(k) }
const idx = (i, len) => (+i < 0 ? len + +i : +i)

function cmd([c, ...a]) {
  c = String(c).toUpperCase()
  const k = a[0]
  switch (c) {
    case 'GET': return alive(k) ?? null
    case 'SET': {
      const opts = a.slice(2).map((x) => String(x).toUpperCase())
      if (opts.includes('NX') && alive(k) !== undefined) return null
      kv.set(k, String(a[1]))
      const ex = opts.indexOf('EX'); if (ex !== -1) state.ttl.set(k, Date.now() + Number(a[2 + ex + 1]) * 1000)
      return 'OK'
    }
    case 'DEL': { let n = 0; for (const x of a) if (kv.delete(x)) n++; return n }
    case 'INCR': { const v = +(alive(k) ?? 0) + 1; kv.set(k, String(v)); return v }
    case 'EXPIRE': if (!kv.has(k)) return 0; state.ttl.set(k, Date.now() + a[1] * 1000); return 1
    case 'HSET': { const h = alive(k) || new Map(); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])) } kv.set(k, h); return n }
    case 'HGET': return alive(k)?.get(a[1]) ?? null
    case 'HDEL': { const h = alive(k); if (!h) return 0; let n = 0; for (const f of a.slice(1)) if (h.delete(f)) n++; return n }
    case 'HGETALL': { const h = alive(k); return h ? [...h].flat() : [] }
    case 'ZADD': { const z = alive(k) || new Map(); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!z.has(a[i + 1])) n++; z.set(a[i + 1], +a[i]) } kv.set(k, z); return n }
    case 'ZREM': { const z = alive(k); if (!z) return 0; let n = 0; for (const m of a.slice(1)) if (z.delete(m)) n++; return n }
    case 'ZCARD': return alive(k)?.size ?? 0
    case 'ZRANGE': case 'ZREVRANGE': {
      const z = alive(k); if (!z) return []
      const s = [...z].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)); if (c === 'ZREVRANGE') s.reverse()
      return s.slice(idx(a[1], s.length), idx(a[2], s.length) + 1).map((e) => e[0])
    }
    default: throw new Error('mock upstash: unsupported command ' + c)
  }
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

function upstash(url, init) {
  if (init?.headers?.Authorization !== 'Bearer test-kv') return json(401, { error: 'unauthorized' })
  if (state.kvDown) return json(500, { error: 'mock outage' })
  const body = JSON.parse(init.body)
  try {
    return url.pathname.endsWith('/pipeline') ? json(200, body.map((c) => ({ result: cmd(c) }))) : json(200, { result: cmd(body) })
  } catch (e) {
    return json(400, { error: e.message })
  }
}

const SUBSCRIBED = new Set(['regular', 'premium', 'gifted'])
function buttondownApi(url, init) {
  const bd = state.bd
  const method = init?.method || 'GET'
  const body = init?.body ? JSON.parse(init.body) : null
  bd.calls.push({ method, path: url.pathname + url.search, body })
  if (bd.mode === 'unreachable') throw new TypeError('fetch failed')
  if (init?.headers?.Authorization !== 'Token test-bd-key') return json(401, { detail: 'Invalid token.' })
  if (bd.mode === 'down') return json(503, { detail: 'Service unavailable' })
  if (bd.mode === 'ratelimit') return json(429, { detail: 'Request was throttled.' })
  const p = url.pathname.replace(/^\/v1/, '')
  let m
  if (method === 'POST' && p === '/subscribers') {
    const e = String(body.email_address || '').toLowerCase()
    if (e.endsWith('@invalid.test')) return json(400, { code: 'email_invalid', detail: 'That email address is invalid.' })
    if (e.endsWith('@spam.test')) return json(400, { code: 'ip_address_spammy', detail: 'Blocked by firewall.' })
    if (e.endsWith('@weird.test')) return json(400, { code: 'ip_address_already_used', detail: 'An error we have never seen.' })
    if (e.endsWith('@404.test')) return new Response('<html>Not Found</html>', { status: 404 })
    if (bd.subs.has(e)) return json(400, { code: 'email_already_exists', detail: 'That email address is already subscribed.' })
    const s = { id: 'sub_' + bd.nextId++, email_address: e, type: body.type || 'unactivated', creation_date: new Date().toISOString(), ...body }
    bd.subs.set(e, s)
    return json(201, s)
  }
  if (method === 'GET' && (m = p.match(/^\/subscribers\/([^/]+)$/))) {
    const s = bd.subs.get(decodeURIComponent(m[1]).toLowerCase())
    return s ? json(200, s) : json(404, { detail: 'Not found.' })
  }
  if (method === 'POST' && (m = p.match(/^\/subscribers\/([^/]+)\/send-reminder$/))) {
    const s = bd.subs.get(decodeURIComponent(m[1]).toLowerCase())
    if (!s) return json(404, { detail: 'Not found.' })
    s.reminders = (s.reminders || 0) + 1
    return json(200, {})
  }
  if (method === 'GET' && p === '/subscribers') {
    const t = url.searchParams.get('type')
    const all = [...bd.subs.values()].filter((s) => !t || s.type === t)
    return json(200, { count: all.length, results: all.slice(0, 1), next: null })
  }
  if (method === 'GET' && p === '/emails') {
    const st = url.searchParams.getAll('status')
    const list = bd.emails.filter((e) => !st.length || st.includes(e.status))
    return json(200, { count: list.length, results: list, next: null })
  }
  if (method === 'POST' && p === '/emails') {
    if (!body.subject) return json(400, { code: 'subject_invalid', detail: 'Subject is required.' })
    const e = { id: 'em_' + bd.nextId++, status: body.status || 'about_to_send', email_type: 'public', ...body, absolute_url: 'https://buttondown.com/wcehoops/archive/' + (body.slug || 'issue'), creation_date: new Date().toISOString(), publish_date: null }
    bd.emails.push(e)
    return json(201, e)
  }
  return json(404, { detail: `mock: no route for ${method} ${p}` })
}
export { SUBSCRIBED }

function resendApi(url, init) {
  if (state.resend.mode === 'down') return json(500, { message: 'mock outage' })
  state.resend.sent.push(JSON.parse(init.body))
  return json(200, { id: 're_' + state.resend.sent.length })
}

export function installFetchMock() {
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.hostname === 'mock-upstash') return upstash(url, init)
    if (url.hostname === 'api.buttondown.com') return buttondownApi(url, init)
    if (url.hostname === 'api.resend.com') return resendApi(url, init)
    return real(input, init)
  }
  return () => { globalThis.fetch = real }
}

export const TEST_ENV = {
  KV_REST_API_URL: 'https://mock-upstash',
  KV_REST_API_TOKEN: 'test-kv',
  BUTTONDOWN_API_KEY: 'test-bd-key',
  BUTTONDOWN_USERNAME: 'wcehoops',
  ANALYTICS_DASHBOARD_PASSWORD: 'test-admin',
  RESEND_API_KEY: 'test-resend',
  CONTACT_NOTIFY_TO: 'owner@example.com',
}
