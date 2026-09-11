// Turns published articles (src/data/articles/*.json) into a Buttondown draft.
// Shared by scripts/newsletter-draft.mjs and `publish-article --newsletter`.
//
// The draft is only a starting point: it lands in Buttondown as a DRAFT and nothing is
// sent until you open it there, edit, and hit send yourself.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export const SITE = 'https://wcehoops.com'
const UTM = 'utm_source=newsletter&utm_medium=email&utm_campaign=weekly-board'

export function loadArticles(root) {
  const dir = path.join(root, 'src', 'data', 'articles')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => new Date(b.publishedAt || b.date) - new Date(a.publishedAt || a.date))
}

// BUTTONDOWN_API_KEY from the environment, else from .env.local / .env in the repo root.
// (Those files are gitignored — never commit the key.)
export function readApiKey(root) {
  if (process.env.BUTTONDOWN_API_KEY) return process.env.BUTTONDOWN_API_KEY
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(/^\s*(?:export\s+)?BUTTONDOWN_API_KEY\s*=\s*["']?([^"'\r\n#]+)["']?/m)
    if (m) return m[1].trim()
  }
  return null
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const articleUrl = (a) => `${SITE}/articles/${a.slug}?${UTM}`

// Site-relative src/href → absolute, so images and links survive the trip into an inbox.
const absolutize = (html) =>
  html.replace(/\s(src|href)="\/(?!\/)/g, (_, attr) => ` ${attr}="${SITE}/`)

// First few blocks of an article: enough to hook, not the whole piece.
function lede(html, maxWords = 180) {
  const blocks = html.match(/<(p|h[2-4]|ul|ol|blockquote|figure)\b[^>]*>[\s\S]*?<\/\1>/gi) || []
  const out = []
  let words = 0
  for (const b of blocks) {
    out.push(b)
    words += b.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
    if (words >= maxWords) break
  }
  return absolutize(out.join('\n'))
}

const byline = (a) => [a.category, a.author ? `by ${a.author}` : null, a.readTime].filter(Boolean).map(esc).join(' · ')

/**
 * @param {object[]} articles  one → a feature issue; several → a digest
 * @returns {{ subject: string, description: string, body: string }}
 */
export function buildDraft(articles, { subject } = {}) {
  if (!articles.length) throw new Error('No articles to build a newsletter from.')

  if (articles.length === 1) {
    const a = articles[0]
    return {
      subject: subject || a.title,
      description: a.excerpt || '',
      body: [
        `<p><em>${byline(a)}</em></p>`,
        lede(a.html || `<p>${esc(a.excerpt)}</p>`),
        `<p><strong><a href="${articleUrl(a)}">Keep reading on WCE →</a></strong></p>`,
      ].join('\n\n'),
    }
  }

  const [lead] = articles
  return {
    subject: subject || `The Weekly Board: ${lead.title}`,
    description: articles.map((a) => a.title).join(' · ').slice(0, 280),
    body: [
      '<p>[Your intro. A couple of sentences on the week, then send them to the reads below.]</p>',
      ...articles.map((a) =>
        [
          `<h2><a href="${articleUrl(a)}">${esc(a.title)}</a></h2>`,
          `<p><em>${byline(a)}</em></p>`,
          `<p>${esc(a.excerpt)}</p>`,
          `<p><a href="${articleUrl(a)}">Read it →</a></p>`,
        ].join('\n')
      ),
      `<hr />\n<p>More at <a href="${SITE}/?${UTM}">wcehoops.com</a>. Forwarded this? <a href="${SITE}/newsletter?${UTM}">Subscribe here</a>.</p>`,
    ].join('\n\n'),
  }
}

/** Create the draft in Buttondown. Throws with Buttondown's own error text on failure. */
export async function createButtondownDraft(draft, apiKey) {
  const res = await fetch('https://api.buttondown.com/v1/emails', {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: draft.subject, body: draft.body, description: draft.description, status: 'draft' }),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const why = json?.detail || json?.code || text.slice(0, 200)
    throw new Error(`Buttondown said ${res.status}: ${why}`)
  }
  return json
}
