"""
aggregate.py — player-game rows -> every rate on the card, with one formula per stat.

    frame(season)        pg joined to its team, its opponent and the game: everything a rate needs
    rates(g, gt=True)    any group of those rows -> the raw values. Season, split, month, one game:
                         the same function, so a split cannot disagree with the season.

Scope. Division I opponents only: a game against a non-D1 team is in the game log, flagged, and in
no rate. Postseason games count (they are flagged in splits).

Three families of numbers, by what each needs:
  box      ESPN's box score. Exists for every game.
  pbp      zones, assisted share, transition, putbacks. Only games with pbp_ok.
  on-court on/off, luck-adjusted on/off. Only games with lineup_ok.

Seasons before 2022-23 are the box tier (config.BOX_TIER): box numbers only, from games whose player
lines add up to the final. Their play-by-play is too thin to use, so garbage time can't be removed.

`gt=False` takes garbage time out: the play-by-play's garbage-time counts come off the box line.

Team shares use the minutes form (Basketball-Reference's): his share of the team's five seats,
share = min / (team min / 5), so usage, rebound% and the rest mean the same thing in seasons with
and without lineups. Possessions are his on-floor count in lineup games and his share of the team's
estimate otherwise. Rates are stored per possession and scaled to per 70 or per 100 on the page.
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import season as SZ  # noqa: E402
from config import BOX_TIER  # noqa: E402

BOX = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf")
PBPK = ("rim_a", "rim_m", "pnt_a", "pnt_m", "mid_a", "mid_m", "c3_a", "c3_m", "ab3_a", "ab3_m", "rim_ast", "mid_ast", "three_ast", "ast_rim", "ast_three",
        "dunk_a", "dunk_m", "tr_a", "tr_m", "tr_pts", "pb_a", "pb_m", "uast_m", "dist", "loc_a")
ONK = ("poss", "pts", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov", "fga", "fgm")


def frame(season):
    d = os.path.join(SZ.OUT, season)
    pg = pd.read_pickle(os.path.join(d, "pg.pkl"))
    G = pd.read_pickle(os.path.join(d, "games.pkl")).set_index("gid")
    T = pd.read_pickle(os.path.join(d, "tg.pkl"))
    T["est"] = T.b_fga - T.b_oreb + T.b_tov + 0.475 * T.b_fta
    tt = T.set_index(["gid", "team"])
    keep = ["pts", "poss", "poss_g", "est", "opp", "home", "ot", "opp_pts"] + ["b_" + k for k in BOX]
    me = tt[keep].add_prefix("tm_")
    pg = pg.join(me, on=["gid", "team"])
    op = tt[["pts", "poss", "est"] + ["b_" + k for k in BOX]].add_prefix("op_")
    pg = pg.join(op, on=["gid", "tm_opp"])
    for c in ("date", "neutral", "confgame", "stype", "note", "pbp_ok", "lineup_ok", "non_d1"):
        pg[c] = pg.gid.map(G[c])
    pg = pg[pg["min"].gt(0) | pg.sec.gt(0)].copy()
    pg["box_ok"] = pg.gid.map(G.box_ok).fillna(False).astype(bool)
    if season in BOX_TIER:                 # box scores only, and only the ones that add up
        pg = pg[pg.box_ok].copy()
        pg["pbp_ok"] = False
        pg["lineup_ok"] = False
    for c in [x for x in pg.columns if x[:2] in ("c_", "g_", "t_", "o_") or x[:3] in ("tg_", "og_")]:
        pg[c] = pg[c].fillna(0.0)
    tm = 40.0 + 5.0 * pg.tm_ot.fillna(0)
    pg = pg.copy()
    pg["seat"] = (pg["min"] / tm).clip(upper=1.0)         # share of one of five seats' minutes
    return pg


def _bad(df):
    return ~df.pbp_ok.values


def counts(df, gt=True):
    """Column arrays for the rate formulas, garbage time in or out."""
    c = {}
    pb = df.pbp_ok.values
    for k in BOX:
        v = df["b_" + k].values.astype(float)
        if not gt:
            v = v - np.where(pb, df["g_" + k].values, 0.0)
        c[k] = np.maximum(v, 0.0)
    for k in PBPK:
        a = df["c_" + k].values.astype(float)
        if gt:
            a = a + df["g_" + k].values
        c[k] = np.where(pb, a, 0.0)
    gfrac = np.where(df.tm_poss.values > 0, (df.tm_poss_g.values / np.maximum(df.tm_poss.values, 1.0)), 0.0)
    seat = df.seat.values
    if not gt:
        seat = seat * (1 - np.where(pb, gfrac, 0.0))
    c["seat"] = seat
    # possessions: on the floor when we know, his share of the team's estimate when we don't
    lo = df.lineup_ok.values
    if gt:
        on = df.pos_o.values + df.pos_og.values
        ond = df.pos_d.values + df.pos_dg.values
    else:
        on, ond = df.pos_o.values, df.pos_d.values
    est = seat * df.tm_est.values
    c["poss"] = np.where(lo, on, est)
    c["dposs"] = np.where(lo, ond, seat * df.op_est.values)
    for k in BOX:
        c["T" + k] = seat * df["tm_b_" + k].values.astype(float)
        c["O" + k] = seat * df["op_b_" + k].values.astype(float)
    return c


def sumby(df, gt=True, by=None):
    """Sum the counts by a key -> DataFrame of totals (index = key), or one row for by=None."""
    c = counts(df, gt)
    t = pd.DataFrame(c, index=df.index)
    t["pbpg"] = df.pbp_ok.values.astype(float)
    t["gp"] = 1.0
    t["mins"] = df["min"].values
    t["gs"] = df.starter.values.astype(float)
    if by is None:
        return t.sum().to_frame().T
    return t.groupby(by if not isinstance(by, str) else df[by].values).sum()


def _r(a, b, scale=1.0):
    a, b = np.asarray(a, float), np.asarray(b, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(b > 0, scale * a / b, np.nan)


def rates(t):
    """Totals -> the card's raw values. Same names as config.py keys."""
    r = pd.DataFrame(index=t.index)
    r["gp"], r["gs"], r["mins"], r["poss"] = t.gp, t.gs, t.mins, t.poss
    r["mpg"] = _r(t.mins, t.gp)
    u = t.fga + 0.475 * t.fta + t.tov
    tu = t.Tfga + 0.475 * t.Tfta + t.Ttov
    r["pts"] = _r(t.pts, t.poss)
    r["ast"] = _r(t.ast, t.poss)
    r["tov"] = _r(t.tov, t.poss)
    r["reb"] = _r(t.oreb + t.dreb, t.poss)
    r["stl"] = _r(t.stl, t.dposs)
    r["blk"] = _r(t.blk, t.dposs)
    r["pf"] = _r(t.pf, t.dposs)
    r["fta70"] = _r(t.fta, t.poss)
    r["ts"] = _r(t.pts, 2 * (t.fga + 0.475 * t.fta), 100)
    r["efg"] = _r(t.fgm + 0.5 * t.fg3m, t.fga, 100)
    r["fg2"] = _r(t.fgm - t.fg3m, t.fga - t.fg3a, 100)
    r["fg3"] = _r(t.fg3m, t.fg3a, 100)
    r["ft"] = _r(t.ftm, t.fta, 100)
    r["tpar"] = _r(t.fg3a, t.fga, 100)
    r["ftr"] = _r(t.fta, t.fga, 100)
    r["usg"] = _r(u, tu, 100)
    r["ast_pct"] = _r(t.ast, t.Tfgm - t.fgm, 100)
    r["tov_pct"] = _r(t.tov, u, 100)
    r["ast_to"] = _r(t.ast, t.tov)
    r["orb_pct"] = _r(t.oreb, t.Toreb + t.Odreb, 100)
    r["drb_pct"] = _r(t.dreb, t.Tdreb + t.Ooreb, 100)
    r["stl_pct"] = _r(t.stl, t.dposs, 100)
    r["blk_pct"] = _r(t.blk, t.Ofga - t.Ofg3a, 100)
    fg = t.rim_a + t.pnt_a + t.mid_a + t.c3_a + t.ab3_a
    two = t.rim_a + t.pnt_a + t.mid_a
    r["rim_freq"] = _r(t.rim_a, fg, 100)
    r["pnt_freq"] = _r(t.pnt_a, fg, 100)
    r["mid_freq"] = _r(t.mid_a, fg, 100)
    r["c3_share"] = _r(t.c3_a, t.c3_a + t.ab3_a, 100)
    r["rim_fg"] = _r(t.rim_m, t.rim_a, 100)
    r["pnt_fg"] = _r(t.pnt_m, t.pnt_a, 100)
    r["mid_fg"] = _r(t.mid_m, t.mid_a, 100)
    r["c3_fg"] = _r(t.c3_m, t.c3_a, 100)
    r["ab3_fg"] = _r(t.ab3_m, t.ab3_a, 100)
    r["sdist"] = _r(t.dist, t.loc_a)
    r["dunk70"] = _r(t.dunk_m, t.poss)
    r["rim_ast"] = _r(t.rim_ast, t.rim_m, 100)
    r["three_ast"] = _r(t.three_ast, t.c3_m + t.ab3_m, 100)
    r["uast70"] = _r(t.uast_m, t.poss)
    r["tr_freq"] = _r(t.tr_a, fg, 100)
    r["tr_fg"] = _r(t.tr_m, t.tr_a, 100)
    r["pb70"] = _r(t.pb_a, t.poss)
    # samples: what each rate's denominator was, for settle points
    r["n_fga"], r["n_fg3a"], r["n_fta"] = t.fga, t.fg3a, t.fta
    r["n_u"] = u
    r["n_rim"], r["n_pnt"], r["n_mid"], r["n_c3"], r["n_ab3"] = t.rim_a, t.pnt_a, t.mid_a, t.c3_a, t.ab3_a
    r["n_fg"] = fg
    r["pbpg"] = t.pbpg
    return r


def player_table(season, gt=True, all_games=False):
    pg = frame(season)
    if not all_games:
        pg = pg[pg.non_d1 == 0]
    tot = sumby(pg, gt=gt, by=pg.eid.values)
    return rates(tot), tot


def crosscheck(season):
    """Step 6: ours against CBBD's player season stats, for qualified players."""
    y = int(season[:4]) + 1
    p = os.path.join(CC.HOME, "ref", f"pstats-{y}.json")
    if not os.path.exists(p):
        r, _ = CC.get("/stats/player/season", season=y)
        json.dump(r, open(p, "w"))
    rows = json.load(open(p))
    us, tot = player_table(season, all_games=True)     # CBBD's rows include non-D1 games
    pairs = {"ts": lambda x: 100 * x["trueShootingPct"] if (x.get("trueShootingPct") or 0) <= 1.5 else x["trueShootingPct"], "efg": lambda x: x["effectiveFieldGoalPct"], "usg": lambda x: x["usage"],
             "ast_pct": lambda x: (x.get("assistsPct")), "orb_share": lambda x: x["offensiveReboundPct"], "ftr": lambda x: x["freeThrowRate"],
             "fg3": lambda x: (x.get("threePointFieldGoals") or {}).get("pct"), "ft": lambda x: (x.get("freeThrows") or {}).get("pct"),
             "mpg": lambda x: x["minutes"] / max(1, x["games"]),
             "pts_g": lambda x: x["points"] / max(1, x["games"]), "reb_g": lambda x: ((x.get("rebounds") or {}).get("total") or 0) / max(1, x["games"]),
             "ast_g": lambda x: x["assists"] / max(1, x["games"])}
    ours = us.copy()
    ours["pts_g"] = tot.pts / tot.gp
    ours["orb_share"] = 100 * tot.oreb / (tot.oreb + tot.dreb).replace(0, np.nan)
    ours["reb_g"] = (tot.oreb + tot.dreb) / tot.gp
    ours["ast_g"] = tot.ast / tot.gp
    q = {str(x["athleteSourceId"]): x for x in rows if (x.get("minutes") or 0) >= 300}
    out = {}
    for k, f in pairs.items():
        a, b = [], []
        for e, x in q.items():
            if e in ours.index:
                try:
                    v = f(x)
                except (KeyError, TypeError):
                    continue
                w = ours.at[e, k]
                if v is not None and not (isinstance(w, float) and np.isnan(w)):
                    a.append(float(w))
                    b.append(float(v))
        if len(a) > 50:
            a, b = np.array(a), np.array(b)
            out[k] = dict(n=len(a), r=round(float(np.corrcoef(a, b)[0, 1]), 4), mean_ours=round(float(a.mean()), 2), mean_cbbd=round(float(b.mean()), 2))
    return out


if __name__ == "__main__":
    if sys.argv[1] == "cross":
        for s in sys.argv[2:]:
            print(s, json.dumps(crosscheck(s), indent=0).replace("\n", " "))
