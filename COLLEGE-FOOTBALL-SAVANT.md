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
| 9 | Savant value matches prompt 1's | r = 0.9999 on 2025 (3,811 qualified players) |
| 9 | AP overlap reported, pre-2024 warning attached | 38% of matched AP All-Americans are on one of our three national teams (`research/cfb/out/review.md`); the warning is on every pre-2024 defensive pick, card and answer |
| 10 | Field obeys every rule; seeds and byes; Group of Six and Notre Dame rules tested | `python -m pipeline.cfb.playoff test` passes; `check.mjs` holds all 17 seasons' fields to every rule |
| 11 | No file over 15 MB | largest 0.44 MB |
| 12 | Every value matches the data files; desktop and phone; no JS errors; pools named; reduced motion | `tools/savant-cfb/shoot.py`: 16 views at 1440 px, 375 px, and 375 px with reduced motion. No JS errors, no horizontal scroll, no tap target under 40 px, no broken image, every bar panel names its pool, nothing rotated under reduced motion |
| 13 | New check passes; coverage map updated | `tools/savant-cfb/check.mjs` 16 of 16, comparing over 1,000 connector values with the page's math in 6 seasons; `coverage.json` updated |
| 13 | Connector size cap | upfront tool text 89,697 characters; cap raised from 82,000 to 90,000 with Adam's approval (noted in `tools/savant-mcp/check.mjs`) |
| 14 | A refresh is byte-identical to the full build | **144 of 144 files identical** (`python -m pipeline.cfb.refresh_check`: a clean room holding only ESPN's responses and the committed state, against the Mac's build) |
| 14 | One dry run on a GitHub runner | see "Dry run" below |
| 15 | `check:seo` and `check:whats-new` pass | `check:whats-new` passes. `check:seo` fails one test, the existing failure on main (Basketball Coaching Savant's "What is" panel); College Football Savant passes that test. Adding a tenth product needed the homepage's product list raised from 9 to 10 |
| 16 | Backfill behind the same gates | 2009–2012 landed (players and teams, 2,686 to 2,929 graded players a season); 2013 and 2004–2008 dropped (reasons above) |
| — | `npm run check:savant` | 306 pass, 0 fail, 4 skipped |

### Dry run

Pending; this section is updated after the run.

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
   All-Americans are not graded at all, chiefly lockdown corners and run-stuffing tackles (Okudah, Surtain, Jordan
   Davis). Prompt 1's rule keeps only defenders with at least 5 credited plays, and a corner who is never thrown at
   makes few. Some misses are name mismatches ("Ahmad" for "Sauce" Gardner). Decide whether that rule stays.
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
10. **Raw archive schedule.** `python -m pipeline.cfb.archive pull` (weekly) and `pack` (on the 1st) are written and
    tested; November is 1,944 responses, 79 MB, all of which parse. They are not yet on a launchd schedule: adding one
    is a standing change to the Mac and waits for a yes.

## Traps found while building

- ESPN sometimes sends `yardsToEndzone: 0` on an ordinary snap (218 in 2026, 25 of them in one game). `yardLine` is
  right, and the fix reads the direction off the team's other snaps.
- ESPN's running score is unreliable row by row. The score is rebuilt from the scoring summary and never allowed past
  the official final.
- A season's raw JSON is several GB in memory. Fetches are batched 24 games at a time; peak memory is 1.5 GB.
- The 2009–2012 rosters have no positions at all ("-" for every player).
- Two of four Power 4 tiebreak rulebooks are not confirmed for 2026 (Big Ten, Big 12). Look for their scenario releases
  in late November (`research/cfb/tiebreakers/TIEBREAKERS.md` section 8).
