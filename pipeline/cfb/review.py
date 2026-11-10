"""BUILD section 10: the review list's numbers, written to research/cfb/out/review.md.

    python -m pipeline.cfb.review

Internal only. The AP comparison reads research/cfb/ap/ (fetched for this sanity check, never served): it
asks how many AP All-Americans each season are on one of our national teams, and gives the biggest
disagreements with a reason read off our own numbers. Offensive linemen are left out of the AP count,
since we pick the line as one unit.
"""
import gzip
import json
import numpy as np
import pandas as pd
from .paths import OUT, REPO, WORK
from . import config as C
from .identity import norm

PUB = REPO / "public" / "cfb"
AP_POS = {"QB": ["QB"], "RB": ["RB"], "WR": ["WR"], "TE": ["TE"], "K": ["K"], "P": ["P"], "PK": ["K"], "DL": ["EDGE", "IDL"],
          "DE": ["EDGE"], "DT": ["IDL"], "EDGE": ["EDGE"], "LB": ["LB"], "CB": ["CB"], "S": ["S"], "DB": ["CB", "S"],
          "AP": ["RB", "WR", "TE"], "KR": ["RB", "WR", "TE", "CB", "S"], "PR": ["RB", "WR", "TE", "CB", "S"]}


def jl(p):
    return json.loads(gzip.decompress((PUB / (p + ".gz")).read_bytes()))


def headshots():
    d = jl(f"s/{C.CURRENT}.json")
    rows = [(d["teams"][str(p[2])][2], p[12], p[7]) for p in d["players"]]
    x = pd.DataFrame(rows, columns=["conf", "head", "qual"])
    t = x.groupby("conf").agg(players=("head", "size"), with_photo=("head", "mean"), qualified=("qual", "sum"),
                              qualified_with_photo=("head", lambda s: s[x.loc[s.index, "qual"] == 1].mean()))
    lines = [f"### Headshot coverage, {C.CURRENT} graded players, by conference", "",
             "| conference | players | with an ESPN headshot | qualified players with one |", "|---|---:|---:|---:|"]
    for c, r in t.sort_values("with_photo").iterrows():
        lines.append(f"| {c} | {int(r.players)} | {r.with_photo:.0%} | {r.qualified_with_photo:.0%} |")
    lines.append(f"| **all FBS** | {len(x)} | {x['head'].mean():.0%} | {x[x.qual == 1]['head'].mean():.0%} |")
    lines += ["", "Everyone without one gets the initials badge in team colours; no broken image is possible because only ids "
              "ESPN answered 200 for are linked (pipeline/cfb/heads.py).", ""]
    return lines


def borderline():
    from .numbers import build
    from .state import load_state
    D = build(C.CURRENT, load_state())
    pl = D["players"].merge(D["positions"][["pid", "p_first"]].rename(columns={"p_first": "p"}), on="pid", how="left")
    pl["qual"] = D["qual"]
    b = pl[pl.inferred.fillna(False).astype(bool) & pl.qual & pl.p.notna()].assign(margin=lambda t: (t.p - 0.5).abs()).sort_values("margin").head(25)
    lines = [f"### Position borderline list, {C.CURRENT} (roster says only DL or DB; qualified players closest to the line)", "",
             "| player | school | roster | called | probability of edge (DL) or corner (DB) | weight |", "|---|---|---|---|---:|---:|"]
    for r in b.itertuples():
        lines.append(f"| {r.name} | {r.school} | {r.pos} | {r.slot} | {r.p:.2f} | {'' if pd.isna(r.weight) else int(r.weight)} |")
    return lines + [""]


def ap_overlap():
    lines = ["### AP All-America overlap (internal; AP picks are never shown or served)", "",
             "| season | AP All-Americans (no OL) | found in our data | on our 1st, 2nd or 3rd team | on our 1st team | biggest disagreements (AP pick: our rank at his position, why) |",
             "|---|---:|---:|---:|---:|---|"]
    tot = [0, 0, 0]
    for y in [s for s in C.SEASONS if s < C.CURRENT]:
        f = REPO / "research" / "cfb" / "ap" / f"ap_{y}.csv"
        if not f.exists():
            continue
        ap = pd.read_csv(f)
        ap = ap[~ap.position.isin(["OT", "OG", "OL", "C", "G", "T"])]
        d, A = jl(f"s/{y}.json"), jl(f"allsavant/{y}.json")
        P = pd.DataFrame(d["players"], columns=d.get("cols"))
        P["value"] = d["value"]["v"]
        P["school"] = [d["teams"][str(t)][0] for t in P.team]
        P["key"] = P.name.map(norm)
        P["rank"] = P[P.qual == 1].groupby("slot").value.rank(ascending=False, method="min")
        tier = {r["pid"]: int(t) for t in ("1", "2", "3") for r in A["national"][t] if r.get("pid")}
        found = on_any = on_first = 0
        miss = []
        for r in ap.itertuples():
            cand = P[(P.key == norm(r.player)) & P.slot.isin(AP_POS.get(r.position, [r.position]))]
            if len(cand) > 1:
                cand = cand[cand.school.str.lower().str.contains(str(r.school).lower().split()[0])] if len(cand[cand.school.str.lower().str.contains(str(r.school).lower().split()[0])]) else cand
            if not len(cand):
                cand = P[P.key == norm(r.player)]
            if not len(cand):
                miss.append((999, f"{r.player} ({r.position}): not in our graded players"))
                continue
            c = cand.sort_values("value", ascending=False).iloc[0]
            found += 1
            t = tier.get(int(c.id))
            on_any += t is not None
            on_first += t == 1
            if t is None:
                if not c.qual:
                    why = "under the qualifying sample"
                elif c.slot in ("EDGE", "IDL", "LB", "CB", "S") and y < 2024:
                    why = "a defender before 2024: credit depends on the stat crew"
                else:
                    pool = P[(P.slot == c.slot) & (P.qual == 1)]
                    why = f"rate below what volume could carry ({int(c['rank'])} of {len(pool)} {c.slot}s by value)"
                miss.append((c["rank"] if not np.isnan(c["rank"]) else 998, f"{r.player} ({c.slot}): {'#' + str(int(c['rank'])) if not np.isnan(c['rank']) else 'unranked'}, {why}"))
        miss.sort(key=lambda m: -m[0])
        n = len(ap)
        tot = [tot[0] + found, tot[1] + on_any, tot[2] + n]
        lines.append(f"| {y} | {n} | {found} | {on_any} ({on_any / max(found, 1):.0%}) | {on_first} | " + "; ".join(m[1] for m in miss[:3]) + " |")
    lines += ["", f"Across seasons: {tot[1]} of {tot[0]} AP All-Americans we could match ({tot[1] / max(tot[0], 1):.0%}) are on one of our three "
              "national teams. Disagreement is expected: ours is pure individual value with no team-success credit, and the AP "
              "counts tackles, which we do not grade before 2024.", ""]
    return lines


def fields():
    lines = ["### Retroactive fields that may surprise (2026 rules on past seasons)", "",
             "| season | team | seed | record | how | why it is there |", "|---|---|---:|---|---|---|"]
    for y in [s for s in C.SEASONS if s < C.CURRENT]:
        P, d = jl(f"playoff/{y}.json"), jl(f"s/{y}.json")
        nm = lambda t: d["teams"][str(t)][0]
        for f in P["field"]:
            why = None
            if f["l"] >= 4:
                why = f"{f['l']} losses, but résumé rank {f['rank']}: a hard schedule"
            elif f["how"] == "top Group of Six team" and f["seed"] <= 10:
                why = f"Group of Six team seeded {f['seed']} on résumé rank {f['rank']}"
            elif "champion" in f["how"] and f["rank"] > 16:
                why = f"conference champion ranked {f['rank']}: the automatic bid"
            if why:
                lines.append(f"| {y} | {nm(f['team'])} | {f['seed']} | {f['w']}-{f['l']} | {f['how']} | {why} |")
    return lines + [""]


def tiebreakers():
    P, d = jl(f"playoff/{C.CURRENT}.json"), jl(f"s/{C.CURRENT}.json")
    nm = lambda t: d["teams"][str(t)][0]
    lines = [f"### Tiebreaker cases, {C.CURRENT} (if the season ended today)", ""]
    for c, L in P["leaders"].items():
        for t, h in L["how"].items():
            if h:
                lines.append(f"- {c}: {nm(int(t))}'s place rests on {h['name']}" + (f", level with {', '.join(nm(x) for x in h['tied_with'])}" if h["tied_with"] else "")
                             + (" (an outside number our power rating stands in for)" if h["outside"] else "") + ".")
    lines.append("- Share of the 20,000 simulated seasons in which each Power 4 race needed a tiebreaker: "
                 + ", ".join(f"{c} {v:.0%}" for c, v in P["tiebreak_share"].items()) + ".")
    return lines + [""]


def main():
    out = ["# College Football Savant 1.0.0: the review list's numbers", "", "Generated by `python -m pipeline.cfb.review`.", ""]
    for f in (headshots, borderline, ap_overlap, fields, tiebreakers):
        out += f()
    (OUT / "review.md").write_text("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
