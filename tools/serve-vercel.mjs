// Serve dist/ the way Vercel will: vercel.json's redirects, then the files on disk, then the
// rewrites, with the header rules, so the gzip rewrites (/bcs/t/x.json -> x.json.gz with Content-Encoding: gzip, the
// savant-ext and savant-api ones) behave as they do in production. For looking at a branch
// locally before it is pushed.
//
//   npm run build && node tools/serve-vercel.mjs [port] [folder]   ->  http://localhost:4173/  (folder: dist, or public to skip the build)
//
// Path-to-regexp patterns are reduced to what vercel.json uses: literal paths, :name and
// :name(regex) segments, and the catch-all. No API functions: /api/* answers 404.
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] || 4173)
// a second argument serves another folder with the same rules: `public` to look at a page before
// the Vite build (its data folders are already gzipped the way dist/ will be)
const DIST = path.join(ROOT, process.argv[3] || 'dist')
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.gz': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' }

// vercel's pattern -> a RegExp with named groups
function compile(source) {
  let re = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === ':') {
      let j = i + 1
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++
      const name = source.slice(i + 1, j)
      let pattern = '[^/]+'
      if (source[j] === '(') {
        let depth = 0, k = j
        for (; k < source.length; k++) { if (source[k] === '(') depth++; else if (source[k] === ')') { depth--; if (!depth) break } }
        pattern = source.slice(j + 1, k)
        j = k + 1
      }
      let mod = ''
      if (source[j] === '*' || source[j] === '+' || source[j] === '?') { mod = source[j]; j++ }
      re += mod === '*' ? `(?<${name}>(?:${pattern})(?:/(?:${pattern}))*)?` : mod === '+' ? `(?<${name}>(?:${pattern})(?:/(?:${pattern}))*)` : `(?<${name}>${pattern})${mod}`
      i = j
    } else if (c === '(') {
      let depth = 0, k = i
      for (; k < source.length; k++) { if (source[k] === '(') depth++; else if (source[k] === ')') { depth--; if (!depth) break } }
      re += `(${source.slice(i + 1, k)})`
      i = k + 1
    } else { re += c.replace(/[.*+?^${}|[\]\\]/g, '\\$&'); i++ }
  }
  return { re: new RegExp(`^${re}$`) }
}
const fill = (dest, m) => dest.replace(/:([A-Za-z0-9_]+)/g, (_, n) => m.groups?.[n] ?? '')
const redirects = (cfg.redirects || []).map((r) => ({ ...r, ...compile(r.source) }))
const rewrites = (cfg.rewrites || []).map((r) => ({ ...r, ...compile(r.source) }))
const headers = (cfg.headers || []).map((h) => ({ ...h, ...compile(h.source) }))

function serveFile(res, file, extra) {
  const ext = path.extname(file).toLowerCase()
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream')
  // serving public/ before the build: a header rule may promise gzip for a file that is still plain
  if (ext !== '.gz' && /gzip/i.test(extra['Content-Encoding'] || '')) delete extra['Content-Encoding']
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v)
  res.statusCode = 200
  res.end(readFileSync(file))
}

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  for (const r of redirects) { const m = r.re.exec(url); if (m) { res.statusCode = r.permanent ? 308 : 307; res.setHeader('Location', fill(r.destination, m)); return res.end() } }
  const extra = {}
  const applyHeaders = (p) => { for (const h of headers) { if (h.re.test(p)) for (const kv of h.headers) extra[kv.key] = kv.value } }
  applyHeaders(url)
  // Vercel's order: redirects, then the filesystem, then rewrites. A file that exists at the
  // path is served as is; only a path with no file behind it reaches the rewrites (the gzip
  // ones and the SPA catch-all).
  const find = (p) => {
    for (const c of [p, p.endsWith('/') ? p + 'index.html' : null, `${p}.html`].filter(Boolean)) {
      const file = path.join(DIST, c)
      if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return file
    }
    return null
  }
  const direct = find(url)
  if (direct) return serveFile(res, direct, extra)
  let target = url
  for (const r of rewrites) { const m = r.re.exec(url); if (m) { target = fill(r.destination, m); break } }
  if (target !== url) applyHeaders(target)
  const file = find(target)
  if (file) return serveFile(res, file, extra)
  if (url.startsWith('/api/')) { res.statusCode = 404; return res.end('no API functions in the local server') }
  res.statusCode = 404; res.end(`not found: ${url}`)
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${DIST} like Vercel at http://localhost:${PORT}/  (${redirects.length} redirects, ${rewrites.length} rewrites, ${headers.length} header rules)`))
