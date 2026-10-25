"""
compare_current.py — check refresh_current.py against the archive, the way Football Savant's
refresh was checked: rebuild a finished season through the new path and compare it, value by
value, with what the full pipeline published.

    python compare_current.py [out/current.json] [path/to/savant-data.json]

Reports: players only on one side, top-level fields missing on one side, metric keys missing
on one side, and value differences per metric (count, and the largest). Upstream revisions
since July (stat corrections, tracking re-runs) show up as small differences on a handful of
players; a pipeline gap shows up as a whole metric missing or every value off.
"""
import json, math, os, sys
from collections import Counter, defaultdict

cur_path = sys.argv[1] if len(sys.argv) > 1 else "out/current.json"
arc_path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser(
    "~/western-conference-elitists/public/savant-data.json")
cur = json.load(open(cur_path))
arc = json.load(open(arc_path))
season = cur["seasons"][0]
A = {p["id"]: p for p in arc["data"][season]["players"]}
B = {p["id"]: p for p in cur["data"][season]["players"]}
print(f"{season}: archive {len(A)} players (generated {arc['generated'][:10]}), "
      f"refresh {len(B)} players (generated {cur['generated'][:10]})")
print(f"  only in archive: {len(set(A) - set(B))}  only in refresh: {len(set(B) - set(A))}")
for pid in list(set(A) - set(B))[:5]:
    print(f"    archive only: {A[pid]['name']} {A[pid].get('team')}")
for pid in list(set(B) - set(A))[:5]:
    print(f"    refresh only: {B[pid]['name']} {B[pid].get('team')}")

both = set(A) & set(B)
fa, fb = Counter(), Counter()
for pid in both:
    for k in A[pid]:
        if k not in B[pid]: fa[k] += 1
    for k in B[pid]:
        if k not in A[pid]: fb[k] += 1
print(f"  top-level fields missing from the refresh: {dict(fa) or 'none'}")
print(f"  top-level fields the archive lacks:        {dict(fb) or 'none'}")

for k in ("qualified", "pos", "team", "age", "exp"):
    d = [pid for pid in both if A[pid].get(k) != B[pid].get(k)]
    if d:
        ex = d[0]
        print(f"  {k}: {len(d)} differ (e.g. {A[ex]['name']}: {A[ex].get(k)} -> {B[ex].get(k)})")

ma, mb = Counter(), Counter()
diff = defaultdict(list)
cells = 0
for pid in both:
    am, bm = A[pid].get("m", {}), B[pid].get("m", {})
    for key in am:
        if key not in bm: ma[key] += 1; continue
        for w, c in am[key].items():
            d = bm[key].get(w)
            if d is None: ma[f"{key}.{w}"] += 1; continue
            va, vb = c.get("v"), d.get("v")
            if va is None and vb is None: continue
            cells += 1
            if va is None or vb is None or abs(va - vb) > 1e-9:
                diff[key].append((abs((va or 0) - (vb or 0)) if va is not None and vb is not None else math.inf,
                                  A[pid]["name"], w, va, vb))
    for key in bm:
        if key not in am: mb[key] += 1
print(f"  metric keys missing from the refresh (players affected): {dict(ma) or 'none'}")
print(f"  metric keys only in the refresh: {dict(mb) or 'none'}")
print(f"  {cells} value cells compared; metrics with any difference:")
for key, lst in sorted(diff.items(), key=lambda kv: -len(kv[1])):
    lst.sort(key=lambda t: -t[0])
    big = lst[0]
    print(f"    {key:9} {len(lst):5} differ   largest: {big[1]} {big[2]} {big[3]} -> {big[4]}")
