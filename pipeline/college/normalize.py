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
import espn_cbb as E


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
    gi = summary.get("gameInfo") or {}
    non_d1 = [k for k, v in teams.items() if not v["conf"]]
    return {"gid": str(gid), "date": ev.get("date"), "season": season, "home": home, "away": away, "teams": teams,
            "meta": {"neutral": bool(comp.get("neutralSite")), "confgame": bool(comp.get("conferenceCompetition")),
                     "stype": ev.get("stype"), "note": ev.get("note") or "", "tourn": ev.get("tourn"),
                     "venue": (gi.get("venue") or {}).get("id"), "venue_name": (gi.get("venue") or {}).get("fullName"),
                     "attendance": gi.get("attendance"), "pbp_src": comp.get("playByPlaySource"), "box_src": comp.get("boxscoreSource"),
                     "officials": [o.get("displayName") for o in gi.get("officials") or [] if o.get("displayName")]},
            "line": line_of(summary), "non_d1": non_d1, "players": players, "plays": plays, "source": "espn"}


def load_game(season, ev):
    return normalize(E.read_raw(season, ev["id"]), ev["id"], ev, season)
