# Basketball Savant: open follow-ups

Found while building Matchup difficulty (creation-weighted), `mtchc`, Basketball Savant 2.7.0
(Nov 2026). None of these was fixed on that branch; each was set aside on purpose. Strike an item
through, with the commit, when it is done.

## 1. Re-measure every settle point

`tools/savant-settle/settle.json` was last measured Oct 29, 2026. The Oct 30 position relabel
(`7502cfe482`, labels follow the position estimate) changed which seasons count as a same-position
pair, so a fresh `python3 tools/savant-settle/measure.py` moves nearly every stat (season-to-season
pairs down about 9%, for example 6,792 -> 6,201 for the 30-season ext stats), and with it the
calibration factor. `mtch` would go from hatched under 530 / settles around 1,500 to 630 / 1,400.

- The `mtchc` entries (`mtchc`, `mtchc_score`, `mtchc_create`, `mtchc_overall`) were measured on
  the current data and added alone; everything else was left as measured on Oct 29.
- A full re-measure is a site-wide change to every hatched bar and explainer: run measure.py,
  then apply.py, and review the diff before shipping.
- measure.py now keeps the data-only ext stats (ext_config scope "data") when it re-measures.

## 2. `ddiff` does not reproduce from the data on disk

Defender difficulty (the matchup-weighted DBPM of the defenders who guarded a player) does not
come back out of `inject_ddiff.apply_season` run on the archive's own DBPM and the cached
LeagueSeasonMatchups: only 2-69 of about 550 players a season match the published value, before
any of the 2.7.0 changes. So it was built from different DBPM, a different matchup table, or
different code.

- 2016-17 is blanked (the matchup table is a stub there) and nothing else about it was touched.
- The Basketball Reference name fix (262 player-seasons gained DBPM) would move ~30-110 players'
  ddiff a season by up to 0.7 if it were rebuilt.
- Start with: which input differs (rebuild one season with the published DBPM held fixed, then
  with the table held fixed).

## 3. `oppfg`: why the NBA's matchup revision moves it so much

The NBA revised LeagueSeasonMatchups for 2024-25 and 2025-26 after the archive was built (July
13, 2026). Rebuilt from the revised tables, `mtch` barely moves (mean 0.12, ranking Spearman
0.997; matchup possessions per defender down 7.6% and 4.1%). `oppfg` from the same tables and the
same engine function (`savant_engine.matchup_stats`) would move 2.2-2.3 percentage points on
average (max 49.4 and 29.0) with the ranking down to Spearman 0.85-0.86: shots defended fall
about 11%, so the revision is not a uniform rescale.

- Adam's call (Nov 18, 2026): don't rebuild it. Investigate first.
- `python3 tools/savant-mtchc/rebuild_mtch.py --check 2024-25 2025-26` prints the comparison;
  `--keys mtch,oppfg` would write it.
- Questions: which defenders' shots moved (by position, by team), whether the revision
  re-attributed shots between defenders (help vs primary), and whether the league matchup FG%
  itself changed.

## 4. The connector's usage-log check fails on main

`tools/savant-mcp/check.mjs`, test "the usage log: counts only, one command a write, capped, and
never in the way" (line ~611): expects one store write per command and sees two (`2 !== 1`). It
fails on a clean checkout of main, independent of any Savant data. Cause found Nov 19: a time-bomb in
the test (see PRE-EXISTING-TEST-FAILURES.md).

## 5. Football Savant's accented-name search test

`tools/savant-football/check.mjs` (~line 1023), "search finds players the way people type their
names": a search returns `Audric Estime` where the test expects `Audric Estimé`. No football file
differs from main on the 2.7.0 branch, so it is the football data or the search itself. Cause found Nov 19: the 2026 in-season file spells
him without the accent (see PRE-EXISTING-TEST-FAILURES.md).
