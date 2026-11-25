"""examples1.py — ten shared-credit team-seasons with the lines and links behind them."""
import json, os
from tenures import OUT
T = json.load(open(os.path.join(OUT, 'gm_tenures.json'))); C = json.load(open(os.path.join(OUT, 'gm_credit.json')))
byid = {t['tenure_id']: t for t in T}
seen, out = set(), []
for f, segs in C.items():
    for s in segs:
        if len(s['people']) < 2 or s['date_unknown'] or s.get('vacancy'):
            continue
        days = (__import__('datetime').date.fromisoformat(s['to']) - __import__('datetime').date.fromisoformat(s['from'])).days + 1
        if days < 60:
            continue
        key = tuple(sorted(p['tenure_id'] for p in s['people']))
        if key in seen:
            continue
        seen.add(key)
        out.append((s, days))
out.sort(key=lambda x: x[0]['from'])
print(len(out), 'distinct shared spells of 60+ days')
pick = out[::max(1, len(out) // 10)][:10]
for s, days in pick:
    print(f"\n{s['team']} {s['from']} to {s['to']} ({days} days), {' / '.join(p['person'] + ' ' + format(p['weight'], '.2f') for p in s['people'])}")
    for p in s['people']:
        t = byid[p['tenure_id']]
        line = t.get('start_line') or ''
        print(f"   {t['person']}: {t.get('title') or 'title not sourced'}; {t['start']} ({t['start_precision']}) to {t['end']} ({t['end_precision']}); {line[:90]}")
        for u in t['sources'][:3]:
            print('      ', u)
