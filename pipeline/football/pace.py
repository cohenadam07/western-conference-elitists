"""Same-point-in-the-season baselines -> public/football-pace/wNN.json

In October a card can be ranked against this season's players, who are all on the same
four games, or against history, which is twenty-seven finished seasons of seventeen. The
second comparison is not a fair fight: a rate after four games is far more spread out than
a rate after seventeen, so a good start reads as an all-time great year and a bad one as
the worst season ever played.

This is the fair version. For every finished season on file it rebuilds each player's
line as it stood through week N - his games' inputs added up and run through the same
build_player() his season is, as weekly.py's recent-form windows are - and keeps the
spread of those lines, by position and by stat. The page then ranks "through four games, 2026"
against "through four games, every season since the stat was first kept".

One file per week, written once: history does not change between archive rebuilds. A
file holds, for each position and stat, how many player-seasons are behind it and their
values at 41 evenly spaced percentiles (0, 2.5, 5 ... 100), which is plenty to place a
value to the nearest point and a hundredth of the size of the values themselves.

Needs the seasons' raw/ and agg/ files (it is part of the full rebuild, not the twice-a-day
refresh) and runs after weekly.py, whose packed seasons tell it which ones are finished.

    NFL_SEASONS=1999-2026 NFL_WEEKLY=../../public/football-weekly \
        NFL_PACE=../../public/football-pace python3 pace.py
"""
import json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
import weekly as W

OUT = os.environ.get('NFL_PACE', os.path.join('..', '..', 'public', 'football-pace'))
POINTS = 41
MIN_POOL = 30
LAST_WEEK = 17


def quantiles(vals):
    vals = sorted(vals)
    n = len(vals)
    out = []
    for i in range(POINTS):
        pos = (n - 1) * i / float(POINTS - 1)
        lo = int(pos)
        hi = min(n - 1, lo + 1)
        out.append(W.sig(vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)))
    return out


def main():
    bio, by_pfr, by_espn, pmake = W.setup()
    root = W.OUT_ROOT
    # A season is history once weekly.py has packed it, which it does when the last
    # regular-season week is in.
    seasons = []
    for y in B.SEASONS:
        ip = os.path.join(root, str(y), 'index.json')
        if os.path.exists(ip) and json.load(open(ip)).get('pack'):
            seasons.append(y)
    # History is all of it or it is not history. A run over a few seasons (a rebuild of
    # 2022-2026, say) would rank this year against five seasons and call it "every season
    # since 1999"; the files already on disk are left alone instead.
    on_disk = sorted(int(n) for n in os.listdir(root) if n.isdigit()
                     and os.path.exists(os.path.join(root, n, 'index.json'))
                     and json.load(open(os.path.join(root, n, 'index.json'))).get('pack'))
    short = [y for y in on_disk if y not in seasons or not os.path.exists(os.path.join(W.RAW, 'wk_%d.csv' % y))]
    if short:
        print('pace: left as it is - this run does not have every finished season (%d missing, %d to %d)'
              % (len(short), short[0], short[-1]))
        return
    pools = {n: defaultdict(lambda: defaultdict(list)) for n in range(1, LAST_WEEK + 1)}
    used = []
    for y in seasons:
        I = W.Inputs(y, bio, by_pfr, by_espn, pmake)
        if not I.ok:
            continue
        used.append(y)
        full = 17.0 if y >= 2021 else 16.0
        for gid, pos in I.cohort.items():
            qkey, qmin = B.QUALIFY.get(pos, ('g', 6))
            fkey, fmin = B.QUALIFY_FALLBACK.get(pos, (None, None))
            # his line as it stood after each of his games: the games' inputs added up and
            # run through build_player(), the way his season is (weekly.py, "a span")
            states = list(I.running(gid))
            i, cur = 0, None
            for n in range(1, LAST_WEEK + 1):
                while i < len(states) and states[i][0] <= n:
                    cur = states[i]
                    i += 1
                if cur is None:
                    continue
                _, m, d = cur
                have, need = d.get(qkey), qmin
                if have is None and fkey:
                    have, need = d.get(fkey), fmin
                if have is None or have < need * min(1.0, n / full):
                    continue
                for key, v in m.items():
                    if key in W.PACE_SKIP:
                        continue
                    if v is not None and B.MBY[key]['since'] <= y:
                        pools[n][pos][key].append(v)
        print(y, 'read', flush=True)
    os.makedirs(OUT, exist_ok=True)
    for n in range(1, LAST_WEEK + 1):
        body = {}
        for pos, keys in pools[n].items():
            row = {k: [len(v)] + quantiles(v) for k, v in sorted(keys.items()) if len(v) >= MIN_POOL}
            if row:
                body[pos] = row
        W.write_if_changed(os.path.join(OUT, 'w%02d.json' % n),
                           dict(week=n, seasons=[used[0], used[-1]] if used else [], points=POINTS,
                                pools=body))
    W.write_if_changed(os.path.join(OUT, 'index.json'),
                       dict(weeks=list(range(1, LAST_WEEK + 1)), seasons=[used[0], used[-1]] if used else []))
    print('pace: %d seasons, weeks 1-%d' % (len(used), LAST_WEEK))


if __name__ == '__main__':
    main()
