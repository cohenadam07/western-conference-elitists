"""UFC Savant's Data Room tables, from the fights file UFC Savant already publishes.

    python3 pipeline/dataroom/ufc.py            every year, both tables

Input: public/ufc-savant-fights.json (pipeline/ufc/build.py writes it on every refresh).
Output (DATAROOM_PUBLIC, default public/dataroom): ufc/fights/<year>.json.gz and
ufc/rounds/<year>.json.gz. A UFC "season" is a calendar year, by fight date.

fights: one row per fighter per fight (so every fight is two rows, one from each corner's
side), with the opponent's landed strikes beside his own so "absorbed" needs no join.
rounds: one row per fighter per round, where UFCStats has round-by-round numbers.

Nothing is computed here that UFC Savant does not already show: the rows are the fight file's
own numbers, flattened. Fight seconds follow build.py's rule (full rounds before the last,
plus the time of the last).
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import write_table  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.environ.get('UFC_FIGHTS', os.path.join(ROOT, 'public', 'ufc-savant-fights.json'))
OUT = os.environ.get('DATAROOM_PUBLIC', os.path.join(ROOT, 'public', 'dataroom'))

STAT = ['kd', 'ss', 'ssa', 'ts', 'tsa', 'td', 'tda', 'sub', 'rev', 'ctrl', 'head', 'heada', 'body', 'bodya',
        'leg', 'lega', 'dist', 'dista', 'clinch', 'clincha', 'ground', 'grounda']
OPP = ['kd', 'ss', 'ssa', 'td', 'tda', 'ctrl', 'head', 'body', 'leg']
FIGHT_COLUMNS = (['fight_id', 'date', 'event', 'division', 'title', 'fighter_id', 'fighter', 'opponent_id', 'opponent',
                  'result', 'method', 'finish', 'detail', 'round', 'time', 'fight_seconds', 'scheduled_rounds',
                  'referee', 'bonus', 'stats', 'elo', 'opp_elo']
                 + STAT + ['opp_' + k for k in OPP])
ROUND_COLUMNS = (['fight_id', 'date', 'event', 'division', 'fighter_id', 'fighter', 'opponent_id', 'opponent',
                  'result', 'round', 'round_seconds', 'final_round'] + STAT + ['opp_' + k for k in OPP])


def round_lengths(fmt):
    # "5 Rnd (5-5-5-5-5)" -> [5, 5, 5, 5, 5]; "No Time Limit" -> []
    if not fmt or '(' not in fmt:
        return []
    try:
        return [int(x) for x in fmt.split('(')[1].rstrip(')').split('-')]
    except ValueError:
        return []


def round_seconds(f, r):
    lens = round_lengths(f.get('fmt'))
    if r == (f.get('rnd') or 1):
        return f.get('time') or 0
    if lens and r - 1 < len(lens):
        return lens[r - 1] * 60
    return 300


def fight_seconds(f):
    last = f.get('rnd') or 1
    return sum(round_seconds(f, r) for r in range(1, last + 1))


def finish_kind(method):
    m = (method or '').lower()
    if m.startswith('ko') or 'tko' in m:
        return 'KO'
    if 'submission' in m:
        return 'SUB'
    if 'decision' in m:
        return 'DEC'
    if 'dq' in m:
        return 'DQ'
    return 'OTHER'


def rows_for(fid, f):
    fights, rounds = [], []
    secs = fight_seconds(f)
    lens = round_lengths(f.get('fmt'))
    for i in (0, 1):
        x, o = f['f'][i], f['f'][1 - i]
        base = [fid, f.get('date'), f.get('ev'), f.get('wc'), 1 if f.get('title') else 0, x['id'], x['name'], o['id'], o['name'], x.get('res')]
        fights.append(base + [f.get('method'), finish_kind(f.get('method')), f.get('detail'), f.get('rnd'), f.get('time'), secs,
                              len(lens) or None, f.get('ref'), ','.join(f.get('bonus') or []) or None, 1 if f.get('stats') else 0,
                              x.get('elo'), o.get('elo')]
                      + [x.get(k) for k in STAT] + [o.get(k) for k in OPP])
        orr = {r['r']: r for r in o.get('rounds') or []}
        for r in x.get('rounds') or []:
            q = orr.get(r['r'], {})
            rounds.append([fid, f.get('date'), f.get('ev'), f.get('wc'), x['id'], x['name'], o['id'], o['name'], x.get('res'),
                           r['r'], round_seconds(f, r['r']), 1 if r['r'] == (f.get('rnd') or 1) else 0]
                          + [r.get(k) for k in STAT] + [q.get(k) for k in OPP])
    return fights, rounds


def build(src=SRC, out=OUT):
    with open(src) as fh:
        data = json.load(fh)
    by_year = defaultdict(lambda: ([], []))
    for fid in sorted(data, key=lambda k: (data[k].get('date') or '', k)):
        f = data[fid]
        if not f.get('date') or len(f.get('f') or []) != 2:
            continue
        a, b = rows_for(fid, f)
        by_year[f['date'][:4]][0].extend(a)
        by_year[f['date'][:4]][1].extend(b)
    report = []
    for y in sorted(by_year):
        fr, rr = by_year[y]
        through = max(r[1] for r in fr)
        s1 = write_table(os.path.join(out, 'ufc', 'fights', f'{y}.json.gz'), 'ufc', 'fights', y, FIGHT_COLUMNS, fr, through)
        report.append(('fights', y, len(fr), *s1, through))
        if rr:
            s2 = write_table(os.path.join(out, 'ufc', 'rounds', f'{y}.json.gz'), 'ufc', 'rounds', y, ROUND_COLUMNS, rr, max(r[1] for r in rr))
            report.append(('rounds', y, len(rr), *s2, through))
    return report


if __name__ == '__main__':
    rep = build()
    for t in ('fights', 'rounds'):
        rs = [r for r in rep if r[0] == t]
        print(f"ufc {t}: {len(rs)} years ({rs[0][1]}-{rs[-1][1]}), {sum(r[2] for r in rs)} rows, "
              f"{sum(r[3] for r in rs)/1e6:.1f} MB raw, {sum(r[4] for r in rs)/1e6:.2f} MB gz, largest year {max(r[4] for r in rs)/1e6:.2f} MB gz, through {rs[-1][5]}")
