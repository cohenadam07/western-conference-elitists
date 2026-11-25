"""
titles_study.py — is the title model too sure of the top team? Candidates scored out of sample by log score.

Each played season is replayed (10,000 runs, the same draws for every candidate) under a grid of playoff models:
  tau     each team's playoff strength strays from its rating by N(0, tau^2), once per run (the model so far: tau fit on
          earlier series)
  sigma   a series-level random effect: each series gets its own N(0, sigma^2) swing, shared by its games
  w       playoff strength = rating + w x (preseason projection - rating): the opening-night projection (titles_ref.py,
          projected strength relative to the league, on the margin scale by a fit on earlier seasons)
  star    the top 2 or top 3 players' share of team value (team_values) as a playoff input, its coefficient fit on
          earlier seasons' playoff games, entered as a playoff strength offset
The score of a season is minus the log of the champion's chance. Out of sample: each season's model is the grid point
with the best total score over the seasons before it (from 1983-84 on), so no season chooses its own model. Also
reported: calibration by bucket, the series log-likelihood, and each family alone.

    python3 titles_study.py          # -> out/title_study.json, out/title_study.txt
"""
import collections, itertools, json, math, os, sys
import numpy as np

import titles as T

OUT = T.OUT
TAUS = (0.0, 0.5, 1.0, 1.5, 2.0, 3.0)
SIGMAS = (0.0, 1.0, 2.0, 3.0)
WS = (0.0, 0.25, 0.5, 0.75)
STARS = (0, 2, 3)
FIRST_SCORED = 1984            # the first season with game fits on earlier seasons only
BUCKETS = ((0, .02), (.02, .05), (.05, .15), (.15, .30), (.30, 1.01))

REFS = json.load(open(T.REFS_PATH))


def preseason():
    """{season: {team: opening-night projected strength relative to the league (value points)}}"""
    out = {}
    for r in REFS['refs']:
        if r['kind'] == 'open':
            m = np.mean([v[0] for v in r['teams'].values()])
            out[r['season']] = {t: v[0] - m for t, v in r['teams'].items()}
    return out


PRE = preseason()


def pre_margin(season):
    """The projection on the margin scale: the slope of the rating on it over earlier seasons (the first five before 1985)."""
    y = T.y_of(season)
    use = [s for s in T.SEASONS if T.y_of(s) < y] or T.SEASONS[:1]
    if len(use) < 5:
        use = T.SEASONS[:5]
    xs, rs = [], []
    for s in use:
        r = T.rating(s)
        for t, x in PRE.get(T.y_of(s), {}).items():
            if t in r:
                xs.append(x); rs.append(r[t])
    xs, rs = np.array(xs), np.array(rs)
    k = float((xs * rs).sum() / (xs * xs).sum())
    return {t: k * x for t, x in PRE.get(y, {}).items()}, k


CONC = {k: T.concentration(REFS['team_values'], k) for k in (2, 3)}


def star_coef(season, k):
    """The star share's coefficient in the playoff game model (with home and the rating difference), seasons before."""
    y = T.y_of(season)
    use = [s for s in T.SEASONS if T.y_of(s) < y]
    if len(use) < 4:
        use = T.SEASONS[:4]
    X, Y = [], []
    for s in use:
        yy, r = T.y_of(s), T.rating(s)
        for h, a, won, home in T.games_of(s, 'po'):
            X.append((home, r[h] - r[a], CONC[k][(yy, h)] - CONC[k][(yy, a)])); Y.append(won)
    return T.logit_fit(np.array(X, float), np.array(Y, float))


def configs():
    return list(itertools.product(TAUS, SIGMAS, WS, STARS))


def run():
    grid = configs()
    E = {}                                         # (season, config) -> chances by team
    for s in T.SEASONS:
        S = T.Season(s)
        r = np.array([T.rating(s)[t] for t in S.teams])
        W = S.wins(S.home_wins(r))
        pm, _ = pre_margin(s)
        pre = np.array([pm.get(t, 0.0) for t in S.teams])
        star = {}
        for k in (2, 3):
            b = star_coef(s, k)
            c = np.array([CONC[k][(S.y, t)] for t in S.teams])
            star[k] = (b[2] / b[1]) * (c - c.mean())          # in margin points
        for cfg in grid:
            tau, sig_, w, k = cfg
            S.tau, S.sigma = tau, sig_
            S.off = w * (pre - r) + (star[k] if k else 0.0)
            E[(s, cfg)] = S.odds(r, W)
        print(s, len(grid), 'models', flush=True)
        teams = S.teams
        E[(s, 'teams')] = teams
    return grid, E


def score(E, s, cfg):
    teams = E[(s, 'teams')]
    p = E[(s, cfg)][teams.index(T.P[s]['champion'])]
    return -math.log(max(p, 1e-4))


def forward(grid, E, allowed):
    """Each season's model: the allowed grid point with the best total score over the scored seasons before it."""
    seasons = [s for s in T.SEASONS if T.y_of(s) >= FIRST_SCORED]
    pick, tot = {}, collections.Counter()
    for s in seasons:
        prior = [x for x in seasons if x < s]
        if len(prior) < 5:
            pick[s] = (TAUS[0], 0.0, 0.0, 0) if (TAUS[0], 0.0, 0.0, 0) in allowed else allowed[0]
        else:
            pick[s] = min(allowed, key=lambda c: sum(score(E, x, c) for x in prior))
    return pick


def summary(E, pick, seasons):
    ls = np.mean([score(E, s, pick[s]) for s in seasons])
    rows = []
    for s in seasons:
        teams = E[(s, 'teams')]
        for i, t in enumerate(teams):
            rows.append((E[(s, pick[s])][i], t == T.P[s]['champion']))
    b = []
    for lo, hi in BUCKETS:
        x = [r for r in rows if lo <= r[0] < hi]
        b.append((lo, hi, len(x), sum(p for p, w in x), sum(w for p, w in x)))
    brier = np.mean([(p - w) ** 2 for p, w in rows])
    return ls, brier, b


def main():
    grid, E = run()
    seasons_eval = [s for s in T.SEASONS if T.y_of(s) >= 1990]
    rep = ['Is the title model too sure of the top team? Out of sample by log score (minus the log of the champion\'s chance;',
           f'lower is better), every season from 1989-90 on scored with the model chosen on the seasons before it.', '']
    stored = json.load(open(os.path.join(OUT, 'title_odds.json')))
    cur = {}
    for s in T.SEASONS:
        S_ = stored['seasons'][s]['teams']
        cur[s] = None
    # the model so far (tau fit on earlier series, nothing else), from the stored odds
    def cur_score(s):
        return -math.log(max(stored['seasons'][s]['teams'][T.P[s]['champion']]['E'], 1e-4))
    rows = [(v['E'], v['won']) for s in seasons_eval for v in stored['seasons'][s]['teams'].values()]
    cur_b = []
    for lo, hi in BUCKETS:
        x = [r for r in rows if lo <= r[0] < hi]
        cur_b.append((lo, hi, len(x), sum(p for p, w in x), sum(w for p, w in x)))
    fam = {
        'the model so far': None,
        '(a) more playoff noise (tau)': [c for c in grid if c[1] == 0 and c[2] == 0 and c[3] == 0],
        '(a) series-level random effect (sigma)': [c for c in grid if c[0] == 0 and c[2] == 0 and c[3] == 0],
        '(a) both': [c for c in grid if c[2] == 0 and c[3] == 0],
        '(b) preseason projection blend (w)': [c for c in grid if c[0] == 0 and c[1] == 0 and c[3] == 0],
        '(c) star share, top 2 or 3': [c for c in grid if c[0] == 0 and c[1] == 0 and c[2] == 0],
        'everything (a + b + c)': grid,
        '(a) + (b)': [c for c in grid if c[3] == 0],
        '(a) + (c)': [c for c in grid if c[2] == 0],
        '(b) + (c)': [c for c in grid if c[0] == 0 and c[1] == 0],
    }
    res = {}
    for name, allowed in fam.items():
        if allowed is None:
            ls = np.mean([cur_score(s) for s in seasons_eval])
            br = np.mean([(p - w) ** 2 for p, w in rows])
            b = cur_b
            last = 'tau fit on earlier series'
        else:
            pick = forward(grid, E, allowed)
            ls, br, b = summary(E, pick, seasons_eval)
            last = pick[T.SEASONS[-1]]
            res[name] = {'pick': {s: list(c) for s, c in pick.items()}}
        res.setdefault(name, {})
        res[name].update({'log_score': ls, 'brier': br, 'buckets': b, 'last_choice': last})
        rep.append(f'{name:42} log score {ls:.3f}  Brier {br:.5f}  latest choice (tau, sigma, w, star) {last}')
        rep.append('    ' + ' | '.join(f'{lo:.0%}-{min(hi, 1):.0%}: {n} teams, {e:.1f} expected, {a} won' for lo, hi, n, e, a in b))
    # in-sample, for scale: the single best grid point over the same seasons
    best = min(grid, key=lambda c: sum(score(E, s, c) for s in seasons_eval))
    rep.append(f'\nin sample (not a test): the best single grid point {best}, log score {np.mean([score(E, s, best) for s in seasons_eval]):.3f}')
    by = sorted(((np.mean([score(E, s, c) for s in seasons_eval]), c) for c in grid))[:8]
    rep += [f'    {c}  {v:.3f}' for v, c in by]
    open(os.path.join(OUT, 'title_study.txt'), 'w').write('\n'.join(rep) + '\n')
    json.dump({k: {kk: (vv if not isinstance(vv, tuple) else list(vv)) for kk, vv in v.items()} for k, v in res.items()},
              open(os.path.join(OUT, 'title_study.json'), 'w'), default=str)
    print('\n'.join(rep))


if __name__ == '__main__':
    main()
