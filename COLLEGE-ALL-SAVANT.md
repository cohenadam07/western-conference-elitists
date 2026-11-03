# College All-Savant Teams

Shipped in College Basketball Savant 1.1.0; 2009-10 and 2010-11 added in 1.2.0. Pipeline: `pipeline/college/college_value.py`, `team_fit.py`, `allsavant.py`, `ap_check.py`. Check: `tools/savant-cbb/value.mjs`.

## The method in one paragraph

**Savant value** is the points a player added over a replacement-level player at the same position. Its shape is Basketball Savant's. Its weights are not: Adam rejected the first set before launch, and the weights here are fitted to team results.

**Value = (Rate − Replacement) × Possessions ÷ 100**

1. **The stats.** Scoring efficiency over average, three-point and free-throw rate, assist %, turnovers, both rebound rates, steals and blocks, from opponent-adjusted numbers where the stat has one, all games counted.
2. **Luck.** Each stat is pulled toward the position's average by this site's measured settle point.
3. **Position.** Each is centred on the position's average that season.
4. **Worth.** One regression: each team-season's adjusted net rating on its players' minutes-weighted stats, 15 seasons (2009-10 to 2025-26, finished seasons on the site), 5,318 team-seasons.
5. **The floor.** From 2024-25, the rate moves toward what happened on the floor, against what the box rate and minutes say on/off should be, by weight ÷ (weight + 3200). Before that it is box score only, as Basketball Savant is before 2009-10.
6. **Replacement.** The 25th-percentile qualified rate at the position that season.

Possessions are the ones played, so missed games cost value. Every D1 game counts, through the national championship. Before the title game a team is a standing ("so far"), not an honour.

### Worked example: Cameron Boozer, Duke, 2025-26

| Part | Points per 100 |
|---|---|
| Scoring | +9.74 |
| Playmaking | +8.11 |
| Rebounding | +3.03 |
| Defense | +0.60 |
| Floor | -0.02 |
| **Rate** | **+21.46** |

Replacement for a big that season: -3.09. Possessions: 2,004.

(21.46 − (-3.09)) × 2,004 ÷ 100 = **492.1**

## The weights

| Stat | First set (on/off fit), per unit | Team results, per unit |
|---|---|---|
| Points over average efficiency per 100 | +0.681 | +1.619 |
| Usage % | -0.045 | +0.000 |
| 3-point attempt rate | +0.036 | +0.023 |
| Free-throw rate | +0.019 | +0.061 |
| Assist % | +0.442 | +0.383 |
| Turnovers per 100 | -0.215 | -2.463 |
| Offensive rebound % | +1.054 | +0.733 |
| Defensive rebound % | +0.124 | +0.194 |
| Steals per 100 | +4.108 | +1.765 |
| Blocks per 100 | +1.085 | +0.555 |

- **Usage is zero, on purpose.** A team's minutes-weighted usage adds up to nearly the same number for every team, so team results can't see it. Fitted anyway it came out at +1.87, an artifact that wrecked next-season prediction. A scorer's volume reaches the rate through scoring efficiency, which is attempts × efficiency. The cost: a star at exactly average efficiency gets no credit for carrying an offense.
- **The floor** uses a regression of on/off on the box rate and minutes share, weight ÷ (weight + K), so one good on/off year can't overrule the box score.
- **Credit is gone.** The per-stat credit tested identical (5.363 vs 5.363), which is structural: a fit to team totals absorbs any per-stat multiplier into the weight.
- **The penalty** was chosen by leaving one season out at a time. It made no difference up to about 100, so there is very little to shrink: 5,318 team-seasons, nine weights.

## Old weights against new

| Measure | Old (on/off fit) | New (team results) |
|---|---|---|
| Fit to team net rating, r | 0.7757 | **0.9055** (held out by season) |
| Fit to team net rating, RMSE | 8.073 | **5.363** |
| Next season's luck-adjusted on/off, returning players, r | **0.128** | 0.048 |
| Same, RMSE | **8.776** | 9.542 |
| Year-to-year stability of the rate, r | **0.745** | 0.671 |
| AP All-Americans on our 1st to 3rd teams | 51 of 226 | **94 of 226** |
| AP 1st-teamers on our 1st team | 13 of 65 | **26 of 65** |

**The new weights lose on next-season on/off**, and their RMSE is worse than guessing zero (8.859). That target is close to noise, the old weights were fitted to it, and it has one pair of seasons, 1,472 players. Team results are the better evidence, but this isn't a clean sweep.

The first test's published numbers (r .105 and .04) had a leak: the penalty was picked on the test target, and box impact used raw stats. Fixed, they were 0.102 and -0.014, and the refit still won that test. The floor's K (3200) is still picked on that one target, and its effect is limited to 2024-25 on.

## The All-America check

A check, never a target: no AP name touches the fit. AP lists are from each year's Wikipedia page. There are 226 names because 2021-22 had a tie on the third team.

| Season | Old | New | AP names | AP 1st on our 1st |
|---|---|---|---|---|
| 2009-10 | 6 | 6 | 15 | 1 |
| 2010-11 | 2 | 8 | 15 | 2 |
| 2013-14 | 2 | 5 | 15 | 2 |
| 2014-15 | 3 | 6 | 15 | 2 |
| 2015-16 | 3 | 7 | 15 | 1 |
| 2016-17 | 4 | 6 | 15 | 2 |
| 2017-18 | 3 | 8 | 15 | 2 |
| 2018-19 | 5 | 6 | 15 | 3 |
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
| as built | 94 of 226 | 26 |
| no 2-2-1 shape (top 15 by value) | 100 of 226 | 30 |
| raw stats, not adjusted | 66 of 226 | 21 |
| one replacement level for all positions | 94 of 226 | 26 |
| rate, so games don't count | 67 of 226 | 20 |

- **The 2-2-1 shape** costs 6 names.
- **Replacement level** moves it by 0: the three positions' levels are nearly the same.
- **Raw vs adjusted, and games played:** the adjustment and counting possessions both raise the overlap. Taking away the adjustment moves it to 66, and ignoring games played to 67.
- **What's left is team success.** The AP players we miss played for teams ranked a median 8th, and the players we pick that AP doesn't were on teams ranked 48th. Their usage and scoring are close (27.5 and 26.5 usage, 21.9 and 22.0 points per 70). That fits voters rewarding winning, which Savant value doesn't: it rates the player, and the schedule adjustment is its only team context. This is a comparison of medians, not a test of cause.

## 2025-26 next to the AP teams

| Team | Player | School | Position | Value | Rate | Possessions | Schedule rank at position |
|---|---|---|---|---|---|---|---|
| 1st | Bruce Thornton | Ohio State | Guard | 399.3 | +16.8 | 1,990 | 46 of 1186 |
| 1st | Tyler Tanner | Vanderbilt | Guard | 376.0 | +15.8 | 1,970 | 89 of 1186 |
| 1st | Yaxel Lendeborg | Michigan | Wing | 409.5 | +18.0 | 1,970 | 4 of 924 |
| 1st | Zuby Ejiofor | St. John's | Wing | 394.9 | +18.4 | 1,862 | 24 of 924 |
| 1st | Cameron Boozer | Duke | Big | 492.1 | +21.5 | 2,004 | 25 of 631 |
| 2nd | Jeremy Fears Jr. | Michigan State | Guard | 340.3 | +15.3 | 1,831 | 74 of 1186 |
| 2nd | Darius Acuff Jr. | Arkansas | Guard | 328.6 | +12.2 | 2,126 | 84 of 1186 |
| 2nd | AJ Dybantsa | BYU | Wing | 324.1 | +13.0 | 2,059 | 7 of 924 |
| 2nd | Nick Martinelli | Northwestern | Wing | 301.3 | +13.5 | 1,853 | 80 of 924 |
| 2nd | Tarris Reed Jr. | UConn | Big | 285.1 | +16.0 | 1,496 | 4 of 631 |
| 3rd | Nick Boyd | Wisconsin | Guard | 321.9 | +14.2 | 1,840 | 39 of 1186 |
| 3rd | Ebuka Okorie | Stanford | Guard | 321.7 | +14.6 | 1,799 | 111 of 1186 |
| 3rd | Dailyn Swain | Texas | Wing | 277.3 | +11.7 | 1,912 | 112 of 924 |
| 3rd | Juke Harris | Wake Forest | Wing | 262.4 | +10.4 | 1,990 | 114 of 924 |
| 3rd | Izaiyah Nelson | South Florida | Big | 281.9 | +14.5 | 1,602 | 217 of 631 |

| AP team | Player | School | Position | Value | Rate | Possessions | Schedule rank | Our team |
|---|---|---|---|---|---|---|---|---|
| AP 1st | Darius Acuff Jr. | Arkansas | Guard | 328.6 | +12.2 | 2,126 | 84 of 1186 | our 2nd |
| AP 1st | Cameron Boozer | Duke | Big | 492.1 | +21.5 | 2,004 | 25 of 631 | our 1st |
| AP 1st | AJ Dybantsa | BYU | Wing | 324.1 | +13.0 | 2,059 | 7 of 924 | our 2nd |
| AP 1st | Yaxel Lendeborg | Michigan | Wing | 409.5 | +18.0 | 1,970 | 4 of 924 | our 1st |
| AP 1st | JT Toppin | Texas Tech | Big | 206.6 | +11.7 | 1,397 | 36 of 631 | none |
| AP 2nd | Braden Smith | Purdue | Guard | 291.6 | +10.7 | 2,075 | 21 of 1186 | none |
| AP 2nd | Joshua Jefferson | Iowa State | Big | 205.9 | +9.7 | 1,616 | 70 of 631 | none |
| AP 2nd | Keaton Wagler | Illinois | Guard | 316.2 | +13.6 | 1,875 | 25 of 1186 | none |
| AP 2nd | Caleb Wilson | North Carolina | Big | 209.3 | +14.3 | 1,205 | 123 of 631 | none |
| AP 2nd | Jeremy Fears Jr. | Michigan State | Guard | 340.3 | +15.3 | 1,831 | 74 of 1186 | our 2nd |

Schedule rank: 1 is the toughest among qualified players at the position, by possession-weighted opponent defense.

## History gate

A box-tier season needs a box score and a matching final score on at least 98% of D1 games. "Strict" is ESPN as it stands; "recovered" is after the fix below. Games that miss are dropped.

| Season | D1 games | Strict | Recovered | Lines recovered | Ages | Tier |
|---|---|---|---|---|---|---|
| 2009-10 | 5,393 | 98.2% | 98.2% | 0 | 79% | box |
| 2010-11 | 5,390 | 98.7% | 98.7% | 0 | 82% | box |
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

**Ages.** T-Rank's files before 2022-23 have no birthdate column at all (78 columns, the last a single digit; checked for 2007-08 to 2021-22), so refetching them won't help. Those ages come from CBBD rosters, later seasons and Basketball Savant.

### Seasons tried and left off (1.2.0)

Every season from 2002-03 to 2012-13 was tried with the same gate. Seven came from the Mac's archive, and four (2002-03 to 2005-06) were pulled from ESPN on Nov 2, all 20,237 final games found. Only 2009-10 and 2010-11 pass. The rest fail because ESPN lists some games' players with empty stats: the box was never recorded, and it is the same today. Before 2004-05 almost no game has a player box at all.

| Season | D1 games | Box and final score | |
|---|---|---|---|
| 2002-03 | 4,659 | 0.2% | off the site |
| 2003-04 | 4,646 | 0.2% | off the site |
| 2004-05 | 4,758 | 86.8% | off the site |
| 2005-06 | 4,815 | 93.8% | off the site |
| 2006-07 | 5,130 | 92.7% | off the site |
| 2007-08 | 5,279 | 96.5% | off the site |
| 2008-09 | 5,383 | 97.4% | off the site |
| 2011-12 | 5,367 | 87.2% | off the site |
| 2012-13 | 5,471 | 86.6% | off the site |

**CBBD can't fill them** (7 calls, Nov 2). Its `/games/players` reports the same boxes as ESPN: in 2008-09 the same players with the same lines, so no game's points add up; in 2012-13 it has both teams for only 22 of 321 failing games; in 2002-03 it has no player rows at all. Details in `pipeline/college/cbbd_box.py`.

## Known gaps

- **Tournament teams.** The field comes from the postseason games: 68 teams, except 2016-17 (66, as ESPN's archive lacks the two March 14 First Four games), 2020-21 (67, VCU's game was a no-contest) and 2019-20 (none, no tournament).
- **2011-12 and 2012-13 are missing,** between 2010-11 and 2013-14. Careers skip them.
- **Value isn't comparable across the 2024-25 line.** Seasons from there on include the floor part.

## National teams by season

### 2009-10

Savant Player of the Year: **Jon Scheyer**, Duke, 457.3

- 1st: Jon Scheyer (Duke, 457), Aubrey Coleman (Houston, 399), Marqus Blakely (Vermont, 420), Quincy Pondexter (Washington, 370), DeMarcus Cousins (Kentucky, 376)
- 2nd: Jimmer Fredette (BYU, 356), Jacob Pullen (Kansas State, 352), Landry Fields (Stanford, 363), James Anderson (Oklahoma State, 353), Damion James (Texas, 315)
- 3rd: Dominique Jones (South Florida, 352), Greivis Vasquez (Maryland, 339), Evan Turner (Ohio State, 340), Jimmy Butler III (Marquette, 325), Omar Samhan (Saint Mary's, 312)

### 2010-11

Savant Player of the Year: **Kemba Walker**, UConn, 552.3

- 1st: Kemba Walker (UConn, 552), Jimmer Fredette (BYU, 469), Alec Burks (Colorado, 360), Noah Dahlman (Wofford, 349), Kenneth Faried (Morehead State, 408)
- 2nd: Norris Cole (Cleveland State, 390), Charles Jenkins (Hofstra, 388), Draymond Green (Michigan State, 336), Jimmy Butler III (Marquette, 336), Derrick Williams (Arizona, 407)
- 3rd: Jordan Taylor (Wisconsin, 371), Nolan Smith (Duke, 365), MarShon Brooks (Providence, 329), Ken Horton (Central Connecticut, 320), Jared Sullinger (Ohio State, 362)

### 2013-14

Savant Player of the Year: **Shabazz Napier**, UConn, 434.2

- 1st: Shabazz Napier (UConn, 434), Billy Baron (Canisius, 379), Doug McDermott (Creighton, 400), Jordan Adams (UCLA, 366), Frank Kaminsky (Wisconsin, 273)
- 2nd: Marcus Smart (Oklahoma State, 374), Delon Wright (Utah, 371), T.J. Warren (NC State, 363), Kyle Anderson (UCLA, 333), Jarnell Stokes (Tennessee, 273)
- 3rd: Bryce Cotton (Providence, 369), Kendrick Perry (Youngstown State, 351), KJ McDaniels (Clemson, 283), Melvin Ejim (Iowa State, 271), Cameron Bairstow (New Mexico, 272)

### 2014-15

Savant Player of the Year: **Frank Kaminsky**, Wisconsin, 414.8

- 1st: Delon Wright (Utah, 401), Jerian Grant (Notre Dame, 392), Kyle Collinsworth (BYU, 309), Thomas Walkup (Stephen F. Austin, 280), Frank Kaminsky (Wisconsin, 415)
- 2nd: Kris Dunn (Providence, 355), Corey Walden (Eastern Kentucky, 338), Sir'Dominic Pointer (St. John's, 274), Nigel Hayes-Davis (Wisconsin, 274), Bobby Portis (Arkansas, 326)
- 3rd: D'Angelo Russell (Ohio State, 335), Cameron Payne (Murray State, 331), Sam Dekker (Wisconsin, 265), J.J. Avila (Colorado State, 252), Jahlil Okafor (Duke, 316)

### 2015-16

Savant Player of the Year: **Kay Felder**, Oakland, 508.6

- 1st: Kay Felder (Oakland, 509), Buddy Hield (Oklahoma, 436), Thomas Walkup (Stephen F. Austin, 398), Georges Niang (Iowa State, 295), Ben Simmons (LSU, 405)
- 2nd: Denzel Valentine (Michigan State, 395), Grayson Allen (Duke, 383), Josh Hart (Villanova, 289), John Konchar (Purdue Fort Wayne, 286), Brice Johnson (North Carolina, 398)
- 3rd: Andrew Andrews (Washington, 383), Gary Payton II (Oregon State, 370), DeAndre' Bembry (Saint Joseph's, 286), Gary Clark (Cincinnati, 261), Jameel Warney (Stony Brook, 370)

### 2016-17

Savant Player of the Year: **Frank Mason III**, Kansas, 425.3

- 1st: Frank Mason III (Kansas, 425), Monte Morris (Iowa State, 405), Sindarius Thornwell (South Carolina, 395), Josh Hart (Villanova, 355), Bonzie Colson (Notre Dame, 361)
- 2nd: Lonzo Ball (UCLA, 401), Derrick Walton Jr. (Michigan, 370), Kenrich Williams (TCU, 354), Dedric Lawson (Memphis, 330), John Collins (Wake Forest, 356)
- 3rd: Luke Kennard (Duke, 356), Derrick White (Colorado, 353), John Konchar (Purdue Fort Wayne, 294), Semi Ojeleye (SMU, 292), Ethan Happ (Wisconsin, 346)

### 2017-18

Savant Player of the Year: **Trae Young**, Oklahoma, 451.6

- 1st: Trae Young (Oklahoma, 452), Jevon Carter (West Virginia, 438), Mikal Bridges (Villanova, 397), Cody Martin (Nevada, 306), Deandre Ayton (Arizona, 391)
- 2nd: Jalen Brunson (Villanova, 392), Devonte' Graham (Kansas, 355), Dean Wade (Kansas State, 296), Kenrich Williams (TCU, 285), Jock Landale (Saint Mary's, 343)
- 3rd: Jon Elmore (Marshall, 342), John Konchar (Purdue Fort Wayne, 326), Peyton Aldridge (Davidson, 275), Zhaire Smith (Texas Tech, 275), Marvin Bagley III (Duke, 342)

### 2018-19

Savant Player of the Year: **Zion Williamson**, Duke, 530.2

- 1st: Cassius Winston (Michigan State, 447), Shamorie Ponds (St. John's, 408), Zion Williamson (Duke, 530), Grant Williams (Tennessee, 446), Brandon Clarke (Gonzaga, 457)
- 2nd: Ja Morant (Murray State, 407), Jeremiah Martin (Memphis, 388), CJ Massinburg (Buffalo, 344), Dylan Windler (Belmont, 342), Matt Rafferty (Furman, 340)
- 3rd: John Konchar (Purdue Fort Wayne, 382), Daishon Smith (UL Monroe, 331), Cameron Johnson (North Carolina, 326), Chuma Okeke (Auburn, 325), Dedric Lawson (Kansas, 324)

### 2019-20

Savant Player of the Year: **Luka Garza**, Iowa, 390.6. No NCAA tournament: the season was called off in March 2020.

- 1st: Payton Pritchard (Oregon, 348), Markus Howard (Marquette, 343), Terry Taylor (Austin Peay, 308), Tres Tinkle (Oregon State, 274), Luka Garza (Iowa, 391)
- 2nd: Mason Jones (Arkansas, 341), Sam Merrill (Utah State, 302), Jayden Gardner (East Carolina, 270), AJ Brodeur (Pennsylvania, 236), Daniel Oturu (Minnesota, 285)
- 3rd: Malachi Flynn (San Diego State, 293), Grayson Murphy (Belmont, 292), Jahlil Tripp (Pacific, 230), Elijah Hughes (Syracuse, 226), Tyrique Jones (Xavier, 271)

### 2020-21

Savant Player of the Year: **Luka Garza**, Iowa, 383.1

- 1st: Miles McBride (West Virginia, 272), Max Abmas (Oral Roberts, 250), Corey Kispert (Gonzaga, 249), Terry Taylor (Austin Peay, 219), Luka Garza (Iowa, 383)
- 2nd: Marcus Carr (Minnesota, 246), Ayo Dosunmu (Illinois, 234), E.J. Liddell (Ohio State, 217), Oscar Da Silva (Stanford, 214), Drew Timme (Gonzaga, 299)
- 3rd: Jared Butler (Baylor, 231), Grayson Murphy (Belmont, 222), Herbert Jones (Alabama, 201), David Roddy (Colorado State, 193), Evan Mobley (USC, 292)

### 2021-22

Savant Player of the Year: **Keegan Murray**, Iowa, 470.6

- 1st: Scotty Pippen Jr. (Vanderbilt, 350), Jacob Gilyard (Richmond, 329), E.J. Liddell (Ohio State, 352), David Roddy (Colorado State, 317), Keegan Murray (Iowa, 471)
- 2nd: Terrell Brown Jr. (Washington, 313), Collin Gillespie (Villanova, 276), Jake LaRavia (Wake Forest, 268), Jalyn Hinton (SE Louisiana, 254), Oscar Tshiebwe (Kentucky, 447)
- 3rd: Kameron McGusty (Miami, 276), Hunter Maldonado (Wyoming, 276), Brady Manek (North Carolina, 239), Colby Jones (Xavier, 237), Armando Bacot (North Carolina, 371)

### 2022-23

Savant Player of the Year: **Zach Edey**, Purdue, 462.0

- 1st: Jalen Pickett (Penn State, 414), Markquis Nowell (Kansas State, 395), Brandin Podziemski (Santa Clara, 299), Kobe Brown (Missouri, 292), Zach Edey (Purdue, 462)
- 2nd: Taevion Kinsey (Marshall, 313), Steven Ashworth (Utah State, 305), Jaime Jaquez Jr. (UCLA, 278), Kris Murray (Iowa, 276), Trayce Jackson-Davis (Indiana, 400)
- 3rd: Tyler Kolek (Marquette, 304), D'Moi Hodge (Missouri, 302), Brandon Miller (Alabama, 275), Jordan Miller (Miami, 274), Oscar Tshiebwe (Kentucky, 348)

### 2023-24

Savant Player of the Year: **Zach Edey**, Purdue, 635.4

- 1st: Mark Sears (Alabama, 394), KJ Simpson (Colorado, 377), Aboubacar Traore (Long Beach State, 276), Terrence Shannon Jr. (Illinois, 274), Zach Edey (Purdue, 635)
- 2nd: Devin Carter (Providence, 328), RJ Davis (North Carolina, 313), Bryce Harris (Howard, 260), David Jones Garcia (Memphis, 258), DaRon Holmes II (Dayton, 310)
- 3rd: Cam Spencer (UConn, 305), Tristen Newton (UConn, 296), Dalton Knecht (Tennessee, 237), Anton Watson (Gonzaga, 234), Jaedon LeDee (San Diego State, 305)

### 2024-25

Savant Player of the Year: **Johni Broome**, Auburn, 413.1

- 1st: Kam Jones (Marquette, 366), Bennett Stirtz (Drake, 327), Trey Kaufman-Renn (Purdue, 345), Nique Clifford (Colorado State, 339), Johni Broome (Auburn, 413)
- 2nd: Braden Smith (Purdue, 326), Aniwaniwa Tait-Jones (UC San Diego, 325), Collin Murray-Boyles (South Carolina, 322), Tyson Degenhart (Boise State, 259), Yaxel Lendeborg (UAB, 354)
- 3rd: Javon Small (West Virginia, 314), Donovan Dent (New Mexico, 287), John Tonje (Wisconsin, 255), David N'Guessan (Kansas State, 245), Ryan Kalkbrenner (Creighton, 306)

### 2025-26

Savant Player of the Year: **Cameron Boozer**, Duke, 492.1

- 1st: Bruce Thornton (Ohio State, 399), Tyler Tanner (Vanderbilt, 376), Yaxel Lendeborg (Michigan, 410), Zuby Ejiofor (St. John's, 395), Cameron Boozer (Duke, 492)
- 2nd: Jeremy Fears Jr. (Michigan State, 340), Darius Acuff Jr. (Arkansas, 329), AJ Dybantsa (BYU, 324), Nick Martinelli (Northwestern, 301), Tarris Reed Jr. (UConn, 285)
- 3rd: Nick Boyd (Wisconsin, 322), Ebuka Okorie (Stanford, 322), Dailyn Swain (Texas, 277), Juke Harris (Wake Forest, 262), Izaiyah Nelson (South Florida, 282)

