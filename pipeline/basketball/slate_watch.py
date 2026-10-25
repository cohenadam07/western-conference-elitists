"""
slate_watch.py — decides when the site should refresh after games, so the cards move within
the hour of each slate ending instead of the next morning.

Run every 15 minutes by launchd (publish_current.sh --watch). Each run asks stats.nba.com's
ScoreboardV3 which of tonight's games are final (one or two light calls; cdn.nba.com is 403
even from the home network as of Oct 2026). A game counts as ready once it has been final for
WAIT_MIN minutes, which is roughly when the season dashboards include it.

    python slate_watch.py check   exit 10 if a refresh is due, 0 if not
    python slate_watch.py mark    after a successful publish: mark ready games done, but only
                                  those the published data actually contains (out/games_in.json,
                                  written by refresh_current.py); a game the dashboards hadn't
                                  picked up yet stays pending and triggers again, up to
                                  MAX_TRIES times (the 4:30am run catches anything left).

Early games end ~9:30pm ET, the West Coast ~1am, so a normal night is two or three refreshes.
State lives in logs/slate.json.
"""
import datetime as dt, json, os, sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
STATE = os.path.join("logs", "slate.json")
WAIT_MIN = 30
MAX_TRIES = 4
REFRESH_DUE = 10


def load():
    try:
        return json.load(open(STATE))
    except Exception:
        return {"finals": {}, "done": [], "tries": {}}


def save(s):
    os.makedirs("logs", exist_ok=True)
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat()
    s["finals"] = {g: t for g, t in s["finals"].items() if t >= cutoff}
    keep = set(s["finals"])
    s["done"] = [g for g in s["done"] if g in keep]
    s["tries"] = {g: n for g, n in s.get("tries", {}).items() if g in keep}
    json.dump(s, open(STATE, "w"), indent=1)


def in_season(now):
    # regular season: Oct 20 to mid April (playoffs aren't in the regular-season build)
    return (now.month == 10 and now.day >= 20) or now.month in (11, 12, 1, 2, 3) or (now.month == 4 and now.day <= 15)


def finals_now(now):
    """{gameId: status} for today's NBA date, plus yesterday's before 6am ET (late games)."""
    from nba_api.stats.endpoints import scoreboardv3
    dates = [now.date()] + ([now.date() - dt.timedelta(days=1)] if now.hour < 6 else [])
    out = {}
    for d in dates:
        sb = scoreboardv3.ScoreboardV3(game_date=d.isoformat(), league_id="00", timeout=30).get_dict()["scoreboard"]
        for g in sb.get("games", []):
            if str(g["gameId"]).startswith("002"):          # regular season only
                out[str(g["gameId"])] = int(g.get("gameStatus") or 0)
    return out


def check():
    now = dt.datetime.now(ET)
    if not in_season(now):
        print("offseason"); return 0
    s = load()
    try:
        status = finals_now(now)
    except Exception as e:
        print(f"scoreboard unavailable ({repr(e)[:80]}); will try again"); return 0
    stamp = dt.datetime.now(dt.timezone.utc).isoformat()
    for gid, st in status.items():
        if st == 3 and gid not in s["finals"]:
            s["finals"][gid] = stamp
    utc = dt.datetime.now(dt.timezone.utc)
    pending = [g for g in s["finals"] if g not in s["done"]]
    ready = [g for g in pending
             if (utc - dt.datetime.fromisoformat(s["finals"][g])).total_seconds() >= WAIT_MIN * 60]
    save(s)
    live = sum(1 for st in status.values() if st == 2)
    print(f"{now:%H:%M} ET: {len(status)} games, {live} live, {len(pending)} final and unpublished, {len(ready)} ready")
    return REFRESH_DUE if ready else 0


def mark():
    s = load()
    try:
        have = set(json.load(open(os.path.join("out", "games_in.json"))))
    except Exception:
        have = set()
    utc = dt.datetime.now(dt.timezone.utc)
    for g in [g for g in s["finals"] if g not in s["done"]]:
        old_enough = (utc - dt.datetime.fromisoformat(s["finals"][g])).total_seconds() >= WAIT_MIN * 60
        if not old_enough:
            continue
        if g in have:
            s["done"].append(g)
        else:
            s["tries"][g] = s["tries"].get(g, 0) + 1
            if s["tries"][g] >= MAX_TRIES:
                print(f"{g}: still not in the dashboards after {MAX_TRIES} refreshes; leaving it to the 4:30am run")
                s["done"].append(g)
    save(s)
    print(f"marked; {len(s['done'])} of {len(s['finals'])} recent finals published")
    return 0


if __name__ == "__main__":
    sys.exit({"check": check, "mark": mark}.get(sys.argv[1] if len(sys.argv) > 1 else "check", check)())
