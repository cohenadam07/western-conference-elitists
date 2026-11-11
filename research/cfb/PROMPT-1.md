# Prompt 1 of 2: College Football Savant data pull and stability backtest

*For Claude Code, opened in `/Users/adamcohen/western-conference-elitists`. The research behind it is the project doc `claude/college-football-savant-research.md`; paste that doc into the repo as `research/cfb/RESEARCH.md` first so this run can read it. This run builds no page and ships nothing. Its output is a report, and the full build prompt (prompt 2) is written from that report.*

---

You're starting **College Football Savant**, a new product on wcehoops.com: Baseball Savant-style profiles for every FBS player and team, in the style of College Basketball Savant. This first run does three things and nothing else: **pull the history, build WCE's own expected-points model, and backtest which stats are stable enough to deserve a percentile bar.** Read `research/cfb/RESEARCH.md` in full first, then the code this builds on:

- **Football Savant:** `pipeline/football/` (especially `seasons.py`, `build.py`, `pbp_agg.py`, and whatever computes settle points and Savant value), `.github/workflows/football-savant-refresh.yml`.
- **College Basketball Savant:** `pipeline/college/` (its ESPN adapter, `cbbd_source.py`, config registry, settle-point and opponent-adjustment code), `COLLEGE-BASKETBALL-SAVANT.md`.
- **Settle points on the NBA side:** `pipeline/basketball/settle_points.py`.

Start from main on a new branch: `git fetch origin && git switch -c cfb-savant-research origin/main` (use a worktree if the switch would touch local changes). **Don't merge.** Adam reviews.

## Ground rules

1. **Data correctness before anything else.** Before using any file or endpoint, fetch one real sample and print its columns or fields.
2. **No paid data, ever** (Adam's rule for this product).
3. **History comes from the sportsdataverse-data GitHub release files**, with no key and no quota: the ESPN-derived college football play-by-play (2004+), play participants, player and team box scores, drives, game rosters and betting lines. Also download the classic FBS EPA play-by-play (2014+) for comparison. Download with `gh release download` or plain HTTPS and cache under `~/College-Football-Savant/raw/`. **Raw files never go in git.**
4. **ESPN live check.** Pull the ESPN scoreboard (FBS group) for one 2025 Saturday and one 2026 Saturday, plus the summary and core play-by-play (with participants) for 5 games from each. Confirm the live feed carries the same participant roles as the release files. At most 6 requests in parallel; cache by event id.
5. **CollegeFootballData (CFBD).**
   - The key is probably the College Basketball Savant key in `~/.config/wce/cbbd.key` (same account). Never print, log or commit it.
   - Make **one** call to `api.collegefootballdata.com` and report the `X-CallLimit-Remaining` header, to confirm the key works and see what's left this month.
   - **This run may use at most 60 CFBD calls in total.** College Basketball Savant owns up to 600 of the shared 1,000 monthly calls. Count and log every call, and stop if the remaining count drops below 300.
   - Spend them only on what the backtest needs and the release files lack, about 51 calls: team talent by season 2014–2026 (13), teams with conference by season 2014–2026 (13), returning production 2015–2026 (12), and final rankings 2014–2025 for the committee comparison in step 14 (12), plus the one key check.
   - Recruiting, the portal and coaches are **not** pulled in this run; prompt 2 handles them. Transfers for the study come from roster team changes in the release files.
   - CFBD rows are inputs only (its terms forbid a mirror or substitute API).
6. **Off limits:** stats.ncaa.org, Sports-Reference, PFF, any paid source. Don't use the web-fetch tool to scrape sites during development.
7. **Long pulls run in the background.** Log to `~/College-Football-Savant/logs/`.
8. **Write nothing to `public/`, don't touch the connector, and don't add a workflow.** This run is research only.

## Steps (in order; every check must pass before its output is used; if one fails, find the cause, fix it and rerun)

| Step | What | Checks |
|---|---|---|
| 1 | **Inventory.** Download the release files for 2004–2025 and print each file's columns and row counts by season. | Every season present; columns printed |
| 2 | **Completeness by season.** For FBS-vs-FBS games, report: play-by-play present; final score matches the box; share of pass plays with a passer id and receiver id (when targeted); rush plays with a rusher id; sacks, interceptions, passes defensed, tackles for loss and forced fumbles with a defender id; tackler ids on ordinary plays; QB hurries. | A table by season. **Seasons with play-by-play under 97% of FBS games, or defender ids under 80% on sacks and interceptions, are flagged**, and their player stats are marked unusable for this study |
| 3 | **ESPN live check** (ground rule 4). | Participant roles and ids match the release format. Calls and latency logged |
| 4 | **CFBD calls** (ground rule 5). | ≤ 60 calls; the key never printed |
| 5 | **WCE's expected-points and win-probability models**, nflfastR-style, fit on 2014–2024 FBS plays. EP inputs: down, distance, yard line, seconds left in the half, score margin, home/away; outcome: the next score in the half. WP: score margin, time, possession, EP, pregame spread where available. | Calibrated by decile on held-out 2025 plays. Report correlation with the release files' EPA (expect high, not identical). Report the 2004–2013 vs 2014+ EPA level shift and whether it looks real or like a data artifact |
| 6 | **Garbage time.** Implement CFBD's documented margin-by-quarter rule (look it up in CFBD's methodology docs; it costs no API call) and a WP-based alternative. | Report the share of plays each flags; choose one and say why |
| 7 | **Team stability study, 2014–2025** (research §4). For every team stat listed there, offense and defense: split-half reliability (200 random odd/even-style splits, Spearman-Brown to a full season), games needed to reach 0.5 and 0.7, year-to-year correlation, and predictive value (stat through week N predicting margin in remaining games vs raw scoring margin, for N = 3 … 10). | Tables plus one chart per stat family. Each stat sorted into: full bar / hatched / CONTEXT / luck |
| 8 | **Opponent adjustment test.** Ridge-regression opponent adjustment of team offense and defense EPA and success rate, vs raw. | Adjusted must predict the remaining games better than raw; report by week |
| 9 | **Power rating backtest.** Build the rating in research §7 (opponent-adjusted EPA scaled to points, special teams, a preseason prior from last season + returning production + team talent, recency and home field tuned here). Predict every 2016–2025 game using only data available before it. | Mean absolute error vs the closing spread and vs ESPN FPI where available. **Must land within 0.5 points of FPI or beat it**; otherwise tune and report what moved it |
| 10 | **Player stability study, 2014–2025.** Every player stat in research §3 by position: split-half reliability, settle point (the sample where own number and the FBS prior carry equal weight, `settle_points.py`'s method), year-to-year correlation for players who stayed and for transfers separately, and whether the opponent-adjusted version predicts next season better than raw (transfers are the key test). Denominators are team plays, dropbacks, targets or rushes, since snaps don't exist. | Tables by position. Each stat sorted into: full bar / hatched / CONTEXT / dropped |
| 11 | **Positions.** Map ESPN roster positions to All-Savant slots (research §6). Split edge vs interior DL and CB vs S vs extra DB using stat profile where the roster says only "DL" or "DB". | Borderline list written for Adam's review |
| 12 | **Savant value.** Implement research §6 for every position, including the defender disruption value and the OL unit score. | Year-to-year correlation by position; distribution sanity check (no position dominating the top 50 unless that's real) |
| 13 | **Historical All-Savant dry run, 2014–2025.** National 1st/2nd/3rd teams, conference teams, Freshman team, Savant Heisman, in the AP shape with the OL as a unit. | Report overlap with the AP first team per season as a sanity check, not a target; list the five biggest disagreements per season with a one-line reason |
| 14 | **Résumé score and retroactive fields, 2014–2025.** Implement research §7: bubble-team strength of record (exact Poisson-binomial), the 2026 selection rules (Power 4 champions, highest-ranked Group of Six team with the champion requirement as a config switch defaulting off, Notre Dame if top 12, straight seeding, auto-qualifiers outside the top 12 placed at the bottom). Use actual conference champions for past seasons. | Our 12 for each season, with seeds. For Adam's eyes only, list where it differed from the committee's actual field (from CFBD rankings or a hand-entered table) |
| 15 | **Playoff odds simulator.** Monte Carlo of the rest of the season, conference title games and selection, 20,000 runs. Run it from each week of 2016–2025. | Calibration table: predicted field probability in deciles vs actual retroactive field rate |
| 16 | **Conference standings and tiebreakers.** For 2026, compare ESPN's standings order to each Power 4 conference's published tiebreakers for the current top three of each league. | Report whether ESPN's order can be trusted before title games |
| 17 | **Call budget.** Estimate the per-week ESPN calls and the monthly CFBD calls a live season needs. | CFBD ≤ 300 a month |
| 18 | **The report.** | None |

## The report: `research/cfb/BACKTEST.md`

Write it in plain language for Adam (non-technical, numbered, no jargon without a one-line definition):

1. What data exists, by season, and which seasons are usable for players vs teams only.
2. The EP model: calibration and how it compares with the release EPA and CFBD PPA.
3. **The stability verdict table:** every stat, its reliability, settle point, year-to-year correlation, and its verdict (full bar / hatched / CONTEXT / luck / dropped).
4. Power rating accuracy vs the closing spread and FPI.
5. Savant value stability by position, the position borderline list, and the historical All-Savant teams with their AP overlap.
6. The retroactive playoff fields, and the simulator's calibration.
7. Headshot coverage (HEAD-check the ESPN headshot URL for the 2026 rosters of 10 teams across conference tiers).
8. The call budget.
9. **Everything that needed a judgment call**, and every check that failed and what you did.
10. A recommended stat list for the player card and team page, by position, for prompt 2.

Commit the code and the report to the `cfb-savant-research` branch, push the branch, and report back with the report's summary section.
