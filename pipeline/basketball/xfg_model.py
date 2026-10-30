"""
xfg_model.py — expected field-goal % for every shot, and the two card stats built on it.

    xefg    Shot quality: the eFG% an average NBA shooter would post on his exact shots
    shotmk  Shot-making: his actual eFG% minus that (percentage points)

THE MODEL. Every field-goal attempt since 2013-14 (~2.8M shots, from the NBA's shot chart:
location, distance, the NBA's action type such as "Pullup Jump Shot" or "Driving Layup",
2 vs 3, period and time left) goes into a gradient-boosted classifier of make/miss. The
shooter is NOT a feature: the model says how often the league makes that shot, so whatever
he does above it is his. Each season is then re-centred (one logit shift) so the league's
expected eFG equals its actual eFG that year, which takes out era drift.

VALIDATION. Trained on 2013-14 to 2024-25, scored on 2025-26 (never seen): log loss and
calibration against two baselines, a 2-vs-3 constant and a shot-zone table. The report is
written to out/xfg_report.txt and printed.

    python xfg_model.py train            # fetch shots, validate on the newest season, fit on all, save
    python xfg_model.py apply 2025-26    # (diagnostic) per-player results for one season

The fitted model is out/xfg_model.joblib (gitignored; `train` rebuilds it). Shots come from
ShotChartDetail per team (the league-wide call stops at 102,400 rows).
"""
import json, math, os, sys
import numpy as np
import pandas as pd
import savant_engine as E
import savant_config as C

MODEL = os.path.join("out", "xfg_model.joblib")
REPORT = os.path.join("out", "xfg_report.txt")
FIRST = 2013
FEATS = ["LOC_X", "LOC_Y", "SHOT_DISTANCE", "is3", "action", "period", "secs_left"]


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def fetch_season(season):
    from nba_api.stats.endpoints import shotchartdetail as S
    from nba_api.stats.static import teams as static_teams
    parts = []
    for t in static_teams.get_teams():
        df = E.call(S.ShotChartDetail, dict(team_id=t["id"], player_id=0, season_nullable=season,
                    season_type_all_star=C.SEASON_TYPE, context_measure_simple="FGA"))
        if len(df):
            parts.append(df)
    df = pd.concat(parts, ignore_index=True)
    df = df.drop_duplicates(["GAME_ID", "GAME_EVENT_ID"])
    df["season"] = season
    return df


def features(df, actions=None):
    X = pd.DataFrame({
        "LOC_X": df["LOC_X"].astype(float),
        "LOC_Y": df["LOC_Y"].astype(float),
        "SHOT_DISTANCE": df["SHOT_DISTANCE"].astype(float),
        "is3": (df["SHOT_TYPE"].astype(str).str.startswith("3")).astype(int),
        "period": df["PERIOD"].clip(upper=5).astype(int),
        "secs_left": (df["MINUTES_REMAINING"].astype(int) * 60 + df["SECONDS_REMAINING"].astype(int)).clip(upper=720),
    })
    a = df["ACTION_TYPE"].astype(str)
    if actions is not None:
        a = a.where(a.isin(actions), "Other")
    X["action"] = pd.Categorical(a, categories=(list(actions) + ["Other"]) if actions is not None else None)
    return X


def _clf():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_iter=400, learning_rate=0.06, max_leaf_nodes=48,
                                          min_samples_leaf=200, l2_regularization=1.0,
                                          categorical_features="from_dtype", random_state=7)


def _logloss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def season_shift(p, y):
    """Logit shift that makes mean(p) equal mean(y): one number per season."""
    lo, hi = -2.0, 2.0
    target = float(np.mean(y))
    lp = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    for _ in range(50):
        mid = (lo + hi) / 2
        if np.mean(1 / (1 + np.exp(-(lp + mid)))) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def apply_shift(p, s):
    lp = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    return 1 / (1 + np.exp(-(lp + s)))


def train():
    import joblib
    last_done = int(C.SEASONS[1][:4]) if C.SEASONS[0] != C.SEASONS[1] else int(C.SEASONS[0][:4])
    # the newest finished season (the current one may have no games yet)
    seasons = [season_label(y) for y in range(FIRST, last_done + 1)]
    frames = []
    for s in seasons:
        df = fetch_season(s)
        print(f"  {s}: {len(df):,} shots", flush=True)
        frames.append(df)
    allx = pd.concat(frames, ignore_index=True)
    vc = allx["ACTION_TYPE"].value_counts()
    actions = sorted(vc[vc >= 500].index.tolist())
    y = allx["SHOT_MADE_FLAG"].astype(int).values
    X = features(allx, actions)
    hold = allx["season"].values == seasons[-1]

    lines = [f"xFG model — trained {seasons[0]}..{seasons[-2]}, scored on {seasons[-1]} (unseen)",
             f"shots: {len(allx):,} total, {hold.sum():,} in the holdout; {len(actions)} action types (+ Other)"]
    # baselines on the holdout
    tr = ~hold
    p2v3 = np.where(X["is3"][hold] == 1, y[tr][X["is3"][tr] == 1].mean(), y[tr][X["is3"][tr] == 0].mean())
    zone = allx["SHOT_ZONE_BASIC"].astype(str) + "|" + allx["SHOT_ZONE_AREA"].astype(str)
    zt = pd.Series(y[tr]).groupby(zone[tr].values).mean()
    pz = zone[hold].map(zt).fillna(y[tr].mean()).values
    clf = _clf().fit(X[tr], y[tr])
    pm = clf.predict_proba(X[hold])[:, 1]
    shift = season_shift(pm, y[hold])
    pm_s = apply_shift(pm, shift)
    yh = y[hold]
    lines.append(f"log loss  2-vs-3 constant {_logloss(yh, p2v3):.4f}   shot zones {_logloss(yh, pz):.4f}   "
                 f"model {_logloss(yh, pm):.4f}   model re-centred {_logloss(yh, pm_s):.4f}   (lower is better)")
    # calibration by decile of predicted probability
    dec = pd.qcut(pm_s, 10, labels=False, duplicates="drop")
    cal = pd.DataFrame({"p": pm_s, "y": yh, "d": dec}).groupby("d").agg(pred=("p", "mean"), made=("y", "mean"), n=("y", "size"))
    lines.append("calibration on the holdout (predicted vs made, by decile):")
    for d, r in cal.iterrows():
        lines.append(f"  {int(d)+1:2}: predicted {r.pred:.3f}   made {r.made:.3f}   ({int(r.n):,} shots)")
    # player-level check: does shot quality explain eFG better than nothing?
    h = allx[hold].assign(p=pm_s, y=yh, v=np.where(X["is3"][hold] == 1, 1.5, 1.0))
    g = h.groupby("PLAYER_ID").agg(fga=("y", "size"), efg=("y", lambda s: 0), xe=("p", "mean"))
    h["pts_e"] = h["p"] * h["v"]; h["pts_a"] = h["y"] * h["v"]
    g = h.groupby("PLAYER_ID").agg(fga=("y", "size"), xefg=("pts_e", "mean"), efg=("pts_a", "mean"))
    g = g[g.fga >= 300]
    r = np.corrcoef(g.xefg, g.efg)[0, 1]
    lines.append(f"players with 300+ FGA in {seasons[-1]}: {len(g)}; correlation of expected eFG with actual eFG r = {r:.2f}")
    # final fit on everything, with one shift per season
    clf = _clf().fit(X, y)
    pa = clf.predict_proba(X)[:, 1]
    shifts = {s: float(season_shift(pa[allx["season"].values == s], y[allx["season"].values == s])) for s in seasons}
    joblib.dump({"clf": clf, "actions": actions, "shifts": shifts, "seasons": seasons}, MODEL)
    lines.append(f"final model fit on all {len(seasons)} seasons; per-season shifts {min(shifts.values()):+.3f}..{max(shifts.values()):+.3f}")
    open(REPORT, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


def load_model():
    import joblib
    return joblib.load(MODEL)


def apply(season, players, model=None):
    """Put xefg and shotmk (season window) on players, 2013-14 on. For a season the model has
    no shift for (the season in progress), the shift is fitted on that season's own shots,
    which is exact, not leakage: it only re-centres the league to its own actual eFG."""
    if int(season[:4]) < FIRST:
        return 0
    model = model or load_model()
    df = fetch_season(season)
    if not len(df):
        return 0
    X = features(df, model["actions"])
    p = model["clf"].predict_proba(X)[:, 1]
    y = df["SHOT_MADE_FLAG"].astype(int).values
    s = model["shifts"].get(season)
    if s is None:
        s = season_shift(p, y)
    p = apply_shift(p, s)
    v = np.where(X["is3"] == 1, 1.5, 1.0)
    t = pd.DataFrame({"pid": df["PLAYER_ID"].astype(int).values, "e": p * v, "a": y * v})
    g = t.groupby("pid").agg(fga=("e", "size"), xefg=("e", "mean"), efg=("a", "mean"))
    by_id = {p_["id"]: p_ for p_ in players}
    n = 0
    for pid, r in g.iterrows():
        pl = by_id.get(int(pid))
        if pl is None or r.fga <= 0:
            continue
        for win in C.WINDOWS:     # season-only, spread across windows like other season-only bars
            pl["m"].setdefault("xefg", {})[win] = {"v": round(float(r.xefg), 3), "n": int(r.fga)}
            pl["m"].setdefault("shotmk", {})[win] = {"v": round(100 * float(r.efg - r.xefg), 1), "n": int(r.fga)}
        n += 1
    return n


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "train"
    if cmd == "train":
        train()
    elif cmd == "apply":
        season = sys.argv[2]
        d = json.load(open(os.path.expanduser("~/western-conference-elitists/public/savant-data.json")))
        ps = d["data"][season]["players"]
        print(apply(season, ps), "players")
        top = sorted([p for p in ps if p.get("qualified") and "shotmk" in p["m"]], key=lambda p: -p["m"]["shotmk"]["season"]["v"])
        for p in top[:10]:
            print(p["name"], p["m"]["xefg"]["season"], p["m"]["shotmk"]["season"])
