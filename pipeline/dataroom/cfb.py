"""College Football Savant's Data Room tables: plays and team-games.

    python3 pipeline/dataroom/cfb.py plays 2014-2026
    python3 pipeline/dataroom/cfb.py games 2014-2026

plays: one row per play of every counted game (FBS vs FBS, final, 80+ scrimmage plays), cut
from pipeline.cfb.playergame.prepare_plays, the very frame every player table on the page is
summed from. So the flags here (scrimmage, success, garbage time) are the page's own, and a
sum over these rows is the page's number. 1.1's charted columns (formation, tempo, depth and
direction, air yards, YAC, hurried by, broken up by, tacklers) are filled only where the
charting layer read the play (charted = 1: 2025 week 9 on); null before.

games: one row per team per game (both sides of every game with an FBS team, 2014 on): the
result, the market's line, the page's pre-game win probability and season ratings for both
teams (its published game and team files), and EPA, success and explosive rate each way from
teamgame.parquet (the team pages' table). Names and ratings come from the published files, not
the Mac-only identity and rating tables, so the cloud refresh writes the same bytes.

Only WCE-derived rows: no ESPN play text, no raw release column is copied. Inputs are the
work tables in ~/College-Football-Savant/work (CFB_HOME), the same the page build reads.
Output: plays to DATAROOM_HOSTED (out/dataroom, release assets), games to public/dataroom.
"""
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
from common import frame_rows, write_table, newest  # noqa: E402

OUT_PUBLIC = os.environ.get('DATAROOM_PUBLIC', os.path.join(ROOT, 'public', 'dataroom'))
OUT_HOSTED = os.environ.get('DATAROOM_HOSTED', os.path.join(ROOT, 'out', 'dataroom'))
FIRST = 2014
CHART_START = '2025 week 9'

PLAY_COLUMNS = [
    'game_id', 'play_id', 'drive_id', 'season_type', 'week', 'date', 'period', 'secs_left_half', 'secs_left_game',
    'offense_id', 'offense', 'defense_id', 'defense', 'home', 'down', 'distance', 'yardline_100', 'score_diff',
    'play_type', 'espn_type', 'yards', 'ep', 'epa', 'wp', 'wpa', 'success', 'scrimmage', 'garbage', 'garbage_wp',
    'pass', 'rush', 'attempt', 'complete', 'sack', 'interception', 'fumble_lost', 'touchdown', 'first_down',
    'scramble', 'kneel', 'spike', 'penalty', 'no_play', 'xpass', 'xc', 'red_zone', 'passing_down',
    'passer_id', 'passer', 'rusher_id', 'rusher', 'receiver_id', 'receiver',
    'sack_by_id', 'int_by_id', 'pbu_by_id', 'ff_by_id', 'tackler1_id', 'tackler2_id',
    # 1.1's charted layer
    'charted', 'shotgun', 'no_huddle', 'depth', 'direction', 'run_direction', 'air_yards', 'yac',
    'hurried_by_id', 'hurried_by', 'hurried_by2_id', 'pressured', 'broken_up_by_id', 'broken_up_by',
    'tackled_by_id', 'tackled_by', 'tackled_by2_id', 'tackled_by3_id', 'n_tacklers']
DIGITS = {'wp': 4, 'wpa': 4, 'xpass': 3, 'xc': 3}


def _site(rel):
    import gzip
    import json as _json
    with gzip.open(os.path.join(ROOT, 'public', 'cfb', rel + '.gz'), 'rt') as f:
        return _json.load(f)


def _names(y):
    """Names as the page shows them: the season file's players (published, so the cloud refresh,
    which has no identity table, writes the same bytes as a full build on the Mac)."""
    d = _site(f's/{y}.json')
    i, n = d['cols'].index('id'), d['cols'].index('name')
    return {int(r[i]): r[n] for r in d['players']}


def _teams(games, y):
    g = games[games.season == y]
    m = dict(zip(g.home, g.home_team))
    m.update(dict(zip(g.away, g.away_team)))
    return m


def _et_day(s):
    """A kickoff's calendar day in Eastern time, as the page dates a game (games.parquet holds UTC)."""
    t = pd.to_datetime(s, utc=True)
    return t.dt.tz_convert('America/New_York').dt.strftime('%Y-%m-%d')


def _id(s):
    return pd.to_numeric(s, errors='coerce').astype('Int64').astype(object).where(s.notna(), None)


def plays_frame(y, games=None):
    from pipeline.cfb import playergame as PG
    from pipeline.cfb.paths import WORK
    games = games if games is not None else pd.read_parquet(WORK / 'games.parquet')
    d = PG.prepare_plays(y, games, 'cfbd')
    names = _names(y)
    teams = _teams(games, y)
    dates = dict(zip(games.game_id, _et_day(games.date)))
    nm = lambda s: [names.get(int(v)) if v == v and v is not None else None for v in s]  # noqa: E731
    b = lambda s: s.fillna(False).astype(bool).astype(int)  # noqa: E731
    ok = d.c_ok.fillna(False).astype(bool)
    w = lambda s: s.where(ok, None)  # noqa: E731  charted values only on charted plays
    out = pd.DataFrame({
        'game_id': d.game_id.astype('int64'), 'play_id': d.play_id.astype('int64'), 'drive_id': _id(d.drive_id),
        'season_type': d.season_type, 'week': d.week, 'date': d.game_id.map(dates), 'period': d.period,
        'secs_left_half': d.secs_half, 'secs_left_game': d.secs_game,
        'offense_id': d.off.astype('int64'), 'offense': d.off.map(teams), 'defense_id': d.deff.astype('int64'),
        'defense': d.deff.map(teams), 'home': (d.off == d.home).astype(int), 'down': d.down, 'distance': d.dist,
        'yardline_100': d.ytg, 'score_diff': d.score_diff, 'play_type': d.cat, 'espn_type': d.ptype, 'yards': d.yards,
        'ep': d.ep, 'epa': d.epa, 'wp': d.wp, 'wpa': d.wpa, 'success': b(d.succ), 'scrimmage': b(d.sc),
        'garbage': b(d.garbage_cfbd), 'garbage_wp': b(d.garbage_wp), 'pass': b(d.is_pass), 'rush': b(d.is_rush),
        'attempt': b(d.attp), 'complete': b(d.comp), 'sack': b(d.f_sack), 'interception': b(d.f_int),
        'fumble_lost': b(d.f_fum_lost), 'touchdown': b(d.is_td), 'first_down': b(d.fd), 'scramble': b(d.f_scramble),
        'kneel': b(d.f_kneel), 'spike': b(d.f_spike), 'penalty': b(d.f_pen), 'no_play': b(d.f_pen_noplay),
        'xpass': d.xpass, 'xc': d.xc, 'red_zone': b(d.rz), 'passing_down': b(d.pdn),
        'passer_id': _id(d.passer), 'passer': nm(d.passer), 'rusher_id': _id(d.rusher), 'rusher': nm(d.rusher),
        'receiver_id': _id(d.receiver), 'receiver': nm(d.receiver),
        'sack_by_id': _id(d.sack1), 'int_by_id': _id(d.int_by), 'pbu_by_id': _id(d.pbu_by), 'ff_by_id': _id(d.ff_by),
        'tackler1_id': _id(d.tk1), 'tackler2_id': _id(d.tk2),
        'charted': ok.astype(int), 'shotgun': w(d.c_shotgun.astype(int)), 'no_huddle': w(d.c_nh.astype(int)),
        'depth': w(d.c_depth), 'direction': w(d.c_side), 'run_direction': w(d.c_run_dir), 'air_yards': w(d.c_air),
        'yac': w(d.c_yac), 'hurried_by_id': w(_id(d.c_hur1)), 'hurried_by': w(pd.Series(nm(d.c_hur1), index=d.index)),
        'hurried_by2_id': w(_id(d.c_hur2)), 'pressured': w(d.c_press.astype(int)),
        'broken_up_by_id': w(_id(d.c_pbu1)), 'broken_up_by': w(pd.Series(nm(d.c_pbu1), index=d.index)),
        'tackled_by_id': w(_id(d.c_tk1)), 'tackled_by': w(pd.Series(nm(d.c_tk1), index=d.index)),
        'tackled_by2_id': w(_id(d.c_tk2)), 'tackled_by3_id': w(_id(d.c_tk3)), 'n_tacklers': w(d.c_n_tk)})
    out = out.sort_values(['date', 'game_id', 'play_id'], kind='mergesort').reset_index(drop=True)
    return out[PLAY_COLUMNS]


def build_plays(y):
    df = plays_frame(y)
    rows = frame_rows(df, PLAY_COLUMNS, DIGITS)
    through = newest(rows, PLAY_COLUMNS)
    path = os.path.join(OUT_HOSTED, 'cfb', 'plays', f'{y}.json.gz')
    raw, gz = write_table(path, 'cfb', 'plays', y, PLAY_COLUMNS, rows, through, {'charted_from': CHART_START})
    return {'season': y, 'rows': len(rows), 'raw': raw, 'gz': gz, 'through': through}


GAME_COLUMNS = ['game_id', 'season_type', 'week', 'date', 'team_id', 'team', 'conference', 'opponent_id', 'opponent',
                'opp_conference', 'home', 'neutral', 'conference_game', 'fbs_game', 'points', 'opp_points', 'result',
                'margin', 'spread', 'pregame_wp', 'rating', 'off_rating', 'def_rating', 'st_rating', 'opp_rating',
                'plays', 'epa_play', 'success_rate', 'explosive_rate', 'pass_epa_play', 'rush_epa_play', 'yards',
                'turnovers', 'opp_plays', 'opp_epa_play', 'opp_success_rate', 'opp_explosive_rate', 'opp_pass_epa_play',
                'opp_rush_epa_play', 'opp_yards', 'opp_turnovers']


def build_games(y):
    from pipeline.cfb.paths import WORK
    g = pd.read_parquet(WORK / 'games.parquet')
    g = g[(g.season == y) & g.final.fillna(False).astype(bool)].copy()
    g['day'] = _et_day(g.date)
    # the page's own season ratings (teams/<y>.json) and pre-game win probability (games/<y>.json)
    T_ = _site(f'teams/{y}.json')
    ti = {c: i for i, c in enumerate(T_['cols'])}
    R = {r[ti['id']]: r for r in T_['teams']}
    G_ = _site(f'games/{y}.json')
    gi = {c: i for i, c in enumerate(G_['cols'])}
    wp = {r[gi['gid']]: r[gi['wp_home']] for r in G_['rows']}
    # the team pages' and game file's own rows: every play, garbage time in (site.py games_doc)
    tg = pd.read_parquet(WORK / 'teamgame.parquet')
    tg = tg[(tg.season == y) & (tg.filt == 'all') & tg.game_id.isin(g.game_id)]
    T = {(r.game_id, r.team): r for r in tg.itertuples(index=False)}
    rows = []
    for x in g.itertuples(index=False):
        for side in ('home', 'away'):
            o = 'away' if side == 'home' else 'home'
            tid, oid = int(getattr(x, side)), int(getattr(x, o))
            pts, opts = getattr(x, f'{side}_pts'), getattr(x, f'{o}_pts')
            sp = x.spread_home
            w = wp.get(int(x.game_id))
            a, b = T.get((x.game_id, tid)), T.get((x.game_id, oid))
            rt, ro = R.get(tid), R.get(oid)

            def side_stats(t):
                if t is None:
                    return [None] * 8
                n = t.plays or 0
                r = lambda v: (v / n) if n else None  # noqa: E731
                return [n, t.epa / max(t.epa_n, 1), r(t.succ), r(t.expl), (t.epa_pass / t.db) if t.db else None,
                        (t.epa_rush / t.rush) if t.rush else None, t.yards, t.to_box]
            rows.append([int(x.game_id), x.season_type, x.week, x.day, tid, getattr(x, f'{side}_team'),
                         getattr(x, f'{side}_conf'), oid, getattr(x, f'{o}_team'), getattr(x, f'{o}_conf'),
                         1 if side == 'home' and not x.neutral_site else 0, 1 if x.neutral_site else 0,
                         1 if x.conference_game else 0, 1 if x.fbs_game else 0, pts, opts,
                         'W' if pts > opts else 'L' if pts < opts else 'T', pts - opts,
                         (-sp if side == 'home' else sp) if sp == sp and sp is not None else None,
                         (w if side == 'home' else 1 - w) if w is not None else None,
                         rt[ti['rating']] if rt else None, rt[ti['off']] if rt else None, rt[ti['def']] if rt else None,
                         rt[ti['st']] if rt else None, ro[ti['rating']] if ro else None] + side_stats(a) + side_stats(b))
    df = pd.DataFrame(rows, columns=GAME_COLUMNS).sort_values(['date', 'game_id', 'home'], ascending=[True, True, False], kind='mergesort')
    out = frame_rows(df, GAME_COLUMNS, {c: 4 for c in GAME_COLUMNS if c.endswith('_rate') or c.endswith('_play') or c == 'pregame_wp'})
    through = newest(out, GAME_COLUMNS)
    path = os.path.join(OUT_PUBLIC, 'cfb', 'games', f'{y}.json.gz')
    raw, gz = write_table(path, 'cfb', 'games', y, GAME_COLUMNS, out, through)
    return {'season': y, 'rows': len(out), 'raw': raw, 'gz': gz, 'through': through}


def seasons_arg(a):
    if '-' in a:
        lo, hi = a.split('-')
        return list(range(int(lo), int(hi) + 1))
    return [int(x) for x in a.split(',')]


if __name__ == '__main__':
    import warnings
    warnings.filterwarnings('ignore')
    table, span = sys.argv[1], sys.argv[2]
    fn = {'plays': build_plays, 'games': build_games}[table]
    for y in seasons_arg(span):
        r = fn(y)
        print(f"cfb {table} {y}: {r['rows']} rows, {r['raw']/1e6:.1f} MB raw, {r['gz']/1e6:.2f} MB gz, through {r['through']}", flush=True)
