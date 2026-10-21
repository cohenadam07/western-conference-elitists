#!/usr/bin/env python3
"""Basketball Savant value — the number the All-Savant Team is picked on.

Points a player has added to his team this season above a replacement-level player at his
position (guard, wing, big), on the stats that are his own and the possessions he played.

Built in five steps, the same shape as Football Savant's award.py:

  1. The job. Parts of a player's game, each measured by stats that are his:
     scoring (efficiency on his own attempts, how much of the offense he carries, where his
     shots come from), playmaking (assists, turnovers), rebounding (both ends), defense
     (steals, blocks).
  2. How much of a stat is luck. Every stat is pulled toward his position's average by the
     settle points measured from 16 seasons of our own data (SETTLE_K on the page).
  3. What a stat is worth. Learned, not chosen: luck-adjusted on/off (how much better his
     team was with him on the floor, opponents' 3P% and FT% set to league average) is
     regressed on the stats, inside each season and position. Minutes share sits in the
     regression as a control - starters share the floor with starters, which flatters their
     on/off - and is then left out of every player's number.
  4. What the floor says. Where on/off exists (2009-10 on) the box-score estimate moves
     toward what actually happened with him on the floor, as far as the minutes have
     earned it. How far is fitted on next season's on/off, so only the part that follows a
     player into the next season counts.
  5. This season, on the floor. Points per 100 above the 25th-percentile qualified player
     at his position, times the possessions he has played. Missed games cost him: he
     earns nothing on nights he doesn't play.

The scale is checked against teams: a team's minutes-weighted sum of its players' rates
should equal its luck-adjusted net rating. The fitted slope rescales every rate once.

Learned on 2009-10 to 2024-25, 2025-26 held out. Everything is measured inside one season
and one position, so a league-wide drift (more threes, faster pace) doesn't pass for skill.

    python3 value.py fit       # learn, write public/savant-value.json + out/report.txt
    python3 value.py teams     # print the All-Savant teams for a few seasons
    python3 value.py dump S    # write every player's value for season S to out/S.json

Relearn only on purpose. The page and the connector only apply the learned numbers.
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(HERE, 'out')
WEIGHTS = os.path.join(PUB, 'savant-value.json')

FIT_FIRST, FIT_LAST, HOLDOUT = '2009-10', '2024-25', '2025-26'
POSITIONS = ['Guard', 'Wing', 'Big']
REPL_PCT = 25          # replacement = this percentile of qualified players at the position
MIN_FIT_MIN = 250      # minutes for a player-season to enter the fit

# Settle points (k, position-mean prior) - the same numbers the page's SETTLE_K carries.
# Units: ts in shooting attempts, the rest in possessions.
SETTLE = {'ts': 282, 'usg': 112, 'ast': 141, 'tov75': 398, 'oreb': 266, 'dreb': 316,
          'stl': 750, 'blk': 335, 'tp3r': 9, 'ftr': 60}

# The parts of the job and the stats in each. `key` is the feature name, `src` the stat on
# the row it is built from. Labels are what the page prints.
PARTS = [
    ('scoring',    'Scoring',    ['sceff', 'usg', 'tp3r', 'ftr']),
    ('playmaking', 'Playmaking', ['ast', 'tov']),
    ('rebounding', 'Rebounding', ['oreb', 'dreb']),
    ('defense',    'Defense',    ['stl', 'blk']),
]
FEAT_LABEL = {
    'sceff': 'Points over average efficiency per 100',
    'usg':   'Usage %',
    'tp3r':  '3-point attempt rate',
    'ftr':   'Free-throw rate',
    'ast':   'Assist %',
    'tov':   'Turnovers per 100',
    'oreb':  'Offensive rebound %',
    'dreb':  'Defensive rebound %',
    'stl':   'Steals per 100',
    'blk':   'Blocks per 100',
}
FEATS = [f for _, _, fs in PARTS for f in fs]

# A franchise that moved is not a player who changed teams.
FRANCHISE = {'KCK': 'SAC', 'SEA': 'OKC', 'NJN': 'BKN', 'NOH': 'NOP', 'NOK': 'NOP', 'CHH': 'NOP',
             'VAN': 'MEM', 'SDC': 'LAC', 'WSB': 'WAS', 'PHO': 'PHX'}


def moved(a, b):
    return FRANCHISE.get(a, a) != FRANCHISE.get(b, b)


# --------------------------------------------------------------------------- loading
def sv(p, k):
    x = (p.get('m') or {}).get(k) or {}
    x = x.get('season') or {}
    return x.get('v'), x.get('n')


def pos_fix():
    """The page's position overrides (POS_FIX_ID / POS_FIX_NAME), read out of the page so the
    value always ranks a player in the same group the page does."""
    import re, unicodedata
    html = open(os.path.join(PUB, 'basketball-savant.html')).read()
    out = {}
    for name in ('POS_FIX_ID', 'POS_FIX_NAME'):
        m = re.search(r'const %s\s*=\s*(\{[^;]*\});' % name, html)
        body = m.group(1) if m else '{}'
        # a small object literal: tokenise it (quoted strings keep any apostrophes inside), then
        # read key : value pairs. Bare numeric ids (1629029) and quoted names both work.
        toks = re.findall(r"""'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^\s{}:,'"]+|[{}:,]""", body)
        unq = lambda t: t[1:-1].replace("\\'", "'").replace('\\"', '"') if t[:1] in "'\"" else t
        pairs = [(unq(toks[i - 1]), unq(toks[i + 1])) for i, t in enumerate(toks) if t == ':' and 0 < i < len(toks) - 1]
        out[name] = {k.strip(): v for k, v in pairs}
    def norm(s):
        return ''.join(c for c in unicodedata.normalize('NFD', (s or '').lower()) if unicodedata.category(c) != 'Mn')
    def fix(p):
        return out['POS_FIX_ID'].get(str(p['id'])) or out['POS_FIX_NAME'].get(norm(p['name']))
    return fix


_FIX = None


def load(paths=None):
    """Every player-season as a flat dict. A current-season file, when present, wins."""
    global _FIX
    if _FIX is None:
        _FIX = pos_fix()
    paths = paths or [os.path.join(PUB, 'savant-data.json'), os.path.join(PUB, 'savant-current.json')]
    seasons = {}
    for path in paths:
        if not os.path.exists(path):
            continue
        d = json.load(open(path))
        for s, blk in d['data'].items():
            seasons[s] = blk['players']
    rows = []
    for s, ps in seasons.items():
        for p in ps:
            rows.append(row_of(s, p))
    return rows


def row_of(season, p):
    r = {'season': season, 'id': p['id'], 'name': p['name'], 'team': p.get('team'),
         'pos': (_FIX and _FIX(p)) or p.get('pos'), 'q': bool(p.get('qualified'))}
    pts, poss = sv(p, 'pts')
    r['poss'] = poss or 0
    r['pts100'] = None if pts is None else pts * 100 / 75
    for k in ['ts', 'usg', 'ast', 'tov75', 'oreb', 'dreb', 'stl', 'blk', 'tp3r', 'ftr']:
        v, n = sv(p, k)
        r[k] = v
        r[k + '_n'] = n or 0
    v, n = sv(p, 'onoffadj')
    r['onoff'] = v
    r['min'] = n or 0
    v, n = sv(p, 'minshare')
    r['minshare'] = v
    if not r['min'] and n:
        r['min'] = n
    v, n = sv(p, 'avail')
    r['gp'] = n or 0
    v, _ = sv(p, 'bpm')
    r['bpm'] = v
    v, _ = sv(p, 'vorp')
    r['vorp'] = v
    return r


# --------------------------------------------------------------------------- features
def wmean(vals, wts):
    num = den = 0.0
    for v, w in zip(vals, wts):
        if v is None or not w:
            continue
        num += v * w
        den += w
    return num / den if den else None


def season_features(rows):
    """Shrunk, position-demeaned features for one season's rows (in place).

    Means are possession-weighted over every player at the position that season (attempt-
    weighted for TS%), so the position's average player sits at zero on every feature."""
    lg_ts = wmean([r['ts'] for r in rows], [r['ts_n'] for r in rows]) or 0.55
    for pos in POSITIONS:
        grp = [r for r in rows if r['pos'] == pos]
        if not grp:
            continue
        mu = {}
        for k in SETTLE:
            w = [r[k + '_n'] for r in grp]
            mu[k] = wmean([r[k] for r in grp], w)
        for r in grp:
            sh = {}
            for k, kk in SETTLE.items():
                v, n, m = r[k], r[k + '_n'], mu[k]
                if m is None:
                    sh[k] = None
                elif v is None or not n:
                    sh[k] = m
                else:
                    sh[k] = (n * v + kk * m) / (n + kk)
            r['_sh'] = sh
            # points over an average shooter on his own attempts, per 100 possessions:
            # 2 x attempts per 100 x (his TS% - league TS%), TS% shrunk toward his position
            if r['pts100'] is not None and r['ts'] and sh['ts'] is not None:
                tsa100 = r['pts100'] / (2 * r['ts'])
                r['_sceff_raw'] = 2 * tsa100 * (sh['ts'] - lg_ts)
            else:
                r['_sceff_raw'] = None
        # sceff's own position average (possession-weighted) so it centres at zero too
        sce_mu = wmean([r['_sceff_raw'] for r in grp], [r['poss'] for r in grp]) or 0.0
        for r in grp:
            sh = r['_sh']
            x = {}
            x['sceff'] = (r['_sceff_raw'] - sce_mu) if r['_sceff_raw'] is not None else 0.0
            for k, src in [('usg', 'usg'), ('ast', 'ast'), ('oreb', 'oreb'), ('dreb', 'dreb'),
                           ('tp3r', 'tp3r'), ('ftr', 'ftr')]:
                x[k] = (sh[src] - mu[src]) if (sh[src] is not None and mu[src] is not None) else 0.0
            # per-75 counting stats to per 100
            for k, src in [('tov', 'tov75'), ('stl', 'stl'), ('blk', 'blk')]:
                x[k] = ((sh[src] - mu[src]) * 100 / 75) if (sh[src] is not None and mu[src] is not None) else 0.0
            r['x'] = x
        # minutes share and on/off, demeaned at the position (minutes-weighted)
        ms_mu = wmean([r['minshare'] for r in grp], [r['min'] for r in grp]) or 0.0
        oo_mu = wmean([r['onoff'] for r in grp], [onoff_w(r) for r in grp])
        for r in grp:
            r['ms_dm'] = (r['minshare'] - ms_mu) if r['minshare'] is not None else 0.0
            r['oo_dm'] = (r['onoff'] - oo_mu) if (r['onoff'] is not None and oo_mu is not None) else None
    for r in rows:
        if r['pos'] not in POSITIONS:
            r['x'] = None


def onoff_w(r):
    """Precision of a player's on/off: it's a difference of two samples, his minutes on and
    the team's minutes without him, so it is only as good as the smaller of the two."""
    on, ms = r['min'], r['minshare']
    if not on or not ms or r['onoff'] is None:
        return 0.0
    team_min = on / (ms / 100.0)
    off = max(team_min - on, 1.0)
    return 1.0 / (1.0 / on + 1.0 / off)


def by_season(rows):
    out = {}
    for r in rows:
        out.setdefault(r['season'], []).append(r)
    return out


def season_in(s, first, last):
    return first <= s <= last


# --------------------------------------------------------------------------- the fit
def ridge(X, y, w, lam):
    W = np.sqrt(w)[:, None]
    Xw, yw = X * W, y * np.sqrt(w)
    A = Xw.T @ Xw + lam * np.diag([0.0] + [1.0] * (X.shape[1] - 1))
    return np.linalg.solve(A, Xw.T @ yw)


def design(rs, feats):
    X = np.array([[1.0] + [r['x'][f] for f in feats] + [r['ms_dm']] for r in rs])
    return X


def fit_box(train, feats, lam):
    rs = [r for r in train if r.get('x') and r['oo_dm'] is not None and r['min'] >= MIN_FIT_MIN]
    X = design(rs, feats)
    # standardise for the penalty, then map back
    sd = X[:, 1:].std(0)
    sd[sd == 0] = 1.0
    Xs = X.copy()
    Xs[:, 1:] /= sd
    y = np.array([r['oo_dm'] for r in rs])
    w = np.array([onoff_w(r) for r in rs])
    b = ridge(Xs, y, w, lam)
    b[1:] /= sd
    return b, len(rs)


def prior_of(r, beta, feats, credit=None):
    """Box-score estimate, points per 100 vs an average player at his position. With
    `credit`, each stat counts only for the share of it that is his own. The minutes-share
    control is left out on purpose."""
    c = credit or {}
    return sum(beta[1 + i] * c.get(f, 1.0) * r['x'][f] for i, f in enumerate(feats))


def parts_of(r, beta, feats, credit=None):
    c = credit or {}
    out = {}
    for key, _, fs in PARTS:
        out[key] = sum(beta[1 + feats.index(f)] * c.get(f, 1.0) * r['x'][f] for f in fs if f in feats)
    return out


def rate_of(r, beta, feats, K, gamma, credit=None):
    """(rate, on-floor part). The floor is compared with everything the box score and his
    role say his on/off should be (full credit, minutes share included); only the rest is
    news, and only as much of it as his minutes have earned (K)."""
    p = prior_of(r, beta, feats, credit)
    if r['oo_dm'] is None or K is None:
        return p, 0.0
    w = onoff_w(r)
    expect = beta[0] + prior_of(r, beta, feats) + gamma * r['ms_dm']
    sh = w / (w + K)
    return p + sh * (r['oo_dm'] - expect), sh * (r['oo_dm'] - expect)


def measure_credit(S, seasons, min_poss=1500):
    moved_ = moved
    """Year-to-year carry-over of each stat for players who changed teams, over players who
    stayed (same position both years, possession-weighted). A stat that doesn't follow a
    player to a new team is partly his team's; capped at 1. Measured on every season the
    box stats cover, since box stats exist back to 1979-80."""
    out = {}
    for f in FEATS:
        res = {}
        for changed in (False, True):
            a, b, w = [], [], []
            for s in S:
                n = next_season(s)
                if n not in S or n > FIT_LAST:
                    continue
                nx = {r['id']: r for r in S[n] if r.get('x') and r['poss'] >= min_poss}
                for r in S[s]:
                    if not r.get('x') or r['poss'] < min_poss or r['id'] not in nx:
                        continue
                    m = nx[r['id']]
                    if m['pos'] != r['pos'] or moved_(r['team'], m['team']) != changed:
                        continue
                    a.append(r['x'][f]); b.append(m['x'][f]); w.append(min(r['poss'], m['poss']))
            a, b, w = map(np.array, (a, b, w))
            ma, mb = (a * w).sum() / w.sum(), (b * w).sum() / w.sum()
            res[changed] = (w * (a - ma) * (b - mb)).sum() / math.sqrt((w * (a - ma) ** 2).sum() * (w * (b - mb) ** 2).sum())
        out[f] = min(1.0, max(0.0, res[True] / res[False]))
    return out


def next_season(s):
    a = int(s[:4]) + 1
    return '%d-%02d' % (a, (a + 1) % 100)


def fit_K(S, beta, feats, seasons, credit=None):
    """How far to move from the box estimate toward the player's own on/off. K is chosen so
    this season's rate best predicts next season's on/off (minutes-weighted, both halves of
    the pair need minutes), reported for team-changers and stayers."""
    gamma = beta[-1]
    pairs = []
    for s in seasons:
        n = next_season(s)
        if n not in S or n > FIT_LAST:      # the held-out season is never a target
            continue
        nxt = {r['id']: r for r in S[n] if r.get('x') and r['oo_dm'] is not None and r['min'] >= MIN_FIT_MIN}
        for r in S[s]:
            if not r.get('x') or r['oo_dm'] is None or r['min'] < MIN_FIT_MIN or r['id'] not in nxt:
                continue
            m = nxt[r['id']]
            if m['pos'] != r['pos']:
                continue
            # next season's on/off, with its own minutes-share flattery taken out
            target = m['oo_dm'] - gamma * m['ms_dm']
            pairs.append((r, target, onoff_w(m), moved(r['team'], m['team']), m['oo_dm']))
    grid = [None] + [100 * 2 ** (i / 2) for i in range(0, 22)]

    def err(K, sub):
        num = den = 0.0
        for r, t, w, _, _ in sub:
            rt, _ = rate_of(r, beta, feats, K, gamma, credit)
            num += w * (t - rt) ** 2
            den += w
        return num / den

    res = {}
    for name, sub in [('all', pairs), ('changed', [p for p in pairs if p[3]]),
                      ('stayed', [p for p in pairs if not p[3]])]:
        es = [(err(K, sub), K) for K in grid]
        best = min(es, key=lambda e: e[0])
        res[name] = {'K': best[1], 'mse': best[0], 'mse_box_only': es[0][0], 'n': len(sub)}
    return res, pairs


def team_scale(S, beta, feats, K, gamma, credit=None):
    """Slope of team luck-adjusted net rating on the minutes-weighted sum of its players'
    rates. 1.0 means a rate is already in per-player points per 100."""
    path = os.path.join(PUB, 'savant-teams.json')
    if not os.path.exists(path):
        return None
    T = json.load(open(path))
    xs, ys = [], []
    for s, blk in T['data'].items():
        if s not in S or s > FIT_LAST:
            continue
        net = {t['abbr']: t.get('adjnet', t.get('net')) for t in blk['teams']}
        gp = {t['abbr']: t['gp'] for t in blk['teams']}
        acc = {}
        for r in S[s]:
            if not r.get('x') or r['team'] not in net:
                continue
            rt, _ = rate_of(r, beta, feats, K, gamma, credit)
            acc.setdefault(r['team'], 0.0)
            # his share of the team's floor time: minutes / (48 x games)
            acc[r['team']] += rt * r['min'] / (48.0 * gp[r['team']])
        for t, v in acc.items():
            if net[t] is not None:
                xs.append(v)
                ys.append(net[t])
    xs, ys = np.array(xs), np.array(ys)
    slope = float((xs * ys).sum() / (xs * xs).sum())   # through the origin: average team is 0
    r = float(np.corrcoef(xs, ys)[0, 1])
    return {'slope': slope, 'r': r, 'n': len(xs)}


# --------------------------------------------------------------------------- applying
def apply_season(rows, model):
    """Rate, parts and value for every row of one season (rows already have features)."""
    feats = model['feats']
    beta = [model['intercept']] + [model['beta'][f] for f in feats] + [model['gamma']]
    K, gamma, c, cr = model['K'], model['gamma'], model['scale'], model['credit']
    for r in rows:
        if not r.get('x'):
            r['rate'] = None
            continue
        rt, oo = rate_of(r, beta, feats, K, gamma, cr)
        r['rate'] = c * rt
        r['parts'] = {k: c * v for k, v in parts_of(r, beta, feats, cr).items()}
        r['parts']['floor'] = c * oo
    for pos in POSITIONS:
        q = sorted(r['rate'] for r in rows if r['pos'] == pos and r['q'] and r.get('rate') is not None)
        repl = pctile(q, REPL_PCT) if q else 0.0
        for r in rows:
            if r['pos'] == pos and r.get('rate') is not None:
                r['repl'] = repl
                r['value'] = (r['rate'] - repl) * r['poss'] / 100.0


def pctile(sorted_vals, p):
    """Linear-interpolated percentile, the same rule the page uses."""
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    h = (n - 1) * p / 100.0
    lo = int(math.floor(h))
    hi = min(lo + 1, n - 1)
    return sorted_vals[lo] + (h - lo) * (sorted_vals[hi] - sorted_vals[lo])


def all_savant(rows, teams=2):
    """2 guards, 2 wings, 1 big per team, best value first, qualified players only."""
    used, out = set(), []
    shape = [('Guard', 2), ('Wing', 2), ('Big', 1)]
    ranked = {pos: sorted([r for r in rows if r['pos'] == pos and r['q'] and r.get('value') is not None],
                          key=lambda r: -r['value']) for pos in POSITIONS}
    for t in range(teams):
        team = []
        for pos, n in shape:
            k = 0
            for r in ranked[pos]:
                if k >= n:
                    break
                if r['id'] in used:
                    continue
                used.add(r['id'])
                team.append(r)
                k += 1
        out.append(team)
    return out


# --------------------------------------------------------------------------- commands
def fit(lam=None):
    os.makedirs(OUT, exist_ok=True)
    rows = load([os.path.join(PUB, 'savant-data.json')])
    S = by_season(rows)
    for s, rs in S.items():
        season_features(rs)
    train = [r for s in S if season_in(s, FIT_FIRST, FIT_LAST) for r in S[s]]
    test = S.get(HOLDOUT, [])
    rep = []

    # penalty: pick the one that best predicts held-out seasons' same-season on/off,
    # leaving one season out at a time (fit seasons only - the holdout stays untouched)
    fit_seasons = sorted(s for s in S if season_in(s, FIT_FIRST, FIT_LAST))
    lams = [1e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6]
    cv = []
    for lm in lams:
        num = den = 0.0
        for s in fit_seasons:
            tr = [r for t in fit_seasons if t != s for r in S[t]]
            b, _ = fit_box(tr, FEATS, lm)
            for r in S[s]:
                if r.get('x') and r['oo_dm'] is not None and r['min'] >= MIN_FIT_MIN:
                    w = onoff_w(r)
                    pr = prior_of(r, b, FEATS) + b[-1] * r['ms_dm']
                    num += w * (r['oo_dm'] - pr) ** 2
                    den += w
        cv.append((num / den, lm))
    lam = lam if lam is not None else min(cv)[1]
    rep.append('penalty (leave-one-season-out MSE): ' + ', '.join('%g: %.3f' % (l, e) for e, l in cv)
               + ' -> %g' % lam)

    beta, n = fit_box(train, FEATS, lam)
    gamma = beta[-1]
    rep.append('box fit on %d player-seasons (%s to %s, %d+ minutes)' % (n, FIT_FIRST, FIT_LAST, MIN_FIT_MIN))
    for i, f in enumerate(FEATS):
        rep.append('  %-6s %+.4f  (%s)' % (f, beta[1 + i], FEAT_LABEL[f]))
    rep.append('  minutes-share control %+.4f per point of share (left out of every rate)' % gamma)

    credit = measure_credit(S, fit_seasons)
    rep.append('credit (share of each stat that follows a player to a new team, 1,500+ possessions both years):')
    rep.append('  ' + ', '.join('%s %.2f' % (f, credit[f]) for f in FEATS))

    Kres, pairs = fit_K(S, beta, FEATS, fit_seasons, credit)
    K = Kres['all']['K']
    for nm, v in Kres.items():
        rep.append('K (%s, %d pairs): %s  next-season MSE %.3f vs box only %.3f'
                   % (nm, v['n'], 'box only' if v['K'] is None else '%.0f' % v['K'], v['mse'], v['mse_box_only']))
    # credit: the K that holds for players who changed teams is the honest one - their
    # on/off had to follow them to new teammates. Use it when it is larger (more cautious).
    if Kres['changed']['K'] is None or (K is not None and Kres['changed']['K'] > K):
        K = Kres['changed']['K']
        rep.append('using the team-changers K (more cautious): %s' % ('box only' if K is None else '%.0f' % K))

    sc = team_scale(S, beta, FEATS, K, gamma, credit)
    scale = sc['slope'] if sc else 1.0
    if sc:
        rep.append('team check (%d team-seasons): slope %.3f, r %.3f -> every rate x %.3f'
                   % (sc['n'], sc['slope'], sc['r'], scale))

    model = {
        'version': 1,
        'learned': {'first': FIT_FIRST, 'last': FIT_LAST, 'holdout': HOLDOUT, 'player_seasons': n,
                    'penalty': lam},
        'feats': FEATS,
        'intercept': float(beta[0]),
        'beta': {f: float(beta[1 + i]) for i, f in enumerate(FEATS)},
        'gamma': float(gamma),
        'K': None if K is None else float(K),
        'scale': float(scale),
        'credit': {f: round(float(credit[f]), 4) for f in FEATS},
        'repl_pct': REPL_PCT,
        'settle': SETTLE,
        'parts': [{'key': k, 'label': lab, 'feats': fs} for k, lab, fs in PARTS]
                 + [{'key': 'floor', 'label': 'On-floor impact', 'feats': []}],
        'labels': FEAT_LABEL,
        'shape': [['Guard', 2], ['Wing', 2], ['Big', 1]],
    }
    json.dump(model, open(WEIGHTS, 'w'), indent=1)
    for s, rs in S.items():
        apply_season(rs, model)
    rep += validate(S, model, pairs)
    open(os.path.join(OUT, 'report.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))


def validate(S, model, pairs):
    """Out of sample: does this season's value predict next season's on/off better than
    BPM or raw on/off? And how often do our picks land on the real All-NBA teams."""
    rep = ['', 'NEXT-SEASON CHECK (corr with next season on/off, minutes-weighted)']
    feats = model['feats']
    beta = [model['intercept']] + [model['beta'][f] for f in feats] + [model['gamma']]

    def wcorr(a, b, w):
        a, b, w = map(np.array, (a, b, w))
        ma, mb = (a * w).sum() / w.sum(), (b * w).sum() / w.sum()
        cov = (w * (a - ma) * (b - mb)).sum()
        return cov / math.sqrt((w * (a - ma) ** 2).sum() * (w * (b - mb) ** 2).sum())

    # Two targets: next season's raw luck-adjusted on/off (no model in it), and the same with
    # next season's minutes-share flattery taken out (the target K was fitted on).
    hold = []
    nxt = {r['id']: r for r in S.get(HOLDOUT, []) if r.get('x') and r['oo_dm'] is not None and r['min'] >= MIN_FIT_MIN}
    for r in S.get('2024-25', []):
        if r.get('x') and r['oo_dm'] is not None and r['min'] >= MIN_FIT_MIN and r['id'] in nxt and nxt[r['id']]['pos'] == r['pos']:
            m = nxt[r['id']]
            hold.append((r, m['oo_dm'] - model['gamma'] * m['ms_dm'], onoff_w(m), moved(r['team'], m['team']), m['oo_dm']))
    for label, sub in [('fit seasons', pairs), ('2024-25 -> 2025-26 (holdout)', hold)]:
        for nm, cond in [('all', lambda p: True), ('changed teams', lambda p: p[3])]:
            ss = [p for p in sub if cond(p) and p[0]['bpm'] is not None]
            if len(ss) < 20:
                continue
            w = [p[2] for p in ss]
            cols = [('rate', [p[0]['rate'] for p in ss]),
                    ('value', [p[0]['value'] for p in ss]),
                    ('box part', [model['scale'] * prior_of(p[0], beta, feats, model['credit']) for p in ss]),
                    ('BPM', [p[0]['bpm'] for p in ss]),
                    ('raw on/off', [p[0]['oo_dm'] for p in ss])]
            for tname, ti in [('raw next on/off', 4), ('adj. next on/off', 1)]:
                t = [p[ti] for p in ss]
                rep.append('  %-30s %-14s %-17s n=%4d  ' % (label, nm, tname, len(ss))
                           + ' | '.join('%s %.3f' % (cn, wcorr(cv, t, w)) for cn, cv in cols))

    # sanity check only - never a target
    html = open(os.path.join(PUB, 'basketball-savant.html')).read()
    i = html.index('const AWARDS = ') + len('const AWARDS = ')
    A = json.JSONDecoder().raw_decode(html[i:])[0]
    rep += ['', 'ALL-NBA OVERLAP (sanity check, never a target) - our 1st+2nd teams vs real 1st/2nd/3rd']
    tot = {'fit': [0, 0, 0, 0], 'hold': [0, 0, 0, 0]}
    for s in sorted(S):
        if s < '1988-89':
            continue   # three All-NBA teams from 1988-89
        rs = S[s]
        teams = all_savant(rs, 2)
        real = {}
        for r in rs:
            for a in A['players'].get(str(r['id']), {}).get(s, []):
                if a in ('allnba1', 'allnba2', 'allnba3'):
                    real[r['id']] = a
        if not real:
            continue
        ids1 = [r['id'] for r in teams[0]]
        ids2 = [r['id'] for r in teams[1]]
        first_on_first = sum(1 for i in ids1 if real.get(i) == 'allnba1')
        any_ = sum(1 for i in ids1 + ids2 if i in real)
        top2 = sum(1 for i in ids1 + ids2 if real.get(i) in ('allnba1', 'allnba2'))
        k = 'hold' if s == HOLDOUT else 'fit'
        tot[k][0] += first_on_first
        tot[k][1] += top2
        tot[k][2] += any_
        tot[k][3] += 1
        if s >= '2015-16':
            rep.append('  %s  1st on real 1st %d/5 · ours on real 1st/2nd %2d/10 · on any All-NBA %2d/10   1st: %s'
                       % (s, first_on_first, top2, any_, ', '.join(r['name'] for r in teams[0])))
    for k, v in tot.items():
        if v[3]:
            rep.append('  %s seasons %d: 1st-on-1st %.0f%%, ours on real 1st/2nd %.0f%%, on any All-NBA %.0f%%'
                       % (k, v[3], 100 * v[0] / (5 * v[3]), 100 * v[1] / (10 * v[3]), 100 * v[2] / (10 * v[3])))
    return rep


def show_teams(seasons):
    model = json.load(open(WEIGHTS))
    rows = load()
    S = by_season(rows)
    for s in seasons:
        rs = S[s]
        season_features(rs)
        apply_season(rs, model)
        for t, team in enumerate(all_savant(rs, 2)):
            print(s, ['1st', '2nd'][t], ' | '.join('%s %s %+.0f (%.1f/100)' % (r['pos'][0], r['name'], r['value'], r['rate']) for r in team))


def dump(season):
    model = json.load(open(WEIGHTS))
    rows = load()
    S = by_season(rows)
    rs = S[season]
    season_features(rs)
    apply_season(rs, model)
    os.makedirs(OUT, exist_ok=True)
    out = {str(r['id']): {'name': r['name'], 'pos': r['pos'], 'q': r['q'], 'rate': r.get('rate'),
                          'value': r.get('value'), 'parts': r.get('parts')} for r in rs}
    json.dump(out, open(os.path.join(OUT, season + '.json'), 'w'), indent=0)
    print('wrote', os.path.join(OUT, season + '.json'), len(out))


def expected(seasons=('2025-26', '2015-16', '1995-96', '1984-85')):
    """A fixture for check.mjs: every player's value and both teams for a few seasons, so
    the page's JavaScript is held to this file's math."""
    model = json.load(open(WEIGHTS))
    S = by_season(load([os.path.join(PUB, 'savant-data.json')]))
    out = {'model_version': model['version'], 'seasons': {}}
    for s in seasons:
        rs = S[s]
        season_features(rs)
        apply_season(rs, model)
        out['seasons'][s] = {
            'values': {str(r['id']): [round(r['rate'], 9), round(r['value'], 9)] for r in rs if r.get('rate') is not None},
            'teams': [[r['id'] for r in t] for t in all_savant(rs, 2)],
        }
    path = os.path.join(HERE, 'expected.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print('wrote', path)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'fit'
    if cmd == 'fit':
        fit()
    elif cmd == 'teams':
        show_teams(sys.argv[2:] or ['2025-26', '2024-25', '2023-24'])
    elif cmd == 'expected':
        expected()
    elif cmd == 'dump':
        dump(sys.argv[2])
