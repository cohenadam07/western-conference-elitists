"""Steps 11, 12 and 13. Positions, Savant value, and the historical All-Savant dry run.

    python -m pipeline.cfb.value

Savant value (RESEARCH section 6) is one number per player-season: expected
points above a replacement-level player at his position, opponent-adjusted,
counted on the plays he was credited with. Pure individual value: nothing in
it knows whether his team won.

  QB        EPA on his dropbacks and runs, each play adjusted for the defence faced
  RB        EPA on his runs and targets, adjusted
  WR / TE   EPA on his targets, adjusted, per team dropback. Where a game's play text does not name
            the target of an incompletion (most games before 2025), the team's
            un-named incompletions are shared out in proportion to catches, so a
            receiver is not flattered by a stat crew that only records his catches
  defenders disruption value: sacks, other tackles for loss, interceptions, pass
            break-ups, forced fumbles, QB hurries and run stops, each worth the
            league-average points an offence loses on such a play that season,
            adjusted for the offence faced. Counts come from the box score when the
            game has one (2024 on), from the play text otherwise.
  OL unit   the team's opponent-adjusted sack rate allowed, rushing success and
            stuff rate avoided, in points per game
  K, P      field goals over expected by distance; punt EPA over expected by spot
  all-purpose  scrimmage value plus return value, QBs excluded

Every rate is shrunk toward the position mean with its settle point before it
is multiplied back up by volume, (n*x + k*mean) / (n + k), and replacement is
the 25th-percentile qualified rate at the position that season (the Football
Savant and College Basketball Savant convention).
"""
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from .paths import WORK, OUT, REPO
from . import teamgame
from .player_study import tables, rosters, opp_effects, USABLE

REPL_PCT = 25
SHAPE = [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("OL unit", 1), ("K", 1), ("AP", 1),
         ("EDGE", 2), ("IDL", 2), ("LB", 3), ("CB", 2), ("S", 2), ("DB", 1), ("P", 1)]
QUAL = {"QB": 150, "RB": 80, "WR": 30, "TE": 15, "EDGE": 350, "IDL": 350, "LB": 350, "CB": 350, "S": 350, "K": 10, "P": 25}
KSET = {"QB": 240, "RB": 250, "WR": 300, "TE": 450, "EDGE": 670, "IDL": 670, "LB": 890, "CB": 2000, "S": 2000, "K": 130, "P": 165}
BASE = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "PK": "K", "K": "K", "P": "P", "LB": "LB",
        "CB": "CB", "S": "S", "DE": "EDGE", "EDGE": "EDGE", "DT": "IDL", "NT": "IDL", "DL": "DL?", "DB": "DB?"}


# ---------------------------------------------------------------- step 11: positions
def classify(dsea, ro):
    """Split the roster's generic "DL" into edge / interior and "DB" into corner / safety from stat profile and size."""
    x = dsea.merge(ro[["season", "pid", "pos", "weight", "height", "name"]], on=["season", "pid"], how="left")
    x["slot"] = x.pos.map(BASE)
    x["weight"] = x.weight.fillna(x.groupby("slot").weight.transform("median")).fillna(220)
    x["height"] = x.height.fillna(x.groupby("slot").height.transform("median")).fillna(73)
    tk = np.where(x.b_tkl.fillna(0) > 0, x.b_tkl.fillna(0), x.tkl + 0.5 * x.ast)
    pdv = np.maximum(x.pbu + x["int"], x.b_pd.fillna(0))
    sk = np.maximum(x.sack, x.b_sack.fillna(0))
    x["f_sack_share"] = sk / (sk + x.stop + 0.25 * tk + 1)
    x["f_pd_share"] = pdv / (pdv + x.stop + 0.25 * tk + 1)
    x["f_stop_rate"] = x.stop / x.dplays.clip(lower=1) * 100
    x["f_tk_rate"] = tk / x.dplays.clip(lower=1) * 100
    report = {}
    for generic, pos_lab, neg_lab, feats in (("DL?", "EDGE", "IDL", ["weight", "height", "f_sack_share", "f_stop_rate"]),
                                             ("DB?", "CB", "S", ["weight", "height", "f_pd_share", "f_stop_rate", "f_tk_rate"])):
        lab = x[x.slot.isin([pos_lab, neg_lab]) & (x.dplays >= 200)]
        mu, sd = lab[feats].mean(), lab[feats].std()
        Z = (lab[feats] - mu) / sd
        yv = (lab.slot == pos_lab).astype(int)
        m = LogisticRegression(max_iter=1000)
        acc = cross_val_score(m, Z, yv, cv=5).mean()
        m.fit(Z, yv)
        g = x.slot == generic
        p = m.predict_proba(((x.loc[g, feats] - mu) / sd))[:, 1]
        x.loc[g, "p_first"] = p
        x.loc[g, "slot"] = np.where(p >= 0.5, pos_lab, neg_lab)
        x.loc[g, "inferred"] = True
        report[generic] = {"labelled_player_seasons": int(len(lab)), "cross_validated_accuracy": float(acc),
                           "coefficients": dict(zip(feats, m.coef_[0].round(3).tolist())),
                           "generic_player_seasons": int(g.sum()), "share_called_" + pos_lab: float((p >= 0.5).mean())}
    x["inferred"] = x.inferred.fillna(False)
    return x, report


# ---------------------------------------------------------------- step 12: value
def shrink_value(t, slot, n, raw, qual_col=None):
    """rate -> shrunk toward the slot-season mean -> minus replacement -> times volume."""
    t = t.copy()
    qual_col = qual_col or n
    t["rate"] = t[raw] / t[n].clip(lower=1e-9)
    q = t[t[qual_col] >= QUAL[slot]]
    mu = (q.groupby("season")[raw].sum() / q.groupby("season")[n].sum()).rename("mu")
    t = t.merge(mu, on="season", how="left")
    k = KSET[slot]
    t["srate"] = (t[raw] + k * t.mu) / (t[n] + k)
    t["qualified"] = t[qual_col] >= QUAL[slot]
    rep = t[t.qualified].groupby("season").srate.quantile(REPL_PCT / 100).rename("repl")
    t = t.merge(rep, on="season", how="left")
    t["value"] = (t.srate - t.repl) * t[n]
    t["slot"] = slot
    t["n"] = t[n]
    return t


def build_values():
    T, meta = tables()
    ro = rosters()
    tg = teamgame.load("cfbd", USABLE)
    tm = pd.read_parquet(WORK / "pg_team.parquet")[["game_id", "team", "cmp", "un", "un_epa"]].rename(columns={"cmp": "t_cmp"})
    effP = opp_effects(tg, "epa_pass", "db")
    effR = opp_effects(tg, "epa_rush", "rush")
    effS = opp_effects(tg, "sacks", "db")
    effT = opp_effects(tg, "stuff", "rush")
    effI = opp_effects(tg, "ints", "db")

    def e(eff, side, d):
        return np.array([eff[s][side].get(o, 0.0) if s in eff else 0.0 for s, o in zip(d.season, d.opp)])

    def fac(eff, d):       # multiplicative factor for defender counts: league rate / (league rate + this offence's effect)
        o = e(eff, 0, d)
        lg = np.array([eff[s][2] if s in eff else np.nan for s in d.season])
        return np.clip(lg / np.clip(lg + o, 1e-6, None), 0.6, 1.6)

    out = []
    # QB
    q = T["qb"][T["qb"].season.isin(USABLE) & (T["qb"].grp == "QB")].copy()
    q["adj"] = q.epa - q.db * e(effP, 1, q) + q.q_rush_epa - q.q_rush * e(effR, 1, q)
    q["n_"] = q.db + q.q_rush
    a = q.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("n_", "sum"), raw_epa=("tot_epa", "sum"), games=("game_id", "nunique"),
                                         team=("team", lambda s: s.value_counts().index[0])).reset_index()
    out.append(shrink_value(a, "QB", "n_", "adj"))
    # receivers (WR, TE) and the receiving half of RBs: un-named incompletions shared by catches
    rc = T["rec"][T["rec"].season.isin(USABLE)].merge(tm, on=["game_id", "team"], how="left")
    share = np.where(rc.t_cmp > 0, rc.rec / rc.t_cmp.clip(lower=1), 0.0)
    rc["tgt_eff"] = rc.tgt + share * rc.un.fillna(0)
    rc["epa_eff"] = rc.epa + share * rc.un_epa.fillna(0)
    rc["adj"] = rc.epa_eff - rc.tgt_eff * e(effP, 1, rc)
    for slot in ("WR", "TE"):
        x = rc[rc.grp == slot]
        # per TEAM DROPBACK in the games he played, not per target: earning targets is the most repeatable thing a
        # receiver does (player_stability: yards per team attempt 0.79, EPA per target 0.16), and a per-target
        # baseline would hand a 150-target season nothing for its volume
        a = x.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("t_db", "sum"), tgts=("tgt_eff", "sum"), raw_epa=("epa", "sum"),
                                             games=("game_id", "nunique"), team=("team", lambda s: s.value_counts().index[0])).reset_index()
        out.append(shrink_value(a, slot, "n_", "adj", qual_col="tgts"))
    # RB: runs + targets
    ru = T["rush"][T["rush"].season.isin(USABLE) & (T["rush"].grp == "RB")].copy()
    ru["adj"] = ru.epa - ru.rush * e(effR, 1, ru)
    a1 = ru.groupby(["season", "pid", "team"]).agg(adj=("adj", "sum"), n_=("rush", "sum"), raw_epa=("epa", "sum"), games=("game_id", "nunique")).reset_index()
    x = rc[rc.grp == "RB"]
    a2 = x.groupby(["season", "pid", "team"]).agg(adj=("adj", "sum"), n_=("tgt_eff", "sum"), raw_epa=("epa", "sum"), games=("game_id", "nunique")).reset_index()
    a = pd.concat([a1, a2]).groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("n_", "sum"), raw_epa=("raw_epa", "sum"), games=("games", "max"),
                                                           team=("team", "first")).reset_index()
    out.append(shrink_value(a, "RB", "n_", "adj"))
    # defenders: event weights are the league-average points lost on such a play, by season
    W = event_weights()
    d = T["dfn"][T["dfn"].season.isin(USABLE)].copy()
    hb = d.has_box.fillna(False).to_numpy()
    d["e_sack"] = np.where(hb, d.b_sack.fillna(0), d.sack)
    d["e_tfl"] = np.where(hb, (d.b_tfl.fillna(0) - d.b_sack.fillna(0)).clip(lower=0), d.tfl)
    d["e_pbu"] = np.where(hb, (d.b_pd.fillna(0) - d["int"]).clip(lower=0), d.pbu)
    d["e_hur"] = np.where(hb, d.b_hur.fillna(0), 0.0)
    d["e_stop"] = (d.stop - d.tfl).clip(lower=0)
    fS, fT, fI = fac(effS, d), fac(effT, d), fac(effI, d)
    w = lambda k: d.season.map({s: W[s][k] for s in W}).to_numpy()
    d["disr"] = (w("sack") * d.e_sack * fS + w("hur") * d.e_hur * fS + w("tfl") * d.e_tfl * fT + w("stop") * d.e_stop * fT
                 + w("int") * d["int"] * fI + w("pbu") * d.e_pbu * fI + w("ff") * d.ff)
    dsea = d.groupby(["season", "pid"]).agg(
        disr=("disr", "sum"), dplays=("dplays", "sum"), games=("game_id", "nunique"), team=("team", lambda s: s.value_counts().index[0]),
        sack=("e_sack", "sum"), tfl=("e_tfl", "sum"), stop=("e_stop", "sum"), pbu=("e_pbu", "sum"), ff=("ff", "sum"), hur=("e_hur", "sum"),
        tkl=("tkl", "sum"), ast=("ast", "sum"), b_tkl=("b_tkl", "sum"), b_pd=("b_pd", "sum"), b_sack=("b_sack", "sum"),
        **{"int": ("int", "sum")}).reset_index()
    cls, posrep = classify(dsea, ro)
    for slot in ("EDGE", "IDL", "LB", "CB", "S"):
        x = cls[cls.slot == slot].copy()
        v = shrink_value(x, slot, "dplays", "disr")
        out.append(v)
    # specialists
    kk = T["kick"][T["kick"].season.isin(USABLE)]
    a = kk.groupby(["season", "pid"]).agg(adj=("pts_oe", "sum"), n_=("fga", "sum"), games=("game_id", "nunique"),
                                          team=("team", lambda s: s.value_counts().index[0])).reset_index()
    out.append(shrink_value(a, "K", "n_", "adj"))
    pp = T["punt"][T["punt"].season.isin(USABLE)]
    a = pp.groupby(["season", "pid"]).agg(adj=("poe", "sum"), n_=("punts", "sum"), games=("game_id", "nunique"),
                                          team=("team", lambda s: s.value_counts().index[0])).reset_index()
    out.append(shrink_value(a, "P", "n_", "adj"))
    v = pd.concat(out, ignore_index=True)
    keep = ["season", "pid", "team", "slot", "n", "games", "rate", "srate", "mu", "repl", "value", "qualified", "inferred", "p_first",
            "sack", "tfl", "stop", "int", "pbu", "ff", "hur", "raw_epa"]
    v = v[[c for c in keep if c in v.columns]]
    v = v.merge(ro[["season", "pid", "name", "pos", "cls", "weight", "height"]], on=["season", "pid"], how="left")
    # returns, for the all-purpose slot
    rt = pd.read_parquet(WORK / "pg_ret.parquet")
    rt = rt[rt.season.isin(USABLE) & rt.epa.notna()].copy()
    rt["above"] = rt.epa - rt.groupby(["season", "kind"]).epa.transform("mean")
    r = rt.groupby(["season", "pid"]).agg(ret_above=("above", "sum"), returns=("above", "size")).reset_index()
    r["ret_value"] = r.ret_above * r.returns / (r.returns + 40.0)
    v = v.merge(r[["season", "pid", "ret_value", "returns"]], on=["season", "pid"], how="left")
    v["ret_value"] = v.ret_value.fillna(0.0)
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")[["season", "team_id", "school", "conference"]].rename(columns={"team_id": "team"})
    v = v.merge(fbs, on=["season", "team"], how="left")
    return v, posrep, W, tg


def event_weights():
    """League-average points an offence loses on each kind of disruptive play, by season (from our EPA)."""
    W = {}
    hur = []
    for y in USABLE + [2026]:
        d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["play_id", "cat", "f_sack", "f_int", "f_pbu", "f_ff", "f_att", "f_comp",
                                                                 "yards", "down", "dist", "pts", "f_fum_lost", "pbu_by", "pdef1", "ff_by",
                                                                 "ffby1", "f_kneel", "hurry_txt", "period", "f_pen_noplay"])
        e = pd.read_parquet(WORK / f"epa_{y}.parquet", columns=["epa", "garbage_cfbd"])
        d["epa"] = e.epa.to_numpy()
        d = d[d.cat.isin(["rush", "pass"]) & d.epa.notna() & ~d.f_kneel & (d.period <= 4) & ~e.garbage_cfbd.to_numpy() & ~d.f_pen_noplay]
        need = np.select([d.down == 1, d.down == 2], [0.5 * d.dist, 0.7 * d.dist], default=d.dist)
        fail_run = (d.cat == "rush") & (d.yards < need) & (d.pts != 7)
        tfl = (d.yards < 0) & ~d.f_sack & ~(d.f_att & ~d.f_comp)
        pbu = (d.cat == "pass") & (d.f_pbu | d.pbu_by.notna() | d.pdef1.notna()) & ~d.f_int
        base_run = d[d.cat == "rush"].epa.mean()
        base_db = d[d.cat == "pass"].epa.mean()
        W[y] = {"sack": float(base_db - d[d.f_sack].epa.mean()), "tfl": float(base_run - d[tfl].epa.mean()),
                "int": float(base_db - d[(d.cat == "pass") & d.f_int].epa.mean()),
                "pbu": float(base_db - d[pbu].epa.mean()) if pbu.sum() > 200 else np.nan,
                "ff": float(d.epa.mean() - d[d.f_ff | d.ff_by.notna() | d.ffby1.notna()].epa.mean()),
                "stop": float(base_run - d[fail_run & (d.yards >= 0)].epa.mean())}
        if y >= 2025:
            h = d[(d.cat == "pass") & ~d.f_sack]
            hur.append(float(h.epa.mean() - h[h.hurry_txt].epa.mean()))
    hw = float(np.mean(hur))
    pb = float(np.nanmean([W[y]["pbu"] for y in W]))
    for y in W:
        W[y]["hur"] = hw
        if not np.isfinite(W[y]["pbu"]):
            W[y]["pbu"] = pb
    return W


def ol_units(tg):
    """Team-season offensive line score in points per game (opponent-adjusted)."""
    es, er, et = opp_effects(tg, "sacks", "db"), opp_effects(tg, "succ_rush", "rush"), opp_effects(tg, "stuff", "rush")
    vol = tg.groupby(["season", "team"]).agg(db=("db", "mean"), rush=("rush", "mean"), games=("game_id", "nunique")).reset_index()
    W_SACK, W_SUCC, W_STUFF = 2.0, 1.1, 0.9      # EPA swing of a sack avoided / a successful run / a stuff avoided (measured, rounded)
    vol["sack_eff"] = [es[s][0].get(t, 0.0) for s, t in zip(vol.season, vol.team)]
    vol["succ_eff"] = [er[s][0].get(t, 0.0) for s, t in zip(vol.season, vol.team)]
    vol["stuff_eff"] = [et[s][0].get(t, 0.0) for s, t in zip(vol.season, vol.team)]
    vol["pass_pro_pts"] = -vol.sack_eff * vol.db * W_SACK
    vol["run_block_pts"] = 0.5 * (vol.succ_eff * vol.rush * W_SUCC) + 0.5 * (-vol.stuff_eff * vol.rush * W_STUFF)
    vol["ol_pts_pg"] = vol.pass_pro_pts + vol.run_block_pts
    vol["value"] = vol.ol_pts_pg * vol.games
    return vol


# ---------------------------------------------------------------- step 13: teams
def pick(v, ol, season, pool=None, tiers=3):
    """Fill SHAPE `tiers` times from one shared used-list. `pool` filters players (a conference, or freshmen)."""
    x = v[(v.season == season) & v.qualified]
    if pool is not None:
        x = x[pool(x)]
    o = ol[ol.season == season]
    if pool is not None and "conference" in o.columns:
        o = o[pool(o)] if "cls" not in pool.__code__.co_names else o.iloc[:0]
    used, used_ol, rows = set(), set(), []
    for tier in range(1, tiers + 1):
        for slot, cnt in SHAPE:
            if slot == "OL unit":
                c = o[~o.team.isin(used_ol)].sort_values("value", ascending=False).head(cnt)
                for _, r in c.iterrows():
                    used_ol.add(r.team)
                    rows.append(dict(season=season, tier=tier, slot=slot, pid=None, name=f"{r.school} offensive line", school=r.school,
                                     conference=r.conference, value=r.value, team=r.team))
                continue
            if slot == "DB":
                c = x[x.slot.isin(["CB", "S"]) & ~x.pid.isin(used)].sort_values("value", ascending=False)
            elif slot == "AP":
                c = x[x.slot.isin(["RB", "WR", "TE"]) & ~x.pid.isin(used)].assign(value=lambda t: t.value + t.ret_value).sort_values("value", ascending=False)
            else:
                c = x[(x.slot == slot) & ~x.pid.isin(used)].sort_values("value", ascending=False)
            for _, r in c.head(cnt).iterrows():
                used.add(r.pid)
                rows.append(dict(season=season, tier=tier, slot=slot, pid=int(r.pid), name=r["name"], school=r.school,
                                 conference=r.conference, value=float(r.value), team=int(r.team), cls=r.cls))
    return pd.DataFrame(rows)


def main():
    v, posrep, W, tg = build_values()
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")[["season", "team_id", "school", "conference"]].rename(columns={"team_id": "team"})
    ol = ol_units(tg).merge(fbs, on=["season", "team"], how="left")
    v.to_parquet(WORK / "savant_value.parquet", index=False)
    ol.to_parquet(WORK / "ol_units.parquet", index=False)
    res = {"positions": posrep, "event_weights_2025": W[2025], "replacement_percentile": REPL_PCT}
    # ---- step 11 output: borderline list (latest finished season) -------------------
    b = v[(v.season == 2025) & v.inferred.fillna(False) & v.qualified].copy()
    b["margin"] = (b.p_first - 0.5).abs()
    b = b.sort_values("margin").head(40)
    lines = ["| player | school | roster says | called | probability of edge / corner | weight | sacks | run stops | INT | break-ups | Savant value |",
             "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    for _, r in b.iterrows():
        lines.append(f"| {r['name']} | {r.school} | {r.pos} | {r.slot} | {r.p_first:.2f} | {r.weight:.0f} | {r.sack:.1f} | {r.stop:.1f} | "
                     f"{r['int']:.1f} | {r.pbu:.1f} | {r.value:+.1f} |")
    # linebackers who rush like edges
    lb = v[(v.season == 2025) & (v.slot == "LB") & v.qualified].copy()
    edge_med = v[(v.season == 2025) & (v.slot == "EDGE") & v.qualified].eval("sack / n").median()
    lb = lb[(lb.sack / lb.n >= edge_med) & (lb.weight >= 235)].sort_values("sack", ascending=False).head(20)
    lines += ["", "Linebackers who rush the passer like edges (listed LB, 235+ lb, sack rate at or above the median edge); kept at LB:", "",
              "| player | school | weight | sacks | run stops | Savant value |", "|---|---|---:|---:|---:|---:|"]
    lines += [f"| {r['name']} | {r.school} | {r.weight:.0f} | {r.sack:.1f} | {r.stop:.1f} | {r.value:+.1f} |" for _, r in lb.iterrows()]
    (OUT / "positions_borderline.md").write_text("\n".join(lines) + "\n")
    # ---- step 12 checks: year-to-year by slot, top-50 mix ---------------------------
    yy = []
    for slot in [s for s, _ in SHAPE if s not in ("OL unit", "AP", "DB")]:
        x = v[(v.slot == slot) & v.qualified][["season", "pid", "value", "srate", "team"]]
        nx = x.assign(season=x.season - 1).rename(columns={"value": "v2", "srate": "r2", "team": "t2"})
        m = x.merge(nx, on=["season", "pid"])
        yy.append(dict(slot=slot, pairs=len(m), r_value=float(m.value.corr(m.v2)) if len(m) > 20 else np.nan,
                       r_rate=float(m.srate.corr(m.r2)) if len(m) > 20 else np.nan,
                       r_value_transfers=float(m[m.team != m.t2].value.corr(m[m.team != m.t2].v2)) if (m.team != m.t2).sum() > 20 else np.nan,
                       n_transfers=int((m.team != m.t2).sum()), qualified_per_season=float(v[(v.slot == slot) & v.qualified].groupby("season").size().mean()),
                       sd_value=float(v[(v.slot == slot) & v.qualified].value.std())))
    x = ol[["season", "team", "value"]]
    m = x.merge(x.assign(season=x.season - 1).rename(columns={"value": "v2"}), on=["season", "team"])
    yy.append(dict(slot="OL unit", pairs=len(m), r_value=float(m.value.corr(m.v2)), r_rate=np.nan, r_value_transfers=np.nan, n_transfers=0,
                   qualified_per_season=float(ol.groupby("season").size().mean()), sd_value=float(ol.value.std())))
    yy = pd.DataFrame(yy)
    yy.to_csv(OUT / "value_stability.csv", index=False)
    top = v[v.qualified].sort_values("value", ascending=False).groupby("season").head(50)
    mix = (top.groupby("slot").size() / top.season.nunique()).round(1).sort_values(ascending=False)
    res["top50_mix_per_season"] = mix.to_dict()
    # How much of a player's rate travels with him when he changes schools, relative to staying:
    # credit = r(movers) / r(stayers), College Basketball Savant's rule. Reported, and offered as an
    # alternative "shared-credit" value; the primary value stays as RESEARCH section 6 defines it.
    groups = {"QB": ["QB"], "RB": ["RB"], "WR/TE": ["WR", "TE"], "EDGE/IDL": ["EDGE", "IDL"], "LB": ["LB"], "CB/S": ["CB", "S"]}
    credit = {}
    for gname, slots in groups.items():
        x = v[v.slot.isin(slots) & v.qualified][["season", "pid", "srate", "team", "slot"]].copy()
        x["z"] = x.srate - x.groupby(["season", "slot"]).srate.transform("mean")
        nx = x.assign(season=x.season - 1)[["season", "pid", "z", "team"]].rename(columns={"z": "z2", "team": "t2"})
        m = x.merge(nx, on=["season", "pid"])
        st, mv = m[m.team == m.t2], m[m.team != m.t2]
        rs, rm = float(st.z.corr(st.z2)), float(mv.z.corr(mv.z2))
        credit[gname] = {"r_stayed": rs, "n_stayed": int(len(st)), "r_transferred": rm, "n_transferred": int(len(mv)),
                         "credit": float(np.clip(rm / rs, 0.0, 1.0))}
        v.loc[v.slot.isin(slots), "credit"] = credit[gname]["credit"]
    v["credit"] = v.credit.fillna(1.0)
    v["value_shared"] = v.value * v.credit
    res["credit_by_position"] = credit
    top2 = v[v.qualified].sort_values("value_shared", ascending=False).groupby("season").head(50)
    res["top50_mix_shared_credit"] = (top2.groupby("slot").size() / top2.season.nunique()).round(1).sort_values(ascending=False).to_dict()
    v.to_parquet(WORK / "savant_value.parquet", index=False)
    print(yy.round(3).to_string(index=False))
    print("top-50 mix", mix.to_dict())
    # ---- step 13: teams ---------------------------------------------------------------
    allteams, conf_rows, fr_rows, heis = [], [], [], []
    for y in USABLE:
        nat = pick(v, ol, y)
        nat["set"] = "national"
        allteams.append(nat)
        for conf in sorted(v[(v.season == y) & v.conference.notna()].conference.unique()):
            if "Independent" in conf:
                continue
            c = pick(v, ol, y, pool=lambda t, conf=conf: t.conference == conf, tiers=1)
            c["set"] = conf
            conf_rows.append(c)
        f = pick(v, ol.iloc[:0], y, pool=lambda t: t.cls == "FR", tiers=1)
        f["set"] = "freshman"
        fr_rows.append(f)
        h = v[(v.season == y) & v.qualified].sort_values("value", ascending=False).head(5)
        for i, (_, r) in enumerate(h.iterrows()):
            heis.append(dict(season=y, rank=i + 1, name=r["name"], school=r.school, slot=r.slot, value=float(r.value)))
    nat = pd.concat(allteams, ignore_index=True)
    pd.concat([nat] + conf_rows + fr_rows, ignore_index=True).to_csv(OUT / "all_savant_teams.csv", index=False)
    heis = pd.DataFrame(heis)
    heis.to_csv(OUT / "savant_heisman.csv", index=False)
    # ---- sanity check against the major awards (ESPN awards endpoint, athlete ids) ------
    aw = pd.read_parquet(WORK / "awards.parquet")
    aw = aw[aw.season.isin(USABLE)]
    v["slot_rank"] = v[v.qualified].groupby(["season", "slot"]).value.rank(ascending=False)
    tier = nat[nat.pid.notna()].assign(pid=lambda t: t.pid.astype("int64")).groupby(["season", "pid"]).tier.min().rename("tier").reset_index()
    best = v.sort_values("value", ascending=False).drop_duplicates(["season", "pid"])
    a = aw.merge(best[["season", "pid", "name", "school", "slot", "value", "slot_rank", "qualified", "n", "srate", "repl", "mu"]],
                 on=["season", "pid"], how="left").merge(tier, on=["season", "pid"], how="left")
    ol_award = a.award.str.contains("Outland|Rimington")
    scor = a[~ol_award & a.slot.notna()]
    res["awards"] = {"winners_checked": int(len(scor)), "found_in_our_data": int(a.slot.notna().sum()), "winners_total": int(len(a)),
                     "on_first_team": float((scor.tier == 1).mean()), "on_any_team": float(scor.tier.notna().mean()),
                     "median_slot_rank": float(scor.slot_rank.median()),
                     "heisman_winner_rank_overall": {}}
    v["overall_rank"] = v[v.qualified].groupby("season").value.rank(ascending=False)
    hw = aw[aw.award == "Heisman"].merge(v.sort_values("value", ascending=False).drop_duplicates(["season", "pid"])[["season", "pid", "name", "overall_rank", "slot_rank", "slot"]],
                                         on=["season", "pid"], how="left")
    res["awards"]["heisman_winner_rank_overall"] = {int(r.season): (r["name"], None if pd.isna(r.overall_rank) else int(r.overall_rank)) for _, r in hw.iterrows()}
    a.to_csv(OUT / "awards_check.csv", index=False)
    by = scor.groupby("season").agg(winners=("pid", "size"), first=("tier", lambda s: int((s == 1).sum())), any_team=("tier", lambda s: int(s.notna().sum())))
    lines = ["| season | award winners checked | on our 1st team | on our 1st, 2nd or 3rd | five biggest disagreements (award: player, our rank at his position, why) |",
             "|---|---:|---:|---:|---|"]
    for y, r in by.iterrows():
        miss = scor[(scor.season == y)].sort_values("slot_rank", ascending=False).drop_duplicates("pid").head(5)
        bits = []
        for _, m_ in miss.iterrows():
            if pd.isna(m_.slot_rank):
                why = "did not reach the qualifying sample"
            else:
                pool = v[(v.season == y) & (v.slot == m_.slot) & v.qualified]
                vol_pct = (pool.n < m_.n).mean() * 100
                rate_pct = (pool.srate < m_.srate).mean() * 100
                why = f"rate {rate_pct:.0f}th percentile, volume {vol_pct:.0f}th"
            rk = "unranked" if pd.isna(m_.slot_rank) else f"#{int(m_.slot_rank)} {m_.slot}"
            bits.append(f"{m_.award.split(' (')[0]}: {m_['name']} ({rk}; {why})")
        lines.append(f"| {y} | {int(r.winners)} | {int(r['first'])} | {int(r.any_team)} | " + "; ".join(bits) + " |")
    (OUT / "awards_check.md").write_text("\n".join(lines) + "\n")
    # ---- the partial AP table (hand-entered; see the file's source column) --------------------
    apf = REPO / "research" / "cfb" / "ap_first_team_partial.csv"
    if apf.exists():
        ap = pd.read_csv(apf)
        vv = v.assign(key=v["name"].str.lower().str.replace(r"[^a-z ]", "", regex=True).str.replace(r"\s+(jr|ii|iii|iv)$", "", regex=True))
        ap["key"] = ap.player.str.lower().str.replace(r"[^a-z ]", "", regex=True).str.replace(r"\s+(jr|ii|iii|iv)$", "", regex=True)
        m = ap.merge(vv.sort_values("value", ascending=False).drop_duplicates(["season", "key"])[["season", "key", "pid", "slot", "slot_rank", "value"]],
                     on=["season", "key"], how="left").merge(tier, on=["season", "pid"], how="left")
        m.to_csv(OUT / "ap_partial_check.csv", index=False)
        res["ap_partial"] = {int(y): {"ap_first_teamers_entered": int(len(g)), "matched_to_a_player": int(g.pid.notna().sum()),
                                      "on_our_first_team": int((g.tier == 1).sum()), "on_any_of_our_teams": int(g.tier.notna().sum())}
                             for y, g in m.groupby("season")}
    (OUT / "value_report.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps(res, indent=1, default=float)[:3500])
    # readable national teams
    lines = []
    for y in USABLE:
        lines += [f"### {y}", "", "| slot | 1st team | 2nd team | 3rd team |", "|---|---|---|---|"]
        n = nat[nat.season == y]
        for slot, cnt in SHAPE:
            cells = []
            for t in (1, 2, 3):
                k = n[(n.slot == slot) & (n.tier == t)]
                cells.append("<br>".join(f"{r['name']}, {r.school} ({r.value:+.0f})" if slot != "OL unit" else f"{r.school} ({r.value:+.0f})" for _, r in k.iterrows()))
            lines.append(f"| {slot} | " + " | ".join(cells) + " |")
        h = heis[heis.season == y]
        lines += ["", "Savant Heisman: " + "; ".join(f"{int(r['rank'])}. {r['name']}, {r.school} ({r.slot}, {r.value:+.0f})" for _, r in h.iterrows()), ""]
        f = pd.concat(fr_rows)
        f = f[f.season == y]
        lines += ["Freshman team: " + "; ".join(f"{r.slot} {r['name']}, {r.school}" for _, r in f.iterrows() if r.slot != "OL unit"), ""]
    (OUT / "all_savant_national.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
