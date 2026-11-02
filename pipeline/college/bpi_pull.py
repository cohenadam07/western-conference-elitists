"""bpi_pull.py — ESPN's pre-game BPI projection per game: the yardstick for our ratings (§6A), and
BPI's season table for the reference column. Cached in <COLLEGE_HOME>/bpi/. Never republished per
game; the team table shows BPI as a labelled reference column.

    python3 bpi_pull.py 2025-26 2024-25
"""
import concurrent.futures as cf
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402

DIR = os.path.join(CC.HOME, "bpi")
FITT = "https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?region=us&lang=en&limit=400"


def stat(team, name):
    for s in (team or {}).get("statistics") or []:
        if s.get("name") == name:
            return s.get("value")
    return None


def game_rows(season):
    p = os.path.join(DIR, f"games-{season}.json")
    have = json.load(open(p)) if os.path.exists(p) else {}
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    todo = [e["id"] for e in E.finals(seen) if e["id"] not in have and e["date"] >= f"{season[:4]}-12-01" or (e["id"] not in have and e["date"] < f"{int(season[:4]) + 1}-04-15" and e["date"] >= f"{int(season[:4]) + 1}-01-01")]

    def one(gid):
        try:
            d = E.get(f"{E.CORE}/events/{gid}/competitions/{gid}/predictor", tries=2)
        except Exception:  # noqa
            return gid, None
        if not d:
            return gid, None
        return gid, {"home_mov": stat(d.get("homeTeam"), "teampredmov"), "away_mov": stat(d.get("awayTeam"), "teampredmov"),
                     "home_wp": stat(d.get("homeTeam"), "gameprojection"), "away_wp": stat(d.get("awayTeam"), "gameprojection")}

    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        for g, r in ex.map(one, todo):
            if r:
                have[g] = r
    os.makedirs(DIR, exist_ok=True)
    json.dump(have, open(p, "w"))
    print(season, "predictor rows", len(have))


def table(season):
    y = E.season_year(season)
    d = E.get(FITT + f"&season={y}")
    out = {}
    cat = next((c for c in d.get("categories", []) if c.get("name") == "bpi"), {})
    names = cat.get("names") or []
    for t in d.get("teams", []):
        cats = {c.get("name"): c for c in t.get("categories", [])}
        vals = (cats.get("bpi") or {}).get("values") or []
        v = dict(zip(names, vals))
        out[t["team"]["id"]] = {"bpi": v.get("bpi"), "rank": v.get("bpirank"), "off": v.get("bpioffense"), "def": v.get("bpidefense")}
    os.makedirs(DIR, exist_ok=True)
    json.dump(out, open(os.path.join(DIR, f"table-{season}.json"), "w"))
    print(season, "bpi table", len(out), list(out.items())[:1])


if __name__ == "__main__":
    for s in sys.argv[1:]:
        table(s)
        game_rows(s)
