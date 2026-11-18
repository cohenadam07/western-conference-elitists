// Serve dist/ the way Vercel does for the spot check: x.json answered from x.json.gz (gzip).
//   node tools/savant-mtchc/serve_dist.mjs [port]
import http from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]))
  if (!p.startsWith(DIST)) { res.writeHead(404); return res.end() }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html')
  const type = TYPES[path.extname(p)] || 'application/octet-stream'
  if (existsSync(p) && statSync(p).isFile()) { res.writeHead(200, { 'content-type': type }); return res.end(readFileSync(p)) }
  if (existsSync(p + '.gz')) { res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip' }); return res.end(readFileSync(p + '.gz')) }
  res.writeHead(404); res.end()
}).listen(+(process.argv[2] || 4317), '127.0.0.1', () => console.log('serving dist on', process.argv[2] || 4317))
