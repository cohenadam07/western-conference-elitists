"""1.1.0: every per-play column the stat expansion adds, in one place.

playergame.py (players) and teamgame.py (teams) both call `enrich`, so a player's numbers and his team's
cannot be built from different definitions. The models it applies are WCE's own, fitted once on finished
seasons by xmodels.py and frozen in pipeline/cfb/state/expansion.json, so the cloud refresh of the season
being played applies the same numbers the Mac's full build does. No release-file model output (xpass,
go_boost, fourth_down_recommendation, line_yards, air_yards) is read: those are used only to check ours.

Definitions (each is written into the registry's explainer too):

  first down    the play gains the line to gain or scores, with no turnover (penalty first downs are not the
                player's: no-play rows are not scrimmage plays)
  red zone      the snap is at the opponent's 20 or closer; goal line: the 5 or closer
  short yardage third or fourth down with 2 or fewer to go, or the snap at the 2 or closer
  two-minute    the last two minutes of either half
  middle 8      the last four minutes of the first half and the first four of the second (Connelly)
  in doubt      the offence's win probability before the snap is between 20% and 80%
  neutral       in doubt, first to third down, and not in the two-minute drill (pass rate over expected)
  line yards    losses count 120%, the first 4 yards in full, yards 5 to 10 at half, nothing beyond (Football
                Outsiders; the same formula 1.0.0's team line yards use)
  second level  yards 5 to 10 of a run; open field: yards beyond 10; opportunity: a run of 4+ yards;
                highlight yards: what the line is not credited with, on opportunity runs
  WPA           the offence's win probability after the play less before it (WCE's 1.0.0 model); the play
                after a change of possession is read from the other side; the last play of a game ends at 1 or 0
"""
import json
import warnings
import numpy as np
import pandas as pd
from .paths import WORK
from .state import DIR

XFILE = DIR / "expansion.json"
MODELS = DIR / "models"
XPASS_FEATS = ["down", "dist", "ytg", "score_diff", "secs_game", "secs_half", "period", "wp"]
warnings.simplefilter("ignore", pd.errors.PerformanceWarning)
_X = {}


def xstate():
    if "s" not in _X:
        _X["s"] = json.loads(XFILE.read_text()) if XFILE.exists() else {}
    return _X["s"]


def reset():
    _X.clear()


def joblib_model(name):
    if name not in _X:
        import joblib
        _X[name] = joblib.load(MODELS / name)
    return _X[name]


# ---------------------------------------------------------------- feature builders (shared with xmodels.py)
def _ytg(d):
    return np.clip(d.ytg.to_numpy(dtype=float), 1, 99)


def _dist(d):
    return np.clip(np.nan_to_num(d.dist.to_numpy(dtype=float), nan=10.0), 1, 40)


def _down(d):
    return np.nan_to_num(d.down.to_numpy(dtype=float), nan=1.0)


def td_X(d):
    """Expected-touchdown features: where the snap is, the down and the distance."""
    y, dist, dn = _ytg(d), _dist(d), _down(d)
    return np.column_stack([y / 100, np.log(y), y <= 1, y <= 3, y <= 5, y <= 10, y <= 20, dn == 2, dn == 3, dn == 4,
                            np.log(dist), dist >= y]).astype(float)


TD_FEATS = ["ytg/100", "log ytg", "at the 1", "inside the 3", "inside the 5", "inside the 10", "inside the 20", "2nd", "3rd", "4th",
            "log distance", "goal to go"]


def pass_X(d):
    """Expected-pass features: down and distance, field, score, clock and win probability."""
    y, dist, dn = _ytg(d), _dist(d), _down(d)
    sd = np.clip(np.nan_to_num(d.score_diff.to_numpy(dtype=float)), -35, 35)
    sg = np.nan_to_num(d.secs_game.to_numpy(dtype=float), nan=1800)
    el = np.clip(1 - sg / 3600, 0, 1)
    wp = np.clip(np.nan_to_num(d.wp.to_numpy(dtype=float), nan=0.5), 0.001, 0.999)
    sh = np.nan_to_num(d.secs_half.to_numpy(dtype=float), nan=900)
    per = np.nan_to_num(d.period.to_numpy(dtype=float), nan=1)
    ld = np.log(dist)
    return np.column_stack([dn == 2, dn == 3, dn == 4, ld, ld * (dn == 2), ld * (dn >= 3), dist >= 10, y / 100, y <= 5, dist >= y,
                            sd / 35, (sd / 35) * np.exp(3 * el), wp, wp ** 2, np.log(wp / (1 - wp)), (sh <= 120) & (per == 2),
                            (sh <= 120) & (per == 4), ((sh <= 300) & (per == 4)) * np.clip(-sd, 0, 35) / 35, el]).astype(float)


def conv_X(d):
    """Fourth-down conversion features."""
    y, dist = _ytg(d), _dist(d)
    return np.column_stack([np.log(dist), dist == 1, dist <= 3, y / 100, dist >= y, y <= 5]).astype(float)


def go_X(d):
    """What an average FBS coach does on fourth down: features of the spot, the distance, the score and the clock."""
    y, dist = _ytg(d), _dist(d)
    sd = np.clip(np.nan_to_num(d.score_diff.to_numpy(dtype=float)), -35, 35)
    sg = np.nan_to_num(d.secs_game.to_numpy(dtype=float), nan=1800)
    el = np.clip(1 - sg / 3600, 0, 1)
    wp = np.clip(np.nan_to_num(d.wp.to_numpy(dtype=float), nan=0.5), 0.001, 0.999)
    return np.column_stack([np.log(dist), dist == 1, dist <= 3, y / 100, (y / 100) ** 2, (y >= 30) & (y <= 40), (y > 40) & (y <= 55),
                            y <= 5, dist >= y, sd / 35, (sd / 35) * np.exp(3 * el), np.log(wp / (1 - wp)), el,
                            (el > 0.9) & (sd < 0)]).astype(float)


AIR_KNOTS = [-5, 0, 5, 10, 15, 20, 30, 40]


def cmp_X(d):
    """Completion features on a charted throw: air yards (hinged), direction, down and distance, formation,
    whether he was hurried, home or away, and how much field there is behind the target."""
    a = np.clip(d.air.to_numpy(dtype=float), -15, 60)
    side = d.side.to_numpy(dtype=object)
    dist, dn = _dist(d), _down(d)
    y = _ytg(d)
    spot = np.nan_to_num(d.spot_ytg.to_numpy(dtype=float), nan=50.0)
    hur = d.n_hur.fillna(0).to_numpy() > 0
    cols = [a / 10] + [np.maximum(0, a - k) / 10 for k in AIR_KNOTS]
    cols += [side == "left", side == "right", dn == 2, dn == 3, dn == 4, np.log(dist), d.shotgun.fillna(False).to_numpy(), hur,
             hur * np.clip(a, 0, 40) / 10, d.is_home.to_numpy(), spot <= 0, y / 100, (side == "middle") * np.clip(a, 0, 40) / 10]
    return np.column_stack(cols).astype(float)


def cell_X(d):
    """1.0.0's completion model, for the comparison: depth, side, down and distance cells."""
    return pd.DataFrame({"p_deep": d.p_deep.to_numpy(), "p_side": d.p_side.to_numpy(), "dn_": d.down.clip(1, 4).to_numpy(),
                         "db_": pd.cut(d.dist, [-1, 3, 6, 10, 99], labels=False).to_numpy()})


def yac_X(d):
    a = np.clip(d.air.to_numpy(dtype=float), -15, 60)
    side = d.side.to_numpy(dtype=object)
    dist, dn = _dist(d), _down(d)
    room = np.clip(np.nan_to_num(d.spot_ytg.to_numpy(dtype=float), nan=50.0), 0, 100)
    cols = [a / 10] + [np.maximum(0, a - k) / 10 for k in AIR_KNOTS]
    cols += [side == "left", side == "right", (side == "middle") * np.clip(a, 0, 40) / 10, dn == 2, dn == 3, dn == 4, np.log(dist),
             np.log1p(room), room <= 10, d.shotgun.fillna(False).to_numpy()]
    return np.column_stack(cols).astype(float)


def logit(m, X):
    z = m["intercept"] + X @ np.asarray(m["coef"], dtype=float)
    return 1 / (1 + np.exp(-z))


def linear(m, X):
    return m["intercept"] + X @ np.asarray(m["coef"], dtype=float)


# ---------------------------------------------------------------- per-play columns
def wpa(d):
    """Win probability added for the offence on each row with a win probability (d is in game order). The last
    row of a game with a win probability ends at the result (1 or 0); in a game that went to overtime, where the
    model has no win probability, those rows are left empty."""
    gid = d.game_id.to_numpy()
    wp = d.wp.to_numpy(dtype=float)
    off = d.off.to_numpy()
    n = len(d)
    after = np.full(n, np.nan)
    won = d["_won"].to_numpy(dtype=float) if "_won" in d.columns else np.full(n, np.nan)
    nxt_wp, nxt_off, nxt_g = np.nan, np.nan, None
    for i in range(n - 1, -1, -1):
        if gid[i] != nxt_g:
            nxt_wp, nxt_off, nxt_g = np.nan, np.nan, gid[i]
        if np.isnan(wp[i]):
            continue
        if np.isnan(nxt_wp):
            after[i] = won[i]
        else:
            after[i] = nxt_wp if nxt_off == off[i] else 1 - nxt_wp
        nxt_wp, nxt_off = wp[i], off[i]
    return after - wp


def enrich(d, y, games=None):
    """Adds the expansion's per-play columns to a play frame that already has playergame / teamgame's base flags
    (sc, is_pass, is_rush, attp, comp, succ, epa0) and ep, epa, wp. Returns d."""
    X = xstate()
    yv = d.yards.to_numpy(dtype=float)
    sc = d.sc.to_numpy()
    td7 = (d.pts == 7).to_numpy()
    turnover = (d.f_int | d.f_fum_lost).to_numpy()
    d["fd"] = sc & ((yv >= d.dist.to_numpy(dtype=float)) | td7) & ~turnover & ~d.f_sack.to_numpy() & ~(d.attp & ~d.comp).to_numpy()
    ytg = d.ytg.to_numpy(dtype=float)
    dn = d.down.to_numpy(dtype=float)
    dist = d.dist.to_numpy(dtype=float)
    d["rz"] = sc & (ytg <= 20)
    d["gl"] = sc & (ytg <= 5)
    d["dn34"] = sc & (dn >= 3)
    d["short"] = sc & (((dn >= 3) & (dist <= 2)) | (ytg <= 2))
    sh, per = d.secs_half.to_numpy(dtype=float), d.period.to_numpy()
    d["twomin"] = sc & (sh <= 120) & np.isin(per, [2, 4])
    d["mid8"] = sc & (((per == 2) & (sh <= 240)) | ((per == 3) & (sh >= 1560)))
    wp = d.wp.to_numpy(dtype=float)
    d["doubt"] = sc & (wp >= 0.2) & (wp <= 0.8)
    d["neutral"] = d.doubt & (dn <= 3) & ~d.twomin
    d["early"] = d.neutral & (dn <= 2)
    run = d.is_rush.to_numpy()
    yr = np.where(run, yv, 0.0)
    d["ly"] = np.where(run, np.where(yr < 0, 1.2 * yr, np.minimum(yr, 4) + 0.5 * np.clip(yr - 4, 0, 6)), 0.0)
    d["slv"] = np.where(run, np.clip(yr - 4, 0, 6), 0.0)
    d["ofy"] = np.where(run, np.clip(yr - 10, 0, None), 0.0)
    d["opp4"] = run & (yr >= 4)
    d["hly"] = np.where(d.opp4, yr - d.ly, 0.0)
    d["is_td"] = sc & td7
    # ---- models
    d["xtd"] = np.nan
    d["xpass"] = np.nan
    if X:
        m = sc & run
        if m.any():
            d.loc[m, "xtd"] = logit(X["xtd"]["rush"], td_X(d[m]))
        m = sc & d.is_pass.to_numpy()
        if m.any():
            d.loc[m, "xtd"] = logit(X["xtd"]["dropback"], td_X(d[m]))
        d["xtd_tgt"] = np.nan
        m = d.attp.to_numpy()
        if m.any():
            d.loc[m, "xtd_tgt"] = logit(X["xtd"]["target"], td_X(d[m]))
        m = sc & ~np.isnan(wp)
        if m.any() and (MODELS / "xpass_model.joblib").exists():
            d.loc[m, "xpass"] = joblib_model("xpass_model.joblib").predict_proba(d.loc[m, XPASS_FEATS].astype(float))[:, 1]
    else:
        d["xtd_tgt"] = np.nan
    d["xtd"] = d.xtd.fillna(0.0)
    d["xtd_tgt"] = d.xtd_tgt.fillna(0.0)
    d["proe_n"] = np.where(d.neutral & d.xpass.notna(), d.is_pass.astype(float) - d.xpass.fillna(0), 0.0)
    d["neutral_x"] = d.neutral & d.xpass.notna()
    d["wpa"] = wpa(d) if "wp" in d.columns else np.nan
    d["wpa0"] = np.where(sc, np.nan_to_num(d.wpa.to_numpy(dtype=float)), 0.0)
    return d


def outcome_cols(d, games):
    """_won and _reg_end, which wpa() needs: did the offence win, and is this the last row of regulation."""
    g = games.set_index("game_id")
    hm = d.game_id.map(g.home_margin)
    home = d.off == d.game_id.map(g.home)
    d["_won"] = np.where(hm.isna() | (hm == 0), np.nan, np.where(home, hm > 0, hm < 0).astype(float))
    ot = d.groupby("game_id").period.transform("max") >= 5
    d["_won"] = np.where(ot, np.nan, d._won)
    return d


def charted(d, y):
    """Joins the charted columns (charting.py) and the per-play Tier B flags. Rows outside a charted game get
    c_ok = False and contribute nothing to any Tier B number."""
    f = WORK / f"chart_{y}.parquet"
    cols = ["play_id", "game_ok", "shotgun", "no_huddle", "depth", "side", "spot_ytg", "air", "yac", "run_dir", "hur1", "hur2", "n_hur",
            "pbu1", "n_pbu", "tk1", "tk2", "tk3", "n_tk"]
    if f.exists():
        c = pd.read_parquet(f, columns=cols)
    else:                                   # a season before charting: every Tier B column empty, nothing charted
        c = pd.DataFrame({k: pd.Series(dtype=object if k in ("depth", "side") else float) for k in cols})
        c["play_id"] = c.play_id.astype("int64")
        c["game_ok"] = c.game_ok.astype(bool)
    c = c.rename(columns={k: "c_" + k for k in cols if k != "play_id"})
    d = d.merge(c, on="play_id", how="left")
    d["c_ok"] = d.c_game_ok.fillna(False).astype(bool) & d.sc
    d["is_home"] = (d.off == d.home).astype(float)
    d["c_shotgun"] = d.c_shotgun.fillna(False).astype(bool) & d.c_ok
    d["c_uc"] = ~d.c_shotgun & d.c_ok
    d["c_nh"] = d.c_no_huddle.fillna(False).astype(bool) & d.c_ok
    d["c_db"] = d.c_ok & d.is_pass
    d["c_rush"] = d.c_ok & d.is_rush
    d["c_att"] = d.c_ok & d.attp
    d["c_hur"] = d.c_ok & d.is_pass & (d.c_n_hur.fillna(0) > 0)
    d["c_press"] = d.c_ok & d.is_pass & ((d.c_n_hur.fillna(0) > 0) | d.f_sack)
    d["c_clean"] = d.c_db & ~d.c_press
    d["c_airok"] = d.c_att & d.c_air.notna()
    d["c_air0"] = np.where(d.c_airok, d.c_air.fillna(0), 0.0)
    d["c_cair"] = np.where(d.c_airok & d.comp, d.c_air.fillna(0), 0.0)
    d["c_yacok"] = d.c_airok & d.comp & d.c_yac.notna()
    d["c_yac0"] = np.where(d.c_yacok, d.c_yac.fillna(0), 0.0)
    a = d.c_air
    d["c_deep"] = d.c_airok & (d.c_depth == "deep")
    d["c_behind"] = d.c_airok & (a < 0)
    for k, lo, hi in (("b0", -99, 0), ("b1", 0, 10), ("b2", 10, 20), ("b3", 20, 999)):
        m = d.c_airok & (a >= lo) & (a < hi)
        d[f"c_{k}_att"] = m
        d[f"c_{k}_cmp"] = m & d.comp
        d[f"c_{k}_yds"] = np.where(m & d.comp, d.yards, 0.0)
        d[f"c_{k}_epa"] = np.where(m, d.epa0, 0.0)
    for k, v in (("l", "left"), ("m", "middle"), ("r", "right")):
        d[f"c_t{k}"] = d.c_airok & (d.c_side == v)
    rd = d.c_run_dir
    for k, v in (("l", 0), ("m", 1), ("r", 2)):
        m = d.c_rush & (rd == v)
        d[f"c_r{k}"] = m
        d[f"c_r{k}_succ"] = m & d.succ
        d[f"c_r{k}_ly"] = np.where(m, d.ly, 0.0)
        d[f"c_r{k}_stuff"] = m & (d.yards <= 0)
        d[f"c_r{k}_epa"] = np.where(m, d.epa0, 0.0)
    for k in ("shotgun", "uc", "nh"):
        d[f"c_{k}_epa"] = np.where(d[f"c_{k}" if k != "shotgun" else "c_shotgun"], d.epa0, 0.0)
    d["c_shot_db"] = d.c_db & d.c_shotgun
    d["c_shot_rush"] = d.c_rush & d.c_shotgun
    d["c_uc_rush"] = d.c_rush & d.c_uc
    d["c_shot_rush_epa"] = np.where(d.c_shot_rush, d.epa0, 0.0)
    d["c_uc_rush_epa"] = np.where(d.c_uc_rush, d.epa0, 0.0)
    d["c_press_epa"] = np.where(d.c_press, d.epa0, 0.0)
    d["c_clean_epa"] = np.where(d.c_clean, d.epa0, 0.0)
    d["c_sack"] = d.c_db & d.f_sack
    # expected completion and YAC (xmodels.py)
    X = xstate()
    d["c_xc"], d["c_xyac"] = np.nan, np.nan
    if X.get("cmp") and d.c_airok.any():
        m = d.c_airok.to_numpy()
        z = d[m].rename(columns={"c_air": "air", "c_side": "side", "c_spot_ytg": "spot_ytg", "c_n_hur": "n_hur", "c_shotgun": "shotgun"})
        d.loc[m, "c_xc"] = logit(X["cmp"], cmp_X(z))
    if X.get("yac") and d.c_yacok.any():
        m = d.c_yacok.to_numpy()
        z = d[m].rename(columns={"c_air": "air", "c_side": "side", "c_spot_ytg": "spot_ytg", "c_shotgun": "shotgun"})
        d.loc[m, "c_xyac"] = linear(X["yac"], yac_X(z))
    d["c_cpoe"] = np.where(d.c_airok & d.c_xc.notna(), d.comp.astype(float) - d.c_xc.fillna(0), 0.0)
    d["c_cpoe_n"] = d.c_airok & d.c_xc.notna()
    d["c_yacoe"] = np.where(d.c_yacok & d.c_xyac.notna(), d.c_yac0 - d.c_xyac.fillna(0), 0.0)
    d["c_yacoe_n"] = d.c_yacok & d.c_xyac.notna()
    return d
