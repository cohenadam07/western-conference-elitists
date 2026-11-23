"""
test_shape.py — what the All-Savant Team would be under the NBA's own positional rules by era
(Adam's proposal, Nov 19 2026; report only, nothing on the site changes).

  through 2022-23  2 guards, 2 forwards, 1 center. Eligibility from Basketball Reference's
                   5-position estimate (the panel behind the Oct 30 relabel, 1996-97 on): guard =
                   PG+SG share, forward = SF+PF, center = C, eligible where the share >= cutoff.
                   Before 1996-97 (no estimate) and for anyone without one: BR's listed position
                   for the season ("PF-C" = forward and center).
                   Each team maximizes total Savant value over the five slots (an assignment
                   problem), qualified players only; 1st team first, the 2nd from everyone left.
  2023-24 on       positionless: the top five by Savant value, then the next five.

    cd ~/Basketball-Savant && python3 <repo>/research/all-savant-positions/test_shape.py <vals.json>
"""
import glob, gzip, json, os, re, sys
from collections import Counter
import numpy as np
from scipy.optimize import linear_sum_assignment

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "pipeline", "basketball"))
V = json.load(open(sys.argv[1]))
POSITIONLESS = "2023-24"
SEASONS = sorted(V)


def pe_of(season):
    f = os.path.join(REPO, "public", "savant-ext", "panels", f"{season}.json")
    if not os.path.exists(f):
        return {}
    return {int(k): v["pe"] for k, v in json.load(open(f))["players"].items() if v.get("pe")}


_BR = {}
def listed(season, br):
    y = int(season[:4]) + 1
    if y not in _BR:
        import br_fetch
        try:
            _BR[y] = {k: (r.get("pos") or "") for k, r in br_fetch.load_season(y).items()}
        except Exception:
            _BR[y] = {}
    return _BR[y].get(br, "")


def eligible(season, p, pe, cut):
    """{'G','F','C'} he can fill; and where it came from."""
    s = pe.get(p["id"])
    if s and sum(s) > 0:
        g, f, c = s[0] + s[1], s[2] + s[3], s[4]
        out = {k for k, v in (("G", g), ("F", f), ("C", c)) if v >= cut}
        if cut is None or not out:
            out = {max((("G", g), ("F", f), ("C", c)), key=lambda kv: kv[1])[0]}
        return out, "estimate"
    lp = listed(season, p.get("br"))
    toks = set(re.findall(r"PG|SG|SF|PF|G|F|C", lp))
    out = set()
    if toks & {"PG", "SG", "G"}: out.add("G")
    if toks & {"SF", "PF", "F"}: out.add("F")
    if "C" in toks: out.add("C")
    if not out:
        out = {"G" if p["label"] == "Guard" else "C" if p["label"] == "Big" else "F"}
    return out, "listed"


def primary(season, p, pe):
    s = pe.get(p["id"])
    if s and sum(s) > 0:
        g, f, c = s[0] + s[1], s[2] + s[3], s[4]
        return {max((("G", g), ("F", f), ("C", c)), key=lambda kv: kv[1])[0]}
    e, _ = eligible(season, p, pe, 30)
    return {sorted(e)[0]} if len(e) == 1 else e


SLOTS = ["G", "G", "F", "F", "C"]


def best_team(pool, elig):
    """Max total value over 2G/2F/1C; pool = qualified players with a value, sorted by value."""
    cand = pool[:60]
    M = np.full((len(cand), 5), 1e6)
    for i, p in enumerate(cand):
        for j, sl in enumerate(SLOTS):
            if sl in elig[p["id"]]:
                M[i, j] = -p["value"]
    r, c = linear_sum_assignment(M)
    team = [(cand[i], SLOTS[j]) for i, j in zip(r, c) if M[i, j] < 1e5]
    return sorted(team, key=lambda x: SLOTS.index(x[1]))


def teams_for(season, cut, mode="cut"):
    ps = [p for p in V[season]["players"] if p["q"] and p["value"] is not None]
    ps.sort(key=lambda p: -p["value"])
    if season >= POSITIONLESS and mode != "force_positions":
        return [[(p, "") for p in ps[:5]], [(p, "") for p in ps[5:10]]], {}
    pe = pe_of(season)
    elig = {p["id"]: (primary(season, p, pe) if mode == "primary" else eligible(season, p, pe, cut)[0]) for p in ps}
    t1 = best_team(ps, elig)
    left = [p for p in ps if p["id"] not in {x["id"] for x, _ in t1}]
    t2 = best_team(left, elig)
    return [t1, t2], elig


def hits(teams_by_season, first="1988-89"):
    t = [0, 0, 0]
    for s, (t1, t2) in teams_by_season.items():
        if s < first:
            continue
        real = {p["id"]: p["real"] for p in V[s]["players"] if p["real"]}
        if not real:
            continue
        ids = [p["id"] for p, _ in t1 + t2]
        t[0] += sum(1 for i in ids if real.get(i) in ("allnba1", "allnba2")); t[1] += sum(1 for i in ids if i in real); t[2] += 1
    return 100 * t[0] / (10 * t[2]), 100 * t[1] / (10 * t[2]), t[2]


def current(s):
    byid = {p["id"]: p for p in V[s]["players"]}
    return [[(byid[i], "") for i in team] for team in V[s]["teams"]]


if __name__ == "__main__":
    cur = {s: current(s) for s in SEASONS}
    a, b, n = hits(cur)
    print(f"TODAY (2 guards / 2 wings / 1 big): real 1st/2nd {a:.1f}%, any All-NBA {b:.1f}% ({n} seasons, 1988-89 on)")
    print("\nCUTOFF SWEEP (positional through 2022-23, positionless from 2023-24):")
    res = {}
    for cut in (20, 25, 30, 35, 40, 50):
        T = {s: teams_for(s, cut)[0] for s in SEASONS}
        res[cut] = T
        a, b, n = hits(T)
        print(f"  {cut}%: real 1st/2nd {a:.1f}%, any {b:.1f}%")
    Tp = {s: teams_for(s, None, "primary")[0] for s in SEASONS}
    a, b, n = hits(Tp); print(f"  primary position only (largest share): real 1st/2nd {a:.1f}%, any {b:.1f}%")
    Tf = {s: teams_for(s, 30, "force_positions")[0] for s in SEASONS}
    a, b, n = hits({s: Tf[s] for s in SEASONS}); print(f"  30%, positional in every season (no positionless era): real 1st/2nd {a:.1f}%, any {b:.1f}%")
    json.dump({str(c): {s: [[[p["id"], sl] for p, sl in t] for t in T[s]] for s in SEASONS} for c, T in res.items()},
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "teams_by_cutoff.json"), "w"))
