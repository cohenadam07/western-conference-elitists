# mtchc, Module 4 report

Matchup difficulty (creation-weighted) against Matchup difficulty, 2017-18 to 2025-26 (2026-27 to
date shown where useful). Built by `tools/savant-mtchc/` from the published season values and the
cached LeagueSeasonMatchups; `mtch` is recomputed from the same tables so both stand on the same
data (2024-25 and 2025-26 differ from the site's published mtch, which predates the NBA's revision
of those two tables: mean move 0.12, ranking Spearman 0.997).

Sample: qualified defenders over the low-sample threshold, 560 matchup possessions. Every qualified
defender in a finished season clears it: 2,972 defender-seasons, 315-349 a season.

Threat as approved: Scoring (Points / 75, points above average efficiency), Creation (Assist %,
potential assists, assist points created, time of possession; three inputs in 2024-25), Overall
(OBPM and, from 2025-26, on-ball gravity, net of Scoring), each re-standardised and shrunk with
k = 251 / 84 / 316 minutes. "Equal weights" is the comparison column: Overall not netted, k 211.

## 1. Correlation with mtch

Qualified defenders over 560 matchup possessions. Pooled 2017-18 to 2025-26: n = 2972.

| season | n | Pearson | Spearman | equal-weight Spearman |
|---|---|---|---|---|
| 2017-18 | 319 | 0.58 | 0.60 | 0.72 |
| 2018-19 | 323 | 0.72 | 0.70 | 0.80 |
| 2019-20 | 320 | 0.80 | 0.77 | 0.85 |
| 2020-21 | 345 | 0.84 | 0.83 | 0.90 |
| 2021-22 | 342 | 0.85 | 0.85 | 0.85 |
| 2022-23 | 322 | 0.88 | 0.87 | 0.90 |
| 2023-24 | 315 | 0.85 | 0.82 | 0.90 |
| 2024-25 | 337 | 0.91 | 0.89 | 0.90 |
| 2025-26 | 349 | 0.88 | 0.83 | 0.89 |
| pooled | 2972 | 0.79 | 0.78 | 0.83 |
| 2026-27 to date | 160 | 0.88 | 0.86 | 0.88 |

Pooled across seasons the correlation also carries season-to-season shifts in league scoring (mtch is in PPG); the by-season rows are the cleaner read.


**2025-26: the 15 who rise most against mtch** (rank of 349)

| defender | pos | mtch rank | mtchc rank | Creation / Scoring pct | why |
|---|---|---|---|---|---|
| Caleb Love | Guard | 307 | 149 | 76 / 10 | 17% of his matchups on the top-50 creators (league 15%), 9% on the top-50 scorers (league 15%); most threat from Payton Pritchard (2%), Shai Gilgeous-Alexander (1%), Devin Booker (1%) |
| Craig Porter Jr. | Guard | 262 | 109 | 88 / 17 | 22% of his matchups on the top-50 creators (league 15%), 10% on the top-50 scorers (league 15%); most threat from Cade Cunningham (1%), T.J. McConnell (1%), Tyrese Maxey (1%) |
| Jevon Carter | Guard | 329 | 181 | 77 / 6 | 15% of his matchups on the top-50 creators (league 15%), 8% on the top-50 scorers (league 15%); most threat from Andrew Nembhard (1%), T.J. McConnell (1%), Cade Cunningham (1%) |
| Daniss Jenkins | Guard | 254 | 107 | 93 / 20 | 20% of his matchups on the top-50 creators (league 15%), 12% on the top-50 scorers (league 15%); most threat from Tyrese Maxey (2%), Tre Jones (2%), T.J. McConnell (1%) |
| T.J. McConnell | Guard | 336 | 189 | 73 / 5 | 15% of his matchups on the top-50 creators (league 15%), 7% on the top-50 scorers (league 15%); most threat from Ryan Rollins (2%), Craig Porter Jr. (2%), Jalen Brunson (1%) |
| Kam Jones | Guard | 333 | 192 | 90 / 2 | 22% of his matchups on the top-50 creators (league 15%), 8% on the top-50 scorers (league 15%); most threat from Tyrese Maxey (2%), LaMelo Ball (1%), Isaiah Collier (3%) |
| Dru Smith | Guard | 211 | 73 | 92 / 35 | 21% of his matchups on the top-50 creators (league 15%), 14% on the top-50 scorers (league 15%); most threat from Cade Cunningham (1%), Luka Doncic (1%), Jamal Murray (1%) |
| Mike Conley | Guard | 262 | 132 | 78 / 22 | 19% of his matchups on the top-50 creators (league 15%), 10% on the top-50 scorers (league 15%); most threat from Reed Sheppard (3%), LaMelo Ball (1%), Kon Knueppel (2%) |
| Kasparas Jakucionis | Guard | 297 | 169 | 80 / 10 | 18% of his matchups on the top-50 creators (league 15%), 9% on the top-50 scorers (league 15%); most threat from Payton Pritchard (2%), Jaylen Brown (1%), Donovan Mitchell (1%) |
| Killian Hayes | Guard | 319 | 194 | 94 / 2 | 23% of his matchups on the top-50 creators (league 15%), 8% on the top-50 scorers (league 15%); most threat from LaMelo Ball (4%), Stephen Curry (2%), Isaiah Collier (3%) |
| Dylan Harper | Guard | 245 | 121 | 83 / 11 | 18% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from Shai Gilgeous-Alexander (1%), Cade Cunningham (0%), Cam Spencer (1%) |
| Javon Small | Guard | 333 | 210 | 87 / 1 | 18% of his matchups on the top-50 creators (league 15%), 6% on the top-50 scorers (league 15%); most threat from Jrue Holiday (1%), LaMelo Ball (1%), Payton Pritchard (1%) |
| Devin Carter | Guard | 280 | 161 | 88 / 18 | 21% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from Stephen Curry (2%), Darius Garland (2%), Ty Jerome (1%) |
| Nolan Traore | Guard | 269 | 152 | 74 / 19 | 18% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from James Harden (1%), LaMelo Ball (1%), Luka Doncic (0%) |
| Brandon Williams | Guard | 269 | 155 | 79 / 7 | 18% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from LaMelo Ball (1%), James Harden (1%), Anthony Edwards (1%) |

**2025-26: the 15 who fall most against mtch** (rank of 349)

| defender | pos | mtch rank | mtchc rank | Creation / Scoring pct | why |
|---|---|---|---|---|---|
| Kevin Durant | Wing | 147 | 302 | 18 / 36 | 10% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from DeMar DeRozan (1%), Kawhi Leonard (1%), LeBron James (1%) |
| Mark Williams | Big | 158 | 296 | 1 / 85 | 8% of his matchups on the top-50 creators (league 15%), 23% on the top-50 scorers (league 15%); most threat from Luka Doncic (1%), Victor Wembanyama (1%), Joel Embiid (1%) |
| Jalen Johnson | Wing | 158 | 291 | 16 / 35 | 7% of his matchups on the top-50 creators (league 15%), 9% on the top-50 scorers (league 15%); most threat from Paolo Banchero (3%), Scottie Barnes (2%), Cade Cunningham (0%) |
| DeMar DeRozan | Wing | 199 | 328 | 8 / 27 | 9% of his matchups on the top-50 creators (league 15%), 12% on the top-50 scorers (league 15%); most threat from Kevin Durant (1%), Luka Doncic (0%), Devin Booker (1%) |
| Jaren Jackson Jr. | Big | 147 | 267 | 15 / 58 | 7% of his matchups on the top-50 creators (league 15%), 17% on the top-50 scorers (league 15%); most threat from Paolo Banchero (2%), Zion Williamson (3%), Kawhi Leonard (1%) |
| Ivica Zubac | Big | 147 | 262 | 16 / 94 | 12% of his matchups on the top-50 creators (league 15%), 24% on the top-50 scorers (league 15%); most threat from Nikola Jokic (2%), Luka Doncic (1%), Shai Gilgeous-Alexander (1%) |
| LeBron James | Wing | 171 | 283 | 22 / 36 | 10% of his matchups on the top-50 creators (league 15%), 13% on the top-50 scorers (league 15%); most threat from James Harden (1%), Kawhi Leonard (1%), Kevin Durant (1%) |
| Myles Turner | Big | 199 | 303 | 12 / 63 | 9% of his matchups on the top-50 creators (league 15%), 16% on the top-50 scorers (league 15%); most threat from Joel Embiid (1%), Victor Wembanyama (1%), Jalen Johnson (1%) |
| Nic Claxton | Big | 101 | 203 | 9 / 93 | 10% of his matchups on the top-50 creators (league 15%), 22% on the top-50 scorers (league 15%); most threat from Victor Wembanyama (1%), Jaylen Brown (1%), Karl-Anthony Towns (3%) |
| Alex Sarr | Big | 84 | 186 | 12 / 96 | 10% of his matchups on the top-50 creators (league 15%), 22% on the top-50 scorers (league 15%); most threat from Joel Embiid (2%), Giannis Antetokounmpo (1%), Cade Cunningham (1%) |
| Zion Williamson | Wing | 130 | 232 | 23 / 45 | 12% of his matchups on the top-50 creators (league 15%), 13% on the top-50 scorers (league 15%); most threat from Kawhi Leonard (1%), LeBron James (1%), Paolo Banchero (1%) |
| Santi Aldama | Big | 171 | 272 | 12 / 50 | 9% of his matchups on the top-50 creators (league 15%), 17% on the top-50 scorers (league 15%); most threat from Luka Doncic (1%), Kawhi Leonard (1%), Alperen Sengun (2%) |
| Jakob Poeltl | Big | 186 | 287 | 2 / 91 | 8% of his matchups on the top-50 creators (league 15%), 21% on the top-50 scorers (league 15%); most threat from Victor Wembanyama (1%), Nikola Jokic (1%), Karl-Anthony Towns (3%) |
| Chet Holmgren | Big | 221 | 319 | 6 / 51 | 10% of his matchups on the top-50 creators (league 15%), 14% on the top-50 scorers (league 15%); most threat from Alperen Sengun (2%), Nikola Jokic (0%), Pascal Siakam (1%) |
| Deni Avdija | Wing | 232 | 330 | 9 / 25 | 8% of his matchups on the top-50 creators (league 15%), 11% on the top-50 scorers (league 15%); most threat from Kawhi Leonard (1%), Shai Gilgeous-Alexander (0%), Jimmy Butler III (1%) |

## 2. Year-to-year stability

Consecutive seasons, both qualified and over 560. Same team = the same team label both seasons.

| stat | all (n) | same team (n) | changed team (n) |
|---|---|---|---|
| mtchc | 0.74 (2040) | 0.77 (1363) | 0.67 (677) |
| mtch | 0.70 (2040) | 0.73 (1363) | 0.65 (677) |
| Scoring part | 0.78 (2040) | 0.80 (1363) | 0.73 (677) |
| Creation part | 0.87 (2040) | 0.89 (1363) | 0.82 (677) |
| Overall part | 0.71 (2040) | 0.73 (1363) | 0.67 (677) |
| mtchc, equal weights | 0.70 (2040) | 0.74 (1363) | 0.64 (677) |
## 3. Top 25 defenders each season, with mtch rank

Qualified, over 560 matchup possessions. Value = average threat of the men he guarded; pct = league / position percentile.


**2017-18** (319 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Elfrid Payton | PHX | Guard | +0.49 | 99 / 99 | 74 / 98 | 13 |
| 2 | Darren Collison | IND | Guard | +0.47 | 99 / 99 | 43 / 99 | 59 |
| 3 | Kris Dunn | CHI | Guard | +0.45 | 99 / 98 | 42 / 99 | 59 |
| 4 | Jeff Teague | MIN | Guard | +0.43 | 99 / 97 | 64 / 96 | 39 |
| 5 | Avery Bradley | LAC | Guard | +0.42 | 99 / 97 | 98 / 84 | 1 |
| 6 | Ricky Rubio | UTA | Guard | +0.42 | 98 / 96 | 30 / 99 | 111 |
| 7 | Michael Kidd-Gilchrist | CHA | Wing | +0.42 | 98 / 99 | 98 / 83 | 2 |
| 8 | Jarrett Jack | NYK | Guard | +0.42 | 98 / 95 | 46 / 96 | 59 |
| 9 | Mike James | PHX | Guard | +0.41 | 97 / 95 | 14 / 99 | 166 |
| 10 | Spencer Dinwiddie | BKN | Guard | +0.41 | 97 / 94 | 66 / 93 | 46 |
| 11 | Dennis Schröder | ATL | Guard | +0.40 | 97 / 93 | 43 / 95 | 82 |
| 12 | Eric Bledsoe | MIL | Guard | +0.40 | 96 / 92 | 38 / 95 | 68 |
| 13 | Ish Smith | DET | Guard | +0.40 | 96 / 92 | 30 / 97 | 135 |
| 14 | Kemba Walker | CHA | Guard | +0.39 | 96 / 91 | 26 / 98 | 111 |
| 15 | Isaiah Canaan | PHI | Guard | +0.39 | 95 / 90 | 22 / 99 | 203 |
| 16 | Derrick Rose | MIN | Guard | +0.39 | 95 / 90 | 61 / 90 | 102 |
| 17 | De'Aaron Fox | SAC | Guard | +0.38 | 95 / 89 | 22 / 97 | 111 |
| 18 | John Wall | WAS | Guard | +0.37 | 95 / 88 | 62 / 90 | 25 |
| 19 | Dennis Smith Jr. | DAL | Guard | +0.37 | 94 / 87 | 46 / 89 | 39 |
| 20 | Andrew Harrison | MEM | Guard | +0.37 | 94 / 87 | 48 / 92 | 54 |
| 21 | Jerryd Bayless | PHI | Guard | +0.37 | 94 / 86 | 66 / 84 | 49 |
| 22 | Tyler Ulis | PHX | Guard | +0.36 | 93 / 85 | 26 / 96 | 166 |
| 23 | T.J. McConnell | PHI | Guard | +0.36 | 93 / 85 | 34 / 95 | 186 |
| 24 | Cameron Payne | CHI | Guard | +0.35 | 93 / 84 | 11 / 98 | 248 |
| 25 | Sindarius Thornwell | LAC | Wing | +0.35 | 92 / 99 | 83 / 81 | 25 |

**2018-19** (323 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Ricky Rubio | UTA | Guard | +0.56 | 99 / 99 | 71 / 99 | 8 |
| 2 | Eric Bledsoe | MIL | Guard | +0.53 | 99 / 99 | 73 / 99 | 8 |
| 3 | Derrick White | SAS | Guard | +0.52 | 99 / 98 | 78 / 98 | 5 |
| 4 | Avery Bradley | MEM | Guard | +0.48 | 99 / 97 | 87 / 92 | 1 |
| 5 | Torrey Craig | DEN | Wing | +0.47 | 99 / 99 | 88 / 92 | 2 |
| 6 | Darren Collison | IND | Guard | +0.46 | 98 / 97 | 44 / 99 | 46 |
| 7 | Bruce Brown | DET | Guard | +0.46 | 98 / 96 | 74 / 96 | 6 |
| 8 | Jeff Teague | MIN | Guard | +0.45 | 98 / 95 | 54 / 98 | 37 |
| 9 | De'Aaron Fox | SAC | Guard | +0.44 | 97 / 94 | 47 / 99 | 49 |
| 10 | Lonzo Ball | LAL | Guard | +0.44 | 97 / 94 | 52 / 98 | 30 |
| 11 | Kris Dunn | CHI | Guard | +0.43 | 97 / 93 | 65 / 97 | 21 |
| 12 | Jrue Holiday | NOP | Guard | +0.42 | 96 / 92 | 83 / 88 | 3 |
| 13 | Isaiah Canaan | PHI | Guard | +0.39 | 96 / 92 | 38 / 99 | 125 |
| 14 | Dante Exum | UTA | Guard | +0.37 | 96 / 91 | 25 / 97 | 218 |
| 15 | Jalen Brunson | DAL | Guard | +0.37 | 96 / 90 | 39 / 96 | 137 |
| 16 | Emmanuel Mudiay | NYK | Guard | +0.36 | 95 / 89 | 46 / 94 | 79 |
| 17 | George Hill | MIL | Guard | +0.36 | 95 / 89 | 60 / 91 | 66 |
| 18 | Frank Ntilikina | NYK | Guard | +0.35 | 95 / 88 | 58 / 95 | 58 |
| 19 | Garrett Temple | LAC | Guard | +0.34 | 94 / 87 | 81 / 82 | 6 |
| 20 | Elfrid Payton | NOP | Guard | +0.34 | 94 / 86 | 43 / 93 | 88 |
| 21 | Dennis Smith Jr. | NYK | Guard | +0.33 | 94 / 86 | 18 / 96 | 114 |
| 22 | Elie Okobo | PHX | Guard | +0.33 | 93 / 85 | 30 / 97 | 208 |
| 23 | Damian Lillard | POR | Guard | +0.33 | 93 / 84 | 19 / 95 | 144 |
| 24 | Jerryd Bayless | MIN | Guard | +0.32 | 93 / 83 | 39 / 94 | 179 |
| 25 | Rodney McGruder | LAC | Guard | +0.32 | 92 / 83 | 64 / 85 | 30 |

**2019-20** (320 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Torrey Craig | DEN | Wing | +0.53 | 99 / 99 | 99 / 97 | 1 |
| 2 | Avery Bradley | LAL | Guard | +0.52 | 99 / 99 | 77 / 99 | 12 |
| 3 | Cory Joseph | SAC | Guard | +0.51 | 99 / 99 | 89 / 99 | 20 |
| 4 | Luguentz Dort | OKC | Wing | +0.48 | 99 / 99 | 96 / 96 | 3 |
| 5 | Dejounte Murray | SAS | Guard | +0.47 | 99 / 98 | 80 / 99 | 26 |
| 6 | Dorian Finney-Smith | DAL | Wing | +0.45 | 98 / 98 | 99 / 88 | 2 |
| 7 | Elfrid Payton | NYK | Guard | +0.43 | 98 / 97 | 70 / 99 | 20 |
| 8 | Malcolm Brogdon | IND | Guard | +0.42 | 98 / 97 | 62 / 98 | 28 |
| 9 | Jrue Holiday | NOP | Guard | +0.42 | 97 / 96 | 92 / 94 | 6 |
| 10 | Terrance Ferguson | OKC | Wing | +0.42 | 97 / 97 | 96 / 90 | 5 |
| 11 | Kris Dunn | CHI | Guard | +0.40 | 97 / 95 | 81 / 95 | 14 |
| 12 | Frank Ntilikina | NYK | Guard | +0.40 | 96 / 94 | 57 / 98 | 40 |
| 13 | Derrick White | SAS | Guard | +0.40 | 96 / 93 | 83 / 93 | 17 |
| 14 | Eric Bledsoe | MIL | Guard | +0.39 | 96 / 93 | 49 / 99 | 56 |
| 15 | Royce O'Neale | UTA | Wing | +0.39 | 95 / 96 | 96 / 85 | 3 |
| 16 | Dennis Smith Jr. | NYK | Guard | +0.38 | 95 / 92 | 33 / 98 | 166 |
| 17 | Josh Okogie | MIN | Guard | +0.37 | 95 / 91 | 90 / 86 | 14 |
| 18 | De'Aaron Fox | SAC | Guard | +0.37 | 95 / 90 | 53 / 97 | 77 |
| 19 | Josh Richardson | PHI | Guard | +0.36 | 94 / 90 | 76 / 93 | 17 |
| 20 | Ben Simmons | PHI | Guard | +0.35 | 94 / 89 | 87 / 85 | 6 |
| 21 | Fred VanVleet | TOR | Guard | +0.33 | 94 / 88 | 61 / 92 | 45 |
| 22 | Matisse Thybulle | PHI | Guard | +0.33 | 93 / 87 | 70 / 86 | 28 |
| 23 | Markelle Fultz | ORL | Guard | +0.33 | 93 / 86 | 46 / 96 | 71 |
| 24 | George Hill | MIL | Guard | +0.32 | 93 / 86 | 58 / 94 | 61 |
| 25 | Dillon Brooks | MEM | Guard | +0.32 | 92 / 85 | 84 / 80 | 10 |

**2020-21** (345 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Elfrid Payton | NYK | Guard | +0.53 | 99 / 99 | 80 / 99 | 12 |
| 2 | Luguentz Dort | OKC | Guard | +0.51 | 99 / 99 | 99 / 97 | 1 |
| 3 | Michael Carter-Williams | ORL | Guard | +0.50 | 99 / 98 | 91 / 99 | 13 |
| 4 | Dillon Brooks | MEM | Wing | +0.47 | 99 / 99 | 97 / 96 | 4 |
| 5 | Jrue Holiday | MIL | Guard | +0.46 | 99 / 98 | 93 / 98 | 8 |
| 6 | Dennis Schröder | LAL | Guard | +0.45 | 98 / 97 | 67 / 99 | 32 |
| 7 | Royce O'Neale | UTA | Wing | +0.45 | 98 / 99 | 98 / 95 | 2 |
| 8 | Patrick Beverley | LAC | Guard | +0.44 | 98 / 96 | 97 / 96 | 5 |
| 9 | Josh Okogie | MIN | Guard | +0.42 | 98 / 95 | 98 / 94 | 6 |
| 10 | Eric Bledsoe | NOP | Guard | +0.40 | 97 / 95 | 60 / 99 | 36 |
| 11 | Lonzo Ball | NOP | Guard | +0.40 | 97 / 94 | 90 / 92 | 8 |
| 12 | Isaac Okoro | CLE | Wing | +0.40 | 97 / 98 | 87 / 93 | 10 |
| 13 | Derrick Jones Jr. | POR | Wing | +0.39 | 96 / 97 | 96 / 90 | 7 |
| 14 | Cam Reddish | ATL | Wing | +0.39 | 96 / 96 | 99 / 85 | 3 |
| 15 | Kelly Oubre Jr. | GSW | Wing | +0.37 | 96 / 95 | 84 / 88 | 22 |
| 16 | Dorian Finney-Smith | DAL | Wing | +0.37 | 96 / 95 | 85 / 89 | 15 |
| 17 | Trevor Ariza | MIA | Wing | +0.37 | 95 / 94 | 86 / 88 | 22 |
| 18 | Dennis Smith Jr. | DET | Guard | +0.37 | 95 / 93 | 15 / 99 | 128 |
| 19 | Gary Harris | ORL | Guard | +0.36 | 95 / 93 | 83 / 91 | 13 |
| 20 | Cory Joseph | DET | Guard | +0.36 | 94 / 92 | 75 / 93 | 47 |
| 21 | Alex Caruso | LAL | Guard | +0.36 | 94 / 91 | 66 / 95 | 77 |
| 22 | Malcolm Brogdon | IND | Guard | +0.36 | 94 / 90 | 76 / 91 | 24 |
| 23 | De'Aaron Fox | SAC | Guard | +0.35 | 93 / 90 | 53 / 95 | 53 |
| 24 | Mikal Bridges | PHX | Wing | +0.35 | 93 / 93 | 89 / 87 | 11 |
| 25 | Fred VanVleet | TOR | Guard | +0.35 | 93 / 89 | 82 / 90 | 27 |

**2021-22** (342 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Luguentz Dort | OKC | Guard | +0.52 | 99 / 99 | 90 / 99 | 1 |
| 2 | Matisse Thybulle | PHI | Guard | +0.45 | 99 / 99 | 87 / 95 | 2 |
| 3 | Avery Bradley | LAL | Guard | +0.44 | 99 / 98 | 75 / 99 | 7 |
| 4 | Isaac Okoro | CLE | Guard | +0.44 | 99 / 98 | 79 / 98 | 7 |
| 5 | Keifer Sykes | IND | Guard | +0.42 | 99 / 97 | 39 / 99 | 144 |
| 6 | Gary Payton II | GSW | Guard | +0.42 | 98 / 96 | 69 / 99 | 37 |
| 7 | Dillon Brooks | MEM | Wing | +0.41 | 98 / 99 | 80 / 93 | 4 |
| 8 | Jrue Holiday | MIL | Guard | +0.41 | 98 / 96 | 77 / 98 | 13 |
| 9 | Herbert Jones | NOP | Wing | +0.39 | 98 / 99 | 81 / 92 | 9 |
| 10 | Lonzo Ball | CHI | Guard | +0.39 | 97 / 95 | 62 / 98 | 18 |
| 11 | T.J. McConnell | IND | Guard | +0.39 | 97 / 94 | 37 / 99 | 65 |
| 12 | Ayo Dosunmu | CHI | Guard | +0.39 | 97 / 93 | 56 / 98 | 29 |
| 13 | Dorian Finney-Smith | DAL | Wing | +0.39 | 96 / 98 | 90 / 88 | 3 |
| 14 | Patrick Beverley | MIN | Guard | +0.37 | 96 / 93 | 66 / 93 | 24 |
| 15 | Aaron Wiggins | OKC | Guard | +0.36 | 96 / 92 | 58 / 93 | 53 |
| 16 | Wesley Matthews | MIL | Guard | +0.35 | 95 / 91 | 93 / 83 | 6 |
| 17 | De'Andre Hunter | ATL | Wing | +0.35 | 95 / 97 | 86 / 82 | 4 |
| 18 | Kevin Porter Jr. | HOU | Guard | +0.35 | 95 / 91 | 64 / 92 | 29 |
| 19 | Mikal Bridges | PHX | Wing | +0.34 | 95 / 96 | 71 / 91 | 17 |
| 20 | Aaron Gordon | DEN | Wing | +0.34 | 94 / 95 | 84 / 83 | 9 |
| 21 | Andrew Wiggins | GSW | Wing | +0.34 | 94 / 94 | 76 / 89 | 23 |
| 22 | Fred VanVleet | TOR | Guard | +0.34 | 94 / 90 | 58 / 94 | 37 |
| 23 | Cory Joseph | DET | Guard | +0.33 | 93 / 89 | 43 / 97 | 72 |
| 24 | Alex Caruso | CHI | Guard | +0.33 | 93 / 89 | 57 / 92 | 26 |
| 25 | George Hill | MIL | Guard | +0.32 | 93 / 88 | 33 / 97 | 98 |

**2022-23** (322 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Quentin Grimes | NYK | Guard | +0.52 | 99 / 99 | 93 / 96 | 3 |
| 2 | Jrue Holiday | MIL | Guard | +0.49 | 99 / 99 | 92 / 98 | 10 |
| 3 | Luguentz Dort | OKC | Wing | +0.49 | 99 / 99 | 91 / 97 | 4 |
| 4 | De'Anthony Melton | PHI | Guard | +0.48 | 99 / 98 | 86 / 98 | 7 |
| 5 | Andrew Nembhard | IND | Guard | +0.48 | 99 / 97 | 86 / 96 | 12 |
| 6 | Dennis Schroder | LAL | Guard | +0.47 | 98 / 97 | 69 / 99 | 19 |
| 7 | Alex Caruso | CHI | Guard | +0.47 | 98 / 96 | 90 / 95 | 7 |
| 8 | Herbert Jones | NOP | Wing | +0.47 | 98 / 99 | 97 / 91 | 1 |
| 9 | Jaden McDaniels | MIN | Wing | +0.46 | 97 / 98 | 93 / 92 | 5 |
| 10 | Patrick Beverley | CHI | Guard | +0.46 | 97 / 95 | 89 / 95 | 14 |
| 11 | Jevon Carter | MIL | Guard | +0.45 | 97 / 94 | 57 / 99 | 33 |
| 12 | Markelle Fultz | ORL | Guard | +0.44 | 96 / 94 | 58 / 99 | 35 |
| 13 | Dillon Brooks | MEM | Wing | +0.43 | 96 / 97 | 95 / 93 | 2 |
| 14 | Ayo Dosunmu | CHI | Guard | +0.42 | 96 / 93 | 63 / 98 | 39 |
| 15 | Davion Mitchell | SAC | Guard | +0.40 | 95 / 92 | 53 / 99 | 54 |
| 16 | Mikal Bridges | BKN | Wing | +0.39 | 95 / 96 | 81 / 92 | 12 |
| 17 | OG Anunoby | TOR | Wing | +0.39 | 95 / 95 | 99 / 83 | 11 |
| 18 | Dorian Finney-Smith | BKN | Wing | +0.39 | 95 / 94 | 99 / 80 | 7 |
| 19 | Terry Rozier | CHA | Guard | +0.38 | 94 / 92 | 51 / 97 | 58 |
| 20 | Matisse Thybulle | POR | Guard | +0.38 | 94 / 91 | 79 / 91 | 18 |
| 21 | Tre Jones | SAS | Guard | +0.38 | 94 / 90 | 47 / 99 | 76 |
| 22 | Marcus Smart | BOS | Guard | +0.37 | 93 / 89 | 78 / 88 | 22 |
| 23 | Dennis Smith Jr. | CHA | Guard | +0.37 | 93 / 89 | 50 / 97 | 85 |
| 24 | Delon Wright | WAS | Guard | +0.37 | 93 / 88 | 43 / 96 | 76 |
| 25 | Caleb Martin | MIA | Wing | +0.37 | 92 / 93 | 71 / 92 | 29 |

**2023-24** (315 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Luguentz Dort | OKC | Wing | +0.59 | 99 / 99 | 98 / 99 | 2 |
| 2 | Marcus Smart | MEM | Guard | +0.56 | 99 / 99 | 99 / 98 | 3 |
| 3 | Cam Reddish | LAL | Guard | +0.53 | 99 / 99 | 93 / 99 | 5 |
| 4 | Alex Caruso | CHI | Guard | +0.52 | 99 / 98 | 95 / 98 | 5 |
| 5 | Andrew Nembhard | IND | Guard | +0.49 | 99 / 97 | 76 / 99 | 12 |
| 6 | Jeremy Sochan | SAS | Wing | +0.49 | 98 / 99 | 99 / 91 | 1 |
| 7 | Jaden McDaniels | MIN | Wing | +0.48 | 98 / 98 | 97 / 98 | 5 |
| 8 | Isaac Okoro | CLE | Wing | +0.47 | 98 / 97 | 76 / 99 | 12 |
| 9 | Vince Williams Jr. | MEM | Guard | +0.46 | 97 / 97 | 90 / 93 | 11 |
| 10 | Tre Jones | SAS | Guard | +0.45 | 97 / 96 | 41 / 99 | 68 |
| 11 | Dillon Brooks | HOU | Wing | +0.45 | 97 / 96 | 98 / 92 | 8 |
| 12 | Cody Martin | CHA | Guard | +0.44 | 96 / 95 | 83 / 94 | 15 |
| 13 | Derrick Jones Jr. | DAL | Wing | +0.42 | 96 / 95 | 92 / 89 | 9 |
| 14 | Jarred Vanderbilt | LAL | Wing | +0.42 | 96 / 94 | 96 / 87 | 10 |
| 15 | Josh Okogie | PHX | Wing | +0.41 | 95 / 93 | 77 / 97 | 26 |
| 16 | Malik Beasley | MIL | Guard | +0.41 | 95 / 94 | 78 / 94 | 15 |
| 17 | OG Anunoby | NYK | Wing | +0.40 | 95 / 92 | 87 / 85 | 4 |
| 18 | Jalen Suggs | ORL | Guard | +0.40 | 94 / 94 | 71 / 97 | 14 |
| 19 | Keon Ellis | SAC | Guard | +0.39 | 94 / 93 | 86 / 92 | 36 |
| 20 | Jrue Holiday | BOS | Guard | +0.39 | 94 / 92 | 82 / 88 | 24 |
| 21 | Kris Dunn | UTA | Guard | +0.37 | 93 / 91 | 75 / 91 | 26 |
| 22 | Gary Payton II | GSW | Guard | +0.36 | 93 / 91 | 69 / 96 | 44 |
| 23 | Andrew Wiggins | GSW | Wing | +0.36 | 93 / 91 | 81 / 86 | 19 |
| 24 | Terance Mann | LAC | Guard | +0.36 | 93 / 90 | 70 / 93 | 33 |
| 25 | Terry Rozier | MIA | Guard | +0.35 | 92 / 89 | 48 / 97 | 57 |

**2024-25** (337 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Davion Mitchell | MIA | Guard | +0.51 | 99 / 99 | 87 / 99 | 18 |
| 2 | Andrew Nembhard | IND | Guard | +0.49 | 99 / 99 | 98 / 99 | 1 |
| 3 | Toumani Camara | POR | Wing | +0.46 | 99 / 99 | 98 / 99 | 7 |
| 4 | Jaylen Wells | MEM | Wing | +0.46 | 99 / 99 | 95 / 99 | 3 |
| 5 | Dyson Daniels | ATL | Guard | +0.45 | 99 / 98 | 99 / 99 | 2 |
| 6 | Bilal Coulibaly | WAS | Wing | +0.44 | 98 / 98 | 94 / 98 | 5 |
| 7 | Josh Green | CHA | Guard | +0.41 | 98 / 98 | 96 / 97 | 5 |
| 8 | Luguentz Dort | OKC | Wing | +0.41 | 98 / 97 | 95 / 95 | 4 |
| 9 | Ryan Dunn | PHX | Wing | +0.40 | 97 / 96 | 91 / 96 | 8 |
| 10 | Keon Ellis | SAC | Guard | +0.38 | 97 / 97 | 81 / 98 | 31 |
| 11 | Kris Dunn | LAC | Guard | +0.37 | 97 / 96 | 86 / 95 | 12 |
| 12 | Stephon Castle | SAS | Guard | +0.37 | 97 / 95 | 84 / 96 | 23 |
| 13 | Jaden McDaniels | MIN | Wing | +0.36 | 96 / 95 | 89 / 93 | 11 |
| 14 | Vince Williams Jr. | MEM | Guard | +0.35 | 96 / 95 | 97 / 89 | 27 |
| 15 | Ausar Thompson | DET | Wing | +0.34 | 96 / 94 | 89 / 95 | 18 |
| 16 | Dejounte Murray | NOP | Guard | +0.34 | 95 / 94 | 80 / 97 | 12 |
| 17 | Dorian Finney-Smith | LAL | Wing | +0.34 | 95 / 94 | 98 / 82 | 12 |
| 18 | Mikal Bridges | NYK | Wing | +0.34 | 95 / 93 | 77 / 97 | 23 |
| 19 | Amen Thompson | HOU | Wing | +0.33 | 95 / 92 | 88 / 90 | 27 |
| 20 | Jeremy Sochan | SAS | Big | +0.33 | 94 / 99 | 97 / 84 | 8 |
| 21 | Dillon Brooks | HOU | Wing | +0.32 | 94 / 91 | 97 / 83 | 10 |
| 22 | Haywood Highsmith | MIA | Wing | +0.32 | 94 / 90 | 76 / 92 | 33 |
| 23 | Christian Braun | DEN | Guard | +0.32 | 93 / 93 | 91 / 89 | 12 |
| 24 | Dennis Schroder | DET | Guard | +0.32 | 93 / 92 | 67 / 97 | 67 |
| 25 | Derrick Jones Jr. | LAC | Wing | +0.32 | 93 / 89 | 85 / 90 | 18 |

**2025-26** (349 defenders)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Jaylen Wells | MEM | Wing | +0.46 | 99 / 99 | 99 / 98 | 2 |
| 2 | Stephon Castle | SAS | Guard | +0.46 | 99 / 99 | 98 / 99 | 3 |
| 3 | Dyson Daniels | ATL | Guard | +0.45 | 99 / 99 | 95 / 99 | 6 |
| 4 | Luguentz Dort | OKC | Wing | +0.45 | 99 / 99 | 99 / 92 | 1 |
| 5 | Toumani Camara | POR | Wing | +0.43 | 99 / 98 | 98 / 98 | 9 |
| 6 | Ausar Thompson | DET | Wing | +0.43 | 98 / 97 | 93 / 99 | 11 |
| 7 | Christian Braun | DEN | Guard | +0.43 | 98 / 98 | 99 / 98 | 6 |
| 8 | Davion Mitchell | MIA | Guard | +0.43 | 98 / 98 | 80 / 99 | 22 |
| 9 | Jaden McDaniels | MIN | Wing | +0.42 | 98 / 96 | 99 / 93 | 3 |
| 10 | Herbert Jones | NOP | Guard | +0.40 | 97 / 97 | 97 / 93 | 12 |
| 11 | Derrick Jones Jr. | LAC | Wing | +0.40 | 97 / 95 | 96 / 95 | 8 |
| 12 | Isaac Okoro | CHI | Wing | +0.39 | 97 / 95 | 98 / 91 | 3 |
| 13 | Svi Mykhailiuk | UTA | Guard | +0.39 | 96 / 96 | 97 / 91 | 14 |
| 14 | Andrew Nembhard | IND | Guard | +0.38 | 96 / 96 | 83 / 98 | 20 |
| 15 | Kris Dunn | LAC | Guard | +0.37 | 96 / 95 | 90 / 96 | 14 |
| 16 | Jordan Walsh | BOS | Wing | +0.35 | 96 / 94 | 88 / 92 | 27 |
| 17 | Peyton Watson | DEN | Wing | +0.35 | 95 / 93 | 84 / 92 | 13 |
| 18 | Anthony Black | ORL | Guard | +0.35 | 95 / 94 | 85 / 96 | 27 |
| 19 | Keegan Murray | SAC | Wing | +0.34 | 95 / 92 | 98 / 71 | 9 |
| 20 | Josh Okogie | HOU | Guard | +0.33 | 94 / 94 | 87 / 91 | 22 |
| 21 | Cason Wallace | OKC | Guard | +0.33 | 94 / 93 | 82 / 97 | 38 |
| 22 | Sion James | CHA | Guard | +0.33 | 94 / 92 | 86 / 94 | 39 |
| 23 | Marcus Smart | LAL | Guard | +0.33 | 94 / 92 | 88 / 94 | 27 |
| 24 | Bilal Coulibaly | WAS | Guard | +0.32 | 93 / 91 | 94 / 89 | 18 |
| 25 | Amen Thompson | HOU | Guard | +0.32 | 93 / 90 | 83 / 94 | 27 |

**2026-27** (160 defenders; to date)

| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |
|---|---|---|---|---|---|---|---|
| 1 | Toumani Camara | POR | Wing | +0.49 | 99 / 99 | 99 / 97 | 1 |
| 2 | Jaylen Wells | MEM | Wing | +0.42 | 99 / 98 | 91 / 99 | 3 |
| 3 | Christian Braun | DEN | Guard | +0.36 | 99 / 99 | 94 / 96 | 8 |
| 4 | Derrick Jones Jr. | LAC | Wing | +0.36 | 98 / 96 | 98 / 91 | 2 |
| 5 | Dyson Daniels | ATL | Wing | +0.36 | 98 / 95 | 86 / 98 | 22 |
| 6 | Ja'Kobe Walter | TOR | Guard | +0.34 | 97 / 98 | 94 / 96 | 5 |
| 7 | Matisse Thybulle | LAL | Guard | +0.33 | 96 / 96 | 95 / 96 | 11 |
| 8 | Mikal Bridges | NYK | Wing | +0.32 | 96 / 94 | 79 / 97 | 16 |
| 9 | Peyton Watson | CLE | Wing | +0.31 | 95 / 93 | 84 / 91 | 4 |
| 10 | Sion James | CHA | Guard | +0.30 | 95 / 95 | 90 / 92 | 20 |
| 11 | Isaac Okoro | CHI | Wing | +0.29 | 94 / 91 | 76 / 95 | 14 |
| 12 | Aaron Nesmith | IND | Guard | +0.29 | 93 / 93 | 83 / 83 | 25 |
| 13 | Ausar Thompson | DET | Wing | +0.29 | 93 / 90 | 68 / 89 | 6 |
| 14 | Jrue Holiday | POR | Guard | +0.28 | 92 / 92 | 96 / 82 | 16 |
| 15 | Daniss Jenkins | DET | Guard | +0.28 | 92 / 91 | 34 / 98 | 74 |
| 16 | Ryan Rollins | MIL | Guard | +0.27 | 91 / 89 | 77 / 95 | 48 |
| 17 | Jaden McDaniels | MIN | Wing | +0.27 | 91 / 89 | 85 / 91 | 25 |
| 18 | Andrew Nembhard | IND | Guard | +0.26 | 90 / 88 | 70 / 88 | 46 |
| 19 | Amen Thompson | HOU | Guard | +0.25 | 89 / 87 | 80 / 89 | 16 |
| 20 | Davion Mitchell | MIA | Guard | +0.25 | 89 / 86 | 80 / 97 | 35 |
| 21 | Stephon Castle | SAS | Wing | +0.24 | 88 / 85 | 73 / 94 | 22 |
| 22 | Kyle Kuzma | MIL | Wing | +0.24 | 88 / 84 | 87 / 68 | 6 |
| 23 | Anthony Black | ORL | Guard | +0.24 | 88 / 85 | 67 / 90 | 27 |
| 24 | P.J. Washington | DAL | Wing | +0.24 | 87 / 83 | 95 / 62 | 11 |
| 25 | Jamal Shead | TOR | Guard | +0.23 | 87 / 84 | 70 / 86 | 60 |

### Watch list: mtchc rank / mtch rank (of the season's qualified defenders), every season he qualifies

| defender | 2017-18 | 2018-19 | 2019-20 | 2020-21 | 2021-22 | 2022-23 | 2023-24 | 2024-25 | 2025-26 | 2026-27 |
|---|---|---|---|---|---|---|---|---|---|---|
| Luguentz Dort |  |  | 4 / 3 | 2 / 1 | 1 / 1 | 3 / 4 | 1 / 2 | 8 / 4 | 4 / 1 | 50 / 48 |
| Jaden McDaniels |  |  |  | 94 / 81 | 70 / 72 | 9 / 5 | 7 / 5 | 13 / 11 | 9 / 3 | 17 / 25 |
| Herbert Jones |  |  |  |  | 9 / 9 | 8 / 1 | 27 / 19 | 50 / 38 | 10 / 12 | 30 / 34 |
| Alex Caruso | 105 / 286 | 49 / 88 | 28 / 61 | 21 / 77 | 24 / 26 | 7 / 7 | 4 / 5 | 48 / 54 | 29 / 34 |  |
| Jrue Holiday | 31 / 7 | 12 / 3 | 9 / 6 | 5 / 8 | 8 / 13 | 2 / 10 | 20 / 24 | 27 / 23 | 84 / 77 | 14 / 16 |
| Dillon Brooks | 85 / 13 |  | 25 / 10 | 4 / 4 | 7 / 4 | 13 / 2 | 11 / 8 | 21 / 10 | 33 / 14 | 40 / 30 |
| Marcus Smart | 89 / 68 | 31 / 11 | 33 / 20 | 32 / 24 | 28 / 34 | 22 / 22 | 2 / 3 | 65 / 54 | 23 / 27 |  |
| Mikal Bridges |  | 81 / 79 | 53 / 40 | 24 / 11 | 19 / 17 | 16 / 12 | 36 / 32 | 18 / 23 | 30 / 22 | 8 / 16 |
| OG Anunoby | 49 / 5 | 200 / 188 | 55 / 28 | 45 / 34 | 85 / 43 | 17 / 11 | 17 / 4 | 56 / 23 | 26 / 14 | 32 / 14 |
| Derrick White |  | 3 / 5 | 13 / 17 | 37 / 31 | 63 / 65 | 55 / 66 | 54 / 57 | 78 / 61 | 125 / 97 | 64 / 91 |
| Matisse Thybulle |  |  | 22 / 28 | 65 / 47 | 2 / 2 | 20 / 18 | 55 / 78 |  | 177 / 218 | 7 / 11 |
| Amen Thompson |  |  |  |  |  |  | 104 / 185 | 19 / 27 | 25 / 27 | 19 / 16 |
| Jaylen Wells |  |  |  |  |  |  |  | 4 / 3 | 1 / 2 | 2 / 3 |
| Toumani Camara |  |  |  |  |  |  | 31 / 41 | 3 / 7 | 5 / 9 | 1 / 1 |
## 4. Does it track defensive value better than mtch, controlling for team defense?

Minutes-weighted least squares. Model A: target ~ stat + team DRtg (relative to league; team table covers 2018-19 on). Model B: target ~ stat + a fixed effect for every team-season (2017-18 on). Partial r: the stat's correlation with the target once the controls are taken out of both. dR2: R-squared added over the controls alone. Both: mtch and mtchc together.

A high number means coaches give this player hard jobs and he holds up, or that the box score credits whoever draws them. It does not show the stat measures defensive skill.

| target | model | pos | n | partial r: mtch | mtchc | equal-wt | Scoring | Creation | dR2: mtch | mtchc | both |
|---|---|---|---|---|---|---|---|---|---|---|---|
| D-BPM | A team DRtg | all | 2653 | +0.19 | +0.13 | +0.27 | +0.41 | -0.06 | 0.028 | 0.014 | 0.030 |
| D-BPM | A team DRtg | Guard | 1113 | +0.35 | +0.33 | +0.36 | +0.37 | +0.25 | 0.086 | 0.077 | 0.090 |
| D-BPM | A team DRtg | Wing | 918 | +0.22 | +0.25 | +0.27 | +0.29 | +0.19 | 0.034 | 0.045 | 0.047 |
| D-BPM | A team DRtg | Big | 622 | +0.10 | +0.09 | +0.12 | +0.13 | +0.02 | 0.007 | 0.006 | 0.007 |
| D-BPM | B team-season FE | all | 2972 | +0.19 | +0.12 | +0.27 | +0.41 | -0.06 | 0.027 | 0.011 | 0.030 |
| D-BPM | B team-season FE | Guard | 1252 | +0.35 | +0.34 | +0.37 | +0.37 | +0.25 | 0.072 | 0.070 | 0.079 |
| D-BPM | B team-season FE | Wing | 1025 | +0.26 | +0.28 | +0.30 | +0.32 | +0.22 | 0.041 | 0.046 | 0.046 |
| D-BPM | B team-season FE | Big | 695 | +0.05 | +0.06 | +0.11 | +0.15 | -0.05 | 0.001 | 0.001 | 0.001 |
| On/Off DRtg (lower is better) | A team DRtg | all | 2653 | +0.10 | +0.02 | +0.01 | -0.01 | +0.01 | 0.010 | 0.001 | 0.021 |
| On/Off DRtg (lower is better) | A team DRtg | Guard | 1113 | +0.03 | -0.08 | -0.08 | -0.04 | -0.11 | 0.001 | 0.006 | 0.031 |
| On/Off DRtg (lower is better) | A team DRtg | Wing | 918 | +0.13 | +0.07 | +0.07 | +0.07 | +0.04 | 0.017 | 0.005 | 0.043 |
| On/Off DRtg (lower is better) | A team DRtg | Big | 622 | +0.16 | +0.10 | +0.10 | +0.10 | +0.03 | 0.027 | 0.010 | 0.035 |
| On/Off DRtg (lower is better) | B team-season FE | all | 2972 | +0.09 | +0.01 | -0.00 | -0.02 | +0.00 | 0.007 | 0.000 | 0.017 |
| On/Off DRtg (lower is better) | B team-season FE | Guard | 1252 | +0.04 | -0.06 | -0.06 | -0.02 | -0.10 | 0.002 | 0.003 | 0.024 |
| On/Off DRtg (lower is better) | B team-season FE | Wing | 1025 | +0.11 | +0.05 | +0.04 | +0.04 | +0.02 | 0.009 | 0.002 | 0.031 |
| On/Off DRtg (lower is better) | B team-season FE | Big | 695 | +0.17 | +0.11 | +0.09 | +0.06 | +0.07 | 0.021 | 0.009 | 0.032 |
| Leverage: defense | A team DRtg | all | 215 | +0.22 | -0.03 | +0.09 | +0.32 | -0.20 | 0.043 | 0.001 | 0.275 |
| Leverage: defense | A team DRtg | Guard | 90 | +0.37 | +0.17 | +0.18 | +0.22 | +0.08 | 0.125 | 0.026 | 0.284 |
| Leverage: defense | A team DRtg | Wing | 72 | +0.33 | +0.11 | +0.14 | +0.25 | -0.04 | 0.097 | 0.010 | 0.382 |
| Leverage: defense | A team DRtg | Big | 53 | +0.19 | +0.06 | +0.10 | +0.11 | +0.08 | 0.029 | 0.003 | 0.113 |
| Leverage: defense | B team-season FE | all | 215 | +0.22 | -0.02 | +0.10 | +0.33 | -0.20 | 0.039 | 0.000 | 0.249 |
| Leverage: defense | B team-season FE | Guard | 90 | +0.43 | +0.19 | +0.21 | +0.28 | +0.04 | 0.114 | 0.023 | 0.248 |
| Leverage: defense | B team-season FE | Wing | 72 | +0.30 | +0.11 | +0.15 | +0.24 | -0.02 | 0.051 | 0.007 | 0.183 |
| Leverage: defense | B team-season FE | Big | 53 | +0.31 | +0.09 | +0.23 | +0.39 | -0.05 | 0.042 | 0.003 | 0.127 |
| Leverage: on-ball D | A team DRtg | all | 215 | +0.28 | +0.08 | +0.17 | +0.32 | -0.07 | 0.074 | 0.005 | 0.220 |
| Leverage: on-ball D | A team DRtg | Guard | 90 | +0.35 | +0.18 | +0.19 | +0.20 | +0.14 | 0.112 | 0.032 | 0.211 |
| Leverage: on-ball D | A team DRtg | Wing | 72 | +0.45 | +0.26 | +0.29 | +0.37 | +0.13 | 0.193 | 0.064 | 0.389 |
| Leverage: on-ball D | A team DRtg | Big | 53 | +0.19 | +0.06 | +0.10 | +0.12 | +0.08 | 0.030 | 0.003 | 0.117 |
| Leverage: on-ball D | B team-season FE | all | 215 | +0.28 | +0.08 | +0.18 | +0.33 | -0.07 | 0.066 | 0.006 | 0.197 |
| Leverage: on-ball D | B team-season FE | Guard | 90 | +0.40 | +0.20 | +0.22 | +0.26 | +0.10 | 0.092 | 0.023 | 0.174 |
| Leverage: on-ball D | B team-season FE | Wing | 72 | +0.37 | +0.21 | +0.24 | +0.31 | +0.09 | 0.075 | 0.024 | 0.161 |
| Leverage: on-ball D | B team-season FE | Big | 53 | +0.31 | +0.10 | +0.25 | +0.41 | -0.05 | 0.040 | 0.004 | 0.110 |

Team DRtg not found for 0 defender-seasons (team label []); they sit out model A only.
## 5. By position

Qualified, over 560, 2017-18 to 2025-26.

| pos | n | mtchc p25 / median / p75 | Scoring part | Creation part | mtch p25 / median / p75 | mean league pct, mtchc | mtch | change |
|---|---|---|---|---|---|---|---|---|
| Big | 695 | -0.01 / +0.04 / +0.10 | +0.23 / +0.34 / +0.44 | -0.21 / -0.17 / -0.10 | 11.6 / 12.3 / 13.1 | 36 | 44 | -8 |
| Guard | 1252 | +0.05 / +0.14 / +0.26 | -0.06 / +0.03 / +0.14 | +0.08 / +0.24 / +0.42 | 11.5 / 12.4 / 13.5 | 60 | 48 | +12 |
| Wing | 1025 | -0.00 / +0.08 / +0.18 | +0.05 / +0.16 / +0.26 | -0.11 / +0.00 / +0.15 | 11.8 / 12.9 / 14.0 | 48 | 56 | -9 |

2025-26 Bigs, top 5 by position percentile: Dean Wade (99, league 89), Anthony Davis (98, league 80), Noah Clowney (97, league 78), Josh Minott (96, league 74), Draymond Green (94, league 72); bottom 3: Naz Reid (3), Anthony Gill (2), Micah Potter (1)

2025-26 Guards, top 5 by position percentile: Stephon Castle (99, league 99), Dyson Daniels (99, league 99), Christian Braun (98, league 98), Davion Mitchell (98, league 98), Herbert Jones (97, league 97); bottom 3: Cam Spencer (2), Tyson Etienne (1), Jared McCain (1)

2025-26 Wings, top 5 by position percentile: Jaylen Wells (99, league 99), Luguentz Dort (99, league 99), Toumani Camara (98, league 99), Ausar Thompson (97, league 98), Jaden McDaniels (96, league 98); bottom 3: Pete Nance (2), Will Riley (1), Doug McDermott (1)

## 6. Verdict

**Ship it, as context, with nothing in the formula changed on the strength of these tests.**

1. It measures something mtch doesn't. Correlation with mtch is 0.83-0.89 in most seasons (0.60
   in 2017-18), so it isn't a relabel, and the differences are the ones it was built for: backup
   and point-of-attack guards who chase creators rise (Caruso 21st against mtch's 77th in 2020-21;
   20-22% of a riser's matchups on the top-50 creators against 15% league-wide), and bigs and stars
   hidden on 3-and-D wings fall.
2. It is steadier than mtch: 0.74 year to year against 0.70, 0.77 / 0.67 same team / changed team
   against 0.73 / 0.65. Its Creation part is the steadiest number here (0.87).
3. It does not track defensive value better than mtch. Controlling for team defense, its partial
   correlation with D-BPM is 0.12-0.13 pooled against mtch's 0.19; about level within guards
   (0.33-0.34 against 0.35) and wings (0.25-0.28 against 0.22-0.26); nothing within bigs for either.
   Neither tracks On/Off defensive rating. In 2025-26's Leverage (215 defenders, one season) mtch is
   clearly ahead (0.22-0.28 against 0.00-0.08). The piece that lines up with defensive value is the
   Scoring part (0.41 pooled, 0.37 within guards), better than mtch itself; the Creation part does
   not line up with any target. The equal-weight version beats the approved one on every D-BPM row
   (0.27 pooled). That was a decision taken on principle, so it stays a comparison column.
4. Read with the framing agreed for this report: a high number means coaches give him hard jobs
   and the box score credits whoever draws them, not that the stat measures defensive skill. On
   that reading, creators' defenders are not credited by D-BPM or Leverage for the job, which is
   either the gap mtchc fills or a sign creation assignments matter less; these tests cannot say
   which.
5. Positions: guards gain 12 league-percentile points on average against mtch, wings lose 9, bigs
   8. Position percentiles look right (2025-26 bigs led by Wade, Davis, Clowney, Minott, Draymond;
   drop bigs at the bottom), so the card's position pool is the fair read for a big.

One wording change follows from 3: the explainer should say what it is (the threat of his
assignments) and stop short of implying it tracks how good a defender he is. The suggested
definition already does ("Context for the rest of his defense").

Caveats: Leverage is one season and 215 defenders. Why 2017-18 correlates less with mtch (0.60)
is untested. The team-DRtg model starts in 2018-19 (the team table does); the team-season fixed
effects model covers all nine seasons and agrees with it throughout.
