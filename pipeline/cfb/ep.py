"""Step 5 and 6. WCE's expected-points (EP) and win-probability (WP) models, and garbage time.

    python -m pipeline.cfb.ep fit        # fit EP + WP on 2014-2024 FBS-vs-FBS plays
    python -m pipeline.cfb.ep score      # write work/epa_<season>.parquet for 2004-2026
    python -m pipeline.cfb.ep report     # calibration on held-out 2025, comparisons, garbage time

The EP model is nflfastR's idea in scikit-learn: a seven-class gradient-boosted
classifier of "the next score in this half" (touchdown, field goal or safety,
for or against, or no score), turned into points by weighting each class by
its value. Inputs: down, distance, yards to the end zone, seconds left in the
half, score margin, home/away. Nothing else, so it is reproducible from the
live ESPN feed.

xgboost is what nflfastR uses; it needs a system OpenMP library this Mac and
the cloud runner would both have to install, so the fit uses scikit-learn's
HistGradientBoostingClassifier (already pinned for College Basketball Savant).

EPA for a play = EP after - EP before, from the offence's side:
  * a scoring play ends at the points scored (TD 7, FG 3, safety 2, signed);
  * otherwise "after" is the EP at the start of the next play in the same
    half, with its sign flipped when the ball changed hands;
  * the last play of a half ends at 0.
Kickoffs start from "receiving team, 1st and 10 at its own 25".

The WP model predicts whether the team with the ball wins, from score margin,
time left, possession, our EP and the pregame spread (when there is one). A
second copy without the spread exists only for garbage time: with the spread
in, a 35-point favourite would be "in garbage time" from the opening kickoff.
"""
import sys
import json
import numpy as np
import pandas as pd
import joblib   # the two model files are written and read only by this pipeline, on this machine
from sklearn.ensemble import HistGradientBoostingClassifier
from .paths import WORK, OUT, CHARTS, RAW

FIT_SEASONS = list(range(2014, 2025))
HOLDOUT = 2025
CLASSES = np.array([-7, -3, -2, 0, 2, 3, 7])
EP_FEATS = ["down", "dist", "ytg", "secs_half", "score_diff", "home", "gtg"]
WP_FEATS = ["score_diff", "secs_game", "ep", "home", "down", "dist", "ytg", "diff_time", "spread_pos", "spread_time"]
# CFBD's documented rule (api.collegefootballdata.com/metrics-and-definitions): the margin
# before the play is above 38 in the 2nd quarter, 28 in the 3rd, 22 in the 4th.
CFBD_GARBAGE = {2: 38, 3: 28, 4: 22}
WP_GARBAGE = 0.02      # naive WP below 2% or above 98%


def games():
    return pd.read_parquet(WORK / "games.parquet")


def load(y, g=None):
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    g = games() if g is None else g
    gg = g[g.season == y].set_index("game_id")
    d["neutral"] = d.game_id.map(gg.neutral_site).fillna(False).astype(bool)
    d["fbs_game"] = d.game_id.map(gg.fbs_game).fillna(False).astype(bool)
    d["spread_home"] = d.game_id.map(gg.spread_home)
    d["home_margin"] = d.game_id.map(gg.home_margin)
    return d


def ep_frame(d):
    """Feature frame for the EP model; `ok` marks rows whose state is usable."""
    kick = (d.cat == "kickoff").to_numpy()
    down = np.where(kick, 1, d.down.to_numpy(dtype=float))
    ytg = np.where(kick, 75, d.ytg.to_numpy(dtype=float))
    dist = np.where(kick, 10, d.dist.to_numpy(dtype=float))
    dist = np.where(dist <= 0, np.nan, dist)
    dist = np.minimum(dist, ytg)
    dist = np.clip(dist, 1, 40)
    secs = d.secs_half.to_numpy(dtype=float)
    home = np.where(d.neutral.to_numpy(), 0.5, (d.off.to_numpy() == d.home.to_numpy()).astype(float))
    X = pd.DataFrame({"down": down, "dist": dist, "ytg": ytg, "secs_half": secs,
                      "score_diff": d.score_diff.to_numpy(dtype=float), "home": home,
                      "gtg": (dist >= ytg).astype(float)})
    ok = (np.isin(down, [1, 2, 3, 4]) & (ytg >= 1) & (ytg <= 99) & ~np.isnan(dist) & (secs >= 0) & (secs <= 1800)
          & ~np.isnan(X.score_diff.to_numpy()) & (d.period.to_numpy() <= 4) & (d.period.to_numpy() >= 1)
          & (d.cat != "skip").to_numpy() & d.off.notna().to_numpy())
    return X, ok


def fit():
    g = games()
    Xs, ys = [], []
    for y in FIT_SEASONS:
        d = load(y, g)
        X, ok = ep_frame(d)
        m = ok & d.fbs_game.to_numpy() & d.cat.isin(["rush", "pass", "punt", "fg", "penalty"]).to_numpy()
        Xs.append(X[m])
        ys.append(d.next_score.to_numpy()[m])
    X = pd.concat(Xs, ignore_index=True)
    yv = np.concatenate(ys)
    print("EP training rows", len(X), dict(zip(*np.unique(yv, return_counts=True))), flush=True)
    ep = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=400,
                                        l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                                        n_iter_no_change=20, random_state=7)
    ep.fit(X, yv)
    assert list(ep.classes_) == list(CLASSES), ep.classes_
    joblib.dump(ep, WORK / "ep_model.joblib")
    print("EP fitted, iterations", ep.n_iter_, flush=True)
    # WP: needs EP first
    Xs, ys = [], []
    for y in FIT_SEASONS:
        d = load(y, g)
        W, ok, _ = wp_frame(d, ep)
        m = ok & d.fbs_game.to_numpy() & (d.home_margin != 0).to_numpy() & d.home_margin.notna().to_numpy()
        win = np.where(d.off.to_numpy() == d.home.to_numpy(), d.home_margin.to_numpy() > 0, d.home_margin.to_numpy() < 0)
        Xs.append(W[m])
        ys.append(win[m].astype(int))
    W = pd.concat(Xs, ignore_index=True)
    wv = np.concatenate(ys)
    kw = dict(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=600, l2_regularization=1.0,
              early_stopping=True, validation_fraction=0.1, n_iter_no_change=20, random_state=7)
    wp = HistGradientBoostingClassifier(**kw).fit(W[WP_FEATS], wv)
    naive = [f for f in WP_FEATS if not f.startswith("spread")]
    wpn = HistGradientBoostingClassifier(**kw).fit(W[naive], wv)
    joblib.dump({"wp": wp, "wp_naive": wpn, "naive_feats": naive}, WORK / "wp_model.joblib")
    print("WP fitted", len(W), "rows; spread present on", float(W.spread_pos.notna().mean()), flush=True)


def ep_values(ep, X, ok):
    out = np.full(len(X), np.nan)
    if ok.any():
        out[ok] = ep.predict_proba(X[ok]) @ CLASSES
    return out


def wp_frame(d, ep):
    X, ok = ep_frame(d)
    e = ep_values(ep, X, ok)
    secs_game = d.secs_game.to_numpy(dtype=float)
    el = np.clip(1 - secs_game / 3600.0, 0, 1)
    is_home = d.off.to_numpy() == d.home.to_numpy()
    sp = np.where(is_home, d.spread_home.to_numpy(dtype=float), -d.spread_home.to_numpy(dtype=float))
    W = X.copy()
    W["secs_game"] = secs_game
    W["ep"] = e
    W["diff_time"] = W.score_diff * np.exp(4 * el)
    W["spread_pos"] = sp
    W["spread_time"] = sp * np.exp(-4 * el)
    return W, ok & ~np.isnan(secs_game), e


def score():
    ep = joblib.load(WORK / "ep_model.joblib")
    wpm = joblib.load(WORK / "wp_model.joblib")
    g = games()
    for y in range(2004, 2027):
        d = load(y, g)
        W, ok, e = wp_frame(d, ep)
        n = len(d)
        chain = (d.cat != "skip").to_numpy()
        gid = d.game_id.to_numpy()
        hb = d.halfb.to_numpy()
        off = d.off.to_numpy()
        pts = d.pts.to_numpy()
        # EP at the start of the next chain row in the same game-half, from this row's offence's side
        nxt_ep = np.zeros(n)
        nxt_ok = np.ones(n, dtype=bool)
        last_i = -1
        for i in range(n - 1, -1, -1):
            if not chain[i]:
                continue
            if last_i >= 0 and gid[last_i] == gid[i] and hb[last_i] == hb[i]:
                if np.isnan(e[last_i]):
                    nxt_ok[i] = False
                else:
                    nxt_ep[i] = e[last_i] if off[last_i] == off[i] else -e[last_i]
            last_i = i
        epa = np.where(pts != 0, pts - e, nxt_ep - e)
        epa[~chain | np.isnan(e) | (~nxt_ok & (pts == 0))] = np.nan
        wp = np.full(n, np.nan)
        wpn = np.full(n, np.nan)
        m = ok & ~np.isnan(e)
        if m.any():
            wp[m] = wpm["wp"].predict_proba(W.loc[m, WP_FEATS])[:, 1]
            wpn[m] = wpm["wp_naive"].predict_proba(W.loc[m, wpm["naive_feats"]])[:, 1]
        per = d.period.to_numpy()
        sd = np.abs(d.score_diff.to_numpy(dtype=float))
        g_cfbd = np.zeros(n, dtype=bool)
        for q, thr in CFBD_GARBAGE.items():
            g_cfbd |= (per == q) & (sd > thr)
        g_wp = (wpn < WP_GARBAGE) | (wpn > 1 - WP_GARBAGE)
        out = pd.DataFrame({"play_id": d.play_id.to_numpy(), "game_id": gid, "ep": e, "epa": epa, "wp": wp,
                            "wp_naive": wpn, "garbage_cfbd": g_cfbd, "garbage_wp": g_wp})
        out.to_parquet(WORK / f"epa_{y}.parquet", index=False)
        s = d.cat.isin(["rush", "pass"]).to_numpy() & d.fbs_game.to_numpy()
        print(y, "scrimmage plays", int(s.sum()), "epa missing", round(float(np.isnan(epa[s]).mean()), 4),
              "mean epa", round(float(np.nanmean(epa[s])), 4), "rel", round(float(d.rel_epa[s].mean()), 4),
              "corr", round(float(pd.Series(epa[s]).corr(pd.Series(d.rel_epa.to_numpy()[s]))), 4), flush=True)


def _calib(pred, actual, bins=10):
    q = pd.qcut(pred, bins, labels=False, duplicates="drop")
    t = pd.DataFrame({"bin": q, "pred": pred, "actual": actual}).groupby("bin").agg(
        n=("pred", "size"), predicted=("pred", "mean"), actual=("actual", "mean"))
    t["gap"] = t.actual - t.predicted
    return t


def report():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    ep = joblib.load(WORK / "ep_model.joblib")
    g = games()
    res = {}
    lines = ["# EP / WP model report", ""]
    # ---- held-out 2025 calibration -----------------------------------------
    d = load(HOLDOUT, g)
    e = pd.read_parquet(WORK / f"epa_{HOLDOUT}.parquet")
    X, ok = ep_frame(d)
    m = ok & d.fbs_game.to_numpy() & d.cat.isin(["rush", "pass", "punt", "fg", "penalty"]).to_numpy()
    c = _calib(e.ep.to_numpy()[m], d.next_score.to_numpy()[m])
    res["ep_calibration_2025"] = c.round(3).reset_index().to_dict("records")
    res["ep_max_decile_gap"] = float(c.gap.abs().max())
    res["ep_weighted_gap"] = float((c.gap.abs() * c.n).sum() / c.n.sum())
    lines += ["## EP calibration, held-out 2025 (FBS-vs-FBS, by decile of predicted EP)", "",
              "| decile | plays | predicted EP | actual next-score value | gap |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {int(i) + 1} | {int(r.n):,} | {r.predicted:.2f} | {r.actual:.2f} | {r.gap:+.2f} |" for i, r in c.iterrows()]
    P = ep.predict_proba(X[m])
    ns = d.next_score.to_numpy()[m]
    lines += ["", "Per-class calibration (mean predicted probability vs how often it happened):", "",
              "| next score | predicted | actual |", "|---|---:|---:|"]
    names = {-7: "opponent TD", -3: "opponent FG", -2: "safety against", 0: "no score", 2: "safety for", 3: "FG", 7: "TD"}
    for j, k in enumerate(CLASSES):
        lines.append(f"| {names[k]} | {P[:, j].mean():.4f} | {(ns == k).mean():.4f} |")
    # release EP on the same rows, for reference
    rel = d.rel_ep.to_numpy()[m]
    okr = ~np.isnan(rel)
    cr = _calib(rel[okr], ns[okr])
    res["release_ep_max_decile_gap_2025"] = float(cr.gap.abs().max())
    res["release_ep_weighted_gap_2025"] = float((cr.gap.abs() * cr.n).sum() / cr.n.sum())
    # ---- WP calibration ------------------------------------------------------
    win = np.where(d.off.to_numpy() == d.home.to_numpy(), d.home_margin.to_numpy() > 0, d.home_margin.to_numpy() < 0)
    mw = m & e.wp.notna().to_numpy() & (d.home_margin != 0).to_numpy()
    for name, col in (("wp", "wp"), ("wp_naive", "wp_naive")):
        cw = _calib(e[col].to_numpy()[mw], win[mw].astype(float))
        res[f"{name}_calibration_2025"] = cw.round(3).reset_index().to_dict("records")
        res[f"{name}_max_decile_gap"] = float(cw.gap.abs().max())
        p = np.clip(e[col].to_numpy()[mw], 1e-6, 1 - 1e-6)
        res[f"{name}_logloss_2025"] = float(-(win[mw] * np.log(p) + (1 - win[mw]) * np.log(1 - p)).mean())
        res[f"{name}_brier_2025"] = float(((p - win[mw]) ** 2).mean())
        lines += ["", f"## {'WP with spread' if name == 'wp' else 'WP without spread (garbage time only)'}: calibration, held-out 2025", "",
                  "| decile | plays | predicted | actual win rate | gap |", "|---|---:|---:|---:|---:|"]
        lines += [f"| {int(i) + 1} | {int(r.n):,} | {r.predicted:.3f} | {r.actual:.3f} | {r.gap:+.3f} |" for i, r in cw.iterrows()]
    relwp = d.rel_wp.to_numpy()[mw]
    okw = ~np.isnan(relwp)
    p = np.clip(relwp[okw], 1e-6, 1 - 1e-6)
    res["release_wp_brier_2025"] = float(((p - win[mw][okw]) ** 2).mean())

    # ---- by season: level, correlation with the release EPA, garbage time ----
    rows = []
    tg_rows = []
    for y in range(2004, 2027):
        d = load(y, g)
        e = pd.read_parquet(WORK / f"epa_{y}.parquet")
        s = (d.cat.isin(["rush", "pass"]) & d.fbs_game & ~d.f_kneel & ~d.f_spike).to_numpy() & e.epa.notna().to_numpy()
        a = e.epa.to_numpy()[s]
        r = d.rel_epa.to_numpy()[s]
        okk = ~np.isnan(r)
        G = d.game_id[s].nunique()
        dd = pd.DataFrame({"game_id": d.game_id.to_numpy()[s], "off": d.off.to_numpy()[s], "a": a, "r": r})
        tg = dd.groupby(["game_id", "off"]).agg(a=("a", "mean"), r=("r", "mean"), n=("a", "size"))
        tg = tg[tg.n >= 30]
        ts = dd.groupby("off").agg(a=("a", "mean"), r=("r", "mean"), n=("a", "size"))
        ts = ts[ts.n >= 300]
        ts["season"] = y
        tg_rows.append(ts.reset_index())
        sc = s
        rows.append(dict(season=y, plays=int(s.sum()), ours_mean_epa=float(a.mean()), release_mean_epa=float(np.nanmean(r)),
                         pass_epa=float(e.epa.to_numpy()[s & (d.cat == "pass").to_numpy()].mean()),
                         rush_epa=float(e.epa.to_numpy()[s & (d.cat == "rush").to_numpy()].mean()),
                         corr_play=float(np.corrcoef(a[okk], r[okk])[0, 1]), corr_team_game=float(tg.a.corr(tg.r)),
                         corr_team_season=float(ts.a.corr(ts.r)),
                         plays_per_game=float(s.sum() / G), yards_per_play=float(d.yards.to_numpy()[s].mean()),
                         garbage_cfbd=float(e.garbage_cfbd.to_numpy()[sc].mean()), garbage_wp=float(e.garbage_wp.to_numpy()[sc].mean()),
                         both=float((e.garbage_cfbd & e.garbage_wp).to_numpy()[sc].mean()),
                         mean_ep_start=float(e.ep.to_numpy()[s].mean())))
    t = pd.DataFrame(rows)
    t.to_csv(OUT / "epa_by_season.csv", index=False)
    res["epa_by_season"] = t.round(4).to_dict("records")
    early, late = t[t.season <= 2013], t[(t.season >= 2014) & (t.season <= 2024)]
    res["level_shift"] = {"ours_2004_2013": float(np.average(early.ours_mean_epa, weights=early.plays)),
                          "ours_2014_2024": float(np.average(late.ours_mean_epa, weights=late.plays)),
                          "release_2004_2013": float(np.average(early.release_mean_epa, weights=early.plays)),
                          "release_2014_2024": float(np.average(late.release_mean_epa, weights=late.plays))}
    lines += ["", "## By season (FBS-vs-FBS rush and pass plays, kneels and spikes out)", "",
              "| season | plays | our EPA/play | release EPA/play | pass | rush | r (play) | r (team-game) | r (team-season) | garbage: CFBD rule | garbage: WP | yards/play |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        lines.append(f"| {r['season']} | {r['plays']:,} | {r['ours_mean_epa']:+.3f} | {r['release_mean_epa']:+.3f} | {r['pass_epa']:+.3f} | "
                     f"{r['rush_epa']:+.3f} | {r['corr_play']:.3f} | {r['corr_team_game']:.3f} | {r['corr_team_season']:.3f} | "
                     f"{r['garbage_cfbd']:.1%} | {r['garbage_wp']:.1%} | {r['yards_per_play']:.2f} |")
    # ---- CFBD PPA, team-season level, from the classic file -------------------
    ours = pd.concat(tg_rows, ignore_index=True)
    fb = pd.read_parquet(WORK / "fbs_teams.parquet")
    ppa_rows = []
    for y in range(2014, 2026):
        c = pd.read_parquet(RAW / "cfbfastR_cfb_pbp" / f"play_by_play_{y}.parquet",
                            columns=["game_play_number", "game_id", "pos_team", "home_team", "home_team_id", "away_team", "away_team_id",
                                     "ppa", "EPA", "rush", "pass"]).drop_duplicates(["game_id", "game_play_number"])
        # (id_play is stored as a float in the classic file and loses its last digits, so it cannot be the key)
        c = c[((c.rush == 1) | (c["pass"] == 1)) & c.ppa.notna()]
        c["off"] = np.where(c.pos_team == c.home_team, c.home_team_id, np.where(c.pos_team == c.away_team, c.away_team_id, np.nan))
        k = c.groupby("off").agg(ppa=("ppa", "mean"), cepa=("EPA", "mean"), n=("ppa", "size")).reset_index()
        k = k[k.n >= 200]
        k["season"] = y
        ppa_rows.append(k)
    ppa = pd.concat(ppa_rows, ignore_index=True)
    mm = ours.merge(ppa, on=["season", "off"])
    mm = mm.merge(fb[["season", "team_id"]], left_on=["season", "off"], right_on=["season", "team_id"])
    res["ppa_team_season"] = {"n": int(len(mm)), "r_ours_vs_cfbd_ppa": float(mm.a.corr(mm.ppa)),
                              "r_release_vs_cfbd_ppa": float(mm.r.corr(mm.ppa)), "r_ours_vs_release": float(mm.a.corr(mm.r)),
                              "r_ours_vs_classic_epa": float(mm.a.corr(mm.cepa)),
                              "by_season": {int(y): float(x.a.corr(x.ppa)) for y, x in mm.groupby("season")}}
    lines += ["", "## Against CFBD's PPA (team-season offence, per play, 2014-2025; PPA read from the classic file, no API call)", "",
              f"- our EPA vs CFBD PPA: r = {res['ppa_team_season']['r_ours_vs_cfbd_ppa']:.3f} over {len(mm)} team-seasons",
              f"- release EPA vs CFBD PPA: r = {res['ppa_team_season']['r_release_vs_cfbd_ppa']:.3f}",
              f"- our EPA vs release EPA: r = {res['ppa_team_season']['r_ours_vs_release']:.3f}"]
    (OUT / "ep_report.json").write_text(json.dumps(res, indent=1, default=float))
    (OUT / "ep_report.md").write_text("\n".join(lines) + "\n")
    # chart
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.5))
    c = pd.DataFrame(res["ep_calibration_2025"])
    ax[0].plot(c.predicted, c.actual, "o-", color="#1f4e9c")
    lim = [c.predicted.min() - 0.3, c.predicted.max() + 0.3]
    ax[0].plot(lim, lim, "--", color="#999")
    ax[0].set(title="EP calibration, held-out 2025", xlabel="predicted EP (decile mean)", ylabel="actual next-score value")
    cw = pd.DataFrame(res["wp_calibration_2025"])
    ax[1].plot(cw.predicted, cw.actual, "o-", color="#b3261e")
    ax[1].plot([0, 1], [0, 1], "--", color="#999")
    ax[1].set(title="WP calibration, held-out 2025", xlabel="predicted win probability", ylabel="actual win rate")
    ax[2].plot(t.season, t.ours_mean_epa, "o-", label="WCE EPA/play", color="#1f4e9c")
    ax[2].plot(t.season, t.release_mean_epa, "s--", label="release EPA/play", color="#b3261e")
    ax[2].axvline(2013.5, color="#999", ls=":")
    ax[2].set(title="Mean EPA per scrimmage play by season", xlabel="season")
    ax[2].legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "ep_wp_calibration.png", dpi=110)
    print("\n".join(lines))


if __name__ == "__main__":
    {"fit": fit, "score": score, "report": report}[sys.argv[1]]()
