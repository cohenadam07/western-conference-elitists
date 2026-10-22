// Does the AI connector still reach everything on the site?
//
//   node --test tools/savant-mcp/coverage.mjs        (npm run check:connector-coverage)
//
// The connector is meant to cover the whole public site (Adam, Oct 2026: "the mcp can access
// EVERYTHING"). Pages keep growing, so this check finds the site's features on its own, every
// time it runs, and holds each one to tools/savant-mcp/coverage.json, which says which tool
// answers it or why it is left out:
//
//   page:<file>#<function>   every render…/open…/show… function in a static Savant page or
//                            its scripts (public/*.html, public/*.js): one view a fan can open
//   data:<name>              every data file and data folder in public/: a page's data
//   route:<path>             every route of the React site (src/App.jsx)
//   api:<file>               every public endpoint in api/ (files without a leading _)
//   page:<file>              every static page in public/
//
// It fails when the site has something the manifest does not mention (a new feature with no
// tool yet), when the manifest names something the site no longer has, or when it names a
// tool the connector no longer declares. The weekly scheduled run reads this failure as its
// to-do list: it builds the missing tools and opens a pull request for Adam to approve.
//
// No data is loaded: it reads file names and source text, so it takes a second.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const MANIFEST = path.join(ROOT, 'tools/savant-mcp/coverage.json')

// What a fan can reach on the site, found from the source rather than listed by hand.
export function discover() {
  const found = new Map()   // key -> where it was found
  const add = (key, where) => { if (!found.has(key)) found.set(key, where) }
  const skipExt = /\.(png|jpe?g|webp|svg|ico|gif|mp3|mp4|woff2?|txt|xml|gz|b64)$/i
  for (const name of readdirSync(PUBLIC)) {
    if (skipExt.test(name) || name.startsWith('.')) continue
    const full = path.join(PUBLIC, name)
    if (statSync(full).isDirectory()) { add(`data:${name}`, `public/${name}/`); continue }
    if (name.endsWith('.html')) {
      add(`page:${name}`, `public/${name}`)
      for (const m of readFileSync(full, 'utf8').matchAll(/\bfunction\s+((?:render|open|show)[A-Z]\w*)\s*\(/g)) add(`page:${name}#${m[1]}`, `public/${name}`)
      continue
    }
    if (name.endsWith('.js')) {
      for (const m of readFileSync(full, 'utf8').matchAll(/\bfunction\s+((?:render|open|show)[A-Z]\w*)\s*\(/g)) add(`page:${name}#${m[1]}`, `public/${name}`)
      continue
    }
    if (name.endsWith('.json')) add(`data:${name}`, `public/${name}`)
  }
  const app = readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8')
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) if (m[1] !== '*') add(`route:${m[1]}`, 'src/App.jsx')
  for (const name of readdirSync(path.join(ROOT, 'api'))) {
    if (name.startsWith('_')) continue
    const full = path.join(ROOT, 'api', name)
    if (statSync(full).isDirectory()) { add(`api:${name}/`, `api/${name}/`); continue }
    if (name.endsWith('.js')) add(`api:${name}`, `api/${name}`)
  }
  return found
}

// Every tool the connector declares, by name.
export async function connectorTools() {
  const src = readFileSync(path.join(ROOT, 'api/mcp.js'), 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/import\s*\{\s*tools\s+as\s+\w+\s*\}\s*from\s*'\.\/(_[\w-]+\.js)'/g)) {
    const mod = await import(path.join(ROOT, 'api', m[1]))
    for (const t of mod.tools) names.add(t.name)
  }
  return names
}

test('every feature of the site is answered by a connector tool, or left out on purpose with a reason', async () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const items = manifest.items
  const found = discover()
  const tools = await connectorTools()

  const missing = [...found.keys()].filter((k) => !items[k])
  const gone = Object.keys(items).filter((k) => !found.has(k))
  const problems = []
  for (const [k, v] of Object.entries(items)) {
    if (v.tools) {
      if (!Array.isArray(v.tools) || !v.tools.length) problems.push(`${k}: "tools" must list at least one tool`)
      for (const t of v.tools || []) if (!tools.has(t)) problems.push(`${k}: names ${t}, which the connector does not declare`)
    } else if (v.excluded) {
      if (String(v.excluded).length < 20) problems.push(`${k}: say why it is left out, in a sentence`)
    } else problems.push(`${k}: needs "tools" or "excluded"`)
  }
  const unused = [...tools].filter((t) => !Object.values(items).some((v) => (v.tools || []).includes(t)))

  const lines = []
  if (missing.length) lines.push(`On the site but not in tools/savant-mcp/coverage.json (build a tool, or add it as excluded with a reason):\n${missing.map((k) => `  - ${k}  (${found.get(k)})`).join('\n')}`)
  if (gone.length) lines.push(`In the manifest but no longer on the site (remove them):\n${gone.map((k) => `  - ${k}`).join('\n')}`)
  if (problems.length) lines.push(`Manifest problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  if (unused.length) lines.push(`Tools no feature points to (add them to the item they answer):\n${unused.map((t) => `  - ${t}`).join('\n')}`)
  const covered = Object.values(items).filter((v) => v.tools).length
  const left = Object.values(items).filter((v) => v.excluded).length
  console.log(`      ${found.size} features found on the site: ${covered} answered by the connector's ${tools.size} tools, ${left} left out on purpose`)
  assert.equal(lines.length, 0, `\n${lines.join('\n\n')}\n`)
})
