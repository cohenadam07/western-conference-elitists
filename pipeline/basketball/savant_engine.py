"""
Basketball Savant — data engine.

Usage:
  python savant_engine.py discover     # task zero: dump endpoint headers to verify FIELD_MAP
  python savant_engine.py build        # pull live data -> out/players.json (+ out/metrics_config.json)

Live pulls require a non-blocked network (run on your machine / Claude Code on your
network, NOT a cloud sandbox — stats.nba.com blocks most datacenter IPs).

The output contract (out/players.json) is intentionally percentile-free: it ships
per-player RAW values + sample sizes per window, and the front-end ranks them. That
lets the page compute league / position / arbitrary-minutes-band percentiles live
without the engine precomputing every possible band.
"""
import os, sys, json, time, random, hashlib, datetime as dt
import pandas as pd
import savant_config as C

# --------------------------------------------------------------------------
# client: cache + retry + politeness
# --------------------------------------------------------------------------
def _key(name, params, frame):
    raw = name + json.dumps(params, sort_keys=True) + f"#f{frame}"
    return hashlib.md5(raw.encode()).hexdigest()

# The season in progress, set by refresh_current.py. The disk cache is keyed on the request
# alone, so for a season that is still being played a cached answer is yesterday's answer.
# Any call whose season parameter names FRESH_SEASON skips the cache read (it still writes,
# so a failed run can be inspected). Finished seasons keep the cache, which is what makes a
# full rebuild cheap.
FRESH_SEASON = None
# Unattended runs can't afford one slow table killing the night. For a fresh-season call,
# retries are more patient, and if they all fail the last good copy on disk is used instead
# and the call is recorded here; refresh_current.py prints the list. A table that has never
# been fetched still fails loudly.
FRESH_RETRIES = 6
STALE_USED = []

def _fresh(params):
    return FRESH_SEASON is not None and any(
        "season" in k and v == FRESH_SEASON for k, v in params.items())

def _backoff(attempt, fresh):
    # 1.5s, 3s, 4.5s... for a full rebuild; 5s, 10s, 20s, 40s, 60s for the nightly refresh
    return min(60, 5 * 2 ** attempt) if fresh else 1.5 * (attempt + 1)

def call(EndpointClass, params, frame=0, use_cache=True):
    """Build an nba_api endpoint, return one result frame as a DataFrame, with disk cache + retry."""
    os.makedirs(C.CACHE_DIR, exist_ok=True)
    cpath = os.path.join(C.CACHE_DIR, _key(EndpointClass.__name__, params, frame) + ".json")
    fresh = _fresh(params)
    if use_cache and not fresh and os.path.exists(cpath):
        return pd.read_json(cpath)
    last = None
    tries = FRESH_RETRIES if fresh else C.RETRIES
    for attempt in range(tries):
        try:
            ep = EndpointClass(timeout=C.TIMEOUT, **params)
            df = ep.get_data_frames()[frame]
            df.to_json(cpath)
            time.sleep(C.RATE_SLEEP + random.uniform(0, 0.4))
            return df
        except Exception as e:  # noqa
            last = e
            time.sleep(_backoff(attempt, fresh))
    if fresh and os.path.exists(cpath):
        STALE_USED.append(f"{EndpointClass.__name__} {json.dumps(params, sort_keys=True)}")
        print(f"  [stale] {EndpointClass.__name__} kept its last good copy ({repr(last)[:60]})")
        return pd.read_json(cpath)
    raise RuntimeError(f"{EndpointClass.__name__} failed after {tries} tries: {last}")

def call_frames(EndpointClass, params, frames, use_cache=True):
    """Like call(), but pulls several result frames from a single endpoint hit (one HTTP call,
    not one per frame) — used where a response bundles multiple tables we both need (e.g. on/off
    court splits). Returns {frame_index: DataFrame}, cached per-frame under the same key scheme."""
    os.makedirs(C.CACHE_DIR, exist_ok=True)
    paths = {fr: os.path.join(C.CACHE_DIR, _key(EndpointClass.__name__, params, fr) + ".json") for fr in frames}
    fresh = _fresh(params)
    if use_cache and not fresh and all(os.path.exists(p) for p in paths.values()):
        return {fr: pd.read_json(p) for fr, p in paths.items()}
    last = None
    for attempt in range(FRESH_RETRIES if fresh else C.RETRIES):
        try:
            ep = EndpointClass(timeout=C.TIMEOUT, **params)
            dfs = ep.get_data_frames()
            result = {}
            for fr in frames:
                df = dfs[fr]
                df.to_json(paths[fr])
                result[fr] = df
            time.sleep(C.RATE_SLEEP + random.uniform(0, 0.4))
            return result
        except Exception as e:  # noqa
            last = e
            time.sleep(_backoff(attempt, fresh))
    if fresh and all(os.path.exists(p) for p in paths.values()):
        STALE_USED.append(f"{EndpointClass.__name__} {json.dumps(params, sort_keys=True)}")
        print(f"  [stale] {EndpointClass.__name__} kept its last good copy ({repr(last)[:60]})")
        return {fr: pd.read_json(p) for fr, p in paths.items()}
    raise RuntimeError(f"{EndpointClass.__name__} failed after {C.RETRIES} tries: {last}")

# --------------------------------------------------------------------------
# task zero — verify the field map against live headers
# --------------------------------------------------------------------------
def discover():
    from nba_api.stats.endpoints import (
        leaguedashplayerstats, leaguedashptstats, leaguedashplayerptshot,
        leaguedashptdefend, leaguehustlestatsplayer, leaguedashplayerbiostats,
        gravityleaders, synergyplaytypes, leagueseasonmatchups, playerindex,
        draftcombineplayeranthro, draftcombinestats,
    )
    sample_yr = f"{int(C.SEASON[:4]) - 1}-{str(int(C.SEASON[:4]))[2:]}"
    probes = [
        ("LeagueDashPlayerStats/Base", leaguedashplayerstats.LeagueDashPlayerStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              measure_type_detailed_defense="Base", per_mode_detailed="Totals")),
        ("LeagueDashPlayerStats/Advanced", leaguedashplayerstats.LeagueDashPlayerStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              measure_type_detailed_defense="Advanced", per_mode_detailed="Totals")),
        ("LeagueDashTeamStats/Opponent", __import__("nba_api.stats.endpoints.leaguedashteamstats", fromlist=["LeagueDashTeamStats"]).LeagueDashTeamStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              measure_type_detailed_defense="Opponent", per_mode_detailed="Totals")),
        ("LeagueDashPtStats/Drives", leaguedashptstats.LeagueDashPtStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              pt_measure_type="Drives", per_mode_simple="Totals", player_or_team="Player")),
        ("LeagueDashPtStats/Passing", leaguedashptstats.LeagueDashPtStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              pt_measure_type="Passing", per_mode_simple="Totals", player_or_team="Player")),
        ("LeagueDashPlayerPtShot", leaguedashplayerptshot.LeagueDashPlayerPtShot,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE,
              close_def_dist_range_nullable="0-2 Feet - Very Tight")),
        ("LeagueDashPtDefend", leaguedashptdefend.LeagueDashPtDefend,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE, defense_category="Less Than 6Ft")),
        ("LeagueHustleStatsPlayer", leaguehustlestatsplayer.LeagueHustleStatsPlayer,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE, per_mode_time="Totals")),
        ("LeagueDashPlayerBioStats", leaguedashplayerbiostats.LeagueDashPlayerBioStats,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE)),
        ("GravityLeaders", gravityleaders.GravityLeaders,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE)),
        ("SynergyPlayTypes/Isolation", synergyplaytypes.SynergyPlayTypes,
         dict(season=C.SEASON, season_type_all_star=C.SEASON_TYPE, per_mode_simple="Totals",
              player_or_team_abbreviation="P", play_type_nullable="Isolation",
              type_grouping_nullable="offensive")),
        ("LeagueSeasonMatchups", leagueseasonmatchups.LeagueSeasonMatchups,
         dict(season=C.SEASON, season_type_playoffs=C.SEASON_TYPE, per_mode_simple="Totals")),
        ("PlayerIndex", playerindex.PlayerIndex,
         dict(season=C.SEASON, league_id="00")),
        ("DraftCombinePlayerAnthro", draftcombineplayeranthro.DraftCombinePlayerAnthro,
         dict(season_year=sample_yr, league_id="00")),
        ("DraftCombineStats", draftcombinestats.DraftCombineStats,
         dict(season_all_time=sample_yr, league_id="00")),
    ]
    for label, cls, params in probes:
        try:
            df = call(cls, params, use_cache=False)
            print(f"\n=== {label} ===")
            print(list(df.columns))
        except Exception as e:
            print(f"\n=== {label} === FAILED: {e}")
    print("\nReconcile these against FIELD_MAP in savant_config.py, then run build.")

# --------------------------------------------------------------------------
# loaders — each returns {player_id: value} (and a parallel {player_id: n} where useful)
# `ln` is the LastNGames value for the window (None for season).
# --------------------------------------------------------------------------
def _ln(params, ln):
    if ln:
        params = dict(params); params["last_n_games"] = ln
    return params

def load_box(ln, season):
    from nba_api.stats.endpoints import leaguedashplayerstats as L
    f = C.FIELD_MAP["box"]
    df = call(L.LeagueDashPlayerStats, _ln(dict(
        season=season, season_type_all_star=C.SEASON_TYPE,
        measure_type_detailed_defense="Base", per_mode_detailed="Totals"), ln))
    df = df.set_index(f["id"])
    return df.rename(columns={v: k for k, v in f.items() if v in df.columns})

def load_adv(ln, season):
    from nba_api.stats.endpoints import leaguedashplayerstats as L
    f = C.FIELD_MAP["adv"]
    df = call(L.LeagueDashPlayerStats, _ln(dict(
        season=season, season_type_all_star=C.SEASON_TYPE,
        measure_type_detailed_defense="Advanced", per_mode_detailed="Totals"), ln))
    df = df.set_index(f["id"])
    return df.rename(columns={v: k for k, v in f.items() if v in df.columns})

def load_track(measure, ln, season):
    from nba_api.stats.endpoints import leaguedashptstats as L
    df = call(L.LeagueDashPtStats, _ln(dict(
        season=season, season_type_all_star=C.SEASON_TYPE,
        pt_measure_type=measure, per_mode_simple="Totals", player_or_team="Player"), ln))
    return df.set_index("PLAYER_ID")

def load_ptshot(ln, range_key, season):
    """One call per closest-defender-distance bucket (`range_key` picks the FIELD_MAP filter value)."""
    from nba_api.stats.endpoints import leaguedashplayerptshot as L
    f = C.FIELD_MAP["ptshot"]
    params = dict(season=season, season_type_all_star=C.SEASON_TYPE,
                  close_def_dist_range_nullable=f[range_key])
    if ln:
        params = dict(params); params["last_n_games_nullable"] = ln
    df = call(L.LeagueDashPlayerPtShot, params)
    return df.set_index(f["id"])

def load_ptdefend(ln, season):
    from nba_api.stats.endpoints import leaguedashptdefend as L
    f = C.FIELD_MAP["ptdefend"]
    params = dict(season=season, season_type_all_star=C.SEASON_TYPE, defense_category="Less Than 6Ft")
    if ln:
        params = dict(params); params["last_n_games_nullable"] = ln
    df = call(L.LeagueDashPtDefend, params)
    df = df.set_index(f["id"])
    return df

def load_hustle(season):
    """LeagueHustleStatsPlayer has no LastNGames support in nba_api — season totals only."""
    from nba_api.stats.endpoints import leaguehustlestatsplayer as L
    df = call(L.LeagueHustleStatsPlayer, dict(
        season=season, season_type_all_star=C.SEASON_TYPE, per_mode_time="Totals"))
    return df.set_index("PLAYER_ID")

def load_bio(season):
    from nba_api.stats.endpoints import leaguedashplayerbiostats as L
    df = call(L.LeagueDashPlayerBioStats, dict(season=season, season_type_all_star=C.SEASON_TYPE))
    return df.set_index("PLAYER_ID")

def load_player_info(pid):
    """CommonPlayerInfo — one call per player; disk-cached via call() so re-runs (and later
    seasons in the same build) never re-hit the network for a player already fetched."""
    from nba_api.stats.endpoints import commonplayerinfo as L
    df = call(L.CommonPlayerInfo, dict(player_id=int(pid)))
    return df

def _season_ref_date(season):
    """Age reference date: Feb 1 of the season's second calendar year (e.g. 2025-26 -> 2026-02-01)."""
    return dt.date(int(season[:4]) + 1, 2, 1)

def _age_from_birthdate(birthdate_raw, ref_date):
    y, m, d = (int(x) for x in str(birthdate_raw).split("T")[0].split("-"))
    return round((ref_date - dt.date(y, m, d)).days / 365.25, 2)

def load_index(season):
    """PlayerIndex's default (historical_nullable unset) silently returns only a small
    subset of players for past seasons. historical_nullable='1' + STATS_TIMEFRAME=='Season'
    is the combination that returns the full season roster for any season, current or past."""
    from nba_api.stats.endpoints import playerindex as L
    df = call(L.PlayerIndex, dict(season=season, league_id="00", historical_nullable="1"))
    if "STATS_TIMEFRAME" in df.columns:
        df = df[df["STATS_TIMEFRAME"] == "Season"]
    return df

# gravity / synergy / matchups / combine are season-only; no LastNGames support on these endpoints.
def load_gravity(season):
    from nba_api.stats.endpoints import gravityleaders as L  # nba_api>=1.11.4
    f = C.FIELD_MAP["gravity"]
    df = call(L.GravityLeaders, dict(season=season, season_type_all_star=C.SEASON_TYPE))
    return df.set_index(f["id"])

SYNERGY_OFFENSIVE_PLAY_TYPES = [
    "Transition", "Isolation", "PRBallHandler", "PRRollman", "Postup", "Spotup",
    "Handoff", "Cut", "OffScreen", "OffRebound", "Misc",
]

def load_synergy(season):
    """Possession-weighted PPP percentile across all offensive play types -> {pid: (v, n)}."""
    from nba_api.stats.endpoints import synergyplaytypes as L
    f = C.FIELD_MAP["synergy"]
    agg = {}  # pid -> [sum(poss*pct), sum(poss)]
    for play_type in SYNERGY_OFFENSIVE_PLAY_TYPES:
        df = call(L.SynergyPlayTypes, dict(
            season=season, season_type_all_star=C.SEASON_TYPE, per_mode_simple="Totals",
            player_or_team_abbreviation="P", play_type_nullable=play_type,
            type_grouping_nullable="offensive"))
        for _, r in df.iterrows():
            poss = float(r.get(f["poss"], 0) or 0)
            if poss <= 0:
                continue
            pid = int(r[f["id"]])
            pct = float(r.get(f["pct"], 0) or 0)
            a = agg.setdefault(pid, [0.0, 0.0])
            a[0] += poss * pct
            a[1] += poss
    return {pid: (round(100 * wsum / wposs), round(wposs)) for pid, (wsum, wposs) in agg.items() if wposs > 0}

def load_matchups(season):
    from nba_api.stats.endpoints import leagueseasonmatchups as L
    df = call(L.LeagueSeasonMatchups, dict(
        season=season, season_type_playoffs=C.SEASON_TYPE, per_mode_simple="Totals"))
    return df

def load_onoff(season):
    """TeamPlayerOnOffSummary (Advanced), one call per team -> {pid: (onoff_net, on_court_min)}.
    onoff = team NET_RATING with the player ON court minus NET_RATING with the player OFF court.
    Season-only (no LastNGames support); per-team failures are swallowed so one bad team/season
    never blocks the other 29 — that team's players just stay unset (-> null) for this metric.
    Players traded mid-season show up under >1 team; those are combined into a single value via
    an on-court-minutes-weighted average (same pattern as the Synergy PPP-percentile aggregation)
    rather than letting the later team silently clobber the earlier one."""
    from nba_api.stats.endpoints import teamplayeronoffsummary as L
    from nba_api.stats.static import teams as static_teams
    f = C.FIELD_MAP["onoff"]
    agg = {}  # pid -> [sum(diff*on_min), sum(on_min)]
    for team in static_teams.get_teams():
        try:
            frames = call_frames(L.TeamPlayerOnOffSummary, dict(
                team_id=team["id"], season=season, season_type_all_star=C.SEASON_TYPE,
                measure_type_detailed_defense="Advanced", per_mode_detailed="Totals"), frames=(1, 2))
            on_df, off_df = frames[1].set_index(f["id"]), frames[2].set_index(f["id"])
        except Exception:
            continue  # this team's players stay unset -> null in universe
        for pid in on_df.index:
            if pid not in off_df.index:
                continue
            on_net = float(on_df.loc[pid, f["net"]] or 0)
            off_net = float(off_df.loc[pid, f["net"]] or 0)
            mins = float(on_df.loc[pid, f["min"]] or 0)
            if mins <= 0:
                continue
            a = agg.setdefault(int(pid), [0.0, 0.0])
            a[0] += (on_net - off_net) * mins
            a[1] += mins
    return {pid: (round(wsum / wmin, 1), round(wmin)) for pid, (wsum, wmin) in agg.items() if wmin > 0}

# --------------------------------------------------------------------------
# derivations from the box/advanced frames
# --------------------------------------------------------------------------
def derive_box(box, adv):
    """Return {metric_key: {pid: (value, n)}} for box/adv-derived metrics.
    All formulas are era-agnostic: BR pre-1996 seasons run through this same function
    (via br_normalize), so a 1985 value and a 2025 value are computed identically. The
    only era-dependent input is POSS (tracked 1996+, estimated Pace*MP/48 pre-1996)."""
    out = {k: {} for k in ["mpg","ts","efg","pps","tp3","tp3a","tp3r","tp2","ft","fta","ftr","p3pt",
                           "pts","ast","ast75","asttov","tov","tov75","usg","oreb","dreb","reb75",
                           "stl","blk","stk75","gmsc"]}
    poss = adv["poss"] if "poss" in adv else None
    for pid, r in box.iterrows():
        gp = r.get("gp", 0) or 0
        if gp <= 0: continue
        fga, fta, fgm, f3m, f3a, ftm = (r.get(x,0) or 0 for x in ["fga","fta","fgm","fg3m","fg3a","ftm"])
        pts, tov, stl, blk, ast, reb = (r.get(x,0) or 0 for x in ["pts","tov","stl","blk","ast","reb"])
        orb, drb, pf = (r.get(x,0) or 0 for x in ["oreb","dreb","pf"])
        tsa = fga + 0.44 * fta
        p = float(poss.get(pid, 0)) if poss is not None else 0
        out["mpg"][pid] = (round((r.get("min",0) or 0)/gp, 1), None)
        if tsa > 0: out["ts"][pid] = (round(pts/(2*tsa), 3), round(tsa))
        if fga > 0:
            out["efg"][pid]  = (round((fgm+0.5*f3m)/fga, 3), round(fga))
            out["pps"][pid]  = (round(pts/fga, 2), round(fga))
            out["tp3r"][pid] = (round(100*f3a/fga, 1), round(fga))
            out["ftr"][pid]  = (round(100*fta/fga, 1), round(fga))
        if f3a > 0: out["tp3"][pid] = (round(100*f3m/f3a, 1), round(f3a))
        out["tp3a"][pid] = (round(f3a/gp, 1), round(f3a))
        if pts > 0: out["p3pt"][pid] = (round(100*3*f3m/pts, 1), round(pts))
        if (fga-f3a) > 0: out["tp2"][pid] = (round(100*(fgm-f3m)/(fga-f3a), 1), round(fga-f3a))
        if fta > 0: out["ft"][pid] = (round(100*ftm/fta, 1), round(fta))
        out["fta"][pid] = (round(fta/gp, 1), round(p))
        if tov > 0: out["asttov"][pid] = (round(ast/tov, 2), round(ast+tov))
        if (tsa + tov) > 0: out["tov"][pid] = (round(100*tov/(fga+0.44*fta+tov), 1), round(p))
        # Game Score (Hollinger) per game — needs the ORB/DRB split + PF
        gsc = (pts + 0.4*fgm - 0.7*fga - 0.4*(fta-ftm) + 0.7*orb + 0.3*drb
               + stl + 0.7*ast + 0.7*blk - 0.4*pf - tov)
        out["gmsc"][pid] = (round(gsc/gp, 1), round(gp))
        if p > 0:
            out["pts"][pid]   = (round(pts/p*75, 1), round(p))
            out["ast75"][pid] = (round(ast/p*75, 1), round(p))
            out["tov75"][pid] = (round(tov/p*75, 1), round(p))
            out["reb75"][pid] = (round(reb/p*75, 1), round(p))
            out["stl"][pid]   = (round(stl/p*75, 2), round(p))
            out["blk"][pid]   = (round(blk/p*75, 2), round(p))
            out["stk75"][pid] = (round((stl+blk)/p*75, 2), round(p))
    for pid, r in adv.iterrows():
        p = float(r.get("poss", 0) or 0)
        if "ast_pct" in adv:  out["ast"][pid]  = (round(100*(r.get("ast_pct",0) or 0), 1), round(p))
        if "usg_pct" in adv:  out["usg"][pid]  = (round(100*(r.get("usg_pct",0) or 0), 1), round(p))
        if "oreb_pct" in adv: out["oreb"][pid] = (round(100*(r.get("oreb_pct",0) or 0), 1), round(p))
        if "dreb_pct" in adv: out["dreb"][pid] = (round(100*(r.get("dreb_pct",0) or 0), 1), round(p))
    return out

# --------------------------------------------------------------------------
# statistical comps — precomputed nearest-neighbor player similarity (current season)
# --------------------------------------------------------------------------
# Nine profile dimensions, all ranked to percentiles within the comp pool. Six reuse the
# canonical box/adv derivations; 3PAr / FTr are true attempt rates from the box; blkpct is
# true block % (needs opponent shot volume). Distance is on percentiles, so whether a stat
# is "good high" or "good low" is irrelevant — |pa-pb| is identical either way.
COMP_DIMS = ["usg", "ts", "tp3", "3par", "ftr", "ast", "tov", "oreb", "dreb", "blkpct"]
COMP_TP3_MIN_ATT = 55         # min 3PA to characterize a player's 3P% (else that dim is None)
COMP_MIN_MINUTES = 500        # comp pool: players with >= this many total minutes
COMP_MIN_DIMS = 6             # need at least this many shared dims to form a pair
COMP_RARE_FRAC = 0.01         # nearest-distance quantile that maps to a 95% match (95 = rare)

def load_team_opponent(season):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    f = C.FIELD_MAP["team_opp"]
    df = call(T.LeagueDashTeamStats, dict(
        season=season, season_type_all_star=C.SEASON_TYPE,
        measure_type_detailed_defense="Opponent", per_mode_detailed="Totals"))
    return df.set_index(f["id"])

def _pct_rank(pairs):
    """Midrank percentile (0-100) for [(pid, value)], matching the page's pctOf; None dropped."""
    import bisect
    present = [(pid, v) for pid, v in pairs if v is not None]
    xs = sorted(v for _, v in present)
    n = len(xs)
    out = {}
    for pid, v in present:
        less = bisect.bisect_left(xs, v)
        eq = bisect.bisect_right(xs, v) - less
        out[pid] = 100.0 * (less + 0.5 * eq) / n if n else 50.0
    return out

def comp_vectors(season, universe, box, adv):
    """The 9-D percentile vectors behind comps: {pid: {dim: pct|None}} for every player
    with >= COMP_MIN_MINUTES, percentile-ranked within that pool. Shared by compute_comps
    and the Comp Chain game-graph generator so the similarity math never drifts."""
    from nba_api.stats.static import teams as static_teams
    ft = C.FIELD_MAP["team_opp"]
    topp = load_team_opponent(season)
    id_by_abbr = {t["abbreviation"]: t["id"] for t in static_teams.get_teams()}
    team_env, league_min, league_2pa = {}, 0.0, 0.0
    for tid, r in topp.iterrows():
        tm = float(r.get(ft["min"], 0) or 0)
        o2 = float(r.get(ft["opp_fga"], 0) or 0) - float(r.get(ft["opp_fg3a"], 0) or 0)
        team_env[int(tid)] = (tm, o2); league_min += tm; league_2pa += o2

    advcols = set(adv.columns)
    def _adv(pid, col):
        if pid not in adv.index or col not in advcols: return None
        v = adv.loc[pid, col]
        return float(v) if v == v else None  # drop NaN

    raw = {}
    for pid, br in box.iterrows():
        if pid not in universe: continue
        mp = float(br.get("min", 0) or 0)
        if mp < COMP_MIN_MINUTES: continue
        fga = float(br.get("fga", 0) or 0); fg3a = float(br.get("fg3a", 0) or 0)
        fg3m = float(br.get("fg3m", 0) or 0)
        fta = float(br.get("fta", 0) or 0); pts = float(br.get("pts", 0) or 0)
        tov = float(br.get("tov", 0) or 0); blk = float(br.get("blk", 0) or 0)
        usg, ast = _adv(pid, "usg_pct"), _adv(pid, "ast_pct")
        oreb, dreb = _adv(pid, "oreb_pct"), _adv(pid, "dreb_pct")
        tsa = fga + 0.44 * fta
        tid = id_by_abbr.get(universe[pid]["team"])
        tm, o2 = team_env.get(tid, (league_min, league_2pa))  # traded/unknown -> league average env
        raw[pid] = {
            "usg":  100 * usg if usg is not None else None,
            "ts":   (pts / (2 * tsa)) if tsa > 0 else None,
            "tp3":  (100 * fg3m / fg3a) if fg3a >= COMP_TP3_MIN_ATT else None,  # 3P% only where enough attempts
            "3par": (100 * fg3a / fga) if fga > 0 else None,
            "ftr":  (100 * fta / fga) if fga > 0 else None,
            "ast":  100 * ast if ast is not None else None,
            "tov":  (100 * tov / (fga + 0.44 * fta + tov)) if (fga + 0.44 * fta + tov) > 0 else None,
            "oreb": 100 * oreb if oreb is not None else None,
            "dreb": 100 * dreb if dreb is not None else None,
            "blkpct": (100 * blk * tm / (mp * o2)) if (mp > 0 and o2 > 0) else None,
        }
    pct = {dim: _pct_rank([(pid, raw[pid][dim]) for pid in raw]) for dim in COMP_DIMS}
    return {pid: {dim: pct[dim].get(pid) for dim in COMP_DIMS} for pid in raw}

def comp_dist(vec, a, b):
    """Missing-dim-normalized Euclidean distance in percentile space (None if < COMP_MIN_DIMS shared)."""
    import math
    s = k = 0
    for dim in COMP_DIMS:
        va, vb = vec[a][dim], vec[b][dim]
        if va is None or vb is None: continue
        s += (va - vb) ** 2; k += 1
    return math.sqrt(len(COMP_DIMS) / k * s) if k >= COMP_MIN_DIMS else None

def compute_comps(season, universe, box, adv):
    """Attach `comps` (top-3 statistical neighbors + match score) to each current-season
    player with >= COMP_MIN_MINUTES. Percentiles ranked within that same pool."""
    import math
    try:
        vec = comp_vectors(season, universe, box, adv)
    except Exception:
        print("  comps: skipped (team opponent stats unavailable)"); return
    if len(vec) < 4:
        print(f"  comps: pool too small ({len(vec)}), skipped"); return
    pids = list(vec.keys())

    def dist(a, b):
        return comp_dist(vec, a, b)

    nearest = {}
    for a in pids:
        ds = [(dd, b) for b in pids if b != a for dd in (dist(a, b),) if dd is not None]
        ds.sort(key=lambda x: x[0])
        nearest[a] = ds[:3]

    # Calibrate distance -> match% on the distribution of players' best-match distances, so
    # scores spread across the league and 95% is genuinely rare. Two anchors, linear between:
    #   d at the COMP_RARE_FRAC quantile (tightest few %) -> 95;  the median best-match -> 78.
    best = sorted(ds[0][0] for ds in nearest.values() if ds)
    if not best:
        print("  comps: no pairs formed, skipped"); return
    q = lambda f: best[min(len(best) - 1, max(0, int(f * len(best))))]
    d95, d_mid = q(COMP_RARE_FRAC), q(0.50)
    if d_mid <= d95: d_mid = d95 + 1.0
    slope = (95.0 - 80.0) / (d_mid - d95)                    # points lost per unit distance
    score = lambda dd: max(1, min(99, round(95.0 - (dd - d95) * slope)))

    for a in pids:
        universe[a]["comps"] = [
            {"id": b, "name": universe[b]["name"], "team": universe[b]["team"], "score": score(dd)}
            for dd, b in nearest[a]
        ]
    hi = lambda thr: sum(1 for a in pids if nearest[a] and score(nearest[a][0][0]) >= thr)
    print(f"  comps: pool={len(pids)} d95={d95:.1f} dmid={d_mid:.1f} best-match "
          f">=95:{hi(95)} >=90:{hi(90)} >=85:{hi(85)} >=80:{hi(80)} median~{score(d_mid)}")

# --------------------------------------------------------------------------
# inferred defensive role — for eligible current-season BIGS only
# --------------------------------------------------------------------------
# Three raw signals (percentiled within the big cohort by the front-end):
#   perim   = PARTIAL_POSS guarding site-Guards / total PARTIAL_POSS   (LeagueSeasonMatchups + site pos)
#   contest = FGA_LT_06 / D_FGA(Overall)  = rim-contest rate           (LeagueDashPtDefend Overall + LT6)
#   rimpm   = PLUSMINUS at Less Than 6Ft (rim D_FG% - normal), pct pts  (negative = good; front-end inverts)
ROLE_MIN_MPG = 15.0    # minutes floor (matches QUALIFY.min_mpg)
ROLE_MIN_DFGA = 200    # defended-FGA floor (Overall) — stable rim-contest / rim-± sample

def load_ptdefend_overall(season):
    from nba_api.stats.endpoints import leaguedashptdefend as L
    df = call(L.LeagueDashPtDefend, dict(
        season=season, season_type_all_star=C.SEASON_TYPE, defense_category="Overall"))
    return df.set_index("CLOSE_DEF_PERSON_ID")

def derive_role(season, universe, box):
    """Attach p['role'] to eligible current-season bigs. Raw values only — the page
    percentiles them within the big cohort. No new endpoints beyond ptdefend Overall:
    LeagueSeasonMatchups and ptdefend LT6 are already fetched for other metrics (cached)."""
    fm, fd = C.FIELD_MAP["matchups"], C.FIELD_MAP["ptdefend"]
    # perimeter assignment — per-defender guard vs total PARTIAL_POSS, using the SITE's position bucket
    pos = {pid: p["pos"] for pid, p in universe.items()}
    poss_tot, poss_guard = {}, {}
    mdf = load_matchups(season)
    for _, r in mdf.iterrows():
        dpid = int(r[fm["def_id"]]); w = float(r.get(fm["partial_poss"], 0) or 0)
        if w <= 0: continue
        poss_tot[dpid] = poss_tot.get(dpid, 0.0) + w
        if pos.get(int(r[fm["off_id"]])) == "Guard":
            poss_guard[dpid] = poss_guard.get(dpid, 0.0) + w
    ov = load_ptdefend_overall(season)        # new (1 call)
    lt = load_ptdefend(None, season)          # Less Than 6Ft (cached; raw columns)

    def mpg(pid):
        if pid in box.index:
            gp = float(box.loc[pid, "gp"] or 0)
            return (float(box.loc[pid, "min"] or 0) / gp) if gp else 0
        return 0

    n = 0
    for pid, p in universe.items():
        if p["pos"] != "Big" or pid not in ov.index: continue
        dfga = float(ov.loc[pid, "D_FGA"] or 0)
        if dfga < ROLE_MIN_DFGA or mpg(pid) < ROLE_MIN_MPG: continue
        tot = poss_tot.get(pid, 0.0)
        if tot <= 0 or pid not in lt.index: continue
        fga_lt06 = float(lt.loc[pid, fd["d_fga"]] or 0)
        p["role"] = {
            "perim":   round(100 * poss_guard.get(pid, 0.0) / tot, 1),
            "contest": round(100 * fga_lt06 / dfga, 1),
            "rimpm":   round(100 * float(lt.loc[pid, fd["plusminus"]] or 0), 1),  # negative = good
            "poss":    round(tot),
            "dfga":    round(dfga),
        }
        n += 1
    print(f"  role: attached to {n} eligible bigs (MPG>={ROLE_MIN_MPG:.0f}, D_FGA>={ROLE_MIN_DFGA})")

# --------------------------------------------------------------------------
# Guardometer — distribution of a player's defensive matchups across the site's
# three position buckets (Guard/Wing/Big). A near-free extension of the same
# matchup pass the Perimeter Assignment Rate uses: same cached LeagueSeasonMatchups
# fetch, same site position source (universe[pid]["pos"]). No new endpoints, no
# second position derivation. Denominator = classified matchup PARTIAL_POSS, so the
# three shares sum to 100 (a few possessions vs off players missing from the roster
# are dropped rather than left as an "unclassified" remainder).
GUARD_MIN_MPG = 15.0    # minutes floor for showing the module

def derive_guard(season, universe, box):
    fm = C.FIELD_MAP["matchups"]
    pos = {pid: p["pos"] for pid, p in universe.items()}
    agg = {}  # def_pid -> {"Guard":poss, "Wing":poss, "Big":poss, "tot":poss}
    for _, r in load_matchups(season).iterrows():        # cached (already fetched for mtch/oppfg)
        w = float(r.get(fm["partial_poss"], 0) or 0)
        if w <= 0: continue
        opos = pos.get(int(r[fm["off_id"]]))
        if opos not in ("Guard", "Wing", "Big"): continue
        gb = agg.setdefault(int(r[fm["def_id"]]), {"Guard": 0.0, "Wing": 0.0, "Big": 0.0, "tot": 0.0})
        gb[opos] += w; gb["tot"] += w

    def mpg(pid):
        if pid in box.index:
            gp = float(box.loc[pid, "gp"] or 0)
            return (float(box.loc[pid, "min"] or 0) / gp) if gp else 0
        return 0

    n = 0
    for pid, gb in agg.items():
        if pid not in universe or gb["tot"] <= 0 or mpg(pid) < GUARD_MIN_MPG: continue
        t = gb["tot"]
        universe[pid]["guard"] = {
            "g": round(100 * gb["Guard"] / t, 1),
            "w": round(100 * gb["Wing"] / t, 1),
            "b": round(100 * gb["Big"] / t, 1),
            "poss": round(t),
        }
        n += 1
    print(f"  guard: attached to {n} players (MPG>={GUARD_MIN_MPG:.0f})")

# --------------------------------------------------------------------------
# build — orchestrate all sources across windows -> players.json
# --------------------------------------------------------------------------
def build_one_season(season, current=None, qualify=None):
    """Run the full per-player pipeline for a single season -> (players_list, unavailable_metrics).

    `current` names the season that gets the current-season-only extras (comps, defensive role,
    Guardometer); by default the newest season in C.SEASONS. `qualify` overrides C.QUALIFY —
    refresh_current.py passes a games-played bar pro-rated to how far the season has gone."""
    is_current = season == (current or C.SEASONS[0])
    q = qualify or C.QUALIFY
    idx = load_index(season)
    fi = C.FIELD_MAP["index"]
    universe = {}
    for _, r in idx.iterrows():
        pid = int(r[fi["id"]])
        first, last = _s(r.get(fi["first"])), _s(r.get(fi["last"]))
        universe[pid] = dict(
            id=pid, name=_ascii(f"{first} {last}".strip()), team=_s(r.get(fi["team"])),
            pos=C.position_bucket(r.get(fi["pos"], "")), age=0,
            college=None, exp=None,
            m={}, qualified=False,
        )

    unavailable = set()

    # static (season-only) physical layer + age (PlayerIndex no longer carries AGE)
    bio = load_bio(season)
    fb = C.FIELD_MAP["bio"]
    for pid, p in universe.items():
        if pid in bio.index:
            b = bio.loc[pid]
            _put_static(p, "height", _num(b.get(fb["height_in"], 0)))   # _num tolerates ' '/'' junk
            _put_static(p, "strength", _num(b.get(fb["weight"], 0)))    # (older-season bio can carry blanks)
            p["age"] = int(_num(b.get(fb["age"], 0)))  # fallback if birthdate lookup below fails
    # combine (wingspan/reach/vert/lateral) — load once, join by id; left null if absent
    _attach_combine(universe, season)

    # birthdate + precise age (CommonPlayerInfo, one cached call per unique player)
    fpi = C.FIELD_MAP["player_info"]
    ref_date = _season_ref_date(season)
    season_start_year = int(season[:4])
    for pid, p in universe.items():
        try:
            info = load_player_info(pid)
            row = info.iloc[0]
            bd_raw = row.get(fpi["birthdate"])
            if bd_raw:
                p["birthdate"] = str(bd_raw).split("T")[0]
                p["age"] = _age_from_birthdate(bd_raw, ref_date)
            school = row.get(fpi["school"])
            p["college"] = str(school).strip() if school and str(school).strip() else None
            from_year = row.get(fpi["from_year"])
            p["exp"] = (season_start_year - int(from_year) + 1) if from_year not in (None, "") else None
        except Exception:
            unavailable.add("birthdate")

    # windowed box/adv-derived + track/ptshot/ptdefend metrics
    box_season, adv_season = None, None
    for win, ln in C.WINDOWS.items():
        box, adv = load_box(ln, season), load_adv(ln, season)
        if win == "season":
            box_season, adv_season = box, adv
        derived = derive_box(box, adv)
        for key, mp in derived.items():
            for pid, (v, n) in mp.items():
                if pid in universe:
                    universe[pid]["m"].setdefault(key, {})[win] = {"v": v, "n": n}
        # qualifier from season window
        if win == "season":
            for pid, r in box.iterrows():
                if pid in universe:
                    gp = r.get("gp", 0) or 0; mpg = (r.get("min",0) or 0)/gp if gp else 0
                    universe[pid]["qualified"] = (gp >= q["min_gp"] and mpg >= q["min_mpg"])

        # drv: Drive rate / 75, normalized by season/window POSS (same pattern as pts/stl/blk)
        try:
            trk = load_track("Drives", ln, season)
            for pid, r in trk.iterrows():
                if pid not in universe: continue
                p = float(adv.loc[pid, "poss"]) if pid in adv.index and "poss" in adv else 0
                if p > 0:
                    drives = float(r.get("DRIVES", 0) or 0)
                    universe[pid]["m"].setdefault("drv", {})[win] = {"v": round(drives/p*75, 1), "n": round(p)}
        except Exception:
            unavailable.add("drv")

        # potast: Potential assists / 75 — LeagueDashPtStats Passing, normalized by season/window POSS
        # (same pattern as drv/pts). Tracking passing exists ~2013-14+; older seasons come back null.
        try:
            fpa = C.FIELD_MAP["track_passing"]
            pas = load_track("Passing", ln, season)
            for pid, r in pas.iterrows():
                if pid not in universe: continue
                p = float(adv.loc[pid, "poss"]) if pid in adv.index and "poss" in adv else 0
                if p > 0:
                    pa = float(r.get(fpa["potential_ast"], 0) or 0)
                    # The NBA's tracking table occasionally carries an impossible row: more
                    # potential assists than passes made (2025-26 as re-published by Oct 2026:
                    # Scheierman 720 PA on 116 AST all season, 560 PA on 243 passes over ten
                    # games; Adebayo and J. Brown in the short windows). Such a row is left
                    # blank rather than shipped. 5x assists is far outside any real season.
                    passes = float(r.get("PASSES_MADE", 0) or 0)
                    ast_n = float(r.get("AST", 0) or 0)
                    if (passes and pa > passes) or (ast_n >= 5 and pa > 5 * ast_n):
                        continue
                    universe[pid]["m"].setdefault("potast", {})[win] = {"v": round(pa/p*75, 1), "n": round(p)}
        except Exception:
            unavailable.add("potast")

        # selfcr: self-creation = FGA_FREQUENCY at Very Tight + Tight closest-defender distance
        try:
            fp = C.FIELD_MAP["ptshot"]
            vt = load_ptshot(ln, "range_very_tight", season)
            tt = load_ptshot(ln, "range_tight", season)
            for pid in set(vt.index) | set(tt.index):
                if pid not in universe: continue
                vfreq = float(vt.loc[pid, fp["fga_freq"]]) if pid in vt.index else 0.0
                tfreq = float(tt.loc[pid, fp["fga_freq"]]) if pid in tt.index else 0.0
                vfga = float(vt.loc[pid, fp["fga"]]) if pid in vt.index else 0.0
                tfga = float(tt.loc[pid, fp["fga"]]) if pid in tt.index else 0.0
                n = round(vfga + tfga)
                if n > 0:
                    universe[pid]["m"].setdefault("selfcr", {})[win] = {"v": round(100*(vfreq+tfreq), 1), "n": n}
        except Exception:
            unavailable.add("selfcr")

        # rim: rim FG% defensive diff vs league norm (NBA-computed PLUSMINUS, already a pct-point diff)
        try:
            fd = C.FIELD_MAP["ptdefend"]
            pdf = load_ptdefend(ln, season)
            for pid, r in pdf.iterrows():
                if pid not in universe: continue
                fga = float(r.get(fd["d_fga"], 0) or 0)
                if fga > 0:
                    diff = float(r.get(fd["plusminus"], 0) or 0) * 100
                    universe[pid]["m"].setdefault("rim", {})[win] = {"v": round(diff, 1), "n": round(fga)}
        except Exception:
            unavailable.add("rim")

    # line: top-of-card season per-game stat line (PTS/AST/REB/TOV/MIN over GP)
    if box_season is not None:
        for pid, r in box_season.iterrows():
            if pid not in universe: continue
            gp = r.get("gp", 0) or 0
            if gp <= 0: continue
            universe[pid]["line"] = dict(
                ppg=round((r.get("pts", 0) or 0) / gp, 1),
                apg=round((r.get("ast", 0) or 0) / gp, 1),
                rpg=round((r.get("reb", 0) or 0) / gp, 1),
                tpg=round((r.get("tov", 0) or 0) / gp, 1),
                mpg=round((r.get("min", 0) or 0) / gp, 1),
            )

    # defl: deflections / 75 — LeagueHustleStatsPlayer has no LastNGames support, season only
    try:
        fh_ = C.FIELD_MAP["hustle"]
        hu = load_hustle(season)
        for pid, r in hu.iterrows():
            if pid not in universe or adv_season is None or pid not in adv_season.index: continue
            p = float(adv_season.loc[pid, "poss"]) if "poss" in adv_season else 0
            if p > 0:
                defl = float(r.get(fh_["deflections"], 0) or 0)
                universe[pid]["m"].setdefault("defl", {})["season"] = {"v": round(defl/p*75, 1), "n": round(p)}
    except Exception:
        unavailable.add("defl")

    # grav: off-ball perimeter gravity (season-only; spread across windows)
    try:
        fg = C.FIELD_MAP["gravity"]
        grav = load_gravity(season)
        for pid, r in grav.iterrows():
            if pid not in universe: continue
            frames = float(r.get(fg["frames"], 0) or 0)
            if frames > 0:
                v = float(r.get(fg["offball_perimeter"], 0) or 0)
                _put_static_vn(universe[pid], "grav", round(v, 1), round(frames))
    except Exception:
        unavailable.add("grav")

    # syn: possession-weighted PPP percentile across offensive Synergy play types
    try:
        syn = load_synergy(season)
        for pid, (v, n) in syn.items():
            if pid in universe:
                _put_static_vn(universe[pid], "syn", v, n)
    except Exception:
        unavailable.add("syn")

    # onoff: team net rating on-court minus off-court, per player (season-only; spread across
    # windows). Per-team failures are swallowed inside load_onoff; this catch is a last-resort
    # net for e.g. the static team list itself failing to load.
    try:
        onoff = load_onoff(season)
        for pid, (v, n) in onoff.items():
            if pid in universe:
                _put_static_vn(universe[pid], "onoff", v, n)
    except Exception:
        unavailable.add("onoff")

    # mtch / oppfg: LeagueSeasonMatchups rollup by defender.
    #   oppfg = matchup FG% allowed vs league-average matchup FG% (signed pct-point diff).
    #   mtch  = "matchup difficulty" proxy = PARTIAL_POSS-weighted average season PPG of the
    #           offensive players guarded (no direct difficulty column exists on this endpoint).
    try:
        fm = C.FIELD_MAP["matchups"]
        mdf = load_matchups(season)
        league_fgm = mdf[fm["matchup_fgm"]].astype(float).sum()
        league_fga = mdf[fm["matchup_fga"]].astype(float).sum()
        league_fgpct = league_fgm / league_fga if league_fga else 0
        ppg_map = {}
        if box_season is not None:
            for pid, r in box_season.iterrows():
                gp = r.get("gp", 0) or 0
                if gp > 0:
                    ppg_map[pid] = (r.get("pts", 0) or 0) / gp
        agg = {}  # def_pid -> [wpts_sum, wposs_sum, fgm_sum, fga_sum]
        for _, r in mdf.iterrows():
            def_pid, off_pid = int(r[fm["def_id"]]), int(r[fm["off_id"]])
            w = float(r.get(fm["partial_poss"], 0) or 0)
            fgm, fga = float(r.get(fm["matchup_fgm"], 0) or 0), float(r.get(fm["matchup_fga"], 0) or 0)
            a = agg.setdefault(def_pid, [0.0, 0.0, 0.0, 0.0])
            a[2] += fgm; a[3] += fga
            ppg = ppg_map.get(off_pid)
            if ppg is not None and w > 0:
                a[0] += w*ppg; a[1] += w
        for pid, (wpts, wposs, fgm, fga) in agg.items():
            if pid not in universe: continue
            if wposs > 0:
                _put_static_vn(universe[pid], "mtch", round(wpts/wposs, 1), round(wposs))
            if fga > 0:
                _put_static_vn(universe[pid], "oppfg", round(100*(fgm/fga - league_fgpct), 1), round(fga))
    except Exception:
        unavailable.add("mtch"); unavailable.add("oppfg")

    # statistical comps — current season only (current-vs-current), needs the season box/adv frames
    if is_current and box_season is not None and adv_season is not None:
        try:
            compute_comps(season, universe, box_season, adv_season)
        except Exception as e:
            print(f"  comps: failed ({e})")

    # inferred defensive role — current-season bigs only
    if is_current and box_season is not None:
        try:
            derive_role(season, universe, box_season)
        except Exception as e:
            print(f"  role: failed ({e})")

    # Guardometer — matchup distribution across position buckets (current season, all positions)
    if is_current and box_season is not None:
        try:
            derive_guard(season, universe, box_season)
        except Exception as e:
            print(f"  guard: failed ({e})")

    players = [p for p in universe.values() if p["m"]]
    return players, unavailable

def _fully_null_metrics(players):
    """Metric keys for which NO player this season carries a single non-null value in any window
    — i.e. the metric came back fully null (endpoint empty, errored, or simply not tracked that
    season). Data-derived, so it catches empty-but-no-error endpoints that the `unavailable`
    error set alone would miss. Returns a sorted list of metric keys."""
    have = set()
    for p in players:
        for key, wins in p.get("m", {}).items():
            if key in have:
                continue
            if any((w or {}).get("v") is not None for w in wins.values()):
                have.add(key)
    all_keys = {m["key"] for m in C.METRICS}
    return sorted(all_keys - have)

def build():
    os.makedirs(C.OUT_DIR, exist_ok=True)
    write_metrics_config()

    data = {}
    unavailable_by_season = {}
    fully_null_by_season = {}
    for season in C.SEASONS:
        print(f"--- {season} ---")
        players, unavailable = build_one_season(season)
        data[season] = dict(players=players)
        unavailable_by_season[season] = unavailable
        fully_null_by_season[season] = _fully_null_metrics(players)
        note = f"; null metrics: {sorted(unavailable)}" if unavailable else ""
        print(f"  {len(players)} players{note}")

    payload = dict(
        seasons=list(C.SEASONS),
        generated=dt.datetime.now(dt.timezone.utc).isoformat(),
        source="nba_api",
        data=data,
    )
    path = os.path.join(C.OUT_DIR, "players.json")
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    total = sum(len(v["players"]) for v in data.values())
    print(f"wrote {path}  ({total} player-season rows across {len(C.SEASONS)} seasons)")

    flagged = {s: sorted(u) for s, u in unavailable_by_season.items() if u}
    if flagged:
        print("metrics written as null by season (endpoint/columns unavailable):")
        for s, u in flagged.items():
            print(f"  {s}: {u}")

    # per-season coverage: which metrics came back FULLY null (no player has a value in any
    # window). Older seasons legitimately lack newer stats (tracking ~2013-14+, hustle/synergy
    # ~2015-16+, gravity recent-only, combine varies), so this is expected, not an error.
    print("\n=== metric coverage: fully-null metrics per season (oldest seasons lack newer stats) ===")
    for season in C.SEASONS:
        fn = fully_null_by_season.get(season, [])
        if fn:
            print(f"  {season}: {len(fn)} fully null -> {fn}")
        else:
            print(f"  {season}: all metrics have data")

def _put_static(p, key, val):
    for win in C.WINDOWS:
        p["m"].setdefault(key, {})[win] = {"v": round(val, 1) if val else None, "n": None}

def _put_static_vn(p, key, v, n):
    for win in C.WINDOWS:
        p["m"].setdefault(key, {})[win] = {"v": v, "n": n}

def _attach_combine(universe, season):
    """Combine anthro+drills across recent draft classes; left null when a player never measured."""
    try:
        from nba_api.stats.endpoints import draftcombineplayeranthro as A, draftcombinestats as S
    except Exception:
        return
    for yr in range(2018, int(season[:4]) + 1):
        season_yr = f"{yr}-{str(yr+1)[2:]}"
        try:
            anth = call(A.DraftCombinePlayerAnthro, dict(season_year=season_yr, league_id="00")).set_index("PLAYER_ID")
            stat = call(S.DraftCombineStats, dict(season_all_time=season_yr, league_id="00")).set_index("PLAYER_ID")
        except Exception:
            continue
        for pid in universe:
            if pid in anth.index:
                a = anth.loc[pid]
                _put_static(universe[pid], "length", _num(a.get("WINGSPAN")))
                _put_static(universe[pid], "reach", _num(a.get("STANDING_REACH")))
            if pid in stat.index:
                s = stat.loc[pid]
                _put_static(universe[pid], "vert", _num(s.get("MAX_VERTICAL_LEAP")))
                _put_static(universe[pid], "lateral", _num(s.get("LANE_AGILITY_TIME")))

def _num(x):
    try: return float(x)
    except Exception: return 0.0

_ASCII_EXTRA = str.maketrans({"đ": "d", "Đ": "D", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "ß": "ss", "æ": "ae", "Æ": "AE"})

def _ascii(name):
    """Modern-era names have always been plain ASCII here ("Nikola Jokic"): that is how
    PlayerIndex served them through July 2026, and 15 seasons of the archive, the connector's
    tests and anything that matches on a name were built that way. By October 2026 the NBA
    serves them accented ("Nikola Jokić"). Folding them keeps a player's name identical across
    his seasons. Search ignores accents either way."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name.translate(_ASCII_EXTRA))
    return "".join(ch for ch in s if not unicodedata.combining(ch))

def _s(x):
    """NaN/None-safe string coercion — older-season PlayerIndex rows can carry NaN name/team
    fields; return "" for those rather than the literal 'nan'."""
    return x.strip() if isinstance(x, str) else ""

def write_metrics_config():
    os.makedirs(C.OUT_DIR, exist_ok=True)
    cfg = dict(
        season=C.SEASON, windows=list(C.WINDOWS.keys()), qualify=C.QUALIFY,
        tier_since=C.TIER_SINCE,
        metrics=[dict({k: m[k] for k in ("key","label","group","sub","layer","unit","thr","lower")},
                      tier=m.get("tier", 1), since=C.TIER_SINCE[m.get("tier", 1)]) for m in C.METRICS],
        # Weakness comps: the page needs the flaw labels to render `wflaws`, and the
        # low_match threshold to decide when to warn that a match isn't really a match.
        # Everything else in C.WEAKNESS is generator-side tuning and stays out of the page.
        weakness=dict(dims=C.weakness_labels(), low_match=C.WEAKNESS["low_match"],
                      min_minutes=C.WEAKNESS["min_minutes"]),
    )
    with open(os.path.join(C.OUT_DIR, "metrics_config.json"), "w") as fh:
        json.dump(cfg, fh, indent=2)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    {"discover": discover, "build": build, "config": write_metrics_config}.get(cmd, build)()
