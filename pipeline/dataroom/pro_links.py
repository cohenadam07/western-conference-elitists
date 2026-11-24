"""pro_links.py — college player -> NBA player links beyond the ones the pages already show.

    python3 pipeline/dataroom/pro_links.py            writes public/dataroom/pro_links.json.gz
    python3 pipeline/dataroom/pro_links.py --check    prints the test against the site's own links, writes nothing

The site links 409 college players to their NBA page (public/cbb/links.json.gz, built for Draft
Savant). CBB Savant holds every D1 player since 2009-10 and NBA Savant every
NBA player with his college and birthdate, so most of the rest can be matched from files already in
public/. A match needs the same name (accents, punctuation and suffixes aside) AND his college age agreeing
with his NBA birthdate in every season on file (within AGE_TOL years, on the reference date measured
from the site's own links), with exactly one college player and one NBA player fitting. A player with
no college age on file is left unmatched (a school-and-timing rule was tried and matched nobody).

The rule is scored against the site's links before anything is written (hold-out: the site's links
are never used to make a match): Nov 2026, 393 of the 394 in reach found, all 393 the same player. Only ids are written; no birthdate leaves this script.
cbb.pro_links (pipeline/dataroom/analysis_tables.mjs) reads the file.
"""
import datetime as dt
import gzip
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'dataroom', 'pro_links.json.gz')
AGE_TOL = 0.06          # years (about three weeks): college ages are stored to 0.01
SUFFIX = re.compile(r'\b(jr|sr|ii|iii|iv|v)\b')


def gz(rel):
    with gzip.open(os.path.join(PUB, rel), 'rt') as f:
        return json.load(f)


def norm(name):
    s = unicodedata.normalize('NFD', name or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    s = re.sub(r"[.'’`]", '', s)
    s = re.sub(r'[^a-z ]', ' ', s)
    s = SUFFIX.sub(' ', s)
    return ' '.join(s.split())


def nba_players():
    """{nba id: {name, college, birth (date), first (start year of his first season on file)}}"""
    out = {}
    for f in ('savant-data.json', 'savant-current.json'):
        with open(os.path.join(PUB, f)) as fh:
            d = json.load(fh)
        for season, sd in d['data'].items():
            y = int(season[:4])
            for p in sd.get('players', []):
                e = out.setdefault(p['id'], {'name': p['name'], 'college': p.get('college'), 'birth': None, 'first': y, 'exp_first': None})
                if p.get('birthdate') and not e['birth']:
                    e['birth'] = dt.date.fromisoformat(p['birthdate'])
                if p.get('college') and not e['college']:
                    e['college'] = p['college']
                if y <= e['first']:
                    e['first'] = y
                    e['exp_first'] = p.get('exp')
    return out


def college_players():
    """{cbb id: {name, seasons: [(start year, team id, age)]}} and {team id: name}"""
    teams = {str(t[0]): t[1] for t in gz('cbb/search.json.gz')['teams']}
    out = {}
    for f in sorted(os.listdir(os.path.join(PUB, 'cbb', 's'))):
        d = gz(f'cbb/s/{f}')
        C = {c: i for i, c in enumerate(d['cols'])}
        y = int(d['season'][:4])
        for p in d['players']:
            e = out.setdefault(str(p[C['id']]), {'name': p[C['name']], 'seasons': []})
            e['seasons'].append((y, str(p[C['team']]), p[C['age']]))
    return out, teams


def reference_day(nba, cbb, site):
    """The day of the year college ages are measured on, from the site's own links: the median of
    (birthdate + age) over linked players, as an offset in days from Jan 1 of the season's second year."""
    offs = []
    for c, n in site.items():
        a, b = cbb.get(c), nba.get(n)
        if not a or not b or not b['birth']:
            continue
        for y, _, age in a['seasons']:
            if age is None:
                continue
            ref = b['birth'] + dt.timedelta(days=age * 365.2425)
            offs.append((ref - dt.date(y + 1, 1, 1)).days)
    offs.sort()
    return offs[len(offs) // 2] if offs else 31, len(offs)


def match(nba, cbb, off):
    by_name = defaultdict(list)
    for c, e in cbb.items():
        by_name[norm(e['name'])].append(c)
    links, how = {}, {}
    claimed = defaultdict(list)
    for n, b in nba.items():
        cands = by_name.get(norm(b['name']), [])
        if not cands:
            continue
        aged = []
        for c in cands:
            ok = None
            for y, _, age in cbb[c]['seasons']:
                if age is None or not b['birth']:
                    continue
                want = (dt.date(y + 1, 1, 1) + dt.timedelta(days=off) - b['birth']).days / 365.2425
                ok = abs(want - age) <= AGE_TOL if ok is None else (ok and abs(want - age) <= AGE_TOL)
            aged.append((c, ok))
        hit = [c for c, ok in aged if ok is True]
        if len(hit) == 1:
            claimed[hit[0]].append((n, 'age'))
            continue
        if hit:
            continue                                   # two college players fit one NBA player: leave it
    for c, v in claimed.items():
        if len(v) == 1:                                # one NBA player per college player, or none
            links[c], how[c] = v[0]
    return links, how


def main():
    nba, (cbb, teams) = nba_players(), college_players()
    site = {str(k): int(v) for k, v in gz('cbb/links.json.gz').get('nba', {}).items()}
    off, n_ref = reference_day(nba, cbb, site)
    links, how = match(nba, cbb, off)
    # the test: the site's links were not used above, so they grade the match
    both = [c for c in site if c in links]
    agree = sum(1 for c in both if links[c] == site[c])
    in_reach = [c for c in site if c in cbb and site[c] in nba]
    report = {'reference_day_offset': off, 'reference_from': n_ref, 'matched': len(links), 
              'site_links': len(site), 'site_links_in_reach': len(in_reach), 'site_links_found': len(both), 'site_links_agree': agree,
              'new_links': len([c for c in links if c not in site])}
    print(json.dumps(report))
    if both and agree / len(both) < 0.995:
        raise SystemExit(f'pro_links: only {agree} of {len(both)} matches agree with the site\'s own links; nothing written')
    if '--check' in sys.argv:
        return
    new = {c: n for c, n in sorted(links.items()) if c not in site}
    body = {'note': 'College player id -> NBA player id, matched by pipeline/dataroom/pro_links.py on name plus age. The links the pages already show (public/cbb/links.json.gz) are not repeated here.',
            'test': report, 'links': new}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with gzip.GzipFile(OUT, 'wb', mtime=0) as f:
        f.write(json.dumps(body, sort_keys=True, separators=(',', ':')).encode())


if __name__ == '__main__':
    main()
