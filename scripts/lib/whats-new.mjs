// The homepage banner's "what's new" list, gathered at build time.
//
// Four sources, all automatic once they exist:
//   - articles: every file in src/data/articles/ (its publishedAt)
//   - videos and Shorts: the channel's public YouTube feed (no key; skipped if it can't be reached)
//   - product updates: src/data/updates.json, one line per shipped update (see PUBLISHING.md)
//   - the next UFC card: public/ufc-savant-data.json (upcoming.cards)
//
// Every item carries its date. The page decides what is still recent when someone opens it
// (src/lib/whatsNew.js), so a line ages out on time even if the site hasn't been rebuilt.
// The site rebuilds several times a day (news and data refreshes), and each build re-reads the feed.
import fs from 'node:fs'
import path from 'node:path'

const ID = 'virtual:whats-new'
const RESOLVED = '\0' + ID
const CHANNEL = 'UCFhQ4Kx16jPaychtaykpk0A' // youtube.com/@WesternConferenceElitists
export const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`
const KEEP_DAYS = 45

const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// One <entry> per upload. Shorts have /shorts/ links; their titles often end in #shorts.
export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, e]) => {
      const title = unescape((e.match(/<title>([^<]*)<\/title>/) || [])[1] || '')
        .replace(/\s*#shorts?\b/gi, '')
        .trim()
      const href = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1]
      const date = (e.match(/<published>([^<]+)<\/published>/) || [])[1]
      if (!title || !href || !date) return null
      return { kind: href.includes('/shorts/') ? 'short' : 'video', date, text: title, href }
    })
    .filter(Boolean)
}

async function videos(warn) {
  try {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseFeed(await res.text())
  } catch (err) {
    warn(`whats-new: the YouTube feed was skipped (${err.message}); the banner shows everything else`)
    return []
  }
}

function articles(root) {
  const dir = path.join(root, 'src/data/articles')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((a) => a.slug && a.title && (a.publishedAt || a.date))
    .map((a) => ({ kind: 'article', date: a.publishedAt || new Date(a.date).toISOString(), text: a.title, to: `/articles/${a.slug}` }))
}

function updates(root) {
  const file = path.join(root, 'src/data/updates.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8')).map((u) => ({ kind: 'update', ...u }))
}

function nextCard(root) {
  const file = path.join(root, 'public/ufc-savant-data.json')
  if (!fs.existsSync(file)) return []
  try {
    const cards = JSON.parse(fs.readFileSync(file, 'utf8')).upcoming?.cards || []
    return cards.slice(0, 1).map((c) => ({
      kind: 'event',
      date: c.date,
      text: `UFC Savant: every fighter on the ${c.name.replace(/^UFC Fight Night:\s*/, '').replace(/^(UFC \d+):\s*/, '$1, ')} card`,
      href: '/ufc-savant.html',
    }))
  } catch {
    return []
  }
}

export async function gather(root, warn = console.warn, now = Date.now()) {
  const all = [...articles(root), ...updates(root), ...nextCard(root), ...(await videos(warn))]
  const cutoff = now - KEEP_DAYS * 864e5
  return all.filter((it) => Date.parse(it.date) >= cutoff).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

export default function whatsNew() {
  let root = process.cwd()
  return {
    name: 'whats-new',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === ID) return RESOLVED
    },
    async load(id) {
      if (id !== RESOLVED) return
      const items = await gather(root, (msg) => this.warn(msg))
      return `export default ${JSON.stringify({ generated: new Date().toISOString(), items })}`
    },
  }
}
