"""FTN charting -> weekly per-player aggregates for Football Savant.

nflverse publishes FTN Data's play charting as one file a season from 2022 on, and it
carries the things a box score and a play-by-play row cannot see: how many men rushed,
whether the play was play-action or an RPO, whether the ball was catchable, whether it
was dropped, whether the receiver had a man draped on him, how many defenders were in
the box. Pro-Football-Reference used to be the only public source for most of that, and
PFR publishes a season at a time, months after it ends - which is why the pressure,
accuracy and drop rows on this page go blank every September and stay blank until spring.
FTN posts weekly, in season, so those rows can live again.

What it is not: FTN does not chart pressures or hurries, and it never names a defender.
Pressure rate faced, pass-rush pressures and the whole coverage panel still wait for PFR.
Nothing here pretends otherwise.

Output: agg/ftn_<season>.json -> {"qb":[...],"rush":[...],"rec":[...]} rows keyed by
(week, player_id), weekly for the same reason pbp_agg.py is weekly: the page's form
windows are sums of games, and a season total cannot be un-summed.

Every rate carries its own charted denominator (chart_db, chart_att, chart_car,
chart_tgt) rather than leaning on the play-by-play count. The join is high but not
perfect - about 97% of regular-season plays in a finished season, and a shade lower in
the first days of a new one - and dividing a charted numerator by an uncharted
denominator is how a receiver ends up with a drop rate that is quietly too low.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env
import pandas as pd

RAW = os.environ.get("NFL_RAW", "raw")
OUT = os.environ.get("NFL_AGG", "agg")

FIRST_SEASON = 2022        # FTN charting starts here; before this the file does not exist

PBP_COLS = ['game_id', 'play_id', 'season_type', 'week', 'play_type', 'sack',
            'qb_dropback', 'qb_kneel', 'qb_spike', 'qb_scramble', 'complete_pass',
            'passer_player_id', 'rusher_player_id', 'receiver_player_id']

FLAGS = ['is_play_action', 'is_rpo', 'is_motion', 'is_no_huddle', 'is_screen_pass',
         'is_qb_out_of_pocket', 'is_interception_worthy', 'is_throw_away',
         'is_catchable_ball', 'is_contested_ball', 'is_created_reception', 'is_drop',
         'is_qb_fault_sack', 'is_trick_play', 'is_qb_sneak']


def _bool(s):
    """FTN ships booleans as TRUE/FALSE strings through CSV and as real bools through
    parquet; either way an unanswered cell is False, not missing."""
    return s.astype(str).str.upper().isin(['TRUE', '1'])


def _num(s):
    return pd.to_numeric(s, errors='coerce')


def agg_qb(d):
    """A dropback is a pass, a sack or a scramble - the whole decision. Same definition
    as pbp_agg.agg_qb, including stitching the passer id onto scrambles, so the two
    aggregates divide by comparable denominators."""
    db = d[(d.qb_dropback == 1) & (d.qb_kneel == 0) & (d.qb_spike == 0)].copy()
    db['pid'] = db.passer_player_id.where(db.passer_player_id.notna(), db.rusher_player_id)
    db = db[db.pid.notna()]
    if not len(db):
        return pd.DataFrame()
    att = (db.play_type == 'pass') & (db.sack == 0)
    nrush = _num(db.n_pass_rushers).fillna(0)
    # FTN leaves n_pass_rushers at 0 on a play it did not count rushers for, so the
    # rusher-count rows divide by the plays that actually have a count.
    counted = nrush > 0
    read = db.read_thrown.astype(str)
    has_read = read.isin(['1', '2', 'SD', 'CHK', 'DES'])
    g = pd.DataFrame({
        'week': db.week, 'pid': db.pid,
        'chart_db': 1.0,
        'chart_att': att.astype(float),
        # --- what the defense sent
        'rush_n': counted.astype(float),
        'rush_sum': nrush.where(counted, 0.0),
        'blitz': (nrush >= 5).astype(float).where(counted, 0.0),
        # --- what the offense called
        'pa': db.is_play_action.astype(float),
        'rpo': db.is_rpo.astype(float),
        'motion': db.is_motion.astype(float),
        'nohuddle': db.is_no_huddle.astype(float),
        'screen': db.is_screen_pass.astype(float),
        # --- what he did with it
        'oop': db.is_qb_out_of_pocket.astype(float),
        'catchable': db.is_catchable_ball.astype(float).where(att, 0.0),
        'drop': db.is_drop.astype(float).where(att, 0.0),
        'throwaway': db.is_throw_away.astype(float).where(att, 0.0),
        'iw': db.is_interception_worthy.astype(float).where(att, 0.0),
        # --- the progression
        'read_n': has_read.astype(float),
        'read_1': read.eq('1').astype(float),
        'read_chk': read.eq('CHK').astype(float),
        # --- whose sack it was
        'sack_n': _num(db.sack).fillna(0),
        'sack_fault': db.is_qb_fault_sack.astype(float).where(db.sack == 1, 0.0),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum()


def agg_rush(d):
    """Designed runs only for the box count: a scramble is charted against a pass look,
    and averaging the two answers a question nobody asked."""
    r = d[(d.play_type == 'run') & (d.qb_kneel == 0) & (d.qb_scramble != 1)
          & d.rusher_player_id.notna()].copy()
    if not len(r):
        return pd.DataFrame()
    box = _num(r.n_defense_box).fillna(0)
    counted = box > 0
    g = pd.DataFrame({
        'week': r.week, 'pid': r.rusher_player_id,
        'chart_car': 1.0,
        'box_n': counted.astype(float),
        'box_sum': box.where(counted, 0.0),
        'box8': ((box >= 8) & counted).astype(float),
        'motion': r.is_motion.astype(float),
        'pa': r.is_play_action.astype(float),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum()


def agg_rec(d):
    """Charted targets. The point of this table is that it separates a receiver from his
    quarterback: a target that was never catchable is not a failure of the hands."""
    t = d[(d.play_type == 'pass') & (d.sack == 0) & d.receiver_player_id.notna()].copy()
    if not len(t):
        return pd.DataFrame()
    comp = _num(t.complete_pass).fillna(0)
    g = pd.DataFrame({
        'week': t.week, 'pid': t.receiver_player_id,
        'chart_tgt': 1.0,
        'catchable': t.is_catchable_ball.astype(float),
        'drop': t.is_drop.astype(float),
        'contested': t.is_contested_ball.astype(float),
        'contested_rec': (t.is_contested_ball & (comp == 1)).astype(float),
        'created': t.is_created_reception.astype(float),
        'screen': t.is_screen_pass.astype(float),
        'catchable_rec': (t.is_catchable_ball & (comp == 1)).astype(float),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum()


def run_season(year):
    if year < FIRST_SEASON:
        return None
    fpath = os.path.join(RAW, 'ftn_%d.csv' % year)
    ppath = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not os.path.exists(fpath) or not os.path.exists(ppath):
        return None
    ftn = pd.read_csv(fpath, low_memory=False)
    have = pd.read_parquet(ppath, columns=None, engine='pyarrow')
    pbp = have[[c for c in PBP_COLS if c in have.columns]].copy()
    del have
    pbp = pbp[pbp.season_type == 'REG']
    d = pbp.merge(ftn, left_on=['game_id', 'play_id'],
                  right_on=['nflverse_game_id', 'nflverse_play_id'],
                  how='inner', suffixes=('', '_ftn'))
    if not len(d):
        return None
    for c in ['sack', 'qb_dropback', 'qb_kneel', 'qb_spike', 'qb_scramble', 'complete_pass']:
        d[c] = pd.to_numeric(d.get(c), errors='coerce').fillna(0)
    for c in FLAGS:
        d[c] = _bool(d[c]) if c in d.columns else False
    out = {}
    for name, fn in (('qb', agg_qb), ('rush', agg_rush), ('rec', agg_rec)):
        df = fn(d)
        out[name] = [] if df is None or not len(df) else df.to_dict(orient='records')
    out['charted'] = dict(plays=int(len(d)), pbp_plays=int(len(pbp)),
                          share=round(len(d) / float(len(pbp)), 4),
                          weeks=int(pd.to_numeric(d.week, errors='coerce').max()))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'ftn_%d.json' % year), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return out['charted'], {k: len(v) for k, v in out.items() if k != 'charted'}


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        if y < FIRST_SEASON:
            continue
        r = run_season(y)
        if r is None:
            print(y, 'no FTN charting on disk - skipped', flush=True)
        else:
            meta, counts = r
            print(y, 'charted %d of %d regular-season plays (%.0f%%), through week %d ->'
                  % (meta['plays'], meta['pbp_plays'], 100 * meta['share'], meta['weeks']),
                  counts, flush=True)
