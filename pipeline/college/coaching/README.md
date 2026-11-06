# College Basketball Coaching Savant — the pipeline

The engine behind `public/college-basketball-coaching-savant.html`: every men's Division I head coach, judged
from the floor up. Spec: *College Basketball Coaching Savant: the spec (v1, decisions made)*, Nov 5, 2026.
Shipping notes, every check and the review list: `COLLEGE-BASKETBALL-COACHING-SAVANT.md` at the repo root.

It builds on College Basketball Savant (`pipeline/college/`) and never re-pulls what it has: the ESPN raw
archive, `rebuild.py`'s lineups, stints, possessions and safe-lead rule, the season files' Savant value and
rate, College Savant's team ratings, and its cached CBBD rosters, recruits and lines.

## Where things come from

| module | what | source |
|---|---|---|
| `espn_coaches.py` | ESPN's season coaches: coach id, name, birthdate, team, W-L | ESPN core API, cached under `out/cbcs/espn-coaches/` |
| `wiki.py` | program histories (yearly records, coach lists, tables) and coach biographies (head and assistant stints) | Wikipedia's API, 50 titles a request, 1.1 s apart, raw cached under `out/cbcs/wiki/raw/` |
| `wiki_seasons.py` | team-season articles: head coach, interim tag, record, assistants | the same |
| `polls.py`, `tourney.py` | AP polls every week; NCAA Tournament games and seeds (checked against Wikipedia's bracket every year); NIT, CBI/CIT/Crown, conference tournaments | ESPN core API; the ESPN raw archive; Wikipedia |
| `eada.py` | men's basketball expenses, revenues and coach counts per school-year | U.S. Department of Education, Equity in Athletics |
| `games.py` | every game through College Savant's `rebuild.py`, plus team and media timeouts, challenges, fouls, live-ball turnovers, the timeout's caller on each possession | the ESPN raw archive, 2013-14 on |

## The engines

| module | what it computes |
|---|---|
| `registry.py` | one head coach per team-game: the infobox, the program list and ESPN, reconciled; split seasons cut by the running record; interims; every row sourced |
| `rosters.py` | where every player-season came from (returning, transfer, high school, JUCO or non-D1, international), his next stop, WCE's recruiting class score; the portal cross-check |
| `expect.py` | the roster model (the headline) and its out-of-sample test against last season's net and the preseason AP rank; AP context; wins above the spread |
| `develop.py` | change in Savant rate against D1's expectation for the class step and level |
| `rotation.py` | the Rotation Map on a 40-minute clock (halves from `config.PERIODS`), off-script causes, closing, early-foul sits |
| `units.py` | five-man units and pairs; lineups judged from their parts, and the test that labelled it unvalidated |
| `cts.py` | one coach-team-season: results, game management, identity, splits; ratings as of each game date |
| `fit.py` | profiles and coaches' systems; the portal test that decided the label ("similar players under him") |
| `modules.py` | percentiles, careers, comps, mentors, scouting lines (Basketball Coaching Savant's, copied) |
| `config.py` | the stat registry and the rules by season (timeouts, media windows, challenges, foul trouble) |
| `build.py` | the two-pass build; `--merge <season>` rebuilds one season against saved bundles |
| `cloud_cbcs.py` | the nightly refresh inside College Savant's cloud run, and the bundle the Mac pushes for it |

## Running it (the Mac)

```
python3 espn_coaches.py pull 2003 2027
python3 wiki.py all && python3 wiki_seasons.py fetch && python3 wiki_seasons.py parse
python3 polls.py pull 2003 2027 && python3 polls.py build
python3 tourney.py wiki && python3 tourney.py build
python3 eada.py download && python3 eada.py extract && python3 eada.py build
python3 games.py 2013-14 ... 2026-27          # about 30 s a season
python3 registry.py && python3 rosters.py && python3 expect.py && python3 develop.py && python3 fit.py
python3 build.py                               # full build, about 10 minutes; writes public/cbcs and out/cbcs/bundles
python3 build.py --merge 2026-27               # the season in progress only, about 2 minutes
python3 ../../../tools/savant-cbcoaching/assemble.py
python3 cloud_cbcs.py bundle <dir>             # then push <dir> to branch cbcs-bundles (Adam's call; see the notes)
```

Check: `npm run check:savant-cbcoaching` (also inside `check:savant`).

## Things that are not obvious

- **ESPN's TV timeouts.** In 0.1-2.6% of games a season ESPN logs no TV timeouts and the breaks come through
  as team timeouts; those games are left out of every timeout stat (`cts.py`), and the Data Room says which.
- **Challenges are read from the parenthetical.** ESPN's type id and the "charged with a timeout" clause each
  contradict it on part of 2025-26; the rule (a second challenge only after a win) sided with the parenthetical.
- **"Decided" is the last garbage run.** The safe-lead rule flags the final seconds of most close games;
  the Rotation Map's blowout cause starts at the final unbroken garbage run with a minute or more left.
- **Player rates are not fully schedule-adjusted**, so the roster model carries each returning or transferring
  player's old team's net beside his rate (R² .62 to .74). For a returner that includes last season's team.
- **No CBBD row leaves the Mac.** `public/cbcs` and the cloud bundle carry WCE's numbers only; the check scans
  every published file for CBBD's field names.
- **College Savant's `tools/savant-cbb/page-src` predates its 1.3.0**, which was edited straight into the HTML.
  Running its `assemble.py` drops 1.3.0. This build's two additions were made to the published HTML too.
