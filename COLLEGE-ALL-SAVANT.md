# College All-Savant Teams

Shipped in College Basketball Savant 1.1.0. Pipeline: `pipeline/college/college_value.py`, `team_fit.py`, `allsavant.py`, `ap_check.py`. Check: `tools/savant-cbb/value.mjs`.

## The method in one paragraph

**Savant value** is the points a player added over a replacement-level player at the same position. Its shape is Basketball Savant's. Its weights are not: Adam rejected the first set before launch, and the weights here are fitted to team results.

**Value = (Rate − Replacement) × Possessions ÷ 100**

1. **The stats.** Scoring efficiency over average, three-point and free-throw rate, assist %, turnovers, both rebound rates, steals and blocks, from opponent-adjusted numbers where the stat has one, all games counted.
2. **Luck.** Each stat is pulled toward the position's average by this site's measured settle point.
3. **Position.** Each is centred on the position's average that season.
4. **Worth.** One regression: each team-season's adjusted net rating on its players' minutes-weighted stats, thirteen seasons, 4,627 team-seasons.
5. **The floor.** From 2024-25, the rate moves toward what happened on the floor, against what the box rate and minutes say on/off should be, by weight ÷ (weight + 3200). Before that it is box score only, as Basketball Savant is before 2009-10.
6. **Replacement.** The 25th-percentile qualified rate at the position that season.

Possessions are the ones played, so missed games cost value. Every D1 game counts, through the national championship. Before the title game a team is a standing ("so far"), not an honour.

### Worked example: Cameron Boozer, Duke, 2025-26

| Part | Points per 100 |
|---|---|
| Scoring | +9.85 |
| Playmaking | +8.23 |
| Rebounding | +2.96 |
| Defense | +0.58 |
| Floor | -0.03 |
| **Rate** | **+21.59** |

Replacement for a big that season: -3.11. Possessions: 2,004.

(21.59 − (-3.11)) × 2,004 ÷ 100 = **495.1**

## The weights

| Stat | First set (on/off fit), per unit | Team results, per unit |
|---|---|---|
| Points over average efficiency per 100 | +0.681 | +1.651 |
| Usage % | -0.045 | +0.000 |
| 3-point attempt rate | +0.036 | +0.024 |
| Free-throw rate | +0.019 | +0.064 |
| Assist % | +0.442 | +0.389 |
| Turnovers per 100 | -0.215 | -2.492 |
| Offensive rebound % | +1.054 | +0.714 |
| Defensive rebound % | +0.124 | +0.192 |
| Steals per 100 | +4.108 | +1.782 |
| Blocks per 100 | +1.085 | +0.583 |

- **Usage is zero, on purpose.** A team's minutes-weighted usage adds up to nearly the same number for every team, so team results can't see it. Fitted anyway it came out at +1.87, an artifact that wrecked next-season prediction. A scorer's volume reaches the rate through scoring efficiency, which is attempts × efficiency. The cost: a star at exactly average efficiency gets no credit for carrying an offense.
- **The floor** uses a regression of on/off on the box rate and minutes share, weight ÷ (weight + K), so one good on/off year can't overrule the box score.
- **Credit is gone.** The per-stat credit tested identical (5.41 vs 5.41), which is structural: a fit to team totals absorbs any per-stat multiplier into the weight.
- **The penalty** was chosen by leaving one season out at a time. It made no difference up to about 100, so there is very little to shrink: 4,627 team-seasons, nine weights.

## Old weights against new

| Measure | Old (on/off fit) | New (team results) |
|---|---|---|
| Fit to team net rating, r | 0.7734 | **0.9032** (held out by season) |
| Fit to team net rating, RMSE | 8.087 | **5.41** |
| Next season's luck-adjusted on/off, returning players, r | **0.129** | 0.048 |
| Same, RMSE | **8.78** | 9.55 |
| Year-to-year stability of the rate, r | **0.744** | 0.669 |
| AP All-Americans on our 1st to 3rd teams | 43 of 196 | **80 of 196** |
| AP 1st-teamers on our 1st team | 11 of 65 | **24 of 65** |

**The new weights lose on next-season on/off**, and their RMSE is worse than guessing zero (8.863). That target is close to noise, the old weights were fitted to it, and it has one pair of seasons, 1,470 players. Team results are the better evidence, but this isn't a clean sweep.

The first test's published numbers (r .105 and .04) had a leak: the penalty was picked on the test target, and box impact used raw stats. Fixed, they were 0.102 and -0.014, and the refit still won that test. The floor's K (3200) is still picked on that one target, and its effect is limited to 2024-25 on.

## The All-America check

A check, never a target: no AP name touches the fit. AP lists are from each year's Wikipedia page. There are 196 names because 2021-22 had a tie on the third team.

| Season | Old | New | AP names | AP 1st on our 1st |
|---|---|---|---|---|
| 2013-14 | 2 | 5 | 15 | 2 |
| 2014-15 | 3 | 6 | 15 | 2 |
| 2015-16 | 3 | 7 | 15 | 1 |
| 2016-17 | 4 | 6 | 15 | 2 |
| 2017-18 | 3 | 8 | 15 | 2 |
| 2018-19 | 5 | 6 | 15 | 4 |
| 2019-20 | 0 | 4 | 15 | 3 |
| 2020-21 | 4 | 7 | 15 | 2 |
| 2021-22 | 3 | 4 | 16 | 1 |
| 2022-23 | 6 | 9 | 15 | 1 |
| 2023-24 | 3 | 8 | 15 | 1 |
| 2024-25 | 3 | 5 | 15 | 1 |
| 2025-26 | 4 | 5 | 15 | 2 |

### What drives the rest

| Variant | AP on our teams | AP 1st on our 1st |
|---|---|---|
| as built | 80 of 196 | 24 |
| no 2-2-1 shape (top 15 by value) | 84 of 196 | 28 |
| raw stats, not adjusted | 55 of 196 | 19 |
| one replacement level for all positions | 80 of 196 | 24 |
| rate, so games don't count | 57 of 196 | 18 |

- **The 2-2-1 shape** costs 4 names.
- **Replacement level** moves it by 0: the three positions' levels are nearly the same.
- **Raw vs adjusted, and games played:** the adjustment and counting possessions both raise the overlap. Taking away the adjustment moves it to 55, and ignoring games played to 57.
- **What's left is team success.** The AP players we miss played for teams ranked a median 7th, and the players we pick that AP doesn't were on teams ranked 48th. Their usage and scoring are close (27.8 and 26.5 usage, 22.4 and 21.9 points per 70). That fits voters rewarding winning, which Savant value doesn't: it rates the player, and the schedule adjustment is its only team context. This is a comparison of medians, not a test of cause.

## 2025-26 next to the AP teams

| Team | Player | School | Position | Value | Rate | Possessions | Schedule rank at position |
|---|---|---|---|---|---|---|---|
| 1st | Bruce Thornton | Ohio State | Guard | 400.5 | +16.8 | 1,990 | 46 of 1176 |
| 1st | Tyler Tanner | Vanderbilt | Guard | 379.7 | +15.9 | 1,970 | 88 of 1176 |
| 1st | Yaxel Lendeborg | Michigan | Wing | 412.3 | +18.1 | 1,970 | 4 of 936 |
| 1st | Zuby Ejiofor | St. John's | Wing | 398.0 | +18.6 | 1,862 | 24 of 936 |
| 1st | Cameron Boozer | Duke | Big | 495.1 | +21.6 | 2,004 | 25 of 629 |
| 2nd | Jeremy Fears Jr. | Michigan State | Guard | 345.1 | +15.5 | 1,831 | 74 of 1176 |
| 2nd | Darius Acuff Jr. | Arkansas | Guard | 332.2 | +12.3 | 2,126 | 84 of 1176 |
| 2nd | AJ Dybantsa | BYU | Wing | 327.2 | +13.1 | 2,059 | 7 of 936 |
| 2nd | Nick Martinelli | Northwestern | Wing | 302.1 | +13.5 | 1,853 | 81 of 936 |
| 2nd | Tarris Reed Jr. | UConn | Big | 286.5 | +16.0 | 1,496 | 4 of 629 |
| 3rd | Ebuka Okorie | Stanford | Guard | 324.0 | +14.7 | 1,799 | 110 of 1176 |
| 3rd | Nick Boyd | Wisconsin | Guard | 323.8 | +14.2 | 1,840 | 39 of 1176 |
| 3rd | Dailyn Swain | Texas | Wing | 278.9 | +11.8 | 1,912 | 113 of 936 |
| 3rd | Juke Harris | Wake Forest | Wing | 264.8 | +10.5 | 1,990 | 115 of 936 |
| 3rd | Izaiyah Nelson | South Florida | Big | 282.5 | +14.5 | 1,602 | 217 of 629 |

| AP team | Player | School | Position | Value | Rate | Possessions | Schedule rank | Our team |
|---|---|---|---|---|---|---|---|---|
| AP 1st | Darius Acuff Jr. | Arkansas | Guard | 332.2 | +12.3 | 2,126 | 84 of 1176 | our 2nd |
| AP 1st | Cameron Boozer | Duke | Big | 495.1 | +21.6 | 2,004 | 25 of 629 | our 1st |
| AP 1st | AJ Dybantsa | BYU | Wing | 327.2 | +13.1 | 2,059 | 7 of 936 | our 2nd |
| AP 1st | Yaxel Lendeborg | Michigan | Wing | 412.3 | +18.1 | 1,970 | 4 of 936 | our 1st |
| AP 1st | JT Toppin | Texas Tech | Big | 206.7 | +11.7 | 1,397 | 36 of 629 | none |
| AP 2nd | Braden Smith | Purdue | Guard | 294.7 | +10.9 | 2,075 | 21 of 1176 | none |
| AP 2nd | Joshua Jefferson | Iowa State | Big | 209.4 | +9.8 | 1,616 | 70 of 629 | none |
| AP 2nd | Keaton Wagler | Illinois | Guard | 317.2 | +13.6 | 1,875 | 25 of 1176 | none |
| AP 2nd | Caleb Wilson | North Carolina | Big | 210.6 | +14.4 | 1,205 | 123 of 629 | none |
| AP 2nd | Jeremy Fears Jr. | Michigan State | Guard | 345.1 | +15.5 | 1,831 | 74 of 1176 | our 2nd |

Schedule rank: 1 is the toughest among qualified players at the position, by possession-weighted opponent defense.

## History gate

A box-tier season needs a box score and a matching final score on at least 98% of D1 games. "Strict" is ESPN as it stands; "recovered" is after the fix below. Games that miss are dropped.

| Season | D1 games | Strict | Recovered | Lines recovered | Ages | Tier |
|---|---|---|---|---|---|---|
| 2013-14 | 5,503 | 99.7% | 99.8% | 6 | 71% | box |
| 2014-15 | 5,495 | 99.6% | 99.6% | 0 | 54% | box |
| 2015-16 | 5,514 | 99.7% | 99.7% | 0 | 39% | box |
| 2016-17 | 5,520 | 99.0% | 99.6% | 31 | 28% | box |
| 2017-18 | 5,533 | 94.1% | 99.4% | 373 | 22% | box |
| 2018-19 | 5,600 | 86.6% | 98.0% | 1,056 | 26% | box |
| 2019-20 | 5,330 | 83.6% | 98.1% | 1,513 | 37% | box |
| 2020-21 | 3,948 | 84.8% | 98.1% | 1,107 | 55% | box |
| 2021-22 | 5,476 | 84.5% | 98.8% | 1,448 | 69% | box |
| 2022-23 | 5,715 | 86.1% | 99.0% | 903 | 99% | full |
| 2023-24 | 5,726 | 94.1% | 99.8% | 354 | 99% | full |
| 2024-25 | 5,764 | 99.8% | 99.8% | 0 | 99% | full |
| 2025-26 | 5,752 | 99.8% | 99.8% | 0 | 98% | full |
| 2026-27 | 8 | 100.0% | 100.0% | 0 | 60% | full |

**Recovery.** ESPN has deleted some athlete records, leaving a blank box row, while its team totals still count the player and the play-by-play still has the name. One unknown shooter: the line is the team total minus everyone listed. Several: each gets the line the play-by-play counts, accepted only if their points sum exactly to what's missing. **Five box seasons, 2017-18 to 2021-22, pass only with this,** and 2022-23 needed it too. Against CBBD's own player stats, r ≥ .989 on all eleven stats in the three seasons tested (2013-14, 2018-19, 2021-22), about 2,900 players each.

**Ages.** T-Rank's files for 2013-14 to 2021-22 had no readable birthdate, and ground rule 4 allows one fetch a week per season, so they were not refetched. Those ages come from CBBD rosters, later seasons and Basketball Savant, hence 22-71%. The next allowed fetch is Nov 9, and `torvik.py` now logs the column's shape.

## Known gaps

- **Tournament teams.** The field comes from the postseason games: 68 teams, except 2016-17 (66, as ESPN's archive lacks the two March 14 First Four games), 2020-21 (67, VCU's game was a no-contest) and 2019-20 (none, no tournament).
- **Value isn't comparable across the 2024-25 line.** Seasons from there on include the floor part.

## National teams by season

### 2013-14

Savant Player of the Year: **Shabazz Napier**, UConn, 438.1

- 1st: Shabazz Napier (UConn, 438), Billy Baron (Canisius, 383), Doug McDermott (Creighton, 402), Jordan Adams (UCLA, 368), Frank Kaminsky (Wisconsin, 275)
- 2nd: Marcus Smart (Oklahoma State, 377), Bryce Cotton (Providence, 374), T.J. Warren (NC State, 363), Kyle Anderson (UCLA, 337), Cameron Bairstow (New Mexico, 274)
- 3rd: Delon Wright (Utah, 374), Kendrick Perry (Youngstown State, 354), KJ McDaniels (Clemson, 286), Melvin Ejim (Iowa State, 271), Jarnell Stokes (Tennessee, 271)

### 2014-15

Savant Player of the Year: **Frank Kaminsky**, Wisconsin, 420.2

- 1st: Delon Wright (Utah, 404), Jerian Grant (Notre Dame, 397), Kyle Collinsworth (BYU, 310), Thomas Walkup (Stephen F. Austin, 281), Frank Kaminsky (Wisconsin, 420)
- 2nd: Kris Dunn (Providence, 359), Corey Walden (Eastern Kentucky, 340), Sir'Dominic Pointer (St. John's, 278), Nigel Hayes-Davis (Wisconsin, 274), Bobby Portis (Arkansas, 327)
- 3rd: D'Angelo Russell (Ohio State, 337), Cameron Payne (Murray State, 335), Sam Dekker (Wisconsin, 265), J.J. Avila (Colorado State, 252), Jahlil Okafor (Duke, 316)

### 2015-16

Savant Player of the Year: **Kay Felder**, Oakland, 514.7

- 1st: Kay Felder (Oakland, 515), Buddy Hield (Oklahoma, 438), Thomas Walkup (Stephen F. Austin, 401), Georges Niang (Iowa State, 298), Ben Simmons (LSU, 409)
- 2nd: Denzel Valentine (Michigan State, 397), Grayson Allen (Duke, 386), DeAndre' Bembry (Saint Joseph's, 289), Josh Hart (Villanova, 289), Brice Johnson (North Carolina, 400)
- 3rd: Andrew Andrews (Washington, 385), Gary Payton II (Oregon State, 370), John Konchar (Purdue Fort Wayne, 286), Gary Clark (Cincinnati, 261), Jameel Warney (Stony Brook, 372)

### 2016-17

Savant Player of the Year: **Frank Mason III**, Kansas, 428.7

- 1st: Frank Mason III (Kansas, 429), Monte Morris (Iowa State, 407), Sindarius Thornwell (South Carolina, 398), Josh Hart (Villanova, 357), Bonzie Colson (Notre Dame, 362)
- 2nd: Lonzo Ball (UCLA, 404), Derrick Walton Jr. (Michigan, 372), Kenrich Williams (TCU, 352), Dedric Lawson (Memphis, 333), John Collins (Wake Forest, 356)
- 3rd: Luke Kennard (Duke, 357), Derrick White (Colorado, 356), John Konchar (Purdue Fort Wayne, 294), Semi Ojeleye (SMU, 293), Ethan Happ (Wisconsin, 348)

### 2017-18

Savant Player of the Year: **Trae Young**, Oklahoma, 457.5

- 1st: Trae Young (Oklahoma, 458), Jevon Carter (West Virginia, 442), Mikal Bridges (Villanova, 401), Cody Martin (Nevada, 310), Deandre Ayton (Arizona, 391)
- 2nd: Jalen Brunson (Villanova, 394), Devonte' Graham (Kansas, 359), Dean Wade (Kansas State, 299), Kenrich Williams (TCU, 285), Jock Landale (Saint Mary's, 342)
- 3rd: Jon Elmore (Marshall, 346), John Konchar (Purdue Fort Wayne, 326), Peyton Aldridge (Davidson, 277), Zhaire Smith (Texas Tech, 276), Marvin Bagley III (Duke, 341)

### 2018-19

Savant Player of the Year: **Zion Williamson**, Duke, 531.5

- 1st: Cassius Winston (Michigan State, 452), Ja Morant (Murray State, 412), Zion Williamson (Duke, 532), Grant Williams (Tennessee, 449), Brandon Clarke (Gonzaga, 460)
- 2nd: Shamorie Ponds (St. John's, 411), Jeremiah Martin (Memphis, 392), CJ Massinburg (Buffalo, 346), Dylan Windler (Belmont, 342), Matt Rafferty (Furman, 342)
- 3rd: John Konchar (Purdue Fort Wayne, 384), Daishon Smith (UL Monroe, 334), Cameron Johnson (North Carolina, 327), Chuma Okeke (Auburn, 326), Dedric Lawson (Kansas, 324)

### 2019-20

Savant Player of the Year: **Luka Garza**, Iowa, 392.5. No NCAA tournament: the season was called off in March 2020.

- 1st: Payton Pritchard (Oregon, 351), Markus Howard (Marquette, 346), Terry Taylor (Austin Peay, 306), Tres Tinkle (Oregon State, 276), Luka Garza (Iowa, 392)
- 2nd: Mason Jones (Arkansas, 344), Sam Merrill (Utah State, 304), Jayden Gardner (East Carolina, 269), AJ Brodeur (Pennsylvania, 238), Daniel Oturu (Minnesota, 286)
- 3rd: Malachi Flynn (San Diego State, 296), Grayson Murphy (Belmont, 293), Elijah Hughes (Syracuse, 230), Jahlil Tripp (Pacific, 229), Xavier Tillman (Michigan State, 273)

### 2020-21

Savant Player of the Year: **Luka Garza**, Iowa, 386.0

- 1st: Miles McBride (West Virginia, 273), Max Abmas (Oral Roberts, 252), Corey Kispert (Gonzaga, 251), E.J. Liddell (Ohio State, 218), Luka Garza (Iowa, 386)
- 2nd: Marcus Carr (Minnesota, 249), Ayo Dosunmu (Illinois, 235), Terry Taylor (Austin Peay, 216), Oscar Da Silva (Stanford, 214), Drew Timme (Gonzaga, 300)
- 3rd: Jared Butler (Baylor, 233), Marreon Jackson (Toledo, 224), Herbert Jones (Alabama, 202), David Roddy (Colorado State, 193), Evan Mobley (USC, 296)

### 2021-22

Savant Player of the Year: **Keegan Murray**, Iowa, 474.8

- 1st: Scotty Pippen Jr. (Vanderbilt, 354), Jacob Gilyard (Richmond, 332), E.J. Liddell (Ohio State, 356), David Roddy (Colorado State, 318), Keegan Murray (Iowa, 475)
- 2nd: Terrell Brown Jr. (Washington, 314), Kendric Davis (SMU, 278), Jake LaRavia (Wake Forest, 270), Jalyn Hinton (SE Louisiana, 256), Oscar Tshiebwe (Kentucky, 444)
- 3rd: Collin Gillespie (Villanova, 278), Hunter Maldonado (Wyoming, 277), Baylor Scheierman (South Dakota State, 240), Brady Manek (North Carolina, 239), Armando Bacot (North Carolina, 370)

### 2022-23

Savant Player of the Year: **Zach Edey**, Purdue, 460.7

- 1st: Jalen Pickett (Penn State, 416), Markquis Nowell (Kansas State, 400), Brandin Podziemski (Santa Clara, 301), Kobe Brown (Missouri, 292), Zach Edey (Purdue, 461)
- 2nd: Taevion Kinsey (Marshall, 314), Steven Ashworth (Utah State, 308), Jaime Jaquez Jr. (UCLA, 278), Kris Murray (Iowa, 277), Trayce Jackson-Davis (Indiana, 404)
- 3rd: Tyler Kolek (Marquette, 306), Kendric Davis (Memphis, 304), Brandon Miller (Alabama, 277), Jordan Miller (Miami, 274), Oscar Tshiebwe (Kentucky, 345)

### 2023-24

Savant Player of the Year: **Zach Edey**, Purdue, 637.6

- 1st: Mark Sears (Alabama, 398), KJ Simpson (Colorado, 380), Aboubacar Traore (Long Beach State, 278), Terrence Shannon Jr. (Illinois, 278), Zach Edey (Purdue, 638)
- 2nd: Devin Carter (Providence, 330), RJ Davis (North Carolina, 316), Bryce Harris (Howard, 259), David Jones Garcia (Memphis, 258), DaRon Holmes II (Dayton, 315)
- 3rd: Cam Spencer (UConn, 306), Tristen Newton (UConn, 298), Dalton Knecht (Tennessee, 240), Dillon Jones (Weber State, 235), Jaedon LeDee (San Diego State, 306)

### 2024-25

Savant Player of the Year: **Johni Broome**, Auburn, 414.8

- 1st: Kam Jones (Marquette, 369), Bennett Stirtz (Drake, 330), Trey Kaufman-Renn (Purdue, 345), Nique Clifford (Colorado State, 342), Johni Broome (Auburn, 415)
- 2nd: Braden Smith (Purdue, 329), Aniwaniwa Tait-Jones (UC San Diego, 327), Collin Murray-Boyles (South Carolina, 324), Tyson Degenhart (Boise State, 260), Yaxel Lendeborg (UAB, 355)
- 3rd: Javon Small (West Virginia, 317), Donovan Dent (New Mexico, 291), John Tonje (Wisconsin, 258), David N'Guessan (Kansas State, 244), Ryan Kalkbrenner (Creighton, 308)

### 2025-26

Savant Player of the Year: **Cameron Boozer**, Duke, 495.1

- 1st: Bruce Thornton (Ohio State, 400), Tyler Tanner (Vanderbilt, 380), Yaxel Lendeborg (Michigan, 412), Zuby Ejiofor (St. John's, 398), Cameron Boozer (Duke, 495)
- 2nd: Jeremy Fears Jr. (Michigan State, 345), Darius Acuff Jr. (Arkansas, 332), AJ Dybantsa (BYU, 327), Nick Martinelli (Northwestern, 302), Tarris Reed Jr. (UConn, 286)
- 3rd: Ebuka Okorie (Stanford, 324), Nick Boyd (Wisconsin, 324), Dailyn Swain (Texas, 279), Juke Harris (Wake Forest, 265), Izaiyah Nelson (South Florida, 282)

