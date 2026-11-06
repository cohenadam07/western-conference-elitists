"""
units.py — five-man units and pairs, and lineups judged from their parts (spec §4 B).

    build(season, games, who) -> {(team, coach): {"units": [...], "pairs": [...]}}
    fit_parts(all_units) -> the projection's line, fitted on college data, and its out-of-sample test

From the lineup games' stints (no garbage time). A unit's net is shrunk to its team's net with College
Savant's measured constants (fives 800 possessions, pairs 1,800: `pipeline/college/build.py`).

Lineups judged from their parts. The NBA build's fit effects were fitted on NBA data, so they are not
reused. Here the projection is the team's net plus b × (the five's mean Savant rate − the team's
minutes-weighted mean rate); b is fitted on odd game ids and tested on even ones against the team's net
alone (the naive guess that every unit plays like the team). If the projection does not beat it out of
sample, everything built on it (lineups left on the table, the best available arrangement) is shown as
unvalidated (spec §4 B).
"""
import itertools
from collections import defaultdict

import numpy as np

K5, K2 = 800.0, 1800.0
MIN_UNIT_POSS = 20


def _stint_rows(g, team):
    home = g["home"] == team
    for s in g.get("stints") or []:
        if s[5]:
            continue                       # garbage time out
        five = tuple(sorted(s[3] if home else s[4]))
        if len(five) != 5:
            continue
        a, b = (6, 20) if home else (20, 6)
        # ON order: poss, pts, fga, fgm, fg3a, fg3m, fta, ftm, oreb, dreb, tov, stl, blk, ast
        o, d = s[a:a + 14], s[b:b + 14]
        yield five, (s[1] - s[2]), o, d


def build(season, games, who, half=None):
    """half: None for all games, 0/1 for even/odd game ids (the out-of-sample test)."""
    acc = defaultdict(lambda: defaultdict(lambda: np.zeros(30)))
    pacc = defaultdict(lambda: defaultdict(lambda: np.zeros(4)))
    team_tot = defaultdict(lambda: np.zeros(4))
    for g in games:
        if not g.get("lineup_ok"):
            continue
        if half is not None and int(g["gid"]) % 2 != half:
            continue
        for team in (g["home"], g["away"]):
            if team in g["non_d1"]:
                continue
            c = who.get(g["gid"], {}).get(team)
            if not c:
                continue
            k = (team, c)
            for five, sec, o, d in _stint_rows(g, team):
                v = acc[k][five]
                v[0] += sec; v[1] += o[0]; v[2] += o[1]; v[3] += d[0]; v[4] += d[1]
                v[5:19] += np.array(o, float); v[19:30] += np.array(d[:11], float)
                for a, b in itertools.combinations(five, 2):
                    p = pacc[k][(a, b)]
                    p[0] += sec; p[1] += o[0]; p[2] += o[1] - d[1]; p[3] += d[0]
                t = team_tot[k]
                t[0] += o[0]; t[1] += o[1]; t[2] += d[0]; t[3] += d[1]
    out = {}
    for k, units in acc.items():
        t = team_tot[k]
        tnet = 100 * (t[1] / max(1, t[0]) - t[3] / max(1, t[2]))
        rows = []
        for five, v in units.items():
            poss = (v[1] + v[3]) / 2
            if poss < 1:
                continue
            raw = 100 * (v[2] / max(1, v[1]) - v[4] / max(1, v[3]))
            adj = (raw * poss + tnet * K5) / (poss + K5)
            fga, fgm, f3m, oreb = v[7], v[8], v[10], v[13]
            rows.append(dict(ids=list(five), min=round(v[0] / 60, 1), poss=round(poss), net=round(raw, 1), adj=round(adj, 1),
                             ortg=round(100 * v[2] / max(1, v[1]), 1), drtg=round(100 * v[4] / max(1, v[3]), 1),
                             efg=round((fgm + 0.5 * f3m) / fga, 3) if fga else None, tov=round(100 * v[15] / max(1, v[1]), 1)))
        rows.sort(key=lambda r: -r["min"])
        prs = []
        for (a, b), p in pacc[k].items():
            poss = p[1]
            raw = 100 * p[2] / max(1, poss)
            prs.append(dict(a=a, b=b, min=round(p[0] / 60, 1), poss=round(poss), net=round(raw, 1), adj=round((raw * poss + tnet * K2) / (poss + K2), 1)))
        out[k] = dict(team_net=round(tnet, 2), units=rows, pairs=sorted(prs, key=lambda r: -r["min"]))
    return out


def mean_rate(ids, rates):
    v = [rates.get(e) for e in ids]
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if len(v) == 5 else None


def team_rate(units, rates):
    num = den = 0.0
    for u in units:
        m = mean_rate(u["ids"], rates)
        if m is not None:
            num += m * u["poss"]; den += u["poss"]
    return num / den if den else None


def fit_parts(train, test, rates_by_season, log=print):
    """train/test: {season: build(...) output}. Returns the line and the test."""
    def rows(src):
        out = []
        for s, by in src.items():
            rates = rates_by_season[s]
            for k, x in by.items():
                tr = team_rate(x["units"], rates)
                if tr is None:
                    continue
                for u in x["units"]:
                    m = mean_rate(u["ids"], rates)
                    if m is None or u["poss"] < MIN_UNIT_POSS:
                        continue
                    out.append((s, k, tuple(u["ids"]), m - tr, x["team_net"], u["net"], u["poss"]))
        return out
    tr = rows(train)
    X = np.array([r[3] for r in tr]); y = np.array([r[5] - r[4] for r in tr]); w = np.array([r[6] for r in tr], float)
    b = float((w * X * y).sum() / (w * X * X).sum())
    te = rows(test)
    # matched units only: the same five, same team, in the other half
    tw = {(r[0], r[1], r[2]): r for r in te}
    e_proj, e_team, ww = [], [], []
    for r in tr:
        q = tw.get((r[0], r[1], r[2]))
        if not q:
            continue
        e_proj.append((q[4] + b * q[3]) - q[5]); e_team.append(q[4] - q[5]); ww.append(q[6])
    ww = np.array(ww, float)
    rm = lambda e: float(np.sqrt(np.sum(ww * np.square(e)) / ww.sum())) if len(e) else None  # noqa: E731
    res = dict(b=round(b, 4), train_units=len(tr), test_units=len(e_proj), rmse_projection=rm(np.array(e_proj)), rmse_team_net=rm(np.array(e_team)))
    res["validated"] = bool(res["rmse_projection"] is not None and res["rmse_projection"] < res["rmse_team_net"])
    log(f"lineups from their parts: {res}")
    return res


def project(team_net, tr, ids, rates, b):
    m = mean_rate(ids, rates)
    return None if m is None or tr is None else team_net + b * (m - tr)


def left_on_table(x, rates, b, roster_ids, games):
    """Minutes per game to units projected 2+ below the best five available (the five highest-rated men
    who played 10%+ of the minutes)."""
    tr = team_rate(x["units"], rates)
    pool = [e for e in roster_ids if rates.get(e) is not None]
    if tr is None or len(pool) < 5:
        return None, None
    best_ids = sorted(pool, key=lambda e: -rates[e])[:5]
    best = project(x["team_net"], tr, best_ids, rates, b)
    mins = 0.0
    for u in x["units"]:
        p = project(x["team_net"], tr, u["ids"], rates, b)
        if p is not None and p <= best - 2.0:
            mins += u["min"]
    return round(mins / max(1, games), 2), best_ids
