"""
espn_cbb.py — ESPN's men's college feed: the scoreboard sweep and the raw archive.

Rung 0 and rung 1 of the fallback ladder. This module only FETCHES and FILES what ESPN says; the
college parser (normalize.py) reads the archive, so a parser change never spends a request.

    python3 espn_cbb.py sweep 2025-26          every day of a season -> days.json
    python3 espn_cbb.py pull 2025-26 2024-25   sweep, then every final's summary into raw/

On disk, under ESPN_CBB_CACHE (default ~/Basketball-Savant/espn-cache/cbb):
    <season>/days.json            {"YYYY-MM-DD": [event rows]}
    <season>/conferences.json     {team id: conference id} for every D1 team, refreshed daily
    <season>/raw/<event id>.json.gz    the summary response, byte for byte

Three things the NBA module does not have to do:
  * ESPN's college JSON carries raw control characters, so every parse is strict=False
    (json.load fails on the scoreboard for Feb 14, 2026, at byte 573,390).
  * groups=50 lists a D1 team's games against non-D1 opponents too. They are kept: the box score
    counts for the D1 player. The opponent has no conference, which is the `non_d1` flag.
  * Since Nov 2026 the scoreboard sends no team.conferenceId and sets conferenceCompetition on every
    game, so the conference comes from the core API's D1 list (conferences(), <season>/conferences.json)
    and a conference game is ESPN's flag AND the same conference (conf_game()).
  * At most 6 requests in parallel, always (WORKERS).
"""
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball"
UA = {"User-Agent": "Mozilla/5.0"}
WORKERS = 6
ROOT = os.environ.get("ESPN_CBB_CACHE") or os.path.expanduser("~/Basketball-Savant/espn-cache/cbb")
LOCK = os.path.expanduser("~/Basketball-Savant/logs/.publish.lock")

FINAL = "STATUS_FINAL"


class Refused(RuntimeError):
    """ESPN answered 403 or 429: the sign rung 2 watches for."""


def fetch(url, tries=5, timeout=30):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                return None
            if e.code in (403, 429) and i == tries - 1:
                raise Refused(f"ESPN {e.code}: {url}") from None
        except Exception as e:  # noqa
            last = e
        time.sleep(min(2 ** i, 20))
    raise RuntimeError(f"ESPN fetch failed after {tries} tries: {url}: {last}")


def loads(raw):
    return json.loads(raw.decode("utf8", "replace"), strict=False)


def get(url, **kw):
    raw = fetch(url, **kw)
    return None if raw is None else loads(raw)


def season_year(season):
    return int(season[:4]) + 1


def season_label(end_year):
    return f"{end_year - 1}-{str(end_year)[2:]}"


def season_days(season):
    y = int(season[:4])
    return dt.date(y, 10, 28), dt.date(y + 1, 4, 12)


def event_row(e, key, conf=None):
    """One scoreboard event. `conf` is the season's team -> conference map (conferences()), used where
    the scoreboard leaves a team's conferenceId out (ESPN stopped sending it in Nov 2026)."""
    c = (e.get("competitions") or [{}])[0]
    status = e.get("status") or c.get("status") or {}
    teams = []
    for t in c.get("competitors") or []:
        tm = t.get("team") or {}
        teams.append({"id": tm.get("id"), "abbr": tm.get("abbreviation"), "name": tm.get("displayName"),
                      "conf": tm.get("conferenceId") or (conf or {}).get(tm.get("id")), "side": t.get("homeAway"), "score": t.get("score")})
    notes = " ".join(n.get("headline") or "" for n in c.get("notes") or [])
    row = {"id": e.get("id"), "date": key, "start": e.get("date"), "status": (status.get("type") or {}).get("name"),
           "stype": (e.get("season") or {}).get("type"), "neutral": bool(c.get("neutralSite")),
           "cflag": bool(c.get("conferenceCompetition")), "tourn": c.get("tournamentId"),
           "note": notes, "venue": (c.get("venue") or {}).get("id"), "pbp": c.get("playByPlayAvailable"), "teams": teams}
    row["confgame"] = conf_game(row["cflag"], teams)
    return row


def conf_game(flag, teams):
    """A conference game: ESPN's flag, and both teams in the same conference. In 2024-25 and 2025-26 the
    flag never once marked two teams of different conferences (0 of 7,306 flagged finals), so the second
    half changes nothing there; since Nov 2026 ESPN sets the flag on every game, and it is what keeps
    Duke-Army a non-conference game."""
    cs = [t.get("conf") for t in teams]
    return bool(flag) and len(cs) == 2 and bool(cs[0]) and cs[0] == cs[1]


def conferences(season, seen=None, log=print, max_age_hours=20):
    """Every Division I team's conference for a season, {team id: conference id}, from ESPN's core API
    (one call for the conferences, one per conference for its teams: 33 calls, about 4 seconds).
    Kept in <season>/conferences.json and asked again after max_age_hours. The scoreboard used to carry
    it as team.conferenceId and stopped in Nov 2026; without it every game reads as two non-D1 teams
    and falls out of the stats. If ESPN can't be reached: the last copy, else what earlier rows recorded."""
    import re
    path = os.path.join(ROOT, season, "conferences.json")
    have = json.load(open(path)) if os.path.exists(path) else None
    if have and time.time() - have.get("fetched", 0) < max_age_hours * 3600:
        return have["teams"]
    base = f"{CORE}/seasons/{season_year(season)}/types/2/groups/50"
    try:
        kids = get(f"{base}/children?limit=100") or {}
        cids = [re.search(r"/groups/(\d+)", it["$ref"]).group(1) for it in kids.get("items") or []]
        teams = {}
        for cid in cids:
            for it in (get(f"{CORE}/seasons/{season_year(season)}/types/2/groups/{cid}/teams?limit=100") or {}).get("items") or []:
                teams[re.search(r"/teams/(\d+)", it["$ref"]).group(1)] = cid
        if len(teams) < 300:                  # D1 has had 347 to 365 teams since 2013-14
            raise RuntimeError(f"only {len(teams)} teams in {len(cids)} conferences")
    except Exception as ex:  # noqa
        log(f"::warning::ESPN's conference list for {season} failed ({type(ex).__name__}: {ex}); using the last copy")
        if have:
            return have["teams"]
        return {t["id"]: t["conf"] for d in sorted(seen or {}) for e in (seen or {})[d] for t in e["teams"] if t.get("conf")}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"fetched": time.time(), "season": season, "teams": teams}, open(path + ".tmp", "w"), separators=(",", ":"))
    os.replace(path + ".tmp", path)
    log(f"{season}: {len(teams)} D1 teams in {len(set(teams.values()))} conferences")
    return teams


def repair(seen, conf):
    """Rows already on disk that were swept while the scoreboard left out conferenceId: fill each D1
    team's conference from the map and work the conference-game flag out again. Rows that have their
    conference keep it. Returns how many rows changed."""
    n = 0
    for evs in seen.values():
        for e in evs:
            before = ([t.get("conf") for t in e["teams"]], e.get("confgame"))
            for t in e["teams"]:
                if not t.get("conf") and conf.get(t.get("id")):
                    t["conf"] = conf[t["id"]]
            e.setdefault("cflag", bool(e.get("confgame")))
            e["confgame"] = conf_game(e["cflag"], e["teams"])
            n += before != ([t.get("conf") for t in e["teams"]], e["confgame"])
    return n


def scoreboard(day):
    return get(f"{SITE}/scoreboard?groups=50&limit=400&dates={day:%Y%m%d}") or {}


def sweep(season, through=None, refetch_days=3, log=print):
    """Every event of a season, by US Eastern game date. Days older than refetch_days whose
    every game is settled are not asked again."""
    sdir = os.path.join(ROOT, season)
    os.makedirs(sdir, exist_ok=True)
    path = os.path.join(sdir, "days.json")
    seen = json.load(open(path)) if os.path.exists(path) else {}
    start, end = season_days(season)
    today = through or dt.date.today()
    end = min(end, today)
    days = [start + dt.timedelta(n) for n in range((end - start).days + 1)]
    todo = [d for d in days if d.isoformat() not in seen or (today - d).days < refetch_days]

    conf = conferences(season, seen, log)

    def one(d):
        evs = [event_row(e, d.isoformat(), conf) for e in scoreboard(d).get("events", []) if e.get("id")]
        return d.isoformat(), evs

    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for key, evs in ex.map(one, todo):
            seen[key] = evs
    fixed = repair(seen, conf)
    if fixed:
        log(f"{season}: {fixed} stored rows given their conference back")
    tmp = path + ".tmp"
    json.dump(seen, open(tmp, "w"), separators=(",", ":"))
    os.replace(tmp, path)
    n = sum(len(v) for v in seen.values())
    log(f"{season}: {len(seen)} days, {n} events ({len(todo)} days asked)")
    return seen


def raw_path(season, gid):
    return os.path.join(ROOT, season, "raw", f"{gid}.json.gz")


def read_raw(season, gid):
    with gzip.open(raw_path(season, gid), "rb") as fh:
        return loads(fh.read())


def finals(seen):
    return [e for d in sorted(seen) for e in seen[d] if e["status"] == FINAL]


def pull_summaries(season, seen, log=print):
    """Every final not yet on disk. A final is immutable once settled; the cloud refresh re-pulls
    the last three days for corrections by deleting those files first."""
    os.makedirs(os.path.join(ROOT, season, "raw"), exist_ok=True)
    todo = [e["id"] for e in finals(seen) if not os.path.exists(raw_path(season, e["id"]))]
    log(f"{season}: {len(todo)} summaries to fetch")
    t0, done, missing = time.time(), 0, 0

    def one(gid):
        raw = fetch(f"{SITE}/summary?event={gid}")
        if raw is None:
            return gid, False
        p = raw_path(season, gid)
        with open(p + ".tmp", "wb") as fh:
            fh.write(gzip.compress(raw, 6, mtime=0))
        os.replace(p + ".tmp", p)
        return gid, True

    for i in range(0, len(todo), 300):
        while os.path.exists(LOCK):           # Basketball Savant's Mac jobs come first
            log("publish lock held; waiting")
            time.sleep(60)
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            for _, ok in ex.map(one, todo[i:i + 300]):
                done += ok
                missing += not ok
        log(f"{season}: {done}/{len(todo)} ({time.time() - t0:.0f}s, {missing} missing)")
    return done, missing


if __name__ == "__main__":
    cmd = sys.argv[1]
    logf = lambda m: print(time.strftime("%H:%M:%S"), m, flush=True)  # noqa: E731
    for s in sys.argv[2:]:
        seen = sweep(s, log=logf)
        if cmd == "pull":
            pull_summaries(s, seen, log=logf)
