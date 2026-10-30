"""
nba_pulls.py — the Mac lane: every stats.nba.com table Basketball Coaching Savant needs that
the cloud can't reach, pulled through the engine's own cache (savant_engine.call, cache/ under
~/Basketball-Savant), so a table is fetched once and reused by every build.

    cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/coaching/nba_pulls.py [first] [last]

Tables (first season each exists):
  LeagueGameLog (teams), regular season and playoffs       1996-97     records, schedule, rest, joins to ESPN
  PlayerIndex (historical)                                 one call    draft slot for the rookie prior, positions
  CommonTeamRoster -> Coaches                              1996-97*    the NBA's staff table (* depth confirmed on the run:
                                                                       the 1990s rows are junk; a season counts only
                                                                       when it names a head coach)
  LeagueDashPtStats (team) x 11 measure types              2013-14     passes, touches, drives, pull-up / C&S, speed
  LeagueHustleStatsTeam                                    2016-17     screen assists, deflections, charges, box outs
  SynergyPlayTypes (team), offense and defense             2015-16     points per possession by play type
  ZoneDefenseTeamLeaders                                   2025-26     zone share and results (confirm on first run)
  LeagueDashTeamStats Advanced / Four Factors / Opponent / Base  1996-97   (already cached by teams_engine; re-used)

Headers are verified on the first call of each family and written to out/bcs/nba_headers.json
so the build can refuse a renamed column instead of guessing.
"""
import datetime as dt
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import savant_engine as E  # noqa: E402
import savant_config as C  # noqa: E402

ST, PO = "Regular Season", "Playoffs"
OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
PT_TYPES = ["Passing", "Possessions", "Drives", "CatchShoot", "PullUpShot", "SpeedDistance",
            "Rebounding", "Efficiency", "ElbowTouch", "PostTouch", "PaintTouch"]
PLAY_TYPES = ["Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup",
              "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def current_season():
    t = dt.date.today()
    return season_label(t.year if t.month >= 10 else t.year - 1)


def seasons(first=1996, last=None):
    last = last or int(current_season()[:4])
    return [season_label(y) for y in range(last, first - 1, -1)]


def _teams():
    from nba_api.stats.static import teams as static_teams
    return sorted(t["id"] for t in static_teams.get_teams())


def game_logs(ss, log=print):
    from nba_api.stats.endpoints import leaguegamelog as L
    n = 0
    for s in ss:
        for st in (ST, PO):
            try:
                df = E.call(L.LeagueGameLog, dict(season=s, season_type_all_star=st, player_or_team_abbreviation="T"))
                n += 1
            except Exception as e:  # noqa
                log(f"  LeagueGameLog {s} {st}: {repr(e)[:80]}")
    log(f"game logs: {n} tables")


def player_index(log=print):
    from nba_api.stats.endpoints import playerindex as P
    df = E.call(P.PlayerIndex, dict(season=current_season(), historical_nullable=1), use_cache=False)
    log(f"PlayerIndex: {len(df)} players")


def rosters(ss, log=print):
    from nba_api.stats.endpoints import commonteamroster as R
    depth = {}
    for s in ss:
        named = 0
        for tid in _teams():
            try:
                df = E.call(R.CommonTeamRoster, dict(team_id=tid, season=s), frame=1)
            except Exception as e:  # noqa
                log(f"  CommonTeamRoster {s} {tid}: {repr(e)[:80]}")
                time.sleep(5)
                continue
            if len(df) and "COACH_TYPE" in df.columns and (df["COACH_TYPE"] == "Head Coach").any():
                named += 1
        depth[s] = named
        log(f"  staff {s}: {named} teams name a head coach")
    return depth


def tracking(ss, log=print):
    from nba_api.stats.endpoints import leaguedashptstats as T
    for s in ss:
        if int(s[:4]) < 2013:
            continue
        for m in PT_TYPES:
            try:
                E.call(T.LeagueDashPtStats, dict(season=s, season_type_all_star=ST, pt_measure_type=m,
                                                 per_mode_simple="Totals", player_or_team="Team"))
            except Exception as e:  # noqa
                log(f"  PtStats {s} {m}: {repr(e)[:80]}")
        log(f"  tracking {s} done")


def hustle(ss, log=print):
    from nba_api.stats.endpoints import leaguehustlestatsteam as H
    for s in ss:
        if int(s[:4]) < 2016:
            continue
        try:
            E.call(H.LeagueHustleStatsTeam, dict(season=s, season_type_all_star=ST, per_mode_time="Totals"))
        except Exception as e:  # noqa
            log(f"  Hustle {s}: {repr(e)[:80]}")
    log("hustle done")


def synergy(ss, log=print):
    from nba_api.stats.endpoints import synergyplaytypes as SP
    for s in ss:
        if int(s[:4]) < 2015:
            continue
        for grp in ("offensive", "defensive"):
            for pt in PLAY_TYPES:
                try:
                    E.call(SP.SynergyPlayTypes, dict(season=s, season_type_all_star=ST, player_or_team_abbreviation="T",
                                                     play_type_nullable=pt, type_grouping_nullable=grp, per_mode_simple="Totals"))
                except Exception as e:  # noqa
                    log(f"  Synergy {s} {grp} {pt}: {repr(e)[:60]}")
        log(f"  synergy {s} done")


def team_tables(ss, log=print):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    for s in ss:
        for m in ("Advanced", "Four Factors", "Opponent", "Base"):
            try:
                E.call(T.LeagueDashTeamStats, dict(season=s, season_type_all_star=ST,
                                                   measure_type_detailed_defense=m, per_mode_detailed="Totals"))
            except Exception as e:  # noqa
                log(f"  TeamStats {s} {m}: {repr(e)[:80]}")
    log("team tables done")


def zone(ss, log=print):
    import nba_extra_endpoints as X
    for s in ss:
        if int(s[:4]) < 2025:
            continue
        try:
            df = E.call(X.ZoneDefenseTeamLeaders, dict(season=s, season_type_all_star=ST))
            log(f"  zone {s}: {len(df)} rows, cols {list(df.columns)[:12]}")
        except Exception as e:  # noqa
            log(f"  zone {s}: {repr(e)[:100]}")


def headers(log=print):
    """One row of each family, so the build can hold itself to real column names."""
    from nba_api.stats.endpoints import leaguegamelog as L, leaguedashptstats as T, leaguehustlestatsteam as H, synergyplaytypes as SP, commonteamroster as R
    out = {}
    probes = [
        ("LeagueGameLog", lambda: E.call(L.LeagueGameLog, dict(season="2024-25", season_type_all_star=ST, player_or_team_abbreviation="T"))),
        ("CommonTeamRoster/Coaches", lambda: E.call(R.CommonTeamRoster, dict(team_id=1610612738, season="2024-25"), frame=1)),
        ("LeagueHustleStatsTeam", lambda: E.call(H.LeagueHustleStatsTeam, dict(season="2024-25", season_type_all_star=ST, per_mode_time="Totals"))),
        ("SynergyPlayTypes/T", lambda: E.call(SP.SynergyPlayTypes, dict(season="2024-25", season_type_all_star=ST, player_or_team_abbreviation="T",
                                                                        play_type_nullable="Isolation", type_grouping_nullable="defensive", per_mode_simple="Totals"))),
    ] + [(f"LeagueDashPtStats/{m}", (lambda m=m: E.call(T.LeagueDashPtStats, dict(season="2024-25", season_type_all_star=ST, pt_measure_type=m,
                                                                                 per_mode_simple="Totals", player_or_team="Team")))) for m in PT_TYPES]
    for name, fn in probes:
        try:
            out[name] = list(fn().columns)
        except Exception as e:  # noqa
            out[name] = f"ERROR {repr(e)[:80]}"
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "nba_headers.json"), "w"), indent=1)
    log(f"headers written for {len(out)} families")


PHASES = ["headers", "logs", "index", "teams", "tracking", "hustle", "synergy", "zone", "rosters"]

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    first = int(args[0][:4]) if args else 1996
    last = int(args[1][:4]) if len(args) > 1 else None
    phases = next((a[9:].split(",") for a in sys.argv[1:] if a.startswith("--phases=")), PHASES)
    ss = seasons(first, last)
    t0 = time.time()
    print(f"=== nba pulls {ss[-1]}..{ss[0]} phases={phases} ({dt.datetime.now():%Y-%m-%d %H:%M}) cache={os.path.abspath(C.CACHE_DIR)}", flush=True)
    C.RETRIES = 2                      # a table that fails twice is logged and left for the next run
    C.RATE_SLEEP = 1.2
    for ph in phases:
        if ph == "headers": headers()
        elif ph == "logs": game_logs(ss)
        elif ph == "index": player_index()
        elif ph == "teams": team_tables(ss)
        elif ph == "tracking": tracking(ss)
        elif ph == "hustle": hustle(ss)
        elif ph == "synergy": synergy(ss)
        elif ph == "zone": zone(ss)
        elif ph == "rosters":
            depth = rosters(ss)
            os.makedirs(OUT, exist_ok=True)
            old = json.load(open(os.path.join(OUT, "staff_depth.json"))) if os.path.exists(os.path.join(OUT, "staff_depth.json")) else {}
            old.update(depth)
            json.dump(old, open(os.path.join(OUT, "staff_depth.json"), "w"), indent=1)
        print(f"  phase {ph} done ({time.time() - t0:.0f}s)", flush=True)
    print(f"=== done ({time.time() - t0:.0f}s)")
