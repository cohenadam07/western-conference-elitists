"""Step 10. Player stat stability, 2014-2025.

    python -m pipeline.cfb.player_study

For every player stat in RESEARCH section 3, by position:
  * split-half reliability (200 random splits of each player-season's games,
    stepped up to the full season with Spearman-Brown);
  * the settle point k, by `pipeline/basketball/settle_points.py`'s method: the
    sample at which a player's own number and the FBS position mean carry equal
    weight, found by grid search for the k that best predicts the REST of his
    season from a small window of it, estimate = (n*x + k*mean) / (n + k);
    and, as a cross-check, Football Savant's closed form k = n(1-r)/r;
  * year-to-year correlation, separately for players who stayed and for
    players who changed schools (transfers come from roster team changes);
  * whether the opponent-adjusted number predicts next season better than raw.

Seasons: 2021 and 2022 are out (play-by-play under the 97% gate). Stats that a
season's play text cannot see are restricted to the seasons that can (SEASONS_*).
Denominators are dropbacks, rushes, targets or team plays: there are no snaps.
A skill player's "team plays" are those of the games in which he recorded any stat; a defender's are
every defensive play of his team's season (see defender_frame).
"""
import json
import numpy as np
import pandas as pd
from .paths import WORK, OUT
from . import teamgame
from .team_study import ridge_adjust

USABLE = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2023, 2024, 2025]
PBU_OK = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025]
FF_OK = [2014, 2015, 2016, 2017, 2018, 2019, 2020]
BOX_OK = [2024, 2025]
N_SPLITS = 200
RNG = np.random.default_rng(20261110)
K_GRID = sorted({round(10 ** (i / 40), 1) for i in range(0, 161)})     # 1 .. 10,000, as settle_points.py
POS_GROUP = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "DL": "DL", "DE": "DL", "DT": "DL", "NT": "DL",
             "EDGE": "DL", "LB": "LB", "DB": "DB", "CB": "DB", "S": "DB", "PK": "K", "K": "K", "P": "P",
             "OL": "OL", "OT": "OL", "G": "OL", "C": "OL"}


def rosters():
    r = pd.read_parquet(WORK / "pg_roster.parquet")
    r = r.sort_values("games_rostered", ascending=False).drop_duplicates(["season", "pid"])
    r["grp"] = r.pos.map(POS_GROUP)
    return r


MIN_EVENTS, MIN_BOX_TACKLES = 5, 15


def box_interceptions(df):
    """Interception COUNTS come from the box score, which is complete in every season.

    Found by looking at one player: Antoine Winfield Jr. had 7 interceptions in 2019 by the box score, but ESPN's
    play participants put 4 of them on another athlete id. The play text also names no interceptor at all on
    about half of 2021-2023 interceptions. So a team-game's interceptions are whoever the box score says,
    whenever the box has an interceptions row for that team-game; the play-level credit is the fallback.
    """
    from .paths import RAW
    parts = []
    for y in sorted(df.season.unique()):
        b = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet",
                            columns=["game_id", "team_id", "athlete_id", "category", "interceptions"])
        b = b[b.category == "interceptions"]
        b = b.assign(pid=pd.to_numeric(b.athlete_id, errors="coerce"), bi=pd.to_numeric(b.interceptions, errors="coerce")).dropna(subset=["pid"])
        b["pid"] = b.pid.astype("int64")
        b["team"] = b.team_id.astype("int64")
        parts.append(b.groupby(["game_id", "team", "pid"]).bi.sum().reset_index().assign(season=y))
    bx = pd.concat(parts, ignore_index=True)
    gmeta = df.drop_duplicates(["game_id", "team"])[["game_id", "team", "season", "date", "week", "opp"]]
    bx = bx.merge(gmeta, on=["game_id", "team", "season"], how="inner")
    m = df.merge(bx[["game_id", "team", "pid", "bi"]], on=["game_id", "team", "pid"], how="outer")
    new = m.season.isna()
    fill = m[new][["game_id", "team"]].merge(gmeta, on=["game_id", "team"], how="left")
    for c in ("season", "date", "week", "opp"):
        m.loc[new, c] = fill[c].to_numpy()
    m = m[m.season.notna()].copy()
    m["season"] = m.season.astype(int)
    has = m.groupby(["game_id", "team"]).bi.transform(lambda s: s.notna().any())
    per_int = (m.int_epa.sum() / max(m["int"].sum(), 1e-9))
    newint = np.where(has, m.bi.fillna(0.0), m["int"].fillna(0.0))
    m["int_epa"] = np.where(has, newint * per_int, m.int_epa.fillna(0.0))
    m["int"] = newint
    return m.drop(columns=["bi"])


def defender_frame(tm):
    """One row per defender per game of HIS TEAM'S season, zeros where he recorded nothing.

    No source says who played in a game (the game-roster files list the whole roster every week), so a
    defender's denominator is every defensive play of his team that season: a game he missed, or played
    without a credited play, counts against his rate, as RESEARCH section 6 asks. Only regulars are kept:
    at least 5 credited disruptive plays or run stops in the season, or 15 box-score tackles.
    """
    df = pd.read_parquet(WORK / "pg_dfn.parquet")
    df = box_interceptions(df)
    cnt = [c for c in df.columns if c not in ("game_id", "team", "pid", "season", "date", "week", "opp", "has_box")]
    box = df.groupby(["game_id", "team"]).has_box.max().rename("has_box").reset_index()
    ps = df.groupby(["season", "pid"]).agg(team=("team", lambda s: s.value_counts().index[0]),
                                           ev=("sack", "sum"), e2=("tfl", "sum"), e3=("int", "sum"), e4=("pbu", "sum"),
                                           e5=("ff", "sum"), e6=("stop", "sum"), bt=("b_tkl", "sum")).reset_index()
    ps = ps[(ps[["ev", "e2", "e3", "e4", "e5", "e6"]].sum(axis=1) >= MIN_EVENTS) | (ps.bt.fillna(0) >= MIN_BOX_TACKLES)]
    tgm = tm[["season", "game_id", "team", "date", "week", "opp", "dplays", "ddb", "drush"]]
    full = ps[["season", "pid", "team"]].merge(tgm, on=["season", "team"])
    full = full.merge(df[["game_id", "team", "pid"] + cnt], on=["game_id", "team", "pid"], how="left")
    full = full.merge(box, on=["game_id", "team"], how="left")
    full["has_box"] = full.has_box.fillna(False).astype(bool)
    for c in cnt:
        if not c.startswith("b_"):
            full[c] = full[c].fillna(0.0)
    return full


def tables():
    """Player-game frames per role with every numerator / denominator, position attached."""
    ro = rosters()[["season", "pid", "pos", "grp", "cls", "name", "team"]].rename(columns={"team": "roster_team"})
    tm = pd.read_parquet(WORK / "pg_team.parquet")
    tmk = tm[["game_id", "team", "plays", "db", "rush", "att", "dplays", "ddb", "drush", "tgt_tracked", "plays_all", "garb"]].rename(
        columns={"plays": "t_plays", "db": "t_db", "rush": "t_rush", "att": "t_att"})
    qb = pd.read_parquet(WORK / "pg_qb.parquet").merge(ro, on=["season", "pid"], how="left")
    ru = pd.read_parquet(WORK / "pg_rush.parquet").merge(ro, on=["season", "pid"], how="left")
    rc = pd.read_parquet(WORK / "pg_rec.parquet").merge(ro, on=["season", "pid"], how="left")
    df = defender_frame(tm).merge(ro, on=["season", "pid"], how="left")
    qb = qb.merge(tmk, on=["game_id", "team"], how="left")
    # QB rushing rides on the passer row
    qr = ru[["game_id", "team", "pid", "rush", "epa", "succ", "scr"]].rename(columns={"rush": "q_rush", "epa": "q_rush_epa",
                                                                                   "succ": "q_rush_succ", "scr": "q_scr"})
    qb = qb.merge(qr, on=["game_id", "team", "pid"], how="left").fillna({"q_rush": 0, "q_rush_epa": 0, "q_rush_succ": 0})
    qb["tot_epa"] = qb.epa + qb.q_rush_epa
    qb["tot_plays"] = qb.db + qb.q_rush
    ru = ru.merge(tmk, on=["game_id", "team"], how="left")
    rr = rc[["game_id", "team", "pid", "epa", "rec", "yards"]].rename(columns={"epa": "r_epa", "rec": "r_rec", "yards": "r_yards"})
    ru = ru.merge(rr, on=["game_id", "team", "pid"], how="left").fillna({"r_epa": 0, "r_rec": 0, "r_yards": 0})
    rc = rc.merge(tmk, on=["game_id", "team"], how="left")
    rc["tgt_t"] = np.where(rc.tgt_tracked, rc.tgt, 0)
    rc["rec_t"] = np.where(rc.tgt_tracked, rc.rec, 0)
    rc["epa_t"] = np.where(rc.tgt_tracked, rc.epa, 0)
    rc["t_att_t"] = np.where(rc.tgt_tracked, rc.t_att, 0)
    rc["epa_catch"] = rc.epa            # all named targets; mostly catches where targets are not tracked
    df["tfl_all"] = df.tfl + df.sack
    df["pdef"] = df.pbu + df["int"]
    df["disrupt"] = df.sack + df.tfl + df["int"] + df.pbu + df.ff
    df["disrupt_epa"] = -(df.sack_epa + df.tfl_epa + df.int_epa + df.pbu_epa + df.ff_epa)
    for c in ("b_tkl", "b_tfl", "b_pd", "b_hur", "b_sack"):
        df[c] = np.where(df.has_box, df[c].fillna(0), np.nan)
    df["dplays_box"] = np.where(df.has_box, df.dplays, np.nan)
    # specialists
    kick = pd.read_parquet(WORK / "pg_kick.parquet")
    kick = kick[kick.dist.between(17, 70)]
    fitk = kick[kick.season.between(2014, 2024)]
    X = np.column_stack([np.ones(len(fitk)), fitk.dist, fitk.dist ** 2])
    from sklearn.linear_model import LogisticRegression
    lr = LogisticRegression(C=1e6, max_iter=2000).fit(np.column_stack([fitk.dist, fitk.dist ** 2]), fitk.made.astype(int))
    kick["p"] = lr.predict_proba(np.column_stack([kick.dist, kick.dist ** 2]))[:, 1]
    kick["fgoe"] = kick.made.astype(float) - kick.p
    kick["n"] = 1.0
    kg = kick.groupby(["season", "game_id", "team", "pid", "date", "opp"]).agg(fgoe=("fgoe", "sum"), fga=("n", "sum"), made=("made", "sum"),
                                                                              pts_oe=("fgoe", lambda s: 3 * s.sum())).reset_index()
    kg = kg.merge(ro, on=["season", "pid"], how="left")
    punt = pd.read_parquet(WORK / "pg_punt.parquet")
    punt = punt[punt.epa.notna() & punt.ytg.between(1, 99)]
    co = np.polyfit(punt[punt.season.between(2014, 2024)].ytg, punt[punt.season.between(2014, 2024)].epa, 3)
    punt["poe"] = punt.epa - np.polyval(co, punt.ytg)
    punt["n"] = 1.0
    pg = punt.groupby(["season", "game_id", "team", "pid", "date", "opp"]).agg(poe=("poe", "sum"), punts=("n", "sum")).reset_index()
    pg = pg.merge(ro, on=["season", "pid"], how="left")
    meta = {"fg_model": {"intercept": float(lr.intercept_[0]), "dist": float(lr.coef_[0][0]), "dist2": float(lr.coef_[0][1])},
            "punt_poly": [float(x) for x in co]}
    return {"qb": qb, "rush": ru, "rec": rc, "dfn": df, "kick": kg, "punt": pg}, meta


# name: (position group, table, numerator, denominator, higher is better, label, unit, qualifying season sample,
#        seasons, kind, team-level adjustment (teamgame num, den, "add" | "mult") or None)
def spec():
    S = []
    add = lambda *a: S.append(a)
    U = USABLE
    add("qb_epa_db", "QB", "qb", "epa", "db", True, "EPA per dropback", "dropbacks", 150, U, "skill", ("epa_pass", "db", "add"))
    add("qb_success", "QB", "qb", "succ", "db", True, "Success rate on dropbacks", "dropbacks", 150, U, "skill", ("succ_pass", "db", "add"))
    add("qb_sack_rate", "QB", "qb", "sacks", "db", False, "Sack rate", "dropbacks", 150, U, "skill", ("sacks", "db", "add"))
    add("qb_int_rate", "QB", "qb", "ints", "att", False, "Interception rate", "attempts", 150, U, "skill", ("ints", "db", "add"))
    add("qb_ypa", "QB", "qb", "yards", "att", True, "Yards per attempt", "attempts", 150, U, "skill", None)
    add("qb_cmp", "QB", "qb", "cmp", "att", True, "Completion rate", "attempts", 150, U, "skill", None)
    add("qb_expl", "QB", "qb", "expl", "att", True, "Explosive pass rate (16+ yards)", "attempts", 150, U, "skill", None)
    add("qb_pd_epa", "QB", "qb", "pd_epa", "pd_db", True, "EPA per dropback, passing downs", "dropbacks", 50, U, "skill", ("epa_pass", "db", "add"))
    add("qb_sd_epa", "QB", "qb", "sd_epa", "sd_db", True, "EPA per dropback, standard downs", "dropbacks", 100, U, "skill", ("epa_pass", "db", "add"))
    add("qb_rush_epa", "QB", "qb", "q_rush_epa", "q_rush", True, "EPA per rush (scrambles and designed runs together)", "rushes", 40, U, "skill", ("epa_rush", "rush", "add"))
    add("qb_rush_value", "QB", "qb", "q_rush_epa", "tot_plays", True, "Rushing EPA per play he ran or threw", "plays", 180, U, "skill", None)
    add("qb_total_epa", "QB", "qb", "tot_epa", "tot_plays", True, "Total EPA per play (pass + rush)", "plays", 180, U, "skill", ("epa", "plays", "add"))
    add("rb_epa_rush", "RB", "rush", "epa", "rush", True, "EPA per rush", "rushes", 80, U, "skill", ("epa_rush", "rush", "add"))
    add("rb_success", "RB", "rush", "succ", "rush", True, "Success rate", "rushes", 80, U, "skill", ("succ_rush", "rush", "add"))
    add("rb_expl", "RB", "rush", "expl", "rush", True, "Explosive run rate (12+ yards)", "rushes", 80, U, "skill", None)
    add("rb_stuff", "RB", "rush", "stuff", "rush", False, "Stuff rate (no gain or a loss)", "rushes", 80, U, "skill", ("stuff", "rush", "add"))
    add("rb_ypc", "RB", "rush", "yards", "rush", True, "Yards per rush", "rushes", 80, U, "skill", None)
    add("rb_rec_value", "RB", "rush", "r_epa", "t_db", True, "Receiving EPA per team dropback", "team dropbacks", 250, U, "skill", None)
    add("rb_share", "RB", "rush", "rush", "t_rush", True, "Share of team rushes", "team rushes", 250, U, "context", None)
    for pos, q, qt in (("WR", 30, 250), ("TE", 15, 250)):
        p = pos.lower()
        add(f"{p}_epa_tgt", pos, "rec", "epa_t", "tgt_t", True, "EPA per target (games where targets are named)", "targets", q, U, "skill", ("epa_pass", "db", "add"))
        add(f"{p}_catch", pos, "rec", "rec_t", "tgt_t", True, "Catch rate (games where targets are named)", "targets", q, U, "skill", None)
        add(f"{p}_tgt_share", pos, "rec", "tgt_t", "t_att_t", True, "Target share (games where targets are named)", "team attempts", 120, U, "context", None)
        add(f"{p}_expl", pos, "rec", "expl", "rec", True, "Explosive catch rate (16+ yards)", "catches", max(12, q // 2), U, "skill", None)
        add(f"{p}_ypr", pos, "rec", "yards", "rec", True, "Yards per catch", "catches", max(12, q // 2), U, "skill", None)
        add(f"{p}_yptpa", pos, "rec", "yards", "t_att", True, "Yards per team pass attempt", "team attempts", qt, U, "skill", None)
        add(f"{p}_epa_tdb", pos, "rec", "epa_catch", "t_db", True, "Receiving EPA per team dropback", "team dropbacks", qt, U, "skill", ("epa_pass", "db", "add"))
        add(f"{p}_rec_share", pos, "rec", "rec", "t_att", True, "Catches per team pass attempt", "team attempts", qt, U, "context", None)
    for pos in ("DL", "LB", "DB"):
        p = pos.lower()
        if pos != "DB":
            add(f"{p}_sack", pos, "dfn", "sack", "dplays", True, "Sacks per 100 team defensive plays", "team def. plays", 350, U, "skill", ("sacks", "plays", "mult"))
            add(f"{p}_tfl", pos, "dfn", "tfl_all", "dplays", True, "Tackles for loss incl. sacks, from plays, per 100", "team def. plays", 350, U, "skill", ("tfl", "plays", "mult"))
            add(f"{p}_stop", pos, "dfn", "stop", "dplays", True, "Run stops per 100 (tackle on a failed run)", "team def. plays", 350, U, "skill", None)
            add(f"{p}_box_tfl", pos, "dfn", "b_tfl", "dplays_box", True, "Tackles for loss, box score, per 100", "team def. plays", 350, BOX_OK, "skill", None)
            add(f"{p}_box_hur", pos, "dfn", "b_hur", "dplays_box", True, "QB hurries, box score, per 100", "team def. plays", 350, BOX_OK, "skill", None)
        if pos != "DL":
            add(f"{p}_int", pos, "dfn", "int", "dplays", True, "Interceptions per 100", "team def. plays", 350, U, "skill", ("ints", "plays", "mult"))
            add(f"{p}_pdef", pos, "dfn", "pdef", "dplays", True, "Passes defensed (break-ups + interceptions), plays, per 100", "team def. plays", 350, PBU_OK, "skill", ("pbu", "plays", "mult"))
            add(f"{p}_box_pd", pos, "dfn", "b_pd", "dplays_box", True, "Passes defensed, box score, per 100", "team def. plays", 350, BOX_OK, "skill", None)
        add(f"{p}_ff", pos, "dfn", "ff", "dplays", True, "Forced fumbles per 100", "team def. plays", 350, FF_OK, "skill", None)
        add(f"{p}_box_tkl", pos, "dfn", "b_tkl", "dplays_box", True, "Tackles, box score, per 100", "team def. plays", 350, BOX_OK, "context", None)
        add(f"{p}_disrupt", pos, "dfn", "disrupt", "dplays", True, "Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble)", "team def. plays", 350, PBU_OK, "skill", ("havoc", "plays", "mult"))
        add(f"{p}_disrupt_epa", pos, "dfn", "disrupt_epa", "dplays", True, "Disruption EPA per 100 (points the offence lost on his plays)", "team def. plays", 350, PBU_OK, "skill", ("havoc", "plays", "mult"))
    add("k_fgoe", "K", "kick", "fgoe", "fga", True, "Field goals made over expected, per attempt", "attempts", 12, U, "skill", None)
    add("p_poe", "P", "punt", "poe", "punts", True, "Punt EPA over expected, per punt", "punts", 30, U, "skill", None)
    return S


def split_half(d, num, den, n_splits=N_SPLITS):
    codes, uniq = pd.factorize(d.ps)
    G = len(uniq)
    if G < 40:
        return np.nan, np.nan, np.nan
    season = d.groupby(codes).season.first().to_numpy()
    nv, dv = d[num].to_numpy(dtype=float), d[den].to_numpy(dtype=float)
    rs, nbar = [], []
    for _ in range(n_splits):
        u = RNG.random(len(d))
        order = np.lexsort((u, codes))
        rank = np.empty(len(d), dtype=int)
        rank[order] = np.arange(len(d))
        first = np.full(G, len(d))
        np.minimum.at(first, codes, rank)
        half = (rank - first[codes]) % 2
        vals, dens = [], []
        for h in (0, 1):
            m = half == h
            a = np.bincount(codes[m], weights=nv[m], minlength=G)
            b = np.bincount(codes[m], weights=dv[m], minlength=G)
            vals.append(np.where(b > 0, a / np.where(b > 0, b, 1), np.nan))
            dens.append(b)
        x = pd.DataFrame({"a": vals[0], "b": vals[1], "s": season}).dropna()
        x["a"] -= x.groupby("s").a.transform("mean")
        x["b"] -= x.groupby("s").b.transform("mean")
        if x.a.std() == 0 or x.b.std() == 0:
            continue
        rs.append(np.corrcoef(x.a, x.b)[0, 1])
        nbar.append((dens[0].mean() + dens[1].mean()) / 2)
    return float(np.mean(rs)), float(np.std(rs)), float(np.mean(nbar))


def settle_grid(d, num, den):
    """settle_points.py's fit: window = the last third of his games, target = the rest of his season."""
    rows = []
    mu = d.groupby("season")[[num, den]].sum()
    mu = (mu[num] / mu[den]).to_dict()
    for (season, pid), x in d.groupby(["season", "pid"]):
        x = x.sort_values("date")
        n = len(x)
        if n < 6:
            continue
        w = max(2, int(np.ceil(n / 3)))
        win, rest = x.iloc[-w:], x.iloc[:-w]
        nw, nf = win[den].sum(), rest[den].sum()
        if nw <= 0 or nf < 0.5 * (nw + nf):
            continue
        rows.append((nw, win[num].sum() / nw, rest[num].sum() / nf, mu[season]))
    if len(rows) < 60:
        return np.nan, len(rows), np.nan, np.nan
    a = np.array(rows)
    nw, vw, vf, m = a.T
    best = None
    for k in K_GRID:
        e = np.sqrt(np.mean(((nw * vw + k * m) / (nw + k) - vf) ** 2))
        if best is None or e < best[1]:
            best = (k, e)
    raw = np.sqrt(np.mean((vw - vf) ** 2))
    return best[0], len(rows), float(raw), float(best[1])


def season_rates(d, num, den, qual):
    a = d.groupby(["season", "pid"]).agg(n=(num, "sum"), d=(den, "sum"), team=("team", lambda s: s.value_counts().index[0])).reset_index()
    a = a[a.d >= qual]
    a["v"] = a.n / a.d
    return a


def yoy(a, b=None):
    """a: this season's rates; b: the target season's rates (default: the same measure). stayers / transfers."""
    b = a if b is None else b
    x = a.copy()
    x["v"] -= x.groupby("season").v.transform("mean")
    y = b.copy()
    y["v"] -= y.groupby("season").v.transform("mean")
    y = y.assign(season=y.season - 1)[["season", "pid", "v", "team"]].rename(columns={"v": "nxt", "team": "team_n"})
    m = x.merge(y, on=["season", "pid"]).dropna(subset=["v", "nxt"])
    out = {}
    for name, k in (("stay", m[m.team == m.team_n]), ("move", m[m.team != m.team_n]), ("all", m)):
        out[name] = (float(np.corrcoef(k.v, k.nxt)[0, 1]) if len(k) >= 25 and k.v.std() > 0 and k.nxt.std() > 0 else np.nan, len(k))
    return out


def opp_effects(tg, tnum, tden):
    """Per season, each team's offence and defence effect on the rate tnum/tden (ridge, as team_study.adjust)."""
    out = {}
    for y, s in tg.groupby("season"):
        s = s[s[tden] > 0].copy()
        s["yv"] = s[tnum] / s[tden]
        o, dfn, h, mu = ridge_adjust(s, "yv", tden, 1.0 * s[tden].mean())
        out[y] = (o, dfn, mu)
    return out


def verdict(kind, full, k_typ, typical):
    if kind == "context":
        return "CONTEXT"
    if not np.isfinite(full):
        return "dropped (too few players)"
    if full >= 0.5:
        return "full bar"
    if full >= 0.3:
        return "hatched"
    if full >= 0.15:
        return "CONTEXT"
    return "dropped"


def main():
    T, meta = tables()
    tg = teamgame.load("cfbd", USABLE)
    eff_cache = {}
    rows = []
    for (name, pos, tab, num, den, hib, label, unit, qual, seasons, kind, adj) in spec():
        d = T[tab]
        d = d[d.season.isin(seasons) & (d.grp == pos) & d[den].notna() & (d[den] > 0)].copy()
        tot = d.groupby(["season", "pid"])[den].transform("sum")
        q = d[tot >= qual].copy()
        q["ps"] = q.season.astype(str) + "_" + q.pid.astype(str)
        nps = q.ps.nunique()
        typical = float(q.groupby("ps")[den].sum().median()) if nps else np.nan
        r, sd, nbar = split_half(q, num, den)
        full = 2 * r / (1 + r) if np.isfinite(r) else np.nan
        k_form = nbar * (1 - r) / r if np.isfinite(r) and r > 0.02 else np.inf
        k_grid, pairs, rmse_raw, rmse_k = settle_grid(q, num, den)
        a = season_rates(d, num, den, qual * 0.6)
        yy = yoy(a)
        row = dict(stat=name, pos=pos, label=label, unit=unit, kind=kind, seasons=f"{min(seasons)}-{max(seasons)}" if len(seasons) > 8 else ", ".join(map(str, seasons)),
                   qualifier=qual, player_seasons=nps, typical_sample=typical, split_half=r, split_sd=sd, full_season=full,
                   settle_k=k_grid, settle_k_formula=k_form, settle_pairs=pairs, yoy_stay=yy["stay"][0], n_stay=yy["stay"][1],
                   yoy_move=yy["move"][0], n_move=yy["move"][1], higher_is_better=hib)
        if adj:
            tnum, tden, how = adj
            key = (tnum, tden)
            if key not in eff_cache:
                eff_cache[key] = opp_effects(tg, tnum, tden)
            eff = eff_cache[key]
            side = 0 if tab == "dfn" else 1          # defenders face the opponent's OFFENCE effect; everyone else its DEFENCE
            e = np.array([eff[s][side].get(o, 0.0) if s in eff else 0.0 for s, o in zip(d.season, d.opp)])
            lg = np.array([eff[s][2] if s in eff else np.nan for s in d.season])
            d2 = d.copy()
            if how == "add":
                d2["adjn"] = d2[num] - d2[den] * e
            else:
                d2["adjn"] = d2[num] * np.clip(lg / np.clip(lg + e, 1e-6, None), 0.6, 1.6)
            b = season_rates(d2, "adjn", den, qual * 0.6)
            ya = yoy(b, a)            # adjusted this year -> raw next year
            yb = yoy(b)               # adjusted -> adjusted
            row.update(adj_to_raw_stay=ya["stay"][0], adj_to_raw_move=ya["move"][0], adj_to_adj_stay=yb["stay"][0],
                       adj_to_adj_move=yb["move"][0],
                       adj_helps_movers=bool(np.isfinite(ya["move"][0]) and np.isfinite(yy["move"][0]) and ya["move"][0] > yy["move"][0]))
        row["verdict"] = verdict(kind, full, k_grid, typical)
        rows.append(row)
        print(f"{name:16s} n={nps:5d} typ={typical:7.0f} r={r:.3f} full={full:.3f} k={k_grid} (formula {k_form:.0f}) "
              f"stay={yy['stay'][0]:.3f}({yy['stay'][1]}) move={yy['move'][0]:.3f}({yy['move'][1]}) "
              f"adj move={row.get('adj_to_raw_move', float('nan')):.3f} -> {row['verdict']}", flush=True)
    r = pd.DataFrame(rows)
    r.to_csv(OUT / "player_stability.csv", index=False)
    (OUT / "specialist_models.json").write_text(json.dumps(meta, indent=1))
    f = lambda v, n=2: "" if v is None or (isinstance(v, float) and not np.isfinite(v)) else f"{v:.{n}f}"
    lines = []
    for pos in ("QB", "RB", "WR", "TE", "DL", "LB", "DB", "K", "P"):
        x = r[r.pos == pos]
        lines += [f"**{pos}**", "",
                  "| stat | seasons | qualified player-seasons | typical sample | full-season reliability | settle point | year-to-year: stayed | transferred | adjusted beats raw for transfers? | verdict |",
                  "|---|---|---:|---:|---:|---:|---:|---:|---|---|"]
        for _, s in x.iterrows():
            adjtxt = ""
            if "adj_to_raw_move" in s and isinstance(s.get("adj_to_raw_move"), float) and np.isfinite(s.adj_to_raw_move):
                adjtxt = f"{'yes' if s.adj_helps_movers else 'no'} ({s.adj_to_raw_move:.2f} vs {s.yoy_move:.2f})"
            k = "" if not np.isfinite(s.settle_k) else f"{s.settle_k:.0f} {s.unit}"
            lines.append(f"| {s.label} | {s.seasons} | {s.player_seasons} | {f(s.typical_sample, 0)} {s.unit} | {f(s.full_season)} | {k} | "
                         f"{f(s.yoy_stay)} ({s.n_stay}) | {f(s.yoy_move)} ({s.n_move}) | {adjtxt} | {s.verdict} |")
        lines.append("")
    (OUT / "player_stability.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
