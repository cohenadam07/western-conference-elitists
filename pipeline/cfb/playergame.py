"""Player-game tables: every numerator and denominator the player studies need.

    python -m pipeline.cfb.playergame [filt]      # filt = cfbd (default) | wp | all

Writes, for 2014-2026, work/pg_<table>.parquet:
  qb     one row per passer per game     (dropbacks, EPA, success, sacks, INT ...)
  rush   one row per rusher per game
  rec    one row per receiver per game   (targets, catches, EPA ...)
  team   one row per offence per game    (the denominators: team plays, dropbacks, rushes;
                                          and whether incompletion targets were named)
  dfn    one row per defender per game   (sacks, TFL, INT, PBU, FF, run stops, tackles and the
                                          EPA the offence lost on those plays; box-score
                                          tackles / TFL / PD / hurries where the box has them)
  kick   one row per field-goal attempt
  punt   one row per punt
  ret    one row per kick or punt return
  roster one row per player per season   (position, class, team, size)

There are no snap counts in any free source, so every rate downstream is per
team play, dropback, target or rush (PROMPT-1 step 10).

Defender ids, by source (measured in completeness.py):
  * ESPN's own participants (sackedBy, passDefender, forcedBy, tackler, assistedBy) first;
  * the release's text-parsed ids where a play has no participant (they agree
    with participants on 99.5%+ of plays that have both);
  * interceptions the play text never names (about half of them in 2021-2023)
    are allocated from the box score's "interceptions" category, which is
    complete in every season: the un-named interception plays of a team-game
    are shared among its box-score interceptors not already credited.
"""
import sys
import numpy as np
import pandas as pd
from .paths import RAW, WORK
from .teamgame import scrimmage, success, EXPL_RUSH, EXPL_PASS, MIN_PLAYS
from . import expand, pgx

SEASONS = [2009, 2010, 2011, 2012] + list(range(2014, 2027))


def _credit(k, mask, cols_primary, cols_fallback, stat):
    """Long credit rows for one event type: equal shares among the named defenders."""
    p = k.loc[mask, ["game_id", "deff", "epa"] + cols_primary + cols_fallback]
    a = p[cols_primary].to_numpy(dtype=float)
    if cols_fallback:
        b = p[cols_fallback].to_numpy(dtype=float)
        use_b = np.isnan(a).all(axis=1)
        if b.shape[1] < a.shape[1]:
            b = np.hstack([b, np.full((len(b), a.shape[1] - b.shape[1]), np.nan)])
        a = np.where(use_b[:, None], b[:, :a.shape[1]], a)
    n = (~np.isnan(a)).sum(axis=1)
    rows = []
    for j in range(a.shape[1]):
        ok = ~np.isnan(a[:, j])
        rows.append(pd.DataFrame({"game_id": p.game_id.to_numpy()[ok], "team": p.deff.to_numpy()[ok],
                                  "pid": a[ok, j].astype("int64"), "stat": stat, "credit": 1.0 / n[ok],
                                  "epa": p.epa.to_numpy()[ok] / n[ok]}))
    named = int((n > 0).sum())
    return pd.concat(rows, ignore_index=True), named, int(mask.sum())


def season_tables(y, games, filt):
    g = games[(games.season == y) & games.fbs_game & games.final]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    e = pd.read_parquet(WORK / f"epa_{y}.parquet")
    for c in ("ep", "epa", "wp", "garbage_cfbd", "garbage_wp"):
        d[c] = e[c].to_numpy()
    x = pd.read_parquet(WORK / f"xtra_{y}.parquet", columns=["play_id", "text", "pen1", "pen2"])
    d = d.merge(x, on="play_id", how="left")
    d = d[d.game_id.isin(g.game_id) & d.off.notna()].copy()
    n = d[d.cat.isin(["rush", "pass"])].groupby("game_id").size()
    d = d[d.game_id.isin(n[n >= MIN_PLAYS].index)]
    d["off"] = d.off.astype("int64")
    d["deff"] = d.deff.astype("int64")
    d["garb"] = False if filt == "all" else d["garbage_" + filt].fillna(False)
    d["sc"] = scrimmage(d)
    d["succ"] = success(d) & d.sc
    d["is_pass"] = d.sc & (d.cat == "pass")
    d["is_rush"] = d.sc & (d.cat == "rush")
    d["attp"] = d.is_pass & d.f_att & ~d.f_sack
    d["comp"] = d.attp & d.f_comp
    d["pdn"] = d.sc & (((d.down == 2) & (d.dist >= 8)) | ((d.down >= 3) & (d.dist >= 5)))
    d["epa0"] = d.epa.fillna(0.0)
    d["epa_ok"] = d.epa.notna()
    # completion % over expected: a throw's expected completion is the season's FBS completion rate on
    # throws of the same depth, side, down and distance to go (cells under 100 throws fall back to
    # depth and side). Only throws whose depth the stat crew charted count (the play text has it from 2025).
    d["xc"] = np.nan
    if "p_deep" in d.columns and d.p_deep.notna().any():
        th = d[d.attp & d.p_deep.notna() & d.p_side.notna()].assign(
            db_=lambda x: pd.cut(x.dist, [-1, 3, 6, 10, 99], labels=False), dn_=lambda x: x.down.clip(1, 4))
        cell = th.groupby(["p_deep", "p_side", "dn_", "db_"]).comp.agg(["mean", "size"])
        wide = th.groupby(["p_deep", "p_side"]).comp.mean().rename("wide")
        th = th.join(cell, on=["p_deep", "p_side", "dn_", "db_"]).join(wide, on=["p_deep", "p_side"])
        d.loc[th.index, "xc"] = np.where(th["size"] >= 100, th["mean"], th.wide)
    d["depth_att"] = d.xc.notna()
    d["cpoe"] = np.where(d.depth_att, d.comp.astype(float) - d.xc.fillna(0), 0.0)
    # 1.1.0: the expansion's per-play columns (expand.py) and the charted layer (charting.py)
    d = expand.charted(expand.enrich(expand.outcome_cols(d, games), y), y)
    k = d[d.sc & ~d.garb]
    out = {}

    def agg(frame, key, **named):
        cols = {}
        for name, (col, how) in named.items():
            cols[name] = (col, how)
        return frame.groupby(["game_id", "off", key]).agg(**cols).reset_index().rename(columns={"off": "team", key: "pid"})

    # ---- passers --------------------------------------------------------------
    p = k[k.is_pass & k.passer.notna()].assign(
        e_pd=lambda x: np.where(x.pdn, x.epa0, 0.0), e_sd=lambda x: np.where(~x.pdn, x.epa0, 0.0),
        cyds=lambda x: np.where(x.comp, x.yards, 0), ex=lambda x: x.comp & (x.yards >= EXPL_PASS),
        td=lambda x: x.comp & (x.pts == 7), sd=lambda x: ~x.pdn)
    qb = agg(p, "passer", db=("is_pass", "sum"), epa=("epa0", "sum"), epa_n=("epa_ok", "sum"), succ=("succ", "sum"),
             sacks=("f_sack", "sum"), ints=("f_int", "sum"), att=("attp", "sum"), cmp=("comp", "sum"), yards=("cyds", "sum"),
             expl=("ex", "sum"), td=("td", "sum"), pd_db=("pdn", "sum"), sd_db=("sd", "sum"), pd_epa=("e_pd", "sum"),
             sd_epa=("e_sd", "sum"), cpoe=("cpoe", "sum"), att_depth=("depth_att", "sum"))
    # ---- rushers --------------------------------------------------------------
    r = k[k.is_rush & k.rusher.notna()].assign(ex=lambda x: x.yards >= EXPL_RUSH, st=lambda x: x.yards <= 0,
                                               td=lambda x: x.pts == 7)
    ru = agg(r, "rusher", rush=("is_rush", "sum"), epa=("epa0", "sum"), epa_n=("epa_ok", "sum"), succ=("succ", "sum"),
             expl=("ex", "sum"), stuff=("st", "sum"), yards=("yards", "sum"), td=("td", "sum"), fum=("f_fum", "sum"),
             scr=("f_scramble", "sum"))
    # ---- receivers ------------------------------------------------------------
    c = k[k.attp & k.receiver.notna()].assign(cyds=lambda x: np.where(x.comp, x.yards, 0),
                                              ex=lambda x: x.comp & (x.yards >= EXPL_PASS), td=lambda x: x.comp & (x.pts == 7))
    rc = agg(c, "receiver", tgt=("attp", "sum"), rec=("comp", "sum"), epa=("epa0", "sum"), epa_n=("epa_ok", "sum"),
             succ=("succ", "sum"), yards=("cyds", "sum"), expl=("ex", "sum"), td=("td", "sum"))
    # ---- team denominators ----------------------------------------------------
    k2 = k.assign(inc=lambda x: x.attp & ~x.f_comp & ~x.f_int, incn=lambda x: x.attp & ~x.f_comp & ~x.f_int & x.receiver.notna(),
                  un=lambda x: x.attp & ~x.f_comp & ~x.f_int & x.receiver.isna(),
                  un_e=lambda x: np.where(x.attp & ~x.f_comp & ~x.f_int & x.receiver.isna(), x.epa0, 0.0))
    # un / un_epa: incompletions with no named target (interceptions are left with the passer)
    tm = k2.groupby(["game_id", "off"]).agg(plays=("sc", "sum"), db=("is_pass", "sum"), rush=("is_rush", "sum"),
                                            att=("attp", "sum"), inc=("inc", "sum"), incn=("incn", "sum"),
                                            cmp=("comp", "sum"), pyards=("yards", "sum"), un=("un", "sum"),
                                            un_epa=("un_e", "sum")).reset_index().rename(columns={"off": "team"})
    allp = d[d.sc].groupby(["game_id", "off"]).agg(plays_all=("sc", "sum"), garb=("garb", "sum")).reset_index().rename(columns={"off": "team"})
    tm = tm.merge(allp, on=["game_id", "team"], how="right").fillna(0)
    dplays = k.groupby(["game_id", "deff"]).agg(dplays=("sc", "sum"), ddb=("is_pass", "sum"), drush=("is_rush", "sum")).reset_index().rename(columns={"deff": "team"})
    tm = tm.merge(dplays, on=["game_id", "team"], how="left")
    tm["tgt_tracked"] = (tm.incn >= 0.9 * tm.inc) & (tm.inc >= 5)
    # ---- defenders ------------------------------------------------------------
    cov = {}
    parts = []
    sack = k.is_pass & k.f_sack
    tfl = k.sc & (k.yards < 0) & ~k.f_sack & ~(k.f_att & ~k.f_comp)
    isint = k.is_pass & k.f_int
    pbu = k.is_pass & (k.f_pbu | k.pbu_by.notna() | k.pdef1.notna()) & ~k.f_int
    ff = k.sc & (k.f_ff | k.ff_by.notna() | k.ffby1.notna())
    stop = k.is_rush & ~k.succ & ~k.f_sack
    kk = k.assign(none1=np.nan)
    for name, mask, prim, fall in (
            ("sack", sack, ["skby1", "skby2"], ["sack1", "sack2"]),
            ("int", isint, ["pdef1"], ["int_by"]),
            ("pbu", pbu, ["pdef1"], ["pbu_by"]),
            ("ff", ff, ["ffby1"], ["ff_by"]),
            ("tfl", tfl, ["tk1", "tk2"], ["ast1", "ast2"]),
            ("stop", stop, ["tk1", "tk2"], ["ast1", "ast2"]),
            ("tkl", k.sc, ["tk1", "tk2"], [])):
        rows, named, total = _credit(kk, mask, prim, fall, name)
        cov[name] = (named, total)
        parts.append(rows)
    ast = k.loc[k.sc, ["game_id", "deff", "ast1", "ast2"]]
    for col in ("ast1", "ast2"):
        a = ast[ast[col].notna()]
        parts.append(pd.DataFrame({"game_id": a.game_id.to_numpy(), "team": a.deff.to_numpy(), "pid": a[col].astype("int64").to_numpy(),
                                   "stat": "ast", "credit": 1.0, "epa": 0.0}))
    cr = pd.concat(parts, ignore_index=True)
    # interceptions named only in the box score
    pb = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet")
    pb = pb[pb.game_id.isin(d.game_id.unique()) & pb.athlete_id.notna()].copy()
    pb["pid"] = pd.to_numeric(pb.athlete_id, errors="coerce")
    pb = pb[pb.pid.notna()]
    pb["pid"] = pb.pid.astype("int64")
    pb["team"] = pb.team_id.astype("int64")
    ib = pb[pb.category == "interceptions"].copy()
    ib["n"] = pd.to_numeric(ib.interceptions, errors="coerce").fillna(0)
    ib = ib.groupby(["game_id", "team", "pid"]).n.sum().reset_index()
    have = cr[cr.stat == "int"].groupby(["game_id", "team", "pid"]).credit.sum().rename("have").reset_index()
    ib = ib.merge(have, on=["game_id", "team", "pid"], how="left").fillna({"have": 0})
    ib["need"] = (ib.n - ib.have).clip(lower=0)
    un = kk[isint & kk.pdef1.isna() & kk.int_by.isna()].groupby(["game_id", "deff"]).agg(u=("epa0", "size"), e=("epa0", "mean")).reset_index().rename(columns={"deff": "team"})
    ib = ib[ib.need > 0].merge(un, on=["game_id", "team"], how="inner")
    tot = ib.groupby(["game_id", "team"]).need.transform("sum")
    ib["credit"] = ib.need * np.minimum(1.0, ib.u / tot)
    box_int = pd.DataFrame({"game_id": ib.game_id, "team": ib.team, "pid": ib.pid, "stat": "int", "credit": ib.credit,
                            "epa": ib.e * ib.credit})
    cov["int_box_added"] = (float(box_int.credit.sum()), int(un.u.sum()))
    cr = pd.concat([cr, box_int], ignore_index=True)
    w = cr.pivot_table(index=["game_id", "team", "pid"], columns="stat", values=["credit", "epa"], aggfunc="sum", fill_value=0.0)
    w.columns = [f"{s}" if v == "credit" else f"{s}_epa" for v, s in w.columns]
    dfn = w.reset_index()
    # box-score defence (complete from 2024; about half of 2023; a handful of games before)
    bd = pb[pb.category == "defensive"].copy()
    for src, dst in (("totalTackles", "b_tkl"), ("soloTackles", "b_solo"), ("sacks", "b_sack"), ("tacklesForLoss", "b_tfl"),
                     ("passesDefended", "b_pd"), ("hurries", "b_hur")):
        bd[dst] = pd.to_numeric(bd[src], errors="coerce") if src in bd.columns else np.nan
    bd = bd.groupby(["game_id", "team", "pid"])[["b_tkl", "b_solo", "b_sack", "b_tfl", "b_pd", "b_hur"]].sum(min_count=1).reset_index()
    bd["has_box"] = True
    dfn = dfn.merge(bd, on=["game_id", "team", "pid"], how="outer")
    for col in [c for c in dfn.columns if c not in ("game_id", "team", "pid", "has_box") and not c.startswith("b_")]:
        dfn[col] = dfn[col].fillna(0.0)
    boxgames = bd.groupby(["game_id", "team"]).b_tkl.sum()
    boxgames = set(boxgames[boxgames > 20].index)
    dfn["has_box"] = [(a, b) in boxgames for a, b in zip(dfn.game_id, dfn.team)]
    # ---- kicks, punts, returns ---------------------------------------------------
    kd = d[~d.garb & (d.period <= 4)]
    fg = kd[(kd.cat == "fg") & kd.yds_fg.notna()]
    kick = pd.DataFrame({"game_id": fg.game_id, "team": fg.off, "pid": fg.kicker, "dist": fg.yds_fg,
                         "made": fg.ptype == "Field Goal Good", "blocked": fg.ptype.str.contains("Blocked"), "epa": fg.epa})
    pu = kd[kd.cat == "punt"]
    punt = pd.DataFrame({"game_id": pu.game_id, "team": pu.off, "pid": pu.punter, "ytg": pu.ytg, "epa": pu.epa,
                         "gross": pu.yds_punted, "ret": pu.yds_punt_ret, "blocked": pu.ptype.str.contains("Blocked")})
    ko = kd[(kd.cat == "kickoff") & kd.ko_ret.notna()]
    ret = pd.concat([
        pd.DataFrame({"game_id": ko.game_id, "team": ko.off, "pid": ko.ko_ret, "kind": "kick", "epa": ko.epa, "ytg": 75.0}),
        pd.DataFrame({"game_id": pu[pu.punt_ret.notna()].game_id, "team": pu[pu.punt_ret.notna()].deff,
                      "pid": pu[pu.punt_ret.notna()].punt_ret, "kind": "punt", "epa": -pu[pu.punt_ret.notna()].epa,
                      "ytg": pu[pu.punt_ret.notna()].ytg})], ignore_index=True)
    out = {"qb": qb, "rush": ru, "rec": rc, "team": tm, "dfn": dfn, "kick": kick, "punt": punt, "ret": ret}
    out = pgx.extend(d, k, out, y, filt)
    gg = g.set_index("game_id")
    for name, t in out.items():
        t["season"] = y
        t["date"] = t.game_id.map(gg.date)
        t["week"] = t.game_id.map(gg.week)
        opp = np.where(t.team == t.game_id.map(gg.home), t.game_id.map(gg.away), t.game_id.map(gg.home))
        t["opp"] = opp
        if "pid" in t.columns:
            t = out[name] = t.dropna(subset=["pid"]).astype({"pid": "int64"})
    return out, cov


def roster(y):
    r = pd.read_parquet(RAW / "espn_cfb_rosters" / f"cfb_rosters_{y}.parquet")
    keep = ["season", "team_id", "athlete_id", "position_abbreviation", "position_name", "athlete_display_name", "jersey", "weight",
            "height", "experience_abbreviation", "experience_years", "experience_display_value", "games_rostered",
            "headshot_href", "birth_place_city", "birth_place_state", "cfbd_recruit_ids"]
    r = r[[c for c in keep if c in r.columns]].rename(columns={"team_id": "team", "athlete_id": "pid", "position_abbreviation": "pos",
                                                               "experience_abbreviation": "cls", "athlete_display_name": "name"})
    r["pid"] = pd.to_numeric(r.pid, errors="coerce")
    r = r[r.pid.notna()]
    r["pid"] = r.pid.astype("int64")
    r["team"] = pd.to_numeric(r.team, errors="coerce").astype("int64")
    r["season"] = y
    return r


def main(filt="cfbd", seasons=None):
    """filt: cfbd (garbage time out, the default tables pg_<name>.parquet) or all (garbage time in,
    written as pg_<name>_all.parquet). `seasons` rebuilds only those and keeps the rest of each table."""
    games = pd.read_parquet(WORK / "games.parquet")
    suffix = "" if filt == "cfbd" else f"_{filt}"
    acc = {}
    covs = []
    for y in (seasons or SEASONS):
        out, cov = season_tables(y, games, filt)
        for kname, t in out.items():
            acc.setdefault(kname, []).append(t)
        acc.setdefault("roster", []).append(roster(y))
        row = {"season": y}
        for s, (a, b) in cov.items():
            row[s] = round(a / b, 3) if b else None
        covs.append(row)
        print(row, flush=True)
    for kname, parts in acc.items():
        f = WORK / f"pg_{kname}{suffix}.parquet"
        new = pd.concat(parts, ignore_index=True)
        if seasons and f.exists():
            old = pd.read_parquet(f)
            new = pd.concat([old[~old.season.isin(seasons)], new], ignore_index=True)
        new.to_parquet(f, index=False)
    if not seasons and filt == "cfbd":
        pd.DataFrame(covs).to_csv(WORK / "defender_id_coverage.csv", index=False)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else "cfbd", [int(x) for x in a[1:]] or None)
