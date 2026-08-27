"""Play-by-play -> weekly per-player aggregates for Football Savant.

nflverse's season/weekly player tables carry the counting stats but not the things that
make a football number mean something: whether a play stayed on schedule (success), how
far downfield the ball was actually thrown, which gap a run went through, what happened
on third down and inside the twenty. Those all live in play-by-play, so we make one pass
over it per season and write the *weekly* aggregates — weekly, because the front end's
form windows (L4/L8) are sums of games, and a season total can't be un-summed.

Output: agg/pbp_<season>.json  ->  {"qb":[...],"rush":[...],"rec":[...]} rows keyed by
(week, player_id). Everything here is regular season only; the postseason is a different
population and mixing it into a season rate is how per-game stats start lying.
"""
import json, os, sys
import numpy as np
import pandas as pd

RAW = os.environ.get("NFL_RAW", "raw")
OUT = os.environ.get("NFL_AGG", "agg")

COLS = ['season','week','season_type','down','ydstogo','yardline_100','goal_to_go',
        'penalty','penalty_player_id','penalty_type','penalty_yards',
        'play_type','yards_gained','epa','qb_epa','success','air_yards','yards_after_catch',
        'xyac_mean_yardage','cp','cpoe','pass_length','pass_location','run_location','run_gap',
        'qb_dropback','qb_scramble','qb_kneel','qb_spike','sack','qb_hit','complete_pass',
        'interception','touchdown','first_down','fumble_lost','two_point_attempt',
        'passer_player_id','rusher_player_id','receiver_player_id']

# Target depth x direction. The 4 depth bands are the ones coaches actually talk in:
# behind the line (screens/swings), the quick game, the intermediate, and the shot.
DEPTH_BANDS = [('b', -99, 0), ('s', 0, 10), ('m', 10, 20), ('d', 20, 999)]
DIRS = [('l', 'left'), ('m', 'middle'), ('r', 'right')]
GAPS = ['le', 'lt', 'lg', 'md', 'rg', 'rt', 're']


def _num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0)


def gap_key(row_loc, row_gap):
    if row_loc == 'middle':
        return 'md'
    side = 'l' if row_loc == 'left' else 'r' if row_loc == 'right' else None
    if side is None or row_gap not in ('end', 'tackle', 'guard'):
        return None
    return side + {'end': 'e', 'tackle': 't', 'guard': 'g'}[row_gap]


def agg_qb(d):
    # A dropback is a pass, a sack, or a scramble — the whole decision, not just the throws.
    # passer_player_id is blank on scrambles (the QB is logged as the rusher), so stitch it.
    db = d[(d.qb_dropback == 1) & (d.qb_kneel == 0) & (d.qb_spike == 0)].copy()
    db['pid'] = db.passer_player_id.where(db.passer_player_id.notna(), db.rusher_player_id)
    db = db[db.pid.notna()]
    att = (db.pass_attempt_f == 1) & (db.sack == 0)
    g = pd.DataFrame({
        'week': db.week, 'pid': db.pid,
        'db': 1.0,
        'db_succ': _num(db.success),
        'db_epa': _num(db.qb_epa),
        'att': att.astype(float),
        'sack': _num(db.sack),
        'scr': _num(db.qb_scramble),
        'hit': _num(db.qb_hit),
        'ay': _num(db.air_yards).where(att, 0.0),
        'deep': ((db.pass_length == 'deep') & att).astype(float),
        'cpoe_sum': _num(db.cpoe).where(db.cpoe.notna(), 0.0),
        'cpoe_n': db.cpoe.notna().astype(float),
        'td3': ((db.down == 3) | (db.down == 4)).astype(float),
        'td3_conv': (((db.down == 3) | (db.down == 4)) & (db.first_down == 1)).astype(float),
        'rz_db': (db.yardline_100 <= 20).astype(float),
        'rz_td': ((db.yardline_100 <= 20) & (db.touchdown == 1)).astype(float),
        'tw': (_num(db.interception) + _num(db.fumble_lost)),
    })
    # Throw map: the same depth x direction lattice the receivers use, so a quarterback's
    # chart and his receivers' charts are read off one grid.
    ay = _num(db.air_yards)
    comp = _num(db.complete_pass)
    for dk, lo, hi in DEPTH_BANDS:
        in_band = (ay >= lo) & (ay < hi) & db.air_yards.notna() & att
        for dirk, dirv in DIRS:
            cell = in_band & (db.pass_location == dirv)
            g['z_%s%s' % (dk, dirk)] = cell.astype(float)
            g['zy_%s%s' % (dk, dirk)] = _num(db.yards_gained).where(cell & (comp == 1), 0.0)
            g['zc_%s%s' % (dk, dirk)] = comp.where(cell, 0.0)
    return g.groupby(['week', 'pid'], as_index=False).sum()


def agg_rush(d):
    r = d[(d.rush_attempt_f == 1) & (d.qb_kneel == 0) & (d.rusher_player_id.notna())].copy()
    gk = [gap_key(a, b) for a, b in zip(r.run_location, r.run_gap)]
    r['gk'] = gk
    base = pd.DataFrame({
        'week': r.week, 'pid': r.rusher_player_id,
        'car': 1.0,
        'car_succ': _num(r.success),
        'car_epa': _num(r.epa),
        'yds': _num(r.yards_gained),
        'stuff': (_num(r.yards_gained) <= 0).astype(float),
        'fd': _num(r.first_down),
        'ex10': (_num(r.yards_gained) >= 10).astype(float),
        'ex20': (_num(r.yards_gained) >= 20).astype(float),
        'rz_car': (r.yardline_100 <= 20).astype(float),
        'rz_td': ((r.yardline_100 <= 20) & (r.touchdown == 1)).astype(float),
        'sd': ((r.down == 3) | (r.down == 4)).astype(float),          # short-yardage duty
        'sd_conv': (((r.down == 3) | (r.down == 4)) & (r.first_down == 1)).astype(float),
    })
    for g in GAPS:
        base['g_' + g] = (r.gk == g).astype(float)
        base['gy_' + g] = _num(r.yards_gained).where(r.gk == g, 0.0)
    return base.groupby(['week', 'pid'], as_index=False).sum()


def agg_rec(d):
    t = d[(d.pass_attempt_f == 1) & (d.receiver_player_id.notna())].copy()
    ay = _num(t.air_yards)
    comp = _num(t.complete_pass)
    base = pd.DataFrame({
        'week': t.week, 'pid': t.receiver_player_id,
        'tgt': 1.0,
        'rec': comp,
        'tgt_succ': _num(t.success),
        'tgt_epa': _num(t.epa),
        'ay': ay,
        'yds': _num(t.yards_gained).where(comp == 1, 0.0),
        'yac': _num(t.yards_after_catch).where(comp == 1, 0.0),
        'xyac': _num(t.xyac_mean_yardage).where(comp == 1, 0.0),
        'xyac_n': ((comp == 1) & t.xyac_mean_yardage.notna()).astype(float),
        'fd': _num(t.first_down),
        'deep': (t.pass_length == 'deep').astype(float),
        'rz_tgt': (t.yardline_100 <= 20).astype(float),
        'rz_td': ((t.yardline_100 <= 20) & (t.touchdown == 1)).astype(float),
        'td3': ((t.down == 3) | (t.down == 4)).astype(float),
        'td3_conv': (((t.down == 3) | (t.down == 4)) & (t.first_down == 1)).astype(float),
        'cp_sum': _num(t.cp).where(t.cp.notna(), 0.0),
        'cp_n': t.cp.notna().astype(float),
    })
    for dk, lo, hi in DEPTH_BANDS:
        in_band = (ay >= lo) & (ay < hi) & t.air_yards.notna()
        for dirk, dirv in DIRS:
            cell = in_band & (t.pass_location == dirv)
            base['z_%s%s' % (dk, dirk)] = cell.astype(float)
            base['zy_%s%s' % (dk, dirk)] = _num(t.yards_gained).where(cell & (comp == 1), 0.0)
            base['zc_%s%s' % (dk, dirk)] = comp.where(cell, 0.0)
    return base.groupby(['week', 'pid'], as_index=False).sum()


def agg_pen(d):
    """Penalties by type, per player-week.

    The only line on a lineman's record that is unambiguously his. False starts and
    offensive holding are ~40% of all offensive flags and are overwhelmingly called on
    blockers, so they get their own counters; the rest are pooled. Attribution runs
    92–100% complete back to 1999.
    """
    p = d[(d.penalty == 1) & d.penalty_player_id.notna()].copy()
    if not len(p):
        return []
    t = p.penalty_type.fillna('')
    base = pd.DataFrame({
        'week': p.week, 'pid': p.penalty_player_id,
        'pen': 1.0,
        'pen_fs': t.eq('False Start').astype(float),
        'pen_hold': t.eq('Offensive Holding').astype(float),
        'pen_yds': _num(p.penalty_yards),
    })
    return base.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def run_season(year):
    path = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not os.path.exists(path):
        return None
    have = pd.read_parquet(path, columns=None, engine='pyarrow')
    cols = [c for c in COLS if c in have.columns]
    d = have[cols].copy()
    del have
    d = d[d.season_type == 'REG']
    for c in ['qb_dropback', 'qb_scramble', 'qb_kneel', 'qb_spike', 'sack', 'qb_hit',
              'complete_pass', 'interception', 'touchdown', 'first_down', 'fumble_lost',
              'goal_to_go', 'down', 'yardline_100', 'penalty']:
        if c not in d.columns:
            d[c] = 0
        d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
    # play_type is the only reliable pass/rush flag across the whole 1999+ span
    d['pass_attempt_f'] = ((d.play_type == 'pass') & (d.sack == 0)).astype(int)
    # scrambles carry play_type 'run' and count as carries in the box score, so they stay in
    d['rush_attempt_f'] = (d.play_type == 'run').astype(int)
    out = {
        'qb': agg_qb(d).to_dict(orient='records'),
        'rush': agg_rush(d).to_dict(orient='records'),
        'rec': agg_rec(d).to_dict(orient='records'),
        'pen': agg_pen(d),
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'pbp_%d.json' % year), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return {k: len(v) for k, v in out.items()}


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or list(range(1999, 2026))
    for y in years:
        r = run_season(y)
        print(y, r, flush=True)
