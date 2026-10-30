"""
measure.py: how much sample every Basketball Savant stat needs before it means something.
Writes tools/savant-settle/settle.json, which the page (SETTLE_K, each stat's hatching
threshold and its "sample" explainer) and the connector take their numbers from.

    python3 tools/savant-settle/measure.py            (about 4 minutes)

Two methods, the better one wherever the data allows it.

1. IN-SEASON SPLIT (pipeline/basketball/settle_points.py, unchanged). The archive carries each
   card stat for the full season and for the team's last 25 games, with the sample behind each,
   from 2010-11 on. Season minus last 25 and the last 25 share no games, so for every
   player-season there is a small sample and a separate record of the same player in the same
   year to check it against. k is the value that makes the small sample, shrunk toward a prior
   with weight k, land closest to the rest of the season. Two priors: his position's average
   (k_mean) and that average moved toward his own last season (k_last). Only for stats that are
   a ratio over their sample.

2. SEASON TO SEASON (everything else: the October 2026 additions and the card stats the NBA
   publishes for the full season only). There is no in-season split in their history, so the
   same fit is run across seasons instead: a player's deviation from his position's average,
   shrunk by n / (n + k), predicting his deviation the next season. Players genuinely change
   from one year to the next, so this k is not the same number as the in-season one. It was
   calibrated on the stats measured both ways (computed here, every run): in-season k_last =
   season-to-season k times the median factor of the stats in its family (possession-based or
   attempt-based). Left out one stat at a time, the calibrated number's error is reported as
   check in settle.json (Oct 29, 2026: 15% for the median stat, 50% at the 90th percentile).
   k_mean is then k_last times the family's median k_mean / k_last.

The hatching threshold (thr on the page) is k_mean: under it, less than half of what the bar
shows is the player. "Settles around" in the explainer is k_last, as before.

Stats left out (no sample that noise shrinks with, or nothing to measure across seasons) keep
their hand-set threshold and text: counts and per-game volumes, availability and minutes share,
the consistency spreads (volatility, floor, ceiling), percentiles of percentiles, the one-season
NBA leaderboards (gravity, leverage), measurements, and the box-score composites (PER, BPM, WS).
"""
import json, math, os, re, statistics, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(ROOT, "public")
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
import settle_points as SP  # noqa: E402

# Card stats that are a ratio over their sample: measured in-season (settle_points.py's 23 plus 6).
SPLIT = dict(SP.STATS)
SPLIT.update({"tov": ("ratio", "approx"), "selfcr": ("ratio", ""), "uast": ("ratio", ""),
              "uast3": ("ratio", ""), "ppaint": ("ratio", ""), "gmsc": ("ratio", "per game")})

SKIP = {"mpg", "minshare", "avail", "tp3a", "fta", "asttov", "syn", "tech", "wpa", "swr",
        "minsd", "gssd", "floor", "ceil", "per", "ws48", "bpm", "obpm", "dbpm", "vorp"}
K_GRID = SP.K_GRID


def nice(x):
    """Two significant figures: 1,496 -> 1,500; 282 -> 280; 42 -> 42."""
    if x < 100:
        return int(round(x))
    p = 10 ** (int(math.log10(x)) - 1)
    return int(round(x / p) * p)


def season_rows(D, key, ext):
    """{season: {pid: (x, n, pos)}}, qualified players only."""
    out = {}
    files = {}
    if ext:
        d = os.path.join(PUB, "savant-ext", "s")
        files = {f[:-5]: os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json")}
    for s in D:
        qual = {str(p["id"]): p for p in D[s]["players"] if p.get("qualified")}
        rows = {}
        if ext:
            if s not in files:
                continue
            X = json.load(open(files[s]))
            if key not in X["keys"]:
                continue
            i = X["keys"].index(key)
            for pid, r in X["players"].items():
                c = r["season"][i]
                if pid in qual and c and c[0] is not None and c[1]:
                    rows[pid] = (float(c[0]), float(c[1]), qual[pid].get("pos"))
        else:
            for pid, p in qual.items():
                c = ((p.get("m") or {}).get(key) or {}).get("season") or {}
                v, n = c.get("v"), c.get("n")
                if isinstance(v, (int, float)) and isinstance(n, (int, float)) and n > 0 and not (isinstance(v, float) and math.isnan(v)):
                    rows[pid] = (float(v), float(n), p.get("pos"))
        if len(rows) >= 50:
            out[s] = rows
    return out


def season_to_season(series):
    dev = {}
    for s, rows in series.items():
        bypos = defaultdict(list)
        for pid, (x, n, pos) in rows.items():
            bypos[pos].append(x)
        mu = {p: statistics.mean(v) for p, v in bypos.items() if len(v) >= 5}
        for pid, (x, n, pos) in rows.items():
            if pos in mu:
                dev[(s, pid)] = (x - mu[pos], n, pos)
    ss = sorted(series)
    pairs = []
    for a, b in zip(ss, ss[1:]):
        for pid in series[b]:
            if (a, pid) in dev and (b, pid) in dev and dev[(a, pid)][2] == dev[(b, pid)][2]:
                pairs.append((dev[(a, pid)][0], dev[(a, pid)][1], dev[(b, pid)][0]))
    if len(pairs) < 200:
        return None
    best = min(K_GRID, key=lambda k: sum((n / (n + k) * d - t) ** 2 for d, n, t in pairs))
    return dict(k=best, pairs=len(pairs), seasons=len(series), median_n=statistics.median(p[1] for p in pairs))


def main():
    page = open(os.path.join(PUB, "basketball-savant.html"), encoding="utf-8").read()
    at = page.index("const CFG  = ") + len("const CFG  = ")
    metrics = json.loads(page[at:SP_json_end(page, at) + 1])["metrics"]
    data = json.load(open(os.path.join(PUB, "savant-data.json")))
    D = data["data"]
    modern = [s for s in data["seasons"] if int(s[:4]) >= 2010
              and any(SP.WINDOW in ((p.get("m") or {}).get("ts") or {}) for p in D[s]["players"][:50])]

    out = {}
    # 1. in-season split
    for key, (kind, note) in SPLIT.items():
        rows = SP.pairs_for(D, modern, key, SP.WINDOW)
        km, _ = SP.best_k(rows, False)
        kl, _ = SP.best_k(rows, True)
        out[key] = dict(method="split", k_mean=km, k_last=kl, pairs=len(rows), seasons=len(modern))
        print(f"split  {key:9} k_mean {km:7.0f}  k_last {kl:7.0f}  ({len(rows)} player-seasons)", flush=True)

    # Calibration: the in-season stats measured season to season too.
    fam_of = lambda r: "poss" if r["median_n"] > 1500 else "att"
    cal = {}
    for key in SPLIT:
        ser = season_rows(D, key, False)
        r = season_to_season(ser) if ser else None
        if r:
            cal[key] = (fam_of(r), math.log(out[key]["k_last"] / r["k"]), math.log(out[key]["k_mean"] / out[key]["k_last"]))
            out[key]["k_season"] = r["k"]
    FACTOR = {f: math.exp(statistics.median(c[1] for c in cal.values() if c[0] == f)) for f in ("poss", "att")}
    MEAN_SHARE = {f: math.exp(statistics.median(c[2] for c in cal.values() if c[0] == f)) for f in ("poss", "att")}
    loo = []
    for key, (f, lr, _) in cal.items():
        others = [c[1] for k2, c in cal.items() if k2 != key and c[0] == f]
        loo.append(abs(lr - statistics.median(others)))
    loo.sort()
    check = dict(stats=len(loo), median_error=round(math.exp(statistics.median(loo)) - 1, 3),
                 p90_error=round(math.exp(loo[int(0.9 * len(loo))]) - 1, 3))
    print(f"calibration: factor {FACTOR}, mean share {MEAN_SHARE}; left-one-out error {check}", flush=True)

    # 2. season to season, calibrated
    for m in metrics:
        key = m["key"]
        if key in out or key in SKIP or m["unit"] in ("inch", "ftin", "lb", "word"):
            continue
        ser = season_rows(D, key, bool(m.get("ext")))
        r = season_to_season(ser) if ser else None
        if not r:
            continue
        fam = fam_of(r)
        kl = r["k"] * FACTOR[fam]
        km = kl * MEAN_SHARE[fam]
        out[key] = dict(method="season", k_mean=km, k_last=kl, k_season=r["k"], family=fam,
                        pairs=r["pairs"], seasons=r["seasons"], median_n=r["median_n"])
        print(f"season {key:9} k_mean {km:7.0f}  k_last {kl:7.0f}  ({r['pairs']} season pairs, {fam})", flush=True)

    for v in out.values():
        v["show_mean"], v["show_last"] = nice(v["k_mean"]), nice(v["k_last"])
    json.dump(dict(about="Settle points: see tools/savant-settle/measure.py. k in each stat's own sample unit.",
                   factor=FACTOR, mean_share=MEAN_SHARE, check=check, stats=out),
              open(os.path.join(HERE, "settle.json"), "w"), indent=1)
    print(f"wrote settle.json: {len(out)} stats "
          f"({sum(v['method'] == 'split' for v in out.values())} in-season, {sum(v['method'] == 'season' for v in out.values())} season to season)")


def SP_json_end(s, i):
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return j
    raise ValueError("CFG not closed")


if __name__ == "__main__":
    main()
