"""
espn_shim.py — answer the engine's stats.nba.com requests without stats.nba.com.

`install(season, tables, seed_dir)` replaces savant_engine.call / call_frames. Every request
the in-season refresh makes is then answered one of three ways:

  1. The season in progress, countable from a box score or play-by-play: rebuilt from ESPN
     (espn_tables.SeasonTables), with the NBA's column names.
  2. Anything that doesn't change in season (earlier seasons, the draft combines, a player's
     birthdate): read from the seed — the Mac's cache files for exactly those requests, shipped
     with the repo (pipeline/basketball/seed/, see export_seed.py). Same cache key as the engine.
  3. The NBA's camera-tracking, Synergy and hustle tables: there is no public source that
     answers from a cloud server. The request fails, the engine's own handling takes over, and
     those stats are left out of the season in progress (null, not stale).
"""
import json
import os
import re
from collections import defaultdict

import pandas as pd

import savant_engine as E
import espn_tables as T

# Usage from ESPN's play-by-play runs 1.2% above the NBA's USG_PCT, evenly across players
# (2025-26, all 349 qualified players: correlation 0.9997, ratio 0.988). Scaled to match.
USG_SCALE = 0.988

UNAVAILABLE = {
    "LeagueDashPtStats", "LeagueDashPlayerPtShot", "LeagueDashPtDefend",
    "LeagueHustleStatsPlayer", "GravityLeaders", "SynergyPlayTypes", "LeagueSeasonMatchups",
}

LOG = []


class NotInCloud(RuntimeError):
    pass


def read_seed_key(seed_dir, key):
    """A seed table by cache key (the engine's md5 of endpoint + params + frame)."""
    import gzip, io
    for ext in (".json.gz", ".json", ".csv.gz"):
        p = os.path.join(seed_dir, key + ext)
        if os.path.exists(p):
            if ext == ".csv.gz":
                return pd.read_csv(p)
            raw = gzip.open(p).read().decode() if ext.endswith(".gz") else open(p).read()
            return pd.read_json(io.StringIO(raw))
    return None


def _season_of(params):
    for k, v in params.items():
        if "season" in k and isinstance(v, str) and re.match(r"^\d{4}-\d{2}$", v):
            return v
    return None


def _measure(params):
    return params.get("measure_type_detailed_defense") or params.get("measure_type_simple") or "Base"


class Shim:
    def __init__(self, season, tables, seed_dir, seed_index=None, tracking_dir=None):
        self.season = season
        self.t = tables
        self.seed_dir = seed_dir
        self.tracking_dir = tracking_dir   # the Mac's latest copy of the UNAVAILABLE tables
        self.memo = {}

    # ---------------- dispatch ----------------
    def frames(self, name, params, frames):
        key = (name, json.dumps(params, sort_keys=True), tuple(frames))
        if key in self.memo:
            return self.memo[key]
        season = _season_of(params)
        fresh = season == self.season
        if fresh and name in UNAVAILABLE:
            # The Mac uploads these tables when it's awake (export_tracking.py, branch
            # tracking-data); use its latest copy, or leave the stats out.
            out = {}
            for fr in frames:
                df = read_seed_key(self.tracking_dir, E._key(name, params, fr)) if self.tracking_dir else None
                if df is None:
                    LOG.append(f"unavailable {name}")
                    raise NotInCloud(f"{name} needs stats.nba.com (not reachable from the cloud)")
                out[fr] = df
            LOG.append(f"from the Mac {name}")
            self.memo[key] = out
            return out
        builder = getattr(self, "b_" + name, None)
        if fresh and builder is not None:
            out = builder(params, frames)
        else:
            out = self.seed(name, params, frames)
        self.memo[key] = out
        return out

    def seed(self, name, params, frames):
        out = {}
        for fr in frames:
            df = read_seed_key(self.seed_dir, E._key(name, params, fr))
            if df is None:
                LOG.append(f"no seed {name} {json.dumps(params, sort_keys=True)}#f{fr}")
                raise NotInCloud(f"{name} {params} is not in the seed")
            out[fr] = df
        return out

    # ---------------- helpers ----------------
    def _team_id(self, abbr):
        return self.t.team_ids.get(abbr, 0)

    def _abbr(self, team_id):
        for a, i in self.t.team_ids.items():
            if int(i) == int(team_id):
                return a
        return None

    # ---------------- players ----------------
    def b_LeagueDashPlayerStats(self, params, frames):
        m = _measure(params)
        ln = params.get("last_n_games") or params.get("last_n_games_nullable")
        ln = int(ln) if ln not in (None, "", 0, "0") else None
        if m == "Base":
            df = self.player_base(ln)
        elif m == "Advanced":
            df = self.player_advanced(ln)
        elif m == "Scoring":
            df = self.player_scoring(ln)
        else:
            raise NotInCloud(f"LeagueDashPlayerStats {m}")
        return {fr: df for fr in frames}

    def _pg(self, ln):
        return self.t._player_window(ln)

    def player_base(self, ln):
        pg = self._pg(ln)
        if not len(pg):
            return pd.DataFrame()
        pg = pg.sort_values(["GAME_DATE", "GAME_ID"])
        agg = pg.groupby("PLAYER_ID").agg(
            PLAYER_NAME=("PLAYER_NAME", "last"), TEAM_ID=("TEAM_ID", "last"),
            TEAM_ABBREVIATION=("TEAM_ABBREVIATION", "last"), GP=("GAME_ID", "nunique"),
            W=("WL", lambda s: int((s == "W").sum())), L=("WL", lambda s: int((s == "L").sum())),
            MIN=("MIN", "sum"), FGM=("FGM", "sum"), FGA=("FGA", "sum"), FG3M=("FG3M", "sum"),
            FG3A=("FG3A", "sum"), FTM=("FTM", "sum"), FTA=("FTA", "sum"), OREB=("OREB", "sum"),
            DREB=("DREB", "sum"), REB=("REB", "sum"), AST=("AST", "sum"), TOV=("TOV", "sum"),
            STL=("STL", "sum"), BLK=("BLK", "sum"), PF=("PF", "sum"), PTS=("PTS", "sum"),
            PLUS_MINUS=("PLUS_MINUS", "sum"), DD2=("DD2", "sum"), TD3=("TD3", "sum")).reset_index()
        agg["FG_PCT"] = (agg.FGM / agg.FGA.where(agg.FGA > 0)).round(3).fillna(0)
        agg["FG3_PCT"] = (agg.FG3M / agg.FG3A.where(agg.FG3A > 0)).round(3).fillna(0)
        agg["FT_PCT"] = (agg.FTM / agg.FTA.where(agg.FTA > 0)).round(3).fillna(0)
        agg["W_PCT"] = (agg.W / agg.GP).round(3)
        agg["AGE"] = agg.PLAYER_ID.map(self.t.ages if hasattr(self.t, "ages") else {}).fillna(0)
        agg["BLKA"] = 0
        agg["PFD"] = 0
        agg["NICKNAME"] = ""
        return agg

    def _oncourt(self, ln):
        """{pid: {"sec", "team", "opp"}} over each player's window (his last N games)."""
        key = ("oncourt", ln)
        if key in self.memo:
            return self.memo[key]
        pg = self._pg(ln)
        want = defaultdict(set)
        for pid, gid in zip(pg.PLAYER_ID, pg.GAME_ID):
            want[pid].add(gid)
        acc = {}
        for x in self.t.parsed:
            g = x["g"]
            gid = str(g["gid"])
            for s in x["stints"]:
                for team, five in s.on.items():
                    o = g["away"] if team == g["home"] else g["home"]
                    for a in five:
                        pid = self.t.idmap.get(str(a))
                        if pid is None or gid not in want.get(pid, ()):
                            continue
                        r = acc.get(pid)
                        if r is None:
                            r = acc[pid] = {"sec": 0.0, "team": T.Tally(), "opp": T.Tally(), "poss": 0.0, "opp_poss": 0.0,
                                            "pteam": T.Tally(), "popp": T.Tally()}
                        r["sec"] += s.seconds
                        r["team"].add(s.t[team])
                        r["opp"].add(s.t[o])
            for a, (po, pd_) in x["pcred"].items():
                pid = self.t.idmap.get(str(a))
                if pid in acc and gid in want.get(pid, ()):
                    acc[pid]["poss"] += po
                    acc[pid]["opp_poss"] += pd_
                    acc[pid]["pteam"].add(x["ptal"][a]["team"])
                    acc[pid]["popp"].add(x["ptal"][a]["opp"])
        self.memo[key] = acc
        return acc

    def player_advanced(self, ln):
        base = self.player_base(ln)
        if not len(base):
            return pd.DataFrame()
        oc = self._oncourt(ln)
        rows = []
        for r in base.itertuples(index=False):
            c = oc.get(r.PLAYER_ID)
            if c is None:
                continue
            tm, op = c["team"], c["opp"]
            poss = c["poss"]          # every possession he was on the floor for (any part of)
            opp_poss = c["opp_poss"]
            mins = c["sec"] / 60.0
            # The NBA's on-court team plays also count offensive fouls (on top of the turnover
            # each one produces) and end-of-quarter heaves; with them, usage matches its USG_PCT
            # to within half a percent on average (checked on 2026-27, Oct 20-23).
            tm_use = tm["fga"] + 0.44 * tm["fta"] + tm["tov"] + tm["ofoul"] + tm["heave"]
            pl_use = r.FGA + 0.44 * r.FTA + r.TOV
            rows.append(dict(
                PLAYER_ID=r.PLAYER_ID, PLAYER_NAME=r.PLAYER_NAME, TEAM_ID=r.TEAM_ID,
                TEAM_ABBREVIATION=r.TEAM_ABBREVIATION, GP=r.GP, W=r.W, L=r.L, MIN=r.MIN,
                POSS=poss,
                OFF_RATING=round(100 * T.safe_div(tm["pts"], poss), 1),
                DEF_RATING=round(100 * T.safe_div(op["pts"], opp_poss), 1),
                NET_RATING=round(100 * T.safe_div(tm["pts"], poss) - 100 * T.safe_div(op["pts"], opp_poss), 1),
                AST_PCT=round(T.safe_div(r.AST, tm["fgm"] - r.FGM), 3),
                AST_TO=round(T.safe_div(r.AST, r.TOV), 2),
                AST_RATIO=round(100 * T.safe_div(r.AST, pl_use + r.AST), 1),
                OREB_PCT=round(T.safe_div(r.OREB, tm["oreb"] + op["dreb"]), 3),
                DREB_PCT=round(T.safe_div(r.DREB, tm["dreb"] + op["oreb"]), 3),
                REB_PCT=round(T.safe_div(r.REB, tm["oreb"] + tm["dreb"] + op["oreb"] + op["dreb"]), 3),
                TM_TOV_PCT=round(100 * T.safe_div(r.TOV, pl_use), 1),
                EFG_PCT=round(T.safe_div(r.FGM + 0.5 * r.FG3M, r.FGA), 3),
                TS_PCT=round(T.safe_div(r.PTS, 2 * (r.FGA + 0.44 * r.FTA)), 3),
                USG_PCT=round(USG_SCALE * T.safe_div(pl_use, tm_use), 3),
                PACE=round(48 * T.safe_div((poss + opp_poss) / 2, mins), 2),
                PIE=0.0,
            ))
        return pd.DataFrame(rows)

    def player_scoring(self, ln):
        pg = self._pg(ln)
        if not len(pg):
            return pd.DataFrame()
        want = defaultdict(set)
        for pid, gid in zip(pg.PLAYER_ID, pg.GAME_ID):
            want[pid].add(gid)
        acc = defaultdict(lambda: defaultdict(float))
        for x in self.t.parsed:
            gid = str(x["g"]["gid"])
            for sh in x["shots"]:
                pid = self.t.idmap.get(str(sh["eid"]))
                if pid is None or gid not in want.get(pid, ()):
                    continue
                if sh["made"]:
                    a = acc[pid]
                    a["fgm"] += 1
                    a["uast"] += sh["assisted"] is None
                    if sh["three"]:
                        a["fg3m"] += 1
                        a["uast3"] += sh["assisted"] is None
                    if sh["paint"]:
                        a["paint_pts"] += 2
        base = self.player_base(ln).set_index("PLAYER_ID")
        rows = []
        for pid, a in acc.items():
            pts = base.PTS.get(pid, 0)
            rows.append(dict(PLAYER_ID=pid, PCT_UAST_FGM=round(T.safe_div(a["uast"], a["fgm"]), 3),
                             PCT_AST_FGM=round(1 - T.safe_div(a["uast"], a["fgm"]), 3) if a["fgm"] else 0,
                             PCT_UAST_3PM=round(T.safe_div(a["uast3"], a["fg3m"]), 3),
                             PCT_PTS_PAINT=round(T.safe_div(a["paint_pts"], pts), 3)))
        df = pd.DataFrame(rows)
        if len(df):
            df = base[["PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "MIN"]].reset_index().merge(df, on="PLAYER_ID", how="left").fillna(0)
        return df

    def b_PlayerGameLogs(self, params, frames):
        pg = self.t.player_games().copy()
        pg["SEASON_YEAR"] = self.season
        pg["MATCHUP"] = [f"{t} {'vs.' if h else '@'} {o}" for t, h, o in zip(pg.TEAM_ABBREVIATION, pg.HOME, pg.OPP)]
        pg["GAME_DATE"] = pd.to_datetime(pg.GAME_DATE).dt.strftime("%Y-%m-%dT00:00:00")
        return {fr: pg for fr in frames}

    def b_LeagueGameLog(self, params, frames):
        tg = self.t.team_games()
        if not len(tg):
            return {fr: pd.DataFrame() for fr in frames}
        df = pd.DataFrame(dict(
            SEASON_ID="2" + self.season[:4], TEAM_ID=tg.TEAM.map(self._team_id),
            TEAM_ABBREVIATION=tg.TEAM, GAME_ID=tg.GAME_ID, GAME_DATE=tg.GAME_DATE,
            MATCHUP=tg.TEAM + " vs. " + tg.OPP, WL=tg.WL, MIN=(tg.SECONDS / 60).round().astype(int),
            FGM=tg.FGM, FGA=tg.FGA, FG3M=tg.FG3M, FG3A=tg.FG3A, FTM=tg.FTM, FTA=tg.FTA,
            OREB=tg.OREB, DREB=tg.DREB, REB=tg.OREB + tg.DREB, AST=tg.AST, STL=tg.STL, BLK=tg.BLK,
            TOV=tg.TOV, PF=tg.PF, PTS=tg.PTS, PLUS_MINUS=tg.PTS - tg.OPP_PTS))
        return {fr: df for fr in frames}

    # ---------------- teams ----------------
    def team_agg(self):
        if "team_agg" in self.memo:
            return self.memo["team_agg"]
        tg = self.t.team_games()
        num = [c for c in tg.columns if c not in ("TEAM", "OPP", "GAME_ID", "GAME_DATE", "WL")]
        agg = tg.groupby("TEAM")[num].sum()
        agg["GP"] = tg.groupby("TEAM").GAME_ID.nunique()
        agg["W"] = tg.assign(w=tg.WL == "W").groupby("TEAM").w.sum()
        agg["L"] = tg.assign(l=tg.WL == "L").groupby("TEAM").l.sum()
        agg = agg.reset_index()
        self.memo["team_agg"] = agg
        return agg

    def b_LeagueDashTeamStats(self, params, frames):
        a = self.team_agg()
        m = _measure(params)
        base = pd.DataFrame(dict(TEAM_ID=a.TEAM.map(self._team_id), TEAM_NAME=a.TEAM, TEAM_ABBREVIATION=a.TEAM,
                                 GP=a.GP, W=a.W, L=a.L, MIN=(a.SECONDS / 60.0).round(1)))
        if m == "Base":
            for k in ("FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "AST", "TOV", "STL", "BLK", "PF", "PTS"):
                base[k] = a[k]
            base["REB"] = a.OREB + a.DREB
            base["FG_PCT"] = (a.FGM / a.FGA).round(3)
            base["FG3_PCT"] = (a.FG3M / a.FG3A).round(3)
            base["FT_PCT"] = (a.FTM / a.FTA).round(3)
            base["PLUS_MINUS"] = a.PTS - a.OPP_PTS
        elif m == "Advanced":
            mins = a.SECONDS / 60.0
            base["POSS"] = a.POSS
            base["OFF_RATING"] = (100 * a.PTS / a.POSS).round(1)
            base["DEF_RATING"] = (100 * a.OPP_PTS / a.OPP_POSS).round(1)
            base["NET_RATING"] = (base.OFF_RATING - base.DEF_RATING).round(1)
            base["PACE"] = (48 * ((a.POSS + a.OPP_POSS) / 2) / mins).round(2)
            base["TS_PCT"] = (a.PTS / (2 * (a.FGA + 0.44 * a.FTA))).round(3)
            base["EFG_PCT"] = ((a.FGM + 0.5 * a.FG3M) / a.FGA).round(3)
            base["AST_PCT"] = (a.AST / a.FGM).round(3)
            base["AST_TO"] = (a.AST / a.TOV).round(2)
            base["OREB_PCT"] = (a.OREB / (a.OREB + a.OPP_DREB)).round(3)
            base["DREB_PCT"] = (a.DREB / (a.DREB + a.OPP_OREB)).round(3)
            base["TM_TOV_PCT"] = (100 * a.TOV / a.POSS).round(1)
            base["PIE"] = 0.0
        elif m == "Opponent":
            for k in ("FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "AST", "TOV", "STL", "BLK", "PF", "PTS"):
                base["OPP_" + k] = a["OPP_" + k]
            base["OPP_REB"] = a.OPP_OREB + a.OPP_DREB
            base["OPP_FG_PCT"] = (a.OPP_FGM / a.OPP_FGA).round(3)
            base["OPP_FG3_PCT"] = (a.OPP_FG3M / a.OPP_FG3A).round(3)
            base["OPP_FT_PCT"] = (a.OPP_FTM / a.OPP_FTA).round(3)
        elif m == "Four Factors":
            base["EFG_PCT"] = ((a.FGM + 0.5 * a.FG3M) / a.FGA).round(3)
            base["FTA_RATE"] = (a.FTA / a.FGA).round(3)
            base["TM_TOV_PCT"] = (a.TOV / a.POSS).round(3)
            base["OREB_PCT"] = (a.OREB / (a.OREB + a.OPP_DREB)).round(3)
            base["OPP_EFG_PCT"] = ((a.OPP_FGM + 0.5 * a.OPP_FG3M) / a.OPP_FGA).round(3)
            base["OPP_FTA_RATE"] = (a.OPP_FTA / a.OPP_FGA).round(3)
            base["OPP_TOV_PCT"] = (a.OPP_TOV / a.OPP_POSS).round(3)
            base["OPP_OREB_PCT"] = (a.OPP_OREB / (a.OPP_OREB + a.DREB)).round(3)
        else:
            raise NotInCloud(f"LeagueDashTeamStats {m}")
        return {fr: base for fr in frames}

    # ---------------- on/off ----------------
    def _team_onoff(self, team):
        """{pid: (on Tally pair, off Tally pair, on sec, off sec, gp)} for one team."""
        key = ("onoff", team)
        if key in self.memo:
            return self.memo[key]
        on = defaultdict(lambda: {"sec": 0.0, "team": T.Tally(), "opp": T.Tally(), "g": set(), "poss": 0.0, "opp_poss": 0.0,
                                     "all_poss": 0.0, "all_opp_poss": 0.0})
        tot = {"sec": 0.0, "team": T.Tally(), "opp": T.Tally()}
        played = defaultdict(set)
        for x in self.t.parsed:
            g = x["g"]
            if team not in (g["home"], g["away"]):
                continue
            o = g["away"] if team == g["home"] else g["home"]
            gid = str(g["gid"])
            for s in x["stints"]:
                tot["sec"] += s.seconds
                tot["team"].add(s.t[team])
                tot["opp"].add(s.t[o])
                for a in s.on.get(team, ()):
                    pid = self.t.idmap.get(str(a))
                    if pid is None:
                        continue
                    r = on[pid]
                    r["sec"] += s.seconds
                    r["team"].add(s.t[team])
                    r["opp"].add(s.t[o])
                    r["g"].add(gid)
            for b in g["players"]:
                if b["team"] == team and not b["dnp"]:
                    pid = self.t.idmap.get(str(b["eid"]))
                    if pid is not None:
                        played[pid].add(gid)
                        po, pd_ = x["pcred"].get(b["eid"], (0.0, 0.0))
                        on[pid]["poss"] += po
                        on[pid]["opp_poss"] += pd_
                        ao, ad = x["pall"].get(b["eid"], (0.0, 0.0))
                        on[pid]["all_poss"] += ao
                        on[pid]["all_opp_poss"] += ad
        res = {}
        for pid, r in on.items():
            offt = T.Tally(); offt.add(tot["team"]); offt.add(r["team"], -1)
            offo = T.Tally(); offo.add(tot["opp"]); offo.add(r["opp"], -1)
            r["team"]["poss"], r["opp"]["poss"] = r["poss"], r["opp_poss"]
            # Off the floor for any part of a possession counts as off for it (the NBA's way):
            # everything but the possessions he played from start to finish.
            offt["poss"] = tot["team"]["poss"] - r["all_poss"]
            offo["poss"] = tot["opp"]["poss"] - r["all_opp_poss"]
            res[pid] = dict(on=r, off={"sec": tot["sec"] - r["sec"], "team": offt, "opp": offo},
                            gp=len(played.get(pid, r["g"])))
        self.memo[key] = res
        return res

    def _onoff_rows(self, team_id, measure, status):
        team = self._abbr(team_id)
        rows = []
        for pid, r in self._team_onoff(team).items():
            side = r[status]
            tm, op = side["team"], side["opp"]
            row = dict(GROUP_SET="On/Off Court", TEAM_ID=int(team_id), TEAM_ABBREVIATION=team,
                       TEAM_NAME=team, VS_PLAYER_ID=pid, VS_PLAYER_NAME=self.t.names.get(pid, ""),
                       COURT_STATUS="On" if status == "on" else "Off", GP=r["gp"],
                       MIN=round(side["sec"] / 60.0, 2))
            if measure == "Advanced":
                row.update(POSS=tm["poss"],
                           OFF_RATING=round(100 * T.safe_div(tm["pts"], tm["poss"]), 1),
                           DEF_RATING=round(100 * T.safe_div(op["pts"], op["poss"]), 1))
                row["NET_RATING"] = round(row["OFF_RATING"] - row["DEF_RATING"], 1)
            elif measure == "Opponent":
                row.update(OPP_FGM=op["fgm"], OPP_FGA=op["fga"], OPP_FG3M=op["fg3m"], OPP_FG3A=op["fg3a"],
                           OPP_FTM=op["ftm"], OPP_FTA=op["fta"], OPP_PTS=op["pts"])
            elif measure == "Base":
                row.update(PTS=tm["pts"], PLUS_MINUS=tm["pts"] - op["pts"])
            rows.append(row)
        return pd.DataFrame(rows)

    def _onoff(self, params, frames):
        tid = params["team_id"]
        m = _measure(params)
        out = {}
        for fr in frames:
            if fr == 1:
                out[fr] = self._onoff_rows(tid, m, "on")
            elif fr == 2:
                out[fr] = self._onoff_rows(tid, m, "off")
            else:
                out[fr] = pd.DataFrame()
        return out

    b_TeamPlayerOnOffSummary = _onoff
    b_TeamPlayerOnOffDetails = _onoff

    # ---------------- shots ----------------
    def shot_rows(self):
        if "shots" in self.memo:
            return self.memo["shots"]
        rows = []
        for x in self.t.parsed:
            g = x["g"]
            for sh in x["shots"]:
                pid = self.t.idmap.get(str(sh["eid"]))
                if pid is None:
                    continue
                xy = T.shot_xy(sh)
                lx, ly = xy if xy else (None, None)
                dist = sh["dist"]
                if dist is None and xy:
                    dist = int(round((lx ** 2 + ly ** 2) ** 0.5 / 10))
                rem = sh["clock"]
                rows.append(dict(
                    GRID_TYPE="Shot Chart Detail", GAME_ID=str(g["gid"]), GAME_EVENT_ID=sh["seq"],
                    PLAYER_ID=pid, PLAYER_NAME=self.t.names.get(pid, ""), TEAM_ID=self._team_id(sh["team"]),
                    TEAM_NAME=sh["team"], PERIOD=sh["period"], MINUTES_REMAINING=int(rem // 60),
                    SECONDS_REMAINING=int(rem % 60), EVENT_TYPE="Made Shot" if sh["made"] else "Missed Shot",
                    ACTION_TYPE=_nba_action(sh["action"]), SHOT_TYPE="3PT Field Goal" if sh["three"] else "2PT Field Goal",
                    SHOT_ZONE_BASIC=_zone(lx, ly, sh["three"]), SHOT_DISTANCE=dist if dist is not None else 0,
                    LOC_X=lx, LOC_Y=ly, SHOT_ATTEMPTED_FLAG=1, SHOT_MADE_FLAG=int(sh["made"]),
                    GAME_DATE=g["date"].replace("-", ""), HTM=g["home"], VTM=g["away"]))
        df = pd.DataFrame(rows)
        self.memo["shots"] = df
        return df

    def b_ShotChartDetail(self, params, frames):
        df = self.shot_rows()
        tid = int(params.get("team_id") or 0)
        if tid and len(df):
            df = df[df.TEAM_ID == tid]
        pid = int(params.get("player_id") or 0)
        if pid and len(df):
            df = df[df.PLAYER_ID == pid]
        return {fr: (df if fr == 0 else pd.DataFrame()) for fr in frames}

    def b_LeagueDashTeamShotLocations(self, params, frames):
        df = self.shot_rows()
        m = _measure(params)
        zones = ["Restricted Area", "In The Paint (Non-RA)", "Mid-Range", "Left Corner 3",
                 "Right Corner 3", "Above the Break 3", "Backcourt", "Corner 3"]
        recs = {}
        for team in self.t.team_ids:
            tid = self._team_id(team)
            if m == "Opponent":
                gids = set(self.t.team_games().query("TEAM == @team").GAME_ID)
                sub = df[(df.GAME_ID.isin(gids)) & (df.TEAM_ID != tid)] if len(df) else df
            else:
                sub = df[df.TEAM_ID == tid] if len(df) else df
            r = {("", "TEAM_ID"): tid, ("", "TEAM_NAME"): team}
            for z in zones:
                zz = sub[sub.SHOT_ZONE_BASIC.isin(["Left Corner 3", "Right Corner 3"])] if z == "Corner 3" \
                    else sub[sub.SHOT_ZONE_BASIC == z]
                fga, fgm = len(zz), int(zz.SHOT_MADE_FLAG.sum()) if len(zz) else 0
                pre = "OPP_" if m == "Opponent" else ""
                r[(z, pre + "FGM")] = fgm
                r[(z, pre + "FGA")] = fga
                r[(z, pre + "FG_PCT")] = round(T.safe_div(fgm, fga), 3)
            recs[team] = r
        out = pd.DataFrame(list(recs.values()))
        out.columns = pd.MultiIndex.from_tuples(out.columns)
        return {fr: out for fr in frames}

    # ---------------- lineups ----------------
    def lineup_units(self, team, n):
        key = ("lineups", team, n)
        if key in self.memo:
            return self.memo[key]
        from itertools import combinations
        units = {}
        for x in self.t.parsed:
            g = x["g"]
            if team not in (g["home"], g["away"]):
                continue
            o = g["away"] if team == g["home"] else g["home"]
            gid = str(g["gid"])
            for s in x["stints"]:
                five = [self.t.idmap.get(str(a)) for a in s.on.get(team, ())]
                if None in five or len(five) != 5:
                    continue
                for combo in (combinations(sorted(five), n) if n < 5 else [tuple(sorted(five))]):
                    u = units.get(combo)
                    if u is None:
                        u = units[combo] = {"sec": 0.0, "team": T.Tally(), "opp": T.Tally(), "g": set()}
                    u["sec"] += s.seconds
                    u["team"].add(s.t[team])
                    u["opp"].add(s.t[o])
                    if s.seconds > 0:
                        u["g"].add(gid)
        self.memo[key] = units
        return units

    def b_LeagueDashLineups(self, params, frames):
        team = self._abbr(params.get("team_id_nullable"))
        n = int(params.get("group_quantity", 5))
        m = _measure(params)
        rows = []
        for combo, u in self.lineup_units(team, n).items():
            tm, op = u["team"], u["opp"]
            mins = u["sec"] / 60.0
            if mins <= 0:
                continue
            gid = "-" + "-".join(str(p) for p in combo) + "-"
            name = " - ".join(_short(self.t.names.get(p, str(p))) for p in combo)
            row = dict(GROUP_SET="Lineups", GROUP_ID=gid, GROUP_NAME=name, TEAM_ID=self._team_id(team),
                       TEAM_ABBREVIATION=team, GP=len(u["g"]), MIN=round(mins, 2))
            if m == "Advanced":
                row.update(POSS=tm["poss_any"],
                           OFF_RATING=round(100 * T.safe_div(tm["pts"], tm["poss_any"]), 1),
                           DEF_RATING=round(100 * T.safe_div(op["pts"], op["poss_any"]), 1),
                           PACE=round(48 * T.safe_div((tm["poss_any"] + op["poss_any"]) / 2, mins), 2),
                           EFG_PCT=round(T.safe_div(tm["fgm"] + 0.5 * tm["fg3m"], tm["fga"]), 3),
                           TM_TOV_PCT=round(T.safe_div(tm["tov"], tm["poss_any"]), 3),
                           OREB_PCT=round(T.safe_div(tm["oreb"], tm["oreb"] + op["dreb"]), 3),
                           TS_PCT=round(T.safe_div(tm["pts"], 2 * (tm["fga"] + 0.44 * tm["fta"])), 3))
                row["NET_RATING"] = round(row["OFF_RATING"] - row["DEF_RATING"], 1)
            elif m == "Opponent":
                row.update(OPP_FGM=op["fgm"], OPP_FGA=op["fga"], OPP_FG3M=op["fg3m"], OPP_FG3A=op["fg3a"],
                           OPP_FTM=op["ftm"], OPP_FTA=op["fta"], OPP_PTS=op["pts"])
            rows.append(row)
        df = pd.DataFrame(rows)
        return {fr: df for fr in frames}

    # ---------------- schedule / index / bio ----------------
    def b_ScheduleLeagueV2(self, params, frames):
        sched = getattr(self.t, "schedule", None)
        if sched is None:
            raise NotInCloud("schedule not loaded")
        return {fr: sched for fr in frames}

    def b_PlayerIndex(self, params, frames):
        df = getattr(self.t, "player_index", None)
        if df is None:
            raise NotInCloud("player index not built")
        if not params.get("historical_nullable"):
            # The NBA's default PlayerIndex is today's rosters only.
            df = df[df.ROSTER_STATUS == 1].assign(STATS_TIMEFRAME="Season")
        return {fr: df for fr in frames}

    def b_LeagueDashPlayerBioStats(self, params, frames):
        df = getattr(self.t, "bio", None)
        if df is None:
            raise NotInCloud("bio not built")
        return {fr: df for fr in frames}


def _short(name):
    parts = str(name).split(" ", 1)
    return f"{parts[0][:1]}. {parts[1]}" if len(parts) == 2 else name


def _zone(lx, ly, three):
    if lx is None:
        return "Mid-Range" if not three else "Above the Break 3"
    if three:
        if ly is not None and ly <= 92.5 and abs(lx) >= 220:
            return "Left Corner 3" if lx < 0 else "Right Corner 3"
        if ly is not None and ly > 400:
            return "Backcourt"
        return "Above the Break 3"
    d = (lx ** 2 + ly ** 2) ** 0.5
    if d <= 40:
        return "Restricted Area"
    if abs(lx) <= 80 and ly <= 142.5:
        return "In The Paint (Non-RA)"
    return "Mid-Range"


def _nba_action(espn_type):
    """ESPN's shot description in the NBA's ACTION_TYPE spelling."""
    s = (espn_type or "").strip()
    fix = {
        "Pullup Jump Shot": "Pullup Jump shot", "Step Back Jump Shot": "Step Back Jump shot",
        "Driving Finger Roll Layup": "Driving Finger Roll Layup Shot",
        "Fade Away Jump Shot": "Fadeaway Jump Shot", "Layup Shot Putback": "Putback Layup Shot",
        "Tip Shot": "Tip Layup Shot", "Running Pullup Jump Shot": "Running Pull-Up Jump Shot",
        "Turnaround Fade Away Jump Shot": "Turnaround Fadeaway shot", "Floating Jump Shot": "Floating Jump shot",
        "Layup Driving Reverse": "Driving Reverse Layup Shot",
        "Running Finger Roll Layup": "Running Finger Roll Layup Shot", "Alley Oop Layup Shot": "Alley Oop Layup shot",
        "Pullup Bank Jump Shot": "Pullup Jump shot", "Driving Jump Shot Bank": "Driving Floating Bank Jump Shot",
        "Hook Driving Bank": "Driving Bank Hook Shot", "Turnaround Bank Jump Shot": "Turnaround Bank shot",
        "Jump Shot Bank": "Jump Bank Shot", "Layup Running Reverse": "Running Reverse Layup Shot",
        "Fade Away Bank Jump Shot": "Fadeaway Bank shot", "Hook Turnaround Bank": "Turnaround Bank Hook Shot",
        "Hook Shot Bank": "Hook Bank Shot", "Finger Roll Layup": "Finger Roll Layup Shot",
        "Turnaround Fadeaway Bank Jump Shot": "Turnaround Fadeaway Bank Jump Shot",
        "No Shot (Default Shot)": "Jump Shot",
    }
    return fix.get(s, s)


def install(season, tables, seed_dir, tracking_dir=None):
    shim = Shim(season, tables, seed_dir, tracking_dir=tracking_dir)

    def call(EndpointClass, params, frame=0, use_cache=True):
        return shim.frames(EndpointClass.__name__, params, [frame])[frame]

    def call_frames(EndpointClass, params, frames, use_cache=True):
        return shim.frames(EndpointClass.__name__, params, list(frames))

    E.call, E.call_frames = call, call_frames
    return shim
