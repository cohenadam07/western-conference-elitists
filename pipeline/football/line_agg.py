"""Depth charts -> which spot on the offensive line a man actually played.

Football Savant grades every lineman in one pool, which means a left tackle and a center
are ranked against each other. They do not do the same job: a tackle is alone against an
edge rusher on an island, a centre makes the protection calls and is almost never asked to
block anybody by himself. This splits the cohort into tackle, guard and centre.

The source is nflverse's depth charts, and it comes in two shapes:

  2001-2024  the NFL's own weekly file: season, club_code, week, depth_position, depth_team
  2025 on    an ESPN-sourced snapshot taken most days: dt, team, pos_abb, pos_rank

Both name the five line spots consistently, which is the only part of a depth chart that is
consistently named. (The same 2024 file has 2,562 rows that simply say "CB" against 242 that
say LCB, so slot corner and outside corner are not derivable from it, and are not attempted
here.) Left and right pool together: LT and RT are different jobs, but thirty-two men a
season is too thin a pool to rank anybody in honestly.

A season resolves to the spot he appears at most often. Starters count double, so a backup
guard who took four snaps at tackle in week 17 is still a guard.

Output: agg/line_<season>.json -> {"<gsis_id>": "OT" | "OG" | "OC"}. Absent before 2001;
a lineman with no depth-chart row keeps the undifferentiated OL cohort.
"""
import csv, json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_AGG', 'agg')

FIRST_SEASON = 2001

SPOT = {
    'LT': 'OT', 'RT': 'OT', 'T': 'OT', 'OT': 'OT',
    'LG': 'OG', 'RG': 'OG', 'G': 'OG', 'OG': 'OG',
    'C': 'OC', 'OC': 'OC',
}


def run_season(y):
    p = os.path.join(RAW, 'depth_%d.csv' % y)
    if not os.path.exists(p):
        return None
    rows = list(csv.DictReader(open(p, newline='', encoding='utf-8', errors='replace')))
    if not rows:
        return None
    cols = rows[0].keys()
    if 'pos_abb' in cols:                       # 2025 on
        pos_key, rank_key, starter = 'pos_abb', 'pos_rank', '1'
    elif 'depth_position' in cols:              # 2001-2024
        pos_key, rank_key, starter = 'depth_position', 'depth_team', '1'
    else:
        return None

    tally = defaultdict(lambda: defaultdict(float))
    for r in rows:
        gid = (r.get('gsis_id') or '').strip()
        if not gid:
            continue
        spot = SPOT.get((r.get(pos_key) or '').strip().upper())
        if not spot:
            continue
        tally[gid][spot] += 2.0 if (r.get(rank_key) or '').strip() == starter else 1.0

    out = {}
    for gid, spots in tally.items():
        # ties break toward the more specialised spot: a man listed equally at centre and
        # guard is a centre, because nobody plays centre by accident
        out[gid] = max(sorted(spots), key=lambda s: (spots[s], {'OC': 2, 'OG': 1, 'OT': 0}[s]))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'line_%d.json' % y), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    n = defaultdict(int)
    for v in out.values():
        n[v] += 1
    return dict(n)


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        if y < FIRST_SEASON:
            continue
        r = run_season(y)
        print(y, 'no depth chart on disk - skipped' if r is None else r, flush=True)
