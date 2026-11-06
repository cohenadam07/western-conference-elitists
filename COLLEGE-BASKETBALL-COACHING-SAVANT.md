# College Basketball Coaching Savant 1.0.0

Every men's Division I head coach, judged from the floor up, paired with College Basketball Savant and built in
Basketball Coaching Savant's clothes. Built Nov 5–6, 2026 in one run on branch `college-basketball-coaching-savant`
(worktree `.claude/worktrees/cbcs`, from `origin/main` at `dd5da2e92`). **Pushed, not merged** (Nov 6, at Adam's request: the branch and `cbcs-bundles`). Adam reviews
and merges, and the connector changes need his approval first (standing rule).

| where | what |
|---|---|
| `public/college-basketball-coaching-savant.html` | the page, assembled by `tools/savant-cbcoaching/assemble.py` from Basketball Coaching Savant's page sources plus `07-college.js` |
| `public/cbcs/` | its data, every file gzipped (`.json.gz`), served as `.json` by a new `vercel.json` rule (College Savant's) |
| `pipeline/college/coaching/` | the pipeline; `README.md` there is the map |
| `api/_cbcoaching.js` | seven `cbb_` tools, registered in `api/mcp.js` |
| `npm run check:savant-cbcoaching` | the new check, 15 tests; also inside `check:savant` |
| `~/Basketball-Savant/out/cbcs/` | the Mac's caches, intermediate tables and season bundles; logs in `~/Basketball-Savant/logs/cbcs-*.log` |

## What shipped

**The record and the registry.** 4,281 head coaches and 30,463 team-seasons, back as far as Wikipedia's program
histories go. One head coach per team-game from three sources, each row keeping its URL: Wikipedia's team-season
infobox (head coach, interim tag, record, assistants), the program's season list, and ESPN's season coaches (coach
id, birthdate, record; teams mapped from 2013-14). Split seasons are cut where the running record first equals the
first coach's (Basketball Coaching Savant's rule). A coach biography's head stint fills a team-season nothing else
covers, unconfirmed. 43 duplicate ids (a season row with no linked article, such as John Calipari's UMass years) were
merged into the linked coach only where his own biography lists the stint, so namesakes stay apart.

**Every game, re-read for the coach** (`games.py`, 2013-14 on): College Savant's `rebuild.py` unchanged (same lineups,
possessions, garbage time), plus team vs media timeouts, the caller of each after-timeout possession, coach's
challenges, fouls with the clock, live-ball turnovers.

**The modules.** 99 stats in ten groups, each with an explainer, a pool, a settle point and its first season:
results against the roster model (the headline), AP context and the market; the Rotation Map on a 40-minute clock with
halftime marked and off-script causes; lineups judged from their parts (unvalidated, below); game management; offensive
and defensive identity; development; roster building and the portal; the NCAA Tournament against the seed and the odds;
resources (EADA); situation-by-situation splits. Fingerprints and comps, the arrival effect with a returning-players
view, mentors and the tree, a "rising assistants" board (context, not credit), Leaders boards (21), and a scouting
report written by rule, the current season first.

**The page.** Basketball Coaching Savant's page, rule for rule, in the spec's order: career ribbon, verdict strip
(win % bars, the roster model's expected win % as a tick, the preseason AP rank as a dot), the card, the Rotation Map,
pairs, the lineup quadrant, minutes against Savant rate, game management, development dumbbells, roster building by
source, March against the seed and the odds, the resources scatter, splits, shot diet, comps and fingerprint, before and
after, staff and tree, similar players, every season (with every record row and its source), the scouting report. It
opens on the current season. Every coach name links to his page, every player to his College Savant card.
No coach photos: badges in school colours.

**College Basketball Savant 1.4.0** (two edits to the published page): each team page names the season's head coach
(linked), and each player card lists the coaches whose systems used players most like him, labelled as similarity.

**The connector:** `cbb_search_coaches`, `cbb_get_coach_profile` (groups career, rotation, game_management, identity,
development, roster_building, tournament, resources, context, staff, seasons), `cbb_coaching_leaders`,
`cbb_coaching_tree`, `cbb_coaching_fit` (player or coach or both), `cbb_coaching_data` (games, stints, units, rotation,
decisions, roster_moves, programs), `cbb_coaching_dictionary`.

**Entry points and versions:** the Basketball group of the site ribbon (`wce-nav.js`), a home card (`Gateway.jsx`), the
home ticker (`Home.jsx`), SEO title, description and "What is" panel (`seo-content.mjs`, `seo-build.mjs`, sitemap), a
`/college-basketball-coaching-savant` redirect, What's New (`updates.json`: this 1.0.0 and College Savant 1.4.0),
College Savant's `config.VERSION` to 1.4.0, the coverage manifest.

**The refresh:** `cloud_cbcs.py refresh` rides College Savant's nightly cloud run (`cloud_run.sh`: seeded from a new
`cbcs-bundles` branch, run after College Savant's refresh, a failure is a warning and never blocks College Savant; it
builds beside `public/` and swaps in only on success). EADA is yearly and CBBD is not called by the refresh at all.
**`cbcs-bundles` is pushed** (`2895fa7ee`, a parentless commit built from `~/Basketball-Savant/out/cbcs-bundle`, 92 MB,
scanned for CBBD fields). The coaching step lives in this branch's `cloud_run.sh`, so the cloud starts refreshing
the page once the branch is merged. To republish after a Mac rebuild: `python3 cloud_cbcs.py bundle <dir>`, commit it
there, then `git fetch <dir> HEAD && git push -f origin FETCH_HEAD:refs/heads/cbcs-bundles` (the `cbb-bundles` way).

## Every check and its result

| step | check | result |
|---|---|---|
| 1 registry | one head coach per team-game | **pass**: no team-game has two; 98.4–99.7% of stats-era team-games have one (2013-14 on), 85–92% before 2012-13 |
| 1 | records reconcile with games (stats era, 4,809 coach-seasons) | **pass**: 97.3% exact, 99.67% within one game; 44 vacated records told apart |
| 1 | every hand row sourced | **pass**: every row carries its URL |
| 2 events | event types against raw play text | done: timeouts 579/578 (team) vs 580 (TV); challenges 215/216; turnovers one type, 598 (601 merged fouls and turnovers through 2012-13) |
| 2 | team minutes = 200 + 25 per OT | **pass**: 99.97% (2025-26), 99.88% (2024-25), 99.97% (2023-24) of lineup games; the check holds ≥ 99.5% |
| 2 | substitution completeness by season | measured: 0 substitutions a game before 2024-25, 33.7 in 2024-25, 132.6 in 2025-26 |
| 3 rosters | every player-season has a source label | **pass**: 75,897 labelled, 0 unlabelled |
| 3 | transfers against CBBD's portal | **pass**: 97.9–99.9% of the portal's D1-to-D1 moves on the site are inferred transfers, origin agreeing 98.3–99.4%; the other way 53–73% (the portal's coverage) |
| 4 roster model | beats both naive baselines out of sample | **pass, narrowly on AP**: team net RMSE 6.27 vs 7.04 (last season's net, 4,588 team-seasons); 5.81 vs 5.87 (preseason AP rank, 301 ranked teams). Third version; see below |
| 5 development | residuals sum to about zero | **pass**: weighted mean residual 0.000 overall and in every season pair (after a season-pair step) |
| 6 tournament | seeds match the official bracket every year | **pass**: zero mismatches, 23 tournaments 2002-03 to 2025-26; field sizes and champions match Wikipedia |
| 7 EADA | every D1 program matched; years aligned | **pass**: all 371 programs; Army, Navy and Air Force file no EADA report; year label = season (checked on seven D1 entrants) |
| 8 rotation etc. | the NBA build's checks | **pass** in the new check: windows at 60%+, shares 0..100, units and stints |
| 8 | timeouts and challenges within each season's rules | **pass**: in games where ESPN logged TV timeouts, no more than 6 + 1 per OT per team in all but 16 of 9,048 team-games (2013-14), 5 a season after, none from 2021-22; challenges only from 2025-26, at most two a game; a second after a failed first in 11 of 158 pairs (feed noise, below) |
| 9 fit | the out-of-sample test decides the label | **"similar players under him"**: 2,823 transfers, RMSE 3.563 with fit vs 3.542 for the roster model alone (slope positive in all five folds, 0.56–0.83) |
| 10 page | values match files; desktop and phone; no JS errors | **pass** in headless Chromium at 1280 and 390: no page errors, no horizontal overflow, a season pick keeps the scroll position (2,400 px before and after) |
| 11 connector | connector values equal the page's own math | **pass**: 15 of 15 tests in `check:savant-cbcoaching` (career and season stats, Leaders, tree, similarity scores recomputed from `fit.json`, the Data Room) |
| 11 | coverage map | **pass**: `check:connector-coverage` 1 of 1 |
| 12 refresh | merge mode = full build | **pass**: 0 of 5,732 files differ (the final full build against the final merge build; earlier runs also under a different hash seed); the cloud path from the bundle matches the merge build, 0 of 5,732 |
| 12 | the cloud path | see "The refresh" below |

`npm run check:savant`: **234 pass, 2 fail**. Both failures are in `tools/savant-cbb/value.mjs` (College Savant's
value check) and are on `main` too: its committed `expected-value.json.gz` is from Nov 3 and the cloud refreshed
`public/cbb/s/2026-27.json.gz` on Nov 6. This branch changes no College Savant file the check reads. Because the
script is an `&&` chain, the suites after it did not run inside it; run alone they pass: `questions.mjs` 11 of 11,
`context.mjs` 6 of 6, `check:savant-cbcoaching` 15 of 15. `check:savant-mcp`
passes 16 of 16 with the connector's upfront size limit raised (below). Other checks: `check:whats-new` 9 of 9;
`check:seo` 5 of 6, failing only on the panel-order test already failing on `main` for Basketball Coaching Savant
(this page shares that layout and would fail the same way); `npm run lint` fails only on the bundled Flappy Hoops file,
as on `main`; `npm run build` passes.

## First season of each module

| module | from | why |
|---|---|---|
| records and the tree | as far back as Wikipedia's program histories go | |
| ratings, roster building, Savant value | 2009-10 (2011-12, 2012-13 off) | College Savant's seasons |
| roster model | 2010-11, then 2014-15 on | needs last season's values |
| game management, identity, splits, development detail | 2013-14 | ESPN merged fouls and turnovers into one type before; play-by-play passes College Savant's gate in 80–99% of games |
| market (spread) | 2013-14 | ESPN's archived line (71–73% of games to 2017-18, 99% after; CBBD's cached lines for 2023-24, 2024-25) |
| Rotation Map, lineups, pairs | 2023-24 | 52.9% of games pass the lineup gate in 2023-24, 83.9% in 2024-25, 94.2% in 2025-26; ESPN logged no substitutions before 2024-25 and CBBD's fives begin in 2023-24, so it cannot be extended back |
| challenges | 2025-26 | the men's coach's challenge began then |
| NCAA Tournament | 2002-03 | ESPN's archive |
| resources (EADA) | 2002-03 to 2024-25 | the newest EADA file is 2024-25 |
| portal hit rate | 2021-22 | the spec's window |
| recruiting | 2007-08 | CBBD's recruits |

## CollegeBasketballData

**10 calls**: the transfer portal for 2021 to 2027 (7; 2027 is empty so far) and high-school recruits for 2007 to 2009
(3). Everything else was already cached by College Savant (recruits 2010-26, rosters 2003-27, lines 2023-24 and 2024-25,
conference history). The ledger reads 507 of College Savant's 600 cap for November; CBBD's own meter 463 of 1,000 left.
The refresh makes no calls. No CBBD row reaches `public/cbcs` or the bundle (the check scans every published file).

## Other sources

ESPN core API: season coaches 2003 to 2027 and their records; AP polls every week 2002-03 to 2026-27 (no final poll for
2004-05, 2005-06, 2018-19 and 2020-21 to 2025-26, no 2010-11 preseason poll). Wikipedia: about 370 API requests, 50
titles each, 1.1 s apart, honest user agent, raw cached (program histories, 9,838 team-season titles, 2,547
biographies). EADA: 23 yearly files from ope.ed.gov. A rulebook research pass (NCAA rule books and format sheets) for
timeouts, media windows and the challenge, with sources, is folded into `config.py`. No Sports-Reference, Torvik,
KenPom or EvanMiya data. Ages are not used: the only college birthdate source on file is T-Rank's, ruled out.

## Findings worth knowing (measured, and what changed because of them)

- **The roster model needed the level its players earned their rates at.** College Savant's rates are not fully
  schedule-adjusted; adding each returning or transferring player's old team's net (role-weighted) took team R² from
  .62 to .74. For a returner that includes last season's team, so some of a coach's own past enters his expectation.
  The first version lost to both baselines (7.77 and 9.05); the second beat last season's net but not AP (6.24); the
  third (freshmen by log recruit rank, fitted role carry-forward, minutes to the strongest first) beat both. **The AP
  margin (5.81 vs 5.87) was reached after seeing the test, so treat it as narrow.**
- **ESPN's TV timeouts.** In 0.1–2.6% of games a season ESPN logs no TV timeouts and the TV breaks come through as team
  timeouts (UC Irvine, Nov 2013: nine "team" timeouts). Those games are out of every timeout stat; the Data Room's
  `tv_logged` column says which. About 1% of timeouts are logged twice at one clock; one per clock is kept.
- **Challenges are read from the parenthetical.** ESPN's type id contradicts the parenthetical and the timeout clause
  on 192 challenges in 2025-26, and the clause contradicts the other two on 243. The rule settled it: a second challenge
  needs a first that won, and 30 first challenges of a pair read "(Overturned)" with "charged with a timeout", none the
  reverse. My first reading (the clause) was wrong and the check caught it. 11 of 158 pairs still break the rule on
  every signal.
- **"Decided" is the final garbage run.** The safe-lead rule flags the last seconds of most close games, so taking the
  first flagged possession made Duke 2024-25 a blowout in 33 of 33 lineup games and left no close games for the closing
  stats. The blowout cause now starts at the final unbroken garbage run with a minute or more left (24 of 33).
- **Lineups judged from their parts are unvalidated.** With same-season rates the projection beat the team's net
  (21.59 vs 22.09), but those rates include the test games. Rated on the previous season only, it gained nothing
  (20.916 vs 20.927 on 1,227 held-out units), so "lineups left on the table" and the quadrant are labelled unvalidated.
- **Halftime adjustment's D1 mean is exactly zero** (each game's two sides cancel), so it is each coach's raw second-half
  minus first-half net.
- **Player development** needed a season-pair step: 2021-22 sat 0.48 below the rest (the extra year of eligibility).
- **College Savant's `tools/savant-cbb/page-src` predated its 1.3.0.** Running its assembler dropped 1.3.0's play
  context and shot charts from the page (found by the diff, reverted). Fixed later on Nov 6: every page built from a
  page-src folder now reproduces its published page byte for byte, and `npm run check:page-src` (first in
  `check:savant`) fails on one byte of drift. See each `page-src/README.md`.

## The refresh

Merge mode for the current season takes about 2 minutes; a full build about 6 (it was 27 before the as-of-date
ratings were moved to normal equations and the margin model was cached). The cloud path was run locally from the
bundle (92 MB, no CBBD field in it) into a scratch repo, exactly as `cloud_run.sh` calls it: 108 seconds, and its
`public/cbcs` is byte-identical to the Mac's merge build (0 of 5,732 files differ). Getting there found two more
defects, both fixed: the spread curve was refitted from whatever games were on hand (the cloud has only the current
season's, which moved wins above the spread in 284 coach files; the slope is now fitted once by `expect.py` and stored),
and the current season's player roles were divided by a stale game count on the Mac (now this pipeline's own parse,
which is also what the cloud has; the same rule, "a team has played at least as many games as any of its players",
corrected 14-16 roles in each of four past seasons, and the roster model was rerun: unchanged to two decimals).

## Files and sizes

`public/cbcs`: 67 MB in 5,732 gzipped files (coach pages 26 MB, team-seasons 14 MB, stints 14 MB, games 4 MB,
decisions 3 MB, roster moves 2 MB, units 1 MB, rotation 0.7 MB; `index.json.gz` 334 KB, `programs.json.gz` 790 KB,
`coaches.json.gz` 396 KB, `fit.json.gz` 160 KB, `player-fits.json.gz` 102 KB). Largest file: `data/stints/2025-26.json.gz`
at 6.4 MB (the limit is 15 MB). The page: 268 KB. The bundle for `cbcs-bundles`: 92 MB.

## Not built, or built thinner than the spec

- **Context splits:** rest, travel, time zones, altitude, officials and game state are not built (no venue table with
  coordinates is on file; one CBBD `/venues` call would give it). Built: opponent strength as of the date (top 50 /
  51-150 / below), home-road-neutral, conference, non-conference schedule strength, regulars missing, trailing at the
  half, tempo control, season phase, the market.
- **NIT, CBI, CIT, Crown and conference tournaments** are in the data (`tournament.other`) but not drawn on the page.
- **Assistants' titles and responsibilities** are not in any free source; school staff pages (Sidearm) were not crawled.
- **"Filterable to the current portal cycle"**: the 2027 portal is empty, so similar players come from 2025-26 and the
  current season.
- **NCAA appearances, Final Fours and titles count from 2002-03** (Izzo's 2000 title is not counted; the page says so).
- **The page was tested in headless Chromium**, not by a person in a real browser (the Chrome extension was not
  connected).

## The review list (spec §9)

1. **Head-coach rows marked unconfirmed:** 751 in the stats era (13,027 in all, mostly tenure-list expansions before
   2009). Interims: 34 in the stats era, 8 unconfirmed. 147 rows for review in `registry.json` (`review`): ESPN names a
   different coach (93), a split season without both records, so every game went to one coach (43), the infobox and the
   program list disagree with an interim mentioned (9), a running record that never matched (2).
2. **Mentor suggestions:** 1,205 coaches have one; 98 are ties (flagged on the page); 300 of 366 current head coaches
   have a mentor. Worth a pass: coaches whose only staff stint is one season.
3. **Assistant gaps by era:** team-season staffs on record for 49 of 312 teams in 2002-03, 100 of 311 in 2008-09, 164
   of 323 in 2010-11, 320–328 of about 360 from 2013-14, 171 of 366 for 2026-27 so far.
4. **Wikipedia credit and share-alike wording** on pages showing coach history: the page and the connector say "facts
   read from Wikipedia ... CC BY-SA 4.0, each row linked; they are facts, not Wikipedia's text." Adam to confirm.
5. **EADA programs that did not match:** none. Army, Navy and Air Force file no EADA report; St. Francis Brooklyn has
   no 2022-23 row (it ended athletics). From 2021-22 NIL money is outside EADA (the page says so).
6. **The fit model's test and its label:** "similar players under him" (3.563 vs 3.542; above).
7. **Seasons where the Rotation Map or after-timeout plays could not run:** the Rotation Map before 2023-24 (no
   substitutions or fives exist); after-timeout plays before 2013-14 (fouls and turnovers merged in one type) and, in
   every season, the 0.1–2.6% of games without logged TV timeouts.
8. **The connector's upfront size** is now 81,667 characters; `tools/savant-mcp/check.mjs` raises the limit from 77,000
   to 82,000 with a note that it awaits Adam's approval.
9. **`cbcs-bundles` is public** (pushed Nov 6): it carries no CBBD row, only WCE's numbers, EADA's public figures and
   Wikipedia facts, plus ESPN's and Wikipedia's coach birthdates, which the coach pages show anyway.
10. **This page has no site ribbon** (`wce-nav`) and still carries two old tab links: its page-src was copied from
    Basketball Coaching Savant's before that source had the ribbon. Adding it is a visible change, left for Adam.
