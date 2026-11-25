"""report1.py — Module 1's numbers: coverage, confidence by team-season, and every trade credited by date."""
import collections, json, os
from tenures import OUT, franchise, shift, team_by_name
from credit import credit_on

T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
C = json.load(open(os.path.join(OUT, 'gm_credit.json')))
G = json.load(open(os.path.join(OUT, 'games.json')))
byid = {t['tenure_id']: t for t in T}


def season_of(d):
    y = int(d[:4]) - (1 if d[5:7] < '07' else 0)
    return f'{y}-{str(y + 1)[2:]}'


# team-season status over the whole basketball year (July 1 - June 30)
status = {}
for s in G:
    y = int(s[:4])
    if y < 1979:
        continue
    for f in set(t for t in [__import__('tenures').franchise(a) for a in G[s]] if t):
        a, b = f'{y}-07-01', min(f'{y + 1}-06-30', __import__('datetime').date.today().isoformat())
        segs = [x for x in C.get(f, []) if x['to'] >= a and x['from'] <= b]
        covered = sum((min(x['to'], b) > max(x['from'], a)) for x in segs)
        days = set()
        for x in segs:
            lo, hi = max(x['from'], a), min(x['to'], b)
            d = lo
            while d <= hi:
                days.add(d); d = shift(d, 1)
        full = len(days) >= (__import__('datetime').date.fromisoformat(b) - __import__('datetime').date.fromisoformat(a)).days + 1
        dis = any(byid[p['tenure_id']]['confidence'] == 'disputed' for x in segs for p in x['people'])
        unk = any(x['date_unknown'] for x in segs)
        multi = any(len(x['people']) > 1 and not x['date_unknown'] for x in segs)
        status[(f, s)] = 'disputed' if (dis or not full) else 'likely' if unk else 'clear'
        status[(f, s) + ('multi',)] = multi
ts = {k: v for k, v in status.items() if len(k) == 2}
print('team-seasons', len(ts), collections.Counter(ts.values()))
print('team-seasons with two or more decision-makers at once (dated)', sum(1 for k, v in status.items() if len(k) == 3 and v))
by_dec = collections.defaultdict(collections.Counter)
for (f, s), v in ts.items():
    by_dec[s[:3] + '0s'][v] += 1
print({k: dict(v) for k, v in sorted(by_dec.items())})

# every Basketball-Reference trade credited to each side by date
tx = json.load(open(os.path.join(OUT, 'br_tx.json')))
res = collections.Counter(); nobody = []
for r in tx:
    if ' traded ' not in r['text'] or not r['date']:
        continue
    for ab in set(r['from'] + r['to']):
        f = 'CHO' if ab == 'CHA' else franchise(ab)
        seg = credit_on(C, f, r['date'])
        if seg and seg.get('vacancy'):
            res['vacancy'] += 1; continue
        if not seg:
            res['nobody'] += 1; nobody.append((r['date'], f)); continue
        w = sum(p['weight'] for p in seg['people'])
        assert abs(w - 1) < 1e-4
        res['date unknown' if seg['date_unknown'] else 'shared' if len(seg['people']) > 1 else 'one person'] += 1
print('trade sides credited:', dict(res))
print('  uncredited sides by franchise-season:', collections.Counter((f, season_of(d)) for d, f in nobody).most_common(8))
