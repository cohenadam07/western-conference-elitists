# GM Savant titles: playoff strength and diminishing returns — report

Branch `gm-savant`, not pushed, merged or deployed. Nothing was fetched from Basketball-Reference.

The full rebuild ran alone from the ledger, every step under 0.66 GB, 19 GB free. Every check passes: points conservation, titles conservation, pipeline tests, both leakage tests (the playoff weights included), page 11/11, tap walk 24/24, connector 20/20, coverage, Data Room. Points, including the headline's luck adjustment, are unchanged.

## 1. Playoff strength

Six families of playoff strength, each scored out of sample by log score on every season from 1989-90, with each season's weights chosen on the seasons before it (lower is better; the interval is the 95% range of the gain over luck-adjusted alone):

| playoff strength | log score | against luck-adjusted alone |
|---|---|---|
| **raw margin + preseason blend (adopted)** | **1.810** | **−0.168 [−0.336, −0.017]** |
| mix of raw and luck-adjusted + preseason | 1.837 | −0.142 [−0.304, +0.001] |
| raw margin | 1.850 | −0.129 [−0.265, +0.010] |
| mix of raw and luck-adjusted | 1.877 | −0.102 [−0.222, +0.016] |
| luck-adjusted + preseason (last round) | 1.902 | −0.077 [−0.189, +0.026] |
| luck-adjusted (the first model) | 1.979 | — |

**Adopted:**
- In the playoffs, a team's strength is its raw margin + w × (its opening-night projection on the margin scale − its raw margin).
- Each season's w comes from the seasons before it; it is 0.25 in recent seasons.
- Where the mix was allowed to choose, it moved between 25% and 100% raw over the years and settles on 100% in recent seasons.
- The regular season, and so the seeding, is still played from the luck-adjusted rating.

**Calibration after**, every season from 1983-84 (teams · expected titles · titles won):

| title chance | first model | last round | now |
|---|---|---|---|
| 0–2% | 940 · 2.0 · 4 | 941 · 2.1 · 3 | 956 · 1.9 · 3 |
| 2–5% | 90 · 2.9 · 3 | 91 · 3.1 · 5 | 72 · 2.3 · 3 |
| 5–15% | 98 · 8.8 · 12 | 94 · 8.6 · 9 | 96 · 8.6 · 9 |
| 15–30% | 56 · 12.0 · 5 | 60 · 12.7 · 7 | 64 · 14.2 · 11 |
| 30%+ | 39 · 17.3 · 19 | 37 · 16.6 · 19 | 35 · 16.0 · 17 |
| Brier | 0.0266 | 0.0259 | 0.0251 |
| log score (43 seasons) | 1.883 | 1.809 | 1.721 |

Against "best record wins", the Brier score is now 37% better (it was 34%). The 15–30% tier is close now (11 won against 14.2 expected), and every bucket is within about one title of its expectation except that one.

**Your cases:**

| team | title chance before | now |
|---|---|---|
| 2009-10 Lakers | 1.2% | 4.0% |
| 2001-02 Lakers | 14% | 22% |
| 2008-09 Lakers | 13% | 24% |
| 2000-01 Lakers | 2.5% | 1.8% |

The 2000-01 Lakers went down because both their raw margin and their preseason projection were below their luck-adjusted rating. Kupchak's expected titles go from 0.68 to 0.81, so most of his four titles are still playoff luck (+3.19).

**For a separate test later: is the luck adjustment too strong in general?** This result suggests it may be. Raw margin predicted the playoffs better than luck-adjusted in every family. The luck term treats all of an opponent's three-point and free-throw shooting against the league average as luck, but part of it is likely real defense, which the adjustment then removes.
- **The test:** does luck-adjusted margin predict a team's next season, or its second half from its first, better than raw margin? Separately, how much of opponent 3P% repeats within a season?
- **Why it matters:** the points headline uses the full adjustment (60 value points per margin point), so a weaker adjustment would move GM Value Added. I have not changed it.

## 2. Diminishing returns in the with-minus-without

**The data test: yes.** Across 1,314 team-seasons, I compared a team's luck-adjusted margin with its players' value above the league average:

| team value (vs league, value points) | margin per 100 value points |
|---|---|
| −920 to −240 | 1.11 |
| −240 to 0 | 1.34 |
| 0 to +230 | 0.90 |
| +230 to +410 | 0.55 |
| strongest tenth (+410 to +1,120) | 0.58 |

More value on an already strong team buys less margin. Out of sample (each season from 1990 predicted from fits on the seasons before it), a quadratic beat a straight line: squared error −0.14 per team, 95% −0.22 to −0.06. A kink at average also beat the line (−0.12), but by less. Raw margin shows the same bend.

**What else it exposed.** The old with-minus-without converted value to margin at 1.66 margin points per 100 value points, the inverse of the value-on-margin slope behind the points. The fitted curve gives about 1.1 on average and 0.55 at the top, so contenders' losses were inflated by up to three times, before any curvature. That conversion only fed decision titles; the points use their own scale and are unchanged.

**Applied:** in every season, the team moves along that season's quadratic (fit on earlier seasons only), held flat past its peak, in both directions.

**The "without" side** (`titles_study2.py`). Is a traded player's production on his new team a fair stand-in for his old role? Across 7,086 player-seasons after trades, his value against his at-the-time projection moves +0.70 value points per margin point of difference between the new team and the old (se 0.10). That is about ±3 points a season, against a star's 300–500. The direction is also confounded: a player who outperforms raises his new team's rating. It doesn't test better, so realized production stays as the "without", since it carries real health and aging. For seasons ahead, the projected title curve is fit directly on projected value, so it already carries whatever diminishing return there is.

## The new top 10 by title impact (as it turned out; before → now)

Losses:

| | decision | credited | points | titles |
|---|---|---|---|---|
| 1 | 1979 Lakers trade Adrian Dantley for Spencer Haywood | Bill Sharman | −2,299 | −3.94 → **−1.48** |
| 2 | 2012 Thunder trade James Harden to Houston | Sam Presti | −2,935 | −3.49 → **−1.41** (at the time −0.40) |
| 3 | 2004 Mavericks let Steve Nash walk | Don and Donn Nelson | −1,988 | −2.41 → **−1.18** |
| 4 | 1999 Lakers trade for Glen Rice | Jerry West | −1,913 | −2.39 → **−1.15** |
| 5 | 1984 Blazers trade for Kiki Vandeweghe | Stu Inman | −1,788 | −2.48 → **−0.93** |
| 6 | 2011 Spurs draft Ádám Hanga (against the board) | Buford, Popovich | −1,126 | −1.75 → **−0.90** |
| 7 | 1996 Magic let Shaquille O'Neal walk | Gabriel, Pat Williams | −2,816 | −2.06 → **−0.81** |
| 8 | 1992 Jazz trade for Jay Humphries and Larry Krystkowiak | Scott Layden | −1,425 | −1.76 → **−0.81** |
| 9 | 1994 Lakers trade Doug Christie to New York | Jerry West | −1,361 | −1.73 → **−0.76** |
| 10 | 2012 Warriors draft Harrison Barnes (against the board) | Bob Myers | −1,319 | −1.80 → **−0.76** |

Gains:

| | decision | credited | points | titles |
|---|---|---|---|---|
| 1 | 2021 Thunder extend Shai Gilgeous-Alexander | Presti | +3,379 | +1.43 → **+1.19** |
| 2 | 2009 Warriors draft Stephen Curry | Larry Riley | +3,043 | +1.46 → **+1.16** |
| 3 | 2002 Spurs re-sign Manu Ginóbili | Buford, Popovich | +2,108 | +1.29 → **+1.08** |
| 4 | 2019 Thunder trade for Gilgeous-Alexander | Presti | +2,586 | +1.28 → **+1.05** |
| 5 | 2004 Spurs re-sign Ginóbili | Buford, Popovich | +2,155 | +1.26 → **+1.02** |
| 6 | 2016 Bucks re-sign Giannis Antetokounmpo | Hammond | +3,346 | +1.46 → **+0.95** |
| 7 | 2010 LeBron James to Miami (sign-and-trade) | Pat Riley | +3,478 | +1.33 → **+0.95** |
| 8 | 2018 Bucks hire Mike Budenholzer | Horst | +1,525 | +1.43 → **+0.93** |
| 9 | 1987 Bulls draft Scottie Pippen | Krause | +1,693 | +1.33 → **+0.93** |
| 10 | 1997 Spurs draft Tim Duncan | Popovich | +1,470 | +1.09 → **+0.90** |

The biggest loss and the biggest gain are now the same size (−1.48 and +1.19), where before the losses ran three times larger.

**The Luka trades** (points · titles; before → now):

| | at the time | as it turned out |
|---|---|---|
| Dallas, Feb 2025 (Harrison) | −1,099 · −0.065 → **−0.073** | −1,978 · −0.069 → **−0.068** |
| Lakers, Feb 2025 (Pelinka) | +949 · +0.022 → **+0.024** | +2,013 · +0.125 → **+0.127** |
| Dallas, 2018 draft night (Donn Nelson) | −156 · −0.004 → **−0.004** | −176 · −0.032 → **−0.019** |
| Atlanta, 2018 draft night (Schlenk) | +156 · +0.003 → **+0.004** | +176 · +0.013 → **+0.004** |

The 2025 trade barely moves. Dallas and the Lakers sat in the middle of the curve, where the bend is small, and most of the seasons ahead are on the projected curve.

## The showcase GMs (first model → last round → now)

| | expected titles added | expected titles | playoff luck | blended | rank now (titles / blend, of 207) |
|---|---|---|---|---|---|
| Kupchak, LAL | −0.22 → −0.22 → −0.14 | 0.68 → 0.71 → 0.81 | +3.32 → +3.29 → +3.19 | −5,893 → −5,872 → −5,494 | 155 / 206 |
| Krause, CHI | +1.35 → +1.14 → +1.34 | 2.69 → 2.50 → 2.63 | +3.31 → +3.50 → +3.37 | +3,523 → +2,613 → +3,426 | 4 / 24 |
| Presti, OKC | +1.91 → +2.12 → +2.16 | 2.06 → 2.17 → 2.19 | −1.06 → −1.17 → −1.19 | +15,997 → +17,070 → +17,065 | 2 / 1 |
| Pat Riley, MIA | +0.62 → +1.10 → +0.66 | 1.71 → 2.20 → 1.76 | +1.29 → +0.80 → +1.24 | +5,369 → +7,710 → +5,527 | 13 / 11 |
| Myers, GSW | +0.57 → +0.86 → +0.98 | 1.73 → 2.11 → 2.32 | +2.27 → +1.89 → +1.68 | +2,622 → +4,008 → +4,525 | 8 / 16 |

- **The default λ** is now one title = 4,701 points (about 148 wins); points and titles correlate at 0.62.
- **Expected titles added, top 10:** Popovich 2.18, Presti 2.16, Stevens 1.44, Krause 1.34, West 1.18, Ainge 1.03, Whitsitt 1.00, Myers 0.98, Auerbach 0.98, Sharman 0.86.
- **Blend, top 10:** Presti, Popovich, Whitsitt, Auerbach, Stevens, West, Larry Riley, Brian Wright, Sharman, Ainge.
