"""
college_value.py — Savant value for college, the number the All-Savant Teams are picked on.

The method is Basketball Savant's (tools/savant-value/value.py), in the same five steps:

  1. The job: scoring, playmaking, rebounding, defense, from opponent-adjusted stats.
  2. Luck: every stat is pulled toward its position's average by this site's measured settle points.
  3. Worth: what a stat is worth. `test` decides where that comes from.
  4. The floor: from 2024-25, where lineups exist, the box estimate moves toward what actually
     happened with him on the floor, as far as his minutes have earned it. Before that the rate is
     box score only, as Basketball Savant does before 2009-10.
  5. Value = (rate - replacement) × possessions ÷ 100. Replacement is the 25th-percentile qualified
     rate at his position that season. He earns nothing on nights he doesn't play.

    python3 college_value.py test     the weight test: refit vs box impact, on next-season on/off
    python3 college_value.py fit      writes seed/value_model.json
"""
import gzip
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import config as C  # noqa: E402

MODEL = os.path.join(HERE, "seed", "value_model.json")
PUBLIC = os.environ.get("CBB_PUBLIC") or os.path.join(HERE, "..", "..", "public")
POSITIONS = ["Guard", "Wing", "Big"]
REPL_PCT = 25
MIN_FIT_MIN = 250
FEATS = ["sceff", "usg", "tp3r", "ftr", "ast", "tov", "oreb", "dreb", "stl", "blk"]
PARTS = [("scoring", ["sceff", "usg", "tp3r", "ftr"]), ("playmaking", ["ast", "tov"]), ("rebounding", ["oreb", "dreb"]), ("defense", ["stl", "blk"])]
# feature -> (doc stat, settle key, sample column)
STAT = {"usg": ("usg", "usg", "poss"), "tp3r": ("tpar", "tpar", "n_fga"), "ftr": ("ftr", "ftr", "n_fga"), "ast": ("ast_pct", "ast_pct", "n_astd"), "tov": ("tov_pct", "tov_pct", "n_u"),
        "oreb": ("orb_pct", "orb_pct", "n_orbd"), "dreb": ("drb_pct", "drb_pct", "n_drbd"), "stl": ("stl_pct", "stl_pct", "dposs"), "blk": ("blk_pct", "blk_pct", "n_blkd")}


def read_doc(season, public=PUBLIC):
    return json.loads(gzip.decompress(open(os.path.join(public, "cbb", "s", f"{season}.json.gz"), "rb").read()))


def col(doc, k):
    c = doc["values"].get(k) or {}
    return c.get("ag") or c.get("a") or c.get("rg") or c.get("r")


def wmean(v, w):
    v, w = np.asarray(v, float), np.asarray(w, float)
    m = np.isfinite(v) & np.isfinite(w) & (w > 0)
    return float((v[m] * w[m]).sum() / w[m].sum()) if m.any() else float("nan")


def nums(a, n):
    return np.array([np.nan if x is None else float(x) for x in (a or [None] * n)], float)


def features(doc, settle):
    """Every player's shrunk, position-demeaned features for one season."""
    P = doc["players"]
    n = len(P)
    pos = np.array([p[3] for p in P], dtype=object)
    S = {k: nums(v, n) for k, v in doc["samples"].items()}
    ts = nums(col(doc, "ts"), n) / 100
    pts100 = nums(col(doc, "pts"), n) * 100
    lg_ts = wmean(ts, S["n_tsa"])
    X = {f: np.zeros(n) for f in FEATS}
    u_per = np.where(S["poss"] > 0, S["n_u"] / np.where(S["poss"] > 0, S["poss"], 1), 0.0)
    for ps in POSITIONS:
        m = pos == ps
        if not m.any():
            continue
        for f, (stat, sk, smp) in STAT.items():
            v, nn = nums(col(doc, stat), n), np.nan_to_num(S[smp])
            mu = wmean(v[m], nn[m])
            k = settle[sk]["k"]
            sh = np.where(np.isfinite(v), (nn * v + k * mu) / (nn + k), mu)
            d = sh - mu
            X[f][m] = (d * u_per if f == "tov" else d)[m]       # turnover share -> turnovers per 100
        mu_ts = wmean(ts[m], S["n_tsa"][m])
        k = settle["ts"]["k"]
        nn = np.nan_to_num(S["n_tsa"])
        sh = np.where(np.isfinite(ts), (nn * ts + k * mu_ts) / (nn + k), mu_ts)
        tsa100 = np.where(np.nan_to_num(ts) > 0, np.nan_to_num(pts100) / (2 * np.where(np.nan_to_num(ts) > 0, ts, 1)), 0.0)
        raw = 2 * tsa100 * (sh - lg_ts)
        X["sceff"][m] = (raw - wmean(raw[m], S["poss"][m]))[m]
    return X


def onoff_w(on_poss, share):
    """A difference of two samples is only as good as the smaller of them."""
    on = np.nan_to_num(on_poss)
    sh = np.nan_to_num(share) / 100
    team = np.where(sh > 0, on / np.where(sh > 0, sh, 1), 0.0)
    off = np.maximum(team - on, 1.0)
    return np.where(on > 0, 1.0 / (1.0 / np.maximum(on, 1.0) + 1.0 / off), 0.0)


class Season:
    def __init__(self, season, settle):
        d = read_doc(season)
        self.season, self.doc = season, d
        P = d["players"]
        n = len(P)
        self.id = np.array([p[0] for p in P], dtype=object)
        self.pos = np.array([p[3] for p in P], dtype=object)
        self.team = np.array([p[2] for p in P], dtype=object)
        self.qual = np.array([bool(p[11]) for p in P])
        self.minutes = nums([p[10] for p in P], n)
        self.poss = nums(d["samples"]["poss"], n)
        self.share = nums(d["values"]["min_share"]["r"], n)
        self.X = features(d, settle)
        self.oo = nums(d["values"]["onoff_luck"]["r"], n)
        self.on_poss = nums(d["samples"].get("on_poss"), n)
        self.w = onoff_w(self.on_poss, self.share)
        self.oo_dm, self.ms_dm = np.full(n, np.nan), np.zeros(n)
        self.bi = nums(d["values"]["bi"]["r"], n)
        for ps in POSITIONS:
            m = self.pos == ps
            if not m.any():
                continue
            self.ms_dm[m] = (self.share - wmean(self.share[m], self.minutes[m]))[m]
            f = m & np.isfinite(self.oo)
            if f.any():
                self.oo_dm[f] = (self.oo - wmean(self.oo[f], self.w[f]))[f]

    def design(self, m):
        return np.c_[np.ones(m.sum())] if False else np.column_stack([np.ones(m.sum())] + [self.X[f][m] for f in FEATS] + [self.ms_dm[m]])


def ridge(X, y, w, lam):
    sd = X[:, 1:].std(0)
    sd[sd == 0] = 1.0
    Xs = X.copy()
    Xs[:, 1:] /= sd
    W = np.sqrt(w)[:, None]
    A = (Xs * W).T @ (Xs * W) + lam * np.diag([0.0] + [1.0] * (X.shape[1] - 1))
    b = np.linalg.solve(A, (Xs * W).T @ (y * W[:, 0]))
    b[1:] /= sd
    return b


def fit_box(ss, lam):
    Xs, ys, ws = [], [], []
    for s in ss:
        m = np.isfinite(s.oo_dm) & (np.nan_to_num(s.minutes) >= MIN_FIT_MIN) & (s.w > 0)
        Xs.append(s.design(m)); ys.append(s.oo_dm[m]); ws.append(s.w[m])
    return ridge(np.vstack(Xs), np.concatenate(ys), np.concatenate(ws), lam)


def rate_box(s, b, credit=None):
    c = credit or {}
    return sum(b[1 + i] * c.get(f, 1.0) * s.X[f] for i, f in enumerate(FEATS))


def pairs(a, b, gamma):
    """Returning players with real minutes in both seasons at the same position."""
    nx = {e: i for i, e in enumerate(b.id)}
    out = []
    for i, e in enumerate(a.id):
        j = nx.get(e)
        if j is None or not np.isfinite(a.oo_dm[i]) or not np.isfinite(b.oo_dm[j]):
            continue
        if a.minutes[i] < MIN_FIT_MIN or b.minutes[j] < MIN_FIT_MIN or a.pos[i] != b.pos[j]:
            continue
        out.append((i, j, b.oo_dm[j] - gamma * b.ms_dm[j], b.w[j]))
    return out


def score(pred, ps):
    t = np.array([p[2] for p in ps])
    w = np.array([p[3] for p in ps])
    e = pred - t
    pm = np.average(pred, weights=w)
    tm = np.average(t, weights=w)
    r = np.average((pred - pm) * (t - tm), weights=w) / math.sqrt(np.average((pred - pm) ** 2, weights=w) * np.average((t - tm) ** 2, weights=w))
    return dict(rmse=round(float(math.sqrt(np.average(e * e, weights=w))), 3), r=round(float(r), 3))


def bi_refit(train_seasons):
    """Box impact, refit on the training season's RAPM alone, so the test has no leak."""
    import rapm as RP
    rows = []
    for x in train_seasons:
        rows += RP.load_stints(x)
    ids = sorted({e for r in rows for e in r[3] + r[4]})
    o, d, _, _ = RP.solve(rows, ids, lam=RP.LAM)
    f = RP.box_rates(train_seasons)
    ff = f[f.index.isin(ids) & (f.poss >= 300)]
    W = np.sqrt(ff.poss.values)[:, None]
    co = {}
    for nm, feats, tgt in (("off", RP.BOX_FEATS_O, o), ("def", RP.BOX_FEATS_D, d)):
        X = np.c_[np.ones(len(ff)), ff[feats].values]
        reg = np.eye(X.shape[1]); reg[0, 0] = 0
        bb = np.linalg.solve((X * W).T @ (X * W) + reg, (X * W).T @ (tgt.reindex(ff.index).values * W[:, 0]))
        co[nm] = dict(zip(["c"] + feats, [float(v) for v in bb]))
    return co


def bi_on(season, co):
    import aggregate as A
    import pandas as pd
    import rapm as RP
    df = A.frame(season)
    df = df[df.non_d1 == 0]
    t = pd.DataFrame(A.counts(df)).assign(e=df.eid.values).groupby("e").sum()
    o, d = RP.box_impact(RP.features(t), co)
    return (o + d)


BI_FEATS = {"off": ["pts", "ast", "tov", "orb", "fg3a", "fta", "fga", "rima"], "def": ["dreb", "stl", "blk", "pf"]}
BI_PARTS = {"scoring": ["pts", "fg3a", "fta", "fga", "rima"], "playmaking": ["ast", "tov"], "rebounding": ["orb", "dreb"], "defense": ["stl", "blk", "pf"]}
# what each box-impact feature settles on: (settle key, sample column)
BI_SETTLE = {"pts": ("pts", "poss"), "ast": ("ast", "poss"), "tov": ("tov", "poss"), "orb": ("orb_pct", "n_orbd"), "fg3a": ("tpar", "n_fga"), "fta": ("ftr", "n_fga"), "fga": ("usg", "poss"),
             "rima": ("rim_fg", "n_rim"), "dreb": ("drb_pct", "n_drbd"), "stl": ("stl_pct", "dposs"), "blk": ("blk_pct", "n_blkd"), "pf": ("pf", "dposs")}


def bi_stats(doc):
    """Per-100 box stats from the published table, opponent-adjusted where the stat has it."""
    n = len(doc["players"])
    S = {k: np.nan_to_num(nums(v, n)) for k, v in doc["samples"].items()}
    p = np.where(S["poss"] > 0, S["poss"], np.nan)
    q = np.where(S["dposs"] > 0, S["dposs"], np.nan)
    v = lambda k: nums(col(doc, k), n)  # noqa: E731
    return {"pts": 100 * v("pts"), "ast": 100 * v("ast"), "tov": v("tov_pct") * S["n_u"] / p, "orb": v("orb_pct") * S["n_orbd"] / p, "fg3a": 100 * S["n_fg3a"] / p, "fta": 100 * S["n_fta"] / p, "fga": 100 * S["n_fga"] / p,
            "rima": np.nan_to_num(v("rim_fg")) * S["n_rim"] / p, "dreb": v("drb_pct") * S["n_drbd"] / q, "stl": v("stl_pct"), "blk": v("blk_pct") * S["n_blkd"] / q, "pf": 100 * v("pf")}


def bi_x(doc, settle):
    """Those stats shrunk by their settle points and centred on the position, as in the refit."""
    n = len(doc["players"])
    pos = np.array([p[3] for p in doc["players"]], dtype=object)
    S = {k: np.nan_to_num(nums(v, n)) for k, v in doc["samples"].items()}
    raw = bi_stats(doc)
    X = {f: np.zeros(n) for f in raw}
    for ps in POSITIONS:
        m = pos == ps
        if not m.any():
            continue
        for f, v in raw.items():
            sk, smp = BI_SETTLE[f]
            mu = wmean(v[m], S["poss"][m])
            k = settle[sk]["k"]
            sh = np.where(np.isfinite(v), (S[smp] * v + k * mu) / (S[smp] + k), mu)
            X[f][m] = (sh - mu)[m]
    return X


def bi_rate(doc, settle, co):
    X = bi_x(doc, settle)
    return sum(co["off"][f] * X[f] for f in BI_FEATS["off"]) + sum(co["def"][f] * X[f] for f in BI_FEATS["def"])


def cv_lambda(a, grid=(1e2, 1e3, 1e4, 3e4, 1e5, 3e5, 1e6), folds=5):
    """The penalty, chosen inside the training season only. Scoring it on the target would be a leak."""
    m = np.isfinite(a.oo_dm) & (np.nan_to_num(a.minutes) >= MIN_FIT_MIN) & (a.w > 0)
    X, y, w = a.design(m), a.oo_dm[m], a.w[m]
    idx = np.arange(len(y)) % folds
    best = None
    for lam in grid:
        e = 0.0
        for f in range(folds):
            tr = idx != f
            b = ridge(X[tr], y[tr], w[tr], lam)
            e += float((w[~tr] * (X[~tr] @ b - y[~tr]) ** 2).sum())
        if best is None or e < best[1]:
            best = (lam, e)
    return best[0]


def test():
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    a, b = Season("2024-25", settle), Season("2025-26", settle)
    lam = cv_lambda(a)
    beta = fit_box([a], lam)
    ps = pairs(a, b, beta[-1])
    idx = [p[0] for p in ps]
    refit = score(rate_box(a, beta)[idx], ps)
    co = bi_refit(["2024-25"])
    bi = score(bi_rate(a.doc, settle, co)[idx], ps)
    out = dict(pairs=len(ps), train="2024-25", target="2025-26 luck-adjusted on/off, position-demeaned, minutes share taken out", refit=refit, refit_lambda=lam, lambda_chosen_by="5-fold cross-validation inside 2024-25", box_impact=bi,
               guess_zero=score(np.zeros(len(ps)) + 1e-9 * np.arange(len(ps)), ps)["rmse"], last_year_onoff=score(np.nan_to_num(a.oo_dm)[idx], ps))
    out["winner"] = "refit" if refit["rmse"] < bi["rmse"] else "box_impact"
    json.dump(out, open(os.path.join(CC.HOME, "value-test.json"), "w"), indent=1)
    print(json.dumps(out))
    return out


def credit(ss, min_poss=500):
    """Carry-over of each stat for transfers over stayers: the share of a stat that is his, not his team's."""
    out = {}
    for f in FEATS:
        res = {}
        for changed in (False, True):
            A_, B_, W_ = [], [], []
            for a, b in zip(ss, ss[1:]):
                nx = {e: i for i, e in enumerate(b.id)}
                for i, e in enumerate(a.id):
                    j = nx.get(e)
                    if j is None or a.pos[i] != b.pos[j] or a.poss[i] < min_poss or b.poss[j] < min_poss or (a.team[i] != b.team[j]) != changed:
                        continue
                    A_.append(a.X[f][i]); B_.append(b.X[f][j]); W_.append(min(a.poss[i], b.poss[j]))
            x, y, w = map(np.array, (A_, B_, W_))
            mx, my = np.average(x, weights=w), np.average(y, weights=w)
            res[changed] = float((w * (x - mx) * (y - my)).sum() / math.sqrt((w * (x - mx) ** 2).sum() * (w * (y - my) ** 2).sum()))
        out[f] = round(min(1.0, max(0.0, res[True] / res[False])), 4)
    return out


def rate_full(s, beta, cr, K, gamma):
    p = rate_box(s, beta, cr)
    expect = beta[0] + rate_box(s, beta) + gamma * s.ms_dm
    if K is None:
        return p, np.zeros(len(p))
    sh = s.w / (s.w + K)
    fl = np.where(np.isfinite(s.oo_dm), sh * (np.nan_to_num(s.oo_dm) - expect), 0.0)
    return p + fl, fl


def fit():
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    test_ = json.load(open(os.path.join(CC.HOME, "value-test.json")))
    if test_["winner"] != "refit":
        raise SystemExit("box impact won the weight test: apply() needs its basis")
    ss = [Season(x, settle) for x in C.SEASONS if x != C.CURRENT]
    court = [s for s in ss if s.season in ("2024-25", "2025-26")]
    lam = test_["refit_lambda"]
    beta = fit_box(court, lam)
    gamma = float(beta[-1])
    cr = credit(ss)
    # how far to move toward the floor: only the one pair of seasons can say
    a, b = court
    b1 = fit_box([a], lam)
    ps = pairs(a, b, b1[-1])
    grid = [None] + [100 * 2 ** (i / 2) for i in range(0, 20)]
    best = None
    for K in grid:
        r, _ = rate_full(a, b1, cr, K, b1[-1])
        e = score(r[[p[0] for p in ps]], ps)["rmse"]
        if best is None or e < best[1]:
            best = (K, e)
    K = best[0]
    # the scale: a team's minutes-weighted sum of rates should equal its net rating
    xs, ys = [], []
    for s in ss:
        rt = json.load(open(os.path.join(CC.HOME, "ratings", f"{s.season}.json")))["teams"]
        r, _ = rate_full(s, beta, cr, K, gamma)
        acc = {}
        for i, t in enumerate(s.team):
            if t in rt:
                acc[t] = acc.get(t, 0.0) + r[i] * np.nan_to_num(s.share[i]) / 100
        for t, v in acc.items():
            xs.append(v); ys.append(rt[t]["net"])
    xs, ys = np.array(xs), np.array(ys)
    scale = float((xs * ys).sum() / (xs * xs).sum())
    model = dict(version=1, feats=FEATS, intercept=float(beta[0]), beta={f: round(float(beta[1 + i]), 5) for i, f in enumerate(FEATS)}, gamma=round(gamma, 5), K=K, scale=round(scale, 4), team_r=round(float(np.corrcoef(xs, ys)[0, 1]), 3),
                 credit=cr, lam=lam, repl_pct=REPL_PCT, settle_keys={f: v[1] for f, v in STAT.items()}, fit_seasons=[s.season for s in court], k_test_rmse=best[1])
    os.makedirs(os.path.dirname(MODEL), exist_ok=True)
    json.dump(model, open(MODEL, "w"), indent=1)
    print(json.dumps({k: v for k, v in model.items() if k != "settle_keys"}))


def pctile(v, p):
    v = sorted(v)
    h = (len(v) - 1) * p / 100.0
    lo = int(math.floor(h))
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (h - lo) * (v[hi] - v[lo])


def apply_doc(doc, season, m=None):
    """Writes value, rate and its parts into a season's table, in place."""
    m = m or json.load(open(MODEL))
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    P = doc["players"]
    n = len(P)
    pos = np.array([p[3] for p in P], dtype=object)
    qual = np.array([bool(p[11]) for p in P])
    X = features(doc, settle)
    beta = np.array([m["intercept"]] + [m["beta"][f] for f in FEATS] + [m["gamma"]])
    cr = m["credit"]
    box = {k: sum(m["beta"][f] * cr.get(f, 1.0) * X[f] for f in fs) for k, fs in PARTS}
    share = nums(doc["values"]["min_share"]["r"], n)
    mins = nums([p[10] for p in P], n)
    oo = nums(doc["values"]["onoff_luck"]["r"], n)
    w = onoff_w(nums(doc["samples"].get("on_poss"), n), share)
    oo_dm, ms_dm = np.full(n, np.nan), np.zeros(n)
    for ps in POSITIONS:
        k = pos == ps
        if k.any():
            ms_dm[k] = (share - wmean(share[k], mins[k]))[k]
            f = k & np.isfinite(oo)
            if f.any():
                oo_dm[f] = (oo - wmean(oo[f], w[f]))[f]
    full = sum(beta[1 + i] * X[f] for i, f in enumerate(FEATS))
    if "floor_a" in m:          # the team-results model: on/off expected from the box rate it fitted
        expect = m["floor_a"] + m["floor_b"] * sum(m["beta"][f] * X[f] for f in FEATS) + m["gamma"] * ms_dm
    else:
        expect = beta[0] + full + m["gamma"] * ms_dm
    sh = w / (w + m["K"]) if m["K"] else np.zeros(n)
    floor = np.where(np.isfinite(oo_dm), sh * (np.nan_to_num(oo_dm) - expect), 0.0)
    c = m["scale"]
    rate = c * (sum(box.values()) + floor)
    poss = nums(doc["samples"]["poss"], n)
    repl = {}
    value = np.full(n, np.nan)
    for ps in POSITIONS:
        k = (pos == ps)
        q = rate[k & qual]
        repl[ps] = float(pctile(q.tolist(), REPL_PCT)) if len(q) else 0.0
        value[k] = ((rate - repl[ps]) * np.nan_to_num(poss) / 100.0)[k]
    r2 = lambda a, d=2: [None if not np.isfinite(x) else round(float(x), d) for x in a]  # noqa: E731
    doc["values"]["value"] = {"r": r2(value, 1)}
    doc["vparts"] = dict({k: r2(c * v) for k, v in box.items()}, floor=r2(c * floor), rate=r2(rate))
    doc["repl"] = {k: round(v, 3) for k, v in repl.items()}
    return doc


def dump():
    """The Python's own answer for every player, recomputed from the model, for the check to hold the
    published files, the page's math and the connector to. Finished seasons only: one in progress is
    rebuilt every day, so a dump of it is stale by the next refresh and the check holds it to its own
    structure instead (tools/savant-cbb/value.mjs)."""
    m = json.load(open(MODEL))
    out = {}
    for s in C.SEASONS:
        p = os.path.join(PUBLIC, "cbb", "s", f"{s}.json.gz")
        if not os.path.exists(p):
            continue
        with gzip.open(os.path.join(PUBLIC, "cbb", "allsavant", f"{s}.json.gz")) as fh:
            if not json.load(fh).get("final"):
                continue
        d = read_doc(s)
        apply_doc(d, s, m)
        out[s] = {"ids": [x[0] for x in d["players"]], "value": d["values"]["value"]["r"], "repl": d["repl"]}
    path = os.path.join(HERE, "..", "..", "tools", "savant-cbb", "expected-value.json.gz")
    with open(path, "wb") as fh:
        fh.write(gzip.compress(json.dumps(out, separators=(",", ":")).encode(), 9, mtime=0))
    print("expected values for", sum(len(v["ids"]) for v in out.values()), "player-seasons")


if __name__ == "__main__":
    {"test": test, "fit": fit, "dump": dump}[sys.argv[1]]()
