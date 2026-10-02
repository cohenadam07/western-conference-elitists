// What search engines and AI crawlers read about each product, in one place.
//
// The goal: when someone searches a product by name ("basketball savant", "football savant",
// "ufc savant", "dynasty exchange"), wcehoops.com is a page Google can match to that name. That
// takes a title that says the name and what it is, a few sentences of real text on the page,
// links between the products, and structured data that names the product and who makes it.
// scripts/lib/seo-build.mjs puts all of it into the built pages; nothing in public/ is edited,
// so the data pipelines that rewrite those files every night cannot undo it.
//
// EVERY SENTENCE HERE IS A CLAIM ABOUT A TOOL. Keep them true. Each one below was checked against
// the page it describes or against the /savant-api meta file for that section (seasons covered,
// qualifying lines, comparison pools). No counts that go stale: say "every season back to
// 1979-80", not "47 seasons". `npm run check:seo` checks the mechanics, not the facts.

export const SITE = 'https://wcehoops.com'
export const SITE_NAME = 'Western Conference Elitists'
// The channel's handle, checked against the live channel (id UCFhQ4Kx16jPaychtaykpk0A).
export const YOUTUBE = 'https://www.youtube.com/@WesternConferenceElitists'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

// Everything worth a link, in the order it is listed wherever the products are listed.
// `blurb` is the line the homepage tile already uses for it (src/components/Gateway.jsx).
export const PRODUCTS = [
  { name: 'Basketball Savant', href: '/basketball-savant.html', blurb: 'Every NBA player, every season back to 1979-80: percentile sliders, shot charts, and comps.' },
  { name: 'Football Savant', href: '/football-savant.html', blurb: 'Every NFL player back to 1999, ranked against the men who play his position, with throw maps, run-gap maps and comps.' },
  { name: 'UFC Savant', href: '/ufc-savant.html', blurb: 'Every UFC fighter, ranked against the weight class: strike maps, round curves, head-to-heads and comps.' },
  { name: 'Coaching Savant', href: '/coaching-savant.html', blurb: 'Every NFL head coach since 1999: records, playoff history, what they called, and a coaching tree drawn back to Paul Brown.' },
  { name: 'Draft Savant', href: '/draft-savant.html', blurb: 'NBA Draft prospect models and the full board, every class back to 2010.' },
  { name: 'Dynasty Exchange', href: '/dynasty', blurb: 'A dynasty basketball board priced by the people who argue about it. Rank four players and move the market, or paste your roster and see what it is worth.' },
  { name: 'Big Board', href: '/rankings', blurb: 'Every draft prospect ranked and tiered. A personal board, not a consensus mock.' },
  { name: 'Comp Chain', href: '/comp-chain', blurb: 'Hop player to player through their statistical comps in as few moves as you can. A new puzzle every day.' },
  { name: 'Flappy Hoops', href: '/hoops', blurb: 'Flap the ball through the rim in as few taps as you can. Sixteen NBA cities, nine holes in each, and online races with up to eight friends.' },
  { name: 'Analysis', href: '/articles', blurb: 'Scouting breakdowns, team-building theory, and NBA analytics that hold up under pressure.' },
  { name: 'News', href: '/news', blurb: 'The biggest NBA and college basketball stories, plus basketball research and analytics.' },
  { name: 'The Weekly Board', href: '/newsletter', blurb: 'The newsletter: one board move, one prospect, and one stat. Free.' },
  { name: 'About', href: '/about', blurb: 'Who we are and how we work.' },
]

// ---------------------------------------------------------------------------------------------
// The five hand-built tool pages (public/*-savant.html).
//
// title        the <title>: the name first, then what it is, then the brand
// description  meta description, about 150 characters
// about        the "What is X?" panel under the landing screen. A list of paragraphs; plain text
//              except where a paragraph is { html } (links).
// look         which of the page's own surface styles the panel borrows: 'soft' (paper and
//              hairlines), 'hard' (Pixel Turf: thick borders, hard shadows), 'dark' (UFC)
// category     schema.org applicationCategory
// ---------------------------------------------------------------------------------------------
export const TOOLS = {
  'basketball-savant.html': {
    name: 'Basketball Savant',
    title: 'Basketball Savant: NBA Player Percentiles, Comps & Shot Charts | WCE',
    description:
      'Basketball Savant ranks every NBA player back to 1979-80 by percentile, against the league and against his position. Shot charts, comps and on/off data. Free.',
    look: 'soft',
    heading: 'What is Basketball Savant?',
    about: [
      'Basketball Savant is a free NBA player profiler from Western Conference Elitists, built in the style of Baseball Savant. Search any player and see where he ranks, stat by stat, as a percentile from 1 to 99: against the whole league, or against the players at his position (guards, wings or bigs).',
      'It covers every season back to 1979-80. Scoring, passing, rebounding and defensive counts are shown per 75 possessions, so a sixth man and a starter read on the same scale. A profile runs through offense, defense and overall value, with shot charts, statistical comps, on/off numbers, and views of the last 10, 25 or 75 games.',
      'Percentiles are measured against the qualified players of the same season: at least 20 games and 15 minutes a game. A stat that a season never tracked is left out, not shown as zero.',
      { html: 'Every player also has a page of his own: <a href="/player">browse every NBA player on Basketball Savant</a>.' },
    ],
  },
  'football-savant.html': {
    name: 'Football Savant',
    title: 'Football Savant: NFL Player Percentiles by Position | WCE',
    description:
      'Football Savant ranks every NFL player back to 1999 by percentile against the men who play his position. Throw maps, run-gap maps, comps and leaderboards. Free.',
    look: 'hard',
    heading: 'What is Football Savant?',
    about: [
      'Football Savant is a free NFL player profiler from Western Conference Elitists. It covers every NFL player back to 1999 and ranks each one only against the men who play his position, because a cornerback and a center share no box score.',
      'Every number is a percentile from 1 to 99 against the qualified players at that position, in the same season or all-time. Profiles come with throw maps and run-gap maps, statistical comps, a career view and a leaderboard builder. A stat below its stabilization threshold is marked as a small sample, and a stat that a season never tracked is left out, not shown as zero.',
      'The numbers are built from open nflverse data, and the current season is refreshed while it is being played.',
    ],
  },
  'ufc-savant.html': {
    name: 'UFC Savant',
    title: 'UFC Savant: UFC Fighter Stats & Percentiles by Weight Class | WCE',
    description:
      'UFC Savant ranks every UFC fighter by percentile against the weight class. Strike maps, round-by-round curves, head-to-head matchups and comps. Free.',
    look: 'dark',
    heading: 'What is UFC Savant?',
    about: [
      'UFC Savant is a free UFC fighter profiler from Western Conference Elitists. It ranks every fighter against the men or women of the same weight class, stat by stat, as a percentile from 1 to 99.',
      'A fighter can be measured against active fighters or against everyone all-time, over a whole UFC career or only the last five or three fights. Profiles come with strike maps, round-by-round curves, statistical comps, head-to-head matchups and a leaderboard builder.',
      'Fight statistics come from ufcstats.com. A number below its stabilization threshold is marked as a small sample, and a stat that an era never tracked is left out, not shown as zero.',
    ],
  },
  'coaching-savant.html': {
    name: 'Coaching Savant',
    title: 'Coaching Savant: NFL Head Coach Records, Tendencies & Coaching Tree | WCE',
    description:
      'Coaching Savant covers every NFL head coach since 1999: records, playoff history, results against the spread, fourth-down decisions, play-calling and the coaching tree.',
    look: 'hard',
    heading: 'What is Coaching Savant?',
    about: [
      'Coaching Savant is a free profiler of NFL coaches from Western Conference Elitists: every head coach since 1999, and every play-caller since 2018.',
      'For each coach it shows what he won, whether his teams beat what the betting market expected of them, how he handles fourth down, and what his units actually look like on each side of the ball. Its centerpiece is a coaching tree drawn back to Paul Brown, with each coach colored by career win rate.',
      'Records and play-by-play come from open nflverse data. Who coached under whom, and who called the plays, is in no open dataset: both are curated by hand from the public record, and the page says so wherever they appear.',
    ],
  },
  'draft-savant.html': {
    name: 'Draft Savant',
    title: 'Draft Savant: NBA Draft Prospect Percentiles & Models | WCE',
    description:
      'Draft Savant measures NBA Draft prospects by percentile against their own class and past drafts, for the 2026 class and the first round of every draft back to 2010.',
    look: 'soft',
    heading: 'What is Draft Savant?',
    about: [
      'Draft Savant is a free NBA Draft prospect profiler from Western Conference Elitists. It covers the 2026 class and the first round of every draft back to 2010.',
      'Each prospect is ranked by percentile against his own draft class or against past drafts, and the comparison can be narrowed to prospects at the same position or of a similar age.',
      { html: 'For the opinionated version, see the <a href="/rankings">WCE Big Board</a>.' },
    ],
  },
}

// The same product, said in one line for structured data on the React pages that are products.
export const APPS = {
  '/dynasty': { name: 'Dynasty Exchange', category: 'SportsApplication' },
  '/comp-chain': { name: 'Comp Chain', category: 'GameApplication' },
  '/hoops': { name: 'Flappy Hoops', category: 'GameApplication' },
}

// Longer first-paint text for the React pages that are products. Everything else falls back to
// its description. Wording follows the page's own copy (src/pages/Dynasty.jsx).
export const LEDES = {
  '/dynasty': [
    'Dynasty Exchange is a dynasty basketball trade-value board priced by the crowd, not by a panel of experts. Rank four NBA players at a time: that single answer is six head-to-head results, and each one reprices both sides against what the market already believed.',
    'Browse the whole board, see who is moving, settle an argument in a room with friends, or paste your roster from any platform and see what it is worth. Opening prices come from Hashtag Basketball’s points-league dynasty ranking, and they move from the first pick onward.',
  ],
}

// ---------------------------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------------------------
const ORG = {
  '@type': 'Organization',
  '@id': `${SITE}/#org`,
  name: SITE_NAME,
  alternateName: ['WCE', 'WCE Hoops'],
  url: `${SITE}/`,
  logo: `${SITE}/wce-logo-512.png`,
  sameAs: [YOUTUBE],
}
const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  name: SITE_NAME,
  alternateName: ['WCE', 'WCE Hoops'],
  url: `${SITE}/`,
  publisher: { '@id': `${SITE}/#org` },
}
const crumbs = (name, url) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name, item: url },
  ],
})
const app = ({ name, url, description, category }) => ({
  '@type': 'WebApplication',
  '@id': `${url}#app`,
  name,
  url,
  description,
  applicationCategory: category,
  operatingSystem: 'Any',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': `${SITE}/#org` },
  isPartOf: { '@id': `${SITE}/#website` },
})

// The homepage: who we are, and the list of products by name.
export function homeJsonLd() {
  return ld({
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      WEBSITE,
      {
        '@type': 'ItemList',
        name: `${SITE_NAME} tools`,
        itemListElement: PRODUCTS.slice(0, 9).map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: SITE + p.href })),
      },
    ],
  })
}

export function toolJsonLd(file) {
  const t = TOOLS[file]
  const url = `${SITE}/${file}`
  return ld({ '@context': 'https://schema.org', '@graph': [app({ name: t.name, url, description: t.description, category: 'SportsApplication' }), ORG, WEBSITE, crumbs(t.name, url)] })
}

export function pageJsonLd(route, description) {
  const a = APPS[route]
  if (!a) return ''
  const url = SITE + route
  return ld({ '@context': 'https://schema.org', '@graph': [app({ name: a.name, url, description, category: a.category }), ORG, WEBSITE, crumbs(a.name, url)] })
}

// ---------------------------------------------------------------------------------------------
// The "What is X?" panel on a tool page. It sits under the landing screen (the search box still
// fills the first screen) and is hidden whenever the page is showing a player, a leaderboard or
// a matchup. It is styled entirely from the page's own CSS variables, so it takes each tool's
// colours and type without knowing them.
// ---------------------------------------------------------------------------------------------
export const ABOUT_MARK = '<!-- about panel: added at build by scripts/lib/seo-build.mjs -->'

const ABOUT_CSS = `
.wce-about{display:none;position:relative;z-index:2;padding:8px 20px 64px}
body.home-open .wce-about,body.view-home .wce-about{display:block}
body.lb-open .wce-about,body.mu-open .wce-about{display:none}
.wce-about-in{max-width:760px;margin:0 auto;padding:28px 30px 24px;background:var(--surface);color:var(--ink);
  border:1px solid var(--line);border-radius:12px;text-align:left}
.wce-about-k{margin:0 0 8px;font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint)}
.wce-about h2{margin:0 0 14px;font-family:var(--disp);font-size:26px;line-height:1.15;font-weight:600;color:var(--ink)}
.wce-about p{margin:0 0 12px;font-family:var(--body);font-size:15px;line-height:1.65;color:var(--muted)}
.wce-about a{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.wce-about-more{display:flex;flex-wrap:wrap;gap:8px 18px;margin:18px 0 0;padding:16px 0 0;border-top:1px solid var(--line);
  font-family:var(--mono);font-size:12px;list-style:none}
.wce-about-more li:first-child{color:var(--faint);text-transform:uppercase;letter-spacing:.12em}
.wce-about.hard .wce-about-in{border:3px solid var(--turf-dk);border-radius:0;box-shadow:var(--shadow)}
.wce-about.hard h2{font-size:19px;line-height:1.3}
.wce-about.hard .wce-about-k,.wce-about.hard .wce-about-more{font-family:var(--pix);font-size:10px}
.wce-about.dark .wce-about-in{border-radius:10px}
.wce-about.dark h2{font-size:32px;font-weight:800;text-transform:uppercase;letter-spacing:.01em}
@media (max-width:560px){.wce-about{padding:8px 14px 48px}.wce-about-in{padding:22px 18px 18px}}
`

export function toolAbout(file) {
  const t = TOOLS[file]
  const paras = t.about.map((p) => `<p>${typeof p === 'string' ? esc(p) : p.html}</p>`).join('\n    ')
  const more = PRODUCTS.filter((p) => p.href !== `/${file}`)
    .slice(0, 8)
    .map((p) => `<li><a href="${p.href}">${esc(p.name)}</a></li>`)
    .join('')
  return `${ABOUT_MARK}
<style>${ABOUT_CSS}</style>
<section class="wce-about ${t.look}" id="wce-about" aria-labelledby="wce-about-h">
  <div class="wce-about-in">
    <p class="wce-about-k">About</p>
    <h2 id="wce-about-h">${esc(t.heading)}</h2>
    ${paras}
    <ul class="wce-about-more"><li>More from WCE</li><li><a href="/">Home</a></li>${more}</ul>
  </div>
</section>
`
}

// ---------------------------------------------------------------------------------------------
// First-paint HTML for the React pages.
//
// Each of those pages used to arrive as an empty <div id="root">: a crawler that does not run
// JavaScript (most AI crawlers, link checkers, and a search engine's first pass) saw a title and
// nothing else. This is what sits in that div until React starts. React replaces it the moment
// it mounts, so a visitor on a normal connection never sees it: it is held back for a second and
// a half and only fades in if the app still has not started (a slow connection, or no JavaScript).
// ---------------------------------------------------------------------------------------------
export const FALLBACK_CSS = `<style id="wce-fb-css">
.wce-fb{max-width:760px;margin:0 auto;padding:56px 24px 72px;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#191b1f;line-height:1.6;
  opacity:0;animation:wce-fb-in .3s ease 1.5s forwards}
@keyframes wce-fb-in{to{opacity:1}}
.wce-fb-k{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#676c75}
.wce-fb-k a{color:#22395a;text-decoration:none}
.wce-fb h1{font-family:'Newsreader',Georgia,serif;font-weight:600;font-size:40px;line-height:1.08;margin:14px 0 16px}
.wce-fb h2{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#676c75;margin:36px 0 12px;font-weight:500}
.wce-fb p{font-size:16px;color:#4e535b;margin:0 0 14px}
.wce-fb a{color:#22395a}
.wce-fb ul{list-style:none;margin:0;padding:0}
.wce-fb li{margin:0 0 10px;font-size:15px;color:#4e535b}
.wce-fb li a{font-weight:600}
.wce-fb img{max-width:100%;height:auto}
</style>
<noscript><style>.wce-fb{opacity:1;animation:none}</style></noscript>`

const productList = (skip) =>
  `<ul>${PRODUCTS.filter((p) => p.href !== skip).map((p) => `<li><a href="${p.href}">${esc(p.name)}</a>: ${esc(p.blurb)}</li>`).join('')}</ul>`

/**
 * @param {object} o
 * @param {string} o.route      the page's path ('/' for the homepage)
 * @param {string} o.h1         the page's name
 * @param {string[]} o.paras    plain-text paragraphs
 * @param {string} [o.bodyHtml] trusted HTML to place after the paragraphs (an article's body)
 */
export function fallbackHtml({ route, h1, paras = [], bodyHtml = '' }) {
  const home = route === '/'
  return `<div class="wce-fb">
      <div class="wce-fb-k">${home ? 'NBA · NFL · UFC' : `<a href="/">${esc(SITE_NAME)}</a>`}</div>
      <h1>${esc(h1)}</h1>
      ${paras.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      ${bodyHtml}
      <h2>${home ? 'The tools' : 'More from Western Conference Elitists'}</h2>
      ${productList(route)}
    </div>`
}
