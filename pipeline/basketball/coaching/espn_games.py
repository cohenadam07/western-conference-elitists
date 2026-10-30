"""
espn_games.py — every NBA game ESPN has, 2002-03 on, regular season and playoffs, cached per game.

    python3 espn_games.py fetch 2002-03 2025-26        # fill the cache (safe to re-run; only new games are fetched)
    python3 espn_games.py status                      # games cached per season and type

Basketball Coaching Savant reads the same ESPN summaries the Basketball Savant cloud refresh
does (espn_source.normalize, cache VERSION 3), so one parser (espn_tables.parse_game) serves
both. Differences from espn_source.fetch_season, which only knows the regular season in
progress:

  * the calendar runs to June 30 (October 2020 for the bubble, July 2021 for 2020-21), so the
    playoffs are in. Each game's index row carries ESPN's season type: 2 regular season,
    3 playoffs, 5 play-in (ESPN files the play-in under its own type from 2020-21).
  * franchises under their old names are kept: the New Jersey Nets ("NJ"), the SuperSonics
    ("SEA"), the New Orleans/Oklahoma City Hornets ("NOK"). The All-Star Weekend games and the
    NBA Cup final are left out, as the NBA leaves them out.

Cache layout (BCS_ESPN_CACHE, default ~/Basketball-Savant/espn-cache):
    <season>/days.json          scoreboard per day (final-only days are never re-pulled)
    <season>/games/<gid>.json.gz   one normalized game
    <season>/index.json         {gid: [date, season type, home, away]}
"""
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

try:  # the framework Python on the Mac has no root certificates of its own
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

import espn_source as S  # noqa: E402

CACHE_ROOT = os.environ.get("BCS_ESPN_CACHE") or os.path.expanduser("~/Basketball-Savant/espn-cache")
CACHE_VERSION = "3c"         # espn_source's "3" plus `extra` (venue, odds, attendance, tip-off), see extras()
OLD_TEAMS = {"NJ", "SEA", "NOK", "NO", "NOH", "CHH", "VAN"}
FIRST_SEASON = "2002-03"     # ESPN's play-by-play begins here
PLAY_IN_TYPE = 5


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def season_window(season, today=None):
    """Every calendar day the season (playoffs included) could cover."""
    y = int(season[:4])
    start, end = dt.date(y, 10, 1), dt.date(y + 1, 6, 30)
    if season == "2019-20":
        start, end = dt.date(2019, 10, 1), dt.date(2020, 10, 15)      # the bubble
    elif season == "2020-21":
        start, end = dt.date(2020, 12, 1), dt.date(2021, 7, 31)
    today = today or dt.date.today()
    return start, min(end, today)


def cache_dir(season):
    d = os.path.join(CACHE_ROOT, season)
    os.makedirs(os.path.join(d, "games"), exist_ok=True)
    vfile = os.path.join(d, "games", "VERSION")
    if not os.path.exists(vfile) or open(vfile).read().strip() != CACHE_VERSION:
        for f in os.listdir(os.path.join(d, "games")):
            if f.endswith(".json.gz"):
                os.remove(os.path.join(d, "games", f))
        open(vfile, "w").write(CACHE_VERSION)
    return d


def season_events(season, refetch_days=3, workers=6, log=print):
    """[(gid, date, status, season type)] for every day of the season's window. A day whose
    games were all final is cached; the last `refetch_days` days are always re-pulled."""
    d = cache_dir(season)
    idx = os.path.join(d, "days.json")
    seen = json.load(open(idx)) if os.path.exists(idx) else {}
    start, end = season_window(season)
    today = dt.date.today()
    days = []
    day = start
    while day <= end:
        key = day.isoformat()
        if key not in seen or (today - day).days < refetch_days:
            days.append(day)
        day += dt.timedelta(days=1)

    def one(day):
        sb = S.scoreboard(day)
        evs = []
        for e in sb.get("events", []):
            if not e.get("id"):
                continue
            status = e.get("status") or ((e.get("competitions") or [{}])[0].get("status")) or {}
            st = (status.get("type") or {}).get("name")
            stype = (e.get("season") or {}).get("type")
            evs.append([e["id"], day.isoformat(), st, stype])
        return day.isoformat(), evs

    if days:
        with cf.ThreadPoolExecutor(workers) as ex:
            for key, evs in ex.map(one, days):
                if all(st == "STATUS_FINAL" for _, _, st, _ in evs):
                    seen[key] = evs
                else:
                    seen.pop(key, None)
                    seen["_live_" + key] = evs
        json.dump({k: v for k, v in seen.items() if not k.startswith("_live_")}, open(idx, "w"))
    out = []
    for key in sorted(seen):
        out.extend(tuple(x) for x in seen[key])
    return out


def counts(g):
    """Does the NBA count this game? Real franchises only (old names included), no All-Star
    Weekend, no NBA Cup final."""
    teams = S.NBA_TEAMS | OLD_TEAMS
    if g["home"] not in teams or g["away"] not in teams:
        return False
    if "cup championship" in (g.get("note") or "").lower():
        return False
    return True


def extras(summary):
    """What espn_source.normalize leaves out and the coaching build needs: where the game was
    played, the betting lines ESPN carries (the consensus line from about 2015-16, named books
    later), attendance, tip-off time and the season type."""
    comp = (summary.get("header") or {}).get("competitions", [{}])[0]
    gi = summary.get("gameInfo") or {}
    venue = gi.get("venue") or {}
    addr = venue.get("address") or {}
    odds = []
    for o in summary.get("pickcenter") or []:
        h, a = o.get("homeTeamOdds") or {}, o.get("awayTeamOdds") or {}
        odds.append({"provider": (o.get("provider") or {}).get("name"), "details": o.get("details"),
                     "spread": o.get("spread"), "ou": o.get("overUnder"),
                     "home_fav": h.get("favorite"), "away_fav": a.get("favorite"),
                     "home_ml": h.get("moneyLine"), "away_ml": a.get("moneyLine")})
    return {"venue": venue.get("fullName"), "city": addr.get("city"), "state": addr.get("state"),
            "attendance": gi.get("attendance"), "neutral": comp.get("neutralSite"),
            "start": comp.get("date"), "stype": ((summary.get("header") or {}).get("season") or {}).get("type"),
            "odds": odds}


def fetch(season, workers=8, log=print):
    d = cache_dir(season)
    evs = season_events(season, log=log)
    finals = [(g, day, stype) for g, day, st, stype in evs if st == "STATUS_FINAL" and stype in (2, 3, PLAY_IN_TYPE, None)]
    todo = [(g, day, os.path.join(d, "games", f"{g}.json.gz")) for g, day, _ in finals
            if not os.path.exists(os.path.join(d, "games", f"{g}.json.gz"))]

    def one(item):
        g, day, path = item
        try:
            raw = S._get(f"{S.BASE}/summary?event={g}")
            n = S.normalize(raw, g, day)
            n["extra"] = extras(raw)
        except Exception as e:  # noqa
            return g, repr(e)[:80]
        with gzip.open(path + ".tmp", "wt") as fh:
            json.dump(n, fh)
        os.replace(path + ".tmp", path)
        return g, None

    failed = []
    t0 = time.time()
    if todo:
        with cf.ThreadPoolExecutor(workers) as ex:
            for i, (g, err) in enumerate(ex.map(one, todo), 1):
                if err:
                    failed.append((g, err))
                if i % 200 == 0:
                    log(f"  {season}: {i}/{len(todo)} fetched ({time.time() - t0:.0f}s)")
    index = {}
    for g, day, stype in finals:
        path = os.path.join(d, "games", f"{g}.json.gz")
        if not os.path.exists(path):
            continue
        try:
            with gzip.open(path, "rt") as fh:
                n = json.load(fh)
        except Exception:  # noqa
            os.remove(path)
            continue
        if not counts(n):
            continue
        index[g] = [day, stype, n["home"], n["away"]]
    json.dump(index, open(os.path.join(d, "index.json"), "w"))
    log(f"{season}: {len(index)} games ({sum(1 for v in index.values() if v[1] == 2)} regular season, "
        f"{sum(1 for v in index.values() if v[1] == 3)} playoffs, {sum(1 for v in index.values() if v[1] == PLAY_IN_TYPE)} play-in); "
        f"{len(todo)} newly fetched, {len(failed)} failed ({time.time() - t0:.0f}s)")
    return index, failed


def index_of(season):
    p = os.path.join(CACHE_ROOT, season, "index.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def load(season, types=(2,)):
    """Normalized games of the given ESPN season types, in date order."""
    idx = index_of(season)
    rows = sorted(((v[0], g) for g, v in idx.items() if v[1] in types or (None in types and v[1] is None)))
    for day, g in rows:
        with gzip.open(os.path.join(CACHE_ROOT, season, "games", f"{g}.json.gz"), "rt") as fh:
            yield json.load(fh)


def seasons_cached():
    if not os.path.isdir(CACHE_ROOT):
        return []
    return sorted(s for s in os.listdir(CACHE_ROOT) if os.path.exists(os.path.join(CACHE_ROOT, s, "index.json")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "fetch":
        first = sys.argv[2] if len(sys.argv) > 2 else FIRST_SEASON
        last = sys.argv[3] if len(sys.argv) > 3 else season_label(dt.date.today().year if dt.date.today().month >= 10 else dt.date.today().year - 1)
        for y in range(int(last[:4]), int(first[:4]) - 1, -1):
            fetch(season_label(y))
    else:
        for s in seasons_cached():
            idx = index_of(s)
            print(s, len(idx), "games;", sum(1 for v in idx.values() if v[1] == 3), "playoff")
