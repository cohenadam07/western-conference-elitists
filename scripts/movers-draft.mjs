#!/usr/bin/env node
/**
 * movers-draft.mjs — this week's biggest percentile movers, as a Buttondown draft.
 *
 *   npm run movers-draft                         # compare the two newest snapshots a week apart
 *   npm run movers-draft -- --dry-run            # build it and write a preview, send nothing
 *   npm run movers-draft -- --from 2026-12-03 --to 2026-12-10
 *   npm run movers-draft -- --top 8              # how many risers and fallers (default 5)
 *
 * Needs two snapshots from `npm run savant-snapshot`, at least five days apart. Needs
 * BUTTONDOWN_API_KEY in the environment or .env.local; without it (or with --dry-run) the
 * draft is written to a preview file instead. Nothing is ever sent from here: the draft waits
 * in Buttondown for you to edit and send.
 *
 * Having nothing to report (too early in the season, no second snapshot, nobody moved) is not
 * an error: it says so and exits 0, so the weekly job stays green.
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeMovers, listSeasons, listSnapshots, moversDraft, readSnapshot } from './lib/movers.mjs'
import { createButtondownDraft, readApiKey, SITE } from './lib/newsletter.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) { console.error(`✗ --${name} needs a value`); process.exit(1) }
  return v
}
const top = Number(value('top') ?? 5)
if (!Number.isInteger(top) || top < 1) { console.error('✗ --top must be a whole number, 1 or more'); process.exit(1) }
const MIN_GAP_DAYS = 5

const say = (line) => {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n')
}
const nothing = (why) => { say(`– No movers draft: ${why}.`); process.exit(0) }

const seasonDirs = listSeasons(ROOT) // newest first
if (!seasonDirs.length) nothing('there are no snapshots yet (run `npm run savant-snapshot`)')
const season = seasonDirs[0]
const snaps = listSnapshots(ROOT, season)

const toDay = value('to') || snaps[snaps.length - 1].day
const to = snaps.find((s) => s.day === toDay)
if (!to) { console.error(`✗ No ${season} snapshot for ${toDay}. Have: ${snaps.map((s) => s.day).join(', ')}`); process.exit(1) }
const fromDay = value('from')
const gap = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000
const from = fromDay
  ? snaps.find((s) => s.day === fromDay)
  : [...snaps].reverse().find((s) => gap(s.day, to.day) >= MIN_GAP_DAYS) // newest one at least five days older
if (fromDay && !from) { console.error(`✗ No ${season} snapshot for ${fromDay}. Have: ${snaps.map((s) => s.day).join(', ')}`); process.exit(1) }
if (from && gap(from.day, to.day) <= 0) { console.error(`✗ --from (${from.day}) must be earlier than --to (${to.day})`); process.exit(1) }
if (!from) nothing(`${season} has ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'} and needs two at least ${MIN_GAP_DAYS} days apart`)

const result = computeMovers(readSnapshot(from.file), readSnapshot(to.file), { top })
if (!result.ok) nothing(result.reason)

const draft = moversDraft(result, { site: SITE })
const apiKey = readApiKey(ROOT)
if (flag('dry-run') || !apiKey) {
  const file = path.join(os.tmpdir(), 'weekly-board-movers-preview.html')
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${draft.subject}</title><body style="max-width:640px;margin:40px auto;font:16px/1.6 Georgia,serif;padding:0 16px"><h1>${draft.subject}</h1>${draft.body}</body>`)
  say(`✓ Movers draft built (${result.from} → ${result.to}): ${result.risers.length} risers, ${result.fallers.length} fallers.`)
  say(`  Subject: ${draft.subject}`)
  say(`  Preview: ${file}`)
  if (!apiKey && !flag('dry-run')) say('  Not sent to Buttondown: BUTTONDOWN_API_KEY is not set.')
  process.exit(0)
}

try {
  const made = await createButtondownDraft(draft, apiKey)
  say(`✓ Draft created in Buttondown: “${draft.subject}” (${result.from} → ${result.to}).`)
  say(`  Open Buttondown → Emails → Drafts to edit and send it.${made && made.id ? ` (id ${made.id})` : ''}`)
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
