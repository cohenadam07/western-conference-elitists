// Build-time SEO for a single-page app. Runs after `vite build` writes dist/.
//
// The site is one index.html that React fills in, so every URL used to hand crawlers
// and link-preview bots (iMessage, X, Slack, Discord — none of them run JavaScript)
// the homepage's title, description and image. This plugin writes real HTML for the
// pages people actually share, plus the files search engines look for:
//
//   dist/articles/<slug>/index.html  each article with its own title, dek, canonical,
//                                    Open Graph / Twitter tags and article JSON-LD
//   dist/<page>/index.html           the same for the key static pages (PAGES below)
//   dist/404.html                    noindex shell for any URL the SPA rewrite doesn't catch
//   dist/sitemap.xml                 every public page, articles with their dates
//   dist/*-savant.html, game.html    favicon, Vercel Analytics, and share tags injected
//                                    (those pages are hand-built HTML outside React, so
//                                    they had none of it)
//
// Nothing here changes what a visitor sees. React still renders every page; this only
// changes the HTML that arrives before it does. Vercel serves these files ahead of the
// catch-all rewrite in vercel.json (verified on a preview deploy), so /articles/<slug>
// and /newsletter get their own HTML. An unknown slug still falls through to the app,
// which shows Not Found with a noindex tag (status 200).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const SITE = 'https://wcehoops.com'
const SITE_NAME = 'Western Conference Elitists'
const OG_CARD = `${SITE}/og-card.png` // 1200×630, public/og-card.png

// Static pages worth sharing, with the same title/description their component sets via
// usePageMeta. `title: null` means the site default (the home page).
const PAGES = [
  { path: '/', title: null, priority: '1.0' }, // sitemap only: dist/index.html is also the SPA fallback
  { path: '/articles', title: 'Analysis', description: 'Scouting breakdowns, team-building theory, and NBA analytics that hold up under pressure.', priority: '0.9' },
  { path: '/newsletter', title: 'The Weekly Board', description: 'The Weekly Board: one board move, one prospect we’re buying or fading, and one stat, in your inbox. Free.', priority: '0.8' },
  { path: '/rankings', title: 'Big Board', description: 'The WCE Big Board — every prospect ranked and tiered, analytics first, scouting always.', priority: '0.8' },
  { path: '/draft', title: 'Draft Hub', description: 'Full scouting profiles, measurements, and role projections for the NBA Draft class.', priority: '0.8' },
  { path: '/news', title: 'News', description: 'The biggest NBA and college basketball stories, plus basketball research and analytics — aggregated and annotated by Western Conference Elitists.', priority: '0.7' },
  { path: '/comp-chain', title: 'Comp Chain', description: 'Hop from one NBA player to another through their statistical comps — a daily game built on Basketball Savant data.', priority: '0.6' },
  { path: '/dynasty', title: 'Dynasty Exchange', description: 'Crowd-priced NBA dynasty rankings — rank four players at a time and move the market.', priority: '0.6' },
  { path: '/hoops', title: 'Hoops', priority: '0.5' },
  { path: '/about', title: 'About', description: 'Who we are and how we work: film-first, data-honest NBA and draft coverage.', priority: '0.5' },
  { path: '/contact', title: 'Contact', description: 'Pitches, scouting disagreements, partnerships — get in touch with Western Conference Elitists.', priority: '0.4' },
  { path: '/privacy', title: 'Privacy Policy', description: 'What wcehoops.com collects, why, who else touches it, and how to get it removed.', priority: '0.2' },
]

// The hand-built tool pages in public/. Descriptions only fill in where a page has none.
const STANDALONE = {
  'basketball-savant.html': { description: 'Percentile sliders, player comparisons, shot charts and on/off data for every NBA player.', sitemap: '0.9' },
  'draft-savant.html': { description: 'Draft prospect profiles, percentiles and comps from Western Conference Elitists.', sitemap: '0.8' },
  'football-savant.html': { sitemap: '0.8' },
  'coaching-savant.html': { sitemap: '0.6' },
  'ufc-savant.html': { sitemap: '0.7' },
  'game.html': { share: false }, // one template for many games (query string); no canonical, no sitemap
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Swap a <meta>'s content (by name= or property=), or add it before </head>.
function setMeta(html, attr, key, content) {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="[^"]*"\\s*/?>`, 'i')
  const tag = `<meta ${attr}="${key}" content="${esc(content)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

function setLink(html, rel, href) {
  const re = new RegExp(`<link\\s+rel="${rel}"\\s+href="[^"]*"\\s*/?>`, 'i')
  const tag = `<link rel="${rel}" href="${esc(href)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

function pageHtml(shell, { title, description, url, image = OG_CARD, type = 'website', extraHead = '' }) {
  const full = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | NBA Analysis & Scouting`
  let html = shell.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(full)}</title>`)
  if (description) {
    html = setMeta(html, 'name', 'description', description)
    html = setMeta(html, 'property', 'og:description', description)
    html = setMeta(html, 'name', 'twitter:description', description)
  }
  html = setMeta(html, 'property', 'og:title', full)
  html = setMeta(html, 'name', 'twitter:title', full)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'property', 'og:type', type)
  html = setMeta(html, 'property', 'og:image', image)
  html = setMeta(html, 'name', 'twitter:image', image)
  html = setLink(html, 'canonical', url)
  if (extraHead) html = html.replace('</head>', `${extraHead}\n  </head>`)
  return html
}

function write(dist, rel, html) {
  const file = path.join(dist, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, html)
}

function loadArticles(root) {
  const dir = path.join(root, 'src', 'data', 'articles')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
}

const VA_SNIPPET = [
  '<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>',
  '<script defer src="/_vercel/insights/script.js"></script>',
]

// Add what a hand-built page is missing; never touch what it already has.
function decorateStandalone(html, file, meta) {
  const add = []
  if (!/rel="icon"/i.test(html)) {
    add.push(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
    )
  }
  if (!html.includes('/_vercel/insights/script.js')) add.push(...VA_SNIPPET)
  if (meta.share !== false) {
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || SITE_NAME
    const described = /<meta\s+name="description"/i.test(html)
    const description = described ? html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)[1] : meta.description
    const url = `${SITE}/${file}`
    if (!described && description) add.push(`<meta name="description" content="${esc(description)}">`)
    if (!/property="og:title"/i.test(html)) {
      add.push(
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="${SITE_NAME}">`,
        `<meta property="og:title" content="${title}">`,
        ...(description ? [`<meta property="og:description" content="${description}">`] : []),
        `<meta property="og:url" content="${url}">`,
        `<meta property="og:image" content="${OG_CARD}">`,
        `<meta name="twitter:card" content="summary_large_image">`
      )
    }
    if (!/rel="canonical"/i.test(html)) add.push(`<link rel="canonical" href="${url}">`)
  }
  if (!add.length) return html
  const block = `\n<!-- added at build by scripts/lib/seo-build.mjs -->\n${add.join('\n')}\n`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}</head>`)
  // No <head> tag: insert right after the first real <title>…</title>.
  const end = html.indexOf('</title>')
  return end === -1 ? html : html.slice(0, end + 8) + block + html.slice(end + 8)
}

export function buildSeo({ root, dist }) {
  const shell = readFileSync(path.join(dist, 'index.html'), 'utf8')
  const report = []

  // Articles
  const articles = loadArticles(root)
  for (const a of articles) {
    const url = `${SITE}/articles/${a.slug}`
    const image = a.ogImage ? new URL(a.ogImage, SITE).href : OG_CARD
    const published = a.publishedAt || undefined
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: a.title,
      description: a.excerpt,
      image: [image],
      datePublished: published,
      author: { '@type': 'Person', name: a.author || 'Western Conference Elitists' },
      publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE}/wce-logo-512.png` } },
      mainEntityOfPage: url,
    }
    let extra = `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
    if (published) extra = `    <meta property="article:published_time" content="${esc(published)}" />\n${extra}`
    write(dist, `articles/${a.slug}/index.html`, pageHtml(shell, { title: a.title, description: a.excerpt, url, image, type: 'article', extraHead: extra }))
  }
  report.push(`${articles.length} article page${articles.length === 1 ? '' : 's'}`)

  // Key static pages. Not '/': dist/index.html doubles as the fallback for every other
  // URL, so it must not claim a canonical of its own (usePageMeta sets one in the browser).
  const statics = PAGES.filter((p) => p.path !== '/')
  for (const p of statics) {
    write(dist, `${p.path.slice(1)}/index.html`, pageHtml(shell, { title: p.title, description: p.description, url: `${SITE}${p.path}` }))
  }
  report.push(`${statics.length} static pages`)

  // 404 — same shell, told not to be indexed. React renders the Not Found page.
  let notFound = shell.replace(/<title>[\s\S]*?<\/title>/, `<title>Page Not Found | ${SITE_NAME}</title>`)
  notFound = notFound.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>')
  write(dist, '404.html', notFound)

  // Hand-built pages
  let decorated = 0
  for (const [file, meta] of Object.entries(STANDALONE)) {
    const p = path.join(dist, file)
    if (!existsSync(p)) continue
    const before = readFileSync(p, 'utf8')
    const after = decorateStandalone(before, file, meta)
    if (after !== before) { writeFileSync(p, after); decorated++ }
  }
  report.push(`${decorated} standalone pages decorated`)

  // Sitemap
  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    ...PAGES.map((p) => ({ loc: `${SITE}${p.path}`, priority: p.priority, lastmod: today })),
    ...articles
      .sort((x, y) => new Date(y.publishedAt || 0) - new Date(x.publishedAt || 0))
      .map((a) => ({ loc: `${SITE}/articles/${a.slug}`, priority: '0.8', lastmod: (a.publishedAt || '').slice(0, 10) || today })),
    ...Object.entries(STANDALONE)
      .filter(([f, m]) => m.sitemap && existsSync(path.join(dist, f)))
      .map(([f, m]) => ({ loc: `${SITE}/${f}`, priority: m.sitemap, lastmod: today })),
  ]
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n'
  writeFileSync(path.join(dist, 'sitemap.xml'), xml)
  report.push(`sitemap with ${urls.length} URLs`)
  return report
}

// Vite plugin wrapper. Build only; dev server is untouched.
export default function seoBuild() {
  let root
  let dist
  return {
    name: 'wce-seo-build',
    apply: 'build',
    configResolved(c) {
      root = c.root
      dist = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      const report = buildSeo({ root, dist })
      console.log(`\n  seo: ${report.join(' · ')}`)
    },
  }
}
