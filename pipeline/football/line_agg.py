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

A second file, agg/roles_<season>.json, carries the finer statements: which side of the
line, and from 2025 slot corner against outside corner, free against strong safety, and
the order at receiver, back and tight end. See run_roles().
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


LINE_SPOTS = ('LT', 'LG', 'C', 'RG', 'RT')
# What the ESPN-sourced file (2025 on) calls each job. Holder and long snapper are left
# out: neither has a card. Returners are kept apart from a man's real position, because
# nobody's job is "kick returner".
SKIP = {'H', 'LS'}
RETURN = {'KR': 'kr', 'PR': 'pr', 'KOR': 'kr'}
# A man listed at two spots at once (the swing tackle at LT2 and RT1) is read at the one
# he is higher at; a tie goes to the spot earlier in this list.
ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
         'LDE', 'RDE', 'LDT', 'RDT', 'NT', 'WLB', 'SLB', 'MLB', 'LILB', 'RILB',
         'LCB', 'RCB', 'NB', 'FS', 'SS', 'PK', 'K', 'P']


def reg_window(y):
    """(first, last) regular-season game day for a season, as ISO dates, or (None, None)."""
    p = os.path.join(RAW, 'schedules.csv')
    if not os.path.exists(p):
        return None, None
    days = []
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            if r.get('season') == str(y) and r.get('game_type') == 'REG' and r.get('gameday'):
                days.append(r['gameday'][:10])
    return (min(days), max(days)) if days else (None, None)


def run_season(y):
    p = os.path.join(RAW, 'depth_%d.csv' % y)
    if not os.path.exists(p):
        return None
    rows = list(csv.DictReader(open(p, newline='', encoding='utf-8', errors='replace')))
    if not rows:
        return None
    cols = rows[0].keys()
    espn = 'pos_abb' in cols
    if espn:                                    # 2025 on
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
    roles = run_roles(y, rows, espn, pos_key, rank_key)
    with open(os.path.join(OUT, 'roles_%d.json' % y), 'w') as f:
        json.dump(roles, f, separators=(',', ':'))
    n = defaultdict(int)
    for v in out.values():
        n[v] += 1
    n['sides'] = len(roles['spot'])
    if roles.get('role'):
        n['roles'] = len(roles['role'])
    return dict(n)


def run_roles(y, rows, espn, pos_key, rank_key):
    """The finer statements a depth chart makes, kept apart from the three line cohorts.

      spot   which of the five line spots he is listed at most, LT / LG / C / RG / RT.
             Every season from 2001. This is what "runs behind him" is read from: the
             play-by-play says which gap a run went through, and a left guard's gap is
             not a right guard's.
      role   from 2025 only, when the file started naming them: slot corner against left
             and right corner, free safety against strong, which end a rusher lines up
             at, and where a receiver, back or tight end sits in the order. Stored as
             [spot, rank, current] - ['NB', 1, 1] is the starting slot corner today,
             ['WR', 3, 0] a man who was the third receiver when he was last listed.
      kr/pr  his place in the return order, 1 being the man who is back there.
      depth  each team's chart as it last stood: {team: {spot: [ids in order]}}.

    Only regular-season snapshots count. A July depth chart is a guess, and a February one
    lists men who have already been cut.
    """
    first, last = reg_window(y)
    side = defaultdict(lambda: defaultdict(float))
    listed = defaultdict(lambda: defaultdict(float))       # gid -> spot -> weighted listings
    best = {}                                              # (gid, spot) -> (when, rank)
    snaps = defaultdict(dict)                              # team -> when -> [(spot, rank, gid)]
    for r in rows:
        gid = (r.get('gsis_id') or '').strip()
        spot = (r.get(pos_key) or '').strip().upper()
        if not gid or not spot:
            continue
        try:
            rank = int(float((r.get(rank_key) or '').strip() or 9))
        except ValueError:
            rank = 9
        if espn:
            when = (r.get('dt') or '')
            day = when[:10]
            if first and day < first:
                continue
            if last and day > last:
                continue
            team = (r.get('team') or '').strip()
        else:
            if (r.get('game_type') or 'REG') != 'REG':
                continue
            when = '%02d' % int(float(r.get('week') or 0))
            team = (r.get('club_code') or '').strip()
        if spot in LINE_SPOTS:
            side[gid][spot] += 2.0 if rank == 1 else 1.0
        if not espn or spot in SKIP:
            continue
        listed[gid][spot] += 2.0 if rank == 1 else 1.0
        k = (gid, spot)
        if k not in best or when >= best[k][0]:
            best[k] = (when, rank)
        snaps[team].setdefault(when, []).append((spot, rank, gid))

    out = dict(spot={g: max(sorted(sp), key=lambda s: sp[s]) for g, sp in side.items()})
    if not espn:
        return out
    role, kr, pr = {}, {}, {}
    for gid, spots in listed.items():
        for s, key in RETURN.items():
            if s in spots:
                (kr if key == 'kr' else pr)[gid] = best[(gid, s)][1]
        real = {s: n for s, n in spots.items() if s not in RETURN}
        if not real:
            continue
        # where he is listed highest now; then where he has been listed most
        pick = min(real, key=lambda s: (best[(gid, s)][1], -real[s],
                                        ORDER.index(s) if s in ORDER else 99))
        role[gid] = [pick, best[(gid, pick)][1], best[(gid, pick)][0]]
    depth, asof = {}, None
    for team, by_when in snaps.items():
        asof = max(asof or '', max(by_when))
    # The third field says whether that listing still stands: 1 if he was at that spot in
    # the last chart of the season so far, 0 if he has since dropped off it (cut, traded,
    # on injured reserve). A card should not call a man the second receiver on a team
    # that released him in September.
    for gid, v in role.items():
        v[2] = 1 if v[2][:10] == (asof or '')[:10] else 0
    for team, by_when in snaps.items():
        when = max(by_when)
        chart = defaultdict(list)
        for spot, rank, gid in sorted(by_when[when], key=lambda t: (t[0], t[1])):
            if gid not in chart[spot]:
                chart[spot].append(gid)
        depth[team] = dict(chart)
    out.update(role=role, kr=kr, pr=pr, depth=depth)
    if asof:
        out['asof'] = asof[:10]
    return out


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        if y < FIRST_SEASON:
            continue
        r = run_season(y)
        print(y, 'no depth chart on disk - skipped' if r is None else r, flush=True)
