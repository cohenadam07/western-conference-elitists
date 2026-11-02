# College Basketball Savant 1.0.0

Built Nov 2, 2026 on branch `college-basketball-savant`, not merged. Connector changes need Adam's
approval. Pipeline map: `pipeline/college/README.md`.

## What shipped

- **The page:** `public/college-basketball-savant.html`, Framed sheet as in the prototype. Home, player
  cards, team pages, all-teams table, leaders, compare. Collapsible sidebar (`[`), bottom tabs on phones.
- **The data:** `public/cbb/`, 26 MB in 1,585 gzipped files, largest about 1 MB (limit 15 MB).
- **Seasons on the site:** 2022-23 through 2026-27. 10,346 players, 41 stats, each with an explainer.
- **The connector:** 11 `cbb_` tools in `api/_cbb.js`. Math shared with the page in `public/savant-cbb.js`.
- **The check:** `tools/savant-cbb/check.mjs`, wired into `check:savant`.
- **The refresh:** `college-basketball-savant-cloud.yml` with a slate watcher, a freshness alarm, a monthly
  raw archive, and rungs 0 to 4 of the fallback ladder.
- **Draft Savant 1.1.0:** cross-links both ways, and `draft_cbb.py` for the 2027 class on. It replaces
  nothing yet: Draft Savant has no 2027 class.
- **Entry points:** nav, home card, AI connector list, SEO, sitemap, player pages, What's New, Control Room.

## What each season has

| Season | Box and card stats | Shot zones | On/off, lineups, RAPM |
|---|---|---|---|
| 2022-23 | Yes | Yes (CBBD locations, 93%) | No lineup data exists |
| 2023-24 | Yes | Yes (CBBD locations, 94%) | **Dropped: failed the gate** |
| 2024-25 | Yes | Yes (99%) | Yes, 84% of D1 games |
| 2025-26 | Yes | Yes (100%) | Yes, 94% of D1 games |
| 2026-27 | Live | Yes | Yes |

The spec expected RAPM to pool four seasons. It pools two plus the current one. Measured Nov 2, ESPN logged
**no substitutions before mid-February 2025** and coordinates on only 10-20% of games, so ESPN alone would
have left one and a half seasons. CBBD's on-floor data rescued 2024-25 (4,055 games) and its locations
rescued shot zones for all three older seasons, about 390 calls.

## Every check and its result

Raw means every game; filtered means after the game-level exclusion in §5.

### Step 3: game pull

| | 2022-23 | 2023-24 | 2024-25 | 2025-26 | Gate |
|---|---|---|---|---|---|
| Play-by-play on D1 games | 98.5% | 98.57% | 98.06% | 99.79% | ≥ 98%: **pass** |
| Final score matches, raw | 98.61% | 98.58% | 99.04% | 99.93% | ≥ 99.5%: **three seasons miss raw** |
| Coordinates, on games used | 93.4% | 94.3% | 99.0% | 100% | Reported |

Games that miss the score are excluded from everything built on play-by-play, so what ships is 100% on this.
Judgment call, below.

### Step 4: rebuild

| | 2022-23 | 2023-24 | 2024-25 | 2025-26 | Gate |
|---|---|---|---|---|---|
| Box = play-by-play, raw | 95.5% | 98.7% | 98.95% | 99.43% | ≥ 99% |
| Box = play-by-play, filtered | **97.6%: FAIL** | 99.18% | 99.45% | 99.7% | ≥ 99% |
| Five on the floor, team-games | none | 99.3% | 99.5% | 99.6% | ≥ 95%: pass |
| Stint within 1 min of box, raw | none | **83.95%: FAIL** | 94.86%: narrow miss | 98.3% | ≥ 95% |
| Stint within 1 min, filtered | none | 95.7% (52% of games) | 97.4% (84%) | 99.1% (94%) | ≥ 95% |
| Team minutes 200 + 25 per OT | none | 99.9% | 100% | 99.97% | pass |
| Team-seasons within 2% of formula | 89.3% | 94.5% | 97.3% | 95.1% | Reported |

- **2022-23 fails the box gate,** so §3 applies: it keeps its card stats. It has no lineups to drop.
- **2023-24 fails the minutes gate,** so §3 applies: on/off, lineups and RAPM are gone from the site, and it
  is out of the RAPM pool. Adding its clean half was tested anyway: held-out RMSE 83.236 against 83.239.
- **Possessions:** "within 2%" is scored per team-season. One game's count moves 1.4% per possession, so a
  per-game bound can't hold (about 49% of team-games).

### Step 5: identity

| | 2022-23 | 2023-24 | 2024-25 | 2025-26 | 2026-27 |
|---|---|---|---|---|---|
| Players | 5,042 | 5,035 | 5,116 | 5,023 | 203 |
| With an age | 97.4% | 97.9% | 97.9% | 97.7% | 58.6% |

- Coverage is even across tiers: 98.1-99.3% high-major, 98.1-98.5% elsewhere, among players with D1 games.
- Ages outside 16-27: 2 men (Carson Brown, Corey Sands), left with no age.
- ESPN college id = NBA id spot check: 219 of 219 linked players in the NBA file have the same name.

### Step 6: against CBBD, 2025-26, 3,111 qualified players

All r ≥ .998 (TS, eFG, usage, FT rate, 3P%, FT%, minutes, points, rebounds, assists). Means match to the
decimal. Two gaps explained: TS% runs 0.6 lower because we use 0.475 FTA and CBBD uses 0.44, and CBBD's
`offensiveReboundPct` is the offensive share of a player's own rebounds (r = .9992), not OREB%.

### Step 7: team ratings, walk-forward from Dec 1

| | Games | Ours | BPI | Closing spread |
|---|---|---|---|---|
| 2023-24 | 4,241 | 9.10 | 9.04 | 8.81 |
| 2024-25 | 4,149 | 8.86 | 8.74 | 8.57 |
| 2025-26 | 4,496 | 9.06 | 8.97 | 8.81 |

Within 0.5 of BPI in every season: **pass.** Market rating built for all four seasons.

### Step 8

- **Opponent adjustment:** 491 players who changed levels. RMSE relative to raw: regression .9676,
  multiplicative .9701. **The regression wins** and beats raw. `mid_fg`, `pnt_fg` and `tov` did not beat raw on
  their own, so they stay raw.
- **Positions:** 77.5% agreement with ESPN's listings, cut points 2.913 and 3.411 to match Basketball Savant's
  shares (41/34/25). See the review list.
- **Settle points:** 26 stats measured. 3P% needs 596 attempts, FT% 32, three-point rate 6. Year-to-year 3P% came
  out at .17 and attempt rate at .77, against the research doc's .29 and .73.

### Step 9

- **xFG:** log-loss .6447 against .6538 distance-only, worst decile off by .011 on 2025-26, .007 on 2023-24,
  .009 on 2022-23. Trained on ESPN-located shots only: training on CBBD-located ones ran the top decile
  .048 hot. Arena terms: .64 home-road at the rim, .11 elsewhere, so only the rim term is applied.
- **Box impact:** R² .43 offense, .11 defense. Year-to-year r .48.
- **RAPM:** held-out RMSE 83.239, raw on/off 83.309, box impact alone 83.360: **pass.** Year-to-year r .82,
  inflated by overlapping pools. λ 2,500. Rebuilds in under a minute, so it runs nightly.
- **Measured, not assumed:** transition window 8 seconds, corner line ends at y = 8, lineup shrinkage 800 for
  fives and 1,800 for pairs. Threes and fours interpolated.

### Step 10: pools

Qualified players per finished season: 2,666-2,740 (guards 1,132-1,181, wings 875-998, bigs 572-624, high-major
555-596). Conference pools run 7-139 and same-age pools 20-1,173. Any pool under 20 widens and says so.

### Step 11: fallback ladder

| Rung | Test | Result |
|---|---|---|
| 0 Archive | Pack and verify Nov 2026 | Pass. **No upload yet**, see review list |
| 1 ESPN cloud | Runner dry run | See step 15 |
| 2 Mac | Forced dry run | Pass, 13 files in one parentless commit, not pushed |
| 3 CBBD | Two dates vs ESPN, 231 games | Scores 99.6%, shooters 99.8%, coordinates within 2 ft 98-99.9%, bias .05 ft, fives exact on 77% of plays (timing around stoppages) |
| 4 NCAA.com | Two dates, 80 games | FGA ratio 1.00, scores 90%, FGA lines 87.5%, names 80%. Thin: last resort only |

Rung 3 uses about 30 calls a month if ever needed. NCAA.com's daily count matched ESPN's D1 count within one game.

### Step 12: the page

Every value comes through `savant-cbb.js`. Chromium at 1440 and 390 across seven views: no JS errors from the
page (the `_vercel/insights` error is local-server only), no horizontal page scroll, sheet full width on phones,
every percentile names its pool. A few inline text links remain under 40px tall on phones.

Impeccable: footer line length fixed. Two `nested-cards` flags left: they are the Framed sheet Adam chose.
Taste Skill's app-screen rules were used as guidance; its scripts were not run.

### Steps 13, 14, 16

- `check:savant-draft`: pass, 18 of 18.
- `check:savant`: pass, 205 of 205, including `check:savant-cbb` 8 of 8.
- `check:connector-coverage`: pass. Upfront connector size raised from 63,000 to 72,000 characters.
- `check:whats-new`: pass, 9 of 9.
- **`check:seo`: 5 of 6. Fails on `basketball-coaching-savant.html` only**, a panel-order failure already open on
  main. The new page passes. Left alone: it's another product's layout.
- `npm run lint`: fails on the bundled Flappy Hoops file only, as on main.

### Step 15: refresh

- **Merge-mode = full build:** byte-identical, 0 of 1,585 files differ, same checksum.
- **Runner dry run:** pass. A whole refresh on a GitHub runner in 2m 22s, ESPN reachable, nothing committed (run 41524412598). The first try failed on a missing folder and on T-Rank's 403; both fixed.
- **Heads up:** every nightly refresh rewrites all 100 `p/` shards, because comps are scaled across seasons. The bot's commits ship through the deploy batch, so this costs repo size, not deploys.

### Step 17: backfill

All 16 seasons are in the raw archive (2.9 GB in all). **None joins the site.** None reaches 98% play-by-play.

| Seasons | Play-by-play | Coordinates | Note |
|---|---|---|---|
| 2013-14 to 2021-22 | 88-98% | 15-27% | Box gate 96.5-99.4% |
| 2006-07 to 2012-13 | 32-68% | 0% | Almost nothing passes `pbp_ok` |

hoopR-mbb-data is ESPN-derived with the same fields, so direct ESPN pulls were used: they archive the raw
response and need no second parser. Coordinates before 2022-23 would need CBBD at about 150 calls a season.
These seasons carry box scores, which is what Draft Savant 2.0 needs most.

### Budgets

CBBD: 460+ calls this month, under the 600 cap. About 25 were wasted by an accidental second copy of the history
pull. One day failed and was not retried: Mar 5, 2023, so those games have no shot locations.
Torvik: the one URL, 10 seconds apart, not repeated within a week.

## Review list for Adam

**Decide before merging**

1. **The repo is public, so `cbb-raw-*` release assets would be public downloads of ESPN's raw JSON.** The workflow
   does this on the 1st of each month once merged. If that's not what you want, remove the `53 11 1 * *` cron or
   move the archive somewhere private. Nothing has been uploaded.
2. **Position labels.** Cameron Boozer comes out a Wing and AJ Dybantsa a Guard: BPM's estimate follows passing and
   steals, then each team is normalized to 3.0, so a roster's big men can slide. Borderline list:
   `~/Basketball-Savant/out/cbb/positions/report.json`. A height floor is one option; I left the spec's rule as written.
3. **Three seasons miss the raw final-score gate** (98.6-99.0% against 99.5%). I treated that as a game-level exclusion
   under §5, not a season failure under §3. A strict reading would drop 2024-25's lineups too.
4. **2024-25's stint minutes** are 94.86% raw, just under 95%, and 97.4% after the filter. Same call.
5. **`COURT_MIN = 0.60`,** the share of clean games a season needs to show lineups. My judgment, between 2023-24 (51%) and
   2024-25 (84%).
6. **Connector:** 11 new tools and the larger upfront size need your approval, as always.

**After merging**

7. Load `pipeline/college/com.wcehoops.cbb-mac-pull.plist` on the Mac. It runs rung 2 and Monday's ages.
8. 2026-27 ages come from that Monday step, because T-Rank refuses GitHub's runners (403). Its file has only 99 rows so
   far, so same-age coverage for 2026-27 is 58.6% today and rises as the file fills.

**For the record**

9. Headshots: 97% of players overall (98.5-99.6% high-major, 97.3-98.8% elsewhere), far above the 66% in the spec's
   test. Sample of 300 confirmed real, unique photos. The rest show initials.
10. Birthdates: main source is T-Rank's file. If it went away, same-age pools would lose most coverage.
11. NET: only 2025-26's final table could be read, 359 of 365 teams. Quads are "not tracked" for older seasons, and
    2026-27 starts when NET publishes.
12. Lines: ESPN for 2022-23 and 2025-26, CBBD for 2023-24 and 2024-25.
13. CBBD portal rows were not used: transfers come from team changes in our own game tables.
14. Non-D1 games are in the game log and in no rate.
15. Trademark check on "Savant" before heavy promotion.
