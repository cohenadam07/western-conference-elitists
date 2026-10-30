"""
measure_ww.py: settle points for the With/Without on-court stats, which the card never ranked.

    python3 tools/savant-settle/measure_ww.py

Net rating, the ratings, pace and the four factors while he is on the floor have no row on the
card, so measure.py has nothing to say about them. The method is its in-season idea at its plainest.
Every game a player-season has goes odd or even, so the two halves share no possessions but
are the same man in the same year; the correlation r between them across players, over a mean of n
possessions a half, gives the sample where half of what the number shows is real: k = n (1 - r) / r.
Player-seasons with 1,000+ possessions, 2013-14 to 2025-26.

Writes tools/savant-settle/ww.json, and ON_SETTLE in public/savant-ww.js.
"""
import gzip
import glob
import json
import math
import os
import re
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
FIRST, LAST = "2013-14", "2025-26"
MIN_POSS = 1000


def nice(x):
    m = 10 ** math.floor(math.log10(x) - 1)
    return int(round(x / m) * m)


def efg(s):
    return 100 * (s["fgm"] + .5 * s["fg3m"]) / s["fga"] if s["fga"] else None


def plays(s):
    return s["fga"] + .44 * s["fta"] + s["tov"]


STATS = {
    "net": lambda t, o, sec: 100 * t["pts"] / t["poss"] - 100 * o["pts"] / o["poss"],
    "ortg": lambda t, o, sec: 100 * t["pts"] / t["poss"],
    "drtg": lambda t, o, sec: 100 * o["pts"] / o["poss"],
    "pace": lambda t, o, sec: (t["poss"] + o["poss"]) / 2 * 2880 / sec,
    "t_efg": lambda t, o, sec: efg(t),
    "t_tov": lambda t, o, sec: 100 * t["tov"] / plays(t),
    "t_oreb": lambda t, o, sec: 100 * t["oreb"] / (t["oreb"] + o["dreb"]),
    "t_ftr": lambda t, o, sec: 100 * t["fta"] / t["fga"],
    "o_efg": lambda t, o, sec: efg(o),
    "o_tov": lambda t, o, sec: 100 * o["tov"] / plays(o),
    "o_oreb": lambda t, o, sec: 100 * o["oreb"] / (o["oreb"] + t["dreb"]),
    "o_ftr": lambda t, o, sec: 100 * o["fta"] / o["fga"],
}


def corr(a, b):
    ma, mb = mean(a), mean(b)
    sa = sum((x - ma) ** 2 for x in a) ** .5
    sb = sum((x - mb) ** 2 for x in b) ** .5
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb)


def main():
    halves = []
    for f in sorted(glob.glob(os.path.join(ROOT, "public", "bcs", "ww", "*.json.gz"))):
        season = f[-15:-8]
        if not FIRST <= season <= LAST:
            continue
        d = json.load(gzip.open(f, "rt"))
        on = d["on"]
        acc = {}
        for g in d["games"]:
            for r in g[2]:
                if r[1] <= 0:
                    continue
                a = acc.setdefault(r[0], [[[0] * len(on), [0] * len(on), 0.0, 0], [[0] * len(on), [0] * len(on), 0.0, 0]])
                h = a[(a[0][3] + a[1][3]) % 2]        # his games in turn: odd, even
                h[0] = [x + y for x, y in zip(h[0], r[3])]
                h[1] = [x + y for x, y in zip(h[1], r[4])]
                h[2] += r[1]
                h[3] += 1
        for a in acc.values():
            x, y = a
            if (x[0][0] + x[1][0] + y[0][0] + y[1][0]) / 2 < MIN_POSS or not (x[2] and y[2]):
                continue
            halves.append(tuple((dict(zip(on, h[0])), dict(zip(on, h[1])), h[2]) for h in a))
    n = mean((a[0]["poss"] + a[1]["poss"]) / 2 for a, _ in halves)
    out = {}
    for k, fn in STATS.items():
        xs = [fn(*a) for a, _ in halves]
        ys = [fn(*b) for _, b in halves]
        r = corr(xs, ys)
        out[k] = dict(r=round(r, 3), k=round(n * (1 - r) / r), show=nice(n * (1 - r) / r))
        print(f"{k:8} r {r:.3f}  k {out[k]['k']:6}  shown {out[k]['show']}")
    json.dump(dict(about=__doc__.strip().split("\n")[0], player_seasons=len(halves), mean_half_poss=round(n), seasons=[FIRST, LAST], stats=out),
              open(os.path.join(HERE, "ww.json"), "w"), indent=1)
    p = os.path.join(ROOT, "public", "savant-ww.js")
    s = open(p).read()
    table = json.dumps({k: v["show"] for k, v in out.items()}, separators=(",", ":"))
    s = re.sub(r"/\*ON_SETTLE\*/\{[^}]*\}", "/*ON_SETTLE*/" + table, s)
    open(p, "w").write(s)
    print(f"{len(halves):,} player-seasons, {n:.0f} possessions a half")


if __name__ == "__main__":
    main()
