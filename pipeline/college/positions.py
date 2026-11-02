"""
positions.py — guard, wing, big. §6D, step 8, as Adam revised it on Nov 2, 2026.

ESPN lists G, F, C, and a third of its forwards are wings who never post up, so the listing alone
can't carry a position pool. But the box score alone can't either. BPM 2.0's estimate

    est = 2.130 + 8.668 TRB% - 2.486 STL% + 0.992 PF% - 3.536 AST% + 1.667 BLK%     (shares, 0-1)

called Cameron Boozer (6'8", 19% TRB) a wing because his 26% assist rate took 0.92 off it, and AJ
Dybantsa a guard. So each player gets a blend, each part in standard deviations:

    score = 0.5 box + 0.3 height + 0.2 listed

Low-minute players' box part leans on height, by possessions / (possessions + 300). Then one rule:

    a forward or center 6'8" or taller who rebounds like a center is a big

"Like a center" is measured: the median TRB% of qualified listed centers. No blend can fix a passing
big, because the estimate reads passing as guard play. Weights that lean further on height or the
listing fixed nobody else and cost Darryn Peterson; see the build notes.

The spec's team normalization (each team averaging 3.0) is gone: it lowered agreement with ESPN's
listings (80.1% vs 81.1%) and pushed bigs down on tall rosters.

Buckets: cut points solved so the shares match Basketball Savant's (`nba_shares`), rule included, so
"wing" means the same on both sites. position_engine.py is not reused: it learns from
Basketball-Reference's listed positions, which college has no equivalent of.
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
    r["trb"] = trb
    return r


WEIGHTS = {"box": 0.5, "height": 0.3, "listed": 0.2}
LISTED = {"G": -1.0, "PG": -1.3, "SG": -0.8, "SF": 0.2, "F": 0.6, "PF": 0.8, "C": 1.5}
BIG_MIN_HT = 80              # 6'8"
QUAL_POSS = 300


def frame(season):
    r = estimate(season)
    ident = json.load(open(os.path.join(CC.HOME, "identity", f"{season}.json")))
    r["ht"] = pd.to_numeric(r.index.map(lambda e: (ident.get(e) or {}).get("ht")), errors="coerce")
    r["listed"] = r.index.map(lambda e: (ident.get(e) or {}).get("listed"))
    r["name"] = r.index.map(lambda e: (ident.get(e) or {}).get("name"))
    r["season"] = season
    return r.rename_axis("eid").reset_index()


def score(r, p):
    """The blend, with p the scales the full build measured."""
    zb = (r.est_raw - p["box_mean"]) / p["box_sd"]
    zh = ((r.ht - p["ht_mean"]) / p["ht_sd"]).fillna(0.0)
    zl = r.listed.map(LISTED).fillna(0.0)
    w = r.poss / (r.poss + 300.0)
    return WEIGHTS["box"] * (w * zb + (1 - w) * zh) + WEIGHTS["height"] * zh + WEIGHTS["listed"] * zl


def size_rule(r, p):
    return (r.listed.isin(["F", "PF", "C"]) & (r.ht >= BIG_MIN_HT) & (r.trb >= p["trb_center"])).values


def label(r, p):
    s = score(r, p).values
    rule = size_rule(r, p)
    b = np.where(s <= p["cut_guard_wing"], "Guard", np.where(s >= p["cut_wing_big"], "Big", "Wing"))
    return s, np.where(rule, "Big", b)


def agreement(q):
    """The same test before and after: G is a guard, C is a big, F is anything but a guard."""
    return round(float(((q.listed == "G") & (q.bucket == "Guard") | (q.listed == "C") & (q.bucket == "Big") | (q.listed == "F") & (q.bucket != "Guard")).mean()), 4)


def buckets(seasons, log=print):
    os.makedirs(OUT, exist_ok=True)
    al = pd.concat([frame(s) for s in seasons], ignore_index=True)
    q = al[al.poss >= QUAL_POSS]
    p = {"box_mean": float(q.est_raw.mean()), "box_sd": float(q.est_raw.std()), "ht_mean": float(q.ht.mean()), "ht_sd": float(q.ht.std()),
         "trb_center": float(q[q.listed == "C"].trb.median()), "weights": WEIGHTS, "big_min_ht": BIG_MIN_HT}
    share = nba_shares()
    s = score(al, p).values
    rule = size_rule(al, p)
    m = (al.poss >= QUAL_POSS).values
    p["cut_guard_wing"] = float(np.quantile(s[m], share["Guard"]))
    # the rule's bigs count toward the share, so the cut solves for what's left
    want = share["Big"] * m.sum() - (rule & m).sum()
    rest = np.sort(s[m & ~rule])[::-1]
    p["cut_wing_big"] = float(rest[int(want)]) if 0 <= want < len(rest) else float(rest[0])
    s, b = label(al, p)
    al["score"], al["bucket"] = s, b
    q = al[al.poss >= QUAL_POSS]
    rep = dict(p, shares_target=share, shares=q.bucket.value_counts(normalize=True).round(4).to_dict(), agree=agreement(q), by_rule=int((rule & m).sum()),
               listed_vs_bucket=pd.crosstab(q.listed, q.bucket, normalize="index").round(3).to_dict("index"))
    prev = os.path.join(OUT, "report.json")
    if os.path.exists(prev):
        old = json.load(open(prev))
        rep["agree_before"] = old.get("agree_before", old.get("agree"))
    n = q[(q.season == seasons[-1]) & ~size_rule(q, p)].copy()
    n["margin"] = np.minimum((n.score - p["cut_guard_wing"]).abs(), (n.score - p["cut_wing_big"]).abs())
    rep["borderline"] = [[r.name, r.team, r.ht, r.listed, r.bucket, round(float(r.margin), 3), "Guard/Wing" if abs(r.score - p["cut_guard_wing"]) < abs(r.score - p["cut_wing_big"]) else "Wing/Big"] for r in n.sort_values("margin").head(20).itertuples()]
    for x in seasons:
        k = al[al.season == x]
        json.dump({v.eid: [round(float(v.score), 2), v.bucket] for v in k.itertuples()}, open(os.path.join(OUT, f"{x}.json"), "w"), separators=(",", ":"))
    json.dump(rep, open(prev, "w"), indent=1)
    log({k: v for k, v in rep.items() if k not in ("borderline", "listed_vs_bucket")})
    return al


def apply_cuts(season, log=print):
    """The nightly run: the scales, the rule and the cuts stay as the full build measured them."""
    p = json.load(open(os.path.join(OUT, "report.json")))
    r = frame(season)
    s, b = label(r, p)
    json.dump({e: [round(float(v), 2), x] for e, v, x in zip(r.eid, s, b)}, open(os.path.join(OUT, f"{season}.json"), "w"), separators=(",", ":"))
    log(f"{season}: positions for {len(r)} players")


if __name__ == "__main__":
    logf = lambda m: print(str(m)[:1500], flush=True)  # noqa: E731
    buckets(sys.argv[1:], log=logf)
