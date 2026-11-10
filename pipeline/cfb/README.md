# College Football Savant: the pipeline

Prompt 1 built the research half (the table below); prompt 2 built the product on it (the second table).
The report is `research/cfb/BACKTEST.md`; result tables are in `research/cfb/out/`, charts in `research/cfb/charts/`.
Raw downloads, caches and intermediate tables live outside the repo in `~/College-Football-Savant/` and never go in git.

Run from the repo root as `python -m pipeline.cfb.<module>`, in this order:

| step | module | what it does |
|---|---|---|
| setup | `pull_releases.sh` | downloads the sportsdataverse-data release files (parquet, no key) |
| 1 | `inventory` | columns and row counts by season for every file family |
| | `plays games` / `plays plays` | the games table and one slim row per play (the only reader of the 506-column files) |
| 2 | `completeness` | the two gates, by season |
| 3 | `espn_live`, `espn_http` | live ESPN feed against the release files; shared fetcher (6 in flight, cached, logged) |
| 4 | `cfbd check` / `cfbd pull` | counted, capped, cached CFBD client. Never prints the key |
| 5, 6 | `ep fit` / `ep score` / `ep report` | expected points, win probability, EPA for every play, garbage-time flags |
| | `teamgame`, `playergame` | every numerator and denominator the studies need |
| 6, 7, 8 | `team_study garbage` / `stability` / `adjust` | garbage-time choice, team stability, opponent adjustment |
| 9 | `rating tune` / `rating run` | walk-forward power rating against the spread and FPI |
| 10 | `player_study` | player stability and settle points |
| 11, 12, 13 | `espn_awards`, `value` | positions, Savant value, All-Savant dry run, award check |
| 14, 15 | `resume fields` / `resume sim` | résumé score, retroactive fields, playoff-odds simulator |
| 16 | `espn_standings` | ESPN standings against game results |
| report 7 | `heads_check` | headshot coverage |
| 18 | `report` | assembles `BACKTEST.md` from the tables |

Python: 3.13 with pandas, pyarrow, numpy, scipy, scikit-learn, matplotlib, requests (a venv at `~/College-Football-Savant/venv`).
Memory: the Mac has 8 GB. Run one module at a time; two at once pushed it into swap and filled the disk.

## The product (prompt 2, version 1.0.0)

| module | what it does |
|---|---|
| `config` | the registry: every stat's label, group, verdict (from BACKTEST.md), unit, settle point, start season, explainer; the seasons on the site |
| `espn_feed` | ESPN as the primary feed: a season's finals (fetched in batches), the 2021-2022 backfill, the yard-line repair |
| `cfbd` | the CFBD client (`build`: recruits 2010-2026, portal 2021 on, coaches); counted, capped, never prints the key |
| `identity` | ESPN athlete id as the spine: school history, transfers, recruits, NFL ids, head coaches, team talent |
| `tiebreak` | the Power 4 title-game tiebreakers as published (`research/cfb/tiebreakers/TIEBREAKERS.md`), with tests |
| `state` | the frozen state the cloud needs instead of history (`pipeline/cfb/state/`) |
| `numbers` | one season's numbers: positions, every stat in four variants, Savant value, the All-Savant sets |
| `playoff` | today's field, conference leaders by tiebreaker, 20,000-season odds; past fields; rule tests |
| `heads` | which ESPN athlete ids have a headshot (asked once each) |
| `site` | the files under `public/cfb/` |
| `build` | `history` (the Mac), `refresh` (the cloud, daily in season), `site`, `active` |
| `refresh_check` | proves a refresh of the current season is byte-identical to the full build |
| `archive` | the raw ESPN responses, a month at a time, on the Mac only |
| `review` | the numbers behind the review list (`research/cfb/out/review.md`) |
| `cloud_run.sh` | what `.github/workflows/college-football-savant-refresh.yml` runs |

Full rebuild on the Mac, after new raw data: `espn_feed season 2026`, `ep score 2026`, `teamgame 2026`,
`playergame cfbd 2026` and `all 2026`, then `rating run`, `state build`, `heads`, `build history`, `build site`.
The 2009-2012 seasons also need `rating early`.
