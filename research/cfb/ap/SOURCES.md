# AP All-America teams, 2014-2025: sources

Collected 2026-11-10 from news coverage carrying the Associated Press list. One article per
season; every row's `source_url` is the article it was read from. Nothing was filled in from
memory, Wikipedia, sports-reference, stats.ncaa.org or PFF.

All 12 seasons have complete first, second and third teams. Nothing is missing.

## Per season

| season | rows 1st / 2nd / 3rd | outlet | article |
|---|---|---|---|
| 2014 | 25 / 25 / 25 | Heavy.com (reprints the AP list) | https://heavy.com/sports/2014/12/ap-all-america-team-list-marcus-mariota-amari-cooper-melvin-gordon/ |
| 2015 | 25 / 25 / 25 | Sports Illustrated (SI Wire, "2015 AP All-America Teams") | https://www.si.com/college/2015/12/13/2015-ap-all-america-teams |
| 2016 | 25 / 25 / 25 | WXMI Fox 17 (AP wire story) | https://www.fox17online.com/2016/12/12/peppers-lewis-and-davis-all-earn-ap-all-american-honors |
| 2017 | 25 / 25 / 25 | Fox Sports (AP wire story) | https://www.foxsports.com/stories/other/five-badgers-named-ap-all-americans-t-j-edwards-selected-to-1st-team |
| 2018 | 25 / 25 / 25 | WEWS News 5 Cleveland (AP wire list) | https://www.news5cleveland.com/sports/2018-ap-all-america-team-list |
| 2019 | 25 / 25 / 25 | WSLS (AP wire story) | https://www.wsls.com/sports/2019/12/16/ap-all-america-teams-dominated-by-lsu-ohio-state/ |
| 2020 | 25 / 25 / 25 | WJXT News4JAX (AP wire story) | https://www.news4jax.com/sports/2020/12/28/alabamas-jones-smith-harris-lead-6-tide-ap-all-americans |
| 2021 | 27 / 27 / 27 | WJXT News4JAX (AP wire story) | https://www.news4jax.com/sports/2021/12/13/ap-all-america-team-young-and-tide-lead-with-3-1st-teamers/ |
| 2022 | 27 / 27 / 27 | KSAT (AP wire story) | https://www.ksat.com/sports/2022/12/12/uscs-williams-alabamas-anderson-lead-ap-all-america-team/ |
| 2023 | 27 / 27 / 27 | WJXT News4JAX (AP wire story) | https://www.news4jax.com/sports/2023/12/11/the-ap-all-america-team-is-loaded-with-5th-and-6th-year-players-including-lsus-heisman-winning-qb/ |
| 2024 | 27 / 29 / 28 | WJXT News4JAX (AP wire story) | https://www.news4jax.com/sports/2024/12/16/ap-all-america-team-travis-hunter-xavier-watts-back-on-first-team-ashton-jeanty-is-unanimous-pick/ |
| 2025 | 27 / 27 / 27 | WJXT News4JAX (AP wire story) | https://www.news4jax.com/sports/2025/12/15/big-ten-puts-10-on-ap-all-america-first-team-led-by-4-from-ohio-state-and-hoosier-star-mendoza/ |

Team size changed in 2021: through 2020 the AP named 2 wide receivers and no extra defensive
back (25 per team); from 2021 it names 3 wide receivers and a "defensive back" (27 per team).

## Things to know before using the rows

- **2024 has ties.** Second team lists three guards (Booker, Jackson, Fairchild) and two
  kickers (Zvada, Raynor); third team lists four wide receivers. That is why it is 29 and 28.
- **2024 Travis Hunter appears three times** as printed: first-team AP (all-purpose),
  first-team CB, second-team WR.
- **2014 and 2015 are not straight wire copies.** 2014 is Heavy.com's reprint of the AP list
  and 2015 is SI Wire's; both say the list is the AP team and both are complete, but neither
  was cross-checked against a second copy (the Star Tribune's 2014 AP list returned HTTP 429).
  2016-2025 are AP wire stories as carried by the outlet.
- **The on3 2025 starting-point URL returned HTTP 403** and was not used; News4JAX alone
  covers 2025.

## Normalisation applied

- Position labels: Quarterback QB, Running back RB, Tackle (offense) OT, Guard OG, Center C,
  Tight end TE, Wide receiver / Receiver WR, All-purpose (player) AP, Kicker K, End DE,
  Edge rusher EDGE, Tackle (defense) DT, **Interior lineman DT** (2023-2025),
  **Linemen DL** (2021 only, as printed), Linebacker LB, Cornerback CB, Safety S,
  Defensive back DB, Punter P.
- AP switched from "Ends" (DE, 2014-2020) to "Edge rushers" (EDGE, 2021 on).
- Typographic apostrophes were changed to ASCII `'`. The 2024 unanimous marker `u-` in front
  of Ashton Jeanty was dropped. Heavy.com's "(highlights below)" notes were dropped.
- Names and schools are otherwise as printed, so school spellings vary between seasons
  (Pitt / Pittsburgh, Southern Cal / Southern California, UConn / Connecticut,
  UCF / Central Florida, Mississippi for Ole Miss, Louisiana-Lafayette).
- Wire formatting slips repaired so the line could be parsed, without changing any name:
  2021 third-team tackles (a comma where a semicolon belonged between Galvin and Mitchell);
  2022 third-team RB Abanikanda (semicolon before the school); 2024 "Tennessee; junior",
  "Florida State., senior", and the three "and"-joined ties above; 2015 third-team punter,
  which SI ran onto the end of the safeties line.

## Spellings that look like source typos (left as printed, not verified)

These may not match other data sets on a name join:

- 2015 third-team K "Adam Schneider", Oregon
- 2017 third-team K "Eddy Piniero", Florida; third-team P "Mitch Wisnowsky", Utah;
  first-team DE "Bradley Chubb", North Carolina State
- 2018 second-team OG "Michael Dieter", Wisconsin
- 2019 second-team WR "Devonta Smith" (printed "DeVonta" in 2020); first-team CB
  "Derek Stingley" without the Jr. used elsewhere
- 2020 second-team DE "Jaelen Phillips", Miami
- 2021 first-team LB "Will Anderson, Jr." (comma, so the field is quoted)
- 2023 first-team DT "Jer'Zahn Newton", Illinois (printed "Jer'Zhan" in 2022)
