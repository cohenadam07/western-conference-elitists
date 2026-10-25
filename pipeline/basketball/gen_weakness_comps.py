"""
gen_weakness_comps.py — attach weakness comps to the current season in out/players.json.

The statistical comps ask "who does he resemble?". This asks the mirror question — "whose
flaws look like his?" — and the answers are deliberately different: hinging the vector at
the median throws away everything a player is good at, so two players who share one real
weakness match even when their overall profiles never would.

Runs entirely off the *built* metric values, so it needs no network and no new endpoint —
the same post-processing shape as gen_historical_comps.py:

    python savant_engine.py build      # -> out/players.json
    python gen_weakness_comps.py       # attaches wcomps + wflaws to the current season
    python build_page.py               # bakes it into the page

Current season only, by design. The tuning constants and the dim registry live in
savant_config.WEAKNESS; nothing here should be edited to change behaviour.
"""
import json, math, os, sys
import savant_config as C
import savant_engine as E

OUT = os.path.join("out", "players.json")
W = C.WEAKNESS
DIMS = list(W["dims"])
LOWER = {m["key"]: m["lower"] for m in C.METRICS}
THR = {m["key"]: m["thr"] for m in C.METRICS}


def minutes(p):
    """Total minutes played. `minshare` is a share-of-team-minutes metric whose sample size
    is the player's own minute count, which is the only per-player minutes figure the built
    contract carries (mpg is n:null, being static per window)."""
    return ((p["m"].get("minshare", {}) or {}).get("season") or {}).get("n") or 0


def value(p, key):
    """Season value for one dim, or None when it is missing or below the metric's own
    stabilization threshold — a 3P% off 40 attempts is not evidence of a flaw."""
    s = (p["m"].get(key, {}) or {}).get("season")
    if not s or s.get("v") is None:
        return None
    v = s["v"]
    if v != v:                       # NaN — the engine emits it for genuinely absent values
        return None
    n = s.get("n")
    if n is not None and n < THR[key]:
        return None
    return float(v)


def goodness(pool):
    """{pid: {dim: 0-100}}, ranked inside each Guard/Wing/Big bucket and flipped so that
    100 is always GOOD — which is what lets the hinge below mean "worse than his peers"
    rather than "low raw number"."""
    out = {}
    buckets = {}
    for p in pool:
        buckets.setdefault(p["pos"], []).append(p)
    for _, grp in buckets.items():
        for k in DIMS:
            ranked = E._pct_rank([(p["id"], value(p, k)) for p in grp])
            for pid, pct in ranked.items():
                out.setdefault(pid, {})[k] = (100.0 - pct) if LOWER[k] else pct
    return {pid: {k: v.get(k) for k in DIMS} for pid, v in out.items()}


def hinge(good):
    """max(0, hinge - goodness), scaled to 0-1. Everything at or above the hinge is exactly
    zero, so a player's strengths contribute nothing to who he matches."""
    h = W["hinge"]
    return {pid: {k: (None if g is None else max(0.0, h - g) / h) for k, g in v.items()}
            for pid, v in good.items()}


def profile(wk):
    """Split each hinge vector into a unit direction (which flaws) and a severity (how bad).
    Matching on direction alone pairs a mildly flawed star with a wreck who happens to be
    flawed in the same places; matching on severity alone pairs any two equally mediocre
    players. The distance below needs both."""
    unit, sev = {}, {}
    for pid, v in wk.items():
        vs = {k: x for k, x in v.items() if x is not None}
        norm = math.sqrt(sum(x * x for x in vs.values()))
        unit[pid] = {k: x / norm for k, x in vs.items()} if norm else {k: 0.0 for k in vs}
        # dim-count normalized so a player missing a couple of dims isn't scored as calmer
        sev[pid] = norm * math.sqrt(len(DIMS) / max(1, len(vs)))
    return unit, sev


def distance(unit, sev, a, b):
    ua, ub = unit[a], unit[b]
    shared = [k for k in DIMS if k in ua and k in ub]
    if len(shared) < W["min_dims"]:
        return None
    shape = math.sqrt(sum((ua[k] - ub[k]) ** 2 for k in shared))
    mass = abs(sev[a] - sev[b]) / max(sev[a], sev[b], 1e-9)
    return shape + W["severity_w"] * mass


def flaws_of(good, pid):
    """The dims worth naming: furthest below the median first, and only those under
    flaw_max_pct so the page never announces a 48th-percentile 'weakness'."""
    got = [(g, k) for k, g in good[pid].items() if g is not None and g < W["flaw_max_pct"]]
    got.sort()
    return [{"k": k, "pct": int(round(g))} for g, k in got[:W["n_flaws"]]]


def build(season=None, path=None):
    # `path` lets refresh_current.py point this at the current-season file (out/current.json)
    # instead of the full rebuild's out/players.json; the shape is the same.
    OUT = path or globals()["OUT"]
    payload = json.load(open(OUT))
    season = season or C.SEASON
    entries = (payload["data"].get(season) or {}).get("players")
    if not entries:
        sys.exit(f"no players for {season} in {OUT} — run the engine first.")

    pool = [p for p in entries if minutes(p) >= W["min_minutes"]]
    if len(pool) < 20:
        sys.exit(f"pool too small ({len(pool)}) — nothing to compute.")
    good = goodness(pool)
    unit, sev = profile(hinge(good))
    pids = [p["id"] for p in pool]
    by_id = {p["id"]: p for p in pool}

    nearest = {}
    for a in pids:
        ds = [(d, b) for b in pids if b != a
              for d in (distance(unit, sev, a, b),) if d is not None]
        ds.sort()
        nearest[a] = ds[:W["n_comps"]]

    # Calibrate distance -> match%, same two-anchor shape as the statistical comps so the
    # numbers read on the same scale: the rare_frac quantile of best-match distances is a
    # 95, the median best match is a 78. Unlike those comps the tail matters here — a
    # player with no real weakness twin must score genuinely low, not clamp near the
    # middle — so the line is left to run down and the page flags anything <= low_match.
    best = sorted(ds[0][0] for ds in nearest.values() if ds)
    if not best:
        sys.exit("no pairs formed — check the dim coverage.")
    q = lambda f: best[min(len(best) - 1, max(0, int(f * len(best))))]
    d95, d_mid = q(W["rare_frac"]), q(0.50)
    if d_mid <= d95:
        d_mid = d95 + 0.1
    slope = (95.0 - 78.0) / (d_mid - d95)
    score = lambda d: max(1, min(99, int(round(95.0 - (d - d95) * slope))))

    # The diagnosis and the comps are attached independently. A player short of min_dims
    # forms no pairs at all, but his flaws are still nameable — and the named flaws are the
    # more useful half of the module, so they should not be lost with the neighbours.
    attached = flagged = 0
    for a in pids:
        fl = flaws_of(good, a)
        if fl:
            by_id[a]["wflaws"] = fl
            flagged += 1
        # A player above the hinge on every dim has no weakness profile to match against;
        # left alone, two such players would sit at distance 0 and score a bogus 99%.
        if sev[a] < 1e-9 or not nearest[a]:
            continue
        by_id[a]["wcomps"] = [
            {"id": b, "name": by_id[b]["name"], "team": by_id[b]["team"], "score": score(d)}
            for d, b in nearest[a]
        ]
        attached += 1

    import safe_io
    safe_io.dump_json(OUT, payload)

    hi = lambda t: sum(1 for a in pids if nearest[a] and score(nearest[a][0][0]) >= t)
    lo = sum(1 for a in pids if nearest[a] and score(nearest[a][0][0]) <= W["low_match"])
    print(f"weakness comps: {season}  pool={len(pids)}  comps on {attached}, flaws on {flagged}  "
          f"d95={d95:.2f} dmid={d_mid:.2f}")
    print(f"  best-match >=90:{hi(90)}  >=80:{hi(80)}  >=70:{hi(70)}"
          f"  weak-match (<={W['low_match']}):{lo}"
          f"  no pairs:{len(pids) - attached}  no named flaw:{len(pids) - flagged}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else None)
