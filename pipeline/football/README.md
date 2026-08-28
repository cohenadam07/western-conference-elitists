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
python3 onfield_agg.py        # participation + pbp -> who was on the field, and what happened
python3 maps.py               # agg/ -> maps/<season>.json + maps/index.json
python3 build.py              # everything -> football-savant-data.json
python3 coaches.py            # schedules + pbp -> coaching-savant-data.json
cp football-savant-data.json ../../public/
cp maps/*.json ../../public/football-maps/
```

Needs Python 3.9+ with `pandas` and `pyarrow`. Paths are overridable:
`NFL_RAW`, `NFL_AGG`, `NFL_MAPS`, `NFL_OUT`.

## The files

- **`metrics.py`** — the metric table. One row per bar the tool can draw, carrying its
  panel, its layer (`ingredient` / `output` / `expected` / `context`), its unit, whether
  lower is better, which positional cohorts show it, which era first tracked it, and how
  much of which denominator it needs before it settles down. Also holds the panel order per
  position, the headline sets behind the career arc and the comps, and the qualifying lines.
- **`pbp_agg.py`** — one pass over each season's play-by-play, producing *weekly* per-player
  aggregates: success counts, air-yards lattices, run gaps, third downs, red zone. Weekly
  rather than seasonal because a season total can't be un-summed.
- **`onfield_agg.py`** — joins the participation release (the exact eleven on the field per
  play, plus `was_pressure`, 2016 on) to play-by-play, and accumulates what the offense did
  on each player's snaps, alongside his team's totals so the off-field half can be got by
  subtraction. This is the whole basis of the offensive-line card.
- **`maps.py`** — turns those aggregates into the field maps, one file per season.
- **`build.py`** — joins the season tables, PFR charting, Next Gen Stats, snap counts, the
  combine and ESPN QBR; computes every metric; fits the season-by-season field-goal
  make-rate curve behind FG-over-expected; and precomputes statistical and weakness comps.
- **`teams.py`** — team names and primary colours, including the franchises that moved
  inside the window (STL, SD, OAK).
- **`coaches.py`** — builds Coaching Savant. Records, playoff history and performance
  against the closing spread come from the schedule; play-calling and unit ratings come
  from play-by-play. Both are attributed **per game**, not per season, so a coach fired in
  week 9 gets exactly the games he coached and his interim replacement gets the rest.
- **`coach_tree.py`** — the coaching lineage. Hand-curated, because who assisted whom is in
  no open dataset. It is the one file here that can simply be wrong, which is why it is flat,
  editable and quoted verbatim in the UI.

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
