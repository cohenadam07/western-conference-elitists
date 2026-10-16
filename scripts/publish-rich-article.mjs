#!/usr/bin/env node
/**
 * Publish a rich article (interactive charts, math boxes, film clips) from its folder.
 *
 *   npm run publish-rich-article -- <slug>
 *
 * Reads public/articles/<slug>/meta.json (title, category, excerpt, date, author?) and
 * public/articles/<slug>/body.json (the blocks), and writes src/data/articles/<slug>.json, the
 * file the site, the sitemap, the newsletter draft and the AI connector all read.
 *
 * The page itself renders from body.json (src/components/rich/RichArticle.jsx). The `html` this
 * writes is the plain reading version of the same words: what search engines see before the
 * page runs, what the connector returns, and what the newsletter quotes. It holds paragraphs and
 * headings only, so the connector's text and the site's words stay identical word for word.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import katex from 'katex'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const slug = process.argv[2]
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error('usage: npm run publish-rich-article -- <slug>   (lower-case words joined by hyphens)')
  process.exit(1)
}
const dir = path.join(root, 'public', 'articles', slug)
for (const f of ['meta.json', 'body.json']) {
  if (!existsSync(path.join(dir, f))) {
    console.error(`missing public/articles/${slug}/${f}`)
    process.exit(1)
  }
}
const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
const body = JSON.parse(readFileSync(path.join(dir, 'body.json'), 'utf8'))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Inline markdown to HTML: bold and italic kept, links reduced to their words (see above).
const inline = (md) =>
  esc(md)
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>')
const SIDES = { case: 'The case', counter: 'The pushback', answer: 'The answer', verdict: 'Where it lands' }

function toHtml(blocks) {
  const out = []
  for (const b of blocks) {
    switch (b.t) {
      case 'p': out.push(`<p>${inline(b.md)}</p>`); break
      case 'h2': out.push(`<h2>${esc(b.text)}</h2>`); break
      case 'h3': out.push(`<h3>${esc(b.text)}</h3>`); break
      case 'quote': out.push(`<p><em>${inline(b.md)}</em></p>`); break
      case 'list': for (const it of b.items) out.push(`<p>${inline(it)}</p>`); break
      case 'argue': out.push(`<h3>${esc(SIDES[b.side] || '')}: ${esc(b.title)}</h3>`, toHtml(b.blocks)); break
      case 'math': out.push(`<h3>The math: ${esc(b.title)}</h3>`, toHtml(b.blocks.filter((x) => x.t !== 'tex' && x.t !== 'table'))); break
      case 'stats': for (const s of b.items) out.push(`<p>${esc(s.label)}: <strong>${esc(s.value)}</strong>${s.sub ? ` (${esc(s.sub)})` : ''}.</p>`); break
      case 'table':
        out.push(`<p><strong>${esc(b.caption)}.</strong></p>`)
        for (const r of b.rows) out.push(`<p>${b.cols.map((c, i) => (i === 0 ? `${esc(r[c.k])}:` : r[c.k] ? `${esc(c.label)} ${esc(r[c.k])}` : '')).filter(Boolean).join(' ').replace(/: /, ': ')}.</p>`)
        break
      case 'chart': out.push(`<p><em>Interactive chart: ${esc(b.title)}.</em> ${b.caption ? esc(b.caption) : ''}</p>`); break
      case 'clip': out.push(`<p><em>Film:</em> ${esc(b.caption)}</p>`); break
      case 'checklist':
        b.items.forEach((it, i) => out.push(`<p><strong>${i + 1}. ${esc(it.metric)}.</strong> Target: ${esc(it.target)}. Last season: ${esc(it.baseline)}. ${esc(it.why)}</p>`))
        break
      default: break
    }
  }
  return out.join('\n')
}

// Formulas are typeset here, once, so readers download KaTeX's stylesheet and fonts but not its
// 260 KB of JavaScript.
let formulas = 0
const typeset = (blocks) => {
  for (const b of blocks) {
    if (b.t === 'tex') {
      b.html = katex.renderToString(b.tex, { displayMode: true, throwOnError: true, strict: 'ignore', output: 'html' })
      formulas++
    }
    if (Array.isArray(b.blocks)) typeset(b.blocks)
  }
}
typeset(body.blocks)
writeFileSync(path.join(dir, 'body.json'), JSON.stringify(body))

const html = toHtml(body.blocks)
const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
const charts = body.blocks.filter((b) => b.t === 'chart').length
const readTime = `${Math.max(1, Math.round(words / 230) + Math.round(charts / 2))} min read`
const article = {
  slug,
  title: meta.title,
  category: meta.category || 'Analytics',
  excerpt: meta.excerpt,
  ...(meta.author ? { author: meta.author } : {}),
  date: meta.date,
  publishedAt: meta.publishedAt || new Date().toISOString(),
  readTime,
  rich: true,
  ...(meta.video ? { video: meta.video } : {}),
  ...(meta.ogImage ? { ogImage: meta.ogImage } : {}),
  html,
}
const outFile = path.join(root, 'src', 'data', 'articles', `${slug}.json`)
writeFileSync(outFile, `${JSON.stringify(article, null, 2)}\n`)
console.log(`\n  rich article  ${meta.title}`)
console.log(`  words         ${words} · ${charts} interactive charts · ${formulas} formulas · ${readTime}`)
console.log(`  data          src/data/articles/${slug}.json`)
console.log(`  body          public/articles/${slug}/body.json\n`)
