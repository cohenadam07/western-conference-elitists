// tools/race-dev.mjs — run the race API on this machine, for the game's dev server and the tests.
//   node tools/race-dev.mjs [apiPort=8791] [--site]
// Starts a throwaway redis-server, puts an Upstash-style REST endpoint in front of it (POST a JSON
// command array, get { result }), and serves POST /api/race with the real handler (api/race.js).
// With --site it also serves the built site (dist/, after `npm run build`) from the same port, the
// way Vercel does: /hoops frames the game, and the game reaches /api/race on its own origin.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const API_PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8791), REST_PORT = API_PORT + 1, REDIS_PORT = API_PORT + 2
const SITE = process.argv.includes('--site') ? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist') : null
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.xml': 'application/xml' }
function serveSite(url, res) {
  let file = path.join(SITE, decodeURIComponent(url.pathname))
  if (!file.startsWith(SITE)) { res.statusCode = 403; res.end('no'); return }
  // a prebuilt page (dist/hoops/index.html), a file, or the app's index.html for any other route
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) {
    // (a missing file is a 404, the host's own scripts under /_vercel included; a route is the app)
    if (path.extname(file)) { res.statusCode = 404; res.end('not found'); return }
    file = path.join(SITE, 'index.html')
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
}

// ---- a small RESP client -------------------------------------------------------
function connect(port) {
  const sock = net.createConnection(port, '127.0.0.1')
  let buf = Buffer.alloc(0)
  const waiting = []
  const parse = (at) => {
    const nl = buf.indexOf('\r\n', at)
    if (nl < 0) return null
    const line = buf.toString('utf8', at + 1, nl), type = String.fromCharCode(buf[at])
    if (type === '+') return [line, nl + 2]
    if (type === '-') return [new Error(line), nl + 2]
    if (type === ':') return [Number(line), nl + 2]
    if (type === '$') {
      const n = Number(line)
      if (n < 0) return [null, nl + 2]
      if (buf.length < nl + 2 + n + 2) return null
      return [buf.toString('utf8', nl + 2, nl + 2 + n), nl + 2 + n + 2]
    }
    if (type === '*') {
      const n = Number(line)
      if (n < 0) return [null, nl + 2]
      const out = []; let p = nl + 2
      for (let i = 0; i < n; i++) { const r = parse(p); if (!r) return null; out.push(r[0]); p = r[1] }
      return [out, p]
    }
    throw new Error('bad RESP type ' + type)
  }
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (!buf.length) break
      const r = parse(0)
      if (!r) break
      buf = buf.subarray(r[1])
      const w = waiting.shift()
      if (w) (r[0] instanceof Error ? w.reject : w.resolve)(r[0])
    }
  })
  return {
    ready: new Promise((ok, no) => { sock.once('connect', ok); sock.once('error', no) }),
    send(cmd) {
      const parts = cmd.map((x) => Buffer.from(String(x)))
      sock.write(Buffer.concat([Buffer.from(`*${parts.length}\r\n`), ...parts.flatMap((p) => [Buffer.from(`$${p.length}\r\n`), p, Buffer.from('\r\n')])]))
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    },
  }
}

const rs = spawn('redis-server', ['--port', String(REDIS_PORT), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => rs.kill())
process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0))
let R = null
for (let t = 0; t < 50 && !R; t++) {
  await new Promise((r) => setTimeout(r, 100))
  const c = connect(REDIS_PORT)
  try { await c.ready; R = c } catch { /* not up yet */ }
}
if (!R) { console.error('redis-server did not start'); process.exit(1) }

const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => ok(s)) })
let commands = 0
http.createServer(async (req, res) => {
  const cmd = JSON.parse((await body(req)) || '[]')
  commands++
  res.setHeader('Content-Type', 'application/json')
  try { res.end(JSON.stringify({ result: await R.send(cmd) })) }
  catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e.message) })) }
}).listen(REST_PORT, '127.0.0.1')

process.env.KV_REST_API_URL = `http://127.0.0.1:${REST_PORT}`
process.env.KV_REST_API_TOKEN = 'dev-token'
const { default: handler } = await import('../api/race.js')

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__commands') { res.end(String(commands)); return }
  if (url.pathname !== '/api/race') { if (SITE) serveSite(url, res); else { res.statusCode = 404; res.end('no') } return }
  const raw = await body(req)
  let parsed = {}
  try { parsed = raw ? JSON.parse(raw) : {} } catch { /* the handler sees an empty body */ }
  const shim = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { res.statusCode = c; return shim },
    json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) },
  }
  await handler({ method: req.method, body: parsed, query: Object.fromEntries(url.searchParams) }, shim)
}).listen(API_PORT, '127.0.0.1', () => console.log(`race api on http://127.0.0.1:${API_PORT}/api/race (redis ${REDIS_PORT}, rest ${REST_PORT})${SITE ? ', and the built site on the same port' : ''}`))
