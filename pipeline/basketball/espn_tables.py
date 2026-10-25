"""
espn_tables.py — rebuild the NBA's own stat tables from ESPN box scores and play-by-play.

The engine asks for tables by nba_api endpoint name and parameters (savant_engine.call). For
the season in progress the cloud refresh answers those requests from here instead of
stats.nba.com, with the same column names, so nothing downstream changes.

What can be rebuilt (everything that is counted from a box score or the play-by-play):
    LeagueDashPlayerStats   Base / Advanced / Scoring, Totals, any LastNGames
    LeagueDashTeamStats     Base / Advanced / Opponent / Four Factors, Totals
    LeagueGameLog (teams), PlayerGameLogs
    TeamPlayerOnOffSummary, TeamPlayerOnOffDetails (Advanced / Opponent)
    LeagueDashLineups       5- and 2-man units, Advanced / Opponent, per team
    ShotChartDetail         per team, with the NBA's LOC_X / LOC_Y units
    LeagueDashTeamShotLocations  By Zone, Base / Opponent
What can't (the NBA's camera tracking, Synergy and hustle charting have no public twin):
    LeagueDashPtStats, LeagueDashPlayerPtShot, LeagueDashPtDefend, LeagueHustleStatsPlayer,
    GravityLeaders, SynergyPlayTypes, LeagueSeasonMatchups — see espn_shim.UNAVAILABLE.

Lineups are reconstructed from substitutions: the five who start each period are the players
whose first appearance in that period is anything but entering the game, topped up from the
five who ended the previous period. Every possession, stat and second is credited to the units
on the floor when it happened.
"""
import math
import re
from collections import defaultdict

import pandas as pd

from espn_source import nba_abbr  # noqa: F401  (re-exported for the shim)

# End of a period: does a possession that hadn't produced a shot, free throw or turnover yet
# count? The NBA counts it (checked against its own team possessions, 2026-27).
END_PERIOD_COUNTS_IDLE = True
IDLE_MIN_SECONDS = 4.0

PERIOD_SECONDS = lambda p: 720.0 if p <= 4 else 300.0  # noqa: E731

# ESPN play type ids
FT_IDS = {97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 157, 165, 166}
FT_TECH_IDS = {103}
# The free throws after which the ball changes hands if the last one is made.
FT_LAST = {97: True, 99: True, 102: True}
# Flagrant and clear-path free throws: the shooting team keeps the ball afterwards.
FT_KEEP_BALL = {104, 105, 106, 107, 108, 157, 165, 166}
OREB_ID, DREB_ID = 156, 155
OFFENSIVE_FOUL_IDS = {42, 24}   # "Offensive Foul", "Offensive Charge" (the turnover is logged separately)
SUB_ID = 584
JUMPBALL_ID = 615
END_PERIOD_IDS = {412, 402}


def is_turnover(tid):
    return tid is not None and 62 <= int(tid) <= 90


# End-of-quarter heaves: logged by ESPN, but not field-goal attempts in the NBA's books
# (they don't count against a shooter since 2025-26), so they are left out entirely.
HEAVE_IDS = {282}


def is_heave(p):
    return int(p["tid"] or 0) in HEAVE_IDS and not p["scoring"]


def is_fg(p):
    return p["shooting"] and int(p["tid"] or 0) not in FT_IDS and not is_heave(p)


def is_ft(p):
    return int(p["tid"] or 0) in FT_IDS


def shot_distance(text):
    m = re.search(r"(\d+)-foot", text or "")
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------------------
# One game: lineups, stints, possessions, shots
# --------------------------------------------------------------------------------------
class Tally(dict):
    """Counting stats for one side over a stretch of play."""
    KEYS = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov",
            "stl", "blk", "pf", "poss", "poss_any", "fga_paint", "fgm_paint", "ofoul", "heave")

    def __init__(self):
        super().__init__({k: 0.0 for k in self.KEYS})

    def add(self, other, sign=1.0):
        for k in self.KEYS:
            self[k] += sign * other[k]


class Stint:
    __slots__ = ("period", "start", "end", "on", "t")

    def __init__(self, period, start, on):
        self.period, self.start, self.end = period, start, start
        self.on = {t: frozenset(s) for t, s in on.items()}   # team -> five espn ids
        self.t = {t: Tally() for t in on}                     # team -> tally (that team's offense/stats)

    @property
    def seconds(self):
        return max(0.0, self.start - self.end)


def _starters_for_period(plays, period, team_of, prev_end, box_starters):
    """The five each team started the period with."""
    first = {}  # espn id -> "in" | "other"
    for p in plays:
        if p["period"] != period:
            continue
        ids = [a for a in p["ath"] if a in team_of]
        if int(p["tid"] or 0) == SUB_ID and len(ids) >= 2:
            first.setdefault(ids[0], "in")
            first.setdefault(ids[1], "other")
        elif int(p["tid"] or 0) == JUMPBALL_ID:
            for a in ids[:2]:   # the two jumpers are on the floor; the tip-receiver is too
                first.setdefault(a, "other")
            for a in ids[2:]:
                first.setdefault(a, "other")
        else:
            for a in ids:
                first.setdefault(a, "other")
    out = {}
    for team in prev_end:
        if period == 1 and len(box_starters.get(team, ())) == 5:
            out[team] = set(box_starters[team])
            continue
        cand = [a for a, k in first.items() if k == "other" and team_of[a] == team]
        five = list(dict.fromkeys(cand))[:5]
        if len(five) < 5:
            for a in prev_end[team]:
                if a not in five and first.get(a) != "in":
                    five.append(a)
                if len(five) == 5:
                    break
        out[team] = set(five[:5])
    return out


def parse_game(g):
    """Stints, per-player seconds and possessions, and shots for one normalized ESPN game.

    Possessions are counted twice over, the way the NBA does:
      * once per team (`Tally["poss"]`, credited to the stint the possession ends in), which
        adds up to the team's possessions;
      * once per player and per unit: a possession counts for every player, and every lineup,
        that was on the floor for any part of it (`pcred`, `Tally["poss_any"]`). A substitution
        in the middle of a possession credits both sides of it, which is why the NBA's player
        possessions add up to a little more than five times the team's.
    """
    home, away = g["home"], g["away"]
    teams = (home, away)
    opp = {home: away, away: home}
    team_of = {p["eid"]: p["team"] for p in g["players"]}
    box_starters = defaultdict(list)
    for p in g["players"]:
        if p["starter"]:
            box_starters[p["team"]].append(p["eid"])
    # Chronological order. ESPN's sequence numbers are mostly in order, but late corrections
    # (often substitutions) are appended with a higher sequence number and an earlier clock.
    # Sort by period and clock; the sort is stable, so events at the same clock keep their
    # logged order (a substitution between two free throws stays between them).
    plays = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
    periods = sorted({p["period"] for p in plays})

    stints, shots = [], []
    pcred = defaultdict(lambda: [0.0, 0.0])      # espn id -> [offensive poss, defensive poss]
    ptal = defaultdict(lambda: {"team": Tally(), "opp": Tally()})   # by possession (see _flush)
    pall = defaultdict(lambda: [0.0, 0.0])       # possessions he was on the floor for throughout
    prev_end = {t: set(box_starters.get(t, [])) for t in teams}
    for period in periods:
        on = {t: set(v) for t, v in _starters_for_period(plays, period, team_of, prev_end, box_starters).items()}
        cur = Stint(period, PERIOD_SECONDS(period), on)
        stints.append(cur)
        # in_poss / stints: who (and which units) were on the floor at some event of the
        # possession in progress. Filled at events, not at substitutions, so a player subbed
        # out at a dead ball before anything happened gets no credit for it.
        st = {"offense": None, "open": False, "last_end": PERIOD_SECONDS(period),
              "in_poss": {t: set() for t in teams}, "stints": [], "undo": None,
              "buf": {t: Tally() for t in teams}, "in_all": {t: None for t in teams}}

        def touch(st=st):
            c = stints[-1]
            for t in teams:
                st["in_poss"][t] |= c.on[t]
                st["in_all"][t] = set(c.on[t]) if st["in_all"][t] is None else (st["in_all"][t] & c.on[t])
            if not st["stints"] or st["stints"][-1] is not c:
                st["stints"].append(c)

        def end_possession(team, clock, st=st):
            """`team`'s possession ends now."""
            other = opp[team]
            touch()
            nonlocal_cur = st["stints"][-1]
            nonlocal_cur.t[team]["poss"] += 1
            rec = {"team": team, "stint": nonlocal_cur, "players": {t: set(v) for t, v in st["in_poss"].items()},
                   "stints": list(dict.fromkeys(st["stints"]))}
            for a in rec["players"][team]:
                pcred[a][0] += 1
            for a in rec["players"][other]:
                pcred[a][1] += 1
            rec["all"] = {t: set(st["in_all"][t] or ()) for t in teams}
            for a in rec["all"][team]:
                pall[a][0] += 1
            for a in rec["all"][other]:
                pall[a][1] += 1
            for s_ in rec["stints"]:
                s_.t[team]["poss_any"] += 1
            _flush(st, rec["players"])
            st["undo"] = rec
            st["last_end"] = clock
            st["offense"] = other
            st["open"] = False
            st["in_poss"] = {t: set() for t in teams}
            st["in_all"] = {t: None for t in teams}
            st["stints"] = []

        def undo_end(st=st):
            """An and-one: the make didn't end the possession after all."""
            rec = st["undo"]
            if not rec:
                return
            team = rec["team"]
            rec["stint"].t[team]["poss"] -= 1
            for a in rec["players"][team]:
                pcred[a][0] -= 1
            for a in rec["players"][opp[team]]:
                pcred[a][1] -= 1
            for a in rec["all"][team]:
                pall[a][0] -= 1
            for a in rec["all"][opp[team]]:
                pall[a][1] -= 1
            for s_ in rec["stints"]:
                s_.t[team]["poss_any"] -= 1
            for t in teams:
                st["in_poss"][t] |= rec["players"][t]
                st["in_all"][t] = rec["all"][t] if st["in_all"][t] is None else (st["in_all"][t] & rec["all"][t])
            st["stints"] = list(dict.fromkeys(rec["stints"] + st["stints"]))
            st["offense"] = team
            st["open"] = True
            st["undo"] = None

        pending_and1 = None
        ft_nonfinal_miss = False
        # Running position of the last flush: everything in stints[k:] beyond `base` (the
        # k-th stint's tallies at that moment) has not been credited to anyone yet.
        snap = {"k": len(stints) - 1, "base": {t: Tally() for t in teams}}

        def _flush(st, players, snap=snap):
            """Credit everything since the last flush to every player on the floor for it."""
            k = snap["k"]
            for t in teams:
                delta = Tally()
                for s_ in stints[k:]:
                    delta.add(s_.t[t])
                delta.add(snap["base"][t], -1)
                for a in players[t]:
                    ptal[a]["team"].add(delta)
                for a in players[opp[t]]:
                    ptal[a]["opp"].add(delta)
            snap["k"] = len(stints) - 1
            snap["base"] = {t: _copy(stints[-1].t[t]) for t in teams}

        for p in (x for x in plays if x["period"] == period):
            tid = int(p["tid"] or 0)
            clock = p["clock"]
            team = p["team"]
            if tid == SUB_ID:
                ids = [a for a in p["ath"] if a in team_of]
                if len(ids) >= 2 and team in on:
                    tin, tout = ids[0], ids[1]
                    if tout in on[team] or tin not in on[team]:
                        on = {t: set(v) for t, v in on.items()}
                        on[team].discard(tout)
                        on[team].add(tin)
                        if len(on[team]) > 5:
                            on[team] = set(list(on[team])[:5])
                        cur.end = clock
                        cur = Stint(period, clock, on)
                        stints.append(cur)
                continue
            cur.end = clock
            if tid not in END_PERIOD_IDS and team in teams:
                touch()
            if is_heave(p):
                if team in teams:
                    cur.t[team]["heave"] += 1
                continue
            if tid in END_PERIOD_IDS:
                off = st["offense"]
                if off and (st["open"] or (END_PERIOD_COUNTS_IDLE and st["last_end"] > IDLE_MIN_SECONDS)):
                    end_possession(off, clock)
                continue
            if team not in teams:
                continue
            t = cur.t[team]
            other = opp[team]
            ath = p["ath"]
            if is_fg(p):
                three = (p["pts_att"] or 0) == 3
                made = p["scoring"]
                paint = _in_paint(p)
                t["fga"] += 1
                t["fg3a"] += three
                t["fga_paint"] += paint
                assisted = None
                if made:
                    t["fgm"] += 1
                    t["fg3m"] += three
                    t["pts"] += p["value"] or (3 if three else 2)
                    t["fgm_paint"] += paint
                    if len(ath) > 1 and team_of.get(ath[1]) == team:
                        t["ast"] += 1
                        assisted = ath[1]
                    st["offense"] = team
                    end_possession(team, clock)
                    pending_and1 = (team, clock)
                else:
                    blocker = next((a for a in ath[1:] if team_of.get(a) == other), None)
                    if blocker:
                        cur.t[other]["blk"] += 1
                    st["offense"] = team
                    st["open"] = True
                    pending_and1 = None
                ft_nonfinal_miss = False
                shots.append({"eid": ath[0] if ath else None, "team": team, "period": period, "clock": clock,
                              "made": bool(made), "three": three, "dist": shot_distance(p["text"]),
                              "x": p["x"], "y": p["y"], "action": p["type"], "seq": p["seq"],
                              "assisted": assisted, "paint": paint})
            elif is_ft(p):
                made = p["scoring"]
                t["fta"] += 1
                if made:
                    t["ftm"] += 1
                    t["pts"] += 1
                if tid in FT_TECH_IDS:
                    continue
                if tid == 97 and pending_and1 and pending_and1[0] == team and abs(pending_and1[1] - clock) < 0.01:
                    undo_end()
                pending_and1 = None
                if tid in FT_KEEP_BALL:
                    st["offense"], st["open"] = team, True
                    ft_nonfinal_miss = False
                elif FT_LAST.get(tid, False):
                    ft_nonfinal_miss = False
                    st["offense"] = team
                    if made:
                        end_possession(team, clock)
                    else:
                        st["open"] = True
                else:
                    st["offense"], st["open"] = team, True
                    ft_nonfinal_miss = not made
            elif tid == OREB_ID:
                if ft_nonfinal_miss:          # dead-ball team rebound between free throws
                    ft_nonfinal_miss = False
                    continue
                t["oreb"] += 1
                st["offense"], st["open"] = team, True
            elif tid == DREB_ID:
                if ft_nonfinal_miss:
                    ft_nonfinal_miss = False
                    continue
                t["dreb"] += 1
                pending_and1 = None
                if st["offense"] == other:
                    end_possession(other, clock)
                st["offense"] = team
            elif is_turnover(tid):
                t["tov"] += 1
                stealer = next((a for a in ath[1:] if team_of.get(a) == other), None)
                if stealer:
                    cur.t[other]["stl"] += 1
                pending_and1 = None
                st["offense"] = team
                end_possession(team, clock)
            elif tid == JUMPBALL_ID:
                st["offense"], st["open"] = team, False
            else:
                if "foul" in (p["type"] or "").lower() and ath and team_of.get(ath[0]) == team:
                    t["pf"] += 1
                if tid in OFFENSIVE_FOUL_IDS:
                    t["ofoul"] += 1
        cur.end = 0.0
        # whatever is left at the end of the period goes to whoever was on the floor for it
        touch()
        _flush(st, st["in_poss"])
        prev_end = {k: set(v) for k, v in on.items()}

    sec = defaultdict(float)
    for s in stints:
        for team, five in s.on.items():
            for a in five:
                sec[a] += s.seconds
    return {"stints": stints, "shots": shots, "seconds": dict(sec), "team_of": team_of,
            "pcred": {k: tuple(v) for k, v in pcred.items()}, "ptal": dict(ptal),
            "pall": {k: tuple(v) for k, v in pall.items()}}


def _copy(t):
    c = Tally()
    c.add(t)
    return c


def _sum_tallies(stints, team):
    out = Tally()
    for s_ in stints:
        if team in s_.t:
            out.add(s_.t[team])
    return out


def _in_paint(p):
    """The NBA paint: 16 ft wide, 19 ft from the baseline. ESPN gives feet, x across the court
    (0-50, hoop at 25), y up the court from the baseline end of the hoop (see shot_xy)."""
    xy = shot_xy(p)
    if xy is None:
        d = shot_distance(p["text"])
        return 1 if (d is not None and d <= 8 and (p["pts_att"] or 0) == 2) else 0
    lx, ly = xy
    return 1 if (abs(lx) <= 80 and ly <= 142.5 and (p["pts_att"] or 0) == 2) else 0


# ESPN shot coordinates: feet, x 0-50 across the floor, y measured from the hoop end.
# Converted to the NBA's shot-chart units (tenths of a foot, hoop at 0,0, y up the floor).
ESPN_Y_OFFSET = 0.3   # ESPN rounds the depth up to a whole foot; 0.3 ft centres it on the NBA's LOC_Y (2026-27 check)


def shot_xy(p):
    x, y = p.get("x"), p.get("y")
    if x is None or y is None:
        return None
    return (x - 25.0) * 10.0, (y - ESPN_Y_OFFSET) * 10.0


# --------------------------------------------------------------------------------------
# The season: everything the shim needs, indexed by NBA ids
# --------------------------------------------------------------------------------------
class SeasonTables:
    def __init__(self, season, games, idmap, team_ids, names=None, log=print):
        """games: normalized ESPN games (espn_source). idmap: espn athlete id -> NBA person id.
        team_ids: NBA abbreviation -> NBA team id. names: NBA id -> display name."""
        self.season = season
        self.games = games
        self.idmap = idmap
        self.team_ids = team_ids
        self.names = names or {}
        self.log = log
        self.parsed = []
        self.unmapped = set()
        for g in games:
            pg = parse_game(g)
            pg["g"] = g
            self.parsed.append(pg)
        self._player_games = None

    # ---- ids ----
    def nid(self, eid):
        n = self.idmap.get(str(eid))
        if n is None:
            self.unmapped.add(str(eid))
        return n

    # ---- per player-game box ----
    def player_games(self):
        """One row per player per game played (seconds > 0 or any box stat)."""
        if self._player_games is not None:
            return self._player_games
        rows = []
        for pg in self.parsed:
            g = pg["g"]
            res = _result(g)
            for b in g["players"]:
                if b["dnp"]:
                    continue
                pid = self.nid(b["eid"])
                if pid is None:
                    continue
                secs = pg["seconds"].get(b["eid"], 0.0)
                mins = secs / 60.0 if secs > 0 else b["min"]
                if mins <= 0 and not any(b[k] for k in ("pts", "fga", "fta", "reb", "ast", "tov", "pf")):
                    continue
                team = b["team"]
                oppt = g["away"] if team == g["home"] else g["home"]
                rows.append(dict(
                    PLAYER_ID=pid, PLAYER_NAME=self.names.get(pid, b["name"]), ESPN_ID=b["eid"],
                    TEAM_ABBREVIATION=team, TEAM_ID=self.team_ids.get(team, 0), OPP=oppt,
                    GAME_ID=str(g["gid"]), GAME_DATE=g["date"], WL=res.get(team, ""),
                    HOME=team == g["home"], MIN=mins, FGM=b["fgm"], FGA=b["fga"], FG3M=b["fg3m"],
                    FG3A=b["fg3a"], FTM=b["ftm"], FTA=b["fta"], OREB=b["oreb"], DREB=b["dreb"],
                    REB=b["reb"], AST=b["ast"], TOV=b["tov"], STL=b["stl"], BLK=b["blk"],
                    PF=b["pf"], PTS=b["pts"], PLUS_MINUS=b["pm"]))
        df = pd.DataFrame(rows)
        if len(df):
            dd = (df[["PTS", "REB", "AST", "STL", "BLK"]] >= 10).sum(axis=1)
            df["DD2"] = (dd >= 2).astype(int)
            df["TD3"] = (dd >= 3).astype(int)
        self._player_games = df
        return df

    def team_games(self):
        """One row per team per game, with the team's and the opponent's tallies and seconds."""
        rows = []
        for pg in self.parsed:
            g = pg["g"]
            res = _result(g)
            tot = {t: Tally() for t in (g["home"], g["away"])}
            secs = 0.0
            for s in pg["stints"]:
                secs += s.seconds
                for t, tl in s.t.items():
                    tot[t].add(tl)
            # Box totals are authoritative for counting stats; the play-by-play supplies
            # possessions and the paint.
            box = defaultdict(lambda: defaultdict(float))
            for b in g["players"]:
                if b["dnp"]:
                    continue
                for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast",
                          "tov", "stl", "blk", "pf"):
                    box[b["team"]][k] += b[k]
            for t in (g["home"], g["away"]):
                o = g["away"] if t == g["home"] else g["home"]
                row = dict(TEAM=t, OPP=o, GAME_ID=str(g["gid"]), GAME_DATE=g["date"], WL=res.get(t, ""),
                           SECONDS=secs, POSS=tot[t]["poss"], OPP_POSS=tot[o]["poss"],
                           FGA_PAINT=tot[t]["fga_paint"], FGM_PAINT=tot[t]["fgm_paint"])
                for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast",
                          "tov", "stl", "blk", "pf"):
                    row[k.upper()] = box[t][k] if box[t] else tot[t][k]
                    row["OPP_" + k.upper()] = box[o][k] if box[o] else tot[o][k]
                # team turnovers (shot clock etc.) aren't in a player's box line
                row["TOV"] = max(row["TOV"], tot[t]["tov"])
                row["OPP_TOV"] = max(row["OPP_TOV"], tot[o]["tov"])
                rows.append(row)
        return pd.DataFrame(rows)

    # ---- window helpers ----
    def _window_games(self, last_n):
        """{team: set(game ids)} — the team's last N games (None = all)."""
        tg = self.team_games()
        out = {}
        for t, df in tg.groupby("TEAM"):
            ids = list(df.sort_values(["GAME_DATE", "GAME_ID"])["GAME_ID"])
            out[t] = set(ids if not last_n else ids[-int(last_n):])
        return out

    def _player_window(self, last_n):
        pgm = self.player_games()
        if not last_n or not len(pgm):
            return pgm
        # The player's own last N games.
        pgm = pgm.sort_values(["GAME_DATE", "GAME_ID"])
        return pgm.groupby("PLAYER_ID", group_keys=False).tail(int(last_n))

    # ---- on-court sums per player ----
    def oncourt(self, games_filter=None):
        """{(pid, team): {"sec", "team": Tally, "opp": Tally}} summed over stints."""
        acc = {}
        for pg in self.parsed:
            g = pg["g"]
            gid = str(g["gid"])
            for s in pg["stints"]:
                for team, five in s.on.items():
                    if games_filter is not None and gid not in games_filter.get(("*", None), set()) \
                            and gid not in games_filter.get(team, set()):
                        continue
                    o = g["away"] if team == g["home"] else g["home"]
                    for a in five:
                        pid = self.idmap.get(str(a))
                        if pid is None:
                            continue
                        k = (pid, team)
                        if k not in acc:
                            acc[k] = {"sec": 0.0, "team": Tally(), "opp": Tally(), "games": set()}
                        acc[k]["sec"] += s.seconds
                        acc[k]["team"].add(s.t[team])
                        acc[k]["opp"].add(s.t[o])
                        acc[k]["games"].add(gid)
        return acc

    def team_totals(self):
        tg = self.team_games()
        return tg


def _result(g):
    """{team: "W"/"L"} from the box totals."""
    pts = defaultdict(float)
    for b in g["players"]:
        if not b["dnp"]:
            pts[b["team"]] += b["pts"]
    h, a = g["home"], g["away"]
    if pts[h] == pts[a]:
        return {}
    return {h: "W" if pts[h] > pts[a] else "L", a: "W" if pts[a] > pts[h] else "L"}


def safe_div(a, b):
    return a / b if b else 0.0


def isnan(x):
    return x is None or (isinstance(x, float) and math.isnan(x))
