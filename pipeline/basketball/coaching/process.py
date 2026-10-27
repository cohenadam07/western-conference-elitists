"""
process.py — every ESPN game of a season through gamefile.game, with players mapped to NBA ids
and games joined to the NBA's own game ids.

    python3 process.py 2002-03 2025-26        # -> out/bcs/games/<season>.json.gz, one file a season
    python3 process.py 2026-27 --force        # re-read a season (the season in progress, after a slate)

A season file:
  {"season", "generated", "players": {nid: {"name", "team"}}, "unmapped": [names ESPN has that the
   archive does not], "games": [gamefile dicts, with ESPN athlete ids replaced by NBA ids;
   a player the archive doesn't know keeps "e<espn id>"], "nba_ids": games joined}

Ids: namematch.Matcher against the season's players in public/savant-data.json (the season in
progress: public/savant-current.json), the same join espn_history.py uses, so a player here is
the player on his Basketball Savant card. The NBA game id comes from LeagueGameLog (the engine's
cache) by date and home franchise, with a one-day tolerance for games played abroad.
"""
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import espn_games as G  # noqa: E402
import gamefile as GF  # noqa: E402
import teams as TM  # noqa: E402
from namematch import Matcher  # noqa: E402

PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
_archive = {}


def archive_players(season):
    """The season's players as the Basketball Savant archive has them: [{id, name, team}]."""
    if season in _archive:
        return _archive[season]
    rows = []
    for name in ("savant-data.json", "savant-current.json"):
        p = os.path.join(PUBLIC, name)
        if not os.path.exists(p):
            continue
        d = json.load(open(p))
        rows = (d.get("data") or {}).get(season, {}).get("players", [])
        if rows:
            break
    _archive[season] = [{"id": p["id"], "name": p["name"], "team": p.get("team") or ""} for p in rows if p.get("id") is not None]
    return _archive[season]


def nba_game_index(season):
    """{(date, home franchise): nba game id} from the engine's cached LeagueGameLog tables."""
    import pandas as pd
    import savant_engine as E
    out = {}
    for st in ("Regular Season", "Playoffs"):
        key = E._key("LeagueGameLog", dict(season=season, season_type_all_star=st, player_or_team_abbreviation="T"), 0)
        p = os.path.join(SAVANT, "cache", key + ".json")
        if not os.path.exists(p):
            continue
        df = pd.read_json(p)
        for r in df.itertuples(index=False):
            if "vs." not in str(r.MATCHUP):
                continue
            fr = TM.FRANCHISES.get(int(r.TEAM_ID)) or TM.franchise(r.TEAM_ABBREVIATION)
            out[(str(r.GAME_DATE)[:10], fr)] = (str(r.GAME_ID).zfill(10), st)
    return out


def _work(args):
    season, gid = args
    p = os.path.join(G.CACHE_ROOT, season, "games", f"{gid}.json.gz")
    with gzip.open(p, "rt") as fh:
        g = json.load(fh)
    try:
        return gid, GF.game(g), None
    except Exception as e:  # noqa
        return gid, None, repr(e)[:200]


def _remap(x, idmap):
    """ESPN athlete ids -> NBA ids inside one game dict."""
    m = lambda e: idmap.get(str(e), f"e{e}")  # noqa: E731
    x["players"] = {m(e): v for e, v in x["players"].items()}
    for t in x["team"].values():
        t["starters"] = [m(e) for e in t["starters"]]
    for s in x["stints"]:
        s[3] = [m(e) for e in s[3]]
        s[4] = [m(e) for e in s[4]]
    return x


def process(season, workers=6, force=False, log=print):
    os.makedirs(os.path.join(OUT, "games"), exist_ok=True)
    dst = os.path.join(OUT, "games", f"{season}.json.gz")
    idx = G.index_of(season)
    if not idx:
        log(f"{season}: no ESPN games cached")
        return None
    if os.path.exists(dst) and not force:
        try:
            with gzip.open(dst, "rt") as fh:
                old = json.load(fh)
            if old.get("n_games") == len(idx):
                log(f"{season}: up to date ({len(idx)} games)")
                return dst
        except Exception:  # noqa
            pass
    t0 = time.time()
    gids = sorted(idx, key=lambda g: idx[g][0])
    games, errors = [], []
    with cf.ProcessPoolExecutor(workers) as ex:
        for gid, x, err in ex.map(_work, [(season, g) for g in gids], chunksize=20):
            if err:
                errors.append((gid, err))
                continue
            x["stype"] = idx[gid][1]
            games.append(x)
    # ids
    year = int(season[:4])
    players = archive_players(season)
    matcher = Matcher(players)
    seen, idmap, unmapped = {}, {}, {}
    for x in games:
        for e, pl in x["players"].items():
            if e in seen:
                continue
            key = TM.franchise(pl["team"])
            nid = matcher.find(pl["name"], TM.nba_abbr(key, year) if key else pl["team"])
            seen[e] = nid
            if nid is not None:
                idmap[str(e)] = int(nid) if str(nid).isdigit() else nid
            else:
                unmapped[str(e)] = pl["name"]
    names = {}
    for x in games:
        for e, pl in x["players"].items():
            names[idmap.get(str(e), f"e{e}")] = {"name": pl["name"], "team": TM.franchise(pl["team"]) or pl["team"]}
        _remap(x, idmap)
    # NBA game ids
    nba = nba_game_index(season)
    joined = 0
    for x in games:
        hit = None
        for d in (0, 1, -1):
            day = (dt.date.fromisoformat(x["date"]) + dt.timedelta(days=d)).isoformat()
            hit = nba.get((day, x["home"])) or nba.get((day, x["away"]))   # the NBA and ESPN can disagree on the designated home side abroad
            if hit:
                break
        x["nba_gid"] = hit[0] if hit else None
        joined += bool(hit)
    out = {"season": season, "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "n_games": len(idx), "players": {str(k): v for k, v in names.items()}, "idmap": idmap,
           "unmapped": sorted(set(unmapped.values())), "errors": errors, "games": games}
    with gzip.open(dst + ".tmp", "wt") as fh:
        json.dump(out, fh, separators=(",", ":"))
    os.replace(dst + ".tmp", dst)
    log(f"{season}: {len(games)} games ({sum(1 for x in games if x['stype'] == 3)} playoff), {len(idmap)} players mapped, "
        f"{len(unmapped)} not, {joined} joined to NBA ids, {len(errors)} errors ({time.time() - t0:.0f}s, {os.path.getsize(dst) // 1024} KB)")
    return dst


def _pid(k):
    return int(k) if isinstance(k, str) and k.isdigit() else k


def load(season):
    """A season file, with player ids as ints again (JSON keys come back as strings)."""
    p = os.path.join(OUT, "games", f"{season}.json.gz")
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt") as fh:
        d = json.load(fh)
    d["players"] = {_pid(k): v for k, v in d["players"].items()}
    for g in d["games"]:
        g["players"] = {_pid(k): v for k, v in g["players"].items()}
    return d


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    first = args[0] if args else G.FIRST_SEASON
    last = args[1] if len(args) > 1 else first
    for y in range(int(last[:4]), int(first[:4]) - 1, -1):
        process(G.season_label(y), force=force)
