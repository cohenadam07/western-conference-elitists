// Throwaway dev server: serves the real Vite build and backs /api/dynasty with an in-memory
// Upstash shim, so the lobby UI can be exercised end to end without credentials.
// Not part of the repo. node devserver.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

process.env.KV_REST_API_URL = 'http://fake-redis.local'
process.env.KV_REST_API_TOKEN = 'test'

const ROOT = new URL('../../dist/', import.meta.url).pathname
const H = new Map(), Z = new Map(), S = new Map(), L = new Map(), SETS = new Map()
const hash = (k) => { if (!H.has(k)) H.set(k, new Map()); return H.get(k) }
const zset = (k) => { if (!Z.has(k)) Z.set(k, new Map()); return Z.get(k) }

function run(cmd) {
  const [op, ...a] = cmd.map((x) => (typeof x === 'string' ? x : String(x)))
  switch (op.toUpperCase()) {
    case 'ZCARD': return zset(a[0]).size
    case 'ZADD': {
      const z = zset(a[0]); let i = 1
      const nx = a[1] && a[1].toUpperCase() === 'NX'; if (nx) i = 2
      let added = 0
      for (; i + 1 <= a.length; i += 2) {
        const score = Number(a[i]), member = a[i + 1]
        if (member === undefined) break
        if (nx && z.has(member)) continue
        z.set(member, score); added++
      }
      return added
    }
    case 'ZREVRANGE': {
      const z = zset(a[0]), ws = a.includes('WITHSCORES')
      const sorted = [...z.entries()].sort((x, y) => y[1] - x[1]).slice(Number(a[1]), Number(a[2]) + 1)
      return ws ? sorted.flatMap(([m, s]) => [m, String(s)]) : sorted.map(([m]) => m)
    }
    case 'ZMSCORE': { const z = zset(a[0]); return a.slice(1).map((m) => (z.has(m) ? String(z.get(m)) : null)) }
    case 'ZINCRBY': { const z = zset(a[0]); const v = (z.get(a[2]) || 0) + Number(a[1]); z.set(a[2], v); return String(v) }
    case 'HGETALL': return [...hash(a[0]).entries()].flat()
    case 'HSET': { const h = hash(a[0]); for (let i = 1; a[i + 1] !== undefined; i += 2) h.set(a[i], a[i + 1]); return 1 }
    case 'HSETNX': { const h = hash(a[0]); if (h.has(a[1])) return 0; h.set(a[1], a[2]); return 1 }
    case 'HINCRBY': { const h = hash(a[0]); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); return v }
    case 'HGET': return hash(a[0]).get(a[1]) ?? null
    case 'EXPIRE': return 1
    case 'DEL': { H.delete(a[0]); S.delete(a[0]); Z.delete(a[0]); return 1 }
    case 'GET': return S.get(a[0]) ?? null
    case 'SET': S.set(a[0], a[1]); return 'OK'
    case 'INCR': { const v = Number(S.get(a[0]) || 0) + 1; S.set(a[0], String(v)); return v }
    case 'SADD': { if (!SETS.has(a[0])) SETS.set(a[0], new Set()); const s = SETS.get(a[0]); const had = s.has(a[1]); s.add(a[1]); return had ? 0 : 1 }
    case 'SISMEMBER': return SETS.get(a[0])?.has(a[1]) ? 1 : 0
    case 'LPUSH': { if (!L.has(a[0])) L.set(a[0], []); L.get(a[0]).unshift(a[1]); return L.get(a[0]).length }
    case 'LTRIM': { const l = L.get(a[0]) || []; L.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK' }
    case 'LRANGE': { const l = L.get(a[0]) || []; return l.slice(Number(a[1]), Number(a[2]) + 1) }
    default: throw new Error('unsupported: ' + op)
  }
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.includes('players.json')) {
    const f = path.join(ROOT, 'dynasty/players.json')
    if (fs.existsSync(f)) return { ok: true, headers: { get: () => 'application/json' }, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) }
    return { ok: false }
  }
  if (u.includes('fake-redis.local')) {
    const body = JSON.parse(opts.body || '[]')
    const out = u.endsWith('/pipeline') ? body.map((c) => ({ result: run(c) })) : { result: run(body) }
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => out }
  }
  return realFetch(url, opts)
}

const { default: dynasty } = await import('../../api/dynasty.js')
const { default: race } = await import('/Users/adamcohen/western-conference-elitists/api/race.js')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/dynasty' || url.pathname === '/api/race') {
    const fn = url.pathname === '/api/race' ? race : dynasty
    let raw = ''
    for await (const c of req) raw += c
    const q = Object.fromEntries(url.searchParams)
    const mreq = { method: req.method, query: q, body: raw ? JSON.parse(raw) : {},
      headers: { host: 'localhost', 'x-forwarded-proto': 'http' }, socket: {} }
    const mres = {
      setHeader() {}, status(c) { this._c = c; return this },
      json(j) { res.writeHead(this._c || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) },
    }
    try { await fn(mreq, mres) }
    catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })) }
    return
  }
  let f = path.join(ROOT, url.pathname)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(8811, () => console.log('dev server on http://localhost:8811/dynasty'))
