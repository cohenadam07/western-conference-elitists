"""Situational splits, one file per season -> public/football-splits/<season>.json

A season line is an average over very different kinds of play. This stage takes the same
plays apart: by down, by distance, by field position, by quarter, by score, home and away,
and - where somebody charted it - by play-action, blitz, motion, formation, pressure,
coverage and personnel. One small file a season, fetched only when a reader opens the
splits panel, the same way the field maps are.

Three ledgers, each with the handful of sums its rates need (never a rate itself, so the
page can add cells together):

  q  passer, per dropback    [dropbacks, EPA, successes, attempts, completions, yards,
                              touchdowns, interceptions, sacks]
  r  rusher, per carry       [carries, EPA, successes, yards, touchdowns, first downs]
  t  receiver, per target    [targets, EPA, successes, catches, yards, touchdowns,
                              first downs]

Where a split comes from, and so where it exists:

  every season  down, distance on third and fourth down, field position, quarter,
                score, home or away, roof
  2022 on       play-action, blitz, pre-snap motion, under center or shotgun, RPO,
                screen, men in the box (FTN charting; posted within days of a game)
  2016 on       pressured or clean, time to throw, personnel, men in the box
  2018 on       man or zone, and the coverage shell
                (participation; published after the season, so blank until then)

A player gets a row once he has enough plays for a split to be more than an anecdote
(MIN below). A cell with nothing in it is left out. Every file also carries the league's
own line for each position under "lg", so a split can be read against what is normal for
that situation rather than against the player's own season.
"""
import json, os, sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_SPLITS', os.path.join('..', '..', 'public', 'football-splits'))
MIN = {'q': 30, 'r': 20, 't': 15}

PBP_COLS = ['game_id', 'play_id', 'week', 'season_type', 'play_type', 'posteam', 'defteam',
            'home_team', 'down', 'ydstogo', 'yardline_100', 'qtr', 'score_differential',
            'roof', 'qb_dropback', 'qb_scramble', 'qb_kneel', 'qb_spike', 'sack',
            'complete_pass', 'interception', 'touchdown', 'pass_touchdown', 'first_down',
            'yards_gained', 'epa', 'qb_epa', 'success', 'air_yards',
            'passer_player_id', 'rusher_player_id', 'receiver_player_id',
            'two_point_attempt', 'receiving_yards', 'passing_yards', 'rush_touchdown']
FTN_COLS = ['nflverse_game_id', 'nflverse_play_id', 'is_play_action', 'is_motion', 'is_rpo',
            'is_screen_pass', 'qb_location', 'n_blitzers', 'n_defense_box', 'n_pass_rushers']
PART_COLS = ['nflverse_game_id', 'play_id', 'was_pressure', 'time_to_throw',
             'offense_personnel', 'defenders_in_box', 'defense_man_zone_type',
             'defense_coverage_type']

# (key, heading, [(bucket, label), ...], ledgers it applies to)
DIMS = [
    ('down', 'Down', [('1', '1st down'), ('2', '2nd down'), ('3', '3rd & 4th down')], 'qrt'),
    ('dist', 'Third and fourth down, by distance',
     [('s', '1-2 to go'), ('m', '3-6 to go'), ('l', '7+ to go')], 'qrt'),
    ('zone', 'Field position',
     [('own', 'Own territory'), ('opp', 'Opponent 50 to 21'), ('rz', 'Opponent 20 to 11'),
      ('g10', 'Inside the 10')], 'qrt'),
    ('qtr', 'Quarter', [('1', '1st'), ('2', '2nd'), ('3', '3rd'), ('4', '4th & overtime')], 'qrt'),
    ('score', 'Score', [('up', 'Leading by 9+'), ('one', 'Within one score'),
                        ('dn', 'Trailing by 9+')], 'qrt'),
    ('site', 'Home and away', [('h', 'Home'), ('a', 'Away')], 'qrt'),
    ('roof', 'Roof', [('out', 'Outdoors'), ('in', 'Indoors')], 'qrt'),
    ('pa', 'Play-action', [('y', 'Play-action'), ('n', 'No play-action')], 'qt'),
    ('blitz', 'Blitz', [('y', 'Blitzed (5 or more rushers)'), ('n', 'Four or fewer rushers')], 'qt'),
    ('motion', 'Pre-snap motion', [('y', 'With motion'), ('n', 'No motion')], 'qrt'),
    ('form', 'Formation', [('u', 'Under center'), ('s', 'Shotgun or pistol')], 'qrt'),
    ('rpo', 'RPO', [('y', 'RPO'), ('n', 'Not an RPO')], 'qr'),
    ('screen', 'Screens', [('y', 'Screen'), ('n', 'Not a screen')], 'qt'),
    ('box', 'Men in the box', [('lt', '6 or fewer'), ('7', '7'), ('st', '8 or more')], 'r'),
    ('prs', 'Pressure', [('y', 'Under pressure'), ('n', 'Clean pocket')], 'qt'),
    ('ttt', 'Time to throw', [('q', 'Under 2.5 seconds'), ('s', '2.5 seconds or more')], 'qt'),
    ('cov', 'Coverage', [('man', 'Man'), ('zone', 'Zone')], 'qt'),
    ('shell', 'Coverage shell',
     [('c0', 'Cover 0'), ('c1', 'Cover 1'), ('c2', 'Cover 2'), ('c3', 'Cover 3'),
      ('c4', 'Cover 4'), ('c6', 'Cover 6'), ('2m', '2-man')], 'qt'),
    ('pers', 'Personnel', [('11', '11 (1 back, 1 tight end)'), ('12', '12 (1 back, 2 tight ends)'),
                           ('21', '2 backs'), ('13', '13 (1 back, 3 tight ends)'),
                           ('10', '10 (1 back, no tight end)')], 'qrt'),
]
SHELL = {'COVER_0': 'c0', 'COVER_1': 'c1', 'COVER_2': 'c2', 'COVER_3': 'c3', 'COVER_4': 'c4',
         'COVER_6': 'c6', '2_MAN': '2m'}


def _num(s):
    return pd.to_numeric(s, errors='coerce')


def _bool(s):
    return s.astype(str).str.upper().isin(['TRUE', '1'])


def _personnel(s):
    """'1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR' -> '11'. Fullbacks count as backs."""
    def one(v):
        if not isinstance(v, str):
            return None
        rb = te = 0
        for part in v.split(','):
            bits = part.strip().split(' ')
            if len(bits) != 2 or not bits[0].isdigit():
                continue
            n, p = int(bits[0]), bits[1]
            if p in ('RB', 'FB', 'HB'):
                rb += n
            elif p == 'TE':
                te += n
        if rb >= 2:
            return '21'
        key = '%d%d' % (rb, te)
        return key if key in ('11', '12', '13', '10') else None
    cache = {}
    return s.map(lambda v: cache.setdefault(v, one(v)) if isinstance(v, str) else None)


def buckets(d, has_ftn, has_part):
    """One column per split, holding each play's bucket (or None)."""
    b = pd.DataFrame(index=d.index)
    down = _num(d.down)
    b['down'] = np.select([down == 1, down == 2, down >= 3], ['1', '2', '3'], default=None)
    late, togo = down >= 3, _num(d.ydstogo)
    b['dist'] = np.select([late & (togo <= 2), late & (togo <= 6), late & (togo >= 7)],
                          ['s', 'm', 'l'], default=None)
    yl = _num(d.yardline_100)
    b['zone'] = np.select([yl <= 10, yl <= 20, yl <= 50, yl > 50], ['g10', 'rz', 'opp', 'own'],
                          default=None)
    q = _num(d.qtr)
    b['qtr'] = np.select([q == 1, q == 2, q == 3, q >= 4], ['1', '2', '3', '4'], default=None)
    sd = _num(d.score_differential)
    b['score'] = np.select([sd >= 9, sd <= -9, sd.notna()], ['up', 'dn', 'one'], default=None)
    b['site'] = np.where(d.posteam == d.home_team, 'h', 'a')
    roof = d.roof.astype(str)
    b['roof'] = np.select([roof.isin(['outdoors', 'open']), roof.isin(['dome', 'closed'])],
                          ['out', 'in'], default=None)
    if has_ftn:
        ch = d.ftn.fillna(False).astype(bool)
        for key, col in (('pa', 'is_play_action'), ('motion', 'is_motion'), ('rpo', 'is_rpo'),
                         ('screen', 'is_screen_pass')):
            b[key] = np.where(ch, np.where(_bool(d[col]), 'y', 'n'), None)
        # five or more coming, which is what the card's blitz rows count; the charting's
        # own "blitzers" column counts any linebacker or back who rushed, and the two
        # disagreed by thirty dropbacks a season for the same quarterback
        nr = _num(d.n_pass_rushers)
        b['blitz'] = np.where(ch & (nr > 0), np.where(nr >= 5, 'y', 'n'), None)
        loc = d.qb_location.astype(str).str.upper()
        b['form'] = np.select([ch & (loc == 'U'), ch & loc.isin(['S', 'P'])], ['u', 's'], default=None)
    box = _num(d.n_defense_box) if has_ftn else pd.Series(np.nan, index=d.index)
    if has_part:
        box = box.where(box > 0, _num(d.defenders_in_box))
    if has_ftn or has_part:
        b['box'] = np.select([(box > 0) & (box <= 6), box == 7, box >= 8], ['lt', '7', 'st'], default=None)
    if has_part:
        prs = d.was_pressure
        b['prs'] = np.where(prs.notna(), np.where(_bool(prs), 'y', 'n'), None)
        t = _num(d.time_to_throw)
        b['ttt'] = np.select([t < 2.5, t >= 2.5], ['q', 's'], default=None)
        mz = d.defense_man_zone_type.astype(str).str.upper()
        b['cov'] = np.select([mz.str.startswith('MAN'), mz.str.startswith('ZONE')], ['man', 'zone'],
                             default=None)
        b['shell'] = d.defense_coverage_type.astype(str).str.upper().map(SHELL)
        b['pers'] = _personnel(d.offense_personnel)
    return b


def ledger(frame, pid, cols, b, dims, minimum, pos):
    """{pid: {'all': [...], 'down.1': [...]}} plus the league's own cells by position."""
    f = frame[cols].copy()
    f['pid'] = pid
    f = f[f.pid.notna()]
    total = f.groupby('pid')[cols].sum()
    keep = set(total.index[total[cols[0]] >= minimum])
    out = {p: {'all': cells(total.loc[p], cols)} for p in keep}
    f['pos'] = f.pid.map(pos)
    lg = {P: {'all': cells(g[cols].sum(), cols)} for P, g in f.groupby('pos')}
    for key in dims:
        if key not in b.columns:
            continue
        f['_b'] = b.loc[f.index, key].values
        x = f[f._b.notna()]
        if not len(x):
            continue
        for (p, bk), row in x.groupby(['pid', '_b'])[cols].sum().iterrows():
            if p in keep and row[cols[0]] > 0:
                out[p]['%s.%s' % (key, bk)] = cells(row, cols)
        for (P, bk), row in x.groupby(['pos', '_b'])[cols].sum().iterrows():
            if row[cols[0]] > 0:
                lg.setdefault(P, {})['%s.%s' % (key, bk)] = cells(row, cols)
    return out, lg


def cells(row, cols):
    return [round(float(row[c]), 2) if c == 'epa' else int(round(float(row[c]))) for c in cols]


def run_season(y):
    ppath = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % y)
    if not os.path.exists(ppath):
        return None
    have = pd.read_parquet(ppath)
    d = have[[c for c in PBP_COLS if c in have.columns]].copy()
    del have
    for c in PBP_COLS:
        if c not in d.columns:
            d[c] = np.nan
    d = d[(d.season_type == 'REG') & d.play_type.isin(['pass', 'run'])
          & (_num(d.qb_kneel).fillna(0) == 0) & (_num(d.qb_spike).fillna(0) == 0) & d.posteam.notna()
          # a two-point try is not a play from scrimmage (see pbp_agg.run_season)
          & (_num(d.two_point_attempt).fillna(0) == 0)]
    if not len(d):
        return None
    fpath = os.path.join(RAW, 'ftn_%d.csv' % y)
    has_ftn = os.path.exists(fpath) and os.path.getsize(fpath) > 1000
    if has_ftn:
        head = pd.read_csv(fpath, nrows=0).columns
        f = pd.read_csv(fpath, usecols=[c for c in FTN_COLS if c in head], low_memory=False)
        f['ftn'] = True
        d = d.merge(f, left_on=['game_id', 'play_id'],
                    right_on=['nflverse_game_id', 'nflverse_play_id'], how='left')
        for c in FTN_COLS[2:]:
            if c not in d.columns:
                d[c] = np.nan
    ppart = os.path.join(RAW, 'part', 'part_%d.csv' % y)
    has_part = os.path.exists(ppart) and os.path.getsize(ppart) > 1000
    if has_part:
        head = pd.read_csv(ppart, nrows=0).columns
        p = pd.read_csv(ppart, usecols=[c for c in PART_COLS if c in head], low_memory=False)
        p = p.rename(columns={'nflverse_game_id': 'pgame'})
        d = d.merge(p, left_on=['game_id', 'play_id'], right_on=['pgame', 'play_id'], how='left')
        for c in PART_COLS[2:]:
            if c not in d.columns:
                d[c] = np.nan
    d = d.reset_index(drop=True)
    b = buckets(d, has_ftn, has_part)

    pl = pd.read_csv(os.path.join(RAW, 'players.csv'), usecols=['gsis_id', 'position'], low_memory=False)
    pmap = {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'HB': 'RB', 'WR': 'WR', 'TE': 'TE'}
    pos = {r.gsis_id: pmap[r.position] for r in pl.itertuples(index=False)
           if isinstance(r.gsis_id, str) and r.position in pmap}

    isdb = _num(d.qb_dropback).fillna(0) == 1
    sack = _num(d.sack).fillna(0)
    comp = _num(d.complete_pass).fillna(0)
    yds = _num(d.yards_gained).fillna(0)
    att = isdb & (d.play_type == 'pass') & (sack == 0)
    # the book's yards: a passer keeps what happens after a lateral, the first receiver
    # does not, and a touchdown is the offense's only when the offense scored it
    pyds = _num(d.passing_yards).where(d.passing_yards.notna(), yds).fillna(0)
    ryds = _num(d.receiving_yards).where(d.receiving_yards.notna(), yds).fillna(0)
    ptd = _num(d.pass_touchdown).fillna(0)
    rtd = _num(d.rush_touchdown).where(d.rush_touchdown.notna(), _num(d.touchdown)).fillna(0)

    q = pd.DataFrame({
        'n': 1.0, 'epa': _num(d.qb_epa).fillna(0), 'succ': _num(d.success).fillna(0),
        'att': att.astype(float), 'cmp': comp.where(att, 0.0), 'yds': pyds.where(att & (comp == 1), 0.0),
        'td': ptd.where(att, 0.0),
        'int': _num(d.interception).fillna(0), 'sk': sack})[isdb]
    qpid = d.passer_player_id.where(d.passer_player_id.notna(), d.rusher_player_id)[isdb]
    qd = [k for k, _, _, who in DIMS if 'q' in who]

    isrun = (d.play_type == 'run') & d.rusher_player_id.notna()
    r = pd.DataFrame({
        'n': 1.0, 'epa': _num(d.epa).fillna(0), 'succ': _num(d.success).fillna(0), 'yds': yds,
        'td': rtd, 'fd': _num(d.first_down).fillna(0)})[isrun]
    rd = [k for k, _, _, who in DIMS if 'r' in who]

    ist = att & d.receiver_player_id.notna()
    t = pd.DataFrame({
        'n': 1.0, 'epa': _num(d.epa).fillna(0), 'succ': _num(d.success).fillna(0), 'rec': comp,
        'yds': ryds.where(comp == 1, 0.0), 'td': ptd.where(comp == 1, 0.0),
        'fd': _num(d.first_down).fillna(0).where(comp == 1, 0.0)})[ist]
    td_ = [k for k, _, _, who in DIMS if 't' in who]

    out = dict(s=y, week=int(_num(d.week).max()))
    lg = {}
    for key, frame, pid, dims in (('q', q, qpid, qd), ('r', r, d.rusher_player_id[isrun], rd),
                                  ('t', t, d.receiver_player_id[ist], td_)):
        rows, lgk = ledger(frame, pid, list(frame.columns), b, dims, MIN[key], pos)
        out[key] = rows
        lg[key] = lgk
    out['lg'] = lg
    used = set()
    for key in ('q', 'r', 't'):
        for cellmap in out[key].values():
            used.update(k.split('.')[0] for k in cellmap)
    out['dims'] = [[k, label, bks, who] for k, label, bks, who in DIMS if k in used]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, '%d.json' % y), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    return {k: len(out[k]) for k in ('q', 'r', 't')}, [x[0] for x in out['dims']]


def main():
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        print(y, run_season(y), flush=True)
    # the page asks this which seasons have splits at all
    have = sorted(int(n[:-5]) for n in os.listdir(OUT) if n[:-5].isdigit() and n.endswith('.json'))
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump(dict(seasons=have), fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
