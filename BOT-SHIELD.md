# Bot Shield (the human gate)

## Why it exists

From 2am ET on Nov 23, 2026, a bot running a real Chrome browser on Windows opened NBA Savant
about 90–180 times an hour. It used a new home IP for every visit (US, Vietnam, Brazil, Colombia,
Venezuela, Indonesia and others), had no referrer, stayed a few seconds and left without
scrolling, clicking or searching. It followed the Nov 24 rename to `/nba-savant` overnight.

- Vercel Bot Protection (Challenge, on since Nov 23 4:31pm ET) only cut it by about a third. A
  real browser passes that challenge.
- It can't be blocked by IP (a new one each visit), country (a third of it is US) or TLS
  fingerprint (its JA4 `t13d1517h2_8daaf6152771_cb7bf5808d99` is ordinary up-to-date Chrome,
  the most common one among real visitors before it arrived).
- Each visit downloaded about 9 MB of Savant data, roughly 27 GB a day, and counted as a
  pageview, inflating the Analytics archive (Nov 22–24).

The gate doesn't try to stop the visit. It makes sure a visit gets nothing, and counts for
nothing, until a person is confirmed.

## How it works

| Piece | What it does |
|---|---|
| `public/wce-human.js` | Loads first on every Savant tool page and player page. Wraps `fetch`, so same-origin `.json` downloads wait for `wceHuman.ready`. Never touches `/api/`, `/mcp/`, `/savant-api/`, `/.well-known/`. Loads Vercel Web Analytics only once the gate opens. |
| `api/_human.js` → `/api/human` | Checks the Turnstile token with Cloudflare `siteverify`, then sets `wce_h` (HttpOnly, signed, 12 h) and `wce_hh=1` (page-readable, 12 h). Rewritten into `api/analytics/history.js?section=human`, so it costs no function slot. |
| `scripts/lib/seo-build.mjs` | Adds `<script src="/wce-human.js">` to every hand-built Savant page (in place of the old analytics snippet) and writes the public site key into `dist/wce-human.js`. |
| `scripts/lib/player-pages.mjs` | The same tag on the ~3,800 player pages. |
| `src/pages/AnalyticsArchive.jsx` | Marks Nov 22–24, 2026 as bot days and hides them from totals, "Best day" and the chart by default. |

The gate opens on the first of:
1. the `wce_hh` cookie (passed in the last 12 hours);
2. a Turnstile pass, which runs on load and is invisible to nearly everyone, so Google visitors
   and player deep links load without a click;
3. a real interaction (click, key, touch, wheel, mouse move, scroll), **only if Turnstile couldn't
   run**: no site key, its script blocked, or `/api/human` not configured or down. A visitor
   Turnstile actually failed gets the visible checkbox with "Quick check to load the stats."

While waiting, pages show their normal "Loading…" state. Nothing in the pages' own code changed.

## Settings (Vercel → Project → Environment Variables)

| Variable | Kind | Notes |
|---|---|---|
| `TURNSTILE_SITE_KEY` | public | Read at **build** time. Empty = interaction-only mode (still blocks this bot). |
| `TURNSTILE_SECRET_KEY` | secret | Read by `/api/human`. Without it the page falls back to interaction mode. |
| `WCE_HUMAN_SECRET` | secret, optional | Signs `wce_h`. Without it the key is derived from the Turnstile secret. |

The Turnstile widget lives in Cloudflare → Turnstile, hostname `wcehoops.com`, Managed mode.

## Not covered yet

- The React pages (home, articles, news, `/analytics`, Dynasty and the rest) still load Analytics
  the usual way. The bot hasn't touched them.
- A bot that downloads the JSON files directly, skipping the page, isn't stopped. If that
  happens, add Routing Middleware on the bulk data paths that requires a valid `wce_h`
  (`checkHuman` in `api/_human.js`). It must exempt `/api/`, `/mcp/`, `/.well-known/`,
  `/savant-api/` and anything the connector or nightly jobs read over HTTP.
