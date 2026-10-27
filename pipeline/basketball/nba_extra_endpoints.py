"""
nba_extra_endpoints.py — stats.nba.com tables that nba_api doesn't wrap (or wraps wrongly).

NBA.com's "Inside the Game" pages (the AWS stats, 2025-26 on) read four endpoints that nba_api
has no class for, and nba_api's DunkScoreLeaders fails to parse (it expects a resultSet the
endpoint doesn't send). Each class below looks like an nba_api endpoint to the engine:

    cls(timeout=..., **params).get_data_frames()[frame]

so savant_engine.call() caches it under the same key scheme, export_tracking.py uploads it
from the Mac, and the cloud shim answers it by class name (espn_shim.UNAVAILABLE).

Endpoint names, parameters and columns were read from NBA.com's page code and confirmed live
from the Mac on Oct 26 2026 (pipeline notes: claude/basketball-savant-everything-build.md):
  gravityleaders, shotqualityleaders, leverageleaders   2025-26 on (2024-25 answers HTTP 500)
  handlescore                                           2025-26 on, one row per dribble sequence
  zonedefenseteamleaders                                2025-26 on, one row per team
  dunkscoreleaders                                      one row per dunk
None of them honour LastNGames: they are season-only.
"""
import time

import pandas as pd
import requests

BASE = "https://stats.nba.com/stats/"


def _headers():
    try:
        from nba_api.stats.library.http import NBAStatsHTTP
        return dict(NBAStatsHTTP.headers)
    except Exception:  # noqa
        return {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/130 Safari/537.36",
            "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com",
            "Accept": "application/json, text/plain, */*",
        }


class _Raw:
    resource = None
    list_key = None       # the JSON key holding the row list

    def __init__(self, timeout=30, season=None, season_type_all_star="Regular Season",
                 league_id="00", **extra):
        params = {"LeagueID": league_id, "Season": season, "SeasonType": season_type_all_star}
        for k, v in extra.items():
            params[k] = v
        r = requests.get(BASE + self.resource, params=params, headers=_headers(), timeout=timeout)
        r.raise_for_status()
        j = r.json()
        rows = self._rows(j)
        self._df = pd.DataFrame(rows)

    def _rows(self, j):
        if self.list_key in j:
            return j[self.list_key]
        # some answers nest the list one level down
        for v in j.values():
            if isinstance(v, dict) and self.list_key in v:
                return v[self.list_key]
        if "resultSets" in j:
            rs = j["resultSets"][0]
            return [dict(zip(rs["headers"], row)) for row in rs["rowSet"]]
        return []

    def get_data_frames(self):
        return [self._df]


class GravityLeadersRaw(_Raw):
    """All five gravity numbers (overall, on/off ball x perimeter/interior) and their frames."""
    resource, list_key = "gravityleaders", "leaders"


class ShotQualityLeaders(_Raw):
    """The NBA's shot quality (xFG) for shooters: average expected FG% overall / 2PT / 3PT, on
    makes and misses, the hardest make, FG% and 3P% above expected, average defender distance
    and defender pressure on his shots. Qualified shooters only (~125 in a full season)."""
    resource, list_key = "shotqualityleaders", "shots"


class LeverageLeaders(_Raw):
    """Leverage: win-probability impact, total and by area (offense, defense, on-ball defense,
    shooting, creation, rebounds, turnovers), per game."""
    resource, list_key = "leverageleaders", "leaders"


class HandleScore(_Raw):
    """One row per scored dribble sequence (handle score, dribbles, maneuvers, speed...)."""
    resource, list_key = "handlescore", "handleScores"


class ZoneDefenseTeamLeaders(_Raw):
    """Per team: share of defensive possessions in zone and what happened in zone vs not."""
    resource, list_key = "zonedefenseteamleaders", "teamZoneDefense"


class DunkScoreLeadersRaw(_Raw):
    """One row per dunk with the Dunk Score, its subscores and the tracked measurements (all of
    a season's dunks; empty PlayerID/TeamID/GameID parameters make the endpoint answer 400)."""
    resource, list_key = "dunkscoreleaders", "dunks"


ALL = [GravityLeadersRaw, ShotQualityLeaders, LeverageLeaders, HandleScore,
       ZoneDefenseTeamLeaders, DunkScoreLeadersRaw]
NAMES = {c.__name__ for c in ALL}


if __name__ == "__main__":
    import sys
    s = sys.argv[1] if len(sys.argv) > 1 else "2025-26"
    for cls in ALL:
        t0 = time.time()
        try:
            df = cls(season=s).get_data_frames()[0]
            print(f"{cls.__name__}: {len(df)} rows, {list(df.columns)[:12]} ({time.time()-t0:.1f}s)")
        except Exception as e:  # noqa
            print(f"{cls.__name__}: FAILED {repr(e)[:160]}")
        time.sleep(0.8)
