"""
espn_source.py — the season in progress, from ESPN's public JSON (works from cloud servers).

stats.nba.com and cdn.nba.com refuse cloud IPs, so the cloud refresh can't call them. ESPN's
site API answers from anywhere and carries everything the box-score side of Basketball Savant
needs: every final game's box score, and play-by-play with a shot location on every shot and
every substitution. This module only FETCHES and NORMALIZES; `espn_shim` turns the result into
the same tables nba_api would have returned, so the engine runs unchanged.

    fetch_season("2026-27", cache_dir)  -> list of normalized games (dicts), finals only

A normalized game:
    {"gid": ESPN event id, "date": "YYYY-MM-DD" (US Eastern game date),
     "home": "BOS", "away": "NYK",              # NBA abbreviations
     "players": [{"eid", "name", "team", "starter", "dnp", "min", "pts", "fgm", "fga", "fg3m",
                  "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk",
                  "pf", "pm"}, ...],
     "plays": [{"seq", "type", "text", "period", "clock" (seconds left in period), "team",
                "score_home", "score_away", "scoring", "shooting", "value", "pts_att",
                "x", "y", "ath": [espn athlete ids]}, ...]}

Finals are immutable once ESPN has them, so each one is cached on disk by event id and only
the day's new finals are fetched. A game ESPN later corrects (rare) is picked up by the
`refetch_days` window, which always re-pulls the last few days.
"""
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import time
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
UA = {"User-Agent": "Mozilla/5.0"}

# ESPN team abbreviations that differ from the NBA's.
ESPN_TO_NBA = {"GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}


def nba_abbr(espn_abbr):
    return ESPN_TO_NBA.get(espn_abbr, espn_abbr)


def _get(url, tries=5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa
            last = e
            time.sleep(min(2 ** i, 20))
    raise RuntimeError(f"ESPN fetch failed after {tries} tries: {url}: {last}")


def _clock_seconds(display):
    """'11:32' -> 692.0, '45.3' -> 45.3"""
    s = str(display or "0")
    if ":" in s:
        parts = s.split(":")
        try:
            return int(parts[0]) * 60 + float(parts[1])
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _split(v):
    """'7-15' -> (7, 15)"""
    try:
        a, b = str(v).split("-")
        return int(a), int(b)
    except Exception:  # noqa
        return 0, 0


def season_dates(season):
    """Every calendar day the regular season could cover: Oct 1 of the start year through
    Apr 30 of the end year (the scoreboard of a day with no games is just empty)."""
    y = int(season[:4])
    return dt.date(y, 10, 1), dt.date(y + 1, 4, 30)


def scoreboard(day):
    return _get(f"{BASE}/scoreboard?dates={day:%Y%m%d}")


def season_events(season, through=None, cache_dir=None, refetch_days=3):
    """[(event id, date str, status name, season type)] for the regular season so far.
    Days older than `refetch_days` whose every game was final are cached and not re-pulled."""
    start, end = season_dates(season)
    today = through or dt.date.today()
    end = min(end, today)
    seen = {}
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        idx = os.path.join(cache_dir, "days.json")
        if os.path.exists(idx):
            seen = json.load(open(idx))
    out = []
    day = start
    while day <= end:
        key = day.isoformat()
        fresh = (today - day).days < refetch_days
        if key in seen and not fresh:
            evs = seen[key]
        else:
            sb = scoreboard(day)
            evs = []
            for e in sb.get("events", []):
                st = e["status"]["type"]["name"]
                stype = (e.get("season") or {}).get("type")
                evs.append([e["id"], key, st, stype])
            if all(st == "STATUS_FINAL" for _, _, st, _ in evs):
                seen[key] = evs
        out.extend(tuple(x) for x in evs)
        day += dt.timedelta(days=1)
    if cache_dir:
        json.dump(seen, open(os.path.join(cache_dir, "days.json"), "w"))
    return out


def normalize(summary, gid, date):
    comp = summary["header"]["competitions"][0]
    teams = {}
    for c in comp["competitors"]:
        teams[c["team"]["id"]] = {"abbr": nba_abbr(c["team"]["abbreviation"]), "side": c["homeAway"]}
    home = next(v["abbr"] for v in teams.values() if v["side"] == "home")
    away = next(v["abbr"] for v in teams.values() if v["side"] == "away")

    players = []
    for tb in summary["boxscore"].get("players", []):
        tabbr = nba_abbr(tb["team"]["abbreviation"])
        st = tb["statistics"][0]
        keys = st.get("keys") or []
        for a in st.get("athletes", []):
            ath = a.get("athlete") or {}
            if not ath.get("id"):
                continue
            row = {"eid": ath["id"], "name": ath.get("displayName"), "team": tabbr,
                   "starter": bool(a.get("starter")), "dnp": bool(a.get("didNotPlay")),
                   "pos": (ath.get("position") or {}).get("abbreviation")}
            vals = dict(zip(keys, a.get("stats") or []))
            fgm, fga = _split(vals.get("fieldGoalsMade-fieldGoalsAttempted"))
            f3m, f3a = _split(vals.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
            ftm, fta = _split(vals.get("freeThrowsMade-freeThrowsAttempted"))
            row.update(min=_num(vals.get("minutes")), pts=_num(vals.get("points")), fgm=fgm, fga=fga,
                       fg3m=f3m, fg3a=f3a, ftm=ftm, fta=fta, oreb=_num(vals.get("offensiveRebounds")),
                       dreb=_num(vals.get("defensiveRebounds")), reb=_num(vals.get("rebounds")),
                       ast=_num(vals.get("assists")), tov=_num(vals.get("turnovers")),
                       stl=_num(vals.get("steals")), blk=_num(vals.get("blocks")),
                       pf=_num(vals.get("fouls")), pm=_num(vals.get("plusMinus")))
            if not vals:
                row["dnp"] = True
            players.append(row)

    plays = []
    for p in summary.get("plays", []):
        c = p.get("coordinate") or {}
        x, y = c.get("x"), c.get("y")
        if x is None or y is None or abs(x) > 1000 or abs(y) > 1000:
            x = y = None
        tid = (p.get("team") or {}).get("id")
        plays.append({
            "seq": int(p.get("sequenceNumber") or 0), "pid": p.get("id"),
            "type": (p.get("type") or {}).get("text"),
            "tid": (p.get("type") or {}).get("id"), "text": p.get("text") or "",
            "period": (p.get("period") or {}).get("number"),
            "clock": _clock_seconds((p.get("clock") or {}).get("displayValue")),
            "team": teams.get(tid, {}).get("abbr"), "score_home": p.get("homeScore"),
            "score_away": p.get("awayScore"), "scoring": bool(p.get("scoringPlay")),
            "shooting": bool(p.get("shootingPlay")), "value": p.get("scoreValue") or 0,
            "pts_att": p.get("pointsAttempted") or 0, "x": x, "y": y,
            "ath": [pp["athlete"]["id"] for pp in p.get("participants") or [] if pp.get("athlete")],
        })
    plays.sort(key=lambda r: r["seq"])
    note = summary["header"].get("gameNote") or ""
    # ESPN's in-game win probability (recent seasons only): [play id, home win probability].
    wp = [[w.get("playId"), w.get("homeWinPercentage")] for w in (summary.get("winprobability") or [])
          if w.get("playId") is not None and w.get("homeWinPercentage") is not None]
    officials = [o.get("displayName") for o in ((summary.get("gameInfo") or {}).get("officials") or [])
                 if o.get("displayName")]
    return {"gid": gid, "date": date, "home": home, "away": away, "note": note,
            "players": players, "plays": plays, "wp": wp, "officials": officials}


NBA_TEAMS = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND",
             "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX",
             "POR", "SAC", "SAS", "TOR", "UTA", "WAS"}


def counts_in_season(g):
    """Does the NBA count this game in regular-season stats? ESPN files the All-Star Weekend
    games and the NBA Cup Championship as regular season; the NBA counts neither."""
    if g["home"] not in NBA_TEAMS or g["away"] not in NBA_TEAMS:
        return False
    if "cup championship" in (g.get("note") or "").lower():
        return False
    return True


def fetch_season(season, cache_dir, through=None, workers=8, log=print):
    """Every final regular-season game so far, normalized. Cached per game in cache_dir."""
    os.makedirs(os.path.join(cache_dir, "games"), exist_ok=True)
    CACHE_VERSION = "3"   # bump when normalize() changes, so cached games are rebuilt (3: play ids, win probability, officials)
    vfile = os.path.join(cache_dir, "games", "VERSION")
    if not os.path.exists(vfile) or open(vfile).read().strip() != CACHE_VERSION:
        for f in os.listdir(os.path.join(cache_dir, "games")):
            if f.endswith(".json.gz"):
                os.remove(os.path.join(cache_dir, "games", f))
        open(vfile, "w").write(CACHE_VERSION)
    evs = season_events(season, through=through, cache_dir=cache_dir)
    finals = [(g, d) for g, d, st, stype in evs if st == "STATUS_FINAL" and stype in (2, None)]
    todo = []
    for g, d in finals:
        path = os.path.join(cache_dir, "games", f"{g}.json.gz")
        if not os.path.exists(path):
            todo.append((g, d, path))

    def one(item):
        g, d, path = item
        n = normalize(_get(f"{BASE}/summary?event={g}"), g, d)
        with gzip.open(path, "wt") as fh:
            json.dump(n, fh)
        return g

    if todo:
        with cf.ThreadPoolExecutor(workers) as ex:
            list(ex.map(one, todo))
    games = []
    for g, d in finals:
        with gzip.open(os.path.join(cache_dir, "games", f"{g}.json.gz"), "rt") as fh:
            games.append(json.load(fh))
    skipped = [g for g in games if not counts_in_season(g)]
    games = [g for g in games if counts_in_season(g)]
    log(f"  ESPN: {len(games)} final games ({len(todo)} newly fetched"
        + (f"; {len(skipped)} the NBA doesn't count left out" if skipped else "") + ")")
    games.sort(key=lambda r: (r["date"], r["gid"]))
    return games


def in_progress_or_scheduled(season, day=None):
    """Games on `day` that aren't final yet (for the slate watcher)."""
    day = day or dt.date.today()
    sb = scoreboard(day)
    return [(e["id"], e["status"]["type"]["name"]) for e in sb.get("events", [])]


def rosters():
    """{espn athlete id: {...bio...}} for every current roster."""
    teams = _get(f"{BASE}/teams")["sports"][0]["leagues"][0]["teams"]
    out = {}
    for t in teams:
        tid = t["team"]["id"]
        abbr = nba_abbr(t["team"]["abbreviation"])
        r = _get(f"{BASE}/teams/{tid}/roster")
        for a in r.get("athletes", []):
            out[a["id"]] = {"name": a.get("fullName"), "team": abbr,
                            "height": a.get("height"), "weight": a.get("weight"),
                            "dob": a.get("dateOfBirth"), "pos": (a.get("position") or {}).get("abbreviation"),
                            "exp": (a.get("experience") or {}).get("years"),
                            "college": (a.get("college") or {}).get("name")}
    return out
