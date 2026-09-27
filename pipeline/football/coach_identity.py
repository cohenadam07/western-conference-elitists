# -*- coding: utf-8 -*-
"""Identity: what a play-caller's units look like next to everybody else's.

Fingerprint   a unit's style metrics, each turned into a z-score against that season's
              league (so a 2019 offence is judged against 2019, not against a league that
              has since moved to the pistol), averaged over a caller's units by snaps.
Comps         the units, and the callers, whose fingerprints sit closest to his.
Mentor        how close he sits to the man the coaching tree says he came from, as a
              percentile of all caller pairs. "Does the tree show up in the data?"
Arrival       what changed the year he took the job: the largest moves against the unit
              that was there before him.

Only style is fingerprinted - how often, not how well. Two offences that motion on every
snap and live under center are alike whether or not either of them is any good.
"""
import math

import numpy as np

OFF_FP = ['pass_rate', 'proe', 'early_proe', 'uc', 'nohuddle', 'sec_play', 'adot', 'deep',
          'sticks3', 'outside', 'rz_run', 'pistol', 'empty', 'motion', 'pa', 'rpo', 'screen',
          'oop', 'first_read', 'designed', 'light_box', 'p11', 'p12', 'p21', 'heavy', 'ttt',
          'quick']
DEF_FP = ['man', 'two_high', 'c0', 'c1', 'c2', 'c2m', 'c3', 'c4', 'c6', 'blitz', 'rushers',
          'rush5', 'rush3', 'pressure', 'press4', 'nickel', 'dime', 'base', 'box', 'box8',
          'light_vheavy', 'man3', 'two_vheavy']
MIN_SHARED = 8


def _fp_keys(side):
    return OFF_FP if side == 'O' else DEF_FP


def zscores(units):
    """Adds unit['z'] = {metric: z} against the full-size units of the same season and side."""
    by = {}
    for u in units.values():
        by.setdefault((u['season'], u['side']), []).append(u)
    for (season, side), us in by.items():
        full = [u for u in us if not u.get('small')]
        for k in _fp_keys(side):
            vals = [u['m'].get(k) for u in full if u['m'].get(k) is not None]
            if len(vals) < 12:
                continue
            mu = float(np.mean(vals)); sd = float(np.std(vals))
            if sd <= 1e-9:
                continue
            for u in us:
                v = u['m'].get(k)
                if v is not None:
                    u.setdefault('z', {})[k] = round((v - mu) / sd, 3)
    for u in units.values():
        u.setdefault('z', {})


def dist(za, zb):
    keys = [k for k in za if k in zb]
    if len(keys) < MIN_SHARED:
        return None, len(keys)
    return math.sqrt(sum((za[k] - zb[k]) ** 2 for k in keys) / len(keys)), len(keys)


def _pct_table(ds):
    ds = sorted(d for d in ds if d is not None)
    return ds


def _pct(d, table):
    """Share of pairs that are further apart than this one."""
    if not table or d is None:
        return None
    lo, hi = 0, len(table)
    while lo < hi:
        m = (lo + hi) // 2
        if table[m] < d:
            lo = m + 1
        else:
            hi = m
    return round(100.0 * (len(table) - lo) / len(table), 1)


def unit_comps(units, n=5):
    for side in ('O', 'D'):
        us = [u for u in units.values() if u['side'] == side and not u.get('small') and u['z']]
        pairs = []
        for i, a in enumerate(us):
            for b in us[i + 1:]:
                if a['caller'] == b['caller']:
                    continue
                d, _ = dist(a['z'], b['z'])
                if d is not None:
                    pairs.append(d)
        table = _pct_table(pairs)
        for a in us:
            cands = []
            for b in us:
                if b['caller'] == a['caller']:
                    continue
                d, k = dist(a['z'], b['z'])
                if d is not None:
                    cands.append((d, b['id']))
            cands.sort()
            a['comps'] = [[bid, round(d, 3), _pct(d, table)] for d, bid in cands[:n]]


def caller_profiles(units):
    """{name: {'units': [...], 'O': {...}, 'D': {...}}} with a snap-weighted fingerprint."""
    out = {}
    for u in sorted(units.values(), key=lambda x: (x['season'], x['wk'][0])):
        c = out.setdefault(u['caller'], dict(name=u['caller'], units=[]))
        c['units'].append(u['id'])
        s = c.setdefault(u['side'], dict(units=0, plays=0, games=0, teams=[], first=None,
                                         last=None, zsum={}, zw={}, unsure=0))
        s['units'] += 1
        s['plays'] += u['m'].get('plays', 0)
        s['games'] += u['m'].get('games', 0)
        if u['team'] not in s['teams']:
            s['teams'].append(u['team'])
        s['first'] = u['season'] if s['first'] is None else min(s['first'], u['season'])
        s['last'] = u['season'] if s['last'] is None else max(s['last'], u['season'])
        if not u.get('sure', True):
            s['unsure'] += 1
        if u.get('small'):
            continue
        w = u['m'].get('plays', 0)
        for k, z in u['z'].items():
            s['zsum'][k] = s['zsum'].get(k, 0.0) + z * w
            s['zw'][k] = s['zw'].get(k, 0.0) + w
    for c in out.values():
        for side in ('O', 'D'):
            s = c.get(side)
            if not s:
                continue
            s['fp'] = {k: round(s['zsum'][k] / s['zw'][k], 3) for k in s['zsum'] if s['zw'][k] > 0}
            del s['zsum'], s['zw']
    return out


def caller_comps(callers, tree, n=5):
    """Nearest callers on each side, plus the distance to his recorded mentor(s)."""
    for side in ('O', 'D'):
        cs = [c for c in callers.values() if c.get(side) and len(c[side]['fp']) >= MIN_SHARED]
        pairs = []
        for i, a in enumerate(cs):
            for b in cs[i + 1:]:
                d, _ = dist(a[side]['fp'], b[side]['fp'])
                if d is not None:
                    pairs.append(d)
        table = _pct_table(pairs)
        byname = {c['name']: c for c in cs}
        for a in cs:
            cands = []
            for b in cs:
                if b is a:
                    continue
                d, _ = dist(a[side]['fp'], b[side]['fp'])
                if d is not None:
                    cands.append((d, b['name']))
            cands.sort()
            a[side]['comps'] = [[nm, round(d, 3), _pct(d, table)] for d, nm in cands[:n]]
            # the tree: primary mentor first, then the other recorded influences
            t = tree.get(a['name'])
            if not t:
                continue
            ments = [t['mentor']] + [x['mentor'] for x in t.get('also', [])]
            for mname in ments:
                m = byname.get(mname)
                if not m:
                    continue
                d, k = dist(a[side]['fp'], m[side]['fp'])
                if d is None:
                    continue
                a[side].setdefault('mentors', []).append(
                    [mname, round(d, 3), _pct(d, table), mname == t['mentor']])


def arrivals(units):
    """For the first unit of a new caller on a team, the biggest changes from the unit
    that came before him (earlier the same season, or the team's last unit a year before)."""
    by = {}
    for u in units.values():
        by.setdefault((u['team'], u['side']), []).append(u)
    for (team, side), us in by.items():
        us.sort(key=lambda x: (x['season'], x['wk'][0]))
        for i, u in enumerate(us):
            if i == 0:
                continue
            prev = us[i - 1]
            if prev['caller'] == u['caller'] or u['season'] - prev['season'] > 1:
                continue
            if u.get('small') or prev['m'].get('plays', 0) < 150:
                continue
            ch = []
            for k in _fp_keys(side):
                a, b = prev['z'].get(k), u['z'].get(k)
                va, vb = prev['m'].get(k), u['m'].get(k)
                if a is None or b is None or va is None or vb is None:
                    continue
                ch.append((abs(b - a), k, va, vb, round(b - a, 2)))
            ch.sort(reverse=True)
            ch = [c for c in ch if c[0] >= 0.75][:4]
            u['arrival'] = dict(prev=prev['id'], prev_caller=prev['caller'],
                                changes=[[k, va, vb, dz] for _, k, va, vb, dz in ch])


def build_identity(units, tree):
    zscores(units)
    unit_comps(units)
    arrivals(units)
    callers = caller_profiles(units)
    caller_comps(callers, tree)
    return callers
