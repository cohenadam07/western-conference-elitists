"""
espn_tx.py — ESPN's NBA transactions, one calendar year per request (Nov 2000 on). Reachable
from the cloud; the daily lane in Module 8 reads the same endpoint.

    python3 espn_tx.py [first] [last]     # -> out/espn_tx.json
"""
import json, os, sys
from fetch import get

OUT = os.path.join(os.path.dirname(__file__), 'out')


def url(y):
    return f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/transactions?season={y}&limit=1000'


def year(y):
    c, b = get(url(y), delay=2)
    if c != 200:
        return None
    d = json.loads(b)
    assert d.get('pageCount', 1) <= 1, f'{y}: more than one page'
    return [{'date': t['date'][:10], 'team': t['team']['abbreviation'], 'team_name': t['team']['displayName'],
             'text': t['description'], 'source': url(y)} for t in d['transactions']]


if __name__ == '__main__':
    a, z = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (2000, 2026)
    rows = []
    for y in range(a, z + 1):
        r = year(y)
        print(y, 'missing' if r is None else len(r), flush=True)
        rows += r or []
    os.makedirs(OUT, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT, 'espn_tx.json'), 'w'))
    print('rows', len(rows))
