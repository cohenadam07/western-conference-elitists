"""
config.py — the registry of every stat College Basketball Coaching Savant ranks or shows, and the
rules each season was played under. Nothing ships without an entry here; the page's registry and the
connector's data dictionary are both written from it (Basketball Coaching Savant's convention).

kind "good" is graded blue to red; "much" is a tendency, shown in neutral gold. `thr` is the settle
point: under it the bar is hatched. `first` is the first season the stat exists. Every percentile is
against all D1 head coaches with the stat that season (or, for careers, the career pool), unless the
stat names another pool.

Sample conventions: a college season is about 30 games, so the NBA build's half season (41) and full
season (82) become 15 and 30.
"""

ESPN = "ESPN play-by-play, 2013-14 on (College Basketball Savant's own parse)"
LINEUPS = "ESPN substitutions (2025-26 on) and CBBD's on-floor fives (2023-24, 2024-25), the games College Savant's lineup gate passes"
CBB = "College Basketball Savant (opponent-adjusted team ratings)"
VALUE = "College Basketball Savant's Savant value and its rate per 100 possessions"
WIKI = "Wikipedia program histories and team-season articles (facts only, each row linked)"
REC = "CollegeBasketballData recruiting composite (2007 on), as WCE's own class score and fits"
EADA = "U.S. Department of Education, Equity in Athletics (EADA): men's basketball expenses"
MODEL = "The model's view, not a verdict: it cannot see injuries it was not told about, development plans or match-ups."
G = 15     # half a season
S = 30     # a season


def X(key, label, group, kind, unit, lower, thr, first, what, formula, source, sample, sub=""):
    return dict(key=key, label=label, group=group, sub=sub, kind=kind, unit=unit, lower=lower, thr=thr, first=first,
                what=what, formula=formula, source=source, sample=sample)


STATS = [
    # ---------------------------------------------------------------- results and expectation
    X("winpct", "Win %", "record", "good", "pct1", False, S, "2002-03", "Winning percentage, every game his team played under him, postseason included, as the official record counts it. College Basketball Savant's team pages count D1-against-D1 games only, so a team that played a non-D1 opponent shows a different record there.", "W ÷ (W + L)", f"{ESPN}; {WIKI} before", f"Hatched under {S} games."),
    X("net", "Adjusted net rating", "record", "good", "sgn1", False, S, "2009-10", "Points scored minus allowed per 100 possessions, adjusted for every opponent: College Savant's own team rating.", "Adjusted offense − adjusted defense", CBB, f"Hatched under {S} games."),
    X("w_roster", "Wins above the roster", "record", "good", "sgn1", False, S, "2010-11", "Wins beyond what WCE's roster model expected from the players he had, read from last season before he coached them, summed over the schedule he actually played. The headline: it beat both naive baselines out of sample.", "Actual wins − Σ P(win) from the roster model's expected net (expect.py)", f"{VALUE}; {REC}", f"Hatched under {S} games. " + MODEL),
    X("net_roster", "Net above the roster", "record", "good", "sgn1", False, S, "2010-11", "Adjusted net rating minus the roster model's expected net, in points per 100 possessions.", "Adjusted net − expected net", f"{VALUE}; {CBB}", f"Hatched under {S} games. " + MODEL),
    X("w_spread", "Wins above the spread", "record", "good", "sgn1", False, S, "2013-14", "Wins beyond what the closing spreads implied, game by game, added up (football Coaching Savant's method).", "Σ (won − P(win | spread)); P from D1's empirical curve", "ESPN's archived line; CBBD's lines for 2023-24 and 2024-25", f"Hatched under {S} games with a line."),
    X("ats", "Against the spread", "record", "good", "pct1", False, S, "2013-14", "How often his teams covered the spread.", "Covers ÷ (covers + losses against the spread)", "As above", f"Hatched under {S} games with a line."),
    X("close_pct", "Close-game win %", "record", "good", "pct1", False, 12, "2013-14", "Winning percentage in games decided by five or fewer. Mostly luck, which is why it sits next to adjusted net.", "W ÷ G in games within 5", ESPN, "Hatched under 12 close games."),
    X("ncaa_rate", "NCAA Tournament rate", "record", "good", "pct1", False, 3, "2002-03", "Share of his seasons that reached the NCAA Tournament.", "Tournament seasons ÷ seasons", "ESPN's tournament games, every seed checked against Wikipedia's bracket", "Hatched under 3 seasons."),
    # ---------------------------------------------------------------- rotation and lineups
    X("stability", "Rotation stability", "rotation", "much", "pct1", False, G, "2023-24", "Share of scripted player-minutes that went to script: each man on or off the floor in the minutes his usual windows say.", "1 − off-script player-minutes ÷ scripted player-minutes (rotation.py)", LINEUPS, f"Hatched under {G} games. " + MODEL),
    X("chosen_dev", "Chosen deviation", "rotation", "much", "pct1", False, G, "2023-24", "Off-script minutes with no absence, blowout, foul trouble or overtime to explain them: match-ups, benchings, hot hands, experiments.", "Choice-cause off-script player-minutes ÷ scripted player-minutes", LINEUPS, f"Hatched under {G} games. " + MODEL),
    X("after_loss", "Shake-up after a loss", "rotation", "much", "sgn1", False, G, "2023-24", "How much more off-script the rotation runs in the game after a loss than after a win, in percentage points.", "Mean off-script share after losses − after wins", LINEUPS, f"Hatched under {G} games."),
    X("depth10", "Depth", "rotation", "much", "num1", False, G, "2013-14", "Players with 10+ minutes, per game.", "Mean count of men with 10+ minutes", "ESPN box scores", f"Hatched under {G} games."),
    X("top7share", "Top-seven minutes share", "rotation", "much", "pct1", False, G, "2013-14", "Share of the team's minutes played by its seven most-used men each game. Concentration.", "Mean per game of top-7 minutes ÷ 200", "ESPN box scores", f"Hatched under {G} games."),
    X("starters_min", "Starters' minutes", "rotation", "much", "num1", False, G, "2013-14", "Minutes per game to the five starters, added up.", "Mean Σ starters' minutes", "ESPN box scores", f"Hatched under {G} games."),
    X("spell", "Stint length", "rotation", "much", "num1", False, G, "2023-24", "Average length of a continuous spell on the floor, in minutes.", "Mean (interval end − start)", LINEUPS, f"Hatched under {G} games."),
    X("first_sub", "First substitution", "rotation", "much", "num1", False, G, "2023-24", "How far into the game the first substitution comes, in minutes.", "Mean seconds to the first substitution ÷ 60", LINEUPS, f"Hatched under {G} games."),
    X("all_bench", "All-bench minutes", "rotation", "much", "num1", False, G, "2023-24", "Minutes per game with no starter on the floor.", "Mean seconds with zero starters on ÷ 60", LINEUPS, f"Hatched under {G} games."),
    X("closes_best", "Closing-five talent gap", "rotation", "good", "num2", True, 8, "2023-24", "In close games: how far the five on the floor at the end sat below the best five available by Savant rate, per 100. Lower is better; zero means he closed with his best five.", "Mean over close games of (Σ rate of the top five available − Σ rate of the closers) ÷ 5", f"{LINEUPS}; {VALUE}", "Hatched under 8 close games. " + MODEL),
    X("closes_near", "Closes with four of his best five", "rotation", "much", "pct1", False, 8, "2023-24", "Share of close games with at least four of the closing five among the best five available by Savant rate.", "Games with 4+ of the top five on at the buzzer ÷ close games", f"{LINEUPS}; {VALUE}", "Hatched under 8 close games. " + MODEL),
    X("sit_h1", "Sits an early second foul", "rotation", "much", "num1", False, 10, "2023-24", "Minutes a man sits after his second foul in the first half.", "Mean seconds from the foul to his return (or the half) ÷ 60", LINEUPS, "Hatched under 10 spells."),
    X("stagger2", "Staggers his top two", "rotation", "much", "pct1", False, G, "2023-24", "Share of minutes with exactly one of his two most-used men on the floor.", "Seconds with one of the two on ÷ seconds", LINEUPS, f"Hatched under {G} games."),
    X("fresh_share", "Minutes to freshmen", "rotation", "much", "pct1", False, G, "2013-14", "Share of the team's minutes played by high-school freshmen.", "Σ freshman minutes ÷ team minutes", "ESPN box scores; rosters.py", f"Hatched under {G} games."),
    X("fresh_rise", "Freshmen earn minutes", "rotation", "much", "sgn1", False, G, "2013-14", "How much the freshmen's share of minutes grows from November–December to conference play, in points.", "Freshman share, conference games − November and December", "ESPN box scores; rosters.py", f"Hatched under {G} games."),
    X("transfer_rise", "Transfers earn minutes", "rotation", "much", "sgn1", False, G, "2013-14", "The same for D1 transfers.", "Transfer share, conference games − November and December", "ESPN box scores; rosters.py", f"Hatched under {G} games."),
    X("left_table", "Lineups left on the table", "rotation", "good", "num1", True, G, "2023-24", "Minutes per game to five-man units projected two or more points per 100 below the team's best available arrangement, judged from the five men's Savant rates. Lower is better.", "Σ minutes of units with projected net ≤ best − 2 ÷ games (units.py)", f"{LINEUPS}; {VALUE}", f"Hatched under {G} games. " + MODEL),
    X("overplay", "Overplayed minutes", "rotation", "good", "num1", True, G, "2013-14", "Minutes per game above D1's fair-minutes line for the Savant rate involved, summed over the men above it. Lower is better.", "Σ max(0, MPG − fair MPG(rate)) over the roster; the line is D1's minutes-by-rate fit that season", f"ESPN box scores; {VALUE}", f"Hatched under {G} games. " + MODEL),
    # ---------------------------------------------------------------- game management
    X("to_g", "Timeouts per game", "management", "much", "num1", False, G, "2013-14", "Team timeouts he called per game. Media (TV) timeouts are not his and are not counted; games where ESPN did not log the TV timeouts separately (0.1-2.6% a season) are left out of every timeout stat.", "Team timeouts ÷ games", ESPN, f"Hatched under {G} games."),
    X("to_media", "Timeouts on a TV window", "management", "much", "pct1", False, 25, "2013-14", "Share of his timeouts called when a TV mark had passed and no TV timeout had been taken: from 2015-16 the rule turns such a timeout into the media timeout.", "Timeouts in an open media window ÷ timeouts", ESPN, "Hatched under 25 timeouts."),
    X("to_run", "Timeouts during runs", "management", "much", "pct1", False, 25, "2013-14", "Share of his timeouts called while the opponent was on a 6-0 run or better.", "Timeouts with 6+ unanswered against ÷ timeouts", ESPN, "Hatched under 25 timeouts."),
    X("unused", "Timeouts left over", "management", "good", "num1", True, 8, "2013-14", "Timeouts unused at the end of games decided by five or fewer. Lower is better. Counted against the media-game allowance (5 through 2014-15, 4 from 2015-16, plus one per overtime).", "Mean (allowed − used) in close finishes", ESPN, "Hatched under 8 close finishes."),
    X("run_stop", "Stops runs", "management", "good", "sgn2", True, 15, "2013-14", "Opponent points per possession over the five possessions after his timeout during a run, minus D1's figure for the same runs with no timeout. Negative is good.", "opp PPP after his run timeouts − D1 opp PPP after matched runs without one, matched on run size", ESPN, "Hatched under 15 run timeouts."),
    X("ato", "After own timeouts", "management", "good", "num2", False, 40, "2013-14", "Points per possession on the first possession after his own timeout (not a media timeout, not the opponent's) whose first action is a shot or a turnover, not free throws; garbage time out, and games where ESPN did not log the media timeouts on their own left out. The same number as College Basketball Savant's After own timeouts.", "Σ points ÷ possessions, own ball after his timeout", ESPN, "Hatched under 40 possessions."),
    X("ato_vs", "ATO over his half-court", "management", "good", "sgn2", False, 40, "2013-14", "After-timeout points per possession minus his team's ordinary dead-ball possessions (after a made basket or free throw, no timeout), both counting possessions whose first action is a shot or a turnover.", "ATO PPP − dead-ball PPP", ESPN, "Hatched under 40 possessions."),
    X("ato_late", "Late-game ATO", "management", "good", "num2", False, 15, "2013-14", "After-timeout points per possession in the last four minutes of the second half and overtime (his own timeouts, first action a shot or a turnover).", "Σ points ÷ possessions", ESPN, "Hatched under 15 possessions."),
    X("ato_d", "After-timeout defense", "management", "good", "num2", True, 25, "2013-14", "Opponent points per possession on the first possession after his timeout when the opponent had the ball, first action a shot or a turnover. Lower is better.", "Σ opp points ÷ possessions", ESPN, "Hatched under 25 possessions."),
    X("halftime", "Halftime adjustment", "management", "good", "sgn1", False, G, "2013-14", "Second-half net rating minus first-half net rating, averaged over games, minus D1's typical change. Each game's own opponent is on both sides of the difference, so it is opponent-adjusted by construction.", "Mean (H2 net − H1 net) − D1 mean", ESPN, f"Hatched under {G} games."),
    X("ch_g", "Challenges per game", "management", "much", "num2", False, G, "2025-26", "Coach's challenges per game. Men's coaches must have a timeout to challenge (Rule 11-4.1, from 2025-26).", "Challenges ÷ games", "ESPN play-by-play, 2025-26 on", f"Hatched under {G} games."),
    X("ch_success", "Challenge success", "management", "good", "pct1", False, 8, "2025-26", "Share of his challenges that overturned the call, read from the play's parenthetical: ESPN's type id and its timeout clause each contradict it on part of 2025-26, and the rule (a second challenge only after a win) sides with the parenthetical.", "Overturned ÷ challenges", "ESPN play-by-play, 2025-26 on", "Hatched under 8 challenges."),
    X("foul_up3", "Fouls up three", "management", "much", "pct1", False, 5, "2013-14", "Up three in the last 30 seconds of the second half or overtime, the opponent with the ball: how often his defense fouled before a shot.", "Possessions whose first action is a free-throw trip ÷ possessions", ESPN, "Hatched under 5 chances."),
    X("two41", "Two-for-one", "management", "much", "num2", False, G, "2013-14", "Possessions per game ended by a shot with 31 to 45 seconds left in a half, the window that buys a last possession under a 30-second clock.", "Count ÷ games", ESPN, f"Hatched under {G} games."),
    X("eoh", "End-of-half possessions", "management", "good", "num2", False, 25, "2013-14", "Points per possession on possessions starting with 30 seconds or less in a half.", "Σ points ÷ possessions", ESPN, "Hatched under 25 possessions."),
    X("chase", "Chases with fouls", "management", "much", "pct1", False, 10, "2013-14", "Trailing by 2 to 10 in the last two minutes: share of opponent possessions his defense fouled before a shot.", "Possessions fouled ÷ possessions", ESPN, "Hatched under 10 possessions."),
    X("clutch_net", "Clutch net rating", "management", "good", "sgn1", False, 120, "2013-14", "Points per 100 possessions minus points allowed per 100, in the last five minutes (overtime included) within five: College Basketball Savant's clutch net, the same possessions and the same figure. Mostly noise: a season holds about 250 clutch possessions and the figure barely repeats from one season to the next.", "100 × (pts ÷ own clutch possessions − opp pts ÷ opp clutch possessions)", ESPN, "Hatched under 120 clutch possessions.", sub="mostly noise"),
    # ---------------------------------------------------------------- offense
    X("pace", "Tempo", "offense", "much", "num1", False, G, "2009-10", "Possessions per 40 minutes, adjusted for opponents (College Savant's tempo).", "College Savant's adjusted tempo", CBB, f"Hatched under {G} games."),
    X("sec_poss", "Seconds per possession", "offense", "much", "num1", True, G, "2013-14", "Average length of his team's possessions.", "Σ possession seconds ÷ possessions", ESPN, f"Hatched under {G} games."),
    X("early", "Early offense", "offense", "much", "pct1", False, G, "2013-14", "Share of possessions whose first shot, free throw or turnover came within ten seconds. A share of possessions, not College Basketball Savant's Early shots, which is a share of field-goal attempts.", "Possessions with first action ≤ 10 s ÷ possessions", ESPN, f"Hatched under {G} games."),
    X("trans", "Transition shots", "offense", "much", "pct1", False, G, "2013-14", "Share of field-goal attempts in transition: within eight seconds of a steal or defensive rebound (College Basketball Savant's window). A share of shots; College Basketball Savant's transition numbers count live-ball possessions and their points per possession.", "Transition FGA ÷ FGA", ESPN, f"Hatched under {G} games."),
    X("ppp_stl", "Off a steal", "offense", "good", "num2", False, 100, "2013-14", "Points per possession on possessions that start with a steal.", "Σ points ÷ steal-started possessions", ESPN, "Hatched under 100 possessions."),
    X("ppp_dreb", "Off a defensive rebound", "offense", "good", "num2", False, 300, "2013-14", "Points per possession on possessions that start with a defensive rebound.", "Σ points ÷ rebound-started possessions", ESPN, "Hatched under 300 possessions."),
    X("ppp_made", "After the opponent scores", "offense", "good", "num2", False, 300, "2013-14", "Points per possession on possessions that start after the opponent scored, a made basket or a made last free throw. College Basketball Savant splits these into After a made basket and After a made last free throw.", "Σ points ÷ possessions after an opponent's score", ESPN, "Hatched under 300 possessions."),
    X("fg3r", "3-point attempt rate", "offense", "much", "pct1", False, G, "2013-14", "Share of field-goal attempts from three, from the box score, D1-against-D1 games. College Basketball Savant's shot-diet Three counts only shots the feed located, so rim, mid and three add to 100 there; this counts every attempt.", "3PA ÷ FGA", "ESPN box scores", f"Hatched under {G} games."),
    X("rim", "Rim rate", "offense", "much", "pct1", False, G, "2013-14", "Share of located shots at the rim: College Basketball Savant's shot-diet Rim, the same shots (D1-against-D1 games, garbage time in).", "Rim FGA ÷ FGA in a zone", ESPN, f"Hatched under {G} games."),
    X("mid", "Long-two rate", "offense", "much", "pct1", False, G, "2013-14", "Share of located shots that are long twos. Not College Basketball Savant's shot-diet Mid, which also counts shots in the paint away from the rim.", "Mid FGA ÷ FGA in a zone", ESPN, f"Hatched under {G} games."),
    X("c3", "Corner-3 share", "offense", "much", "pct1", False, G, "2013-14", "Share of located threes from the corners.", "Corner 3PA ÷ 3PA", ESPN, f"Hatched under {G} games."),
    X("ftr", "Free-throw rate", "offense", "much", "pct1", False, G, "2013-14", "Free-throw attempts per field-goal attempt, D1-against-D1 games (College Basketball Savant's FT rate).", "FTA ÷ FGA", "ESPN box scores", f"Hatched under {G} games."),
    X("ast_pct", "Assisted share", "offense", "much", "pct1", False, G, "2013-14", "Share of made baskets that were assisted.", "AST ÷ FGM", "ESPN box scores", f"Hatched under {G} games."),
    X("tov_pct", "Turnover rate", "offense", "good", "pct1", True, G, "2013-14", "Turnovers per 100 possessions, D1-against-D1 games: College Basketball Savant's TOV%. Lower is better.", "100 × TOV ÷ (FGA − OREB + TOV + 0.475 × FTA)", "ESPN box scores", f"Hatched under {G} games."),
    X("orb_pct", "Offensive rebounding", "offense", "much", "pct1", False, G, "2013-14", "Share of his team's misses it rebounded, D1-against-D1 games (College Basketball Savant's offensive Reb%): crash or get back.", "OREB ÷ (OREB + opp DREB)", "ESPN box scores", f"Hatched under {G} games."),
    X("crash_cost", "Cost of crashing", "offense", "good", "pct1", True, G, "2013-14", "Opponent transition rate on possessions that start with their defensive rebound: what sending bodies to the glass gives up. Lower is better.", "Opponent rebound-started possessions with a first action within 8 s ÷ such possessions", ESPN, f"Hatched under {G} games."),
    X("ortg", "Adjusted offense", "offense", "good", "num1", False, G, "2009-10", "Points per 100 possessions, adjusted for opponents' defenses.", "College Savant's adjusted offense", CBB, f"Hatched under {G} games."),
    # ---------------------------------------------------------------- defense
    X("drtg", "Adjusted defense", "defense", "good", "num1", True, G, "2009-10", "Points allowed per 100 possessions, adjusted for opponents' offenses. Lower is better.", "College Savant's adjusted defense", CBB, f"Hatched under {G} games."),
    X("press", "Press-like pressure", "defense", "much", "pct1", False, G, "2013-14", "Share of opponent possessions after his team's own made basket or free throw that end in a turnover within ten seconds: backcourt-and-trap pressure, as near as play-by-play gets. It cannot see a press itself.", "Opp possessions after own make with a turnover ≤ 10 s ÷ such possessions", ESPN, f"Hatched under {G} games."),
    X("o_fg3r", "Opponent 3-point attempt rate", "defense", "much", "pct1", False, G, "2013-14", "Share of opponents' field-goal attempts from three, from the box score: what he lets them have. Every attempt, not only the located ones College Basketball Savant's shot diet counts.", "opp 3PA ÷ opp FGA", "ESPN box scores", f"Hatched under {G} games."),
    X("o_rim", "Opponent rim rate", "defense", "much", "pct1", False, G, "2013-14", "Share of opponents' located shots at the rim: College Basketball Savant's Rim allowed, the same shots.", "opp rim FGA ÷ opp FGA in a zone", ESPN, f"Hatched under {G} games."),
    X("o_mid", "Opponent long-two rate", "defense", "much", "pct1", False, G, "2013-14", "Share of opponents' located shots that are long twos: the shot a defense wants to give. Not College Basketball Savant's Mid allowed, which also counts paint shots away from the rim.", "opp mid FGA ÷ opp FGA in a zone", ESPN, f"Hatched under {G} games."),
    X("o_ftr", "Opponent free-throw rate", "defense", "good", "pct1", True, G, "2013-14", "Opponents' free-throw attempts per field-goal attempt, D1-against-D1 games (College Basketball Savant's FT rate allowed). Lower is better.", "opp FTA ÷ opp FGA", "ESPN box scores", f"Hatched under {G} games."),
    X("o_tov", "Forced turnovers", "defense", "good", "pct1", False, G, "2013-14", "Opponent turnovers per 100 opponent possessions, D1-against-D1 games: College Basketball Savant's TOV% allowed.", "100 × opp TOV ÷ (opp FGA − opp OREB + opp TOV + 0.475 × opp FTA)", "ESPN box scores", f"Hatched under {G} games."),
    X("stl100", "Steals per 100", "defense", "much", "num1", False, G, "2013-14", "Steals per 100 opponent possessions.", "100 × STL ÷ opp possessions", "ESPN box scores", f"Hatched under {G} games."),
    X("drb_pct", "Defensive rebounding", "defense", "good", "pct1", False, G, "2013-14", "Share of opponents' misses his team rebounded, D1-against-D1 games (College Basketball Savant's defensive Reb%).", "DREB ÷ (DREB + opp OREB)", "ESPN box scores", f"Hatched under {G} games."),
    X("o_trans", "Transition allowed", "defense", "good", "pct1", True, G, "2013-14", "Share of opponents' field-goal attempts in transition. Lower is better. A share of shots, not College Basketball Savant's Transition defense, which is points per live-ball possession.", "opp transition FGA ÷ opp FGA", ESPN, f"Hatched under {G} games."),
    X("pf100", "Fouls per 100", "defense", "much", "num1", False, G, "2013-14", "Personal fouls per 100 opponent possessions.", "100 × PF ÷ opp possessions", "ESPN box scores", f"Hatched under {G} games."),
    X("o_efg", "Opponent eFG%", "defense", "good", "pct1", True, G, "2013-14", "Opponents' effective field-goal percentage, D1-against-D1 games (College Basketball Savant's eFG% allowed). Lower is better.", "(opp FGM + 0.5 × opp 3PM) ÷ opp FGA", "ESPN box scores", f"Hatched under {G} games."),
    # ---------------------------------------------------------------- players under him
    X("dev", "Player development", "development", "good", "sgn1", False, 1500, "2010-11", "Change in his players' Savant rate from the season before, against D1's expected change for the same class year and starting level, minutes-weighted. Per 100 possessions.", "Σ w × (Δ rate − expected Δ(class, level)) ÷ Σ w, w = min(minutes both seasons)", VALUE, "Hatched under 1,500 weighted minutes. Selection, regression to the mean and the strength staff are all in it."),
    X("dev_young", "Develops freshmen and sophomores", "development", "good", "sgn1", False, 700, "2010-11", "The same, for players moving from freshman to sophomore or sophomore to junior.", "As above, Fr→So and So→Jr", VALUE, "Hatched under 700 weighted minutes."),
    X("dev_hs", "Develops his recruits", "development", "good", "sgn1", False, 700, "2010-11", "The same, for players who arrived from high school.", "As above, players whose arrival was high school", VALUE, "Hatched under 700 weighted minutes."),
    X("dev_tr", "Develops transfers", "development", "good", "sgn1", False, 500, "2010-11", "The same, for players in their second season or later after transferring in.", "As above, players who arrived as D1 transfers", VALUE, "Hatched under 500 weighted minutes."),
    # ---------------------------------------------------------------- roster building
    X("ret_min", "Returning minutes", "roster", "much", "pct1", False, 1, "2009-10", "Share of the team's minutes played by men who were on the team the season before. Continuity.", "Σ returning minutes ÷ team minutes", "rosters.py", "One season is a full sample."),
    X("tr_min", "Transfer minutes", "roster", "much", "pct1", False, 1, "2009-10", "Share of minutes played by D1 transfers in their first season with him.", "Σ new-transfer minutes ÷ team minutes", "rosters.py", "One season is a full sample."),
    X("hs_min", "High-school minutes", "roster", "much", "pct1", False, 1, "2009-10", "Share of minutes played by freshmen who arrived from high school.", "Σ freshman minutes ÷ team minutes", "rosters.py", "One season is a full sample."),
    X("juco_min", "JUCO and non-D1 minutes", "roster", "much", "pct1", False, 1, "2009-10", "Share of minutes played by newcomers with no D1 past and a US hometown: junior college or another level. ESPN does not say which.", "Σ such minutes ÷ team minutes", "rosters.py", "One season is a full sample."),
    X("intl_min", "International minutes", "roster", "much", "pct1", False, 1, "2009-10", "Share of minutes played by newcomers with no D1 past, no US recruiting row and a hometown abroad.", "Σ such minutes ÷ team minutes", "rosters.py", "One season is a full sample."),
    X("retention", "Retention", "roster", "good", "pct1", False, 1, "2010-11", "Share of last season's value among players who could return (not seniors or graduates) that came back.", "Σ value of eligible men who returned ÷ Σ value of eligible men", "rosters.py; " + VALUE, "One season is a full sample."),
    X("portal_hit", "Portal hit rate", "roster", "good", "sgn1", False, 3, "2021-22", "His incoming D1 transfers' Savant rate at his school against what the roster model expected of them, per 100, averaged by minutes.", "Σ min × (rate − expected rate) ÷ Σ min, first-year transfers", "rosters.py; expect.py", "Hatched under 3 transfers."),
    X("class_rank", "Recruiting class", "roster", "much", "rank", True, 1, "2007-08", "His incoming class's national rank by WCE's class score (Σ composite rating, best first, each weighted 0.85 per place). Lower is a better class.", "Rank among D1 schools", REC, "One class is a full sample."),
    X("recruit_hit", "Recruit hit rate", "roster", "good", "sgn1", False, 3, "2008-09", "His high-school recruits' first-season Savant rate against what their recruit rank predicts, per 100.", "Σ min × (rate − expected(rank)) ÷ Σ min", f"{REC}; {VALUE}", "Hatched under 3 rated recruits."),
    X("experience", "Roster experience", "roster", "much", "num2", False, 1, "2009-10", "Minutes-weighted class year (freshman 1, graduate 5).", "Σ min × class ÷ Σ min", "ESPN rosters", "One season is a full sample."),
    # ---------------------------------------------------------------- NCAA Tournament
    X("t_seed", "Wins over the seed", "tournament", "good", "sgn2", False, 2, "2002-03", "NCAA Tournament wins per appearance beyond the average for his seed (2002-03 to 2025-26 brackets).", "Mean (wins − seed average) per appearance", "tourney.py: ESPN games, seeds checked against Wikipedia's bracket", "Hatched under 2 appearances."),
    X("t_prob", "Wins over the odds", "tournament", "good", "sgn2", False, 2, "2009-10", "NCAA Tournament wins per appearance beyond WCE's pre-game win probabilities from both teams' adjusted ratings.", "Mean (wins − Σ P(win)) per appearance", f"tourney.py; {CBB}", "Hatched under 2 appearances."),
    # ---------------------------------------------------------------- resources
    X("spend_pct", "Spending", "resources", "much", "pctile", False, 1, "2002-03", "His program's men's basketball expenses as a D1 percentile that season. From 2021-22, NIL and collective money is not in these figures, so it is a weaker read.", "Percentile of EADA men's basketball total expenses", EADA, "One season is a full sample."),
    X("w_resources", "Wins above resources", "resources", "good", "sgn1", False, S, "2010-11", "Wins beyond a resource-adjusted expectation: the roster model plus the fitted effect of the program's spending percentile. Kept off the headline; schools account differently.", "Actual wins − Σ P(win | roster model + b × spending)", f"{EADA}; expect.py", f"Hatched under {S} games."),
    # ---------------------------------------------------------------- situation by situation
    X("gap_q1", "Against top-50 teams", "context", "good", "sgn1", False, 8, "2013-14", "Margin per 100 possessions against teams in the top 50 by College Savant's rating as of the game date (prior games only), minus his margin against everyone else, both against expectation.", "Net vs top-50 − net otherwise, each minus the rating gap", f"{ESPN}; {CBB}", "Hatched under 8 such games."),
    X("gap_road", "On the road", "context", "good", "sgn1", False, 8, "2013-14", "Net rating in true road games minus at home.", "Net away − net home", ESPN, "Hatched under 8 road games."),
    X("gap_conf", "In conference play", "context", "good", "sgn1", False, 10, "2013-14", "Net rating in conference games minus non-conference.", "Net in conference − net out of it", ESPN, "Hatched under 10 conference games."),
    X("nc_sos", "Non-conference schedule", "context", "much", "num1", False, 5, "2013-14", "Average final adjusted net of the non-conference opponents he scheduled (neutral-site events included): how hard he chose to play.", "Mean opponent net, non-conference regular season", CBB, "Hatched under 5 such games."),
    X("gap_missing", "Without regulars", "context", "good", "sgn1", False, 5, "2013-14", "Net rating in games missing a rotation player worth 3+ points per 100 by Savant rate, minus at full strength.", "Net (missing) − net (full strength)", f"ESPN box scores; {VALUE}", "Hatched under 5 such games."),
    X("gap_trail", "Trailing at the half", "context", "good", "sgn1", False, 6, "2013-14", "Second-half margin, in points, in games his team trailed at the half.", "Mean H2 margin when behind at the half", ESPN, "Hatched under 6 such games."),
    X("tempo_ctl", "Tempo control", "context", "much", "pct1", False, G, "2013-14", "Where the game's pace landed between the two teams' season tempos: 100 means his, 0 the opponent's.", "Mean (game pace − opp tempo) ÷ (own tempo − opp tempo), games with a gap of 2+", f"{ESPN}; {CBB}", f"Hatched under {G} games."),
    X("gap_fav", "As the favourite", "context", "good", "sgn1", False, 8, "2013-14", "Margin against the spread when favoured minus when the underdog.", "Mean (margin + spread) favoured − underdog", "The lines above", "Hatched under 8 games each."),
    X("gap_march", "In March", "context", "good", "sgn1", False, 4, "2013-14", "Net rating in March minus November and December. Season phase.", "Net in March − net before January", ESPN, "Hatched under 4 March games."),
]

GROUPS = ["record", "rotation", "management", "offense", "defense", "development", "roster", "tournament", "resources", "context"]
GROUP_LABELS = {"record": "Results and expectation", "rotation": "Rotation and lineups", "management": "Game management",
                "offense": "Offensive identity", "defense": "Defensive identity", "development": "Players under him",
                "roster": "Roster building", "tournament": "NCAA Tournament", "resources": "Resources", "context": "Situation by situation"}
# The unit printed after every value (Nov 6 2026: the page showed bare numbers such as "2.9" and "1.16").
# pct1 values carry their own "%", "rank" reads "No. 49" and "pctile" "73rd percentile", so those need none.
PER100 = "per 100"
U = dict(net=PER100, ortg=PER100, drtg=PER100, net_roster=PER100, halftime=PER100, clutch_net=PER100, nc_sos=PER100,
         gap_q1=PER100, gap_road=PER100, gap_conf=PER100, gap_missing=PER100, gap_march=PER100, gap_trail="pts", gap_fav="pts",
         dev=PER100, dev_young=PER100, dev_hs=PER100, dev_tr=PER100, portal_hit=PER100, recruit_hit=PER100, closes_best=PER100,
         stl100=PER100, pf100=PER100, w_roster="wins", w_spread="wins", w_resources="wins", t_seed="wins a trip", t_prob="wins a trip",
         after_loss="pct pts", fresh_rise="pct pts", transfer_rise="pct pts", depth10="players", starters_min="min", spell="min",
         first_sub="min", sit_h1="min", all_bench="min a game", left_table="min a game", overplay="min a game", to_g="a game",
         unused="timeouts", ch_g="a game", two41="a game", run_stop="PPP", ato="PPP", ato_vs="PPP", ato_late="PPP", ato_d="PPP",
         eoh="PPP", ppp_stl="PPP", ppp_dreb="PPP", ppp_made="PPP", pace="poss per 40", sec_poss="sec", experience="class yr")
for _s in STATS:
    _s["u"] = "%" if _s["unit"] == "pct1" else U.get(_s["key"], "")
    assert _s["u"] or _s["unit"] in ("rank", "pctile"), f"{_s['key']} has no unit"

BY_KEY = {s["key"]: s for s in STATS}

# The style fingerprint: tendencies only ("how much"), the tracks coaches are compared on. Rotation
# tracks exist from 2023-24 only, so comps use the tracks two coaches share (at least MIN_TRACKS).
FINGERPRINT = ["pace", "sec_poss", "early", "trans", "fg3r", "rim", "mid", "c3", "ftr", "ast_pct", "orb_pct", "o_fg3r", "o_rim", "o_mid",
               "press", "stl100", "pf100", "to_g", "to_run", "depth10", "top7share", "starters_min", "fresh_share", "tr_min", "hs_min", "ret_min"]
MIN_TRACKS = 12

# Career rules
MIN_CAREER_SEASONS = 3
MIN_CAREER_GAMES = 75
MIN_SEASON_GAMES = 15         # a coach-team-season with fewer games is shown, not ranked against the season
MIN_LIVE_GAMES = 5            # the season in progress ranks provisionally from 5 games

# ---------------------------------------------------------------- the game's rules, by season
# The clock by period, so a switch to quarters is a config change: [length of each regulation
# period in seconds], overtime length. The NCAA discussed quarters again for 2026-27 and did not adopt
# them (May 2026 joint meeting report).
PERIODS = {"default": dict(regulation=[1200.0, 1200.0], ot=300.0, label=["1st half", "2nd half"])}

# Foul trouble (spec §4 B): a 2nd foul in the first half (until halftime); a 4th with 8:00 or more
# left in the game (until 8:00 is reached); the 5th disqualifies (personal fouls plus class A
# technicals, Rule 10-12.1, every season).
FOUL_RULES = dict(h1=2, late=4, late_until=480.0, out=5)

# Team timeouts allowed per game (NCAA Rule 5-14, from the rule books; the research is in the build
# notes with its sources). Media games: one 60-second plus four 30-second through 2014-15, one plus three
# from 2015-16. Games without commercial media: four 75-second plus two 30-second throughout. One more
# per overtime period in both.
def timeouts_allowed(season, media=True):
    y = int(season[:4]) + 1
    if not media:
        return 6
    return 5 if y <= 2015 else 4


TIMEOUT_MAX_ANY = 6          # the most a team can have in regulation in any game of any season here
# Media windows: the first dead ball at or after 16:00, 12:00, 8:00 and 4:00 of each half. From
# 2015-16 a team timeout at or within 30 seconds before a mark, or at the first dead ball after it,
# becomes that media timeout (5-14.10.e); through 2014-15 it pushed the media timeout to the next dead
# ball. games.py flags a team timeout called while a window is open either way.
MEDIA_MARKS = [960.0, 720.0, 480.0, 240.0]
MEDIA_RULE = {"through_2014-15": "a team timeout in a window pushed the TV timeout to the next dead ball",
              "from_2015-16": "a team timeout in a window becomes the TV timeout"}
# The coach's challenge (men's, from 2025-26, Rule 11-4.1): the team must have a timeout and call it;
# overturned, the timeout is kept; stands, it is lost. One per game, a second after a successful one.
CHALLENGE_FIRST = "2025-26"
CHALLENGES_MAX = 2
