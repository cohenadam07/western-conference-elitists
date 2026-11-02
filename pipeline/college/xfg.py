"""
xfg.py — expected field-goal % for every college shot. §6F, step 9.

Inputs: distance, angle, shot family (dunk, layup, tip, hook, jumper), two or three, putback,
transition, home/road/neutral. The shooter is not a feature: the model says how often D1 makes that
shot, and whatever he does above it is his.

NOT the assisted flag. It is only recorded on makes, so it would tell the model the answer.

Arena term. College scorekeepers disagree about what a jumper and a layup are, and that is the
largest known bias in shot data. After the model is fit, each venue gets a shrunk log-odds residual
per zone class (rim, or everything else); `check` asks whether the term measures the building or the
team that plays in it: a scorekeeper's habit shows up for the visitors too, so a venue's residual on
the road team's shots must correlate with its residual on the home team's.

Validation: fit on everything before the newest finished season and score that season, unseen.
Log-loss against a distance-only model; calibration by decile.

    python3 xfg.py check             validation report, <home>/xfg-report.json
    python3 xfg.py fit               final fit on all finished seasons -> seed/xfg_model.joblib
    apply(season) -> player xFG%, used by build.py
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import rebuild as R  # noqa: E402
import season as SZ  # noqa: E402

MODEL = os.path.join(HERE, "seed", "xfg_model.joblib")
FAMS = ["dunk", "tip", "layup", "hook", "jumper"]
ARENA_K = 200.0        # shots of shrinkage per venue-zone
FEATS = ["dist", "angle", "fam", "three", "pb", "tr", "site"]


def shots(season):
    d = os.path.join(SZ.OUT, season)
    S = pd.read_pickle(os.path.join(d, "shots.pkl"))
    G = pd.read_pickle(os.path.join(d, "games.pkl")).set_index("gid")
    S = S[S.gid.map(G.pbp_ok) & S.gid.map(G.non_d1).eq(0)].copy()
    S["venue"] = S.gid.map(G.venue).astype(str)
    S["season"] = season
    home = S.gid.map(G.home)
    neutral = S.gid.map(G.neutral).astype(bool)
    S["site"] = np.where(neutral, 0, np.where(S.team == home, 1, -1))
    return S


def frame_x(S):
    X = pd.DataFrame(index=S.index)
    x = S.x.astype(float)
    y = S.y.astype(float)
    X["dist"] = np.hypot(x - 25, y)
    X["angle"] = np.degrees(np.arctan2(np.abs(x - 25), y.clip(lower=0.1)))
    X["fam"] = pd.Categorical(S.fam, categories=FAMS)
    X["three"] = S.three.astype(int)
    X["pb"] = S.pb.astype(int)
    X["tr"] = S.tr.astype(int)
    X["site"] = S.site.astype(int)
    return X


def clf():
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=32, min_samples_leaf=300, l2_regularization=1.0, categorical_features="from_dtype", random_state=7)


def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def expit(x):
    return 1 / (1 + np.exp(-x))


def zclass(S):
    return np.where(S.zone.values == "rim", "rim", "other")


def arena_terms(S, p):
    """Shrunk log-odds residual per (venue, zone class): (made - expected) / information."""
    t = pd.DataFrame({"v": S.venue.values, "z": zclass(S), "r": S.made.values - p, "i": p * (1 - p)})
    g = t.groupby(["v", "z"]).agg(r=("r", "sum"), i=("i", "sum"), n=("r", "size"))
    g["a"] = g.r / (g.i + ARENA_K * 0.22)
    return g


def apply_arena(S, p, g):
    key = pd.MultiIndex.from_arrays([S.venue.values, zclass(S)])
    a = g.a.reindex(key).fillna(0.0).values
    return expit(logit(p) + a)


def season_shift(p, y):
    lo, hi = -2.0, 2.0
    target = float(np.mean(y))
    lp = logit(p)
    for _ in range(40):
        mid = (lo + hi) / 2
        if np.mean(expit(lp + mid)) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def check(train, test):
    tr = pd.concat([shots(s) for s in train])
    te = shots(test)
    tr, te = tr[tr.x.notna()], te[te.x.notna()]
    Xtr, Xte = frame_x(tr), frame_x(te)
    ytr, yte = tr.made.values, te.made.values
    m = clf().fit(Xtr, ytr)
    p0tr, p0 = m.predict_proba(Xtr)[:, 1], m.predict_proba(Xte)[:, 1]
    base = clf().fit(Xtr[["dist"]], ytr).predict_proba(Xte[["dist"]])[:, 1]
    g = arena_terms(tr, p0tr)
    p1 = apply_arena(te, p0, g)
    out = dict(train=train, test=test, shots_train=len(tr), shots_test=len(te), logloss_distance_only=round(ll(yte, base), 5), logloss_model=round(ll(yte, p0), 5), logloss_with_arena=round(ll(yte, p1), 5))
    p = expit(logit(p1) + season_shift(p1, yte))
    out["logloss_recentred"] = round(ll(yte, p), 5)
    d = pd.qcut(p, 10, labels=False, duplicates="drop")
    cal = pd.DataFrame({"p": p, "y": yte, "d": d}).groupby("d").agg(pred=("p", "mean"), made=("y", "mean"), n=("y", "size"))
    out["calibration"] = [[int(i) + 1, round(float(r.pred), 3), round(float(r.made), 3), int(r.n)] for i, r in cal.iterrows()]
    out["calibration_worst"] = round(float(abs(cal.pred - cal.made).max()), 4)
    # arena term: building or team?
    home = tr[tr.site == 1]
    road = tr[tr.site == -1]
    ph, pr = p0tr[(tr.site == 1).values], p0tr[(tr.site == -1).values]
    gh, gr = arena_terms(home, ph), arena_terms(road, pr)
    rows = {}
    for z in ("rim", "other"):
        a = gh.xs(z, level="z")
        b = gr.xs(z, level="z")
        ix = a[a.n >= 400].index.intersection(b[b.n >= 400].index)
        rows[z] = dict(venues=len(ix), corr_home_road=round(float(np.corrcoef(a.a.reindex(ix), b.a.reindex(ix))[0, 1]), 3), spread_sd=round(float(g.xs(z, level="z").a.std()), 3))
    out["arena"] = rows
    json.dump(out, open(os.path.join(CC.HOME, "xfg-report.json"), "w"), indent=1)
    print(json.dumps(out)[:1400])
    return out


def fit(seasons):
    import joblib
    tr = pd.concat([shots(s) for s in seasons])
    tr = tr[tr.x.notna()]
    X = frame_x(tr)
    m = clf().fit(X, tr.made.values)
    p = m.predict_proba(X)[:, 1]
    g = arena_terms(tr, p)
    joblib.dump({"clf": m, "arena": g, "seasons": seasons}, MODEL, compress=3)
    print("fit on", len(tr), "shots", os.path.getsize(MODEL) // 1024, "KB")


def apply(season):
    """{eid: (expected points per FGA, actual, shots)}. A season's shift re-centres the league to
    its own actual FG%, which takes out era drift and is exact, not leakage."""
    import joblib
    M = joblib.load(MODEL)
    S = shots(season)
    S = S[S.x.notna()]
    if not len(S):
        return pd.DataFrame(columns=["xfg", "fg", "shots"]), S
    p = apply_arena(S, M["clf"].predict_proba(frame_x(S))[:, 1], M["arena"])
    y = S.made.values
    p = expit(logit(p) + season_shift(p, y))
    S["xp"] = p
    v = 1 + 0.5 * S.three.values
    t = pd.DataFrame({"e": S.eid.values, "xe": p * v, "ae": y * v, "n": 1.0}).groupby("e").agg(xefg=("xe", "mean"), efg=("ae", "mean"), n=("n", "sum"))
    return t, S


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "check":
        a = sys.argv[2:]
        check(a[:-1], a[-1])
    elif cmd == "fit":
        fit(sys.argv[2:])
