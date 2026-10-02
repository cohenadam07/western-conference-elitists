// tools/savant-mcp/redis.mjs — a throwaway data store for tests: a real redis-server on a
// spare port with an Upstash-style REST endpoint in front of it, the way the site reaches
// its own store (POST a JSON command array, get { result }; POST /pipeline with several).
//
// A real Redis rather than an imitation, because the usage log's counting is a script that
// runs inside the store (api/_usage.js): an imitation would only test the imitation.
// Modelled on tools/race-dev.mjs.
//
//   const store = await startStore()      null when redis-server is not installed
//   store.url, store.token                what to put in KV_REST_API_URL / KV_REST_API_TOKEN
//   store.commands                        commands received so far (what Upstash bills)
//   store.requests                        HTTP requests received so far, answered or not
//   store.send(['HGETALL', key])          talk to it directly
//   store.down = true                     answer every request with a 500
//   store.delay = 2000                    hold every answer for that many ms
//   await store.stop()

import http from 'node:http'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// A small RESP client: enough to send a command and read its reply.
function connect(port) {
  const sock = net.createConnection(port, '127.0.0.1')
  let buf = Buffer.alloc(0)
  const waiting = []
  const parse = (at) => {
    const nl = buf.indexOf('\r\n', at)
    if (nl < 0) return null
    const line = buf.toString('utf8', at + 1, nl)
    const type = String.fromCharCode(buf[at])
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
      const out = []
      let p = nl + 2
      for (let i = 0; i < n; i++) { const r = parse(p); if (!r) return null; out.push(r[0]); p = r[1] }
      return [out, p]
    }
    throw new Error(`bad RESP type ${type}`)
  }
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    while (buf.length) {
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
    end: () => sock.destroy(),
  }
}

export async function startStore() {
  if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).error) return null
  const port = await freePort()
  const server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' })
  let client = null
  for (let t = 0; t < 50 && !client; t++) {
    await new Promise((r) => setTimeout(r, 100))
    const c = connect(port)
    try { await c.ready; client = c } catch { /* not up yet */ }
  }
  if (!client) { server.kill(); throw new Error('redis-server did not start') }

  const store = { token: 'test-token', commands: 0, requests: 0, down: false, delay: 0, send: (cmd) => client.send(cmd) }
  const read = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => ok(s)) })
  const run = async (cmd) => {
    store.commands++
    try { return { result: await client.send(cmd) } } catch (e) { return { error: String(e.message) } }
  }
  const rest = http.createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || '[]')
    store.requests++
    if (store.delay) await new Promise((r) => setTimeout(r, store.delay))
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Connection', 'close')
    if (req.headers.authorization !== `Bearer ${store.token}`) { res.statusCode = 401; return res.end('{"error":"unauthorized"}') }
    if (store.down) { res.statusCode = 500; return res.end('{"error":"down"}') }
    if (req.url === '/pipeline') {
      const out = []
      for (const cmd of body) out.push(await run(cmd))
      return res.end(JSON.stringify(out))
    }
    const out = await run(body)
    if (out.error) res.statusCode = 400
    res.end(JSON.stringify(out))
  })
  await new Promise((r) => rest.listen(0, '127.0.0.1', r))
  store.url = `http://127.0.0.1:${rest.address().port}`
  store.stop = async () => { client.end(); rest.close(); server.kill() }
  return store
}
