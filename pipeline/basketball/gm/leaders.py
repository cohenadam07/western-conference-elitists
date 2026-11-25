"""leaders.py — the all-time trade and drafting leaderboards and every spell's headline, from the page files
(10+ trades / 10+ picks), for before-and-after comparisons.   python3 leaders.py > file"""
import gzip, json, os
PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'gms')
idx = json.loads(gzip.open(os.path.join(PUB, 'index.json.gz')).read())
tr, dr, head = [], [], []
for p in idx['people']:
    g = json.loads(gzip.open(os.path.join(PUB, 'g', p['file'] + '.json.gz')).read())
    for s in g['spells']:
        d = s.get('detail') or {}
        t, k = d.get('trades') or {}, d.get('drafting') or {}
        who = f"{p['name']} {s['team']} {s['start'][:4]}"
        if (t.get('n') or 0) >= 10:
            tr.append((t['turned_out'], t.get('at_time'), who))
        if (k.get('picks') or 0) >= 10:
            dr.append((k['over_slot'], k['picks'], who))
        if s.get('gm_value_added'):
            head.append((who, s['gm_value_added'].get('0.05'), s.get('gm_value_added_player', {}).get('0.05')))
f = lambda r: f'{r[2]} {r[0]:+,.0f}'
for name, rows in (('TRADES (10+ trades, as they turned out)', tr), ('DRAFTING (10+ picks, over slot)', dr)):
    rows.sort()
    print(name)
    print('  top:    ' + '; '.join(f(r) for r in rows[::-1][:10]))
    print('  bottom: ' + '; '.join(f(r) for r in rows[:10]))
print('HEADLINE')
for h in sorted(head):
    print(f'  {h[0]}|{h[1]}|{h[2]}')
