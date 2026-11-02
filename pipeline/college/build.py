"""
build.py — the season tables -> public/cbb/, everything the page and the connector read.

    python3 build.py [--public ../../public] 2022-23 2023-24 2024-25 2025-26 2026-27

Every file is gzipped JSON, served as .json by a vercel.json rewrite, and all of it lives in
public/cbb/ so it can move as one folder.

    registry.json           stats, groups, seasons, settle points, the 3P% prior
    index.json              data date, what each season tracks, leaders and top teams for the front page
    search.json             every player and team
    s/<season>.json         the percentile table: every player, every stat, raw and adjusted, with
                            and without garbage time, and the samples. Percentiles are computed from
                            this by public/savant-cbb.js, for the page and the connector alike.
    teams/<season>.json     the all-teams table
    t/<season>/<team>.json  one team-season: roster, results, lineups, pairs, units, game logs, splits
    p/<shard>.json          career rows and comps, by the last two digits of the ESPN id
    games/<season>.json     the Data Room's games table

Never here: a birthdate (age only), a Torvik field, a CBBD row.
Deterministic: same inputs, same bytes (mtime=0, sorted keys, no timestamps but `generated`,
which is one value passed in, so a merge-mode refresh can be compared with a full build).
"""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import sys
import time
from collections import defaultdict
from itertools import combinations

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import adjust as AJ  # noqa: E402
import aggregate as A  # noqa: E402
import cbbd_client as CC  # noqa: E402
import config as C  # noqa: E402
import season as SZ  # noqa: E402

PUBLIC = os.path.join(HERE, "..", "..", "public")
COURT_MIN = 0.60            # share of D1 games with clean lineups a season needs to show any of it
# Possessions of pull toward the team, measured by measure.py on 2025-26: split a team's games odd and
# even, shrink one half, score it on the other. Fives 800 (903 units), pairs 1,800 (10,026). The NBA's
# are 843 and 1,221. Threes and fours were not measured; they sit between.
LUCK_K = {5: 800.0, 4: 1000.0, 3: 1300.0, 2: 1800.0}
LINEUP_MIN_POSS = {5: 30, 4: 40, 3: 50, 2: 60}
ON = ("poss", "pts", "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov", "stl", "blk", "ast")
IH = 6
IA = IH + len(ON)
NI = {k: i for i, k in enumerate(ON)}
HOME = CC.HOME


def rnd(v, d=2):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    f = round(f, d)
    return int(f) if f == int(f) else f


def jdump(path, doc):
    raw = json.dumps(doc, separators=(",", ":"), sort_keys=False, ensure_ascii=False).encode("utf8")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    path += ".gz"                       # served as .json by the vercel.json rewrite
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(gzip.compress(raw, 9, mtime=0))
    os.replace(tmp, path)
    return os.path.getsize(path)


def load_json(p, default=None):
    try:
        return json.load(open(p))
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------- team tables
def team_ratings(season):
    r = load_json(os.path.join(HOME, "ratings", f"{season}.json")) or {"teams": {}}
    return r


def net_table(season):
    return load_json(os.path.join(HOME, "ref", f"net-{season}.json")) or {}


def team_rows(season, G, T, ids, rat, mk, bpi, net):
    """The all-teams table, from box lines of D1 games."""
    d1 = G[G.non_d1 == 0].set_index("gid")
    T = T[T.gid.isin(d1.index)].copy()
    T["est"] = T.b_fga - T.b_oreb + T.b_tov + 0.475 * T.b_fta
    o = T[["gid", "team"] + [c for c in T.columns if c.startswith("b_")] + ["est"]].rename(columns=lambda c: "o" + c if c not in ("gid", "team") else c).rename(columns={"team": "opp"})
    t = T.merge(o, on=["gid", "opp"], how="left")
    names = ids["teams"]
    tb = rat["teams"]
    out = []
    S = pd.read_pickle(os.path.join(SZ.OUT, season, "shots.pkl"))
    S = S[S.gid.isin(set(G[(G.pbp_ok) & (G.non_d1 == 0)].gid))]
    zs = S.groupby(["team", "zone"]).size().unstack(fill_value=0)
    zo = S.groupby(["opp", "zone"]).size().unstack(fill_value=0)
    lg = rat.get("lg", 105.0)
    lt = rat.get("lt", 68.0)
    for team, g in t.groupby("team"):
        if team not in tb or len(g) < 1:
            continue
        v = tb[team]
        n = names.get(team, {})
        w = int((g.pts > g.opp_pts).sum())
        l_ = int((g.pts < g.opp_pts).sum())
        cw = g[g.gid.map(d1.confgame).astype(bool)]
        efg = (g.b_fgm.sum() + 0.5 * g.b_fg3m.sum()) / max(1, g.b_fga.sum())
        oefg = (g.ob_fgm.sum() + 0.5 * g.ob_fg3m.sum()) / max(1, g.ob_fga.sum())
        tov = g.b_tov.sum() / max(1, g.est.sum())
        otov = g.ob_tov.sum() / max(1, g.oest.sum())
        orb = g.b_oreb.sum() / max(1, g.b_oreb.sum() + g.ob_dreb.sum())
        drb = g.b_dreb.sum() / max(1, g.b_dreb.sum() + g.ob_oreb.sum())
        ftr = g.b_fta.sum() / max(1, g.b_fga.sum())
        oftr = g.ob_fta.sum() / max(1, g.ob_fga.sum())
        opp_net = float(np.mean([tb[x]["net"] for x in g.opp if x in tb])) if len(g) else None
        # luck: wins above what the game-by-game margin ratings expected, from the adjusted lines
        exp = 0.0
        for row in g.itertuples():
            oo = tb.get(row.opp)
            if oo is None:
                continue
            mar = (v["adjo"] * oo["adjd"] / lg - oo["adjo"] * v["adjd"] / lg) * (v["tempo"] * oo["tempo"] / lt) / 100
            site = 0.0 if d1.neutral.get(row.gid) else (3.3 if row.home else -3.3)
            exp += 0.5 * (1 + math.erf((mar + site) / (11.0 * math.sqrt(2))))
        z = zs.loc[team] if team in zs.index else {}
        zop = zo.loc[team] if team in zo.index else {}
        tot = sum(z.get(k, 0) for k in ("rim", "paint", "mid", "c3", "ab3"))
        tao = sum(zop.get(k, 0) for k in ("rim", "paint", "mid", "c3", "ab3"))
        out.append(dict(id=team, abbr=n.get("abbr"), name=n.get("loc") or n.get("name"), full=n.get("name"), conf=n.get("conf"), color=n.get("color"), alt=n.get("alt"), w=w, l=l_,
                        cw=int((cw.pts > cw.opp_pts).sum()), cl=int((cw.pts < cw.opp_pts).sum()), adjo=rnd(v["adjo"], 1), adjd=rnd(v["adjd"], 1), net=rnd(v["net"], 1), tempo=rnd(v["tempo"], 1),
                        market=rnd((mk or {}).get("teams", {}).get(team), 1), bpi=rnd((bpi.get(team) or {}).get("bpi"), 1), netrank=net.get(team),
                        efg=rnd(100 * efg, 1), oefg=rnd(100 * oefg, 1), tov=rnd(100 * tov, 1), otov=rnd(100 * otov, 1), orb=rnd(100 * orb, 1), drb=rnd(100 * drb, 1), ftr=rnd(100 * ftr, 1), oftr=rnd(100 * oftr, 1),
                        rim=rnd(100 * z.get("rim", 0) / tot, 1) if tot else None, mid=rnd(100 * (z.get("mid", 0) + z.get("paint", 0)) / tot, 1) if tot else None, three=rnd(100 * (z.get("c3", 0) + z.get("ab3", 0)) / tot, 1) if tot else None,
                        orim=rnd(100 * zop.get("rim", 0) / tao, 1) if tao else None, omid=rnd(100 * (zop.get("mid", 0) + zop.get("paint", 0)) / tao, 1) if tao else None, othree=rnd(100 * (zop.get("c3", 0) + zop.get("ab3", 0)) / tao, 1) if tao else None,
                        luck=rnd(w - exp, 1), sos=rnd(opp_net, 1), gp=len(g)))
    out.sort(key=lambda r: -(r["net"] or -99))
    for i, r in enumerate(out):
        r["rank"] = i + 1
    return out


# ---------------------------------------------------------------- on/off
def onoff(pg, lg3, lgft):
    """Per player, in clean-lineup D1 games, garbage time out."""
    d = pg[(pg.lineup_ok) & (pg.non_d1 == 0)]
    if not len(d):
        return pd.DataFrame(columns=["onoff", "onoff_luck", "on_poss"])
    a = d.groupby(["eid", "team"]).agg(p=("pos_o", "sum"), q=("pos_d", "sum"), pts=("t_pts", "sum"), opts=("o_pts", "sum"), o3a=("o_fg3a", "sum"), o3m=("o_fg3m", "sum"), ofta=("o_fta", "sum"), oftm=("o_ftm", "sum")).reset_index()
    # the team's totals in the same games
    teams = d.groupby(["gid", "team"]).agg(p=("tm_poss", "first"), pg_=("tm_poss_g", "first"), op=("op_poss", "first")).reset_index()
    return a, teams


def team_game_totals(season, gids):
    T = pd.read_pickle(os.path.join(SZ.OUT, season, "tg.pkl"))
    T = T[T.gid.isin(gids)]
    x = T.copy()
    x["np"] = x.p_poss - x.pg_poss
    x["npts"] = x.p_pts - x.pg_pts
    x["n3a"] = x.p_fg3a - x.pg_fg3a
    x["n3m"] = x.p_fg3m - x.pg_fg3m
    x["nfta"] = x.p_fta - x.pg_fta
    x["nftm"] = x.p_ftm - x.pg_ftm
    k = x[["gid", "team", "np", "npts", "n3a", "n3m", "nfta", "nftm"]]
    o = k.rename(columns={"team": "opp", "np": "onp", "npts": "onpts", "n3a": "on3a", "n3m": "on3m", "nfta": "onfta", "nftm": "onftm"})
    m = x[["gid", "team", "opp"]].merge(k, on=["gid", "team"]).merge(o, on=["gid", "opp"])
    return m.groupby("team")[["np", "npts", "onp", "onpts", "on3a", "on3m", "onfta", "onftm"]].sum()


def onoff_table(season, pg):
    d = pg[(pg.lineup_ok) & (pg.non_d1 == 0)]
    if not len(d):
        return pd.DataFrame(columns=["onoff", "onoff_luck", "on_poss"]), None, None
    tt = team_game_totals(season, set(d.gid))
    lg3 = float(d.c_fg3m.sum() / max(1, d.c_fg3a.sum()))
    lgft = float(d.c_ftm.sum() / max(1, d.c_fta.sum()))
    a = d.groupby(["eid", "team"]).agg(p=("pos_o", "sum"), q=("pos_d", "sum"), pts=("t_pts", "sum"), opts=("o_pts", "sum"), o3a=("o_fg3a", "sum"), o3m=("o_fg3m", "sum"), ofta=("o_fta", "sum"), oftm=("o_ftm", "sum")).reset_index()
    a = a.join(tt, on="team")
    def luck(o3a, o3m, ofta, oftm):
        return 3 * (o3m - o3a * lg3) + (oftm - ofta * lgft)
    on = 100 * (a.pts / a.p.replace(0, np.nan) - a.opts / a.q.replace(0, np.nan))
    fp, fq = (a.np - a.p), (a.onp - a.q)
    off = 100 * ((a.npts - a.pts) / fp.where(fp > 0) - (a.onpts - a.opts) / fq.where(fq > 0))
    a["onoff"] = on - off
    on_l = on + 100 * luck(a.o3a, a.o3m, a.ofta, a.oftm) / a.q.replace(0, np.nan)
    off_l = off + 100 * luck(a.on3a - a.o3a, a.on3m - a.o3m, a.onfta - a.ofta, a.onftm - a.oftm) / fq.where(fq > 0)
    a["onoff_luck"] = on_l - off_l
    a["on_poss"] = a.p
    a = a.sort_values("p", ascending=False).drop_duplicates("eid").set_index("eid")
    return a[["onoff", "onoff_luck", "on_poss"]], lg3, lgft


# ---------------------------------------------------------------- lineups
class Acc:
    __slots__ = ("sec", "p", "q", "pts", "opts", "o3a", "o3m", "oft", "oftm", "games")

    def __init__(self):
        self.sec = self.p = self.q = self.pts = self.opts = self.o3a = self.o3m = self.oft = self.oftm = 0.0
        self.games = set()

    def add(self, sec, s, a, b, gid):
        self.sec += sec
        self.p += s[a + NI["poss"]]
        self.q += s[b + NI["poss"]]
        self.pts += s[a + NI["pts"]]
        self.opts += s[b + NI["pts"]]
        self.o3a += s[b + NI["fg3a"]]
        self.o3m += s[b + NI["fg3m"]]
        self.oft += s[b + NI["fta"]]
        self.oftm += s[b + NI["ftm"]]
        self.games.add(gid)

    def rates(self, lg3, lgft, team_adj, k):
        if self.p <= 0 or self.q <= 0:
            return None
        ortg, drtg = 100 * self.pts / self.p, 100 * self.opts / self.q
        net = ortg - drtg
        luck = 3 * (self.o3m - self.o3a * lg3) + (self.oftm - self.oft * lgft)
        adj = net + 100 * luck / self.q
        est = (self.p * adj + k * team_adj) / (self.p + k)
        return dict(min=rnd(self.sec / 60, 1), poss=int(self.p), gp=len(self.games), ortg=rnd(ortg, 1), drtg=rnd(drtg, 1), net=rnd(net, 1), adj=rnd(adj, 1), est=rnd(est, 1))


def lineups(season, lg3, lgft):
    """{team: {"units": {2..5: rows}, "pairs": matrix rows, "fives": every five for With/Without}}.
    Same adjustments as the Lineups tab (teams_engine.py): luck, then a pull to the team's own net."""
    p = os.path.join(SZ.OUT, season, "stints.json.gz")
    if not os.path.exists(p):
        return {}
    with gzip.open(p, "rt") as fh:
        games = json.load(fh)
    by = defaultdict(lambda: {n: defaultdict(Acc) for n in (2, 3, 4, 5)})
    total = defaultdict(Acc)
    for gid, home, away, st in games:
        for s in st:
            if s[5]:
                continue                     # garbage time
            sec = s[1] - s[2]
            for team, five, a, b in ((home, s[3], IH, IA), (away, s[4], IA, IH)):
                if len(five) != 5:
                    continue
                total[team].add(sec, s, a, b, gid)
                u = tuple(sorted(five))
                by[team][5][u].add(sec, s, a, b, gid)
                for n in (2, 3, 4):
                    for c in combinations(u, n):
                        by[team][n][c].add(sec, s, a, b, gid)
    out = {}
    for team, d in by.items():
        tr = total[team].rates(lg3, lgft, 0.0, 0.0)
        ta = tr["adj"] if tr else 0.0
        res = {"team_adj": ta, "units": {}}
        for n in (2, 3, 4, 5):
            rows = []
            for key, acc in d[n].items():
                if acc.p < LINEUP_MIN_POSS[n]:
                    continue
                r = acc.rates(lg3, lgft, ta, LUCK_K[n])
                if r:
                    r["ids"] = list(key)
                    rows.append(r)
            rows.sort(key=lambda x: -x["poss"])
            res["units"][str(n)] = rows[:60 if n == 2 else 20]
        res["fives"] = [[list(k), round(a.sec), int(a.p), int(a.q), int(a.pts), int(a.opts), int(a.o3a), int(a.o3m), int(a.oft), int(a.oftm)]
                        for k, a in sorted(d[5].items(), key=lambda kv: (-kv[1].sec, kv[0]))]
        out[team] = res
    return out


# ---------------------------------------------------------------- the percentile table
RAW = [s.key for s in C.STATS if s.key in ("pts", "ts", "efg", "fg2", "fg3", "ft", "uast70", "rim_fg", "pnt_fg", "mid_fg", "c3_fg", "ab3_fg", "ast", "ast_pct", "ast_to", "tov_pct", "orb_pct", "drb_pct", "reb", "stl_pct", "blk_pct", "pf", "usg", "rim_freq", "mid_freq", "tpar", "ftr", "rim_ast", "three_ast", "tr_freq", "sdist")]
SAMPLES = {"poss": 0, "dposs": 0, "n_fga": 0, "n_fg3a": 0, "n_fta": 0, "n_u": 0, "n_rim": 0, "n_pnt": 0, "n_mid": 0, "n_c3": 0, "n_ab3": 0, "n_fg": 0}


def adjusted_tables(d, keys, gt, method="mult"):
    """The winner of adjust.py's transfer test: mult, or reg (the regression's player terms)."""
    c = AJ.columns(d, gt)
    vals, _ = (AJ.reg_values if method == "reg" else AJ.mult_values)(d, c, keys)
    return vals


def scale_of(key):
    return 1.0 if key in ("pts", "ast", "reb", "tov", "stl", "blk") else 100.0


def player_season(season, gen, public, teams_cache, log):
    pg = A.frame(season)
    d = pg[pg.non_d1 == 0]
    ids = load_json(os.path.join(SZ.OUT, season, "ids.json"))
    ident = load_json(os.path.join(HOME, "identity", f"{season}.json")) or {}
    pos = load_json(os.path.join(HOME, "positions", f"{season}.json")) or {}
    heads = load_json(os.path.join(HOME, "heads.json")) or {}
    rat = team_ratings(season)
    adj_test = load_json(os.path.join(HOME, "adjust-test.json")) or {"adjust": []}
    adj_keys = [k for k in adj_test.get("adjust", []) if k in AJ.RATE]
    tb_all, tot_all = A.rates(A.sumby(d, gt=True, by=d.eid.values)), A.sumby(d, gt=True, by=d.eid.values)
    tb_nog, tot_nog = A.rates(A.sumby(d, gt=False, by=d.eid.values)), A.sumby(d, gt=False, by=d.eid.values)
    main = d.groupby(["eid", "team"])["min"].sum().reset_index().sort_values(["min", "team"], ascending=[False, True]).drop_duplicates("eid").set_index("eid")
    tm_total = d.groupby(["gid", "team"]).agg(m=("tm_ot", "first")).reset_index()
    tm_total["cap"] = 40 + 5 * tm_total.m
    tm_cap = tm_total.groupby("team").cap.sum()
    idx = sorted(tb_nog.index, key=lambda e: (-float(tot_nog.mins.get(e, 0)), e))
    tb_nog, tb_all = tb_nog.reindex(idx), tb_all.reindex(idx)
    method = adj_test.get("winner", "mult")
    aj_n, aj_g = adjusted_tables(d, adj_keys, False, method), adjusted_tables(d, adj_keys, True, method)
    oo, lg3, lgft = onoff_table(season, pg)
    imp = (load_json(os.path.join(HOME, "impact", f"{season}.json")) or {}).get("players", {})
    if not tracked(season)["court"]:         # §3: a season that failed its gate shows no on/off or RAPM
        oo = oo.iloc[0:0] if len(oo) else oo
        imp = {e: {"bi": v.get("bi")} for e, v in imp.items()}
    xf = pd.DataFrame()
    try:
        import xfg as X
        if os.path.exists(X.MODEL):
            xf, _ = X.apply(season)
    except Exception as e:  # noqa
        log(f"xfg skipped for {season}: {e}")
    # sos and pace
    opp_net = d.tm_opp.map({t: v["net"] for t, v in rat["teams"].items()}).astype(float)
    sos = (opp_net * d["min"]).groupby(d.eid.values).sum() / d["min"].where(opp_net.notna(), 0).groupby(d.eid.values).sum().replace(0, np.nan)
    V = {}

    def col(tb, k):
        return [rnd(x, 4) for x in tb[k].values]

    for k in RAW:
        src_n = tb_nog.ast_to if k == "ast_to" else tb_nog[k]
        V[k] = {"r": [rnd(x, 4 if k in ("pts", "ast", "reb", "pf", "uast70") else 2) for x in src_n.values],
                "rg": [rnd(x, 4 if k in ("pts", "ast", "reb", "pf", "uast70") else 2) for x in tb_all[k].values]}
    for k in adj_keys:
        if k in V:
            s = scale_of(k)
            V[k]["a"] = [rnd(aj_n[k].get(e, np.nan) * s, 4 if s == 1 else 2) for e in idx]
            V[k]["ag"] = [rnd(aj_g[k].get(e, np.nan) * s, 4 if s == 1 else 2) for e in idx]
    V["min_share"] = {"r": [rnd(100 * float(tot_all.mins.get(e, 0)) / max(1.0, float(tm_cap.get(main.team.get(e), 40))), 1) for e in idx]}
    V["pace"] = {"r": [rnd(40 * float(tot_all.poss.get(e, 0)) / max(1.0, float(tot_all.mins.get(e, 0))), 1) for e in idx]}
    V["sos"] = {"r": [rnd(sos.get(e, np.nan), 1) for e in idx]}
    V["onoff"] = {"r": [rnd(oo.onoff.get(e, np.nan) if len(oo) else None, 1) for e in idx]}
    V["onoff_luck"] = {"r": [rnd(oo.onoff_luck.get(e, np.nan) if len(oo) else None, 1) for e in idx]}
    for k in ("rapm", "rapm_o", "rapm_d", "bi"):
        V[k] = {"r": [rnd((imp.get(e) or {}).get(k), 1) for e in idx]}
    V["shotmk"] = {"r": [rnd(100 * (xf.efg.get(e, np.nan) - xf.xefg.get(e, np.nan)), 1) if len(xf) else None for e in idx]}
    N = {k: [rnd(x, 0) for x in tb_nog[k].values] for k in ("poss", "n_fga", "n_fg3a", "n_fta", "n_u", "n_rim", "n_pnt", "n_mid", "n_c3", "n_ab3", "n_fg")}
    N["dposs"] = [rnd(tot_nog.dposs.get(e), 0) for e in idx]
    N["n_tsa"] = [rnd(2 * (float(tot_nog.fga.get(e, 0)) + 0.475 * float(tot_nog.fta.get(e, 0))), 0) for e in idx]
    N["n_fg2a"] = [rnd(float(tot_nog.fga.get(e, 0)) - float(tot_nog.fg3a.get(e, 0)), 0) for e in idx]
    N["n_astd"] = [rnd(float(tot_nog.Tfgm.get(e, 0)) - float(tot_nog.fgm.get(e, 0)), 0) for e in idx]
    N["n_orbd"] = [rnd(float(tot_nog.Toreb.get(e, 0)) + float(tot_nog.Odreb.get(e, 0)), 0) for e in idx]
    N["n_drbd"] = [rnd(float(tot_nog.Tdreb.get(e, 0)) + float(tot_nog.Ooreb.get(e, 0)), 0) for e in idx]
    N["n_blkd"] = [rnd(float(tot_nog.Ofga.get(e, 0)) - float(tot_nog.Ofg3a.get(e, 0)), 0) for e in idx]
    N["rapm_n"] = [(imp.get(e) or {}).get("rapm_n") for e in idx]
    N["on_poss"] = [rnd(oo.on_poss.get(e, np.nan) if len(oo) else None, 0) for e in idx]
    N["n_loc"] = [rnd(xf.n.get(e, np.nan) if len(xf) else None, 0) for e in idx]
    conf = {k: v.get("conf") for k, v in ids["teams"].items()}
    P = []
    for e in idx:
        i = ident.get(e) or {}
        t = main.team.get(e)
        ms = float(tot_all.mins.get(e, 0)) / max(1.0, float(tm_cap.get(t, 40)))
        P.append([e, i.get("name") or ids["names"].get(e), t, (pos.get(e) or [None, None])[1], i.get("cls"), i.get("age"), i.get("ht"), i.get("wt"),
                  int(tot_all.gp.get(e, 0)), int(tot_all.gs.get(e, 0)), rnd(tot_all.mins.get(e), 0), int(ms >= C.QUAL_MIN_SHARE), conf.get(t), int(heads.get(e, 0)), i.get("jersey"),
                  ", ".join(x for x in (i.get("city"), i.get("state") or (i.get("country") if i.get("country") != "USA" else None)) if x) or None, (i.get("rec") or {}).get("stars"), (i.get("rec") or {}).get("rank"), (i.get("rec") or {}).get("hs")])
    means = {}
    q = [i for i, p in enumerate(P) if p[11]]
    doc = {"season": season, "through": str(d.date.max()) if len(d) else None, "generated": gen, "cols": ["id", "name", "team", "pos", "cls", "age", "ht", "wt", "gp", "gs", "min", "qual", "conf", "head", "jersey", "hometown", "stars", "recruit_rank", "high_school"],
           "players": P, "values": V, "samples": N, "qualified": len(q), "lg3": lg3, "lgft": lgft}
    size = jdump(os.path.join(public, "cbb", "s", f"{season}.json"), doc)
    log(f"{season}: s/ {len(P)} players, {len(q)} qualified, {size / 1e6:.2f} MB")
    return dict(pg=pg, d=d, tot_all=tot_all, tb_all=tb_all, tb_nog=tb_nog, main=main, ident=ident, pos=pos, conf=conf, ids=ids, idx=idx, V=V, N=N, P=P, lg3=lg3, lgft=lgft, heads=heads)


# ---------------------------------------------------------------- team-season files
QUADS = {"home": (30, 75, 160), "neutral": (50, 100, 200), "away": (75, 135, 240)}


def quad_of(rank, site):
    if rank is None or (isinstance(rank, float) and math.isnan(rank)):
        return None
    a, b, c = QUADS[site]
    return 1 if rank <= a else 2 if rank <= b else 3 if rank <= c else 4


SPLIT_STATS = ("gp", "mins", "poss", "pts", "ts", "efg", "fg3", "ast", "reb", "tov_pct", "usg", "stl_pct", "blk_pct")


def split_rows(d, team_rank, net):
    """The card's splits for one player's rows: the same rates() as the season."""
    site = np.where(d.neutral.values, "Neutral", np.where(d.tm_home.astype(bool).values, "Home", "Road"))
    mon = pd.to_datetime(d.date).dt.strftime("%b").values
    conf = np.where(d.confgame.values.astype(bool), "Conference", "Non-conference")
    tourn = (d.stype.values == 3)
    top50 = d.tm_opp.map(lambda t: (team_rank.get(t) or 999) <= 50).values
    keys = [("Site", site), ("Conference", conf), ("Month", mon)]
    return keys, tourn, top50


def team_files(season, gen, ctx, public, log):
    pg, d, ids, ident, pos = ctx["pg"], ctx["d"], ctx["ids"], ctx["ident"], ctx["pos"]
    G = pd.read_pickle(os.path.join(SZ.OUT, season, "games.pkl")).set_index("gid")
    tm = load_json(os.path.join(public, "..", "public", "cbb", "x"), None)
    teams = load_json(os.path.join(HOME, "tmp-teams", f"{season}.json")) or {}
    rank = {t: r["rank"] for t, r in teams.items()}
    net = net_table(season)
    lu = lineups(season, ctx["lg3"] or 0.33, ctx["lgft"] or 0.72) if tracked(season)["court"] else {}
    names = ids["teams"]
    size = 0
    months = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]
    for team, g in pg.groupby("team"):
        if team not in teams:
            continue
        gd = g.sort_values(["date", "gid"])
        men = gd.groupby("eid")["min"].sum().sort_values(ascending=False)
        roster = list(men.index)
        ix = {e: i for i, e in enumerate(roster)}
        log_rows = {}
        for e, x in gd.groupby("eid"):
            rows = []
            for r in x.itertuples():
                gm = G.loc[r.gid]
                opp = r.tm_opp
                rows.append([r.gid, r.date[5:], opp, 1 if r.tm_home else 0, int(gm.neutral), int(r.tm_pts), int(r.tm_opp_pts), rnd(r.min, 0), int(r.b_pts), int(r.b_fgm), int(r.b_fga), int(r.b_fg3m), int(r.b_fg3a),
                             int(r.b_ftm), int(r.b_fta), int(r.b_oreb + r.b_dreb), int(r.b_ast), int(r.b_tov), int(r.b_stl), int(r.b_blk), int(r.b_pf), int(r.starter), int(gm.non_d1 > 0), int(gm.stype == 3)])
            log_rows[str(ix[e])] = rows
        # splits
        dd = d[d.team == team].copy()
        splits = {}
        if len(dd):
            dd["_site"] = np.where(dd.neutral.values, "Neutral", np.where(dd.tm_home.astype(bool).values, "Home", "Road"))
            dd["_conf"] = np.where(dd.confgame.values.astype(bool), "Conference", "Non-conference")
            dd["_mon"] = pd.to_datetime(dd.date).dt.strftime("%b").values
            dd["_top"] = dd.tm_opp.map(lambda t: "vs our top 50" if (rank.get(t) or 999) <= 50 else None)
            dd["_tourn"] = np.where(dd.stype.values == 3, "Postseason", None)

            def qd(r):
                s = "neutral" if r.neutral else ("home" if r.tm_home else "away")
                q = quad_of(net.get(r.tm_opp), s)
                return f"Quad {q}" if q else None

            dd["_q"] = [qd(r) for r in dd.itertuples()] if net else None
            for label, col in (("site", "_site"), ("conf", "_conf"), ("month", "_mon"), ("quad", "_q"), ("top", "_top"), ("post", "_tourn")):
                sub = dd[dd[col].notna()]
                if not len(sub):
                    continue
                keyed = sub.eid.astype(str) + "|" + sub[col].astype(str)
                rt = A.rates(A.sumby(sub, gt=True, by=keyed.values))
                for k, row in rt.iterrows():
                    e, name = k.split("|", 1)
                    splits.setdefault(str(ix[e]), {}).setdefault(label, []).append([name] + [rnd(row[s], 4 if s in ("pts", "ast", "reb") else 1) for s in SPLIT_STATS])
            nog = A.rates(A.sumby(dd, gt=False, by=dd.eid.astype(str).values))
            alls = A.rates(A.sumby(dd, gt=True, by=dd.eid.astype(str).values))
            for e in nog.index:
                splits.setdefault(str(ix[e]), {})["garbage"] = [["With garbage time"] + [rnd(alls.at[e, s], 4 if s in ("pts", "ast", "reb") else 1) for s in SPLIT_STATS],
                                                                  ["Without"] + [rnd(nog.at[e, s], 4 if s in ("pts", "ast", "reb") else 1) for s in SPLIT_STATS]]
            for v in splits.values():
                if "month" in v:
                    v["month"].sort(key=lambda r: months.index(r[0]) if r[0] in months else 9)
        # results
        res = []
        T_rows = gd.drop_duplicates("gid")
        for r in T_rows.itertuples():
            gm = G.loc[r.gid]
            res.append([r.gid, r.date, r.tm_opp, int(r.tm_home), int(gm.neutral), int(r.tm_pts), int(r.tm_opp_pts), int(gm.non_d1 > 0), int(gm.stype == 3), int(gm.ot), int(bool(gm.lineup_ok))])
        L = lu.get(team) or {}
        map_ids = lambda lst: [ix.get(e, -1) for e in lst]  # noqa: E731
        units = {}
        for n, rows in (L.get("units") or {}).items():
            units[n] = [dict(r, ids=map_ids(r["ids"])) for r in rows]
        fives = [[map_ids(f[0])] + f[1:] for f in (L.get("fives") or [])]
        doc = dict(season=season, team=team, name=names.get(team, {}).get("loc"), generated=gen, roster=[[e, (ident.get(e) or {}).get("name") or ids["names"].get(e), (pos.get(e) or [None, None])[1], (ident.get(e) or {}).get("cls"), rnd(men[e], 0)] for e in roster],
                   results=res, log=log_rows, splits=splits, units=units, fives=fives, team_adj=L.get("team_adj"))
        size += jdump(os.path.join(public, "cbb", "t", season, f"{team}.json"), doc)
    log(f"{season}: t/ {len(teams)} teams, {size / 1e6:.1f} MB")
    return size


# ---------------------------------------------------------------- careers and comps
CAREER_STATS = ("pts", "ts", "fg3", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "stl_pct", "blk_pct", "usg", "rapm", "bi")


def pct(values, v, lower=False):
    if v is None:
        return None
    a = np.array([x for x in values if x is not None], float)
    if not len(a):
        return None
    less = (a < v).sum()
    eq = (a == v).sum()
    p = 100 * (less + 0.5 * eq) / len(a)
    return int(round(100 - p if lower else p))


def careers(contexts, public, log):
    """Each man's seasons with percentiles vs D1 at his position (raw), and his nearest comps."""
    rows = defaultdict(list)
    bio = {}
    for season, ctx in contexts.items():
        P, V = ctx["P"], ctx["V"]
        for pos in ("Guard", "Wing", "Big"):
            q = [i for i, p in enumerate(P) if p[11] and p[3] == pos]
            ref = {k: [(V[k].get("a") or V[k]["r"])[i] for i in q] for k in CAREER_STATS if k in V}
            for i, p in enumerate(P):
                if p[3] != pos:
                    continue
                r = {"s": season, "t": p[2], "p": p[3], "c": p[4], "g": p[8], "m": p[10], "q": p[11], "v": {}}
                for k in CAREER_STATS:
                    if k not in V:
                        continue
                    arr = V[k].get("a") or V[k]["r"]
                    v = arr[i]
                    st = C.BY_KEY[k]
                    r["v"][k] = [v, pct(ref[k], v, st.lower) if len(ref[k]) >= C.MIN_POOL else None]
                rows[p[0]].append(r)
                bio[p[0]] = [p[1], p[6], p[7]]
    comps = {}
    feats = ("pts", "ts", "fg3", "tpar", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "stl_pct", "blk_pct", "usg", "rim_freq")
    allrows = []
    for season, ctx in contexts.items():
        P, V = ctx["P"], ctx["V"]
        for i, p in enumerate(P):
            if p[11] and p[5]:
                allrows.append([p[0], season, p[3], p[5], p[1], p[2]] + [(V[k].get("r") or [None] * len(P))[i] for k in feats])
    df = pd.DataFrame(allrows, columns=["e", "s", "pos", "age", "name", "team"] + list(feats))
    for k in feats:
        c = pd.to_numeric(df[k], errors="coerce")
        m, sd = c.mean(), c.std()
        df[k] = ((c - m) / sd).fillna(0.0)
    X = df[list(feats)].values
    for pos in ("Guard", "Wing", "Big"):
        ii = np.where(df.pos.values == pos)[0]
        for a in range(0, len(ii), 500):
            batch = ii[a:a + 500]
            D = ((X[batch, None, :] - X[ii][None, :, :]) ** 2).sum(axis=2)
            for bi_, i in enumerate(batch):
                age = df.age.values[i]
                ok = (np.abs(df.age.values[ii] - age) <= 1.0) & (df.e.values[ii] != df.e.values[i])
                dist = np.where(ok, D[bi_], np.inf)
                top = np.argsort(dist, kind="stable")[:5]
                comps[(df.e.values[i], df.s.values[i])] = [[df.e.values[ii][j], df.name.values[ii][j], df.s.values[ii][j], df.team.values[ii][j], rnd(1 / (1 + math.sqrt(dist[j])), 2)] for j in top if np.isfinite(dist[j])]
    shards = defaultdict(dict)
    for e, r in rows.items():
        r.sort(key=lambda x: x["s"])
        for x in r:
            c = comps.get((e, x["s"]))
            if c:
                x["cmp"] = c
        shards[e[-2:]][e] = {"b": bio[e], "r": r}
    n = 0
    for k, v in shards.items():
        n += jdump(os.path.join(public, "cbb", "p", f"{k}.json"), v)
    log(f"careers: {len(rows)} players, {len(shards)} shards, {n / 1e6:.1f} MB")
    return len(rows)


# ---------------------------------------------------------------- index files
def tracked(season):
    g = load_json(os.path.join(SZ.OUT, season, "gates.json")) or {}
    # §3: a season keeps a section only if its gate passed
    shots = (g.get("coord_rate") or 0) >= 0.85
    court = (g.get("lineup_ok_rate_of_d1") or 0) >= COURT_MIN
    return dict(shots=shots, court=court, coord_rate=g.get("coord_rate"), lineup_rate=g.get("lineup_ok_rate_of_d1"), games=g.get("d1_games"))


def registry(public, gen):
    settle = load_json(os.path.join(HOME, "settle.json")) or {}
    stats = []
    for s in C.STATS:
        k = settle.get(s.settle) or {}
        stats.append(dict(key=s.key, label=s.label, group=s.group, kind=s.kind, unit=s.unit, lower=s.lower, sample=s.n, start=s.start, family=s.family,
                          k=k.get("k"), sample_unit=k.get("unit"), what=s.what, formula=s.formula, source=s.source, note=s.sample))
    adj = load_json(os.path.join(HOME, "adjust-test.json")) or {}
    return jdump(os.path.join(public, "cbb", "registry.json"), dict(version=C.VERSION, generated=gen, groups=C.GROUPS, stats=stats, adjusted=adj.get("adjust", []), three_prior=settle.get("_three_prior"),
                                                                     rapm_early=C.RAPM_EARLY, min_pool=C.MIN_POOL, qual_min_share=C.QUAL_MIN_SHARE, per=[70, 100], high_major=sorted(AJ.HIGH_MAJOR), rapm_min=500))


def lite(public, season):
    """A finished season as the files already published have it."""
    d = gzip.decompress(open(os.path.join(public, "cbb", "s", f"{season}.json.gz"), "rb").read())
    return json.loads(d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=PUBLIC)
    ap.add_argument("--generated", default=None)
    ap.add_argument("--merge", default=None, help="rebuild only this season; the rest come from public/cbb")
    ap.add_argument("seasons", nargs="+")
    a = ap.parse_args()
    log = lambda m: print(time.strftime("%H:%M:%S"), m, flush=True)  # noqa: E731
    gen = a.generated or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    public = os.path.abspath(a.public)
    registry(public, gen)
    tr = {}
    os.makedirs(os.path.join(HOME, "tmp-teams"), exist_ok=True)
    for s in a.seasons:
        tr[s] = tracked(s)
        if a.merge and s != a.merge:
            continue
        G = pd.read_pickle(os.path.join(SZ.OUT, s, "games.pkl"))
        T = pd.read_pickle(os.path.join(SZ.OUT, s, "tg.pkl"))
        ids = load_json(os.path.join(SZ.OUT, s, "ids.json"))
        rat = team_ratings(s)
        mk = load_json(os.path.join(HOME, "ratings", f"market-{s}.json"))
        bpi = load_json(os.path.join(HOME, "bpi", f"table-{s}.json")) or {}
        if not rat.get("teams"):
            log(f"{s}: no ratings yet; skipped")
            continue
        rows = team_rows(s, G, T, ids, rat, mk, bpi, net_table(s))
        json.dump({r["id"]: r for r in rows}, open(os.path.join(HOME, "tmp-teams", f"{s}.json"), "w"))
        jdump(os.path.join(public, "cbb", "teams", f"{s}.json"), dict(season=s, generated=gen, teams=rows, lg=rat.get("lg"), tempo=rat.get("lt"), market_home=(mk or {}).get("home")))
        ctx = player_season(s, gen, public, None, log)
        team_files(s, gen, ctx, public, log)
        games = []
        for r in G.itertuples():
            games.append([r.gid, r.date, r.home, r.away, r.hs, r.as_, int(r.neutral), int(r.confgame), int(r.stype == 3), int(r.non_d1 > 0), int(r.ot), rnd(r.spread, 1), rnd(r.total, 1), int(r.pbp_ok), int(r.lineup_ok)])
        jdump(os.path.join(public, "cbb", "games", f"{s}.json"), dict(season=s, cols=["gid", "date", "home", "away", "home_pts", "away_pts", "neutral", "conf_game", "postseason", "non_d1", "ot", "home_spread", "total", "pbp_ok", "lineup_ok"], rows=games))
    docs = {}
    for s in a.seasons:
        p = os.path.join(public, "cbb", "s", f"{s}.json.gz")
        if os.path.exists(p):
            d = lite(public, s)
            docs[s] = {"P": d["players"], "V": d["values"], "through": d["through"]}
    careers(docs, public, log)
    seen, tn = {}, {}
    for s, c in docs.items():
        for p in c["P"]:
            seen[p[0]] = [p[0], p[1], p[2], s, p[3], int(p[11])]
        tp = os.path.join(public, "cbb", "teams", f"{s}.json.gz")
        for r in json.loads(gzip.decompress(open(tp, "rb").read()))["teams"]:
            tn[r["id"]] = [r["id"], r["name"], r["abbr"], r["conf"], s, r["color"]]
    jdump(os.path.join(public, "cbb", "search.json"), dict(players=sorted(seen.values(), key=lambda x: (x[1] or "", x[0])), teams=sorted(tn.values(), key=lambda x: (x[1] or "", x[0]))))
    jdump(os.path.join(public, "cbb", "links.json"), links(seen, tn, public))
    newest = list(docs)
    idx = dict(version=C.VERSION, generated=gen, current=newest[-1], seasons=[dict(season=s, through=docs[s]["through"], players=len(docs[s]["P"]), qualified=sum(1 for p in docs[s]["P"] if p[11]), **tr[s]) for s in newest], default_season=latest_with_data(newest, docs))
    jdump(os.path.join(public, "cbb", "index.json"), idx)
    log("index written")


def links(seen, tn, public):
    """Cards link to Draft Savant and Basketball Savant where the player exists there. Name and
    school must both agree, so a namesake never gets the link."""
    norm = lambda x: "".join(c for c in (x or "").lower() if c.isalpha())  # noqa: E731
    out = {"draft": {}, "nba": {}, "by_draft": {}}
    p = os.path.join(public, "data.json")
    d = load_json(p) or {"players": []}
    by = defaultdict(list)
    for e, r in seen.items():
        by[norm(r[1])].append(r)
    for x in d["players"]:
        for r in by.get(norm(x.get("name")), ()):
            sc = norm(tn.get(r[2], [None, ""])[1])
            co = norm(x.get("college"))
            if sc and (sc in co or co in sc):
                out["draft"][r[0]] = x["id"]
                out["by_draft"][x["id"]] = r[0]
    ids = load_json(os.path.join(HERE, "..", "basketball", "seed", "espn_ids.json")) or {}
    for e in seen:
        if e in ids:
            out["nba"][e] = ids[e]
    return out


def latest_with_data(newest, contexts):
    """The season the page opens on: the newest whose pools are real. Early November is a handful
    of games; the page opens last season until the current one has enough qualified players."""
    for s in reversed(newest):
        if sum(1 for p in contexts[s]["P"] if p[11]) >= 800:
            return s
    return newest[-1]


if __name__ == "__main__":
    main()
