"""1.1.0: the season frames' expansion. numbers.frames calls `extend` for each garbage-time variant.

It turns the player-game tables' new columns into the numerators and denominators the registry names
(config_x.py), and adds the frames 1.0.0 did not have:
  ret   one row per returner per game (kick and punt returns, fair catches, muffs), the RET pool
and widens two: kick (kickoffs, by the man who kicked off, and long field goals) and punt (the box score's
punting line). Penalties (pgx's pen table) join every position's frame.
"""
import numpy as np
import pandas as pd
from .paths import WORK

LONG_FG = 50


def _read(name, y, suffix):
    f = WORK / f"pg_{name}{suffix}.parquet"
    if not f.exists():
        return None
    d = pd.read_parquet(f)
    return d[d.season == y].copy()


def _first(d):
    """1 on one row per player (his first game), so a sum over his rows is 1: the denominator of a season total."""
    o = np.zeros(len(d))
    if len(d):
        first = ~d.sort_values(["date", "game_id"]).duplicated("pid")
        o[d.index.get_indexer(first[first].index)] = 1.0
    return o


def _pen(F, y, suffix):
    pen = _read("pen", y, suffix)
    if pen is None or not len(pen):
        return
    pen = pen[["game_id", "team", "pid", "pens", "pen_yds"]]
    for tab in ("qb", "rush", "rec", "dfn"):
        d = F[tab].drop(columns=[c for c in ("pens", "pen_yds") if c in F[tab].columns])
        d = d.merge(pen, on=["game_id", "team", "pid"], how="left")
        d["pens"], d["pen_yds"] = d.pens.fillna(0.0), d.pen_yds.fillna(0.0)
        F[tab] = d


def extend(F, y, suffix, state):
    qb, ru, rc, df = F["qb"].reset_index(drop=True), F["rush"].reset_index(drop=True), F["rec"].reset_index(drop=True), F["dfn"].reset_index(drop=True)
    # ---- quarterbacks
    qb["pr_num"] = 8.4 * qb.yards + 330 * qb.td + 100 * qb.cmp - 200 * qb.ints          # NCAA passer efficiency, per attempt
    qb["anya_num"] = qb.yards + 20 * qb.td - 45 * qb.ints + qb.sack_yds                   # sack yards are negative
    qb["one"] = _first(qb)
    drv = _read("drv", y, suffix)
    if drv is not None:
        qb = qb.merge(drv[["game_id", "team", "pid", "drives", "d_pts", "d_td", "d_3out"]], on=["game_id", "team", "pid"], how="left")
    for c in ("drives", "d_pts", "d_td", "d_3out"):
        qb[c] = qb[c].fillna(0.0) if c in qb.columns else 0.0
    ru_q = ru[["game_id", "team", "pid", "fd", "short", "short_fd", "xtd", "wpa", "fum_own"]].rename(
        columns={"fd": "q_fd", "short": "q_short", "short_fd": "q_short_fd", "xtd": "q_xtd", "wpa": "q_wpa", "fum_own": "q_fum"})
    qb = qb.merge(ru_q, on=["game_id", "team", "pid"], how="left")
    for c in ("q_fd", "q_short", "q_short_fd", "q_xtd", "q_wpa", "q_fum"):
        qb[c] = qb[c].fillna(0.0)
    qb["tot_wpa"] = qb.wpa + qb.q_wpa
    qb["tdoe"] = (qb.pass_td + qb.q_rush_td) - (qb.xtd + qb.q_xtd)
    qb["all_short"] = qb.short_db + qb.q_short
    qb["all_short_fd"] = qb.short_fd + qb.q_short_fd
    qb["touch"] = qb.db + qb.q_rush
    qb["fum_all"] = qb.fum_db + qb.q_fum
    qb["c_uc_db"] = qb.c_db - qb.c_shot_db
    qb["c_press_all"] = qb.c_press
    # ---- running backs (his receiving rows joined as r_*)
    rr = rc[["game_id", "team", "pid", "wpa", "xtd", "c_airok", "c_air0", "c_yacok", "c_yac0", "fd"]].rename(
        columns={"wpa": "r_wpa", "xtd": "r_xtd", "c_airok": "r_c_airok", "c_air0": "r_c_air0", "c_yacok": "r_c_yacok", "c_yac0": "r_c_yac0",
                 "fd": "r_fd"})
    ru = ru.merge(rr, on=["game_id", "team", "pid"], how="left")
    for c in rr.columns[3:]:
        ru[c] = ru[c].fillna(0.0)
    tq = F["team"][["game_id", "team", "rz_rush", "gl_rush", "rz_att", "third_att", "c_att", "c_air", "c_ez", "proe_n", "neutral_x", "tgt_tracked",
                    "un_xtd", "un_wpa", "dhavoc", "d3db", "ddb_c", "drush_c", "dpress_c", "dplays_c", "datt_c", "plays"]].rename(
        columns={"rz_rush": "t_rz_rush", "gl_rush": "t_gl_rush", "rz_att": "t_rz_att", "third_att": "t_third_att", "c_att": "t_c_att",
                 "c_air": "t_c_air", "c_ez": "t_c_ez", "proe_n": "t_proe", "neutral_x": "t_neutral", "plays": "t_plays_all"})
    ru = ru.merge(tq[["game_id", "team", "t_rz_rush", "t_gl_rush", "t_plays_all"]], on=["game_id", "team"], how="left")
    qb = qb.merge(tq[["game_id", "team", "t_proe", "t_neutral"]], on=["game_id", "team"], how="left")
    qb["t_proe"], qb["t_neutral"] = qb.t_proe.fillna(0.0), qb.t_neutral.fillna(0.0)
    ru["one"] = _first(ru)
    ru["tdoe"] = (ru.td + ru.r_td) - (ru.xtd + ru.r_xtd)
    ru["tot_wpa"] = ru.wpa + ru.r_wpa
    ru["touch"] = ru.rush + ru.r_rec
    ru["g1"] = 1.0
    # ---- receivers: the un-named incompletions' expected touchdowns and WPA shared out by catches, as 1.0.0 does EPA
    rc = rc.merge(tq[["game_id", "team", "t_rz_att", "t_third_att", "t_c_att", "t_c_air", "t_c_ez", "un_xtd", "un_wpa", "t_plays_all"]],
                  on=["game_id", "team"], how="left")
    share = np.where(rc.t_cmp > 0, rc.rec / rc.t_cmp.clip(lower=1), 0.0)
    rc["xtd_eff"] = rc.xtd + share * rc.un_xtd.fillna(0)
    rc["wpa_eff"] = rc.wpa + share * rc.un_wpa.fillna(0)
    tr = rc.tgt_tracked.fillna(False).astype(bool)
    for a, b in (("rz_tgt", "t_rz_att"), ("third_tgt", "t_third_att")):
        rc[a + "_t"] = np.where(tr, rc[a], 0.0)
        rc[b + "_t"] = np.where(tr, rc[b], 0.0)
    rc["one"] = _first(rc)
    rc["tdoe"] = rc.td - rc.xtd_eff
    # WOPR (target share x 1.5 + air-yards share x 0.7), charted games, game by game weighted by team attempts
    rc["wopr_num"] = 1.5 * rc.c_att + 0.7 * rc.c_air0 * np.where(rc.t_c_air > 0, rc.t_c_att / rc.t_c_air.where(rc.t_c_air > 0, 1), 0.0)
    rc["c_dp_short"] = rc.c_sh_tgt
    # ---- defenders
    df = df.merge(tq[["game_id", "team", "dhavoc", "d3db", "ddb_c", "drush_c", "dpress_c", "dplays_c"]], on=["game_id", "team"], how="left")
    for c in ("dhavoc", "d3db", "ddb_c", "drush_c", "dpress_c", "dplays_c"):
        df[c] = df[c].fillna(0.0)
    hb = df.has_box.fillna(False).to_numpy()
    df["e_solo"] = np.where(hb, df.b_solo.fillna(0), df.solo)
    df["e_asst"] = np.where(hb, (df.b_tkl.fillna(0) - df.b_solo.fillna(0)).clip(lower=0), df.asst)
    df["e_tfl_pass"] = df.e_sack + df.tfl_pass
    df["neg_sack_epa"] = -df.sack_epa
    df["neg_sack_yds"] = -df.sack_yds
    df["neg_int_epa"] = -df.int_epa
    df["one"] = _first(df)
    df["cpress"] = df.chur + df.csack
    df["cg"] = (df.dplays_c > 0).astype(float)              # charted games of his team
    F.update(qb=qb, rush=ru, rec=rc, dfn=df)
    _pen(F, y, suffix)
    # ---- kickers: field goals (numbers.frames' rows) plus kickoffs and long tries
    kick = F["kick"]
    k1 = _read("kick", y, suffix)
    if k1 is not None and len(k1):
        k1 = k1[k1.dist.between(17, 70)]
        lg = k1.assign(l_att=(k1.dist >= LONG_FG).astype(float), l_made=((k1.dist >= LONG_FG) & k1.made).astype(float)).groupby(
            ["game_id", "team", "pid"])[["l_att", "l_made"]].sum().reset_index()
        kick = kick.merge(lg, on=["game_id", "team", "pid"], how="left")
    ko = _read("ko", y, suffix)
    if ko is not None and len(ko):
        kick = kick.merge(ko[["game_id", "team", "pid", "season", "date", "week", "opp", "kos", "ko_tb", "ko_epa", "ko_epa_n"]],
                          on=["season", "game_id", "team", "pid", "date", "week", "opp"], how="outer")
    for c in ("l_att", "l_made", "kos", "ko_tb", "ko_epa", "ko_epa_n", "fga", "made", "fgoe", "pts_oe"):
        kick[c] = kick[c].fillna(0.0) if c in kick.columns else 0.0
    if "long" in kick.columns:
        kick["long"] = kick.long.fillna(0.0)
    F["kick"] = kick
    # ---- punters: the box score's line
    pb = _read("pbox", y, suffix)
    punt = F["punt"]
    if pb is not None and len(pb):
        punt = punt.merge(pb[["game_id", "team", "pid", "p_n", "p_ret_yds", "bp_punts", "bp_in20", "bp_tb"]], on=["game_id", "team", "pid"], how="left")
    for c in ("p_n", "p_ret_yds", "bp_punts", "bp_in20", "bp_tb"):
        punt[c] = punt[c].fillna(0.0) if c in punt.columns else 0.0
    F["punt"] = punt
    # ---- returners
    rt = _read("retx", y, suffix)
    if rt is not None and len(rt):
        mk = rt.kret_epa.sum() / max(rt.kret_epa_n.sum(), 1)
        mp = rt.pret_epa.sum() / max(rt.pret_epa_n.sum(), 1)
        rt["ret_above"] = (rt.kret_epa - rt.kret_epa_n * mk) + (rt.pret_epa - rt.pret_epa_n * mp)
        rt["ret_n"] = rt.kret_epa_n + rt.pret_epa_n
        rt["returns"] = rt.kret + rt.pret                     # the box score's
        rt["pchances"] = rt.pbp_pret + rt.pfc                # both from the play-by-play: a rate within one source
        rt["one"] = _first(rt.reset_index(drop=True)) if len(rt) else 0.0
        rt = rt.reset_index(drop=True)
        rt["one"] = _first(rt)
        F["ret"] = rt
    else:
        F["ret"] = pd.DataFrame(columns=["season", "game_id", "team", "pid", "date", "week", "opp", "returns"])
    return F
