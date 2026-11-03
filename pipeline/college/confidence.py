"""
confidence.py — how sure each player's opponent adjustment is. Part 2.

An adjustment is only as good as what we know about the teams he played, and in November we know
little: few games, and conferences barely linked to each other, since the links are non-conference
games. So this is measured, not assumed. For every week of four seasons, each team's schedule
strength is figured two ways over the games played so far: with the ratings known that week, and
with the final ratings. The gap between them is how wrong the schedule read was at that point.

    error(games played, non-conference D1 games per team in the conference)

The table of those errors is seed/confidence.json. A player's confidence is 100 × (1 - error ÷ the
largest error), read at his games and his conference's links:

    Early below 50, Firming from 50, Firm from 80

    python3 confidence.py fit
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ratings as RT  # noqa: E402
import season as SZ  # noqa: E402

TABLE = os.path.join(HERE, "seed", "confidence.json")
G_BINS = [3, 6, 9, 12, 15, 18, 22, 26, 31, 99]
L_BINS = [2, 4, 6, 8, 10, 99]
SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]


def bin_of(v, bins):
    for i, b in enumerate(bins):
        if v < b:
            return i
    return len(bins) - 1


def confs(season):
    ids = json.load(open(os.path.join(SZ.OUT, season, "ids.json")))
    return {k: v.get("conf") for k, v in ids["teams"].items()}


def links(gm, conf):
    """Non-conference D1 games per team, by conference, over the games in gm."""
    played, teams = {}, {}
    for r in gm.itertuples():
        ch, ca = conf.get(r.home), conf.get(r.away)
        for t, c, o in ((r.home, ch, ca), (r.away, ca, ch)):
            teams.setdefault(c, set()).add(t)
            if c != o:
                played[c] = played.get(c, 0) + 1
    return {c: played.get(c, 0) / max(1, len(v)) for c, v in teams.items()}


def fit():
    rows = []
    for s in SEASONS:
        gm = RT.game_table(s)
        prior = RT.prior_for(s, None)
        conf = confs(s)
        asof_final = str(pd.to_datetime(gm.date).max().date())
        final, _, _ = RT.fit(gm, asof_final, prior)
        days = sorted(gm.date.unique())
        for d in days[7::7]:
            past = gm[gm.date < d]
            r, _, _ = RT.fit(past, d, prior)
            lk = links(past, conf)
            by = {}
            for g in past.itertuples():
                for t, o in ((g.home, g.away), (g.away, g.home)):
                    by.setdefault(t, []).append(o)
            for t, opp in by.items():
                ok = [o for o in opp if o in r.index and o in final.index]
                if ok:
                    rows.append((bin_of(len(opp), G_BINS), bin_of(lk.get(conf.get(t), 0.0), L_BINS), float(np.mean([r.net[o] for o in ok]) - np.mean([final.net[o] for o in ok]))))
    df = pd.DataFrame(rows, columns=["g", "l", "e"])
    tb = df.groupby(["g", "l"]).e.agg(lambda x: float(np.sqrt(np.mean(x * x))))
    n = df.groupby(["g", "l"]).e.size()
    grid = [[None] * len(L_BINS) for _ in G_BINS]
    for (g, l_), v in tb.items():
        if n[(g, l_)] >= 25:
            grid[g][l_] = round(v, 3)
    # a thin cell borrows from its row, then its neighbour; error never rises with more games
    for g in range(len(G_BINS)):
        known = [x for x in grid[g] if x is not None]
        for l_ in range(len(L_BINS)):
            if grid[g][l_] is None:
                grid[g][l_] = round(float(np.mean(known)), 3) if known else (grid[g - 1][l_] if g else 8.0)
    top = max(max(r) for r in grid)
    json.dump(dict(g_bins=G_BINS, l_bins=L_BINS, error=grid, top=top, rows=len(df)), open(TABLE, "w"), indent=1)
    print(json.dumps(dict(top=top, rows=len(df), by_games=[round(float(np.mean(r)), 2) for r in grid])))


def score(games, link, t):
    e = t["error"][bin_of(games, t["g_bins"])][bin_of(link, t["l_bins"])]
    v = int(round(100 * (1 - e / t["top"])))
    return max(0, min(100, v))


def label(v):
    return "Firm" if v >= 80 else "Firming" if v >= 50 else "Early"


if __name__ == "__main__":
    fit()
