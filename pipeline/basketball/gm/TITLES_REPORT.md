# GM Savant 1.1.0: playoffs and championships — report

Branch `gm-savant`, not pushed, merged or deployed. Points (GM Value Added) are unchanged in all 291 spells. Every check passes: points conservation, the titles conservation, the pipeline tests, the grade leakage test, the new title leakage test, the page checks (11/11), the 375px tap walk (24/24), the connector (20/20, under the 90,000-character cap), coverage and the Data Room. The full rebuild ran alone from the ledger in under 7 minutes, every step under 0.61 GB, 20 GB free throughout.

## 1. The title model and its checks

**What it does.** Every season from 1979-80 to 2025-26 is replayed 10,000 times:
- the real regular-season schedule, game by game, from each team's luck-adjusted margin (the strength the points use);
- standings, then seeds by that era's rules;
- the play-in, a fixed bracket, and series of that era's length and home pattern.

Each team's title chance is the share of replays it wins.

**Win probability per game** is logistic in the rating difference plus home court. It is fit on playoff games for the playoffs and regular-season games for the regular season. Each season uses fits on earlier seasons only; the first four seasons are in sample and are left out of calibration.

**Where the format comes from:**
- **Read from the games:** series lengths (first round best-of-3 to 1982-83, best-of-5 to 2001-02, then best-of-7), each round's home pattern (2-3-2 Finals 1985-2013, otherwise 2-2-1-1-1), and 6 or 8 teams per conference.
- **Home court:** the better record hosted Game 1 in all 655 series whose two records differed, in every era, so the simulation gives home court to the better record. The build fails if that ever stops being true.
- **Seeding rules** (division winners' guaranteed seeds, byes, the play-in) come from the NBA playoffs article, with each rule's sentence and link stored in the output. Applied to the real standings, they reproduce the real first-round matchups in all 47 seasons.
- **The 2020 bubble** is neutral-site, with its 8-v-9 play-in rule.

**Checks:**
- The chances add up to 1 in every season, exactly.
- **Calibration, out of sample** (predicted titles against actual, by bucket):

| title chance | team-seasons | expected titles | titles won |
|---|---|---|---|
| 0–1% | 868 | 0.9 | 1 |
| 1–5% | 162 | 4.0 | 6 |
| 5–15% | 98 | 8.8 | 12 |
| 15–30% | 56 | 12.0 | 5 |
| 30–50% | 28 | 10.6 | 12 |
| 50%+ | 11 | 6.7 | 7 |

- **Brier score** 0.0266, against 0.0401 for "best record wins" (34% better) and 0.0339 for "every team alike". The favourite won 20 of 43 seasons.
- The one weak spot is the 15–30% bucket (5 titles against 12 expected). I tested whether a team's playoff strength strays from its rating for the whole run (one draw per team per replay, the size fit by maximum likelihood on earlier series). The data barely pin it down: the best value is about 1.5 margin points, and title Brier is flat from 0 to 1.5. It stays in, fit on earlier seasons only, so it cannot leak. The bucket is most likely chance (56 team-seasons).

**Future seasons.** A curve of title chance against projected strength relative to the league, fit from history on the point-in-time snapshots:
- one per horizon (0 to 9 seasons ahead) and per point in the year (July 15, opening night, this calendar day, February 1);
- each version fit only on seasons finished before it;
- in season, the margin so far is a second input: it is known on the day and cut the February Brier from 0.0319 to 0.0286.

Projections say little about titles beyond two seasons (correlation with the realized chance 0.42 a season ahead, 0.09 at three, about 0 at five), so the curves flatten there. Same 10-season horizon and 5% discount as the points.

**Leakage.** `titles.py leakage` deletes every season from Y on (Y = 1990, 2000, 2010, 2020, 2026) and recomputes the game fits, the playoff noise, every earlier title chance and the curves. There are 0 mismatches. The grade leakage test still passes too.

## 2. Do playoffs reward top-heavy rosters?

**No.** I added the difference in the top 8 players' share of team value to each playoff game's model, beside the rating difference and home court. Every season from 1990 was predicted from fits on the seasons before it:
- **Top 8:** log-likelihood −2.34 over 37 seasons (95% interval −6.32 to +0.87; 3,603 games); coefficient −0.07 (se 0.14).
- **Top 7:** −2.51 (−7.00 to +1.22).

It made predictions slightly worse, so it is not used. The title model has one input, so the simple split is exact, and no Shapley step was needed.

## 3. The default λ, in plain terms

**One title = 4,746 points, about 150 wins** (at 31.7 points a win). At that rate, points and expected titles each account for half of the spread across all 291 GM spells (λ = sd of points ÷ sd of expected titles added, 1,454 ÷ 0.306; 4,678 on ranked spells only). The two correlate at 0.61, so the blend mostly agrees with the points. It moves the GMs whose teams were in position to win titles (Krause, Horst, Myers) and the ones who built value that never contended (Layden, Whitsitt).

## 4. Top and bottom 15

Columns: expected titles added | titles won | expected titles | playoff luck | points | blended. Ranked spells: 207 all-time, 28 active. The active top and bottom 15 overlap, since there are only 28.

### By expected titles added, all-time
| | GM | spell | xTA | won | exp | luck | points | blended |
|---|---|---|---|---|---|---|---|---|
| 1 | Gregg Popovich | SAS 1994–2019 | +2.46 | 3.0 | 2.39 | +0.61 | +6,242 | +17,933 |
| 2 | Sam Presti | OKC 2007–now | +1.91 | 1.0 | 2.06 | −1.06 | +6,912 | +15,997 |
| 3 | Jon Horst | MIL 2017–now | +1.35 | 1.0 | 1.87 | −0.87 | −707 | +5,684 |
| 4 | Jerry Krause | CHI 1985–2003 | +1.35 | 6.0 | 2.69 | +3.31 | −2,864 | +3,523 |
| 5 | Brad Stevens | BOS 2021–now | +1.26 | 1.0 | 1.25 | −0.25 | +1,911 | +7,894 |
| 6 | Red Auerbach | BOS 1979–1984 | +1.04 | 2.0 | 1.46 | +0.54 | +4,336 | +9,283 |
| 7 | Jerry West | LAL 1982–2000 | +0.99 | 4.0 | 2.76 | +1.24 | +2,725 | +7,405 |
| 8 | John Hammond | MIL 2008–2017 | +0.83 | 0.0 | 0.01 | −0.01 | +2,629 | +6,572 |
| 9 | Bill Sharman | LAL 1979–1982 | +0.77 | 2.0 | 0.40 | +1.59 | +2,176 | +5,811 |
| 10 | Danny Ainge | BOS 2003–2021 | +0.73 | 1.0 | 0.71 | +0.29 | +982 | +4,456 |
| 11 | R.C. Buford | SAS 2002–2019 | +0.73 | 2.0 | 1.52 | +0.48 | +1,613 | +5,065 |
| 12 | Bob Whitsitt | OKC 1986–1994 | +0.72 | 0.0 | 0.94 | −0.94 | +4,502 | +7,923 |
| 13 | Larry Riley | GSW 2009–2012 | +0.68 | 0.0 | 0.00 | 0.00 | +3,620 | +6,840 |
| 14 | Pat Riley | MIA 1995–now | +0.62 | 3.0 | 1.71 | +1.29 | +2,429 | +5,369 |
| 15 | Brian Wright | SAS 2019–now | +0.59 | 0.0 | 0.12 | −0.12 | +3,991 | +6,782 |

| | bottom | spell | xTA | won | exp | luck | points | blended |
|---|---|---|---|---|---|---|---|---|
| 1 | Elgin Baylor | LAC 1986–2008 | −0.74 | 0.0 | 0.00 | 0.00 | −6,905 | −10,441 |
| 2 | Ernie Grunfeld | WAS 2003–2019 | −0.50 | 0.0 | 0.05 | −0.05 | −2,412 | −4,797 |
| 3 | Bob Ferry | WAS 1979–1990 | −0.46 | 0.0 | 0.01 | −0.01 | −1,540 | −3,738 |
| 4 | Pete Babcock | ATL 1990–2003 | −0.40 | 0.0 | 0.09 | −0.09 | −1,369 | −3,256 |
| 5 | Ray Patterson | HOU 1979–1989 | −0.39 | 0.0 | 0.04 | −0.04 | +1,338 | −490 |
| 6 | Kevin McHale | MIN 1995–2008 | −0.35 | 0.0 | 0.17 | −0.17 | −335 | −2,009 |
| 7 | Norm Sonju | DAL 1980–1996 | −0.34 | 0.0 | 0.22 | −0.22 | −773 | −2,409 |
| 8 | Jeff Weltman | ORL 2017–now | −0.30 | 0.0 | 0.00 | 0.00 | −1,287 | −2,711 |
| 9 | Al Attles | GSW 1979–1986 | −0.30 | 0.0 | 0.01 | −0.01 | −1,386 | −2,803 |
| 10 | Carroll Dawson | HOU 1996–2007 | −0.29 | 0.0 | 0.09 | −0.09 | −1,129 | −2,514 |
| 11 | Dell Demps | NOP 2010–2019 | −0.28 | 0.0 | 0.00 | 0.00 | −400 | −1,750 |
| 12 | Kevin Pritchard | IND 2017–now | −0.28 | 0.0 | 0.03 | −0.03 | +1,079 | −252 |
| 13 | Billy King | PHI 1998–2007 | −0.28 | 0.0 | 0.15 | −0.15 | −482 | −1,797 |
| 14 | Lawrence Frank | LAC 2017–now | −0.27 | 0.0 | 0.15 | −0.15 | −610 | −1,901 |
| 15 | Don Nelson | GSW 1987–1995 | −0.27 | 0.0 | 0.01 | −0.01 | −1,126 | −2,400 |

### By blended at the default, all-time
Top: 1 Popovich +17,933 · 2 Presti +15,997 · 3 Auerbach +9,283 · 4 Whitsitt +7,923 · 5 Stevens +7,894 · 6 West (LAL) +7,405 · 7 Larry Riley +6,840 · 8 Brian Wright +6,782 · 9 Hammond +6,572 · 10 Sharman +5,811 · 11 Horst +5,684 · 12 Bryan Colangelo (PHO) +5,397 · 13 Pat Riley +5,369 · 14 Frank Layden +5,131 · 15 Don Nelson (DAL) +5,120.

Bottom: 1 Baylor −10,441 · 2 Kupchak (LAL) −5,893 · 3 Grunfeld −4,797 · 4 Ferry −3,738 · 5 Wally Walker −3,517 · 6 Rick Sund −3,464 · 7 John Gabriel −3,318 · 8 West (MEM) −3,305 · 9 Babcock −3,256 · 10 Jan Volk −3,203 · 11 Joe Axelson −2,854 · 12 Rich Cho −2,808 · 13 Attles −2,803 · 14 Scott Perry −2,774 · 15 Weltman −2,711.

### Active, by expected titles added
Top: Presti +1.91 · Horst +1.35 · Stevens +1.26 · Pat Riley +0.62 · Brian Wright +0.59 · Koby Altman +0.36 · Trajan Langdon +0.23 · Zach Kleiman +0.09 · Rob Pelinka +0.07 · Tim Connelly +0.03 · Leon Rose +0.01 · Bobby Webster −0.01 · Onsi Saleh −0.01 · Ben Tenzer −0.03 · Jonathan Wallace −0.03.

Bottom: Weltman −0.30 · Pritchard −0.28 · Lawrence Frank −0.27 · Sean Marks −0.22 · Joe Dumars −0.16 · Michael Winger −0.15 · Scott Perry −0.13 · Mike Dunleavy −0.12 · Joe Cronin −0.11 · Rafael Stone −0.10 · Brian Gregory −0.04 · Jeff Peterson −0.04 · Austin Ainge −0.04 · Wallace −0.03 · Tenzer −0.03.

### Active, by blended
Top: Presti +15,997 · Stevens +7,894 · Brian Wright +6,782 · Horst +5,684 · Pat Riley +5,369 · Langdon +3,387 · Pelinka +2,734 · Altman +2,062 · Webster +1,006 · Gregory +336 · Dunleavy +300 · Tenzer +27 · Wallace +27 · Marks +19 · Connelly +3.

Bottom: Perry −2,774 · Weltman −2,711 · Winger −2,547 · Dumars −2,540 · Frank −1,901 · Cronin −694 · Saleh −691 · Kleiman −581 · Stone −514 · Austin Ainge −253 · Pritchard −252 · Peterson −196 · Rose −68 · Connelly +3 · Marks +19.

## 5. Showcase cases (points | expected titles | blended)

**The Luka trades** (one decision per team side; at the time, then as it turned out):

| | at the time | as it turned out |
|---|---|---|
| Dallas, Feb 2 2025 (Nico Harrison) | −1,099 · −0.044 · −1,306 | −1,978 · −0.049 · −2,211 |
| Lakers, Feb 2 2025 (Rob Pelinka) | +949 · +0.024 · +1,064 | +2,013 · +0.122 · +2,590 |
| Dallas, 2018 draft night (Donn Nelson) | −156 · −0.003 · −171 | −176 · −0.002 · −187 |
| Atlanta, 2018 draft night (Travis Schlenk) | +156 · +0.003 · +170 | +176 · +0.007 · +209 |

The titles columns are small, and asymmetric, for a reason you should know. The split you specified values each of a decision's points at the title rate of the team the decision left behind. Dallas after the trade was far from a title, so a point there is worth little; the Lakers were closer. That makes the split add up exactly across everything a team did. But it is not the counterfactual "titles Dallas would have won with Luka", which would be larger. The decision explainer says so in plain words.

**The GMs** (headline: as it turned out for finished spells, on projection for active ones; then at the time; rank among 207 ranked spells):

| | points | expected titles added | blended | at the time (pts · titles · blended) | won · expected · luck | rank: points / titles / blended |
|---|---|---|---|---|---|---|
| Mitch Kupchak, LAL 2000–17 | −4,841 | −0.22 | −5,893 | −1,629 · −0.10 · −2,124 | 4.0 · 0.68 · +3.32 | 206 / 186 / 206 |
| Mitch Kupchak, CHA 2018–24 | −337 | −0.14 | −995 | −116 · −0.23 · −1,225 | 0 · 0.00 · 0.00 | |
| Jerry Krause, CHI 1985–2003 | −2,864 | +1.35 | +3,523 | +2,380 · +2.01 · +11,904 | 6.0 · 2.69 · +3.31 | 204 / 4 / 23 |
| Sam Presti, OKC 2007– | +6,912 | +1.91 | +15,997 | (active: the same) | 1.0 · 2.06 · −1.06 | 1 / 2 / 2 |
| Pat Riley, MIA 1995– | +2,429 | +0.62 | +5,369 | (active: the same) | 3.0 · 1.71 · +1.29 | 17 / 14 / 13 |
| Bob Myers, GSW 2012–23 | −97 | +0.57 | +2,622 | +1,183 · +1.38 · +7,744 | 4.0 · 1.73 · +2.27 | 90 / 16 / 28 |

- **Krause** is the clearest case for titles. His teams were above an average team's title chances by +2.02 titles; he inherited 0.69 (mostly Jordan's share); he won 6 against 2.69 expected. Points rank him 204th, titles 4th.
- **Kupchak:** four titles, but the model expected 0.68. His title seasons were rated modestly: the 2000-01 Lakers +3.6 luck-adjusted (2.5% title chance), 2009-10 +3.0 (1.2%). Most of his rings are playoff luck (+3.32), which sits with the luck, not in expected titles added.
- **Myers:** +1.36 while in charge, less 0.83 inherited (Curry and Klay's share of the next decade). Won 4 against 1.73 expected.
- **Presti:** expected 2.06 titles from his teams and won 1 (the luck is against him). His points and titles both rank near the top.

## 6. Conservation for titles

`titles_dec.py` splits each played team-season's expected titles above an average team's (E − 1/N) into:
- its decisions (each one's points that season × the team's secant slope);
- the booked moves;
- the league baseline;
- what player value misses (coaching, fit, defense before 2007-08);
- the average team's shortfall (E0 − 1/N);
- for near-average teams, the gap between derivative and secant.

**Result:** of 1,292 team-seasons (1980-81 to 2025-26), 1,289 add up within 0.001 titles. The largest gap is 0.0115 (IND 2003) and all gaps total 0.0210, against limits of 0.02 and 0.10. The three that miss are the points check's own existing gaps (the namesake cases) times the slope. The check runs in the chain and the nightly, and stops the build if it fails.

**Shapley gap:** not applicable. Part 2 added no second input, so the one-strength Aumann-Shapley split is exact and there is no Shapley comparison to run.

## Where I departed from the spec, and why

1. **The anchor of the split.** An average-strength team's title chance (E0: median 0.03%, 90th percentile 0.26%) is far below 1/N (3.3%), because titles go to the best teams. So the secant from average splits E − E0 exactly; the remaining E0 − 1/N per team-season is "the average team's shortfall". It is the same for every GM in the seat, shown in the conservation check, and counted in the spell's "while he ran it" titles.
2. **Rosters handed on or inherited are valued differently from decisions.** I first valued them the same way as decisions, by the secant split. That gave a roster more titles than its team was expected to win: Curry and Klay alone carried 2.65 titles for 2013-22, against Golden State's 2.2, which put Myers at −1.2 despite four titles. So rosters get their share of the team's expected titles, by their share of its player value (from replacement level), season by season. Decisions keep the secant split, as specified, which adds up exactly.
3. **"Titles won" counts by share:** a title in a co-led or mid-season-handover season counts in part, like the points.

## Found and fixed along the way (existing bugs)

- **`luck.py`** looked teams up by Basketball-Reference's abbreviation in a file keyed by the NBA's, so its stored margin was empty for Phoenix (every season), Brooklyn (from 2012-13) and five teams before 1996-97. The headline was never affected (gm5 rebuilds the margin itself), and the luck terms are unchanged.
- **The nightly update (`gm_update.py`) never ran `holding.py` or `draftstyle.py`**, added last round, so a nightly would have reused stale skill files. Both now run, with the three titles steps.
- **The NBA's regular-season log leaves out the NBA Cup's knockout games and lists neutral-site games without a home team**, so 2024-25 and 2025-26 were short. They are now added from the Cup log and marked neutral. The data step now asserts that every team's games equal its wins plus losses in every season (the cancelled Boston–Indiana game of April 2013 is dropped).

## How it stays current

- **Chain** (`run_chain.sh`, called by the new `rebuild.sh`):
  - order: … conserve → holding → draftstyle → titles_ref → titles → titles_dec → gm5 …
  - the nightly update runs the same steps;
  - `checks.sh` runs every check in one call, so unattended runs never hit an inline loop.
- **Data:**
  - the season data come from `titles_data.py`, on the Mac lane in `mac_pull.sh` (it needs the NBA's game logs);
  - a finished season joins from July 1;
  - the parsed playoff data ride the encrypted Mac bundle and are kept out of the public repo.
- **Production refreshes** (GM_FREEZE=1) write each decision's at-the-time titles once, like the at-the-time points.

## Sources and refusals

- **Basketball-Reference** answered a 429 (rate limit) on the 2002-03 playoffs page, after the 1979-80 to 2001-02 pages had been read. Per the fetch rules it is never retried; its pages are now read from the cache only.
- **The NBA's playoff game log** covers every season, and agrees with Basketball-Reference game by game for 1996-97 to 2001-02.
- **Seeding rules:** the NBA playoffs article on Wikipedia.

## What I could not do

The Chrome extension was not connected, so there is no screenshot at 375px. The jsdom walk at 375px covers the switch, the slider, the titles panel, the decision columns and every new explainer (24/24). The phone preview is at http://192.168.1.207:8787/gm-savant.html.
