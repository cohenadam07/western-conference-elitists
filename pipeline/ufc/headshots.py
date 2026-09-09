#!/usr/bin/env python3
"""
Headshots for UFC Savant, from ESPN.

ufcstats has no images. ESPN's search API resolves a name to an athlete id, and
a.espncdn.com serves a headshot for most fighters who have had a televised fight. This
script keeps raw/headshots.json = {ufcstats id: espn id | null} and only asks ESPN about
fighters it has never asked about, so the nightly run is a handful of requests.

  python3 headshots.py            resolve anyone unresolved (newest fighters first)
  python3 headshots.py --retry    also retry fighters that previously resolved to nothing
"""
import argparse, json, os, re, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
PATH = os.path.join(RAW, 'headshots.json')
sys.path.insert(0, HERE)
from scrape import load  # noqa: E402

S = requests.Session()
S.headers['User-Agent'] = 'Mozilla/5.0 wcehoops-ufc-savant'


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z ]', '', s.lower()).strip()


def resolve(name):
    try:
        r = S.get('https://site.web.api.espn.com/apis/search/v2',
                  params={'query': name, 'limit': 8}, timeout=20)
        if r.status_code != 200:
            return None
        d = r.json()
    except Exception:  # noqa
        return None
    want = norm(name)
    best = None
    for res in d.get('results', []):
        if res.get('type') != 'player':
            continue
        for c in res.get('contents', []):
            uid = c.get('uid', '')
            if 's:3301~' not in uid:          # 3301 = MMA
                continue
            m = re.search(r'a:(\d+)', uid)
            if not m:
                continue
            got = norm(c.get('displayName', ''))
            if got == want:
                return m.group(1)
            if best is None and (got.split()[-1:] == want.split()[-1:]):
                best = m.group(1)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--retry', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    fighters = load('fighters')
    fights = load('fights')
    last = {}
    for f in fights.values():
        for x in f['f']:
            if x['id'] and (f.get('date') or '') > last.get(x['id'], ''):
                last[x['id']] = f['date']
    have = json.load(open(PATH)) if os.path.exists(PATH) else {}
    todo = [pid for pid in fighters if pid not in have or (a.retry and have[pid] is None)]
    todo.sort(key=lambda p: last.get(p, ''), reverse=True)
    if a.limit:
        todo = todo[:a.limit]
    print(f'headshots: {len(have)} known, {len(todo)} to resolve')
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(resolve, fighters[p]['name']): p for p in todo}
        for fut in as_completed(futs):
            p = futs[fut]
            try:
                have[p] = fut.result()
            except Exception:  # noqa
                have[p] = None
            done += 1
            if done % 100 == 0 or done == len(todo):
                print(f'  {done}/{len(todo)}  {time.time()-t0:.0f}s', flush=True)
                json.dump(have, open(PATH, 'w'), separators=(',', ':'))
    json.dump(have, open(PATH, 'w'), separators=(',', ':'))
    print('resolved', sum(1 for v in have.values() if v), 'of', len(have))


if __name__ == '__main__':
    main()
