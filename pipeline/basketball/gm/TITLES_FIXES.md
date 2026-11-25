# GM Savant titles: the two fixes — report

Branch `gm-savant`, not pushed, merged or deployed. Nothing was fetched from Basketball-Reference: the title data step reads its pages from the cache only, and I did not run `luck.py`, `mac_pull.sh` or the nightly.

The full rebuild ran alone from the ledger, every step under 0.65 GB (the title model is now the slowest step, at 7 minutes). Every check passes: points conservation, titles conservation, pipeline tests, both leakage tests (blend weights included), page 11/11, tap walk 24/24, connector 20/20, coverage, Data Room. Points (GM Value Added) are unchanged in every spell.

## 1. Decision titles: with minus without

For each decision and each season over the 10-season horizon (5% discount), the title impact is the team's title chance at its actual strength minus its chance at that strength less the decision's points that season. It covers both grades and both sides of every trade.
- **Played seasons** are read off the team's own season replayed at 17 strengths (±16 margin points, every other team and every random draw unchanged), interpolated between them.
- **Seasons ahead** are read off the projected title curve: as of the day for "at the time", as of today for the turned-out grade's future seasons.
- **The conserving split** is kept only for the team-season check and the GM totals. The titles conservation still passes: largest gap 0.013, all gaps 0.021.
- **The decision explainer** now says the two answer different questions.

**The Luka trades** (points | expected titles):

| | at the time | as it turned out | (split, before) |
|---|---|---|---|
| Dallas, Feb 2025 (Harrison) | −1,099 · −0.065 | −1,978 · −0.069 | −0.044 / −0.049 |
| Lakers, Feb 2025 (Pelinka) | +949 · +0.022 | +2,013 · +0.125 | +0.024 / +0.122 |
| Dallas, 2018 draft night (Donn Nelson) | −156 · −0.004 | −176 · −0.032 | −0.003 / −0.002 |
| Atlanta, 2018 draft night (Schlenk) | +156 · +0.003 | +176 · +0.013 | +0.003 / +0.007 |

Dallas's 2025 cost is still small: with or without Luka, Dallas in 2025-26 and beyond was far from a title, and the future seasons sit on a flat projected curve.

**The 10 biggest decisions by title impact** (as it turned out; at the time in brackets). All ten are losses. Take a negative decision away from a contender and it becomes dominant, so a contender's losses run larger than its gains.

| | decision | credited | points | titles |
|---|---|---|---|---|
| 1 | 1979 Lakers trade Adrian Dantley for Spencer Haywood | Bill Sharman | −2,299 | −3.94 (early era, none) |
| 2 | 2012 Thunder trade James Harden to Houston | Sam Presti | −2,935 | −3.49 (−0.43) |
| 3 | 1984 Blazers trade for Kiki Vandeweghe | Stu Inman | −1,788 | −2.48 (none) |
| 4 | 2004 Mavericks let Steve Nash walk | Don and Donn Nelson | −1,988 | −2.41 (−0.09) |
| 5 | 1999 Lakers trade for Glen Rice | Jerry West | −1,913 | −2.39 (−0.67) |
| 6 | 2010 Cavaliers' sign-and-trade of LeBron James | Chris Grant | −3,478 | −2.07 (−0.68) |
| 7 | 1996 Magic let Shaquille O'Neal walk | John Gabriel, Pat Williams | −2,816 | −2.06 (−0.75) |
| 8 | 2001 Suns trade for Stephon Marbury | Bryan Colangelo | −1,788 | −2.00 (+0.03) |
| 9 | 2012 Warriors draft Harrison Barnes | Bob Myers | −1,319 | −1.80 (−0.00) |
| 10 | 2014 Heat let LeBron James walk | Pat Riley | −2,681 | −1.80 (−0.25) |

The biggest gains:

| | decision | credited | titles |
|---|---|---|---|
| 1 | 1979 Celtics trade Bob McAdoo to Detroit for two 1980 first-round picks (Rickey Brown and Joe Barry Carroll were taken with them) | Red Auerbach | +1.56 |
| 2 | 2012 Warriors draft Draymond Green | Myers | +1.49 |
| 3 | 2009 Warriors draft Stephen Curry | Larry Riley | +1.46 |
| 4 | 2016 Bucks re-sign Giannis | Hammond | +1.46 |
| 5 | 2021 Thunder extend SGA | Presti | +1.43 |

Then Budenholzer's 2018 hire (Horst, +1.43), LeBron to Miami (Riley, +1.33), Pippen's draft (Krause, +1.33), Draymond's 2015 re-signing (Myers, +1.32) and Ginóbili's 2002 re-signing (Buford and Popovich, +1.29).

## 2. Title-odds calibration

**Calibration, out of sample, every season from 1983-84** (teams | expected titles | titles won):

| title chance | before | after |
|---|---|---|
| 0–2% | 940 · 2.0 · 4 | 941 · 2.1 · 3 |
| 2–5% | 90 · 2.9 · 3 | 91 · 3.1 · 5 |
| 5–15% | 98 · 8.8 · 12 | 94 · 8.6 · 9 |
| 15–30% | 56 · 12.0 · 5 | 60 · 12.7 · 7 |
| 30%+ | 39 · 17.3 · 19 | 37 · 16.6 · 19 |
| Brier | 0.0266 | 0.0259 |
| log score | 1.883 | 1.809 |

The pattern is a little different from the one you described:
- **The top tier was not overconfident:** teams above 30% won 19 titles against 17.3 expected.
- **The second tier was:** 15–30% teams won 5 against 12.0.
- **Long shots were underrated:** teams under 15% won 19 against 13.7.

Together, the model was too sure of its contenders as a group (15%+) and too low on everyone else.

**The test** (`titles_study.py`): 288 playoff models, each season replayed 10,000 times with the same random draws. Each season is scored with the model chosen on the seasons before it, so no season picks its own model.

| model | log score (1989-90 on) | Brier |
|---|---|---|
| the model before | 1.983 | 0.02682 |
| (a) more playoff noise, per team | 1.967 | 0.02664 |
| (a) series-level random effect | 1.976 | 0.02671 |
| **(b) preseason projection blended into playoff strength** | **1.902** | **0.02626** |
| (c) star concentration, top 2 or top 3 share | 1.992 (worse) | 0.02692 |
| (a) + (b), (b) + (c), everything | 1.906 to 1.911 | |

**Adopted: (b) alone.** In the playoffs a team's strength is its rating plus w × (its opening-night projection on the margin scale minus its rating). Each season's w is chosen on the seasons before it: 0.25 in most seasons from 2010-11 on, 0 in most before 2002. The extra per-team playoff noise is dropped, since it lost out of sample.

Honestly, the gain is modest:
- **Mean improvement:** 0.075 per season, 95% interval −0.17 to +0.02 (14 seasons better, 12 worse).
- **The 15–30% gap** narrows (7 won against 12.7) but does not close.
- **Your Lakers cases do not move,** because the chosen weight was 0 in 2000-01 and 2009-10.

**One more result, for your decision (not adopted).** Your two Lakers cases are luck-adjustment cases. I tried raw margin as playoff strength, with nothing fitted:
- **Log score:** 1.756 against 1.870 for the luck-adjusted rating (95% interval −0.24 to +0.01).
- **Half raw, half adjusted:** 1.789.

So the luck adjustment removes signal that matters in the playoffs: opponent shooting luck may partly be real defense. That beats every candidate you listed. Your spec fixed the strength to the luck-adjusted rating the points use, so I left it there; say if you want playoff strength to use the raw margin, or a blend.

**Showcase GMs, before and after** (points unchanged; ranks among 207 ranked spells, titles then blend):

| | points | expected titles added | expected · won · luck | blended | ranks |
|---|---|---|---|---|---|
| Kupchak, LAL | −4,841 | −0.22 → −0.22 | 0.68 → 0.71 · 4 · +3.32 → +3.29 | −5,893 → −5,872 | 186/206 → 183/206 |
| Krause, CHI | −2,864 | +1.35 → +1.14 | 2.69 → 2.50 · 6 · +3.31 → +3.50 | +3,523 → +2,613 | 4/23 → 6/28 |
| Presti, OKC | +6,912 | +1.91 → +2.12 | 2.06 → 2.17 · 1 · −1.06 → −1.17 | +15,997 → +17,070 | 2/2 → 1/1 |
| Pat Riley, MIA | +2,429 | +0.62 → +1.10 | 1.71 → 2.20 · 3 · +1.29 → +0.80 | +5,369 → +7,710 | 14/13 → 7/6 |
| Myers, GSW | −97 | +0.57 → +0.86 | 1.73 → 2.11 · 4 · +2.27 → +1.89 | +2,622 → +4,008 | 16/28 → 10/20 |
| Harrison, DAL | +344 | −0.04 → −0.05 | 0.01 → 0.02 · 0 | +138 → +123 | |
| Pelinka, LAL | +2,424 | +0.07 → +0.09 | 0.08 → 0.10 · 1 · +0.92 → +0.90 | +2,734 → +2,855 | |

- **The default λ** is now one title = 4,785 points (about 151 wins); points and titles correlate at 0.63.
- **Blend, top 10:** Presti, Popovich, Auerbach, Whitsitt, West, Pat Riley, Stevens, Larry Riley, Brian Wright, Hammond.
- **Expected titles added, top 10:** Presti 2.12, Popovich 2.04, Horst 1.20, Auerbach 1.19, Stevens 1.17, Krause 1.14, Pat Riley 1.10, West 1.06, Whitsitt 0.99, Myers 0.86.
