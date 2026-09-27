# -*- coding: utf-8 -*-
"""The play-level half of Coaching Savant: fourth-down decisions and scheme units.

Two things are built here, from one season's play-by-play at a time.

DECISIONS (2014 on) belong to the head coach — he makes the fourth-down call whoever is
calling the plays. Every fourth down is scored with Ben Baldwin's nfl4th model, which
nflverse precomputes: the win probability of going for it, punting and kicking. The best
of those three, minus the one he chose, is what the decision cost.

UNITS (2018 on) belong to the play-caller. A unit is one man calling one side of the ball
for one team over a run of weeks: "Klint Kubiak, Seattle offense, 2025, weeks 1-18". When
the play-calling changes hands mid-season the season splits into two units. Offensive
units carry tendencies, the toolkit (motion, play-action, RPO...), personnel, the Tell Grid
and a predictability score; defensive units carry coverage shells, pressure, personnel and
boxes. Three sources, each with its own start year:

    play-by-play     1999 on   nightly in season
    FTN charting     2022 on   weekly in season
    participation    2016 on   (coverage 2018 on) only after the Super Bowl

so a unit simply lacks the fields its season can't support, and the page says why.
"""
import math, os, re

import numpy as np
import pandas as pd

from play_callers import caller as caller_of, FIRST_SEASON as CALLER_FIRST

RAW = os.environ.get('NFL_RAW', 'raw')

PBP_COLS = ['game_id', 'play_id', 'season_type', 'week', 'posteam', 'defteam', 'play_type',
            'down', 'ydstogo', 'yardline_100', 'qtr', 'wp', 'epa', 'success', 'qb_dropback',
            'pass_oe', 'xpass', 'shotgun', 'no_huddle', 'air_yards', 'sack', 'qb_scramble',
            'qb_kneel', 'qb_spike', 'yards_gained', 'run_gap', 'pass_location',
            'game_seconds_remaining', 'score_differential', 'penalty', 'special',
            'two_point_attempt', 'third_down_converted', 'third_down_failed',
            'play_type_nfl', 'aborted_play', 'time', 'home_team', 'away_team', 'desc',
            'interception', 'fumble_lost', 'complete_pass', 'receiver_player_id']

MIN_UNIT_PLAYS = 300          # below this a unit is shown but not ranked


def rnd(v, p=3):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, p) if math.isfinite(v) else None


def _bool(s):
    return s.astype(str).str.upper().isin(['TRUE', '1', '1.0'])


def _num(s):
    return pd.to_numeric(s, errors='coerce')


def _mean(s):
    s = pd.Series(s).dropna()
    return float(s.mean()) if len(s) else None


def _share(mask, base):
    """Share of `base` rows where `mask` holds, in percent; None when there is no base."""
    b = int(base.sum())
    return 100.0 * float((mask & base).sum()) / b if b else None


# ---------------------------------------------------------------- personnel
_PERS = re.compile(r'(\d+)\s+([A-Z]+)')


def personnel(s):
    """'1 RB, 2 TE, 2 WR' (2016-22) or '1 C, 2 G, 1 QB, 1 RB, 2 T, 2 TE, 2 WR' (2023 on)
    -> ('12', offensive linemen). A fullback is a back."""
    if not isinstance(s, str) or not s:
        return None, None
    c = {}
    for n, pos in _PERS.findall(s):
        c[pos] = c.get(pos, 0) + int(n)
    ol = c.get('OL', 0) + c.get('C', 0) + c.get('G', 0) + c.get('T', 0)
    if not ol:
        ol = 5
    rb = c.get('RB', 0) + c.get('FB', 0)
    te = c.get('TE', 0)
    if rb > 3 or te > 4:
        return None, None
    return '%d%d' % (rb, te), ol


def dbs(s):
    """Defensive backs on the field: '4 DL, 2 LB, 5 DB' or '3 CB, ... 1 FS, 1 SS'."""
    if not isinstance(s, str) or not s:
        return None
    c = {}
    for n, pos in _PERS.findall(s):
        c[pos] = c.get(pos, 0) + int(n)
    n = c.get('DB', 0) + c.get('CB', 0) + c.get('S', 0) + c.get('FS', 0) + c.get('SS', 0) \
        + c.get('SAF', 0)
    return n or None


# ---------------------------------------------------------------- loading
def load_season(year, g):
    """One regular season of plays with FTN and participation joined where they exist,
    and each play stamped with its head coaches and play-callers."""
    p = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not os.path.exists(p):
        return None
    pb = pd.read_parquet(p, columns=PBP_COLS)
    pb = pb[(pb.season_type == 'REG') & pb.posteam.notna()].copy()
    pb['season'] = year

    ftn_p = os.path.join(RAW, 'ftn_%d.csv' % year)
    pb['has_ftn'] = False
    if os.path.exists(ftn_p):
        f = pd.read_csv(ftn_p, low_memory=False)
        f = f.rename(columns={'nflverse_game_id': 'game_id', 'nflverse_play_id': 'play_id'})
        keep = ['game_id', 'play_id', 'qb_location', 'n_offense_backfield', 'n_defense_box',
                'is_no_huddle', 'is_motion', 'is_play_action', 'is_screen_pass', 'is_rpo',
                'is_qb_out_of_pocket', 'read_thrown', 'n_blitzers', 'n_pass_rushers',
                'is_trick_play']
        f = f[[c for c in keep if c in f.columns]].drop_duplicates(['game_id', 'play_id'])
        pb = pb.merge(f, on=['game_id', 'play_id'], how='left')
        pb['has_ftn'] = pb.qb_location.notna()
        for c in ['is_no_huddle', 'is_motion', 'is_play_action', 'is_screen_pass', 'is_rpo',
                  'is_qb_out_of_pocket', 'is_trick_play']:
            pb[c] = _bool(pb[c]).where(pb.has_ftn)
        pb['qb_location'] = pb.qb_location.astype(str).str.strip().where(pb.has_ftn)
        for c in ['n_offense_backfield', 'n_defense_box', 'n_blitzers', 'n_pass_rushers']:
            pb[c] = _num(pb[c])
        pb['read_thrown'] = pb.read_thrown.astype(str).where(pb.has_ftn)

    part_p = os.path.join(RAW, 'part', 'part_%d.csv' % year)
    pb['has_part'] = False
    if os.path.exists(part_p):
        q = pd.read_csv(part_p, low_memory=False, usecols=lambda c: c in {
            'nflverse_game_id', 'play_id', 'offense_formation', 'offense_personnel',
            'defenders_in_box', 'defense_personnel', 'number_of_pass_rushers',
            'time_to_throw', 'was_pressure', 'route', 'defense_man_zone_type',
            'defense_coverage_type'})
        q = q.rename(columns={'nflverse_game_id': 'game_id'}).drop_duplicates(['game_id', 'play_id'])
        pb = pb.merge(q, on=['game_id', 'play_id'], how='left')
        pb['has_part'] = pb.offense_personnel.notna()
        pp = pb.offense_personnel.map(personnel)
        pb['pers'] = [a for a, b in pp]
        pb['ol'] = [b for a, b in pp]
        pb['n_db'] = pb.defense_personnel.map(dbs)
        pb['was_pressure'] = pb.was_pressure.map(
            lambda v: np.nan if pd.isna(v) else (1.0 if str(v).upper() in ('TRUE', '1', '1.0') else 0.0))
        for c in ['defenders_in_box', 'number_of_pass_rushers', 'time_to_throw']:
            pb[c] = _num(pb[c])
        for c in ['route', 'defense_man_zone_type', 'defense_coverage_type', 'offense_formation']:
            pb[c] = pb[c].astype(str).str.strip().replace({'nan': np.nan, '': np.nan, 'None': np.nan})

    # who was in charge
    gy = g[g.season == year]
    hc = dict(zip(gy.game_id, gy.home_coach))
    ac = dict(zip(gy.game_id, gy.away_coach))
    ht = dict(zip(gy.game_id, gy.home_team))
    home = pb.posteam.values == np.array([ht.get(x) for x in pb.game_id])
    pb['off_hc'] = np.where(home, pb.game_id.map(hc), pb.game_id.map(ac))
    pb['def_hc'] = np.where(home, pb.game_id.map(ac), pb.game_id.map(hc))
    pb['opp'] = pb.defteam

    if year >= CALLER_FIRST:
        oc, osure, dc, dsure = [], [], [], []
        cache = {}
        for t, d, w in zip(pb.posteam.values, pb.defteam.values, pb.week.values):
            k = (t, d, int(w))
            if k not in cache:
                a = caller_of(year, t, 'O', int(w))
                b = caller_of(year, d, 'D', int(w))
                cache[k] = (a, b)
            a, b = cache[k]
            oc.append(a[0] if a else None); osure.append(a[1] if a else None)
            dc.append(b[0] if b else None); dsure.append(b[1] if b else None)
        pb['off_caller'] = oc; pb['off_sure'] = osure
        pb['def_caller'] = dc; pb['def_sure'] = dsure
    return pb


# ================================================================ decisions
NFL4TH = None


def nfl4th():
    global NFL4TH
    if NFL4TH is None:
        p = os.path.join(RAW, 'nfl4th.rds')
        if not os.path.exists(p):
            NFL4TH = pd.DataFrame()
        else:
            import pyreadr
            NFL4TH = list(pyreadr.read_r(p).values())[0]
            NFL4TH['play_id'] = NFL4TH.play_id.astype(float)
    return NFL4TH


YTG_BINS = [0, 1, 3, 6, 100]            # 1 | 2-3 | 4-6 | 7+
YTG_LAB = ['1', '2–3', '4–6', '7+']
FLD_BINS = [0, 20, 35, 50, 70, 100]     # yards from the end zone
FLD_LAB = ['Opp 1–20', 'Opp 21–35', 'Opp 36–50', 'Own 30–49', 'Own 1–29']


def _spot(yl):
    yl = int(round(yl))
    if yl == 50:
        return 'midfield'
    return ('opp %d' % yl) if yl < 50 else ('own %d' % (100 - yl))


def fourth_downs(pb):
    """Every fourth down that was a real decision, scored by nfl4th."""
    gb = nfl4th()
    if not len(gb):
        return None
    d = pb[(pb.down == 4) & pb.play_type.isin(['pass', 'run', 'punt', 'field_goal'])
           & (pb.qb_kneel != 1) & (pb.qb_spike != 1)].copy()
    d['play_id'] = d.play_id.astype(float)
    d = d.merge(gb, on=['game_id', 'play_id'], how='inner')
    if not len(d):
        return None
    # a botched punt snap that ends up as a run is still a punt
    punt_form = d.desc.astype(str).str.contains('Punt formation', case=False) & (d.aborted_play == 1)
    d['choice'] = np.where(d.play_type == 'punt', 'punt',
                  np.where(d.play_type == 'field_goal', 'fg', 'go'))
    d.loc[punt_form, 'choice'] = 'punt'
    opts = d[['go_wp', 'punt_wp', 'fg_wp']].astype(float)
    d['best_wp'] = opts.max(axis=1)
    d['best'] = opts.idxmax(axis=1).str.replace('_wp', '').str.replace('fg', 'fg')
    d['chosen_wp'] = np.select([d.choice == 'go', d.choice == 'punt', d.choice == 'fg'],
                               [d.go_wp, d.punt_wp, d.fg_wp], default=np.nan).astype(float)
    d = d[d.chosen_wp.notna() & d.best_wp.notna()]
    d['lost'] = (d.best_wp - d.chosen_wp) * 100.0
    d['go'] = (d.choice == 'go').astype(int)
    d['boost'] = d.go_boost.astype(float)
    d['ytg_b'] = pd.cut(d.ydstogo, YTG_BINS, labels=False)
    d['fld_b'] = pd.cut(d.yardline_100, FLD_BINS, labels=False)
    return d


def decisions_by_coach(d):
    """-> {(coach, team): dict of counts, a 4x5 decision map and the worst calls}."""
    out = {}
    if d is None or not len(d):
        return out
    for (c, t), s in d.groupby(['off_hc', 'posteam']):
        if not isinstance(c, str):
            continue
        dg = s[s.boost > 4]; pg = s[(s.boost > 1) & (s.boost <= 4)]
        dk = s[s.boost < -4]; pk = s[(s.boost < -1) & (s.boost >= -4)]
        real = s[s.lost >= 1.0]                      # toss-ups are not judged
        grid = []
        for yb in range(len(YTG_LAB)):
            row = []
            for fb in range(len(FLD_LAB)):
                cell = s[(s.ytg_b == yb) & (s.fld_b == fb)]
                row.append([int(len(cell)), int(cell.go.sum()), int((cell.boost > 1).sum()),
                            int((cell.boost < -1).sum())])
            grid.append(row)
        worst = []
        for r in s.sort_values('lost', ascending=False).head(5).itertuples():
            if r.lost < 2.0:
                break
            opp = r.defteam
            worst.append(dict(
                g=r.game_id, wk=int(r.week), opp=opp, q=int(r.qtr), t=str(r.time or ''),
                sd=int(r.score_differential) if pd.notna(r.score_differential) else None,
                ytg=int(r.ydstogo), spot=_spot(r.yardline_100), ch=r.choice, best=r.best,
                lost=rnd(r.lost, 1), boost=rnd(r.boost, 1)))
        out[(c, t)] = dict(
            d4_n=int(len(s)), d4_go=int(s.go.sum()),
            d4_dg=int(len(dg)), d4_dg_go=int(dg.go.sum()),
            d4_pg=int(len(pg)), d4_pg_go=int(pg.go.sum()),
            d4_pk=int(len(pk)), d4_pk_go=int(pk.go.sum()),
            d4_dk=int(len(dk)), d4_dk_go=int(dk.go.sum()),
            d4_bad=int(len(real)), d4_lost=rnd(real.lost.sum(), 2),
            d4_grid=grid, d4_worst=worst[:3])
    return out


def decisions_league(d):
    if d is None or not len(d):
        return None
    dg = d[d.boost > 4]; pg = d[(d.boost > 1) & (d.boost <= 4)]
    games = d.groupby(['game_id', 'posteam']).ngroups
    real = d[d.lost >= 1.0]
    return dict(n=int(len(d)),
                dg_follow=rnd(100 * dg.go.mean(), 1) if len(dg) else None,
                pg_follow=rnd(100 * pg.go.mean(), 1) if len(pg) else None,
                go_rate=rnd(100 * d.go.mean(), 1),
                lost_g=rnd(real.lost.sum() / max(games, 1), 3))


# ================================================================ units
def _tempo(pb):
    seq = pb.sort_values(['game_id', 'game_seconds_remaining'], ascending=[True, False]).copy()
    seq['gap'] = seq.groupby('game_id').game_seconds_remaining.diff(-1)
    return seq[['game_id', 'play_id', 'gap']]


# The FTN look: where the quarterback stands, how many backs, and whether anyone moved.
ALIGN = {'U': 'under center', 'S': 'shotgun', 'P': 'pistol'}
FORM = {'SHOTGUN': 'shotgun', 'SINGLEBACK': 'under center', 'I_FORM': 'I-form',
        'EMPTY': 'empty', 'PISTOL': 'pistol', 'JUMBO': 'jumbo', 'WILDCAT': 'wildcat'}


def look_of(r_pers, r_loc, r_back, r_motion, r_form, era):
    """A human label for the pre-snap look. Three eras, because the sources differ:
       'ftn+pers' (2022-25): personnel + alignment (+ empty) + motion
       'ftn'      (in season, no personnel yet): backs + alignment + motion
       'pers'     (2018-21): personnel + formation (no motion charted)"""
    if era == 'pers':
        if not isinstance(r_pers, str) or not isinstance(r_form, str) or r_form not in FORM:
            return None
        return '%s · %s' % (r_pers, FORM[r_form])
    if not isinstance(r_loc, str) or r_loc not in ALIGN:
        return None
    al = 'empty' if r_back == 0 else ALIGN[r_loc]
    mo = ' · motion' if r_motion is True else ''
    if era == 'ftn+pers':
        if not isinstance(r_pers, str):
            return None
        return '%s · %s%s' % (r_pers, al, mo)
    backs = '0' if r_back == 0 else ('1' if r_back == 1 else ('2+' if r_back and r_back >= 2 else None))
    if backs is None:
        return None
    return '%s back%s · %s%s' % (backs, '' if backs == '1' else 's', ALIGN[r_loc], mo)


def season_era(pb):
    f = bool(pb.has_ftn.any())
    p = bool(pb.has_part.any()) and pb.pers.notna().mean() > 0.5 if 'pers' in pb else False
    if f and p:
        return 'ftn+pers'
    if f:
        return 'ftn'
    if p:
        return 'pers'
    return None


def _logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def fit_logistic(X, y, ridge=1.0, iters=25):
    """Plain IRLS with a small ridge. Enough for a few dozen dummies and 15k plays."""
    n, k = X.shape
    b = np.zeros(k)
    R = ridge * np.eye(k); R[0, 0] = 0
    for _ in range(iters):
        z = X @ b
        p = 1 / (1 + np.exp(-z))
        W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + R
        grad = X.T @ (y - p) - R @ b
        step = np.linalg.solve(H, grad)
        b += step
        if np.abs(step).max() < 1e-6:
            break
    return b


def tells(pb, era):
    """Tell Grid cells and the predictability score for every offensive unit in a season.

    Three layers of the same guess - run or pass - on first and second down in neutral
    game states:
      1. the situation alone (nflverse's xpass: down, distance, field, score, clock)
      2. + what the whole league does from each pre-snap look
      3. + what THIS offence does from each look, learned from his other snaps (each play
         is predicted without itself, and a look he rarely shows is pulled back toward the
         league)
    Layer 3 over layer 2 is the part that is his alone."""
    s = pb[pb.play_type.isin(['pass', 'run']) & pb.down.isin([1, 2]) & (pb.qtr <= 3)
           & pb.wp.between(0.2, 0.8) & pb.xpass.notna() & (pb.qb_kneel != 1)
           & (pb.qb_spike != 1) & pb.off_caller.notna()].copy()
    if era is None or not len(s):
        return {}, {}
    s['look'] = [look_of(a, b, c, d, e, era) for a, b, c, d, e in zip(
        s.pers if 'pers' in s else [None] * len(s),
        s.qb_location if 'qb_location' in s else [None] * len(s),
        s.n_offense_backfield if 'n_offense_backfield' in s else [None] * len(s),
        s.is_motion if 'is_motion' in s else [None] * len(s),
        s.offense_formation if 'offense_formation' in s else [None] * len(s))]
    s = s[s.look.notna()].copy()
    s['y'] = s.qb_dropback.astype(float)
    counts = s.look.value_counts()
    common = counts[counts >= 40].index
    s['lk'] = np.where(s.look.isin(common), s.look, '_other')
    levels = sorted(s.lk.unique())
    X = np.column_stack([np.ones(len(s)), _logit(s.xpass.astype(float).values)]
                        + [(s.lk.values == l).astype(float) for l in levels[1:]])
    b = fit_logistic(X, s.y.values)
    s['p2'] = 1 / (1 + np.exp(-(X @ b)))
    s['p1'] = s.xpass.astype(float)
    lg_rate = s.groupby('look').y.mean()

    K = 20.0
    grid, pred = {}, {}
    for key, u in s.groupby(['off_caller', 'posteam', 'unit']):
        u = u.copy()
        u['res'] = u.y - u.p2
        res = u.res
        grp = u.groupby('look')
        rsum = grp.res.transform('sum')
        rcnt = grp.res.transform('size')
        adj = (rsum - res) / (rcnt - 1 + K)
        p3 = np.clip(u.p2 + adj, 0.01, 0.99)
        acc1 = float(((u.p1 > .5) == (u.y == 1)).mean())
        acc2 = float(((u.p2 > .5) == (u.y == 1)).mean())
        acc3 = float(((p3 > .5) == (u.y == 1)).mean())
        pred[key[2]] = dict(pred_n=int(len(u)), pred_sit=rnd(100 * acc1, 1),
                            pred_look=rnd(100 * acc2, 1), pred_own=rnd(100 * acc3, 1),
                            tell=rnd(100 * (acc3 - acc2), 1))
        cells = []
        for lk, c in grp:
            if len(c) < 15:
                continue
            cells.append(dict(
                k=lk, n=int(len(c)), p=rnd(100 * c.y.mean(), 1),
                x=rnd(100 * c.p2.mean(), 1),               # league, same look, same spots
                lg=rnd(100 * lg_rate.get(lk, np.nan), 1),
                pa=rnd(100 * c.is_play_action.mean(), 1) if 'is_play_action' in c and c.is_play_action.notna().any() else None,
                epa=rnd(c.epa.mean(), 3)))
        cells.sort(key=lambda z: -z['n'])
        grid[key[2]] = dict(cells=cells[:14], shown=int(sum(c['n'] for c in cells[:14])),
                            total=int(len(u)))
    return grid, pred


# The charting source renamed routes in 2023. Before it there is one OUT (quick and deep
# together) and a FLAT; after it, QUICK OUT / DEEP OUT and SWING. OUT keeps its own name
# rather than being passed off as a quick out.
ROUTES = ['SCREEN', 'FLAT', 'SWING', 'QUICK OUT', 'OUT', 'SLANT', 'HITCH/CURL', 'SHALLOW CROSS/DRAG',
          'IN/DIG', 'DEEP OUT', 'CORNER', 'POST', 'GO', 'WHEEL', 'TEXAS/ANGLE']
ROUTE_FIX = {'HITCH': 'HITCH/CURL', 'CURL': 'HITCH/CURL', 'IN': 'IN/DIG',
             'CROSS': 'SHALLOW CROSS/DRAG', 'ANGLE': 'TEXAS/ANGLE'}


def offense_metrics(u, tempo_gap):
    """Everything measured on one offensive unit's snaps."""
    sc = u[u.play_type.isin(['pass', 'run']) & (u.qb_kneel != 1) & (u.qb_spike != 1)]
    neu = sc[(sc.qtr <= 3) & sc.wp.between(0.2, 0.8)]
    early = neu[neu.down.isin([1, 2])]
    db = sc[sc.qb_dropback == 1]
    att = sc[(sc.play_type == 'pass') & (sc.sack != 1) & sc.air_yards.notna()]
    runs = sc[(sc.play_type == 'run') & (sc.qb_scramble != 1)]
    m = dict(plays=int(len(sc)), games=int(u.game_id.nunique()),
             db=int(len(db)), runs=int(len(runs)))
    # --- how he plays: tendencies, neutral situations
    m['pass_rate'] = 100 * _mean(neu.qb_dropback) if len(neu) else None
    m['proe'] = _mean(neu.pass_oe)
    m['early_proe'] = _mean(early.pass_oe)
    m['uc'] = 100 * (1 - _mean(neu.shotgun)) if len(neu) and neu.shotgun.notna().any() else None
    m['nohuddle'] = 100 * _mean(neu.no_huddle) if len(neu) else None
    t = neu[['game_id', 'play_id']].merge(tempo_gap, on=['game_id', 'play_id'])
    t = t[t.gap.between(3, 60)]
    m['sec_play'] = _mean(t.gap)
    # --- efficiency, all snaps
    m['off_epa'] = _mean(sc.epa)
    m['pass_epa'] = _mean(db.epa)
    m['run_epa'] = _mean(runs.epa)
    m['success'] = 100 * _mean(sc.success) if len(sc) else None
    expl = ((sc.play_type == 'run') & (sc.yards_gained >= 10)) | \
           ((sc.play_type == 'pass') & (sc.yards_gained >= 20))
    m['explosive'] = 100 * float(expl.mean()) if len(sc) else None
    # --- the passing game
    m['adot'] = _mean(att.air_yards)
    m['deep'] = 100 * float((att.air_yards >= 20).mean()) if len(att) else None
    third = att[(att.down == 3)]
    m['sticks3'] = _mean(third.air_yards - third.ydstogo) if len(third) >= 20 else None
    # --- the running game
    m['outside'] = 100 * float((runs.run_gap == 'end').mean()) if len(runs) else None
    rz = sc[(sc.yardline_100 <= 20) & sc.down.isin([1, 2]) & (sc.qtr <= 3) & sc.wp.between(.2, .8)]
    m['rz_run'] = 100 * (1 - _mean(rz.qb_dropback)) if len(rz) >= 20 else None

    # --- FTN: the toolkit
    f = sc[sc.has_ftn == True] if 'has_ftn' in sc else sc.iloc[0:0]
    if len(f) >= 0.5 * max(len(sc), 1) and len(f) > 50:
        fn = f[(f.qtr <= 3) & f.wp.between(.2, .8)]
        fdb = f[f.qb_dropback == 1]
        fr = f[(f.play_type == 'run') & (f.qb_scramble != 1)]
        m['ftn_n'] = int(len(f))
        m['pistol'] = 100 * float((fn.qb_location == 'P').mean()) if len(fn) else None
        m['empty'] = 100 * float((fn.n_offense_backfield == 0).mean()) if len(fn) else None
        for key, col, base in (('motion', 'is_motion', f), ('pa', 'is_play_action', fdb),
                               ('rpo', 'is_rpo', f), ('screen', 'is_screen_pass', fdb),
                               ('oop', 'is_qb_out_of_pocket', fdb)):
            b = base[base[col].notna()]
            if len(b):
                on = b[b[col] == True]; off = b[b[col] == False]
                m[key] = 100 * float((b[col] == True).mean())
                m[key + '_epa'] = _mean(on.epa) if len(on) >= 15 else None
                m[key + '_epa_off'] = _mean(off.epa) if len(off) >= 15 else None
        rd = fdb[fdb.read_thrown.isin(['1', '2', 'CHK', 'SD', 'DES'])]
        if len(rd) >= 50:
            m['first_read'] = 100 * float((rd.read_thrown == '1').mean())
            m['checkdown'] = 100 * float((rd.read_thrown == 'CHK').mean())
            m['designed'] = 100 * float((rd.read_thrown == 'DES').mean())
        bx = fr[fr.n_defense_box > 0]
        if len(bx) >= 40:
            light = bx[bx.n_defense_box <= 6]
            m['light_box'] = 100 * float(len(light)) / len(bx)
            m['light_epa'] = _mean(light.epa) if len(light) >= 15 else None
            heavy = bx[bx.n_defense_box >= 8]
            m['heavy_box'] = 100 * float(len(heavy)) / len(bx)

    # --- participation: personnel, time to throw, routes, pressure allowed
    pp = sc[sc.has_part == True] if 'has_part' in sc else sc.iloc[0:0]
    if len(pp) >= 0.5 * max(len(sc), 1) and len(pp) > 50:
        pn = pp[(pp.qtr <= 3) & pp.wp.between(.2, .8) & pp.pers.notna()]
        if len(pn):
            vc = pn.pers.value_counts(normalize=True) * 100
            for code in ('11', '12', '21', '13', '10', '22'):
                m['p' + code] = float(vc.get(code, 0.0))
            m['heavy'] = float(vc[[c for c in vc.index if c in ('12', '13', '21', '22', '23', '31')]].sum())
            m['jumbo'] = 100 * float((pn.ol >= 6).mean())
        pdb = pp[pp.qb_dropback == 1]
        tt = pdb.time_to_throw.dropna()
        tt = tt[(tt > 0.5) & (tt < 10)]
        if len(tt) >= 50:
            m['ttt'] = float(tt.mean())
            m['quick'] = 100 * float((tt < 2.5).mean())
        pr = pdb.was_pressure.dropna()
        if len(pr) >= 50:
            m['press_allowed'] = 100 * float(pr.mean())
        r = pp[(pp.play_type == 'pass') & pp.route.notna()].route.replace(ROUTE_FIX)
        if len(r) >= 50:
            vc = r.value_counts(normalize=True) * 100
            m['routes'] = {k: rnd(vc.get(k, 0.0), 1) for k in ROUTES if vc.get(k, 0.0) > 0}
    return {k: _out(v) for k, v in m.items()}


COV = {'COVER_0': 'c0', 'COVER_1': 'c1', 'COVER_2': 'c2', '2_MAN': 'c2m', 'COVER_3': 'c3',
       'COVER_4': 'c4', 'COVER_6': 'c6', 'COVER_9': 'c9'}
TWO_HIGH = {'COVER_2', '2_MAN', 'COVER_4', 'COVER_6'}
ONE_HIGH = {'COVER_1', 'COVER_3'}


def defense_metrics(u):
    sc = u[u.play_type.isin(['pass', 'run']) & (u.qb_kneel != 1) & (u.qb_spike != 1)]
    db = sc[sc.qb_dropback == 1]
    runs = sc[(sc.play_type == 'run') & (sc.qb_scramble != 1)]
    m = dict(plays=int(len(sc)), games=int(u.game_id.nunique()), db=int(len(db)),
             runs=int(len(runs)))
    m['def_epa'] = _mean(sc.epa)
    m['pass_epa'] = _mean(db.epa)
    m['run_epa'] = _mean(runs.epa)
    m['success'] = 100 * _mean(sc.success) if len(sc) else None
    expl = ((sc.play_type == 'run') & (sc.yards_gained >= 10)) | \
           ((sc.play_type == 'pass') & (sc.yards_gained >= 20))
    m['explosive'] = 100 * float(expl.mean()) if len(sc) else None
    th = sc[sc.down == 3]
    conv = th.third_down_converted.fillna(0)
    m['third'] = 100 * float(conv.mean()) if len(th) >= 30 else None
    m['takeaway'] = 100 * float((sc.interception.fillna(0) + sc.fumble_lost.fillna(0)).clip(0, 1).mean()) if len(sc) else None

    ft = sc[sc.has_ftn == True] if 'has_ftn' in sc else sc.iloc[0:0]
    use_ftn = len(ft) >= 0.5 * max(len(sc), 1) and len(ft) > 50
    if use_ftn:
        fdb = ft[ft.qb_dropback == 1]
        cnt = fdb[fdb.n_pass_rushers > 0]
        if len(cnt) >= 50:
            m['blitz'] = 100 * float((cnt.n_blitzers > 0).mean())
            m['rushers'] = float(cnt.n_pass_rushers.mean())
            m['rush5'] = 100 * float((cnt.n_pass_rushers >= 5).mean())
            m['rush3'] = 100 * float((cnt.n_pass_rushers <= 3).mean())
            bl = cnt[cnt.n_blitzers > 0]; nb = cnt[cnt.n_blitzers == 0]
            m['blitz_epa'] = _mean(bl.epa) if len(bl) >= 15 else None
            m['noblitz_epa'] = _mean(nb.epa) if len(nb) >= 15 else None
        fr = ft[(ft.play_type == 'run') & (ft.qb_scramble != 1) & (ft.n_defense_box > 0)]
        if len(fr) >= 40:
            m['box'] = float(fr.n_defense_box.mean())
            m['box8'] = 100 * float((fr.n_defense_box >= 8).mean())

    pp = sc[sc.has_part == True] if 'has_part' in sc else sc.iloc[0:0]
    if len(pp) >= 0.5 * max(len(sc), 1) and len(pp) > 50:
        pdb = pp[pp.qb_dropback == 1]
        cv = pdb[pdb.defense_coverage_type.isin(list(COV))]
        if len(cv) >= 80:
            for k, key in COV.items():
                m[key] = 100 * float((cv.defense_coverage_type == k).mean())
            m['two_high'] = 100 * float(cv.defense_coverage_type.isin(TWO_HIGH).mean())
            m['one_high'] = 100 * float(cv.defense_coverage_type.isin(ONE_HIGH).mean())
            mz = pdb[pdb.defense_man_zone_type.isin(['MAN_COVERAGE', 'ZONE_COVERAGE'])]
            man = mz.defense_man_zone_type == 'MAN_COVERAGE'
            m['man'] = 100 * float(man.mean())
            ms = mz[man]; zs = mz[~man]
            m['man_epa'] = _mean(ms.epa) if len(ms) >= 15 else None
            m['zone_epa'] = _mean(zs.epa) if len(zs) >= 15 else None
            t3 = mz[mz.down == 3]
            m['man3'] = 100 * float((t3.defense_man_zone_type == 'MAN_COVERAGE').mean()) if len(t3) >= 30 else None
            v11 = mz[mz.pers == '11']
            vh = mz[mz.pers.isin(['12', '13', '21', '22'])]
            m['man_v11'] = 100 * float((v11.defense_man_zone_type == 'MAN_COVERAGE').mean()) if len(v11) >= 30 else None
            m['man_vheavy'] = 100 * float((vh.defense_man_zone_type == 'MAN_COVERAGE').mean()) if len(vh) >= 30 else None
            c11 = cv[cv.pers == '11']; ch = cv[cv.pers.isin(['12', '13', '21', '22'])]
            m['two_v11'] = 100 * float(c11.defense_coverage_type.isin(TWO_HIGH).mean()) if len(c11) >= 30 else None
            m['two_vheavy'] = 100 * float(ch.defense_coverage_type.isin(TWO_HIGH).mean()) if len(ch) >= 30 else None
        pr = pdb.was_pressure.dropna()
        if len(pr) >= 50:
            m['pressure'] = 100 * float(pr.mean())
            rc = pdb[pdb.was_pressure.notna() & (pdb.number_of_pass_rushers > 0)]
            four = rc[rc.number_of_pass_rushers <= 4]
            if len(four) >= 50:
                m['press4'] = 100 * float(four.was_pressure.mean())
            if not use_ftn and len(rc) >= 50:
                m['rushers'] = float(rc.number_of_pass_rushers.mean())
                m['rush5'] = 100 * float((rc.number_of_pass_rushers >= 5).mean())
                m['rush3'] = 100 * float((rc.number_of_pass_rushers <= 3).mean())
        nd = pp[pp.n_db.notna()]
        if len(nd) >= 100:
            m['base'] = 100 * float((nd.n_db <= 4).mean())
            m['nickel'] = 100 * float((nd.n_db == 5).mean())
            m['dime'] = 100 * float((nd.n_db >= 6).mean())
            n11 = nd[nd.pers == '11']
            if len(n11) >= 50:
                m['base_v11'] = 100 * float((n11.n_db <= 4).mean())
        if not use_ftn:
            rr = pp[(pp.play_type == 'run') & (pp.qb_scramble != 1) & (pp.defenders_in_box > 0)]
            if len(rr) >= 40:
                m['box'] = float(rr.defenders_in_box.mean())
                m['box8'] = 100 * float((rr.defenders_in_box >= 8).mean())
        hv = pp[(pp.play_type == 'run') & pp.pers.isin(['12', '13', '21', '22'])]
        bxcol = 'n_defense_box' if use_ftn else 'defenders_in_box'
        hv = hv[hv[bxcol] > 0] if bxcol in hv else hv.iloc[0:0]
        if len(hv) >= 30:
            m['light_vheavy'] = 100 * float((hv[bxcol] <= 6).mean())
    return {k: _out(v) for k, v in m.items()}


def _out(v):
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, (int, np.integer)) and not isinstance(v, bool):
        return int(v)
    return rnd(v, 3)


def build_units(pb, year):
    """-> (units, decisions_by_(coach,team), league decision summary) for one season."""
    units = {}
    d4 = fourth_downs(pb)
    dec = decisions_by_coach(d4)
    lg = decisions_league(d4)
    if year < CALLER_FIRST or 'off_caller' not in pb:
        return units, dec, lg

    era = season_era(pb)
    tempo = _tempo(pb)
    pb['unit'] = None
    for side in ('O', 'D'):
        ccol, tcol = ('off_caller', 'posteam') if side == 'O' else ('def_caller', 'defteam')
        scol = 'off_sure' if side == 'O' else 'def_sure'
        for (c, t), s in pb[pb[ccol].notna()].groupby([ccol, tcol]):
            wks = sorted(s.week.unique())
            # split where the team played a game under someone else in between
            team_wks = sorted(pb[pb[tcol] == t].week.unique())
            runs, curr = [], [wks[0]]
            for w in wks[1:]:
                between = [x for x in team_wks if curr[-1] < x < w]
                if between:
                    runs.append(curr); curr = [w]
                else:
                    curr.append(w)
            runs.append(curr)
            for i, rw in enumerate(runs):
                uid = '%d-%s-%s-%s' % (year, t, side, re.sub(r'[^A-Za-z]', '', c)[:12])
                if len(runs) > 1:
                    uid += '-%d' % (i + 1)
                mask = (pb[ccol] == c) & (pb[tcol] == t) & pb.week.isin(rw)
                if side == 'O':
                    pb.loc[mask, 'unit'] = uid
                sub = pb[mask]
                hcs = sorted(set(sub['off_hc' if side == 'O' else 'def_hc'].dropna()))
                m = offense_metrics(sub, tempo) if side == 'O' else defense_metrics(sub)
                units[uid] = dict(id=uid, season=year, team=t, side=side, caller=c,
                                  sure=bool(s[scol].iloc[0]), wk=[int(rw[0]), int(rw[-1])],
                                  hc=hcs, era=era, m=m,
                                  small=m.get('plays', 0) < MIN_UNIT_PLAYS)
    # A unit is ranked once it has a real sample. In a finished season that is 300 snaps; in
    # one being played, it is half of what the typical unit has so far, so September still
    # ranks - against the other September units, which is what the page compares it with.
    for side in ('O', 'D'):
        ps = [u['m'].get('plays', 0) for u in units.values() if u['side'] == side]
        if ps:
            cut = min(MIN_UNIT_PLAYS, 0.5 * float(np.median(ps)))
            for u in units.values():
                if u['side'] == side:
                    u['small'] = u['m'].get('plays', 0) < cut
    grid, pred = tells(pb, era)
    for uid, gd in grid.items():
        if uid in units:
            units[uid]['looks'] = gd
    for uid, pr in pred.items():
        if uid in units:
            units[uid]['m'].update(pr)
    return units, dec, lg
