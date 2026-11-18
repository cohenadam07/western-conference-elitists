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

# Test 6 — live games (Nov 11, 2026, daytime) — PASS, with four fixes found by watching

The local page (`python3 -m http.server 4173` in `public/`, Chromium with a normal Chrome user agent) ran each game through the real live code path (`?game=<id>&team=<id>`, 15-second refresh). `tools/live-lineups/live-test.mjs` logged, per ESPN response: ESPN's status, clock and last play; the page's reconciliation light and text; every banner; and repairs. A 1-second sampler logged every banner change between refreshes. `tools/live-lineups/live_summary.py` turns each log into the numbers below. Timeouts are matched to ESPN's own play list, and every stretch where ESPN's clock sat still for 90+ s is listed too, which catches TV timeouts ESPN never posts as a play.

| game (ESPN id, "us" team) | watched | live refreshes | gap median / max | light | "Data delayed" | repairs |
|---|---|---|---|---|---|---|
| FDU at ETAM (401919759, FDU) | 1st 9:30 → halftime, 34.9 min | 140 | 15.1 s / 15.9 s | 137 green, 3 amber (one 45 s catch-up) | never | none |
| FDU at ETAM, 2nd run on fixed code | halftime → 2nd 12:48, 24.9 min | 100 | 15.1 s / 15.3 s | 100 green | never | none |
| KC vs FAMU (401921005, KC), on fixed code | 1st 6:43 → halftime, 29.9 min | 120 | 15.1 s / 15.9 s | 120 green | never | ESPN's bad FAMU subs repaired (1st 8:27, 8:22, 8:20, 5:18) until ESPN corrected them |
| KC vs FAMU, first run (before the fix) | 1st 19:58 → 6:47, 22.1 min | 89 | 15.0 s / 15.3 s | 74 green, 4 amber, **11 red** (the bug below) | never | lineups hidden |
| DART at UALB (401920234, DART) | 1st 19:39 → 6:03, 35.0 min | 140 | 15.1 s / 15.4 s | 140 green | never | two half-posted groups at 13:26 and 8:26 (the bug below) |

Console or page errors: 0 in every run. The page picked up DART's tip-off by itself after 36 pre-game polls (60 s apart).

**Timeouts and other stoppages: no "Data delayed" in any of them.**

| game | stoppage | ESPN clock frozen | light | banners |
|---|---|---|---|---|
| FDU | Official TV timeout, 1st 7:01 | ~211 s (14 refreshes) | green, amber for 45 s | none |
| FDU | Coach's challenge (overturned), 1st 4:33 | ~211 s | green | none |
| FDU | Official TV timeout, 1st 2:56 | ~135 s | green | none |
| FDU | Halftime | ~12 min (49 refreshes) | green | none |
| FDU | 2nd-half under-16 TV break, 2nd 14:47 (ESPN posted no timeout play) | ~196 s | green | none |
| KC | Short timeout, 1st 11:53 (first run) | ~150 s | green | none |
| KC | Official TV timeout, 1st 3:59 | ~226 s (15 refreshes) | green | only the repair warning, correctly |
| KC | Halftime | ~16 min | green | repair warning until ESPN's correction, then none |
| DART | Official TV timeout, 1st 14:29 | ~166 s | green | none |
| DART | Short timeout, 1st 10:32 | ~196 s | green | none |
| DART | Official TV timeout, 1st 7:52 | ~227 s | green | none |

The only non-green light on fixed code was FDU at 1st 7:01. The play-by-play had a free throw (17-25) that ESPN's score header didn't show yet (16-25). The light read amber "catching up" for 3 refreshes (45 s), then green. That's the designed brief catch-up.

**Screenshots during FDU at ETAM** (`research/live-lineups-test/live/fdu-etam/` and `fdu-etam-2h/`). All four tabs (Right now, Shots and scoring, Their key players, Spreadsheet) plus the drawer, at 1440×900, and the four tabs at 390×844, each at three moments:
- `live-*`: 1st half 9:30;
- `media-timeout-*`: during the 7:01 TV timeout;
- `fdu-etam-2h/live-*`: halftime, on fixed code, showing the corrected luck copy.

## Found by watching, fixed and committed

1. **Shooting-luck copy said "about 0 the other way"** (FDU, 1st 9:30: down 8 with 8 points of luck). ETAM's side read "Most of the 8-point lead is real: about 0." The headline now says up about N / about even / down only about N, and a lead that is mostly luck says so. A side with less than a point of luck reads "about what you would expect". `takeaway-sweep.mjs`: 2,975 takeaways over 300 games × 6 moments × both teams, 0 nonsense lines. (b14ffdcde)
2. **One bad ESPN substitution hid all lineups and turned the light red** (KC vs FAMU, 1st 8:20). ESPN subbed out FAMU's Jayden Joseph at 11:53, credited him with a shot at 8:27, and subbed in Chandler Davis at 8:20 while he was already on. The repair left FAMU with four on the floor, because the bench player it waits for hadn't acted yet in a live feed. Lineups were hidden, and the light read "Play-by-play 0-0, score 25-16" (red) because the light counted points only from the lineup parse. Fixed in 4ae97c8df:
   - With no future actor, repair brings back the most recently seen bench player.
   - Without a lineup parse, the light counts the scoring plays.

   On the same feed, KC now shows lineups, 25-16 reconciles, and the warning is correct. At halftime ESPN backfilled the missing 10:25 sub (Davis out, Joseph in), and the page dropped the repair and warning by itself, because it rebuilds from scratch each pull. Over the 300-game sample, repair rescues 8 of 16 broken games (was 5), and 7 of those reconcile. The other 8 hide lineups but keep a green light. 0 clean games are touched. In 5,001 mid-game cuts of clean games, lineups are never hidden. 5 of those cuts show ESPN's score field one play behind (brief amber). `repair-300.log`.
3. **Halftime screen held 75 s into the 2nd half** (FDU). ESPN's status still said Halftime while 2nd-half plays arrived. A real play after the break now ends the halftime view, while the 20:00 substitutions alone do not. `half-lag-test.mjs`: 2/2. The stale test still passes 4/4. (58bfaa5fc)
4. **False "One substitution looks wrong" for 15 s** (DART, at 1st 13:26 and again at 8:26). ESPN posts a five-man change a few lines at a time, so for one pull the group was five out, four in. While live, repairs that all sit at the feed's last clock now stay quiet, and lineups are still repaired. The same group with later plays, or at the final, still warns. `tail-repair-test.mjs`: 6/6 on the saved live feeds in `live/feeds/`. (253e493fe)

After the fixes: parser parity 3/3 and 300/300 identical, and the expected workbook shows 0 differences in 2,666 cells. The KC fixed run used fixes 1-2. The DART run loaded before fixes 3-4, so its log still shows the two 15-second warnings that fix 4 removes.

**Not exercised live:** the 2nd half to the final, overtime, and the drawer on a phone mid-game. Friday's dry run on 401906804 covers a full game. The page still says "Oklahoma" for any `team=`, by design (the `team` parameter is a test hook).

Logs: `research/live-lineups-test/live/<game>/refresh-log.txt` (one line per refresh), `refresh-log.jsonl`, `monitor.out`; `live/summary.json`.

# Full-game rehearsal: Marquette at Michigan, live, Nov 11, 2026, 7:00 pm ET. PASS, with one fix

**The game.** 401909524 on FS1, with Michigan (130) as "us", followed from pre-game through the final: Michigan 84, Marquette 70, no overtime.

**Code under test.** The run used the **Vercel preview** for `fd406e9`, the commit that holds all four test-6 fixes. The preview is `western-conference-elitists-jmzc728b0-…`, opened through a Vercel share link. Its four JS files are byte-identical to the branch. Its HTML differs only by Vercel's injected toolbar script.

**Two companion runs.** A local mirror of the same game ran on the same code. A backup game also ran on the preview: James Madison at Delaware (401920903), with JMU (256) as "us". It was there in case ESPN's feed for the main game was unusable.

**How it was watched.** `tools/live-lineups/full-game.mjs` is test 6's logger extended to a whole game. It logs every ESPN response: status, clock, last play, the reconciliation light, banners and repairs. A 1-second sampler logs every banner change between refreshes.
- **Screenshots.** It shoots all four tabs plus the drawer (Lineups, Players, Shooting, Opponent) at 1440×900 and again at phone size (390×844), four times: once in each half (at 12:00), at halftime, and at the final.
- **Download.** After the final, it downloads "This game" as .xlsx and .csv.
- **The check.** `tools/live-lineups/final_check.py` recalculates the download in LibreOffice and checks it against ESPN's official box score.

## Refreshes, light, banners, repairs

| run | refreshes | live refreshes, span | gap median / max | light | "Data delayed" | banners | repairs | errors |
|---|---|---|---|---|---|---|---|---|
| MARQ at MICH, **preview** | 754 (255 pre-game, 498 live, 1 final) | 498 live, 124.9 min, 1st 19:56 → end of 2nd | 15.1 s / 15.5 s | **498 of 498 green** | never | one 15 s false banner at tip-off (fixed below) | one, at 2nd 0:40, for one refresh, silent | 0 |
| MARQ at MICH, local mirror | 754 | same | 15.1 s / 16.0 s | 498 of 498 green | never | same | same | 0 |
| JMU at DEL, preview (backup) | 707 | 449 live, 112.5 min | 15.1 s / 15.3 s | 449 of 449 green | never | none | none | 0 |

- **Pre-game.** The page sat on the pre-game card for 4 hours 15 minutes (255 polls, 60 s apart, from 2:46 pm ET). It switched to live by itself, with no reload.
- **ESPN direct.** Every request went straight to ESPN. The `/api/espn-summary` fallback was never needed.

**Stoppages on the main game: 14 timeouts and 16 stretches of 90 s or more with a frozen clock. Green throughout, and no banners in any of them.**

| stoppage (ESPN play) | ESPN clock frozen | refreshes | light | banners |
|---|---|---|---|---|
| Official TV timeout, 1st 15:32 | ~196 s | 13 | green | none |
| Official TV timeouts, 1st 10:24 / 7:39 / 3:31 | ~226 s each | 15 each | green | none |
| Short timeouts, 1st 12:52 / 9:14 / 6:54 / 1:31 | 60–90 s | 4–6 | green | none |
| Halftime | ~17 min | 67 | green | none |
| Official TV timeouts, 2nd 15:36 / 11:55 / 7:48 | 181–226 s | 12–15 | green | none |
| Short timeout, 2nd 12:16 | ~257 s | 17 | green | none |
| Coach's challenge, stands (2nd 7:48, with the TV timeout) and overturned (2nd 4:19) | 181 s / 242 s | 12 / 16 | green | none |
| Short timeout, 2nd 0:40 | ~121 s | 8 | green | none |
| Free-throw and foul stoppages without a timeout play (2nd 16:26, 10:41, 8:46, 6:08) | 90–135 s | 6–9 | green | none |

The backup game had 11 timeouts, halftime and 13 long stoppages. All were green with no banners.

**The one repair.** At 2nd half 0:40, ESPN posted "Trey McKenney subbing out" one pull before the player coming in.
- The page repaired the lineup for that one refresh (21:03:56) and kept it showing. It stayed quiet because the repair sat at the feed's last clock (test-6 fix 4).
- On the next pull ESPN completed the group, and the repair dropped by itself.
- Both feeds are saved: `live/feeds/401909524-2-0-40.json.gz` and `401909524-final.json.gz`.

## Phone drawer, once per half

The drawer opened at 390×844, on all four segments, at **1st half 12:00, halftime, 2nd half 12:00 and the final**, and at 1440×900 at the same moments. Horizontal overflow was 0 in all 32 drawer screenshots and 32 tab screenshots of the preview run. All are in `live/marq-mich/` (`<moment>-phone-drawer-<segment>.png`). The two companion runs keep only their phone drawer shots.

What was read on screen:
- **1st half 12:00.** "Marquette has 6 team fouls. Their next foul puts you in the bonus." The bonus chip matched ESPN's 6 Marquette fouls.
- **Halftime.** Up 35–27. "Without shooting luck you would be up about 11." That checks out: Marquette's 4-for-14 from three helped by about 2, Michigan's 2-for-11 cost about 5, so the net luck is −3.
- **Drawer Players at 2nd half 12:00.** Points sum to the score shown.

On the preview, Vercel's toolbar button (a dark circle on the right edge) floats over the page and the drawer. On the 1st-half phone drawer it covers one "Too early" cell. It comes from Vercel's injected `vercel.live` script, so the local mirror doesn't show it and production won't. Anyone opening a preview link will see it, though; it can be hidden from the toolbar's own menu.

## Download vs ESPN's official box score: PASS

The "This game" download for the main game is `live/marq-mich/OU Lineup Tracker - Marquette 11-11.xlsx` plus its CSV. It was recalculated in LibreOffice (`recalc/`) and checked with `final_check.py`:

| check | result |
|---|---|
| ESPN status | STATUS_FINAL, no overtime |
| Final score | Stint Log 84-70 = ESPN 84-70 |
| Each team's points | Michigan 84 = sum of ESPN box-score player points; Marquette 70 = sum of ESPN box-score player points |
| Minutes | 26 stints sum to **40.0000**. 1st half 9 stints, 20:00 → 0:00; 2nd half 17 stints, 20:00 → 0:00. Contiguous, no gaps, no zero-length stints |
| Red flags after recalculating | **0**. Duplicate player in P1–P5: 0. Players with no Lineup Key: 0. Key over a repeated player: 0. Rows without five players: 0 |
| Error values in any sheet | 0 |
| Game Summary | Marquette 11/11, 26 stints, 40 minutes, 84-70, possessions 74/76 |
| CSV vs Stint Log | 26 rows, 30 columns, 0 differences |
| Template round trip (`xlsx_compare.py`) | 0 differences. Every dropdown, red-flag format, note, width and formula is kept. Michigan's players were added to the Roster tab |
| Player minutes vs ESPN | 9 players, largest gap 0.42 min (ESPN rounds to whole minutes): Cadeau 34/34.13, McKenney 36/35.67, Estrella 31/31.10, Thiam 27/27.05, Gayle 25/25.33, Costello 25/24.60, Liburd 13/12.83, Noland 6/5.87, Goodman 3/3.42 |

- **Local mirror.** Its download is identical on every check.
- **Backup game.** It also passes. JMU 71-61, 32 stints summing to 40:00, 0 red flags, CSV identical, template round trip with 0 differences, and player minutes within 0.45 min of ESPN.

## Found by watching, fixed: a false "Lineups are hidden" for 15 s at tip-off

**What happened.** At 19:02:06 ESPN marked the game live (1st 19:56) with **zero plays** in the feed. The page had nothing to parse and read that as broken substitutions. Both runs showed "Lineups are hidden for this game…" until the next pull, 15 s later, brought the jump ball. After that the banner never returned.

**The fix.** Until ESPN's first play arrives, the page keeps the pre-game card, marked "Tipped off. Waiting for ESPN's first play," on the 15-second live refresh. It opens the live view as soon as a play arrives (commit `69da0af`).

**Tests.**
- `tools/live-lineups/tip-test.mjs` replays the real tip feed (`live/feeds/401909524-tip-3plays.json`), first with its plays removed and then complete, on the same page with no reload: **3/3** (pre-game card with no banner; live view with lineups; 0 console errors).
- Unchanged: `half-lag-test` 2/2, `tail-repair-test` 6/6, `stale-test` 4/4.

**Deployment.** The preview for `69da0af` (`western-conference-elitists-21qzt1oat-…`) is READY, and its JS is byte-identical to the branch.

**Status.** Apart from those 15 seconds, the main game ran clean from tip to final, and the download matches ESPN's box score. The tip-off case is covered by the test above. It has not yet been seen at a live tip-off on the fixed code; Friday's dry run will be the first.

## Still open
- A real iPhone and iPad pass on the preview. Everything so far has been headless Chromium.
- Friday's dry run on 401906804, OU vs FDU.
- Overtime in a live game. Tonight's games were decided in regulation; the overtime download path has only been checked on finished 2025-26 games.

Files are in `research/live-lineups-test/live/`:
- `marq-mich/`: the preview run. Refresh logs, 65 screenshots, the download, the recalculated copy.
- `marq-mich-local/`, `jmu-del/`: logs, downloads and phone drawer shots.
- `summary-full-game.json`: from `live_summary.py --out=`.
- `feeds/`: the saved ESPN feeds.
