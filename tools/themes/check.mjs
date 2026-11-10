// The sport themes (tools/themes/README.md) against the flagship pages they come from.
//
//   node --test tools/themes/check.mjs        (npm run check:themes; in check:savant)
//
// 1. Every theme defines the same tokens as the college theme, so a page built against one runs on any.
// 2. A token marked "= --x" holds the flagship's own --x (Basketball Savant for nba/, Football Savant for
//    football/), so a theme cannot drift from the page it imitates. College's tokens are College Basketball
//    Savant's own bytes (its assembler reads them), which tools/page-assembly/check.mjs already holds.
// 3. Each theme's font link is its flagship's.
// 4. shared/frame-narrow.css, copied from College Savant's phone rules, still matches them line for line.
// 5. Every file here is read by something: an assembler's ORDER, or preview.py.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const FLAGSHIP = { nba: 'public/basketball-savant.html', football: 'public/football-savant.html', college: 'public/college-basketball-savant.html' }

// the custom properties of a stylesheet's :root blocks, later blocks winning
function rootVars(css) {
  const out = new Map()
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '')
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim())
  }
  return out
}

const themes = ['college', 'nba', 'football']
const tokens = Object.fromEntries(themes.map((t) => [t, read(`tools/themes/${t}/tokens.css`)]))

test('every theme defines the college theme\'s tokens, no more and no fewer', () => {
  const want = [...rootVars(tokens.college).keys()].sort()
  assert.ok(want.length > 40, 'the college tokens did not parse')
  for (const t of themes) assert.deepEqual([...rootVars(tokens[t]).keys()].sort(), want, `${t}/tokens.css`)
})

test('a token marked "= --x" is the flagship\'s own --x', () => {
  for (const t of ['nba', 'football']) {
    const page = rootVars(read(FLAGSHIP[t]))
    const marked = [...tokens[t].matchAll(/(--[\w-]+):([^;]+);\/\* = (--[\w-]+) \*\//g)]
    assert.ok(marked.length >= 10, `${t}: only ${marked.length} tokens are tied to ${FLAGSHIP[t]}`)
    for (const [, ours, val, theirs] of marked) {
      assert.ok(page.has(theirs), `${t}: ${FLAGSHIP[t]} has no ${theirs}`)
      assert.equal(val.trim().toLowerCase(), page.get(theirs).toLowerCase(), `${t}: ${ours} is ${val.trim()}, ${FLAGSHIP[t]}'s ${theirs} is ${page.get(theirs)}`)
    }
  }
})

test('each theme\'s fonts are its flagship\'s', () => {
  for (const t of themes) {
    const href = /href="([^"]+)"/.exec(read(`tools/themes/${t}/fonts.html`))[1]
    assert.ok(read(FLAGSHIP[t]).includes(href), `${t}/fonts.html: ${FLAGSHIP[t]} does not load ${href}`)
  }
})

test('the phone frame is College Savant\'s, line for line', () => {
  const page = read(FLAGSHIP.college)
  const lines = read('tools/themes/shared/frame-narrow.css').split('\n').filter((l) => l.startsWith('  .'))
  assert.ok(lines.length >= 8)
  for (const l of lines) assert.ok(page.includes(l + '\n'), `College Savant's phone rules no longer hold: ${l.trim().slice(0, 60)}`)
})

test('every theme file is read by an assembler or by preview.py', () => {
  const used = new Set()
  for (const tool of ['tools/savant-cbb', 'tools/savant-cbcoaching', 'tools/savant-cfb']) {
    const order = JSON.parse(execFileSync('python3', ['-c', 'import importlib.util,json,sys;s=importlib.util.spec_from_file_location("a",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.ORDER))', path.join(ROOT, tool, 'assemble.py')]).toString())
    for (const f of order) if (f.startsWith('theme:')) used.add(f.slice(6))
  }
  const preview = read('tools/themes/preview.py')
  for (const m of preview.matchAll(/"((?:nba|football|shared|college)\/[\w.-]+)"/g)) used.add(m[1])
  const files = []
  for (const d of readdirSync(HERE)) if (statSync(path.join(HERE, d)).isDirectory()) for (const f of readdirSync(path.join(HERE, d))) files.push(`${d}/${f}`)
  for (const f of files) assert.ok(used.has(f), `tools/themes/${f} is read by nothing`)
})
