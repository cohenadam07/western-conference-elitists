# College Basketball Savant 1.0.0

Built Nov 2, 2026 on branch `college-basketball-savant`. Adam reviewed it the same day; his decisions are in
the next section. Merged to main and live on wcehoops.com the same evening. Pipeline map: `pipeline/college/README.md`.

## Adam's decisions, Nov 2, and what changed

1. **Raw archive: private.** The monthly `cbb-raw-*` upload is gone, cron and step, and `archive.py` has no upload
   any more. The Mac keeps the raw files under `~/Basketball-Savant`, pulled every morning by `mac_pull.sh` and packed
   on the 1st. Nothing was ever uploaded. One thing beyond the ask: rung 2 pushed raw files to the public `cbb-data`
   branch if it ever fired, so they now travel encrypted, with `CBBD_API_KEY` as the passphrase since both ends
   already hold it. `check:savant-cbb` pins all of this.
2. **Positions: fixed.** Details under step 8 and below.
3. **Data checks: accepted.** Game-level exclusions for the final-score gate and 2024-25's stint minutes stand, and
   `COURT_MIN = 0.60` stays.
4. **RAPM: launched, labelled early.** "Early: pools 2024-25 onward and firms up as the season goes." On the
   card's Impact group and each RAPM row, the home leaders, all three explainers, and connector profile and
   leaderboard answers. `check:savant-cbb` pins it.
5. **Connector: approved.** All 11 tools and the 72,000-character upfront size.

## Launch, Nov 2

- **Merged:** `5765d2b6e`, with `cbb-bundles` pushed first so the cloud reads the new position scales.
- **All five checks passed before the merge and again before the fix below:** `check:savant` 208, `check:savant-cbb` 11,
  `check:savant-draft` 18, `check:whats-new` 9, `check:connector-coverage` 1.
- **A bug got through to live and was fixed within minutes.** Every lookup by name failed on the first deploy: profile, career,
  splits, team profile and lineups all returned an error, because `findPlayer` and `findTeam` misread what `topTier` returns.
  The check only ever called those tools by id, so it passed. Fixed in `dcffcb792`, and `check:savant-cbb` now asks by name
  wherever a tool takes one.
- **Confirmed live after the fix:** the page on desktop and phone with no page errors or side scroll, Cameron Boozer shown as a
  Big ("vs D1 bigs", 628 players) and AJ Dybantsa as a Wing, the RAPM label on the card and in connector answers, 61 connector
  tools with all 11 `cbb_` present, and name lookups answering on profile, career, splits, team profile, lineups, search,
  rankings and the dictionary.
- **Launchd:** `com.wcehoops.cbb-mac-pull` is loaded, 5:07am daily. The deployed script passed a dry run; the job itself has
  not run under launchd yet.
- **Nothing public:** no `cbb-raw-*` release exists and no `cbb-data` branch exists.
- **Not yet seen:** a scheduled cloud refresh on main. The workflow's first runs were the dry runs on the branch. Until one
  lands, `data/cbb-refresh.json` does not exist, and the freshness alarm would fail on it.

## What shipped

- **The page:** `public/college-basketball-savant.html`, Framed sheet as in the prototype. Home, player
  cards, team pages, all-teams table, leaders, compare. Collapsible sidebar (`[`), bottom tabs on phones.
- **The data:** `public/cbb/`, 26 MB in 1,585 gzipped files, largest about 1 MB (limit 15 MB).
- **Seasons on the site:** 2022-23 through 2026-27. 10,346 players, 41 stats, each with an explainer.
- **The connector:** 11 `cbb_` tools in `api/_cbb.js`. Math shared with the page in `public/savant-cbb.js`.
- **The check:** `tools/savant-cbb/check.mjs`, wired into `check:savant`.
- **The refresh:** `college-basketball-savant-cloud.yml` with a slate watcher, a freshness alarm, a private raw
  archive on the Mac, and rungs 0 to 4 of the fallback ladder.
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
- **Positions:** agreement with ESPN's listings **77.5% before, 80.8% after**. Shares match Basketball Savant's
  (40.7 / 34.1 / 25.2). Listed centers labelled Big: 85.7% to 97.9%.
  Score = 0.5 box + 0.3 height + 0.2 listed, in standard deviations, plus one rule: a forward or center 6'8" or taller who
  rebounds like a center (TRB% ≥ 15.2, the median of listed centers) is a big. That rule labels 1401 of the qualified
  seasons. The blend alone did not fix Boozer under any weighting: his 26% assist rate takes 0.92 off the estimate. The spec's
  team normalization is gone; it lowered agreement and pushed bigs down on tall rosters.
  Boozer is a Big and Dybantsa a Wing. **Worth a look:** Yaxel Lendeborg is a Wing in 2025-26 (Big the two years before) and
  Cooper Flagg a Big in 2024-25.
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
| 0 Archive | Pack and verify Nov 2026 | Pass. Private, on this Mac only |
| 1 ESPN cloud | Runner dry run | See step 15 |
| 2 Mac | Forced dry run, from the deployed copy | Pass, one encrypted file in one parentless commit, decrypts to every file, not pushed |
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
- `check:savant`: pass, 207 of 207, including `check:savant-cbb` 10 of 10.
- `check:connector-coverage`: pass. Upfront connector size raised from 63,000 to 72,000 characters, approved.
- `check:whats-new`: pass, 9 of 9.
- **`check:seo`: 5 of 6. Fails on `basketball-coaching-savant.html` only**, a panel-order failure already open on
  main. The new page passes. Left alone: it's another product's layout.
- `npm run lint`: fails on the bundled Flappy Hoops file only, as on main.

### Step 15: refresh

- **Merge-mode = full build:** byte-identical, 0 of 1,585 files differ, rechecked after the position change.
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

## The 20 most borderline players, 2025-26

Qualified players nearest a cut. Team is the ESPN team id. Full report: `~/Basketball-Savant/out/cbb/positions/report.json`.

| Player | Team | Height | Listed | Label | Between | Distance |
|---|---|---|---|---|---|---|
| Cam Morris III | 2193 | 6'8" | F | Wing | Wing/Big | 0.000 |
| Josiah Sanders | 38 | 6'5" | G | Guard | Guard/Wing | 0.000 |
| Adrian Wooley | 97 | 6'4" | G | Guard | Guard/Wing | 0.001 |
| Jackson Hicke | 163 | 6'5" | G | Wing | Guard/Wing | 0.001 |
| Ernest Shelton | 2771 | 6'5" | G | Wing | Guard/Wing | 0.001 |
| Kaidon Rayfield | 2636 | 6'8" | F | Wing | Wing/Big | 0.001 |
| Maguire Mitchell | 85 | 6'5" | G | Wing | Guard/Wing | 0.001 |
| Nic Codie | 251 | 6'8" | F | Wing | Wing/Big | 0.002 |
| John Squire | 160 | 6'8" | F | Wing | Wing/Big | 0.002 |
| Nelson Lamizana | 2154 | 6'9" | F | Big | Wing/Big | 0.003 |
| Jalen Kampen | 2117 | 6'4" | G | Wing | Guard/Wing | 0.003 |
| Abdou Yadd | 2529 | 6'9" | F | Big | Wing/Big | 0.003 |
| Zion Obanla | 2379 | 6'8" | G | Wing | Wing/Big | 0.003 |
| Kur Teng | 127 | 6'5" | G | Wing | Guard/Wing | 0.003 |
| Lukas Walls | 2515 | 6'5" | G | Guard | Guard/Wing | 0.003 |
| Keishon Porter | 339 | 6'5" | G | Guard | Guard/Wing | 0.003 |
| Dasear Haskins | 2603 | 6'8" | F | Wing | Wing/Big | 0.004 |
| Amar Augillard | 270 | 6'5" | G | Wing | Guard/Wing | 0.004 |
| Jaden Daughtry | 2368 | 6'7" | F | Wing | Wing/Big | 0.004 |
| J.R. Leonard | 56 | 6'4" | G | Guard | Guard/Wing | 0.004 |

## Open items

1. Lendeborg and Flagg, above.
2. `check:seo` fails on `basketball-coaching-savant.html` only, and `npm run lint` on the bundled Flappy Hoops file only.
3. 2026-27 ages come from the Monday step, because T-Rank refuses GitHub's runners (403). Its file has only 99 rows so far, so
   same-age coverage for 2026-27 is 58.6% today and rises as the file fills.
4. Headshots: 97% of players overall (98.5-99.6% high-major, 97.3-98.8% elsewhere), far above the 66% in the spec's test. A sample
   of 300 was checked: real, unique photos. The rest show initials.
5. Birthdates: the main source is T-Rank's file. If it went away, same-age pools would lose most coverage.
6. NET: only 2025-26's final table could be read, 359 of 365 teams. Quads are "not tracked" for older seasons, and 2026-27 starts
   when NET publishes.
7. Lines: ESPN for 2022-23 and 2025-26, CBBD for 2023-24 and 2024-25.
8. CBBD portal rows were not used: transfers come from team changes in our own game tables.
9. Non-D1 games are in the game log and in no rate.
10. Trademark check on "Savant" before heavy promotion.
