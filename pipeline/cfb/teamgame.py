"""Team-game table: every numerator and denominator the team studies need.

    python -m pipeline.cfb.teamgame            # writes work/teamgame.parquet (2004-2026)

One row per team per FBS-vs-FBS game per garbage-time filter (`filt` = all /
cfbd / wp). Columns are the team's OFFENCE (and its special teams and
penalties); a team's defence is its opponent's row, joined in `load()`.

Sources, chosen after measuring each (completeness.py and the sanity table):
  * plays, yards, EPA, success, drives: the play-by-play;
  * turnovers, interceptions thrown, fumbles lost, penalties: the TEAM BOX,
    because the play text misses about a third of fumbles in 2021-2023;
  * total fumbles (for recovery luck): the player box "fumbles" category from
    2016, the play text before that.
"""
import numpy as np
import pandas as pd
from .paths import RAW, WORK
from . import tgx

MIN_PLAYS = 80
EXPL_RUSH, EXPL_PASS = 12, 16     # "explosive": a run of 12+ or a pass of 16+ yards (Connelly's cut)


def success(d):
    """Connelly success: 50% of the distance on 1st down, 70% on 2nd, all of it on 3rd/4th; or a TD."""
    need = np.select([d.down == 1, d.down == 2], [0.5 * d.dist, 0.7 * d.dist], default=d.dist)
    ok = (d.yards >= need) | (d.pts == 7)
    return ok & ~(d.f_int | d.f_fum_lost) & (d.pts >= 0)


def line_yards(y):
    """Football Outsiders line yards: losses x1.2, 0-4 x1, 5-10 x0.5, beyond 10 nothing."""
    y = y.astype(float)
    return np.where(y < 0, 1.2 * y, np.minimum(y, 4) + 0.5 * np.clip(y - 4, 0, 6))


def scrimmage(d):
    """Rush and pass plays that count: no kneels, spikes, overtime or plays wiped out by penalty."""
    return d.cat.isin(["rush", "pass"]) & ~d.f_kneel & ~d.f_spike & (d.period <= 4) & ~d.f_pen_noplay


def season_table(y, games):
    g = games[(games.season == y) & games.fbs_game & games.final]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    e = pd.read_parquet(WORK / f"epa_{y}.parquet")
    assert (d.play_id.to_numpy() == e.play_id.to_numpy()).all()
    for c in ("ep", "epa", "wp", "wp_naive", "garbage_cfbd", "garbage_wp"):
        d[c] = e[c].to_numpy()
    d = d[d.game_id.isin(g.game_id) & d.off.notna()].copy()
    n = d[d.cat.isin(["rush", "pass"])].groupby("game_id").size()
    d = d[d.game_id.isin(n[n >= MIN_PLAYS].index)]
    d["off"] = d.off.astype("int64")
    d["deff"] = d.deff.astype("int64")
    d["sc"] = scrimmage(d)
    d["succ"] = success(d) & d.sc
    d["is_pass"] = d.sc & (d.cat == "pass")
    d["is_rush"] = d.sc & (d.cat == "rush")
    d["expl"] = (d.is_rush & (d.yards >= EXPL_RUSH)) | (d.is_pass & (d.yards >= EXPL_PASS))
    d["stuff"] = d.is_rush & (d.yards <= 0)
    d["ly"] = np.where(d.is_rush, line_yards(d.yards), 0.0)
    d["tfl"] = d.sc & (d.yards < 0) & ~(d.f_att & ~d.f_comp & ~d.f_sack)
    d["pbu"] = d.is_pass & (d.f_pbu | d.pbu_by.notna() | d.pdef1.notna()) & ~d.f_int
    d["ffum"] = d.sc & (d.f_ff | d.ff_by.notna() | d.ffby1.notna())
    d["havoc"] = d.tfl | d.pbu | d.ffum | (d.is_pass & d.f_int)
    d["third"] = d.sc & (d.down == 3)
    d["third_conv"] = d.third & ((d.yards >= d.dist) | (d.pts == 7))
    d["pd_down"] = d.sc & (((d.down == 2) & (d.dist >= 8)) | ((d.down >= 3) & (d.dist >= 5)))   # passing downs
    d = tgx.prepare(d, y, games)
    out = []
    for filt in ("all", "cfbd", "wp"):
        k = d if filt == "all" else d[~d["garbage_" + filt].fillna(False)]
        s = k[k.sc]
        a = s.groupby(["game_id", "off"]).agg(
            plays=("sc", "size"), epa=("epa", "sum"), epa_n=("epa", "count"), succ=("succ", "sum"),
            db=("is_pass", "sum"), rush=("is_rush", "sum"), expl=("expl", "sum"), stuff=("stuff", "sum"),
            ly=("ly", "sum"), tfl=("tfl", "sum"), pbu=("pbu", "sum"), ffum=("ffum", "sum"), havoc=("havoc", "sum"),
            third=("third", "sum"), third_conv=("third_conv", "sum"), sacks=("f_sack", "sum"), ints=("f_int", "sum"),
            fum=("f_fum", "sum"), yards=("yards", "sum"), pdown=("pd_down", "sum"))
        a["epa_pass"] = s[s.is_pass].groupby(["game_id", "off"]).epa.sum()
        a["epa_rush"] = s[s.is_rush].groupby(["game_id", "off"]).epa.sum()
        a["succ_pass"] = s[s.is_pass].groupby(["game_id", "off"]).succ.sum()
        a["succ_rush"] = s[s.is_rush].groupby(["game_id", "off"]).succ.sum()
        a["epa_succ"] = s[s.succ].groupby(["game_id", "off"]).epa.sum()        # explosiveness numerator
        a["epa_pdown"] = s[s.pd_down].groupby(["game_id", "off"]).epa.sum()
        a["epa_sdown"] = s[~s.pd_down].groupby(["game_id", "off"]).epa.sum()
        # drives
        dr = k[k.cat.isin(["rush", "pass", "penalty", "punt", "fg"]) & (k.period <= 4) & k.drive_id.notna()]
        first = dr.groupby(["game_id", "drive_id"]).agg(off=("off", "first"), start=("ytg", "first"),
                                                       best=("ytg", "min"), pts=("pts", "max"), ptsmin=("pts", "min"))
        fd40 = dr[(dr.down == 1) & (dr.ytg <= 40)].groupby(["game_id", "drive_id"]).size()
        first["opp"] = first.index.isin(fd40.index) | (first.pts == 7)
        first["rz"] = first.best <= 20
        first["dpts"] = np.where(first.pts > 0, first.pts, 0)
        first = first.reset_index()
        b = first.groupby(["game_id", "off"]).agg(drives=("drive_id", "size"), start=("start", "sum"),
                                                  opps=("opp", "sum"), rz=("rz", "sum"))
        b["opp_pts"] = first[first.opp].groupby(["game_id", "off"]).dpts.sum()
        b["rz_td"] = first[first.rz & (first.pts == 7)].groupby(["game_id", "off"]).size()
        a = a.join(b, how="left")
        # special teams EPA: every kick play, credited to the kicking side and debited to the other
        st = k[k.cat.isin(["punt", "fg", "kickoff"]) & k.epa.notna() & (k.period <= 4)]
        a["st_epa"] = (st.groupby(["game_id", "off"]).epa.sum().reindex(a.index).fillna(0)
                       - st.groupby(["game_id", "deff"]).epa.sum().rename_axis(["game_id", "off"]).reindex(a.index).fillna(0))
        a["st_n"] = (st.groupby(["game_id", "off"]).size().reindex(a.index).fillna(0)
                     + st.groupby(["game_id", "deff"]).size().rename_axis(["game_id", "off"]).reindex(a.index).fillna(0))
        a = tgx.add(a, k, d, y, filt)
        a = a.fillna(0).reset_index().rename(columns={"off": "team"})
        a["filt"] = filt
        out.append(a)
    t = pd.concat(out, ignore_index=True)
    t["season"] = y
    # team box: turnovers, penalties
    tb = pd.read_parquet(RAW / "espn_cfb_team_box" / f"team_box_{y}.parquet")
    tb["team"] = tb.team_id.astype("int64")
    for c in ("turnovers", "fumblesLost", "interceptions"):
        tb[c] = pd.to_numeric(tb[c], errors="coerce")
    pen = tb.totalPenaltiesYards.astype(str).str.extract(r"(\d+)-(\d+)").astype(float)
    tb["pen_n"], tb["pen_yds"] = pen[0], pen[1]
    tb = tb.drop_duplicates(["game_id", "team"])[["game_id", "team", "turnovers", "fumblesLost", "interceptions", "pen_n", "pen_yds"]]
    tb = tb.rename(columns={"turnovers": "to_box", "fumblesLost": "fl_box", "interceptions": "int_box"})
    t = t.merge(tb, on=["game_id", "team"], how="left")
    # total fumbles: player box from 2016 (when the category exists), else the play text
    pb = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet")
    fb = pb[pb.category == "fumbles"].copy()
    if len(fb) and "fumbles" in fb.columns and pd.to_numeric(fb.fumbles, errors="coerce").sum() > 0:
        fb["fumbles"] = pd.to_numeric(fb.fumbles, errors="coerce")
        fb["team"] = fb.team_id.astype("int64")
        f = fb.groupby(["game_id", "team"]).fumbles.sum().rename("fum_box").reset_index()
        t = t.merge(f, on=["game_id", "team"], how="left")
        t["fum_all"] = np.maximum(t.fum_box.fillna(0), t.fl_box.fillna(0))
    else:
        t["fum_all"] = np.maximum(t.fum, t.fl_box.fillna(0))
    # opponent, site, points, calendar
    gg = g.set_index("game_id")
    t["home"] = t.game_id.map(gg.home)
    t["away"] = t.game_id.map(gg.away)
    t["opp"] = np.where(t.team == t.home, t.away, t.home)
    t["site"] = np.where(t.game_id.map(gg.neutral_site).fillna(False), 0, np.where(t.team == t.home, 1, -1))
    hp, ap = t.game_id.map(gg.home_pts), t.game_id.map(gg.away_pts)
    t["pf"] = np.where(t.team == t.home, hp, ap)
    t["pa"] = np.where(t.team == t.home, ap, hp)
    t["week"] = t.game_id.map(gg.week)
    t["season_type"] = t.game_id.map(gg.season_type)
    t["date"] = t.game_id.map(gg.date)
    return t.drop(columns=["home", "away"])


def build(seasons=None):
    """All seasons, or only `seasons` (their rows replace the ones already in the table)."""
    games = pd.read_parquet(WORK / "games.parquet")
    parts = []
    f = WORK / "teamgame.parquet"
    if seasons is not None and f.exists():
        old = pd.read_parquet(f)
        parts.append(old[~old.season.isin(seasons)])
    for y in (seasons if seasons is not None else range(2004, 2027)):
        t = season_table(y, games)
        parts.append(t)
        a = t[t.filt == "all"]
        print(y, "team-games", len(a), "plays/team", round(a.plays.mean(), 1), "epa/play", round(a.epa.sum() / a.epa_n.sum(), 4),
              "succ", round(a.succ.sum() / a.plays.sum(), 3), "drives", round(a.drives.mean(), 1), "TO", round(a.to_box.mean(), 2),
              "pen", round(a.pen_n.mean(), 2), "st_epa", round(a.st_epa.mean(), 3), flush=True)
    pd.concat(parts, ignore_index=True).sort_values(["season", "filt", "game_id", "team"], kind="stable").reset_index(
        drop=True).to_parquet(WORK / "teamgame.parquet", index=False)


def load(filt="cfbd", seasons=None):
    """Team-game rows with the opponent's row joined as `d_*` (what this team's defence allowed)."""
    t = pd.read_parquet(WORK / "teamgame.parquet")
    t = t[t.filt == filt]
    if seasons is not None:
        t = t[t.season.isin(seasons)]
    keep = [c for c in t.columns if c not in ("filt", "season", "opp", "site", "pf", "pa", "week", "season_type", "date")]
    o = t[keep].rename(columns={c: "d_" + c for c in keep if c not in ("game_id", "team")}).rename(columns={"team": "opp"})
    m = t.merge(o, on=["game_id", "opp"], how="inner")
    return m.sort_values(["season", "team", "date"]).reset_index(drop=True)


if __name__ == "__main__":
    import sys
    build([int(a) for a in sys.argv[1:]] or None)
