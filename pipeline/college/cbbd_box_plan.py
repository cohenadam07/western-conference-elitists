"""
cbbd_box_plan.py — how many CBBD calls it would take to fill the box scores ESPN never recorded.
Makes no calls. Adam's request, Nov 2, 2026: estimate now, run when the quota resets on Dec 1.

Seasons 2002-03 to 2008-09, 2011-12 and 2012-13 fail the box gate (98%) because ESPN lists the players
of some games with empty stats. CBBD's `/games/players` returns player box scores for up to 1,000
games per call and takes `startDateRange` / `endDateRange` (checked in its OpenAPI description,
version 1.30.3, Nov 2), so one call covers many games. This plans the date windows from ESPN's own
schedule (days.json) and each season's failing games (rebuilt/<season>/games.pkl):

    whole season    windows of at most CAP games across every date
    failing only    windows that cover only the dates with a failing game, skipping clean stretches

Measured on Nov 2 (cbbd_box.py): CBBD's rows are per TEAM-game, so a 1,000-row reply holds about 480
games and every count below doubles (about 116 calls, not 58). It also has the same gaps as ESPN, so
the plan was dropped; see cbbd_box.py.

CAP is 900, not 1,000: CBBD may count a date's games a little differently from ESPN, and a reply of
exactly 1,000 games means the window was cut short and must be split (one more call).

    python3 cbbd_box_plan.py 2002-03 ... 2012-13      prints the plan, writes <home>/cbbd-box-plan.json
"""
import json
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402

CAP = 900


def windows(counts, dates):
    """Greedy: contiguous date ranges covering `dates`, each holding at most CAP games in all."""
    order = sorted(counts)
    pos = {d: i for i, d in enumerate(order)}
    out, cur = [], None
    for d in sorted(dates):
        if cur is None:
            cur = [d, d, counts[d]]
            continue
        extra = sum(counts[x] for x in order[pos[cur[1]] + 1:pos[d] + 1])
        if cur[2] + extra <= CAP:
            cur[1], cur[2] = d, cur[2] + extra
        else:
            out.append(cur)
            cur = [d, d, counts[d]]
    if cur:
        out.append(cur)
    return out


def plan(season):
    days = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    counts = {d: len(v) for d, v in days.items() if v}
    # our own season.py output on this Mac, as build.py reads it; never a downloaded file
    G = pd.read_pickle(os.path.join(CC.HOME, "rebuilt", season, "games.pkl"))
    d1 = G[G.non_d1 == 0]
    bad = d1[~d1.box_ok]
    bad_dates = set(bad.date.astype(str).str[:10]) & set(counts)
    whole = windows(counts, counts)
    fail = windows(counts, bad_dates)
    need = int(round(0.98 * len(d1)))
    return dict(season=season, d1_games=len(d1), box_ok=int(d1.box_ok.sum()), failing=len(bad), short_of_gate=max(0, need - int(d1.box_ok.sum())),
                dates_with_failures=len(bad_dates), calls_whole_season=len(whole), calls_failing_only=len(fail),
                windows=[dict(start=a, end=b, games=n) for a, b, n in fail])


def main(seasons):
    rows = [plan(s) for s in seasons]
    for r in rows:
        print(f"{r['season']}: {r['failing']:>4} failing of {r['d1_games']} D1 games ({r['short_of_gate']} short of 98%), "
              f"on {r['dates_with_failures']} dates; calls: {r['calls_failing_only']} (failing dates only), {r['calls_whole_season']} (whole season)")
    tot = sum(r["calls_failing_only"] for r in rows)
    print(f"total: {tot} calls (failing dates only), {sum(r['calls_whole_season'] for r in rows)} (whole seasons)")
    json.dump(dict(cap=CAP, seasons=rows, total_failing_only=tot), open(os.path.join(CC.HOME, "cbbd-box-plan.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
