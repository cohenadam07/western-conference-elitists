"""College Football Savant: the registry. Every stat the page or the connector can show is
declared here once, with its verdict from research/cfb/BACKTEST.md (BUILD step 1).

A stat is a ratio num / den taken from one of the player-game tables
(playergame.py) and summed over a season. What the page does with it follows
from `verdict`, which is the backtest's, not a choice made here:

  full      a percentile bar; hatched only while his sample is under the settle point
  hatched   a percentile bar that is always hatched (BUILD decision 3: "every RB rate is hatched")
  context   a CONTEXT row: it says how much or is too noisy to grade (same bar, labelled)
  luck      a CONTEXT row labelled "luck" (team turnovers and recoveries)

`k` is the settle point (the sample at which his own number and the position
average carry equal weight) in `unit_n`. `adj` names the team-level rate whose
opponent effect is removed: ("epa_pass", "db", "add") subtracts the opposing
defence's effect on EPA per dropback from each of his dropbacks; "mult" scales a
defender's count by how often the offence he faced allows that play.
`start` is the first season the stat is tracked; `off` lists later seasons it is
not ("not tracked" is never shown as zero).

`python -m pipeline.cfb.config` checks the registry against the verdict table.
"""
from collections import namedtuple

VERSION = "1.0.0"
FIRST_SEASON = 2009
CURRENT = 2026
LAUNCH_FIRST = 2014
# 2009-2012 were added after launch (BUILD step 16), behind prompt 1's gates (research/cfb/out/completeness.md):
# 2013 passes only for teams (its play text names a sacker on a third of sacks), 2004-2008 have play-by-play for
# under 97% of FBS games. Neither is on the site.
EARLY = [2009, 2010, 2011, 2012]
DROPPED = {2013: "its play-by-play names the defender on only a third of sacks, so it passes the gate for teams only",
           **{y: "play-by-play exists for under 97% of its FBS games" for y in range(2004, 2009)}}
SEASONS = EARLY + list(range(LAUNCH_FIRST, CURRENT + 1))
NO_TACKLERS = EARLY        # before 2014 the play text names no tackler: tackles for loss and run stops are not tracked
EARLY_DEF_NOTE = ("Before 2014 the play-by-play names no tacklers, so tackles for loss and run stops are not tracked, "
                  "and a defender's Savant value counts his sacks, interceptions, break-ups and forced fumbles only.")
MIN_POOL = 20                 # a pool under 20 players is widened and labelled (BUILD step 8)
GAMES_FULL = 12               # qualifying samples are stated for a 12-game regular season
PBU_OFF = [2021, 2022, 2023]            # the play text stopped naming who broke up the pass; no box score yet
FF_OFF = [2021, 2022, 2023, 2024]       # forced fumbles under-reported in the play text
PRE_BOX_WARNING = ("Defensive picks before 2024 depend on how fully each school's stat crew logged tackles and pass "
                   "break-ups, so they aren't comparable across schools.")
DEFENDER_NOTE = ("Defenders are graded on the plays the box score and play-by-play credit them with. This credits "
                 "playmakers, not a cornerback who was never thrown at.")

# position slots (the pools) and the wider group each falls back to when a pool is under MIN_POOL
SLOTS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "IDL", "LB", "CB", "S", "K", "P"]
SLOT_NAME = {"QB": "quarterbacks", "RB": "running backs", "WR": "wide receivers", "TE": "tight ends",
             "OL": "offensive linemen", "EDGE": "edge rushers", "IDL": "interior linemen", "LB": "linebackers",
             "CB": "cornerbacks", "S": "safeties", "K": "kickers", "P": "punters"}
WIDER = {"EDGE": "DL", "IDL": "DL", "CB": "DB", "S": "DB"}
WIDER_NAME = {"DL": "defensive linemen", "DB": "defensive backs"}
POWER4 = ["ACC", "Big Ten", "Big 12", "SEC"]

# qualifying sample for a 12-game season, per slot: (sample key, amount). In a season still
# being played it is scaled by the share of 12 games the median team has played.
QUAL = {"QB": ("plays", 150), "RB": ("rush", 80), "WR": ("tgt", 30), "TE": ("tgt", 15), "EDGE": ("dplays", 350),
        "IDL": ("dplays", 350), "LB": ("dplays", 350), "CB": ("dplays", 350), "S": ("dplays", 350),
        "K": ("fga", 10), "P": ("punts", 25)}

S = namedtuple("S", "key pos table num den label group verdict unit lower k unit_n sample adj start off what formula source note")
_ALL_D = ["EDGE", "IDL", "LB", "CB", "S"]
SRC_PBP = "ESPN play-by-play, valued by WCE's expected-points model"
SRC_BOX = "ESPN box score"
SRC_BOTH = "ESPN box score from 2024; ESPN play-by-play before that"
GROUPS = ["Passing", "Rushing", "Receiving", "Pass rush", "Run defense", "Coverage", "Disruption", "Kicking", "Punting", "Context"]
STATS = []


def R(key, pos, table, num, den, label, group, verdict, unit, k, unit_n, sample, what, formula, source=SRC_PBP,
      lower=False, adj=None, start=FIRST_SEASON, off=(), note=""):
    STATS.append(S(key, pos if isinstance(pos, list) else [pos], table, num, den, label, group, verdict, unit, lower, k,
                   unit_n, sample, adj, start, list(off), what, formula, source, note))


# ---------------------------------------------------------------- quarterbacks
R("qb_epa_db", "QB", "qb", "epa", "db", "EPA per dropback", "Passing", "full", "epa", 224, "dropbacks", "db",
  "Expected points he adds each time he drops back to pass, sacks and interceptions included.",
  "sum of EPA on his dropbacks / dropbacks", adj=("epa_pass", "db", "add"))
R("qb_success", "QB", "qb", "succ", "db", "Success rate", "Passing", "full", "pct1", 188, "dropbacks", "db",
  "How often a dropback keeps the offence on schedule: half the distance on first down, 70% on second, all of it on third or fourth.",
  "successful dropbacks / dropbacks", adj=("succ_pass", "db", "add"))
R("qb_sack_rate", "QB", "qb", "sacks", "db", "Sack rate", "Passing", "full", "pct1", 211, "dropbacks", "db",
  "How often a dropback ends in a sack. It travels with a quarterback when he transfers better than anything else he does.",
  "sacks / dropbacks", lower=True, adj=("sacks", "db", "add"))
R("qb_ypa", "QB", "qb", "yards", "att", "Yards per attempt", "Passing", "full", "num1", 188, "attempts", "att",
  "Passing yards per pass thrown.", "passing yards / attempts")
R("qb_cmp", "QB", "qb", "cmp", "att", "Completion rate", "Passing", "full", "pct1", 188, "attempts", "att",
  "Share of his passes that are caught.", "completions / attempts")
R("qb_expl", "QB", "qb", "expl", "att", "Explosive pass rate", "Passing", "full", "pct1", 251, "attempts", "att",
  "Share of his passes that gain 16 yards or more.", "completions of 16+ yards / attempts")
R("qb_total_epa", "QB", "qb", "tot_epa", "tot_plays", "Total EPA per play", "Passing", "full", "epa", 237, "plays", "plays",
  "Expected points added per play he threw or ran, the best single measure of a college quarterback.",
  "(EPA on dropbacks + EPA on his runs) / (dropbacks + runs)", adj=("epa", "plays", "add"))
R("qb_pd_epa", "QB", "qb", "pd_epa", "pd_db", "EPA per dropback, passing downs", "Passing", "hatched", "epa", 158, "dropbacks", "pd_db",
  "EPA per dropback on passing downs: second and 8 or more, third or fourth and 5 or more.",
  "EPA on passing-down dropbacks / passing-down dropbacks", adj=("epa_pass", "db", "add"))
R("qb_sd_epa", "QB", "qb", "sd_epa", "sd_db", "EPA per dropback, standard downs", "Passing", "hatched", "epa", 251, "dropbacks", "sd_db",
  "EPA per dropback on every other down.", "EPA on standard-down dropbacks / standard-down dropbacks", adj=("epa_pass", "db", "add"))
R("qb_rush_epa", "QB", "qb", "q_rush_epa", "q_rush", "EPA per rush", "Rushing", "hatched", "epa", 119, "rushes", "q_rush",
  "Expected points added per run. Scrambles and designed runs are one number: the play text rarely says which it was.",
  "EPA on his runs / runs", adj=("epa_rush", "rush", "add"), note="Scrambles are not tracked separately.")
R("qb_rush_value", "QB", "qb", "q_rush_epa", "tot_plays", "Rushing EPA per play", "Rushing", "hatched", "epa", 398, "plays", "plays",
  "How much his legs add per play he threw or ran, so a quarterback who rarely runs sits near zero.",
  "EPA on his runs / (dropbacks + runs)")
R("qb_int_rate", "QB", "qb", "ints", "att", "Interception rate", "Context", "context", "pct1", 1188, "attempts", "att",
  "Interceptions per pass. Mostly noise in one season: it needs about 1,200 attempts to be half signal.",
  "interceptions / attempts", lower=True, note="Mostly noise in one season.")
R("qb_cpoe", "QB", "qb", "cpoe", "att_depth", "Completion % over expected", "Context", "context", "sgn1", 250, "attempts", "att_depth",
  "Completion rate against what an average FBS passer completes on the same throws, by depth, side, down and distance.",
  "completions - expected completions, per 100 attempts with a charted depth", start=2025,
  note="Needs the stat crew's pass depth, which the play text carries from 2025. New, so shown as context until it has a backtest.")
R("qb_usage", "QB", "qb", "db", "t_db", "Share of team dropbacks", "Context", "context", "pct1", 53, "team dropbacks", "t_db",
  "Share of his team's dropbacks he took in the games he played.", "his dropbacks / team dropbacks in games he played")

# ---------------------------------------------------------------- running backs
R("rb_epa_rush", "RB", "rush", "epa", "rush", "EPA per rush", "Rushing", "hatched", "epa", 266, "rushes", "rush",
  "Expected points added per carry. Little of a back's efficiency survives a transfer, which says much of it is his line and scheme.",
  "EPA on his runs / runs", adj=("epa_rush", "rush", "add"))
R("rb_success", "RB", "rush", "succ", "rush", "Success rate", "Rushing", "hatched", "pct1", 211, "rushes", "rush",
  "How often a carry keeps the offence on schedule.", "successful runs / runs", adj=("succ_rush", "rush", "add"))
R("rb_expl", "RB", "rush", "expl", "rush", "Explosive run rate", "Rushing", "hatched", "pct1", 178, "rushes", "rush",
  "Share of his carries that gain 12 yards or more.", "runs of 12+ yards / runs")
R("rb_stuff", "RB", "rush", "stuff", "rush", "Stuff rate", "Rushing", "hatched", "pct1", 158, "rushes", "rush",
  "Share of his carries stopped for no gain or a loss.", "runs of 0 yards or fewer / runs", lower=True, adj=("stuff", "rush", "add"))
R("rb_ypc", "RB", "rush", "yards", "rush", "Yards per rush", "Rushing", "hatched", "num1", 188, "rushes", "rush",
  "Rushing yards per carry.", "rushing yards / runs")
R("rb_rec_value", "RB", "rush", "r_epa", "t_db", "Receiving EPA per team dropback", "Context", "context", "epa", 1000, "team dropbacks", "t_db",
  "What he adds as a receiver, per pass play his team ran in games he played.", "EPA on his targets / team dropbacks")
R("rb_share", "RB", "rush", "rush", "t_rush", "Share of team rushes", "Context", "context", "pct1", 53, "team rushes", "t_rush",
  "Share of his team's carries in the games he played. How much, not how good.", "his runs / team runs in games he played")

# ---------------------------------------------------------------- receivers and tight ends
for _p, _name, _k in (("WR", "wr", dict(yptpa=106, epa=298, ypr=28, expl=47, share=79, tgt=53, catch=106, ept=158)),
                      ("TE", "te", dict(yptpa=133, epa=447, ypr=53, expl=79, share=89, tgt=75, catch=60, ept=126))):
    R(f"{_name}_yptpa", _p, "rec", "yards", "t_att", "Yards per team pass attempt", "Receiving", "full", "num2", _k["yptpa"],
      "team attempts", "t_att", "Receiving yards for every pass his team threw in games he played: the college stand-in "
      "for yards per route run, since routes are not tracked.", "receiving yards / team pass attempts in games he played")
    R(f"{_name}_epa_tdb", _p, "rec", "epa_eff", "t_db", "Receiving EPA per team dropback", "Receiving",
      "full" if _p == "WR" else "hatched", "epa", _k["epa"], "team dropbacks", "t_db",
      "Expected points added on his targets, per pass play his team ran. Receivers are valued per team dropback because "
      "earning targets is the repeatable skill.",
      "EPA on his targets (un-named incompletions shared out by catches) / team dropbacks in games he played",
      adj=("epa_pass", "db", "add") if _p == "WR" else None,
      note="" if _p == "WR" else "Shown before opponent adjustment: for tight ends the adjustment did not predict better.")
    R(f"{_name}_ypr", _p, "rec", "yards", "rec", "Yards per catch", "Receiving", "hatched", "num1", _k["ypr"], "catches", "rec",
      "Receiving yards per catch.", "receiving yards / catches")
    R(f"{_name}_expl", _p, "rec", "expl", "rec", "Explosive catch rate", "Receiving" if _p == "WR" else "Context",
      "hatched" if _p == "WR" else "context", "pct1", _k["expl"], "catches", "rec",
      "Share of his catches that gain 16 yards or more.", "catches of 16+ yards / catches")
    R(f"{_name}_rec_share", _p, "rec", "rec", "t_att", "Catches per team pass attempt", "Context", "context", "pct1", _k["share"],
      "team attempts", "t_att", "Share of his team's passes that he caught. How much, not how good.", "catches / team pass attempts")
    R(f"{_name}_tgt_share", _p, "rec", "tgt_t", "t_att_t", "Target share", "Context", "context", "pct1", _k["tgt"], "team attempts",
      "t_att_t", "Share of his team's passes thrown to him, in games whose play text names the target of every pass.",
      "targets / team pass attempts, in games that name targets", start=2025,
      note="Before 2025 most games do not name the target of an incompletion.")
    R(f"{_name}_catch", _p, "rec", "rec_t", "tgt_t", "Catch rate", "Context", "context", "pct1", _k["catch"], "targets", "tgt_t",
      "Share of his targets that he caught. Too noisy to grade: it is context.", "catches / targets, in games that name targets",
      start=2025, note="Before 2025 most games do not name the target of an incompletion.")
    R(f"{_name}_epa_tgt", _p, "rec", "epa_t", "tgt_t", "EPA per target", "Context", "context", "epa", _k["ept"], "targets", "tgt_t",
      "Expected points added per pass thrown to him. Mostly noise in one season: it is context.",
      "EPA on his targets / targets, in games that name targets", start=2025,
      note="Before 2025 most games do not name the target of an incompletion.")

# ---------------------------------------------------------------- defenders
_D100 = "per 100 team defensive plays (every defensive play of his team's season, so a missed game counts against him)"
for _pos, _n, _k in ((["EDGE", "IDL"], "dl", dict(sack=668, tfl=668, stop=668, hur=596, pd=None, int=None, tkl=355, dis=668, dise=944)),
                     (["LB"], "lb", dict(sack=841, tfl=794, stop=355, hur=1000, pd=1334, int=2512, tkl=211, dis=891, dise=1259)),
                     (["CB", "S"], "db", dict(sack=None, tfl=None, stop=None, hur=None, pd=944, int=2239, tkl=266, dis=3758, dise=3350))):
    if _k["sack"]:
        R(f"{_n}_sack", _pos, "dfn", "e_sack_all", "dplays", "Sacks", "Pass rush", "full" if _n == "dl" else "hatched", "per100",
          _k["sack"], "team def. plays", "dplays", "Sacks " + _D100 + ".", "sacks / team defensive plays x 100", SRC_BOTH,
          adj=("sacks", "db", "mult") if _n == "lb" else None,
          note="" if _n == "lb" else "Shown before opponent adjustment: for linemen the adjustment did not predict better.")
        R(f"{_n}_hur", _pos, "dfn", "b_hur", "dplays_box", "QB hurries", "Pass rush", "full" if _n == "dl" else "hatched", "per100",
          _k["hur"], "team def. plays", "dplays_box", "Quarterback hurries " + _D100 + ".", "hurries / team defensive plays x 100",
          SRC_BOX, start=2024, note="Hurries exist only in the box score, which is complete from 2024.")
        R(f"{_n}_tfl", _pos, "dfn", "e_tfl_all", "dplays", "Tackles for loss", "Run defense", "full", "per100", _k["tfl"],
          "team def. plays", "dplays", "Tackles for loss, sacks included, " + _D100 + ".",
          "tackles for loss / team defensive plays x 100", SRC_BOTH, adj=("tfl", "plays", "mult"))
        R(f"{_n}_stop", _pos, "dfn", "stop", "dplays", "Run stops", "Run defense", "full", "per100", _k["stop"], "team def. plays",
          "dplays", "Tackles on runs that failed to keep the offence on schedule, " + _D100 + ".",
          "tackles on unsuccessful runs / team defensive plays x 100", "ESPN play-by-play (the tackler named in the play text)")
    if _k["pd"]:
        R(f"{_n}_pd", _pos, "dfn", "e_pd", "dplays", "Passes defensed", "Coverage", "hatched", "per100", _k["pd"], "team def. plays",
          "dplays", "Pass break-ups plus interceptions " + _D100 + ".", "(break-ups + interceptions) / team defensive plays x 100",
          SRC_BOTH, adj=("pbu", "plays", "mult"), off=PBU_OFF,
          note="Not tracked 2021 to 2023: the play text stopped naming who broke up the pass and the box score did not yet list it.")
        R(f"{_n}_int", _pos, "dfn", "int", "dplays", "Interceptions", "Context", "context", "per100", _k["int"], "team def. plays",
          "dplays", "Interceptions " + _D100 + ". Mostly noise in one season: it is context.",
          "interceptions / team defensive plays x 100", SRC_BOX, note="Mostly noise in one season.")
    R(f"{_n}_disrupt", _pos, "dfn", "disrupt", "dplays", "Disruptive plays", "Disruption" if _n != "db" else "Context",
      "full" if _n != "db" else "context", "per100", _k["dis"], "team def. plays", "dplays",
      "Sacks, other tackles for loss, interceptions, pass break-ups and forced fumbles, " + _D100 + ".",
      "disruptive plays / team defensive plays x 100", SRC_BOTH, adj=("havoc", "plays", "mult"), off=PBU_OFF,
      note="Not tracked 2021 to 2023, when pass break-ups could not be credited.")
    R(f"{_n}_disrupt_epa", _pos, "dfn", "disr_pts", "dplays", "Disruption value", "Disruption" if _n != "db" else "Context",
      "hatched" if _n != "db" else "context", "per100", _k["dise"], "team def. plays", "dplays",
      "Points the offence lost on his disruptive plays and run stops, each play worth the season's average for its kind, " + _D100 + ".",
      "sum of (plays x league-average points lost on that kind of play) / team defensive plays x 100", SRC_BOTH,
      adj=("havoc", "plays", "mult"), off=PBU_OFF, note="Not tracked 2021 to 2023, when pass break-ups could not be credited.")
    R(f"{_n}_tkl", _pos, "dfn", "b_tkl", "dplays_box", "Tackles", "Context", "context", "per100", _k["tkl"], "team def. plays",
      "dplays_box", "Total tackles " + _D100 + ". How much, not how good.", "tackles / team defensive plays x 100", SRC_BOX,
      start=2024, note="Tackles come from the box score, which is complete from 2024.")
    R(f"{_n}_ff", _pos, "dfn", "ff", "dplays", "Forced fumbles", "Context", "context", "per100", 6000, "team def. plays", "dplays",
      "Forced fumbles " + _D100 + ". Noise in one season: it is context.", "forced fumbles / team defensive plays x 100",
      "ESPN play-by-play", off=FF_OFF, note="Not tracked 2021 to 2024: the play text under-reported who forced the fumble.")

# ---------------------------------------------------------------- specialists
R("k_fgoe", "K", "kick", "fgoe", "fga", "Field goals over expected", "Kicking", "context", "sgn2", 133, "attempts", "fga",
  "Field goals made above what an average FBS kicker makes from the same distances. Mostly noise in one season, so it is "
  "shown as context.", "(made - expected makes by distance) / attempts", note="Mostly noise in one season.")
R("k_fg_pct", "K", "kick", "made", "fga", "Field-goal rate", "Context", "context", "pct1", 133, "attempts", "fga",
  "Share of his field-goal attempts that were good.", "made / attempts", note="Mostly noise in one season.")
R("p_poe", "P", "punt", "poe", "punts", "Punt value over expected", "Punting", "context", "sgn2", 168, "punts", "punts",
  "Expected points each punt gains over an average punt from the same spot, return included.",
  "(EPA of the punt - expected EPA from that yard line) / punts")

# context every card carries, whatever the position
for _slot, _tab, _num, _den, _s in (("QB", "qb", "garb_db", "db_all", "db_all"), ("RB", "rush", "garb_rush", "rush_all", "rush_all"),
                                    ("WR", "rec", "garb_tgt", "tgt_all", "tgt_all"), ("TE", "rec", "garb_tgt", "tgt_all", "tgt_all")):
    R(f"{_tab if _slot not in ('WR', 'TE') else _slot.lower()}_garbage", _slot, _tab, _num, _den, "Garbage-time share", "Context",
      "context", "pct1", 50, "plays", _s,
      "Share of his plays that came in garbage time (a margin above 38 points in the second quarter, 28 in the third, 22 in "
      "the fourth). Those plays are left out of every bar unless you turn them on.", "garbage-time plays / all his plays")

for _i, _s in enumerate(STATS):
    if _s.key.split("_", 1)[1] in ("tfl", "stop", "disrupt", "disrupt_epa") and _s.table == "dfn":
        STATS[_i] = _s._replace(off=sorted(set(_s.off) | set(NO_TACKLERS)))

TEAM_STATS = [
    # key, label, group, verdict, unit, lower, what
    ("off_epa", "Offense EPA per play", "Efficiency", "full", "epa", False, "Expected points the offense adds per play."),
    ("def_epa", "Defense EPA per play allowed", "Efficiency", "hatched", "epa", True, "Expected points the defense allows per play."),
    ("off_sr", "Offense success rate", "Efficiency", "full", "pct1", False, "Share of offensive plays that stay on schedule."),
    ("def_sr", "Defense success rate allowed", "Efficiency", "full", "pct1", True, "Share of opponents' plays that stay on schedule."),
    ("off_epa_db", "Offense EPA per dropback", "Efficiency", "hatched", "epa", False, "Expected points per pass play."),
    ("def_epa_db", "Defense EPA per dropback allowed", "Efficiency", "hatched", "epa", True, "Expected points allowed per pass play."),
    ("off_epa_rush", "Offense EPA per rush", "Efficiency", "hatched", "epa", False, "Expected points per run."),
    ("def_epa_rush", "Defense EPA per rush allowed", "Efficiency", "hatched", "epa", True, "Expected points allowed per run."),
    ("off_pass_sr", "Offense passing success rate", "Efficiency", "full", "pct1", False, "Success rate on pass plays."),
    ("def_pass_sr", "Defense passing success rate allowed", "Efficiency", "hatched", "pct1", True, "Success rate allowed on pass plays."),
    ("off_rush_sr", "Offense rushing success rate", "Efficiency", "hatched", "pct1", False, "Success rate on runs."),
    ("def_rush_sr", "Defense rushing success rate allowed", "Efficiency", "hatched", "pct1", True, "Success rate allowed on runs."),
    ("off_expl_rate", "Offense explosive play rate", "Explosiveness", "hatched", "pct1", False, "Share of plays that are a run of 12+ or a pass of 16+ yards."),
    ("def_expl_rate", "Defense explosive play rate allowed", "Explosiveness", "hatched", "pct1", True, "Explosive plays allowed, as a share of plays."),
    ("off_expl", "Offense explosiveness", "Explosiveness", "context", "epa", False, "EPA per successful play. It takes 20 games to be half signal."),
    ("def_expl", "Defense explosiveness allowed", "Explosiveness", "context", "epa", True, "EPA allowed per successful play."),
    ("off_stuff", "Offense stuff rate", "Line", "hatched", "pct1", True, "Share of runs stopped for no gain or a loss."),
    ("def_stuff", "Defense stuff rate", "Line", "hatched", "pct1", False, "Share of opponents' runs stopped for no gain or a loss."),
    ("off_ly", "Offense line yards per rush", "Line", "hatched", "num2", False, "Rushing yards credited to the line: losses count 120%, 0 to 4 yards in full, 5 to 10 half, nothing beyond."),
    ("def_ly", "Defense line yards per rush allowed", "Line", "hatched", "num2", True, "Line yards allowed per run."),
    ("off_sack", "Offense sack rate allowed", "Line", "hatched", "pct1", True, "Sacks allowed per dropback."),
    ("def_sack", "Defense sack rate", "Line", "context", "pct1", False, "Sacks per opponent dropback. It takes 21 games to be half signal."),
    ("off_havoc", "Offense havoc rate allowed", "Line", "hatched", "pct1", True, "Tackles for loss, break-ups, interceptions and forced fumbles allowed, per play."),
    ("def_havoc", "Defense havoc rate", "Line", "context", "pct1", False, "Tackles for loss, break-ups, interceptions and forced fumbles, per play."),
    ("off_third", "Offense third-down rate", "Finishing drives", "hatched", "pct1", False, "Third downs converted."),
    ("def_third", "Defense third-down rate allowed", "Finishing drives", "context", "pct1", True, "Third downs allowed."),
    ("off_ppo", "Offense points per trip inside the 40", "Finishing drives", "context", "num2", False, "Points per drive that earned a first down inside the opponent's 40."),
    ("def_ppo", "Defense points per trip inside the 40 allowed", "Finishing drives", "context", "num2", True, "Points allowed per such drive."),
    ("off_rz", "Offense red-zone touchdown rate", "Finishing drives", "context", "pct1", False, "Touchdowns per drive that reached the 20."),
    ("def_rz", "Defense red-zone touchdown rate allowed", "Finishing drives", "context", "pct1", True, "Touchdowns allowed per drive that reached the 20."),
    ("off_fp", "Offense average starting field position", "Field position", "context", "num1", True, "Average yards to the end zone where drives begin."),
    ("def_fp", "Defense average starting field position faced", "Field position", "context", "num1", False, "Average yards opponents must go when their drives begin."),
    ("st_epa", "Net special-teams EPA per game", "Field position", "context", "sgn2", False, "Expected points gained on kicks, punts and returns, net of the opponent's."),
    ("pen_rate", "Penalties per play", "Discipline and pace", "hatched", "pct1", True, "Penalties per offensive play."),
    ("pen_yds", "Penalty yards per game", "Discipline and pace", "hatched", "num1", True, "Penalty yards per game."),
    ("pace", "Plays per game", "Discipline and pace", "context", "num1", False, "Offensive plays per game. How fast, not how good."),
    ("to_margin", "Turnover margin per game", "Turnovers", "luck", "sgn2", False, "Takeaways minus giveaways per game. It behaves like luck: 33 games to be half signal."),
    ("giveaways", "Giveaways per play", "Turnovers", "luck", "pct2", True, "Turnovers per offensive play."),
    ("takeaways", "Takeaways per play", "Turnovers", "luck", "pct2", False, "Turnovers forced per defensive play."),
    ("int_thrown", "Interceptions thrown per dropback", "Turnovers", "luck", "pct2", True, "Interceptions thrown per dropback."),
    ("int_made", "Interceptions made per opponent dropback", "Turnovers", "luck", "pct2", False, "Interceptions per opponent dropback."),
    ("fum_lost", "Fumbles lost per play", "Turnovers", "luck", "pct2", True, "Fumbles lost per offensive play."),
    ("fum_rec", "Fumble recovery rate", "Turnovers", "luck", "pct1", False, "Share of all fumbles in a team's games that it recovered. No signal at all: pure luck."),
]
TEAM_ADJ = {"off_epa", "def_epa", "off_sr", "def_sr", "off_epa_db", "def_epa_db", "off_epa_rush", "def_epa_rush", "off_pass_sr",
            "def_pass_sr", "off_rush_sr", "def_rush_sr", "off_expl_rate", "def_expl_rate", "off_stuff", "def_stuff", "off_ly",
            "def_ly", "off_sack", "def_sack"}

# the backtest's verdict table, as (BACKTEST label fragment -> registry key): the coverage check
VERDICT_ROWS = {
    "QB": {"EPA per dropback": "qb_epa_db", "Success rate on dropbacks": "qb_success", "Sack rate": "qb_sack_rate",
           "Interception rate": "qb_int_rate", "Yards per attempt": "qb_ypa", "Completion rate": "qb_cmp",
           "Explosive pass rate (16+ yards)": "qb_expl", "EPA per dropback, passing downs": "qb_pd_epa",
           "EPA per dropback, standard downs": "qb_sd_epa", "EPA per rush (scrambles and designed runs together)": "qb_rush_epa",
           "Rushing EPA per play he ran or threw": "qb_rush_value", "Total EPA per play (pass + rush)": "qb_total_epa"},
    "RB": {"EPA per rush": "rb_epa_rush", "Success rate": "rb_success", "Explosive run rate (12+ yards)": "rb_expl",
           "Stuff rate (no gain or a loss)": "rb_stuff", "Yards per rush": "rb_ypc",
           "Receiving EPA per team dropback": "rb_rec_value", "Share of team rushes": "rb_share"},
    "WR": {"EPA per target (games where targets are named)": "wr_epa_tgt", "Catch rate (games where targets are named)": "wr_catch",
           "Target share (games where targets are named)": "wr_tgt_share", "Explosive catch rate (16+ yards)": "wr_expl",
           "Yards per catch": "wr_ypr", "Yards per team pass attempt": "wr_yptpa", "Receiving EPA per team dropback": "wr_epa_tdb",
           "Catches per team pass attempt": "wr_rec_share"},
    "TE": {"EPA per target (games where targets are named)": "te_epa_tgt", "Catch rate (games where targets are named)": "te_catch",
           "Target share (games where targets are named)": "te_tgt_share", "Explosive catch rate (16+ yards)": "te_expl",
           "Yards per catch": "te_ypr", "Yards per team pass attempt": "te_yptpa", "Receiving EPA per team dropback": "te_epa_tdb",
           "Catches per team pass attempt": "te_rec_share"},
    "DL": {"Sacks per 100 team defensive plays": "dl_sack", "Tackles for loss incl. sacks, from plays, per 100": "dl_tfl",
           "Run stops per 100 (tackle on a failed run)": "dl_stop", "Tackles for loss, box score, per 100": "dl_tfl",
           "QB hurries, box score, per 100": "dl_hur", "Forced fumbles per 100": "dl_ff", "Tackles, box score, per 100": "dl_tkl",
           "Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble)": "dl_disrupt",
           "Disruption EPA per 100 (points the offence lost on his plays)": "dl_disrupt_epa"},
    "LB": {"Sacks per 100 team defensive plays": "lb_sack", "Tackles for loss incl. sacks, from plays, per 100": "lb_tfl",
           "Run stops per 100 (tackle on a failed run)": "lb_stop", "Tackles for loss, box score, per 100": "lb_tfl",
           "QB hurries, box score, per 100": "lb_hur", "Interceptions per 100": "lb_int",
           "Passes defensed (break-ups + interceptions), plays, per 100": "lb_pd", "Passes defensed, box score, per 100": "lb_pd",
           "Forced fumbles per 100": "lb_ff", "Tackles, box score, per 100": "lb_tkl",
           "Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble)": "lb_disrupt",
           "Disruption EPA per 100 (points the offence lost on his plays)": "lb_disrupt_epa"},
    "DB": {"Interceptions per 100": "db_int", "Passes defensed (break-ups + interceptions), plays, per 100": "db_pd",
           "Passes defensed, box score, per 100": "db_pd", "Forced fumbles per 100": "db_ff", "Tackles, box score, per 100": "db_tkl",
           "Disruptive plays per 100 (sack, TFL, INT, break-up, forced fumble)": "db_disrupt",
           "Disruption EPA per 100 (points the offence lost on his plays)": "db_disrupt_epa"},
    "K": {"Field goals made over expected, per attempt": "k_fgoe"},
    "P": {"Punt EPA over expected, per punt": "p_poe"},
}
# what the page shows for each backtest verdict (RESEARCH section 4, with BUILD decision 3 on top)
ALLOWED = {"full bar": {"full"}, "hatched": {"hatched", "context"}, "CONTEXT": {"context"}, "dropped": {"context"}, "luck": {"luck"}}


def by_key():
    return {s.key: s for s in STATS}


def for_slot(slot):
    return [s for s in STATS if slot in s.pos]


def check():
    """Every row of BACKTEST.md's player verdict table has a registry stat, shown no more strongly than its verdict."""
    import re
    from .paths import REPO
    txt = (REPO / "research" / "cfb" / "BACKTEST.md").read_text()
    bk = by_key()
    sec, rows, bad = None, 0, []
    for line in txt.splitlines():
        m = re.match(r"\*\*(QB|RB|WR|TE|DL|LB|DB|K|P)\*\*$", line.strip())
        if m:
            sec = m.group(1)
            continue
        if line.startswith("### ") or line.startswith("**What stands out"):
            sec = None
        if sec and line.startswith("| ") and not line.startswith("| stat") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            label, verdict = cells[0], cells[-1]
            rows += 1
            key = VERDICT_ROWS.get(sec, {}).get(label)
            if key is None or key not in bk:
                bad.append(f"{sec}: '{label}' has no registry stat")
            elif bk[key].verdict not in ALLOWED[verdict]:
                bad.append(f"{sec}: '{label}' is '{verdict}' in the backtest but '{bk[key].verdict}' in the registry")
    teams = {t[0] for t in TEAM_STATS}
    assert len(teams) == len(TEAM_STATS)
    keys = [s.key for s in STATS]
    assert len(keys) == len(set(keys)), "duplicate stat key"
    for s in STATS:
        assert s.what and s.formula and s.source and s.label and s.group in GROUPS, s.key
        assert s.verdict in ("full", "hatched", "context"), s.key
    print(f"registry: {len(STATS)} player stats, {len(TEAM_STATS)} team stats; verdict-table rows checked: {rows}; problems: {len(bad)}")
    for b in bad:
        print("  !!", b)
    return not bad and rows >= 60


if __name__ == "__main__":
    raise SystemExit(0 if check() else 1)
