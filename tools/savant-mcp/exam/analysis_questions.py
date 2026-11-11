"""Writes the 20 analysis questions (a-01 … a-20) into questions.src.json: each is answered by savant_sql or
savant_analyze (founder tier), its gold computed by analysis_gold.py. Run once when the questions change:
    python3 tools/savant-mcp/exam/analysis_questions.py
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

TG = "SELECT season, game_id, team, any_value(home) AS home, sum(pts) AS pts, sum(fgm) AS fgm, sum(fga) AS fga, sum(fg3a) AS fg3a, sum(fta) AS fta, sum(fgm) * 1.0 / sum(fga) AS fg_pct FROM nba.player_games WHERE {w} GROUP BY season, game_id, team"
def compare(sql, o, g, c, ref): return {'tool': 'savant_analyze', 'args': {'study': 'compare', 'sql': sql, 'columns': {'outcome': o, 'group': g, 'cluster': c}, 'options': {'reference': ref}}}
def regress(sql, o, preds, c, model='linear'): return {'tool': 'savant_analyze', 'args': {'study': 'regress', 'sql': sql, 'columns': {'outcome': o, 'predictors': preds, 'cluster': c}, 'options': {'model': model}}}
def trend(sql, o, p, c): return {'tool': 'savant_analyze', 'args': {'study': 'trend', 'sql': sql, 'columns': {'outcome': o, 'period': p, 'cluster': c}}}
DIFF = {'difference': 'tests.0.difference', 'ci_low': 'tests.0.analytic.ci_low', 'ci_high': 'tests.0.analytic.ci_high'}
COEF = lambda i: {'estimate': f'coefficients.{i}.estimate', 'ci_low': f'coefficients.{i}.ci_low', 'ci_high': f'coefficients.{i}.ci_high'}
SLOPE = {'per_period': 'slope.per_period', 'ci_low': 'slope.ci_low', 'ci_high': 'slope.ci_high'}
B2B = ("WITH t AS (SELECT season, team, game_id, date - lag(date) OVER (PARTITION BY season, team ORDER BY date) AS rest FROM (SELECT DISTINCT season, team, game_id, date FROM nba.player_games WHERE season BETWEEN '2015-16' AND '2024-25')), "
       "s AS (" + TG.format(w="season BETWEEN '2015-16' AND '2024-25'") + ") SELECT s.game_id, s.fg_pct, CASE WHEN t.rest = 1 THEN 'b2b' ELSE 'rested' END AS night FROM s JOIN t USING (season, team, game_id)")
NFLS = "FROM nfl.plays WHERE season = '{s}' AND season_type = 'REG' AND play_type IN ('pass', 'run') AND down IS NOT NULL AND epa IS NOT NULL"
Q = [
 ('a-01', 'nba', 'Do NBA teams shoot worse from the field on the second night of a back-to-back? Team-game FG%, 2015-16 through 2024-25: the difference (second night minus rested) and its 95% interval, clustered by game.', compare(B2B, 'fg_pct', 'night', 'game_id', 'rested'), DIFF, 1e-6),
 ('a-02', 'nba', 'How fast has the corner three grown as a share of NBA field-goal attempts, 2014-15 to 2024-25? The slope per season and its 95% interval, clustered by game.', trend("SELECT season, game_id, CASE WHEN zone LIKE '%Corner 3' THEN 1 ELSE 0 END AS c3 FROM nba.shots WHERE season BETWEEN '2014-15' AND '2024-25'", 'c3', 'season', 'game_id'), SLOPE, 1e-6),
 ('a-03', 'nba', 'Average three-point attempts per team-game, league-wide, in 2004-05, 2014-15 and 2024-25.', {'tool': 'savant_sql', 'args': {'sql': "SELECT season, avg(fg3a) AS fg3a FROM (" + TG.format(w="season IN ('2004-05', '2014-15', '2024-25')") + ") GROUP BY season ORDER BY season"}}, 'rows', 1e-6),
 ('a-04', 'nba', 'In 2024-25, holding free-throw attempts fixed, how many points is one more three-point attempt worth to a team in a game? The coefficient and its 95% interval, clustered by team.', regress(TG.format(w="season = '2024-25'"), 'pts', ['fg3a', 'fta'], 'team'), COEF(1), 1e-6),
 ('a-05', 'nba', 'Did NBA teams shoot better at home than away in 2023-24? Team-game FG%, home minus away, with its 95% interval clustered by game.', compare("SELECT game_id, fg_pct, CASE WHEN home = 1 THEN 'home' ELSE 'away' END AS side FROM (" + TG.format(w="season = '2023-24'") + ")", 'fg_pct', 'side', 'game_id', 'away'), DIFF, 1e-6),
 ('a-06', 'nba', 'In 2024-25, how much does each extra foot of shot distance lower the log-odds of a make? Logistic coefficient and 95% interval, clustered by game.', regress("SELECT game_id, made, distance FROM nba.shots WHERE season = '2024-25' AND distance IS NOT NULL", 'made', ['distance'], 'game_id', 'logistic'), COEF(1), 1e-6),
 ('a-07', 'nba', "How many three-point attempts does an NBA player's 3P% need before his own number and his position's average deserve equal weight? The settle point, Basketball Savant's method, 2010-11 through 2025-26.", {'tool': 'savant_analyze', 'args': {'study': 'stability', 'sql': "SELECT g.season, g.player_id, g.team, g.date, g.fg3m, g.fg3a, s.pos FROM nba.player_games g JOIN nba.player_seasons s USING (season, player_id) WHERE s.qualified AND g.season BETWEEN '2010-11' AND '2025-26'", 'columns': {'player': 'player_id', 'season': 'season', 'date': 'date', 'numerator': 'fg3m', 'denominator': 'fg3a', 'team': 'team', 'pool': 'pos'}, 'options': {'window': 'team_last_25', 'stat': 'tp3'}}}, 'settle.k', 0),
 ('a-08', 'nfl', 'How much worse is EPA per dropback when the quarterback is pressured, 2022-2024 regular seasons? The difference and its 95% interval, clustered by game.', compare("SELECT game_id, epa, CASE WHEN pressure = 1 THEN 'pressured' ELSE 'clean' END AS pr FROM nfl.plays WHERE season IN ('2022', '2023', '2024') AND season_type = 'REG' AND qb_dropback = 1 AND epa IS NOT NULL", 'epa', 'pr', 'game_id', 'clean'), DIFF, 1e-6),
 ('a-09', 'nfl', "How fast did NFL offenses move into shotgun, 2012-2024? The slope per season in the share of pass and run plays from shotgun, with its 95% interval clustered by game.", trend("SELECT season, game_id, shotgun FROM nfl.plays WHERE season BETWEEN '2012' AND '2024' AND season_type = 'REG' AND play_type IN ('pass', 'run') AND shotgun IS NOT NULL", 'shotgun', 'season', 'game_id'), SLOPE, 1e-6),
 ('a-10', 'nfl', 'In 2024, holding no-huddle and yards to go fixed, is a play from shotgun associated with more EPA? The coefficient and its 95% interval, clustered by game.', regress("SELECT game_id, epa, shotgun, no_huddle, ydstogo " + NFLS.format(s='2024'), 'epa', ['shotgun', 'no_huddle', 'ydstogo'], 'game_id'), COEF(1), 1e-6),
 ('a-11', 'nfl', 'In 2023, holding shotgun and down fixed, how does each extra yard to go change the log-odds that a play succeeds? Logistic coefficient and 95% interval, clustered by game.', regress("SELECT game_id, success, shotgun, ydstogo, down " + NFLS.format(s='2023'), 'success', ['shotgun', 'ydstogo', 'down'], 'game_id', 'logistic'), COEF(2), 1e-6),
 ('a-12', 'nfl', 'How big has NFL home-field advantage been in win rate, 2010-2024 regular seasons (neutral sites out)? Home minus away, with its 95% interval clustered by game.', compare("SELECT game_id, CASE WHEN result = 'W' THEN 1 ELSE 0 END AS win, CASE WHEN home = 1 THEN 'home' ELSE 'away' END AS side FROM nfl.games WHERE season BETWEEN '2010' AND '2024' AND season_type = 'REG' AND neutral IS DISTINCT FROM 1 AND result IN ('W', 'L')", 'win', 'side', 'game_id', 'away'), DIFF, 1e-6),
 ('a-13', 'nfl', "2015-2024: holding the opponent's rest fixed, is a team's own days of rest associated with its EPA per play? The coefficient and its 95% interval, clustered by team.", regress("SELECT team, epa_play, rest, opp_rest FROM nfl.games WHERE season BETWEEN '2015' AND '2024' AND season_type = 'REG' AND epa_play IS NOT NULL AND rest IS NOT NULL AND opp_rest IS NOT NULL", 'epa_play', ['rest', 'opp_rest'], 'team'), COEF(1), 1e-6),
 ('a-14', 'cfb', 'In 2025 FBS games, how different is EPA per play in garbage time from competitive time? Garbage minus competitive, 95% interval clustered by game.', compare("SELECT game_id, epa, CASE WHEN garbage = 1 THEN 'garbage' ELSE 'competitive' END AS g FROM cfb.plays WHERE season = '2025' AND scrimmage = 1 AND epa IS NOT NULL", 'epa', 'g', 'game_id', 'competitive'), DIFF, 1e-6),
 ('a-15', 'cfb', 'Has college football passed more or less, 2014-2025? The slope per season in the pass share of scrimmage plays (passes and rushes), 95% interval clustered by game.', trend("SELECT season, game_id, CASE WHEN pass = 1 THEN 1 ELSE 0 END AS is_pass FROM cfb.plays WHERE season BETWEEN '2014' AND '2025' AND scrimmage = 1 AND (pass = 1 OR rush = 1)", 'is_pass', 'season', 'game_id'), SLOPE, 1e-6),
 ('a-16', 'cfb', 'In 2024, how much better is an FBS team\'s EPA per play at home than away (neutral sites out)? The coefficient and its 95% interval, clustered by team.', regress("SELECT team_id, epa_play, CASE WHEN home = 1 THEN 1 ELSE 0 END AS home_flag FROM cfb.games WHERE season = '2024' AND neutral IS DISTINCT FROM 1 AND epa_play IS NOT NULL", 'epa_play', ['home_flag'], 'team_id'), COEF(1), 1e-6),
 ('a-17', 'ufc', 'Since 2015, do UFC fighters land more significant strikes per minute in title fights than in other fights? The difference and its 95% interval, clustered by fighter.', compare("SELECT fighter_id, ss * 60.0 / fight_seconds AS slpm, CASE WHEN title = 1 THEN 'title' ELSE 'other' END AS t FROM ufc.fights WHERE stats = 1 AND fight_seconds >= 60 AND season >= '2015'", 'slpm', 't', 'fighter_id', 'other'), DIFF, 1e-6),
 ('a-18', 'ufc', 'Since 2018, holding the significant-strike margin fixed, how much does each extra takedown of margin raise the log-odds of winning a UFC fight? Logistic coefficient and 95% interval, clustered by fight.', regress("SELECT fight_id, CASE WHEN result = 'W' THEN 1 ELSE 0 END AS won, ss - opp_ss AS ss_diff, td - opp_td AS td_diff FROM ufc.fights WHERE stats = 1 AND result IN ('W', 'L') AND season >= '2018'", 'won', ['ss_diff', 'td_diff'], 'fight_id', 'logistic'), COEF(2), 1e-6),
 ('a-19', 'cbb', 'How many points is home court worth in 2024-25 D1 men\'s basketball (D1 opponents, neutral sites out)? Home minus away points, 95% interval clustered by game.', compare("SELECT gid, 'home' AS side, home_pts AS pts FROM cbb.games WHERE season = '2024-25' AND neutral IS DISTINCT FROM 1 AND coalesce(non_d1, 0) = 0 AND home_pts IS NOT NULL UNION ALL SELECT gid, 'away', away_pts FROM cbb.games WHERE season = '2024-25' AND neutral IS DISTINCT FROM 1 AND coalesce(non_d1, 0) = 0 AND home_pts IS NOT NULL", 'pts', 'side', 'gid', 'away'), DIFF, 1e-6),
 ('a-20', 'cross', "Among NBA players with 50 or more games in 2024-25, what percentile is Nikola Jokić's points per game?", {'tool': 'savant_analyze', 'args': {'study': 'distribution', 'sql': "SELECT player, sum(pts) * 1.0 / count(*) AS ppg FROM nba.player_games WHERE season = '2024-25' GROUP BY player HAVING count(*) >= 50", 'columns': {'value': 'ppg', 'id': 'player'}, 'options': {'target_id': 'Nikola Jokić', 'pool': 'NBA players with 50+ games, 2024-25'}}}, 'percentile', 1e-6),
]

def main():
    p = os.path.join(HERE, 'questions.src.json')
    text = open(p).read()
    # Keep the file as written (its own layout, blank lines and all): drop any earlier a- lines, then add
    # the analysis questions, one per line, as a group of their own at the end.
    lines = [l for l in text.split('\n') if not l.lstrip().startswith('{"id": "a-')]
    end = max(i for i, l in enumerate(lines) if l.strip() == ']')
    body = lines[:end]
    while body and body[-1].strip() == '':
        body.pop()
    if body[-1].rstrip().endswith('}') and not body[-1].rstrip().endswith('},'):
        body[-1] = body[-1].rstrip() + ','
    new = [f'    {json.dumps({"id": qid, "sport": sport, "kind": "analysis", "question": text_, "recipe": "analysis", "tier": "founder", "call": call, "read": read, "tolerance": tol}, ensure_ascii=False)}' for qid, sport, text_, call, read, tol in Q]
    new = [l + ',' for l in new[:-1]] + new[-1:]
    open(p, 'w').write('\n'.join(body + [''] + new + lines[end:]))
    keep = json.loads(open(p).read())['questions']
    print(f'{len(Q)} analysis questions; {len(keep)} in all')

if __name__ == '__main__':
    main()
