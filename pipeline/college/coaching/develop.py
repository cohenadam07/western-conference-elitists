"""
develop.py — do players get better under him? (spec §4 E, build step 5)

    python3 develop.py           -> <CBCS_OUT>/develop.json

For every player with Savant rates in two consecutive seasons (any D1 teams), the change in rate
(points per 100 over his own possessions) is set against D1's expected change for the same class
step (Fr→So, So→Jr, Jr→Sr, Sr→Gr and the rest) and the same starting level: one fitted line per
class step, Δ = a + b × last season's rate, weighted by min(minutes in both seasons). The residual
is credited to the coach he played the second season for. Ages are not used: the only free source of
college birthdates on file is excluded by ground rule 4, so the class step stands in for age.

The check (step 5): residuals sum to about zero across D1, weighted, overall and in every season pair.
Caveats carried to the page: selection (a coach plays the men who improve), regression to the mean
(the line takes it out on average, not for every roster) and the strength staff, which no data sees.
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rosters as RS  # noqa: E402

OUT = RS.OUT
CLS = {"Fr": 1, "So": 2, "Jr": 3, "Sr": 4, "Gr": 5}
MIN_MIN = 100.0           # minutes in each season to count a pair


def step(a, b):
    ca, cb = CLS.get(a), CLS.get(b)
    if ca is None or cb is None:
        return "other"
    if cb == ca + 1:
        return f"{a}-{b}"
    return "other"


def pairs(R):
    idx = {}
    for s, teams in R["seasons"].items():
        for t, rows in teams.items():
            for r in rows:
                idx[(s, r["eid"])] = (t, r)
    out = []
    for s, teams in R["seasons"].items():
        ps = RS.season_label(RS.year_of(s) - 1)
        if ps not in R["seasons"]:
            continue
        for t, rows in teams.items():
            for r in rows:
                hit = idx.get((ps, r["eid"]))
                if not hit:
                    continue
                pt, p = hit
                if r["rate"] is None or p["rate"] is None or (r["min"] or 0) < MIN_MIN or (p["min"] or 0) < MIN_MIN:
                    continue
                out.append(dict(season=s, team=t, prev_team=pt, eid=r["eid"], name=r["name"], step=step(p["cls"], r["cls"]),
                                r0=p["rate"], r1=r["rate"], w=min(r["min"], p["min"]), src=r["src"], arrived=arrival(R, s, t, r)))
    return out


def arrival(R, s, t, r):
    """How he arrived at this team: walk back to his first season here."""
    y = RS.year_of(s)
    src = r["src"]
    while src == "returning":
        y -= 1
        ps = RS.season_label(y)
        prev = next((x for x in R["seasons"].get(ps, {}).get(t, []) if x["eid"] == r["eid"]), None)
        if not prev:
            return "unknown"
        src = prev["src"]
    return src


def fit(P):
    lines = {}
    for st in sorted({p["step"] for p in P}):
        v = [p for p in P if p["step"] == st]
        X = np.column_stack([np.ones(len(v)), [p["r0"] for p in v]])
        y = np.array([p["r1"] - p["r0"] for p in v])
        w = np.sqrt([p["w"] for p in v])
        b, *_ = np.linalg.lstsq(X * w[:, None], y * w, rcond=None)
        lines[st] = [float(b[0]), float(b[1]), len(v)]
    return lines


def run(log=print):
    R = RS.load()
    P = pairs(R)
    lines = fit(P)
    for p in P:
        a, b, _ = lines[p["step"]]
        p["exp"] = a + b * p["r0"]
        p["res"] = (p["r1"] - p["r0"]) - p["exp"]
    # a season-pair step: league-wide shifts (the 2020-21 extra year of eligibility moved 2021-22 by
    # about half a point) are nobody's coaching, so each pair's weighted mean residual is taken out
    sm = defaultdict(lambda: [0.0, 0.0])
    for p in P:
        sm[p["season"]][0] += p["w"] * p["res"]; sm[p["season"]][1] += p["w"]
    shift = {k: v[0] / v[1] for k, v in sm.items()}
    for p in P:
        p["exp"] += shift[p["season"]]
        p["res"] -= shift[p["season"]]
    W = sum(p["w"] for p in P)
    total = sum(p["w"] * p["res"] for p in P) / W
    by_season = defaultdict(lambda: [0.0, 0.0, 0])
    for p in P:
        x = by_season[p["season"]]
        x[0] += p["w"] * p["res"]; x[1] += p["w"]; x[2] += 1
    season_means = {s: round(v[0] / v[1], 4) for s, v in sorted(by_season.items())}
    out = defaultdict(lambda: dict(players=[], acc=defaultdict(lambda: [0.0, 0.0])))
    for p in P:
        k = f"{p['season']}|{p['team']}"
        e = out[k]
        e["players"].append([p["eid"], p["name"], p["step"], round(p["r0"], 2), round(p["r1"], 2), round(p["exp"], 2), round(p["res"], 2), round(p["w"]), p["arrived"], p["prev_team"] if p["prev_team"] != p["team"] else None])
        for g, ok in (("dev", True), ("dev_young", p["step"] in ("Fr-So", "So-Jr")), ("dev_hs", p["arrived"] == "hs"),
                      ("dev_tr", p["arrived"] == "transfer" and p["prev_team"] == p["team"])):
            if ok:
                e["acc"][g][0] += p["w"] * p["res"]; e["acc"][g][1] += p["w"]
    res = {}
    for k, e in out.items():
        res[k] = dict(players=sorted(e["players"], key=lambda x: -x[7]),
                      **{g: [round(v[0] / v[1], 3), round(v[1])] for g, v in e["acc"].items() if v[1]})
    check = dict(season_shift={k: round(v, 3) for k, v in sorted(shift.items())}, pairs=len(P), weighted_mean_residual=round(total, 5), by_season=season_means,
                 max_abs_season=round(max(abs(v) for v in season_means.values()), 4),
                 passes=abs(total) < 0.05 and max(abs(v) for v in season_means.values()) < 0.5)
    json.dump(dict(teams=res, lines={k: [round(a, 4), round(b, 4), n] for k, (a, b, n) in lines.items()}, check=check),
              open(os.path.join(OUT, "develop.json"), "w"))
    log(f"development: {json.dumps(check)}; lines {json.dumps({k: [round(a, 2), round(b, 3), n] for k, (a, b, n) in lines.items()})}")
    return res, check


def load():
    return json.load(open(os.path.join(OUT, "develop.json")))


if __name__ == "__main__":
    run()
