"""Basketball Savant's Data Room tables: player-games and shots.

    python3 pipeline/dataroom/nba.py player_games 1996-97:2025-26     the archive, from the Mac's cache
    python3 pipeline/dataroom/nba.py shots 2024-25                     pulls ShotChartDetail per team

Both tables come from the same NBA tables Basketball Savant is built from, through the engine's
own client (savant_engine.call), so a row here is the row the page counted:
    player_games   PlayerGameLogs (Regular Season), one row per player per game
    shots          ShotChartDetail, one call per team-season (a league-wide call stops at 102,400
                   rows, measured Nov 2026), one row per field-goal attempt

For the season in progress the cloud refresh runs the same functions with the ESPN shim
installed (pipeline/basketball/cloud_refresh.py), which is where the page's own numbers come
from in season; see build_current().

Run the archive from the Mac's Basketball-Savant folder (its cache/ holds the game logs):
    cd ~/Basketball-Savant && python3 <repo>/pipeline/dataroom/nba.py player_games 1996-97:2025-26

Estimates are labeled in the dictionary: possessions and usage are worked out from the box
score (the NBA's own per-game possessions are an Advanced table this pipeline has never pulled).
"""
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import frame_rows, write_table, newest  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_PUBLIC = os.environ.get('DATAROOM_OUT', os.path.join(ROOT, 'public', 'dataroom'))
OUT_HOSTED = os.environ.get('DATAROOM_HOSTED', os.path.join(ROOT, 'out', 'dataroom'))
SEASON_TYPE = 'Regular Season'
FIRST_SEASON = '1996-97'       # the first season the NBA's game logs and shot charts have

PG_COLUMNS = ['game_id', 'date', 'player_id', 'player', 'team', 'opponent', 'home', 'result',
              'min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'tov',
              'stl', 'blk', 'blka', 'pf', 'pfd', 'plus_minus', 'dd2', 'td3', 'ts', 'usg', 'team_poss', 'poss']
SHOT_COLUMNS = ['game_id', 'date', 'player_id', 'player', 'team', 'opponent', 'home', 'period', 'clock',
                'seconds_left', 'event_id', 'made', 'value', 'action', 'zone', 'area', 'range', 'distance',
                'x', 'y', 'assisted']


def seasons_between(a, b):
    out = []
    y = int(a[:4])
    while y <= int(b[:4]):
        out.append(f'{y}-{str(y + 1)[2:]}')
        y += 1
    return out


# ---------------------------------------------------------------- player-games
def player_games_frame(gl, season):
    """PlayerGameLogs frame (NBA or shim) -> the Data Room's player_games rows (a DataFrame)."""
    g = gl.copy()
    if not len(g):
        return pd.DataFrame(columns=PG_COLUMNS)
    num = ['MIN', 'PTS', 'FGM', 'FGA', 'FG3M', 'FG3A', 'FTM', 'FTA', 'OREB', 'DREB', 'REB', 'AST', 'TOV', 'STL', 'BLK',
           'BLKA', 'PF', 'PFD', 'PLUS_MINUS', 'DD2', 'TD3']
    for c in num:
        g[c] = pd.to_numeric(g[c], errors='coerce') if c in g.columns else np.nan
    g['GAME_ID'] = g['GAME_ID'].astype(str).str.zfill(10)
    g['date'] = pd.to_datetime(g['GAME_DATE']).dt.strftime('%Y-%m-%d')
    m = g['MATCHUP'].astype(str)
    g['home'] = m.str.contains(' vs. ').astype(int)
    g['opponent'] = m.str.split(r' vs\. | @ ', regex=True).str[-1]
    # team and opponent totals in each game, for possessions and usage
    t = g.groupby(['GAME_ID', 'TEAM_ABBREVIATION'])[['MIN', 'FGA', 'FTA', 'OREB', 'TOV']].sum().reset_index()
    t['tposs'] = t.FGA + 0.44 * t.FTA - t.OREB + t.TOV
    o = t.rename(columns={'TEAM_ABBREVIATION': 'opponent', 'tposs': 'oposs'})[['GAME_ID', 'opponent', 'oposs']]
    t = t.merge(o, on='GAME_ID')
    t = t[t.TEAM_ABBREVIATION != t.opponent]
    t['team_poss'] = 0.5 * (t.tposs + t.oposs)
    t = t.rename(columns={'MIN': 'tmin', 'FGA': 'tfga', 'FTA': 'tfta', 'TOV': 'ttov'})[
        ['GAME_ID', 'TEAM_ABBREVIATION', 'tmin', 'tfga', 'tfta', 'ttov', 'team_poss']]
    g = g.merge(t, on=['GAME_ID', 'TEAM_ABBREVIATION'], how='left')
    tsa = g.FGA + 0.44 * g.FTA
    g['ts'] = np.where(tsa > 0, g.PTS / (2 * tsa), np.nan)
    share = np.where(g.tmin > 0, g.MIN / (g.tmin / 5.0), np.nan)
    g['poss'] = g.team_poss * share
    plays = g.tfga + 0.44 * g.tfta + g.ttov
    g['usg'] = np.where((g.MIN > 0) & (plays > 0), 100.0 * (g.FGA + 0.44 * g.FTA + g.TOV) * (g.tmin / 5.0) / (g.MIN * plays), np.nan)
    out = pd.DataFrame({
        'game_id': g.GAME_ID, 'date': g.date, 'player_id': g.PLAYER_ID.astype(int), 'player': g.PLAYER_NAME,
        'team': g.TEAM_ABBREVIATION, 'opponent': g.opponent, 'home': g.home, 'result': g.WL.where(g.WL.astype(str) != '', None),
        'min': g.MIN.round(2), 'pts': g.PTS, 'fgm': g.FGM, 'fga': g.FGA, 'fg3m': g.FG3M, 'fg3a': g.FG3A, 'ftm': g.FTM,
        'fta': g.FTA, 'oreb': g.OREB, 'dreb': g.DREB, 'reb': g.REB, 'ast': g.AST, 'tov': g.TOV, 'stl': g.STL,
        'blk': g.BLK, 'blka': g.BLKA, 'pf': g.PF, 'pfd': g.PFD, 'plus_minus': g.PLUS_MINUS, 'dd2': g.DD2, 'td3': g.TD3,
        'ts': g.ts, 'usg': g.usg.round(1), 'team_poss': g.team_poss.round(1), 'poss': g.poss.round(1)})
    out = out.sort_values(['date', 'game_id', 'team', 'player_id'], kind='mergesort').reset_index(drop=True)
    return out[PG_COLUMNS]


def write_player_games(season, gl, out=None):
    df = player_games_frame(gl, season)
    rows = frame_rows(df, PG_COLUMNS, {'ts': 3, 'min': 2, 'usg': 1, 'team_poss': 1, 'poss': 1})
    through = newest(rows, PG_COLUMNS)
    path = os.path.join(out or OUT_HOSTED, 'nba', 'player_games', f'{season}.json.gz')
    raw, gz = write_table(path, 'nba', 'player_games', season, PG_COLUMNS, rows, through, {'season_type': SEASON_TYPE})
    return {'season': season, 'rows': len(rows), 'raw': raw, 'gz': gz, 'through': through, 'path': path}


# ---------------------------------------------------------------- shots
def shots_frame(frames, season, assisted=None):
    """ShotChartDetail frames (one per team) -> shots rows. `assisted` maps (game_id, event_id) -> 0/1."""
    s = pd.concat([f for f in frames if f is not None and len(f)], ignore_index=True) if frames else pd.DataFrame()
    if not len(s):
        return pd.DataFrame(columns=SHOT_COLUMNS)
    s = s.drop_duplicates(['GAME_ID', 'GAME_EVENT_ID', 'PLAYER_ID'])
    s['GAME_ID'] = s['GAME_ID'].astype(str).str.zfill(10)
    ds = s['GAME_DATE'].astype(str)
    s['date'] = ds.str.slice(0, 4) + '-' + ds.str.slice(4, 6) + '-' + ds.str.slice(6, 8) if not ds.str.contains('-').any() else ds.str.slice(0, 10)
    s['team'] = s['TEAM_ABBREVIATION'] if 'TEAM_ABBREVIATION' in s.columns else None
    if s['team'] is None or s['team'].isna().all():
        s['team'] = np.where(s.get('TEAM_SIDE', '') == 'H', s.HTM, s.VTM) if 'TEAM_SIDE' in s.columns else None
    mins = pd.to_numeric(s.MINUTES_REMAINING, errors='coerce')
    secs = pd.to_numeric(s.SECONDS_REMAINING, errors='coerce')
    per = pd.to_numeric(s.PERIOD, errors='coerce')
    out = pd.DataFrame({
        'game_id': s.GAME_ID, 'date': s.date, 'player_id': pd.to_numeric(s.PLAYER_ID).astype(int), 'player': s.PLAYER_NAME,
        'team': s.team, 'home': None, 'opponent': None, 'period': per,
        'clock': [f'{int(a)}:{int(b):02d}' if a == a and b == b else None for a, b in zip(mins, secs)],
        'seconds_left': mins * 60 + secs, 'event_id': pd.to_numeric(s.GAME_EVENT_ID).astype(int),
        'made': pd.to_numeric(s.SHOT_MADE_FLAG).astype(int),
        'value': np.where(s.SHOT_TYPE.astype(str).str.startswith('3'), 3, 2),
        'action': s.ACTION_TYPE, 'zone': s.SHOT_ZONE_BASIC, 'area': s.SHOT_ZONE_AREA, 'range': s.SHOT_ZONE_RANGE,
        'distance': pd.to_numeric(s.SHOT_DISTANCE, errors='coerce'), 'x': pd.to_numeric(s.LOC_X, errors='coerce'),
        'y': pd.to_numeric(s.LOC_Y, errors='coerce')})
    out['home'] = (out.team == s.HTM.values).astype(int)
    out['opponent'] = np.where(out.home == 1, s.VTM.values, s.HTM.values)
    if assisted is not None:
        out['assisted'] = [assisted.get((g, e)) for g, e in zip(out.game_id, out.event_id)]
    else:
        out['assisted'] = None
    out = out.sort_values(['date', 'game_id', 'period', 'seconds_left', 'event_id'], ascending=[True, True, True, False, True],
                          kind='mergesort').reset_index(drop=True)
    return out[SHOT_COLUMNS]


def write_shots(season, frames, assisted=None, out=None, extra=None):
    df = shots_frame(frames, season, assisted)
    rows = frame_rows(df, SHOT_COLUMNS)
    through = newest(rows, SHOT_COLUMNS)
    path = os.path.join(out or OUT_HOSTED, 'nba', 'shots', f'{season}.json.gz')
    raw, gz = write_table(path, 'nba', 'shots', season, SHOT_COLUMNS, rows, through, dict({'season_type': SEASON_TYPE}, **(extra or {})))
    return {'season': season, 'rows': len(rows), 'raw': raw, 'gz': gz, 'through': through, 'path': path}


# ---------------------------------------------------------------- through the engine
def _engine():
    # the caller's engine: the Mac's (archive, run from ~/Basketball-Savant) or the cloud's (with the shim)
    eng = os.environ.get('NBA_ENGINE_DIR', os.getcwd())
    if eng not in sys.path:
        sys.path.insert(0, eng)
    import savant_engine as E
    return E


def fetch_game_logs(season):
    E = _engine()
    from nba_api.stats.endpoints import playergamelogs as G
    return E.call(G.PlayerGameLogs, dict(season_nullable=season, season_type_nullable=SEASON_TYPE))


def team_ids():
    from nba_api.stats.static import teams
    return sorted(t['id'] for t in teams.get_teams())


def fetch_shots(season, log=print):
    E = _engine()
    from nba_api.stats.endpoints import shotchartdetail as SC
    frames = []
    for tid in team_ids():
        params = dict(team_id=tid, player_id=0, season_nullable=season, season_type_all_star=SEASON_TYPE,
                      context_measure_simple='FGA')
        df = E.call(SC.ShotChartDetail, params, frame=0)
        if os.environ.get('DATAROOM_DISK_LIGHT') == '1':
            # the raw responses are ~3 MB a team-season; savant_shots.py throws them away too
            try:
                import savant_config as C
                os.remove(os.path.join(C.CACHE_DIR, E._key('ShotChartDetail', params, 0) + '.json'))
            except OSError:
                pass
        if df is not None and len(df):
            df = df.copy()
            frames.append(df)
    log(f'  {season}: {sum(len(f) for f in frames)} shots from {len(frames)} teams')
    return frames


def build_current(season, out_public=None, out_hosted=None, log=print):
    """The season in progress, inside the cloud refresh (the ESPN shim answers E.call)."""
    rep = [write_player_games(season, fetch_game_logs(season), out_public)]
    try:
        rep.append(write_shots(season, fetch_shots(season, log=log), out=out_hosted))
    except Exception as e:  # noqa
        log(f'  data room shots {season}: failed ({repr(e)[:120]})')
    return rep


if __name__ == '__main__':
    what, span = sys.argv[1], sys.argv[2]
    a, b = (span.split(':') + [span])[:2]
    for s in seasons_between(a, b):
        if what == 'player_games':
            r = write_player_games(s, fetch_game_logs(s))
        elif what == 'shots':
            r = write_shots(s, fetch_shots(s))
        else:
            raise SystemExit(f'unknown table {what}')
        print(f"nba {what} {s}: {r['rows']} rows, {r['raw']/1e6:.1f} MB raw, {r['gz']/1e6:.2f} MB gz, through {r['through']}", flush=True)
