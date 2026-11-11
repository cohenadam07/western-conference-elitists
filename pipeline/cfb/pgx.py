"""1.1.0: the player-game expansion. playergame.season_tables calls `extend` once per season and filter.

New columns on the existing tables (one row per player per game, as before), and five new tables:

  qb     first downs, situational dropbacks and EPA (third down, red zone, two-minute, middle 8, game in doubt),
         sack yards, WPA, expected touchdowns; Tier B: air yards, YAC, depth buckets, direction, completion over
         expected, pressure, formation and tempo
  rush   first downs, Connelly's line / second-level / open-field / highlight yards, opportunities, short
         yardage and goal line, expected touchdowns, WPA, fumbles; Tier B: direction, formation
  rec    first downs, red-zone and third-down targets, expected touchdowns, WPA; Tier B: air yards, YAC and YAC
         over expected, depth, direction, end-zone targets
  team   the shares' denominators (red-zone and third-down attempts and carries, charted attempts and air
         yards) and the Tier B team denominators (charted dropbacks and rushes, pressures, havoc)
  dfn    solo and assisted tackles, tackles for loss on runs and on passes, sack EPA and yards, third-down and
         strip sacks, fumble recoveries, interception return yards (box); Tier B: hurries, pressures,
         tackle depth, run-stop rate, break-ups, credited coverage
  pen    penalties by the player ESPN names as penalized (accepted ones; declined and offsetting are not his)
  drv    a quarterback's drives (he took the most dropbacks): points, touchdowns, three-and-outs
  ret    every kick and punt return and fair catch (Tier B: muffs)
  ko     every kickoff, by kicker: touchbacks and the kicking side's EPA
  pbox   the box score's punting line: punts, inside the 20, touchbacks
"""
import re
import numpy as np
import pandas as pd
from .paths import RAW, WORK

KEYS = ["game_id", "team", "pid"]


def _agg(frame, key, **named):
    return frame.groupby(["game_id", "off", key]).agg(**named).reset_index().rename(columns={"off": "team", key: "pid"})


def _join(base, add):
    if add is None or not len(add):
        return base
    return base.merge(add, on=KEYS, how="left").fillna({c: 0 for c in add.columns if c not in KEYS})


def _credit_ids(frame, cols, team_col, **vals):
    """Long rows: one per named id in `cols`, each carrying the play's values in full (not shared)."""
    parts = []
    for c in cols:
        if c not in frame.columns:
            continue
        m = frame[c].notna()
        if not m.any():
            continue
        x = frame[m]
        row = {"game_id": x.game_id.to_numpy(), "team": x[team_col].to_numpy(), "pid": x[c].astype("int64").to_numpy()}
        for k, v in vals.items():
            row[k] = (x[v].to_numpy(dtype=float) if isinstance(v, str) else np.full(len(x), float(v)))
        parts.append(pd.DataFrame(row))
    if not parts:
        return None
    return pd.concat(parts, ignore_index=True).groupby(KEYS).sum().reset_index()


def extend(d, k, out, y, filt):
    """d: every play of the season's FBS-vs-FBS games (base flags, enrich, charted); k: scrimmage plays outside
    garbage time (the filter's); out: playergame's tables, extended in place."""
    k = k.copy()
    k["one"] = 1.0
    w = lambda m, v="epa0": np.where(m, k[v], 0.0)
    # ---------------------------------------------------------------- quarterbacks (his dropbacks)
    p = k[k.is_pass & k.passer.notna()].copy()
    p = p.assign(rz_td=p.rz & p.is_td, third_fd=p.dn34 & p.fd, short_fd=p.short & p.fd, tm_epa=np.where(p.twomin, p.epa0, 0.0),
                 m8_epa=np.where(p.mid8, p.epa0, 0.0), dbt_epa=np.where(p.doubt, p.epa0, 0.0),
                 sack_yds=np.where(p.f_sack, p.yards, 0.0), pass_td=p.comp & p.is_td,
                 c_cyds=np.where(p.c_yacok, p.yards, 0.0), c_sh_cmp=p.c_airok & p.comp & (p.c_depth == "short"),
                 c_sh_att=p.c_airok & (p.c_depth == "short"), c_dp_cmp=p.c_deep & p.comp,
                 fum_db=p.f_fum & (p.fumbler.isna() | (p.fumbler == p.passer)))
    qa = dict(fd=("fd", "sum"), rz_db=("rz", "sum"), rz_td=("rz_td", "sum"), third_db=("dn34", "sum"), third_fd=("third_fd", "sum"),
              short_db=("short", "sum"), short_fd=("short_fd", "sum"), tm_db=("twomin", "sum"), tm_epa=("tm_epa", "sum"),
              m8_db=("mid8", "sum"), m8_epa=("m8_epa", "sum"), dbt_db=("doubt", "sum"), dbt_epa=("dbt_epa", "sum"),
              sack_yds=("sack_yds", "sum"), wpa=("wpa0", "sum"), xtd=("xtd", "sum"), pass_td=("pass_td", "sum"), fum_db=("fum_db", "sum"))
    for c in ("c_db", "c_att", "c_airok", "c_air0", "c_cair", "c_yacok", "c_yac0", "c_cyds", "c_deep", "c_behind", "c_tl", "c_tm", "c_tr",
              "c_cpoe", "c_cpoe_n", "c_press", "c_hur", "c_sack", "c_press_epa", "c_clean", "c_clean_epa", "c_shot_db", "c_nh",
              "c_sh_cmp", "c_sh_att", "c_dp_cmp"):
        qa[c] = (c, "sum")
    for b in ("b0", "b1", "b2", "b3"):
        for s in ("att", "cmp", "yds", "epa"):
            qa[f"c_{b}_{s}"] = (f"c_{b}_{s}", "sum")
    p["c_shot_db_epa"] = np.where(p.c_shot_db, p.epa0, 0.0)
    p["c_uc_db"] = p.c_db & ~p.c_shotgun
    p["c_uc_db_epa"] = np.where(p.c_uc_db, p.epa0, 0.0)
    p["c_nh_epa2"] = np.where(p.c_nh, p.epa0, 0.0)
    p["c_db_epa"] = np.where(p.c_db, p.epa0, 0.0)
    for c in ("c_shot_db_epa", "c_uc_db", "c_uc_db_epa", "c_nh_epa2", "c_db_epa"):
        qa[c] = (c, "sum")
    out["qb"] = _join(out["qb"], _agg(p, "passer", **qa))
    # ---------------------------------------------------------------- rushers
    r = k[k.is_rush & k.rusher.notna()].copy()
    own_fum = r.f_fum & (r.fumbler.isna() | (r.fumbler == r.rusher))
    r = r.assign(short_fd=r.short & r.fd, gl_td=r.gl & r.is_td, fum_own=own_fum, fum_lost_own=own_fum & r.f_fum_lost,
                 c_shot_rush_epa=np.where(r.c_shot_rush, r.epa0, 0.0), c_uc_rush_epa=np.where(r.c_uc_rush, r.epa0, 0.0),
                 c_rush_epa=np.where(r.c_rush, r.epa0, 0.0), qbs=r.short & (r.dist <= 1))
    ra = dict(fd=("fd", "sum"), ly=("ly", "sum"), slv=("slv", "sum"), ofy=("ofy", "sum"), opp4=("opp4", "sum"), hly=("hly", "sum"),
              short=("short", "sum"), short_fd=("short_fd", "sum"), gl=("gl", "sum"), gl_td=("gl_td", "sum"), rz=("rz", "sum"),
              xtd=("xtd", "sum"), wpa=("wpa0", "sum"), fum_own=("fum_own", "sum"), fum_lost_own=("fum_lost_own", "sum"),
              tm_epa=("epa0", lambda s: 0.0), c_rush=("c_rush", "sum"), c_rush_epa=("c_rush_epa", "sum"),
              c_shot_rush=("c_shot_rush", "sum"), c_shot_rush_epa=("c_shot_rush_epa", "sum"), c_uc_rush=("c_uc_rush", "sum"),
              c_uc_rush_epa=("c_uc_rush_epa", "sum"))
    ra.pop("tm_epa")
    for s in ("l", "m", "r"):
        for c in ("", "_succ", "_ly", "_stuff", "_epa"):
            ra[f"c_r{s}{c}"] = (f"c_r{s}{c}", "sum")
    out["rush"] = _join(out["rush"], _agg(r, "rusher", **ra))
    # ---------------------------------------------------------------- receivers (named targets)
    c = k[k.attp & k.receiver.notna()].copy()
    c = c.assign(rz_tgt=c.rz, third_tgt=c.dn34, rec_fd=c.fd, rec_td=c.comp & c.is_td, c_ez=c.c_airok & (c.c_spot_ytg <= 0),
                 c_sh_tgt=c.c_airok & (c.c_depth == "short"), c_dp_tgt=c.c_deep, c_sh_cmp=c.c_airok & (c.c_depth == "short") & c.comp,
                 c_dp_cmp=c.c_deep & c.comp, c_sh_epa=np.where(c.c_airok & (c.c_depth == "short"), c.epa0, 0.0),
                 c_dp_epa=np.where(c.c_deep, c.epa0, 0.0), c_cmp=c.c_airok & c.comp, c_xyac0=np.where(c.c_yacoe_n, c.c_xyac, 0.0),
                 c_tgt_epa=np.where(c.c_airok, c.epa0, 0.0), c_cyds=np.where(c.c_yacok, c.yards, 0.0))
    ca = dict(fd=("rec_fd", "sum"), rz_tgt=("rz_tgt", "sum"), third_tgt=("third_tgt", "sum"), xtd=("xtd_tgt", "sum"), wpa=("wpa0", "sum"))
    for col in ("c_att", "c_airok", "c_air0", "c_cair", "c_yacok", "c_yac0", "c_cyds", "c_xyac0", "c_yacoe", "c_yacoe_n", "c_deep", "c_ez",
                "c_tl", "c_tm", "c_tr", "c_sh_tgt", "c_dp_tgt", "c_sh_cmp", "c_dp_cmp", "c_sh_epa", "c_dp_epa", "c_cmp", "c_tgt_epa"):
        ca[col] = (col, "sum")
    out["rec"] = _join(out["rec"], _agg(c, "receiver", **ca))
    # ---------------------------------------------------------------- team denominators
    unn = k.attp & ~k.f_comp & ~k.f_int & k.receiver.isna()
    tq = k.assign(rz_att=k.attp & k.rz, third_att=k.attp & k.dn34, rz_rush=k.is_rush & k.rz, gl_rush=k.is_rush & k.gl,
                  un_xtd=np.where(unn, k.xtd_tgt, 0.0), un_wpa=np.where(unn, k.wpa0, 0.0), c_air_t=np.where(k.c_airok, k.c_air0, 0.0),
                  c_ez_t=k.c_airok & (k.c_spot_ytg <= 0), tgt_named=k.attp & k.receiver.notna())
    ta = tq.groupby(["game_id", "off"]).agg(rz_att=("rz_att", "sum"), third_att=("third_att", "sum"), rz_rush=("rz_rush", "sum"),
                                            gl_rush=("gl_rush", "sum"), un_xtd=("un_xtd", "sum"), un_wpa=("un_wpa", "sum"),
                                            c_db=("c_db", "sum"), c_att=("c_att", "sum"), c_airok=("c_airok", "sum"), c_air=("c_air_t", "sum"),
                                            c_rush=("c_rush", "sum"), c_ez=("c_ez_t", "sum"), c_press=("c_press", "sum"),
                                            proe_n=("proe_n", "sum"), neutral_x=("neutral_x", "sum")
                                            ).reset_index().rename(columns={"off": "team"})
    dd = k.assign(dhavoc=(k.sc & (k.yards < 0) & ~(k.f_att & ~k.f_comp & ~k.f_sack)) | (k.is_pass & (k.f_pbu | k.pbu_by.notna() | k.pdef1.notna()) & ~k.f_int)
                  | (k.sc & (k.f_ff | k.ff_by.notna() | k.ffby1.notna())) | (k.is_pass & k.f_int),
                  d3db=k.is_pass & k.dn34)
    db_ = dd.groupby(["game_id", "deff"]).agg(dhavoc=("dhavoc", "sum"), d3db=("d3db", "sum"), ddb_c=("c_db", "sum"), drush_c=("c_rush", "sum"),
                                              dpress_c=("c_press", "sum"), dplays_c=("c_ok", "sum"), datt_c=("c_att", "sum")
                                              ).reset_index().rename(columns={"deff": "team"})
    out["team"] = out["team"].merge(ta, on=["game_id", "team"], how="left").merge(db_, on=["game_id", "team"], how="left")
    for col in list(ta.columns) + list(db_.columns):
        if col not in ("game_id", "team"):
            out["team"][col] = out["team"][col].fillna(0)
    # ---------------------------------------------------------------- defenders
    kk = k
    tk = kk[["tk1", "tk2"]].notna().sum(axis=1) + kk[["ast1", "ast2"]].notna().sum(axis=1)
    kk = kk.assign(n_tkl=tk, solo1=np.where((tk == 1) & kk.tk1.notna(), kk.tk1, np.nan))
    parts = []
    solo = _credit_ids(kk, ["solo1"], "deff", solo=1.0)
    multi = kk[kk.n_tkl >= 2]
    asst = _credit_ids(multi, ["tk1", "tk2", "ast1", "ast2"], "deff", asst=1.0)
    sk = kk[kk.is_pass & kk.f_sack]
    skc = sk.assign(ids=sk[["skby1", "skby2"]].notna().sum(axis=1).where(lambda v: v > 0, sk[["sack1", "sack2"]].notna().sum(axis=1)))
    for i, (a, b) in enumerate((("skby1", "sack1"), ("skby2", "sack2"))):
        skc[f"s{i}"] = np.where(skc[["skby1", "skby2"]].notna().any(axis=1), skc[a], skc[b])
    skc["sh"] = 1.0 / skc.ids.clip(lower=1)
    skc["sy"] = skc.yards * skc.sh
    skc["s3"] = np.where(skc.dn34, skc.sh, 0.0)
    ffs = skc[["ffby1", "ff_by"]].bfill(axis=1).iloc[:, 0]
    skc["strip0"] = np.where(ffs.notna() & (ffs == skc.s0), skc.sh, 0.0)
    skc["strip1"] = np.where(ffs.notna() & (ffs == skc.s1), skc.sh, 0.0)
    sacks = []
    for i in (0, 1):
        m = skc[f"s{i}"].notna()
        x = skc[m]
        sacks.append(pd.DataFrame({"game_id": x.game_id, "team": x.deff, "pid": x[f"s{i}"].astype("int64"), "sack_yds": x.sy,
                                   "sack3": x.s3, "strip": x[f"strip{i}"]}))
    sacks = pd.concat(sacks, ignore_index=True).groupby(KEYS).sum().reset_index() if sacks else None
    tfl = kk.sc & (kk.yards < 0) & ~kk.f_sack & ~(kk.f_att & ~kk.f_comp)
    tf = kk[tfl]
    tfn = tf[["tk1", "tk2", "ast1", "ast2"]].notna().sum(axis=1).clip(lower=1)
    tf = tf.assign(sh=1.0 / tfn, run_=np.where(tf.is_rush, 1.0 / tfn, 0.0), pas_=np.where(tf.is_pass, 1.0 / tfn, 0.0))
    tfl_rows = _credit_ids(tf, ["tk1", "tk2", "ast1", "ast2"], "deff", tfl_run="run_", tfl_pass="pas_")
    # Tier B (charted games only)
    ch = kk[kk.c_ok]
    hur = _credit_ids(ch[ch.is_pass], ["c_hur1", "c_hur2"], "deff", chur=1.0)
    cs = ch[ch.is_pass & ch.f_sack]
    csk = []
    for a in ("skby1", "skby2"):
        x = cs[cs[a].notna()]
        csk.append(pd.DataFrame({"game_id": x.game_id, "team": x.deff, "pid": x[a].astype("int64"), "csack": 1.0}))
    x = cs[cs.skby1.isna() & cs.sack1.notna()]
    csk.append(pd.DataFrame({"game_id": x.game_id, "team": x.deff, "pid": x.sack1.astype("int64"), "csack": 1.0}))
    csk = pd.concat(csk, ignore_index=True).groupby(KEYS).sum().reset_index()
    tkp = ch[(ch.is_rush | ch.comp) & (ch.c_n_tk > 0)]
    tkp = tkp.assign(rstop=tkp.is_rush & ~tkp.succ, rtk=tkp.is_rush.astype(float))
    ctk = _credit_ids(tkp, ["c_tk1", "c_tk2", "c_tk3"], "deff", ctk=1.0, ctk_yds="yards", c_rtk="rtk", c_rstop="rstop")
    pbu = _credit_ids(ch[ch.attp], ["c_pbu1"], "deff", cpbu=1.0)
    cv = ch[ch.c_airok]
    cv = cv.assign(cov_air=cv.c_air0, cov_epa=cv.epa0)
    cov = _credit_ids(cv, ["c_pbu1", "c_tk1", "c_tk2", "c_tk3"], "deff", cov_n=1.0, cov_air="cov_air", cov_epa="cov_epa")
    dfn = out["dfn"]
    for add in (solo, asst, sacks, tfl_rows, hur, csk, ctk, pbu, cov):
        if add is not None and len(add):
            dfn = dfn.merge(add, on=KEYS, how="outer")
    for col in ("solo", "asst", "sack_yds", "sack3", "strip", "tfl_run", "tfl_pass", "chur", "csack", "ctk", "ctk_yds",
                "c_rtk", "c_rstop", "cpbu", "cov_n", "cov_air", "cov_epa"):
        if col not in dfn.columns:
            dfn[col] = 0.0
        dfn[col] = dfn[col].fillna(0.0)
    for col in dfn.columns:
        if col not in KEYS + ["has_box"] and not col.startswith("b_"):
            dfn[col] = dfn[col].fillna(0.0)
    dfn["has_box"] = dfn.has_box.fillna(False).astype(bool)
    # box: interception return yards (every season) and solo tackles (from 2024)
    pb = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet")
    pb = pb[pb.game_id.isin(set(d.game_id))].copy()
    pb["pid"] = pd.to_numeric(pb.athlete_id, errors="coerce")
    pb = pb[pb.pid.notna()]
    pb["pid"] = pb.pid.astype("int64")
    pb["team"] = pd.to_numeric(pb.team_id, errors="coerce").astype("int64")
    ib = pb[pb.category == "interceptions"].copy()
    ib["b_int_yds"] = pd.to_numeric(ib.interceptionYards, errors="coerce") if "interceptionYards" in ib.columns else np.nan
    ib = ib.groupby(KEYS).b_int_yds.sum(min_count=1).reset_index()
    dfn = dfn.merge(ib, on=KEYS, how="left")
    dfn["b_int_yds"] = dfn.b_int_yds.fillna(0.0)
    # fumble recoveries: the box score's (every season; the play participants name a recoverer on about one in ten)
    fb = pb[pb.category == "fumbles"].copy()
    fb["frec"] = pd.to_numeric(fb.fumblesRecovered, errors="coerce") if "fumblesRecovered" in fb.columns else np.nan
    fb = fb.groupby(KEYS).frec.sum(min_count=1).reset_index()
    dfn = dfn.merge(fb, on=KEYS, how="left")
    dfn["frec"] = dfn.frec.fillna(0.0)
    out["dfn"] = dfn
    # ---------------------------------------------------------------- penalties (every play, the player ESPN names)
    x = d[d.pen1.notna() | d.pen2.notna()]
    low = x.text.fillna("").str.lower()
    acc = ~low.str.contains("declined", regex=False) & ~low.str.contains("offsetting", regex=False) & ~low.str.contains("off-setting", regex=False)
    x = x[acc.to_numpy() & (x.period <= 4).to_numpy()]
    if filt != "all":
        x = x[~x.garb]
    rows = []
    for col in ("pen1", "pen2"):
        z = x[x[col].notna()]
        rows.append(pd.DataFrame({"game_id": z.game_id, "pid": z[col].astype("int64"), "pens": 1.0,
                                  "pen_yds": pd.to_numeric(z.pen_yards, errors="coerce").abs().fillna(0.0)}))
    pen = pd.concat(rows, ignore_index=True).groupby(["game_id", "pid"]).sum().reset_index()
    # his team in that game: the box score's, else the roster's
    tb = pb.drop_duplicates(["game_id", "pid"]).set_index(["game_id", "pid"]).team
    ros = pd.read_parquet(RAW / "espn_cfb_rosters" / f"cfb_rosters_{y}.parquet", columns=["team_id", "athlete_id"])
    ros = ros.assign(pid=pd.to_numeric(ros.athlete_id, errors="coerce"), team=pd.to_numeric(ros.team_id, errors="coerce")).dropna(subset=["pid", "team"])
    rteam = ros.drop_duplicates("pid").set_index(ros.drop_duplicates("pid").pid.astype("int64")).team.astype("int64")
    pen["team"] = tb.reindex(pd.MultiIndex.from_frame(pen[["game_id", "pid"]])).to_numpy()
    pen["team"] = pen.team.where(pen.team.notna(), pen.pid.map(rteam))
    g2 = d.drop_duplicates("game_id").set_index("game_id")
    pen = pen[pen.team.notna() & ((pen.team == pen.game_id.map(g2.home)) | (pen.team == pen.game_id.map(g2.away)))]
    pen["team"] = pen.team.astype("int64")
    out["pen"] = pen
    # ---------------------------------------------------------------- a quarterback's drives
    dr = d[d.cat.isin(["rush", "pass", "penalty", "punt", "fg"]) & (d.period <= 4) & d.drive_id.notna()]
    if filt != "all":
        dr = dr[~dr.garb]
    dbk = dr[dr.is_pass & dr.passer.notna()].groupby(["game_id", "drive_id", "passer"]).size().rename("n").reset_index()
    dbk = dbk.sort_values(["game_id", "drive_id", "n", "passer"], ascending=[True, True, False, True]).drop_duplicates(["game_id", "drive_id"])
    sc = dr[dr.sc]
    info = dr.groupby(["game_id", "drive_id"]).agg(off=("off", "first"), pts=("pts", "max"), ptsmin=("pts", "min"), plays=("sc", "sum"),
                                                   fds=("fd", "sum"), punt=("cat", lambda s: (s == "punt").any())).reset_index()
    info["dpts"] = np.where(info.pts > 0, info.pts, 0.0)
    info["dtd"] = info.pts == 7
    info["three_out"] = info.punt & (info.fds == 0) & (info.plays <= 3)
    info = info[info.plays > 0].merge(dbk, on=["game_id", "drive_id"], how="inner")
    out["drv"] = info.groupby(["game_id", "off", "passer"]).agg(drives=("drive_id", "size"), d_pts=("dpts", "sum"), d_td=("dtd", "sum"),
                                                                d_3out=("three_out", "sum")).reset_index().rename(
        columns={"off": "team", "passer": "pid"})
    # ---------------------------------------------------------------- returns, fair catches, kickoffs, the box's punting line
    kd = d[(d.period <= 4)] if filt == "all" else d[(d.period <= 4) & ~d.garb]
    low = kd.text.fillna("").str.lower()
    is_ko, is_pu = (kd.cat == "kickoff").to_numpy(), (kd.cat == "punt").to_numpy()
    onside = low.str.contains("onside", regex=False).to_numpy()
    tb = low.str.contains("touchback", regex=False).to_numpy()
    fc = low.str.contains("fair catch", regex=False).to_numpy()
    muff = low.str.contains("muff", regex=False).to_numpy()
    blocked = kd.ptype.str.contains("Blocked", regex=False).to_numpy()
    kd = kd.assign(_tb=tb, _fc=fc, _muff=muff, _onside=onside)
    ko = kd[is_ko & ~onside & kd.ko_kicker.notna()]
    out["ko"] = pd.DataFrame({"game_id": ko.game_id, "team": ko.deff, "pid": ko.ko_kicker.astype("int64"), "kos": 1.0, "ko_tb": ko._tb.astype(float),
                              "ko_epa": -ko.epa.fillna(0.0), "ko_epa_n": ko.epa.notna().astype(float)}).groupby(KEYS).sum().reset_index()
    # a kick or punt the receiving side fielded (return) or fair caught, credited to the man ESPN or the text names
    from .charting import Roster, _names
    ro = Roster(y)
    rows = []
    charted_games = set(d[d.c_ok].game_id)
    for kind, m, col in (("kick", is_ko & ~onside, "ko_ret"), ("punt", is_pu & ~blocked, "punt_ret")):
        z = kd[m]
        recv = z.off if kind == "kick" else z.deff
        rid = z[col].copy()
        # ESPN's 2026 feed attaches no returner on a fair catch: the text names him ("fair catch by #81 T.Sams")
        need = rid.isna() & z._fc
        for i in np.where(need.to_numpy())[0]:
            t = z.text.iloc[i]
            mm = re.search(r"fair catch by (#\d+ )?([A-Za-z][^,]*?)(?= at |,|$)", t or "")
            if mm:
                jj = int(mm.group(1)[1:]) if mm.group(1) else np.nan
                rid.iloc[i] = ro.resolve(recv.iloc[i], jj, mm.group(2))
        ry = (z.yds_kick_ret if kind == "kick" else z.yds_punt_ret).fillna(0.0)
        ret_ = rid.notna() & ~z._fc & ~z._tb
        td = z.ptype.isin(["Kickoff Return Touchdown"] if kind == "kick" else ["Punt Return Touchdown"])
        e = z.epa if kind == "kick" else -z.epa
        rows.append(pd.DataFrame({"game_id": z.game_id, "team": recv, "pid": rid, "kind": kind, "ret": ret_.astype(float),
                                  "fc": (z._fc & rid.notna()).astype(float), "ret_yds": np.where(ret_, ry, 0.0),
                                  "ret20": (ret_ & (ry >= 20)).astype(float), "ret_td": (ret_ & td).astype(float),
                                  "ret_epa": np.where(ret_, e.fillna(0.0), 0.0), "ret_epa_n": (ret_ & e.notna()).astype(float),
                                  "muff": (z._muff & rid.notna() & z.game_id.isin(charted_games)).astype(float),
                                  "chartgame": (z.game_id.isin(charted_games) & rid.notna()).astype(float)}))
    rt = pd.concat(rows, ignore_index=True)
    rt = rt[rt.pid.notna()]
    rt["pid"] = rt.pid.astype("int64")
    rt["team"] = rt.team.astype("int64")
    for kind in ("kick", "punt"):
        for col in ("ret", "fc", "ret_yds", "ret20", "ret_td", "ret_epa", "ret_epa_n"):
            rt[f"{kind[0]}{col}"] = np.where(rt.kind == kind, rt[col], 0.0)
    rt["muff_opp"] = rt.chartgame * ((rt.ret + rt.fc) > 0)
    rt = rt.drop(columns=["kind"]).groupby(KEYS).sum().reset_index()
    # counts, yards and touchdowns from the box score: the play text of some seasons stops at "kickoff for 62 yds"
    # (2,725 kickoffs in 2023), so the play-by-play misses returns the box lists. Per-return rates stay on the
    # returns the play-by-play identifies (pbp_*), which xcheck.py reports as a share of the box's.
    rt = rt.rename(columns={c: "pbp_" + c for c in ("kret", "pret", "kret_yds", "pret_yds", "kret_td", "pret_td", "ret_td")})
    rt["pbp_returns"] = rt.pbp_kret + rt.pbp_pret
    rb = []
    for cat, a, b_, c in (("kickReturns", "kickReturns", "kickReturnYards", "kickReturnTouchdowns"), ("puntReturns", "puntReturns", "puntReturnYards", "puntReturnTouchdowns")):
        x = pb[pb.category == cat].copy()
        k0 = "k" if cat.startswith("kick") else "p"
        for src, dst in ((a, f"{k0}ret"), (b_, f"{k0}ret_yds"), (c, f"{k0}ret_td")):
            x[dst] = pd.to_numeric(x[src], errors="coerce") if src in x.columns else np.nan
        rb.append(x.groupby(KEYS)[[f"{k0}ret", f"{k0}ret_yds", f"{k0}ret_td"]].sum(min_count=1).reset_index())
    rb = rb[0].merge(rb[1], on=KEYS, how="outer")
    rt = rt.merge(rb, on=KEYS, how="outer")
    for col in rt.columns:
        if col not in KEYS:
            rt[col] = rt[col].fillna(0.0)
    rt["ret_td"] = rt.kret_td + rt.pret_td
    out["retx"] = rt
    pp = pb[pb.category == "punting"].copy()
    for src, dst in (("punts", "bp_punts"), ("puntsInside20", "bp_in20"), ("touchbacks", "bp_tb"), ("puntYards", "bp_yds")):
        pp[dst] = pd.to_numeric(pp[src], errors="coerce") if src in pp.columns else np.nan
    pu = d[(d.cat == "punt") & (d.period <= 4) & d.punter.notna()]
    if filt != "all":
        pu = pu[~pu.garb]
    pr = pd.DataFrame({"game_id": pu.game_id, "team": pu.off, "pid": pu.punter.astype("int64"), "p_n": 1.0,
                       "p_ret_yds": pu.yds_punt_ret.fillna(0.0)}).groupby(KEYS).sum().reset_index()
    pbx = pp.groupby(KEYS)[["bp_punts", "bp_in20", "bp_tb", "bp_yds"]].sum(min_count=1).reset_index()
    out["pbox"] = pr.merge(pbx, on=KEYS, how="left")
    return out
