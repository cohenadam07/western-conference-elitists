#!/usr/bin/env python3
"""
Official UFC rankings for UFC Savant, read from Wikipedia's "UFC rankings" page.

Why Wikipedia: UFC.com blocks non-browser fetches, and the two free JSON mirrors we tried
(octagon-api.com, ESPN's rankings feed) were months to years stale on Sep 9, 2026.
Wikipedia's page is maintained within days of each card and states its own release date
("Rankings released on September 5, 2026, after UFC Fight Night: ..."), which we keep.

Writes raw/rankings.json:
  {"fetched": "...", "released": "2026-09-05",
   "lists": {"LW": {"champion": "Justin Gaethje", "interim": null, "ranked": [...15 names]},
             "P4P_M": {"champion": null, "ranked": [...]}, ...}}

Names, not ids — build.py matches them to ufcstats fighters. If the fetch or parse fails,
the previous file is kept.
"""
import json, os, re
from datetime import datetime

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'raw', 'rankings.json')
URL = 'https://en.wikipedia.org/w/api.php?action=parse&page=UFC_rankings&prop=wikitext&format=json&formatversion=2'

SECTIONS = {
    "men's pound-for-pound": 'P4P_M', "women's pound-for-pound": 'P4P_F',
    'flyweight': 'FLW', 'bantamweight': 'BW', 'featherweight': 'FW', 'lightweight': 'LW',
    'welterweight': 'WW', 'middleweight': 'MW', 'light heavyweight': 'LHW', 'heavyweight': 'HW',
    "women's strawweight": 'WSW', "women's flyweight": 'WFLW', "women's bantamweight": 'WBW',
    "women's featherweight": 'WFW',
}


def clean_name(s):
    s = re.sub(r'\[\[([^\]|]*)\|([^\]]*)\]\]', r'\2', s)     # [[Article|Shown]] -> Shown
    s = re.sub(r'\[\[([^\]]*)\]\]', r'\1', s)                 # [[Name]] -> Name
    s = re.sub(r'\{\{[^}]*\}\}', '', s)                       # templates
    s = re.sub(r'<[^>]+>', '', s)
    return s.replace("'''", '').strip()


def parse(wikitext):
    lists = {}
    released = None
    m = re.search(r'Rankings released on ([A-Z][a-z]+ \d{1,2}, \d{4})', wikitext)
    if m:
        try:
            released = datetime.strptime(m.group(1), '%B %d, %Y').strftime('%Y-%m-%d')
        except ValueError:
            pass
    parts = re.split(r'^===?\s*(.+?)\s*===?\s*$', wikitext, flags=re.M)
    # parts: [pre, title, body, title, body, ...]
    for i in range(1, len(parts) - 1, 2):
        title = clean_name(parts[i]).lower().replace('–', '-')
        key = None
        for name, k in SECTIONS.items():
            if title == name or title.startswith(name + ' ') or title == name + ' rankings':
                key = k
        if not key:
            continue
        body = parts[i + 1]
        tbl = body.find('{|')
        if tbl < 0:
            continue
        body = body[tbl:body.find('|}', tbl)]
        champion, interim, ranked = None, None, []
        for row in body.split('|-'):
            m = re.search(r'^\s*!\s*(?:style="[^"]*"\s*\|\s*)?(\{\{Tooltip\|(C|IC)\|[^}]*\}\}|\d+)\s*$', row, flags=re.M)
            if not m:
                continue
            # the name is the first cell after the flag cell; linked or plain text
            name = None
            for line in row.splitlines():
                line = line.strip()
                if line.startswith('|') and 'flagicon' not in line and not line.startswith('|}'):
                    name = clean_name(line.lstrip('|').strip())
                    break
            if not name:
                continue
            tag = m.group(2) or m.group(1)
            if tag == 'C':
                champion = name
            elif tag == 'IC':
                interim = name
            else:
                ranked.append((int(tag), name))
        ranked.sort()
        lists[key] = {'champion': champion, 'interim': interim, 'ranked': [n for _, n in ranked]}
    return released, lists


def main():
    try:
        import time
        for attempt in range(4):
            r = requests.get(URL, timeout=30, headers={'User-Agent': 'wcehoops-ufc-savant/1.0 (https://wcehoops.com)'})
            if r.status_code == 429 and attempt < 3:
                time.sleep(20 * (attempt + 1)); continue
            break
        r.raise_for_status()
        released, lists = parse(r.json()['parse']['wikitext'])
    except Exception as e:  # noqa
        print('rankings: fetch/parse failed, keeping previous file:', e)
        return
    ok = [k for k, v in lists.items() if len(v['ranked']) >= 10]
    if len(ok) < 10:
        print('rankings: parse looked incomplete, keeping previous file:', {k: len(v['ranked']) for k, v in lists.items()})
        return
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    json.dump({'fetched': datetime.utcnow().strftime('%Y-%m-%d'), 'released': released, 'lists': lists},
              open(PATH, 'w'), indent=0, ensure_ascii=False)
    print('rankings released', released, '·', ', '.join(f'{k} {("C:" + v["champion"]) if v["champion"] else "vacant"} +{len(v["ranked"])}' for k, v in lists.items()))


if __name__ == '__main__':
    main()
