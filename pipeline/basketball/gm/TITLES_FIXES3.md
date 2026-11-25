# GM Savant: draft titles, Kupchak's card, and the luck adjustment test — report

Branch `gm-savant`, not pushed, merged or deployed. Nothing was fetched from Basketball-Reference.

Every check passes: points conservation, titles conservation, pipeline tests, both leakage tests, page 11/11, tap walk 24/24, connector 20/20, coverage, Data Room. Points are unchanged.

## 1. Draft picks' title impact, against an average pick at that slot

**As it turned out:** a draft pick's titles are now with minus without the player against an average pick at his slot, using the conserved career-minus-slot stream.

**At the time:** for a board draft, the board's expected value at the chosen player's consensus rank minus its expected value at the slot, on the same curve as known on draft day. Drafts with no board still have no at-the-time grade.

The board comparison (against the best player still available) stays in the drafting skill and in the pick's points grade. The decision explainer now says why.

| pick | titles before | now |
|---|---|---|
| Ádám Hanga, No. 59, 2011 | −0.90 | −0.006 (the board said Isaiah Thomas; against his slot he was −6 points) |
| Harrison Barnes, No. 7, 2012 | −0.76 | −0.32 (581 points below his slot) |
| Stephen Curry, No. 7, 2009 | +1.16 | +1.16 (no board that year: already against the slot) |
| Draymond Green, No. 35, 2012 | +0.84 | +0.79 |

**New top 10 by title impact** (as it turned out). Losses:

| | decision | credited | points | titles |
|---|---|---|---|---|
| 1 | 1979 Lakers trade Adrian Dantley for Spencer Haywood | Bill Sharman | −2,299 | −1.48 |
| 2 | 2012 Thunder trade James Harden to Houston | Sam Presti | −2,935 | −1.41 |
| 3 | 2004 Mavericks let Steve Nash walk | Don and Donn Nelson | −1,988 | −1.18 |
| 4 | 1999 Lakers trade for Glen Rice | Jerry West | −1,913 | −1.15 |
| 5 | 1984 Blazers trade for Kiki Vandeweghe | Stu Inman | −1,788 | −0.93 |
| 6 | 1996 Magic let Shaquille O'Neal walk | John Gabriel, Pat Williams | −2,816 | −0.81 |
| 7 | 1992 Jazz trade for Jay Humphries and Larry Krystkowiak | Scott Layden | −1,425 | −0.81 |
| 8 | 1994 Lakers trade Doug Christie to New York | Jerry West | −1,361 | −0.76 |
| 9 | 1989 Suns waive Micheal Williams | Jerry Colangelo | −1,025 | −0.74 |
| 10 | 2019 Celtics let Kyrie Irving walk | Danny Ainge | −1,144 | −0.72 |

Gains:

| | decision | credited | points | titles |
|---|---|---|---|---|
| 1 | 2021 Thunder extend Shai Gilgeous-Alexander | Presti | +3,379 | +1.19 |
| 2 | 2009 Warriors draft Stephen Curry (No. 7) | Larry Riley | +3,043 | +1.16 |
| 3 | 2002 Spurs re-sign Manu Ginóbili | Buford, Popovich | +2,108 | +1.08 |
| 4 | 2019 Thunder trade for Gilgeous-Alexander | Presti | +2,586 | +1.05 |
| 5 | 2004 Spurs re-sign Ginóbili | Buford, Popovich | +2,155 | +1.02 |
| 6 | 2016 Bucks re-sign Giannis Antetokounmpo | Hammond | +3,346 | +0.95 |
| 7 | 2010 LeBron James to Miami (sign-and-trade) | Pat Riley | +3,478 | +0.95 |
| 8 | 2018 Bucks hire Mike Budenholzer | Horst | +1,525 | +0.93 |
| 9 | 1987 Bulls draft Scottie Pippen (No. 5) | Krause | +1,693 | +0.93 |
| 10 | 1997 Spurs draft Tim Duncan (No. 1) | Popovich | +1,470 | +0.90 |

Hanga and Barnes are out of the losses; Micheal Williams and Kyrie Irving come in.

## 2. Kupchak's card

The auto-written report now says, for every GM, titles won against expected. For a low-ranked GM who won titles, it also says what explains the rank: the stars he inherited, and his worst stretch of below-average seasons. Ranks read "Nth of 207" (the bare percentile read "0th"). Kupchak's now reads:

> Mitch Kupchak ran LAL 2000–2017 and added -4,841 points of value against an average GM in his seat (-290 a season), 206th of 207 spells (0th percentile). Most of it is the roster he handed on: 702 left against 6,222 inherited (-5,520), with +679 from the team's luck-adjusted margin. His teams won 4 titles against 0.8 expected (playoff luck +3.2); counted in titles, he added -0.14 expected titles against an average GM. The low rank despite the titles: he inherited Kobe Bryant and Shaquille O'Neal, whose later production counts against him (what he inherited: 6,222); and his teams from 2013-14 to 2016-17 played below average (-1,678). …

Krause gets the same treatment: 6 titles against 2.6 expected; inherited Michael Jordan; 1998-99 to 2002-03 below average (−2,623). I also fixed an existing ordinal bug ("taken 31th" is now "31st").

## 3. Is the luck adjustment too strong? (report only; the points are unchanged)

A partial adjustment adds f × the luck term to the margin. f = 1 is today's full adjustment: opponents' three-point and free-throw shooting set all the way to league average. f = 0 is the raw margin.

Each test is out of sample: every target season is predicted from fits on earlier seasons, and the chosen f is the one that did best on the seasons before. Each gain is against f = 1, with a 95% interval in brackets.

| test | best f | gain against the full adjustment |
|---|---|---|
| Next season's raw margin from this season's | 0.5 | −0.074 points² per team [−0.177, +0.027]: about 0.5%, not significant |
| Second half from the first half (41 seasons, from game logs) | 0.3 (latest choice 0.2) | **−0.47 points² per team [−0.76, −0.19]: about 4%, significant** |
| Playoff games (log loss per game, 3,600 games) | 0.0 (raw) | −0.0048 nats [−0.0079, −0.0017]: small, significant |
| Title log score (no preseason blend / with it) | 0.0 | 1.979 → 1.850 / 1.870 → 1.771 |

**What it says:**
- **The full adjustment is too strong.** Within a season, the best predictor of a team's second half keeps only about 30% of the shooting luck adjustment. So roughly 70% of what opponents shoot away from the league average carries over, which is more like defense than luck.
- **For titles, raw margin is best**, consistent with last round's playoff-strength result.

**What it would do to GM Value Added** (5%, production at margin + f × luck, value per margin point refit):

| f | Kupchak | Krause | Presti | Riley | Myers | Popovich | value per margin point |
|---|---|---|---|---|---|---|---|
| 1.0 (today) | −4,841 | −2,864 | +6,912 | +2,429 | −97 | +6,242 | 60.1 |
| 0.5 | −4,698 | −2,774 | +7,049 | +2,415 | +34 | +6,352 | 58.1 |
| **0.3 (best second-half)** | **−4,647** | **−2,746** | **+7,089** | **+2,396** | **+72** | **+6,371** | **57.1** |
| 0.2 | −4,623 | −2,734 | +7,106 | +2,383 | +88 | +6,377 | 56.6 |
| 0.0 (raw) | −4,579 | −2,714 | +7,134 | +2,352 | +113 | +6,378 | 55.4 |

At f = 0.3 the showcase GMs move by +118 to +194 points, except Riley (−33). That is small next to the spreads between them, because only production changes: what a GM left and inherited does not use the luck term.

**Recommendation for the separate decision:** f around 0.3 for the points headline, the strength measure, and raw (f = 0) for the playoffs, which the title model already uses. I changed nothing.

**Two notes on the data:**
- The NBA's game logs carry wrong three-point and free-throw counts for 1979-80 to 1984-85 (game-log luck off by up to 33 points against Basketball-Reference's totals), so the second-half test skips those seasons. From 1985-86 the two agree at 0.999 or better.
- This study peaked at 831 MB, above the 0.7 GB I keep the chain under. It is a one-off report script, not in the chain.
