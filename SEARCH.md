# Showing up in search for our product names

The goal: when someone searches "basketball savant", "football savant", "ufc savant" or
"dynasty exchange", wcehoops.com is a result. This file says what the site does about that,
where the words live, and what is left to people.

## What the site does

Everything below is added when the site is built (`scripts/lib/seo-build.mjs`). Nothing in
`public/` is edited, so the data pipelines that rewrite those pages cannot undo it.

1. **Titles that say what the tool is.** A tool's own title was its name and nothing else
   ("Football Savant — WCE"). The built page says
   "Football Savant: NFL Player Percentiles by Position | WCE". The name still comes first.
2. **A "What is X?" panel on each Savant tool.** Three or four sentences under the landing
   screen: what the tool is, what it covers, how its numbers are measured, and links to the
   other tools. The search box still fills the first screen; the panel is below it, and it is
   hidden whenever a player, a leaderboard or a matchup is open.
3. **Structured data.** Each tool tells search engines its name, that it is a free web
   application, and that Western Conference Elitists publishes it. The homepage lists every
   product by name and links the site to the YouTube channel.
4. **Real text on every page before JavaScript runs.** The React pages (the homepage,
   `/dynasty`, `/rankings` and the rest) used to arrive as an empty page that the app then
   filled in. Now each arrives with its name, a description and a link to every product.
   React replaces that text when it starts. It is held back for a second and a half, so a
   visitor only sees it if the app is slow to start.
5. **The homepage has its own HTML.** `dist/index.html` used to double as the page served for
   every unknown URL, so it could not carry anything true only of the homepage. The bare shell
   is now `dist/spa.html`, and `vercel.json` sends unknown URLs there.
6. **Short addresses.** `/basketball-savant`, `/football-savant`, `/ufc-savant`,
   `/coaching-savant` and `/draft-savant` redirect to the `.html` pages, so a link someone
   types from memory lands.
7. **The footer links to YouTube**, and the three social links that led nowhere are gone
   until there are accounts to point them at (`SOCIALS` in `src/data/content.js`).

The player pages (`PLAYER-PAGES.md`) are the other half: most searches are for a player, not
for the tool.

## Where the words are

`scripts/lib/seo-content.mjs` holds every title, description and panel. **Each sentence there
is a claim about a tool.** They were checked against the pages and the `/savant-api` meta
files when they were written. If a tool changes what it covers or how it ranks, change the
sentence. They avoid counts that go stale ("every season back to 1979-80", not "47 seasons").

`/dynasty` has its title and description in two places, because the page sets them again once
it runs: `PAGES` in `seo-build.mjs` and `usePageMeta(...)` in `src/pages/Dynasty.jsx`. The
check below fails if they differ.

## Checking it

```bash
npm run check:seo
```

It runs the real build step on the real pages and checks that every title, panel, piece of
structured data and redirect is present and well-formed, that the panel sits where it should
in each tool, and that the catch-all in `vercel.json` still points at `spa.html`. It cannot
tell whether a sentence is still true.

After a deploy, worth a look with your own eyes:

1. `wcehoops.com/basketball-savant.html`: scroll past the search box; the panel is there.
   Open a player; it is gone.
2. `wcehoops.com/some-page-that-does-not-exist` shows Not Found, not the homepage.
3. `wcehoops.com/football-savant` lands on Football Savant.

## Google Search Console

The site is a property in Search Console under the Western Conference Elitists Google
account. Google proves ownership by fetching `public/googleebfe50e0e1134140.html`. **Do not
delete that file**: the site becomes unverified if it disappears. `npm run check:seo` fails if
it does.

Search Console is where to look for which searches the site appears for, and where to ask
Google to index a new page (URL inspection, then Request indexing).

## What code cannot do

Links from other sites decide most of this. A new site with good pages and no links ranks
below an older site with worse pages and many. The work that moves the names:

- Every YouTube description links the tool it uses, by name.
- Posts where the audience already is (r/nba, r/fantasyfootball, r/MMA, X) that show one
  finding and link the player's page or the tool.
- Getting listed where people look for tools: stat-site roundups, newsletters, the nflverse
  community.

What we are up against, as of October 2026: "basketball savant" is held by a film-breakdown
YouTube channel and a hat brand, not a stats tool; "football savant" has nflsavant.com;
"ufc savant" has ufcsavant.com on the exact-match domain; "dynasty exchange" has no one.
