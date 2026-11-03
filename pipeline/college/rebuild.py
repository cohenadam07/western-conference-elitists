"""
rebuild.py — one college game: lineups, stints, possessions, garbage time, zones, transition,
putbacks and assists, from the normalized play-by-play.

    rebuild_game(g) -> {"rows": player-game rows, "team": team-game rows, "stints": [...],
                        "shots": [...], "gate": {...the game's own checks...}}

Why this is not espn_tables.parse_game. That parser reads the NBA's feed; the college feed differs
in every place it leans on:
  * one free-throw type (540) for every free throw, with no "1 of 2", so the last shot of a trip
    is found by looking ahead along the clock
  * one turnover type (598), and steals (607) and blocks (618) as their own events
  * substitutions are two events, one man each ("X subbing out", "Y subbing in")
  * "Deadball Team Rebound" (449), which means nothing for possession
  * 20-minute halves, 5-minute overtimes, and nobody logged at the start of a half

Possessions. A team's possession runs from when it gets the ball to a made basket, a defensive
rebound, a turnover, the last made free throw of a trip, or the end of the period. Whatever the
feed misses, one rule catches: a shot, free throw or turnover by the OTHER team closes the
possession in progress. Each possession counts once for the team (stints.poss) and once for every
player on the floor at any event of it (Basketball Savant's rule), so a man who subs out at a dead
ball before anything happens gets no credit.

Lineups. Two sources, one path. `lineups_from_subs` walks the substitutions (2025-26 on, and
ESPN's games from mid-February 2025). `join.py` writes the five on the floor per play from CBBD
for the two seasons before that, in g["fives"]. Everything below that reads only `on`.

Garbage time is Bill James's safe lead at the start of each possession, in seconds left in the
game: (lead - 3 ± 0.5)² > seconds left, +0.5 if the leader has the ball. Flagged possessions are
tallied separately: they stay in totals and leave the default percentiles.
"""
import math
from collections import defaultdict

SUB, JUMP, OREB, DREB, DEADREB, STEAL, BLOCK, FT = "584", "615", "586", "587", "449", "607", "618", "540"
TOV, PFOUL, TFOUL = "598", "519", "521"
END_IDS = {"412", "402"}
NON_ACTION = {"580", "579", "578", "216", "215"}  # timeouts, challenges
REG_SECONDS, OT_SECONDS = 1200.0, 300.0

# measure.py on 2025-26: the gap from a change of possession to the next shot peaks at 5 seconds and
# is back to the half-court level (about 4% a second) by 9.
TRANSITION_SECONDS = 8.0
PUTBACK_SECONDS = 4.0


def period_length(p):
    return REG_SECONDS if p <= 2 else OT_SECONDS


def seconds_left_in_game(period, clock):
    return clock + (REG_SECONDS if period == 1 else 0.0)


def is_garbage(lead, leader_has_ball, secs):
    """Bill James: lead - 3, ±0.5 for the ball, squared, against the seconds left."""
    if lead <= 0:
        return False
    v = lead - 3 + (0.5 if leader_has_ball else -0.5)
    return v > 0 and v * v > secs


# ---------------------------------------------------------------- shot geography
# ESPN: whole feet, x 0-50 across the floor, hoop at (25, 0), y up the floor, folded to one half.
ARC_2019 = 22.1458     # 22 ft 1.75 in, from 2019-20
CORNER_2019 = 21.6458  # 21 ft 7.75 in along the sideline
ARC_OLD = 20.75        # 20 ft 9 in before
CORNER_Y = 8.0         # measure.py: threes hold a median 23 ft across through y = 8, then follow the arc
RIM_FT = 4.0
LANE_HALF = 6.0        # the lane is 12 ft wide
LANE_TOP = 13.75       # free-throw line, from the hoop


def distance(x, y):
    if x is None or y is None:
        return None
    return math.hypot(x - 25.0, y)


def shot_family(p):
    t = (p["type"] or "").lower()
    txt = (p["text"] or "").lower()
    if "dunk" in t or "dunk" in txt:
        return "dunk"
    if "tip" in t or "tip" in txt:
        return "tip"
    if "layup" in t or "layup" in txt:
        return "layup"
    if "hook" in txt:
        return "hook"
    return "jumper"


def is_three(p):
    """From the play, never from geometry."""
    if p.get("pts_att") in (2, 3):
        return p["pts_att"] == 3
    if p.get("value") in (2, 3):
        return p["value"] == 3
    return "three point" in (p["text"] or "").lower()


def zone(three, fam, x, y):
    """rim / paint / mid / c3 / ab3, or None when a two has no location and no type to place it."""
    d = distance(x, y)
    if three:
        if d is None:
            return "ab3"
        return "c3" if y <= CORNER_Y else "ab3"
    if fam in ("dunk", "tip", "layup"):
        return "rim"
    if d is None:
        return None
    if d <= RIM_FT:
        return "rim"
    if abs(x - 25.0) <= LANE_HALF and y <= LANE_TOP:
        return "paint"
    return "mid"


# ---------------------------------------------------------------- lineups from substitutions
def _team_of(g):
    return {p["eid"]: p["team"] for p in g["players"]}


def _sub_kind(p):
    t = (p["text"] or "").lower()
    return "in" if "subbing in" in t else "out" if "subbing out" in t else None


ON_SURE, ON_LIKELY, UNSURE, OFF = 3, 2, 1, 0


def _status_runs(evs, n, was_on):
    """One man's period: his events [(index, kind)], kind in/out/act, -> [(from, to, level)] covering
    0..n. A man's own events pin down where he was. "in" means he was off before it and on after;
    "out" the reverse; an action means he was on. Two events that disagree ("in", then "in" again)
    mean a line the scorer never logged: the gap between them is UNSURE."""
    if not evs:
        return [(0, n, UNSURE if was_on else OFF)]
    runs = []
    k0, kind0 = evs[0]
    runs.append((0, k0, OFF if kind0 == "in" else ON_SURE if kind0 == "out" else ON_LIKELY))
    for (ka, a), (kb, b) in zip(evs, evs[1:]):
        if a in ("in", "act") and b in ("out", "act"):
            lvl = ON_SURE if (a == "in" or b == "out") else ON_LIKELY
        elif a == "out" and b == "in":
            lvl = OFF
        else:
            lvl = UNSURE
        runs.append((ka, kb, lvl))
        if a == "act":
            runs[-2] = runs[-2]
    kl, kind = evs[-1]
    runs.append((kl, n, OFF if kind == "out" else ON_SURE if kind == "in" else ON_LIKELY))
    return runs


def _sub_blocks(pp, team_of, team):
    """{play position: position its substitution takes effect}. One stoppage's changes count
    together, even with a free throw logged between them: when a block leaves the team a man up
    or down, it runs on to the next block at that clock."""
    place = {}
    i, n = 0, len(pp)
    while i < n:
        p = pp[i]
        if p["tid"] != SUB or not p["ath"] or team_of.get(p["ath"][0]) != team:
            i += 1
            continue
        clock = p["clock"]
        members, net, j = [], 0, i
        while j < n and pp[j]["clock"] == clock:
            q = pp[j]
            if q["tid"] == SUB and q["ath"] and team_of.get(q["ath"][0]) == team:
                members.append(j)
                net += 1 if _sub_kind(q) == "in" else -1
                if net == 0 and not (j + 1 < n and pp[j + 1]["tid"] == SUB):
                    j += 1
                    break
            j += 1
        for m in members:
            place[m] = i
        i = max(j, members[-1] + 1)
    return place


def lineups_from_subs(g, plays):
    """{play index i: {team id: frozenset of five}}. Each man's events bound where he was
    (_status_runs); at each play the five are the men most surely on, sure first, then likely,
    then unsure, and among equals the men already out there. `clean` counts the plays that needed
    no judgment: exactly five men at ON_SURE or ON_LIKELY."""
    team_of = _team_of(g)
    d1 = [t for t in (g["home"], g["away"]) if t not in g["non_d1"]]
    out = {}
    clean = total = 0
    prev = defaultdict(set)
    for p in g["players"]:
        if p["starter"]:
            prev[p["team"]].add(p["eid"])
    for period in sorted({p["period"] for p in plays if p["period"]}):
        pp = [p for p in plays if p["period"] == period]
        n = len(pp)
        cur = {}
        for t in d1:
            place = _sub_blocks(pp, team_of, t)
            evs = defaultdict(list)
            for k, p in enumerate(pp):
                if p["tid"] == SUB:
                    if p["ath"] and k in place:
                        evs[p["ath"][0]].append((place[k], _sub_kind(p) or "act"))
                    continue
                for a in p["ath"]:
                    if team_of.get(a) == t:
                        evs[a].append((k, "act"))
            men = set(evs) | prev[t]
            lv = {}
            for a in men:
                e = sorted(evs.get(a, ()), key=lambda x: x[0])
                arr = [0] * (n + 1)
                for a0, b0, lvl in _status_runs(e, n, a in prev[t]):
                    for k in range(a0, b0):
                        arr[k] = lvl
                for k, kind in e:
                    if kind == "act":
                        arr[k] = ON_SURE
                    elif kind == "in":
                        arr[k] = ON_SURE
                    elif kind == "out":
                        arr[k] = OFF
                lv[a] = arr
            five = set()
            seq = []
            for k in range(n):
                ranked = sorted((a for a in men if lv[a][k] > OFF), key=lambda a: (-lv[a][k], a not in five, a))
                pick = ranked[:5]
                firm = sum(1 for a in men if lv[a][k] >= ON_LIKELY)
                seq.append((set(pick), firm == 5))
                five = set(pick)
            cur[t] = seq
            prev[t] = set(seq[-1][0]) if seq else prev[t]
        for k, p in enumerate(pp):
            if p["tid"] not in NON_ACTION:
                total += len(d1)
                clean += sum(cur[t][k][1] for t in d1)
            out[p["i"]] = {t: frozenset(cur[t][k][0]) for t in d1}
    return out, {"fixes": total - clean, "seed_over": 0, "clean": clean / total if total else 0.0}


# ---------------------------------------------------------------- the game
COUNT = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf",
         "rim_a", "rim_m", "pnt_a", "pnt_m", "mid_a", "mid_m", "c3_a", "c3_m", "ab3_a", "ab3_m",
         "rim_ast", "mid_ast", "three_ast", "ast_rim", "ast_three", "dunk_a", "dunk_m",
         "tr_a", "tr_m", "tr_pts", "pb_a", "pb_m", "uast_m", "dist", "loc_a")
ON = ("poss", "pts", "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov", "stl", "blk", "ast")
ZKEY = {"rim": "rim", "paint": "pnt", "mid": "mid", "c3": "c3", "ab3": "ab3"}


def _zero(keys):
    return {k: 0.0 for k in keys}


class Row:
    __slots__ = ("sec", "c", "cg", "t", "o", "tg", "og", "poss_o", "poss_d", "poss_og", "poss_dg")

    def __init__(self):
        self.sec = 0.0
        self.c, self.cg = _zero(COUNT), _zero(COUNT)
        self.t, self.o, self.tg, self.og = _zero(ON), _zero(ON), _zero(ON), _zero(ON)
        self.poss_o = self.poss_d = self.poss_og = self.poss_dg = 0.0


def box_only(g, team_of):
    """A game with a box score and no play-by-play: it counts for box stats and nothing else."""
    home, away = g["home"], g["away"]
    opp = {home: away, away: home}
    keys = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf")
    tb = {t: _zero(keys) for t in (home, away)}
    rows = []
    for b in g["players"]:
        if b["dnp"] or b["team"] not in tb:
            continue
        for k in keys:
            tb[b["team"]][k] += b[k]
        if b["team"] not in g["non_d1"]:
            rows.append({"eid": b["eid"], "team": b["team"], "sec": 0.0, "min": b["min"], "starter": b["starter"], "box": {k: b[k] for k in keys},
                         "c": None, "cg": None, "t": None, "o": None, "tg": None, "og": None, "poss": [0, 0, 0, 0]})
    m = sum(b["min"] for b in g["players"] if b["team"] == home and not b["dnp"])
    ot = max(0, round((m - 200) / 25))
    team = [{"team": t, "opp": opp[t], "home": t == home, "pts": g["teams"][t]["score"], "opp_pts": g["teams"][opp[t]]["score"], "poss": 0.0, "opp_poss": 0.0, "poss_g": 0.0,
             "box": tb[t], "pbp": _zero(ON), "pbp_g": _zero(ON), "ot": ot} for t in (home, away)]
    return {"rows": rows, "team": team, "stints": [], "shots": [], "gate": {"gid": g["gid"], "plays": 0, "lineups": "none", "five": {}, "ot": ot, "score_ok": False, "box_players": 0, "box_match": 0, "players": 0, "minutes_off": 0, "fga": 0, "loc": 0, "fixes": 0}}


def rebuild_game(g):
    home, away = g["home"], g["away"]
    teams = (home, away)
    opp = {home: away, away: home}
    d1 = [t for t in teams if t not in g["non_d1"]]
    team_of = _team_of(g)
    # Chronological: period, then clock. The sort is stable, so one clock keeps logged order.
    plays = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
    if not plays:
        return box_only(g, team_of)

    if g.get("fives"):
        fives, lfix = {}, {"fixes": 0, "seed_over": 0}
        cur = {t: frozenset() for t in d1}
        for p in plays:
            f = g["fives"].get(p["pid"])
            if f:
                cur = {t: frozenset(f[t]) for t in d1 if t in f} or cur
            fives[p["i"]] = cur
        lsource = "cbbd"
    elif any(p["tid"] == SUB for p in plays):
        fives, lfix = lineups_from_subs(g, plays)
        lsource = "subs"
    else:
        fives, lfix, lsource = {}, {"fixes": 0, "seed_over": 0}, "none"
    have_lineups = bool(fives)

    # the last shot of a free-throw trip: no later free throw by that team before the clock moves
    last_ft = set()
    for i, p in enumerate(plays):
        if p["tid"] != FT:
            continue
        later = False
        for q in plays[i + 1:]:
            if q["period"] != p["period"] or q["clock"] < p["clock"]:
                break
            if q["tid"] == FT and q["team"] == p["team"]:
                later = True
                break
        if not later:
            last_ft.add(p["i"])
    # technical-foul free throws don't change possession: at a clock with a technical on the other side
    tech = defaultdict(int)
    for p in plays:
        if p["tid"] == TFOUL and p["team"] in teams:
            tech[(p["period"], p["clock"], opp[p["team"]])] += 1

    rows = defaultdict(Row)
    stints = []
    shots = []
    team_t = {t: _zero(ON) for t in teams}
    team_tg = {t: _zero(ON) for t in teams}
    team_gar = {t: 0.0 for t in teams}
    team_nongar_sec = 0.0
    gar_sec = 0.0

    five_events = {t: 0 for t in d1}
    events = 0
    act_in, act_all = 0, 0

    for period in sorted({p["period"] for p in plays}):
        pp = [p for p in plays if p["period"] == period]
        clock_prev = period_length(period)
        # possession state
        off, open_, in_poss, garbage, made_pending = None, False, {t: set() for t in teams}, False, None
        last_change, last_oreb = None, None      # (clock, team) of the last change of possession / offensive rebound
        stint = None

        def stint_for(on, g_flag):
            nonlocal stint
            key = (tuple(sorted(on.get(home, ()))), tuple(sorted(on.get(away, ()))), g_flag)
            if stint is None or stint["key"] != key:
                stint = {"key": key, "period": period, "start": clock_prev, "end": clock_prev, "t": {home: _zero(ON), away: _zero(ON)}, "g": g_flag}
                stints.append(stint)
            return stint

        def score_at(p):
            return (p.get("score_home") or 0), (p.get("score_away") or 0)

        def start_poss(team, p):
            nonlocal off, open_, garbage
            off, open_ = team, True
            h, a = score_at(p)
            lead = abs(h - a)
            leader = home if h > a else away if a > h else None
            garbage = is_garbage(lead, leader == team, seconds_left_in_game(period, p["clock"]))

        def tally(team, key, n=1.0):
            st = stint
            st["t"][team][key] += n
            (team_tg if garbage else team_t)[team][key] += n

        def credit(team, key, n=1.0):
            pass

        def close(p=None):
            nonlocal off, open_
            if off is None:
                return
            team, other = off, opp[off]
            tally(team, "poss")
            for a in in_poss[team]:
                r = rows[a]
                if garbage:
                    r.poss_og += 1
                else:
                    r.poss_o += 1
            for a in in_poss[other]:
                r = rows[a]
                if garbage:
                    r.poss_dg += 1
                else:
                    r.poss_d += 1
            in_poss[home], in_poss[away] = set(), set()
            off, open_ = None, False

        def box(a, key, n=1.0):
            if a is None:
                return
            r = rows[a]
            (r.cg if garbage else r.c)[key] += n

        def onfloor_add(team, key, n=1.0):
            """A team count, to every man on the floor: his on-court line."""
            cur = stint
            f = cur["key"][0] if team == home else cur["key"][1]
            o = cur["key"][1] if team == home else cur["key"][0]
            for a in f:
                r = rows[a]
                (r.tg if garbage else r.t)[key] += n
            for a in o:
                r = rows[a]
                (r.og if garbage else r.o)[key] += n

        def count(team, key, n=1.0):
            tally(team, key, n)
            onfloor_add(team, key, n)

        for p in pp:
            tid, clock, team = p["tid"], p["clock"], p["team"]
            on = fives.get(p["i"]) or {}
            if clock < clock_prev and stint is not None:
                dt_ = clock_prev - clock
                # time passes in the stint that was on the floor through it
                stint["end"] = clock
                for t in d1:
                    for a in (stint["key"][0] if t == home else stint["key"][1]):
                        rows[a].sec += dt_
                if stint["g"]:
                    gar_sec += dt_
                else:
                    team_nongar_sec += dt_
                clock_prev = clock
            if tid in END_IDS:
                continue

            # a made basket's possession ends at the next thing that isn't its and-one
            if made_pending is not None and tid not in (SUB, PFOUL, TFOUL) and tid not in NON_ACTION:
                t0, c0 = made_pending
                made_pending = None
                if not (tid == FT and team == t0 and clock == c0):
                    close(p)

            cur = stint_for(on, garbage)
            cur["end"] = clock
            if tid == SUB or tid in NON_ACTION:
                continue
            events += 1
            for t in d1:
                five_events[t] += len(on.get(t, ())) == 5
                in_poss[t] |= set(on.get(t, ()))
            act = [a for a in p["ath"] if team_of.get(a) in d1]
            act_all += len(act)
            act_in += sum(1 for a in act if a in on.get(team_of[a], ()))
            if team not in teams:
                continue
            other = opp[team]

            if p["shooting"] and tid != FT:
                if off != team:
                    if off is not None:
                        close(p)
                    start_poss(team, p)
                    cur = stint_for(on, garbage)
                three = is_three(p)
                made = p["scoring"]
                fam = shot_family(p)
                shooter = p["ath"][0] if p["ath"] else None
                ast = p["ath"][1] if made and len(p["ath"]) > 1 else None
                x, y = p["x"], p["y"]
                if x is not None and y is not None and x == 25 and y == 0 and not made and fam == "jumper":
                    x = y = None                     # ESPN's "no location" sits on the hoop
                z = zone(three, fam, x, y)
                d = distance(x, y)
                since = (last_change[0] - clock) if last_change and last_change[1] == team else None
                tr = since is not None and since <= TRANSITION_SECONDS
                pb = last_oreb is not None and last_oreb[1] == team and (last_oreb[0] - clock) <= PUTBACK_SECONDS
                count(team, "fga")
                count(team, "fg3a", float(three))
                box(shooter, "fga")
                box(shooter, "fg3a", float(three))
                if z:
                    box(shooter, ZKEY[z] + "_a")
                if d is not None:
                    box(shooter, "dist", d)
                    box(shooter, "loc_a")
                if fam == "dunk":
                    box(shooter, "dunk_a")
                if tr:
                    box(shooter, "tr_a")
                if pb:
                    box(shooter, "pb_a")
                if made:
                    v = 3 if three else 2
                    count(team, "fgm")
                    count(team, "fg3m", float(three))
                    count(team, "pts", v)
                    box(shooter, "fgm")
                    box(shooter, "fg3m", float(three))
                    box(shooter, "pts", v)
                    if z:
                        box(shooter, ZKEY[z] + "_m")
                    if fam == "dunk":
                        box(shooter, "dunk_m")
                    if tr:
                        box(shooter, "tr_m")
                        box(shooter, "tr_pts", v)
                    if pb:
                        box(shooter, "pb_m")
                    if ast and team_of.get(ast) == team:
                        count(team, "ast")
                        box(ast, "ast")
                        if z == "rim":
                            box(shooter, "rim_ast")
                            box(ast, "ast_rim")
                        elif z in ("c3", "ab3"):
                            box(shooter, "three_ast")
                            box(ast, "ast_three")
                        else:
                            box(shooter, "mid_ast")
                    else:
                        box(shooter, "uast_m")
                    made_pending = (team, clock)
                last_oreb = None
                shots.append({"eid": shooter, "team": team, "opp": other, "period": period, "clock": clock, "made": int(made),
                              "three": int(three), "x": x, "y": y, "dist": None if d is None else round(d, 1), "fam": fam, "zone": z,
                              "pb": int(pb), "tr": int(tr), "ast": ast if made else None, "g": int(garbage)})
            elif tid == FT:
                is_tech = tech.get((period, clock, team), 0) > 0
                if off != team and not is_tech:
                    if off is not None:
                        close(p)
                    start_poss(team, p)
                    cur = stint_for(on, garbage)
                elif off is None:
                    start_poss(team, p)
                    cur = stint_for(on, garbage)
                a = p["ath"][0] if p["ath"] else None
                count(team, "fta")
                box(a, "fta")
                if p["scoring"]:
                    count(team, "ftm")
                    count(team, "pts")
                    box(a, "ftm")
                    box(a, "pts")
                    if p["i"] in last_ft and not is_tech:
                        close(p)
                        last_change = (clock, other)
            elif tid == OREB:
                count(team, "oreb")
                if p["ath"]:
                    box(p["ath"][0], "oreb")
                last_oreb = (clock, team)
                if off is None:
                    start_poss(team, p)
            elif tid == DREB:
                if off == other:
                    close(p)
                count(team, "dreb")
                if p["ath"]:
                    box(p["ath"][0], "dreb")
                start_poss(team, p)
                cur = stint_for(on, garbage)
                last_change = (clock, team)
                last_oreb = None
            elif tid == DEADREB:
                pass
            elif tid == TOV:
                if off != team:
                    if off is not None:
                        close(p)
                    start_poss(team, p)
                    cur = stint_for(on, garbage)
                count(team, "tov")
                if p["ath"]:
                    box(p["ath"][0], "tov")
                close(p)
                last_change = (clock, other)
                last_oreb = None
            elif tid == STEAL:
                count(team, "stl")
                if p["ath"]:
                    box(p["ath"][0], "stl")
            elif tid == BLOCK:
                count(team, "blk")
                if p["ath"]:
                    box(p["ath"][0], "blk")
            elif tid == JUMP:
                pass
            elif "foul" in (p["type"] or "").lower():
                if p["ath"] and tid != TFOUL:
                    box(p["ath"][0], "pf")
        if made_pending is not None:
            close()
            made_pending = None
        if off is not None and open_:
            close()
        off = None
        # the end of the period: time left on the last stint
        if stint is not None and clock_prev > 0:
            for t in d1:
                for a in (stint["key"][0] if t == home else stint["key"][1]):
                    rows[a].sec += clock_prev
            stint["end"] = 0.0

    # -------- rows
    box_by = {p["eid"]: p for p in g["players"]}
    out = []
    for eid, b in box_by.items():
        if b["team"] in g["non_d1"]:
            continue
        r = rows.get(eid)
        if b["dnp"] and r is None:
            continue
        out.append({"eid": eid, "team": b["team"], "sec": 0.0 if r is None else round(r.sec, 1), "min": b["min"], "starter": b["starter"],
                    "box": {k: b[k] for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf")},
                    "c": None if r is None else r.c, "cg": None if r is None else r.cg, "t": None if r is None else r.t, "o": None if r is None else r.o,
                    "tg": None if r is None else r.tg, "og": None if r is None else r.og,
                    "poss": [0, 0, 0, 0] if r is None else [r.poss_o, r.poss_d, r.poss_og, r.poss_dg]})
    # team rows: the box's counts, the play-by-play's possessions
    tb = {t: _zero(("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf")) for t in teams}
    for b in g["players"]:
        if b["dnp"]:
            continue
        for k in tb[b["team"]]:
            tb[b["team"]][k] += b[k]
    team_rows = []
    for t in teams:
        o = opp[t]
        team_rows.append({"team": t, "opp": o, "home": t == home, "pts": g["teams"][t]["score"], "opp_pts": g["teams"][o]["score"],
                          "poss": team_t[t]["poss"] + team_tg[t]["poss"], "opp_poss": team_t[o]["poss"] + team_tg[o]["poss"],
                          "poss_g": team_tg[t]["poss"], "box": tb[t], "pbp": {k: team_t[t][k] + team_tg[t][k] for k in ON},
                          "pbp_g": team_tg[t], "ot": max(0, max(p["period"] for p in plays) - 2)})

    # stints for lineups and RAPM, one row per (h5, a5, garbage flag) stretch
    st_rows = []
    for s in stints:
        h5, a5, gf = s["key"]
        secs = s["start"] - s["end"]
        if secs <= 0 and not s["t"][home]["poss"] and not s["t"][away]["poss"]:
            continue
        ts = s["t"]
        st_rows.append([s["period"], s["start"], s["end"], list(h5), list(a5), int(gf)] + [ts[home][k] for k in ON] + [ts[away][k] for k in ON])

    # -------- the game's own checks
    ot = max(0, max(p["period"] for p in plays) - 2)
    expect = (2400.0 + 300.0 * ot)
    minutes_off, players_ck = 0, 0
    for r in out:
        if r["min"] or r["sec"]:
            players_ck += 1
            minutes_off += abs(r["sec"] / 60.0 - r["min"]) > 1.0
    five = {t: (five_events[t] / events if events else 0.0) for t in d1}
    box_match = 0
    box_total = 0
    for r in out:
        if r["c"] is None:
            continue
        box_total += 1
        got = {k: r["c"][k] + r["cg"][k] for k in r["box"]}
        box_match += all(got[k] == r["box"][k] for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"))
    formula = {}
    for t in teams:
        b = tb[t]
        formula[t] = b["fga"] - b["oreb"] + b["tov"] + 0.475 * b["fta"]
    gate = {"gid": g["gid"], "plays": len(plays), "lineups": lsource if have_lineups else "none", "five": five,
            "act_share": (act_in / act_all) if act_all else 0.0, "players": players_ck, "minutes_off": minutes_off,
            "box_players": box_total, "box_match": box_match, "fixes": lfix["fixes"], "clean": lfix.get("clean"),
            "ot": ot, "expect_sec": expect, "poss": {t: team_t[t]["poss"] + team_tg[t]["poss"] for t in teams}, "formula": formula,
            "fga": sum(1 for s in shots), "loc": sum(1 for s in shots if s["x"] is not None), "gar_sec": gar_sec,
            "score_ok": bool(plays and ((plays[-1].get("score_home") == g["teams"][home]["score"]) and (plays[-1].get("score_away") == g["teams"][away]["score"])))}
    return {"rows": out, "team": team_rows, "stints": st_rows, "shots": shots, "gate": gate}
