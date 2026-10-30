"""
build.py — Basketball Coaching Savant, built end to end.

    python3 build.py [--seasons 1996-97,2026-27] [--public ../../../public] [--out ~/Basketball-Savant/out/bcs]

Two passes. The first walks the seasons: the schedule and the head coach of every game
(registry.json), the ESPN games (process.py), the games table (context.py), the modules
(cts.py: rotation, units, management, identity, splits), each coach-team-season's talent and
market expectation (expect.py), development against the aging curve, and writes the Data Room
tables that need nothing league-wide. The second fits what has to be fitted across seasons
(the talent line, the projection from parts, the spread curve, the fair-minutes line per
season), ranks every stat in its pool, builds careers, fingerprints, comps, the arrival
effect, the tree, the Leaders boards and the scouting reports, and writes the site's files:

  public/bcs/index.json           coach list, leaders, tree, league trends, meta, dictionary
  public/bcs/c/<coach>.json       one coach's page
  public/bcs/t/<team>-<season>.json.gz   a team-season: rotation maps, pair matrix, units, minutes vs impact
  public/bcs/data/<table>/<season>.json.gz  the Data Room (games, stints, units, rotation, decisions)
  public/bcs/data/coaches.json    coaches, tenures, staff, 1946-47 on
  public/bcs/data/dictionary.json every column, defined

BUILD-NOTES.md gets every fit, every check and the review list.
"""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import archive as A  # noqa: E402
import config as CF  # noqa: E402
import context as CX  # noqa: E402
import cts as CT  # noqa: E402
import expect as X  # noqa: E402
import modules as MD  # noqa: E402
import nbatables as N  # noqa: E402
import process as P  # noqa: E402
import registry as RG  # noqa: E402
import teams as TM  # noqa: E402
import units as UN  # noqa: E402
import coach_tree_nba as TREE  # noqa: E402
import savant_config as SC  # noqa: E402

VERSION = "1.0.0"
OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
MD.AGING = SC.AGING
NOTES = []


def log(msg):
    print(msg, flush=True)
    NOTES.append(msg)


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def current_season():
    t = dt.date.today()
    return season_label(t.year if t.month >= 10 else t.year - 1)


def dump(path, obj, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    s = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    if gz:
        with gzip.open(path, "wt", compresslevel=6) as fh:
            fh.write(s)
    else:
        open(path, "w").write(s)
    return len(s)


def clean(o):
    """NaN -> None, tuples -> lists, int keys -> str, for JSON."""
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [clean(v) for v in o]
    return o


# ---------------------------------------------------------------- pass one
def bundle_path(out, season):
    return os.path.join(out, "bundles", f"{season}.pkl")


def save_bundle(out, season, b):
    import pickle
    os.makedirs(os.path.join(out, "bundles"), exist_ok=True)
    with open(bundle_path(out, season) + ".tmp", "wb") as fh:
        pickle.dump(b, fh, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(bundle_path(out, season) + ".tmp", bundle_path(out, season))


def load_bundle(out, season):
    import pickle
    p = bundle_path(out, season)
    if not os.path.exists(p):
        return None
    with open(p, "rb") as fh:
        return pickle.load(fh)


def pass_one(seasons, reg, public, out, refresh=None):
    """refresh: None rebuilds every season; a list rebuilds only those and reloads the others'
    saved bundles (merge mode: the season in progress after a slate), so pass two sees the whole
    history and writes exactly what a full build would."""
    assign = reg["assign"]
    tenures = reg["tenures"]
    ten_by = defaultdict(list)
    for t in tenures:
        ten_by[(t["season"], t["team"])].append(t)

    def who_date(season, team, date):
        for t in ten_by.get((season, team), []):
            if t["first"] <= date <= t["last"]:
                return t["coach"]
        return None

    bundles = {}
    prev_min = None
    slots = X.draft_slots()
    priors = X.rookie_priors(A.players, [season_label(y) for y in range(1997, int(current_season()[:4]))], slots)
    log(f"rookie priors by draft slot (rookie-season BPM, minutes-weighted): {priors}")
    logs_all = RG.game_logs()
    for season in seasons:
        t0 = time.time()
        year = int(season[:4])
        if refresh is not None and season not in refresh:
            b = load_bundle(out, season)
            if b is None:
                log(f"{season}: no saved bundle; rebuilding it")
            else:
                bundles[season] = b
                prev_min = b.get("prev_min")
                continue
        logs = logs_all.get(season)
        if not logs:
            log(f"{season}: no schedule")
            continue
        proc = P.load(season)
        games = proc["games"] if proc else []
        arch, prev_arch = A.players(season), A.players(season_label(year - 1))
        impact = {k: v["bpm"] for k, v in arch.items() if v.get("bpm") is not None}
        names = {k: v["name"] for k, v in arch.items()}
        if proc:
            for k, v in proc["players"].items():
                names.setdefault(P._pid(k), v["name"])
        nba = N.team_season(season)
        amap = {s: assign.get(season, {}) for s in (season,)}[season]

        def who_row(r):
            c = amap.get(r.get("nba_gid"), {}).get(r["team"]) if r.get("nba_gid") else None
            return c or who_date(season, r["team"], r["date"])

        def who_g(g, team):
            c = amap.get(g.get("nba_gid"), {}).get(team) if g.get("nba_gid") else None
            return c or who_date(season, team, g["date"])
        rows = CX.build(season, logs, proc, who_row, impact, arch, prev_min=prev_min)
        # league shooting for luck
        fg3m = fg3a = ftm = fta = 0.0
        for g in games:
            if g.get("stype") != 2:
                continue
            for tm in g["team"].values():
                b = tm["box"]; fg3m += b["fg3m"]; fg3a += b["fg3a"]; ftm += b["ftm"]; fta += b["fta"]
        lg = {"fg3": fg3m / fg3a if fg3a else 0.355, "ft": ftm / fta if fta else 0.76}
        cts_map, rot_rs, rot_po, un_rs = CT.build(season, games, rows, who_g, impact, arch, nba, lg)
        # expectation inputs, development, extra splits, per CTS
        fair = MD.fair_minutes_line(arch)
        for key, c in cts_map.items():
            team, coach = key
            rws = [r for r in rows if r["team"] == team and r.get("coach") == coach and r["type"] == "RS"]
            roster = set()
            mins = defaultdict(float)
            for g in games:
                if g.get("stype") != 2 or team not in g["team"] or who_g(g, team) != coach:
                    continue
                esp = g["team"][team]["espn"]
                for pid, p in g["players"].items():
                    if p["team"] == esp and not p["dnp"] and p["sec"] > 0:
                        roster.add(pid); mins[pid] += p["sec"] / 60.0
            if not roster:
                # before the play-by-play: the archive's team field (one team per player)
                ab = TM.nba_abbr(team, year)
                roster = {pid for pid, p in arch.items() if p.get("team") == ab}
                mins = {pid: (arch[pid].get("min") or 0) for pid in roster}
            talent, parts = X.team_talent(season, roster, A.players, slots, priors) if roster else (None, [])
            c["expect"] = dict(talent=talent, parts=len(parts), rookies=sum(1 for p in parts if p["src"].startswith("rookie")))
            c["development"] = MD.development(season, mins, arch, prev_arch)
            tr = [r for r in rws if r.get("h1_margin") is not None and r["h1_margin"] < 0 and r.get("q3_margin") is not None and r.get("q4_margin") is not None]
            c["trail_second_half"] = round(sum(r["q3_margin"] + r["q4_margin"] for r in tr) / len(tr), 2) if tr else None
            fav = [r["margin"] + r["spread"] for r in rws if r.get("spread") is not None and r["spread"] < 0]
            dog = [r["margin"] + r["spread"] for r in rws if r.get("spread") is not None and r["spread"] > 0]
            c["fav_vs_dog"] = round(sum(fav) / len(fav) - sum(dog) / len(dog), 2) if fav and dog else None
            if key in rot_rs:
                rot_rs[key]["overplay"] = MD.overplay(rot_rs[key]["rows"], impact, fair)
                c.setdefault("rotation", {})["overplay"] = rot_rs[key]["overplay"]
            c["staff"] = reg["staff"].get(season, {}).get(team, [])
        # Data Room tables that need nothing league-wide
        write_games_table(out, season, rows)
        if games:
            write_stints(out, season, games, who_g, names)
            write_decisions(out, season, games, who_g)
            write_rotation_table(out, season, rot_rs, rot_po, names)
        # minutes per team for next season's returning share
        prev_min = defaultdict(dict)
        for g in games:
            if g.get("stype") != 2:
                continue
            for team, tm in g["team"].items():
                for pid, p in g["players"].items():
                    if p["team"] == tm["espn"] and not p["dnp"]:
                        prev_min[team][pid] = prev_min[team].get(pid, 0.0) + p["sec"] / 60.0
        bundles[season] = dict(cts=cts_map, rot_rs=rot_rs, rot_po=rot_po, units=un_rs, rows=rows, names=names, lg=lg, arch_size=len(arch),
                               fair_line=[[x, round(fair(x), 1)] for x in range(-8, 12)] if fair else None,
                               teams=sorted({r["team"] for r in rows}), prev_min={k: dict(v) for k, v in prev_min.items()})
        save_bundle(out, season, bundles[season])
        log(f"{season}: {len(logs)} team-games, {len(games)} ESPN games, {len(cts_map)} coach-team-seasons ({time.time() - t0:.0f}s)")
        if proc:
            del proc, games
    return bundles


def write_games_table(out, season, rows):
    cols = sorted({k for r in rows for k in r.keys()} - {"_g"})
    data = [[clean(r.get(k)) for k in cols] for r in rows]
    dump(os.path.join(out, "data", "games", f"{season}.json.gz"), dict(table="games", season=season, columns=cols, rows=data), gz=True)


def write_stints(out, season, games, who_g, names):
    cols = ["gid", "nba_gid", "date", "home", "away", "home_coach", "away_coach", "period", "start", "end", "seconds", "home5", "away5",
            "poss_home", "poss_away", "pts_home", "pts_away", "margin_home_start", "h_fg3m", "h_fg3a", "h_ftm", "h_fta", "a_fg3m", "a_fg3a", "a_ftm", "a_fta",
            "h_fga", "h_fgm", "a_fga", "a_fgm", "h_oreb", "a_oreb", "h_dreb", "a_dreb", "h_tov", "a_tov"]
    data = []
    for g in games:
        hc, ac = who_g(g, g["home"]), who_g(g, g["away"])
        for s in g["stints"]:
            data.append([g["gid"], g.get("nba_gid"), g["date"], g["home"], g["away"], hc, ac, s[0], s[1], s[2], round(s[1] - s[2], 1)] + s[3:5] + [int(x) for x in s[5:10]] + [int(x) for x in s[10:]])
    dump(os.path.join(out, "data", "stints", f"{season}.json.gz"), dict(table="stints", season=season, columns=cols, rows=data), gz=True)


def write_decisions(out, season, games, who_g):
    cols = ["gid", "date", "team", "opp", "coach", "kind", "period", "clock", "margin", "a", "b", "c", "d", "e"]
    data = []
    for g in games:
        for team, tm in g["team"].items():
            esp = tm["espn"]; opp = next(k for k in g["team"] if k != team); coach = who_g(g, team)
            for t in g["timeouts"]:
                if t["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "timeout", t["per"], t["clock"], t["margin"], t["kind"], t["run"], t["ball"], t["ato_pts"], t["next_opp"]])
            for c in g["challenges"]:
                if c["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "challenge", c["per"], c["clock"], c["margin"], c["result"], c["timeout_lost"], c["text"], None, None])
            for r in g["runs"]:
                if r["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "run_against", r["per"], None, r["margin"], r["size"], r["final"], r["timeout"], r["to_size"], r["next_opp"]])
            for f in g["foul_up3"]:
                if f["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "up3", f["per"], f["clock"], 3, f["fouled"], f["pts_allowed"], None, None, None])
            for x in g["two_for_one"]:
                if x["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "two_for_one", x["per"], x["clock"], None, x["another"], None, None, None, None])
            for x in g["late_poss"]:
                if x["team"] == esp:
                    data.append([g["gid"], g["date"], team, opp, coach, "end_of_period", x["per"], x["start"], None, x["pts"], x["kind"], x["another"], None, None])
            for pid, p in g["players"].items():
                if p["team"] == esp:
                    for per, clock, n, sat in p.get("trouble") or []:
                        data.append([g["gid"], g["date"], team, opp, coach, "foul_trouble", per, clock, None, pid, n, sat, None, None])
    dump(os.path.join(out, "data", "decisions", f"{season}.json.gz"), dict(table="decisions", season=season, columns=cols, rows=data,
         legend={"timeout": "a: full/short, b: opponent run at the call, c: own/opp ball, d: points on the first possession after, e: [opp points, possessions] over the next five",
                 "challenge": "a: result, b: timeout lost, c: text", "run_against": "a: size at detection, b: final size, c: timeout called, d: size at the timeout, e: [opp points, possessions] after the decision point",
                 "up3": "a: fouled before a shot, b: points allowed", "two_for_one": "a: got another possession", "end_of_period": "clock: seconds left at the start; a: points, b: how it ended, c: another possession followed",
                 "foul_trouble": "a: player id, b: fouls, c: seconds sat after it"}), gz=True)


def write_rotation_table(out, season, rot_rs, rot_po, names):
    cols = ["gid", "date", "team", "coach", "kind", "pid", "name", "intervals", "off_absence", "off_blowout", "off_foul", "off_choice", "scripted"]
    data = []
    for rot, kind in ((rot_rs, "RS"), (rot_po, "PO")):
        for (team, coach), r in rot.items():
            for gr in r["game_rows"]:
                for pid, iv in gr["iv"].items():
                    pc = gr["pc"].get(pid) or [0, 0, 0, 0, 0]
                    data.append([gr["gid"], gr["date"], team, coach, kind, pid, names.get(pid), iv] + pc)
    dump(os.path.join(out, "data", "rotation", f"{season}.json.gz"), dict(table="rotation", season=season, columns=cols, rows=data), gz=True)


# ---------------------------------------------------------------- pass two
def pass_two(bundles, reg, odds, public, out, seasons):
    coaches = reg["coaches"]
    cur = current_season()
    # ---- the talent line
    pts = []
    team_season = defaultdict(lambda: [0.0, 0, 0.0, 0.0, 0])   # (season, team) -> [talent*g, g, pts-opp, poss, w]
    for season, b in bundles.items():
        for (team, coach), c in b["cts"].items():
            R, E = c["results"], c.get("expect") or {}
            if E.get("talent") is None or not R["g"] or R["net"] is None:
                continue
            if not R.get("poss_avg"):
                continue
            ts = team_season[(season, team)]
            ts[0] += E["talent"] * R["g"]; ts[1] += R["g"]; ts[2] += (R["pts"] - R["opp_pts"]); ts[3] += R["poss_avg"]; ts[4] += R["w"]
    for (season, team), ts in team_season.items():
        if ts[1] >= 41 and ts[3]:
            pts.append((season, team, ts[0] / ts[1], 100.0 * ts[2] / ts[3], ts[4], ts[1]))
    talent = X.fit(pts) if len(pts) > 60 else None
    log(f"talent line: {talent}")
    # per-season leave-one-out coefficients for honest expectations
    coef = {}
    if talent:
        import numpy as np
        for s in talent["seasons"]:
            tr = [p for p in pts if p[0] != s]
            Xm = np.array([[1.0, p[2]] for p in tr]); y = np.array([p[3] for p in tr])
            bb = np.linalg.lstsq(Xm, y, rcond=None)[0]
            coef[s] = (float(bb[0]), float(bb[1]))
    # ---- spread curve
    all_sp = [r for b in bundles.values() for r in b["rows"] if r.get("spread") is not None and r["type"] == "RS"]
    pwin = X.spread_curve(all_sp) if len(all_sp) > 2000 else None
    log(f"spread curve from {len(all_sp)} team-games with a closing line")
    # ---- projection from parts
    all_units = [(season, u) for season, b in bundles.items() for uu in b["units"].values() for u in uu["units5"]]
    parts = MD.fit_parts(all_units, log=log)
    # The lineup pairings that replicated in pairings.py (team-season fixed effects, clustered errors,
    # discovered on even seasons and replicated on odd) join the projection for 2018-19 on, at the
    # pooled coefficient. A unit with a man under pairings.TYPE_MIN minutes (no player type) gets no
    # adjustment. pair_adj is kept on the unit so the Data Room table shows what moved the projection.
    pair_coefs = {}
    pp = os.path.join(out, "pairings.json")
    if parts and os.path.exists(pp):
        pj = json.load(open(pp))
        pair_coefs = {k: v["coef"] for k, v in pj.get("replicated", {}).items() if v.get("replicates") and v.get("coef") is not None}
    if pair_coefs:
        import pairings as PR
        n_adj = 0
        for season, b in bundles.items():
            if int(season[:4]) < PR.FIRST:
                continue
            types = PR.player_types(season)
            for uu in b["units"].values():
                for x in uu["units5"]:
                    ids = x.get("ids") or []
                    f = PR.unit_features(ids, types) if ids and all(isinstance(i, int) for i in ids) else None
                    if f:
                        adj = sum(c * f["pairs"][k] for k, c in pair_coefs.items())
                        if adj:
                            x["pair_adj"] = round(adj, 2); n_adj += 1
        parts["pairings"] = pair_coefs
        parts["note"] = ("Projection = a + b × Σ BPM, plus the lineup pairings that replicated in pairings.py (team-season fixed effects, "
                         "clustered errors, same sign in both halves and pooled p < .05), from 2018-19 on: " + ", ".join(f"{k} {v:+.2f}" for k, v in pair_coefs.items()) + ".")
        log(f"pairings in the projection: {pair_coefs}; {n_adj} units adjusted")
    else:
        log("pairings in the projection: none")
    # ---- per CTS: expectations, projections, left on the table
    values, games_of, cts_index = {}, {}, {}
    for season, b in bundles.items():
        lgc = MD.league_context(list(b["cts"].values()))
        b["lgc"] = lgc
        for (team, coach), c in b["cts"].items():
            R, E = c["results"], c.get("expect") or {}
            g = R["g"]
            if talent and E.get("talent") is not None and g:
                a, bb = coef.get(season, (talent["a"], talent["b"]))
                exp_net = a + bb * E["talent"]
                exp_w82 = talent["wins_a"] + talent["wins_per_net"] * exp_net
                E.update(exp_net=round(exp_net, 2), exp_w82=round(exp_w82, 1), exp_w=round(exp_w82 * g / 82.0, 1), w82=round(82.0 * R["w"] / g, 1),
                         w_talent=round(82.0 * R["w"] / g - exp_w82, 2))
            tot = (odds.get(season, {}).get("by_team") or {}).get(team)
            if tot is not None and g:
                E.update(market_total=tot, w_market=round(82.0 * R["w"] / g - tot, 2))
            if pwin:
                sp = [r for r in b["rows"] if r["team"] == team and r.get("coach") == coach and r["type"] == "RS" and r.get("spread") is not None]
                if sp:
                    E.update(w_spread=round(sum(r["w"] - pwin(r["spread"]) for r in sp), 2), spread_g=len(sp))
            u = b["units"].get((team, coach))
            if u and parts:
                for x in u["units5"]:
                    x["proj"] = MD.project(parts, x)
                    if x["proj"] is not None and x.get("pair_adj"):
                        x["proj"] = round(x["proj"] + x["pair_adj"], 1)
                used = [x for x in u["units5"] if x.get("proj") is not None]
                if used:
                    best = max(x["proj"] for x in used)
                    mins = sum(x["min"] for x in used) or 1.0
                    c.setdefault("rotation", {})["left_table"] = round(sum(x["min"] * (best - x["proj"]) for x in used) / mins, 2)
            vals = MD.season_values(c, lgc)
            values[(season, team, coach)] = vals
            games_of[(season, team, coach)] = g
            cts_index[(season, team, coach)] = c
    # ---- season percentiles
    season_pct, season_pools = {}, {}
    for season, b in bundles.items():
        sv = {(k[1], k[2]): v for k, v in values.items() if k[0] == season}
        gg = {(k[1], k[2]): games_of[k] for k in values if k[0] == season}
        season_pools[season] = {}
        for (team, coach), p in MD.season_percentiles(sv, gg, season_pools[season]).items():
            season_pct[(season, team, coach)] = p
    # the season in progress, provisionally: among coaches with MIN_LIVE_GAMES, each stat at a quarter
    # of its settle sample, until the 41-game line makes it a season like the others
    live_pct, live_pools = {}, {}
    if cur in bundles and not season_pools.get(cur):
        sv = {(k[1], k[2]): v for k, v in values.items() if k[0] == cur}
        gg = {(k[1], k[2]): games_of[k] for k in values if k[0] == cur}
        for (team, coach), p in MD.season_percentiles(sv, gg, live_pools, min_games=CF.MIN_LIVE_GAMES, live=True).items():
            live_pct[(cur, team, coach)] = p
        log(f"{cur} ranked provisionally: {len(live_pct)} coaches with {CF.MIN_LIVE_GAMES}+ games")
    # ---- careers
    by_coach = defaultdict(list)
    for k in values:
        by_coach[k[2]].append(k)
    careers = {slug: MD.career([(k, None) for k in keys], values) for slug, keys in by_coach.items()}
    hc_seasons = {slug: len({r["season"] for r in c["hc"]}) for slug, c in coaches.items()}
    eligible = {slug for slug, keys in by_coach.items() if hc_seasons.get(slug, 0) >= CF.MIN_CAREER_SEASONS and sum(games_of[k] for k in keys) >= CF.MIN_CAREER_GAMES}
    career_pct, pools = MD.career_percentiles(careers, eligible)
    log(f"career pool: {len(eligible)} coaches with {CF.MIN_CAREER_SEASONS}+ seasons and {CF.MIN_CAREER_GAMES}+ games since 1996-97")
    # ---- fingerprints and comps
    fp = MD.fingerprints(season_pct, by_coach, games_of)
    comps, dist, closer = MD.comps(fp, eligible)
    # ---- tree
    sugg = MD.suggest_mentors(coaches, reg["tenures"], reg["staff"])
    tree_nodes = {}
    for slug, c in coaches.items():
        s = sugg.get(slug) or {}
        o = TREE.OVERRIDES.get(slug)
        mentor = o["mentor"] if o else s.get("mentor")
        role = o["role"] if o else (f"{s.get('seasons')} season{'s' if s.get('seasons') != 1 else ''} on his staff" if s.get("mentor") else None)
        also = [[a, r] for a, r in (o.get("also") or [])] if o else [[h, f"{n} seasons on his staff"] for h, n in (s.get("also") or [])]
        tree_nodes[slug] = dict(name=c["name"], mentor=mentor if mentor in coaches else None, role=role, also=also, tie=bool(s.get("tie")),
                                override=bool(o), unconfirmed=bool(o and o.get("unconfirmed")), has_page=slug in by_coach or bool(c["hc"]), kids=[])
    for slug, n in tree_nodes.items():
        if n["mentor"] and n["mentor"] in tree_nodes:
            tree_nodes[n["mentor"]]["kids"].append(slug)

    def size(slug, seen=None):
        seen = seen or set()
        if slug in seen:
            return 1
        seen.add(slug)
        return 1 + sum(size(k, seen) for k in tree_nodes[slug]["kids"])
    for slug, n in tree_nodes.items():
        n["size"] = size(slug)
    for slug, n in tree_nodes.items():
        n["kids"].sort(key=lambda k: -tree_nodes[k]["size"])
    roots = sorted([slug for slug, n in tree_nodes.items() if not n["mentor"] and n["size"] > 1], key=lambda s: -tree_nodes[s]["size"])
    # tree in the data: distance to mentor
    for slug, n in tree_nodes.items():
        m = n["mentor"]
        if m and slug in fp and m in fp:
            d = dist.get((slug, m) if slug < m else (m, slug))
            n["mentor_closer_than"] = closer(d) if d is not None else None
    # pipeline boards: staffs that produced head coaches
    produced = defaultdict(set)
    for slug, s in sugg.items():
        if not coaches[slug]["hc"]:
            continue
        for h, nseasons, _ in s.get("under") or []:
            produced[h].add(slug)
    # ---- arrival effect (team-season aggregates by team)
    team_vals = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    for (season, team, coach), vals in values.items():
        g = games_of[(season, team, coach)]
        for key, (val, n) in vals.items():
            team_vals[(season, team)][key][0] += val * g; team_vals[(season, team)][key][1] += g
    team_vals = {k: {key: round(v[0] / v[1], 3) for key, v in d.items() if v[1]} for k, d in team_vals.items()}
    ARRIVAL_KEYS = ["net", "winpct", "pace", "fg3r", "rim", "mid", "ast_pct", "orb_pct", "o_fg3r", "o_rim", "depth10", "stability", "to_g", "ftr", "tov_pct", "o_tov"]
    # every team-season metric as a percentile among that season's teams (lower-is-better flipped),
    # so an arrival's before / first / after sit on one scale and the distance means something
    team_pct = defaultdict(dict)
    by_season_key = defaultdict(lambda: defaultdict(list))
    for (season, team), d in team_vals.items():
        for key in ARRIVAL_KEYS:
            if d.get(key) is not None:
                by_season_key[season][key].append(((season, team), -d[key] if CF.BY_KEY[key]["lower"] else d[key]))
    for season, d in by_season_key.items():
        for key, pairs in d.items():
            for k, p in MD.pct_rank(pairs).items():
                team_pct[k][key] = p
    # ---- coach pages
    tenures = reg["tenures"]
    ten_by_coach = defaultdict(list)
    for t in tenures:
        ten_by_coach[t["coach"]].append(t)
    index_rows = []
    staff_index = defaultdict(list)       # assistants: (season, team, head coach)
    for season, teams_ in reg["staff"].items():
        for team, rows in teams_.items():
            heads = [t["coach"] for t in tenures if t["season"] == season and t["team"] == team]
            for r in rows:
                staff_index[(r.get("id") or "name:" + r["name"])].append(dict(season=season, team=team, role=r["role"], heads=heads, src=r["src"]))
    # who was the head coach of each team-season, for the assistant-stint tables: the game-level tenures
    # from 1996-97, Basketball-Reference's head-coach rows before that
    heads_by_ts = defaultdict(set)
    for t in tenures:
        heads_by_ts[(t["season"], t["team"])].add(t["coach"])
    for slug_, c_ in coaches.items():
        for r in c_["hc"]:
            if r.get("franchise") and (r["season"], r["franchise"]) not in heads_by_ts:
                heads_by_ts[(r["season"], r["franchise"])].add(slug_)
    pages = 0
    for slug, c in coaches.items():
        keys = sorted(by_coach.get(slug, []))
        if not keys and not c["hc"] and slug not in staff_index:
            continue
        hc_rows = c["hc"]
        first_hc = min((r["season"] for r in hc_rows), default=None)
        born = c.get("born")
        age_first = None
        if born and first_hc:
            try:
                age_first = round((dt.date(int(first_hc[:4]), 10, 1) - dt.date.fromisoformat(born)).days / 365.25, 1)
            except ValueError:
                pass
        ast_before = len({r["season"] for r in c["ast"] if first_hc and r["season"] < first_hc})
        season_rows = []
        for k in keys:
            season, team, coach = k
            cc = cts_index[k]
            R, E = cc["results"], cc.get("expect") or {}
            season_rows.append(dict(season=season, team=team, g=R["g"], w=R["w"], l=R["l"], pg=R["pg"], pw=R["pw"], pl=R["pl"], rounds=R["rounds"], title=bool(R["won_last"] and R["rounds"] >= 4),
                                    net=R["net"], adj_net=R["adj_net"], exp=E, values=values[k], pct=season_pct.get(k, {}), ranked=games_of[k] >= CF.MIN_SEASON_GAMES,
                                    live_pct=live_pct.get(k) or None, live_pools=(live_pools if live_pct.get(k) else None),
                                    rotation=cc.get("rotation"), management=cc.get("management"), splits=cc.get("splits"), identity=cc.get("identity"), mvi=cc.get("mvi"),
                                    units=cc.get("units"), playoffs=cc.get("playoffs"), development=cc.get("development"), staff=cc.get("staff"), nba=cc.get("nba"),
                                    in_progress=season == cur))
        # tenures with first-time / rehire
        tens = sorted(ten_by_coach.get(slug, []), key=lambda t: t["first"])
        stints = []
        for t in tens:
            if stints and stints[-1]["team"] == t["team"] and int(t["season"][:4]) - int(stints[-1]["last_season"][:4]) <= 1:
                s_ = stints[-1]
                s_["last_season"] = t["season"]; s_["g"] += t["g"]; s_["w"] += t["w"]; s_["l"] += t["l"]; s_["pg"] += t["pg"]; s_["pw"] += t["pw"]; s_["pl"] += t["pl"]
                s_["last"] = max(s_["last"], t["last"])
            else:
                stints.append(dict(team=t["team"], first_season=t["season"], last_season=t["season"], first=t["first"], last=t["last"], g=t["g"], w=t["w"], l=t["l"],
                                   pg=t["pg"], pw=t["pw"], pl=t["pl"], acting_for=t.get("acting_for"), note=t.get("note"), source=t.get("source"),
                                   rehire=any(r["season"] < t["season"] for r in hc_rows)))
        # arrival effect per stint
        arrivals = []
        for s_ in stints:
            y0 = int(s_["first_season"][:4])
            before, first, after = team_vals.get((season_label(y0 - 1), s_["team"])), team_vals.get((s_["first_season"], s_["team"])), None
            y1 = int(s_["last_season"][:4])
            after = team_vals.get((season_label(y1 + 1), s_["team"]))
            if first and (before or after):
                kb, kf, ka = (season_label(y0 - 1), s_["team"]), (s_["first_season"], s_["team"]), (season_label(y1 + 1), s_["team"])
                arrivals.append(dict(team=s_["team"], before_season=season_label(y0 - 1) if before else None, first_season=s_["first_season"], last_season=s_["last_season"], after_season=season_label(y1 + 1) if after else None,
                                     rows={key: dict(v=[before.get(key) if before else None, first.get(key), after.get(key) if after else None],
                                                     p=[team_pct.get(kb, {}).get(key) if before else None, team_pct.get(kf, {}).get(key), team_pct.get(ka, {}).get(key) if after else None])
                                           for key in ARRIVAL_KEYS if first.get(key) is not None}))
        cv = careers.get(slug, {})
        cp = career_pct.get(slug, {})
        node = tree_nodes.get(slug, {})
        page = dict(
            id=slug, name=c["name"], version=VERSION,
            bio=dict(born=born, birthplace=c.get("birthplace"), died=c.get("died"), college=c.get("college"), high_school=c.get("high_school"), played=c.get("played"),
                     player_games=c.get("player_games"), hof=c.get("hof"), age_first_hc=age_first, assistant_seasons_before=ast_before, first_hc=first_hc, stub=c.get("stub"), note=c.get("note")),
            awards=c["awards"], voting=c["voting"], transactions=c["transactions"],
            records=[dict(season=r["season"], team=r["franchise"] or r["team"], lg=r["lg"], g=r["g"], w=r["w"], l=r["l"], pg=r["pg"], pw=r["pw"], pl=r["pl"], finish=r["finish"], remarks=r["remarks"]) for r in hc_rows],
            assistant=[dict(season=r["season"], team=r["franchise"] or r["team"], lg=r["lg"], role=r["role"], heads=sorted(h for h in heads_by_ts.get((r["season"], r["franchise"]), ()) if h != slug) if r.get("franchise") else []) for r in c["ast"]] + [dict(season=x["season"], team=x["team"], lg="NBA", role=x["role"], heads=x["heads"], src=x["src"]) for x in staff_index.get(slug, []) if not any(r["season"] == x["season"] and (r["franchise"] or r["team"]) == x["team"] for r in c["ast"])],
            stints=stints, seasons=season_rows,
            career=dict(eligible=slug in eligible, stats={k: dict(v=v[0], n=v[1], seasons=v[2], pct=cp.get(k), pool=pools.get(k)) for k, v in cv.items()},
                        g=sum(games_of[k] for k in keys), w=sum(cts_index[k]["results"]["w"] for k in keys), l=sum(cts_index[k]["results"]["l"] for k in keys),
                        pw=sum(cts_index[k]["results"]["pw"] for k in keys), pl=sum(cts_index[k]["results"]["pl"] for k in keys),
                        po_seasons=sum(1 for k in keys if cts_index[k]["results"]["pg"]), titles=sum(1 for k in keys if cts_index[k]["results"]["won_last"] and cts_index[k]["results"]["rounds"] >= 4),
                        w_talent_sum=round(sum(cts_index[k]["expect"]["w82"] - cts_index[k]["expect"]["exp_w82"] for k in keys if cts_index[k].get("expect", {}).get("exp_w82") is not None) if keys else 0, 2),
                        w_talent_sum_raw=round(sum(cts_index[k]["results"]["w"] - cts_index[k]["expect"]["exp_w"] for k in keys if cts_index[k].get("expect", {}).get("exp_w") is not None), 2) if keys else 0,
                        w_market_sum_raw=round(sum(cts_index[k]["results"]["w"] - cts_index[k]["expect"]["market_total"] * cts_index[k]["results"]["g"] / 82.0 for k in keys if cts_index[k].get("expect", {}).get("market_total") is not None), 2) if keys else 0,
                        all_time=dict(g=sum(r["g"] or 0 for r in hc_rows if r["lg"] == "NBA"), w=sum(r["w"] or 0 for r in hc_rows if r["lg"] == "NBA"), l=sum(r["l"] or 0 for r in hc_rows if r["lg"] == "NBA"),
                                      seasons=hc_seasons.get(slug, 0), first=first_hc, last=max((r["season"] for r in hc_rows), default=None),
                                      po_seasons=sum(1 for r in hc_rows if r["pg"]), titles=sum(1 for r in hc_rows if (r["remarks"] or "").startswith(("NBA Champions", "BAA Champions"))),
                                      coy=[a[0] for a in c["awards"] if a[2] == "Coach of the Year"])),
            player_names={str(r[0]): bundles[k[0]]["names"].get(r[0]) for k in keys for r in (cts_index[k].get("development") or {}).get("players", [])},
            fingerprint=fp.get(slug), comps=[[b, d, cl, coaches[b]["name"]] for b, d, cl in comps.get(slug, [])],
            lineage=dict(mentor=node.get("mentor"), mentor_name=coaches[node["mentor"]]["name"] if node.get("mentor") else None, role=node.get("role"), also=[[a, coaches[a]["name"] if a in coaches else a, r] for a, r in node.get("also", [])],
                         kids=[[k, coaches[k]["name"]] for k in node.get("kids", [])], suggested=sugg.get(slug, {}).get("under", []), later=sugg.get(slug, {}).get("later", []), tie=node.get("tie"), override=node.get("override"),
                         unconfirmed=node.get("unconfirmed"), mentor_closer_than=node.get("mentor_closer_than"), produced=sorted(produced.get(slug, set()))),
            arrivals=arrivals,
            scouting=MD.scouting(cv, cp, pools, c["name"]) if slug in eligible else [],
            scouting_season=next((dict(season=sr["season"], team=sr["team"], g=sr["g"], provisional=not sr["pct"],
                                       lines=MD.scouting_season(sr["values"], sr["pct"] or sr.get("live_pct") or {}, season_pools.get(sr["season"]) or live_pools, sr["season"], sr["g"]))
                                  for sr in season_rows if sr["in_progress"] and (sr["pct"] or sr.get("live_pct"))), None),
        )
        dump(os.path.join(public, "bcs", "c", f"{slug}.json"), clean(page))
        pages += 1
        index_rows.append(dict(id=slug, name=c["name"], g=page["career"]["g"], w=page["career"]["w"], l=page["career"]["l"], seasons=len({k[0] for k in keys}),
                               all_g=page["career"]["all_time"]["g"], all_w=page["career"]["all_time"]["w"], all_l=page["career"]["all_time"]["l"], all_seasons=page["career"]["all_time"]["seasons"],
                               first=page["career"]["all_time"]["first"], last=page["career"]["all_time"]["last"], teams=sorted({k[1] for k in keys}) or sorted({r["franchise"] for r in hc_rows if r.get("franchise")}),
                               active=any(k[0] == cur for k in keys), eligible=slug in eligible, hc=bool(hc_rows), assistant=bool(c["ast"]) or slug in staff_index, titles=page["career"]["all_time"]["titles"]))
    log(f"wrote {pages} coach pages")
    # ---- team-season files: one per team-season, with an entry per coach who had it
    tfiles = 0
    for season, b in bundles.items():
        names = b["names"]
        by_ts = defaultdict(list)
        for (team, coach), r in b["rot_rs"].items():
            by_ts[team].append((coach, r))
        for team, entries in by_ts.items():
            entries.sort(key=lambda x: (x[1]["game_rows"][0]["date"] if x[1]["game_rows"] else ""))
            file_names = {}
            out_entries = []
            for coach, r in entries:
                u = b["units"].get((team, coach)) or {}
                po = b["rot_po"].get((team, coach))
                ids = {row["id"] for row in r["rows"]} | set(u.get("men", [])) | set((u.get("onoff") or {}).keys())
                for pid in ids:
                    file_names[str(pid)] = names.get(pid)
                out_entries.append(dict(
                    coach=coach, coach_name=coaches[coach]["name"], first=r["game_rows"][0]["date"] if r["game_rows"] else None, last=r["game_rows"][-1]["date"] if r["game_rows"] else None,
                    rotation=dict(rows=r["rows"], games=r["games"], off_script=r["off_script"], by_cause=r["by_cause"], months=r["months"], closing=r["closing"], shape=r["shape"],
                                  game_rows=[{k: v for k, v in gr.items() if k != "pc"} for gr in r["game_rows"]]),
                    playoffs=dict(rows=po["rows"], games=po["games"], off_script=po["off_script"], by_cause=po["by_cause"], closing=po["closing"],
                                  game_rows=[{k: v for k, v in gr.items() if k != "pc"} for gr in po["game_rows"]]) if po else None,
                    units5=u.get("units5", []), units2=u.get("units2", [])[:60], matrix=u.get("matrix", []), men=u.get("men", []), stagger=u.get("stagger"), onoff=u.get("onoff"),
                    team_rates=u.get("team_rates"), mvi=cts_index[(season, team, coach)].get("mvi")))
            tfile = dict(season=season, team=team, names=file_names, fair=b.get("fair_line"), parts=dict(a=parts["a"], b=parts["b"], pairs=parts["pairs"], pairings=parts.get("pairings") or {}) if parts else None,
                         coaches=out_entries)
            dump(os.path.join(public, "bcs", "t", f"{team}-{season}.json.gz"), clean(tfile), gz=True)
            tfiles += 1
        # Data Room units
        cols = ["team", "coach", "n", "ids", "min", "poss", "gp", "ortg", "drtg", "net", "adj", "est", "proj", "sum_bpm", "oppq", "efg", "oefg", "orb", "tov", "pair_adj"]
        rows_ = []
        for (team, coach), u in b["units"].items():
            for x in u["units5"]:
                rows_.append([team, coach, 5, x["ids"], x["min"], x["poss"], x["gp"], x["ortg"], x["drtg"], x["net"], x["adj"], x["est"], x.get("proj"), x.get("sum_bpm"), x.get("oppq"), x.get("efg"), x.get("oefg"), x.get("orb"), x.get("tov"), x.get("pair_adj")])
            for x in u["units2"]:
                rows_.append([team, coach, 2, x["ids"], x["min"], x["poss"], x["gp"], x["ortg"], x["drtg"], x["net"], x["adj"], x["est"], None, None, x.get("oppq"), x.get("efg"), x.get("oefg"), x.get("orb"), x.get("tov"), None])
        if rows_:
            dump(os.path.join(out, "data", "units", f"{season}.json.gz"), dict(table="units", season=season, columns=cols, rows=clean(rows_)), gz=True)
    log(f"wrote {tfiles} team-season files")
    # ---- leaders
    leaders = []

    def board(id_, title, rows, pool, note=None, fmt="num1", season=None, kind="coach"):
        leaders.append(dict(id=id_, title=title, pool=pool, note=note, unit=fmt, season=season, kind=kind, rows=rows))
    def crow(slug, v, display, team=None, season=None):
        return dict(id=slug, name=coaches[slug]["name"], value=v, display=display, team=team, season=season)
    el = sorted(eligible)
    def career_board(key, title, lower=False, fmt=None, note=None):
        s = CF.BY_KEY[key]
        rows = [(cv_[key][0], slug) for slug, cv_ in careers.items() if slug in eligible and key in cv_ and cv_[key][1] >= s["thr"]]
        rows.sort(key=lambda x: x[0], reverse=not (lower or s["lower"]))
        board(key, title, [crow(slug, v, fmtv(s["unit"], v)) for v, slug in rows], f"head coaches with {CF.MIN_CAREER_SEASONS}+ seasons and {CF.MIN_CAREER_GAMES}+ games since {s['first']}", note or s["what"], s["unit"])
    career_board("winpct", "Win %")
    board("most_wins", "Most wins since 1996-97", [crow(slug, w, str(w)) for w, slug in sorted(((sum(cts_index[k]["results"]["w"] for k in keys), slug) for slug, keys in by_coach.items()), reverse=True)], "head coaches since 1996-97", "Regular-season wins in the games he coached, 1996-97 on.", "num0")
    board("wins_above_talent", "Wins above talent", [crow(slug, v, fmtv("sgn1", v)) for v, slug in sorted(((round(sum(cts_index[k]["results"]["w"] - cts_index[k]["expect"]["exp_w"] for k in keys if cts_index[k].get("expect", {}).get("exp_w") is not None), 1), slug) for slug, keys in by_coach.items() if slug in eligible), reverse=True)], "head coaches with 3+ seasons, 2003-04 on", "Wins beyond what his rosters' prior-season impact predicted, added up over his career (expect.py).", "sgn1")
    board("wins_above_market", "Wins above the market", [crow(slug, v, fmtv("sgn1", v)) for v, slug in sorted(((round(sum(cts_index[k]["results"]["w"] - cts_index[k]["expect"]["market_total"] * cts_index[k]["results"]["g"] / 82.0 for k in keys if cts_index[k].get("expect", {}).get("market_total") is not None), 1), slug) for slug, keys in by_coach.items() if slug in eligible), reverse=True)], "head coaches with 3+ seasons, 1996-97 on", "Wins beyond the preseason over/under, added up over his career.", "sgn1")
    board("playoff_rate", "Playoff rate", [crow(slug, v, fmtv("pct1", v)) for v, slug in sorted(((round(100.0 * sum(1 for k in keys if cts_index[k]["results"]["pg"]) / len({k[0] for k in keys}), 1), slug) for slug, keys in by_coach.items() if slug in eligible), reverse=True)], "head coaches with 3+ seasons since 1996-97", "Share of his seasons (1996-97 on) that reached the playoffs.", "pct1")
    for key, title in (("stability", "Rotation stability"), ("chosen_dev", "Chosen deviation"), ("closes_best", "Closes with his best five"), ("run_stop", "Stops runs"), ("ato_vs", "After-timeout bump"),
                       ("ch_success", "Challenge success"), ("halftime", "Halftime adjustment"), ("aging", "Beats the aging curve"), ("pace", "Pace"), ("fg3r", "3-point rate"), ("overplay", "Overplayed minutes"), ("w_spread", "Wins above the spread")):
        career_board(key, title)
    # this season
    sv = [(k, v) for k, v in values.items() if k[0] == cur and games_of[k] >= 3]
    for key, title in (("w_talent", "Wins above talent, per 82"), ("stability", "Rotation stability"), ("ato_vs", "After-timeout bump"), ("ch_success", "Challenge success"), ("net", "Net rating")):
        s = CF.BY_KEY[key]
        rows = sorted(((v[key][0], k) for k, v in sv if key in v), key=lambda x: x[0], reverse=not s["lower"])
        board(f"season_{key}", f"{title}, {cur}", [crow(k[2], v, fmtv(s["unit"], v), team=k[1], season=cur) for v, k in rows], f"coaches of {cur} with 3+ games", s["what"], s["unit"], season=cur, kind="season")
    # ---- league blocks per season: what a coach is drawn against
    league = {}
    for season, b in sorted(bundles.items()):
        cl = list(b["cts"].values())
        gw = lambda f: (lambda xs: round(sum(a * g for a, g in xs) / sum(g for _, g in xs), 4) if xs else None)([(f(c), c["results"]["g"]) for c in cl if f(c) is not None and c["results"]["g"]])  # noqa: E731
        diet = {z: gw(lambda c, z=z: ((c.get("identity") or {}).get("diet") or {}).get(z, [None])[0]) for z in ("ra", "paint", "mid", "c3", "ab3")}
        odiet = {z: gw(lambda c, z=z: ((c.get("identity") or {}).get("o_diet") or {}).get(z, [None])[0]) for z in ("ra", "paint", "mid", "c3", "ab3")}
        syn = {}
        for side in ("o", "d"):
            syn[side] = {}
            for pt in N.PLAY_TYPES:
                fr = gw(lambda c, pt=pt, side=side: (((c.get("nba") or {}).get("synergy") or {}).get(side) or {}).get(pt, [None])[0])
                ppp = gw(lambda c, pt=pt, side=side: (((c.get("nba") or {}).get("synergy") or {}).get(side) or {}).get(pt, [None, None])[1])
                if fr is not None:
                    syn[side][pt] = [fr, ppp]
        gaps = {}
        for split in CT.SPLITS:
            gaps[split] = {}
            buckets = {bk for c in cl for bk in ((c.get("splits") or {}).get(split) or {})}
            for bk in buckets:
                gaps[split][bk] = gw(lambda c, split=split, bk=bk: ((((c.get("splits") or {}).get(split) or {}).get(bk) or {}).get("net") - c["results"]["net"]) if (((c.get("splits") or {}).get(split) or {}).get(bk) or {}).get("net") is not None and c["results"].get("net") is not None and (((c.get("splits") or {}).get(split) or {}).get(bk) or {}).get("g", 0) >= 5 else None)
        # the league median of every stat that season, over the ranked coach-seasons: the per-row charts
        # draw a coach's seasons against it
        med = {}
        ranked_vals = [values[k] for k in values if k[0] == season and games_of[k] >= CF.MIN_SEASON_GAMES]
        for key in season_pools.get(season, {}):
            xs = sorted(v[key][0] for v in ranked_vals if v.get(key) and v[key][0] is not None and v[key][1] >= CF.BY_KEY[key]["thr"])
            if xs:
                med[key] = round(xs[len(xs) // 2] if len(xs) % 2 else (xs[len(xs) // 2 - 1] + xs[len(xs) // 2]) / 2, 3)
        league[season] = dict(diet=diet, o_diet=odiet, synergy=syn, split_gaps=gaps, halftime=round(b["lgc"].get("halftime", 0.0), 2), runs=b["lgc"].get("runs"), pools=season_pools.get(season, {}), median=med)
    # ---- league trends
    trends = []
    for season, b in sorted(bundles.items()):
        row = dict(season=season)
        for key in ("pace", "fg3r", "depth10", "stability", "ch_success", "to_g", "chosen_dev", "rim", "mid"):
            xs = [(v[key][0], games_of[k]) for k, v in values.items() if k[0] == season and key in v]
            row[key] = round(sum(a * g for a, g in xs) / sum(g for _, g in xs), 2) if xs else None
        trends.append(row)
    # ---- index
    pairings = None
    pp = os.path.join(out, "pairings.json")
    if os.path.exists(pp):
        pj = json.load(open(pp))
        pairings = dict(n_units=pj["n_units"], seasons=[pj["seasons"][0], pj["seasons"][-1]], results=pj["results"], replicated=pj["replicated"],
                        note="Luck-adjusted five-man net on Σ BPM, Σ usage, the count of each player type and the pairing, with team-season fixed effects and errors clustered by team-season; discovered on even seasons, replicated on odd. A pairing is used in the projection if it keeps its sign in both halves and its pooled estimate clears p < .05 (the stricter rule, p < .05 in each half, admitted nothing).")
    meta = dict(version=VERSION, generated=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), current=cur, seasons=seasons,
                rules=dict(min_career_seasons=CF.MIN_CAREER_SEASONS, min_career_games=CF.MIN_CAREER_GAMES, min_season_games=CF.MIN_SEASON_GAMES, career_pool=len(eligible)),
                fits=dict(talent=talent, parts={k: v for k, v in (parts or {}).items() if not k.startswith("_")}, spread_games=len(all_sp), pairings=pairings),
                pools=pools, model_note=CF.MODEL, tree_note=TREE.TREE_NOTE, fixes=reg["fixes"], unconfirmed=reg["unconfirmed"])
    dictionary = dict(stats=[{k: v for k, v in s.items()} for s in CF.STATS], groups=CF.GROUPS, group_labels=CF.GROUP_LABELS, fingerprint=CF.FINGERPRINT, tables=TABLE_DICT)
    index = dict(meta=meta, coaches=sorted(index_rows, key=lambda r: (-r["g"], r["name"])), leaders=leaders, tree=dict(nodes=tree_nodes, roots=roots, note=TREE.TREE_NOTE),
                 trends=trends, league=league, teams={k: dict(name=TM.NAMES[k], color=TM.COLORS[k]) for k in TM.NAMES}, stats=dictionary["stats"], groups=CF.GROUPS, group_labels=CF.GROUP_LABELS, fingerprint=CF.FINGERPRINT,
                 team_seasons=sorted(f"{k[1]}-{k[0]}" for k in values if k[0] >= "2002-03"), produced=sorted(((coaches[h]["name"], h, sorted(coaches[s]["name"] for s in v)) for h, v in produced.items()), key=lambda x: -len(x[2]))[:40])
    dump(os.path.join(public, "bcs", "index.json"), clean(index))
    dump(os.path.join(out, "data", "dictionary.json"), clean(dictionary))
    dump(os.path.join(out, "data", "coaches.json"), clean(dict(coaches={s: {k: v for k, v in c.items() if k not in ("hc", "ast")} | dict(hc=c["hc"], ast=c["ast"]) for s, c in coaches.items()},
                                                               tenures=reg["tenures"], staff=reg["staff"], fixes=reg["fixes"], tree=tree_nodes)))
    return dict(talent=talent, parts=parts, eligible=len(eligible), pages=pages, pools=pools)


def fmtv(unit, v):
    if v is None:
        return "—"
    if unit == "pct1":
        return f"{v:.1f}%"
    if unit == "num0":
        return str(int(round(v)))
    if unit in ("num1",):
        return f"{v:.1f}"
    if unit == "num2":
        return f"{v:.2f}"
    if unit == "sgn1":
        return f"{v:+.1f}"
    if unit == "sgn2":
        return f"{v:+.2f}"
    return str(v)


TABLE_DICT = {
    "games": "One row per team-game, 1996-97 on. Columns: season, nba_gid, gid (ESPN), date, type (RS/PO/PI), team, opp, home, w, pts, opp_pts, margin, coach, opp_coach; "
             "neutral, city, alt (m), travel_miles (from the previous game's place), tz_shift, tz_from_home, rest_days, b2b, three_in_four, trip_game, phase (first10/pre_asb/post_asb/last10), game_no; "
             "poss, opp_poss, pace, ortg, drtg, efg, tov_pct, orb_pct, ftr, fg3r, ast_pct and the o_ versions allowed; luck (opp 3P/FT points above league rate); pf, o_pf, take_fouls; diet/o_diet (zone -> [share of FGA, FG%]); "
             "trans_share, o_trans_share; lead_max, deficit_max, sec_leading, h1_margin, q3_margin, q4_margin, ot, comeback, blown, clutch, garbage, officials, attendance; spread (team view), ou, provider, cover, over; "
             "wp_min, wp_max, wp_q4 (ESPN win probability, team view); missing (regular ids out), missing_impact (their BPM), starters, starters_same; opp_net_prior, opp_rank_prior, opp_tier_prior, own_net_prior (prior games only), "
             "opp_pace_prior, own_pace_prior, tempo_vs_expected, tempo_toward_own; opp_net_final, opp_playoff; returning_min_share, avg_age, avg_exp.",
    "stints": "One row per stint (a stretch with the same ten men), 2002-03 on: both fives (NBA player ids), period, clock at start and end, seconds, possessions, points, the home margin at the start, and each side's 3PM/3PA/FTM/FTA, FGA/FGM, OREB, DREB, TOV.",
    "units": "Five- and two-man units per coach-team-season, 2002-03 on: minutes, possessions, games, ratings, net, luck-adjusted net (adj), sample-adjusted net (est, k possessions toward the team), the projection from parts (proj, five-man; pair_adj is the part of it from the lineup pairings that replicated, 2018-19 on), Σ BPM, the quality of opposing fives faced (oppq, Σ BPM), eFG, opponent eFG, ORB%, TOV%.",
    "rotation": "One row per player-game for players on the coach's Rotation Map, 2002-03 on: intervals on the floor (seconds from tip-off), off-script minutes by cause (absence, blowout, foul trouble, choice) and scripted minutes.",
    "decisions": "One row per event, 2002-03 on: timeouts, challenges, opponent runs (and whether a timeout answered them), fouling up three, two-for-ones, end-of-period possessions, foul-trouble spells. The legend in each file says what a-e hold for each kind.",
    "coaches": "Every coach Basketball-Reference lists, 1946-47 on: bio, head-coaching records by season and team, assistant stints, awards, Coach of the Year voting, transactions; the game-level tenures 1996-97 on; staffs by team-season; the acting-coach fixes; the tree.",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", default=None)
    ap.add_argument("--public", default=PUBLIC)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--refresh", default=None, help="comma list of seasons to rebuild; the others come from their saved bundles (merge mode)")
    a = ap.parse_args()
    t0 = time.time()
    cur = current_season()
    if a.seasons:
        first, last = a.seasons.split(",")
        seasons = [season_label(y) for y in range(int(first[:4]), int(last[:4]) + 1)]
    else:
        seasons = [season_label(y) for y in range(1996, int(cur[:4]) + 1)]
    reg = json.load(open(os.path.join(a.out, "registry.json")))
    odds_raw = json.load(open(os.path.join(a.out, "preseason_odds.json"))) if os.path.exists(os.path.join(a.out, "preseason_odds.json")) else {}
    odds = {s: dict(by_team={r["team"]: r["win_total"] for r in v["rows"] if r.get("team") and r.get("win_total") is not None}, source=v.get("source")) for s, v in odds_raw.items()}
    log(f"=== Basketball Coaching Savant build {VERSION}, {seasons[0]}..{seasons[-1]} ({dt.datetime.now():%Y-%m-%d %H:%M})")
    refresh = a.refresh.split(",") if a.refresh else None
    bundles = pass_one(seasons, reg, a.public, a.out, refresh=refresh)
    res = pass_two(bundles, reg, odds, a.public, a.out, seasons)
    # the Data Room goes to public/bcs/data too (it is what the connector reads)
    import shutil
    src, dst = os.path.join(a.out, "data"), os.path.join(a.public, "bcs", "data")
    os.makedirs(dst, exist_ok=True)
    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for f in files:
            shutil.copy2(os.path.join(root, f), os.path.join(dst, rel, f))
    log(f"=== done in {time.time() - t0:.0f}s: {res['pages']} pages, career pool {res['eligible']}")
    open(os.path.join(a.out, "build.log"), "w").write("\n".join(NOTES))


if __name__ == "__main__":
    main()
