# All-Savant Team by the NBA's positional rules: test (Nov 19, 2026, report only)

`test_shape.py` (run from ~/Basketball-Savant with the value export) recomputes every season's teams.
Rules tested: through 2022-23, 2 guards / 2 forwards / 1 center, eligibility where a position group's
share of his minutes (Basketball Reference's 5-position estimate, 1996-97 on) is >= 30%, else BR's
listed position (before 1996-97, and the 4% of later player-seasons without an estimate); each team
maximizes total Savant value over its slots, 1st team first. 2023-24 on: top five by value.

| | real 1st/2nd | any All-NBA |
|---|---|---|
| Today (2 guards / 2 wings / 1 big) | 60.3% | 71.3% |
| Proposed, 30% cutoff | 60.8% | 73.4% |
| cutoff 20 / 25 / 35 / 40 / 50% | 61.1 / 61.1 / 61.8 / 61.6 / 62.1 | 74.2 / 73.7 / 74.2 / 73.9 / 74.2 |
| largest share only | 62.1% | 73.9% |
| 30%, positional in every season | 60.8% | 72.6% |

38 seasons, 1988-89 to 2025-26 (380 places). Honour changes at 30%: honour_changes_30.json
(16 of 47 seasons, 46 places). Dual eligibility: 1,167 of 11,800 qualified player-seasons (9.9%);
15 of 440 places filled by a dual-eligible player at his secondary position.
65 games from 2023-24: 2023-24 none, 2024-25 two picks (Dončić 50 gp, Butler 55), 2025-26 three
(Dončić 64, Wembanyama 64, Giannis 36).

`screens/`: the landing page's All-Savant Team for 2010-11 and 2025-26, 1st and 2nd team, from the local production
build of 2.9.0 (Nov 22, 2026). Headshots show as initials because the NBA's image host refuses headless Chromium. Taken
before the 2023-24-on subtitle gained "No 65-game minimum: missed games already cost value."
