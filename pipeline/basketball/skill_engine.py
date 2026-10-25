"""
skill_engine.py — Savant metrics -> a player skill vector with confidence bands.

Why this exists
---------------
The GM game cannot run on "87 overall". It needs a vector of skills, each traceable
back to real Savant metrics, each carrying how much we actually know. That last part
is what makes young players volatile without bolting volatility on: a rookie with 400
minutes has wide bands because his sample is small, and the sim reads the band.

How a skill is computed
-----------------------
  value      weighted mean of its contributing metrics' SEASON-RELATIVE percentiles
             (0-100). Season-relative, so 1985 and 2026 are comparable and era
             inflation cancels out.
  conf       min over contributors of clamp(n / thr), where n is the metric's sample
             size in that window and thr is the stabilization threshold already
             declared in out/metrics_config.json. thr == 0 (static/measured) -> 1.0.
  cover      fraction of the skill's declared weight that had data at all. Old seasons
             lack tracking metrics, so cover < 1 is normal pre-2014 and the game should
             widen bands accordingly rather than pretend.

Direction is never hardcoded here: `lower` comes off the metric registry, so a metric
that is good-when-small (turnovers, opponent FG%) inverts automatically and a long bar
always means good.

Usage:
  python skill_engine.py build       # -> out/skills.json
  python skill_engine.py check       # eyeball the current season
"""
import json, sys, math, collections

OUT = "out"
SKILLS_PATH = f"{OUT}/skills.json"
POOL_MIN_MPG = 8.0          # percentile pool: rotation players, not garbage time

# skill -> [(metric_key, weight), ...]
SKILLS = {
    # ---- offense
    # Accuracy and willingness are weighted evenly on purpose. 3P% alone regresses a
    # non-shooter to the league mean the moment his sample is thin, which is exactly
    # backwards: a big who attempts none is not an average shooter, and what the spacing
    # model needs is whether the defense has to guard him at all. Volume is fully
    # measured; accuracy is the part that regresses.
    "shooting_3":      [("tp3", 2.0), ("tp3a", 2.0), ("tp3r", 1.0), ("p3pt", 0.5)],
    "shooting_ft":     [("ft", 1.0)],
    "shooting_mid_in": [("tp2", 2.0), ("pps", 1.0)],
    "shot_making":     [("syn", 2.0), ("ts", 1.5), ("efg", 1.0)],
    # NOTE: `selfcr` is deliberately NOT used here. Despite its "Self-creation" label,
    # savant_engine computes it as FGA_FREQUENCY at Very Tight + Tight closest-defender
    # distance — i.e. the share of a player's shots taken tightly contested. That is shot
    # DIET, not shot CREATION: Rudy Gobert scores in the 96th percentile on it because a
    # roll man finishes through bodies, having created nothing. It gets its own honest
    # skill below.
    "self_creation":   [("usg", 2.0), ("drv", 1.5), ("syn", 1.0), ("ddiff", 0.5)],
    "rim_pressure":    [("drv", 2.0), ("ftr", 1.5), ("fta", 0.5)],
    "playmaking":      [("ast", 2.0), ("potast", 1.5), ("ast75", 1.0)],
    "ball_security":   [("tov", 2.0), ("asttov", 1.0)],
    "off_rebounding":  [("oreb", 1.0)],
    "contested_diet":  [("selfcr", 1.0)],   # share of shots taken tightly contested
    "gravity":         [("grav", 2.0), ("tp3", 1.0), ("tp3r", 0.5)],
    # ---- defense
    "rim_protection":  [("blkpct", 2.0), ("rim", 2.0), ("length", 0.5)],
    "perimeter_def":   [("oppfg", 2.0), ("mtch", 1.5), ("lateral", 0.5)],
    "def_rebounding":  [("dreb", 1.0)],
    "event_creation":  [("stlpct", 1.5), ("defl", 1.5)],
    "def_impact":      [("dbpm", 1.0)],
    # ---- physical / context
    "size":            [("height", 2.0), ("length", 1.0), ("reach", 1.0)],
    "athleticism":     [("vert", 1.5), ("lateral", 1.0)],
    "availability":    [("avail", 1.0)],
}

# Combine measurables exist only for players who attended the combine (~53% even in
# 2025-26 — a 12-year vet has none). They are enrichment, not the substance of a skill,
# so they are excluded from the coverage denominator: a skill is not "half missing"
# because a 2014 draftee never had his wingspan taken. `grav` is deliberately NOT here —
# gravity genuinely is thin data and should report low coverage.
OPTIONAL = {"length", "reach", "vert", "lateral"}

# a single all-in-one impact number, kept separate from the skills
IMPACT = [("bpm", 2.0), ("vorp", 1.0), ("ws48", 1.0)]


def load_registry():
    cfg = json.load(open(f"{OUT}/metrics_config.json"))
    return {m["key"]: m for m in cfg["metrics"]}


def midrank_pct(values):
    """values: list of (idx, v). Returns idx -> percentile 0..100, ties share midrank."""
    vs = sorted(values, key=lambda t: t[1])
    n = len(vs)
    out, i = {}, 0
    while i < n:
        j = i
        while j + 1 < n and vs[j + 1][1] == vs[i][1]:
            j += 1
        mid = (i + j) / 2.0
        p = 100.0 * mid / max(1, n - 1)
        for k in range(i, j + 1):
            out[vs[k][0]] = p
        i = j + 1
    return out


def season_percentiles(players, reg, window="season"):
    """metric -> {player_index: percentile}, ranked inside the rotation pool."""
    pool = [i for i, p in enumerate(players)
            if ((p.get("m", {}).get("mpg") or {}).get(window, {}) or {}).get("v", 0) >= POOL_MIN_MPG]
    if len(pool) < 40:
        pool = list(range(len(players)))
    pcts = {}
    keys = {k for spec in list(SKILLS.values()) + [IMPACT] for k, _ in spec}
    for k in keys:
        lower = reg.get(k, {}).get("lower", False)
        vals = []
        for i in pool:
            v = ((players[i].get("m", {}).get(k) or {}).get(window) or {}).get("v")
            if v is not None:
                vals.append((i, -float(v) if lower else float(v)))
        if len(vals) >= 20:
            pcts[k] = midrank_pct(vals)
    return pcts, pool


def metric_conf(p, k, reg, window="season"):
    thr = reg.get(k, {}).get("thr", 0) or 0
    if not thr:
        return 1.0
    n = ((p.get("m", {}).get(k) or {}).get(window) or {}).get("n")
    return 1.0 if n is None else min(1.0, float(n) / float(thr))


def score_player(p, pcts, reg, prior=None, bucket=None, window="season"):
    """Skill values from METRIC-level percentiles.

    Shrinkage happens per metric, not per skill. That distinction matters: Rudy Gobert's
    3P% is genuinely unknown (a handful of attempts) but his 3PA rate is known exactly and
    is near zero. Shrinking the whole skill on the weakest contributor's confidence pulls
    him to the positional mean and erases the most certain fact about his shooting. Each
    metric shrinks toward its own positional prior on its own confidence instead, so the
    unknown part regresses and the known part does not.
    """
    idx = p["_i"]
    out = {}
    for skill, spec in SKILLS.items():
        want = sum(w for k, w in spec if k not in OPTIONAL) or sum(w for _, w in spec)
        num = nums = den = cw = 0.0
        for k, w in spec:
            pk = pcts.get(k, {})
            if idx not in pk:
                continue
            v = pk[idx]
            c = metric_conf(p, k, reg)
            mu = (prior or {}).get((bucket, k))
            vs = c * v + (1 - c) * mu if mu is not None else v
            num += w * v
            nums += w * vs
            den += w
            cw += w * c
        if den == 0:
            continue
        out[skill] = {
            "v":     round(num / den, 1),
            "vs":    round(nums / den, 1),
            "conf":  round(cw / den, 2),
            "cover": round(min(1.0, den / want), 2),
        }
    num = den = 0.0
    for k, w in IMPACT:
        pk = pcts.get(k, {})
        if idx in pk:
            num += w * pk[idx]; den += w
    return out, (round(num / den, 1) if den else None)


def _slot_bucket(slot):
    """1.0-5.0 continuous position -> 5 coarse buckets for the shrinkage prior."""
    return max(0, min(4, int(round(slot)) - 1))


def cmd_build():
    import os
    reg = load_registry()
    data = json.load(open(f"{OUT}/players.json"))["data"]
    POS = json.load(open(f"{OUT}/positions.json"))["data"] if os.path.exists(f"{OUT}/positions.json") else {}
    out = {}
    for season, blk in data.items():
        ps = blk["players"]
        for i, p in enumerate(ps):
            p["_i"] = i
        pcts, pool = season_percentiles(ps, reg)
        pb = POS.get(season, {})
        bucket = {str(p["id"]): _slot_bucket(pb.get(str(p["id"]), {}).get("slot", 3.0)) for p in ps}

        # pass 1 — metric-level positional priors.
        #
        # Built from EVERY player in the bucket who has the metric at all, not only the
        # confident ones. Restricting the prior to high-confidence players looks careful
        # and is actively wrong: the centres with a stable 3P% are the centres who shoot
        # threes, so "the average centre's 3P%" comes out as "the average SHOOTING
        # centre's 3P%" and every non-shooting big regresses upward into a spacer he
        # isn't. Noise in individual estimates averages out; selection does not.
        prior = {}
        for p in ps:
            b = bucket[str(p["id"])]
            for k, pk in pcts.items():
                if p["_i"] in pk:
                    prior.setdefault((b, k), []).append(pk[p["_i"]])
        prior = {k: sum(v) / len(v) for k, v in prior.items() if len(v) >= 8}

        # pass 2 — score
        blk_out = {}
        for p in ps:
            sk, imp = score_player(p, pcts, reg, prior, bucket[str(p["id"])])
            if sk:
                blk_out[str(p["id"])] = {"s": sk, "impact": imp}
        out[season] = blk_out
    json.dump({"generated_by": "skill_engine.build", "pool_min_mpg": POOL_MIN_MPG,
               "skills": list(SKILLS.keys()),
               "note": "v = raw season-relative percentile; vs = per-metric shrunk toward "
                       "the positional prior by that metric's own confidence. The sim reads vs.",
               "data": out},
              open(SKILLS_PATH, "w"))
    n = sum(len(v) for v in out.values())
    cur = max(out)
    print(f"scored {n:,} player-seasons across {len(out)} seasons -> {SKILLS_PATH}")
    print(f"{cur}: {len(out[cur]):,} players")


def cmd_check():
    sk = json.load(open(SKILLS_PATH))
    data = json.load(open(f"{OUT}/players.json"))["data"]
    season = max(data.keys())
    blk = {str(p["id"]): p["name"] for p in data[season]["players"]}
    S = sk["data"][season]
    show = ["shooting_3", "playmaking", "self_creation", "rim_pressure",
            "rim_protection", "perimeter_def", "def_rebounding", "gravity"]
    names = ["Stephen Curry", "Nikola Jokic", "Rudy Gobert", "Victor Wembanyama",
             "Shai Gilgeous-Alexander", "Draymond Green", "Giannis Antetokounmpo",
             "Luka Doncic", "Alperen Sengun", "Amen Thompson"]
    print(f"{season}  skill percentiles (0-100)\n")
    print(f"{'player':26}" + "".join(f"{s[:9]:>10}" for s in show) + "   impact")
    for want in names:
        pid = next((i for i, n in blk.items() if n == want), None)
        if not pid or pid not in S:
            print(f"  {want:24} — not found"); continue
        r = S[pid]
        row = "".join(f"{r['s'][s].get('vs', r['s'][s]['v']):10.0f}" if s in r["s"] else f"{'—':>10}" for s in show)
        print(f"{want[:26]:26}{row}   {r['impact']}")
    print("\nshrinkage at work — biggest raw -> shrunk corrections this season:")
    moves = []
    for i, r in S.items():
        if i not in blk: continue
        for k, v in r["s"].items():
            if "vs" in v:
                moves.append((abs(v["vs"] - v["v"]), blk[i], k, v["v"], v["vs"], v["conf"], v["cover"]))
    moves.sort(reverse=True)
    for d, n, k, a, b, c, cv in moves[:8]:
        print(f"    {n[:22]:22} {k:16} {a:5.0f} -> {b:5.0f}   conf {c:.2f} cover {cv:.2f}")
    print("\nself-creation sanity (was broken by `selfcr`):")
    for want in ["Rudy Gobert", "Luka Doncic", "Shai Gilgeous-Alexander", "Nikola Jokic"]:
        pid = next((i for i, n in blk.items() if n == want), None)
        r = S.get(pid, {}).get("s", {})
        sc = r.get("self_creation", {}); cd = r.get("contested_diet", {})
        print(f"    {want:26} self_creation {sc.get('vs', '—'):>6}   contested_diet {cd.get('vs', '—'):>6}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    {"build": cmd_build, "check": cmd_check}[cmd]()
