# Prompt 2 of 2: build College Football Savant 1.0.0

*For Claude Code (Fable 5.2, effort high), opened in `/Users/adamcohen/western-conference-elitists`. Inputs on this Mac:*
- *`~/College-Football-Savant/RESEARCH.md`: the research doc*
- *`~/College-Football-Savant/BUILD.md`: this prompt*
- *`~/College-Football-Savant/design/`: the three mockup sources (`Main.dc.html` player card, `Playoff.dc.html`, `AllSavant.dc.html`)*
- *The `cfb-savant-research` branch: `pipeline/cfb/` and `research/cfb/BACKTEST.md` with its tables in `research/cfb/out/`*

---

You're building **College Football Savant**: Baseball Savant-style profiles for every FBS player and team, an All-Savant team set, and an objective playoff field, refreshing itself through the season. Prompt 1 already pulled the history, built WCE's expected-points model and power rating, and ran the stability backtest. **Read these before writing any code:**
1. `~/College-Football-Savant/RESEARCH.md`, in full.
2. `research/cfb/BACKTEST.md` on the `cfb-savant-research` branch, in full. Its verdict table decides which stats get bars.
3. This prompt, in full.

Then read the code it builds on, so the new code follows its conventions:
- `pipeline/cfb/` (prompt 1's code: build on it, don't rewrite it).
- College Basketball Savant: `pipeline/college/`, `public/college-basketball-savant.html`, `api/` connector files for `cbb_`, `tools/savant-cbb/`, `COLLEGE-BASKETBALL-SAVANT.md`.
- Football Savant: `pipeline/football/`, `.github/workflows/football-savant-refresh.yml`, the NFL All-Savant code.
- The connector: `api/mcp.js`, `api/_core.js`, `tools/savant-mcp/` (including `coverage.mjs`).
- The site ribbon, `README.md`, `PLAYER-PAGES.md`, `SEARCH.md`, `CHANGES.md`, `src/data/updates.json`.
- The house-style skill at `.claude/skills/wce-house-style/SKILL.md`. Load it before any page work.

**Branch.** Create a worktree so Adam's main checkout is untouched:
```
git fetch origin && git worktree add .claude/worktrees/cfb-build -b college-football-savant origin/cfb-savant-research
```
Then rebase onto `origin/main` and fix any conflicts. **Don't merge.** Adam reviews and merges. Connector changes need his approval before merging (standing rule).

Adam decided on **one full launch, built in one run** in the order of §9. Don't stop for approval between steps. Every check listed for a step must pass before that step's output is used. If one fails, find the cause, fix it and rerun. Never ship a number that failed a check.

## Ground rules

1. **Data correctness before UI.** Print one real sample from every new source before wiring it.
2. **Disk.** The Mac has about 30 GB free and filled up twice in prompt 1.
   - Check free space before every large download and stop if it would drop below 8 GB.
   - Raw files live under `~/College-Football-Savant/raw/` and never go in git.
   - Delete a raw file only once its derived output is written and checked. `pipeline/cfb/pull_releases.sh` re-downloads what was deleted.
3. **Free data only** (Adam's rule).
4. **ESPN** is the primary feed for the live season and for the 2021–2022 backfill. At most 6 requests in parallel. Cache every final by event id.
5. **CollegeFootballData (CFBD).** The key is `~/.config/wce/cbbd.key`, shared with College Basketball Savant. Never print, log or commit it.
   - **College football's budget is 300 calls a month.** Count every call in a ledger file and log it. Before every call, read `X-CallLimit-Remaining` and stop if it would drop below 100.
   - College Basketball Savant stops itself at 400 left; don't change its guard.
   - In this run, spend calls only on what the release files lack: recruiting by class year, the transfer portal (2021+), coaches, conference membership by season, and, if prompt 1's talent table is kept, nothing else. Target ≤ 80 calls in this run. If the meter is too low, build everything else, list what's waiting, and write a one-shot script Adam can run after the Dec 1 reset.
   - CFBD rows are inputs only. Its terms forbid a mirror or substitute API, so its rows never appear raw on the page or through the connector.
6. **AP All-America lists (internal only).** Adam approved fetching the AP lists for 2014–2025 from news coverage, for the sanity check only. Store them in `research/cfb/ap/` with each source URL. AP picks never appear on the page or through the connector.
7. **Off limits:** stats.ncaa.org, Sports-Reference, PFF, and any paid source.
8. **Long pulls run in the background.** Log to `~/College-Football-Savant/logs/`. Don't run them while Basketball Savant's Mac jobs hold `~/Basketball-Savant/logs/.publish.lock`.
9. **Follow existing conventions.**
   - Every stat has a settle point and an explainer: what it is, formula, source, sample.
   - Every percentile names its pool.
   - Bars are thick, filled to the percentile, blue → red, with the number on the bar.
   - Bars below the settle point are hatched, with a diamond where the stat is likely to settle.
   - CONTEXT rows are labeled.
   - "Not tracked" is kept apart from zero.
   - No horizontal page scroll on phones.
10. **At the end:**
    - Run `npm run check:savant` plus the new check.
    - Test every view in a browser at desktop and phone width.
    - Write `COLLEGE-FOOTBALL-SAVANT.md` at the repo root: what shipped, every check and its result, file sizes, and the §10 review list.
    - Commit, push the branch, and report back with that summary.

---

## 1. Decisions (Adam, Nov 10)

1. **FBS only**, 2014–2026 at launch.
   - 2004–2013 backfill after launch, in the background, behind the same data gates.
   - 2021–2022 player stats: backfill the missing games from ESPN until they pass the 97% play-by-play gate. Until then they're flagged.
2. **Default pool:** opponent-adjusted, position-adjusted, FBS at his position, same season. Alternates: raw, Power 4 only, same conference. Percentiles are computed within each season only, never pooled across eras.
3. **Stats on the card come from BACKTEST.md's verdict table.** In particular:
   - Every RB rate is hatched.
   - **Receivers are valued per team dropback.** EPA per target and catch rate are CONTEXT, not bars.
   - Interception rate, forced fumbles and field-goal accuracy are CONTEXT ("mostly noise in one season").
   - Turnovers and fumble recoveries are labeled "luck".
4. **All-Savant**, in the AP shape with the offensive line as one unit:
   - Sets: national 1st, 2nd and 3rd teams; one team per FBS conference (membership by season); a Freshman team (including redshirt freshmen).
   - **Savant Heisman:** pure Savant value, which will usually be a QB.
   - **Non-QB Player of the Year:** the highest Savant value among non-QBs.
   - Pure individual value, no team-success credit. Missed games and small roles cost value.
   - **Pre-2024 defense:** publish it, with this warning on every defensive pick and team for 2014–2023: "Defensive picks before 2024 depend on how fully each school's stat crew logged tackles and pass break-ups, so they aren't comparable across schools."
   - A player who finishes a season on an All-Savant team carries the accolade on his card. Before the final week the teams are a standing, labeled "as of week N".
5. **The objective playoff field:**
   - Seed by résumé score: the bubble-team strength of record, where the benchmark is the 12th-best team by our power rating.
   - Show our power rating beside it.
   - 2026 rules:
     - The ACC, Big Ten, Big 12 and SEC champions get bids.
     - The highest-ranked team from the American, Conference USA, MAC, Mountain West, Pac-12 or Sun Belt gets a bid. A config switch for "must be a champion" defaults off.
     - Notre Dame gets a bid if it ranks in the top 12.
     - Seeding is straight. Seeds 1–4 get byes. Auto-qualifiers ranked outside the top 12 go at the bottom.
   - **The Pac-12 champion gets a Power-conference automatic bid through 2023.**
   - Before title games are played, the current conference leader holds the champion's spot. Use ESPN for records only. Implement each Power 4 conference's published tiebreakers yourself, and flag any team whose spot depends on a tiebreaker.
   - **Ours only:** no committee rankings anywhere on the page.
   - The section shows the "if the season ended today" bracket on top, then playoff odds per team: make the field, bye, conference title, host a first-round game. Odds come from 20,000 simulated seasons.
   - **Past seasons (2014–2025) show their objective field as history.**
6. **Recruiting and portal on the card:** stars and rank from CFBD's composite, and school history with transfers marked ("4★ recruit · transferred from X in 2025"). Show a team talent column. Never republish 247Sports, On3 or ESPN ratings directly.
7. **Coaches** are stored from day one (head coach per team-season) for a future College Football Coaching Savant. Shown only as a plain line on team pages.
8. **Theme: Sticker Bomb**, built to the mockups in `~/College-Football-Savant/design/`. These are Design-canvas sources, so treat them as reference for layout, components, copy and tokens. Don't ship their runtime. Their players, schools and numbers are invented, and none of them ship.
   - **Headline font: Anton.** Body is IBM Plex Sans, labels and numbers IBM Plex Mono.
   - Tokens:
     - Field navy `#0B1730`, deep navy `#060E1F`, panel `#101F3E`, panel border `#33476E`.
     - Electric-blue banner `#2E8FE8` with a white keyline. Sticker yellow `#FFD25A`.
     - White sticker cards with a 4–6 px white border and a hard shadow `#030914`. Slight rotation on headline stickers and portrait cards only, never on tables or percentile panels. No rotation under `prefers-reduced-motion`.
     - WCE gold rule `#C2A263`, red `#BC3A2C`.
     - Percentile scale `#1C4E86` → `#C2C0B6` → `#BC3A2C`.
   - The background texture is the faint diagonal repeat of the product name plus abstract team-color chips. **Never a collage of school logos.** Real logos appear only small, beside team names.
   - **The All-Savant view is a formation:** a turf field lined up at the snap, as in `AllSavant.dc.html`.
     - Defense on top: S, S deep; CBs wide; the extra DB in the slot; three LBs; EDGE–DL–DL–EDGE on the line.
     - A line of scrimmage.
     - Offense below: the OL unit as one wide card at center; the TE on the line; three WRs split out; the QB; two RBs.
     - K, P and all-purpose in a Special Teams row below.
     - On phones the field scrolls sideways inside its own frame.
   - Headshots come from ESPN's college football headshot path by athlete id, HEAD-checked once at build time. Use an initials badge in team colors where a headshot is missing. Never a broken image.
9. **A separate page:** `public/college-football-savant.html`, with all data under `public/cfb/`.
   - It goes under the Football dropdown in the site ribbon, labeled "College Football Savant".
   - Version 1.0.0, with a What's New line.
   - It shares nothing visual with Football Savant except the ribbon. This is college football's own theme, reused later by any other college football page.

## 2. Data stack

| Need | Source | Role |
|---|---|---|
| History 2004–2025: play-by-play with participants, box scores, drives, rosters, lines | sportsdataverse-data release files (prompt 1's `pull_releases.sh`) | Primary for history |
| Live season, 2021–2022 backfill, standings records, rosters, headshots | ESPN site + core API | Primary live |
| Recruiting, portal, coaches, conference by season | CFBD (≤ 300 calls a month) | Inputs only |
| EP/WP model, opponent adjustment, power rating, résumé, Savant value | WCE's own (`pipeline/cfb/`) | Everything shown |
| CFBD PPA, ESPN FPI, cfbfastR EPA, AP lists | — | Validation only, never shown |

**Fallback ladder** (same idea as College Basketball Savant):
1. Archive every raw ESPN response as a monthly GitHub release asset `cfb-raw-YYYY-MM`, never in git.
2. ESPN from the cloud.
3. ESPN from Adam's Mac via a `cfb-data` branch if the cloud is blocked two runs in a row.
4. The release files for history.

The heartbeat records which source each game came from.

## 3. The player card

Build it to `Main.dc.html`, top to bottom:
1. **Header sticker:** headshot, name, position, number, class, team and conference, height and weight, hometown, recruiting, schedule strength faced, the school-history ribbon with transfers marked, and a Football Savant link when the player reached the NFL.
2. **Accolade stickers.**
3. **"How to read the bars"** panel.
4. **Percentile panel** with controls: pool, adjusted or raw, garbage time, season.
   - Groups by position follow BACKTEST.md.
   - Each bar shows a thin tick where the player would sit before opponent adjustment.
   - Hatching and a diamond appear below the settle point.
5. **Splits:** home / road / neutral, conference vs non-conference, vs our top 25, by month.
6. **Game log and career across schools.**
7. **Comps:** nearest players at the same position and class.
8. **Explainers.**

Use "not tracked" with its start season where data doesn't exist. For example, completion % over expected is not tracked before 2025.

## 4. Teams

- **All-teams table:** power rating (offense, defense, special teams), résumé score, record, schedule strength, five factors, havoc, pace, turnover luck (labeled), team talent, returning production.
- **Team page:** roster strip with headshots, depth by usage, head coach line, schedule with results and our pregame win probabilities.

## 5. The playoff section

Build it to `Playoff.dc.html`: the bracket stickers (byes, first-round matchups at the higher seed), the "first out" callout, the résumé ranking table with odds, and the rules panel.
- Add a season picker for past fields.
- The explainer states plainly that margin never enters the résumé score.

## 6. All-Savant

Build it to `AllSavant.dc.html`: the award stickers (Savant Heisman, Non-QB Player of the Year), the set and tier toggles, the formation field, and the special-teams row. Show the pre-2024 defensive warning wherever it applies.

## 7. Leaderboards, front page, search

The same pattern as College Basketball Savant: any stat, season, pool and minimum sample; search across players, teams and conferences; SEO player pages per `PLAYER-PAGES.md` and `SEARCH.md`.

## 8. The connector

- **Tools,** prefixed `cfb_`: `cfb_search_players`, `cfb_get_player_profile`, `cfb_player_career`, `cfb_player_splits`, `cfb_leaderboard`, `cfb_team_profile`, `cfb_team_rankings`, `cfb_game`, `cfb_all_savant_team`, `cfb_playoff_field` (today's field, odds, past seasons).
- **Same rules as every other tool:** every percentile with its pool, low samples flagged, "not tracked" kept apart from zero, the data date, a link, and the pre-2024 defensive warning where it applies.
- **Never served:** raw CFBD rows, AP picks, FPI, PPA.
- Update `coverage.mjs`. Add `tools/savant-cfb/check.mjs` holding every connector value to the page's own math, wired into `check:savant`.

## 9. Build sequence (one run)

| Step | What | Checks before the output is used |
|---|---|---|
| 1 | Setup: worktree, rebase, house-style skill, config registry (every stat's label, group, unit, direction, settle point, start season, explainer, verdict from BACKTEST.md) | Registry covers every stat in the verdict table |
| 2 | Re-pull release files as needed, within the disk rule | Free space ≥ 8 GB throughout |
| 3 | ESPN backfill of 2021–2022 missing games; live 2026 season through the latest week | 2021 and 2022 pass the 97% gate (or stay flagged with the reason); every 2026 FBS final present |
| 4 | CFBD: recruiting, portal, coaches, conferences | ≤ 80 calls this run; ledger written; key never printed |
| 5 | Identity: ESPN athlete id as the spine; school history; recruits joined; NFL link to Football Savant ids | Every match logged; manual fixes in `pipeline/cfb/manual/id_fixes.csv` with a source |
| 6 | Positions and All-Savant slots (prompt 1's mapping plus the borderline list) | Borderline list written |
| 7 | Ratings, résumé, simulator: reuse prompt 1's, add tiebreakers and the Pac-12 rule | Power rating still within 0.5 of FPI; simulator calibration unchanged |
| 8 | Percentiles, pools, settle points, splits, leaderboards | No pool under 20 players (widen and label) |
| 9 | Savant value, All-Savant sets, Savant Heisman, Non-QB Player of the Year, 2014–2026 | AP overlap per season reported (internal); pre-2024 warning attached |
| 10 | Playoff fields 2014–2026 and today's odds | Field obeys every rule; seeds and byes correct; the G6 and Notre Dame rules unit-tested |
| 11 | Site files under `public/cfb/`, split by season and team, loaded on demand; no file over 15 MB | Sizes reported |
| 12 | The page, built to the three mockups | Every value matches the data files; desktop and phone tested; no JS errors; every percentile names its pool; reduced motion respected |
| 13 | Connector and its check | New check passes; coverage map updated |
| 14 | Refresh: `college-football-savant-refresh.yml` on GitHub Actions. Daily about 10:00 UTC late August to the title game, plus an extra Sunday about 08:00 UTC. Commits only if data changed. Freshness alarm. Monthly raw archive | A refresh of the current season is byte-identical to the full build; one dry run on a GitHub runner |
| 15 | Entry points: ribbon, home page, search names, SEO pages, version 1.0.0, What's New | `check:seo` and `check:whats-new` pass |
| 16 | Start the 2004–2013 background backfill behind the same gates | Report what landed and what was dropped |
| 17 | `COLLEGE-FOOTBALL-SAVANT.md` and the review list | None |

## 10. Review list for Adam (compiled at the end)

- Headshot coverage by conference.
- The position borderline list.
- 2021–2022 gate results after the backfill.
- AP overlap per season, and the biggest disagreements with a one-line reason each.
- Retroactive fields that look surprising, each with a one-line reason.
- Tiebreaker cases where a team's spot depends on a tiebreaker.
- CFBD calls used and anything waiting for the Dec 1 reset.
- Every check that needed a judgment call.
- A trademark check on "Savant" before heavy promotion.
