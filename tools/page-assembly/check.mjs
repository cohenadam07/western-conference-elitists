// Every page built from a page-src folder must be exactly what its assembler writes.
//
//   node --test tools/page-assembly/check.mjs        (npm run check:page-src; first in check:savant)
//
// The rule (each page-src/README.md): edit page-src, then run the assembler; never edit an assembled
// page in public/ directly. On Nov 6, 2026 two of the three pages had drifted that way: College Basketball
// Savant's 1.3.0 and 1.4.0, and Basketball Coaching Savant's site ribbon, went into the published page
// only, so running the assembler would have wiped them. This check runs each assembler to a temp file
// (never over the published page) and fails if the output differs from the published page by one byte,
// if a page-src folder exists without an assembler listed here, or if a page-src folder holds a file
// its assembler does not read (an edit there would never reach the page).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PAGES = [
  { tool: 'tools/savant-cbb', page: 'public/college-basketball-savant.html' },
  { tool: 'tools/savant-bcoaching', page: 'public/basketball-coaching-savant.html' },
  { tool: 'tools/savant-cbcoaching', page: 'public/college-basketball-coaching-savant.html' },
]

function pageSrcFolders(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.name === 'page-src') out.push(path.relative(ROOT, path.dirname(p)))
    else out.push(...pageSrcFolders(p))
  }
  return out
}

test('every page-src folder has an assembler and is listed here', () => {
  const found = pageSrcFolders(path.join(ROOT, 'tools')).sort()
  assert.deepEqual(found, PAGES.map((p) => p.tool).sort(), 'a page-src folder was added or removed: list it in PAGES')
  for (const { tool } of PAGES) assert.ok(statSync(path.join(ROOT, tool, 'assemble.py')).isFile(), `${tool}: no assemble.py`)
})

for (const { tool, page } of PAGES) {
  test(`${page} is byte for byte what ${tool}/assemble.py writes`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'page-src-'))
    try {
      const out = path.join(dir, path.basename(page))
      execFileSync('python3', [path.join(ROOT, tool, 'assemble.py'), '--out', out], { cwd: ROOT, stdio: 'pipe' })
      const a = readFileSync(out), b = readFileSync(path.join(ROOT, page))
      if (!a.equals(b)) {
        let i = 0
        while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
        const line = b.subarray(0, i).toString('utf8').split('\n').length
        assert.fail(`${page} differs from ${tool}/assemble.py's output (published ${b.length} bytes, assembled ${a.length}; first difference at byte ${i}, line ${line} of the published page). Edit ${tool}/page-src and run the assembler; never edit the published page directly.`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test(`${tool}/page-src holds only what its assembler reads, and a README`, () => {
    const order = JSON.parse(execFileSync('python3', ['-c', `import importlib.util,json,sys;s=importlib.util.spec_from_file_location('a',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.ORDER))`, path.join(ROOT, tool, 'assemble.py')], { cwd: ROOT }).toString())
    const files = readdirSync(path.join(ROOT, tool, 'page-src')).filter((f) => !f.startsWith('.')).sort()
    const own = order.filter((f) => !f.startsWith('theme:'))
    assert.deepEqual(files, [...own, 'README.md'].sort(), `${tool}/page-src: every file must be in the assembler's ORDER (or be the README)`)
    for (const f of order.filter((x) => x.startsWith('theme:'))) assert.ok(statSync(path.join(ROOT, 'tools/themes', f.slice(6))).isFile(), `${tool}: ${f} is not in tools/themes`)
  })
}
