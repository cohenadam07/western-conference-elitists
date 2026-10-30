"""
pairings.py — do lineup pairings move a five-man unit's net rating beyond its parts? Tested the
way the lineup fit study did (claude/lineup-fit-study.md), not by out-of-sample R²:

  luck-adjusted unit net (5-man units, 25+ minutes, 2018-19 on)
      ~ Σ BPM + Σ usage + the count of each player type + the pairing,
  with team-season fixed effects (within transformation), possession weights, and standard
  errors clustered by team-season. Discovery on the even seasons (2018-19, 2020-21, 2022-23,
  2024-25), replication on the odd ones (2019-20, 2021-22, 2023-24, 2025-26).

Player types, per season, as percentiles among players with 500+ minutes (the study's definitions):
  spacer          3PA/75 at the 60th percentile or above and shrunk 3P% at the 50th or above
  stopper         matchup difficulty at the 80th or above, and not a big
  rim protector   block% at the 80th or above
  big             listed Big, or 6'10"+ with OREB% at the 70th or above, block% at the 60th or
                  above and 3PA rate at the 30th or below
  among bigs      hub = assist% at the 75th or above; stretch = 3PA rate at the 60th or above
                  and not a hub; "doesn't shoot" = a big who is not stretch
Pairings tested (the study's estimates in brackets):
  hub big + stretch big (+3.11, SE 1.01); rim protector + stretch big (+2.12);
  spacer + stopper (−1.53); two bigs where neither shoots (about −3.2)

    python3 pairings.py            # prints the table and writes out/bcs/pairings.json

build.py reads pairings.json: a pairing that replicates is added to the projection from parts
for seasons 2018-19 on, with its pooled coefficient. The rule (Adam's call, 2026-10-27, after the
first run): the effect keeps its sign in both halves and the pooled estimate clears p < .05. That
admits spacer + stopper (-1.20 then -1.62, pooled -1.43, SE 0.60) and leaves out the three that
flip sign or whose pooled estimate does not clear (hub + stretch, rim protector + stretch,
two bigs where neither shoots). The stricter rule, p < .05 in each half, admitted nothing.
"""
import gzip
import json
import os
import sys
from collections import defaultdict
from itertools import combinations

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import archive as A  # noqa: E402

OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
FIRST = 2018
POOL_MIN = 500          # the percentile pool
TYPE_MIN = 200          # a man with fewer minutes gets no type, and his units are left out
SHRINK_3PA = 100.0
PAIRS = ["hub_stretch", "rimprot_stretch", "spacer_stopper", "two_noshoot_bigs"]
STUDY = {"hub_stretch": (3.11, 1.01), "rimprot_stretch": (2.12, None), "spacer_stopper": (-1.53, None), "two_noshoot_bigs": (-3.2, None)}
TYPES = ["big", "spacer", "stopper", "rimprot", "hub", "stretch", "noshoot"]


def _cell(p, k):
    return ((p.get("m") or {}).get(k) or {}).get("season") or {}


def pct_rank(vals):
    """{key: percentile 0..100} by midrank."""
    items = [(k, v) for k, v in vals.items() if v is not None]
    s = sorted(v for _, v in items)
    n = len(s)
    out = {}
    import bisect
    for k, v in items:
        lo, hi = bisect.bisect_left(s, v), bisect.bisect_right(s, v)
        out[k] = 100.0 * (lo + 0.5 * (hi - lo)) / n if n else None
    return out


def player_types(season):
    """{pid: {"types": set, "usg": float, "bpm": float}} for the season's 500+ minute players."""
    raw = A._load("savant-data.json").get("data", {}).get(season, {}).get("players", []) or A._load("savant-current.json").get("data", {}).get(season, {}).get("players", [])
    rows = {}
    for p in raw:
        mn = _cell(p, "minshare").get("n") or 0
        if mn < TYPE_MIN or p.get("id") is None:
            continue
        gp = _cell(p, "avail").get("n") or 0
        poss = _cell(p, "pts").get("n") or 0
        tp3a_g = _cell(p, "tp3a").get("v")
        tp3 = _cell(p, "tp3").get("v")
        tpa = (tp3a_g or 0) * gp
        rows[int(p["id"])] = dict(
            pool=mn >= POOL_MIN, pos=p.get("pos"), height=_cell(p, "height").get("v"), tpa=tpa, tpm=(tp3 or 0) / 100.0 * tpa,
            tpa75=75.0 * tpa / poss if poss else None, tp3r=_cell(p, "tp3r").get("v"), mtch=_cell(p, "mtch").get("v"),
            blk=_cell(p, "blkpct").get("v"), oreb=_cell(p, "oreb").get("v"), ast=_cell(p, "ast").get("v"),
            usg=_cell(p, "usg").get("v"), bpm=_cell(p, "bpm").get("v"))
    if not rows:
        return {}
    lg3 = sum(r["tpm"] for r in rows.values()) / max(1.0, sum(r["tpa"] for r in rows.values()))
    for r in rows.values():
        r["shr3"] = (r["tpm"] + SHRINK_3PA * lg3) / (r["tpa"] + SHRINK_3PA)
    # percentiles are defined on the 500+ minute pool; a man under it is placed against that pool
    P = {}
    for k in ("tpa75", "shr3", "mtch", "blk", "oreb", "tp3r", "ast"):
        pool = sorted(r[k] for r in rows.values() if r["pool"] and r[k] is not None)
        P[k] = {}
        import bisect
        for pid, r in rows.items():
            if r[k] is None or not pool:
                continue
            lo, hi = bisect.bisect_left(pool, r[k]), bisect.bisect_right(pool, r[k])
            P[k][pid] = 100.0 * (lo + 0.5 * (hi - lo)) / len(pool)
    out = {}
    for pid, r in rows.items():
        g = lambda k: P[k].get(pid)  # noqa: E731
        big = r["pos"] == "Big" or ((r["height"] or 0) >= 82 and (g("oreb") or 0) >= 70 and (g("blk") or 0) >= 60 and (g("tp3r") if g("tp3r") is not None else 100) <= 30)
        t = set()
        if big:
            t.add("big")
            if (g("ast") or 0) >= 75:
                t.add("hub")
            elif (g("tp3r") or 0) >= 60:
                t.add("stretch")
            if "stretch" not in t:
                t.add("noshoot")
        if (g("tpa75") or 0) >= 60 and (g("shr3") or 0) >= 50:
            t.add("spacer")
        if not big and g("mtch") is not None and g("mtch") >= 80:
            t.add("stopper")
        if (g("blk") or 0) >= 80:
            t.add("rimprot")
        out[pid] = dict(types=t, usg=r["usg"], bpm=r["bpm"])
    return out


def unit_features(ids, types):
    """Counts of each type and the four pairing flags for one five-man unit, or None if a man is unknown."""
    tt = []
    for pid in ids:
        if pid not in types:
            return None
        tt.append(types[pid]["types"])
    counts = {k: sum(1 for t in tt if k in t) for k in TYPES}
    hubs = [i for i, t in enumerate(tt) if "hub" in t]
    stretch = [i for i, t in enumerate(tt) if "stretch" in t]
    rim = [i for i, t in enumerate(tt) if "rimprot" in t]
    spacers = [i for i, t in enumerate(tt) if "spacer" in t]
    stoppers = [i for i, t in enumerate(tt) if "stopper" in t]
    noshoot = [i for i, t in enumerate(tt) if "noshoot" in t]
    pairs = {
        "hub_stretch": int(any(h != s for h in hubs for s in stretch)),
        "rimprot_stretch": int(any(r != s for r in rim for s in stretch)),
        "spacer_stopper": int(any(a != b for a in spacers for b in stoppers)),
        "two_noshoot_bigs": int(len(noshoot) >= 2),
    }
    return dict(counts=counts, pairs=pairs, sum_usg=sum(types[p]["usg"] or 0 for p in ids),
                sum_bpm=sum(types[p]["bpm"] for p in ids) if all(types[p]["bpm"] is not None for p in ids) else None)


def load_units(season):
    p = os.path.join(PUBLIC, "bcs", "data", "units", f"{season}.json.gz")
    if not os.path.exists(p):
        return []
    d = json.load(gzip.open(p, "rt"))
    ci = {c: i for i, c in enumerate(d["columns"])}
    out = []
    for r in d["rows"]:
        if r[ci["n"]] != 5 or r[ci["min"]] < 25 or r[ci["adj"]] is None:
            continue
        ids = r[ci["ids"]]
        if any(not isinstance(x, int) for x in ids):
            continue
        out.append(dict(season=season, team=r[ci["team"]], ids=ids, poss=r[ci["poss"]], adj=r[ci["adj"]], min=r[ci["min"]]))
    return out


def fe_regression(rows, xcols):
    """Possession-weighted OLS with team-season fixed effects (within transformation) and
    cluster-robust standard errors by team-season. Returns {col: (coef, se, t)} and n."""
    groups = defaultdict(list)
    for i, r in enumerate(rows):
        groups[(r["season"], r["team"])].append(i)
    X = np.array([[r[c] for c in xcols] for r in rows], dtype=float)
    y = np.array([r["adj"] for r in rows], dtype=float)
    w = np.array([r["poss"] for r in rows], dtype=float)
    # weighted within transformation
    Xd, yd = X.copy(), y.copy()
    for idx in groups.values():
        idx = np.array(idx)
        ww = w[idx]
        Xd[idx] -= np.average(X[idx], axis=0, weights=ww)
        yd[idx] -= np.average(y[idx], weights=ww)
    sw = np.sqrt(w)
    Xw, yw = Xd * sw[:, None], yd * sw
    XtX = Xw.T @ Xw
    XtX_inv = np.linalg.pinv(XtX)
    beta = XtX_inv @ Xw.T @ yw
    e = yw - Xw @ beta
    # clustered sandwich
    meat = np.zeros_like(XtX)
    G = len(groups)
    for idx in groups.values():
        idx = np.array(idx)
        s = Xw[idx].T @ e[idx]
        meat += np.outer(s, s)
    n, k = Xw.shape
    adj = (G / (G - 1)) * ((n - 1) / (n - k - G))
    V = adj * XtX_inv @ meat @ XtX_inv
    se = np.sqrt(np.maximum(np.diag(V), 0))
    return {c: (float(beta[i]), float(se[i]), float(beta[i] / se[i]) if se[i] else None) for i, c in enumerate(xcols)}, n, G


def study(log=print):
    import datetime as dt
    today = dt.date.today()
    last = today.year if today.month >= 10 else today.year - 1
    seasons = [f"{y}-{str(y + 1)[2:]}" for y in range(FIRST, last + 1)]
    rows = []
    dropped = 0
    for s in seasons:
        types = player_types(s)
        for u in load_units(s):
            f = unit_features(u["ids"], types)
            if f is None or f["sum_bpm"] is None:
                dropped += 1
                continue
            rows.append(dict(u, sum_bpm=f["sum_bpm"], sum_usg=f["sum_usg"], **{f"n_{k}": v for k, v in f["counts"].items()}, **f["pairs"]))
    log(f"{len(rows)} five-man units with 25+ minutes, {seasons[0]} to {seasons[-1]} ({dropped} dropped: a man under {TYPE_MIN} minutes or without a BPM)")
    base = ["sum_bpm", "sum_usg", "n_big", "n_spacer", "n_stopper", "n_rimprot", "n_hub", "n_stretch"]
    even = [r for r in rows if int(r["season"][:4]) % 2 == 0]
    odd = [r for r in rows if int(r["season"][:4]) % 2 == 1]
    res = {}
    for name, sub in (("discovery_even", even), ("replication_odd", odd), ("pooled", rows)):
        res[name] = {}
        for pair in PAIRS:
            coefs, n, G = fe_regression(sub, base + [pair])
            c, se, t = coefs[pair]
            res[name][pair] = dict(coef=round(c, 3), se=round(se, 3), t=round(t, 2) if t is not None else None, n=n, clusters=G,
                                   share=round(sum(r[pair] for r in sub) / len(sub), 3), talent_slope=round(coefs["sum_bpm"][0], 3))
    # all four at once, pooled
    coefs, n, G = fe_regression(rows, base + PAIRS)
    res["pooled_joint"] = {p: dict(coef=round(coefs[p][0], 3), se=round(coefs[p][1], 3), t=round(coefs[p][2], 2) if coefs[p][2] else None) for p in PAIRS}
    res["pooled_joint"]["sum_bpm"] = dict(coef=round(coefs["sum_bpm"][0], 3), se=round(coefs["sum_bpm"][1], 3))
    replicated = {}
    for pair in PAIRS:
        d, r = res["discovery_even"][pair], res["replication_odd"][pair]
        p = res["pooled"][pair]
        same_sign = np.sign(d["coef"]) == np.sign(r["coef"])
        strict = d["t"] is not None and r["t"] is not None and abs(d["t"]) >= 1.96 and abs(r["t"]) >= 1.96 and same_sign
        ok = same_sign and p["t"] is not None and abs(p["t"]) >= 1.96
        replicated[pair] = dict(replicates=bool(ok), coef=p["coef"] if ok else None, same_sign=bool(same_sign), strict=bool(strict),
                                rule="same sign in both halves and pooled p < .05")
    log("")
    log(f"{'pairing':20s} {'study':>8s} {'discover (even)':>22s} {'replicate (odd)':>22s} {'pooled':>22s} {'share':>6s}")
    for pair in PAIRS:
        d, r, p = res["discovery_even"][pair], res["replication_odd"][pair], res["pooled"][pair]
        log(f"{pair:20s} {STUDY[pair][0]:+8.2f} {d['coef']:+8.2f} (SE {d['se']:.2f}, t {d['t']:+.1f}) {r['coef']:+8.2f} (SE {r['se']:.2f}, t {r['t']:+.1f}) {p['coef']:+8.2f} (SE {p['se']:.2f}, t {p['t']:+.1f}) {p['share']:6.3f} {'REPLICATES' if replicated[pair]['replicates'] else ''}")
    out = dict(seasons=seasons, n_units=len(rows), dropped=dropped, results=res, replicated=replicated, definitions=__doc__.split("Player types")[1].split("Pairings")[0].strip())
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "pairings.json"), "w"), indent=1)
    return out


if __name__ == "__main__":
    study()
