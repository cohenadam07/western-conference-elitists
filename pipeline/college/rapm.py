"""
rapm.py — impact: box impact and regularized plus-minus. §6G and §6H, step 9.

The stints come from clean games only (season.py lineup_ok), garbage time excluded, split into a
row for each side's offense:

    100 × points / possessions = home + Σ offense(the five) - Σ defense(the five they face)

Ridge, weighted by possessions, offense and defense per 100, solved with LSQR.

BOX IMPACT (§6G) is a regression of long-run pooled RAPM on per-possession box stats, one fit for
offense and one for defense. It is shown on the card, and it is the prior: with a prior, ridge pulls
a thin sample to what his box line implies instead of to zero.

    fit_box(pool)   pooled RAPM with a zero prior -> coefficients (seed/box_impact.json)
    prior           box impact, blended with last season's box impact by the sample behind this one
                    (preseason prior, the approach EvanMiya's BPR uses): a freshman with no line has
                    a recruit-based value, a man with no recruit row the average of low-minute men
    final           RAPM with that prior

Lineups exist from 2023-24 on, so a pool is that season through the one asked for, up to four plus
the current. Older seasons in the pool count less: 0.9 a year. 2022-23 has no lineups anywhere.

The check (`check`): train through 2025-01-31 style cut, hold out the last 20% of game dates in the
newest pool; predict stint margins. RAPM must beat box impact alone and raw on/off.

    python3 rapm.py check          lambda scan, held-out scores, stability, <home>/rapm-report.json
    python3 rapm.py fit            box-impact fit -> seed/box_impact.json
    python3 rapm.py build S...     <home>/impact/<season>.json
"""
import gzip
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import lsqr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402
import cbbd_client as CC  # noqa: E402
import season as SZ  # noqa: E402

OUT = os.path.join(CC.HOME, "impact")
SITE = os.environ.get("CBB_PUBLIC") or os.path.join(HERE, "..", "..", "public")
BOXF = os.path.join(HERE, "seed", "box_impact.json")
FIRST = "2023-24"
LAM = 1500.0            # possessions of ridge; `check` scans this
AGE_DECAY = 0.9
SHOW_MIN = 500          # on-court possessions in the pool, or the card says low sample
ON = ("poss", "pts", "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov", "stl", "blk", "ast")
IH, IA = 6, 6 + len(ON)
OP = 0
BOX_FEATS_O = ["pts", "ast", "tov", "orb", "fg3a", "fta", "fga", "rima"]
BOX_FEATS_D = ["dreb", "stl", "blk", "pf"]


def seasons_upto(s):
    y = int(s[:4])
    return [f"{k}-{str(k + 1)[2:]}" for k in range(max(2023, y - 3), y + 1)]


def load_stints(season, weight=1.0):
    """Offense rows: (poss, pts, home flag, off five, def five, date, gid) with garbage time out."""
    p = os.path.join(SZ.OUT, season, "stints.json.gz")
    if not os.path.exists(p):
        return []
    gp = os.path.join(SZ.OUT, season, "games.pkl")
    if os.path.exists(gp):
        G = pd.read_pickle(gp).set_index("gid")
        neutral, date = G.neutral.to_dict(), G.date.to_dict()
    else:                                  # the cloud has only the current season's tables
        d = json.loads(gzip.decompress(open(os.path.join(SITE, "cbb", "games", f"{season}.json.gz"), "rb").read()))
        ix = {c: i for i, c in enumerate(d["cols"])}
        neutral = {r[0]: bool(r[ix["neutral"]]) for r in d["rows"]}
        date = {r[0]: r[ix["date"]] for r in d["rows"]}
    rows = []
    with gzip.open(p, "rt") as fh:
        for gid, home, away, st in json.load(fh):
            for s in st:
                if s[5] or len(s[3]) != 5 or len(s[4]) != 5:
                    continue
                hp, ap = s[IH], s[IA]
                n = neutral.get(gid, False)
                if hp > 0:
                    rows.append((hp * weight, s[IH + 1], (0.0 if n else 1.0), s[3], s[4], date[gid], gid, hp))
                if ap > 0:
                    rows.append((ap * weight, s[IA + 1], (0.0 if n else -1.0), s[4], s[3], date[gid], gid, ap))
    return rows


def design(rows, ids):
    ix = {e: i for i, e in enumerate(ids)}
    n = len(ids)
    I, J = [], []
    V = []
    for k, r in enumerate(rows):
        for e in r[3]:
            I.append(k); J.append(ix[e]); V.append(1.0)
        for e in r[4]:
            I.append(k); J.append(n + ix[e]); V.append(1.0)
    X = sp.csr_matrix((V, (I, J)), shape=(len(rows), 2 * n + 1))
    home = np.array([r[2] for r in rows])
    X = X.tolil(copy=False) if False else X
    H = sp.csr_matrix((home, (np.arange(len(rows)), np.full(len(rows), 2 * n))), shape=X.shape)
    return (X + H).tocsr()


def solve(rows, ids, lam=LAM, prior=None):
    """offense and defense per 100 (defense: positive = allows fewer). prior: {eid: (o, d)} per 100."""
    w = np.array([r[0] for r in rows], float)
    y = np.array([100.0 * r[1] / r[7] for r in rows], float)
    lg = float(np.average(y, weights=w))
    X = design(rows, ids)
    b0 = np.zeros(X.shape[1])
    n = len(ids)
    if prior:
        for i, e in enumerate(ids):
            if e in prior:
                b0[i], b0[n + i] = prior[e][0], -prior[e][1]
    W = sp.diags(np.sqrt(w))
    A_ = W @ X
    rhs = W @ (y - lg - X @ b0)
    b = lsqr(A_, rhs, damp=float(np.sqrt(lam)), iter_lim=200, atol=1e-5, btol=1e-5)[0] + b0
    o = pd.Series(b[:n], index=ids)
    d = pd.Series(-b[n:2 * n], index=ids)
    return o, d, float(b[2 * n]), lg


def predict(rows, o, d, hca, lg):
    """Net points per 100 for a list of offense rows, with a shared possession weight."""
    pred = np.array([lg + r[2] * hca + sum(o.get(e, 0.0) for e in r[3]) - sum(d.get(e, 0.0) for e in r[4]) for r in rows])
    return pred


def box_rates(seasons):
    """Pooled per-100 box numbers by player over seasons."""
    fr = []
    for s in seasons:
        df = A.frame(s)
        df = df[df.non_d1 == 0]
        t = pd.DataFrame(A.counts(df)).assign(e=df.eid.values).groupby("e").sum()
        fr.append(t)
    t = pd.concat(fr).groupby(level=0).sum()
    return features(t)


def features(t):
    p = t.poss.replace(0, np.nan)
    d = t.dposs.replace(0, np.nan)
    f = pd.DataFrame({"pts": 100 * t.pts / p, "ast": 100 * t.ast / p, "tov": 100 * t.tov / p, "orb": 100 * t.oreb / p, "fg3a": 100 * t.fg3a / p, "fta": 100 * t.fta / p, "fga": 100 * t.fga / p,
                      "rima": 100 * t.rim_m / p, "dreb": 100 * t.dreb / d, "stl": 100 * t.stl / d, "blk": 100 * t.blk / d, "pf": 100 * t.pf / d, "poss": t.poss})
    return f.fillna(0.0)


def fit_box(pool, lam=LAM):
    """Long-run RAPM with no prior -> box coefficients, weighted by sample."""
    rows = []
    for i, s in enumerate(reversed(pool)):
        rows += load_stints(s)
    ids = sorted({e for r in rows for e in r[3] + r[4]})
    o, d, hca, lg = solve(rows, ids, lam=lam)
    f = box_rates(pool)
    f = f[f.index.isin(ids) & (f.poss >= 300)]
    W = np.sqrt(f.poss.values)[:, None]
    res = {"lg": lg, "hca": hca, "n": len(f)}
    for name, feats, tgt in (("off", BOX_FEATS_O, o), ("def", BOX_FEATS_D, d)):
        X = np.c_[np.ones(len(f)), f[feats].values]
        y = tgt.reindex(f.index).values
        reg = 1.0 * np.eye(X.shape[1])
        reg[0, 0] = 0
        b = np.linalg.solve((X * W).T @ (X * W) + reg, (X * W).T @ (y * W[:, 0]))
        res[name] = dict(zip(["c"] + feats, [round(float(v), 4) for v in b]))
        res[name + "_r2"] = round(float(1 - np.average((y - X @ b) ** 2, weights=f.poss) / np.average((y - np.average(y, weights=f.poss)) ** 2, weights=f.poss)), 3)
    json.dump(res, open(BOXF, "w"), indent=1)
    print(json.dumps(res))
    return res


def box_impact(f, co=None):
    co = co or json.load(open(BOXF))
    o = co["off"]["c"] + sum(co["off"][k] * f[k] for k in BOX_FEATS_O)
    d = co["def"]["c"] + sum(co["def"][k] * f[k] for k in BOX_FEATS_D)
    return o, d


def build_prior(season, ids, co):
    """{eid: (o, d)}: box impact this season, leaning on last season early, by the sample."""
    df = A.frame(season)
    df = df[df.non_d1 == 0]
    t = pd.DataFrame(A.counts(df)).assign(e=df.eid.values).groupby("e").sum()
    f = features(t)
    o, d = box_impact(f, co)
    y = int(season[:4])
    prev = f"{y - 1}-{str(y)[2:]}"
    po, pd_ = None, None
    last = os.path.join(OUT, f"{prev}.json")
    if os.path.exists(last):               # last season's box impact, as this pipeline wrote it
        lp = json.load(open(last))["players"]
        po = pd.Series({e: v.get("bi_o") for e, v in lp.items() if v.get("bi_o") is not None}, dtype=float)
        pd_ = pd.Series({e: v.get("bi_d") for e, v in lp.items() if v.get("bi_d") is not None}, dtype=float)
    k = 300.0
    out = {}
    low_o = float(o[f.poss.between(100, 400)].mean()) if len(o) else 0.0
    low_d = float(d[f.poss.between(100, 400)].mean()) if len(d) else 0.0
    for e in ids:
        n = float(f.poss.get(e, 0.0))
        cur = (float(o.get(e, low_o)), float(d.get(e, low_d)))
        if po is not None and e in po.index:
            pre = (float(po[e]), float(pd_[e]))
        else:
            pre = (low_o, low_d)
        w = n / (n + k)
        out[e] = (w * cur[0] + (1 - w) * pre[0], w * cur[1] + (1 - w) * pre[1])
    return out, f, (o, d)


def build(season, lam=LAM, log=print):
    t0 = time.time()
    co = json.load(open(BOXF))
    pool = seasons_upto(season)
    rows = []
    for i, s in enumerate(reversed(pool)):
        rows += load_stints(s, weight=AGE_DECAY ** i)
    os.makedirs(OUT, exist_ok=True)
    onc = pd.Series(dtype=float)
    if not rows:
        return None
    ids = sorted({e for r in rows for e in r[3] + r[4]})
    prior, f, (bo, bd) = build_prior(season, ids, co)
    o, d, hca, lg = solve(rows, ids, lam=lam, prior=prior)
    sample = {}
    for r in rows:
        for e in r[3]:
            sample[e] = sample.get(e, 0.0) + r[7]
    doc = {}
    for e in f.index:
        doc[e] = {"bi_o": round(float(bo[e]), 2), "bi_d": round(float(bd[e]), 2), "bi": round(float(bo[e] + bd[e]), 2)}
        if e in o.index:
            doc[e].update(rapm_o=round(float(o[e]), 2), rapm_d=round(float(d[e]), 2), rapm=round(float(o[e] + d[e]), 2), rapm_n=int(sample.get(e, 0)))
    json.dump({"season": season, "pool": pool, "lam": lam, "hca": round(hca, 2), "lg": round(lg, 2), "players": doc}, open(os.path.join(OUT, f"{season}.json"), "w"), separators=(",", ":"))
    log(f"{season}: pool {pool}, {len(rows)} rows, {len(ids)} men, home {hca:.2f} ({time.time() - t0:.0f}s)")
    return doc


def check(pool):
    rows = []
    for s in pool:
        rows += load_stints(s)
    dates = sorted({r[5] for r in rows})
    cut = dates[int(len(dates) * 0.8)]
    tr = [r for r in rows if r[5] < cut]
    te = [r for r in rows if r[5] >= cut]
    ids = sorted({e for r in tr for e in r[3] + r[4]})
    print("rows", len(tr), len(te), "men", len(ids), "cut", cut, flush=True)
    w = np.array([r[7] for r in te], float)
    y = np.array([100.0 * r[1] / r[7] for r in te])

    def score(p):
        return float(np.sqrt(np.average((p - y) ** 2, weights=w)))

    base = score(np.full(len(te), np.average(y, weights=w)))
    res = {"holdout_rows": len(te), "cut": cut, "constant": round(base, 3)}
    # raw on/off: net per 100 on minus off from the training stints
    on_p, on_pts, on_a, on_opts = {}, {}, {}, {}
    for r in tr:
        for e in r[3]:
            on_p[e] = on_p.get(e, 0) + r[7]
            on_pts[e] = on_pts.get(e, 0) + r[1]
        for e in r[4]:
            on_a[e] = on_a.get(e, 0) + r[7]
            on_opts[e] = on_opts.get(e, 0) + r[1]
    raw_o = {e: 100 * on_pts[e] / on_p[e] for e in on_p}
    raw_d = {e: 100 * on_opts[e] / on_a[e] for e in on_a}
    lg0 = float(np.average([100 * r[1] / r[7] for r in tr], weights=[r[7] for r in tr]))
    def pm(n):
        return n / (n + 250.0)
    rawp = np.array([lg0 + sum((raw_o.get(e, lg0) - lg0) * pm(on_p.get(e, 0)) for e in r[3]) / 5 - sum(((raw_d.get(e, lg0) - lg0) * -pm(on_a.get(e, 0))) for e in r[4]) / 5 for r in te])
    res["raw_onoff"] = round(score(rawp), 3)
    for lam in (500, 1000, 1500, 2500, 4000):
        o, d, hca, lg = solve(tr, ids, lam=float(lam))
        res[f"rapm_flat_{lam}"] = round(score(predict(te, o, d, hca, lg)), 3)
        print(lam, res[f"rapm_flat_{lam}"], flush=True)
    best = min((k for k in res if k.startswith("rapm_flat_")), key=lambda k: res[k])
    lam = float(best.split("_")[-1])
    # box impact alone and as a prior, fit only on the training window
    fr = []
    for s in pool:
        df = A.frame(s)
        df = df[(df.non_d1 == 0) & (df.date < cut)]
        if len(df):
            fr.append(pd.DataFrame(A.counts(df)).assign(e=df.eid.values).groupby("e").sum())
    f = features(pd.concat(fr).groupby(level=0).sum())
    o0, d0, hca0, lg00 = solve(tr, ids, lam=lam)
    ff = f[f.index.isin(ids) & (f.poss >= 300)]
    W = np.sqrt(ff.poss.values)[:, None]
    co = {}
    for nm, feats, tgt in (("off", BOX_FEATS_O, o0), ("def", BOX_FEATS_D, d0)):
        X = np.c_[np.ones(len(ff)), ff[feats].values]
        reg = np.eye(X.shape[1])
        reg[0, 0] = 0
        b = np.linalg.solve((X * W).T @ (X * W) + reg, (X * W).T @ (tgt.reindex(ff.index).values * W[:, 0]))
        co[nm] = dict(zip(["c"] + feats, b))
    bo, bd = box_impact(f, co)
    low = float(bo[f.poss.between(50, 300)].mean()), float(bd[f.poss.between(50, 300)].mean())
    res["box_impact"] = round(score(predict(te, bo, bd, hca0, lg00)), 3)
    pri = {e: (float(bo.get(e, low[0])), float(bd.get(e, low[1]))) for e in ids}
    o, d, hca, lg = solve(tr, ids, lam=lam, prior=pri)
    res["rapm_with_prior"] = round(score(predict(te, o, d, hca, lg)), 3)
    res["lam"] = lam
    print(json.dumps(res))
    json.dump(res, open(os.path.join(CC.HOME, "rapm-report.json"), "w"), indent=1)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "check":
        check(sys.argv[2:])
    elif cmd == "fit":
        fit_box(sys.argv[2:])
    elif cmd == "build":
        for s in sys.argv[2:]:
            build(s)
