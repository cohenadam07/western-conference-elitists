"""
cloud_cbb.py — one refresh of the season in progress (GitHub Actions; the Mac for rung 2).

    python3 cloud_cbb.py check <site>       exit 10 if a new final has settled, 0 if not
    python3 cloud_cbb.py refresh <site>     pull, rebuild, merge into public/cbb, write the heartbeat
    python3 cloud_cbb.py pending <site>     exit 10 while today's slate has games in play
    python3 cloud_cbb.py bundle <dir>       the finished seasons' working files, for cbb-bundles
    python3 cloud_cbb.py ages <dir>         the Mac's weekly ages for the season in progress

The ladder, §2. Rung 1 is ESPN from here. A 403 or a timeout counts one failed run in the heartbeat;
at two in a row `espn_cloud_blocked` is set and the run reads the raw files the Mac pushed to the
cbb-data branch (rung 2). If those stop too, CBBD (rung 3), then NCAA.com (rung 4). The heartbeat
records where each game came from, play-by-play coverage, the clean-lineup and coordinate rates, the
CBBD calls this month and the day's NCAA-vs-ESPN count, and the freshness alarm reads it.
"""
import datetime as dt
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import config as C  # noqa: E402
import espn_cbb as E  # noqa: E402

SEASON = os.environ.get("CBB_SEASON") or C.CURRENT
SETTLE_MINUTES = 20
BEAT = "data/cbb-refresh.json"


def beat(site):
    try:
        return json.load(open(os.path.join(site, BEAT)))
    except (OSError, ValueError):
        return {}


def game_day():
    from zoneinfo import ZoneInfo
    return (dt.datetime.now(ZoneInfo("America/New_York")) - dt.timedelta(hours=6)).date()


def check(site):
    have = set(map(str, beat(site).get("games", [])))
    seen = E.sweep(SEASON)
    new = [e for e in E.finals(seen) if e["id"] not in have]
    if not new:
        print(f"{len(E.finals(seen))} finals, all published")
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    ready = [e for e in new if not e.get("start") or now - dt.datetime.fromisoformat(e["start"].replace("Z", "+00:00")) > dt.timedelta(hours=2, minutes=30 + SETTLE_MINUTES)]
    print(f"{len(new)} new final(s), {len(ready)} settled")
    return 10 if ready else 0


def pending(site):
    have = set(map(str, beat(site).get("games", [])))
    left = []
    for e in E.sweep(SEASON).get(game_day().isoformat(), []):
        if e["status"] in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"):
            continue
        if e["status"] != E.FINAL or e["id"] not in have:
            left.append(e["id"])
    print(f"{len(left)} game(s) of today's slate not yet published")
    return 10 if left else 0


def run(*a):
    r = subprocess.run([sys.executable, "-W", "ignore"] + list(a), cwd=HERE)
    if r.returncode:
        raise SystemExit(f"step failed: {' '.join(a)}")


def refresh(site):
    b = beat(site)
    source, fails = "espn-cloud", int(b.get("espn_fails") or 0)
    try:
        seen = E.sweep(SEASON)
        # the last three days are asked again, for corrections
        cut = (dt.date.today() - dt.timedelta(3)).isoformat()
        for e in E.finals(seen):
            if e["date"] >= cut and os.path.exists(E.raw_path(SEASON, e["id"])):
                os.remove(E.raw_path(SEASON, e["id"]))
        E.pull_summaries(SEASON, seen)
        fails = 0
    except Exception as ex:  # noqa
        fails += 1
        print(f"::warning::ESPN failed from the cloud ({type(ex).__name__}); {fails} in a row")
        if fails < 2:
            write_beat(site, b, source, fails, None)
            return
        source = "cbb-data" if use_mac_branch() else "cbbd"
    subprocess.run([sys.executable, "torvik.py", SEASON], cwd=HERE)   # weekly at most; a failure keeps the last copy
    run("season.py", SEASON)
    run("identity.py", SEASON)
    run("heads.py", SEASON)
    run("ratings.py", "build", SEASON)
    run("bpi_pull.py", SEASON)
    if dt.date.today().month in (12, 1, 2, 3, 4):
        subprocess.run([sys.executable, "-W", "ignore", "netrank.py", SEASON], cwd=HERE)
    subprocess.run([sys.executable, "-c", f"import positions as P;P.apply_cuts('{SEASON}')"], cwd=HERE, check=True)
    run("rapm.py", "build", SEASON)
    run("build.py", "--public", os.path.join(site, "public"), "--merge", SEASON, *C.SEASONS)
    write_beat(site, b, source, fails, E.finals(json.load(open(os.path.join(E.ROOT, SEASON, "days.json")))))


def use_mac_branch():
    """Rung 2: raw files the Mac pushed, unpacked into the cache by cloud_run.sh."""
    return os.path.isdir(os.path.join(E.ROOT, SEASON, "from-mac"))


def write_beat(site, b, source, fails, finals):
    g = {}
    p = os.path.join(CC.HOME, "rebuilt", SEASON, "gates.json")
    if os.path.exists(p):
        g = json.load(open(p))
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    count = None
    try:
        import fallback as F
        count = F.count((dt.date.today() - dt.timedelta(1)).isoformat())
    except Exception:  # noqa
        pass
    doc = {"last_ok": now if finals is not None else b.get("last_ok"), "last_try": now, "season": SEASON, "source": source, "espn_fails": fails, "espn_cloud_blocked": fails >= 2,
           "games": sorted(e["id"] for e in finals) if finals is not None else b.get("games", []), "pbp_rate": g.get("pbp_rate"), "lineup_rate": g.get("lineup_ok_rate_of_d1"), "coord_rate": g.get("coord_rate"),
           "cbbd_calls_month": CC.calls_this_month(), "ncaa_count": count}
    os.makedirs(os.path.join(site, "data"), exist_ok=True)
    json.dump(doc, open(os.path.join(site, BEAT), "w"), indent=1)
    print(json.dumps({k: v for k, v in doc.items() if k != "games"}))


def bundle(out):
    """What the cloud needs to merge a night: derived files only. No CBBD row, no birthdate, no raw."""
    import shutil
    os.makedirs(out, exist_ok=True)
    for s in C.SEASONS:
        if s == C.CURRENT:
            continue
        d = os.path.join(out, "rebuilt", s)
        os.makedirs(d, exist_ok=True)
        for f in ("stints.json.gz", "gates.json"):
            p = os.path.join(CC.HOME, "rebuilt", s, f)
            if os.path.exists(p):
                shutil.copy(p, d)
    for sub in ("ratings", "impact", "positions"):
        src = os.path.join(CC.HOME, sub)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(out, sub), dirs_exist_ok=True)
    # identity: ages only. This branch is public; recruiting rows and birthdates stay on the Mac.
    os.makedirs(os.path.join(out, "identity"), exist_ok=True)
    for s in C.SEASONS:
        p = os.path.join(CC.HOME, "identity", f"{s}.json")
        if s != C.CURRENT and os.path.exists(p):
            json.dump({e: {"age": v.get("age")} for e, v in json.load(open(p)).items()}, open(os.path.join(out, "identity", f"{s}.json"), "w"), separators=(",", ":"))
    for f in ("settle.json", "adjust-test.json", "heads.json"):
        p = os.path.join(CC.HOME, f)
        if os.path.exists(p):
            shutil.copy(p, out)
    print("bundle", out)


def ages(out):
    """The Mac's weekly step: this season's ages, from T-Rank and the players ESPN has now. Ages only."""
    import identity as I
    import torvik as T
    T.fetch([SEASON])
    d = json.load(open(os.path.join(CC.HOME, "rebuilt", SEASON, "ids.json")))
    pg = __import__("pandas").read_pickle(os.path.join(CC.HOME, "rebuilt", SEASON, "pg.pkl"))
    main = pg.groupby(["eid", "team"])["min"].sum().reset_index().sort_values("min", ascending=False).drop_duplicates("eid").set_index("eid")["team"].to_dict()
    players = {e: {"name": d["names"].get(e, ""), "team": t} for e, t in main.items()}
    dob, _ = I.match_torvik(SEASON, players)
    res = {e: I.age_on_feb1(v, SEASON) for e, v in dob.items()}
    res = {e: a for e, a in res.items() if a is not None and 16 <= a <= 27}
    os.makedirs(out, exist_ok=True)
    json.dump(res, open(os.path.join(out, f"ages-{SEASON}.json"), "w"), separators=(",", ":"))
    print(len(res), "ages of", len(players))


if __name__ == "__main__":
    cmd, arg = sys.argv[1], os.path.abspath(sys.argv[2])
    sys.exit({"check": check, "pending": pending, "refresh": refresh, "bundle": bundle, "ages": ages}[cmd](arg))
