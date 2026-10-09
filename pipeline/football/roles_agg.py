"""Depth charts -> the role a man is listed in, for the positions where a role is a job.

A cornerback who covers the slot and one who lives on the boundary share a position and
very little else, and the same goes for a free and a strong safety. Until 2025 the depth
charts could not tell them apart: the NFL's weekly file wrote "CB" on nine rows in ten.
From 2025 nflverse carries an ESPN-sourced snapshot instead, taken most days, and that one
lists a nickel back, a left and a right corner, both safeties and every linebacker spot for
all thirty-two teams.

This reads the snapshots taken during the regular season (an August depth chart is a
guess), counts where each man was listed, starters double, and keeps the spot he held most.
It is a LISTED role, the club's own description of its lineup. It is not where he lined up
on each play: nobody publishes that.

Output: agg/roles_<season>.json -> {"<gsis_id>": ["NB", 1]}   the spot, and his best rank at it
Nothing before 2025, where the file has no such detail.
"""
import csv, datetime, json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_AGG', 'agg')
FIRST_SEASON = 2025

# The spots that say something a position does not already say.
KEEP = {'NB', 'LCB', 'RCB', 'FS', 'SS', 'WLB', 'SLB', 'MLB', 'LILB', 'RILB',
        'LDE', 'RDE', 'NT', 'LDT', 'RDT', 'LT', 'LG', 'C', 'RG', 'RT',
        'QB', 'RB', 'FB', 'WR', 'TE', 'PK', 'P'}


def season_window(y):
    """First and last regular-season game days, from the schedule."""
    p = os.path.join(RAW, 'schedules.csv')
    if not os.path.exists(p):
        return None, None
    days = []
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            if r.get('season') == str(y) and r.get('game_type') == 'REG' and r.get('gameday'):
                days.append(r['gameday'])
    return (min(days), max(days)) if days else (None, None)


def run_season(y):
    p = os.path.join(RAW, 'depth_%d.csv' % y)
    if not os.path.exists(p):
        return None
    first, last = season_window(y)
    cutoff = None
    if last:
        cutoff = (datetime.date.fromisoformat(last) + datetime.timedelta(days=7)).isoformat()
    tally = defaultdict(lambda: defaultdict(float))
    best = defaultdict(lambda: defaultdict(lambda: 99))
    n = 0
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        rd = csv.DictReader(f)
        if 'pos_abb' not in (rd.fieldnames or []):
            return None                               # the older file: no roles to read
        for r in rd:
            day = (r.get('dt') or '')[:10]
            # a week of grace at the end: the last snapshot is taken after the last game
            if first and day < first:
                continue
            if cutoff and day > cutoff:
                continue
            gid = (r.get('gsis_id') or '').strip()
            spot = (r.get('pos_abb') or '').strip().upper()
            if not gid or spot not in KEEP:
                continue
            try:
                rank = int(float(r.get('pos_rank') or 9))
            except ValueError:
                rank = 9
            tally[gid][spot] += 2.0 if rank == 1 else 1.0
            best[gid][spot] = min(best[gid][spot], rank)
            n += 1
    out = {}
    for gid, spots in tally.items():
        top = max(sorted(spots), key=lambda k: spots[k])
        out[gid] = [top, best[gid][top]]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'roles_%d.json' % y), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    count = defaultdict(int)
    for v in out.values():
        count[v[0]] += 1
    return dict(rows=n, players=len(out), nickel=count.get('NB', 0),
                corners=count.get('LCB', 0) + count.get('RCB', 0))


# Where the NFL's own weekly depth chart (2001-2024) lists a defensive back. It cannot tell
# a slot corner from an outside one, but it does say corner or safety, and it says it for
# that season: the player file keeps one position for a whole career.
# (the odd ones are single clubs' own labels, and a couple of the league file's typos; "LS"
# on the defensive chart is a left safety, the long snapper being on the special-teams one)
_CORNER = {'CB', 'LCB', 'RCB', 'NCB', 'NB', 'NKL', 'NICK', 'NICKE', 'MCB', 'N', 'NDB', 'CS',
           'RBC', 'LCR'}
_SAFETY = {'S', 'FS', 'SS', 'RS', 'LS', 'DS'}


def secondary_spots(y, raw=None):
    """{gsis_id: 'CB' | 'S'} from the regular-season depth charts of one season: the side
    of the secondary he was listed on most, starters counting double. Empty where the file
    is missing or is the newer snapshot shape, which roles_<season>.json already covers."""
    p = os.path.join(raw or RAW, 'depth_%d.csv' % y)
    if not os.path.exists(p):
        return {}
    tally = defaultdict(lambda: [0.0, 0.0])
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        rd = csv.DictReader(f)
        if 'depth_position' not in (rd.fieldnames or []):
            return {}
        for r in rd:
            if r.get('game_type') != 'REG' or r.get('formation') != 'Defense':
                continue
            gid = (r.get('gsis_id') or '').strip()
            spot = (r.get('depth_position') or '').strip().upper()
            side = 0 if spot in _CORNER else 1 if spot in _SAFETY else None
            if not gid or side is None:
                continue
            tally[gid][side] += 2.0 if (r.get('depth_team') or '').strip() == '1' else 1.0
    return {gid: ('CB' if c > s else 'S') for gid, (c, s) in tally.items() if c != s}


_SPOTS = {}


def nearest_secondary_spot(y, gid, raw=None, span=3):
    """Where the depth charts listed him in the closest season that has him, up to three
    years either side, the earlier one first. For the seasons the charts do not reach (1999
    and 2000) and the men a season's chart left off: the season table calls half of them
    plain "DB", and the build used to file every one of those at corner."""
    for k in range(1, span + 1):
        for yy in (y - k, y + k):
            key = (raw or RAW, yy)
            if key not in _SPOTS:
                _SPOTS[key] = secondary_spots(yy, raw)
            spot = _SPOTS[key].get(gid)
            if spot:
                return spot
    return None


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or season_list_from_env()
    for y in years:
        if y < FIRST_SEASON:
            continue
        r = run_season(y)
        print(y, 'no role detail in the depth chart - skipped' if r is None else r, flush=True)
