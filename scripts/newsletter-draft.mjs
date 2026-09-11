#!/usr/bin/env node
/**
 * newsletter-draft.mjs — start this week's Weekly Board as a Buttondown draft.
 *
 *   npm run newsletter-draft                     # digest of articles from the last 7 days
 *   npm run newsletter-draft -- --days 14        # …or a different window
 *   npm run newsletter-draft -- <slug> [slug…]   # exactly these articles (one = feature issue)
 *   npm run newsletter-draft -- --subject "…"    # override the subject line
 *   npm run newsletter-draft -- --dry-run        # build it and open a preview, send nothing
 *
 * Needs BUTTONDOWN_API_KEY in your environment or in .env.local (gitignored).
 * Nothing is ever sent from here — the draft waits in Buttondown for you.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDraft, createButtondownDraft, loadArticles, readApiKey } from './lib/newsletter.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
// --dry-run and --help are switches; --days and --subject take a value.
const bool = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return false
  argv.splice(i, 1)
  return true
}
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`✗ --${name} needs a value`)
    process.exit(1)
  }
  argv.splice(i, 2)
  return v
}
const dryRun = bool('dry-run')
const help = bool('help')
const days = Number(value('days') ?? 7)
const subject = value('subject')
if (!Number.isFinite(days) || days <= 0) {
  console.error('✗ --days must be a positive number')
  process.exit(1)
}
if (help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''))
  process.exit(0)
}
const slugs = argv.filter((a) => !a.startsWith('--'))

const all = loadArticles(ROOT)
let picked
if (slugs.length) {
  const missing = slugs.filter((s) => !all.some((a) => a.slug === s))
  if (missing.length) {
    console.error(`✗ No published article with slug: ${missing.join(', ')}`)
    console.error(`  Published: ${all.map((a) => a.slug).join(', ') || '(none)'}`)
    process.exit(1)
  }
  picked = slugs.map((s) => all.find((a) => a.slug === s))
} else {
  const since = Date.now() - days * 86400000
  picked = all.filter((a) => new Date(a.publishedAt || a.date).getTime() >= since)
  if (!picked.length) {
    console.error(`✗ Nothing published in the last ${days} days.`)
    if (all[0]) console.error(`  Latest is "${all[0].title}" (${all[0].date}). Pass its slug, or widen with --days.`)
    process.exit(1)
  }
}

const draft = buildDraft(picked, { subject })

if (dryRun) {
  const file = path.join(os.tmpdir(), 'weekly-board-preview.html')
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${draft.subject}</title><body style="max-width:640px;margin:40px auto;font:16px/1.6 Georgia,serif;padding:0 16px"><h1>${draft.subject}</h1>${draft.body}</body>`)
  console.log(`\nDry run — nothing sent to Buttondown.`)
  console.log(`  subject   ${draft.subject}`)
  console.log(`  articles  ${picked.map((a) => a.slug).join(', ')}`)
  console.log(`  preview   ${file}\n`)
  process.exit(0)
}

const key = readApiKey(ROOT)
if (!key) {
  console.error('✗ BUTTONDOWN_API_KEY not found. Put it in .env.local (gitignored) or export it, or use --dry-run.')
  process.exit(1)
}

try {
  const email = await createButtondownDraft(draft, key)
  console.log(`\n✓ Draft created in Buttondown: "${draft.subject}"`)
  console.log(`  ${picked.length} article${picked.length === 1 ? '' : 's'}: ${picked.map((a) => a.slug).join(', ')}`)
  if (email?.id) console.log(`  id ${email.id}`)
  console.log(`  Open Buttondown → Emails → Drafts to edit and send.\n`)
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
