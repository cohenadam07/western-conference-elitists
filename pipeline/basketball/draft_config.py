"""
Draft Savant — configuration + hardcoded v1 dataset.

Companion to savant_config.py, same role: single source of truth for the metric
registry (labels/units/grouping/thresholds) and, for this first version, the raw
prospect data itself (no live pulling yet — see DRAFT_SAVANT_RESEARCH.md).

The top 3 are transcribed from DRAFT_SAVANT_RESEARCH.md section 8 (player writeups)
and section 3 (combine measurements). Picks 4-60 were researched separately: college
per-game lines and shooting splits from general web search, and advanced rate stats
(TS%/eFG%/usage/AST%/TOV%/OREB%/DREB%/STL%/BLK%/BPM/OBPM/DBPM) primarily from
draftballr.com — a single consistent stats database (also cited in DRAFT_SAVANT_RESEARCH.md
section 10) that, unlike Sports-Reference, isn't blocked for automated fetches. Where
neither source has a stat, the field is left as None rather than estimated — the
front-end renders that as "-". Two fields come from outside any single source, sourced
and dated explicitly below: birthdate (public record, e.g. Wikipedia) and KenPom
strength-of-schedule rank (a live, refreshed number — re-check kenpom.com before
trusting it in a later session).

BPM/OBPM/DBPM source note: the top 3 use a Sports-Reference-labeled number (with
Barttorvik's alternate figure in bpm_torvik, per the doc). Picks 4-60 use DraftBallr's
own composite model — a different system, so don't treat BPM as perfectly comparable
across the two groups (the doc itself warns against mixing BPM systems). A few
DraftBallr BPM figures diverged substantially from an earlier, less-reliable search
pass (e.g. Trey Kaufman-Renn and Jaron Pierre Jr. came back net-negative); those are
flagged inline where the swing was large enough to change the read on the player.
"""
import datetime as _dt

# Age reference date, mirroring savant_engine._season_ref_date's convention
# (Feb 1 of the season's second calendar year) for the 2025-26 college season.
AGE_REF_DATE = _dt.date(2026, 2, 1)

def decimal_age(birthdate, ref_date=AGE_REF_DATE):
    """Same formula as savant_engine._age_from_birthdate: whole days / 365.25."""
    return round((ref_date - birthdate).days / 365.25, 2)

# ----------------------------------------------------------------------------
# METRIC REGISTRY — mirrors savant_config.METRICS shape (key/label/group/sub/
# layer/unit/lower). No `thr`/windowed here: this is a single college-season
# snapshot per prospect, not a windowed NBA stream. `n` (sample size, i.e. GP)
# is carried per-player instead, so the page can still flag small samples.
#
# METRIC SELECTION (why this specific set): every metric shown as a percentile
# bar is one our data pipeline tracks for the vast majority of the NCAA pool
# (>74% coverage), so bars fill in rather than sitting blank. Stats our sources
# cover sparsely were deliberately dropped from the bars to avoid a wall of "-":
#   - Offensive rating (~17% coverage), 3-point rate (~15%), FT rate (~31%) —
#     DraftBallr (our consistent advanced-stat source) doesn't expose them.
#   - PER (~44%) — redundant with BPM/OBPM/DBPM, which DRAFT_SAVANT_RESEARCH.md
#     calls the workhorse impact metric, and far better covered.
#   - Max vertical (~74% of NCAA) — kept as a bar? no: unlike the anthro dimensions,
#     athletic testing is optional and ~1 in 4 prospects skip it (top picks, injured
#     players), so vertical stays a header fact (compact "-") rather than a ranked bar.
# Physical DIMENSIONS (height/wingspan/reach/weight) ARE shown as bars: after pulling
# the official 2026 combine anthro table (see COMBINE_ANTHRO below) they hit ~100%
# NCAA coverage — every combine attendee is measured. They also appear in the ID-card
# header strip as quick vitals; the bars add the percentile-vs-class ranking (this
# dual presentation mirrors the sister page). The dropped fields' values still live in
# PROSPECTS (the header reads height/wing/reach/weight/vert directly).
# ----------------------------------------------------------------------------
# ERA-VALIDITY (vf/vt = valid_from / valid_to draft year, inclusive): a metric renders for a
# player only if vf <= his draft_year <= vt AND he has a value (see the page's era-gate + the
# hide-missing rule). This makes the registry era-aware so a class can carry only the metrics
# that make sense for its years. Sourcing note for the 2010-2025 backfill: Barttorvik covers
# every college box/advanced rate AND the rim/mid shot-location splits back to 2008, and the
# NBA combine anthro table goes back to 2000, so within our 2010-2026 window no metric is
# actually era-excluded — the per-player hide-missing rule does the practical work. The vf/vt
# fields are still authored honestly (and enforced) so any future tracking-derived, modern-only
# metric can be added with a vf that keeps it off the older classes. Default span: 2010-2026.
VALID_FROM, VALID_TO = 2010, 2026

def _m(vf=None, vt=None, **kw):
    kw["valid_from"] = VALID_FROM if vf is None else vf
    kw["valid_to"]   = VALID_TO if vt is None else vt
    return kw

METRICS = [
  _m(key="age",   label="Draft-day age",       group="ctx", sub="",                    layer="context",    unit="num1", lower=True),
  _m(key="sos",   label="Strength of schedule",group="ctx", sub="",                    layer="context",    unit="num0", lower=True),

  _m(key="ts",    label="True shooting %",     group="off", sub="Scoring",             layer="output",     unit="pct3", lower=False),
  _m(key="efg",   label="Effective FG%",       group="off", sub="Scoring",             layer="output",     unit="pct1", lower=False),
  _m(key="usg",   label="Usage %",             group="off", sub="Scoring",             layer="ingredient", unit="pct1", lower=False),
  # Era-era-standard box/efficiency measures — well-populated by Barttorvik across 2010-2025 and
  # already present on the 2026 class; added as bars in this backfill.
  _m(key="ortg",  label="Offensive rating",    group="off", sub="Scoring",             layer="output",     unit="num1", lower=False),
  _m(key="ftr",   label="Free-throw rate",     group="off", sub="Scoring",             layer="ingredient", unit="pct1", lower=False),

  _m(key="ft",    label="Free throw %",        group="off", sub="Shooting",            layer="output",     unit="pct1", lower=False),
  _m(key="tp3",   label="3-point %",           group="off", sub="Shooting",            layer="output",     unit="pct1", lower=False),
  _m(key="tp3r",  label="3-point rate",        group="off", sub="Shooting",            layer="ingredient", unit="pct1", lower=False),
  _m(key="twop",  label="2-point %",           group="off", sub="Shooting",            layer="output",     unit="pct1", lower=False),
  _m(key="rimfg", label="Rim FG%",             group="off", sub="Shooting",            layer="output",     unit="pct1", lower=False),
  _m(key="midfg", label="Mid-range FG%",       group="off", sub="Shooting",            layer="output",     unit="pct1", lower=False),

  _m(key="ast",   label="Assist %",            group="off", sub="Playmaking",          layer="output",     unit="pct1", lower=False),
  _m(key="tov",   label="Turnover %",          group="off", sub="Playmaking",          layer="output",     unit="pct1", lower=True),
  _m(key="ator",  label="Assist / turnover",   group="off", sub="Playmaking",          layer="output",     unit="num1", lower=False),
  _m(key="oreb",  label="Offensive rebound %", group="off", sub="Playmaking",          layer="output",     unit="pct1", lower=False),

  _m(key="stl",   label="Steal %",             group="def", sub="Activity",            layer="output",     unit="pct1", lower=False),
  _m(key="blk",   label="Block %",             group="def", sub="Activity",            layer="output",     unit="pct1", lower=False),
  _m(key="dreb",  label="Defensive rebound %", group="def", sub="Activity",            layer="output",     unit="pct1", lower=False),

  _m(key="bpm",   label="BPM",                 group="def", sub="Impact",              layer="output",     unit="num1", lower=False),
  _m(key="obpm",  label="Offensive BPM",       group="def", sub="Impact",              layer="output",     unit="num1", lower=False),
  _m(key="dbpm",  label="Defensive BPM",       group="def", sub="Impact",              layer="output",     unit="num1", lower=False),

  _m(key="wing",  label="Wingspan",            group="def", sub="Physical tools",      layer="ingredient", unit="ftin", lower=False),
  _m(key="reach", label="Standing reach",      group="def", sub="Physical tools",      layer="ingredient", unit="ftin", lower=False),
  _m(key="height",label="Height (barefoot)",   group="def", sub="Physical tools",      layer="ingredient", unit="ftin", lower=False),
  _m(key="weight",label="Weight",              group="def", sub="Physical tools",      layer="ingredient", unit="lb",   lower=False),
]

# ----------------------------------------------------------------------------
# COMPOSITE DIAL WEIGHTS — a transparent, documented blend of percentile ranks
# (computed client-side from the same pool the bars use), weighted toward what
# DRAFT_SAVANT_RESEARCH.md identifies as actually predictive: impact (BPM), age
# ("does enormous work" per Pelton/PRISM), stocks, clean shooting touch (FT%),
# scoring efficiency (TS%), and ball security/creation (AST%, TOV% inverted) -
# not raw scoring volume. Strength of schedule is deliberately NOT weighted in:
# it's shown as context (three data points is too thin to trust a SOS weight),
# not folded into the grade. Must sum to 1.0. Shown next to the dial in the UI.
# ----------------------------------------------------------------------------
COMPOSITE_WEIGHTS = [
  dict(key="bpm",  w=0.22),
  dict(key="age",  w=0.15),
  dict(key="stl",  w=0.12),
  dict(key="blk",  w=0.08),
  dict(key="ft",   w=0.13),
  dict(key="ts",   w=0.13),
  dict(key="ast",  w=0.09),
  dict(key="tov",  w=0.08),
]

# ----------------------------------------------------------------------------
# PROSPECTS — the full 60-pick 2026 NBA draft class. The top 3 are hardcoded
# from DRAFT_SAVANT_RESEARCH.md; picks 4-60 were researched separately (college
# per-game lines, shooting splits, advanced stats where publicly findable,
# combine measurements, real birthdates) with the same no-fabrication rule:
# anything not confidently verified is None, not estimated. Advanced rate stats
# (BPM, ORtg, PER, USG%, AST%, TOV%, OREB%/DREB%, STL%/BLK%) are frequently
# unavailable for day-two picks and international/non-NCAA players (marked in
# `college`) — that's an honest reflection of public data coverage, not a bug.
# `n` = games played, carried so the page can flag small/interrupted samples
# (e.g. injury-shortened seasons) the same way the live NBA engine flags low-n
# windows. Conference/sos_rank are None for non-NCAA players (no KenPom entry).
# ----------------------------------------------------------------------------
PROSPECTS = [
  dict(
    id="dybantsa", name="AJ Dybantsa", college="BYU", pos="Wing", conference="Big 12",
    archetype="Two-Way Shot-Creating Wing",
    draft_pick=1, draft_team="Washington Wizards",
    birthdate=_dt.date(2007, 1, 29),                   # public record (Wikipedia)
    sos_rank=17, sos_asof="2026-07-07",                 # kenpom.com live SOS rank, out of ~364 D-I teams
    gp=35, line=dict(ppg=25.5, rpg=6.8, apg=3.7, tpg=3.1),
    m=dict(
      ts=(0.600, 35), efg=(55.0, 35), ortg=(122.1, 35), per=(28.1, 35), usg=(33.9, 35),
      ft=(77.4, 35), tp3=(33.1, 35), tp3r=(24.5, 35), ftr=(49.0, 35),
      ast=(22.1, 35), tov=(15.0, 35), ator=(1.19, 35), oreb=(4.7, 35),
      stl=(1.7, 35), blk=(1.1, 35), dreb=(16.9, 35),
      bpm=(11.7, 35), obpm=(9.5, 35), dbpm=(2.2, 35),
      wing=(84.25, None), reach=(106, None), height=(80.5, None), weight=(217, None), vert=(42.0, None),
    ),
    bpm_torvik=10.1, usg_torvik=33.5,
    scouting="Led the nation in scoring (25.5 ppg, 894 points - third-most by a freshman in "
      "NCAA D-I history) on plus efficiency (.600 TS%) at elite usage, with prototype wing size "
      "and a 42\" vertical. The flags are defensive translation and shot diet: a modest 1.7% "
      "steal rate, thin block rate, and low 3-point volume (24.5% rate) mean the shooting and "
      "defensive projection carry more uncertainty than the scoring does.",
  ),
  dict(
    id="peterson", name="Darryn Peterson", college="Kansas", pos="Guard", conference="Big 12",
    archetype="Lead Creator / Shot Creator",
    draft_pick=2, draft_team="Utah Jazz",
    birthdate=_dt.date(2007, 1, 17),                    # public record (Wikipedia)
    sos_rank=3, sos_asof="2026-07-07",                  # kenpom.com live SOS rank, out of ~364 D-I teams
    gp=24, line=dict(ppg=20.2, rpg=4.2, apg=1.6, tpg=None),
    m=dict(
      ts=(0.578, 24), efg=(52.7, 24), ortg=(117.1, 24), per=(25.4, 24), usg=(33.5, 24),
      ft=(82.6, 24), tp3=(38.2, 24), tp3r=(46.3, 24), ftr=(37.1, 24),
      ast=(12.5, 24), tov=(10.4, 24), ator=None, oreb=(2.9, 24),
      stl=(2.9, 24), blk=(2.3, 24), dreb=(11.8, 24),
      bpm=(14.1, 24), obpm=(9.3, 24), dbpm=(4.8, 24),
      wing=(81.75, None), reach=(103, None), height=(76.5, None), weight=(199, None), vert=(37.5, None),
    ),
    bpm_torvik=12.4, usg_torvik=30.9,
    scouting="An excellent shot-maker (82.6% FT, 38.2% on heavy 3-point volume) with elite "
      "turnover economy (10.4% TOV%) and unusually good stocks for a guard (2.9% STL, 2.3% BLK). "
      "The swing skill is passing: a 12.5% assist rate is thin for a projected lead guard, and "
      "the sample itself is injury-shortened (24 games, missed time with cramping/hamstring/ankle "
      "issues) - Swish Theory noted his assist rate climbing over his healthier final two months.",
  ),
  dict(
    id="boozer", name="Cameron Boozer", college="Duke", pos="Big", conference="ACC",
    archetype="Offensive Hub Big",
    draft_pick=3, draft_team="Memphis Grizzlies",
    birthdate=_dt.date(2007, 7, 18),                    # public record (Wikipedia)
    sos_rank=18, sos_asof="2026-07-07",                 # kenpom.com live SOS rank, out of ~364 D-I teams
    gp=38, line=dict(ppg=22.5, rpg=10.2, apg=4.1, tpg=2.5),
    m=dict(
      ts=(0.653, 38), efg=(60.7, 38), ortg=(135.7, 38), per=(33.7, 38), usg=(29.9, 38),
      ft=(78.9, 38), tp3=(39.1, 38), tp3r=None, ftr=None,
      ast=(26.4, 38), tov=(8.1, 38), ator=(2.9, 38), oreb=(12.5, 38),
      stl=(3.2, 38), blk=(3.8, 38), dreb=(21.3, 38),
      bpm=(18.7, 38), obpm=(12.7, 38), dbpm=(6.0, 38),
      wing=(85.5, None), reach=(108, None), height=(80.25, None), weight=(253, None), vert=(35.0, None),
    ),
    bpm_torvik=20.1, usg_torvik=None,
    scouting="The class's best analytic profile: elite efficiency at high usage (.653 TS%), the "
      "class-best impact number (18.7 BPM Sports-Reference / 20.1 Torvik), strong stocks (3.2% "
      "STL, 3.8% BLK), elite turnover economy (8.1% TOV%), and hub-level passing for a big (26.4% "
      "AST%). Swept every NCAA National Player of the Year award as a freshman. The flags are "
      "modest run-jump athleticism (35\" vertical) and positional size (6'8.25\") for a franchise "
      "big - the highest floor in the class, ceiling capped mostly by role fit.",
  ),

  dict(
    id="caleb_wilson", name="Caleb Wilson", college="North Carolina", pos="Wing", conference="ACC",
    archetype="Two-Way Shot-Creating Wing",
    draft_pick=4, draft_team="Chicago Bulls",
    birthdate=_dt.date(2006, 7, 18), sos_rank=76, sos_asof="2026-07-07",
    gp=24, line=dict(ppg=19.8, rpg=9.4, apg=2.7, tpg=None),
    m=dict(
      ts=(0.626, 24), efg=(59.0, 24), ortg=(127.7, 24), per=(31.4, 24), usg=(28.8, 24),
      ft=(71.3, 24), tp3=(25.9, 24), tp3r=None, ftr=(61.6, 24),
      ast=(18.1, 24), tov=(8.9, 24), ator=(1.48, 24), oreb=(10.5, 24),
      stl=(2.8, 24), blk=(4.4, 24), dreb=(22.2, 24),
      bpm=(12.8, 24), obpm=(8.3, 24), dbpm=(4.7, 24),
      wing=(84.25, None), reach=(108, None), height=(81.25, None), weight=(210.8, None), vert=(39.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Elite defensive tools for a forward - strong steal (2.8%) and block (4.4%) rates, plus "
      "productive rebounding on both ends (10.5% OREB, 22.2% DREB) and efficient rim scoring (57.8% FG). "
      "Season cut short at 24 games by thumb surgery. The swing skill is shooting: a 25.9% clip on low "
      "3-point volume, offset by a merely functional 71.3% FT, leaves his perimeter jumper as the main "
      "development question.",
  ),  # sources: draftballr.com/players/caleb-wilson, sports-reference.com, espn.com, wikipedia.org, tankathon.com

  dict(
    id="keaton_wagler", name="Keaton Wagler", college="Illinois", pos="Guard", conference="Big Ten",
    archetype="Lead Creator / Shot Creator",
    draft_pick=5, draft_team="LA Clippers",
    birthdate=_dt.date(2007, 2, 3), sos_rank=308, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=17.9, rpg=5.1, apg=4.2, tpg=None),
    m=dict(
      ts=(0.596, 37), efg=(54.1, 37), ortg=None, per=(23.9, 37), usg=(25.7, 37),
      ft=(79.6, 37), tp3=(39.7, 37), tp3r=None, ftr=None,
      ast=(23.2, 37), tov=(7.5, 37), ator=(2.48, 37), oreb=(6.7, 37),
      stl=(1.7, 37), blk=(1.3, 37), dreb=(10.0, 37),
      bpm=(9.4, 37), obpm=(8.5, 37), dbpm=(2.9, 37),
      wing=(78.25, None), reach=(100, None), height=(77, None), weight=(188.0, None), vert=(36.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="An efficient, high-feel combo guard - 59.6% true shooting at 25.7% usage with a strong 23.2% "
      "assist rate, clean turnover economy (7.5% TOV%, 2.48 A/TO), and a 9.4 BPM. Shot 39.7% from three "
      "and 79.6% from the line, both clean signals for his outside shot.",
  ),  # sources: draftballr.com/players/keaton-wagler, tankathon.com, espn.com, sports-reference.com, cbssports.com

  dict(
    id="mikel_brown", name="Mikel Brown Jr.", college="Louisville", pos="Guard", conference="ACC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=6, draft_team="Brooklyn Nets",
    birthdate=_dt.date(2006, 4, 3), sos_rank=242, sos_asof="2026-07-07",
    gp=21, line=dict(ppg=18.2, rpg=3.3, apg=4.7, tpg=None),
    m=dict(
      ts=(0.577, 21), efg=(51.1, 21), ortg=None, per=None, usg=(31.0, 21),
      ft=(84.4, 21), tp3=(34.4, 21), tp3r=None, ftr=(44.7, 21),
      ast=(30.3, 21), tov=(11.8, 21), ator=(1.53, 21), oreb=(0.2, 21),
      stl=(2.4, 21), blk=(0.5, 21), dreb=(12.1, 21),
      bpm=(1.3, 21), obpm=(4.2, 21), dbpm=(1.2, 21),
      wing=(79.5, None), reach=(100.5, None), height=(75.5, None), weight=(190.2, None), vert=(39.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A dynamic scoring point guard - 18.2 PPG and a 30.3% assist rate at extremely high usage "
      "(31.0%), highlighted by a 45-point game that broke an ACC freshman scoring record. Turnover economy "
      "(11.8% TOV%) is more middling than dominant, and a modest overall BPM relative to his box-score "
      "volume, plus a back injury that limited him to 21 games, are the swing questions.",
  ),  # sources: draftballr.com/players/mikel-brown-jr, espn.com, wikipedia.org, floorandceiling.substack.com, on3.com, andscape.com

  dict(
    id="darius_acuff", name="Darius Acuff Jr.", college="Arkansas", pos="Guard", conference="SEC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=7, draft_team="Sacramento Kings",
    birthdate=_dt.date(2006, 11, 16), sos_rank=52, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=23.5, rpg=3.1, apg=6.4, tpg=None),
    m=dict(
      ts=(0.604, 36), efg=(56.1, 36), ortg=None, per=(25.2, 36), usg=(29.5, 36),
      ft=(80.9, 36), tp3=(44.0, 36), tp3r=None, ftr=(33.8, 36),
      ast=(32.2, 36), tov=(6.5, 36), ator=(3.1, 36), oreb=(1.6, 36),
      stl=(1.3, 36), blk=(0.9, 36), dreb=(8.3, 36),
      bpm=(6.6, 36), obpm=(9.0, 36), dbpm=(0.1, 36),
      wing=(78, None), reach=None, height=(75, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="SEC Player of the Year and Rookie of the Year as a true freshman - 23.5 PPG and a 32.2% "
      "assist rate at high usage (29.5%), with elite touch (80.9% FT, 44% on ~6 3PA/game) and excellent "
      "turnover economy (6.5% TOV%, 3.1 A/TO). The flags are physical: a 6'3\" frame with only a ~6'6\" "
      "wingspan and weak defensive stocks (1.3% STL, 0.9% BLK) cap his defensive floor.",
  ),  # sources: draftballr.com/players/darius-acuff-jr, espn.com, wikipedia.org, floorandceiling.substack.com, sports-reference.com

  dict(
    id="kingston_flemings", name="Kingston Flemings", college="Houston", pos="Guard", conference="Big 12",
    archetype="Lead Creator / Shot Creator",
    draft_pick=8, draft_team="Atlanta Hawks",
    birthdate=_dt.date(2007, 1, 3), sos_rank=229, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=16.1, rpg=4.1, apg=5.2, tpg=None),
    m=dict(
      ts=(0.563, 37), efg=(52.0, 37), ortg=(123.3, 37), per=(23.6, 37), usg=(26.5, 37),
      ft=None, tp3=(38.7, 37), tp3r=None, ftr=None,
      ast=(32.6, 37), tov=(7.5, 37), ator=(2.99, 37), oreb=(1.8, 37),
      stl=(3.0, 37), blk=(1.3, 37), dreb=(12.9, 37),
      bpm=(9.5, 37), obpm=(6.3, 37), dbpm=(5.2, 37),
      wing=(75.5, None), reach=(98.5, None), height=(74.5, None), weight=(183.4, None), vert=(40.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A true lead guard - 16.1 PPG, 5.2 APG, and a strong 32.6% assist rate at high offensive "
      "efficiency (123.3 ORtg) with clean turnover economy (7.5% TOV%) and good stocks (3.0% STL). "
      "All-Big 12 First Team as a freshman. The physical profile is the concern: at 6'2.5\" with a "
      "6'3.5\" wingspan, he had the shortest wingspan of any guard prospect evaluated at the combine, "
      "which strong athletic testing (40.5\" max vertical) only partly offsets.",
  ),  # sources: draftballr.com/players/kingston-flemings, tankathon.com, si.com, x.com/DraftExpress, floorandceiling.substack.com

  dict(
    id="morez_johnson", name="Morez Johnson Jr.", college="Michigan", pos="Big", conference="Big Ten",
    archetype="Rim-Running / Lob Big",
    draft_pick=9, draft_team="Dallas Mavericks",
    birthdate=_dt.date(2006, 1, 25), sos_rank=78, sos_asof="2026-07-07",
    gp=40, line=dict(ppg=13.1, rpg=7.3, apg=1.2, tpg=None),
    m=dict(
      ts=(0.677, 40), efg=(64.2, 40), ortg=None, per=None, usg=(21.1, 40),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(8.4, 40), tov=(10.5, 40), ator=(0.96, 40), oreb=(12.8, 40),
      stl=(1.5, 40), blk=(4.8, 40), dreb=(18.9, 40),
      bpm=(10.2, 40), obpm=(5.8, 40), dbpm=(4.5, 40),
      wing=(87.5, None), reach=(107, None), height=(81, None), weight=(250.6, None), vert=(39.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A hyper-efficient finisher and rebounder - 67.7% true shooting on modest usage (21.1%), "
      "with elite offensive (12.8%) and strong defensive (18.9%) rebounding rates, plus a real shot-"
      "blocking rate (4.8% BLK) for a play-finishing big. Helped Michigan to a national championship and "
      "earned All-Big Ten Defensive Team honors. A modest assist rate (8.4%) and minimal shot creation "
      "confirm a play-finisher/rim-runner profile rather than a shot-creator.",
  ),  # sources: draftballr.com/players/morez-johnson-jr, wikipedia.org, espn.com, floorandceiling.substack.com

  dict(
    id="brayden_burries", name="Brayden Burries", college="Arizona", pos="Guard", conference="Big 12",
    archetype="3-and-D Wing",
    draft_pick=10, draft_team="Milwaukee Bucks",
    birthdate=_dt.date(2005, 9, 18), sos_rank=126, sos_asof="2026-07-07",
    gp=39, line=dict(ppg=16.1, rpg=4.9, apg=2.4, tpg=None),
    m=dict(
      ts=(0.616, 39), efg=(57.2, 39), ortg=None, per=None, usg=(21.6, 39),
      ft=(80.5, 39), tp3=(39.1, 39), tp3r=None, ftr=None,
      ast=(14.2, 39), tov=(7.8, 39), ator=(1.78, 39), oreb=(2.1, 39),
      stl=(2.8, 39), blk=(0.7, 39), dreb=(14.5, 39),
      bpm=(4.9, 39), obpm=(5.6, 39), dbpm=(5.0, 39),
      wing=(78, None), reach=(98.5, None), height=(75.75, None), weight=(215.4, None), vert=(38.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="An efficient scoring guard on modest usage - 61.6% true shooting with a strong 3-point clip "
      "(39.1%) and excellent turnover economy (7.8% TOV%), plus a solid 2.8% steal rate. He's notably "
      "older than most of this class (turned 20 during the season) and his 14.2% assist rate is thin for "
      "a guard, pointing to more of an off-ball scoring role than lead creation at the next level.",
  ),  # sources: draftballr.com/players/brayden-burries, espn.com, wikipedia.org, floorandceiling.substack.com, tankathon.com

  dict(
    id="yaxel_lendeborg", name="Yaxel Lendeborg", college="Michigan", pos="Wing", conference="Big Ten",
    archetype="Connector / Low-Usage Glue",
    draft_pick=11, draft_team="Golden State Warriors",
    birthdate=_dt.date(2002, 9, 30), sos_rank=78, sos_asof="2026-07-07",
    gp=40, line=dict(ppg=15.1, rpg=6.8, apg=3.2, tpg=None),
    m=dict(
      ts=(0.646, 40), efg=(60.2, 40), ortg=(141.5, 40), per=(25.4, 40), usg=(20.5, 40),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(18.0, 40), tov=(6.0, 40), ator=(3.1, 40), oreb=(8.0, 40),
      stl=(2.1, 40), blk=(4.4, 40), dreb=(16.0, 40),
      bpm=(15.2, 40), obpm=(9.3, 40), dbpm=(6.0, 40),
      wing=(87.25, None), reach=(108.5, None), height=(80.75, None), weight=(241.4, None), vert=(32.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Big Ten Player of the Year as a graduate transfer from UAB - elite efficiency at modest "
      "usage (64.6% TS on 20.5% USG), a 141.5 ORtg, and a well-rounded box score (15.1/6.8/3.2) that "
      "helped Michigan win the national title. Elite turnover economy (6.0% TOV%, 3.1 A/TO) and strong "
      "two-way impact (15.2 BPM) round out one of the best all-around profiles in this class. The obvious "
      "caveat is age: at roughly 23.4 on draft night, he's several years older than the freshmen atop this "
      "board, which tempers how much of this production should be expected to translate.",
  ),  # sources: draftballr.com/players/yaxel-lendeborg, wikipedia.org, noceilingsnba.com, foxsports.com, tankathon.com

  dict(
    id="aday_mara", name="Aday Mara", college="Michigan", pos="Big", conference="Big Ten",
    archetype="Offensive Hub Big",
    draft_pick=12, draft_team="Oklahoma City Thunder",
    birthdate=_dt.date(2005, 4, 7), sos_rank=78, sos_asof="2026-07-07",
    gp=40, line=dict(ppg=12.1, rpg=6.8, apg=2.4, tpg=None),
    m=dict(
      ts=(0.658, 40), efg=(67.3, 40), ortg=None, per=(26.2, 40), usg=(23.8, 40),
      ft=(56.4, 40), tp3=(30.0, 40), tp3r=None, ftr=None,
      ast=(19.0, 40), tov=(14.4, 40), ator=(1.29, 40), oreb=(10.4, 40),
      stl=(0.8, 40), blk=(12.0, 40), dreb=(20.4, 40),
      bpm=(6.3, 40), obpm=(0.9, 40), dbpm=(5.4, 40),
      wing=(90, None), reach=(117, None), height=(87, None), weight=(260, None), vert=(28.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Historic physical tools - a 7'6\" wingspan and 9'9\" standing reach, tied for the "
      "second-longest reach in combine history - paired with real passing feel for a center (19.0% "
      "AST%) and elite rim protection (12.0% BLK%, Big Ten Defensive Player of the Year). The high "
      "turnover rate (14.4% TOV) and modest 56.4% FT are the clearest flags; efficiency (65.8% TS, 67.3% "
      "eFG) is otherwise excellent.",
  ),  # sources: draftballr.com/players/aday-mara, espn.com, x.com/DraftExpress, foxsports.com, tankathon.com

  dict(
    id="nate_ament", name="Nate Ament", college="Tennessee", pos="Wing", conference="SEC",
    archetype="3-and-D Wing",
    draft_pick=13, draft_team="Milwaukee Bucks",
    birthdate=_dt.date(2006, 12, 10), sos_rank=269, sos_asof="2026-07-07",
    gp=35, line=dict(ppg=16.7, rpg=6.3, apg=2.3, tpg=None),
    m=dict(
      ts=(0.534, 35), efg=(45.2, 35), ortg=None, per=(20.4, 35), usg=(27.8, 35),
      ft=(79.0, 35), tp3=(33.3, 35), tp3r=None, ftr=None,
      ast=(14.8, 35), tov=(10.7, 35), ator=(1.05, 35), oreb=(6.7, 35),
      stl=(1.9, 35), blk=(2.7, 35), dreb=(17.0, 35),
      bpm=(5.1, 35), obpm=(4.6, 35), dbpm=(2.8, 35),
      wing=(85, None), reach=(108, None), height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A high-usage (27.8%) wing scorer who started all 35 games, averaging 16.7/6.3/2.3 with 196 "
      "made free throws (3rd-most in Tennessee history) and a 7'1\" wingspan that supports his defensive "
      "upside. Modest playmaking (14.8% AST%) and ball security (10.7% TOV%), plus real activity on "
      "defense (1.9% STL, 2.7% BLK). Efficiency (53.4% TS, 45.2% eFG) is still the clearest developmental "
      "question given his scoring role. Reached Milwaukee via the Miami pick from the Giannis "
      "Antetokounmpo trade.",
  ),  # sources: draftballr.com/players/nate-ament, espn.com, wikipedia.org, foxsports.com, utsports.com

  dict(
    id="steinbach", name="Hannes Steinbach", college="Washington", pos="Big", conference="Big Ten",
    archetype="Offensive Hub Big",
    draft_pick=14, draft_team="Charlotte Hornets",
    birthdate=_dt.date(2006, 5, 1), sos_rank=360, sos_asof="2026-07-07",
    gp=30, line=dict(ppg=18.5, rpg=11.8, apg=1.6, tpg=None),
    m=dict(
      ts=(0.636, 30), efg=(60.2, 30), ortg=None, per=(28.0, 30), usg=(24.4, 30),
      ft=(75.9, 30), tp3=(34.0, 30), tp3r=None, ftr=None,
      ast=(9.1, 30), tov=(10.5, 30), ator=(0.85, 30), oreb=(14.3, 30),
      stl=(1.8, 30), blk=(3.9, 30), dreb=(25.0, 30),
      bpm=(5.0, 30), obpm=(7.1, 30), dbpm=(1.9, 30),
      wing=(86.25, None), reach=(108, None), height=(82.25, None), weight=(248, None), vert=(35.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Led all of Division I with 22 double-doubles as a true freshman and was the Big Ten's "
      "highest-scoring freshman (18.5 ppg), pairing plus efficiency (.636 TS%, 57.7% FG) with elite "
      "rebounding rates on both ends (25.0% DREB%, 14.3% OREB%). A quiet passer (9.1% AST%) for a "
      "high-usage big; how his handle and playmaking scale up will shape his offensive role next.",
  ),  # sources: draftballr.com/players/hannes-steinbach, gohuskies.com, nba.com/draft, espn.com

  dict(
    id="swain", name="Dailyn Swain", college="Texas", pos="Wing", conference="SEC",
    archetype="3-and-D Wing",
    draft_pick=15, draft_team="Chicago Bulls",
    birthdate=_dt.date(2005, 7, 15), sos_rank=332, sos_asof="2026-07-07",
    gp=35, line=dict(ppg=17.3, rpg=7.5, apg=3.6, tpg=None),
    m=dict(
      ts=(0.633, 35), efg=(57.8, 35), ortg=None, per=(25.0, 35), usg=(25.5, 35),
      ft=(81.5, 35), tp3=(34.4, 35), tp3r=None, ftr=(51.6, 35),
      ast=(21.3, 35), tov=(12.7, 35), ator=(1.37, 35), oreb=(6.2, 35),
      stl=(2.8, 35), blk=(1.0, 35), dreb=(20.7, 35),
      bpm=(3.6, 35), obpm=(6.7, 35), dbpm=(3.0, 35),
      wing=(82, None), reach=(104.5, None), height=(78.5, None), weight=(211.2, None), vert=(36.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Became the third SEC player in 30 years to average 17+ points, 7+ rebounds and 3+ "
      "assists on 50%+ shooting, in his lone season at Texas after transferring from Xavier - legitimate "
      "three-level scoring (54.2% FG, 34.4% 3P, 81.5% FT) with real passing feel for his size (21.3% "
      "AST%) and above-average defensive activity (2.8% STL%).",
  ),  # sources: draftballr.com/players/dailyn-swain, espn.com, texaslonghorns.com, si.com

  dict(
    id="stirtz", name="Bennett Stirtz", college="Iowa", pos="Guard", conference="Big Ten",
    archetype="Lead Creator / Shot Creator",
    draft_pick=16, draft_team="Oklahoma City Thunder",
    birthdate=_dt.date(2003, 10, 3), sos_rank=280, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=19.8, rpg=2.6, apg=4.4, tpg=None),
    m=dict(
      ts=(0.607, 37), efg=(56.5, 37), ortg=(125.8, 37), per=(22.3, 37), usg=(26.1, 37),
      ft=(84.8, 37), tp3=(35.8, 37), tp3r=None, ftr=None,
      ast=(24.9, 37), tov=(7.4, 37), ator=(2.48, 37), oreb=(1.0, 37),
      stl=(2.3, 37), blk=(0.9, 37), dreb=(8.7, 37),
      bpm=(0.06, 37), obpm=(7.3, 37), dbpm=(2.0, 37),
      wing=(78, None), reach=(98.5, None), height=(74.5, None), weight=(186.2, None), vert=(37.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A 22-year-old grad transfer (Northwest Missouri State to Drake to Iowa) whose age is the "
      "central caveat on an otherwise loud statistical profile: 19.8 ppg on plus efficiency (.565 eFG%, "
      "84.8% FT), elite turnover economy (7.4% TOV%), and a well-rounded line (4.4 apg, 24.9% AST%). "
      "The open question the box score can't answer is how much of this was an age/experience edge "
      "over younger Big Ten defenders.",
  ),  # sources: draftballr.com/players/bennett-stirtz, hawkeyesports.com, si.com, wikipedia.org

  dict(
    id="okorie", name="Ebuka Okorie", college="Stanford", pos="Guard", conference="ACC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=17, draft_team="Detroit Pistons",
    birthdate=_dt.date(2007, 4, 10), sos_rank=131, sos_asof="2026-07-07",
    gp=31, line=dict(ppg=23.2, rpg=3.6, apg=3.6, tpg=None),
    m=dict(
      ts=(0.589, 31), efg=(52.8, 31), ortg=(126.2, 31), per=(26.5, 31), usg=(30.1, 31),
      ft=(83.2, 31), tp3=(35.4, 31), tp3r=None, ftr=None,
      ast=(23.9, 31), tov=(10.4, 31), ator=(1.96, 31), oreb=(2.4, 31),
      stl=(2.7, 31), blk=(1.0, 31), dreb=(10.3, 31),
      bpm=(8.6, 31), obpm=(8.1, 31), dbpm=(1.6, 31),
      wing=(79.75, None), reach=(98, None), height=(73.25, None), weight=(186, None), vert=(37.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Led the ACC in scoring as a true freshman (23.2 ppg, seventh nationally) on heavy usage "
      "(30.1%) with strong efficiency (.589 TS%) and clean turnover economy (10.4 TOV%) for a lead guard. "
      "Good stocks for a small guard (2.7% STL, 1.0% BLK) but undersized (6'1.25\" barefoot, sub-8'2\" "
      "reach) relative to the defensive workload a lead guard eventually draws.",
  ),  # sources: draftballr.com/players/ebuka-okorie, gostanford.com, si.com, foxsports.com

  dict(
    id="canderson", name="Christian Anderson Jr.", college="Texas Tech", pos="Guard", conference="Big 12",
    archetype="Lead Creator / Shot Creator",
    draft_pick=18, draft_team="Charlotte Hornets",
    birthdate=_dt.date(2006, 4, 2), sos_rank=146, sos_asof="2026-07-07",
    gp=33, line=dict(ppg=18.5, rpg=3.6, apg=7.4, tpg=None),
    m=dict(
      ts=(0.626, 33), efg=(59.7, 33), ortg=None, per=None, usg=(25.2, 33),
      ft=(80.5, 33), tp3=(41.5, 33), tp3r=None, ftr=None,
      ast=(35.2, 33), tov=(11.6, 33), ator=(2.27, 33), oreb=(1.8, 33),
      stl=(2.2, 33), blk=(0.7, 33), dreb=(8.5, 33),
      bpm=(8.4, 33), obpm=(6.8, 33), dbpm=(1.6, 33),
      wing=(78.25, None), reach=(96.5, None), height=(73, None), weight=(180.4, None), vert=(40.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Big 12 Most Improved Player and a third-team All-American as a sophomore, leading the "
      "conference in assists (7.4 apg, 35.2% AST% - elite for a guard) while scoring 18.5 a game on "
      "strong efficiency (.626 TS%, 41.5% on 3s, 80.5% FT). A 40.5\" max vertical stands out; defensive "
      "stocks (2.2% STL, 0.7% BLK) are middling for his usage.",
  ),  # sources: draftballr.com/players/christian-anderson, texastech.com, espn.com, noceilingsnba.com

  dict(
    id="graves", name="Allen Graves", college="Santa Clara", pos="Big", conference="West Coast Conference",
    archetype="Stretch Big",
    draft_pick=19, draft_team="Toronto Raptors",
    birthdate=_dt.date(2006, 7, 28), sos_rank=187, sos_asof="2026-07-07",
    gp=35, line=dict(ppg=11.8, rpg=6.5, apg=1.8, tpg=None),
    m=dict(
      ts=(0.615, 35), efg=(58.2, 35), ortg=None, per=(29.6, 35), usg=(22.4, 35),
      ft=(75, 35), tp3=(41, 35), tp3r=None, ftr=None,
      ast=(13.8, 35), tov=(5.5, 35), ator=(2.6, 35), oreb=(13.9, 35),
      stl=(4.9, 35), blk=(5.0, 35), dreb=(20.0, 35),
      bpm=(12.8, 35), obpm=(8.6, 35), dbpm=(4.3, 35),
      wing=(84, None), reach=(106.5, None), height=(79.75, None), weight=(225.6, None), vert=(34.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A redshirt freshman who won WCC Freshman of the Year and Sixth Man of the Year: elite "
      "efficiency (.615 TS%, 29.6 PER), a rare all-around defensive/rebounding profile for a stretch "
      "big (4.9% STL, 5.0% BLK, 13.9% OREB - each at or near the 99th percentile), and the best "
      "turnover economy in this class (5.5% TOV%). Efficient on all three levels (51% FG, 41% 3P, 75% "
      "FT) with a 7'0\" wingspan. The real caveat is competition level - a mid-major bench role, not "
      "high-major minutes.",
  ),  # sources: draftballr.com/players/allen-graves, santaclarabroncos.com, DRAFT_SAVANT_RESEARCH.md

  dict(
    id="quaintance", name="Jayden Quaintance", college="Kentucky", pos="Big", conference="SEC",
    archetype="Rim Protector / Anchor",
    draft_pick=20, draft_team="San Antonio Spurs",
    birthdate=_dt.date(2007, 7, 11), sos_rank=213, sos_asof="2026-07-07",
    gp=4, line=dict(ppg=5.0, rpg=5.0, apg=0.5, tpg=None),
    m=dict(
      ts=(0.496, 4), efg=(57.1, 4), ortg=None, per=None, usg=(20.9, 4),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(5.1, 4), tov=(23.0, 4), ator=(0.37, 4), oreb=(13.6, 4),
      stl=(1.7, 4), blk=(5.0, 4), dreb=(19.5, 4),
      bpm=(0.6, 4), obpm=(-0.6, 4), dbpm=(1.2, 4),
      wing=(88.5, None), reach=(109, None), height=(80.25, None), weight=(253, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Played just 4 games before a torn ACL/meniscus ended his season in February - by far the "
      "smallest sample in this class, so every rate stat above (all flagged small-sample) is closer to "
      "noise than signal. What's real: he arrived at Arizona State at 16 and played his entire "
      "underclass college career (Arizona State, then Kentucky) as a 17-year-old, and his measurements "
      "are exceptional for a modern anchor - a 7'4.5\" wingspan and 9'1\" reach on a 6'8.25\" frame. The "
      "medical timeline, not the stat line, is the story here.",
  ),  # sources: draftballr.com/players/jayden-quaintance, wikipedia.org, on3.com, DRAFT_SAVANT_RESEARCH.md

  dict(
    id="lopez", name="Karim López", college="New Zealand Breakers (NBL, not NCAA)", pos="Wing", conference=None,
    archetype="Two-Way Shot-Creating Wing",
    draft_pick=21, draft_team="Memphis Grizzlies",
    birthdate=_dt.date(2007, 4, 12), sos_rank=None, sos_asof=None,
    gp=None, line=dict(ppg=11.9, rpg=6.1, apg=1.9, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=(83.5, None), reach=(105.5, None), height=(80.25, None), weight=(222, None), vert=(38.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A Mexican wing who played 2025-26 for the New Zealand Breakers (NBL Next Star pathway) "
      "rather than college, averaging 11.9 ppg/6.1 rpg/1.9 apg on 49% FG against a senior pro league. "
      "No KenPom/NCAA advanced-stat pipeline exists for his profile (DraftBallr also has no linked "
      "stat data for him), so this card leans almost entirely on measurables - 6'11.5\" wingspan and "
      "8'9.5\" reach on a 6'8.25\" frame - and per-game production.",
  ),  # sources: nzbreakers.basketball, wikipedia.org, nbl.com.au — draftballr.com checked, no real stat data

  dict(
    id="philon", name="Labaron Philon Jr.", college="Alabama", pos="Guard", conference="SEC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=22, draft_team="Philadelphia 76ers",
    birthdate=_dt.date(2005, 11, 24), sos_rank=155, sos_asof="2026-07-07",
    gp=33, line=dict(ppg=22.0, rpg=3.5, apg=5.0, tpg=None),
    m=dict(
      ts=(0.626, 33), efg=(58.5, 33), ortg=None, per=(25.9, 33), usg=(29.9, 33),
      ft=(79.8, 33), tp3=(39.9, 33), tp3r=None, ftr=(40.8, 33),
      ast=(31.9, 33), tov=(8.8, 33), ator=(2.06, 33), oreb=(1.9, 33),
      stl=(2.0, 33), blk=(0.5, 33), dreb=(9.2, 33),
      bpm=(5.2, 33), obpm=(9.2, 33), dbpm=(-0.9, 33),
      wing=(78.25, None), reach=(99.5, None), height=(74.5, None), weight=(176.2, None), vert=(35.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="The only D-I player to average 22.0 points and 5.0 assists on 50%+ shooting, with an "
      "elite 31.9% assist rate at high usage (29.9%) that marks him as a true offensive engine, and "
      "clean turnover economy for that role (8.8% TOV%, not the flag it first looked like). The real "
      "questions are defensive: modest stocks (2.0% STL, 0.5% BLK) and a negative DBPM for a 6'2.5\" "
      "guard asked to check ball-handlers.",
  ),  # sources: draftballr.com/players/labaron-philon, rolltide.com, wikipedia.org — TOV% revised from an earlier 15.2 estimate to a confirmed 8.8

  dict(
    id="ejiofor", name="Zuby Ejiofor", college="St. John's", pos="Big", conference="Big East",
    archetype="Rim Protector / Anchor",
    draft_pick=23, draft_team="Atlanta Hawks",
    birthdate=_dt.date(2004, 4, 20), sos_rank=58, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=16.3, rpg=7.3, apg=3.5, tpg=None),
    m=dict(
      ts=(0.609, 37), efg=(56.0, 37), ortg=None, per=(27.7, 37), usg=(26.4, 37),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(23.0, 37), tov=(10.2, 37), ator=(1.80, 37), oreb=(12.1, 37),
      stl=(2.2, 37), blk=(7.2, 37), dreb=(14.7, 37),
      bpm=(5.2, 37), obpm=(8.2, 37), dbpm=(5.5, 37),
      wing=(86, None), reach=None, height=(79.5, None), weight=(245.2, None), vert=(38.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Big East Player of the Year, Defensive Player of the Year, and Academic Player of the Year "
      "in the same season - the only high-major player in the country to lead his team and rank top-10 "
      "in his conference in scoring, rebounding, assists and blocks (16.3/7.3/3.5/2.2). Elite block rate "
      "(7.2%) and assist rate for a big (23.0%) stand out; plus efficiency (.609 TS%) and a 7'2\" "
      "wingspan round out a well-rounded two-way profile.",
  ),  # sources: draftballr.com/players/zuby-ejiofor, redstormsports.com, bigeast.com

  dict(
    id="carr", name="Cameron Carr", college="Baylor", pos="Guard", conference="Big 12",
    archetype="3-and-D Wing",
    draft_pick=24, draft_team="LA Lakers",
    birthdate=_dt.date(2004, 11, 21), sos_rank=347, sos_asof="2026-07-07",
    gp=34, line=dict(ppg=18.9, rpg=5.8, apg=2.6, tpg=None),
    m=dict(
      ts=(0.618, 34), efg=(57.6, 34), ortg=None, per=(22.0, 34), usg=(24.3, 34),
      ft=(80.5, 34), tp3=(37.6, 34), tp3r=(48.7, 34), ftr=(38.3, 34),
      ast=(13.7, 34), tov=None, ator=(1.134, 34), oreb=None,
      stl=(1.6, 34), blk=(3.9, 34), dreb=(17.6, 34),
      bpm=(0.7, 34), obpm=None, dbpm=None,
      wing=(84.75, None), reach=(104, None), height=(76.5, None), weight=(184.4, None), vert=(42.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Set Baylor's single-season scoring record for a sophomore (642 points, 18.9 ppg) on "
      "plus efficiency (61.8% TS, 57.6% eFG) and explosive tools - a 42.5\" max vertical and a "
      "7'0.75\" wingspan on a 6'4.5\" frame give him real defensive-playmaking upside (elite 3.9% "
      "block rate for a guard). Third-Team All-Big 12. Modest usage (24.3%) and assist rate (13.7%) "
      "suggest more off-ball scorer than lead ball-handler at the next level; he's also a thin 184 lbs.",
  ),  # sources: draftballr.com/players/cameron-carr, baylorbears.com, espn.com — OBPM/DBPM extraction was garbled on the DraftBallr page, left None rather than guess

  dict(
    id="delarrea", name="Sergio de Larrea", college="Valencia Basket (Spain ACB, not NCAA)", pos="Guard", conference=None,
    archetype="Lead Creator / Shot Creator",
    draft_pick=25, draft_team="Dallas Mavericks",
    birthdate=_dt.date(2005, 12, 4), sos_rank=None, sos_asof=None,
    gp=34, line=dict(ppg=9.6, rpg=3.0, apg=3.7, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=(81.3, 34), tp3=(40.7, 34), tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=(81.0, None), reach=(100.2, None), height=(78.0, None), weight=(204, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Not a college prospect - plays professionally for Valencia Basket in Spain's ACB/"
      "EuroLeague, so this profile sits outside the NCAA pool it's being compared against. Named "
      "2025-26 Liga Endesa Best Young Player in a limited ~18 min/game bench role (9.6/3.0/3.7), "
      "with clean touch (81.3% FT, 40.7% 3P) and real playmaking feel for his age. Advanced rate "
      "stats aren't tracked the same way in ACB (checked draftballr.com - profile exists but shows "
      "only placeholder zeros), so they're blank here rather than approximated.",
  ),  # sources: en.wikipedia.org, valenciabasket.com, sports.yahoo.com, nba.com/draft — draftballr.com checked, no real stats

  dict(
    id="reed", name="Tarris Reed Jr.", college="UConn", pos="Big", conference="Big East",
    archetype="Rim-Running / Lob Big",
    draft_pick=26, draft_team="San Antonio Spurs",
    birthdate=_dt.date(2003, 8, 5), sos_rank=45, sos_asof="2026-07-07",
    gp=35, line=dict(ppg=14.7, rpg=9.0, apg=2.3, tpg=None),
    m=dict(
      ts=(0.614, 35), efg=(60.7, 35), ortg=None, per=None, usg=(26.5, 35),
      ft=None, tp3=None, tp3r=(1.6, 35), ftr=(44.5, 35),
      ast=(17.8, 35), tov=(11.6, 35), ator=(1.288, 35), oreb=(14.2, 35),
      stl=(2.0, 35), blk=(8.4, 35), dreb=(24.5, 35),
      bpm=(11.7, 35), obpm=(6.3, 35), dbpm=(5.5, 35),
      wing=(88.25, None), reach=(110, None), height=(81.75, None), weight=(263.6, None), vert=(33.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Elite finishing efficiency (61.4% TS, nation-leading 60.7% FG) and rebounding (9.0 "
      "RPG, 14 double-doubles, 24.5% DREB) anchored UConn's Big East title run - First Team All-Big "
      "East and NCAA Tournament East Region Most Outstanding Player. An 8.4% block rate and 17.8% "
      "assist rate for a center are both plus signals. Excellent length at the combine (7'4.25\" "
      "wingspan, 9'2\" reach) offset by a modest 33\" max vertical; a four-year college player "
      "entering the league already 22.",
  ),  # sources: draftballr.com/players/tarris-reed-jr, uconnhuskies.com, espn.com, en.wikipedia.org

  dict(
    id="cenac", name="Chris Cenac Jr.", college="Houston", pos="Big", conference="Big 12",
    archetype="Rim-Running / Lob Big",
    draft_pick=27, draft_team="Boston Celtics",
    birthdate=_dt.date(2007, 2, 1), sos_rank=229, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=9.5, rpg=7.9, apg=0.7, tpg=None),
    m=dict(
      ts=(0.546, 37), efg=(53.6, 37), ortg=(118.0, 37), per=(19.3, 37), usg=(19.5, 37),
      ft=(62.1, 37), tp3=(33.3, 37), tp3r=None, ftr=(19.7, 37),
      ast=(5.5, 37), tov=None, ator=(0.848, 37), oreb=(10.1, 37),
      stl=(1.9, 37), blk=(2.6, 37), dreb=(26.1, 37),
      bpm=(4.5, 37), obpm=(3.1, 37), dbpm=(3.1, 37),
      wing=(88.0, None), reach=None, height=(83.0, None), weight=(240, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="First Houston freshman to lead the team in rebounding since 2011-12 (7.9 RPG, 26.1% "
      "DREB, 13 double-digit rebounding games), with plus length (6'11\", 7'4\" wingspan). A "
      "low-usage, low-touch role as a freshman (9.5 PPG, 19.5% usage, 5.5% AST) means the offensive "
      "role and shot-creation projection are largely unproven.",
  ),  # sources: draftballr.com/players/chris-cenac-jr, uhcougars.com, espn.com, en.wikipedia.org

  dict(
    id="jefferson", name="Joshua Jefferson", college="Iowa State", pos="Big", conference="Big 12",
    archetype="Connector / Low-Usage Glue",
    draft_pick=28, draft_team="Brooklyn Nets",
    birthdate=_dt.date(2003, 11, 21), sos_rank=231, sos_asof="2026-07-07",
    gp=35, line=dict(ppg=16.4, rpg=7.4, apg=4.8, tpg=2.5),
    m=dict(
      ts=(0.560, 35), efg=(51.7, 35), ortg=None, per=None, usg=(28.6, 35),
      ft=(70.0, 35), tp3=(34.5, 35), tp3r=(27.3, 35), ftr=(51.7, 35),
      ast=(27.7, 35), tov=(10.4, 35), ator=(1.995, 35), oreb=(7.2, 35),
      stl=(3.1, 35), blk=(3.4, 35), dreb=(21.8, 35),
      bpm=(2.8, 35), obpm=(6.2, 35), dbpm=(5.6, 35),
      wing=(82.75, None), reach=None, height=(79.75, None), weight=(246.2, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="First player in Big 12 history to reach 450+ points, 250+ rebounds, 100+ assists, "
      "70+ steals, and 25+ blocks in a season - a rare five-way stat-stuffer at forward. The 27.7% "
      "assist rate and 3.1% steal rate are well above the norm for his size (off-position skills "
      "the research literature flags as underrated); shooting (34.5% 3P, 70.0% FT) is the swing "
      "skill. A four-year college player (also played at Saint Mary's) entering the league already "
      "22.",
  ),  # sources: draftballr.com/players/joshua-jefferson, en.wikipedia.org, zonecoverage.com, cyclones.com

  dict(
    id="karaban", name="Alex Karaban", college="UConn", pos="Wing", conference="Big East",
    archetype="3-and-D Wing",
    draft_pick=29, draft_team="Sacramento Kings",
    birthdate=_dt.date(2002, 11, 11), sos_rank=45, sos_asof="2026-07-07",
    gp=40, line=dict(ppg=13.2, rpg=5.3, apg=2.4, tpg=None),
    m=dict(
      ts=(0.590, 40), efg=(55.9, 40), ortg=None, per=None, usg=(17.6, 40),
      ft=(85.1, 40), tp3=(37.4, 40), tp3r=(51.5, 40), ftr=(21.5, 40),
      ast=(12.4, 40), tov=(7.0, 40), ator=(2.298, 40), oreb=(6.4, 40),
      stl=(1.5, 40), blk=(2.8, 40), dreb=(11.8, 40),
      bpm=(7.9, 40), obpm=(5.0, 40), dbpm=(3.0, 40),
      wing=(83.0, None), reach=(104.5, None), height=(78.75, None), weight=(225.2, None), vert=(33.0, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Reliable, low-mistake 3-and-D wing (85.1% FT, 37.4% 3P, elite 7.0% TOV%) who started "
      "all 40 games in his fourth UConn season. Combine tools are average for the position (6'11\" "
      "wingspan on a 6'6.75\" frame) but his standing vertical improved notably from his 2024 combine "
      "reading. Low usage (17.6%) confirms a connector/complementary role rather than a shot-creator.",
  ),  # sources: draftballr.com/players/alex-karaban, uconnhuskies.com, espn.com, en.wikipedia.org

  dict(
    id="peat", name="Koa Peat", college="Arizona", pos="Big", conference="Big 12",
    archetype="Offensive Hub Big",
    draft_pick=30, draft_team="Phoenix Suns",
    birthdate=_dt.date(2007, 1, 20), sos_rank=126, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=14.1, rpg=5.6, apg=2.6, tpg=None),
    m=dict(
      ts=(0.557, 36), efg=(53.7, 36), ortg=None, per=(20.5, 36), usg=(24.4, 36),
      ft=(62.3, 36), tp3=(35.0, 36), tp3r=(5.6, 36), ftr=(42.7, 36),
      ast=(16.7, 36), tov=(9.2, 36), ator=(1.687, 36), oreb=(9.1, 36),
      stl=(1.3, 36), blk=(2.5, 36), dreb=(12.5, 36),
      bpm=(5.7, 36), obpm=(4.4, 36), dbpm=(3.2, 36),
      wing=(83.25, None), reach=None, height=(79.0, None), weight=(245.0, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Physical, high-usage freshman forward (14.1/5.6/2.6, 24.4% usage) with good size and "
      "length for the position (6'11.25\" wingspan on a 6'7\", 245 lb frame) and a strong 16.7% "
      "assist rate for a big. All-Big 12 Third Team and Big 12 All-Freshman Team. Free-throw "
      "shooting (62.3%) is the clearest swing skill.",
  ),  # sources: draftballr.com/players/koa-peat, arizonawildcats.com, espn.com, en.wikipedia.org

  dict(
    id="thornton", name="Bruce Thornton", college="Ohio State", pos="Guard", conference="Big Ten",
    archetype="Lead Creator / Shot Creator",
    draft_pick=31, draft_team="Houston Rockets",
    birthdate=_dt.date(2003, 9, 14), sos_rank=303, sos_asof="2026-07-07",
    gp=34, line=dict(ppg=19.9, rpg=5.1, apg=3.9, tpg=None),
    m=dict(
      ts=(0.665, 34), efg=(62.6, 34), ortg=None, per=(25.9, 34), usg=(23.2, 34),
      ft=(82.9, 34), tp3=(40.0, 34), tp3r=(36.4, 34), ftr=(39.7, 34),
      ast=(21.9, 34), tov=(5.8, 34), ator=(3.093, 34), oreb=(3.3, 34),
      stl=(1.9, 34), blk=(0.8, 34), dreb=(13.5, 34),
      bpm=(2.6, 34), obpm=(9.0, 34), dbpm=(2.8, 34),
      wing=(77.0, None), reach=(96.5, None), height=(72.0, None), weight=(223.0, None), vert=(35.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Career-best fourth season as Ohio State's floor general (19.9/5.1/3.9 on 66.5% TS / "
      "40.0% 3P / 82.9% FT, elite 5.8% TOV% at real usage). Measured shorter than his college "
      "listing at the combine (6'0\" barefoot, 6'5\" wingspan), which caps his defensive positional "
      "versatility, but the scoring efficiency at high usage is real and translatable touch.",
  ),  # sources: draftballr.com/players/bruce-thornton, espn.com, ohiostatebuckeyes.com, en.wikipedia.org

  dict(
    id="saunders", name="Richie Saunders", college="BYU", pos="Guard", conference="Big 12",
    archetype="3-and-D Wing",
    draft_pick=32, draft_team="Memphis Grizzlies",
    birthdate=_dt.date(2001, 9, 19), sos_rank=253, sos_asof="2026-07-07",
    gp=25, line=dict(ppg=18.0, rpg=5.8, apg=2.1, tpg=None),
    m=dict(
      ts=(0.632, 25), efg=(59.3, 25), ortg=None, per=None, usg=(23.8, 25),
      ft=(81.7, 25), tp3=(37.6, 25), tp3r=None, ftr=(35.7, 25),
      ast=(12.2, 25), tov=(8.4, 25), ator=(1.354, 25), oreb=(6.7, 25),
      stl=(3.1, 25), blk=(1.0, 25), dreb=(13.5, 25),
      bpm=(9.1, 25), obpm=(7.2, 25), dbpm=(1.9, 25),
      wing=(80.75, None), reach=(102.5, None), height=(77.0, None), weight=(204.8, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Efficient breakout scorer (63.2% TS, 59.3% eFG, 18.0 PPG, strong 3.1% STL) whose "
      "season ended early on a Feb. 15, 2026 ACL tear (25 games) - he did not test athletically at "
      "the combine because of it. At 24+ on draft night he is by a wide margin the oldest player in "
      "this pool, and the ACL recovery is a real medical variable on top of that age.",
  ),  # sources: draftballr.com/players/richie-saunders, byucougars.com, espn.com, en.wikipedia.org

  dict(
    id="evans", name="Isaiah Evans", college="Duke", pos="Wing", conference="ACC",
    archetype="3-and-D Wing",
    draft_pick=33, draft_team="Minnesota Timberwolves",
    birthdate=_dt.date(2005, 12, 6), sos_rank=80, sos_asof="2026-07-07",
    gp=38, line=dict(ppg=15.0, rpg=3.2, apg=1.3, tpg=None),
    m=dict(
      ts=(0.590, 38), efg=(55.0, 38), ortg=None, per=(19.2, 38), usg=(21.8, 38),
      ft=(86.0, 38), tp3=(36.1, 38), tp3r=None, ftr=(26.5, 38),
      ast=(8.4, 38), tov=(7.3, 38), ator=(1.134, 38), oreb=(1.7, 38),
      stl=(1.5, 38), blk=(2.9, 38), dreb=(10.7, 38),
      bpm=(3.2, 38), obpm=(5.9, 38), dbpm=(2.5, 38),
      wing=(80.75, None), reach=(104.5, None), height=(77.5, None), weight=(186.0, None), vert=(35.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Sharpshooting wing (86.0% FT, 36.1% 3P) in his second Duke season, Third Team All-ACC "
      "with a 32-point ACC Tournament outburst against Florida State. Good length for a slight frame "
      "(6'8.75\" wingspan on 186 lbs) and a strong 35.5\" combine vertical, but a low-usage role "
      "(21.8% usage, 8.4% AST) means he projects as a complementary shooter more than a primary "
      "offensive engine.",
  ),  # sources: draftballr.com/players/isaiah-evans, goduke.com, espn.com, en.wikipedia.org

  dict(
    id="thomas_meleek", name="Meleek Thomas", college="Arkansas", pos="Guard", conference="SEC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=34, draft_team="Cleveland Cavaliers",
    birthdate=_dt.date(2006, 8, 6), sos_rank=52, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=15.6, rpg=3.8, apg=2.5, tpg=None),
    m=dict(
      ts=(0.559, 37), efg=(52.2, 37), ortg=None, per=None, usg=(22.1, 37),
      ft=(84.3, 37), tp3=(41.6, 37), tp3r=None, ftr=None,
      ast=(13.2, 37), tov=(5.3, 37), ator=(0.61, 37), oreb=(3.5, 37),
      stl=(2.8, 37), blk=(0.6, 37), dreb=(10.8, 37),
      bpm=(2.7, 37), obpm=(4.3, 37), dbpm=(1.6, 37),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Arkansas's No. 2 scoring option as a freshman (15.6 ppg), pairing plus 3-point "
      "shooting (41.6%) with elite free-throw touch (84.3%) and elite ball security (5.3% TOV% - "
      "99th percentile). Named SEC All-Freshman Team. The flag is playmaking: a 13.2% assist rate "
      "is thin for a combo guard, pointing to more of a scoring than table-setting role early on.",
  ),  # sources: draftballr.com/players/meleek-thomas, arkansasrazorbacks.com, espn.com, wikipedia.org

  dict(
    id="brazile_trevon", name="Trevon Brazile", college="Arkansas", pos="Big", conference="SEC",
    archetype="Rim Protector / Anchor",
    draft_pick=35, draft_team="Denver Nuggets",
    birthdate=_dt.date(2003, 1, 7), sos_rank=52, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=13.0, rpg=7.3, apg=1.6, tpg=None),
    m=dict(
      ts=(0.619, 36), efg=(59.5, 36), ortg=None, per=None, usg=(17.2, 36),
      ft=(71.7, 36), tp3=(34.1, 36), tp3r=None, ftr=None,
      ast=(7.6, 36), tov=(7.8, 36), ator=(1.584, 36), oreb=(5.8, 36),
      stl=(2.6, 36), blk=(5.2, 36), dreb=(20.6, 36),
      bpm=(-1.6, 36), obpm=(4.9, 36), dbpm=(3.4, 36),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="2026 SEC Defensive Player of the Year with elite rim finishing (65.3% on 2s) and "
      "rebounding (20.6% DREB%), plus a rare shooting touch for a big (34.1% on 3s). Notably old "
      "for a prospect - a fifth-year senior (~23 at draft) - which the age-curve research this "
      "project leans on treats as a real caveat on ceiling, and his low usage (17.2%) means the "
      "offensive role at the next level is still an open question.",
  ),  # sources: draftballr.com/players/trevon-brazile, wikipedia.org, espn.com, realgm.com

  dict(
    id="miller_baba", name="Baba Miller", college="Cincinnati", pos="Wing", conference="Big 12",
    archetype="Two-Way Shot-Creating Wing",
    draft_pick=36, draft_team="LA Clippers",
    birthdate=_dt.date(2004, 2, 7), sos_rank=339, sos_asof="2026-07-07",
    gp=31, line=dict(ppg=13.0, rpg=10.3, apg=3.7, tpg=None),
    m=dict(
      ts=(0.576, 31), efg=(54.6, 31), ortg=None, per=None, usg=(22.3, 31),
      ft=None, tp3=(19.2, 31), tp3r=None, ftr=None,
      ast=(23.3, 31), tov=(12.2, 31), ator=(1.797, 31), oreb=(8.3, 31),
      stl=(1.3, 31), blk=(4.2, 31), dreb=(27.7, 31),
      bpm=(8.6, 31), obpm=(3.1, 31), dbpm=(5.4, 31),
      wing=(85.75, None), reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="First Cincinnati player since Oscar Robertson to lead the team in points, rebounds, "
      "and assists in the same season (13.0/10.3/3.7). An elite passing rate for a forward (23.3% "
      "AST%, 98th percentile) and strong two-way rebounding/rim-protection rates (27.7% DREB%, "
      "4.2% BLK%) are the calling cards. The clear flag is perimeter shooting - just 19.2% on 3s.",
  ),  # sources: draftballr.com/players/baba-miller, gobearcats.com, wikipedia.org, tankathon.com, si.com

  dict(
    id="conwell_ryan", name="Ryan Conwell", college="Louisville", pos="Guard", conference="ACC",
    archetype="3-and-D Wing",
    draft_pick=37, draft_team="Miami Heat",
    birthdate=_dt.date(2004, 6, 15), sos_rank=242, sos_asof="2026-07-07",
    gp=34, line=dict(ppg=18.8, rpg=4.8, apg=2.7, tpg=None),
    m=dict(
      ts=(0.566, 34), efg=(52.1, 34), ortg=None, per=None, usg=(27.5, 34),
      ft=None, tp3=(34.5, 34), tp3r=None, ftr=None,
      ast=(16.5, 34), tov=(9.7, 34), ator=(1.215, 34), oreb=(2.3, 34),
      stl=(2.0, 34), blk=(0.6, 34), dreb=(14.4, 34),
      bpm=(5.942, 34), obpm=(4.346, 34), dbpm=(1.542, 34),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Louisville's go-to scorer as a senior (18.8 ppg, career-high 638 points) on heavy "
      "usage (27.5%) and 34.5% high-volume 3-point shooting. All-ACC Second Team. Playmaking "
      "(16.5% AST%) and defensive activity are secondary to the scoring at this point in his game.",
  ),  # sources: draftballr.com/players/ryan-conwell (independently re-verified), gocards.com, wikipedia.org, si.com

  dict(
    id="smith_braden", name="Braden Smith", college="Purdue", pos="Guard", conference="Big Ten",
    archetype="Lead Creator / Shot Creator",
    draft_pick=38, draft_team="Indiana Pacers",
    birthdate=_dt.date(2003, 7, 25), sos_rank=180, sos_asof="2026-07-07",
    gp=39, line=dict(ppg=14.3, rpg=3.5, apg=8.8, tpg=None),
    m=dict(
      ts=(0.552, 39), efg=(51.1, 39), ortg=None, per=None, usg=(26.5, 39),
      ft=(82.5, 39), tp3=(36.2, 39), tp3r=None, ftr=None,
      ast=(43.0, 39), tov=(10.2, 39), ator=(1.697, 39), oreb=(2.4, 39),
      stl=(3.0, 39), blk=(0.7, 39), dreb=(10.3, 39),
      bpm=(-0.6, 39), obpm=(6.5, 39), dbpm=(2.5, 39),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Two-time consensus first-team All-American, Big Ten Tournament MVP, and the NCAA's "
      "all-time career assist leader - a staggering 43.0% assist rate (98th percentile) headlines "
      "an elite table-setting profile (8.8 apg, 3.0% STL%). Shoots it too (36.2% 3PT, 82.5% FT). "
      "Oldest player in this batch (a four-year college senior) - the doc's own counter-evidence "
      "section notes older prospects with clearly translatable skills (his passing) still hit at "
      "a real rate, so this isn't a pure red flag.",
  ),  # sources: draftballr.com/players/braden-smith, purduesports.com, wikipedia.org, espn.com

  dict(
    id="kayil_jack", name="Jack Kayil", college="Alba Berlin (Germany BBL, not NCAA)", pos="Guard", conference=None,
    archetype="Lead Creator / Shot Creator",
    draft_pick=39, draft_team="New York Knicks",
    birthdate=_dt.date(2006, 1, 27), sos_rank=None, sos_asof=None,
    gp=32, line=dict(ppg=12.3, rpg=2.7, apg=3.5, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=(77.0, 32), tp3=(34.0, 32), tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=None, reach=None, height=(75.0, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Not a college prospect - played professionally for Alba Berlin in Germany's "
      "Bundesliga (won the 2025 title) at just 19 years old, averaging 12.3/2.7/3.5 in a limited "
      "~21 min/game role. That's real production in a strong pro league at a young age, but it "
      "isn't directly comparable to the college-based percentile pool here. (Checked draftballr.com "
      "- confirmed not in their database, consistent with him being a non-NCAA player.)",
  ),  # sources: realgm.com, wikipedia.org, eurobasket.com, tankathon.com; draftballr.com checked, no data (non-NCAA)

  dict(
    id="mitchell_dillon", name="Dillon Mitchell", college="St. John's", pos="Wing", conference="Big East",
    archetype="Connector / Low-Usage Glue",
    draft_pick=40, draft_team="Boston Celtics",
    birthdate=_dt.date(2003, 10, 3), sos_rank=58, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=8.3, rpg=7.0, apg=None, tpg=None),
    m=dict(
      ts=(0.555, 37), efg=(56.1, 37), ortg=None, per=None, usg=(15.9, 37),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(18.8, 37), tov=None, ator=(3.0, 37), oreb=(9.4, 37),
      stl=(2.6, 37), blk=(2.6, 37), dreb=(18.0, 37),
      bpm=(8.3, 37), obpm=(3.5, 37), dbpm=(4.8, 37),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Low-usage energy forward at St. John's after transferring from Texas - efficient "
      "(55.9% FG, 56.1% eFG%) on very low usage (15.9%, 2nd percentile), with a strong all-around "
      "activity profile: 18.8% AST% for a forward, a 3.0 AST/TO ratio, and plus rates on both "
      "boards and steals (2.6% STL%). Profiles as a rebounding/effort/connector piece rather than "
      "a primary offensive option.",
  ),  # sources: draftballr.com/players/dillon-mitchell, wikipedia.org, redstormsports.com, espn.com

  dict(
    id="oweh_otega", name="Otega Oweh", college="Kentucky", pos="Guard", conference="SEC",
    archetype="3-and-D Wing",
    draft_pick=41, draft_team="Oklahoma City Thunder",
    birthdate=_dt.date(2003, 6, 21), sos_rank=213, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=18.6, rpg=4.8, apg=2.7, tpg=None),
    m=dict(
      ts=(0.554, 36), efg=(51.0, 36), ortg=None, per=None, usg=(27.1, 36),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(16.3, 36), tov=(9.0, 36), ator=(1.321, 36), oreb=(3.3, 36),
      stl=(3.1, 36), blk=(0.9, 36), dreb=(12.9, 36),
      bpm=(5.942, 36), obpm=(3.332, 36), dbpm=(2.666, 36),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Career-best senior season after transferring to Kentucky (18.6 ppg, plus career "
      "highs of 4.8 rpg/2.7 apg/1.8 spg), most points ever by a UK transfer in a season. All-SEC "
      "Second Team. Good activity marks (3.1% STL%, 9.0% TOV%) on heavy usage (27.1%); passing "
      "(16.3% AST%) is the weaker part of the offensive profile.",
  ),  # sources: draftballr.com/players/otega-oweh (independently re-verified), wikipedia.org, ukathletics.com — BPM matches Ryan Conwell's exactly (5.942), confirmed real via direct re-fetch of both pages, not an extraction error

  dict(
    id="gillespie_jakobi", name="Ja'Kobi Gillespie", college="Tennessee", pos="Guard", conference="SEC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=42, draft_team="San Antonio Spurs",
    birthdate=_dt.date(2004, 3, 10), sos_rank=269, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=18.4, rpg=2.8, apg=5.4, tpg=None),
    m=dict(
      ts=(0.538, 37), efg=(50.1, 37), ortg=None, per=None, usg=(25.7, 37),
      ft=(81.0, 37), tp3=(34.0, 37), tp3r=None, ftr=None,
      ast=(30.2, 37), tov=(8.3, 37), ator=(2.48, 37), oreb=(1.9, 37),
      stl=(3.6, 37), blk=(0.8, 37), dreb=(7.2, 37),
      bpm=(1.5, 37), obpm=(6.1, 37), dbpm=(4.0, 37),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Set Tennessee's single-season steals record (79) while running the offense at a high "
      "level (18.4/5.4/2.1, 30.2% AST% at 25.7% usage) and powering an Elite Eight run. First-Team "
      "All-SEC, SEC Newcomer of the Year. Elite ball security for his usage (8.3% TOV%, 2.48 AST/TO) "
      "and disruptive defense (3.6% STL%, 87th percentile) round out a well-balanced lead-guard profile.",
  ),  # sources: draftballr.com/players/jakobi-gillespie, utsports.com, wikipedia.org, 247sports.com, espn.com

  dict(
    id="bilodeau_tyler", name="Tyler Bilodeau", college="UCLA", pos="Big", conference="Big Ten",
    archetype="Stretch Big",
    draft_pick=43, draft_team="Brooklyn Nets",
    birthdate=_dt.date(2004, 4, 17), sos_rank=123, sos_asof="2026-07-07",
    gp=31, line=dict(ppg=17.6, rpg=5.6, apg=1.1, tpg=None),
    m=dict(
      ts=(0.656, 31), efg=(60.9, 31), ortg=None, per=None, usg=(23.7, 31),
      ft=(87.3, 31), tp3=(46.4, 31), tp3r=None, ftr=None,
      ast=(7.4, 31), tov=(8.1, 31), ator=(0.83, 31), oreb=(4.7, 31),
      stl=(1.0, 31), blk=(1.5, 31), dreb=(18.0, 31),
      bpm=(-0.6, 31), obpm=(7.1, 31), dbpm=(0.9, 31),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Efficient stretch forward at UCLA - elite true shooting (65.6%, 97th percentile) "
      "and effective FG% (60.9%) on real usage (23.7%), plus a clean shooting-touch profile "
      "(87.3% FT, 46.4% 3PT albeit on modest volume). The flags are passing (7.4% AST%) and "
      "defensive activity (1.0% STL%, 20th percentile) - a clear scoring-specialist profile.",
  ),  # sources: draftballr.com/players/tyler-bilodeau, wikipedia.org, uclabruins.com, espn.com

  dict(
    id="maliq_brown", name="Maliq Brown", college="Duke", pos="Big", conference="ACC",
    archetype="Connector / Low-Usage Glue",
    draft_pick=44, draft_team="San Antonio Spurs",
    birthdate=_dt.date(2003, 11, 16), sos_rank=80, sos_asof="2026-07-07",
    gp=38, line=dict(ppg=4.9, rpg=5.2, apg=1.6, tpg=None),
    m=dict(
      ts=(0.634, 38), efg=(64.8, 38), ortg=None, per=None, usg=(14.5, 38),
      ft=(50.0, 38), tp3=(16.7, 38), tp3r=None, ftr=None,
      ast=(13.4, 38), tov=None, ator=(1.477, 38), oreb=(11.8, 38),
      stl=(5.3, 38), blk=(3.9, 38), dreb=(17.3, 38),
      bpm=(10.19, 38), obpm=(1.92, 38), dbpm=(8.1, 38),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A pure low-usage defensive specialist: he set the NCAA single-season DBPM record "
      "(8.93, since 2010-11) as ACC Defensive Player of the Year and Sixth Man of the Year, ranking "
      "3rd nationally in steal rate and 3rd in two-point percentage (76.5%). The flags are obvious "
      "from the box score alone: 4.9 PPG on a 62.9/16.7/50.0 shooting split means he offers almost "
      "nothing as a shooter or self-creator - his NBA case is 100% defense and finishing.",
  ),  # sources: draftballr.com/players/maliq-brown, goduke.com, dukechronicle.com, wikipedia.org, realgm.com

  dict(
    id="e_sharp", name="Emanuel Sharp", college="Houston", pos="Guard", conference="Big 12",
    archetype="3-and-D Wing",
    draft_pick=45, draft_team="Sacramento Kings",
    birthdate=_dt.date(2004, 3, 7), sos_rank=229, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=15.5, rpg=3.0, apg=1.7, tpg=None),
    m=dict(
      ts=(0.582, 37), efg=(52.7, 37), ortg=None, per=None, usg=(23.2, 37),
      ft=(89.1, 37), tp3=(37.0, 37), tp3r=None, ftr=None,
      ast=(11.1, 37), tov=(5.6, 37), ator=(1.85, 37), oreb=(3.0, 37),
      stl=(2.5, 37), blk=(0.4, 37), dreb=(8.6, 37),
      bpm=None, obpm=(5.67, 37), dbpm=(3.89, 37),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A career high-volume marksman: Houston's all-time leader in made and attempted "
      "3-pointers, he shot 37% on 7+ attempts a game as a veteran while leading the Big 12 in "
      "free-throw percentage (89.1%) - the FT%/3-point-volume combo public draft research treats "
      "as the cleanest shooting translation signal. A thin 11.1% assist rate against 23.2% usage "
      "points to a shooting-first, not playmaking, offensive role.",
  ),  # sources: draftballr.com/players/emanuel-sharp, espn.com, uhcougars.com, wikipedia.org — standalone BPM figure didn't reconcile with OBPM+DBPM on the source page, left None rather than guess

  dict(
    id="okpara", name="Felix Okpara", college="Tennessee", pos="Big", conference="SEC",
    archetype="Rim Protector / Anchor",
    draft_pick=46, draft_team="Washington Wizards",
    birthdate=_dt.date(2004, 4, 20), sos_rank=269, sos_asof="2026-07-07",
    gp=None, line=dict(ppg=8.0, rpg=6.3, apg=None, tpg=None),
    m=dict(
      ts=(0.617, None), efg=(60.7, None), ortg=None, per=None, usg=(13.5, None),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(3.1, None), tov=(12.4, None), ator=(0.218, None), oreb=(10.9, None),
      stl=(0.9, None), blk=(7.0, None), dreb=(15.4, None),
      bpm=(4.5, None), obpm=(1.4, None), dbpm=(3.2, None),
      wing=(86.0, None), reach=(112.0, None), height=(82.0, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A play-finisher and rim protector: 59.7% from the floor, team-leading blocks (1.5/gm) "
      "and 69 dunks (8th nationally), on a 6'10\" frame with a plus-4in wingspan and top-5 combine "
      "standing reach (9'4\"). A 7.0% block rate and thin 3.1% assist rate confirm a low-touch, "
      "vertical-activity-only offensive translation, not shot creation.",
  ),  # sources: draftballr.com/players/felix-okpara, espn.com, utsports.com, wikipedia.org, nbadraft.net

  dict(
    id="nickel", name="Tyler Nickel", college="Vanderbilt", pos="Guard", conference="SEC",
    archetype="3-and-D Wing",
    draft_pick=47, draft_team="New York Knicks",
    birthdate=_dt.date(2003, 9, 5), sos_rank=177, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=13.5, rpg=3.3, apg=1.2, tpg=None),
    m=dict(
      ts=(0.617, 36), efg=(59.6, 36), ortg=None, per=None, usg=(16.9, 36),
      ft=None, tp3=(40.0, 36), tp3r=None, ftr=None,
      ast=(6.9, 36), tov=None, ator=(1.784, 36), oreb=(2.5, 36),
      stl=(1.4, 36), blk=(1.9, 36), dreb=(9.6, 36),
      bpm=(6.66, 36), obpm=(5.88, 36), dbpm=(0.83, 36),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A pure movement shooter in his third college stop (UNC, Virginia Tech, Vanderbilt): "
      "40% on 7.6 three-point attempts a game with a career-high 8-make outburst, on 44.5% overall "
      "shooting. Not a shot creator or passer (6.9% AST%) - the value proposition is spacing, full "
      "stop - but efficient enough (61.7% TS) to post a solidly positive BPM anyway.",
  ),  # sources: draftballr.com/players/tyler-nickel, espn.com, vucommodores.com, wikipedia.org, si.com

  dict(
    id="lawal", name="Tobi Lawal", college="Virginia Tech", pos="Big", conference="ACC",
    archetype="Rim-Running / Lob Big",
    draft_pick=48, draft_team="Dallas Mavericks",
    birthdate=_dt.date(2003, 5, 1), sos_rank=212, sos_asof="2026-07-07",
    gp=23, line=dict(ppg=12.3, rpg=8.5, apg=None, tpg=None),
    m=dict(
      ts=(0.635, 23), efg=(57.8, 23), ortg=None, per=None, usg=(20.2, 23),
      ft=(76.3, 23), tp3=(25.0, 23), tp3r=None, ftr=None,
      ast=(3.9, 23), tov=None, ator=None, oreb=(9.2, 23),
      stl=(0.6, 23), blk=(4.3, 23), dreb=(25.0, 23),
      bpm=(-6.82, 23), obpm=(-5.54, 23), dbpm=(-1.21, 23),
      wing=None, reach=None, height=None, weight=None, vert=(45.5, None),
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="An English-born forward (VCU, then Virginia Tech) who missed nine games to an ankle "
      "injury but averaged 12.3/8.5 with a reported 45.5-inch max vertical - one of the top verticals "
      "at the combine. Efficient inside (54.2% FG) but streaky range (25% 3P), missed time, and "
      "thin passing (3.9% AST%) are the caveats - and DraftBallr's model actually grades his season "
      "as a net-negative impact (-6.8 BPM), a notably weaker read than the box score alone suggests.",
  ),  # sources: draftballr.com/players/tobi-lawal, hokiesports.com, wikipedia.org, babcockhoops.com

  dict(
    id="hopkins", name="Bryce Hopkins", college="St. John's", pos="Wing", conference="Big East",
    archetype="Connector / Low-Usage Glue",
    draft_pick=49, draft_team="Denver Nuggets",
    birthdate=_dt.date(2002, 9, 7), sos_rank=58, sos_asof="2026-07-07",
    gp=3, line=dict(ppg=None, rpg=None, apg=None, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A cautionary tale on availability: after averaging 15.8/8.5/2.1 across three seasons "
      "split between Kentucky, Providence, and St. John's, a bone bruise limited him to only ~3 games "
      "in his 2025-26 St. John's season - on top of an ACL tear that ended his 2023-24 season early. "
      "The prior-season talent is real; the medical file is the whole story here, so no draft-year "
      "college stats are populated above (not in DraftBallr's database either, likely for the same reason).",
  ),  # sources: wikipedia.org, rumbleinthegarden.com, 247sports.com, golocalprov.com — DraftBallr: not found

  dict(
    id="bradley", name="Jaden Bradley", college="Arizona", pos="Guard", conference="Big 12",
    archetype="Lead Creator / Shot Creator",
    draft_pick=50, draft_team="Toronto Raptors",
    birthdate=_dt.date(2003, 9, 14), sos_rank=126, sos_asof="2026-07-07",
    gp=39, line=dict(ppg=13.3, rpg=3.4, apg=4.4, tpg=None),
    m=dict(
      ts=(0.568, 39), efg=(49.9, 39), ortg=None, per=None, usg=(21.1, 39),
      ft=(80.9, 39), tp3=(39.4, 39), tp3r=None, ftr=None,
      ast=(23.2, 39), tov=(9.1, 39), ator=(2.583, 39), oreb=(1.8, 39),
      stl=(2.6, 39), blk=(0.3, 39), dreb=(9.5, 39),
      bpm=(7.56, 39), obpm=(3.23, 39), dbpm=(4.49, 39),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A four-year college player (Alabama, then Arizona) who broke out as a senior: Big 12 "
      "Player of the Year, Big 12 Tournament MOP, and a driver of Arizona's Final Four run on "
      "46.3/39.4/80.9 shooting with a strong 23.2% assist rate and clean turnover economy (9.1% TOV%). "
      "Old for this class relative to the top of the draft - the age-curve research this page leans "
      "on would flag him as a lower-ceiling, more finished role/connector bet rather than a high-"
      "upside swing, though the well-rounded stat line (7.6 BPM) is a real positive.",
  ),  # sources: draftballr.com/players/jaden-bradley, espn.com, arizonawildcats.com, wikipedia.org

  dict(
    id="nelson", name="Izaiyah Nelson", college="South Florida", pos="Big", conference="American",
    archetype="Rim-Running / Lob Big",
    draft_pick=51, draft_team="Orlando Magic",
    birthdate=_dt.date(2003, 10, 1), sos_rank=290, sos_asof="2026-07-07",
    gp=34, line=dict(ppg=15.9, rpg=9.6, apg=1.2, tpg=None),
    m=dict(
      ts=(0.609, 34), efg=(56.5, 34), ortg=None, per=None, usg=(23.7, 34),
      ft=(72.5, 34), tp3=(14.3, 34), tp3r=None, ftr=None,
      ast=(8.8, 34), tov=(8.4, 34), ator=(0.971, 34), oreb=(14.4, 34),
      stl=(3.3, 34), blk=(5.9, 34), dreb=(21.0, 34),
      bpm=None, obpm=(5.78, 34), dbpm=(2.84, 34),
      wing=None, reach=None, height=None, weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A do-everything forward (Arkansas State, then South Florida): 15.9/9.6/1.2 with 1.6 "
      "STL and 1.4 BLK a game on 56.1% shooting, 18 double-doubles, and a rare sweep of his "
      "conference's Player of the Year, Defensive Player of the Year, and Newcomer of the Year awards. "
      "Strong two-way rate stats (14.4% OREB%, 5.9% BLK%) support the counting stats. Almost no "
      "3-point range yet (14.3%) - the developmental swing is whether a jumper arrives.",
  ),  # sources: draftballr.com/players/izaiyah-nelson, espn.com, gousfbulls.com, sportstalkflorida.com — standalone BPM didn't reconcile with OBPM+DBPM, left None

  dict(
    id="veesaar", name="Henri Veesaar", college="North Carolina", pos="Big", conference="ACC",
    archetype="Stretch Big",
    draft_pick=52, draft_team="Atlanta Hawks",
    birthdate=_dt.date(2004, 3, 28), sos_rank=76, sos_asof="2026-07-07",
    gp=31, line=dict(ppg=17.0, rpg=8.7, apg=2.1, tpg=None),
    m=dict(
      ts=(0.664, 31), efg=(66.7, 31), ortg=None, per=None, usg=(22.7, 31),
      ft=(62.0, 31), tp3=(43.0, 31), tp3r=None, ftr=None,
      ast=(13.6, 31), tov=(9.7, 31), ator=(1.266, 31), oreb=(8.1, 31),
      stl=(1.1, 31), blk=(3.8, 31), dreb=(21.9, 31),
      bpm=(1.17, 31), obpm=(0.47, 31), dbpm=(0.87, 31),
      wing=(86.0, None), reach=(111.0, None), height=(83.25, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A stretch big who transferred from Arizona to North Carolina and broke out "
      "immediately: 17.0/8.7/2.1 on a 61/43/62 shooting line, Co-MVP with Caleb Wilson, and one of a "
      "handful of players in D-I history with 30+ threes, 30+ blocks, and 60% shooting in the same "
      "season. A 43% 3-point mark on real volume plus rim activity (3.8% BLK%) is a rare combination "
      "if it holds at the next level, though his overall BPM (1.2) is more modest than the box score "
      "alone suggests.",
  ),  # sources: draftballr.com/players/henri-veesaar, goheels.com, wikipedia.org, rotowire.com

  dict(
    id="onyenso", name="Ugonna Onyenso", college="Virginia", pos="Big", conference="ACC",
    archetype="Rim Protector / Anchor",
    draft_pick=53, draft_team="Detroit Pistons",
    birthdate=_dt.date(2004, 9, 25), sos_rank=61, sos_asof="2026-07-07",
    gp=36, line=dict(ppg=6.5, rpg=4.9, apg=0.6, tpg=None),
    m=dict(
      ts=(0.616, 36), efg=(59.8, 36), ortg=None, per=None, usg=(15.1, 36),
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=(5.8, 36), tov=None, ator=(1.392, 36), oreb=(9.8, 36),
      stl=(2.0, 36), blk=(17.4, 36), dreb=(19.3, 36),
      bpm=None, obpm=(4.26, 36), dbpm=(7.20, 36),
      wing=(88.75, None), reach=(113.0, None), height=(83.0, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A pure specialist: after stops at Kentucky and Kansas State, he averaged only 6.5 PPG "
      "at Virginia but led the ACC (2nd nationally) in blocks per game (2.9) in just 18.6 minutes, "
      "then set an ACC Tournament record with 21 blocks in three games - 9 of them against Duke, "
      "2nd-most ever in an ACC Tournament game. An extreme 17.4% block rate (among the highest on "
      "record, worth a grain of salt) backs up the counting stats. Almost no offensive role - this "
      "is close to a pure rim-protection bet.",
  ),  # sources: draftballr.com/players/ugonna-onyenso, wikipedia.org, ukathletics.com, 247sports.com

  dict(
    id="ljones", name="Lajae Jones", college="Florida State", pos="Guard", conference="ACC",
    archetype="Connector / Low-Usage Glue",
    draft_pick=54, draft_team="Golden State Warriors",
    birthdate=_dt.date(2004, 5, 21), sos_rank=206, sos_asof="2026-07-07",
    gp=33, line=dict(ppg=12.7, rpg=5.7, apg=1.1, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=(76.3, 33), tp3=(32.5, 33), tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=None, reach=None, height=(79.0, None), weight=(220, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A do-everything wing rebounder at 6'7\" who took a long five-school path (Tarleton "
      "State, Barton, St. Bonaventure, Florida State) before landing in the second round. Modest "
      "scoring (12.7 ppg on .427/.325/.763 shooting) but solid rate production across rebounds, "
      "steals and blocks (roughly a steal and a block a game). Advanced metrics weren't publicly "
      "available for his lone Florida State season, so this profile leans on per-game rates and "
      "shooting splits alone.",
  ),  # sources: espn.com, seminoles.com, wikipedia.org — not on draftballr.com

  dict(
    id="martinelli", name="Nick Martinelli", college="Northwestern", pos="Wing", conference="Big Ten",
    archetype="Two-Way Shot-Creating Wing",
    draft_pick=55, draft_team="LA Clippers",
    birthdate=_dt.date(2004, 4, 20), sos_rank=344, sos_asof="2026-07-07",
    gp=None, line=dict(ppg=23.0, rpg=6.2, apg=2.0, tpg=None),
    m=dict(
      ts=(0.602, None), efg=(55.2, None), ortg=None, per=(25.5, None), usg=(29.4, None),
      ft=(80.9, None), tp3=(41.7, None), tp3r=None, ftr=None,
      ast=(13.2, None), tov=(5.9, None), ator=(1.48, None), oreb=(7.8, None),
      stl=(1.4, None), blk=(1.2, None), dreb=(13.5, None),
      bpm=(7.4, None), obpm=(7.4, None), dbpm=(0.1, None),
      wing=(82.0, None), reach=None, height=(78.5, None), weight=(223.6, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="Led the Big Ten in scoring for a second straight year (23.0 ppg) on plus efficiency "
      "(.510/.417/.809 splits, 60.2% TS) and set Northwestern's single-season scoring record as a "
      "senior. Elite ball security (5.9% TOV%, 98th percentile) and real offensive impact (7.4 OBPM), "
      "though at 6'6.5\" barefoot with a 6'10\" wingspan he lacks great length for a forward, and his "
      "defensive stats (1.4% STL, 1.2% BLK, 0.1 DBPM) are thin - the translation question is shot "
      "creation and defensive role at a bigger, longer position in the NBA.",
  ),  # sources: draftballr.com/players/nick-martinelli, espn.com, nusports.com, wikipedia.org

  dict(
    id="ishchenko", name="Vsevolod Ishchenko", college="Lokomotiv Kuban (VTB League, not NCAA)", pos="Wing", conference=None,
    archetype="Connector / Low-Usage Glue",
    draft_pick=56, draft_team="Dallas Mavericks",
    birthdate=_dt.date(2005, 2, 10), sos_rank=None, sos_asof=None,
    gp=None, line=dict(ppg=8.7, rpg=4.5, apg=2.1, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=(84.0, None), reach=None, height=(75.0, None), weight=(216, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A 21-year-old Russian wing named the VTB United League's Young Player of the Year "
      "in 2025-26, averaging 8.7 points, 4.5 rebounds, 2.1 assists and 1.3 steals in a bench role "
      "(roughly 23 minutes a game) for Lokomotiv Kuban. A reported 7'0\" wingspan on a 6'3\" frame "
      "is a notable length outlier if accurate. These are pro-league per-game averages, not "
      "college rate stats, and shooting splits/advanced metrics weren't confidently available.",
  ),  # sources: wikipedia.org, vtb-league.com, realgm.com, nba.com/draft — DraftBallr has a page but every stat is a 0.00 placeholder ("No CBBD_ID linked"), treated as not-found

  dict(
    id="ngoy", name="Narcisse Ngoy", college="Poitiers Basket 86 (France Pro B, not NCAA)", pos="Big", conference=None,
    archetype="Rim Protector / Anchor",
    draft_pick=57, draft_team="LA Clippers",
    birthdate=_dt.date(2004, 7, 13), sos_rank=None, sos_asof=None,
    gp=None, line=dict(ppg=10.6, rpg=11.5, apg=None, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=None, tp3=None, tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=(91.0, None), reach=None, height=(84.0, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A 7-foot French rim protector and Pro B (French second division) MVP, posting big "
      "per-minute rebounding and shot-blocking numbers (10.7 ppg, 11.7 rpg, 2.7 bpg per one "
      "confirming source) for Poitiers Basket 86. Selected by Atlanta and immediately traded to "
      "the Clippers in an unusual draft-and-stash situation - he has since announced he will "
      "instead play college basketball at Auburn next season rather than turn pro immediately, so "
      "this stat line is his last available season, not necessarily his next one. The archetype "
      "read is unambiguous regardless: an anchor big built around a reported 7'7\" wingspan and "
      "9'6\"+ standing reach.",
  ),  # sources: wikipedia.org, nba.com/draft, totalprosports.com, si.com, espn.com, 247sports.com — not on draftballr.com; Auburn plan is a future-season note, not a data conflict

  dict(
    id="pierrejr", name="Jaron Pierre Jr.", college="SMU", pos="Guard", conference="ACC",
    archetype="Lead Creator / Shot Creator",
    draft_pick=58, draft_team="New Orleans Pelicans",
    birthdate=_dt.date(2002, 7, 12), sos_rank=310, sos_asof="2026-07-07",
    gp=34, line=dict(ppg=17.6, rpg=4.9, apg=2.1, tpg=None),
    m=dict(
      ts=(0.567, 34), efg=(54.5, 34), ortg=None, per=None, usg=(23.3, 34),
      ft=(75.8, 34), tp3=(37.0, 34), tp3r=None, ftr=None,
      ast=(11.1, 34), tov=(9.2, 34), ator=(1.13, 34), oreb=(2.6, 34),
      stl=(1.7, 34), blk=(1.7, 34), dreb=(13.7, 34),
      bpm=(-6.3, 34), obpm=(3.7, 34), dbpm=(0.0, 34),
      wing=None, reach=None, height=(77.0, None), weight=(210, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A four-school scoring guard (Southern Miss, Wichita State, Jacksonville State, SMU) "
      "who put up 17.6 ppg on .462/.370/.758 shooting in his final college season, 7th in the ACC "
      "in scoring. A below-replacement -6.3 BPM despite decent raw efficiency (56.7% TS) is a real "
      "flag, not just a volume-scoring story: thin passing (11.1% AST%) for a lead guard and modest "
      "usage (23.3%) for his shot diet mean the box score reads better than the impact numbers do.",
  ),  # sources: draftballr.com/players/jaron-pierre-jr, espn.com, smumustangs.com, wikipedia.org

  dict(
    id="kaufmanrenn", name="Trey Kaufman-Renn", college="Purdue", pos="Big", conference="Big Ten",
    archetype="Offensive Hub Big",
    draft_pick=59, draft_team="Minnesota Timberwolves",
    birthdate=_dt.date(2002, 8, 19), sos_rank=180, sos_asof="2026-07-07",
    gp=37, line=dict(ppg=14.2, rpg=8.3, apg=2.5, tpg=None),
    m=dict(
      ts=(0.590, 37), efg=(58.0, 37), ortg=None, per=(23.8, 37), usg=(24.9, 37),
      ft=(63.6, 37), tp3=(15.4, 37), tp3r=None, ftr=(27.2, 37),
      ast=(17.2, 37), tov=(8.5, 37), ator=(1.90, 37), oreb=(13.2, 37),
      stl=(0.8, 37), blk=(1.0, 37), dreb=(23.7, 37),
      bpm=(-2.8, 37), obpm=(5.6, 37), dbpm=(1.5, 37),
      wing=(82.5, None), reach=None, height=(79.75, None), weight=(241.2, None), vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A four-year Purdue interior scorer who improved his efficiency every season, "
      "finishing at 57.8% FG with 14.2 ppg, 8.3 rpg, and surprisingly good passing for a big (17.2% "
      "AST%, 95th percentile). But the confirmed advanced read is a real flag: a below-replacement "
      "-2.8 BPM, driven by a weak defensive activity profile (0.8% STL, 1.0% BLK - both bottom-"
      "decile) that a strong OBPM (5.6) doesn't offset. The clearest offensive flag is perimeter "
      "shooting - a 15.4% clip on 3s and a 27.2% FT rate (5th percentile) - so his NBA role likely "
      "hinges on scoring exclusively inside the arc.",
  ),  # sources: draftballr.com/players/trey-kaufman-renn, espn.com, purduesports.com, wikipedia.org

  dict(
    id="mlewis", name="Malique Lewis", college="South East Melbourne Phoenix (NBL, not NCAA)", pos="Wing", conference=None,
    archetype="3-and-D Wing",
    draft_pick=60, draft_team="Milwaukee Bucks",
    birthdate=_dt.date(2004, 11, 10), sos_rank=None, sos_asof=None,
    gp=None, line=dict(ppg=7.1, rpg=4.3, apg=2.2, tpg=None),
    m=dict(
      ts=None, efg=None, ortg=None, per=None, usg=None,
      ft=(80.0, None), tp3=(39.0, None), tp3r=None, ftr=None,
      ast=None, tov=None, ator=None, oreb=None,
      stl=None, blk=None, dreb=None,
      bpm=None, obpm=None, dbpm=None,
      wing=(85.0, None), reach=None, height=(80.0, None), weight=None, vert=None,
    ),
    bpm_torvik=None, usg_torvik=None,
    scouting="A Trinidadian wing who spent two NBL seasons with South East Melbourne Phoenix as a "
      "'Next Star' developmental signee, improving to 7.1 ppg, 4.3 rpg, 2.2 apg, 1.2 stl on a "
      "healthy .460/.390/.800 shooting split in his second season. Modest counting stats reflect "
      "a bench role in a senior pro league rather than a lack of tools - a reported 7'1\" wingspan "
      "on a 6'8\" frame stands out.",
  ),  # sources: wikipedia.org, nbl.com.au, semphoenix.com.au — not on draftballr.com
]

# ----------------------------------------------------------------------------
# COMBINE ANTHROPOMETRICS (2026 NBA Draft Combine — official barefoot measurements)
# Pulled 2026-07-08 to fill measurement gaps that scattered per-player research had
# missed. height/wingspan/standing reach in decimal INCHES, weight in lbs, max
# vertical in inches. Sources: NBA.com combine anthro + trackers republishing the
# official table (Yahoo live results, DraftExpress/Givony, nbadraft.net, tankathon,
# on3, babcockhoops). Only genuinely MEASURED barefoot values — never a college
# in-shoes/roster listing. Applied below as an override so every prospect's
# measurements share one clean, comparable source.
#   - Nate Ament's wingspan/reach are reconciled here to the combine-official figures
#     (our earlier values were pre-combine estimates).
#   - ljones (Portsmouth Invitational) and pierrejr (pre-draft measured) come from
#     another professionally-measured barefoot event, not the NBA combine — measured
#     in the same way, flagged for provenance.
#   - Non-combine internationals (Kayil, Ishchenko, Ngoy, Lewis, de Larrea) legitimately
#     have no combine data; their existing measured values (where any) are left as-is,
#     and max vertical stays None — most prospects don't complete athletic testing, so
#     vertical is deliberately NOT shown as a percentile bar (header strip only).
# ----------------------------------------------------------------------------
COMBINE_ANTHRO = {
  "darius_acuff":    dict(reach=98.5,  weight=185.8, vert=36.5),
  "nate_ament":      dict(height=81.5, wing=83.5, reach=109.5, weight=211.0),
  "ejiofor":         dict(reach=107.0),
  "cenac":           dict(reach=108.5, vert=37.0),
  "jefferson":       dict(reach=104.5, vert=33.0),
  "peat":            dict(reach=104.0, vert=37.5),
  "thomas_meleek":   dict(height=75.0,  wing=78.75, reach=100.0, weight=189.0),
  "brazile_trevon":  dict(height=81.5,  wing=87.75, reach=109.0, weight=225.0),
  "miller_baba":     dict(height=82.5,  reach=111.0, weight=208.2),
  "conwell_ryan":    dict(height=74.0,  wing=79.0,  reach=96.5,  weight=214.0),
  "smith_braden":    dict(height=70.25, wing=75.25, reach=93.5,  weight=166.0),
  "mitchell_dillon": dict(height=78.75, wing=82.5,  reach=104.5, weight=202.0),
  "oweh_otega":      dict(height=76.25, wing=80.25, reach=101.0, weight=216.0),
  "gillespie_jakobi":dict(height=71.75, wing=76.0,  reach=95.5,  weight=181.0),
  "bilodeau_tyler":  dict(height=79.25, wing=84.75, reach=107.0, weight=228.0),
  "maliq_brown":     dict(height=80.0,  wing=84.75, reach=107.0, weight=216.0),
  "e_sharp":         dict(height=74.75, wing=75.0,  reach=98.5,  weight=208.0),
  "okpara":          dict(weight=237.4, vert=34.5),
  "nickel":          dict(height=78.0,  wing=80.5,  reach=102.5, weight=217.4, vert=34.0),
  "lawal":           dict(height=79.25, wing=82.5,  reach=104.5, weight=214.0),
  "hopkins":         dict(height=78.0,  wing=82.5,  reach=105.0, weight=218.8, vert=37.5),
  "bradley":         dict(height=74.5,  wing=78.25, reach=96.0,  weight=205.4, vert=36.0),
  "nelson":          dict(height=80.25, wing=86.5,  reach=108.0, weight=219.4, vert=38.5),
  "veesaar":         dict(weight=227.2, vert=32.5),
  "onyenso":         dict(weight=236.8, vert=32.0),
  "martinelli":      dict(reach=104.5, vert=33.0),
  "kaufmanrenn":     dict(reach=105.5, vert=33.0),
  "pierrejr":        dict(wing=80.5,  reach=102.0, vert=38.0),   # measured pre-draft (not the NBA combine table)
  "ljones":          dict(wing=79.5,  reach=103.5, vert=40.5),   # 2026 Portsmouth Invitational measured anthro
}
_BY_ID = {p["id"]: p for p in PROSPECTS}
for _pid, _fields in COMBINE_ANTHRO.items():
    _p = _BY_ID.get(_pid)
    if _p is None:
        raise KeyError(f"COMBINE_ANTHRO references unknown prospect id {_pid!r}")
    for _k, _v in _fields.items():
        _p["m"][_k] = (_v, None)   # measurements are static -> n=None

# ----------------------------------------------------------------------------
# SHOT PROFILE (2026 college season shot-location breakdown, via draftballr.com)
# Pulled 2026-07-08. Per player: twop = overall 2-point FG%, rimfg = FG% at the
# rim, midfg = mid-range FG% — the "2P% broken into rim vs mid-range" view. All
# whole-number percents, carrying each player's games-played `n` so the header's
# reduced-sample note still governs. Rim finishing (rimfg) is one of the research
# doc's marquee translation proxies (the Holmgren "90% at the rim" example).
# Coverage: 52 of 54 NCAA prospects (Hopkins and Jones aren't in DraftBallr;
# internationals don't have NCAA shot data).
#   Data-quality note: DraftBallr's page occasionally renders the overall 2P%
#   cell identical to the rim cell; where a player takes real mid-range volume,
#   twop below was re-fetched from the distinct 2P% row (Wagler 48.9, Steinbach
#   61.8, Karaban 55.8, Philon 57.4 — all reconcile with their rim+mid mix).
#   maliq_brown took zero mid-range shots, so his 2P% legitimately equals his rim
#   FG% and his mid-range bar is intentionally blank.
# ----------------------------------------------------------------------------
def _gp(pid):
    p = _BY_ID.get(pid)
    return p.get("gp") if p else None

SHOT_PROFILE = {
  # picks 1-20
  "dybantsa":        dict(twop=63.7, rimfg=72.3, midfg=46.3),
  "peterson":        dict(twop=59.7, rimfg=83.0, midfg=42.7),
  "boozer":          dict(twop=61.5, rimfg=64.5, midfg=42.3),
  "caleb_wilson":    dict(twop=61.0, rimfg=72.3, midfg=44.4),
  "keaton_wagler":   dict(twop=48.9, rimfg=57.5, midfg=34.8),
  "mikel_brown":     dict(twop=50.4, rimfg=65.3, midfg=24.4),
  "darius_acuff":    dict(twop=50.8, rimfg=59.7, midfg=40.1),
  "kingston_flemings":dict(twop=50.3, rimfg=57.2, midfg=44.3),
  "morez_johnson":   dict(twop=65.8, rimfg=72.9, midfg=35.8),
  "brayden_burries": dict(twop=56.2, rimfg=65.0, midfg=45.0),
  "yaxel_lendeborg": dict(twop=71.6, rimfg=72.9, midfg=37.7),
  "aday_mara":       dict(twop=68.0, rimfg=81.1, midfg=41.1),
  "nate_ament":      dict(twop=43.0, rimfg=51.8, midfg=37.3),
  "steinbach":       dict(twop=61.8, rimfg=70.6, midfg=44.8),
  "swain":           dict(twop=59.6, rimfg=64.3, midfg=47.6),
  "stirtz":          dict(twop=59.1, rimfg=70.5, midfg=46.9),
  "okorie":          dict(twop=52.6, rimfg=56.2, midfg=42.4),
  "canderson":       dict(twop=64.1, rimfg=72.4, midfg=42.7),
  "graves":          dict(twop=56.8, rimfg=63.3, midfg=44.6),
  "quaintance":      dict(twop=57.1, rimfg=63.6, midfg=33.3),
  # picks 21-40
  "philon":          dict(twop=57.4, rimfg=65.7, midfg=44.5),
  "ejiofor":         dict(twop=58.0, rimfg=65.6, midfg=42.2),
  "carr":            dict(twop=58.7, rimfg=68.0, midfg=47.5),
  "reed":            dict(twop=61.4, rimfg=68.9, midfg=44.2),
  "cenac":           dict(twop=55.1, rimfg=77.5, midfg=43.3),
  "jefferson":       dict(twop=51.7, rimfg=60.7, midfg=38.7),
  "karaban":         dict(twop=55.8, rimfg=62.8, midfg=35.3),
  "peat":            dict(twop=56.6, rimfg=69.7, midfg=33.5),
  "thornton":        dict(twop=64.1, rimfg=75.5, midfg=57.7),
  "saunders":        dict(twop=63.0, rimfg=69.4, midfg=45.9),
  "evans":           dict(twop=61.0, rimfg=68.9, midfg=38.3),
  "thomas_meleek":   dict(twop=44.8, rimfg=59.0, midfg=34.0),
  "brazile_trevon":  dict(twop=65.3, rimfg=81.2, midfg=28.1),
  "miller_baba":     dict(twop=60.5, rimfg=71.5, midfg=41.7),
  "conwell_ryan":    dict(twop=53.0, rimfg=59.0, midfg=37.0),
  "smith_braden":    dict(twop=49.1, rimfg=60.5, midfg=44.2),
  "mitchell_dillon": dict(twop=59.3, rimfg=65.7, midfg=32.6),
  # picks 41-60
  "oweh_otega":      dict(twop=52.2, rimfg=64.0, midfg=31.5),
  "gillespie_jakobi":dict(twop=49.4, rimfg=58.3, midfg=34.7),
  "bilodeau_tyler":  dict(twop=55.3, rimfg=67.2, midfg=50.0),
  "maliq_brown":     dict(twop=76.5, rimfg=76.5),   # zero mid-range attempts -> no mid FG%
  "e_sharp":         dict(twop=47.9, rimfg=66.7, midfg=38.7),
  "okpara":          dict(twop=61.1, rimfg=70.0, midfg=30.0),
  "nickel":          dict(twop=58.2, rimfg=75.0, midfg=47.3),
  "lawal":           dict(twop=66.1, rimfg=73.0, midfg=44.8),
  "bradley":         dict(twop=47.8, rimfg=51.6, midfg=45.2),
  "nelson":          dict(twop=62.5, rimfg=65.9, midfg=40.5),
  "veesaar":         dict(twop=67.7, rimfg=75.3, midfg=53.5),
  "onyenso":         dict(twop=64.7, rimfg=69.0, midfg=51.5),
  "martinelli":      dict(twop=53.3, rimfg=62.7, midfg=47.2),
  "pierrejr":        dict(twop=53.6, rimfg=64.9, midfg=39.3),
  "kaufmanrenn":     dict(twop=59.2, rimfg=73.0, midfg=49.3),
}
for _pid, _fields in SHOT_PROFILE.items():
    _p = _BY_ID.get(_pid)
    if _p is None:
        raise KeyError(f"SHOT_PROFILE references unknown prospect id {_pid!r}")
    _n = _gp(_pid)                 # carry games played so the reduced-sample note still applies
    for _k, _v in _fields.items():
        _p["m"][_k] = (_v, _n)

# ----------------------------------------------------------------------------
# DRAFT CLASS — every prospect belongs to a draft year. The 60 above are the 2026
# class (actively being evaluated); historical first-round classes (2021-2025) are
# appended below as browsable comparison profiles, each carrying its own draft_year.
# The front-end's population toggle compares a player either against his own class
# or the pooled past-drafts field. Historical stat profiles come from draftballr.com
# (pre-draft college season only — never NBA stats), pick/team from the Wikipedia
# draft tables, birthdates from Wikipedia. Historical players carry no SOS or
# scouting blurb (sos/archetype/scouting left unset -> the page renders those blank).
#
# _hist() keeps the historical rows compact: rate stats get the player's games
# played as their sample size `n`; measurements (height/wing/reach/weight/vert)
# are static (n=None); anything unknown is None and renders as a blank bar.
# ----------------------------------------------------------------------------
_RATE_KEYS = {"ts","efg","usg","ft","tp3","twop","rimfg","midfg","ast","tov","ator",
              "oreb","stl","blk","dreb","bpm","obpm","dbpm"}
def _hist(id, name, year, pick, team, college, pos, conf, bd, gp, ppg, rpg, apg, **st):
    m = {}
    for k, v in st.items():
        m[k] = None if v is None else ((v, gp) if k in _RATE_KEYS else (v, None))
    line = None if (ppg is None and rpg is None and apg is None) else dict(ppg=ppg, rpg=rpg, apg=apg, tpg=None)
    return dict(id=id, name=name, draft_year=year, draft_pick=pick, draft_team=team,
                college=college, pos=pos, conference=conf, birthdate=bd, gp=gp, line=line, m=m)

HISTORICAL = [
  # === 2025 draft, first round =============================================
  _hist("flagg","Cooper Flagg",2025,1,"Dallas Mavericks","Duke","Wing","ACC",_dt.date(2006,12,21),37,19.3,7.6,4.3,
        ts=0.593,efg=53.3,usg=30.8,ft=84.0,tp3=38.5,twop=51.7,rimfg=60.5,midfg=39.5,ast=26.8,tov=None,ator=2.10,oreb=5.5,stl=2.8,blk=4.9,dreb=21.2,bpm=15.0,obpm=9.3,dbpm=5.9,height=80.25,wing=84.0,reach=106.6,weight=221),
  _hist("harper","Dylan Harper",2025,2,"San Antonio Spurs","Rutgers","Guard","Big Ten",_dt.date(2006,3,2),29,19.5,4.7,4.0,
        ts=0.586,efg=54.6,usg=28.8,ft=75.0,tp3=33.3,twop=63.7,rimfg=70.0,midfg=30.9,ast=27.0,tov=9.3,ator=1.75,oreb=2.6,stl=2.6,blk=1.9,dreb=13.5,bpm=8.6,obpm=7.1,dbpm=1.5,height=76.375,wing=82.625,reach=102.5,weight=213.2),
  _hist("edgecombe","VJ Edgecombe",2025,3,"Philadelphia 76ers","Baylor","Guard","Big 12",_dt.date(2005,7,30),32,15.1,5.7,3.3,
        ts=0.554,efg=50.7,usg=24.4,ft=77.9,tp3=33.6,twop=59.1,rimfg=60.3,midfg=38.5,ast=19.0,tov=None,ator=1.78,oreb=7.1,stl=3.8,blk=2.3,dreb=13.6,bpm=10.1,obpm=6.5,dbpm=3.7,height=76.0,wing=79.5,reach=102.5,weight=193.2),
  _hist("knueppel","Kon Knueppel",2025,4,"Charlotte Hornets","Duke","Wing","ACC",_dt.date(2005,8,3),39,14.4,4.0,2.8,
        ts=0.642,efg=59.0,usg=20.9,ft=91.4,tp3=40.6,twop=56.7,rimfg=63.1,midfg=40.8,ast=15.7,tov=None,ator=2.09,oreb=None,stl=2.0,blk=0.6,dreb=10.3,bpm=6.3,obpm=6.6,dbpm=3.1,height=78.0,wing=78.25,reach=None,weight=219),
  _hist("bailey","Ace Bailey",2025,5,"Utah Jazz","Rutgers","Wing","Big Ten",_dt.date(2006,8,13),30,17.7,7.3,1.3,
        ts=0.536,efg=51.4,usg=26.2,ft=69.2,tp3=34.6,twop=51.1,rimfg=61.0,midfg=46.0,ast=8.3,tov=None,ator=0.61,oreb=7.0,stl=1.7,blk=4.1,dreb=17.5,bpm=3.7,obpm=3.6,dbpm=0.1,height=80.25,wing=84.5,reach=107.0,weight=202.8),
  _hist("tre_johnson","Tre Johnson",2025,6,"Washington Wizards","Texas","Guard","SEC",_dt.date(2006,3,7),33,20.0,3.1,2.7,
        ts=0.557,efg=51.1,usg=27.3,ft=87.1,tp3=39.7,twop=44.9,rimfg=59.8,midfg=37.7,ast=16.5,tov=None,ator=1.53,oreb=1.1,stl=1.6,blk=1.0,dreb=9.0,bpm=5.2,obpm=6.0,dbpm=0.6,height=76.4,wing=82.3,reach=101.25,weight=190.4),
  _hist("fears","Jeremiah Fears",2025,7,"New Orleans Pelicans","Oklahoma","Guard","SEC",_dt.date(2006,10,14),34,17.2,4.2,4.2,
        ts=0.562,efg=48.0,usg=31.9,ft=85.1,tp3=28.4,twop=50.5,rimfg=53.0,midfg=45.9,ast=28.6,tov=13.8,ator=1.22,oreb=3.1,stl=3.1,blk=0.5,dreb=13.0,bpm=5.6,obpm=3.5,dbpm=1.2,height=74.25,wing=77.3,reach=98.25,weight=179.6),
  _hist("demin","Egor Demin",2025,8,"Brooklyn Nets","BYU","Guard","Big 12",_dt.date(2006,3,3),33,10.6,4.0,5.6,
        ts=0.509,efg=48.0,usg=25.8,ft=69.5,tp3=27.3,twop=55.3,rimfg=67.4,midfg=35.1,ast=34.6,tov=14.3,ator=1.96,oreb=1.3,stl=2.5,blk=1.7,dreb=14.8,bpm=4.7,obpm=3.0,dbpm=1.7,height=80.25,wing=82.25,reach=105.5,weight=199.2),
  _hist("murray_boyles","Collin Murray-Boyles",2025,9,"Toronto Raptors","South Carolina","Big","SEC",_dt.date(2005,6,10),32,16.9,8.3,2.5,
        ts=0.630,efg=59.9,usg=27.0,ft=70.7,tp3=26.5,twop=61.3,rimfg=69.7,midfg=39.5,ast=21.1,tov=12.5,ator=1.05,oreb=8.8,stl=2.9,blk=4.7,dreb=23.8,bpm=11.2,obpm=6.6,dbpm=4.6,height=78.5,wing=84.08,reach=106.0,weight=239.2),
  _hist("maluach","Khaman Maluach",2025,10,"Houston Rockets","Duke","Big","ACC",_dt.date(2006,9,14),39,8.6,6.6,0.5,
        ts=0.736,efg=72.3,usg=16.8,ft=76.6,tp3=25.0,twop=75.4,rimfg=76.9,midfg=63.2,ast=4.3,tov=9.8,ator=0.75,oreb=16.5,stl=0.6,blk=6.8,dreb=19.2,bpm=9.3,obpm=5.9,dbpm=2.9,height=84.08,wing=90.8,reach=114.0,weight=252.8),
  _hist("coward","Cedric Coward",2025,11,"Portland Trail Blazers","Washington State","Wing","WCC",_dt.date(2003,9,11),6,17.8,7.1,3.8,
        ts=0.700,efg=65.6,usg=22.3,ft=83.9,tp3=40.0,twop=71.0,rimfg=73.7,midfg=66.7,ast=20.6,tov=None,ator=1.79,oreb=7.0,stl=1.4,blk=5.3,dreb=17.2,bpm=1.2,obpm=1.8,dbpm=-0.6,height=77.3,wing=86.3,reach=106.0,weight=213),
  _hist("essengue","Noa Essengue",2025,12,"Chicago Bulls","Ratiopharm Ulm (Germany)","Wing",None,None,None,None,None,None),
  _hist("queen","Derik Queen",2025,13,"New Orleans Pelicans","Maryland","Big","Big Ten",_dt.date(2004,12,27),36,16.6,9.1,2.0,
        ts=0.591,efg=53.5,usg=26.9,ft=76.6,tp3=20.0,twop=55.8,rimfg=67.5,midfg=35.3,ast=11.6,tov=12.6,ator=0.85,oreb=9.0,stl=2.0,blk=3.8,dreb=24.5,bpm=3.1,obpm=1.5,dbpm=1.7,height=81.3,wing=84.5,reach=109.5,weight=247.8),
  _hist("bryant","Carter Bryant",2025,14,"San Antonio Spurs","Arizona","Wing","Big 12",_dt.date(2005,11,26),37,6.6,4.2,1.0,
        ts=0.593,efg=57.1,usg=16.0,ft=69.5,tp3=37.1,twop=59.2,rimfg=76.7,midfg=32.1,ast=8.3,tov=12.9,ator=1.05,oreb=5.3,stl=2.8,blk=5.8,dreb=17.8,bpm=7.6,obpm=3.2,dbpm=4.4,height=78.5,wing=83.8,reach=106.0,weight=214.8),
  _hist("sorber","Thomas Sorber",2025,15,"Oklahoma City Thunder","Georgetown","Big","Big East",_dt.date(2005,12,25),24,14.6,8.6,2.5,
        ts=0.580,efg=54.4,usg=24.2,ft=72.4,tp3=16.2,twop=59.6,rimfg=68.7,midfg=38.1,ast=15.6,tov=12.4,ator=1.11,oreb=9.5,stl=2.7,blk=7.6,dreb=21.9,bpm=5.4,obpm=3.3,dbpm=4.1,height=81.25,wing=90.0,reach=109.0,weight=262.8),
  _hist("yang_hansen","Yang Hansen",2025,16,"Portland Trail Blazers","Qingdao Eagles (China)","Big",None,None,None,None,None,None),
  _hist("beringer","Joan Beringer",2025,17,"Minnesota Timberwolves","Cedevita Olimpija (Slovenia)","Big",None,None,None,None,None,None),
  _hist("clayton","Walter Clayton Jr.",2025,18,"Utah Jazz","Florida","Guard","SEC",_dt.date(2003,3,6),39,18.4,3.7,4.3,
        ts=0.602,efg=56.0,usg=24.8,ft=87.5,tp3=38.6,twop=53.4,rimfg=63.6,midfg=39.1,ast=23.2,tov=10.2,ator=1.7,oreb=1.2,stl=2.1,blk=1.6,dreb=10.3,bpm=9.9,obpm=7.4,dbpm=2.7,height=74.0,wing=76.0,reach=97.5,weight=199),
  _hist("traore","Nolan Traoré",2025,19,"Brooklyn Nets","Saint-Quentin (France)","Guard",None,None,None,None,None,None),
  _hist("jakucionis","Kasparas Jakucionis",2025,20,"Miami Heat","Illinois","Guard","Big Ten",_dt.date(2006,5,29),33,15.1,5.8,4.8,
        ts=0.590,efg=51.9,usg=25.6,ft=84.5,tp3=31.8,twop=56.2,rimfg=67.3,midfg=33.9,ast=26.0,tov=15.9,ator=1.35,oreb=4.9,stl=1.5,blk=0.8,dreb=13.6,bpm=4.9,obpm=3.6,dbpm=1.9,height=77.0,wing=80.0,reach=99.5,weight=205),
  _hist("riley","Will Riley",2025,21,"Washington Wizards","Illinois","Wing","Big Ten",_dt.date(2006,2,10),35,12.6,4.2,2.3,
        ts=0.532,efg=49.7,usg=23.0,ft=72.4,tp3=32.6,twop=50.2,rimfg=65.0,midfg=36.6,ast=16.0,tov=7.3,ator=1.99,oreb=5.2,stl=0.6,blk=1.0,dreb=11.5,bpm=3.7,obpm=4.5,dbpm=0.8,height=80.75,wing=80.88,reach=104.0,weight=186),
  _hist("powell","Drake Powell",2025,22,"Brooklyn Nets","North Carolina","Guard","ACC",_dt.date(2005,9,8),37,7.4,3.4,1.2,
        ts=0.581,efg=56.9,usg=13.3,ft=64.8,tp3=37.9,twop=56.9,rimfg=69.0,midfg=37.8,ast=7.0,tov=8.8,ator=1.57,oreb=3.3,stl=1.6,blk=2.8,dreb=11.4,bpm=4.8,obpm=2.3,dbpm=2.6,height=77.3,wing=84.0,reach=103.0,weight=200),
  _hist("newell","Asa Newell",2025,23,"Atlanta Hawks","Georgia","Big","SEC",_dt.date(2005,10,5),33,15.5,6.9,0.9,
        ts=0.612,efg=58.0,usg=23.0,ft=74.8,tp3=29.2,twop=62.7,rimfg=72.9,midfg=37.3,ast=6.7,tov=7.4,ator=0.85,oreb=14.0,stl=2.0,blk=3.8,dreb=13.5,bpm=5.9,obpm=7.3,dbpm=1.4,height=81.0,wing=83.3,reach=107.5,weight=224),
  _hist("clifford","Nique Clifford",2025,24,"Sacramento Kings","Colorado State","Guard","Mountain West",_dt.date(2002,2,9),35,18.9,9.6,4.4,
        ts=None,efg=None,usg=None,ft=None,tp3=None,twop=None,rimfg=None,midfg=None,ast=None,tov=None,ator=None,oreb=None,stl=None,blk=None,dreb=None,bpm=None,obpm=None,dbpm=None,height=None,wing=None,reach=None,weight=None),  # not on DraftBallr — per-game line only
  _hist("jase_richardson","Jase Richardson",2025,25,"Orlando Magic","Michigan State","Guard","Big Ten",_dt.date(2005,10,16),36,12.1,3.3,2.0,
        ts=0.624,efg=57.4,usg=19.4,ft=83.6,tp3=41.2,twop=54.5,rimfg=69.0,midfg=40.7,ast=14.4,tov=6.2,ator=2.38,oreb=3.0,stl=1.9,blk=1.4,dreb=11.4,bpm=7.5,obpm=5.2,dbpm=2.5,height=73.0,wing=78.0,reach=98.5,weight=178),
  _hist("saraf","Ben Saraf",2025,26,"Brooklyn Nets","Ratiopharm Ulm (Germany)","Guard",None,None,None,None,None,None),
  _hist("wolf","Danny Wolf",2025,27,"Brooklyn Nets","Michigan","Big","Big Ten",_dt.date(2004,5,5),37,13.2,9.8,3.7,
        ts=0.559,efg=54.8,usg=25.2,ft=59.4,tp3=33.6,twop=56.7,rimfg=63.1,midfg=36.5,ast=22.8,tov=16.3,ator=1.18,oreb=9.1,stl=1.3,blk=4.6,dreb=25.0,bpm=1.9,obpm=3.8,dbpm=4.6,height=82.5,wing=86.3,reach=109.0,weight=251.8),
  _hist("gonzalez","Hugo González",2025,28,"Boston Celtics","Real Madrid (Spain)","Wing",None,None,None,None,None,None),
  _hist("mcneeley","Liam McNeeley",2025,29,"Charlotte Hornets","UConn","Wing","Big East",_dt.date(2005,10,10),27,14.6,6.0,2.4,
        ts=0.529,efg=45.5,usg=24.2,ft=86.6,tp3=31.7,twop=43.6,rimfg=48.6,midfg=35.0,ast=13.1,tov=10.2,ator=1.27,oreb=3.7,stl=1.1,blk=0.8,dreb=18.7,bpm=-0.8,obpm=2.0,dbpm=0.0,height=80.8,wing=80.5,reach=99.5,weight=215),
  _hist("niederhauser","Yanic Konan Niederhäuser",2025,30,"Los Angeles Clippers","Penn State","Big","Big Ten",_dt.date(2003,3,14),29,13.0,6.3,0.8,
        ts=0.631,efg=61.3,usg=22.9,ft=66.4,tp3=9.1,twop=63.7,rimfg=69.2,midfg=39.0,ast=6.1,tov=12.3,ator=0.53,oreb=10.1,stl=1.5,blk=10.2,dreb=19.9,bpm=4.9,obpm=2.3,dbpm=2.6,height=83.0,wing=87.3,reach=111.0,weight=243),

  # === 2024 draft, first round =============================================
  _hist("risacher","Zaccharie Risacher",2024,1,"Atlanta Hawks","JL Bourg (France)","Wing",None,_dt.date(2005,4,8),None,None,None,None),
  _hist("sarr","Alex Sarr",2024,2,"Washington Wizards","Perth Wildcats (Australia)","Big",None,_dt.date(2005,4,26),None,None,None,None),
  _hist("sheppard","Reed Sheppard",2024,3,"Houston Rockets","Kentucky","Guard","SEC",_dt.date(2004,6,24),33,12.5,4.2,4.6,
        ts=0.699,efg=67.9,usg=18.7,ft=83.1,tp3=52.1,twop=55.5,rimfg=65.0,midfg=45.8,ast=24.0,tov=None,ator=1.38,oreb=1.5,stl=4.6,blk=2.5,dreb=13.3,bpm=11.0,obpm=6.6,dbpm=4.5,height=73.8,wing=75.3,reach=None,weight=181.6),
  _hist("castle","Stephon Castle",2024,4,"San Antonio Spurs","UConn","Guard","Big East",_dt.date(2004,11,1),34,11.1,4.7,3.0,
        ts=0.551,efg=50.7,usg=22.4,ft=75.5,tp3=26.7,twop=54.4,rimfg=63.1,midfg=34.8,ast=18.4,tov=10.0,ator=0.88,oreb=7.8,stl=1.8,blk=2.1,dreb=12.0,bpm=3.1,obpm=3.1,dbpm=2.5,height=78.5,wing=82.0,reach=102.0,weight=210),
  _hist("holland","Ron Holland",2024,5,"Detroit Pistons","G League Ignite","Wing",None,_dt.date(2005,7,7),None,None,None,None),
  _hist("salaun","Tidjane Salaün",2024,6,"Charlotte Hornets","Cholet Basket (France)","Wing",None,_dt.date(2005,8,10),None,None,None,None),
  _hist("clingan","Donovan Clingan",2024,7,"Portland Trail Blazers","UConn","Big","Big East",_dt.date(2004,2,23),35,13.1,7.4,1.6,
        ts=0.637,efg=64.3,usg=24.6,ft=58.3,tp3=25.0,twop=65.0,rimfg=70.1,midfg=45.8,ast=13.4,tov=6.1,ator=0.58,oreb=13.8,stl=1.4,blk=11.4,dreb=23.4,bpm=9.7,obpm=8.5,dbpm=5.8,height=87.25,wing=90.75,reach=115.0,weight=282),
  _hist("dillingham","Rob Dillingham",2024,8,"Minnesota Timberwolves","Kentucky","Guard","SEC",_dt.date(2005,1,4),32,15.2,2.9,3.9,
        ts=0.595,efg=56.4,usg=29.9,ft=79.6,tp3=44.4,twop=49.5,rimfg=55.3,midfg=43.3,ast=30.1,tov=None,ator=1.05,oreb=1.2,stl=1.0,blk=0.1,dreb=11.8,bpm=5.6,obpm=5.8,dbpm=0.1,height=73.0,wing=75.0,reach=None,weight=165),
  _hist("edey","Zach Edey",2024,9,"Memphis Grizzlies","Purdue","Big","Big Ten",_dt.date(2002,5,14),39,25.2,12.2,2.1,
        ts=0.659,efg=62.4,usg=33.4,ft=71.1,tp3=50.0,twop=62.4,rimfg=79.6,midfg=44.5,ast=2.1,tov=None,ator=0.95,oreb=18.1,stl=0.5,blk=6.9,dreb=25.5,bpm=15.5,obpm=12.4,dbpm=3.1,height=87.38,wing=94.8,reach=115.0,weight=299),
  _hist("cody_williams","Cody Williams",2024,10,"Utah Jazz","Colorado","Wing","Pac-12",_dt.date(2004,11,20),24,11.9,3.0,1.6,
        ts=0.620,efg=59.5,usg=20.1,ft=71.4,tp3=41.5,twop=58.8,rimfg=73.6,midfg=37.1,ast=10.4,tov=None,ator=0.83,oreb=3.3,stl=0.6,blk=0.7,dreb=9.2,bpm=2.9,obpm=2.0,dbpm=1.0,height=78.5,wing=85.0,reach=103.0,weight=178),
  _hist("buzelis","Matas Buzelis",2024,11,"Chicago Bulls","G League Ignite","Wing",None,_dt.date(2004,10,13),None,None,None,None),
  _hist("topic","Nikola Topić",2024,12,"Oklahoma City Thunder","KK Crvena zvezda (Serbia)","Guard",None,_dt.date(2005,8,10),None,None,None,None),
  _hist("devin_carter","Devin Carter",2024,13,"Sacramento Kings","Providence","Guard","Big East",_dt.date(2002,3,18),35,19.7,8.7,3.6,
        ts=None,efg=None,usg=None,ft=74.9,tp3=37.7,twop=None,rimfg=None,midfg=None,ast=None,tov=None,ator=None,oreb=None,stl=None,blk=None,dreb=None,bpm=None,obpm=None,dbpm=None,height=75.5,wing=80.75,reach=None,weight=193),  # not on DraftBallr — line + measurements only
  _hist("carrington","Bub Carrington",2024,14,"Washington Wizards","Pittsburgh","Guard","ACC",_dt.date(2005,7,21),33,13.8,5.3,4.2,
        ts=0.530,efg=49.6,usg=23.0,ft=78.5,tp3=32.2,twop=51.1,rimfg=53.8,midfg=50.0,ast=24.0,tov=9.7,ator=2.1,oreb=1.6,stl=1.0,blk=0.9,dreb=16.8,bpm=3.0,obpm=4.0,dbpm=0.7,height=76.0,wing=80.0,reach=99.0,weight=195),
  _hist("ware","Kel'el Ware",2024,15,"Miami Heat","Indiana","Big","Big Ten",_dt.date(2004,4,20),30,15.9,9.9,1.5,
        ts=0.623,efg=61.4,usg=22.1,ft=63.4,tp3=42.5,twop=61.1,rimfg=74.1,midfg=44.3,ast=9.9,tov=9.0,ator=1.07,oreb=8.0,stl=1.1,blk=6.5,dreb=26.1,bpm=8.1,obpm=5.6,dbpm=2.5,height=83.0,wing=89.0,reach=None,weight=230),
  _hist("mccain","Jared McCain",2024,16,"Philadelphia 76ers","Duke","Guard","ACC",_dt.date(2004,2,20),36,14.3,5.1,1.8,
        ts=0.611,efg=57.7,usg=19.7,ft=88.5,tp3=41.4,twop=52.1,rimfg=59.6,midfg=43.8,ast=10.7,tov=None,ator=1.46,oreb=3.0,stl=1.1,blk=0.1,dreb=15.3,bpm=7.7,obpm=5.6,dbpm=2.1,height=74.0,wing=75.5,reach=98.0,weight=203.2),
  _hist("knecht","Dalton Knecht",2024,17,"Los Angeles Lakers","Tennessee","Wing","SEC",_dt.date(2001,4,19),36,21.7,4.9,1.8,
        ts=0.577,efg=53.8,usg=29.8,ft=77.0,tp3=39.7,twop=49.9,rimfg=58.9,midfg=36.0,ast=13.4,tov=6.9,ator=0.52,oreb=2.8,stl=1.3,blk=2.4,dreb=14.3,bpm=9.9,obpm=7.8,dbpm=2.1,height=77.3,wing=81.0,reach=103.5,weight=212),
  _hist("da_silva","Tristan da Silva",2024,18,"Orlando Magic","Colorado","Wing","Pac-12",_dt.date(2001,5,15),34,16.1,5.1,2.5,
        ts=0.606,efg=57.0,usg=21.0,ft=83.0,tp3=39.0,twop=56.0,rimfg=61.0,midfg=49.0,ast=13.0,tov=9.0,ator=0.67,oreb=4.0,stl=1.0,blk=1.0,dreb=14.0,bpm=6.3,obpm=4.7,dbpm=1.6,height=80.3,wing=82.3,reach=104.3,weight=217),
  _hist("walter","Ja'Kobe Walter",2024,19,"Toronto Raptors","Baylor","Guard","Big 12",_dt.date(2004,9,4),34,14.5,4.5,1.4,
        ts=0.544,efg=47.6,usg=22.1,ft=79.2,tp3=34.6,twop=41.9,rimfg=54.1,midfg=34.3,ast=8.2,tov=7.6,ator=0.48,oreb=5.5,stl=2.0,blk=0.8,dreb=12.3,bpm=4.4,obpm=4.0,dbpm=0.4,height=76.0,wing=82.0,reach=None,weight=198),
  _hist("tyson","Jaylon Tyson",2024,20,"Cleveland Cavaliers","California","Wing","Pac-12",_dt.date(2002,12,2),31,19.7,6.9,3.6,
        ts=0.557,efg=51.8,usg=30.0,ft=79.6,tp3=36.0,twop=50.9,rimfg=57.6,midfg=39.8,ast=23.5,tov=12.1,ator=1.13,oreb=5.2,stl=2.0,blk=1.5,dreb=16.9,bpm=6.2,obpm=5.4,dbpm=0.8,height=77.5,wing=80.0,reach=102.5,weight=218.2),
  _hist("missi","Yves Missi",2024,21,"New Orleans Pelicans","Baylor","Big","Big 12",_dt.date(2004,5,14),33,10.7,5.6,0.5,
        ts=0.621,efg=61.3,usg=21.9,ft=61.9,tp3=0.0,twop=61.3,rimfg=70.3,midfg=35.1,ast=4.0,tov=13.0,ator=0.37,oreb=14.4,stl=1.4,blk=7.1,dreb=16.3,bpm=5.8,obpm=4.2,dbpm=1.7,height=82.8,wing=86.0,reach=109.5,weight=229),
  _hist("holmes","DaRon Holmes II",2024,22,"Denver Nuggets","Dayton","Big","A-10",_dt.date(2002,8,15),33,20.5,8.6,2.7,
        ts=0.626,efg=58.4,usg=31.2,ft=71.3,tp3=38.6,twop=58.5,rimfg=74.1,midfg=35.4,ast=19.0,tov=9.4,ator=1.29,oreb=6.8,stl=1.8,blk=7.2,dreb=23.7,bpm=11.6,obpm=7.9,dbpm=3.7,height=81.0,wing=84.5,reach=108.0,weight=221),
  _hist("aj_johnson","AJ Johnson",2024,23,"Milwaukee Bucks","Illawarra Hawks (Australia)","Guard",None,_dt.date(2004,12,1),None,None,None,None),
  _hist("kyshawn_george","Kyshawn George",2024,24,"Washington Wizards","Miami","Guard","ACC",_dt.date(2003,12,12),31,7.7,3.0,2.3,
        ts=0.582,efg=56.6,usg=17.6,ft=77.8,tp3=40.8,twop=46.7,rimfg=60.5,midfg=22.7,ast=16.3,tov=14.4,ator=1.48,oreb=2.2,stl=2.2,blk=1.8,dreb=12.1,bpm=2.8,obpm=1.1,dbpm=2.0,height=79.0,wing=82.3,reach=105.0,weight=209),
  _hist("dadiet","Pacôme Dadiet",2024,25,"New York Knicks","Ratiopharm Ulm (Germany)","Wing",None,_dt.date(2005,7,27),None,None,None,None),
  _hist("dillon_jones","Dillon Jones",2024,26,"Oklahoma City Thunder","Weber State","Wing","Big Sky",_dt.date(2001,10,29),29,20.9,9.8,5.3,
        ts=0.586,efg=52.0,usg=31.2,ft=84.5,tp3=31.7,twop=53.4,rimfg=61.4,midfg=41.1,ast=31.3,tov=10.7,ator=1.78,oreb=2.9,stl=3.1,blk=0.3,dreb=31.0,bpm=7.7,obpm=5.4,dbpm=2.4,height=76.5,wing=83.0,reach=100.5,weight=237),
  _hist("shannon","Terrence Shannon Jr.",2024,27,"Minnesota Timberwolves","Illinois","Wing","Big Ten",_dt.date(2000,7,30),32,23.1,4.0,2.4,
        ts=0.622,efg=55.9,usg=27.9,ft=80.1,tp3=36.2,twop=57.3,rimfg=65.5,midfg=39.0,ast=13.2,tov=7.8,ator=1.24,oreb=2.7,stl=1.7,blk=2.3,dreb=10.0,bpm=10.7,obpm=8.9,dbpm=1.9,height=77.8,wing=80.8,reach=100.0,weight=219.4),
  _hist("dunn","Ryan Dunn",2024,28,"Phoenix Suns","Virginia","Wing","ACC",_dt.date(2003,1,7),34,8.2,6.9,0.8,
        ts=0.564,efg=56.5,usg=17.0,ft=53.2,tp3=20.0,twop=61.8,rimfg=67.9,midfg=42.9,ast=6.0,tov=9.9,ator=0.96,oreb=9.6,stl=3.0,blk=10.4,dreb=20.8,bpm=6.4,obpm=1.2,dbpm=5.3,height=78.3,wing=85.5,reach=103.0,weight=213.6),
  _hist("collier","Isaiah Collier",2024,29,"Utah Jazz","USC","Guard","Pac-12",_dt.date(2004,10,8),27,16.3,2.9,4.3,
        ts=0.567,efg=53.0,usg=30.0,ft=67.0,tp3=34.0,twop=54.0,rimfg=62.0,midfg=40.0,ast=31.0,tov=14.0,ator=1.06,oreb=2.0,stl=3.0,blk=1.0,dreb=9.0,bpm=3.5,obpm=3.0,dbpm=0.5,height=74.5,wing=76.8,reach=97.5,weight=205),
  _hist("scheierman","Baylor Scheierman",2024,30,"Boston Celtics","Creighton","Wing","Big East",_dt.date(2000,9,26),35,18.6,9.1,4.0,
        ts=0.596,efg=56.0,usg=24.9,ft=87.6,tp3=38.1,twop=54.5,rimfg=63.2,midfg=44.7,ast=19.9,tov=9.2,ator=1.89,oreb=2.6,stl=1.5,blk=0.3,dreb=23.2,bpm=8.8,obpm=6.3,dbpm=2.6,height=78.3,wing=80.3,reach=102.5,weight=201.6),

  # === 2023 draft, first round =============================================
  _hist("wembanyama","Victor Wembanyama",2023,1,"San Antonio Spurs","Metropolitans 92 (France)","Big",None,_dt.date(2004,1,4),None,None,None,None),
  _hist("brandon_miller","Brandon Miller",2023,2,"Charlotte Hornets","Alabama","Wing","SEC",_dt.date(2002,11,22),37,18.9,8.3,2.2,
        ts=0.583,efg=53.3,usg=25.0,ft=85.9,tp3=38.4,twop=48.3,rimfg=57.8,midfg=33.3,ast=12.7,tov=10.7,ator=0.94,oreb=6.7,stl=1.5,blk=2.4,dreb=17.7,bpm=11.1,obpm=7.4,dbpm=3.7,height=79.5,wing=83.0,reach=None,weight=200),
  _hist("scoot","Scoot Henderson",2023,3,"Portland Trail Blazers","G League Ignite","Guard",None,_dt.date(2004,2,3),None,None,None,None),
  _hist("amen_thompson","Amen Thompson",2023,4,"Houston Rockets","Overtime Elite","Guard",None,_dt.date(2003,1,30),None,None,None,None),
  _hist("ausar_thompson","Ausar Thompson",2023,5,"Detroit Pistons","Overtime Elite","Wing",None,_dt.date(2003,1,30),None,None,None,None),
  _hist("anthony_black","Anthony Black",2023,6,"Orlando Magic","Arkansas","Guard","SEC",_dt.date(2004,1,20),36,12.8,5.2,4.0,
        ts=0.549,efg=49.5,usg=22.2,ft=70.5,tp3=30.1,twop=51.3,rimfg=62.8,midfg=31.8,ast=20.9,tov=15.5,ator=1.35,oreb=4.3,stl=3.4,blk=1.9,dreb=12.8,bpm=5.9,obpm=2.5,dbpm=3.5,height=77.8,wing=79.5,reach=None,weight=210),
  _hist("coulibaly","Bilal Coulibaly",2023,7,"Washington Wizards","Metropolitans 92 (France)","Wing",None,_dt.date(2004,7,26),None,None,None,None),
  _hist("jarace_walker","Jarace Walker",2023,8,"Indiana Pacers","Houston","Big","American",_dt.date(2003,9,4),36,11.2,6.9,1.9,
        ts=0.533,efg=51.5,usg=22.0,ft=66.2,tp3=34.7,twop=51.3,rimfg=69.3,midfg=38.0,ast=12.4,tov=10.4,ator=1.27,oreb=9.5,stl=2.2,blk=6.2,dreb=18.1,bpm=4.8,obpm=4.1,dbpm=3.8,height=78.5,wing=86.5,reach=104.5,weight=249),
  _hist("hendricks","Taylor Hendricks",2023,9,"Utah Jazz","UCF","Wing","American",_dt.date(2003,11,22),34,15.2,7.1,1.4,
        ts=0.589,efg=55.7,usg=20.4,ft=78.2,tp3=39.4,twop=53.5,rimfg=64.7,midfg=37.2,ast=8.6,tov=None,ator=1.05,oreb=8.1,stl=1.6,blk=5.9,dreb=16.2,bpm=4.9,obpm=4.6,dbpm=0.4,height=80.3,wing=84.5,reach=107.0,weight=213.6),
  _hist("cason_wallace","Cason Wallace",2023,10,"Oklahoma City Thunder","Kentucky","Guard","SEC",_dt.date(2003,11,7),32,11.7,3.7,4.3,
        ts=0.543,efg=51.6,usg=20.3,ft=75.7,tp3=34.6,twop=51.4,rimfg=71.2,midfg=38.4,ast=24.4,tov=None,ator=1.27,oreb=3.3,stl=3.7,blk=1.6,dreb=10.3,bpm=4.6,obpm=3.1,dbpm=4.0,height=74.5,wing=80.5,reach=101.0,weight=195.2),
  _hist("jett_howard","Jett Howard",2023,11,"Orlando Magic","Michigan","Wing","Big Ten",_dt.date(2003,9,14),29,14.3,2.8,2.1,
        ts=0.562,efg=53.2,usg=21.8,ft=80.0,tp3=36.8,twop=49.6,rimfg=61.7,midfg=41.7,ast=12.9,tov=None,ator=1.69,oreb=1.0,stl=0.8,blk=2.1,dreb=8.8,bpm=4.3,obpm=3.8,dbpm=0.5,height=78.3,wing=81.0,reach=None,weight=214),
  _hist("lively","Dereck Lively II",2023,12,"Dallas Mavericks","Duke","Big","ACC",_dt.date(2004,2,12),34,5.2,5.4,1.1,
        ts=0.657,efg=66.1,usg=12.8,ft=60.0,tp3=15.4,twop=71.4,rimfg=77.1,midfg=11.1,ast=9.8,tov=None,ator=1.70,oreb=12.3,stl=1.5,blk=12.8,dreb=17.8,bpm=9.1,obpm=2.4,dbpm=6.7,height=84.8,wing=91.0,reach=None,weight=215),
  _hist("gradey_dick","Gradey Dick",2023,13,"Toronto Raptors","Kansas","Wing","Big 12",_dt.date(2003,11,20),36,14.2,5.1,1.8,
        ts=0.581,efg=54.7,usg=19.2,ft=85.4,tp3=40.3,twop=48.4,rimfg=61.4,midfg=33.3,ast=9.4,tov=8.3,ator=1.37,oreb=4.0,stl=2.5,blk=0.8,dreb=13.5,bpm=4.4,obpm=4.0,dbpm=2.4,height=78.3,wing=80.8,reach=101.0,weight=204),
  _hist("hawkins","Jordan Hawkins",2023,14,"New Orleans Pelicans","UConn","Guard","Big East",_dt.date(2002,4,29),37,16.3,3.8,1.3,
        ts=0.584,efg=53.1,usg=22.7,ft=88.7,tp3=38.8,twop=44.5,rimfg=55.1,midfg=32.0,ast=8.2,tov=None,ator=0.92,oreb=3.9,stl=1.4,blk=1.8,dreb=10.8,bpm=0.9,obpm=6.2,dbpm=1.2,height=76.3,wing=78.8,reach=101.5,weight=186),
  _hist("bufkin","Kobe Bufkin",2023,15,"Atlanta Hawks","Michigan","Guard","Big Ten",_dt.date(2003,9,21),33,14.0,4.6,2.9,
        ts=0.578,efg=54.2,usg=21.6,ft=84.9,tp3=35.5,twop=54.6,rimfg=68.8,midfg=38.9,ast=17.4,tov=10.7,ator=1.53,oreb=2.6,stl=2.3,blk=2.1,dreb=12.0,bpm=2.9,obpm=3.0,dbpm=2.9,height=76.3,wing=79.8,reach=102.5,weight=186.8),
  _hist("keyonte_george","Keyonte George",2023,16,"Utah Jazz","Baylor","Guard","Big 12",_dt.date(2003,11,8),33,15.3,4.3,2.8,
        ts=0.524,efg=47.0,usg=29.8,ft=79.3,tp3=33.8,twop=42.4,rimfg=58.5,midfg=33.6,ast=None,tov=12.8,ator=1.06,oreb=4.2,stl=2.3,blk=0.7,dreb=13.6,bpm=2.2,obpm=4.2,dbpm=0.4,height=74.5,wing=81.3,reach=None,weight=186),
  _hist("hood_schifino","Jalen Hood-Schifino",2023,17,"Los Angeles Lakers","Indiana","Guard","Big Ten",_dt.date(2003,6,19),32,13.5,4.1,3.8,
        ts=0.492,efg=46.3,usg=25.2,ft=77.6,tp3=33.3,twop=44.9,rimfg=53.9,midfg=41.7,ast=20.2,tov=None,ator=1.35,oreb=1.6,stl=1.4,blk=0.8,dreb=12.0,bpm=-0.4,obpm=-0.2,dbpm=-0.1,height=76.3,wing=82.3,reach=100.5,weight=216.6),
  _hist("jaquez","Jaime Jaquez Jr.",2023,18,"Miami Heat","UCLA","Wing","Pac-12",_dt.date(2001,2,18),37,17.9,8.3,2.5,
        ts=0.543,efg=51.1,usg=27.2,ft=77.0,tp3=31.7,twop=51.9,rimfg=61.1,midfg=41.5,ast=14.6,tov=8.4,ator=1.37,oreb=9.0,stl=2.8,blk=2.2,dreb=20.2,bpm=1.1,obpm=0.3,dbpm=1.3,height=78.0,wing=81.5,reach=99.5,weight=226.4),
  _hist("podziemski","Brandin Podziemski",2023,19,"Golden State Warriors","Santa Clara","Guard","WCC",_dt.date(2003,2,25),31,19.9,8.9,3.8,
        ts=0.608,efg=57.6,usg=25.5,ft=77.1,tp3=44.7,twop=51.3,rimfg=62.0,midfg=42.5,ast=20.8,tov=9.3,ator=1.67,oreb=5.5,stl=2.8,blk=1.3,dreb=21.0,bpm=5.6,obpm=7.6,dbpm=2.6,height=75.8,wing=77.5,reach=96.5,weight=203.8),
  _hist("whitmore","Cam Whitmore",2023,20,"Houston Rockets","Villanova","Wing","Big East",_dt.date(2004,7,8),26,12.5,5.4,0.7,
        ts=0.571,efg=55.1,usg=24.3,ft=70.3,tp3=34.3,twop=57.8,rimfg=65.8,midfg=30.3,ast=6.4,tov=None,ator=0.51,oreb=3.7,stl=3.2,blk=1.6,dreb=20.3,bpm=5.3,obpm=3.1,dbpm=2.2,height=77.8,wing=80.5,reach=103.5,weight=235),
  _hist("clowney","Noah Clowney",2023,21,"Brooklyn Nets","Alabama","Wing","SEC",_dt.date(2004,7,14),36,9.8,7.9,0.8,
        ts=0.576,efg=55.3,usg=17.8,ft=64.9,tp3=28.3,twop=66.9,rimfg=71.3,midfg=48.0,ast=6.0,tov=None,ator=0.74,oreb=8.7,stl=1.3,blk=3.4,dreb=21.4,bpm=7.2,obpm=3.3,dbpm=4.0,height=81.5,wing=86.0,reach=None,weight=210),
  _hist("dariq_whitehead","Dariq Whitehead",2023,22,"Brooklyn Nets","Duke","Wing","ACC",_dt.date(2004,8,1),28,8.2,2.4,1.1,
        ts=0.548,efg=52.8,usg=20.3,ft=79.3,tp3=42.9,twop=41.4,rimfg=53.3,midfg=31.5,ast=9.2,tov=None,ator=0.74,oreb=2.5,stl=2.2,blk=1.1,dreb=10.6,bpm=3.5,obpm=1.5,dbpm=2.0,height=77.8,wing=82.3,reach=103.5,weight=217.2),
  _hist("kris_murray","Kris Murray",2023,23,"Portland Trail Blazers","Iowa","Wing","Big Ten",_dt.date(2000,8,19),29,20.3,8.0,2.1,
        ts=0.572,efg=54.8,usg=25.6,ft=72.9,tp3=33.5,twop=58.3,rimfg=67.0,midfg=35.2,ast=11.7,tov=None,ator=1.37,oreb=8.5,stl=1.7,blk=3.4,dreb=17.8,bpm=None,obpm=8.0,dbpm=0.1,height=79.8,wing=83.8,reach=106.0,weight=212.8),
  _hist("prosper","Olivier-Maxence Prosper",2023,24,"Dallas Mavericks","Marquette","Wing","Big East",_dt.date(2002,7,3),None,None,None,None),  # not on DraftBallr — metadata only
  _hist("sasser","Marcus Sasser",2023,25,"Detroit Pistons","Houston","Guard","American",_dt.date(2000,9,21),36,16.9,2.8,3.1,
        ts=0.598,efg=54.9,usg=24.9,ft=84.8,tp3=38.4,twop=51.4,rimfg=64.3,midfg=40.6,ast=19.6,tov=7.9,ator=1.96,oreb=1.4,stl=3.2,blk=0.7,dreb=8.9,bpm=11.1,obpm=7.5,dbpm=3.7,height=73.3,wing=79.0,reach=99.5,weight=196),
  _hist("ben_sheppard","Ben Sheppard",2023,26,"Indiana Pacers","Belmont","Wing","Missouri Valley",_dt.date(2001,7,16),31,18.9,5.3,3.0,
        ts=0.580,efg=56.0,usg=26.8,ft=69.4,tp3=41.6,twop=51.4,rimfg=60.8,midfg=38.5,ast=16.7,tov=9.6,ator=1.35,oreb=2.3,stl=2.3,blk=0.5,dreb=15.4,bpm=3.7,obpm=4.0,dbpm=-0.4,height=77.3,wing=79.8,reach=100.0,weight=195),
  _hist("nick_smith","Nick Smith Jr.",2023,27,"Charlotte Hornets","Arkansas","Guard","SEC",_dt.date(2004,4,18),17,12.5,1.6,1.7,
        ts=0.472,efg=43.6,usg=26.3,ft=74.0,tp3=33.8,twop=39.7,rimfg=50.0,midfg=36.1,ast=13.4,tov=None,ator=1.11,oreb=1.1,stl=1.8,blk=0.5,dreb=6.3,bpm=-0.2,obpm=0.9,dbpm=-1.0,height=73.8,wing=81.3,reach=None,weight=186),
  _hist("sensabaugh","Brice Sensabaugh",2023,28,"Utah Jazz","Ohio State","Wing","Big Ten",_dt.date(2003,10,30),33,16.4,5.4,1.2,
        ts=0.588,efg=55.5,usg=32.1,ft=83.0,tp3=40.5,twop=52.5,rimfg=57.8,midfg=49.7,ast=10.9,tov=None,ator=0.61,oreb=6.2,stl=1.3,blk=1.7,dreb=18.9,bpm=5.2,obpm=7.4,dbpm=0.3,height=76.5,wing=82.0,reach=None,weight=236),
  _hist("strawther","Julian Strawther",2023,29,"Denver Nuggets","Gonzaga","Wing","WCC",_dt.date(2002,4,18),36,15.4,6.2,1.3,
        ts=0.602,efg=56.6,usg=20.6,ft=79.2,tp3=40.5,twop=52.7,rimfg=62.1,midfg=44.5,ast=6.7,tov=None,ator=0.94,oreb=3.0,stl=1.4,blk=1.5,dreb=19.6,bpm=5.0,obpm=4.6,dbpm=0.5,height=77.8,wing=81.5,reach=105.0,weight=208),
  _hist("kobe_brown","Kobe Brown",2023,30,"Los Angeles Clippers","Missouri","Wing","SEC",_dt.date(2000,1,1),34,15.9,6.4,2.6,
        ts=0.656,efg=62.5,usg=23.5,ft=79.2,tp3=45.5,twop=59.8,rimfg=68.9,midfg=40.0,ast=16.7,tov=9.4,ator=1.58,oreb=7.3,stl=2.8,blk=1.9,dreb=18.3,bpm=8.2,obpm=7.4,dbpm=0.7,height=78.5,wing=84.8,reach=106.5,weight=252),

  # === 2022 draft, first round =============================================
  _hist("banchero","Paolo Banchero",2022,1,"Orlando Magic","Duke","Wing","ACC",_dt.date(2002,11,12),39,17.3,7.9,3.3,
        ts=0.557,efg=52.0,usg=27.2,ft=72.9,tp3=33.8,twop=52.5,rimfg=67.6,midfg=37.9,ast=17.5,tov=10.9,ator=1.37,oreb=6.5,stl=1.9,blk=2.7,dreb=19.1,bpm=4.8,obpm=5.1,dbpm=1.6,height=81.3,wing=84.5,reach=None,weight=250),
  _hist("holmgren","Chet Holmgren",2022,2,"Oklahoma City Thunder","Gonzaga","Big","WCC",_dt.date(2002,5,1),32,14.1,9.9,1.9,
        ts=0.691,efg=68.0,usg=21.4,ft=71.7,tp3=39.0,twop=73.7,rimfg=84.0,midfg=48.0,ast=11.4,tov=12.6,ator=1.07,oreb=8.0,stl=1.6,blk=11.9,dreb=28.7,bpm=14.1,obpm=7.1,dbpm=7.0,height=84.0,wing=90.0,reach=None,weight=195),
  _hist("jabari_smith","Jabari Smith Jr.",2022,3,"Houston Rockets","Auburn","Wing","SEC",_dt.date(2003,5,13),34,17.0,7.5,2.1,
        ts=0.572,efg=52.2,usg=26.2,ft=79.9,tp3=42.2,twop=43.5,rimfg=65.1,midfg=35.8,ast=13.8,tov=9.9,ator=1.05,oreb=3.5,stl=2.1,blk=3.8,dreb=23.4,bpm=9.4,obpm=8.1,dbpm=3.2,height=82.5,wing=85.0,reach=None,weight=200),
  _hist("keegan_murray","Keegan Murray",2022,4,"Sacramento Kings","Iowa","Wing","Big Ten",_dt.date(2000,8,19),35,23.6,8.8,1.5,
        ts=0.638,efg=61.4,usg=28.1,ft=74.7,tp3=39.8,twop=62.1,rimfg=70.8,midfg=40.5,ast=10.1,tov=5.1,ator=1.37,oreb=9.8,stl=2.3,blk=6.4,dreb=20.2,bpm=15.1,obpm=12.6,dbpm=2.5,height=79.5,wing=84.0,reach=None,weight=215),
  _hist("ivey","Jaden Ivey",2022,5,"Detroit Pistons","Purdue","Guard","Big Ten",_dt.date(2002,2,13),36,17.4,4.9,3.2,
        ts=0.580,efg=53.4,usg=27.7,ft=74.4,tp3=35.8,twop=53.3,rimfg=67.9,midfg=29.3,ast=19.2,tov=11.5,ator=1.24,oreb=2.7,stl=1.7,blk=2.0,dreb=15.0,bpm=6.6,obpm=5.6,dbpm=1.0,height=75.0,wing=81.0,reach=None,weight=194),
  _hist("mathurin","Bennedict Mathurin",2022,6,"Indiana Pacers","Arizona","Wing","Pac-12",_dt.date(2002,6,19),37,17.7,5.7,2.6,
        ts=0.577,efg=53.7,usg=23.5,ft=76.4,tp3=37.2,twop=51.9,rimfg=63.8,midfg=27.9,ast=13.8,tov=8.6,ator=1.46,oreb=5.1,stl=1.6,blk=0.8,dreb=12.6,bpm=3.2,obpm=5.7,dbpm=1.0,height=76.5,wing=81.0,reach=104.0,weight=204.6),
  _hist("sharpe","Shaedon Sharpe",2022,7,"Portland Trail Blazers","Kentucky","Guard","SEC",_dt.date(2003,5,30),None,None,None,None),  # enrolled at Kentucky but never played a college game
  _hist("daniels","Dyson Daniels",2022,8,"New Orleans Pelicans","G League Ignite","Guard",None,_dt.date(2003,3,17),None,None,None,None),
  _hist("sochan","Jeremy Sochan",2022,9,"San Antonio Spurs","Baylor","Wing","Big 12",_dt.date(2003,5,20),30,9.2,6.4,1.9,
        ts=0.546,efg=53.1,usg=20.0,ft=58.9,tp3=29.6,twop=58.5,rimfg=75.0,midfg=40.3,ast=12.3,tov=None,ator=1.16,oreb=8.9,stl=2.9,blk=3.2,dreb=20.6,bpm=7.2,obpm=3.3,dbpm=3.9,height=79.5,wing=84.0,reach=None,weight=230),
  _hist("johnny_davis","Johnny Davis",2022,10,"Washington Wizards","Wisconsin","Guard","Big Ten",_dt.date(2002,2,27),31,19.8,8.3,2.2,
        ts=0.522,efg=46.3,usg=31.6,ft=79.1,tp3=30.3,twop=46.6,rimfg=62.2,midfg=36.8,ast=14.6,tov=9.5,ator=0.94,oreb=4.3,stl=2.0,blk=2.3,dreb=23.8,bpm=3.4,obpm=5.5,dbpm=2.5,height=76.3,wing=80.5,reach=103.5,weight=196.4),
  _hist("dieng","Ousmane Dieng",2022,11,"New York Knicks","New Zealand Breakers","Wing",None,_dt.date(2003,5,21),None,None,None,None),
  _hist("jalen_williams","Jalen Williams",2022,12,"Oklahoma City Thunder","Santa Clara","Guard","WCC",_dt.date(2001,4,14),33,18.1,4.5,4.3,
        ts=0.601,efg=56.2,usg=24.9,ft=80.9,tp3=39.6,twop=55.1,rimfg=66.7,midfg=39.3,ast=22.7,tov=9.0,ator=2.06,oreb=2.0,stl=1.9,blk=1.5,dreb=11.7,bpm=5.5,obpm=4.6,dbpm=0.9,height=76.5,wing=86.3,reach=None,weight=209),
  _hist("duren","Jalen Duren",2022,13,"Charlotte Hornets","Memphis","Big","American",_dt.date(2003,11,18),29,12.0,8.2,1.4,
        ts=0.608,efg=59.7,usg=23.0,ft=62.5,tp3=0.0,twop=60.0,rimfg=73.0,midfg=36.1,ast=10.5,tov=15.9,ator=0.64,oreb=14.0,stl=1.8,blk=9.9,dreb=21.5,bpm=6.6,obpm=3.5,dbpm=3.2,height=81.3,wing=89.3,reach=None,weight=250),
  _hist("agbaji","Ochai Agbaji",2022,14,"Cleveland Cavaliers","Kansas","Guard","Big 12",_dt.date(2000,4,20),39,18.9,5.2,1.6,
        ts=0.595,efg=57.0,usg=23.3,ft=74.3,tp3=40.7,twop=53.4,rimfg=72.6,midfg=28.6,ast=8.7,tov=9.8,ator=0.81,oreb=2.8,stl=1.5,blk=1.7,dreb=12.9,bpm=8.2,obpm=6.6,dbpm=1.7,height=76.5,wing=82.0,reach=104.0,weight=216.8),
  _hist("mark_williams","Mark Williams",2022,15,"Charlotte Hornets","Duke","Big","ACC",_dt.date(2001,12,16),39,11.2,7.5,0.9,
        ts=0.724,efg=71.8,usg=18.6,ft=72.7,tp3=0.0,twop=72.1,rimfg=78.1,midfg=43.5,ast=6.9,tov=10.0,ator=0.97,oreb=13.2,stl=1.3,blk=11.3,dreb=21.4,bpm=12.2,obpm=7.9,dbpm=4.4,height=84.0,wing=90.5,reach=None,weight=242),
  _hist("griffin","AJ Griffin",2022,16,"Atlanta Hawks","Duke","Wing","ACC",_dt.date(2003,8,25),39,10.4,3.9,1.1,
        ts=0.630,efg=61.3,usg=16.9,ft=79.2,tp3=44.7,twop=54.7,rimfg=72.4,midfg=41.8,ast=6.8,tov=None,ator=1.57,oreb=3.8,stl=1.2,blk=2.2,dreb=13.5,bpm=7.6,obpm=6.7,dbpm=0.9,height=76.5,wing=82.5,reach=None,weight=222),
  _hist("eason","Tari Eason",2022,17,"Houston Rockets","LSU","Wing","SEC",_dt.date(2001,5,10),33,17.0,6.7,1.0,
        ts=0.615,efg=55.9,usg=30.8,ft=80.3,tp3=35.9,twop=56.4,rimfg=64.3,midfg=33.8,ast=10.1,tov=None,ator=0.56,oreb=10.5,stl=4.6,blk=6.5,dreb=19.8,bpm=13.6,obpm=8.6,dbpm=5.2,height=78.8,wing=86.0,reach=107.5,weight=217.4),
  _hist("terry","Dalen Terry",2022,18,"Chicago Bulls","Arizona","Guard","Pac-12",_dt.date(2002,7,12),37,8.1,4.8,4.0,
        ts=0.584,efg=56.3,usg=15.1,ft=73.6,tp3=36.4,twop=57.2,rimfg=68.9,midfg=30.4,ast=22.1,tov=10.9,ator=1.60,oreb=5.0,stl=2.5,blk=1.1,dreb=12.8,bpm=6.8,obpm=3.1,dbpm=3.6,height=78.0,wing=84.8,reach=106.0,weight=195),
  _hist("laravia","Jake LaRavia",2022,19,"Minnesota Timberwolves","Wake Forest","Wing","ACC",_dt.date(2001,11,3),33,14.7,6.7,3.8,
        ts=0.647,efg=60.4,usg=21.6,ft=77.7,tp3=38.4,twop=61.3,rimfg=67.3,midfg=50.0,ast=20.0,tov=14.0,ator=1.48,oreb=7.5,stl=2.7,blk=2.9,dreb=14.1,bpm=2.8,obpm=4.6,dbpm=3.6,height=78.8,wing=81.5,reach=104.0,weight=227),
  _hist("branham","Malaki Branham",2022,20,"San Antonio Spurs","Ohio State","Guard","Big Ten",_dt.date(2003,5,12),32,13.7,3.6,2.0,
        ts=0.594,efg=55.4,usg=23.4,ft=83.3,tp3=41.1,twop=53.0,rimfg=72.2,midfg=43.1,ast=14.7,tov=None,ator=1.24,oreb=3.5,stl=1.6,blk=1.0,dreb=10.5,bpm=4.3,obpm=4.7,dbpm=0.4,height=76.0,wing=82.0,reach=102.5,weight=194.8),
  _hist("braun","Christian Braun",2022,21,"Denver Nuggets","Kansas","Guard","Big 12",_dt.date(2001,4,17),40,14.1,6.6,2.9,
        ts=0.585,efg=55.6,usg=20.2,ft=73.3,tp3=38.6,twop=54.5,rimfg=62.9,midfg=36.0,ast=14.5,tov=None,ator=1.46,oreb=4.9,stl=1.6,blk=2.5,dreb=16.0,bpm=8.1,obpm=5.3,dbpm=2.9,height=77.5,wing=78.5,reach=99.5,weight=209.2),
  _hist("kessler","Walker Kessler",2022,22,"Memphis Grizzlies","Auburn","Big","SEC",_dt.date(2001,7,26),34,11.4,8.1,0.9,
        ts=0.627,efg=62.7,usg=19.0,ft=59.6,tp3=20.0,twop=70.2,rimfg=78.3,midfg=31.6,ast=7.0,tov=9.8,ator=0.86,oreb=10.9,stl=2.4,blk=18.8,dreb=22.1,bpm=7.4,obpm=6.0,dbpm=7.5,height=84.3,wing=88.3,reach=113.0,weight=256),
  _hist("roddy","David Roddy",2022,23,"Philadelphia 76ers","Colorado State","Wing","Mountain West",_dt.date(2001,3,27),30,19.4,7.6,3.0,
        ts=0.649,efg=63.4,usg=28.8,ft=69.4,tp3=43.7,twop=62.5,rimfg=71.5,midfg=51.6,ast=19.8,tov=None,ator=1.27,oreb=7.3,stl=2.1,blk=4.0,dreb=20.8,bpm=3.8,obpm=3.7,dbpm=0.2,height=76.5,wing=83.5,reach=105.0,weight=261),
  _hist("beauchamp","MarJon Beauchamp",2022,24,"Milwaukee Bucks","G League Ignite","Wing",None,_dt.date(2000,10,12),None,None,None,None),
  _hist("wesley","Blake Wesley",2022,25,"San Antonio Spurs","Notre Dame","Guard","ACC",_dt.date(2003,3,16),34,14.4,3.7,2.4,
        ts=0.494,efg=46.2,usg=30.7,ft=66.7,tp3=30.2,twop=46.7,rimfg=51.2,midfg=39.2,ast=17.4,tov=None,ator=1.11,oreb=2.9,stl=2.6,blk=0.2,dreb=11.4,bpm=0.7,obpm=0.3,dbpm=0.4,height=75.0,wing=81.0,reach=103.0,weight=187),
  _hist("wendell_moore","Wendell Moore Jr.",2022,26,"Dallas Mavericks","Duke","Wing","ACC",_dt.date(2001,9,18),39,13.4,5.4,4.5,
        ts=0.605,efg=56.9,usg=20.3,ft=80.5,tp3=41.3,twop=54.4,rimfg=64.4,midfg=40.4,ast=21.7,tov=None,ator=2.26,oreb=4.3,stl=2.3,blk=0.6,dreb=12.4,bpm=1.8,obpm=5.5,dbpm=2.0,height=76.3,wing=84.5,reach=None,weight=217),
  _hist("jovic","Nikola Jović",2022,27,"Miami Heat","Mega Basket (Serbia)","Wing",None,_dt.date(2003,6,9),None,None,None,None),
  _hist("baldwin","Patrick Baldwin Jr.",2022,28,"Golden State Warriors","Milwaukee","Wing","Horizon",_dt.date(2002,11,18),11,12.1,5.7,1.5,
        ts=0.450,efg=40.8,usg=27.2,ft=74.3,tp3=26.6,twop=41.8,rimfg=51.9,midfg=35.0,ast=12.2,tov=12.1,ator=0.72,oreb=3.7,stl=1.7,blk=2.5,dreb=17.8,bpm=-1.7,obpm=-0.5,dbpm=-1.2,height=81.0,wing=86.0,reach=110.0,weight=231),
  _hist("tyty_washington","TyTy Washington Jr.",2022,29,"Memphis Grizzlies","Kentucky","Guard","SEC",_dt.date(2001,11,15),31,12.5,3.5,3.9,
        ts=0.528,efg=50.4,usg=22.2,ft=75.0,tp3=35.0,twop=49.6,rimfg=59.6,midfg=46.3,ast=23.0,tov=8.7,ator=2.48,oreb=2.6,stl=2.6,blk=0.7,dreb=10.7,bpm=6.6,obpm=3.9,dbpm=2.7,height=74.3,wing=80.0,reach=99.5,weight=196),
  _hist("peyton_watson","Peyton Watson",2022,30,"Oklahoma City Thunder","UCLA","Wing","Pac-12",_dt.date(2002,9,11),32,3.3,2.9,0.9,
        ts=0.394,efg=35.2,usg=21.2,ft=68.8,tp3=22.6,twop=35.6,rimfg=37.0,midfg=34.1,ast=10.1,tov=16.6,ator=0.55,oreb=8.1,stl=2.8,blk=5.3,dreb=18.7,bpm=-0.3,obpm=-3.2,dbpm=3.0,height=78.8,wing=84.5,reach=107.5,weight=203.4),

  # === 2021 draft, first round =============================================
  _hist("cade","Cade Cunningham",2021,1,"Detroit Pistons","Oklahoma State","Guard","Big 12",_dt.date(2001,9,25),27,20.3,6.2,3.5,
        ts=0.575,efg=51.6,usg=28.6,ft=84.6,tp3=40.0,twop=46.3,rimfg=62.0,midfg=34.1,ast=20.2,tov=15.4,ator=0.83,oreb=2.3,stl=2.5,blk=2.3,dreb=16.2,bpm=4.8,obpm=4.8,dbpm=2.7,height=78.0,wing=84.0,reach=None,weight=220),
  _hist("jalen_green","Jalen Green",2021,2,"Houston Rockets","G League Ignite","Guard",None,_dt.date(2002,2,9),None,None,None,None),
  _hist("mobley","Evan Mobley",2021,3,"Cleveland Cavaliers","USC","Big","Pac-12",_dt.date(2001,6,18),33,16.4,8.7,2.5,
        ts=0.624,efg=59.5,usg=23.4,ft=69.4,tp3=30.0,twop=61.5,rimfg=78.5,midfg=45.9,ast=14.1,tov=11.8,ator=1.18,oreb=9.7,stl=1.4,blk=8.7,dreb=18.8,bpm=8.9,obpm=7.3,dbpm=5.3,height=82.0,wing=88.0,reach=None,weight=215),
  _hist("barnes","Scottie Barnes",2021,4,"Toronto Raptors","Florida State","Wing","ACC",_dt.date(2001,8,1),24,10.4,4.1,4.2,
        ts=0.548,efg=53.1,usg=25.3,ft=62.1,tp3=27.5,twop=56.1,rimfg=68.5,midfg=39.4,ast=31.6,tov=14.2,ator=1.38,oreb=7.4,stl=3.4,blk=2.1,dreb=11.0,bpm=7.3,obpm=4.1,dbpm=3.2,height=79.0,wing=86.8,reach=108.0,weight=225.4),
  _hist("suggs","Jalen Suggs",2021,5,"Orlando Magic","Gonzaga","Guard","WCC",_dt.date(2001,6,3),30,14.3,5.4,4.6,
        ts=0.594,efg=55.9,usg=25.3,ft=75.4,tp3=33.7,twop=58.6,rimfg=63.4,midfg=44.0,ast=23.7,tov=14.1,ator=1.53,oreb=2.7,stl=3.5,blk=1.1,dreb=18.0,bpm=4.8,obpm=4.3,dbpm=4.3,height=75.5,wing=77.5,reach=None,weight=200),
  _hist("giddey","Josh Giddey",2021,6,"Oklahoma City Thunder","Adelaide 36ers (Australia)","Guard",None,_dt.date(2002,10,10),None,None,None,None),
  _hist("kuminga","Jonathan Kuminga",2021,7,"Golden State Warriors","G League Ignite","Wing",None,_dt.date(2002,10,6),None,None,None,None),
  _hist("franz_wagner","Franz Wagner",2021,8,"Orlando Magic","Michigan","Wing","Big Ten",_dt.date(2001,8,27),None,12.5,6.5,3.1,
        ts=0.586,efg=54.4,usg=19.4,ft=83.5,tp3=34.3,twop=56.3,rimfg=67.7,midfg=40.0,ast=17.4,tov=8.2,ator=2.4,oreb=2.9,stl=2.3,blk=3.2,dreb=19.6,bpm=7.6,obpm=5.3,dbpm=5.5,height=81.0,wing=83.5,reach=None,weight=190),
  _hist("davion_mitchell","Davion Mitchell",2021,9,"Sacramento Kings","Baylor","Guard","Big 12",_dt.date(1998,9,5),30,14.1,2.7,5.6,
        ts=0.620,efg=61.3,usg=21.6,ft=65.2,tp3=44.7,twop=56.5,rimfg=63.1,midfg=43.9,ast=28.3,tov=11.0,ator=2.38,oreb=1.7,stl=3.4,blk=1.3,dreb=8.1,bpm=9.6,obpm=6.4,dbpm=3.3,height=72.0,wing=76.3,reach=96.5,weight=202),
  _hist("ziaire","Ziaire Williams",2021,10,"New Orleans Pelicans","Stanford","Wing","Pac-12",_dt.date(2001,9,12),None,10.7,4.6,2.3,
        ts=0.473,efg=43.1,usg=25.8,ft=79.6,tp3=29.1,twop=42.7,rimfg=53.1,midfg=36.0,ast=16.4,tov=16.2,ator=0.83,oreb=2.4,stl=1.7,blk=2.2,dreb=16.4,bpm=-0.3,obpm=-1.6,dbpm=1.3,height=80.3,wing=82.3,reach=106.5,weight=188),
  _hist("bouknight","James Bouknight",2021,11,"Charlotte Hornets","UConn","Guard","Big East",_dt.date(2000,9,18),15,18.8,5.8,1.8,
        ts=0.546,efg=49.8,usg=30.2,ft=77.8,tp3=29.3,twop=52.8,rimfg=65.8,midfg=36.9,ast=12.8,tov=12.8,ator=0.62,oreb=5.3,stl=2.2,blk=0.9,dreb=15.0,bpm=2.4,obpm=6.2,dbpm=1.9,height=75.5,wing=80.3,reach=101.5,weight=190),
  _hist("primo","Joshua Primo",2021,12,"San Antonio Spurs","Alabama","Guard","SEC",_dt.date(2002,12,24),30,8.2,3.4,0.8,
        ts=0.565,efg=54.1,usg=16.9,ft=75.0,tp3=38.1,twop=50.0,rimfg=58.7,midfg=21.1,ast=6.5,tov=13.9,ator=0.41,oreb=4.7,stl=1.3,blk=1.3,dreb=10.5,bpm=4.1,obpm=4.5,dbpm=-0.4,height=76.0,wing=81.3,reach=102.5,weight=189),
  _hist("duarte","Chris Duarte",2021,13,"Indiana Pacers","Oregon","Guard","Pac-12",_dt.date(1997,6,13),26,17.2,4.7,2.7,
        ts=0.657,efg=63.3,usg=22.5,ft=81.0,tp3=42.4,twop=63.1,rimfg=70.0,midfg=53.7,ast=14.9,tov=11.2,ator=1.24,oreb=2.8,stl=3.3,blk=2.8,dreb=14.0,bpm=10.5,obpm=7.5,dbpm=3.1,height=76.8,wing=None,reach=None,weight=175),
  _hist("moody","Moses Moody",2021,14,"Golden State Warriors","Arkansas","Guard","SEC",_dt.date(2002,5,31),32,16.9,5.9,1.6,
        ts=0.568,efg=50.3,usg=21.6,ft=81.2,tp3=35.8,twop=47.8,rimfg=56.4,midfg=39.5,ast=8.0,tov=8.6,ator=1.02,oreb=6.3,stl=1.6,blk=2.0,dreb=11.8,bpm=5.6,obpm=4.6,dbpm=1.6,height=76.5,wing=84.8,reach=105.0,weight=210.6),
  _hist("kispert","Corey Kispert",2021,15,"Washington Wizards","Gonzaga","Wing","WCC",_dt.date(1999,3,3),32,18.7,5.1,1.8,
        ts=0.674,efg=64.4,usg=20.7,ft=87.8,tp3=44.0,twop=62.8,rimfg=75.4,midfg=34.5,ast=9.0,tov=7.1,ator=1.46,oreb=3.8,stl=1.5,blk=1.4,dreb=13.9,bpm=10.5,obpm=8.8,dbpm=1.7,height=78.0,wing=79.0,reach=102.0,weight=224),
  _hist("sengun","Alperen Şengün",2021,16,"Oklahoma City Thunder","Beşiktaş (Turkey)","Big",None,_dt.date(2002,7,25),None,None,None,None),
  _hist("trey_murphy","Trey Murphy III",2021,17,"Memphis Grizzlies","Virginia","Wing","ACC",_dt.date(2000,6,18),25,11.3,3.4,1.2,
        ts=0.670,efg=63.9,usg=17.3,ft=92.7,tp3=43.3,twop=62.0,rimfg=70.2,midfg=45.8,ast=8.2,tov=6.9,ator=1.69,oreb=2.8,stl=1.8,blk=1.8,dreb=11.7,bpm=7.3,obpm=5.3,dbpm=2.1,height=79.5,wing=84.0,reach=105.5,weight=206),
  _hist("tre_mann","Tre Mann",2021,18,"Oklahoma City Thunder","Florida","Guard","SEC",_dt.date(2001,2,3),24,16.1,5.7,3.6,
        ts=0.579,efg=53.6,usg=25.9,ft=83.1,tp3=40.2,twop=49.4,rimfg=58.9,midfg=42.9,ast=22.3,tov=13.2,ator=1.24,oreb=2.6,stl=2.4,blk=0.6,dreb=17.1,bpm=6.4,obpm=4.7,dbpm=1.7,height=75.3,wing=76.0,reach=98.5,weight=178),
  _hist("kai_jones","Kai Jones",2021,19,"New York Knicks","Texas","Big","Big 12",_dt.date(2001,1,19),26,8.9,4.8,0.7,
        ts=0.646,efg=62.6,usg=18.2,ft=68.9,tp3=38.2,twop=64.2,rimfg=74.4,midfg=33.3,ast=5.4,tov=16.3,ator=0.47,oreb=10.0,stl=2.1,blk=4.2,dreb=13.4,bpm=6.7,obpm=3.6,dbpm=3.2,height=82.0,wing=85.8,reach=110.5,weight=221),
  _hist("jalen_johnson","Jalen Johnson",2021,20,"Atlanta Hawks","Duke","Wing","ACC",_dt.date(2001,12,18),13,11.2,6.0,2.3,
        ts=0.579,efg=56.5,usg=28.8,ft=63.2,tp3=44.4,twop=54.4,rimfg=64.1,midfg=30.8,ast=20.5,tov=None,ator=0.96,oreb=7.9,stl=3.1,blk=6.0,dreb=25.3,bpm=7.8,obpm=4.0,dbpm=3.8,height=79.8,wing=84.3,reach=None,weight=210),
  _hist("keon_johnson","Keon Johnson",2021,21,"New York Knicks","Tennessee","Guard","SEC",_dt.date(2002,3,10),27,11.3,3.5,2.6,
        ts=0.517,efg=47.4,usg=27.3,ft=70.3,tp3=27.1,twop=49.0,rimfg=57.6,midfg=41.5,ast=21.2,tov=16.3,ator=0.92,oreb=4.8,stl=2.6,blk=1.9,dreb=11.2,bpm=2.8,obpm=0.5,dbpm=2.6,height=75.5,wing=79.3,reach=None,weight=185),
  _hist("isaiah_jackson","Isaiah Jackson",2021,22,"Los Angeles Lakers","Kentucky","Big","SEC",_dt.date(2002,1,10),25,8.4,6.6,0.7,
        ts=0.587,efg=54.0,usg=21.3,ft=70.0,tp3=0.0,twop=54.8,rimfg=67.9,midfg=35.2,ast=7.5,tov=14.8,ator=0.53,oreb=11.3,stl=2.1,blk=12.8,dreb=23.4,bpm=7.5,obpm=1.9,dbpm=5.6,height=80.3,wing=87.0,reach=None,weight=206),
  _hist("garuba","Usman Garuba",2021,23,"Houston Rockets","Real Madrid (Spain)","Big",None,_dt.date(2002,3,9),None,None,None,None),
  _hist("josh_christopher","Josh Christopher",2021,24,"Houston Rockets","Arizona State","Guard","Pac-12",_dt.date(2001,12,8),15,14.3,4.7,1.4,
        ts=0.529,efg=48.3,usg=24.3,ft=80.0,tp3=30.5,twop=49.6,rimfg=72.7,midfg=35.6,ast=9.8,tov=10.2,ator=0.81,oreb=2.4,stl=2.7,blk=1.9,dreb=16.2,bpm=3.4,obpm=2.1,dbpm=1.3,height=75.3,wing=81.3,reach=101.0,weight=214.8),
  _hist("grimes","Quentin Grimes",2021,25,"Los Angeles Clippers","Houston","Guard","American",_dt.date(2000,5,8),30,17.9,5.8,2.0,
        ts=0.558,efg=52.3,usg=25.3,ft=78.8,tp3=40.3,twop=41.0,rimfg=59.2,midfg=29.0,ast=12.6,tov=None,ator=1.13,oreb=5.4,stl=2.6,blk=1.2,dreb=14.1,bpm=10.1,obpm=7.9,dbpm=2.3,height=76.0,wing=79.8,reach=101.0,weight=210),
  _hist("bones_hyland","Bones Hyland",2021,26,"Denver Nuggets","VCU","Guard","Atlantic 10",_dt.date(2000,9,14),None,None,None,None),  # not on DraftBallr — metadata only
  _hist("cam_thomas","Cam Thomas",2021,27,"Brooklyn Nets","LSU","Guard","SEC",_dt.date(2001,10,13),29,23.1,3.4,1.4,
        ts=0.552,efg=47.4,usg=29.2,ft=88.2,tp3=32.5,twop=46.4,rimfg=64.2,midfg=39.5,ast=8.3,tov=6.3,ator=0.92,oreb=2.0,stl=1.4,blk=0.7,dreb=8.2,bpm=5.3,obpm=6.6,dbpm=-1.2,height=75.0,wing=78.5,reach=None,weight=180),
  _hist("springer","Jaden Springer",2021,28,"Philadelphia 76ers","Tennessee","Guard","SEC",_dt.date(2002,9,25),25,12.5,3.5,2.9,
        ts=0.570,efg=51.1,usg=26.2,ft=81.0,tp3=43.5,twop=47.5,rimfg=65.8,midfg=34.3,ast=24.1,tov=13.5,ator=1.22,oreb=4.6,stl=2.7,blk=2.2,dreb=10.9,bpm=5.8,obpm=3.1,dbpm=2.8,height=75.0,wing=79.8,reach=99.0,weight=202),
  _hist("dayron_sharpe","Day'Ron Sharpe",2021,29,"Phoenix Suns","North Carolina","Big","ACC",_dt.date(2001,11,6),29,9.5,7.6,1.5,
        ts=0.521,efg=51.9,usg=27.5,ft=50.5,tp3=0.0,twop=52.3,rimfg=60.0,midfg=34.4,ast=15.4,tov=15.7,ator=0.75,oreb=18.3,stl=2.3,blk=5.1,dreb=23.8,bpm=6.4,obpm=3.9,dbpm=2.6,height=81.0,wing=84.0,reach=None,weight=260),
  _hist("aldama","Santi Aldama",2021,30,"Utah Jazz","Loyola (MD)","Big","Patriot",_dt.date(2001,1,10),17,21.3,10.2,2.4,
        ts=0.594,efg=57.4,usg=29.4,ft=68.6,tp3=36.8,twop=58.5,rimfg=71.6,midfg=43.2,ast=15.5,tov=13.0,ator=0.74,oreb=6.1,stl=1.7,blk=5.6,dreb=27.9,bpm=7.8,obpm=6.1,dbpm=1.7,height=82.8,wing=83.0,reach=None,weight=205),
]

PROSPECTS.extend(HISTORICAL)

for _p in PROSPECTS:
    _p.setdefault("draft_year", 2026)
