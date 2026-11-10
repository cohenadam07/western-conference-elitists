# College Football Savant: research pipeline (prompt 1 of 2)

Research only. Nothing here writes to `public/`, touches the connector or adds a workflow.
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
