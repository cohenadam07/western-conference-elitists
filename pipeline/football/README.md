# Football Savant pipeline

Builds the two data assets `public/football-savant.html` reads:

| Output | What it is |
|---|---|
| `public/football-savant-data.json` | the metric table (`cfg`) plus every player-season, 1999–2025 |
| `public/football-maps/<season>.json` | throw maps, target maps and run-gap maps, loaded on demand |
| `public/coaching-savant-data.json` | every head coach since 1999, plus the curated coaching tree |

Everything comes from [nflverse](https://github.com/nflverse/nflverse-data/releases) — open
data, no scraping, no keys. `FOOTBALL-SAVANT-RESEARCH.md` at the repo root is the argument
behind the metric choices; `metrics.py` is that argument in code.

## Run it

```bash
cd pipeline/football          # or anywhere — the scripts take paths from env vars
mkdir -p raw agg maps
./fetch.sh                    # ~1 GB of source data into raw/
python3 pbp_agg.py            # play-by-play -> weekly per-player aggregates in agg/
python3 ftn_agg.py            # FTN charting + pbp -> weekly charted rates (2022+)
python3 line_agg.py           # depth charts -> which spot on the line each man played (2001+)
python3 onfield_agg.py        # participation + pbp -> who was on the field, and what happened
python3 maps.py               # agg/ -> maps/<season>.json + maps/index.json
python3 build.py              # everything -> football-savant-data.json
python3 weekly.py             # the same metrics, one game at a time -> public/football-weekly/<season>/
python3 coaches.py            # schedules + pbp -> coaching-savant-data.json
cp football-savant-data.json ../../public/
cp maps/*.json ../../public/football-maps/
```

Needs Python 3.9+ with `pandas` and `pyarrow`. Paths are overridable:
`NFL_RAW`, `NFL_AGG`, `NFL_MAPS`, `NFL_OUT`. Seasons too: `NFL_SEASONS=2026`,
`2024,2025` or `1999-2026` (default: 1999 through the current season — see `seasons.py`).

## In-season refresh (automatic)

The archive above is a full local run and changes a few times a year. The season in
progress is a separate, small file, rebuilt by `refresh_current.sh` and committed by the
GitHub Action in `.github/workflows/football-savant-refresh.yml`:

| Output | What it is |
|---|---|
| `public/football-savant-current.json` | the current season only (a few hundred KB, ~2 MB by January) |
| `public/football-maps/<season>.json` + `index.json` | that season's field maps; the index is merged, not overwritten |

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

What the automatic refresh cannot give you: the offensive-line on/off card, because FTN's
participation data is published after the season; and Coaching Savant, which needs every
season's play-by-play and stays a local run.

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

  The five line spots are the only part of a depth chart that is named consistently. The
  2024 file has 2,562 rows that simply say "CB" against 242 that say LCB, so slot corner
  and outside corner are **not** derivable from it and are not attempted.
- **`maps.py`** — turns those aggregates into the field maps, one file per season.
- **`build.py`** — joins the season tables, PFR charting, Next Gen Stats, snap counts, the
  combine and ESPN QBR; computes every metric; fits the season-by-season field-goal
  make-rate curve behind FG-over-expected; and precomputes statistical and weakness comps.
- **`weekly.py`** — the week-by-week charts. For every game a man appeared in it runs
  `build.py`'s own `build_player()` over that one week's inputs (weekly stat line, snaps,
  play-by-play and FTN aggregates, the week's Next Gen Stats row, ESPN's game-level QBR), so
  a game's number is worked out exactly the way the season's is. PFR's tables and
  participation are season-only and are not used; season totals (games, availability,
  starts, the combine) are dropped. One file per player, rewritten only when it changes.
  The refresh runs it for the season in progress; nothing earlier is shipped yet
  (`NFL_SEASONS=2025 python3 weekly.py` would backfill a season, ~9 MB each).
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

Week-level QBR now feeds the weekly charts (`weekly.py`, from `qbr_week_level.csv`). It
still isn't in recent-form windows (L4 / L8), because those don't exist yet; the game lines
in `public/football-weekly/` are what they would be built from.

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
