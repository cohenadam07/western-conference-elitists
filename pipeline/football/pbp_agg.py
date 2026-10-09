"""Play-by-play -> weekly per-player aggregates for Football Savant.

nflverse's season/weekly player tables carry the counting stats but not the things that
make a football number mean something: whether a play stayed on schedule (success), how
far downfield the ball was actually thrown, which gap a run went through, what happened
on third down and inside the twenty. Those all live in play-by-play, so we make one pass
over it per season and write the *weekly* aggregates — weekly, because the front end's
form windows (L4/L8) are sums of games, and a season total can't be un-summed.

Output: agg/pbp_<season>.json, every table keyed by (week, player_id) unless it says so:

  qb, rush, rec   the three ways a skill player touches the ball
  pen             penalties by type
  def             what a defender did, read off the tackle, sack and fumble credits
  kick, punt      kickoffs and punts by the man who kicked them
  fg              one row per field goal attempt (distance, result, roof, wind, WPA)
  drv             drives, credited to the quarterback who led them
  dpi             pass interference drawn, by the receiver it was called against
  ret             kick and punt returns, by returner
  line            the offensive line as a unit, per team-week
  tm              one row per team-week: what its offense did and what its defense faced
  lg              league-wide rates for the season, for opponent adjustments

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

COLS = ['season','week','season_type','down','ydstogo','yardline_100','goal_to_go',
        'penalty','penalty_player_id','penalty_type','penalty_yards',
        'play_type','yards_gained','epa','qb_epa','success','air_yards','yards_after_catch',
        'xyac_mean_yardage','cp','cpoe','pass_length','pass_location','run_location','run_gap',
        'qb_dropback','qb_scramble','qb_kneel','qb_spike','sack','qb_hit','complete_pass',
        'interception','touchdown','first_down','fumble_lost','two_point_attempt',
        'passer_player_id','rusher_player_id','receiver_player_id',
        # the line as a unit, and the return game
        'posteam','return_team','return_yards','return_touchdown','touchback',
        'punt_fair_catch','kickoff_returner_player_id','punt_returner_player_id',
        # everything below was added for the defensive, special-teams, drive and team tables
        'game_id','play_id','defteam','home_team','wp','wpa','series_success',
        'fixed_drive','fixed_drive_result','receiver_id','penalty_team','first_down_penalty',
        'solo_tackle_1_player_id','solo_tackle_2_player_id',
        'assist_tackle_1_player_id','assist_tackle_2_player_id',
        'assist_tackle_3_player_id','assist_tackle_4_player_id',
        'tackle_with_assist_1_player_id','tackle_with_assist_2_player_id',
        'sack_player_id','half_sack_1_player_id','half_sack_2_player_id',
        'forced_fumble_player_1_player_id','forced_fumble_player_2_player_id',
        'kicker_player_id','kick_distance','punter_player_id','field_goal_result',
        'kickoff_out_of_bounds','roof','wind',
        # the corrections of October 2026: a receiver's own yards (not a lateral's), a snap
        # that was never a called run, who a touchdown belonged to, and the scoreboard
        'receiving_yards','aborted_play','td_team','first_down_pass','posteam_score',
        'posteam_score_post','kickoff_fair_catch']

# Target depth x direction. The 4 depth bands are the ones coaches actually talk in:
# behind the line (screens/swings), the quick game, the intermediate, and the shot.
DEPTH_BANDS = [('b', -99, 0), ('s', 0, 10), ('m', 10, 20), ('d', 20, 999)]
DIRS = [('l', 'left'), ('m', 'middle'), ('r', 'right')]
GAPS = ['le', 'lt', 'lg', 'md', 'rg', 'rt', 're']

# A defense needs this many plays in its other games before its rate is used to describe
# the schedule a player faced. Under it the game simply does not count toward the average.
SOS_MIN = 25


def _num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0)


def gap_key(row_loc, row_gap):
    if row_loc == 'middle':
        return 'md'
    side = 'l' if row_loc == 'left' else 'r' if row_loc == 'right' else None
    if side is None or row_gap not in ('end', 'tackle', 'guard'):
        return None
    return side + {'end': 'e', 'tackle': 't', 'guard': 'g'}[row_gap]


def _team_of(frame, key='pid', team='posteam'):
    """The club a man played for in each week. One per week by construction."""
    return frame.groupby(['week', key])[team].first().rename('_tm').reset_index()


def _with_team_totals(per, who, totals):
    """Lay a team-week's totals beside each player-week row, so that summing a player's
    rows gives 'his team's total in the games he played' - the denominator of a share."""
    if not len(per) or not len(totals):
        return per
    out = per.merge(who, on=['week', 'pid'], how='left').merge(
        totals, left_on=['week', '_tm'], right_on=['week', 'tm'], how='left')
    return out.drop(columns=['_tm', 'tm']).fillna(0)


# The team-week totals the rusher and receiver tables are shared out of. A player-week row
# only exists for a man who touched the ball that week, so "his share of his team's carries
# in the games he played" cannot be built from his own rows: the game he dressed for and
# never got a carry in would drop out of the denominator and flatter him. The totals ride
# on the team-week table instead, and build.py adds up the weeks he actually played.
_TEAM_TOT = {}


def agg_qb(d):
    # A dropback is a pass, a sack, or a scramble — the whole decision, not just the throws.
    # passer_player_id is blank on scrambles (the QB is logged as the rusher), so stitch it.
    db = d[(d.qb_dropback == 1) & (d.qb_kneel == 0) & (d.qb_spike == 0)].copy()
    db['pid'] = db.passer_player_id.where(db.passer_player_id.notna(), db.rusher_player_id)
    db = db[db.pid.notna()]
    att = (db.pass_attempt_f == 1) & (db.sack == 0)
    # "In doubt": neither side better than nine in ten to win. Outside it a quarterback is
    # padding a lead against a soft shell or chasing a lost game, and neither says much.
    doubt = db.wp.notna() & (db.wp >= 0.10) & (db.wp <= 0.90)
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
        'rz_td': ((db.yardline_100 <= 20) & (db.off_td == 1)).astype(float),
        'tw': (_num(db.interception) + _num(db.fumble_lost)),
        # --- added: the game still in doubt, win probability, and the defenses he faced
        'ng_db': doubt.astype(float),
        'ng_epa': _num(db.qb_epa).where(doubt, 0.0),
        'wpa': _num(db.wpa),
        'sos_n': db.sos_p.notna().astype(float),
        'sos_x': _num(db.sos_p),
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
    r['pid'] = r.rusher_player_id
    scr = (r.qb_scramble == 1)
    # A called run is one that was called. A fumbled snap goes in the book as a carry by
    # whoever was under centre, and that is where it stays, but it is not a designed run:
    # counting it gave Jared Goff 0.8 yards a "designed" carry.
    des = ~scr & (_num(r.aborted_play) == 0)
    yds = _num(r.yards_gained)
    late = (r.down == 3) | (r.down == 4)
    short = late & (r.ydstogo <= 2)
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
        'rz_td': ((r.yardline_100 <= 20) & (r.off_td == 1)).astype(float),
        'sd': late.astype(float),          # short-yardage duty
        'sd_conv': (late & (r.first_down == 1)).astype(float),
        # --- added
        # a called run and a scramble are two different plays that share a box-score line
        'des': des.astype(float),
        'des_yds': yds.where(des, 0.0),
        'des_epa': _num(r.epa).where(des, 0.0),
        'des_succ': _num(r.success).where(des, 0.0),
        'scr': scr.astype(float),
        'scr_yds': yds.where(scr, 0.0),
        'scr_epa': _num(r.epa).where(scr, 0.0),
        # win probability on every carry that was not a scramble (those are dropbacks,
        # and counted there), a fumbled snap included
        'des_wpa': _num(r.wpa).where(~scr, 0.0),
        # third or fourth down with two or fewer to go: the carry everybody knows is coming
        'sy': short.astype(float),
        'sy_conv': (short & ((r.first_down == 1) | (r.off_td == 1))).astype(float),
        'i10': (r.yardline_100 <= 10).astype(float),
        'i5': (r.yardline_100 <= 5).astype(float),
        'wpa': _num(r.wpa),
        'sos_n': (r.sos_r.notna() & des).astype(float),
        'sos_x': _num(r.sos_r).where(des, 0.0),
    })
    for g in GAPS:
        hit = (r.gk == g)
        base['g_' + g] = hit.astype(float)
        base['gy_' + g] = yds.where(hit, 0.0)
        base['gs_' + g] = _num(r.success).where(hit, 0.0)
    per = base.groupby(['week', 'pid'], as_index=False).sum()
    tot = pd.DataFrame({'week': r.week, 'tm': r.posteam, 'tm_car': 1.0,
                        'tm_i10': (r.yardline_100 <= 10).astype(float),
                        'tm_i5': (r.yardline_100 <= 5).astype(float)}
                       ).groupby(['week', 'tm'], as_index=False).sum()
    _TEAM_TOT['rush'] = tot
    return _with_team_totals(per, _team_of(r), tot)


def agg_rec(d):
    t = d[(d.pass_attempt_f == 1) & (d.receiver_player_id.notna())].copy()
    t['pid'] = t.receiver_player_id
    ay = _num(t.air_yards)
    comp = _num(t.complete_pass)
    # His yards are the ones the book gives him. yards_gained is the play's, and on a
    # lateral the play's yards belong to somebody else: Mike Evans was being credited with
    # 80 of Deebo Samuel's.
    own = _num(t.receiving_yards).where(t.receiving_yards.notna(), _num(t.yards_gained))
    own = own.where(comp == 1, 0.0)
    otd = (t.off_td == 1) & (comp == 1)
    # thrown into the end zone: the ball travelled at least as far as the goal line was away
    ez = t.air_yards.notna() & (ay >= _num(t.yardline_100)) & (t.yardline_100 > 0)
    has_x = (comp == 1) & t.xyac_mean_yardage.notna()
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
        'td': otd.astype(float),
        'int': _num(t.interception),
        'yds': own,
        'yac': _num(t.yards_after_catch).where(comp == 1, 0.0),
        'xyac': _num(t.xyac_mean_yardage).where(comp == 1, 0.0),
        'xyac_n': ((comp == 1) & t.xyac_mean_yardage.notna()).astype(float),
        'fd': _num(t.first_down),
        'deep': (t.pass_length == 'deep').astype(float),
        'rz_tgt': (t.yardline_100 <= 20).astype(float),
        'rz_td': ((t.yardline_100 <= 20) & otd).astype(float),
        'td3': ((t.down == 3) | (t.down == 4)).astype(float),
        'td3_conv': (((t.down == 3) | (t.down == 4)) & (t.first_down == 1)).astype(float),
        'cp_sum': _num(t.cp).where(t.cp.notna(), 0.0),
        'cp_n': t.cp.notna().astype(float),
        # --- added
        'cp_rec': comp.where(t.cp.notna(), 0.0),           # catches on the throws the model graded
        'yac_x': _num(t.yards_after_catch).where(has_x, 0.0),   # his YAC on the catches it graded
        'ez': ez.astype(float),
        'ez_td': (ez & otd).astype(float),
        'wpa': _num(t.wpa),
        'sos_n': t.sos_p.notna().astype(float),
        'sos_x': _num(t.sos_p),
    })
    for dk, lo, hi in DEPTH_BANDS:
        in_band = (ay >= lo) & (ay < hi) & t.air_yards.notna()
        for dirk, dirv in DIRS:
            cell = in_band & (t.pass_location == dirv)
            base['z_%s%s' % (dk, dirk)] = cell.astype(float)
            base['zy_%s%s' % (dk, dirk)] = own.where(cell, 0.0)
            base['zc_%s%s' % (dk, dirk)] = comp.where(cell, 0.0)
    per = base.groupby(['week', 'pid'], as_index=False).sum()
    tot = pd.DataFrame({'week': t.week, 'tm': t.posteam, 'tm_tgt': 1.0, 'tm_ez': ez.astype(float),
                        'tm_ay': ay,
                        'tm_recy': own,
                        'tm_rectd': otd.astype(float),
                        # passing first downs, which is what the stat table credits a receiver with
                        'tm_recfd': _num(t.first_down_pass).where(t.first_down_pass.notna(),
                                                                  _num(t.first_down)).where(comp == 1, 0.0),
                        'tm_td3': ((t.down == 3) | (t.down == 4)).astype(float)}
                       ).groupby(['week', 'tm'], as_index=False).sum()
    _TEAM_TOT['rec'] = tot
    return _with_team_totals(per, _team_of(t), tot)


# Flags that are a defender's own doing, in the three places they are called.
COVER_FLAGS = ('Defensive Pass Interference', 'Defensive Holding', 'Illegal Contact')
PRESNAP_D = ('Defensive Offside', 'Neutral Zone Infraction', 'Encroachment')
KICKOFF_FLAGS = ('Kickoff Out of Bounds', 'Kickoff Short of Landing Zone')


def agg_pen(d):
    """Penalties by type, per player-week.

    The only line on a lineman's record that is unambiguously his. False starts and
    offensive holding are ~40% of all offensive flags and are overwhelmingly called on
    blockers, so they get their own counters; the rest are pooled. Attribution runs
    92–100% complete back to 1999.

    The same table carries a defender's flags: the three coverage calls, the pre-snap
    ones a pass rusher draws jumping the count, and roughing the passer. And one read of
    what a flag cost: an offensive penalty on a series that then failed to move the
    chains, a defensive one that handed the offense a first down.
    """
    p = d[(d.penalty == 1) & d.penalty_player_id.notna()].copy()
    if not len(p):
        return []
    t = p.penalty_type.fillna('')
    yds = _num(p.penalty_yards)
    own = (p.penalty_team == p.posteam)                 # flagged on the team with the ball
    cover = t.isin(COVER_FLAGS)
    base = pd.DataFrame({
        'week': p.week, 'pid': p.penalty_player_id,
        'pen': 1.0,
        'pen_fs': t.eq('False Start').astype(float),
        'pen_hold': t.eq('Offensive Holding').astype(float),
        'pen_yds': yds,
        # --- added
        'pen_dpi': t.eq('Defensive Pass Interference').astype(float),
        'pen_cov': cover.astype(float),
        'pen_cov_yds': yds.where(cover, 0.0),
        'pen_off': t.isin(PRESNAP_D).astype(float),
        'pen_rtp': t.eq('Roughing the Passer').astype(float),
        'pen_ko': t.isin(KICKOFF_FLAGS).astype(float),
        'pen_stall': (own & (_num(p.series_success) == 0) & p.series_success.notna()).astype(float),
        'pen_fd': ((~own) & (_num(p.first_down_penalty) == 1)).astype(float),
    })
    return base.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_line(d):
    """The offensive line as a unit, per team-week.

    Open data has no way to hang a sack or a pressure on one blocker in season - the
    participation file that would say who was on the field is only published after the
    season - so the line is graded where it can be graded honestly: as five men together.
    Three numbers, all from every snap:

      sack rate allowed      sacks / dropbacks
      QB-hit rate allowed    dropbacks on which the quarterback was hit or sacked
      rush success rate      designed runs that stayed on schedule (EPA > 0)

    They are team numbers, and the page says so: a quarterback who holds the ball and a
    back who runs well are in them too.
    """
    db = d[(d.qb_dropback == 1) & (d.qb_kneel == 0) & (d.qb_spike == 0) & d.posteam.notna()]
    a = pd.DataFrame({
        'week': db.week, 'tm': db.posteam,
        'db': 1.0,
        'sk': _num(db.sack),
        'hit': ((_num(db.sack) + _num(db.qb_hit)) > 0).astype(float),
    }).groupby(['week', 'tm'], as_index=False).sum()
    ru = d[(d.play_type == 'run') & (d.qb_scramble == 0) & (d.qb_kneel == 0) & d.posteam.notna()]
    b = pd.DataFrame({
        'week': ru.week, 'tm': ru.posteam,
        'run': 1.0,
        'run_succ': _num(ru.success),
    }).groupby(['week', 'tm'], as_index=False).sum()
    return a.merge(b, on=['week', 'tm'], how='outer').fillna(0).to_dict(orient='records')


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
        if kind == 'kr' and 'kickoff_fair_catch' in r.columns:
            # an onside kick fallen on or fair-caught is not a return
            r = r[_num(r.kickoff_fair_catch) == 0]
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


# ---------------------------------------------------------------- defense
TACKLE_COLS = ['solo_tackle_1_player_id', 'solo_tackle_2_player_id',
               'assist_tackle_1_player_id', 'assist_tackle_2_player_id',
               'assist_tackle_3_player_id', 'assist_tackle_4_player_id',
               'tackle_with_assist_1_player_id', 'tackle_with_assist_2_player_id']


def _credits(frame, cols, keep):
    """One row per (play, credited defender) from the play-by-play's credit columns."""
    parts = []
    for c in cols:
        if c not in frame.columns:
            continue
        x = frame[frame[c].notna()]
        if len(x):
            y = x[keep].copy()
            y['pid'] = x[c].values
            parts.append(y)
    if not parts:
        return pd.DataFrame(columns=keep + ['pid'])
    # a man is credited once per play, however the scorer wrote it down
    return pd.concat(parts, ignore_index=True).drop_duplicates(['game_id', 'play_id', 'pid'])


def agg_def(d):
    """What a defender did, from the names the play-by-play credits.

    A tackle count says how often a man was near the ball. Where and on what kind of play
    says whether that was good news: a tackle on a run that failed for the offense is a
    stop; a tackle eight yards downfield is a tackle the defense did not want to need. So
    every run tackle keeps the play's result and its depth, every tackle after a catch
    keeps the yards the receiver had already run, and every sack keeps what it cost.

    A solo tackle and an assist both count as one tackle here, as they do in the season
    table's combined total. Sacks are the scorer's own split: a half each when shared.
    """
    keep = ['week', 'game_id', 'play_id', 'yards_gained', 'success', 'epa', 'down',
            'yards_after_catch']
    out = []

    run = d[(d.play_type == 'run') & (d.qb_kneel == 0) & (d.qb_scramble == 0)]
    t = _credits(run, TACKLE_COLS, keep)
    if len(t):
        y = _num(t.yards_gained)
        out.append(pd.DataFrame({
            'week': t.week, 'pid': t.pid,
            'rtk': 1.0,
            'rstop': ((_num(t.success) == 0) & t.success.notna()).astype(float),
            'rtk_y': y,
        }))

    cmpl = d[(d.play_type == 'pass') & (d.complete_pass == 1)]
    t = _credits(cmpl, TACKLE_COLS, keep)
    if len(t):
        out.append(pd.DataFrame({
            'week': t.week, 'pid': t.pid,
            'ptk': 1.0,
            'ptk_yac': _num(t.yards_after_catch),
        }))

    st = d[d.play_type.isin(['kickoff', 'punt'])]
    t = _credits(st, TACKLE_COLS, keep)
    if len(t):
        out.append(pd.DataFrame({'week': t.week, 'pid': t.pid, 'sttk': 1.0}))

    sk = d[d.sack == 1]
    for col, share in (('sack_player_id', 1.0), ('half_sack_1_player_id', 0.5),
                       ('half_sack_2_player_id', 0.5)):
        if col not in sk.columns:
            continue
        x = sk[sk[col].notna()]
        if not len(x):
            continue
        strip = (x.forced_fumble_player_1_player_id == x[col]) | (x.forced_fumble_player_2_player_id == x[col])
        out.append(pd.DataFrame({
            'week': x.week, 'pid': x[col],
            'sk_n': share,
            'sk_epa': -_num(x.epa) * share,                  # turned to the defense's side
            'sk_yds': -_num(x.yards_gained) * share,
            'sk_3d': (((x.down == 3) | (x.down == 4)).astype(float)) * share,
            'sk_ff': strip.astype(float) * share,
        }))
    if not out:
        return []
    g = pd.concat(out, ignore_index=True).fillna(0.0)
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


# ---------------------------------------------------------------- kicking
OUTDOORS = ('outdoors', 'open')


def agg_kick(d):
    """Kickoffs, by the man who kicked them: how many, how far, and how many were touchbacks."""
    k = d[(d.play_type == 'kickoff') & d.kicker_player_id.notna()]
    if not len(k):
        return []
    dist = pd.to_numeric(k.kick_distance, errors='coerce')
    g = pd.DataFrame({
        'week': k.week, 'pid': k.kicker_player_id,
        'ko': 1.0,
        'ko_tb': _num(k.touchback),
        'ko_dist': dist.fillna(0.0),
        'ko_dist_n': dist.notna().astype(float),
        'ko_oob': _num(k.kickoff_out_of_bounds),
        'ko_ret': ((_num(k.touchback) == 0) & k.kickoff_returner_player_id.notna()).astype(float),
        'ko_ret_yds': _num(k.return_yards).where(_num(k.touchback) == 0, 0.0),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_punt(d):
    """Punts, by punter, with the play's expected points: field position gained or given
    up against what an average punt from that spot is worth. EPA on a punt is already the
    punting team's, so a positive number is a good punt."""
    p = d[(d.play_type == 'punt') & d.punter_player_id.notna()]
    if not len(p):
        return []
    g = pd.DataFrame({'week': p.week, 'pid': p.punter_player_id, 'pu': 1.0, 'pu_epa': _num(p.epa)})
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_fg(d):
    """One row per field goal attempt. Kept apart rather than summed because what a kick is
    worth depends on its distance, and the make-rate curve lives in build.py."""
    f = d[(d.play_type == 'field_goal') & d.kicker_player_id.notna() & d.kick_distance.notna()]
    out = []
    for r in f.itertuples(index=False):
        wind = pd.to_numeric(r.wind, errors='coerce')
        out.append(dict(week=int(r.week), pid=r.kicker_player_id, dist=int(r.kick_distance),
                        made=1 if r.field_goal_result == 'made' else 0,
                        blk=1 if r.field_goal_result == 'blocked' else 0,
                        out=1 if (isinstance(r.roof, str) and r.roof in OUTDOORS) else 0,
                        wind=None if wind != wind else float(wind),
                        wpa=0.0 if r.wpa != r.wpa else round(float(r.wpa), 4)))
    return out


# ---------------------------------------------------------------- drives
def agg_drv(d, every=None):
    """Drives, credited to the quarterback who led them.

    A drive belongs to the passer with the most dropbacks on it. A drive with no dropback
    at all (three runs and a punt) goes to the man who took most of his team's dropbacks
    that day, because somebody was under centre for it. Drives that end with the half or
    the game are left out: a kneel-down is not a failed possession.

    `every` is the season with nothing taken out - tries, kicks and flags included -
    because two things about a drive are not in its runs and passes: the points it put on
    the board (a touchdown is six, seven or eight) and a first down by penalty, which
    means a drive that punted after "three plays" was not a three-and-out.
    """
    x = d[d.posteam.notna() & d.fixed_drive.notna() & d.play_type.isin(['pass', 'run'])
          & (d.qb_kneel == 0) & (d.qb_spike == 0)]
    if not len(x):
        return []
    db = x[x.qb_dropback == 1].copy()
    db['pid'] = db.passer_player_id.where(db.passer_player_id.notna(), db.rusher_player_id)
    db = db[db.pid.notna()]
    if not len(db):
        return []
    key = ['game_id', 'posteam', 'fixed_drive']
    on_drive = db.groupby(key + ['pid']).size().rename('n').reset_index()
    on_drive = on_drive.sort_values('n', ascending=False).drop_duplicates(key)[key + ['pid']]
    on_game = db.groupby(['game_id', 'posteam', 'pid']).size().rename('n').reset_index()
    on_game = on_game.sort_values('n', ascending=False).drop_duplicates(['game_id', 'posteam'])
    on_game = on_game[['game_id', 'posteam', 'pid']].rename(columns={'pid': 'gpid'})
    dr = x.groupby(key).agg(week=('week', 'first'), res=('fixed_drive_result', 'first'),
                            fd=('first_down', 'sum'), plays=('play_id', 'size')).reset_index()
    dr = dr.merge(on_drive, on=key, how='left').merge(on_game, on=['game_id', 'posteam'], how='left')
    dr['pts'] = np.nan
    dr['fdp'] = 0.0
    if every is not None and len(every):
        e = every[every.posteam.notna() & every.fixed_drive.notna()]
        sc = e.groupby(key).agg(lo=('posteam_score', 'min'), hi=('posteam_score_post', 'max'),
                                fdp=('first_down_penalty', lambda v: _num(v).sum())).reset_index()
        dr = dr.drop(columns=['pts', 'fdp']).merge(sc, on=key, how='left')
        dr['pts'] = (pd.to_numeric(dr.hi, errors='coerce') - pd.to_numeric(dr.lo, errors='coerce')).clip(0, 8)
        dr['fdp'] = dr.fdp.fillna(0.0)
    dr['pid'] = dr.pid.where(dr.pid.notna(), dr.gpid)
    dr = dr[dr.pid.notna() & ~dr.res.isin(['End of half', 'End of game'])]
    if not len(dr):
        return []
    td = (dr.res == 'Touchdown')
    fg = (dr.res == 'Field goal')
    g = pd.DataFrame({
        'week': dr.week, 'pid': dr.pid,
        'drv': 1.0,
        # off the scoreboard where it can be read, else the old flat seven and three
        'drv_pts': dr.pts.where(dr.pts.notna() & (td | fg), (td * 7.0 + fg * 3.0).where(dr.pts.isna(), 0.0)),
        'drv_td': td.astype(float),
        'drv_3o': ((dr.res == 'Punt') & (dr.fd == 0) & (dr.fdp == 0)).astype(float),
    })
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


def agg_dpi(d):
    """Pass interference drawn. The play is wiped out, so the box score never credits the
    receiver, but the flag names him and the yards are real."""
    if 'receiver_id' not in d.columns:
        return []
    p = d[(d.penalty == 1) & (d.penalty_type == 'Defensive Pass Interference')
          & d.receiver_id.notna()]         # from the 1 it is half the distance, which can be nothing
    if not len(p):
        return []
    g = pd.DataFrame({'week': p.week, 'pid': p.receiver_id, 'dpi': 1.0, 'dpi_yds': _num(p.penalty_yards)})
    return g.groupby(['week', 'pid'], as_index=False).sum().to_dict(orient='records')


# ---------------------------------------------------------------- teams
def load_positions():
    """Player id -> QB / RB / WR / TE, for what a defense gives up to each of them."""
    p = os.path.join(RAW, 'players.csv')
    if not os.path.exists(p):
        return {}
    pl = pd.read_csv(p, usecols=['gsis_id', 'position'], low_memory=False)
    m = {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'HB': 'RB', 'WR': 'WR', 'TE': 'TE'}
    return {r.gsis_id: m[r.position] for r in pl.itertuples(index=False)
            if isinstance(r.gsis_id, str) and r.position in m}


def agg_team(d, pos):
    """One row per team-week: what its offense did. A defense's row is its opponent's.

    Every figure is a count or a sum, so a season is addition and a rate is taken at the
    end. Runs are designed runs (a scramble is a pass play that broke down) and carry
    their gap, which is what lets a lineman be read against the runs that came his way.
    """
    x = d[d.posteam.notna() & d.defteam.notna() & d.play_type.isin(['pass', 'run'])
          & (d.qb_kneel == 0) & (d.qb_spike == 0)].copy()
    if not len(x):
        return []
    isdb = (x.qb_dropback == 1)
    isrun = (x.play_type == 'run') & (x.qb_scramble == 0) & (_num(x.aborted_play) == 0)
    epa = _num(x.epa)
    yds = _num(x.yards_gained)
    late = (x.down == 3) | (x.down == 4)
    g = pd.DataFrame({
        'week': x.week, 'tm': x.posteam, 'opp': x.defteam,
        'home': (x.posteam == x.home_team).astype(float),
        'plays': 1.0, 'epa': epa, 'succ': _num(x.success),
        # the play's EPA, as the lineup file's on-field rows use: the two have to agree,
        # because a lineman's row is this one in season and that one afterwards
        'db': isdb.astype(float), 'pepa': epa.where(isdb, 0.0),
        'psucc': _num(x.success).where(isdb, 0.0),
        'sk': _num(x.sack).where(isdb, 0.0),
        'hit': (((_num(x.sack) + _num(x.qb_hit)) > 0) & isdb).astype(float),
        'run': isrun.astype(float), 'repa': epa.where(isrun, 0.0),
        'rsucc': _num(x.success).where(isrun, 0.0), 'ryds': yds.where(isrun, 0.0),
        'stuff': ((yds <= 0) & isrun).astype(float),
        'x20': (yds >= 20).astype(float),
        'd3': late.astype(float), 'd3c': (late & (x.first_down == 1)).astype(float),
        'to': _num(x.interception) + _num(x.fumble_lost),
    })
    gk = pd.Series([gap_key(a, b) for a, b in zip(x.run_location, x.run_gap)], index=x.index)
    for k in GAPS:
        hit = (gk == k) & isrun
        g['g_' + k] = hit.astype(float)
        g['gs_' + k] = _num(x.success).where(hit, 0.0)
        g['gy_' + k] = yds.where(hit, 0.0)
        g['gt_' + k] = ((yds <= 0) & hit).astype(float)
    # what was thrown and handed to each position, which is the defense's ledger too
    tgt = (x.play_type == 'pass') & (x.sack == 0) & x.receiver_player_id.notna()
    rp = x.receiver_player_id.map(pos)
    up = x.rusher_player_id.map(pos)
    comp = _num(x.complete_pass)
    for P in ('WR', 'TE', 'RB'):
        hit = tgt & (rp == P)
        g['t%s_n' % P] = hit.astype(float)
        g['t%s_y' % P] = yds.where(hit & (comp == 1), 0.0)
        g['t%s_e' % P] = epa.where(hit, 0.0)
    for P in ('RB', 'QB'):
        hit = (x.play_type == 'run') & (up == P)
        g['r%s_n' % P] = hit.astype(float)
        g['r%s_y' % P] = yds.where(hit, 0.0)
        g['r%s_e' % P] = epa.where(hit, 0.0)
    out = g.groupby(['week', 'tm'], as_index=False).agg(
        {c: ('first' if c == 'opp' else 'max' if c == 'home' else 'sum')
         for c in g.columns if c not in ('week', 'tm')})
    # points come off the scoreboard, not the play list
    return out.to_dict(orient='records')


def strength_of_schedule(d):
    """Lay beside every play the rate its defense allowed in its OTHER games.

    Leave-one-out, so a quarterback's own good day never makes his opponent look soft.
    Returns the two columns (pass defense for dropbacks, run defense for designed runs),
    the same thing per team-week for anybody who is not in the play list, and the league
    rates the adjustments are taken against.
    """
    x = d[d.posteam.notna() & d.defteam.notna() & d.play_type.isin(['pass', 'run'])
          & (d.qb_kneel == 0) & (d.qb_spike == 0)]
    isdb = (x.qb_dropback == 1)
    isrun = (x.play_type == 'run') & (x.qb_scramble == 0) & (_num(x.aborted_play) == 0)
    f = pd.DataFrame({'game_id': x.game_id, 'week': x.week, 'off': x.posteam, 'dfn': x.defteam,
                      'db': isdb.astype(float), 'pe': _num(x.qb_epa).where(isdb, 0.0),
                      'rn': isrun.astype(float), 're': _num(x.epa).where(isrun, 0.0),
                      'pl': 1.0, 'e': _num(x.epa)})
    lg = dict(db_epa=float(f.pe.sum() / max(f.db.sum(), 1.0)),
              car_epa=float(f.re.sum() / max(f.rn.sum(), 1.0)),
              play_epa=float(f.e.sum() / max(f.pl.sum(), 1.0)))
    cols = ['db', 'pe', 'rn', 're', 'pl', 'e']
    by_game_d = f.groupby(['game_id', 'dfn'])[cols].sum()
    by_def = f.groupby('dfn')[cols].sum()
    by_game_o = f.groupby(['game_id', 'off'])[cols].sum()
    by_off = f.groupby('off')[cols].sum()

    def loo(tot, game, num, den):
        n = tot[den] - game[den]
        return ((tot[num] - game[num]) / n).where(n >= SOS_MIN)

    gd = by_game_d.reset_index()
    td = by_def.reindex(gd.dfn).reset_index(drop=True)
    gd['sos_p'] = loo(td, gd, 'pe', 'db')              # EPA / dropback this defense allows elsewhere
    gd['sos_r'] = loo(td, gd, 're', 'rn')
    gd['sos_d'] = loo(td, gd, 'e', 'pl')
    go = by_game_o.reset_index()
    to = by_off.reindex(go.off).reset_index(drop=True)
    go['sos_o'] = loo(to, go, 'e', 'pl')               # EPA / play this offense makes elsewhere
    key = pd.MultiIndex.from_frame(d[['game_id', 'defteam']])
    sp = gd.set_index(['game_id', 'dfn']).sos_p
    sr = gd.set_index(['game_id', 'dfn']).sos_r
    d['sos_p'] = sp.reindex(key).values
    d['sos_r'] = sr.reindex(key).values
    # per team-week, from the offense's and the defense's side of the same game
    wk = f.groupby(['game_id', 'week', 'off', 'dfn']).size().reset_index()[['game_id', 'week', 'off', 'dfn']]
    wk = wk.merge(gd[['game_id', 'dfn', 'sos_p', 'sos_r', 'sos_d']], on=['game_id', 'dfn'], how='left')
    wk = wk.merge(go[['game_id', 'off', 'sos_o']], on=['game_id', 'off'], how='left')
    return wk, lg


def _records(df):
    return [] if df is None or not len(df) else df.to_dict(orient='records')


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
    for c in COLS:
        if c not in d.columns:
            d[c] = np.nan
    for c in ['wp', 'wpa', 'ydstogo']:
        d[c] = pd.to_numeric(d[c], errors='coerce')
    # a touchdown for the team with the ball; a fumble run back by the defense is not one
    d['off_td'] = ((d.touchdown == 1) & (d.td_team.isna() | (d.td_team == d.posteam))).astype(int)
    # A two-point try is not a play from scrimmage. It has no down, it does not count as a
    # carry, a throw or a target in the book, and it is worth about a point either way in
    # EPA, so left in it was a carry "inside the five" (Braelon Allen's only one), a
    # dropback (seven of Josh Allen's forty-three inside the ten) and a swing of a tenth of
    # a point per play on anything rare. Flags on a try are still flags, and the scoreboard
    # still needs the try, so the full season is kept for those two.
    every = d
    d = d[pd.to_numeric(d.two_point_attempt, errors='coerce').fillna(0) == 0]
    # play_type is the only reliable pass/rush flag across the whole 1999+ span
    d['pass_attempt_f'] = ((d.play_type == 'pass') & (d.sack == 0)).astype(int)
    # scrambles carry play_type 'run' and count as carries in the box score, so they stay in
    d['rush_attempt_f'] = (d.play_type == 'run').astype(int)
    sos, lg = strength_of_schedule(d)
    tm = agg_team(d, load_positions())
    # each team-week also carries what its opponent looks like away from this game
    opp_look = {(r.week, r.off): (r.sos_p, r.sos_r, r.sos_d) for r in sos.itertuples(index=False)}
    own_look = {(r.week, r.dfn): r.sos_o for r in sos.itertuples(index=False)}
    for r in tm:
        a = opp_look.get((r['week'], r['tm']))
        o = own_look.get((r['week'], r['tm']))
        for k, v in (('sos_p', a and a[0]), ('sos_r', a and a[1]), ('sos_d', a and a[2]), ('sos_o', o)):
            if v is not None and v == v:
                r[k] = round(float(v), 5)
    _TEAM_TOT.clear()
    qb_rows = agg_qb(d).to_dict(orient='records')
    rush_rows = agg_rush(d).to_dict(orient='records')
    rec_rows = agg_rec(d).to_dict(orient='records')
    extra = {}
    for tot in _TEAM_TOT.values():
        for r in tot.to_dict(orient='records'):
            extra.setdefault((r['week'], r['tm']), {}).update(
                {k: float(v) for k, v in r.items() if k not in ('week', 'tm')})
    for r in tm:
        r.update(extra.get((r['week'], r['tm']), {}))
    out = {
        'qb': qb_rows,
        'rush': rush_rows,
        'rec': rec_rows,
        'pen': agg_pen(every),
        'line': agg_line(d) if 'posteam' in d.columns else [],
        'ret': agg_ret(d) if 'return_team' in d.columns else [],
        'def': agg_def(d),
        'kick': agg_kick(d),
        'punt': agg_punt(d),
        'fg': agg_fg(d),
        'drv': agg_drv(d, every),
        'dpi': agg_dpi(d),
        'tm': tm,
        'lg': lg,
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
