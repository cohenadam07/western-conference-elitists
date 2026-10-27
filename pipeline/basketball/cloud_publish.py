"""
cloud_publish.py — the cloud refresh's front and back ends (GitHub Actions).

    python3 cloud_publish.py check  <site_root>   exit 10 if a refresh is due, 0 if not
    python3 cloud_publish.py stage  <site_root>   copy a finished run's outputs into public/,
                                                  write the heartbeat; prints what changed

`check` replaces the Mac's slate_watch.py: every ESPN final of the season so far is compared
with the games the last publish contained (data/savant-refresh.json "games"). A final that
isn't in yet, and has been final for 20+ minutes (so ESPN's box score has settled), makes a
refresh due. Scheduled runs pass --force to refresh regardless (stat corrections).

`stage` mirrors the publish half of publish_current.sh: the season file only counts as changed
if something besides its `generated` stamp moved, and the heartbeat is rewritten when the data
changed or at most once every ~20 hours, so the freshness alarm only fires when runs stop.
"""
import datetime as dt
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import espn_source as S  # noqa: E402

SETTLE_MINUTES = 20


def _beat(site):
    p = os.path.join(site, "data", "savant-refresh.json")
    try:
        return json.load(open(p))
    except Exception:  # noqa
        return {}


def finals(season, cache):
    evs = S.season_events(season, cache_dir=cache)
    return [(g, d) for g, d, st, stype in evs if st == "STATUS_FINAL" and stype in (2, None)]


def check(site, season, cache, force=False):
    if force:
        print("scheduled run: refreshing regardless")
        return 10
    # A new upload from the Mac (tracking-data branch) is folded in right away.
    sha = os.environ.get("TRACKING_SHA") or ""
    if sha and sha != _beat(site).get("tracking_sha"):
        print(f"new tracking upload from the Mac ({sha[:8]})")
        return 10
    have = set(map(str, _beat(site).get("games", [])))
    fin = finals(season, cache)
    new = [g for g, _ in fin if str(g) not in have]
    if not new:
        print(f"{len(fin)} finals, all published")
        return 0
    # Give ESPN a few minutes after the buzzer: box scores get corrected right after games.
    today = dt.date.today()
    sb = {}
    for day in {today, today - dt.timedelta(days=1)}:
        for e in S.scoreboard(day).get("events", []):
            sb[e["id"]] = e
    settled = []
    now = dt.datetime.now(dt.timezone.utc)
    for g in new:
        e = sb.get(str(g))
        if e is None:
            settled.append(g)      # an older game we missed: publish it
            continue
        # ESPN has no "final at" time; the scheduled tip plus the game's length is close enough
        start = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
        if now - start > dt.timedelta(hours=2, minutes=30 + SETTLE_MINUTES):
            settled.append(g)
    if not settled:
        print(f"{len(new)} new final(s), waiting {SETTLE_MINUTES} min for the box score to settle")
        return 0
    print(f"{len(settled)} new final(s) to publish")
    return 10


def _same(a, b):
    try:
        x, y = json.load(open(a)), json.load(open(b))
    except Exception:  # noqa
        return False
    strip = lambda d: {k: v for k, v in d.items() if k != "generated"}  # noqa: E731
    return strip(x) == strip(y)


def stage(site, run, season, cache):
    pub = os.path.join(site, "public")
    changed = []
    cur = os.path.join(run, "out", "current.json")
    if os.path.exists(cur) and not _same(cur, os.path.join(pub, "savant-current.json")):
        shutil.copy(cur, os.path.join(pub, "savant-current.json"))
        changed.append("savant-current.json")
    proj = os.path.join(run, "out", "savant-proj.json")
    if os.path.exists(proj):
        shutil.copy(proj, os.path.join(pub, "savant-proj.json"))
    teams = os.path.join(run, "out", "site", "savant-teams-current.json")
    if os.path.exists(teams):
        shutil.copy(teams, os.path.join(pub, "savant-teams-current.json"))
    # The October 2026 additions for the season in progress (ext_files.py): values and panels.
    # Copied only when the run built them, so a failed pass keeps the last good copy online.
    import ext_files as XFL
    ext_s = XFL.season_path(os.path.join(run, "out"), season)
    ext_new = False
    if os.path.exists(ext_s):
        for src, dst in ((ext_s, XFL.season_path(pub, season)),
                         (XFL.panels_path(os.path.join(run, "out"), season), XFL.panels_path(pub, season))):
            if os.path.exists(src) and not _same(src, dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy(src, dst)
                ext_new = True
    if ext_new:
        idx_path = XFL.index_path(pub)
        try:
            idx = json.load(open(idx_path))
        except (OSError, ValueError):
            idx = {"schema": XFL.SCHEMA, "seasons": {}}
        d = json.load(open(ext_s))
        idx["live"] = {"season": season, "through": d.get("through"), "generated": d.get("generated"),
                       "players": len(d.get("players", {}))}
        XFL.write(idx_path, idx)
        changed.append("savant-ext")
    lu = os.path.join(run, "out", "site", "lineups")
    if os.path.isdir(lu):
        os.makedirs(os.path.join(pub, "lineups"), exist_ok=True)
        for f in os.listdir(lu):
            shutil.copy(os.path.join(lu, f), os.path.join(pub, "lineups", f))
    # heartbeat
    beat = _beat(site)
    now = dt.datetime.now(dt.timezone.utc)
    through = None
    if os.path.exists(cur):
        through = json.load(open(cur)).get("through")
    try:
        last = dt.datetime.fromisoformat(beat["last_ok"])
    except Exception:  # noqa
        last = None
    games = sorted(str(g) for g, _ in finals(season, cache))
    sha = os.environ.get("TRACKING_SHA") or beat.get("tracking_sha")
    if changed or last is None or (now - last).total_seconds() > 20 * 3600 or games != beat.get("games") \
            or sha != beat.get("tracking_sha"):
        os.makedirs(os.path.join(site, "data"), exist_ok=True)
        json.dump({"last_ok": now.isoformat(timespec="seconds"), "season": season,
                   "through": through or beat.get("through"), "source": "cloud (ESPN)",
                   "tracking_sha": sha, "games": games},
                  open(os.path.join(site, "data", "savant-refresh.json"), "w"), indent=1)
    print("changed: " + (", ".join(changed) if changed else "nothing"))
    print(f"through: {through}")


if __name__ == "__main__":
    cmd, site = sys.argv[1], os.path.abspath(sys.argv[2])
    import savant_config as C
    season = os.environ.get("SAVANT_SEASON") or C.SEASON
    cache = os.path.join(os.environ.get("ESPN_CACHE_ROOT") or os.path.join(HERE, ".espn-cache"), season)
    if cmd == "check":
        sys.exit(check(site, season, cache, force="--force" in sys.argv))
    elif cmd == "stage":
        run = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "run")
        stage(site, run, season, cache)
