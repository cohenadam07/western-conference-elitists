#!/usr/bin/env python3
"""Savant value: who has been the best at each position, in points.

The All-Savant Team used to be picked on the plain average of five hand-chosen percentiles.
That treats a stat that is mostly the player's (a receiver's share of first-read targets)
exactly like one that is mostly his teammates' or luck (a back's success rate, a corner's
passer rating allowed), it has no place for how much a man has actually played, and in a
season in progress it leaned on last year. This stage replaces it with one number per
qualified player-season, `sav`: expected points added above a replacement-level player at
his position, this season, on what is his.

It is built in five steps. Only the first is a judgement; the rest is measured.

1. THE JOB. Each position's work is split into a few facets (a quarterback: passing,
   designed runs; a corner: coverage, ball production, flags, run support) and every stat
   that measures quality in that facet is listed under it (FACETS below). Style and usage
   rows (depth of target, time to throw, box counts) are left out: they say how, not how well.

2. HOW MUCH OF A STAT IS LUCK. Every qualified player-season's games are dealt alternately
   into two piles and the stat is rebuilt on each (fit_k), each pile read against its own
   season and position. Where the piles agree the stat is telling the truth at that sample;
   r = n / (n + K) gives the sample K at which it is half truth. In use, a stat is pulled
   toward the position's average by n / (n + K): toward average, never toward last year. A
   stat with no game-by-game history borrows the K of its twin (opponent-adjusted EPA from
   plain EPA), or else its own site sample line scaled by how far the measured K's in its
   facet run from theirs (never below that line; from the facet's per-play stats where it
   has no per-game ones measured, and the other way about).

3. HOW MUCH OF A STAT IS HIS. Two correlations over 1999-2024, both on where a man stood
   in his own season and position (so that the league's drift, and the gap between a tackle
   and a centre, are not mistaken for something that follows a player): this season
   against next for players who stayed put, and for players who changed teams (corrected
   for movers being a narrower group, and steadied toward the stayers' figure where movers
   are few). A stat
   that does not follow a man to a new team is mostly the team's. A stat's weight inside
   its facet is that carry-over times how closely the stat tracks the facet's points the
   same season; a stat with no measured carry-over gets no weight. The same measurement on
   the facet's composite gives its credit: of the part that repeats, the share that follows
   the player. (One facet cannot be asked: no quarterback who runs by design has changed
   teams as a starter from one season to the next. His designed runs take the credit
   measured for a back's carries.)

4. WHAT A FACET IS WORTH. Each facet has an anchor in expected points a game (EPA on his
   dropbacks, pressures and sacks at their measured cost, yards allowed in coverage at the
   going rate per yard, flags by type). The spread of that anchor across full-time players
   is what one unit of the facet is worth. POINTS holds the conversions, measured on
   2018-2024 play-by-play. Worth, and how the stats in a facet move together, are learned
   on 2013 on, where snap counts say who was full-time.

5. THIS SEASON, ON THE FIELD. Inside one season and one position's qualified pool (eight men
   at least): each stat is standardised, clipped at three deviations, pulled toward average
   (step 2); a facet's composite is the weighted sum over the stats he has, divided by the
   spread that sum would have from the stats' own correlations (0.3 assumed for a pair
   never seen together), times how much of the whole facet those stats see (the
   correlation of the part with the whole: a season with sacks and no pressures moves a
   pass rusher less far from average), so one unit means the same in every era. He needs
   30% of the weight of the stats that season tracks; a facet he has no numbers for at all
   counts as average. Points a game are credit x worth x composite, added over facets. A
   replacement player is the 25th-percentile man at the position that season (nearest
   rank). The value
   is his points a game above that, times the games' worth of his unit's snaps he has
   played. Before 2013 there are no snap counts, and a man's share of snaps when active is
   taken as the usual one at his position. Missed games cost him; so does a part-time role.

A lineman is only valued where a season has blocking numbers for him (2016 on, the season in
progress included). Even there most of his value is his line's play while he was on the
field: nothing free says who lost a block.

    python3 award.py fit [archive.json [weekly dir]]   learn -> award_weights.json
    python3 award.py apply file.json [...]             stamp `sav` and `savb` into built files
    python3 award.py show file.json 2025               print the teams it picks

build.py calls stamp() on what it has built, so the archive and the twice-daily refresh both
carry the number and the page only has to read it. award_weights.json is committed; a
refresh or a rebuild applies it and never relearns it.
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, 'award_weights.json')
FIT_FROM, FIT_TO = 1999, 2024        # 2025 is held out: it is the test, not the lesson
SNAP_FROM = 2013                     # snap counts: who was full-time is known from here
REPLACEMENT_PCT = 25                 # of qualified players at the position, that season
MIN_POOL = 8                         # a position needs this many qualified men to be valued
R_DEFAULT = 0.3                      # two stats never seen together are assumed mildly alike
C0, RHO0 = 40.0, 0.7                 # steadying a movers' correlation toward the stayers'
CREDIT0, LAM = 0.7, 0.03             # where almost nothing repeats, lean on the usual share

# Expected points per event, measured on 2018-2024 regular-season play-by-play (two-point
# tries out). A pressure is a pressured dropback against a clean one; a sack is its cost
# beyond an ordinary pressure; a run stop and an incompletion are against the average play.
POINTS = {
    'pressure': 0.26, 'sack': 1.77, 'run_stop': 0.56, 'interception': 4.59,
    'pass_defended': 1.00, 'pass_yard': 0.12, 'rush_yard': 0.11, 'dropback': 0.04,
    # flags, by what they usually cost: a jump is cheap, a hit on the quarterback is not
    'offside': 0.66, 'roughing': 1.77, 'def_flag': 1.00, 'cov_flag_yard': 0.127,
    'false_start': 0.62, 'holding': 0.97, 'off_flag': 0.84,
}

GROUP = {'OT': 'OL', 'OG': 'OL', 'OC': 'OL', 'OL': 'OL'}


def group(pos):
    return GROUP.get(pos, pos)


# --------------------------------------------------------------------------- the anchors
def _pg(d, key, m):
    g = m.get('g') or 0
    v = d.get(key)
    return v / g if g and v is not None else None


def _mul(*xs):
    out = 1.0
    for x in xs:
        if x is None:
            return None
        out *= x
    return out


def _sum(*xs):
    return None if any(x is None for x in xs) else sum(xs)


def _neg(x):
    return None if x is None else -x


def _flags(m, a, pa, b, pb, rest):
    """Points a game given away in flags: two named kinds at their own cost, the rest at theirs."""
    pen = m.get('pen')
    if pen is None:
        return None
    x, y = m.get(a) or 0.0, m.get(b) or 0.0
    return x * pa + y * pb + max(0.0, pen - x - y) * rest


P = POINTS


# What a facet is worth is the spread, across full-time players, of an anchor in expected
# points a game, higher always the better. Two kinds. A COUNT is his own events at their
# measured cost (pressures and sacks, picks and passes defended, flags). A RATE is a
# per-play number taken at a typical workload (EPA per dropback over an ordinary game's
# dropbacks), so that a busy offense is not mistaken for a good one.
def _count(fn):
    return ('count', fn)


def _rate(rate, vol, pts=1.0):
    return ('rate', rate, vol, pts)


ANCHOR = {
    'QB.pass': _rate(lambda m, d: m.get('epadb'), lambda m, d: _pg(d, 'db', m)),
    # designed runs only: a scramble is a dropback and is already inside EPA per dropback
    'QB.run': _count(lambda m, d, k: m.get('desepa')),
    'RB.rush': _rate(lambda m, d: m.get('epacar'), lambda m, d: m.get('car')),
    'RB.rec': _count(lambda m, d, k: _mul(m.get('epatgt'), m.get('tgt'))),
    # a target earned is worth what a target to that position returns beyond an ordinary
    # dropback; what he does with one is its EPA over a typical workload of targets
    'REC.earn': _count(lambda m, d, k: _mul(m.get('tgt'), k['e_tgt'])),
    'REC.eff': _rate(lambda m, d: m.get('epatgt'), lambda m, d: m.get('tgt')),
    'REC.prod': _count(lambda m, d, k: _mul(m.get('recy'), P['pass_yard'])),
    'OL.pp': _rate(lambda m, d: _neg(_sum(_mul(m.get('prsallow'), P['pressure'] / 100.0),
                                          _mul(m.get('sackallow'), P['sack'] / 100.0))),
                   lambda m, d: m.get('pblkg')),
    'OL.run': _rate(lambda m, d: m.get('ypcon'), lambda m, d: m.get('rblkg'), P['rush_yard']),
    'OL.gap': _rate(lambda m, d: m.get('gapypc'), lambda m, d: _pg(d, 'gaprun', m), P['rush_yard']),
    'OL.flags': _count(lambda m, d, k: _neg(_flags(m, 'fsg', P['false_start'], 'holdg', P['holding'], P['off_flag']))),
    'D.rush': _count(lambda m, d, k: _sum(_mul(m.get('prss'), P['pressure']), _mul(m.get('sk'), P['sack']))),
    'D.run': _count(lambda m, d, k: _mul(m.get('rstop'), P['run_stop'])),
    'D.flags': _count(lambda m, d, k: _neg(_flags(m, 'offsideg', P['offside'], 'rtpg', P['roughing'], P['def_flag']))),
    'D.cov': _rate(lambda m, d: _neg(m.get('ycovsnap')), lambda m, d: _pg(d, 'dpsnap', m), P['pass_yard']),
    'D.covt': _rate(lambda m, d: _neg(m.get('yptall')), lambda m, d: m.get('ctgt'), P['pass_yard']),
    'D.ball': _count(lambda m, d, k: _sum(_mul(m.get('int'), P['interception']), _mul(m.get('pd'), P['pass_defended']))),
    'D.covflags': _count(lambda m, d, k: _neg(_mul(m.get('covpenyds'), P['cov_flag_yard']))),
    'K.kick': _count(lambda m, d, k: _mul(m.get('fgoe'), m.get('fga'), 3.0)),
    'P.punt': _rate(lambda m, d: m.get('pepa'), lambda m, d: m.get('punts')),
}
# A kicker's makes and misses are his own: nothing to share out among teammates.
DIRECT = ('K.kick',)


def anchor_value(name, p, consts):
    """The facet's anchor for one row, higher is better: points a game for a count, the
    per-play rate for a rate."""
    kind = ANCHOR[name]
    if kind[0] == 'count':
        return kind[1](p['m'], p['d'], consts)
    return kind[1](p['m'], p['d'])


# --------------------------------------------------------------------------- the jobs
# Each facet: its key, what the page calls it, its anchor, and the stats that measure it (a
# dict fixes the weights instead of learning them). `replaces` names the facets this one
# stands in for in seasons that never tracked the first of them (targets were not charted
# before 2012, so a receiver is read off his production); a stand-in is listed after the
# facets it replaces. `required` means no value at all without it.
# `credit_from` borrows another facet's credit where this one's cannot be measured.
def F(key, label, anchor, stats, replaces=None, required=False, credit_from=None):
    return dict(key=key, label=label, anchor=anchor, stats=stats, replaces=replaces,
                required=required, credit_from=credit_from)


_REC_EARN = ['tgtshr', 'frshr', 'tpps', 'tprs', 'ayshr', 'sep']
_REC_EFF = ['ypt', 'epatgt', 'srtgt', 'croe', 'catch', 'fdtgt', 'ex20rec', 'rattgt', 'yacoe',
            'xyacoe', 'brkrec', 'created', 'dropr', 'ctchhand', 'contestw', 'td3cv', 'dpiyds', 'yprec']
_REC_PROD = ['recy', 'ydshr', 'fdshr', 'tdshr']
_REC = [F('earn', 'Earning targets', 'REC.earn', _REC_EARN),
        F('eff', 'What he does with a target', 'REC.eff', _REC_EFF),
        F('prod', 'Receiving production', 'REC.prod', _REC_PROD, replaces=('earn', 'eff'))]
# per coverage snap for a corner, where being thrown at less is part of the job; per target
# for a safety or a linebacker, so that a deep role is not mistaken for tight coverage.
# (What the fit makes of a safety's: almost nothing. Little of it follows him to a new
# team, and the stat that carries most of the weight, passer rating allowed, needs about a
# thousand targets to settle where a season has forty, so his coverage part stays within a
# point of average.)
_COV = ['ycovsnap', 'ycs', 'yptall', 'cmpall', 'ratall', 'yacall', 'tdall', 'tkyac', 'ctgtcov', 'dpepaoo']
_COVT = ['yptall', 'cmpall', 'ratall', 'yacall', 'tkyac']
_BALL = ['int', 'pd', 'ballrate', 'ff']
_RUSH = ['prsspass', 'prsssnap', 'prss', 'prsshr', 'hrry', 'qbkd', 'hits', 'prod', 'sk', 'sksnap',
         'skpass', 'bats', 'stripsk', 'ff']
_RUND = ['rstop', 'rstoprate', 'tfl', 'tflsnap', 'rtkdepth', 'mtklpct', 'tklsnap', 'havoc', 'drsoo']
_FRONT = [F('rush', 'Pass rush', 'D.rush', _RUSH),
          F('run', 'Run defense', 'D.run', _RUND),
          F('flags', 'Staying clean', 'D.flags', ['pen', 'offsideg', 'rtpg'])]

FACETS = {
    'QB': [
        F('pass', 'Passing', 'QB.pass',
          ['epadb', 'epadbadj', 'anya', 'srdb', 'ypa', 'fddb', 'qbr', 'epadbng', 'comp', 'cpoe',
           'ngscpoe', 'cmppct', 'ontgt', 'badthrow', 'catchable', 'td3conv', 'rztd', 'ppd', 'tddrv',
           'to3', 'sackpct', 'p2s', 'faultsack', 'intpct', 'twrate', 'iwrate']),
        # Not yards per designed run: a sneak gains a yard and is worth a first down, so that
        # row measures what kind of runs he is given more than how good he is at them.
        # No quarterback who runs by design changed teams between two seasons as a starter
        # in the years learned on (the hundred or so who did move top out at one point a
        # game, and for them the number is noise), so "does it follow him" cannot be asked
        # here. The credit is the one measured for the same act, a back's carries.
        F('run', 'Designed runs', 'QB.run', ['desepa', 'snkconv', 'syconv'], credit_from=('RB', 'rush')),
    ],
    'RB': [
        F('rush', 'Running', 'RB.rush',
          ['epacar', 'epacaradj', 'srcar', 'ypc', 'ryoe', 'ropct', 'yacr', 'brkrate', 'stuff', 'ex10',
           'ex20', 'fdcar', 'syconv', 'rztdcar', 'fumrate', 'rushy']),
        F('rec', 'Receiving', 'RB.rec',
          ['tgtshr', 'frshr', 'tpps', 'ypps', 'recy', 'ypt', 'epatgt', 'srtgt', 'croe', 'yacoe',
           'xyacoe', 'brkrec', 'fdtgt', 'dropr', 'yprec']),
    ],
    'WR': _REC,
    'TE': _REC,
    'OL': [
        F('pp', 'Pass protection on his snaps', 'OL.pp',
          ['prsallow', 'prsallowc', 'sackallow', 'hitallow', 'epadbon', 'srdbon', 'prsoo', 'epaoo'],
          required=True),
        F('run', 'Run game on his snaps', 'OL.run', ['srrunon', 'ypcon', 'stuffon', 'sroo']),
        F('gap', 'Runs to his gap', 'OL.gap', ['gapsr', 'gapypc', 'gapstuff']),
        F('flags', 'Staying clean', 'OL.flags', ['pen100', 'fsg', 'holdg', 'penydg', 'penstall']),
    ],
    'ED': _FRONT,
    'DI': _FRONT,
    'LB': [
        F('run', 'Run defense', 'D.run', _RUND),
        F('cov', 'Coverage', 'D.covt', _COVT),
        F('ball', 'Ball production', 'D.ball', _BALL),
        F('rush', 'Pass rush', 'D.rush', ['prsspass', 'prss', 'hrry', 'qbkd', 'hits', 'sk', 'skpass']),
        F('flags', 'Staying clean', 'D.flags', ['pen', 'covpen', 'offsideg', 'rtpg']),
    ],
    'CB': [
        F('cov', 'Coverage', 'D.cov', _COV),
        F('ball', 'Ball production', 'D.ball', _BALL),
        F('flags', 'Staying clean', 'D.covflags', ['covpen', 'covpenyds', 'pen']),
        F('run', 'Run support and tackling', 'D.run', ['rstop', 'rstoprate', 'tfl', 'tflsnap', 'rtkdepth', 'mtklpct']),
    ],
    'S': [
        F('cov', 'Coverage', 'D.covt', _COVT),
        F('ball', 'Ball production', 'D.ball', _BALL),
        F('run', 'Run support and tackling', 'D.run', ['rstop', 'rstoprate', 'tfl', 'tflsnap', 'rtkdepth', 'mtklpct', 'tklsnap']),
        F('flags', 'Staying clean', 'D.covflags', ['covpen', 'covpenyds', 'pen']),
    ],
    'K': [F('kick', 'Kicking', 'K.kick', {'fgoe': 1.0, 'patpct': 0.2})],
    'P': [F('punt', 'Punting', 'P.punt', ['pepa', 'pnet', 'pin20', 'ptb', 'pretyds', 'pretr'])],
}
GROUPS = list(FACETS)
LABEL = {(g, f['key']): f['label'] for g, fs in FACETS.items() for f in fs}

# A stat with no game-by-game history takes the luck of its twin, where the two are counted
# over the same sample.
SIBLING = {'epacaradj': 'epacar', 'epadbadj': 'epadb', 'comp': 'epadb', 'qbr': 'epadb',
           'ngscpoe': 'cpoe', 'prsallow': 'prsallowc', 'prsoo': 'prsallowc', 'epaoo': 'epadbon',
           'sroo': 'srrunon', 'yacoe': 'xyacoe', 'ryoe': 'ypc', 'ropct': 'srcar',
           'dpepaoo': 'ycovsnap', 'drsoo': 'rstoprate'}


# --------------------------------------------------------------------------- small maths
def corr(a, b):
    n = len(a)
    if n < 3:
        return None
    ma = sum(a) / n
    mb = sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va <= 0 or vb <= 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def sd(v):
    n = len(v)
    if n < 2:
        return 0.0
    mu = sum(v) / n
    return math.sqrt(sum((x - mu) ** 2 for x in v) / n)


def median(v):
    v = sorted(v)
    n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0)


def carry(stay, move):
    """(stayers' r, movers' r) from this season to the next.

    Men who change teams are not a fair sample of the position: they are older and more
    alike, and a correlation taken on a narrower group reads low. The movers' figure is put
    on the spread of everyone in the comparison (Thorndike's case 2) and then, because
    movers are few, pulled toward 0.7 of the stayers' figure."""
    rs = corr(*stay) if len(stay[0]) >= 25 else None
    rm = corr(*move) if len(move[0]) >= 15 else None
    nm = 0
    if rm is not None:
        nm = len(move[0])
        s_all, s_mv = sd(stay[0] + move[0]), sd(move[0])
        if s_mv > 0 and s_all > 0:
            u = s_all / s_mv
            rm = rm * u / math.sqrt(1.0 - rm * rm + rm * rm * u * u)
    if rs is None and rm is None:
        return None, None
    prior = RHO0 * rs if rs is not None else rm
    return rs, ((nm * rm if rm is not None else 0.0) + C0 * prior) / (nm + C0)


def thr_of(M, key, pos):
    m = M.get(key) or {}
    t = (m.get('thrp') or {}).get(pos) if isinstance(m.get('thrp'), dict) else None
    return t if t is not None else (m.get('thr') or 0)


def sample_of(M, key, p):
    m = M.get(key) or {}
    den = m.get('den')
    if not den:
        return None
    if den == 'g':
        return p['m'].get('g')
    return p['d'].get(den)


def enough(M, key, p):
    """Is this row's sample big enough to learn from? A per-game stat asks for most of a
    season, never more: an interception's own line is two seasons of games, which nobody has."""
    T = thr_of(M, key, p['pos'])
    if not T:
        return True
    if (M.get(key) or {}).get('den') == 'g':
        T = min(T, 16)
    n = sample_of(M, key, p)
    return n is not None and n >= 0.6 * T


def time_share(p, shares=None):
    """The share of his unit's snaps this season that he has been on the field for.
    Before snap counts (2013) his share when active is taken as the usual one at his position."""
    m = p['m']
    a = m.get('avail')
    a = 1.0 if a is None else a / 100.0
    if p['pos'] in ('K', 'P'):
        return min(1.0, a)
    s = m.get('snapshr')
    if s is None:
        s = 100.0 * ((shares or {}).get(p['pos']) or (shares or {}).get(group(p['pos'])) or 1.0)
    return min(1.0, a * s / 100.0)


def team_games(p):
    m = p['m']
    g = m.get('g') or 0
    a = m.get('avail')
    return g * 100.0 / a if a else g


# --------------------------------------------------------------------------- one season
def zscores(pool, M, keys, K=None, shrink=True):
    """{stat: {id: z}} for one position's qualified pool in one season: standardised, sign
    turned so higher is better, clipped at three, and (with shrink) pulled toward zero by
    n / (n + K)."""
    out = {}
    K = K or {}
    for k in keys:
        vals = [(p, p['m'].get(k)) for p in pool]
        vals = [(p, v) for p, v in vals if v is not None]
        if len(vals) < MIN_POOL:
            continue
        xs = [v for _, v in vals]
        mu = sum(xs) / len(xs)
        s = sd(xs)
        if s <= 0:
            continue
        sign = -1.0 if (M.get(k) or {}).get('lower') else 1.0
        zk = {}
        for p, v in vals:
            z = max(-3.0, min(3.0, (v - mu) / s)) * sign
            if shrink:
                kk = K.get(k)
                if kk is None:
                    kk = thr_of(M, k, p['pos'])
                n = sample_of(M, k, p)
                if kk and n is not None:
                    z *= n / (n + kk)
            zk[p['id']] = z
        out[k] = zk
    return out


def _cov(a, ks, ls, R):
    """Covariance of two weighted sums of standardised stats, from the stats' correlations
    with each other (learned once, on history; R_DEFAULT for a pair never seen together)."""
    q = 0.0
    for k in ks:
        rk = R.get(k) or {}
        for l in ls:
            q += a[k] * a[l] * (1.0 if k == l else rk.get(l, R_DEFAULT))
    return q


def _unit(a, have, R):
    """(spread of the weighted sum over the stats he has, how much of the whole facet that
    sum sees). The first makes one unit of a facet mean the same whichever of its stats a
    season tracked. The second is the correlation between the part and the whole: sacks
    alone say less about a pass rush than sacks, pressures and hits together, so a season
    that has only sacks moves a man less far from average on it."""
    ind = sum(a[k] ** 2 for k in have)
    var = _cov(a, have, have, R)
    if len(have) == len(a):
        return math.sqrt(var if var > 0.25 * ind else ind), 1.0
    ind_all = sum(w * w for w in a.values())
    whole = _cov(a, a, a, R)
    if var <= 0.25 * ind or whole <= 0.25 * ind_all:
        # correlations that cannot all be true together: fall back on none at all
        return math.sqrt(ind), math.sqrt(ind / ind_all)
    return math.sqrt(var), max(0.0, min(1.0, _cov(a, have, a, R) / math.sqrt(var * whole)))


def facet_scores(pool, M, spec, shrink=True, seen=None):
    """{facet: {id: composite}}: each stat's z weighted by how much of the stat is his and
    how much it says about points, on a scale where 1 is one standard deviation among
    full-time players before any pulling toward average. `seen`, if given, is filled with
    {(facet, id): how much of the whole facet his stats see}."""
    keys = sorted({k for f in spec['facets'] for k in f['stats']})
    Z = zscores(pool, M, keys, spec.get('K'), shrink)
    out = {}
    for f in spec['facets']:
        a = {k: w for k, w in f['stats'].items() if w > 0}
        live = [k for k in a if k in Z]
        tot = sum(a[k] for k in live)
        if not live or tot <= 0:
            continue
        R = f.get('R') or {}
        sc = {}
        for p in pool:
            have = [k for k in live if p['id'] in Z[k]]
            if sum(a[k] for k in have) < 0.3 * tot:
                continue
            spread, sees = _unit(a, have, R)
            sc[p['id']] = sum(a[k] * Z[k][p['id']] for k in have) / spread * sees
            if seen is not None:
                seen[(f['key'], p['id'])] = sees
        if sc:
            out[f['key']] = sc
    return out


def season_values(players, M, W):
    """{id: (value, games' worth of snaps, {facet: points a game against an average man})}."""
    res = {}
    by = {}
    shares = W.get('share')
    for p in players:
        if p.get('qualified'):
            by.setdefault(p['pos'], []).append(p)
    for pos, pool in by.items():
        spec = W['pos'].get(group(pos))
        if not spec or len(pool) < MIN_POOL:
            continue
        F_ = facet_scores(pool, M, spec)
        ppg = {}
        split = {}
        for p in pool:
            pid = p['id']
            tot = 0.0
            parts = {}
            ok = True
            for f in spec['facets']:
                sc = F_.get(f['key'], {}).get(pid)
                if sc is None or not f['worth']:
                    if f.get('required'):
                        ok = False
                    continue
                rp = f.get('replaces')
                if rp:
                    if rp[0] in parts:
                        continue                 # the real thing was tracked: no stand-in
                    for o in rp:
                        tot -= parts.pop(o, 0.0)
                pts = f['credit'] * f['worth'] * sc
                parts[f['key']] = pts
                tot += pts
            if parts and ok:
                ppg[pid] = tot
                split[pid] = parts
        if len(ppg) < MIN_POOL:
            continue
        srt = sorted(ppg.values())
        repl = srt[int(math.floor((len(srt) - 1) * REPLACEMENT_PCT / 100.0 + 0.5))]   # nearest rank
        for p in pool:
            pid = p['id']
            if pid not in ppg:
                continue
            games = time_share(p, shares) * team_games(p)
            res[pid] = ((ppg[pid] - repl) * games, games, split[pid])
    return res


def stamp(doc, W=None):
    """Write `sav` (the value) and `savb` (where it came from) into every qualified row."""
    W = W or load_weights()
    if not W:
        raise SystemExit('award.py: %s is missing. It is committed with the pipeline; '
                         'run `python3 award.py fit` to learn it again.' % WEIGHTS)
    M = {m['key']: m for m in doc['cfg']['metrics']}
    n = 0
    for s, blk in doc['data'].items():
        for p in blk['players']:
            p['m'].pop('sav', None)
            p.pop('savb', None)
        vals = season_values(blk['players'], M, W)
        for p in blk['players']:
            v = vals.get(p['id'])
            if not v:
                continue
            # (+ 0.0 turns the -0.0 a rounding can leave into a plain zero)
            p['m']['sav'] = round(v[0], 2) + 0.0
            p['savb'] = [[k, round(x * v[1], 2) + 0.0] for k, x in v[2].items()]
            n += 1
    doc['cfg']['award'] = describe(W)
    return n


def describe(W):
    """What the page needs to explain a pick: the facets, their labels and their shares."""
    out = {'replacement': REPLACEMENT_PCT, 'fit': [W.get('from'), W.get('to')], 'pos': {}}
    for g, spec in W['pos'].items():
        out['pos'][g] = [dict({'key': f['key'], 'label': f['label'], 'credit': round(f['credit'], 2),
                               'worth': round(f['worth'], 2),
                               'n': len([1 for a in f['stats'].values() if a > 0])},
                              **({'standin': list(f['replaces'])} if f.get('replaces') else {}))
                         for f in spec['facets']]
    return out


def load_weights():
    if not os.path.exists(WEIGHTS):
        return None
    return json.load(open(WEIGHTS))


# --------------------------------------------------------------------------- the fit
def _in(s, lo=FIT_FROM):
    return lo <= int(s) <= FIT_TO


def fit_k(doc, weekly_dir, M):
    """Split-season reliability of every stat, as the sample K at which it is half truth."""
    acc = {}                    # (grp, stat) -> {(season, position): [pile a, pile b, samples]}
    stats = {g: sorted({k for f in FACETS[g] for k in f['stats']}) for g in GROUPS}
    for s, blk in sorted(doc['data'].items()):
        if not _in(s):
            continue
        sdir = os.path.join(weekly_dir, s)
        if not os.path.isdir(sdir):
            continue
        qual = {p['id']: p for p in blk['players'] if p.get('qualified') and group(p['pos']) in FACETS}
        for fn in sorted(os.listdir(sdir)):
            if not (fn.startswith('pack-') and fn.endswith('.json')):
                continue
            pack = json.load(open(os.path.join(sdir, fn)))
            for pid, e in pack.items():
                p = qual.get(pid)
                if not p or len(e.get('w') or []) < 6:
                    continue
                grp = group(p['pos'])
                ng = len(e['w'])
                em, ed = e.get('m') or {}, e.get('d') or {}
                for k in stats[grp]:
                    vs = em.get(k)
                    if vs is None:
                        continue
                    mk = M.get(k) or {}
                    den = mk.get('den')
                    ns = ed.get(den) if den and den != 'g' else None
                    # a per-game count with nothing to count that day is a zero; a per-game
                    # percentage with no attempts that day is no reading at all
                    blank_is_zero = ns is None and not str(mk.get('unit') or '').startswith('pct')
                    half = []
                    for h in (0, 1):
                        num = tot = 0.0
                        for i in range(h, ng, 2):
                            v = vs[i]
                            if ns is not None:
                                n = ns[i] or 0.0
                                if v is None or n <= 0:
                                    continue
                                num += v * n
                                tot += n
                            elif v is None:
                                if blank_is_zero:
                                    tot += 1.0
                            else:
                                num += v
                                tot += 1.0
                        half.append((num / tot, tot) if tot > 0 else None)
                    if half[0] is None or half[1] is None:
                        continue
                    thr = thr_of(M, k, p['pos'])
                    lo = max(2.0, 0.2 * thr) if (ns is not None and thr) else 3.0
                    if half[0][1] < lo or half[1][1] < lo:
                        continue
                    a = acc.setdefault((grp, k), {}).setdefault((s, p['pos']), [[], [], []])
                    a[0].append(half[0][0])
                    a[1].append(half[1][0])
                    a[2].append((half[0][1] + half[1][1]) / 2.0)
    out, how = {}, {}
    for (grp, k), cells in acc.items():
        # Each pile is measured against its own season and position, because that is how
        # the stat is used. Left raw, the league's drift passes for skill: every punter's
        # two halves of 2023 agree that punts go further than they did in 2003.
        a, b, ns = [], [], []
        for xa, xb, xn in cells.values():
            if len(xa) < 5:
                continue
            ma, mb = sum(xa) / len(xa), sum(xb) / len(xb)
            a += [v - ma for v in xa]
            b += [v - mb for v in xb]
            ns += xn
        if len(a) < 80:
            continue
        r = corr(a, b)
        if r is None:
            continue
        nbar = sum(ns) / len(ns)
        r = max(r, 0.02)
        out.setdefault(grp, {})[k] = round(min(nbar * (1.0 - r) / r, 49.0 * nbar), 2)
        how.setdefault(grp, {})[k] = [round(r, 3), round(nbar, 1), len(a)]
    return out, how


def fill_k(K, facets, M, pos):
    """A K for every stat that has none: its twin's where they share a sample, else its own
    site line scaled by how far the measured K's in the facet run from theirs."""
    for f in facets:
        ratios = {True: [], False: []}
        for k in f['stats']:
            t = thr_of(M, k, pos)
            if k in K and t:
                ratios[(M.get(k) or {}).get('den') == 'g'].append(K[k] / t)
        for k in f['stats']:
            if k in K or k not in M:
                continue
            sib = SIBLING.get(k)
            if sib in K and (M.get(sib) or {}).get('den') == M[k].get('den'):
                K[k] = K[sib]
                continue
            t = thr_of(M, k, pos)
            if not t:
                continue
            per_game = M[k].get('den') == 'g'
            r = median(ratios[per_game]) or median(ratios[not per_game])
            if r:
                K[k] = round(t * max(r, 1.0), 2)
    return K


def _pairs(doc, grp):
    """(row this season, row next season, moved?) for qualified men at one position group."""
    idx = {}
    for s, blk in doc['data'].items():
        if not _in(s):
            continue
        for p in blk['players']:
            if p.get('qualified') and group(p['pos']) == grp:
                idx[(p['id'], int(s))] = p
    out = []
    for (pid, y), p in idx.items():
        q = idx.get((pid, y + 1))
        if q:
            moved = p.get('team') != q.get('team') or bool(p.get('tms')) or bool(q.get('tms'))
            out.append((p, q, moved, y))
    return out


def _pools(doc, grp, lo=FIT_FROM):
    for s, blk in doc['data'].items():
        if not _in(s, lo):
            continue
        by = {}
        for p in blk['players']:
            if p.get('qualified') and group(p['pos']) == grp:
                by.setdefault(p['pos'], []).append(p)
        for pos, pool in by.items():
            if len(pool) >= MIN_POOL:
                yield int(s), pos, pool


def fit(doc, weekly_dir=None):
    M = {m['key']: m for m in doc['cfg']['metrics']}
    W = {'from': FIT_FROM, 'to': FIT_TO, 'points': POINTS, 'pos': {}}
    KS, how = fit_k(doc, weekly_dir, M) if weekly_dir and os.path.isdir(weekly_dir) else ({}, {})
    W['split_half'] = how
    # the usual share of snaps at each position, for the seasons before snap counts
    sh = {}
    for s, blk in doc['data'].items():
        if not _in(s, SNAP_FROM):
            continue
        for p in blk['players']:
            if p.get('qualified') and p['m'].get('snapshr') is not None:
                sh.setdefault(p['pos'], []).append(p['m']['snapshr'] / 100.0)
                if group(p['pos']) != p['pos']:
                    sh.setdefault(group(p['pos']), []).append(p['m']['snapshr'] / 100.0)
    W['share'] = shares = {k: round(median(v), 3) for k, v in sh.items() if len(v) >= 50}
    # what a target is worth by position, beyond an ordinary dropback
    consts = {}
    for grp in ('WR', 'TE'):
        num = den = 0.0
        for s, blk in doc['data'].items():
            if not _in(s, 2016):
                continue
            for p in blk['players']:
                if p['pos'] == grp and p.get('qualified') and p['m'].get('epatgt') is not None and p['d'].get('tgt'):
                    num += p['m']['epatgt'] * p['d']['tgt']
                    den += p['d']['tgt']
        consts[grp] = {'e_tgt': round(num / den - POINTS['dropback'], 4)}
    W['consts'] = consts
    for grp in GROUPS:
        pairs = _pairs(doc, grp)
        kc = consts.get(grp, {})
        keys = sorted({k for f in FACETS[grp] for k in f['stats'] if k in M})
        # Everything below is measured the way it is used: against the same season and the
        # same position. Each stat as a standard score inside its pool (nothing pulled
        # toward average yet), and who in the pool was full-time.
        zs, share, pool_of = {}, {}, {}
        for y, pos, pool in _pools(doc, grp):
            for p in pool:
                share[(p['id'], y)] = time_share(p, shares)
                pool_of[(p['id'], y)] = (y, pos)
            for k, zk in zscores(pool, M, keys, None, False).items():
                for pid, v in zk.items():
                    zs.setdefault(k, {})[(pid, y)] = v
        # full-time players since snap counts: what worth and "tells" are learned on
        rows = [(int(s_), p) for s_, blk in doc['data'].items() if _in(s_, SNAP_FROM)
                for p in blk['players'] if p.get('qualified') and group(p['pos']) == grp
                and share.get((p['id'], int(s_)), 0.0) >= 0.5]
        count = {}
        for _, p in rows:
            count[p['pos']] = count.get(p['pos'], 0) + 1
        pos0 = max(sorted(count), key=lambda x: count[x]) if count else grp

        def in_pools(vals):
            """{(id, season): value} -> the same, each less its pool's mean, pools of 8 up."""
            cells = {}
            for key, v in vals.items():
                cells.setdefault(pool_of[key], []).append((key, v))
            out = {}
            for cell in cells.values():
                if len(cell) >= MIN_POOL:
                    mu = sum(v for _, v in cell) / len(cell)
                    for key, v in cell:
                        out[key] = v - mu
            return out

        facets = []
        for fdef in FACETS[grp]:
            anchor, stats = fdef['anchor'], fdef['stats']
            a, own, tells = {}, {}, {}
            fixed = stats if isinstance(stats, dict) else None
            # the facet's points, against the pool, for the men "tells" is read on
            pts = in_pools({(p['id'], y): v for y, p in rows
                            for v in [anchor_value(anchor, p, kc)] if v is not None})
            for k in ([] if fixed else stats):
                if k not in M:
                    continue
                zk = zs.get(k, {})
                stay = ([], [])
                move = ([], [])
                for p, q, moved, y in pairs:
                    x, z = zk.get((p['id'], y)), zk.get((q['id'], y + 1))
                    if x is None or z is None or not enough(M, k, p) or not enough(M, k, q):
                        continue
                    t = move if moved else stay
                    t[0].append(x)
                    t[1].append(z)
                rs, rm = carry(stay, move)
                if fdef['credit_from']:
                    # no movers worth asking (see FACETS): the stayers' figure, at the usual discount
                    rm = None if rs is None else RHO0 * rs
                own[k] = None if rm is None else max(0.0, rm)
                # ...and how much the stat says about the facet's points, the same season
                xs, ys = [], []
                for y, p in rows:
                    x, z = zk.get((p['id'], y)), pts.get((p['id'], y))
                    if x is None or z is None or not enough(M, k, p):
                        continue
                    xs.append(x)
                    ys.append(z)
                v = corr(xs, ys) if len(xs) >= 60 else None
                tells[k] = None if v is None else max(0.0, v)
                # no measured carry-over, or no reading against the points: no weight
                w = (own[k] or 0.0) * (tells[k] or 0.0)
                a[k] = round(w, 4) if w >= 0.02 else 0.0
            if fixed:
                a = dict(fixed)
            f = dict(key=fdef['key'], label=fdef['label'], anchor=anchor, stats=a, credit=1.0, worth=0.0,
                     own={k: (None if v is None else round(v, 3)) for k, v in own.items()},
                     tells={k: (None if v is None else round(v, 3)) for k, v in tells.items()})
            if fdef['replaces']:
                f['replaces'] = list(fdef['replaces'])
            if fdef['required']:
                f['required'] = True
            if fdef['credit_from']:
                f['credit_from'] = list(fdef['credit_from'])
            facets.append(f)
        spec = {'facets': facets, 'K': fill_k(dict(KS.get(grp, {})), facets, M, pos0)}
        # how the stats inside a facet move together, on full-time players since snap counts
        for f in facets:
            ks = [k for k, w in f['stats'].items() if w > 0 and k in zs]
            ft = {k: {key: v for key, v in zs[k].items()
                      if key[1] >= SNAP_FROM and share.get(key, 0.0) >= 0.4} for k in ks}
            R = {}
            for i, k in enumerate(ks):
                for l in ks[i + 1:]:
                    common = [key for key in ft[k] if key in ft[l]]
                    if len(common) < 80:
                        continue
                    r = corr([ft[k][c] for c in common], [ft[l][c] for c in common])
                    if r is not None:
                        R.setdefault(k, {})[l] = round(r, 3)
                        R.setdefault(l, {})[k] = round(r, 3)
            f['R'] = R
        # every season's composites, as they will be used
        comp, sees = {}, {}
        for y, pos, pool in _pools(doc, grp):
            seen = {}
            for fk, sc in facet_scores(pool, M, spec, True, seen).items():
                for pid, v in sc.items():
                    comp[(fk, pid, y)] = v
                    sees[(fk, pid, y)] = seen[(fk, pid)]
        for f in facets:
            # Only seasons that see most of the facet say whether the facet follows a man.
            # Before 2018 a safety's "coverage" is one stat about his tackling after the
            # catch, and whether that repeats says nothing about coverage.
            for floor in (0.7, 0.0):
                stay = ([], [])
                move = ([], [])
                for p, q, moved, y in pairs:
                    a_, b_ = (f['key'], p['id'], y), (f['key'], q['id'], y + 1)
                    x, z = comp.get(a_), comp.get(b_)
                    if x is None or z is None or share.get((p['id'], y), 0) < 0.3 or share.get((q['id'], y + 1), 0) < 0.3:
                        continue
                    if sees[a_] < floor or sees[b_] < floor:
                        continue
                    t = move if moved else stay
                    t[0].append(x)
                    t[1].append(z)
                if len(stay[0]) >= 100 and len(move[0]) >= 40:
                    break
            rs, rm = carry(stay, move)
            f['r_stay'] = None if rs is None else round(rs, 4)
            f['r_move'] = None if rm is None else round(rm, 4)
            f['pairs'] = [len(stay[0]), len(move[0])]
            # The credit: of the part of this facet that repeats from one season to the next,
            # how much follows the man to a new team. Where little repeats even for a man who
            # stays, the ratio is two small numbers and is leaned toward the usual share.
            if f['anchor'] in DIRECT:
                f['credit'] = 1.0
            elif rs is None or rm is None:
                f['credit'] = CREDIT0
            else:
                f['credit'] = round(max(0.05, min(1.0, (max(rm, 0.0) + LAM * CREDIT0) / (max(rs, 0.0) + LAM))), 4)
            # What one unit of the facet is worth: the spread of its anchor, in expected
            # points a game, across full-time players of one position in one season. A rate
            # is taken at the usual workload, so a busy offense is not read as a good one.
            kind = ANCHOR[f['anchor']]
            av, vol = {}, []
            for y, p in rows:
                if kind[0] == 'count':
                    x, v = kind[1](p['m'], p['d'], kc), 1.0
                else:
                    x, v = kind[1](p['m'], p['d']), kind[2](p['m'], p['d'])
                if x is None or v is None:
                    continue
                av[(p['id'], y)] = x
                vol.append(v)
            dev = list(in_pools(av).values())
            f['n'] = len(dev)
            if len(dev) >= 60:
                spread = math.sqrt(sum(x * x for x in dev) / len(dev))
                f['worth'] = round(spread * (sum(vol) / len(vol)) * (kind[3] if kind[0] == 'rate' else 1.0), 4)
        # A stand-in is put on the scale of what it stands in for: on the seasons that have
        # both, the points the real facets give, regressed on the stand-in's composite.
        for f in facets:
            if not f.get('replaces'):
                continue
            real = [g for g in facets if g['key'] in f['replaces']]
            xs, ys = [], []
            for (fk, pid, y), v in comp.items():
                if fk != f['key']:
                    continue
                pts = [comp.get((g['key'], pid, y)) for g in real]
                if any(x is None for x in pts):
                    continue
                xs.append(v)
                ys.append(sum(g['credit'] * g['worth'] * x for g, x in zip(real, pts)))
            if len(xs) >= 200:
                mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                f['credit'] = 1.0
                f['worth'] = round(sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / sum((a - mx) ** 2 for a in xs), 4)
                f['n'] = len(xs)
        W['pos'][grp] = spec
    for spec in W['pos'].values():
        for f in spec['facets']:
            if f.get('credit_from'):
                g, k = f['credit_from']
                f['credit'] = next(x['credit'] for x in W['pos'][g]['facets'] if x['key'] == k)
    return W


# --------------------------------------------------------------------------- command line
# A quick look at the ranking, two deep past each spot. The page's team also keeps the slot
# corner's spot for a slot corner and fills the line as a unit before 2016.
SLOTS = [('QB', 1), ('RB', 1), ('WR', 3), ('TE', 1), ('OT', 2), ('OG', 2), ('OC', 1),
         ('ED', 2), ('DI', 2), ('LB', 2), ('CB', 3), ('S', 2), ('K', 1), ('P', 1)]


def show(doc, season, n_extra=2, shares=None):
    blk = doc['data'][str(season)]
    for pos, n in SLOTS:
        rows = [p for p in blk['players'] if p['pos'] == pos and p['m'].get('sav') is not None]
        rows.sort(key=lambda p: -p['m']['sav'])
        print('%s' % pos)
        for p in rows[:n + n_extra]:
            parts = ', '.join('%s %+.1f' % (LABEL.get((group(pos), k), k), v)
                              for k, v in sorted(p.get('savb', []), key=lambda kv: -kv[1]))
            print('   %-24s %-3s %+6.1f  (on the field %d%%)  %s' % (
                p['name'], p['team'], p['m']['sav'], round(100 * time_share(p, shares)), parts))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd = argv[1]
    pub = os.path.join(HERE, '..', '..', 'public')
    if cmd == 'fit':
        src = argv[2] if len(argv) > 2 else os.path.join(pub, 'football-savant-data.json')
        wk = argv[3] if len(argv) > 3 else os.path.join(pub, 'football-weekly')
        doc = json.load(open(src))
        W = fit(doc, wk)
        json.dump(W, open(WEIGHTS, 'w'), indent=1, sort_keys=True)
        for g, spec in W['pos'].items():
            tot = sum(f['credit'] * f['worth'] for f in spec['facets'] if not f.get('replaces')) or 1.0
            for f in spec['facets']:
                top = sorted(f['stats'].items(), key=lambda kv: -kv[1])[:5]
                print('%-3s %-30s stay %s move %s | credit %.2f x worth %.2f = %.2f (%s) | %s' % (
                    g, f['label'], f['r_stay'], f['r_move'], f['credit'], f['worth'], f['credit'] * f['worth'],
                    'stand-in' if f.get('replaces') else '%d%%' % round(100 * f['credit'] * f['worth'] / tot),
                    ', '.join('%s %.2f' % kv for kv in top)))
        return 0
    if cmd == 'apply':
        W = load_weights()
        for path in argv[2:]:
            doc = json.load(open(path))
            n = stamp(doc, W)
            json.dump(doc, open(path, 'w'), separators=(',', ':'))
            print('%s: %d player-seasons stamped' % (path, n))
        return 0
    if cmd == 'show':
        doc = json.load(open(argv[2]))
        W = load_weights()
        stamp(doc, W)
        show(doc, argv[3], shares=W.get('share'))
        return 0
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
