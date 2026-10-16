# Fact-check report: "Can Fox, Castle and Harper actually start together"

Checked: `/home/claude/spurs-article/export/body.json` (110 top-level blocks). Block references are `[top-level index]` or `[index.sub]` for nested blocks inside `math`/`argue` boxes. All recomputation scripts are in `/tmp/claude-0/-home-claude/579b45ca-9639-5350-a661-3dab5cf0ace4/scratchpad/factcheck/`. Percentiles were recomputed with the Basketball Savant site's own formula (midrank, qualified players, league pool by default, `lower:true` metrics inverted) from `/home/claude/western-conference-elitists/public/savant-data.json`.

---

## ERRORS

### Substantive

1. **[65] defense table, Wembanyama "Matchup difficulty pct." = "n/a", and table note: "Savant lists no matchup-difficulty percentile for Wembanyama."**
   Wrong. Savant has `mtch` = 12.0 for Wembanyama (3,841 matchup possessions, qualified, far above the 200-possession threshold). The site has no rule that hides `mtch` for bigs. With the site's percentile formula: **33rd percentile league-wide** (39th among bigs). Correct cell: "33rd". Delete the note's last sentence.
   *How:* `savant-data.json` → 2025-26 → Victor Wembanyama → `m.mtch.season`; the metric config in `basketball-savant.html` (`"key": "mtch"`, `thr` 200, no position exclusion); `sav.py` → `pct()`.

2. **[59.0] "Swapping Champagnie or Vassell for Harper lowers the lineup's average by about 0.8 points, which is roughly 2 points per 100."**
   The 2.7 coefficient (reproduced: 2.743, SE 0.321, `ortg ~ usg_over + sh_mean_pts + lmin + C(ts)`) is per point of the lineup's average *shrunk* 3P%, where each player's value is 0.36 + (3P% − 0.36)·n/(n+351) (`lu_spacing3.py`). The 0.8 uses *raw* 3P% ((38.4 − 34.3)/5 = 0.82), which is a different variable. On the model's own scale the swap lowers the average by **0.38 points (Vassell) / 0.36 (Champagnie)**, which works out to **≈1.0 point per 100, not 2**. (This happens to match the verdict in [62], "about 1 point per 100".)

3. **[9.5] "So the best estimate from last season is a trio about 4 points per 100 worse than the Spurs' average, not 25 points worse."**
   "About 4 worse" is right (7.6 − 3.9 = 3.7). But the raw record was not 25 points worse than the Spurs' average. It was **-24.7, about 33 points worse than the team's raw +8.4** (or 29 worse luck-adjusted: -21.3 vs +7.6). The "25" measures the gap from zero, not from the average. Fix: "not 33 points worse", or "not -25".

4. **[25.5] "Guards whose assist rate fell by six points or more from one season to the next (183 of them, an 8.6-point average drop) cut their turnover rate by 1.6 points. The 243 whose assist rate jumped by six or more added 1.5."**
   `skill.py` has no position filter, so 183 and 243 count **all positions**, not guards. The guards-only figures are: **136 drops (average −8.7, turnover rate −1.7)** and **156 jumps (average +9.0, turnover rate +1.45)**. Either change "Guards" to "Players" or use the guard figures.
   *How:* `skill_g.py` (the same pairs as skill.py, filtered to `pos == 'Guard'`).

5. **[29.0] "...the numbers say how much: Castle-to-Wembanyama is the most efficient two-man action the Spurs have."**
   The data does not support this. The only two-man data here is passing tracking. Among Spurs pass pairs with 50+ shots in the six `ptpass_*` files, Castle→Wembanyama (FG 56.3%, eFG .636) ranks **6th by eFG**. These pairs rank above it:
   - Castle→Kornet: 52/57 (.912)
   - Harper→Barnes: .706
   - Castle→Champagnie: .701 on 162 FGA
   - Fox→K. Johnson: .665
   - Castle→Fox: .648

   What the data does support is the highest-volume connection, and the best among passes *to Wembanyama*. If "action" means pick-and-roll, there is no screen-level data here to support it.

6. **[106] checklist, roll man row, why: "The most efficient play in their offense."**
   Cuts were more efficient: **1.391 PPP vs 1.263** for the roll man (`synteam_Cut_offensive`, `synteam_PRRollman_offensive`). The roll man leads only by league percentile (100th vs 97th). Suggested fix: "The best play in their offense relative to the league", or "one of their two most efficient plays".
   A related overstatement is **[73] "The best plays in their offense were the rarest."** Post-ups (2.4%) were rarer than both. Of nine play types, the roll man (4.3%) was the 2nd-rarest and cuts (6.0%) the 5th-rarest, more common than off-screens (5.0%) and handoffs (5.1%).

7. **[103] "...the five that was the best lineup on the team last season by every measure in Part 8."**
   This is not true in the article's own sortable lineup table (`export/lineups.json` rs5, 5+ minutes):
   - **Raw net: 3rd.** Behind Barnes–McLaughlin–Wembanyama–Castle–Bryant (+148.5 in 5 min) and Olynyk–Fox–Waters–Wembanyama–Bryant (+100.0 in 8 min).
   - **Luck-adjusted: 4th.** 119.1, 96.0 and 83.6 are all above its 82.3.
   - **Sample-adjusted: 1st.**

   It is best on all three measures only among units with 20+ minutes. Block [87] ("even after you adjust for it, it was the best") is fine.

8. **[52] "His late-season free throws dropped to 68.2%" and [106] checklist baseline "68.2% over his last 25 regular-season games".**
   68.2% (45/66) is Savant's last-25 window, which is the **team's** last 25 games. Fox played 24 of them. Over **his own last 25 regular-season games** he shot **47/70 = 67.1%**. That is also the figure the article's own projector data ships (`export/shooting.json` Fox `l25` = [38,132,47,70]).
   The article's definition of "last 25" is also inconsistent. Castle's figure in [41] (35/85) uses his own last 25 games, while Fox's 68.2% and Harper's .657 TS in [50] use Savant's team window. Over Harper's own last 25 games his TS is .644 (Savant window: .657 over 23 games). Pick one definition and use it throughout.

### Minor

9. **[41] "Basketball Savant's last-25 window has every one of those makes assisted."**
   Savant's window is not "those" 35 of 85. It is the team's last 25 games: **32 of 78 (41.0%)**, with `uast3_l25` = 0.0% on 32 makes. The claim that all 35 of his own last-25 makes were assisted is **true**: play-by-play shows 35 of 35 with an AST tag. The fix is the attribution: "every one of those makes was assisted (play-by-play)".

10. **[28.1] "Per 100 minutes they shared, that is 3.6 lobs from Castle, 1.7 from Fox and 1.1 from Harper."**
    These rates are regular-season only (44/1,213 min, 19/1,144, 6/560). The sentence just before gives regular-season plus playoff counts. On those totals (58/1,766, 28/1,655, 7/938) the rates are **3.3, 1.7 and 0.7**. Label the rates "in the regular season", or use the combined rates.

11. **[39.1] "On wide-open threes, the league shot 39.0%."**
    39.0% is the rate among the 305 players with 100+ tracked threes. Across **all players** in `lg_closedef_6+` it is **38.4%**. Say "players with 100+ attempts shot 39.0%", or use 38.4%.

12. **[47.2] "...regresses next season's percentage on each of the last two seasons (each shrunk by its attempts), career free-throw percentage and age."**
    `proj.py` uses a **two-season** FT% (current plus prior season, weighted by attempts), not career FT%. The model also includes last-25 terms (`l25d`, `l25y`), which the text does not mention.

13. **[109] Methods: "Shooting studies: Basketball Savant player seasons from 2012-13 on."**
    Only the reliability and hot-streak studies start in 2012-13. The other two use different years:
    - The projection model (2,627 seasons, `proj.py`) uses 2010-11 on.
    - The FT prior uses 2019-20 on (correctly stated in [47]).

    Also, "each player's last 25 games of the season" is in fact the team's last 25 games (Savant `l25`).

14. **[92] "...and an optional usage penalty from Part 2."**
    The lab model's usage term is **−0.188 per point on luck-adjusted net** (`lab_model.json` A, reproduced with WLS `adj ~ obpm + dbpm + usg_over`, no team effects). That coefficient appears nowhere in Part 2, whose table gives −0.131, −0.162, −0.050, −0.006 and −0.119.

15. **[21.2] "Without any talent control the sign flips (+0.10)."**
    No specification gives +0.10:
    - Team-season effects + ln(min): **+0.094** (rounds to +0.09).
    - Team-season effects only: +0.154.
    - No controls at all: +0.192.

    Suggest "+0.09".

16. **[43.3] "93 players"** are 93 player-seasons (84 distinct players). The same applies to **[18.0] "The 481 players"**, which are season pairs. This is a wording issue.

17. **[48.0] "That is a gap of about 2 points (Harper)..."**
    The model has Harper at 36.0, against Vassell 37.2 and Champagnie 37.8, so the gap is 1.2 to 1.8 points. "About 1.5" is closer. (Castle's "about 4" is right: 3.9 to 4.5.)

18. **[29.0] "His turnovers dropped as the season settled"** (and [28.2], which lists only October to March).
    April went back up to **3.4 per game** (5 games). This is an omission, not a wrong number.

### Rounding notes (rounded value differs, caused by rounding order; low severity)

- **[9.3] "-21.4 after the luck adjustment"**: the precise possession-weighted value is **-21.33**, which rounds to -21.3. The -21.4 comes from combining the components after rounding them (RS -18.0, PO -23.7). The final +3.9 is unaffected (3.896).
- **[25.4] off-ball "13.4 + 1.8 ≈ 15.2%"**: unrounded, 13.37 + 1.75 = 15.12, which rounds to 15.1.
- **[64] Harper "6'11" wingspan"**: Savant length is 82.5 in (6'10.5") and the Draft Savant measurement is 82.625 in. This is a borderline round-up.
- **[94] "between about +11 and +12"**: the Phoenix start projects +10.85 with the penalty on. Acceptable as "about".

### Consistency note (not an error)

- The headline trio estimate of **+3.9** ([6], [9]) pools regular-season and playoff possessions. The sortable lineup chart [85] lists the trio separately, as **+6.2 (RS)** and **+5.1 (PO)**, and never shows 3.9. A reader who filters the chart for the trio will not find the headline number. Consider a one-line note.

---

## UNVERIFIABLE

- **[4], [5] Coach identity and quote**: that Mitch Johnson made the call, and his words "three of the team's better players". No coaching or quote data here. (The start itself is verified; see below.)
- **[80] "This summer the three guards visited him in France, and his take on starting together was simple: more ball handlers make his job easier."** No news or quote source in the data.
- **[27.0] "At UConn, where Castle rarely started possessions..." and "Coming out of the draft he wanted to be a point guard, and the Spurs let him."** Draft Savant has no on-ball or possession-start data. Castle's college usage (22.4%, 34th percentile among first-round picks) is consistent with a secondary role, but it does not establish the claim. The point-guard preference is a news claim.
- **[44.0] "In the video I said Castle's free-throw percentage never really moved..."** This is the video's content. As a side note, his RS-only FT% did move: 72.5% before March, 76.0% from March on (76/100).
- **[52] "...which read as an injury flag."** There is no injury data here.
- **[103] "contract and roster realities with Fox."** There is no contract data.
- **[70] "the best rim protector in the world"**: opinion. The supporting numbers (rim −8.6, block rate 9.4%, 99th percentile) are verified.
- **Clip captions [7], [26], [34], [42], [51], [53], [67], [71], [79]**: the video itself can't be checked here. Play-by-play does confirm the underlying plays for three of them:
  - **[7]**: Fox's cutting dunk off a Wembanyama assist (Q2 9:57) and Harper's layup off a Castle feed (Q2 2:30) both happened Oct 14. In the game Fox's play came first; the caption lists Harper first.
  - **[79]**: Fox and Castle both threw Wembanyama alley-oops Oct 14.
  - **[26]**: Castle had 26 bad-pass turnovers in the final month of the regular season, so three exist.
- **[14.1] "0.44 ... average out to about 0.44 possessions per attempt"**: a standard convention, not derivable from this data.

---

## VERIFIED (compact)

**Part 1: the trio, the preseason start and the bar to clear**
- **[4] Oct 14 start.**
  - Play-by-play starter inference over all 109 games: Oct 14 vs PHX is the **only** game Fox, Castle and Harper all started. The other starters were Vassell and Wembanyama.
  - Spurs won 123-103.
  - Trio: 12 min, 25 possessions, ORtg 120 / DRtg 80, so 30-20, **+10**.
  - Champagnie had no log row Oct 14 (he played the other three preseason games).
- **[6], [8] Trio last season.**
  - Regular season: 25 min, 65 possessions, −21.
  - Playoffs: 44 min, 94 possessions, −26.
  - Totals: 69 min, 159 possessions, −47. The playoffs included the Finals vs NYK (0042500401-405).
- **[9] Adjustments.**
  - Raw −24.7, possession-weighted.
  - Team luck-adjusted +7.613.
  - k for three-man groups: 1221·(843/1221)^(1/3) = 1079; four-man: 954.
  - Estimate +3.896, shown as +3.9.
  - k = 843 / 1,221, the 5.7 true spread and the Jan 15 split all match Savant (`public/lineups/2025-26.json` `k`, `tools/savant-explainers/explainers_tabs.py`).
- **[11] Starters (Fox, Vassell, Champagnie, Wembanyama, Castle).** Most-used five, 284 min, +17.6 raw, +16.06 luck-adjusted, +11.19 sample-adjusted.

**Part 2: usage**
- **[14]** Usage sums over 5,669 units: mean 98.98, SD 8.86.
- **[15]** Usage table: all 30 cells match Savant 2025-26.
- **[16]** Usage sums 118.8% and 115.8%.
- **[17]**
  - Wembanyama 30.2 points/75 (98th) and on/off +16.4 (99th).
  - Fox: 59.5% unassisted (94th), 2.71 A/TO.
  - Harper and Fox both 13.6 drives/75.
  - 31.6 + 24.3 + 24.2 + 21.1 = 101.2.
- **[18] Usage-change study.**
  - 3,658 pairs; −0.103 TS per usage point with age.
  - 481 drops averaging −4.42, +0.56 TS.
  - Fox usage 30.0 → 24.2, TS .567 → .578.
  - Fox usage possessions/36: 19.9 with Castle vs 26.7 without (14 games); 19.8 with Wembanyama vs 25.4 without.
- **[19], [21] Regression table.**
  - Coefficients (SE): −0.131 (.021), −0.162 (.026), −0.050 (.022), −0.006 (.019), −0.119 (.023).
  - Units at 112%+ usage: −0.99.
  - 18.8 × 0.162 = 3.05.

**Part 3: turnovers**
- **[23]** Castle AST% 23.1 → 34.4; TOV% 13.4 → 18.0 (5th percentile).
- **[24], [25] Turnover model.**
  - 177 guards; TOV% = 12.13 + 0.27·AST − 0.25·USG; R² 0.368.
  - Castle: predicted 15.33, residual +2.67, worse than 82.5% of guards.
  - Persistence: 1,189 pairs, r 0.648, slope 0.65. Rookie residual +1.37.
  - Arithmetic: 0.65 × 2.7 = 1.76; 15.3 + 1.8 = 17.1; off-ball prediction 13.37.
- **[27]** UConn TOV% 10.0, 88th among first-round picks since 2010 (Draft Savant).
- **[28] Wembanyama connection and Castle's turnovers.**
  - Castle → Wembanyama: 657 passes, 129 assists, 56.3% FG after the pass; Fox 51.2%, Harper 50.6%.
  - Lobs: Castle 44 / 14, Fox 19 / 9, Harper 6 / 1 (subType and description agree).
  - Castle turnovers per game by month: 5.4, 3.1, 3.5, 2.9, 2.8, 2.7.

**Part 4: shooting**
- **[32]** Three-point %: Fox 33.2, Castle 33.2, Harper 34.3. Vassell 38.4% on 6.4/g; Champagnie 38.1% on 6.2/g.
- **[33]** Shooting table: all 28 filled cells match (Draft Savant college lines, Savant seasons, NBA.com game-log splits).
- **[37] Catch-and-shoot and pull-ups.**
  - Catch-and-shoot: Fox 38.7, Harper 38.7, Castle 38.0, Vassell 38.8, Champagnie 38.5; league 37.1.
  - Pull-ups: Fox 55/195 (28.2%), Castle 5/43, Harper 6/35.
- **[38], [39] Wide-open threes.**
  - Share of threes wide open: Castle 72.5 (90th among guards), Harper 76.4 (96th), Vassell 21.8, Champagnie 33.5.
  - Wide-open 3P%: Castle 37.3, Harper 33.1, Fox 32.9, Vassell 43.6, Champagnie 49.7.
  - Gravity vs wide-open share: r −0.633 over 196 players.
- **[41]** Castle 26.7 → 28.5 → 33.2. His own last 25 games: 35/85 (41.2%), all 35 makes assisted (play-by-play).
- **[43] Reliability and hot streaks.**
  - Three-point true spread 2.51 (median); 300-attempt noise 2.78; k median 367; tex arithmetic 359.
  - Free throws: spread 8.5, k 24.
  - Hot finishes: 93 cases; 37.0 season / 44.4 last 25 / 37.1 next season. Under 23: 23 cases, 37.4 next.
- **[44]**
  - Castle FT: 72.5% on 284 (Oct to Feb), 79.2% on 236 (March on), 81.6% in the playoffs.
  - Castle 3P: 29.3% → 38.2% on 170.
  - Harper: 25.4 / 72.9 → 42.4 / 83.7.
- **[45]**
  - Late-FT term: −0.049 (SE 0.027), n = 1,015 (late FTA ≥ 50).
  - 17 players with both jumps: 36.1 → 35.8.
  - Castle playoffs 35/100.
- **[46], [47] Projection model.**
  - 2,627 seasons.
  - FT prior: n 1,598, a .2257, b .1718, τ .023, k 440.
  - Projections: Castle 33.3, Harper 36.0, Fox 33.9, Vassell 37.2, Champagnie 37.8.
  - Residual SD 1.77; 80% band ±2.27.
- **[50]** Harper 18.9 on draft day (79th percentile for youth among first-round picks since 2010); .657 TS (Savant window); 27.1% three-point rate (8th among guards).
- **[52]** Fox 2023-24: 36.9% on 7.8 3PA, xeFG .508 (5th); 2025-26 xeFG .535; 75.8% FT in the playoffs; 24.6% in college; seven seasons to get there.

**Part 5: spacing**
- **[58] Help model.**
  - With the defaults, helping is optimal at every listed open %.
  - The cheapest help goes off Castle in the starting five, off Harper in the Harper version, and off Fox when Castle or Harper drives.
  - 0.4 × 3 × 0.042 = 0.050.
- **[59], [60] Lineup shooting regressions.**
  - Coefficient 2.743. With OBPM and team effects: +0.471 (SE 0.369, not significant).
  - Lineups by number of weak shooters: zero +1.13; one to four within ±0.24; five −1.73 (97 units).
- **[61]** Trio in the playoffs: eFG .414, ORtg 81.9, 94 possessions.

**Part 6: defense**
- **[64], [65] Defense table.**
  - Heights and weights match Savant.
  - Opponent and rim differences match for all four players.
  - Matchup percentiles 99 / 30 / 68 for Castle / Harper / Fox (Wembanyama's "n/a" is error 1).
  - All 8 Synergy PPP values and percentiles match; Harper's isolation sample is 31 possessions.
- **[66]** Castle: 35.9% of matchups vs high-usage players; top assignments George, Gilgeous-Alexander, Dončić, Cunningham. Guard share of matchups: Fox 67.3, Harper 68.0.
- **[68]**
  - Harper: −3.2 opponent FG% (87th); 13.8% of matchups vs high-usage players, against 35.9 (Castle) and 19.2 (Fox).
  - Fox: 185 lb (7th percentile); rim +2.0; P&R defense 0.892 (44th).
- **[69]**
  - Harper vs high-usage players: 28.8 per 100 on 31/80 (38.8%). Castle 26.9; Fox 28.5.
  - Isolation share of plays defended: Fox 4.6 / Castle 6.1 / Harper 6.1. Fox isolation PPP 0.895 (56th).
- **[70]** Wembanyama: rim −8.6; block rate 9.4% (99th).

**Part 7: Wembanyama**
- **[73], [74] Team play types.**
  - Roll man: 4.3% of plays vs a league mean of 5.38%; 1.263 PPP (100th).
  - Cuts: 1.391 PPP (97th) on 6.0% of plays.
  - Chart: 29 other teams.
- **[75], [76] Wembanyama's play mix.**
  - Isolations + post-ups: 21.5% of plays, 0.896 PPP (40th / 41st).
  - Rolls + cuts: 18.6%, 1.391 PPP.
  - Arithmetic: Δ = 0.0494; 31.6 × 0.049 = 1.55.
- **[78]** Frequency vs efficiency: teams r +0.055 (roll man), +0.046 (cuts); players r 0.02 (83 players), −0.075 (117 players).
- **[80]** Wembanyama A/TO 1.28 (15th).

**Parts 8 and 9: lineups and the lab**
- **[82] Pairs** (all match):

  | Pair | Net | Minutes |
  |---|---|---|
  | Castle–Harper | +11.0 | 533 |
  | Fox–Castle | +9.4 | 1,022 |
  | Fox–Harper | +6.2 | 538 |
  | Fox–Wembanyama | +16.9 | |
  | Castle–Wembanyama | +17.0 | |
  | Harper–Wembanyama | +27.0 | 560 |

  The team was +8.4. Fox–Harper is the weakest pair on all three measures.
- **[87], [88] The alternative five.**
  - 27 min, +98.2 raw, 82.26 luck-adjusted, 12.26 sample-adjusted (the best sample-adjusted five).
  - Shrink-chart inputs match.
- **[90]** Talent prior 11.94 gives an estimate of 16.3; the starters' prior 12.03 gives 13.7.
- **[92], [94] Lineup lab.**
  - Model A and B coefficients reproduce.
  - r = 0.593 on 282 units with 400+ possessions.
  - Presets with the usage penalty: 10.85 to 12.17. Without it the three-guard fives lead (14.41, 13.72).

**Parts 10 and 11: verdict and checklist**
- **[97] to [100]**
  - Castle projects 33.3 (stated "33 to 34%").
  - Harper projects best of the three (36.0).
  - Fox usage 30 → 24, TS up.
  - Wembanyama 1.246 PPP rolling, 1.530 cutting.
- **[102]** Champagnie: 14.6% usage, 49.7% wide-open, +11.0 luck-adjusted on/off (98th).
- **[106] Checklist baselines.**
  - Castle FT 73.4 / 79.2.
  - Castle wide-open share 72.5.
  - Castle catch-and-shoot 38.0. About 44 attempts in 15 games, SD 7.2 points (stated ±7).
  - Castle FTA: 5.65 per game, so about 85 in 15 games.
  - Harper three-point rate 27.1 (8th among guards).
  - Fox playoff FT 75.8.
  - Roll man 4.3 / 5.4.
  - Castle turnover rate 18.0.
- **[109] Methods.**
  - League 3P% 35.96 and FT% 78.29.
  - k values.
  - Savant data dated 2026-07-13 (`generated` field).
  - 5,669 lineup units.
  - Lob definition reproduces the counts.

**Style**
- No em dashes (U+2014), en dashes or uses of "like" anywhere in the article text, including titles, captions, table cells, checklist fields and tex.

Roughly 330 individual numeric and factual claims verified.
