"""
threat_check.py — threat.py's math on a league small enough to do by hand: three offensive
players (A, B, C, 1,000 minutes each, so all in the 500-minute pool) and one defender D.
Prints "ok" or fails an assertion. Run by tools/savant-mtchc/check.mjs (npm run check:savant).

The league (2023-24, so no gravity):
              pts    ts    tsa   ast potast astpts75 top75  obpm
    A  scorer  30   .600  1500   10    5      4       2      4
    B  creator 20   .580  1000   30   15     12       6      2
    C  role    10   .520   500   20   10      8       4     -3

By hand, a = sqrt(3/2) = 1.22474 (the z of the top of three evenly spaced values, population SD):
  league TS% = (1500 x .60 + 1000 x .58 + 500 x .52) / 3000 = .580
  pae = pts x (ts - .580) = (+0.6, 0, -0.6)        -> z (a, 0, -a), as pts      -> Scoring (a, 0, -a)
  every creation input ranks B > C > A evenly      -> z (-a, a, 0)              -> Creation (-a, a, 0)
  obpm (4, 2, -3): mean 1, SD sqrt(26/3)           -> z (1.01905, 0.33968, -1.35873)
  Overall net of Scoring: b = sum(s x o) / sum(s^2) = 0.97073; residual = o - b x s
           = (-0.16985, 0.33968, -0.16985) = 0.16985 x (-1, 2, -1); re-standardised
           -> Overall (-1/sqrt2, sqrt2, -1/sqrt2) = (-0.70711, 1.41421, -0.70711)
  shrink at 1,000 minutes: score 1000/1251 = 0.79936, create 1000/1084 = 0.92251,
           overall 1000/1316 = 0.75988
  threat = mean of the shrunk parts:
    A (0.97900 - 1.12984 - 0.53732) / 3 = -0.22939
    B (0       + 1.12984 + 1.07464) / 3 =  0.73483
    C (-0.97900 + 0      - 0.53732) / 3 = -0.50544
D guarded A for 100 matchup possessions, B for 300, C for 600:
    mtchc         (100 x -0.22939 + 300 x 0.73483 + 600 x -0.50544) / 1000 = -0.10577
    mtchc_score   (100 x 0.97900 + 0 + 600 x -0.97900) / 1000             = -0.48950
    mtchc_create  (100 x -1.12984 + 300 x 1.12984 + 0) / 1000             =  0.22597
    mtchc_overall (100 x -0.53732 + 300 x 1.07464 + 600 x -0.53732) / 1000 = -0.05373
    and mtchc = mean of the three parts, n = 1,000.
In 2024-25 time of possession is left out: the three other creation inputs rank the same way,
so a garbage top75 must change nothing.
"""
import math
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
import threat as T  # noqa: E402

T.MIN_RECIPE = 1          # three players: let the per-recipe scaling and the regression run

LEAGUE = {
    "A": dict(pts=30, ts=0.60, tsa=1500, ast=10, potast=5, astpts75=4, top75=2, obpm=4),
    "B": dict(pts=20, ts=0.58, tsa=1000, ast=30, potast=15, astpts75=12, top75=6, obpm=2),
    "C": dict(pts=10, ts=0.52, tsa=500, ast=20, potast=10, astpts75=8, top75=4, obpm=-3),
}


def rows(top75=None):
    out = {}
    for pid, x in LEAGUE.items():
        v = {k: x[k] for k in ("pts", "ts", "ast", "potast", "astpts75", "top75", "obpm")}
        v.update(gravonp=None, gravoni=None)
        if top75:
            v["top75"] = top75[pid]
        out[pid] = {"min": 1000, "pos": "Wing", "tsa": x["tsa"], "v": v}
    return out


def near(a, b, tol=1e-4, what=""):
    assert abs(a - b) < tol, f"{what}: {a:.6f} != {b:.6f}"


a = math.sqrt(1.5)
assert abs(T.league_ts(rows()) - 0.58) < 1e-12, "league TS%"
P, rec = T.parts_table(rows(), "2023-24", 500)
for pid, (s, c, o) in {"A": (a, -a, -1 / math.sqrt(2)), "B": (0, a, math.sqrt(2)), "C": (-a, 0, -1 / math.sqrt(2))}.items():
    near(P[pid]["score"], s, what=f"{pid} Scoring")
    near(P[pid]["create"], c, what=f"{pid} Creation")
    near(P[pid]["overall"], o, what=f"{pid} Overall net of Scoring")
near(rec["overall_on_score"], 0.97073, what="Overall on Scoring slope")

Tt, _ = T.threat_table(rows(), "2023-24", 500)
for pid, t in {"A": -0.22939, "B": 0.73483, "C": -0.50544}.items():
    near(Tt[pid]["threat"], t, what=f"{pid} threat")
near(Tt["A"]["score"], a * 1000 / 1251, what="A Scoring shrunk by 1000 / (1000 + 251)")

D = T.defender_table([("D", "A", 100), ("D", "B", 300), ("D", "C", 600)], Tt)["D"]
for k, v in {"mtchc": -0.10577, "mtchc_score": -0.48950, "mtchc_create": 0.22597, "mtchc_overall": -0.05373}.items():
    near(D[k], v, what=k)
near(D["mtchc"], (D["mtchc_score"] + D["mtchc_create"] + D["mtchc_overall"]) / 3, 1e-12, "mtchc = mean of its parts")
assert D["n"] == 1000

# an assignment with no threat row counts at the league mean and still counts toward the sample
D2 = T.defender_table([("D", "A", 100), ("D", "B", 300), ("D", "C", 600), ("D", "nobody", 1000)], Tt)["D"]
near(D2["mtchc"], -0.10577 / 2, what="unknown assignment at 0")
assert D2["n"] == 2000

# 2024-25: time of possession left out, so nonsense in it changes nothing
T25, _ = T.threat_table(rows(top75={"A": 900, "B": -50, "C": 3}), "2024-25", 500)
for pid in LEAGUE:
    near(T25[pid]["threat"], Tt[pid]["threat"], 1e-9, f"{pid} 2024-25 without top75")

# the equal-weight comparison keeps Overall as OBPM's z
Pe, _ = T.parts_table(rows(), "2023-24", 500, overall_mode="equal")
near(Pe["A"]["overall"], 1.01905, what="equal-weight Overall = OBPM z")

# apply_season writes all four keys, season-only, on the engine's player dicts
players = [{"id": pid, "pos": "Wing", "m": {
    "minshare": {"season": {"v": 0, "n": 1000}}, "ts": {"season": {"v": x["ts"], "n": x["tsa"]}},
    **{k: {"season": {"v": x[k], "n": 1}} for k in ("pts", "ast", "potast", "obpm")}}} for pid, x in LEAGUE.items()]
players.append({"id": "D", "pos": "Guard", "m": {"minshare": {"season": {"v": 0, "n": 0}}}})
ext = {pid: {k: LEAGUE[pid][k] for k in ("astpts75", "top75")} for pid in LEAGUE}
n = T.apply_season("2023-24", players, [("D", "A", 100), ("D", "B", 300), ("D", "C", 600)], ext=ext,
                   windows=("season", "l10"))
assert n == 1
d = players[-1]["m"]
assert d["mtchc"]["season"] == d["mtchc"]["l10"] == {"v": -0.106, "n": 1000}, d["mtchc"]
assert T.apply_season("2016-17", players, [("D", "A", 100)]) == 0, "nothing before 2017-18"
print("ok")
