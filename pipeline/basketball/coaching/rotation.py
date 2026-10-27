"""
rotation.py — the Rotation Map and what hangs off it, per coach-team-season.

    build(season, games, who) -> {(team, coach): rotation dict}   (regular season; playoffs with kind="PO")

From each game's player intervals (gamefile: when each man was on the floor, in seconds from
tip-off) this works out, for every player with 100+ minutes under a coach:

  map       for each of the 48 regulation minutes, the share of games he was on the floor
            during it (seconds-weighted), on two bases: every game the team played under this
            coach, and only the games he played. Overtime is one extra cell.
  usual     his usual windows: runs of minutes where he was on the floor in 60%+ of the games
            he played (base 2). A minute under 40% is usually off; 40-60% is ambiguous and
            not scored for deviation.
  off-script per game: the minutes in which his actual status (on for 30+ seconds of the
            minute, or off) differs from his usual one, summed over the map's players and
            divided by the scripted player-minutes. Each off-script minute gets the first
            cause that fits: absence (a usual-on man is out of the game: did not play, left
            hurt, fouled out, ejected), blowout (gamefile's garbage-time rule), foul trouble
            (he, or a usual-on man, is in foul trouble: 2 fouls in the 1st, 3 in the half,
            4 in the 3rd, 5 any time, from the foul to the end of that period, or to the end
            of the game at 5), overtime (not scripted; counted apart), choice (the rest).
  shape     depth, concentration, starters' minutes, stint length, first substitution, all-
            bench minutes, garbage-time minutes.
  closing   who was on the floor at the final buzzer of close games (within 10 at the end,
            no garbage time), and whether that five was the best five available by impact.
  foul sits seconds sat after a 2nd foul in the 1st quarter and a 4th in the 3rd.
  months    the base-2 map by month, for the small multiples.

Everything here is "the model's view, not a verdict": it cannot see fatigue, minor injuries,
match-ups or development plans.
"""
import datetime as dt
from collections import defaultdict

REG_MIN = 48
ON_SHARE, OFF_SHARE = 0.60, 0.40
MAP_MIN_MINUTES = 100.0
CLOSE_MARGIN = 10
MONTHS = [(10, "Oct-Nov"), (11, "Oct-Nov"), (12, "Dec"), (1, "Jan"), (2, "Feb"), (3, "Mar"), (4, "Apr+"), (5, "Apr+"), (6, "Apr+"), (7, "Apr+"), (8, "Apr+"), (9, "Apr+")]
MONTH_ORDER = ["Oct-Nov", "Dec", "Jan", "Feb", "Mar", "Apr+"]


def month_of(date):
    return dict(MONTHS)[int(date[5:7])]


def minute_seconds(intervals, end_abs):
    """Seconds on the floor in each regulation minute (48), plus overtime seconds."""
    sec = [0.0] * REG_MIN
    ot = 0.0
    for a0, a1 in intervals:
        a0, a1 = max(0.0, a0), min(end_abs, a1)
        if a1 <= a0:
            continue
        m = int(a0 // 60)
        t = a0
        while t < a1:
            if m >= REG_MIN:
                ot += a1 - t
                break
            edge = min(a1, (m + 1) * 60.0)
            sec[m] += edge - t
            t = edge
            m += 1
    return sec, ot


def trouble_windows(player, periods):
    """[(start_abs, end_abs)] when the man was in foul trouble."""
    out = []
    for per, clock, n, _sat in player.get("trouble") or []:
        start = sum(720.0 if q <= 4 else 300.0 for q in range(1, per)) + ((720.0 if per <= 4 else 300.0) - clock)
        end = sum(720.0 if q <= 4 else 300.0 for q in range(1, per + 1)) if n < 5 else sum(720.0 if q <= 4 else 300.0 for q in range(1, periods + 1))
        out.append((start, end))
    return out


def _in(windows, sec):
    return any(a <= sec < b for a, b in windows)


def build(season, games, who, impact=None, kind="RS", log=print):
    """games: gamefile dicts of one season (with stype). who(game, team) -> coach id or None.
    impact: {pid: bpm} for the best-five-available check."""
    impact = impact or {}
    stype = (2,) if kind == "RS" else (3, 5)
    groups = defaultdict(list)                     # (team, coach) -> [(game, team)]
    for g in games:
        if g.get("stype") not in stype:
            continue
        for team in g["team"]:
            c = who(g, team)
            if c:
                groups[(team, c)].append(g)
    out = {}
    for (team, coach), gs in groups.items():
        gs.sort(key=lambda g: g["date"])
        n_games = len(gs)
        on_all = defaultdict(lambda: [0.0] * REG_MIN)      # pid -> seconds by minute, all games
        on_live = defaultdict(lambda: [0.0] * REG_MIN)     # the same, minutes still in the balance and before any forced exit
        den_live = defaultdict(lambda: [0.0] * REG_MIN)    # seconds of each minute that count for him (not garbage, not after an exit)
        pts_all = defaultdict(float)
        ot_all = defaultdict(float)
        played = defaultdict(int)
        total_sec = defaultdict(float)
        starts = defaultdict(int)
        first_entry = defaultdict(list)
        names = {}
        per_game = []                                       # (g, {pid: (sec48, ot)})
        for g in gs:
            end_abs = 2880.0 + 300.0 * (g["periods"] - 4)
            row = {}
            for pid, p in g["players"].items():
                if p["team"] != g["team"][team]["espn"]:
                    continue
                names[pid] = p["name"]
                if p["dnp"] or p["sec"] <= 0:
                    continue
                s48, ot = minute_seconds(p["iv"], end_abs)
                row[pid] = (s48, ot)
                played[pid] += 1
                total_sec[pid] += p["sec"]
                pts_all[pid] += p["pts"]
                starts[pid] += p["starter"]
                first_entry[pid].append(p["iv"][0][0] if p["iv"] else 0.0)
                acc, live, den = on_all[pid], on_live[pid], den_live[pid]
                cut = min(x for x in (g.get("garbage_from"), p["exit_sec"] if p.get("exit") else None, 2880.0) if x is not None)
                for m in range(REG_MIN):
                    acc[m] += s48[m]
                    keep = max(0.0, min(60.0, cut - m * 60.0))
                    if keep > 0:
                        den[m] += keep
                        live[m] += min(s48[m], keep)
                ot_all[pid] += ot
            per_game.append((g, row))
        roster = [pid for pid, s in total_sec.items() if s >= MAP_MIN_MINUTES * 60]
        # order: starters first (by starts), then by usual entry time
        roster.sort(key=lambda pid: (-starts[pid] / max(1, played[pid]) if starts[pid] / max(1, played[pid]) >= 0.5 else 1,
                                     sum(first_entry[pid]) / max(1, len(first_entry[pid])), -total_sec[pid]))
        rows = []
        usual = {}
        for pid in roster:
            base_all = [round(100 * on_all[pid][m] / (60.0 * n_games)) for m in range(REG_MIN)]
            base_pl = [round(100 * on_live[pid][m] / den_live[pid][m]) if den_live[pid][m] >= 60.0 * 3 else round(100 * on_all[pid][m] / (60.0 * played[pid])) for m in range(REG_MIN)]
            status = ["on" if v >= 100 * ON_SHARE else "off" if v < 100 * OFF_SHARE else None for v in base_pl]
            usual[pid] = status
            windows, cur = [], None
            for m, st in enumerate(status):
                if st == "on" and cur is None:
                    cur = [m, m]
                elif st == "on":
                    cur[1] = m
                elif cur is not None:
                    windows.append(cur); cur = None
            if cur is not None:
                windows.append(cur)
            ot_games = sum(1 for g, row in per_game if g["periods"] > 4 and pid in row)
            rows.append(dict(id=pid, name=names.get(pid), gp=played[pid], starts=starts[pid], min=round(total_sec[pid] / 60.0, 1),
                             mpg=round(total_sec[pid] / 60.0 / played[pid], 1), all=base_all, played=base_pl, windows=windows,
                             text=describe(windows, starts[pid] / max(1, played[pid]) >= 0.5),
                             ot=round(100 * ot_all[pid] / (60.0 * 5 * max(1, ot_games))) if ot_games else None,
                             bpm=impact.get(pid)))
        # deviations per game
        causes = ["absence", "blowout", "foul", "choice"]
        game_rows = []
        tot = defaultdict(float)
        month_on = defaultdict(lambda: defaultdict(lambda: [0.0] * REG_MIN))
        month_played = defaultdict(lambda: defaultdict(int))
        closing = defaultdict(int)
        close_games = 0
        best_five_closes = 0
        gap_sum, gap_n, near = 0.0, 0, 0
        ptot = defaultdict(lambda: [0, 0, 0, 0, 0])      # pid -> off-script by cause + scripted, over the season
        closers = defaultdict(int)
        shape = defaultdict(float)
        sits = {"q1_2": [], "q3_4": []}
        prev_result = None
        after = {"W": [0.0, 0], "L": [0.0, 0]}
        hot = [0.0, 0]
        for g, row in per_game:
            tm = g["team"][team]
            end_abs = 2880.0 + 300.0 * (g["periods"] - 4)
            garbage = g.get("garbage_from")
            mon = month_of(g["date"])
            # who is out, and when
            absent_from = {}
            trouble = {}
            for pid in roster:
                p = g["players"].get(pid)
                if p is None or p["dnp"] or p["sec"] <= 0:
                    absent_from[pid] = 0.0
                else:
                    if p.get("exit") in ("left", "fouled_out", "ejected"):
                        absent_from[pid] = p["exit_sec"]
                    trouble[pid] = trouble_windows(p, g["periods"])
                    for per, clock, n, sat in p.get("trouble") or []:
                        if sat is None:
                            continue
                        if per == 1 and n == 2:
                            sits["q1_2"].append(sat)
                        elif per == 3 and n == 4:
                            sits["q3_4"].append(sat)
            cnt = defaultdict(float)
            pcnt = defaultdict(lambda: [0, 0, 0, 0, 0])      # pid -> [absence, blowout, foul, choice, scripted]
            scripted = 0
            for pid in roster:
                st = usual[pid]
                s48 = row.get(pid, ([0.0] * REG_MIN, 0.0))[0]
                for m in range(REG_MIN):
                    if st[m] is None:
                        continue
                    scripted += 1
                    pcnt[pid][4] += 1
                    actual = "on" if s48[m] >= 30.0 else "off"
                    if actual == st[m]:
                        continue
                    sec_m = m * 60.0 + 30.0
                    others_out = any(usual[q][m] == "on" and q in absent_from and absent_from[q] <= sec_m for q in roster if q != pid)
                    if (pid in absent_from and absent_from[pid] <= sec_m) or others_out:
                        cause = "absence"
                    elif garbage is not None and sec_m >= garbage:
                        cause = "blowout"
                    elif _in(trouble.get(pid, ()), sec_m) or any(usual[q][m] == "on" and _in(trouble.get(q, ()), sec_m) for q in roster if q != pid):
                        cause = "foul"
                    else:
                        cause = "choice"
                    cnt[cause] += 1
                    pcnt[pid][causes.index(cause)] += 1
            off = sum(cnt.values())
            share = off / scripted if scripted else 0.0
            for pid, v in pcnt.items():
                for k in range(5):
                    ptot[pid][k] += v[k]
            for k in causes:
                tot[k] += cnt[k]
            tot["scripted"] += scripted
            # month maps
            for pid, (s48, ot) in row.items():
                if pid in usual:
                    month_played[mon][pid] += 1
                    acc = month_on[mon][pid]
                    for m in range(REG_MIN):
                        acc[m] += s48[m]
            # shape
            mins = {pid: (sum(s48) + ot) / 60.0 for pid, (s48, ot) in row.items()}
            shape["depth10"] += sum(1 for v in mins.values() if v >= 10)
            shape["depth"] += sum(1 for v in mins.values() if v > 0)
            tot_min = sum(mins.values()) or 1.0
            shape["top5"] += sum(sorted(mins.values(), reverse=True)[:5]) / tot_min
            shape["hhi"] += sum((v / tot_min) ** 2 for v in mins.values())
            st5 = [mins.get(pid, 0.0) for pid in tm["starters"]]
            shape["starters_min"] += sum(st5)
            if tm.get("first_sub") is not None:
                shape["first_sub"] += tm["first_sub"]; shape["first_sub_n"] += 1
            spells = [a1 - a0 for pid in row for a0, a1 in g["players"][pid]["iv"]]
            shape["spell"] += sum(spells); shape["spells"] += len(spells)
            # all-bench seconds: no starter on the floor
            st_set = set(tm["starters"])
            for s in g["stints"]:
                five = s[3] if tm["home"] else s[4]
                dur = s[1] - s[2]
                if dur > 0 and not (set(five) & st_set):
                    shape["all_bench"] += dur
            if garbage is not None:
                shape["garbage"] += max(0.0, end_abs - garbage)
            shape["games"] += 1
            # closing
            final_margin = tm["pts"] - tm["opp_pts"]
            if garbage is None and abs(final_margin) <= CLOSE_MARGIN and g["stints"]:
                close_games += 1
                last = g["stints"][-1]
                five = last[3] if tm["home"] else last[4]
                for pid in five:
                    closers[pid] += 1
                avail = [pid for pid in row if row[pid][0] and impact.get(pid) is not None]
                best = sorted(avail, key=lambda q: -impact[q])[:5]
                if len(best) == 5 and all(impact.get(q) is not None for q in five):
                    gap_sum += sum(impact[q] for q in best) - sum(impact[q] for q in five)
                    gap_n += 1
                    overlap = len(set(best) & set(five))
                    best_five_closes += overlap == 5
                    near += overlap >= 4
            # after a loss / after a win
            if prev_result in after:
                after[prev_result][0] += share; after[prev_result][1] += 1
            prev_result = "W" if final_margin > 0 else "L"
            # hot hand: a man 8+ points over his average through three quarters: his 4th-quarter
            # minutes against the minutes his usual windows give him in the 4th (a tendency)
            for pid, p in g["players"].items():
                if pid not in usual or not p.get("pq") or len(p["pq"]) < 4 or g.get("garbage_from"):
                    continue
                ppg = pts_all[pid] / max(1, played[pid])
                if sum(p["pq"][:3]) >= ppg + 8:
                    usual_q4 = sum(1 for m in range(36, 48) if usual[pid][m] == "on")
                    s48 = row.get(pid, ([0.0] * REG_MIN, 0.0))[0]
                    hot[0] += sum(s48[36:48]) / 60.0 - usual_q4
                    hot[1] += 1
            game_rows.append(dict(gid=g["gid"], date=g["date"], opp=next(k for k in g["team"] if k != team), home=tm["home"],
                                  margin=final_margin, share=round(share, 4), causes=[int(cnt[k]) for k in causes], scripted=scripted,
                                  garbage=garbage is not None, ot=g["periods"] > 4,
                                  iv={pid: g["players"][pid]["iv"] for pid in row if pid in usual},
                                  pc={pid: v for pid, v in pcnt.items() if v[4]}))
        for row in rows:
            v = ptot.get(row["id"])
            if v and v[4]:
                row["off"] = round((v[0] + v[1] + v[2] + v[3]) / v[4], 4)
                row["off_choice"] = round(v[3] / v[4], 4)
        n = max(1, shape["games"])
        months = {}
        for mon in MONTH_ORDER:
            if mon not in month_on:
                continue
            months[mon] = {pid: [round(100 * month_on[mon][pid][m] / (60.0 * month_played[mon][pid])) for m in range(REG_MIN)]
                           for pid in month_on[mon] if month_played[mon][pid] >= 3}
        out[(team, coach)] = dict(
            season=season, team=team, coach=coach, kind=kind, games=n_games, rows=rows,
            off_script=round(sum(tot[k] for k in causes) / tot["scripted"], 4) if tot["scripted"] else None,
            by_cause={k: round(tot[k] / tot["scripted"], 4) if tot["scripted"] else None for k in causes},
            after_loss=round(after["L"][0] / after["L"][1], 4) if after["L"][1] else None,
            after_win=round(after["W"][0] / after["W"][1], 4) if after["W"][1] else None,
            shape=dict(depth10=round(shape["depth10"] / n, 2), depth=round(shape["depth"] / n, 2), top5=round(shape["top5"] / n, 4), hhi=round(shape["hhi"] / n, 4),
                       starters_min=round(shape["starters_min"] / n, 1), first_sub=round(shape["first_sub"] / shape["first_sub_n"], 1) if shape["first_sub_n"] else None,
                       spell=round(shape["spell"] / shape["spells"] / 60.0, 2) if shape["spells"] else None, all_bench=round(shape["all_bench"] / n / 60.0, 2),
                       garbage=round(shape["garbage"] / n / 60.0, 2)),
            hot=dict(extra_q4=round(hot[0] / hot[1], 2) if hot[1] else None, n=hot[1]),
            closing=dict(close_games=close_games, best_five=best_five_closes, near=near, gap=round(gap_sum / gap_n, 2) if gap_n else None, gap_n=gap_n,
                         closers=sorted(((pid, c) for pid, c in closers.items()), key=lambda x: -x[1])[:8]),
            sits={k: (round(sum(v) / len(v), 1), len(v)) if v else (None, 0) for k, v in sits.items()},
            months=months, game_rows=game_rows,
        )
    return out


def describe(windows, starter):
    """'Starts; sits 6:00 Q1 to 2:00 Q2; back 2:00 Q2 to the half; ...' from minute windows."""
    if not windows:
        return "No usual window"

    def clock(m):
        q = m // 12 + 1
        left = 12 - (m % 12)
        return f"{left}:00 Q{q}" if left < 12 else f"start of Q{q}"
    bits = []
    for i, (a, b) in enumerate(windows):
        if i == 0 and a == 0:
            bits.append("Starts")
        else:
            bits.append(f"in at {clock(a)}")
        end = b + 1
        if end < REG_MIN and (i + 1 >= len(windows) or windows[i + 1][0] > end):
            if end % 12 == 0:
                bits[-1] += f", sits from the end of Q{end // 12}" if end < REG_MIN else ""
            else:
                bits[-1] += f", sits at {clock(end)}"
        if end >= REG_MIN:
            bits[-1] += ", closes"
    return "; ".join(bits)
