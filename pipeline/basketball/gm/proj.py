"""
proj.py — Module 3's projection model, built fresh: a player's expected Savant value (82-game footing)
in each of the next five seasons, with the chance he is not in the league at all.

Two parts per horizon k = 1..5, from what was known at the end of season t:
  P(in the league in t+k)          logistic regression
  E[value in t+k | in the league]  ridge regression
  E[value in t+k] = P x E[value | in the league]
Inputs: age (bands, and each band times last season's value), value and possessions in t, t-1, t-2 (zero
and a flag when he did not play), years in the league, draft slot (log), undrafted, drafted before 1979.

Regularization is chosen by cross-validation on the seasons through 1999-2000 and then fixed, so no later
season helps choose it. Tests are out of sample, split by player (all of a player's seasons in one fold).

Point in time: fit(T) uses only pairs whose outcome season ends by T, so a projection made as of a date in
or after season T+1 sees nothing later. Fits start at T = 1985 (five seasons of outcomes); a decision before
mid-1985 uses that fit and is flagged early-era.

    python3 proj.py eval        # the out-of-sample test -> out/proj_eval.txt
    python3 proj.py fit         # every point-in-time version -> out/models/proj_<T>.json
"""
import collections, json, math, os, sys
import numpy as np
# sklearn (152 MB to import) only where a model is fitted: the daily chain applies stored coefficients and never needs it


def GroupKFold(n):
    from sklearn.model_selection import GroupKFold as G
    return G(n)

HERE = os.path.dirname(os.path.abspath(__file__))
VKEY = os.environ.get('GM_VALUE', 'valuer')      # valuer: era footing (each season scaled to the all-season league total); value82: raw
OUT = os.path.join(HERE, 'out')
VERSION = 'proj-1.0'
K = int(os.environ.get('GM_K', 10))
BANDS = [(0, 21), (22, 23), (24, 25), (26, 27), (28, 29), (30, 31), (32, 33), (34, 99)]
LAST_COMPLETE = int(os.environ.get('GM_LAST_COMPLETE', 2026))   # 2025-26; the season in progress is never a target (gm_refit.py moves it)


def table():
    rows = json.load(open(os.path.join(OUT, 'model_seasons.json')))
    by = collections.defaultdict(dict)
    for r in rows:
        by[r['id']][r['y']] = r
    return rows, by


def feats(by_p, y):
    """Features for a player as of the end of season y (his row in y exists)."""
    r0 = by_p[y]
    r1, r2 = by_p.get(y - 1), by_p.get(y - 2)
    age = int(r0['age']) if r0['age'] is not None else 26        # whole years: 25.93 is 25
    yrs = sum(1 for yy in by_p if yy <= y)
    dp = r0.get('draft_pick')
    pre79 = dp is None and min(by_p) <= 1981
    und = dp is None and not pre79
    v0, v1, v2 = r0[VKEY], (r1 or {}).get(VKEY, 0.0), (r2 or {}).get(VKEY, 0.0)
    x = [v0, v1, v2, r0['poss82'] / 1000, (r1 or {}).get('poss82', 0) / 1000, 1.0 if r1 else 0.0, 1.0 if r2 else 0.0,
         yrs, math.log(dp) if dp else 0.0, 1.0 if und else 0.0, 1.0 if pre79 else 0.0]
    for a, b in BANDS:
        inb = 1.0 if a <= age <= b else 0.0
        x += [inb, inb * v0]
    return x


NAMES = ['v0', 'v1', 'v2', 'poss0', 'poss1', 'played1', 'played2', 'yrs', 'log_pick', 'undrafted', 'pre1979'] + \
        [f'{n}_{a}-{b}' for a, b in BANDS for n in ('age', 'v0xage')]


def pairs(by, k, last=LAST_COMPLETE):
    X, inn, val, grp, meta = [], [], [], [], []
    for pid, bp in by.items():
        for y in bp:
            if y + k > last:
                continue
            X.append(feats(bp, y))
            r = bp.get(y + k)
            inn.append(1 if r else 0)
            val.append(r[VKEY] if r else 0.0)
            grp.append(str(pid))
            meta.append((pid, y, bp[y]['age'], bp[y][VKEY]))
    return np.array(X), np.array(inn), np.array(val), np.array(grp), meta


class Model:
    def __init__(self, C=1.0, alpha=10.0):
        self.C, self.alpha = C, alpha

    def fit(self, X, inn, val):
        from sklearn.linear_model import LogisticRegression, Ridge
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-9
        Z = (X - self.mu) / self.sd
        self.clf = LogisticRegression(C=self.C, max_iter=2000).fit(Z, inn)
        m = inn == 1
        self.reg = Ridge(alpha=self.alpha).fit(Z[m], val[m])
        return self

    def predict(self, X):
        Z = (X - self.mu) / self.sd
        p = self.clf.predict_proba(Z)[:, 1]
        return p, p * self.reg.predict(Z)

    def dump(self):
        return {'mu': self.mu.tolist(), 'sd': self.sd.tolist(), 'logit_coef': self.clf.coef_[0].tolist(), 'logit_icpt': float(self.clf.intercept_[0]),
                'ridge_coef': self.reg.coef_.tolist(), 'ridge_icpt': float(self.reg.intercept_), 'C': self.C, 'alpha': self.alpha}


def choose(by):
    """Regularization by grouped CV on outcome seasons through 1999-2000 only."""
    best = {}
    for k in (1, 3):
        X, inn, val, grp, _ = pairs(by, k, last=2000)
        scores = {}
        for C in (0.01, 0.1, 1.0):
            for alpha in (1.0, 10.0, 100.0, 1000.0):
                err = []
                for tr, te in GroupKFold(5).split(X, val, grp):
                    m = Model(C, alpha).fit(X[tr], inn[tr], val[tr])
                    err.append(np.mean((m.predict(X[te])[1] - val[te]) ** 2))
                scores[(C, alpha)] = float(np.mean(err))
        best[k] = min(scores, key=scores.get)
    return best


def evaluate():
    rows, by = table()
    hp = choose(by)
    C, alpha = hp[1]
    rep = [f'{VERSION}: regularization chosen on outcomes through 1999-2000 (grouped CV): C={C}, alpha={alpha} (k=3 picked {hp[3]})', '']
    rep.append('Out of sample, split by player (5 folds), 1979-80 to 2025-26. RMSE in Savant points (82-game footing); zero when out of the league.')
    rep.append(f"{'k':>2} {'pairs':>7} {'model':>7} {'same as last yr':>15} {'better by':>9} {'Brier in-league':>15} {'base Brier':>10}")
    by_age = {}
    for k in range(1, K + 1):
        X, inn, val, grp, meta = pairs(by, k)
        pred = np.zeros(len(val)); pin = np.zeros(len(val))
        for tr, te in GroupKFold(5).split(X, val, grp):
            m = Model(C, alpha).fit(X[tr], inn[tr], val[tr])
            pin[te], pred[te] = m.predict(X[te])
        base = np.array([mm[3] for mm in meta])
        rm, rb = math.sqrt(np.mean((pred - val) ** 2)), math.sqrt(np.mean((base - val) ** 2))
        br = np.mean((pin - inn) ** 2); bb = np.mean((inn.mean() - inn) ** 2)
        rz = math.sqrt(np.mean(val ** 2)); corr = float(np.corrcoef(pred, val)[0, 1])
        rep.append(f'{k:>2} {len(val):>7} {rm:>7.1f} {rb:>15.1f} {1 - rm / rb:>8.0%} {br:>15.3f} {bb:>10.3f}   zero: {rz:6.1f} ({1 - rm / rz:4.0%})  r {corr:.2f}')
        if k == 1:
            for a, b in BANDS:
                idx = [i for i, mm in enumerate(meta) if mm[2] is not None and a <= int(mm[2]) <= b]
                if idx:
                    by_age[(a, b)] = (len(idx), math.sqrt(np.mean((pred[idx] - val[idx]) ** 2)), math.sqrt(np.mean((base[idx] - val[idx]) ** 2)), float(np.mean(val[idx])))
            # error by value tier (where the model is weakest)
            tiers = [(-999, 0), (0, 50), (50, 150), (150, 300), (300, 9999)]
            tier_rows = []
            for lo, hi in tiers:
                idx = [i for i, mm in enumerate(meta) if lo <= mm[3] < hi]
                tier_rows.append((lo, hi, len(idx), math.sqrt(np.mean((pred[idx] - val[idx]) ** 2)), float(np.mean(pred[idx] - val[idx]))))
    rep += ['', 'Next season (k=1) by age:', f"{'age':>7} {'n':>6} {'model':>7} {'same as last yr':>15} {'mean actual':>11}"]
    for (a, b), (n, rm, rb, mv) in by_age.items():
        rep.append(f'{str(a) + "-" + str(b if b < 99 else "+"):>7} {n:>6} {rm:>7.1f} {rb:>15.1f} {mv:>11.1f}')
    rep += ['', 'Next season by last season\'s value (bias = mean predicted minus actual):', f"{'value in t':>12} {'n':>6} {'RMSE':>7} {'bias':>7}"]
    for lo, hi, n, rm, bias in tier_rows:
        rep.append(f'{str(lo) + " to " + str(hi):>12} {n:>6} {rm:>7.1f} {bias:>7.1f}')
    open(os.path.join(OUT, 'proj_eval.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))
    json.dump({'C': C, 'alpha': alpha}, open(os.path.join(OUT, 'proj_hp.json'), 'w'))


def fit_all():
    rows, by = table()
    hp = json.load(open(os.path.join(OUT, 'proj_hp.json')))
    os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)
    only = os.environ.get('GM_FIT_ONLY')            # the yearly refit writes just the new version; old ones never change
    for T in ([int(only)] if only else range(1985, LAST_COMPLETE + 1)):
        ver = {'version': f'{VERSION}@{T}', 'fit_through_season_end': T, 'features': NAMES, 'k': {}}
        for k in range(1, K + 1):
            X, inn, val, grp, _ = pairs(by, k, last=T)
            if len(val) < 200:
                continue
            ver['k'][k] = dict(Model(hp['C'], hp['alpha']).fit(X, inn, val).dump(), n=len(val))
        json.dump(ver, open(os.path.join(OUT, 'models', f'proj_{T}.json'), 'w'))
    print('versions', LAST_COMPLETE - 1985 + 1)


if __name__ == '__main__':
    {'eval': evaluate, 'fit': fit_all}[sys.argv[1] if len(sys.argv) > 1 else 'eval']()
