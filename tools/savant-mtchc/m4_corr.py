"""Module 4, sections 1-2: mtchc against mtch (correlation, risers and fallers) and year to year."""
import sys
from collections import defaultdict
import pandas as pd
from common import table, build, matchups, SEASONS

THR = 560
df = table()
S = df[df.q & (df.n >= THR)].copy()
fin = S[S.season < "2026-27"]
out = []
w = out.append

w("## 1. Correlation with mtch\n")
w(f"Qualified defenders over {THR} matchup possessions. Pooled 2017-18 to 2025-26: n = {len(fin)}.\n")
w("| season | n | Pearson | Spearman | equal-weight Spearman |\n|---|---|---|---|---|")
for s, g in list(fin.groupby("season")) + [("pooled", fin), ("2026-27 to date", S[S.season == "2026-27"])]:
    w(f"| {s} | {len(g)} | {g.mtchc.corr(g.mtch):.2f} | {g.mtchc.corr(g.mtch, method='spearman'):.2f} | {g.mtchc_equal.corr(g.mtch, method='spearman'):.2f} |")
w("\nPooled across seasons the correlation also carries season-to-season shifts in league scoring (mtch is in PPG); the by-season rows are the cleaner read.\n")

s = "2025-26"
g = fin[fin.season == s].copy()
g["r_c"] = g.mtchc.rank(ascending=False)
g["r_m"] = g.mtch.rank(ascending=False)
g["d"] = g.r_m - g.r_c
_, Tt, meta = build(s)
by = defaultdict(list)
for d, o, wt in matchups(s):
    if wt > 0:
        by[d].append((wt, o))
pool = [o for o in Tt if meta.get(o, {}).get("q")]
top_c = set(sorted(pool, key=lambda o: Tt[o]["create"], reverse=True)[:50])
top_s = set(sorted(pool, key=lambda o: Tt[o]["score"], reverse=True)[:50])
def share(pid, grp):
    tot = sum(x for x, _ in by[pid])
    return 100 * sum(x for x, o in by[pid] if o in grp) / tot
lg_c = g.pid.map(lambda d: share(d, top_c)).mean()
lg_s = g.pid.map(lambda d: share(d, top_s)).mean()
def why(r):
    tot = sum(x for x, _ in by[r.pid])
    top = sorted(((x * Tt[o]["threat"], x, o) for x, o in by[r.pid] if o in Tt), reverse=True)[:3]
    who = ", ".join(f"{meta[o]['name']} ({100 * x / tot:.0f}%)" for _, x, o in top)
    return (f"{share(r.pid, top_c):.0f}% of his matchups on the top-50 creators (league {lg_c:.0f}%), "
            f"{share(r.pid, top_s):.0f}% on the top-50 scorers (league {lg_s:.0f}%); most threat from {who}")
for title, sub in (("rise most", g.sort_values("d", ascending=False).head(15)), ("fall most", g.sort_values("d").head(15))):
    w(f"\n**{s}: the 15 who {title} against mtch** (rank of {len(g)})\n")
    w("| defender | pos | mtch rank | mtchc rank | Creation / Scoring pct | why |\n|---|---|---|---|---|---|")
    for r in sub.itertuples():
        w(f"| {r.name} | {r.pos} | {int(r.r_m)} | {int(r.r_c)} | {r.mtchc_create_lg} / {r.mtchc_score_lg} | {why(r)} |")

w("\n## 2. Year-to-year stability\n")
w(f"Consecutive seasons, both qualified and over {THR}. Same team = the same team label both seasons.\n")
key = fin.set_index(["season", "pid"])
pairs = []
for a, b in zip(SEASONS[:-2], SEASONS[1:-1]):
    A = fin[fin.season == a].set_index("pid")
    B = fin[fin.season == b].set_index("pid")
    j = A.join(B, lsuffix="_a", rsuffix="_b", how="inner")
    j["same"] = j.team_a == j.team_b
    pairs.append(j)
J = pd.concat(pairs)
cols = [("mtchc", "mtchc"), ("mtch", "mtch"), ("mtchc_score", "Scoring part"), ("mtchc_create", "Creation part"),
        ("mtchc_overall", "Overall part"), ("mtchc_equal", "mtchc, equal weights")]
w("| stat | all (n) | same team (n) | changed team (n) |\n|---|---|---|---|")
for c, lab in cols:
    cell = lambda x: f"{x[c + '_a'].corr(x[c + '_b']):.2f} ({len(x)})"
    w(f"| {lab} | {cell(J)} | {cell(J[J.same])} | {cell(J[~J.same])} |")
print("\n".join(out))
