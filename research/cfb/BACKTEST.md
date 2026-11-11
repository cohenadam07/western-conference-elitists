# College Football Savant: data pull and stability backtest

*Run of Nov 10, 2026, on branch `cfb-savant-research`. Research only: no page, no connector change, no workflow, nothing in `public/`. Everything here was computed by the code in `pipeline/cfb/`; the tables behind it are in `research/cfb/out/` and the charts in `research/cfb/charts/`.*

## Summary

1. **The data is good enough for teams and for offensive players, and thinner than hoped for defenders.** Team stats are usable for every season from 2014 to 2025. Player stats are usable for 2014–2020 and 2023–2025; 2021 and 2022 fall just under the play-by-play gate (96.4% and 95.4% of games against a 97% bar), and ESPN itself still serves those missing games, so prompt 2 can backfill them. Before 2024 a defender's tackles, tackles for loss and pass break-ups are only as complete as his school's stat crew made the play text, so defenders from different schools are not comparable in those seasons. From 2024 the box score fixes that.
2. **Our expected-points model is calibrated and agrees with the outside models.** On held-out 2025 plays its predictions are within 0.13 points of what happened in every decile. Team-season offence by our EPA correlates 0.99 with the release files' EPA and 0.94 with CFBD's PPA.
3. **The stability verdicts came out the way the research predicted.** Success rate is the steadiest team measure (reliable after about 5 games); explosiveness per successful play is not (20 games); turnovers and fumble recoveries behave like luck, and red-zone touchdown rate is nearly as noisy. For players, QB efficiency, sack rate and yards per attempt earn full bars; RB rates are hatched; EPA per target and catch rate are too noisy to be bars; a receiver's yards and EPA per team dropback are solid. Interception rate (QBs and defenders), forced fumbles and field-goal accuracy are mostly noise in one season.
4. **The power rating passes its bar.** Predicting every FBS-vs-FBS game of 2016–2025 from earlier games only, it misses the final margin by 12.90 points on average, against 12.65 for ESPN FPI and 12.34 for the closing spread: 0.25 behind FPI, inside the 0.5 allowed. On the five seasons its constants never saw (2021–2025) the gap is 0.17.
5. **Savant value is stable enough at every position except defensive back, kicker and punter, and quarterbacks dominate it.** Year-to-year correlation runs from 0.47 (QB, edge, OL unit) down to about 0.2 (CB, S, K, P). About 43 of the top 50 players each season are quarterbacks, so the Savant Heisman would be a quarterback every year. Of 163 major position-award winners, 44% are on our first team and 71% on one of our three. **The AP first-team overlap could not be done properly:** no permitted source holds the AP teams (see section 9).
6. **The objective playoff field works.** Under the 2026 rules our résumé score picks, on average, 10.9 of the same 12 teams the committee's own final ranking would produce under those rules. The simulator's odds are honest: across 154 weekly runs of 20,000 simulations, no probability band is off by more than 7 points.
7. **Headshots: 97.7% of 1,147 players on ten 2026 rosters have one.** The roster feed's own headshot field predicts it, so the build needs no extra checks.
8. **Calls: 2 CFBD calls were made, not 51.** The shared meter read 462 on this run's first call and College Basketball Savant's own guard stops at 400, so every call here came out of the live basketball product's month. The release files already held nearly everything the calls were for.
9. **The six things that most need your decision** are in section 9: defenders before 2024, the receiver-value definition, quarterbacks owning the Heisman, the Pac-12's status in old seasons, the CFBD quota, and the AP table.

---

## 1. What data exists, by season

**Sources.** History is the sportsdataverse-data release files (free, no key): 18 file families, 2.5 GB as parquet, inventoried in `out/inventory.md`. ESPN-derived play-by-play runs 2004–2026 (506 columns), play participants 2014–2026, box scores, drives, rosters, schedules, lines, ESPN FPI game predictions (2015 on), and the weekly AP, coaches and CFP committee polls.

**Two gates** decide what a season can be used for: play-by-play on at least 97% of FBS-vs-FBS games, and a defender id on at least 80% of sacks and of interceptions. *(A "defender id" is ESPN's athlete number attached to the play, which is what lets a sack be credited to a player.)*

| season | FBS-vs-FBS games | with play-by-play | final score matches | passer id | rusher id | receiver id on catches | receiver id on incompletions | sack: defender id | interception: id in plays | interception: id in box score | pass break-ups found per game | tackler id on ordinary plays | games with a defensive box score | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2004 | 661 | 66.7% | 100% | 95.7% | 95.8% | 94.8% | 0% | 0% | 94.9% | 97.5% | 0.0 | 0% | 0% | FLAGGED: play-by-play under 97% |
| 2005 | 664 | 84.8% | 98.4% | 95.3% | 94.9% | 95.5% | 56.6% | 81.4% | 92.0% | 100% | 0.9 | 0% | 0% | FLAGGED: play-by-play under 97% |
| 2006 | 711 | 87.8% | 98.6% | 97.8% | 98.0% | 96.9% | 66.8% | 90.8% | 97.0% | 100% | 0.9 | 0% | 0% | FLAGGED: play-by-play under 97% |
| 2007 | 712 | 88.3% | 98.1% | 98.6% | 97.4% | 98.5% | 64.6% | 91.8% | 97.3% | 99.8% | 3.2 | 0% | 0% | FLAGGED: play-by-play under 97% |
| 2008 | 719 | 95.8% | 98.7% | 98.6% | 97.6% | 99.0% | 50.2% | 73.1% | 98.8% | 99.8% | 2.5 | 0% | 0% | FLAGGED: play-by-play under 97% |
| 2009 | 714 | 97.5% | 98.9% | 97.4% | 97.3% | 98.9% | 62.8% | 84.4% | 99.0% | 100% | 2.9 | 0% | 0% | players and teams |
| 2010 | 718 | 97.2% | 98.7% | 98.0% | 97.4% | 99.3% | 63.9% | 96.7% | 98.9% | 99.9% | 3.0 | 0% | 0% | players and teams |
| 2011 | 715 | 98.3% | 99.1% | 97.7% | 96.4% | 98.3% | 69.1% | 96.1% | 98.4% | 99.5% | 3.0 | 0% | 0% | players and teams |
| 2012 | 739 | 97.3% | 99.4% | 98.4% | 97.0% | 98.8% | 74.5% | 97.0% | 99.3% | 100% | 2.9 | 0% | 0% | players and teams |
| 2013 | 739 | 99.6% | 99.3% | 98.7% | 97.5% | 98.8% | 71.1% | 33.3% | 99.4% | 100% | 3.0 | 0% | 0% | teams only (defender ids under 80%) |
| 2014 | 760 | 98.0% | 99.9% | 99.8% | 99.2% | 99.8% | 76.8% | 98.7% | 99.9% | 100% | 5.2 | 40.3% | 0% | players and teams |
| 2015 | 765 | 98.8% | 99.6% | 99.6% | 98.6% | 99.6% | 78.0% | 99.2% | 99.6% | 100% | 5.5 | 50.1% | 0% | players and teams |
| 2016 | 760 | 98.0% | 99.3% | 100.0% | 99.5% | 99.7% | 76.5% | 99.6% | 100% | 100% | 5.6 | 54.9% | 8.7% | players and teams |
| 2017 | 776 | 99.5% | 99.4% | 99.9% | 99.8% | 99.9% | 77.1% | 99.7% | 99.9% | 100% | 5.9 | 61.5% | 6.7% | players and teams |
| 2018 | 772 | 99.7% | 99.5% | 99.9% | 99.8% | 99.8% | 76.5% | 99.7% | 100% | 100% | 5.7 | 61.0% | 4.0% | players and teams |
| 2019 | 774 | 99.7% | 99.7% | 99.9% | 99.6% | 99.9% | 76.8% | 99.4% | 100% | 100% | 5.5 | 62.3% | 4.1% | players and teams |
| 2020 | 534 | 99.1% | 99.2% | 99.9% | 99.7% | 99.6% | 77.4% | 99.7% | 97.9% | 99.7% | 5.2 | 53.8% | 6.2% | players and teams |
| 2021 | 770 | 96.4% | 97.8% | 99.4% | 99.0% | 99.8% | 58.5% | 90.4% | 52.3% | 100% | 1.7 | 56.0% | 17.5% | FLAGGED: play-by-play under 97% |
| 2022 | 776 | 95.4% | 98.5% | 99.9% | 99.1% | 99.9% | 50.3% | 89.3% | 41.9% | 100% | 1.1 | 59.7% | 8.2% | FLAGGED: play-by-play under 97% |
| 2023 | 792 | 99.1% | 98.7% | 99.7% | 99.4% | 99.9% | 44.0% | 86.4% | 41.6% | 100% | 1.1 | 75.8% | 57.5% | players and teams |
| 2024 | 798 | 98.0% | 98.6% | 99.9% | 99.4% | 99.9% | 22.8% | 90.4% | 88.7% | 100% | 1.9 | 73.8% | 99.7% | players and teams |
| 2025 | 808 | 99.9% | 99.0% | 99.9% | 99.7% | 99.9% | 92.1% | 89.5% | 77.4% | 100% | 5.2 | 84.5% | 99.9% | players and teams |
| 2026 | 562 | 100% | 99.3% | 99.9% | 99.7% | 99.9% | 94.5% | 94.1% | 64.9% | 100% | 7.8 | 90.8% | 99.8% | players and teams |

**What the table means.**

1. **Teams: 2014–2025 all usable** (2009–2012 also pass, which matters for backfilling later). 2021 and 2022 are flagged at 96.4% and 95.4% of games; they stay in the team study and the ratings, and are out of the player study, as the rule says.
2. **Players: 2014–2020 and 2023–2025.** 2013 fails for a reason worth knowing: ESPN's 2013 play text records almost no sacks at all (55 in the whole season), so sack rate and dropback counts cannot be built for that year.
3. **The missing 2021–2022 games exist at ESPN.** We asked ESPN's play feed for eight of them; all eight returned plays (three look partial). Prompt 2 can pull them directly.
4. **Offensive ids are excellent everywhere:** passer and rusher above 99% from 2014, receiver above 99% on catches.
5. **Incompletions usually name no target.** Before 2025 only 14–32% of games name the intended receiver on incompletions (68% of games in 2025, 71% in 2026). This is why catch rate and EPA per target cannot be trusted before 2025.
6. **Defender credit depends on the season and the school.** Sacks are named on 86–99% of plays in every study season. Interceptions are named in the plays only 42–89% of the time from 2021, but the box score names every one, so interception counts come from the box score. Pass break-ups were found at 5–6 a game through 2020, then 1–2 a game in 2021–2024 (the text stopped saying who broke up the pass), and are back from 2025. Tacklers are named on 40% of ordinary plays in 2014, rising to 85% in 2025 and 91% in 2026. A full defensive box score (tackles, tackles for loss, passes defensed, QB hurries) exists for essentially every game only from 2024.
7. **QB hurries exist only in the box score, from 2024.** No play feed, live or historical, names who hurried the quarterback.
8. **Fumbles are under-reported in the play text in 2021–2023** (0.75–1.07 lost a game against 1.10–1.24 in the team box), so team turnovers are read from the team box score in every season.
9. **Games played are unknown.** The game-roster files list the whole roster every week with no did-not-play flag, and there are no snap counts. Rates are per team play, dropback, target or rush.

**The ESPN live check (step 3).** The live ESPN feed was compared with the release files on 38 games from one 2025 Saturday and one 2026 Saturday, across nine conferences (`out/espn_live_check.md`). The live feed carries the same 17 participant roles as the release files, every participant has an athlete id, and the ids agree on 99.4–100% of cells. Coverage did not differ by conference tier. Two things to carry into the build: the intercepting defender arrives under the role `passDefender`, and is missing on interceptions with no return in the 2026 text format (9 of 19 named), so the box score stays the source for interceptions; and DraftKings lines appear in the game summary for 2026 games but not for 2025 games. About 90 calls for the comparison; median response 254 ms.

**Lines and FPI.** The release betting table is empty for about 88% of 2014–2022 games, so the closing spread comes from the classic FBS file's line (97–99% of games), with ESPN's where it exists. ESPN's FPI pre-game margin exists from 2015.

## 2. The expected-points model

*Expected points (EP) is the average value of the next score given the down, distance, field position, clock, score and site. EPA, expected points added, is how much a play changed it.* Ours is fitted on 1.3 million FBS-vs-FBS plays from 2014–2024 and tested on 2025, which it never saw.

1. **Calibration on 2025.** In every tenth of plays, sorted by predicted EP, the prediction is within 0.13 points of what actually happened (average miss 0.06). The release files' own EP, on the same plays, is off by up to 0.22. Our small remaining bias is real drift: field goals were the next score more often in 2025 (19.2%) than the 2014–2024 model expects (17.6%). The model should be refitted each off-season.
2. **Win probability.** *(The chance the team with the ball wins, from score, clock, field position and the pregame spread.)* Within 2.7 percentage points in every decile on 2025.
3. **Against the other models.** Team-season offence: r = 0.989 with the release EPA, r = 0.942 with CFBD's PPA (read from the classic file, no API call). Play by play, r = 0.94–0.98 with the release EPA. High, not identical, as expected.
4. **The 2004–2013 versus 2014+ level shift is real, and about half the size of the figure quoted in the research.** Our one model, applied to both eras, gives -0.035 EPA per scrimmage play in 2004–2013 and +0.007 in 2014–2024, a rise of 0.04; the release files' EPA rises 0.06. Yards per play rose over the same years (5.6–5.9 to 5.9–6.1) and scoring went from about 52 points a game to about 57 in 2012–2016, so offences did get better. There is no step at 2014 in either series, only a climb that starts around 2009, which is what a real change looks like and not what a data artifact looks like. The larger figure reported from CFBD's numbers (0.04 to 0.14) could not be checked here. Percentiles should still be computed within a season.
5. **Garbage time.** CFBD's documented rule (margin above 38 in the second quarter, 28 in the third, 22 in the fourth) removes about 8% of plays. A win-probability rule (under 2% or over 98%) removes about 19%, including nearly half of all fourth-quarter plays. **Chosen: CFBD's rule.** Measured on 2014-2025 team stats (garbage_time_test.csv): CFBD's rule predicts later-game margin slightly better than no filter (mean |r| 0.426 vs 0.422) and keeps the same full-season reliability (0.700 vs 0.703). The win-probability filter (naive WP under 2% or over 98%) throws out 2.5x as many plays (about 19% vs 8%, nearly half of all fourth-quarter plays), which costs reliability (0.684) for no extra predictive value (0.423). The CFBD rule also needs no model, so anyone can check it against a scoreboard.

Full tables: `out/ep_report.md`. Chart: `charts/ep_wp_calibration.png`.

## 3. The stability verdict

**How to read it.** *Reliability* is how well one half of a season predicts the other, stepped up to a full season: 1.0 is pure signal, 0 is pure noise. *Settle point* is the sample at which a player's own number and the average for his position deserve equal weight. *Year-to-year* is the correlation between consecutive seasons.

**Verdicts.** Teams: **full bar** if the stat is half signal within 6 games, **hatched** within 12, otherwise **CONTEXT**; turnover-type stats that fail are **luck**. Players: **full bar** at full-season reliability of 0.5 or more for a typical qualified player, **hatched** from 0.3, **CONTEXT** from 0.15, **dropped** below. Usage shares are CONTEXT whatever their reliability, because they say how much, not how good.

### Teams (2014–2025, garbage time out, 200 random splits)

| stat | seasons | full-season reliability | games to 0.5 | games to 0.7 | year-to-year r | predicts later margin: wk 3 | wk 6 | wk 10 | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| **Efficiency** | | | | | | | | | |
| Offence EPA per play | 2014-2025 | 0.71 | 4.8 | 11.2 | 0.44 | +0.35 | +0.40 | +0.39 | full bar |
| Defence EPA per play allowed | 2014-2025 | 0.64 | 6.5 | 15.2 | 0.44 | -0.30 | -0.36 | -0.35 | hatched |
| Offence EPA per dropback | 2014-2025 | 0.62 | 7.2 | 16.8 | 0.36 | +0.28 | +0.33 | +0.37 | hatched |
| Defence EPA per dropback allowed | 2014-2025 | 0.50 | 11.8 | 27.5 | 0.35 | -0.25 | -0.30 | -0.31 | hatched |
| Offence EPA per rush | 2014-2025 | 0.56 | 9.1 | 21.3 | 0.35 | +0.25 | +0.29 | +0.26 | hatched |
| Defence EPA per rush allowed | 2014-2025 | 0.54 | 10.0 | 23.3 | 0.32 | -0.22 | -0.29 | -0.28 | hatched |
| Offence success rate | 2014-2025 | 0.72 | 4.6 | 10.8 | 0.47 | +0.34 | +0.42 | +0.41 | full bar |
| Defence success rate allowed | 2014-2025 | 0.67 | 5.6 | 13.1 | 0.46 | -0.33 | -0.39 | -0.38 | full bar |
| Offence passing success rate | 2014-2025 | 0.67 | 5.6 | 13.1 | 0.43 | +0.30 | +0.36 | +0.39 | full bar |
| Defence passing success rate allowed | 2014-2025 | 0.54 | 10.0 | 23.3 | 0.38 | -0.27 | -0.32 | -0.33 | hatched |
| Offence rushing success rate | 2014-2025 | 0.60 | 7.6 | 17.8 | 0.41 | +0.26 | +0.34 | +0.30 | hatched |
| Defence rushing success rate allowed | 2014-2025 | 0.61 | 7.5 | 17.6 | 0.39 | -0.28 | -0.34 | -0.33 | hatched |
| **Explosiveness** | | | | | | | | | |
| Offence explosiveness (EPA per successful play) | 2014-2025 | 0.37 | 20.0 | 46.7 | 0.33 | -0.00 | -0.07 | -0.06 | CONTEXT |
| Defence explosiveness allowed | 2014-2025 | 0.46 | 13.7 | 31.9 | 0.34 | +0.06 | +0.09 | +0.12 | CONTEXT |
| Offence explosive play rate | 2014-2025 | 0.63 | 6.7 | 15.6 | 0.41 | +0.27 | +0.31 | +0.30 | hatched |
| Defence explosive play rate allowed | 2014-2025 | 0.53 | 10.1 | 23.7 | 0.37 | -0.24 | -0.29 | -0.29 | hatched |
| **Line and havoc** | | | | | | | | | |
| Defence havoc rate | 2014-2020, 2025 | 0.43 | 15.5 | 36.1 | 0.33 | +0.16 | +0.22 | +0.21 | CONTEXT |
| Offence havoc rate allowed | 2014-2020, 2025 | 0.65 | 6.4 | 14.9 | 0.53 | -0.31 | -0.36 | -0.34 | hatched |
| Offence stuff rate (runs for no gain or a loss) | 2014-2025 | 0.52 | 10.5 | 24.6 | 0.38 | -0.20 | -0.25 | -0.22 | hatched |
| Defence stuff rate | 2014-2025 | 0.59 | 8.1 | 18.8 | 0.40 | +0.21 | +0.23 | +0.24 | hatched |
| Offence line yards per rush | 2014-2025 | 0.57 | 8.7 | 20.3 | 0.37 | +0.23 | +0.31 | +0.25 | hatched |
| Defence line yards per rush allowed | 2014-2025 | 0.60 | 7.9 | 18.4 | 0.42 | -0.24 | -0.29 | -0.31 | hatched |
| Offence sack rate allowed | 2014-2025 | 0.63 | 6.9 | 16.0 | 0.35 | -0.12 | -0.16 | -0.18 | hatched |
| Defence sack rate | 2014-2025 | 0.36 | 20.8 | 48.6 | 0.29 | +0.19 | +0.24 | +0.27 | CONTEXT |
| **Finishing drives** | | | | | | | | | |
| Offence points per trip inside the 40 | 2014-2025 | 0.46 | 13.6 | 31.7 | 0.28 | +0.25 | +0.30 | +0.33 | CONTEXT |
| Defence points per trip inside the 40 allowed | 2014-2025 | 0.42 | 15.8 | 36.8 | 0.28 | -0.23 | -0.30 | -0.31 | CONTEXT |
| Offence red-zone touchdown rate | 2014-2025 | 0.28 | 29.3 | 50+ | 0.16 | +0.17 | +0.23 | +0.23 | CONTEXT |
| Defence red-zone touchdown rate allowed | 2014-2025 | 0.28 | 30.4 | 50+ | 0.15 | -0.19 | -0.25 | -0.24 | CONTEXT |
| Offence third-down conversion rate | 2014-2025 | 0.51 | 11.1 | 25.8 | 0.32 | +0.22 | +0.28 | +0.32 | hatched |
| Defence third-down conversion rate allowed | 2014-2025 | 0.45 | 14.4 | 33.5 | 0.27 | -0.21 | -0.27 | -0.26 | CONTEXT |
| **Field position** | | | | | | | | | |
| Offence average starting field position (yards to go) | 2014-2025 | 0.36 | 20.8 | 48.5 | 0.31 | -0.19 | -0.26 | -0.31 | CONTEXT |
| Defence average starting field position faced | 2014-2025 | 0.46 | 13.5 | 31.4 | 0.36 | +0.20 | +0.27 | +0.30 | CONTEXT |
| Net special-teams EPA per game | 2014-2025 | 0.34 | 22.3 | 50+ | 0.23 | +0.09 | +0.12 | +0.16 | CONTEXT |
| **Turnovers** | | | | | | | | | |
| Giveaways per play | 2014-2025 | 0.29 | 28.5 | 50+ | 0.21 | -0.18 | -0.22 | -0.25 | luck |
| Takeaways per play | 2014-2025 | 0.22 | 41.3 | 50+ | 0.19 | +0.14 | +0.23 | +0.25 | luck |
| Turnover margin per game | 2014-2025 | 0.26 | 32.8 | 50+ | 0.21 | +0.17 | +0.25 | +0.28 | luck |
| Interceptions thrown per dropback | 2014-2025 | 0.32 | 24.3 | 50+ | 0.23 | -0.12 | -0.18 | -0.21 | luck |
| Interceptions made per opponent dropback | 2014-2025 | 0.24 | 37.5 | 50+ | 0.15 | +0.15 | +0.20 | +0.21 | luck |
| Fumbles lost per play | 2014-2025 | 0.15 | 50+ | 50+ | 0.08 | -0.10 | -0.06 | -0.09 | luck |
| Fumble recovery rate (all fumbles in the game) | 2014-2025 | -0.04 | 50+ | 50+ | -0.02 | -0.01 | -0.01 | +0.01 | luck |
| Interceptions per pass defensed (defence) | 2014-2020, 2025 | 0.35 | 21.8 | 50+ | 0.31 | +0.17 | +0.22 | +0.23 | luck |
| **Discipline and pace** | | | | | | | | | |
| Penalties per offensive play | 2014-2025 | 0.56 | 9.3 | 21.7 | 0.43 | -0.00 | -0.01 | -0.02 | hatched |
| Penalty yards per game | 2014-2025 | 0.55 | 9.7 | 22.5 | 0.41 | +0.04 | +0.05 | +0.03 | hatched |
| Offensive plays per game | 2014-2025 | 0.47 | 12.9 | 30.1 | 0.36 | +0.03 | +0.06 | +0.08 | CONTEXT |
| **Net** | | | | | | | | | |
| Net EPA per play (offence minus defence) | 2014-2025 | 0.72 | 4.4 | 10.3 | 0.55 | +0.44 | +0.52 | +0.52 | rating input |
| Net success rate (offence minus defence) | 2014-2025 | 0.74 | 4.1 | 9.6 | 0.59 | +0.42 | +0.51 | +0.51 | rating input |
| Raw scoring margin per game | 2014-2025 | 0.74 | 4.0 | 9.4 | 0.59 | +0.43 | +0.53 | +0.54 | rating input |

**What stands out.**

1. Success rate is the most stable efficiency measure on both sides of the ball; EPA per play is close behind. Passing is steadier than rushing on offence, the reverse on defence.
2. Explosiveness (EPA per successful play) needs 14–20 games to be half signal and does not predict later results at all. Explosive play *rate* is much better behaved.
3. Turnovers are luck: turnover margin needs 33 games, fumble recovery rate has no signal whatever (reliability −0.04, year-to-year −0.02).
4. **No single stat beats raw scoring margin at predicting later games.** Net success rate and net EPA match it; nothing exceeds it. The gain comes from opponent adjustment (next table) and from combining them, which is what the power rating does.
5. Havoc and interceptions per pass defensed are measured only on seasons where pass break-ups were visible (2014–2020, 2025).

**Opponent adjustment (step 8)** beats raw at every week tested, by 0.03–0.05 in correlation with later margins:

**Success rate** (ridge penalty = 1 games' worth of plays; best of 0.5 / 1 / 2 / 4)

| through week | later games | r, raw | r, opponent-adjusted | gain |
|---|---:|---:|---:|---:|
| 3 | 6,976 | 0.368 | 0.396 | +0.029 |
| 4 | 6,556 | 0.405 | 0.436 | +0.031 |
| 5 | 5,951 | 0.433 | 0.467 | +0.034 |
| 6 | 5,365 | 0.456 | 0.491 | +0.035 |
| 7 | 4,764 | 0.480 | 0.522 | +0.042 |
| 8 | 4,211 | 0.481 | 0.535 | +0.054 |
| 9 | 3,607 | 0.506 | 0.551 | +0.045 |
| 10 | 2,986 | 0.507 | 0.555 | +0.048 |

**EPA per play** (ridge penalty = 1 games' worth of plays; best of 0.5 / 1 / 2 / 4)

| through week | later games | r, raw | r, opponent-adjusted | gain |
|---|---:|---:|---:|---:|
| 3 | 6,976 | 0.361 | 0.391 | +0.030 |
| 4 | 6,556 | 0.402 | 0.433 | +0.031 |
| 5 | 5,951 | 0.433 | 0.470 | +0.037 |
| 6 | 5,365 | 0.462 | 0.497 | +0.035 |
| 7 | 4,764 | 0.483 | 0.525 | +0.042 |
| 8 | 4,211 | 0.484 | 0.538 | +0.054 |
| 9 | 3,607 | 0.508 | 0.552 | +0.044 |
| 10 | 2,986 | 0.511 | 0.558 | +0.047 |

### Players (2014–2020 and 2023–2025)

**QB**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| EPA per dropback | 2014-2025 | 1242 | 299 dropbacks | 0.53 | 224 dropbacks | 0.37 (527) | 0.20 (71) | yes (0.24 vs 0.20) | full bar |
| Success rate on dropbacks | 2014-2025 | 1242 | 299 dropbacks | 0.59 | 188 dropbacks | 0.43 (527) | 0.28 (71) | yes (0.31 vs 0.28) | full bar |
| Sack rate | 2014-2025 | 1242 | 299 dropbacks | 0.58 | 211 dropbacks | 0.47 (527) | 0.51 (71) | yes (0.55 vs 0.51) | full bar |
| Interception rate | 2014-2025 | 1198 | 285 attempts | 0.13 | 1188 attempts | 0.17 (512) | 0.19 (69) | yes (0.24 vs 0.19) | dropped |
| Yards per attempt | 2014-2025 | 1198 | 285 attempts | 0.58 | 188 attempts | 0.39 (512) | 0.24 (69) |  | full bar |
| Completion rate | 2014-2025 | 1198 | 285 attempts | 0.58 | 188 attempts | 0.46 (512) | 0.32 (69) |  | full bar |
| Explosive pass rate (16+ yards) | 2014-2025 | 1198 | 285 attempts | 0.53 | 251 attempts | 0.37 (512) | 0.27 (69) |  | full bar |
| EPA per dropback, passing downs | 2014-2025 | 1452 | 118 dropbacks | 0.34 | 158 dropbacks | 0.25 (578) | 0.22 (80) | yes (0.23 vs 0.22) | hatched |
| EPA per dropback, standard downs | 2014-2025 | 1110 | 180 dropbacks | 0.37 | 251 dropbacks | 0.33 (480) | 0.11 (67) | yes (0.13 vs 0.11) | hatched |
| EPA per rush (scrambles and designed runs together) | 2014-2025 | 906 | 70 rushes | 0.34 | 119 rushes | 0.19 (420) | -0.05 (56) | yes (-0.05 vs -0.05) | hatched |
| Rushing EPA per play he ran or threw | 2014-2025 | 1278 | 362 plays | 0.46 | 398 plays | 0.28 (540) | 0.12 (74) |  | hatched |
| Total EPA per play (pass + rush) | 2014-2025 | 1278 | 362 plays | 0.57 | 237 plays | 0.38 (540) | 0.19 (74) | yes (0.24 vs 0.19) | full bar |

**RB**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| EPA per rush | 2014-2025 | 1734 | 127 rushes | 0.34 | 266 rushes | 0.26 (901) | 0.06 (78) | yes (0.07 vs 0.06) | hatched |
| Success rate | 2014-2025 | 1734 | 127 rushes | 0.42 | 211 rushes | 0.25 (901) | 0.07 (78) | yes (0.11 vs 0.07) | hatched |
| Explosive run rate (12+ yards) | 2014-2025 | 1734 | 127 rushes | 0.40 | 178 rushes | 0.24 (901) | 0.17 (78) |  | hatched |
| Stuff rate (no gain or a loss) | 2014-2025 | 1734 | 127 rushes | 0.46 | 158 rushes | 0.32 (901) | 0.05 (78) | yes (0.10 vs 0.05) | hatched |
| Yards per rush | 2014-2025 | 1734 | 127 rushes | 0.41 | 188 rushes | 0.30 (901) | 0.18 (78) |  | hatched |
| Receiving EPA per team dropback | 2014-2025 | 2442 | 336 team dropbacks | 0.26 | 1000 team dropbacks | 0.19 (1342) | 0.18 (127) |  | CONTEXT |
| Share of team rushes | 2014-2025 | 2721 | 341 team rushes | 0.94 | 53 team rushes | 0.59 (1413) | 0.33 (124) |  | CONTEXT |

**WR**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| EPA per target (games where targets are named) | 2014-2025 | 813 | 41 targets | 0.16 | 158 targets | 0.02 (324) |  (13) |  | CONTEXT |
| Catch rate (games where targets are named) | 2014-2025 | 813 | 41 targets | 0.32 | 106 targets | 0.16 (324) |  (13) |  | hatched |
| Target share (games where targets are named) | 2014-2025 | 1811 | 169 team attempts | 0.83 | 53 team attempts | 0.58 (728) | -0.18 (29) |  | CONTEXT |
| Explosive catch rate (16+ yards) | 2014-2025 | 4372 | 30 catches | 0.39 | 47 catches | 0.30 (2001) | 0.06 (210) |  | hatched |
| Yards per catch | 2014-2025 | 4372 | 30 catches | 0.48 | 28 catches | 0.38 (2001) | 0.13 (210) |  | hatched |
| Yards per team pass attempt | 2014-2025 | 3720 | 329 team attempts | 0.79 | 106 team attempts | 0.56 (2076) | 0.05 (205) |  | full bar |
| Receiving EPA per team dropback | 2014-2025 | 4089 | 342 team dropbacks | 0.57 | 298 team dropbacks | 0.41 (2161) | 0.07 (213) | yes (0.17 vs 0.07) | full bar |
| Catches per team pass attempt | 2014-2025 | 3720 | 329 team attempts | 0.85 | 79 team attempts | 0.58 (2076) | 0.14 (205) |  | CONTEXT |

**TE**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| EPA per target (games where targets are named) | 2014-2025 | 346 | 22 targets | 0.08 | 126 targets | -0.05 (95) |  (7) |  | dropped |
| Catch rate (games where targets are named) | 2014-2025 | 346 | 22 targets | 0.14 | 60 targets | -0.06 (95) |  (7) |  | dropped |
| Target share (games where targets are named) | 2014-2025 | 517 | 166 team attempts | 0.79 | 75 team attempts | 0.50 (155) |  (7) |  | CONTEXT |
| Explosive catch rate (16+ yards) | 2014-2025 | 1101 | 21 catches | 0.30 | 79 catches | 0.22 (473) | 0.25 (47) |  | CONTEXT |
| Yards per catch | 2014-2025 | 1101 | 21 catches | 0.32 | 53 catches | 0.20 (473) | 0.21 (47) |  | hatched |
| Yards per team pass attempt | 2014-2025 | 871 | 312 team attempts | 0.75 | 133 team attempts | 0.54 (535) | 0.28 (50) |  | full bar |
| Receiving EPA per team dropback | 2014-2025 | 984 | 324 team dropbacks | 0.46 | 447 team dropbacks | 0.36 (562) | 0.20 (55) | no (0.06 vs 0.20) | hatched |
| Catches per team pass attempt | 2014-2025 | 871 | 312 team attempts | 0.81 | 89 team attempts | 0.52 (535) | 0.40 (50) |  | CONTEXT |

**DL**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Sacks per 100 team defensive plays | 2014-2025 | 6866 | 732 team def. plays | 0.53 | 668 team def. plays | 0.48 (2330) | 0.24 (197) | no (0.22 vs 0.24) | full bar |
| Tackles for loss incl. sacks, from plays, per 100 | 2014-2025 | 6866 | 732 team def. plays | 0.54 | 668 team def. plays | 0.48 (2330) | 0.32 (197) | yes (0.32 vs 0.32) | full bar |
| Run stops per 100 (tackle on a failed run) | 2014-2025 | 6866 | 732 team def. plays | 0.57 | 668 team def. plays | 0.40 (2330) | 0.11 (197) |  | full bar |
| Tackles for loss, box score, per 100 | 2024, 2025 | 1784 | 710 team def. plays | 0.60 | 562 team def. plays | 0.45 (268) | 0.35 (103) |  | full bar |
| QB hurries, box score, per 100 | 2024, 2025 | 1784 | 710 team def. plays | 0.52 | 596 team def. plays | 0.27 (268) | 0.42 (103) |  | full bar |
| Forced fumbles per 100 | 2014, 2015, 2016, 2017, 2018, 2019, 2020 | 4309 | 746 team def. plays | 0.09 | 5957 team def. plays | 0.11 (1720) |  (23) |  | dropped |
| Tackles, box score, per 100 | 2024, 2025 | 1784 | 710 team def. plays | 0.75 | 355 team def. plays | 0.34 (268) | 0.29 (103) |  | CONTEXT |
| Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 5236 | 740 team def. plays | 0.56 | 668 team def. plays | 0.50 (1720) |  (23) |  | full bar |
| Disruption EPA per 100 (points the offence lost on his plays) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 5236 | 740 team def. plays | 0.46 | 944 team def. plays | 0.42 (1720) |  (23) |  | hatched |

**LB**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Sacks per 100 team defensive plays | 2014-2025 | 5419 | 731 team def. plays | 0.49 | 841 team def. plays | 0.32 (1885) | 0.38 (132) | yes (0.47 vs 0.38) | hatched |
| Tackles for loss incl. sacks, from plays, per 100 | 2014-2025 | 5419 | 731 team def. plays | 0.51 | 794 team def. plays | 0.27 (1885) | 0.07 (132) | yes (0.10 vs 0.07) | full bar |
| Run stops per 100 (tackle on a failed run) | 2014-2025 | 5419 | 731 team def. plays | 0.72 | 355 team def. plays | 0.44 (1885) | 0.11 (132) |  | full bar |
| Tackles for loss, box score, per 100 | 2024, 2025 | 1310 | 701 team def. plays | 0.60 | 562 team def. plays | 0.37 (244) | 0.17 (50) |  | full bar |
| QB hurries, box score, per 100 | 2024, 2025 | 1310 | 701 team def. plays | 0.47 | 1000 team def. plays | 0.33 (244) | 0.31 (50) |  | hatched |
| Interceptions per 100 | 2014-2025 | 5419 | 731 team def. plays | 0.22 | 2512 team def. plays | 0.18 (1885) | 0.14 (132) | no (0.12 vs 0.14) | CONTEXT |
| Passes defensed (break-ups + interceptions), plays, per 100 | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 4179 | 738 team def. plays | 0.31 | 1995 team def. plays | 0.25 (1392) |  (22) |  | hatched |
| Passes defensed, box score, per 100 | 2024, 2025 | 1310 | 701 team def. plays | 0.37 | 1334 team def. plays | 0.16 (244) | -0.08 (50) |  | hatched |
| Forced fumbles per 100 | 2014, 2015, 2016, 2017, 2018, 2019, 2020 | 3513 | 742 team def. plays | 0.10 | 7499 team def. plays | 0.06 (1392) |  (22) |  | dropped |
| Tackles, box score, per 100 | 2024, 2025 | 1310 | 701 team def. plays | 0.87 | 211 team def. plays | 0.40 (244) | 0.07 (50) |  | CONTEXT |
| Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 4179 | 738 team def. plays | 0.53 | 891 team def. plays | 0.31 (1392) |  (22) |  | full bar |
| Disruption EPA per 100 (points the offence lost on his plays) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 4179 | 738 team def. plays | 0.42 | 1259 team def. plays | 0.28 (1392) |  (22) |  | hatched |

**DB**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Interceptions per 100 | 2014-2025 | 6750 | 730 team def. plays | 0.28 | 2239 team def. plays | 0.19 (2116) | 0.17 (244) | yes (0.18 vs 0.17) | CONTEXT |
| Passes defensed (break-ups + interceptions), plays, per 100 | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 5017 | 737 team def. plays | 0.34 | 2114 team def. plays | 0.31 (1470) |  (13) |  | hatched |
| Passes defensed, box score, per 100 | 2024, 2025 | 1996 | 703 team def. plays | 0.47 | 944 team def. plays | 0.37 (327) | 0.19 (142) |  | hatched |
| Forced fumbles per 100 | 2014, 2015, 2016, 2017, 2018, 2019, 2020 | 3995 | 744 team def. plays | 0.06 | 10000 team def. plays | -0.01 (1470) |  (13) |  | dropped |
| Tackles, box score, per 100 | 2024, 2025 | 1996 | 703 team def. plays | 0.81 | 266 team def. plays | 0.46 (327) | 0.36 (142) |  | CONTEXT |
| Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 5017 | 737 team def. plays | 0.29 | 3758 team def. plays | 0.25 (1470) |  (13) |  | CONTEXT |
| Disruption EPA per 100 (points the offence lost on his plays) | 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025 | 5017 | 737 team def. plays | 0.27 | 3350 team def. plays | 0.17 (1470) |  (13) |  | CONTEXT |

**K**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Field goals made over expected, per attempt | 2014-2025 | 977 | 17 attempts | 0.08 | 133 attempts | 0.12 (474) | 0.14 (28) |  | dropped |

**P**

| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Punt EPA over expected, per punt | 2014-2025 | 979 | 49 punts | 0.24 | 168 punts | 0.14 (452) | 0.12 (28) |  | CONTEXT |

**What stands out.**

1. The two ways of finding a settle point (the grid search `settle_points.py` uses, and Football Savant's formula) agree closely for almost every stat, which is the best evidence the numbers are right. Both are in `out/player_stability.csv`.
2. **Quarterbacks:** efficiency, success rate, sack rate, yards per attempt and completion rate are full bars, settling at about 190–250 dropbacks. Interception rate needs about 1,200 attempts: it is noise in one season. Sack rate travels with the quarterback when he transfers (0.51) better than anything else he does.
3. **Running backs:** every rate is hatched (settle points of 160–270 rushes against a typical 127), and little of it survives a transfer (0.05–0.18), which says a running back's efficiency is largely his line and scheme.
4. **Receivers:** EPA per target (reliability 0.16) and catch rate (0.32) fail, partly because most games do not name incompletion targets. Yards per team pass attempt (0.79) and receiving EPA per team dropback (0.57) pass easily: earning targets is the repeatable skill.
5. **Defenders:** sacks, tackles for loss and run stops are full bars for linemen. For linebackers, tackles for loss and run stops are full bars and sacks just miss (0.49, hatched). QB hurries (box score, two seasons only) are a full bar for linemen. Interceptions and passes defensed are weak (0.2–0.5); forced fumbles are noise. For defensive backs nothing reaches 0.5.
6. **Opponent adjustment helps transfers** on 16 of the 19 stats where it could be tested (for example QB EPA per dropback: 0.24 against 0.20 raw). It did not help defensive-line sacks, tight-end receiving or linebacker interceptions. Transfer samples are small (30–350 players), so treat the losers as unproven rather than disproven.
7. **Kickers:** field goals over expected has reliability 0.08 on a typical 17 attempts. It can be shown, but only as a heavily shrunk number.

## 4. Power rating accuracy

The rating is opponent-adjusted offence and defence (a blend of EPA per play and success rate, ridge regression, scaled to points), plus special teams, shrunk toward a preseason number built from last season, team talent and returning production. Each week's games are predicted from earlier weeks only. Its three tuned constants were chosen on 2016–2020 and left alone for 2021–2025.

| season | games | WCE power rating | ESPN FPI | closing spread |
|---|---:|---:|---:|---:|
| 2016 | 745 | 13.70 | 13.28 | 13.12 |
| 2017 | 769 | 12.87 | 12.37 | 12.14 |
| 2018 | 768 | 13.21 | 12.86 | 12.62 |
| 2019 | 772 | 12.72 | 12.57 | 12.15 |
| 2020 | 515 | 13.41 | 13.13 | 12.97 |
| 2021 | 770 | 13.11 | 12.98 | 12.58 |
| 2022 | 776 | 12.76 | 12.35 | 12.02 |
| 2023 | 792 | 12.51 | 12.49 | 12.20 |
| 2024 | 797 | 12.77 | 12.37 | 12.12 |
| 2025 | 807 | 12.16 | 12.27 | 11.81 |
| **2016-2025** | 7511 | **12.90** | **12.65** | **12.34** |

| part of season | games | WCE | FPI | spread |
|---|---:|---:|---:|---:|
| bowls and playoff | 397 | 13.63 | 13.43 | 12.78 |
| weeks 1-4 | 1850 | 13.09 | 12.74 | 12.33 |
| weeks 10+ | 2674 | 12.71 | 12.58 | 12.39 |
| weeks 5-9 | 2590 | 12.84 | 12.53 | 12.25 |

**Result: 12.90 against FPI's 12.65, a gap of 0.25. The bar (within 0.5) is met.** It picks the winner 72.5% of the time (FPI 72.5%, spread 73.3%) and correlates 0.94 with FPI. What moved it during tuning: almost nothing. Recency weighting did not help (the best setting barely discounts old games), and the blend of EPA and success rate mattered by under 0.05 points. The largest remaining gap to FPI is in the first four weeks (0.35), which is the preseason number: ours uses a talent figure from the release files that is *not* the 247 composite (it correlates only 0.79 with CFBD's), and no recruiting or portal data. That is where prompt 2 can gain.

Chart: `charts/rating_backtest.png`. Weekly ratings for 2014–2026 are saved for the résumé and the simulator.

## 5. Savant value, positions and the All-Savant dry run

**Stability by position** (qualified players in consecutive usable seasons):

| position | qualified players a season | year-to-year r of Savant value | of the underlying rate | transfers only (n) | spread of value (sd, points) |
|---|---:|---:|---:|---:|---:|
| QB | 141 | 0.46 | 0.47 | 0.39 (62) | 37.9 |
| RB | 204 | 0.37 | 0.30 | 0.21 (59) | 9.4 |
| WR | 386 | 0.35 | 0.37 | 0.17 (118) | 10.0 |
| TE | 129 | 0.37 | 0.40 | 0.06 (42) | 5.0 |
| K | 113 | 0.14 | 0.79 | 0.41 (23) | 0.7 |
| EDGE | 360 | 0.47 | 0.56 | 0.30 (78) | 4.6 |
| IDL | 326 | 0.36 | 0.45 | 0.28 (104) | 3.1 |
| LB | 542 | 0.31 | 0.39 | 0.16 (132) | 4.5 |
| CB | 293 | 0.20 | 0.31 | 0.13 (79) | 2.1 |
| S | 382 | 0.25 | 0.25 | 0.14 (105) | 2.2 |
| P | 124 | 0.21 | 0.35 | 0.10 (32) | 2.3 |
| OL unit | 130 | 0.47 |  |  (0) | 23.3 |

1. **Passes:** QB, RB, WR, TE, edge, interior line, linebacker and the OL unit (0.31–0.47). **Weak:** corner 0.20, safety 0.25, punter 0.21, kicker 0.14. A defensive back's value is built on interceptions and break-ups, which section 3 showed are mostly noise in one season. Every defender card should say so.
2. **Quarterbacks dominate the top 50: about 43 of 50 a season,** then receivers (5) and running backs (2). That is real under this definition (a quarterback is credited with 400–600 plays), not a bug, and it does not affect the All-Savant teams, which are picked position by position. It does mean the Savant Heisman is a quarterback in all ten seasons.
3. **How much of a player's number travels with him** (transfers against players who stayed): QB 0.71, RB 0.40, WR/TE 0.35, EDGE/IDL 0.79, LB 0.52, CB/S 0.61. Quarterbacks and defensive linemen own most of their numbers; running backs and receivers own under half. A "shared-credit" value using these weights is saved beside the main one. It does not change the quarterback picture.

**Positions (step 11).** ESPN lists about 7,000 player-seasons as plain "DL" and 7,000 as plain "DB". They were split using size and stat profile, trained on players ESPN does label: edge against interior is right 88% of the time on labelled players (weight does most of the work), corner against safety 79%. The 40 closest calls of 2025, and linebackers who rush like edges, are in `out/positions_borderline.md` for your review. ESPN marks class as FR/SO/JR/SR only, so a redshirt freshman is simply "FR", which is what the Freshman team wants.

**The dry run (step 13).** National first, second and third teams, a team for each conference, a Freshman team and a Savant Heisman top five were built for all ten usable seasons: `out/all_savant_national.md` (readable) and `out/all_savant_teams.csv` (everything). The OL is a unit, named by school, because no free source says which five linemen started.

**Sanity check against the major awards.** ESPN's awards feed gives the winners of 19 national awards with athlete ids (Heisman, Maxwell, O'Brien, Doak Walker, Biletnikoff, Mackey, Butkus, Thorpe, Bednarik, Nagurski, Hendricks, Groza, Ray Guy and others).

| season | award winners checked | on our 1st team | on our 1st, 2nd or 3rd | five biggest disagreements (award: player, our rank at his position, why) |
|---|---:|---:|---:|---|
| 2014 | 17 | 9 | 12 | Butkus: Eric Kendricks (#87 LB; rate 77th percentile, volume 85th); Groza: Brad Craddock (#13 K; rate 97th percentile, volume 33th); Bednarik: Scooby Wright (#5 LB; rate 97th percentile, volume 99th); Ray Guy: Tom Hackett (#5 P; rate 91th percentile, volume 93th); Davey O'Brien: Marcus Mariota (#1 QB; rate 99th percentile, volume 91th) |
| 2015 | 16 | 4 | 13 | Groza: Ka'imi Fairbairn (#18 K; rate 80th percentile, volume 66th); Biletnikoff: Corey Coleman (#17 WR; rate 99th percentile, volume 24th); Doak Walker: Derrick Henry (#6 RB; rate 85th percentile, volume 99th); Ray Guy: Tom Hackett (#6 P; rate 95th percentile, volume 68th); Thorpe: Desmond King II (#5 CB; rate 98th percentile, volume 82th) |
| 2016 | 15 | 2 | 10 | Butkus: Reuben Foster (#171 LB; rate 65th percentile, volume 62th); Mackey: Jake Butt (#13 TE; rate 91th percentile, volume 48th); Doak Walker: D'Onta Foreman (#6 RB; rate 87th percentile, volume 98th); Thorpe: Adoree' Jackson (#6 CB; rate 98th percentile, volume 48th); Heisman: Lamar Jackson (#5 QB; rate 90th percentile, volume 96th) |
| 2017 | 17 | 10 | 14 | Butkus: Roquan Smith (#286 LB; rate 46th percentile, volume 41th); Bednarik: Minkah Fitzpatrick (#92 CB; rate 70th percentile, volume 34th); Lott: Josey Jewell (#5 LB; rate 99th percentile, volume 86th); Hendricks: Bradley Chubb (#5 EDGE; rate 98th percentile, volume 72th); Hornung: Saquon Barkley (#3 RB; rate 97th percentile, volume 93th) |
| 2018 | 16 | 9 | 11 | Butkus: Devin White (#346 LB; rate 36th percentile, volume 50th); Lombardi: Ugo Amadi (#52 S; rate 84th percentile, volume 87th); Hornung: Rondale Moore (#30 WR; rate 85th percentile, volume 94th); Doak Walker: Jonathan Taylor (#4 RB; rate 91th percentile, volume 99th); Maxwell: Tua Tagovailoa (#4 QB; rate 99th percentile, volume 58th) |
| 2019 | 16 | 12 | 12 | Hornung: Lynn Bowden Jr. (#288 WR; rate 28th percentile, volume 2th); Lott: Derrick Brown (#108 IDL; rate 62th percentile, volume 68th); Thorpe: Grant Delpit (#60 S; rate 84th percentile, volume 51th); Ray Guy: Max Duffy (#8 P; rate 95th percentile, volume 30th); Bednarik: Chase Young (#2 EDGE; rate 100th percentile, volume 3th) |
| 2020 | 16 | 8 | 11 | Lott: Paddy Fisher (#158 LB; rate 60th percentile, volume 51th); Thorpe: Tre'von Moehrig (#73 S; rate 68th percentile, volume 43th); Butkus: Jeremiah Owusu-Koramoah (#45 LB; rate 87th percentile, volume 61th); Ray Guy: Pressley Harvin III (#13 P; rate 81th percentile, volume 68th); Bednarik: Zaven Collins (#6 LB; rate 99th percentile, volume 53th) |
| 2023 | 17 | 5 | 12 | Lott: Junior Colson (#327 LB; rate 46th percentile, volume 24th); Hornung: Travis Hunter (#110 CB; rate 59th percentile, volume 75th); Thorpe: Trey Taylor (#19 S; rate 98th percentile, volume 6th); Doak Walker: Ollie Gordon II (#11 RB; rate 77th percentile, volume 100th); Biletnikoff: Marvin Harrison Jr. (#7 WR; rate 99th percentile, volume 40th) |
| 2024 | 16 | 5 | 7 | Butkus: Jalon Walker (#91 LB; rate 81th percentile, volume 92th); Nagurski: Kyle Kennard (#21 EDGE; rate 95th percentile, volume 25th); Bednarik: Travis Hunter (#14 WR; rate 90th percentile, volume 92th); Ray Guy: Eddie Czaplicki (#5 P; rate 98th percentile, volume 41th); Davey O'Brien: Cam Ward (#2 QB; rate 99th percentile, volume 88th) |
| 2025 | 17 | 7 | 14 | Lott: Caleb Downs (#45 S; rate 96th percentile, volume 0th); Hornung: KC Concepcion (#21 WR; rate 93th percentile, volume 72th); Ray Guy: Brett Thorson (#12 P; rate 94th percentile, volume 25th); Hendricks: Rueben Bain Jr. (#5 EDGE; rate 97th percentile, volume 96th); Biletnikoff: Makai Lemon (#5 WR; rate 99th percentile, volume 72th) |

Overall 44% of 163 winners are on our first team, 71% on one of the three, and the typical winner ranks #3 at his position. The Heisman winner ranks first overall in four of ten seasons and in the top five in seven; the three we have far lower are the non-quarterbacks (Derrick Henry, DeVonta Smith, Travis Hunter).

**The pattern in the disagreements is the important part:** the misses before 2024 are overwhelmingly linebackers and defensive backs from big programmes (Roquan Smith, Devin White, Reuben Foster, Micah Parsons, Derrick Brown). Their schools' play text names few tacklers, so they were never credited. Our pre-2024 defensive teams lean toward schools with detailed stat crews, many of them outside the power conferences. **The 2014–2023 defensive All-Savant teams should not be published as they stand.**

**AP first-team overlap: not done as asked.** No permitted source carries the AP All-America teams (ESPN's awards feed has none, and the rules of this run bar scraping). Two seasons were partly hand-entered from news summaries, without offensive linemen, as a spot check only (`research/cfb/ap_first_team_partial.csv`): 2019: 6 of 16 entered AP first-teamers on our first team, 8 on one of our three; 2024: 7 of 16 entered AP first-teamers on our first team, 10 on one of our three. To do this properly for all twelve seasons I need either a table from you or leave to fetch the twelve AP lists.

## 6. The retroactive playoff fields and the simulator

**Résumé score.** For each team: the chance that the 12th-best team by our power rating would have won at least as many games against the same schedule (exact Poisson-binomial sum). Lower is better; margin of victory never enters. The 2026 rules were then applied with each season's real conference champions.

| season | our 12, in seed order (record) | same as the committee's ranking under the same rules | in ours, not theirs | in theirs, not ours |
|---|---|---:|---|---|
| 2014 | 1 Florida State (13-0), 2 Alabama (12-1), 3 Ohio State (12-1), 4 Oregon (12-1), 5 TCU (11-1), 6 Baylor (11-1), 7 Mississippi State (10-2), 8 Marshall (12-1), 9 Ole Miss (9-3), 10 Michigan State (10-2), 11 UCLA (9-3), 12 Arizona (10-3) | 10 of 12 | Marshall, UCLA | Kansas State, Boise State |
| 2015 | 1 Clemson (13-0), 2 Alabama (12-1), 3 Michigan State (12-1), 4 Oklahoma (11-1), 5 Iowa (12-1), 6 Ohio State (11-1), 7 Notre Dame (10-2), 8 Stanford (11-2), 9 Oklahoma State (10-2), 10 TCU (10-2), 11 Northwestern (10-2), 12 Houston (12-1) | 10 of 12 | Northwestern, Oklahoma State | North Carolina, Florida State |
| 2016 | 1 Alabama (13-0), 2 Ohio State (11-1), 3 Clemson (12-1), 4 Washington (12-1), 5 Penn State (11-2), 6 Colorado (10-3), 7 Western Michigan (13-0), 8 Oklahoma (10-2), 9 Wisconsin (10-3), 10 USC (9-3), 11 Michigan (10-2), 12 Stanford (9-3) | 11 of 12 | Stanford | Florida State |
| 2017 | 1 Georgia (12-1), 2 Oklahoma (12-1), 3 Clemson (12-1), 4 Auburn (10-3), 5 Alabama (11-1), 6 Wisconsin (12-1), 7 Ohio State (11-2), 8 UCF (12-0), 9 Miami (10-2), 10 USC (11-2), 11 Penn State (10-2), 12 Notre Dame (9-3) | 11 of 12 | Notre Dame | Washington |
| 2018 | 1 Alabama (13-0), 2 Notre Dame (12-0), 3 Clemson (13-0), 4 Georgia (11-2), 5 LSU (9-3), 6 Ohio State (12-1), 7 Oklahoma (12-1), 8 UCF (12-0), 9 Michigan (10-2), 10 Kentucky (9-3), 11 Florida (9-3), 12 Washington (10-3) | 11 of 12 | Kentucky | Penn State |
| 2019 | 1 LSU (13-0), 2 Ohio State (13-0), 3 Clemson (13-0), 4 Georgia (11-2), 5 Auburn (9-3), 6 Florida (10-2), 7 Alabama (10-2), 8 Oklahoma (12-1), 9 Oregon (11-2), 10 Penn State (10-2), 11 Wisconsin (10-3), 12 Memphis (12-1) | 10 of 12 | Auburn, Alabama | Utah, Baylor |
| 2020 | 1 Alabama (11-0), 2 Texas A&M (8-1), 3 Notre Dame (10-1), 4 Ohio State (6-0), 5 Georgia (7-2), 6 Clemson (10-1), 7 Indiana (6-1), 8 Coastal Carolina (11-0), 9 Florida (8-3), 10 Cincinnati (9-0), 11 Oklahoma (8-2), 12 Oregon (4-2) | 11 of 12 | Coastal Carolina | Iowa State |
| 2021 | 1 Alabama (12-1), 2 Georgia (12-1), 3 Michigan (12-1), 4 Cincinnati (13-0), 5 Ole Miss (10-2), 6 Notre Dame (11-1), 7 Michigan State (10-2), 8 Ohio State (10-2), 9 Baylor (11-2), 10 Oklahoma State (11-2), 11 Pittsburgh (11-2), 12 Utah (10-3) | 12 of 12 | none | none |
| 2022 | 1 Georgia (13-0), 2 Michigan (13-0), 3 Ohio State (11-1), 4 TCU (12-1), 5 Tennessee (10-2), 6 Alabama (10-2), 7 Penn State (10-2), 8 USC (11-2), 9 Clemson (11-2), 10 Kansas State (10-3), 11 Utah (10-3), 12 Tulane (11-2) | 12 of 12 | none | none |
| 2023 | 1 Washington (13-0), 2 Michigan (13-0), 3 Florida State (13-0), 4 Alabama (12-1), 5 Ohio State (11-1), 6 Georgia (12-1), 7 Texas (12-1), 8 Ole Miss (10-2), 9 Missouri (10-2), 10 Penn State (10-2), 11 Oregon (11-2), 12 Liberty (13-0) | 12 of 12 | none | none |
| 2024 | 1 Oregon (13-0), 2 Georgia (11-2), 3 Texas (11-2), 4 Notre Dame (11-1), 5 Penn State (11-2), 6 Indiana (11-1), 7 Ohio State (10-2), 8 Tennessee (10-2), 9 South Carolina (9-3), 10 Boise State (12-1), 11 Arizona State (11-2), 12 Clemson (10-3) | 11 of 12 | South Carolina | SMU |
| 2025 | 1 Indiana (13-0), 2 Texas A&M (11-1), 3 Georgia (12-1), 4 Ohio State (12-1), 5 Oregon (11-1), 6 Ole Miss (11-1), 7 Oklahoma (10-2), 8 Alabama (10-3), 9 BYU (11-2), 10 Texas Tech (12-1), 11 James Madison (12-1), 12 Duke (8-5) | 10 of 12 | BYU, James Madison | Tulane, Notre Dame |

**For your eyes only: against the committee.** The comparison takes the committee's final ranking and runs it through the same 2026 rules, so it measures the ranking, not the format. Average agreement is 10.9 of 12; 2021, 2022 and 2023 are identical. The differences have a pattern: the résumé score likes teams with many wins against hard schedules more than the committee did (Auburn and Alabama 2019, South Carolina 2024, BYU 2025) and likes conference runners-up with a late loss less (Florida State 2015 and 2016, Baylor 2019, SMU 2024, Notre Dame 2025). Seeds, résumé scores and the committee's rank for every team are in `out/retro_fields.md`.

**The simulator.** From before week 1 and after every week of 2016–2025 it plays out the rest of the regular season and the title games 20,000 times (game results drawn from the power ratings, each rating jittered by its measured uncertainty, which falls from 6.7 points before the season to 1 point by the end), then applies the résumé score and the rules.

| predicted chance of making the field | team-weeks | mean prediction | made our retroactive field | gap |
|---|---:|---:|---:|---:|
| (-0.001, 0.01] | 12,408 | 0.1% | 0.3% | +0.2% |
| (0.01, 0.05] | 2,775 | 2.6% | 2.7% | +0.2% |
| (0.05, 0.1] | 1,184 | 7.2% | 8.3% | +1.1% |
| (0.1, 0.2] | 1,128 | 14.1% | 12.1% | -2.1% |
| (0.2, 0.3] | 569 | 24.4% | 20.4% | -4.0% |
| (0.3, 0.4] | 403 | 34.8% | 30.3% | -4.5% |
| (0.4, 0.5] | 320 | 44.7% | 46.6% | +1.8% |
| (0.5, 0.6] | 254 | 54.6% | 48.8% | -5.8% |
| (0.6, 0.7] | 229 | 65.0% | 71.6% | +6.6% |
| (0.7, 0.8] | 198 | 75.1% | 76.8% | +1.7% |
| (0.8, 0.9] | 222 | 84.8% | 89.2% | +4.4% |
| (0.9, 1.0] | 488 | 97.2% | 98.8% | +1.6% |

Teams given 30–40% made our field 30% of the time; teams given 60–70%, 72%. The largest miss in any band is 6.6 points and the average, weighted by how many teams are in each band, is 0.8. It also produces bye, hosting and conference-title odds. Chart: `charts/sim_calibration.png`. Simplifications to know about: division and title-game tiebreakers are broken at random rather than by rulebook, and the résumé inside the simulation uses the ratings as they stood that week.

**Conference standings (step 16): ESPN's order cannot be trusted where there is a tie.** ESPN's records are right (they match the game results for all 67 Power 4 teams). Its ordering is not a rulebook: the list comes back sorted by *overall* record, and the seed field underneath is conference record, then a count of head-to-head wins inside the tied group, then overall record, then the alphabet (that rule reproduces all 67 seeds). No Power 4 tiebreaker uses overall record or a head-to-head count that way. Today it does not matter at the top: the top two of each league are separated by conference record or a single head-to-head (ACC Miami and Wake Forest; Big 12 Utah and Texas Tech; Big Ten UCLA and Indiana; SEC Georgia, then Alabama over Kentucky head-to-head). It does matter one step down: the Big 12 has five teams at 4-2 of whom only 2 of 10 pairs have met, and the Big Ten has six at 4-2 where ESPN seeds two head-to-head losers above the teams that beat them. **Recommendation:** use ESPN for records only; compute the order ourselves (head-to-head, then record against common opponents, then opponents' conference record) and print "tiebreaker not settled" when those run out. Evidence: `out/standings_2026.md`.

## 7. Headshots

The headshot address was checked for all 1,147 players on the 2026 rosters of ten teams across tiers: **97.7% exist.** Ohio State, Georgia, Texas Tech and Notre Dame 100%; Boise State 99.1%; Tulane 98.3%; James Madison 98.2%; Toledo 98.1%; Clemson 97.5%; Kennesaw State 85.5%. By group: offensive line 99.0%, defence 98.1%, skill positions 97.2%, specialists 94.3%. The roster feed's own headshot field was never wrong when present (1,114 of 1,114), so the build can trust it and use the initials badge otherwise. Detail: `out/headshots.md`.

## 8. The call budget

**This run.** CFBD: 2 calls reached CFBD (the key check and one talent check; the ledger shows 3 because a first attempt failed on a certificate before leaving the Mac and was counted anyway). The meter read 462 before and 461 after. ESPN: about 1,500 calls, of which 1,147 were headshot checks; none failed.

**Why 2 and not 51.** The key is the basketball key, as expected, and the shared meter was already down to 462 on Nov 10. College Basketball Savant refuses to call once the meter reads 400, so this run had about 60 calls of real headroom and each one came out of the live product. Meanwhile the release files turned out to hold conferences by season (identical to CFBD's for all 134 teams of 2024), a talent table, returning production, and the committee's weekly rankings. So the 49 other calls were not made.

**A live season, per week (ESPN, no quota):** 7 scoreboards; about 75 games at 2 calls each (summary and plays), 3 with re-checks; 138 roster calls; about 10 standings calls. Roughly **350–400 a week, 1,600 a month,** plus a one-time 2026 backfill of about 1,900. Headshots need no calls.

**A live season, per month (CFBD): about 15–40,** well under 300: the portal weekly (daily in the two windows), and once a year recruiting, talent, coaches and the draft. The one-time history pull is about 60–80 calls. **The real limit is not 300.** Basketball's guard means the two products share about 600 calls a month, not 1,000, and basketball used 538 in the first ten days of November. Decision needed (section 9).

## 9. Judgment calls, and checks that failed

**Checks that failed, and what was done.**

1. **Play-by-play gate, 2021 and 2022** (96.4%, 95.4%). Cause: the release files lack 28 and 36 games; ESPN has them. Not fixed in this run; the seasons are out of the player study and flagged in the team study.
2. **Defender-id gate for interceptions, 2021–2023 and 2025–2026** (42–77% in the plays). Cause: ESPN's text often says only "pass intercepted". Fixed: interception counts now come from the box score, which names every one. Found on the way: ESPN's play participants put four of Antoine Winfield Jr.'s seven 2019 interceptions on another athlete's id, so the box score is the better source even where the plays do name someone.
3. **2013 sacks.** ESPN's 2013 text has no sacks. Not fixable from this source; 2013 is outside the study.
4. **The release betting table** is 88% empty for 2014–2022. Worked around with the classic file's line.
5. **The classic FBS file is not the clean one.** Its play id is stored as a decimal and loses its last digits, so plays cannot be matched to ESPN's by id. It was used only for the spread and for the PPA comparison.
6. **AP first-team overlap** (step 13): not done for ten of twelve seasons, partly for two. The award-winner check stands in for it.
7. **The machine ran out of disk twice.** To finish, I deleted three of my own downloads: the classic file, the game rosters and the raw ESPN play-by-play (about 2.4 GB, all re-downloadable with `pipeline/cfb/pull_releases.sh`). Nothing of yours was touched. Two things could not be re-run afterwards: `ep.py report` (its results are saved) and a rebuild of the play tables.

**Judgment calls for you to confirm or overturn.**

1. **Defender value uses average play values, not each play's own EPA.** A sack is worth the season's average sack, and so on. The count version is more reliable (0.56 against 0.46 for linemen) and works from the box score. Run stops are in; they come from the play text even in 2024–2025 (80–88% of tacklers named).
2. **A defender's denominator is every defensive play of his team's season,** because nothing says which games he played. A missed game costs him, as the research asked.
3. **Receiver value is per team dropback, not per target,** and un-named incompletions are shared among a team's receivers in proportion to catches. Per target, a 150-target season earned nothing for its volume, and Nick Nash, an AP first-team receiver in 2024, ranked 353rd.
4. **Replacement level is the 25th-percentile qualified player at the position** (the Football Savant and College Basketball Savant convention), not "the 80th-best quarterback by playing time".
5. **Quarterbacks own the Savant Heisman under this definition.** Options: accept it; rank the Heisman by value relative to position; or use the shared-credit value. I did not choose.
6. **The Pac-12 champion gets an automatic bid through 2023,** when it was a power conference, and competes for the Group of Six bid from 2024. A switch reverses it. The Group of Six bid goes to the highest-ranked team, champion or not, as the CFP's page says; that is also a switch.
7. **Which conference seasons had no title game** is a small hand-entered table (American 2014; Big 12 2014–2016; Sun Belt 2014–2017 and 2020; Pac-12 2024–2025). Title games are otherwise found as the championship-weekend game between the two best conference records.
8. **An FCS opponent is rated a flat 22 points below an average FBS team** for the résumé score. Ratings, predictions and the EP model use FBS-vs-FBS games only.
9. **Explosive means a run of 12+ yards or a pass of 16+;** success is Connelly's 50% / 70% / 100% of the distance by down; overtime plays are left out of rate stats; TD is worth 7.
10. **scikit-learn instead of xgboost** for the EP model, because xgboost needs a system library neither this Mac nor the cloud runner has installed.
11. **Talent and returning production came from the release files,** which compute their own versions. The talent table is not the 247 composite. Our own returning production, from rosters, was not built.
12. **Two team-verdict thresholds are mine:** 6 games for a full bar and 12 for hatched. The player thresholds are the research doc's 0.5, with 0.3 and 0.15 added below it.
13. **Scrambles cannot be separated from designed runs:** the play text says "scramble" about 100 times a season. QB rushing is one number.

## 10. Recommended stat list for prompt 2

**Quarterback.** Full bars: EPA per dropback, success rate, sack rate, yards per attempt, completion rate, explosive pass rate, total EPA per play. Hatched: passing-down and standard-down EPA, rushing EPA per rush and per play. CONTEXT: interception rate (labelled luck-heavy), usage, schedule faced, garbage-time share. Not tracked: completion % over expected before 2025; scrambles separately.

**Running back.** Hatched: EPA per rush, success rate, explosive run rate, stuff rate, yards per rush. CONTEXT: share of team rushes, receiving EPA per team dropback.

**Receiver and tight end.** Full bars: yards per team pass attempt, receiving EPA per team dropback (hatched for tight ends). Hatched: yards per catch, explosive catch rate. CONTEXT: catches per team attempt; and from 2025 only, in games that name targets, target share, catch rate and EPA per target. Before 2025 those three show "not tracked".

**Defensive line and linebacker.** Full bars: tackles for loss, run stops and disruptive plays, all per 100 team defensive plays; sacks are a full bar for linemen and hatched for linebackers. From 2024: box-score tackles for loss (full bar) and QB hurries (full bar for linemen, hatched for linebackers). Hatched: disruption EPA; linebacker passes defensed. CONTEXT: tackles; linebacker interceptions. Dropped: forced fumbles as a bar (show the count).

**Defensive back.** Hatched: passes defensed. CONTEXT: interceptions, tackles, disruptive plays. Every card needs the line the research already planned: this credits playmakers, not a corner who was never thrown at.

**Specialists.** Kicker: field goals over expected, shown shrunk and labelled noisy. Punter: punt EPA over expected, CONTEXT.

**Team page.** Full bars: success rate (offence, defence, and passing offence), offence EPA per play. Hatched: defence EPA per play, the pass and rush splits, explosive play rate, stuff rate, line yards, sack rate allowed, third-down rate on offence, havoc allowed, penalties. CONTEXT: explosiveness, points per trip inside the 40, red-zone touchdown rate, starting field position, special-teams EPA, defensive sack rate, defensive havoc, pace. Luck, labelled as luck: turnover margin, giveaways, takeaways, interception rates, fumbles lost, fumble recovery rate, interceptions per pass defensed. Show every efficiency stat opponent-adjusted, with the raw tick.

**What prompt 2 should do first, from this run.** (1) Pull the missing 2021–2022 games from ESPN. (2) Build an identity layer: ESPN sometimes splits one player across two athlete ids. (3) Take interception counts from the box score. (4) Settle the CFBD quota with basketball before pulling recruiting, the portal and coaches. (5) Decide what the historical defensive teams may show before 2024. (6) Refit the EP model with 2025 in it.

