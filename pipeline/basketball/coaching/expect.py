"""
expect.py — what each team should have been, before its coach touched it: two baselines.

  talent   our own. For every player who appeared for the team that season, his impact the
           season before (BPM, as on his Basketball Savant card), weighted by the role he had
           the season before (minutes per game x availability), never by the minutes this
           coach gave him, so the coach's own choices cannot move his baseline. A rookie gets
           the prior of his draft slot: the average rookie-season BPM of that slot's bucket
           across the archive. A player with no prior season and no draft slot gets the
           replacement level (the 10th percentile of prior BPM among players with 500+
           minutes). The weights are normalized to a 240-minute game; the team's talent is
           that weighted sum, and expected net rating is a straight line fitted on talent,
           season by season out of sample (leave one season out). Expected wins follow from
           the fitted wins-per-point-of-net line, scaled to the games played.
  market   the preseason win total (Basketball-Reference's preseason odds pages, with their
           source) and, from 2015-16, ESPN's consensus closing spread game by game: expected
           wins as the empirical win rate at that spread, football's exact method.

    fit(seasons, team_players, team_results) -> model dict, with the out-of-sample report
"""
import json
import os
from collections import defaultdict

import numpy as np

SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
MIN_PRIOR_MIN = 200          # a prior season under this many minutes is noise: shrink it toward replacement
SHRINK_MIN = 1000            # full weight at this many prior minutes
PICK_BUCKETS = [(1, 3), (4, 10), (11, 20), (21, 30), (31, 45), (46, 60)]


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def prev_season(season):
    return season_label(int(season[:4]) - 1)


def draft_slots():
    """{pid: draft number or 0 for undrafted} from the cached PlayerIndex (nba_pulls.py)."""
    import glob
    import pandas as pd
    import savant_engine as E
    import datetime as dt
    t = dt.date.today()
    season = season_label(t.year if t.month >= 10 else t.year - 1)
    key = E._key("PlayerIndex", dict(season=season, historical_nullable=1), 0)
    p = os.path.join(SAVANT, "cache", key + ".json")
    if not os.path.exists(p):
        return {}
    df = pd.read_json(p)
    out = {}
    for r in df.itertuples(index=False):
        n = r.DRAFT_NUMBER
        out[int(r.PERSON_ID)] = int(n) if n == n and n else 0
    return out


def bucket(pick):
    if not pick:
        return "undrafted"
    for a, b in PICK_BUCKETS:
        if a <= pick <= b:
            return f"{a}-{b}"
    return "undrafted"


def rookie_priors(archive_players, seasons, slots):
    """Average rookie-season BPM by draft bucket, minutes-weighted, over the archive."""
    acc = defaultdict(lambda: [0.0, 0.0])
    for s in seasons:
        for pid, p in archive_players(s).items():
            if p.get("exp") != 1 or p.get("bpm") is None or not p.get("min"):     # the archive counts the current season: a rookie is 1
                continue
            b = bucket(slots.get(pid))
            acc[b][0] += p["bpm"] * p["min"]; acc[b][1] += p["min"]
    return {b: round(v[0] / v[1], 2) for b, v in acc.items() if v[1] > 0}


def replacement_level(prior):
    vals = [p["bpm"] for p in prior.values() if p.get("bpm") is not None and (p.get("min") or 0) >= 500]
    return float(np.percentile(vals, 10)) if vals else -3.0


def team_talent(season, roster, archive_players, slots, priors):
    """roster: iterable of pids who appeared for the team. Returns (talent, parts) where parts lists each man's prior."""
    prior = archive_players(prev_season(season))
    repl = replacement_level(prior)
    parts = []
    for pid in roster:
        pp = prior.get(pid)
        if pp and pp.get("bpm") is not None and pp.get("mpg") and pp.get("gp"):
            mins = pp.get("min") or (pp["mpg"] * pp["gp"])
            shrink = min(1.0, max(0.0, (mins - MIN_PRIOR_MIN) / (SHRINK_MIN - MIN_PRIOR_MIN)))
            imp = shrink * pp["bpm"] + (1 - shrink) * repl
            role = pp["mpg"] * min(1.0, pp["gp"] / 82.0)
            parts.append(dict(pid=pid, imp=round(imp, 2), role=round(role, 2), src="prior"))
        else:
            cur = archive_players(season).get(pid) or {}
            if cur.get("exp") == 1 or (pid in slots and cur.get("exp") in (None, 0, 1)):
                b = bucket(slots.get(pid))
                parts.append(dict(pid=pid, imp=priors.get(b, repl), role=8.0 if b in ("1-3", "4-10") else 4.0, src=f"rookie:{b}"))
            else:
                parts.append(dict(pid=pid, imp=repl, role=4.0, src="replacement"))
    tot = sum(x["role"] for x in parts) or 1.0
    talent = sum(x["imp"] * x["role"] for x in parts) / tot * 5.0      # five men on the floor: a lineup's sum of impacts
    return round(talent, 2), parts


def fit(points, log=print):
    """points: [(season, team, talent, net, wins, games)]. Straight line net = a + b talent, leave-one-season-out."""
    seasons = sorted({p[0] for p in points})
    oos = []
    naive = []
    for s in seasons:
        train = [p for p in points if p[0] != s]
        test = [p for p in points if p[0] == s]
        X = np.array([[1.0, p[2]] for p in train]); y = np.array([p[3] for p in train])
        beta = np.linalg.lstsq(X, y, rcond=None)[0]
        for p in test:
            oos.append((p[3], beta[0] + beta[1] * p[2]))
    X = np.array([[1.0, p[2]] for p in points]); y = np.array([p[3] for p in points])
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    o = np.array(oos)
    ss_res = float(((o[:, 0] - o[:, 1]) ** 2).sum()); ss_tot = float(((o[:, 0] - o[:, 0].mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot else None
    # wins per point of net
    W = np.array([[1.0, p[3]] for p in points]); w = np.array([82.0 * p[4] / p[5] for p in points if p[5]])
    wb = np.linalg.lstsq(W[[i for i, p in enumerate(points) if p[5]]], w, rcond=None)[0]
    return dict(a=round(float(beta[0]), 3), b=round(float(beta[1]), 3), oos_r2=round(r2, 3) if r2 is not None else None,
                rmse=round(float(np.sqrt(ss_res / len(o))), 2), n=len(points), seasons=seasons,
                wins_a=round(float(wb[0]), 2), wins_per_net=round(float(wb[1]), 3))


def spread_curve(rows):
    """Empirical P(win) by closing spread from team-game rows with a spread (football's method)."""
    grp = defaultdict(lambda: [0.0, 0])
    for r in rows:
        if r.get("spread") is None or r.get("w") is None:
            continue
        grp[round(r["spread"])][0] += r["w"]; grp[round(r["spread"])][1] += 1

    def p(sp):
        s = round(sp)
        num = den = 0.0
        for k in range(s - 3, s + 4):
            if k in grp:
                wgt = 1.0 - abs(k - s) / 4.0
                num += grp[k][0] * wgt; den += grp[k][1] * wgt
        if den < 25:
            return 0.03 if sp > 0 else 0.97
        return min(0.985, max(0.015, num / den))
    return p
