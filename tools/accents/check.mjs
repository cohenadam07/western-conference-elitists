// tools/accents/check.mjs — no Savant shows a player under a de-accented spelling of a name it also
// publishes with accents (pipeline/accents.py; Nov 2026: 15 NBA, 1 NFL, 1 college football repaired).
//   node --test tools/accents/check.mjs      (part of npm run check:savant)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('no player is shown with the accents stripped from a name published with them', () => {
  const out = execFileSync('python3', [path.join(ROOT, 'tools/accents/audit.py')], { encoding: 'utf8' })
  const lines = out.split('\n').filter((l) => /players shown de-accented/.test(l))
  assert.equal(lines.length, 4, 'four Savants audited')
  for (const l of lines) assert.match(l, /: 0 players shown de-accented/, l)
})

test('the rule: same letters keep the accents, different letters go through', () => {
  const r = execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'pipeline'))})
import accents as A
print(A.keep_accents('Audric Estime', {'Audric Estimé'}), '|', A.keep_accents('Audric Estimes', {'Audric Estimé'}), '|', A.keep_accents('Ché Ojarikre', {'Che Ojarikre'}))`], { encoding: 'utf8' }).trim()
  assert.equal(r, 'Audric Estimé | Audric Estimes | Ché Ojarikre')
})
