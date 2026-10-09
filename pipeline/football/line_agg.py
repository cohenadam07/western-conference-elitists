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

A second file keeps the side as well, agg/spot_<season>.json -> {"<gsis_id>": "LT" | "LG" |
"C" | "RG" | "RT"}, for the one thing the side is needed for: reading a lineman against the
runs that came through his own gap. A man listed only as "T" or "G" has no side and is left
out of that file.
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
SIDED = ('LT', 'LG', 'C', 'RG', 'RT')


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
        # This file is a snapshot a day, starting in March. Tallied whole, a man who was
        # the right tackle on every chart from spring to August and has started at left
        # tackle since week 1 was a right tackle: twenty linemen in four weeks of 2026 had
        # a spot no in-season chart gave them, and eight were ranked at the wrong position.
        # Only the days of the season count, as roles_agg.py already had it; before a
        # season has a game there is nothing else to go on, so the offseason stands.
        import roles_agg, datetime
        first, last = roles_agg.season_window(y)
        if first:
            end = (datetime.date.fromisoformat(last) + datetime.timedelta(days=7)).isoformat()
            inseason = [r for r in rows if first <= (r.get('dt') or '')[:10] <= end]
            if inseason:
                rows = inseason
    elif 'depth_position' in cols:              # 2001-2024
        pos_key, rank_key, starter = 'depth_position', 'depth_team', '1'
    else:
        return None

    tally = defaultdict(lambda: defaultdict(float))
    sides = defaultdict(lambda: defaultdict(float))
    for r in rows:
        gid = (r.get('gsis_id') or '').strip()
        if not gid:
            continue
        raw = (r.get(pos_key) or '').strip().upper()
        spot = SPOT.get(raw)
        if not spot:
            continue
        w = 2.0 if (r.get(rank_key) or '').strip() == starter else 1.0
        tally[gid][spot] += w
        if raw in SIDED:
            sides[gid][raw] += w

    out = {}
    for gid, spots in tally.items():
        # ties break toward the more specialised spot: a man listed equally at centre and
        # guard is a centre, because nobody plays centre by accident
        out[gid] = max(sorted(spots), key=lambda s: (spots[s], {'OC': 2, 'OG': 1, 'OT': 0}[s]))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'line_%d.json' % y), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    # the side he lined up on, where the depth chart names one and it agrees with his spot
    spots = {}
    for gid, ss in sides.items():
        best = max(sorted(ss), key=lambda k: ss[k])
        if SPOT[best] == out.get(gid):
            spots[gid] = best
    with open(os.path.join(OUT, 'spot_%d.json' % y), 'w') as f:
        json.dump(spots, f, separators=(',', ':'))
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
