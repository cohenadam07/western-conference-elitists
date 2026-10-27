"""
espn_history.py — the play-by-play family (ext_pbp) for finished seasons, from ESPN.

    python3 espn_history.py <cache_dir> <out_dir> 2025-26 2002-03

For each season: fetch every regular-season game from ESPN (espn_source, cached per game),
rebuild stints (espn_tables.parse_game), count (ext_pbp.season_counts), map ESPN player ids to
NBA ids by name and team against the season's players in public/savant-data.json, and write
<out_dir>/<season>.json = {nba id: counters}. ESPN's site API is public and answers cloud
servers, so this runs anywhere; the season in progress is counted by the cloud refresh itself.
"""
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import espn_source as S  # noqa: E402
import espn_tables as T  # noqa: E402
import ext_pbp as P  # noqa: E402

PUBLIC = os.path.join(HERE, "..", "..", "public")


from namematch import Matcher  # noqa: E402


def archive_players(season, data=None):
    data = data or json.load(open(os.path.join(PUBLIC, "savant-data.json")))
    return data["data"].get(season, {}).get("players", [])


# ESPN's team abbreviations in older seasons -> the NBA's for the same franchise-season
OLD = {"NJ": "NJN", "SEA": "SEA", "NO": "NOH", "NOK": "NOK", "CHA": "CHA", "VAN": "VAN", "WSH": "WAS",
       "GS": "GSW", "SA": "SAS", "NY": "NYK", "UTAH": "UTA", "PHX": "PHX", "BKN": "BKN"}


def idmap_for(games, players):
    m = Matcher(players)
    out, miss, seen = {}, set(), set()
    for g in games:
        for pl in g["players"]:
            eid = pl["eid"]
            if eid in seen:
                continue
            seen.add(eid)
            nid = m.find(pl["name"], OLD.get(pl["team"], pl["team"]))
            if nid is not None:
                out[eid] = nid
            else:
                miss.add(f"{pl['name']} ({pl['team']})")
    return out, sorted(miss)


_season_dates = S.season_dates


def _dates(season):
    """The regular season's calendar, with the two seasons that ran late (the 2020 bubble's
    seeding games in August, 2020-21's May finish)."""
    import datetime as dt
    a, b = _season_dates(season)
    late = {"2019-20": dt.date(2020, 8, 16), "2020-21": dt.date(2021, 5, 17)}
    return a, late.get(season, b)


S.season_dates = _dates


def main():
    cache, out_dir, first, last = sys.argv[1:5]
    os.makedirs(out_dir, exist_ok=True)
    data = json.load(open(os.path.join(PUBLIC, "savant-data.json")))
    y1, y2 = int(first[:4]), int(last[:4])
    for y in range(y1, y2 - 1, -1):
        season = f"{y}-{str(y + 1)[2:]}"
        dst = os.path.join(out_dir, f"{season}.json")
        if os.path.exists(dst):
            print(f"{season}: done already", flush=True)
            continue
        t0 = time.time()
        try:
            import datetime as dt
            games = S.fetch_season(season, os.path.join(cache, season), through=dt.date(y + 1, 6, 30),
                                   log=lambda m: print(m, flush=True))
        except Exception as e:  # noqa
            print(f"{season}: fetch failed {repr(e)[:160]}", flush=True)
            continue
        players = archive_players(season, data)
        idmap, miss = idmap_for(games, players)
        counts = P.season_counts(games, T.parse_game)
        out = defaultdict(lambda: defaultdict(float))
        for eid, cnt in counts.items():
            nid = idmap.get(eid)
            if nid is None:
                continue
            for k, v in cnt.items():
                out[nid][k] += v
        json.dump({str(k): {kk: round(vv, 4) for kk, vv in v.items()} for k, v in out.items()},
                  open(dst, "w"), separators=(",", ":"))
        print(f"{season}: {len(games)} games, {len(out)} players mapped, {len(miss)} unmapped "
              f"({', '.join(miss[:6])}{'...' if len(miss) > 6 else ''}) in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
