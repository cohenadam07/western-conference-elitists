"""
settle_points.py — how much sample each Basketball Savant stat needs before it means
something, measured from our own 15 seasons. Diagnostic only: prints a report and writes
out/settle_points.json. Nothing on the site reads it until it has been looked at.

THE QUESTION. Early in a season a player's 3P% is mostly noise. The honest estimate of where
it will settle is a blend: what he has done, weighted by how much of it there is (n), and a
prior, weighted by k, the sample the stat needs:

    settle = (n * x + k * prior) / (n + k)

k is the stat's stabilization point: the sample at which his own record and the prior count
equally. It is different for every stat and nobody should guess it.

THE DATA. Every modern season in the archive carries each stat for the full season and for
the team's last 25 games (and 10), with the sample behind each. For stats that are a ratio
over their sample (3P% over 3PA, TS% over shooting attempts, any per-75 over possessions)
the season splits into two halves that share no games:

    first part = season minus last 25      (about 57 games)
    last 25    = the window itself

So for every player-season there is a small sample (the last 25) and a separate, larger
record of the same player in the same year to check it against. For each stat, k is the
value that makes the last-25 estimate land closest to the first-part rate, across 15
seasons. That is fitted on predictions, out of sample, not on a variance formula.

Two priors are tested, as on Football Savant:
  mean   the qualified average at his position that season
  last   that average moved toward his own previous season by how much of it there was

Stats that are not a ratio over their sample (assist/turnover, turnover %, the per-game
volumes, self-creation) can't be split this way and are left out rather than approximated.
Assist %, usage % and the rebound percentages carry possessions as their sample, which is
proportional to their true denominators but not equal; they are marked approx.

    python settle_points.py [path/to/savant-data.json]
"""
import json, math, os, sys
from collections import defaultdict

DEFAULT = os.path.expanduser("~/western-conference-elitists/public/savant-data.json")

# key -> (kind, note). kind "ratio": v is a ratio over n as published.
#                                   "per75": v is per 75 possessions, n possessions.
STATS = {
    "ts": ("ratio", ""), "efg": ("ratio", ""), "pps": ("ratio", ""),
    "tp3": ("ratio", ""), "tp2": ("ratio", ""), "ft": ("ratio", ""),
    "tp3r": ("ratio", ""), "ftr": ("ratio", ""), "p3pt": ("ratio", ""),
    "pts": ("per75", ""), "ast75": ("per75", ""), "tov75": ("per75", ""),
    "reb75": ("per75", ""), "stl": ("per75", ""), "blk": ("per75", ""), "stk75": ("per75", ""),
    "drv": ("per75", ""), "potast": ("per75", ""),
    "ast": ("ratio", "approx"), "usg": ("ratio", "approx"),
    "oreb": ("ratio", "approx"), "dreb": ("ratio", "approx"),
    "rim": ("ratio", "approx"),
}
WINDOW = "l25"
MIN_FIRST = 0.5          # the first part must hold at least half the season's sample
K_GRID = sorted({round(10 ** (i / 40), 1) for i in range(0, 161)})   # 1 .. 10,000


def cell(p, key, w):
    c = (p.get("m") or {}).get(key) or {}
    c = c.get(w) or {}
    v, n = c.get("v"), c.get("n")
    if v is None or n is None or not isinstance(v, (int, float)) or n <= 0:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return float(v), float(n)


def pos_means(players, key):
    acc = defaultdict(list)
    for p in players:
        if p.get("qualified"):
            c = cell(p, key, "season")
            if c:
                acc[p.get("pos")].append(c[0])
    return {pos: (sum(v) / len(v), min(v), max(v)) for pos, v in acc.items() if len(v) >= 5}


def pairs_for(data, seasons, key, window, only=None):
    """Rows of (small n, small x, first-part x, mean prior, last-season prior inputs)."""
    rows = []
    prev_rows = {}
    for i, s in enumerate(seasons):
        if only and s != only:
            continue
        players = data[s]["players"]
        means = pos_means(players, key)
        prev = seasons[i + 1] if i + 1 < len(seasons) else None
        pm = pos_means(data[prev]["players"], key) if prev else {}
        if prev and prev not in prev_rows:
            prev_rows[prev] = {p["id"]: p for p in data[prev]["players"]}
        for p in players:
            if not p.get("qualified"):
                continue
            full, win = cell(p, key, "season"), cell(p, key, window)
            if not full or not win or p.get("pos") not in means:
                continue
            (vs, ns), (vw, nw) = full, win
            nf = ns - nw
            if nf < MIN_FIRST * ns or nw <= 0:
                continue
            vf = (ns * vs - nw * vw) / nf
            mu, lo, hi = means[p["pos"]]
            last = None
            q = prev_rows.get(prev, {}).get(p["id"]) if prev else None
            if q and q.get("pos") == p["pos"] and p["pos"] in pm:
                c = cell(q, key, "season")
                if c:
                    m0, l0, h0 = pm[p["pos"]]
                    last = (max(l0, min(h0, c[0])) - m0, c[1])
            rows.append((nw, vw, vf, mu, lo, hi, last))
    return rows


def estimate(row, k, use_last):
    nw, vw, vf, mu, lo, hi, last = row
    prior = mu
    if use_last and last:
        d, nl = last
        prior = mu + (nl / (nl + k)) * d
    prior = max(lo, min(hi, prior))
    return (nw * vw + k * prior) / (nw + k)


def rmse(rows, k, use_last):
    if not rows:
        return None
    return math.sqrt(sum((estimate(r, k, use_last) - r[2]) ** 2 for r in rows) / len(rows))


def best_k(rows, use_last):
    best = None
    for k in K_GRID:
        e = rmse(rows, k, use_last)
        if best is None or e < best[1]:
            best = (k, e)
    return best


def main(path):
    D = json.load(open(path))
    modern = [s for s in D["seasons"] if int(s[:4]) >= 2010
              and any(WINDOW in ((p.get("m") or {}).get("ts") or {}) for p in D["data"][s]["players"][:50])]
    print(f"seasons with a {WINDOW} window: {modern[-1]} .. {modern[0]} ({len(modern)})\n")
    out = {}
    hdr = f"{'stat':8} {'pairs':>6} {'k (mean)':>9} {'k (last)':>9} {'raw':>8} {'mean':>8} {'last':>8} {'cut':>6} {'k10':>7}  note"
    print(hdr)
    print("-" * len(hdr))
    for key, (kind, note) in STATS.items():
        rows = pairs_for(D["data"], modern, key, WINDOW)
        if len(rows) < 200:
            print(f"{key:8} {len(rows):>6}   too few pairs")
            continue
        raw = rmse(rows, 0.0, False)
        km, em = best_k(rows, False)
        kl, el = best_k(rows, True)
        # Consistency check at a smaller sample: the same fit on the last-10 window.
        r10 = pairs_for(D["data"], modern, key, "l10")
        k10 = best_k(r10, True)[0] if len(r10) >= 200 else None
        # Year by year, to see whether k is stable.
        per = {}
        for s in modern:
            rs = pairs_for(D["data"], modern, key, WINDOW, only=s)
            if len(rs) >= 60:
                per[s] = best_k(rs, True)[0]
        cut = 100 * (1 - el / raw) if raw else 0
        out[key] = dict(kind=kind, note=note, pairs=len(rows), k_mean=km, k_last=kl, k_l10=k10,
                        rmse_raw=raw, rmse_mean=em, rmse_last=el, by_season=per)
        print(f"{key:8} {len(rows):>6} {km:>9.0f} {kl:>9.0f} {raw:>8.4f} {em:>8.4f} {el:>8.4f} {cut:>5.0f}% {str(round(k10)) if k10 else '-':>7}  {note}")
    os.makedirs("out", exist_ok=True)
    json.dump(out, open(os.path.join("out", "settle_points.json"), "w"), indent=1)
    print("\nk is in the stat's own sample unit: attempts for shooting, possessions for per-75 and "
          "the approx rates.\nraw/mean/last = RMSE of the last-25 rate vs. the rest of the season: as is, "
          "shrunk to the position mean, shrunk with last season.\ncut = error removed by the last-season "
          "version. k10 = the same fit on last-10 samples (should sit near k).")
    print("wrote out/settle_points.json")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT)
