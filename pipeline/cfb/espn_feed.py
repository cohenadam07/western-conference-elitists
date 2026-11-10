"""ESPN as the primary feed: the live season and the 2021-2022 backfill (BUILD ground rule 4).

    python -m pipeline.cfb.espn_feed check            # parser against the release files, play by play
    python -m pipeline.cfb.espn_feed season 2026      # schedule + every final of a season -> work tables
    python -m pipeline.cfb.espn_feed backfill 2021    # only the finals the release files lack

What this module is for. Prompt 1 read history from the sportsdataverse release
files, which are ESPN's own feed after sportsdataverse's processing. The live
season cannot wait for those files (and the refresh has to run in the cloud),
so this module reads ESPN directly and writes the SAME tables the rest of the
pipeline already consumes:

    work/plays_<season>.parquet         one slim row per play (plays.py's schema)
    work/games.parquet                  the season's rows, scheduled games included
    raw/espn_cfb_player_box/...         box-score rows in the release files' shape
    raw/espn_cfb_team_box/...
    raw/espn_cfb_rosters/...

so nothing downstream knows which source a season came from. `check` proves
the two routes agree by parsing games both have and comparing every column.

ESPN endpoints (all cached by event id; a final is fetched once, ever):
    scoreboard   the week's games, status, site, conference flag
    summary      box scores (players and teams), the line, the header
    core plays   every play with its type, start state and participants by role

The sportsdataverse conventions this reproduces (each one measured in `check`):
  * plays are ordered by play id, not by ESPN's sequence number;
  * a play's clock is its own; the score "at the start" is the score on the
    previous play; the team with the ball on a kickoff is the RECEIVING team;
  * ESPN's raw type names are normalised (see TYPE_FIX);
  * rush / pass / sack on fumble and safety plays come from the play text.
"""
import re
import sys
import json
import numpy as np
import pandas as pd

from .espn_http import get_json, pmap
from .paths import RAW, WORK

SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
SB_WEEK = SITE + "/scoreboard?groups=80&limit=400&seasontype={t}&week={w}&dates={s}"
SUMMARY = SITE + "/summary?event={e}"
PLAYS = CORE + "/events/{e}/competitions/{e}/plays?limit=300&page={p}"
ROSTER = SITE + "/teams/{t}/roster"
REG_WEEKS = 16
BATCH = 24          # games fetched and parsed at a time (memory, not speed: see build_season)

# ESPN's raw play types -> the names the release files (and plays.py) use
TYPE_FIX = {"Pass Interception Return": "Interception Return", "Pass Interception": "Interception Return",
            "Interception": "Interception Return", "Pass Completion": "Pass Reception", "Pass": "Pass Incompletion"}
# a touchdown ESPN left on the plain type (its stat-crew text format often does): sportsdataverse's renames
TD_FIX = {"Pass Reception": "Passing Touchdown", "Rush": "Rushing Touchdown", "Sack": "Fumble Recovery (Opponent) Touchdown",
          "Fumble Recovery (Opponent)": "Fumble Recovery (Opponent) Touchdown",
          "Fumble Recovery (Own)": "Fumble Recovery (Own) Touchdown", "Interception Return": "Interception Return Touchdown",
          "Kickoff": "Kickoff Return Touchdown", "Kickoff Return (Offense)": "Kickoff Return Touchdown",
          "Punt": "Punt Return Touchdown", "Punt Return": "Punt Return Touchdown", "Blocked Punt": "Blocked Punt Touchdown",
          "Blocked Field Goal": "Blocked Field Goal Touchdown", "Missed Field Goal Return": "Missed Field Goal Return Touchdown"}
_RE_TD = re.compile(r"touchdown|\bfor a td\b|\btd\b", re.I)
_RE_KNEEL = re.compile(r"kneel|takes? a knee|knee down", re.I)
RUSH_T = {"Rush", "Rushing Touchdown"}
PASS_T = {"Pass Reception", "Pass Incompletion", "Passing Touchdown", "Sack", "Interception Return",
          "Interception Return Touchdown"}
INT_T = {"Interception Return", "Interception Return Touchdown"}
COMP_T = {"Pass Reception", "Passing Touchdown"}
AMBIG_T = {"Fumble Recovery (Opponent)", "Fumble Recovery (Own)", "Fumble", "Fumble Recovery (Opponent) Touchdown",
           "Fumble Recovery (Own) Touchdown", "Fumble Return Touchdown", "Safety", "Punt Team Fumble Recovery Touchdown"}
LOST_T = {"Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown", "Fumble Return Touchdown",
          "Punt Team Fumble Recovery", "Punt Team Fumble Recovery Touchdown", "Kickoff Team Fumble Recovery",
          "Kickoff Team Fumble Recovery Touchdown"}
KICK_T = {"Kickoff", "Kickoff Return (Offense)", "Kickoff Return Touchdown", "Kickoff Team Fumble Recovery", "Kickoff Team Fumble Recovery Touchdown",
          "Kickoff (Safety)", "Kickoff Return (Defense)"}

_RE_TEAM = re.compile(r"/teams/(\d+)")
_RE_ATH = re.compile(r"/athletes/(\d+)")
_RE_DRIVE = re.compile(r"/drives/(\d+)")
_RE_FG = re.compile(r"(\d+)\s*-?\s*y(?:ar)?ds?\.? field goal|field goal attempt from (\d+)|(\d+) yd fg", re.I)
_RE_PUNT = re.compile(r"punts? (?:for )?(\d+) y", re.I)
_RE_RET = re.compile(r"return(?:s|ed)? (?:for )?(-?\d+) y", re.I)


def _team(ref):
    if not isinstance(ref, dict):
        return np.nan
    if ref.get("id"):
        return float(ref["id"])
    m = _RE_TEAM.search(ref.get("$ref", ""))
    return float(m.group(1)) if m else np.nan


def _clock(c):
    """Seconds left in the period from a core clock ({"value": 880.0}) or a summary one ({"displayValue": "14:40"})."""
    if not isinstance(c, dict):
        return np.nan
    if c.get("value") is not None:
        return float(c["value"])
    m = re.match(r"(\d+):(\d+)", c.get("displayValue") or "")
    return float(int(m.group(1)) * 60 + int(m.group(2))) if m else np.nan


def fetch_plays(eid):
    """All core plays of one event (cached page by page under the keys prompt 1 used)."""
    first = get_json(PLAYS.format(e=eid, p=1), f"plays_{eid}_p1")
    items = list(first.get("items", []))
    for p in range(2, int(first.get("pageCount", 1) or 1) + 1):
        items += get_json(PLAYS.format(e=eid, p=p), f"plays_{eid}_p{p}").get("items", [])
    return items


def fetch_summary(eid):
    return get_json(SUMMARY.format(e=eid), f"summary_{eid}")


def drive_order(summary):
    """Play ids in the summary's drive order, and each play's drive id.

    This is the order sportsdataverse uses (measured: a touchdown sits before the kickoff that
    follows it even when its play id is larger, and a field goal ESPN stamped with a 99:99 clock
    sits where it happened, not at the end of the game). Plays ESPN lists outside any drive
    (coin toss, end of period, a few orphans) are not in the release files either.
    """
    order, drive_of = [], {}
    dr = (summary or {}).get("drives") or {}
    for d in (dr.get("previous") or []) + ([dr["current"]] if isinstance(dr.get("current"), dict) else []):
        for p in d.get("plays") or []:
            pid = int(p["id"])
            if pid not in drive_of:
                drive_of[pid] = str(d.get("id"))
                order.append(p)
    return order, drive_of


def fix_yardline(d):
    """Fill a snap ESPN sent with yardsToEndzone = 0 from its yardLine.

    Measured on 2026: 218 scrimmage plays (25 of them in one game) carry yardsToEndzone 0, in the
    summary and the core feed alike, while `yardLine` is right. yardLine runs 0-100 from one goal
    line for the whole game, so for each team it is either the distance to go or 100 minus it;
    which one is read off that team's other snaps in the same game, and only when at least 90% of
    them agree. Field goals keep their own rule (length less 17).
    """
    yl = pd.to_numeric(d.pop("_yl"), errors="coerce")
    st = d.pop("_st")
    ytg = pd.to_numeric(d.ytg, errors="coerce")
    plain = d.yds_fg.isna() & yl.between(1, 99) & st.notna()
    good = plain & ytg.between(1, 99)
    need = plain & ~ytg.between(1, 99) & d.down.isin([1, 2, 3, 4])
    if not need.any():
        return d
    d["ytg"] = ytg
    for t in st[need].unique():
        g = good & (st == t)
        if g.sum() < 5:
            continue
        same, flip = float((ytg[g] == yl[g]).mean()), float((ytg[g] == 100 - yl[g]).mean())
        if max(same, flip) < 0.9:
            continue
        m = need & (st == t)
        d.loc[m, "ytg"] = yl[m] if same >= flip else 100 - yl[m]
        gtg = m & (pd.to_numeric(d.dist, errors="coerce") <= 0)
        d.loc[gtg, "dist"] = d.loc[gtg, "ytg"]
    return d


def base_rows(eid, items, home, away, season, week, season_type, summary=None, final=None):
    """ESPN core plays -> the frame plays.finish() expects (the release files' columns, renamed)."""
    rows = []
    order, drive_of = drive_order(summary)
    core = {int(p["id"]): p for p in items}
    # The summary is the play list (it is what the release files were built from, and its scores
    # and yardage are the corrected ones); the core feed adds the participants. A game whose
    # summary has no drives falls back to the core plays in id order.
    plays = order if order else sorted(items, key=lambda p: int(p["id"]))
    for p in plays:
        cp = core.get(int(p["id"]), {})
        t = (p.get("type") or {}).get("text")
        if t is None:
            continue
        t = TYPE_FIX.get(t, t)
        st, en = p.get("start") or {}, p.get("end") or {}
        text = p.get("text") or ""
        low = text.lower()
        st_team, en_team = _team(st.get("team")), _team(en.get("team"))
        if t == "Pass Incompletion" and "pass complete" in low and "pass incomplete" not in low:
            t = "Pass Reception"
        # (only when ESPN itself flags a score: the stat crew's review notes also say "touchdown")
        if t in TD_FIX and p.get("scoringPlay") and _RE_TD.search(text) and "no play" not in low and "nullified" not in low:
            t = TD_FIX[t]
        per = int((p.get("period") or {}).get("number") or 0)
        clock = _clock(p.get("clock"))
        if clock != clock:
            clock = _clock(cp.get("clock"))
        roles = {}
        for part in sorted((cp or p).get("participants") or [], key=lambda x: x.get("order", 0)):
            m = _RE_ATH.search((part.get("athlete") or {}).get("$ref", ""))
            if m:
                roles.setdefault(part.get("type"), []).append(float(m.group(1)))

        def r(name, i=0):
            v = roles.get(name, [])
            return v[i] if len(v) > i else np.nan

        ambig = t in AMBIG_T
        sack = (t == "Sack") or (ambig and "sacked" in low)
        pas = (t in PASS_T) or sack or (ambig and (" pass " in f" {low} " or "pass complete" in low or "pass incomplete" in low
                                                  or "pass from" in low))
        rush = (t in RUSH_T) or (ambig and not pas and ("run for" in low or " rush " in f" {low} " or "rush for" in low
                                                         or "scramble" in low or "rushing" in low))
        comp = (t in COMP_T) or (ambig and pas and not sack and ("pass complete" in low or "pass from" in low
                                                                 or " reception" in low))
        is_kick = t in KICK_T
        if is_kick:                      # the receiving team "has the ball" on a kickoff
            off = away if st_team == home else home if st_team == away else np.nan
        else:
            off = st_team
        deff = away if off == home else home if off == away else np.nan
        mfg = _RE_FG.search(text)
        mpu = _RE_PUNT.search(text)
        mrt = _RE_RET.search(text)
        dm = _RE_DRIVE.search((p.get("drive") or {}).get("$ref", ""))
        half = 1 if per in (1, 2) else 2
        secs_half = clock + (900 if per in (1, 3) else 0)
        fg_like = t.startswith("Field Goal") or "Field Goal" in t
        fgd = float(mfg.group(1) or mfg.group(2) or mfg.group(3)) if (mfg and fg_like) else np.nan
        ytg = st.get("yardsToEndzone")
        if fgd == fgd:
            ytg = fgd - 17                      # the spot of a field goal is its length less 17
        dist = st.get("distance")
        if dist is not None and ytg is not None and dist <= 0 and (st.get("down") or 0) in (1, 2, 3, 4):
            dist = ytg                          # goal to go: ESPN sends 0
        punt_like = t.startswith("Punt") or t.startswith("Blocked Punt")
        kicker = r("kicker")
        rows.append({
            "game_id": int(eid), "play_id": int(p["id"]), "drive_id": drive_of.get(int(p["id"])) or (dm.group(1) if dm else None),
            "season_type": season_type, "week": week, "period": per, "half": half,
            "secs_half": secs_half, "secs_game": secs_half + (1800 if half == 1 else 0),
            "down": 1 if is_kick else st.get("down"), "dist": 10 if is_kick else dist, "ytg": ytg,
            "ytg_end": en.get("yardsToEndzone"), "off": off, "deff": deff, "home": float(home), "away": float(away),
            "home_score_row": p.get("homeScore"), "away_score_row": p.get("awayScore"),
            "scoring": bool(p.get("scoringPlay")), "ptype": t, "text": text, "yards": p.get("statYardage") or 0,
            "f_rush": bool(rush), "f_pass": bool(pas), "f_sack": bool(sack), "f_int": t in INT_T, "f_comp": bool(comp),
            "f_att": bool(pas and not sack), "f_target": bool(pas and not sack), "f_td": "Touchdown" in t,
            "f_fum": "fumble" in low, "f_fum_lost": t in LOST_T, "f_pen": "penalty" in low,
            "f_pen_noplay": "no play" in low or "nullified by penalty" in low,
            "f_kneel": bool(_RE_KNEEL.search(text)) or low.startswith(("team run", "team rush")), "f_hurry": "hurr" in low, "f_pbu": "broken up" in low or "breakup" in low,
            "f_ff": "forced by" in low or "forced fumble" in low,
            "yds_rushed": np.nan, "yds_receiving": np.nan, "yds_sacked": np.nan,
            "yds_fg": fgd,
            "yds_punted": float(mpu.group(1)) if (mpu and punt_like) else np.nan,
            "yds_punt_ret": (float(mrt.group(1)) if mrt else 0.0) if punt_like else np.nan,
            "yds_kick": np.nan, "yds_kick_ret": float(mrt.group(1)) if (mrt and is_kick) else np.nan,
            "pen_team": np.nan, "pen_yards": np.nan, "pen_yards_txt": None,
            "rusher": r("rusher"), "passer": r("passer"), "receiver": r("receiver"),
            "sack1": r("sackedBy"), "sack2": r("sackedBy", 1),
            "int_by": r("passDefender") if t in INT_T else np.nan,
            "pbu_by": r("passDefender") if t not in INT_T else np.nan,
            "ff_by": r("forcedBy"), "fumbler": r("fumbler"),
            "kicker": kicker if fg_like else np.nan, "punter": r("punter"),
            "ko_kicker": kicker if is_kick else np.nan, "ko_ret": r("returner") if is_kick else np.nan,
            "punt_ret": r("returner") if punt_like else np.nan,
            "rel_epa": np.nan, "rel_ep": np.nan, "rel_wp": np.nan,
            "tk1": r("tackler"), "tk2": r("tackler", 1), "ast1": r("assistedBy"), "ast2": r("assistedBy", 1),
            "pdef1": r("passDefender"), "pdef2": r("passDefender", 1), "skby1": r("sackedBy"), "skby2": r("sackedBy", 1),
            "ffby1": r("forcedBy"), "ffby2": r("forcedBy", 1), "recby1": r("recoverer"), "recby2": r("recoverer", 1),
            "has_part": bool(roles), "_yl": st.get("yardLine"), "_st": st_team,
        })
    d = pd.DataFrame(rows)
    if not len(d):
        return d
    d = fix_yardline(d)
    d["gpn"] = np.arange(1, len(d) + 1)
    # The score at the start of a play. ESPN's running score cannot be trusted row by row: it
    # ticks over early, timeout rows carry stale values, and even scoring rows are sometimes
    # wrong (measured on 2026: a team shown "at 4" that finished with 2; a touchdown that moved
    # the score from 10 to 11). So the score is rebuilt from the scoring plays themselves, and
    # ESPN's number is used only to settle what the play type cannot say (a missed extra point,
    # a two-point try), and only when it is a possible value for that kind of score.
    #
    # Better still, where the summary has it: ESPN's own scoring summary (`scoringPlays`), the
    # list a box score prints. Its running score matched the official final in every 2026 game
    # that has one, so a play found there sets the score outright.
    from .plays import OFF_TD, DEF_TD, FG_GOOD, SAFETY
    official = {}
    for sp in (summary or {}).get("scoringPlays") or []:
        try:
            official[int(sp["id"])] = (float(sp["homeScore"]), float(sp["awayScore"]))
        except (KeyError, TypeError, ValueError):
            pass
    h, a = 0.0, 0.0
    sh, sa = np.zeros(len(d)), np.zeros(len(d))
    for i, (pid, t, off, home, hrow, arow) in enumerate(zip(d.play_id, d.ptype, d.off, d.home, d.home_score_row,
                                                            d.away_score_row)):
        sh[i], sa[i] = h, a
        if pid in official:
            h, a = max(h, official[pid][0]), max(a, official[pid][1])
            if final is not None and final[0] == final[0]:      # never past the official final
                h, a = min(h, final[0]), min(a, final[1])
            continue
        if official:
            continue
        if t in OFF_TD or t in DEF_TD:
            default, allowed = 7.0, (6.0, 7.0, 8.0)
        elif t in FG_GOOD:
            default, allowed = 3.0, (3.0,)
        elif t in SAFETY:
            default, allowed = 2.0, (2.0,)
        else:
            continue
        if off != off:
            continue
        for_offence = (t in OFF_TD) or (t in FG_GOOD)
        home_scores = (off == home) == for_offence
        cur, row = (h, hrow) if home_scores else (a, arow)
        delta = (row - cur) if row is not None and row == row else default
        add = delta if delta in allowed else default
        if home_scores:
            h += add
        else:
            a += add
    d["score_diff"] = np.where(d.off == d.home, sh - sa, sa - sh)
    d["end_home"], d["end_away"] = h, a
    d["season"] = season
    return d


def parse_game(eid, season, week, season_type, home, away):
    from .plays import finish
    d = base_rows(eid, fetch_plays(eid), home, away, season, week, season_type, fetch_summary(eid))
    return finish(d.drop(columns=["end_home", "end_away"])) if len(d) else d


# ---------------------------------------------------------------- a whole season from ESPN
def scoreboards(season, fresh=False):
    """Every FBS game of a season from the weekly scoreboards: regular season, then bowls and playoff."""
    events = {}
    weeks = [(2, w) for w in range(1, REG_WEEKS + 1)] + [(3, 1)]
    docs = pmap(lambda tw: get_json(SB_WEEK.format(t=tw[0], w=tw[1], s=season), f"scoreboard_{season}_t{tw[0]}_wk{tw[1]}",
                                    fresh=fresh), weeks)
    for (t, w), sb in zip(weeks, docs):
        for e in sb.get("events", []):
            events[int(e["id"])] = (t, w, e)
    return events


def games_rows(season, events, fbs):
    """The season's rows of work/games.parquet (plays.build_games' columns), scheduled games included."""
    rows = []
    for eid, (t, w, e) in sorted(events.items()):
        c = e["competitions"][0]
        comp = {x["homeAway"]: x for x in c["competitors"]}
        if "home" not in comp or "away" not in comp:
            continue
        h, a = int(comp["home"]["team"]["id"]), int(comp["away"]["team"]["id"])
        st = (c.get("status") or e.get("status") or {}).get("type") or {}
        final = bool(st.get("completed")) and st.get("name") == "STATUS_FINAL"
        note = "; ".join(n.get("headline", "") for n in c.get("notes") or []) or None
        hp = float(comp["home"].get("score") or 0) if final else np.nan
        ap = float(comp["away"].get("score") or 0) if final else np.nan
        rows.append({
            "game_id": eid, "season": season, "week": int((e.get("week") or {}).get("number") or w), "season_type": t,
            "date": pd.Timestamp(e["date"]), "neutral_site": bool(c.get("neutralSite")),
            "conference_competition": bool(c.get("conferenceCompetition")), "home": h, "away": a,
            "home_team": comp["home"]["team"].get("displayName"), "away_team": comp["away"]["team"].get("displayName"),
            "home_pts": hp, "away_pts": ap, "final": final, "status": st.get("name"),
            "home_fbs": h in fbs.index, "home_conf": fbs.conference.get(h), "home_div": fbs.division.get(h),
            "away_fbs": a in fbs.index, "away_conf": fbs.conference.get(a), "away_div": fbs.division.get(a),
            "notes": note, "playoff_round_name": None, "conference_game": bool(c.get("conferenceCompetition")),
            "spread_home": np.nan, "spread_src": None, "spread_espn": np.nan, "fpi_home_margin": np.nan, "fpi_home_wp": np.nan,
        })
    g = pd.DataFrame(rows)
    g["date"] = pd.to_datetime(g.date, utc=True)
    g["fbs_game"] = g.home_fbs & g.away_fbs
    g["home_margin"] = g.home_pts - g.away_pts
    return g


def box_rows(eid, season, summary):
    """Player and team box rows in the release files' shape (one row per player per stat category)."""
    prow, trow = [], []
    bx = (summary or {}).get("boxscore") or {}
    for tm in bx.get("players") or []:
        tid = int(tm["team"]["id"])
        for cat in tm.get("statistics") or []:
            keys = cat.get("keys") or []
            for a in cat.get("athletes") or []:
                ath = a.get("athlete") or {}
                r = {"game_id": eid, "season": season, "team_id": tid, "category": cat.get("name"),
                     "athlete_id": ath.get("id"), "athlete_name": ath.get("displayName"), "jersey": ath.get("jersey")}
                r.update(dict(zip(keys, a.get("stats") or [])))
                prow.append(r)
    for tm in bx.get("teams") or []:
        r = {"game_id": eid, "season": season, "team_id": int(tm["team"]["id"]),
             "team_abbreviation": tm["team"].get("abbreviation"), "team_name": tm["team"].get("displayName"),
             "home_away": tm.get("homeAway")}
        r.update({x["name"]: x.get("displayValue") for x in tm.get("statistics") or []})
        trow.append(r)
    return prow, trow


def spread_of(summary, home_abbr=None):
    """The closing line from the summary, home side negative when the home team is favoured."""
    for pc in (summary or {}).get("pickcenter") or []:
        if pc.get("spread") is not None:
            try:
                return float(pc["spread"])
            except (TypeError, ValueError):
                pass
    return np.nan


def roster_rows(season, team, doc):
    out = []
    for grp in doc.get("athletes") or []:
        for a in grp.get("items") or []:
            pos, exp, bp = a.get("position") or {}, a.get("experience") or {}, a.get("birthPlace") or {}
            out.append({"season": season, "team_id": team, "athlete_id": a.get("id"),
                        "position_abbreviation": pos.get("abbreviation"), "position_name": pos.get("name"),
                        "athlete_display_name": a.get("displayName") or a.get("fullName"), "jersey": a.get("jersey"),
                        "weight": a.get("weight"), "height": a.get("height"),
                        "experience_abbreviation": exp.get("abbreviation"), "experience_years": exp.get("years"),
                        "experience_display_value": exp.get("displayValue"), "games_rostered": np.nan,
                        "headshot_href": (a.get("headshot") or {}).get("href"),
                        "birth_place_city": bp.get("city"), "birth_place_state": bp.get("state"),
                        "cfbd_recruit_ids": None})
    return out


def fbs_of(season):
    """FBS teams of a season (team id -> conference, division, school): the release table, or the committed state."""
    f = WORK / "fbs_teams.parquet"
    if f.exists():
        t = pd.read_parquet(f)
        t = t[t.season == season]
        if len(t):
            return t.set_index("team_id")
    from .state import load_state
    return pd.DataFrame(load_state()["teams"][str(season)]).set_index("team_id")


def build_season(season, only=None, fresh_days=3, rosters=True, write=True):
    """Fetch and parse a season. `only` restricts the games to a set of event ids (the backfill)."""
    from .plays import finish
    fbs = fbs_of(season)
    current = season >= pd.Timestamp.now(tz="UTC").year - (1 if pd.Timestamp.now(tz="UTC").month < 3 else 0)
    events = scoreboards(season, fresh=current)
    g = games_rows(season, events, fbs)
    fin = g[g.final & (g.home_fbs | g.away_fbs)]
    if only is not None:
        fin = fin[fin.game_id.isin(only)]
    now = pd.Timestamp.now(tz="UTC")
    recent = set(fin[(now - fin.date) < pd.Timedelta(days=fresh_days)].game_id) if current else set()

    def pull(eid):
        fr = eid in recent
        s = get_json(SUMMARY.format(e=eid), f"summary_{eid}", fresh=fr)
        first = get_json(PLAYS.format(e=eid, p=1), f"plays_{eid}_p1", fresh=fr)
        items = list(first.get("items", []))
        for p in range(2, int(first.get("pageCount", 1) or 1) + 1):
            items += get_json(PLAYS.format(e=eid, p=p), f"plays_{eid}_p{p}", fresh=fr).get("items", [])
        return s, items

    eids = list(fin.game_id)
    plays, pbox, tbox, src, spreads = [], [], [], {}, {}
    gi = g.set_index("game_id")
    # A batch at a time: a game's raw JSON is about 4 MB parsed, so holding a whole season of them
    # (as this did at first) took several GB on an 8 GB Mac. Only the parsed rows are kept.
    for i in range(0, len(eids), BATCH):
        chunk = eids[i:i + BATCH]
        for eid, (s, items) in zip(chunk, pmap(pull, chunk)):
            r = gi.loc[eid]
            d = base_rows(eid, items, int(r.home), int(r.away), season, int(r.week), int(r.season_type), s,
                          final=(float(r.home_pts), float(r.away_pts)))
            if len(d):
                plays.append(d)
            a, b = box_rows(eid, season, s)
            pbox += a
            tbox += b
            spreads[eid] = spread_of(s)
            src[eid] = {"plays": int(len(d)), "box": bool(a), "drives": bool(drive_order(s)[0])}
    g["spread_home"] = g.game_id.map(spreads)
    g["spread_espn"] = g.spread_home
    g.loc[g.spread_home.notna(), "spread_src"] = "espn"
    out = {"games": g, "sources": src}
    if plays:
        allp = pd.concat(plays, ignore_index=True)
        end = allp.groupby("game_id")[["end_home", "end_away"]].first()
        out["score_check"] = end
        d = finish(allp.drop(columns=["scoring", "end_home", "end_away"]))
        out["plays"] = d
    out["player_box"] = pd.DataFrame(pbox)
    out["team_box"] = pd.DataFrame(tbox)
    if rosters and only is None:
        teams = sorted(fbs.index)
        docs = pmap(lambda t: get_json(ROSTER.format(t=t) + (f"?season={season}" if not current else ""),
                                       f"roster_{season}_{t}", fresh=current, max_age_days=6 if current else None), teams)
        rr = []
        for t, doc in zip(teams, docs):
            rr += roster_rows(season, t, doc)
        out["rosters"] = pd.DataFrame(rr)
    if write:
        write_season(season, out, replace=only is None)
    return out


def backfill(season):
    """Add the finals the release files lack (2021 and 2022 miss about 4% of games; ESPN still serves them).

    Only games with no usable play-by-play in work/plays_<season>.parquet are fetched; everything
    already there is left exactly as the release files gave it.
    """
    from .plays import finish
    from .teamgame import MIN_PLAYS
    g = pd.read_parquet(WORK / "games.parquet")
    g = g[(g.season == season) & g.final & g.fbs_game]
    d = pd.read_parquet(WORK / f"plays_{season}.parquet")
    n = d[d.cat.isin(["rush", "pass"])].groupby("game_id").size()
    have = set(n[n >= MIN_PLAYS].index)
    rep_f = WORK / f"backfill_{season}.csv"
    if rep_f.exists():          # games an earlier backfill added are parsed again (from the cache), so a parser fix reaches them
        prev = pd.read_csv(rep_f)
        have -= set(prev[prev.used].game_id)
    todo = g[~g.game_id.isin(have)]
    print(f"{season}: {len(g)} FBS-vs-FBS finals, {len(have & set(g.game_id))} from the release files "
          f"({len(have & set(g.game_id)) / len(g):.1%}); fetching {len(todo)}", flush=True)
    new, pbox, tbox, report = [], [], [], []
    for r in todo.itertuples(index=False):
        s, items = fetch_summary(r.game_id), fetch_plays(r.game_id)      # one game in memory at a time
        x = base_rows(r.game_id, items, int(r.home), int(r.away), season, int(r.week), int(r.season_type), s,
                      final=(float(r.home_pts), float(r.away_pts)))
        scrim = int((x.f_rush | x.f_pass).sum()) if len(x) else 0
        fin_ok = bool(len(x) and x.end_home.iloc[0] == r.home_pts and x.end_away.iloc[0] == r.away_pts)
        report.append(dict(game_id=int(r.game_id), game=f"{r.away_team} at {r.home_team}", plays=len(x), scrimmage=scrim,
                           final_matches=fin_ok, used=scrim >= MIN_PLAYS))
        if scrim >= MIN_PLAYS:
            new.append(x)
            a, b = box_rows(int(r.game_id), season, s)
            pbox += a
            tbox += b
    rep = pd.DataFrame(report)
    if new:
        add = finish(pd.concat(new, ignore_index=True).drop(columns=["scoring", "end_home", "end_away"]))
        d = d[~d.game_id.isin(add.game_id)]
        for c in d.columns:
            if c not in add.columns:
                add[c] = np.nan
        add = add[d.columns].astype({c: d[c].dtype for c in d.columns if str(d[c].dtype) in ("bool", "int64")})
        d = pd.concat([d, add], ignore_index=True)
        d.to_parquet(WORK / f"plays_{season}.parquet", index=False)
        for rows, fam, name, key in ((pbox, "espn_cfb_player_box", f"player_box_{season}.parquet", "athlete_id"),
                                     (tbox, "espn_cfb_team_box", f"team_box_{season}.parquet", "team_id")):
            old = pd.read_parquet(RAW / fam / name)
            addb = pd.DataFrame(rows)
            addb = addb[~addb.game_id.isin(set(old.game_id))]
            if len(addb):
                for c in old.columns:
                    if c not in addb.columns:
                        addb[c] = None
                addb = addb[old.columns]
                for c in old.columns:
                    try:
                        addb[c] = addb[c].astype(old[c].dtype)
                    except (TypeError, ValueError):
                        old[c] = old[c].astype("string")
                        addb[c] = addb[c].astype("string")
                pd.concat([old, addb], ignore_index=True).to_parquet(RAW / fam / name, index=False)
    n = d[d.cat.isin(["rush", "pass"])].groupby("game_id").size()
    have = set(n[n >= MIN_PLAYS].index) & set(g.game_id)
    rep.to_csv(WORK / f"backfill_{season}.csv", index=False)
    print(f"{season}: added {int(rep.used.sum()) if len(rep) else 0} games "
          f"({int((rep.used & rep.final_matches).sum()) if len(rep) else 0} with the rebuilt score equal to the final); "
          f"now {len(have)} of {len(g)} = {len(have) / len(g):.2%} (gate 97%)", flush=True)
    print(rep[~rep.used].to_string(index=False) if len(rep) and (~rep.used).any() else "every fetched game was usable")
    return rep


def write_season(season, out, replace=True):
    """Write the season's tables where the rest of the pipeline reads them."""
    gp = WORK / "games.parquet"
    g = out["games"]
    if replace:
        old = pd.read_parquet(gp) if gp.exists() else None
        keep = [c for c in g.columns if old is None or c in old.columns or c == "status"]
        if old is not None:
            old = old[old.season != season]
            g = pd.concat([old, g[keep]], ignore_index=True)
        g.to_parquet(gp, index=False)
    for key, fam, name in (("player_box", "espn_cfb_player_box", f"player_box_{season}.parquet"),
                           ("team_box", "espn_cfb_team_box", f"team_box_{season}.parquet"),
                           ("rosters", "espn_cfb_rosters", f"cfb_rosters_{season}.parquet")):
        if key in out and len(out[key]) and replace:
            (RAW / fam).mkdir(parents=True, exist_ok=True)
            out[key].astype({c: "string" for c in out[key].columns if out[key][c].dtype == object
                             and c not in ("game_id", "season", "team_id")}).to_parquet(RAW / fam / name, index=False)
    if "plays" in out and replace:
        out["plays"].to_parquet(WORK / f"plays_{season}.parquet", index=False)
    (WORK / f"espn_sources_{season}.json").write_text(json.dumps(out["sources"], sort_keys=True))


def check():
    """Parse every cached game both ways and compare column by column (BUILD ground rule 1)."""
    import glob
    eids = sorted({int(re.search(r"plays_(\d+)_p1", f).group(1)) for f in glob.glob(str(RAW / "espn_live" / "plays_*_p1.json.gz"))})
    g = pd.read_parquet(WORK / "games.parquet").set_index("game_id")
    rel = {}
    out, tot = {}, 0
    cmp_cols = ["period", "secs_half", "secs_game", "down", "dist", "ytg", "off", "deff", "score_diff", "ptype", "yards", "cat",
                "f_rush", "f_pass", "f_sack", "f_int", "f_comp", "f_att", "f_fum", "f_fum_lost", "f_pen_noplay", "f_kneel", "f_spike",
                "f_pbu", "f_ff", "pts", "next_score", "halfb", "rusher", "passer", "receiver", "sack1", "int_by", "pbu_by", "ff_by",
                "kicker", "punter", "ko_ret", "punt_ret", "tk1", "tk2", "ast1", "pdef1", "skby1", "ffby1", "yds_fg", "yds_punted",
                "yds_punt_ret", "gpn", "drive_id", "hurry_txt", "f_scramble"]
    miss = []
    for eid in eids:
        if eid not in g.index:
            continue
        r = g.loc[eid]
        y = int(r.season)
        if y not in rel:
            rel[y] = pd.read_parquet(WORK / f"plays_{y}.parquet")
        a = rel[y][rel[y].game_id == eid].set_index("play_id")
        b = parse_game(eid, y, int(r.week), int(r.season_type), int(r.home), int(r.away))
        if not len(a) or not len(b):
            miss.append((eid, y, len(a), len(b)))
            continue
        b = b.set_index("play_id")
        both = a.index.intersection(b.index)
        tot += len(both)
        o = out.setdefault(y, {"games": 0, "rel": 0, "espn": 0, "both": 0})
        o["games"] += 1; o["rel"] += len(a); o["espn"] += len(b); o["both"] += len(both)
        a2, b2 = a.loc[both], b.loc[both]
        live = (a2.cat != "skip") | (b2.cat != "skip")
        for c in cmp_cols:
            x, z = a2[c], b2[c]
            if x.dtype == bool or z.dtype == bool:
                eq = x.astype(bool) == z.astype(bool)
            elif c in ("ptype", "cat", "drive_id"):
                eq = x.astype(str) == z.astype(str)
            else:
                xv, zv = pd.to_numeric(x, errors="coerce"), pd.to_numeric(z, errors="coerce")
                eq = (xv == zv) | (xv.isna() & zv.isna())
            o[c] = o.get(c, 0) + int((~eq & live).sum())
            if "-v" in sys.argv and (~eq & live).any() and c in sys.argv:
                bad = both[(~eq & live).to_numpy()][:4]
                for pid in bad:
                    print(c, eid, pid, "| rel:", a.loc[pid, c], "| espn:", b.loc[pid, c], "|", b.loc[pid, "ptype"], "|", a.loc[pid, "ptype"])
    t = pd.DataFrame(out).T
    pd.set_option("display.width", 250); pd.set_option("display.max_columns", 80)
    print(t.T.to_string())
    print("games without a counterpart:", miss)


def main(argv):
    if argv[0] == "check":
        check()
    elif argv[0] == "backfill":
        for y in argv[1:]:
            backfill(int(y))
    elif argv[0] == "season":
        out = build_season(int(argv[1]))
        g = out["games"]
        fin = g[g.final & (g.home_fbs | g.away_fbs)]
        src = out["sources"]
        print(f"{argv[1]}: {len(g)} games on the schedule, {len(fin)} finals with an FBS team, "
              f"{int(g.fbs_game.sum())} FBS-vs-FBS ({int((g.fbs_game & g.final).sum())} final); "
              f"plays for {sum(1 for v in src.values() if v['plays'] >= 80)}, box for {sum(1 for v in src.values() if v['box'])}, "
              f"drives for {sum(1 for v in src.values() if v['drives'])}; plays rows {len(out.get('plays', []))}; "
              f"roster rows {len(out.get('rosters', []))}")


if __name__ == "__main__":
    main(sys.argv[1:])
