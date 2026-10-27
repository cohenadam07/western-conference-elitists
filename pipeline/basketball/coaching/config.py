"""
config.py — the registry of every stat Basketball Coaching Savant ranks or shows: label, group,
kind ("good": graded blue-to-red; "much": a tendency, shown neutral), unit, direction, settle
point (the sample under which the bar is hatched), first season, and the explainer (what it
is, how it is computed, where it comes from, what sample it needs). Nothing ships without an
entry here; the page's registry and the connector's data dictionary are both written from it.

Groups, in the order the page shows them:
  record       results against two expectations
  rotation     who plays and who plays together (the flagship)
  management   timeouts, after-timeout plays, challenges, halftime, late game
  offense      what his teams hunt
  defense      what his teams take away
  development  what happens to players under him
  context      how his teams do situation by situation (the gap, ranked)
"""

ESPN = "ESPN play-by-play, 2002-03 on"
LOGS = "NBA game logs (stats.nba.com), 1996-97 on"
TRK = "NBA.com player tracking (team tables), 2013-14 on"
HUS = "NBA.com hustle stats (team), 2016-17 on"
SYN = "NBA.com Synergy play types (team), 2015-16 on"
BR = "Basketball-Reference"
ARCH = "the Basketball Savant player archive (BPM as on each player's card)"
MODEL = "The model's view, not a verdict: it cannot see fatigue, minor injuries, match-ups or development plans."


def S(key, label, group, kind, unit, lower, thr, first, what, formula, source, sample, sub=""):
    return dict(key=key, label=label, group=group, sub=sub, kind=kind, unit=unit, lower=lower, thr=thr, first=first,
                what=what, formula=formula, source=source, sample=sample)


STATS = [
    # ---------------------------------------------------------------- record
    S("winpct", "Win %", "record", "good", "pct1", False, 82, "1946-47", "Regular-season winning percentage.", "W ÷ (W + L)", f"{BR} coach records", "Hatched under 82 games."),
    S("net", "Net rating", "record", "good", "sgn1", False, 82, "1996-97", "Points scored minus points allowed per 100 possessions in his games.", "100 × (PTS − opp PTS) ÷ possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 82 games."),
    S("adj_net", "Luck-adjusted net", "record", "good", "sgn1", False, 82, "2002-03", "Net rating with opponents' 3P% and FT% set to league average, the same adjustment the Teams tab makes.", "Net + 100 × (3 × (opp 3PM − opp 3PA × lg 3P%) + (opp FTM − opp FTA × lg FT%)) ÷ possessions", ESPN, "Hatched under 82 games."),
    S("w_talent", "Wins above talent", "record", "good", "sgn1", False, 82, "2003-04", "Wins per 82 games beyond what his roster's prior-season impact predicted, before he touched it.", "Actual wins − expected wins; expected from the talent line (expect.py), fitted out of sample", f"{ARCH}; the model in expect.py", "Hatched under 82 games."),
    S("w_market", "Wins above the market", "record", "good", "sgn1", False, 82, "1996-97", "Wins per 82 beyond the preseason win total the sportsbooks posted for his team.", "Actual wins (scaled to 82) − preseason over/under", f"{BR} preseason odds pages (each season's page is the source)", "Hatched under 82 games; blank where no win total was posted."),
    S("w_spread", "Wins above the spread", "record", "good", "sgn1", False, 82, "2015-16", "Wins beyond what the closing spreads implied, game by game, added up (football Coaching Savant's method).", "Σ (won − P(win | closing spread)); P from the league's empirical curve", "ESPN's consensus closing line, 2015-16 on", "Hatched under 82 games with a line."),
    S("ats", "Against the spread", "record", "good", "pct1", False, 82, "2015-16", "How often his teams covered the closing spread.", "Covers ÷ (covers + losses against the spread)", "ESPN's consensus closing line, 2015-16 on", "Hatched under 82 games with a line."),
    S("close_pct", "Close-game win %", "record", "good", "pct1", False, 30, "1996-97", "Winning percentage in games decided by five or fewer. Mostly luck, which is why it is shown next to point differential.", "W ÷ G in games within 5", LOGS, "Hatched under 30 close games."),
    S("po_rate", "Playoff rate", "record", "good", "pct1", False, 3, "1946-47", "Share of his full seasons that reached the playoffs.", "Playoff seasons ÷ seasons", f"{BR} coach records", "Hatched under 3 seasons."),
    # ---------------------------------------------------------------- rotation
    S("stability", "Rotation stability", "rotation", "much", "pct1", False, 41, "2002-03", "Share of scripted player-minutes that went to script: each man on or off the floor in the minutes his usual windows say.", "1 − off-script player-minutes ÷ scripted player-minutes (rotation.py)", ESPN, "Hatched under 41 games. " + MODEL),
    S("chosen_dev", "Chosen deviation", "rotation", "much", "pct1", False, 41, "2002-03", "Off-script minutes with no absence, blowout or foul trouble to explain them: match-ups, benchings, hot hands, experiments.", "Choice-cause off-script player-minutes ÷ scripted player-minutes", ESPN, "Hatched under 41 games. " + MODEL),
    S("after_loss", "Shake-up after a loss", "rotation", "much", "sgn1", False, 41, "2002-03", "How much more off-script the rotation runs in the game after a loss than after a win, in percentage points.", "Mean off-script share after losses − after wins", ESPN, "Hatched under 41 games."),
    S("hot_hand", "Rides the hot hand", "rotation", "much", "sgn1", False, 10, "2002-03", "Extra fourth-quarter minutes for a man 8+ points over his average through three quarters, against the minutes his usual windows give him. A tendency.", "Mean (Q4 minutes − usual Q4 minutes) on hot nights", ESPN, "Hatched under 10 hot nights."),
    S("depth10", "Depth", "rotation", "much", "num1", False, 41, "2002-03", "Players averaging 10+ minutes, per game.", "Mean count of men with 10+ minutes", ESPN, "Hatched under 41 games."),
    S("top5share", "Top-five minutes share", "rotation", "much", "pct1", False, 41, "2002-03", "Share of the team's minutes played by its five most-used men each game. Concentration.", "Mean per game of top-5 minutes ÷ 240", ESPN, "Hatched under 41 games."),
    S("starters_min", "Starters' minutes", "rotation", "much", "num1", False, 41, "2002-03", "Minutes per game to the five starters, added up.", "Mean Σ starters' minutes", ESPN, "Hatched under 41 games."),
    S("spell", "Stint length", "rotation", "much", "num1", False, 41, "2002-03", "Average length of a continuous spell on the floor, in minutes.", "Mean (interval end − start)", ESPN, "Hatched under 41 games."),
    S("first_sub", "First substitution", "rotation", "much", "num1", False, 41, "2002-03", "How long into the game the first substitution comes, in minutes.", "Mean seconds to the first substitution ÷ 60", ESPN, "Hatched under 41 games."),
    S("all_bench", "All-bench minutes", "rotation", "much", "num1", False, 41, "2002-03", "Minutes per game with no starter on the floor.", "Mean seconds with zero starters on ÷ 60", ESPN, "Hatched under 41 games."),
    S("closes_best", "Closing-five talent gap", "rotation", "good", "num2", True, 15, "2002-03", "In close games (within 10 at the buzzer, no garbage time): how far the five on the floor at the end sat below the best five available by impact, in points per 100. Lower is better; zero means he closed with his best five.", "Mean over close games of (Σ BPM of the top five available − Σ BPM of the closing five)", f"{ESPN}; {ARCH}", "Hatched under 15 close games. " + MODEL),
    S("closes_near", "Closes with four of his best five", "rotation", "much", "pct1", False, 15, "2002-03", "Share of close games where at least four of the closing five were among the best five available by impact.", "Games with 4+ of the top five on the floor at the buzzer ÷ close games", f"{ESPN}; {ARCH}", "Hatched under 15 close games. " + MODEL),
    S("overplay", "Overplayed minutes", "rotation", "good", "num1", True, 41, "2002-03", "Minutes per game above the league's fair-minutes line for the impact involved, summed over the men above it. Lower is better.", "Σ max(0, MPG − fair MPG(BPM)) over the roster; the fair line is the league's minutes-by-impact fit that season", f"{ESPN}; {ARCH}", "Hatched under 41 games. " + MODEL),
    S("youth_share", "Minutes to 23-and-under", "rotation", "much", "pct1", False, 41, "2002-03", "Share of the team's minutes played by men 23 and under.", "Σ minutes of players aged ≤ 23.5 ÷ team minutes", f"{ESPN}; {ARCH} ages", "Hatched under 41 games."),
    S("rookie_share", "Rookies' minutes", "rotation", "much", "pct1", False, 41, "2002-03", "Share of minutes played by rookies.", "Σ rookie minutes ÷ team minutes", f"{ESPN}; {ARCH}", "Hatched under 41 games."),
    S("sit_q1", "Sits an early second foul", "rotation", "much", "num1", False, 20, "2002-03", "Minutes a man sits after his second foul in the first quarter.", "Mean seconds from the foul to his return ÷ 60", ESPN, "Hatched under 20 spells."),
    S("stagger2", "Staggers his top two", "rotation", "much", "pct1", False, 41, "2002-03", "Share of minutes with exactly one of his two most-used men on the floor.", "Seconds with one of the two on ÷ seconds", ESPN, "Hatched under 41 games."),
    S("left_table", "Lineups left on the table", "rotation", "good", "num1", True, 41, "2002-03", "Minutes per game to five-man units projected two or more points per 100 below the team's best available arrangement. Lower is better.", "Σ minutes of units with projected net ≤ best − 2 ÷ games (units.py / modules.fit_parts)", f"{ESPN}; {ARCH}", "Hatched under 41 games. " + MODEL),
    # ---------------------------------------------------------------- management
    S("to_g", "Timeouts per game", "management", "much", "num1", False, 41, "2002-03", "Full and 20-second timeouts he called, per game.", "Timeouts ÷ games", ESPN, "Hatched under 41 games."),
    S("to_run", "Timeouts during runs", "management", "much", "pct1", False, 30, "2002-03", "Share of his timeouts called while the opponent was on a 6-0 run or better.", "Timeouts with 6+ unanswered against ÷ timeouts", ESPN, "Hatched under 30 timeouts."),
    S("unused", "Timeouts left over", "management", "good", "num1", True, 15, "2002-03", "Full timeouts unused at the end of games decided by five or fewer. Lower is better.", "Mean (allowed − used) in close finishes; 7 allowed from 2017-18, 8 before", ESPN, "Hatched under 15 close finishes."),
    S("run_stop", "Stops runs", "management", "good", "sgn2", False, 25, "2002-03", "Opponent points per possession over the five possessions after his timeout during a run, against the league's figure for the same runs with no timeout. Negative is good: the run cooled more than runs cool on their own.", "(opp PPP after his run timeouts − league opp PPP after matched runs without one), matched on run size", ESPN, "Hatched under 25 run timeouts."),
    S("ato", "After-timeout offense", "management", "good", "num2", False, 60, "2002-03", "Points per possession on the first possession after his timeout when his team had the ball.", "Σ points ÷ possessions, first possession after his timeouts, own ball", ESPN, "Hatched under 60 possessions."),
    S("ato_vs", "ATO over his half-court", "management", "good", "sgn2", False, 60, "2002-03", "After-timeout points per possession minus his team's ordinary half-court figure (possessions starting from a dead ball or a made basket).", "ATO PPP − half-court PPP", ESPN, "Hatched under 60 possessions."),
    S("ato_late", "Late-game ATO", "management", "good", "num2", False, 25, "2002-03", "After-timeout points per possession in the last two minutes of the fourth and overtime.", "Σ points ÷ possessions", ESPN, "Hatched under 25 possessions."),
    S("ato_d", "After-timeout defense", "management", "good", "num2", True, 40, "2002-03", "Opponent points per possession on the first possession after his timeout when the opponent had the ball. Lower is better.", "Σ opp points ÷ possessions", ESPN, "Hatched under 40 possessions."),
    S("halftime", "Halftime adjustment", "management", "good", "sgn1", False, 41, "2002-03", "Third-quarter net rating minus first-half net rating, averaged over games, against the league's typical change.", "Mean (Q3 net − H1 net) − league mean", ESPN, "Hatched under 41 games."),
    S("ch_g", "Challenges per game", "management", "much", "num2", False, 41, "2019-20", "Coach's challenges per game.", "Challenges ÷ games", "ESPN play-by-play, 2019-20 on", "Hatched under 41 games."),
    S("ch_success", "Challenge success", "management", "good", "pct1", False, 20, "2019-20", "Share of his challenges that overturned the call.", "Overturned ÷ challenges", "ESPN play-by-play, 2019-20 on", "Hatched under 20 challenges."),
    S("ch_q4", "Challenges saved for the fourth", "management", "much", "pct1", False, 20, "2019-20", "Share of his challenges used in the fourth quarter or overtime.", "Q4/OT challenges ÷ challenges", "ESPN play-by-play, 2019-20 on", "Hatched under 20 challenges."),
    S("foul_up3", "Fouls up three", "management", "much", "pct1", False, 8, "2002-03", "With a three-point lead and 24 seconds or less, how often his defense fouled before a shot.", "Possessions fouled ÷ possessions up 3 with ≤ 24 s", ESPN, "Hatched under 8 chances."),
    S("two41", "Two-for-one", "management", "much", "num2", False, 41, "2002-03", "Possessions per game ended by a shot with 28 to 40 seconds left in a quarter, the two-for-one window.", "Count ÷ games", ESPN, "Hatched under 41 games."),
    S("eoq", "End-of-quarter possessions", "management", "good", "num2", False, 60, "2002-03", "Points per possession on possessions starting with 24 seconds or less in a quarter (regulation).", "Σ points ÷ possessions", ESPN, "Hatched under 60 possessions."),
    S("chase", "Chases with fouls", "management", "much", "pct1", False, 20, "2002-03", "Trailing by 2 to 10 in the last two minutes: share of opponent possessions his defense fouled before a shot.", "Possessions fouled ÷ possessions", ESPN, "Hatched under 20 possessions."),
    S("adv_to", "Timeouts to advance", "management", "much", "num2", False, 41, "2002-03", "Late-game timeouts called with the ball, tied or trailing, within three seconds of gaining it: advancing the ball. Per game.", "Count ÷ games", ESPN, "Hatched under 41 games."),
    S("clutch_net", "Clutch net rating", "management", "good", "sgn1", False, 200, "2002-03", "Net rating in the last five minutes within five. Mostly noise; shown next to his overall net.", "100 × (pts − opp pts) ÷ possessions in clutch time", ESPN, "Hatched under 200 clutch possessions."),
    # ---------------------------------------------------------------- offense
    S("pace", "Pace", "offense", "much", "num1", False, 41, "1996-97", "Possessions per 48 minutes.", "48 × possessions ÷ minutes", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("sec_poss", "Seconds per possession", "offense", "much", "num1", True, 41, "2002-03", "Average length of his team's possessions.", "Σ possession seconds ÷ possessions", ESPN, "Hatched under 41 games."),
    S("early", "Early offense", "offense", "much", "pct1", False, 41, "2002-03", "Share of possessions over within seven seconds.", "Possessions ≤ 7 s ÷ possessions", ESPN, "Hatched under 41 games."),
    S("trans", "Transition shots", "offense", "much", "pct1", False, 41, "2002-03", "Share of field-goal attempts within seven seconds of a steal or defensive rebound.", "Transition FGA ÷ FGA", ESPN, "Hatched under 41 games."),
    S("fg3r", "3-point rate", "offense", "much", "pct1", False, 41, "1996-97", "Share of shots from three.", "3PA ÷ FGA", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("rim", "Rim rate", "offense", "much", "pct1", False, 41, "2002-03", "Share of shots in the restricted area.", "RA FGA ÷ FGA", ESPN, "Hatched under 41 games."),
    S("mid", "Mid-range rate", "offense", "much", "pct1", False, 41, "2002-03", "Share of shots that are long twos.", "Mid-range FGA ÷ FGA", ESPN, "Hatched under 41 games."),
    S("c3", "Corner-3 share", "offense", "much", "pct1", False, 41, "2002-03", "Share of threes from the corners.", "Corner 3PA ÷ 3PA", ESPN, "Hatched under 41 games."),
    S("ftr", "Free-throw rate", "offense", "much", "pct1", False, 41, "1996-97", "Free-throw attempts per field-goal attempt.", "FTA ÷ FGA", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("ast_pct", "Assisted share", "offense", "much", "pct1", False, 41, "1996-97", "Share of made baskets that were assisted.", "AST ÷ FGM", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("tov_pct", "Turnover rate", "offense", "good", "pct1", True, 41, "1996-97", "Turnovers per 100 possessions. Lower is better.", "100 × TOV ÷ possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("orb_pct", "Offensive rebounding", "offense", "much", "pct1", False, 41, "1996-97", "Share of his team's misses it rebounded. Crash or get back.", "OREB ÷ (OREB + opp DREB)", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("ortg", "Offensive rating", "offense", "good", "num1", False, 41, "1996-97", "Points per 100 possessions.", "100 × PTS ÷ possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("passes", "Passes per 100", "offense", "much", "num1", False, 41, "2013-14", "Passes made per 100 possessions.", "100 × passes ÷ possessions", TRK, "Hatched under 41 games."),
    S("sec_touch", "Seconds per touch", "offense", "much", "num2", False, 41, "2013-14", "How long the ball sits in one man's hands.", "The NBA's average seconds per touch", TRK, "Hatched under 41 games."),
    S("drives", "Drives per 100", "offense", "much", "num1", False, 41, "2013-14", "Drives to the basket per 100 possessions.", "100 × drives ÷ possessions", TRK, "Hatched under 41 games."),
    S("pullup", "Pull-up share", "offense", "much", "pct1", False, 41, "2013-14", "Of jump shots, the share taken off the dribble rather than off the catch.", "Pull-up FGA ÷ (pull-up + catch-and-shoot FGA)", TRK, "Hatched under 41 games."),
    S("screen_ast", "Screen assists per 100", "offense", "much", "num1", False, 41, "2016-17", "Screens that led directly to a made basket, per 100 possessions.", "100 × screen assists ÷ possessions", HUS, "Hatched under 41 games."),
    S("hub", "Hub touches per 100", "offense", "much", "num1", False, 41, "2013-14", "Elbow, post and paint touches per 100 possessions: an inside-out offense.", "100 × (elbow + post + paint touches) ÷ possessions", TRK, "Hatched under 41 games."),
    S("off_box", "Offensive box outs per 100", "offense", "much", "num1", False, 41, "2016-17", "Box outs on the offensive glass per 100 possessions.", "100 × offensive box outs ÷ possessions", HUS, "Hatched under 41 games."),
    # ---------------------------------------------------------------- defense
    S("drtg", "Defensive rating", "defense", "good", "num1", True, 41, "1996-97", "Points allowed per 100 possessions. Lower is better.", "100 × opp PTS ÷ opp possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("o_fg3r", "Opponent 3-point rate", "defense", "much", "pct1", False, 41, "1996-97", "Share of opponents' shots from three. What he lets them have.", "opp 3PA ÷ opp FGA", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("o_rim", "Opponent rim rate", "defense", "much", "pct1", False, 41, "2002-03", "Share of opponents' shots in the restricted area.", "opp RA FGA ÷ opp FGA", ESPN, "Hatched under 41 games."),
    S("o_mid", "Opponent mid-range rate", "defense", "much", "pct1", False, 41, "2002-03", "Share of opponents' shots that are long twos: the shot a defense wants to give.", "opp mid FGA ÷ opp FGA", ESPN, "Hatched under 41 games."),
    S("o_ftr", "Opponent free-throw rate", "defense", "good", "pct1", True, 41, "1996-97", "Opponents' free-throw attempts per shot. Lower is better.", "opp FTA ÷ opp FGA", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("o_tov", "Forced turnovers", "defense", "good", "pct1", False, 41, "1996-97", "Opponent turnovers per 100 possessions.", "100 × opp TOV ÷ opp possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("stl100", "Steals per 100", "defense", "much", "num1", False, 41, "1996-97", "Steals per 100 opponent possessions.", "100 × STL ÷ opp possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("defl", "Deflections per 100", "defense", "much", "num1", False, 41, "2016-17", "Deflections per 100 opponent possessions. Disruption.", "100 × deflections ÷ possessions", HUS, "Hatched under 41 games."),
    S("charges", "Charges per 100", "defense", "much", "num2", False, 41, "2016-17", "Charges drawn per 100 possessions.", "100 × charges ÷ possessions", HUS, "Hatched under 41 games."),
    S("drb_pct", "Defensive rebounding", "defense", "good", "pct1", False, 41, "1996-97", "Share of opponents' misses his team rebounded.", "DREB ÷ (DREB + opp OREB)", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("o_trans", "Transition allowed", "defense", "good", "pct1", True, 41, "2002-03", "Share of opponents' shots within seven seconds of a steal or defensive rebound. Lower is better.", "opp transition FGA ÷ opp FGA", ESPN, "Hatched under 41 games."),
    S("pf100", "Fouls per 100", "defense", "much", "num1", False, 41, "1996-97", "Personal fouls committed per 100 opponent possessions.", "100 × PF ÷ opp possessions", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    S("switch100", "Switches per 100", "defense", "much", "num1", False, 41, "2017-18", "Switches per 100 matchup possessions, the closest public stand-in for a switch-everything scheme. A season is counted over the games its defensive box scores cover.", "100 × Σ switchesOn ÷ Σ partial matchup possessions (BoxScoreDefensiveV2, one per game)", "NBA.com matchup data (defensive box scores), 2017-18 on", "Hatched under 41 games with a box score."),
    S("o_efg", "Opponent eFG%", "defense", "good", "pct1", True, 41, "1996-97", "Opponents' effective field-goal percentage. Lower is better.", "(opp FGM + 0.5 × opp 3PM) ÷ opp FGA", f"{ESPN}; the NBA's team tables before", "Hatched under 41 games."),
    # ---------------------------------------------------------------- development
    S("aging", "Beats the aging curve", "development", "good", "sgn1", False, 2000, "1997-98", "Change in his players' impact from the season before, against what the aging curve expects at their ages, minutes-weighted: in percentile points of position-adjusted BPM, the currency the curve was fitted on.", "Σ w × (Δ BPM percentile − expected Δ(age)) ÷ Σ w, w = min(minutes both seasons); players with 500+ minutes both seasons and the same position bucket", f"{ARCH}; the aging curve in savant_config.AGING", "Hatched under 2,000 weighted minutes. Selection, team staff and regression to the mean all live in this number."),
    S("aging_young", "Young players beat the curve", "development", "good", "sgn1", False, 1000, "1997-98", "The same, for players 24 and under.", "As above, age ≤ 24", f"{ARCH}", "Hatched under 1,000 weighted minutes."),
    # ---------------------------------------------------------------- context (the gap)
    S("gap_top10", "Against the top ten", "context", "good", "sgn1", False, 20, "1996-97", "Net rating against opponents in the top ten by luck-adjusted net as of the game date, minus his overall net.", "Net vs top-10 − net overall", f"{ESPN}; {LOGS}", "Hatched under 20 such games."),
    S("gap_b2b", "On a back-to-back", "context", "good", "sgn1", False, 12, "1996-97", "Net rating on the second night of a back-to-back minus his overall net.", "Net on b2b − net overall", LOGS, "Hatched under 12 such games."),
    S("gap_road", "On the road", "context", "good", "sgn1", False, 30, "1996-97", "Net rating away minus net at home.", "Net away − net home", LOGS, "Hatched under 30 road games."),
    S("gap_missing", "Without regulars", "context", "good", "sgn1", False, 15, "2002-03", "Net rating with five or more points of regular impact missing, minus his net at full strength.", "Net (missing impact ≥ 5) − net (no regular missing)", f"{ESPN}; {ARCH}", "Hatched under 15 such games."),
    S("gap_trail", "Trailing at the half", "context", "good", "sgn1", False, 20, "2002-03", "Second-half margin, in points, in games his team trailed at the half.", "Mean (Q3 + Q4 margin) when behind at the half", ESPN, "Hatched under 20 such games."),
    S("tempo_ctl", "Tempo control", "context", "much", "pct1", False, 41, "2002-03", "Where the game's pace landed between the two teams' usual paces: 100 means his pace, 0 the opponent's.", "Mean (game pace − opp usual) ÷ (own usual − opp usual), seasons' prior games only", ESPN, "Hatched under 41 games."),
    S("gap_fav", "As the favourite", "context", "good", "sgn1", False, 20, "2015-16", "Margin against the spread when favoured minus when the underdog.", "Mean (margin + spread) favoured − underdog", "ESPN closing lines", "Hatched under 20 games each."),
]

GROUPS = ["record", "rotation", "management", "offense", "defense", "development", "context"]
GROUP_LABELS = {"record": "Results and expectation", "rotation": "Rotation and lineups", "management": "Game management",
                "offense": "Offensive identity", "defense": "Defensive identity", "development": "Players under him", "context": "Situation by situation"}
BY_KEY = {s["key"]: s for s in STATS}

# The style fingerprint: tendencies only ("how much"), the tracks a coach is compared on
FINGERPRINT = ["pace", "early", "trans", "fg3r", "rim", "mid", "c3", "ftr", "ast_pct", "orb_pct", "o_fg3r", "o_rim", "o_mid", "o_tov", "pf100",
               "depth10", "top5share", "stability", "chosen_dev", "to_g", "to_run", "stagger2"]

# Career rules
MIN_CAREER_SEASONS = 3        # seasons as a head coach (any length) before career stats are ranked
MIN_CAREER_GAMES = 150
MIN_SEASON_GAMES = 41         # a coach-team-season with fewer games is shown but not ranked against the season
