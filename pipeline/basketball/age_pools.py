"""
age_pools.py — the same-age pools: public/savant-ext/age/.

    python3 age_pools.py [--public ../../public]

The card's Same age pool is every qualified player-season at his whole-year age on February 1,
1996-97 on. A percentile needs the pool's sorted values, and those live in 30 season files, 143 of
the card's stats in another 30, so the page could not build them without downloading all of it.
This writes them once, per age, for the page and the connector to read the same numbers:

    age/index.json   {min_age, min_age_pos, min_stat, first, last, ages: {age: {n, Guard, Wing, Big}}}
    age/<age>.json   {age, n, keys, v: {key: [guards, wings, bigs]}}, each list sorted

Finished seasons only. A season in progress is a few games of noise, and at the ends of the age
range a handful of those would be a real share of the pool. So nothing here changes after a slate;
build_ext.py rebuilds it when a season is added.

Minimums, on what a rank is worth: at n players one place is 100/n percentile points. 30 for
Same age keeps a place under about 3 points, which leaves ages 19 to 38. Same age + position asks
for 50, 2 points a place, because it is the finer claim; that hides ages 19 and 36 on, and bigs at
35. The page and the connector both read these two numbers from index.json.
"""
import argparse
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))

import ext_config as XC  # noqa: E402
import savant_config as C  # noqa: E402

FIRST = "1996-97"
MIN_AGE = 30
MIN_AGE_POS = 50
MIN_STAT = 20      # a stat tracked for only part of the history can run thin inside a good pool
POS = ["Guard", "Wing", "Big"]
SINCE = {m["key"]: C.TIER_SINCE[m.get("tier", 1)] for m in C.METRICS}


def age_of(p, season):
    if p.get("birthdate"):
        return C.whole_age(p["birthdate"], season)
    return int(p["age"]) if isinstance(p.get("age"), (int, float)) and p["age"] else None


def _ok(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def build(public, log=print):
    archive = json.load(open(os.path.join(public, "savant-data.json")))["data"]
    cur = os.path.join(public, "savant-current.json")
    live = set(json.load(open(cur)).get("seasons", [])) if os.path.exists(cur) else set()
    seasons = sorted(s for s in archive if s >= FIRST and s not in live)
    pools = {}
    for season in seasons:
        ext = None
        f = os.path.join(public, "savant-ext", "s", f"{season}.json")
        if os.path.exists(f):
            ext = json.load(open(f))
        for p in archive[season]["players"]:
            age = age_of(p, season)
            if not p.get("qualified") or age is None or p.get("pos") not in POS:
                continue
            b = pools.setdefault(age, {"n": 0, "pos": dict.fromkeys(POS, 0), "v": {}})
            b["n"] += 1
            b["pos"][p["pos"]] += 1
            ix = POS.index(p["pos"])
            for k, cell in (p.get("m") or {}).items():
                v = ((cell or {}).get("season") or {}).get("v")
                if _ok(v) and season >= SINCE.get(k, FIRST):
                    b["v"].setdefault(k, [[], [], []])[ix].append(v)
            row = ((ext or {}).get("players", {}).get(str(p["id"])) or {}).get("season")
            if row:
                for k, c in zip(ext["keys"], row):
                    if c is not None and _ok(c[0]):
                        b["v"].setdefault(k, [[], [], []])[ix].append(c[0])

    out = os.path.join(public, "savant-ext", "age")
    os.makedirs(out, exist_ok=True)
    for fn in os.listdir(out):
        os.remove(os.path.join(out, fn))
    index = dict(schema=1, first=seasons[0], last=seasons[-1], min_age=MIN_AGE, min_age_pos=MIN_AGE_POS,
                 min_stat=MIN_STAT,
                 keys=sorted({k for b in pools.values() for k in b["v"]}), ages={})
    for age in sorted(pools):
        b = pools[age]
        for lists in b["v"].values():
            for x in lists:
                x.sort()
        index["ages"][str(age)] = dict(n=b["n"], **b["pos"])
        with open(os.path.join(out, f"{age}.json"), "w") as fh:
            json.dump(dict(schema=1, age=age, n=b["n"], keys=sorted(b["v"]), v=b["v"]), fh, separators=(",", ":"))
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))
    log(f"  same-age pools: ages {min(pools)}-{max(pools)}, {sum(b['n'] for b in pools.values()):,} player-seasons, "
        f"{len(index['keys'])} stats, {seasons[0]} to {seasons[-1]}")
    return index


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    build(ap.parse_args().public)
