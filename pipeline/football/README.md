# Football Savant pipeline

Builds the two data assets `public/football-savant.html` reads:

| Output | What it is |
|---|---|
| `public/football-savant-data.json` | the metric table (`cfg`) plus every player-season, 1999–2025 |
| `public/football-maps/<season>.json` | throw maps, target maps and run-gap maps, loaded on demand |

Everything comes from [nflverse](https://github.com/nflverse/nflverse-data/releases) — open
data, no scraping, no keys. `FOOTBALL-SAVANT-RESEARCH.md` at the repo root is the argument
behind the metric choices; `metrics.py` is that argument in code.

## Run it

```bash
cd pipeline/football          # or anywhere — the scripts take paths from env vars
mkdir -p raw agg maps
./fetch.sh                    # ~750 MB of source data into raw/
python3 pbp_agg.py            # play-by-play -> weekly per-player aggregates in agg/
python3 maps.py               # agg/ -> maps/<season>.json + maps/index.json
python3 build.py              # everything -> football-savant-data.json
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
- **`maps.py`** — turns those aggregates into the field maps, one file per season.
- **`build.py`** — joins the season tables, PFR charting, Next Gen Stats, snap counts, the
  combine and ESPN QBR; computes every metric; fits the season-by-season field-goal
  make-rate curve behind FG-over-expected; and precomputes statistical and weakness comps.
- **`teams.py`** — team names and primary colours, including the franchises that moved
  inside the window (STL, SD, OAK).

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
- **`json.dump` will happily write `NaN`,** which is not JSON and which `JSON.parse` rejects
  for the whole file. `clean()` strips it and the dump runs with `allow_nan=False`.
- **Scrambles count as carries** in the box score, so `pbp_agg.py` includes them in the
  rushing aggregate — otherwise a quarterback's EPA-per-carry and his yards-per-carry would
  be computed on different denominators.
