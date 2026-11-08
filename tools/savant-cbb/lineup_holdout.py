"""
lineup_holdout.py — how well the lineup reconstruction recovers a side's floor time when ESPN's log is
missing substitutions. Takes clean games (both sides 97%+ firm, every man within a minute of the box),
deletes real substitution pairs (one stoppage's in and out) from one side, and scores that side's
minute-by-minute floor time (what the Rotation Map draws) against the untouched game, three ways: the
reconstruction before Nov 2026 (no re-seed), with the period re-seed, and with the box-minutes repair.
It also says how many damaged sides each gate lets through, and how wrong those are.

    cd pipeline/college && python3 ../../tools/savant-cbb/lineup_holdout.py 2025-26 1200 out.json
    DROP_PAIRS=2 ...                         two pairs deleted instead of one

Nov 2026, 2025-26, 932 clean games of 1,200 drawn: misplaced share of the side's floor time 1.13% (old),
0.96% (re-seed), 0.79% (repair); the new gate passes 732 damaged sides at 0.47% (old gate: 724 at 0.65%).
Two pairs deleted: 578 at 0.87% (old gate: 420 at 0.94%). rebuild.py REPAIR_MAX_OFF has the rest.
"""
import sys, os, json, random, copy, math, concurrent.futures as cf
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'pipeline', 'college'))
import espn_cbb as E, normalize as N, join as J, rebuild as R, season as S

def floor(r, team, home):
    on = {}
    for row in r["stints"]:
        per, start, end, h5, a5 = row[0], row[1], row[2], row[3], row[4]
        if per not in (1, 2): continue
        t0, t1 = (per - 1) * 1200 + 1200 - start, (per - 1) * 1200 + 1200 - end
        for e in (h5 if home else a5):
            arr = on.setdefault(e, np.zeros(40))
            for m in range(int(t0 // 60), min(40, math.ceil(t1 / 60))):
                a, b = max(t0, m * 60), min(t1, m * 60 + 60)
                if b > a: arr[m] += (b - a) / 60
    return on

def err(a, b):
    keys = set(a) | set(b)
    return sum(np.abs(np.minimum(a.get(k, np.zeros(40)), 1) - np.minimum(b.get(k, np.zeros(40)), 1)).sum() for k in keys) / 2 / 200  # share of the side's 200 man-minutes misplaced

def one(a):
    season, ev, seed = a
    rnd = random.Random(seed)
    g = N.load_game(season, ev); J.apply(g)
    if g.get("fives"): return None
    base = R.rebuild_game(g)
    final_pbp = bool(base["team"]) and all(t["pbp"]["pts"] == t["pts"] for t in base["team"])
    pbp_ok, lok = S.flags(base["gate"], final_pbp)
    sides = base["gate"].get("sides") or {}
    if not lok or not sides or any(sd["clean"] < 0.97 or sd["off"] or sd["repaired"] for sd in sides.values()): return None
    team = rnd.choice(sorted(sides)); home = team == g["home"]
    team_of = R._team_of(g)
    plays = sorted((p for p in g["plays"] if p["period"] in (1, 2)), key=lambda p: (p["period"], -p["clock"]))
    # one stoppage's substitutions for this team with exactly one in and one out
    blocks = {}
    for p in plays:
        if p["tid"] == R.SUB and p["ath"] and team_of.get(p["ath"][0]) == team:
            blocks.setdefault((p["period"], p["clock"]), []).append(p)
    pairs = [v for v in blocks.values() if len(v) == 2 and {R._sub_kind(x) for x in v} == {"in", "out"}]
    if not pairs: return None
    k = min(len(pairs), int(os.environ.get("DROP_PAIRS", "1")))
    drop = {x["pid"] for pr in rnd.sample(pairs, k) for x in pr}
    g2 = copy.deepcopy(g); g2["plays"] = [p for p in g2["plays"] if p["pid"] not in drop]
    truth = floor(base, team, home)
    old = R._rebuild_game(g2, None, reseed=False)
    plain = R._rebuild_game(g2, None)
    fixed = R.rebuild_game(g2)
    fp = bool(fixed["team"]) and all(t["pbp"]["pts"] == t["pts"] for t in fixed["team"])
    side_ok = S.side_flags(fixed["gate"], S.flags(fixed["gate"], fp)[0]).get(team, (False, []))[0]
    o_old, _ = R._off(old, [team])
    og = dict(old["gate"]); og.pop("sides", None)
    fo = bool(old["team"]) and all(t["pbp"]["pts"] == t["pts"] for t in old["team"])
    old_ok = S.flags(og, fo)[1]
    return dict(old=err(truth, floor(old, team, home)), plain=err(truth, floor(plain, team, home)), fixed=err(truth, floor(fixed, team, home)),
                repaired=fixed["gate"]["sides"][team]["repaired"], ok=side_ok, off_before=o_old[team], old_ok=old_ok)

if __name__ == "__main__":
    season, n = sys.argv[1], int(sys.argv[2])
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    fin = [e for e in E.finals(seen) if os.path.exists(E.raw_path(season, e["id"]))]
    random.Random(7).shuffle(fin)
    res = []
    with cf.ProcessPoolExecutor(8) as ex:
        for x in ex.map(one, [(season, e, i) for i, e in enumerate(fin[:n])], chunksize=10):
            if x: res.append(x)
    q = lambda xs: (round(float(np.mean(xs)), 4) if xs else None)
    print(f"{season}: {len(res)} clean games, one sub pair deleted from one side")
    print(f"  misplaced share of the side's floor time: old reconstruction {q([r['old'] for r in res])}, re-seed only {q([r['plain'] for r in res])}, with repair {q([r['fixed'] for r in res])}")
    rep = [r for r in res if r["repaired"]]
    print(f"  repaired {len(rep)}: before repair {q([r['plain'] for r in rep])}, after {q([r['fixed'] for r in rep])}")
    passed = [r for r in res if r["ok"]]
    print(f"  side passes the new gate {len(passed)} of {len(res)}; misplaced among those {q([r['fixed'] for r in passed])}, worst {round(max([r['fixed'] for r in passed] or [0]), 3)}; 95th pct {round(float(np.percentile([r['fixed'] for r in passed], 95)), 3) if passed else None}")
    print(f"  of passing: repaired {sum(r['repaired'] for r in passed)}")
    op = [r for r in res if r["old_ok"]]
    print(f"  the old gate passed {len(op)} of {len(res)} damaged games; misplaced among those (old reconstruction) {q([r['old'] for r in op])}, 95th pct {round(float(np.percentile([r['old'] for r in op], 95)), 3) if op else None}, worst {round(max([r['old'] for r in op] or [0]), 3)}")
    json.dump(res, open(sys.argv[3], "w"))
