"""
value_engine.py — what a player is worth, and what a contract is worth.

The trade engine needs one currency: SURPLUS VALUE, the projected production a contract
buys minus the money it costs, discounted across its remaining years. That requires three
things this module builds from the 47 seasons already on disk:

  1. a multi-year projection of production (VORP), because a trade is about the future
  2. an ATTRITION model — the probability a player is even in the league next season,
     which is most of why 34-year-olds are worth less than their last season suggests
     and which almost no public valuation bothers with
  3. a conversion from production to dollars, anchored on actual league payroll

Usage:
  python value_engine.py transitions   # build the dataset
  python value_engine.py fit           # projection + attrition, honestly validated
  python value_engine.py price         # $ per unit of production
"""
import json, sys, math, collections

OUT = "out"
TRANS = f"{OUT}/value_transitions.json"
MODEL = f"{OUT}/value_model.joblib"


def raw(p, k):
    v = ((p.get("m", {}).get(k) or {}).get("season") or {}).get("v")
    return None if v is None else float(v)


def season_start(s):
    return int(s[:4])


def cmd_transitions():
    """Player-season -> outcome at horizons 1..5, plus the players who vanished.

    MULTI-HORIZON on purpose. Training only h=1 and then rolling the model forward by
    feeding its own prediction back in re-applies regression-to-the-mean at every step,
    so it compounds every player toward league average no matter his age — it projected
    a 23-year-old Chet Holmgren to fall from 2.86 VORP to 1.41 over five years, which
    would price young stars as liabilities. Predicting year t+k directly from year t
    never compounds.
    """
    data = json.load(open(f"{OUT}/players.json"))["data"]
    seasons = sorted(data, key=season_start)
    idx = {s: {str(p["id"]): p for p in data[s]["players"]} for s in seasons}
    rows = []
    have = {season_start(s): s for s in seasons}
    for a in seasons:
        y = season_start(a)
        for pid, p in idx[a].items():
            v0, mp = raw(p, "vorp"), raw(p, "mpg")
            if v0 is None or mp is None or mp < 5:
                continue
            for h in range(1, 6):
                b = have.get(y + h)
                if b is None:
                    continue
                nxt = idx[b].get(pid)
                rows.append({
                    "pid": pid, "season": a, "h": h,
                    "age": raw(p, "age") or p.get("age"),
                    "vorp": v0, "bpm": raw(p, "bpm"), "mpg": mp,
                    "avail": raw(p, "avail"), "usg": raw(p, "usg"),
                    "exp": p.get("exp"),
                    "survived": 1 if nxt else 0,
                    "vorp_next": raw(nxt, "vorp") if nxt else None,
                })
    json.dump(rows, open(TRANS, "w"))
    import collections as _c
    print(f"{len(rows):,} player-season x horizon rows -> {TRANS}")
    byh = _c.defaultdict(lambda: [0, 0])
    for r in rows:
        b = byh[r["h"]]; b[0] += r["survived"]; b[1] += 1
    for h in sorted(byh):
        s_, n_ = byh[h]
        print(f"  h={h}: {n_:6,} rows, still a rotation player {s_/n_:.1%}")
    rows = [r for r in rows if r["h"] == 1]
    by = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        a = r["age"]
        if a is None:
            continue
        b = by[min(40, max(19, int(a)))]
        b[0] += r["survived"]; b[1] += 1
    print("\n  survival rate by age:")
    for a in sorted(by):
        s, n = by[a]
        if n >= 25:
            print(f"    {a:2d}  {s/n:6.1%}   (n={n:,})")



FEATS = ["age", "vorp", "bpm", "mpg", "avail", "usg", "exp", "h"]


def _xy(rows, target):
    import numpy as np
    X = np.array([[r.get(f) if r.get(f) is not None else np.nan for f in FEATS]
                  for r in rows], float)
    y = np.array([r[target] for r in rows], float)
    g = np.array([r["pid"] for r in rows])
    return X, y, g


def cmd_fit():
    import numpy as np, joblib
    from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    rows = json.load(open(TRANS))
    rows = [r for r in rows if r["age"] is not None]
    print(f"{len(rows):,} rows across horizons 1-5")

    # --- attrition: will he be a rotation player at all next season?
    Xa, ya, ga = _xy(rows, "survived")
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros(len(ya))
    for tr, te in gkf.split(Xa, ya, ga):
        c = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06,
                                           max_depth=4, random_state=17).fit(Xa[tr], ya[tr])
        oof[te] = c.predict_proba(Xa[te])[:, 1]
    from sklearn.metrics import roc_auc_score, brier_score_loss
    print(f"attrition model   AUC {roc_auc_score(ya, oof):.3f}   "
          f"Brier {brier_score_loss(ya, oof):.4f}   base rate {ya.mean():.3f}")
    att = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06,
                                         max_depth=4, random_state=17).fit(Xa, ya)

    # --- production: next-season VORP, for players who stayed
    surv = [r for r in rows if r["survived"] and r["vorp_next"] is not None]
    Xp, yp, gp = _xy(surv, "vorp_next")
    oofp = np.zeros(len(yp))
    for tr, te in gkf.split(Xp, yp, gp):
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06,
                                          max_depth=5, random_state=17).fit(Xp[tr], yp[tr])
        oofp[te] = m.predict(Xp[te])
    ss = 1 - ((yp - oofp) ** 2).sum() / ((yp - yp.mean()) ** 2).sum()
    naive = 1 - ((yp - np.array([r["vorp"] for r in surv])) ** 2).sum() / \
                ((yp - yp.mean()) ** 2).sum()
    print(f"projection model  OOS R2 {ss:.3f}   "
          f"(naive 'same as last year' {naive:.3f})")
    proj = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06,
                                         max_depth=5, random_state=17).fit(Xp, yp)
    # residual spread by age band — the uncertainty the game should show as a band
    res = yp - oofp
    print("\n  projection residual sd by age at h=1 (the honest error bar):")
    for lo, hi in ((19, 22), (23, 25), (26, 28), (29, 31), (32, 41)):
        m_ = [i for i, r in enumerate(surv) if lo <= r["age"] < hi + 1 and r["h"] == 1]
        if len(m_) > 50:
            import statistics as st
            print(f"    {lo}-{hi}: sd {st.pstdev([res[i] for i in m_]):.2f}  (n={len(m_):,})")
    joblib.dump({"attrition": att, "projection": proj, "feats": FEATS}, MODEL)
    print(f"\nwrote {MODEL}")


def cmd_price():
    """Dollars per unit of production, anchored on real payroll."""
    import cap_engine as CE
    data = json.load(open(f"{OUT}/players.json"))["data"]
    season = max(data)
    vorps = [raw(p, "vorp") for p in data[season]["players"]]
    vorps = [v for v in vorps if v is not None]
    total_vorp = sum(v for v in vorps if v > 0)
    cons = json.load(open(f"{OUT}/contracts_2026_27.json"))
    payroll = sum(c["years"]["2026-27"]["salary"] for c in cons if c["years"].get("2026-27"))
    n_slots = 30 * 15
    vet_min = 2_300_000            # approximate 2026-27 veteran minimum
    replacement_cost = n_slots * vet_min
    surplus_pool = payroll - replacement_cost
    per_vorp = surplus_pool / total_vorp
    print(f"{season}")
    print(f"  league payroll        ${payroll:>14,.0f}")
    print(f"  replacement baseline  ${replacement_cost:>14,.0f}  ({n_slots} slots x minimum)")
    print(f"  paid for production   ${surplus_pool:>14,.0f}")
    print(f"  total positive VORP   {total_vorp:>15.1f}")
    print(f"\n  $ per VORP            ${per_vorp:>14,.0f}")
    print(f"  a 5.0-VORP star is worth ${vet_min + 5.0*per_vorp:,.0f}/yr "
          f"vs a 35% max of ${CE.CBA['max_35']:,}")
    json.dump({"season": season, "per_vorp": per_vorp, "replacement_salary": vet_min},
              open(f"{OUT}/value_price.json", "w"), indent=1)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "transitions"
    {"transitions": cmd_transitions, "fit": cmd_fit, "price": cmd_price}[cmd]()
