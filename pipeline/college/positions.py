"""
positions.py — guard, wing, big from what a man does. §6D, step 8.

ESPN lists G, F, C, and a third of its forwards are wings who never post up, so the listing can't
carry a position pool. BPM 2.0's position estimate reads it off the box score instead:

    est = 2.130 + 8.668 TRB% - 2.486 STL% + 0.992 PF% - 3.536 AST% + 1.667 BLK%     (shares, 0-1)

clamped to 1-5 and shifted so each team's minutes average 3.0. A team with five guards still has
someone playing the 4: that's the point of the normalization. Low-minute players are blended
toward what their height says, the listing's only reliable part: height -> est is fitted on
players with plenty of minutes, and the blend is possessions / (possessions + 300).

Buckets: cut points chosen so the bucket shares match Basketball Savant's (`nba_shares`), so "wing"
means the same thing on both sites. position_engine.py is not reused: it learns from
Basketball-Reference's listed positions, which college has no equivalent of.

The check: agreement with ESPN's listings, and a borderline list for the review.
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402
import cbbd_client as CC  # noqa: E402

OUT = os.path.join(CC.HOME, "positions")
BLEND_K = 300.0
SITE = os.path.join(HERE, "..", "..", "public")


def nba_shares():
    """Share of qualified Basketball Savant player-seasons in each bucket, last five seasons."""
    d = json.load(open(os.path.join(SITE, "savant-current.json")))
    pl = d["data"][d["seasons"][0]]["players"]
    from collections import Counter
    c = Counter(p.get("pos") for p in pl if p.get("pos") in ("Guard", "Wing", "Big") and (p.get("gp") or p.get("g") or 1))
    n = sum(c.values())
    return {k: v / n for k, v in c.items()}


def estimate(season):
    pg = A.frame(season)
    pg = pg[pg.non_d1 == 0]
    r, t = A.rates(A.sumby(pg, by=pg.eid.values)), A.sumby(pg, by=pg.eid.values)
    main = pg.groupby(["eid", "team"])["min"].sum().reset_index().sort_values("min", ascending=False).drop_duplicates("eid").set_index("eid")
    r["team"], r["tmin"] = main.team.reindex(r.index), main["min"].reindex(r.index)
    trb = 100 * (t.oreb + t.dreb) / (t.Toreb + t.Tdreb + t.Ooreb + t.Odreb).replace(0, np.nan)
    pf = t.pf / t.dposs.replace(0, np.nan)
    est = 2.130 + 8.668 * trb / 100 - 2.486 * r.stl_pct.fillna(0) / 100 + 0.992 * pf.fillna(0.2) - 3.536 * r.ast_pct.fillna(0) / 100 + 1.667 * r.blk_pct.fillna(0) / 100
    r["est_raw"] = est.clip(1, 5)
    return r


def buckets(seasons, log=print):
    os.makedirs(OUT, exist_ok=True)
    frames = {}
    for s in seasons:
        r = estimate(s)
        ident = json.load(open(os.path.join(CC.HOME, "identity", f"{s}.json")))
        r["ht"] = r.index.map(lambda e: (ident.get(e) or {}).get("ht"))
        r["listed"] = r.index.map(lambda e: (ident.get(e) or {}).get("listed"))
        r["name"] = r.index.map(lambda e: (ident.get(e) or {}).get("name"))
        frames[s] = r
    # height -> estimate, from players with a real sample
    big = pd.concat([f[(f.poss >= 800) & f.ht.notna()] for f in frames.values()])
    slope, icpt = np.polyfit(big.ht.astype(float), big.est_raw, 1)
    log(f"height fit: est = {icpt:.2f} + {slope:.3f} × inches on {len(big)} seasons")
    # the team's minute-weighted mean goes to 3.0, the same stretch for everyone
    all_rows = []
    for s, r in frames.items():
        r = r.copy()
        h = (icpt + slope * r.ht.astype(float)).fillna(r.est_raw)
        w = r.poss / (r.poss + BLEND_K)
        r["est"] = w * r.est_raw + (1 - w) * h
        tm = r.groupby("team").apply(lambda x: np.average(x.est, weights=x.tmin.clip(lower=1)), include_groups=False)
        r["est"] = (r.est + (3.0 - r.team.map(tm))).clip(1, 5)
        r["season"] = s
        all_rows.append(r)
    al = pd.concat(all_rows).rename_axis("eid").reset_index()
    share = nba_shares()
    log(f"Basketball Savant's shares: {share}")
    q = al[al.poss >= 300]
    lo = float(q.est.quantile(share["Guard"]))
    hi = float(q.est.quantile(1 - share["Big"]))
    al["bucket"] = np.where(al.est <= lo, "Guard", np.where(al.est >= hi, "Big", "Wing"))
    report = dict(cut_guard_wing=round(lo, 3), cut_wing_big=round(hi, 3), shares=share)
    q = al[al.poss >= 300]
    agree = pd.crosstab(q.listed, q.bucket, normalize="index").round(3)
    report["listed_vs_bucket"] = agree.to_dict("index")
    report["agree"] = round(float(((q.listed == "G") & (q.bucket == "Guard") | (q.listed == "C") & (q.bucket == "Big") | (q.listed == "F") & (q.bucket != "Guard")).mean()), 4)
    nb = q[(abs(q.est - lo) < 0.03) | (abs(q.est - hi) < 0.03)].sort_values("poss", ascending=False)
    report["borderline"] = [[r.name_, r.season, r.bucket, round(r.est, 2)] for r in nb.rename(columns={"name": "name_"}).head(40).itertuples()]
    for s in seasons:
        x = al[al.season == s]
        json.dump({v.eid: [round(float(v.est), 2), v.bucket] for v in x.itertuples()}, open(os.path.join(OUT, f"{s}.json"), "w"), separators=(",", ":"))
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
    log({k: v for k, v in report.items() if k != "borderline"})
    log(report["borderline"][:12])
    return al


if __name__ == "__main__":
    logf = lambda m: print(str(m)[:1500], flush=True)  # noqa: E731
    buckets(sys.argv[1:], log=logf)
