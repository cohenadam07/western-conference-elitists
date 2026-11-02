"""gate_rebuild.py — step 4's checks over a season: rebuild every game and report each gate."""
import concurrent.futures as cf, json, os, sys, time, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import espn_cbb as E, normalize as N, rebuild as R
try:
    import join as J
except ImportError:
    J = None

def one(a):
    s, ev = a
    try:
        g = N.load_game(s, ev)
        if J: J.apply(g)
        r = R.rebuild_game(g)
        return ev["id"], r["gate"], None, {"ev": bool(ev["teams"][0]["conf"]) and bool(ev["teams"][1]["conf"])}
    except Exception as e:
        return ev["id"], None, repr(e), {}

def run(s):
    seen = json.load(open(f"{E.ROOT}/{s}/days.json"))
    fin = [e for e in E.finals(seen) if os.path.exists(E.raw_path(s, e["id"]))]
    with cf.ProcessPoolExecutor(8) as ex:
        res = list(ex.map(one, [(s, e) for e in fin], chunksize=40))
    errs = [(g, e) for g, x, e, _ in res if e]
    print(s, "games", len(res), "errors", len(errs), errs[:3])
    rows = [(x, m) for g, x, e, m in res if x]
    d1 = [x for x, m in rows if m["ev"] and x["plays"]]
    n = len(d1)
    print(" D1-vs-D1 with pbp", n, "of", sum(1 for x, m in rows if m["ev"]))
    print(" score match", sum(x["score_ok"] for x in d1) / n)
    src = collections.Counter(x["lineups"] for x in d1); print(" lineup source", dict(src))
    L = [x for x in d1 if x["lineups"] != "none"]
    if L:
        tg = [v for x in L for v in x["five"].values()]
        print(" team-games five on floor all events", sum(v == 1 for v in tg) / len(tg), ">=.98", sum(v >= .98 for v in tg) / len(tg), ">=.9", sum(v >= .9 for v in tg) / len(tg))
        print(" player-games within 1 min", 1 - sum(x["minutes_off"] for x in L) / sum(x["players"] for x in L))
        print(" action share", sum(x["act_share"] for x in L) / len(L))
        cl=[x["clean"] for x in L if x.get("clean") is not None]
        if cl: print(" firm-five plays mean", sum(cl)/len(cl), "games >=.95", sum(v>=.95 for v in cl)/len(cl), "games >=.9", sum(v>=.9 for v in cl)/len(cl))
    print(" box match (shooting line)", sum(x["box_match"] for x in d1) / sum(x["box_players"] for x in d1))
    dev = []
    for x in d1:
        for t in x["poss"]:
            if x["formula"][t]: dev.append(x["poss"][t] / x["formula"][t] - 1)
    dev.sort()
    print(" poss/formula median", dev[len(dev)//2], "p05", dev[len(dev)//20], "p95", dev[-len(dev)//20], "within 2%", sum(abs(v) <= .02 for v in dev) / len(dev), "mean", sum(dev)/len(dev))
    print(" fg with location", sum(x["loc"] for x in d1) / max(1, sum(x["fga"] for x in d1)))
    return rows

if __name__ == "__main__":
    for s in sys.argv[1:]:
        run(s)
