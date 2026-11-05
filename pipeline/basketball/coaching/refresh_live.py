"""
refresh_live.py — the season in progress, after a slate: fetch the day's new ESPN games, read
them, and rebuild the site's coaching files in merge mode (the other seasons come from their
saved bundles, so the output is what a full build would write).

    python3 refresh_live.py [--season 2026-27] [--public ../../../public] [--out <out dir>] [--tracking <dir>]

Runs in the cloud inside basketball-savant-cloud.yml (cloud_run.sh calls it after the
Basketball Savant refresh, continue-on-error) and on the Mac. --tracking points at the Mac's
latest upload of the NBA's tables (branch tracking-data), which nbatables.py reads when a
table is not in the local cache; without it the live season's tracking, hustle, Synergy and
zone rows stay empty until the next upload.

The saved bundles (<out>/bundles/<season>.pkl) must exist for the finished seasons: a full
build writes them. Where they are missing (a fresh cloud runner), the run says so and skips
the rebuild rather than publish pools computed from one season.
"""
import argparse
import datetime as dt
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def current_season():
    t = dt.date.today()
    return season_label(t.year if t.month >= 10 else t.year - 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default=current_season())
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "..", "public"))
    ap.add_argument("--out", default=os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs"))
    ap.add_argument("--tracking", default=None)
    a = ap.parse_args()
    os.environ["BCS_OUT"] = a.out
    if a.tracking:
        os.environ["BCS_NBA_TABLES"] = a.tracking
    import espn_games as G
    import process as P
    bundles = os.path.join(a.out, "bundles")
    have = sorted(f[:7] for f in os.listdir(bundles)) if os.path.isdir(bundles) else []
    if len(have) < 20:
        print(f"refresh_live: only {len(have)} saved bundles under {bundles}; a full build (build.py) must run first. Nothing rebuilt.")
        return 0
    if not os.path.exists(os.path.join(a.out, "registry.json")):
        print("refresh_live: no registry.json; run registry.py first. Nothing rebuilt.")
        return 0
    print(f"=== coaching refresh {a.season} ({dt.datetime.now():%Y-%m-%d %H:%M})", flush=True)
    G.fetch(a.season)
    P.process(a.season, force=True)
    # With/Without for the season in progress: failing costs that panel a night, never the refresh.
    try:
        import withwithout as WW
        WW.build_season(a.season, public=a.public)
    except Exception as e:  # noqa
        print(f"with/without: failed ({repr(e)[:120]})")
    # the head coach of the day's games: the registry's schedule comes from the NBA game logs, which
    # the cloud cannot pull; registry.py is a Mac step. Games the registry has not seen yet fall to
    # the tenure that covers the date (the coach of record for the team), see build.pass_one.
    rc = subprocess.call([sys.executable, "-u", os.path.join(HERE, "build.py"), "--public", a.public, "--out", a.out, "--refresh", a.season])
    if rc == 0:
        rc = check_data_room(a.public, a.season)
    print(f"=== coaching refresh done rc={rc}")
    return rc


def newest_date(path):
    """The newest date a Data Room table file covers (its `through` stamp, else the newest `date`
    in its rows), or None."""
    import gzip
    import json
    try:
        d = json.loads(gzip.decompress(open(path, "rb").read()))
        if d.get("through"):
            return d["through"]
        i = d["columns"].index("date")
        return max((r[i] for r in d["rows"] if r[i]), default=None)
    except Exception:  # noqa
        return None


def check_data_room(public, season):
    """Did the build publish the games the refresh read? The newest ESPN final processed for the
    season against the newest date in each Data Room table written to public/bcs/data. Until Nov
    2026 the build skipped the season in the cloud without a word (rc=0) and the Data Room sat on
    the Mac's last rows; now that is an error the log and the Control Room can see."""
    import process as P
    proc = P.load(season)
    want = max((g["date"] for g in (proc or {}).get("games", []) if g.get("stype") in (2, 3, 5)), default=None)
    if not want:
        return 0
    bad = []
    # the games table must reach the newest final; the play-by-play tables may sit a day short
    # (a night whose last game came with no play-by-play has no stints for that date)
    floor = (dt.date.fromisoformat(want) - dt.timedelta(days=1)).isoformat()
    for table in ("games", "stints", "units", "rotation", "decisions"):
        got = newest_date(os.path.join(public, "bcs", "data", table, f"{season}.json.gz"))
        print(f"  Data Room {table} {season}: through {got}")
        if got is None or got < (want if table == "games" else floor):
            bad.append(f"{table} through {got}")
    if bad:
        print(f"::error::Basketball Coaching Savant Data Room {season} is behind the ESPN games it read (through {want}): {', '.join(bad)}")
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
