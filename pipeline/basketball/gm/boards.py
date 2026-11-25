"""
boards.py — the board collection: pre-draft big boards (talent rankings), averaged into a consensus rank per draft.

Each source's last capture before draft day, from the Internet Archive (Wayback Machine), politely and cached
(fetch.py). Big boards (talent rankings) first: a mock forecasts who teams will pick, not who is best, so one is used only
where a draft has no second big board.

    NBADraft.net Big Board              nbadraft.net/ranking/bigboard (2005, 2008: its year pages)   2005, 2008-2026
    DraftExpress Top 100 Prospects     draftexpress.com/rankings/Top-100-Prospects (top 25 from 2015)  2010-2017
    ESPN Best Available (Givony, Woo)   espn.com/nba/draft/bestavailable (its top 25 as archived)     2017-2026
    Tankathon Big Board                 tankathon.com/big_board                                      2018-2026
    DraftExpress mock, 2008 only        a mock, used because 2008 has no second big board archived before the draft;
                                        it says team needs are not yet taken into account (May 6, 2008)

Searched and not used: The Ringer's big board (2017-2025: other boards cover those years); NBADraft.net's
2006 and 2007 prospect lists and DraftExpress's 2005-2007 mocks (first archived after those drafts, so they may
show results); DraftExpress's April 2008 "Top 115" article (its capture is another page); ESPN Insider (login); NBA.com's
"Draft Board" pages (2003-2008) and CBS SportsLine's prospect rankings (2004-2008), whose archived pages hold no
names (drawn by Flash or script); SI.com's 2003 mocks (a mock, and only one other source for 2003). So drafts before
2008 keep the slot grade, 2005 included (one board).

Consensus: each board's ranks, matched to the draft's players (Basketball-Reference ids from the draft pages); a
player one board leaves out gets that board's length + 1; the consensus rank orders the mean. Drafts with fewer
than two boards keep the slot grade.

    python3 boards.py          # -> out/boards.json
"""
import collections, gzip, html as H, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, HERE)
from fetch import get  # noqa: E402

DELAY = 5.0
OLD_NBADRAFT = r'profiles/[^"]+">([A-Z][A-Za-z\.\'\-\s]+?)\s\d-\d'
# (name, kind, url by year, years, patterns: the first group is the name (a second, if any, its last half), fewest names)
SOURCES = {
    'NBADraft.net Big Board': ('big board', lambda y: {2005: 'nbadraft.net/2005prospects.asp', 2008: 'nbadraft.net/2008bigboard.asp'}.get(y, 'nbadraft.net/ranking/bigboard'),
                               [2005] + list(range(2008, 2027)),
                               [r"<td style='text-align: center;'>\d+\.</td>.*?<a href=\"/players/[^\"]+\">([^<]+)</a>",
                                r'<a href="https://www\.nbadraft\.net/players/[^"]+/"><span>([^<]+)</span><span>([^<]+)</span></a>', OLD_NBADRAFT], 30),
    'DraftExpress Top 100': ('big board', lambda y: 'draftexpress.com/rankings/Top-100-Prospects', range(2010, 2018),
                             [r'<tr><td>\d+</td><td><a href="/profile/[^"]+">([^<]+)</a>',
                              r'<font size="5">\d+\.</font>.*?<a href="/profile/[^"]+"[^>]*><b>([^<]+)</b>',
                              r'<h2>\s*<span>\d+</span>\s*<div class="arrow"></div>\s*<span>\s*<a href="/profile/[^"]+"[^>]*>\s*([^<]+?)\s*<small>'], 25),   # 2015 on: its top 25 on the first page
    'ESPN Best Available': ('big board', lambda y: 'espn.com/nba/draft/bestavailable', range(2017, 2027),
                            [r'draftTable__headline--pick">\d+</span>.*?draftTable__headline--player">([^<]+)<'], 25),
    'Tankathon Big Board': ('big board', lambda y: 'tankathon.com/big_board', range(2018, 2027),
                            [r'mock-row-pick-number[^>]*>\d+<.*?mock-row-name">([^<]+)<'], 30),
    # a mock only where a draft has no second big board (2008); DraftExpress's says team needs are not yet taken into account
    'DraftExpress mock': ('mock', lambda y: 'draftexpress.com/nba-mock-draft/2008/', [2008],
                          [r'<td>\d+</td><td width="80">.*?<a target="_blank" href="/profile/[^"]+">([^<]+)</a>'], 30),
}


def norm(s):
    s = unicodedata.normalize('NFKD', H.unescape(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z ]', '', s.replace('-', ' ').replace('.', ''))
    return ' '.join(w for w in s.split() if w not in ('jr', 'sr', 'ii', 'iii', 'iv'))


def captures(url):
    c, b = get(f'https://web.archive.org/cdx/search/cdx?url={url}&output=json&filter=statuscode:200&collapse=timestamp:8&limit=5000', delay=DELAY)
    try:
        return json.loads(b)[1:]
    except Exception:
        return []


def page(ts, url):
    c, b = get(f'https://web.archive.org/web/{ts}id_/{url}', delay=DELAY)
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    return c, b.decode('utf8', 'replace')


def board(source, year, draft_day, caps):
    kind, url, years, pats, least = SOURCES[source]
    day = draft_day.replace('-', '')
    pool = [r for r in caps if f'{year}0301' <= r[1][:8] < day]
    for r in reversed(pool[-3:]):                      # the last capture before draft day that parses
        c, t = page(r[1], r[2])
        if c != 200:
            continue
        for pat in pats:
            seen, rows = set(), []
            for m in re.findall(pat, t, re.S):
                n = ' '.join(H.unescape(' '.join(m) if isinstance(m, tuple) else m).split())
                if norm(n) and norm(n) not in seen:
                    seen.add(norm(n))
                    rows.append(n)
            if len(rows) >= least:
                return {'captured': r[1], 'url': f'https://web.archive.org/web/{r[1]}/{r[2]}', 'kind': kind, 'names': rows}
    return None


# a renamed player or a board's nickname: the board's spelling -> the Basketball-Reference name
ALIASES = {'enes kanter': 'enes freedom', 'nahshon hyland': 'bones hyland', 'carlton carrington': 'bub carrington'}


def match(names, picks):
    """Board names -> Basketball-Reference ids of that draft's players: the exact name; else last name and first initial,
    when unique in the draft; else the closest spelling among that draft's players not yet matched (at least 0.8 alike,
    either order of the names, and clearly ahead of the next), or the one whose name begins with the board's. Unmatched names are players who withdrew or went
    undrafted that year."""
    import difflib
    full = {norm(name): br for rnd, ov, team, br, name in picks if br}
    short = collections.defaultdict(list)
    for k, br in full.items():
        w = k.split()
        if w:
            short[(w[-1], w[0][:1])].append(br)
    out, used = [], set()
    for n in names:
        k = norm(n)
        k = ALIASES.get(k, k)
        br = full.get(k)
        if not br and k.split():
            w = k.split()
            c = short.get((w[-1], w[0][:1]), [])
            br = c[0] if len(c) == 1 else None
        out.append(br)
        if br:
            used.add(br)
    for i, n in enumerate(names):
        if out[i]:
            continue
        k = norm(n)
        if not k:
            continue
        sc = sorted(((max(difflib.SequenceMatcher(None, k, f).ratio(), difflib.SequenceMatcher(None, ' '.join(sorted(k.split())), ' '.join(sorted(f.split()))).ratio()), br)
                     for f, br in full.items() if br not in used), reverse=True)
        if sc and sc[0][0] >= 0.8 and (len(sc) == 1 or sc[0][0] - sc[1][0] >= 0.05):
            out[i] = sc[0][1]
            used.add(sc[0][1])
            continue
        pre = [br for f, br in full.items() if br not in used and f.startswith(k + ' ')]     # "Timothe Luwawu" / "-Cabarrot"
        if len(pre) == 1:
            out[i] = pre[0]
            used.add(pre[0])
    return out


def main():
    from ledger import drafts
    D = drafts()
    caps = {}
    out = {}
    for y, d in sorted(D.items()):
        boards = {}
        for s, (kind, url, years, pats, least) in SOURCES.items():
            if y not in years:
                continue
            u = url(y)
            if u not in caps:
                caps[u] = captures(u)
            b = board(s, y, d['date'], caps[u])
            if b:
                b['ids'] = match(b['names'], d['picks'])
                b['matched'] = sum(1 for x in b['ids'] if x)
                boards[s] = b
            print(y, s, 'ok' if b else 'none', (b or {}).get('captured'), (b or {}).get('matched'), flush=True)
        if not boards:
            continue
        # consensus: mean rank over the boards (left out: that board's length + 1), among players drafted that year
        ranks = collections.defaultdict(list)
        for s, b in boards.items():
            pos = {br: i + 1 for i, br in enumerate(b['ids']) if br}
            for br in {x for bb in boards.values() for x in bb['ids'] if x}:
                ranks[br].append(pos.get(br, len(b['ids']) + 1))
        mean = {br: sum(v) / len(v) for br, v in ranks.items()}
        spread = {br: (max(v) - min(v)) for br, v in ranks.items()}
        order = sorted(mean, key=lambda br: (mean[br], br))
        out[str(y)] = {'draft_date': d['date'], 'sources': {s: {k: b[k] for k in ('captured', 'url', 'matched', 'kind')} | {'size': len(b['names'])} for s, b in boards.items()},
                       'n_sources': len(boards), 'consensus': [{'br': br, 'rank': i + 1, 'mean_rank': round(mean[br], 2), 'spread': spread[br],
                                                                'ranks': ranks[br]} for i, br in enumerate(order)]}
    json.dump(out, open(os.path.join(OUT, 'boards.json'), 'w'), indent=0)
    cov = {y: v['n_sources'] for y, v in out.items()}
    print('drafts with two or more boards:', sorted(int(y) for y, n in cov.items() if n >= 2))
    print('with one:', sorted(int(y) for y, n in cov.items() if n == 1))


if __name__ == '__main__':
    main()
