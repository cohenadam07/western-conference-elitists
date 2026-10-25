"""probe_sources.py — which data sources the Oct 2026 build can rely on, from this Mac.
Prints one line per source: ok / FAILED, row count, a few columns. No cache (live calls)."""
import json, time, traceback
import requests

SEASON = "2025-26"
T = 40
out = []

def probe(name, fn):
    t0 = time.time()
    try:
        msg = fn()
        out.append((name, "ok", msg))
    except Exception as e:
        out.append((name, "FAILED", repr(e)[:160]))
    print(f"{name:34} {out[-1][1]:7} {out[-1][2]}  ({time.time()-t0:.1f}s)", flush=True)
    time.sleep(0.8)

def shots():
    from nba_api.stats.endpoints import shotchartdetail as S
    df = S.ShotChartDetail(team_id=0, player_id=0, season_nullable=SEASON, season_type_all_star="Regular Season",
                           context_measure_simple="FGA", timeout=120).get_data_frames()[0]
    return f"{len(df)} shots; cols {list(df.columns)[:6]}..{[c for c in df.columns if c in ('ACTION_TYPE','SHOT_DISTANCE','LOC_X','PERIOD','MINUTES_REMAINING')]}"

def scoring():
    from nba_api.stats.endpoints import leaguedashplayerstats as L
    df = L.LeagueDashPlayerStats(season=SEASON, measure_type_detailed_defense="Scoring", per_mode_detailed="Totals", timeout=T).get_data_frames()[0]
    return f"{len(df)} rows; {[c for c in df.columns if 'AST' in c or 'PAINT' in c][:6]}"

def lineups(n):
    def f():
        from nba_api.stats.endpoints import leaguedashlineups as L
        df = L.LeagueDashLineups(season=SEASON, group_quantity=n, measure_type_detailed_defense="Advanced", per_mode_detailed="Totals", timeout=T).get_data_frames()[0]
        return f"{len(df)} {n}-man lineups; {list(df.columns)[:8]}"
    return f

def onoff_detail():
    from nba_api.stats.endpoints import teamplayeronoffdetails as D
    dfs = D.TeamPlayerOnOffDetails(team_id=1610612760, season=SEASON, measure_type_detailed_defense="Opponent", per_mode_detailed="Totals", timeout=T).get_data_frames()
    return f"{len(dfs)} frames; on rows {len(dfs[1])}; opp cols {[c for c in dfs[1].columns if 'FG3' in c or 'FT' in c][:6]}"

def gamelogs():
    from nba_api.stats.endpoints import playergamelogs as G
    df = G.PlayerGameLogs(season_nullable=SEASON, season_type_nullable="Regular Season", timeout=120).get_data_frames()[0]
    return f"{len(df)} player-games; {list(df.columns)[:10]}"

def schedule():
    from nba_api.stats.endpoints import scheduleleaguev2 as S
    d = S.ScheduleLeagueV2(season="2026-27", league_id="00", timeout=T).get_dict()
    ls = d["leagueSchedule"]; gd = ls["gameDates"]
    n = sum(len(x["games"]) for x in gd)
    return f"2026-27: {len(gd)} dates, {n} games, first {gd[0]['gameDate']}"

def injuries():
    # The league's official report: PDFs at ak-static.cms.nba.com, listed on the report page.
    r = requests.get("https://official.nba.com/nba-injury-report-2025-26-season/", timeout=T,
                     headers={"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/129.0"})
    pdfs = [x for x in r.text.split('"') if x.endswith(".pdf") and "Injury-Report" in x]
    if not pdfs:
        return f"page {r.status_code}, no pdf links found"
    p = requests.get(pdfs[-1], timeout=T, headers={"User-Agent": "Mozilla/5.0"})
    return f"page {r.status_code}, {len(pdfs)} pdfs; latest {pdfs[-1].split('/')[-1]} -> {p.status_code} {len(p.content)} bytes"

def sleeper():
    r = requests.get("https://api.sleeper.app/v1/state/nba", timeout=T)
    s = r.json()
    p = requests.get("https://api.sleeper.app/v1/players/nba", timeout=120)
    pl = p.json()
    some = next(v for v in pl.values() if v.get("full_name") == "Shai Gilgeous-Alexander")
    return f"state {s.get('season')} wk {s.get('week')}; players {len(pl)}; SGA keys {[k for k in some if 'id' in k][:8]}"

def sleeper_cors():
    r = requests.options("https://api.sleeper.app/v1/state/nba", timeout=T,
                         headers={"Origin": "https://wcehoops.com", "Access-Control-Request-Method": "GET"})
    return f"{r.status_code} allow-origin={r.headers.get('access-control-allow-origin')}"

def shot_difficulty():
    # NBA Inside the Game xFG: try the stats endpoint names seen in nba.com's app
    from nba_api.stats.library.http import NBAStatsHTTP
    for ep in ("leaguedashplayershotdifficulty", "shotdifficulty", "playershotdifficulty"):
        try:
            resp = NBAStatsHTTP().send_api_request(endpoint=ep, parameters={"Season": SEASON, "SeasonType": "Regular Season", "LeagueID": "00"}, timeout=20)
            return f"{ep}: {str(resp.get_dict())[:120]}"
        except Exception as e:
            last = f"{ep}: {repr(e)[:60]}"
    raise RuntimeError(last)

probe("ShotChartDetail (league-wide)", shots)
probe("Scoring measure (assisted %)", scoring)
probe("LeagueDashLineups 5-man", lineups(5))
probe("LeagueDashLineups 2-man", lineups(2))
probe("TeamPlayerOnOffDetails (opp)", onoff_detail)
probe("PlayerGameLogs", gamelogs)
probe("ScheduleLeagueV2 2026-27", schedule)
probe("Official injury report", injuries)
probe("Sleeper API", sleeper)
probe("Sleeper CORS", sleeper_cors)
probe("NBA shot difficulty", shot_difficulty)
json.dump(out, open("out/probe.json", "w"), indent=1)
