"""Play-by-play -> weekly per-player aggregates for Football Savant.

nflverse's season/weekly player tables carry the counting stats but not the things that
make a football number mean something: whether a play stayed on schedule (success), how
far downfield the ball was actually thrown, which gap a run went through, what happened
on third down and inside the twenty. Those all live in play-by-play, so we make one pass
over it per season and write the *weekly* aggregates — weekly, because the front end's
form windows (L4/L8) are sums of games, and a season total can't be un-summed.

Output: agg/pbp_<season>.json  ->  rows keyed by (week, player_id) in

  qb, rush, rec   the three ways a skill player touches the ball
  pen             flags, by the man who drew them
  def             what a defender is credited with play by play: tackles on runs and where
                  they were made, sacks and what they were worth, coverage and pre-snap flags
  kick, punt      kickoffs, the win probability a kicker's kicks moved, and every punt's
                  field position and net
  drive           the drives a quarterback led and how they ended
  ret             kick and punt returns actually run back

and rows keyed by (week, team) in

  line            the offense as a unit: dropbacks, sacks, hits, runs by gap, plus the team
                  totals every "share of his team" number divides by

Everything here is regular season only; the postseason is a different population and
mixing it into a season rate is how per-game stats start lying.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env
import numpy as np
import pandas as pd

RAW = os.environ.get("NFL_RAW", "raw")
OUT = os.environ.get("NFL_AGG", "agg")

COLS = ['rush_touchdown',
        'season','week','season_type','down','ydstogo','yardline_100','goal_to_go',
        'penalty','penalty_player_id','penalty_type','penalty_yards',
        'play_type','yards_gained','epa','qb_epa','success','air_yards','yards_after_catch',
        'xyac_mean_yardage','cp','cpoe','pass_length','pass_location','run_location','run_gap',
        'qb_dropback','qb_scramble','qb_kneel','qb_spike','sack','qb_hit','complete_pass',
        'interception','touchdown','first_down','fumble_lost','two_point_attempt',
        'passer_player_id','rusher_player_id','receiver_player_id',
        # the line as a unit, and the return game
        'posteam','return_team','return_yards','return_touchdown','touchback',
        'punt_fair_catch','kickoff_returner_player_id','punt_returner_player_id',
        # who the defense was, who made the play, and what the game state was
        'game_id','defteam','wp','wpa','penalty_team','receiver_id',
        'solo_tackle_1_player_id','solo_tackle_2_player_id',
        'assist_tackle_1_player_id','assist_tackle_2_player_id',
        'assist_tackle_3_player_id','assist_tackle_4_player_id',
        'tackle_with_assist_1_player_id','tackle_with_assist_2_player_id',
        'sack_player_id','half_sack_1_player_id','half_sack_2_player_id',
        # the kicking game
        'kicker_player_id','punter_player_id','kick_distance','field_goal_result',
        'kickoff_out_of_bounds','punt_blocked','roof',
        # drives
        'fixed_drive','fixed_drive_result']

# Target depth x direction. The 4 depth bands are the ones coaches actually talk in:
# behind the line (screens/swings), the quick game, the intermediate, and the shot.
DEPTH_BANDS = [('b', -99, 0), ('s', 0, 10), ('m', 10, 20), ('d', 20, 999)]
DIRS = [('l', 'left'), ('m', 'middle'), ('r', 'right')]
GAPS = ['le', 'lt', 'lg', 'md', 'rg', 'rt', 're']

TACKLE_COLS = ['solo_tackle_1_player_id', 'solo_tackle_2_player_id',
               'assist_tackle_1_player_id', 'assist_tackle_2_player_id',
               'assist_tackle_3_player_id', 'assist_tackle_4_player_id',
               'tackle_with_assist_1_player_id', 'tackle_with_assist_2_player_id']
# Flags that are a coverage man's, a pass rusher's jump, and a hit on the quarterback.
PEN_COVER = ('Defensive Pass Interference', 'Defensive Holding', 'Illegal Contact')
PEN_JUMP = ('Defensive Offside', 'Neutral Zone Infraction', 'Encroachment')
PEN_ROUGH = ('Roughing the Passer',)


def _num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0)


def _col(d, name):
    """A column that may not exist in an old season: all-missing rather than a KeyError."""
    if name in d.columns:
        return d[name]
    return pd.Series(np.nan, index=d.index)


def _sides(src, g):
    """Attach the team a man played for that week and the team he played against. They
    are words, not counts, so they cannot ride through the sum with everything else."""
    if not len(g):
        return g
    f = pd.DataFrame({'week': src.week, 'pid': src.pid,
                      'tm': _col(src, 'posteam'), 'opp': _col(src, 'defteam')})
    f = f.groupby(['week', 'pid'], as_index=False).first()
    return g.merge(f, on=['week', 'pid'], how='left')


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
    # "Competitive time": the win probability is still between 10% and 90%. Outside it a
    # defense is giving up the underneath throw on purpose and the numbers flatter everybody.
    wp = pd.to_numeric(_col(db, 'wp'), errors='coerce')
    live = (wp >= 0.10) & (wp <= 0.90)
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
        'ng_db': live.astype(float),
        'ng_epa': _num(db.qb_epa).where(live, 0.0),
        'wpa': _num(_col(db, 'wpa')),
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
    return _sides(db, g.groupby(['week', 'pid'], as_index=False).sum())


def agg_rush(d):
    r = d[(d.rush_attempt_f == 1) & (d.qb_kneel == 0) & (d.rusher_player_id.notna())].copy()
    r['pid'] = r.rusher_player_id
    gk = [gap_key(a, b) for a, b in zip(r.run_location, r.run_gap)]
    r['gk'] = gk
    yds = _num(r.yards_gained)
    scr = _num(r.qb_scramble)
    short = ((r.down == 3) | (r.down == 4)) & (_num(r.ydstogo) <= 2)
    base = pd.DataFrame({
        'week': r.week, 'pid': r.rusher_player_id,
        'car': 1.0,
        'car_succ': _num(r.success),
        'car_epa': _num(r.epa),
        'yds': yds,
        'stuff': (yds <= 0).astype(float),
        'fd': _num(r.first_down),
        'ex10': (yds >= 10).astype(float),
        'ex20': (yds >= 20).astype(float),
        'rz_car': (r.yardline_100 <= 20).astype(float),
        'rz_td': ((r.yardline_100 <= 20) & (r.touchdown == 1)).astype(float),
        'sd': ((r.down == 3) | (r.down == 4)).astype(float),          # short-yardage duty
        'sd_conv': (((r.down == 3) | (r.down == 4)) & (r.first_down == 1)).astype(float),
        # a scramble is a pass play that became a run; a designed run is a call. They are
        # different skills and the box score adds them together.
        'scr': scr,
        'scr_yds': yds.where(scr == 1, 0.0),
        'scr_epa': _num(r.epa).where(scr == 1, 0.0),
        'scr_succ': _num(r.success).where(scr == 1, 0.0),
        # the carries that turn into points, and the ones with a yard or two to get
        'i10': (r.yardline_100 <= 10).astype(float),
        'i5': (r.yardline_100 <= 5).astype(float),
        'i5_td': ((r.yardline_100 <= 5) & (r.touchdown == 1)).astype(float),
        # his own touchdowns on the ground - a fumble returned the other way is a
        # touchdown on a running play too, and is not his
        'td': (_num(_col(r, 'rush_touchdown')).fillna(0) == 1).astype(float)
              if 'rush_touchdown' in r.columns else (r.touchdown == 1).astype(float),
        'sy': short.astype(float),
        'sy_conv': (short & ((r.first_down == 1) | (r.touchdown == 1))).astype(float),
    })
    for g in GAPS:
        base['g_' + g] = (r.gk == g).astype(float)
        base['gy_' + g] = yds.where(r.gk == g, 0.0)
    return _sides(r, base.groupby(['week', 'pid'], as_index=False).sum())


def agg_rec(d):
    t = d[(d.pass_attempt_f == 1) & (d.receiver_player_id.notna())].copy()
    t['pid'] = t.receiver_player_id
    ay = _num(t.air_yards)
    comp = _num(t.complete_pass)
    endzone = t.air_yards.notna() & (ay >= _num(t.yardline_100)) & (_num(t.yardline_100) > 0)
    base = pd.DataFrame({
        'week': t.week, 'pid': t.receiver_player_id,
        'tgt': 1.0,
        'rec': comp,
        'tgt_succ': _num(t.success),
        'tgt_epa': _num(t.epa),
        'ay': ay,
        # air yards on the ones he caught, which is what "yards before catch" means; the
        # rating line needs his catches, yards, touchdowns and the picks thrown his way
        'ay_c': ay.where(comp == 1, 0.0),
        'td': _num(t.touchdown).where(comp == 1, 0.0),
        'int': _num(t.interception),
        'yds': _num(t.yards_gained).where(comp == 1, 0.0),
        'yac': _num(t.yards_after_catch).where(comp == 1, 0.0),
        'xyac': _num(t.xyac_mean_yardage).where(comp == 1, 0.0),
        'xyac_n': ((comp == 1) & t.xyac_mean_yardage.notna()).astype(float),
        # the yards after the catch on exactly the catches the expectation covers, so the
        # two can be subtracted without one of them counting plays the other skipped
        'xyac_yac': _num(t.yards_after_catch).where((comp == 1) & t.xyac_mean_yardage.notna(), 0.0),
        'fd': _num(t.first_down),
        'deep': (t.pass_length == 'deep').astype(float),
        'rz_tgt': (t.yardline_100 <= 20).astype(float),
        'rz_td': ((t.yardline_100 <= 20) & (t.touchdown == 1)).astype(float),
        'td3': ((t.down == 3) | (t.down == 4)).astype(float),
        'td3_conv': (((t.down == 3) | (t.down == 4)) & (t.first_down == 1)).astype(float),
        'cp_sum': _num(t.cp).where(t.cp.notna(), 0.0),
        'cp_n': t.cp.notna().astype(float),
        # the catches on exactly the throws that have a completion probability
        'cp_rec': comp.where(t.cp.notna(), 0.0),
        # a throw that travels into the end zone, caught or not
        'ez': endzone.astype(float),
    })
    for dk, lo, hi in DEPTH_BANDS:
        in_band = (ay >= lo) & (ay < hi) & t.air_yards.notna()
        for dirk, dirv in DIRS:
            cell = in_band & (t.pass_location == dirv)
            base['z_%s%s' % (dk, dirk)] = cell.astype(float)
            base['zy_%s%s' % (dk, dirk)] = _num(t.yards_gained).where(cell & (comp == 1), 0.0)
            base['zc_%s%s' % (dk, dirk)] = comp.where(cell, 0.0)
    out = _sides(t, base.groupby(['week', 'pid'], as_index=False).sum())

    # Pass interference drawn. The flag wipes the play off the box score - no target, no
    # yards - but the gamebook still names the man it was thrown to, and nflfastR keeps him
    # in receiver_id. A deep threat can draw a hundred yards a year that nothing credits.
    p = d[(d.penalty_type == 'Defensive Pass Interference') & _col(d, 'receiver_id').notna()]
    if len(p):
        q = pd.DataFrame({'week': p.week, 'pid': p.receiver_id, 'dpi': 1.0,
                          'dpi_yds': _num(p.penalty_yards)})
        q = q.groupby(['week', 'pid'], as_index=False).sum()
        f = pd.DataFrame({'week': p.week, 'pid': p.receiver_id,
                          'tm2': _col(p, 'posteam'), 'opp2': _col(p, 'defteam')})
        f = f.groupby(['week', 'pid'], as_index=False).first()
        out = out.merge(q.merge(f, on=['week', 'pid']), on=['week', 'pid'], how='outer')
        for a, b in (('tm', 'tm2'), ('opp', 'opp2')):
            out[a] = out[a].where(out[a].notna(), out[b])
        out = out.drop(columns=['tm2', 'opp2'])
        num = [c for c in out.columns if c not in ('week', 'pid', 'tm', 'opp')]
        out[num] = out[num].fillna(0.0)
    return out


def agg_pen(d):
    """Penalties by type, per player-week.

    The only line on a lineman's record that is unambiguously his. False starts and
    offensive holding are ~40% of all offensive flags and are overwhelmingly called on
    blockers, so they get their own counters; the rest are pooled. Attribution runs
    92–100% complete back to 1999.

    pen_epa is what the flag cost his own team in expected points: the play's EPA turned
    to his side of the ball, so a holding call that kills a drive weighs more than a
    false start on first and ten.
    """
    p = d[(d.penalty == 1) & d.penalty_player_id.notna()].copy()
    if not len(p):
        return []
    t = p.penalty_type.fillna('')
    his_offense = _col(p, 'penalty_team') == p.posteam
    cost = np.where(his_offense, -_num(p.epa), _num(p.epa))
    cost = np.where(_col(p, 'penalty_team').notna() & p.posteam.notna(), cost, 0.0)
    base = pd.DataFrame({
        'week': p.week, 'pid': p.penalty_player_id,
        'pen': 1.0,
        'pen_fs': t.eq('False Start').astype(float),
        'pen_hold': t.eq('Offensive Holding').astype(float),
        'pen_yds': _num(p.penalty_yards),
        'pen_epa': cost,
        'pen_cov': t.isin(PEN_COVER).astype(float),
        'pen_cov_yds': _num(p.penalty_yards).where(t.isin(PEN_COVER), 0.0),
        'pen_jump': t.isin(PEN_JUMP).astype(float),
        'pen_rough': t.isin(PEN_ROUGH).astype(float),
    })
    return base.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_def(d):
    """What the play-by-play credits to a defender, per player-week.

    The season table has his tackles. It does not have which plays they came on. Every
    tackle here is tied back to its play, which is what turns a count into a location:

      rt, rs, rd     tackles on designed runs, how many were on runs that failed for the
                     offense (a "stop"), and the yards those runs gained
      ptk, pty       tackles on completed passes and the yards those catches gained
      stk            tackles covering kicks and punts
      skn, ske, sky  sacks (halves count half), the expected points they took away, and
                     the yards lost; sk3 is the share that came on third or fourth down

    A solo tackle, an assist and a tackle-with-assist each count once. Splitting an assist
    into half a tackle would make a pile of three men worth less than one man alone.
    """
    parts = []
    run = (d.play_type == 'run') & (d.qb_scramble == 0) & (d.qb_kneel == 0)
    cmp_ = (d.play_type == 'pass') & (d.complete_pass == 1)
    kick = d.play_type.isin(['kickoff', 'punt'])
    yds = _num(d.yards_gained)
    fail = (_num(d.success) == 0)
    for c in TACKLE_COLS:
        if c not in d.columns:
            continue
        m = d[c].notna()
        if not m.any():
            continue
        parts.append(pd.DataFrame({
            'week': d.week[m], 'pid': d[c][m],
            'rt': run[m].astype(float),
            'rs': (run & fail)[m].astype(float),
            'rd': yds.where(run, 0.0)[m],
            'ptk': cmp_[m].astype(float),
            'pty': yds.where(cmp_, 0.0)[m],
            'stk': kick[m].astype(float),
        }))
    sk = d[d.sack == 1]
    for c, w in (('sack_player_id', 1.0), ('half_sack_1_player_id', 0.5),
                 ('half_sack_2_player_id', 0.5)):
        if c not in sk.columns:
            continue
        s = sk[sk[c].notna()]
        if not len(s):
            continue
        parts.append(pd.DataFrame({
            'week': s.week, 'pid': s[c],
            'skn': w,
            'ske': -_num(s.epa) * w,
            'sky': -_num(s.yards_gained) * w,
            'sk3': ((s.down == 3) | (s.down == 4)).astype(float) * w,
        }))
    if not parts:
        return []
    g = pd.concat(parts, ignore_index=True).fillna(0.0)
    g = g.groupby(['week', 'pid'], as_index=False).sum()
    return g.to_dict(orient='records')


def agg_kick(d):
    """Kickoffs, and the win probability a kicker's kicks moved, per kicker-week.

    k_wpa is the plain sum of win probability added on his field goals and extra points.
    It needs no model of its own: the win probability before the kick already prices in
    how likely the kick was, so a made 54-yarder at the gun is worth a lot and a made
    chip shot in the second quarter almost nothing.

    Field goals are also listed by roof, because a man who kicks ten games a year indoors
    is not doing the same job as one who kicks in Buffalo in December.
    """
    out = {}

    def slot(w, pid):
        return out.setdefault((int(w), pid), dict(week=int(w), pid=pid, ko=0.0, ko_tb=0.0,
                              ko_dist=0.0, ko_dn=0.0, ko_oob=0.0, k_wpa=0.0, k_n=0.0,
                              fgo_made=[], fgo_miss=[], fgi_made=[], fgi_miss=[]))
    kid = _col(d, 'kicker_player_id')
    ko = d[(d.play_type == 'kickoff') & kid.notna()]
    kd = pd.to_numeric(_col(ko, 'kick_distance'), errors='coerce')
    for w, pid, tb, dist, oob in zip(ko.week, ko.kicker_player_id, _num(ko.touchback), kd,
                                     _num(_col(ko, 'kickoff_out_of_bounds'))):
        e = slot(w, pid)
        e['ko'] += 1
        e['ko_tb'] += float(tb)
        e['ko_oob'] += float(oob)
        if dist == dist:
            e['ko_dist'] += float(dist)
            e['ko_dn'] += 1
    fk = d[d.play_type.isin(['field_goal', 'extra_point']) & kid.notna()]
    roof = _col(fk, 'roof').fillna('')
    kd = pd.to_numeric(_col(fk, 'kick_distance'), errors='coerce')
    res = _col(fk, 'field_goal_result').fillna('')
    for w, pid, pt, wpa, dist, rf, rs in zip(fk.week, fk.kicker_player_id, fk.play_type,
                                             _num(_col(fk, 'wpa')), kd, roof, res):
        e = slot(w, pid)
        e['k_wpa'] += float(wpa)
        e['k_n'] += 1
        if pt != 'field_goal' or dist != dist:
            continue
        outdoors = rf in ('outdoors', 'open')
        if not rf:
            continue                        # no roof on record: neither list
        key = ('fgo' if outdoors else 'fgi') + ('_made' if rs == 'made' else '_miss')
        e[key].append(int(dist))
    return list(out.values())


def agg_punt(d):
    """Every punt as (yards from the far goal line, net yards), per punter-week.

    Net is what the punt was worth after the return: the kick's distance less the return,
    or the distance to the twenty on a touchback. build.py turns the pairs into net yards
    over what the league nets from the same spot, which is the only fair way to compare a
    man who punts from his own ten with one who punts from midfield.
    """
    pid_ = _col(d, 'punter_player_id')
    pu = d[(d.play_type == 'punt') & pid_.notna() & (_num(_col(d, 'punt_blocked')) == 0)]
    out = {}
    yl = _num(pu.yardline_100)
    kd = pd.to_numeric(_col(pu, 'kick_distance'), errors='coerce')
    for w, pid, y, k, tb, ry in zip(pu.week, pu.punter_player_id, yl, kd, _num(pu.touchback),
                                    _num(pu.return_yards)):
        if k != k or y <= 0:
            continue
        net = (y - 20.0) if tb == 1 else (float(k) - float(ry))
        e = out.setdefault((int(w), pid), dict(week=int(w), pid=pid, pn=0.0, pin10=0.0, pts=[]))
        e['pn'] += 1
        e['pts'].append([int(y), int(round(net))])
        if tb != 1 and (y - net) <= 10:
            e['pin10'] += 1
    return list(out.values())


def agg_drive(d):
    """The drives a quarterback led, and how they ended, per quarterback-week.

    A drive belongs to the man who took the most dropbacks on it; a drive with no
    dropback at all goes to whoever took the most for that team in that game. Drives that
    were nothing but kneel-downs are not drives.

      drv      drives
      drv_pts  points: seven for a touchdown, three for a field goal
      drv_3o   three-and-outs: a punt with no first down
      drv_sc   drives that scored
    """
    if 'fixed_drive' not in d.columns or 'fixed_drive_result' not in d.columns:
        return []
    p = d[d.posteam.notna() & d.fixed_drive.notna() & d.play_type.isin(['pass', 'run'])].copy()
    if not len(p):
        return []
    p['pid'] = p.passer_player_id.where(p.passer_player_id.notna(), p.rusher_player_id)
    p['isdb'] = ((p.qb_dropback == 1) & (p.qb_kneel == 0) & (p.qb_spike == 0)).astype(float)
    real = p[(p.qb_kneel == 0)]
    key = ['game_id', 'posteam', 'fixed_drive']
    dbs = p[p.isdb == 1]
    lead = dbs.groupby(key + ['pid']).size().reset_index(name='n')
    lead = lead.sort_values('n', ascending=False).drop_duplicates(key)[key + ['pid']]
    game = dbs.groupby(['game_id', 'posteam', 'pid']).size().reset_index(name='n')
    game = game.sort_values('n', ascending=False).drop_duplicates(['game_id', 'posteam'])
    game = game[['game_id', 'posteam', 'pid']].rename(columns={'pid': 'gpid'})
    dr = real.groupby(key).agg(week=('week', 'first'), res=('fixed_drive_result', 'first'),
                               fds=('first_down', 'sum')).reset_index()
    dr = dr.merge(lead, on=key, how='left').merge(game, on=['game_id', 'posteam'], how='left')
    dr['pid'] = dr.pid.where(dr.pid.notna(), dr.gpid)
    dr = dr[dr.pid.notna()]
    res = dr.res.fillna('')
    g = pd.DataFrame({
        'week': dr.week, 'pid': dr.pid,
        'drv': 1.0,
        'drv_pts': np.where(res == 'Touchdown', 7.0, np.where(res == 'Field goal', 3.0, 0.0)),
        'drv_3o': ((res == 'Punt') & (_num(dr.fds) == 0)).astype(float),
        'drv_sc': res.isin(['Touchdown', 'Field goal']).astype(float),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_line(d):
    """The offense as a unit, per team-week.

    Open data has no way to hang a sack or a pressure on one blocker in season - the
    participation file that would say who was on the field is only published after the
    season - so the line is graded where it can be graded honestly: as five men together.

      sack rate allowed      sacks / dropbacks
      QB-hit rate allowed    dropbacks on which the quarterback was hit or sacked
      rush success rate      designed runs that stayed on schedule (EPA > 0)

    They are team numbers, and the page says so: a quarterback who holds the ball and a
    back who runs well are in them too.

    The same rows carry what a lineman's in-season card is built from (expected points and
    success on dropbacks, yards and stuffs on designed runs, and the same again gap by gap
    so the runs behind one man can be told from the runs behind another), and the team
    totals that every share-of-his-team number divides by.
    """
    live = d[d.posteam.notna() & (d.qb_kneel == 0) & (d.qb_spike == 0)]
    db = live[live.qb_dropback == 1]
    a = pd.DataFrame({
        'week': db.week, 'tm': db.posteam,
        'db': 1.0,
        'sk': _num(db.sack),
        'hit': ((_num(db.sack) + _num(db.qb_hit)) > 0).astype(float),
        'pepa': _num(db.epa),
        'psucc': _num(db.success),
    }).groupby(['week', 'tm'], as_index=False).sum()
    ru = live[(live.play_type == 'run') & (live.qb_scramble == 0)]
    ryds = _num(ru.yards_gained)
    bcols = {
        'week': ru.week, 'tm': ru.posteam,
        'run': 1.0,
        'run_succ': _num(ru.success),
        'repa': _num(ru.epa),
        'ryds': ryds,
        'rstuff': (ryds <= 0).astype(float),
    }
    gk = pd.Series([gap_key(x, y) for x, y in zip(ru.run_location, ru.run_gap)], index=ru.index)
    for g in GAPS:
        hit = (gk == g)
        bcols['gn_' + g] = hit.astype(float)
        bcols['gs_' + g] = _num(ru.success).where(hit, 0.0)
        bcols['gy_' + g] = ryds.where(hit, 0.0)
        bcols['gf_' + g] = ((ryds <= 0) & hit).astype(float)
    b = pd.DataFrame(bcols).groupby(['week', 'tm'], as_index=False).sum()
    out = a.merge(b, on=['week', 'tm'], how='outer')

    # team totals: every carry, every target, and the plays the whole offense ran
    car = live[live.rush_attempt_f == 1]
    c = pd.DataFrame({
        'week': car.week, 'tm': car.posteam,
        't_car': 1.0,
        't_i10': (car.yardline_100 <= 10).astype(float),
        't_i5': (car.yardline_100 <= 5).astype(float),
    }).groupby(['week', 'tm'], as_index=False).sum()
    tg = live[(live.pass_attempt_f == 1) & live.receiver_player_id.notna()]
    comp = _num(tg.complete_pass)
    ay = _num(tg.air_yards)
    e = pd.DataFrame({
        'week': tg.week, 'tm': tg.posteam,
        't_tgt': 1.0,
        't_recy': _num(tg.yards_gained).where(comp == 1, 0.0),
        't_rectd': _num(tg.touchdown).where(comp == 1, 0.0),
        't_recfd': _num(tg.first_down),
        't_ay': ay.fillna(0.0),
        't_ez': (tg.air_yards.notna() & (ay >= _num(tg.yardline_100))
                 & (_num(tg.yardline_100) > 0)).astype(float),
    }).groupby(['week', 'tm'], as_index=False).sum()
    pl = live[live.play_type.isin(['pass', 'run'])]
    f = pd.DataFrame({
        'week': pl.week, 'tm': pl.posteam,
        't_plays': 1.0,
        't_epa': _num(pl.epa),
        't_succ': _num(pl.success),
    }).groupby(['week', 'tm'], as_index=False).sum()
    for x in (c, e, f):
        out = out.merge(x, on=['week', 'tm'], how='outer')
    opp = pd.DataFrame({'week': live.week, 'tm': live.posteam, 'opp': _col(live, 'defteam')})
    opp = opp[opp.opp.notna()].groupby(['week', 'tm'], as_index=False).first()
    out = out.merge(opp, on=['week', 'tm'], how='left')
    num = [x for x in out.columns if x not in ('week', 'tm', 'opp')]
    out[num] = out[num].fillna(0)
    return out.to_dict(orient='records')


def agg_ret(d):
    """Kick and punt returns, per returner-week.

    Only balls actually run back count: a touchback or a fair catch is not a return, and
    counting it would reward a returner for standing still. EPA is turned to the returning
    team's side - nflfastR credits a kickoff to the receiving team but a punt to the
    punting team - so a big return is positive either way.
    """
    out = []
    for kind, col, pt in (('kr', 'kickoff_returner_player_id', 'kickoff'),
                          ('pr', 'punt_returner_player_id', 'punt')):
        if col not in d.columns:
            continue
        r = d[(d.play_type == pt) & d[col].notna() & (_num(d.touchback) == 0)]
        if 'punt_fair_catch' in r.columns:
            r = r[_num(r.punt_fair_catch) == 0]
        if not len(r):
            continue
        sign = np.where(r.posteam == r.return_team, 1.0, -1.0)
        g = pd.DataFrame({
            'week': r.week, 'pid': r[col], 'k': kind,
            'n': 1.0,
            'yds': _num(r.return_yards),
            'epa': _num(r.epa) * sign,
            'td': _num(r.return_touchdown),
            'fum': _num(r.fumble_lost),
        }).groupby(['week', 'pid', 'k'], as_index=False).sum()
        out.extend(g.to_dict(orient='records'))
    return out


def _records(df):
    """Rows for JSON: missing words become absent keys rather than NaN."""
    if df is None or not len(df):
        return []
    rows = df.to_dict(orient='records')
    for r in rows:
        for k in ('tm', 'opp'):
            if k in r and not isinstance(r[k], str):
                del r[k]
    return rows


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
        'qb': _records(agg_qb(d)),
        'rush': _records(agg_rush(d)),
        'rec': _records(agg_rec(d)),
        'pen': agg_pen(d),
        'line': agg_line(d) if 'posteam' in d.columns else [],
        'ret': agg_ret(d) if 'return_team' in d.columns else [],
        'def': agg_def(d),
        'kick': agg_kick(d),
        'punt': agg_punt(d),
        'drive': agg_drive(d),
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'pbp_%d.json' % year), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return {k: len(v) for k, v in out.items()}


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        r = run_season(y)
        print(y, r, flush=True)
