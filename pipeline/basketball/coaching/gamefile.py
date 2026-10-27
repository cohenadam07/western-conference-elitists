"""
gamefile.py — one ESPN game, read for a coach: who was on the floor every second, every
possession and what started it, every timeout, challenge, foul in trouble and late-game call,
each team's box line and shot diet by zone, and the game's own context (officials, venue,
betting line, win probability, garbage time).

    game(g) -> dict (see KEYS at the bottom), from a game normalized by espn_source and
               cached by espn_games (the `extra` block is this build's own)

Lineups and stints come from espn_tables.parse_game, the same parser the Basketball Savant
cloud refresh uses, so the seconds and possessions here reconcile with the player cards.
Possessions are counted again here on the same rules (a made shot, a defensive rebound, a
turnover or a made final free throw ends one), because this file needs to know what STARTED
each possession (a timeout, a steal, a defensive rebound, a made basket, a dead ball) and
what happened inside it, which parse_game has no reason to keep.

Definitions used by the modules (all configurable in CFG):
  timeout              type 16 (full), 17 (20-second), 581 (official, not charged to a coach)
  challenge            type 213 announces one; 214 (upheld), 215 (overturned), 216 (stands),
                       277 (sent to the replay centre) give the result. 2019-20 on.
  opponent run         unanswered opponent points since the team last scored, at the moment
                       of the timeout
  after-timeout        the first possession after a team's timeout, whoever has the ball
  foul trouble         2 fouls in the 1st quarter, 3 in the 1st half, 4 in the 3rd, 5 any time
  clutch               last five minutes of the 4th or overtime, margin within five
  garbage time         the rule in CFG["garbage"]: the first moment the lead is at least
                       20 with 6:00 left, 25 with 9:00 left, 30 any time in the 4th, or 15
                       with 2:00 left; it stays garbage time afterwards
  fouling up three     the defence leads by exactly three with 24 seconds or less in the 4th
                       or overtime and the offence has the ball: did it foul before a shot?
  two-for-one          a possession ended by a shot with 28 to 40 seconds left in a period
                       after which the same team had another possession in that period
"""
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import espn_tables as T  # noqa: E402
import teams as TM  # noqa: E402

NICKNAMES = {"Hawks": "ATL", "Celtics": "BOS", "Nets": "BKN", "Hornets": "CHA", "Bulls": "CHI", "Cavaliers": "CLE", "Mavericks": "DAL",
             "Nuggets": "DEN", "Pistons": "DET", "Warriors": "GSW", "Rockets": "HOU", "Pacers": "IND", "Clippers": "LAC", "Lakers": "LAL",
             "Grizzlies": "MEM", "Heat": "MIA", "Bucks": "MIL", "Timberwolves": "MIN", "Pelicans": "NOP", "Knicks": "NYK", "Thunder": "OKC",
             "Magic": "ORL", "76ers": "PHI", "Suns": "PHX", "Trail Blazers": "POR", "Kings": "SAC", "Spurs": "SAS", "Raptors": "TOR",
             "Jazz": "UTA", "Wizards": "WAS"}

CFG = {
    "garbage": [(20, 360), (25, 540), (30, 720), (15, 120)],   # (lead, seconds left in the 4th)
    "garbage_exit": 10,              # once in garbage time, a lead under this ends it
    "clutch_sec": 300, "clutch_margin": 5,
    "run_min": 6,                    # an opponent run worth a timeout decision starts here
    "ato_next": 5,                   # possessions counted after a timeout (each side)
    "two_for_one": (28.0, 40.0),
    "foul_up3_sec": 24.0,
    "late_sec": 120.0,               # "late game" for timeouts to advance the ball and chase fouls
}

TIMEOUT_FULL, TIMEOUT_SHORT, TIMEOUT_OFFICIAL = 16, 17, 581
CHALLENGE_CALL = 213
CHALLENGE_RESULT = {214: "supported", 215: "overturned", 216: "stands", 277: "replaycenter"}
REVIEW_IDS = {278, 279, 280}
SUB_ID, OREB_ID, DREB_ID, JUMP_ID, JUMP_OLD = 584, 156, 155, 615, 11
END_PERIOD = {412, 402}
FT_IDS = T.FT_IDS
FT_LAST = {97: True, 99: True, 102: True}
FT_KEEP = T.FT_KEEP_BALL
FT_TECH = {103}
SHOOTING_FOULS = {44, 21}
PERSONAL_FOULS = {21, 22, 23, 24, 32, 33, 36, 40, 42, 43, 44, 45, 257, 37}   # charged to a player; 29/35 are technicals
TECHNICALS = {35, 30}
FLAGRANT2 = {31}
TAKE_FOULS = {22, 257}
HEAVE = {282}


def period_len(p):
    return 720.0 if p <= 4 else 300.0


def abs_sec(period, clock):
    """Seconds elapsed since tip-off."""
    before = sum(period_len(q) for q in range(1, period))
    return before + (period_len(period) - clock)


def _turnover(tid):
    return 62 <= tid <= 90


def _fg(p, tid):
    return p["shooting"] and tid not in FT_IDS and tid not in HEAVE


ZONE_RA, ZONE_PAINT, ZONE_MID, ZONE_C3, ZONE_AB3 = "ra", "paint", "mid", "c3", "ab3"


def zone(p):
    """The NBA's five shot zones from ESPN's coordinates (T.shot_xy: tenths of a foot, hoop at 0,0)."""
    three = (p["pts_att"] or 0) == 3
    xy = T.shot_xy(p)
    if xy is None:
        d = T.shot_distance(p["text"])
        if three:
            return ZONE_C3 if (d is not None and d <= 22) else ZONE_AB3
        if d is None:
            return None
        return ZONE_RA if d <= 4 else ZONE_PAINT if d <= 10 else ZONE_MID
    x, y = xy
    if three:
        return ZONE_C3 if y <= 87.5 else ZONE_AB3
    dist = (x * x + y * y) ** 0.5
    if dist <= 40:
        return ZONE_RA
    if abs(x) <= 80 and y <= 142.5:
        return ZONE_PAINT
    return ZONE_MID


def game(g, cfg=CFG):
    home_e, away_e = g["home"], g["away"]
    home, away = TM.franchise(home_e), TM.franchise(away_e)
    side = {home_e: "h", away_e: "a"}
    opp_e = {home_e: away_e, away_e: home_e}
    team_of = {p["eid"]: p["team"] for p in g["players"]}
    parsed = T.parse_game(g)
    plays = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
    periods = max(p["period"] for p in plays) if plays else 4
    end_abs = abs_sec(periods, 0.0)

    # ---------------------------------------------------------------- who was on the floor when
    intervals = defaultdict(list)          # eid -> [[start_abs, end_abs], ...] merged
    stints_out = []
    for s in parsed["stints"]:
        if s.seconds <= 0:
            continue
        a0, a1 = abs_sec(s.period, s.start), abs_sec(s.period, s.end)
        for t, five in s.on.items():
            for e in five:
                iv = intervals[e]
                if iv and abs(iv[-1][1] - a0) < 1e-6:
                    iv[-1][1] = a1
                else:
                    iv.append([a0, a1])
        stints_out.append(s)

    def on_at(sec):
        """{side: set(eids)} on the floor at an absolute second (the stint covering it)."""
        for s in stints_out:
            a0, a1 = abs_sec(s.period, s.start), abs_sec(s.period, s.end)
            if a0 <= sec <= a1:
                return {side[t]: set(v) for t, v in s.on.items() if t in side}
        return {}

    # ---------------------------------------------------------------- the running game
    score = {home_e: 0, away_e: 0}
    margin_at = []                          # (abs_sec, home margin) after each scoring play, for garbage time and wp
    q_pts = {home_e: defaultdict(int), away_e: defaultdict(int)}
    q_poss = {home_e: defaultdict(int), away_e: defaultdict(int)}
    possessions = []                        # dicts: team, per, start(abs), end(abs), pts, start_kind, end_kind, ato(team that called)
    cur = None                              # the possession in progress
    offense = None
    pending_and1 = None
    ft_nonfinal_miss = False
    last_change = None                      # how the current possession started
    timeouts, challenges, reviews = [], [], 0
    runs = []                               # opponent runs at run_min: timeout or not, and what followed
    fouls = defaultdict(list)               # eid -> [(per, clock, abs, tid)]
    techs = defaultdict(int)
    last_score_by = {home_e: None, away_e: None}   # abs second of each team's last score
    unanswered = {home_e: 0, away_e: 0}     # points scored against each team since it last scored
    run_open = {home_e: None, away_e: None} # a run already recorded for this team at this size (avoid double counts)
    pending_to = []                         # timeouts waiting for their next possessions
    challenge_open = None
    team_box = {t: defaultdict(float) for t in (home_e, away_e)}
    diet = {t: {z: [0, 0] for z in (ZONE_RA, ZONE_PAINT, ZONE_MID, ZONE_C3, ZONE_AB3)} for t in (home_e, away_e)}
    trans = {t: [0, 0] for t in (home_e, away_e)}     # transition FGA/FGM (within 7s of a steal or defensive rebound)
    last_gain = {home_e: None, away_e: None}
    lead = {t: [0, 0, 0.0] for t in (home_e, away_e)}  # max lead, max deficit, seconds leading
    last_margin_abs = 0.0
    wp = dict(g.get("wp") or [])
    wp_line = []
    pq = defaultdict(lambda: defaultdict(int))     # eid -> period -> points
    first_sub = {home_e: None, away_e: None}
    starters = {t: set() for t in (home_e, away_e)}
    for p in g["players"]:
        if p.get("starter"):
            starters[p["team"]].add(p["eid"])

    def margin_view(team):
        return score[team] - score[opp_e[team]]

    def start_poss(team, per, sec, kind):
        nonlocal cur
        cur = {"team": team, "per": per, "start": sec, "end": None, "pts": 0, "kind": kind, "end_kind": None,
               "ato": None, "margin": margin_view(team), "fga": 0}
        for to in pending_to:
            if to["ato"] is None:
                to["ato"] = team
                cur["ato"] = to["team"]
        pending_to.clear()
        return cur

    def end_poss(sec, kind):
        nonlocal cur
        if cur is None:
            return None
        cur["end"], cur["end_kind"] = sec, kind
        possessions.append(cur)
        q_poss[cur["team"]][cur["per"]] += 1
        done, cur = cur, None
        return done

    def change(team, per, sec, end_kind, start_kind):
        """The ball changes hands: the possession in progress ends, `team`'s begins."""
        nonlocal offense
        end_poss(sec, end_kind)
        start_poss(team, per, sec, start_kind)
        offense = team

    def note_points(team, pts, sec, per):
        if pts <= 0:
            return
        other = opp_e[team]
        unanswered[other] += pts
        unanswered[team] = 0
        last_score_by[team] = sec
        if run_open[team] is not None:                 # the team scored: its run-against is over
            run_open[team]["final"] = run_open[team]["final_size"]
            run_open[team] = None
        if run_open[other] is not None:
            run_open[other]["final_size"] = unanswered[other]
        elif unanswered[other] >= cfg["run_min"]:
            run_open[other] = {"team": other, "per": per, "sec": sec, "size": unanswered[other], "final_size": unanswered[other], "margin": margin_view(other),
                               "timeout": False, "to_size": None, "to_sec": None, "poss_i": len(possessions)}
            runs.append(run_open[other])

    last_ended = None
    flips = 0
    for i, p in enumerate(plays):
        tid = int(p["tid"] or 0)
        per, clock, team = p["period"], p["clock"], p["team"]
        sec = abs_sec(per, clock)
        if i == 0 or plays[i - 1]["period"] != per:
            if cur is not None:
                end_poss(abs_sec(per, period_len(per)), "period")
            cur, offense = None, None
            pending_and1, ft_nonfinal_miss, last_ended = None, False, None
        # an and-one: the make did not end the possession after all
        if tid == 97 and pending_and1 and pending_and1[0] == team and abs(pending_and1[1] - clock) < 0.01 and last_ended is not None \
                and possessions and possessions[-1] is last_ended:
            possessions.pop()
            q_poss[last_ended["team"]][last_ended["per"]] -= 1
            last_ended["end"] = None
            cur, offense = last_ended, last_ended["team"]
            last_ended = None
        # score bookkeeping from ESPN's running score. A scoring play by a side that does not
        # hold the possession in progress (a stray sequence) hands it the ball first.
        sh, sa = p.get("score_home"), p.get("score_away")
        dh = da = 0
        if sh is not None and sa is not None:
            sh, sa = int(sh), int(sa)
            dh, da = sh - score[home_e], sa - score[away_e]
            if (dh or da) and team in side and tid not in FT_TECH and (_fg(p, tid) or tid in FT_IDS) and (cur is None or cur["team"] != team):
                flips += cur is not None
                change(team, per, sec, "flip", last_change or "dead")
            if dh or da:
                m0 = score[home_e] - score[away_e]
                if m0 > 0:
                    lead[home_e][2] += sec - last_margin_abs
                elif m0 < 0:
                    lead[away_e][2] += sec - last_margin_abs
                last_margin_abs = sec
                score[home_e], score[away_e] = sh, sa
                m = sh - sa
                margin_at.append((sec, m))
                lead[home_e][0] = max(lead[home_e][0], m); lead[home_e][1] = min(lead[home_e][1], m)
                lead[away_e][0] = max(lead[away_e][0], -m); lead[away_e][1] = min(lead[away_e][1], -m)
                for t, d in ((home_e, dh), (away_e, da)):
                    if d:
                        q_pts[t][per] += d
                        if cur is not None and cur["team"] == t:
                            cur["pts"] += d
                        note_points(t, d, sec, per)
        w = wp.get(p.get("pid"))
        if w is not None:
            wp_line.append((sec, w))

        if tid == SUB_ID:
            if team in first_sub and first_sub[team] is None:
                first_sub[team] = sec
            continue
        if tid in END_PERIOD:
            end_poss(sec, "period")
            offense = None
            continue
        if tid in (TIMEOUT_FULL, TIMEOUT_SHORT):
            if team in side:
                other = opp_e[team]
                has_ball = offense if offense in (home_e, away_e) else None
                late = per >= 4 and clock <= cfg["late_sec"]
                to = {"team": team, "per": per, "clock": clock, "sec": sec, "kind": "full" if tid == TIMEOUT_FULL else "short",
                      "margin": margin_view(team), "run": unanswered[team], "ball": ("own" if has_ball == team else "opp" if has_ball == other else None),
                      "late": late, "advance": bool(late and margin_view(team) <= 0 and has_ball == team and last_gain.get(team) and sec - last_gain[team][1] <= 3.0),
                      "ato": None, "poss_i": len(possessions), "pts_at": cur["pts"] if cur is not None else 0}
                timeouts.append(to)
                if cur is None:
                    pending_to.append(to)
                else:
                    to["ato"] = cur["team"]
                    cur["ato"] = team
                r = run_open.get(team)
                if r is not None and not r["timeout"]:
                    # the first timeout during a run against this team: the decision point moves here
                    r["timeout"], r["to_size"], r["to_sec"], r["poss_i"] = True, unanswered[team], sec, len(possessions)
            continue
        if tid == TIMEOUT_OFFICIAL:
            continue
        if tid == CHALLENGE_CALL or tid in CHALLENGE_RESULT or tid in REVIEW_IDS:
            txt = p["text"] or ""
            who = team if team in side else None
            if who is None:
                for nick, key in NICKNAMES.items():
                    if f"[{nick}]" in txt or txt.startswith(nick + " "):
                        who = next((t for t in (home_e, away_e) if TM.franchise(t) == key), None)
                        break
            if tid in REVIEW_IDS:
                reviews += 1
                continue
            if tid == CHALLENGE_CALL or challenge_open is None or challenge_open["result"] is not None:
                if tid == CHALLENGE_CALL or challenge_open is None or challenge_open["result"] is not None:
                    challenge_open = {"team": who, "per": per, "clock": clock, "sec": sec, "margin": margin_view(who) if who else None,
                                      "result": None, "text": txt[:120], "timeout_lost": None}
                    challenges.append(challenge_open)
            if tid in CHALLENGE_RESULT:
                res = CHALLENGE_RESULT[tid]
                if challenge_open["team"] is None and who:
                    challenge_open["team"] = who
                    challenge_open["margin"] = margin_view(who)
                if res != "replaycenter":
                    challenge_open["result"] = res
                    challenge_open["timeout_lost"] = "charged with a timeout" in txt.lower()
            continue
        if team not in side:
            continue
        other = opp_e[team]
        ath = p["ath"]
        actor = ath[0] if ath else None

        if _fg(p, tid):
            if cur is None or cur["team"] != team:
                flips += cur is not None
                change(team, per, sec, "flip", last_change or "dead")
            cur["fga"] += 1
            made = bool(p["scoring"])
            three = (p["pts_att"] or 0) == 3
            z = zone(p)
            b = team_box[team]
            b["fga"] += 1; b["fgm"] += made; b["fg3a"] += three; b["fg3m"] += made and three
            if z:
                diet[team][z][0] += 1
                diet[team][z][1] += made
            lg = last_gain.get(team)
            if lg and lg[0] in ("stl", "dreb") and lg[2] == per and (sec - lg[1]) <= 7.0:
                trans[team][0] += 1
                trans[team][1] += made
            if made:
                if actor:
                    pq[actor][per] += int(p["value"] or (3 if three else 2))
                if len(ath) > 1 and team_of.get(ath[1]) == team:
                    b["ast"] += 1
                last_ended = end_poss(sec, "make")
                start_poss(other, per, sec, "make")
                offense = other
                last_change = "make"
                last_gain[other] = ("make", sec, per)
                pending_and1 = (team, clock)
            else:
                blocker = next((a for a in ath[1:] if team_of.get(a) == other), None)
                if blocker:
                    team_box[other]["blk"] += 1
                pending_and1 = None
            ft_nonfinal_miss = False
        elif tid in FT_IDS:
            made = bool(p["scoring"])
            b = team_box[team]
            b["fta"] += 1; b["ftm"] += made
            if made and actor:
                pq[actor][per] += 1
            if tid in FT_TECH:
                continue
            if cur is None or cur["team"] != team:
                flips += cur is not None
                change(team, per, sec, "flip", last_change or "foul")
            pending_and1 = None
            if tid in FT_KEEP:
                ft_nonfinal_miss = False
            elif FT_LAST.get(tid, False):
                ft_nonfinal_miss = False
                if made:
                    last_ended = end_poss(sec, "ft")
                    start_poss(other, per, sec, "make")
                    offense = other
                    last_change = "make"
                    last_gain[other] = ("make", sec, per)
            else:
                ft_nonfinal_miss = not made
        elif tid == OREB_ID:
            if ft_nonfinal_miss:
                ft_nonfinal_miss = False
                continue
            team_box[team]["oreb"] += 1
            if cur is None or cur["team"] != team:
                flips += cur is not None
                change(team, per, sec, "flip", "oreb")
        elif tid == DREB_ID:
            if ft_nonfinal_miss:
                ft_nonfinal_miss = False
                continue
            team_box[team]["dreb"] += 1
            if cur is None or cur["team"] != team:
                change(team, per, sec, "miss", "dreb")
            last_change = "dreb"
            last_gain[team] = ("dreb", sec, per)
            pending_and1 = None
        elif _turnover(tid):
            team_box[team]["tov"] += 1
            if cur is None or cur["team"] != team:
                flips += cur is not None
                change(team, per, sec, "flip", last_change or "dead")
            stealer = next((a for a in ath[1:] if team_of.get(a) == other), None)
            if stealer:
                team_box[other]["stl"] += 1
            last_change = "stl" if stealer else "dead"
            last_ended = end_poss(sec, "tov")
            start_poss(other, per, sec, last_change)
            offense = other
            last_gain[other] = (last_change, sec, per)
            pending_and1 = None
        elif tid in (JUMP_ID, JUMP_OLD):
            if cur is None:
                start_poss(team, per, sec, "jump")
                offense = team
        else:
            if actor and team_of.get(actor) == team and tid in PERSONAL_FOULS:
                fouls[actor].append((per, clock, sec, tid))
                team_box[team]["pf"] += 1
                if tid in TAKE_FOULS:
                    team_box[team]["take"] += 1
                if cur is None:
                    start_poss(other, per, sec, last_change or "dead")
                    offense = other
                if cur is not None and cur["team"] == other and tid not in SHOOTING_FOULS:
                    cur["fouled"] = cur.get("fouled", 0) + 1
            if actor and tid in TECHNICALS:
                techs[actor] += 1
            if actor and tid in FLAGRANT2:
                techs[actor] += 2
    if cur is not None:
        end_poss(end_abs, "period")

    # ---------------------------------------------------------------- what followed each timeout
    n_next = cfg["ato_next"]
    for to in timeouts:
        i0 = to.get("poss_i")
        nxt = possessions[i0:i0 + 2 * n_next + 2] if i0 is not None else []
        own = [q for q in nxt if q["team"] == to["team"]][:n_next]
        opp = [q for q in nxt if q["team"] != to["team"]][:n_next]
        to["next_own"] = [sum(q["pts"] for q in own), len(own)]
        to["next_opp"] = [sum(q["pts"] for q in opp), len(opp)]
        first = possessions[i0] if i0 is not None and i0 < len(possessions) else None
        to["ato_pts"] = (first["pts"] - to.pop("pts_at", 0)) if first else None
        to["ato_side"] = ("own" if first and first["team"] == to["team"] else "opp" if first else None)
        to.pop("poss_i", None)
        to.pop("pts_at", None)
    for r in runs:
        i0 = r.pop("poss_i")
        r.setdefault("final", r.pop("final_size", r["size"]))
        r.pop("final_size", None)
        nxt = [q for q in possessions[i0:i0 + 2 * n_next + 2] if q["team"] != r["team"]][:n_next]
        r["next_opp"] = [sum(q["pts"] for q in nxt), len(nxt)]

    # ---------------------------------------------------------------- garbage time
    garbage_from = None
    for sec, m in margin_at:
        per_now = 4 if sec >= 2160 else None
        if sec < 2160:
            continue
        left = 2880 - sec if sec <= 2880 else 0
        lead_now = abs(m)
        if garbage_from is None:
            if sec <= 2880 and any(lead_now >= L and left <= s for L, s in cfg["garbage"]):
                garbage_from = sec
        elif lead_now < cfg["garbage_exit"]:
            garbage_from = None
    # ---------------------------------------------------------------- late-game situations
    foul_up3, late_poss, two41 = [], [], []
    for i, q in enumerate(possessions):
        pl = period_len(q["per"])
        start_clock = pl - (q["start"] - abs_sec(q["per"], pl))
        end_clock = pl - (q["end"] - abs_sec(q["per"], pl)) if q["end"] is not None else 0.0
        if start_clock <= 45.0:
            later = any(x["team"] == q["team"] and x["per"] == q["per"] for x in possessions[i + 1:i + 4])
            late_poss.append({"team": q["team"], "per": q["per"], "start": round(start_clock, 1), "pts": q["pts"],
                              "kind": q["end_kind"], "another": later})
        lo, hi = cfg["two_for_one"]
        if q["end_kind"] in ("make", "miss", "tov", "ft") and lo <= end_clock <= hi and q["fga"] > 0:
            later = any(x["team"] == q["team"] and x["per"] == q["per"] for x in possessions[i + 1:i + 4])
            two41.append({"team": q["team"], "per": q["per"], "clock": round(end_clock, 1), "another": later})
        if q["per"] >= 4 and start_clock <= cfg["foul_up3_sec"] and q["margin"] == -3:
            d = opp_e[q["team"]]
            foul_up3.append({"team": d, "per": q["per"], "clock": round(start_clock, 1), "fouled": bool(q.get("fouled")) and q["fga"] == 0,
                             "pts_allowed": q["pts"]})
    # chase fouls: the trailing side's fouls in the last two minutes while down 2-10
    chase = {t: [0, 0] for t in (home_e, away_e)}
    for q in possessions:
        if q["per"] < 4:
            continue
        pl = period_len(q["per"])
        start_clock = pl - (q["start"] - abs_sec(q["per"], pl))
        if start_clock <= cfg["late_sec"] and 2 <= q["margin"] <= 10:
            d = opp_e[q["team"]]
            chase[d][1] += 1
            chase[d][0] += 1 if q.get("fouled") and q["fga"] == 0 else 0

    # ---------------------------------------------------------------- clutch, halves, quarters
    clutch = {t: {"pts": 0, "poss": 0, "opp_pts": 0, "opp_poss": 0} for t in (home_e, away_e)}
    for q in possessions:
        if q["per"] < 4:
            continue
        pl = period_len(q["per"])
        start_clock = pl - (q["start"] - abs_sec(q["per"], pl))
        if start_clock <= cfg["clutch_sec"] and abs(q["margin"]) <= cfg["clutch_margin"]:
            t, o = q["team"], opp_e[q["team"]]
            clutch[t]["pts"] += q["pts"]; clutch[t]["poss"] += 1
            clutch[o]["opp_pts"] += q["pts"]; clutch[o]["opp_poss"] += 1

    # ---------------------------------------------------------------- players
    pf_thresholds = [(1, 2), (2, 3), (3, 4), (99, 5)]      # (through period, fouls) = foul trouble

    def in_trouble(per, n):
        return (per <= 1 and n >= 2) or (per <= 2 and n >= 3) or (per <= 3 and n >= 4) or n >= 5

    players = {}
    for b in g["players"]:
        e = b["eid"]
        iv = intervals.get(e, [])
        secs = sum(a1 - a0 for a0, a1 in iv)
        fl = fouls.get(e, [])
        trouble = []
        n = 0
        for per, clock, fsec, tid in fl:
            n += 1
            if in_trouble(per, n):
                # how long he sat after it: the first off-floor gap starting within 90 s
                sat = None
                for k, (a0, a1) in enumerate(iv):
                    if a0 <= fsec <= a1 + 1e-6:
                        if a1 - fsec <= 90:
                            nxt = iv[k + 1][0] if k + 1 < len(iv) else end_abs
                            sat = round(nxt - a1, 1)
                        else:
                            sat = 0.0
                        break
                trouble.append([per, round(clock, 1), n, sat])
        exit_kind = None
        if iv and secs > 0:
            last_end = iv[-1][1]
            if n >= 6:
                exit_kind = "fouled_out"
            elif techs.get(e, 0) >= 2:
                exit_kind = "ejected"
            elif last_end < end_abs - 720 and secs >= 600 and (garbage_from is None or last_end < garbage_from):
                exit_kind = "left"
        players[e] = {"team": b["team"], "name": b["name"], "starter": e in starters[b["team"]], "dnp": bool(b["dnp"]),
                      "sec": round(secs, 1), "pts": b["pts"], "pf": len(fl), "iv": [[round(a, 1), round(c, 1)] for a, c in iv],
                      "trouble": trouble, "exit": exit_kind, "exit_sec": round(iv[-1][1], 1) if iv and exit_kind else None,
                      "pq": [pq[e][k] for k in range(1, periods + 1)] if e in pq else None}

    # ---------------------------------------------------------------- stints and units
    st_rows = []
    for s in stints_out:
        th, ta = s.t.get(home_e), s.t.get(away_e)
        if th is None or ta is None:
            continue
        a0 = abs_sec(s.period, s.start)
        m = next((mm for ss, mm in reversed(margin_at) if ss <= a0), 0)
        st_rows.append([s.period, round(s.start, 1), round(s.end, 1), sorted(s.on.get(home_e, ())), sorted(s.on.get(away_e, ())),
                        th["poss"], ta["poss"], th["pts"], ta["pts"], m,
                        th["fg3m"], th["fg3a"], th["ftm"], th["fta"], ta["fg3m"], ta["fg3a"], ta["ftm"], ta["fta"],
                        th["fga"], th["fgm"], ta["fga"], ta["fgm"], th["oreb"], ta["oreb"], th["dreb"], ta["dreb"], th["tov"], ta["tov"]])

    # ---------------------------------------------------------------- team lines
    tot_poss = {t: sum(q_poss[t].values()) for t in (home_e, away_e)}
    team_out = {}
    for t in (home_e, away_e):
        o = opp_e[t]
        b = team_box[t]
        team_out[TM.franchise(t) if TM.franchise(t) else t] = {
            "espn": t, "home": t == home_e, "pts": score[t], "opp_pts": score[o], "poss": tot_poss[t], "opp_poss": tot_poss[o],
            "q_pts": [q_pts[t][k] for k in range(1, periods + 1)], "q_poss": [q_poss[t][k] for k in range(1, periods + 1)],
            "box": {k: int(b[k]) for k in ("fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov", "ast", "stl", "blk", "pf", "take")},
            "diet": diet[t], "trans": trans[t], "lead_max": lead[t][0], "deficit_max": -lead[t][1], "sec_leading": round(lead[t][2], 1),
            "clutch": clutch[t], "chase": chase[t], "first_sub": round(first_sub[t], 1) if first_sub[t] is not None else None,
            "starters": sorted(starters[t]),
        }
    ext = g.get("extra") or {}
    odds = None
    for o in ext.get("odds") or []:
        if o.get("spread") is not None:
            odds = {"provider": o.get("provider"), "home_spread": o["spread"], "ou": o.get("ou")}
            break
    wp_home = [w for _, w in wp_line]
    return {
        "gid": g["gid"], "date": g["date"], "home": home, "away": away, "periods": periods,
        "venue": ext.get("venue"), "city": ext.get("city"), "neutral": bool(ext.get("neutral")), "attendance": ext.get("attendance"),
        "start": ext.get("start"), "odds": odds, "officials": g.get("officials") or [],
        "wp": {"n": len(wp_home), "home_min": round(min(wp_home), 3) if wp_home else None, "home_max": round(max(wp_home), 3) if wp_home else None,
               "home_q4": round(next((w for s, w in wp_line if s >= 2160), wp_home[-1]), 3) if wp_home else None},
        "garbage_from": round(garbage_from, 1) if garbage_from is not None else None,
        "team": team_out, "players": players, "stints": st_rows,
        "poss": [[q["team"], q["per"], round(q["start"], 1), round(q["end"] if q["end"] is not None else q["start"], 1), q["pts"], q["kind"], q["end_kind"], q["ato"], q["margin"]] for q in possessions],
        "timeouts": timeouts, "runs": runs, "challenges": challenges, "reviews": reviews,
        "foul_up3": foul_up3, "late_poss": late_poss, "two_for_one": two41, "flips": flips,
    }


KEYS = ("gid date home away periods venue city neutral attendance start odds officials wp garbage_from team players "
        "stints poss timeouts runs challenges reviews foul_up3 late_poss two_for_one").split()
