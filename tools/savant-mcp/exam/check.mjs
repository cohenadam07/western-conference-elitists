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
