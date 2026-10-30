"""
Basketball Savant — engine configuration.

This module is the single source of truth for:
  - which metrics exist and how they're displayed (METRICS),
  - the season / qualifier / window settings,
  - the logical-name -> NBA-column field map (FIELD_MAP, "task zero").

The page reads the *same* metric list (exported to out/metrics_config.json),
so labels/units/thresholds stay in sync between engine and front-end.
"""

import datetime as _dt

def _recent_seasons(n=15, today=None):
    """The n most recent NBA seasons, newest first, as 'YYYY-YY' labels, computed from today's
    date so the list rolls over automatically as the calendar advances. The current-season start
    year rolls to the new year only once the season has tipped off (>= October); before that
    we're still in the prior season (e.g. July 2026 -> current season 2025-26, not 2026-27).
    n=15 reaches back to roughly 2011-12."""
    today = today or _dt.date.today()
    start_year = today.year if today.month >= 10 else today.year - 1
    return [f"{y}-{str(y + 1)[2:]}" for y in range(start_year, start_year - n, -1)]

SEASONS = _recent_seasons(15)  # newest first; rolls forward with the calendar
SEASON = SEASONS[0]
SEASON_TYPE = "Regular Season"

# Qualified population for the league/position distributions.
QUALIFY = {"min_mpg": 15.0, "min_gp": 20}

# Rolling windows. None = full season; int = LastNGames value sent to the API.
WINDOWS = {"season": None, "l10": 10, "l25": 25, "l75": 75}

# Politeness / resilience for stats.nba.com
RATE_SLEEP = 0.6      # seconds between calls (add jitter in client)
RETRIES = 4
TIMEOUT = 30
CACHE_DIR = "cache"
OUT_DIR = "out"

# 3-way position bucket from PlayerIndex POSITION (G/F/C and combos).
def position_bucket(pos: str) -> str:
    # Older seasons' PlayerIndex can carry a NaN (float) POSITION; NaN is truthy so `pos or ""`
    # wouldn't neutralize it. Coerce anything non-str to "" -> defaults to Wing.
    p = (pos.upper() if isinstance(pos, str) else "")
    if p.startswith("G"):
        return "Guard"
    if p.startswith("C"):
        return "Big"
    if "F-C" in p or "C-F" in p:
        return "Big"
    return "Wing"  # F, F-G, G-F default to Wing

# ----------------------------------------------------------------------------
# ERA TIERS — the season from which a bar can carry data (historical backfill, see
# HISTORICAL_BACKFILL_PLAN.md §2). A player-season shows a bar only if its era >= the
# bar's tier; above-tier bars render greyed "Not tracked in {year}" (never 0th pct).
#   1 Box-Score Era     since 1979-80  (all box-derived + BR value estimates)
#   2 Shot-Location Era since 1996-97  (digitized PBP: on/off, raw +/-)
#   3 Player-Tracking   since 2013-14  (SportVU: drives, passing, shot-defense)
#   4 Full Modern       since 2016-17  (hustle, Second Spectrum matchups, synergy, gravity)
# ----------------------------------------------------------------------------
TIER_SINCE = {1: "1979-80", 2: "1996-97", 3: "2013-14", 4: "2016-17"}

def season_tier(season: str) -> int:
    """The highest data tier a season supports (start-year based)."""
    y = int(season[:4])
    if y >= 2016: return 4
    if y >= 2013: return 3
    if y >= 1996: return 2
    return 1

# ----------------------------------------------------------------------------
# AGING CURVE — the frozen empirical baseline produced by the aging_curve.py
# diagnostic. NOT read by the page: the trend pill measures a player against his
# own record, not against his age group, so nothing here is exported to the
# front-end. Kept as the durable record of that run, and as the input if an
# age-relative comparison is ever wanted. Regenerate deliberately:
#
#     python aging_curve.py --emit-constants
#
# Derived from paired consecutive seasons: a player must appear in BOTH, clear
# `min_minutes` in EACH, and keep his position bucket; each pair is weighted by
# min(MP1, MP2). "impact" is the delta in position-adjusted BPM percentile,
# "minutes" the delta in MPG. coef is ascending powers of age (a cubic), valid
# only inside `fit`; `cross` is the downward zero crossing — the implied peak.
# n_by_age is the player-pair count behind each single age, for honest sourcing.
# ----------------------------------------------------------------------------
AGING = {
  "generated": "2026-07-26",   # python aging_curve.py --emit-constants
  "seasons": ["2011-12", "2025-26"], "pairs": 3713,
  "min_minutes": 500, "min_pairs": 25,
  "fit": [20, 37], "degree": 3,
  # polynomial coefficients, ascending powers of age; value = expected delta at that age
  "impact": {"coef": [290.503897295319, -26.470849921028343, 0.8010411707418036, -0.008177100664153687],
              "cross": 26.032},
  "minutes": {"coef": [34.04462196825755, -2.9681165103808467, 0.08849758380205178, -0.0009472336695280155],
              "cross": 26.173},
  "n_by_age": {20: 67, 21: 165, 22: 236, 23: 295, 24: 343, 25: 359, 26: 350, 27: 331, 28: 313, 29: 262, 30: 227, 31: 194, 32: 166, 33: 130, 34: 97, 35: 64, 36: 49, 37: 28},
}

# ----------------------------------------------------------------------------
# METRIC REGISTRY
# kind tells the loader where the value comes from:
#   box       -> LeagueDashPlayerStats (Base, Totals) + derived
#   adv       -> LeagueDashPlayerStats (Advanced, Totals)
#   track_*   -> LeagueDashPtStats (PtMeasureType)
#   ptshot    -> LeagueDashPlayerPtShot (closest-defender dataset)
#   ptdefend  -> LeagueDashPtDefend (DefenseCategory)
#   hustle    -> LeagueHustleStatsPlayer
#   gravity   -> GravityLeaders
#   synergy   -> SynergyPlayTypes (offensive, aggregated)
#   matchups  -> LeagueSeasonMatchups (derived difficulty / opp efg)
#   bio       -> LeagueDashPlayerBioStats
#   combine   -> DraftCombinePlayerAnthro / DraftCombineStats
#   brval     -> Basketball Reference Advanced (PER/WS/BPM/VORP — all eras, model estimates)
#   derived   -> computed in-engine from box totals (no new endpoint)
# windowed: True if the metric is recomputed per rolling window (LastNGames).
# lower:    True if a lower raw value is better (page inverts for percentile).
# tier:     era tier (1-4) — see TIER_SINCE above. Every bar must carry one.
# ----------------------------------------------------------------------------
METRICS = [
  dict(key="mpg",      label="Minutes / game",        group="ctx", sub="",                       layer="context",    unit="num1", thr=0,    lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="minshare", label="Minutes share",         group="ctx", sub="",                       layer="context",    unit="pct1", thr=0,    lower=False, kind="derived",  windowed=False, tier=1),
  dict(key="avail",    label="Availability",          group="ctx", sub="",                       layer="context",    unit="pct1", thr=0,    lower=False, kind="derived",  windowed=False, tier=1),

  dict(key="ts",       label="True shooting %",        group="off", sub="Shooting",               layer="output",     unit="pct3", thr=200,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="efg",      label="Effective FG%",          group="off", sub="Shooting",               layer="output",     unit="pct3", thr=200,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="pps",      label="Points per shot",        group="off", sub="Shooting",               layer="output",     unit="num2", thr=200,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="tp3",      label="3-point %",              group="off", sub="Shooting",               layer="output",     unit="pct1", thr=100,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="tp3a",     label="3-point attempts / g",   group="off", sub="Shooting",               layer="output",     unit="num1", thr=100,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="tp3r",     label="3PA rate (of FGA)",      group="off", sub="Shooting",               layer="ingredient", unit="pct1", thr=100,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="tp2",      label="2-point %",              group="off", sub="Shooting",               layer="output",     unit="pct1", thr=150,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="ft",       label="Free throw %",           group="off", sub="Shooting",               layer="output",     unit="pct1", thr=50,   lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="fta",      label="FT attempts / g",        group="off", sub="Shooting",               layer="output",     unit="num1", thr=300,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="ftr",      label="FT rate (of FGA)",       group="off", sub="Shooting",               layer="ingredient", unit="pct1", thr=300,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="p3pt",     label="% points from 3",        group="off", sub="Shooting",               layer="ingredient", unit="pct1", thr=200,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="ppaint",   label="% points in the paint",  group="off", sub="Shooting",               layer="ingredient", unit="pct1", thr=200,  lower=False, kind="scoring",  windowed=True,  tier=2),
  dict(key="xefg",     label="Shot quality (expected eFG%)", group="off", sub="Shooting",         layer="expected",   unit="pct3", thr=200,  lower=False, kind="xfg",      windowed=False, tier=3),
  dict(key="shotmk",   label="Shot-making over expected", group="off", sub="Shooting",            layer="output",     unit="sgn",  thr=200,  lower=False, kind="xfg",      windowed=False, tier=3),

  dict(key="pts",      label="Points / 75",            group="off", sub="Creation & playmaking",  layer="output",     unit="num1", thr=300,  lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="ast",      label="Assist %",               group="off", sub="Creation & playmaking",  layer="output",     unit="pct1", thr=300,  lower=False, kind="adv",      windowed=True,  tier=1),
  dict(key="ast75",    label="Assists / 75",           group="off", sub="Creation & playmaking",  layer="output",     unit="num1", thr=300,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="asttov",   label="Assist / turnover",      group="off", sub="Creation & playmaking",  layer="output",     unit="num2", thr=300,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="potast",   label="Potential assists / 75", group="off", sub="Creation & playmaking",  layer="ingredient", unit="num1", thr=300,  lower=False, kind="track_passing", windowed=True, tier=3),
  dict(key="usg",      label="Usage %",                group="off", sub="Creation & playmaking",  layer="ingredient", unit="pct1", thr=300,  lower=False, kind="adv",      windowed=True,  tier=1),
  dict(key="tov",      label="Turnover %",             group="off", sub="Creation & playmaking",  layer="output",     unit="pct1", thr=300,  lower=True,  kind="box",      windowed=True,  tier=1),
  dict(key="tov75",    label="Turnovers / 75",         group="off", sub="Creation & playmaking",  layer="ingredient", unit="num1", thr=300,  lower=True,  kind="derived",  windowed=True,  tier=1),
  dict(key="oreb",     label="Offensive rebound %",    group="off", sub="Creation & playmaking",  layer="output",     unit="pct1", thr=500,  lower=False, kind="adv",      windowed=True,  tier=1),
  dict(key="grav",     label="Off-ball gravity",       group="off", sub="Creation & playmaking",  layer="ingredient", unit="num1", thr=5000, lower=False, kind="gravity",  windowed=False, tier=4),
  dict(key="drv",      label="Drive rate / 75",        group="off", sub="Creation & playmaking",  layer="ingredient", unit="num1", thr=150,  lower=False, kind="track_drives", windowed=True, tier=3),
  dict(key="selfcr",   label="Self-creation",          group="off", sub="Creation & playmaking",  layer="ingredient", unit="word", thr=100,  lower=False, kind="ptshot",   windowed=True,  tier=3),
  dict(key="uast",     label="Unassisted makes %",     group="off", sub="Creation & playmaking",  layer="ingredient", unit="pct1", thr=100,  lower=False, kind="scoring",  windowed=True,  tier=2),
  dict(key="uast3",    label="Unassisted 3s %",        group="off", sub="Creation & playmaking",  layer="ingredient", unit="pct1", thr=50,   lower=False, kind="scoring",  windowed=True,  tier=2),
  dict(key="syn",      label="Shot-making (PPP %ile)", group="off", sub="Creation & playmaking",  layer="expected",   unit="num0", thr=100,  lower=False, kind="synergy",  windowed=False, tier=4),
  dict(key="ddiff",    label="Defender difficulty",    group="off", sub="Creation & playmaking",  layer="ingredient", unit="wsgn", thr=200,  lower=False, kind="matchups", windowed=False, tier=4),

  dict(key="onoff",    label="On/Off net",             group="off", sub="Impact",                 layer="context",    unit="num1", thr=0,    lower=False, kind="onoff",    windowed=False, tier=2),
  dict(key="onoffadj", label="On/Off net (luck-adjusted)", group="off", sub="Impact",             layer="context",    unit="num1", thr=0,    lower=False, kind="onoffadj", windowed=False, tier=2),

  dict(key="reb75",    label="Rebounds / 75",          group="def", sub="Rebounding",             layer="output",     unit="num1", thr=300,  lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="dreb",     label="Def. rebound %",         group="def", sub="Rebounding",             layer="output",     unit="pct1", thr=500,  lower=False, kind="adv",      windowed=True,  tier=1),

  dict(key="stl",      label="Steals / 75",            group="def", sub="Activity & outcomes",    layer="output",     unit="num1", thr=1000, lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="blk",      label="Blocks / 75",            group="def", sub="Activity & outcomes",    layer="output",     unit="num1", thr=1000, lower=False, kind="box",      windowed=True,  tier=1),
  dict(key="stk75",    label="Stocks / 75",            group="def", sub="Activity & outcomes",    layer="output",     unit="num1", thr=1000, lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="stlpct",   label="Steal %",                group="def", sub="Activity & outcomes",    layer="ingredient", unit="pct1", thr=1000, lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="blkpct",   label="Block %",                group="def", sub="Activity & outcomes",    layer="ingredient", unit="pct1", thr=1000, lower=False, kind="derived",  windowed=True,  tier=1),
  dict(key="rim",      label="Rim FG% def. diff",      group="def", sub="Activity & outcomes",    layer="output",     unit="sgn",  thr=75,   lower=True,  kind="ptdefend", windowed=True,  tier=3),
  dict(key="mtch",     label="Matchup difficulty",     group="def", sub="Activity & outcomes",    layer="ingredient", unit="wnum", thr=200,  lower=False, kind="matchups", windowed=False, tier=4),
  dict(key="oppfg",    label="Opp FG% on matchups",    group="def", sub="Activity & outcomes",    layer="output",     unit="sgn",  thr=100,  lower=True,  kind="matchups", windowed=False, tier=4),
  dict(key="defl",     label="Deflections / 75",       group="def", sub="Activity & outcomes",    layer="ingredient", unit="num1", thr=300,  lower=False, kind="hustle",   windowed=True,  tier=4),

  dict(key="length",   label="Length (wingspan)",      group="def", sub="Physical ingredients",   layer="ingredient", unit="ftin", thr=0,    lower=False, kind="combine",  windowed=False, tier=1),
  dict(key="height",   label="Height",                 group="def", sub="Physical ingredients",   layer="ingredient", unit="ftin", thr=0,    lower=False, kind="bio",      windowed=False, tier=1),
  dict(key="strength", label="Strength (weight)",      group="def", sub="Physical ingredients",   layer="ingredient", unit="lb",   thr=0,    lower=False, kind="bio",      windowed=False, tier=1),
  dict(key="reach",    label="Standing reach",         group="def", sub="Physical ingredients",   layer="ingredient", unit="ftin", thr=0,    lower=False, kind="combine",  windowed=False, tier=1),
  dict(key="lateral",  label="Lateral agility",        group="def", sub="Physical ingredients",   layer="ingredient", unit="sec",  thr=0,    lower=True,  kind="combine",  windowed=False, tier=1),
  dict(key="vert",     label="Vertical",               group="def", sub="Physical ingredients",   layer="ingredient", unit="inch", thr=0,    lower=False, kind="combine",  windowed=False, tier=1),

  # Overall value — Basketball Reference model estimates (all eras), + engine-computed Game Score.
  dict(key="per",      label="PER",                    group="val", sub="Overall value",          layer="output",     unit="num1", thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="ws48",     label="Win Shares / 48",        group="val", sub="Overall value",          layer="output",     unit="num3", thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="bpm",      label="Box Plus/Minus",         group="val", sub="Overall value",          layer="output",     unit="sgn",  thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="obpm",     label="Offensive BPM",          group="val", sub="Overall value",          layer="ingredient", unit="sgn",  thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="dbpm",     label="Defensive BPM",          group="val", sub="Overall value",          layer="ingredient", unit="sgn",  thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="vorp",     label="VORP",                   group="val", sub="Overall value",          layer="output",     unit="num1", thr=0,    lower=False, kind="brval",    windowed=False, tier=1),
  dict(key="gmsc",     label="Game Score / g",         group="val", sub="Overall value",          layer="output",     unit="num1", thr=0,    lower=False, kind="derived",  windowed=True,  tier=1),
]

# ----------------------------------------------------------------------------
# WEAKNESS COMPS — "whose flaws look like his?", the mirror of the statistical comps.
#
# Every dim below is an existing METRICS key, so direction comes free from that entry's
# `lower` flag: the percentile is always flipped to a GOODNESS percentile (100 = good)
# before the hinge is applied. Two properties make this different from COMP_DIMS:
#
#   position-relative  Percentiles are ranked inside the player's own Guard/Wing/Big
#     bucket, not league-wide. Ranked league-wide the model just re-derives position —
#     every guard "can't protect the rim", every centre "can't pass". Ranking within the
#     bucket is also what makes `oreb` behave: a wing who doesn't crash the glass is
#     playing a role, a big who doesn't is showing a flaw.
#
#   hinged             Weakness on a dim is max(0, hinge - goodness); at or above the
#     hinge it contributes exactly zero. Strengths therefore cannot dilute a match, which
#     is the whole point — two otherwise-unalike players who share one flaw still find
#     each other, where the full-profile comps would never pair them.
#
# Purely stylistic dims (usage, 3PA rate, FT rate, defender difficulty) are deliberately
# absent: a low value there is a role, not a flaw, and including them would rank players
# by what they are asked to do rather than what they cannot do.
# ----------------------------------------------------------------------------
WEAKNESS = {
  "min_minutes": 500,      # pool floor — matches the statistical comps' COMP_MIN_MINUTES
  "hinge": 50.0,           # goodness percentile at/above which a dim carries no weakness
  "min_dims": 8,           # shared dims needed before two players can be compared at all
  "severity_w": 0.9,       # weight on severity mismatch relative to profile-shape mismatch
  "rare_frac": 0.02,       # best-match distance quantile that calibrates to a 95% match
  "n_comps": 3,
  "n_flaws": 3,            # flaws named per player
  "flaw_max_pct": 45,      # a dim is only *named* a flaw below this goodness percentile
  "low_match": 62,         # at or below this match%, the page shows the weak-match banner
  # The dims, as METRICS keys. Labels are deliberately NOT redefined here: the module sits
  # on the same page as these exact bars, so a second name for the same number ("Ball-hawking"
  # over a bar reading "Steal %") just breaks the reader's ability to trace a named flaw back
  # to the row above it. weakness_labels() reads them from METRICS instead.
  "dims": ["ts", "tp3", "ft", "tov", "ast", "selfcr", "oreb", "dreb",
           "stlpct", "blkpct", "rim", "oppfg", "avail"],
}

def weakness_labels():
    """{key: label} for the weakness dims, taken from the metric registry so the module and
    the bars above it always speak the same vocabulary."""
    by_key = {m["key"]: m["label"] for m in METRICS}
    return {k: by_key[k] for k in WEAKNESS["dims"]}

# ----------------------------------------------------------------------------
# FIELD MAP ("task zero"): logical name -> live NBA response column.
# VERIFY these against a live header dump before trusting them — run:
#   python savant_engine.py discover
# NBA.com renames columns without notice; fix here, nowhere else.
# ----------------------------------------------------------------------------
FIELD_MAP = {
  "box": {  # LeagueDashPlayerStats, MeasureType=Base, PerMode=Totals
    "id":"PLAYER_ID","name":"PLAYER_NAME","gp":"GP","min":"MIN",
    "fgm":"FGM","fga":"FGA","fg3m":"FG3M","fg3a":"FG3A","ftm":"FTM","fta":"FTA",
    "pts":"PTS","tov":"TOV","stl":"STL","blk":"BLK","ast":"AST","reb":"REB",
    "oreb":"OREB","dreb":"DREB","pf":"PF",  # OREB/DREB/PF feed Game Score + reb split
  },
  "adv": {  # MeasureType=Advanced, PerMode=Totals
    "id":"PLAYER_ID","ast_pct":"AST_PCT","dreb_pct":"DREB_PCT","oreb_pct":"OREB_PCT",
    "usg_pct":"USG_PCT","poss":"POSS","pace":"PACE","pie":"PIE",
  },
  "track_drives": {"id":"PLAYER_ID","drives":"DRIVES"},
  "track_speed":  {"id":"PLAYER_ID","avg_speed_off":"AVG_SPEED_OFF","avg_speed":"AVG_SPEED","dist":"DIST_MILES"},
  "track_passing":{"id":"PLAYER_ID","potential_ast":"POTENTIAL_AST","passes_made":"PASSES_MADE","ast":"AST"},  # LeagueDashPtStats, PtMeasureType=Passing
  "team_opp": {"id":"TEAM_ID","min":"MIN","opp_fga":"OPP_FGA","opp_fg3a":"OPP_FG3A"},  # LeagueDashTeamStats, MeasureType=Opponent (for BLK% denominator; MIN is game-minutes)
  "ptshot": {  # LeagueDashPlayerPtShot — one call per closest-defender-distance filter;
               # FGA_FREQUENCY on each call is that player's shot freq at that distance.
               # "range_*" are CloseDefDistRange filter VALUES (not column names).
    "id":"PLAYER_ID","fga":"FGA","fga_freq":"FGA_FREQUENCY",
    "range_very_tight":"0-2 Feet - Very Tight","range_tight":"2-4 Feet - Tight",
  },
  "ptdefend": {  # DefenseCategory="Less Than 6Ft"
    "id":"CLOSE_DEF_PERSON_ID","d_fga":"FGA_LT_06","fg_pct":"LT_06_PCT","plusminus":"PLUSMINUS",
  },
  "hustle": {"id":"PLAYER_ID","deflections":"DEFLECTIONS","contested":"CONTESTED_SHOTS"},
  "gravity": {  # GravityLeaders — confirmed via discover 2026-06-30
    "id":"PLAYERID","offball_perimeter":"AVGOFFBALLPERIMETERGRAVITYSCORE","frames":"OFFBALLPERIMETERFRAMES",
  },
  "synergy": {"id":"PLAYER_ID","poss":"POSS","ppp":"PPP","pct":"PERCENTILE"},
  "onoff": {  # TeamPlayerOnOffSummary, MeasureType=Advanced — confirmed via live probe 2026-07-02:
              # frame[1]=On-court player rows, frame[2]=Off-court player rows, join on VS_PLAYER_ID.
    "id":"VS_PLAYER_ID","min":"MIN","net":"NET_RATING",
  },
  "matchups": {  # LeagueSeasonMatchups (def player x off player rollup)
    "def_id":"DEF_PLAYER_ID","off_id":"OFF_PLAYER_ID","partial_poss":"PARTIAL_POSS",
    "matchup_fgm":"MATCHUP_FGM","matchup_fga":"MATCHUP_FGA","matchup_fg3m":"MATCHUP_FG3M",
  },
  "bio": {"id":"PLAYER_ID","height_in":"PLAYER_HEIGHT_INCHES","weight":"PLAYER_WEIGHT","age":"AGE"},
  "player_info": {"id":"PERSON_ID","birthdate":"BIRTHDATE","school":"SCHOOL","from_year":"FROM_YEAR"},  # CommonPlayerInfo, one call per player (cached)
  "combine_anthro": {"id":"PLAYER_ID","wingspan":"WINGSPAN","reach":"STANDING_REACH"},
  "combine_drill":  {"id":"PLAYER_ID","max_vert":"MAX_VERTICAL_LEAP","lane_agility":"LANE_AGILITY_TIME"},
  # PlayerIndex no longer exposes AGE or a combined last-comma-first name (verified 2026-06-30);
  # first/last are joined in build(), age comes from bio (LeagueDashPlayerBioStats).
  "index": {"id":"PERSON_ID","first":"PLAYER_FIRST_NAME","last":"PLAYER_LAST_NAME","pos":"POSITION","team":"TEAM_ABBREVIATION"},
}
