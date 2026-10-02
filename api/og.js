// api/og.js — the link-preview image for a player page (what X, iMessage, Slack and Discord show
// when someone pastes wcehoops.com/player/<slug>).
//
//   GET /api/og?p=<slug>&v=<stamp>   -> 1200×630 PNG: name, team, stat line, six percentile bars
//
// Drawn on request and cached at the edge, rather than stored: 3,800 PNGs would add ~200 MB to
// every deployment. The numbers are NOT taken from the query string (anyone could then mint a
// WCE-branded card saying anything); the function reads them from the player's own page, where
// scripts/lib/player-pages.mjs put them in a <script id=card> block. `v` only changes when the
// data or the design does, so previews refetch then and not otherwise.
//
// Anything going wrong (unknown slug, page unreachable, render error) redirects to the site's
// generic card, so a shared link always previews as something.
//
// Fonts come from api/_og-fonts.js (SIL Open Font License; the same faces the site uses).

import { ImageResponse } from '@vercel/og'
import { NEWSREADER_600, NEWSREADER_600_EXT, PLEX_MONO_500, PLEX_SANS_500, PLEX_SANS_700 } from './_og-fonts.js'

const PROD_HOST = 'wcehoops.com'
const FALLBACK = '/og-card.png'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CARD = /<script type=application\/json id=card>([\s\S]*?)<\/script>/

const INK = '#191B1F', MUTED = '#4E535B', FAINT = '#6F757E', LINE = '#E1E0DC', TRACK = '#E9E8E4'
const NAVY = '#22395A', GOLD = '#C2A263', BG = '#ECEBE8'

const FONTS = [
  { name: 'Newsreader', weight: 600, style: 'normal', data: NEWSREADER_600 },
  { name: 'Newsreader', weight: 600, style: 'normal', data: NEWSREADER_600_EXT }, // ž ć č ņ … for names like Dražen Petrović
  { name: 'Plex Sans', weight: 500, style: 'normal', data: PLEX_SANS_500 },
  { name: 'Plex Sans', weight: 700, style: 'normal', data: PLEX_SANS_700 },
  { name: 'Plex Mono', weight: 500, style: 'normal', data: PLEX_MONO_500 },
]

// Blue -> grey -> red: the same ramp as the tool's bars (colorAt in savant-core.mjs).
function colorAt(p) {
  const LO = [28, 78, 134], MID = [194, 192, 182], HI = [188, 58, 44]
  const mix = (a, b, u) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * u))
  const t = Math.max(0, Math.min(100, p)) / 100
  const c = t < 0.5 ? mix(LO, MID, t / 0.5) : mix(MID, HI, (t - 0.5) / 0.5)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// Where the player's page can be read from: the host this request came in on when it is one of
// ours (so a preview deployment draws its own data), then production. The list is exact, not a
// pattern: the image is cached for a month, so it must never be built from someone else's page.
function hostsFor(req) {
  const ours = new Set([PROD_HOST, 'www.' + PROD_HOST, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean).map((h) => h.toLowerCase()))
  const h = String(req.headers.host || '').toLowerCase()
  const local = !process.env.VERCEL && /^localhost(:\d+)?$/.test(h) // `vercel dev` and the tests
  const out = ours.has(h) || local ? [h] : []
  if (!out.includes(PROD_HOST)) out.push(PROD_HOST)
  return out
}

async function loadCard(req, slug) {
  for (const host of hostsFor(req)) {
    try {
      const r = await fetch(`${host.startsWith('localhost') ? 'http' : 'https'}://${host}/player/${slug}`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(4000),
      })
      if (!r.ok) continue
      const m = (await r.text()).match(CARD)
      if (!m) continue // an unknown slug falls through to the app shell, which has no card
      const c = JSON.parse(m[1])
      if (c && typeof c.n === 'string' && Array.isArray(c.b)) return c
    } catch { /* try the next host */ }
  }
  return null
}

// Satori takes React-style element objects; this keeps the layout readable without JSX.
const el = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) } })
const txt = (style, text) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(text) } })

function bar([label, pct, value]) {
  const has = typeof pct === 'number'
  const inside = has && pct > 86
  return el({ alignItems: 'center', height: 54 },
    txt({ width: 196, fontFamily: 'Plex Sans', fontWeight: 500, fontSize: 21, color: INK, lineHeight: 1.15 }, label),
    el({ position: 'relative', width: 286, height: 30, borderRadius: 9, backgroundColor: TRACK, overflow: 'hidden' },
      has && el({ position: 'absolute', left: 0, top: 0, width: `${Math.max(pct, 2)}%`, height: 30, borderRadius: 9, backgroundColor: colorAt(pct) }),
      has && txt({ position: 'absolute', top: 0, height: 30, alignItems: 'center', left: inside ? pct * 2.86 - 38 : pct * 2.86 + 9, fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 19, color: INK }, pct),
    ),
    txt({ width: 104, justifyContent: 'flex-end', fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 21, color: INK }, value),
  )
}

function layout(c, slug) {
  const name = c.n
  const nameSize = name.length > 24 ? 50 : name.length > 17 ? 60 : 74
  const hasPct = c.b.some((b) => typeof b[1] === 'number')
  const chips = (c.a || []).slice(0, 3)
  return el({ width: 1200, height: 630, backgroundColor: BG, padding: 30 },
    el({ flexDirection: 'column', flexGrow: 1, backgroundColor: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 26, padding: '34px 44px 28px' },
      // brand row
      el({ alignItems: 'center', justifyContent: 'space-between' },
        el({ alignItems: 'center' },
          txt({ width: 52, height: 52, borderRadius: 12, backgroundColor: NAVY, color: '#FFFFFF', alignItems: 'center', justifyContent: 'center', fontFamily: 'Plex Sans', fontWeight: 700, fontSize: 18 }, 'WCE'),
          txt({ marginLeft: 14, fontFamily: 'Plex Sans', fontWeight: 700, fontSize: 25, letterSpacing: 0.8, color: INK }, 'BASKETBALL'),
          txt({ marginLeft: 8, fontFamily: 'Plex Sans', fontWeight: 700, fontSize: 25, letterSpacing: 0.8, color: NAVY }, 'SAVANT'),
        ),
        txt({ backgroundColor: NAVY, color: '#FFFFFF', borderRadius: 7, padding: '6px 12px', fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 17, letterSpacing: 1.2 }, `${c.s}${hasPct ? ' · VS LEAGUE' : ''}`),
      ),
      // body: identity on the left, bars on the right
      el({ flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
        el({ flexDirection: 'column', width: 470, paddingRight: 20 },
          c.k && txt({ alignSelf: 'flex-start', backgroundColor: GOLD, color: '#2A2208', borderRadius: 5, padding: '4px 10px', marginBottom: 14, fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 15, letterSpacing: 2 }, 'CAREER BEST'),
          txt({ fontFamily: 'Newsreader', fontWeight: 600, fontSize: nameSize, lineHeight: 1.02, letterSpacing: -0.6, color: INK }, name),
          txt({ marginTop: 14, fontFamily: 'Plex Sans', fontWeight: 500, fontSize: 25, color: MUTED }, `${c.t} · ${c.p}`),
          c.l && el({ marginTop: 16, alignItems: 'baseline' },
            ...['PPG', 'RPG', 'APG'].flatMap((u, i) => [
              txt({ fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 29, color: INK, marginLeft: i ? 20 : 0 }, c.l[i]),
              txt({ fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 18, color: FAINT, marginLeft: 7 }, u),
            ]),
          ),
          chips.length > 0 && el({ marginTop: 18, flexWrap: 'wrap' },
            ...chips.map((a) => txt({ border: `2px solid ${NAVY}`, color: NAVY, borderRadius: 6, padding: '3px 10px', marginRight: 8, marginBottom: 6, fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 15, letterSpacing: 1.1 }, a.toUpperCase())),
          ),
        ),
        el({ flexDirection: 'column', width: 586 }, ...c.b.slice(0, 6).map(bar)),
      ),
      // footer
      el({ alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${LINE}`, paddingTop: 16 },
        txt({ fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 19, color: NAVY }, `${PROD_HOST}/player/${slug}`),
        txt({ fontFamily: 'Plex Mono', fontWeight: 500, fontSize: 15, letterSpacing: 1, color: FAINT }, hasPct ? 'PERCENTILE VS QUALIFIED PLAYERS' : 'BASKETBALL SAVANT'),
      ),
    ),
  )
}

function fallback(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
  return res.redirect(302, FALLBACK)
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'GET only' })
  const slug = String((req.query && req.query.p) || '')
  if (!SLUG.test(slug) || slug.length > 80) return fallback(res)
  try {
    const card = await loadCard(req, slug)
    if (!card) return fallback(res)
    const image = new ImageResponse(layout(card, slug), { width: 1200, height: 630, fonts: FONTS })
    const png = Buffer.from(await image.arrayBuffer())
    res.setHeader('Content-Type', 'image/png')
    // The URL carries a version stamp, so the edge can keep each image for a long time.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(png)
  } catch (e) {
    console.error('[og] failed for', slug, e && e.message ? e.message : e)
    return fallback(res)
  }
}
