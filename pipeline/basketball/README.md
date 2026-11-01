# Basketball Savant pipeline

The engine behind Basketball Savant (wcehoops.com/basketball-savant). The 1979-80 to 2025-26
archive (`public/savant-data.json`) is built on Adam's Mac from stats.nba.com; the season in
progress is rebuilt in the cloud.

## The in-season refresh (cloud)

`.github/workflows/basketball-savant-cloud.yml` runs `cloud_refresh.py` after every slate
(a 15-minute check, `cloud_publish.py check`) and twice a day regardless. stats.nba.com and
cdn.nba.com refuse cloud servers, so:

| piece | what it does |
|---|---|
| `espn_source.py` | fetches every final game of the season from ESPN's public site API (box score + play-by-play), cached per game |
| `espn_tables.py` | rebuilds lineups from substitutions, possessions the NBA's way (credited to everyone on the floor for any part of one), and shots |
| `espn_shim.py` | answers the engine's stats.nba.com requests with those tables, NBA column names and all; tracking / Synergy / hustle requests fail on purpose |
| `cloud_refresh.py` | maps ESPN player ids to NBA ids (`seed/espn_ids.json`), keeps the player index current, runs `refresh_current.py`, `projections.py` and `teams_engine.py` unchanged |
| `cloud_publish.py` | the slate check and the publish step (season file, projections, teams, lineups, heartbeat) |
| `seed/` | the NBA tables that don't change in season (earlier seasons, combines, player info, the shot model), from the Mac's cache via `record_tables.py` |

Not reachable from the cloud: the NBA's tracking, Synergy and hustle tables (drives, potential
assists, self-created, rim protection, deflections, gravity, matchups, play types, and what is
built on them). The Mac fetches those when it's awake: `publish_tracking.sh` (launchd
`com.wcehoops.basketball-savant-tracking`, 4:30 and 10:30am ET and on wake) runs
`export_tracking.py` and force-pushes just those tables to the `tracking-data` branch, which
starts a cloud run that uses them. The Mac never writes the site's files, so the two can't
overwrite each other; the season file's `tracking.through` says how current they are.

Checked against the NBA's own numbers (details: `claude/basketball-savant-cloud-refresh.md`
in the Claude project): 2025-26 rebuilt from ESPN matches the published archive at
correlation 1.000 on every box-score, shooting and rate stat, 0.998 on shot quality and
0.966 on on/off; usage is scaled by 0.988 (`espn_shim.USG_SCALE`).

Run it locally: `cd somewhere && mkdir -p out && cp <repo>/pipeline/basketball/seed/out/* out/ && python3 <repo>/pipeline/basketball/cloud_refresh.py`.

## Position labels, same-age pools, With/Without (2.6.0)

`position_labels.py` derives Guard / Wing / Big from the position estimate (Big: C at least a third, or PF + C at least 60 and playing like a big on the score in that file); `refresh_current.py` applies it to the season in progress, `python3 position_labels.py archive` to the archive (safe to rerun: rows keep today's label in `pos0`; it also writes `seed/big_scale.json`, which the refresh reads). A label change means rerunning `build_ext.py --players-only`, `tools/savant-value/value.py fit`, `gen_weakness_comps.build` and `coaching/build.py`.

A run Basketball Reference doesn't answer keeps the last published value bars, estimates and counts (`br_keep.py`; `stale` in the season file says so). A player with no estimate at all goes to `position_labels.apply_fallbacks`: the stints, Draft Savant, the listed position.

`age_pools.py` writes `public/savant-ext/age/`, finished seasons only; `build_ext.py` rebuilds it.

`coaching/withwithout.py` writes `public/bcs/ww/` from the ESPN cache. `refresh_live.py` runs it for the season in progress; finished seasons are committed. `espn_tables.parse_game` keeps each player's counts per stint for it. The sums are `public/savant-ww.js`, one file for the card and the connector, and `tools/savant-settle/measure_ww.py` measures its on-court settle points.

A full `coaching/build.py` run changes history, so push its bundles with `publish_bundles.sh`: the cloud's merge mode reads them, and old bundles would put the old numbers back.
