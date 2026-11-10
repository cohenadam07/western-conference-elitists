"""Steps 6, 8 and 9. One season's numbers: positions, every registry stat in its four variants,
Savant value, and the All-Savant sets.

    python -m pipeline.cfb.numbers 2025          # one season, printed summary
    python -m pipeline.cfb.numbers check         # 2025 against prompt 1's savant_value table

Everything here is computed one season at a time from that season's own tables, plus a few
frozen constants (the kicker and punter models, the edge / interior and corner / safety
classifiers, the hurry weight) that were fitted on finished seasons and are kept in
pipeline/cfb/state (state.py). That is what lets the cloud refresh the season being played
without any history on disk, and get the same bytes the Mac's full build gets.

The four variants of a stat (the page's two toggles):
    r    raw, garbage time out          a    opponent-adjusted, garbage time out
    rg   raw, garbage time in           ag   opponent-adjusted, garbage time in
Only stats the backtest found an adjustment for carry `a` / `ag`.

Percentiles are NOT computed here. The page and the connector compute them from these values
with public/savant-cfb.js, one copy of the arithmetic, so they cannot disagree.

Players are everyone with a play in an FBS-vs-FBS game. Games against FCS teams are left out of
every stat (the opponent adjustment has nothing to anchor an FCS defence to).
"""
import sys
import json
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT
from . import config as C
from . import teamgame
from .player_study import defender_frame, opp_effects
from .value import shrink_value, ol_units, QUAL as VQUAL, BASE, SHAPE

SLOT_TABLE = {"QB": "qb", "RB": "rush", "WR": "rec", "TE": "rec", "EDGE": "dfn", "IDL": "dfn", "LB": "dfn", "CB": "dfn",
              "S": "dfn", "K": "kick", "P": "punt"}
OL_POS = {"OL", "OT", "G", "C", "OG"}
FILT = {"": "cfbd", "_all": "all"}
# what a receiver's opponent adjustment is charged on: his own targets, not his team's dropbacks
EXPOSURE = {"rec": "tgt_eff"}
UNIT_SCALE = {"pct1": 100.0, "pct2": 100.0, "per100": 100.0, "sgn1": 100.0}
UNIT_DP = {"epa": 4, "pct1": 2, "pct2": 3, "per100": 3, "num1": 3, "num2": 4, "sgn1": 2, "sgn2": 4}


def _read(name, y, suffix=""):
    d = pd.read_parquet(WORK / f"pg_{name}{suffix}.parquet")
    return d[d.season == y].copy()


# ---------------------------------------------------------------- frames
def frames(y, suffix, state, regulars=None):
    """Player-game frames of one season for one garbage-time variant (player_study.tables, one season, frozen models)."""
    tm = _read("team", y, suffix)
    tmk = tm[["game_id", "team", "plays", "db", "rush", "att", "dplays", "ddb", "drush", "tgt_tracked", "cmp", "un", "un_epa"]].rename(
        columns={"plays": "t_plays", "db": "t_db", "rush": "t_rush", "att": "t_att", "cmp": "t_cmp"})
    qb, ru, rc = _read("qb", y, suffix), _read("rush", y, suffix), _read("rec", y, suffix)
    qr = ru[["game_id", "team", "pid", "rush", "epa", "succ", "yards", "td"]].rename(
        columns={"rush": "q_rush", "epa": "q_rush_epa", "succ": "q_rush_succ", "yards": "q_rush_yds", "td": "q_rush_td"})
    qb = qb.merge(tmk, on=["game_id", "team"], how="left").merge(qr, on=["game_id", "team", "pid"], how="left")
    for c in ("q_rush", "q_rush_epa", "q_rush_succ", "q_rush_yds", "q_rush_td"):
        qb[c] = qb[c].fillna(0)
    qb["tot_epa"] = qb.epa + qb.q_rush_epa
    qb["tot_plays"] = qb.db + qb.q_rush
    rc = rc.merge(tmk, on=["game_id", "team"], how="left")
    share = np.where(rc.t_cmp > 0, rc.rec / rc.t_cmp.clip(lower=1), 0.0)
    rc["tgt_eff"] = rc.tgt + share * rc.un.fillna(0)          # un-named incompletions shared out by catches
    rc["epa_eff"] = rc.epa + share * rc.un_epa.fillna(0)
    tr = rc.tgt_tracked.fillna(False).astype(bool)
    rc["tgt_t"], rc["rec_t"] = np.where(tr, rc.tgt, 0), np.where(tr, rc.rec, 0)
    rc["epa_t"], rc["t_att_t"] = np.where(tr, rc.epa, 0), np.where(tr, rc.t_att, 0)
    rr = rc[["game_id", "team", "pid", "epa_eff", "tgt_eff", "rec", "yards", "td"]].rename(
        columns={"epa_eff": "r_epa", "tgt_eff": "r_tgt", "rec": "r_rec", "yards": "r_yards", "td": "r_td"})
    ru = ru.merge(tmk, on=["game_id", "team"], how="left").merge(rr, on=["game_id", "team", "pid"], how="left")
    for c in ("r_epa", "r_tgt", "r_rec", "r_yards", "r_td"):
        ru[c] = ru[c].fillna(0)
    df = defender_frame(tm, suffix, seasons=[y], regulars=regulars)
    hb = df.has_box.fillna(False).to_numpy()
    df["e_sack"] = np.where(hb, df.b_sack.fillna(0), df.sack)
    df["e_tfl"] = np.where(hb, (df.b_tfl.fillna(0) - df.b_sack.fillna(0)).clip(lower=0), df.tfl)
    df["e_pbu"] = np.where(hb, (df.b_pd.fillna(0) - df["int"]).clip(lower=0), df.pbu)
    df["e_hur"] = np.where(hb, df.b_hur.fillna(0), 0.0)
    df["e_stop"] = (df.stop - df.tfl).clip(lower=0)
    df["e_sack_all"] = df.e_sack
    df["e_tfl_all"] = df.e_tfl + df.e_sack
    df["e_pd"] = df.e_pbu + df["int"]
    df["disrupt"] = df.e_sack + df.e_tfl + df["int"] + df.e_pbu + df.ff
    df["e_tkl"] = np.where(hb, df.b_tkl.fillna(0), df.tkl + df.ast)
    for c in ("b_tkl", "b_tfl", "b_pd", "b_hur", "b_sack"):
        df[c] = np.where(hb, df[c].fillna(0), np.nan)
    df["dplays_box"] = np.where(hb, df.dplays, np.nan)
    kick = _read("kick", y, suffix)
    kick = kick[kick.dist.between(17, 70)].copy()
    km = state["kick"]
    z = km["intercept"] + km["dist"] * kick.dist + km["dist2"] * kick.dist ** 2
    kick["fgoe"] = kick.made.astype(float) - 1 / (1 + np.exp(-z))
    kick["fga"] = 1.0
    kg = kick.groupby(["season", "game_id", "team", "pid", "date", "week", "opp"]).agg(
        fgoe=("fgoe", "sum"), fga=("fga", "sum"), made=("made", "sum"), long=("dist", lambda s: float(s[kick.loc[s.index, "made"]].max())
                                                                         if kick.loc[s.index, "made"].any() else 0.0)).reset_index()
    kg["pts_oe"] = 3 * kg.fgoe
    punt = _read("punt", y, suffix)
    punt = punt[punt.epa.notna() & punt.ytg.between(1, 99)].copy()
    punt["poe"] = punt.epa - np.polyval(state["punt"], punt.ytg)
    punt["punts"] = 1.0
    pg = punt.groupby(["season", "game_id", "team", "pid", "date", "week", "opp"]).agg(
        poe=("poe", "sum"), punts=("punts", "sum"), gross=("gross", "sum")).reset_index()
    return {"qb": qb, "rush": ru, "rec": rc, "dfn": df, "kick": kg, "punt": pg, "team": tm}


def regular_defenders(y):
    """The defenders kept all season, from the garbage-in table, so a toggle never drops a man."""
    from .player_study import box_interceptions, MIN_EVENTS, MIN_BOX_TACKLES
    df = box_interceptions(_read("dfn", y, "_all"))
    ps = df.groupby(["season", "pid"]).agg(team=("team", lambda s: s.value_counts().index[0]), ev=("sack", "sum"), e2=("tfl", "sum"),
                                           e3=("int", "sum"), e4=("pbu", "sum"), e5=("ff", "sum"), e6=("stop", "sum"),
                                           bt=("b_tkl", "sum")).reset_index()
    return ps[(ps[["ev", "e2", "e3", "e4", "e5", "e6"]].sum(axis=1) >= MIN_EVENTS) | (ps.bt.fillna(0) >= MIN_BOX_TACKLES)]


# ---------------------------------------------------------------- people and positions
def people(y):
    """One row per player of the season: the identity table for finished seasons; for the season being
    played, the roster as ESPN has it today (its class label is current) and the team he has stats for."""
    if y < C.CURRENT and (WORK / "player_seasons.parquet").exists():
        p = pd.read_parquet(WORK / "player_seasons.parquet")
        return p[p.season == y].copy()
    from .playergame import roster
    ro = roster(y).sort_values("games_rostered", ascending=False)
    parts = [_read(t, y, "_all")[["pid", "team", "game_id"]] for t in ("qb", "rush", "rec", "dfn", "kick", "punt", "ret")]
    st = pd.concat(parts).drop_duplicates().groupby(["pid", "team"]).game_id.nunique().rename("stat_games").reset_index()
    st = st.sort_values(["pid", "stat_games", "team"], ascending=[True, False, True]).drop_duplicates("pid")
    ro = ro.merge(st.rename(columns={"team": "stat_team"}), on="pid", how="left")
    ro["pref"] = (ro.team == ro.stat_team).astype(int)
    ro = ro.sort_values(["pref", "games_rostered", "team"], ascending=[False, False, True]).drop_duplicates("pid")
    moved = ro.stat_team.notna() & (ro.team != ro.stat_team)
    ro.loc[moved, "team"] = ro.loc[moved, "stat_team"].astype("int64")
    add = st[~st.pid.isin(ro.pid)]
    p = pd.concat([ro, add], ignore_index=True)
    p["season"] = y
    p["stat_games"] = p.stat_games.fillna(0).astype(int)
    p["cls_y"] = p.cls
    p["fr"] = p.cls == "FR"
    fbs = fbs_table(y)
    p = p.merge(fbs[["team", "school", "conference"]], on="team", how="left")
    p["fbs"] = p.school.notna()
    return p.drop(columns=["pref", "stat_team"])


def fbs_table(y):
    from .espn_feed import fbs_of
    return fbs_of(y).reset_index().rename(columns={"team_id": "team"})


def positions(y, F, ppl, state):
    """Slot per player. Roster position first; a generic "DL" or "DB" is split by the frozen classifier
    (stat profile and size); a player with no usable roster position takes the slot his plays say."""
    p = ppl[["pid", "pos", "weight", "height"]].copy()
    p["slot"] = p.pos.map(BASE)
    p.loc[p.pos.isin(OL_POS), "slot"] = "OL"
    d = F["dfn"].groupby("pid").agg(dplays=("dplays", "sum"), sack=("e_sack", "sum"), stop=("e_stop", "sum"), pbu=("e_pbu", "sum"),
                                    tkl=("e_tkl", "sum"), **{"int": ("int", "sum")}).reset_index()
    x = p.merge(d, on="pid", how="left")
    x["inferred"], x["p_first"] = False, np.nan
    dp = x.dplays.clip(lower=1)
    feats = {"weight": x.weight, "height": x.height, "f_sack_share": x.sack / (x.sack + x.stop + 0.25 * x.tkl + 1),
             "f_pd_share": (x.pbu + x["int"]) / (x.pbu + x["int"] + x.stop + 0.25 * x.tkl + 1), "f_stop_rate": x.stop / dp * 100,
             "f_tk_rate": x.tkl / dp * 100}
    for generic, a, b in (("DL?", "EDGE", "IDL"), ("DB?", "CB", "S")):
        m = state["positions"][generic]
        g = (x.slot == generic) & x.dplays.notna()
        z = np.full(len(x), m["intercept"])
        for f, mu, sd, co in zip(m["feats"], m["mu"], m["sd"], m["coef"]):
            v = feats[f].fillna(m["fill"][f]) if f in ("weight", "height") else feats[f].fillna(0)
            z = z + co * (v - mu) / sd
        pr = 1 / (1 + np.exp(-z))
        x.loc[g, "p_first"] = pr[g]
        x.loc[g, "slot"] = np.where(pr[g] >= 0.5, a, b)
        x.loc[g, "inferred"] = True
    # no roster position worth the name ("-", "ATH", none): the slot his plays say, offence and kicking only
    vol = {}
    for slot, tab, col in (("QB", "qb", "db"), ("RB", "rush", "rush"), ("WR", "rec", "tgt_eff"), ("K", "kick", "fga"), ("P", "punt", "punts")):
        vol[slot] = F[tab].groupby("pid")[col].sum()
    v = pd.DataFrame(vol).fillna(0)
    best = v.idxmax(axis=1)
    none = ~x.slot.isin(list(SLOT_TABLE) + ["OL"])
    x.loc[none, "slot"] = x.loc[none, "pid"].map(best)
    x.loc[none & x.slot.notna(), "inferred"] = True
    return x[["pid", "slot", "inferred", "p_first"]]


# ---------------------------------------------------------------- opponent effects
class Effects:
    def __init__(self, y, suffix):
        self.tg = teamgame.load(FILT[suffix], [y])
        self.y = y
        self.cache = {}

    def get(self, tnum, tden):
        k = (tnum, tden)
        if k not in self.cache:
            e = opp_effects(self.tg, tnum, tden)
            self.cache[k] = e.get(self.y, ({}, {}, np.nan))
        return self.cache[k]

    def add(self, d, tnum, tden):
        """The opposing DEFENCE's effect on the rate, per row."""
        o, dfn, mu = self.get(tnum, tden)
        return d.opp.map(dfn).fillna(0.0).to_numpy()

    def mult(self, d, tnum, tden):
        """A defender's count scaled by how often the OFFENCE he faced allows that play."""
        o, dfn, mu = self.get(tnum, tden)
        e = d.opp.map(o).fillna(0.0).to_numpy()
        return np.clip(mu / np.clip(mu + e, 1e-6, None), 0.6, 1.6) if np.isfinite(mu) else np.ones(len(d))


def event_weights(y, state):
    """League-average points an offence loses on each kind of disruptive play that season (value.event_weights, one season)."""
    cols = ["play_id", "cat", "f_sack", "f_int", "f_pbu", "f_ff", "f_att", "f_comp", "yards", "down", "dist", "pts", "pbu_by", "pdef1",
            "ff_by", "ffby1", "f_kneel", "period", "f_pen_noplay"]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=cols)
    e = pd.read_parquet(WORK / f"epa_{y}.parquet", columns=["epa", "garbage_cfbd"])
    d["epa"] = e.epa.to_numpy()
    d = d[d.cat.isin(["rush", "pass"]) & d.epa.notna() & ~d.f_kneel & (d.period <= 4) & ~e.garbage_cfbd.to_numpy() & ~d.f_pen_noplay]
    need = np.select([d.down == 1, d.down == 2], [0.5 * d.dist, 0.7 * d.dist], default=d.dist)
    fail_run = (d.cat == "rush") & (d.yards < need) & (d.pts != 7)
    tfl = (d.yards < 0) & ~d.f_sack & ~(d.f_att & ~d.f_comp)
    pbu = (d.cat == "pass") & (d.f_pbu | d.pbu_by.notna() | d.pdef1.notna()) & ~d.f_int
    base_run, base_db = d[d.cat == "rush"].epa.mean(), d[d.cat == "pass"].epa.mean()
    return {"sack": float(base_db - d[d.f_sack].epa.mean()), "tfl": float(base_run - d[tfl].epa.mean()),
            "int": float(base_db - d[(d.cat == "pass") & d.f_int].epa.mean()),
            "pbu": float(base_db - d[pbu].epa.mean()) if pbu.sum() > 200 else float(state["pbu_weight"]),
            "ff": float(d.epa.mean() - d[d.f_ff | d.ff_by.notna() | d.ffby1.notna()].epa.mean()),
            "stop": float(base_run - d[fail_run & (d.yards >= 0)].epa.mean()), "hur": float(state["hur_weight"])}


# ---------------------------------------------------------------- the season
def qual_scale(y):
    """Share of a 12-game season the median FBS team has played (1 for a finished season)."""
    tg = pd.read_parquet(WORK / "teamgame.parquet", columns=["season", "team", "game_id", "filt"])
    n = tg[(tg.season == y) & (tg.filt == "all")].groupby("team").game_id.nunique()
    return float(min(1.0, n.median() / C.GAMES_FULL)) if len(n) else 1.0


def build(y, state):
    reg = regular_defenders(y)
    F = {s: frames(y, s, state, regulars=reg) for s in ("", "_all")}
    E = {s: Effects(y, s) for s in ("", "_all")}
    ppl = people(y)
    pos = positions(y, F["_all"], ppl, state)
    slot = pos.set_index("pid").slot
    W = event_weights(y, state)
    scale = qual_scale(y)
    # defenders' disruption points: raw, and adjusted for the offence faced
    for s in ("", "_all"):
        d = F[s]["dfn"]
        fS, fT, fI = E[s].mult(d, "sacks", "db"), E[s].mult(d, "stuff", "rush"), E[s].mult(d, "ints", "db")
        d["disr_pts"] = (W["sack"] * d.e_sack + W["hur"] * d.e_hur + W["tfl"] * d.e_tfl + W["stop"] * d.e_stop + W["int"] * d["int"]
                         + W["pbu"] * d.e_pbu + W["ff"] * d.ff)
        d["disr_adj"] = (W["sack"] * d.e_sack * fS + W["hur"] * d.e_hur * fS + W["tfl"] * d.e_tfl * fT + W["stop"] * d.e_stop * fT
                         + W["int"] * d["int"] * fI + W["pbu"] * d.e_pbu * fI + W["ff"] * d.ff)
    # ---- the player list: a slot we grade and at least one row in his slot's table ------------------
    rows = []
    for sl, tab in SLOT_TABLE.items():
        ids = F["_all"][tab].pid.unique()
        rows += [(int(i), sl) for i in ids if slot.get(i) == sl]
    pl = pd.DataFrame(rows, columns=["pid", "slot"]).drop_duplicates("pid")
    pl = pl[pl.pid > 0]                  # ESPN's negative ids are placeholders ("team" or an unknown man), not players
    pl = pl.merge(ppl.drop_duplicates("pid"), on="pid", how="left").merge(pos[["pid", "inferred", "p_first"]], on="pid", how="left")
    # a man with plays and no roster row: his name as the box score prints it; no name anywhere, no card
    box = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet", columns=["athlete_id", "athlete_name"])
    box = box.assign(pid=pd.to_numeric(box.athlete_id, errors="coerce")).dropna(subset=["pid", "athlete_name"])
    bn = box.astype({"pid": "int64"}).drop_duplicates("pid").set_index("pid").athlete_name.astype(str)
    pl["name"] = pl["name"].where(pl["name"].notna(), pl.pid.map(bn))
    pl = pl[pl["name"].notna() & (pl["name"].astype(str).str.strip() != "")]
    pl = pl.sort_values(["slot", "pid"]).reset_index(drop=True)
    idx = {p: i for i, p in enumerate(pl.pid)}
    n = len(pl)
    # the team he played for is where his rows are (a roster can lag a transfer)
    values, samples = {}, {}

    def col(tab, s, name, slots):
        d = F[s][tab]
        d = d[d.pid.map(slot).isin(slots)]
        return d, d.groupby("pid")[name].sum(min_count=1)

    def arr(series, dp=None):
        out = np.full(n, np.nan)
        ii = [idx[p] for p in series.index if p in idx]
        out[ii] = series[[p for p in series.index if p in idx]].to_numpy(dtype=float)
        return out

    for st in C.STATS:
        tab, k = st.table, st.key
        sc, dp = UNIT_SCALE.get(st.unit, 1.0), UNIT_DP.get(st.unit, 4)
        tracked = y >= st.start and y not in st.off
        v = {}
        if tracked and k.endswith("_garbage"):       # share of his plays in garbage time: in minus out, over in
            base = {"qb": "db", "rush": "rush", "rec": "tgt_eff"}[tab]
            _, a_ = col(tab, "_all", base, st.pos)
            _, o_ = col(tab, "", base, st.pos)
            g = (a_ - o_.reindex(a_.index).fillna(0)).clip(lower=0)
            v["r"] = arr(g / a_.where(a_ > 0) * sc)
            samples[st.sample] = _merge(samples.get(st.sample), arr(a_))
        elif tracked:
            for s, tag in (("", ""), ("_all", "g")):
                d, den = col(tab, s, st.den, st.pos)
                num = d.groupby("pid")[st.num].sum(min_count=1)
                den = den.where(den > 0)
                v["r" + tag] = arr(num / den * sc)
                if st.adj:
                    tnum, tden, how = st.adj
                    if how == "add":
                        expo = d[EXPOSURE.get(tab, st.den)].fillna(0).to_numpy()
                        adjn = d[st.num].fillna(0).to_numpy() - expo * E[s].add(d, tnum, tden)
                    elif st.num == "disr_pts":
                        adjn = d["disr_adj"].to_numpy()
                    else:
                        adjn = d[st.num].fillna(0).to_numpy() * E[s].mult(d, tnum, tden)
                    an = pd.Series(adjn, index=d.pid.to_numpy()).groupby(level=0).sum()
                    v["a" + tag] = arr(an / den * sc)
                sname = st.sample + ("_g" if tag else "")
                _, sm = col(tab, s, st.sample if st.sample in d.columns else st.den, st.pos)
                samples[sname] = _merge(samples.get(sname), arr(sm))
        values[k] = {kk: _round(vv, dp) for kk, vv in v.items()}
    # ---- samples the qualifier and the card header need ---------------------------------------------
    for s, tag in (("", ""), ("_all", "_g")):
        for nm, tab, c_, slots in (("plays", "qb", "tot_plays", ["QB"]), ("rush", "rush", "rush", ["RB"]), ("tgt", "rec", "tgt_eff", ["WR", "TE"]),
                                   ("dplays", "dfn", "dplays", C._ALL_D), ("fga", "kick", "fga", ["K"]), ("punts", "punt", "punts", ["P"])):
            _, sm = col(tab, s, c_, slots)
            samples[nm + tag] = _merge(samples.get(nm + tag), arr(sm))
    gp = np.zeros(n)
    team_of = np.full(n, -1, dtype="int64")
    for sl, tab in SLOT_TABLE.items():
        d = F["_all"][tab]
        d = d[d.pid.map(slot) == sl]
        if tab == "dfn":
            act = d[(d[["e_tkl", "e_sack", "e_tfl", "e_pbu", "int", "ff", "stop"]].fillna(0).sum(axis=1) > 0)]
            g_ = act.groupby("pid").game_id.nunique()
        else:
            g_ = d.groupby("pid").game_id.nunique()
        tm_ = d.groupby("pid").team.agg(lambda s_: s_.value_counts().index[0])
        for p_, v_ in g_.items():
            if p_ in idx:
                gp[idx[p_]] = v_
        for p_, v_ in tm_.items():
            if p_ in idx:
                team_of[idx[p_]] = v_
    qual = np.zeros(n, dtype=bool)
    for sl, (key, amt) in C.QUAL.items():
        m = (pl.slot == sl).to_numpy()
        s_ = np.nan_to_num(samples[key])
        qual |= m & (s_ >= amt * scale)
    val = savant_value(y, F[""], E[""], pl, slot, W, scale)
    fbs = fbs_table(y).set_index("team")
    out = {"season": y, "players": pl, "idx": idx, "values": values, "samples": {k: _round(v, 2) for k, v in samples.items()},
           "gp": gp.astype(int), "team": team_of, "qual": qual, "value": val, "weights": W, "scale": scale, "frames": F, "effects": E,
           "people": ppl, "positions": pos, "fbs": fbs}
    return out


def _merge(a, b):
    return b if a is None else np.where(np.isnan(a), b, a)


def _round(v, dp):
    return np.round(v.astype(float), dp)


# ---------------------------------------------------------------- Savant value (value.py, one season)
def savant_value(y, F, E, pl, slot, W, scale):
    """Expected points above a replacement-level player at his position, opponent-adjusted (RESEARCH section 6).

    Same construction as value.build_values: a rate shrunk toward the position mean with its settle
    point, minus the 25th-percentile qualified rate, times volume. During the season the qualifying
    samples are scaled by the share of twelve games played, as the card's are.
    """
    q0 = dict(VQUAL)
    for k in q0:
        VQUAL[k] = q0[k] * scale
    try:
        out = []
        q = F["qb"][F["qb"].pid.map(slot) == "QB"].copy()
        q["adj"] = q.epa - q.db * E.add(q, "epa_pass", "db") + q.q_rush_epa - q.q_rush * E.add(q, "epa_rush", "rush")
        q["n_"] = q.db + q.q_rush
        a = q.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("n_", "sum"), games=("game_id", "nunique")).reset_index()
        out.append(shrink_value(a, "QB", "n_", "adj"))
        rc = F["rec"].copy()
        rc["adj"] = rc.epa_eff - rc.tgt_eff * E.add(rc, "epa_pass", "db")
        for sl in ("WR", "TE"):
            x = rc[rc.pid.map(slot) == sl]
            a = x.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("t_db", "sum"), tgts=("tgt_eff", "sum"),
                                                 games=("game_id", "nunique")).reset_index()
            out.append(shrink_value(a, sl, "n_", "adj", qual_col="tgts"))
        ru = F["rush"][F["rush"].pid.map(slot) == "RB"].copy()
        ru["adj"] = ru.epa - ru.rush * E.add(ru, "epa_rush", "rush")
        a1 = ru.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("rush", "sum"), games=("game_id", "nunique")).reset_index()
        x = rc[rc.pid.map(slot) == "RB"]
        a2 = x.groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("tgt_eff", "sum"), games=("game_id", "nunique")).reset_index()
        a = pd.concat([a1, a2]).groupby(["season", "pid"]).agg(adj=("adj", "sum"), n_=("n_", "sum"), games=("games", "max")).reset_index()
        out.append(shrink_value(a, "RB", "n_", "adj"))
        d = F["dfn"]
        for sl in ("EDGE", "IDL", "LB", "CB", "S"):
            x = d[d.pid.map(slot) == sl]
            a = x.groupby(["season", "pid"]).agg(disr=("disr_adj", "sum"), dplays=("dplays", "sum"), games=("game_id", "nunique")).reset_index()
            out.append(shrink_value(a, sl, "dplays", "disr"))
        k = F["kick"][F["kick"].pid.map(slot) == "K"]
        a = k.groupby(["season", "pid"]).agg(adj=("pts_oe", "sum"), n_=("fga", "sum"), games=("game_id", "nunique")).reset_index()
        out.append(shrink_value(a, "K", "n_", "adj"))
        p = F["punt"][F["punt"].pid.map(slot) == "P"]
        a = p.groupby(["season", "pid"]).agg(adj=("poe", "sum"), n_=("punts", "sum"), games=("game_id", "nunique")).reset_index()
        out.append(shrink_value(a, "P", "n_", "adj"))
    finally:
        VQUAL.update(q0)
    v = pd.concat(out, ignore_index=True)[["pid", "slot", "n", "rate", "srate", "mu", "repl", "value", "qualified"]]
    v = v[v.pid.isin(set(pl.pid))].drop_duplicates("pid")
    rt = _read("ret", y, "")
    rt = rt[rt.epa.notna()].copy()
    if len(rt):
        rt["above"] = rt.epa - rt.groupby("kind").epa.transform("mean")
        r = rt.groupby("pid").agg(ret_above=("above", "sum"), returns=("above", "size")).reset_index()
        r["ret_value"] = r.ret_above * r.returns / (r.returns + 40.0)
        v = v.merge(r[["pid", "ret_value", "returns"]], on="pid", how="left")
    else:
        v["ret_value"], v["returns"] = 0.0, 0
    v["ret_value"] = v.ret_value.fillna(0.0)
    v["returns"] = v.returns.fillna(0).astype(int)
    return v


# ---------------------------------------------------------------- All-Savant
def all_savant(D):
    """National 1st / 2nd / 3rd, one team per conference, and a Freshman team, in the AP shape with the
    offensive line as one unit (BUILD decision 4). Pure individual value: nothing knows who won."""
    y, pl = D["season"], D["players"]
    v = D["value"].merge(pl[["pid", "name", "cls_y", "fr"]], on="pid", how="left")
    v["team"] = v.pid.map(dict(zip(pl.pid, D["team"])))
    fbs = D["fbs"]
    v["school"] = v.team.map(fbs.school)
    v["conference"] = v.team.map(fbs.conference)
    v = v[v.school.notna() & v.qualified]
    ol = ol_units(D["effects"][""].tg)
    ol["school"] = ol.team.map(fbs.school)
    ol["conference"] = ol.team.map(fbs.conference)
    ol = ol[ol.school.notna()]

    def pick(x, o, tiers):
        used, used_ol, rows = set(), set(), []
        for tier in range(1, tiers + 1):
            for sl, cnt in SHAPE:
                if sl == "OL unit":
                    c = o[~o.team.isin(used_ol)].sort_values(["value", "team"], ascending=[False, True]).head(cnt)
                    for r in c.itertuples():
                        used_ol.add(r.team)
                        rows.append(dict(tier=tier, slot="OL", pid=None, team=int(r.team), value=round(float(r.value), 2),
                                         pass_pro=round(float(r.pass_pro_pts * r.games), 2), run_block=round(float(r.run_block_pts * r.games), 2)))
                    continue
                if sl == "DB":
                    c = x[x.slot.isin(["CB", "S"]) & ~x.pid.isin(used)]
                elif sl == "AP":
                    c = x[x.slot.isin(["RB", "WR", "TE"]) & ~x.pid.isin(used)].assign(value=lambda t: t.value + t.ret_value)
                else:
                    c = x[(x.slot == sl) & ~x.pid.isin(used)]
                for r in c.sort_values(["value", "pid"], ascending=[False, True]).head(cnt).itertuples():
                    used.add(r.pid)
                    rows.append(dict(tier=tier, slot=sl, pid=int(r.pid), team=int(r.team), value=round(float(r.value), 2), pos=r.slot))
        return rows

    out = {"national": pick(v, ol, 3), "conference": {}, "freshman": pick(v[v.fr.fillna(False).astype(bool)], ol.iloc[:0], 1)}
    for conf in sorted(c for c in v.conference.dropna().unique() if "Independent" not in c):
        out["conference"][conf] = pick(v[v.conference == conf], ol[ol.conference == conf], 1)
    top = v.sort_values(["value", "pid"], ascending=[False, True])
    out["heisman"] = [dict(pid=int(r.pid), team=int(r.team), slot=r.slot, value=round(float(r.value), 2)) for r in top.head(10).itertuples()]
    out["non_qb"] = [dict(pid=int(r.pid), team=int(r.team), slot=r.slot, value=round(float(r.value), 2))
                     for r in top[top.slot != "QB"].head(10).itertuples()]
    out["ol_units"] = ol
    return out


def load_state():
    from .state import load_state as ls
    return ls()


def main(argv):
    state = load_state()
    if argv[0] == "check":
        D = build(2025, state)
        old = pd.read_parquet(WORK / "savant_value.parquet")
        old = old[old.season == 2025]
        m = D["value"].merge(old[["pid", "value", "slot", "qualified"]], on="pid", suffixes=("", "_p1"))
        q = m[m.qualified & m.qualified_p1]
        print("2025 players in both", len(m), "qualified in both", len(q), "same slot", float((q.slot == q.slot_p1).mean()))
        print("correlation of Savant value with prompt 1's:", round(float(q.value.corr(q.value_p1)), 4),
              "| by slot:", {s: round(float(g.value.corr(g.value_p1)), 3) for s, g in q.groupby("slot")})
        return
    for a in argv:
        y = int(a)
        D = build(y, state)
        pl = D["players"]
        A = all_savant(D)
        nm = dict(zip(pl.pid, pl.name))
        print(y, "players", len(pl), "qualified", int(D["qual"].sum()), "by slot", pl.slot.value_counts().to_dict(), "scale", round(D["scale"], 2))
        print("  Savant Heisman:", [(nm[h["pid"]], h["slot"], h["value"]) for h in A["heisman"][:5]])
        print("  Non-QB:", [(nm[h["pid"]], h["slot"], h["value"]) for h in A["non_qb"][:3]])
        print("  1st team:", [(r["slot"], nm.get(r["pid"], D["fbs"].school.get(r["team"]))) for r in A["national"] if r["tier"] == 1])


if __name__ == "__main__":
    main(sys.argv[1:])
