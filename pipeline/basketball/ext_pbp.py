"""
ext_pbp.py — what play-by-play alone can count, per player per game, from ESPN's feed.

Input is one game normalized by espn_source.normalize (plays in order, each with its type id,
text, team, clock, participants) plus espn_tables.parse_game's stints (who was on the floor
when). Output is a dict of per-player counters, summed over a season by `season_counts`.

Counted here (and nowhere else in the pipeline):
  fouls drawn on shots (the free-throw shooter after a shooting foul), and-ones, offensive
  fouls, take fouls, technicals, flagrants, defensive 3 seconds, games in foul trouble;
  turnovers by kind (bad pass, lost ball, travel, offensive foul, 3 seconds, shot clock, out
  of bounds, other), live-ball turnovers (a steal on the play);
  steals by kind (interceptions off bad passes, strips off lost balls);
  blocks and whether the blocker's team came up with the ball (block retention);
  putback and tip attempts; shots in transition (within 7 seconds of a steal or defensive
  rebound) and in the half court;
  clutch (last five minutes of the fourth quarter or overtime, score within five): seconds,
  points, shooting, assists, turnovers and the score margin while he was on the floor;
  rotation: stints (continuous spells on the floor inside a period), whether he was on the
  floor at the final buzzer, fourth-quarter seconds, starts;
  win probability added while he was on the floor (games where ESPN publishes win
  probability: recent seasons).
"""
from collections import defaultdict

# ESPN play type ids (from the feed itself; see the notes in claude/basketball-savant-
# everything-build.md for the census they were read from).
SHOOTING_FOULS = {44, 21}                 # Shooting Foul, Shooting Block
OFFENSIVE_FOULS = {42, 24}                # Offensive Foul, Offensive Charge
TAKE_FOULS = {22, 257}                    # Personal Take Foul, Transition Take Foul
TECHNICALS = {35}
DEF3SEC = {29}
FLAGRANTS = {32, 33}
PERSONAL_FOUL_IDS = {21, 22, 23, 24, 32, 33, 36, 42, 43, 44, 45, 257}
TOV_KIND = {
    62: "badpass", 90: "badpass", 63: "lostball", 87: "lostball", 64: "travel",
    84: "offfoul", 67: "threesec", 70: "shotclock", 86: "oob", 65: "handle", 66: "handle",
    78: "handle", 72: "other", 73: "other", 74: "other", 76: "other",
}
FT_IDS = {97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 157, 165, 166}
OREB_ID, DREB_ID, SUB_ID = 156, 155, 584
HEAVE_ID = 282
TRANSITION_SECONDS = 7.0
CLUTCH_SECONDS, CLUTCH_MARGIN = 300.0, 5


def _distance(text):
    import re
    m = re.search(r"(\d+)-foot", text)
    if m:
        return int(m.group(1))
    t = text.lower()
    if any(w in t for w in ("dunk", "layup", "tip", "putback", "alley oop", "finger roll")):
        return 1
    return None


def _is_turnover(tid):
    return 62 <= tid <= 90 and tid != 61


def _is_fg(p):
    return p.get("shooting") and int(p.get("tid") or 0) not in FT_IDS and int(p.get("tid") or 0) != HEAVE_ID


def _blank():
    return defaultdict(float)


def game_counts(g, parsed):
    """{espn id: counter dict} for one game. `parsed` is espn_tables.parse_game(g)."""
    team_of = parsed["team_of"]
    home, away = g["home"], g["away"]
    opp = {home: away, away: home}
    c = defaultdict(_blank)
    plays = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
    wp = dict(g.get("wp") or [])          # play id -> home win probability (recent seasons)

    # --- on the floor at a moment: from parse_game's stints
    stints_by_period = defaultdict(list)
    for s in parsed["stints"]:
        stints_by_period[s.period].append(s)

    def on_floor(period, clock):
        for s in stints_by_period.get(period, []):
            if s.end <= clock <= s.start:
                return s.on
        return {}

    # --- per-play pass
    score = {home: 0, away: 0}
    last_gain = {home: None, away: None}          # (kind, period, clock) of the last change of possession
    pf_game = defaultdict(int)
    pf_q1 = defaultdict(int)
    wp_line = []                                   # (period, clock, home win probability) after each play
    clutch_prev = None                             # (period, clock) of the previous play, for clutch seconds
    margin_at_5 = None                             # score margin when the 4th quarter reached 5:00
    for i, p in enumerate(plays):
        tid = int(p.get("tid") or 0)
        team = p.get("team")
        ath = p.get("ath") or []
        per, clock = p["period"], p["clock"]
        margin_before = score[home] - score[away]
        if margin_at_5 is None and per == 4 and clock <= CLUTCH_SECONDS:
            margin_at_5 = margin_before
        in_clutch = per >= 4 and clock <= CLUTCH_SECONDS and abs(margin_before) <= CLUTCH_MARGIN
        # clutch seconds: the time since the previous play, if that stretch was clutch time
        if clutch_prev and clutch_prev[0] == per and clutch_prev[2]:
            dur = max(0.0, clutch_prev[1] - clock)
            if dur > 0:
                for t, five in on_floor(per, clutch_prev[1] - dur / 2).items():
                    for a in five:
                        c[a]["cl_sec"] += dur
        clutch_prev = (per, clock, in_clutch)

        if tid == SUB_ID or team not in (home, away):
            continue
        other = opp[team]
        actor = ath[0] if ath else None
        cur_wp = wp.get(p.get("pid"))
        if cur_wp is not None:
            wp_line.append((per, clock, cur_wp))

        if _is_fg(p):
            made = bool(p.get("scoring"))
            three = (p.get("pts_att") or 0) == 3
            pts = (p.get("value") or (3 if three else 2)) if made else 0
            if actor:
                text = (p.get("type") or "").lower()
                dist = _distance(p.get("text") or "")
                if made and dist is not None and dist <= 4:
                    c[actor]["rim_fgm"] += 1
                    if len(ath) > 1 and team_of.get(ath[1]) == team:
                        c[actor]["rim_ast"] += 1
                if "putback" in text or "tip" in text:
                    c[actor]["pb_fga"] += 1
                    c[actor]["pb_fgm"] += made
                lg = last_gain.get(team)
                trans = bool(lg and lg[0] in ("stl", "dreb") and lg[1] == per and (lg[2] - clock) <= TRANSITION_SECONDS)
                pre = "tr" if trans else "hc"
                c[actor][pre + "_fga"] += 1
                c[actor][pre + "_fgm"] += made
                c[actor][pre + "_fg3m"] += made and three
                if in_clutch:
                    c[actor]["cl_fga"] += 1
                    c[actor]["cl_fgm"] += made
                    c[actor]["cl_fg3a"] += three
                    c[actor]["cl_fg3m"] += made and three
                    c[actor]["cl_pts"] += pts
                    if made and len(ath) > 1 and team_of.get(ath[1]) == team:
                        c[ath[1]]["cl_ast"] += 1
            if not made:
                blocker = next((a for a in ath[1:] if team_of.get(a) == other), None)
                if blocker:
                    c[blocker]["blk_n"] += 1
                    # who comes up with the ball: the next rebound in this period
                    for q in plays[i + 1:]:
                        if q["period"] != per:
                            break
                        qt = int(q.get("tid") or 0)
                        if qt in (OREB_ID, DREB_ID):
                            if qt == DREB_ID and q.get("team") == other:
                                c[blocker]["blk_kept"] += 1
                            break
                        if _is_turnover(qt) or _is_fg(q):
                            break
            else:
                # and-one: a made shot followed at the same clock by his own 1-of-1
                for q in plays[i + 1:i + 8]:
                    if q["period"] != per or abs(q["clock"] - clock) > 0.01:
                        break
                    if int(q.get("tid") or 0) == 97 and (q.get("ath") or [None])[0] == actor:
                        c[actor]["and1"] += 1
                        break
                last_gain[other] = ("made", per, clock)
        elif tid in FT_IDS:
            made = bool(p.get("scoring"))
            if actor and in_clutch:
                c[actor]["cl_fta"] += 1
                c[actor]["cl_ftm"] += made
                c[actor]["cl_pts"] += made
        elif tid == DREB_ID:
            last_gain[team] = ("dreb", per, clock)
        elif _is_turnover(tid):
            kind = TOV_KIND.get(tid, "other")
            stealer = next((a for a in ath[1:] if team_of.get(a) == other), None)
            if actor and team_of.get(actor) == team:
                c[actor]["tov_" + kind] += 1
                c[actor]["tov_n"] += 1
                if stealer:
                    c[actor]["tov_live"] += 1
                if in_clutch:
                    c[actor]["cl_tov"] += 1
            if stealer:
                c[stealer]["stl_" + ("int" if kind == "badpass" else "strip" if kind == "lostball" else "oth")] += 1
                last_gain[other] = ("stl", per, clock)
            else:
                last_gain[other] = ("dead", per, clock)
        else:
            if actor and team_of.get(actor) == team:
                if tid in SHOOTING_FOULS:
                    c[actor]["sf_comm"] += 1
                    # the fouled shooter: the other team's next free-throw shooter at this clock
                    for q in plays[i + 1:i + 12]:
                        if q["period"] != per or abs(q["clock"] - clock) > 0.01:
                            break
                        if int(q.get("tid") or 0) in FT_IDS and q.get("team") == other and q.get("ath"):
                            c[q["ath"][0]]["sf_drawn"] += 1
                            break
                if tid in OFFENSIVE_FOULS:
                    c[actor]["off_foul"] += 1
                if tid in TAKE_FOULS:
                    c[actor]["take"] += 1
                if tid in TECHNICALS:
                    c[actor]["tech"] += 1
                if tid in DEF3SEC:
                    c[actor]["def3"] += 1
                if tid in FLAGRANTS:
                    c[actor]["flag"] += 1
                if tid in PERSONAL_FOUL_IDS:
                    pf_game[actor] += 1
                    if per == 1:
                        pf_q1[actor] += 1
        # clutch +/-: every point scored in clutch time, to everyone on the floor
        sh, sa = p.get("score_home"), p.get("score_away")
        if sh is not None and sa is not None:
            sh, sa = int(sh), int(sa)
            dh, da = sh - score[home], sa - score[away]
            if (dh or da) and in_clutch:
                fl = on_floor(per, clock)
                for a in fl.get(home, ()):
                    c[a]["cl_pm"] += dh - da
                for a in fl.get(away, ()):
                    c[a]["cl_pm"] += da - dh
            score[home], score[away] = sh, sa

    # --- foul trouble (per game flags)
    for a, n in pf_game.items():
        c[a]["g_5pf"] += 1 if n >= 5 else 0
    for a, n in pf_q1.items():
        c[a]["g_q1_2pf"] += 1 if n >= 2 else 0

    # --- rotation: continuous spells inside a period, the final buzzer, the fourth quarter
    last_period = max(stints_by_period) if stints_by_period else 4
    for per, sts in stints_by_period.items():
        running = {}
        for s in sts:
            now = set().union(*s.on.values()) if s.on else set()
            for a in list(running):
                if a not in now:
                    c[a]["st_n"] += 1
                    c[a]["st_sec"] += running.pop(a) - s.start
            for a in now:
                running.setdefault(a, s.start)
            for a in now:
                if per == 4:
                    c[a]["q4_sec"] += s.seconds
        end = sts[-1].end if sts else 0.0
        close_game = margin_at_5 is not None and abs(margin_at_5) <= 10
        for a, start in running.items():
            c[a]["st_n"] += 1
            c[a]["st_sec"] += start - end
            if per == last_period:
                c[a]["closed"] += 1
                if close_game:
                    c[a]["closed_close"] += 1
    # --- win probability added while on the floor. ESPN's number is the home side's chance
    # of winning after each play. Each stint (a stretch with the same ten players) moves it
    # from where it stood when the stint began to where it stood when it ended; all five on
    # a side share that change, from their side's view. Over a game a team's five sum to five
    # times its own swing, so the stat is zero-sum and leverage-weighted: a run in a tie game
    # in the fourth moves it far more than the same run in a blowout. (Crediting single plays
    # instead fails on ESPN's model, which does not price possession: every offensive play
    # would come out positive on average.)
    if wp_line:
        import bisect
        keys = [(per_, -clk) for per_, clk, _ in wp_line]
        vals = [w for _, _, w in wp_line]

        def wp_at(period, clock):
            i = bisect.bisect_right(keys, (period, -clock)) - 1
            return vals[i] if i >= 0 else vals[0]
        for s_ in parsed["stints"]:
            if not s_.on:
                continue
            d = wp_at(s_.period, s_.end) - wp_at(s_.period, s_.start)
            if not d:
                continue
            for t, five in s_.on.items():
                view = d if t == home else -d
                for a in five:
                    c[a]["wpa"] += view
    close_game = margin_at_5 is not None and abs(margin_at_5) <= 10
    for a, sec in parsed["seconds"].items():
        c[a]["sec"] += sec
        c[a]["gp"] += 1 if sec > 0 else 0
        if close_game and sec > 0:
            c[a]["close_g"] += 1
        if wp and sec > 0:
            c[a]["wp_games"] += 1
        if (c[a]["cl_sec"] or 0) > 0:
            c[a]["cl_gp"] += 1
    starters = {p["eid"] for p in g["players"] if p.get("starter")}
    for a in starters:
        c[a]["starts"] += 1
    return c


def season_counts(games, parse):
    """Sum game_counts over a season. `parse` is espn_tables.parse_game."""
    tot = defaultdict(_blank)
    for g in games:
        try:
            parsed = parse(g)
        except Exception:  # noqa
            continue
        for a, cnt in game_counts(g, parsed).items():
            t = tot[a]
            for k, v in cnt.items():
                t[k] += v
    return {a: {k: round(v, 4) for k, v in cnt.items() if v} for a, cnt in tot.items()}
