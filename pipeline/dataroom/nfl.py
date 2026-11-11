"""Football Savant's Data Room tables, from the nflverse files Football Savant already reads.

    python3 pipeline/dataroom/nfl.py plays 2024            one season of plays
    python3 pipeline/dataroom/nfl.py plays 1999-2025       a range, one season at a time
    python3 pipeline/dataroom/nfl.py games 2024
    python3 pipeline/dataroom/nfl.py player_games 2024

Inputs (NFL_RAW, default pipeline/football/raw, the layout fetch.sh writes):
    pbp/pbp_<y>.parquet         nflverse play-by-play (every season, 1999 on)
    part/part_<y>.csv           participation (2016 on; posted after the season since 2023)
    ftn_<y>.csv                 FTN charting (2022 on, posted weekly)
    schedules.csv               spread, total, rest, roof (every season)
Output: plays and player_games to DATAROOM_HOSTED (out/dataroom: release assets), games to
DATAROOM_PUBLIC (public/dataroom): nfl/<table>/<season>.json.gz

Only derived rows are written: no play description text, no raw file is copied. Columns that a
source only has from some season on are null before it; the dictionary (dictionary.py) names
each one's first season.

Both regular season and postseason plays are kept, marked by season_type. Football Savant's
season numbers are regular season only (pbp_agg.py), so anything reconciled against them
filters season_type = REG first.
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import frame_rows, write_table, newest  # noqa: E402

RAW = os.environ.get('NFL_RAW', os.path.join(os.path.dirname(__file__), '..', 'football', 'raw'))
OUT = os.environ.get('DATAROOM_HOSTED', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'out', 'dataroom'))

# (output column, nflverse column) — the play-by-play part, every season
PBP = [
    ('game_id', 'game_id'), ('play_id', 'play_id'), ('season_type', 'season_type'), ('week', 'week'),
    ('date', 'game_date'), ('home', 'home_team'), ('away', 'away_team'),
    ('posteam', 'posteam'), ('defteam', 'defteam'), ('qtr', 'qtr'), ('clock', 'time'),
    ('game_seconds_left', 'game_seconds_remaining'), ('drive', 'fixed_drive'),
    ('down', 'down'), ('ydstogo', 'ydstogo'), ('yardline_100', 'yardline_100'), ('goal_to_go', 'goal_to_go'),
    ('posteam_score', 'posteam_score'), ('defteam_score', 'defteam_score'),
    ('play_type', 'play_type'), ('yards_gained', 'yards_gained'),
    ('epa', 'epa'), ('qb_epa', 'qb_epa'), ('wp', 'wp'), ('wpa', 'wpa'), ('success', 'success'),
    ('first_down', 'first_down'), ('touchdown', 'touchdown'), ('td_team', 'td_team'),
    ('qb_dropback', 'qb_dropback'), ('pass_attempt', 'pass_attempt'), ('complete_pass', 'complete_pass'),
    ('sack', 'sack'), ('qb_hit', 'qb_hit'), ('scramble', 'qb_scramble'), ('interception', 'interception'),
    ('rush_attempt', 'rush_attempt'), ('fumble_lost', 'fumble_lost'),
    ('kneel', 'qb_kneel'), ('spike', 'qb_spike'), ('two_point', 'two_point_attempt'), ('aborted', 'aborted_play'),
    ('passer_id', 'passer_player_id'), ('passer', 'passer_player_name'),
    ('rusher_id', 'rusher_player_id'), ('rusher', 'rusher_player_name'),
    ('receiver_id', 'receiver_player_id'), ('receiver', 'receiver_player_name'),
    ('passing_yards', 'passing_yards'), ('rushing_yards', 'rushing_yards'), ('receiving_yards', 'receiving_yards'),
    ('air_yards', 'air_yards'), ('yac', 'yards_after_catch'), ('xyac', 'xyac_mean_yardage'),
    ('cp', 'cp'), ('cpoe', 'cpoe'), ('xpass', 'xpass'), ('pass_oe', 'pass_oe'),
    ('pass_length', 'pass_length'), ('pass_location', 'pass_location'),
    ('run_location', 'run_location'), ('run_gap', 'run_gap'),
    ('shotgun', 'shotgun'), ('no_huddle', 'no_huddle'),
    ('penalty', 'penalty'), ('penalty_team', 'penalty_team'), ('penalty_type', 'penalty_type'),
    ('penalty_yards', 'penalty_yards'),
    ('sack_by_id', 'sack_player_id'), ('sack_by', 'sack_player_name'),
    ('int_by_id', 'interception_player_id'), ('int_by', 'interception_player_name'),
    ('kicker_id', 'kicker_player_id'), ('kicker', 'kicker_player_name'), ('kick_distance', 'kick_distance'),
    ('field_goal_result', 'field_goal_result'), ('extra_point_result', 'extra_point_result'),
    ('roof', 'roof'),
]
# participation (2016 on)
PART = [
    ('formation', 'offense_formation'), ('off_personnel', 'offense_personnel'),
    ('def_personnel', 'defense_personnel'), ('box', 'defenders_in_box'),
    ('pass_rushers', 'number_of_pass_rushers'), ('pressure', 'was_pressure'),
    ('time_to_throw', 'time_to_throw'), ('coverage', 'defense_coverage_type'),
    ('man_zone', 'defense_man_zone_type'), ('route', 'route'),
]
# FTN charting (2022 on)
FTN = [
    ('play_action', 'is_play_action'), ('rpo', 'is_rpo'), ('screen', 'is_screen_pass'),
    ('motion', 'is_motion'), ('qb_location', 'qb_location'), ('out_of_pocket', 'is_qb_out_of_pocket'),
    ('blitzers', 'n_blitzers'), ('ftn_rushers', 'n_pass_rushers'), ('ftn_box', 'n_defense_box'),
    ('drop', 'is_drop'), ('catchable', 'is_catchable_ball'), ('contested', 'is_contested_ball'),
    ('throw_away', 'is_throw_away'), ('int_worthy', 'is_interception_worthy'),
    ('created_reception', 'is_created_reception'), ('trick_play', 'is_trick_play'),
]
PLAY_COLUMNS = [c for c, _ in PBP] + [c for c, _ in PART] + [c for c, _ in FTN]
DIGITS = {'wp': 4, 'wpa': 4, 'cp': 3, 'xpass': 3}
BOOL_COLS = {'goal_to_go', 'success', 'first_down', 'touchdown', 'qb_dropback', 'pass_attempt', 'complete_pass',
             'sack', 'qb_hit', 'scramble', 'interception', 'rush_attempt', 'fumble_lost', 'kneel', 'spike',
             'two_point', 'aborted', 'shotgun', 'no_huddle', 'penalty', 'pressure', 'play_action', 'rpo', 'screen', 'motion',
             'out_of_pocket', 'drop', 'catchable', 'contested', 'throw_away', 'int_worthy', 'created_reception',
             'trick_play'}


def _pbp_path(y):
    for p in (os.path.join(RAW, 'pbp', f'pbp_{y}.parquet'), os.path.join(RAW, f'pbp_{y}.parquet')):
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f'no play-by-play for {y} under {RAW}')


def _maybe_csv(*paths):
    for p in paths:
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return pd.read_csv(p, low_memory=False)
    return None


def _bool01(s):
    s = s.map(lambda v: None if v is None or (isinstance(v, float) and np.isnan(v)) else
              (1 if str(v).strip().lower() in ('1', '1.0', 'true', 't', 'yes') else 0))
    return s.astype('object')


def load_plays(y):
    want = sorted({src for _, src in PBP})
    import pyarrow.parquet as pq
    have = set(pq.ParquetFile(_pbp_path(y)).schema_arrow.names)
    p = pd.read_parquet(_pbp_path(y), columns=[c for c in want if c in have])
    for c in want:
        if c not in p.columns:
            p[c] = None
    # Rows with no play_type are timeouts, quarter ends and game ends: no snap, no EPA.
    p = p[p.play_type.notna()].copy()
    out = pd.DataFrame({dst: p[src].values for dst, src in PBP})

    part = _maybe_csv(os.path.join(RAW, 'part', f'part_{y}.csv'), os.path.join(RAW, f'part_{y}.csv')) if y >= 2016 else None
    if part is not None:
        gid = 'nflverse_game_id' if 'nflverse_game_id' in part.columns else 'game_id'
        part = part.rename(columns={gid: 'game_id'})
        keep = ['game_id', 'play_id'] + [src for _, src in PART if src in part.columns]
        part = part[keep].drop_duplicates(['game_id', 'play_id'])
        out = out.merge(part, on=['game_id', 'play_id'], how='left')
    for dst, src in PART:
        out[dst] = out[src] if src in out.columns else None
    ftn = _maybe_csv(os.path.join(RAW, f'ftn_{y}.csv'), os.path.join(RAW, 'ftn', f'ftn_{y}.csv')) if y >= 2022 else None
    if ftn is not None:
        ftn = ftn.rename(columns={'nflverse_game_id': 'game_id', 'nflverse_play_id': 'play_id'})
        keep = ['game_id', 'play_id'] + [src for _, src in FTN if src in ftn.columns]
        ftn = ftn[keep].drop_duplicates(['game_id', 'play_id'])
        out = out.merge(ftn, on=['game_id', 'play_id'], how='left', suffixes=('', '_ftn'))
    for dst, src in FTN:
        out[dst] = out[src] if src in out.columns else None
    for c in BOOL_COLS:
        out[c] = _bool01(out[c])
    for c in ('play_id', 'week', 'qtr', 'down', 'ydstogo', 'yardline_100', 'drive', 'posteam_score', 'defteam_score',
              'yards_gained', 'penalty_yards', 'game_seconds_left', 'box', 'pass_rushers', 'blitzers', 'ftn_rushers', 'ftn_box',
              'kick_distance'):
        out[c] = pd.to_numeric(out[c], errors='coerce').astype('Float64').astype(object).where(out[c].notna(), None)
    out['date'] = out['date'].astype(str).str.slice(0, 10)
    out = out.sort_values(['date', 'game_id', 'play_id'], kind='mergesort').reset_index(drop=True)
    return out[PLAY_COLUMNS]


def build_plays(y):
    df = load_plays(y)
    rows = frame_rows(df, PLAY_COLUMNS, DIGITS)
    through = newest(rows, PLAY_COLUMNS)
    path = os.path.join(OUT, 'nfl', 'plays', f'{y}.json.gz')
    raw, gz = write_table(path, 'nfl', 'plays', y, PLAY_COLUMNS, rows, through)
    return {'season': y, 'rows': len(rows), 'raw': raw, 'gz': gz, 'through': through, 'path': path}


# ---------------------------------------------------------------- games (team-game)
GAME_COLUMNS = ['game_id', 'season_type', 'week', 'date', 'team', 'opponent', 'home', 'neutral', 'points', 'opp_points',
                'result', 'overtime', 'favored_by', 'total_line', 'moneyline', 'rest', 'opp_rest', 'div_game', 'roof',
                'surface', 'temp', 'wind', 'coach', 'qb_id', 'qb',
                'plays', 'epa', 'epa_play', 'success_rate', 'dropbacks', 'pass_epa', 'pass_epa_play', 'pass_success_rate',
                'runs', 'rush_epa', 'rush_epa_play', 'rush_success_rate', 'sacks', 'turnovers', 'explosive20',
                'third_fourth_downs', 'third_fourth_converted',
                'd_plays', 'd_epa', 'd_epa_play', 'd_success_rate', 'd_dropbacks', 'd_pass_epa', 'd_pass_epa_play',
                'd_runs', 'd_rush_epa', 'd_rush_epa_play', 'd_sacks', 'd_turnovers']
SCHED = os.environ.get('NFL_SCHEDULES', os.path.join(RAW, 'schedules.csv'))


def team_game_tallies(plays):
    """Football Savant's team-week tallies (pbp_agg.agg_team) from Data Room play rows: the same
    play filter, the same sums, so a season of them adds up to the page's team table."""
    x = plays[plays.posteam.notna() & plays.defteam.notna() & plays.play_type.isin(['pass', 'run'])
              & (plays.kneel.fillna(0) == 0) & (plays.spike.fillna(0) == 0) & (plays.two_point.fillna(0) == 0)].copy()
    num = lambda s: pd.to_numeric(s, errors='coerce').fillna(0)  # noqa: E731
    isdb = num(x.qb_dropback) == 1
    isrun = (x.play_type == 'run') & (num(x.scramble) == 0) & (num(x.aborted) == 0)
    epa, succ, yds = num(x.epa), num(x.success), num(x.yards_gained)
    late = x.down.isin([3, 4])
    t = pd.DataFrame({'game_id': x.game_id, 'tm': x.posteam, 'plays': 1.0, 'epa': epa, 'succ': succ,
                      'db': isdb.astype(float), 'pepa': epa.where(isdb, 0.0), 'psucc': succ.where(isdb, 0.0),
                      'sk': num(x.sack).where(isdb, 0.0), 'run': isrun.astype(float), 'repa': epa.where(isrun, 0.0),
                      'rsucc': succ.where(isrun, 0.0), 'x20': (yds >= 20).astype(float),
                      'd3': late.astype(float), 'd3c': (late & (num(x.first_down) == 1)).astype(float),
                      'to': num(x.interception) + num(x.fumble_lost)})
    return t.groupby(['game_id', 'tm'], as_index=False).sum()


def build_games(y, plays_path=None):
    import gzip
    import json as _json
    p = plays_path or os.path.join(OUT, 'nfl', 'plays', f'{y}.json.gz')
    with gzip.open(p, 'rt') as f:
        doc = _json.load(f)
    plays = pd.DataFrame(doc['rows'], columns=doc['columns'])
    tal = team_game_tallies(plays)
    sch = pd.read_csv(SCHED, low_memory=False)
    sch = sch[sch.season == y]
    rows = []
    T = {(r.game_id, r.tm): r for r in tal.itertuples(index=False)}
    # The schedule writes the franchise as it was (STL, SD, OAK); play-by-play, and so Football
    # Savant, writes it as it is now (LA, LAC, LV). The game's own play rows say which is which.
    codes = plays.groupby('game_id')[['home', 'away']].first().to_dict('index')
    for g in sch.itertuples(index=False):
        if pd.isna(g.home_score) or pd.isna(g.away_score):
            continue            # not played yet
        cg = codes.get(g.game_id, {'home': g.home_team, 'away': g.away_team})
        for side in ('home', 'away'):
            other = 'away' if side == 'home' else 'home'
            team, opp = cg[side], cg[other]
            pts, opts = getattr(g, f'{side}_score'), getattr(g, f'{other}_score')
            sl = g.spread_line if not pd.isna(g.spread_line) else None
            fav = (sl if side == 'home' else -sl) if sl is not None else None
            o, d = T.get((g.game_id, team)), T.get((g.game_id, opp))
            rate = lambda a, b: (a / b) if (b or 0) > 0 else None  # noqa: E731
            row = [g.game_id, g.game_type, g.week, str(g.gameday)[:10], team, opp, 1 if side == 'home' else 0,
                   1 if str(g.location) == 'Neutral' else 0, pts, opts,
                   'W' if pts > opts else 'L' if pts < opts else 'T', g.overtime, fav, g.total_line,
                   getattr(g, f'{side}_moneyline'), getattr(g, f'{side}_rest'), getattr(g, f'{other}_rest'), g.div_game,
                   g.roof, g.surface, g.temp, g.wind, getattr(g, f'{side}_coach'), getattr(g, f'{side}_qb_id'),
                   getattr(g, f'{side}_qb_name')]
            for z in (o,):
                row += ([z.plays, z.epa, rate(z.epa, z.plays), rate(z.succ, z.plays), z.db, z.pepa, rate(z.pepa, z.db),
                         rate(z.psucc, z.db), z.run, z.repa, rate(z.repa, z.run), rate(z.rsucc, z.run), z.sk, z.to, z.x20,
                         z.d3, z.d3c] if z is not None else [None] * 17)
            row += ([d.plays, d.epa, rate(d.epa, d.plays), rate(d.succ, d.plays), d.db, d.pepa, rate(d.pepa, d.db),
                     d.run, d.repa, rate(d.repa, d.run), d.sk, d.to] if d is not None else [None] * 12)
            rows.append(row)
    df = pd.DataFrame(rows, columns=GAME_COLUMNS).sort_values(['date', 'game_id', 'home'], ascending=[True, True, False],
                                                               kind='mergesort')
    out = frame_rows(df, GAME_COLUMNS, {'epa': 2, 'pass_epa': 2, 'rush_epa': 2, 'd_epa': 2, 'd_pass_epa': 2, 'd_rush_epa': 2})
    through = newest(out, GAME_COLUMNS)
    path = os.path.join(PUB, 'nfl', 'games', f'{y}.json.gz')
    raw, gz = write_table(path, 'nfl', 'games', y, GAME_COLUMNS, out, through)
    return {'season': y, 'rows': len(out), 'raw': raw, 'gz': gz, 'through': through, 'path': path}


# ---------------------------------------------------------------- player_games
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.environ.get('DATAROOM_PUBLIC', os.path.join(ROOT, 'public', 'dataroom'))
WEEKLY = os.environ.get('NFL_WEEKLY', os.path.join(ROOT, 'public', 'football-weekly'))
BOX = [('completions', ['completions']), ('attempts', ['attempts']), ('passing_yards', ['passing_yards']),
       ('passing_tds', ['passing_tds']), ('interceptions', ['passing_interceptions', 'interceptions']),
       ('sacks_taken', ['sacks_suffered', 'sacks']), ('sack_yards', ['sack_yards_lost', 'sack_yards']),
       ('passing_air_yards', ['passing_air_yards']), ('passing_epa', ['passing_epa']),
       ('carries', ['carries']), ('rushing_yards', ['rushing_yards']), ('rushing_tds', ['rushing_tds']),
       ('rushing_epa', ['rushing_epa']), ('targets', ['targets']), ('receptions', ['receptions']),
       ('receiving_yards', ['receiving_yards']), ('receiving_tds', ['receiving_tds']),
       ('receiving_air_yards', ['receiving_air_yards']), ('receiving_yac', ['receiving_yards_after_catch']),
       ('receiving_epa', ['receiving_epa']), ('target_share', ['target_share']), ('air_yards_share', ['air_yards_share']),
       ('fumbles_lost', ['fumbles_lost_total']), ('tackles_solo', ['def_tackles_solo']),
       ('tackle_assists', ['def_tackle_assists']), ('tackles_for_loss', ['def_tackles_for_loss']),
       ('def_sacks', ['def_sacks']), ('qb_hits', ['def_qb_hits']), ('def_interceptions', ['def_interceptions']),
       ('passes_defended', ['def_pass_defended']), ('forced_fumbles', ['def_fumbles_forced']),
       ('fg_made', ['fg_made']), ('fg_att', ['fg_att']), ('pat_made', ['pat_made']), ('pat_att', ['pat_att']),
       ('fantasy_points', ['fantasy_points']), ('fantasy_points_ppr', ['fantasy_points_ppr'])]
PG_HEAD = ['game_id', 'season_type', 'week', 'date', 'player_id', 'player', 'position', 'team', 'opponent', 'home']


def _weekly_players(y):
    import json as _json
    d = os.path.join(WEEKLY, str(y))
    out = {}
    for fn in sorted(os.listdir(d)):
        if not fn.endswith('.json') or fn == 'index.json' or fn.startswith('form-'):
            continue
        with open(os.path.join(d, fn)) as f:
            doc = _json.load(f)
        if fn.startswith('pack-'):
            out.update(doc)
        else:
            out[fn[:-5]] = doc
    return out


def _names(y):
    import json as _json
    names = {}
    for f in ('football-savant-data.json', 'football-savant-current.json'):
        p = os.path.join(ROOT, 'public', f)
        if not os.path.exists(p):
            continue
        with open(p) as fh:
            doc = _json.load(fh)
        for p in (doc.get('data', {}).get(str(y)) or {}).get('players', []):
            names[p['id']] = (p['name'], p.get('pos'))
    return names


def build_player_games(y, wk_path=None):
    wk_path = wk_path or os.path.join(RAW, f'wk_{y}.csv')
    wk = pd.read_csv(wk_path, low_memory=False)
    if 'season_type' in wk.columns:
        wk = wk[wk.season_type == 'REG']
    box = {}
    for r in wk.to_dict('records'):
        box[(r['player_id'], int(r['week']))] = r
    sch = pd.read_csv(SCHED, low_memory=False)
    sch = sch[(sch.season == y) & (sch.game_type == 'REG')]
    gid = {}
    for g in sch.itertuples(index=False):
        gid[(g.home_team, int(g.week))] = (g.game_id, str(g.gameday)[:10])
        gid[(g.away_team, int(g.week))] = (g.game_id, str(g.gameday)[:10])
    names = _names(y)
    wp = _weekly_players(y)
    mkeys = sorted({k for p in wp.values() for k in (p.get('m') or {})})
    dkeys = sorted({k for p in wp.values() for k in (p.get('d') or {})})
    boxcols = [c for c, srcs in BOX if any(s in wk.columns for s in srcs)]
    cols = PG_HEAD + boxcols + mkeys + ['n_' + k for k in dkeys]
    rows = []
    for pid in sorted(wp):
        p = wp[pid]
        nm, pos = names.get(pid, (None, p.get('pos')))
        for i, w in enumerate(p['w']):
            team = p['t'][i]
            o = p['o'][i] or ''
            home = 0 if o.startswith('@') else 1
            g = gid.get((team, int(w)), (None, None))
            b = box.get((pid, int(w)), {})
            if nm is None and b:
                nm = b.get('player_display_name') or b.get('player_name')
            row = [g[0], 'REG', w, g[1], pid, nm, pos or b.get('position'), team, o.lstrip('@'), home]
            for c, srcs in BOX:
                if c in boxcols:
                    v = next((b.get(s) for s in srcs if s in b), None)
                    row.append(v)
            m, dd = p.get('m') or {}, p.get('d') or {}
            row += [(m.get(k) or [None] * len(p['w']))[i] if k in m else None for k in mkeys]
            row += [(dd.get(k) or [None] * len(p['w']))[i] if k in dd else None for k in dkeys]
            rows.append(row)
    df = pd.DataFrame(rows, columns=cols).sort_values(['week', 'game_id', 'team', 'player_id'], kind='mergesort')
    out = frame_rows(df, cols)
    through = newest(out, cols)
    path = os.path.join(OUT, 'nfl', 'player_games', f'{y}.json.gz')
    raw, gz = write_table(path, 'nfl', 'player_games', y, cols, out, through)
    return {'season': y, 'rows': len(out), 'raw': raw, 'gz': gz, 'through': through, 'path': path, 'cols': len(cols)}


def seasons_arg(a):
    if '-' in a:
        lo, hi = a.split('-')
        return list(range(int(lo), int(hi) + 1))
    return [int(x) for x in a.split(',')]


if __name__ == '__main__':
    table, span = sys.argv[1], sys.argv[2]
    fn = {'plays': build_plays, 'games': build_games, 'player_games': build_player_games}[table]
    for y in seasons_arg(span):
        r = fn(y)
        print(f"nfl {table} {y}: {r['rows']} rows, {r['raw']/1e6:.1f} MB raw, {r['gz']/1e6:.2f} MB gz, through {r['through']}")
