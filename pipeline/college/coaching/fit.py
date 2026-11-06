"""
fit.py — system fit: the bridge to College Basketball Savant (spec §4 L, build step 9).

    python3 fit.py              -> <CBCS_OUT>/fit-test.json, and the tables build.py publishes

A player's profile: usage, three-point rate, rim rate, mid-range rate, assist rate, offensive rebound
rate, free-throw rate, turnover rate (College Savant's raw season values, z-scored within the season)
and his team's tempo. A coach's system, per position (guard, wing, big): the minutes-weighted mean
profile of the men who played that position for him, every season on file before the one being
predicted. The fit is the distance between the two (root mean square over the shared tracks), turned
into a 0-100 score by its place among all player-coach pairs that season.

The test that decides the label (spec §4 L). Every D1 transfer in his first season at a new school,
2021-22 to 2025-26: does fit to the new coach (from the player's previous season and the coach's
earlier seasons only) explain his rate against what the roster model expected of him? Leave one
season out, against the roster model's own expectation (a residual of zero). If the fit lowers the
error out of sample and its slope is positive in every fold, it ships as a fit score; if not, only as
"similar players under him", the nearest past players at his position and how they did.
"""
import gzip
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import expect as X  # noqa: E402
import rosters as RS  # noqa: E402

OUT = RS.OUT
PUBLIC = RS.PUBLIC
FEATS = ["usg", "tpar", "rim_freq", "mid_freq", "ast_pct", "orb_pct", "ftr", "tov_pct"]
MIN_MIN = 200


def season_profiles(seasons, nets):
    """{season: {eid: (pos, team, minutes, z-vector incl. tempo)}} for players with 200+ minutes."""
    out = {}
    for s in seasons:
        p = os.path.join(PUBLIC, "cbb", "s", f"{s}.json.gz")
        if not os.path.exists(p):
            continue
        d = json.loads(gzip.open(p).read())
        P = d["players"]
        cols = {}
        for f in FEATS:
            v = d["values"].get(f, {}).get("r")
            if v is None:
                break
            cols[f] = np.array([np.nan if x is None else x for x in v], float)
        if len(cols) < len(FEATS):
            continue
        tempo = np.array([nets.get(s, {}).get(r[2], {}).get("tempo") or np.nan for r in P], float)
        cols["tempo"] = tempo
        mins = np.array([r[10] or 0 for r in P], float)
        keep = mins >= MIN_MIN
        Z = []
        for f in FEATS + ["tempo"]:
            x = cols[f]
            m, sd = np.nanmean(x[keep]), np.nanstd(x[keep]) or 1.0
            Z.append((x - m) / sd)
        Z = np.array(Z).T
        out[s] = {P[i][0]: (P[i][3], P[i][2], mins[i], Z[i]) for i in range(len(P)) if keep[i] and np.isfinite(Z[i]).sum() >= 6}
    return out


def coach_systems(profiles, who_team, upto):
    """{coach: {pos: (mean z, minutes, n players)}} from seasons before `upto`."""
    acc = defaultdict(lambda: defaultdict(lambda: [np.zeros(len(FEATS) + 1), 0.0, 0]))
    for s, prof in profiles.items():
        if s >= upto:
            continue
        for eid, (pos, team, mins, z) in prof.items():
            c = who_team.get((s, team))
            if not c:
                continue
            a = acc[c][pos]
            a[0] += np.nan_to_num(z) * mins; a[1] += mins; a[2] += 1
    return {c: {pos: (a[0] / a[1], a[1], a[2]) for pos, a in by.items() if a[1] > 0} for c, by in acc.items()}


def distance(z, sysz):
    ok = np.isfinite(z)
    return float(np.sqrt(np.mean(np.square(z[ok] - sysz[ok])))) if ok.any() else None


def main_coach(reg):
    """{(season, team): coach with the most games}."""
    out = {}
    for k, rows in reg["seasons"].items():
        t, s = k.split("|")
        best = max(rows, key=lambda r: (r.get("games") or [0, 0, 0])[2])
        out[(s, t)] = best["coach"]
    return out


def run(reg, log=print):
    R = RS.load()
    nets = X.team_nets()
    E, _ = X.load()
    seasons = sorted(R["seasons"])
    prof = season_profiles(seasons, nets)
    who_team = main_coach(reg)
    rows = []
    for s in [x for x in seasons if "2021-22" <= x <= "2025-26"]:
        ps = RS.season_label(RS.year_of(s) - 1)
        systems = coach_systems(prof, who_team, s)
        exp_parts = {}
        for t, rs in R["seasons"][s].items():
            e = E.get(f"{s}|{t}")
            if e:
                for eid, er, erole, how in e["parts"]:
                    exp_parts[(t, eid)] = er
        for t, rs in R["seasons"][s].items():
            c = who_team.get((s, t))
            sysc = systems.get(c) if c else None
            for r in rs:
                if r["src"] != "transfer" or r["rate"] is None or (r["min"] or 0) < MIN_MIN or r.get("prev_season") != ps:
                    continue
                pp = prof.get(ps, {}).get(r["eid"])
                er = exp_parts.get((t, r["eid"]))
                if not pp or er is None or not sysc or pp[0] not in sysc or sysc[pp[0]][2] < 4:
                    continue
                d = distance(pp[3], sysc[pp[0]][0])
                if d is None:
                    continue
                rows.append((s, d, r["rate"] - er, r["min"]))
    folds = {}
    e_fit, e_base, slopes = [], [], []
    for s in sorted({r[0] for r in rows}):
        tr = [r for r in rows if r[0] != s]
        te = [r for r in rows if r[0] == s]
        Xm = np.column_stack([np.ones(len(tr)), [r[1] for r in tr]])
        w = np.sqrt([r[3] for r in tr])
        b, *_ = np.linalg.lstsq(Xm * w[:, None], np.array([r[2] for r in tr]) * w, rcond=None)
        slopes.append(float(-b[1]))           # a closer fit (smaller distance) should help: slope on −distance
        for r in te:
            e_fit.append((b[0] + b[1] * r[1]) - r[2]); e_base.append(0.0 - r[2])
        folds[s] = dict(n=len(te), slope_on_fit=round(-float(b[1]), 3))
    rm = lambda e: float(np.sqrt(np.mean(np.square(e)))) if e else None  # noqa: E731
    res = dict(n=len(rows), rmse_fit=rm(e_fit), rmse_roster_model=rm(e_base), folds=folds,
               slope_positive_every_fold=all(x > 0 for x in slopes))
    res["ships_as"] = "fit score" if (res["rmse_fit"] is not None and res["rmse_fit"] < res["rmse_roster_model"] and res["slope_positive_every_fold"]) else "similar players under him"
    json.dump(res, open(os.path.join(OUT, "fit-test.json"), "w"), indent=1)
    log(f"fit test: {json.dumps(res)}")
    return res, prof, who_team


def publish_tables(prof, who_team, current, latest_full, coaches_now, R, log=print):
    """The tables the page, College Savant's cards and the connector compute fits from:
    players' profiles (latest full season and the current one), every current coach's system."""
    systems = coach_systems(prof, who_team, "9999")
    play = {}
    for s in (latest_full, current):
        for eid, (pos, team, mins, z) in prof.get(s, {}).items():
            play[eid] = [pos, team, s, [None if not np.isfinite(v) else round(float(v), 3) for v in z]]
    sysout = {}
    for c in coaches_now:
        if c in systems:
            sysout[c] = {pos: [[round(float(v), 3) for v in a[0]], round(a[1]), a[2]] for pos, a in systems[c].items() if a[2] >= 4}
    # the score scale: every current player against every current system at his position
    allds = []
    for eid, (pos, team, s, z) in play.items():
        zz = np.array([np.nan if v is None else v for v in z])
        for c, by in sysout.items():
            if pos in by:
                d = distance(zz, np.array(by[pos][0]))
                if d is not None:
                    allds.append(d)
    allds.sort()
    q = [round(allds[int(i * (len(allds) - 1) / 1000)], 4) for i in range(1001)] if allds else []
    return dict(features=FEATS + ["tempo"], players=play, systems=sysout, scale=q)


def score(d, q):
    """0-100 to one decimal: the share of all current player-coach pairs this pair is closer than (1,001
    quantiles; with 101 the top thirty of every list all read 99)."""
    if d is None or not q:
        return None
    import bisect
    return round(100 - bisect.bisect_left(q, d) * 100 / (len(q) - 1), 1)


def nearest_under(prof, who_team, coach, eid, season, k=3):
    """The past players at his position under this coach nearest his profile, with the season."""
    me = prof.get(season, {}).get(eid)
    if not me:
        return []
    out = []
    for s, pr in prof.items():
        for e, (pos, team, mins, z) in pr.items():
            if e == eid or pos != me[0] or who_team.get((s, team)) != coach:
                continue
            d = distance(me[3], z)
            if d is not None:
                out.append((d, e, s, team))
    out.sort()
    return out[:k]


if __name__ == "__main__":
    import registry as RG
    run(RG.load())
