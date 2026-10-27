"""
ext_fetch.py — every stats.nba.com request behind the October 2026 "everything" additions.

One place for the requests, so the three runs that need them make byte-identical calls (and so
hit the same cache keys):
  * the Mac's history backfill (ext_backfill.py, 1996-97 to 2025-26),
  * the Mac's in-season tracking upload (export_tracking.py records every request whose
    endpoint is in espn_shim.UNAVAILABLE and uploads it), and
  * the cloud refresh, where espn_shim answers these from the Mac's upload, the public mirror,
    or (box-score families) from ESPN.

Every loader goes through savant_engine.call / call_frames, so it is disk-cached, retried, and
interceptable. Loaders never raise on "not tracked that season": they return an empty frame.

Which seasons each family exists for (confirmed live Oct 26 2026, see ext_probe):
  tracking measures, shot splits, defended shots     2013-14 on
  Synergy (offense and defense)                      2015-16 on
  hustle (screens, charges, loose balls, contests)   2016-17 on (2015-16 is a partial table)
  matchups, matchup rollup, defensive box scores     2017-18 on
  NBA AWS stats (gravity, shot quality, leverage,
                 handle score, zone defense)         2025-26 on
  measure types (Misc, Usage), clutch, starters,
  on/off four factors, shot charts                   1996-97 on
"""
import pandas as pd

import savant_config as C
import savant_engine as E
import nba_extra_endpoints as X

ST = C.SEASON_TYPE

TRACK_NEW = ["Possessions", "CatchShoot", "PullUpShot", "ElbowTouch", "PostTouch", "PaintTouch",
             "SpeedDistance", "Rebounding", "Defense"]
TRACK_OLD = ["Drives", "Passing"]          # already pulled by savant_engine; reused from cache
DEF_BANDS = {"vtight": "0-2 Feet - Very Tight", "tight": "2-4 Feet - Tight",
             "open": "4-6 Feet - Open", "wide": "6+ Feet - Wide Open"}
DRIBBLES = ["0 Dribbles", "1 Dribble", "2 Dribbles", "3-6 Dribbles", "7+ Dribbles"]
TOUCH = ["Touch < 2 Seconds", "Touch 2-6 Seconds", "Touch 6+ Seconds"]
CLOCK = ["24-22", "22-18 Very Early", "18-15 Early", "15-7 Average", "7-4 Late", "4-0 Very Late"]
DEF_CATS = ["Overall", "3 Pointers", "2 Pointers", "Less Than 10Ft", "Greater Than 15Ft"]
SYN_DEF = ["Isolation", "PRBallHandler", "PRRollman", "Postup", "Spotup", "Handoff", "OffScreen"]
SYN_OFF = ["Transition", "Isolation", "PRBallHandler", "PRRollman", "Postup", "Spotup",
           "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]
MEASURES = ["Misc", "Usage"]


def y(season):
    return int(season[:4])


def has(family, season):
    """Does the NBA publish `family` for `season`?"""
    first = {"track": 2013, "syn": 2015, "hustle": 2016, "match": 2017, "aws": 2025, "dunk": 2024,
             "pbp": 1996}[family]
    return y(season) >= first


def _empty():
    return pd.DataFrame()


MISSES = []          # requests that came back empty or failed (printed by the callers)


def _safe(fn, *a, **k):
    """Run a loader; a failure (not tracked, not reachable from the cloud, a timeout) is an
    empty frame, so it costs that one family and never the whole pass."""
    try:
        df = fn(*a, **k)
        return df if df is not None else _empty()
    except Exception as e:  # noqa
        MISSES.append(f"{getattr(fn, '__name__', fn)} {repr(e)[:80]}")
        return _empty()


# ---------------------------------------------------------------- windowed (LastNGames)
def track(measure, ln, season):
    if not has("track", season):
        return _empty()
    return _safe(E.load_track, measure, ln, season)


def ptshot(ln, season, **filt):
    if not has("track", season):
        return _empty()
    from nba_api.stats.endpoints import leaguedashplayerptshot as L
    params = dict(season=season, season_type_all_star=ST, **filt)
    if ln:
        params["last_n_games_nullable"] = ln

    def go():
        return E.call(L.LeagueDashPlayerPtShot, params).set_index("PLAYER_ID")
    return _safe(go)


def ptdefend(category, ln, season):
    if not has("track", season):
        return _empty()
    from nba_api.stats.endpoints import leaguedashptdefend as L
    params = dict(season=season, season_type_all_star=ST, defense_category=category)
    if ln:
        params["last_n_games_nullable"] = ln

    def go():
        return E.call(L.LeagueDashPtDefend, params).set_index("CLOSE_DEF_PERSON_ID")
    return _safe(go)


def measure(mt, ln, season):
    if not has("pbp", season):
        return _empty()
    from nba_api.stats.endpoints import leaguedashplayerstats as L

    def go():
        return E.call(L.LeagueDashPlayerStats, E._ln(dict(
            season=season, season_type_all_star=ST,
            measure_type_detailed_defense=mt, per_mode_detailed="Totals"), ln)).set_index("PLAYER_ID")
    return _safe(go)


# ---------------------------------------------------------------- season-only
def starters(season, which):
    if not has("pbp", season):
        return _empty()
    from nba_api.stats.endpoints import leaguedashplayerstats as L

    def go():
        return E.call(L.LeagueDashPlayerStats, dict(
            season=season, season_type_all_star=ST, measure_type_detailed_defense="Base",
            per_mode_detailed="Totals", starter_bench_nullable=which)).set_index("PLAYER_ID")
    return _safe(go)


def clutch(mt, season):
    if not has("pbp", season):
        return _empty()
    from nba_api.stats.endpoints import leaguedashplayerclutch as L

    def go():
        return E.call(L.LeagueDashPlayerClutch, dict(
            season=season, season_type_all_star=ST, measure_type_detailed_defense=mt,
            per_mode_detailed="Totals")).set_index("PLAYER_ID")
    return _safe(go)


def hustle(season):
    if not has("hustle", season):
        return _empty()
    return _safe(E.load_hustle, season)


def matchups(season):
    if not has("match", season):
        return _empty()
    return _safe(E.load_matchups, season)


def rollup(season):
    if not has("match", season):
        return _empty()
    from nba_api.stats.endpoints import matchupsrollup as L

    def go():
        return E.call(L.MatchupsRollup, dict(season=season, season_type_playoffs=ST,
                                             per_mode_simple="Totals"))
    return _safe(go)


def synergy(play_type, grouping, season):
    if not has("syn", season):
        return _empty()
    from nba_api.stats.endpoints import synergyplaytypes as L

    def go():
        return E.call(L.SynergyPlayTypes, dict(
            season=season, season_type_all_star=ST, per_mode_simple="Totals",
            player_or_team_abbreviation="P", play_type_nullable=play_type,
            type_grouping_nullable=grouping))
    return _safe(go)


def onoff_details(team_id, season, mt="Four Factors"):
    """(on, off) frames for one team: rows per player, COURT_STATUS On / Off."""
    if not has("pbp", season):
        return _empty(), _empty()
    from nba_api.stats.endpoints import teamplayeronoffdetails as L
    try:
        fr = E.call_frames(L.TeamPlayerOnOffDetails, dict(
            team_id=team_id, season=season, season_type_all_star=ST,
            measure_type_detailed_defense=mt, per_mode_detailed="Totals"), frames=(1, 2))
        return fr[1], fr[2]
    except Exception as e:  # noqa
        MISSES.append(f"on/off {team_id} {repr(e)[:60]}")
        return _empty(), _empty()


def onoff_summary(team_id, season):
    """Same request savant_engine.load_onoff makes (Advanced summary), so it is cached already."""
    if not has("pbp", season):
        return _empty(), _empty()
    from nba_api.stats.endpoints import teamplayeronoffsummary as L
    try:
        fr = E.call_frames(L.TeamPlayerOnOffSummary, dict(
            team_id=team_id, season=season, season_type_all_star=ST,
            measure_type_detailed_defense="Advanced", per_mode_detailed="Totals"), frames=(1, 2))
        return fr[1], fr[2]
    except Exception as e:  # noqa
        MISSES.append(f"on/off {team_id} {repr(e)[:60]}")
        return _empty(), _empty()


def aws(cls, season):
    first = "dunk" if cls is X.DunkScoreLeadersRaw else "aws"
    if not has(first, season):
        return _empty()

    def go():
        return E.call(cls, dict(season=season, season_type_all_star=ST))
    return _safe(go)


def combine(draft_season):
    from nba_api.stats.endpoints import draftcombinestats as S

    def go():
        return E.call(S.DraftCombineStats, dict(season_all_time=draft_season, league_id="00"))
    return _safe(go)


def game_logs(season):
    """The same league-wide request extras_engine.load_game_logs makes (cached already)."""
    if not has("pbp", season):
        return _empty()
    from nba_api.stats.endpoints import playergamelogs as G

    def go():
        return E.call(G.PlayerGameLogs, dict(season_nullable=season, season_type_nullable=ST))
    return _safe(go)


def game_ids(season):
    from nba_api.stats.endpoints import leaguegamelog as L

    def go():
        return E.call(L.LeagueGameLog, dict(season=season, season_type_all_star=ST,
                                            player_or_team_abbreviation="T"))
    df = _safe(go)
    if not len(df):
        return []
    return sorted({str(g).zfill(10) for g in df["GAME_ID"]})


# The cloud can't list the NBA's game ids (its game log is rebuilt from ESPN, with ESPN's ids),
# so cloud_refresh points this at the game ids in the Mac's upload instead.
DEFBOX_GAME_IDS = None


def defbox_game_ids(season):
    if DEFBOX_GAME_IDS is not None:
        return list(DEFBOX_GAME_IDS(season))
    return game_ids(season)


def defbox(game_id):
    from nba_api.stats.endpoints import boxscoredefensivev2 as L

    def go():
        return E.call(L.BoxScoreDefensiveV2, dict(game_id=game_id))
    return _safe(go)


def pass_network(pid, season):
    if not has("track", season):
        return _empty(), _empty()
    from nba_api.stats.endpoints import playerdashptpass as L
    try:
        fr = E.call_frames(L.PlayerDashPtPass, dict(
            team_id=0, player_id=int(pid), season=season, season_type_all_star=ST,
            per_mode_simple="Totals"), frames=(0, 1))
        return fr[0], fr[1]
    except Exception as e:  # noqa
        MISSES.append(f"PlayerDashPtPass {pid} {repr(e)[:60]}")
        return _empty(), _empty()


def shots_team(team_id, season):
    """ShotChartDetail for one team-season: the same request xfg_model makes (2013-14 on) and
    savant_shots' per-team variant, so the shot cache is shared."""
    from nba_api.stats.endpoints import shotchartdetail as L

    def go():
        return E.call(L.ShotChartDetail, dict(
            team_id=team_id, player_id=0, season_nullable=season, season_type_all_star=ST,
            context_measure_simple="FGA"))
    return _safe(go)


# ---------------------------------------------------------------- the whole set
def team_ids():
    from nba_api.stats.static import teams as static_teams
    return sorted(t["id"] for t in static_teams.get_teams())


def network_players(season):
    """Who gets a passing network: 300+ minutes (or, in the season in progress, 15+ MPG over
    3+ games). Keeps the per-player calls bounded."""
    try:
        box = E.load_box(None, season)
    except Exception as e:  # noqa
        MISSES.append(f"network players {repr(e)[:60]}")
        return []
    out = []
    for pid, r in box.iterrows():
        gp = float(r.get("gp", 0) or 0)
        mins = float(r.get("min", 0) or 0)
        if mins >= 300 or (gp >= 3 and gp and mins / gp >= 15):
            out.append(int(pid))
    return sorted(out)


def fetch_season(season, phases=("league", "teams", "players", "games"), log=print, windows=None):
    """Make every request for one season (the history backfill). Returns call counts.
    `windows`: which of C.WINDOWS to pull the windowed tables for (default all; a finished
    season's history needs only the full season, None)."""
    n = {"ok": 0, "empty": 0}
    wins = {w: ln for w, ln in C.WINDOWS.items() if windows is None or w in windows}

    def note(df):
        if isinstance(df, tuple):
            df = df[0]
        n["ok" if len(df) else "empty"] += 1

    if "league" in phases:
        for win, ln in wins.items():
            for m in TRACK_NEW + TRACK_OLD:
                note(track(m, ln, season))
            for band in DEF_BANDS.values():
                note(ptshot(ln, season, close_def_dist_range_nullable=band))
            for cat in DEF_CATS:
                note(ptdefend(cat, ln, season))
            for mt in MEASURES:
                note(measure(mt, ln, season))
        for d in DRIBBLES:
            note(ptshot(None, season, dribble_range_nullable=d))
        for t in TOUCH:
            note(ptshot(None, season, touch_time_range_nullable=t))
        for c in CLOCK:
            note(ptshot(None, season, shot_clock_range_nullable=c))
        for which in ("Starters", "Bench"):
            note(starters(season, which))
        for mt in ("Base", "Advanced"):
            note(clutch(mt, season))
        note(game_logs(season))
        note(hustle(season))
        note(matchups(season))
        note(rollup(season))
        for pt in SYN_DEF:
            note(synergy(pt, "defensive", season))
        for cls in X.ALL:
            note(aws(cls, season))
        log(f"  {season} league tables: {n}")
    if "teams" in phases:
        for tid in team_ids():
            note(onoff_details(tid, season))
            note(onoff_summary(tid, season))
        log(f"  {season} team tables: {n}")
    if "extra" in phases:
        # tables the October 2026 card stats already pulled (offense play types, scoring splits),
        # re-requested so the history export carries them, plus every combine class
        for pt in SYN_OFF:
            note(synergy(pt, "offensive", season))
        for win, ln in wins.items():
            note(measure("Scoring", ln, season))
        for yr in range(2000, y(season) + 1):
            note(combine(f"{yr}-{str(yr + 1)[2:]}"))
        log(f"  {season} extra tables: {n}")
    if "players" in phases and has("track", season):
        for pid in network_players(season):
            note(pass_network(pid, season))
        log(f"  {season} passing networks: {n}")
    if "games" in phases and has("match", season):
        for gid in defbox_game_ids(season):
            note(defbox(gid))
        log(f"  {season} defensive box scores: {n}")
    return n
