"""
normalize.py — one ESPN college summary -> the normalized game the parser reads.

The same shape as pipeline/basketball/espn_source.normalize, extended for college:
  * teams are keyed by ESPN team id: abbreviations repeat across 362 schools' histories
  * `meta`: neutral site, conference game, season type, tournament note, venue, attendance
  * `line`: the home spread and total from ESPN's pickcenter, when it has one
  * `non_d1`: which team id, if any, is a non-Division I opponent. They have no conferenceId on
    the scoreboard, and they are played as an unnamed five: their box lines and substitutions
    are unreliable and they never enter a pool.
rung 3 and rung 4 build this same dict from CBBD and NCAA.com.
"""
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))

import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402
from namematch import words  # noqa: E402


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _split(v):
    try:
        a, b = str(v).split("-")
        return int(a), int(b)
    except Exception:  # noqa
        return 0, 0


def clock_seconds(display):
    s = str(display or "0")
    if ":" in s:
        a = s.split(":")
        try:
            return int(a[0]) * 60 + float(a[1])
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def line_of(summary):
    """Home spread and total: the first provider that has both, closing numbers if listed."""
    for pc in summary.get("pickcenter") or []:
        sp, ou = pc.get("spread"), pc.get("overUnder")
        if sp is None:
            continue
        home_fav = (pc.get("homeTeamOdds") or {}).get("favorite")
        away_fav = (pc.get("awayTeamOdds") or {}).get("favorite")
        # ESPN's spread is the favorite's number; put it on the home side
        s = -abs(float(sp)) if home_fav else abs(float(sp)) if away_fav else float(sp)
        return {"spread": s, "total": ou, "book": (pc.get("provider") or {}).get("name")}
    return None


_ROST = {}
BOXK = {"points": "pts", "offensiveRebounds": "oreb", "defensiveRebounds": "dreb", "rebounds": "reb", "assists": "ast", "turnovers": "tov", "steals": "stl", "blocks": "blk", "fouls": "pf"}
SPLITK = {"fieldGoalsMade-fieldGoalsAttempted": ("fgm", "fga"), "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("fg3m", "fg3a"), "freeThrowsMade-freeThrowsAttempted": ("ftm", "fta")}
RX_ACT = re.compile(r"^(.+?)\s+(?:made|missed|makes|misses|Offensive Rebound|Defensive Rebound|Turnover|Steal|Block)\b")


def roster_ids(season):
    """{(team id, normalized name): ESPN id} from CBBD's rosters, which keep players ESPN's box lost."""
    if season not in _ROST:
        m = {}
        p = os.path.join(CC.HOME, "ref", f"roster-{E.season_year(season)}.json")
        if os.path.exists(p):
            for t in json.load(open(p)):
                for x in t["players"]:
                    m[(str(t["teamSourceId"]), "".join(words(x.get("name"))))] = str(x.get("sourceId"))
        _ROST[season] = m
    return _ROST[season]


def fill_missing(summary, players, plays, teams, season):
    """ESPN has deleted some athlete records: the box row is blank, no id, name or stats, yet the
    team totals still count him and the play-by-play text still names him. In 2021-22 that touched
    15% of D1 games, and whole seasons of a player with it.

    His name comes from the play-by-play's shot lines, the only lines that can't be a team's, and his
    id from CBBD's rosters. One unknown shooter: his line is the team's total minus everyone listed,
    to the point. Several: each gets the line the play-by-play counts for him, and it is accepted only
    if their points add up exactly to what the team total says is missing. No play-by-play, or
    anything that doesn't add up: nothing is filled and the game fails the gate."""
    filled = 0
    for tb in (summary.get("boxscore") or {}).get("players") or []:
        t = tb["team"]["id"]
        st = (tb.get("statistics") or [{}])[0]
        keys, tot = st.get("keys") or [], st.get("totals") or []
        blanks = [a for a in st.get("athletes") or [] if not (a.get("athlete") or {}).get("id")]
        if not blanks or len(keys) != len(tot) or t not in teams:
            continue
        rows = [p for p in players if p["team"] == t and not p["dnp"]]
        vals = dict(zip(keys, tot))
        line = {}
        for k, name in BOXK.items():
            line[name] = _num(vals.get(k)) - sum(p[name] for p in rows)
        for k, (m_, a_) in SPLITK.items():
            m, n = _split(vals.get(k))
            line[m_], line[a_] = m - sum(p[m_] for p in rows), n - sum(p[a_] for p in rows)
        if line["pts"] <= 0 or min(line.values()) < 0:
            continue
        known = {"".join(words(p["name"])) for p in rows}
        act = {p["eid"] for p in rows}
        ghosts = {"".join(words(p["name"])): p for p in players if p["team"] == t and p["dnp"]}   # "did not play", yet he shot
        show, ids = {}, {}
        for p in plays:
            if p["team"] == t and p["shooting"] and (not p["ath"] or p["ath"][0] not in act):
                m = RX_ACT.match(p["text"])
                n = "".join(words(m.group(1))) if m else ""
                if n and n not in known:
                    show.setdefault(n, m.group(1))
                    if p["ath"]:
                        ids[n] = p["ath"][0]
        if not show:
            continue
        mins = 40.0 + 5.0 * max(0, (p_period(plays) - 2))
        seat = max(0.0, 5 * mins - sum(p["min"] for p in rows))
        if len(show) == 1:
            lines = {next(iter(show)): line}
        else:
            lines = {n: count_line(plays, t, show[n], act) for n in show}
            if sum(x["pts"] for x in lines.values()) != line["pts"]:
                continue
        touches = {n: max(1.0, x["fga"] + 0.475 * x["fta"] + x["reb"] + x["ast"] + x["tov"]) for n, x in lines.items()}
        all_t = sum(touches.values())
        for n, x in lines.items():
            eid = ids.get(n) or (ghosts[n]["eid"] if n in ghosts else None) or roster_ids(season).get((t, n)) or f"x{t}-{n}"
            if n in ghosts:
                players.remove(ghosts[n])
            players.append(dict({"eid": eid, "name": show[n], "team": t, "starter": False, "dnp": False, "pos": None, "jersey": None, "min": min(mins, seat * touches[n] / all_t), "filled": True}, **x))
            filled += 1
    return filled


def count_line(plays, team, name, act=()):
    """One man's line from the play-by-play's text, for a box row ESPN lost."""
    z = {k: 0.0 for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf")}
    for p in plays:
        if p["team"] != team:
            continue
        tx = p["text"]
        if f"Assisted by {name}" in tx or f"({name} assists)" in tx:
            z["ast"] += 1
        if not tx.startswith(name) and not tx.startswith(f"Foul on {name}"):
            continue
        tid = p["tid"]
        if p["shooting"] and tid == "540":
            z["fta"] += 1
            if p["scoring"]:
                z["ftm"] += 1
                z["pts"] += 1
        elif p["shooting"]:
            three = p["pts_att"] == 3 or "three point" in tx.lower()
            z["fga"] += 1
            z["fg3a"] += three
            if p["scoring"]:
                z["fgm"] += 1
                z["fg3m"] += three
                z["pts"] += 3 if three else 2
        elif tid == "586":
            z["oreb"] += 1
            z["reb"] += 1
        elif tid == "587":
            z["dreb"] += 1
            z["reb"] += 1
        elif tid == "598":
            z["tov"] += 1
        elif tid == "607":
            z["stl"] += 1
        elif tid == "618":
            z["blk"] += 1
        elif tid == "519":
            z["pf"] += 1
    return z


def p_period(plays):
    return max([p["period"] or 0 for p in plays] or [2])


def normalize(summary, gid, ev, season):
    """ev: the scoreboard row for this game (espn_cbb.event_row)."""
    comp = summary["header"]["competitions"][0]
    teams = {}
    conf = {t["id"]: t.get("conf") for t in ev.get("teams", [])}
    for c in comp["competitors"]:
        t = c["team"]
        teams[t["id"]] = {"id": t["id"], "abbr": t.get("abbreviation"), "name": t.get("displayName") or t.get("location"),
                          "loc": t.get("location"), "side": c.get("homeAway"), "score": int(_num(c.get("score"))),
                          "color": t.get("color"), "alt": t.get("alternateColor"), "conf": conf.get(t["id"])}
    home = next((k for k, v in teams.items() if v["side"] == "home"), None)
    away = next((k for k, v in teams.items() if v["side"] == "away"), None)
    players = []
    for tb in (summary.get("boxscore") or {}).get("players") or []:
        tid = tb["team"]["id"]
        st = (tb.get("statistics") or [{}])[0]
        keys = st.get("keys") or []
        for a in st.get("athletes") or []:
            ath = a.get("athlete") or {}
            if not ath.get("id"):
                continue
            vals = dict(zip(keys, a.get("stats") or []))
            fgm, fga = _split(vals.get("fieldGoalsMade-fieldGoalsAttempted"))
            f3m, f3a = _split(vals.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
            ftm, fta = _split(vals.get("freeThrowsMade-freeThrowsAttempted"))
            players.append({"eid": ath["id"], "name": ath.get("displayName"), "team": tid, "starter": bool(a.get("starter")),
                            "dnp": bool(a.get("didNotPlay")) or not vals, "pos": (ath.get("position") or {}).get("abbreviation"),
                            "jersey": ath.get("jersey"), "min": _num(vals.get("minutes")), "pts": _num(vals.get("points")),
                            "fgm": fgm, "fga": fga, "fg3m": f3m, "fg3a": f3a, "ftm": ftm, "fta": fta,
                            "oreb": _num(vals.get("offensiveRebounds")), "dreb": _num(vals.get("defensiveRebounds")),
                            "reb": _num(vals.get("rebounds")), "ast": _num(vals.get("assists")), "tov": _num(vals.get("turnovers")),
                            "stl": _num(vals.get("steals")), "blk": _num(vals.get("blocks")), "pf": _num(vals.get("fouls"))})
    plays = []
    for i, p in enumerate(summary.get("plays") or []):
        c = p.get("coordinate") or {}
        x, y = c.get("x"), c.get("y")
        if x is None or y is None or abs(x) > 1000 or abs(y) > 1000:
            x = y = None
        plays.append({"i": i, "seq": int(p.get("sequenceNumber") or 0), "pid": p.get("id"),
                      "type": (p.get("type") or {}).get("text"), "tid": (p.get("type") or {}).get("id"),
                      "text": p.get("text") or "", "period": (p.get("period") or {}).get("number"),
                      "clock": clock_seconds((p.get("clock") or {}).get("displayValue")),
                      "team": (p.get("team") or {}).get("id"), "score_home": p.get("homeScore"), "score_away": p.get("awayScore"),
                      "scoring": bool(p.get("scoringPlay")), "shooting": bool(p.get("shootingPlay")), "value": p.get("scoreValue") or 0,
                      "pts_att": p.get("pointsAttempted") or 0, "x": x, "y": y,
                      "ath": [pp["athlete"]["id"] for pp in p.get("participants") or [] if pp.get("athlete")]})
    filled = fill_missing(summary, players, plays, teams, season)
    gi = summary.get("gameInfo") or {}
    non_d1 = [k for k, v in teams.items() if not v["conf"]]
    return {"gid": str(gid), "date": ev.get("date"), "season": season, "home": home, "away": away, "teams": teams,
            "meta": {"neutral": bool(comp.get("neutralSite")), "confgame": bool(comp.get("conferenceCompetition")),
                     "stype": ev.get("stype"), "note": ev.get("note") or "", "tourn": ev.get("tourn"),
                     "venue": (gi.get("venue") or {}).get("id"), "venue_name": (gi.get("venue") or {}).get("fullName"),
                     "attendance": gi.get("attendance"), "pbp_src": comp.get("playByPlaySource"), "box_src": comp.get("boxscoreSource"),
                     "officials": [o.get("displayName") for o in gi.get("officials") or [] if o.get("displayName")]},
            "line": line_of(summary), "non_d1": non_d1, "players": players, "plays": plays, "source": "espn", "filled": filled}


def load_game(season, ev):
    return normalize(E.read_raw(season, ev["id"]), ev["id"], ev, season)
