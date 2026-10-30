# Basketball Coaching Savant 1.0.0

Every NBA head coach, judged from the floor up, in Basketball Savant's clothes. Shipped to
wcehoops.com on October 29, 2026 from the branch `basketball-coaching-savant`, merged into `main`.

| where | what |
|---|---|
| wcehoops.com/basketball-coaching-savant.html | the page: Coaches, Leaders, the tree |
| `public/basketball-coaching-savant.html` | the page, assembled from `tools/savant-bcoaching/page-src/` (concatenate in order) |
| `public/bcs/` | its data: `index.json`, a file per coach (`c/`), per team-season (`t/`), the Data Room (`data/`), the photos (`heads.json`) |
| `pipeline/basketball/coaching/` | the pipeline; `README.md` there is the map, `BUILD-NOTES.md` the fits, the decisions and the review list in full |
| `api/_bcoaching.js` | the connector's six tools, registered in `api/mcp.js` |
| `npm run check:savant-bcoaching` | the files, the page and the connector held to each other (14 tests); `npm run check:savant` runs it with the rest |
| `tools/savant-bcoaching/shoot.py` | the visual pass (Playwright): every section at 1280 and 390 wide, hovers, picker, tree, faces |
| `bcs-bundles` branch | the Mac's saved per-season bundles, which the cloud's merge-mode refresh reads |

## What shipped

**The record.** 405 coaches since 1946-47 from Basketball-Reference, with 38,039 team-games from
1996-97 on assigned to the head coach who coached them: 107 split seasons cut where the running
record first equals the first man's, 31 acting-coach stints applied by hand, each sourced and
checked against the schedule. Every coach-season record matches Basketball-Reference.

**The floor.** 31,000 ESPN games 2002-03 on, parsed into stints, possessions, timeouts and the runs
around them, challenges, foul trouble, fouling up three, two-for-ones, end-of-period possessions,
clutch and garbage time. Five- and two-man units luck- and sample-adjusted as the Lineups tab does
it; unit minutes match the NBA's published table within two minutes.

**The judgments.** 88 stats in seven groups, each with an explainer, a pool and a settle point:
wins above two expectations (roster talent, fitted out of sample at R² 0.48; the market, from
preseason win totals and the closing line), the Rotation Map and what goes off script, who he
plays together and whether the lineups he chooses are his best, game management, offensive and
defensive identity, development against the aging curve, the arrival effect, comps by
fingerprint, mentors suggested from the record and the coaching tree. Every constant was
measured and is written to `index.json`'s `meta.fits` with its sample; the negative results
(archetype pairings, three of four lineup pairings) are recorded there too.

**The page.** Basketball Savant's player page, rule for rule: the identity card with a photo for
every coach-season (the NBA's own where it shot one, a cropped face in that season's colours
where it did not, a badge where there is no photo of him anywhere), the card rows with their
chart glyph and compare bars, two-column panels with "more" toggles, the scouting report, the
career chart, the Rotation Map on a canvas, the pair matrix, the lineup quadrant, minutes vs
impact, arrival, development, staff, his place in the tree, comps, every season. Leaders: 22
boards. The tree: a zoomable forest, 35 trees, faces that load as you zoom in.

**The connector.** Six tools on the site's MCP server (wcehoops.com/api/mcp):
`nba_search_coaches`, `nba_get_coach_profile`, `nba_coaching_leaders`, `nba_coaching_tree`,
`nba_coaching_data` (the Data Room: five tables, filters, columns, paging) and
`nba_coaching_dictionary`. Basketball Savant's own `nba_player_splits` gained `view: "rotation"`,
and every player card carries his row of his coach's Rotation Map.

**The refresh.** The season in progress refreshes in the cloud after every slate
(`refresh_live.py` inside `cloud_run.sh`, merge mode against the saved bundles, continue-on-error so
it can never block Basketball Savant). A merge-mode build of 2026-27 is byte-identical to the
full build. Full builds stay on the Mac, which holds the ESPN cache, the Basketball-Reference
cache and the NBA tables; `publish_bundles.sh` pushes its bundles for the cloud to merge into.

**Shipped on Oct 29.** The switch-rate column for 2017-18 and 2018-19 (the defensive box-score
backfill reached them overnight; 41 coach pages gained samples), republished bundles, the faces,
and two check fixes (the coverage manifest after the redesign, one tool description trimmed to
the 700-character limit). All twelve check suites pass. Vercel deployment
`dpl_FDavKjHjsS1Ljxx5yeHTewZcnsGp` (commit `83d2c498`) went READY and `wcehoops.com` was aliased to
it. On the live page, headless Chromium at 1280 and 390 wide: no errors, no horizontal overflow,
the home page's 243 faces, Spoelstra's card on the career and the 2010-11 view, Compare with
172 bars, the picker, the tree with faces, and the cards of Popovich, Phil Jackson (a
Basketball-Reference face, 1995-96) and Carlisle. Each of the six connector tools was called
once on `wcehoops.com/api/mcp` and answered in full (the profile at 19,800 characters, the
dictionary at 20,300). The Chrome extension was not connected in that session, so the live
page has still not been used by a person in a real browser.
The push to `main` queued a cloud refresh (run 40820579563) behind the watcher already running; it
ran at 05:26 UTC, its merge-mode coaching step read the republished bundles, finished with rc=0 and
no warning, and its commit `a2c8b48c` carried 903 coaching files to `main`.

## The review list

What a second pair of eyes should look at, in order of consequence. The full version with every
source is `pipeline/basketball/coaching/BUILD-NOTES.md`.

1. **Two acting-coach handovers inside a window** are reported but not pinned game by game:
   Atlanta (Prunty → Jent before Jan 9, 2022) and Memphis (Brad Jones → Rajakovic before Jan 11,
   2022). Flagged `confirmed: false` in `HC_FIXES` and listed in `HC_UNCONFIRMED`.
2. **Mentor suggestions** are computed from the record with two hand overrides (Popovich → Larry
   Brown; Phil Jackson → Doug Collins, Holzman as "also"). Ties are flagged on the page. Worth a
   pass: coaches whose only recorded stint is a late one, and the 196 head coaches shown as roots
   because no NBA assistant stint is on record.
3. **Staff tables before 2006-07 are patchy.** stats.nba.com refused some 1996–2006 roster calls;
   `nba_pulls.py 1996-97 2006-07 --phases=rosters`, then `registry.py` and `build.py`, fills
   whatever it answers.
4. **Eleven acting coaches are stubs** with no Basketball-Reference page (birth data blank).
5. **Points inside possessions run 1–6 short of the box score** in half the team-games
   (technical free throws, stray sequences). After-timeout and end-of-period points per possession
   carry that undercount equally for everyone; the ratings use the box score.
6. **The visual pass ran in headless Chromium** and its screenshots were looked at (desktop and
   phone), but the page has not yet been used in a real browser by a person.
7. **The cloud refresh's merge-mode step** should be watched through its first runs against the
   republished bundles (the Actions log says "coaching refresh" either way; a failure is a
   warning, not a stop).

## Known limits

- **What the data does not hold.** Pick-and-roll coverage, set names, inbound plays and
  defensive assignments are in no free source and are not built. Switch rate exists from
  2017-18 (the NBA's defensive box scores) and is reported with the games it covers; zone
  defense from 2025-26 only. Opponent shot quality allowed has no single stat; opponent eFG% and
  rim rate headline the defensive panel instead.
- **Eras.** Game-level judgments begin in 2002-03 (ESPN's play-by-play); the talent expectation in
  2003-04; closing lines in 2015-16; win probability in 2018-19; challenges in 2019-20. Before
  1996-97 a coach has his records, his bio and his tree, and nothing from the floor. Preseason
  win totals exist for every season but the 1998-99 lockout; 2026-27's page had none yet.
- **The season in progress** is ranked provisionally until a coach has ten games, and its photos
  are re-asked every run because media-day pictures land through October.
- **Photos.** 12% of head-coach seasons have the NBA's own photo for that season (72% from 2020
  on), 58% a cropped face from another season or Basketball-Reference, 31% a badge, almost all
  of them men who coached before 1996 and never played in the NBA.
- **Pools.** Career boards take coaches with three seasons and 150 games since 1996-97 (115 of
  them); a stat ranks only within the seasons it exists, and every surface names its pool.
- **Mentors** are one parent per coach, the head coach he served under most before his first
  head job; the others he served under are on his page.
- **Operations.** The full build, the Basketball-Reference crawl and the NBA pulls run only on
  the Mac. The defensive box-score backfill is a one-shot launchd job; `launchctl submit` keeps a
  job alive, so it must be removed once its log says finished or it re-pushes the same seeds
  every few minutes. Headless Chromium cannot fetch cdn.nba.com (HTTP/2 refused), so the visual
  pass relays the photos through Python.
