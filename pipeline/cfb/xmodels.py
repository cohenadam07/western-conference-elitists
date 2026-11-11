"""1.1.0: the expansion's models, fitted once and frozen in pipeline/cfb/state/expansion.json.

    python -m pipeline.cfb.xmodels fit        # fits everything, writes the state file and research/cfb/out/models.md

  xtd      expected touchdowns: the chance a run, a dropback or a target scores, from where the snap is, the
           down and the distance. Fitted on 2014-2024, calibrated on 2025 (BUILD-1.1 section 1).
  xpass    the chance an average FBS offence passes in that spot: down, distance, field, score, clock and
           win probability. Fitted on 2014-2024, checked on 2025 against the release file's own xpass.
  cmp      Tier B completion probability on a charted throw: air yards, direction, down and distance,
           formation, hurried, home or away. Fitted on charted 2025-2026 with game-level cross-validation,
           against 1.0.0's depth-and-side cells (BUILD-1.1 2b: it must beat them on log-loss and be
           calibrated by decile).
  yac      Tier B expected yards after the catch: air yards, direction, depth, down. Same validation, against
           mean YAC by depth and side.

Logistic and linear models are stored as coefficients over expand.py's feature builders, so nothing here
needs a pickle.
"""
import sys
import json
import numpy as np
import pandas as pd
import joblib
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import log_loss, roc_auc_score
from .paths import RAW, WORK, OUT
from .teamgame import scrimmage, success, MIN_PLAYS
from . import expand as X
from .expand import td_X, pass_X, cmp_X, yac_X, cell_X

FIT = list(range(2014, 2025))
CAL = 2025
TIER_B = [2025, 2026]


def frame(y, games=None, charted=False):
    """One season's FBS-vs-FBS scrimmage frame with the base flags (as playergame builds them)."""
    g = pd.read_parquet(WORK / "games.parquet") if games is None else games
    gg = g[(g.season == y) & g.fbs_game & g.final]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    e = pd.read_parquet(WORK / f"epa_{y}.parquet")
    for c in ("ep", "epa", "wp", "garbage_cfbd"):
        d[c] = e[c].to_numpy()
    d = d[d.game_id.isin(gg.game_id) & d.off.notna()].copy()
    n = d[d.cat.isin(["rush", "pass"])].groupby("game_id").size()
    d = d[d.game_id.isin(n[n >= MIN_PLAYS].index)]
    d["off"], d["deff"] = d.off.astype("int64"), d.deff.astype("int64")
    d["sc"] = scrimmage(d)
    d["succ"] = success(d) & d.sc
    d["is_pass"] = d.sc & (d.cat == "pass")
    d["is_rush"] = d.sc & (d.cat == "rush")
    d["attp"] = d.is_pass & d.f_att & ~d.f_sack
    d["comp"] = d.attp & d.f_comp
    d["epa0"] = d.epa.fillna(0.0)
    if charted:
        d = X.charted(X.enrich(d, y), y)
    return d


def fit_logit(Xm, yv, C=1.0, w=None):
    m = LogisticRegression(C=C, max_iter=4000).fit(Xm, yv, sample_weight=w)
    return {"intercept": float(m.intercept_[0]), "coef": [float(v) for v in m.coef_[0]]}


def calib_table(p, a, bins=10):
    q = pd.qcut(pd.Series(p).rank(method="first"), bins, labels=False)
    t = pd.DataFrame({"b": q, "p": p, "a": a}).groupby("b").agg(n=("p", "size"), predicted=("p", "mean"), actual=("a", "mean"))
    t["gap"] = t.actual - t.predicted
    return t


def md_calib(t, fmt="{:.3f}"):
    rows = ["| decile | n | predicted | actual | gap |", "|---:|---:|---:|---:|---:|"]
    for i, r in t.iterrows():
        rows.append(f"| {int(i) + 1} | {int(r.n):,} | {fmt.format(r.predicted)} | {fmt.format(r.actual)} | {r.gap:+.3f} |")
    return rows


def fit():
    g = pd.read_parquet(WORK / "games.parquet")
    keep = json.loads(X.XFILE.read_text()).get("fourth") if X.XFILE.exists() else None      # fourth.py's block survives a refit
    st = {"built_from": "seasons 2014-2024 (xtd, xpass); charted 2025 week 9 to 2026 (cmp, yac)"}
    if keep:
        st["fourth"] = keep
    rep = ["# College Football Savant 1.1.0: the expansion's models", "",
           "*`python -m pipeline.cfb.xmodels fit`. Every model is WCE's, fitted once and frozen in `pipeline/cfb/state/expansion.json`.*", ""]
    # ------------------------------------------------------------ xtd, xpass, fp (2014-2024, checked on 2025)
    fr = []
    for y in FIT + [CAL]:
        d = frame(y, g)
        d = d[d.sc & ~d.garbage_cfbd.fillna(False)]
        d["season"] = y
        fr.append(d[["season", "game_id", "down", "dist", "ytg", "score_diff", "secs_game", "secs_half", "period", "wp", "is_pass", "is_rush",
                     "attp", "comp", "pts", "yards", "f_int", "f_sack", "receiver", "play_id"]])
        print("frame", y, len(d), flush=True)
    A = pd.concat(fr, ignore_index=True)
    A["td"] = (A.pts == 7).astype(int)
    tr, te = A[A.season.isin(FIT)], A[A.season == CAL]
    st["xtd"] = {}
    rep += ["## Expected touchdowns", "", "Logistic on where the snap is, the down and the distance (features in `expand.td_X`). "
            "Fitted on 2014-2024 FBS-vs-FBS scrimmage plays outside garbage time; calibrated on 2025.", ""]
    for kind, m_tr, m_te in (("rush", tr.is_rush, te.is_rush), ("dropback", tr.is_pass, te.is_pass), ("target", tr.attp, te.attp)):
        a, b = tr[m_tr], te[m_te]
        st["xtd"][kind] = fit_logit(td_X(a), a.td.to_numpy(), C=10.0)
        st["xtd"][kind]["feats"] = X.TD_FEATS
        p0 = X.logit(st["xtd"][kind], td_X(b))
        # calibrated on 2025: one intercept shift so 2025's expected touchdowns equal its actual ones
        lo, hi = -1.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            s_ = X.logit(dict(st["xtd"][kind], intercept=st["xtd"][kind]["intercept"] + mid), td_X(b)).sum()
            lo, hi = (mid, hi) if s_ < b.td.sum() else (lo, mid)
        st["xtd"][kind]["shift_2025"] = round(mid, 4)
        st["xtd"][kind]["predicted_2025_before_shift"] = round(float(p0.sum()), 1)
        st["xtd"][kind]["intercept"] += mid
        p = X.logit(st["xtd"][kind], td_X(b))
        base = b.td.mean()
        ll, ll0 = log_loss(b.td, p), log_loss(b.td, np.full(len(b), base))
        t = calib_table(p, b.td.to_numpy())
        st["xtd"][kind]["check_2025"] = {"n": int(len(b)), "log_loss": round(ll, 4), "log_loss_flat": round(ll0, 4),
                                         "predicted_tds": round(float(p.sum()), 1), "actual_tds": int(b.td.sum()),
                                         "max_decile_gap": round(float(t.gap.abs().max()), 4)}
        rep += [f"**{kind}**: 2025 has {len(b):,} plays. Fitted on 2014-2024 the model expected {p0.sum():,.0f} touchdowns against "
                f"{int(b.td.sum()):,} actual (log-loss {log_loss(b.td, p0):.4f}); calibrated on 2025 with one intercept shift of {mid:+.3f}, "
                f"it expects {p.sum():,.0f}. "
                f"Log-loss {ll:.4f} against {ll0:.4f} for a flat rate. Largest decile gap {t.gap.abs().max():.3f}.", ""] + md_calib(t) + [""]
        print("xtd", kind, st["xtd"][kind]["check_2025"], flush=True)
    # xpass on every scrimmage play with a win probability: gradient boosting (a logistic on expand.pass_X was tried
    # first: AUC 0.703 and a 4-point decile gap on 2025, against 0.726 and under 2 points for this)
    a, b = tr[tr.wp.notna()], te[te.wp.notna()]
    hgb = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=400, random_state=7)
    hgb.fit(a[X.XPASS_FEATS], a.is_pass.astype(int))
    joblib.dump(hgb, X.MODELS / "xpass_model.joblib")
    X.reset()
    p = hgb.predict_proba(b[X.XPASS_FEATS])[:, 1]
    t = calib_table(p, b.is_pass.astype(int).to_numpy())
    auc = roc_auc_score(b.is_pass.astype(int), p)
    rel = None
    f = RAW / "espn_cfb_pbp" / f"play_by_play_{CAL}.parquet"
    if f.exists():
        r = pd.read_parquet(f, columns=["id", "xpass"]).rename(columns={"id": "play_id"})
        r["play_id"] = pd.to_numeric(r.play_id, errors="coerce")
        m = b.merge(r.dropna(), on="play_id").assign(ours=lambda z: hgb.predict_proba(z[X.XPASS_FEATS])[:, 1])
        rel = (len(m), float(np.corrcoef(m.ours, m.xpass)[0, 1]))
    st["xpass"] = {"model": "models/xpass_model.joblib", "feats": X.XPASS_FEATS,
                   "check_2025": {"n": int(len(b)), "auc": round(float(auc), 4), "log_loss": round(float(log_loss(b.is_pass, p)), 4),
                                  "max_decile_gap": round(float(t.gap.abs().max()), 4),
                                  "corr_with_release_xpass": None if rel is None else round(rel[1], 4)}}
    rep += ["## Expected pass rate", "", "Gradient boosting on down, distance, yard line, score, both clocks, quarter and win probability "
            "(`expand.XPASS_FEATS`; a logistic was tried first and calibrated worse: AUC 0.703, a 4-point decile gap). Fitted on 2014-2024, "
            "checked on 2025. Pass rate over expected is also centred on each season's FBS mean, so a league-wide drift is not credited "
            "to any one team.", "",
            f"2025: AUC {auc:.3f}; log-loss {log_loss(b.is_pass, p):.4f}; largest decile gap {t.gap.abs().max():.3f}" +
            (f"; correlation with the release file's own `xpass` on {rel[0]:,} plays: {rel[1]:.3f}." if rel else "."), ""] + md_calib(t) + [""]
    print("xpass", st["xpass"]["check_2025"], flush=True)
    del A, tr, te, fr
    # ------------------------------------------------------------ Tier B: completion, YAC, touchdown by spot
    fr = []
    for y in TIER_B:
        d = frame(y, g, charted=True)
        d = d[d.c_airok & ~d.garbage_cfbd.fillna(False)].copy()
        d["season"] = y
        fr.append(d)
    B = pd.concat(fr, ignore_index=True)
    B = B.rename(columns={"c_air": "air", "c_side": "side", "c_spot_ytg": "spot_ytg", "c_n_hur": "n_hur", "c_shotgun": "shotgun",
                          "c_yac": "yac", "c_depth": "depth"})
    B["is_home"] = (B.off == B.home).astype(float)
    yv = B.comp.astype(int).to_numpy()
    groups = B.game_id.to_numpy()
    gkf = GroupKFold(n_splits=5)
    oof_new, oof_old = np.zeros(len(B)), np.zeros(len(B))
    Xc = cmp_X(B)
    Cx = cell_X(B)
    for trn, tst in gkf.split(Xc, yv, groups):
        m = fit_logit(Xc[trn], yv[trn], C=1.0)
        oof_new[tst] = X.logit(m, Xc[tst])
        # 1.0.0: the training folds' completion rate in each depth/side/down/distance cell, depth and side under 100 throws
        c = Cx.iloc[trn].assign(y=yv[trn])
        cell = c.groupby(["p_deep", "p_side", "dn_", "db_"]).y.agg(["mean", "size"])
        wide = c.groupby(["p_deep", "p_side"]).y.mean().rename("wide")
        tt = Cx.iloc[tst].join(cell, on=["p_deep", "p_side", "dn_", "db_"]).join(wide, on=["p_deep", "p_side"])
        oof_old[tst] = np.where(tt["size"].fillna(0) >= 100, tt["mean"], tt.wide.fillna(yv[trn].mean()))
    oof_old = np.clip(np.nan_to_num(oof_old, nan=yv.mean()), 1e-4, 1 - 1e-4)
    ll_new, ll_old = log_loss(yv, oof_new), log_loss(yv, oof_old)
    t = calib_table(oof_new, yv)
    st["cmp"] = fit_logit(Xc, yv, C=1.0)
    st["cmp"]["knots"] = X.AIR_KNOTS
    st["cmp"]["check"] = {"throws": int(len(B)), "games": int(B.game_id.nunique()), "folds": 5, "log_loss": round(ll_new, 4),
                          "log_loss_1_0_0": round(ll_old, 4), "max_decile_gap": round(float(t.gap.abs().max()), 4),
                          "beats_1_0_0": bool(ll_new < ll_old), "calibrated": bool(t.gap.abs().max() <= 0.03)}
    rep += ["## Tier B: completion probability (CPOE with air yards)", "",
            f"Logistic on air yards (hinged at {', '.join(map(str, X.AIR_KNOTS))}), direction, down and distance, formation, hurried, home or away, "
            f"and whether the throw went to the end zone (`expand.cmp_X`). Charted throws, 2025 week 9 to 2026: {len(B):,} throws in "
            f"{B.game_id.nunique():,} games, 5-fold cross-validation by game.", "",
            f"- Out-of-fold log-loss **{ll_new:.4f}**, against **{ll_old:.4f}** for 1.0.0's depth-and-side cells fitted on the same folds: "
            f"{'better' if ll_new < ll_old else 'NOT better'}.",
            f"- Largest decile gap {t.gap.abs().max():.3f} (bar 0.03).", ""] + md_calib(t) + [""]
    print("cmp", st["cmp"]["check"], flush=True)
    # YAC
    Y = B[B.c_yacok].copy()
    yy = Y.yac.to_numpy(dtype=float)
    Xy = yac_X(Y)
    oof, base = np.zeros(len(Y)), np.zeros(len(Y))
    ab = pd.cut(Y.air, [-99, 0, 5, 10, 15, 20, 30, 999], labels=False).to_numpy()
    for trn, tst in gkf.split(Xy, yy, Y.game_id.to_numpy()):
        r = Ridge(alpha=1.0).fit(Xy[trn], yy[trn])
        oof[tst] = r.predict(Xy[tst])
        bt = pd.DataFrame({"ab": ab[trn], "s": Y.side.to_numpy()[trn], "y": yy[trn]}).groupby(["ab", "s"]).y.mean()
        base[tst] = [bt.get((a_, s_), yy[trn].mean()) for a_, s_ in zip(ab[tst], Y.side.to_numpy()[tst])]
    rm, rb = float(np.sqrt(np.mean((oof - yy) ** 2))), float(np.sqrt(np.mean((base - yy) ** 2)))
    ma, mb = float(np.mean(np.abs(oof - yy))), float(np.mean(np.abs(base - yy)))
    t = calib_table(oof, yy)
    r = Ridge(alpha=1.0).fit(Xy, yy)
    st["yac"] = {"intercept": float(r.intercept_), "coef": [float(v) for v in r.coef_], "knots": X.AIR_KNOTS,
                 "check": {"catches": int(len(Y)), "rmse": round(rm, 3), "rmse_baseline": round(rb, 3), "mae": round(ma, 3),
                           "mae_baseline": round(mb, 3), "max_decile_gap_yards": round(float(t.gap.abs().max()), 3),
                           "beats_baseline": bool(rm < rb), "calibrated": bool(t.gap.abs().max() <= 1.0)}}
    rep += ["## Tier B: expected yards after the catch (YACOE)", "",
            f"Ridge regression on air yards (hinged), direction, depth (room to the end zone), down and distance, formation (`expand.yac_X`). "
            f"{len(Y):,} charted catches, 5-fold cross-validation by game, against mean YAC by air-yard band and direction fitted on the same folds.", "",
            f"- Out-of-fold RMSE **{rm:.2f}** yards against **{rb:.2f}** for the baseline (MAE {ma:.2f} against {mb:.2f}).",
            f"- Largest decile gap {t.gap.abs().max():.2f} yards (bar 1.0).", ""] + md_calib(t, "{:.2f}") + [""]
    print("yac", st["yac"]["check"], flush=True)
    (X.XFILE).write_text(json.dumps(st, indent=1, sort_keys=True))
    X.reset()
    (OUT / "models.md").write_text("\n".join(rep))
    print("written", X.XFILE)
    return st


if __name__ == "__main__":
    {"fit": fit}[sys.argv[1]]()
