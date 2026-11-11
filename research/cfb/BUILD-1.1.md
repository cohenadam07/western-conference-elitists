# Prompt 3: College Football Savant 1.1.0, the stat expansion

*For Claude Code, opened in `/Users/adamcohen/western-conference-elitists`. Inputs:*
- *`~/College-Football-Savant/EXPANSION.md`: the stat expansion catalog. It's the spec for what to add.*
- *`~/College-Football-Savant/BUILD-1.1.md`: this prompt.*
- *`COLLEGE-FOOTBALL-SAVANT.md` and `research/cfb/` in the repo: what 1.0.0 built and how.*

---

College Football Savant 1.0.0 shipped with 68 player stats. Adam wants it as deep as Football Savant and Basketball Savant wherever free data allows, so build **everything in the catalog**:
- **Tier A:** new stats every season since 2014 has the data for.
- **Tier B:** the charted layer from 2025 week 9 on.
- **The team-page expansion.**
- **Special teams.**
- **Four college-only features:** NFL translation, production vs pedigree, transfer impact, devy fantasy.

Read `EXPANSION.md` in full, then `COLLEGE-FOOTBALL-SAVANT.md`, then the code in `pipeline/cfb/`, which you are extending, not rewriting. For the stat set and card structure you're matching, read Football Savant's registry and card code under `pipeline/football/` and `public/football-savant.html`.

## Branch

- **If PR #62 is merged into main:** `git fetch origin && git worktree add .claude/worktrees/cfb-11 -b cfb-1.1 origin/main`
- **If it isn't merged yet:** do the same from `origin/college-football-savant`, and rebase onto main once #62 lands.
- **Don't merge.** Adam reviews. Connector changes need his approval before merging (standing rule).

Build in one run, in the order of §6. Every check listed for a step must pass before its output is used. If one fails, find the cause, fix it and rerun. Never ship a number that failed a check.

## Ground rules (same as 1.0.0, plus three)

1. **Data correctness before UI.**
2. **Disk:** stop if free space would drop below 8 GB. Raw files live in `~/College-Football-Savant/raw/`. Delete a raw file only once its derived output is written and checked.
3. **Free data only.**
4. **CFBD:** the 300-calls-a-month budget and the ledger still apply. This build should need almost no CFBD calls.
5. **Memory:** process seasons in batches, as in 1.0.0. The Mac has 8 GB.
6. **Save usage:**
   - Don't spawn subagents unless a step truly needs parallel research.
   - Don't re-read files you've already read unless they changed.
   - Print summaries, not whole tables.
7. **Honest labels, as on Football Savant:**
   - Every new stat names its start season. Tier B stats say "tracked from 2025 week 9".
   - "Not tracked" is never shown as zero.
   - Each position gets a "what the page can't see" note listing the Tier C items from the catalog.

## 1. Tier A: every season with the data (2014 on, 2009 on where the fields exist)

Build every Tier A stat in `EXPANSION.md` for:
- QBs, RBs, WRs and TEs
- defenders
- special teams: a **returner slot** with its own pool, plus kicker and punter additions
- everyone: penalties, career trajectory

**Sources:**
- release play-by-play fields: line yards, second-level and open-field yards, highlight yards, `xpass`, `go_boost` and the fourth-down recommendation, drive fields, WPA
- the play-participant files: tackler, assisted-by, penalized, returner, forced-by, recoverer
- box scores: returns, punting inside-20 and touchbacks

**Rules:**
- Stats that depend on stat-crew completeness carry the 1.0.0 pre-2024 warning: solo vs assisted tackles, tackle-based stats.
- Touchdowns over expected uses an expected-TD model by yard line, down and distance, fit on 2014–2024 and calibrated on 2025.

## 2. Tier B: the charted layer (2025 week 9 on)

### 2a. The charted-text parser

`pipeline/cfb/charting.py` reads each play's text in the new format and extracts:
- **Formation:** shotgun, or under center when the tag is absent on a charted play.
- **No-huddle.**
- **Pass depth and direction.**
- **The "caught at" or "thrown to" yard line.** This gives **air yards** on every charted attempt and **yards after catch** on completions.
- **Run direction.**
- **QB hurried by** (one or more defenders).
- **Broken up by.**
- **Tacklers,** with assists (several names in the parentheses).
- **Penalized player.**
- **Injury notes.** These are stored, never shown.

**Checks:**
- Parsed air yards must agree with the release files' `air_yards` where both exist: median absolute difference ≤ 1 yard on ≥ 95% of plays.
- Parsed YAC + air yards = gain on completions, within 1 yard on ≥ 98%.
- Defender ids resolve to roster ids on ≥ 95% of named defenders.
- Charting share is reported per game. A game with under 80% charted plays contributes nothing to Tier B for either team. It says so; it's never treated as zero.

### 2b. Stats and models

Build every Tier B stat in `EXPANSION.md`, plus:

- **CPOE with air yards:** a WCE completion model on air yards, direction, down and distance, formation, hurried, and home/away. Fit on charted 2025–2026 with game-level cross-validation. It must beat the 1.0.0 model on log-loss and be calibrated by decile. Then CPOE replaces the old CONTEXT row for charted seasons.
- **YAC over expected:** a WCE model on air yards, direction, depth and down. Same validation.
- **Pressure** = hurries + sacks. Rates are per dropback (QB faced, OL allowed) or per opponent dropback (defenders).
- **Tackle depth** = yards from the line of scrimmage where the play ended, on plays where he's a named tackler.
- **OL by direction:** run success, line yards and stuff rate by left, middle and right.

### 2c. Heartbeat

The refresh alarms if a game day's charted share drops below 90%, because ESPN could switch formats back.

## 3. Stability: the same gate as 1.0.0

Every new stat gets a verdict: full bar / hatched / CONTEXT / luck / dropped.
- **Tier A:** use 1.0.0's split-half reliability, settle points and year-to-year method (`player_study.py`, `team_study.py`) on 2014–2025.
- **Tier B:** use split-half within 2026 plus 2025 weeks 9–16. Settle points come from that pool.
  - Year-to-year is not measurable yet. Say so in each explainer: "settle points will firm up as seasons accumulate".
  - A Tier B stat whose split-half reliability is under 0.5 at a typical starter's sample becomes CONTEXT, not a bar.

Write `research/cfb/out/expansion_stability.md`: every stat, its tier, reliability, settle point and verdict.

## 4. Pages

### Player card

Reorganize into Football Savant-style groups, using each position's full set:

| Position | Groups |
|---|---|
| QB | Context · Passing: Efficiency · Passing: Pressure · Passing: Shot selection · Passing: By depth · Passing: Formation and tempo · Passing: Situational · Passing: Drives · Passing: Schedule · Rushing · Value |
| RB | Context · Rushing: Efficiency · Where the yards come from · Rushing: Direction · Rushing: Situational · Receiving · Value |
| WR/TE | Context · Opportunity · Efficiency · By depth · After the catch · Situational · Value |
| Defenders | Context · Pass rush · Run defense · Credited coverage · Turnovers · Discipline · Value |
| Returners, kickers, punters | Their own groups |

**Card rules:**
- Bars stay as in 1.0.0: thick, colored, opponent tick, hatching and diamond.
- Collapsed groups show their headline stat. Groups expand on tap.
- On phones, groups stack and nothing scrolls sideways.
- **Profile score:** the mean percentile of each position's 5 headline stats, as on Football Savant.
- **Statistical comps** (exists) **and weakness comps:** players who share his lowest percentiles, as on Football Savant.

### Team page

Build every team stat in the catalog:
- what the defense allows by position, opponent-adjusted
- pace, pass rate over expected, early-down pass rate
- fourth-down go rate over expected and two-point decisions
- special teams by phase
- pressure generated and allowed (Tier B)
- formation and tempo identity (Tier B)

Store the decision stats where a future College Football Coaching Savant can read them.

### Leaderboards

Every new stat, with season, pool and minimum filters as in 1.0.0.

## 5. College-only features

### 1. NFL translation

For every player with at least one qualified college season:
- **Comps:** the 5 most similar final-college-season profiles, by position, among players who reached the NFL (1.0.0's 4,360 links). Use z-scores on his position's headline stats plus height, weight and recruiting rating.
- **Each comp** shows his draft slot and NFL career Savant value per season from Football Savant.
- **For linked players,** the card shows their NFL combine numbers from Football Savant, labeled as such.
- **Label everything "comparison, not a projection".**
- **Check:** does the comp group's mean NFL value rank-correlate with real NFL value for 2014–2021 college finals (leave-one-out)? Report the number. If it isn't positive, show comps without NFL outcome averages.

### 2. Production vs pedigree

- The player's production percentile minus his recruiting-rank percentile, within his position.
- Leaderboards for "outplaying his stars" and the reverse.
- Only where a composite rating exists.

### 3. Transfer impact

- For every transfer: the same stats, before and after, opponent-adjusted, side by side.
- A team "portal haul": the summed Savant value of incoming transfers vs outgoing ones, by season (2021 on).

### 4. Devy fantasy

- College fantasy points per game in PPR, half-PPR and standard (toggle).
- **Expected fantasy points:**
  - Before 2025 week 9: from where each carry and target happened (yard line, down).
  - From 2025 week 9: from air yards and depth.
- Points over expected, for QB, RB, WR and TE.
- Rankings tab: season and "devy dynasty". The dynasty view weights age-for-class and production vs pedigree, labeled as a model view.

## 6. Build sequence

| Step | What | Checks |
|---|---|---|
| 1 | Setup: worktree, read the inputs, extend the registry with every new stat (label, group, tier, unit, direction, start season, explainer, source) | Registry check passes; every catalog stat present or explicitly listed as Tier C with a reason |
| 2 | Charted parser on 2025–2026 | §2a checks |
| 3 | Tier A stats, 2009/2014–2026, in batches | Box-score cross-checks: returns, punting and penalties match box totals within 2% |
| 4 | Tier B stats and the CPOE and YACOE models | §2b validation |
| 5 | Stability for every new stat | `expansion_stability.md` written; verdicts in the registry |
| 6 | Team expansion | What-it-allows totals reconcile with opponents' player totals |
| 7 | College-only features | §5 checks; NFL-translation number reported |
| 8 | Site files: split as in 1.0.0, no file over 15 MB, load on demand | Sizes reported |
| 9 | Pages: card groups, team page, leaderboards, devy tab, NFL translation and transfer panels; phone and desktop | Every value matches the data files; no JS errors; no sideways page scroll at 375 px; every percentile names its pool; reduced motion respected |
| 10 | Connector: add the new stats and groups to the existing `cfb_` tools, plus `cfb_devy_rankings` and `cfb_nfl_comps`. Keep the size cap in mind; if it must rise again, note that it needs Adam's approval | The cfb check extended to the new values and passing |
| 11 | Refresh: the charting heartbeat; the workflow and Mac archive unchanged | A refresh of 2026 is byte-identical to the full build |
| 12 | Version 1.1.0, What's New line ("College Football Savant 1.1.0: N new stats, the charted layer, special teams, NFL translation, devy fantasy"), README | `check:savant`, `check:whats-new` pass |
| 13 | `COLLEGE-FOOTBALL-SAVANT.md` updated; push the branch; open a PR; give Adam the Vercel preview link and the review list | None |

## 7. Review list for Adam

- The stability table: how many new stats got full bars, hatched, CONTEXT, dropped.
- The charted parser's agreement numbers, and games under 80% charted.
- CPOE and YACOE validation.
- The NFL-translation correlation.
- Any stat cut, with the reason.
- The connector size, and whether the cap needs to rise.
- Every judgment call.
