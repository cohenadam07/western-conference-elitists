# Build prompt: Live Lineups for Oklahoma, v1.0 (updated Nov 11, 2026)

Paste everything below the line into Claude Code in the `western-conference-elitists` repo. First unzip `live-lineups-assets.zip` (sent by Claude in chat) into `public/` so the files sit at `public/live-lineups/...`.

---

## Goal
Build a live, auto-refreshing game page for **Lucas McKay, GM of Oklahoma men's basketball**. It is just for him for now. It answers his question ("are certain lineups not working in this game?") honestly and in plain English, tracks every stint automatically from ESPN play-by-play, and fills in the Excel lineup tracker we sent him so he never types a row.

Audience: a GM who is not very analytical. **Plain-English takeaways first, numbers one tap away.** He will use it on whatever he has on him: **phone, iPad or laptop, any orientation.** Every tab must work and look finished on all three.

Production grade. The mockups in `public/live-lineups/mockups/` are the design target; `public/live-lineups/reference/` holds the Python that generated them from real data (copy exact, colors, sizes, rules). Where this prompt and the mockups disagree, this prompt wins.

## Where it lives
- `wcehoops.com/live-lineups.html?team=201` (201 = Oklahoma's ESPN id). With `team` only: the team's game today (live, else next upcoming, else most recent final). Also `?game=<ESPN event id>`.
- **Replay mode:** `?replay=<event id>&speed=10` plays a finished game through the page using the exact live code path (feed the parser the plays revealed up to a moving clock). Used for testing and so Lucas can try the page on a past game.
- **Unlisted:** not in the nav ribbon, homepage or sitemap; `<meta name="robots" content="noindex">`. No password.
- **Version 1.0** shown in the footer (repo's product-versioning rule).
- Theme: Oklahoma, not College Basketball Savant (this replaces the earlier version of this prompt).

## Architecture
- Static page. The viewer's browser fetches ESPN directly (ESPN sends `access-control-allow-origin: *`, `cache-control: max-age=5`). No server, no cron, no Claude at runtime.
  - Summary: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={gid}`
  - Schedule: `.../teams/{team_id}/schedule`; scoreboard: `.../scoreboard?dates=YYYYMMDD&groups=50&limit=500`
- Refresh every **15 s** while live, 60 s pre-game, stop at final. **Rebuild the whole game from scratch on every pull** (ESPN inserts and edits a few plays after the fact; in our live test 35 of 610 plays changed later, and full rebuilds self-correct).
- If a browser fetch ever fails for CORS, add a Vercel function `/api/espn-summary?event=` that proxies the same JSON with a 15 s cache and switch to it automatically.
- Season data: parse each completed game of the season once (schedule endpoint) and cache in the browser (localStorage, wrapped in try/catch; works without it).
- Player ratings for the "on paper" matchup: `public/live-lineups/ratings-2025-26.json` (ridge RAPM, lambda 2,500, all 2025-26 D1 games). Format: `players[espn_id] = [offense, defense, possessions]`, points per 100; positive defense = better defender. Rated only if possessions >= 300; anyone else counts as 0 (average).

## Data rules (all verified on OU's real games; do not change without re-testing)
**Parser.** Port `parse_game` (Python at the bottom) to JavaScript exactly. Parity test before anything else: Python vs JS on OU's three 2026-27 games (401906801, 401906802, 401906803) and at least 300 random 2025-26 D1 games; identical possessions, points, lineups and every counted stat. OU's games must reconcile exactly to the finals: 64-68 (East Texas A&M), 84-57 (MVSU), 81-72 (North Alabama).

**Stints.** A stint starts at every clock where OU's five changes after applying the whole substitution group at that clock (look past free throws, fouls, timeouts at the same clock), and at each half. Stats for a stint = possessions whose first event falls in its window. Reference: `reference/fill_sheet.py` `stints_for()`. Verified: every game's stints sum to exactly 40:00 and to the final score (33, 25 and 28 stints in OU's three games). About 10 possessions a game have a sub mid-possession (between free throws); credit by clock time, as a hand tracker would.

**Shot locations.** ESPN `coordinate.x` runs 0 to 50 across the court; `coordinate.y` is **feet from the rim, not the baseline** (all 150 OU shots with a stated distance landed within 2 ft of it this way). Plot at baseline distance `y + 5.25`. Drop shots with missing coordinates or y < -1 from the chart (keep them in counts); cap at 46.5 ft. Spread exactly stacked shots on a small spiral (0.9 ft steps, golden angle) so every attempt shows.
- Made and **assisted** = scoring field goal with 2+ participants (the second is the passer). Made unassisted = scoring FG with one. Missed = shooting play, not scoring. Free throws are never dots.
- At the rim = type LayUpShot, DunkShot or TipShot (same as the tracker).

**Points sources.** Whole-game totals use ESPN's official box score team stats when present (`turnoverPoints`, `fastBreakPoints`; scorer's judgment). For lineup views and when missing, compute: for each score, look back for the event that gave this team the ball (opponent turnover = "off turnovers"; own defensive rebound or opponent turnover = live ball; opponent made FG or last made FT = dead ball). Fast break = field goal within 6 s of a live-ball start. Second chance = own offensive rebound between that start and the score. Free throws = FT points. Check: computed points off turnovers matched ESPN's official totals exactly on the MVSU game (16 and 11); fast-break points are close but not exact (12 and 4 vs official 15 and 3), which is why whole-game totals use ESPN's.

**Runs and droughts.** Biggest run = the stretch of consecutive scoring plays maximizing (us minus them) with them <= 4, shown as "Oklahoma 20–3 run". Current run = unanswered points since the other team last scored. Drought = time since a team's last made field goal.

**Fouls and bonus.** Team fouls per half from `PersonalFoul` plays (team id = fouling team). Men's college rules: bonus (one-and-one) on the opponent's 7th team foul of the half, double bonus on the 10th. Confirm the current NCAA men's rule before shipping. Chips: "Bonus on next foul" at 6, "In the bonus" 7–9, "Double bonus" 10+.

**Formulas (identical to the Excel tracker).** ORtg = pts / poss × 100; Net = ORtg − DRtg; ±95% = 1.96 × 1.167 × 100 × √(1/off + 1/def); luck-adjusted points = pts − 3 × (3PM − 0.339 × 3PA) for both teams; lineup Trust = n/(n+1000), Best Guess = (unit luck-adj net − team luck-adj net) × Trust, n = (off+def)/2; players on/off use n_eff = n_on·n_off/(n_on+n_off) and k = 2000. All constants in one config object citing project doc claude/ou-lineup-backtests.md.

**Matchup on paper.** Expected margin per 100 for the ten on the floor = Σo(ours) − Σd(theirs) − (Σo(theirs) − Σd(ours)). Count how many of the ten are unrated.

**Opponent impact (Hollinger Game Score parts, from play-by-play).** Scoring = PTS + 0.4 FGM − 0.7 FGA − 0.4 (FTA − FTM); Playmaking = 0.7 AST − TOV; On the glass = 0.7 ORB + 0.3 DRB; Defense = STL + 0.7 BLK − 0.4 PF. Impact = sum. Show their top three with impact >= 3.

**Dates.** Convert the ESPN event timestamp to America/Chicago (OU's 7 pm CT tips are the next day in UTC).

## Design system
- Colors: crimson `#841617` (band, accents, OU-favorable), deep crimson `#6c1213` (second band row), cream `#FDF9D8` (text on crimson only), paper `#F7F5F3`, ink `#241C1D`, muted `#6E6466`, rule `#E3DDDA`, minus `#A99FA1` (opponent-favorable), even `#D9D3D0`. Crimson always means "good for Oklahoma"; grey means good for the opponent.
- Type: **Zilla Slab** 600/700 for scores, headlines and section titles (echoes OU's athletic lettering); **Libre Franklin** 400–700 for everything else, tabular numbers. Sentence case everywhere, no all-caps labels.
- No card shadows or gradients; hairline rules separate sections. One motion only: the small live dot pulses on update (off under reduced motion).
- Logos: `ou-mark.png` (cream OU, for the band), `ou-mark-crimson.png` (center court). "Powered by WCE" pill bottom-right of every tab, linking to wcehoops.com, using the repo's WCE logo.
- Accessibility: visible keyboard focus, 44 px touch targets, no hover-only UI, color is never the only signal (fouls also show as numbers, +/- has signs).

## Layout: band and tabs (every screen)
Crimson band: OU mark + "Oklahoma" + score on the left, period / clock / "Live" with pulsing dot in the center, opponent score + name on the right (short name on phones). Second row (deep crimson): "Oklahoma team fouls N", "{Opp} team fouls N" + bonus chip, and the tabs as pills on the right: **Right now · Shots and scoring · Their key players · Spreadsheet** (active = cream pill, crimson text). Footer: "See all the numbers" button, data note ("ESPN play-by-play, refreshed every 15 seconds"), Version 1.0, Powered by WCE.

## Tab 1: Right now (mockup 1; halftime = mockup 6)
Left: one lead takeaway (kind word in crimson, Zilla headline, muted explanation, crimson left rule), then up to two smaller notes (kind word | bold line + muted why). Right: "Oklahoma on the floor" (name, minutes, five foul dots, "Together m:ss") and "{Opp} on the floor"; an opponent with foul trouble gets a crimson row. Under it, one "On paper" line: "On paper, this five beats theirs by about 4 per 100 possessions. Rough read: 7 of the 10 have little college data yet."

**Takeaway rules (priority order; show the top 3; copy templates from `reference/mock3.py` `takeaways()`):**
1. Attack: opponent on the floor with 4+ fouls, 3+ in the first half, or 2+ in the first half with 10+ minutes left: "Go at {name}. He has {n} fouls." Why names his minutes rank and the team-foul/bonus situation.
2. Attack: opponent at 6+ team fouls (if no rule 1).
3. Runs and droughts: opponent run of 8+ with OU at 2 or fewer, or OU without a field goal for 3:00+: "{Opp} is on a 9-0 run" / "No Oklahoma field goal in 3:40". (Did not trigger in the mockup moment.)
4. Shooting luck, when either side's 3PT luck is 4+ points: "Most of the 17-point lead is real: about 14 without shooting luck." with both teams' 3PT lines and points helped or cost. If luck roughly cancels: "The 16-point lead is earned. Shooting luck has about cancelled out."
5. Shot mix vs before tonight, when 3PA share differs by 8+ points: "You are taking far more threes than usual." with rim share too.
6. Forced turnovers 24+ per 100: "Your defense is forcing a lot of turnovers." (D1 average 17).
- Never generate an alert from tonight's lineup +/- (backtests: no carryover within a game).

**Who has been out there:** lead chart (step line of OU's lead, crimson tint above zero, grey below, halftime dashed, future greyed, "now" line, current lead tag, biggest-run bracket on top). Below it, rows aligned to the same time axis: three most-used fives + the current five ("Now" tag) + "N other groups", each with stint blocks (crimson = OU won the stint, grey = lost, light = even; current block outlined), and total minutes and +/- on the right. Note: "A record of who played when. One game is too few minutes to judge a group." **Tapping a row opens Shots and scoring filtered to that five.**

**See all the numbers** (mockup 5): side drawer (full-screen sheet on phones): every OU five tonight (group, min, +/-, without shooting luck, season best guess; "Too early" when Trust < 5%) and "Shooting and shot mix" (tonight vs before tonight); segmented Lineups / Players / Shooting / {Opp}.

**Halftime** (state = halftime): band status "End of first half / Halftime"; up to 4 takeaways; "First-half minutes and fouls" with minute bars out of 20; the strip for the first half.

## Tab 2: Shots and scoring (mockups 2, 2b)
- Left: "Show shots for": Whole game, the four most-used fives, and the current five, each with +/-, minutes together and shot count. Selected = crimson left bar.
- Court (SVG, feet): full 94 × 50 with a 3.6 ft crimson out-of-bounds band reading "OKLAHOMA" (top) and "BOOMER SOONER" (bottom) in cream Zilla; maple planks running baseline to baseline; white 0.22 ft lines; **lane tinted crimson at 22% opacity, not solid**, so red dots stay visible; crimson OU mark at center. NCAA men's geometry: rim center 5.25 ft from baseline; lane 12 ft wide × 19 ft; FT circle r 6; three-point arc 22.146 ft (22' 1¾") with straight corners at 21.65 ft from the rim; restricted arc r 4; backboard 4 ft from baseline. Exact SVG in `reference/mock4.py` `court_svg()`.
- Oklahoma shoots at the left basket, the opponent at the right (mirrored). Dots r 0.82 ft: **made unassisted = filled ink, made assisted = filled crimson with white edge, missed = open ring**. Key below: "Made, unassisted · Made, assisted · Missed" (as three items, not a dotted string).
- Caption above: "Oklahoma shots (52)", center context, "{Opp} shots (41)". For a lineup: "{names}: 5:59 together. A handful of shots, so read where, not makes."
- Below, two halves: "Where the shots come from" (at the rim, other twos, threes, makes that were assisted; Oklahoma vs Opp, "m of a") with one sentence; "How the points are scored" (off turnovers, fast break, second chance, free throws; small bars, larger side bold) with "The biggest edge is fast-break points: 12 to 2." only when the gap is 4+, else "Too few points with this group to see a pattern." (lineup) / "No clear edge in where the points come from." (game).
- Phones: the court turns vertical (baskets top and bottom) to fill the width; the picker becomes horizontal chips.

## Tab 3: Their key players (mockup 3)
Header "Their most impactful players tonight" + note "Ranked by a box-score impact score, which misses some defense." Three columns (one per player; stacked on phones): name (Zilla), minutes, fouls (crimson chip at 4+), "On the floor now"/"On the bench"; a "how" sentence ("Hurting you with scoring and rebounding." / "... But 4 turnovers." when playmaking <= -1.5; words: scoring, setting up teammates, rebounding, defense); four facet bars from a zero tick (crimson positive, grey negative) with the box line under each ("10 pts on 4 of 10, 3 of 4 at the rim, 1 of 4 from three", "2 assists, 2 turnovers", "2 offensive, 3 defensive rebounds", "2 steals, 2 blocks, 4 fouls", pluralized correctly); a half-court chart of his shots (vertical, basket at top, 32 ft deep). Shared shot key below.

## Tab 4: Spreadsheet (mockup 4)
- Header "Your lineup tracker" + "The workbook we sent, filling itself in. A new row starts at every substitution. The download keeps all your tabs and formulas." Controls: **This game | Whole season**, **Download for Excel**, **CSV**.
- A grid that looks like his Stint Log: crimson header row, gray row numbers matching Excel's (data starts at row 2), pale yellow `#FFF8E1` for cells filled from play-by-play, pale green `#EEF6E8` for his formulas, the open stint as the last row with row label "Now", italic, pale crimson, end clock blank. Horizontal scroll inside the grid only; freeze the row number and stint columns. Under it, Excel-style sheet tabs (Instructions, Roster, Stint Log, Lineup Summary, Player On-Off, Game Summary); clicking one shows that tab computed in the page with the same formulas. Legend: filled from play-by-play / your formulas / the group on the floor now, still counting.
- **Download for Excel:** load `public/live-lineups/tracker-template.xlsx` (the exact workbook Lucas has), clear the EXAMPLE row, write one Stint Log row per stint into the input columns only (Game "{Opp} m/d", Date, Opponent, Half, Stint #, Start/End Clock as text "16:42", P1–P5 sorted by last name with Roster spelling, OU Pts, Opp Pts, Off/Def Poss (manual) = exact parsed possessions, FGA, OREB, TOV, FTA both teams, 3PM/3PA both, Rim FGA both, Notes "Auto-filled from play-by-play"), set full recalculation on open, and save as `OU Lineup Tracker - {Opp} {m-d}.xlsx` (Whole season: all games, `OU Lineup Tracker - season to {m-d}.xlsx`). Use ExcelJS in the browser. **Round-trip test required:** dropdowns, red error flags (conditional formatting), cell notes, frozen panes, column widths and every formula must survive; if ExcelJS drops any, write the file in a Vercel Python function with openpyxl instead (reference: `reference/fill_sheet.py`).
- Expected output to diff against: `reference/expected-autofill-3-games.xlsx` (OU's three games). Recalculated, its Game Summary reads 64-68, 84-57, 81-72, 40 minutes each, possessions 67/65, 68/69, 67/68.
- Players not on the Roster tab: add them to the Roster in the download (next free row, jersey from ESPN) and note it in the page.

## Responsive (phone, iPad, laptop)
- Test at 390×844, 430×932 (phones), 820×1180 and 1180×820 (iPad), 1194×834 (iPad Pro landscape), 1440×900 (laptop). No horizontal page scroll anywhere except inside the spreadsheet grid.
- Phones: compact band (scores stacked with team names, clock at right; mockup 7); the tab row becomes a fixed bottom tab bar with the four tabs; every two-column layout stacks; the drawer becomes a full-screen sheet; court goes vertical; the spreadsheet keeps row number + stint columns frozen.
- iPad portrait: Right now stacks "on the floor" under the takeaways; key players two columns then one; shots picker as chips above the court.
- Laptop: max content width 1440, centered.

## Failure states (never silently wrong)
- Bad substitution (1 of 11 live test games; ~4% of 2025-26 games): repair (a player credited with an action while "off" goes on; the teammate idle longest comes off), flag later possessions, banner "One substitution looks wrong at 1st half 11:34. Lineups after that may be off." If repair fails: hide lineup views, keep score, shots, players and box stats, and say why.
- Stale feed: no new data for 60 s while live → banner "Data delayed. Last update 1:20 ago."
- ESPN unreachable: "Can't reach ESPN's play-by-play. Retrying every 15 seconds."
- Reconciliation light by the clock: parsed points vs ESPN's score (green match; amber off for under a minute; red longer).

## Tests and checks (report results)
1. Parser parity (above).
2. Replay the three OU games at 10x: every tab renders at every viewport above; screenshot each.
3. Spreadsheet: download "Whole season" after replaying the three games, recalculate, compare to `expected-autofill-3-games.xlsx` cell for cell on the Stint Log inputs and the Game Summary results; confirm the round-trip features list.
4. Shot chart: for the MVSU game, 93 shots through 9:00 left in the 2nd half (52 OU, 41 MVSU); OU at the rim 12 of 20, threes 9 of 31; MVSU threes 2 of 13 (compare with `reference/shots.json`).
5. Mockup moment: replay MVSU (401906802) to 2nd half 9:00 and compare the Right now tab against mockup 1 (lead "Go at Tymias Williams. He has 4 fouls.", lead +17, "Oklahoma 20–3 run", current five Reid, Wadley, Brown, Forsythe, Mayfield, together 1:01).
6. Live test on 3+ live D1 games for 15+ minutes: refreshes, current five highlighted, reconciliation green except brief catch-ups.
7. **Dry run: OU vs Fairleigh Dickinson, Friday Nov 13, 2026, 7:00 pm CT (01:00 UTC Nov 14), ESPN event 401906804.** Keep the page open all game; log reconciliation, repairs and any banners; afterwards download the spreadsheet and check it against the official box score (points, minutes total 40:00 per game). Then Adam sends Lucas the link.

## Reference parser (Python, from the backtests)
Play rows: `[period, clock, team_id, type, text, scoreValue, scoringPlay, shootingPlay, [participant ids], x, y, homeScore, awayScore]`; box: `{team_id: [[athlete_id, name, starter, didNotPlay, pos], ...]}`. Also in `public/live-lineups/reference/parse.py`.

```python
def clock_s(c):
    if ':' in c:
        m, s = c.split(':'); return int(m) * 60 + float(s)
    return float(c)

def elapsed(period, c):
    t = clock_s(c)
    if period <= 2: return (period - 1) * 1200 + (1200 - t)
    return 2400 + (period - 3) * 300 + (300 - t)

RIM_TYPES = {'LayUpShot', 'DunkShot', 'TipShot'}
# parse_game(g): see reference/parse.py (unchanged from the backtests; port exactly)
```
