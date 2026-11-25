"""
picks.py — Module 3's pick value model, built fresh: the expected Savant value of a draft pick by slot
and draft year, smooth across slots, with its error.

A pick's realized value is what its player produced in his first five seasons after the draft (82-game
footing; zero for a season he was not in the league). Drafts 1980-2021 have complete five-season windows.

Smoothing is chosen, not assumed: four forms are scored leaving one whole draft out at a time
(raw slot means, log-linear, exponential decay, and a Gaussian kernel across slots whose bandwidth is
itself chosen by cross-validation); the best is kept. Point in time: fit(T) uses only drafts whose
five-season window ended by season T, so a decision in season T+1 sees nothing later.

    python3 picks.py eval    # -> out/picks_eval.txt
    python3 picks.py fit     # -> out/models/picks_<T>.json
"""
import collections, json, math, os, sys
import numpy as np
from scipy.optimize import curve_fit

HERE = os.path.dirname(os.path.abspath(__file__))
VKEY = os.environ.get('GM_VALUE', 'valuer')      # valuer: era footing (each season scaled to the all-season league total); value82: raw
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, os.path.join(HERE, '..'))
from br_crosswalk import canonical_id   # noqa: E402
from ledger import drafts               # noqa: E402

VERSION = 'picks-1.0'
H = 5            # the curve's headline (and its tests) are five seasons; by_season_after_draft runs to HMAX
HMAX = 10
MAXSLOT = 60


def realized():
    rows = json.load(open(os.path.join(OUT, 'model_seasons.json')))
    val = collections.defaultdict(dict)
    for r in rows:
        val[r['id']][r['y']] = r[VKEY]
    out = []
    for y, d in drafts().items():
        if y < 1980:
            continue
        for rnd, ov, team, pid, name in d['picks']:
            if not pid or ov > MAXSLOT:
                continue
            pl = canonical_id(pid, name)
            ks = [val[pl].get(y + k, 0.0) for k in range(1, HMAX + 1)]
            out.append({'year': y, 'slot': ov, 'player': name, 'id': pl, 'by_k': ks, 'v5': sum(ks[:H]), 'complete': y + H <= 2026})
    return out


def kernel(slots, vals, h, at):
    w = np.exp(-0.5 * ((np.asarray(slots)[None, :] - np.asarray(at)[:, None]) / h) ** 2)
    return (w * np.asarray(vals)[None, :]).sum(1) / w.sum(1)


FORMS = {
    'slot means': None,
    'log-linear': lambda s, a, b: a + b * np.log(s),
    'exponential decay': lambda s, a, b, c: a * np.exp(-b * (s - 1)) + c,
}


def fit_curve(R, form, h=None):
    s = np.array([r['slot'] for r in R]); v = np.array([r['v5'] for r in R])
    grid = np.arange(1, MAXSLOT + 1)
    if form == 'slot means':
        m = {k: v[s == k].mean() for k in set(s.tolist())}
        return np.array([m.get(k, 0.0) for k in grid])
    if form == 'kernel':
        return kernel(s, v, h, grid)
    f = FORMS[form]
    p0 = (200, -40) if form == 'log-linear' else (400, 0.1, 10)
    par, _ = curve_fit(f, s, v, p0=p0, maxfev=20000)
    return f(grid, *par)


def lodo(R, form, h=None):
    years = sorted({r['year'] for r in R})
    err = []
    for y in years:
        tr = [r for r in R if r['year'] != y]; te = [r for r in R if r['year'] == y]
        c = fit_curve(tr, form, h)
        err += [(c[r['slot'] - 1] - r['v5']) ** 2 for r in te]
    return math.sqrt(np.mean(err))


def evaluate():
    R = [r for r in realized() if r['complete']]
    rep = [f'{VERSION}: {len(R)} picks, drafts {min(r["year"] for r in R)}-{max(r["year"] for r in R)}, slots 1-{MAXSLOT}; value = first {H} seasons (82-game footing)', '']
    scores = {f: lodo(R, f) for f in FORMS}
    hs = {h: lodo(R, 'kernel', h) for h in (1, 2, 3, 4, 6, 8)}
    hbest = min(hs, key=hs.get)
    scores[f'kernel (bandwidth {hbest} slots)'] = hs[hbest]
    rep.append('Leave-one-draft-out RMSE per pick (Savant points over five seasons):')
    for f, e in sorted(scores.items(), key=lambda x: x[1]):
        rep.append(f'   {f:32} {e:7.1f}')
    rep.append(f'   (kernel bandwidths tried: ' + ', '.join(f'{h}: {e:.1f}' for h, e in hs.items()) + ')')
    best = min(scores, key=scores.get)
    rep.append(f'kept: {best}')
    # does the curve drift by era? same form fit on each era
    rep += ['', 'Curve by era (expected five-season value at slots 1, 3, 5, 10, 15, 20, 30, 45, 60):']
    eras = [(1980, 1988), (1989, 1999), (2000, 2009), (2010, 2021)]
    for a, b in eras:
        Re = [r for r in R if a <= r['year'] <= b]
        c = fit_curve(Re, 'kernel', hbest)
        rep.append(f'   {a}-{b} (n={len(Re):4}): ' + '  '.join(f'{c[k - 1]:6.0f}' for k in (1, 3, 5, 10, 15, 20, 30, 45, 60)))
    c = fit_curve(R, 'kernel', hbest)
    # the error band: bootstrap over drafts
    rng = np.random.default_rng(7); years = sorted({r['year'] for r in R}); boots = []
    by_y = collections.defaultdict(list)
    for r in R:
        by_y[r['year']].append(r)
    for _ in range(300):
        smp = [r for y in rng.choice(years, len(years)) for r in by_y[y]]
        boots.append(fit_curve(smp, 'kernel', hbest))
    boots = np.array(boots)
    rep += ['', 'All drafts: expected value, 90% band of the curve (bootstrap over drafts), and the spread of single picks (sd):']
    for k in (1, 2, 3, 5, 8, 10, 14, 20, 25, 30, 40, 50, 60):
        sd = np.std([r['v5'] for r in R if abs(r['slot'] - k) <= 1])
        hit = np.mean([r['v5'] > 150 for r in R if abs(r['slot'] - k) <= 1])
        rep.append(f'   slot {k:2}: {c[k - 1]:6.0f}  [{np.percentile(boots[:, k - 1], 5):5.0f} - {np.percentile(boots[:, k - 1], 95):5.0f}]   single-pick sd {sd:5.0f}   share above 150: {hit:.0%}')
    # which past drafts to use at a decision: forward-chained, the curve from the W latest complete drafts
    # predicts a draft five years on (all that would be known), log-linear form
    rep += ['', 'Window of past drafts (forward-chained: predict draft Y from drafts complete before it):']
    wins = {}
    for W in (5, 8, 10, 15, 20, 99):
        err = []
        for y in range(1995, 2022):
            tr = [r for r in R if y - H - W < r['year'] <= y - H - 1]
            if len({r['year'] for r in tr}) < 4:
                continue
            c = fit_curve(tr, 'log-linear')
            err += [(c[r['slot'] - 1] - r['v5']) ** 2 for r in R if r['year'] == y]
        wins[W] = math.sqrt(np.mean(err))
        rep.append(f'   latest {W if W < 99 else "all":>3} drafts: {wins[W]:6.1f}')
    wbest = min(wins, key=wins.get)
    rep.append(f'kept: log-linear on the latest {wbest if wbest < 99 else "all"} complete drafts')
    open(os.path.join(OUT, 'picks_eval.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))
    json.dump({'form': 'log-linear', 'window': wbest}, open(os.path.join(OUT, 'picks_hp.json'), 'w'))


def fit_all():
    """Point-in-time curves: fit(T) uses drafts whose five-season window ended by season T."""
    R = realized()
    hp = json.load(open(os.path.join(OUT, 'picks_hp.json')))
    only = os.environ.get('GM_FIT_ONLY')
    for T in ([int(only)] if only else range(1990, int(os.environ.get('GM_LAST_COMPLETE', 2026)) + 1)):
        use = [r for r in R if T - H - hp['window'] < r['year'] <= T - H]
        if len({r['year'] for r in use}) < 5:
            continue
        c = fit_curve(use, 'log-linear')
        by_k = []
        for k in range(HMAX):                 # season k+1 after the draft: the latest drafts complete through it
            use_k = [r for r in R if T - (k + 1) - hp['window'] < r['year'] <= T - (k + 1)]
            by_k.append([max(0.0, x) for x in fit_curve([dict(r, v5=r['by_k'][k]) for r in use_k], 'log-linear').tolist()] if len({r['year'] for r in use_k}) >= 3 else [0.0] * MAXSLOT)
        resid = math.sqrt(np.mean([(c[r['slot'] - 1] - r['v5']) ** 2 for r in use]))
        json.dump({'version': f'{VERSION}@{T}', 'fit_through_season_end': T, 'drafts': [min(r['year'] for r in use), max(r['year'] for r in use)],
                   'form': 'log-linear', 'window': hp['window'], 'v5_by_slot': [max(0.0, x) for x in c.tolist()], 'by_season_after_draft': by_k,
                   'single_pick_rmse': resid}, open(os.path.join(OUT, 'models', f'picks_{T}.json'), 'w'))
    print('pick curve versions written')


if __name__ == '__main__':
    {'eval': evaluate, 'fit': fit_all}[sys.argv[1] if len(sys.argv) > 1 else 'eval']()
