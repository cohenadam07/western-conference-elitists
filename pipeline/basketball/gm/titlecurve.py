"""
titlecurve.py — what a point of value is worth in titles, team-season by team-season (light: reads title_odds.json and
title_refs.json, written by titles.py and titles_ref.py).

A season that has been played (realized): the team's title curve is its own season replayed at every strength with the
rest of the league as it was (titles.py). Its slope per value point is the secant from average strength to the team's,
(E - E0) / strength, strength = luck-adjusted margin x value points per margin point; within titles.NEAR of average,
the derivative. A decision's points in that season times this slope is its share of the team's expected titles above
an average team's (Aumann-Shapley for a curve of one strength: the shares add up to E - E0 exactly).

A season not yet played (projected): the curve of title chance against projected strength relative to the league
(titles.py), as of a date. The team's position is read from the latest reference date on or before that date; the
version is the one fit only on seasons finished before the date's season; the chances on that reference date are scaled
to add up to 1 across the league. Its slope is the secant from the league-average projection to the team's, or the
derivative near average.
"""
import bisect, functools, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
O = json.load(open(os.path.join(OUT, 'title_odds.json')))
R = json.load(open(os.path.join(OUT, 'title_refs.json')))
ADJ = R['adj_to_value']
TODAY = R['today']
HORIZON = R['horizon']
FIXED = ('summer', 'open', 'mid')               # reference dates whose calendar does not move with the build's day
NEAR_VALUE = O['near'] * ADJ


def season_of(d):
    return int(d[:4]) + (1 if d[5:7] >= '07' else 0)


def label(y):
    return f'{y - 1}-{str(y)[2:]}'


NOW_SEASON = season_of(TODAY)
LAST_PLAYED = max(int(s[:4]) + 1 for s in O['seasons'])
_REFS = sorted((r for r in R['refs'] if r['kind'] in FIXED), key=lambda r: r['date'])
_DATES = [r['date'] for r in _REFS]
_TODAY_REF = next(r for r in R['refs'] if r['kind'] == 'today' and r['date'] == TODAY)


def n_teams(y):
    s = O['seasons'].get(label(y))
    if s:
        return s['n']
    return len(_TODAY_REF['teams'])


def realized(team, y):
    """A played season: {E, E0, won, slope (titles per value point), strength (value points), n} or None."""
    s = O['seasons'].get(label(y))
    row = s and s['teams'].get(team)
    if not row:
        return None
    return {'E': row['E'], 'E0': row['E0'], 'won': row['won'], 'slope': row['slope_per_margin'] / ADJ,
            'strength': row['rating'] * ADJ, 'basis': row['slope_basis'], 'n': s['n']}


_MD = None


def _todate(y, team, d):
    global _MD
    if _MD is None:
        import titles
        _MD = titles.todate_margin()
    return _MD(y, team, d)


@functools.lru_cache(maxsize=None)
def _ref_table(ref_date, kind, h, version):
    """{team: (chance, chance at the league-average projection, slope per value point)} on one reference date."""
    r = _TODAY_REF if kind == 'today' else _REFS[_DATES.index(ref_date)]
    curve = O['curves'][kind][str(h)]
    v = str(min(max(version, min(map(int, curve))), max(map(int, curve))))
    coef, early = np.array(curve[v][:-1]), curve[v][-1]
    teams = sorted(r['teams'])
    x = np.array([r['teams'][t][h] for t in teams])
    x = x - x.mean()
    m = np.array([_todate(r['season'], t, r['date']) for t in teams]) if kind in ('today', 'mid') else np.zeros(len(teams))
    import titles
    raw = titles.sig(titles.features(kind, x, m) @ coef)
    k = 1.0 / raw.sum()
    c = raw * k
    c0 = titles.sig(titles.features(kind, np.zeros(len(teams)), m) @ coef) * k
    deriv = k * raw * (1 - raw) * coef[1] / 100.0
    slope = np.where(np.abs(x) >= NEAR_VALUE, (c - c0) / np.where(x == 0, 1, x), deriv)
    held = np.array([r['teams'][t][h] for t in teams])
    _CURVE[(ref_date, kind, h, version)] = (coef, k, {t: float(m[i]) for i, t in enumerate(teams)})
    return {t: (float(c[i]), float(c0[i]), float(slope[i]), float(x[i]), float(held[i]), float(held.mean())) for i, t in enumerate(teams)}, bool(early)


_CURVE = {}


def projected(team, y, as_of=None, today=False):
    """A season seen ahead of time: {chance, chance0, slope, x, early, ref} as of a date (the latest fixed reference on
    or before it), or as of today (today's own reference). None outside the horizon or before any reference."""
    if today:
        r = _TODAY_REF
        version = NOW_SEASON
    else:
        i = bisect.bisect_right(_DATES, as_of) - 1
        if i < 0:
            return None
        r = _REFS[i]
        version = season_of(as_of)
    h = y - r['season']
    if not 0 <= h < HORIZON or team not in r['teams']:
        return None
    tab, early = _ref_table(r['date'], r['kind'], h, version)
    c, c0, sl, x, held, mean_held = tab[team]
    return {'chance': c, 'chance0': c0, 'slope': sl, 'x': x, 'held': held, 'mean_held': mean_held, 'early': early, 'ref': r['date'], 'kind': r['kind']}


# ---- a roster's titles (what a GM inherited or handed on): its share of the team's expected titles, by its share of the
# team's player value. The secant from average is the split for decisions (it adds up to E - E0 across everything a
# team did, the league baseline included); a roster's value is counted from replacement, like a decision's, but the
# roster is most of the team, so by the secant it would carry more titles than the team was expected to win.
def rate_level_played(team, y, team_value):
    """A played season: titles per point of player value on the team (E over the team's value above replacement)."""
    r = realized(team, y)
    return r['E'] / team_value if r and team_value and team_value > 0 else 0.0


def rate_level_projected(team, y, league_team_value, as_of=None, today=False):
    """A season ahead: the projected chance over the projected team value (what is held, with the rest of a
    league-average team still to fill)."""
    p = projected(team, y, as_of=as_of, today=today)
    if not p:
        return 0.0
    total = p['held'] + max(0.0, league_team_value - p['mean_held'])
    return p['chance'] / total if total > 0 else 0.0


# ---- a decision's titles: with it minus without it (the team's strength that season, less the decision's points).
# Not the conserving split: this asks what the decision itself changed; the split shares out what the team won.
def delta_played(team, y, pts):
    """A played season: the team's title chance at its strength minus at its strength less the margin pts (value
    points) were worth to it (margin_of: more value on a strong team buys less margin), read off its replays
    (titles.GRID_DELTAS, every draw unchanged), linear between them, held at the ends."""
    s = O['seasons'].get(label(y))
    row = s and s['teams'].get(team)
    if not row or not pts:
        return 0.0
    g, ds = row['grid'], O['blend']['deltas']
    return row['E'] - float(np.interp(-margin_of(s['value_to_margin'], row['value_above_average'], pts), ds, g))


def margin_of(coef, value, pts):
    """The margin a decision's pts (value points) were worth to a team with this much value above average: the fitted
    curve's rise from (value - pts) to value (titles.value_to_margin), held flat past its peak."""
    a, b, c = coef
    top = -b / (2 * c) if c < 0 else float('inf')
    g = lambda v: a + b * min(v, top) + c * min(v, top) ** 2
    return g(value / 100.0) - g((value - pts) / 100.0)


def delta_projected(team, y, pts, as_of=None, today=False):
    """A season ahead: the projected chance at the team's projected strength minus at it less pts, as of a date."""
    p = projected(team, y, as_of=as_of, today=today)
    if not p or not pts:
        return 0.0, bool(p and p['early'])
    r = _TODAY_REF if today else _REFS[_DATES.index(p['ref'])]
    version = NOW_SEASON if today else season_of(as_of)
    coef, k, m = _CURVE[(p['ref'], p['kind'], y - r['season'], version)]
    import titles
    c1 = titles.sig(titles.features(p['kind'], [p['x'] - pts], [m[team]]) @ coef)[0] * k
    return p['chance'] - float(c1), p['early']


def with_without(stream, team, y0, basis, as_of=None, rate=0.05):
    """Titles with the decision minus without it, season by season, ten seasons from y0 at 5%."""
    tot, early = 0.0, False
    for y, v in stream:
        if not y0 <= y < y0 + HORIZON or not v:
            continue
        if basis == 'turned_out':
            d = delta_played(team, y, v) if y <= LAST_PLAYED else delta_projected(team, y, v, today=True)[0]
        else:
            d, e = delta_projected(team, y, v, as_of=as_of)
            early = early or e
        tot += d * w(y, y0, rate)
    return tot if basis == 'turned_out' else (tot, early)


def slope_turned_out(team, y):
    """Titles per value point as it turned out: the played season's, or (a season still to come, or the one in
    progress) today's projection."""
    if y <= LAST_PLAYED:
        r = realized(team, y)
        return r['slope'] if r else 0.0
    p = projected(team, y, today=True)
    return p['slope'] if p else 0.0


def slope_at_time(team, y, as_of):
    p = projected(team, y, as_of=as_of)
    return (p['slope'], p['early']) if p else (0.0, False)


def w(y, y0, rate=0.05):
    return 1 / (1 + rate) ** (y - y0)


def titles_of(stream, team, y0, basis, as_of=None, rate=0.05):
    """Titles from a points stream [(season, value)]: ten seasons from y0, discounted like the points."""
    tot, early = 0.0, False
    for y, v in stream:
        if not y0 <= y < y0 + HORIZON or not v:
            continue
        if basis == 'turned_out':
            sl = slope_turned_out(team, y)
        else:
            sl, e = slope_at_time(team, y, as_of)
            early = early or e
        tot += v * sl * w(y, y0, rate)
    return (tot, early) if basis != 'turned_out' else tot
