# Football Savant pipeline

Builds the two data assets `public/football-savant.html` reads:

| Output | What it is |
|---|---|
| `public/football-savant-data.json` | the metric table (`cfg`) plus every player-season, 1999–2025 |
| `public/football-maps/<season>.json` | throw maps, target maps and run-gap maps, loaded on demand |
| `public/football-routes/<season>.json` | receiver route trees (route of the targeted receiver), 2016 on, loaded on demand |
| `public/football-weekly/<season>/` | every player's game lines, and for the season in progress `form-4/8/17.json`: everyone's last 4, 8 and 17 games as one row |
| `public/football-splits/<season>.json` | situational splits for passers, rushers and receivers, loaded on demand |
| `public/football-pace/wNN.json` | history as it stood after each week, for the "Same point" baseline |
| `public/coaching-savant-data.json` | every head coach since 1999, every play-caller since 2018, their units, fourth-down decisions since 2014, and the curated coaching tree |
| `public/coaching-savant-current.json` | the in-season overlay for Coaching Savant (see below) |

Everything comes from [nflverse](https://github.com/nflverse/nflverse-data/releases) — open
data, no scraping, no keys. `FOOTBALL-SAVANT-RESEARCH.md` at the repo root is the argument
behind the metric choices; `metrics.py` is that argument in code.

## Run it

```bash
cd pipeline/football          # or anywhere — the scripts take paths from env vars
mkdir -p raw agg maps
./fetch.sh                    # ~750 MB of source data into raw/
python3 pbp_agg.py            # play-by-play -> weekly per-player aggregates in agg/
python3 ftn_agg.py            # FTN charting + pbp -> weekly charted rates (2022+)
python3 line_agg.py           # depth charts -> which spot on the line each man played (2001+)
python3 onfield_agg.py        # participation + pbp -> who was on the field, and what happened
python3 roles_agg.py          # depth charts -> listed role: slot corner, linebacker spots (2025+)
NFL_ROUTES=../../public/football-routes python3 route_agg.py   # participation + pbp -> route trees (2016+)
python3 maps.py               # agg/ -> maps/<season>.json + maps/index.json
python3 build.py              # everything -> football-savant-data.json
python3 weekly.py             # the same metrics, one game at a time -> public/football-weekly/<season>/
NFL_SPLITS=../../public/football-splits python3 splits.py     # situational splits, one file a season
NFL_PACE=../../public/football-pace python3 pace.py           # every finished season as it stood after each week
python3 coaches.py            # schedules + pbp -> coaching-savant-data.json
cp football-savant-data.json ../../public/
cp maps/*.json ../../public/football-maps/
```

Needs Python 3.9+ with `pandas` and `pyarrow` (and `pyreadr` for Coaching Savant's fourth-down model). Paths are overridable:
`NFL_RAW`, `NFL_AGG`, `NFL_MAPS`, `NFL_OUT`, `NFL_ROUTES`, `NFL_WEEKLY`, `NFL_SPLITS`, `NFL_PACE`, and `NFL_ARCHIVE`
(the built archive, which the season in progress reads last season's pass-snap corrections from). Seasons too: `NFL_SEASONS=2026`,
`2024,2025` or `1999-2026` (default: 1999 through the current season — see `seasons.py`).

## In-season refresh (automatic)

The archive above is a full local run and changes a few times a year. The season in
progress is a separate, small file, rebuilt by `refresh_current.sh` and committed by the
GitHub Action in `.github/workflows/football-savant-refresh.yml`:

| Output | What it is |
|---|---|
| `public/football-savant-current.json` | the current season only (about 3 MB in October, more by January) |
| `public/football-maps/<season>.json` + `index.json` | that season's field maps; the index is merged, not overwritten |
| `public/football-weekly/<season>/` | that season's game lines and its recent-form windows |
| `public/football-splits/<season>.json` | that season's splits |

The page fetches both files and merges them (`mergeData` in `football-savant.html`); where
both carry the same season the more recently generated wins, so the archive takes over
cleanly once a finished season is baked into it. Runs every morning at 8am ET and at ~1am
ET after Thursday, Sunday and Monday night games, or by hand from the Actions tab. Nothing
is committed when the data hasn't changed, so an off-season run is a no-op.

The schedules say 7:11am and 12:41am ET rather than round hours on purpose: GitHub queues
scheduled workflows, and :00 and :30 are where every repository's crons pile up. Through
the first fortnight of the 2026 season every run landed three and a half to five hours
after its slot.

The run ends with a staleness check, because the failure mode this job actually has is the
quiet one — a 404 upstream, a build on last week's numbers, a green tick and a frozen site.
It asks the schedule which regular-season games kicked off more than two days ago and still
have no score. More than three of those and the job fails, which sends mail.

## Full archive rebuild (on demand)

`.github/workflows/football-savant-rebuild.yml` does the whole 1999-onward build in
Actions: Actions -> **Football Savant full rebuild** -> Run workflow. It fetches
everything, runs every aggregate, and commits `public/football-savant-data.json`. Takes
the better part of an hour.

Use it whenever the metric table changes. The daily job rebuilds only the season in
progress, and since the page now takes its metric table from whichever file was built more
recently, a new metric appears on the current season the next morning and on the other
twenty-seven seasons only after this rebuild runs.

It carries the career awards forward out of the shipped archive before building, then
tries to refresh them, and keeps the old set if that fails. `agg/awards.json` is not in the
repository, and a rebuild without it would strip every Pro Bowl and MVP off every career
page.

```bash
cd pipeline/football && ./refresh_current.sh        # the same thing, locally
```

Three things are different about a season in progress, all in `build.py`:

- **Qualifying lines are pro-rated.** 150 dropbacks is a full-season claim; in week 2
  nobody has it and the percentile pool would be empty. The line scales with how much of
  the season *his team* has played (from the schedule), so a starter is a starter from the
  first Sunday.
- **Availability** is games played over his team's games so far, not over 17.
- **"Missed the playoffs"** is not asserted until the season is over. The season block
  carries `week: N` while it is partial, and the page shows "through week N".

What the automatic refresh cannot give you: on/off splits, man-and-zone and true pass-play
snap counts, because the participation data is published after the season (the line's unit
rows and the snap-based rates are estimated until then, and tagged: the season block carries
`est: 1` for as long as that file is missing, which outlasts `week` by a month); the
same-point baselines, which are history and only change with a full rebuild; and Coaching
Savant's archive, which needs every season's play-by-play.

## The files

- **`metrics.py`** — the metric table. One row per bar the tool can draw, carrying its
  panel, its layer (`ingredient` / `output` / `expected` / `context`), its unit, whether
  lower is better, which positional cohorts show it, which era first tracked it, and how
  much of which denominator it needs before it settles down. Also holds the panel order per
  position, the headline sets behind the career arc and the comps, and the qualifying lines.
- **`pbp_agg.py`** — one pass over each season's play-by-play, producing *weekly* per-player
  aggregates: success counts, air-yards lattices, run gaps, third downs, red zone. Weekly
  rather than seasonal because a season total can't be un-summed.
- **`ftn_agg.py`** — the same shape, over FTN Data's play charting (2022 on): how many men
  rushed, play-action and RPO, catchable balls and drops, contested and created catches,
  defenders in the box, which read was thrown. FTN posts weekly during the season, which is
  the point of it — Pro-Football-Reference publishes a season at a time, months after it
  ends, so every row that depends on PFR goes blank each September. What FTN does *not*
  chart is pressure, hurries, and any defender's name, so pressure rate faced, the pass-rush
  pressure rows and the whole coverage panel still wait for PFR, and nothing here pretends
  otherwise.
- **`pfr_week.py`** — the fix for that wait. PFR's season file only gains a season once it
  is over, but nflverse also posts the same charting week by week (`advstats_week_*`,
  fetched as `raw/advw_<kind>_<y>.csv`). For a season the season file doesn't have yet,
  `build.py` sums the weekly rows back into season rows of exactly the same shape: coverage
  (targets, completions, yards, rating allowed), pressures, hurries, hits, blitzes, missed
  tackle %, yards before/after contact and broken tackles. Checked against 2025's season
  file: counts agree exactly for the median player (`python3 pfr_week.py 2025`). It reads
  the quarterback's file too (`advstats_week_pass`), which fills pressure rate faced and
  bad throw % in season and adds pressure-to-sack, hurry and hit rates. Batted balls,
  pocket time and on-target % are not in the weekly files and stay blank in season.

  **The weekly files are the source for any season still being played**, whatever the
  all-seasons files hold. That stopped being automatic in 2026: nflverse began writing the
  season in progress into three of the four all-seasons files and refreshing them about a
  week behind the weekly ones. On 8 October 2026 they held three games for men who had
  played four, so every charted defensive rate on the site was three games of targets and
  pressures over four games played. `load_pfr` in `build.py` now asks whether the season
  is live, not whether the all-seasons file has it.
- **The All-Savant Team blocks** (`pbp_agg.py` → `build.py`). `pbp_agg.py` also writes a
  team-week `line` table (dropbacks, sacks, hits-or-sacks, designed runs and their
  successes) and a returner-week `ret` table (kick and punt returns actually run back, with
  EPA turned to the returning team's side). `build.py` grades every line on sack rate, hit
  rate and rush success and names its five starters (`lines`, best first), and grades
  returners with a starter's volume on yards and EPA per return (`ret.kr`, `ret.pr`). The
  front page's All-Savant Team reads both; everything else on it is the profile score.
- **`onfield_agg.py`** — joins the participation release (the exact eleven on the field per
  play, plus `was_pressure`, 2016 on) to play-by-play, and accumulates what the offense did
  on each player's snaps, alongside his team's totals so the off-field half can be got by
  subtraction. This is the whole basis of the offensive-line card.
- **`line_agg.py`** — reads the depth charts and decides whether a lineman is a tackle, a
  guard or a centre, so the three are ranked apart instead of in one undifferentiated pool.
  Two file shapes: the NFL's weekly file through 2024, an ESPN daily snapshot from 2025.
  Left and right pool together — LT and RT are different jobs, but thirty-two men a season
  is too thin a pool to rank anybody in honestly. Nothing before 2001, and a man who never
  made a depth chart keeps the plain `OL` cohort.

  The five line spots are the only part of a depth chart that is named consistently
  through 2024: that file has 2,562 rows that simply say "CB" against 242 that say LCB, so
  slot and outside corner are not derivable from it.
- **`roles_agg.py`** — the ESPN snapshot nflverse carries from 2025 does name them: a
  nickel back, a left and a right corner, both safeties and every linebacker spot, for all
  thirty-two teams. This keeps the spot each man was listed at most during the regular
  season and his best rank there (`agg/roles_<y>.json`, on the player row as `role`). It
  is a LISTED role, not where he lined up on each play. The file draws every defense on
  one template, so a 4-3 end can be filed as a "weak-side linebacker"; the page only shows
  a spot where it agrees with the cohort the rest of the card ranks him in.
- **`maps.py`** — turns those aggregates into the field maps, one file per season.
- **`build.py`** — joins the season tables, PFR charting, Next Gen Stats, snap counts, the
  combine and ESPN QBR; computes every metric; fits the season-by-season field-goal
  make-rate curve behind FG-over-expected; and precomputes statistical and weakness comps.
- **`weekly.py`** — the week-by-week charts. For every game a man appeared in it runs
  `build.py`'s own `build_player()` over that one week's inputs (weekly stat line, snaps,
  play-by-play and FTN aggregates, the week's Next Gen Stats row, ESPN's game-level QBR), so
  a game's number is worked out exactly the way the season's is. PFR's charting comes from
  its weekly files (2018 on) and the `extras.py` counters one week at a time; on/off
  splits, man and zone, the schedule faced and a handful of rare-event rows (a game of
  "strip sacks per game" is a row of zeros with a one in it) stay season numbers; season
  totals (games, availability, starts, the combine) are dropped. Every season since 1999 is shipped, and the page's
  Weekly chart shows the games of whichever season is on screen. An old season carries what
  that season tracked and nothing more (snap counts from 2012, Next Gen Stats from 2016,
  FTN charting from 2022, game-level QBR from 2006).

  Two shapes on disk, and the season's `index.json` says which. The season in progress is
  one file per player, rewritten only when it changes, so a refresh touches only the men
  who played. A finished season is packed a hundred players to a file (`pack-57.json`,
  keyed by the last two digits of the player id; `"pack": 2` in the index) - about 100
  files and 2 to 6 MB a season instead of 2,000 files, about 100 MB for 1999-2025 in all
  (30 MB gzipped, which is how it ships). The
  first run after the last regular-season week packs a season and removes its per-player
  files by itself. The refresh runs `weekly.py` for the season in progress; the full
  rebuild runs it for every season, which is what carries a new metric into the archive's
  weekly charts. By hand: `NFL_SEASONS=1999-2025 python3 weekly.py`.
- **`teams.py`** — team names and primary colours, including the franchises that moved
  inside the window (STL, SD, OAK).
- **`coaches.py`** — builds Coaching Savant. Records, playoff history and performance
  against the closing spread come from the schedule; play-calling and unit ratings come
  from play-by-play. Both are attributed **per game**, not per season, so a coach fired in
  week 9 gets exactly the games he coached and his interim replacement gets the rest.
- **`coach_tree.py`** — the coaching lineage. Hand-curated, because who assisted whom is in
  no open dataset. It is the one file here that can simply be wrong, which is why it is flat,
  editable and quoted verbatim in the UI.

## What the weekly feeds add

Three things that are facts about a week rather than a season:

- **Which spot on the line** (`line_agg.py`, above) — the cohorts are now `OT`, `OG` and
  `OC`, with `OL` kept for the seasons and the men the depth charts do not cover.
- **Every team he played for** (`load_weekteams` in `build.py`) — the season table records
  only his last, so a man traded in October used to vanish from the club he left. The test
  is a weekly stat line or a weekly snap count, deliberately *not* the weekly roster file:
  that one counts practice squads and waiver claims, which turns a journeyman into
  `NYJ -> NYG -> PHI -> NYG` without his having played a down for three of them. 107 men in
  2025 by the strict test, against 199 by the loose one.
- **This week's injury report** (`load_injuries`) — attached only while the season is being
  played, and only for the latest week. Most rows carry no game-day designation at all, so
  a man who missed practice with a named injury is reported as that rather than dressed up
  as one; "not injury related — resting player" is dropped entirely unless there is a real
  designation beside it.

Week-level QBR feeds the weekly charts (`weekly.py`, from `qbr_week_level.csv`) and,
through them, the recent-form windows.

## The October 2026 additions

About 135 new rows, four new views and three new stages (`roles_agg.py`, `splits.py`,
`pace.py`). What ties them together:

- **`extras.py`** — one idea: a player-week row of plain additive counters (snaps and
  unit totals, his team's totals in the games he played, tackles by kind, kicks, drives,
  expected fantasy points). A season is those rows added up, a game is one of them, a
  window is a few. `build_player()` is handed whichever sum (`ex`) and takes the rates,
  so the season card, the weekly chart and the form windows are one implementation.
  Season-only facts that do not add (on/off, man and zone, a contract, with-and-without)
  come from `Season.only()`.
- **Everyone who took a snap has a card.** The stat table lists only men who recorded a
  stat, which left out most of the offensive line: through four weeks of 2026, 35 of the
  167 linemen with 100 snaps. Snap counts (2012 on) are now unioned in, and a man who was
  never flagged gets a zero for false starts and holding rather than no row, so those
  percentiles are no longer ranked among the flagged only.
- **The line panel is alive in season.** The participation file (who was on the field for
  each play) is published after the Super Bowl. Until then a lineman's unit rows are his
  team's game totals weighted by his share of that game's offensive snaps: exact for a man
  who played every snap, and against the 2025 participation file r = 0.99 for sack rate
  and EPA per dropback, 0.97 for the run rows (223 linemen). Those rows carry
  `est: 'live'` and the page tags them "est." until that file is published (the season
  block's `est` flag, not its `week`, which goes a month earlier). On/off
  rows stay blank: with no play-by-play lineup there is no "off the field". Not used for
  tight ends, where the stand-in is too loose (r = 0.82 to 0.95).
- **Charted pressure is its own row** (`prsallowc`): PFR's weekly count of pressures on
  the quarterback, by snap share. It is a different crew from the participation file's
  `was_pressure` (r = 0.73 between them), so the two are never spliced into one series.
- **Pass-play and run-play snaps.** True counts from participation where it exists
  (2016 on, finished seasons). In season: snaps x the share of that game's plays that
  were dropbacks, corrected by each man's own true-to-estimate ratio from last season
  (`psr` on his archive row, read through `NFL_ARCHIVE`), or his position's average where
  he has none. That correction cuts the miss from 9.0% to 5.2% (interior line 17% to 9%).
- **Sample lines by position** (`thrp`, `THR_SCALE` in `metrics.py`). No running back has
  had 150 targets since targets were first charted, so a back's yards per target could
  never be called settled. Lines are scaled so about the same share of each position's
  regulars reaches them. Statistical lines are NOT pro-rated to the week: a hollow bar in
  October is telling the truth.
- **`splits.py`** — the same plays by down, distance, field position, quarter, score and
  site (every season); play-action, blitz, motion, formation, RPO, box (FTN, 2022 on,
  weekly); pressure, time to throw, coverage and personnel (participation, finished
  seasons). Sums only, so cells add. Each file carries the league's line by position.
- **A span of games is built the way a season is** (`weekly.py`, `Inputs` and `_Acc`).
  The first version of the two views below averaged game lines, weighted by each stat's
  sample. A game line leaves a stat out on a day there was nothing to count, so the
  average forgot those days: the median interior lineman's pressure rate through four
  weeks came out two thirds too high, and "last four games" in week 4 disagreed with the
  season it was identical to. Now the games' inputs are added up (stat lines, play-by-play
  and charting counters, snaps, `extras.py` counters) and `build_player()` runs once over
  the sum. Checked by rebuilding every 2025 card from its games: 199 stats come back to
  the digit; the rest are the ones a season gets ready-made from a source that cannot be
  added back up (Next Gen Stats, QBR, the lineup file), and those are within a few
  hundredths of a standard deviation except the four named in `PACE_SKIP`.
- **`pace.py`** — every finished season rebuilt as it stood after week N, as 41
  percentile points per position and stat. The page's "Same point" baseline ranks four
  games against four games instead of four against seventeen. A stat with no such history
  (games played, a contract, the combine, the four in `PACE_SKIP`) keeps its ranking
  inside the season. It needs every finished season's raw files, so it is part of the
  full rebuild only, and a rebuild of a few seasons leaves it alone.
- **Recent form** (`weekly.py`, `form-4/8/17.json`). His last N games, reaching back into
  last season where this one has fewer (the row's `from` says so). Where the window is his
  whole season so far it is the card's own row, to the digit. Across the winter the two
  halves are joined the way the page builds a career out of seasons: a rate weighted by
  its own sample, a total added, a longest kept. Ranked against the same stretch for
  everyone else.
- **The estimate ("likely to settle") is the page's, not the pipeline's.** It needs the
  position's mean and the man's last season, both already in the browser. See the comment
  above `regressed()` in `football-savant.html`; `scripts/lib/savant-api-football.mjs`
  mirrors it for the connector and `tools/savant-football/check.mjs` holds the two together.
- **New sources fetched:** `advstats_week_pass`, `weekly_rosters` (current season:
  injured reserve, practice squad), `contracts` (Over the Cap, by way of nflverse; thin
  before about 2013) and ffopportunity's `ep_weekly` (expected fantasy points, 2006 on).

What still cannot be done with free data, and is not faked: who beat whom on a snap,
routes run (pass-play snaps stand in), snap-by-snap alignment, double teams, a kicker's
wind on a given kick.

### What the review of those additions turned up

An independent pass recomputed about 130 of the new rows from the raw files for every
player in 2025 and 2026. These were wrong and are fixed; several were wrong on the site
before the additions and only became visible because of them.

- **Two-point tries were plays.** They have no down, are not a carry, a throw or a target
  in the book, and are worth about a point of EPA either way. Left in, they were carries
  "inside the five", dropbacks inside the ten, and a tenth of a point per play on anything
  rare. Dropped once, in `pbp_agg.run_season`, and in `ftn_agg`, `onfield_agg`, `splits`
  and `route_agg`. Penalties and drive points still read the full play list.
- **Traded players had a part-season's charting divided by a whole season's games**
  (`load_pfr`: PFR's newer season files carry a row per club and a "2TM" total; the last
  club's row won). Sauce Gardner's 2025 read 17 targets allowed, not 45.
- **One code per franchise** (`teams.CANON`). The stat tables call the 2003 Raiders LV;
  the schedule, snap counts and PFR call them OAK. Matched as written, no Raider, Charger
  or Ram before the moves had a team record or a coach, their 2013-2019 seasons read
  LV -> OAK -> LV -> OAK, and their team-share rows were blank. Everything is joined on
  the play-by-play's code and the page prints the name the club had that season
  (`teams.ERA`, exported as `cfg.era`).
- **Jacksonville, 2001 and 2002.** The weekly stat table files every Jaguar under the
  visiting club for Jacksonville's home games. `build.team_swaps()` turns those rows round.
- **Target share, air-yards share and WOPR are now over the games he played.** The season
  table divides by every game his team played, so a receiver who drew a third of the
  targets for seven games and then got hurt read as a 12% target share.
- **Look-alike PFR ids** (`build.pfr_for`): "WoodPe00" in the 2026 snap counts is a rookie
  defensive tackle; in `players.csv` it belongs to a quarterback who retired in 1980. The
  lookup is now made per season and falls back to the snap file's own name.
- **Also:** playoff weeks in expected fantasy points before 2021; fumbled snaps counted as
  designed runs; a lateral's yards credited to the first receiver in the depth bands; a
  defensive touchdown counted in a team's receiving touchdowns; win probability added
  dropping a receiver's catches if he ever threw a pass; "longest completion in the air"
  reading the longest throw; blocked kicks scored as misses against a curve with no blocks
  in it; a drive extended by a penalty counted as a three-and-out; points per drive at a
  flat seven; an extension's years counted from the signing; a pass rusher's share of
  team pressures taken against a different count; missed-tackle rate over a tackle count
  that was 85% of the real one; the in-season run-snap estimate 15% high; offseason depth
  charts deciding a lineman's spot in season.

Known and left: the lineup file sometimes credits a new arrival with his predecessor's
snaps in the week before he joined (three cases found in 2025), which touches the season
on/off rows only.

## Savant value and the All-Savant Team (`award.py`)

The All-Savant Team used to be the best plain average of five hand-picked percentiles at
each spot. That gave a stat that is mostly the player's the same say as one that is mostly
his teammates' or luck, had no place for games missed, and in a season in progress it
leaned on last year through the "likely to settle" estimate. `award.py` replaces it with one
number, `sav` (Savant value): expected points a player has been worth this season above a
replacement at his position. `build.py` stamps it on every qualified row once a season's
players are all built, so the archive and the twice-daily refresh both carry it, and the
page's team is simply the highest value at each spot.

How it is put together (the docstring in `award.py` has the detail):

- **The job, by position** (`FACETS`). A quarterback: passing, designed runs. A receiver:
  earning targets, what he does with one. A corner: coverage, ball production, flags, run
  support. Under each, every stat that measures quality there. Usage and style rows are
  left out. This list is the one judgement in the method.
- **How much of a stat is luck** (`fit_k`). Every qualified player-season's games are dealt
  alternately into two piles and the stat rebuilt on each. Where the piles agree, the stat
  is telling the truth at that sample. That gives each stat a sample size K at which it is
  half truth, and a stat is pulled toward the position's average by n / (n + K). Target
  share settles in two games; EPA per target needs about 300 targets; a kicker's field
  goals over expected about 190 attempts. A stat with no game-by-game history borrows its
  twin's K (opponent-adjusted EPA from plain EPA), or its own site sample line scaled by
  how the measured K's in its facet compare with theirs.
- **How much of a stat is his** (`carry`). Year-to-year correlations since 1999, separately
  for players who stayed and players who changed teams (corrected for movers being a
  narrower group). A stat's weight inside its facet is its carry-over to a new team times
  how closely it tracks the facet's points; a stat with no measured carry-over gets no
  weight. The facet's credit is the share of its repeatable part that follows the player:
  0.46 for a quarterback's passing, 0.86 for a receiver earning targets, about 0.9 for a
  pass rush, 0.23 and 0.31 for the pass protection and run game on a lineman's snaps.
- **What a facet is worth** (`ANCHOR`, `POINTS`). The spread, across full-time players, of
  an anchor in expected points a game: EPA on his dropbacks, pressures and sacks at their
  measured cost, yards allowed in coverage, flags by type. The conversions were measured on
  2018-2024 play-by-play; worth is learned on 2013 on, where snap counts say who was
  full-time.
- **This season, on the field.** Points a game above the 25th-percentile player at the
  position, times the games' worth of his unit's snaps he has played. Nothing from last
  season enters it. Before 2013 there are no snap counts, and a man's share of snaps when
  active is taken as the usual one at his position. A season that tracks only some of a
  facet's stats moves a man less far from average on it, by how much of the whole those
  stats see (sacks alone against sacks, pressures and hits). A facet he has no numbers for
  at all counts as average.

Everything learned is learned the way it is used: on where a man stood inside his own
season and position. Measured on raw numbers across 26 seasons, the league's drift passes
for skill (every punter's two halves of 2023 agree that punts go further than in 2003, and
so do his 2023 and 2024), and so does the standing gap between a tackle and a centre. A
facet's credit is read only on seasons that see most of the facet: before 2018 a safety's
"coverage" is one stat about tackling after the catch.

`award_weights.json` holds everything learned (1999-2024; 2025 was held out). It is
committed (the `.gitignore` rule for this folder's JSON has an exception for it), and a
refresh or a rebuild only applies it; `stamp()` stops the build if the file is missing.
Relearn it on purpose, not by habit, and only after a full rebuild, because it reads the
archive and the finished seasons' game lines:

    python3 award.py fit                      # archive + game lines -> award_weights.json
    python3 award.py apply ../../public/football-savant-data.json   # restamp without a rebuild
    python3 award.py show ../../public/football-savant-data.json 2025

Checked against the AP's own teams, which it never saw: of its picks, 36% were AP first
team in 2018-2024 (the old method: 22%) and 54% first or second team (38%); on the held-out
2025 season 36% and 50% (23% and 36%, on thirty spots). The AP is a sanity check, not the
target, and nothing was tuned toward it: the last round of corrections to the fit took the
2018-2024 figure down from 40%.

Three judgements beyond the list of facets, each because the measurement could not be made:

- **A quarterback's designed runs take a running back's credit** (0.46). No quarterback who
  runs by design changed teams as a starter between two seasons in the years learned on;
  the hundred or so who did move top out at one point a game, where the number is noise, so
  "does it follow him" reads zero and means nothing. The facet is his designed-run EPA per game
  (`desepa`, kneel-downs, fumbled snaps and scrambles out; a scramble is a dropback and is
  already in his passing). Yards per designed run is not in it: a sneak gains a yard and is
  worth a first down.
- **A lineman has a value only where a season has blocking numbers for him** (2016 on, the
  season in progress included). Penalties alone would rank linemen on the one thing known
  about them.
- **A kicker keeps all the credit for his kicks.**

What it cannot do. A lineman's value is still mostly his line's play while he was on the
field (nothing free says who lost a block), so linemates rise and fall together and the
line picked "by player" is often most of one line: after four weeks of 2026 it was five
49ers. A corner's coverage numbers barely repeat even for a man who stays put, so plays on
the ball carry as much of his value as coverage does; a safety's follow him to a new team
hardly at all, and his coverage part stays within a point of average over a season. Before 2018
there are no coverage numbers at all (a safety from 2006 has one row, yards after the catch
on his tackles, worth a fraction of a point): a defensive back in those seasons is picked
on passes defended, interceptions, flags and tackling. A running back's receiving follows him to a new team
far better than his rushing does, so backs who catch passes rate higher here than a
rushing title would put them. Before 2016 the page still picks the line as a unit.

**Corner or safety, by season** (`build.secondary_spot`). The player file holds one position
per career, the latest, and it was being applied to every season: Jalen Ramsey's years at
corner were ranked among safeties, and a nickel back the file calls a safety could not be
the team's slot corner. A defensive back's position now comes from that season's own
sources, in order: the depth chart (the ESPN-sourced one from 2025, `roles_agg.py`; the
NFL's weekly one for 2001-2024, `roles_agg.secondary_spots`, the side of the secondary it
listed him on most, starters double), then the snap counts (2012 on), then the depth chart
of his nearest season within three years (`roles_agg.nearest_secondary_spot`), then the
career value. The snap counts come after the depth chart because they lag a move: they
still had Kareem Jackson at corner in 2019, his first year at safety. The nearest-season
step is what sorts out 1999, 2000 and 2004 (whose depth-chart file is a third empty): the
season table calls half the secondary plain "DB", and `POS_MAP` files a DB at corner, so
Donovin Darius and Sammy Knight were ranked among cornerbacks. In all 1,375 player-seasons
changed sides (844 of them qualified), 869 from corner to safety. The twice-daily refresh only
downloads two seasons, so that step finds nothing there; it has not been needed in a
season with snap counts.

**Four fixes to the numbers underneath, found while checking this.**

- *Counts nobody recorded* (`build.note_untracked`). The season stat table has a zero for
  every player's tackles for loss from 2003 to 2011 and quarterback hits from 2003 to
  2005. Those zeros were printed and ranked. The rows are now blank in those seasons, and
  the one "1st in tackles for loss" badge they produced is gone. A count is called
  unrecorded when the league has under a tenth as many as it has sacks.
- *Two men, one name* (`build._shared_names`). The all-seasons charting file loses track of
  namesakes: it leaves the id blank (from 2024: Byron Murphy, Byron Young, Jaylon Jones) or
  prints each row under both ids (the David Longs 2019-22, the Michael Carters 2023). The
  first lost a starting corner's whole coverage line; the second gave both men whichever
  row came last. Sixty rows are now matched by team and position.
- *A zero that was a blank.* A quarterback with no called run had no designed-run rows
  (now 0), and before snap counts a defender with no run stop had no run-stop row (now 0).
- *A blank that was a zero.* The all-seasons charting file leaves a few men out of a
  finished season; their rows are now summed from the weekly files, as a live season's are
  (`load_pfr`), where before their pressure rate was printed as zero.

## The offensive line, specifically

A lineman has no box score, so his card is built from three different kinds of claim and the
metric table keeps them in separate sub-sections because they are not equally his:

1. **His own** — penalties by type (play-by-play attributes flags to a player, 92–100%
   complete back to 1999), snaps, snap share, games started, positions played.
2. **The unit's, on his snaps** — pressure rate allowed, sack rate allowed, EPA per dropback,
   rush success, stuffed rate. Five linemen share a huddle, so two teammates who never leave
   the field post *identical* numbers. This is presence, not performance.
3. **On/off** — the same rates differenced against his team's totals without him. The only
   open-data figure that tries to separate one blocker from the four beside him, and it is
   deliberately absent for anyone who never came off the field, because there is nothing to
   difference against. Roughly 60% of qualified linemen have a usable off-field sample.

Comps for the line exclude teammates, for the same reason: on unit-derived stats a lineman's
four closest matches are otherwise always the four men next to him.

## Coaching Savant, specifically

Three measurement decisions carry the whole thing:

1. **The spread is the expectation.** A coach's record says as much about his roster as
   about him. The closing line already prices the roster in, so wins above what the spread
   implied — and the average margin against it — are the closest thing to a fair test.
   The spread-to-win-probability curve is read empirically off 27 seasons rather than fitted.
2. **Tendencies are measured in neutral game states only** — first three quarters, win
   probability between 20% and 80%. Everybody throws when losing and runs when ahead, so
   without that filter "pass rate" mostly measures whether a coach was winning.
3. **Fourth-down aggression is measured against the same spot.** The league's go-for-it rate
   in that distance and field-position bucket is the baseline, and only neutral game states
   count — otherwise trailing teams look bold and every winning coach looks timid. Measured
   this way the metric centres on zero, which is the check that it is working.

## Things worth knowing before you change it

- **Percentiles are not computed here.** The page computes them, because the reader changes
  the cohort and the baseline (this season vs all-time) at will. This file ships values and
  denominators; the browser does the ranking.
- **Five era edges, and they are load-bearing.** 1999 play-by-play, 2006 air yards, 2012
  targets, 2013 snap counts, 2016 tracking, 2018 charting. A metric is dropped from any
  season older than its tier — `build.py` enforces it on write and the page enforces it
  again on render.
- **Targets do not exist between 2000 and 2011.** The old gamebooks only named a receiver on
  completions, so `receiver_player_id` is present on roughly 10,000 plays a year instead of
  18,000. Everything per-target starts in 2012; receptions, receiving yards and yards per
  reception carry the older cards, and receivers fall back to catches to qualify.
- **PFR's percent columns are inconsistent.** `advstats_season_pass` stores percentages
  (0–100); `advstats_season_rec` and `advstats_season_def` store fractions (0–1). `build.py`
  scales the latter two.
- **`games` in the season table is not games played.** It counts games in which the player
  recorded a *stat*. For skill players and defenders that is every game; for an offensive
  lineman it is only the games he was flagged in, which reads a 16-game Trent Williams
  season as five games and silently corrupts availability, snaps-per-game and penalties-per
  -game. `build.py` prefers the games count from snap counts, then participation.
- **`json.dump` will happily write `NaN`,** which is not JSON and which `JSON.parse` rejects
  for the whole file. `clean()` strips it and the dump runs with `allow_nan=False`.
- **Scrambles count as carries** in the box score, so `pbp_agg.py` includes them in the
  rushing aggregate — otherwise a quarterback's EPA-per-carry and his yards-per-carry would
  be computed on different denominators.

## Coaching Savant, specifically

Three measurement decisions carry the whole thing:

1. **The spread is the expectation.** A coach's record says as much about his roster as
   about him. The closing line already prices the roster in, so wins above what the spread
   implied — and the average margin against it — are the closest thing to a fair test.
   The spread-to-win-probability curve is read empirically off 27 seasons rather than fitted.
2. **Tendencies are measured in neutral game states only** — first three quarters, win
   probability between 20% and 80%. Everybody throws when losing and runs when ahead, so
   without that filter "pass rate" mostly measures whether a coach was winning.
3. **Fourth-down aggression is measured against the same spot.** The league's go-for-it rate
   in that distance and field-position bucket is the baseline, and only neutral game states
   count — otherwise trailing teams look bold and every winning coach looks timid. Measured
   this way the metric centres on zero, which is the check that it is working.

## Things worth knowing before you change it

- **Percentiles are not computed here.** The page computes them, because the reader changes
  the cohort and the baseline (this season vs all-time) at will. This file ships values and
  denominators; the browser does the ranking.
- **Five era edges, and they are load-bearing.** 1999 play-by-play, 2006 air yards, 2012
  targets, 2013 snap counts, 2016 tracking, 2018 charting. A metric is dropped from any
  season older than its tier — `build.py` enforces it on write and the page enforces it
  again on render.
- **Targets do not exist between 2000 and 2011.** The old gamebooks only named a receiver on
  completions, so `receiver_player_id` is present on roughly 10,000 plays a year instead of
  18,000. Everything per-target starts in 2012; receptions, receiving yards and yards per
  reception carry the older cards, and receivers fall back to catches to qualify.
- **PFR's percent columns are inconsistent.** `advstats_season_pass` stores percentages
  (0–100); `advstats_season_rec` and `advstats_season_def` store fractions (0–1). `build.py`
  scales the latter two.
- **`games` in the season table is not games played.** It counts games in which the player
  recorded a *stat*. For skill players and defenders that is every game; for an offensive
  lineman it is only the games he was flagged in, which reads a 16-game Trent Williams
  season as five games and silently corrupts availability, snaps-per-game and penalties-per
  -game. `build.py` prefers the games count from snap counts, then participation.
- **`json.dump` will happily write `NaN`,** which is not JSON and which `JSON.parse` rejects
  for the whole file. `clean()` strips it and the dump runs with `allow_nan=False`.
- **Scrambles count as carries** in the box score, so `pbp_agg.py` includes them in the
  rushing aggregate — otherwise a quarterback's EPA-per-carry and his yards-per-carry would
  be computed on different denominators.

## Coaching Savant

`coaches.py` builds it, from four layers with four start years:

| Layer | Source | From | Credited to |
|---|---|---|---|
| Records, wins vs the spread | nflverse schedule | 1999 | head coach |
| Style (pass rate, tempo, 4th-down go rate) | play-by-play | 1999 | head coach |
| Fourth-down decisions | nfl4th's precomputed model (`raw/nfl4th.rds`) | 2014 | head coach |
| Units: tendencies, toolkit, personnel, coverage, the Tell Grid | play-by-play + FTN (2022) + participation (2016/2018) | 2018 | **the play-caller** |

Three files are hand-curated, because no open dataset holds them:

- `coach_tree.py` — who coached under whom.
- `play_callers.py` — who called each team's offence and defence each week since 2018. A
  trailing `?` marks a row no report confirms; the page tags it "unconfirmed".
- `play_callers.py` also carries `HC_FIXES`: the nflverse schedule's coach columns stopped
  following in-season changes in 2024 and carried three 2025 head coaches into 2026. Each
  fix is a team, the first day the new man was in charge, and his name.

`coach_units.py` builds the units and the decisions; `coach_identity.py` the fingerprints,
comps, arrival effects and mentor distances.

Two ways to run it:

```bash
python3 coaches.py                                       # the whole archive
NFL_SEASONS=2026 COACH_BASE=../../public/coaching-savant-data.json \
  COACH_OUT=/tmp/full.json COACH_CURRENT=../../public/coaching-savant-current.json \
  python3 coaches.py                                     # the season in progress only
```

The second is what the daily refresh Action runs, after Football Savant's own refresh. It
rebuilds only the current season, carries every other season over from the archive
(byte-identical to a full build — checked), and writes the overlay the page lays over the
archive. The full-rebuild Action rebuilds the archive itself.
