// Regression check for what search engines read: titles, the "What is X?" panels, structured
// data, first-paint text, and the routing in vercel.json that the homepage depends on.
//
//   npm run check:seo        (node --test tools/seo/check.mjs)
//
// It runs the real build step (scripts/lib/seo-build.mjs) on the real pages in public/ and the
// real app shell, into a temporary folder. No network, no keys. It checks the mechanics: that
// each thing is present, well-formed and where it should be. It cannot check that a sentence in
// scripts/lib/seo-content.mjs is still true of the tool it describes. That is a reading job.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, buildSeo } from '../../scripts/lib/seo-build.mjs'
import { ABOUT_MARK, PRODUCTS, SITE, SITE_NAME, TOOLS, YOUTUBE } from '../../scripts/lib/seo-content.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PUBLIC = path.join(ROOT, 'public')
const read = (...p) => readFileSync(path.join(...p), 'utf8')
const vercel = JSON.parse(read(ROOT, 'vercel.json'))

let dist
let report
before(() => {
  // A stand-in for what `vite build` leaves behind: the app shell and the hand-built pages.
  dist = mkdtempSync(path.join(os.tmpdir(), 'wce-seo-'))
  copyFileSync(path.join(ROOT, 'index.html'), path.join(dist, 'index.html'))
  for (const f of readdirSync(PUBLIC)) if (f.endsWith('.html')) copyFileSync(path.join(PUBLIC, f), path.join(dist, f))
  report = buildSeo({ root: ROOT, dist })
})
after(() => rmSync(dist, { recursive: true, force: true }))

const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
const graph = (html) => jsonLd(html).flatMap((d) => d['@graph'] || [d])
const meta = (html, name) => (html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i')) || [])[1]
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1]
const unesc = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const text = (html) => unesc(html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')

// Does an internal link lead somewhere? A file in public/, a page the build writes, or a route.
const ROUTES = new Set([...PAGES.map((p) => p.path), '/player'])
const resolves = (href) => ROUTES.has(href) || existsSync(path.join(PUBLIC, href.replace(/^\//, '')))

test('every Savant tool says its name and what it is', () => {
  for (const [file, t] of Object.entries(TOOLS)) {
    const html = read(dist, file)
    assert.equal(unesc(title(html)), t.title, `${file}: title`)
    assert.ok(t.title.startsWith(`${t.name}:`), `${file}: the title must lead with the product's name`)
    assert.equal(unesc(meta(html, 'description')), t.description, `${file}: description`)
    assert.ok(t.description.length <= 170, `${file}: description is ${t.description.length} characters; search results cut it near 160`)
    assert.equal((html.match(/<meta\s+name="description"/gi) || []).length, 1, `${file}: one description, not two`)
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/${file}">`), `${file}: canonical`)
    assert.ok(unesc(html.match(/property="og:title" content="([^"]*)"/)[1]) === t.title, `${file}: the share title follows the page title`)

    const g = graph(html)
    const app = g.find((n) => n['@type'] === 'WebApplication')
    assert.ok(app, `${file}: no WebApplication in the structured data`)
    assert.equal(app.name, t.name)
    assert.equal(app.url, `${SITE}/${file}`)
    assert.ok(g.some((n) => n['@type'] === 'Organization' && n.name === SITE_NAME && n.sameAs.includes(YOUTUBE)), `${file}: publisher`)
    assert.ok(g.some((n) => n['@type'] === 'BreadcrumbList'), `${file}: breadcrumbs`)
  }
})

test('the "What is X?" panel is on each tool, once, between the landing screen and the tool', () => {
  for (const [file, t] of Object.entries(TOOLS)) {
    const html = read(dist, file)
    assert.equal(html.split(ABOUT_MARK).length - 1, 1, `${file}: the panel should appear exactly once`)
    const body = html.search(/<body[\s>]/i)
    const home = html.indexOf('id="home"', body)
    const panel = html.indexOf('<section class="wce-about')
    const wrap = html.indexOf('<div class="wrap"', body)
    assert.ok(home > body && panel > home && wrap > panel, `${file}: the panel is not between the landing screen and the tool. The page's layout has changed: see brandTool() in seo-build.mjs`)

    const section = html.slice(panel, html.indexOf('</section>', panel))
    const words = text(section)
    assert.ok(words.includes(t.heading) && words.includes(`${t.name} is a free`), `${file}: the panel does not introduce ${t.name}`)
    assert.ok(words.includes(SITE_NAME), `${file}: the panel does not say who makes it`)
    const links = [...section.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    assert.ok(links.length >= 8, `${file}: the panel should link to the other products`)
    assert.ok(!links.includes(`/${file}`), `${file}: the panel links to itself`)
    for (const href of links) assert.ok(resolves(href), `${file}: the panel links to ${href}, which is not a page`)

    // The panel is only for the landing screen. Each tool marks that screen with one of these
    // classes on <body>; if a tool stops using it, the panel would never show.
    assert.match(html, /<body class="(home-open|view-home)"/, `${file}: the landing screen is no longer marked on <body>`)
    // Nothing in public/ is edited: the nightly data pipelines rewrite those files.
    assert.ok(!read(PUBLIC, file).includes('wce-about'), `${file}: the panel was written into public/`)
  }
})

test('the homepage has its own HTML, and unknown URLs get the bare shell', () => {
  const home = read(dist, 'index.html')
  const spa = read(dist, 'spa.html')
  assert.match(home, new RegExp(`<link rel="canonical" href="${SITE}/" />`))
  const g = graph(home)
  const site = g.find((n) => n['@type'] === 'WebSite')
  assert.ok(site && site.name === SITE_NAME && site.url === `${SITE}/`, 'WebSite')
  assert.ok(g.some((n) => n['@type'] === 'Organization' && n.sameAs.includes(YOUTUBE)), 'Organization')
  const list = g.find((n) => n['@type'] === 'ItemList')
  for (const name of ['Basketball Savant', 'Football Savant', 'UFC Savant', 'Coaching Savant', 'Draft Savant', 'Dynasty Exchange']) {
    assert.ok(list.itemListElement.some((i) => i.name === name), `${name} is missing from the homepage's product list`)
    assert.ok(text(home).includes(name), `${name} is not named in the homepage's first-paint text`)
  }
  for (const p of PRODUCTS) {
    assert.ok(resolves(p.href), `PRODUCTS links to ${p.href}, which is not a page`)
    assert.ok(home.includes(`<a href="${p.href}">`), `the homepage does not link to ${p.name}`)
  }

  // The shell every other URL falls back to must claim nothing: no canonical, no text.
  assert.ok(spa.includes('<div id="root"></div>'), 'spa.html should be the untouched shell')
  assert.ok(!spa.includes('rel="canonical"') && !spa.includes('wce-fb') && !spa.includes('ld+json'), 'spa.html carries something that belongs to one page')
  const last = vercel.rewrites.at(-1)
  assert.deepEqual(last, { source: '/((?!api/).*)', destination: '/spa.html' }, 'vercel.json: the catch-all must serve /spa.html. If it serves /index.html again, every unknown URL shows the homepage’s text and canonical')
  assert.match(read(dist, '404.html'), /<meta name="robots" content="noindex" \/>/)
})

test('every static page arrives with text, and its tags match what the page sets once it runs', () => {
  assert.ok(read(ROOT, 'index.html').includes('<div id="root"></div>'), 'index.html: the root div has changed shape, so no page gets first-paint text (withFallback in seo-build.mjs)')
  const sources = readdirSync(path.join(ROOT, 'src', 'pages')).map((f) => read(ROOT, 'src', 'pages', f)).join('\n')
  for (const p of PAGES.filter((x) => x.path !== '/')) {
    const html = read(dist, p.path.slice(1), 'index.html')
    assert.equal(unesc(title(html)), `${p.title} | ${SITE_NAME}`, `${p.path}: title`)
    assert.equal(unesc(meta(html, 'description')), p.description, `${p.path}: description`)
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}${p.path}" />`), `${p.path}: canonical`)
    const fb = html.slice(html.indexOf('<div id="root">'), html.indexOf('</body>'))
    assert.match(fb, new RegExp(`<h1>${(p.name || p.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`), `${p.path}: first-paint heading`)
    assert.ok(text(fb).length > 600, `${p.path}: first-paint text is missing`)
    // The page sets the same title and description itself once React runs (usePageMeta, or by
    // hand on /hoops). If the two drift, Google indexes one and link previews show the other.
    assert.ok(sources.includes(`'${p.title}'`) || sources.includes(`'${p.title} | ${SITE_NAME}'`), `${p.path}: no page in src/pages sets the title "${p.title}"`)
    if (p.path !== '/hoops') assert.ok(sources.includes(p.description), `${p.path}: no page in src/pages sets this description: "${p.description.slice(0, 60)}…"`)
  }
  const dyn = read(dist, 'dynasty', 'index.html')
  assert.ok(graph(dyn).some((n) => n['@type'] === 'WebApplication' && n.name === 'Dynasty Exchange'), '/dynasty: structured data')
  assert.ok(PAGES.find((p) => p.path === '/dynasty').title.startsWith('Dynasty Exchange'), '/dynasty: the title must lead with the name')
})

test('an article arrives with its text', () => {
  const dir = path.join(ROOT, 'src', 'data', 'articles')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const a = JSON.parse(read(dir, f))
    const html = read(dist, 'articles', a.slug, 'index.html')
    assert.ok(html.includes(`<h1>${a.title.replace(/&/g, '&amp;')}</h1>`), `${a.slug}: heading`)
    if (a.html) assert.ok(html.includes(a.html), `${a.slug}: body`)
  }
})

test('short addresses, the sitemap and the Search Console file', () => {
  for (const file of Object.keys(TOOLS)) {
    const short = `/${file.replace(/\.html$/, '')}`
    const r = (vercel.redirects || []).find((x) => x.source === short)
    assert.ok(r && r.destination === `/${file}` && r.permanent === true, `vercel.json: ${short} should redirect to /${file}`)
  }
  const xml = read(dist, 'sitemap.xml')
  for (const file of Object.keys(TOOLS)) assert.ok(xml.includes(`<loc>${SITE}/${file}</loc>`), `sitemap: ${file}`)
  for (const p of PAGES) assert.ok(xml.includes(`<loc>${SITE}${p.path}</loc>`), `sitemap: ${p.path}`)
  assert.ok(!xml.includes('spa.html') && !xml.includes('google'), 'sitemap lists a file that is not a page')
  assert.match(read(PUBLIC, 'robots.txt'), /Sitemap: https:\/\/wcehoops\.com\/sitemap\.xml/)

  // Google Search Console proves ownership by fetching this file. Deleting it un-verifies the site.
  const proofs = readdirSync(PUBLIC).filter((f) => /^google[0-9a-f]+\.html$/.test(f))
  assert.ok(proofs.length >= 1, 'public/ has no Google Search Console verification file')
  for (const f of proofs) assert.equal(read(PUBLIC, f).trim(), `google-site-verification: ${f}`)
  assert.ok(report.some((line) => /sitemap with \d+ URLs/.test(line)))
})
