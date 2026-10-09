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
            'passer_player_id', 'rusher_player_id', 'receiver_player_id',
            # for the splits: what the play was worth, and whose it was
            'posteam', 'qb_epa', 'epa', 'success', 'yards_gained', 'first_down', 'touchdown',
            'two_point_attempt']

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
    # --- the same dropbacks, split the ways a defense or a play-caller can change them.
    # Each split keeps its own count: a rate over forty play-action dropbacks is a rate
    # over forty, and the page says so.
    epa = _num(db.qb_epa).fillna(0)
    pa = db.is_play_action
    blz = (nrush >= 5) & counted
    loc = db.qb_location.astype(str)
    uc, sg = loc.eq('U'), loc.isin(['S', 'P'])
    for key, mask in (('pa', pa), ('npa', ~pa), ('blz', blz), ('nblz', counted & ~blz),
                      ('uc', uc), ('sg', sg)):
        if key not in g.columns:
            g[key] = mask.astype(float)
        g[key + '_epa'] = epa.where(mask, 0.0)
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
    yds = _num(r.yards_gained).fillna(0)
    light, stack = counted & (box <= 6), counted & (box >= 8)
    sneak = r.is_qb_sneak
    g = pd.DataFrame({
        'week': r.week, 'pid': r.rusher_player_id,
        'chart_car': 1.0,
        'box_n': counted.astype(float),
        'box_sum': box.where(counted, 0.0),
        'box8': ((box >= 8) & counted).astype(float),
        'motion': r.is_motion.astype(float),
        'pa': r.is_play_action.astype(float),
        # --- added: the same carries against a light box and a loaded one, and sneaks
        'lt_n': light.astype(float), 'lt_yds': yds.where(light, 0.0),
        'lt_succ': _num(r.success).fillna(0).where(light, 0.0),
        'st_n': stack.astype(float), 'st_yds': yds.where(stack, 0.0),
        'st_succ': _num(r.success).fillna(0).where(stack, 0.0),
        'snk': sneak.astype(float),
        'snk_conv': (sneak & ((r.first_down == 1) | (r.touchdown == 1))).astype(float),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum()


# team-week first-read throws; see the note on _TEAM_TOT in pbp_agg.py
_TEAM_TOT = {}


def agg_rec(d):
    """Charted targets. The point of this table is that it separates a receiver from his
    quarterback: a target that was never catchable is not a failure of the hands."""
    t = d[(d.play_type == 'pass') & (d.sack == 0) & d.receiver_player_id.notna()].copy()
    if not len(t):
        return pd.DataFrame()
    comp = _num(t.complete_pass).fillna(0)
    # Which read the throw went to. FTN marks the quarterback's first read, his second, a
    # designed throw (a screen or a called shot), a checkdown, and a scramble drill.
    read = t.read_thrown.astype(str)
    has_read = read.isin(['1', '2', 'SD', 'CHK', 'DES'])
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
        # --- added
        'rd_n': has_read.astype(float),
        'rd_1': read.eq('1').astype(float),
        'rd_des': read.eq('DES').astype(float),
        'rd_chk': read.eq('CHK').astype(float),
    })
    per = g.groupby(['week', 'pid'], as_index=False).sum()
    # his team's first-read throws in the games he played: the denominator of his share
    who = t.groupby(['week', 'receiver_player_id']).posteam.first().rename('_tm').reset_index() \
           .rename(columns={'receiver_player_id': 'pid'})
    tot = pd.DataFrame({'week': t.week, 'tm': t.posteam, 'tm_rd1': read.eq('1').astype(float)}
                       ).groupby(['week', 'tm'], as_index=False).sum()
    _TEAM_TOT['rec'] = tot
    per = per.merge(who, on=['week', 'pid'], how='left').merge(
        tot, left_on=['week', '_tm'], right_on=['week', 'tm'], how='left')
    return per.drop(columns=['_tm', 'tm']).fillna(0)


def agg_line(d):
    """What every offensive line saw, per team-week: how many men rushed the passer and how
    many stood in the box against the run. In a finished season the participation file says
    this for each lineman's own snaps; this is the same thing for the unit, which is all a
    season in progress can have."""
    x = d[d.posteam.notna() & (d.qb_kneel == 0) & (d.qb_spike == 0)]
    isdb = (x.qb_dropback == 1)
    isrun = (x.play_type == 'run') & (x.qb_scramble != 1)
    nr = _num(x.n_pass_rushers).fillna(0)
    box = _num(x.n_defense_box).fillna(0)
    g = pd.DataFrame({
        'week': x.week, 'tm': x.posteam,
        'rush_n': (isdb & (nr > 0)).astype(float), 'rush_sum': nr.where(isdb & (nr > 0), 0.0),
        'box_n': (isrun & (box > 0)).astype(float), 'box_sum': box.where(isrun & (box > 0), 0.0),
    })
    return g.groupby(['week', 'tm'], as_index=False).sum()


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
    if 'two_point_attempt' in pbp.columns:
        # a two-point try is not a play from scrimmage (see pbp_agg.run_season)
        pbp = pbp[pd.to_numeric(pbp.two_point_attempt, errors='coerce').fillna(0) == 0]
    d = pbp.merge(ftn, left_on=['game_id', 'play_id'],
                  right_on=['nflverse_game_id', 'nflverse_play_id'],
                  how='inner', suffixes=('', '_ftn'))
    if not len(d):
        return None
    for c in ['sack', 'qb_dropback', 'qb_kneel', 'qb_spike', 'qb_scramble', 'complete_pass',
              'first_down', 'touchdown']:
        d[c] = pd.to_numeric(d.get(c), errors='coerce').fillna(0)
    for c in FLAGS:
        d[c] = _bool(d[c]) if c in d.columns else False
    out = {}
    _TEAM_TOT.clear()
    for name, fn in (('qb', agg_qb), ('rush', agg_rush), ('rec', agg_rec), ('line', agg_line)):
        df = fn(d)
        out[name] = [] if df is None or not len(df) else df.to_dict(orient='records')
    if 'rec' in _TEAM_TOT:
        rd1 = {(r.week, r.tm): float(r.tm_rd1) for r in _TEAM_TOT['rec'].itertuples(index=False)}
        for r in out['line']:
            r['tm_rd1'] = rd1.get((r['week'], r['tm']), 0.0)
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
