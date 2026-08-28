"""Per-season field maps: the Football Savant answer to a shot chart.

Two lattices, both straight out of the play-by-play aggregates:

  THROW / TARGET MAP  4 depth bands (behind the line, 0–9, 10–19, 20+) x 3 directions
                      (left, middle, right). Volume, completions, yards per cell.
                      Air yards only exist from 2006, so earlier seasons have no map.

  RUN GAP MAP         the seven gaps a carry can go through, left end to right end,
                      with attempts and yards per gap.

Written one file per season (public/football/maps/<season>.json) rather than one per
player: a season file is ~1 MB, and a reader who opens three players in a season
downloads it once instead of three times.
"""
import json, os, sys
from collections import defaultdict

AGG = os.environ.get('NFL_AGG', 'agg')
OUT = os.environ.get('NFL_MAPS', 'maps')
SEASONS = list(range(1999, 2026))
GAPS = ['le', 'lt', 'lg', 'md', 'rg', 'rt', 're']
CELLS = [d + x for d in 'bsmd' for x in 'lmr']
MIN_PLAYS = 12          # below this a 12-cell map is noise wearing a picture


def roll(rows, keys):
    acc = defaultdict(lambda: defaultdict(float))
    for r in rows:
        a = acc[r['pid']]
        for k in keys:
            v = r.get(k)
            if v:
                a[k] += float(v)
    return acc


def zone_block(acc, total_key):
    out = {}
    for pid, a in acc.items():
        n = sum(a.get('z_' + c, 0) for c in CELLS)
        if n < MIN_PLAYS:
            continue
        cells = []
        for c in CELLS:
            att = int(a.get('z_' + c, 0))
            cells.append([att, int(a.get('zc_' + c, 0)), round(a.get('zy_' + c, 0), 1)])
        out[pid] = dict(n=int(n), z=cells)
    return out


def gap_block(acc):
    out = {}
    for pid, a in acc.items():
        n = sum(a.get('g_' + g, 0) for g in GAPS)
        if n < MIN_PLAYS:
            continue
        out[pid] = dict(n=int(n),
                        g=[[int(a.get('g_' + g, 0)), round(a.get('gy_' + g, 0), 1)] for g in GAPS])
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    zkeys = ['z_' + c for c in CELLS] + ['zc_' + c for c in CELLS] + ['zy_' + c for c in CELLS]
    gkeys = ['g_' + g for g in GAPS] + ['gy_' + g for g in GAPS]
    for y in SEASONS:
        p = os.path.join(AGG, 'pbp_%d.json' % y)
        if not os.path.exists(p):
            continue
        j = json.load(open(p))
        block = dict(
            qb=zone_block(roll(j['qb'], zkeys), 'db'),
            rec=zone_block(roll(j['rec'], zkeys), 'tgt'),
            rush=gap_block(roll(j['rush'], gkeys)),
        )
        # 2006 is when air yards start being charted; before that a throw map is empty.
        if y < 2006:
            block['qb'], block['rec'] = {}, {}
        with open(os.path.join(OUT, '%d.json' % y), 'w') as f:
            json.dump(block, f, separators=(',', ':'))
        for kind, d in block.items():
            for pid in d:
                index.setdefault(pid, {}).setdefault(kind, []).append(y)
        print(y, {k: len(v) for k, v in block.items()}, flush=True)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print('index', len(index), 'players')


if __name__ == '__main__':
    main()
