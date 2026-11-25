"""
wiki.py — dated front-office sentences from executives' Wikipedia articles, as a second source
for hire and departure dates the transaction feeds don't carry.

For each person: one search, one parse (with the revision id, so the link is to the exact
revision read). A sentence counts when it names a team of his, carries a date (day or month),
and has a hiring or leaving verb. The press citation inside the sentence, if any, is kept as
the primary source; the Wikipedia revision is the pointer to it.

    python3 wiki.py               # -> out/wiki_events.json
"""
import json, os, re, urllib.parse
from fetch import get

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
API = 'https://en.wikipedia.org/w/api.php'
MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
DATE = re.compile(rf'(?:({MONTHS}) (\d{{1,2}}), (\d{{4}}))|(?:(\d{{1,2}}) ({MONTHS}) (\d{{4}}))|(?:(?:In|in|On|on|By|by|During|during|of|Early|early|Late|late|mid-) ?({MONTHS}),? (\d{{4}}))')
START = r'\b(hired|named|appointed|promoted|became|joined|took over|was given|signed on as|tabbed|elevated)\b'
END = r'\b(fired|dismissed|relieved|resigned|stepped down|parted ways|left|let go|reassigned|not be retained|was replaced|departed|stepped away)\b'
MN = {m: i + 1 for i, m in enumerate(MONTHS.split('|'))}


def article(name):
    q = urllib.parse.quote(f'"{name}" basketball')
    c, b = get(f'{API}?action=query&list=search&srsearch={q}&srlimit=5&format=json', delay=6)
    if c == 429:
        raise SystemExit('Wikipedia answered 429: stopped, as the ground rules say')
    if c != 200:
        return None
    last = name.split()[-1].lower()
    hits = [h['title'] for h in json.loads(b)['query']['search'] if last in h['title'].lower()]
    if not hits:
        return None
    t = hits[0]
    c, b = get(f'{API}?action=parse&page={urllib.parse.quote(t)}&prop=wikitext|revid&format=json&redirects=1', delay=6)
    if c == 429:
        raise SystemExit('Wikipedia answered 429: stopped, as the ground rules say')
    if c != 200:
        return None
    p = json.loads(b)['parse']
    return {'title': p['title'], 'revid': p.get('revid'), 'text': p['wikitext']['*'],
            'url': f"https://en.wikipedia.org/w/index.php?title={urllib.parse.quote(p['title'].replace(' ', '_'))}&oldid={p.get('revid')}"}


def plain(w):
    refs = []

    def keep(m):
        u = re.search(r'url\s*=\s*([^\s|}]+)', m.group(0))
        refs.append(u.group(1) if u else None)
        return f' \u00a7REF{len(refs) - 1}\u00a7 '
    w = re.sub(r'<ref[^>/]*>.*?</ref>|<ref[^>]*/>', keep, w, flags=re.S)
    w = re.sub(r'\{\{[^{}]*\}\}', '', w)
    w = re.sub(r'\{\{[^{}]*\}\}', '', w)
    w = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', w)
    w = re.sub(r"'{2,}", '', w)
    return w, refs


def date_of(m):
    g = m.groups()
    if g[0]:
        return f'{g[2]}-{MN[g[0]]:02d}-{int(g[1]):02d}', 'day'
    if g[3]:
        return f'{g[5]}-{MN[g[4]]:02d}-{int(g[3]):02d}', 'day'
    return f'{g[7]}-{MN[g[6]]:02d}-01', 'month'


TITLE = r'general manager|president|basketball operations|executive|director of player personnel|head of basketball'


def sentences(a, team_words):
    """A boundary is a date with, close around it (60 characters before, 200 after), a hiring or leaving
    verb, one of his teams' names and a front-office title. Close, so a career paragraph's other
    dates can't borrow a hire sentence (the first version paired Elton Brand's playing days with 2018)."""
    w, refs = plain(a['text'])
    out = []
    for m in DATE.finditer(w):
        lo = max(w.rfind('. ', 0, max(0, m.start() - 60)), w.rfind('\n', 0, m.start()), 0)
        hi = w.find('. ', m.end() + 1)
        hi = len(w) if hi < 0 else min(hi + 1, m.end() + 200)
        win = w[lo:hi]
        if not any(tw in win for tw in team_words) or not re.search(TITLE, win, re.I):
            continue
        kind = 'start' if re.search(START, win) else 'end' if re.search(END, win) else None
        if not kind:
            continue
        d, prec = date_of(m)
        rr = [refs[int(i)] for i in re.findall(r'\u00a7REF(\d+)\u00a7', w[m.start():hi + 80]) if refs[int(i)]]
        clean = re.sub(r'=+[^=]+=+', ' ', re.sub(r'\s*\u00a7REF\d+\u00a7\s*', ' ', win)).strip(' .\n')
        out.append({'date': d, 'precision': prec, 'kind': kind, 'both': bool(re.search(START, win) and re.search(END, win)),
                    'sentence': ' '.join(clean.split())[:300], 'refs': rr[:3], 'wiki': a['url']})
    return out


if __name__ == '__main__':
    import sys
    from tenures import build, TEAMNAME, team_names
    tenures, seg, ts = build()
    team_names()
    names_of = {}
    for nm, yrs in TEAMNAME.items():
        for f in set(yrs.values()):
            if len(nm.split()) > 1:
                names_of.setdefault(f, set()).add(nm.split()[-1].title() if nm.split()[-1] != 'ers' else '76ers')
    names_of.setdefault('PHI', set()).add('76ers')
    names_of.setdefault('POR', set()).update({'Trail Blazers', 'Blazers'})
    need = {}
    for t in tenures:
        if t['start_precision'] != 'day' or t['end_precision'] not in ('day', 'active'):
            need.setdefault(t['person'], set()).add(t['team'])
    res = {}
    for i, (name, teams) in enumerate(sorted(need.items())):
        a = article(name)
        if not a:
            res[name] = None
            continue
        words = set()
        for f in teams:
            words |= names_of.get(f, set())
        res[name] = {'article': a['url'], 'title': a['title'], 'events': sentences(a, words)}
        if i % 20 == 0:
            print(i, len(need), flush=True)
    json.dump(res, open(os.path.join(OUT, 'wiki_events.json'), 'w'), indent=0)
    print('people', len(res), 'with an article', sum(1 for v in res.values() if v), 'dated sentences', sum(len(v['events']) for v in res.values() if v))
