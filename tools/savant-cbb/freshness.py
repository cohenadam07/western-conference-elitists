"""
freshness.py — are College Basketball Savant and College Basketball Coaching Savant as current as ESPN?

    python3 tools/savant-cbb/freshness.py --site https://wcehoops.com     the live site (the alarm)
    python3 tools/savant-cbb/freshness.py                                the repo's public/
    options: --only cbb | cbcs     --hours N (default 24)     --season 2026-27

The reference is ESPN itself, not our own heartbeat: every final of the season whose two teams are
both Division I (the core API's conference list, espn_cbb.conferences()) and that tipped more than
--hours ago. Against it:

  College Basketball Savant (cbb):   every one of those games is in cbb/games/<season>.json as a D1
      game (non_d1 0), the newest of them is no later than the season file's `through` (the date of the
      player stats), and that file's D1 game count is ESPN's. Tolerance none: 2023-24, 2024-25 and
      2025-26 each match ESPN's D1 finals exactly (5,726, 5,764 and 5,752 games, 0 missing).
  College Basketball Coaching Savant (cbcs):  the same games in cbcs/data/games/<season>.json and its
      `through` as new; tolerance 0.1% of the games (it lacked 3 of 5,726 in 2023-24 and 2024-25, 0 in
      2025-26: a game with no coach assigned).

Why it exists: from Nov 4, 2026 ESPN's scoreboard stopped sending team.conferenceId, every new game
read as two non-D1 teams, and both products stopped counting games while every refresh succeeded and
the heartbeat (which lists games fetched, not games counted) kept growing. Duke showed 1 game after 2.

Exits 1 with ::error:: lines when a product is behind, 0 when both are current. Stdlib only.
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sys
import tempfile
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "college"))
os.environ.setdefault("ESPN_CBB_CACHE", tempfile.mkdtemp(prefix="cbb-fresh-"))   # never the archive
import config as C  # noqa: E402
import espn_cbb as E  # noqa: E402

CBCS_TOLERANCE = 0.001


def loader(site, public):
    def load(rel):
        if site:
            req = urllib.request.Request(f"{site}/{rel}", headers={"Accept": "application/json", "Accept-Encoding": "gzip", "User-Agent": "wce-freshness"})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
            return json.loads(raw)
        p = os.path.join(public, rel)
        if os.path.exists(p + ".gz"):
            return json.loads(gzip.open(p + ".gz").read())
        return json.load(open(p))
    return load


def espn_d1(season, hours, log):
    """ESPN's settled D1-vs-D1 finals: {gid: (date, 'AWAY at HOME')}, and the newest such date."""
    conf = E.conferences(season, log=lambda m: None)
    if len(conf) < 300:
        raise SystemExit(f"::error::ESPN's Division I list came back with {len(conf)} teams; can't check")
    start, end = E.season_days(season)
    today = dt.date.today()
    days = [start + dt.timedelta(n) for n in range((min(end, today) - start).days + 1)]
    cut = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    out = {}
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        for d, sb in zip(days, ex.map(E.scoreboard, days)):
            for e in sb.get("events", []):
                r = E.event_row(e, d.isoformat(), conf)
                if r["status"] != E.FINAL or not all(t.get("id") in conf for t in r["teams"]) or len(r["teams"]) != 2:
                    continue
                if r["start"] and dt.datetime.fromisoformat(r["start"].replace("Z", "+00:00")) > cut:
                    continue
                home = next((t["abbr"] for t in r["teams"] if t["side"] == "home"), "?")
                away = next((t["abbr"] for t in r["teams"] if t["side"] == "away"), "?")
                out[r["id"]] = (r["date"], f"{away} at {home}")
    log(f"ESPN: {len(out)} D1 finals in {season} more than {hours}h old, newest {max((v[0] for v in out.values()), default=None)}")
    return out


def compare(name, want, have, through, tolerance, log):
    """have: our gids counted as D1 games. Returns error lines."""
    errs = []
    missing = sorted(set(want) - set(have), key=lambda g: want[g][0])
    newest = max((v[0] for v in want.values()), default=None)
    allowed = int(len(want) * tolerance)
    log(f"{name}: {len(set(want) & set(have))} of ESPN's {len(want)} D1 finals, through {through}")
    if len(missing) > allowed:
        eg = "; ".join(f"{want[g][0]} {want[g][1]} ({g})" for g in missing[:6])
        errs.append(f"{name} is missing {len(missing)} of ESPN's {len(want)} Division I finals more than a day old"
                    f"{f' (allowed {allowed})' if allowed else ''}, the oldest from {want[missing[0]][0]}: {eg}")
    if newest and (not through or through < newest):
        errs.append(f"{name} runs through {through}, but ESPN has D1 finals more than a day old from {newest}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site")
    ap.add_argument("--local", default=os.path.join(ROOT, "public"))
    ap.add_argument("--season", default=C.CURRENT)
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--only", choices=["cbb", "cbcs"])
    a = ap.parse_args()
    log = lambda m: print(m, flush=True)  # noqa: E731
    load = loader(a.site.rstrip("/") if a.site else None, a.local)
    want = espn_d1(a.season, a.hours, log)
    errs = []
    if a.only in (None, "cbb"):
        g = load(f"cbb/games/{a.season}.json")
        c = g["cols"]
        have = [r[c.index("gid")] for r in g["rows"] if not r[c.index("non_d1")]]
        through = load(f"cbb/s/{a.season}.json").get("through")
        errs += compare("College Basketball Savant", want, have, through, 0, log)
    if a.only in (None, "cbcs"):
        g = load(f"cbcs/data/games/{a.season}.json")
        c = g["cols"]
        have = {r[c.index("gid")] for r in g["rows"]}
        errs += compare("College Basketball Coaching Savant", want, have, g.get("through"), CBCS_TOLERANCE, log)
    for e in errs:
        print(f"::error::{e}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
