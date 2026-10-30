"""
cts.py — one coach-team-season, every module's numbers.

    build(season, games, rows, who, impact, archive, nba, tenures) -> {(team, coach): cts dict}

A coach-team-season (CTS) is the unit everything is credited to: the games one man coached
one team in one season. Its numbers come from four places:

  gamefile dicts (process.py)   events, possessions, stints          2002-03 on
  the games table (context.py)  results, context splits              1996-97 on
  rotation.py / units.py        the Rotation Map and the lineups     2002-03 on
  nbatables.py                  tracking, hustle, Synergy, zone      their own first seasons

League baselines for the same season are computed beside each stat, so the page can show a
coach against the league of his own year and the percentile pools (modules.py) can be built
across coaches without re-reading the games.
"""
from collections import defaultdict

import rotation as RO
import units as UN

RUN_SIZES = [(6, 7), (8, 9), (10, 99)]
ERA_TIMEOUTS = lambda year: 7 if year >= 2017 else 8  # noqa: E731  a team's full timeouts in a game (2017-18 rule change)


def _div(a, b, k=100.0, nd=2):
    return round(k * a / b, nd) if b else None


def _mean(xs, nd=2):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), nd) if xs else None


def results(rows):
    rs = [r for r in rows if r["type"] == "RS"]
    po = [r for r in rows if r["type"] == "PO"]
    w, l = sum(r["w"] for r in rs), sum(1 - r["w"] for r in rs)
    pts = sum(r["pts"] for r in rs); opts = sum(r["opp_pts"] or 0 for r in rs)
    poss = sum(r["poss"] or 0 for r in rs if r.get("poss")); oposs = sum(r["opp_poss"] or 0 for r in rs if r.get("poss"))
    luck = sum(r.get("luck") or 0 for r in rs)
    net = _div(pts - opts, (poss + oposs) / 2.0) if poss else None
    close = [r for r in rs if r["margin"] is not None and abs(r["margin"]) <= 5]
    # playoff rounds: distinct opponents in order; a series is won if the team won 4 (or more games than it lost)
    series = []
    for r in sorted(po, key=lambda r: r["date"]):
        if not series or series[-1]["opp"] != r["opp"]:
            series.append(dict(opp=r["opp"], w=0, l=0))
        series[-1]["w" if r["w"] else "l"] += 1
    rounds = len(series)
    won_last = bool(series) and series[-1]["w"] > series[-1]["l"]
    return dict(g=len(rs), w=w, l=l, pct=round(w / len(rs), 3) if rs else None, pts=pts, opp_pts=opts, poss_avg=round((poss + oposs) / 2.0, 1) if poss else None,
                margin=_div(pts - opts, len(rs), 1.0), net=net, adj_net=_div(pts - opts + luck, (poss + oposs) / 2.0) if poss else None,
                pg=len(po), pw=sum(r["w"] for r in po), pl=sum(1 - r["w"] for r in po), rounds=rounds, won_last=won_last, series=series,
                close_g=len(close), close_w=sum(r["w"] for r in close), home_w=sum(r["w"] for r in rs if r["home"]), home_g=sum(1 for r in rs if r["home"]),
                ortg=_div(pts, poss) if poss else None, drtg=_div(opts, oposs) if oposs else None, pace=_mean([r.get("pace") for r in rs], 1))


def game_management(gs, team, rows_by_gid, year):
    """Timeouts, runs, after-timeout plays, challenges, halves, late game, clutch for one CTS."""
    to_n = to_run = unused = close_finishes = adv = 0
    ato = defaultdict(lambda: [0.0, 0])        # key -> [pts, poss]
    hc = [0.0, 0]
    runs = {k: {"to": [0.0, 0, 0], "no": [0.0, 0, 0]} for k in RUN_SIZES}   # pts, poss, events
    ch = defaultdict(int)
    q3 = []
    fu3 = [0, 0]; two41 = [0, 0]; eoq = [0.0, 0]; chase = [0, 0]
    clutch = [0.0, 0, 0.0, 0]
    tf = 0
    for g in gs:
        tm = g["team"][team]
        espn = tm["espn"]
        opp = next(k for k in g["team"] if k != team)
        oespn = g["team"][opp]["espn"]
        mine = [t for t in g["timeouts"] if t["team"] == espn]
        to_n += len(mine)
        to_run += sum(1 for t in mine if t["run"] >= 6)
        adv += sum(1 for t in mine if t["advance"])
        final = tm["pts"] - tm["opp_pts"]
        if abs(final) <= 5 and g.get("garbage_from") is None:
            close_finishes += 1
            used_full = sum(1 for t in mine if t["kind"] == "full")
            unused += max(0, ERA_TIMEOUTS(year) - used_full)
        for t in mine:
            if t["ato_pts"] is None or t["ato_side"] is None:
                continue
            key = ("own" if t["ato_side"] == "own" else "opp") + ("_late" if t["late"] else "")
            ato[key][0] += t["ato_pts"]; ato[key][1] += 1
        # normal half-court: possessions starting from a dead ball or a make, not after a timeout
        for q in g["poss"]:
            if q[0] == espn and q[5] in ("make", "dead") and q[7] is None:
                hc[0] += q[4]; hc[1] += 1
        for r in g["runs"]:
            if r["team"] != espn:
                continue
            for lo, hi in RUN_SIZES:
                if lo <= r["size"] <= hi:
                    b = runs[(lo, hi)]["to" if r["timeout"] else "no"]
                    b[0] += r["next_opp"][0]; b[1] += r["next_opp"][1]; b[2] += 1
        for c in g["challenges"]:
            if c["team"] != espn:
                continue
            ch["n"] += 1
            ch[c["result"] or "unknown"] += 1
            ch["q4"] += c["per"] >= 4
            ch["to_lost"] += bool(c["timeout_lost"])
        tq, oq = tm["q_pts"], g["team"][opp]["q_pts"]
        tp, op_ = tm["q_poss"], g["team"][opp]["q_poss"]
        if len(tq) >= 3:
            h1 = 100.0 * ((tq[0] + tq[1]) - (oq[0] + oq[1])) / max(1, (tp[0] + tp[1] + op_[0] + op_[1]) / 2.0)
            q3n = 100.0 * (tq[2] - oq[2]) / max(1, (tp[2] + op_[2]) / 2.0)
            q3.append(q3n - h1)
        for f in g["foul_up3"]:
            if f["team"] == espn:
                fu3[1] += 1; fu3[0] += f["fouled"]
        for x in g["two_for_one"]:
            if x["team"] == espn:
                two41[1] += 1; two41[0] += x["another"]
        for x in g["late_poss"]:
            if x["team"] == espn and x["start"] <= 24.0 and x["per"] <= 4:
                eoq[0] += x["pts"]; eoq[1] += 1
        c = tm["chase"]
        chase[0] += c[0]; chase[1] += c[1]
        cl = tm["clutch"]
        clutch[0] += cl["pts"]; clutch[1] += cl["poss"]; clutch[2] += cl["opp_pts"]; clutch[3] += cl["opp_poss"]
        tf += tm["box"].get("take", 0)
    n = len(gs) or 1
    run_out = {}
    for k, v in runs.items():
        run_out[f"{k[0]}-{k[1] if k[1] < 99 else ''}"] = dict(to_ppp=_div(v["to"][0], v["to"][1], 1.0, 3), to_n=v["to"][2], no_ppp=_div(v["no"][0], v["no"][1], 1.0, 3), no_n=v["no"][2])
    return dict(
        to_g=round(to_n / n, 2), to_run_share=_div(to_run, to_n, 1.0, 3), unused_close=_div(unused, close_finishes, 1.0, 2), close_finishes=close_finishes, adv_to=adv,
        ato_own=_div(ato["own"][0], ato["own"][1], 1.0, 3), ato_own_n=ato["own"][1], ato_opp=_div(ato["opp"][0], ato["opp"][1], 1.0, 3), ato_opp_n=ato["opp"][1],
        ato_late=_div(ato["own_late"][0], ato["own_late"][1], 1.0, 3), ato_late_n=ato["own_late"][1], hc_ppp=_div(hc[0], hc[1], 1.0, 3),
        runs=run_out, challenges=dict(ch), ch_g=round(ch["n"] / n, 3), ch_success=_div(ch["overturned"], ch["n"], 1.0, 3) if ch["n"] else None,
        halftime=_mean(q3), foul_up3=_div(fu3[0], fu3[1], 1.0, 3), foul_up3_n=fu3[1], two41=_div(two41[0], two41[1], 1.0, 3), two41_n=two41[1], two41_g=round(two41[1] / n, 2),
        eoq_ppp=_div(eoq[0], eoq[1], 1.0, 3), eoq_n=eoq[1], chase=_div(chase[0], chase[1], 1.0, 3), chase_n=chase[1], take_g=round(tf / n, 2),
        clutch_net=(round(100.0 * clutch[0] / clutch[1] - 100.0 * clutch[2] / clutch[3], 1) if clutch[1] and clutch[3] else None), clutch_poss=clutch[1],
    )


def identity(gs, team, rows):
    """Offensive and defensive identity from the play-by-play (pace, shot diet, transition, fouls)."""
    agg = defaultdict(float)
    diet = defaultdict(lambda: [0, 0]); odiet = defaultdict(lambda: [0, 0])
    poss_len = [0.0, 0]
    early = [0, 0]
    for g in gs:
        tm = g["team"][team]
        opp = next(k for k in g["team"] if k != team)
        o = g["team"][opp]
        for k, v in tm["box"].items():
            agg[k] += v
        for k, v in o["box"].items():
            agg["o_" + k] += v
        agg["poss"] += tm["poss"]; agg["o_poss"] += tm["opp_poss"]; agg["pts"] += tm["pts"]; agg["o_pts"] += tm["opp_pts"]
        agg["sec"] += 2880.0 + 300.0 * (g["periods"] - 4)
        for z, v in tm["diet"].items():
            diet[z][0] += v[0]; diet[z][1] += v[1]
        for z, v in o["diet"].items():
            odiet[z][0] += v[0]; odiet[z][1] += v[1]
        agg["trans_fga"] += tm["trans"][0]; agg["o_trans_fga"] += o["trans"][0]
        for q in g["poss"]:
            if q[0] == tm["espn"]:
                poss_len[0] += max(0.0, q[3] - q[2]); poss_len[1] += 1
                early[1] += 1; early[0] += (q[3] - q[2]) <= 7.0
    fga, ofga, poss, oposs = agg["fga"], agg["o_fga"], agg["poss"], agg["o_poss"]
    return dict(
        pace=round(48.0 * (poss + oposs) / 2 / (agg["sec"] / 60.0), 1) if agg["sec"] else None, sec_poss=_div(poss_len[0], poss_len[1], 1.0, 2), early_share=_div(early[0], early[1], 1.0, 3),
        trans_share=_div(agg["trans_fga"], fga, 1.0, 3), o_trans_share=_div(agg["o_trans_fga"], ofga, 1.0, 3),
        fg3r=_div(agg["fg3a"], fga, 1.0, 3), ftr=_div(agg["fta"], fga, 1.0, 3), ast_pct=_div(agg["ast"], agg["fgm"], 1.0, 3), tov_pct=_div(agg["tov"], poss, 100.0, 1),
        orb_pct=_div(agg["oreb"], agg["oreb"] + agg["o_dreb"], 1.0, 3), drb_pct=_div(agg["dreb"], agg["dreb"] + agg["o_oreb"], 1.0, 3),
        efg=_div(agg["fgm"] + 0.5 * agg["fg3m"], fga, 1.0, 3), o_efg=_div(agg["o_fgm"] + 0.5 * agg["o_fg3m"], ofga, 1.0, 3),
        o_fg3r=_div(agg["o_fg3a"], ofga, 1.0, 3), o_ftr=_div(agg["o_fta"], ofga, 1.0, 3), o_tov_pct=_div(agg["o_tov"], oposs, 100.0, 1), stl100=_div(agg["stl"], oposs), blk100=_div(agg["blk"], oposs),
        pf100=_div(agg["pf"], oposs), o_pf100=_div(agg["o_pf"], poss),
        diet={z: [_div(v[0], fga, 1.0, 3), _div(v[1], v[0], 1.0, 3)] for z, v in diet.items()},
        o_diet={z: [_div(v[0], ofga, 1.0, 3), _div(v[1], v[0], 1.0, 3)] for z, v in odiet.items()},
        ortg=_div(agg["pts"], poss), drtg=_div(agg["o_pts"], oposs),
    )


SPLITS = {
    "opp_tier": ("opp_tier_prior", lambda r: r.get("opp_tier_prior")),
    "opp_final": ("opponent by season-end strength", lambda r: None if r.get("opp_net_final") is None else "top" if r["opp_net_final"] >= 3 else "bottom" if r["opp_net_final"] <= -3 else "middle"),
    "opp_playoff": ("vs playoff teams", lambda r: "playoff" if r.get("opp_playoff") else "lottery"),
    "home": ("home / away", lambda r: "neutral" if r.get("neutral") else "home" if r["home"] else "away"),
    "rest": ("rest days", lambda r: None if r.get("rest_days") is None else "b2b" if r["rest_days"] == 0 else "1 day" if r["rest_days"] == 1 else "2 days" if r["rest_days"] == 2 else "3+ days"),
    "rest_adv": ("rest advantage", lambda r: None if r.get("rest_days") is None or r.get("opp_rest_days") is None else "more" if r["rest_days"] > r["opp_rest_days"] else "less" if r["rest_days"] < r["opp_rest_days"] else "same"),
    "three_in_four": ("3 in 4 nights", lambda r: "3in4" if r.get("three_in_four") else "no"),
    "trip": ("road trip game", lambda r: None if not r.get("trip_game") else "1" if r["trip_game"] == 1 else "2" if r["trip_game"] == 2 else "3+"),
    "travel": ("miles travelled", lambda r: None if r.get("travel_miles") is None else "0" if r["travel_miles"] < 50 else "<500" if r["travel_miles"] < 500 else "500-1500" if r["travel_miles"] < 1500 else "1500+"),
    "tz": ("time zones crossed", lambda r: None if r.get("tz_shift") is None else "0" if r["tz_shift"] == 0 else "1" if abs(r["tz_shift"]) == 1 else "2+"),
    "altitude": ("altitude", lambda r: None if r.get("alt") is None else "high (Denver, Utah, Mexico City)" if r["alt"] >= 1200 else "normal"),
    "missing": ("regulars missing, by impact", lambda r: None if r.get("missing_impact") is None else "none" if not r.get("missing") else "<5" if r["missing_impact"] < 5 else "5+"),
    "starters": ("starting five", lambda r: None if r.get("starters_same") is None else "same as last game" if r["starters_same"] else "changed"),
    "half": ("at the half", lambda r: None if r.get("h1_margin") is None else "leading" if r["h1_margin"] > 0 else "trailing" if r["h1_margin"] < 0 else "tied"),
    "market": ("the market", lambda r: None if r.get("spread") is None else "favoured" if r["spread"] < 0 else "underdog" if r["spread"] > 0 else "pick"),
    "phase": ("season phase", lambda r: r.get("phase")),
    "ot": ("overtime", lambda r: "OT" if r.get("ot") else "regulation"),
}


def splits(rows):
    """Record, net rating and pace in every bucket of every split, regular season."""
    rs = [r for r in rows if r["type"] == "RS"]
    out = {}
    for key, (label, fn) in SPLITS.items():
        buckets = defaultdict(lambda: dict(g=0, w=0, pts=0, opts=0, poss=0.0, pace=[]))
        for r in rs:
            b = fn(r)
            if b is None:
                continue
            x = buckets[b]
            x["g"] += 1; x["w"] += r["w"]; x["pts"] += r["pts"]; x["opts"] += r["opp_pts"] or 0
            if r.get("poss"):
                x["poss"] += (r["poss"] + r["opp_poss"]) / 2.0
            if r.get("pace"):
                x["pace"].append(r["pace"])
        out[key] = {b: dict(g=x["g"], w=x["w"], l=x["g"] - x["w"], net=_div(x["pts"] - x["opts"], x["poss"]) if x["poss"] else None,
                            margin=_div(x["pts"] - x["opts"], x["g"], 1.0, 1), pace=_mean(x["pace"], 1)) for b, x in buckets.items()}
    # tempo control and the market, as numbers
    tc = [r.get("tempo_toward_own") for r in rs if r.get("tempo_toward_own") is not None]
    out["tempo"] = dict(toward_own=_mean(tc, 3), n=len(tc), vs_expected=_mean([r.get("tempo_vs_expected") for r in rs], 2))
    sp = [r for r in rs if r.get("spread") is not None]
    out["market_n"] = dict(games=len(sp), cover=_div(sum(1 for r in sp if r.get("cover") == 1), sum(1 for r in sp if r.get("cover") is not None), 1.0, 3),
                           avg_spread=_mean([r["spread"] for r in sp], 2), margin_vs_spread=_mean([r["margin"] + r["spread"] for r in sp if r.get("margin") is not None], 2),
                           over=_div(sum(1 for r in sp if r.get("over") == 1), sum(1 for r in sp if r.get("over") is not None), 1.0, 3))
    wp = [r for r in rs if r.get("wp_min") is not None]
    out["wp"] = dict(games=len(wp), comebacks=sum(1 for r in wp if r["w"] and r["wp_min"] <= 0.10), blown=sum(1 for r in wp if not r["w"] and r["wp_max"] >= 0.90),
                     comeback10=sum(1 for r in rs if r.get("comeback")), blown10=sum(1 for r in rs if r.get("blown")))
    offs = defaultdict(lambda: [0, 0, 0])
    for r in rs:
        for o in r.get("officials") or []:
            offs[o][0] += 1; offs[o][1] += r["w"]; offs[o][2] += (r.get("pf") or 0) + (r.get("o_pf") or 0)
    out["officials"] = sorted(([o, v[0], v[1], round(v[2] / v[0], 1)] for o, v in offs.items()), key=lambda x: -x[1])[:12]
    out["fouls"] = dict(called=_mean([(r.get("pf") or 0) + (r.get("o_pf") or 0) for r in rs if r.get("pf") is not None], 1),
                        ftr_game=_mean([r.get("ftr") for r in rs], 3))
    return out


def minutes_vs_impact(rot, impact, archive):
    """Minutes share against impact for the Rotation Map's players; youth trust."""
    rows = []
    for r in rot["rows"]:
        a = archive.get(r["id"], {})
        rows.append(dict(id=r["id"], name=r["name"], mpg=r["mpg"], gp=r["gp"], min=r["min"], bpm=impact.get(r["id"]), age=a.get("age"), exp=a.get("exp"), arch=a.get("arch")))
    young = [x for x in rows if x["age"] is not None and x["age"] <= 23.5]
    tot = sum(x["min"] for x in rows) or 1.0
    return dict(players=rows, young_min_share=round(sum(x["min"] for x in young) / tot, 3), young_bpm=_mean([x["bpm"] for x in young]),
                rookie_min_share=round(sum(x["min"] for x in rows if x["exp"] == 1) / tot, 3))


def playoffs_block(rs_rot, po_rot, po_games, team):
    if not po_rot:
        return None
    rs_top = sorted(rs_rot["rows"], key=lambda r: -r["mpg"])[:3] if rs_rot else []
    po_by = {r["id"]: r for r in po_rot["rows"]}
    star = _mean([po_by[r["id"]]["mpg"] - r["mpg"] for r in rs_top if r["id"] in po_by], 1)
    # game-to-game: starting five changes and minute reshuffles inside series
    changes = 0; after_loss = [0, 0]
    prev = None
    for g in sorted(po_games, key=lambda g: g["date"]):
        tm = g["team"][team]
        opp = next(k for k in g["team"] if k != team)
        if prev and prev[0] == opp:
            changes += set(tm["starters"]) != set(prev[1])
            if prev[2] < 0:
                after_loss[1] += 1; after_loss[0] += tm["pts"] > tm["opp_pts"]
        prev = (opp, tm["starters"], tm["pts"] - tm["opp_pts"])
    return dict(depth10=po_rot["shape"]["depth10"], rs_depth10=rs_rot["shape"]["depth10"] if rs_rot else None, star_extra=star,
                lineup_changes=changes, games=po_rot["games"], after_loss_w=after_loss[0], after_loss_g=after_loss[1], off_script=po_rot["off_script"])


def build(season, games, rows, who, impact, archive, nba, lg, log=print):
    """games: gamefile dicts; rows: context rows; who(g, team) -> coach; nba: nbatables.team_season(season)."""
    year = int(season[:4])
    by_cts = defaultdict(list)
    rows_by = defaultdict(list)
    for r in rows:
        if r.get("coach"):
            rows_by[(r["team"], r["coach"])].append(r)
    gs_by = defaultdict(list)
    for g in games:
        for team in g["team"]:
            c = who(g, team)
            if c:
                gs_by[(team, c)].append(g)
    arch_map = {pid: v.get("arch") for pid, v in archive.items() if v.get("arch")}
    rot_rs = RO.build(season, games, who, impact=impact, kind="RS")
    rot_po = RO.build(season, games, who, impact=impact, kind="PO")
    un_rs = UN.build(season, games, who, impact, lg, arch_map, kind="RS")
    out = {}
    for key, rws in rows_by.items():
        team, coach = key
        gs = [g for g in gs_by.get(key, []) if g.get("stype") == 2]
        po = [g for g in gs_by.get(key, []) if g.get("stype") in (3, 5)]
        cts = dict(season=season, team=team, coach=coach, results=results(rws), splits=splits(rws))
        if gs:
            cts["management"] = game_management(gs, team, None, year)
            cts["identity"] = identity(gs, team, rws)
        r = rot_rs.get(key)
        if r:
            cts["rotation"] = {k: v for k, v in r.items() if k not in ("rows", "game_rows", "months")}
            cts["mvi"] = minutes_vs_impact(r, impact, archive)
        u = un_rs.get(key)
        if u:
            top = u["units5"][:1]
            cts["units"] = dict(n5=len(u["units5"]), n2=len(u["units2"]), top=top, stagger=u["stagger"], team=u["team_rates"],
                                oppq=u["team_rates"]["oppq"] if u["team_rates"] else None)
        cts["playoffs"] = playoffs_block(r, rot_po.get(key), po, team)
        cts["nba"] = nba.get(team)
        out[key] = cts
    return out, rot_rs, rot_po, un_rs
