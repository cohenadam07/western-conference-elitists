"""
br_tx.py — Basketball-Reference's season transaction pages, 1979-80 to the season in progress.
Fetched once into the cache; parsed into dated paragraphs with the team links kept.

    python3 br_tx.py fetch | parse        # -> out/br_tx.json
"""
import datetime, html as H, json, os, re, sys
from fetch import get

OUT = os.path.join(os.path.dirname(__file__), 'out')
FIRST, LAST = 1980, 2027


def url(y):
    return f'https://www.basketball-reference.com/leagues/NBA_{y}_transactions.html'


def iso(d):
    for f in ('%B %d, %Y',):
        try:
            return datetime.datetime.strptime(d, f).date().isoformat(), False
        except ValueError:
            pass
    m = re.match(r'([A-Z][a-z]+) \?, (\d{4})', d)          # "July ?, 1986": the month is known, the day is not
    if m:
        return datetime.datetime.strptime(f'{m.group(1)} 1, {m.group(2)}', '%B %d, %Y').date().isoformat(), True
    return None, True


def parse(y):
    c, b = get(url(y))
    if c != 200:
        return None
    t = b.decode()
    out = []
    for d, body in re.findall(r'<li[^>]*><span>([^<]+)</span>(.*?)</li>', t, re.S):
        date, approx = iso(d.strip())
        for k, p in enumerate(re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)):
            out.append({'season_end': y, 'date': date, 'date_text': d.strip(), 'approx': approx, 'n': k,
                        'from': re.findall(r'data-attr-from="([A-Z]{3})"', p), 'to': re.findall(r'data-attr-to="([A-Z]{3})"', p),
                        'links': re.findall(r'href="(/[^"]+)"', p),
                        'text': ' '.join(H.unescape(re.sub(r'<[^>]+>', '', p)).split()), 'source': url(y)})
    return out


if __name__ == '__main__':
    allrows = []
    for y in range(FIRST, LAST + 1):
        rows = parse(y)
        print(y, 'missing' if rows is None else len(rows), flush=True)
        allrows += rows or []
    os.makedirs(OUT, exist_ok=True)
    json.dump(allrows, open(os.path.join(OUT, 'br_tx.json'), 'w'))
    print('paragraphs', len(allrows))
