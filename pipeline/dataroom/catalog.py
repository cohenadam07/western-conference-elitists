"""The Data Room catalog: every table of every sport, with its seasons, row counts and dates.

    python3 pipeline/dataroom/catalog.py                 rescan everything there is locally
    python3 pipeline/dataroom/catalog.py nfl             rescan one sport (a refresh does this)

Writes public/dataroom/catalog.json, which savant_dictionary returns with no inputs and
savant_data reads to know which seasons exist and where each file lives.

A hosted table (a GitHub release asset) only has the seasons a run built on its own disk, so a
rescan keeps the catalog's existing entry for any season it cannot see: a refresh of 2026
updates 2026 and leaves 1999-2025 as they were.

The six tables that were in the connector before the shared tool (Basketball Coaching Savant's,
College Basketball Savant's and College Basketball Coaching Savant's) are counted from their own
site files, so the catalog speaks for every table savant_data can reach.
"""
import gzip
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUB = os.environ.get('DATAROOM_PUBLIC', os.path.join(ROOT, 'public', 'dataroom'))
HOSTED = os.environ.get('DATAROOM_HOSTED', os.path.join(ROOT, 'out', 'dataroom'))
SITE = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'catalog.json.gz')
ASSETS = 'https://github.com/cohenadam07/western-conference-elitists/releases/download/dataroom'

LEGACY = {
    'nba': [('coaching_games', 'bcs', 'games', 'team-game (coaching context)'), ('coaching_stints', 'bcs', 'stints', 'player stint'),
            ('coaching_units', 'bcs', 'units', 'five-man unit, team-season'), ('coaching_rotation', 'bcs', 'rotation', 'player-game (rotation)'),
            ('coaching_decisions', 'bcs', 'decisions', 'coaching decision')],
    'cbb': [('games', 'cbb', 'games', 'game'), ('player_games', 'cbb', 'player_games', 'player-game (per team)'),
            ('units', 'cbb', 'units', 'five-man unit, team-season (per team)'), ('possessions', 'cbb', 'possessions', 'possession (per team)'),
            ('coaching_games', 'cbcs', 'games', 'team-game (coaching context)'), ('coaching_stints', 'cbcs', 'stints', 'player stint'),
            ('coaching_units', 'cbcs', 'units', 'five-man unit'), ('coaching_rotation', 'cbcs', 'rotation', 'player-game (rotation)'),
            ('coaching_decisions', 'cbcs', 'decisions', 'coaching decision'), ('coaching_roster_moves', 'cbcs', 'roster_moves', 'roster move'),
            ('coaching_programs', 'cbcs', 'programs', 'program (every season in one table)')],
}
PAGES = {'nba': '/basketball-savant.html', 'nfl': '/football-savant.html', 'cfb': '/college-football-savant.html',
         'ufc': '/ufc-savant.html', 'cbb': '/college-basketball-savant.html'}
LEGACY_PAGES = {'bcs': '/basketball-coaching-savant.html', 'cbb': '/college-basketball-savant.html', 'cbcs': '/college-basketball-coaching-savant.html'}


def _load(p):
    if os.path.exists(p + '.gz'):
        p = p + '.gz'
    if not os.path.exists(p):
        return None
    with (gzip.open(p, 'rt') if p.endswith('.gz') else open(p)) as f:
        return json.load(f)


def _newest(doc):
    if doc.get('through'):
        return str(doc['through'])[:10]
    cols = doc.get('columns') or doc.get('cols') or []
    if 'date' not in cols:
        return None
    i = cols.index('date')
    best = None
    for r in doc.get('rows') or []:
        if r[i] and (best is None or str(r[i]) > best):
            best = str(r[i])
    return best[:10] if best else None


def scan_new(sport, table, spec, prev):
    base = PUB if spec['hosting'] == 'public' else HOSTED
    d = os.path.join(base, sport, table)
    seasons = dict((prev or {}).get('seasons') or {})
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if not fn.endswith('.json.gz'):
                continue
            p = os.path.join(d, fn)
            with open(p, 'rb') as f:
                raw = f.read()
            doc = json.loads(gzip.decompress(raw))
            seasons[doc['season']] = {'rows': len(doc['rows']), 'through': doc.get('through'), 'bytes': len(raw),
                                      'sha256': hashlib.sha256(raw).hexdigest()}
    return seasons


def scan_legacy(src, t, current=None):
    seasons = {}
    if src in ('bcs', 'cbcs'):
        if t == 'programs':
            doc = _load(os.path.join(SITE, 'cbcs', 'data', 'programs.json'))
            if doc:
                seasons['all'] = {'rows': len(doc['rows']), 'through': None}
            return seasons
        d = os.path.join(SITE, src, 'data', t)
        for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            s = fn.split('.')[0]
            if current and s != current:
                continue
            doc = _load(os.path.join(d, s + '.json'))
            if doc:
                seasons[s] = {'rows': len(doc['rows']), 'through': _newest(doc)}
        return seasons
    # College Basketball Savant: games by season; the rest per team-season, counted from the team files
    idx = _load(os.path.join(SITE, 'cbb', 'index.json')) or {}
    for row in idx.get('seasons', []):
        s = row['season']
        if current and s != current:
            continue
        if t == 'games':
            doc = _load(os.path.join(SITE, 'cbb', 'games', f'{s}.json'))
            if doc:
                seasons[s] = {'rows': len(doc['rows']), 'through': _newest(doc) or row.get('through')}
            continue
        d = os.path.join(SITE, 'cbb', 'pos' if t == 'possessions' else 't', s)
        if not os.path.isdir(d):
            continue
        n = 0
        for fn in os.listdir(d):
            if not fn.endswith('.json.gz') or fn.startswith('league'):
                continue
            doc = _load(os.path.join(d, fn[:-3]))
            if not doc:
                continue
            if t == 'player_games':
                n += sum(len(v) for v in (doc.get('log') or {}).values())
            elif t == 'units':
                n += len(doc.get('fives') or [])
            else:
                n += len(doc.get('rows') or [])
        if n:
            seasons[s] = {'rows': n, 'through': row.get('through')}
    return seasons


def build(only=None, current=None):
    D = _load(os.path.join(PUB, 'dictionary.json'))
    prev = _load(OUT[:-3]) or {}
    out = {'schema': 1, 'assets': ASSETS, 'sports': {}}
    for sport in ('nba', 'nfl', 'cfb', 'cbb', 'ufc'):
        old = (prev.get('sports') or {}).get(sport) or {}
        if only and sport not in only:
            if old:
                out['sports'][sport] = old
            continue
        tables = {}
        for t, spec in (D['sports'].get(sport) or {}).items():
            seasons = scan_new(sport, t, spec, old.get(t))
            tables[t] = {'row': spec['row'], 'first_season': spec['first'], 'hosting': spec['hosting'], 'page': PAGES[sport],
                         'note': spec['note'], 'seasons': dict(sorted(seasons.items()))}
        for t, src, inner, row in LEGACY.get(sport, []):
            # a refresh rescans only the season it rebuilt (--current); the rest stand as they were
            seasons = dict((old.get(t) or {}).get('seasons') or {}) if current else {}
            seasons.update(scan_legacy(src, inner, current))
            tables[t] = {'row': row, 'first_season': min(seasons) if seasons else None, 'hosting': 'site', 'source': src,
                         'page': LEGACY_PAGES[src], 'seasons': dict(sorted(seasons.items()))}
        out['sports'][sport] = tables
    sys.path.insert(0, HERE)
    from common import dumps, gz_bytes
    with open(OUT, 'wb') as f:
        f.write(gz_bytes(dumps(out)))
    return out


if __name__ == '__main__':
    a = sys.argv[1:]
    cur = a[a.index('--current') + 1] if '--current' in a else None
    # --forget sport/table/season: drop a hosted season the catalog remembers but no asset holds
    forget = [a[i + 1] for i, x in enumerate(a) if x == '--forget']
    d = build(set(x for x in a if not x.startswith('--') and x not in (cur, *forget)) or None, cur)
    if forget:
        from common import dumps, gz_bytes
        for f in forget:
            sp, t, se = f.split('/')
            d['sports'][sp][t]['seasons'].pop(se, None)
        with open(OUT, 'wb') as fh:
            fh.write(gz_bytes(dumps(d)))
        print('forgot', ', '.join(forget))
    for sport, tables in d['sports'].items():
        for t, v in tables.items():
            ss = v['seasons']
            print(f"{sport:4} {t:22} {len(ss):3} seasons {min(ss) if ss else '-'}..{max(ss) if ss else '-'} rows {sum(x['rows'] for x in ss.values()):>10,}")
    print(f'catalog: {os.path.getsize(OUT)/1e3:.0f} KB')
