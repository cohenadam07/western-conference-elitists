"""
luck.py — team margins with opponent shooting luck taken out, the Nov 19 defense test's adjustment at season level:
opponent 3PM is replaced by opponent 3PA x league 3P%, and opponent FTM by opponent FTA x league FT%.

    adjusted margin per game = margin + [3 (opp 3PM - opp 3PA x lg 3P%) + (opp FTM - opp FTA x lg FT%)] / games

Source: Basketball-Reference league season pages (the "Opponent Stats" totals table), one page a season.

    python3 luck.py      # -> out/luck_margins.json  {season: {franchise: {g, margin, adj_margin, luck}}}
"""
import json, os, re
from fetch import get
from tenures import franchise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
FIRST, LAST = 1980, 2027
# How much of the luck term GM Savant counts (Nov 2026, luck_study.py, out of sample): a team's second half is best
# predicted keeping about 30% of it (the rest of its opponents' shooting away from the league average persists, more
# like defense than luck); next season prefers about half, the playoffs none. GM Savant's production and the title
# model's regular season use margin + LUCK_SHARE x luck; the playoffs use the raw margin. The luck term itself, stored
# below, is the full one: nothing else reads it this way.
LUCK_SHARE = 0.3


def table(html, tid):
    m = re.search(r'<table[^>]*id="%s".*?</table>' % tid, html, re.S)
    if not m:  # BR ships secondary tables inside comments
        for c in re.findall(r'<!--(.*?)-->', html, re.S):
            m = re.search(r'<table[^>]*id="%s".*?</table>' % tid, c, re.S)
            if m:
                break
    if not m:
        return []
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(0), re.S):
        cells = dict(re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', tr, re.S))
        ab = re.search(r'/teams/([A-Z]{3})/', tr)
        if ab and cells.get('g'):
            cells['ab'] = ab.group(1)
            rows.append(cells)
    return rows


def num(x):
    x = re.sub(r'<[^>]+>', '', x or '').strip()
    return float(x) if x else 0.0


def main():
    R = json.load(open(os.path.join(OUT, 'results.json')))
    # results.json is keyed by the NBA's abbreviations (PHX, BKN, and PHL, SAN, UTH, GOS, WSB in the 1980s and 90s),
    # this page by Basketball-Reference's: both go through the franchise (looking BR's up in the NBA's file left
    # Phoenix, Brooklyn from 2012-13 and five teams before 1996-97 without a margin; the luck term was always right)
    RF = {s: {('CHO' if ab == 'CHA' and int(s[:4]) + 1 >= 2005 else franchise(ab)): g for ab, g in teams.items()} for s, teams in R.items()}
    out = {}
    for y in range(FIRST, LAST + 1):
        url = f'https://www.basketball-reference.com/leagues/NBA_{y}.html'
        code, html = get(url, delay=4.0)
        html = html.decode("utf8", "ignore") if isinstance(html, bytes) else html
        if code != 200:
            print('stop:', y, code)
            break
        rows = table(html, 'totals-opponent')
        if not rows:
            print('no opponent table', y)
            continue
        p3 = sum(num(r['opp_fg3']) for r in rows) / max(1.0, sum(num(r['opp_fg3a']) for r in rows))
        pft = sum(num(r['opp_ft']) for r in rows) / max(1.0, sum(num(r['opp_fta']) for r in rows))
        season = f'{y - 1}-{str(y)[2:]}'
        res = R.get(season, {})
        out[season] = {'league_3p': round(p3, 4), 'league_ft': round(pft, 4), 'source': url, 'teams': {}}
        for r in rows:
            g = num(r['g'])
            luck = (3 * (num(r['opp_fg3']) - num(r['opp_fg3a']) * p3) + (num(r['opp_ft']) - num(r['opp_fta']) * pft)) / g
            ab = r['ab']
            f = 'CHO' if ab in ('CHA', 'CHO') and y >= 2005 else franchise(ab)
            games = RF.get(season, {}).get(f) or []
            margin = sum(x[2] for x in games) / len(games) if games else None
            out[season]['teams'][f] = {'g': g, 'luck': round(luck, 3), 'margin': None if margin is None else round(margin, 3),
                                       'adj_margin': None if margin is None else round(margin + luck, 3)}
        print(season, f'lg 3P {p3:.3f} FT {pft:.3f}', len(rows), flush=True)
    json.dump(out, open(os.path.join(OUT, 'luck_margins.json'), 'w'), indent=0)


if __name__ == '__main__':
    main()
