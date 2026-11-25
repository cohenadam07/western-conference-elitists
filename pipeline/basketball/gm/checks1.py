"""checks1.py — Module 1's invariants. Run after credit.py; exits non-zero on a failure.

  one team at a time   no person in charge (or No. 2) at two franchises on the same day,
                       allowing the off-season windows of an undated move to overlap
  weights              every credit segment's weights add to 1 (vacancies excepted)
  sources              every tenure carries at least one link
"""
import collections, json, os, sys
from tenures import OUT, norm
from credit import lo_of, hi_of, same_person

T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
U = json.load(open(os.path.join(OUT, 'gm_under.json')))
C = json.load(open(os.path.join(OUT, 'gm_credit.json')))
fails = []


def firm(t):
    """The days he certainly held the job: inside any undated window at either end."""
    a = t['start'] if t['start_precision'] in ('day', 'before coverage') else (t.get('start_window') or [t['start'], t['start']])[1]
    b = hi_of(t) if t['end_precision'] in ('day', 'last seen', 'assumed', 'active', 'open') else (t.get('end_window') or [t['end'], t['end']])[0]
    return a, b


people = collections.defaultdict(list)
for u in U:
    if u['tenure_id'] is None:     # a No. 2 known only from a source: a job like any other for this check
        T.append({'tenure_id': 'under:' + u['person'] + ':' + u['team'], 'person': u['person'], 'person_id': None, 'team': u['team'], 'kind': 'under',
                  'start': u['from'], 'start_precision': 'day', 'end': u['to'], 'end_precision': 'day', 'sources': [u['source']]})
for t in T:
    people[t.get('person_id') if t.get('kind') == 'br' else 'name:' + norm(t['person'])].append(t)
# fold feed spellings into one person
keys = list(people)
merged = {}
for k in keys:
    for t in people[k]:
        root = next((r for r in merged if any(same_person(t['person'], x['person']) for x in merged[r])), k)
        merged.setdefault(root, []).append(t)
conflicts = []
for k, ts in merged.items():
    for i, a in enumerate(ts):
        for b in ts[i + 1:]:
            if a['team'] == b['team']:
                continue
            a0, a1 = firm(a); b0, b1 = firm(b)
            if a0 <= b1 and b0 <= a1:
                # a same-day move: he left one job and took the other on the same dated day
                if (a1 == b0 and a['end_precision'] in ('day', 'game') and b['start_precision'] in ('day', 'game')) or (b1 == a0 and b['end_precision'] in ('day', 'game') and a['start_precision'] in ('day', 'game')):
                    continue
                conflicts.append((a['person'], a['team'], a0, a1, a['tenure_id'], b['team'], b0, b1, b['tenure_id']))
for c in conflicts:
    fails.append(f'two teams at once: {c[0]} {c[1]} {c[2]}..{c[3]} and {c[5]} {c[6]}..{c[7]}')
for f, segs in C.items():
    for s in segs:
        if not s.get('vacancy') and abs(sum(p['weight'] for p in s['people']) - 1) > 1e-6:
            fails.append(f'weights {f} {s["from"]}')
for f, segs in C.items():
    for sg in segs:
        ids = {p['tenure_id'] for p in sg['people']}
        if any(u['tenure_id'] in ids for u in sg.get('under', [])):
            fails.append(f'a No. 2 credited: {f} {sg["from"]}')
        if sg.get('split') in ('lead', 'co-leads') and not sg.get('source'):
            fails.append(f'lead without a source: {f} {sg["from"]}')
for t in T:
    if not t['sources']:
        fails.append(f'no source: {t["tenure_id"]}')
print(f'{len(T)} tenures, {sum(len(v) for v in C.values())} credit segments, {len(fails)} failures')
for x in fails:
    print('  FAIL', x)
sys.exit(1 if fails else 0)
