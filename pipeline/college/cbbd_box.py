"""
cbbd_box.py — CBBD's player box scores for the games ESPN never recorded. Adam's decision, Nov 2, 2026.

RESULT, Nov 2, 2026, 7 calls: CBBD CAN'T FILL THEM. Kept so nobody spends the quota again.
  * 2002-03: no player rows at all (0 of 1,574 team-games in Nov 14 to Dec 6, 2002).
  * 2012-13: both teams' rows for 22 of 321 failing games (Nov 9-22, 2012).
  * 2008-09: rows for 9 of 16 failing games (Feb 27 to Mar 7, 2009), and in none do the points add up:
    CBBD's box is ESPN's box, the same players with the same lines (Stony Brook on Feb 27: the same 7
    of 14 players, 42 of 57 points). The missing men can't be named: ESPN lists the rest with empty
    stats, and these games have no play-by-play.
  * Rows are per TEAM-game, so a 1,000-row reply holds about 480 games, not 1,000.

Seasons before 2009-10, and 2011-12 and 2012-13, fail the 98% box gate because ESPN lists some
games' players with empty stats. CBBD's `/games/players` covers up to 1,000 games a call by date
range, so `cbbd_box_plan.py` groups the dates with a failing game into windows of at most 900 games
(about 6 calls a season), and this fetches them.

Rows are kept on the Mac only, under the private raw archive:
    ~/Basketball-Savant/espn-cache/cbb/<season>/cbbd-box/<start>_<end>.json.gz
CBBD's terms make them inputs only: never in public/, cbb-bundles or a release.

Dates. ESPN files a game under its US Eastern date; CBBD filters on the UTC start. A window runs
from 10:00 UTC on its first day to 10:00 UTC the day after its last, so a 9pm Eastern tip stays in its day.

A reply of exactly 1,000 games was cut short: the window splits in two and both halves are asked.
Stops before the month's ledger would pass STOP (Adam: 580).

    python3 cbbd_box.py probe                  the first window of 2012-13 and of 2002-03
    python3 cbbd_box.py fetch 2008-09 ...      every planned window of those seasons
"""
import datetime as dt
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402

STOP = 580
LIMIT = 1000
PLAN = os.path.join(CC.HOME, "cbbd-box-plan.json")


class Stop(RuntimeError):
    pass


def path(season, a, b):
    return os.path.join(E.ROOT, season, "cbbd-box", f"{a}_{b}.json.gz")


def ask(season, a, b, log=print):
    """One window's rows, from disk if already fetched."""
    p = path(season, a, b)
    if os.path.exists(p):
        return json.loads(gzip.decompress(open(p, "rb").read()))
    if CC.calls_this_month() + 1 > STOP:
        raise Stop(f"ledger at {CC.calls_this_month()}; the next call would pass {STOP}")
    d0 = dt.date.fromisoformat(a)
    d1 = dt.date.fromisoformat(b) + dt.timedelta(days=1)
    rows, left = CC.get("/games/players", startDateRange=f"{d0}T10:00:00Z", endDateRange=f"{d1}T10:00:00Z")
    rows = rows or []
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "wb") as fh:
        fh.write(gzip.compress(json.dumps(rows, separators=(",", ":")).encode(), 6, mtime=0))
    os.replace(p + ".tmp", p)
    log(f"{season} {a}..{b}: {len(rows)} games; ledger {CC.calls_this_month()}, meter {left}")
    return rows


def window(season, a, b, log=print):
    """A window's rows, split in halves while CBBD cuts a reply short."""
    rows = ask(season, a, b, log)
    if len(rows) < LIMIT or a == b:
        return rows
    os.remove(path(season, a, b))           # cut short: keep only the halves
    d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    mid = d0 + (d1 - d0) // 2
    return window(season, a, str(mid), log) + window(season, str(mid + dt.timedelta(days=1)), b, log)


def planned(season):
    for s in json.load(open(PLAN))["seasons"]:
        if s["season"] == season:
            return [(w["start"], w["end"]) for w in s["windows"]]
    raise SystemExit(f"{season} is not in {PLAN}; run cbbd_box_plan.py")


def rows_for(season):
    """Every fetched row of a season, by ESPN game id. Read by normalize.py; no calls."""
    d = os.path.join(E.ROOT, season, "cbbd-box")
    out = {}
    if not os.path.isdir(d):
        return out
    for f in sorted(os.listdir(d)):
        if f.endswith(".json.gz"):
            for g in json.loads(gzip.decompress(open(os.path.join(d, f), "rb").read())):
                gid = str(g.get("gameSourceId") or "")
                if gid:
                    out[gid] = g
    return out


def main():
    log = lambda m: print(dt.datetime.now().strftime("%H:%M:%S"), m, flush=True)  # noqa: E731
    cmd = sys.argv[1]
    try:
        if cmd == "probe":
            for s in ("2012-13", "2002-03"):
                a, b = planned(s)[0]
                window(s, a, b, log)
        elif cmd == "fetch":
            for s in sys.argv[2:]:
                for a, b in planned(s):
                    window(s, a, b, log)
                log(f"{s}: {len(rows_for(s))} games on file")
    except (Stop, CC.BudgetExhausted) as e:
        log(f"stopped: {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()
