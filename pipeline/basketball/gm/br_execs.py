"""
br_execs.py — Basketball-Reference's executives: who ran each team, season by season, with the
games of that season he was in charge for (the page's G column). The backbone of the tenure
spine; titles and dates come from elsewhere (tenures.py).

    python3 br_execs.py fetch      # the index and every page whose range reaches 1979-80 (~4 s each)
    python3 br_execs.py parse      # -> out/br_execs.json
"""
import html as H, json, os, re, sys
from fetch import get

BR = 'https://www.basketball-reference.com'
OUT = os.path.join(os.path.dirname(__file__), 'out')


def index():
    c, b = get(BR + '/executives/')
    t = b.decode()
    rows = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        m = re.search(r'<a href="(/executives/[a-z0-9]+x\.html)">([^<]+)</a>', r)
        if not m:
            continue
        txt = ' '.join(H.unescape(re.sub(r'<[^>]+>', ' ', r)).split())
        last = max([int(y) for y in re.findall(r'(\d{4})', txt)] + [0])
        ends = [int(a[:2] + e) if len(e) == 2 else int(e) for a, e in re.findall(r'(\d{4})-(\d{2,4})', txt)]
        rows.append({'url': BR + m.group(1), 'id': m.group(1).split('/')[-1][:-5], 'name': H.unescape(m.group(2)),
                     'last': max([last] + ends), 'teams_text': txt})
    return rows


def page(url):
    c, b = get(url)
    if c != 200:
        return None
    t = b.decode()
    body = t[t.find('<tbody'):t.find('</tbody>')]
    seasons = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
        cells = {k: H.unescape(re.sub(r'<[^>]+>', '', v)).strip() for k, v in re.findall(r'data-stat="([a-z_]+)"[^>]*>(.*?)</t[dh]>', r, re.S)}
        if not cells.get('season') or not cells.get('team_id'):
            continue
        seasons.append({'season': cells['season'], 'team': cells['team_id'], 'lg': cells.get('lg_id'),
                        'g': int(cells.get('g') or 0), 'w': int(cells.get('wins') or 0), 'l': int(cells.get('losses') or 0)})
    i = t.find('id="meta"')
    meta = ' '.join(H.unescape(re.sub(r'<[^>]+>', ' ', t[i:i + 2500])).split())
    born = re.search(r'Born: ([A-Z][a-z]+ \d{1,2}, \d{4})', meta)
    return {'seasons': seasons, 'born': born.group(1) if born else None}


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'parse'
    idx = [r for r in index() if r['last'] >= 1980]
    out = []
    for i, r in enumerate(idx):
        p = page(r['url'])
        if p is None:
            print('missing', r['url']); continue
        out.append(dict(r, **p))
        if cmd == 'fetch' and i % 25 == 0:
            print(i, len(idx), flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, 'br_execs.json'), 'w'), indent=0)
    print('execs', len(out), 'team-seasons', sum(len(x['seasons']) for x in out))
