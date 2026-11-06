"""
build.py — College Basketball Coaching Savant, built end to end.

    python3 build.py [--merge 2026-27] [--public <dir>]

Pass one walks the seasons: every coach-team-season's stats from the games (cts.py), the Rotation Map
(rotation.py) and units (units.py) where lineups exist, roster building (rosters.py), development
(develop.py), the NCAA Tournament (tourney.py's table), resources (EADA), season percentiles, and the
Data Room tables that need nothing league-wide. Pass two builds careers, career percentiles,
fingerprints and comps, arrivals, mentors and the tree, the Leaders boards, scouting reports and the
system-fit tables, and writes the site's files:

  (every file is gzipped on disk as .json.gz; vercel.json serves /cbcs/<path>.json from it, College Savant's rule)
  public/cbcs/index.json                       coaches, leaders, tree, league, stats registry, meta
  public/cbcs/c/<coach>.json                   one coach's page
  public/cbcs/t/<team>-<season>.json.gz        a team-season's Rotation Map, pairs, units, minutes vs rate
  public/cbcs/data/<table>/<season>.json.gz    the Data Room: games, stints, units, rotation, decisions, roster_moves
  public/cbcs/data/programs.json.gz            every program-season: coach, record, NCAA seed and result, AP, spending
  public/cbcs/data/coaches.json, dictionary.json
  public/cbcs/fit.json.gz                      profiles and systems, for "similar players" on both pages
  public/cbcs/heads.json                       badges in each school's colours

Merge mode (--merge <season>) rebuilds that season's pass-one bundle and reuses every other season's saved
bundle (<CBCS_OUT>/bundles), so the nightly cloud refresh needs only the season in progress. Merge
mode and a full build produce the same bytes (the check holds them to it).

Nothing from CollegeBasketballData reaches these files raw: recruiting, rosters, the portal and lines
are inputs to WCE's own numbers (class score ranks, source labels, expectations, the spread curve).
"""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import statistics
import sys
import time
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import config as CF  # noqa: E402
import cts as CT  # noqa: E402
import develop as DV  # noqa: E402
import expect as X  # noqa: E402
import fit as FT  # noqa: E402
import games as GM  # noqa: E402
import modules as MD  # noqa: E402
import registry as RG  # noqa: E402
import rosters as RS  # noqa: E402
import rotation as RT  # noqa: E402
import units as UN  # noqa: E402

VERSION = "1.0.0"
OUT = RS.OUT
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
CURRENT = "2026-27"
STATS_FROM = "2009-10"
LINEUP_FROM = "2023-24"
CREDIT = ("Coaching histories, interim tags and staffs are facts read from Wikipedia (program histories, team-season "
          "articles and biographies), CC BY-SA 4.0, each row linked to its article; they are facts, not Wikipedia's text.")
MODEL_NOTE = CF.MODEL


def log(m):
    print(time.strftime("%H:%M:%S"), m, flush=True)


def dump(path, obj, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    s = json.dumps(clean(obj), separators=(",", ":"), ensure_ascii=False, sort_keys=False)
    if gz:
        with open(path, "wb") as fh:
            fh.write(gzip.compress(s.encode(), 6, mtime=0))
    else:
        with open(path, "w") as fh:
            fh.write(s)


def clean(o):
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else round(o, 4)
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating,)):
        return clean(float(o))
    if isinstance(o, (np.integer,)):
        return int(o)
    return o


def season_list():
    return [RS.season_label(y) for y in range(2003, 2028)]


def has_games(s):
    return os.path.exists(os.path.join(OUT, "games", f"{s}.json.gz"))


# ---------------------------------------------------------------- shared inputs
def inputs():
    I = {}
    I["reg"] = RG.load()
    I["R"] = RS.load()
    I["nets"] = X.team_nets()
    I["E"], I["efit"] = X.load()
    d = DV.load()
    I["dev"], I["dev_lines"], I["dev_check"] = d["teams"], d["lines"], d["check"]
    I["ncaa"] = json.load(open(os.path.join(OUT, "tourney", "ncaa.json")))
    I["seed_base"] = json.load(open(os.path.join(OUT, "tourney", "seed_baseline.json")))
    I["other"] = json.load(open(os.path.join(OUT, "tourney", "other.json")))
    I["ap"] = json.load(open(os.path.join(OUT, "ap", "ap.json")))
    I["eada"] = json.load(open(os.path.join(OUT, "eada", "eada.json")))
    I["fit_test"] = json.load(open(os.path.join(OUT, "fit-test.json")))
    I["parts_fit"] = parts_test(I) if not os.path.exists(os.path.join(OUT, "parts-fit.json")) else json.load(open(os.path.join(OUT, "parts-fit.json")))
    I["names"] = I["reg"]["names"]
    I["spend"] = spend_pct(I["eada"])
    I["res_b"] = resources_line(I)
    # the spread curve is fitted once, by expect.py on the Mac, over every season's games: the cloud has only
    # the season in progress, and refitting there moved wins above the spread in every coach file
    slope, n = I["efit"].get("spread_slope"), I["efit"].get("spread_n")
    if slope is None:
        I["curve"] = X.spread_curve([s for s in season_list() if has_games(s)])
    else:
        I["curve"] = lambda sp: 1 / (1 + math.exp(slope * sp))
        I["curve"].slope, I["curve"].n = slope, n
    return I


def parts_test(I):
    """Lineups judged from their parts, tested where the five men's rates cannot see the games: their
    previous season's rate, units fitted on odd game ids and scored on even ones (2024-25, 2025-26).
    The first try used same-season rates (21.59 against 22.09 for the team's net), but those rates
    are built from the test games. Validated only if the projection cuts the error by 1% or more."""
    reg, R = I["reg"], I["R"]
    tr, te, rates = {}, {}, {}
    for s, ps in (("2024-25", "2023-24"), ("2025-26", "2024-25")):
        g = GM.load(s)
        rates[s] = {r["eid"]: r["rate"] for t in R["seasons"][ps].values() for r in t if r["rate"] is not None}
        tr[s] = UN.build(s, g, reg["who"][s], half=1)
        te[s] = UN.build(s, g, reg["who"][s], half=0)
    res = UN.fit_parts(tr, te, rates, log=log)
    res["validated"] = bool(res["rmse_projection"] is not None and res["rmse_projection"] <= 0.99 * res["rmse_team_net"])
    res["leaky_first_try"] = dict(rmse_projection=21.591, rmse_team_net=22.089, note="same-season rates, which include the test games")
    res["label"] = "validated" if res["validated"] else "unvalidated: the parts barely beat the team's own net out of sample"
    json.dump(res, open(os.path.join(OUT, "parts-fit.json"), "w"), indent=1)
    return res


def spend_pct(eada):
    out = {}
    for s, by in eada["seasons"].items():
        vals = sorted(v["exp"] for v in by.values() if v.get("exp"))
        out[s] = {t: round(100.0 * sum(1 for x in vals if x < v["exp"]) / max(1, len(vals) - 1), 1) for t, v in by.items() if v.get("exp")}
    return out


def resources_line(I):
    """b in net − expected net = b × (spending percentile − 50) ÷ 100, over the scored team-seasons."""
    xs, ys = [], []
    for k, e in I["E"].items():
        s, t = k.split("|")
        p = I["spend"].get(s, {}).get(t)
        if p is None or e.get("net") is None or s not in I["efit"]["scored"]:
            continue
        xs.append((p - 50) / 100.0); ys.append(e["net"] - e["exp_net"])
    x, y = np.array(xs), np.array(ys)
    b = float((x * y).sum() / (x * x).sum()) if len(x) else 0.0
    return dict(b=round(b, 3), n=len(x), r=round(float(np.corrcoef(x, y)[0, 1]), 3) if len(x) > 2 else None)


def main_coach(rows):
    return max(rows, key=lambda r: (r.get("games") or [0, 0, 0])[2])["coach"]


# ---------------------------------------------------------------- pass one: one season
def pass_one(s, I):
    reg, R, nets = I["reg"], I["R"], I["nets"]
    who = reg["who"].get(s, {})
    rows_by_team = R["seasons"].get(s, {})
    rates = {r["eid"]: r["rate"] for t in rows_by_team.values() for r in t if r["rate"] is not None}
    names = {r["eid"]: r["name"] for t in rows_by_team.values() for r in t}
    exp = {k.split("|")[1]: v for k, v in I["E"].items() if k.startswith(s + "|")}
    B = dict(season=s, cts={}, league={}, tfiles={}, data={})
    ts_rows = {k.split("|")[0]: v for k, v in reg["seasons"].items() if k.endswith("|" + s)}
    if has_games(s):
        G = GM.load(s)
        prev = RS.season_label(RS.year_of(s) - 1)
        C = dict(games=G, who=who, nets=nets.get(s, {}), margin=X.margin_model(s, nets), spread_slope=I["curve"].slope, expect=exp,
                 rosters=rows_by_team, lines=X.extra_lines(s), by_date=CT.ratings_by_date(G, nets.get(prev, {})),
                 spend=I["spend"].get(s, {}), res_b=I["res_b"]["b"])
        cts_out, league = CT.season(s, C)
        B["league"] = league
        # lineups and the rotation
        rot = RT.build(s, G, who, rates, names) if s >= LINEUP_FROM else {}
        uni = UN.build(s, G, who) if s >= LINEUP_FROM else {}
        fair = fair_line(rows_by_team, rates)
        B["fair"] = fair
        for k, c in cts_out.items():
            t, coach = k
            v = c["values"]
            r = rot.get(k)
            if r and r["games"]:
                n = r["games"]
                put(v, "stability", None if r["off_script"] is None else 100 * (1 - r["off_script"]), n)
                put(v, "chosen_dev", None if r["by_cause"]["choice"] is None else 100 * r["by_cause"]["choice"], n)
                if r["after_loss"] is not None and r["after_win"] is not None:
                    put(v, "after_loss", 100 * (r["after_loss"] - r["after_win"]), n)
                put(v, "spell", r["shape"]["spell"], n)
                put(v, "first_sub", r["shape"]["first_sub"], n)
                put(v, "all_bench", r["shape"]["all_bench"], n)
                put(v, "stagger2", None if r["shape"]["stagger2"] is None else 100 * r["shape"]["stagger2"], n)
                cl = r["closing"]
                put(v, "closes_best", cl["gap"], cl["gap_n"])
                if cl["close_games"]:
                    put(v, "closes_near", 100 * cl["near"] / max(1, cl["gap_n"]) if cl["gap_n"] else None, cl["gap_n"])
                put(v, "sit_h1", r["sits"]["h1"][0], r["sits"]["h1"][1])
            u = uni.get(k)
            if u:
                lt, best = UN.left_on_table(u, rates, I["parts_b"], [x["id"] for x in (r or {}).get("rows", [])] or list({e for un in u["units"] for e in un["ids"]}), c["g"])
                put(v, "left_table", lt, r["games"] if r else c["g"])
            # overplayed minutes and freshmen's share
            team_rows = rows_by_team.get(t, [])
            if fair and team_rows and coach == main_coach(ts_rows.get(t, [{"coach": coach, "games": [0, 0, 1]}])):
                over = sum(max(0.0, r_["min"] / max(1, r_["gp"]) - fair_at(fair, r_["rate"])) for r_ in team_rows if r_["rate"] is not None and r_["gp"])
                put(v, "overplay", over, c["g"])
                tm = sum(r_["min"] for r_ in team_rows) or 1
                put(v, "fresh_share", 100 * sum(r_["min"] for r_ in team_rows if r_["src"] == "hs" and r_["cls"] == "Fr") / tm, c["g"])
            c["rotation"] = rotation_summary(r) if r else None
            if r or u:
                B["tfiles"].setdefault(t, {})[coach] = tfile_entry(r, u, rates, names, c, I)
        for k, c in cts_out.items():
            B["cts"][k] = c
        B["data"]["games"] = data_games(s, cts_out, I)
        B["data"]["decisions"] = data_decisions(s, cts_out)
        if s >= LINEUP_FROM:
            B["data"]["stints"] = data_stints(s, G, who)
            B["data"]["units"] = data_units(s, uni)
            B["data"]["rotation"] = data_rotation(s, rot)
    # seasons without the games file (2009-10 to 2012-13): records, ratings, rosters
    for t, rows in ts_rows.items():
        for row in rows:
            k = (t, row["coach"])
            if k in B["cts"] or not row.get("games"):
                continue
            g = row["games"]
            v = {}
            put(v, "winpct", 100.0 * g[3] / max(1, g[2]), g[2])
            n_ = nets.get(s, {}).get(t, {})
            if n_.get("net") is not None and len(rows) == 1:
                put(v, "net", n_["net"], g[2]); put(v, "ortg", n_.get("adjo"), g[2]); put(v, "drtg", n_.get("adjd"), g[2]); put(v, "pace", n_.get("tempo"), g[2])
            B["cts"][k] = dict(season=s, team=t, coach=row["coach"], g=g[2], w=g[3], l=g[4], cw=None, cl=None, values=v, splits={}, games=[], decisions=[], management=None, rotation=None)
    # the season-level groups, to each team-season's main coach
    for t, rows in ts_rows.items():
        mc = main_coach(rows)
        k = (t, mc)
        if k not in B["cts"]:
            continue
        c = B["cts"][k]
        v = c["values"]
        c["roster"] = roster_block(s, t, I, v)
        dv = I["dev"].get(f"{s}|{t}")
        if dv:
            for key in ("dev", "dev_young", "dev_hs", "dev_tr"):
                if key in dv:
                    put(v, key, dv[key][0], dv[key][1])
            c["development"] = dict(players=dv["players"][:40], **{key: dv.get(key) for key in ("dev", "dev_young", "dev_hs", "dev_tr")})
        c["tournament"] = tourney_block(s, t, I, v, who)
        sp = I["spend"].get(s, {}).get(t)
        if sp is not None:
            put(v, "spend_pct", sp, 1)
            ex = (I["eada"]["seasons"].get(s, {}).get(t) or {})
            c["resources"] = dict(exp=ex.get("exp"), rev=ex.get("rev"), hc=ex.get("hc"), asst=ex.get("asst"), pct=sp, conf_pct=None, nil_era=s >= "2021-22")
        e = exp.get(t)
        if e:
            c["exp"] = dict(exp_net=e["exp_net"], exp_w=e["exp_w"], w_roster=e["w_roster"], ap_pre=e["ap_pre"], ap_peak=e["ap_peak"], ap_final=e["ap_final"],
                            w_spread=e["w_spread"], ats_pts=e["ats_pts"], spread_g=e["spread_g"], covered=e["covered"])
        apx = I["ap"].get(s, {}).get(t)
        if apx and "exp" not in c:
            c["exp"] = dict(ap_pre=apx.get("pre"), ap_peak=apx.get("peak"), ap_final=apx.get("final"))
    # ncaa appearances count
    for k, c in B["cts"].items():
        tn = c.get("tournament")
        if tn is not None:
            put(c["values"], "ncaa_rate", 100.0 if tn.get("seed") else 0.0, 1)
    # percentiles
    games = {k: c["g"] for k, c in B["cts"].items()}
    vals = {k: c["values"] for k, c in B["cts"].items()}
    pools = {}
    pct = MD.season_percentiles(vals, games, pools=pools)
    live = s == CURRENT
    lpools, lpct = {}, {}
    if live:
        lpct = MD.season_percentiles(vals, games, live=True, pools=lpools)
    for k, c in B["cts"].items():
        c["pct"] = pct.get(k, {})
        c["ranked"] = games[k] >= CF.MIN_SEASON_GAMES
        c["live_pct"] = lpct.get(k) if live and not c["ranked"] else None
        c["live_pools"] = lpools if live and not c["ranked"] else None
        c["in_progress"] = live
    med = {}
    for key in CF.BY_KEY:
        xs = [c["values"][key][0] for c in B["cts"].values() if key in c["values"] and c["g"] >= (CF.MIN_LIVE_GAMES if live else CF.MIN_SEASON_GAMES)]
        if xs:
            med[key] = round(statistics.median(xs), 3)
    B["league"].update(pools=pools, median=med)
    B["data"]["roster_moves"] = data_roster(s, I)
    return B


def put(v, key, val, n):
    if val is not None and n and not (isinstance(val, float) and math.isnan(val)):
        v[key] = [round(float(val), 4), int(round(n))]


def fair_line(rows_by_team, rates):
    """D1's fair-minutes line that season: mean minutes per game by Savant rate (1-point bins, players
    with 10+ games), made monotone (pool-adjacent violators)."""
    bins = defaultdict(lambda: [0.0, 0])
    for t, rows in rows_by_team.items():
        for r in rows:
            if r["rate"] is None or (r["gp"] or 0) < 10:
                continue
            b = int(math.floor(max(-15, min(20, r["rate"]))))
            bins[b][0] += r["min"] / r["gp"]; bins[b][1] += 1
    pts = [[b, v[0] / v[1], v[1]] for b, v in sorted(bins.items()) if v[1] >= 5]
    # PAVA
    blocks = [[p[1] * p[2], p[2], [p[0]]] for p in pts]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] / blocks[i][1] > blocks[i + 1][0] / blocks[i + 1][1]:
            a, b = blocks[i], blocks.pop(i + 1)
            a[0] += b[0]; a[1] += b[1]; a[2] += b[2]
            i = max(0, i - 1)
        else:
            i += 1
    out = []
    for blk in blocks:
        for b in blk[2]:
            out.append([b, round(blk[0] / blk[1], 1)])
    return out


def fair_at(fair, rate):
    if not fair:
        return 0.0
    b = int(math.floor(max(fair[0][0], min(fair[-1][0], rate))))
    for x, m in fair:
        if x >= b:
            return m
    return fair[-1][1]


def rotation_summary(r):
    return dict(off_script=r["off_script"], by_cause=r["by_cause"], after_loss=r["after_loss"], after_win=r["after_win"], shape=r["shape"],
                closing={k: v for k, v in r["closing"].items() if k != "closers"}, games=r["games"], overtime_min=r["overtime_min"])


def tfile_entry(r, u, rates, names, c, I):
    e = dict(coach=c["coach"], first=c["games"][0][0] if c["games"] else None, last=c["games"][-1][0] if c["games"] else None)
    if r:
        e["rotation"] = dict(rows=r["rows"], by_cause=r["by_cause"], games=r["games"], game_rows=r["game_rows"], closing=r["closing"], months=r["months"],
                             off_script=r["off_script"], shape=r["shape"])
        men = [x["id"] for x in sorted(r["rows"], key=lambda x: -x["min"])][:12]
        e["men"] = men
    if u:
        tr = UN.team_rate(u["units"], rates)
        e["team_rates"] = dict(adj=u["team_net"], rate=tr)
        men = e.get("men") or []
        mset = set(men)
        e["matrix"] = [[p["a"], p["b"], p["min"], p["adj"], p["net"], p["poss"]] for p in u["pairs"] if p["a"] in mset and p["b"] in mset]
        units5 = []
        for x in u["units"][:60]:
            if x["min"] < 10:
                continue
            pr = UN.project(u["team_net"], tr, x["ids"], rates, I["parts_b"])
            units5.append(dict(ids=x["ids"], min=x["min"], poss=x["poss"], proj=None if pr is None else round(pr, 1), adj=x["adj"], net=x["net"],
                               ortg=x["ortg"], drtg=x["drtg"], sum_rate=None if UN.mean_rate(x["ids"], rates) is None else round(UN.mean_rate(x["ids"], rates), 2)))
        e["units5"] = units5
        # on/off for the pair matrix click-through
        on = {}
        for p_ in men:
            mins = sum(x["min"] for x in u["units"] if p_ in x["ids"])
            pos = sum(x["poss"] for x in u["units"] if p_ in x["ids"])
            net = sum(x["net"] * x["poss"] for x in u["units"] if p_ in x["ids"]) / max(1, pos)
            on[p_] = dict(on=dict(min=round(mins, 1), adj=round(net, 1)))
        e["onoff"] = on
    team_rows = I["R"]["seasons"].get(c["season"], {}).get(c["team"], [])
    e["mvi"] = dict(players=[dict(id=x["eid"], name=x["name"], mpg=round(x["min"] / max(1, x["gp"]), 1), gp=x["gp"], rate=x["rate"], cls=x["cls"], src=x["src"])
                             for x in team_rows if x["rate"] is not None and x["gp"]])
    return e


def roster_block(s, t, I, v):
    R = I["R"]
    rows = R["seasons"].get(s, {}).get(t, [])
    tm = sum(r["min"] for r in rows) or 1
    by = Counter()
    for r in rows:
        by[r["src"]] += r["min"]
    for key, src in (("ret_min", "returning"), ("tr_min", "transfer"), ("hs_min", "hs"), ("juco_min", "juco"), ("intl_min", "intl")):
        put(v, key, 100.0 * by[src] / tm, 1)
    cls = sum(r["min"] * {"Fr": 1, "So": 2, "Jr": 3, "Sr": 4, "Gr": 5}.get(r["cls"], 2.5) for r in rows) / tm
    put(v, "experience", cls, 1)
    prev = RS.season_label(RS.year_of(s) - 1)
    last = R["seasons"].get(prev, {}).get(t, [])
    elig = [r for r in last if r["cls"] not in ("Sr", "Gr") and r["value"] is not None]
    back = [r for r in elig if (r.get("next") or {}).get("to") == "stayed"]
    den = sum(max(0.0, r["value"]) for r in elig)
    if last and den > 0:
        put(v, "retention", 100.0 * sum(max(0.0, r["value"]) for r in back) / den, 1)
    out_tr = [dict(eid=r["eid"], name=r["name"], to=(r["next"] or {}).get("team"), value=r["value"]) for r in last if (r.get("next") or {}).get("to") == "transfer"]
    e = I["E"].get(f"{s}|{t}")
    parts = {p[0]: p for p in (e or {}).get("parts", [])}
    hit_t, hit_r = [0.0, 0.0, 0], [0.0, 0.0, 0]
    tr_in = []
    for r in rows:
        p = parts.get(r["eid"])
        if r["rate"] is None or not p or (r["min"] or 0) < 100:
            continue
        if r["src"] == "transfer" and s >= "2021-22":
            hit_t[0] += r["min"] * (r["rate"] - p[1]); hit_t[1] += r["min"]; hit_t[2] += 1
        if r["src"] == "hs" and r.get("rrank"):
            hit_r[0] += r["min"] * (r["rate"] - p[1]); hit_r[1] += r["min"]; hit_r[2] += 1
        if r["src"] == "transfer":
            tr_in.append(dict(eid=r["eid"], name=r["name"], frm=r["prev"], rate=r["rate"], exp=p[1], min=r["min"]))
    if hit_t[2]:
        put(v, "portal_hit", hit_t[0] / hit_t[1], hit_t[2])
    if hit_r[2]:
        put(v, "recruit_hit", hit_r[0] / hit_r[1], hit_r[2])
    cr = I["R"]["classes"].get(str(RS.year_of(s) - 1), {}).get(t)
    if cr:
        put(v, "class_rank", cr[1], 1)
    return dict(minutes={k: round(100.0 * by[k] / tm, 1) for k in ("returning", "transfer", "hs", "juco", "intl")},
                class_rank=cr[1] if cr else None, class_n=cr[2] if cr else None, transfers_in=sorted(tr_in, key=lambda x: -x["min"])[:12],
                transfers_out=sorted(out_tr, key=lambda x: -(x["value"] or 0))[:12], players=len(rows))


def tourney_block(s, t, I, v, who):
    nc = I["ncaa"].get(s, {})
    x = (nc.get("teams") or {}).get(t)
    base = {int(k): val["wins"] for k, val in I["seed_base"]["seeds"].items()}
    out = dict(seed=None)
    if x:
        seed = x.get("seed")
        wins = x.get("wins") or 0
        avg = base.get(int(seed)) if seed else None
        ff_w = sum(1 for gm in nc.get("games") or [] if gm.get("team") == t and gm.get("round") == "FF" and gm.get("win"))
        wins = wins - ff_w                       # First Four wins are not tournament wins against the seed's average
        out = dict(seed=seed, region=x.get("region"), wins=wins, result=x.get("result"), result_label=x.get("result_label"), seed_avg=avg)
        if avg is not None:
            put(v, "t_seed", wins - avg, 1)
        # vs WCE's pre-game probabilities: both teams' adjusted nets, neutral floor
        nets = I["nets"].get(s, {})
        sig, _, _ = X.margin_model(s, I["nets"]) if has_games(s) else (11.0, 0, 0)
        ep = 0.0
        ng = 0
        for gm in nc.get("games") or []:
            if gm.get("team") != t or gm.get("round") == "FF":
                continue
            a, b = nets.get(t, {}).get("net"), nets.get(gm.get("opp"), {}).get("net")
            if a is None or b is None:
                continue
            ep += CT.phi((a - b) * CT.POSS_PER_PT / sig); ng += 1
        if ng:
            out["exp_wins_prob"] = round(ep, 2)
            put(v, "t_prob", wins - ep, 1)
    out["other"] = I["other"].get(s, {}).get(t) or []
    return out


# ---------------------------------------------------------------- the Data Room
GAME_COLS = ["season", "date", "gid", "team", "coach", "opp", "site", "conf", "stype", "pts", "opp_pts", "ot", "poss", "game_adj_net", "p_win_roster",
             "spread", "opp_rank_prior", "team_timeouts", "challenges", "missing_rate"]


def data_games(s, cts_out, I):
    rows = []
    for (t, c), x in cts_out.items():
        for g in x["games"]:
            rows.append([s, g[0], g[1], t, c, g[2], g[3], g[4], g[5], g[6], g[7], g[8], g[9], g[10], g[11], g[12], g[13], g[14], g[15], g[16]])
    rows.sort(key=lambda r: (r[1], r[2], r[3]))
    return dict(cols=GAME_COLS, rows=rows)


DEC_COLS = ["season", "gid", "team", "coach", "kind", "period", "clock", "margin", "opp_run", "media_window", "challenge_won", "tv_logged"]


def data_decisions(s, cts_out):
    rows = []
    for (t, c), x in cts_out.items():
        for d in x["decisions"]:
            rows.append([s, d[0], t, c, d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8]])
    rows.sort(key=lambda r: (r[1], r[5], -r[6]))
    return dict(cols=DEC_COLS, rows=rows)


STINT_COLS = ["season", "gid", "team", "coach", "period", "start", "end", "five", "opp_five", "garbage", "poss", "pts", "opp_poss", "opp_pts"]


def data_stints(s, G, who):
    rows = []
    for g in G:
        if not g.get("lineup_ok"):
            continue
        for t in (g["home"], g["away"]):
            if t in g["non_d1"]:
                continue
            c = who.get(g["gid"], {}).get(t)
            home = t == g["home"]
            for st in g.get("stints") or []:
                a, b = (6, 20) if home else (20, 6)
                rows.append([s, g["gid"], t, c, st[0], st[1], st[2], st[3] if home else st[4], st[4] if home else st[3], st[5], st[a], st[a + 1], st[b], st[b + 1]])
    return dict(cols=STINT_COLS, rows=rows)


UNIT_COLS = ["season", "team", "coach", "five", "minutes", "poss", "net", "adj_net", "ortg", "drtg", "efg", "tov_pct"]


def data_units(s, uni):
    rows = []
    for (t, c), x in uni.items():
        for u in x["units"]:
            if u["min"] >= 5:
                rows.append([s, t, c, u["ids"], u["min"], u["poss"], u["net"], u["adj"], u["ortg"], u["drtg"], u["efg"], u["tov"]])
    return dict(cols=UNIT_COLS, rows=rows)


ROT_COLS = ["season", "team", "coach", "player", "games", "starts", "minutes", "mpg", "usual_windows", "off_script", "off_script_choice", "map_played"]


def data_rotation(s, rot):
    rows = []
    for (t, c), x in rot.items():
        for r in x["rows"]:
            rows.append([s, t, c, r["id"], r["gp"], r["starts"], r["min"], r["mpg"], r["windows"], r.get("off"), r.get("off_choice"), r["played"]])
    return dict(cols=ROT_COLS, rows=rows)


MOVE_COLS = ["season", "team", "player", "name", "class", "source", "from_team", "from_season", "minutes", "role", "savant_value", "rate", "next", "next_team"]


def data_roster(s, I):
    rows = []
    for t, rs in I["R"]["seasons"].get(s, {}).items():
        for r in rs:
            nx = r.get("next") or {}
            rows.append([s, t, r["eid"], r["name"], r["cls"], r["src"], r["prev"] if r["src"] == "transfer" else None, r["prev_season"] if r["src"] == "transfer" else None,
                         r["min"], r["role"], r["value"], r["rate"], nx.get("to"), nx.get("team")])
    return dict(cols=MOVE_COLS, rows=rows)


# ---------------------------------------------------------------- bundles (merge mode)
def bundle_path(s):
    return os.path.join(OUT, "bundles", f"{s}.json.gz")


def save_bundle(B):
    """gzip JSON, not pickle: the cloud reads these from a branch. Tuple keys travel as 'team|coach'."""
    b = dict(B, cts={f"{t}|{c}": v for (t, c), v in B["cts"].items()})
    dump(bundle_path(B["season"]), b, gz=True)


def load_bundle(s):
    b = json.loads(gzip.open(bundle_path(s)).read())
    b["cts"] = {tuple(k.split("|", 1)): v for k, v in b["cts"].items()}
    return b


# ---------------------------------------------------------------- pass two
def pass_two(bundles, I, public):
    reg = I["reg"]
    coaches = reg["coaches"]
    names = I["names"]
    cts_all = {}
    for s, B in bundles.items():
        for k, c in B["cts"].items():
            cts_all[(s,) + k] = c
    by_coach = defaultdict(list)
    for k, c in cts_all.items():
        by_coach[k[2]].append(c)
    # ------------------------------------------------ careers
    careers, eligible = {}, set()
    for cid, cs in by_coach.items():
        careers[cid] = MD.career([(c["values"], c["g"]) for c in cs if c["season"] != CURRENT or c["g"] >= CF.MIN_SEASON_GAMES])
        stat_seasons = [c for c in cs if c["season"] >= STATS_FROM and c["season"] != CURRENT]
        if len({c["season"] for c in stat_seasons}) >= CF.MIN_CAREER_SEASONS and sum(c["g"] for c in stat_seasons) >= CF.MIN_CAREER_GAMES:
            eligible.add(cid)
    cpct, cpools = MD.career_percentiles(careers, eligible)
    # ------------------------------------------------ fingerprints and comps
    season_pcts = {(c["season"], c["team"], c["coach"]): c["pct"] for c in cts_all.values()}
    keys_by = defaultdict(list)
    games_by = {}
    for c in cts_all.values():
        k = (c["season"], c["team"], c["coach"])
        keys_by[c["coach"]].append(k); games_by[k] = c["g"]
    fp = MD.fingerprints(season_pcts, keys_by, games_by)
    comp, dist, closer = MD.comps(fp, eligible)
    # ------------------------------------------------ records, tenures, staff, mentors
    records = defaultdict(list)
    head_ts = defaultdict(list)
    for key, rows in reg["seasons"].items():
        t, s = key.split("|")
        for r in rows:
            g = r.get("games")
            nc = (I["ncaa"].get(s, {}).get("teams") or {}).get(t) if len(rows) == 1 or r["coach"] == main_coach(rows) else None
            records[r["coach"]].append(dict(season=s, team=t, w=g[3] if g else r.get("w"), l=g[4] if g else r.get("l"), g=g[2] if g else None,
                                            interim=r["interim"], confirmed=r["confirmed"], src=r["src"][:3], split=bool(r.get("split") or r.get("split_unknown")),
                                            vacated=bool(r.get("vacated")), seed=(nc or {}).get("seed"), ncaa=(nc or {}).get("result"), ncaa_w=(nc or {}).get("wins")))
            head_ts[(s, t)].append(r["coach"])
    first_hc = {cid: min(x["season"] for x in rs) for cid, rs in records.items()}
    ast = assistant_stints(I, coaches)
    mentors = MD.suggest_mentors(ast, lambda s, t: head_ts.get((s, t), []), first_hc)
    kids = defaultdict(list)
    for cid, m in mentors.items():
        if m.get("mentor"):
            kids[m["mentor"]].append(cid)
    # ------------------------------------------------ the tree
    nodes = {}
    for cid in sorted(set(records) | set(mentors) | set(ast)):
        if cid not in coaches:
            continue
        m = mentors.get(cid) or {}
        rs = records.get(cid, [])
        nodes[cid] = dict(name=coaches[cid]["name"], mentor=m.get("mentor") if m.get("mentor") in coaches else None, kids=sorted(kids.get(cid, [])),
                          first=min((x["season"] for x in rs), default=None), last=max((x["season"] for x in rs), default=None),
                          teams=sorted({x["team"] for x in rs}), hc=bool(rs), w=sum(x["w"] or 0 for x in rs), l=sum(x["l"] or 0 for x in rs),
                          tie=bool(m.get("tie")))
    roots = sorted([c for c, n in nodes.items() if not n["mentor"] and n["kids"]], key=lambda c: (-tree_size(c, nodes), c))
    # ------------------------------------------------ the next head coach board (context, not credit)
    next_hc = next_head_coaches(I, coaches, records, head_ts, bundles)
    # ------------------------------------------------ fits (similar players)
    prof = FT.season_profiles(sorted(I["R"]["seasons"]), I["nets"])
    who_team = FT.main_coach(reg)
    latest_full = "2025-26"
    current_coaches = sorted({c["coach"] for c in cts_all.values() if c["season"] == CURRENT})
    fit_tables = FT.publish_tables(prof, who_team, CURRENT, latest_full, current_coaches, I["R"])
    pname = {r["eid"]: r["name"] for ss in I["R"]["seasons"].values() for rows in ss.values() for r in rows}
    for eid, row in fit_tables["players"].items():
        row.append(pname.get(eid))
    # ------------------------------------------------ league and trends
    league = {s: B["league"] for s, B in bundles.items()}
    trends = []
    for s in sorted(bundles):
        med = bundles[s]["league"].get("median", {})
        trends.append(dict(season=s, **{k: med.get(k) for k in ("pace", "fg3r", "to_g", "depth10", "stability", "ch_success", "rim", "tr_min", "ret_min", "ato")}))
    # ------------------------------------------------ write the coach files
    os.makedirs(os.path.join(public, "cbcs", "c"), exist_ok=True)
    idx_rows = []
    nba = nba_links(public)
    for cid, info in coaches.items():
        rs = sorted(records.get(cid, []), key=lambda x: x["season"])
        cs = sorted(by_coach.get(cid, []), key=lambda c: (c["season"], -c["g"]))
        if not rs and cid not in ast:
            continue
        cv = careers.get(cid, {})
        stats = {k: dict(v=x[0], n=x[1], seasons=x[2], pct=cpct.get(cid, {}).get(k), pool=cpools.get(k), **({"sum": x[3]} if len(x) > 3 else {})) for k, x in cv.items()}
        tot_w = sum(x["w"] or 0 for x in rs)
        tot_l = sum(x["l"] or 0 for x in rs)
        ncaa_apps = [x for x in rs if x.get("seed")]
        titles = sum(1 for x in rs if x.get("ncaa") == "CH")
        f4 = sum(1 for x in rs if x.get("ncaa") in ("F4", "NC", "CH"))
        m = mentors.get(cid) or {}
        lineage = dict(mentor=nodes.get(cid, {}).get("mentor"), mentor_name=coaches.get(m.get("mentor"), {}).get("name") if m.get("mentor") else None,
                       role=mentor_role(m, coaches, I) if m.get("mentor") else None, tie=bool(m.get("tie")), seasons=m.get("seasons"),
                       sources=m.get("sources"), also=[[h, coaches.get(h, {}).get("name"), n] for h, n in (m.get("also") or [])],
                       under=[[h, coaches.get(h, {}).get("name"), n, ss] for h, n, ss in (m.get("under") or [])],
                       later=[[h, coaches.get(h, {}).get("name"), n, ss] for h, n, ss in (m.get("later") or [])],
                       kids=[[k, coaches[k]["name"]] for k in kids.get(cid, []) if k in coaches], unconfirmed=bool(m.get("tie")),
                       mentor_closer_than=closer(dist.get(tuple(sorted((cid, m["mentor"]))))) if m.get("mentor") and tuple(sorted((cid, m["mentor"]))) in dist else None)
        seasons_out = []
        pnames = {}
        for c in cs:
            row = season_row(c, I, bundles)
            seasons_out.append(row)
            for p in (c.get("development") or {}).get("players", []):
                pnames[p[0]] = p[1]
        stints = tenures(rs)
        arrivals = arrival_rows(cid, stints, bundles, I)
        cur = next((c for c in cs if c["season"] == CURRENT), None)
        scout_season = None
        if cur:
            vals = cur["values"]
            pc = cur["pct"] if cur["ranked"] else (cur.get("live_pct") or {})
            pools = bundles[CURRENT]["league"].get("pools", {}) if cur["ranked"] else (cur.get("live_pools") or {})
            scout_season = dict(season=CURRENT, lines=MD.scouting_season(vals, pc, pools, CURRENT), games=cur["g"])
            prev = next((c for c in reversed(cs) if c["season"] != CURRENT and c.get("ranked")), None)
            if prev:       # until the season has its five games, the report says so and shows the last full one beneath
                scout_season["last"] = dict(season=prev["season"], lines=MD.scouting_season(prev["values"], prev["pct"], bundles[prev["season"]]["league"].get("pools", {}), prev["season"]))
        doc = dict(id=cid, name=info["name"], version=VERSION,
                   bio=dict(born=info.get("born"), birthplace=info.get("birthplace"), wiki=info.get("wiki"), wiki_url=info.get("wiki_url"), espn=info.get("espn"),
                            first_hc=first_hc.get(cid), age_first_hc=age_at(info.get("born"), first_hc.get(cid)),
                            assistant_seasons_before=sum(1 for st in ast.get(cid, []) if not first_hc.get(cid) or st[0] < first_hc[cid]),
                            nba=nba.get(info["name"])),
                   records=rs, assistant=[dict(season=st[0], team=st[1], role=st[2], src=st[3], heads=head_ts.get((st[0], st[1]), [])) for st in sorted(set(ast.get(cid, [])))],
                   stints=stints, seasons=seasons_out,
                   career=dict(eligible=cid in eligible, stats=stats, g=sum(x["g"] or 0 for x in rs if x["g"]), w=tot_w, l=tot_l,
                               all_time=dict(w=tot_w, l=tot_l, g=tot_w + tot_l, seasons=len({x["season"] for x in rs}), first=rs[0]["season"] if rs else None,
                                             last=rs[-1]["season"] if rs else None, ncaa=len(ncaa_apps), ncaa_w=sum(x.get("ncaa_w") or 0 for x in ncaa_apps),
                                             f4=f4, titles=titles)),
                   player_names=pnames, fingerprint=fp.get(cid, {}), comps=[[b, d, cl, coaches.get(b, {}).get("name")] for b, d, cl in comp.get(cid, [])],
                   lineage=lineage, arrivals=arrivals, scouting=MD.scouting(cv, cpct.get(cid, {}), cpools) if cid in eligible else [],
                   scouting_season=scout_season, fits=coach_fits(cid, fit_tables, prof, who_team, pname) if cid in current_coaches else None)
        dump(os.path.join(public, "cbcs", "c", f"{cid}.json.gz"), doc, gz=True)
        idx_rows.append(dict(id=cid, name=info["name"], g=sum(c["g"] for c in cs), w=sum(c["w"] for c in cs), l=sum(c["l"] for c in cs), seasons=len({c["season"] for c in cs}),
                             all_g=tot_w + tot_l, all_w=tot_w, all_l=tot_l, all_seasons=len({x["season"] for x in rs}), first=rs[0]["season"] if rs else None,
                             last=rs[-1]["season"] if rs else None, teams=sorted({x["team"] for x in rs}), active=any(x["season"] == CURRENT for x in rs),
                             eligible=cid in eligible, hc=bool(rs), assistant=cid in ast, ncaa=len(ncaa_apps), titles=titles, espn=info.get("espn")))
    # ------------------------------------------------ leaders
    leaders = leader_boards(careers, cpct, cpools, eligible, coaches, bundles, next_hc, I)
    produced = sorted(([coaches[c]["name"], c, [coaches[k]["name"] for k in kids[c] if k in coaches]] for c in kids if c in coaches), key=lambda x: (-len(x[2]), x[1]))[:40]
    meta = dict(version=VERSION, generated=os.environ.get("CBCS_GENERATED") or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), through=through(bundles), current=CURRENT,
                seasons=sorted(bundles), rules=dict(career_pool=len(eligible), min_career_seasons=CF.MIN_CAREER_SEASONS, min_career_games=CF.MIN_CAREER_GAMES,
                                                    min_season_games=CF.MIN_SEASON_GAMES, min_live_games=CF.MIN_LIVE_GAMES, stats_from=STATS_FROM, lineup_from=LINEUP_FROM),
                fits=dict(roster=I["efit"], parts=I.get("parts_fit"), development=dict(lines=I["dev_lines"], check=I["dev_check"]), spread_slope=round(I["curve"].slope, 4),
                          spread_n=I["curve"].n, resources=I["res_b"], fit=I["fit_test"]),
                model_note=MODEL_NOTE, credit=CREDIT, tree_note="One mentor per coach: the D1 head coach he served under most seasons before his first head job, from Wikipedia's team-season staffs and coach biographies. Ties are flagged; every other coach he served under is on his page.",
                unconfirmed=sum(1 for rs in records.values() for x in rs if not x["confirmed"]), first_seasons=first_seasons())
    idx = dict(meta=meta, coaches=sorted(idx_rows, key=lambda r: (-r["all_g"], r["id"])), leaders=leaders, tree=dict(nodes=nodes, roots=roots[:60], note=meta["tree_note"]),
               trends=trends, league={s: {k: v for k, v in L.items()} for s, L in league.items()}, teams={t: v for t, v in names.items()},
               stats=CF.STATS, groups=CF.GROUPS, group_labels=CF.GROUP_LABELS, fingerprint=CF.FINGERPRINT, produced=produced, next_hc=next_hc[:60])
    dump(os.path.join(public, "cbcs", "index.json.gz"), idx, gz=True)
    # team-season files
    for s, B in bundles.items():
        for t, by in B["tfiles"].items():
            pn = {}
            for e in by.values():
                for r in (e.get("rotation") or {}).get("rows", []):
                    pn[r["id"]] = r["name"]
                for p in e.get("mvi", {}).get("players", []):
                    pn[p["id"]] = p["name"]
            dump(os.path.join(public, "cbcs", "t", f"{t}-{s}.json.gz"),
                 dict(season=s, team=t, names=pn, fair=B.get("fair"), parts=dict(b=I["parts_b"], validated=(I.get("parts_fit") or {}).get("validated")),
                      coaches=[dict(e, coach_name=coaches.get(c, {}).get("name")) for c, e in by.items()]), gz=True)
        for table, d in B["data"].items():
            dump(os.path.join(public, "cbcs", "data", table, f"{s}.json.gz"), dict(season=s, through=season_through(B), **d), gz=True)
    dump(os.path.join(public, "cbcs", "data", "programs.json.gz"), programs_table(I, records, bundles), gz=True)
    dump(os.path.join(public, "cbcs", "data", "coaches.json.gz"), coaches_table(coaches, records, ast, nodes), gz=True)
    dump(os.path.join(public, "cbcs", "data", "dictionary.json.gz"), dictionary(), gz=True)
    dump(os.path.join(public, "cbcs", "fit.json.gz"), dict(fit_tables, label=I["fit_test"]["ships_as"], test=I["fit_test"]), gz=True)
    dump(os.path.join(public, "cbcs", "heads.json.gz"), heads(records, names), gz=True)
    dump(os.path.join(public, "cbcs", "player-fits.json.gz"), player_fits(fit_tables, coaches), gz=True)
    # College Basketball Savant's team pages link each team-season's head coach(es)
    ts_links = defaultdict(list)
    for cid, rs in records.items():
        for r in rs:
            if r["season"] >= "2009-10":
                ts_links[f"{r['team']}|{r['season']}"].append([cid, coaches[cid]["name"], bool(r["interim"])])
    dump(os.path.join(public, "cbcs", "links.json.gz"), dict(ts=ts_links, note="College Basketball Coaching Savant's head coach of record per team-season"), gz=True)
    log(f"wrote {len(idx_rows)} coach files, {sum(len(B['tfiles']) for B in bundles.values())} team-season files")
    return idx


def season_through(B):
    ds = [r[1] for r in (B["data"].get("games") or {}).get("rows", [])]
    return max(ds) if ds else None


def through(bundles):
    return max((season_through(B) or "") for B in bundles.values()) or None


def first_seasons():
    return {"records and the tree": "as far back as Wikipedia's program histories go", "ratings and roster building": "2009-10 (2011-12 and 2012-13 are off College Savant)",
            "game management, identity, context": "2013-14", "roster model": "2010-11 and 2014-15 on", "market": "2013-14", "rotation map and lineups": "2023-24",
            "challenges": "2025-26", "NCAA Tournament": "2002-03", "resources (EADA)": "2002-03 to 2024-25", "portal hit rate": "2021-22", "recruiting": "2007-08"}


def tree_size(c, nodes, seen=None):
    seen = seen or set()
    if c in seen:
        return 0
    seen.add(c)
    return 1 + sum(tree_size(k, nodes, seen) for k in nodes.get(c, {}).get("kids", []))


def age_at(born, season):
    if not born or not season:
        return None
    try:
        b = dt.date.fromisoformat(born[:10])
    except ValueError:
        return None
    return round((dt.date(int(season[:4]), 11, 1) - b).days / 365.25, 1)


def assistant_stints(I, coaches):
    """{coach id: [(season, team, role, source)]}: team-season infobox staffs, and biography stints whose
    team links to a D1 program's article (role 'assistant')."""
    reg = I["reg"]
    by_title = {c["wiki"]: cid for cid, c in coaches.items() if c.get("wiki")}
    by_key = defaultdict(list)
    for cid, c in coaches.items():
        by_key[RG.nkey(c["name"])].append(cid)
    out = defaultdict(list)
    for t, by in reg["staff"].items():
        for s, x in by.items():
            for name, title in x["rows"]:
                cid = by_title.get(title) if title else None
                if not cid:
                    hits = by_key.get(RG.nkey(name), [])
                    cid = hits[0] if len(hits) == 1 else None
                if cid:
                    out[cid].append((s, t, "assistant", "infobox"))
    P = json.load(open(os.path.join(OUT, "wiki", "programs.json")))
    art = {}
    for tid, x in P.items():
        if x.get("article"):
            art[x["article"]] = tid
    BIO = json.load(open(os.path.join(OUT, "wiki", "coaches.json")))
    for title, b in BIO.items():
        cid = by_title.get(title) or by_title.get(b.get("resolved_title"))
        if not cid:
            continue
        for st in b.get("stints") or []:
            if st.get("role") != "assistant" or st.get("from") is None:
                continue
            tid = art.get(st.get("team_title") or "")
            if not tid:
                continue
            for y in range(st["from"], (st.get("to") or st["from"]) + (0 if st.get("to") and st["to"] > st["from"] else 1)):
                out[cid].append((f"{y}-{str(y + 1)[2:]}", tid, "assistant", "biography"))
    return out


def mentor_role(m, coaches, I):
    under = next((u for u in m.get("under") or [] if u[0] == m["mentor"]), None)
    if not under:
        return None
    ss = under[2]
    return f"assistant, {len(ss)} season{'s' if len(ss) != 1 else ''}, {ss[0]}{' to ' + ss[-1] if len(ss) > 1 else ''}"


def tenures(rs):
    out = []
    for r in rs:
        if out and out[-1]["team"] == r["team"] and RS.year_of(r["season"]) == RS.year_of(out[-1]["last_season"]) + 1:
            o = out[-1]
            o["last_season"] = r["season"]; o["w"] += r["w"] or 0; o["l"] += r["l"] or 0; o["seasons"] += 1
            o["ncaa"] += bool(r.get("seed")); o["interim"] = o["interim"] or r["interim"]
        else:
            out.append(dict(team=r["team"], first_season=r["season"], last_season=r["season"], w=r["w"] or 0, l=r["l"] or 0, seasons=1, ncaa=int(bool(r.get("seed"))), interim=r["interim"]))
    return out


def season_row(c, I, bundles):
    s = c["season"]
    L = bundles[s]["league"]
    return dict(season=s, team=c["team"], g=c["g"], w=c["w"], l=c["l"], cw=c.get("cw"), cl=c.get("cl"),
                net=(c["values"].get("net") or [None])[0], exp=c.get("exp"), values=c["values"], pct=c.get("pct"), ranked=c.get("ranked"),
                live_pct=c.get("live_pct"), live_pools=c.get("live_pools"), in_progress=c.get("in_progress"),
                rotation=c.get("rotation"), management=management_block(c, L), splits=c.get("splits"), identity=identity_block(c),
                development=c.get("development"), roster=c.get("roster"), tournament=c.get("tournament"), resources=c.get("resources"),
                staff=staff_rows(I, c), first=c["games"][0][0] if c.get("games") else None, last=c["games"][-1][0] if c.get("games") else None)


def management_block(c, L):
    m = c.get("management")
    if not m:
        return None
    v = c["values"]
    return dict(m, to_g=(v.get("to_g") or [None])[0], ato_own=(v.get("ato") or [None])[0], halftime=(v.get("halftime") or [None])[0],
                challenges=dict(n=m["ch"], won=m["ch_won"]))


def identity_block(c):
    v = c["values"]
    return {k: (v.get(k) or [None])[0] for k in ("pace", "sec_poss", "early", "trans", "fg3r", "rim", "mid", "c3", "ftr", "ast_pct", "o_fg3r", "o_rim", "o_mid", "press", "o_trans")}


def staff_rows(I, c):
    x = (I["reg"]["staff"].get(c["team"]) or {}).get(c["season"])
    if not x:
        return []
    coaches = I["reg"]["coaches"]
    by_title = {v["wiki"]: k for k, v in coaches.items() if v.get("wiki")}
    return [dict(name=n, id=by_title.get(t) if t else None, wiki=t, src=x["src"]) for n, t in x["rows"]]


def arrival_rows(cid, stints, bundles, I):
    """Before, first season, after he left: team-season values as percentiles among that season's teams,
    plus the returning players' development in his first season (the returning-players-only view)."""
    keys = ["net", "winpct", "pace", "fg3r", "rim", "ast_pct", "orb_pct", "o_fg3r", "o_tov", "to_g", "depth10", "ret_min", "tr_min"]
    out = []
    for st in stints:
        if st["first_season"] < STATS_FROM:
            continue
        t = st["team"]
        y0, y1 = RS.year_of(st["first_season"]), RS.year_of(st["last_season"])
        before, after = RS.season_label(y0 - 1), RS.season_label(y1 + 1)
        rows = {}
        for k in keys:
            v, p = [], []
            for s in (before, st["first_season"], after):
                tv = team_value(bundles, s, t, k)
                v.append(None if tv is None else tv[0]); p.append(None if tv is None else tv[1])
            if v[1] is not None:
                rows[k] = dict(v=v, p=p)
        ret = None
        dv = I["dev"].get(f"{st['first_season']}|{t}")
        if dv:
            pl = [p for p in dv["players"] if p[8] in ("returning", "hs", "transfer", "juco", "intl", "unknown") and p[9] is None]
            w = sum(p[7] for p in pl)
            if w:
                ret = dict(dev=round(sum(p[6] * p[7] for p in pl) / w, 2), n=len(pl), min=round(w))
        out.append(dict(team=t, before_season=before if before in bundles else None, first_season=st["first_season"], last_season=st["last_season"],
                        after_season=after if after in bundles and after != CURRENT else None, rows=rows, returners=ret))
    return out


_TV = {}


def team_value(bundles, s, t, k):
    if s not in bundles:
        return None
    key = (s, k)
    if key not in _TV:
        vals = {}
        for (team, coach), c in bundles[s]["cts"].items():
            if k in c["values"] and (team not in vals or c["g"] > vals[team][1]):
                vals[team] = (c["values"][k][0], c["g"])
        lower = CF.BY_KEY[k]["lower"]
        pr = MD.pct_rank([(team, -v[0] if lower else v[0]) for team, v in vals.items()])
        _TV[key] = {team: (v[0], pr.get(team)) for team, v in vals.items()}
    return _TV[key].get(t)


def next_head_coaches(I, coaches, records, head_ts, bundles):
    """Current assistants (the latest staff season on file) who have never been a D1 head coach: the
    staffs they have been on, those teams' results, the heads they served. Context, not credit."""
    reg = I["reg"]
    latest = max((s for by in reg["staff"].values() for s in by), default=None)
    cand = {}
    for t, by in reg["staff"].items():
        for s, x in by.items():
            for name, title in x["rows"]:
                key = title or name
                e = cand.setdefault(key, dict(name=name, wiki=title, seasons=[], current=None))
                e["seasons"].append((s, t))
                if s == latest or s == CURRENT:
                    e["current"] = t
    hc_titles = {c["wiki"] for cid, c in coaches.items() if c.get("wiki") and records.get(cid)}
    hc_keys = {RG.nkey(c["name"]) for cid, c in coaches.items() if records.get(cid)}
    out = []
    for key, e in cand.items():
        if not e["current"] or (e["wiki"] and e["wiki"] in hc_titles) or RG.nkey(e["name"]) in hc_keys:
            continue
        ss = sorted(set(e["seasons"]))
        nets = []
        ncaa = 0
        heads = Counter()
        for s, t in ss:
            n = I["nets"].get(s, {}).get(t, {}).get("net")
            if n is not None:
                nets.append(n)
            ncaa += bool(((I["ncaa"].get(s, {}).get("teams") or {}).get(t) or {}).get("seed"))
            for h in head_ts.get((s, t), []):
                heads[h] += 1
        out.append(dict(name=e["name"], wiki=e["wiki"], team=e["current"], seasons=len(ss), ncaa=ncaa, mean_net=round(sum(nets) / len(nets), 1) if nets else None,
                        heads=[[h, coaches.get(h, {}).get("name"), n] for h, n in heads.most_common(3)], since=ss[0][0]))
    out.sort(key=lambda r: (-r["ncaa"], -(r["mean_net"] or -99), -r["seasons"], r["name"]))
    return out


def leader_boards(careers, cpct, cpools, eligible, coaches, bundles, next_hc, I):
    def career_board(id_, key, title, note, n=25, low=False):
        rows = [(cid, careers[cid][key]) for cid in eligible if key in careers[cid] and (careers[cid][key][2] if CF.BY_KEY[key]["thr"] == 1 else careers[cid][key][1]) >= (3 if CF.BY_KEY[key]["thr"] == 1 else CF.BY_KEY[key]["thr"])
                and (key not in MD.SUMMED or careers[cid][key][2] >= 3)]
        rows.sort(key=lambda r: ((r[1][0] if low else -r[1][0]), r[0]))
        unit = CF.BY_KEY[key]["unit"]
        return dict(id=id_, title=title, pool=f"head coaches with {CF.MIN_CAREER_SEASONS}+ seasons and {CF.MIN_CAREER_GAMES}+ games from {STATS_FROM}{', three seasons of this stat' if key in MD.SUMMED else ''}, career ({len(rows)})",
                    note=note, unit=unit, kind="coach", season=None,
                    rows=[dict(id=c, name=coaches[c]["name"], value=v[0], display=fmtv(unit, v[0]) + (f" ({v[3]:+.1f} total)" if len(v) > 3 else ""), team=None, season=None) for c, v in rows[:n]])

    def season_board(id_, key, title, note, season, n=15, low=False):
        B = bundles.get(season)
        if not B:
            return None
        thr = CF.BY_KEY[key]["thr"]
        rows = [(k, c["values"][key]) for k, c in B["cts"].items() if key in c["values"] and c["g"] >= (CF.MIN_LIVE_GAMES if season == CURRENT else CF.MIN_SEASON_GAMES)
                and c["values"][key][1] >= (max(1, thr // 4) if season == CURRENT else thr)]
        rows.sort(key=lambda r: ((r[1][0] if low else -r[1][0]), r[0]))
        unit = CF.BY_KEY[key]["unit"]
        return dict(id=id_, title=title, pool=f"{season} head coaches with {CF.MIN_LIVE_GAMES if season == CURRENT else CF.MIN_SEASON_GAMES}+ games and the stat's settle point ({len(rows)})", note=note, unit=unit, kind="season", season=season,
                    rows=[dict(id=k[1], name=coaches.get(k[1], {}).get("name"), value=v[0], display=fmtv(unit, v[0]), team=I["names"].get(k[0], {}).get("abbr") or k[0], season=season) for k, v in rows[:n]])
    boards = [
        career_board("w_roster", "w_roster", "Beat the roster model", "Wins per 30 games beyond what WCE's roster model expected from the players he had. The headline: it beat both naive baselines out of sample."),
        career_board("dev", "dev", "Best developers", "His players' change in Savant rate against D1's expected change for the same class step and level, minutes-weighted."),
        career_board("portal_hit", "portal_hit", "Portal hit rate", "His incoming transfers' rate against what the roster model expected of them, 2021-22 on."),
        career_board("t_seed", "t_seed", "March vs expectation", "NCAA Tournament wins per appearance beyond his seed's average. Short samples: every appearance counts once."),
        did_more_with_less(careers, eligible, coaches, bundles),
        career_board("w_resources", "w_resources", "Wins above resources", "Wins per 30 beyond the roster model plus the fitted effect of spending. Kept off the headline; EADA misses NIL money from 2021-22."),
        career_board("net_roster", "net_roster", "Net above the roster", "Adjusted net rating minus the roster model's expected net, per 100 possessions."),
        career_board("recruit_hit", "recruit_hit", "Recruits who outplay their ranking", "His high-school recruits' first-season rate against what their recruit rank predicts."),
        career_board("ato", "ato", "After-timeout offense", "Points per possession on the first possession after his own timeout."),
        career_board("halftime", "halftime", "Halftime adjusters", "Second-half net minus first-half net, per game."),
        career_board("winpct", "winpct", "Win %", "Every game under him in the stats era."),
        career_board("stability", "stability", "Most stable rotations", "Share of scripted minutes that went to script, 2023-24 on. A tendency."),
        career_board("chosen_dev", "chosen_dev", "Most hands-on rotations", "Off-script minutes by choice, 2023-24 on. A tendency."),
        career_board("tr_min", "tr_min", "Built through the portal", "Share of minutes to first-year D1 transfers. A tendency."),
        career_board("hs_min", "hs_min", "Built through high school", "Share of minutes to freshmen from high school. A tendency."),
        career_board("press", "press", "Press-like pressure", "Turnovers forced within ten seconds of an opponent's inbound after a make. A tendency, as near as play-by-play gets to a press."),
        season_board("cur_w_roster", "w_roster", f"Beat the roster, {CURRENT}", "Provisional until five games.", CURRENT),
        season_board("last_w_roster", "w_roster", "Beat the roster, 2025-26", "The last full season.", "2025-26"),
        season_board("last_dev", "dev", "Best developers, 2025-26", "The last full season.", "2025-26"),
        season_board("last_ch", "ch_success", "Challenge success, 2025-26", "The first season of the men's coach's challenge.", "2025-26"),
    ]
    boards = [b for b in boards if b]
    boards.append(dict(id="rising", title="Rising assistants", pool="current D1 assistants who have never been a D1 head coach", kind="assistant", unit="num0", season=None,
                       note="Context, not credit: the staffs they have been on and how those teams did. Ranked by NCAA Tournament seasons on staff, then those teams' average net.",
                       rows=[dict(id=None, name=r["name"], value=r["ncaa"], display=f"{r['ncaa']} NCAA, {r['seasons']} seasons", team=I["names"].get(r["team"], {}).get("abbr"), season=None, heads=r["heads"]) for r in next_hc[:25]]))
    return boards


def did_more_with_less(careers, eligible, coaches, bundles):
    """Wins above the roster per 30 games, among coaches whose programs averaged below the D1 median in
    spending (EADA), the spending percentile beside it."""
    spend = defaultdict(list)
    for B in bundles.values():
        for (t, c), x in B["cts"].items():
            if "spend_pct" in x["values"]:
                spend[c].append(x["values"]["spend_pct"][0])
    rows = []
    for cid in eligible:
        sp = spend.get(cid)
        if not sp or "w_roster" not in careers[cid]:
            continue
        m = sum(sp) / len(sp)
        if m < 50:
            rows.append((cid, careers[cid]["w_roster"][0], m))
    rows.sort(key=lambda r: (-r[1], r[0]))
    return dict(id="more_with_less", title="Did more with less", pool=f"ranked careers whose programs averaged below the D1 median in spending ({len(rows)})", kind="coach", unit="sgn1", season=None,
                note="Wins per 30 above the roster model, among programs in the lower half of D1 men's basketball spending (EADA). From 2021-22 NIL money is not in EADA.",
                rows=[dict(id=c, name=coaches[c]["name"], value=v, display=f"{v:+.1f} · spend {m:.0f}th pct", team=None, season=None) for c, v, m in rows[:25]])


def fmtv(unit, v):
    if v is None:
        return "—"
    return {"pct1": f"{v:.1f}%", "num1": f"{v:.1f}", "num2": f"{v:.2f}", "sgn1": f"{v:+.1f}", "sgn2": f"{v:+.2f}", "num0": f"{v:.0f}"}.get(unit, str(v))


def nba_links(public):
    """Coaches with NBA head-coaching history link to Basketball Coaching Savant (by exact name)."""
    try:
        d = json.load(open(os.path.join(public, "bcs", "index.json")))
    except (OSError, ValueError):
        return {}
    return {c["name"]: c["id"] for c in d.get("coaches", []) if c.get("hc")}


def coach_fits(cid, T, prof, who_team, pname):
    """Players most like the ones he has used, at their position, with the nearest past player under him.
    The fit test did not show that this predicts improvement, so it is labelled as similarity."""
    sysc = T["systems"].get(cid)
    if not sysc:
        return None
    rows = []
    for eid, (pos, team, s, z, *_rest) in T["players"].items():
        if pos not in sysc:
            continue
        zz = np.array([np.nan if v is None else v for v in z])
        d = FT.distance(zz, np.array(sysc[pos][0]))
        if d is not None:
            rows.append((d, eid, pos, team, s))
    rows.sort()
    out = []
    for d, eid, pos, team, s in rows[:30]:
        near = FT.nearest_under(prof, who_team, cid, eid, s, k=1)
        out.append(dict(eid=eid, name=pname.get(eid), pos=pos, team=team, season=s, match=FT.score(d, T["scale"]),
                        like=[[e, ss, tt, pname.get(e)] for _, e, ss, tt in near]))
    return dict(label=f"Players most like the ones he has used ({T.get('label', 'similar players under him')})", rows=out)


def player_fits(T, coaches):
    """{player: [[coach, match]]}: the five current coaches whose systems used players most like him."""
    out = {}
    for eid, (pos, team, s, z, *_rest) in T["players"].items():
        zz = np.array([np.nan if v is None else v for v in z])
        rows = []
        for c, by in T["systems"].items():
            if pos in by:
                d = FT.distance(zz, np.array(by[pos][0]))
                if d is not None:
                    rows.append((d, c))
        rows.sort()
        out[eid] = [[c, FT.score(d, T["scale"])] for d, c in rows[:5]]
    return dict(names={c: coaches[c]["name"] for c in T["systems"] if c in coaches}, rows=out,
                label="Coaches whose systems used players most like him: similarity, not a prediction (the out-of-sample test on transfers did not earn a fit score).")


def programs_table(I, records, bundles):
    rows = []
    for cid, rs in records.items():
        for r in rs:
            s, t = r["season"], r["team"]
            ap = I["ap"].get(s, {}).get(t) or {}
            e = I["E"].get(f"{s}|{t}") or {}
            rows.append([s, t, cid, r["w"], r["l"], r["interim"], r["confirmed"], r.get("seed"), r.get("ncaa"), ap.get("pre"), ap.get("peak"), ap.get("final"),
                         I["spend"].get(s, {}).get(t), I["nets"].get(s, {}).get(t, {}).get("net"), e.get("exp_net"), r["src"][0] if r["src"] else None])
    rows.sort(key=lambda r: (r[0], r[1]))
    return dict(cols=["season", "team", "coach", "w", "l", "interim", "confirmed", "ncaa_seed", "ncaa_result", "ap_pre", "ap_peak", "ap_final", "spend_pct",
                      "adj_net", "exp_net_roster", "source_url"], rows=rows)


def coaches_table(coaches, records, ast, nodes):
    rows = []
    for cid, c in coaches.items():
        rs = records.get(cid, [])
        rows.append(dict(id=cid, name=c["name"], espn=c.get("espn"), wiki_url=c.get("wiki_url"), born=c.get("born"), birthplace=c.get("birthplace"),
                         head_seasons=[[r["season"], r["team"], r["w"], r["l"], r["interim"], r["confirmed"]] for r in rs],
                         assistant=sorted({(s, t) for s, t, _, _ in ast.get(cid, [])}), mentor=nodes.get(cid, {}).get("mentor")))
    return dict(rows=rows, note=CREDIT)


def heads(records, names):
    """Badges: every coach-season in its school's colours (no college coach photo source is used)."""
    p = {}
    for cid, rs in records.items():
        p[cid] = [[int(r["season"][:4]), None, 2, r["team"]] for r in sorted(rs, key=lambda x: x["season"]) if int(r["season"][:4]) >= 1990]
    teams = {t: ["#" + (v.get("color") or "22395A"), "#" + (v.get("alt") or "C2A263")] for t, v in names.items()}
    return dict(p={k: v for k, v in p.items() if v}, teams=teams, alias={})


def dictionary():
    tables = {
        "games": (GAME_COLS, "One row per D1 team-game with its head coach of record. game_adj_net = 100 × (margin − home edge) ÷ possessions + the opponent's adjusted net. p_win_roster is the roster model's pre-season win probability for the game; spread is the team's own number; opp_rank_prior ranks the opponent on games before this one."),
        "decisions": (DEC_COLS, "Team timeouts (timeout_s short, timeout_f full) and coach's challenges, with the clock in seconds left in the period, the caller's margin, the opponent's unanswered points, whether a TV window was open, the challenge's result (1 overturned, 0 stood), and tv_logged: 1 where ESPN logged that game's TV timeouts separately. In the 0.1-2.6% of games a season where it did not, TV breaks come through as team timeouts, so the coach's timeout stats leave those games out; filter tv_logged = 1 to do the same. One row per team, period and clock (ESPN logs about 1% of timeouts twice)."),
        "stints": (STINT_COLS, "Every lineup stretch of the lineup games, College Savant's stints, from the team's side."),
        "units": (UNIT_COLS, "Five-man units per coach-team-season, garbage time out; adj_net shrunk to the team by 800 possessions."),
        "rotation": (ROT_COLS, "The Rotation Map's rows: each man's usual windows (minute ranges, 0 = tip-off, 40 = the end of regulation) and his on-floor share per minute in the games he played."),
        "roster_moves": (MOVE_COLS, "Every player-season: how he arrived (returning, transfer, hs, juco, intl), from where, his Savant value and rate, and his next stop."),
        "programs": (["season", "team", "coach", "w", "l", "interim", "confirmed", "ncaa_seed", "ncaa_result", "ap_pre", "ap_peak", "ap_final", "spend_pct", "adj_net", "exp_net_roster", "source_url"],
                     "Every program-season with a head coach on record: the registry, the NCAA Tournament, the AP poll (ESPN), spending percentile (EADA), College Savant's net and the roster model."),
    }
    return dict(tables={k: dict(cols=c, note=n) for k, (c, n) in tables.items()}, stats=CF.STATS, credit=CREDIT,
                pools="Every percentile names its pool: a season's D1 head coaches with 15+ games (5 for the season in progress, provisionally), or ranked careers.")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge", default=None)
    ap.add_argument("--public", default=PUBLIC)
    a = ap.parse_args()
    t0 = time.time()
    I = inputs()
    I["parts_b"] = (I.get("parts_fit") or {}).get("b") or 1.71
    seasons = [s for s in season_list() if s >= STATS_FROM and (s in I["R"]["seasons"])]
    bundles = {}
    for s in seasons:
        if a.merge and s != a.merge and os.path.exists(bundle_path(s)):
            bundles[s] = load_bundle(s)
            continue
        B = pass_one(s, I)
        save_bundle(B)
        bundles[s] = B
        log(f"{s}: {len(B['cts'])} coach-team-seasons ({time.time() - t0:.0f}s)")
    pass_two(bundles, I, a.public)
    log(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
