# GM Savant: the 30% luck share, "left in free agency", and the early-season luck data — report

Branch `gm-savant`, not pushed, merged or deployed. GM Savant waits for the Contract tab's salaries before launch. Nothing was fetched from Basketball-Reference.

The full rebuild ran alone from the ledger, every step under 0.62 GB. Every check passes: points conservation, titles conservation, pipeline tests, both leakage tests, page 11/11, tap walk 24/24, connector 20/20, coverage, Data Room.

## 1. f = 0.3, adopted for GM Savant

**What changed:**
- Production now counts 30% of the opponents' shooting luck: margin + 0.3 × luck, defined once as `luck.LUCK_SHARE`.
- The title model's regular season uses the same strength, so "the same strength the points use" still holds.
- The playoffs stay on the raw margin.
- Value per margin point refits from 60.1 to 57.1.

**What did not change:**
- The stored luck term in `luck_margins.json` is the full one, and nothing else on the site reads it differently.
- The method note and the production explainer now say 30% and why.

**How much it moves.** The median spell moves 38 points and 2 ranks; 18 of 207 move 10 places or more. The biggest movers:

| spell | before | now | rank |
|---|---|---|---|
| Danny Ainge, BOS 2003–21 | +982 | +1,653 | 40th → 30th |
| Monte McNair, SAC 2020–25 | −707 | −1,117 | 126th → 151st |
| Koby Altman, CLE 2017– | +357 | −39 | 62nd → 87th |
| Brian Wright, SAS 2019– | +3,991 | +3,650 | stays 7th |
| Wayne Embry, CLE 1986–99 | −349 | −628 | 103rd → 122nd |
| Kevin O'Connor, UTA 1999–2012 | −1,473 | −1,735 | 175th → 188th |

**Points, top 15** (rank, was): 1 Presti +7,089 (1) · 2 Popovich +6,372 (2) · 3 Layden +4,677 (3) · 4 Whitsitt +4,385 (4) · 5 Connelly, DEN +4,258 (6) · 6 Auerbach +4,154 (5) · 7 Brian Wright +3,650 (7) · 8 Larry Riley +3,544 (8) · 9 Bryan Colangelo, PHO +3,329 (9) · 10 Don Nelson, DAL +2,962 (12) · 11 Inman +2,957 (10) · 12 Don Nelson, MIL +2,945 (11) · 13 West, LAL +2,874 (14) · 14 Pat Williams, ORL +2,706 (13) · 15 Hammond +2,656 (15).

**Points, bottom 15:** 207 Baylor −6,776 (207) · 206 Kupchak, LAL −4,647 (206) · 205 Sund −3,008 (205) · 204 Krause −2,746 (204) · 203 Walker −2,640 (203) · 202 Volk −2,628 (201) · 201 West, MEM −2,624 (202) · 200 Grunfeld −2,609 (199) · 199 Gabriel −2,281 (200) · 198 Perry −2,225 (198) · 197 Doc Rivers, LAC −2,013 (197) · 196 Cho −1,996 (192) · 195 Twardzik −1,908 (195) · 194 Harris, MIL −1,890 (193) · 193 Bower −1,868 (196).

**Blended, top 15:** 1 Presti +17,342 (1) · 2 Popovich +16,481 (2) · 3 Whitsitt +9,059 (3) · 4 Stevens +9,017 (5) · 5 West, LAL +8,653 (6) · 6 Auerbach +8,644 (4) · 7 Larry Riley +7,606 (7) · 8 Ainge +6,580 (10) · 9 Brian Wright +6,526 (8) · 10 Sharman +6,176 (9) · 11 Pat Riley +5,439 (11) · 12 Don Nelson, DAL +5,437 (12) · 13 Hammond +4,934 (13) · 14 Myers +4,798 (16) · 15 Layden +4,763 (15).

**Blended, bottom 15:** 207 Baylor (207) · 206 Kupchak, LAL (206) · 205 Grunfeld (205) · 204 Ferry (204) · 203 Sund (203) · 202 West, MEM (201) · 201 Volk (199) · 200 Babcock (200) · 199 Gabriel (202) · 198 Walker (198) · 197 Cho (197) · 196 Bob Bass (192) · 195 Kevin O'Connor (183) · 194 Perry (193) · 193 Axelson (196).

**Showcase GMs:**

| | points (rank) | expected titles added | blended (rank) |
|---|---|---|---|
| Kupchak, LAL | −4,841 → −4,647 (206 → 206) | −0.14 → −0.12 | −5,494 → −5,210 (206 → 206) |
| Krause, CHI | −2,864 → −2,746 (204 → 204) | +1.34 → +1.39 | +3,426 → +3,685 (24 → 23) |
| Presti, OKC | +6,912 → +7,089 (1 → 1) | +2.16 → +2.21 | +17,065 → +17,342 (1 → 1) |
| Pat Riley, MIA | +2,429 → +2,396 (17 → 19) | +0.66 → +0.66 | +5,527 → +5,439 (11 → 11) |
| Myers, GSW | −97 → +72 (90 → 82) | +0.98 → +1.02 | +4,525 → +4,798 (16 → 14) |
| Popovich, SAS | +6,242 → +6,372 (2 → 2) | +2.18 → +2.18 | +16,482 → +16,481 (2 → 2) |

**Effects on the title model and the blend:**
- **Title calibration is essentially unchanged.** Brier is 0.0251 (37.5% better than "best record wins"). Teams given 15–30% won 11 titles against 13.5 expected; teams above 30% won 17 against 16.8.
- **The default exchange rate** is now one title = 4,637 points; points and titles correlate at 0.62.

## 2. "Left in free agency"

The 4,702 decisions that were "let walk" are now "left in free agency", everywhere: the page's log and its filter, decision labels, the Data Room's type column and its definition, and the connector's type list. They stay in every total.

Decision ids are unchanged: the id still hashes the old name, so all 32,492 ids match the previous build. A new explainer on those rows says the decision is dated when his rights ended and counts what he went on to produce. It also says we cannot see whether the team made an offer, or whether he would have taken it, so it is not called a choice to let him walk. The Contract tab's expiry dates and salaries will settle both.

## 3. The 1979-80 to 1984-85 luck data

**The points' luck adjustment never used those game logs.**
- **Where the luck term comes from:** `luck.py` reads each season's opponent totals (three-pointers, free throws, attempts) from Basketball-Reference's league page, cached since Module 4.
- **What the NBA game logs supply:** only scoring margins, and their points are right. For 1979-80 to 1986-87, every team's margin matches Basketball-Reference's points-for minus points-against per game within 0.1.
- **The early luck terms look normal:** they sit in a −1.4 to +1.1 range, like later seasons.

So no change was needed, and no season is marked unavailable. Only the second-half test in `luck_study.py` reads the game logs' shooting counts, and it already skips those six seasons.
