"""
context.py — the games table: one row per team-game with everything about the situation the
game was played in, 1996-97 on, each column from the season its source begins.

    build(season, logs, processed, who, impact, prev_minutes) -> [rows]

Sources, by column family:
  schedule (1996-97)   LeagueGameLog: date, home, result, margin; rest days, back-to-backs,
                       3-in-4s, road-trip game number, season phase (first 10, before and after
                       the All-Star break, which is read off the schedule as the longest gap
                       between January 20 and March 10, last 10)
  travel (1996-97)     the arena table in teams.py, and ESPN's venue city when the game is in
                       ESPN's data (2002-03 on): miles from the previous game, time zones
                       crossed, altitude
  box (1996-97)        possessions (from the play-by-play 2002-03 on; the NBA's formula
                       FGA - OREB + TOV + 0.44 FTA before), ratings, pace, four factors,
                       opponent strength as of the game date (luck-adjusted net rating over
                       the opponent's prior games this season, and its rank among the 30 that
                       day; season-end strength and whether it made the playoffs)
  play-by-play (2002-03) shot diet by zone own and allowed, transition share, biggest lead and
                       deficit, time leading, halves and quarters, clutch, garbage time,
                       officials and fouls called, availability (which regulars were out and
                       the impact they carry), starting-lineup continuity
  market (2015-16)     ESPN's consensus closing spread and total; covers and over/unders
  win probability (2018-19) ESPN's in-game model: the team's low and high
  roster (1996-97)     returning-minutes share, minutes-weighted age and experience
"""
import datetime as dt
from collections import defaultdict

import teams as TM

PHASE_FIRST, PHASE_LAST = 10, 10
REGULAR_MIN_GAMES_FOR_RANK = 5


def _date(s):
    return dt.date.fromisoformat(s)


def all_star_break(dates):
    """The longest gap with no games between Jan 20 and Mar 10: (last day before, first day after)."""
    ds = sorted({d for d in dates if f"{d[:4]}-01-20" <= d <= f"{d[:4]}-03-10"})
    best, gap = None, 0
    for a, b in zip(ds, ds[1:]):
        g = (_date(b) - _date(a)).days
        if g > gap:
            gap, best = g, (a, b)
    return best if gap >= 4 else None


def build(season, logs, processed, who, impact, archive, prev_min=None, log=print):
    """logs: registry game_logs()[season] rows. processed: process.load(season) or None.
    impact: {pid: bpm}. archive: archive.players(season). prev_min: {pid: minutes last season for the team} by team."""
    year = int(season[:4])
    by_nba = {}
    by_date_pair = {}
    if processed:
        for g in processed["games"]:
            if g.get("nba_gid"):
                by_nba[g["nba_gid"]] = g
            for d in (-1, 0, 1):
                day = (_date(g["date"]) + dt.timedelta(days=d)).isoformat()
                by_date_pair.setdefault((day, frozenset((g["home"], g["away"]))), g)
    # league shooting for luck
    fg3m = fg3a = ftm = fta = 0.0
    for g in (processed or {}).get("games", []):
        if g.get("stype") != 2:
            continue
        for t in g["team"].values():
            b = t["box"]
            fg3m += b["fg3m"]; fg3a += b["fg3a"]; ftm += b["ftm"]; fta += b["fta"]
    lg3 = fg3m / fg3a if fg3a else 0.355
    lgft = ftm / fta if fta else 0.76

    # team-game base rows from the schedule
    rows = []
    by_team = defaultdict(list)
    asb = all_star_break([r["date"] for r in logs if r["type"] == "RS"])
    for r in logs:
        rows.append(dict(season=season, nba_gid=r["gid"], date=r["date"], type=r["type"], team=r["team"], opp=r["opp"], home=r["home"],
                         w=1 if r["wl"] == "W" else 0, pts=r["pts"], opp_pts=r["pts"] - r["pm"] if r["pm"] is not None else None, margin=r["pm"]))
    # join ESPN
    for row in rows:
        g = by_nba.get(row["nba_gid"]) or by_date_pair.get((row["date"], frozenset((row["team"], row["opp"]))))
        row["_g"] = g
        if g:
            row["gid"] = g["gid"]
            row["type"] = {2: "RS", 3: "PO", 5: "PI"}.get(g.get("stype"), row["type"])
    # play-in games are not in the NBA game log's two season types: add them from ESPN
    seen = {(r["date"], r["team"]) for r in rows}
    for g in (processed or {}).get("games", []):
        if g.get("stype") == 5:
            for team, t in g["team"].items():
                if (g["date"], team) in seen:
                    continue
                opp = next(k for k in g["team"] if k != team)
                rows.append(dict(season=season, nba_gid=g.get("nba_gid"), gid=g["gid"], date=g["date"], type="PI", team=team, opp=opp, home=t["home"],
                                 w=1 if t["pts"] > t["opp_pts"] else 0, pts=t["pts"], opp_pts=t["opp_pts"], margin=t["pts"] - t["opp_pts"], _g=g))
    rows.sort(key=lambda r: (r["date"], r.get("gid") or r["nba_gid"], r["team"]))
    for r in rows:
        by_team[r["team"]].append(r)

    # regulars for availability: the eight most-used men for the team this season, with the span they were with it
    regulars = {}
    if processed:
        secs = defaultdict(float)
        span = {}
        for g in processed["games"]:
            if g.get("stype") != 2:
                continue
            for team, t in g["team"].items():
                for pid, p in g["players"].items():
                    if p["team"] != t["espn"] or p["dnp"] or p["sec"] <= 0:
                        continue
                    secs[(team, pid)] += p["sec"]
                    a = span.setdefault((team, pid), [g["date"], g["date"]])
                    a[0], a[1] = min(a[0], g["date"]), max(a[1], g["date"])
        for team in by_team:
            top = sorted(((s, pid) for (t, pid), s in secs.items() if t == team), reverse=True)[:8]
            regulars[team] = {pid: span[(team, pid)] for _, pid in top}

    # per-team running state
    per_team_state = {}
    for team, grs in by_team.items():
        home_place = TM.home_arena(team, year)
        prev_place, prev_date, trip, prev_start = home_place, None, 0, None
        n_rs = 0
        rs_dates = [r["date"] for r in grs if r["type"] == "RS"]
        for r in grs:
            g = r["_g"]
            t = g["team"][team] if g else None
            o = g["team"][r["opp"]] if g else None
            venue_city = g.get("city") if g else None
            host = r["team"] if r["home"] else r["opp"]
            place = TM.place(host, year, r["date"], venue_city) or TM.home_arena(host, year)
            if g and g.get("neutral"):
                place = dict(place or {}, neutral=True)
            r["neutral"] = bool(place and place.get("neutral"))
            r["city"] = place["city"] if place else None
            r["alt"] = place["alt"] if place else None
            r["travel_miles"] = round(TM.miles(prev_place, place)) if prev_place and place else None
            r["tz_shift"] = (place["tz"] - prev_place["tz"]) if prev_place and place else None
            r["tz_from_home"] = (place["tz"] - home_place["tz"]) if place and home_place else None
            r["rest_days"] = (_date(r["date"]) - _date(prev_date)).days - 1 if prev_date else None
            r["b2b"] = r["rest_days"] == 0 if prev_date else False
            prior = [x["date"] for x in grs if x["date"] < r["date"]][-3:]
            r["three_in_four"] = len([d for d in prior if (_date(r["date"]) - _date(d)).days <= 3]) >= 2
            if r["home"] and not r["neutral"]:
                trip = 0
            else:
                trip += 1
            r["trip_game"] = trip
            if r["type"] == "RS":
                n_rs += 1
                phase = "first10" if n_rs <= PHASE_FIRST else "last10" if n_rs > len(rs_dates) - PHASE_LAST else ("pre_asb" if (not asb or r["date"] <= asb[0]) else "post_asb")
                r["phase"] = phase
                r["game_no"] = n_rs
            else:
                r["phase"] = "playoffs" if r["type"] == "PO" else "play_in"
                r["game_no"] = None
            prev_place, prev_date = place or prev_place, r["date"]
            # box
            if t:
                b, ob = t["box"], o["box"]
                poss = t["poss"] or 0
                oposs = t["opp_poss"] or 0
                secs = 2880.0 + 300.0 * (g["periods"] - 4)
                r.update(poss=poss, opp_poss=oposs, pace=round(48.0 * (poss + oposs) / 2 / (secs / 60.0), 1) if secs else None,
                         ortg=round(100.0 * t["pts"] / poss, 1) if poss else None, drtg=round(100.0 * t["opp_pts"] / oposs, 1) if oposs else None,
                         efg=round((b["fgm"] + 0.5 * b["fg3m"]) / b["fga"], 3) if b["fga"] else None, tov_pct=round(100.0 * b["tov"] / poss, 1) if poss else None,
                         orb_pct=round(b["oreb"] / (b["oreb"] + ob["dreb"]), 3) if (b["oreb"] + ob["dreb"]) else None, ftr=round(b["fta"] / b["fga"], 3) if b["fga"] else None,
                         fg3r=round(b["fg3a"] / b["fga"], 3) if b["fga"] else None, ast_pct=round(b["ast"] / b["fgm"], 3) if b["fgm"] else None,
                         o_efg=round((ob["fgm"] + 0.5 * ob["fg3m"]) / ob["fga"], 3) if ob["fga"] else None, o_tov_pct=round(100.0 * ob["tov"] / oposs, 1) if oposs else None,
                         o_orb_pct=round(ob["oreb"] / (ob["oreb"] + b["dreb"]), 3) if (ob["oreb"] + b["dreb"]) else None, o_ftr=round(ob["fta"] / ob["fga"], 3) if ob["fga"] else None,
                         o_fg3r=round(ob["fg3a"] / ob["fga"], 3) if ob["fga"] else None,
                         luck=round(3 * (ob["fg3m"] - ob["fg3a"] * lg3) + (ob["ftm"] - ob["fta"] * lgft), 2),
                         pf=b["pf"], o_pf=ob["pf"], take_fouls=b.get("take", 0),
                         diet={z: [round(v[0] / b["fga"], 3) if b["fga"] else None, round(v[1] / v[0], 3) if v[0] else None] for z, v in t["diet"].items()},
                         o_diet={z: [round(v[0] / ob["fga"], 3) if ob["fga"] else None, round(v[1] / v[0], 3) if v[0] else None] for z, v in o["diet"].items()},
                         trans_share=round(t["trans"][0] / b["fga"], 3) if b["fga"] else None, o_trans_share=round(o["trans"][0] / ob["fga"], 3) if ob["fga"] else None,
                         lead_max=t["lead_max"], deficit_max=t["deficit_max"], sec_leading=t["sec_leading"],
                         h1_margin=sum(t["q_pts"][:2]) - sum(o["q_pts"][:2]), q3_margin=(t["q_pts"][2] - o["q_pts"][2]) if len(t["q_pts"]) > 2 else None,
                         q4_margin=(t["q_pts"][3] - o["q_pts"][3]) if len(t["q_pts"]) > 3 else None, ot=g["periods"] > 4,
                         comeback=bool(r["w"] and t["deficit_max"] >= 10), blown=bool(not r["w"] and t["lead_max"] >= 10),
                         clutch=t["clutch"], garbage=g.get("garbage_from") is not None,
                         officials=g.get("officials") or [], attendance=g.get("attendance"))
                if g.get("odds"):
                    hs = g["odds"]["home_spread"]
                    sp = hs if t["home"] else -hs
                    r.update(spread=sp, ou=g["odds"]["ou"], provider=g["odds"]["provider"],
                             cover=(1 if r["margin"] + sp > 0 else 0 if r["margin"] + sp < 0 else None) if r["margin"] is not None else None,
                             over=(1 if r["pts"] + r["opp_pts"] > g["odds"]["ou"] else 0 if r["pts"] + r["opp_pts"] < g["odds"]["ou"] else None) if g["odds"].get("ou") else None)
                if g.get("wp") and g["wp"].get("n"):
                    lo, hi, q4 = g["wp"]["home_min"], g["wp"]["home_max"], g["wp"]["home_q4"]
                    r.update(wp_min=round(lo if t["home"] else 1 - hi, 3), wp_max=round(hi if t["home"] else 1 - lo, 3), wp_q4=round(q4 if t["home"] else 1 - q4, 3) if q4 is not None else None)
                # availability
                reg = regulars.get(team, {})
                missing = []
                for pid, (d0, d1) in reg.items():
                    p = g["players"].get(pid)
                    with_team = d0 <= r["date"] <= d1 or (abs((_date(r["date"]) - _date(d0)).days) <= 20 or abs((_date(d1) - _date(r["date"])).days) <= 20)
                    if with_team and (p is None or p["dnp"] or p["sec"] <= 0):
                        missing.append(pid)
                r["missing"] = missing
                r["missing_impact"] = round(sum(x for x in (impact.get(pid) for pid in missing) if x is not None), 1)
                r["starters"] = t["starters"]
                r["starters_same"] = (set(t["starters"]) == set(prev_start)) if prev_start else None
                prev_start = t["starters"]
            else:
                # before ESPN: the NBA's box from the log is not kept here; possessions by formula come from the logs' columns later
                r.update(poss=None, opp_poss=None)
            r["coach"] = who(r)
        per_team_state[team] = True
    # opponent strength as of the date, from regular-season rows with possessions
    strength = defaultdict(lambda: dict(pts=0.0, opp=0.0, luck=0.0, poss=0.0, g=0))
    by_date = defaultdict(list)
    for r in rows:
        by_date[r["date"]].append(r)
    final = {}
    for date in sorted(by_date):
        # rank all teams as they stand before today's games
        table = {tm: 100.0 * (s["pts"] - s["opp"] + s["luck"]) / s["poss"] for tm, s in strength.items() if s["poss"] > 0 and s["g"] >= REGULAR_MIN_GAMES_FOR_RANK}
        order = sorted(table, key=lambda tm: -table[tm])
        for r in by_date[date]:
            on = strength.get(r["opp"])
            r["opp_net_prior"] = round(table[r["opp"]], 2) if r["opp"] in table else None
            r["opp_rank_prior"] = order.index(r["opp"]) + 1 if r["opp"] in order else None
            r["opp_tier_prior"] = (None if r["opp"] not in order else "top10" if order.index(r["opp"]) < 10 else "bottom10" if order.index(r["opp"]) >= len(order) - 10 else "middle")
            r["own_net_prior"] = round(table[r["team"]], 2) if r["team"] in table else None
            r["opp_pace_prior"] = None
        for r in by_date[date]:
            if r["type"] == "RS" and r.get("poss"):
                s = strength[r["team"]]
                s["pts"] += r["pts"]; s["opp"] += r["opp_pts"]; s["luck"] += r["luck"]; s["poss"] += (r["poss"] + r["opp_poss"]) / 2.0; s["g"] += 1
    for tm, s in strength.items():
        final[tm] = round(100.0 * (s["pts"] - s["opp"] + s["luck"]) / s["poss"], 2) if s["poss"] else None
    playoff_teams = {r["team"] for r in rows if r["type"] == "PO"}
    # pace priors: each team's average pace before the date
    pace_run = defaultdict(lambda: [0.0, 0])
    for date in sorted(by_date):
        snap = {tm: v[0] / v[1] for tm, v in pace_run.items() if v[1] >= REGULAR_MIN_GAMES_FOR_RANK}
        for r in by_date[date]:
            r["opp_pace_prior"] = round(snap[r["opp"]], 1) if r["opp"] in snap else None
            r["own_pace_prior"] = round(snap[r["team"]], 1) if r["team"] in snap else None
            if r.get("pace") and r["opp_pace_prior"] is not None and r["own_pace_prior"] is not None:
                # tempo control: the game's pace against what the two teams' usual paces predict (their mean)
                r["tempo_vs_expected"] = round(r["pace"] - (r["opp_pace_prior"] + r["own_pace_prior"]) / 2.0, 1)
                r["tempo_toward_own"] = round((r["pace"] - r["opp_pace_prior"]) / (r["own_pace_prior"] - r["opp_pace_prior"]), 2) if abs(r["own_pace_prior"] - r["opp_pace_prior"]) >= 1.0 else None
        for r in by_date[date]:
            if r["type"] == "RS" and r.get("pace"):
                pace_run[r["team"]][0] += r["pace"]; pace_run[r["team"]][1] += 1
    # roster context per team
    roster = {}
    for team, grs in by_team.items():
        secs = defaultdict(float)
        for r in grs:
            g = r["_g"]
            if not g or r["type"] != "RS":
                continue
            for pid, p in g["players"].items():
                if p["team"] == g["team"][team]["espn"] and not p["dnp"]:
                    secs[pid] += p["sec"]
        tot = sum(secs.values()) or 1.0
        ret = sum(s for pid, s in secs.items() if prev_min and pid in prev_min.get(team, {}))
        ages = [(archive.get(pid, {}).get("age"), s) for pid, s in secs.items()]
        exps = [(archive.get(pid, {}).get("exp"), s) for pid, s in secs.items()]
        roster[team] = dict(returning_min_share=round(ret / tot, 3) if secs and prev_min is not None else None,
                            avg_age=round(sum(a * s for a, s in ages if a is not None) / (sum(s for a, s in ages if a is not None) or 1), 1) if secs else None,
                            avg_exp=round(sum(e * s for e, s in exps if e is not None) / (sum(s for e, s in exps if e is not None) or 1), 1) if secs else None)
    for r in rows:
        r["opp_net_final"] = final.get(r["opp"])
        r["opp_playoff"] = r["opp"] in playoff_teams
        r.update(roster.get(r["team"], {}))
        r["opp_coach"] = who(dict(r, team=r["opp"], opp=r["team"], home=not r["home"]))
        r.pop("_g", None)
    return rows
