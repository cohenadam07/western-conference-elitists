# Player pages

Every player on Basketball Savant has his own page: `wcehoops.com/player/<name>`, for example
`/player/nikola-jokic`. There are about 3,800 of them, plus a directory at `/player`.

## Why they exist

Basketball Savant is one file that builds each profile in the reader's browser. To Google it was
a single URL with no players on it, and every link anyone shared previewed as the same generic
card. A player page is plain HTML written at build time, so:

1. **Search engines can read it.** Name, team, stat line, every percentile, comps and a
   season-by-season table are in the page itself. All of them are in `sitemap.xml`.
2. **Links preview properly.** Each page has its own title and its own preview image (name, stat
   line, six percentile bars), drawn by `api/og.js`.
3. **It loads fast.** A page is about 8 KB. The full tool downloads about 10 MB before it shows
   anything, which is a long wait for someone tapping a link on a phone.

The page is a front door, not a replacement: its main button opens the same player and season in
the interactive tool.

## What a page shows

- **Which season:** a current player's latest season; a retired player's best season (by Box
  Plus/Minus, the same rule as the tool's PEAK ribbon). Every season is in the table at the bottom,
  and each one opens in the tool.
- **Percentiles:** the bar is his rank against all qualified players that season ("vs league",
  the tool's default view). The number beside it is his rank against qualified players at his
  position. Hatched bars are small samples.
- **Early in a new season**, before enough players have cleared the games qualifier, pages stay
  on last season and say so, with the new season's stat line so far.

## What changed in the tool itself

The build adds one small script to `basketball-savant.html` (it does not edit the file in
`public/`, so regenerating the page from the Basketball-Savant project doesn't lose it):

- The address bar now follows the player and season on screen
  (`/basketball-savant.html?p=203999&s=2025-26`), so a copied URL opens the same profile.
- **Share** sends the card image plus the player's page link.
- A link button next to Share copies the player's page link.

## How it's built

| File | Job |
|---|---|
| `scripts/lib/savant-core.mjs` | The tool's percentile maths, without a browser. Reads the stat list and award codes out of `basketball-savant.html`, so a stat added to the tool appears on the pages by itself. |
| `scripts/lib/player-pages.mjs` | Writes the pages, the directory, and the script for the tool. Runs inside `npm run build` (called from `seo-build.mjs`). |
| `scripts/lib/player-pages.css`, `player-pages.client.js` | The pages' shared stylesheet and script (`/player/p.css`, `/player/p.js`). |
| `scripts/lib/player-links.client.js` | The script added to the tool. |
| `api/og.js`, `api/_og-fonts.js` | The preview image. It reads the numbers from the player's own page, never from the URL. |
| `tools/players/check.mjs` | `npm run check:players`. |

`scripts/lib/savant-api.mjs` (the files behind the AI connector) mirrors the same percentile
maths separately. Both are checked against the tool, so they agree today; folding them into one
module is worth doing once neither is changing week to week.

Nothing to run by hand. Pages rebuild on every deploy from `public/savant-data.json`, so they
follow the nightly data refresh.

## Checking it

```bash
npm run check:players
```

The first test runs the tool's own percentile code against `savant-core.mjs` on 600 real
player-seasons and fails on any difference. Run it after changing how the tool ranks players. It
also checks that every page renders, that the tool's script still finds the functions it hooks,
and that the average page stays under its size budget.

After a deploy, three things are worth looking at with your own eyes:

1. `wcehoops.com/player/nikola-jokic` loads, and its button opens Jokic in the tool.
2. `wcehoops.com/api/og?p=nikola-jokic` shows the preview card.
3. Paste a player link into iMessage or an X draft and check the preview.

## Things to know

- **Storage.** The pages add about 32 MB to each deployment (roughly a quarter more than before). Vercel
  keeps dozens of old deployments, so that is roughly 1.3 GB of the Hobby plan's storage. The
  markup is deliberately terse for this reason; see the note at the top of `player-pages.mjs`.
- **Functions.** `api/og.js` is the 11th serverless function (the AI connector at `api/mcp.js` is
  the 10th). The Hobby cap is 12, so one slot is left.
- **If the build can't make the pages** (for example the tool's config block changes shape), the
  site still deploys, without player pages, and the build log says `PLAYER PAGES SKIPPED` with
  the reason. One malformed row in the data costs only that player's page, and the log names
  him. `npm run check:players` reproduces either.
- **Namesakes.** The player who debuted first keeps the plain address (`/player/glen-rice`); later
  ones carry their debut year (`/player/glen-rice-2013`).
- **Split careers.** Nine careers that cross 1996-97 are stored under two ids in the data (a
  Basketball-Reference id before, an NBA id after), so each has two profiles in the tool and two
  pages here: Patrick Ewing, Glen Rice, Larry Johnson, Dee Brown, Reggie Williams, Eddie Johnson,
  Charles Jones, Michael Smith and Mark Davis. The two pages link to each other. Fixing it
  properly means merging the ids in the data pipeline; when that happens the links disappear on
  their own.
- **BPM units.** The tool prints Box Plus/Minus with a percent sign ("+14.2%"). The pages print
  "+14.2", since BPM is points per 100 possessions.
