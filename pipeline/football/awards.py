"""Career awards for Football Savant.

Two sources, because no single one covers the ground:

  * nflverse's `draft_picks` release carries PFR's career counts — Pro Bowls, first-team
    All-Pros, Hall of Fame — keyed by the same gsis_id the rest of this pipeline uses.
    It only covers drafted players, and its counts are whole-career, so a man who played
    before 1999 carries seasons this dataset never saw. Both facts are recorded in the
    output rather than papered over.

  * Wikipedia's award lists for the individual honours PFR does not publish in a machine
    -readable form: MVP, Offensive and Defensive Player of the Year, and the two Rookie
    of the Year awards. These resolve by name inside the winning season, which is exact:
    two men with the same name in the same season at the same position does not happen.

Pro Football Reference is the obvious third source and is deliberately not used — it
returns 403 to automated requests, and working around that is not something this pipeline
will do.

Writes agg/awards.json:  {gsis_id: {probowl, allpro, hof, mvp, opoy, dpoy, oroy, droy,
                                    years:{award:[season,...]}, pbScope}}
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

import pandas as pd

AGG = os.environ.get('NFL_AGG', 'agg')
DATA = os.environ.get('NFL_DATA', '../../public/football-savant-data.json')
OUT = os.path.join(AGG, 'awards.json')
UA = 'FootballSavant/1.0 (+https://wcehoops.com) python-urllib'
DRAFT = 'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv'

# award key -> (wikipedia page, which table on that page)
WIKI = {
    'mvp':  ('AP NFL Most Valuable Player', 0),
    'opoy': ('AP NFL Offensive Player of the Year', 0),
    'dpoy': ('AP NFL Defensive Player of the Year', 0),
    'oroy': ('AP NFL Rookie of the Year', 0),
    'droy': ('AP NFL Rookie of the Year', 1),
}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def cell_text(el):
    t = el.get_text(' ')
    t = re.sub(r'\[[^\]]*\]', '', t)          # footnote markers
    return re.sub(r'\s+', ' ', t).strip()


def wiki_tables(title):
    u = ('https://en.wikipedia.org/w/api.php?action=parse&page='
         + urllib.parse.quote(title) + '&prop=text&formatversion=2&format=json')
    j = json.loads(get(u).decode('utf-8'))
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(j['parse']['text'], 'lxml')
    out = []
    for tab in soup.select('table.wikitable'):
        rows = tab.select('tr')
        if len(rows) < 16:
            continue
        head = [cell_text(c) for c in rows[0].select('th,td')]
        body = []
        for r in rows[1:]:
            cells = r.select('th,td')
            body.append({
                'text': [cell_text(c) for c in cells],
                # names come from the links, so a co-winner cell yields two names
                # rather than one run-together string
                'links': [[a.get_text(' ').strip() for a in c.select('a')
                           if a.get('title') and ':' not in a.get('title')]
                          for c in cells],
            })
        out.append((head, body))
    return out


# what a Wikipedia position word means in this pipeline's cohorts
WPOS = {
    'quarterback': {'QB'}, 'running back': {'RB'}, 'halfback': {'RB'}, 'fullback': {'RB'},
    'wide receiver': {'WR'}, 'tight end': {'TE'},
    'offensive tackle': {'OL'}, 'tackle': {'OL', 'DI', 'ED'}, 'guard': {'OL'}, 'center': {'OL'},
    'defensive end': {'ED'}, 'defensive tackle': {'DI'}, 'nose tackle': {'DI'},
    'defensive lineman': {'ED', 'DI'}, 'edge': {'ED'},
    'linebacker': {'LB', 'ED'}, 'outside linebacker': {'LB', 'ED'},
    'inside linebacker': {'LB'}, 'middle linebacker': {'LB'},
    'cornerback': {'CB'}, 'defensive back': {'CB', 'S'},
    'safety': {'S'}, 'free safety': {'S'}, 'strong safety': {'S'},
    'placekicker': {'K'}, 'kicker': {'K'}, 'punter': {'P'},
    'return specialist': None, 'kick returner': None,
}


def pos_set(word):
    w = (word or '').strip().lower()
    if w in WPOS:
        return WPOS[w]
    for k, v in WPOS.items():
        if k in w:
            return v
    return None


def award_winners(title, idx):
    """[(season, name, position word, team word), ...] for one award table."""
    tabs = wiki_tables(title)
    if idx >= len(tabs):
        raise RuntimeError('table %d missing on %r (found %d)' % (idx, title, len(tabs)))
    head, body = tabs[idx]
    try:
        si = next(i for i, h in enumerate(head) if h.lower() in ('season', 'year'))
    except StopIteration:
        si = 0
    out = []
    for row in body:
        cells, links = row['text'], row['links']
        if len(cells) < 2:
            continue
        m = re.match(r'\s*(\d{4})', cells[si] if si < len(cells) else '')
        if not m:
            continue
        season = m.group(1)
        # the first cell after the season that links to people is the winner (or winners)
        names, ci = [], None
        for i in range(si + 1, len(cells)):
            cand = [n for n in links[i] if len(n.split()) >= 2 and not TEAMWORD.search(n)]
            if cand:
                names, ci = cand, i
                break
        if not names:
            continue
        rest = cells[ci + 1:] if ci is not None else []
        pw = rest[0] if rest else ''
        tw = rest[1] if len(rest) > 1 else (rest[0] if rest else '')
        for n in names:
            out.append((season, re.sub(r'\s*\(\d+\)\s*$', '', n).strip(), pw, tw))
    return out


TEAMWORD = re.compile(
    r'\b(Bills|Dolphins|Patriots|Jets|Ravens|Bengals|Browns|Steelers|Texans|Colts|Jaguars|'
    r'Titans|Broncos|Chiefs|Raiders|Chargers|Cowboys|Giants|Eagles|Commanders|Redskins|'
    r'Football Team|Bears|Lions|Packers|Vikings|Falcons|Panthers|Saints|Buccaneers|'
    r'Cardinals|Rams|49ers|Seahawks|Oilers)\b')


def norm(s):
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', (s or '').lower())
    return re.sub(r"[^a-z]", '', s)


def loose(s):
    """last name plus first initial — enough to bridge Pat and Patrick Surtain."""
    parts = [p for p in re.split(r'\s+', re.sub(r'\b(Jr|Sr|II|III|IV|V)\b\.?', '', s or '')) if p]
    if len(parts) < 2:
        return None
    return re.sub(r'[^a-z]', '', parts[-1].lower()) + '|' + parts[0][:1].lower()


def main():
    if not os.path.exists(DATA):
        sys.exit('no dataset at %s — run build.py first' % DATA)
    with open(DATA) as f:
        data = json.load(f)

    # name -> ids, per season, for resolving award winners; plus a loose index and the
    # team-name lookup, both of which are needed to separate two men with one name
    exact, loosed, rows = {}, {}, {}
    for s_ in data['seasons']:
        e, l, rw = defaultdict(list), defaultdict(list), {}
        for p in data['data'][s_]['players']:
            e[norm(p['name'])].append(p['id'])
            k = loose(p['name'])
            if k:
                l[k].append(p['id'])
            rw[p['id']] = p
        exact[s_], loosed[s_], rows[s_] = e, l, rw
    teamname = {}
    for ab, v in data['cfg']['teams'].items():
        teamname[re.sub(r'[^a-z]', '', v[0].lower())] = ab

    def resolve(season, name, pword, tword):
        ids = list(exact[season].get(norm(name), []))
        if not ids:
            k = loose(name)
            ids = list(loosed[season].get(k, [])) if k else []
        if len(ids) > 1:
            want = pos_set(pword)
            if want:
                nar = [i for i in ids if rows[season][i]['pos'] in want]
                if nar:
                    ids = nar
        if len(ids) > 1 and tword:
            tw = re.sub(r'[^a-z]', '', tword.lower())
            ab = next((a for n, a in teamname.items() if n and (n in tw or tw in n)), None)
            if ab:
                nar = [i for i in ids if rows[season][i].get('team') == ab]
                if nar:
                    ids = nar
        if len(ids) > 1:
            # last resort: the one who actually played the season
            ids.sort(key=lambda i: -(rows[season][i].get('d', {}).get('g') or 0))
            ids = ids[:1]
        return ids[0] if len(ids) == 1 else None

    aw = defaultdict(lambda: {'years': {}})

    # ---- nflverse draft picks: career Pro Bowl / All-Pro / Hall of Fame
    print('draft_picks \u2026', flush=True)
    dp = pd.read_csv(io.BytesIO(get(DRAFT)), low_memory=False)
    dp = dp[dp.gsis_id.notna()]
    for r in dp.itertuples(index=False):
        e = aw[str(r.gsis_id)]
        for src, key in (('probowls', 'probowl'), ('allpro', 'allpro')):
            v = getattr(r, src, None)
            try:
                v = int(v)
            except (TypeError, ValueError):
                v = 0
            if v > 0:
                e[key] = v
        if getattr(r, 'hof', False) is True or str(getattr(r, 'hof', '')).lower() == 'true':
            e['hof'] = True
        e['pbScope'] = 'career'          # PFR counts the whole career, 1999 cutoff and all
    print('  %d drafted players carried counts' % sum(
        1 for v in aw.values() if v.get('probowl') or v.get('allpro') or v.get('hof')))

    # ---- Wikipedia: the individual honours
    missed = []
    for key, (title, idx) in WIKI.items():
        hit = 0
        for season, name, pword, tword in award_winners(title, idx):
            if season not in exact:
                continue                  # outside the dataset's span
            pid = resolve(season, name, pword, tword)
            if not pid:
                missed.append((key, season, name))
                continue
            e = aw[pid]
            e[key] = e.get(key, 0) + 1
            e['years'].setdefault(key, []).append(season)
            hit += 1
        print('%-5s %-42s %3d resolved' % (key, title, hit), flush=True)
        time.sleep(1)                     # be a good citizen

    if missed:
        print('\nunresolved (%d):' % len(missed))
        for m in missed:
            print('   %-5s %s %s' % m)

    out = {k: v for k, v in aw.items() if any(
        v.get(x) for x in ('probowl', 'allpro', 'hof', 'mvp', 'opoy', 'dpoy', 'oroy', 'droy'))}
    for v in out.values():
        if not v['years']:
            v.pop('years')
    os.makedirs(AGG, exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'), sort_keys=True)
    print('\nwrote %s — %d players' % (OUT, len(out)))


if __name__ == '__main__':
    main()
