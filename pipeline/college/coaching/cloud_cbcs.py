"""
cloud_cbcs.py — College Basketball Coaching Savant's nightly refresh, riding College Basketball Savant's.

    python3 cloud_cbcs.py bundle <dir>        (the Mac) the inputs the cloud needs -> <dir>, for branch cbcs-bundles
    python3 cloud_cbcs.py refresh <repo>      (the cloud) the season in progress, merge mode -> <repo>/public/cbcs

The Mac builds everything that needs the Mac (the Wikipedia and ESPN coach registry, the roster flows from
every season's box scores and CBBD's rosters, the roster model, development, the tournament table, AP,
EADA, the fit test, every finished season's pass-one bundle). The cloud has College Savant's own refresh
of the current season (its raw ESPN games and its season file), so it re-parses that season's games
(games.py), refreshes the current season's roster rows from College Savant's season file, and runs
build.py --merge for the current season. A failure is a warning: College Savant is never blocked
(cloud_run.sh runs this after College Savant's own publish step is staged).

The bundle is public (the repo is): no CollegeBasketballData row goes into it. The roster rows lose their
recruiting fields (stars, rank, composite rating, class year); the class scores and labels they fed are
WCE's own numbers and stay. Current-season roster labels come from the Mac's last build; a player who
first appears after it gets a label from the earlier seasons' rows (a returning or transfer label needs no
CBBD row), and a freshman without one is labelled from his class.
"""
import gzip
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

OUT = os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs")
CURRENT = "2026-27"
CBBD_FIELDS = ("stars", "rrank", "rrating", "ryear")
FILES = ["registry.json", "expect.json", "expect-fit.json", "develop.json", "fit-test.json", "parts-fit.json",
         "tourney/ncaa.json", "tourney/other.json", "tourney/seed_baseline.json", "ap/ap.json", "eada/eada.json",
         "wiki/programs.json", "wiki/seasons.json", "wiki/coaches.json"]


def bundle(dest):
    os.makedirs(dest, exist_ok=True)
    for f in FILES:
        os.makedirs(os.path.dirname(os.path.join(dest, f)) or dest, exist_ok=True)
        shutil.copyfile(os.path.join(OUT, f), os.path.join(dest, f))
    R = json.loads(gzip.open(os.path.join(OUT, "rosters.json.gz")).read())
    for s in R["seasons"].values():
        for rows in s.values():
            for r in rows:
                for k in CBBD_FIELDS:
                    r.pop(k, None)
    with open(os.path.join(dest, "rosters.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps(R, separators=(",", ":")).encode(), 6, mtime=0))
    os.makedirs(os.path.join(dest, "bundles"), exist_ok=True)
    for f in sorted(os.listdir(os.path.join(OUT, "bundles"))):
        if not f.startswith(CURRENT):
            shutil.copyfile(os.path.join(OUT, "bundles", f), os.path.join(dest, "bundles", f))
    os.makedirs(os.path.join(dest, "census"), exist_ok=True)
    print("bundle written to", dest)


def refresh_current_rosters(public):
    """The current season's roster rows, refreshed from College Savant's season file: minutes, games,
    value, rate and role move nightly; the arrival label is the Mac's where the player is known."""
    import rosters as RS
    path = os.path.join(OUT, "rosters.json.gz")
    R = json.loads(gzip.open(path).read())
    d = json.loads(gzip.open(os.path.join(public, "cbb", "s", f"{CURRENT}.json.gz")).read())
    old = {r["eid"]: r for rows in R["seasons"].get(CURRENT, {}).values() for r in rows}
    order = RS.all_seasons()
    i_s = order.index(CURRENT)
    prior = {}
    for q in order[max(0, i_s - 3):i_s][::-1]:
        for t, rows in R["seasons"].get(q, {}).items():
            for r in rows:
                prior.setdefault(r["eid"], (t, q))
    games = {}
    import games as GM
    for g in GM.load(CURRENT):
        for t in (g["home"], g["away"]):
            games[t] = games.get(t, 0) + 1
    P, val, rate, poss = d["players"], d["values"]["value"]["r"], d["vparts"]["rate"], d["samples"]["poss"]
    for p in P:                 # rosters.py's rule: a team has played at least as many games as any of its players
        games[p[2]] = max(games.get(p[2], 0), p[8] or 0)
    teams = {}
    for i, p in enumerate(P):
        eid, team = p[0], p[2]
        o = old.get(eid)
        if o and o.get("src"):
            src, prev, ps = o["src"], o.get("prev"), o.get("prev_season")
        else:
            hit = prior.get(eid)
            if hit and hit[0] == team:
                src, prev, ps = "returning", hit[0], hit[1]
            elif hit:
                src, prev, ps = "transfer", hit[0], hit[1]
            else:
                src, prev, ps = ("hs" if p[4] == "Fr" and not RS.intl(p[15]) else "intl" if RS.intl(p[15]) else "juco"), None, None
        tg = games.get(team) or 0
        teams.setdefault(team, []).append(dict(eid=eid, name=p[1], pos=p[3], cls=p[4], src=src, prev=prev, prev_season=ps, min=p[10] or 0, gp=p[8], role=round((p[10] or 0) / (40.0 * tg), 4) if tg else None,
                                              value=val[i], rate=rate[i], poss=poss[i], qual=p[11], intl=RS.intl(p[15]), next=None,
                                              stars=p[16], rrank=p[17]))     # as College Savant's season file already publishes them
    R["seasons"][CURRENT] = teams
    with open(path, "wb") as fh:
        fh.write(gzip.compress(json.dumps(R, separators=(",", ":")).encode(), 6, mtime=0))
    return sum(len(v) for v in teams.values())


def refresh(repo):
    public = os.path.join(repo, "public")
    import games as GM
    GM.run(CURRENT, workers=2)
    n = refresh_current_rosters(public)
    print(f"{CURRENT}: {n} roster rows refreshed")
    # build beside public/, swap in only on success, so a failure never leaves half a site to publish
    import tempfile
    tmp = tempfile.mkdtemp(prefix="cbcs-")
    for d in ("cbb", "bcs"):
        os.symlink(os.path.join(public, d), os.path.join(tmp, d))
    rc = subprocess.call([sys.executable, "-W", "ignore", os.path.join(HERE, "build.py"), "--merge", CURRENT, "--public", tmp])
    if rc:
        print("::warning::College Basketball Coaching Savant's merge build failed; College Basketball Savant is unaffected")
        return rc
    shutil.rmtree(os.path.join(public, "cbcs"), ignore_errors=True)
    shutil.move(os.path.join(tmp, "cbcs"), os.path.join(public, "cbcs"))
    return 0


if __name__ == "__main__":
    if sys.argv[1] == "bundle":
        bundle(sys.argv[2])
    elif sys.argv[1] == "refresh":
        sys.exit(refresh(sys.argv[2]))
