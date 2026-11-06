"""
cts.py — one coach-team-season: every stat in config.STATS that is computed from games, plus the
detail the page draws (splits, management, identity) and the Data Room's game and decision rows.

    season(s, C) -> ({(team, coach): cts}, league)       C: the season's inputs (build.py assembles it)

Conventions, the same in every row:
  * A team-game belongs to the head coach of record for that game (registry.py).
  * Possession-based rows use College Savant's possession log, garbage time out (its safe-lead rule),
    in games its play-by-play gate passes. Box-score rows use every game with a box.
  * "Game adjusted net" = 100 × (margin − home edge) ÷ possessions + the opponent's adjusted net: what
    the game says about the team's own rating. Context gaps compare these, so the opponent is already
    accounted for.
  * Opponent strength "as of the game date" is a ridge rating on the season's earlier games only,
    blended with last season's final rating until a team has ten games (ratings_by_date).
"""
import math
from collections import Counter, defaultdict

import numpy as np

import config as CF

POSS_PER_PT = 0.69
RUN_BINS = ((6, 7), (8, 9), (10, 99))
CLS = {"Fr": 1, "So": 2, "Jr": 3, "Sr": 4, "Gr": 5}


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def pct(a, b):
    return 100.0 * a / b if b else None


def bin_of(run):
    for i, (a, b) in enumerate(RUN_BINS):
        if a <= run <= b:
            return i
    return None


def box_poss(b):
    return b["fga"] - b["oreb"] + b["tov"] + 0.475 * b["fta"]


def game_poss(g, t):
    x = g["team"].get(t)
    if not x:
        return None
    o = g["team"].get(g["away"] if t == g["home"] else g["home"])
    if g["pbp_ok"] and x["poss"] and o and o["poss"]:
        return (x["poss"] + o["poss"]) / 2.0
    return (box_poss(x["box"]) + box_poss(o["box"])) / 2.0 if o else box_poss(x["box"])


def ratings_by_date(games, prev_nets, lam=40.0):
    """{date: {team: rating}} using only games before the date: ridge on margin per 100 with a home edge,
    shrunk toward last season's final net (prior weight equivalent to `lam` possessions-games). The normal
    equations are accumulated game by game, so each date is one solve (the same ridge solution)."""
    dates = sorted({g["date"] for g in games})
    d1 = sorted({t for g in games for t in (g["home"], g["away"]) if t not in g["non_d1"]})
    ix = {t: i for i, t in enumerate(d1)}
    n = len(d1)
    gs = sorted((g for g in games if not g["non_d1"]), key=lambda g: g["date"])
    prior = np.array([prev_nets.get(t, {}).get("net", -5.0) or -5.0 for t in d1], float)
    reg = lam / 10.0
    M = np.zeros((n + 1, n + 1))
    M[:n, :n] = np.eye(n) * reg
    M[n, n] = 1e-9
    v = np.zeros(n + 1)
    v[:n] = prior * reg
    out = {}
    gi = 0
    seen = 0
    for d in dates:
        while gi < len(gs) and gs[gi]["date"] < d:
            g = gs[gi]
            p = game_poss(g, g["home"]) or 68.0
            h, a, hm = ix[g["home"]], ix[g["away"]], 0.0 if g["neutral"] else 1.0
            m = 100.0 * (g["hs"] - g["as_"]) / p
            for i, ci in ((h, 1.0), (a, -1.0), (n, hm)):
                if ci == 0.0:
                    continue
                v[i] += ci * m
                for j, cj in ((h, 1.0), (a, -1.0), (n, hm)):
                    if cj != 0.0:
                        M[i, j] += ci * cj
            gi += 1
            seen += 1
        if not seen:
            out[d] = {t: float(prior[i]) for t, i in ix.items()}
            continue
        sol = np.linalg.solve(M, v)
        out[d] = {t: float(sol[i]) for t, i in ix.items()}
    return out


def season(s, C):
    G = C["games"]
    who = C["who"]
    nets = C["nets"]
    sig, hca, nd_rate = C["margin"]
    slope = C["spread_slope"]
    exp = C["expect"]
    rows_by_team = C["rosters"]
    rate = {r["eid"]: r for t in rows_by_team.values() for r in t}
    by_date = C["by_date"]
    allowed = CF.timeouts_allowed(s)
    # ---------------------------------------------------------------- league baselines
    half_diffs = []
    run_ctrl = defaultdict(lambda: [0.0, 0])
    lg = defaultdict(float)
    for g in G:
        if not g["pbp_ok"] or g["non_d1"]:
            continue
        for t in (g["home"], g["away"]):
            d = half_diff(g, t)
            if d is not None:
                half_diffs.append(d)
            for b, treated, out_pts in (run_events(g, t) if g.get("media") else ()):
                if not treated:
                    run_ctrl[b][0] += out_pts; run_ctrl[b][1] += 1
    half_mean = float(np.mean(half_diffs)) if half_diffs else 0.0
    run_base = {b: v[0] / v[1] for b, v in run_ctrl.items() if v[1]}
    # ---------------------------------------------------------------- per coach-team-season
    acc = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    detail = defaultdict(lambda: dict(g=0, w=0, l=0, cw=0, cl=0, games=[], decisions=[], splits=defaultdict(lambda: [0, 0, 0, 0.0, 0.0, 0.0])))
    minutes_by_month = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
    for g in G:
        for t in (g["home"], g["away"]):
            if t in g["non_d1"]:
                continue
            c = who.get(g["gid"], {}).get(t)
            if not c:
                continue
            k = (t, c)
            D = detail[k]
            A = acc[k]
            home = t == g["home"]
            o = g["away"] if home else g["home"]
            pts, opp = (g["hs"], g["as_"]) if home else (g["as_"], g["hs"])
            won = pts > opp
            margin = pts - opp
            D["g"] += 1; D["w"] += won; D["l"] += not won
            if g["conf"]:
                D["cw"] += won; D["cl"] += not won
            poss = game_poss(g, t) or 68.0
            on = nets.get(o, {}).get("net") if o not in g["non_d1"] else None
            edge = 0.0 if g["neutral"] else (hca if home else -hca)
            res = (100.0 * (margin - edge) / poss + on) if on is not None else None
            # record and expectation
            A["winpct"][0] += 100.0 * won; A["winpct"][1] += 1
            if abs(margin) <= 5:
                A["close_pct"][0] += 100.0 * won; A["close_pct"][1] += 1
            e = exp.get(t)
            pwin = None
            if e is not None:
                pwin = nd_rate if on is None else phi(((e["exp_net"] - on) * POSS_PER_PT + edge) / sig)
                A["w_roster"][0] += won - pwin; A["w_roster"][1] += 1
                if C.get("res_b") is not None and C["spend"].get(t) is not None:
                    pe = nd_rate if on is None else phi(((e["exp_net"] + C["res_b"] * (C["spend"][t] - 50) / 100.0 - on) * POSS_PER_PT + edge) / sig)
                    A["w_resources"][0] += won - pe; A["w_resources"][1] += 1
            if res is not None:
                A["_res"][0] += res * poss; A["_res"][1] += poss
                if e is not None:
                    A["net_roster"][0] += (res - e["exp_net"]) * poss; A["net_roster"][1] += poss
            sp = (g.get("line") or {}).get("spread")
            if sp is None:
                sp = C["lines"].get(g["gid"])
            own_sp = None
            if sp is not None:
                own_sp = sp if home else -sp
                pw = 1 / (1 + math.exp(slope * own_sp))
                A["w_spread"][0] += won - pw; A["w_spread"][1] += 1
                cov = margin + own_sp
                if cov != 0:
                    A["ats"][0] += 100.0 * (cov > 0); A["ats"][1] += 1
                A["gap_fav" + ("_f" if own_sp < 0 else "_d")][0] += cov; A["gap_fav" + ("_f" if own_sp < 0 else "_d")][1] += 1
            # context splits (game adjusted net)
            prior_r = by_date.get(g["date"], {})
            rk = None
            if o in prior_r:
                order = sorted(prior_r.values(), reverse=True)
                rk = 1 + sum(1 for v in order if v > prior_r[o])
            month = int(g["date"][5:7])
            phase = "nov_dec" if month in (10, 11, 12) else "march" if month in (3, 4) else "jan_feb"
            venue = "neutral" if g["neutral"] else ("home" if home else "road")
            tier = None if rk is None else ("top50" if rk <= 50 else "51-150" if rk <= 150 else "151+")
            miss = missing_value(g, t, rows_by_team.get(t, []))
            for name, val in (("venue", venue), ("tier", tier), ("conf", "conf" if g["conf"] else "nonconf"), ("phase", phase),
                              ("strength", "missing" if miss else "full")):
                if val is None:
                    continue
                sp_ = D["splits"][f"{name}:{val}"]
                sp_[0] += 1; sp_[1] += won; sp_[2] += not won
                if res is not None:
                    sp_[3] += res * poss; sp_[4] += poss
                sp_[5] += poss * 40.0 / (40.0 + 5 * g["ot"])
            if res is not None:
                for key, cond in (("gap_q1_in", tier == "top50"), ("gap_q1_out", tier is not None and tier != "top50"),
                                  ("gap_road_in", venue == "road"), ("gap_road_out", venue == "home"),
                                  ("gap_conf_in", bool(g["conf"])), ("gap_conf_out", not g["conf"]),
                                  ("gap_missing_in", bool(miss)), ("gap_missing_out", not miss),
                                  ("gap_march_in", phase == "march"), ("gap_march_out", phase == "nov_dec")):
                    if cond:
                        A[key][0] += res * poss; A[key][1] += poss
            if not g["conf"] and g["stype"] == 2 and on is not None:
                A["nc_sos"][0] += on; A["nc_sos"][1] += 1
            # tempo control
            tt, to_ = nets.get(t, {}).get("tempo"), nets.get(o, {}).get("tempo")
            if tt and to_ and abs(tt - to_) >= 2 and g["pbp_ok"]:
                pace = poss * 40.0 / (40.0 + 5 * g["ot"])
                A["tempo_ctl"][0] += 100.0 * min(1.5, max(-0.5, (pace - to_) / (tt - to_))); A["tempo_ctl"][1] += 1
            # box identity and rotation shape
            # Box rates count D1-against-D1 games only and turnovers per box-estimated possession, which is
            # how College Savant's four factors count them, so the figures the two pages share are one
            # number (Nov 6 2026: counting every game put 2,900 of 4,801 team-seasons off College Savant's
            # eFG% allowed and both rebound rates, and the play-by-play denominator 4,088 off its TOV%).
            bx, ob = g["team"][t]["box"], g["team"][o]["box"] if o in g["team"] else None
            if ob and bx["fga"] and not g["non_d1"]:
                op = box_poss(ob) if not g["pbp_ok"] else (g["team"][o]["poss"] or box_poss(ob))
                for key, num, den in (("fg3r", 100 * bx["fg3a"], bx["fga"]), ("ftr", 100 * bx["fta"], bx["fga"]), ("ast_pct", 100 * bx["ast"], bx["fgm"]),
                                      ("orb_pct", 100 * bx["oreb"], bx["oreb"] + ob["dreb"]), ("drb_pct", 100 * bx["dreb"], bx["dreb"] + ob["oreb"]),
                                      ("o_fg3r", 100 * ob["fg3a"], ob["fga"]), ("o_ftr", 100 * ob["fta"], ob["fga"]),
                                      ("o_efg", 100 * (ob["fgm"] + 0.5 * ob["fg3m"]), ob["fga"]), ("tov_pct", 100 * bx["tov"], box_poss(bx)),
                                      ("o_tov", 100 * ob["tov"], box_poss(ob)), ("stl100", 100 * bx["stl"], op), ("pf100", 100 * bx["pf"], op)):
                    if den:
                        A["_" + key][0] += num; A["_" + key][1] += den
                A["_games_box"][1] += 1
            players = [p for p in g["players"] if p[1] == t and (p[3] or p[2])]
            mins = sorted((p[3] for p in players), reverse=True)
            tm = 200.0 + 25.0 * g["ot"]
            if mins:
                A["depth10"][0] += sum(1 for m in mins if m >= 10); A["depth10"][1] += 1
                A["top7share"][0] += 100.0 * sum(mins[:7]) / tm; A["top7share"][1] += 1
                A["starters_min"][0] += sum(p[3] for p in players if p[4]); A["starters_min"][1] += 1
                mm = minutes_by_month[k]["conf" if g["conf"] else ("early" if month in (10, 11, 12) else "other")]
                for p in players:
                    r = rate.get(p[0])
                    if r and r["src"] == "hs" and r["cls"] == "Fr":
                        mm[0] += p[3]
                    if r and r["src"] == "transfer":
                        mm[1] += p[3]
                    mm[2] += p[3]
            # possession-based: management and identity
            if g["pbp_ok"]:
                pbp_rows(g, t, home, A, D, allowed, run_base, half_mean, margin, s, c)
            D["games"].append([g["date"], g["gid"], o, "N" if g["neutral"] else ("H" if home else "A"), int(bool(g["conf"])), g["stype"], pts, opp, g["ot"],
                               round(poss, 1), None if res is None else round(res, 1), None if pwin is None else round(pwin, 3), own_sp,
                               rk, len(team_timeouts(g, t)), sum(1 for x in g.get("ch") or [] if x[2] == t), miss])
    # ---------------------------------------------------------------- finish the values
    out = {}
    for k, A in acc.items():
        D = detail[k]
        v = {}

        def put(key, val, n):
            if val is not None and n:
                v[key] = [round(float(val), 4), int(round(n))]
        put("winpct", A["winpct"][0] / A["winpct"][1], A["winpct"][1])
        if A["close_pct"][1]:
            put("close_pct", A["close_pct"][0] / A["close_pct"][1], A["close_pct"][1])
        for key in ("w_roster", "w_spread", "w_resources"):
            if A[key][1]:
                put(key, A[key][0], A[key][1])
        if A["net_roster"][1]:
            put("net_roster", A["net_roster"][0] / A["net_roster"][1], D["g"])
        if A["ats"][1]:
            put("ats", A["ats"][0] / A["ats"][1], A["ats"][1])
        for key in ("fg3r", "ftr", "ast_pct", "orb_pct", "drb_pct", "o_fg3r", "o_ftr", "o_efg", "tov_pct", "o_tov", "stl100", "pf100"):
            if A["_" + key][1]:
                put(key, A["_" + key][0] / A["_" + key][1], A["_games_box"][1])
        for key in ("depth10", "top7share", "starters_min", "tempo_ctl"):
            if A[key][1]:
                put(key, A[key][0] / A[key][1], A[key][1])
        for key in ("gap_q1", "gap_road", "gap_conf", "gap_missing", "gap_march"):
            a, b = A[key + "_in"], A[key + "_out"]
            if a[1] and b[1]:
                n_in = sum(1 for x in D["games"] if _split_hit(key, x))
                put(key, a[0] / a[1] - b[0] / b[1], n_in)
        if A["nc_sos"][1]:
            put("nc_sos", A["nc_sos"][0] / A["nc_sos"][1], A["nc_sos"][1])
        f, d = A["gap_fav_f"], A["gap_fav_d"]
        if f[1] and d[1]:
            put("gap_fav", f[0] / f[1] - d[0] / d[1], min(f[1], d[1]))
        mm = minutes_by_month.get(k, {})
        if mm.get("conf") and mm.get("early") and mm["conf"][2] and mm["early"][2]:
            put("fresh_rise", 100 * (mm["conf"][0] / mm["conf"][2] - mm["early"][0] / mm["early"][2]), D["g"])
            put("transfer_rise", 100 * (mm["conf"][1] / mm["conf"][2] - mm["early"][1] / mm["early"][2]), D["g"])
        for key in PBP_KEYS:
            x = A.get(key)
            if x and x[1]:
                n = A.get(key + "_n", [0, x[1]])[1] if key in RATIO_N else x[1]
                put(key, x[0] / x[1], n)
        if A["unused"][1]:
            put("unused", A["unused"][0] / A["unused"][1], A["unused"][1])
        if A["to_g"][1]:
            put("to_g", A["to_g"][0] / A["to_g"][1], A["to_g"][1])
        if A["ch_g"][1] and s >= CF.CHALLENGE_FIRST:
            put("ch_g", A["ch_g"][0] / A["ch_g"][1], A["ch_g"][1])
        if A["two41"][1]:
            put("two41", A["two41"][0] / A["two41"][1], A["two41"][1])
        if A["run_stop"][1]:
            put("run_stop", A["run_stop"][0] / A["run_stop"][1], A["run_stop"][1])
        if A["halftime"][1]:
            put("halftime", A["halftime"][0] / A["halftime"][1], A["halftime"][1])
        if A["clutch_o"][1] and A["clutch_d"][1]:
            # College Savant's clutch net: own points per 100 minus the opponents', each on its own possessions
            n = A["clutch_o"][1] + A["clutch_d"][1]
            put("clutch_net", 100 * (A["clutch_o"][0] / A["clutch_o"][1] - A["clutch_d"][0] / A["clutch_d"][1]), n)
        if A["ato"][1] and A["deadball"][1]:
            put("ato_vs", A["ato"][0] / A["ato"][1] - A["deadball"][0] / A["deadball"][1], A["ato"][1])
        for key in ("rim", "mid", "o_rim", "o_mid"):
            x = A["_" + key]
            if x[1]:
                put(key, 100 * x[0] / x[1], A["_pbp_games"][1])
        for key in ("c3",):
            x = A["_" + key]
            if x[1]:
                put(key, 100 * x[0] / x[1], A["_pbp_games"][1])
        for key in ("trans", "o_trans"):
            x = A["_" + key]
            if x[1]:
                put(key, 100 * x[0] / x[1], A["_pbp_games"][1])
        tnet = nets.get(k[0], {})
        if D["g"]:
            whole = D["g"] >= sum(1 for g in G if k[0] in (g["home"], g["away"])) - 1
            if whole and tnet.get("net") is not None:
                put("net", tnet["net"], D["g"])
                put("ortg", tnet.get("adjo"), D["g"])
                put("drtg", tnet.get("adjd"), D["g"])
                put("pace", tnet.get("tempo"), D["g"])
            elif A["_res"][1]:
                put("net", A["_res"][0] / A["_res"][1], D["g"])
        splits = {}
        for name, x in D["splits"].items():
            splits[name] = dict(g=x[0], w=x[1], l=x[2], net=round(x[3] / x[4], 1) if x[4] else None, pace=round(x[5] / x[0], 1) if x[0] else None)
        out[k] = dict(season=s, team=k[0], coach=k[1], g=D["g"], w=D["w"], l=D["l"], cw=D["cw"], cl=D["cl"], values=v, splits=splits,
                      games=D["games"], decisions=D["decisions"],
                      management=dict(ato_n=int(A["ato"][1]), ato_late_n=int(A["ato_late"][1]), to=int(A["to_g"][0]), ch=int(A["ch_g"][0]),
                                      ch_won=int(A["ch_success"][0] / 100) if A["ch_success"][1] else 0, run_to=int(A["run_stop"][1]),
                                      close_finishes=int(A["unused"][1])))
    league = dict(half_mean=round(half_mean, 3), run_base={str(b): round(v, 3) for b, v in run_base.items()})
    return out, league


def _split_hit(key, x):
    site, conf, res, rk, miss, date = x[3], x[4], x[10], x[13], x[16], x[0]
    month = int(date[5:7])
    return {"gap_q1": rk is not None and rk <= 50, "gap_road": site == "A", "gap_conf": bool(conf), "gap_missing": bool(miss),
            "gap_march": month in (3, 4)}[key] and res is not None


PBP_KEYS = ["to_media", "to_run", "ato", "ato_late", "ato_d", "ch_success", "foul_up3", "eoh", "chase", "sec_poss", "early",
            "ppp_stl", "ppp_dreb", "ppp_made", "crash_cost", "press"]
RATIO_N = {}


def missing_value(g, t, roster):
    """Rotation players (role 0.4+, rate 3+) who did not play: their summed rate, or 0."""
    played = {p[0] for p in g["players"] if p[1] == t and (p[3] or p[2])}
    v = 0.0
    for r in roster:
        if (r.get("role") or 0) >= 0.4 and (r.get("rate") or 0) >= 3 and r["eid"] not in played:
            v += r["rate"]
    return round(v, 1)


def half_diff(g, t):
    home = t == g["home"]
    acc = {1: [0, 0, 0, 0], 2: [0, 0, 0, 0]}
    for p in g.get("poss") or []:
        if p[8] or p[1] not in acc:
            continue
        mine = bool(p[0]) == home
        a = acc[p[1]]
        if mine:
            a[0] += p[7]; a[1] += 1
        else:
            a[2] += p[7]; a[3] += 1
    out = []
    for h in (1, 2):
        a = acc[h]
        if a[1] < 10 or a[3] < 10:
            return None
        out.append(100 * (a[0] / a[1] - a[2] / a[3]))
    return out[1] - out[0]


def run_events(g, t):
    """[(run bin, treated, opp points over their next five possessions)] at each own possession start
    during an opponent run of 6+ unanswered (the first chance per run, or the one his timeout preceded)."""
    home = t == g["home"]
    P = [p for p in g.get("poss") or [] if not p[8]]
    out = []
    run = 0
    used = False
    for i, p in enumerate(P):
        mine = bool(p[0]) == home
        if mine:
            if run >= 6 and not used:
                treated = p[5] == 2 and p[6] == 1
                b = bin_of(run)
                nxt = [q[7] for q in P[i + 1:] if bool(q[0]) != home][:5]
                if len(nxt) == 5 and b is not None:
                    out.append((b, treated, sum(nxt) / 5.0))
                    used = True
            if p[7] > 0:
                run, used = 0, False
        else:
            if p[7] > 0:
                run += p[7]
    return out


def team_timeouts(g, t):
    """This team's timeouts, one per (period, clock): ESPN logs about 1% of them twice at one clock."""
    return list({(x[0], x[1]): x for x in g.get("to") or [] if x[2] == t}.values())


def pbp_rows(g, t, home, A, D, allowed, run_base, half_mean, margin, s, coach):
    o = g["away"] if home else g["home"]
    A["_pbp_games"][1] += 1
    # Team timeouts count only where ESPN logged the TV timeouts too: in the 0.1-2.6% of games a season
    # where it logged none, the TV breaks come through as team timeouts (UC Irvine, Nov 2013: nine "team"
    # timeouts and no TV timeout). Measured Nov 6 2026; the check holds the rest to the rule book.
    tv = bool(g.get("media"))
    tos = team_timeouts(g, t)
    if tv:
        A["to_g"][0] += len(tos); A["to_g"][1] += 1
    for x in tos:
        if tv:
            A["to_media"][0] += 100 * x[6]; A["to_media"][1] += 1
            A["to_run"][0] += 100 * (x[5] >= 6); A["to_run"][1] += 1
        D["decisions"].append([g["gid"], "timeout_" + x[3], x[0], x[1], x[4], x[5], x[6], None, int(tv)])
    for x in g.get("ch") or []:
        if x[2] != t:
            continue
        A["ch_g"][0] += 1
        if x[3] is not None:
            A["ch_success"][0] += 100 * x[3]; A["ch_success"][1] += 1
        D["decisions"].append([g["gid"], "challenge", x[0], x[1], x[5], None, None, x[3], int(tv)])
    if s >= CF.CHALLENGE_FIRST:
        A["ch_g"][1] += 1
    if abs(margin) <= 5 and tv:
        A["unused"][0] += max(0, allowed + g["ot"] - len(tos)); A["unused"][1] += 1
    d = half_diff(g, t)
    if d is not None:
        A["halftime"][0] += d - half_mean; A["halftime"][1] += 1
    for b, treated, pts in (run_events(g, t) if tv else ()):
        if treated and b in run_base:
            A["run_stop"][0] += pts - run_base[b]; A["run_stop"][1] += 1
    two = 0
    for p in g.get("poss") or []:
        mine = bool(p[0]) == home
        per, start, end, kind, ato, caller, pts, gar, clutch, mg, first, fk = p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12]
        # clutch keeps the possessions the safe-lead rule also calls garbage (a four- or five-point game in its
        # last seconds), as College Savant's clutch does: they are inside the clutch definition
        if clutch:
            A["clutch_o" if mine else "clutch_d"][0] += pts; A["clutch_o" if mine else "clutch_d"][1] += 1
        if gar:
            continue
        late = per >= 3 or (per == 2 and start <= 240)
        # a play out of a timeout: its first action is a shot or a turnover, not free throws (College Savant's
        # rule, so its "After own timeouts" and his are one number); the dead-ball baseline follows the same rule
        play = fk in ("fga", "tov")
        if mine:
            A["sec_poss"][0] += start - end; A["sec_poss"][1] += 1
            if first is not None:
                A["early"][0] += 100 * (start - first <= 10); A["early"][1] += 1
            if ato == 2 and caller == 1 and tv and play:
                A["ato"][0] += pts; A["ato"][1] += 1
                if late:
                    A["ato_late"][0] += pts; A["ato_late"][1] += 1
            if ato == 0 and kind in ("made", "ft") and play:
                A["deadball"][0] += pts; A["deadball"][1] += 1
            if kind == "steal":
                A["ppp_stl"][0] += pts; A["ppp_stl"][1] += 1
            elif kind == "dreb":
                A["ppp_dreb"][0] += pts; A["ppp_dreb"][1] += 1
            elif kind in ("made", "ft"):
                A["ppp_made"][0] += pts; A["ppp_made"][1] += 1
            if per <= 2 and start <= 30:
                A["eoh"][0] += pts; A["eoh"][1] += 1
            if per <= 2 and fk == "fga" and first is not None and 31 <= first <= 45:
                two += 1
        else:
            if ato == 2 and caller == 2 and tv and play:
                A["ato_d"][0] += pts; A["ato_d"][1] += 1
            if kind == "dreb" and first is not None:
                A["crash_cost"][0] += 100 * (start - first <= 8); A["crash_cost"][1] += 1
            if kind in ("made", "ft"):
                A["press"][0] += 100 * (fk == "tov" and first is not None and start - first <= 10); A["press"][1] += 1
            if per >= 2 and start <= 30 and mg == -3:
                A["foul_up3"][0] += 100 * (fk == "ft"); A["foul_up3"][1] += 1
            if per >= 2 and start <= 120 and 2 <= mg <= 10:
                A["chase"][0] += 100 * (fk == "ft"); A["chase"][1] += 1
    A["two41"][0] += two; A["two41"][1] += 1
    sh, osh = g.get("shots", {}).get(t, {}), g.get("shots", {}).get(o, {})
    for pre, x in (("", sh), ("o_", osh)):
        A["_" + pre + "trans"][0] += x.get("tr_a", 0); A["_" + pre + "trans"][1] += x.get("fga", 0)
    # zones as College Savant's shot diet counts them: D1-against-D1 games, garbage time in
    if not g["non_d1"]:
        zs, ozs = g.get("zones", {}).get(t, {}), g.get("zones", {}).get(o, {})
        for pre, x in (("", zs), ("o_", ozs)):
            z = sum(x.get(f"{k}_a", 0) for k in ("rim", "paint", "mid", "c3", "ab3"))
            A["_" + pre + "rim"][0] += x.get("rim_a", 0); A["_" + pre + "rim"][1] += z
            A["_" + pre + "mid"][0] += x.get("mid_a", 0); A["_" + pre + "mid"][1] += z
        A["_c3"][0] += zs.get("c3_a", 0); A["_c3"][1] += zs.get("c3_a", 0) + zs.get("ab3_a", 0)
