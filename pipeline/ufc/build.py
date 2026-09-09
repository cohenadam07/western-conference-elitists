#!/usr/bin/env python3
"""
UFC Savant — build public/ufc-savant-data.json (+ public/ufc-savant-fights.json).

Reads the raw store written by scrape.py (and raw/headshots.json from headshots.py),
walks every UFC fight in date order to compute an Elo rating, then aggregates each
fighter's fights into three windows — career, last five, last three — and emits one
metric row per window, in the same cfg + rows shape Football Savant's page consumes.

Percentiles are NOT computed here. The page computes them in the browser against whichever
population the reader picks (division or everyone; active fighters or all-time), the same
way the other Savants do, so the pool can move under the bars without a round trip.

  python3 build.py                 -> ../../public/ufc-savant-data.json, ufc-savant-fights.json
  python3 build.py --out DIR
"""
import argparse, json, math, os, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scrape import load  # noqa: E402
from metrics import (METRICS, PANELS, GROUP_LABEL, HEADLINE, WEAK_DIMS, QUALIFY, DENOMS,  # noqa: E402
                     DIVISIONS, DIV_LABEL, DIV_SEX, division_of)

MBY = {m['key']: m for m in METRICS}
WINDOWS = [('career', 'UFC career'), ('l5', 'Last 5 fights'), ('l3', 'Last 3 fights')]
ACTIVE_MONTHS = 24


# ------------------------------------------------------------------ helpers
def rnd(v, p=4):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    return round(v, p)

def safe(a, b, scale=1.0):
    if a is None or not b:
        return None
    return a / b * scale

def round_lengths(fmt):
    """'3 Rnd (5-5-5)' -> [5,5,5] minutes per round; None when the format has none."""
    m = re.search(r'\(([\d\-]+)\)', fmt or '')
    if not m:
        return None
    return [int(x) for x in m.group(1).split('-') if x]

def fight_seconds(f):
    lens = round_lengths(f.get('fmt'))
    r, t = f.get('round') or 1, f.get('time') or 0
    if lens:
        return sum(lens[:max(0, r - 1)]) * 60 + t
    return (r - 1) * 300 + t         # early 'No Time Limit' cards: the round is the fight

def round_seconds(f, r):
    """How long round r lasted in fight f."""
    lens = round_lengths(f.get('fmt'))
    if r == (f.get('round') or 1):
        return f.get('time') or 0
    if lens and r - 1 < len(lens):
        return lens[r - 1] * 60
    return 300

def method_kind(method):
    m = (method or '').lower()
    if m.startswith('ko') or 'tko' in m:
        return 'KO'
    if 'submission' in m:
        return 'SUB'
    if 'decision' in m:
        return 'DEC'
    if 'dq' in m:
        return 'DQ'
    if 'could not continue' in m or 'overturned' in m:
        return 'OTHER'
    return 'OTHER'

def age_at(dob, date):
    if not dob or not date:
        return None
    a, b = datetime.strptime(dob, '%Y-%m-%d'), datetime.strptime(date, '%Y-%m-%d')
    return b.year - a.year - ((b.month, b.day) < (a.month, a.day))


# ------------------------------------------------------------------ Elo
def run_elo(fights):
    """Walk every fight in order. Writes pre-fight ratings onto each fighter row (x['elo'])
    and returns {fighter id: final rating}."""
    K = 32.0
    R = defaultdict(lambda: 1500.0)
    order = sorted(fights.values(), key=lambda f: (f.get('date') or '0000', f['event'], f['id']))
    for f in order:
        a, b = f['f']
        if not a['id'] or not b['id']:
            continue
        ra, rb = R[a['id']], R[b['id']]
        a['elo'], b['elo'] = round(ra), round(rb)
        res = {a['res']: a, b['res']: b}
        if 'NC' in res or a['res'] == b['res'] == 'D':
            sa = 0.5 if a['res'] == 'D' else None
        elif a['res'] == 'W':
            sa = 1.0
        elif b['res'] == 'W':
            sa = 0.0
        else:
            sa = None
        if sa is None:
            continue
        kind = method_kind(f.get('method'))
        k = K * (1.25 if kind in ('KO', 'SUB') else 1.0)
        ea = 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))
        R[a['id']] = ra + k * (sa - ea)
        R[b['id']] = rb + k * ((1 - sa) - (1 - ea))
    return R


# ------------------------------------------------------------------ per fighter-fight rows
def fighter_fight(f, i):
    """One fighter's side of one fight, as the numbers the aggregator sums."""
    x, o = f['f'][i], f['f'][1 - i]
    secs = fight_seconds(f)
    kind = method_kind(f.get('method'))
    row = dict(
        id=f['id'], date=f.get('date'), secs=secs, res=x['res'], kind=kind,
        rnd=f.get('round') or 1, wc=f.get('wc'), title=bool(f.get('title')) or 'title' in (f.get('wc') or '').lower(),
        ss=x.get('ss'), ssa=x.get('ssa'), oss=o.get('ss'), ossa=o.get('ssa'),
        kd=x.get('kd'), okd=o.get('kd'), td=x.get('td'), tda=x.get('tda'),
        otd=o.get('td'), otda=o.get('tda'), sub=x.get('sub'), rev=x.get('rev'),
        ctrl=x.get('ctrl'), octrl=o.get('ctrl'),
        head=x.get('head'), heada=x.get('heada'), body=x.get('body'), bodya=x.get('bodya'),
        leg=x.get('leg'), lega=x.get('lega'), dist=x.get('dist'), dista=x.get('dista'),
        clinch=x.get('clinch'), clincha=x.get('clincha'), ground=x.get('ground'), grounda=x.get('grounda'),
        ohead=o.get('head'), obody=o.get('body'), oleg=o.get('leg'),
        odist=o.get('dist'), oclinch=o.get('clinch'), oground=o.get('ground'),
        elo=x.get('elo'), oelo=o.get('elo'), opp=o['id'], oppname=o['name'],
        stats=bool(f.get('stats')),
    )
    # rounds: [(r, secs, ss, oss)]
    rs = []
    orounds = {r['r']: r for r in o.get('rounds', [])}
    for r in x.get('rounds', []):
        rr = r['r']
        orr = orounds.get(rr, {})
        rs.append((rr, round_seconds(f, rr), r.get('ss'), orr.get('ss')))
    row['rounds'] = rs
    return row


def aggregate(rows, fighter, asof):
    """Sum a window of fighter-fight rows into metrics + denominators."""
    S = Counter()
    n = len(rows)
    have_ctrl = 0
    for r in rows:
        S['secs'] += r['secs']
        if not r['stats']:
            continue
        for k in ('ss', 'ssa', 'oss', 'ossa', 'kd', 'okd', 'td', 'tda', 'otd', 'otda', 'sub', 'rev',
                  'head', 'body', 'leg', 'dist', 'clinch', 'ground'):
            if r.get(k) is not None:
                S[k] += r[k]
                S['n_' + k] += 1
        if r['date'] and r['date'] >= '2000-01-01' and r.get('ctrl') is not None:
            S['ctrl'] += r['ctrl']; S['octrl'] += (r.get('octrl') or 0); S['ctrlsecs'] += r['secs']; have_ctrl += 1
        for rr, secs, ss, oss in r['rounds']:
            if rr in (1, 2, 3):
                S[f'r{rr}secs'] += secs
                if ss is not None: S[f'r{rr}ss'] += ss
                if oss is not None: S[f'r{rr}oss'] += oss
    mins = S['secs'] / 60.0
    wins = sum(1 for r in rows if r['res'] == 'W')
    losses = sum(1 for r in rows if r['res'] == 'L')
    kow = sum(1 for r in rows if r['res'] == 'W' and r['kind'] == 'KO')
    subw = sum(1 for r in rows if r['res'] == 'W' and r['kind'] == 'SUB')
    kol = sum(1 for r in rows if r['res'] == 'L' and r['kind'] == 'KO')
    subl = sum(1 for r in rows if r['res'] == 'L' and r['kind'] == 'SUB')
    r1fin = sum(1 for r in rows if r['res'] == 'W' and r['kind'] in ('KO', 'SUB') and r['rnd'] == 1)
    dec = sum(1 for r in rows if r['kind'] == 'DEC')
    dates = sorted(r['date'] for r in rows if r['date'])
    years = 1.0
    if len(dates) >= 2:
        d0, d1 = datetime.strptime(dates[0], '%Y-%m-%d'), datetime.strptime(dates[-1], '%Y-%m-%d')
        years = max(1.0, (d1 - d0).days / 365.25)
    elos = [r['oelo'] for r in rows if r.get('oelo') is not None]
    r1min, r2min, r3min = S['r1secs'] / 60.0, S['r2secs'] / 60.0, S['r3secs'] / 60.0
    r1out = safe(S['r1ss'], r1min); r3out = safe(S['r3ss'], r3min)
    ctrlmin = S['ctrlsecs'] / 60.0

    m = dict(
        n=n, min=rnd(mins, 2), avgtime=rnd(safe(mins, n), 2), act=rnd(n / years, 2),
        winpct=rnd(safe(wins, wins + losses, 100), 1),
        elo=None, sos=rnd(sum(elos) / len(elos), 0) if elos else None,
        slpm=rnd(safe(S['ss'], mins)), sapm=rnd(safe(S['oss'], mins)),
        diff=rnd(safe(S['ss'] - S['oss'], mins)) if mins else None,
        pace=rnd(safe(S['ss'] + S['oss'], mins)),
        sacc=rnd(safe(S['ss'], S['ssa'], 100), 1), sdef=rnd(100 - safe(S['oss'], S['ossa'], 100), 1) if S['ossa'] else None,
        kd15=rnd(safe(S['kd'], mins, 15)), kd100=rnd(safe(S['kd'], S['ss'], 100)),
        kdabs15=rnd(safe(S['okd'], mins, 15)),
        headshr=rnd(safe(S['head'], S['ss'], 100), 1) if S['n_head'] else None,
        bodyshr=rnd(safe(S['body'], S['ss'], 100), 1) if S['n_body'] else None,
        legshr=rnd(safe(S['leg'], S['ss'], 100), 1) if S['n_leg'] else None,
        distshr=rnd(safe(S['dist'], S['ss'], 100), 1) if S['n_dist'] else None,
        clinchshr=rnd(safe(S['clinch'], S['ss'], 100), 1) if S['n_clinch'] else None,
        groundshr=rnd(safe(S['ground'], S['ss'], 100), 1) if S['n_ground'] else None,
        td15=rnd(safe(S['td'], mins, 15)), tdacc=rnd(safe(S['td'], S['tda'], 100), 1),
        tddef=rnd(100 - safe(S['otd'], S['otda'], 100), 1) if S['otda'] else None,
        ctrl15=rnd(safe(S['ctrl'] / 60.0, ctrlmin, 15), 2) if have_ctrl else None,
        ctrldiff=rnd(safe((S['ctrl'] - S['octrl']) / 60.0, ctrlmin, 15), 2) if have_ctrl else None,
        ctrlabs15=rnd(safe(S['octrl'] / 60.0, ctrlmin, 15), 2) if have_ctrl else None,
        sub15=rnd(safe(S['sub'], mins, 15)), rev15=rnd(safe(S['rev'], mins, 15)),
        finrate=rnd(safe(kow + subw, wins, 100), 1), kowin=rnd(safe(kow, n, 100), 1),
        subwin=rnd(safe(subw, n, 100), 1), r1fin=rnd(safe(r1fin, n, 100), 1),
        finloss=rnd(safe(kol + subl, n, 100), 1),
        koloss100=rnd(safe(kol, S['oss'], 100), 2) if S['oss'] else None,
        decrate=rnd(safe(dec, n, 100), 1),
        r1out=rnd(r1out), r2out=rnd(safe(S['r2ss'], r2min)), r3out=rnd(r3out),
        fade=rnd(r3out / r1out, 2) if (r1out and r3out is not None and r1min >= 5 and r3min >= 5) else None,
        r3abs=rnd(safe(S['r3oss'], r3min)),
    )
    d = dict(n=n, min=rnd(mins, 1), ssa=S['ssa'], ss=S['ss'], oppssa=S['ossa'], oppss=S['oss'],
             tda=S['tda'], opptda=S['otda'], wins=wins, losses=losses,
             r1min=rnd(r1min, 1), r3min=rnd(r3min, 1))
    # the strike map: landed/attempted by target and by position, his and absorbed
    sm = dict(
        t=[[S['head'], S['heada'] if 'heada' in S else None], [S['body'], None], [S['leg'], None]],
        p=[[S['dist'], None], [S['clinch'], None], [S['ground'], None]],
    )
    # attempts by target/position (kept separate so a fight without the breakdown doesn't zero it)
    A = Counter()
    O = Counter()
    for r in rows:
        if not r['stats']:
            continue
        for k in ('heada', 'bodya', 'lega', 'dista', 'clincha', 'grounda'):
            if r.get(k) is not None:
                A[k] += r[k]
        for k in ('ohead', 'obody', 'oleg', 'odist', 'oclinch', 'oground'):
            if r.get(k) is not None:
                O[k] += r[k]
    sm = dict(t=[[S['head'], A['heada']], [S['body'], A['bodya']], [S['leg'], A['lega']]],
              p=[[S['dist'], A['dista']], [S['clinch'], A['clincha']], [S['ground'], A['grounda']]],
              ot=[O['ohead'], O['obody'], O['oleg']], op=[O['odist'], O['oclinch'], O['oground']])
    # round curve: rounds 1-5, [out/min, absorbed/min, minutes]
    RC = defaultdict(lambda: [0, 0, 0.0])
    for r in rows:
        for rr, secs, ss, oss in r['rounds']:
            if 1 <= rr <= 5:
                RC[rr][0] += ss or 0; RC[rr][1] += oss or 0; RC[rr][2] += secs / 60.0
    rc = []
    for rr in range(1, 6):
        if RC[rr][2] >= 1.0:
            rc.append([rnd(RC[rr][0] / RC[rr][2], 2), rnd(RC[rr][1] / RC[rr][2], 2), rnd(RC[rr][2], 1)])
        else:
            rc.append(None)
    # division: the modal weight class in the window, most recent on ties
    divs = [division_of(r['wc']) for r in rows]
    divs = [x for x in divs if x]
    div = None
    if divs:
        c = Counter(divs)
        top = max(c.values())
        for r in reversed(rows):
            dd = division_of(r['wc'])
            if dd and c[dd] == top:
                div = dd; break
    return m, d, sm, rc, div


# ------------------------------------------------------------------ official rankings
def _norm_name(s):
    import unicodedata
    s = (s or '').translate(str.maketrans({'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'æ': 'ae'}))
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r"[^a-z ]", ' ', s).split())

def attach_rankings(out_f, rankings):
    """UFC.com's rankings, matched to ufcstats fighters by name. A division list prefers a
    fighter whose current division matches; pound-for-pound lists take anyone active.
    Writes e['rks'] = {division: 0 for champion, 1..15} (a fighter can be ranked in two
    divisions at once) and e['p4p'] = 1..15."""
    by_name = defaultdict(list)
    for e in out_f.values():
        by_name[_norm_name(e['name'])].append(e)
    def find(name, div=None):
        cands = by_name.get(_norm_name(name), [])
        if not cands:
            # 'Jr.' / middle-name variants: match on first + last token
            toks = _norm_name(name).split()
            if len(toks) >= 2:
                key = toks[0] + ' ' + toks[-1]
                cands = [e for k, es in by_name.items() for e in es
                         if k.split()[:1] == [toks[0]] and k.split()[-1:] == [toks[-1]]]
        if not cands:
            return None
        cands.sort(key=lambda e: ((div and e['w']['career']['div'] == div) or False, e['active'], e['last']), reverse=True)
        return cands[0]
    n_hit = n_miss = 0
    for key, lst in rankings.get('lists', {}).items():
        div = None if key.startswith('P4P') else key
        names = ([lst['champion']] if lst.get('champion') else []) + list(lst.get('ranked', []))
        start = 0 if lst.get('champion') else 1
        for i, nm in enumerate(names):
            e = find(nm, div)
            if not e:
                n_miss += 1; continue
            n_hit += 1
            if div:
                e.setdefault('rks', {})[div] = start + i
            else:
                e['p4p'] = i + 1
    print(f'rankings: matched {n_hit}, unmatched {n_miss}')


# ------------------------------------------------------------------ comps
def pct_rank(v, pool, lower):
    n = len(pool)
    if v is None or n < 2:
        return None
    less = sum(1 for x in pool if x < v)
    eq = sum(1 for x in pool if x == v)
    p = 100.0 * (less + 0.5 * eq) / n
    return 100.0 - p if lower else p


def add_comps(rows_by_div):
    """Style comps and weakness comps inside one division, one window."""
    for div, group in rows_by_div.items():
        qual = [w for w in group if w['qualified']]
        if len(qual) < 8:
            continue
        dims = [k for k in HEADLINE if k in MBY]
        wdims = [k for k in WEAK_DIMS if k in MBY]
        pools = {k: sorted(w['m'][k] for w in qual if w['m'].get(k) is not None) for k in set(dims) | set(wdims)}
        def vec(w, keys):
            return [pct_rank(w['m'].get(k), pools[k], MBY[k]['lower']) if w['m'].get(k) is not None else None for k in keys]
        vecs = {w['_id']: vec(w, dims) for w in qual}
        wvecs = {w['_id']: vec(w, wdims) for w in qual}
        for w in qual:
            a = vecs[w['_id']]
            scored = []
            for q in qual:
                if q['_id'] == w['_id']:
                    continue
                b = vecs[q['_id']]
                pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
                if len(pairs) < max(3, len(dims) - 4):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                scored.append((round(max(0.0, 100.0 - dist * 1.6)), q))
            scored.sort(key=lambda t: -t[0])
            w['comps'] = [dict(id=q['_id'], name=q['_name'], score=s) for s, q in scored[:4]]
            aw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[w['_id']]]
            flaws = sorted([(x, k) for x, k in zip(wvecs[w['_id']], wdims) if x is not None and x < 40],
                           key=lambda t: t[0])[:3]
            w['wflaws'] = [dict(k=k, pct=int(round(x))) for x, k in flaws]
            worst = min([v for v in wvecs[w['_id']] if v is not None], default=None)
            if worst is None or worst >= 40:
                w['wcomps'] = []
                continue
            wscored = []
            for q in qual:
                if q['_id'] == w['_id']:
                    continue
                bw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[q['_id']]]
                pairs = [(x, y) for x, y in zip(aw, bw) if x is not None and y is not None]
                if len(pairs) < max(3, len(wdims) - 3):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                wscored.append((round(max(0.0, 100.0 - dist * 2.2)), q))
            wscored.sort(key=lambda t: -t[0])
            w['wcomps'] = [dict(id=q['_id'], name=q['_name'], score=s) for s, q in wscored[:4]]


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'public'))
    a = ap.parse_args()

    events, fights, fighters = load('events'), load('fights'), load('fighters')
    heads = json.load(open(os.path.join(HERE, 'raw', 'headshots.json'))) if os.path.exists(os.path.join(HERE, 'raw', 'headshots.json')) else {}
    rpath = os.path.join(HERE, 'raw', 'rankings.json')
    rankings = json.load(open(rpath)) if os.path.exists(rpath) else {'fetched': None, 'lists': {}}
    print(f'{len(events)} events, {len(fights)} fights, {len(fighters)} fighters, {sum(1 for v in heads.values() if v)} headshots')
    for f in fights.values():
        if not f.get('date') and f['event'] in events:
            f['date'] = events[f['event']]['date']
    fights = {k: v for k, v in fights.items() if v.get('date') and len(v['f']) == 2 and all(x['id'] for x in v['f'])}

    final_elo = run_elo(fights)
    latest = max(f['date'] for f in fights.values())
    active_cut = (datetime.strptime(latest, '%Y-%m-%d') - timedelta(days=30.4 * ACTIVE_MONTHS)).strftime('%Y-%m-%d')

    # per fighter rows in date order
    by_f = defaultdict(list)
    for f in fights.values():
        for i in range(2):
            by_f[f['f'][i]['id']].append(fighter_fight(f, i))
    for pid in by_f:
        by_f[pid].sort(key=lambda r: (r['date'], r['id']))

    out_f = {}
    win_rows = {w: defaultdict(list) for w, _ in WINDOWS}
    for pid, rows in by_f.items():
        bio = fighters.get(pid, {})
        name = bio.get('name') or rows[-1]['id'] and next((x['name'] for f in [fights[rows[-1]['id']]] for x in f['f'] if x['id'] == pid), pid)
        last = rows[-1]['date']
        entry = dict(
            id=pid, name=name, nick=bio.get('nick') or '', ht=bio.get('ht'), wt=bio.get('wt'),
            reach=bio.get('reach'), stance=bio.get('stance'), dob=bio.get('dob'),
            rec=bio.get('rec'), h=heads.get(pid), last=last, first=rows[0]['date'],
            active=last >= active_cut, age=age_at(bio.get('dob'), latest),
            w={}, log=[],
        )
        # the fight log, newest first
        for r in reversed(rows):
            f = fights[r['id']]
            entry['log'].append(dict(
                id=r['id'], date=r['date'], opp=r['opp'], oppname=r['oppname'], res=r['res'],
                method=f.get('method'), kind=r['kind'], rnd=r['rnd'], time=f.get('time'), wc=r['wc'],
                title=bool(r['title']), ev=f['event'],
                elo=r.get('elo'), oelo=r.get('oelo'), bonus=f.get('bonus') or [],
                ss=r['ss'], oss=r['oss'], kd=r['kd'], td=r['td'], ctrl=r['ctrl'], secs=r['secs'],
            ))
        for wkey, _ in WINDOWS:
            sub = rows if wkey == 'career' else rows[-int(wkey[1:]):]
            m, d, sm, rc, div = aggregate(sub, bio, latest)
            # Elo at the end of the window: the rating after the window's last fight, which
            # for every window is his current rating (windows all end at his latest fight).
            m['elo'] = round(final_elo[pid])
            q = QUALIFY[wkey]
            qualified = d['n'] >= q[0] and (d['min'] or 0) >= q[1] and div is not None
            first_date = sub[0]['date']
            w = dict(m={k: v for k, v in m.items() if v is not None}, d=d, sm=sm, rc=rc, div=div,
                     qualified=qualified, since=int(first_date[:4]), n=d['n'],
                     _id=pid, _name=name)
            entry['w'][wkey] = w
            if div:
                win_rows[wkey][div].append(w)
        out_f[pid] = entry

    attach_rankings(out_f, rankings)
    for wkey, _ in WINDOWS:
        add_comps(win_rows[wkey])
    for e in out_f.values():
        for w in e['w'].values():
            w.pop('_id', None); w.pop('_name', None)

    # upcoming cards, resolved to fighters we know
    up = {}
    upath = os.path.join(HERE, 'raw', 'upcoming.json')
    if os.path.exists(upath):
        raw_up = json.load(open(upath))
        cards = []
        for c in raw_up.get('cards', []):
            bouts = []
            for b in c.get('bouts', []):
                bouts.append(dict(id=b['id'], wc=b.get('wc', ''), div=division_of(b.get('wc')),
                                  f=[dict(id=x['id'], name=x['name'], known=x['id'] in out_f) for x in b['f']]))
            cards.append(dict(id=c['id'], name=c['name'], date=c.get('date'), location=c.get('location'), bouts=bouts))
        up = dict(generated=raw_up.get('generated'), cards=cards)

    cfg = dict(metrics=METRICS, panels=PANELS, groupLabel=GROUP_LABEL, headline=HEADLINE,
               weakDims=WEAK_DIMS, qualify={k: list(v) for k, v in QUALIFY.items()},
               denoms=DENOMS, windows=[list(w) for w in WINDOWS],
               divisions=[dict(key=k, label=l, sex=s) for k, l, _, s in DIVISIONS],
               activeMonths=ACTIVE_MONTHS, activeCut=active_cut, latest=latest,
               rankingsAt=rankings.get('fetched'))
    data = dict(generated=datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ'), cfg=cfg,
                fighters=out_f, upcoming=up,
                events={eid: dict(name=e['name'], date=e['date'], location=e.get('location', '')) for eid, e in events.items()})
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, 'ufc-savant-data.json')
    with open(p, 'w') as fh:
        json.dump(data, fh, separators=(',', ':'), ensure_ascii=False)
    print('wrote', p, f'{os.path.getsize(p)/1e6:.1f} MB', len(out_f), 'fighters')

    # per-fight detail for the fight view: totals and rounds, both men
    fd = {}
    for fid, f in fights.items():
        fd[fid] = dict(
            date=f['date'], ev=events.get(f['event'], {}).get('name', ''), wc=f.get('wc'), title=f.get('title'),
            method=f.get('method'), detail=f.get('detail'), rnd=f.get('round'), time=f.get('time'),
            fmt=f.get('fmt'), ref=f.get('ref'), bonus=f.get('bonus') or [], stats=f.get('stats'),
            f=[{k: v for k, v in x.items() if k != 'nick'} for x in f['f']],
        )
    p2 = os.path.join(a.out, 'ufc-savant-fights.json')
    with open(p2, 'w') as fh:
        json.dump(fd, fh, separators=(',', ':'), ensure_ascii=False)
    print('wrote', p2, f'{os.path.getsize(p2)/1e6:.1f} MB')

    # a few sanity lines
    qn = Counter()
    for e in out_f.values():
        for wk, w in e['w'].items():
            if w['qualified']:
                qn[wk] += 1
    print('qualified per window:', dict(qn))
    print('active fighters:', sum(1 for e in out_f.values() if e['active']))
    print('divisions (career):', Counter(e['w']['career']['div'] for e in out_f.values()).most_common())


if __name__ == '__main__':
    main()
