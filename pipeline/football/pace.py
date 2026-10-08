"""Where past seasons stood at the same point -> public/football-pace/<week>.json.

In week 5 a card ranks a man against everybody else's first four games. That is a fair
race, but it is a small one, and it cannot say whether four games like his usually lead
anywhere. This builds the other comparison: every player-season since 2016, cut off at
the same week, worked out the same way a card is - so the page can say "this is the
91st percentile of all first-four-game stretches by a receiver in the last ten years".

For each past season and each week N, every player's games through week N are added
together (weekly.combine) and run through the same build_player() the site uses. A man
is in the pool if he would have been ranked at that point: the qualifying line scaled to
N weeks, the way an in-progress season scales it.

Past seasons are read the way they looked at the time - without the on-field file, which
is only published after a season ends - so a lineman's row here is the same estimate his
card shows in October, not the finished-season count.

Left out on purpose: the Next Gen Stats rows and QBR. Both are published as season-to-date
numbers that cannot be rebuilt for an earlier week from the weekly files, and a pool built
from a different formula than the card's would be a comparison of two different things.
The page falls back to this season's pool for those rows.

Output, one file per week so the page fetches only the one it needs:
  {week, seasons:[2016, ...], pts:[0, 5, ..., 100],
   pos:{QB:{metric:[n, q0, q5, ..., q100]}}}
A list is the pool size and then the pool's value at each percentile in `pts`.

  NFL_PACE_SEASONS=2016-2025 python3 pace.py     # needs those seasons' raw/ and agg/
"""
import json, os, sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
import extra
import weekly as W
from seasons import seasons as season_list, current_season

OUT = os.environ.get('NFL_PACE', os.path.join('..', '..', 'public', 'football-pace'))
FIRST = 2016
PTS = list(range(0, 101, 5))
MIN_POOL = 25
# Published as season-to-date figures; see the note above.
SKIP = {'ttt', 'aysticks', 'aggr', 'xcomp', 'airdist', 'maxair', 'ngscpoe', 'ryoe', 'box8',
        'tlos', 'roepct', 'ngseff', 'sep', 'cush', 'yacoe', 'qbr', 'comp'}


def main():
    spec = os.environ.get('NFL_PACE_SEASONS')
    years = season_list(FIRST, 'NFL_PACE_SEASONS') if spec else list(range(FIRST, current_season()))
    bio, by_pfr, by_espn = B.load_players()
    extra.patch_ids(by_pfr, bio, years)
    curve = {}
    for yy in range(1999, max(years) + 1):
        p = os.path.join(B.RAW, 'reg_%d.csv' % yy)
        if os.path.exists(p):
            curve[yy] = pd.read_csv(p, usecols=['fg_made_list', 'fg_missed_list'], low_memory=False)
    pmake = B.fg_curve(curve)

    pools = {}                      # week -> pos -> metric -> [values]
    used = []
    for y in years:
        G = W.Games(y, bio, by_pfr, by_espn, None, live=True)
        if not G.ok or not G.last:
            print(y, 'no weekly table - skipped', flush=True)
            continue
        full = 17 if y >= 2021 else 16
        last = B.REG_WEEKS if y >= 2021 else 17
        if G.last < last:
            print(y, 'season not finished - skipped', flush=True)
            continue
        used.append(y)
        n_in = 0
        for gid, weeks in G.played.items():
            pos = G.cohort[gid]
            games = [(w, G.game(gid, w)) for w in weeks]
            qkey0, qmin0 = B.QUALIFY.get(pos, ('g', 6))
            for n in range(1, last):
                # A man who has not played since week 6 still has a line in week 9 - the
                # same one - and the bar he has to clear to be ranked has kept rising.
                parts = [g for w, g in games if w <= n and g]
                if not parts:
                    continue
                m, d, _ = W.run(W.combine(parts), gid, pos, bio, pmake, y, team_games=n)
                qkey, qmin = qkey0, qmin0
                have = d.get(qkey)
                if have is None and pos in B.QUALIFY_FALLBACK:
                    qkey, qmin = B.QUALIFY_FALLBACK[pos]
                    have = d.get(qkey)
                # a team has played about n games after week n, less its bye
                tg = min(n, full)
                qmin = max(qmin * tg / float(full), qmin / float(full))
                if have is None or have < qmin:
                    continue
                n_in += 1
                slot = pools.setdefault(n, {}).setdefault(pos, {})
                for k, v in m.items():
                    if k not in SKIP:
                        slot.setdefault(k, []).append(v)
        print(y, 'pooled: %d ranked player-weeks' % n_in, flush=True)

    os.makedirs(OUT, exist_ok=True)
    for n in sorted(pools):
        out = dict(week=n, seasons=used, pts=PTS, pos={})
        for pos, ms in pools[n].items():
            for k, vals in ms.items():
                if len(vals) < MIN_POOL:
                    continue
                q = np.percentile(np.asarray(vals, dtype=float), PTS)
                out['pos'].setdefault(pos, {})[k] = [len(vals)] + [W.sig(float(x)) for x in q]
        W.write_if_changed(os.path.join(OUT, '%d.json' % n), out)
    W.write_if_changed(os.path.join(OUT, 'index.json'),
                       dict(weeks=sorted(pools), seasons=used))
    print('pace pools for weeks', sorted(pools), 'from', used)


if __name__ == '__main__':
    main()
