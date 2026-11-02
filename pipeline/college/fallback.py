"""
fallback.py — rungs 3 and 4 of the ladder, and the diff that proves them. §2, step 11.

Each adapter returns the same normalized game as normalize.py, so if ESPN goes dark the parser, the
season tables and the page don't change. They stay dormant until cloud_cbb.py picks them.

  rung 3  cbbd_game(c)    a CBBD file (cbbd_source.py) -> a game. Plays, the five on the floor, shot
                          locations; the box is counted from the plays. CBBD is built from ESPN: it
                          covers ESPN blocking WCE, not ESPN shutting the feed for everyone.
  rung 4  ncaa_game(id)   NCAA.com through the MIT-licensed ncaa-api wrapper, at most 5 requests a
                          second. Text only: names are matched to roster ids by team and name,
                          duplicate lines dropped, shot families read from the words, no
                          coordinates, so games from here show shot maps and xFG as "not tracked".

    python3 fallback.py diff-cbbd 2026-02-14 2026-02-21     <home>/fallback/cbbd-<date>.json
    python3 fallback.py diff-ncaa 2026-02-14 2026-02-21     <home>/fallback/ncaa-<date>.json
    python3 fallback.py count 2026-02-14                    NCAA finals vs ESPN finals for a date
"""
import datetime as dt
import gzip
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))

import cbbd_client as CC  # noqa: E402
import cbbd_source as CS  # noqa: E402
import espn_cbb as E  # noqa: E402
import join as J  # noqa: E402
import normalize as N  # noqa: E402
import rebuild as R  # noqa: E402
from namematch import words  # noqa: E402

NCAA = os.environ.get("NCAA_API") or "https://ncaa-api.henrygd.me"
OUT = os.path.join(CC.HOME, "fallback")
REF = os.path.join(CC.HOME, "ref")
TYPE_IDS = {"JumpShot": "558", "LayUpShot": "572", "DunkShot": "574", "TipShot": "437", "MadeFreeThrow": "540", "Offensive Rebound": "586", "Defensive Rebound": "587",
            "Dead Ball Rebound": "449", "Lost Ball Turnover": "598", "Steal": "607", "Block Shot": "618", "PersonalFoul": "519", "Technical Foul": "521", "Substitution": "584",
            "Jumpball": "615", "End Period": "412", "End Game": "402", "OfficialTVTimeOut": "580", "ShortTimeOut": "579", "RegularTimeOut": "578"}


def _rosters(season):
    """CBBD id -> ESPN id, and team school -> ESPN team id, from the cached refs."""
    ids, teams = {}, {}
    y = E.season_year(season)
    for t in json.load(open(os.path.join(REF, f"roster-{y}.json"))):
        teams[t["team"]] = str(t["teamSourceId"])
        for p in t["players"]:
            ids[str(p["id"])] = {"eid": str(p["sourceId"]), "name": p["name"], "team": str(t["teamSourceId"])}
    return ids, teams


BOX = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf")


def box_from_plays(plays, team_of):
    b = defaultdict(lambda: {k: 0.0 for k in BOX})
    for p in plays:
        tid = p["tid"]
        a = p["ath"][0] if p["ath"] else None
        if a is None:
            continue
        if p["shooting"] and tid != R.FT:
            three = R.is_three(p)
            b[a]["fga"] += 1
            b[a]["fg3a"] += three
            if p["scoring"]:
                b[a]["fgm"] += 1
                b[a]["fg3m"] += three
                b[a]["pts"] += 3 if three else 2
                if len(p["ath"]) > 1:
                    b[p["ath"][1]]["ast"] += 1
        elif tid == R.FT:
            b[a]["fta"] += 1
            if p["scoring"]:
                b[a]["ftm"] += 1
                b[a]["pts"] += 1
        elif tid == R.OREB:
            b[a]["oreb"] += 1
            b[a]["reb"] += 1
        elif tid == R.DREB:
            b[a]["dreb"] += 1
            b[a]["reb"] += 1
        elif tid == R.TOV:
            b[a]["tov"] += 1
        elif tid == R.STEAL:
            b[a]["stl"] += 1
        elif tid == R.BLOCK:
            b[a]["blk"] += 1
        elif tid == R.PFOUL:
            b[a]["pf"] += 1
    return b


def game_shell(gid, date, season, home, away, names, conf=None):
    tm = {home: {"id": home, "abbr": names.get(home), "name": names.get(home), "loc": names.get(home), "side": "home", "score": 0, "color": None, "alt": None, "conf": (conf or {}).get(home, "?")},
          away: {"id": away, "abbr": names.get(away), "name": names.get(away), "loc": names.get(away), "side": "away", "score": 0, "color": None, "alt": None, "conf": (conf or {}).get(away, "?")}}
    return {"gid": str(gid), "date": date, "season": season, "home": home, "away": away, "teams": tm, "meta": {"neutral": False, "confgame": False, "stype": 2, "note": "", "tourn": None, "venue": None, "venue_name": None, "attendance": None, "pbp_src": None, "box_src": None, "officials": []},
            "line": None, "non_d1": [], "players": [], "plays": [], "source": None}


def finish(g, team_of, name_of):
    box = box_from_plays(g["plays"], team_of)
    pl = g["plays"]
    if pl:
        last = pl[-1]
        g["teams"][g["home"]]["score"] = max((p["score_home"] or 0) for p in pl)
        g["teams"][g["away"]]["score"] = max((p["score_away"] or 0) for p in pl)
    for e, t in team_of.items():
        b = box.get(e) or {k: 0.0 for k in BOX}
        g["players"].append(dict({"eid": e, "name": name_of.get(e), "team": t, "starter": False, "dnp": False, "pos": None, "jersey": None, "min": 0.0}, **b))
    return g


def cbbd_game(c, season, date):
    ids, teams = _rosters(season)
    home, away = teams.get(c["home"]), teams.get(c["away"])
    names = {home: c["home"], away: c["away"]}
    g = game_shell(c["gid"], date, season, home, away, names)
    g["source"] = "cbbd"
    team_of, name_of = {}, {}
    fives = {}
    for i, r in enumerate(c["plays"]):
        pid, typ, text, period, secs, team, is_home, hs, as_, scoring, shooting, value, parts, x, y, rng, floor = r[:17]
        shooter, assister = (r[17], r[18]) if len(r) > 18 else (None, None)
        if shooter is not None:
            parts = [shooter] + ([assister] if assister is not None else [])
        tid = TYPE_IDS.get(typ, "0")
        ath = [ids[str(a)]["eid"] for a in parts if str(a) in ids]
        for a in parts:
            v = ids.get(str(a))
            if v:
                team_of[v["eid"]] = v["team"]
                name_of[v["eid"]] = v["name"]
        fx, fy = J.to_feet(x, y)
        secs_left = (secs or 0)
        clock = float(secs_left) - (1200.0 if period == 1 else 0.0) if period and period <= 2 and secs_left > 1200 else float(secs_left)
        g["plays"].append({"i": i, "seq": i, "pid": pid, "type": typ, "tid": tid, "text": text or "", "period": period, "clock": clock, "team": teams.get(team), "score_home": hs, "score_away": as_,
                           "scoring": scoring, "shooting": shooting, "value": value, "pts_att": (value if shooting and value in (2, 3) else 0), "x": fx, "y": fy, "ath": ath})
        side = defaultdict(list)
        for a, tm in floor:
            v = ids.get(str(a))
            if v:
                side[v["team"]].append(v["eid"])
                team_of[v["eid"]] = v["team"]
                name_of[v["eid"]] = v["name"]
        if side:
            fives[pid] = {k: v[:5] for k, v in side.items() if len(v) >= 5}
    g["fives"] = fives
    return finish(g, team_of, name_of)


def diff_cbbd(day):
    season = "2025-26" if day < "2026-08" else "2026-27"
    rows, left = CC.get("/plays/date", date=f"{day}T00:00:00Z")
    games = CS.compact(rows)
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    evs = {e["id"]: e for d in seen for e in seen[d]}
    res = Counter()
    coord = []
    details = []
    for gid, c in games.items():
        ev = evs.get(gid)
        if not ev or ev["status"] != E.FINAL or ev["date"] != day or not os.path.exists(E.raw_path(season, gid)):
            continue
        e = N.load_game(season, ev)
        if not e["plays"]:
            continue
        g = cbbd_game(c, season, day)
        res["games"] += 1
        res["plays_espn"] += len(e["plays"])
        res["plays_cbbd"] += len(g["plays"])
        by = {p["pid"]: p for p in g["plays"]}
        shots = [p for p in e["plays"] if p["shooting"] and p["tid"] != R.FT]
        res["shots"] += len(shots)
        for p in shots:
            q = by.get(p["pid"])
            if q is None:
                res["shot_missing"] += 1
                continue
            res["shooter_same"] += bool(p["ath"] and q["ath"] and p["ath"][0] == q["ath"][0])
            if p["x"] is not None and q["x"] is not None and not (p["x"] == 25 and p["y"] == 0):
                coord.append((abs(p["x"] - q["x"]), abs(p["y"] - q["y"]), p["x"] - q["x"], p["y"] - q["y"]))
        hs, as_ = e["teams"][e["home"]]["score"], e["teams"][e["away"]]["score"]
        res["score_same"] += (g["teams"][g["home"]]["score"], g["teams"][g["away"]]["score"]) == (hs, as_) if g["home"] == e["home"] else False
        # fives: compare CBBD's list with the ESPN-derived five, play by play
        plays = sorted((p for p in e["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
        f, _ = R.lineups_from_subs(e, plays)
        for p in plays:
            fq = g["fives"].get(p["pid"])
            fe = f.get(p["i"])
            if not fq or not fe:
                continue
            for t, five in fe.items():
                if t in fq:
                    res["five_total"] += 1
                    res["five_same"] += set(fq[t]) == set(five)
    import statistics as st
    rep = dict(day=day, **res, coord_shots=len(coord), x_within_2=round(sum(c[0] <= 2 for c in coord) / max(1, len(coord)), 4), y_within_2=round(sum(c[1] <= 2 for c in coord) / max(1, len(coord)), 4),
               x_bias=round(st.mean(c[2] for c in coord), 3) if coord else None, y_bias=round(st.mean(c[3] for c in coord), 3) if coord else None,
               shooter_rate=round(res["shooter_same"] / max(1, res["shots"]), 4), score_rate=round(res["score_same"] / max(1, res["games"]), 4), five_rate=round(res["five_same"] / max(1, res["five_total"]), 4),
               play_ratio=round(res["plays_cbbd"] / max(1, res["plays_espn"]), 4), ledger=CC.calls_this_month())
    os.makedirs(OUT, exist_ok=True)
    json.dump(rep, open(os.path.join(OUT, f"cbbd-{day}.json"), "w"), indent=1)
    print(json.dumps(rep))
    return rep


# ---------------------------------------------------------------- rung 4
_last = [0.0]


def nget(path):
    wait = 0.21 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(NCAA + path, headers={"User-Agent": "wcehoops.com College Basketball Savant"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf8", "replace"), strict=False)


def ncaa_board(day):
    y, m, d = day.split("-")
    return nget(f"/scoreboard/basketball-men/d1/{y}/{m}/{d}/all-conf").get("games", [])


def count(day):
    """NCAA.com finals vs ESPN finals for a date: free, no quota, catches a game missing on either side."""
    season = E.season_label(int(day[:4]) + (1 if int(day[5:7]) >= 8 else 0))
    n = sum(1 for g in ncaa_board(day) if (g["game"].get("gameState") or "").lower() == "final")
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    e = [x for x in seen.get(day, []) if x["status"] == E.FINAL and x["teams"][0]["conf"] and x["teams"][1]["conf"]]
    return {"day": day, "ncaa": n, "espn": len(e), "espn_all": len([x for x in seen.get(day, []) if x["status"] == E.FINAL])}


FAMILY = [("dunk", "DunkShot"), ("tip", "TipShot"), ("layup", "LayUpShot")]
RX_SHOT = re.compile(r"^(.*?)\s*\b(makes|misses)\s+(.*)$", re.I)
RX_GLUE = re.compile(r"(?<=[a-z.])(makes|misses)\b")


def classify(text):
    """-> (kind, name, made, second name). The feed logs a shot twice: once with the name glued to
    the verb ("Hastingsmisses"), once with the assist appended; a steal sits inside the turnover line."""
    text = RX_GLUE.sub(r" \1", text.strip())
    t = text.lower()
    m = RX_SHOT.match(text)
    second = None
    p = re.search(r"\(([^()]+?)\s+(assists|steals|blocks)\)", text)
    if p:
        second = p.group(1).strip()
    if m:
        return ("ft" if "free throw" in t else "fg"), m.group(1).strip(), m.group(2).lower() == "makes", second
    for pat, kind in ((r"\s+offensive rebound", "oreb"), (r"\s+defensive rebound", "dreb"), (r"\s+turnover", "tov"), (r"\s+(personal|offensive|shooting|technical)?\s*foul", "foul"), (r"\s+subbing in", "in"), (r"\s+subbing out", "out")):
        q = re.search(pat, text, re.I)
        if q:
            return kind, text[:q.start()].strip(), None, second
    return None, None, None, None


def ncaa_game(ncaa_id, season, date, home, away, tnames, rosters):
    """rosters: {team id: {normalized name: eid}}. A game from here has no coordinates."""
    d = nget(f"/game/{ncaa_id}/play-by-play")
    g = game_shell(ncaa_id, date, season, home, away, tnames)
    g["source"] = "ncaa"
    team_of, name_of = {}, {}
    unmatched = Counter()
    sides = {t["teamId"]: t["isHome"] for t in d.get("teams", [])}
    rows = []
    for pr in d.get("periods", []):
        period = pr.get("periodNumber")
        for p in pr.get("playbyplayStats") or []:
            text = (p.get("homeText") or p.get("visitorText") or p.get("eventDescription") or "").strip()
            kind, who, made, second = classify(text)
            if kind is None:
                continue
            isl = bool(p.get("isHome")) if p.get("isHome") is not None else sides.get(str(p.get("teamId")), False)
            key = (period, p.get("clock"), kind, "".join(words(who)), made)
            if rows and rows[-1]["key"] == key:      # the duplicate line: keep what it adds
                rows[-1]["second"] = rows[-1]["second"] or second
                if kind == "tov" and isl != rows[-1]["isl"]:
                    rows[-1]["steal_team_home"] = isl
                continue
            rows.append(dict(key=key, period=period, p=p, text=text, kind=kind, who=who, made=made, second=second, isl=isl, steal_team_home=None))
    i = 0

    def push(period, p, team, typ, text, ath, shooting=False, scoring=False, val=0):
        nonlocal i
        g["plays"].append({"i": i, "seq": i, "pid": f"n{ncaa_id}-{i}", "type": typ, "tid": TYPE_IDS[typ], "text": text, "period": period, "clock": N.clock_seconds(p.get("clock")), "team": team,
                           "score_home": p.get("homeScore"), "score_away": p.get("visitorScore"), "scoring": scoring, "shooting": shooting, "value": val, "pts_att": val if (shooting and val != 1) else 0, "x": None, "y": None, "ath": ath})
        i += 1

    def who_id(team, name):
        e = rosters.get(team, {}).get("".join(words(name))) if name else None
        if e:
            team_of[e] = team
            name_of[e] = name
        elif name:
            unmatched[name] += 1
        return e

    for r in rows:
        kind, who, made, period, p, text = r["kind"], r["who"], r["made"], r["period"], r["p"], r["text"]
        team = home if r["isl"] else away
        other = away if r["isl"] else home
        team_words = {"".join(words(tnames.get(home) or "")), "".join(words(tnames.get(away) or ""))}
        is_team = not who or any("".join(words(who)) in t or t in "".join(words(who)) for t in team_words if t) or who.lower() == "team"
        eid = None if is_team else who_id(team, who)
        ath = [eid] if eid else []
        if kind in ("fg", "ft"):
            t = text.lower()
            typ = "MadeFreeThrow" if kind == "ft" else "DunkShot" if "dunk" in t else "TipShot" if "tip" in t else "LayUpShot" if "layup" in t else "JumpShot"
            val = 1 if kind == "ft" else 3 if "three point" in t else 2
            if kind == "fg" and made and r["second"]:
                a2 = who_id(team, r["second"])
                if a2:
                    ath.append(a2)
            push(period, p, team, typ, text, ath, True, bool(made), val)
            if kind == "fg" and not made and r["second"] and "block" in t:
                b = who_id(other, r["second"])
                push(period, p, other, "Block Shot", text, [b] if b else [])
        elif kind == "tov":
            push(period, p, team, "Lost Ball Turnover", text, ath)
            if r["second"]:
                st = who_id(other, r["second"])
                push(period, p, other, "Steal", text, [st] if st else [])
        elif kind == "foul":
            push(period, p, team, "PersonalFoul", text, ath)
        elif kind in ("in", "out"):
            push(period, p, team, "Substitution", "subbing in" if kind == "in" else "subbing out", ath)
        else:
            push(period, p, team, "Offensive Rebound" if kind == "oreb" else "Defensive Rebound", text, ath)
    g["unmatched"] = dict(unmatched)
    return finish(g, team_of, name_of)


def norm_team(s):
    return "".join(words(s.replace("St.", "State")))


def diff_ncaa(day):
    season = "2025-26" if day < "2026-08" else "2026-27"
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    evs = [e for e in seen.get(day, []) if e["status"] == E.FINAL]
    by_teams = {}
    for e in evs:
        n = {t["side"]: t for t in e["teams"]}
        by_teams[(int(n["home"]["score"] or 0), int(n["away"]["score"] or 0))] = e
    res = Counter()
    per = []
    for row in ncaa_board(day)[:40]:
        g0 = row["game"]
        if (g0.get("gameState") or "").lower() != "final":
            continue
        try:
            hs, as_ = int(g0["home"]["score"]), int(g0["away"]["score"])
        except (ValueError, KeyError):
            continue
        ev = by_teams.get((hs, as_))
        if ev is None:
            res["unmatched_game"] += 1
            continue
        e = N.load_game(season, ev)
        ros = {t: {} for t in (e["home"], e["away"])}
        for p in e["players"]:
            ros[p["team"]]["".join(words(p["name"]))] = p["eid"]
        g = ncaa_game(g0["gameID"], season, day, e["home"], e["away"], {e["home"]: e["teams"][e["home"]]["name"], e["away"]: e["teams"][e["away"]]["name"]}, ros)
        res["games"] += 1
        res["score_same"] += (g["teams"][e["home"]]["score"], g["teams"][e["away"]]["score"]) == (hs, as_)
        ef = [p for p in e["plays"] if p["shooting"] and p["tid"] != R.FT]
        nf = [p for p in g["plays"] if p["shooting"] and p["tid"] != R.FT]
        res["fga_espn"] += len(ef)
        res["fga_ncaa"] += len(nf)
        res["unmatched_names"] += sum(g["unmatched"].values())
        res["actions"] += len(g["plays"])
        be = Counter(p["ath"][0] for p in ef if p["ath"])
        bn = Counter(p["ath"][0] for p in nf if p["ath"])
        res["players"] += len(be)
        res["fga_line_same"] += sum(1 for k, v in be.items() if bn.get(k) == v)
    rep = dict(day=day, **res, score_rate=round(res["score_same"] / max(1, res["games"]), 4), fga_ratio=round(res["fga_ncaa"] / max(1, res["fga_espn"]), 4),
               fga_line_rate=round(res["fga_line_same"] / max(1, res["players"]), 4), name_miss_rate=round(res["unmatched_names"] / max(1, res["actions"]), 4), count=count(day))
    os.makedirs(OUT, exist_ok=True)
    json.dump(rep, open(os.path.join(OUT, f"ncaa-{day}.json"), "w"), indent=1)
    print(json.dumps(rep))
    return rep


if __name__ == "__main__":
    cmd = sys.argv[1]
    for d in sys.argv[2:]:
        if cmd == "diff-cbbd":
            diff_cbbd(d)
        elif cmd == "diff-ncaa":
            diff_ncaa(d)
        elif cmd == "count":
            print(count(d))
