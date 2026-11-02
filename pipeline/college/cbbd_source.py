"""
cbbd_source.py — CollegeBasketballData plays, filed per game. Two jobs share one pull:

  HISTORY. ESPN logged no substitutions before mid-February 2025 and coordinates on only 10-20%
  of games (measured Nov 2, 2026: 16 dates, 2019-20 to 2025-26, 10 games each). CBBD has the five
  on the floor on every play from 2023-24 and shot locations from 2022-23 at least, on the same
  play ids as ESPN. So for those seasons ESPN stays the record of what happened and CBBD adds
  `fives` and `x, y` to it (join.py).

  RUNG 3. If ESPN is unreachable from both the cloud and the Mac, `to_game()` turns a file into
  the normalized game the parser reads, so the rest of the pipeline never knows.

One /plays/date call covers a game day. It needs a full timestamp: `date=2024-12-07T00:00:00Z`
answers in about a minute, `date=2024-12-07` returns 502 (both tested Nov 2). Files live with the
raw archive and never go in git; these rows are inputs, not something the site may serve.

    <cache>/<season>/cbbd/<ESPN event id>.json.gz
    {"gid", "start", "home", "away", "names": {cbbd id: name},
     "plays": [[play id, type, text, period, secs left, team name, is home, home score, away score,
                scoring, shooting, value, [participant ids], x, y, range, [on-floor ids]], ...]}

    python3 cbbd_source.py history 2024-25 2023-24 2022-23
"""
import datetime as dt
import gzip
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cbbd_client as C  # noqa: E402
import espn_cbb as E  # noqa: E402

# ESPN's substitutions begin here (see above); on and after it ESPN needs no help.
ESPN_COMPLETE_FROM = "2025-02-16"


def cbbd_dir(season):
    return os.path.join(E.ROOT, season, "cbbd")


def game_path(season, gid):
    return os.path.join(cbbd_dir(season), f"{gid}.json.gz")


def compact(rows):
    """One /plays/date response -> {gid: file dict}."""
    games = {}
    for p in rows:
        gid = str(p.get("gameSourceId") or "")
        if not gid:
            continue
        g = games.setdefault(gid, {"gid": gid, "start": p.get("gameStartDate"), "home": None, "away": None, "names": {}, "plays": []})
        home = bool(p.get("isHomeTeam"))
        if p.get("team"):
            g["home" if home else "away"] = p["team"]
        if p.get("opponent"):
            g["away" if home else "home"] = p["opponent"]
        for x in (p.get("participants") or []) + (p.get("onFloor") or []):
            if x.get("id") is not None:
                g["names"][str(x["id"])] = x.get("name")
        info = p.get("shotInfo") or {}
        loc = info.get("location") or {}
        g["plays"].append([p.get("sourceId"), p.get("playType"), p.get("playText"), p.get("period"), p.get("secondsRemaining"),
                           p.get("team"), home, p.get("homeScore"), p.get("awayScore"), bool(p.get("scoringPlay")),
                           bool(p.get("shootingPlay")), p.get("scoreValue") or 0, [x.get("id") for x in p.get("participants") or []],
                           loc.get("x"), loc.get("y"), info.get("range"),
                           [[x.get("id"), x.get("team")] for x in p.get("onFloor") or []]])
    return games


def pull_day(season, day, log=print):
    rows, left = C.get("/plays/date", date=f"{day}T00:00:00Z")
    os.makedirs(cbbd_dir(season), exist_ok=True)
    n = 0
    for gid, g in compact(rows).items():
        p = game_path(season, gid)
        with gzip.open(p + ".tmp", "wt") as fh:
            json.dump(g, fh, separators=(",", ":"))
        os.replace(p + ".tmp", p)
        n += 1
    log(f"{season} {day}: {len(rows)} plays, {n} games, meter says {left} left; ledger {C.calls_this_month()}")
    return n


def game_days(season, needs=lambda e: True):
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    out = []
    for d in sorted(seen):
        evs = [e for e in seen[d] if e["status"] == E.FINAL and needs(e)]
        if any(not os.path.exists(game_path(season, e["id"])) for e in evs):
            out.append(d)
    return out


def history(seasons, log=print):
    for s in seasons:
        days = game_days(s, needs=lambda e: e["date"] < ESPN_COMPLETE_FROM)
        log(f"{s}: {len(days)} game days to pull")
        for d in days:
            try:
                pull_day(s, d, log=log)
            except C.BudgetExhausted as e:
                log(f"STOP: {e}")
                return
            except RuntimeError as e:
                log(f"{s} {d}: {e}; moving on")
                time.sleep(30)


if __name__ == "__main__":
    logf = lambda m: print(time.strftime("%H:%M:%S"), m, flush=True)  # noqa: E731
    if sys.argv[1] == "history":
        history(sys.argv[2:], log=logf)
