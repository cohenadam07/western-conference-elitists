# Western Conference Elitists

Premium NBA media site — draft scouting, prospect rankings, and league-wide analysis. Built with React, React Router, and Tailwind CSS v4.

## Run it

```bash
cd website
npm install
npm run dev
```

Open the printed `localhost` URL. For a production build:

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

Requires Node 18+.

## File structure

```
website/
  index.html              # document shell, fonts, meta tags
  src/
    main.jsx              # React root + BrowserRouter
    App.jsx                # layout shell + route table
    index.css              # Tailwind import + design tokens (@theme) + global styles
    data/
      content.js           # ALL site copy: prospects, articles, news items, newsletter, founder, socials
    components/
      Logo.jsx
      Button.jsx           # primary/secondary/ghost button variants
      Navbar.jsx            # sticky nav + mobile menu
      Footer.jsx
      SectionHeading.jsx    # eyebrow + title + subtitle pattern used on every section
      ArticleCard.jsx       # featured + standard variants
      ProspectCard.jsx
      NewsletterCTA.jsx
      ScrollToTop.jsx       # resets scroll on route change
    pages/
      Home.jsx
      News.jsx              # short-form wire/headlines feed, distinct from long-form Analysis
      Podcasts.jsx          # episode archive with category filter
      About.jsx
      Draft.jsx             # draft hub + featured prospect + filterable pool
      Rankings.jsx          # big board, expandable rows
      Articles.jsx          # search + category filter
      ArticleDetail.jsx     # /articles/:slug
      Contact.jsx
      NotFound.jsx
```

## Customizing content

Almost everything you'll want to change on day one lives in **`src/data/content.js`**:

- `PROSPECTS` — array of prospect objects (rank, name, school, measurements, strengths/weaknesses, projection, comp). The Draft, Rankings, and Home pages all read from this array, so editing it updates the whole site. `SPOTLIGHT_PROSPECT` controls the "Draft Spotlight" / "Featured Prospect" sections and is just `PROSPECTS[0]` — reorder the array or change the export to feature someone else.
- `ARTICLES` — array of article objects (slug, title, category, excerpt, date, readTime). `FEATURED_ARTICLE` is `ARTICLES[0]`. Add a new article by adding an object here; it automatically shows up in `/articles`, category filters, and search. Article detail pages route by `slug` — `ArticleDetail.jsx` currently renders shared placeholder body paragraphs for every slug, so when you have real long-form copy, give each article a `body: [...]` array of paragraphs and swap the placeholder `BODY` constant for `article.body`.
- `NEWS_ITEMS` — array of short wire-style items (headline, category, timestamp, blurb) for the `/news` page. This is the fast-hit feed; `ARTICLES` is the long-form one. Add an item and it shows up immediately, filterable by category.
- `CATEGORIES` — the tag list used for filter pills on `/articles`, `/news`, and the footer. Add/remove categories here and the filters update automatically.
- `NEWSLETTER_COPY`, `FOUNDER`, `SOCIALS` — newsletter section copy, About page founder card, and footer/contact social links (currently `href: '#'` placeholders — point these at real profiles).

### The Savant tools

Four single-file tools live in `public/` and are served as static pages, outside the React
app: `basketball-savant.html`, `draft-savant.html`, `football-savant.html`, and
`coaching-savant.html`.

**Football Savant** (`public/football-savant.html`) is the NFL successor to Basketball
Savant. Same argument — every number is a percentile against a qualified population, every
row is labelled with what kind of number it is, a bar below its stabilization threshold is
hatched, and a metric its era never tracked is absent rather than zero — but position-scoped,
because a cornerback and a center share no box score. It has its own palette and art
direction (slate ground, chalk rules, a gridiron rather than a half-court) so it reads as a
sibling rather than a re-skin.

**Coaching Savant** (`public/coaching-savant.html`) is its companion: all 173 men who have
held an NFL head-coaching job since 1999 — records, playoff history, whether their teams beat
what the betting market expected of them, what they actually called, and whose staff they
learned it on. Its flagship is a coaching tree drawn back to Paul Brown, with each coach
coloured by career win rate. The lineage is hand-curated in `pipeline/football/coach_tree.py`
because no open dataset records who assisted whom, and the page says so wherever it appears.

Its data is built by `pipeline/football/` from open [nflverse](https://github.com/nflverse/nflverse-data)
releases and lands in `public/football-savant-data.json` and `public/football-maps/`. See
`pipeline/football/README.md` for how to rebuild it, and `FOOTBALL-SAVANT-RESEARCH.md` for
the metric research behind it — what football can measure, what stabilizes at NFL sample
sizes, and what is licensed and therefore missing.

### Showing up in search

Each Savant tool's title, its "What is X?" panel, the structured data and the text every page
arrives with before JavaScript runs are added at build time. `SEARCH.md` says what is done and
why; the words are in `scripts/lib/seo-content.mjs`; `npm run check:seo` checks them.

### The Savant API files

Every Savant page works its rankings out in the browser from a large data file, which no AI
assistant or script can use. So every build also writes the same numbers down as small files
under `/savant-api/<section>/v1/`, with every percentile already worked out:

| Section | Slicer (`scripts/lib/`) | What it writes | Check (`tools/`) |
|---|---|---|---|
| `basketball` | `savant-api.mjs` | glossary, player index, one file per season (with each player's honours, play types and with/without split) | `savant-api/` |
| `football` | `savant-api-football.mjs` | glossary, player index, one file per season (with its All-Savant Team and 32 team pages), careers by position | `savant-football/` |
| `ufc` | `savant-api-ufc.mjs` | glossary, fighter index, upcoming cards, fighters in 16 files (four pools per stat, full fight logs) | `savant-ufc/` |
| `coaching` | `savant-api-coaching.mjs` | glossary, coach index, profiles, play-calling units per season, the Leaders boards, the coaching tree | `savant-coaching/` |
| `draft` | `savant-api-draft.mjs` | glossary, prospect index, one file per draft class | `savant-draft/` |
| `site` | `savant-api-site.mjs` | the News list, published articles, the Big Board, Dynasty names, the What's new lines | `savant-site/` |

They are built by one Vite plugin (`scripts/lib/savant-api.mjs`, like the SEO and gzip steps)
from the data files in `public/` and the rules inside each page, so they refresh with every
data push and nothing is committed. They add about 32 MB to a deployment. The bulk files are
written gzipped; `vercel.json` rewrites `<name>.json` to `<name>.json.gz` for each pattern.

**The numbers must match the page.** Each slicer reads its page's rules rather than copying
them, and each check runs the page's own code against the real data and compares every
value. After any change to how a page ranks things, or to the shape of its data, run:

```bash
npm run check:savant            # all of them, a few minutes
npm run check:savant-football   # or one section
```

If a check fails, fix the slicer; do not relax the check. If a page changes shape and its
slicer can no longer read it, the build carries on without that section and says so in the
build log.

### The AI connector (MCP)

`https://wcehoops.com/api/mcp` is an MCP server: add that URL to an AI assistant and it can
look things up on the site mid-conversation and link back to the page. In Claude it goes
under **Customize > Connectors > Add custom connector**, with "No sign in". It is public and
read-only: nothing in it can vote, write or change anything.

| Tools | Section | What they return |
|---|---|---|
| `nba_search_players`, `nba_get_player_profile` | Basketball Savant | Every stat with its league and position percentile, 1979-80 on; last 10 / 25 / 75 games for the latest season; league honours |
| `nba_leaderboard` | Basketball Savant | The Leaderboard Builder: the top players by any stat, with its filters, ranked against the filtered group or the league |
| `nba_all_savant_team` | Basketball Savant | The All-Savant 1st and 2nd teams for any season |
| `nba_player_career`, `nba_player_splits` | Basketball Savant | A career arc (Box Plus/Minus against his position, peak, honours, any stat season by season); play types, with and without teammates, month by month, shot chart attempts |
| `nba_team_rankings`, `nba_team_profile`, `nba_lineups` | Basketball Savant | The Teams table and depth charts; a team's ratings with luck and sample adjustments; 5-man units |
| `nba_fantasy_rankings`, `nba_fantasy_player`, `nba_fantasy_trade`, `nba_fantasy_streamers`, `nba_fantasy_lock_in`, `nba_injury_report`, `nba_schedule` | Basketball Savant Fantasy | Projections (rest of season, next 7 days, dynasty), points and 9-cat rankings, trades, streamers, Sleeper Lock-In plans, injuries, games per team |
| `nfl_search_players`, `nfl_get_player_profile` | Football Savant | Every stat on a player's card, ranked against his position, in-season and all-time, or against the same point of past seasons; All-Savant honours |
| `nfl_leaderboard` | Football Savant | The Leaderboard Builder: a position or all 32 teams, for a season, whole careers, or the last 4, 8 or 17 games |
| `nfl_all_savant_team` | Football Savant | The All-Savant 1st and 2nd teams for any season since 1999 |
| `nfl_player_career`, `nfl_player_games`, `nfl_player_splits` | Football Savant | Careers ranked among careers, game logs, situational splits, throw / target / rush maps and route trees |
| `nfl_team_profile`, `nfl_game` | Football Savant | Team pages (unit ranks, line grade, roster in depth-chart order); every postseason game page since 1999 |
| `nfl_search_coaches`, `nfl_get_coach_profile`, `nfl_coaching_leaders`, `nfl_coaching_tree` | Coaching Savant | Records, wins against the spread, career ranks, fourth downs, play-calling units with route mix and tells, lineage; the Leaders boards; the coaching tree |
| `ufc_search_fighters`, `ufc_get_fighter_profile`, `ufc_leaderboard`, `ufc_matchup`, `ufc_get_upcoming_cards` | UFC Savant | Records, every stat ranked inside the division or against every division of that sex (active and all-time), comps, strike map, round curve, the whole fight log, title reigns; the leaderboard; the head-to-head with its rating-implied win probability |
| `nba_draft_search_prospects`, `nba_draft_get_prospect_profile` | Draft Savant | Pre-draft production and measurements, ranked against a named pool; a draft class as the page's board lists it |
| `wce_get_news`, `wce_search_articles`, `wce_get_article`, `wce_get_big_board`, `wce_get_dynasty_rankings`, `wce_get_trending`, `wce_whats_new`, `nba_fantasy_league` | The site | The News list, WCE's articles, the Big Board, the live Dynasty board, the most-searched players and prospects, the homepage's What's new lines, a fan's league valued on the Dynasty board |

`api/mcp.js` speaks the protocol (the official SDK, stateless, one function) and knows no
sport. Each section is a module that declares its own tools: `api/_basketball.js` and
`_basketball-lists.js`, `_fantasy.js`, `_football.js`, `_football-lists.js` and
`_football-games.js`, `_coaching.js`, `_ufc.js`, `_draft.js`, `_site.js`. Shared loading,
caching and name matching live in `api/_core.js`. Sections read the Savant API files above,
and some of the pages' own public files (game logs, splits, maps, months, shots), off the
live site, so a data push reaches the connector with no redeploy. Percentiles come worked
out in those files; a tool works one out itself only where the page does it in the browser
(a leaderboard's filtered group, a game's level against the season), and then only with a
check that runs the page's own code and finds the same number. Three tools read live,
from the site's own read-only endpoints and with a GET only: the Dynasty board
(`/api/dynasty?action=board`), the trending lists (`/api/trending`) and a fan's league
(`/api/league`, the site's proxy to Sleeper, ESPN and Fantrax).

An answer always names the pool a percentile is from ("vs. guards", "vs. quarterbacks"),
flags low samples, lists a stat its season did not track rather than showing a zero, and
states the date of its data. A name that fits several people returns their ids instead of a
guess, and a misspelled name is never opened on its own.

```bash
npm run check:savant-mcp
```

That talks to the endpoint with a real MCP client and calls every tool of every section.
To point a local run at other data, set `SAVANT_API_ORIGIN`. Each section's numbers are held
to its page by that section's own checks (`tools/savant-*/check.mjs`, and `more.mjs` beside
basketball's and football's for the leaderboards, careers, team pages, game logs and splits).
The football ones need a big heap: `NODE_OPTIONS=--max-old-space-size=5500`.

**Keeping it complete.** The connector is meant to reach everything a fan can open on the
site. `npm run check:connector-coverage` (`tools/savant-mcp/coverage.mjs`) finds the site's
features from source on every run (each `render…` / `open…` / `show…` function in a static
page or its scripts, every data file and folder in `public/`, every route in `src/App.jsx`,
every endpoint in `api/`) and holds each one to `tools/savant-mcp/coverage.json`, which names
the tools that answer it or says, in a sentence, why it is left out (private pages, the
games, YouTube, the newsletter and weekly movers, images). It fails when the site has
something the manifest does not mention, when the manifest names something the site no
longer has, or when it names a tool the connector does not declare. A page's ranking
switches that no tool offers are listed under `switches`, each with its reason.

The workflow `.github/workflows/connector-coverage.yml` runs it on every push to main that
touches the pages, data, routes or endpoints, and on Sundays, and keeps an issue labelled
`connector-coverage` open while something is missing. A scheduled Claude task ("WCE
connector weekly update", Mondays) runs the same check, builds the missing tools with
checks that hold their numbers to the page, and opens a pull request on a
`connector-coverage/<date>` branch. It never merges: Adam approves each one.

To add a tool by hand: declare it in the section's module (a zod `inputSchema` and
`outputSchema`, the `READ_ONLY` annotations, a text answer plus structured content, the pool
of every percentile named, low samples flagged, the date of the data, a link to the page),
register a new module in `SECTIONS` in `api/mcp.js`, call it in the "every tool" test of
`tools/savant-mcp/check.mjs`, hold its numbers to the page in the section's check (break the
check once on purpose to see it fail), and point its feature at it in `coverage.json`.

**Limits.** Each caller gets 300 requests a minute, counted by network address
(`api/_limit.js`); past that a request is answered at once with HTTP 429 and "wait N
seconds", before any tool runs. The number is generous on purpose: everyone who uses the
connector through Claude arrives from Claude's servers, so one address can be many fans. Set
`MCP_RATE_PER_MINUTE` on Vercel to change it. A request body over 64 KB is refused unread.

That brake lives inside the function, so a refused request still counts as a function
invocation, and each running copy of the function keeps its own count. The wall, if one is
ever needed, is a rule in Vercel's Firewall, which stops requests before they reach the
function. The Hobby plan includes one rate-limit rule per project. To add it: the project
on vercel.com > **Firewall** > **Configure** > **+ New Rule**; If *Request Path* equals
`/api/mcp`; Then **Rate Limit**, Fixed Window, 60 seconds, 300 requests, key **IP**;
**Save Rule**, **Review Changes**, **Publish**.

**Usage log.** The connector keeps a tally of its own use (`api/_usage.js`): lookups per
tool per day, how many could not be answered, which family of AI app connected (Claude,
ChatGPT, and so on), how often the limit came on, and calls per key per day for callers
with a key (below). Never what was asked, and never who asked unless they chose a key. The
private `/analytics` page shows it under "The AI connector".

It lives in the site's data store, one hash a month, kept 400 days. Each write is one
command, and after 5,000 writes in a day the log stops counting until the next day (UTC),
so a flood cannot spend the store's monthly allowance; the page marks a capped day. Set
`MCP_USAGE_DAILY_CAP` on Vercel to change the ceiling. If the store is slow or down the
answer goes out anyway: a write waits 700 ms at most. The tests run against a real,
throwaway `redis-server` (`tools/savant-mcp/redis.mjs`) and are skipped where one is not
installed.

**Keys.** Fans can get a free key on the homepage (`api/_keys.js`). A key is an address of
their own, `https://wcehoops.com/mcp/<key>`, which `vercel.json` rewrites to
`/api/mcp?key=<key>`: same connector, same answers. A key gets its own rate-limit bucket,
has its calls counted per day (as `k:<id>` in the same usage-log write, so it costs nothing
extra), and makes its holder a founding member: the promise is `FOUNDING` in
`src/data/connector.js`, said in those words on the homepage, in the key email and in the
connector's instructions. The public address works for everyone, forever, and a key that
is wrong, or cannot be checked because the store is down, is served exactly like it.

The sign-up is `POST /api/newsletter?action=key` (inside the newsletter function: the site
is at 11 of the Hobby plan's 12 functions), with an optional newsletter tick-box that goes
through Buttondown's double opt-in. The key is emailed with Resend; only its SHA-256 is
stored. To turn the email on: verify `wcehoops.com` under **Domains** in Resend (it gives
a few DNS records to add), then set `KEYS_MAIL_FROM` on Vercel, e.g.
`Western Conference Elitists <keys@wcehoops.com>`, plus `RESEND_API_KEY` from Resend >
**API Keys** (the same key the contact form's email copies use; `KEYS_MAIL_REPLY_TO` is
optional). The domain's DNS is at Porkbun, so the records go there. Until then keys are made and held, and
`/inbox` > Newsletter > **Email the keys** sends them once mail works. `/analytics` shows
key holders as people (one email, however many keys), with "active in the last 30 days"
measured against the monetization plan's Phase 2 trigger of 200.

The homepage introduces the connector in its own section (`src/components/AiConnector.jsx`,
linked as `/#ai`, from the hero and the footer). What that section claims lives in one file,
`src/data/connector.js`: the address, the founding-member promise, the worked example and
the three questions to try.
The worked example is a real answer for a finished season, and the check above calls the
connector and fails if any number in it, or any of the three questions, stops being true.
The steps for adding it follow Claude's own help page, which the section links to; if
Claude renames a menu, the wording to change is step 02 in `AiConnector.jsx`.

### Visual identity

Colors, fonts, and a few reusable effects are defined as design tokens in **`src/index.css`** under `@theme`. Change a hex value there (e.g. `--color-ember`) and it updates everywhere that uses `text-ember`, `bg-ember`, etc. — token names describe their *original* role, not necessarily their current hue (e.g. `--color-ember` is the primary navy brand accent, not orange; `--color-ink`/`--color-bone` are the light page background and dark body text, "ink on paper"). Headlines use Source Serif 4 (`text-display`) for an editorial, newspaper-style feel, body copy uses Inter, and stat/timestamp figures use JetBrains Mono (`font-mono-tight`) — all loaded via Google Fonts in `index.html`. The semantic accents are: `ember` (navy, primary brand/links/buttons), `court` (gold, secondary highlights/B-tier grades), `arena` (forest green, positive/strengths), `foul` (crimson, negative/weaknesses/breaking-news ticker).

### Adding a page

Create a new file in `src/pages/`, add a `<Route>` for it in `App.jsx`, and add a link in `Navbar.jsx`'s `LINKS` array (and `Footer.jsx` if it should appear there too).

### Forms

The newsletter and contact forms are currently client-side only (they just flip to a "submitted" state). Wire them to a real provider by replacing the `handleSubmit` functions in `NewsletterCTA.jsx` and `Contact.jsx` with calls to your email/CRM API of choice (Mailchimp, ConvertKit, Resend, a serverless function, etc).
