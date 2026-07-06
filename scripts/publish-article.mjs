#!/usr/bin/env node
/**
 * publish-article.mjs — turn a Word (.docx) file into a published article.
 *
 * Usage:
 *   npm run publish-article -- <file.docx> [options]
 *
 * Options (all optional — sensible defaults are derived from the document):
 *   --title    "..."   Override the headline (default: first bold line / Heading)
 *   --category "..."   Section label (default: NBA). Should match one of the
 *                      site categories in src/data/content.js.
 *   --author   "..."   Byline (default: name on the first line, else the site founder)
 *   --excerpt  "..."   Dek / summary (default: first paragraph, trimmed)
 *   --date     "..."   Display date, e.g. "Jul 6, 2026" (default: today)
 *   --slug     "..."   URL slug (default: derived from the title)
 *
 * What it does:
 *   1. Converts the .docx to clean HTML with mammoth.
 *   2. Extracts embedded images to public/articles/<slug>/ and rewrites their src.
 *   3. Pulls out title / author / excerpt / read time.
 *   4. Writes src/data/articles/<slug>.json — which the site picks up automatically.
 *
 * The article then appears at /articles and /articles/<slug> with no further edits.
 */

import { writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mammoth from 'mammoth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ARTICLES_DATA_DIR = path.join(ROOT, 'src', 'data', 'articles')
const PUBLIC_ARTICLES_DIR = path.join(ROOT, 'public', 'articles')

// ── args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true
      } else {
        opts[key] = next
        i++
      }
    } else {
      positional.push(a)
    }
  }
  return { opts, positional }
}

const { opts, positional } = parseArgs(process.argv.slice(2))
const input = positional[0]

if (!input || opts.help) {
  console.log(`\nPublish a Word document as an article.\n\n  npm run publish-article -- <file.docx> [--category "Analytics"] [--title "..."]\n\nSee scripts/publish-article.mjs for all options.\n`)
  process.exit(input ? 0 : 1)
}

const inputPath = path.resolve(process.cwd(), input)
if (!existsSync(inputPath)) {
  console.error(`✗ File not found: ${input}`)
  process.exit(1)
}

// ── helpers ───────────────────────────────────────────────────────────────
const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')

const SLUG_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'on', 'in', 'to', 'for',
  'and', 'or', 'but', 'our', 'we', 'what', 'does', 'do', 'as', 'at', 'by', 'it',
])

function slugify(text) {
  let words = decodeEntities(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 10) // keep slugs readable
  // Drop dangling stopwords so slugs don't end mid-thought (…best-player-on).
  while (words.length > 3 && SLUG_STOPWORDS.has(words[words.length - 1])) words.pop()
  return words.join('-')
}

function todayDisplay() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Extract the top-level block elements mammoth emits, in order.
function tokenizeBlocks(html) {
  const re = /<(p|h[1-6]|ul|ol|blockquote|table|figure)\b[^>]*>[\s\S]*?<\/\1>|<hr\s*\/?>/gi
  return html.match(re) || []
}

// Trim whitespace/tab noise Word leaves behind inside a block.
function cleanBlock(block) {
  return block
    .replace(/<strong>\s*<\/strong>/gi, '')       // empty bold runs
    .replace(/<em>\s*<\/em>/gi, '')
    .replace(/(<(?:p|h[1-6]|li|blockquote)[^>]*>)[\s \t]+/gi, '$1') // leading ws
    .replace(/[\s \t]+(<\/(?:p|h[1-6]|li|blockquote)>)/gi, '$1')    // trailing ws
    .trim()
}

const isEmptyBlock = (block) => stripTags(block).replace(/[\s ]/g, '') === ''
const isImageOnly = (block) => /<img/i.test(block) && stripTags(block).trim() === ''
// A whole line rendered bold — Word's usual "title" convention.
const isBoldLine = (block) =>
  /^<p[^>]*>\s*<strong>[\s\S]*<\/strong>\s*<\/p>$/i.test(block) && !/<img/i.test(block)
const isHeading = (block) => /^<h[1-3]\b/i.test(block)

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  // Derive the slug first (we need it for the image output directory), but the
  // title may come from the document — so do a provisional conversion, decide
  // the title, then re-key images under the final slug.
  const baseName = path.basename(inputPath).replace(/\.docx$/i, '')

  // First pass: convert with a placeholder image handler so we can read the text
  // and settle on a title/slug before we commit images to disk.
  const probe = await mammoth.convertToHtml({ path: inputPath })
  let blocks = tokenizeBlocks(probe.value).map(cleanBlock).filter((b) => !isEmptyBlock(b) || isImageOnly(b))

  // --- Title ---
  let titleText = typeof opts.title === 'string' ? opts.title : null
  let titleIdx = -1
  if (!titleText) {
    titleIdx = blocks.findIndex(isHeading)
    if (titleIdx === -1) titleIdx = blocks.findIndex(isBoldLine)
    if (titleIdx !== -1) titleText = decodeEntities(stripTags(blocks[titleIdx])).trim()
  }
  if (!titleText) titleText = baseName
  const slug = opts.slug ? slugify(String(opts.slug)) : slugify(titleText)

  // --- Author --- anything above the title that looks like a short name line.
  let author = typeof opts.author === 'string' ? opts.author : null
  const preTitle = titleIdx > 0 ? blocks.slice(0, titleIdx) : []
  if (!author) {
    const nameLine = preTitle
      .map((b) => decodeEntities(stripTags(b)).trim())
      .find((t) => t && wordCount(t) <= 5 && !/[.!?:]$/.test(t) && !/<img/i.test(t))
    if (nameLine) author = nameLine
  }

  // Body = everything after the title (drop the title + any pre-title byline noise).
  let bodyBlocks = titleIdx === -1 ? blocks : blocks.slice(titleIdx + 1)
  bodyBlocks = bodyBlocks.filter((b) => !isEmptyBlock(b) || isImageOnly(b))

  // --- Excerpt --- first substantial text paragraph.
  let excerpt = typeof opts.excerpt === 'string' ? opts.excerpt : null
  if (!excerpt) {
    const firstText = bodyBlocks.map((b) => decodeEntities(stripTags(b)).trim()).find((t) => wordCount(t) >= 8)
    if (firstText) {
      excerpt = firstText.length > 240 ? firstText.slice(0, 237).replace(/\s+\S*$/, '') + '…' : firstText
    }
  }
  if (!excerpt) excerpt = titleText

  // Second pass: real image extraction, now that we know the slug.
  const outImgDir = path.join(PUBLIC_ARTICLES_DIR, slug)
  await rm(outImgDir, { recursive: true, force: true })
  let imgCount = 0
  const extToNum = new Map()
  const convertImage = mammoth.images.imgElement(async (image) => {
    const buffer = await image.read()
    const ext = (image.contentType && image.contentType.split('/')[1]) || 'png'
    imgCount++
    const fname = `img-${imgCount}.${ext === 'jpeg' ? 'jpg' : ext}`
    if (!existsSync(outImgDir)) await mkdir(outImgDir, { recursive: true })
    await writeFile(path.join(outImgDir, fname), buffer)
    extToNum.set(fname, true)
    return { src: `/articles/${slug}/${fname}`, alt: image.altText || '' }
  })

  const full = await mammoth.convertToHtml({ path: inputPath }, { convertImage })
  let allBlocks = tokenizeBlocks(full.value).map(cleanBlock).filter((b) => !isEmptyBlock(b) || isImageOnly(b))
  // Re-drop title/pre-title using the same index logic on the real output.
  let realTitleIdx = -1
  if (typeof opts.title !== 'string') {
    realTitleIdx = allBlocks.findIndex(isHeading)
    if (realTitleIdx === -1) realTitleIdx = allBlocks.findIndex(isBoldLine)
  } else {
    realTitleIdx = allBlocks.findIndex((b) => decodeEntities(stripTags(b)).trim() === opts.title.trim())
  }
  let finalBody = realTitleIdx === -1 ? allBlocks : allBlocks.slice(realTitleIdx + 1)
  finalBody = finalBody.filter((b) => !isEmptyBlock(b) || isImageOnly(b))

  const html = finalBody.join('\n')
  const words = wordCount(stripTags(html))
  const readTime = `${Math.max(1, Math.round(words / 200))} min read`

  const category = typeof opts.category === 'string' ? opts.category : 'NBA'
  const date = typeof opts.date === 'string' ? opts.date : todayDisplay()

  const record = {
    slug,
    title: decodeEntities(titleText),
    category,
    excerpt: decodeEntities(excerpt),
    author: author || null,
    date,
    // ISO stamp drives newest-first ordering; `date` is what's shown.
    publishedAt: new Date().toISOString(),
    readTime,
    html,
  }

  if (!existsSync(ARTICLES_DATA_DIR)) await mkdir(ARTICLES_DATA_DIR, { recursive: true })
  const outFile = path.join(ARTICLES_DATA_DIR, `${slug}.json`)
  await writeFile(outFile, JSON.stringify(record, null, 2) + '\n')

  console.log(`\n✓ Published: ${record.title}`)
  console.log(`  slug      ${slug}`)
  console.log(`  category  ${category}`)
  console.log(`  author    ${author || '(site founder)'}`)
  console.log(`  date      ${date}   ·   ${readTime}   ·   ${words} words`)
  console.log(`  images    ${imgCount} → public/articles/${slug}/`)
  console.log(`  data      src/data/articles/${slug}.json`)
  console.log(`\n  Preview at  /articles/${slug}\n`)
}

main().catch((err) => {
  console.error('\n✗ Failed to publish article:\n', err)
  process.exit(1)
})
