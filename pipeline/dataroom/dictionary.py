"""The Data Room's dictionary: every new table and every column, defined.

    python3 pipeline/dataroom/dictionary.py        writes public/dataroom/dictionary.json

Each column: what it is, its unit, its source, the first season it has values, and its caveat.
The six tables that were already in the connector (Basketball Coaching Savant's, College
Basketball Savant's and College Basketball Coaching Savant's) keep their own dictionaries
(bcs/data/dictionary.json, cbb/registry.json, cbcs/data/dictionary.json); api/_dataroom.js
reads those where it serves them. Football Savant's per-game rates take their definitions
from Football Savant's own metric registry (pipeline/football/metrics.py), so a column here
and a bar on the page are described by one sentence.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'dataroom', 'dictionary.json.gz')

NFLV = 'nflverse play-by-play (nflfastR model outputs for EPA, WP, CPOE, xpass)'
PART = 'nflverse participation (NFL Next Gen Stats), 2016 on'
FTNS = 'FTN charting via nflverse, 2022 on'
NBA = 'NBA stats (stats.nba.com), as Basketball Savant reads it; ESPN for the season in progress'
UFCS = 'UFCStats, as UFC Savant reads it'
CFBS = 'College Football Savant (WCE) on ESPN play-by-play'


def C(what, unit='', source='', since=None, caveat=None):
    d = {'what': what, 'unit': unit, 'source': source}
    if since is not None:
        d['since'] = since
    if caveat:
        d['caveat'] = caveat
    return d


def flag(what, source, since=None, caveat=None):
    return C(what, 'flag (1 yes, 0 no)', source, since, caveat)


# ---------------------------------------------------------------- NFL plays
NFL_PLAYS = {
    'game_id': C('nflverse game id: season_week_away_home', 'id', NFLV, 1999),
    'play_id': C('nflverse play id, unique within a game and in game order', 'id', NFLV, 1999),
    'season_type': C('REG or POST. Football Savant\'s season numbers are regular season only', 'text', NFLV, 1999),
    'week': C('Week of the season (postseason weeks continue the count)', 'week', NFLV, 1999),
    'date': C('Game date', 'YYYY-MM-DD', NFLV, 1999),
    'home': C('Home team', 'team', NFLV, 1999, 'Franchise codes as they are now (LA, LAC, LV), the way Football Savant writes them'),
    'away': C('Away team', 'team', NFLV, 1999),
    'posteam': C('Team with the ball', 'team', NFLV, 1999),
    'defteam': C('Team on defense', 'team', NFLV, 1999),
    'qtr': C('Quarter (5 = overtime)', 'quarter', NFLV, 1999),
    'clock': C('Game clock at the snap', 'MM:SS', NFLV, 1999),
    'game_seconds_left': C('Seconds left in regulation at the snap', 'seconds', NFLV, 1999),
    'drive': C('Drive number in the game', 'count', NFLV, 1999),
    'down': C('Down', 'down', NFLV, 1999),
    'ydstogo': C('Yards to go for a first down', 'yards', NFLV, 1999),
    'yardline_100': C('Yards from the opponent\'s end zone', 'yards', NFLV, 1999),
    'goal_to_go': flag('Goal to go', NFLV, 1999),
    'posteam_score': C('Offense\'s score before the play', 'points', NFLV, 1999),
    'defteam_score': C('Defense\'s score before the play', 'points', NFLV, 1999),
    'play_type': C('pass, run, punt, field_goal, kickoff, extra_point, qb_kneel, qb_spike or no_play (a penalty with no play)', 'text', NFLV, 1999,
                   'A scramble is play_type run with scramble = 1; a sack is play_type pass with sack = 1'),
    'yards_gained': C('Yards gained on the play', 'yards', NFLV, 1999),
    'epa': C('Expected points added', 'points', NFLV, 1999),
    'qb_epa': C('EPA credited to the quarterback: as epa, except a completion fumbled away after the catch is not charged to him. Football Savant\'s EPA per dropback uses this', 'points', NFLV, 1999),
    'wp': C('Offense\'s win probability before the play', 'probability (0-1)', NFLV, 1999),
    'wpa': C('Win probability added for the offense', 'probability (0-1)', NFLV, 1999),
    'success': flag('Successful play: EPA above zero', NFLV, 1999),
    'first_down': flag('Gained a first down', NFLV, 1999),
    'touchdown': flag('A touchdown was scored on the play (by either side; td_team says whose)', NFLV, 1999),
    'td_team': C('Team that scored the touchdown', 'team', NFLV, 1999),
    'qb_dropback': flag('A dropback: a pass, a sack or a scramble', NFLV, 1999),
    'pass_attempt': flag('nflverse pass attempt flag (counts sacks; use play_type = pass and sack = 0 for attempts in the box score)', NFLV, 1999),
    'complete_pass': flag('Completed pass', NFLV, 1999),
    'sack': flag('Sack', NFLV, 1999),
    'qb_hit': flag('Quarterback hit', NFLV, 1999),
    'scramble': flag('Quarterback scramble', NFLV, 1999),
    'interception': flag('Interception', NFLV, 1999),
    'rush_attempt': flag('nflverse rush attempt flag', NFLV, 1999),
    'fumble_lost': flag('Fumble lost', NFLV, 1999),
    'kneel': flag('Quarterback kneel', NFLV, 1999),
    'spike': flag('Quarterback spike', NFLV, 1999),
    'two_point': flag('Two-point try (not a play from scrimmage: Football Savant leaves these out of every rate)', NFLV, 1999),
    'aborted': flag('Aborted snap (a fumbled snap logged as a carry; not a designed run)', NFLV, 1999),
    'passer_id': C('Passer (gsis id). On a scramble the quarterback is the rusher, not the passer', 'id', NFLV, 1999),
    'passer': C('Passer name', 'text', NFLV, 1999),
    'rusher_id': C('Ball carrier (gsis id)', 'id', NFLV, 1999),
    'rusher': C('Ball carrier name', 'text', NFLV, 1999),
    'receiver_id': C('Targeted receiver (gsis id)', 'id', NFLV, 1999),
    'receiver': C('Targeted receiver name', 'text', NFLV, 1999),
    'passing_yards': C('Passing yards credited on the play', 'yards', NFLV, 1999),
    'rushing_yards': C('Rushing yards credited on the play', 'yards', NFLV, 1999),
    'receiving_yards': C('Receiving yards credited to the receiver (not a lateral\'s)', 'yards', NFLV, 1999),
    'air_yards': C('Yards the pass travelled past the line of scrimmage', 'yards', NFLV, 2006, 'Charted unevenly before 2006'),
    'yac': C('Yards after the catch', 'yards', NFLV, 2006),
    'xyac': C('Expected yards after the catch (nflfastR model)', 'yards', NFLV, 2006),
    'cp': C('Completion probability of the throw (nflfastR model): one of the two CPOE inputs', 'probability (0-1)', NFLV, 2006),
    'cpoe': C('Completion percentage over expected on the throw: 100 x (complete - cp)', 'percentage points', NFLV, 2006),
    'xpass': C('Probability the play was a dropback, from the situation (nflfastR model)', 'probability (0-1)', NFLV, 1999),
    'pass_oe': C('Dropback over expected: 100 x (dropback - xpass)', 'percentage points', NFLV, 1999),
    'pass_length': C('short (under 15 air yards) or deep', 'text', NFLV, 2006),
    'pass_location': C('left, middle or right', 'text', NFLV, 2006),
    'run_location': C('left, middle or right', 'text', NFLV, 1999),
    'run_gap': C('end, tackle or guard (none for middle)', 'text', NFLV, 1999),
    'shotgun': flag('Snap in shotgun', NFLV, 1999),
    'no_huddle': flag('No huddle', NFLV, 1999),
    'penalty': flag('A penalty was called on the play', NFLV, 1999),
    'penalty_team': C('Team penalized', 'team', NFLV, 1999),
    'penalty_type': C('Penalty', 'text', NFLV, 1999),
    'penalty_yards': C('Penalty yards', 'yards', NFLV, 1999),
    'sack_by_id': C('Defender credited with the full sack (gsis id)', 'id', NFLV, 1999),
    'sack_by': C('Defender credited with the full sack', 'text', NFLV, 1999),
    'int_by_id': C('Defender who intercepted (gsis id)', 'id', NFLV, 1999),
    'int_by': C('Defender who intercepted', 'text', NFLV, 1999),
    'kicker_id': C('Kicker (gsis id)', 'id', NFLV, 1999),
    'kicker': C('Kicker', 'text', NFLV, 1999),
    'kick_distance': C('Kick distance', 'yards', NFLV, 1999),
    'field_goal_result': C('made, missed or blocked', 'text', NFLV, 1999),
    'extra_point_result': C('good, failed or blocked', 'text', NFLV, 1999),
    'roof': C('outdoors, dome, closed or open', 'text', NFLV, 1999),
    'formation': C('Offensive formation (SHOTGUN, SINGLEBACK, EMPTY, I_FORM, PISTOL, JUMBO, WILDCAT)', 'text', PART, 2016,
                   'Participation is published after the season (since 2023), so the season in progress has none'),
    'off_personnel': C('Offensive personnel, e.g. "1 RB, 1 TE, 3 WR"', 'text', PART, 2016, 'Not in the season in progress'),
    'def_personnel': C('Defensive personnel, e.g. "4 DL, 2 LB, 5 DB"', 'text', PART, 2016, 'Not in the season in progress'),
    'box': C('Defenders in the box', 'count', PART, 2016, 'Not in the season in progress; ftn_box has the FTN count from 2022'),
    'pass_rushers': C('Pass rushers', 'count', PART, 2016, 'Not in the season in progress'),
    'pressure': flag('The quarterback was pressured', PART, 2016, 'Not in the season in progress'),
    'time_to_throw': C('Seconds from snap to throw', 'seconds', PART, 2016, 'Not in the season in progress'),
    'coverage': C('Coverage shell (COVER_0 to COVER_6, 2_MAN, ...)', 'text', PART, 2018, 'Not in the season in progress'),
    'man_zone': C('MAN_COVERAGE or ZONE_COVERAGE', 'text', PART, 2018, 'Not in the season in progress'),
    'route': C('Targeted receiver\'s route', 'text', PART, 2018, 'Not in the season in progress'),
    'play_action': flag('Play action', FTNS, 2022), 'rpo': flag('Run-pass option', FTNS, 2022),
    'screen': flag('Screen pass', FTNS, 2022), 'motion': flag('Pre-snap motion', FTNS, 2022),
    'qb_location': C('U (under center), S (shotgun) or P (pistol)', 'text', FTNS, 2022),
    'out_of_pocket': flag('Quarterback threw or was sacked outside the pocket', FTNS, 2022),
    'blitzers': C('Blitzers (rushers beyond the defensive line)', 'count', FTNS, 2022),
    'ftn_rushers': C('Pass rushers, as FTN counts them', 'count', FTNS, 2022),
    'ftn_box': C('Defenders in the box, as FTN counts them', 'count', FTNS, 2022),
    'drop': flag('Dropped pass', FTNS, 2022), 'catchable': flag('Catchable ball', FTNS, 2022),
    'contested': flag('Contested catch opportunity', FTNS, 2022), 'throw_away': flag('Throwaway', FTNS, 2022),
    'int_worthy': flag('Interception-worthy throw', FTNS, 2022), 'created_reception': flag('Reception the receiver created', FTNS, 2022),
    'trick_play': flag('Trick play', FTNS, 2022),
}

NFL_GAMES = {
    'game_id': C('nflverse game id', 'id', 'nflverse schedules', 1999), 'season_type': C('REG, WC, DIV, CON or SB', 'text', 'nflverse schedules', 1999),
    'week': C('Week', 'week', 'nflverse schedules', 1999), 'date': C('Game date', 'YYYY-MM-DD', 'nflverse schedules', 1999),
    'team': C('This row\'s team (franchise code as it is now)', 'team', 'nflverse', 1999), 'opponent': C('Opponent', 'team', 'nflverse', 1999),
    'home': flag('Home team', 'nflverse schedules', 1999), 'neutral': flag('Neutral site', 'nflverse schedules', 1999),
    'points': C('Points scored', 'points', 'nflverse schedules', 1999), 'opp_points': C('Points allowed', 'points', 'nflverse schedules', 1999),
    'result': C('W, L or T', 'text', 'nflverse schedules', 1999), 'overtime': flag('Went to overtime', 'nflverse schedules', 1999),
    'favored_by': C('Closing point spread from this team\'s side: positive when favored', 'points', 'nflverse schedules (closing line)', 1999),
    'total_line': C('Closing over/under', 'points', 'nflverse schedules (closing line)', 1999),
    'moneyline': C('This team\'s closing moneyline', 'American odds', 'nflverse schedules', 2006, 'Missing for many older games'),
    'rest': C('Days since this team\'s previous game', 'days', 'nflverse schedules', 1999), 'opp_rest': C('Opponent\'s days of rest', 'days', 'nflverse schedules', 1999),
    'div_game': flag('Division game', 'nflverse schedules', 1999), 'roof': C('Roof', 'text', 'nflverse schedules', 1999),
    'surface': C('Playing surface', 'text', 'nflverse schedules', 1999), 'temp': C('Temperature (outdoor games)', 'degrees F', 'nflverse schedules', 1999),
    'wind': C('Wind (outdoor games)', 'mph', 'nflverse schedules', 1999), 'coach': C('Head coach', 'text', 'nflverse schedules', 1999),
    'qb_id': C('Starting quarterback (gsis id)', 'id', 'nflverse schedules', 1999), 'qb': C('Starting quarterback', 'text', 'nflverse schedules', 1999),
    'plays': C('Offensive plays: passes, sacks, scrambles and runs; no kneels, spikes or two-point tries (Football Savant\'s team table)', 'count', 'WCE from nflverse play-by-play', 1999),
    'epa': C('Total offensive EPA on those plays', 'points', 'WCE from nflverse play-by-play', 1999),
    'epa_play': C('Offensive EPA per play', 'points per play', 'WCE from nflverse play-by-play', 1999),
    'success_rate': C('Share of offensive plays with EPA above zero', 'rate (0-1)', 'WCE from nflverse play-by-play', 1999),
    'dropbacks': C('Dropbacks', 'count', 'WCE from nflverse play-by-play', 1999), 'pass_epa': C('EPA on dropbacks', 'points', 'WCE', 1999),
    'pass_epa_play': C('EPA per dropback', 'points per play', 'WCE', 1999), 'pass_success_rate': C('Success rate on dropbacks', 'rate (0-1)', 'WCE', 1999),
    'runs': C('Designed runs (no scrambles, no aborted snaps)', 'count', 'WCE', 1999), 'rush_epa': C('EPA on designed runs', 'points', 'WCE', 1999),
    'rush_epa_play': C('EPA per designed run', 'points per play', 'WCE', 1999), 'rush_success_rate': C('Success rate on designed runs', 'rate (0-1)', 'WCE', 1999),
    'sacks': C('Sacks taken', 'count', 'WCE', 1999), 'turnovers': C('Interceptions plus fumbles lost', 'count', 'WCE', 1999),
    'explosive20': C('Plays of 20+ yards', 'count', 'WCE', 1999), 'third_fourth_downs': C('Third- and fourth-down plays', 'count', 'WCE', 1999),
    'third_fourth_converted': C('Third and fourth downs converted', 'count', 'WCE', 1999),
    'd_plays': C('Opponent\'s offensive plays (this team on defense)', 'count', 'WCE', 1999), 'd_epa': C('EPA allowed', 'points', 'WCE', 1999),
    'd_epa_play': C('EPA allowed per play', 'points per play', 'WCE', 1999), 'd_success_rate': C('Opponent success rate', 'rate (0-1)', 'WCE', 1999),
    'd_dropbacks': C('Opponent dropbacks', 'count', 'WCE', 1999), 'd_pass_epa': C('EPA allowed on dropbacks', 'points', 'WCE', 1999),
    'd_pass_epa_play': C('EPA allowed per dropback', 'points per play', 'WCE', 1999), 'd_runs': C('Opponent designed runs', 'count', 'WCE', 1999),
    'd_rush_epa': C('EPA allowed on designed runs', 'points', 'WCE', 1999), 'd_rush_epa_play': C('EPA allowed per designed run', 'points per play', 'WCE', 1999),
    'd_sacks': C('Sacks made', 'count', 'WCE', 1999), 'd_turnovers': C('Takeaways (interceptions and fumbles recovered)', 'count', 'WCE', 1999),
}

NFL_PG_HEAD = {
    'game_id': C('nflverse game id', 'id', 'nflverse schedules', 1999), 'season_type': C('REG: the weekly lines are regular season only', 'text', 'Football Savant', 1999),
    'week': C('Week', 'week', 'Football Savant', 1999), 'date': C('Game date', 'YYYY-MM-DD', 'nflverse schedules', 1999),
    'player_id': C('Player (gsis id)', 'id', 'nflverse', 1999), 'player': C('Player', 'text', 'Football Savant', 1999),
    'position': C('Football Savant position (QB, RB, WR, TE, OT, OG, OC, ED, DI, LB, CB, S, K, P)', 'text', 'Football Savant', 1999),
    'team': C('His team that week', 'team', 'Football Savant', 1999), 'opponent': C('Opponent', 'team', 'Football Savant', 1999),
    'home': flag('Home game', 'Football Savant', 1999),
}
NFL_BOX = {
    'completions': 'Completions', 'attempts': 'Pass attempts', 'passing_yards': 'Passing yards', 'passing_tds': 'Passing touchdowns',
    'interceptions': 'Interceptions thrown', 'sacks_taken': 'Sacks taken', 'sack_yards': 'Yards lost to sacks', 'passing_air_yards': 'Air yards on attempts',
    'passing_epa': 'EPA on his passes (nflverse)', 'carries': 'Carries', 'rushing_yards': 'Rushing yards', 'rushing_tds': 'Rushing touchdowns',
    'rushing_epa': 'EPA on his carries (nflverse)', 'targets': 'Targets', 'receptions': 'Receptions', 'receiving_yards': 'Receiving yards',
    'receiving_tds': 'Receiving touchdowns', 'receiving_air_yards': 'Air yards on his targets', 'receiving_yac': 'Yards after the catch',
    'receiving_epa': 'EPA on his targets (nflverse)', 'target_share': 'Share of team targets (0-1)', 'air_yards_share': 'Share of team air yards (0-1)',
    'fumbles_lost': 'Fumbles lost', 'tackles_solo': 'Solo tackles', 'tackle_assists': 'Assisted tackles', 'tackles_for_loss': 'Tackles for loss',
    'def_sacks': 'Sacks', 'qb_hits': 'Quarterback hits', 'def_interceptions': 'Interceptions', 'passes_defended': 'Passes defended',
    'forced_fumbles': 'Forced fumbles', 'fg_made': 'Field goals made', 'fg_att': 'Field goal attempts', 'pat_made': 'Extra points made',
    'pat_att': 'Extra point attempts', 'fantasy_points': 'Standard fantasy points (nflverse)', 'fantasy_points_ppr': 'PPR fantasy points (nflverse)',
}


def nfl_player_games():
    sys.path.insert(0, os.path.join(ROOT, 'pipeline', 'football'))
    import metrics as M
    cols = dict(NFL_PG_HEAD)
    for k, v in NFL_BOX.items():
        cols[k] = C(v + ' in the game', 'count' if 'share' not in k else 'rate (0-1)', 'nflverse weekly player stats (the box line)', 1999)
    units = {'num0': 'count', 'num1': 'number', 'num2': 'number', 'num3': 'number', 'pct0': 'percent', 'pct1': 'percent', 'epa': 'points',
             'yds': 'yards', 'sec': 'seconds', 'ft': 'feet'}
    for m in M.METRICS:
        e = m.get('exp') or {}
        what = m['label'] + (': ' + e['w'] if e.get('w') else '')
        cav = 'One game\'s value of the season stat, worked out by the same function the season card uses (pipeline/football/weekly.py)'
        if e.get('f'):
            cav += f". Formula: {e['f']}"
        cols[m['key']] = C(what, units.get(m['unit'], m['unit']), 'Football Savant (WCE)', m.get('since', 1999), cav)
    denoms = dict(M.DENOMS, td3='third-down dropbacks')   # td3 is written by build.py but not in DENOMS
    for k, v in denoms.items():
        cols['n_' + k] = C(f'Sample behind the rates: {v} in the game', 'count', 'Football Savant (WCE)', 1999,
                           'Written only where the season card writes it (dropbacks only on a line with a pass attempt)')
    return cols


# ---------------------------------------------------------------- NBA
NBA_PG = {
    'game_id': C('Game id: the NBA\'s 10-digit id; in the season in progress ESPN\'s event id (the cloud refresh reads ESPN)', 'id', NBA, '1996-97'),
    'date': C('Game date', 'YYYY-MM-DD', NBA, '1996-97'),
    'player_id': C('NBA person id (the id nba_get_player_profile takes)', 'id', NBA, '1996-97'), 'player': C('Player', 'text', NBA, '1996-97'),
    'team': C('His team', 'team', NBA, '1996-97'), 'opponent': C('Opponent', 'team', NBA, '1996-97'), 'home': flag('Home game', NBA, '1996-97'),
    'result': C('W or L', 'text', NBA, '1996-97'), 'min': C('Minutes played', 'minutes', NBA, '1996-97'),
    **{k: C(v, 'count', NBA, '1996-97') for k, v in {
        'pts': 'Points', 'fgm': 'Field goals made', 'fga': 'Field goal attempts', 'fg3m': 'Threes made', 'fg3a': 'Three-point attempts',
        'ftm': 'Free throws made', 'fta': 'Free throw attempts', 'oreb': 'Offensive rebounds', 'dreb': 'Defensive rebounds', 'reb': 'Rebounds',
        'ast': 'Assists', 'tov': 'Turnovers', 'stl': 'Steals', 'blk': 'Blocks', 'blka': 'His shots blocked', 'pf': 'Personal fouls',
        'pfd': 'Fouls drawn', 'dd2': 'Double-double (1 or 0)', 'td3': 'Triple-double (1 or 0)'}.items()},
    'plus_minus': C('Plus-minus: the score margin while he was on the floor (the on-court net this table holds)', 'points', NBA, '1996-97'),
    'ts': C('True shooting: pts / (2 x (fga + 0.44 x fta))', 'rate (0-1)', 'WCE from the box score', '1996-97'),
    'usg': C('Usage: 100 x (fga + 0.44 fta + tov) x (team minutes / 5) / (min x (team fga + 0.44 team fta + team tov))', 'percent', 'WCE from the box score', '1996-97',
             'An estimate from the box score, not the NBA\'s tracked usage'),
    'team_poss': C('Team possessions in the game: the average of both teams\' fga + 0.44 fta - oreb + tov', 'possessions', 'WCE from the box score', '1996-97', 'An estimate'),
    'poss': C('His on-court possessions: team_poss x his share of the team\'s minutes (min / (team minutes / 5))', 'possessions', 'WCE from the box score', '1996-97', 'An estimate'),
}
NBA_SHOTS = {
    'game_id': C('Game id, as in player_games (ESPN\'s event id in the season in progress)', 'id', NBA, '1996-97'),
    'date': C('Game date', 'YYYY-MM-DD', NBA, '1996-97'),
    'player_id': C('Shooter (NBA person id)', 'id', NBA, '1996-97'), 'player': C('Shooter', 'text', NBA, '1996-97'),
    'team': C('Shooter\'s team', 'team', NBA, '1996-97'), 'opponent': C('Opponent', 'team', NBA, '1996-97'), 'home': flag('Shooter\'s team at home', NBA, '1996-97'),
    'period': C('Period (5+ = overtime)', 'period', NBA, '1996-97'), 'clock': C('Clock left in the period', 'M:SS', NBA, '1996-97'),
    'seconds_left': C('Seconds left in the period', 'seconds', NBA, '1996-97'), 'event_id': C('NBA play-by-play event number', 'id', NBA, '1996-97'),
    'made': flag('Made', NBA, '1996-97'), 'value': C('2 or 3', 'points', NBA, '1996-97'),
    'action': C('NBA shot description, e.g. Driving Layup Shot, Pullup Jump shot', 'text', NBA, '1996-97'),
    'zone': C('Restricted Area, In The Paint (Non-RA), Mid-Range, Left Corner 3, Right Corner 3, Above the Break 3, Backcourt', 'text', NBA, '1996-97'),
    'area': C('Side of the floor', 'text', NBA, '1996-97', 'Null in the season in progress: the ESPN feed it is built from has no such field'),
    'range': C('Distance band', 'text', NBA, '1996-97', 'Null in the season in progress (as area)'),
    'distance': C('Shot distance', 'feet', NBA, '1996-97'),
    'x': C('Court x: tenths of a foot from the hoop, sideline to sideline (the NBA\'s LOC_X)', 'tenths of a foot', NBA, '1996-97'),
    'y': C('Court y: tenths of a foot from the hoop toward half court (LOC_Y)', 'tenths of a foot', NBA, '1996-97'),
    'assisted': flag('Assisted (made shots only)', 'not built yet', None, 'Not in this build: the NBA\'s shot chart does not carry the assist, and joining the play-by-play is on the review list. Always null'),
}

# ---------------------------------------------------------------- CFB
CFB_PLAYS = {
    'game_id': C('ESPN game id', 'id', CFBS, 2014), 'play_id': C('ESPN play id', 'id', CFBS, 2014), 'drive_id': C('ESPN drive id', 'id', CFBS, 2014),
    'season_type': C('2 regular season, 3 postseason', 'code', CFBS, 2014), 'week': C('Week', 'week', CFBS, 2014),
    'date': C('Game date (Eastern)', 'YYYY-MM-DD', CFBS, 2014), 'period': C('Quarter (5+ = overtime)', 'quarter', CFBS, 2014),
    'secs_left_half': C('Seconds left in the half', 'seconds', CFBS, 2014), 'secs_left_game': C('Seconds left in regulation', 'seconds', CFBS, 2014),
    'offense_id': C('Offense (ESPN team id)', 'id', CFBS, 2014), 'offense': C('Offense', 'team', CFBS, 2014),
    'defense_id': C('Defense (ESPN team id)', 'id', CFBS, 2014), 'defense': C('Defense', 'team', CFBS, 2014),
    'home': flag('Offense is the home team', CFBS, 2014), 'down': C('Down', 'down', CFBS, 2014), 'distance': C('Yards to go', 'yards', CFBS, 2014),
    'yardline_100': C('Yards from the opponent\'s end zone', 'yards', CFBS, 2014), 'score_diff': C('Offense\'s lead before the play', 'points', CFBS, 2014),
    'play_type': C('rush, pass, punt, fg, kickoff, penalty, ... (College Football Savant\'s own category)', 'text', CFBS, 2014),
    'espn_type': C('ESPN\'s play type', 'text', 'ESPN', 2014), 'yards': C('Yards gained', 'yards', CFBS, 2014),
    'ep': C('Expected points before the play (WCE model)', 'points', CFBS, 2014), 'epa': C('Expected points added (WCE model)', 'points', CFBS, 2014),
    'wp': C('Offense\'s win probability before the play (WCE model)', 'probability (0-1)', CFBS, 2014), 'wpa': C('Win probability added', 'probability (0-1)', CFBS, 2014),
    'success': flag('Success: 50% of the distance on 1st down, 70% on 2nd, all of it on 3rd/4th, or a TD; only on scrimmage plays', CFBS, 2014),
    'scrimmage': flag('Counts as a scrimmage play: a rush or pass, no kneel, spike, overtime or play wiped out by penalty', CFBS, 2014),
    'garbage': flag('Garbage time: a margin above 38 points in the 2nd quarter, 28 in the 3rd, 22 in the 4th. Left out of every page number by default', CFBS, 2014),
    'garbage_wp': flag('Garbage time by win probability (the page\'s alternative filter)', CFBS, 2014),
    'pass': flag('A dropback (scrimmage pass, sack or scramble)', CFBS, 2014), 'rush': flag('A scrimmage rush', CFBS, 2014),
    'attempt': flag('A pass attempt (no sack)', CFBS, 2014), 'complete': flag('Completed', CFBS, 2014), 'sack': flag('Sack', CFBS, 2014),
    'interception': flag('Interception', CFBS, 2014), 'fumble_lost': flag('Fumble lost', CFBS, 2014), 'touchdown': flag('Offensive touchdown', CFBS, 2014),
    'first_down': flag('First down gained', CFBS, 2014), 'scramble': flag('Scramble', CFBS, 2014), 'kneel': flag('Kneel', CFBS, 2014),
    'spike': flag('Spike', CFBS, 2014), 'penalty': flag('Penalty on the play', CFBS, 2014), 'no_play': flag('Penalty wiped the play out', CFBS, 2014),
    'xpass': C('Probability of a pass from the situation (WCE model)', 'probability (0-1)', CFBS, 2014),
    'xc': C('Expected completion of the throw (FBS rate at its depth, side, down and distance)', 'probability (0-1)', CFBS, 2025,
            'Only on throws whose depth the stat crew charted (the play text has it from 2025)'),
    'red_zone': flag('Snap inside the 20', CFBS, 2014), 'passing_down': flag('Passing down: 2nd and 8+, or 3rd/4th and 5+', CFBS, 2014),
    'passer_id': C('Passer (ESPN athlete id; cfb_get_player_profile takes it)', 'id', CFBS, 2014), 'passer': C('Passer', 'text', CFBS, 2014),
    'rusher_id': C('Ball carrier', 'id', CFBS, 2014), 'rusher': C('Ball carrier', 'text', CFBS, 2014),
    'receiver_id': C('Targeted receiver', 'id', CFBS, 2014), 'receiver': C('Targeted receiver', 'text', CFBS, 2014),
    'sack_by_id': C('Sacker', 'id', CFBS, 2014), 'int_by_id': C('Interceptor', 'id', CFBS, 2014), 'pbu_by_id': C('Pass breakup by', 'id', CFBS, 2014),
    'ff_by_id': C('Forced fumble by', 'id', CFBS, 2014), 'tackler1_id': C('First tackler named', 'id', CFBS, 2014), 'tackler2_id': C('Second tackler named', 'id', CFBS, 2014),
    'charted': flag('Read by the charting layer (College Football Savant 1.1). The columns below are filled only where this is 1', CFBS, '2025 week 9'),
    'shotgun': flag('Formation: shotgun (0 = under center)', CFBS, '2025 week 9'), 'no_huddle': flag('Tempo: no huddle', CFBS, '2025 week 9'),
    'depth': C('Pass depth as charted: behind, short, deep', 'text', CFBS, '2025 week 9'), 'direction': C('Pass direction: left, middle, right', 'text', CFBS, '2025 week 9'),
    'run_direction': C('Run direction: left, middle, right', 'text', CFBS, '2025 week 9'),
    'air_yards': C('Air yards', 'yards', CFBS, '2025 week 9'), 'yac': C('Yards after the catch', 'yards', CFBS, '2025 week 9'),
    'hurried_by_id': C('Defender who hurried the passer', 'id', CFBS, '2025 week 9'), 'hurried_by': C('Defender who hurried the passer', 'text', CFBS, '2025 week 9'),
    'hurried_by2_id': C('Second defender credited with the hurry', 'id', CFBS, '2025 week 9'),
    'pressured': flag('Passer hurried or sacked', CFBS, '2025 week 9'),
    'broken_up_by_id': C('Defender who broke up the pass', 'id', CFBS, '2025 week 9'), 'broken_up_by': C('Defender who broke up the pass', 'text', CFBS, '2025 week 9'),
    'tackled_by_id': C('Tackler', 'id', CFBS, '2025 week 9'), 'tackled_by': C('Tackler', 'text', CFBS, '2025 week 9'),
    'tackled_by2_id': C('Second tackler', 'id', CFBS, '2025 week 9'), 'tackled_by3_id': C('Third tackler', 'id', CFBS, '2025 week 9'),
    'n_tacklers': C('Tacklers named', 'count', CFBS, '2025 week 9'),
}
CFB_GAMES = {
    'game_id': C('ESPN game id', 'id', CFBS, 2014), 'season_type': C('2 regular season, 3 postseason', 'code', CFBS, 2014), 'week': C('Week', 'week', CFBS, 2014),
    'date': C('Game date (Eastern)', 'YYYY-MM-DD', CFBS, 2014), 'team_id': C('ESPN team id', 'id', CFBS, 2014), 'team': C('Team', 'text', CFBS, 2014),
    'conference': C('Conference', 'text', CFBS, 2014), 'opponent_id': C('Opponent', 'id', CFBS, 2014), 'opponent': C('Opponent', 'text', CFBS, 2014),
    'opp_conference': C('Opponent\'s conference', 'text', CFBS, 2014), 'home': flag('Home (0 when neutral)', CFBS, 2014), 'neutral': flag('Neutral site', CFBS, 2014),
    'conference_game': flag('Conference game', CFBS, 2014), 'fbs_game': flag('Both teams FBS (only these count on the page)', CFBS, 2014),
    'points': C('Points', 'points', CFBS, 2014), 'opp_points': C('Points allowed', 'points', CFBS, 2014), 'result': C('W, L or T', 'text', CFBS, 2014),
    'margin': C('Points minus points allowed', 'points', CFBS, 2014),
    'spread': C('Closing spread from this team\'s side, positive when favored', 'points', 'the market (ESPN / CFBD lines)', 2014, 'Missing for some FCS opponents'),
    'pregame_wp': C('College Football Savant\'s pre-game win probability for this team (the game file\'s)', 'probability (0-1)', CFBS, 2014),
    'rating': C('This team\'s College Football Savant rating for the season, as its team page shows it (points per game vs an average FBS team; the season in progress: as of the latest build)', 'points', CFBS, 2014),
    'off_rating': C('Offensive part of rating', 'points', CFBS, 2014), 'def_rating': C('Defensive part of rating (higher is better)', 'points', CFBS, 2014),
    'st_rating': C('Special teams part of rating', 'points', CFBS, 2014), 'opp_rating': C('Opponent\'s season rating', 'points', CFBS, 2014,
                   'Null for an FCS opponent (not rated)'),
    'plays': C('Scrimmage plays, garbage time in (the game file\'s count)', 'count', CFBS, 2014),
    'epa_play': C('EPA per play', 'points per play', CFBS, 2014), 'success_rate': C('Success rate', 'rate (0-1)', CFBS, 2014),
    'explosive_rate': C('Explosive play rate (runs 12+, passes 16+)', 'rate (0-1)', CFBS, 2014),
    'pass_epa_play': C('EPA per dropback', 'points per play', CFBS, 2014), 'rush_epa_play': C('EPA per rush', 'points per play', CFBS, 2014),
    'yards': C('Yards', 'yards', CFBS, 2014), 'turnovers': C('Turnovers (box score)', 'count', CFBS, 2014),
    **{f'opp_{k}': C(f'Opponent\'s {v}', u, CFBS, 2014) for k, v, u in [('plays', 'plays', 'count'), ('epa_play', 'EPA per play (allowed)', 'points per play'),
       ('success_rate', 'success rate', 'rate (0-1)'), ('explosive_rate', 'explosive rate', 'rate (0-1)'), ('pass_epa_play', 'EPA per dropback', 'points per play'),
       ('rush_epa_play', 'EPA per rush', 'points per play'), ('yards', 'yards', 'yards'), ('turnovers', 'turnovers', 'count')]},
}

# ---------------------------------------------------------------- UFC
_UFC_STATS = {'kd': 'Knockdowns', 'ss': 'Significant strikes landed', 'ssa': 'Significant strikes attempted', 'ts': 'Total strikes landed',
              'tsa': 'Total strikes attempted', 'td': 'Takedowns landed', 'tda': 'Takedowns attempted', 'sub': 'Submission attempts',
              'rev': 'Reversals', 'ctrl': 'Control time (seconds)', 'head': 'Significant strikes landed to the head', 'heada': 'attempted to the head',
              'body': 'landed to the body', 'bodya': 'attempted to the body', 'leg': 'landed to the legs', 'lega': 'attempted to the legs',
              'dist': 'landed at distance', 'dista': 'attempted at distance', 'clinch': 'landed in the clinch', 'clincha': 'attempted in the clinch',
              'ground': 'landed on the ground', 'grounda': 'attempted on the ground'}


def ufc_stats(scope):
    out = {k: C(v + f' ({scope})', 'seconds' if k == 'ctrl' else 'count', UFCS, 1994,
                'Control time is recorded from about 2000' if k == 'ctrl' else ('Null where UFCStats has no fight stats (stats = 0)' if scope == 'the fight' else None))
           for k, v in _UFC_STATS.items()}
    for k in ('kd', 'ss', 'ssa', 'td', 'tda', 'ctrl', 'head', 'body', 'leg'):
        out['opp_' + k] = C(f'Opponent\'s {_UFC_STATS[k].lower()} ({scope}): what this fighter absorbed or allowed', 'seconds' if k == 'ctrl' else 'count', UFCS, 1994)
    return out


UFC_FIGHTS = {
    'fight_id': C('UFCStats fight id', 'id', UFCS, 1994), 'date': C('Event date', 'YYYY-MM-DD', UFCS, 1994), 'event': C('Event', 'text', UFCS, 1994),
    'division': C('Weight class', 'text', UFCS, 1994), 'title': flag('Title fight', UFCS, 1994),
    'fighter_id': C('This row\'s fighter (the id ufc_get_fighter_profile takes)', 'id', UFCS, 1994), 'fighter': C('Fighter', 'text', UFCS, 1994),
    'opponent_id': C('Opponent', 'id', UFCS, 1994), 'opponent': C('Opponent', 'text', UFCS, 1994),
    'result': C('W, L, D or NC for this fighter', 'text', UFCS, 1994), 'method': C('Method as UFCStats writes it', 'text', UFCS, 1994),
    'finish': C('KO, SUB, DEC, DQ or OTHER (UFC Savant\'s grouping)', 'text', 'UFC Savant', 1994),
    'detail': C('Finish detail, or the judges\' scorecards for a decision', 'text', UFCS, 1994),
    'round': C('Round the fight ended in', 'round', UFCS, 1994), 'time': C('Time into the final round', 'seconds', UFCS, 1994),
    'fight_seconds': C('Fight length: full rounds before the last, plus the time of the last (UFC Savant\'s rule)', 'seconds', 'UFC Savant', 1994),
    'scheduled_rounds': C('Rounds scheduled', 'rounds', UFCS, 1994), 'referee': C('Referee', 'text', UFCS, 1994),
    'bonus': C('Bonuses (comma list: fight, perf, sub, ko)', 'text', UFCS, 1994), 'stats': flag('UFCStats has fight statistics for this fight', UFCS, 1994),
    'elo': C('This fighter\'s UFC Savant Elo going into the fight', 'rating', 'UFC Savant', 1994), 'opp_elo': C('Opponent\'s Elo going in', 'rating', 'UFC Savant', 1994),
    **ufc_stats('the fight'),
}
UFC_ROUNDS = {
    'fight_id': C('UFCStats fight id', 'id', UFCS, 1994), 'date': C('Event date', 'YYYY-MM-DD', UFCS, 1994), 'event': C('Event', 'text', UFCS, 1994),
    'division': C('Weight class', 'text', UFCS, 1994), 'fighter_id': C('Fighter', 'id', UFCS, 1994), 'fighter': C('Fighter', 'text', UFCS, 1994),
    'opponent_id': C('Opponent', 'id', UFCS, 1994), 'opponent': C('Opponent', 'text', UFCS, 1994), 'result': C('Fight result for this fighter', 'text', UFCS, 1994),
    'round': C('Round', 'round', UFCS, 1994), 'round_seconds': C('Seconds fought in the round', 'seconds', 'UFC Savant', 1994),
    'final_round': flag('The fight ended in this round', UFCS, 1994), **ufc_stats('the round'),
}

TABLES = {
    'nfl': {
        'plays': {'row': 'play', 'first': '1999', 'columns': NFL_PLAYS, 'page': '/football-savant.html', 'hosting': 'release',
                  'note': 'Every snap, kick and penalty with a play type, 1999 on, regular season and postseason (season_type). Participation fields from 2016 (not the season in progress: it posts after the season), FTN charting from 2022. Football Savant\'s season numbers are regular season, two-point tries out.'},
        'player_games': {'row': 'player-game', 'first': '1999', 'columns': None, 'page': '/football-savant.html', 'hosting': 'release',
                         'note': 'Every regular-season game line on Football Savant: the box line (nflverse weekly stats) and one game\'s value of every Savant rate the weekly files hold, with the samples behind them (n_ columns). A season only has the columns it tracked.'},
        'games': {'row': 'team-game', 'first': '1999', 'columns': NFL_GAMES, 'page': '/football-savant.html', 'hosting': 'public',
                  'note': 'Both sides of every game, regular season and postseason: result, closing line, rest, weather, and EPA and success each way computed the way Football Savant\'s team table is.'},
    },
    'nba': {
        'player_games': {'row': 'player-game', 'first': '1996-97', 'columns': NBA_PG, 'page': '/basketball-savant.html', 'hosting': 'release',
                         'note': 'Every regular-season player-game from the NBA\'s game logs, 1996-97 on (the first season the NBA\'s logs and shot charts cover), the season in progress from the ESPN feed the cloud refresh reads. Possessions and usage are box-score estimates.'},
        'shots': {'row': 'shot', 'first': '1996-97', 'columns': NBA_SHOTS, 'page': '/basketball-savant.html', 'hosting': 'release',
                  'note': 'Every regular-season field-goal attempt with its location, zone, distance and type, from the NBA\'s shot charts (the ones Basketball Savant\'s heat maps are drawn from).'},
    },
    'cfb': {
        'plays': {'row': 'play', 'first': '2014', 'columns': CFB_PLAYS, 'page': '/college-football-savant.html', 'hosting': 'release',
                  'note': 'Every play of every counted game (FBS vs FBS, final, 80+ scrimmage plays), with College Football Savant\'s own flags: sum scrimmage = 1 and garbage = 0 rows to get a page number. The charted columns start 2025 week 9.'},
        'games': {'row': 'team-game', 'first': '2014', 'columns': CFB_GAMES, 'page': '/college-football-savant.html', 'hosting': 'public',
                  'note': 'Both sides of every game with an FBS team: result, the line, the page\'s pre-game win probability and season ratings, and EPA, success and explosive rate each way (garbage time in, as the game file).'},
    },
    'ufc': {
        'fights': {'row': 'fighter-fight', 'first': '1994', 'columns': UFC_FIGHTS, 'page': '/ufc-savant.html', 'hosting': 'public',
                   'note': 'Every UFC fight from both corners (two rows a fight), by calendar year. Opponent columns sit beside each fighter\'s own, so absorbed strikes need no join.'},
        'rounds': {'row': 'fighter-round', 'first': '1994', 'columns': UFC_ROUNDS, 'page': '/ufc-savant.html', 'hosting': 'public',
                   'note': 'Round by round, where UFCStats has round numbers.'},
    },
}


def build():
    out = {'schema': 1, 'note': 'The WCE Data Room: every table, every column. Units, sources and first seasons per column.', 'sports': {}}
    for sport, tables in TABLES.items():
        out['sports'][sport] = {}
        for t, spec in tables.items():
            cols = spec['columns'] if spec['columns'] is not None else nfl_player_games()
            out['sports'][sport][t] = {k: v for k, v in spec.items() if k != 'columns'}
            out['sports'][sport][t]['columns'] = cols
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sys.path.insert(0, HERE)
    from common import dumps, gz_bytes
    with open(OUT, 'wb') as f:
        f.write(gz_bytes(dumps(out)))
    return out


if __name__ == '__main__':
    d = build()
    n = sum(len(t['columns']) for s in d['sports'].values() for t in s.values())
    print(f'dictionary: {sum(len(s) for s in d["sports"].values())} tables, {n} columns, {os.path.getsize(OUT)/1e3:.0f} KB')
