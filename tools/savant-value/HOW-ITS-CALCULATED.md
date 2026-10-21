# How Savant value and the All-Savant Team are calculated

Basketball Savant v2.2.0, live on wcehoops.com from Oct 20, 2026. The numbers below are the ones in `public/savant-value.json`.

## In one paragraph

**Savant value** is the number of points a player added to his team over a season, above what a replacement-level player at his position would have added in the same minutes. It is built only from the parts of his game that are his own, and it counts only the possessions he actually played, so missed games cost him. The **All-Savant Team** is the two guards, two wings and one big with the highest Savant value among qualified players, picked twice: a 1st team, then a 2nd team from everyone left. A player can make only one team.

## The team

- **Shape:** Guard, Guard, Wing, Wing, Big, every season back to 1979-80.
- **Positions** are Basketball Savant's own (Guard, Wing or Big, the same group a player is ranked in on his card). The page's manual overrides apply, so Luka Dončić counts as a guard.
- **Who is eligible:** players who qualify for that season's percentile pools. For a finished season that is 20+ games at 15+ minutes. In season the games bar is pro-rated, and in opening week one game qualifies.
- **Picking:** sort each position by Savant value. The 1st team takes the top two guards, top two wings and top big. The 2nd team takes the next best at each spot.
- **On the landing page:** the newest season is shown once its teams have played 10 games (median team). Until then the landing shows the last full season with a note, and the new season is in the picker from night one.
- **The honour:** a player on either team when the season is over gets "All-Savant 1st" or "All-Savant 2nd" with that season's other honours. It appears on his card, the career-arc tips, the share image, and his player page header and season table. A season in progress counts as over once its teams have played 82. Before that it is a standing, not an honour: the card shows nothing, and the AI connector says "so far".

## The formula

**Value = (Rate − Replacement rate) × Possessions ÷ 100**

- **Rate:** points per 100 possessions he is worth compared with an average player at his position. It is the sum of the parts below.
- **Replacement rate:** the 25th-percentile rate among qualified players at his position that season. In 2025-26 that was −1.35 for guards, −1.18 for wings and −1.24 for bigs.
- **Possessions:** the possessions he was on the floor for that season.

### Step 1. The stats, and what each one is worth

Every stat is turned into a per-100-possession or percentage number, then measured against his position's average that season.

| Part | Stat | Settle point (k) | Worth (β) | Credit (c) | Net, per unit (β × c × 1.019) |
|---|---|---|---|---|---|
| Scoring | Points over average efficiency per 100 | ts: 282 shooting attempts | +1.277 | 0.79 | +1.030 |
| Scoring | Usage % | 112 possessions | +0.160 | 0.87 | +0.143 |
| Scoring | 3-point attempt rate | 9 field-goal attempts | +0.045 | 0.96 | +0.045 |
| Scoring | Free-throw rate | 60 field-goal attempts | +0.016 | 0.94 | +0.015 |
| Playmaking | Assist % | 141 possessions | +0.190 | 0.88 | +0.170 |
| Playmaking | Turnovers per 100 | 398 possessions | −1.211 | 0.88 | −1.092 |
| Rebounding | Offensive rebound % | 266 possessions | +0.300 | 0.95 | +0.291 |
| Rebounding | Defensive rebound % | 316 possessions | +0.042 | 0.93 | +0.040 |
| Defense | Steals per 100 | 750 possessions | +2.154 | 0.91 | +2.005 |
| Defense | Blocks per 100 | 335 possessions | +0.670 | 0.95 | +0.649 |

**How to read a row:** every steal per 100 possessions above his position's average adds about 2.0 points per 100 to his rate. Every point of usage above average adds about 0.14.

### Step 2. Luck: pull each stat toward the average by its settle point

`shrunk = (n × his number + k × position average) ÷ (n + k)`

- `n` is his sample, in the stat's unit (shooting attempts for TS%, field-goal attempts for 3PA and FT rate, possessions for the rest).
- `k` is the stat's settle point: the sample at which his own number and the position average count equally. These are the same settle points the card's "likely to settle" marks use, measured from 16 seasons of our own data.
- A player with a small sample is pulled most of the way to average; a full-season starter barely moves.

### Step 3. Relative to his position

- The position average is the possession-weighted mean of every player at that position that season (attempt-weighted for TS%). Each stat enters as **shrunk number − position average**, so an average guard sits at zero on every stat.
- **Scoring efficiency** is in points. It is 2 × his true-shooting attempts per 100 × (his shrunk TS% − the league's TS% that season), then centered on his position.
- Per-75 stats on the card (turnovers, steals, blocks) are converted to per 100.

### Step 4. The box-score rate

`Box rate = 1.019 × Σ β × c × (shrunk stat − position average)`

- **β (worth)** is what the stat is worth in points per 100. It is learned (see "Where the numbers come from").
- **c (credit)** is the share of the stat that is his own, not his team's.
- **1.019** is the scale check (see below). It barely moves anything.

### Step 5. The floor: what on/off adds

Box scores miss a lot of defense and off-ball value. So wherever luck-adjusted on/off exists (2009-10 on in today's data), the rate also takes in part of what the floor says beyond the box score:

`On-floor part = 1.019 × w ÷ (w + 6,400) × (his on/off − expected on/off)`

- **Luck-adjusted on/off** is how much better his team was per 100 possessions with him on the floor than without him, with opponents' 3P% and FT% set to league average. It is measured against his position's average.
- **Expected on/off** = 0.855 + Σ β × (shrunk stat − position average) + 0.0994 × (his minutes share − position average). It is what his box score and his role predict, with no credit discount. The minutes-share term is there because starters share the floor with starters, which flatters their on/off.
- **w** is how trustworthy his on/off is: w = 1 ÷ (1/minutes on + 1/team minutes without him). An on/off is only as good as the smaller of its two samples.
- **w ÷ (w + 6,400)** is about 13% for a full-time starter and less for anyone else. Most of a player's value still comes from his own stats.
- **Before 2009-10** there is no on/off, so this part is zero.

**Rate = Box rate + On-floor part.**

### Step 6. Value

`Value = (Rate − Replacement rate) × Possessions ÷ 100`

**Missed games cost him:** he adds nothing on nights he doesn't play, the same rule as Football Savant's All-Savant Team.

## Worked example: Nikola Jokić, 2025-26

- **His season:** 4,854 possessions over 65 games and 2,265 minutes. True shooting .670, usage 28.9%, assist % 45.8, 3.8 turnovers per 75, luck-adjusted on/off +15.8.
- **Parts, per 100 vs. an average big:**

  | Part | Per 100 | Driven by |
  |---|---|---|
  | Scoring | +4.88 | Efficiency and usage |
  | Playmaking | +3.07 | Assists, less his turnovers |
  | Rebounding | +0.33 | |
  | Defense | +0.39 | |
  | On-floor | +0.29 | His on/off weight is 13% |
  | **Rate** | **+8.96** | |

- **Replacement for bigs:** −1.24.
- **Value:** (8.96 − (−1.24)) × 4,854 ÷ 100 = **+495 points**. That is 1st among bigs and earns the 1st-team big spot.

## 2025-26 teams

| | Guard | Guard | Wing | Wing | Big |
|---|---|---|---|---|---|
| 1st | Gilgeous-Alexander +465 | Dončić +361 | Leonard +349 | Antetokounmpo +204 | Jokić +495 |
| 2nd | Mitchell +262 | Murray +251 | Murphy III +181 | Barnes +176 | Wembanyama +311 |

## Where the numbers come from

All of it is learned by `tools/savant-value/value.py fit`. It was learned on 2009-10 to 2024-25, with 2025-26 held out and never used. Everything is measured inside one season and one position, so a league-wide drift (more threes, faster pace) can't pass for skill.

- **Worth (β):** a ridge regression of luck-adjusted on/off on the shrunk, position-centered stats. It used 6,498 player-seasons with 250+ minutes, each weighted by how trustworthy its on/off is. Minutes share is in the regression as a control and left out of every player's rate.
  - **The penalty** was chosen by leaving one season out at a time: 1e5.
  - **A heavier penalty was rejected.** It predicts next season slightly better, but it turns turnovers into a positive, which can't be right.
- **Credit (c):** how well each stat carries from one season to the next for players who changed teams, divided by the same for players who stayed (1,500+ possessions both years, same position). A franchise moving cities doesn't count as a change. A stat that doesn't follow a player to a new team is partly his team's.
- **The on/off weight (K = 6,400):** chosen so this season's rate best predicts next season's on/off for players who changed teams. 2025-26 is never the target. For all players the best K was 3,200, and for players who stayed it was 2,263; the most cautious one is used.
- **Scale (1.019):** a team's minutes-weighted sum of its players' rates, compared with its luck-adjusted net rating, over 210 team-seasons (2018-19 to 2024-25). Slope 1.02, correlation 0.79. So a rate really is points per 100, and every rate is multiplied by 1.019.
- **Tested and left out:**
  - **Tracking stats** (rim protection, deflections, drives, potential assists) added under 0.01 of predictive power. Leaving them out keeps one method for all 48 seasons.

## How well it works

- **Next season (the honest test):** on the held-out 2025-26 season, a player's 2024-25 rate correlated .37 with his 2025-26 luck-adjusted on/off. BPM correlated .35.
  - **Season value** correlated .385.
  - **Over the fit seasons:** rate .44, BPM .41.
  - **One weak spot:** among the 116 held-out players who changed teams, the box-score part alone (.20) did better than the full rate (.16) and BPM (.18).
- **The real All-NBA** (a sanity check, never a target), 1988-89 on:
  - 56% of our 1st team made the real 1st team.
  - 63% of our 1st and 2nd teamers made the real 1st or 2nd team.
  - 75% made some All-NBA team.

## What it cannot do

- **Defense before 2009-10** counts only through steals, blocks and defensive rebounding, because there is no on/off.
- **Positions** are inferred, and a few are odd (Shawn Marion is a guard in 2004-05).
- **Shape** differs from the league's: the league has voted a positionless All-NBA since 2023-24, and ours is always 2-2-1.
- **Early in a season** the team is a running total on small samples, which is why the landing waits for 10 games and the honour waits for the full season.

## Files

- **Model and checks:**
  - `tools/savant-value/value.py`: learns the model and writes `public/savant-value.json` and `out/report.txt`.
  - `python3 value.py teams 2025-26` prints the teams.
  - `python3 value.py expected` refreshes the check fixture.
- **One implementation:** `public/savant-value.js` is used by the page, the player pages (`scripts/lib/savant-core.mjs`) and the AI connector (`scripts/lib/savant-value.mjs`).
- **Checks:**
  - `npm run check:savant-value` holds the JavaScript to `value.py` on every player.
  - `check:savant-api` and `check:savant-mcp` hold the connector to the page.
- **Connector:**
  - `nba_all_savant_team` returns the teams for any season.
  - `nba_get_player_profile` includes `savant_value`, with `all_savant_team` and `all_savant_final`.
- **Relearn only on purpose,** after a full data rebuild: `python3 value.py fit && python3 value.py expected`, then run the checks.
