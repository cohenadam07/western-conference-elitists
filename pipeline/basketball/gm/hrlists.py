"""hrlists.py — Hoops Rumors' tenure lists as a cross-check: on each list's date, does the person we
credit match the one Hoops Rumors names as each team's top executive?"""
import json, re, html as H, os
from fetch import get
from tenures import OUT, team_by_name, norm
from credit import credit_on, same_person
LISTS = {  # url: the date the list describes (its publication month; the page carries no machine date)
    'https://www.hoopsrumors.com/2015/09/longest-tenured-primary-basketball-executives.html': '2015-09-15',
    'https://www.hoopsrumors.com/2017/08/longest-tenured-nba-gmspresidents.html': '2017-08-15',
    'https://www.hoopsrumors.com/2018/08/longest-tenured-nba-gmspresidents-2.html': '2018-08-15',
    'https://www.hoopsrumors.com/2024/08/longest-tenured-nba-gms-presidents-3.html': '2024-08-15',
    'https://www.hoopsrumors.com/2026/09/longest-tenured-nba-gms-presidents-4.html': '2026-09-15',
}
NICK = {}
for nm, yrs in __import__('tenures').team_names().items():
    if len(nm.split()) > 1:
        NICK.setdefault(nm.split()[-1], set()).update(yrs.values())
NICK['sixers'] = {'PHI'}; NICK['blazers'] = {'POR'}; NICK['trail blazers'] = {'POR'}; NICK['ers'] = {'PHI'}
C = json.load(open(os.path.join(OUT, 'gm_credit.json')))
rows = []
for u, d in LISTS.items():
    c, b = get(u, delay=4)
    t = ' '.join(H.unescape(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', b.decode('utf8', 'replace'), flags=re.S)).split())
    for m in re.finditer(r"([A-Z][\w\.'\-]+(?: [A-Z][\w\.'\-]+){1,3}) , ((?:Trail )?[A-Z][a-z0-9]+)(?: \(([^)]+)\))?: ([A-Z][a-z]+ (?:\d{1,2}, )?\d{4})", t):
        name, team, title, since = m.groups()
        fr = NICK.get(norm(team).split()[-1] if norm(team) else '', set())
        if len(fr) != 1:
            fr = {x for x in fr if x != 'NOP' or team == 'Pelicans'} if team != 'Hornets' else ({'NOP'} if d < '2014' else {'CHO'})
        if len(fr) != 1:
            continue
        f = next(iter(fr))
        seg = credit_on(C, f, d)
        ours = [p['person'] for p in seg['people']] if seg else []
        import facts
        sp = facts.SAME_PERSON.get(name)
        ok = any(same_person(name, o) for o in ours) or bool(sp and any(o == next((t['person'] for t in json.load(open(os.path.join(OUT, 'gm_tenures.json'))) if t['person_id'] == sp[0]), None) for o in ours))
        rows.append({'list': u, 'date': d, 'team': f, 'hoopsrumors': name, 'title': title, 'since': since, 'ours': ours, 'agree': ok})
json.dump(rows, open(os.path.join(OUT, 'hr_crosscheck.json'), 'w'), indent=0)
for u in LISTS:
    r = [x for x in rows if x['list'] == u]
    print(u.split('.com/')[1][:60], 'teams', len({x['team'] for x in r}), 'agree', sum(x['agree'] for x in r))
    for x in r:
        if not x['agree']:
            print(f"   {x['team']}: Hoops Rumors {x['hoopsrumors']} ({x['title']}, since {x['since']}) | we credit {x['ours']}")
