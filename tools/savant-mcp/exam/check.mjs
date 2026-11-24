// The analyst exam's self-check, against this repo's files, as part of npm run check:savant.
// Every answerable question in questions.json, asked through the connector (an in-process server on
// public/ and out/dataroom), must come back equal to its gold. The weekly connector-coverage
// workflow runs the same self-check on the live address (exam.mjs check --site https://wcehoops.com).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const hosted = path.join(ROOT, 'out', 'dataroom', 'nfl', 'plays')

test('the analyst exam: every answerable question is answered through the connector', { skip: existsSync(hosted) ? false : 'the release-asset tables are not built on this machine (out/dataroom); the weekly run checks the live site' }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/savant-mcp/exam/exam.mjs'), 'check'], { encoding: 'utf8', timeout: 600000 })
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0]
  console.log(`      ${tail}`)
  assert.equal(r.status, 0, (r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).join('\n') || r.stderr)
})

// --files deployed: the site's files read from the repo at a commit (git show), not over HTTP.
// Held to the checkout at HEAD, where the two must be the same files.
test('a site file read from a commit is the file in that commit; a missing one is named', async () => {
  const { makeFiles } = await import('./lib.mjs')
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const dirty = spawnSync('git', ['status', '--porcelain', 'public/dataroom/catalog.json.gz', 'public/savant-current.json', 'public/cbb/index.json.gz'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  if (!sha || dirty) return   // not a git checkout, or these files are mid-refresh
  const at = makeFiles({ site: 'https://example.invalid', commit: sha }), here = makeFiles({})
  for (const rel of ['dataroom/catalog.json', 'savant-current.json', 'cbb/index.json']) assert.deepEqual(await at.json(rel), await here.json(rel), rel)
  await assert.rejects(() => at.json('no/such/file.json'), /not in the deployed commit/)
})
