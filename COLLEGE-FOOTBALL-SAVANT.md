# College Football Savant 1.1.0: the stat expansion

Built Nov 10, 2026 on branch `cfb-1.1` from `research/cfb/BUILD-1.1.md`, with the catalog `research/cfb/EXPANSION.md`.
Not merged: Adam reviews. The connector changes need his approval before merging (standing rule).

## Adam's decision during the build (Nov 10)

**Devy fantasy (BUILD-1.1 section 5.4) is deferred.** No devy tab, no fantasy points on cards, no `cfb_devy_rankings`
tool, and it is not in What's New or the README. `pipeline/cfb/devy.py` and the two models only it used (expected
fantasy-point cells, touchdown chance by where a target was thrown) were removed. The models other stats use stay:
expected touchdowns, completion probability with air yards, expected YAC.

## What shipped

- **242 new stats:** 186 player stats (counting each position's version) and 56 team stats, every catalog item mapped
  (`pipeline/cfb/config_x.py`; `python -m pipeline.cfb.config` checks all 125 catalog items). The registry now holds 254
  player and 99 team stats.
- **Tier A, every season the data has (2009 or 2014 on):**
  - QB: passer efficiency rating, ANY/A, TD and first-down rates, situational splits, drives, total EPA, WPA,
    touchdowns over expected, rushing first downs, fumbles, and team pass rate over expected as context.
  - RB: line, second-level and open-field yards, opportunity rate, highlight yards per opportunity, power success,
    red-zone and goal-line shares, touchdowns over expected, receiving volume.
  - WR/TE: first downs per target, red-zone and third-down target shares (from 2025, when every target is named),
    touchdowns over expected, WPA.
  - Defenders: solo and assisted tackles, TFLs on runs and passes, sack value, third-down and strip sacks,
    interception returns, fumble recoveries, penalties, havoc share.
  - Special teams: a **returner pool** of its own; kickoffs (touchback rate, EPA) and long field goals; punting
    placement (inside the 20, touchbacks, return yards allowed).
- **Tier B, the charted layer (2025 week 9 on):**
  - `pipeline/cfb/charting.py` reads ESPN's charted play text: formation, tempo, depth and direction, air yards and
    YAC from the caught-at and thrown-to spots, run direction, hurries, break-ups and tacklers.
  - QBs get shot selection, by-depth, pressure, formation and tempo, and a real CPOE.
  - Backs get run direction and formation splits.
  - Receivers get aDOT, air-yards share, WOPR, YAC over expected, and depth and direction splits.
  - Defenders get pressures, tackle depth, run-stop rate and credited coverage.
  - Teams get pressure, OL by direction, formation identity, and what the defense allows downfield.
- **Team page:**
  - pace, PROE, early-down pass rate, drives, explosives by type, two-minute and middle 8
  - special teams by phase
  - what the defense allows to QBs, RBs, WRs and TEs, opponent-adjusted
  - fourth-down go rate over expected with WCE's own recommendation, two-point tries and timeouts
  - a Fourth downs panel and the portal haul (2021 on)

  Every fourth down, try and timeout is stored in each team's season file (`t/<season>/<team>.json`, `decisions`)
  for a future College Football Coaching Savant.
- **Card:**
  - Football Savant-style groups that collapse to their headline stat and stack on phones
  - a profile score (mean percentile of five headline stats), CHARTED tags, a returner section
  - "what the page can't see" for every position (the catalog's Tier C)
  - weakness comps
  - career trajectory, production vs pedigree, transfer impact, NFL translation
- **Leaderboards:** every new stat, a returner pool, and "outplaying his stars" both ways.
- **Connector:**
  - the `cfb_` tools carry the card groups, CHARTED flags, profile score, weakness comps, returner rows and pedigree
  - `cfb_leaderboard` takes position RET
  - new `cfb_nfl_comps`
  - the upfront tool text stays under the existing 90,000 cap (tightened descriptions, no raise needed)
- **Refresh:** charting, fourth downs and the current season's features run in the cloud from ESPN plus committed state
  (`state/expansion.json`, `state/verdicts_x.json`, `state/nfl_pool.json`, `state/recruits_current.json`,
  `state/transfers_current.json`, `state/models/xpass_model.joblib` and `go_model.joblib`). The heartbeat carries a
  charting block and the freshness workflow alarms if a recent game day's charted share drops under 90%.

### A 1.0.0 defect fixed on the way

ESPN's roster endpoint returns 100 players a team unless asked for more (`?limit=300` gives Auburn 113). 1.0.0's 2026
rosters were capped: **201 FBS defenders with 20+ tackles had no roster row and so no position, and only 7 were
graded**, along with 13 quarterbacks with 500+ passing yards. Fixed in `espn_feed.fetch_rosters` (new cache key). The
2026 file now grades 6,097 players instead of 5,535; Savant values move with the bigger pools. Release rosters for
2014-2025 were already complete (median 112-122 a team).

## Every check and its result

| step | check | result |
|---|---|---|
| 1 | Registry: every catalog stat present or Tier C with a reason | 125 items: all mapped, 12 Tier C with reasons; 254 player / 99 team stats; problems 0 |
| 2 | Air yards vs the release file's `air_yards`: median abs. diff <= 1 on >= 95% | 2025: 0.00, 100.0% within 1 (23,058 throws); 2026: 0.00, 99.8% (32,726) |
| 2 | Air yards + YAC = gain within 1 yard on >= 98% | 99.5% in both seasons (14,454 and 20,821 completions) |
| 2 | Named defenders resolve to roster ids on >= 95% | 99.1% in both (53,790 of 54,261; 76,877 of 77,612) |
| 2 | Charting share per game; under 80% contributes nothing | 2025 week 9 on: 391 of 396 FBS-vs-FBS games charted; 2026: 560 of 562 (list in `research/cfb/out/charting.md`) |
| 3 | Returns, punting, penalties within 2% of box totals | returns, return yards, return TDs and punts: within 2% every season (`research/cfb/out/box_check.md`). Penalties: see the review list |
| 4 | CPOE beats 1.0.0 on log-loss, calibrated by decile (game-level CV) | out-of-fold log-loss 0.537 vs 0.632; largest decile gap 0.017 |
| 4 | YACOE, same validation | RMSE 7.14 vs 7.27 (MAE 4.45 vs 4.57); largest decile gap 0.32 yards |
| 4 | Expected TDs fit 2014-2024, calibrated on 2025 | before the 2025 shift the models were within 1-5% of 2025's TDs; after it exact; largest decile gap under 0.01 |
| 5 | `expansion_stability.md` written, verdicts in the registry | written; `state/verdicts_x.json`. Player: 22 full bars, 22 hatched, 101 CONTEXT (51 of them style), 42 dropped. Team: 12 full, 7 hatched, 28 CONTEXT, 5 dropped |
| 6 | What-it-allows totals reconcile with the opponents' player totals | exact: for QBs, RBs, WRs and TEs, the defenses' allowed EPA and plays sum to the position's own totals with a difference of 0 (measured on 2019 and 2025) |
| 7 | NFL translation correlation reported | Spearman 0.110 (p = 0.002) on 2014-2021 college finals of NFL players (`research/cfb/out/nfl_translation.md`) |
| 8 | No file over 15 MB, sizes reported | `public/cfb`: 2,501 files, 35.1 MB; largest `s/2025.json.gz` 0.95 MB; new `x/` 124 files, 1.38 MB |
| 9 | Values match the data files; no JS errors; no sideways scroll at 375px; pools named; reduced motion | `tools/savant-cfb/shoot.py`: 19 views at 1440, 375 and 375 reduced: no errors, no problems; every bar on the QB card recomputed from the files and matched; 2019 charted rows read "not tracked before 2025" |
| 10 | cfb check extended to the new values | `tools/savant-cfb/check.mjs` 17 of 17 |
| 11 | A refresh of 2026 is byte-identical to the full build | **247 of 247 files identical** (the new `x/` files included) |
| 12 | `check:savant`, `check:whats-new` | 307 pass, 0 fail, 4 skipped; whats-new 9 of 9 |

## The review list for Adam

1. **Stability.**
   - **Player stats (187 new or re-measured):**
     - 22 full bars and 22 hatched.
     - 101 CONTEXT, 51 of them "style" (how he plays, not how well: direction mix, shotgun rate, depth of target,
       shares of his team's work, solo and assisted tackles).
     - 42 dropped, shown as CONTEXT labelled noise.
   - **Most of the drops are small samples:** EPA and yards per sack (2 sacks a season), interception return yards,
     two-minute and middle-8 EPA for a QB, short-yardage conversion, fumble recoveries, return EPA, deep and short
     splits for tight ends.
   - **Tier B full bars:** pressure rate faced, pressure-to-sack rate, completed air yards per attempt, defenders'
     hurries, pressures and share of team pressures, break-ups per opponent dropback.
   - **Two Tier B rows land as CONTEXT:** the new CPOE (0.37 at a starter's sample) and shotgun EPA (0.43).
   - **Team stats:** 12 full, 7 hatched, 28 CONTEXT, 5 dropped (FG EPA per game, two-point conversion rate, OL left
     line yards and stuffs). Full table: `research/cfb/out/expansion_stability.md`.
2. **Charted parser.**
   - **Agreement:** the numbers are in the checks table.
   - **Games under 80%:** five in 2025 week 9 on (Texas A&M at LSU, Ole Miss at Oklahoma, Alabama at South Carolina,
     two bowl games: 0% charted) and two in 2026 week 1.
   - **Judgment call:** about one touchdown in six in charted games is written as a scoring summary ("Edrees Farooq 45
     Yd Interception Return (Max Gilbert Kick)"), with no formation, depth or hurry. Those plays count in every total
     but in none of the charted splits, and every Tier B explainer says so. A first version read the missing
     "Shotgun" tag as under center, which put interception-return touchdowns under center; caught by the stability
     study.
3. **CPOE and YACOE.** Both beat their baselines out of fold and are calibrated by decile (numbers above). The models are
   frozen in `state/expansion.json`, fitted on charted 2025-2026.
4. **NFL translation.**
   - Overall correlation 0.110 (p = 0.002): positive, so outcome averages show, but it is weak.
   - By position: QB 0.28, TE 0.21, LB 0.14, CB 0.13, WR 0.06, RB 0.06, **S -0.01, IDL -0.05, EDGE -0.08**.
   - **Judgment call:** the rule is applied per position too, so EDGE, IDL and S cards show comps without NFL outcome
     averages.
   - The recruiting rating enters as its percentile among all rated recruits. The public repo carries only that rank
     transform, never CollegeFootballData's composite (1.0.0's rule).
   - The pool is 4,085 linked final seasons, of which 2,211 have NFL value.
5. **Stats cut, with reasons.**
   - **Devy fantasy:** deferred (Adam).
   - **End-zone target share:** Tier B only, because only the charted text gives the spot a ball was thrown to.
   - **Muff rate:** Tier B only, because earlier text rarely says "muffed".
   - **Strip sacks:** tracked to 2020 only, because forced fumbles stop being credited after that (17 strip sacks in
     2025).
   - **Red-zone and third-down target shares:** start in 2025, like 1.0.0's target share.
6. **Penalties (step 3's check).**
   - The box has no per-player penalty line, so a player's penalties cannot be checked against it.
   - ESPN names the penalized player on 50-66% of accepted penalties. The stat is "penalties ESPN charges to him" and
     says so.
   - Play-by-play penalty rows run 0-11% under the team box (worst in 2022-2024). The team page's penalty stats were
     already the team box's.
7. **Returns.**
   - The play text of some seasons stops at "kickoff for 62 yds" (2,725 kickoffs in 2023), so return counts, yards
     and touchdowns are the box score's.
   - Per-return rates come from the returns the text describes: 87-99% of the box's in most seasons, but **51% in
     2023** and 62-75% in 2009-2011.
8. **Fourth downs.**
   - The release file's recommendation is not used, because the cloud refresh can't read it. WCE's own model uses
     expected points, and win probability in the last 15 minutes of a game within 16 points.
   - It agrees with the release file's recommendation on 74% of 2025's fourth downs. It is more aggressive in
     field-goal range and less aggressive on fourth-and-long in its own territory.
   - WP alone agreed on 67%: in lopsided games WP barely moves between choices.
9. **Timeouts.** Credited to a team on 99.8-99.95% in most seasons, but 2025 has 782 timeout rows with no team named
   (91.5% credited); those are left out.
10. **Connector size.** Under the existing 90,000-character cap. Two existing `cfb_` descriptions were tightened to make
    room for `cfb_nfl_comps`: the player profile's and the team profile's ("WCE power rating by unit"). No cap raise
    is needed.
11. **Every judgment call, briefly:**
    - Expected pass rate is a boosted model (a logistic calibrated worse) and is centred on each season.
    - WOPR is computed game by game, weighted by team attempts.
    - Tier B reliability is stepped up to a starter's full season, and Tier B qualifiers count charted plays only.
    - The returner pool needs 12 returns, scaled to the season played.
    - Class stands in for age where it is used.
    - Production vs pedigree uses the recruiting rating's percentile among qualified players with one.

# College Football Savant 1.0.0

Built Nov 10, 2026 on branch `college-football-savant` from `~/College-Football-Savant/BUILD.md`, on top of prompt 1's
research (`research/cfb/BACKTEST.md`). Not merged: Adam reviews and merges. The connector changes need his approval
before merging (standing rule).

## Adam's decisions, Nov 10

- Raw ESPN stays off GitHub. The archive is on the Mac only (`pipeline/cfb/archive.py`), as College Basketball
  Savant's is. BUILD's monthly `cfb-raw` release asset is dropped.
- About 25 CFBD calls this run. Team talent is computed from recruit ratings, not taken from 247.
- The connector's size cap may be raised for the `cfb_` tools.
- The `check:seo` failure on main is left alone.

## Adam's decisions after the first review, Nov 10 evening

1. **Defenders.** Any defender who played in at least half his team's FBS games is now graded, as well as everyone
   the old rule kept (5 credited plays or 15 box-score tackles). Quiet players simply score low, under the existing
   "credits playmakers" note. "Played" means the box score or the play-by-play credits him with something in that
   game, because no free source says who was on the field.
   - The change adds 237 to 365 defenders a season from 2014 on (2,700 to 2,937 in 2025) and none before 2014,
     when no tackler is named.
   - Rerunning the All-Savant sets changed 9 of 468 national-team defensive picks across 2014–2026, all through the
     shift in replacement level. No Savant Heisman changed.
   - The AP comparison is unchanged at 38%. **The stars it was meant to catch are still missing**, and the reason is
     the data, not the rule. Before 2024 many schools' stat crews rarely name a tackler: Oklahoma's named one on 6 of
     886 defensive plays in 2019. So Kenneth Murray (102 tackles) shows a credited play in 5 of 14 games, Jeff Okudah
     in 4, and Pat Surtain in 2. Will Johnson (2024) is a correct miss: he played 5 of Michigan's 13 games. Only the
     2024-on box score fixes this, and no free source covers the earlier seasons.
   - The position classifiers were refitted on the larger pool (87.6% for DL, 78.1% for DB).
2. **Big East.** It keeps its automatic bid through 2012. The playoff explainer, the rules panel and the connector
   now say plainly that a Power 4 champion is in whatever its record. The check holds that wording in place.
3. **Raw archive, nightly.** `pipeline/cfb/mac_archive.sh` and `pipeline/cfb/com.wcehoops.cfb-mac-archive.plist`
   follow the College Basketball Savant pattern: the job runs the copy in the `savant-bot` worktree, which follows
   main.
   - It is installed in `~/Library/LaunchAgents` and loaded. It runs at 5:23am, pulls the season being played every
     night in season, and packs and verifies last month on the 1st.
   - Until this branch is merged it logs "not on main yet" and exits cleanly (a test trigger exited with status 0).
     Run from this worktree, the script itself pulled all 685 finals.

## All-Savant on phones (Adam, Nov 10 evening)

Below 640px the 1,100px field gives way to chips in the same formation:
- **Chips:** each one is a real button at least 44px tall. It shows a position badge (red for defense, navy for
  offense, purple for special teams), the last name and the Savant value. The OL unit is one wider chip. Each chip's
  aria-label carries the position, full name, school and value.
- **Bottom sheet:** tapping a chip opens it with the full card: headshot or initials badge, name, position and
  school, Savant value, rank at the position (for the OL, its rank among lines, from the team file), and a link to
  the full card. The close button, Escape and the backdrop each close it, and focus goes in and comes back to the
  chip.
- **Field / List toggle:** shown on phones only, next to the 1st/2nd/3rd buttons. List is the depth chart: one
  section per position group, full-width cards. The default is Field, and the choice is remembered per viewer in
  localStorage, with every read and write in try/catch.
- **Special teams:** a row of chips below the field.
- **Desktop:** unchanged. The view at 1440px is pixel-identical to the previous commit's.

`tools/savant-cfb/allsavant_phone.py` tests all of this at 375 and 390px (no sideways scroll, 23 chips on screen,
the sheet's three ways to close, the reload) and runs the desktop pixel comparison.

## What shipped

| piece | where |
|---|---|
| The page, version 1.0.0, in college football's own "Sticker Bomb" theme | `public/college-football-savant.html`, assembled from `tools/savant-cfb/page-src/` and `tools/themes/cfb/` |
| Data: 2,377 files, 23.8 MB, loaded on demand; largest file 0.44 MB | `public/cfb/` |
| Shared arithmetic: percentiles, pools, settle estimates, splits, comps, Savant value | `public/savant-cfb.js` (page and connector run the same copy) |
| Ten connector tools: `cfb_search_players`, `cfb_get_player_profile`, `cfb_player_career`, `cfb_player_splits`, `cfb_leaderboard`, `cfb_team_profile`, `cfb_team_rankings`, `cfb_game`, `cfb_all_savant_team`, `cfb_playoff_field` | `api/_cfb.js`, registered in `api/mcp.js` (server 3.6.0) |
| Daily cloud refresh, late August to the title game, plus a Sunday run; commits only on change | `.github/workflows/college-football-savant-refresh.yml`, `pipeline/cfb/cloud_run.sh` |
| Freshness alarm | `.github/workflows/college-football-savant-freshness.yml` (heartbeat `data/cfb-refresh.json`) |
| Pipeline | `pipeline/cfb/` (its README lists every module) |
| Entry points | Football dropdown in the ribbon, a home-page tile, SEO title and "What is" panel, `/college-football-savant` redirect, What's New, README |

### Seasons

2009 to 2012 and 2014 to 2026 are on the site. Two groups fail prompt 1's gates (`research/cfb/out/completeness.md`):

- **2013:** its play text names the sacker on only a third of sacks, so it passes for teams only.
- **2004 to 2008:** play-by-play exists for under 97% of their FBS games.

The page footer and the connector both say so.

2009 to 2012 have two limits of their own. Their rosters carry no positions, so each player's position comes from his
ESPN athlete record, which is a career listing (`identity.early_positions`). And their play text names no tacklers,
so tackles for loss, run stops and the disruption stats are "not tracked in 2010" and so on. Their defenders carry an
extra warning, and their defensive Savant value counts sacks, interceptions, break-ups and forced fumbles only.

### The 2026 refresh

The cloud holds no history. Everything the current season learns from finished seasons is fitted once and committed
in `pipeline/cfb/state/`:

- the kicker and punter models;
- the edge/interior and corner/safety classifiers;
- the rating prior, points scale and home edge;
- the simulator's rating spread;
- FBS membership and team colours;
- the expected-points and win-probability models;
- the headshot list.

Library versions are pinned to the Mac's.

## Every check and its result

| step | check | result |
|---|---|---|
| 1 | Registry covers every row of BACKTEST.md's verdict table | 68 player stats, 43 team stats; every verdict row mapped |
| 2 | Free space at least 8 GB throughout | never under 27 GB after Adam's cleanup (two disk-full stops earlier the same day; causes were macOS update staging, then the aerial wallpaper downloader) |
| 3 | 2021 and 2022 pass the 97% play-by-play gate | **2021: 98.96%, 2022: 98.20%** (20 and 22 games added from ESPN; all 42 rebuilt scores equal the official final) |
| 3 | Every 2026 FBS final present | 685 of 685 finals with an FBS team; plays, box and drives for all 685 |
| 4 | Within the CFBD call budget; ledger written; key never printed | **27 calls in all** (24 this run), meter at 437, College Basketball Savant's 400 floor untouched, nothing waiting for Dec 1 |
| 5 | Every match logged; hand fixes with a source | log in `~/College-Football-Savant/work/identity_log.csv`; `pipeline/cfb/manual/id_fixes.csv` holds 0 fixes; summary in `research/cfb/out/identity.md` |
| 6 | Borderline position list written | `research/cfb/out/review.md` (2026); prompt 1's in `positions_borderline.md`. Classifiers cross-validate at 87% (DL) and 79% (DB) |
| 7 | Power rating still within 0.5 of FPI | MAE 12.89 vs FPI 12.65 (gap 0.25) vs spread 12.34, unchanged after the backfill |
| 7 | Simulator calibration unchanged | Brier 0.0369 (was 0.0369); weighted gap 0.72 points (was 0.79); worst bin 7.5 points (was 6.6; see the review list) |
| 7 | Tiebreakers implemented | `pipeline/cfb/tiebreak.py`; tests from the rulebooks' own worked examples pass |
| 8 | No pool under 20 players (widen and label) | holds in every sampled season, position and pool (`check.mjs`) |
| 9 | Savant value matches prompt 1's | r = 0.9999 on 2025 (3,811 qualified players), before Adam's defender decision widened the pool |
| 9 | AP overlap reported, pre-2024 warning attached | 38% of matched AP All-Americans are on one of our three national teams (`research/cfb/out/review.md`); the warning is on every pre-2024 defensive pick, card and answer |
| 10 | Field obeys every rule; seeds and byes; Group of Six and Notre Dame rules tested | `python -m pipeline.cfb.playoff test` passes; `check.mjs` holds all 17 seasons' fields to every rule |
| 11 | No file over 15 MB | largest 0.44 MB |
| 12 | Every value matches the data files; desktop and phone; no JS errors; pools named; reduced motion | `tools/savant-cfb/shoot.py`: 16 views at 1440 px, 375 px, and 375 px with reduced motion. No JS errors, no horizontal scroll, no tap target under 40 px, no broken image, every bar panel names its pool, nothing rotated under reduced motion |
| 13 | New check passes; coverage map updated | `tools/savant-cfb/check.mjs` 16 of 16, comparing over 1,000 connector values with the page's math in 6 seasons; `coverage.json` updated |
| 13 | Connector size cap | upfront tool text 89,697 characters; cap raised from 82,000 to 90,000 with Adam's approval (noted in `tools/savant-mcp/check.mjs`) |
| 14 | A refresh is byte-identical to the full build | **144 of 144 files identical** (`python -m pipeline.cfb.refresh_check`: a clean room holding only ESPN's responses and the committed state, against the Mac's build) |
| 14 | One dry run on a GitHub runner | success (run 42917444476): 685 finals pulled, counts equal the Mac's; see "Dry run" |
| 15 | `check:seo` and `check:whats-new` pass | `check:whats-new` passes. `check:seo` fails one test, the existing failure on main (Basketball Coaching Savant's "What is" panel); College Football Savant passes that test. Adding a tenth product needed the homepage's product list raised from 9 to 10 |
| 16 | Backfill behind the same gates | 2009–2012 landed (players and teams, 2,686 to 2,929 graded players a season); 2013 and 2004–2008 dropped (reasons above) |
| — | `npm run check:savant` | 306 pass, 0 fail, 4 skipped |

### Dry run

GitHub run 42917444476 (push to this branch, `mode=dry`), Nov 10, 22:45 UTC: **success in 3.5 minutes**. A fresh
runner with an empty cache pulled all 685 finals from ESPN without being refused, and matched the Mac's counts:
74,340 scrimmage plays, 4,959 graded players, data through Nov 7, week 10. It then rebuilt the season's files.

5 of the 144 current-season files came out different from the committed build: `s/2026` and four team files. The
byte-identity test shows that identical inputs give identical bytes, so the likely cause is ESPN's responses being
fetched an hour apart (a roster or a stat correction). This was not confirmed: a dry run uploads nothing to compare.
The first scheduled run after merging will commit such changes, which is what a refresh is for.

The schedule itself starts only once the workflow is on main.

### npm run check:savant

310 tests: 306 pass, 0 fail, 4 skipped (the skips are existing tests that need live data). The new
`tools/savant-cfb/check.mjs` is part of it.

## The review list for Adam

The numbers are in `research/cfb/out/review.md` (`python -m pipeline.cfb.review`).

1. **Headshot coverage by conference.** 99% of 2026 graded players have an ESPN headshot; the lowest conference is the
   MAC at 97%. Before 2014 almost no one does. Everyone without one gets the initials badge.
2. **Position borderline list.** 25 players sit within 0.03 of the edge/interior or corner/safety line; the list is in
   `review.md`.
3. **2021–2022 gate results after the backfill.** 2021 is at 98.96% and 2022 at 98.20%; both pass. The 22 games still
   missing are partial at ESPN (fewer than 80 scrimmage plays).
4. **AP overlap per season, and the biggest disagreements.** 32% to 43% a season, 38% overall. About 1 in 9 AP
   All-Americans are still not graded. After Adam's decision the cause is the data, not the rule: before 2024 their
   schools' stat crews rarely named a tackler (decision 1 above). A few misses are name mismatches ("Ahmad" for
   "Sauce" Gardner).
5. **Retroactive fields that look surprising.** All 21 are in `review.md`. The ones to look at:
   - Wisconsin 2012 (9-5) and Duke 2025 (8-5) get in as conference champions.
   - The Big East champion takes a power bid through 2012 (West Virginia twice, Cincinnati).
   - Group of Six teams reach the 4 seed (TCU 2009 and 2010, Cincinnati 2021).
6. **Tiebreaker cases today.** Alabama's SEC title-game place rests on head-to-head with Kentucky. In the simulator, the
   Big Ten needs a tiebreaker in 83% of seasons, the Big 12 70%, the SEC 67% and the ACC 47%. Where a rulebook calls for
   SportSource's unpublished ranking, our power rating stands in and the seat is flagged as resting on an outside number.
7. **CFBD.** 27 calls in all, meter at 437, nothing waiting for Dec 1. The recruit file starts with the 2010 class, so
   2009 to 2011 players mostly have no recruit line. The 2005–2009 classes would cost 5 calls.
8. **Checks that needed a judgment call.**
   - The simulator's worst calibration bin moved from 6.6 to 7.5 points after the 2021–2022 backfill. Its overall
     fit is unchanged.
   - A receiver's opponent adjustment is charged on his own targets, not his team's dropbacks.
   - Before 2014 a player counts as a freshman by his first roster season. From 2014 his high-school class year must
     be known, because first-year players without a recruit record were junior-college transfers a quarter of the
     time.
   - Era power conferences for 2009–2012: the Pac-10, and the Big East through 2012. The WAC counts as Group of Six.
   - The early seasons use ESPN's career position, not the position that season.
   - Pass depth (for completion % over expected) is read from the play text, which carries it from 2025. It stays
     CONTEXT until it has a backtest.
   - The NFL link by name, college and rookie year now covers 2,421 players (2009–2012 added). Spot-check its precision
     before the Football Savant link is promoted.
9. **Trademark.** Check the use of "Savant" before heavy promotion. Baseball Savant is MLB's. This is a legal question,
   not answered here.
10. **Raw archive.** Nightly on launchd since Nov 10 (decision 3). November so far is 1,944 responses, 79 MB, all of
    which parse.

## Traps found while building

- ESPN sometimes sends `yardsToEndzone: 0` on an ordinary snap (218 in 2026, 25 of them in one game). `yardLine` is
  right, and the fix reads the direction off the team's other snaps.
- ESPN's running score is unreliable row by row. The score is rebuilt from the scoring summary and never allowed past
  the official final.
- A season's raw JSON is several GB in memory. Fetches are batched 24 games at a time; peak memory is 1.5 GB.
- The 2009–2012 rosters have no positions at all ("-" for every player).
- Two of four Power 4 tiebreak rulebooks are not confirmed for 2026 (Big Ten, Big 12). Look for their scenario releases
  in late November (`research/cfb/tiebreakers/TIEBREAKERS.md` section 8).
