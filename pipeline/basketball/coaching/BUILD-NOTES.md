# Basketball Coaching Savant 1.0.0 — build notes and the review list

Built Oct 27, 2026 on the Mac from the v2 spec, in the order of its §9. Everything below was
measured in this build; the numbers are also in `public/bcs/index.json` under `meta.fits`.

## What was built, step by step

| step | done | the check |
|---|---|---|
| 1 registry | 393 coaches from Basketball-Reference (plus twelve stubs: Ettore Messina and eleven Omicron-wave acting coaches), every head coach's record by season, assistant stints for the men who later became head coaches, awards, Coach of the Year voting, hire and fire dates. 38,039 team-games 1996-97 to today assigned to a head coach. 107 split seasons cut where the running record first equals the first man's. 31 acting-coach rows applied by hand (`HC_FIXES`, each sourced, counts checked against the schedule; eleven acting coaches are stubs with no Basketball-Reference page). | one head coach per team-game; **every coach-season record matches Basketball-Reference (0 mismatches, 0 unpinned splits)**; the NBA's staff table disagrees on 46 team-seasons, every one a next-season coach or a name variant, so it is a cross-check, not a source |
| 2 events and stints | 31,000 ESPN games 2002-03 to 2026-27, regular season, play-in and playoffs, cached with venue, officials and the closing line; event types confirmed against the raw play text (timeouts 16/17/581, challenges 213–216, reviews 278–280, take fouls 22/257) | **team minutes = 48 + 5 per overtime in every sampled game**; possessions within 1.2 per game of the shared parser's own tallies; points inside possessions match team points in 76 of 160 sampled team-games and are 1–6 short in the rest (technical free throws and stray sequences; the ratings use the box score) |
| 3 lineups | five- and two-man units, pairs, With/Without, from the stints; luck- and sample-adjusted as the Lineups tab does (k = 843 / 1,221 possessions from `out/lineup_k.json`) | **unit minutes match the NBA's published lineup table within 2.0 minutes on 180 units of 2024-25 and 2025-26** |
| 4 context | the games table, 1996-97 on: rest, back-to-backs, 3-in-4s, road-trip game, miles, time zones and altitude from the arena table and ESPN's venue city (London, Berlin, Mexico City, Las Vegas, Abu Dhabi, the bubble, Tampa), opponent strength as of the date from prior games only, missing regulars and their impact, officials, the closing line (2015-16 on, 28,476 team-games), win probability (2018-19 on), season phase | home and away counts, rest days from the schedule, prior-games-only strength; betting coverage by season is in the games table |
| 5 Mac-lane pulls | team tracking (14 seasons, 2013-14 on), hustle (11), Synergy offense and defense (12), zone (2025-26 and 2026-27), the player index with draft slots, the NBA's staff tables 1996-97 on (full from 2006-07; patchy before, where stats.nba.com answered some teams and refused others, `out/bcs/staff_depth.json`) | headers verified on one call per family (`out/bcs/nba_headers.json`) |
| 6 modules | A–J, the talent and market expectations, 86 stats in the registry | see "Fits" |
| 7 the page | `public/basketball-coaching-savant.html`: 18 sections of §5, the Rotation Map on a canvas, the pair matrix, the lineup quadrant, minutes vs impact, management tiles, context small multiples, courts, play types, the fingerprint overlay, the slopegraph, the development dumbbell, staff and tree, comps, seasons, the scouting report; the tree view | every value is read from the files; a headless run (jsdom) renders the home screen, five coach pages with every tab, every click-through and the tree with no JavaScript errors; phone layout by CSS (the SEO check passes); a real browser was not available in this session (the Chrome extension was not connected), so the visual pass is on the review list |
| 8 the Savant card | a rotation strip on every player card (2002-03 on), the connector's `nba_player_splits` gains `view: "rotation"`, Basketball Savant 2.5.0 | `check:savant` still passes where it ran (see below) |
| 9 connector | `api/_bcoaching.js`: `nba_search_coaches`, `nba_get_coach_profile` (9 groups), `nba_coaching_leaders`, `nba_coaching_tree`, `nba_coaching_data` (the Data Room: 5 tables, filters, columns, paging), `nba_coaching_dictionary` | `tools/savant-bcoaching/check.mjs` (14 tests) holds the files, the page and the tools to each other; `check:connector-coverage` passes (149 features, 122 answered) |
| 10 refresh, entry points, versions | `refresh_live.py` in `cloud_run.sh` with continue-on-error (reads the saved bundles from a `bcs-bundles` branch, `publish_bundles.sh`), the Mac's tracking upload carries the team tables (`export_tracking.py`), gzip rewrites in `vercel.json`, nav, home, gateway card, SEO page, `updates.json` | **a merge-mode refresh of 2026-27 is byte-identical to the full build (1,276 files, ignoring the timestamp)** |

## Fits (measured, not tuned)

- **Talent expectation**: team net rating = 0.586 + 0.726 × talent, where talent is the
  roster's prior-season BPM weighted by prior-season role (mpg × availability), rookies by
  draft-slot prior (pick 1–3: −0.72; 4–10: −1.78; 11–20: −2.20; 21–30: −2.25; 31–45: −2.54;
  46–60: −2.77; undrafted: −2.76 BPM), replacement level the 10th percentile. Leave-one-season-out
  R² **0.480**, 3.52 points of error, 718 team-seasons 2002-03 to 2025-26. The naive baseline
  (0.6 × last season's net) scores 0.345 and 3.94, so the model beats it out of sample.
  Wins per point of net: 2.44 per 82 (intercept 40.96).
- **The BPM fill-in** (`archive.impute_bpm`): 215 player-seasons with 200+ minutes since 1996-97
  had no BPM, PER or VORP, so it is the Basketball-Reference name join (suffixes and initials:
  Jimmy Butler III, AJ Green, Robert Williams III). A per-season ridge on sixteen box rates fills
  them (five-fold cross-validated R² 0.889, 0.856 at worst); rows carry `bpm_imputed`. Measured
  by building twice on Oct 27 with `BCS_NO_IMPUTE=1` and without: the talent line's out-of-sample
  R² went 0.475 → 0.480 and its error 3.54 → 3.52 on the same 718 team-seasons; the projection
  from parts reaches 7,426 five-man units instead of 6,910 (every man now has an impact) at
  R² 0.245 → 0.243. A small, real gain on the team line, and coverage on the units.
- **Projection from parts**: luck-adjusted unit net on Σ BPM of the five, leave-one-season-out
  R² **0.243** on 7,426 five-man units with 100+ possessions. The six archetype pairings tested
  (two bigs; big + two shooters; two creators; creator + two shooters; two pass-first guards;
  three guards) added nothing out of sample (0.243 → 0.243) and were **dropped**.
- **Lineup pairings** (`pairings.py`, the lineup fit study's method: luck-adjusted five-man net on
  Σ BPM, Σ usage, the count of each player type and the pairing, team-season fixed effects, errors
  clustered by team-season, discovered on the even seasons 2018-19 on and replicated on the odd,
  5,397 units after the rebuild). Per 100 possessions, discovery then replication then pooled:
  hub big + stretch big −5.94 / +2.35 / −1.82 (1.6% of units); rim protector + stretch big
  +2.72 / +1.46 / +1.99 (SE 1.51); spacer + stopper −1.21 / −1.51 / **−1.38 (SE 0.59, t −2.3)**
  (63% of units); two bigs where neither shoots −0.77 / +0.54 / −0.12. The strict rule (p < .05 in
  each half) admitted nothing. Adam's rule (Oct 27): same sign in both halves and the pooled
  estimate past p < .05. That admits spacer + stopper alone, and it is in the projection from
  2018-19 on at the pooled coefficient (`pair_adj` in the units table says by how much, for the
  units whose five men all have a player type). The sign matches the study's (−1.53); the three
  others flip or do not clear and are left out. On the first run, before the rebuild, the pooled
  estimate was −1.43 (SE 0.60); the acting-coach splits and the BPM fill-in moved it by 0.05.
- **Spread curve**: empirical P(win) by closing spread from 28,476 team-games, football's method.
- **Fair-minutes line**: per season, mean minutes per game by whole-BPM bin over players with
  200+ minutes, monotone-smoothed; `overplay` is minutes above it.
- **Run stopping**: the league's opponent points per possession over the next five possessions
  after a run reached 6 with no timeout (2024-25: 1.37 for runs of 6–7, 1.47 for 8–9) is the
  matched baseline.
- **Aging-curve residuals**: the league-wide minutes-weighted mean of (Δ position-adjusted BPM
  percentile − expected) over 997 coach-seasons is **+0.62 percentile points** on a 0–100 scale,
  near zero. (A first pass that applied the curve to raw BPM read +0.55 BPM, which is what caught
  the unit mismatch: the curve is fitted on percentiles, so development is measured in them.)
  The small positive residual is the survivorship the curve's own inclusion rule carries: only
  men who kept 500 minutes in both seasons are scored.

## Decisions made in the build (the spec left them open)

- **Impact currency is BPM**, as on the player's card, not Savant value. BPM exists for every
  season since 1979-80 and is already in the archive; Savant value is a per-season total whose
  model runs from 2013-14. The spec's "Savant value now, RAPM later" is therefore "BPM now".
- **Closing with the best five** is measured as a gap, not a yes/no: Σ BPM of the top five
  available minus Σ BPM of the five on the floor at the buzzer, over close games. An exact
  match of five is rare enough (a backup with a hot small-sample BPM breaks it) that the
  yes/no rate was 0 for most coaches; the gap and the "four of five" rate carry the idea.
- **Usual windows are measured on minutes still in the balance** (garbage time and the minutes
  after a forced exit leave the base), or a closer's window erodes with every blowout.
- **Off-script minutes** are scored only where the usual status is clear (60%+ on, under 40%
  off); the ambiguous band is not counted either way.
- **The arrival effect** uses team-season figures whoever coached; the "returning players only"
  toggle is served as the returning-minutes share and the development numbers, not as a
  recomputed team line.
- **The staff tables** name next season's staff as often as this one's (the NBA's roster
  endpoint is a snapshot), so they are a source for assistants and a cross-check for head coaches.

## The review list (for Adam)

1. **Acting coaches.** 31 rows applied (`HC_FIXES`, each sourced, every game count checked
   against the schedule on Oct 27): the four from the first build (Walton for Kerr 2015-16, Mike
   Brown for Kerr in the 2017 playoffs, Messina for Popovich in the 2018 playoffs, Larry Drew for
   Lue in 2017-18), the seven Adam dated (Mosley for Carlisle Apr 2021; Jent for McMillan Dec 1,
   2021; Prunty then Jent for McMillan Jan 2–11, 2022; Fleming for Donovan, 5-0; Popeye Jones for
   Malone, 2-2; Adelman for Malone Jan 17–18, 2023; Atkinson for Kerr Feb 12, 2024), and 19 more
   rows from the 2021-22 Omicron wave (Pierce/IND, Christie/SAC, Kalamian/DET twice, Fizdale/LAL,
   Brooks/POR, Kevin Young/PHX, Wilks/OKC, Burke/PHI, Shaw/LAC, Ham/MIL, Sweeney/DAL, Brad Jones
   then Rajakovic/MEM, Delany then Blair/WAS, Mermuys/ORL, Jensen/UTA, Vaughn/BKN). Eleven of the
   acting coaches have no Basketball-Reference page and are stubs (`STUBS`, birth data blank).
   Still to confirm, flagged `confirmed: false` on the rows and listed in `HC_UNCONFIRMED`: the
   two handovers inside a window, ATL (Prunty → Jent before Jan 9) and MEM (Brad Jones →
   Rajakovic before Jan 11), which are reported but not pinned game by game. Resolved while
   researching: Denver's Dec 30, 2021 absence went to Popeye Jones for all four games (Adelman was
   named first and entered protocols before the Jan 1 game, Denver Gazette); the Clippers' Shaw
   stint is three games (Dec 31 to Jan 3, Lue cleared Jan 5); Wilks coached two Thunder games,
   not one. Searched with nothing to add for the window: Udoka, Spoelstra, Thibodeau, Kerr,
   Popovich, Nurse, Finch, Bickerstaff, Borrego, Green and Silas (whose protocol stint was the
   October 2022 preseason). Basketball-Reference's own splits (interims of record) are all pinned.
2. **Mentor suggestions.** Computed from the record; two overrides by hand (Popovich → Larry
   Brown, Phil Jackson → Doug Collins with Red Holzman as "also"). Ties the data could not break
   are flagged `tie` on the page. Worth a pass: coaches whose only recorded stint is a late one
   (e.g. a long college career), and the 196 head coaches with no NBA assistant stint on record
   (shown as roots).
3. **Assistant gaps by era.** Basketball-Reference lists assistant stints only for men who later
   became head coaches; the NBA's tables are whole from 2006-07 and patchy before (stats.nba.com
   refused some of the 1996–2006 roster calls twice; a later `nba_pulls.py 1996-97 2006-07
   --phases=rosters` then `registry.py` and `build.py` fills whatever it answers). Staff rows per
   season now: about 55 in 1996–99 (Basketball-Reference only), 90–140 in 2000–06, 145–220 after.
4. **Preseason win totals.** Every season 1996-97 to 2025-26 has 29–30 teams from
   Basketball-Reference's odds page (one source each); none for the 1998-99 lockout; 2026-27's
   page has no totals yet.
5. **Blank or thin sections.** Switch rate (`BoxScoreDefensiveV2`): the backfill's games pass had
   not reached the seed when this ran, so no switch column anywhere; the code reads the seed when it
   lands. Defensive assignments (who guards the best scorer) are not built. Zone defense covers
   2025-26 and 2026-27 only. Pick-and-roll coverage, set names and inbound spots are not in any
   free data (as the spec says).
6. **Judgment calls in checks.** Points inside possessions run 1–6 short of the box score in half
   the team-games (technical free throws, stray sequences); after-timeout and end-of-period points
   per possession carry that undercount equally for everyone. The event census, unit minutes and
   merge-mode identity are exact.
7. **A visual pass in a real browser** (desktop and phone): the headless run found no errors,
   but nobody has looked at it.
8. **Publishing.** Nothing is committed or pushed. The full build's bundles must be pushed to the
   `bcs-bundles` branch (`publish_bundles.sh`) before the cloud's merge-mode refresh can run.

## The redesign (Oct 28, 2026)

Two data fixes and a new page, after Adam's visual pass.

- **Mentors count only stints before the first head job** (`modules.suggest_mentors`). A stint taken
  after a man had already been a head coach is a job, not an apprenticeship; it is kept on his page
  under "on a staff after he had been a head coach" and in `lineage.later`, never as the mentor.
  99 mentors changed. The ones the pass named: Mike Brown, Kerr → Popovich; Kenny Atkinson, Kerr →
  D'Antoni; John Calipari, Larry Brown → none (his Philadelphia stint came after New Jersey); Nate
  McMillan, Redick → Paul Westphal. Others worth knowing: Luke Walton, J.B. Bickerstaff → Kerr;
  Jacque Vaughn, Atkinson → Popovich; James Borrego, Popovich → Monty Williams; Larry Drew, Lue →
  Mike Woodson; Maurice Cheeks, Donovan → Larry Brown; Randy Ayers, Monty Williams → Larry Brown;
  Mike Woodson, Rivers → Larry Brown; Kurt Rambis, Phil Jackson → Del Harris; Lionel Hollins, Hubie
  Brown → Brian Hill; Dave Joerger, Rivers → Hollins; Jeff Hornacek, Silas → Corbin; Jay Triano,
  Borrego → Sam Mitchell; Scott Brooks, Billups → Bzdelik; Ryan Saunders, Malone → Flip Saunders;
  Mike D'Antoni, Atkinson → Bill Hanzlik; Lloyd Pierce, Carlisle → Brett Brown. 61 coaches whose only
  recorded stints came after their first head job (Alvin Gentry under D'Antoni, Jason Kidd under
  Vogel, Doc Rivers, Jeff Van Gundy, Billy Donovan, Frank Hamblen, Tex Winter, P.J. Carlesimo among
  them) now have no suggested mentor and sit in the nursery as "no recorded lineage before their
  first head job". The tree note says so.
- **The arrival effect is on one scale**: every metric is the team-season's percentile among that
  season's teams (lower-is-better flipped), so the distance between the dots is the size of the
  change; the season after he left is included where there is one. The values stay in the hover.
- **The page** (`public/basketball-coaching-savant.html`, rewritten): Basketball Savant's card rows
  (one stat per row, the percentile riding the bar, grouped under section heads); one tooltip engine
  (`data-tip`) so every bar, chart mark, cell, tile and label opens a box with the value, the
  percentile and its pool, the sample and the definition from `config.STATS`, and a click pins the
  explainer; every player name links to his Basketball Savant card (`/basketball-savant.html?p=<id>`)
  and every coach name to his page; the career chart at the top (columns in team colours, playoff
  strip, net / talent / market rows, the peak season outlined, hover for the season line, click to
  open it); a sticky season picker that switches every section (bars ranked against that season's
  coaches, the Rotation Map, lineups, game management, situations, identity, staff); the in-season
  scouting report (`modules.scouting_season`, rewritten with every refresh; provisional percentiles
  among coaches with 10+ games until the 41-game line, `config.MIN_LIVE_GAMES`); the off-script chart
  shows the coach's choice by default with a toggle for the other causes, a percent axis, a hover
  naming who was missing and who moved, and a click that lays the game over the map; the Rotation
  Map has Q1–Q4 labels, a minute axis and a cell hover placed clear of the names; the tree is
  football Coaching Savant's zoomable forest with branches coloured by root, records on the nodes,
  search, hover to light the line, click to open, and an assistants toggle.
- **The visual pass** is `tools/savant-bcoaching/shoot.py` (Playwright): every section at 1280 and
  390 wide, console errors, horizontal overflow, the hovers, the picker and the tree. Last run: no
  errors, no overflow at either width, every hover fires, 78 player links and 275 coach links on
  Spoelstra's page.
