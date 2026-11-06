# College Basketball Savant 1.4.0

1.4.0 ships with College Basketball Coaching Savant (branch `college-basketball-coaching-savant`, Nov 6, 2026). The
1.3.0 note follows it.

## What's new in 1.4.0

- **Head coach links.** A team page names its head coach of record and links to his College Basketball Coaching
  Savant page (`cbcs/links.json`).
- **After own timeouts** (Adam's decision, Nov 6). "After timeouts" counted the possession after either team's
  timeout although its label said the team's own. Now `rebuild.py` records who called the team timeout before each
  possession and whether ESPN logged the game's media timeouts, and the stat counts only the team's own timeouts,
  first action a shot or a turnover, garbage time out, games without logged media timeouts left out (where ESPN did
  not log them, the TV breaks come through as team timeouts). Renamed **After own timeouts**, the name College
  Basketball Coaching Savant uses for the same count; `check:savant-cbcoaching-shared` holds the two pages to one
  number and one name. A player's "Shots out of own timeouts" follows the same rule. The Data Room's
  `timeout_before` now reads `none`, `media`, `own` or `opponent`. In 2025-26, 19,288 possessions followed the team's
  own timeout and 8,433 the opponent's; Oklahoma goes from 1.171 on 82 possessions to 1.139 on 72. 2025-26 was
  re-run on the Mac (`season.py` into a scratch folder, then `context.py`): every other number in its 366 context
  files came out identical, so only the after-timeout fields and the `timeout_before` column were replaced. The
  season in progress follows on the next cloud refresh, which runs the new `rebuild.py`.
- **Rotation maps from the first game, labelled by sample.** The map has always kept every player with half a minute
  a game, so it is whole from game 1; it now says what it is based on ("Based on 3 games with clean lineups, through
  Nov 5. It updates after every game."), and a player's usual minutes ("on the floor in 3 games in 4") are named
  from 8 games (before that about two in five would not hold to the season's end, College Basketball Coaching
  Savant's measurement). A toggle shows the head coach's last season with a map, at whatever school he coached,
  with **Back** marking the players on this season's roster and the share of last season's minutes they played.
  The connector's `cbb_rotation` says "based on N games" and flags a map under 8 games.

Built overnight Nov 4-5, 2026 on branch `cbb-step1-context`: step one of making College Basketball Savant as deep as
Basketball Savant, using only what ESPN's play-by-play already gives us. The 1.2.0 note follows.

## What's new in 1.3.0

- **A possession log** in `rebuild.py`: one row per possession with how it began (after a made basket, a defensive
  rebound, a steal, a dead-ball turnover, made last free throws, a half's start), whether a team timeout or a media
  timeout came before its first action, its first action and when, its points, the margin and clock at its start, and
  both fives. It only records what the possession logic already decides: on 300 sampled 2025-26 games every existing
  output (player rows, team rows, stints, shots, gates) is byte-identical to the old code, the log has exactly one row
  per counted possession in all 600 team-games, and its points match the play-by-play's in 595 (the other 5 differ by
  1-3 points: free throws after a technical while the other team has the ball). "Start not logged" (where the feed
  missed how the previous possession ended) is 0.8% of possessions.
- **Each shot carries an estimated shot clock**: seconds since its possession began or since the last offensive
  rebound. The feed has no shot clock; every place that shows it says "estimated".
- **`context.py`** writes, per team-season, `cbb/ctx/<season>/<team>.json` (possession starts own and allowed with
  points, transition, after timeouts, clutch, the shot clock, 2-ft shot bins for the team, its opponents and each
  player, each player's clutch and after-timeout shooting and his clutch on-floor net, and the rotation map) and
  `cbb/ctx/<season>/league.json` (D1 baselines and every team's D1 rank). The Data Room gains
  `cbb/pos/<season>/<team>.json`, one row per possession. 2025-26 and 2026-27 have all of it; 2023-24 and 2024-25
  have rotation maps only (their stints are in `cbb-bundles`; their shots and possessions need `season.py` re-run on
  the Mac, where the CBBD lineup files live). `build.py` runs it for the merge season every night; a failure warns and
  leaves everything else.
- **Definitions.** Transition: a possession after a defensive rebound or a steal whose first shot, free throw or
  turnover comes within 8 seconds (rebuild.py's own transition window). After a timeout: run out of the team's own
  timeout (media timeouts are their own level), first action a shot or a turnover. Clutch: last 5 minutes, overtime
  included, within 5. Garbage time out of all of it. League baselines are D1 teams' own possessions.
- **Checks.** `context.mjs`: starts add up to possessions, team and league; bins to shots; players to team; every
  rotation map to 190-200 minutes a game; the connector to the files; rotation-only seasons say so. Oklahoma, Houston
  and Duke 2025-26 possessions and points equal `tg.pkl`'s non-garbage totals exactly.
- **Connector 3.5.0:** `cbb_play_context`, `cbb_shot_chart`, `cbb_rotation`; `cbb_player_splits` gains the shot
  clock and clutch; `cbb_data` gains the `possessions` table.

## Lineup history: no season before 2024-25 can be added

| Season | Lineup source | Games with clean lineups | Gate (court stats need about 80%) |
|---|---|---|---|
| 2025-26 | ESPN substitutions | 94.2% of D1 games | passes |
| 2024-25 | CBBD fives, ESPN subs from mid-February | 83.9% | passes |
| 2023-24 | CBBD fives | 52.9% | fails |
| 2022-23 and before | none (ESPN logged no substitutions; CBBD on-floor data starts 2023-24) | 0% | fails |

So on/off, lineups and RAPM stay 2024-25 on. 2023-24 gets a rotation map, which needs only the stints of the games
that pass (3,028), and says so.

# College Basketball Savant 1.2.0 (the 1.2 note)

Built Nov 2-3, 2026 on branch `college-savant-1.2`: the history back to 2002-03 that Adam asked for, of which two
seasons pass. The 1.1.0 and 1.0.0 notes follow below; value, the weight test, the AP check and every season's
teams are in `COLLEGE-ALL-SAVANT.md`.

## What's new in 1.2.0

- **2009-10 and 2010-11, box-score tier,** with All-Savant Teams. Gates 98.2% and 98.7% of 5,393 and 5,390 D1 games;
  ages for 79% and 82% of players. Players of the Year: Jon Scheyer (2009-10) and Kemba Walker (2010-11).
- **2011-12 and 2012-13 are not on the site** (gates 87.2% and 86.6%). Adam chose to ship the two passing seasons
  with the gap. Careers, the connector and the page skip them.
- **Nothing from 2002-03 to 2008-09 passes.** 2002-03 to 2005-06 were pulled from ESPN on Nov 2 (20,237 final games, none
  missing, 6 requests at a time, raw kept on the Mac). Gates by season are in `COLLEGE-ALL-SAVANT.md`. ESPN lists the
  players of the failing games with empty stats, the same today as in the archive. Before 2004-05 almost no game
  has a player box at all.
- **The value weights, refitted on 15 seasons** (5,318 team-seasons): held-out r 0.9055
  against team net rating (0.7757 for the first set). The weights barely moved from 1.1.0.
  AP overlap 94 of 226 names, 2009-10 to 2025-26.
- **AP check from 2009-10.** `ap_check.py` reads the older Wikipedia layout (teams by selector) for 2003 to 2008 too,
  ready for any season that later passes.

## Three negative results, recorded so nobody repeats them

1. **CBBD can't fill the missing box scores** (7 calls, Nov 2; `pipeline/college/cbbd_box.py`). Its `/games/players`
   has the same gaps as ESPN. 2008-09 shows the same players with the same lines (Stony Brook on Feb 27, 2009: the
   same 7 of 14 players, 42 of 57 points); 2012-13 has both teams for 22 of 321 failing games; 2002-03 has no
   player rows at all. Its rows are per team-game, so a 1,000-row reply holds about 480 games.
   `cbbd_box_plan.py` sizes the windows if a better source ever appears.
2. **T-Rank's files before 2022-23 have no birthdate column** (78 columns, the last a single digit; 2007-08 to 2021-22
   fetched once each, within ground rule 4). Refetching on Nov 9 won't help. Old ages come from CBBD rosters (which
   carry birthdates back to 2003), later seasons and Basketball Savant.
3. **The missing players can't be inferred.** ESPN still lists them, with empty stats, so the one-unknown rule from
   1.1 can't tell which man played, and these seasons have little or no play-by-play to name him.

## Found along the way

- `season.py` crashed on a season with no play-by-play at all (2004-05 and earlier); it now fills those columns empty.
- `team_fit.py`'s year-to-year test now skips pairs of seasons that aren't adjacent.
- **A namesake got a Draft card's honour.** The Draft Savant link matched schools by substring, so "texas" matched
  "northtexas", and Texas's Tristan Thompson (2010-11) showed a North Texas guard's All-Conference Savant. `links()` now
  takes an exact school first, and a partial one only when it's the sole candidate. `value.mjs` caught it.
- The Mac restarted at 11:56 PM on Nov 2 in the middle of the build; it was resumed from the site-file step.

---

# College Basketball Savant 1.1.0 (the 1.1 note)

Built Nov 2, 2026 on branch `college-savant-1.1`: history to 2013-14, schedule difficulty, and All-Savant Teams.
Value, the weight test, the All-America check and every season's teams are in `COLLEGE-ALL-SAVANT.md`. The 1.0.0
note follows below.

## What's new in 1.1.0

- **Seasons 2013-14 to 2021-22, box-score tier.** Player cards, schedule-adjusted percentiles, team ratings,
  leaders and compare. Shot zones, lineups, on/off and RAPM are "not tracked" in those seasons, on the card, in the
  explainers and in every `cbb_` answer (`tier: "box"`). 2006-07 to 2012-13 stay archived and off the site.
- **Quality splits** vs top-50, top-100 and NCAA tournament teams, by our own ratings. The field comes from the
  postseason games: 68 teams, except 2016-17 (66, ESPN lacks the two March 14 First Four games), 2020-21 (67, VCU's
  no-contest) and 2019-20 (none).
- **Adjustment confidence** on the card (Early, Firming, Firm), from games played and how linked a schedule is to
  the rest of D1 through non-conference games. Its error falls from 5.65 points at the fewest games to .52 at the most.
- **Schedule strength** in the player header: "Faced the 21st-toughest schedule among D1 guards".
- **All-Savant Teams** for every season, national 1st to 3rd, conference, All-Freshman and Player of the Year; honours
  on the card, career rows, player pages and Draft Savant prospect cards once final.
- **Connector:** `cbb_all_savant_team` (Adam approved it with the 1.1 request), and `cbb_get_player_profile` adds
  `savant_value`, `honours`, `schedule_strength`, `adjustment_confidence` and `quality_splits`. Same-name players
  resolve to the one who played that season, the better one if both did.
- **The check:** `tools/savant-cbb/value.mjs` holds the table, the JS math, the teams, honours, player pages, Draft
  Savant and the connector (by name, every national team player) to the Python. In `check:savant-cbb` and `check:savant`.

## The history gate

A box score and a matching final score on at least 98% of D1 games; games that miss are dropped. All nine pass.

| Season | D1 games | Strict | Recovered | Lines recovered | Ages | Tier |
|---|---|---|---|---|---|---|
| 2013-14 | 5,503 | 99.7% | 99.8% | 6 | 71% | box |
| 2014-15 | 5,495 | 99.6% | 99.6% | 0 | 54% | box |
| 2015-16 | 5,514 | 99.7% | 99.7% | 0 | 39% | box |
| 2016-17 | 5,520 | 99.0% | 99.6% | 31 | 28% | box |
| 2017-18 | 5,533 | 94.1% | 99.4% | 373 | 22% | box |
| 2018-19 | 5,600 | 86.6% | 98.0% | 1,056 | 26% | box |
| 2019-20 | 5,330 | 83.6% | 98.1% | 1,513 | 37% | box |
| 2020-21 | 3,948 | 84.8% | 98.1% | 1,107 | 55% | box |
| 2021-22 | 5,476 | 84.5% | 98.8% | 1,448 | 69% | box |
| 2022-23 | 5,715 | 86.1% | 99.0% | 903 | 99% | full |
| 2023-24 | 5,726 | 94.1% | 99.8% | 354 | 99% | full |
| 2024-25 | 5,764 | 99.8% | 99.8% | 0 | 99% | full |
| 2025-26 | 5,752 | 99.8% | 99.8% | 0 | 98% | full |
| 2026-27 | 8 | 100.0% | 100.0% | 0 | 60% | full |

ESPN has deleted some athlete records, leaving blank box rows, while its team totals and play-by-play still count
the player. `normalize.fill_missing` recovers them: one unknown shooter gets the team total minus everyone listed;
several get the play-by-play's lines, accepted only if the points add up exactly. Five box seasons, 2017-18 to
2021-22, pass only with it. **Cross-checked against CBBD's own player stats** in 2013-14, 2018-19 and 2021-22: r of .989
or more on all eleven stats tested (TS%, eFG%, usage, rebound share, FT rate, 3P%, FT%, minutes, points, rebounds,
assists), about 2,900 players a season. Three CBBD calls.

## Found along the way

- **Class was wrong on the live site since launch.** ESPN's season endpoint returns a player's latest class, not the
  class that season, so 2022-23 to 2024-25 showed today's class. `identity.py` now counts back from an anchor season.
  Checked on Wiggins, Young, Ayton, Brandon Miller, Braden Smith (Fr 2022-23, Sr 2025-26), Sheppard and Castle.
- **Ages in old seasons are thin.** T-Rank's 2013-14 to 2021-22 files had no birthdate this site could read, and
  ground rule 4 allows one fetch a week, so they weren't refetched. Ages there come from CBBD rosters, later seasons and
  Basketball Savant: 22-71% coverage (the Ages column above). Next allowed fetch: Nov 9. `torvik.py` now logs the
  last column's shape when nothing parses.
- **The value weights were refitted before launch** at Adam's request. See `COLLEGE-ALL-SAVANT.md`.

## Open items, 1.1.0

1. Old-season ages: refetch T-Rank's files from Nov 9 and see whether the birthdate column can be read.
2. Value loses to the old weights on next-season on/off (`COLLEGE-ALL-SAVANT.md`). Worth retesting once 2026-27 ends.
3. Zuby Ejiofor (St. John's) is a Wing by our positions, which puts him on the 1st team's wing slot.

---

# College Basketball Savant 1.0.0 (the launch note)

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
- **Cloud:** a no-commit dry run on main passed after the merge, with the new position code and bundle (run 41536881355, under
  2 minutes, 12 CBBD calls).
- **Not yet seen:** a scheduled refresh publishing to main. Until one lands, `data/cbb-refresh.json` does not exist, and the
  freshness alarm would fail on it.

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
| 2013-14 to 2021-22 (1.1.0) | Yes, box tier | Not tracked | Not tracked |
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
