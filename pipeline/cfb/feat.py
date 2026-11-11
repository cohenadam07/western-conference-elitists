"""1.1.0 step 7: the college-only features (BUILD-1.1 section 5). Runs after the season files exist.

    python -m pipeline.cfb.feat pool       # the Mac: NFL-linked players' final college profiles and NFL careers -> state/nfl_pool.json
    python -m pipeline.cfb.feat check      # the NFL-translation test (leave-one-out, 2014-2021 college finals)
    python -m pipeline.cfb.feat site       # public/cfb/x/: comps, pedigree, portal haul (every season on disk)

1. NFL translation. For every player with a qualified college season, the five most similar FINAL college seasons at his
   position among players who reached the NFL (1.0.0's college-to-NFL links): z-scores of the position's five headline
   stats (within that season and position) plus height, weight and recruiting rating, Euclidean distance. Each comp
   carries his draft slot and his NFL Savant value per season from Football Savant; a linked player's own card shows
   his combine numbers, from Football Savant. Labelled everywhere "comparison, not a projection".
   The test: for college finals of 2014-2021 by players who reached the NFL, does the comp group's mean NFL value per
   season (each player left out of his own comps) rank-correlate with his own? If not positive, the outcome averages
   are not shown.
2. Production vs pedigree: his Savant-value percentile among qualified players at his position, less his recruiting
   rating's percentile among the same players with a rating. Only where a rating exists.
3. Transfer impact: the card loads both seasons (the page does it from s/<season>.json, so it is the same numbers).
   The team's portal haul: summed Savant value of the season's incoming transfers against that of the men who left it,
   both in the same season (2021 on, when the portal opened).
Devy fantasy (BUILD-1.1 section 5.4) is deferred (Adam, Nov 10 2026).
"""
import sys
import json
import gzip
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from .paths import WORK, REPO, OUT, RAW
from . import config as C
from . import config_x as CX
from .state import DIR

PUB = REPO / "public" / "cfb"           # finished seasons: the committed files (the cloud has them too)
POOL = DIR / "nfl_pool.json"
COMP_SLOTS = ["QB", "RB", "WR", "TE", "EDGE", "IDL", "LB", "CB", "S"]
FS = REPO / "public" / "football-savant-data.json"
NFL_FIRST, NFL_LAST = 2014, 2021


def out_dir():
    from .site import PUB as P               # where this run writes (refresh_check's clean room sets CFB_PUB)
    return P


def sdoc(y):
    f = (out_dir() if y == C.CURRENT else PUB) / "s" / f"{y}.json.gz"
    return json.load(gzip.open(f)) if f.exists() else None


def headline_keys(slot):
    h = CX.HEADLINE
    n = {"EDGE": "dl", "IDL": "dl", "LB": "lb"}.get(slot)
    if slot in ("CB", "S"):
        return h["DB"]
    if n:
        return [k.replace("{p}", n) for k in h["D"]]
    return h[slot]


def season_profiles(y, doc=None):
    """Qualified players of a season with their headline stats' z-scores (within the season and slot), size."""
    d = doc or sdoc(y)
    if d is None:
        return None
    P = pd.DataFrame(d["players"], columns=d["cols"])
    P["i"] = np.arange(len(P))
    out = []
    for sl in COMP_SLOTS:
        x = P[(P.slot == sl) & (P.qual == 1)].copy()
        if len(x) < 10:
            continue
        for k, key in enumerate(headline_keys(sl)[:5]):
            v = d["values"].get(key, {})
            tag = "a" if "a" in v else "r"
            arr, o = v.get(tag), v.get("o" + tag, 0)
            vals = np.array([arr[i - o] if arr is not None and 0 <= i - o < len(arr) and arr[i - o] is not None else np.nan for i in x.i], dtype=float)
            st = C.by_key().get(key)
            if st is not None and st.lower:
                vals = -vals
            mu, sd = np.nanmean(vals), np.nanstd(vals)
            x[f"z{k}"] = (vals - mu) / sd if sd and sd > 0 else 0.0
            x[f"z{k}"] = x[f"z{k}"].fillna(0.0)
        for k in range(5):
            if f"z{k}" not in x.columns:
                x[f"z{k}"] = 0.0
        out.append(x[["id", "name", "team", "slot", "ht", "wt", "z0", "z1", "z2", "z3", "z4"]].assign(season=y))
    return pd.concat(out, ignore_index=True) if out else None


def nfl_careers():
    """Football Savant: each NFL player's Savant value by season, and his combine numbers."""
    d = json.load(open(FS))
    rows, comb = [], {}
    for y, s in d["data"].items():
        for p in s["players"]:
            m = p.get("m") or {}
            if m.get("sav") is not None:
                rows.append((p["id"], int(y), float(m["sav"]), p.get("pos")))
            c = {k: m.get(k) for k in ("forty", "vert", "broad", "cone", "shuttle", "bench") if m.get(k) is not None}
            if c and p["id"] not in comb:
                comb[p["id"]] = c
    return pd.DataFrame(rows, columns=["gsis", "season", "sav", "nfl_pos"]), comb


def build_pool():
    ident = pd.read_parquet(WORK / "identity.parquet")
    ident = ident[ident.gsis_id.notna()].set_index("pid")
    prof = [season_profiles(y) for y in C.SEASONS if y < C.CURRENT]
    prof = pd.concat([p for p in prof if p is not None], ignore_index=True)
    # every player's final qualified college season (his latest), with size and recruiting rating
    allid = pd.read_parquet(WORK / "identity.parquet").set_index("pid")
    prof["rating"] = prof.id.map(allid.rating)
    fin = prof.sort_values(["id", "season"]).drop_duplicates("id", keep="last")
    car, comb = nfl_careers()
    cs = car.groupby("gsis").agg(nfl_seasons=("season", "nunique"), nfl_value=("sav", "sum"), first=("season", "min"))
    cs["per_season"] = cs.nfl_value / cs.nfl_seasons
    by_season = {g: [[int(a), round(float(b), 2)] for a, b in zip(x.season, x.sav)] for g, x in car.sort_values("season").groupby("gsis")}
    nv = pd.read_csv(RAW / "nflverse" / "players.csv", usecols=["gsis_id", "draft_year", "draft_round", "draft_pick", "draft_team"]).set_index("gsis_id")
    linked = fin[fin.id.isin(ident.index)].copy()
    linked["gsis"] = linked.id.map(ident.gsis_id)
    pool = {"built_from": "final qualified college seasons 2009-2025 of players linked to an NFL id (identity.py), Football Savant's NFL value",
            "cols": ["id", "name", "slot", "season", "team", "ht", "wt", "rating", "z0", "z1", "z2", "z3", "z4", "gsis", "draft", "nfl", "per_season"],
            "rows": [], "combine": {}}
    for r in linked.itertuples():
        dr = nv.loc[r.gsis] if r.gsis in nv.index else None
        draft = None
        if dr is not None and not pd.isna(dr.draft_year):
            draft = [int(dr.draft_year), None if pd.isna(dr.draft_round) else int(dr.draft_round), None if pd.isna(dr.draft_pick) else int(dr.draft_pick),
                     None if pd.isna(dr.draft_team) else str(dr.draft_team)]
        ps = float(cs.per_season.get(r.gsis)) if r.gsis in cs.index else None
        pool["rows"].append([int(r.id), r.name, r.slot, int(r.season), int(r.team), _f(r.ht), _f(r.wt), _f(r.rating),
                             *[round(float(getattr(r, f"z{k}")), 4) for k in range(5)], r.gsis, draft, by_season.get(r.gsis, []),
                             None if ps is None else round(ps, 3)])
        if r.gsis in comb:
            pool["combine"][str(int(r.id))] = comb[r.gsis]
    # the size and rating scales (z-scores of the comparison) come from every final season, linked or not
    scale = {}
    for sl, x in fin.groupby("slot"):
        scale[sl] = {c: [_f(x[c].mean()), _f(x[c].std())] for c in ("ht", "wt", "rating")}
    pool["scale"] = scale
    POOL.write_text(json.dumps(pool, sort_keys=True, separators=(",", ":")))
    print("NFL pool:", len(pool["rows"]), "linked final seasons;", sum(1 for r in pool["rows"] if r[-1] is not None), "with an NFL value;",
          len(pool["combine"]), "with combine numbers")


def _f(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(v) else round(v, 3)


def _vec(rows, scale):
    """Feature matrix: the five headline z-scores, plus height, weight and rating z-scores (missing: the average, 0)."""
    out = []
    for r in rows:
        sl, ht, wt, rt = r["slot"], r["ht"], r["wt"], r["rating"]
        s = scale.get(sl, {})
        z = lambda v, c: 0.0 if v is None or not s.get(c) or not s[c][1] else (v - s[c][0]) / s[c][1]
        out.append([r["z0"], r["z1"], r["z2"], r["z3"], r["z4"], z(ht, "ht"), z(wt, "wt"), z(rt, "rating")])
    return np.array(out, dtype=float)


def comps_for(me, pool, k=5, exclude=None):
    """The k nearest NFL-linked final seasons at his slot."""
    cand = [r for r in pool["rows_d"] if r["slot"] == me["slot"] and r["id"] != me["id"] and (exclude is None or r["id"] not in exclude)]
    if not cand:
        return []
    A = _vec(cand, pool["scale"])
    m = _vec([me], pool["scale"])[0]
    dist = np.sqrt(((A - m) ** 2).sum(axis=1))
    order = np.lexsort((np.array([r["id"] for r in cand]), dist))[:k]
    return [(cand[i], float(dist[i])) for i in order]


def load_pool():
    p = json.loads(POOL.read_text())
    p["rows_d"] = [dict(zip(p["cols"], r)) for r in p["rows"]]
    return p


def check():
    p = load_pool()
    test = [r for r in p["rows_d"] if NFL_FIRST <= r["season"] <= NFL_LAST and r["per_season"] is not None]
    own, grp, slot = [], [], []
    for r in test:
        cs = [c for c, _ in comps_for(r, p) if c["per_season"] is not None]
        if len(cs) < 3:
            continue
        own.append(r["per_season"])
        grp.append(np.mean([c["per_season"] for c in cs]))
        slot.append(r["slot"])
    rho, pv = spearmanr(grp, own)
    by = {}
    for sl in COMP_SLOTS:
        ix = [i for i, s in enumerate(slot) if s == sl]
        if len(ix) >= 30:
            by[sl] = (round(float(spearmanr([grp[i] for i in ix], [own[i] for i in ix])[0]), 3), len(ix))
    res = {"players": len(own), "spearman": round(float(rho), 4), "p_value": float(pv), "by_slot": by, "show_outcomes": bool(rho > 0)}
    lines = ["# NFL translation: does the comp group's NFL value track the player's own?", "",
             f"*`python -m pipeline.cfb.feat check`. College finals {NFL_FIRST}-{NFL_LAST} by players who reached the NFL; each player's five "
             "comps found among the other NFL-linked final seasons at his position (leave-one-out).*", "",
             f"- Players tested: {len(own):,}", f"- Spearman rank correlation of the comps' mean NFL Savant value per season with his own: "
             f"**{rho:.3f}** (p = {pv:.2g})", f"- Outcome averages shown on the card: **{'yes' if rho > 0 else 'no'}**", "",
             "| position | correlation | players |", "|---|---:|---:|"] + [f"| {k} | {v[0]:.3f} | {v[1]} |" for k, v in by.items()] + [""]
    (OUT / "nfl_translation.md").write_text("\n".join(lines))
    (OUT / "nfl_translation.json").write_text(json.dumps(res, indent=1))
    print("\n".join(lines))
    return res


def write_state():
    """What a cloud refresh needs from the Mac for the season being played: its players' recruiting ratings and the
    season's transfers (the identity table never leaves the Mac)."""
    ident = pd.read_parquet(WORK / "identity.parquet")
    ps = pd.read_parquet(WORK / "player_seasons.parquet", columns=["pid", "season"])
    cur = set(ps[ps.season == C.CURRENT].pid)
    r = ident[ident.pid.isin(cur) & ident.rating.notna()]
    (DIR / "recruits_current.json").write_text(json.dumps({str(int(p)): [round(float(a), 4), None if pd.isna(b) else int(b)]
                                                          for p, a, b in zip(r.pid, r.rating, r.stars)}, sort_keys=True))
    tr = pd.read_parquet(WORK / "transfers.parquet")
    t = tr[tr.season == C.CURRENT]
    cols = [c for c in ("pid", "season", "orig", "dest", "origin") if c in t.columns]
    (DIR / "transfers_current.json").write_text(t[cols].to_json(orient="records"))
    print("state: recruits for", len(r), "current players;", len(t), "transfers")


def jdump(path, doc):
    from .site import jdump as j
    return j(path, doc)


def write_site(seasons=None):
    """public/cfb/x/: comps/<00-99>.json (players' NFL comps), nfl.json (the linked players' draft and NFL lines and combine),
    pedigree/<season>.json, haul/<season>.json."""
    p = load_pool()
    res = json.loads((OUT / "nfl_translation.json").read_text()) if (OUT / "nfl_translation.json").exists() else {"show_outcomes": False}
    sizes = {}
    seasons = seasons or [y for y in C.SEASONS if (PUB / "s" / f"{y}.json.gz").exists()]
    O = out_dir()
    ident = pd.read_parquet(WORK / "identity.parquet").set_index("pid") if (WORK / "identity.parquet").exists() else None
    # the season being played reads the committed state on the Mac too, so a refresh and a full build agree byte for byte
    rr = json.loads((DIR / "recruits_current.json").read_text()) if (DIR / "recruits_current.json").exists() else {}
    cur_rating = pd.Series({int(k): v[0] for k, v in rr.items()}, dtype=float)
    past_rating = ident.rating if ident is not None else pd.Series(dtype=float)
    rating_of = lambda y: cur_rating if y == C.CURRENT else past_rating
    # ---- comps: every player's latest qualified season up to each season on disk
    latest = {}
    for y in sorted(set([v for v in C.SEASONS if (PUB / "s" / f"{v}.json.gz").exists() or v == C.CURRENT])):
        pr = season_profiles(y)
        if pr is None:
            continue
        pr["rating"] = pr.id.map(rating_of(y))
        for r in pr.to_dict("records"):
            latest[int(r["id"])] = r
    shards = {i: {} for i in range(100)}
    for pid, me in latest.items():
        me = {k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in me.items()}
        cs = comps_for(me, p)
        if cs:
            shards[pid % 100][str(pid)] = {"season": int(me["season"]), "slot": me["slot"],
                                           "comps": [[c["id"], round(dd, 3)] for c, dd in cs]}
    tot = 0
    for k, d in shards.items():
        tot += jdump(O / "x" / "comps" / f"{k:02d}.json", d)
    sizes["x/comps/*"] = tot
    nfl = {str(r["id"]): [r["name"], r["slot"], r["season"], r["team"], r["gsis"], r["draft"], r["nfl"], r["per_season"]] for r in p["rows_d"]}
    sizes["x/nfl"] = jdump(O / "x" / "nfl.json", {"cols": ["name", "slot", "final", "team", "gsis", "draft", "nfl", "per_season"], "players": nfl,
                                                    "combine": p["combine"], "show_outcomes": res.get("show_outcomes", False),
                                                    "test": {k: res.get(k) for k in ("players", "spearman", "by_slot")},
                                                    "label": "comparison, not a projection"})
    # ---- pedigree and portal haul, per season
    tr = pd.read_parquet(WORK / "transfers.parquet") if (WORK / "transfers.parquet").exists() else pd.DataFrame(columns=["season", "pid", "orig"])
    if (DIR / "transfers_current.json").exists():
        tc = pd.read_json(DIR / "transfers_current.json", orient="records")
        tr = pd.concat([tr[tr.season != C.CURRENT], tc], ignore_index=True)
    for y in seasons:
        d = sdoc(y)
        P = pd.DataFrame(d["players"], columns=d["cols"])
        P["value"] = d["value"]["v"]
        P["rating"] = P.id.map(rating_of(y))
        rows = []
        for sl, x in P[(P.qual == 1) & P.value.notna()].groupby("slot"):
            if sl not in COMP_SLOTS + ["K", "P"]:
                continue
            prod = x.value.rank(pct=True) * 100
            r = x[x.rating.notna()]
            if len(r) < 10:
                continue
            ped = r.rating.rank(pct=True) * 100
            for pid, pv, rv in zip(r.id, prod[r.index], ped):
                rows.append([int(pid), round(float(pv), 1), round(float(rv), 1), round(float(pv - rv), 1)])
        sizes[f"x/pedigree/{y}"] = jdump(O / "x" / "pedigree" / f"{y}.json", {"season": y, "cols": ["id", "production", "pedigree", "gap"],
                                                                               "rows": rows,
                                                                               "note": "Savant-value percentile at his position less his recruiting rating's percentile, among qualified players with a rating."})
        if y >= 2021 and len(tr):
            t = tr[tr.season == y]
            val = dict(zip(P.id, P.value))
            team_of = dict(zip(P.id, P.team))
            hin, hout = {}, {}
            for r in t.itertuples():
                v = val.get(int(r.pid))
                if v is None or not np.isfinite(v):
                    continue
                to = team_of.get(int(r.pid))
                frm = getattr(r, "orig", None)
                if to is not None:
                    hin.setdefault(int(to), []).append([int(r.pid), round(float(v), 2)])
                if frm is not None and not pd.isna(frm):
                    hout.setdefault(int(frm), []).append([int(r.pid), round(float(v), 2)])
            teams = sorted(set(hin) | set(hout))
            haul = {str(t): {"in": round(sum(v for _, v in hin.get(t, [])), 2), "out": round(sum(v for _, v in hout.get(t, [])), 2),
                             "n_in": len(hin.get(t, [])), "n_out": len(hout.get(t, [])),
                             "top_in": sorted(hin.get(t, []), key=lambda z: -z[1])[:5], "top_out": sorted(hout.get(t, []), key=lambda z: -z[1])[:5]}
                    for t in teams}
            sizes[f"x/haul/{y}"] = jdump(O / "x" / "haul" / f"{y}.json", {"season": y, "teams": haul,
                                                                         "note": "Savant value this season of the men who transferred in, against that of the men who transferred out (at their new schools)."})
    return sizes


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "pool":
        build_pool()
    elif a[0] == "check":
        check()
    elif a[0] == "site":
        print(write_site([int(v) for v in a[1:]] or None))
