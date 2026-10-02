// The site's own words, cut up for machines. Runs after `vite build` writes dist/.
//
// The Savant slicers exist so an AI can quote the number a fan sees on a card. This one
// exists so it can quote what a visitor reads on the rest of the site: the News page's wire,
// WCE's published articles, the draft Big Board, and who is listed on the Dynasty Exchange.
// None of that is a statistic, so nothing here is ranked or computed. The promise is a
// different one: what these files hold is what the site shows, word for word, with nothing
// added and no template copy let through.
//
//   dist/savant-api/site/v1/meta.json                what is here, and what was left out and why
//   dist/savant-api/site/v1/news.json                the News page's two lists, with the stamp
//                                                    the news pipeline put on them
//   dist/savant-api/site/v1/articles.json            every published article's card
//   dist/savant-api/site/v1/articles/<slug>.json.gz  one article's words
//   dist/savant-api/site/v1/big-board.json           the Big Board, every year the page offers
//   dist/savant-api/site/v1/dynasty.json             the names on the Dynasty Exchange, and the
//                                                    two rules its page prices by
//
// WHERE EACH ONE COMES FROM
// Each file is read from the same place the page reads, the same way:
//
//   - News: public/news.json, the file src/pages/News.jsx fetches. Only fields that page
//     renders are kept, cut the way it cuts them (three player chips, four authors).
//   - Articles: src/data/articles/*.json, the files `npm run publish-article` writes. That is
//     how seo-build.mjs finds them too: src/data/content.js cannot be imported outside Vite,
//     because the articles reach it through import.meta.glob.
//   - Big Board: DRAFT_YEARS and DRAFT_CLASSES in src/data/content.js, which is what
//     src/pages/Rankings.jsx renders. The file is evaluated here, with that one Vite-only
//     import taken out, rather than copied or parsed by hand.
//   - Dynasty: the names in public/dynasty/players.json, the curve constants in
//     src/lib/dynastyValue.js and the "settled" count in api/dynasty.js. Prices are live and
//     are never written here; api/_site.js reads them when asked.
//
// WHAT IS LEFT OUT, ON PURPOSE
// content.js began life as a template, and some of it still is one. An article counts as
// published only if it came from the publish script and carries a body: one without a body
// would render ArticleDetail.jsx's stock paragraphs, which are nobody's writing. NEWS_ITEMS,
// PODCASTS and SOCIALS are never read: no live page shows the first two, and the third is the
// footer's social links (one real, the rest "#"). The one-line "WCE" note the News page shows under an item is left out as
// well, pending an editorial decision on whether the connector carries it. meta.json records
// all of it, so the omissions can be checked.
//
// A measurement the board shows as a dash is written as null: not listed, rather than a
// value. Outside links are kept as links. Nothing is fetched, and nobody else's story is
// copied or summarised.
//
// `node --test tools/savant-site/check.mjs` holds every item here against the source the page
// renders from, field for field. It is not a Vite plugin; the build calls writeSiteApi().

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

export const SITE = 'https://wcehoops.com'
export const BASE = 'savant-api/site/v1'
export const SCHEMA = 1

// Two cuts the News page makes inline in its JSX (the check pins both lines).
const NEWS_CHIPS = 3    // Chips(): players.slice(0, 3)
const NEWS_AUTHORS = 4  // AnalyticsCard: authors.slice(0, 4), then " et al."

// What a slug looks like coming out of scripts/publish-article.mjs. The gzipped article
// files are requested by this pattern, so a slug that does not fit is not published here.
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const DASH = '—' // the board's "not listed"

const str = (v) => (typeof v === 'string' && v.trim() ? v : null)
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : [])
const isDate = (v) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
const webUrl = (v) => (typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) ? v : null)

// ---- news ----------------------------------------------------------------------------

// A link to one of the site's own pages, made absolute. Anything else is dropped.
function ownUrl(v) {
  if (typeof v !== 'string') return null
  if (v.startsWith('/') && !v.startsWith('//')) return SITE + v
  return v.startsWith(`${SITE}/`) ? v : null
}

function newsItem(it) {
  const title = str(it && it.title)
  const url = webUrl(it && it.url)
  // The page would render an item with no headline or no link as a blank row. It is not
  // carried over.
  if (!title || !url) return null
  return {
    id: str(it.id),
    title,
    outlet: str(it.outlet),
    url,
    published: isDate(it.published) ? it.published : null,
  }
}

export function sliceNews(news) {
  if (!news || !Array.isArray(news.headlines) || !Array.isArray(news.analytics)) {
    throw new Error('news.json: expected { generated_at, headlines, analytics }')
  }
  // Every answer has to say how old the list is, so a list with no date is not usable.
  if (!isDate(news.generated_at)) throw new Error('news.json: generated_at is missing or not a date')

  let dropped = 0
  const keep = (rows, extra) => {
    const out = []
    for (const it of rows) {
      const base = newsItem(it)
      if (base) out.push({ ...base, ...extra(it) })
      else dropped++
    }
    return out
  }

  const headlines = keep(news.headlines, (it) => ({
    also_covered_by: strings(it.also_covered_by),
    players: (Array.isArray(it.players) ? it.players : [])
      .slice(0, NEWS_CHIPS)
      .map((p) => ({ name: str(p && p.name), url: ownUrl(p && p.savant_url) }))
      .filter((p) => p.name && p.url),
  }))

  const analytics = keep(news.analytics, (it) => {
    const authors = strings(it.authors)
    return {
      type: it.source_type === 'paper' ? 'Paper' : 'Article', // the card's own two labels
      authors: authors.slice(0, NEWS_AUTHORS),
      et_al: authors.length > NEWS_AUTHORS,
    }
  })

  return {
    schema: SCHEMA,
    page: `${SITE}/news`,
    generated_at: news.generated_at,
    headlines,
    analytics,
    dropped,
  }
}

// ---- articles ------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' }

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
  })
}

const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? decode(m[1] ?? m[2]) : ''
}

const BLOCKS = new Set(['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'figure', 'figcaption', 'pre', 'hr'])

// An article body (the HTML mammoth made from the Word file) as plain text: the same words in
// the same order, a blank line between paragraphs, "- " before a list item, " | " between
// table cells. A picture becomes "[image]" where it sat, since the words around it often
// point at it. A link keeps its address in brackets after its text.
export function htmlToText(html) {
  let out = ''
  let images = 0
  let skip = null    // inside <script> or <style>
  const links = []   // open <a> tags: { href, at }
  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g

  for (const m of String(html || '').matchAll(token)) {
    const [whole, closing, rawTag, attrs, text] = m
    if (text != null) {
      if (!skip) out += decode(text).replace(/\s+/g, ' ')
      continue
    }
    if (!rawTag) { if (whole === '<' && !skip) out += '<'; continue }
    const tag = rawTag.toLowerCase()
    if (skip) { if (closing && tag === skip) skip = null; continue }

    if (tag === 'script' || tag === 'style') { if (!closing) skip = tag }
    else if (BLOCKS.has(tag)) out += '\n\n'
    else if (tag === 'br') out += '\n'
    else if (tag === 'li') { if (!closing) out += '\n- ' }
    else if (tag === 'tr') { if (closing) out += '\n' }
    else if (tag === 'td' || tag === 'th') { if (closing) out += ' | ' }
    else if (tag === 'img') {
      images++
      const alt = attr(attrs, 'alt').trim()
      out += alt ? ` [image: ${alt}] ` : ' [image] '
    } else if (tag === 'a') {
      if (!closing) links.push({ href: webUrl(attr(attrs, 'href')), at: out.length })
      else {
        const open = links.pop()
        if (open && open.href && !out.slice(open.at).includes(open.href)) out += ` (${open.href})`
      }
    }
    // Any other tag is inline styling (strong, em, sup...): its words are kept, the tag is not.
  }

  const text = out
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .join('\n')
    .replace(/^-\n+(?=\S)/gm, '- ') // a list item whose words sit in a paragraph of their own
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images }
}

// Words, the way a reader counts them: the "[image]" markers are not words.
const countWords = (text) => text.replace(/\[image(?:: [^\]]*)?\]/g, ' ').split(/\s+/).filter(Boolean).length

const publishedTime = (a) => new Date(a.publishedAt || a.date).getTime()

export function sliceArticles(articles, content) {
  const founder = content.FOUNDER && str(content.FOUNDER.name)
  const skipped = []
  const seen = new Set()
  const cards = []
  const texts = {}

  // Newest first, as src/data/publishedArticles.js sorts them.
  const sorted = (Array.isArray(articles) ? articles : [])
    .filter((a) => a && typeof a === 'object')
    .sort((a, b) => (publishedTime(b) || 0) - (publishedTime(a) || 0))

  for (const a of sorted) {
    const slug = str(a.slug)
    const title = str(a.title)
    const label = slug || title || '(no slug)'
    if (!slug || !SLUG.test(slug)) { skipped.push({ article: label, why: 'its slug is missing or is not lower-case words joined by hyphens' }); continue }
    // ArticleDetail.jsx opens the first article with a slug, which is the newest. Any other is
    // out of reach on the site, so it is out of reach here, whatever state the newest is in.
    if (seen.has(slug)) { skipped.push({ article: label, why: 'a newer article already uses this slug' }); continue }
    seen.add(slug)
    if (!title) { skipped.push({ article: label, why: 'it has no title' }); continue }
    // ArticleDetail.jsx: "Published articles carry a real HTML body; demo/seed articles fall
    // back to the placeholder layout". No body, no article.
    if (!str(a.html)) { skipped.push({ article: label, why: 'it has no body, so its page would show the template\'s stock paragraphs' }); continue }

    const { text, images } = htmlToText(a.html)
    if (!countWords(text)) { skipped.push({ article: label, why: 'its body holds no words' }); continue }

    const card = {
      slug,
      title,
      category: str(a.category),
      excerpt: str(a.excerpt),
      // The byline the article page prints: the article's author, else the founder.
      author: str(a.author) || founder,
      date: str(a.date),
      published_at: isDate(a.publishedAt) ? a.publishedAt : null,
      read_time: str(a.readTime),
      words: countWords(text),
      images,
      url: `${SITE}/articles/${slug}`,
    }
    cards.push(card)
    texts[slug] = { schema: SCHEMA, ...card, text }
  }

  return {
    index: {
      schema: SCHEMA,
      page: `${SITE}/articles`,
      categories: strings(content.CATEGORIES),
      count: cards.length,
      articles: cards,
    },
    texts,
    skipped,
  }
}

// ---- src/data/content.js -------------------------------------------------------------

const ARTICLES_IMPORT = /^import\s*\{\s*PUBLISHED_ARTICLES\s*\}\s*from\s*['"]\.\/publishedArticles\.js['"]\s*;?\s*$/

// content.js, evaluated: every `export const` as plain data.
//
// The file is data literals and one import, the published articles, which arrive through
// import.meta.glob and so cannot load outside Vite. That import is taken out (articles are
// read from their own files, as seo-build.mjs reads them) and the rest is run as it stands.
// Anything else the file might grow that cannot be followed from here is an error, not a guess.
export function readContent(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('content.js is empty')
  const importLine = /^[ \t]*import\b[^\n]*$/gm
  for (const line of source.match(importLine) || []) {
    if (!ARTICLES_IMPORT.test(line.trim())) throw new Error(`content.js has an import this script cannot follow: ${line.trim().slice(0, 90)}`)
  }
  const names = [...source.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  const body = source.replace(importLine, '').replace(/^export\s+const\s+/gm, 'const ')
  if (/^[ \t]*export\b/m.test(body)) throw new Error('content.js exports something other than "export const"')
  for (const need of ['DRAFT_YEARS', 'DRAFT_CLASSES', 'CATEGORIES', 'FOUNDER']) {
    if (!names.includes(need)) throw new Error(`content.js no longer exports ${need}`)
  }
  let out
  try {
    out = vm.runInNewContext(
      `(function () { 'use strict'; const PUBLISHED_ARTICLES = [];\n${body}\nreturn { ${names.join(', ')} } })()`,
      Object.create(null),
      { timeout: 5000 },
    )
  } catch (e) {
    throw new Error(`content.js could not be evaluated: ${e.message}`, { cause: e })
  }
  // Through JSON: plain objects of this realm, and nothing that is not data.
  return JSON.parse(JSON.stringify(out))
}

// ---- the Big Board -------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Barclays Center · Jun 23, 2026" -> "2026-06-23". A label with no date in it gives null.
function dateIn(label) {
  const m = String(label || '').match(/\b([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\b/)
  const month = m ? MONTHS.indexOf(m[1]) : -1
  return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

// A measurement as the page prints it, or null where the page prints a dash.
const listed = (v) => (v == null || v === '' || v === DASH ? null : String(v))

export function sliceBoard(content) {
  const years = content.DRAFT_YEARS
  if (!Array.isArray(years) || !years.length) throw new Error('content.js: DRAFT_YEARS is empty')

  const out = years.map((y) => {
    if (!y || !Number.isInteger(y.year) || !str(y.label)) throw new Error('content.js: a DRAFT_YEARS entry has no year or label')
    const cls = content.DRAFT_CLASSES && content.DRAFT_CLASSES[y.year]
    if (!cls || !Array.isArray(cls.prospects) || !Array.isArray(cls.tiers)) throw new Error(`content.js: DRAFT_CLASSES has no prospects and tiers for ${y.year}`)

    const tiers = cls.tiers.map((t) => {
      if (!t || !Number.isInteger(t.tier) || !str(t.name)) throw new Error(`content.js: a ${y.year} tier has no number or name`)
      return { tier: t.tier, name: t.name, range: str(t.range), blurb: str(t.blurb) }
    })

    // The page walks the tiers and lists each tier's prospects in the order they are written,
    // so that is the order here. A prospect whose tier is not in the list is never rendered.
    const prospects = []
    for (const t of tiers) {
      for (const p of cls.prospects) {
        if (!p || p.tier !== t.tier) continue
        if (!Number.isInteger(p.rank) || !str(p.name)) throw new Error(`content.js: a ${y.year} prospect has no rank or name`)
        prospects.push({
          rank: p.rank,
          tier: p.tier,
          name: p.name,
          school: listed(p.school),
          position: listed(p.position),
          height: listed(p.height),
          wingspan: listed(p.wingspan),
          weight: listed(p.weight),
          age: listed(p.age),
          grade: listed(p.grade),
          archetype: listed(p.archetype),
          tag: str(p.tag),
          summary: str(p.summary),
          strengths: strings(p.strengths),
          weaknesses: strings(p.weaknesses),
          projection: str(p.projection),
          take: str(p.take),
        })
      }
    }
    if (!prospects.length) throw new Error(`content.js: the ${y.year} board has no prospects`)

    return {
      year: y.year,
      label: y.label,
      sublabel: str(y.sublabel),
      status: str(y.status),
      draft_date: dateIn(y.sublabel),
      tiers,
      prospects,
    }
  })

  return {
    schema: SCHEMA,
    page: `${SITE}/rankings`,
    default_year: out[0].year, // the year the page opens on: DRAFT_YEARS[0]
    years: out,
  }
}

// ---- the Dynasty Exchange ------------------------------------------------------------

// `export const NAME = 10000` (or `const NAME = 40`) -> the number.
function constant(source, name, where) {
  const m = String(source || '').match(new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*([0-9][0-9_.]*)`, 'm'))
  const n = m ? Number(m[1].replace(/_/g, '')) : NaN
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} not found in ${where}`)
  return n
}

export function sliceDynasty({ players, valueJs, apiJs }) {
  if (!players || !Array.isArray(players.players)) throw new Error('dynasty/players.json: expected { players }')
  // The live board carries ids only. The page puts a name to each from this list.
  const names = {}
  for (const p of players.players) {
    if (p && p.id != null && str(p.name)) names[String(p.id)] = p.name
  }
  if (!Object.keys(names).length) throw new Error('dynasty/players.json: no player has an id and a name')
  return {
    schema: SCHEMA,
    page: `${SITE}/dynasty`,
    // The page's value curve: VALUE_TOP * exp(-rank / VALUE_LAMBDA).
    value: {
      top: constant(valueJs, 'VALUE_TOP', 'src/lib/dynastyValue.js'),
      lambda: constant(valueJs, 'VALUE_LAMBDA', 'src/lib/dynastyValue.js'),
    },
    // "picks after which a player is considered settled"
    provisional_below: constant(apiJs, 'PROVISIONAL_N', 'api/dynasty.js'),
    count: Object.keys(names).length,
    names,
  }
}

// ---- building ------------------------------------------------------------------------

// On the page, and held back here until WCE decides whether the connector carries it.
const HELD_BACK = [
  { what: 'the one-line "WCE" note under each News item (wce_line in public/news.json)', why: 'left out pending an editorial decision on whether the connector carries it' },
]

// What content.js still carries from the template, and why none of it is published here.
const TEMPLATE_ONLY = {
  NEWS_ITEMS: 'template wire items; the News page reads /news.json and no page imports these',
  PODCASTS: 'template episodes; the Podcasts page is hidden and /podcasts redirects home',
  PODCAST_SHOW: 'template show details; the Podcasts page is hidden',
  SOCIALS: 'footer links: YouTube is real, the rest are still the template\'s "#"; no tool returns them',
}

export function buildSiteApi({ news, articles, contentJs, dynastyPlayers, dynastyValueJs, dynastyApiJs }) {
  const content = readContent(contentJs)
  const wire = sliceNews(news)
  const written = sliceArticles(articles, content)
  const bigBoard = sliceBoard(content)
  const dynasty = sliceDynasty({ players: dynastyPlayers, valueJs: dynastyValueJs, apiJs: dynastyApiJs })

  const meta = {
    schema: SCHEMA,
    name: 'Western Conference Elitists: site content',
    site: SITE,
    files: {
      news: `${SITE}/${BASE}/news.json`,
      articles: `${SITE}/${BASE}/articles.json`,
      article: `${SITE}/${BASE}/articles/{slug}.json`,
      big_board: `${SITE}/${BASE}/big-board.json`,
      dynasty: `${SITE}/${BASE}/dynasty.json`,
    },
    pages: {
      news: `${SITE}/news`,
      news_analytics: `${SITE}/news?tab=analytics`,
      articles: `${SITE}/articles`,
      article: `${SITE}/articles/{slug}`,
      big_board: `${SITE}/rankings`,
      dynasty: `${SITE}/dynasty`,
    },
    news_generated_at: wire.generated_at,
    counts: {
      headlines: wire.headlines.length,
      analytics: wire.analytics.length,
      news_items_dropped: wire.dropped,
      articles: written.index.count,
      boards: bigBoard.years.length,
      prospects: bigBoard.years.reduce((n, y) => n + y.prospects.length, 0),
      dynasty_names: dynasty.count,
    },
    not_published: [
      ...HELD_BACK,
      ...Object.entries(TEMPLATE_ONLY).filter(([name]) => name in content).map(([name, why]) => ({ what: `${name} in src/data/content.js`, why })),
      ...written.skipped.map((s) => ({ what: `article "${s.article}"`, why: s.why })),
    ],
    live: 'Dynasty Exchange prices are not in these files. They are read from /api/dynasty when asked for.',
  }

  return { meta, news: wire, articles: written.index, texts: written.texts, bigBoard, dynasty }
}

// ---- writing -------------------------------------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

// `root` is the repo: the articles, content.js and the Dynasty rules live in src/ and api/,
// not in public/. It defaults to public's parent, which is where Vite puts it.
export function writeSiteApi({ publicDir, dist, root = path.resolve(publicDir, '..') }) {
  const inputs = {
    news: path.join(publicDir, 'news.json'),
    dynastyPlayers: path.join(publicDir, 'dynasty', 'players.json'),
    contentJs: path.join(root, 'src', 'data', 'content.js'),
    dynastyValueJs: path.join(root, 'src', 'lib', 'dynastyValue.js'),
    dynastyApiJs: path.join(root, 'api', 'dynasty.js'),
  }
  for (const file of Object.values(inputs)) {
    if (!existsSync(file)) throw new Error(`${path.relative(root, file)} is missing`)
  }
  const text = (file) => readFileSync(file, 'utf8')
  const articlesDir = path.join(root, 'src', 'data', 'articles')
  const articles = existsSync(articlesDir)
    ? readdirSync(articlesDir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(text(path.join(articlesDir, f))))
    : []

  const out = buildSiteApi({
    news: JSON.parse(text(inputs.news)),
    articles,
    contentJs: text(inputs.contentJs),
    dynastyPlayers: JSON.parse(text(inputs.dynastyPlayers)),
    dynastyValueJs: text(inputs.dynastyValueJs),
    dynastyApiJs: text(inputs.dynastyApiJs),
  })

  // Build everything before touching dist, so a failure leaves nothing half-written.
  const files = []
  let raw = 0
  for (const [name, body] of [['meta.json', out.meta], ['news.json', out.news], ['articles.json', out.articles], ['big-board.json', out.bigBoard], ['dynasty.json', out.dynasty]]) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push([name, json])
  }
  for (const [slug, body] of Object.entries(out.texts)) {
    const json = Buffer.from(JSON.stringify(body))
    raw += json.length
    files.push([`articles/${slug}.json.gz`, gzipSync(json, { level: 9 })])
  }

  const dir = path.join(dist, BASE)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'articles'), { recursive: true })
  let bytes = 0
  for (const [name, buf] of files) { writeFileSync(path.join(dir, name), buf); bytes += buf.length }

  const c = out.meta.counts
  const summary = [
    plural(c.headlines, 'headline'),
    plural(c.analytics, 'analytics item'),
    plural(c.articles, 'article'),
    `${plural(c.boards, 'draft board')} (${plural(c.prospects, 'prospect')})`,
    plural(c.dynasty_names, 'dynasty name'),
  ].join(', ')
  return { files: files.length, raw, bytes, summary }
}
