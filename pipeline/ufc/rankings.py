#!/usr/bin/env python3
"""
Official UFC rankings for UFC Savant, via octagon-api.com (a free JSON mirror of the
UFC.com rankings page). Writes raw/rankings.json:

  {"fetched": "...", "lists": {"LW": {"champion": "Islam Makhachev", "ranked": [...15 names]},
                               "P4P_M": {...}, "P4P_F": {...}, ...}}

Names, not ids — build.py matches them to ufcstats fighters by normalised name inside the
division. The endpoint is a hobby mirror; if it is down the previous file is kept.
"""
import json, os, sys, unicodedata
from datetime import datetime

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'raw', 'rankings.json')

CATS = {
    "Men's Pound-for-Pound Top Rank": 'P4P_M', "Women's Pound-for-Pound Top Rank": 'P4P_F',
    'Flyweight': 'FLW', 'Bantamweight': 'BW', 'Featherweight': 'FW', 'Lightweight': 'LW',
    'Welterweight': 'WW', 'Middleweight': 'MW', 'Light Heavyweight': 'LHW', 'Heavyweight': 'HW',
    "Women's Strawweight": 'WSW', "Women's Flyweight": 'WFLW', "Women's Bantamweight": 'WBW',
    "Women's Featherweight": 'WFW',
}


def main():
    try:
        r = requests.get('https://api.octagon-api.com/rankings', timeout=30,
                         headers={'User-Agent': 'wcehoops-ufc-savant'})
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa
        print('rankings: fetch failed, keeping previous file:', e)
        return
    lists = {}
    for cat in data:
        key = CATS.get(cat.get('categoryName'))
        if not key:
            continue
        champ = (cat.get('champion') or {}).get('championName')
        ranked = [f['name'] for f in cat.get('fighters', [])]
        if key.startswith('P4P'):
            champ = None
        lists[key] = {'champion': champ, 'ranked': ranked}
    if len(lists) < 8:
        print('rankings: response looked incomplete, keeping previous file')
        return
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    json.dump({'fetched': datetime.utcnow().strftime('%Y-%m-%d'), 'lists': lists},
              open(PATH, 'w'), indent=0, ensure_ascii=False)
    print('rankings:', ', '.join(f'{k} {len(v["ranked"])}' for k, v in lists.items()))


if __name__ == '__main__':
    main()
