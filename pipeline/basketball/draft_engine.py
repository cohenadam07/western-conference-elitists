"""
draft_engine.py — lottery, prospects, scouting fog and the draft itself.

The scouting fog is CALIBRATED, not invented. Running the trajectory model's
leave-one-draft-out predictions against real outcomes for 479 prospects:

    correlation(model prediction, actual outcome)   = +0.537
    correlation(real NBA draft order, actual outcome) = 0.497

So the model, out of sample, is slightly better than the league's collective judgment —
and 0.54 is therefore what "excellent scouting" looks like in this game. Not 0.9. A top-
quintile prospect still busts 21% of the time, and that number comes from the data rather
than from a difficulty setting.

Usage:
  python draft_engine.py lottery      # verify the odds reproduce
  python draft_engine.py scouting     # verify the fog is calibrated
  python draft_engine.py draft        # run a draft
  python draft_engine.py test
"""
import json, sys, math, random, collections, statistics as st

OUT = "out"

# 2019-onward flattened lottery odds, by reverse-standings seed (1 = worst record).
LOTTERY_ODDS = [14.0, 14.0, 14.0, 12.5, 10.5, 9.0, 7.5, 6.0, 4.5, 3.0, 2.0, 1.5, 1.0, 0.5]

# Outcome buckets, and what each is worth in the currency the rest of the game uses.
# Anchored on the empirical pick curve: pick 1 returns ~8.5 four-year VORP, pick 30 ~1.4.
# Base rates are the OBSERVED distribution across the 479 drafted prospects in
# trajectory/data/curated/outcomes.csv, not a guess: Fringe 54.3%, Rotation 24.2%,
# Starter 13.6%, Star 7.9%. An earlier version tilted bucket odds by exp(2.2z), which
# produced a league where 21% of drafted players became stars.
BUCKETS = {
    "Star":     dict(p_base=0.079, vorp4=(6.0, 2.5)),
    "Starter":  dict(p_base=0.136, vorp4=(2.6, 1.1)),
    "Rotation": dict(p_base=0.242, vorp4=(0.9, 0.5)),
    "Fringe":   dict(p_base=0.543, vorp4=(0.1, 0.2)),
}
ORDER = ["Star", "Starter", "Rotation", "Fringe"]
TALENT_LOAD = 0.9      # how much of the outcome talent explains; the rest is chance

# Measured from the trajectory model's out-of-sample quintiles.
SCOUT_CORR_ELITE = 0.54       # a top scouting department == the model == better than the NBA
SCOUT_CORR_POOR = 0.28


# ---------------------------------------------------------------------- lottery

def run_lottery(seeds, rng):
    """seeds: teams ordered worst record first. Returns the 14 lottery slots.

    Four picks are drawn by weighted combination; the rest fall by record. This is the
    real structure, and it is why the worst team lands at 5th more often than at 1st.
    """
    pool = list(seeds[:14])
    odds = dict(zip(pool, LOTTERY_ODDS[:len(pool)]))
    winners = []
    for _ in range(4):
        tot = sum(odds[t] for t in pool)
        r, acc = rng.random() * tot, 0.0
        for t in pool:
            acc += odds[t]
            if acc >= r:
                winners.append(t); pool.remove(t); break
    return winners + pool + list(seeds[14:])


# -------------------------------------------------------------------- prospects

def generate_class(rng, n=60, year=2027):
    """A draft class with HIDDEN true outcomes.

    Each prospect gets a latent quality, a true bucket sampled from it, and a true
    four-year VORP. Nothing here is ever shown to the user — he sees scouting estimates.
    """
    # Ordered probit. An outcome latent u = load*talent + chance crosses thresholds set
    # from the real base rates, which guarantees the marginal distribution comes out right
    # however the talent is drawn — the previous multiplicative tilt did not.
    s = math.sqrt(TALENT_LOAD ** 2 + 1.0)
    cum, thr = 0.0, {}
    for k in ("Fringe", "Rotation", "Starter"):
        cum += BUCKETS[k]["p_base"]
        thr[k] = s * _probit(cum)
    ps = []
    for i in range(n):
        z = rng.gauss(0, 1)
        u = TALENT_LOAD * z + rng.gauss(0, 1)
        bucket = ("Fringe" if u < thr["Fringe"] else
                  "Rotation" if u < thr["Rotation"] else
                  "Starter" if u < thr["Starter"] else "Star")
        mu, sd = BUCKETS[bucket]["vorp4"]
        ps.append({
            "id": f"{year}-{i:02d}", "name": f"Prospect {year}-{i:02d}",
            "age": round(rng.gauss(19.6, 1.1), 1),
            "_z": z, "_u": u, "_bucket": bucket,
            "_vorp4": max(-0.4, rng.gauss(mu, sd)),
        })
    return ps


def _probit(p):
    """Inverse normal CDF (Acklam), so thresholds can be set from real base rates."""
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    pl, ph = 0.02425, 1 - 0.02425
    if p < pl:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > ph:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5; r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def scout(prospects, rng, quality=SCOUT_CORR_ELITE):
    """Add a scouting estimate whose correlation with truth is `quality`.

    Implemented as truth plus correlated noise, so the department's accuracy is a single
    interpretable dial: 0.54 is as good as the best public model and better than the real
    NBA draft; 0.28 is a department worth firing.
    """
    for p in prospects:
        # correlate with the OUTCOME latent, not with raw talent — the measured 0.537 is
        # "prediction vs what actually happened", so the dial must mean the same thing.
        u = p["_u"] / math.sqrt(TALENT_LOAD ** 2 + 1.0)
        p["scout"] = quality * u + math.sqrt(max(0.0, 1 - quality ** 2)) * rng.gauss(0, 1)
    # board rank is what the user actually sees
    for r, p in enumerate(sorted(prospects, key=lambda x: -x["scout"]), 1):
        p["board"] = r
    return prospects


# ----------------------------------------------------------------- the draft

def run_draft(teams, prospects, rng, user=None, scout_quality=None):
    """Two rounds. Every AI team drafts off its OWN noisy board, which is why the same
    class produces a different order every time and why reaching is a real thing."""
    boards = {}
    for t in teams:
        q = (scout_quality or {}).get(t, rng.uniform(SCOUT_CORR_POOR, SCOUT_CORR_ELITE))
        ps = [dict(p) for p in prospects]
        scout(ps, rng, q)
        boards[t] = {p["id"]: p["scout"] for p in ps}
    taken, picks = set(), []
    order = list(teams)
    for rnd in range(2):
        for slot, t in enumerate(order, 1):
            avail = [p for p in prospects if p["id"] not in taken]
            if not avail:
                break
            best = max(avail, key=lambda p: boards[t][p["id"]])
            taken.add(best["id"])
            picks.append({"round": rnd + 1, "pick": slot,
                          "overall": rnd * len(order) + slot,
                          "team": t, "prospect": best})
    return picks


def cmd_lottery():
    rng = random.Random(7)
    seeds = [f"T{i:02d}" for i in range(1, 31)]
    n = 20000
    got = collections.Counter()
    for _ in range(n):
        res = run_lottery(seeds, rng)
        got[(seeds[0], res.index(seeds[0]) + 1)] += 1
        for k in range(4):
            got[("first", res[0])] += 0
    first = collections.Counter()
    for _ in range(n):
        first[run_lottery(seeds, rng)[0]] += 1
    print(f"lottery — {n:,} simulations\n")
    print(f"{'seed':>6}{'won #1':>10}{'real odds':>12}")
    for i in range(14):
        t = seeds[i]
        print(f"  {i+1:4d}{first[t]/n:10.1%}{LOTTERY_ODDS[i]/100:12.1%}")
    worst = collections.Counter()
    for _ in range(n):
        worst[run_lottery(seeds, rng).index(seeds[0]) + 1] += 1
    print(f"\n  where the WORST team actually picks:")
    for slot in sorted(worst)[:6]:
        print(f"    {slot}: {worst[slot]/n:5.1%}")


def cmd_scouting():
    rng = random.Random(11)
    print("scouting fog, calibrated against the trajectory model's out-of-sample record\n")
    for q, tag in ((SCOUT_CORR_ELITE, "elite department (= the model, > the real NBA)"),
                   (0.40, "average department"),
                   (SCOUT_CORR_POOR, "poor department")):
        ps = generate_class(random.Random(3), 300)
        scout(ps, rng, q)
        top = sorted(ps, key=lambda p: -p["scout"])[:60]
        quint = []
        s = sorted(ps, key=lambda p: -p["scout"])
        for i in range(5):
            g = s[i * 60:(i + 1) * 60]
            quint.append(sum(1 for p in g if p["_bucket"] in ("Star", "Starter")) / len(g))
        corr = st.correlation([p["scout"] for p in ps], [p["_u"] for p in ps])
        bust = sum(1 for p in top[:20] if p["_bucket"] == "Fringe") / 20
        print(f"  {tag}")
        print(f"    realised correlation with truth : {corr:+.2f}  (target {q:+.2f})")
        print(f"    top-20 board bust rate          : {bust:.0%}   "
              f"(real top quintile: 21%)")
        print(f"    starter-or-better by board quintile: "
              f"{'  '.join(f'{x:.0%}' for x in quint)}")
        print()


def cmd_draft():
    rng = random.Random(5)
    seeds = [f"T{i:02d}" for i in range(1, 31)]
    order = run_lottery(seeds, rng)
    ps = generate_class(rng, 70)
    picks = run_draft(order, ps, rng)
    print(f"lottery order: {' '.join(order[:5])} ...\n")
    print(f"{'#':>3} {'team':6}{'age':>6}{'board':>7}{'TRUE outcome':>16}{'true 4yr VORP':>15}")
    for pk in picks[:14]:
        p = pk["prospect"]
        print(f"  {pk['overall']:2d} {pk['team']:6}{p['age']:6.1f}{p.get('board', 0):7d}"
              f"{p['_bucket']:>16}{p['_vorp4']:15.2f}")
    hit = [p["prospect"]["_bucket"] for p in picks[:14]]
    late = [p["prospect"]["_bucket"] for p in picks[30:60]]
    f = lambda g: sum(1 for b in g if b in ("Star", "Starter")) / max(1, len(g))
    print(f"\n  lottery starter-or-better: {f(hit):.0%}   second round: {f(late):.0%}")


def cmd_test():
    T = []
    rng = random.Random(2)
    seeds = [f"T{i:02d}" for i in range(1, 31)]

    n = 6000
    first = collections.Counter()
    for _ in range(n):
        first[run_lottery(seeds, rng)[0]] += 1
    err = max(abs(first[seeds[i]] / n - LOTTERY_ODDS[i] / 100) for i in range(14))
    T.append((err < 0.012, "lottery odds reproduce the real table",
              f"max error {err:.3f}"))

    slots = collections.Counter()
    for _ in range(n):
        slots[run_lottery(seeds, rng).index(seeds[0]) + 1] += 1
    T.append((slots[5] > slots[1], "the worst team picks 5th more often than 1st",
              f"5th {slots[5]/n:.0%} vs 1st {slots[1]/n:.0%}"))
    T.append((max(slots) == 5, "the worst team can never fall below 5th",
              f"worst outcome: {max(slots)}"))

    ps = generate_class(random.Random(8), 400)
    r = collections.Counter(p["_bucket"] for p in ps)
    T.append((r["Fringe"] > r["Star"] * 3, "busts vastly outnumber stars",
              f"{dict(r)}"))

    sc = scout([dict(p) for p in ps], random.Random(9), SCOUT_CORR_ELITE)
    corr = st.correlation([p["scout"] for p in sc], [p["_u"] for p in sc])
    T.append((abs(corr - SCOUT_CORR_ELITE) < 0.09,
              "elite scouting hits its calibrated accuracy",
              f"{corr:+.2f} vs target {SCOUT_CORR_ELITE:+.2f}"))

    top20 = sorted(sc, key=lambda p: -p["scout"])[:20]
    bust = sum(1 for p in top20 if p["_bucket"] == "Fringe") / 20
    T.append((0.05 <= bust <= 0.45, "even the best board busts at a realistic rate",
              f"{bust:.0%} (real top quintile 21%)"))

    good = scout([dict(p) for p in ps], random.Random(10), SCOUT_CORR_ELITE)
    poor = scout([dict(p) for p in ps], random.Random(10), SCOUT_CORR_POOR)
    gv = st.mean([p["_vorp4"] for p in sorted(good, key=lambda p: -p["scout"])[:20]])
    pv = st.mean([p["_vorp4"] for p in sorted(poor, key=lambda p: -p["scout"])[:20]])
    T.append((gv > pv, "better scouting drafts better players",
              f"top-20 true VORP {gv:.2f} vs {pv:.2f}"))

    order = run_lottery(seeds, random.Random(1))
    cls = generate_class(random.Random(4), 70)
    d1 = run_draft(order, cls, random.Random(1))
    d2 = run_draft(order, cls, random.Random(2))
    same = sum(1 for a, b in zip(d1, d2) if a["prospect"]["id"] == b["prospect"]["id"])
    T.append((same < len(d1) * 0.75, "the same class drafts differently each time",
              f"{same}/{len(d1)} picks identical"))

    lot = [p["prospect"]["_vorp4"] for p in d1[:14]]
    two = [p["prospect"]["_vorp4"] for p in d1[30:]]
    T.append((st.mean(lot) > st.mean(two), "lottery picks outproduce second-rounders",
              f"{st.mean(lot):.2f} vs {st.mean(two):.2f}"))

    ok = sum(1 for c, _, _ in T if c)
    print(f"draft engine — {ok}/{len(T)} behaviours correct\n")
    for good_, name, detail in T:
        print(f"  {'PASS' if good_ else 'FAIL'}  {name}")
        print(f"        {detail}")
    return ok == len(T)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "test"
    {"lottery": cmd_lottery, "scouting": cmd_scouting,
     "draft": cmd_draft, "test": cmd_test}[cmd]()
