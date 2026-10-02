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
//   dist/player/<slug>/index.html    a page per Basketball Savant player (player-pages.mjs)
//   dist/sitemap.xml                 every public page, articles with their dates, every player
//   dist/*-savant.html, game.html    favicon, Vercel Analytics, and share tags injected
//                                    (those pages are hand-built HTML outside React, so
//                                    they had none of it). The five Savant tools also get a
//                                    title that says what the tool is, structured data that
//                                    names it, and a "What is X?" panel under the landing
//                                    screen (copy in seo-content.mjs)
//   dist/index.html                  the homepage, with its own canonical, structured data
//                                    and first-paint text
//   dist/spa.html                    the bare app shell. vercel.json sends every URL that has
//                                    no file of its own here (it used to be index.html, which
//                                    is why the homepage could not have a canonical)
//
// React still renders every page; this changes the HTML that arrives before it does. Each
// page it writes carries a few sentences of real text and links to every product inside
// <div id="root">, for crawlers that do not run JavaScript. React replaces that text when
// it mounts, and it is held back for a second and a half, so a visitor only sees it if the
// app is slow to start. Vercel serves these files ahead of the catch-all rewrite in
// vercel.json (verified on a preview deploy), so /articles/<slug> and /newsletter get their
// own HTML. An unknown slug still falls through to the app, which shows Not Found with a
// noindex tag (status 200).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildPlayerPages } from './player-pages.mjs'
import { ABOUT_MARK, FALLBACK_CSS, LEDES, SITE, SITE_NAME, TOOLS, fallbackHtml, homeJsonLd, pageJsonLd, toolAbout, toolJsonLd } from './seo-content.mjs'

export { SITE }
const SITE_DESCRIPTION =
  'Western Conference Elitists — NBA analysis and draft scouting for people who watch the film, plus the Savant tools, which rank NBA and NFL players and UFC fighters by percentile.'
const OG_CARD = `${SITE}/og-card.png` // 1200×630, public/og-card.png

// Flappy Hoops as a home-screen app: its own icon, name and manifest on /hoops, so Add to Home
// Screen (iPhone) or Install (Android, desktop Chrome) opens the game with no browser bars. The
// files ship with the game in public/flappy-hoops/app/; src/pages/FlappyHoops.jsx sets the same
// tags when you reach /hoops from elsewhere on the site.
// The page also runs edge to edge (viewport-fit=cover, and under a see-through status bar as a
// home-screen app): the game fills the whole screen and keeps its buttons clear of the notch itself.
export const HOOPS_APP = {
  name: 'Flappy Hoops', icon: '/flappy-hoops/app/icon-180.png', manifest: '/flappy-hoops/app/manifest.webmanifest',
  viewport: 'width=device-width, initial-scale=1.0, viewport-fit=cover', statusBar: 'black-translucent',
}

// Static pages worth sharing, with the same title/description their component sets via
// usePageMeta (`npm run check:seo` fails if the two drift apart). `title: null` means the
// site default (the home page). `name` is the page's plain name, for the first-paint
// heading, where the title says more than the name.
export const PAGES = [
  { path: '/', title: null, priority: '1.0' }, // sitemap only: dist/index.html is also the SPA fallback
  { path: '/articles', title: 'Analysis', description: 'Scouting breakdowns, team-building theory, and NBA analytics that hold up under pressure.', priority: '0.9' },
  { path: '/newsletter', title: 'The Weekly Board', description: 'The Weekly Board: one board move, one prospect we’re buying or fading, and one stat, in your inbox. Free.', priority: '0.8' },
  { path: '/rankings', title: 'Big Board', description: 'The WCE Big Board — every prospect ranked and tiered, analytics first, scouting always.', priority: '0.8' },
  { path: '/draft', title: 'Draft Hub', description: 'Full scouting profiles, measurements, and role projections for the NBA Draft class.', priority: '0.8' },
  { path: '/news', title: 'News', description: 'The biggest NBA and college basketball stories, plus basketball research and analytics — aggregated and annotated by Western Conference Elitists.', priority: '0.7' },
  { path: '/comp-chain', title: 'Comp Chain', description: 'Hop from one NBA player to another through their statistical comps — a daily game built on Basketball Savant data.', priority: '0.6' },
  { path: '/dynasty', title: 'Dynasty Exchange: Crowd-Priced NBA Dynasty Rankings', name: 'Dynasty Exchange', description: 'Dynasty Exchange is a dynasty basketball trade-value board priced by the crowd. Rank four NBA players at a time and move the market, or paste your roster and see what it is worth.', priority: '0.6' },
  { path: '/hoops', title: 'Flappy Hoops', description: 'Flap it through the rim in as few taps as you can: sixteen cities, nine holes each, a hidden ghost hole in every one. Race up to eight friends online.', priority: '0.5', app: HOOPS_APP },
  { path: '/about', title: 'About', description: 'Who we are and how we work: film-first, data-honest NBA and draft coverage.', priority: '0.5' },
  { path: '/contact', title: 'Contact', description: 'Pitches, scouting disagreements, partnerships — get in touch with Western Conference Elitists.', priority: '0.4' },
  { path: '/privacy', title: 'Privacy Policy', description: 'What wcehoops.com collects, why, who else touches it, and how to get it removed.', priority: '0.2' },
]

// The hand-built tool pages in public/. Descriptions only fill in where a page has none.
// The five Savant tools take their title and description from TOOLS in seo-content.mjs.
const STANDALONE = {
  'basketball-savant.html': { description: 'Percentile sliders, player comparisons, shot charts and on/off data for every NBA player.', sitemap: '0.9' },
  'draft-savant.html': { description: 'Draft prospect profiles, percentiles and comps from Western Conference Elitists.', sitemap: '0.8' },
  'football-savant.html': { sitemap: '0.8' },
  'coaching-savant.html': { sitemap: '0.6' },
  'ufc-savant.html': { sitemap: '0.7' },
  'game.html': { share: false }, // one template for many games (query string); no canonical, no sitemap
}

const TOOL_SCRIPT_MARK = '<!-- player links: added at build by scripts/lib/seo-build.mjs -->'

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

function appHead(html, app) {
  html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" sizes="180x180" href="${esc(app.icon)}" />`)
  html = setMeta(html, 'name', 'apple-mobile-web-app-title', app.name)
  html = setMeta(html, 'name', 'apple-mobile-web-app-capable', 'yes')
  html = setMeta(html, 'name', 'mobile-web-app-capable', 'yes')
  html = setMeta(html, 'name', 'apple-mobile-web-app-status-bar-style', app.statusBar)
  html = setMeta(html, 'name', 'viewport', app.viewport)
  return setLink(html, 'manifest', app.manifest)
}

function pageHtml(shell, { title, description, url, image = OG_CARD, type = 'website', extraHead = '', app = null, fallback = '' }) {
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
  if (app) html = appHead(html, app)
  if (extraHead) html = html.replace('</head>', `${extraHead}\n  </head>`)
  if (fallback) html = withFallback(html, fallback)
  return html
}

// Put first-paint text inside the app's root div (see FALLBACK_CSS in seo-content.mjs for when
// a visitor would ever see it). If the shell's root div ever changes shape this does nothing,
// and `npm run check:seo` says so.
const ROOT_DIV = '<div id="root"></div>'
function withFallback(html, fallback) {
  if (!html.includes(ROOT_DIV)) return html
  return html.replace('</head>', `    ${FALLBACK_CSS}\n  </head>`).replace(ROOT_DIV, `<div id="root">\n    ${fallback}\n    </div>`)
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

// A Savant tool's own <title> is its name and nothing else ("Football Savant — WCE"), and its
// landing screen is a search box. Give the page a title and description that say what the tool
// is, structured data that names it, and the "What is X?" panel under the landing screen. This
// runs before decorateStandalone, so the share tags it adds pick up the new title.
function brandTool(html, file) {
  const t = TOOLS[file]
  if (!t) return html
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(t.title)}</title>`)
  const desc = `<meta name="description" content="${esc(t.description)}"/>`
  html = /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i.test(html)
    ? html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, desc)
    : html.replace(/<\/title>/, `</title>\n${desc}`)
  if (!html.includes('application/ld+json')) html = html.replace(/<\/head>/i, `${toolJsonLd(file)}\n</head>`)
  // The panel goes between the landing screen and the tool itself: straight before the first
  // <div class="wrap"> in the body.
  if (!html.includes(ABOUT_MARK)) {
    const body = html.search(/<body[\s>]/i)
    const at = body === -1 ? -1 : html.indexOf('<div class="wrap"', body)
    if (at === -1) console.error(`\n  seo: no place found for the about panel in ${file} — the page ships without it\n`)
    else html = html.slice(0, at) + toolAbout(file) + html.slice(at)
  }
  return html
}

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
    const byline = [a.author, a.date].filter(Boolean).join(' · ')
    const fallback = fallbackHtml({ route: `/articles/${a.slug}`, h1: a.title, paras: [byline, a.excerpt].filter(Boolean), bodyHtml: a.html || '' })
    write(dist, `articles/${a.slug}/index.html`, pageHtml(shell, { title: a.title, description: a.excerpt, url, image, type: 'article', extraHead: extra, fallback }))
  }
  report.push(`${articles.length} article page${articles.length === 1 ? '' : 's'}`)

  // Key static pages. Not '/': dist/index.html doubles as the fallback for every other
  // URL, so it must not claim a canonical of its own (usePageMeta sets one in the browser).
  const statics = PAGES.filter((p) => p.path !== '/')
  for (const p of statics) {
    const fallback = fallbackHtml({ route: p.path, h1: p.name || p.title, paras: LEDES[p.path] || [p.description] })
    const ld = pageJsonLd(p.path, p.description)
    write(dist, `${p.path.slice(1)}/index.html`, pageHtml(shell, { title: p.title, description: p.description, url: `${SITE}${p.path}`, app: p.app, fallback, extraHead: ld && `    ${ld}` }))
  }
  report.push(`${statics.length} static pages`)

  // The homepage and the app shell part ways here. dist/index.html used to be both, so it could
  // carry nothing that was only true of the homepage. Now the bare shell is spa.html (what
  // vercel.json serves for any URL with no file of its own) and index.html is the homepage:
  // canonical, who we are and what we make as structured data, and every product by name.
  write(dist, 'spa.html', shell)
  write(dist, 'index.html', pageHtml(shell, {
    title: null,
    url: `${SITE}/`,
    extraHead: `    ${homeJsonLd()}`,
    fallback: fallbackHtml({ route: '/', h1: SITE_NAME, paras: [SITE_DESCRIPTION] }),
  }))

  // 404 — same shell, told not to be indexed. React renders the Not Found page.
  let notFound = shell.replace(/<title>[\s\S]*?<\/title>/, `<title>Page Not Found | ${SITE_NAME}</title>`)
  notFound = notFound.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>')
  write(dist, '404.html', notFound)

  // A page per Basketball Savant player. A failure here must not take the whole deploy down
  // with it (the data bots push to main all day), so it is logged loudly and the site ships
  // without player pages instead. `npm run check:players` reproduces it locally.
  let players = null
  try {
    players = buildPlayerPages({ root, dist, site: SITE })
    report.push(`${players.count} player pages (${(players.bytes / 1e6).toFixed(1)} MB)`)
    if (players.skipped.length) console.error(`\n  seo: ${players.skipped.length} player page(s) not built — ${players.skipped.join('; ')}\n`)
  } catch (e) {
    rmSync(path.join(dist, 'player'), { recursive: true, force: true }) // all or nothing: no orphaned pages
    console.error(`\n  seo: PLAYER PAGES SKIPPED — ${e && e.stack ? e.stack : e}\n`)
    report.push('player pages SKIPPED (see error above)')
  }

  // Hand-built pages
  let decorated = 0
  for (const [file, meta] of Object.entries(STANDALONE)) {
    const p = path.join(dist, file)
    if (!existsSync(p)) continue
    const before = readFileSync(p, 'utf8')
    let after = decorateStandalone(brandTool(before, file), file, meta)
    // Basketball Savant gets the script that ties it to the player pages (player-links.client.js),
    // straight after its own script so it is in place before the data finishes loading.
    if (file === 'basketball-savant.html' && players && !after.includes(TOOL_SCRIPT_MARK)) {
      const tag = `${TOOL_SCRIPT_MARK}\n<script>\n${players.toolScript}</script>\n`
      const at = after.lastIndexOf('</body>')
      if (at !== -1) after = after.slice(0, at) + tag + after.slice(at)
    }
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
    // lastmod is the day the data was generated, not the day of the build: the pages only
    // change when the numbers do, and a sitemap that says "today" on every deploy gets ignored.
    ...(players ? players.urls.map((u) => ({ ...u, lastmod: u.lastmod || today })) : []),
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
