"""
rotation.py — the Rotation Map and what hangs off it, per coach-team-season (spec §4 B).

    build(season, games, who, rates) -> {(team, coach): rotation dict}

Basketball Coaching Savant's rotation.py, rule for rule, on the college clock: 40 regulation minutes in
two halves (config.PERIODS, so quarters would be a config change), overtime apart. From each lineup
game's stints (College Savant's: ESPN substitutions from 2025-26 and mid-February 2025, CBBD's fives for
2023-24 and 2024-25, only the games its lineup gate passes) for every man with 60+ minutes under a coach:

  map         per regulation minute, the share of games he was on the floor during it (seconds-
              weighted), on two bases: every lineup game under this coach, and only the games he played
  usual       his usual windows: runs of minutes on the floor in 60%+ of the games he played; under 40% is
              usually off; between is ambiguous and not scored
  off-script  per game, the minutes his status (on for 30+ seconds of the minute, or off) differs from his
              usual one, over the scripted player-minutes. Each gets the first cause that fits: absence (he,
              or a usual-on man, did not play or had fouled out), blowout (College Savant's safe-lead rule:
              from the start of the final garbage run, if it starts with a minute or more left), foul trouble (config.FOUL_RULES: a
              2nd foul in the first half until halftime; a 4th with 8:00 or more left until 8:00), choice.
              Overtime is unscripted and counted apart.
  shape       stint length, first substitution, all-bench minutes, the top two's stagger, garbage minutes
  closing     who was on the floor at the end of close games (within 10, no garbage time), against the
              best five available by Savant rate
  sits        seconds a man sat after a 2nd foul in the first half
  months      the base-2 map by month

The model's view, not a verdict: it cannot see fatigue, minor injuries, match-ups or development plans.
"""
from collections import defaultdict

import config as CF

PER = CF.PERIODS["default"]
REG = PER["regulation"]
REG_SEC = sum(REG)
REG_MIN = int(REG_SEC // 60)
HALF_MIN = int(REG[0] // 60)
ON_SHARE, OFF_SHARE = 0.60, 0.40
MAP_MIN_MINUTES = 60.0
CLOSE_MARGIN = 10
MONTHS = {11: "Nov", 12: "Dec", 1: "Jan", 2: "Feb", 3: "Mar+", 4: "Mar+", 10: "Nov"}
MONTH_ORDER = ["Nov", "Dec", "Jan", "Feb", "Mar+"]


def period_start(p):
    if p <= len(REG):
        return sum(REG[:p - 1])
    return REG_SEC + PER["ot"] * (p - len(REG) - 1)


def period_len(p):
    return REG[p - 1] if p <= len(REG) else PER["ot"]


def abs_t(p, clock):
    return period_start(p) + (period_len(p) - clock)


def intervals(g):
    """{eid: [(a0, a1)]} in absolute game seconds, from the stints; and the team side of each man."""
    iv = defaultdict(list)
    side = {}
    for s in g.get("stints") or []:
        a0, a1 = abs_t(s[0], s[1]), abs_t(s[0], s[2])
        if a1 <= a0:
            continue
        for eid in s[3]:
            iv[eid].append((a0, a1)); side[eid] = g["home"]
        for eid in s[4]:
            iv[eid].append((a0, a1)); side[eid] = g["away"]
    for k in iv:                     # merge touching spells
        v = sorted(iv[k])
        m = [list(v[0])]
        for a, b in v[1:]:
            if a <= m[-1][1] + 0.5:
                m[-1][1] = max(m[-1][1], b)
            else:
                m.append([a, b])
        iv[k] = [tuple(x) for x in m]
    return iv, side


def minute_seconds(ivs, end_abs):
    sec = [0.0] * REG_MIN
    ot = 0.0
    for a0, a1 in ivs:
        a1 = min(a1, end_abs)
        t = a0
        while t < a1:
            m = int(t // 60)
            if m >= REG_MIN:
                ot += a1 - t
                break
            edge = min(a1, (m + 1) * 60.0)
            sec[m] += edge - t
            t = edge
    return sec, ot


def foul_state(g, team):
    """{eid: (trouble windows [(a0, a1)], fouled-out time or None, early-second-foul times)}."""
    count = defaultdict(int)
    out = defaultdict(lambda: [[], None, []])
    for per, clk, eid, tm, tech in sorted(g.get("fouls") or [], key=lambda f: (f[0], -f[1])):
        if tm != team:
            continue
        count[eid] += 1
        n = count[eid]
        t = abs_t(per, clk)
        left = REG_SEC - t
        if n == CF.FOUL_RULES["out"]:
            out[eid][1] = t
        elif n == CF.FOUL_RULES["h1"] and per == 1:
            out[eid][0].append((t, REG[0]))
            out[eid][2].append(t)
        elif n == CF.FOUL_RULES["late"] and left >= CF.FOUL_RULES["late_until"]:
            out[eid][0].append((t, REG_SEC - CF.FOUL_RULES["late_until"]))
    return out


GARBAGE_MIN_LEFT = 60.0


def garbage_from(g, team_is_home):
    """When the game was decided: the start of the final unbroken run of garbage possessions (College
    Savant's safe-lead flag) that lasts to the end, if it starts with a minute or more left. The safe-lead
    rule calls the last seconds of most close games safe (up 4 with 2 seconds left), so the first flagged
    possession would make nearly every game a blowout: Duke 2024-25 had 33 of 33 (found Nov 6 2026)."""
    P = g.get("poss") or []
    start = None
    for p in reversed(P):
        if not p[8]:
            break
        start = p
    if start is None:
        return None
    t = abs_t(start[1], start[2])
    end = REG_SEC + PER["ot"] * g["ot"]
    return t if end - t >= GARBAGE_MIN_LEFT else None


def _in(ws, t):
    return any(a <= t < b for a, b in ws)


def month_of(date):
    return MONTHS.get(int(date[5:7]), "Mar+")


def describe(windows, starter):
    if not windows:
        return "No usual window"

    def clock(m):
        h = m // HALF_MIN + 1
        left = HALF_MIN - (m % HALF_MIN)
        return f"{left}:00 {'1st' if h == 1 else '2nd'} half" if left < HALF_MIN else f"start of the {'1st' if h == 1 else '2nd'} half"
    bits = []
    for i, (a, b) in enumerate(windows):
        bits.append("Starts" if (i == 0 and a == 0) else f"in at {clock(a)}")
        end = b + 1
        if end < REG_MIN and (i + 1 >= len(windows) or windows[i + 1][0] > end):
            bits[-1] += " to the half" if end == HALF_MIN else f", sits at {clock(end)}"
        if end >= REG_MIN:
            bits[-1] += ", closes"
    return "; ".join(bits)


def build(season, games, who, rates=None, names=None):
    rates = rates or {}
    groups = defaultdict(list)
    for g in games:
        if not g.get("lineup_ok") or not g.get("stints"):
            continue
        for team in (g["home"], g["away"]):
            if team in g["non_d1"]:
                continue
            c = who.get(g["gid"], {}).get(team)
            if c:
                groups[(team, c)].append(g)
    out = {}
    for (team, coach), gs in groups.items():
        gs.sort(key=lambda g: g["date"])
        n_games = len(gs)
        on_all = defaultdict(lambda: [0.0] * REG_MIN)
        on_live = defaultdict(lambda: [0.0] * REG_MIN)
        den_live = defaultdict(lambda: [0.0] * REG_MIN)
        played, total_sec, starts, first_entry, ot_all = defaultdict(int), defaultdict(float), defaultdict(int), defaultdict(list), defaultdict(float)
        nm = {}
        per_game = []
        for g in gs:
            home = g["home"] == team
            end_abs = REG_SEC + PER["ot"] * g["ot"]
            iv, side = intervals(g)
            fs = foul_state(g, team)
            gf = garbage_from(g, home)
            box = {p[0]: p for p in g["players"] if p[1] == team}
            row = {}
            for eid, ivs in iv.items():
                if side.get(eid) != team:
                    continue
                s40, ot = minute_seconds(ivs, end_abs)
                row[eid] = (s40, ot, ivs)
                nm[eid] = (names or {}).get(eid) or g["names"].get(eid)
                played[eid] += 1
                total_sec[eid] += sum(b - a for a, b in ivs)
                starts[eid] += bool(box.get(eid, [0] * 5)[4])
                first_entry[eid].append(ivs[0][0])
                cut = min(x for x in (gf, fs[eid][1] if eid in fs else None, REG_SEC) if x is not None)
                for m in range(REG_MIN):
                    on_all[eid][m] += s40[m]
                    keep = max(0.0, min(60.0, cut - m * 60.0))
                    if keep > 0:
                        den_live[eid][m] += keep
                        on_live[eid][m] += min(s40[m], keep)
                ot_all[eid] += ot
            per_game.append((g, row, fs, gf, box))
        roster = [e for e, s in total_sec.items() if s >= MAP_MIN_MINUTES * 60]
        roster.sort(key=lambda e: (-(starts[e] / max(1, played[e])) if starts[e] / max(1, played[e]) >= 0.5 else 1,
                                   sum(first_entry[e]) / max(1, len(first_entry[e])), -total_sec[e]))
        usual, rows = {}, []
        for e in roster:
            base_all = [round(100 * on_all[e][m] / (60.0 * n_games)) for m in range(REG_MIN)]
            base_pl = [round(100 * on_live[e][m] / den_live[e][m]) if den_live[e][m] >= 180.0 else round(100 * on_all[e][m] / (60.0 * played[e])) for m in range(REG_MIN)]
            st = ["on" if v >= 100 * ON_SHARE else "off" if v < 100 * OFF_SHARE else None for v in base_pl]
            usual[e] = st
            windows, cur = [], None
            for m, x in enumerate(st):
                if x == "on" and cur is None:
                    cur = [m, m]
                elif x == "on":
                    cur[1] = m
                elif cur is not None:
                    windows.append(cur); cur = None
            if cur is not None:
                windows.append(cur)
            ot_games = sum(1 for g, row, *_ in per_game if g["ot"] and e in row)
            rows.append(dict(id=e, name=nm.get(e), gp=played[e], starts=starts[e], min=round(total_sec[e] / 60.0, 1), mpg=round(total_sec[e] / 60.0 / played[e], 1),
                             all=base_all, played=base_pl, windows=windows, text=describe(windows, starts[e] / max(1, played[e]) >= 0.5),
                             ot=round(100 * ot_all[e] / (60.0 * 5 * max(1, ot_games))) if ot_games else None, rate=rates.get(e)))
        causes = ["absence", "blowout", "foul", "choice"]
        tot = defaultdict(float)
        ptot = defaultdict(lambda: [0, 0, 0, 0, 0])
        game_rows = []
        after = {"W": [0.0, 0], "L": [0.0, 0]}
        prev = None
        shape = defaultdict(float)
        sits = []
        month_on = defaultdict(lambda: defaultdict(lambda: [0.0] * REG_MIN))
        month_n = defaultdict(lambda: defaultdict(int))
        closers = defaultdict(int)
        close = dict(n=0, best=0, near=0, gap=0.0, gap_n=0)
        top2 = sorted(roster, key=lambda e: -total_sec[e])[:2]
        for g, row, fs, gf, box in per_game:
            home = g["home"] == team
            margin = (g["hs"] - g["as_"]) if home else (g["as_"] - g["hs"])
            absent = {}
            for e in roster:
                if e not in row:
                    absent[e] = 0.0
                elif e in fs and fs[e][1] is not None:
                    absent[e] = fs[e][1]
            cnt = defaultdict(float)
            pc = defaultdict(lambda: [0, 0, 0, 0, 0])
            scripted = 0
            for e in roster:
                st = usual[e]
                s40 = row.get(e, ([0.0] * REG_MIN,))[0]
                for m in range(REG_MIN):
                    if st[m] is None:
                        continue
                    scripted += 1
                    pc[e][4] += 1
                    actual = "on" if s40[m] >= 30.0 else "off"
                    if actual == st[m]:
                        continue
                    t = m * 60.0 + 30.0
                    others_out = any(usual[q][m] == "on" and q in absent and absent[q] <= t for q in roster if q != e)
                    if (e in absent and absent[e] <= t) or others_out:
                        cause = "absence"
                    elif gf is not None and t >= gf:
                        cause = "blowout"
                    elif (e in fs and _in(fs[e][0], t)) or any(usual[q][m] == "on" and q in fs and _in(fs[q][0], t) for q in roster if q != e):
                        cause = "foul"
                    else:
                        cause = "choice"
                    cnt[cause] += 1
                    pc[e][causes.index(cause)] += 1
            share = sum(cnt.values()) / scripted if scripted else 0.0
            for e, v in pc.items():
                for k in range(5):
                    ptot[e][k] += v[k]
            for k in causes:
                tot[k] += cnt[k]
            tot["scripted"] += scripted
            tot["ot"] += sum(r[1] for r in row.values()) / 60.0
            if prev in after:
                after[prev][0] += share; after[prev][1] += 1
            prev = "W" if margin > 0 else "L"
            mon = month_of(g["date"])
            for e, (s40, ot, ivs) in row.items():
                if e in usual:
                    month_n[mon][e] += 1
                    for m in range(REG_MIN):
                        month_on[mon][e][m] += s40[m]
            # shape
            spells = [b - a for e, (s40, ot, ivs) in row.items() for a, b in ivs]
            shape["spell"] += sum(spells); shape["spells"] += len(spells)
            starters = {e for e, p in box.items() if p[4]}
            subs = [a for e, (s40, ot, ivs) in row.items() for a, b in ivs if a > 0.5]
            if subs:
                shape["first_sub"] += min(subs); shape["first_sub_n"] += 1
            for s in g["stints"]:
                five = s[3] if home else s[4]
                dur = abs_t(s[0], s[2]) - abs_t(s[0], s[1])
                if dur <= 0:
                    continue
                if starters and not (set(five) & starters):
                    shape["all_bench"] += dur
                if len(top2) == 2:
                    shape["stag_n"] += dur
                    shape["stag"] += dur if (top2[0] in five) != (top2[1] in five) else 0.0
            if gf is not None:
                shape["garbage"] += max(0.0, REG_SEC + PER["ot"] * g["ot"] - gf)
            shape["games"] += 1
            # early-second-foul sits
            for e, (tw, fo, early) in fs.items():
                for t in early:
                    back = next((a for a, b in row.get(e, (None, None, []))[2] if a > t + 1), None)
                    sits.append(min(back if back is not None else REG[0], REG[0]) - t)
            # closing
            if gf is None and abs(margin) <= CLOSE_MARGIN and g["stints"]:
                last = g["stints"][-1]
                five = last[3] if home else last[4]
                close["n"] += 1
                for e in five:
                    closers[e] += 1
                avail = [e for e in row if rates.get(e) is not None and e not in absent]
                best = sorted(avail, key=lambda q: -rates[q])[:5]
                if len(best) == 5 and all(rates.get(q) is not None for q in five):
                    close["gap"] += (sum(rates[q] for q in best) - sum(rates[q] for q in five)) / 5.0
                    close["gap_n"] += 1
                    ov = len(set(best) & set(five))
                    close["best"] += ov == 5
                    close["near"] += ov >= 4
            game_rows.append(dict(gid=g["gid"], date=g["date"], opp=g["away"] if home else g["home"], home=home, margin=margin, share=round(share, 4),
                                  causes=[int(cnt[k]) for k in causes], scripted=scripted, garbage=gf is not None, ot=g["ot"],
                                  iv={e: [[round(a), round(b)] for a, b in row[e][2]] for e in row if e in usual}))
        for r in rows:
            v = ptot.get(r["id"])
            if v and v[4]:
                r["off"] = round(sum(v[:4]) / v[4], 4)
                r["off_choice"] = round(v[3] / v[4], 4)
        n = max(1, shape["games"])
        months = {}
        for mon in MONTH_ORDER:
            if mon in month_on:
                months[mon] = {e: [round(100 * month_on[mon][e][m] / (60.0 * month_n[mon][e])) for m in range(REG_MIN)] for e in month_on[mon] if month_n[mon][e] >= 3}
        out[(team, coach)] = dict(
            season=season, team=team, coach=coach, games=n_games, rows=rows,
            off_script=round(sum(tot[k] for k in causes) / tot["scripted"], 4) if tot["scripted"] else None,
            by_cause={k: round(tot[k] / tot["scripted"], 4) if tot["scripted"] else None for k in causes},
            overtime_min=round(tot["ot"] / n, 2),
            after_loss=round(after["L"][0] / after["L"][1], 4) if after["L"][1] else None,
            after_win=round(after["W"][0] / after["W"][1], 4) if after["W"][1] else None,
            shape=dict(spell=round(shape["spell"] / shape["spells"] / 60.0, 2) if shape["spells"] else None,
                       first_sub=round(shape["first_sub"] / shape["first_sub_n"] / 60.0, 2) if shape["first_sub_n"] else None,
                       all_bench=round(shape["all_bench"] / n / 60.0, 2), stagger2=round(shape["stag"] / shape["stag_n"], 4) if shape["stag_n"] else None,
                       garbage=round(shape["garbage"] / n / 60.0, 2), top2=top2),
            closing=dict(close_games=close["n"], best_five=close["best"], near=close["near"], gap=round(close["gap"] / close["gap_n"], 2) if close["gap_n"] else None,
                         gap_n=close["gap_n"], closers=sorted(closers.items(), key=lambda x: -x[1])[:8]),
            sits=dict(h1=(round(sum(sits) / len(sits) / 60.0, 2), len(sits)) if sits else (None, 0)),
            months=months, game_rows=game_rows)
    return out
