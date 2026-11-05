"""
adjust.py — opponent adjustment for players. §6C, step 8.

Two candidates, chosen by a test, as the spec asks. For each rate, written num / den per game:

  mult   a per-game multiplicative factor by opponent. Every team gets an allowed rate from a
         two-way fit (team offense × opponent defense / league), and a game's counts are scaled by
         league / allowed before they are summed. Simple, and it can be run on any split.
  reg    Engelmann's regression: y = player + opponent + home/away, weighted by den, ridge. The
         player's term is the adjusted value.

The test (`test`): transfers who changed levels, 2023-24 -> 2024-25 and 2024-25 -> 2025-26. Predict
the raw rate next year from this year's number and next year's schedule; a season-to-season drift
is taken out for all three methods alike. Lower error wins; the winner must beat raw numbers.

    python3 adjust.py test            prints the table and writes <home>/adjust-test.json
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import lsqr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402
import cbbd_client as CC  # noqa: E402
import season as SZ  # noqa: E402

# key -> (numerator, denominator) over aggregate.counts() columns
HIGH_MAJOR = {"2", "4", "7", "8", "23", "21"}    # ACC, Big East, Big Ten, Big 12, SEC, Pac-12 while it played
RATE = {
    "pts": ("pts", "poss"), "ts": ("pts", "tsa"), "efg": ("efgm", "fga"), "fg2": ("fgm2", "fga2"), "fg3": ("fg3m", "fg3a"),
    "ast_pct": ("ast", "astd"), "tov_pct": ("tov", "u"), "orb_pct": ("oreb", "orbd"), "drb_pct": ("dreb", "drbd"),
    "stl_pct": ("stl", "dposs"), "blk_pct": ("blk", "blkd"), "reb": ("reb", "poss"), "ast": ("ast", "poss"), "tov": ("tov", "poss"),
    "rim_fg": ("rim_m", "rim_a"), "mid_fg": ("mid_m", "mid_a"), "pnt_fg": ("pnt_m", "pnt_a"), "ftr": ("fta", "fga"),
    "stl": ("stl", "dposs"), "blk": ("blk", "dposs"),
}
MIN_TEST = 100


def columns(df, gt=True):
    """The per-game num and den of every rate, as a DataFrame aligned with df."""
    c = pd.DataFrame(A.counts(df, gt), index=df.index)
    c["tsa"] = 2 * (c.fga + 0.475 * c.fta)
    c["efgm"] = c.fgm + 0.5 * c.fg3m
    c["fgm2"], c["fga2"] = c.fgm - c.fg3m, c.fga - c.fg3a
    c["u"] = c.fga + 0.475 * c.fta + c.tov
    c["astd"] = (c.Tfgm - c.fgm).clip(lower=0)
    c["orbd"], c["drbd"] = c.Toreb + c.Odreb, c.Tdreb + c.Ooreb
    c["blkd"] = (c.Ofga - c.Ofg3a).clip(lower=0)
    c["reb"] = c.oreb + c.dreb
    return c


def team_fit(df, c, key, it=12):
    """Allowed rate per defense from a two-way multiplicative fit on team-game totals.
    -> {opponent: factor}, league / allowed, clipped so one thin team can't double a game."""
    n, d = RATE[key]
    g = pd.DataFrame({"t": df.team.values, "o": df.tm_opp.values, "n": c[n].values, "d": c[d].values}).groupby(["t", "o"], sort=False).sum().reset_index()
    g = g[g.d > 0]
    lg = g.n.sum() / g.d.sum()
    teams = pd.unique(np.r_[g.t.values, g.o.values])
    ix = {t: i for i, t in enumerate(teams)}
    ti, oi = g.t.map(ix).values, g.o.map(ix).values
    of, de = np.ones(len(teams)), np.ones(len(teams))
    nn, dd = g.n.values, g.d.values
    k = 20.0 / max(lg, 1e-6) * lg              # a light pull to average: about one game's worth of den
    pad = np.median(dd)
    for _ in range(it):
        num = np.bincount(ti, nn, len(teams)) + pad * lg
        den = np.bincount(ti, dd * lg * de[oi], len(teams)) + pad * lg
        of = num / den
        num = np.bincount(oi, nn, len(teams)) + pad * lg
        den = np.bincount(oi, dd * lg * of[ti], len(teams)) + pad * lg
        de = num / den
    return {t: float(np.clip(1.0 / de[ix[t]], 0.6, 1.5)) for t in teams}, lg


def mult_values(df, c, keys=None):
    """{key: Series by eid} adjusted, and the den-weighted schedule factor."""
    out, fac = {}, {}
    for key in keys or RATE:
        f, lg = team_fit(df, c, key)
        n, d = RATE[key]
        fo = df.tm_opp.map(f).fillna(1.0).values
        # a turnover against a team that forces many counts for less, the same arithmetic
        t = pd.DataFrame({"e": df.eid.values, "n": c[n].values * fo, "d": c[d].values, "raw": c[n].values, "fw": fo * c[d].values}).groupby("e").sum()
        with np.errstate(invalid="ignore", divide="ignore"):
            out[key] = t.n / t.d
            fac[key] = t.fw / t.d
    return out, fac


def reg_values(df, c, keys=None, damp=1.0):
    """Regression terms: {key: Series by eid} (league + player term), and opponent effects."""
    out, eff = {}, {}
    pl = pd.Categorical(df.eid.values)
    op = pd.Categorical(df.tm_opp.values)
    np_, no = len(pl.categories), len(op.categories)
    home = np.where(df.neutral.values, 0.0, np.where(df.tm_home.values.astype(bool), 1.0, -1.0))
    for key in keys or RATE:
        n, d = RATE[key]
        nn, dd = c[n].values, c[d].values
        m = dd > 0
        y = nn[m] / dd[m]
        w = np.sqrt(dd[m])
        lg = nn[m].sum() / dd[m].sum()
        rows = np.arange(m.sum())
        pc, oc = pl.codes[m].astype(np.int64), op.codes[m].astype(np.int64)    # small seasons get int8 codes
        X = sp.csr_matrix((np.r_[w, w, w * home[m]], (np.r_[rows, rows, rows], np.r_[pc, np_ + oc, np.full(m.sum(), np_ + no)])), shape=(m.sum(), np_ + no + 1))
        b = lsqr(X, w * (y - lg), damp=damp * float(np.sqrt(np.median(dd[m]))), iter_lim=120)[0]
        # a rate is a count over a count: the regression's term can dip below zero on a thin sample
        out[key] = pd.Series(np.maximum(lg + b[:np_], 0.0), index=pl.categories)
        eff[key] = pd.Series(b[np_:np_ + no], index=op.categories)
    return out, eff


def conf_of(season):
    ids = json.load(open(os.path.join(SZ.OUT, season, "ids.json")))
    return {k: v.get("conf") for k, v in ids["teams"].items()}


def main_team(df):
    t = df.groupby(["eid", "team"])["min"].sum().reset_index().sort_values("min", ascending=False).drop_duplicates("eid")
    return t.set_index("eid")["team"]


def level(team, conf):
    return "high" if conf.get(team) in HIGH_MAJOR else "other"


def test():
    keys = [k for k in RATE if k not in ("stl", "blk")]
    res = {k: {"raw": [], "mult": [], "reg": []} for k in keys}
    pairs_n = 0
    for a, b in (("2023-24", "2024-25"), ("2024-25", "2025-26")):
        d0, d1 = A.frame(a), A.frame(b)
        d0, d1 = d0[d0.non_d1 == 0], d1[d1.non_d1 == 0]
        c0, c1 = columns(d0), columns(d1)
        m0, _ = mult_values(d0, c0, keys)
        m1f, fac1 = mult_values(d1, c1, keys)
        r0, _ = reg_values(d0, c0, keys)
        _, eff1 = reg_values(d1, c1, keys)
        t0, t1 = main_team(d0), main_team(d1)
        cf0, cf1 = conf_of(a), conf_of(b)
        p0, p1 = d0.groupby("eid").apply(lambda x: 0, include_groups=False), None
        s0 = pd.DataFrame(A.counts(d0)).assign(e=d0.eid.values).groupby("e").sum()
        s1 = pd.DataFrame(A.counts(d1)).assign(e=d1.eid.values).groupby("e").sum()
        movers = [e for e in t0.index.intersection(t1.index) if t0[e] != t1[e] and level(t0[e], cf0) != level(t1[e], cf1) and s0.poss.get(e, 0) >= 300 and s1.poss.get(e, 0) >= 300]
        pairs_n += len(movers)
        for k in keys:
            n, dn = RATE[k]
            g0 = pd.DataFrame({"e": d0.eid.values, "n": c0[n].values, "d": c0[dn].values}).groupby("e").sum()
            g1 = pd.DataFrame({"e": d1.eid.values, "n": c1[n].values, "d": c1[dn].values}).groupby("e").sum()
            eo = pd.DataFrame({"e": d1.eid.values, "o": d1.tm_opp.map(eff1[k]).fillna(0).values * c1[dn].values, "d": c1[dn].values}).groupby("e").sum()
            for e in movers:
                if g0.d.get(e, 0) < 30 or g1.d.get(e, 0) < 30:
                    continue
                raw0 = g0.n[e] / g0.d[e]
                actual = g1.n[e] / g1.d[e]
                w = min(g0.d[e], g1.d[e])
                f = fac1[k].get(e, 1.0)
                res[k]["raw"].append((raw0, actual, w))
                res[k]["mult"].append((m0[k].get(e, raw0) / f if f else raw0, actual, w))
                res[k]["reg"].append((r0[k].get(e, raw0) + eo.o[e] / eo.d[e], actual, w))
    table, tot = {}, {"raw": 0.0, "mult": 0.0, "reg": 0.0}
    scored = [k for k in keys if len(res[k]["raw"]) >= MIN_TEST]
    for k in keys:
        row = {}
        for m in ("raw", "mult", "reg"):
            x = np.array(res[k][m])
            if not len(x):
                continue
            e = x[:, 0] - x[:, 1]
            e = e - np.average(e, weights=x[:, 2])       # the drift, for each method alike
            row[m] = float(np.sqrt(np.average(e * e, weights=x[:, 2])))
        row["n"] = len(res[k]["raw"])
        if k in scored:
            for m in ("raw", "mult", "reg"):
                tot[m] += row[m] / row["raw"] / len(scored)
        table[k] = {a_: round(v, 5) for a_, v in row.items()}
    winner = min(("mult", "reg"), key=lambda m: tot[m])
    # A stat is adjusted only where the winner beat raw on it; a stat too thin to test stays raw.
    use = sorted(k for k in scored if table[k][winner] < table[k]["raw"])
    out = dict(movers=pairs_n, relative_rmse={k: round(v, 4) for k, v in tot.items()}, by_stat=table, winner=winner, adjust=use, stay_raw=sorted(set(keys) - set(use)))
    json.dump(out, open(os.path.join(CC.HOME, "adjust-test.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "by_stat"}))
    for k, v in table.items():
        print(f"{k:9} n={v['n']:4} raw {v['raw']:.4f} mult {v['mult']:.4f} reg {v['reg']:.4f}")
    return out


if __name__ == "__main__":
    test()
