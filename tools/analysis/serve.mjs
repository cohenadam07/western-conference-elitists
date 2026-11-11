// tools/analysis/serve.mjs — the release and the site, on this machine, for the analysis checks.
//   /assets/<sport>-<table>-<season>.parquet   out/parquet (or ANALYSIS_PARQUET), with HEAD and Range,
//                                              as GitHub's file host serves a release asset
//   anything else                              public/, served the way Vercel serves it (x.json from x.json.gz)
// start() sets DATAROOM_ASSETS and SAVANT_API_ORIGIN so api/_sql.js reads from it, and SQL_TMP for the
// engine's scratch (httpfs and the profile). Call it before importing anything from api/.
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PARQUET = path.resolve(ROOT, process.env.ANALYSIS_PARQUET || 'out/parquet')
export const hasParquet = () => existsSync(PARQUET) && existsSync(path.join(PARQUET, 'nba-shots-2024-25.parquet'))

// A Parquet release asset, as GitHub's file host serves it (HEAD, Range). true when it answered.
export function serveParquet(req, res, url) {
    const m = url.match(/^\/assets\/([a-z]+-[a-z_]+-[0-9a-z-]+\.parquet)$/)
    if (!m) return false
    {
      const f = path.join(PARQUET, m[1])
      if (!existsSync(f)) { res.writeHead(404); res.end(); return true }
      const size = statSync(f).size
      const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/)
      if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' }); res.end(); return true }
      if (range) {
        const a = +range[1], b = Math.min(size - 1, range[2] ? +range[2] : size - 1)
        const buf = Buffer.alloc(b - a + 1)
        const fd = openSync(f, 'r'); readSync(fd, buf, 0, buf.length, a); closeSync(fd)
        res.writeHead(206, { 'content-length': buf.length, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' })
        res.end(buf); return true
      }
      res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' }); res.end(readFileSync(f)); return true
    }
}

export async function start({ log = null } = {}) {
  const PUB = path.join(ROOT, 'public')
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (log) log.push(url)
    if (serveParquet(req, res, url)) return
    const p = path.join(PUB, url)
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body) }
    if (!p.startsWith(PUB)) return send(404, '')
    if (existsSync(p + '.gz')) return send(200, gunzipSync(readFileSync(p + '.gz')))
    if (existsSync(p) && p.endsWith('.json')) return send(200, readFileSync(p))
    send(200, '<!doctype html><title>WCE</title>', 'text/html')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  process.env.DATAROOM_ASSETS = `http://127.0.0.1:${port}/assets`
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${port}`
  process.env.SQL_TMP = process.env.SQL_TMP || mkdtempSync(path.join(os.tmpdir(), 'wce-sql-'))
  return { port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) }
}
