#!/usr/bin/env python3
"""Every player's photo for every season he played -> public/football-savant-heads.json.

The page used one photo per player, his newest, on every season: 2016 Antonio Brown in a
Buccaneers jersey. nflverse's season rosters (rosters/roster_<y>.csv) carry a photo per
player per season, but only some of those photos are from that season:

  - 2019 on, each season's roster was saved while it was played. The photo in it is the
    one the NFL shot that year, so it shows that season's uniform.
  - 1999-2018 were filled in afterwards with whatever photo the NFL had at the time. There
    is no Steelers photo of Antonio Brown anywhere in them, and the roster files cannot say
    which team a back-filled photo was taken with (a test pick put 4 of 25 in the wrong
    jersey). Players who retired before about 2010 mostly have no photo at all, only the
    NFL's blank black helmet.

So each player-season gets one of three things (Adam's call, Oct 21, 2026):

  0  that season's own photo (2019 on), shown as it is
  1  the nearest photo of him there is; the page crops it to his face so no jersey shows
     and frames it in that season's team colours
  2  no photo of him at all (only the blank helmet): the page draws a badge in that
     season's team colours instead

Output, run-length by season so a career of back-filled seasons is one entry:
  {"v":1, "live":2019, "p":{"00-0027793":[[2010,"<key>",1],[2019,"<key>",0], ...]}}
A key is the NFL image id; "u/<id>" for the CDN's upload path, a full URL for anything
else. An entry holds until the player's next one.

Blank helmets are found by asking the CDN for each photo's fingerprint (a HEAD request,
no download): every blank helmet is the same picture under its own id. Fingerprints are
kept in heads_etag.json so a re-run only asks about photos it has not seen.

  python3 heads.py                 # every season in the shipped data files
  python3 heads.py --season 2026   # only that season, the rest kept from the last run
"""
import concurrent.futures
import json
import os
import re
import sys
import urllib.request
from collections import Counter

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.environ.get('NFL_RAW', os.path.join(HERE, 'raw'))
PUB = os.path.normpath(os.path.join(HERE, '..', '..', 'public'))
OUT = os.environ.get('NFL_HEADS', os.path.join(PUB, 'football-savant-heads.json'))
CACHE = os.path.join(HERE, 'heads_etag.json')
LIVE = 2019            # first season whose roster file was saved while it was played
BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
CDN = 'https://static.www.nfl.com/image/'
BLANK = {'94129284cf3a'}   # the NFL's blank black helmet, as served at w_60,f_png
URL_RE = re.compile(r'static\.www\.nfl\.com/image/(private|upload)/[^/]*/league/([A-Za-z0-9_-]+)')


def key_of(url):
    """A photo URL -> the short key the page rebuilds it from."""
    if not isinstance(url, str) or not url.strip():
        return None
    m = URL_RE.search(url)
    if not m:
        return url.strip()
    return ('u/' if m.group(1) == 'upload' else '') + m.group(2)


def probe_url(k):
    if k.startswith('http'):
        return None
    up = k.startswith('u/')
    return CDN + ('upload' if up else 'private') + '/w_60,f_png/league/' + (k[2:] if up else k)


def roster(y):
    """{gsis_id: photo key} from that season's roster, the photo he started the season with."""
    p = os.path.join(RAW, 'roster_%d.csv' % y)
    if not os.path.exists(p) or not os.path.getsize(p):
        os.makedirs(RAW, exist_ok=True)
        try:
            urllib.request.urlretrieve('%s/rosters/roster_%d.csv' % (BASE, y), p)
        except Exception as e:                       # a season nflverse hasn't posted yet
            print('  no roster file for %d (%s)' % (y, e))
            return {}
    r = pd.read_csv(p, low_memory=False, usecols=lambda c: c in ('gsis_id', 'headshot_url', 'week'))
    r = r[r.gsis_id.notna() & r.headshot_url.notna()]
    if 'week' in r:
        r = r.sort_values('week', kind='stable')
    r = r.drop_duplicates('gsis_id')
    return {g: key_of(h) for g, h in zip(r.gsis_id, r.headshot_url) if key_of(h)}


def players_csv():
    p = os.path.join(RAW, 'players.csv')
    if not os.path.exists(p) or not os.path.getsize(p):
        os.makedirs(RAW, exist_ok=True)
        urllib.request.urlretrieve(BASE + '/players/players.csv', p)
    pl = pd.read_csv(p, low_memory=False, usecols=['gsis_id', 'headshot'])
    pl = pl[pl.gsis_id.notna()]
    return {g: key_of(h) for g, h in zip(pl.gsis_id, pl.headshot) if key_of(h)}


def player_seasons():
    """{season: {player id, ...}} for every season the page ships: the archive, with the
    season in progress taken from the current file (as the page merges them). The named
    starters of a line picked as a unit are on the All-Savant Team without a row of their
    own, so they come along too."""
    blocks = {}
    for f in ('football-savant-data.json', 'football-savant-current.json'):
        p = os.path.join(PUB, f)
        if os.path.exists(p):
            for s, b in json.load(open(p))['data'].items():
                blocks[s] = b                       # the current file wins its season
    out = {}
    for s, b in blocks.items():
        ids = {p['id'] for p in b.get('players', [])}
        for L in b.get('lines') or []:
            ids.update(f['id'] for f in (L.get('five') or []))
        out[int(s)] = ids
    return out


def fingerprints(keys, cache):
    """CDN fingerprint (ETag) of every photo not seen before. Failures are left out of the
    cache, so the next run asks again; until then the photo counts as a real one."""
    todo = sorted(k for k in keys if k not in cache and probe_url(k))
    if not todo:
        return
    print('  asking the CDN about %d photos' % len(todo))

    def head(k):
        for _ in range(3):
            try:
                req = urllib.request.Request(probe_url(k), method='HEAD')
                with urllib.request.urlopen(req, timeout=20) as r:
                    return k, (r.headers.get('ETag') or '').strip('"')[:12]
            except Exception:
                continue
        return k, None
    with concurrent.futures.ThreadPoolExecutor(24) as ex:
        for i, (k, et) in enumerate(ex.map(head, todo), 1):
            if et:
                cache[k] = et
            if i % 2000 == 0:
                print('    %d / %d' % (i, len(todo)))


def main():
    only = None
    if len(sys.argv) > 2 and sys.argv[1] == '--season':
        only = int(sys.argv[2])
    ps = player_seasons()
    seasons = sorted(ps) if only is None else [only]
    if only is not None and only not in ps:
        print('heads: no season %d in the data files, nothing to do' % only)
        return
    newest = max(ps)
    print('== rosters %d-%d' % (seasons[0], seasons[-1]) if only is None else '== roster %d' % only)
    R = {y: roster(y) for y in (range(1999, newest + 1) if only is None else [only])}
    PL = players_csv()

    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    want = set(PL.get(g) for y in seasons for g in ps[y] if PL.get(g))
    for y in R:
        want.update(k for g, k in R[y].items() if any(g in ps.get(z, ()) for z in seasons))
    fingerprints(want, cache)
    # Anything shared by many different photo ids is a placeholder, whatever it looks like.
    shared = Counter(cache.values())
    blank = BLANK | {et for et, n in shared.items() if n >= 5}

    def real(k):
        return bool(k) and cache.get(k) not in blank

    def pick(g, y):
        own = R.get(y, {}).get(g)
        if y >= LIVE and real(own):
            return own, 0
        if real(own):
            return own, 1
        for d in range(1, 30):
            for z in (y + d, y - d):
                k = R.get(z, {}).get(g)
                if real(k):
                    return k, 1
        k = PL.get(g)
        if real(k):
            # the season being played: his newest photo is this season's
            return k, (0 if (y == newest and y >= LIVE) else 1)
        return '', 2

    per = {}                                   # {player: {season: (key, flag)}}
    if only is not None and os.path.exists(OUT):
        for g, L in json.load(open(OUT))['p'].items():
            # unpack the runs back onto the seasons he has, so one season can be replaced
            have = sorted(z for z in ps if g in ps[z])
            d = per.setdefault(g, {})
            for z in have:
                cur = None
                for e in L:
                    if e[0] <= z:
                        cur = e
                if cur:
                    d[z] = (cur[1], cur[2])
        for g in per:
            per[g].pop(only, None)
    for y in seasons:
        for g in ps[y]:
            per.setdefault(g, {})[y] = pick(g, y)

    out = {}
    for g in sorted(per):
        runs, last = [], None
        for y in sorted(per[g]):
            v = per[g][y]
            if v != last:
                runs.append([y, v[0], v[1]])
                last = v
        if runs:
            out[g] = runs
    body = {'v': 1, 'live': LIVE, 'p': out}
    txt = json.dumps(body, separators=(',', ':'))
    old = open(OUT).read() if os.path.exists(OUT) else None
    if txt != old:
        with open(OUT, 'w') as f:
            f.write(txt)
    with open(CACHE, 'w') as f:
        json.dump(dict(sorted(cache.items())), f, separators=(',', ':'))

    tally = Counter(v[1] for g in per for y, v in per[g].items() if y in seasons)
    n = sum(tally.values()) or 1
    print('heads: %d player-seasons · own season photo %d%% · face from another season %d%% · no photo %d%% · %d KB%s'
          % (n, 100 * tally[0] / n, 100 * tally[1] / n, 100 * tally[2] / n, len(txt) // 1024,
             '' if txt != old else ' (unchanged)'))


if __name__ == '__main__':
    main()
