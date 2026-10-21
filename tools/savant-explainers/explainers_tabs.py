"""
Explainers for the Fantasy, Teams and Lineups tabs and the projection panel on the player card
(public/savant-fantasy.js, public/savant-teams.js). Merged into explainers.py's E, so they land
in the same `const EXPL={...}` on the page and the same connector parser.
"""
NBA = "NBA.com stats (stats.nba.com)"
PROJ = "Our projections: ~/Basketball-Savant/projections.py, rebuilt with every refresh (after each slate in season)."
SLEEPER = "Sleeper's public API (api.sleeper.app), read in your browser; nothing about your league is sent to us."
LK = "~/Basketball-Savant/teams_engine.py fit-k"

BACKTEST = ("Backtested on 4,191 player-seasons: preseason points-per-game error 2.39 vs 2.52 for 'same as last season'; "
            "after 10 games 1.90 vs 2.27 for 'season to date' (out/projections_report.txt).")


def proj_stat(name, unit):
    return dict(
        what=f"Projected {name} per game: our best estimate of what he averages over the window you picked (rest of season by default).",
        formula=(f"Per-minute {unit} rate x projected minutes. Rate: his last three seasons weighted 5/4/3 by minutes, pulled toward his "
                 "position's average by that stat's settle point, then moved along an age curve fitted on past seasons. In season, his "
                 "games this year are blended in with the same settle point. Minutes: last three seasons' MPG, aged; in season, 60% "
                 "his last 10 games + 40% his season, blended with the preseason number over his first 10 games."),
        source=f"{PROJ} Inputs: {NBA} game logs, 2010-11 on.",
        sample=BACKTEST)


T = {
 # ---- the All-Savant Team (landing page; public/savant-value.js, numbers from tools/savant-value/value.py)
 "allsavant": dict(
     what=("The All-Savant Team is our All-NBA team, picked by the numbers alone: two guards, two wings and a big per team, each the "
           "highest Savant value at his position among qualified players. A player makes one team only. Savant value is the points he "
           "added to his team this season above a replacement-level player at his position, on the stats that are his own and the "
           "possessions he played."),
     formula=("Value = (rate - replacement rate) x possessions / 100. Rate = points per 100 possessions vs. an average player at his "
              "position: efficiency on his own shots, usage, 3-point and free-throw rate, assist %, turnovers, rebound % at both ends, "
              "steals and blocks, each pulled toward the position average by its settle point, times what it is worth in luck-adjusted "
              "on/off, times the share of it that follows a player to a new team (0.79 for shooting efficiency to 0.96 for 3-point rate). "
              "From 2009-10 the rate also takes in part of what his luck-adjusted on/off says beyond the box score and his minutes: "
              "weight w / (w + 6,400), w = 1 / (1/minutes on + 1/team minutes without him), about 13% for a full-time starter. "
              "Replacement = the 25th-percentile qualified player at his position that season."),
     source=(f"{NBA}; Basketball Reference before 1996-97. Positions as on his card. Worth learned on 6,498 player-seasons "
             "(2009-10 to 2024-25, 2025-26 held out) by tools/savant-value/value.py; the numbers are in savant-value.json."),
     sample=("Missed games cost him: he adds nothing on nights he doesn't play. On the held-out 2025-26 season, a player's 2024-25 rate "
             "correlated .37 with his 2025-26 luck-adjusted on/off; BPM .35. Checked against the real All-NBA, never tuned to it: "
             "since 1988-89, 63% of our first and second teamers made the real first or second team, 75% made an All-NBA team. "
             "Before 2009-10 there is no on/off, so defense counts only through steals, blocks and rebounds. "
             "Early in a season the team moves a lot; it settles as possessions pile up.")),
 # ---- projections
 "pj_method": dict(what="How the projections work: one model behind every Fantasy number, the projection panel on the card and the connector.",
     formula=("Marcel-style: last three seasons weighted 5/4/3 by minutes, regressed to position average by each stat's measured settle point, "
              "aged with curves fitted on prior seasons only. In season: blended with this season at the same settle point; minutes from "
              "60% last 10 games + 40% season. Rookies: recent rookies' rates by position and minutes by draft slot (1-5: 26, 6-14: 19, "
              "15-30: 17, 31-60: 11, undrafted: 12)."),
     source=f"{PROJ} {NBA} game logs; injury designations from {SLEEPER}",
     sample=BACKTEST),
 "pj_min": proj_stat("minutes", "minutes"),
 "pj_pts": proj_stat("points", "points"),
 "pj_reb": proj_stat("rebounds", "rebound"),
 "pj_ast": proj_stat("assists", "assist"),
 "pj_stl": proj_stat("steals", "steal"),
 "pj_blk": proj_stat("blocks", "block"),
 "pj_fg3m": proj_stat("made threes", "3PM"),
 "pj_tov": proj_stat("turnovers", "turnover"),
 "pj_fgpct": dict(what="Projected field-goal percentage: made shots over attempts in his projection.",
     formula="FG% = projected FGM / projected FGA, each projected per minute like the counting stats and then multiplied by projected minutes.",
     source=PROJ, sample=BACKTEST),
 "pj_ftpct": dict(what="Projected free-throw percentage.",
     formula="FT% = projected FTM / projected FTA, each projected per minute and multiplied by projected minutes.", source=PROJ, sample=BACKTEST),
 "pj_age": dict(what="His age on February 1 of the season, the date the age curves are measured at.",
     formula="Age = (Feb 1 of the season - birth date) / 365.25", source=f"{NBA} player index.", sample="None: a fact."),
 "pj_y3": dict(what="Three-season outlook: this season, next season and the one after, per game. What dynasty value is built on.",
     formula="Start from this season's projection, then apply one year of the fitted age curve per season, to every per-minute rate and to minutes (kept between 4 and 38).",
     source=PROJ, sample="Age curves are averages; individual careers vary widely, and the error grows each year out."),
 "pj_ros": dict(what="Rest of season: his per-game projection, and how many games we expect him to play from today on.",
     formula="Games = each remaining team game x his availability (games played / team games, last three seasons), with today's injury designation applied to the games right in front of him.",
     source=f"{PROJ} Schedule: {NBA} ScheduleLeagueV2.", sample=BACKTEST),
 "pj_next7": dict(what="The next seven days: the same per-game projection, over his team's games in the next week.",
     formula="Games = team games in the next 7 days x availability; his next game uses his injury designation (Out 0%, Doubtful 15%, Questionable / day-to-day 55%, Probable 90%).",
     source=f"{PROJ} Schedule: {NBA}; designations: {SLEEPER}", sample="A week is a handful of games; minutes and matchups move it a lot."),

 # ---- fantasy settings
 "fx_sleeper": dict(what="Connect your Sleeper league to rank with your league's exact scoring, see who owns whom, find free agents, and plan Lock-In against your real opponent.",
     formula="Username -> your leagues this season -> the league's scoring settings, rosters, owners and this week's matchup. Sleeper players are matched to NBA ids by name (and team when two share a name) every night.",
     source=SLEEPER, sample="Scoring keys our projections can't model (fouls, technicals...) are listed and left out."),
 "fx_format": dict(what="Points leagues add up a score from every stat. 9-cat head-to-head leagues win category by category: PTS, REB, AST, STL, BLK, 3PM, TO, FG% and FT%.",
     formula="Points: fantasy points from your scoring. 9-cat: the sum of his z-scores across the nine categories (see Value).",
     source=PROJ, sample="Same projections either way; only the valuation changes."),
 "fx_scoring": dict(what="The points system. Presets are each site's default; Custom lets you set any weight; your connected Sleeper league uses its own settings.",
     formula=("Sleeper: PTS 0.5, REB 1, AST 1, STL 2, BLK 2, TO -1, 3PM 0.5, double-double 1, triple-double 2, 40+ pts 2, 50+ pts 2 more. "
              "ESPN: PTS 1, 3PM 1, FGM 2, FGA -1, FTM 1, FTA -1, REB 1, AST 2, STL 4, BLK 4, TO -2. Yahoo: PTS 1, REB 1.2, AST 1.5, STL 3, BLK 3, TO -1."),
     source=("Sleeper's weights were fitted to Sleeper's own standard points on 7,213 player-weeks of 2025-26 and reproduce every one exactly; "
             "ESPN from espn.com's default-scoring page; Yahoo from help.yahoo.com."),
     sample="Bonuses (double-doubles, 40-point games) use his rate over his last 60 games, rescaled to his projection, shrunk by n / (n + 5)."),
 "fx_window": dict(what="The stretch of games being valued: the rest of the season, the next 7 days, the rest of this fantasy week (Monday to Sunday), a full 82-game season, or three seasons for dynasty.",
     formula="Value = per-game projection x expected games in the window (team games x availability x injury designation). Dynasty = this season + next + the one after, weighted 1 / 0.8 / 0.6.",
     source=f"{PROJ} Schedule: {NBA}.", sample="Short windows swing with schedule: a four-game week is worth a third more than a three-game week."),
 "fx_basis": dict(what="Totals rank by what he adds over the whole window, games missed included. Per game ranks by what he gives on the nights he plays.",
     formula="Per game = window total / expected games.", source=PROJ, sample="Per game flatters players who miss time."),
 "fx_repl": dict(what="League size sets replacement level: the best player nobody needs to roster. Value only counts above that line.",
     formula="Replacement = the value of player number (teams x roster spots + 1) in the current ranking.",
     source="Your settings (or your Sleeper league's).", sample="None: a setting."),

 # ---- fantasy columns
 "fx_rank": dict(what="His rank by value in the format, scoring and window you've chosen.", formula="Sorted by fantasy points (points) or z-score value (9-cat), highest first.", source=PROJ, sample=BACKTEST),
 "fx_games": dict(what="Expected games he plays in the window.",
     formula="Sum over team games of P(he plays): availability (games played / team games, last three seasons) for a normal game; his designation for the next one; Out = 0 next game and half the usual rate for the rest of the week; IR / suspended = 0 for 14 days.",
     source=f"{NBA} schedule; designations from {SLEEPER}", sample="We don't know return dates; check the news before trusting an injured player's number."),
 "fx_fpg": dict(what="Projected fantasy points per game in your scoring.",
     formula="Sum over stats of weight x projected per-game stat, plus bonus weight x bonus rate (double-doubles etc.).", source=PROJ, sample=BACKTEST),
 "fx_fp": dict(what="Projected fantasy points over the window: per game x expected games.", formula="FP = FP per game x expected games.", source=PROJ, sample=BACKTEST),
 "fx_z": dict(what="9-cat value: how much he helps across the nine categories, in standard deviations above the typical rosterable player.",
     formula=("For each category, z = (his total - pool mean) / pool SD, over the pool of rosterable players (teams x roster). TO is flipped. "
              "FG% and FT% use impact: FGM - FGA x league FG%, so volume counts. Value = sum of the nine z's. The pool is re-picked "
              "from the ranking and recomputed three times."),
     source=PROJ, sample="Category leagues reward balance; a big value from one category (blocks, say) is still real in roto, less so in H2H."),
 "fx_vor": dict(what="Value over replacement: how much he adds over the best player you could pick up for free.",
     formula="Value - value of the replacement-level player (number teams x roster + 1). In trades, summing this charges a 2-for-1 for the roster spot it eats.",
     source=PROJ, sample="Depends on league size: deeper leagues push replacement down and everyone's surplus up."),
 "fx_owner": dict(what="Who has him in your connected Sleeper league; FREE AGENT if nobody does.", formula="Matched from the league's rosters.", source=SLEEPER, sample="None."),
 "fx_dyn_model": dict(what="Our dynasty value: three seasons of projected production, valued in your format, above replacement.",
     formula="Sum over the next three seasons of (projected per-game value x 82 x availability), weighted 1 / 0.8 / 0.6, minus replacement. The weights discount later seasons for the extra uncertainty; they are a choice, not fitted.",
     source=PROJ, sample="Three-year projections ride on average age curves; young players' ranges are wide."),
 "fx_dyn_crowd": dict(what="The crowd's price: each player's rank on the WCE Dynasty board, set by thousands of four-player head-to-head picks, and the trade value that rank implies.",
     formula="Elo ratings from every pick (each four-player ranking = six pairwise results). Value = 10,000 x e^(-rank / 40), calibrated so a star beats a pile of role players but two good players can beat one.",
     source="wcehoops.com/dynasty (api/dynasty.js, src/lib/dynastyValue.js).", sample="Players with few picks move a lot; the board shows how many times each was seen."),
 "fx_dyn_gap": dict(what="Where our model and the crowd disagree. Model + means we rank him higher than the crowd does (buy); Crowd + means the crowd is higher (sell, or the crowd knows something we don't).",
     formula="Gap = crowd rank - model rank. Flagged when it is at least 15 places and at least 35% of the better of the two ranks.",
     source="Our model vs the WCE Dynasty board.", sample="The model sees only box-score production and age; the crowd sees news, roles and hype. Both miss things."),
 "fx_trade": dict(what="The trade evaluator: what each side gets, valued four ways.",
     formula=("Rest of season and dynasty: sum of value over replacement for each player received (so the side taking more players pays for the roster spots). "
              "Crowd: sum of Dynasty-board values. Next 7 days: sum of projected fantasy points. 'About even' = within 5%."),
     source=f"{PROJ} and the WCE Dynasty board.", sample="Doesn't know your roster construction or category needs; read it as value, not fit."),
 "fx_stream": dict(what="Streaming: the best players to pick up for a short window, weighted toward teams that play a lot.",
     formula="Window value = per-game projection x expected games in the window. With a Sleeper league: free agents only. Without: players outside the top 75% of rosterable players for the rest of the season.",
     source=f"{PROJ} Schedule: {NBA}.", sample="A week is short: minutes and matchups matter more than the projection's decimals."),
 "fx_sched": dict(what="His team's games in the window: day, home (v) or away (@), and opponent. Red = the second night of a back-to-back, when stars sit most.",
     formula="From the league schedule; back-to-back = a game the day after another.", source=f"{NBA} ScheduleLeagueV2.", sample="None: the schedule."),
 "fx_play": dict(what="The chance he plays that game.",
     formula="His next game: by injury designation (Out 0%, Doubtful 15%, Questionable / GTD / day-to-day 55%, Probable 90%). Later games: availability over the last three seasons.",
     source=f"Designations from {SLEEPER}", sample="Designations change up to tip-off."),
 "fx_lock": dict(what=("Lock-In (Sleeper): each player's one game counts for the week. Lock a game if it beats what waiting is worth; if you never lock, his last game counts, even a zero. "
                       "The threshold under each game is the score worth locking."),
     formula=("Backward induction. X = one game's fantasy points, drawn from his last 60 games rescaled to his projection. q = chance he plays. "
              "Last game: V = q x E[X]. Earlier: V_i = q_i x E[max(X, V_(i+1))] + (1 - q_i) x V_(i+1). Lock game i if it scores at least V_(i+1). "
              "Expected, smart locking = V_1; never locking = his last game's expectation."),
     source=f"{PROJ} game logs and schedule.", sample="Players with fewer than 8 recent NBA games use a normal curve at their projection (SD 38% of the mean)."),
 "fx_lock_matchup": dict(what="Matchup-aware Lock-In: the threshold that maximizes your chance of winning the week, not your expected points. Ahead, lock earlier; behind, chase a ceiling.",
     formula=("Same recursion on win probability. P(win | this slot scores y) = Phi((your other slots - opponent + y) / SD). "
              "With a Sleeper league, other slots and the opponent are the sums of each starter's smart-locking expectation; SD from each slot's game-to-game spread (x 0.75 for locking). Type your live totals over them as the week goes."),
     source=f"{SLEEPER} for the matchup; {PROJ} for the players.", sample="A normal approximation of the rest of the matchup; best in the second half of the week when most slots are settled."),
 "fx_inj": dict(what="Who benefits when a player sits: his teammates whose minutes and production changed most in the games he missed.",
     formula=("From the with/without split: for each teammate, per-36 numbers and minutes in games the injured player played vs. missed. "
              "FP/G change = (minutes without / 36 x per-36 PTS/REB/AST in your scoring) - (the same with him); steals, blocks and the rest are left out."),
     source=f"{NBA} game logs (the latest season with a with/without table); designations from {SLEEPER}",
     sample="Games without a player are few; the count is shown. Only teammates still on his team are listed."),
 "fx_punt": dict(what="Punting: giving up on up to four categories on purpose (FG% and turnovers, say) so your roster wins the rest. Punted categories are left out of value, which reshuffles who fits your build.",
     formula="Value = sum of z-scores over the categories you keep. z-scores are still computed for all nine (and shown, shaded); the pool of rosterable players is re-picked by the punted value.",
     source=PROJ, sample="A build, not a projection: only as good as the categories you really stop chasing."),
 "fx_catsim": dict(what="Your 9-cat head-to-head this week, category by category: projected totals for your starters and your opponent's from today to Sunday, and the chance you win each.",
     formula=("Totals = per-game projection x expected games, summed over starters. Spread: each player's game-to-game variance from his last 60 games (rescaled to his projection) x games. "
              "P(win) = Phi((your total - theirs) / SD), TO flipped. FG% and FT%: makes above each player's own rate per game, divided by the side's attempts. Expected categories won = sum of the nine chances."),
     source=f"{SLEEPER} starters; {PROJ}", sample="Doesn't know what's already happened this week or lineup changes you'll make; a normal approximation of each category."),
 "fx_power": dict(what="League power rankings: each team's best possible lineup by projected fantasy points per game.",
     formula="For each roster: the top N players by rest-of-season FP per game, N = the league's starting slots, summed.",
     source=f"{SLEEPER} rosters; {PROJ}", sample="Ignores position limits and injuries beyond today's designations."),
}

# ---- Teams
TS = f"{NBA} team stats, 1996-97 on."
T.update({
 "tm_wl": dict(what="Wins and losses.", formula="Games won - games lost.", source=TS, sample="None: a record."),
 "tm_net": dict(what="Net rating: points scored minus points allowed per 100 possessions. The best single number for how good a team has been.",
     formula="Net = ORtg - DRtg", source=TS, sample="Team net rating settles quickly; 20 games already says a lot."),
 "tm_adjnet": dict(what="Net rating with the luck taken out: opponents' 3P% and FT% against the team set to league average. Teams have little control over either, and both swing net rating by a point or more.",
     formula="Adjusted DRtg = DRtg - 100 x (3 x (opp 3PM - opp 3PA x league 3P%) + (opp FTM - opp FTA x league FT%)) / possessions. Luck-adjusted net = ORtg - adjusted DRtg.",
     source=TS, sample="Better than raw net for predicting the rest of the season, especially early."),
 "tm_ortg": dict(what="Offensive rating: points scored per 100 possessions.", formula="ORtg = 100 x points / possessions", source=TS, sample="Settles within ~20 games."),
 "tm_drtg": dict(what="Defensive rating: points allowed per 100 possessions. Lower is better.", formula="DRtg = 100 x opponent points / possessions", source=TS, sample="Noisier than ORtg: opponents' shooting luck lives here (see Luck-adj net)."),
 "tm_pace": dict(what="Possessions per 48 minutes. More possessions, more counting stats: fantasy players on fast teams get a boost.", formula="Pace = 48 x possessions / (team minutes / 5)", source=TS, sample="Stable within weeks."),
 "tm_pythw": dict(what="Pythagorean wins: the record their points scored and allowed would usually produce.", formula="W = games x ORtg^14 / (ORtg^14 + DRtg^14)", source=TS, sample="Teams beating it by a lot usually come back toward it."),
 "tm_xw": dict(what="Expected wins from luck-adjusted ratings: Pythagorean wins after setting opponents' 3P% and FT% to league average.", formula="W = games x ORtg^14 / (ORtg^14 + adjusted DRtg^14)", source=TS, sample="The record a team's process earned."),
 "tm_luck": dict(what="Opponent shooting luck in points per 100 possessions. Positive = opponents shot worse than average from three and the line against them (good luck, likely to fade).",
     formula="Luck = -100 x (3 x (opp 3PM - opp 3PA x lg 3P%) + (opp FTM - opp FTA x lg FT%)) / possessions", source=TS, sample="Mostly noise; it rarely persists."),
 "tm_ff": dict(what="The four factors: shooting, turnovers, offensive rebounding and free throws, on both ends. Together they explain nearly all of a team's rating.",
     formula="eFG% = (FGM + 0.5 x 3PM) / FGA; TOV% = TOV / possessions; ORB% = ORB / (ORB + opp DRB); FT rate = FTA / FGA. Ranks are among this season's 30 teams.",
     source=TS, sample="Shooting settles slowest; turnovers and rebounding within a few weeks."),
 "tm_efg": dict(what="Effective field-goal percentage: shooting with threes worth 1.5 makes.", formula="eFG% = (FGM + 0.5 x 3PM) / FGA", source=TS, sample="A few weeks."),
 "tm_tov": dict(what="Turnovers per 100 possessions. Lower is better.", formula="TOV% = TOV / possessions", source=TS, sample="A few weeks."),
 "tm_orb": dict(what="Offensive rebound rate: share of their own misses they get back.", formula="ORB% = ORB / (ORB + opp DRB)", source=TS, sample="A few weeks."),
 "tm_ftr": dict(what="Free-throw rate: trips to the line per shot.", formula="FT rate = FTA / FGA", source=TS, sample="A few weeks."),
 "tm_oefg": dict(what="Opponents' effective field-goal percentage. Lower is better.", formula="Opp eFG% = (opp FGM + 0.5 x opp 3PM) / opp FGA", source=TS, sample="Includes opponents' shooting luck."),
 "tm_otov": dict(what="Turnovers forced per 100 possessions.", formula="Opp TOV% = opp TOV / possessions", source=TS, sample="A few weeks."),
 "tm_drb": dict(what="Defensive rebound rate: share of opponents' misses they secure.", formula="DRB% = 1 - opp ORB%", source=TS, sample="A few weeks."),
 "tm_oftr": dict(what="Opponents' free-throw rate: how often they foul. Lower is better.", formula="Opp FT rate = opp FTA / opp FGA", source=TS, sample="A few weeks."),
 "tm_fg3r": dict(what="Three-point attempt rate: share of shots from three.", formula="3PA rate = 3PA / FGA", source=TS, sample="Stable within weeks."),
 "tm_diet": dict(what="Shot diet: where a team's shots come from, and where it lets opponents shoot, by zone, with the FG% in each.",
     formula="Share = FGA in the zone / FGA in the five zones (restricted area, paint, mid-range, corner 3, above-the-break 3).",
     source=f"{NBA} team shot locations, 1996-97 on.", sample="Diet settles fast; zone FG% takes longer."),
 "tm_pt": dict(what="Team play types: how a team scores (pick-and-roll, transition, spot-ups...) and what it allows, with points per possession and the NBA's percentile among teams.",
     formula="Frequency = possessions of the type / all play-type possessions; PPP = points / possessions.", source=f"{NBA} Synergy play types, 2015-16 on.", sample="Under ~100 possessions a type is mostly noise."),
 "tm_left": dict(what="Games left on the schedule (and how many at home).", formula="Remaining regular-season games from today.", source=f"{NBA} ScheduleLeagueV2.", sample="None: the schedule."),
 "tm_next7": dict(what="Games in the next seven days: the streaming number.", formula="Team games from today through 6 days out.", source=f"{NBA} ScheduleLeagueV2.", sample="None: the schedule."),
 "tm_b2b": dict(what="Back-to-backs left: second nights of consecutive days. Teams play worse and rest stars on them.", formula="Remaining games played the day after another game.", source=f"{NBA} ScheduleLeagueV2.", sample="None: the schedule."),
 "tm_oppb2b": dict(what="Games left against an opponent on the second night of a back-to-back: a rest edge.", formula="Remaining games where the opponent played the day before.", source=f"{NBA} ScheduleLeagueV2.", sample="None: the schedule."),
 "tm_sos": dict(what="Strength of remaining schedule: the average opponent's luck-adjusted net rating. Positive = a harder road.",
     formula="Mean over remaining games of the opponent's strength. Strength = (games x this season's luck-adjusted net + 20 x 0.6 x last season's) / (games + 20): last season, regressed 40% to average, until this season has enough games.",
     source=f"{NBA} team stats and schedule.", sample="Early-season SOS leans on last season."),
})

# ---- Lineups
LS = f"{NBA} lineup stats (LeagueDashLineups, per team), 2007-08 on."
T.update({
 "lu_unit": dict(what="The players in the unit: five-man lineups or two-man pairs, with every minute they shared the floor.", formula="All minutes those players were on the floor together.", source=LS, sample="Most five-man units play under 100 minutes all season."),
 "lu_gp": dict(what="Games the unit played together.", formula="Games with at least one shared possession.", source=LS, sample="None: a count."),
 "lu_min": dict(what="Minutes the unit played together; the filter hides units under the floor (50 for five-man, 200 for two-man by default).", formula="Shared minutes.", source=LS, sample="Use the sample-adjusted net under a few hundred minutes."),
 "lu_poss": dict(what="Possessions played together: the sample size behind every rating in the row.", formula="Shared possessions (the NBA's estimate).", source=LS, sample="A unit's net rating swings about +/- 10 at 300 possessions on noise alone."),
 "lu_ortg": dict(what="Points the unit scored per 100 possessions.", formula="100 x points / possessions", source=LS, sample="Noisy below ~500 possessions."),
 "lu_drtg": dict(what="Points the unit allowed per 100 possessions. Lower is better.", formula="100 x opponent points / possessions", source=LS, sample="Noisier than ORtg: opponents' shooting luck."),
 "lu_net": dict(what="Raw net rating: points scored minus allowed per 100 possessions together.", formula="Net = ORtg - DRtg", source=LS, sample="Very noisy in small samples."),
 "lu_adj": dict(what="Net rating with opponents' 3P% and FT% set to league average (the same luck adjustment as on/off and team ratings).",
     formula="Luck-adj = net + 100 x (3 x (opp 3PM - opp 3PA x lg 3P%) + (opp FTM - opp FTA x lg FT%)) / possessions", source=LS, sample="Removes the biggest noise; small samples still swing."),
 "lu_est": dict(what="Sample-adjusted net: the luck-adjusted net pulled toward the team's own luck-adjusted rating, by an amount set by how much the unit has played. Our best estimate of how good the unit really is.",
     formula=("Est = (possessions x luck-adj net + k x team luck-adj net) / (possessions + k). k = noise variance / true-spread variance, measured from how lineup ratings "
              "before Jan 15 line up with the same units' ratings after, over three seasons (covariance of the halves = true spread)."),
     source=f"{LS} k: {LK} (out/lineup_k.json).",
     sample=("Measured on 2022-23 to 2024-25: k = 843 possessions for five-man units (594 units; true spread SD 5.7 per 100) and 1,221 for two-man pairs "
             "(6,553 pairs; SD 4.9). At k possessions a unit's own record and its team's rating count equally; most five-man units never get there.")),
 "lu_efg": dict(what="Effective field-goal percentage of the unit.", formula="(FGM + 0.5 x 3PM) / FGA", source=LS, sample="Noisy in small samples."),
 "lu_tov": dict(what="Turnovers per 100 possessions for the unit.", formula="TOV / possessions", source=LS, sample="Noisy in small samples."),
 "lu_orb": dict(what="Offensive rebound rate for the unit.", formula="ORB / (ORB + opp DRB)", source=LS, sample="Noisy in small samples."),
 "lu_pace": dict(what="Possessions per 48 minutes with the unit on the floor.", formula="48 x possessions / (minutes together)", source=LS, sample="Stable quickly."),
})
