"""1.1.0: the team-game expansion. teamgame.season_table calls `prepare` once per season and `add` once per
garbage-time filter. Every column is the team's OFFENCE (or its kicking side); its defence is the opponent's
row, joined as d_* by teamgame.load, so "what the defence allows" is the same arithmetic read from the other side.

  proe_n, neutral_x     pass rate over expected in neutral situations (expand.py's definition)
  early_n, early_db     early-down pass rate, same situations, first and second down
  pace_s, pace_n        seconds from each snap to the next, outside the two-minute drill (60 at most)
  d_pts, d_td, d_3out   drive points (touchdowns count 7), touchdown drives, three-and-outs
  expl_pass, expl_rush  explosive passes (16+) and runs (12+)
  tm_epa / tm_n, m8_epa / m8_n   two-minute and middle-8 EPA
  ko_epa, kr_epa, pu_epa, pr_epa, fg_epa, ko_n, kr_n, pu_n, pr_n, fg_n   special teams by phase, for the side named
  fd4_*                 fourth-down decisions (fourth.py): count, went, expected go, followed WCE's recommendation,
                        expected points given up
  two_n, two_att, two_good   tries after touchdowns: read, two-point attempts, conversions
  to_n, to_late         timeouts charged, and those in the last two minutes of a half
  c_*                   Tier B, charted games only (charting.py): dropbacks, pressures, hurries, air yards, YAC, deep
                        throws, runs by direction (success, line yards, stuffs, EPA), shotgun, under center and
                        no-huddle plays and their EPA
"""
import numpy as np
import pandas as pd
from . import expand, fourth
from .paths import WORK

_CACHE = {}
C_SUM = ["c_ok", "c_db", "c_rush", "c_att", "c_press", "c_hur", "c_sack", "c_airok", "c_air0", "c_cair", "c_yacok", "c_yac0", "c_deep",
         "c_behind", "c_shotgun", "c_uc", "c_nh", "c_shotgun_epa", "c_uc_epa", "c_nh_epa", "c_press_epa", "c_clean", "c_clean_epa"]
for _s in ("l", "m", "r"):
    C_SUM += [f"c_r{_s}", f"c_r{_s}_succ", f"c_r{_s}_ly", f"c_r{_s}_stuff", f"c_r{_s}_epa"]


def prepare(d, y, games):
    d = d.copy()
    d["attp"] = d.is_pass & d.f_att & ~d.f_sack
    d["comp"] = d.attp & d.f_comp
    d["epa0"] = d.epa.fillna(0.0)
    d = expand.charted(expand.enrich(expand.outcome_cols(d, games), y), y)
    # seconds to the next snap (same game and half), outside the two-minute drill
    nxt = d.groupby(["game_id", "halfb"]).secs_half.shift(-1)
    gap = (d.secs_half - nxt).clip(lower=0, upper=60)
    d["pace_s"] = np.where(d.sc & ~d.twomin & gap.notna(), gap, 0.0)
    d["pace_n"] = d.sc & ~d.twomin & gap.notna()
    d["expl_pass"] = d.is_pass & (d.yards >= 16)
    d["expl_rush"] = d.is_rush & (d.yards >= 12)
    d["tm_epa"] = np.where(d.twomin, d.epa0, 0.0)
    d["m8_epa"] = np.where(d.mid8, d.epa0, 0.0)
    d["early_db"] = d.early & d.is_pass
    return d


def add(a, k, d, y, filt):
    """a: the team-game aggregates indexed by (game_id, off); k: this filter's plays."""
    s = k[k.sc]
    g = s.groupby(["game_id", "off"])
    new = g.agg(proe_n=("proe_n", "sum"), neutral_x=("neutral_x", "sum"), early_n=("early", "sum"), early_db=("early_db", "sum"),
                pace_s=("pace_s", "sum"), pace_n=("pace_n", "sum"), expl_pass=("expl_pass", "sum"), expl_rush=("expl_rush", "sum"),
                tm_epa=("tm_epa", "sum"), tm_n=("twomin", "sum"), m8_epa=("m8_epa", "sum"), m8_n=("mid8", "sum"),
                **{c: (c, "sum") for c in C_SUM})
    a = a.join(new, how="left")
    # drives (the filter's plays, regulation, any play type that belongs to a possession)
    dr = k[k.cat.isin(["rush", "pass", "penalty", "punt", "fg"]) & (k.period <= 4) & k.drive_id.notna()]
    info = dr.groupby(["game_id", "drive_id"]).agg(off=("off", "first"), pts=("pts", "max"), plays=("sc", "sum"), fds=("fd", "sum"),
                                                   punt=("cat", lambda x: (x == "punt").any())).reset_index()
    info = info[info.plays > 0]
    info["dpts"] = np.where(info.pts > 0, info.pts, 0.0)
    info["dtd"] = info.pts == 7
    info["d3o"] = info.punt & (info.fds == 0) & (info.plays <= 3)
    b = info.groupby(["game_id", "off"]).agg(d_n=("drive_id", "size"), d_pts=("dpts", "sum"), d_td=("dtd", "sum"), d_3out=("d3o", "sum"))
    a = a.join(b, how="left")
    # special teams by phase: kickoffs (ESPN's offence is the receiving side), punts and field goals (the kicking side)
    st = k[k.cat.isin(["punt", "fg", "kickoff"]) & k.epa.notna() & (k.period <= 4)]
    for name, cat, side, sign in (("ko", "kickoff", "deff", -1), ("kr", "kickoff", "off", 1), ("pu", "punt", "off", 1),
                                  ("pr", "punt", "deff", -1), ("fg", "fg", "off", 1)):
        x = st[st.cat == cat]
        gg = x.groupby(["game_id", side]).epa.agg(["sum", "size"]).rename_axis(["game_id", "off"])
        a[f"{name}_epa"] = sign * gg["sum"].reindex(a.index).fillna(0)
        a[f"{name}_n"] = gg["size"].reindex(a.index).fillna(0)
    # decisions (fourth.py): garbage time out for the filtered rows, as everywhere else
    f = WORK / f"decisions_{y}.parquet"
    if f.exists():
        dc = pd.read_parquet(f)
        if filt == "cfbd":
            dc = dc[~dc.garbage_cfbd.fillna(False)]
        dc = dc.assign(go=dc.decision == "go", follow=dc.decision == dc.rec, should=dc.rec == "go",
                       went_should=(dc.rec == "go") & (dc.decision == "go"))
        b = dc.groupby(["game_id", "off"]).agg(fd4_n=("go", "size"), fd4_go=("go", "sum"), fd4_xgo=("xgo", "sum"), fd4_follow=("follow", "sum"),
                                               fd4_eplost=("ep_lost", "sum"), fd4_should=("should", "sum"), fd4_went_should=("went_should", "sum"))
        a = a.join(b, how="left")
    if not (WORK / f"xtra_{y}.parquet").exists():          # seasons not on the site (2004-2008, 2013) have no side table
        return a
    if y not in _CACHE:
        _CACHE.clear()
        _CACHE[y] = (fourth.tries(y), fourth.timeouts(y))
    t, o = _CACHE[y]
    b = t[t.known].groupby(["game_id", "team"]).agg(two_n=("known", "sum"), two_att=("two", "sum"), two_good=("two_good", "sum"))
    a = a.join(b.rename_axis(["game_id", "off"]), how="left")
    o = o[o.team.notna()].astype({"team": "int64"})
    b = o.groupby(["game_id", "team"]).agg(to_n=("late", "size"), to_late=("late", "sum"))
    a = a.join(b.rename_axis(["game_id", "off"]), how="left")
    return a
