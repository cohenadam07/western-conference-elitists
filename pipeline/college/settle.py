"""
settle.py — how much sample each stat needs before it means something. §6E, step 8.

Basketball Savant's method (pipeline/basketball/settle_points.py) with the split moved inside the
season: for each player-season, his last 10 games are the small sample and everything before them
is a separate, larger record of the same man in the same year. The estimate of where he'll settle is

    settle = (n x + k prior) / (n + k)

and k is the value that lands the last-10 estimate closest to the first part, across four seasons
(2022-23 to 2025-26). That is fitted on predictions, out of sample. The prior is the qualified mean
at his position that season.

3P% gets a better prior than the mean. College 3P% repeats at about .29 year to year and attempt
rate at about .73, so a man's FT% and how often he shoots threes say more about his true shooting
than his own first 100 threes. fit_three_prior() regresses 3P% on FT% and 3PA rate, and that
prediction is the prior.

Output <home>/settle.json: {key: {k, pairs, rmse_raw, rmse_prior, kind}}.
"""
import json
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402
import adjust as AJ  # noqa: E402
import cbbd_client as CC  # noqa: E402

WINDOW = 10
MIN_FIRST = 0.5
QUAL = 400.0                 # possessions in the season to enter the fit
K_GRID = sorted({round(10 ** (i / 40), 1) for i in range(0, 161)})
# key -> (num, den, how the stat scales, what the sample is called)
STATS = {
    "ts": ("pts", "tsa", 100, "shooting chances"), "efg": ("efgm", "fga", 100, "FGA"), "fg2": ("fgm2", "fga2", 100, "2PA"), "fg3": ("fg3m", "fg3a", 100, "3PA"), "ft": ("ftm", "fta", 100, "FTA"),
    "tpar": ("fg3a", "fga", 100, "FGA"), "ftr": ("fta", "fga", 100, "FGA"), "usg": ("u", "Tu", 100, "possessions"), "ast_pct": ("ast", "astd", 100, "team makes"), "tov_pct": ("tov", "u", 100, "plays used"),
    "orb_pct": ("oreb", "orbd", 100, "chances"), "drb_pct": ("dreb", "drbd", 100, "chances"), "stl_pct": ("stl", "dposs", 100, "possessions"), "blk_pct": ("blk", "blkd", 100, "opp. 2PA"),
    "pts": ("pts", "poss", 1, "possessions"), "ast": ("ast", "poss", 1, "possessions"), "reb": ("reb", "poss", 1, "possessions"), "tov": ("tov", "poss", 1, "possessions"), "pf": ("pf", "dposs", 1, "possessions"),
    "rim_fg": ("rim_m", "rim_a", 100, "rim FGA"), "mid_fg": ("mid_m", "mid_a", 100, "mid FGA"), "pnt_fg": ("pnt_m", "pnt_a", 100, "paint FGA"), "c3_fg": ("c3_m", "c3_a", 100, "corner 3PA"), "ab3_fg": ("ab3_m", "ab3_a", 100, "above-break 3PA"),
    "rim_freq": ("rim_a", "n_fg", 100, "FGA"), "mid_freq": ("mid_a", "n_fg", 100, "FGA"),
}


def rows(season):
    """Per-player: the last-10 sums, the first-part sums, and his position."""
    df = A.frame(season)
    df = df[df.non_d1 == 0].sort_values(["eid", "date", "gid"])
    c = AJ.columns(df)
    c["Tu"] = c.Tfga + 0.475 * c.Tfta + c.Ttov
    c["n_fg"] = c.rim_a + c.pnt_a + c.mid_a + c.c3_a + c.ab3_a
    c["e"] = df.eid.values
    c["rank"] = df.groupby("eid").cumcount(ascending=False).values
    last = c[c["rank"] < WINDOW].groupby("e").sum()
    first = c[c["rank"] >= WINDOW].groupby("e").sum()
    pos = {e: v[1] for e, v in json.load(open(os.path.join(CC.HOME, "positions", f"{season}.json"))).items()}
    return last, first, pos


def rmse(est, y):
    return math.sqrt(float(np.mean((est - y) ** 2)))


def best_k(nw, vw, vf, prior):
    best = None
    for k in K_GRID:
        e = rmse((nw * vw + k * prior) / (nw + k), vf)
        if best is None or e < best[1]:
            best = (k, e)
    return best


def fit_three_prior(seasons):
    """fg3 ~ ft + tpar on qualified shooters, weighted by attempts."""
    X, y, w = [], [], []
    for s in seasons:
        r, _ = A.player_table(s)
        q = r[(r.n_fg3a >= 50) & (r.n_fta >= 20)]
        X += list(zip(q.ft / 100, q.tpar / 100))
        y += list(q.fg3 / 100)
        w += list(q.n_fg3a)
    X, y, w = np.array(X), np.array(y), np.array(w, float)
    B = np.c_[np.ones(len(X)), X]
    W = np.sqrt(w)[:, None]
    b = np.linalg.lstsq(B * W, y * W[:, 0], rcond=None)[0]
    return [float(v) for v in b], len(X)


def year_to_year(seasons, key):
    """Correlation of a stat with itself the next year, weighted sample floors."""
    t = {s: A.player_table(s)[0] for s in seasons}
    a, b = [], []
    for s0, s1 in zip(seasons, seasons[1:]):
        x = t[s0]
        y = t[s1]
        ids = x.index.intersection(y.index)
        ok = (x.n_fg3a.reindex(ids) >= 75) & (y.n_fg3a.reindex(ids) >= 75)
        a += list(x[key].reindex(ids)[ok])
        b += list(y[key].reindex(ids)[ok])
    return round(float(np.corrcoef(a, b)[0, 1]), 3), len(a)


def main(seasons):
    cache = {s: rows(s) for s in seasons}
    three, n3 = fit_three_prior(seasons)
    out = {}
    print(f"3P% prior = {three[0]:.3f} + {three[1]:.3f} FT + {three[2]:.3f} 3PAr ({n3} player-seasons)")
    print("year to year: 3P%", year_to_year(seasons, "fg3"), " 3PA rate", year_to_year(seasons, "tpar"))
    for key, (n, d, scale, unit) in STATS.items():
        nw, vw, vf, pri = [], [], [], []
        for s, (last, first, pos) in cache.items():
            ids = last.index.intersection(first.index)
            L, F = last.reindex(ids), first.reindex(ids)
            ok = (L[d] > 0) & (F[d] >= MIN_FIRST * (L[d] + F[d])) & ((L.poss + F.poss) >= QUAL)
            L, F = L[ok], F[ok]
            v1 = L[n] / L[d]
            v2 = F[n] / F[d]
            # the prior is what the first part can't see: the position's mean that season
            ps = pd.Series([pos.get(e, "Wing") for e in L.index], index=L.index)
            whole = (L[n] + F[n]) / (L[d] + F[d])
            if key == "fg3":
                ft = ((L.ftm + F.ftm) / (L.fta + F.fta).replace(0, np.nan)).fillna(0.7)
                tp = ((L.fg3a + F.fg3a) / (L.fga + F.fga).replace(0, np.nan)).fillna(0.3)
                prior = three[0] + three[1] * ft + three[2] * tp
            else:
                prior = ps.map(whole.groupby(ps).mean())
            nw += list(L[d]); vw += list(v1); vf += list(v2); pri += list(prior)
        nw, vw, vf, pri = map(lambda a: np.array(a, float), (nw, vw, vf, pri))
        if len(nw) < 200:
            print(f"{key:9} too few pairs ({len(nw)})")
            continue
        k, e = best_k(nw, vw, vf, pri)
        raw = rmse(vw, vf)
        out[key] = dict(k=k, pairs=len(nw), rmse_raw=round(raw * scale, 3), rmse_prior=round(e * scale, 3), unit=unit)
        print(f"{key:9} pairs {len(nw):6}  k {k:8.1f} {unit:18} rmse {raw * scale:7.3f} -> {e * scale:7.3f}")
    out["_three_prior"] = three
    json.dump(out, open(os.path.join(CC.HOME, "settle.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
