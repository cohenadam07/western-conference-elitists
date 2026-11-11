# Live Lineups v1.0 — build report (Nov 11, 2026)

Branch `live-lineups`. Page: `/live-lineups.html?team=201` (also `?game=<id>`, `?replay=<id>&speed=10`, `&at=2-9:00`, `&at=half`).
Unlisted: `noindex,nofollow`, not in nav, homepage, sitemap or robots. Version 1.0 in the footer. Nothing merged to main, nothing deployed to production.

## What was built
| file | what |
|---|---|
| `public/live-lineups.html` | the page shell |
| `public/live-lineups/js/engine.js` | ESPN → compact game, exact port of `parse_game`, stints, bad-sub repair, every number on the page, takeaways |
| `public/live-lineups/js/render.js` | band, four tabs, halftime/final, drawer, court SVGs, in-page workbook tabs |
| `public/live-lineups/js/app.js` | live polling (15 s live / 60 s pre / stop at final, full rebuild every pull), replay mode on the same path, season cache in localStorage, downloads, failure states |
| `public/live-lineups/js/xlsx.js` | fills the tracker by editing its XML in place (see Spreadsheet) |
| `public/live-lineups/live-lineups.css` | Oklahoma theme; phone / iPad / laptop layouts |
| `api/espn-summary.js` | proxy fallback, used automatically only if a direct ESPN fetch fails |
| `tools/live-lineups/` | compact.py, parity_dump.py + parity.mjs, fill.mjs, xlsx_compare.py, compare_expected.py, game_summary.py, recalc.sh, replay-test.mjs, moment-test.mjs, snap.mjs, moment.mjs |

## Test results
### 1. Parser parity (Python vs JS) — PASS
`python3 tools/live-lineups/parity_dump.py <list> out.jsonl && node tools/live-lineups/parity.mjs <list> out.jsonl`, both starting from the same raw ESPN files.
- OU 2026-27 (401906801/802/803): 3 of 3 identical, 404 possessions, every field (off/def five, points, FGA, 3PA/3PM, rim, FTA, OREB, TOV, end type, error counts) plus every stint row.
- 300 random 2025-26 D1 games (seed 2627, `tools/live-lineups/random300.txt`): 300 of 300 identical, 38,233 possessions. 16 games fail the parser's lineup-size check identically in both (5.3%, the bad-substitution rate the spec expected).
- Stints compared too. The only difference is labelling: in overtime the reference `fill_sheet.py` writes negative 2nd-half clocks ("-3:22"). The page writes `OT1 2:22`. The stats and players are identical (61 OT rows). Four games with no plays raise IndexError in Python and return no stints in JS.
- OU finals reconcile exactly: 64-68, 84-57, 81-72. Stints 33/25/28, 40:00 each.

### 2. Replays at 10x — PASS
`node tools/live-lineups/replay-test.mjs` played all three games through the real page at 10x in parallel (about 4.5 min each). At four checkpoints (1st half 8:00, halftime, 2nd half 9:00, final) it paused and captured each tab, the halftime layout and the drawer (four segments at 1440 and 390, Lineups at every size). Viewports: 390×844, 430×932, 820×1180, 1180×820, 1194×834 and 1440×900.
- 252 screenshots in `research/live-lineups-test/<gid>/<checkpoint>/`.
- Horizontal page overflow 0 at every viewport. Console errors 0. Every tab present.
- Parsed points matched ESPN's running score at every checkpoint (reconciliation green). Finals, stint counts and 40:00 all correct. Raw results are in `replay-results.json` and `replay-run.log`.

### 3. Whole season spreadsheet — PASS
Downloaded in the browser after the 401906803 replay: `OU Lineup Tracker - season to 11-9.xlsx` (and the CSV).
- Stint Log inputs vs `expected-autofill-3-games.xlsx`: 2,666 cells compared, 0 differences.
- Recalculated in LibreOffice 26 headless (`tools/live-lineups/recalc.sh`), the Game Summary is identical to the expected file: 64-68, 84-57, 81-72, 40 minutes each, possessions 67/65, 68/69, 67/68. 0 differing cells.
- Round trip vs the template (`xlsx_compare.py`): every sheet, both dropdowns, all 8 red-flag conditional formats, all 10 notes, frozen panes, every column width and all 29,410 formulas are unchanged. 0 differences. `fullCalcOnLoad` is set.
- **Deviation from the prompt:** the prompt says ExcelJS, with a Python/openpyxl function as the fallback. ExcelJS failed the round trip: it dropped 10 column widths and duplicated both dropdown ranges. Instead of the Python function, the browser opens the workbook with JSZip and rewrites only the input cells' XML. Every other byte comes through, and the page stays serverless. Players missing from the Roster tab are added to the next free row with their ESPN jersey, and the page says so. None were needed for these three games.
- Numbers.app can't recalculate this workbook: it blanks `VALUE("0:"&F2)` and the roster lookups, on the expected file too. Excel and LibreOffice are fine. If Lucas ever opens it in Numbers, that's why.

### 4. Shot chart, MVSU through 2nd half 9:00 — PASS
`node tools/live-lineups/moment-test.mjs`: 93 shots (52 OU, 41 MVSU), OU at the rim 12 of 20, threes 9 of 31, MVSU threes 2 of 13. All 93 shots are identical to `reference/shots.json` (team, x, y, made, assisted, three, rim, time), and 93 dots are drawn.

### 5. Mockup moment — matches at 9:08; two explained differences at 9:00
Every other mockup element matches at 9:00: score 55-38, lead tag +17, "Oklahoma 20–3 run", current five Reid, Wadley, Brown, Forsythe and Mayfield, both secondary takeaways word for word, and fouls 5/6 with "Bonus on next foul".
- **Lead takeaway.** At 9:00 the page leads with "MVSU has 6 team fouls." The mockup has "Go at Tymias Williams. He has 4 fouls." ESPN's feed has Williams subbing out at **9:07** (for Tianhao Wu, with AJ Abrams out for Tory James Jr.). The mockup took "on the floor" from the last possession's lineup, and no possession had started since 9:07, so it lagged the substitution. The page applies substitutions as soon as ESPN posts them, so it won't tell Lucas to attack a man on the bench. One tick earlier, at **9:08**, the page shows the mockup's lead exactly: "Go at Tymias Williams. He has 4 fouls." / "He is their second most-used player tonight (25 min)."
- **Together.** The page shows 1:09 at 9:00, against the mockup's 1:01. The five checked in at 10:09 (the spec says stints start at the substitution clock). The mockup measured from their first possession at 10:01. At 9:08 the page shows 1:01.
- **"On paper."** The page says "about even" where the mockup says "beats theirs by about 4". The mockup's 4.4 summed raw RAPM for every player. The spec counts players under 300 possessions as 0, which gives 1.7. The page follows the spec.
- Screenshots: `research/live-lineups-test/mockup-moment/` (9:00 and 9:08, desktop and phone).

### 6 and 7 — skipped as instructed (no live games tonight).

## Other checks and findings
- **NCAA bonus rule confirmed** for 2026-27: one-and-one on the 7th team foul, double bonus on the 10th, reset at halftime, carried into overtime. May 2026 was not a rules-change year, and quarters are only under discussion.
- **Bad-substitution repair** on the 16 broken games in the 300-game sample: 5 rescued (4 of those reconcile to the final score; one is off and would show a red reconciliation light). The other 11 hide lineup views with a banner and keep score, shots, players and box numbers. Clean games are never modified (0 of 282). Log: `repair-300.log`.
- **ESPN blocks headless Chrome.** Akamai returns 403 with no CORS header to the HeadlessChrome user agent. Tests use a normal Chrome user agent. Real browsers get `access-control-allow-origin: *` (verified with several Origins). If a browser is ever blocked, the page switches to `/api/espn-summary` automatically. That proxy isn't verified against ESPN from Vercel's IPs yet.
- Whole-game "How the points are scored" uses ESPN's official turnover and fast-break points in live mode. In replays it uses computed values, because ESPN's box score is the final total, not the total at the replay moment.
- Bugs found by playing it, all fixed: zero-length current stint crashing the strip and shots picker; render errors showing as "Can't reach ESPN"; second-half plays stamped at the halftime moment hiding halftime; possessions with no lineup snapshot; phone chip row overflowing; full and short opponent names shown together.

## What's left for the live test and Friday's dry run (OU vs Fairleigh Dickinson, 401906804, Nov 13, 7:00 pm CT)
1. **Push a Vercel preview and open it on a real phone and a real iPad.** This build was verified only in headless Chromium. Check fonts, safe areas, the fixed bottom tab bar, the sticky spreadsheet columns on iOS Safari, and that the download saves to Files.
2. **Live test (test 6)** on 3+ live D1 games for 15+ minutes (`?game=<id>`). Watch the 15 s refresh, the current five, the reconciliation light (expect brief amber during ESPN catch-ups), the "Data delayed" banner during long timeouts (it fires after 60 s without new data, so a long TV timeout may trigger it), and the "updated N sec ago" line.
3. Hit `/api/espn-summary?event=<id>` on the preview to confirm Vercel can reach ESPN, in case a browser ever needs the fallback.
4. **Dry run:** keep `?team=201` open all game. Before tip it should pick FDU and show the pre-game card, then switch to live without a reload. Log reconciliation, repairs and banners. Afterwards, download This game and Whole season, open them in Excel, and check points and 40:00 against the official box score. FDU is 19 characters, so it shows as "FDU" in the Game column.
5. Not exercised by any test yet: overtime in a live game, a live bad substitution, the localStorage season cache across reloads, and the "added to roster" path.
6. Then Adam sends Lucas the link.

---

# Follow-up fixes (Nov 11, 2026, commit 6902fb26e and after)

All five checks pass. Parity (3/3 and 300/300) and the expected-workbook comparison (2,666 cells, 0 differences) were re-run after the changes and are unchanged.

### 1. On-paper matchup uses every rating — PASS
The expected margin now sums every player's rating in `ratings-2025-26.json`. Ridge already shrinks small samples, and this is what the backtest validated (calibration slope 0.93). The 300-possession threshold now only feeds the "N of the 10 have little college data" count. This supersedes the test 5 note above: at **2nd half 9:08** of 401906802, the page reads "**On paper, this five beats theirs by about 4 per 100 possessions.** Rough read: 7 of the 10 have little college data yet." The margin is +4.4, matching the mockup (`moment-test.mjs`, `mockup-moment/right-now-2-9-08-*.png`).

### 2. Overtime in the spreadsheet download — PASS
Half is written as the template's dropdown value (`OT1`, `OT2`, `OT3`). Start and End Clock are plain m:ss within the 5:00 period, never negative and never prefixed. Checked on two 2025-26 overtime games, filled with the page's own modules (`tools/live-lineups/fill-any.mjs`), recalculated in LibreOffice, then checked with `tools/live-lineups/check_ot.py` against the template's three red-flag rules:

| game | team | stints | minutes | points vs final | OT rows | red flags |
|---|---|---|---|---|---|---|
| 401830778 | 127 vs Illinois | 34 | 45.00 | 85-82 = 85-82 | OT1 5:00-2:22, 2:22-0:49, 0:49-0:21, 0:21-0:11, 0:11-0:10, 0:10-0:00 | 0 |
| 401804959 | 55 vs New Mexico State | 34 | 45.00 | 75-77 = 75-77 | OT1 5:00-4:32, 4:32-0:24, 0:24-0:03, 0:03-0:00 | 0 |

The Game Summary reads 45 minutes logged and the correct score for both. Neither team is on OU's Roster tab, so this also exercised the add-to-roster path: 10 and 9 players added, every Lineup Key valid. Files: `research/live-lineups-test/overtime/`. No double-overtime game in the 300-game sample parsed cleanly, so 50:00 wasn't exercised.

### 3. Stale banner — PASS
"Data delayed" now has exactly two triggers:
- the last successful ESPN fetch is more than 60 s old, or
- ESPN's own game clock has run 60+ s of game time with no new play.

A stopped clock (timeout, halftime, any stoppage) can't trip the second one. The old trigger ("nothing changed for 60 s") is gone. When ESPN is unreachable, "Data delayed" now shows alongside "Can't reach ESPN".

Proof (`tools/live-lineups/stale-test.mjs`): the real page on the live path (`?game=401906803`), fed 401906803's actual ESPN summary cut at a moment, with a fake clock polling every 15 s:

| phase | what the feed does | Data delayed | result |
|---|---|---|---|
| Media timeout, 1st half 15:01 (Official TV Timeout) | 150 s, clock frozen at 15:01, no new plays, every poll succeeds | not shown | PASS |
| Halftime | 150 s, STATUS_HALFTIME | not shown | PASS |
| Control: clock runs, no plays | clock goes 15:01 → 13:55 (66 s) with no new play | shown ("Last update 0:32 ago") | PASS |
| Control: ESPN unreachable | requests fail for 90 s | shown with "Can't reach ESPN" ("Last update 1:33 ago") | PASS |

Screenshots and JSON: `research/live-lineups-test/stale/`.

### 4. Proxy on the Vercel preview — PASS
Preview `western-conference-elitists-b4giu5rpz-cohenadam07s-projects.vercel.app` (commit 6902fb26e) sits behind Vercel Authentication, so it was requested through a Vercel share link.
- `GET /api/espn-summary?event=401906803` returned **HTTP 200**: 494,622 bytes, `content-type: application/json`, `access-control-allow-origin: *`.
- The second request was `x-vercel-cache: HIT` (0.11 s).
- Parsed with the page's engine: status STATUS_FINAL, 135 possessions, **81-72, reconciling exactly** to ESPN's score, 28 stints, 40:00.

So Vercel's servers can reach ESPN, and the fallback works if a browser is ever blocked.

### 5. Download note — PASS
"Opens in Excel or Google Sheets." now sits directly under the Download for Excel / CSV buttons: right-aligned on desktop, left-aligned on phones. No overflow at 1440×900 or 390×844 (`research/live-lineups-test/fixes/`).

### Updated list for the live test and Friday
Item 3 of the original list is done; the proxy is verified. Still open:
- a real-device pass on the preview (iPhone and iPad Safari),
- live test 6 on 3+ games: the stale banner should now stay off through TV timeouts,
- Friday's dry run on 401906804,
- a double-overtime game and a live bad substitution, neither exercised yet.
