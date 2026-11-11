# Prompt: the WCE Data Room, every sport

*For Claude Code, opened in `/Users/adamcohen/western-conference-elitists`. Written Nov 10, 2026. This file is `~/WCE-Data-Room/BUILD.md`; copy it to `research/data-room/BUILD.md` once you're on the branch.*

---

Adam's top priority is making the WCE connector feel like having a whole data analytics team at your fingertips. The first layer is trust: an AI can pull the raw rows behind every Savant, every answer says how fresh it is, and the connector tests itself.

Today only three areas have a Data Room, all current through last night:
- Basketball Coaching Savant: `nba_coaching_data` and `nba_coaching_dictionary` in `api/_bcoaching.js`.
- College Basketball Savant: `cbb_data` and `cbb_data_dictionary` in `api/_cbb.js`.
- College Basketball Coaching Savant: `cbb_coaching_data` and `cbb_coaching_dictionary` in `api/_cbcoaching.js`.

This build gives every sport one, behind a single shared tool, and adds freshness checks and an analyst exam.

## Adam's decisions (Nov 10, 2026)

1. **Every sport gets a Data Room:** Football Savant (NFL), Basketball Savant (NBA), College Football Savant and UFC Savant, in addition to the three that exist.
2. **One shared tool, not one per sport.**
   - `savant_data` and `savant_dictionary` cover every sport.
   - They replace the six per-sport data and dictionary tools listed above.
   - The connector already makes an AI read a lot of tool text before it answers, and more narrow tools means more wrong picks.
3. **Free:** both tools are on the public address. `savant_query` stays WCE Pro.
4. **This build also adds:**
   - a freshness check for every connector tool and table
   - the analyst exam

## Read first

- **The three existing Data Rooms:** their tools, file layout, filters, paging and dictionaries. They are the pattern to generalize: tables split by season, served gzipped, filters as `{column, op, value}`, a column list, paging, and a dictionary giving every column's definition, unit, source, first season and caveat.
- **Freshness:**
  - `tools/savant-mcp/freshness.mjs`
  - the three `*-freshness.yml` workflows
  - `tools/control-room/` (the /control page)
  - how the 30-hour freshness email is sent
- **Connector checks:**
  - `tools/savant-mcp/check.mjs`, including the 90,000-character cap on what an AI reads up front
  - `coverage.mjs` and `coverage.json`
  - `connector-coverage.yml`
- **Pipelines and site files you'll read rows from:**
  - Football Savant: `pipeline/football/`, including `fetch.sh` (nflverse play-by-play, participation from 2016, FTN charting) and `public/football-weekly/`
  - Basketball Savant: its game logs and `public/shots/`; the nightly upload lives in `~/Basketball-Savant`
  - College Football Savant: `pipeline/cfb/` and `~/College-Football-Savant/work/`, including 1.1's charted columns
  - UFC Savant: `public/ufc-savant-fights.json` and its refresh

## Ground rules

1. **Data correctness before anything else.** Every Data Room total must reconcile with the Savant page's own numbers (§5). Never ship a table that fails its reconciliation.
2. **Free data only.** Use sources the pipelines already use; add no paid tier.
3. **Repo and hosting size:**
   - `.git` is already 5.6 GB and `public/` is 868 MB. Large tables (NFL plays above all) must not be committed to git.
   - Measure each table first, gzipped, per season, with the columns you plan to keep. Then choose where it lives:
     - **Small tables** (UFC fights, team-games): in `public/`, like the existing Data Rooms.
     - **Large tables:** files the connector function fetches at run time and caches, hosted somewhere free. The preferred option is GitHub release assets on this repo, uploaded by the refresh workflows. Pick something else only if you can show it's better.
   - Stop and ask Adam before anything that would cost money, and before adding more than 150 MB to `public/`.
4. **Disk and memory:**
   - Stop if free space on the Mac would drop below 8 GB. It has about 14 GB now.
   - Process seasons in batches. The Mac has 8 GB of RAM.
   - Vercel function memory is the binding limit at run time: no call may load more than one season's file of one table.
5. **Branch:** run `git fetch origin && git worktree add .claude/worktrees/data-room -b data-room origin/main`. Don't merge: connector changes need Adam's approval.
6. **Save usage:**
   - No subagents unless a step truly needs parallel research.
   - Don't re-read files you've already read unless they changed.
   - Print summaries, not whole tables.

## 1. The tables

The column lists are minimums. Add any column a pipeline already computes, if it fits the size budget. Every table records its first season, and so does every column that starts later.

| Sport | Table | One row per | Seasons | Must include |
|---|---|---|---|---|
| NFL | `plays` | play | 1999 on | game, teams, quarter, clock, down, distance, yard line, play type, yards, EPA, WPA, success, passer/rusher/receiver (ids and names), air yards, YAC, CPOE inputs, sack, scramble, penalty, formation and personnel and defenders in the box where participation exists (2016 on), FTN charting fields where they exist (2022 on: play action, RPO, blitz, pressure, drops) |
| NFL | `player_games` | player-game | 1999 on | the box line and the Savant per-game rates the weekly files hold, plus routes and targets where tracked |
| NFL | `games` | team-game | 1999 on | result, score, spread and total where held, rest, home/away, EPA per play each way, success rates |
| NBA | `player_games` | player-game | as far back as Basketball Savant's game logs go (label the start) | box score, minutes, possessions, usage, true shooting, on-court net where held |
| NBA | `shots` | shot | the seasons `public/shots/` holds | player, team, game, date, x/y, zone, distance, made, shot type, assisted, period, clock |
| CFB | `plays` | play | 2014 on | the 1.0 play fields (EPA, success, down, distance, yard line, garbage-time flag) plus 1.1's charted columns from 2025 week 9 (formation, tempo, depth and direction, air yards, YAC, hurried by, broken up by, tacklers), each labeled with its start |
| CFB | `games` | team-game | 2014 on | result, opponent-adjusted ratings, EPA each way, conference, home/neutral |
| UFC | `fights` | fighter-fight | all fights UFC Savant holds | opponent, date, event, division, result, method and finish detail, round, time, strikes landed and attempted by target and position, takedowns, control time |
| UFC | `rounds` | fighter-round | where round data exists | if it fits the budget; otherwise list it as not built, with the reason |

The six existing tables join the same catalog unchanged: the NBA coaching tables, `cbb_data`'s tables and the college coaching tables.

**Raw sources stay off GitHub.** Nothing raw from ESPN, nflverse or the UFC sources is committed. Only derived rows are published, as now.

## 2. The tools

### `savant_data`

Inputs:
- `sport`: `nba`, `nfl`, `cfb`, `cbb`, `ufc` (coaching tables live under their sport, e.g. `nba` `coaching_games`)
- `table`
- `season`
- `filters`: `{column, op, value}`, with ops eq, ne, in, gte, lte, gt, lt, contains, null, notnull; dates as YYYY-MM-DD
- `columns`
- `sort`: one column, ascending or descending
- `limit`: at most 500 rows
- `offset`

Every answer includes:
- the definitions of the columns it returned
- how many rows match
- the next offset
- **"data through"**: the date of the newest row in the season, never the date it was read
- a link to the matching Savant page

Errors name the valid choices: an unknown column lists the columns, an unknown table lists the tables.

### `savant_dictionary`

With no inputs, it returns the catalog: every sport's tables, what one row is, seasons covered and row counts. With a sport and table, it returns every column's definition, unit, source, first season and caveat. Its description tells the AI to read it before pulling rows.

### Replacing the six old tools

- Remove `nba_coaching_data`, `nba_coaching_dictionary`, `cbb_data`, `cbb_data_dictionary`, `cbb_coaching_data` and `cbb_coaching_dictionary` from the tool list.
- Any other tool's text that points to them must point to `savant_dictionary` instead (for example, `cbb_leaderboard` says "keys: cbb_data_dictionary").
- The answers the old tools gave must come out the same from the new tool: a check calls both on the same inputs before you remove the old ones.

### Size cap

What an AI reads up front must go down or stay level, and stay under the 90,000-character cap. Report it before and after.

## 3. Freshness for every tool

- **Extend `tools/savant-mcp/freshness.mjs` from the two Data Rooms to every connector tool and every table.** For each one, compare its newest data against the source it should match. Examples:
  - NBA tables against Basketball Savant's newest game.
  - NFL tables against the last completed NFL game day.
  - CFB tables against the college refresh's `through`.
  - UFC against the last event.
  - Profile and leaderboard tools against the site files they read.
- **Tolerances per sport:**
  - NBA: 1 day.
  - NFL: the Tuesday after a game week.
  - College: 3 days, as now.
  - UFC: 2 days after an event.
  - Offseasons are exempt and labeled as such.
- **Wire it in:**
  - one freshness workflow that runs after every refresh and daily
  - a red light on /control for any table or tool that lags
  - the existing 30-hour freshness email
- **No stamp ahead of its data:** every connector tool's "data as of" or "through" line must equal its newest row. Add a check that compares each tool's stamp with its data.

## 4. The analyst exam

1. **Write the questions:** 80 hard questions in `tools/savant-mcp/exam/questions.json`.
   - **Spread:** about 20 NBA, 20 NFL, 12 CBB, 12 CFB, 8 UFC, and 8 that cross tools or sports.
   - **Mix:** lookups, filters over many rows, splits ("how does his EPA per dropback change when pressured, 2024 on"), comparisons, and traps. A trap is a question the data can't answer, where the right answer says so. Model them on Adam's use cases:
     - "why are the Chargers bad"
     - fantasy buy or sell
     - an NBA GM-competition trade fit
     - playoff fit
     - a college scouting question for a coach
2. **Gold answers come from code, never by hand.** A script computes each answer from the data files and stores the value, its tolerance and the tool calls that reach it. Questions about the season in progress recompute their gold answer each run.
3. **A self-check proves every non-trap question is answerable.** It calls the tools the question lists, on the live address, and compares the result with the gold. It runs in `check:savant` against local files and weekly against the live site.
4. **Write `tools/savant-mcp/exam/RUN.md`.** It is the instructions an AI follows to take the exam through the connector alone, answering in plain language, and to score itself against the gold answers. Adam will point the Monday scheduled task (`WCE connector weekly update`) at it after merge. Don't change the scheduled task yourself.
5. **Report the self-check score.** Any question the tools can't answer goes on the review list with the missing piece.

## 5. Checks

All must pass before the PR:

- **Reconciliation:** each table's totals equal its Savant page's numbers for at least 3 seasons per sport. Examples:
  - NFL plays summed to player-season EPA, yards and attempts equal Football Savant's season files.
  - NBA player-games summed to season totals equal Basketball Savant's.
  - NBA shots by zone equal the shot-chart files.
  - CFB plays summed equal College Football Savant's season files.
  - UFC fights summed equal UFC Savant's career totals.
- **The tool:** every table reachable; every filter op works, dates included; paging covers every row exactly once; unknown names give helpful errors; no call loads more than one season's file.
- **Parity:** the new tool returns the same rows as each of the six old tools for the same inputs.
- **Freshness:** `freshness.mjs` passes on every tool. Make it fail on purpose once per sport to prove it catches lag, then restore.
- **Size and speed:**
  - Report each table's size per season and its total, the `public/` growth, the hosted-file total, and the up-front tool text before and after.
  - The slowest call per table must stay under 10 seconds, measured on the Vercel preview with a cold cache.
- **Coverage:** `coverage.json` lists every table.
- **Suites:** `check:savant` and `check:whats-new` pass.

## 6. Build sequence

| Step | What | Checks |
|---|---|---|
| 1 | Worktree; read the inputs; measure each table's size; choose hosting (stop and ask if it costs money or adds more than 150 MB to `public/`) | Size table reported |
| 2 | Build the tables, sport by sport, in batches | §5 reconciliation per table |
| 3 | `savant_data` and `savant_dictionary`; fold in the six old tools, then remove them | Parity; up-front text under the cap |
| 4 | Refresh: every table updates inside its sport's existing refresh, with `continue-on-error` so a Data Room failure can't block a Savant page | A refresh of the current season is byte-identical to a full build |
| 5 | Freshness for every tool, /control lights, the email, and the stamp check | §3; the deliberate failures caught |
| 6 | The analyst exam, gold answers, self-check, `RUN.md` | Self-check score reported |
| 7 | Connector version bump; What's New line: "The WCE connector's Data Room now covers every sport: NFL and college football plays, NBA player-games and shots, UFC fights" | `check:savant`, `check:whats-new` |
| 8 | `DATA-ROOM.md` at the repo root (tables, sizes, hosting, checks, exam score); push; open a PR; give Adam the preview link and the review list | None |

## 7. Review list for Adam

- Tables built and not built, with reasons.
- Where the large tables are hosted, and what that costs: should be nothing.
- `public/` growth, and the up-front tool text before and after.
- Reconciliation results, per table.
- The slowest calls.
- The freshness lights now on /control.
- The exam self-check score, and every question the tools can't answer yet.
- Every judgment call.
