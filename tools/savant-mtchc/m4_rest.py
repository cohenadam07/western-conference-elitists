"""Module 4, sections 3-5: top 25s and the watch list; defensive value controlling for team
defense; positions. Writes reports/m4_3.md, m4_4.md, m4_5.md and prints the summaries."""
import json, os
import numpy as np
import pandas as pd
from common import table, PUB

THR = 560
df = table()
S = df[df.q & (df.n >= THR)].copy()
S["rk_c"] = S.groupby("season").mtchc.rank(ascending=False).astype(int)
S["rk_m"] = S.groupby("season").mtch.rank(ascending=False, method="min").astype(int)
S["N"] = S.groupby("season").pid.transform("size")
fin = S[S.season < "2026-27"].copy()

# ---------------------------------------------------------------- 3. top 25s and watch list
o = ["## 3. Top 25 defenders each season, with mtch rank\n",
     f"Qualified, over {THR} matchup possessions. Value = average threat of the men he guarded; pct = league / position percentile.\n"]
for s, g in S.groupby("season"):
    o.append(f"\n**{s}** ({len(g)} defenders{'; to date' if s == '2026-27' else ''})\n")
    o.append("| # | defender | team | pos | mtchc | lg / pos pct | Scoring / Creation pct | mtch rank |\n|---|---|---|---|---|---|---|---|")
    for r in g.sort_values("rk_c").head(25).itertuples():
        o.append(f"| {r.rk_c} | {r.name} | {r.team} | {r.pos} | {r.mtchc:+.2f} | {r.mtchc_lg} / {r.mtchc_pos} | {r.mtchc_score_lg} / {r.mtchc_create_lg} | {r.rk_m} |")
WATCH = ["Luguentz Dort", "Jaden McDaniels", "Herbert Jones", "Alex Caruso", "Jrue Holiday", "Dillon Brooks",
         "Marcus Smart", "Mikal Bridges", "OG Anunoby", "Derrick White", "Matisse Thybulle", "Amen Thompson",
         "Jaylen Wells", "Toumani Camara"]
o.append("\n### Watch list: mtchc rank / mtch rank (of the season's qualified defenders), every season he qualifies\n")
seas = sorted(S.season.unique())
o.append("| defender | " + " | ".join(seas) + " |\n|---|" + "---|" * len(seas))
miss = [n for n in WATCH if n not in set(S.name)]
for n in WATCH:
    cells = []
    for s in seas:
        r = S[(S.name == n) & (S.season == s)]
        cells.append(f"{r.rk_c.iloc[0]} / {r.rk_m.iloc[0]}" if len(r) else "")
    o.append(f"| {n} | " + " | ".join(cells) + " |")
if miss:
    o.append(f"\nNot found under these names: {miss}")
open(os.path.join("reports", "m4_3.md"), "w").write("\n".join(o) + "\n")
W = S[S.name.isin(WATCH)]
print(f"watch list: {W.pid.nunique()} found, {len(W)} player-seasons; median mtchc rank {W.rk_c.median():.0f}, median mtch rank {W.rk_m.median():.0f}; "
      f"in the season's top 25: mtchc {(W.rk_c <= 25).sum()}, mtch {(W.rk_m <= 25).sum()}; top 50: mtchc {(W.rk_c <= 50).sum()}, mtch {(W.rk_m <= 50).sum()}")

# ---------------------------------------------------------------- 4. defensive value
T = json.load(open(os.path.join(PUB, "savant-teams.json")))
dr = {}
for s, sd in T["data"].items():
    lg = sd["lg"]["ortg"]
    for t in sd["teams"]:
        dr[(s, t["abbr"])] = t["drtg"] - lg
fin["tdr"] = [dr.get((s, t)) for s, t in zip(fin.season, fin.team)]

def wls(y, X, w):
    sw = np.sqrt(w)
    b, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    r = y - X @ b
    ybar = np.average(y, weights=w)
    return 1 - np.sum(w * r ** 2) / np.sum(w * (y - ybar) ** 2), r

def fit(d, target, stats, fe):
    d = d.dropna(subset=[target] + stats + ([] if fe else ["tdr"]))
    w = d["min"].to_numpy(float)
    y = d[target].to_numpy(float)
    if fe:
        C = pd.get_dummies(d.season + "|" + d.team.fillna("?")).to_numpy(float)
    else:
        C = np.column_stack([np.ones(len(d)), d.tdr.to_numpy(float)])
    r0, ry = wls(y, C, w)
    res = {"n": len(d)}
    for st in stats:
        x = d[st].to_numpy(float)
        _, rx = wls(x, C, w)
        res["r_" + st] = np.sum(w * rx * ry) / np.sqrt(np.sum(w * rx ** 2) * np.sum(w * ry ** 2))
        r1, _ = wls(y, np.column_stack([C, x]), w)
        res["dR2_" + st] = r1 - r0
    rb, _ = wls(y, np.column_stack([C] + [d[st].to_numpy(float) for st in ("mtch", "mtchc")]), w)
    res["dR2_both"] = rb - r0
    res["R2_controls"] = r0
    return res

STATS = ["mtch", "mtchc", "mtchc_equal", "mtchc_score", "mtchc_create"]
TARGETS = [("dbpm", "D-BPM", fin), ("onoffd", "On/Off DRtg (lower is better)", fin),
           ("levd", "Leverage: defense", fin[fin.season == "2025-26"]), ("levob", "Leverage: on-ball D", fin[fin.season == "2025-26"])]
o = ["## 4. Does it track defensive value better than mtch, controlling for team defense?\n",
     "Minutes-weighted least squares. Model A: target ~ stat + team DRtg (relative to league; team table covers 2018-19 on). "
     "Model B: target ~ stat + a fixed effect for every team-season (2017-18 on). Partial r: the stat's correlation with the target "
     "once the controls are taken out of both. dR2: R-squared added over the controls alone. Both: mtch and mtchc together.\n",
     "A high number means coaches give this player hard jobs and he holds up, or that the box score credits whoever draws them. "
     "It does not show the stat measures defensive skill.\n"]
rows = []
for tgt, lab, d in TARGETS:
    for fe in (False, True):
        for pos in ("all", "Guard", "Wing", "Big"):
            dd = d if pos == "all" else d[d.pos == pos]
            r = fit(dd, tgt, STATS, fe)
            rows.append(dict(target=lab, model="B team-season FE" if fe else "A team DRtg", pos=pos, **r))
R = pd.DataFrame(rows)
o.append("| target | model | pos | n | partial r: mtch | mtchc | equal-wt | Scoring | Creation | dR2: mtch | mtchc | both |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in R.itertuples():
    o.append(f"| {r.target} | {r.model} | {r.pos} | {r.n} | {r.r_mtch:+.2f} | {r.r_mtchc:+.2f} | {r.r_mtchc_equal:+.2f} | {r.r_mtchc_score:+.2f} | {r.r_mtchc_create:+.2f} | {r.dR2_mtch:.3f} | {r.dR2_mtchc:.3f} | {r.dR2_both:.3f} |")
unmatched = fin[(fin.season >= "2018-19") & fin.tdr.isna()]
o.append(f"\nTeam DRtg not found for {len(unmatched)} defender-seasons (team label {sorted(unmatched.team.dropna().unique())[:8]}); they sit out model A only.")
open("reports/m4_4.md", "w").write("\n".join(o) + "\n")
pd.set_option("display.width", 220)
print(R[["target", "model", "pos", "n", "r_mtch", "r_mtchc", "r_mtchc_equal", "r_mtchc_score", "r_mtchc_create", "dR2_mtch", "dR2_mtchc", "dR2_both"]].round(3).to_string(index=False))

# ---------------------------------------------------------------- 5. positions
o = ["## 5. By position\n", f"Qualified, over {THR}, 2017-18 to 2025-26.\n",
     "| pos | n | mtchc p25 / median / p75 | Scoring part | Creation part | mtch p25 / median / p75 | mean league pct, mtchc | mtch | change |\n|---|---|---|---|---|---|---|---|---|"]
for p, g in fin.groupby("pos"):
    q = lambda c, f="+.2f": " / ".join(format(g[c].quantile(x), f) for x in (.25, .5, .75))
    o.append(f"| {p} | {len(g)} | {q('mtchc')} | {q('mtchc_score')} | {q('mtchc_create')} | {q('mtch', '.1f')} | {g.mtchc_lg.mean():.0f} | {g.mtch_lg.mean():.0f} | {g.mtchc_lg.mean() - g.mtch_lg.mean():+.0f} |")
s = fin[fin.season == "2025-26"]
for p, g in s.groupby("pos"):
    g = g.sort_values("mtchc", ascending=False)
    o.append(f"\n2025-26 {p}s, top 5 by position percentile: " + ", ".join(f"{r.name} ({r.mtchc_pos}, league {r.mtchc_lg})" for r in g.head(5).itertuples())
             + "; bottom 3: " + ", ".join(f"{r.name} ({r.mtchc_pos})" for r in g.tail(3).itertuples()))
open("reports/m4_5.md", "w").write("\n".join(o) + "\n")
print("\n".join(o[2:]))
