# Basketball Savant — The All-Savant Team (built Oct 20, 2026)

Our All-NBA team picked by analytics only, on the Basketball Savant landing page, modeled on Football Savant's All-Savant Team. Built as **Basketball Savant v2.2.0** on branch `all-savant-basketball` (main merged in). Status: **pushed, Vercel preview built, not merged** — waiting on Adam's OK. Merging also turns on the connector tool (a preview's connector reads production files).

## Adam's decisions (Oct 20)
1. Picked on our own **Savant value** (not BPM/VORP, not a profile score).
2. Shape: **2 guards, 2 wings, 1 big** per team, every season (positions as on the card, so Luka is a guard via POS_FIX).
3. **Missed games count against him** (value = rate x possessions played). No 65-game rule.
4. Look: **starting-five row** of portrait cards, 1st / 2nd team toggle.

## Calls Claude made (flip any of them on request)
- Landing shows last season's team until the season in progress reaches **10 games per team** (median team), with a note; the new season is in the picker from night one. `AST_MIN_GAMES` in the page and in `api/_basketball.js`.
- Placed under Trending now, above Build a Leaderboard. Season picker covers every season back to 1979-80.
- Tracking stats (rim protection, deflections, drives, potential assists) tested and left out: under 0.01 added to next-season correlation, and leaving them out keeps one method for all 47 seasons.
- A heavier ridge penalty predicts next season a little better but flips turnovers to a positive weight, so the penalty is chosen on same-season leave-one-season-out fit (1e5).

## Savant value, in plain words
Points a player added to his team that season above a replacement-level player at his position, on the stats that are his own and the possessions he played.
1. **The job.** Scoring (points over average efficiency on his own attempts, usage, 3PA rate, FT rate), playmaking (AST%, turnovers), rebounding (OREB%, DREB%), defense (steals, blocks).
2. **Luck.** Each stat pulled toward the position average by its settle point (SETTLE_K, k with no last season).
3. **Worth.** Ridge regression of luck-adjusted on/off on the stats, inside each season and position: 6,498 player-seasons, 2009-10 to 2024-25, 2025-26 held out. Minutes share is a control, then dropped. Per unit: sceff +1.28, usg +0.16, tp3r +0.05, ftr +0.02, ast +0.19, tov −1.21, oreb +0.30, dreb +0.04, stl +2.15, blk +0.67 (per 100).
4. **His own.** Credit = year-over-year correlation for team changers / stayers (franchise moves not counted as changes): sceff 0.79, usg 0.87, tp3r 0.96, ftr 0.94, ast 0.88, tov 0.88, oreb 0.95, dreb 0.93, stl 0.91, blk 0.95.
5. **The floor.** From 2009-10 the rate takes in what his luck-adjusted on/off says beyond the box score and his minutes, weight w/(w + 6,400), w = 1/(1/min on + 1/team min off): about 13% for a full-time starter. K fit on next season's on/off for team changers, 2025-26 excluded (all players gave 3,200, stayers 2,263; the cautious one is used).
6. **Value** = (rate − 25th-percentile qualified rate at his position) x possessions / 100.

Team check: slope 1.02, r 0.79 vs team luck-adjusted net (210 team-seasons, 2018-19 to 2024-25), so rates are already per-player points per 100 (all rates x 1.019). Traded players count fully for their last team in that check.

## Checks
- Next season's raw luck-adjusted on/off (no model in the target): over fit seasons rate .440, BPM .412, raw on/off .406 (K saw these). **Held-out 2025-26: rate .370, value .385, BPM .351.** Caveat: for the 116 held-out team changers the box part alone (.204) beat the full rate (.158) and BPM (.178).
- vs the real All-NBA (sanity only, never a target), 1988-89 on: 56% of our 1st team made the real 1st; 63% of our 1st+2nd made the real 1st/2nd; 75% made any All-NBA team.
- 2025-26 1st team: Gilgeous-Alexander +465, Dončić +361 (G); Leonard +349, Antetokounmpo +204 (W); Jokić +495 (B). 2nd: Mitchell, Murray (G); Murphy III, Barnes (W); Wembanyama (B).
- `npm run check:savant-value` 11/11 (JS = value.py on every player of 4 seasons; every season fields two full teams); check:savant-api 11/11 (files match the page, values rounded as printed); check:savant-mcp 16/16 with the new tool; vite build OK.
- Independent review (Oct 20): JS vs Python on all 47 seasons, max diff 2e-13, all 94 teams identical. Its fixes are in the "fixes from an independent review" commit: section drew over the search dropdown; K used the held-out season as a target; intercept missing from the on/off expectation; connector double rounding; a card opened from the team left the app in that season; the explainer overstated the on/off weight (about 2x) and the BPM comparison.
- Real opening night (Oct 20, BOS-DET only): landing keeps 2025-26 with the note; 2026-27 is in the picker and already fields a 1st team.

## Where things are
- `tools/savant-value/value.py` (fit, teams, expected, dump), `out/report.txt`, `expected.json`, `check.mjs`, this file.
- `public/savant-value.json` (learned), `public/savant-value.js` (one implementation for page and connector).
- Page: CSS `.ast*`, section `#homeAST`, JS block "THE ALL-SAVANT TEAM" (`renderAST`, `astDefaultSeason`, `astOpen`, `astReturn`), explainer `allsavant` in `tools/savant-explainers/explainers_tabs.py`.
- Connector: `scripts/lib/savant-value.mjs` stamps `sv` per row and `all_savant` per season; `api/_basketball.js` adds `savant_value` to profiles and the tool **`nba_all_savant_team`** (26 tools).
- Relearn only on purpose: `python3 value.py fit && python3 value.py expected`, then the checks.

## What it cannot do
- Before 2009-10 there is no on/off, so defense counts only through steals, blocks and rebounds.
- Positions are Basketball Savant's inferred Guard/Wing/Big (some odd ones: Shawn Marion a guard in 2004-05).
- Headshots are the NBA's latest, so an old season can show a player in his current jersey.
- Early in a season the team moves a lot; it is a season total.

## Possible next steps
- Savant value on the player card (a row in Overall value) and as a leaderboard column.
- An All-Savant Defense team once RAPM lands (Nov 30).
