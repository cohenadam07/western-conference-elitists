"""measure.py — the three constants the rebuild and the lineups rest on, read off real data.
    transition  the gap from a change of possession to the next shot
    corner      where the straight part of the arc ends, from where threes are actually taken
    shrink      k for units: split each team's games odd/even, pull one half's luck-adjusted net
                toward the team by k possessions, and score it on the other half
Writes <home>/measure.json. Nothing reads it; the values are copied by hand next to the constants."""
import gzip, json, os, random, sys
from collections import Counter, defaultdict
from itertools import combinations
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import cbbd_client as CC, espn_cbb as E, normalize as N, rebuild as R, season as SZ, build as B


def transition(season="2025-26", n=1500):
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    fin = [e for e in E.finals(seen) if e["teams"][0]["conf"] and e["teams"][1]["conf"]]
    random.seed(1)
    hist = Counter()
    for e in random.sample(fin, n):
        g = N.load_game(season, e)
        pl = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
        last = None
        opp = {g["home"]: g["away"], g["away"]: g["home"]}
        for p in pl:
            if p["tid"] in (R.DREB,):
                last = (p["period"], p["clock"], p["team"])
            elif p["tid"] == R.TOV and p["team"] in opp:
                last = (p["period"], p["clock"], opp[p["team"]])
            elif p["shooting"] and p["tid"] != R.FT:
                if last and last[0] == p["period"] and last[2] == p["team"]:
                    hist[min(35, int(last[1] - p["clock"]))] += 1
                last = None
            elif p["tid"] in (R.PFOUL, R.FT, R.TFOUL) or p["tid"] in R.NON_ACTION:
                last = None
    t = sum(hist.values())
    return {k: round(100 * hist[k] / t, 2) for k in sorted(hist)}


def corner(season="2025-26"):
    S = pd.read_pickle(os.path.join(SZ.OUT, season, "shots.pkl"))
    t = S[(S.three == 1) & S.x.notna()].copy()
    t["ax"] = (t.x.astype(float) - 25).abs()
    t["d"] = np.hypot(t.ax, t.y.astype(float))
    by_y = t.groupby(t.y.astype(float).clip(upper=16)).agg(n=("d", "size"), ax=("ax", "median"), d=("d", "median"), make=("made", "mean"))
    return {"share_inside_line": round(float((t.d < 21.5).mean()), 4), "by_y": {int(k): [int(v.n), round(float(v.ax), 1), round(float(v.d), 1), round(float(v.make), 3)] for k, v in by_y.iterrows()}}


def shrink(season="2025-26"):
    with gzip.open(os.path.join(SZ.OUT, season, "stints.json.gz"), "rt") as fh:
        games = json.load(fh)
    d = json.load(open(os.path.join(SZ.OUT, season, "ids.json")))
    lg3, lgft = 0.33, 0.72
    acc = {0: defaultdict(lambda: {n: defaultdict(B.Acc) for n in (2, 5)}), 1: defaultdict(lambda: {n: defaultdict(B.Acc) for n in (2, 5)})}
    tot = {0: defaultdict(B.Acc), 1: defaultdict(B.Acc)}
    for i, (gid, home, away, st) in enumerate(sorted(games, key=lambda g: g[0])):
        h = i % 2
        for s in st:
            if s[5]:
                continue
            sec = s[1] - s[2]
            for team, five, a, b in ((home, s[3], B.IH, B.IA), (away, s[4], B.IA, B.IH)):
                if len(five) != 5:
                    continue
                tot[h][team].add(sec, s, a, b, gid)
                u = tuple(sorted(five))
                acc[h][team][5][u].add(sec, s, a, b, gid)
                for c in combinations(u, 2):
                    acc[h][team][2][c].add(sec, s, a, b, gid)
    res = {}
    for n, floor in ((5, 40), (2, 100)):
        rows = []
        for team in acc[0]:
            ta = (tot[0][team].rates(lg3, lgft, 0, 0) or {}).get("adj")
            if ta is None or team not in acc[1]:
                continue
            for key, x in acc[0][team][n].items():
                y = acc[1][team][n].get(key)
                if not y or x.p < floor or y.p < floor:
                    continue
                rx, ry = x.rates(lg3, lgft, 0, 0), y.rates(lg3, lgft, 0, 0)
                rows.append((x.p, rx["adj"], ta, ry["adj"], y.p))
        a = np.array(rows, float)
        best = None
        for k in (0, 50, 100, 150, 200, 300, 400, 600, 800, 1200, 1800, 2500, 4000):
            est = (a[:, 0] * a[:, 1] + k * a[:, 2]) / (a[:, 0] + k)
            e = float(np.sqrt(np.average((est - a[:, 3]) ** 2, weights=a[:, 4])))
            if best is None or e < best[1]:
                best = (k, e)
            res[f"{n}:{k}"] = round(e, 2)
        res[f"best_{n}"] = best[0]
        res[f"pairs_{n}"] = len(a)
    return res


if __name__ == "__main__":
    out = {"transition": transition(), "corner": corner(), "shrink": shrink()}
    json.dump(out, open(os.path.join(CC.HOME, "measure.json"), "w"), indent=1)
    print("gap %:", out["transition"])
    print(out["corner"])
    print({k: v for k, v in out["shrink"].items()})
