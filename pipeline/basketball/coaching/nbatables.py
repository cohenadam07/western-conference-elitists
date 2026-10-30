"""
nbatables.py — the NBA's own team tables, read from the engine's cache (nba_pulls.py fills
it on the Mac): per season, per franchise, the numbers no play-by-play can give.

    team_season(season) -> {franchise: {...}}   keys below, None where the table has no season

  tracking (2013-14)  passes per 100 possessions, seconds per touch, secondary assists per 100,
                      potential assists per 100, drives per 100, pull-up and catch-and-shoot
                      shares of jump shots, average speed, distance per game, elbow / post /
                      paint touches per 100, contested rebound share
  hustle (2016-17)    screen assists, deflections, charges drawn, offensive and defensive box
                      outs, contested shots, loose balls, all per 100 possessions
  synergy (2015-16)   points per possession and frequency by play type, offense and defense
  team stats (1996-97) pace, ratings and four factors from LeagueDashTeamStats, for the seasons
                      before the play-by-play (1996-97 to 2001-02) and as a cross-check after
  zone (2025-26)      zone-defense share and results, when the endpoint answers

A table whose columns moved is skipped, not guessed: the reader checks the columns it needs.
"""
import os

import pandas as pd

import savant_engine as E
import teams as TM

SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
ST = "Regular Season"
PLAY_TYPES = ["Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup", "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]


def _read(name, params, frame=0):
    """A table from the engine's cache, or from the Mac's tracking upload (BCS_NBA_TABLES, gzipped
    under the same keys: export_tracking.py / publish_tracking.sh) when the cache has none."""
    key = E._key(name, params, frame)
    p = os.path.join(SAVANT, "cache", key + ".json")
    df = None
    if os.path.exists(p):
        try:
            df = pd.read_json(p)
        except ValueError:
            df = None
    if df is None and os.environ.get("BCS_NBA_TABLES"):
        import gzip, io
        q = os.path.join(os.environ["BCS_NBA_TABLES"], key + ".json.gz")
        if os.path.exists(q):
            try:
                df = pd.read_json(io.StringIO(gzip.open(q).read().decode()))
            except ValueError:
                df = None
    return df if df is not None and len(df) else None


def _f(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _by_team(df):
    out = {}
    for r in df.to_dict("records"):
        key = TM.FRANCHISES.get(int(r.get("TEAM_ID") or 0))
        if key:
            out[key] = r
    return out


def team_stats(season):
    out = {}
    tabs = {m: _read("LeagueDashTeamStats", dict(season=season, season_type_all_star=ST, measure_type_detailed_defense=m, per_mode_detailed="Totals"))
            for m in ("Advanced", "Four Factors", "Opponent", "Base")}
    if tabs["Advanced"] is None:
        return out
    adv, ff, opp, base = (_by_team(tabs[m]) if tabs[m] is not None else {} for m in ("Advanced", "Four Factors", "Opponent", "Base"))
    for key, a in adv.items():
        f, o, b = ff.get(key, {}), opp.get(key, {}), base.get(key, {})
        out[key] = dict(gp=int(a.get("GP") or 0), w=int(a.get("W") or 0), l=int(a.get("L") or 0), poss=_f(a.get("POSS")), pace=_f(a.get("PACE")),
                        ortg=_f(a.get("OFF_RATING")), drtg=_f(a.get("DEF_RATING")), net=_f(a.get("NET_RATING")), ast_pct=_f(a.get("AST_PCT")),
                        efg=_f(f.get("EFG_PCT")), ftr=_f(f.get("FTA_RATE")), tov=_f(f.get("TM_TOV_PCT")), orb=_f(f.get("OREB_PCT")),
                        o_efg=_f(f.get("OPP_EFG_PCT")), o_ftr=_f(f.get("OPP_FTA_RATE")), o_tov=_f(f.get("OPP_TOV_PCT")), o_orb=_f(f.get("OPP_OREB_PCT")),
                        fg3r=(_f(b.get("FG3A")) or 0) / (_f(b.get("FGA")) or 1), o_fg3r=(_f(o.get("OPP_FG3A")) or 0) / (_f(o.get("OPP_FGA")) or 1),
                        pf=_f(b.get("PF")), fga=_f(b.get("FGA")), fg3m=_f(b.get("FG3M")), fg3a=_f(b.get("FG3A")), ftm=_f(b.get("FTM")), fta=_f(b.get("FTA")),
                        o_fg3m=_f(o.get("OPP_FG3M")), o_fg3a=_f(o.get("OPP_FG3A")), o_ftm=_f(o.get("OPP_FTM")), o_fta=_f(o.get("OPP_FTA")))
    return out


def tracking(season):
    if int(season[:4]) < 2013:
        return {}
    out = {}
    tabs = {m: _read("LeagueDashPtStats", dict(season=season, season_type_all_star=ST, pt_measure_type=m, per_mode_simple="Totals", player_or_team="Team"))
            for m in ("Passing", "Possessions", "Drives", "CatchShoot", "PullUpShot", "SpeedDistance", "Rebounding", "ElbowTouch", "PostTouch", "PaintTouch")}
    tabs = {m: _by_team(df) for m, df in tabs.items() if df is not None}
    teams = set().union(*(set(v) for v in tabs.values())) if tabs else set()
    ts = team_stats(season)
    for key in teams:
        poss = (ts.get(key) or {}).get("poss")
        per100 = (lambda v: round(100.0 * v / poss, 2) if (v is not None and poss) else None)
        P, Q, D, C, U, S, R = (tabs.get(m, {}).get(key, {}) for m in ("Passing", "Possessions", "Drives", "CatchShoot", "PullUpShot", "SpeedDistance", "Rebounding"))
        el, po, pa = (tabs.get(m, {}).get(key, {}) for m in ("ElbowTouch", "PostTouch", "PaintTouch"))
        cs_fga, pu_fga = _f(C.get("CATCH_SHOOT_FGA")), _f(U.get("PULL_UP_FGA"))
        out[key] = dict(
            passes100=per100(_f(P.get("PASSES_MADE"))), sec_ast100=per100(_f(P.get("SECONDARY_AST"))), pot_ast100=per100(_f(P.get("POTENTIAL_AST"))),
            touches100=per100(_f(Q.get("TOUCHES"))), sec_per_touch=_f(Q.get("AVG_SEC_PER_TOUCH")), drib_per_touch=_f(Q.get("AVG_DRIB_PER_TOUCH")),
            drives100=per100(_f(D.get("DRIVES"))), pullup_share=round(pu_fga / (pu_fga + cs_fga), 3) if pu_fga is not None and cs_fga else None,
            cs_fga100=per100(cs_fga), pu_fga100=per100(pu_fga), speed=_f(S.get("AVG_SPEED")), dist_g=(_f(S.get("DIST_MILES")) or 0) / (int(S.get("GP") or 0) or 1) if S else None,
            elbow100=per100(_f(el.get("ELBOW_TOUCHES"))), post100=per100(_f(po.get("POST_TOUCHES"))), paint100=per100(_f(pa.get("PAINT_TOUCHES"))),
            oreb_contest=_f(R.get("OREB_CONTEST_PCT")), dreb_contest=_f(R.get("DREB_CONTEST_PCT")), oreb_chance_pct=_f(R.get("OREB_CHANCE_PCT")),
        )
    return out


def hustle(season):
    if int(season[:4]) < 2016:
        return {}
    df = _read("LeagueHustleStatsTeam", dict(season=season, season_type_all_star=ST, per_mode_time="Totals"))
    if df is None:
        return {}
    ts = team_stats(season)
    out = {}
    for key, r in _by_team(df).items():
        poss = (ts.get(key) or {}).get("poss")
        per100 = (lambda v: round(100.0 * v / poss, 2) if (v is not None and poss) else None)
        out[key] = dict(screen_ast100=per100(_f(r.get("SCREEN_ASSISTS"))), screen_pts100=per100(_f(r.get("SCREEN_AST_PTS"))), defl100=per100(_f(r.get("DEFLECTIONS"))),
                        charges100=per100(_f(r.get("CHARGES_DRAWN"))), off_box100=per100(_f(r.get("OFF_BOXOUTS"))), def_box100=per100(_f(r.get("DEF_BOXOUTS"))),
                        contested100=per100(_f(r.get("CONTESTED_SHOTS"))), loose100=per100(_f(r.get("LOOSE_BALLS_RECOVERED"))))
    return out


def synergy(season):
    if int(season[:4]) < 2015:
        return {}
    out = {}
    for grp, side in (("offensive", "o"), ("defensive", "d")):
        for pt in PLAY_TYPES:
            df = _read("SynergyPlayTypes", dict(season=season, season_type_all_star=ST, player_or_team_abbreviation="T", play_type_nullable=pt,
                                                type_grouping_nullable=grp, per_mode_simple="Totals"))
            if df is None:
                continue
            for key, r in _by_team(df).items():
                poss = _f(r.get("POSS"))
                if not poss:
                    continue
                out.setdefault(key, {"o": {}, "d": {}})[side][pt] = [round(100 * (_f(r.get("POSS_PCT")) or 0), 1), round(_f(r.get("PPP")) or 0, 3), int(poss)]
    return out


def zone(season):
    if int(season[:4]) < 2025:
        return {}
    df = _read("ZoneDefenseTeamLeaders", dict(season=season, season_type_all_star=ST))
    if df is None:
        return {}
    out = {}
    cols = {c.lower(): c for c in df.columns}
    for r in df.to_dict("records"):
        tid = r.get(cols.get("teamid") or cols.get("team_id") or "")
        key = TM.FRANCHISES.get(int(tid)) if tid else None
        if key:
            out[key] = {k.lower(): v for k, v in r.items()}
    return out


def switches(season):
    """{franchise: {switch100, games, matchup_poss}} from the NBA's defensive box scores
    (BoxScoreDefensiveV2, 2017-18 on), one per game: switchesOn over partial matchup possessions,
    per 100. Read from the engine's cache, the tracking upload (BCS_NBA_TABLES) or the ext-seed
    tables (BCS_EXT_SEED); a season is reported with the games it covers, since the history pass
    lands season by season."""
    if int(season[:4]) < 2017:
        return {}
    df = _read("LeagueGameLog", dict(season=season, season_type_all_star=ST, player_or_team_abbreviation="T"))
    if df is None:
        return {}
    gids = sorted({str(g).zfill(10) for g in df["GAME_ID"]})
    acc = {}
    seed = os.environ.get("BCS_EXT_SEED")
    for gid in gids:
        key = E._key("BoxScoreDefensiveV2", dict(game_id=gid), 0)
        d = _read("BoxScoreDefensiveV2", dict(game_id=gid))
        if d is None and seed:
            q = os.path.join(seed, "tables", key + ".json.gz")
            if os.path.exists(q):
                import gzip, io
                try:
                    d = pd.read_json(io.StringIO(gzip.open(q).read().decode()))
                except ValueError:
                    d = None
        if d is None or "switchesOn" not in d.columns or "partialPossessions" not in d.columns:
            continue
        for tid, g in d.groupby("teamId"):
            fr = TM.FRANCHISES.get(int(tid))
            if not fr:
                continue
            a = acc.setdefault(fr, [0.0, 0.0, 0])
            a[0] += float(g["switchesOn"].fillna(0).sum()); a[1] += float(g["partialPossessions"].fillna(0).sum()); a[2] += 1
    # the NBA has published switchesOn as all zeros in some seasons: a season with no switch logged
    # anywhere is reported as not tracked (None), never as 0 switches
    any_switch = any(a[0] > 0 for a in acc.values())
    return {fr: dict(switch100=round(100.0 * a[0] / a[1], 2) if (a[1] and any_switch) else None, games=a[2], matchup_poss=round(a[1]), logged=any_switch) for fr, a in acc.items() if a[2]}


def team_season(season):
    ts, tr, hu, sy, zo, sw = team_stats(season), tracking(season), hustle(season), synergy(season), zone(season), switches(season)
    out = {}
    for key in set(ts) | set(tr) | set(hu) | set(sy):
        out[key] = dict(stats=ts.get(key), tracking=tr.get(key), hustle=hu.get(key), synergy=sy.get(key), zone=zo.get(key), switches=sw.get(key))
    return out
