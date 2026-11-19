"""
hunt.py — Isolation targeting vs expected (mhunt): how often offenses isolated him, against how
often the players he guarded isolate everyone. A context stat: it describes how offenses treat
him, not how well he defends (in our testing it does not predict better team defense; if
anything, more-hunted defenders had slightly better on/off). Research and the decisions behind
every constant here: branch onball-d, research/onball-d/MODULE1-AUDIT.md to MODULE4.md.

    faced    = Synergy isolation possessions he defended (season totals, per defender)
    expected = Σ over the players he guarded of  iso_rate(o) × partial possessions(d, o)
    iso_rate(o) = (ISO_o + K × prior) / (P_o + K) × scale
    mhunt    = 100 × (faced − expected) / matchup possessions        (+ = targeted more)

  * ISO_o: the offensive player's isolation possessions (Synergy, traded players' rows summed);
    P_o: his partial possessions over every defender (LeagueSeasonMatchups, the table mtch uses).
    Synergy has no pair split, so the defender cannot be left out of his own baseline.
  * prior: the pooled rate of the players at his position in his quartile of matchup
    possessions that season ("players like him"); a position-only prior pushed totals 0.3-0.9%
    too high. K = 211 possessions, the season-to-season settle fit (tools/savant-settle method).
  * scale: Synergy's defensive isolation table holds 99-100% of the offensive table's
    possessions through 2022-23 and 86-94% after; expected is scaled by (defensive ÷ offensive).
  * then one multiplier per season makes expected add up to faced over every defender, so 0 is
    exactly average; recomputed on every run (the season in progress nightly).
  * Synergy lists nobody under 10 possessions. A defender missing from its isolation table is
      A  in none of the season's Synergy defensive tables: not tracked, no value;
      B  in others, but facing 9 would make him more avoided than 98% of the listed qualified
         defenders: most likely dropped from the table, no value;
      C  otherwise: "under 10 faced", valued at 9 faced (the conservative bound), kept in the pool.
    Cells carry the note ("floor" for C, "not_tracked" for A and B).
  * 2023-24 is left out: the NBA's isolation-defense table that season is missing 35 regular
    defenders who are in its other Synergy tables. In season, mhunt is withheld until no more than
    10% of qualified defenders are missing from the isolation table.
"""
import numpy as np
import pandas as pd

KEYS = ("mhunt", "mhunt_faced", "mhunt_exp")
FIRST = "2017-18"
K = 211.0
SKIP = {"2023-24": "The NBA's 2023-24 isolation-defense table is missing 35 regular defenders who appear in its other "
                   "Synergy tables, so that season is left out."}
GATE = 0.10
FLOOR, UNDER, RARE = 10, 9, 0.02


def gate_reason(missing):
    return (f"Synergy's isolation-defense table is still thin this season: {round(100 * missing)}% of qualified defenders "
            f"are not in it yet. It is shown once no more than {round(100 * GATE)}% are.")


def synergy_poss(df):
    if df is None or not len(df):
        return {}
    return df.groupby(df["PLAYER_ID"].astype(int))["POSS"].sum().astype(float).to_dict()


def pair_frame(mdf):
    f = pd.DataFrame({"d": mdf["DEF_PLAYER_ID"].astype(int), "o": mdf["OFF_PLAYER_ID"].astype(int),
                      "poss": pd.to_numeric(mdf["PARTIAL_POSS"], errors="coerce").fillna(0.0).to_numpy()})
    return f[f.poss > 0].reset_index(drop=True)


def priors(P, X, pos):
    """{offensive player: prior rate}, pooled within position x quartile of matchup possessions."""
    q = pd.qcut(P.rank(method="first"), 4, labels=False)
    t = pd.DataFrame({"X": X, "P": P, "pos": [pos.get(o) or "-" for o in P.index], "q": q.to_numpy()}, index=P.index)
    lq = {i: (r.X / r.P if r.P else 0.0) for i, r in t.groupby("q")[["X", "P"]].sum().iterrows()}
    mu = {k: (r.X / r.P if r.P else lq[k[1]]) for k, r in t[t.pos != "-"].groupby(["pos", "q"])[["X", "P"]].sum().iterrows()}
    return {o: (mu.get((p, qq), lq[qq]) if p != "-" else lq[qq]) for o, p, qq in zip(t.index, t.pos, t.q)}


def table(f, pos, iso_off, iso_def, qualified, syn_def_ids):
    """Per defender: faced, expected (scaled and calibrated), mposs, note."""
    P = f.groupby("o").poss.sum()
    X = P.index.to_series().map(lambda o: iso_off.get(o, 0.0)).astype(float)
    pr = priors(P, X, pos)
    a, b = sum(iso_off.values()), sum(iso_def.values())
    scale = b / a if a else 1.0
    rate = {o: (X[o] + K * pr[o]) / (P[o] + K) * scale for o in P.index}
    e = f.assign(e=f.o.map(rate) * f.poss).groupby("d").agg(e=("e", "sum"), mposs=("poss", "sum"))
    e["x"] = e.index.map(lambda d: iso_def.get(d, np.nan))
    listed = e[e.x.notna() & e.index.isin(list(qualified)) & (e.e > 0)]
    ratio = np.sort((listed.x / listed.e).to_numpy())
    note = {}
    for d, r in e[e.x.isna()].iterrows():
        if d not in syn_def_ids:
            note[d] = "not_tracked"                         # A
        elif r.e > 0 and len(ratio) and np.searchsorted(ratio, UNDER / r.e, side="right") / len(ratio) < RARE:
            note[d] = "not_tracked"                         # B
        else:
            note[d] = "floor"                               # C
    e["note"] = e.index.map(lambda d: note.get(d))
    e.loc[e.note == "floor", "x"] = UNDER
    tot = e.e.sum()
    if tot > 0:
        e["e"] = e.e * (np.nansum(e.x) / tot)               # 0 = exactly average, every season
    return e


def missing_share(qualified, iso_def):
    q = list(qualified)
    return (sum(1 for p in q if p not in iso_def) / len(q)) if q else 1.0


def apply_season(season, players, mdf, iso_off, iso_def, syn_def_ids, live=False):
    """Put mhunt, mhunt_faced and mhunt_exp (full season only) on the season's player dicts.
    iso_off / iso_def: {player id: isolation possessions} (synergy_poss of the Synergy tables);
    syn_def_ids: everyone in any of the season's Synergy defensive tables.
    Returns (defenders filled, why): why is {key: reason} for a season withheld as a whole."""
    if season < FIRST:
        return 0, {}
    if season in SKIP:
        return 0, {k: SKIP[season] for k in KEYS}
    if mdf is None or not len(mdf) or not iso_def or not iso_off:
        return 0, {}
    by_id = {int(p["id"]): p for p in players}
    qualified = {i for i, p in by_id.items() if p.get("qualified")}
    if live:
        miss = missing_share(qualified, iso_def)
        if miss > GATE:
            return 0, {k: gate_reason(miss) for k in KEYS}
    pos = {i: p.get("pos") for i, p in by_id.items()}
    t = table(pair_frame(mdf), pos, iso_off, iso_def, qualified, set(syn_def_ids) | set(iso_def))
    n = 0
    for d, r in t.iterrows():
        p = by_id.get(int(d))
        if p is None or not r.mposs:
            continue
        m = p.setdefault("m", {})
        note = r.note if isinstance(r.note, str) else None     # pandas leaves NaN where there is none
        cells = {"mhunt": None, "mhunt_faced": None, "mhunt_exp": None}
        if note != "not_tracked":
            cells = {"mhunt": round(100 * (r.x - r.e) / r.mposs, 3), "mhunt_faced": round(100 * r.x / r.mposs, 3),
                     "mhunt_exp": round(100 * r.e / r.mposs, 3)}
        for k, v in cells.items():
            c = {"v": v, "n": int(round(r.mposs))}
            if note:
                c["note"] = note
            m[k] = {"season": c}
        n += 1
    return n, {}
