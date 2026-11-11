# The WCE Data Room, every sport

The connector's raw rows behind every Savant, behind two tools: `savant_dictionary` (the catalog, and
every column defined) and `savant_data` (one season of one table: filters on any column, columns,
one sort, 500 rows a call, paging). Both are on the public address, free. They replace the six
per-sport tools (`nba_coaching_data`, `cbb_data`, `cbb_coaching_data` and their three dictionaries),
which answer the same rows from the new tool (the parity check). The build brief is
[research/data-room/BUILD.md](research/data-room/BUILD.md).

Connector 3.7.0. Up-front tool text: **89,998 → 87,284 characters** (cap 90,000), 84 → 80 tools.

## Tables

| sport | table | one row per | seasons | rows | gz total | largest season | where |
|---|---|---|---|---|---|---|---|
| nfl | plays | play | 1999–2026 | 1,259,650 | 63.6 MB | 3.0 MB | release |
| nfl | player_games | player-game (regular season) | 1999–2026 | 546,424 | 41.7 MB | 2.6 MB | release |
| nfl | games | team-game | 1999–2026 | 14,824 | 1.0 MB | 0.04 MB | public |
| nba | player_games | player-game (regular season) | 1996-97–2025-26 | 736,410 | 26.0 MB | 1.0 MB | release |
| nba | shots | field-goal attempt | 1996-97–2025-26 | 5,934,239 | 104.9 MB | 4.1 MB | release |
| cfb | plays | play | 2014–2026 | 1,698,793 | 65.5 MB | 6.2 MB | release |
| cfb | games | team-game | 2014–2026 | 22,312 | 1.4 MB | 0.12 MB | public |
| ufc | fights | fighter-fight | 1994–2026 | 17,976 | 1.4 MB | 0.08 MB | public |
| ufc | rounds | fighter-round | 1994–2026 | 42,190 | 1.8 MB | 0.11 MB | public |
| nba | coaching_games, _stints, _units, _rotation, _decisions | (unchanged) | 1996-97 / 2002-03 on | 3.0 M | — | — | site (bcs/data) |
| cbb | games, player_games, units, possessions | (unchanged) | 2009-10 / 2024-25 / 2025-26 on | 2.8 M | — | — | site (cbb/) |
| cbb | coaching_games … coaching_programs (7) | (unchanged) | 2009-10 / 2013-14 / 2023-24 on | 1.7 M | — | — | site (cbcs/data) |

25 tables, about 17.6 million rows. Every column of the nine new tables is defined in
`public/dataroom/dictionary.json` (836 columns: what, unit, source, first season, caveat), and
`savant_dictionary(sport, table)` returns them; Football Savant's 288 per-game rates take their
definitions from its own metric registry. Columns that start late say so: NFL participation
(formation, personnel, box, pressure) 2016 on, coverage and routes 2018 on, FTN charting 2022 on;
college football's charted layer 2025 week 9 on.

**Not built, and why**
- **NBA shots: `assisted`** is in the table and always null. The NBA's shot chart carries no assist;
  joining the play-by-play shot by shot is on the review list.
- **NBA 2026-27 player-games and shots** are not uploaded yet. The season in progress is built by the
  cloud refresh through the same ESPN shim the page uses and reconciled with the season card the same
  pass writes before anything is kept (`nba.build_current`); a local build could not match the live
  card's snapshot (it was cut at 03:55 UTC with the Nov 10 West Coast games in play, and ESPN corrects
  box scores between snapshots), so it waits for the first refresh after merge.
- **NBA shots in the season in progress: `area` and `range`** are null (ESPN has no such fields).

## Hosting

- **public/** (`public/dataroom`, served gzipped like `cbb/` and `cbcs/`): the catalog, the dictionary,
  and the four small tables. **5.4 MB** of growth (limit: 150 MB).
- **GitHub release assets** (tag `dataroom`, pre-release, `<sport>-<table>-<season>.json.gz`): the five
  large tables, **302 MB, 129 files**, never in git (`out/dataroom/` is ignored). Cost: **nothing**.
  The connector fetches a season at run time and caches it inside a raw-JSON budget (80 MB); one call
  reads at most one season's file of one table (checked).
- A refresh replaces a season's asset in place (`pipeline/dataroom/publish.sh`: only files whose
  bytes changed, then the catalog).

## Refresh

Each sport's existing refresh rebuilds its season in progress, `continue-on-error`, so a Data Room
failure can't block a Savant page:

| sport | where |
|---|---|
| NBA | `pipeline/basketball/cloud_refresh.py` (inside the shim, after the page's refresh) and `cloud_run.sh` (upload, catalog) |
| NFL | `football-savant-refresh.yml`, step "Data Room — the season in progress" |
| CFB | `pipeline/cfb/cloud_run.sh` `dataroom()` |
| UFC | `ufc-savant-refresh.yml`, step "Data Room" |
| CBB | `pipeline/college/cloud_run.sh` (catalog counts; its tables are the page's own files) |

`tools/dataroom/identity.sh`: a refresh of the current season is **byte-identical** to a full build,
all four sports. It found that Basketball Savant's in-season minutes depended on Python's hash seed
(`espn_tables.py` iterated sets when it filled a period's starting five and when it trimmed a sixth
man); both now go by id, and the overflow keeps the man coming in.

## Checks

| check | result |
|---|---|
| Reconciliation (`tools/dataroom/reconcile.py`) | **236 of 236** checks pass; every season of every new table, against the Savant page's own numbers |
| The tool (`tools/dataroom/check.mjs`) | every table reachable (newest and oldest season), every filter op incl. dates, paging covers every row once, helpful errors, one file a call |
| Parity | the same rows, totals, next offsets, data dates and dictionaries as all six old tools |
| Freshness (`tools/savant-mcp/freshness.mjs`) | 26 tables and tool families, all fresh; a deliberate lag in each sport (`--lag nba` … `--lag ufc`) fails that sport alone, and passes again without it |
| No stamp ahead of its data | every stamping tool's date is its newest row (test in `tools/savant-mcp/check.mjs`) |
| Coverage | `coverage.json` lists all 25 tables |
| `check:savant` | 317 pass, 0 fail, 4 skipped (the redis-server tests; it is not installed on this Mac), the exam and the Data Room checks included |
| `check:whats-new` | pass |

Reconciliation, per table (each row: seasons checked, what was compared):

| table | seasons | compared against |
|---|---|---|
| nfl plays | 28 of 28 | dropbacks, EPA per dropback, EPA per carry, 8,512 player-seasons vs Football Savant |
| nfl games | 28 of 28 | plays, EPA, dropbacks, runs, sacks both ways, 893 team-seasons vs the team table |
| nfl player_games | 28 of 28 | pass attempts, targets, receptions, 15,215 player-seasons vs the season card |
| nba player_games | 30 of 30 | 3PA, FTA, 2PA, TS%, 14,514 player-seasons vs the Basketball Savant card |
| nba shots | 30 of 30 | zone attempts and makes vs the shot-zone bars (14,511); heat-map counts (10,912); every shot's team, opponent and home vs its player-game (5,934,239) |
| cfb plays | 13 of 13 | dropbacks (garbage time out and in), EPA per dropback, rushes, EPA per rush, 11,577 players vs the season file |
| cfb games | 13 of 13 | plays, EPA per play, success rate, 19,100 team-games vs the game file |
| ufc fights | all years | fights, minutes, strikes landed and absorbed per minute, win %, 2,779 fighters vs UFC Savant career totals |
| ufc rounds | 5 years | significant strikes summed over rounds equal the fight row, 3,648 fights |

**Speed.** On the Vercel preview, cold cache (a season no instance had read), the slowest call per
table: cfb plays 1.71 s (2015, 138k rows), nba shots 1.31 s (2018-19, filtered and sorted), nfl
player_games 1.02 s, nfl plays 0.93 s, nba player_games 0.33 s, nba coaching_games 0.29 s, cbb
player_games 0.31 s, cbb coaching_games 0.24 s. Limit: 10 s. The four public/ tables (UFC, NFL and
CFB team-games) are read off the live site, so on a preview they answer only after the merge.
Per-season file sizes are in the catalog (`bytes` for each season).

## The analyst exam

`tools/savant-mcp/exam/`: 80 questions (20 NBA, 20 NFL, 12 college basketball, 12 college football,
8 UFC, 8 across tools or sports; 12 traps), each a recipe whose gold answer is computed from the data
files by code (`exam.mjs gold`) with its tolerance and the tool calls that reach it. The self-check asks
every answerable question through the connector and compares: **68 of 68** on local files, every trap's
proof holding (a trap with a proof shows the data really lacks it, e.g. 2026 formation is null). It
runs in `check:savant` and weekly on the live address (`connector-coverage.yml`). `RUN.md` is the exam
for an assistant with the connector alone, scored against the gold.

## Freshness lights

`connector-freshness.yml` runs after every sport's refresh and daily, and checks in one light per sport
with the Control Room: **Connector freshness — NBA, NFL, college football, college basketball, UFC**
(List and Timeline tabs). Red names what lags. Only the daily run fails on lag, which emails it, as the
30-hour alarms do. `basketball-savant-freshness.yml` keeps its 30-hour heartbeat and now checks the
basketball tables and tools (`--only nba,cbb`).
