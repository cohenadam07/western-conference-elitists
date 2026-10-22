// api/_site.js — the rest of the site, as answers: the News wire, WCE's own articles, the
// draft Big Board and the Dynasty Exchange. One section of the AI connector (api/mcp.js).
//
// The Savant sections quote numbers. This one quotes words, so its rule is a little
// different: an answer says what the page says, nothing added and nothing reworded. The
// News, article and Big Board tools read the small files the build writes under
// /savant-api/site/v1/ (see scripts/lib/savant-api-site.mjs), which are cut from the same
// sources the pages render from. Template copy that no page shows never reaches those files.
//
// WHAT AN ANSWER ALWAYS SAYS
//   - News: when the list was generated, in its first line. The news pipeline runs on a
//     schedule from one computer and can stop, and a two-month-old wire must not read as
//     today's. Other outlets' stories are linked, never fetched, copied or summarised. The
//     one-line "WCE" note the page shows under an item is not passed on, pending an editorial
//     decision; the build leaves it out of the file.
//   - Articles: whose writing it is, and how much was left out when a long one is cut.
//   - Big Board: that it is one person's evaluation, not a mock draft and not draft results.
//   - Dynasty: that a value is a crowd price, how many rankings sit behind it, and when the
//     board was read.
//
// THE LIVE READS
// Three things change by the minute, so they cannot be build-time files, and each is read
// from the site's own read-only endpoint with a GET and nothing else (readLive, the one place
// this file makes a request):
//   - the Dynasty board: /api/dynasty with action=board and nothing else. It never votes and
//     never opens a room. The board is kept for a minute and a half so a talkative assistant
//     does not hammer the store behind it. If the store is down the answer says so; it does
//     not fall back to the opening prices the page shows in that case, because those are
//     another site's ranking and not the crowd's.
//   - the most-searched players and prospects: /api/trending?ns=bs and ?ns=dr, kept for a
//     minute. It never records a search. When the counter is off the pages fall back to their
//     own picks; this says the list is unavailable instead.
//   - a fan's fantasy league: /api/league, the site's proxy to Sleeper, ESPN and Fantrax, which
//     asks for no credentials and stores nothing. The connector never calls those platforms
//     itself. The league is then valued on the Dynasty board exactly as the Dynasty page does.
//
// WHAT'S NEW
// The homepage banner's lines, minus the YouTube uploads (WCE does not carry those here),
// picked by the banner's own rules at the moment of asking, from whats-new.json.
//
// TWO THINGS THE DYNASTY PAGE SHOWS THAT THIS DOES NOT
//   - Its "24h" change. The snapshot it compares against is only ever written when a player
//     is first listed, so the figure is the move since listing, not since yesterday.
//   - Position, team and age. They come from the list the board was seeded with, which
//     nothing refreshes, so they go out of date.
// The value itself is the page's: the board's order priced on the curve in
// src/lib/dynastyValue.js. The curve's two constants are read at build time; the check runs
// that module against this file's arithmetic.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, makeLoader, origin, prepare, rank, thousands, topTier } from './_core.js'

const files = makeLoader('savant-api/site/v1', { what: 'WCE site' })

const SOURCE = 'Western Conference Elitists (wcehoops.com)'
const DAY_MS = 24 * 60 * 60 * 1000

// ---- small formatting helpers ----------------------------------------------------------

// "2026-07-31T15:18:49+00:00" -> "2026-07-31 15:18 UTC" and "2026-07-31"
const iso = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
const stamp = (v) => { const s = iso(v); return s ? `${s.slice(0, 10)} ${s.slice(11, 16)} UTC` : 'an unknown time' }
const dateOf = (v) => { const s = iso(v); return s ? s.slice(0, 10) : null }
const count = (n, one, many = `${one}s`) => `${thousands(n)} ${n === 1 ? one : many}`

// A match this good is on whole words or the start of them. Anything under it is a near
// spelling or a fragment: offered to the caller, never assumed, even when it is the only one.
const SURE = 60

// One row for a name. { one } when a single row is a sure match; { many } when several are,
// for the caller to choose from; { near } when nothing is sure and these are the closest;
// { none } when nothing is close.
function settle(rows, query, tiebreak) {
  const ranked = rank(rows, query, tiebreak)
  if (!ranked.length) return { none: true }
  if (ranked[0].score < SURE) return { near: ranked.slice(0, 8).map((r) => r.row) }
  const best = topTier(ranked)
  return best.length === 1 ? { one: best[0] } : { many: best.slice(0, 8) }
}

// ---- news ----------------------------------------------------------------------------

// The page's two tabs. The analytics tab is a real link: News.jsx reads ?tab=analytics.
const NEWS = {
  headlines: { label: 'Headlines', url: `${SITE}/news`, what: 'headline' },
  analytics: { label: 'Analytics', url: `${SITE}/news?tab=analytics`, what: 'analytics item' },
}

// The pipeline is scheduled three times a day (pipeline/news/README.md). A list older than
// this has missed several runs and is called what it is.
const NEWS_FRESH_DAYS = 2

export async function getNews({ section = 'headlines', start = 1, limit = 10 } = {}, now = Date.now()) {
  const file = await files.load('news.json')
  const tab = NEWS[section]
  const all = file[section] || []
  if (all.length && start > all.length) {
    throw new SavantError(`The ${tab.label} list has ${count(all.length, 'item')}. Ask for a start of ${all.length} or lower.`)
  }
  const shown = all.slice(start - 1, start - 1 + limit)

  const ageDays = Math.max(0, Math.floor((now - new Date(file.generated_at).getTime()) / DAY_MS))
  const stale = ageDays > NEWS_FRESH_DAYS
  const ago = ageDays < 1 ? 'less than a day ago' : ageDays === 1 ? '1 day ago' : `${thousands(ageDays)} days ago`
  const notes = [
    `This list was generated ${stamp(file.generated_at)}, ${ago}.${stale ? ' It has not been refreshed since, so it is a snapshot from that date and not current news.' : ''}`,
    'Each item belongs to the outlet named and links to that outlet\'s story.',
  ]

  const items = shown.map((it, i) => ({
    position: start + i,
    title: it.title,
    outlet: it.outlet,
    url: it.url,
    published: it.published,
    ...(section === 'headlines'
      ? { also_covered_by: it.also_covered_by, players: it.players }
      : { type: it.type, authors: it.authors, et_al: it.et_al }),
  }))

  const structured = {
    section,
    generated_at: file.generated_at,
    age_days: ageDays,
    stale,
    total: all.length,
    count: items.length,
    items,
    notes,
    url: tab.url,
    source: SOURCE,
  }

  const L = [`WCE News, ${tab.label}. ${notes[0]}`]
  if (!all.length) {
    L.push('', 'The list is empty. The page reads "Nothing on the wire yet".')
  } else {
    const range = items.length === all.length ? `All ${count(all.length, tab.what)}` : `Items ${start} to ${start + items.length - 1} of ${thousands(all.length)}`
    L.push(`${range}, in the page's order. ${notes[1]}`)
    for (const it of items) {
      const facts = [
        [it.outlet, dateOf(it.published)].filter(Boolean).join(', '),
        it.type,
        it.authors && it.authors.length ? `By ${it.authors.join(', ')}${it.et_al ? ' et al' : ''}` : null,
        it.also_covered_by && it.also_covered_by.length ? `Also covered by ${it.also_covered_by.join(' · ')}` : null,
      ].filter(Boolean)
      L.push('', `${it.position}. ${it.title}`)
      if (facts.length) L.push(`   ${facts.join('. ')}.`)
      L.push(`   ${it.url}`)
      if (it.players && it.players.length) L.push(`   Players named: ${it.players.map((p) => `${p.name} (${p.url})`).join(', ')}`)
    }
  }
  L.push('', `Page: ${tab.url}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- articles ------------------------------------------------------------------------

// A long article is cut here, at a paragraph break, and the answer links to the rest.
export const ARTICLE_CAP = 8000

const newest = (a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || a.slug.localeCompare(b.slug)

// The article cards, prepared twice: for search (everything a card shows, plus the byline)
// and for finding one article by its title.
const preparedArticles = new WeakMap()
async function loadArticles() {
  const file = await files.load('articles.json')
  let rows = preparedArticles.get(file)
  if (!rows) {
    const named = file.articles.map((a) => ({ ...a, name: a.title }))
    rows = {
      search: prepare(named, (a) => [a.title, a.excerpt, a.category, a.author].filter(Boolean).join(' ')),
      titles: prepare(named),
    }
    preparedArticles.set(file, rows)
  }
  return { file, rows }
}

const card = (a) => ({
  slug: a.slug,
  title: a.title,
  category: a.category,
  summary: a.excerpt,
  author: a.author,
  date: a.date,
  read_time: a.read_time,
  url: a.url,
})

const byline = (a) => [a.author ? `By ${a.author}` : null, a.category, a.date, a.read_time].filter(Boolean).join(', ')

export async function searchArticles({ query, category, limit = 10 } = {}) {
  const { file, rows } = await loadArticles()
  let pool = rows.search
  let inCategory = null
  if (category) {
    inCategory = file.categories.find((c) => c.toLowerCase() === category.toLowerCase())
    if (!inCategory) throw new SavantError(`"${category}" is not one of the site's article categories. They are: ${file.categories.join(', ')}.`)
    pool = pool.filter((a) => a.category === inCategory)
  }
  const found = query ? rank(pool, query, newest).map((r) => r.row) : [...pool].sort(newest)
  const shown = found.slice(0, limit).map(card)

  const notes = ['These are Western Conference Elitists\' own articles. The summary is the opening of the article as the site shows it on the card, not the whole text.']
  const structured = { query: query || null, category: inCategory, total: found.length, count: shown.length, published: file.count, articles: shown, notes, url: file.page, source: SOURCE }

  const asked = [query ? `matching "${query}"` : null, inCategory ? `in ${inCategory}` : null].filter(Boolean).join(' ')
  if (!shown.length) {
    const have = file.count ? `WCE has ${count(file.count, 'published article')}; search with no query to list ${file.count === 1 ? 'it' : 'them'}.` : 'WCE has no published articles right now.'
    return { structured, text: `No WCE article ${asked || 'is published'}. ${asked ? have : ''}`.trim() + `\nPage: ${file.page}` }
  }
  const order = found.length < 2 ? '' : query ? ', best match first' : ', newest first'
  const head = `${count(found.length, 'WCE article')}${asked ? ` ${asked}` : ''}${found.length > shown.length ? `, showing the first ${shown.length}` : ''}${order}:`
  const L = [head]
  shown.forEach((a, i) => {
    L.push('', `${i + 1}. ${a.title}`, `   ${byline(a)}.`)
    if (a.summary) L.push(`   ${a.summary}`)
    L.push(`   ${a.url} (slug: ${a.slug})`)
  })
  L.push('', notes[0], `Page: ${file.page}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// A slug, an article's link, or its title.
async function resolveArticle(input) {
  const { file, rows } = await loadArticles()
  const raw = String(input || '').trim()
  if (!raw) throw new SavantError('Give an article slug or title.')
  if (!file.count) throw new SavantError('WCE has no published articles right now.')

  const fromLink = raw.match(/\/articles\/([a-z0-9-]+)\/?(?:[?#].*)?$/i)
  const slug = (fromLink ? fromLink[1] : raw).toLowerCase()
  const bySlug = rows.titles.find((a) => a.slug === slug)
  if (bySlug) return bySlug

  const found = settle(rows.titles, raw, newest)
  if (found.one) return found.one
  if (found.none) throw new SavantError(`No WCE article matches "${raw}". Check the title, or list the articles with wce_search_articles.`)
  const why = found.many ? `${found.many.length} articles could be "${raw}"` : `"${raw}" is not an exact title`
  throw new SavantError(`${why}. Call again with one of these slugs:\n${(found.many || found.near).map((a) => `- ${a.slug}: ${a.title} (${a.date})`).join('\n')}`)
}

// The text up to the cap, ending on a whole paragraph where one fits.
function cut(text, cap) {
  if (text.length <= cap) return text
  let out = ''
  for (const para of text.split('\n\n')) {
    const next = out ? `${out}\n\n${para}` : para
    if (next.length > cap) break
    out = next
  }
  if (out) return out
  // A first paragraph longer than the cap: stop at the last sentence that fits, or word.
  const head = text.slice(0, cap)
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '))
  return stop > cap / 2 ? head.slice(0, stop + 1) : `${head.slice(0, Math.max(head.lastIndexOf(' '), 1))}…`
}

const words = (text) => text.replace(/\[image(?:: [^\]]*)?\]/g, ' ').split(/\s+/).filter(Boolean).length

export async function getArticle({ article } = {}) {
  const row = await resolveArticle(article)
  const file = await files.load(`articles/${row.slug}.json`)
  const text = cut(file.text, ARTICLE_CAP)
  const truncated = text.length < file.text.length
  const returned = truncated ? words(text) : file.words

  const notes = [`This is ${file.author ? `${file.author}'s` : 'an'} article as published by Western Conference Elitists. The text is the article's own words.`]
  if (file.images) notes.push(`"[image]" marks where ${file.images === 1 ? 'a picture sits' : `each of its ${file.images} pictures sits`} on the page. The pictures are not described here.`)
  if (truncated) notes.push(`Only the first ${thousands(returned)} of its ${thousands(file.words)} words are returned. The rest is at ${file.url}.`)

  const structured = {
    slug: file.slug,
    title: file.title,
    category: file.category,
    author: file.author,
    date: file.date,
    published_at: file.published_at,
    read_time: file.read_time,
    text,
    words: file.words,
    words_returned: returned,
    truncated,
    images: file.images,
    notes,
    url: file.url,
    source: SOURCE,
  }
  const L = [file.title, `${byline(file)}. ${SOURCE}.`, file.url, '', text, '']
  if (truncated) L.push(`[Cut here. ${notes[notes.length - 1]}]`)
  if (file.images) L.push(notes[1])
  L.push(`Full article: ${file.url}`)
  return { structured, text: L.join('\n') }
}

// ---- the Big Board -------------------------------------------------------------------

// The page's own framing of the board: its eyebrow ("Personal Big Board · Not a Consensus
// Mock") and the second sentence of its footnote. The check pins both in Rankings.jsx.
const BOARD_FRAME = 'This is a personal big board, not a consensus mock. Rankings are evaluation-based, not predictions of draft slot.'

const preparedBoards = new WeakMap()
async function loadBoard() {
  const file = await files.load('big-board.json')
  let byYear = preparedBoards.get(file)
  if (!byYear) {
    byYear = new Map(file.years.map((y) => [y.year, prepare(y.prospects)]))
    preparedBoards.set(file, byYear)
  }
  return { file, byYear }
}

const classLabel = (y) => `${y.label}${y.sublabel ? ` (${y.sublabel})` : ''}`
const byRank = (a, b) => a.rank - b.rank
const or = (v) => v ?? 'not listed'

// What the collapsed row shows, and what opening it adds.
const boardRow = (p) => ({ rank: p.rank, tier: p.tier, name: p.name, school: p.school, position: p.position, height: p.height, wingspan: p.wingspan, grade: p.grade })
const writeUp = (p) => ({ ...boardRow(p), weight: p.weight, age: p.age, archetype: p.archetype, tag: p.tag, summary: p.summary, strengths: p.strengths, weaknesses: p.weaknesses, projection: p.projection, take: p.take })

// One prospect on one year's board: by rank ("5", "#5") or by name.
function findProspect(rows, query) {
  const asRank = query.match(/^#?(\d{1,3})$/)
  if (asRank) {
    const hit = rows.find((p) => p.rank === +asRank[1])
    return hit ? { one: hit } : { none: true }
  }
  return settle(rows, query, byRank)
}

export async function getBigBoard({ year, prospect } = {}, now = Date.now()) {
  const { file, byYear } = await loadBoard()
  const has = file.years.map((y) => classLabel(y)).join(', ')
  if (year != null && !byYear.has(year)) throw new SavantError(`The Big Board has no ${year} class. It has: ${has}.`)

  let cls = file.years.find((y) => y.year === (year ?? file.default_year))
  let one = null
  if (prospect) {
    // With no year given, the board the page opens on is searched first, then the others.
    const order = year != null ? [cls] : [cls, ...file.years.filter((y) => y !== cls)]
    let offer = null // candidates to put to the caller: { y, rows, near }
    for (const y of order) {
      const found = findProspect(byYear.get(y.year), prospect)
      if (found.one) { one = found.one; cls = y; break }
      // Several sure candidates on one board are put to the caller, not passed over for a
      // later board. A near spelling is only remembered: an exact name further on still wins.
      if (found.many) { offer = { y, rows: found.many, near: false }; break }
      if (found.near && !offer) offer = { y, rows: found.near, near: true }
    }
    if (!one && offer) {
      const why = offer.near ? `"${prospect}" is not an exact match on the ${offer.y.label} board` : `${offer.rows.length} prospects on the ${offer.y.label} board could be "${prospect}"`
      throw new SavantError(`${why}. Call again with one of these names:\n${offer.rows.map((p) => `- ${p.name} (No. ${p.rank}, ${p.school || 'school not listed'})`).join('\n')}`)
    }
    if (!one) {
      throw new SavantError(`No prospect ${year != null ? `on the ${cls.label} board` : 'on the Big Board'} matches "${prospect}". ${year != null ? `That board has ${cls.prospects.length} prospects` : `It has: ${has}`}. Ask for a board with no prospect to see everyone on it.`)
    }
  }

  const notes = [BOARD_FRAME]
  if (cls.draft_date && now > new Date(`${cls.draft_date}T00:00:00Z`).getTime() + DAY_MS) {
    notes.push(`The site lists this draft for ${cls.draft_date}, which has passed. The board ranks prospects by evaluation and does not say where anyone was picked.`)
  }
  const others = file.years.filter((y) => y !== cls).map((y) => ({ year: y.year, label: y.label, sublabel: y.sublabel, status: y.status }))
  const tierOf = (n) => cls.tiers.find((t) => t.tier === n)

  const structured = {
    year: cls.year,
    label: cls.label,
    sublabel: cls.sublabel,
    status: cls.status,
    draft_date: cls.draft_date,
    view: one ? 'prospect' : 'board',
    prospect_count: cls.prospects.length,
    tier_count: cls.tiers.length,
    tiers: one ? [tierOf(one.tier)] : cls.tiers,
    prospects: one ? [writeUp(one)] : cls.prospects.map(boardRow),
    other_years: others,
    notes,
    url: file.page,
    source: SOURCE,
  }

  const L = []
  const status = cls.status ? ` The site marks it "${cls.status}".` : ''
  if (one) {
    const t = tierOf(one.tier)
    notes.push('"Not listed" is a dash on the page: the board gives no figure, which is not the same as zero.')
    L.push(`${one.name}: No. ${one.rank} of ${cls.prospects.length} on the WCE Big Board, ${classLabel(cls)}.${status}`)
    L.push(`Tier ${t.tier}, ${t.name}${t.range ? ` (${t.range})` : ''}. Grade ${or(one.grade)}.`)
    L.push(`${or(one.school)}, ${or(one.position)}. Height ${or(one.height)}, wingspan ${or(one.wingspan)}, weight ${or(one.weight)}, age ${or(one.age)}.`.replace(/\.\.$/, '.'))
    if (one.archetype) L.push(`Archetype: ${one.archetype}.`)
    if (one.tag) L.push(`Tagged on the board: ${one.tag}.`)
    if (one.summary) L.push('', one.summary)
    if (one.strengths.length) L.push('', 'Strengths:', ...one.strengths.map((s) => `+ ${s}`))
    if (one.weaknesses.length) L.push('', 'Weaknesses:', ...one.weaknesses.map((s) => `− ${s}`))
    if (one.projection) L.push('', `Projection: ${one.projection}`)
    if (one.take) L.push(`Take: ${one.take}`)
    L.push('', ...notes)
  } else {
    L.push(`WCE Big Board, ${classLabel(cls)}: ${cls.prospects.length} prospects in ${cls.tiers.length} tiers.${status}`)
    L.push(...notes)
    for (const t of cls.tiers) {
      L.push('', `Tier ${t.tier}: ${t.name}${t.range ? ` (${t.range})` : ''}${t.blurb ? `. ${t.blurb}` : ''}`)
      for (const p of cls.prospects.filter((x) => x.tier === t.tier)) {
        const size = [p.height ? `height ${p.height}` : null, p.wingspan ? `wingspan ${p.wingspan}` : null].filter(Boolean).join(', ')
        L.push(`${String(p.rank).padStart(2, ' ')}. ${[p.name, p.school, p.position].filter(Boolean).join(', ')}. Grade ${or(p.grade)}${size ? `; ${size}` : ''}`)
      }
    }
  }
  L.push('', `Board: ${file.page}${cls.year === file.default_year ? '' : ` (choose ${cls.label} in the page's year menu)`}`)
  if (others.length) L.push(`Other boards on that page: ${others.map((y) => classLabel(y)).join(', ')}.`)
  L.push(`Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the Dynasty Exchange --------------------------------------------------------------

// What the page asks for when it loads the board: every listed player, so that the value
// curve is drawn over the whole board. The page then lists the first 120.
const BOARD_LIMIT = 600
const BOARD_ROWS = 120
const BOARD_PATH = `/api/dynasty?action=board&limit=${BOARD_LIMIT}`

// How long a read is kept, how long it may stand in when a re-read fails, how long a failure
// is remembered before trying again, and how long one read may take. Exported so the check
// can shorten them; clear() forgets everything.
export const dynastyFeed = {
  ttlMs: 90 * 1000,
  staleMs: 10 * 60 * 1000,
  retryMs: 20 * 1000,
  timeoutMs: 6000,
  clear() { held = null; failed = null; pending = null },
}

let held = null     // { at, board }: the last good read
let failed = null   // { at, error }: the last failed one
let pending = null

const DYNASTY_PAGE = `${SITE}/dynasty`
const FEED_DOWN = `The Dynasty Exchange board could not be read right now. Try again in a minute. The board is at ${DYNASTY_PAGE}.`
const FEED_OFFLINE = `The Dynasty Exchange's live prices cannot be read right now: the site's pricing feed is offline. Try again in a few minutes. The board is at ${DYNASTY_PAGE}.`
const FEED_EMPTY = `The Dynasty Exchange board has no players on it right now, so there is nothing to rank. The board is at ${DYNASTY_PAGE}.`

// Every live read in this file goes through here: one GET, with no body and no cookies, to
// one of the site's own read-only endpoints (/api/dynasty for the board, /api/trending,
// /api/league). Anything but a 2xx with JSON in it is a failure for the caller to word.
async function readLive(pathAndQuery, timeoutMs) {
  const res = await fetch(`${origin()}${pathAndQuery}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return JSON.parse(await res.text())
}

// One GET of the board. Every way it can go wrong becomes a sentence for the caller; the
// detail goes to the log.
async function readBoard() {
  let body
  try {
    body = await readLive(BOARD_PATH, dynastyFeed.timeoutMs)
  } catch (err) {
    console.error('[site] dynasty board failed:', err.message)
    throw new SavantError(FEED_DOWN)
  }
  if (!body || typeof body !== 'object') throw new SavantError(FEED_DOWN)
  // What api/dynasty.js answers with no store configured, and how it reports its own errors.
  if (body.configured === false) {
    console.error('[site] dynasty board offline:', body.error || 'store not configured')
    throw new SavantError(FEED_OFFLINE)
  }
  if (!Array.isArray(body.board)) throw new SavantError(FEED_DOWN)
  if (!body.board.length) throw new SavantError(FEED_EMPTY)

  const rows = body.board.map((r) => ({
    id: String(r && r.id != null ? r.id : ''),
    rating: Number(r && r.rating),
    rank: Number(r && r.rank),
    seen: Math.max(0, Math.trunc(Number(r && r.seen) || 0)),
    streak: Math.trunc(Number(r && r.streak) || 0),
  }))
  if (!rows.every((r) => r.id && r.id.length <= 24 && Number.isFinite(r.rating) && Number.isInteger(r.rank) && r.rank > 0)) {
    console.error('[site] dynasty board: a row has no id, rating or rank')
    throw new SavantError(FEED_DOWN)
  }
  return { rows, total: Math.max(0, Math.trunc(Number(body.total) || 0)) }
}

// The board, from memory when it was read in the last minute and a half. When a re-read
// fails, the last good copy stands in for a few minutes, and the answer says so.
async function liveBoard() {
  const now = Date.now()
  if (held && now - held.at < dynastyFeed.ttlMs) return { ...held, late: false }
  if (pending) return pending
  const standIn = (error) => {
    if (held && Date.now() - held.at < dynastyFeed.staleMs) return { ...held, late: true }
    throw error
  }
  if (failed && now - failed.at < dynastyFeed.retryMs) return standIn(failed.error)
  pending = readBoard().then(
    (board) => { held = { at: Date.now(), board }; failed = null; return { ...held, late: false } },
    (error) => { failed = { at: Date.now(), error }; return standIn(error) },
  ).finally(() => { pending = null })
  return pending
}

// The page's value for a rating on this board (src/lib/dynastyValue.js): the rating's place
// in the board, high to low and counted from zero, tied ratings sharing the middle of their
// block, and a rating the board does not hold placed between its neighbours; then
// top * exp(-place / lambda), rounded, never below 1.
function pricer(rows, curve) {
  const a = rows.map((r) => r.rating).filter((r) => Number.isFinite(r)).sort((x, y) => y - x)
  const n = a.length
  const place = (rating) => {
    if (!n || !Number.isFinite(rating)) return 0
    let lo = 0
    let hi = n
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] > rating) lo = m + 1; else hi = m }
    const first = lo
    lo = 0
    hi = n
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] >= rating) lo = m + 1; else hi = m }
    const last = lo - 1
    if (last >= first) return (first + last) / 2
    if (first - 1 < 0) return 0
    if (first >= n) return n - 1
    const span = a[first - 1] - a[first]
    return first - 1 + (span > 0 ? (a[first - 1] - rating) / span : 0.5)
  }
  return (rating) => Math.max(1, Math.round(curve.top * Math.exp(-place(rating) / curve.lambda)))
}

const namedBoards = new WeakMap()

export async function getDynastyRankings({ limit = 25, player } = {}) {
  const file = await files.load('dynasty.json')
  const { at, board, late } = await liveBoard()

  // The page's own fallback for an id it has no name for is "#<id>".
  let named = namedBoards.get(board)
  if (!named) {
    named = prepare(board.rows.map((r) => ({ ...r, name: Object.hasOwn(file.names, r.id) ? file.names[r.id] : `#${r.id}` })))
    namedBoards.set(board, named)
  }
  const value = pricer(board.rows, file.value)

  let picked = named
  let matched = null
  if (player) {
    const byId = named.find((r) => r.id === player)
    const found = byId ? [{ row: byId, score: 100 }] : rank(named, player, byRank)
    if (!found.length) throw new SavantError(`No player on the Dynasty Exchange matches "${player}". It lists ${count(named.length, 'NBA player')}; check the spelling, or try the last name alone.`)
    // A near spelling is not priced as if it were the name asked for.
    if (found[0].score < SURE) {
      throw new SavantError(`"${player}" is not an exact match for anyone on the Dynasty Exchange. Call again with one of these names:\n${found.slice(0, 8).map((r) => `- ${r.row.name} (No. ${r.row.rank})`).join('\n')}`)
    }
    picked = topTier(found)
    matched = picked.length
  }
  const shown = picked.slice(0, limit).map((r) => ({
    rank: r.rank,
    id: r.id,
    name: r.name,
    value: value(r.rating),
    rankings: r.seen,
    provisional: r.seen < file.provisional_below,
    // The page badges a run only from two in a row.
    run: Math.abs(r.streak) >= 2 ? r.streak : null,
  }))

  const thin = shown.filter((r) => r.provisional).length
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60000))
  const notes = [
    `Read from the live board at ${stamp(at)}.${late ? ` The board could not be re-read just now, so this is the copy from about ${count(minutes, 'minute')} ago.` : ''}`,
    `A value is a crowd price, not a WCE projection and not advice. Visitors rank four players at a time; each ranking counts as six head-to-head results, and the site prices the resulting order on a curve that starts at ${thousands(file.value.top)} for the top player. Opening prices came from Hashtag Basketball's points-league dynasty ranking.`,
    `"In N rankings" is how many submitted rankings a player has appeared in. The site treats a price as provisional until that reaches ${file.provisional_below}: ${thin === shown.length ? (shown.length === 1 ? 'this one still is' : `all ${shown.length} shown still are`) : thin ? `${thin} of the ${shown.length} shown still are, marked "provisional"` : 'none of those shown is'}.`,
  ]

  const structured = {
    as_of: new Date(at).toISOString(),
    stale: late,
    listed: named.length,
    total_rankings: board.total,
    player: player || null,
    matched,
    count: shown.length,
    players: shown,
    notes,
    url: DYNASTY_PAGE,
    source: SOURCE,
  }

  const scope = player
    ? `${count(matched, 'player')} matching "${player}"${matched > shown.length ? `, showing the first ${shown.length}` : ''}`
    : `top ${shown.length}`
  const L = [`Dynasty Exchange, the crowd-priced NBA dynasty board on wcehoops.com: ${scope} of ${thousands(named.length)} listed. ${count(board.total, 'ranking')} submitted in all.`, ...notes, '']
  const tagEach = thin > 0 && thin < shown.length
  for (const r of shown) {
    const run = r.run ? `, ranked ${r.run > 0 ? 'first' : 'last'} in each of his last ${Math.abs(r.run)}` : ''
    L.push(`${String(r.rank).padStart(3, ' ')}. ${r.name}: value ${thousands(r.value)}, in ${count(r.rankings, 'ranking')}${run}${tagEach && r.provisional ? ' [provisional]' : ''}`)
  }
  L.push('', `Board: ${DYNASTY_PAGE}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- trending ------------------------------------------------------------------------

// The "Trending now" chips on the Basketball Savant and Draft Savant home screens: the ids
// most picked from each page's home-screen search over the last seven days, read live from
// the site's /api/trending, the same GET the pages make. The names come from those sections'
// own files. When the counter is off the pages show their own picks instead; those are not
// search counts, so this says the list is unavailable rather than pass them off as one.
const bsFiles = makeLoader('savant-api/basketball/v1', { what: 'Basketball Savant', maxCached: 4 })
const draftFiles = makeLoader('savant-api/draft/v1', { what: 'Draft Savant', maxCached: 4 })
const TREND = {
  players: { ns: 'bs', page: `${SITE}/basketball-savant.html`, what: 'Basketball Savant', who: 'players' },
  prospects: { ns: 'dr', page: `${SITE}/draft-savant.html`, what: 'Draft Savant', who: 'prospects' },
}
// The pages draw six chips; /api/trending returns up to twelve.
const TREND_CHIPS = 6
const TREND_DOWN = 'The most-searched list could not be read right now. Try again in a minute.'
const TREND_OFF = 'The most-searched list cannot be read right now: the site\'s search counter is offline. The pages show their own picks meanwhile, which are not search counts.'
const TREND_WORD = { up: 'rising', down: 'cooling off', flat: 'steady' }

export const trendingFeed = { ttlMs: 60 * 1000, timeoutMs: 6000, clear() { trendHeld.clear() } }
const trendHeld = new Map() // ns -> { at, top } | { pending }

async function liveTrending(ns) {
  const hit = trendHeld.get(ns)
  if (hit && hit.pending) return hit.pending
  if (hit && Date.now() - hit.at < trendingFeed.ttlMs) return hit
  const pending = (async () => {
    let body
    try {
      body = await readLive(`/api/trending?ns=${ns}`, trendingFeed.timeoutMs)
    } catch (err) {
      console.error('[site] trending failed:', err.message)
      throw new SavantError(TREND_DOWN)
    }
    if (!body || typeof body !== 'object') throw new SavantError(TREND_DOWN)
    // What api/trending.js answers with no store, and when the store fails.
    if (body.configured === false) throw new SavantError(TREND_OFF)
    if (!Array.isArray(body.top)) throw new SavantError(TREND_DOWN)
    const top = body.top
      .filter((t) => t && /^[A-Za-z0-9_.-]{1,48}$/.test(String(t.id)))
      .map((t) => ({ id: String(t.id), score: Math.max(0, Number(t.score) || 0), trend: ['up', 'down'].includes(t.trend) ? t.trend : 'flat' }))
    return { at: Date.now(), top }
  })().then(
    (v) => { trendHeld.set(ns, v); return v },
    (err) => { trendHeld.delete(ns); throw err },
  )
  trendHeld.set(ns, { pending })
  return pending
}

export async function getTrending({ section = 'both' } = {}) {
  const wanted = section === 'both' ? ['players', 'prospects'] : [section]
  const lists = []
  for (const key of wanted) {
    const t = TREND[key]
    const [{ at, top }, file, draftMeta] = await Promise.all([
      liveTrending(t.ns),
      (key === 'players' ? bsFiles : draftFiles).load(key === 'players' ? 'players.json' : 'prospects.json'),
      key === 'players' ? null : draftFiles.load('meta.json'),
    ])
    const byId = new Map((key === 'players' ? file.players : file.prospects).map((r) => [String(r.id), r]))
    const pick = (r) => (r.year === draftMeta.currentClass ? `${r.year} class, projected No. ${r.pick}` : `drafted No. ${r.pick} in ${r.year}`) + (r.team ? `, ${r.team}` : '')
    // The page shows only the ids it can put a name to, in the counter's order.
    const known = top.filter((x) => byId.has(x.id))
    const items = known.map((x, i) => {
      const r = byId.get(x.id)
      return {
        rank: i + 1,
        id: x.id,
        name: r.name,
        detail: key === 'players' ? [r.pos, r.team].filter(Boolean).join(', ') || null : pick(r),
        trend: x.trend,
        weighted_searches: x.score,
        on_home_screen: i < TREND_CHIPS,
        url: key === 'players' ? `${SITE}/basketball-savant.html?p=${encodeURIComponent(x.id)}` : t.page,
      }
    })
    lists.push({ section: key, page: t.page, read_at: new Date(at).toISOString(), unknown_ids: top.length - known.length, items })
  }

  const notes = [
    'Ranked by picks from each page\'s home-screen search over the last 7 days (UTC days), recent days counting more: today\'s picks 7 times, six days ago once. It counts searches on wcehoops.com, not anyone\'s performance.',
    'Trend compares the last 3 days with the 4 before, per day: rising at 30% more, cooling off at 30% less, steady otherwise or with fewer than 2 picks in the week.',
    `The home screens show the first ${TREND_CHIPS} of each list.`,
  ]
  if (lists.some((l) => l.section === 'prospects' && l.items.length)) notes.push('Draft Savant has no link that opens one prospect, so a prospect links to the page.')
  const structured = { section, lists, notes, source: SOURCE }
  const L = []
  for (const l of lists) {
    const t = TREND[l.section]
    L.push(`Most-searched ${t.who} on ${t.what}, read live at ${stamp(l.read_at)}:`)
    if (!l.items.length) L.push('Nobody has been searched for there in the last 7 days.')
    for (const x of l.items) L.push(`${x.rank}. ${x.name}${x.detail ? ` (${x.detail})` : ''}: ${TREND_WORD[x.trend]}${x.on_home_screen ? '' : ' [not on the home screen]'}. ${x.url}`)
    L.push('')
  }
  L.push(...notes, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- what's new ----------------------------------------------------------------------

// The homepage banner's "what's new" lines, picked the way src/lib/whatsNew.js picks them
// when someone opens the page: each kind stays up for its own number of days, up to its own
// number of lines, a UFC card from a week before until the night it happens, "New" for the
// first three days. The rules are read out of that file at build time (whats-new.json);
// tools/savant-site/check.mjs runs the real module against this one.
const NEW_YORK = { month: 'short', day: 'numeric', timeZone: 'America/New_York' }
function pickRecent(items, R, now) {
  const out = []
  const count = {}
  const sorted = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  for (const it of sorted) {
    const t = Date.parse(it.date)
    if (Number.isNaN(t)) continue
    if (it.kind === 'event') {
      if (now > t + R.event_tail_days * DAY_MS || t - now > R.event_lead_days * DAY_MS) continue
      if (count.event) continue
    } else {
      const rule = R.kinds[it.kind]
      if (!rule) continue
      if (t > now + R.ahead_ms) continue
      if (now - t > rule.days * DAY_MS) continue
      if ((count[it.kind] || 0) >= rule.max) continue
    }
    count[it.kind] = (count[it.kind] || 0) + 1
    out.push({ ...it, fresh: it.kind !== 'event' && now - t < R.fresh_days * DAY_MS })
    if (out.length >= R.max) break
  }
  return out
}
const bannerLabel = (it) => (it.kind === 'article' ? `Article: ${it.text}` : it.kind === 'update' ? `${it.product}${it.version ? ` ${it.version}` : ''}: ${it.text}` : it.text)
function bannerTag(it) {
  if (it.fresh) return 'New'
  const d = /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? new Date(`${it.date}T12:00:00Z`) : new Date(it.date)
  return d.toLocaleDateString('en-US', it.kind === 'event' ? { ...NEW_YORK, weekday: 'short' } : NEW_YORK)
}
const KIND = { article: 'article', update: 'product update', event: 'UFC card' }

export async function getWhatsNew(_ = {}, now = Date.now()) {
  const file = await files.load('whats-new.json')
  const R = file.rules
  const shown = pickRecent(file.items, R, now).map((it) => ({
    kind: KIND[it.kind] || it.kind,
    date: it.date,
    line: bannerLabel(it),
    tag: bannerTag(it),
    new: it.fresh,
    url: it.url,
  }))
  const days = (k) => `${KIND[k]}s ${R.kinds[k].days} days`
  const notes = [
    `What the homepage banner shows at ${stamp(now)}, newest first: ${days('article')}, ${days('update')}, a UFC card from ${R.event_lead_days} days before until the night it happens, "New" for the first ${R.fresh_days} days, at most ${R.max} lines.`,
    `${file.left_out} The list was gathered when the site was last built, ${stamp(file.generated)}.`,
  ]
  const structured = { as_of: new Date(now).toISOString(), count: shown.length, items: shown, notes, url: file.page, source: SOURCE }
  const L = [`What's new on wcehoops.com, as the homepage banner shows it:`]
  if (!shown.length) L.push('Nothing right now: no article, product update or UFC card is recent enough to be on the banner.')
  for (const x of shown) L.push(`- ${x.tag} · ${x.line}${x.url ? ` (${x.url})` : ''}`)
  L.push('', ...notes, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- a fan's fantasy league ----------------------------------------------------------

// A public Sleeper, ESPN or Fantrax league, read through the site's own /api/league (the same
// GET the Dynasty page makes; it holds no credentials and stores nothing), and valued the way
// that page values one: every name matched to the Dynasty Exchange list, priced on the live
// board, each roster summed, and each roster's best possible lineup for the league's slots.
// The matching, the slots and the lineup below are Dynasty.jsx's (priceList, SLOT_OK,
// DEFAULT_SLOTS, bestLineup); tools/savant-site/check.mjs runs the page's own code beside them.
const SLOT_OK = {
  PG: (p) => p.includes('PG'), SG: (p) => p.includes('SG'),
  SF: (p) => p.includes('SF'), PF: (p) => p.includes('PF'),
  C: (p) => p.includes('C'),
  G: (p) => p.includes('PG') || p.includes('SG') || p.includes('G'),
  F: (p) => p.includes('SF') || p.includes('PF') || p.includes('F'),
  UTIL: () => true,
}
const DEFAULT_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL']

// The best lineup, exactly: the most valuable player who can still be placed, with players
// already placed allowed to shuffle to make room (an augmenting path).
function bestLineup(players, slots) {
  const slotOf = slots.map((s) => SLOT_OK[s] || SLOT_OK.UTIL)
  const filled = new Array(slots.length).fill(-1)
  const ranked = players.map((p, i) => i).sort((a, b) => players[b].value - players[a].value)
  const tryPlace = (pi, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !slotOf[s](players[pi].pos)) continue
      seen[s] = true
      if (filled[s] === -1 || tryPlace(filled[s], seen)) { filled[s] = pi; return true }
    }
    return false
  }
  const starters = []
  for (const pi of ranked) {
    if (starters.length >= slots.length) break
    if (tryPlace(pi, new Array(slots.length).fill(false))) starters.push(pi)
  }
  const lineup = slots.map((name, s) => ({ slot: name, player: filled[s] === -1 ? null : players[filled[s]] }))
  return { lineup, total: lineup.reduce((a, l) => a + (l.player ? l.player.value : 0), 0) }
}

// A roster's names against the Dynasty Exchange list: case, punctuation, accents and a Jr.
// ignored, the surname alone when only one listed player has it. A name it cannot place is
// reported, not dropped. A listed player the board does not carry is priced at his opening
// rating.
function priceList(entries, seed, rows, value) {
  const key = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/ (jr|sr|ii|iii|iv|v)$/, '')
  const idx = {}
  const bySurname = {}
  for (const pl of seed) {
    const k = key(pl.name)
    idx[k] = pl
    const sn = k.split(' ').slice(-1)[0]
    ;(bySurname[sn] = bySurname[sn] || []).push(pl)
  }
  const priced = {}
  for (const r of rows) priced[String(r.id)] = r
  const hits = []
  const misses = []
  const seenIds = new Set()
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry.name
    const platformPos = typeof entry === 'string' ? [] : (entry.pos || [])
    const k = key(String(raw).replace(/^\s*\d+[.)]?\s*/, ''))
    if (!k) continue
    let pl = idx[k]
    if (!pl) {
      const cands = bySurname[k.split(' ').slice(-1)[0]] || []
      if (cands.length === 1) pl = cands[0]
    }
    if (!pl) { misses.push(raw); continue }
    if (seenIds.has(String(pl.id))) continue
    seenIds.add(String(pl.id))
    const r = priced[String(pl.id)] || { id: pl.id, rating: Math.round(pl.rating), rank: null }
    const pos = platformPos.length ? platformPos : (pl.pos ? [pl.pos] : [])
    hits.push({ id: String(pl.id), name: pl.name, rank: r.rank, pos, value: value(r.rating) })
  }
  hits.sort((a, b) => b.value - a.value)
  return { hits, misses, total: hits.reduce((a, h) => a + h.value, 0) }
}

// The Dynasty page's words when a league cannot be read (its connectLeague()).
const LEAGUE_ERROR = {
  'no-user': 'No Sleeper user with that username.',
  'no-leagues': 'That account has no NBA leagues we can see.',
  'no-league': 'Could not read that league. If it is private, paste your roster instead.',
  empty: 'That league came back with no rosters yet.',
  'bad-code': 'That does not look like a valid code.',
}
const PLATFORM = { sleeper: 'Sleeper', espn: 'ESPN', fantrax: 'Fantrax' }
export const leagueFeed = { timeoutMs: 20000 }

export async function getFantasyLeague({ platform, code, league, season, team } = {}) {
  const qs = new URLSearchParams({ platform, code })
  if (league) qs.set('league', league)
  if (season) qs.set('season', String(season))
  let body
  try {
    body = await readLive(`/api/league?${qs}`, leagueFeed.timeoutMs)
  } catch (err) {
    console.error('[site] league read failed:', err.message)
    throw new SavantError(`The site's league reader could not be reached right now. Try again in a minute. The Dynasty page can value a pasted roster instead: ${DYNASTY_PAGE}`)
  }
  if (!body || typeof body !== 'object') throw new SavantError(`Could not reach that league. The Dynasty page can value a pasted roster instead: ${DYNASTY_PAGE}`)
  if (!body.ok) {
    const said = LEAGUE_ERROR[body.error] || 'Could not reach that league. Paste your roster instead.'
    throw new SavantError(`${said} (${PLATFORM[platform]}, in the Dynasty page's words.) The Dynasty page also values a roster typed or pasted in: ${DYNASTY_PAGE}`)
  }
  // A Sleeper username with several NBA leagues: the page asks which one.
  if (Array.isArray(body.leagues) && !body.teams) {
    const leagues = body.leagues.map((l) => ({ id: String(l.id), name: String(l.name) }))
    const notes = ['Call again with one of these league ids as "league".']
    return {
      structured: { platform, league: null, leagues, teams: [], team: null, board_as_of: null, notes, url: DYNASTY_PAGE, source: SOURCE },
      text: `That Sleeper account has ${leagues.length} NBA leagues:\n${leagues.map((l) => `- ${l.name} (league ${l.id})`).join('\n')}\n${notes[0]}`,
    }
  }
  if (!Array.isArray(body.teams) || !body.teams.length) throw new SavantError(`That league came back with no rosters yet. The Dynasty page: ${DYNASTY_PAGE}`)

  const [file, live] = await Promise.all([files.load('dynasty.json'), liveBoard()])
  const { at, board, late } = live
  const seed = file.seed.map(([id, name, pos, rating]) => ({ id, name, pos, rating }))
  const value = pricer(board.rows, file.value)
  const fromLeague = Array.isArray(body.slots) && body.slots.length > 0
  const slots = (fromLeague ? body.slots : DEFAULT_SLOTS).map((x) => (SLOT_OK[x] ? x : 'UTIL'))
  const teams = body.teams.map((t) => {
    const p = priceList(t.players || [], seed, board.rows, value)
    const best = bestLineup(p.hits, slots)
    return { id: String(t.id), name: String(t.name), hits: p.hits, misses: p.misses, roster_value: p.total, lineup_value: best.total, lineup: best.lineup }
  })
  // The page's two orders, best first (a stable sort, so a tie keeps the league's order).
  const byLineup = [...teams].sort((a, b) => b.lineup_value - a.lineup_value)
  const byRoster = [...teams].sort((a, b) => b.roster_value - a.roster_value)

  let mine = null
  if (team) {
    mine = teams.find((t) => t.id === team) || null
    if (!mine) {
      const found = settle(prepare(teams), team)
      if (found.one) mine = found.one
      else throw new SavantError(`${found.many ? `${found.many.length} teams in this league could be "${team}"` : `No team in this league is called "${team}"`}. Its teams: ${teams.map((t) => `${t.name} (id ${t.id})`).join(', ')}.`)
      mine = teams.find((t) => t.id === mine.id)
    }
  }

  const minutes = Math.max(1, Math.round((Date.now() - at) / 60000))
  const notes = [
    `Valued on the Dynasty Exchange board read at ${stamp(at)}.${late ? ` The board could not be re-read just now, so this is the copy from about ${count(minutes, 'minute')} ago.` : ''} A value is a crowd price, not a WCE projection and not advice; the top of the board is ${thousands(file.value.top)}.`,
    `Best lineup: each roster's best possible ${slots.join(' / ')}${fromLeague ? ', the league\'s own starting slots' : ', the common 10-man shape, since this platform does not say its slots'}. Every roster is optimised, not taken as currently set, so this compares ceilings rather than who remembered to set a lineup.`,
    'Whole roster: every rostered player, summed. It measures accumulated equity, which rewards depth a starting lineup never plays.',
  ]
  const unmatched = teams.reduce((n, t) => n + t.misses.length, 0)
  if (unmatched) notes.push(`${count(unmatched, 'rostered name')} could not be matched to a player on the Dynasty Exchange list and ${unmatched === 1 ? 'is' : 'are'} left out of the totals, named per team.`)

  const row = (t) => ({
    id: t.id,
    name: t.name,
    lineup_value: t.lineup_value,
    roster_value: t.roster_value,
    rank_by_lineup: byLineup.indexOf(t) + 1,
    rank_by_roster: byRoster.indexOf(t) + 1,
    players_priced: t.hits.length,
    unmatched: t.misses.map(String),
  })
  const structured = {
    platform,
    league: { name: body.leagueName || null, teams: teams.length, slots, slots_from_league: fromLeague },
    leagues: null,
    teams: byLineup.map(row),
    team: mine ? {
      ...row(mine),
      players: mine.hits.map((h) => ({ name: h.name, id: h.id, value: h.value, positions: h.pos, board_rank: h.rank ?? null })),
      lineup: mine.lineup.map((l) => ({ slot: l.slot, player: l.player ? l.player.name : null, value: l.player ? l.player.value : 0 })),
    } : null,
    board_as_of: new Date(at).toISOString(),
    notes,
    url: DYNASTY_PAGE,
    source: SOURCE,
  }

  const name = body.leagueName ? `${body.leagueName} (${PLATFORM[platform]})` : `This ${PLATFORM[platform]} league`
  const L = [`${name}, ${teams.length} teams, valued on the Dynasty Exchange the way wcehoops.com's Dynasty page values a league.`, ...notes, '']
  L.push(`Power rankings by best lineup (${slots.join(' / ')}):`)
  byLineup.forEach((t, i) => L.push(`${i + 1}. ${t.name}: ${thousands(t.lineup_value)}${t.misses.length ? ` (${t.misses.length} unmatched)` : ''}`))
  L.push('', 'By whole roster:')
  byRoster.forEach((t, i) => L.push(`${i + 1}. ${t.name}: ${thousands(t.roster_value)} (${count(t.hits.length, 'player')})`))
  if (mine) {
    L.push('', `${mine.name}, player by player:`)
    for (const h of mine.hits) L.push(`- ${h.name} (${h.pos.join('/') || 'no position'}): ${thousands(h.value)}`)
    if (mine.misses.length) L.push(`Not on the Dynasty Exchange list, so not priced: ${mine.misses.join(', ')}.`)
    L.push('', `${mine.name}'s best lineup:`)
    for (const l of mine.lineup) L.push(`- ${l.slot}: ${l.player ? `${l.player.name}, ${thousands(l.player.value)}` : 'nobody eligible'}`)
  } else {
    L.push('', 'Give "team" (a name or id from this list) for one roster player by player and its best lineup.')
  }
  L.push('', `Dynasty page: ${DYNASTY_PAGE}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -----------------------------------------------------------------------

const yearRow = z.object({ year: z.number().int(), label: z.string(), sublabel: z.string().nullable(), status: z.string().nullable() })
const notesShape = z.array(z.string())

// What api/mcp.js registers: { name, config, run }. run returns { text, structured }.
export const tools = [
  {
    name: 'wce_get_news',
    config: {
      title: 'Get the WCE News page',
      description:
        'The current items on the News page of Western Conference Elitists (wcehoops.com). It has two lists: "headlines", NBA and men\'s college basketball stories from other outlets, and "analytics", basketball research papers and long-form analytics articles. Each item has its title, the outlet that published it, the link to that outlet\'s story and its publication date. Headlines also name other outlets that covered the story and up to three players, with links to their Basketball Savant cards. Analytics items say whether they are a paper or an article and name up to four authors. The stories themselves are not included. The result states when the list was generated and how old it is: a scheduled job produces it, and it can be out of date.',
      inputSchema: {
        section: z.enum(['headlines', 'analytics']).default('headlines').describe('"headlines" (default) for the stories list, "analytics" for the research and analytics list.'),
        start: z.number().int().min(1).max(200).default(1).describe('Position of the first item to return, counting from 1 in the page\'s order (default 1).'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most items to return (1-25, default 10).'),
      },
      outputSchema: {
        section: z.string().describe('headlines or analytics.'),
        generated_at: z.string().describe('When the news pipeline produced this list.'),
        age_days: z.number().int().describe('Whole days between then and this answer.'),
        stale: z.boolean().describe('True when the list is more than two days old: it is a snapshot from generated_at, not current news.'),
        total: z.number().int().describe('Items in this list on the page.'),
        count: z.number().int().describe('Items returned here.'),
        items: z.array(z.object({
          position: z.number().int().describe('Place in the page\'s order, from 1.'),
          title: z.string().describe('The outlet\'s headline, or the paper\'s title.'),
          outlet: z.string().nullable().describe('Who published it.'),
          url: z.string().describe('Link to the story or paper at its publisher.'),
          published: z.string().nullable().describe('When the outlet published it.'),
          also_covered_by: z.array(z.string()).optional().describe('Headlines only: other outlets that ran the story.'),
          players: z.array(z.object({ name: z.string(), url: z.string().describe('His Basketball Savant card.') })).optional().describe('Headlines only: up to three players named, as the page shows.'),
          type: z.string().optional().describe('Analytics only: Paper or Article.'),
          authors: z.array(z.string()).optional().describe('Analytics only: up to four authors, as the page shows.'),
          et_al: z.boolean().optional().describe('Analytics only: true when there are more authors than listed.'),
        })),
        notes: notesShape.describe('When the list was generated, and whose stories these are.'),
        url: z.string().describe('The News page, on this list\'s tab.'),
        source: z.string(),
      },
      annotations: { title: 'Get the WCE News page', ...READ_ONLY },
    },
    run: ({ section, start, limit }) => getNews({ section, start, limit }),
  },
  {
    name: 'wce_search_articles',
    config: {
      title: 'Search WCE articles',
      description:
        'Articles published by Western Conference Elitists (wcehoops.com) on its Analysis page: WCE\'s own writing, not the outlet stories on its News page. Returns each article\'s title, category, summary (the opening of the article, as on its card), author, date, reading time and link, newest first. With a query, only the articles whose title, summary, author or category match it; matching ignores accents and punctuation and tolerates small typos. Without one, every published article. The article text is not included.',
      inputSchema: {
        query: z.string().trim().min(2).max(80).optional().describe('Words to look for in the title, summary, author or category, e.g. "Jaylen Brown". Omit to list every article.'),
        category: z.string().trim().min(2).max(40).optional().describe('Only articles in this site category, e.g. "Analytics" or "Draft".'),
        limit: z.number().int().min(1).max(25).default(10).describe('Most articles to return (1-25, default 10).'),
      },
      outputSchema: {
        query: z.string().nullable(),
        category: z.string().nullable(),
        total: z.number().int().describe('How many articles matched.'),
        count: z.number().int().describe('How many are returned here.'),
        published: z.number().int().describe('How many articles WCE has published in all.'),
        articles: z.array(z.object({
          slug: z.string().describe('The article\'s id, for wce_get_article.'),
          title: z.string(),
          category: z.string().nullable(),
          summary: z.string().nullable().describe('The opening of the article, as the site shows it on the card.'),
          author: z.string().nullable(),
          date: z.string().nullable().describe('Publication date as the site prints it.'),
          read_time: z.string().nullable(),
          url: z.string().describe('The article on wcehoops.com.'),
        })),
        notes: notesShape,
        url: z.string().describe('The Analysis page.'),
        source: z.string(),
      },
      annotations: { title: 'Search WCE articles', ...READ_ONLY },
    },
    run: ({ query, category, limit }) => searchArticles({ query, category, limit }),
  },
  {
    name: 'wce_get_article',
    config: {
      title: 'Get a WCE article',
      description:
        `One article published by Western Conference Elitists (wcehoops.com): its title, author, category, date, reading time and its text as plain paragraphs, with "[image]" marking where a picture sits on the page. An article longer than about ${thousands(ARTICLE_CAP)} characters is cut at a paragraph break, and the result says how much was left out. Includes the link to the full article.`,
      inputSchema: {
        article: z.string().trim().min(1).max(200).describe('The article\'s slug from wce_search_articles, its wcehoops.com link, or its title. If a title fits more than one article, or is only a near spelling of one, the error lists the slugs to choose from.'),
      },
      outputSchema: {
        slug: z.string(),
        title: z.string(),
        category: z.string().nullable(),
        author: z.string().nullable(),
        date: z.string().nullable().describe('Publication date as the site prints it.'),
        published_at: z.string().nullable(),
        read_time: z.string().nullable(),
        text: z.string().describe('The article\'s words, paragraphs separated by blank lines.'),
        words: z.number().int().describe('Words in the whole article.'),
        words_returned: z.number().int().describe('Words in the text returned here.'),
        truncated: z.boolean().describe('True when the text stops before the article does.'),
        images: z.number().int().describe('Pictures in the article, each marked "[image]" in the text.'),
        notes: notesShape,
        url: z.string().describe('The article on wcehoops.com.'),
        source: z.string(),
      },
      annotations: { title: 'Get a WCE article', ...READ_ONLY },
    },
    run: ({ article }) => getArticle({ article }),
  },
  {
    name: 'wce_get_big_board',
    config: {
      title: 'Get the WCE draft Big Board',
      description:
        'The Big Board on Western Conference Elitists (wcehoops.com): WCE\'s personal ranking of NBA draft prospects for one draft class, grouped into tiers. It is an evaluation, not a consensus mock draft and not a prediction of draft slot, and it holds no draft results. Without a prospect, returns every prospect on that class\'s board with rank, tier, school, position, height, wingspan and letter grade. With a prospect, returns his full write-up: summary, strengths, weaknesses, measurements, archetype, projection and WCE\'s take. Defaults to the class the page opens on. A measurement the board does not list is null.',
      inputSchema: {
        year: z.number().int().min(1947).max(2100).optional().describe('Draft year, e.g. 2026. Omit for the class the page opens on.'),
        prospect: z.string().trim().min(1).max(80).optional().describe('A prospect\'s name (e.g. "Keaton Wagler") or his rank on the board (e.g. "5") for his full write-up. Omit for the whole board. With no year, the default class is searched first, then the others. If a name fits more than one prospect, or is only a near spelling of one, the error lists the names to choose from.'),
      },
      outputSchema: {
        year: z.number().int(),
        label: z.string().describe('The class as the page names it.'),
        sublabel: z.string().nullable(),
        status: z.string().nullable().describe('The page\'s own status label for this board.'),
        draft_date: z.string().nullable().describe('The draft date the page lists for the class, where it lists one.'),
        view: z.string().describe('"board" for the whole board, "prospect" for one write-up.'),
        prospect_count: z.number().int().describe('Prospects on this board.'),
        tier_count: z.number().int(),
        tiers: z.array(z.object({ tier: z.number().int(), name: z.string(), range: z.string().nullable(), blurb: z.string().nullable() })),
        prospects: z.array(z.object({
          rank: z.number().int(),
          tier: z.number().int(),
          name: z.string(),
          school: z.string().nullable(),
          position: z.string().nullable(),
          height: z.string().nullable(),
          wingspan: z.string().nullable(),
          grade: z.string().nullable().describe('WCE\'s letter grade.'),
          weight: z.string().nullable().optional(),
          age: z.string().nullable().optional().describe('As the page prints it: a number, a range, or a class year such as "Fr.".'),
          archetype: z.string().nullable().optional(),
          tag: z.string().nullable().optional().describe('A label the board puts on a few prospects, e.g. "Higher Than Consensus".'),
          summary: z.string().nullable().optional(),
          strengths: z.array(z.string()).optional(),
          weaknesses: z.array(z.string()).optional(),
          projection: z.string().nullable().optional(),
          take: z.string().nullable().optional(),
        })).describe('In board order. The write-up fields are present in the "prospect" view only. Null means the board shows a dash.'),
        other_years: z.array(yearRow).describe('The other classes the page offers.'),
        notes: notesShape.describe('What the board is and is not.'),
        url: z.string().describe('The Big Board page.'),
        source: z.string(),
      },
      annotations: { title: 'Get the WCE draft Big Board', ...READ_ONLY },
    },
    run: ({ year, prospect }) => getBigBoard({ year, prospect }),
  },
  {
    name: 'wce_get_dynasty_rankings',
    config: {
      title: 'Get the WCE Dynasty Exchange board',
      description:
        `The Dynasty Exchange board on Western Conference Elitists (wcehoops.com), read live: NBA players ordered by a dynasty-league value that visitors set by ranking four players at a time. Returns each player's rank, his value (the top of the board is 10,000) and how many submitted rankings he has appeared in, marks the values the site still treats as provisional, and gives the number of rankings submitted in all. A value is a crowd price, not a WCE projection and not advice. Returns the top of the board (the page lists ${BOARD_ROWS}) or the listed players whose names match. It only reads the board: it cannot submit a ranking.`,
      inputSchema: {
        limit: z.number().int().min(1).max(BOARD_ROWS).default(25).describe(`Most players to return (1-${BOARD_ROWS}, default 25), from the top of the board.`),
        player: z.string().trim().min(2).max(80).optional().describe('Only the listed players whose names match, e.g. "Cooper Flagg" or "Brown". Omit for the top of the board. A name that is only a near spelling of a listed player is not priced: the error lists the names to choose from.'),
      },
      outputSchema: {
        as_of: z.string().describe('When the live board was read.'),
        stale: z.boolean().describe('True when the board could not be re-read and a copy a few minutes old is returned.'),
        listed: z.number().int().describe('Players on the board.'),
        total_rankings: z.number().int().describe('Rankings submitted by visitors in all.'),
        player: z.string().nullable(),
        matched: z.number().int().nullable().describe('How many listed players matched the name, when one was given.'),
        count: z.number().int().describe('How many are returned here.'),
        players: z.array(z.object({
          rank: z.number().int().describe('Place on the board.'),
          id: z.string(),
          name: z.string(),
          value: z.number().int().describe('The crowd price as the page shows it.'),
          rankings: z.number().int().describe('Submitted rankings he has appeared in: the page\'s "Vol".'),
          provisional: z.boolean().describe('True while too few rankings sit behind the value for the site to treat it as settled.'),
          run: z.number().int().nullable().describe('3 means first in each of his last three rankings, -3 last in each. Null under two in a row.'),
        })),
        notes: notesShape.describe('When the board was read, what a value is, and how many rankings sit behind it.'),
        url: z.string().describe('The Dynasty Exchange.'),
        source: z.string(),
      },
      annotations: { title: 'Get the WCE Dynasty Exchange board', ...READ_ONLY },
    },
    run: ({ limit, player }) => getDynastyRankings({ limit, player }),
  },
  {
    name: 'wce_get_trending',
    config: {
      title: 'Get the most-searched players and prospects on WCE',
      description:
        'The most-searched players and prospects on Western Conference Elitists (wcehoops.com), read live: the ones picked most from the home-screen search of Basketball Savant (NBA players) and of Draft Savant (draft prospects) over the last seven days, recent days counting more, each with its name, link and whether it is rising, steady or cooling off. The home screens show the first six of each. It counts searches on the site, not anyone\'s play. When the site\'s counter is offline the result says so; no substitute list is given.',
      inputSchema: {
        section: z.enum(['both', 'players', 'prospects']).default('both').describe('"players" (Basketball Savant), "prospects" (Draft Savant) or "both" (default).'),
      },
      outputSchema: {
        section: z.string(),
        lists: z.array(z.object({
          section: z.string().describe('players or prospects.'),
          page: z.string(),
          read_at: z.string().describe('When the live count was read.'),
          unknown_ids: z.number().int().describe('Searched ids the section\'s files have no name for; the page skips them too.'),
          items: z.array(z.object({
            rank: z.number().int(),
            id: z.string().describe('Player id for nba_get_player_profile, or prospect id for nba_draft_get_prospect_profile.'),
            name: z.string(),
            detail: z.string().nullable(),
            trend: z.string().describe('up, down or flat: the page\'s fire and ice.'),
            weighted_searches: z.number().describe('Picks over 7 days, today counting 7 times and six days ago once.'),
            on_home_screen: z.boolean(),
            url: z.string(),
          })),
        })),
        notes: notesShape,
        source: z.string(),
      },
      annotations: { title: 'Get the most-searched players and prospects on WCE', ...READ_ONLY },
    },
    run: ({ section }) => getTrending({ section }),
  },
  {
    name: 'wce_whats_new',
    config: {
      title: 'Get what\'s new on WCE',
      description:
        'What is new on Western Conference Elitists (wcehoops.com), as the homepage banner shows it at the moment of asking: product updates (Basketball Savant, Football Savant, Flappy Hoops and the rest, with version numbers), new articles and the next UFC card, each with its date tag ("New" for the first three days) and link. Each kind stays up for its own number of days, as on the banner. The banner\'s YouTube uploads are not included.',
      inputSchema: {},
      outputSchema: {
        as_of: z.string(),
        count: z.number().int(),
        items: z.array(z.object({
          kind: z.string().describe('product update, article or UFC card.'),
          date: z.string(),
          line: z.string().describe('The line as the banner reads.'),
          tag: z.string().describe('"New", or the date as the banner prints it.'),
          new: z.boolean(),
          url: z.string().nullable(),
        })),
        notes: notesShape,
        url: z.string(),
        source: z.string(),
      },
      annotations: { title: 'Get what\'s new on WCE', ...READ_ONLY },
    },
    run: () => getWhatsNew({}),
  },
  {
    name: 'nba_fantasy_league',
    config: {
      title: 'Value a fantasy basketball league on the WCE Dynasty Exchange',
      description:
        'Values a fan\'s own fantasy basketball league on the Dynasty Exchange of Western Conference Elitists (wcehoops.com), the way its Dynasty page does: every team\'s optimal starting lineup for the league\'s slots and its whole roster, each priced on the live crowd board and ranked, with any name the board does not list reported. Reads a public Sleeper (username or league id), ESPN (league id) or Fantrax (league id) league through the site\'s own league reader; nothing is stored and no sign-in is asked for. With a team, that roster player by player. Values are crowd prices, not projections.',
      inputSchema: {
        platform: z.enum(['sleeper', 'espn', 'fantrax']).describe('Where the league is.'),
        code: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/).describe('Sleeper username or league id; the ESPN or Fantrax league id from the league\'s address.'),
        league: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional().describe('Sleeper: which league, when a username has several (the result lists them).'),
        season: z.number().int().min(2000).max(2100).optional().describe('ESPN: the season by the year it ends, e.g. 2027. Omit for the current one.'),
        team: z.string().trim().min(1).max(80).optional().describe('A team\'s name or id in the league, for its roster player by player and its best lineup.'),
      },
      outputSchema: {
        platform: z.string(),
        league: z.object({ name: z.string().nullable(), teams: z.number().int(), slots: z.array(z.string()), slots_from_league: z.boolean() }).nullable(),
        leagues: z.array(z.object({ id: z.string(), name: z.string() })).nullable().describe('When a Sleeper username has several leagues: the ones to choose from.'),
        teams: z.array(z.object({
          id: z.string(),
          name: z.string(),
          lineup_value: z.number().int().describe('Best possible starting lineup, summed.'),
          roster_value: z.number().int().describe('Every rostered player, summed.'),
          rank_by_lineup: z.number().int(),
          rank_by_roster: z.number().int(),
          players_priced: z.number().int(),
          unmatched: z.array(z.string()).describe('Rostered names not on the Dynasty Exchange list; not priced.'),
        })).describe('Best lineup first.'),
        team: z.object({
          id: z.string(), name: z.string(), lineup_value: z.number().int(), roster_value: z.number().int(),
          rank_by_lineup: z.number().int(), rank_by_roster: z.number().int(), players_priced: z.number().int(), unmatched: z.array(z.string()),
          players: z.array(z.object({ name: z.string(), id: z.string(), value: z.number().int(), positions: z.array(z.string()), board_rank: z.number().int().nullable() })),
          lineup: z.array(z.object({ slot: z.string(), player: z.string().nullable(), value: z.number().int() })),
        }).nullable(),
        board_as_of: z.string().nullable(),
        notes: notesShape,
        url: z.string().describe('The Dynasty page.'),
        source: z.string(),
      },
      annotations: { title: 'Value a fantasy basketball league on the WCE Dynasty Exchange', ...READ_ONLY, openWorldHint: true },
    },
    run: ({ platform, code, league, season, team }) => getFantasyLeague({ platform, code, league, season, team }),
  },
]
