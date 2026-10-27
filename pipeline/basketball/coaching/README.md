# Basketball Coaching Savant — the pipeline

The engine behind `public/basketball-coaching-savant.html` (wcehoops.com/basketball-coaching-savant.html):
every NBA head coach, judged from the floor up. Spec: *Basketball Coaching Savant: the spec (v2,
decisions made)*, Oct 27, 2026, in the Claude project. Build notes and the review list:
`BUILD-NOTES.md` beside this file.

## Where things come from

| module | what | source | seasons |
|---|---|---|---|
| `br_coaches.py` | every coach, his records by season and team, assistant stints, awards, Coach of the Year voting, hire and fire dates, bio | Basketball-Reference coach pages (cached under `~/Basketball-Savant/cache_br/coaches/`, 3.5 s between requests) | 1946-47 on |
| `br_odds.py` | preseason win totals, with the source page per season | Basketball-Reference preseason odds pages | 1996-97 on (none for the 1999 lockout) |
| `espn_games.py` | every game's play-by-play, box score, officials, venue, closing line | ESPN's site API, cached per game under `~/Basketball-Savant/espn-cache/<season>/` (the Basketball Savant cloud refresh's normalizer, plus an `extra` block) | 2002-03 on, playoffs and play-in included |
| `nba_pulls.py` | team game logs, the player index (draft slots), staff tables, team tracking, hustle, Synergy, zone | stats.nba.com through the engine's cache (`~/Basketball-Savant/cache`) | each table from its own first season |
| `teams.py` | franchise ids across sources, abbreviations by season, the arena table (coordinates, time zone, altitude) and neutral-site cities | hand-made, sourced in the file | 1996-97 on |

## The engines

| module | what it computes |
|---|---|
| `gamefile.py` | one game: stints with the score, possessions and what started each, timeouts and the runs around them, after-timeout possessions, challenges and their results, foul-trouble spells, fouling up three, two-for-ones, end-of-period possessions, clutch, garbage time, team box and shot diet by zone, players' intervals on the floor |
| `process.py` | a season of games through `gamefile`, players mapped to NBA ids (the archive's own join), games joined to NBA game ids → `out/bcs/games/<season>.json.gz` |
| `registry.py` | who the coaches are and who coached each game: Basketball-Reference records pinned to the schedule (a split season is cut where the running record equals the first man's), `HC_FIXES` for acting coaches, staffs merged from both sources |
| `context.py` | the games table: results and every context column (opponent strength as of the date, rest, travel, time zones, altitude, missing regulars and their impact, officials, the closing line, win-probability extremes, season phase, roster age) |
| `rotation.py` | the Rotation Map: on-floor share by minute on two bases, usual windows, off-script minutes by cause, shape, closing, foul sits, months |
| `units.py` | five- and two-man units, pairs and With/Without from the stints, luck- and sample-adjusted the way the Lineups tab does it |
| `expect.py` | the talent expectation (prior-season impact weighted by prior-season role, rookies by draft slot; fitted out of sample) and the market (win totals, the spread curve) |
| `cts.py` | one coach-team-season: results, game management, identity, splits, minutes vs impact, playoffs |
| `nbatables.py` | the NBA's team tables read from the cache (or the Mac's tracking upload in the cloud) |
| `modules.py` | careers and pools, percentiles, fingerprints and comps, development against the aging curve, the fair-minutes line, the projection from parts, mentor suggestions, scouting lines |
| `config.py` | the registry of every stat: label, group, kind, unit, direction, settle point, first season, explainer |
| `coach_tree_nba.py` | the tree's editorial layer: hand corrections to the suggested mentors, each with its source |
| `build.py` | the two-pass build: per season, then league-wide; writes `public/bcs/` |
| `refresh_live.py` | the season in progress after a slate: fetch, process, merge-mode build |

## Running it

```
# one time, on the Mac (the crawls are polite and slow)
python3 br_coaches.py fetch                      # ~40 minutes
python3 br_odds.py
python3 espn_games.py fetch 2002-03 2026-27      # ~15 minutes
cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/coaching/nba_pulls.py 1996-97

# every build
python3 process.py 2002-03 2026-27               # ~10 minutes the first time; skips seasons already read
python3 registry.py
python3 build.py                                 # ~2 minutes; writes public/bcs and out/bcs/bundles
bash publish_bundles.sh                          # the saved bundles -> branch bcs-bundles, for the cloud's merge mode

# the season in progress (what the cloud runs after every slate)
python3 refresh_live.py [--tracking <the Mac's upload>]
```

Checks: `npm run check:savant-bcoaching` (the files, the page and the connector against each other),
`npm run check:connector-coverage`.

## Four habits worth keeping

- Every constant that could be measured was: the talent line, the fair-minutes line, the projection
  from parts, the spread curve, the lineup k, the rookie priors. Each is written to `index.json`'s
  `meta.fits` with its sample and its out-of-sample score.
- Negative results are recorded: the archetype pairing effects did not add out-of-sample variance
  explained on 6,918 units and are dropped (`meta.fits.parts.note`); of the four lineup pairings
  retested the study's way (`pairings.py`, team-season fixed effects, discover on even seasons and
  replicate on odd) only spacer + stopper kept its sign in both halves with a pooled estimate past
  p < .05, and it alone is in the projection (`meta.fits.pairings`); the NBA's staff table names
  next season's coach as often as this one's, so it is a cross-check, not a source.
- Nothing ships without an explainer: a stat is one entry in `config.STATS`, and the connector's
  dictionary and the page's click-through both read it.
- The rotation verdicts are the model's view, not a verdict, and every surface says so.
