# College Basketball Savant: the pipeline

Men's Division I. `public/college-basketball-savant.html`, data in `public/cbb/`, connector in
`api/_cbb.js`, check in `tools/savant-cbb/check.mjs`. Shipping notes and the review list are in
`COLLEGE-BASKETBALL-SAVANT.md` at the repo root.

## The map

| File | What it does |
|---|---|
| `espn_cbb.py` | Scoreboard sweep and the raw archive (rungs 0 and 1) |
| `cbbd_client.py` | The one door to CBBD: counted, capped at 600 calls a month |
| `cbbd_source.py` | CBBD plays per game: lineups and locations for old seasons, and rung 3 |
| `torvik.py` | Birthdates only, one URL, weekly |
| `normalize.py` | A summary to the normalized game |
| `join.py` | Adds CBBD's fives and locations to an ESPN game |
| `rebuild.py` | One game: lineups, stints, possessions, garbage time, zones |
| `season.py` | Every game of a season, the game-level gates, the season gates |
| `identity.py` | Who everyone is: one source per field |
| `aggregate.py` | One formula per stat. `rates()` serves seasons, splits and games alike |
| `ratings.py` | Our team ratings, the market's, and the walk-forward test |
| `adjust.py` | Opponent adjustment and the transfer test that picks the method |
| `positions.py` | Guard, wing, big: box estimate, height and listing blended, plus a size rule |
| `settle.py` | Settle points |
| `xfg.py`, `rapm.py` | Shot quality; box impact and RAPM |
| `context.py` | Play context from the possession log: starts, transition, after timeouts, clutch, the estimated shot clock, shot bins, rotation maps; the possessions Data Room |
| `confidence.py` | How sure each player's opponent adjustment is |
| `college_value.py` | Savant value: features, the floor part, replacement, `apply_doc`; the first (on/off) weight test |
| `team_fit.py` | The weights, fitted to team results; old against new; what drives the AP overlap |
| `allsavant.py`, `ap_check.py` | All-Savant Teams and honours; the AP check (never a target) |
| `cbbd_box.py`, `cbbd_box_plan.py` | CBBD box scores for games ESPN never recorded. Tried Nov 2: CBBD has the same gaps, so unused |
| `config.py` | The stat registry. A stat missing here does not exist |
| `build.py` | Everything to `public/cbb/`. `--merge <season>` rebuilds one |
| `fallback.py` | Rungs 3 and 4, and their diff reports |
| `archive.py`, `mac_pull.sh` | Rung 0 (private, on the Mac), rung 2, Monday's ages |
| `cloud_cbb.py`, `cloud_run.sh` | The nightly refresh |
| `full_build.sh`, `backfill.sh` | The Mac's full build; the seasons before 2022-23 (box tier: 2009-10, 2010-11 and 2013-14 on) |

## Things that are not obvious

- **ESPN logged no substitutions before mid-February 2025**, and coordinates on only 10-20% of
  games. CBBD has on-floor data from 2023-24 and locations from 2022-23, on ESPN's play ids.
  `ESPN_COMPLETE_FROM` in `cbbd_source.py` is the seam.
- **CBBD's `/plays/date` needs a full timestamp.** `2024-12-07` returns 502;
  `2024-12-07T00:00:00Z` works.
- **CBBD's participant order is random on assisted shots.** Use `shotInfo.shooter`.
- **ESPN's college JSON has raw control characters.** Parse with `strict=False`.
- **The repo is public.** Nothing from CBBD, no birthdate and no raw ESPN file may reach `public/`,
  `cbb-bundles` or a release. The raw archive stays on the Mac; `cbb-data` carries rung 2 encrypted. `tools/savant-cbb/check.mjs` holds `public/cbb` to that.
- **ESPN's season record gives a player's latest class**, not that season's. `identity.py` counts back.
- **ESPN has deleted some athlete records** in old box scores. `normalize.fill_missing` recovers them only when the points add up exactly.
- **Value's weights come from team results** (`team_fit.py`). Usage is fixed at zero: team results can't see it.
- **Never run `pgrep -f` on a string in the same shell line.** It matches itself (Nov 2).

## Full rebuild on the Mac

    python3 espn_cbb.py pull 2026-27 2025-26 2024-25 2023-24 2022-23
    python3 cbbd_source.py history 2024-25 2023-24 2022-23      # about 400 calls
    python3 torvik.py 2022-23 2023-24 2024-25 2025-26 2026-27
    ./full_build.sh
    python3 cloud_cbb.py bundle <dir>                           # then push it to cbb-bundles

Caches live in `~/Basketball-Savant/espn-cache/cbb` and `~/Basketball-Savant/out/cbb`.
