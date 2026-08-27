"""Build public/football-savant-data.json.

Joins nflverse's season tables, PFR charting, Next Gen Stats, snap counts, the combine
and the play-by-play aggregates from pbp_agg.py into one file the page can hold in memory:

  {seasons:[...], generated, source, cfg-side stuff lives in the HTML,
   data: {"2025": {players: [ {id,name,team,pos,...,m:{key:val}, d:{denom:count}} ]}}}

Design notes worth keeping:
  * Percentiles are computed in the browser, not here, because the cohort and the baseline
    (this season vs all-time) are things the reader changes.
  * `m` holds only non-null values. `d` holds the denominators the metric table's
    stabilization thresholds are expressed in. Together they are what a bar needs.
  * Comps and weakness comps ARE precomputed, because they need the whole league at once.
"""
import json, math, os, sys, datetime
from collections import defaultdict

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from metrics import (METRICS, POS_PANELS, POS_LABEL, GROUP_LABEL, HEADLINE, WEAK_DIMS,
                     QUALIFY, QUALIFY_FALLBACK, TIER_SINCE, DENOMS)
from teams import TEAMS

RAW = os.environ.get('NFL_RAW', 'raw')
AGG = os.environ.get('NFL_AGG', 'agg')
OUT = os.environ.get('NFL_OUT', 'football-savant-data.json')
SEASONS = list(range(1999, 2026))

MBY = {m['key']: m for m in METRICS}


# ---------------------------------------------------------------- position cohorts
POS_MAP = {
    'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'FB': 'RB',
    'WR': 'WR', 'TE': 'TE',
    'T': 'OL', 'OT': 'OL', 'G': 'OL', 'OG': 'OL', 'C': 'OL', 'OL': 'OL',
    'DT': 'DI', 'NT': 'DI', 'DI': 'DI',
    'DE': 'ED', 'ED': 'ED', 'EDGE': 'ED',
    'LB': 'LB', 'ILB': 'LB', 'MLB': 'LB', 'OLB': 'LB',
    'CB': 'CB', 'DB': 'CB',
    'S': 'S', 'SAF': 'S', 'FS': 'S', 'SS': 'S',
    'K': 'K', 'PK': 'K', 'P': 'P',
}


def cohort(season_pos, pff_pos, ngs_pos):
    """Resolve a positional cohort.

    The season table says DE for both a wide-9 edge and a 320-pound five-technique, and
    OLB for both a stand-up rusher and an off-ball linebacker. PFF's position field draws
    the edge/interior line properly, so it wins where it exists; the season's own position
    is the fallback so the 1999 seasons still resolve.
    """
    for p in (pff_pos, ngs_pos, season_pos):
        if isinstance(p, str) and p.strip():
            v = POS_MAP.get(p.strip().upper())
            if v:
                return v
    return None


def num(x, default=None):
    try:
        if x is None:
            return default
        f = float(x)
        if not math.isfinite(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def safe(a, b, scale=1.0):
    a, b = num(a), num(b)
    if a is None or b in (None, 0):
        return None
    return a / b * scale


def sstr(x):
    """pandas hands back float('nan') for a missing string cell; that is not JSON."""
    if x is None:
        return None
    if isinstance(x, float) and not math.isfinite(x):
        return None
    s = str(x).strip()
    return s or None


def clean(o):
    """Strip anything json.dump would emit as NaN/Infinity — those are not valid JSON and
    a browser's JSON.parse rejects the whole file over one of them."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    return o


def rnd(v, p=4):
    if v is None:
        return None
    v = float(v)
    if not math.isfinite(v):
        return None
    return round(v, p)


# ---------------------------------------------------------------- source loading
def load_players():
    pl = pd.read_csv(os.path.join(RAW, 'players.csv'), low_memory=False)
    pl = pl[pl.gsis_id.notna()]
    bio, by_pfr, by_espn = {}, {}, {}
    for r in pl.itertuples(index=False):
        gid = r.gsis_id
        bio[gid] = dict(
            name=r.display_name, pfr=r.pfr_id if isinstance(r.pfr_id, str) else None,
            espn=str(int(r.espn_id)) if num(r.espn_id) else None,
            birth=r.birth_date if isinstance(r.birth_date, str) else None,
            college=r.college_name if isinstance(r.college_name, str) else None,
            head=r.headshot if isinstance(r.headshot, str) else None,
            jersey=int(r.jersey_number) if num(r.jersey_number) else None,
            rookie=int(r.rookie_season) if num(r.rookie_season) else None,
            dyear=int(r.draft_year) if num(r.draft_year) else None,
            dround=int(r.draft_round) if num(r.draft_round) else None,
            dpick=int(r.draft_pick) if num(r.draft_pick) else None,
            dteam=r.draft_team if isinstance(r.draft_team, str) else None,
            pff_pos=r.pff_position if isinstance(r.pff_position, str) else None,
            ngs_pos=r.ngs_position if isinstance(r.ngs_position, str) else None,
            ht=num(r.height), wt=num(r.weight),
        )
        if bio[gid]['pfr']:
            by_pfr[bio[gid]['pfr']] = gid
        if bio[gid]['espn']:
            by_espn[bio[gid]['espn']] = gid
    return bio, by_pfr, by_espn


def parse_ht(s):
    if not isinstance(s, str) or '-' not in s:
        return None
    a, b = s.split('-')[:2]
    try:
        return int(a) * 12 + int(b)
    except ValueError:
        return None


def load_combine(by_pfr):
    cb = pd.read_csv(os.path.join(RAW, 'combine.csv'), low_memory=False)
    out = {}
    for r in cb.itertuples(index=False):
        gid = by_pfr.get(r.pfr_id) if isinstance(r.pfr_id, str) else None
        if not gid:
            continue
        rec = dict(ht=parse_ht(r.ht), wt=num(r.wt), forty=num(r.forty), bench=num(r.bench),
                   vert=num(r.vertical), broad=num(r.broad_jump), cone=num(r.cone),
                   shuttle=num(r.shuttle))
        if rec['wt'] and rec['forty']:
            rec['spdscore'] = rec['wt'] * 200.0 / (rec['forty'] ** 4)
        out[gid] = {k: v for k, v in rec.items() if v is not None}
    return out


def load_ngs():
    """Season-level Next Gen Stats. week == 0 is the season row."""
    out = defaultdict(dict)
    for kind in ('passing', 'rushing', 'receiving'):
        p = os.path.join(RAW, 'ngs_%s.csv' % kind)
        if not os.path.exists(p):
            continue
        df = pd.read_csv(p, low_memory=False)
        df = df[(df.week == 0) & (df.season_type == 'REG')]
        for r in df.to_dict('records'):
            gid = r.get('player_gsis_id')
            if not isinstance(gid, str):
                continue
            out[(gid, int(r['season']))].update({kind[:3] + '_' + k: v for k, v in r.items()})
    return out


def load_pfr(by_pfr):
    out = defaultdict(dict)
    for kind in ('pass', 'rush', 'rec', 'def'):
        p = os.path.join(RAW, 'adv_%s.csv' % kind)
        df = pd.read_csv(p, low_memory=False)
        for r in df.to_dict('records'):
            pid = r.get('pfr_id')
            gid = by_pfr.get(pid) if isinstance(pid, str) else None
            if not gid:
                continue
            out[(gid, int(r['season']))].update({kind + '_' + k: v for k, v in r.items()})
    return out


def load_snaps(by_pfr):
    """Season snap totals plus snap share, from weekly snap counts (2013+)."""
    out = {}
    for y in range(2013, 2026):
        p = os.path.join(RAW, 'snaps_%d.csv' % y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            continue
        df = pd.read_csv(p, low_memory=False)
        df = df[df.game_type == 'REG'] if 'game_type' in df.columns else df
        # team snaps for a game = the largest single-player count on that side
        off_team = df.groupby(['game_id', 'team']).offense_snaps.max()
        def_team = df.groupby(['game_id', 'team']).defense_snaps.max()
        df['off_team'] = df.set_index(['game_id', 'team']).index.map(off_team)
        df['def_team'] = df.set_index(['game_id', 'team']).index.map(def_team)
        g = df.groupby('pfr_player_id').agg(
            off=('offense_snaps', 'sum'), dfn=('defense_snaps', 'sum'),
            st=('st_snaps', 'sum'), gp=('game_id', 'nunique'),
            offt=('off_team', 'sum'), deft=('def_team', 'sum')).reset_index()
        for r in g.itertuples(index=False):
            gid = by_pfr.get(r.pfr_player_id)
            if not gid:
                continue
            out[(gid, y)] = dict(off=float(r.off or 0), dfn=float(r.dfn or 0),
                                 st=float(r.st or 0), gp=int(r.gp or 0),
                                 offt=float(r.offt or 0), deft=float(r.deft or 0))
    return out


def load_qbr(by_espn):
    p = os.path.join(RAW, 'qbr.csv')
    df = pd.read_csv(p, low_memory=False)
    df = df[df.season_type == 'Regular']
    out = {}
    for r in df.itertuples(index=False):
        gid = by_espn.get(str(int(r.player_id))) if num(r.player_id) else None
        if gid:
            out[(gid, int(r.season))] = num(r.qbr_total)
    return out


def load_pbp(y):
    p = os.path.join(AGG, 'pbp_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}, {}
    j = json.load(open(p))
    def roll(rows):
        acc = defaultdict(lambda: defaultdict(float))
        for r in rows:
            pid = r['pid']
            for k, v in r.items():
                if k in ('pid', 'week'):
                    continue
                acc[pid][k] += float(v or 0)
        return acc
    return roll(j['qb']), roll(j['rush']), roll(j['rec'])


def fg_curve(reg_by_season):
    """League make-rate by distance, per season, for FG over expected.

    A logistic on distance is the standard shape; with one league-season of attempts a
    fitted logistic and a smoothed empirical curve agree closely, and the empirical one
    can't blow up on a season where nobody tried from 60. Falls back to the pooled
    all-season curve where a season is thin.
    """
    per, pooled = {}, defaultdict(lambda: [0, 0])
    for y, df in reg_by_season.items():
        made, missed = defaultdict(int), defaultdict(int)
        for r in df.itertuples(index=False):
            for lst, tgt in ((r.fg_made_list, made), (r.fg_missed_list, missed)):
                if isinstance(lst, str) and lst:
                    for d in lst.split(';'):
                        d = d.strip()
                        if d.isdigit():
                            tgt[int(d)] += 1
        per[y] = (made, missed)
        for d, n in made.items():
            pooled[d][0] += n
            pooled[d][1] += n
        for d, n in missed.items():
            pooled[d][1] += n

    def smooth(made, missed, d, half=4):
        m = t = 0
        for k in range(d - half, d + half + 1):
            w = 1.0 - abs(k - d) / (half + 1.0)
            m += made.get(k, 0) * w
            t += (made.get(k, 0) + missed.get(k, 0)) * w
        return (m, t)

    def p_make(y, d):
        made, missed = per.get(y, ({}, {}))
        m, t = smooth(made, missed, d)
        if t >= 12:
            return m / t
        pm = sum(pooled[k][0] * (1 - abs(k - d) / 5.0) for k in range(d - 4, d + 5) if k in pooled)
        pt = sum(pooled[k][1] * (1 - abs(k - d) / 5.0) for k in range(d - 4, d + 5) if k in pooled)
        if pt >= 12:
            return pm / pt
        return None
    return p_make


# ---------------------------------------------------------------- metric assembly
def build_player(r, pos, bio, ngs, pfr, snap, qbr, comb, qb, rush, rec, team_games, pmake, y):
    m, d = {}, {}
    G = num(r.get('games'), 0) or 0
    d['g'] = G
    if G:
        m['g'] = G
        if team_games:
            m['avail'] = min(1.0, G / team_games) * 100.0

    sn = snap.get((bio_id(r), y))
    off_s = def_s = None
    if sn:
        off_s, def_s = sn['off'], sn['dfn']
        tot = off_s + def_s + sn['st']
        d['snap'] = off_s
        d['dsnap'] = def_s
        if G:
            m['snaps'] = tot / G
        base = sn['offt'] if pos in ('QB', 'RB', 'WR', 'TE', 'OL') else sn['deft']
        side = off_s if pos in ('QB', 'RB', 'WR', 'TE', 'OL') else def_s
        if base:
            m['snapshr'] = side / base * 100.0
    pen = num(r.get('penalties'))
    if pen is not None and G:
        m['pen'] = pen / G

    ng = ngs.get((bio_id(r), y), {})
    pf = pfr.get((bio_id(r), y), {})

    # ------------------------------------------------------------------ passing
    att = num(r.get('attempts'), 0) or 0
    sacks = num(r.get('sacks_suffered'), 0) or 0
    db = att + sacks + (qb.get('scr', 0) if qb else 0)
    if qb:
        db = qb.get('db', db)
    if att >= 1:
        d['att'] = att
        d['db'] = db
        py_ = num(r.get('passing_yards'), 0) or 0
        ptd = num(r.get('passing_tds'), 0) or 0
        pint = num(r.get('passing_interceptions'), 0) or 0
        syl = num(r.get('sack_yards_lost'), 0) or 0
        cmp_ = num(r.get('completions'), 0) or 0
        m['cmppct'] = cmp_ / att * 100.0
        m['ypa'] = py_ / att
        m['tdpct'] = ptd / att * 100.0
        m['intpct'] = pint / att * 100.0
        m['anya'] = (py_ + 20 * ptd - 45 * pint - syl) / max(att + sacks, 1)
        m['rate'] = passer_rating(cmp_, att, py_, ptd, pint)
        if db:
            m['sackpct'] = sacks / db * 100.0
        ay = num(r.get('passing_air_yards'))
        if ay is not None and y >= TIER_SINCE[2]:
            m['adot'] = ay / att
        cp = num(r.get('passing_cpoe'))
        if cp is not None:
            m['cpoe'] = cp
        if qb:
            if qb.get('db'):
                m['epadb'] = qb['db_epa'] / qb['db']
                m['srdb'] = qb['db_succ'] / qb['db'] * 100.0
                m['scrrate'] = qb['scr'] / qb['db'] * 100.0
                m['twrate'] = qb['tw'] / qb['db'] * 100.0
                m['fddb'] = (num(r.get('passing_first_downs'), 0) or 0) / qb['db'] * 100.0
            if qb.get('att') and y >= TIER_SINCE[2]:
                m['deeprate'] = qb['deep'] / qb['att'] * 100.0
            if qb.get('td3'):
                m['td3conv'] = qb['td3_conv'] / qb['td3'] * 100.0
                d['td3'] = qb['td3']
            if qb.get('rz_db'):
                m['rztd'] = qb['rz_td'] / qb['rz_db'] * 100.0
        q = qbr.get((bio_id(r), y))
        if q is not None:
            m['qbr'] = q
        if y >= TIER_SINCE[5]:
            for src, key in (('pas_avg_time_to_throw', 'ttt'),
                             ('pas_avg_air_yards_to_sticks', 'aysticks'),
                             ('pas_aggressiveness', 'aggr'),
                             ('pas_expected_completion_percentage', 'xcomp')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if y >= TIER_SINCE[6]:
            pa = num(pf.get('pass_pass_attempts'))
            for src, key, sc in (('pass_pressure_pct', 'prsspct', 1.0),
                                 ('pass_on_tgt_pct', 'ontgt', 1.0),
                                 ('pass_bad_throw_pct', 'badthrow', 1.0),
                                 ('pass_drop_pct', 'droppct', 1.0),
                                 ('pass_pocket_time', 'pocket', 1.0)):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v * sc
            tb = num(pf.get('pass_times_blitzed'))
            if tb is not None and pa:
                m['blitzpct'] = tb / pa * 100.0
            pap = num(pf.get('pass_pa_pass_att'))
            if pap is not None and pa:
                m['parate'] = pap / pa * 100.0
            rpo = num(pf.get('pass_rpo_pass_att'))
            if rpo is not None and pa:
                m['rporate'] = rpo / pa * 100.0

    # ------------------------------------------------------------------ rushing
    car = num(r.get('carries'), 0) or 0
    if car >= 1:
        d['car'] = car
        ry = num(r.get('rushing_yards'), 0) or 0
        m['ypc'] = ry / car
        if G:
            m['car'] = car / G
        m['fumrate'] = (num(r.get('rushing_fumbles'), 0) or 0) / car * 100.0
        m['fdcar'] = (num(r.get('rushing_first_downs'), 0) or 0) / car * 100.0
        if G:
            m['rushy'] = ry / G
        if rush and rush.get('car'):
            n = rush['car']
            m['epacar'] = rush['car_epa'] / n
            m['srcar'] = rush['car_succ'] / n * 100.0
            m['stuff'] = rush['stuff'] / n * 100.0
            m['ex10'] = rush['ex10'] / n * 100.0
            m['ex20'] = rush['ex20'] / n * 100.0
            if rush.get('rz_car'):
                m['rztdcar'] = rush['rz_td'] / rush['rz_car'] * 100.0
        if y >= TIER_SINCE[5]:
            v = num(ng.get('rus_rush_yards_over_expected_per_att'))
            if v is not None:
                m['ryoe'] = v
            v = num(ng.get('rus_percent_attempts_gte_eight_defenders'))
            if v is not None:
                m['box8'] = v
            v = num(ng.get('rus_avg_time_to_los'))
            if v is not None:
                m['tlos'] = v
        if y >= TIER_SINCE[6]:
            ra = num(pf.get('rush_att'))
            for src, key in (('rush_ybc_att', 'ybc'), ('rush_yac_att', 'yacr')):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v
            bt = num(pf.get('rush_brk_tkl'))
            if bt is not None and ra:
                m['brkrate'] = bt / ra * 100.0

    # ------------------------------------------------------------------ receiving
    tgt = num(r.get('targets'), 0) or 0
    rcp0 = num(r.get('receptions'), 0) or 0
    if rcp0 >= 1:
        # Receptions and receiving yardage are recorded in every season; targets are not
        # (see the tier note in metrics.py), so these two rows anchor the older cards.
        d['rec'] = rcp0
        recy0 = num(r.get('receiving_yards'), 0) or 0
        if G:
            m['recg'] = rcp0 / G
            m['recy'] = recy0 / G
        m['yprec'] = recy0 / rcp0
    if tgt >= 1:
        d['tgt'] = tgt
        rcp = rcp0
        recy = num(r.get('receiving_yards'), 0) or 0
        m['ypt'] = recy / tgt
        m['catch'] = rcp / tgt * 100.0
        m['fdtgt'] = (num(r.get('receiving_first_downs'), 0) or 0) / tgt * 100.0
        m['tdtgt'] = (num(r.get('receiving_tds'), 0) or 0) / tgt * 100.0
        m['ex20rec'] = (num(r.get('receiving_20'), 0) or 0) / tgt * 100.0
        if G:
            m['tgt'] = tgt / G
        rec_ay = num(r.get('receiving_air_yards'))
        for src, key, sc in (('target_share', 'tgtshr', 100.0),
                             ('air_yards_share', 'ayshr', 100.0),
                             ('wopr', 'wopr', 1.0), ('racr', 'racr', 1.0)):
            v = num(r.get(src))
            if v is None or (key != 'tgtshr' and y < TIER_SINCE[2]):
                continue
            # RACR is yards / air yards: with a shallow target diet the denominator goes to
            # zero and the ratio blows up, so it is only reported where it can mean something.
            if key == 'racr' and (rec_ay is None or rec_ay < 60):
                continue
            m[key] = v * sc
        if rec and rec.get('tgt'):
            n = rec['tgt']
            m['epatgt'] = rec['tgt_epa'] / n
            m['srtgt'] = rec['tgt_succ'] / n * 100.0
            if y >= TIER_SINCE[2]:
                m['adotr'] = rec['ay'] / n
                m['deeptgt'] = rec['deep'] / n * 100.0
                if rec.get('rec'):
                    m['yacrec'] = rec['yac'] / rec['rec']
            m['rztgtr'] = rec['rz_tgt'] / n * 100.0
        if off_s:
            m['tprs'] = tgt / off_s * 100.0
            m['ypsnap'] = recy / off_s
        if y >= TIER_SINCE[5]:
            for src, key in (('rec_avg_separation', 'sep'), ('rec_avg_cushion', 'cush'),
                             ('rec_avg_yac_above_expectation', 'yacoe')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if y >= TIER_SINCE[6]:
            for src, key, sc in (('rec_ybc_r', 'ybcr', 1.0),
                                 ('rec_drop_percent', 'dropr', 100.0),
                                 ('rec_rat', 'rattgt', 1.0)):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v * sc
            bt, rc = num(pf.get('rec_brk_tkl')), num(pf.get('rec_rec'))
            if bt is not None and rc:
                m['brkrec'] = bt / rc * 100.0

    # ------------------------------------------------------------------ defense
    tkl_s = num(r.get('def_tackles_solo'), 0) or 0
    tkl_a = num(r.get('def_tackle_assists'), 0) or 0
    comb_t = tkl_s + tkl_a
    dsk = num(r.get('def_sacks'), 0) or 0
    if G and (comb_t or dsk or num(r.get('def_qb_hits'), 0)):
        m['tkl'] = comb_t / G
        if comb_t:
            m['solopct'] = tkl_s / comb_t * 100.0
        m['sk'] = dsk / G
        m['hits'] = (num(r.get('def_qb_hits'), 0) or 0) / G
        m['tfl'] = (num(r.get('def_tackles_for_loss'), 0) or 0) / G
        m['ff'] = (num(r.get('def_fumbles_forced'), 0) or 0) / G
        m['int'] = (num(r.get('def_interceptions'), 0) or 0) / G
        m['pd'] = (num(r.get('def_pass_defended'), 0) or 0) / G
        if def_s:
            m['tklsnap'] = comb_t / def_s * 100.0
            m['sksnap'] = dsk / def_s * 100.0
            m['tflsnap'] = (num(r.get('def_tackles_for_loss'), 0) or 0) / def_s * 100.0
    if y >= TIER_SINCE[6] and pf:
        prs = num(pf.get('def_prss'))
        if prs is not None and G:
            m['prss'] = prs / G
            if def_s:
                m['prsssnap'] = prs / def_s * 100.0
        for src, key in (('def_hrry', 'hrry'), ('def_qbkd', 'qbkd'),
                         ('def_bltz', 'blitz'), ('def_bats', 'bats')):
            v = num(pf.get(src))
            if v is not None and G:
                m[key] = v / G
        hr, kd = num(pf.get('def_hrry')), num(pf.get('def_qbkd'))
        if hr is not None and kd is not None and def_s:
            m['prod'] = (dsk + 0.75 * (hr + kd)) / def_s * 100.0
        v = num(pf.get('def_m_tkl_percent'))
        if v is not None:
            m['mtklpct'] = v * 100.0
        ct = num(pf.get('def_tgt'))
        if ct is not None and ct > 0:
            d['ctgt'] = ct
            if G:
                m['ctgt'] = ct / G
            if def_s:
                m['ctgtsnap'] = ct / def_s * 100.0
            for src, key, sc in (('def_cmp_percent', 'cmpall', 100.0),
                                 ('def_yds_tgt', 'yptall', 1.0),
                                 ('def_rat', 'ratall', 1.0), ('def_dadot', 'dadot', 1.0)):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v * sc
            cy = num(pf.get('def_yds'))
            if cy is not None and def_s:
                m['ycs'] = cy / def_s
            yac = num(pf.get('def_yac'))
            cmpn = num(pf.get('def_cmp'))
            if yac is not None and cmpn:
                m['yacall'] = yac / cmpn
            ballp = (num(r.get('def_interceptions'), 0) or 0) + (num(r.get('def_pass_defended'), 0) or 0)
            m['ballrate'] = ballp / ct * 100.0

    # ------------------------------------------------------------------ kicking
    fga = num(r.get('fg_att'), 0) or 0
    if fga:
        d['fga'] = fga
        m['fgpct'] = (num(r.get('fg_made'), 0) or 0) / fga * 100.0
        m['fglong'] = num(r.get('fg_long'))
        if G:
            m['fga'] = fga / G
        pat_a = num(r.get('pat_att'), 0) or 0
        if pat_a:
            m['patpct'] = (num(r.get('pat_made'), 0) or 0) / pat_a * 100.0
        made50 = miss50 = 0
        over = under = 0.0
        for lst, is_made in ((r.get('fg_made_list'), True), (r.get('fg_missed_list'), False)):
            if isinstance(lst, str) and lst:
                for dd in lst.split(';'):
                    dd = dd.strip()
                    if not dd.isdigit():
                        continue
                    dist = int(dd)
                    if dist >= 50:
                        made50 += 1 if is_made else 0
                        miss50 += 0 if is_made else 1
                    p = pmake(y, dist)
                    if p is not None:
                        over += (1.0 if is_made else 0.0) - p
                        under += 1
        if made50 + miss50:
            m['fg50'] = made50 / (made50 + miss50) * 100.0
        if under:
            m['fgoe'] = over / under
    pa_ = num(r.get('pt_att'), 0) or 0
    if pa_:
        d['punt'] = pa_
        m['pgross'] = (num(r.get('pt_yards'), 0) or 0) / pa_
        m['pnet'] = (num(r.get('pt_net_yards'), 0) or 0) / pa_
        m['pin20'] = (num(r.get('pt_inside_20'), 0) or 0) / pa_ * 100.0
        m['ptb'] = (num(r.get('pt_touchback'), 0) or 0) / pa_ * 100.0
        m['pretr'] = (num(r.get('pt_returned'), 0) or 0) / pa_ * 100.0
        m['pretyds'] = (num(r.get('pt_return_yards'), 0) or 0) / pa_
        if G:
            m['punts'] = pa_ / G

    # ------------------------------------------------------------------ value
    epa_tot = sum(num(r.get(k), 0) or 0 for k in
                  ('passing_epa', 'rushing_epa', 'receiving_epa'))
    if epa_tot:
        m['epatot'] = epa_tot
    fp = num(r.get('fantasy_points_ppr'))
    if fp is not None and G:
        m['fppg'] = fp / G
    touches = car + (num(r.get('receptions'), 0) or 0)
    if touches and G:
        m['toucheg'] = touches / G

    # ------------------------------------------------------------------ athletic
    for k, v in comb.get(bio_id(r), {}).items():
        m[k] = v
    b = bio.get(bio_id(r)) or {}
    if 'ht' not in m and b.get('ht'):
        m['ht'] = b['ht']
    if 'wt' not in m and b.get('wt'):
        m['wt'] = b['wt']

    # only rows the cohort actually shows
    panels = set(POS_PANELS.get(pos, []))
    m = {k: rnd(v) for k, v in m.items()
         if v is not None and k in MBY and MBY[k]['grp'] in panels
         and pos in MBY[k]['pos'] and MBY[k]['since'] <= y}
    return {k: v for k, v in m.items() if v is not None}, d


_CUR_ID = None


def bio_id(r):
    return r.get('player_id')


def passer_rating(cmp_, att, yds, td, int_):
    if not att:
        return None
    a = min(max((cmp_ / att - 0.3) * 5, 0), 2.375)
    b = min(max((yds / att - 3) * 0.25, 0), 2.375)
    c = min(max((td / att) * 20, 0), 2.375)
    dd = min(max(2.375 - (int_ / att * 25), 0), 2.375)
    return (a + b + c + dd) / 6 * 100


# ---------------------------------------------------------------- comps
def pct_rank(v, pool, lower):
    n = len(pool)
    if v is None or n < 2:
        return None
    less = sum(1 for x in pool if x < v)
    eq = sum(1 for x in pool if x == v)
    p = 100.0 * (less + 0.5 * eq) / n
    return 100.0 - p if lower else p


def add_comps(players, pos_pools):
    """Statistical comps and weakness comps, per cohort, inside one season."""
    for pos, group in pos_pools.items():
        qual = [p for p in group if p['qualified']]
        if len(qual) < 6:
            continue
        dims = [k for k in HEADLINE.get(pos, []) if k in MBY]
        wdims = [k for k in WEAK_DIMS.get(pos, []) if k in MBY]
        pools = {}
        for k in set(dims) | set(wdims):
            pools[k] = [p['m'][k] for p in qual if k in p['m']]
        def vec(p, keys):
            out = []
            for k in keys:
                v = p['m'].get(k)
                out.append(pct_rank(v, pools[k], MBY[k]['lower']) if v is not None else None)
            return out
        vecs = {p['id']: vec(p, dims) for p in qual}
        wvecs = {p['id']: vec(p, wdims) for p in qual}
        for p in qual:
            a = vecs[p['id']]
            scored = []
            for q in qual:
                if q['id'] == p['id']:
                    continue
                b = vecs[q['id']]
                pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
                if len(pairs) < max(2, len(dims) - 2):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                scored.append((round(max(0.0, 100.0 - dist * 1.6)), q))
            scored.sort(key=lambda t: -t[0])
            p['comps'] = [dict(id=q['id'], name=q['name'], team=q.get('team') or '', score=s)
                          for s, q in scored[:4]]
            # weakness: hinge at the median, keep only the below-average half
            aw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[p['id']]]
            flaws = sorted([(x, k) for x, k in zip(wvecs[p['id']], wdims)
                            if x is not None and x < 40], key=lambda t: t[0])[:3]
            p['wflaws'] = [dict(k=k, pct=int(round(x))) for x, k in flaws]
            worst = min([v for v in wvecs[p['id']] if v is not None], default=None)
            if worst is None or worst >= 40:
                p['wcomps'] = []
                continue
            wscored = []
            for q in qual:
                if q['id'] == p['id']:
                    continue
                bw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[q['id']]]
                pairs = [(x, y) for x, y in zip(aw, bw) if x is not None and y is not None]
                if len(pairs) < max(2, len(wdims) - 3):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                wscored.append((round(max(0.0, 100.0 - dist * 2.2)), q))
            wscored.sort(key=lambda t: -t[0])
            p['wcomps'] = [dict(id=q['id'], name=q['name'], team=q.get('team') or '', score=s)
                           for s, q in wscored[:4]]


# ---------------------------------------------------------------- main
def main():
    bio, by_pfr, by_espn = load_players()
    comb = load_combine(by_pfr)
    ngs = load_ngs()
    pfr = load_pfr(by_pfr)
    snap = load_snaps(by_pfr)
    qbr = load_qbr(by_espn)
    print('sources loaded', flush=True)

    regs = {}
    for y in SEASONS:
        p = os.path.join(RAW, 'reg_%d.csv' % y)
        if os.path.exists(p):
            regs[y] = pd.read_csv(p, low_memory=False)
    pmake = fg_curve(regs)

    data, season_list = {}, []
    for y in SEASONS:
        if y not in regs:
            continue
        df = regs[y]
        qb_a, rush_a, rec_a = load_pbp(y)
        team_games = 17 if y >= 2021 else 16
        players, pos_pools = [], defaultdict(list)
        for r in df.to_dict('records'):
            gid = r.get('player_id')
            if not isinstance(gid, str):
                continue
            b = bio.get(gid, {})
            pos = cohort(r.get('position'), b.get('pff_pos'), b.get('ngs_pos'))
            if not pos:
                continue
            m, d = build_player(r, pos, bio, ngs, pfr, snap, qbr, comb,
                                qb_a.get(gid), rush_a.get(gid), rec_a.get(gid),
                                team_games, pmake, y)
            if not m:
                continue
            qkey, qmin = QUALIFY.get(pos, ('g', 6))
            have = d.get(qkey)
            if have is None and pos in QUALIFY_FALLBACK:
                qkey, qmin = QUALIFY_FALLBACK[pos]
                have = d.get(qkey)
            qualified = bool(have is not None and have >= qmin)
            age = None
            if b.get('birth'):
                try:
                    by_ = int(str(b['birth'])[:4])
                    age = y - by_ + (0 if int(str(b['birth'])[5:7]) <= 8 else -1)
                except (ValueError, TypeError):
                    age = None
            rec_out = dict(
                id=gid, name=sstr(r.get('player_display_name')) or b.get('name') or gid,
                team=sstr(r.get('recent_team')), pos=pos, rawpos=sstr(r.get('position')),
                m=m, d={k: rnd(v, 1) for k, v in d.items() if v},
                qualified=qualified,
            )
            if age:
                rec_out['age'] = age
            for k in ('college', 'head', 'jersey', 'birth'):
                v = b.get(k)
                if isinstance(v, str):
                    v = sstr(v)
                if v:
                    rec_out['h' if k == 'head' else k] = v
            if b.get('rookie'):
                rec_out['exp'] = max(0, y - b['rookie'])
            if b.get('dround'):
                rec_out['dr'] = b['dround']
                rec_out['dp'] = b.get('dpick')
                rec_out['dy'] = b.get('dyear')
                rec_out['dt'] = b.get('dteam')
            elif b.get('dyear') is None and b.get('rookie'):
                rec_out['udfa'] = 1
            players.append(rec_out)
            pos_pools[pos].append(rec_out)

        # EPA + CPOE composite: standardized inside the season so eras line up
        qbs = [p for p in pos_pools.get('QB', []) if p['qualified']]
        for key, parts in (('comp', ('epadb', 'cpoe')),):
            vals = {k: [p['m'][k] for p in qbs if k in p['m']] for k in parts}
            stats = {k: (float(np.mean(v)), float(np.std(v)) or 1.0)
                     for k, v in vals.items() if len(v) > 3}
            if len(stats) == len(parts):
                for p in qbs:
                    if all(k in p['m'] for k in parts):
                        z = sum((p['m'][k] - stats[k][0]) / stats[k][1] for k in parts)
                        p['m'][key] = rnd(z / len(parts), 3)

        add_comps(players, pos_pools)
        data[str(y)] = dict(players=players)
        season_list.append(str(y))
        print(y, len(players), 'players', flush=True)

    cfg = dict(metrics=METRICS, panels=POS_PANELS, posLabel=POS_LABEL,
               groupLabel=GROUP_LABEL, headline=HEADLINE, weakDims=WEAK_DIMS,
               qualify={k: list(v) for k, v in QUALIFY.items()},
               qualifyFallback={k: list(v) for k, v in QUALIFY_FALLBACK.items()},
               tierSince=TIER_SINCE, denoms=DENOMS, teams=TEAMS,
               season=season_list[-1] if season_list else None)
    out = dict(seasons=list(reversed(season_list)),
               generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               source='nflverse (nflfastR pbp, PFR advanced, Next Gen Stats, snap counts, combine, ESPN QBR)',
               cfg=cfg, data=data)
    with open(OUT, 'w') as f:
        json.dump(clean(out), f, separators=(',', ':'), allow_nan=False)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
