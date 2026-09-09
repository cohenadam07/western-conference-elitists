#!/usr/bin/env python3
"""
UFC Savant — ufcstats.com scraper.

ufcstats.com is the public face of the official FightMetric feed: every UFC fight since 1993,
with per-round significant strikes (by target and by position), knockdowns, takedowns,
submission attempts, reversals and control time. It is the only free source with round-level
data, and — unlike stats.nba.com — it answers cloud IPs, so this runs from GitHub Actions.

Since 2026 every first request gets a JavaScript proof-of-work page ("Checking your
browser…"): SHA-256 of `nonce:n` must start with Z zeros, then POST /__c with nonce and n.
The server answers 204 with a 7-day `_fmc` cookie. `Session.solve()` does that in
milliseconds; nothing else about the site is unusual.

The store is three gzipped JSON-lines files under pipeline/ufc/raw/, keyed on ufcstats'
16-hex ids (never on names — there are duplicate names in the fighter index):

  events.jsonl.gz    {id, name, date, location, fights:[fight ids in card order]}
  fights.jsonl.gz    {id, event, wc, title, bonus, method, detail, round, time, fmt, ref,
                      f:[{id, name, res, kd, ss, ssa, ts, tsa, td, tda, sub, rev, ctrl,
                           head, heada, body, bodya, leg, lega, dist, dista, clinch, clincha,
                           ground, grounda,
                           rounds:[{...same counting fields per round...}]}]}
  fighters.jsonl.gz  {id, name, nick, rec, ht, wt, reach, stance, dob, fights:[ids]}

Usage
  python3 scrape.py                 incremental: new events + fighters touched by them
  python3 scrape.py --full          everything (first run; ~14k pages, ~20 min at 6 workers)
  python3 scrape.py --refighters    re-pull every fighter page (record/reach/dob updates)
  python3 scrape.py --upcoming      write raw/upcoming.json (next cards, bout lists) only
"""
import argparse, gzip, hashlib, json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
BASE = 'http://ufcstats.com'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 wcehoops-ufc-savant'
WORKERS = int(os.environ.get('UFC_WORKERS', '6'))


# ------------------------------------------------------------------ session + proof of work
class Session:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers['User-Agent'] = UA
        self.solved = False

    def solve(self, html):
        m = re.search(r'var nonce="([0-9a-f]+)",\s*target=new Array\((\d+)\+1\)', html)
        if not m:
            return False
        nonce, z = m.group(1), int(m.group(2))
        n = 0
        while not hashlib.sha256(f'{nonce}:{n}'.encode()).hexdigest().startswith('0' * z):
            n += 1
        r = self.s.post(BASE + '/__c', data={'nonce': nonce, 'n': n}, timeout=30)
        self.solved = r.status_code in (200, 204)
        return self.solved

    def get(self, url, tries=4):
        last = None
        for i in range(tries):
            try:
                r = self.s.get(url, timeout=40)
                if r.status_code == 200:
                    if 'Checking your browser' in r.text[:4000] and 'var nonce=' in r.text:
                        if self.solve(r.text):
                            continue
                    return r.text
                last = f'HTTP {r.status_code}'
            except requests.RequestException as e:
                last = str(e)
            time.sleep(1.5 * (i + 1))
        raise RuntimeError(f'{url}: {last}')


S = Session()


# ------------------------------------------------------------------ small parsers
def txt(el):
    return re.sub(r'\s+', ' ', el.get_text(' ', strip=True)) if el else ''

def hexid(href):
    m = re.search(r'/([0-9a-f]{16})/?$', href or '')
    return m.group(1) if m else None

def of(s):
    """'14 of 31' -> (14, 31); '---' -> (None, None)."""
    m = re.match(r'\s*(\d+)\s+of\s+(\d+)', s or '')
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)

def num(s):
    m = re.match(r'\s*(-?\d+)', s or '')
    return int(m.group(1)) if m else None

def mmss(s):
    m = re.match(r'\s*(\d+):(\d+)', s or '')
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None

def pct(s):
    m = re.match(r'\s*(\d+)%', s or '')
    return int(m.group(1)) if m else None

def inches(s):
    m = re.match(r"\s*(\d+)'\s*(\d+)\"", s or '')
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    m = re.match(r'\s*(\d+)"', s or '')
    return int(m.group(1)) if m else None

def parse_date(s):
    for fmt in ('%B %d, %Y', '%b %d, %Y'):
        try:
            return datetime.strptime(s.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return None


# ------------------------------------------------------------------ pages
def event_list(upcoming=False):
    html = S.get(f'{BASE}/statistics/events/{"upcoming" if upcoming else "completed"}?page=all')
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for tr in soup.select('tr.b-statistics__table-row'):
        a = tr.select_one('a.b-link')
        if not a:
            continue
        tds = tr.select('td')
        out.append({
            'id': hexid(a['href']), 'name': txt(a),
            'date': parse_date(txt(tr.select_one('span.b-statistics__date'))),
            'location': txt(tds[-1]) if tds else '',
        })
    return out


def event_page(eid):
    soup = BeautifulSoup(S.get(f'{BASE}/event-details/{eid}'), 'html.parser')
    ev = {'id': eid, 'name': txt(soup.select_one('span.b-content__title-highlight')),
          'date': None, 'location': '', 'fights': [], 'bouts': []}
    for li in soup.select('li.b-list__box-list-item'):
        t = txt(li)
        if t.startswith('Date:'):
            ev['date'] = parse_date(t[5:])
        elif t.startswith('Location:'):
            ev['location'] = t[9:].strip()
    for tr in soup.select('tr.b-fight-details__table-row[data-link]'):
        fid = hexid(tr['data-link'])
        tds = tr.select('td')
        names = [{'id': hexid(a.get('href')), 'name': txt(a)} for a in tds[1].select('a')] if len(tds) > 1 else []
        wc = txt(tds[6]) if len(tds) > 6 else ''
        ev['fights'].append(fid)
        ev['bouts'].append({'id': fid, 'f': names, 'wc': wc})
    return ev


COUNT_COLS = ['kd', 'ss', 'ts', 'td', 'sub', 'rev', 'ctrl']
SIG_COLS = ['head', 'body', 'leg', 'dist', 'clinch', 'ground']

def _two(td):
    ps = td.select('p')
    return [txt(p) for p in ps] if ps else [txt(td), '']

def _totals_row(tds, into):
    # Fighter | KD | Sig. str. | Sig. str. % | Total str. | Td | Td % | Sub. att | Rev. | Ctrl
    kd = _two(tds[1]); ss = _two(tds[2]); ts = _two(tds[4]); td_ = _two(tds[5])
    sub = _two(tds[7]); rev = _two(tds[8]); ctrl = _two(tds[9])
    for i in range(2):
        d = into[i]
        d['kd'] = num(kd[i]); d['ss'], d['ssa'] = of(ss[i]); d['ts'], d['tsa'] = of(ts[i])
        d['td'], d['tda'] = of(td_[i]); d['sub'] = num(sub[i]); d['rev'] = num(rev[i]); d['ctrl'] = mmss(ctrl[i])

def _sig_row(tds, into):
    # Fighter | Sig. str | Sig. str. % | Head | Body | Leg | Distance | Clinch | Ground
    for j, key in enumerate(SIG_COLS):
        vals = _two(tds[3 + j])
        for i in range(2):
            into[i][key], into[i][key + 'a'] = of(vals[i])

def _rounds(table, kind):
    """Walk a per-round table: alternating <thead>Round N</thead><tbody>row</tbody>."""
    out = []  # list of (round, [d1, d2])
    rnd = None
    # html.parser keeps the site's odd nesting (a <thead> inside the <tbody> before each
    # round's row), so walk every thead/tr in document order and track the last round seen.
    for el in table.find_all(['thead', 'tr']):
        if el.name == 'thead':
            m = re.search(r'Round\s+(\d+)', txt(el))
            if m:
                rnd = int(m.group(1))
            continue
        tds = el.select('td')
        if len(tds) < 9 or rnd is None:
            continue
        d = [{}, {}]
        (_totals_row if kind == 'tot' else _sig_row)(tds, d)
        out.append((rnd, d))
    return out


def fight_page(fid):
    soup = BeautifulSoup(S.get(f'{BASE}/fight-details/{fid}'), 'html.parser')
    ev = soup.select_one('h2.b-content__title a')
    fight = {'id': fid, 'event': hexid(ev['href']) if ev else None, 'f': []}
    for p in soup.select('div.b-fight-details__person'):
        a = p.select_one('a.b-fight-details__person-link')
        fight['f'].append({
            'id': hexid(a['href']) if a else None, 'name': txt(a),
            'res': txt(p.select_one('i.b-fight-details__person-status')),
            'nick': txt(p.select_one('p.b-fight-details__person-title')).strip('"'),
        })
    if len(fight['f']) != 2:
        return None
    title = soup.select_one('i.b-fight-details__fight-title')
    fight['wc'] = txt(title).replace(' Bout', '').strip() if title else ''
    imgs = [img.get('src', '').rsplit('/', 1)[-1] for img in title.select('img')] if title else []
    fight['title'] = 'belt.png' in imgs
    fight['bonus'] = [i.replace('.png', '') for i in imgs if i != 'belt.png']
    for p in soup.select('p.b-fight-details__text'):
        t = txt(p)
        for lab, key in (('Method:', 'method'), ('Round:', 'round'), ('Time:', 'time'),
                         ('Time format:', 'fmt'), ('Referee:', 'ref'), ('Details:', 'detail')):
            m = re.search(re.escape(lab) + r'\s*(.*?)(?=\s(?:Method|Round|Time format|Time|Referee|Details):|$)', t)
            if m and key not in fight:
                fight[key] = m.group(1).strip()
    fight['round'] = num(fight.get('round'))
    fight['time'] = mmss(fight.get('time'))
    for f in fight['f']:
        f['rounds'] = {}
    tables = soup.select('table')
    if len(tables) >= 4:
        # 0 totals, 1 totals per round, 2 sig strikes, 3 sig per round
        tds = tables[0].select('tbody tr td')
        if len(tds) >= 10:
            _totals_row(tds, fight['f'])
        tds = tables[2].select('tbody tr td')
        if len(tds) >= 9:
            _sig_row(tds, fight['f'])
        for rnd, d in _rounds(tables[1], 'tot'):
            for i in range(2):
                fight['f'][i]['rounds'].setdefault(rnd, {}).update(d[i])
        for rnd, d in _rounds(tables[3], 'sig'):
            for i in range(2):
                fight['f'][i]['rounds'].setdefault(rnd, {}).update(d[i])
        fight['stats'] = True
    else:
        fight['stats'] = False
    for f in fight['f']:
        f['rounds'] = [dict(r=k, **v) for k, v in sorted(f['rounds'].items())]
    return fight


def fighter_page(pid):
    soup = BeautifulSoup(S.get(f'{BASE}/fighter-details/{pid}'), 'html.parser')
    p = {'id': pid, 'name': txt(soup.select_one('span.b-content__title-highlight')),
         'nick': txt(soup.select_one('p.b-content__Nickname')),
         'rec': None, 'ht': None, 'wt': None, 'reach': None, 'stance': None, 'dob': None,
         'career': {}, 'fights': []}
    m = re.search(r'Record:\s*(\d+)-(\d+)-(\d+)(?:\s*\((\d+)\s*NC\))?', txt(soup.select_one('span.b-content__title-record')))
    if m:
        p['rec'] = [int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4) or 0)]
    for li in soup.select('li.b-list__box-list-item'):
        t = txt(li)
        lab, _, val = t.partition(':')
        lab = lab.strip().lower(); val = val.strip()
        if val in ('--', ''):
            continue
        if lab == 'height': p['ht'] = inches(val)
        elif lab == 'weight': p['wt'] = num(val)
        elif lab == 'reach': p['reach'] = inches(val)
        elif lab == 'stance': p['stance'] = val
        elif lab == 'dob': p['dob'] = parse_date(val)
        elif lab in ('slpm', 'str. acc.', 'sapm', 'str. def', 'td avg.', 'td acc.', 'td def.', 'sub. avg.'):
            key = {'slpm': 'slpm', 'str. acc.': 'sacc', 'sapm': 'sapm', 'str. def': 'sdef',
                   'td avg.': 'tdavg', 'td acc.': 'tdacc', 'td def.': 'tddef', 'sub. avg.': 'subavg'}[lab]
            p['career'][key] = float(val.rstrip('%'))
    for tr in soup.select('tr.b-fight-details__table-row[data-link]'):
        p['fights'].append(hexid(tr['data-link']))
    return p


# ------------------------------------------------------------------ store
def load(name):
    path = os.path.join(RAW, name + '.jsonl.gz')
    if not os.path.exists(path):
        return {}
    out = {}
    with gzip.open(path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            if line.strip():
                d = json.loads(line)
                out[d['id']] = d
    return out

def save(name, rows):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, name + '.jsonl.gz')
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wt', encoding='utf-8', compresslevel=6) as fh:
        for k in sorted(rows):
            fh.write(json.dumps(rows[k], separators=(',', ':'), ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def pmap(fn, keys, label):
    """Threaded map with progress; failures are reported and skipped, never fatal."""
    out, bad, done = {}, [], 0
    if not keys:
        return out
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(fn, k): k for k in keys}
        for fut in as_completed(futs):
            k = futs[fut]; done += 1
            try:
                r = fut.result()
                if r is not None:
                    out[k] = r
            except Exception as e:  # noqa
                bad.append((k, str(e)[:120]))
            if done % 100 == 0 or done == len(keys):
                print(f'  {label}: {done}/{len(keys)}  {time.time()-t0:.0f}s', flush=True)
    for k, e in bad[:20]:
        print(f'  !! {label} {k}: {e}')
    if len(bad) > 20:
        print(f'  !! ... {len(bad)} failures total')
    return out


def upcoming():
    evs = event_list(upcoming=True)
    cards = []
    for e in evs[:3]:
        try:
            page = event_page(e['id'])
        except Exception as ex:  # noqa
            print('  upcoming event failed', e['id'], ex); continue
        cards.append({'id': e['id'], 'name': e['name'], 'date': page['date'] or e['date'],
                      'location': page['location'] or e['location'], 'bouts': page['bouts']})
    cards.sort(key=lambda c: c['date'] or '9999')
    os.makedirs(RAW, exist_ok=True)
    with open(os.path.join(RAW, 'upcoming.json'), 'w') as fh:
        json.dump({'generated': datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ'), 'cards': cards}, fh, separators=(',', ':'))
    print(f'upcoming: {len(cards)} cards, {sum(len(c["bouts"]) for c in cards)} bouts')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--full', action='store_true')
    ap.add_argument('--refighters', action='store_true')
    ap.add_argument('--upcoming', action='store_true')
    ap.add_argument('--recent', type=int, default=3, help='always re-pull the N most recent events (late corrections)')
    a = ap.parse_args()

    if a.upcoming:
        upcoming(); return

    events, fights, fighters = load('events'), load('fights'), load('fighters')
    print(f'store: {len(events)} events, {len(fights)} fights, {len(fighters)} fighters')

    listed = event_list()
    listed = [e for e in listed if e['date']]           # the list also carries the next card, dateless rows etc.
    listed.sort(key=lambda e: e['date'])
    todo = [e['id'] for e in listed if a.full or e['id'] not in events]
    todo += [e['id'] for e in listed[-a.recent:] if e['id'] not in todo]
    print(f'events to pull: {len(todo)}')
    got = pmap(event_page, todo, 'events')
    for eid, ev in got.items():
        ev.pop('bouts', None)
        events[eid] = ev
    save('events', events)

    fids = []
    for eid in got:
        fids += [f for f in events[eid]['fights'] if a.full or f not in fights or not fights[f].get('stats')]
    fids = list(dict.fromkeys(fids))
    print(f'fights to pull: {len(fids)}')
    gotf = pmap(fight_page, fids, 'fights')
    for fid, f in gotf.items():
        f['date'] = events.get(f['event'], {}).get('date')
        fights[fid] = f
    # fights whose event we already had but that were re-pulled: keep date current
    for f in fights.values():
        if not f.get('date') and f.get('event') in events:
            f['date'] = events[f['event']]['date']
    save('fights', fights)

    pids = set()
    for f in gotf.values():
        for x in f['f']:
            if x['id']:
                pids.add(x['id'])
    if a.refighters or a.full:
        for f in fights.values():
            for x in f['f']:
                if x['id']:
                    pids.add(x['id'])
    else:
        # anyone in the store who has never been pulled
        for f in fights.values():
            for x in f['f']:
                if x['id'] and x['id'] not in fighters:
                    pids.add(x['id'])
    print(f'fighters to pull: {len(pids)}')
    gotp = pmap(fighter_page, sorted(pids), 'fighters')
    fighters.update(gotp)
    save('fighters', fighters)
    print(f'done: {len(events)} events, {len(fights)} fights, {len(fighters)} fighters')

    try:
        upcoming()
    except Exception as e:  # noqa
        print('upcoming failed:', e)


if __name__ == '__main__':
    main()
