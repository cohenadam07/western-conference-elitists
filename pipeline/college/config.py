"""
config.py — every stat on College Basketball Savant, in one registry.

One row per stat: key, label, group, kind, unit, direction, settle key, start season, and its
explainer (what, formula, source, sample). build.py writes it to public/cbb/registry.json, and the
page, the connector and the check all read that one file. A stat missing here does not exist.

kind:    skill     a percentile bar; higher is better after `lower` is applied
         context   same bars, labelled CONTEXT: colour reads as volume, not quality
unit:    pct1      a percentage, one decimal
         per       stored per possession, shown per 70 or per 100
         num1/num2 plain numbers
         sgn1      signed
lower:   True when a lower number is better. The percentile is flipped and the row says so.
adj:     True when the stat has an opponent-adjusted value (decided by the transfer test, adjust.py)
family:  box / pbp / court. Which games it needs; decides "not tracked".
"""
from collections import namedtuple

FIRST_SEASON = "2022-23"
SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
CURRENT = "2026-27"
VERSION = "1.0.0"
LINE_ERA = "2019-20"           # the three-point line moved to 22 ft 1.75 in
QUAL_MIN_SHARE = 0.30          # share of team minutes to enter the pools
MIN_POOL = 20                  # no pool under this; the page widens it and says so

ESPN = "ESPN box scores"
PBP = "ESPN play-by-play, rebuilt by WCE"
LIN = "Lineups rebuilt by WCE from ESPN substitutions (2025 on) and CollegeBasketballData on-floor data (2023-24 to Feb 2025)"
LOC = "Shot locations from ESPN (2025 on) and CollegeBasketballData (earlier)"

S = namedtuple("S", "key label group kind unit lower settle n family start what formula source sample")
S.__new__.__defaults__ = (None,)


def R(key, label, group, kind, unit, what, formula, source, sample="", lower=False, settle=None, n=None, family="box", start=FIRST_SEASON):
    return S(key, label, group, kind, unit, lower, settle or key, n, family, start, what, formula, source, sample)


PER = "per possession, shown per 70 or per 100"
STATS = [
    # ---------------------------------------------------------------- Impact
    R("rapm", "RAPM", "Impact", "skill", "sgn1", "Points per 100 possessions the player adds, on both ends, once the nine others on the floor are accounted for. The model's view, not a verdict.",
      "Ridge regression on every clean stint, pooled over up to four seasons, with box impact as the prior", LIN, "Shown above 500 on-court possessions in the pool; low sample below.", family="court", start="2023-24", settle=None, n="rapm_n"),
    R("rapm_o", "Offensive RAPM", "Impact", "skill", "sgn1", "The offensive half of RAPM: what the offense does per 100 with the player on the floor, others accounted for.",
      "The offense terms of the RAPM regression", LIN, "As RAPM.", family="court", start="2023-24", n="rapm_n"),
    R("rapm_d", "Defensive RAPM", "Impact", "skill", "sgn1", "The defensive half of RAPM. Positive means the defense is better with the player.",
      "The defense terms of the RAPM regression", LIN, "As RAPM.", family="court", start="2023-24", n="rapm_n"),
    R("bi", "Box impact", "Impact", "skill", "sgn1", "What the box line says RAPM should be. It is RAPM's prior, and the best read on a player with few possessions.",
      "Regression of pooled RAPM on per-possession points, assists, turnovers, rebounds, steals, blocks, fouls and shot mix", f"{ESPN}; fitted to {LIN}", "Reads every game.", n="poss"),
    R("onoff", "On/off", "Impact", "skill", "sgn1", "Team net rating with the player on the floor minus off. Raw: it does not know who else was out there.",
      "Net per 100 on - net per 100 off", LIN, "Clean-lineup games only.", family="court", start="2023-24", n="on_poss"),
    R("onoff_luck", "Luck-adjusted on/off", "Impact", "skill", "sgn1", "On/off with opponents' threes and free throws set to what they normally make: a cold shooting night by the other team does not count for the player.",
      "On/off, with opponent 3P% and FT% replaced by league averages", LIN, "Clean-lineup games only.", family="court", start="2023-24", n="on_poss"),
    # ---------------------------------------------------------------- Scoring
    R("pts", "Points", "Scoring", "skill", "per", "Points scored, per 70 possessions (about one college game) or per 100.", "Points ÷ the player's possessions", ESPN, PER, n="poss"),
    R("ts", "True shooting %", "Scoring", "skill", "pct1", "Scoring efficiency with threes and free throws counted at their worth.", "Points ÷ 2(FGA + 0.475 FTA). College's free-throw factor is 0.475", ESPN, "Settles over shooting chances.", n="n_tsa"),
    R("efg", "Effective FG%", "Scoring", "skill", "pct1", "Field-goal percentage with a three worth one and a half twos.", "(FGM + 0.5 3PM) ÷ FGA", ESPN, "", n="n_fga"),
    R("fg2", "2-point FG%", "Scoring", "skill", "pct1", "Accuracy inside the arc.", "2PM ÷ 2PA", ESPN, "", n="n_fg2a"),
    R("uast70", "Unassisted makes", "Scoring", "skill", "per", "Baskets made with nobody credited for setting them up: self-created scoring.", "Unassisted FGM ÷ possessions", PBP, PER, family="pbp", settle="pts", n="poss"),
    # ---------------------------------------------------------------- Shooting
    R("fg3", "3-point %", "Shooting", "skill", "pct1", "Accuracy from three. College 3P% barely repeats, so below the settle point the bar is hatched and the diamond shows where the player is likely to settle.", "3PM ÷ 3PA", ESPN, "The prior comes from FT% and how often the player shoots threes.", n="n_fg3a"),
    R("ft", "Free-throw %", "Shooting", "skill", "pct1", "Accuracy at the line, the best single clue to a player's shooting touch.", "FTM ÷ FTA", ESPN, "", n="n_fta"),
    R("rim_fg", "At the rim", "Shooting", "skill", "pct1", "FG% on dunks, layups, tips and shots inside 4 feet.", "Rim makes ÷ rim attempts", f"{PBP}. {LOC}", "Scorekeepers differ on what a layup is: medium trust.", family="pbp", n="n_rim"),
    R("pnt_fg", "In the paint", "Shooting", "skill", "pct1", "FG% on non-rim shots in the lane.", "Paint makes ÷ paint attempts", f"{PBP}. {LOC}", "Scorekeepers differ here: medium trust.", family="pbp", n="n_pnt"),
    R("mid_fg", "Mid-range", "Shooting", "skill", "pct1", "FG% on twos outside the lane.", "Mid-range makes ÷ attempts", f"{PBP}. {LOC}", "Scorekeepers differ here: medium trust.", family="pbp", n="n_mid"),
    R("c3_fg", "Corner 3", "Shooting", "skill", "pct1", "3P% from the corners.", "Corner 3PM ÷ 3PA", f"{PBP}. {LOC}", "", family="pbp", n="n_c3"),
    R("ab3_fg", "Above the break 3", "Shooting", "skill", "pct1", "3P% from above the break.", "Above-break 3PM ÷ 3PA", f"{PBP}. {LOC}", "", family="pbp", n="n_ab3"),
    R("shotmk", "Shot-making", "Shooting", "skill", "sgn1", "How much better a player's eFG% is than the eFG% an average D1 shooter would post on the same shots. The model's view, not a verdict.",
      "eFG% - xeFG%. xFG reads distance, angle, shot type, putback, transition, home or road and the arena", LOC, "Needs shot locations.", family="pbp", settle="efg", n="n_loc"),
    # ---------------------------------------------------------------- Playmaking
    R("ast", "Assists", "Playmaking", "skill", "per", "Assists per 70 or per 100.", "Assists ÷ possessions", ESPN, PER, n="poss"),
    R("ast_pct", "Assist %", "Playmaking", "skill", "pct1", "Share of teammates' baskets assisted while on the floor.", "AST ÷ (team FGM in the player's minutes - own FGM)", ESPN, "", n="n_astd"),
    R("ast_to", "Assist / turnover", "Playmaking", "skill", "num2", "Assists for every turnover.", "AST ÷ TOV", ESPN, "", settle="ast_pct", n="n_astd"),
    R("tov_pct", "Turnover %", "Playmaking", "skill", "pct1", "Share of the plays finished that ended in a turnover. Lower is better; the percentile is flipped.", "TOV ÷ (FGA + 0.475 FTA + TOV)", ESPN, "", lower=True, n="n_u"),
    # ---------------------------------------------------------------- Rebounding
    R("orb_pct", "Offensive rebound %", "Rebounding", "skill", "pct1", "Share of available offensive rebounds grabbed while on the floor.", "OREB ÷ (team OREB + opp DREB in the player's minutes)", ESPN, "", n="n_orbd"),
    R("drb_pct", "Defensive rebound %", "Rebounding", "skill", "pct1", "Share of available defensive rebounds grabbed while on the floor.", "DREB ÷ (team DREB + opp OREB in the player's minutes)", ESPN, "", n="n_drbd"),
    R("reb", "Rebounds", "Rebounding", "skill", "per", "Rebounds per 70 or per 100.", "REB ÷ possessions", ESPN, PER, n="poss"),
    # ---------------------------------------------------------------- Defense
    R("stl_pct", "Steal %", "Defense", "skill", "pct1", "Steals per 100 defensive possessions.", "STL ÷ defensive possessions", ESPN, "", n="dposs"),
    R("blk_pct", "Block %", "Defense", "skill", "pct1", "Share of opponents' two-point tries blocked.", "BLK ÷ opponent 2PA in the player's minutes", ESPN, "", n="n_blkd"),
    R("pf", "Fouls", "Defense", "skill", "per", "Fouls per 70 or per 100. Lower is better; the percentile is flipped.", "PF ÷ defensive possessions", ESPN, PER, lower=True, n="dposs"),
    # ---------------------------------------------------------------- Context
    R("usg", "Usage %", "Context", "context", "pct1", "Share of the team's plays finished while on the floor.", "(FGA + 0.475 FTA + TOV) ÷ the team's in the player's minutes", ESPN, "How much, not how good.", n="poss"),
    R("min_share", "Minutes share", "Context", "context", "pct1", "Share of the team's minutes played.", "Minutes ÷ (team minutes ÷ 5)", ESPN, "How much, not how good.", settle="usg", n="poss"),
    R("pace", "Pace on floor", "Context", "context", "num1", "Possessions per 40 minutes for the team during the player's minutes.", "Possessions ÷ minutes × 40", ESPN, "How much, not how good.", settle="usg", n="poss"),
    R("sos", "Opponent strength", "Context", "context", "sgn1", "Average adjusted net rating of the teams played, weighted by minutes.", "Minute-weighted opponent net rating", "WCE team ratings", "How much, not how good.", settle="usg", n="poss"),
    R("rim_freq", "Rim share", "Context", "context", "pct1", "Share of a player's shots taken at the rim.", "Rim FGA ÷ FGA", f"{PBP}. {LOC}", "How much, not how good.", family="pbp", n="n_fg"),
    R("mid_freq", "Mid-range share", "Context", "context", "pct1", "Share of a player's shots from mid-range.", "Mid-range FGA ÷ FGA", f"{PBP}. {LOC}", "How much, not how good.", family="pbp", n="n_fg"),
    R("tpar", "Three-point rate", "Context", "context", "pct1", "Share of a player's shots that are threes.", "3PA ÷ FGA", ESPN, "How much, not how good.", n="n_fga"),
    R("ftr", "Free-throw rate", "Context", "context", "pct1", "Free throws per 100 shots.", "FTA ÷ FGA", ESPN, "How much, not how good.", n="n_fga"),
    R("rim_ast", "Assisted at the rim", "Context", "context", "pct1", "Share of a player's rim makes that someone assisted.", "Assisted rim makes ÷ rim makes", PBP, "How much, not how good.", family="pbp", settle="rim_fg", n="n_rim"),
    R("three_ast", "Assisted threes", "Context", "context", "pct1", "Share of a player's made threes that someone assisted.", "Assisted 3PM ÷ 3PM", PBP, "How much, not how good.", family="pbp", settle="fg3", n="n_fg3a"),
    R("tr_freq", "Transition share", "Context", "context", "pct1", "Share of a player's shots in transition: within 8 seconds of a steal, live-ball turnover or defensive rebound.", "Transition FGA ÷ FGA", PBP, "How much, not how good.", family="pbp", settle="tpar", n="n_fg"),
    R("sdist", "Shot distance", "Context", "context", "num1", "Average distance of the player's shots, in feet.", "Total feet ÷ located FGA", LOC, "How much, not how good.", family="pbp", settle="tpar", n="n_fg"),
]
BY_KEY = {s.key: s for s in STATS}
GROUPS = ["Impact", "Scoring", "Shooting", "Playmaking", "Rebounding", "Defense", "Context"]
