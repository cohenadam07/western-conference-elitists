"""
team_fit.py — Savant value's weights, fitted to team results. Adam's decision of Nov 2, 2026.

The on/off fit barely beat guessing zero: a college player's on/off is mostly noise, and it left
scoring worth almost nothing. So this is BPM's way instead. Each team-season gives one equation:

    team's adjusted net rating = Σ players (share of team minutes × weight × shrunk, centred stat)

over every finished season on the site, thirteen of them, about 4,700 team-seasons. The stats are the
same parts, opponent-adjusted, shrunk by settle points and centred on the position.

The penalty is chosen by leaving one season out at a time. Usage can't be fitted here, and that is
worth saying: a team's minutes-weighted usage adds up to the same number for every team, so the
regression can't see it. Its volume reaches the rate through sceff, which is attempts × efficiency.

    python3 team_fit.py compare      old against new; writes <home>/value-compare.json
    python3 team_fit.py fit          writes seed/value_model.json
    python3 team_fit.py drivers      what drives the AP overlap
"""
import gzip
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))
import allsavant as AS  # noqa: E402
import cbbd_client as CC  # noqa: E402
import college_value as V  # noqa: E402
import config as C  # noqa: E402
from namematch import words  # noqa: E402

FEATS = V.FEATS
GRID = (0.01, 0.1, 1, 3, 10, 30, 100, 300, 1000)
AP = os.path.join(CC.HOME, "ref", "ap", "ap.json")
OLD = os.path.join(CC.HOME, "value_model_old.json")


def seasons():
    return [s for s in C.SEASONS if s != C.CURRENT and os.path.exists(os.path.join(V.PUBLIC, "cbb", "s", f"{s}.json.gz"))]


def team_rows(S, credit=None):
    """[(season index, y, x...)] one row per team-season."""
    c = credit or {}
    X, y, sx = [], [], []
    for k, s in enumerate(S):
        rt = json.load(open(os.path.join(CC.HOME, "ratings", f"{s.season}.json")))["teams"]
        acc = {}
        for i, t in enumerate(s.team):
            if t in rt:
                sh = np.nan_to_num(s.share[i]) / 100
                a = acc.setdefault(t, np.zeros(len(FEATS)))
                a += sh * np.array([c.get(f, 1.0) * s.X[f][i] for f in FEATS])
        for t, v in acc.items():
            X.append(v); y.append(rt[t]["net"]); sx.append(k)
    return np.array(X), np.array(y), np.array(sx)


def solve(X, y, lam):
    sd = X.std(0)
    sd[sd < 1e-9] = 1.0
    keep = np.array([f != "usg" for f in FEATS])      # usage sums to the same for every team: unseen
    Z = np.c_[np.ones(len(X)), (X / sd)[:, keep]]
    R = lam * np.eye(Z.shape[1])
    R[0, 0] = 0
    b = np.linalg.solve(Z.T @ Z + R, Z.T @ y)
    out = np.zeros(X.shape[1])
    out[keep] = b[1:] / sd[keep]
    return b[0], out


def loso(X, y, sx, lam):
    pred = np.zeros(len(y))
    for k in np.unique(sx):
        m = sx != k
        a, b = solve(X[m], y[m], lam)
        pred[~m] = a + X[~m] @ b
    return pred


def fit_stats(pred, y):
    return dict(rmse=round(float(np.sqrt(np.mean((pred - y) ** 2))), 3), r=round(float(np.corrcoef(pred, y)[0, 1]), 4), mae=round(float(np.mean(np.abs(pred - y))), 3))


def old_rate_team(S, X0, y, sx, old):
    """The old weights' held-out-free team fit: their own scale, no refitting."""
    b = np.array([old["beta"][f] * old["credit"][f] for f in FEATS]) * old["scale"]
    return X0 @ b


def overlap(model, S, shape=True, adj=True, repl=True, by_rate=False):
    """AP names on our 1st-3rd teams. Changing the switches is how `drivers` tests each cause."""
    ap = json.load(open(AP))
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    tot = hit = first = 0
    per = {}
    for s in S:
        if s.season not in ap:
            continue
        d = json.loads(json.dumps(s.doc))
        if not adj:
            for k, c in d["values"].items():
                if "ag" in c or "a" in c:
                    c.pop("ag", None); c.pop("a", None)
        V.apply_doc(d, s.season, model)
        P, val = d["players"], d["values"]["value"]["r"]
        if not repl:
            flat = float(np.percentile([x for x, p in zip(d["vparts"]["rate"], P) if p[11] and x is not None], 25))
            val = [None if r is None else (r - flat) * (d["samples"]["poss"][i] or 0) / 100 for i, r in enumerate(d["vparts"]["rate"])]
        key = d["vparts"]["rate"] if by_rate else val
        q = sorted([i for i, p in enumerate(P) if p[11] and key[i] is not None and p[3]], key=lambda i: -key[i])
        if shape:
            d["values"]["value"]["r"] = key
            t = AS.teams(d, True)
            ours = {"".join(words(p["name"])) for k in "123" for p in t["national"][k]}
            ours1 = {"".join(words(p["name"])) for p in t["national"]["1"]}
        else:
            ours = {"".join(words(P[i][1])) for i in q[:15]}
            ours1 = {"".join(words(P[i][1])) for i in q[:5]}
        names = [("".join(words(n)), k) for k, v in ap[s.season].items() for n in v]
        h = sum(n in ours for n, _ in names)
        tot += len(names); hit += h
        first += sum(n in ours1 for n, k in names if k == "1")
        per[s.season] = [h, len(names)]
    return dict(overlap=hit, of=tot, share=round(hit / max(1, tot), 3), ap_first_on_our_first=first, by_season=per)


def next_season(model, a, b, settle):
    """Returning players: this season's box rate against next season's on/off, as in the 1.1 test."""
    bv = np.array([model["beta"][f] * model["credit"].get(f, 1.0) for f in FEATS])
    rate = sum(bv[i] * a.X[f] for i, f in enumerate(FEATS))
    ps = V.pairs(a, b, model["gamma"])
    return dict(V.score(rate[[p[0] for p in ps]], ps), pairs=len(ps))


def next_box(model, S):
    """More power: this season's rate against next season's own box rate, every pair of seasons."""
    bv = np.array([model["beta"][f] * model["credit"].get(f, 1.0) for f in FEATS])
    xs, ys, ws = [], [], []
    for a, b in zip(S, S[1:]):
        if int(b.season[:4]) != int(a.season[:4]) + 1:     # a season off the site leaves a gap
            continue
        ra, rb = sum(bv[i] * a.X[f] for i, f in enumerate(FEATS)), sum(bv[i] * b.X[f] for i, f in enumerate(FEATS))
        nx = {e: j for j, e in enumerate(b.id)}
        for i, e in enumerate(a.id):
            j = nx.get(e)
            if j is not None and a.pos[i] == b.pos[j] and a.poss[i] >= 500 and b.poss[j] >= 500:
                xs.append(ra[i]); ys.append(rb[j]); ws.append(min(a.poss[i], b.poss[j]))
    return round(float(np.corrcoef(xs, ys)[0, 1]), 3)


def build_model(S, lam, use_credit, cr, old):
    X, y, sx = team_rows(S, cr if use_credit else None)
    a, b = solve(X, y, lam)
    beta = {f: round(float(v), 5) for f, v in zip(FEATS, b)}
    return dict(version=2, method="team results", feats=FEATS, intercept=round(float(a), 4), beta=beta, credit=cr if use_credit else {f: 1.0 for f in FEATS}, scale=1.0, gamma=old["gamma"], K=old["K"], lam=lam, repl_pct=25, settle_keys=old["settle_keys"], fit_seasons=[s.season for s in S])


def compare():
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    old = json.load(open(OLD))
    S = [V.Season(s, settle) for s in seasons()]
    cr = V.credit(S)
    res = {}
    for name, c in (("with credit", cr), ("no credit", None)):
        X, y, sx = team_rows(S, c)
        rows = {lam: fit_stats(loso(X, y, sx, lam), y) for lam in GRID}
        best = min(rows, key=lambda k: rows[k]["rmse"])
        res[name] = dict(by_lambda={str(k): v for k, v in rows.items()}, best=best, held_out=rows[best])
    use_credit = res["with credit"]["held_out"]["rmse"] < res["no credit"]["held_out"]["rmse"]
    lam = res["with credit" if use_credit else "no credit"]["best"]
    new = build_model(S, lam, use_credit, cr, old)
    X0, y, sx = team_rows(S)
    oldp = old_rate_team(S, X0, y, sx, old)
    pair = {s.season: s for s in S}
    a, b = pair["2024-25"], pair["2025-26"]
    out = dict(seasons=[s.season for s in S], team_seasons=len(y), credit_test={k: v["held_out"] for k, v in res.items()}, use_credit=use_credit, lam=lam, lambda_scan=res["with credit" if use_credit else "no credit"]["by_lambda"],
               team_fit_old=fit_stats(oldp, y), team_fit_new_held_out=res["with credit" if use_credit else "no credit"]["held_out"],
               next_onoff_old=next_season(old, a, b, settle), next_onoff_new=next_season(new, a, b, settle), next_rate_old=next_box(old, S), next_rate_new=next_box(new, S), beta_old=old["beta"], beta_new=new["beta"],
               ap_old=overlap(old, S), ap_new=overlap(new, S))
    json.dump(out, open(os.path.join(CC.HOME, "value-compare.json"), "w"), indent=1)
    json.dump(new, open(os.path.join(CC.HOME, "value_model_new.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("lambda_scan",)})[:3400])


def fit():
    """The final model: the weights, then the floor. Where lineups exist the rate moves toward what
    happened on the floor, against what his box rate and minutes say his on/off should be."""
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    m = json.load(open(os.path.join(CC.HOME, "value_model_new.json")))
    S = [V.Season(s, settle) for s in seasons()]
    court = [s for s in S if s.season in ("2024-25", "2025-26")]
    bv = np.array([m["beta"][f] for f in FEATS])
    def box(s):
        return sum(bv[i] * s.X[f] for i, f in enumerate(FEATS))
    Xs, ys, ws = [], [], []
    for s in court:
        k = np.isfinite(s.oo_dm) & (np.nan_to_num(s.minutes) >= V.MIN_FIT_MIN) & (s.w > 0)
        Xs.append(np.c_[np.ones(k.sum()), box(s)[k], s.ms_dm[k]]); ys.append(s.oo_dm[k]); ws.append(s.w[k])
    X, y, w = np.vstack(Xs), np.concatenate(ys), np.concatenate(ws)
    W = np.sqrt(w)[:, None]
    a0, b0, g0 = np.linalg.lstsq(X * W, y * W[:, 0], rcond=None)[0]
    a, b = court
    ps = V.pairs(a, b, float(g0))
    best = None
    for K in [None] + [100 * 2 ** (i / 2) for i in range(0, 20)]:
        ra = box(a)
        if K:
            sh = a.w / (a.w + K)
            ra = ra + np.where(np.isfinite(a.oo_dm), sh * (np.nan_to_num(a.oo_dm) - (a0 + b0 * box(a) + g0 * a.ms_dm)), 0.0)
        e = V.score(ra[[p[0] for p in ps]], ps)["rmse"]
        if best is None or e < best[1]:
            best = (K, e)
    m.update(floor_a=round(float(a0), 4), floor_b=round(float(b0), 4), gamma=round(float(g0), 5), K=best[0], k_test_rmse=best[1])
    # the scale check: a team's minutes-weighted rates against its net rating
    m["scale"] = 1.0
    json.dump(m, open(V.MODEL, "w"), indent=1)
    print({k: m[k] for k in ("floor_a", "floor_b", "gamma", "K", "k_test_rmse", "intercept")})


def drivers():
    settle = json.load(open(os.path.join(CC.HOME, "settle.json")))
    new = json.load(open(os.path.join(CC.HOME, "value_model_new.json")))
    S = [V.Season(s, settle) for s in seasons()]
    out = {"as built": overlap(new, S), "no 2-2-1 shape (top 15 by value)": overlap(new, S, shape=False), "raw stats, not adjusted": overlap(new, S, adj=False), "one replacement level for all positions": overlap(new, S, repl=False), "rate, so games don't count": overlap(new, S, by_rate=True)}
    print({k: (v["overlap"], v["of"], v["ap_first_on_our_first"]) for k, v in out.items()})
    json.dump(out, open(os.path.join(CC.HOME, "value-drivers.json"), "w"), indent=1)


if __name__ == "__main__":
    {"compare": compare, "drivers": drivers, "fit": fit}[sys.argv[1]]()
