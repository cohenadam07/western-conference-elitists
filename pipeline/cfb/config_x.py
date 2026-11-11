"""1.1.0: the stat expansion's registry (research/cfb/EXPANSION.md, built by research/cfb/BUILD-1.1.md).

config.py imports this and appends to STATS and TEAM_STATS. Everything a 1.0.0 stat carries, plus:
  tier     "A" (every season the data has), "B" (the charted layer, 2025 week 9 on) or "1.0" (shipped in 1.0.0)
  cgroup   the card group, Football Savant style (BUILD-1.1 section 4)

Verdicts and settle points are not typed here. `python -m pipeline.cfb.xstudy` measures them (BUILD-1.1 section 3)
and writes pipeline/cfb/state/verdicts_x.json, which this file reads; until it has run every new stat is CONTEXT.
"""
import json
from pathlib import Path

TIER_B_START = 2025
TIER_B_NOTE = "Tracked from 2025 week 9, when ESPN's play text became fully charted; settle points will firm up as seasons accumulate."
PRE_BOX = "Before 2024 it depends on how fully each school's stat crew logged tackles, so it is not comparable across schools."
NO_TGT = "Before 2025 most games do not name the target of an incompletion."
PEN_NOTE = "ESPN names the penalized player on about half of accepted penalties; the rest are the team's, not his."
VFILE = Path(__file__).resolve().parent / "state" / "verdicts_x.json"
VERDICTS = json.loads(VFILE.read_text()) if VFILE.exists() else {}

# the card's groups per position (BUILD-1.1 section 4)
CARD_GROUPS = {
    "QB": ["Context", "Passing: Efficiency", "Passing: Pressure", "Passing: Shot selection", "Passing: By depth", "Passing: Formation and tempo",
           "Passing: Situational", "Passing: Drives", "Passing: Schedule", "Rushing", "Value"],
    "RB": ["Context", "Rushing: Efficiency", "Where the yards come from", "Rushing: Direction", "Rushing: Situational", "Receiving", "Value"],
    "WR": ["Context", "Opportunity", "Efficiency", "By depth", "After the catch", "Situational", "Value"],
    "TE": ["Context", "Opportunity", "Efficiency", "By depth", "After the catch", "Situational", "Value"],
    "D": ["Context", "Pass rush", "Run defense", "Credited coverage", "Turnovers", "Discipline", "Value"],
    "K": ["Context", "Field goals", "Kickoffs", "Value"],
    "P": ["Context", "Punting", "Placement", "Value"],
    "RET": ["Returns", "Fair catches and muffs"],
}
# each position's five headline stats: the profile score is their mean percentile (Football Savant's)
HEADLINE = {
    "QB": ["qb_total_epa", "qb_epa_db", "qb_success", "qb_anya", "qb_sack_rate"],
    "RB": ["rb_epa_rush", "rb_success", "rb_opp_rate", "rb_hly_opp", "rb_expl"],
    "WR": ["wr_yptpa", "wr_epa_tdb", "wr_fd_tgt", "wr_ypr", "wr_expl"],
    "TE": ["te_yptpa", "te_epa_tdb", "te_fd_tgt", "te_ypr", "te_rec_share"],
    "D": ["{p}_disrupt", "{p}_disrupt_epa", "{p}_tfl", "{p}_sack", "{p}_stop"],
    "DB": ["db_pd", "db_disrupt", "db_tkl", "db_int", "db_frec"],
    "K": ["k_fgoe", "k_fg_pct", "k_long_rate", "k_ko_tb", "k_ko_epa"],
    "P": ["p_poe", "p_in20", "p_tb", "p_ret_allowed"],
    "RET": ["ret_epa", "ret_kyds", "ret_pyds", "ret_20", "ret_fc"],
}

# 1.0.0 stats: their card group on the new card
CGROUP_1 = {
    "qb_epa_db": "Passing: Efficiency", "qb_success": "Passing: Efficiency", "qb_sack_rate": "Passing: Pressure", "qb_ypa": "Passing: Efficiency",
    "qb_cmp": "Passing: Efficiency", "qb_expl": "Passing: Efficiency", "qb_total_epa": "Value", "qb_pd_epa": "Passing: Situational",
    "qb_sd_epa": "Passing: Situational", "qb_rush_epa": "Rushing", "qb_rush_value": "Rushing", "qb_int_rate": "Passing: Efficiency",
    "qb_cpoe": "Passing: Shot selection", "qb_usage": "Context",
    "rb_epa_rush": "Rushing: Efficiency", "rb_success": "Rushing: Efficiency", "rb_expl": "Where the yards come from", "rb_stuff": "Rushing: Efficiency",
    "rb_ypc": "Rushing: Efficiency", "rb_rec_value": "Receiving", "rb_share": "Context",
    "k_fgoe": "Field goals", "k_fg_pct": "Field goals", "p_poe": "Punting",
}
for _n in ("wr", "te"):
    CGROUP_1.update({f"{_n}_yptpa": "Efficiency", f"{_n}_epa_tdb": "Efficiency", f"{_n}_ypr": "Efficiency", f"{_n}_expl": "Efficiency",
                     f"{_n}_rec_share": "Opportunity", f"{_n}_tgt_share": "Opportunity", f"{_n}_catch": "Efficiency", f"{_n}_epa_tgt": "Efficiency",
                     f"{_n}_garbage": "Context"})
for _n in ("dl", "lb", "db"):
    CGROUP_1.update({f"{_n}_sack": "Pass rush", f"{_n}_hur": "Pass rush", f"{_n}_tfl": "Run defense", f"{_n}_stop": "Run defense",
                     f"{_n}_pd": "Credited coverage", f"{_n}_int": "Turnovers", f"{_n}_disrupt": "Value", f"{_n}_disrupt_epa": "Value",
                     f"{_n}_tkl": "Run defense", f"{_n}_ff": "Turnovers"})
CGROUP_1.update({"qb_garbage": "Context", "rush_garbage": "Context"})

NEW = []            # (key, pos, table, num, den, label, cgroup, tier, unit, unit_n, sample, what, formula, extra)


def X(key, pos, table, num, den, label, cgroup, tier, unit, unit_n, sample, what, formula, **extra):
    NEW.append((key, pos if isinstance(pos, list) else [pos], table, num, den, label, cgroup, tier, unit, unit_n, sample, what, formula, extra))


B = dict(start=TIER_B_START, note=TIER_B_NOTE, source="ESPN's charted play text (2025 week 9 on), valued by WCE's expected-points model")
CH = "in charted games"

# ================================================================ quarterbacks
X("qb_rating", "QB", "qb", "pr_num", "att", "Passer efficiency rating", "Passing: Efficiency", "A", "num1", "attempts", "att",
  "College football's own passer rating: yards, touchdowns, completions and interceptions per attempt, on the NCAA's scale.",
  "(8.4 x yards + 330 x TD + 100 x completions - 200 x INT) / attempts")
X("qb_anya", "QB", "qb", "anya_num", "db", "Adjusted net yards per attempt", "Passing: Efficiency", "A", "num2", "dropbacks", "db",
  "ANY/A: passing yards with a 20-yard bonus per touchdown and a 45-yard charge per interception, sacks and their yards included.",
  "(yards + 20 x TD - 45 x INT - sack yards) / (attempts + sacks)")
X("qb_td_rate", "QB", "qb", "td", "att", "Touchdown rate", "Passing: Efficiency", "A", "pct1", "attempts", "att",
  "Touchdown passes per attempt.", "passing TDs / attempts")
X("qb_fd_rate", "QB", "qb", "fd", "db", "First-down rate", "Passing: Efficiency", "A", "pct1", "dropbacks", "db",
  "Share of his dropbacks that gain a first down or score.", "dropbacks that move the chains or score / dropbacks")
X("qb_third", "QB", "qb", "third_fd", "third_db", "Third- and fourth-down conversion", "Passing: Situational", "A", "pct1", "dropbacks", "third_db",
  "Share of his third- and fourth-down dropbacks that move the chains.", "third/fourth-down dropbacks converted / such dropbacks")
X("qb_rz_td", "QB", "qb", "rz_td", "rz_db", "Red-zone touchdown rate", "Passing: Situational", "A", "pct1", "dropbacks", "rz_db",
  "Touchdown passes per dropback from the opponent's 20 in.", "red-zone TD passes / red-zone dropbacks")
X("qb_short", "QB", "qb", "all_short_fd", "all_short", "Short-yardage conversion", "Passing: Situational", "A", "pct1", "plays", "all_short",
  "Third or fourth and 2 or less, or the 2 or closer: how often his throws and runs there convert.",
  "converted short-yardage dropbacks and runs / such plays")
X("qb_twomin", "QB", "qb", "tm_epa", "tm_db", "Two-minute drill EPA", "Passing: Situational", "A", "epa", "dropbacks", "tm_db",
  "EPA per dropback in the last two minutes of either half.", "EPA on two-minute dropbacks / those dropbacks")
X("qb_doubt", "QB", "qb", "dbt_epa", "dbt_db", "EPA when the game is in doubt", "Passing: Situational", "A", "epa", "dropbacks", "dbt_db",
  "EPA per dropback while his team's win probability is between 20% and 80%.", "EPA on those dropbacks / those dropbacks")
X("qb_mid8", "QB", "qb", "m8_epa", "m8_db", "Middle-8 EPA", "Passing: Situational", "A", "epa", "dropbacks", "m8_db",
  "EPA per dropback in the last four minutes of the first half and the first four of the second (Connelly's middle 8).",
  "EPA on middle-8 dropbacks / those dropbacks")
X("qb_d_pts", "QB", "qb", "d_pts", "drives", "Points per drive", "Passing: Drives", "A", "num2", "drives", "drives",
  "Points his team scored per drive he quarterbacked (touchdowns count 7).", "points on his drives / his drives")
X("qb_d_td", "QB", "qb", "d_td", "drives", "Touchdown-drive rate", "Passing: Drives", "A", "pct1", "drives", "drives",
  "Share of his drives that end in a touchdown.", "touchdown drives / drives")
X("qb_d_3out", "QB", "qb", "d_3out", "drives", "Three-and-out rate", "Passing: Drives", "A", "pct1", "drives", "drives",
  "Share of his drives that are three plays or fewer, no first down, and a punt.", "three-and-outs / drives", lower=True)
X("qb_tot_epa", "QB", "qb", "tot_epa", "one", "Total EPA", "Value", "A", "tot", "season", "tot_plays",
  "Expected points he added over the season, throwing and running.", "sum of EPA on his dropbacks and runs")
X("qb_wpa", "QB", "qb", "tot_wpa", "one", "Win probability added", "Value", "A", "wpa", "season", "tot_plays",
  "Wins he added over the season, from the change in his team's win probability on each of his plays (1.00 is one win).",
  "sum of win probability added on his dropbacks and runs")
X("qb_tdoe", "QB", "qb", "tdoe", "one", "Touchdowns over expected", "Value", "A", "tot", "season", "tot_plays",
  "Touchdowns he threw or ran for, less what an average FBS player scores from the same snaps (WCE's model: where the snap was, the down "
  "and the distance; fitted on 2014-2024, calibrated on 2025).", "(passing TDs + rushing TDs) - expected TDs on his dropbacks and runs")
X("qb_rush_fd", "QB", "qb", "q_fd", "q_rush", "First-down rate on runs", "Rushing", "A", "pct1", "rushes", "q_rush",
  "Share of his runs that move the chains or score.", "runs gaining a first down or TD / runs")
X("qb_fum", "QB", "qb", "fum_all", "touch", "Fumble rate", "Rushing", "A", "pct1", "plays", "touch",
  "Fumbles per dropback or run, lost or not.", "his fumbles / (dropbacks + runs)", lower=True)
X("qb_sneak", "QB", "qb", "q_short_fd", "q_short", "Short-yardage run conversion", "Rushing", "A", "pct1", "rushes", "q_short",
  "Sneaks and other short-yardage runs: how often they convert.", "short-yardage runs converted / such runs")
X("qb_proe", "QB", "qb", "t_proe", "t_neutral", "Team pass rate over expected", "Context", "A", "sgn1", "team plays", "t_neutral",
  "How much more (or less) his team passed than an average FBS team in the same neutral spots, in games he played. WCE's model; "
  "centred on the season's FBS average.", "(passes - expected passes) / neutral plays, his games")
X("qb_pen", "QB", "qb", "pens", "t_plays", "Penalties", "Context", "A", "per100", "team plays", "t_plays",
  "Penalties ESPN charges to him, per 100 team plays in games he played.", "his accepted penalties / team plays x 100", lower=True,
  start=2014, note=PEN_NOTE)
# Tier B quarterbacks
X("qb_adot", "QB", "qb", "c_air0", "c_airok", "Average depth of target", "Passing: Shot selection", "B", "num1", "attempts", "c_airok",
  "How far downfield his throws travel, from the line of scrimmage to where the ball was caught or thrown to.", "air yards / charted attempts", **B)
X("qb_deep_rate", "QB", "qb", "c_deep", "c_airok", "Deep-throw rate", "Passing: Shot selection", "B", "pct1", "attempts", "c_airok",
  "Share of his throws the stat crew charted as deep.", "deep attempts / charted attempts", **B)
X("qb_behind", "QB", "qb", "c_behind", "c_airok", "Behind-the-line throw rate", "Passing: Shot selection", "B", "pct1", "attempts", "c_airok",
  "Share of his throws caught or thrown behind the line of scrimmage: college's screen stand-in (screens are not tagged).",
  "attempts with negative air yards / charted attempts", **B)
for _s, _n in (("tl", "left"), ("tm", "middle"), ("tr", "right")):
    X(f"qb_dir_{_s[1]}", "QB", "qb", f"c_{_s}", "c_airok", f"Throws to the {_n}", "Passing: Shot selection", "B", "pct1", "attempts", "c_airok",
      f"Share of his charted throws to the {_n} of the field.", f"{_n} attempts / charted attempts", **B)
for _b, _lab in (("b0", "behind the line"), ("b1", "0-9 air yards"), ("b2", "10-19 air yards"), ("b3", "20+ air yards")):
    X(f"qb_{_b}_cmp", "QB", "qb", f"c_{_b}_cmp", f"c_{_b}_att", f"Completion rate, {_lab}", "Passing: By depth", "B", "pct1", "attempts",
      f"c_{_b}_att", f"Completion rate on throws {_lab}.", f"completions / attempts {_lab}", **B)
    X(f"qb_{_b}_ypa", "QB", "qb", f"c_{_b}_yds", f"c_{_b}_att", f"Yards per attempt, {_lab}", "Passing: By depth", "B", "num1", "attempts",
      f"c_{_b}_att", f"Passing yards per attempt on throws {_lab}.", f"yards / attempts {_lab}", **B)
X("qb_cair", "QB", "qb", "c_cair", "c_airok", "Completed air yards per attempt", "Passing: Shot selection", "B", "num2", "attempts", "c_airok",
  "Air yards on his completions, per attempt: how much of his production he throws rather than his receivers run.",
  "air yards on completions / charted attempts", **B)
X("qb_yac_share", "QB", "qb", "c_yac0", "c_cyds", "YAC share", "Passing: Shot selection", "B", "pct1", "yards", "c_cyds",
  "Share of his passing yards gained after the catch.", "yards after the catch / passing yards, charted completions", **B)
X("qb_press_rate", "QB", "qb", "c_press", "c_db", "Pressure rate faced", "Passing: Pressure", "B", "pct1", "dropbacks", "c_db",
  "Hurries plus sacks per dropback: college's pressure stand-in. Credited hurries only; true pressure is not tracked.",
  "(hurried dropbacks + sacks) / charted dropbacks", lower=True, **B)
X("qb_p2s", "QB", "qb", "c_sack", "c_press", "Pressure-to-sack rate", "Passing: Pressure", "B", "pct1", "pressures", "c_press",
  "Share of the pressures he faced that became sacks.", "sacks / pressures", lower=True, **B)
X("qb_press_epa", "QB", "qb", "c_press_epa", "c_press", "EPA per dropback when pressured", "Passing: Pressure", "B", "epa", "dropbacks", "c_press",
  "EPA per dropback on which he was hurried or sacked.", "EPA on pressured dropbacks / those dropbacks", **B)
X("qb_clean_epa", "QB", "qb", "c_clean_epa", "c_clean", "EPA per dropback when clean", "Passing: Pressure", "B", "epa", "dropbacks", "c_clean",
  "EPA per dropback with no credited hurry or sack.", "EPA on clean dropbacks / those dropbacks", **B)
X("qb_shotgun", "QB", "qb", "c_shot_db", "c_db", "Shotgun rate", "Passing: Formation and tempo", "B", "pct1", "dropbacks", "c_db",
  "Share of his dropbacks from the shotgun (the rest are under center).", "shotgun dropbacks / charted dropbacks", **B)
X("qb_shot_epa", "QB", "qb", "c_shot_db_epa", "c_shot_db", "EPA per dropback, shotgun", "Passing: Formation and tempo", "B", "epa", "dropbacks",
  "c_shot_db", "EPA per dropback from the shotgun.", "EPA / shotgun dropbacks", **B)
X("qb_uc_epa", "QB", "qb", "c_uc_db_epa", "c_uc_db", "EPA per dropback, under center", "Passing: Formation and tempo", "B", "epa", "dropbacks",
  "c_uc_db", "EPA per dropback from under center.", "EPA / under-center dropbacks", **B)
X("qb_nohuddle", "QB", "qb", "c_nh", "c_db", "No-huddle rate", "Passing: Formation and tempo", "B", "pct1", "dropbacks", "c_db",
  "Share of his dropbacks the stat crew charted as no-huddle.", "no-huddle dropbacks / charted dropbacks", **B)
X("qb_nh_epa", "QB", "qb", "c_nh_epa2", "c_nh", "EPA per dropback, no-huddle", "Passing: Formation and tempo", "B", "epa", "dropbacks", "c_nh",
  "EPA per no-huddle dropback.", "EPA / no-huddle dropbacks", **B)

# ================================================================ running backs
X("rb_ly", "RB", "rush", "ly", "rush", "Line yards per carry", "Where the yards come from", "A", "num2", "rushes", "rush",
  "The yards his blockers are credited with: losses count 120%, the first 4 yards in full, yards 5 to 10 at half, nothing beyond.",
  "line yards / carries")
X("rb_slv", "RB", "rush", "slv", "rush", "Second-level yards per carry", "Where the yards come from", "A", "num2", "rushes", "rush",
  "Yards gained 5 to 10 yards past the line, per carry.", "yards 5-10 of each run / carries")
X("rb_ofy", "RB", "rush", "ofy", "rush", "Open-field yards per carry", "Where the yards come from", "A", "num2", "rushes", "rush",
  "Yards gained more than 10 yards past the line, per carry.", "yards beyond 10 of each run / carries")
X("rb_opp_rate", "RB", "rush", "opp4", "rush", "Opportunity rate", "Where the yards come from", "A", "pct1", "rushes", "rush",
  "Share of his carries that reach 4 yards: the line did its job.", "runs of 4+ yards / carries")
X("rb_hly_opp", "RB", "rush", "hly", "opp4", "Highlight yards per opportunity", "Where the yards come from", "A", "num2", "opportunities", "opp4",
  "Once the line has given him 4 yards, what he adds: the yards the line is not credited with, per opportunity.",
  "(yards - line yards) on runs of 4+ / such runs")
X("rb_fd", "RB", "rush", "fd", "rush", "First-down rate", "Rushing: Efficiency", "A", "pct1", "rushes", "rush",
  "Share of his carries that move the chains or score.", "carries gaining a first down or TD / carries")
X("rb_power", "RB", "rush", "short_fd", "short", "Power success", "Rushing: Situational", "A", "pct1", "rushes", "short",
  "Third or fourth and 2 or less, or the 2 or closer: how often his carry converts.", "short-yardage carries converted / such carries")
X("rb_rz_share", "RB", "rush", "rz", "t_rz_rush", "Red-zone carry share", "Rushing: Situational", "A", "pct1", "team rushes", "t_rz_rush",
  "Share of his team's carries inside the opponent's 20, in games he played.", "his red-zone carries / team red-zone carries")
X("rb_gl_share", "RB", "rush", "gl", "t_gl_rush", "Goal-line carry share", "Rushing: Situational", "A", "pct1", "team rushes", "t_gl_rush",
  "Share of his team's carries inside the 5, in games he played.", "his carries inside the 5 / team carries inside the 5")
X("rb_tdoe", "RB", "rush", "tdoe", "one", "Touchdowns over expected", "Value", "A", "tot", "season", "rush",
  "Touchdowns he scored rushing and receiving, less what an average FBS player scores from the same carries and catches.",
  "(rushing + receiving TDs) - expected TDs")
X("rb_wpa", "RB", "rush", "tot_wpa", "one", "Win probability added", "Value", "A", "wpa", "season", "rush",
  "Wins he added over the season, rushing and receiving (1.00 is one win).", "sum of win probability added on his carries and targets")
X("rb_fum", "RB", "rush", "fum_own", "touch", "Fumble rate", "Rushing: Efficiency", "A", "pct1", "touches", "touch",
  "Fumbles per carry or catch, lost or not.", "his fumbles / (carries + catches)", lower=True)
X("rb_tgt_g", "RB", "rush", "r_tgt", "g1", "Targets per game", "Receiving", "A", "num1", "games", "g1",
  "Passes thrown to him per game played (un-named incompletions shared out by catches, as for receivers).", "targets / games")
X("rb_rec_yptpa", "RB", "rush", "r_yards", "t_att", "Receiving yards per team pass attempt", "Receiving", "A", "num2", "team attempts", "t_att",
  "Receiving yards for every pass his team threw in games he played: the yards-per-route stand-in.", "receiving yards / team pass attempts")
X("rb_pen", "RB", "rush", "pens", "t_plays", "Penalties", "Context", "A", "per100", "team plays", "t_plays",
  "Penalties ESPN charges to him, per 100 team plays in games he played.", "his accepted penalties / team plays x 100", lower=True, start=2014,
  note=PEN_NOTE)
for _s, _n in (("l", "left"), ("m", "middle"), ("r", "right")):
    X(f"rb_dir_{_s}", "RB", "rush", f"c_r{_s}", "c_rush", f"Runs to the {_n}", "Rushing: Direction", "B", "pct1", "rushes", "c_rush",
      f"Share of his charted carries to the {_n}.", f"{_n} carries / charted carries", **B)
    X(f"rb_succ_{_s}", "RB", "rush", f"c_r{_s}_succ", f"c_r{_s}", f"Success rate, {_n}", "Rushing: Direction", "B", "pct1", "rushes", f"c_r{_s}",
      f"Success rate on his carries to the {_n}.", f"successful {_n} carries / {_n} carries", **B)
X("rb_shot_epa", "RB", "rush", "c_shot_rush_epa", "c_shot_rush", "EPA per rush, shotgun", "Rushing: Efficiency", "B", "epa", "rushes", "c_shot_rush",
  "EPA per carry with the quarterback in the shotgun.", "EPA / shotgun carries", **B)
X("rb_uc_epa", "RB", "rush", "c_uc_rush_epa", "c_uc_rush", "EPA per rush, under center", "Rushing: Efficiency", "B", "epa", "rushes", "c_uc_rush",
  "EPA per carry with the quarterback under center.", "EPA / under-center carries", **B)
X("rb_adot", "RB", "rush", "r_c_air0", "r_c_airok", "Average depth of target", "Receiving", "B", "num1", "targets", "r_c_airok",
  "How far downfield passes to him travel.", "air yards / charted targets", **B)
X("rb_yac", "RB", "rush", "r_c_yac0", "r_c_yacok", "YAC per catch", "Receiving", "B", "num1", "catches", "r_c_yacok",
  "Yards after the catch per reception.", "yards after the catch / charted catches", **B)

# ================================================================ receivers and tight ends
for _p, _n in (("WR", "wr"), ("TE", "te")):
    X(f"{_n}_fd_tgt", _p, "rec", "fd", "tgt_eff", "First downs per target", "Efficiency", "A", "pct1", "targets", "tgt_eff",
      "Share of the passes thrown to him that move the chains or score.", "catches gaining a first down or TD / targets")
    X(f"{_n}_rz_share", _p, "rec", "rz_tgt_t", "t_rz_att_t", "Red-zone target share", "Situational", "A", "pct1", "team attempts", "t_rz_att_t",
      "Share of his team's passes inside the opponent's 20 thrown to him, in games that name every target.",
      "red-zone targets / team red-zone attempts", start=2025, note=NO_TGT)
    X(f"{_n}_third_share", _p, "rec", "third_tgt_t", "t_third_att_t", "Third-down target share", "Situational", "A", "pct1", "team attempts",
      "t_third_att_t", "Share of his team's third- and fourth-down passes thrown to him: the go-to target.",
      "third/fourth-down targets / team third/fourth-down attempts", start=2025, note=NO_TGT)
    X(f"{_n}_tdoe", _p, "rec", "tdoe", "one", "Touchdowns over expected", "Value", "A", "tot", "season", "tgt_eff",
      "Touchdown catches less what an average FBS target from the same snaps scores.", "receiving TDs - expected TDs on his targets")
    X(f"{_n}_wpa", _p, "rec", "wpa_eff", "one", "Win probability added", "Value", "A", "wpa", "season", "tgt_eff",
      "Wins he added over the season on passes thrown to him (1.00 is one win).", "sum of win probability added on his targets")
    X(f"{_n}_pen", _p, "rec", "pens", "t_plays", "Penalties", "Context", "A", "per100", "team plays", "t_plays",
      "Penalties ESPN charges to him, per 100 team plays in games he played.", "his accepted penalties / team plays x 100", lower=True,
      start=2014, note=PEN_NOTE)
    X(f"{_n}_adot", _p, "rec", "c_air0", "c_airok", "Average depth of target", "Opportunity", "B", "num1", "targets", "c_airok",
      "How far downfield passes to him travel.", "air yards / charted targets", **B)
    X(f"{_n}_air_share", _p, "rec", "c_air0", "t_c_air", "Air-yards share", "Opportunity", "B", "pct1", "team air yards", "t_c_air",
      "Share of his team's air yards thrown his way, in games he played.", "his air yards / team air yards", **B)
    X(f"{_n}_wopr", _p, "rec", "wopr_num", "t_c_att", "Opportunity score (WOPR)", "Opportunity", "B", "num2", "team attempts", "t_c_att",
      "Target share x 1.5 plus air-yards share x 0.7: the fantasy world's weighted opportunity rating.",
      "1.5 x target share + 0.7 x air-yards share, game by game weighted by team attempts", **B)
    X(f"{_n}_deep_share", _p, "rec", "c_dp_tgt", "c_airok", "Deep-target share", "Opportunity", "B", "pct1", "targets", "c_airok",
      "Share of his targets charted as deep.", "deep targets / charted targets", **B)
    X(f"{_n}_ez_share", _p, "rec", "c_ez", "t_c_ez", "End-zone target share", "Situational", "B", "pct1", "team attempts", "t_c_ez",
      "Share of his team's throws into the end zone aimed at him.", "his end-zone targets / team end-zone throws",
      **dict(B, note=TIER_B_NOTE + " An end-zone target needs the spot it was thrown to, which only the charted text gives."))
    X(f"{_n}_yac", _p, "rec", "c_yac0", "c_yacok", "YAC per reception", "After the catch", "B", "num1", "catches", "c_yacok",
      "Yards after the catch per reception.", "yards after the catch / charted catches", **B)
    X(f"{_n}_yacoe", _p, "rec", "c_yacoe", "c_yacoe_n", "YAC over expected", "After the catch", "B", "num2", "catches", "c_yacoe_n",
      "Yards after the catch per reception above what WCE's model expects from the air yards, direction, depth and down.",
      "(YAC - expected YAC) / charted catches", **B)
    X(f"{_n}_catch_short", _p, "rec", "c_sh_cmp", "c_sh_tgt", "Catch rate, short", "By depth", "B", "pct1", "targets", "c_sh_tgt",
      "Share of his short targets caught.", "short catches / short targets", **B)
    X(f"{_n}_catch_deep", _p, "rec", "c_dp_cmp", "c_dp_tgt", "Catch rate, deep", "By depth", "B", "pct1", "targets", "c_dp_tgt",
      "Share of his deep targets caught.", "deep catches / deep targets", **B)
    X(f"{_n}_epa_short", _p, "rec", "c_sh_epa", "c_sh_tgt", "EPA per target, short", "By depth", "B", "epa", "targets", "c_sh_tgt",
      "EPA per short target.", "EPA on short targets / short targets", **B)
    X(f"{_n}_epa_deep", _p, "rec", "c_dp_epa", "c_dp_tgt", "EPA per target, deep", "By depth", "B", "epa", "targets", "c_dp_tgt",
      "EPA per deep target.", "EPA on deep targets / deep targets", **B)
    for _s, _d in (("tl", "left"), ("tm", "middle"), ("tr", "right")):
        X(f"{_n}_dir_{_s[1]}", _p, "rec", f"c_{_s}", "c_airok", f"Targets to the {_d}", "Opportunity", "B", "pct1", "targets", "c_airok",
          f"Share of his charted targets to the {_d}: where he wins.", f"{_d} targets / charted targets", **B)

# ================================================================ defenders
_D100 = "per 100 team defensive plays"
for _pos, _n in ((["EDGE", "IDL"], "dl"), (["LB"], "lb"), (["CB", "S"], "db")):
    X(f"{_n}_solo", _pos, "dfn", "e_solo", "dplays", "Solo tackles", "Run defense", "A", "per100", "team def. plays", "dplays",
      "Tackles he made alone, " + _D100 + ".", "solo tackles / team defensive plays x 100", start=2014,
      source="ESPN box score from 2024; ESPN play participants before that", note=PRE_BOX)
    X(f"{_n}_asst", _pos, "dfn", "e_asst", "dplays", "Assisted tackles", "Run defense", "A", "per100", "team def. plays", "dplays",
      "Tackles he shared, " + _D100 + ".", "assisted tackles / team defensive plays x 100", start=2014,
      source="ESPN box score from 2024; ESPN play participants before that", note=PRE_BOX)
    X(f"{_n}_tfl_run", _pos, "dfn", "tfl_run", "dplays", "Tackles for loss on runs", "Run defense", "A", "per100", "team def. plays", "dplays",
      "Tackles behind the line on running plays, " + _D100 + ".", "run TFLs / team defensive plays x 100", start=2014,
      source="ESPN play participants (the tackler named)", note=PRE_BOX)
    X(f"{_n}_tfl_pass", _pos, "dfn", "e_tfl_pass", "dplays", "Tackles for loss on passes", "Pass rush", "A", "per100", "team def. plays", "dplays",
      "Sacks plus tackles behind the line on completed passes, " + _D100 + ".", "(sacks + pass TFLs) / team defensive plays x 100",
      start=2014, source="ESPN box score from 2024; ESPN play-by-play before that", note=PRE_BOX)
    X(f"{_n}_frec", _pos, "dfn", "frec", "dplays", "Fumble recoveries", "Turnovers", "A", "per100", "team def. plays", "dplays",
      "Fumbles he recovered, " + _D100 + ".", "fumble recoveries / team defensive plays x 100", source="ESPN box score")
    X(f"{_n}_int_yds", _pos, "dfn", "b_int_yds", "int", "Interception return yards", "Turnovers", "A", "num1", "interceptions", "int",
      "Return yards per interception.", "interception return yards / interceptions", source="ESPN box score")
    X(f"{_n}_int_epa", _pos, "dfn", "neg_int_epa", "one", "Interception value", "Turnovers", "A", "tot", "season", "dplays",
      "Expected points his interceptions took from the offence, over the season.", "minus the EPA of his interceptions")
    X(f"{_n}_pen", _pos, "dfn", "pens", "dplays", "Penalties", "Discipline", "A", "per100", "team def. plays", "dplays",
      "Penalties ESPN charges to him, " + _D100 + ".", "his accepted penalties / team defensive plays x 100", lower=True, start=2014, note=PEN_NOTE)
    X(f"{_n}_havoc", _pos, "dfn", "disrupt", "dhavoc", "Havoc share", "Value", "A", "pct1", "team havoc plays", "dhavoc",
      "His share of his team's havoc plays (tackles for loss, sacks, interceptions, break-ups, forced fumbles).",
      "his disruptive plays / team havoc plays", start=2014, off=[2021, 2022, 2023], source="ESPN box score from 2024; ESPN play-by-play before that",
      note="Not tracked 2021 to 2023, when break-ups could not be credited. " + PRE_BOX)
    if _n != "db":
        X(f"{_n}_sack_epa", _pos, "dfn", "neg_sack_epa", "sack", "EPA per sack", "Pass rush", "A", "epa", "sacks", "sack",
          "Expected points the offence lost on each of his sacks.", "minus the EPA of his sacks / sacks")
        X(f"{_n}_sack_yds", _pos, "dfn", "neg_sack_yds", "sack", "Yards lost per sack", "Pass rush", "A", "num1", "sacks", "sack",
          "Yards the quarterback lost on each of his sacks.", "minus sack yards / sacks")
        X(f"{_n}_sack3", _pos, "dfn", "sack3", "d3db", "Third-down sack rate", "Pass rush", "A", "per100", "opp. 3rd-down dropbacks", "d3db",
          "Sacks on third and fourth down per 100 opponent dropbacks on those downs.", "third/fourth-down sacks / opponent dropbacks x 100")
        X(f"{_n}_strip", _pos, "dfn", "strip", "dplays", "Strip sacks", "Pass rush", "A", "per100", "team def. plays", "dplays",
          "Sacks on which he also forced the fumble, " + _D100 + ".", "strip sacks / team defensive plays x 100", off=[2021, 2022, 2023, 2024, 2025, 2026],
          note="Tracked only while the play text named who forced a fumble (to 2020).")
        X(f"{_n}_hur_g", _pos, "dfn", "chur", "cg", "Hurries per game", "Pass rush", "B", "num2", "games", "cg",
          "Quarterback hurries the charted text credits him with, per team game.", "hurries / charted team games", **B)
        X(f"{_n}_hur_db", _pos, "dfn", "chur", "ddb_c", "Hurries per opponent dropback", "Pass rush", "B", "per100", "opp. dropbacks", "ddb_c",
          "Hurries per 100 opponent dropbacks.", "hurries / opponent dropbacks x 100", **B)
        X(f"{_n}_press_g", _pos, "dfn", "cpress", "cg", "Pressures per game", "Pass rush", "B", "num2", "games", "cg",
          "Hurries plus sacks per team game.", "(hurries + sacks) / charted team games", **B)
        X(f"{_n}_press_db", _pos, "dfn", "cpress", "ddb_c", "Pressures per opponent dropback", "Pass rush", "B", "per100", "opp. dropbacks", "ddb_c",
          "Hurries plus sacks per 100 opponent dropbacks.", "(hurries + sacks) / opponent dropbacks x 100", **B)
        X(f"{_n}_press_share", _pos, "dfn", "cpress", "dpress_c", "Share of team pressures", "Pass rush", "B", "pct1", "team pressures", "dpress_c",
          "His share of the pressures his defence generated.", "his pressures / team pressured dropbacks", **B)
        X(f"{_n}_p2s", _pos, "dfn", "csack", "cpress", "Pressure-to-sack rate", "Pass rush", "B", "pct1", "pressures", "cpress",
          "Share of his pressures that became sacks.", "sacks / (hurries + sacks)", **B)
    X(f"{_n}_tk_depth", _pos, "dfn", "ctk_yds", "ctk", "Average depth of tackle", "Run defense", "B", "num1", "tackles", "ctk",
      "Where the play ended on his tackles, in yards from the line of scrimmage (lower is better).", "sum of gains on plays he tackled / tackles",
      lower=True, **B)
    X(f"{_n}_rstop_rate", _pos, "dfn", "c_rstop", "c_rtk", "Run-stop rate", "Run defense", "B", "pct1", "run tackles", "c_rtk",
      "Share of his tackles on runs that left the offence off schedule.", "tackles on unsuccessful runs / tackles on runs", **B)
    X(f"{_n}_pbu_db", _pos, "dfn", "cpbu", "ddb_c", "Break-ups per opponent dropback", "Credited coverage", "B", "per100", "opp. dropbacks", "ddb_c",
      "Passes he broke up per 100 opponent dropbacks.", "break-ups / opponent dropbacks x 100", **B)
    X(f"{_n}_cov_air", _pos, "dfn", "cov_air", "cov_n", "Air yards on credited throws", "Credited coverage", "B", "num1", "throws", "cov_n",
      "Average air yards of the throws on which he is the named break-up or tackler: credited coverage. It still cannot see the corner who "
      "was never thrown at.", "air yards / throws he is credited on", **B)
    X(f"{_n}_cov_epa", _pos, "dfn", "cov_epa", "cov_n", "EPA on credited throws", "Credited coverage", "B", "epa", "throws", "cov_n",
      "EPA the offence gained on throws where he is the named break-up or tackler (lower is better).", "EPA / throws he is credited on",
      lower=True, **B)

# ================================================================ specialists and returners
X("k_long_rate", "K", "kick", "l_made", "l_att", "Long field-goal rate", "Field goals", "A", "pct1", "attempts", "l_att",
  "Share of his tries from 50 yards or more that were good.", "made 50+ / attempts 50+")
X("k_ko_tb", "K", "kick", "ko_tb", "kos", "Kickoff touchback rate", "Kickoffs", "A", "pct1", "kickoffs", "kos",
  "Share of his kickoffs (onside kicks left out) that became touchbacks.", "touchbacks / kickoffs")
X("k_ko_epa", "K", "kick", "ko_epa", "ko_epa_n", "Kickoff EPA", "Kickoffs", "A", "epa", "kickoffs", "ko_epa_n",
  "Expected points his kickoffs gained for the kicking side, return included.", "kicking side's EPA / kickoffs")
X("p_in20", "P", "punt", "bp_in20", "bp_punts", "Inside-20 rate", "Placement", "A", "pct1", "punts", "bp_punts",
  "Share of his punts downed or fielded inside the opponent's 20.", "punts inside the 20 / punts", source="ESPN box score")
X("p_tb", "P", "punt", "bp_tb", "bp_punts", "Touchback rate", "Placement", "A", "pct1", "punts", "bp_punts",
  "Share of his punts that went for a touchback.", "touchbacks / punts", lower=True, source="ESPN box score")
X("p_ret_allowed", "P", "punt", "p_ret_yds", "p_n", "Return yards allowed per punt", "Punting", "A", "num1", "punts", "p_n",
  "Return yards on his punts, per punt.", "punt return yards / punts", lower=True)
_R = "returns"
X("ret_epa", "RET", "ret", "ret_above", "ret_n", "Return EPA over average", "Returns", "A", "epa", "returns", "ret_n",
  "Expected points per return above the season's average kick or punt return.", "(return EPA - average for its kind) / returns")
X("ret_kyds", "RET", "ret", "kret_yds", "kret", "Yards per kick return", "Returns", "A", "num1", "returns", "kret",
  "Yards per kickoff return.", "kick return yards / kick returns", source="ESPN box score")
X("ret_pyds", "RET", "ret", "pret_yds", "pret", "Yards per punt return", "Returns", "A", "num1", "returns", "pret",
  "Yards per punt return.", "punt return yards / punt returns", source="ESPN box score")
X("ret_20", "RET", "ret", "ret20", "pbp_returns", "20-yard return rate", "Returns", "A", "pct1", "returns", "pbp_returns",
  "Share of his returns that gained 20 yards or more.", "returns of 20+ / returns, where the play text describes the return",
  note="Rates come from the returns the play text describes; some seasons' text omits a few (counts and yards are the box score's).")
X("ret_td", "RET", "ret", "ret_td", "one", "Return touchdowns", "Returns", "A", "tot0", "season", "returns",
  "Kick and punt returns he took all the way.", "return touchdowns", source="ESPN box score")
X("ret_fc", "RET", "ret", "pfc", "pchances", "Fair-catch rate", "Fair catches and muffs", "A", "pct1", "punts fielded", "pchances",
  "Share of the punts he handled that he fair caught.", "fair catches / (punt returns + fair catches)")
X("ret_muff", "RET", "ret", "muff", "muff_opp", "Muff rate", "Fair catches and muffs", "B", "pct1", "chances", "muff_opp",
  "Kicks and punts he muffed, per kick he handled.", "muffs / kicks and punts handled", lower=True,
  **dict(B, note=TIER_B_NOTE + " Earlier text rarely says a ball was muffed."))

# ================================================================ team stats (key, label, group, tier, unit, lower, what, num, den, side)
TEAM_X = [
    ("sec_play", "Seconds per play", "Pace and identity", "A", "num1", True, "Seconds from one snap to the next, outside the two-minute drill.", "pace_s", "pace_n", "o"),
    ("proe", "Pass rate over expected", "Pace and identity", "A", "sgn1", False, "How much more than an average FBS team it passed in the same neutral spots (WCE's model, centred on the season).", "proe_n", "neutral_x", "o"),
    ("early_pass", "Early-down pass rate", "Pace and identity", "A", "pct1", False, "Share of neutral first and second downs it passed.", "early_db", "early_n", "o"),
    ("off_d_pts", "Offense points per drive", "Drives", "A", "num2", False, "Points per drive (touchdowns count 7).", "d_pts", "d_n", "o"),
    ("def_d_pts", "Defense points per drive allowed", "Drives", "A", "num2", True, "Points allowed per opponent drive.", "d_pts", "d_n", "d"),
    ("off_d_td", "Offense touchdown-drive rate", "Drives", "A", "pct1", False, "Share of drives ending in a touchdown.", "d_td", "d_n", "o"),
    ("def_d_td", "Defense touchdown-drive rate allowed", "Drives", "A", "pct1", True, "Share of opponent drives ending in a touchdown.", "d_td", "d_n", "d"),
    ("off_3out", "Offense three-and-out rate", "Drives", "A", "pct1", True, "Share of drives that are three-and-outs.", "d_3out", "d_n", "o"),
    ("def_3out", "Defense three-and-outs forced", "Drives", "A", "pct1", False, "Share of opponent drives that are three-and-outs.", "d_3out", "d_n", "d"),
    ("off_expl_pass", "Offense explosive pass rate", "Explosiveness", "A", "pct1", False, "Share of dropbacks gaining 16 yards or more.", "expl_pass", "db", "o"),
    ("def_expl_pass", "Defense explosive passes allowed", "Explosiveness", "A", "pct1", True, "Share of opponent dropbacks gaining 16+.", "expl_pass", "db", "d"),
    ("off_expl_rush", "Offense explosive run rate", "Explosiveness", "A", "pct1", False, "Share of runs gaining 12 yards or more.", "expl_rush", "rush", "o"),
    ("def_expl_rush", "Defense explosive runs allowed", "Explosiveness", "A", "pct1", True, "Share of opponent runs gaining 12+.", "expl_rush", "rush", "d"),
    ("off_twomin", "Offense two-minute EPA", "Situational", "A", "epa", False, "EPA per play in the last two minutes of either half.", "tm_epa", "tm_n", "o"),
    ("def_twomin", "Defense two-minute EPA allowed", "Situational", "A", "epa", True, "EPA per play allowed in the last two minutes of either half.", "tm_epa", "tm_n", "d"),
    ("off_mid8", "Offense middle-8 EPA", "Situational", "A", "epa", False, "EPA per play in the last four minutes of the first half and the first four of the second.", "m8_epa", "m8_n", "o"),
    ("def_mid8", "Defense middle-8 EPA allowed", "Situational", "A", "epa", True, "EPA per play allowed in the middle 8.", "m8_epa", "m8_n", "d"),
    ("st_ko", "Kickoff EPA per game", "Special teams by phase", "A", "sgn2", False, "Expected points its kickoffs gained, per game.", "ko_epa", "g", "o"),
    ("st_kr", "Kick return EPA per game", "Special teams by phase", "A", "sgn2", False, "Expected points its kick returns gained, per game.", "kr_epa", "g", "o"),
    ("st_pu", "Punt EPA per game", "Special teams by phase", "A", "sgn2", False, "Expected points its punts gained, per game.", "pu_epa", "g", "o"),
    ("st_pr", "Punt return EPA per game", "Special teams by phase", "A", "sgn2", False, "Expected points its punt returns gained, per game.", "pr_epa", "g", "o"),
    ("st_fg", "Field-goal EPA per game", "Special teams by phase", "A", "sgn2", False, "Expected points its field-goal tries gained, per game.", "fg_epa", "g", "o"),
    ("fd4_goe", "Fourth-down go rate over expected", "Decisions", "A", "sgn1", False, "How much more often than an average FBS coach it went for it on fourth down in the same spots (WCE's model).", "fd4_goe_n", "fd4_n", "o"),
    ("fd4_follow", "Fourth downs that follow the recommendation", "Decisions", "A", "pct1", False, "Share of its fourth downs where it did what WCE's fourth-down model recommends.", "fd4_follow", "fd4_n", "o"),
    ("fd4_eplost", "Expected points given up on fourth downs, per game", "Decisions", "A", "num2", True, "Expected points its fourth-down choices left on the field against the recommendation, per game.", "fd4_eplost", "g", "o"),
    ("two_rate", "Two-point try rate", "Decisions", "A", "pct1", False, "Share of its tries after touchdowns that went for two.", "two_att", "two_n", "o"),
    ("two_conv", "Two-point conversion rate", "Decisions", "A", "pct1", False, "Share of its two-point tries that converted.", "two_good", "two_att", "o"),
    ("to_g", "Timeouts per game", "Decisions", "A", "num2", False, "Timeouts charged per game (where the text names the team).", "to_n", "g", "o"),
    ("to_late", "Late-half timeout share", "Decisions", "A", "pct1", False, "Share of its timeouts called in the last two minutes of a half.", "to_late", "to_n", "o"),
    # Tier B
    ("off_press", "Offense pressure rate allowed", "Offensive line", "B", "pct1", True, "Hurries plus sacks per dropback, charted games.", "c_press", "c_db", "o"),
    ("def_press", "Defense pressure rate", "Pass rush and coverage", "B", "pct1", False, "Hurries plus sacks per opponent dropback, charted games.", "c_press", "c_db", "d"),
    ("off_hur", "Offense hurry rate allowed", "Offensive line", "B", "pct1", True, "Credited hurries per dropback, charted games.", "c_hur", "c_db", "o"),
    ("off_adot", "Offense average depth of target", "Pace and identity", "B", "num1", False, "Air yards per charted attempt.", "c_air0", "c_airok", "o"),
    ("def_adot", "Defense average depth of target allowed", "Pass rush and coverage", "B", "num1", False, "Air yards per opponent charted attempt.", "c_air0", "c_airok", "d"),
    ("def_yac", "Defense YAC per catch allowed", "Pass rush and coverage", "B", "num1", True, "Yards after the catch per opponent completion.", "c_yac0", "c_yacok", "d"),
    ("def_deep", "Defense deep-throw rate allowed", "Pass rush and coverage", "B", "pct1", True, "Share of opponent throws charted as deep.", "c_deep", "c_airok", "d"),
    ("shotgun", "Shotgun rate", "Pace and identity", "B", "pct1", False, "Share of its charted plays from the shotgun.", "c_shotgun", "c_ok", "o"),
    ("nohuddle", "No-huddle rate", "Pace and identity", "B", "pct1", False, "Share of its charted plays run without a huddle.", "c_nh", "c_ok", "o"),
    ("shot_epa", "EPA per play, shotgun", "Pace and identity", "B", "epa", False, "EPA per play from the shotgun.", "c_shotgun_epa", "c_shotgun", "o"),
    ("uc_epa", "EPA per play, under center", "Pace and identity", "B", "epa", False, "EPA per play from under center.", "c_uc_epa", "c_uc", "o"),
]
for _s, _d in (("l", "left"), ("m", "middle"), ("r", "right")):
    TEAM_X += [
        (f"ol_succ_{_s}", f"Run success, {_d}", "Offensive line", "B", "pct1", False, f"Success rate on runs to the {_d}, charted games.", f"c_r{_s}_succ", f"c_r{_s}", "o"),
        (f"ol_ly_{_s}", f"Line yards, {_d}", "Offensive line", "B", "num2", False, f"Line yards per run to the {_d}.", f"c_r{_s}_ly", f"c_r{_s}", "o"),
        (f"ol_stuff_{_s}", f"Stuff rate, {_d}", "Offensive line", "B", "pct1", True, f"Share of runs to the {_d} stopped for no gain or a loss.", f"c_r{_s}_stuff", f"c_r{_s}", "o"),
        (f"def_run_{_s}", f"Defense EPA per run allowed, {_d}", "Run defense", "B", "epa", True, f"EPA per opponent run to its {_d} (the offence's {_d}).", f"c_r{_s}_epa", f"c_r{_s}", "d"),
    ]
# what the defence allows to each position (opponent-adjusted, computed from the player frames in site.py)
TEAM_POS = [("def_qb", "QB EPA per dropback allowed", "QB", "epa"), ("def_rb", "RB EPA per rush allowed", "RB", "epa"),
            ("def_wr", "WR EPA per target allowed", "WR", "epa"), ("def_te", "TE EPA per target allowed", "TE", "epa")]

# ================================================================ the catalog, item by item (registry check)
# every bullet of research/cfb/EXPANSION.md: the stats that carry it, or ("C", reason) / ("cut", reason)
CATALOG = {
    "QB passer rating": ["qb_rating"], "QB ANY/A": ["qb_anya"], "QB TD rate": ["qb_td_rate"], "QB first-down rate": ["qb_fd_rate"],
    "QB third/fourth-down conversion": ["qb_third"], "QB red-zone TD rate": ["qb_rz_td"], "QB short-yardage conversion": ["qb_short"],
    "QB two-minute EPA": ["qb_twomin"], "QB EPA in doubt": ["qb_doubt"], "QB middle-8 EPA": ["qb_mid8"],
    "QB points per drive": ["qb_d_pts"], "QB TD-drive rate": ["qb_d_td"], "QB three-and-out rate": ["qb_d_3out"],
    "QB total EPA": ["qb_tot_epa"], "QB WPA": ["qb_wpa"], "QB TDs over expected": ["qb_tdoe"], "QB rushing first-down rate": ["qb_rush_fd"],
    "QB fumble rate": ["qb_fum"], "QB sneak and short-yardage": ["qb_sneak"], "QB pass rate over expected (context)": ["qb_proe"],
    "RB line yards": ["rb_ly"], "RB second-level yards": ["rb_slv"], "RB open-field yards": ["rb_ofy"], "RB highlight yards per opportunity": ["rb_hly_opp"],
    "RB opportunity rate": ["rb_opp_rate"], "RB power success": ["rb_power"], "RB red-zone carry share": ["rb_rz_share"],
    "RB goal-line carry share": ["rb_gl_share"], "RB TDs over expected": ["rb_tdoe"], "RB first-down rate": ["rb_fd"], "RB fumble rate": ["rb_fum"],
    "RB targets per game": ["rb_tgt_g"], "RB yards per route proxy": ["rb_rec_yptpa"], "RB YAC": ["rb_yac"],
    "WR/TE first-down rate per target": ["wr_fd_tgt", "te_fd_tgt"], "WR/TE red-zone target share": ["wr_rz_share", "te_rz_share"],
    "WR/TE end-zone target share": ["wr_ez_share", "te_ez_share"], "WR/TE TDs over expected": ["wr_tdoe", "te_tdoe"],
    "WR/TE third-down target share": ["wr_third_share", "te_third_share"], "WR/TE WPA": ["wr_wpa", "te_wpa"],
    "DEF solo vs assisted": ["dl_solo", "dl_asst", "lb_solo", "lb_asst", "db_solo", "db_asst"],
    "DEF TFL run/pass": ["dl_tfl_run", "dl_tfl_pass", "lb_tfl_run", "lb_tfl_pass", "db_tfl_run", "db_tfl_pass"],
    "DEF EPA per sack": ["dl_sack_epa", "lb_sack_epa"], "DEF yards lost per sack": ["dl_sack_yds", "lb_sack_yds"],
    "DEF third-down sacks": ["dl_sack3", "lb_sack3"], "DEF strip sacks": ["dl_strip", "lb_strip"],
    "DEF INT return yards and EPA": ["dl_int_yds", "lb_int_yds", "db_int_yds", "dl_int_epa", "lb_int_epa", "db_int_epa"],
    "DEF fumble recoveries": ["dl_frec", "lb_frec", "db_frec"], "DEF penalties per game": ["dl_pen", "lb_pen", "db_pen"],
    "DEF havoc share": ["dl_havoc", "lb_havoc", "db_havoc"],
    "RET return EPA": ["ret_epa"], "RET yards per return": ["ret_kyds", "ret_pyds"], "RET 20+ rate": ["ret_20"], "RET TDs": ["ret_td"],
    "RET fair-catch rate": ["ret_fc"], "RET muffs": ["ret_muff"], "K FG over expected": ["k_fgoe"], "K long-range FG rate": ["k_long_rate"],
    "K kickoff touchback rate": ["k_ko_tb"], "K kickoff EPA": ["k_ko_epa"], "P net EPA": ["p_poe"], "P inside-20 rate": ["p_in20"],
    "P touchback rate": ["p_tb"], "P return yards allowed": ["p_ret_allowed"], "All-purpose / returner slot": ["RET pool"],
    "Everyone: per-player penalties": ["qb_pen", "rb_pen", "wr_pen", "te_pen", "dl_pen", "lb_pen", "db_pen"],
    "Everyone: career trajectory": ["page: career trajectory"], "Everyone: production vs recruiting rank": ["feature: production vs pedigree"],
    "Everyone: transfer before/after": ["feature: transfer impact"],
    "Team pace": ["pace", "sec_play"], "Team pass rate over expected": ["proe"], "Team early-down pass rate": ["early_pass"],
    "Team drive stats": ["off_d_pts", "off_d_td", "off_3out", "def_d_pts", "def_d_td", "def_3out"], "Team points per scoring opportunity": ["off_ppo"],
    "Team explosive rate by type": ["off_expl_pass", "off_expl_rush"], "Team allowed by position": ["def_qb", "def_rb", "def_wr", "def_te"],
    "Team explosives allowed": ["def_expl_pass", "def_expl_rush", "def_expl_rate"], "Team line yards and stuff allowed": ["def_ly", "def_stuff"],
    "Team havoc": ["def_havoc"], "Team fourth-down go rate over expected": ["fd4_goe", "fd4_follow", "fd4_eplost"],
    "Team two-point decisions": ["two_rate", "two_conv"], "Team timeout use": ["to_g", "to_late"],
    "Team special teams by phase": ["st_ko", "st_kr", "st_pu", "st_pr", "st_fg"],
    "Team situational": ["off_rz", "off_third", "off_twomin", "off_mid8", "off_fp", "to_margin"],
    "QB aDOT": ["qb_adot"], "QB deep-throw rate": ["qb_deep_rate"], "QB behind-the-line rate": ["qb_behind"],
    "QB direction mix": ["qb_dir_l", "qb_dir_m", "qb_dir_r"],
    "QB by depth": ["qb_b0_cmp", "qb_b0_ypa", "qb_b1_cmp", "qb_b1_ypa", "qb_b2_cmp", "qb_b2_ypa", "qb_b3_cmp", "qb_b3_ypa"],
    "QB real CPOE": ["qb_cpoe"], "QB YAC share and completed air yards": ["qb_yac_share", "qb_cair"],
    "QB pressure": ["qb_press_rate", "qb_p2s", "qb_press_epa", "qb_clean_epa"],
    "QB formation and tempo": ["qb_shotgun", "qb_shot_epa", "qb_uc_epa", "qb_nohuddle", "qb_nh_epa"],
    "RB run direction mix and success": ["rb_dir_l", "rb_dir_m", "rb_dir_r", "rb_succ_l", "rb_succ_m", "rb_succ_r"],
    "RB shotgun vs under center": ["rb_shot_epa", "rb_uc_epa"], "RB receiving aDOT": ["rb_adot"],
    "WR/TE aDOT and air-yards share": ["wr_adot", "wr_air_share", "te_adot", "te_air_share"], "WR/TE WOPR": ["wr_wopr", "te_wopr"],
    "WR/TE YAC and YACOE": ["wr_yac", "wr_yacoe", "te_yac", "te_yacoe"], "WR/TE deep-target share": ["wr_deep_share", "te_deep_share"],
    "WR/TE by depth": ["wr_catch_short", "wr_catch_deep", "wr_epa_short", "wr_epa_deep", "te_catch_short", "te_catch_deep", "te_epa_short", "te_epa_deep"],
    "WR/TE direction mix": ["wr_dir_l", "wr_dir_m", "wr_dir_r", "te_dir_l", "te_dir_m", "te_dir_r"],
    "DEF hurries and pressures": ["dl_hur_g", "dl_hur_db", "dl_press_g", "dl_press_db", "lb_hur_g", "lb_hur_db", "lb_press_g", "lb_press_db"],
    "DEF share of team pressures and pressure-to-sack": ["dl_press_share", "dl_p2s", "lb_press_share", "lb_p2s"],
    "DEF depth of tackle and run-stop rate": ["dl_tk_depth", "dl_rstop_rate", "lb_tk_depth", "lb_rstop_rate", "db_tk_depth", "db_rstop_rate"],
    "DEF credited coverage": ["db_pbu_db", "db_cov_air", "db_cov_epa", "lb_pbu_db", "lb_cov_air", "lb_cov_epa"],
    "OL hurry and sack rate allowed": ["off_hur", "off_press", "off_sack"],
    "OL run by direction": ["ol_succ_l", "ol_succ_m", "ol_succ_r", "ol_ly_l", "ol_ly_m", "ol_ly_r", "ol_stuff_l", "ol_stuff_m", "ol_stuff_r"],
    "OL shotgun vs under center": ["shot_epa", "uc_epa"],
    "Team pressure generated and allowed": ["def_press", "off_press"], "Team aDOT, YAC and deep allowed": ["def_adot", "def_yac", "def_deep"],
    "Team run defense by direction": ["def_run_l", "def_run_m", "def_run_r"], "Team formation and tempo identity": ["shotgun", "nohuddle", "off_adot"],
    # Tier C: not possible with free college data (EXPANSION.md), shown in each position's "what the page can't see"
    "time to throw": ("C", "no free source times the snap or the throw"),
    "true pressure": ("C", "only hurries the stat crew credits are in the text"),
    "play-action, RPO, screen tags": ("C", "the text does not tag them; the behind-the-line rate is the screen stand-in"),
    "man vs zone, blitz": ("C", "no coverage or blitz charting in any free source"),
    "drops, on-target throws": ("C", "the text does not chart ball placement or drops"),
    "routes run, yards per route run": ("C", "no participation data; yards per team pass attempt stands in"),
    "snap counts and snap share": ("C", "no free source lists who was on the field"),
    "missed tackles": ("C", "the text names tacklers, never the men who missed"),
    "targets allowed in coverage": ("C", "the text names the target, never the man covering him"),
    "on/off splits": ("C", "no participation data"),
    "PFF-style grades": ("C", "proprietary charting"),
    "scrambles vs designed runs": ("C", "the text rarely says which"),
}
TIER_C = {k: v[1] for k, v in CATALOG.items() if isinstance(v, tuple)}
# "what the page can't see", per position
CANT_SEE = {
    "QB": ["time to throw", "true pressure", "play-action, RPO, screen tags", "drops, on-target throws", "scrambles vs designed runs", "snap counts and snap share"],
    "RB": ["snap counts and snap share", "routes run, yards per route run", "missed tackles", "scrambles vs designed runs"],
    "WR": ["routes run, yards per route run", "drops, on-target throws", "snap counts and snap share", "on/off splits"],
    "TE": ["routes run, yards per route run", "drops, on-target throws", "snap counts and snap share", "on/off splits"],
    "OL": ["true pressure", "snap counts and snap share", "PFF-style grades"],
    "D": ["true pressure", "man vs zone, blitz", "missed tackles", "targets allowed in coverage", "snap counts and snap share", "PFF-style grades"],
    "K": ["snap counts and snap share"], "P": ["snap counts and snap share"],
}
