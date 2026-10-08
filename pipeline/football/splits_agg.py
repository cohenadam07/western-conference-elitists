"""Situational splits -> public/football-splits/<season>.json.

A season line says what a man did. It does not say when. Two quarterbacks with the same
expected points per dropback can be opposites: one fine on first down and lost on third,
one ordinary until the fourth quarter. Every number on a card is the average of a few
hundred plays, and this cuts the same plays the other way - by down, distance, field
position, quarter, score, and whatever the charting crews wrote down about the play.

Three kinds of play, each with its own counted line:

  qb    a dropback (pass, sack or scramble), credited to the passer
        [dropbacks, EPA, successes, attempts, completions, yards, TD, INT, sacks, air yards]
  rush  a carry, scrambles included, as the box score counts them
        [carries, EPA, successes, yards, TD, first downs, stuffs]
  rec   a target
        [targets, EPA, successes, catches, yards, TD, air yards, yards after catch, first downs]

Everything stored is a count or a sum, never a rate. The page divides, which means it can
also add: two splits put together are the sum of their lists.

Where each split comes from decides which seasons have it:

  play-by-play (1999 on)   down, distance, field position, quarter, score, home/away,
                           division game, roof, half of the season, shotgun, no-huddle,
                           direction; target depth from 2006
  FTN charting (2022 on)   play-action, blitz, motion, out of the pocket, screens, RPO,
                           men in the box. Posted weekly, so these are live in season.
  participation (2016 on)  pressure and time to throw; personnel grouping; man or zone
                           and the coverage shell from 2018. Published after the season,
                           so these only exist for seasons that are over.

A split is only written if the season has it, and a player only if he has enough plays of
that kind to be worth cutting up (FLOOR). The league's line for each position is written
alongside (`lg`), so a card can say "0.21 on third down, where quarterbacks average 0.02".

Output:
  {s, dims:[{k, label, kinds:[...], vals:[[value, label], ...], src}],
   cols:{qb:[...], rush:[...], rec:[...]},
   lg:{QB:{qb:{dim:{value:[...]}}}, RB:{rush:..., rec:...}, WR:{rec:...}, TE:{rec:...}},
   p:{gsis_id:{pos, qb?:{dim:{value:[...]}}, rush?:..., rec?:...}}}
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env
import numpy as np
import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_SPLITS', os.path.join('..', '..', 'public', 'football-splits'))

FLOOR = {'qb': 15, 'rush': 12, 'rec': 10}
COLS = {
    'qb': ['db', 'epa', 'succ', 'att', 'cmp', 'yds', 'td', 'int', 'sack', 'ay'],
    'rush': ['car', 'epa', 'succ', 'yds', 'td', 'fd', 'stuff'],
    'rec': ['tgt', 'epa', 'succ', 'rec', 'yds', 'td', 'ay', 'yac', 'fd'],
}
ALLK = ['qb', 'rush', 'rec']
PASSK = ['qb', 'rec']

# key, label, kinds, [(value, label)], source
DIMS = [
    ('all', 'All plays', ALLK, [('all', 'Every play')], 'pbp'),
    ('down', 'Down', ALLK, [('1', '1st down'), ('2', '2nd down'), ('3', '3rd down'), ('4', '4th down')], 'pbp'),
    ('togo', 'Yards to go', ALLK, [('s', '1 to 3 to go'), ('m', '4 to 6 to go'), ('l', '7 to 10 to go'),
                                   ('x', '11 or more to go')], 'pbp'),
    ('zone', 'Field position', ALLK, [('own', 'Own side of the field'), ('mid', "Opponent's 49 to 21"),
                                      ('rz', 'Red zone, 20 to 11'), ('gl', 'Inside the 10')], 'pbp'),
    ('qtr', 'Quarter', ALLK, [('1', '1st quarter'), ('2', '2nd quarter'), ('3', '3rd quarter'),
                              ('4', '4th quarter'), ('ot', 'Overtime')], 'pbp'),
    ('score', 'Score', ALLK, [('up9', 'Leading by 9 or more'), ('up', 'Leading by 1 to 8'), ('tie', 'Tied'),
                              ('dn', 'Trailing by 1 to 8'), ('dn9', 'Trailing by 9 or more')], 'pbp'),
    ('site', 'Home or away', ALLK, [('home', 'At home'), ('away', 'On the road')], 'pbp'),
    ('div', 'Opponent', ALLK, [('div', 'Division games'), ('non', 'Everybody else')], 'pbp'),
    ('roof', 'Roof', ALLK, [('out', 'Outdoors'), ('in', 'Indoors')], 'pbp'),
    ('part', 'Part of the season', ALLK, [('h1', 'Weeks 1 to 9'), ('h2', 'Week 10 on')], 'pbp'),
    ('gun', 'Formation', ALLK, [('gun', 'Shotgun'), ('uc', 'Under center')], 'pbp'),
    ('hud', 'Tempo', ALLK, [('nh', 'No huddle'), ('hud', 'Huddled')], 'pbp'),
    ('loc', 'Direction', ALLK, [('l', 'Left'), ('m', 'Middle'), ('r', 'Right')], 'pbp'),
    ('depth', 'Throw depth', PASSK, [('b', 'Behind the line'), ('s', '0 to 9 yards'), ('m', '10 to 19 yards'),
                                     ('d', '20 yards or more')], 'pbp'),
    ('pa', 'Play-action', PASSK, [('y', 'Play-action'), ('n', 'Straight dropback')], 'ftn'),
    ('blitz', 'Blitz', PASSK, [('y', 'Five or more rushers'), ('n', 'Four or fewer')], 'ftn'),
    ('motion', 'Motion', ALLK, [('y', 'Motion at the snap'), ('n', 'No motion')], 'ftn'),
    ('pocket', 'Pocket', PASSK, [('out', 'Out of the pocket'), ('in', 'From the pocket')], 'ftn'),
    ('screen', 'Screens', PASSK, [('y', 'Screens'), ('n', 'Everything else')], 'ftn'),
    ('rpo', 'RPO', ['qb', 'rush'], [('y', 'RPO'), ('n', 'Not an RPO')], 'ftn'),
    ('box', 'Men in the box', ['rush'], [('l', 'Six or fewer'), ('n', 'Seven'), ('h', 'Eight or more')], 'ftn'),
    ('press', 'Pressure', PASSK, [('y', 'Under pressure'), ('n', 'Kept clean')], 'part'),
    ('ttt', 'Time to throw', PASSK, [('q', 'Under 2.5 seconds'), ('m', '2.5 to 3.5 seconds'),
                                     ('l', 'Over 3.5 seconds')], 'part'),
    ('mz', 'Man or zone', PASSK, [('man', 'Against man'), ('zone', 'Against zone')], 'part'),
    ('cov', 'Coverage shell', PASSK, [('c0', 'Cover 0'), ('c1', 'Cover 1'), ('c2', 'Cover 2'),
                                      ('2m', '2-man'), ('c3', 'Cover 3'), ('c4', 'Cover 4'),
                                      ('c6', 'Cover 6')], 'part'),
    ('pers', 'Personnel', ALLK, [('11', '11: one back, one tight end'), ('12', '12: one back, two tight ends'),
                                 ('21', '21: two backs, one tight end'), ('13', '13: one back, three tight ends'),
                                 ('10', '10: one back, no tight end'), ('oth', 'Anything else')], 'part'),
]
POS = {'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE'}
COVER = {'COVER_0': 'c0', 'COVER_1': 'c1', 'COVER_2': 'c2', '2_MAN': '2m', 'COVER_3': 'c3',
         'COVER_4': 'c4', 'COVER_6': 'c6'}


def _n(s):
    return pd.to_numeric(s, errors='coerce')


def _col(d, name):
    return d[name] if name in d.columns else pd.Series(np.nan, index=d.index)


def _pick(conds, index):
    """[(mask, label), ...] -> a Series of labels, missing where no mask holds."""
    out = pd.Series([None] * len(index), index=index, dtype=object)
    for mask, label in conds:
        out = out.where(~mask.fillna(False).astype(bool), label)
    return out


def _yn(mask, known, yes='y', no='n'):
    return _pick([(known & ~mask, no), (known & mask, yes)], mask.index)


def personnel(s):
    """'1 RB, 2 TE, 2 WR' (and 2025's longer form, which lists the line too) -> '12'."""
    def one(v):
        if not isinstance(v, str):
            return None
        rb = sum(int(n) for n in re.findall(r'(\d+) (?:RB|FB|HB)\b', v))
        te = sum(int(n) for n in re.findall(r'(\d+) TE\b', v))
        if not re.search(r'\d+ WR\b|\d+ TE\b|\d+ RB\b', v):
            return None
        k = '%d%d' % (rb, te)
        return k if k in ('11', '12', '21', '13', '10') else 'oth'
    return s.map(one)


def frames(y):
    """The season's regular-season plays with every split column attached."""
    ppath = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % y)
    if not os.path.exists(ppath):
        return None, set()
    d = pd.read_parquet(ppath, columns=None, engine='pyarrow')
    d = d[d.season_type == 'REG'].copy()
    have = {'pbp'}

    fpath = os.path.join(RAW, 'ftn_%d.csv' % y)
    if y >= 2022 and os.path.exists(fpath) and os.path.getsize(fpath) > 1000:
        f = pd.read_csv(fpath, low_memory=False)
        keep = ['nflverse_game_id', 'nflverse_play_id', 'is_play_action', 'n_pass_rushers', 'is_motion',
                'is_qb_out_of_pocket', 'is_screen_pass', 'is_rpo', 'n_defense_box']
        f = f[[c for c in keep if c in f.columns]].copy()
        f['_ftn'] = 1.0
        d = d.merge(f, left_on=['game_id', 'play_id'], right_on=['nflverse_game_id', 'nflverse_play_id'],
                    how='left', suffixes=('', '_f'))
        if d._ftn.notna().sum() > 500:
            have.add('ftn')
    ppart = os.path.join(RAW, 'part', 'part_%d.csv' % y)
    if y >= 2016 and os.path.exists(ppart) and os.path.getsize(ppart) > 1000:
        cols = ['nflverse_game_id', 'play_id', 'offense_personnel', 'time_to_throw', 'was_pressure',
                'defense_man_zone_type', 'defense_coverage_type']
        p = pd.read_csv(ppart, usecols=lambda c: c in cols, low_memory=False)
        p = p.rename(columns={'nflverse_game_id': 'game_id'})
        p['_part'] = 1.0
        d = d.merge(p, on=['game_id', 'play_id'], how='left', suffixes=('', '_p'))
        if d._part.notna().sum() > 500:
            have.add('part')
    return d, have


def split_columns(d, have):
    """{dim: Series of value labels}. A dim with no usable column is simply absent."""
    idx = d.index
    S = {}
    S['all'] = pd.Series('all', index=idx, dtype=object)
    dn = _n(d.down)
    S['down'] = _pick([(dn == k, str(k)) for k in (1, 2, 3, 4)], idx)
    tg = _n(d.ydstogo)
    S['togo'] = _pick([(tg <= 3, 's'), ((tg >= 4) & (tg <= 6), 'm'), ((tg >= 7) & (tg <= 10), 'l'),
                       (tg >= 11, 'x')], idx)
    yl = _n(d.yardline_100)
    S['zone'] = _pick([(yl > 50, 'own'), ((yl <= 50) & (yl > 20), 'mid'), ((yl <= 20) & (yl > 10), 'rz'),
                       (yl <= 10, 'gl')], idx)
    q = _n(_col(d, 'qtr'))
    S['qtr'] = _pick([(q == 1, '1'), (q == 2, '2'), (q == 3, '3'), (q == 4, '4'), (q >= 5, 'ot')], idx)
    sd = _n(_col(d, 'score_differential'))
    S['score'] = _pick([(sd >= 9, 'up9'), ((sd >= 1) & (sd <= 8), 'up'), (sd == 0, 'tie'),
                        ((sd <= -1) & (sd >= -8), 'dn'), (sd <= -9, 'dn9')], idx)
    pt = _col(d, 'posteam_type')
    S['site'] = _pick([(pt == 'home', 'home'), (pt == 'away', 'away')], idx)
    dv = _n(_col(d, 'div_game'))
    S['div'] = _pick([(dv == 1, 'div'), (dv == 0, 'non')], idx)
    rf = _col(d, 'roof')
    S['roof'] = _pick([(rf.isin(['outdoors', 'open']), 'out'), (rf.isin(['dome', 'closed']), 'in')], idx)
    wk = _n(d.week)
    S['part'] = _pick([(wk <= 9, 'h1'), (wk >= 10, 'h2')], idx)
    sg = _n(_col(d, 'shotgun'))
    S['gun'] = _pick([(sg == 1, 'gun'), (sg == 0, 'uc')], idx)
    nh = _n(_col(d, 'no_huddle'))
    S['hud'] = _pick([(nh == 1, 'nh'), (nh == 0, 'hud')], idx)
    loc = _col(d, 'pass_location').where(_col(d, 'pass_location').notna(), _col(d, 'run_location'))
    S['loc'] = _pick([(loc == 'left', 'l'), (loc == 'middle', 'm'), (loc == 'right', 'r')], idx)
    ay = _n(_col(d, 'air_yards'))
    if ay.notna().sum() > 500:
        S['depth'] = _pick([(ay < 0, 'b'), ((ay >= 0) & (ay < 10), 's'), ((ay >= 10) & (ay < 20), 'm'),
                            (ay >= 20, 'd')], idx)
    if 'ftn' in have:
        known = d._ftn.notna()
        tf = lambda c: _col(d, c).astype(str).str.upper().isin(['TRUE', '1', '1.0'])
        S['pa'] = _yn(tf('is_play_action'), known)
        nr = _n(_col(d, 'n_pass_rushers')).fillna(0)
        S['blitz'] = _yn(nr >= 5, known & (nr > 0))
        S['motion'] = _yn(tf('is_motion'), known)
        S['pocket'] = _yn(tf('is_qb_out_of_pocket'), known, 'out', 'in')
        S['screen'] = _yn(tf('is_screen_pass'), known)
        S['rpo'] = _yn(tf('is_rpo'), known)
        bx = _n(_col(d, 'n_defense_box')).fillna(0)
        S['box'] = _pick([((bx > 0) & (bx <= 6), 'l'), (bx == 7, 'n'), (bx >= 8, 'h')], idx)
    if 'part' in have:
        wp = _col(d, 'was_pressure')
        prs = wp.astype(str).str.upper().isin(['TRUE', '1', '1.0'])
        if wp.notna().sum() > 500:
            S['press'] = _yn(prs, wp.notna())
        tt = _n(_col(d, 'time_to_throw'))
        if tt.notna().sum() > 500:
            S['ttt'] = _pick([(tt < 2.5, 'q'), ((tt >= 2.5) & (tt <= 3.5), 'm'), (tt > 3.5, 'l')], idx)
        mz = _col(d, 'defense_man_zone_type')
        if mz.notna().sum() > 500:
            S['mz'] = _pick([(mz == 'MAN_COVERAGE', 'man'), (mz == 'ZONE_COVERAGE', 'zone')], idx)
        cv = _col(d, 'defense_coverage_type')
        if cv.notna().sum() > 500:
            S['cov'] = cv.map(COVER).where(cv.notna(), None).astype(object)
        pr = personnel(_col(d, 'offense_personnel'))
        if pr.notna().sum() > 500:
            S['pers'] = pr
    return S


def stat_frames(d):
    """{kind: (player id Series, DataFrame of the counted columns)} over the plays that count."""
    out = {}
    for c in ('qb_dropback', 'qb_kneel', 'qb_spike', 'qb_scramble', 'sack', 'complete_pass',
              'interception', 'touchdown', 'first_down'):
        d[c] = _n(_col(d, c)).fillna(0)
    epa, succ, yds = _n(d.epa).fillna(0), _n(d.success).fillna(0), _n(d.yards_gained).fillna(0)
    # --- dropbacks, credited to the passer (the scrambler is logged as the rusher)
    m = (d.qb_dropback == 1) & (d.qb_kneel == 0) & (d.qb_spike == 0)
    pid = d.passer_player_id.where(d.passer_player_id.notna(), d.rusher_player_id)
    m = m & pid.notna()
    att = (d.play_type == 'pass') & (d.sack == 0)
    cmp_ = (d.complete_pass == 1) & att
    ptd = (_n(_col(d, 'pass_touchdown')).fillna(0) == 1)
    out['qb'] = (pid[m], pd.DataFrame({
        'db': 1.0, 'epa': _n(_col(d, 'qb_epa')).fillna(epa), 'succ': succ, 'att': att.astype(float),
        'cmp': cmp_.astype(float), 'yds': yds.where(cmp_, 0.0), 'td': ptd.astype(float),
        'int': d.interception, 'sack': d.sack,
        'ay': _n(_col(d, 'air_yards')).fillna(0).where(att, 0.0)}, index=d.index)[m])
    # --- carries, as the box score counts them
    m = (d.play_type == 'run') & (d.qb_kneel == 0) & d.rusher_player_id.notna()
    rtd = (_n(_col(d, 'rush_touchdown')).fillna(0) == 1)
    out['rush'] = (d.rusher_player_id[m], pd.DataFrame({
        'car': 1.0, 'epa': epa, 'succ': succ, 'yds': yds, 'td': rtd.astype(float),
        'fd': d.first_down, 'stuff': (yds <= 0).astype(float)}, index=d.index)[m])
    # --- targets
    m = att & d.receiver_player_id.notna()
    out['rec'] = (d.receiver_player_id[m], pd.DataFrame({
        'tgt': 1.0, 'epa': epa, 'succ': succ, 'rec': cmp_.astype(float), 'yds': yds.where(cmp_, 0.0),
        'td': (ptd & cmp_).astype(float), 'ay': _n(_col(d, 'air_yards')).fillna(0),
        'yac': _n(_col(d, 'yards_after_catch')).fillna(0).where(cmp_, 0.0),
        'fd': d.first_down.where(cmp_, 0.0)}, index=d.index)[m])
    return out


def _row(vals, cols):
    out = []
    for c, v in zip(cols, vals):
        v = float(v)
        out.append(round(v, 2) if c == 'epa' else int(round(v)))
    return out


def run_season(y):
    d, have = frames(y)
    if d is None or not len(d):
        return None
    S = split_columns(d, have)
    kinds = stat_frames(d)
    pl = pd.read_csv(os.path.join(RAW, 'players.csv'), usecols=['gsis_id', 'position'], low_memory=False)
    pos_of = {g: POS.get(str(p).upper()) for g, p in zip(pl.gsis_id, pl.position) if isinstance(g, str)}

    dims_out, players, league = [], {}, {}
    for key, label, dkinds, vals, src in DIMS:
        if key not in S:
            continue
        order = [v for v, _ in vals]
        used = False
        for kind in dkinds:
            pid, st = kinds[kind]
            cols = COLS[kind]
            lab = S[key].reindex(st.index)
            ok = lab.notna() & lab.isin(order)
            if ok.sum() < 200:
                continue
            used = True
            g = st[ok].groupby([pid[ok], lab[ok]])[cols].sum()
            for (gid, val), r in g.iterrows():
                players.setdefault(gid, {}).setdefault(kind, {}).setdefault(key, {})[val] = _row(r.values, cols)
            pos = pid[ok].map(pos_of)
            g = st[ok].groupby([pos, lab[ok]])[cols].sum()
            for (p_, val), r in g.iterrows():
                league.setdefault(p_, {}).setdefault(kind, {}).setdefault(key, {})[val] = _row(r.values, cols)
        if used:
            dims_out.append(dict(k=key, label=label, kinds=dkinds, vals=[list(v) for v in vals], src=src))

    out_p = {}
    for gid, kd in players.items():
        keep = {k: v for k, v in kd.items() if v.get('all', {}).get('all', [0])[0] >= FLOOR[k]}
        if keep:
            keep['pos'] = pos_of.get(gid)
            out_p[gid] = keep
    # the league's line only for the pairings that mean something
    lg = {}
    for p_, kinds_ok in (('QB', ('qb', 'rush')), ('RB', ('rush', 'rec')), ('WR', ('rec',)), ('TE', ('rec',))):
        if p_ in league:
            lg[p_] = {k: league[p_][k] for k in kinds_ok if k in league[p_]}
    out = dict(s=y, dims=dims_out, cols=COLS, floor=FLOOR, lg=lg, p=out_p)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, '%d.json' % y)
    body = json.dumps(out, separators=(',', ':'), allow_nan=False)
    if not (os.path.exists(path) and open(path).read() == body):
        with open(path, 'w') as f:
            f.write(body)
    return dict(players=len(out_p), dims=len(dims_out), kb=len(body) // 1024, src=sorted(have))


def write_index():
    have = sorted(int(n[:-5]) for n in os.listdir(OUT) if n[:-5].isdigit() and n.endswith('.json'))
    body = json.dumps(dict(seasons=have), separators=(',', ':'))
    path = os.path.join(OUT, 'index.json')
    if not (os.path.exists(path) and open(path).read() == body):
        with open(path, 'w') as f:
            f.write(body)


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        r = run_season(y)
        print(y, 'no play-by-play on disk - skipped' if r is None else r, flush=True)
    if os.path.isdir(OUT):
        write_index()
