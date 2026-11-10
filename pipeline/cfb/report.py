"""Step 18. Assemble research/cfb/BACKTEST.md from the result tables the other modules wrote.

    python -m pipeline.cfb.report

The words are written here; every table and every number in a table is read
from research/cfb/out/, so the report cannot drift from the results.
"""
import json
import pandas as pd
from .paths import OUT, REPO

J = lambda name: json.loads((OUT / name).read_text())
M = lambda name: (OUT / name).read_text().strip()


def completeness_table():
    t = pd.read_csv(OUT / "completeness.csv")
    rows = ["| season | FBS-vs-FBS games | with play-by-play | final score matches | passer id | rusher id | receiver id on catches | receiver id on incompletions | sack: defender id | interception: id in plays | interception: id in box score | pass break-ups found per game | tackler id on ordinary plays | games with a defensive box score | verdict |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    p = lambda v: "n/a" if pd.isna(v) else f"{v:.0%}" if v in (0, 1) else f"{v:.1%}"
    for _, r in t.iterrows():
        rows.append(f"| {int(r.season)} | {int(r.fbs_games)} | {p(r.pbp_share)} | {p(r.score_match)} | {p(r.passer_id)} | {p(r.rusher_id)} | "
                    f"{p(r.receiver_id_comp)} | {p(r.receiver_id_inc)} | {p(r.sack_def_id)} | {p(r.int_def_id)} | {p(r.int_box_coverage)} | "
                    f"{r.pbu_plays_per_game:.1f} | {p(r.tackler_id_ordinary)} | {p(r.box_def_games)} | {r.verdict} |")
    return "\n".join(rows)


def fields_compact():
    r = J("retro_fields.json")
    rows = ["| season | our 12, in seed order (record) | same as the committee's ranking under the same rules | in ours, not theirs | in theirs, not ours |",
            "|---|---|---:|---|---|"]
    for y, v in r.items():
        f = ", ".join(f"{x['seed']} {x['school']} ({x['record']})" for x in v["field"])
        rows.append(f"| {y} | {f} | {v['same_teams']} of 12 | {', '.join(v['in_ours_not_committee']) or 'none'} | {', '.join(v['in_committee_not_ours']) or 'none'} |")
    return "\n".join(rows), sum(v["same_teams"] for v in r.values()) / len(r)


def value_table():
    t = pd.read_csv(OUT / "value_stability.csv")
    rows = ["| position | qualified players a season | year-to-year r of Savant value | of the underlying rate | transfers only (n) | spread of value (sd, points) |",
            "|---|---:|---:|---:|---:|---:|"]
    f = lambda v: "" if pd.isna(v) else f"{v:.2f}"
    for _, r in t.iterrows():
        rows.append(f"| {r.slot} | {r.qualified_per_season:.0f} | {f(r.r_value)} | {f(r.r_rate)} | {f(r.r_value_transfers)} ({int(r.n_transfers)}) | {r.sd_value:.1f} |")
    return "\n".join(rows)


def main():
    ep, rt, vr, sc = J("ep_report.json"), J("rating_backtest.json"), J("value_report.json"), J("sim_calibration.json")
    gc = J("garbage_choice.json")
    ftab, fmean = fields_compact()
    ls = ep["level_shift"]
    aw = vr["awards"]
    ap = vr.get("ap_partial", {})
    cr = vr["credit_by_position"]
    L = []
    A = L.append
    A("# College Football Savant: data pull and stability backtest")
    A("")
    A("*Run of Nov 10, 2026, on branch `cfb-savant-research`. Research only: no page, no connector change, no workflow, nothing in `public/`. "
      "Everything here was computed by the code in `pipeline/cfb/`; the tables behind it are in `research/cfb/out/` and the charts in `research/cfb/charts/`.*")
    A("")
    A("## Summary")
    A("")
    A("1. **The data is good enough for teams and for offensive players, and thinner than hoped for defenders.** Team stats are usable for every season from 2014 to 2025. "
      "Player stats are usable for 2014–2020 and 2023–2025; 2021 and 2022 fall just under the play-by-play gate (96.4% and 95.4% of games against a 97% bar), and ESPN itself still serves those missing games, so prompt 2 can backfill them. "
      "Before 2024 a defender's tackles, tackles for loss and pass break-ups are only as complete as his school's stat crew made the play text, so defenders from different schools are not comparable in those seasons. From 2024 the box score fixes that.")
    A(f"2. **Our expected-points model is calibrated and agrees with the outside models.** On held-out 2025 plays its predictions are within {ep['ep_max_decile_gap']:.2f} points of what happened in every decile. "
      f"Team-season offence by our EPA correlates {ep['ppa_team_season']['r_ours_vs_release']:.2f} with the release files' EPA and {ep['ppa_team_season']['r_ours_vs_cfbd_ppa']:.2f} with CFBD's PPA.")
    A("3. **The stability verdicts came out the way the research predicted.** Success rate is the steadiest team measure (reliable after about 5 games); explosiveness per successful play is not (20 games); "
      "turnovers and fumble recoveries behave like luck, and red-zone touchdown rate is nearly as noisy. For players, QB efficiency, sack rate and yards per attempt earn full bars; RB rates are hatched; "
      "EPA per target and catch rate are too noisy to be bars; a receiver's yards and EPA per team dropback are solid. Interception rate (QBs and defenders), forced fumbles and field-goal accuracy are mostly noise in one season.")
    A(f"4. **The power rating passes its bar.** Predicting every FBS-vs-FBS game of 2016–2025 from earlier games only, it misses the final margin by {rt['mae_ours']:.2f} points on average, "
      f"against {rt['mae_fpi']:.2f} for ESPN FPI and {rt['mae_spread']:.2f} for the closing spread: {rt['gap_to_fpi']:.2f} behind FPI, inside the 0.5 allowed. "
      f"On the five seasons its constants never saw (2021–2025) the gap is {rt['untouched_seasons_2021_2025']['ours'] - rt['untouched_seasons_2021_2025']['fpi']:.2f}.")
    A(f"5. **Savant value is stable enough at every position except defensive back, kicker and punter, and quarterbacks dominate it.** Year-to-year correlation runs from 0.47 (QB, edge, OL unit) down to about 0.2 (CB, S, K, P). "
      f"About {vr['top50_mix_per_season'].get('QB', 0):.0f} of the top 50 players each season are quarterbacks, so the Savant Heisman would be a quarterback every year. "
      f"Of {aw['winners_checked']} major position-award winners, {aw['on_first_team']:.0%} are on our first team and {aw['on_any_team']:.0%} on one of our three. "
      "**The AP first-team overlap could not be done properly:** no permitted source holds the AP teams (see section 9).")
    A(f"6. **The objective playoff field works.** Under the 2026 rules our résumé score picks, on average, {fmean:.1f} of the same 12 teams the committee's own final ranking would produce under those rules. "
      f"The simulator's odds are honest: across {sc['runs']} weekly runs of 20,000 simulations, no probability band is off by more than {sc['max_bin_gap'] * 100:.0f} points.")
    A("7. **Headshots: 97.7% of 1,147 players on ten 2026 rosters have one.** The roster feed's own headshot field predicts it, so the build needs no extra checks.")
    A("8. **Calls: 2 CFBD calls were made, not 51.** The shared meter read 462 on this run's first call and College Basketball Savant's own guard stops at 400, so every call here came out of the live basketball product's month. "
      "The release files already held nearly everything the calls were for.")
    A("9. **The six things that most need your decision** are in section 9: defenders before 2024, the receiver-value definition, quarterbacks owning the Heisman, the Pac-12's status in old seasons, the CFBD quota, and the AP table.")
    A("")
    A("---")
    A("")
    A("## 1. What data exists, by season")
    A("")
    A("**Sources.** History is the sportsdataverse-data release files (free, no key): 18 file families, 2.5 GB as parquet, inventoried in `out/inventory.md`. "
      "ESPN-derived play-by-play runs 2004–2026 (506 columns), play participants 2014–2026, box scores, drives, rosters, schedules, lines, ESPN FPI game predictions (2015 on), and the weekly AP, coaches and CFP committee polls.")
    A("")
    A("**Two gates** decide what a season can be used for: play-by-play on at least 97% of FBS-vs-FBS games, and a defender id on at least 80% of sacks and of interceptions. "
      "*(A \"defender id\" is ESPN's athlete number attached to the play, which is what lets a sack be credited to a player.)*")
    A("")
    A(completeness_table())
    A("")
    A("**What the table means.**")
    A("")
    A("1. **Teams: 2014–2025 all usable** (2009–2012 also pass, which matters for backfilling later). 2021 and 2022 are flagged at 96.4% and 95.4% of games; they stay in the team study and the ratings, and are out of the player study, as the rule says.")
    A("2. **Players: 2014–2020 and 2023–2025.** 2013 fails for a reason worth knowing: ESPN's 2013 play text records almost no sacks at all (55 in the whole season), so sack rate and dropback counts cannot be built for that year.")
    A("3. **The missing 2021–2022 games exist at ESPN.** We asked ESPN's play feed for eight of them; all eight returned plays (three look partial). Prompt 2 can pull them directly.")
    A("4. **Offensive ids are excellent everywhere:** passer and rusher above 99% from 2014, receiver above 99% on catches.")
    A("5. **Incompletions usually name no target.** Before 2025 only 14–32% of games name the intended receiver on incompletions (68% of games in 2025, 71% in 2026). This is why catch rate and EPA per target cannot be trusted before 2025.")
    A("6. **Defender credit depends on the season and the school.** Sacks are named on 86–99% of plays in every study season. Interceptions are named in the plays only 42–89% of the time from 2021, but the box score names every one, so interception counts come from the box score. "
      "Pass break-ups were found at 5–6 a game through 2020, then 1–2 a game in 2021–2024 (the text stopped saying who broke up the pass), and are back from 2025. "
      "Tacklers are named on 40% of ordinary plays in 2014, rising to 85% in 2025 and 91% in 2026. A full defensive box score (tackles, tackles for loss, passes defensed, QB hurries) exists for essentially every game only from 2024.")
    A("7. **QB hurries exist only in the box score, from 2024.** No play feed, live or historical, names who hurried the quarterback.")
    A("8. **Fumbles are under-reported in the play text in 2021–2023** (0.75–1.07 lost a game against 1.10–1.24 in the team box), so team turnovers are read from the team box score in every season.")
    A("9. **Games played are unknown.** The game-roster files list the whole roster every week with no did-not-play flag, and there are no snap counts. Rates are per team play, dropback, target or rush.")
    A("")
    A("**The ESPN live check (step 3).** The live ESPN feed was compared with the release files on 38 games from one 2025 Saturday and one 2026 Saturday, across nine conferences (`out/espn_live_check.md`). "
      "The live feed carries the same 17 participant roles as the release files, every participant has an athlete id, and the ids agree on 99.4–100% of cells. "
      "Coverage did not differ by conference tier. Two things to carry into the build: the intercepting defender arrives under the role `passDefender`, and is missing on interceptions with no return in the 2026 text format (9 of 19 named), so the box score stays the source for interceptions; "
      "and DraftKings lines appear in the game summary for 2026 games but not for 2025 games. About 90 calls for the comparison; median response 254 ms.")
    A("")
    A("**Lines and FPI.** The release betting table is empty for about 88% of 2014–2022 games, so the closing spread comes from the classic FBS file's line (97–99% of games), with ESPN's where it exists. ESPN's FPI pre-game margin exists from 2015.")
    A("")
    A("## 2. The expected-points model")
    A("")
    A("*Expected points (EP) is the average value of the next score given the down, distance, field position, clock, score and site. EPA, expected points added, is how much a play changed it.* "
      "Ours is fitted on 1.3 million FBS-vs-FBS plays from 2014–2024 and tested on 2025, which it never saw.")
    A("")
    A("1. **Calibration on 2025.** In every tenth of plays, sorted by predicted EP, the prediction is within " + f"{ep['ep_max_decile_gap']:.2f}" + " points of what actually happened (average miss " + f"{ep['ep_weighted_gap']:.2f}" + "). "
      "The release files' own EP, on the same plays, is off by up to " + f"{ep['release_ep_max_decile_gap_2025']:.2f}" + ". Our small remaining bias is real drift: field goals were the next score more often in 2025 (19.2%) than the 2014–2024 model expects (17.6%). The model should be refitted each off-season.")
    A("2. **Win probability.** *(The chance the team with the ball wins, from score, clock, field position and the pregame spread.)* Within " + f"{ep['wp_max_decile_gap'] * 100:.1f}" + " percentage points in every decile on 2025.")
    A(f"3. **Against the other models.** Team-season offence: r = {ep['ppa_team_season']['r_ours_vs_release']:.3f} with the release EPA, r = {ep['ppa_team_season']['r_ours_vs_cfbd_ppa']:.3f} with CFBD's PPA (read from the classic file, no API call). Play by play, r = 0.94–0.98 with the release EPA. High, not identical, as expected.")
    A(f"4. **The 2004–2013 versus 2014+ level shift is real, and about half the size of the figure quoted in the research.** Our one model, applied to both eras, gives {ls['ours_2004_2013']:+.3f} EPA per scrimmage play in 2004–2013 and {ls['ours_2014_2024']:+.3f} in 2014–2024, a rise of {ls['ours_2014_2024'] - ls['ours_2004_2013']:.2f}; the release files' EPA rises {ls['release_2014_2024'] - ls['release_2004_2013']:.2f}. "
      "Yards per play rose over the same years (5.6–5.9 to 5.9–6.1) and scoring went from about 52 points a game to about 57 in 2012–2016, so offences did get better. There is no step at 2014 in either series, only a climb that starts around 2009, which is what a real change looks like and not what a data artifact looks like. The larger figure reported from CFBD's numbers (0.04 to 0.14) could not be checked here. Percentiles should still be computed within a season.")
    A("5. **Garbage time.** CFBD's documented rule (margin above 38 in the second quarter, 28 in the third, 22 in the fourth) removes about 8% of plays. A win-probability rule (under 2% or over 98%) removes about 19%, including nearly half of all fourth-quarter plays. **Chosen: CFBD's rule.** " + gc["why"])
    A("")
    A("Full tables: `out/ep_report.md`. Chart: `charts/ep_wp_calibration.png`.")
    A("")
    A("## 3. The stability verdict")
    A("")
    A("**How to read it.** *Reliability* is how well one half of a season predicts the other, stepped up to a full season: 1.0 is pure signal, 0 is pure noise. "
      "*Settle point* is the sample at which a player's own number and the average for his position deserve equal weight. *Year-to-year* is the correlation between consecutive seasons.")
    A("")
    A("**Verdicts.** Teams: **full bar** if the stat is half signal within 6 games, **hatched** within 12, otherwise **CONTEXT**; turnover-type stats that fail are **luck**. "
      "Players: **full bar** at full-season reliability of 0.5 or more for a typical qualified player, **hatched** from 0.3, **CONTEXT** from 0.15, **dropped** below. Usage shares are CONTEXT whatever their reliability, because they say how much, not how good.")
    A("")
    A("### Teams (2014–2025, garbage time out, 200 random splits)")
    A("")
    A(M("team_stability.md"))
    A("")
    A("**What stands out.**")
    A("")
    A("1. Success rate is the most stable efficiency measure on both sides of the ball; EPA per play is close behind. Passing is steadier than rushing on offence, the reverse on defence.")
    A("2. Explosiveness (EPA per successful play) needs 14–20 games to be half signal and does not predict later results at all. Explosive play *rate* is much better behaved.")
    A("3. Turnovers are luck: turnover margin needs 33 games, fumble recovery rate has no signal whatever (reliability −0.04, year-to-year −0.02).")
    A("4. **No single stat beats raw scoring margin at predicting later games.** Net success rate and net EPA match it; nothing exceeds it. The gain comes from opponent adjustment (next table) and from combining them, which is what the power rating does.")
    A("5. Havoc and interceptions per pass defensed are measured only on seasons where pass break-ups were visible (2014–2020, 2025).")
    A("")
    A("**Opponent adjustment (step 8)** beats raw at every week tested, by 0.03–0.05 in correlation with later margins:")
    A("")
    A(M("opponent_adjustment.md"))
    A("")
    A("### Players (2014–2020 and 2023–2025)")
    A("")
    A(M("player_stability.md"))
    A("")
    A("**What stands out.**")
    A("")
    A("1. The two ways of finding a settle point (the grid search `settle_points.py` uses, and Football Savant's formula) agree closely for almost every stat, which is the best evidence the numbers are right. Both are in `out/player_stability.csv`.")
    A("2. **Quarterbacks:** efficiency, success rate, sack rate, yards per attempt and completion rate are full bars, settling at about 190–250 dropbacks. Interception rate needs about 1,200 attempts: it is noise in one season. Sack rate travels with the quarterback when he transfers (0.51) better than anything else he does.")
    A("3. **Running backs:** every rate is hatched (settle points of 160–270 rushes against a typical 127), and little of it survives a transfer (0.05–0.18), which says a running back's efficiency is largely his line and scheme.")
    A("4. **Receivers:** EPA per target (reliability 0.16) and catch rate (0.32) fail, partly because most games do not name incompletion targets. Yards per team pass attempt (0.79) and receiving EPA per team dropback (0.57) pass easily: earning targets is the repeatable skill.")
    A("5. **Defenders:** sacks, tackles for loss and run stops are full bars for linemen. For linebackers, tackles for loss and run stops are full bars and sacks just miss (0.49, hatched). QB hurries (box score, two seasons only) are a full bar for linemen. Interceptions and passes defensed are weak (0.2–0.5); forced fumbles are noise. For defensive backs nothing reaches 0.5.")
    A("6. **Opponent adjustment helps transfers** on 16 of the 19 stats where it could be tested (for example QB EPA per dropback: 0.24 against 0.20 raw). It did not help defensive-line sacks, tight-end receiving or linebacker interceptions. Transfer samples are small (30–350 players), so treat the losers as unproven rather than disproven.")
    A("7. **Kickers:** field goals over expected has reliability 0.08 on a typical 17 attempts. It can be shown, but only as a heavily shrunk number.")
    A("")
    A("## 4. Power rating accuracy")
    A("")
    A("The rating is opponent-adjusted offence and defence (a blend of EPA per play and success rate, ridge regression, scaled to points), plus special teams, shrunk toward a preseason number built from last season, team talent and returning production. "
      "Each week's games are predicted from earlier weeks only. Its three tuned constants were chosen on 2016–2020 and left alone for 2021–2025.")
    A("")
    A(M("rating_backtest.md"))
    A("")
    A(f"**Result: {rt['mae_ours']:.2f} against FPI's {rt['mae_fpi']:.2f}, a gap of {rt['gap_to_fpi']:.2f}. The bar (within 0.5) is met.** It picks the winner {rt['winner_right']['ours']:.1%} of the time (FPI {rt['winner_right']['fpi']:.1%}, spread {rt['winner_right']['spread']:.1%}) and correlates {rt['corr_ours_fpi']:.2f} with FPI. "
      "What moved it during tuning: almost nothing. Recency weighting did not help (the best setting barely discounts old games), and the blend of EPA and success rate mattered by under 0.05 points. The largest remaining gap to FPI is in the first four weeks (0.35), which is the preseason number: ours uses a talent figure from the release files that is *not* the 247 composite (it correlates only 0.79 with CFBD's), and no recruiting or portal data. That is where prompt 2 can gain.")
    A("")
    A("Chart: `charts/rating_backtest.png`. Weekly ratings for 2014–2026 are saved for the résumé and the simulator.")
    A("")
    A("## 5. Savant value, positions and the All-Savant dry run")
    A("")
    A("**Stability by position** (qualified players in consecutive usable seasons):")
    A("")
    A(value_table())
    A("")
    A(f"1. **Passes:** QB, RB, WR, TE, edge, interior line, linebacker and the OL unit (0.31–0.47). **Weak:** corner 0.20, safety 0.25, punter 0.21, kicker 0.14. A defensive back's value is built on interceptions and break-ups, which section 3 showed are mostly noise in one season. Every defender card should say so.")
    A(f"2. **Quarterbacks dominate the top 50: about {vr['top50_mix_per_season'].get('QB', 0):.0f} of 50 a season,** then receivers ({vr['top50_mix_per_season'].get('WR', 0):.0f}) and running backs ({vr['top50_mix_per_season'].get('RB', 0):.0f}). That is real under this definition (a quarterback is credited with 400–600 plays), not a bug, and it does not affect the All-Savant teams, which are picked position by position. It does mean the Savant Heisman is a quarterback in all ten seasons.")
    A("3. **How much of a player's number travels with him** (transfers against players who stayed): " + ", ".join(f"{k} {v['credit']:.2f}" for k, v in cr.items()) + ". Quarterbacks and defensive linemen own most of their numbers; running backs and receivers own under half. A \"shared-credit\" value using these weights is saved beside the main one. It does not change the quarterback picture.")
    A("")
    A(f"**Positions (step 11).** ESPN lists about 7,000 player-seasons as plain \"DL\" and 7,000 as plain \"DB\". They were split using size and stat profile, trained on players ESPN does label: edge against interior is right {vr['positions']['DL?']['cross_validated_accuracy']:.0%} of the time on labelled players (weight does most of the work), corner against safety {vr['positions']['DB?']['cross_validated_accuracy']:.0%}. "
      "The 40 closest calls of 2025, and linebackers who rush like edges, are in `out/positions_borderline.md` for your review. ESPN marks class as FR/SO/JR/SR only, so a redshirt freshman is simply \"FR\", which is what the Freshman team wants.")
    A("")
    A("**The dry run (step 13).** National first, second and third teams, a team for each conference, a Freshman team and a Savant Heisman top five were built for all ten usable seasons: `out/all_savant_national.md` (readable) and `out/all_savant_teams.csv` (everything). The OL is a unit, named by school, because no free source says which five linemen started.")
    A("")
    A("**Sanity check against the major awards.** ESPN's awards feed gives the winners of 19 national awards with athlete ids (Heisman, Maxwell, O'Brien, Doak Walker, Biletnikoff, Mackey, Butkus, Thorpe, Bednarik, Nagurski, Hendricks, Groza, Ray Guy and others).")
    A("")
    A(M("awards_check.md"))
    A("")
    A(f"Overall {aw['on_first_team']:.0%} of {aw['winners_checked']} winners are on our first team, {aw['on_any_team']:.0%} on one of the three, and the typical winner ranks #{aw['median_slot_rank']:.0f} at his position. "
      "The Heisman winner ranks first overall in four of ten seasons and in the top five in seven; the three we have far lower are the non-quarterbacks (Derrick Henry, DeVonta Smith, Travis Hunter).")
    A("")
    A("**The pattern in the disagreements is the important part:** the misses before 2024 are overwhelmingly linebackers and defensive backs from big programmes (Roquan Smith, Devin White, Reuben Foster, Micah Parsons, Derrick Brown). "
      "Their schools' play text names few tacklers, so they were never credited. Our pre-2024 defensive teams lean toward schools with detailed stat crews, many of them outside the power conferences. **The 2014–2023 defensive All-Savant teams should not be published as they stand.**")
    A("")
    if ap:
        bits = "; ".join(f"{y}: {v['on_our_first_team']} of {v['ap_first_teamers_entered']} entered AP first-teamers on our first team, {v['on_any_of_our_teams']} on one of our three" for y, v in ap.items())
        A("**AP first-team overlap: not done as asked.** No permitted source carries the AP All-America teams (ESPN's awards feed has none, and the rules of this run bar scraping). Two seasons were partly hand-entered from news summaries, without offensive linemen, as a spot check only (`research/cfb/ap_first_team_partial.csv`): " + bits + ". "
          "To do this properly for all twelve seasons I need either a table from you or leave to fetch the twelve AP lists.")
    A("")
    A("## 6. The retroactive playoff fields and the simulator")
    A("")
    A("**Résumé score.** For each team: the chance that the 12th-best team by our power rating would have won at least as many games against the same schedule (exact Poisson-binomial sum). Lower is better; margin of victory never enters. "
      "The 2026 rules were then applied with each season's real conference champions.")
    A("")
    A(ftab)
    A("")
    A(f"**For your eyes only: against the committee.** The comparison takes the committee's final ranking and runs it through the same 2026 rules, so it measures the ranking, not the format. Average agreement is {fmean:.1f} of 12; 2021, 2022 and 2023 are identical. "
      "The differences have a pattern: the résumé score likes teams with many wins against hard schedules more than the committee did (Auburn and Alabama 2019, South Carolina 2024, BYU 2025) and likes conference runners-up with a late loss less (Florida State 2015 and 2016, Baylor 2019, SMU 2024, Notre Dame 2025). Seeds, résumé scores and the committee's rank for every team are in `out/retro_fields.md`.")
    A("")
    A("**The simulator.** From before week 1 and after every week of 2016–2025 it plays out the rest of the regular season and the title games 20,000 times (game results drawn from the power ratings, each rating jittered by its measured uncertainty, which falls from 6.7 points before the season to 1 point by the end), then applies the résumé score and the rules.")
    A("")
    A(M("sim_calibration.md"))
    A("")
    A(f"Teams given 30–40% made our field 30% of the time; teams given 60–70%, 72%. The largest miss in any band is {sc['max_bin_gap'] * 100:.1f} points and the average, weighted by how many teams are in each band, is {sc['weighted_abs_gap'] * 100:.1f}. It also produces bye, hosting and conference-title odds. Chart: `charts/sim_calibration.png`. "
      "Simplifications to know about: division and title-game tiebreakers are broken at random rather than by rulebook, and the résumé inside the simulation uses the ratings as they stood that week.")
    A("")
    A("**Conference standings (step 16): ESPN's order cannot be trusted where there is a tie.** ESPN's records are right (they match the game results for all 67 Power 4 teams). Its ordering is not a rulebook: "
      "the list comes back sorted by *overall* record, and the seed field underneath is conference record, then a count of head-to-head wins inside the tied group, then overall record, then the alphabet (that rule reproduces all 67 seeds). No Power 4 tiebreaker uses overall record or a head-to-head count that way. "
      "Today it does not matter at the top: the top two of each league are separated by conference record or a single head-to-head (ACC Miami and Wake Forest; Big 12 Utah and Texas Tech; Big Ten UCLA and Indiana; SEC Georgia, then Alabama over Kentucky head-to-head). "
      "It does matter one step down: the Big 12 has five teams at 4-2 of whom only 2 of 10 pairs have met, and the Big Ten has six at 4-2 where ESPN seeds two head-to-head losers above the teams that beat them. "
      "**Recommendation:** use ESPN for records only; compute the order ourselves (head-to-head, then record against common opponents, then opponents' conference record) and print \"tiebreaker not settled\" when those run out. Evidence: `out/standings_2026.md`.")
    A("")
    A("## 7. Headshots")
    A("")
    A("The headshot address was checked for all 1,147 players on the 2026 rosters of ten teams across tiers: **97.7% exist.** Ohio State, Georgia, Texas Tech and Notre Dame 100%; Boise State 99.1%; Tulane 98.3%; James Madison 98.2%; Toledo 98.1%; Clemson 97.5%; Kennesaw State 85.5%. By group: offensive line 99.0%, defence 98.1%, skill positions 97.2%, specialists 94.3%. "
      "The roster feed's own headshot field was never wrong when present (1,114 of 1,114), so the build can trust it and use the initials badge otherwise. Detail: `out/headshots.md`.")
    A("")
    A("## 8. The call budget")
    A("")
    A("**This run.** CFBD: 2 calls reached CFBD (the key check and one talent check; the ledger shows 3 because a first attempt failed on a certificate before leaving the Mac and was counted anyway). The meter read 462 before and 461 after. ESPN: about 1,500 calls, of which 1,147 were headshot checks; none failed.")
    A("")
    A("**Why 2 and not 51.** The key is the basketball key, as expected, and the shared meter was already down to 462 on Nov 10. College Basketball Savant refuses to call once the meter reads 400, so this run had about 60 calls of real headroom and each one came out of the live product. "
      "Meanwhile the release files turned out to hold conferences by season (identical to CFBD's for all 134 teams of 2024), a talent table, returning production, and the committee's weekly rankings. So the 49 other calls were not made.")
    A("")
    A("**A live season, per week (ESPN, no quota):** 7 scoreboards; about 75 games at 2 calls each (summary and plays), 3 with re-checks; 138 roster calls; about 10 standings calls. Roughly **350–400 a week, 1,600 a month,** plus a one-time 2026 backfill of about 1,900. Headshots need no calls.")
    A("")
    A("**A live season, per month (CFBD): about 15–40,** well under 300: the portal weekly (daily in the two windows), and once a year recruiting, talent, coaches and the draft. The one-time history pull is about 60–80 calls. "
      "**The real limit is not 300.** Basketball's guard means the two products share about 600 calls a month, not 1,000, and basketball used 538 in the first ten days of November. Decision needed (section 9).")
    A("")
    A("## 9. Judgment calls, and checks that failed")
    A("")
    A("**Checks that failed, and what was done.**")
    A("")
    A("1. **Play-by-play gate, 2021 and 2022** (96.4%, 95.4%). Cause: the release files lack 28 and 36 games; ESPN has them. Not fixed in this run; the seasons are out of the player study and flagged in the team study.")
    A("2. **Defender-id gate for interceptions, 2021–2023 and 2025–2026** (42–77% in the plays). Cause: ESPN's text often says only \"pass intercepted\". Fixed: interception counts now come from the box score, which names every one. Found on the way: ESPN's play participants put four of Antoine Winfield Jr.'s seven 2019 interceptions on another athlete's id, so the box score is the better source even where the plays do name someone.")
    A("3. **2013 sacks.** ESPN's 2013 text has no sacks. Not fixable from this source; 2013 is outside the study.")
    A("4. **The release betting table** is 88% empty for 2014–2022. Worked around with the classic file's line.")
    A("5. **The classic FBS file is not the clean one.** Its play id is stored as a decimal and loses its last digits, so plays cannot be matched to ESPN's by id. It was used only for the spread and for the PPA comparison.")
    A("6. **AP first-team overlap** (step 13): not done for ten of twelve seasons, partly for two. The award-winner check stands in for it.")
    A("7. **The machine ran out of disk twice.** To finish, I deleted three of my own downloads: the classic file, the game rosters and the raw ESPN play-by-play (about 2.4 GB, all re-downloadable with `pipeline/cfb/pull_releases.sh`). Nothing of yours was touched. Two things could not be re-run afterwards: `ep.py report` (its results are saved) and a rebuild of the play tables.")
    A("")
    A("**Judgment calls for you to confirm or overturn.**")
    A("")
    A("1. **Defender value uses average play values, not each play's own EPA.** A sack is worth the season's average sack, and so on. The count version is more reliable (0.56 against 0.46 for linemen) and works from the box score. Run stops are in; they come from the play text even in 2024–2025 (80–88% of tacklers named).")
    A("2. **A defender's denominator is every defensive play of his team's season,** because nothing says which games he played. A missed game costs him, as the research asked.")
    A("3. **Receiver value is per team dropback, not per target,** and un-named incompletions are shared among a team's receivers in proportion to catches. Per target, a 150-target season earned nothing for its volume, and Nick Nash, an AP first-team receiver in 2024, ranked 353rd.")
    A("4. **Replacement level is the 25th-percentile qualified player at the position** (the Football Savant and College Basketball Savant convention), not \"the 80th-best quarterback by playing time\".")
    A("5. **Quarterbacks own the Savant Heisman under this definition.** Options: accept it; rank the Heisman by value relative to position; or use the shared-credit value. I did not choose.")
    A("6. **The Pac-12 champion gets an automatic bid through 2023,** when it was a power conference, and competes for the Group of Six bid from 2024. A switch reverses it. The Group of Six bid goes to the highest-ranked team, champion or not, as the CFP's page says; that is also a switch.")
    A("7. **Which conference seasons had no title game** is a small hand-entered table (American 2014; Big 12 2014–2016; Sun Belt 2014–2017 and 2020; Pac-12 2024–2025). Title games are otherwise found as the championship-weekend game between the two best conference records.")
    A("8. **An FCS opponent is rated a flat 22 points below an average FBS team** for the résumé score. Ratings, predictions and the EP model use FBS-vs-FBS games only.")
    A("9. **Explosive means a run of 12+ yards or a pass of 16+;** success is Connelly's 50% / 70% / 100% of the distance by down; overtime plays are left out of rate stats; TD is worth 7.")
    A("10. **scikit-learn instead of xgboost** for the EP model, because xgboost needs a system library neither this Mac nor the cloud runner has installed.")
    A("11. **Talent and returning production came from the release files,** which compute their own versions. The talent table is not the 247 composite. Our own returning production, from rosters, was not built.")
    A("12. **Two team-verdict thresholds are mine:** 6 games for a full bar and 12 for hatched. The player thresholds are the research doc's 0.5, with 0.3 and 0.15 added below it.")
    A("13. **Scrambles cannot be separated from designed runs:** the play text says \"scramble\" about 100 times a season. QB rushing is one number.")
    A("")
    A("## 10. Recommended stat list for prompt 2")
    A("")
    A("**Quarterback.** Full bars: EPA per dropback, success rate, sack rate, yards per attempt, completion rate, explosive pass rate, total EPA per play. Hatched: passing-down and standard-down EPA, rushing EPA per rush and per play. "
      "CONTEXT: interception rate (labelled luck-heavy), usage, schedule faced, garbage-time share. Not tracked: completion % over expected before 2025; scrambles separately.")
    A("")
    A("**Running back.** Hatched: EPA per rush, success rate, explosive run rate, stuff rate, yards per rush. CONTEXT: share of team rushes, receiving EPA per team dropback.")
    A("")
    A("**Receiver and tight end.** Full bars: yards per team pass attempt, receiving EPA per team dropback (hatched for tight ends). Hatched: yards per catch, explosive catch rate. "
      "CONTEXT: catches per team attempt; and from 2025 only, in games that name targets, target share, catch rate and EPA per target. Before 2025 those three show \"not tracked\".")
    A("")
    A("**Defensive line and linebacker.** Full bars: tackles for loss, run stops and disruptive plays, all per 100 team defensive plays; sacks are a full bar for linemen and hatched for linebackers. From 2024: box-score tackles for loss (full bar) and QB hurries (full bar for linemen, hatched for linebackers). "
      "Hatched: disruption EPA; linebacker passes defensed. CONTEXT: tackles; linebacker interceptions. Dropped: forced fumbles as a bar (show the count).")
    A("")
    A("**Defensive back.** Hatched: passes defensed. CONTEXT: interceptions, tackles, disruptive plays. Every card needs the line the research already planned: this credits playmakers, not a corner who was never thrown at.")
    A("")
    A("**Specialists.** Kicker: field goals over expected, shown shrunk and labelled noisy. Punter: punt EPA over expected, CONTEXT.")
    A("")
    A("**Team page.** Full bars: success rate (offence, defence, and passing offence), offence EPA per play. Hatched: defence EPA per play, the pass and rush splits, explosive play rate, stuff rate, line yards, sack rate allowed, third-down rate on offence, havoc allowed, penalties. "
      "CONTEXT: explosiveness, points per trip inside the 40, red-zone touchdown rate, starting field position, special-teams EPA, defensive sack rate, defensive havoc, pace. "
      "Luck, labelled as luck: turnover margin, giveaways, takeaways, interception rates, fumbles lost, fumble recovery rate, interceptions per pass defensed. Show every efficiency stat opponent-adjusted, with the raw tick.")
    A("")
    A("**What prompt 2 should do first, from this run.** (1) Pull the missing 2021–2022 games from ESPN. (2) Build an identity layer: ESPN sometimes splits one player across two athlete ids. (3) Take interception counts from the box score. "
      "(4) Settle the CFBD quota with basketball before pulling recruiting, the portal and coaches. (5) Decide what the historical defensive teams may show before 2024. (6) Refit the EP model with 2025 in it.")
    A("")
    (REPO / "research" / "cfb" / "BACKTEST.md").write_text("\n".join(L) + "\n")
    print("written", len("\n".join(L)), "characters")


if __name__ == "__main__":
    main()
