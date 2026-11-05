# The standing college test

Thirty questions a college GM's staff would ask, put to a fresh assistant with only the `cbb_`
tools on Nov 5, 2026. Re-run them the same way after any connector change; the ones a single call
should answer are held by `questions.mjs` (part of `npm run check:savant-cbb`).

Blind run, Nov 5, 2026, before connector 3.4.0: 9 full, 19 partial, 2 none.

| # | Question | Before 3.4.0 | Held by |
|---|---|---|---|
| 1 | Rank the SEC by adjusted defense last season | partial: no conference filter | Q1 |
| 2 | Which high-major teams were worst at defensive rebounding? | partial: no drb sort or level | Q2 |
| 3 | Top 10 high-major bigs by defensive rebound % | partial: no level filter | Q3 |
| 4 | Which transfers this season were the best value players last season? | partial: no transfer filter | Q4 |
| 5 | Best 3-point shooting guards with 150+ attempts | none: no attempts minimum | Q5 |
| 6 | Closest comps for Duke Brennan's 2025-26 | full | Q6 |
| 7 | Oklahoma's best five-man lineup, luck-adjusted | full | |
| 8 | Villanova with Duke Brennan on vs off | full, but units unfiltered | Q8 |
| 9 | Oklahoma's schedule for the rest of November | none: no schedule | Q9 |
| 10 | Scout Texas: best units, four factors, what the defense allows | full | Q10 |
| 11 | Pop Isaacs's game log with opponent names | partial: ids, no year | Q11 |
| 12 | Derrion Reid vs top-50 teams and by Quad | full | |
| 13 | Freshmen with the highest Savant value | partial: no class filter | Q13 |
| 14 | Compare B.J. Edwards and Silas Demary Jr. | full (two calls) | |
| 15 | Who led D1 in RAPM last season? | full | |
| 16 | What is Savant value? | full | Q16 |
| 17 | Luckiest and unluckiest teams | partial: luck undefined | Q17 |
| 18 | Best rim protectors among bigs with 1,000+ possessions | full | |
| 19 | Oklahoma's 2026-27 opener box score | full | Q19 |
| 20 | Conference with the most top-50 teams | full (by hand) | Q20 |
| 21 | Grand Canyon vs Villanova schedule strength | full (ranks by hand) | |
| 22 | Khani Rooths's career and adjustment confidence each season | partial: four calls | |
| 23 | Fastest pace | full | |
| 24 | Every Oklahoma game with opponent, score and Quad | partial: no per-game Quad | Q24 |
| 25 | Best returning SEC players | partial: no returning filter | Q25 |
| 26 | Tyler Hendricks's shooting, UCF to Utah Valley | full (three calls) | |
| 27 | Teams that shoot and allow the most threes | partial: unlabelled fields | |
| 28 | Florida's four factors with D1 ranks | full | Q28 |
| 29 | Oklahoma's closest losses last season | full | |
| 30 | Anything on NIL, portal entry dates or recruiting rank? | partial: recruiting only | |

Still open after 3.4.0: per-game Quad and opponent rank in game logs (24), adjustment confidence in
careers (22), a compare tool (14), NIL and portal dates (30, no data source).
