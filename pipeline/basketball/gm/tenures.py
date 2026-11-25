"""
tenures.py — nba.gm_tenures and the credit table: who held the basketball job at each team on
each day, 1979-80 on, with titles, dates, sources and a confidence, and how credit splits.

The spine is Basketball-Reference's executive pages (out/br_execs.json): for every person and
team-season, the games of that season he was in charge for. Dates come from three places, best
first:

  1. a dated front-office line (out/fo_events.json: ESPN's transactions from Nov 2000, and the
     handful Basketball-Reference's transaction pages carry) that names him at that team;
  2. the games: a handover after game k of N is pinned between those two game dates
     (out/games.json, the NBA's game log);
  3. the season boundary alone, when he arrived or left in an off-season no line dates.

Nothing is typed from memory. Every tenure carries the URLs it rests on.

Credit: every team-day's weights add to 1, split equally among the people in charge that day
(the default the spec sets). CREDIT_SPLITS holds a different split only where a source says who
decided; OWNER_FLAGS marks an owner reported to make basketball decisions (a flag, never a
weight). Both are empty until a source is in hand.

    python3 tenures.py            # -> out/gm_tenures.json, out/gm_credit.json, a summary
"""
import collections
import datetime as dt
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BR = 'https://www.basketball-reference.com'
BEFORE = set()

# One key per operating franchise: the team whose players, picks and front office carried on.
# Charlotte 1988-2002 is New Orleans' line here (the club that moved), not the 2004 expansion
# club's; checked against roster continuity in check_franchises().
FRANCHISE = {
    'ATL': 'ATL', 'BOS': 'BOS', 'NJN': 'BRK', 'BRK': 'BRK', 'BKN': 'BRK', 'NJ': 'BRK', 'CHI': 'CHI', 'CLE': 'CLE', 'DAL': 'DAL',
    'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW', 'GOS': 'GSW', 'GS': 'GSW', 'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'SDC': 'LAC',
    'LAL': 'LAL', 'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NYK': 'NYK', 'NY': 'NYK', 'ORL': 'ORL', 'PHI': 'PHI', 'PHL': 'PHI',
    'PHO': 'PHO', 'PHX': 'PHO', 'POR': 'POR', 'SAC': 'SAC', 'KCK': 'SAC', 'SAS': 'SAS', 'SAN': 'SAS', 'SA': 'SAS', 'UTA': 'UTA',
    'UTH': 'UTA', 'UTAH': 'UTA', 'WAS': 'WAS', 'WSB': 'WAS', 'WSH': 'WAS', 'SEA': 'OKC', 'OKC': 'OKC', 'VAN': 'MEM', 'MEM': 'MEM',
    'TOR': 'TOR', 'CHH': 'NOP', 'NOH': 'NOP', 'NOK': 'NOP', 'NOP': 'NOP', 'NO': 'NOP', 'CHO': 'CHO', 'NOJ': 'UTA', 'SDR': 'HOU', 'BUF': 'LAC', 'NOJ ': 'UTA',
}


def franchise(abbr, date=None):
    """CHA means the Bobcats/Hornets of 2004 on, except in ESPN's lines before July 2004, where it is
    the Charlotte Hornets that moved to New Orleans (Basketball-Reference calls those CHH)."""
    if abbr == 'CHA':
        return 'NOP' if date and date < '2004-07-01' else 'CHO'
    return FRANCHISE.get(abbr)


CREDIT_SPLITS = {}   # (franchise, season): {person_id: weight, 'source': [urls]}  -- only with a source
OWNER_FLAGS = {}     # (franchise, season): {'owner': name, 'source': [urls]}       -- a flag, not a weight


def season_label(y):
    return f'{y}-{str(y + 1)[2:]}'


def start_year(s):
    return int(s[:4])


def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z ]', '', s.replace('-', ' ')).strip()


def load():
    execs = json.load(open(os.path.join(OUT, 'br_execs.json')))
    games = json.load(open(os.path.join(OUT, 'games.json')))
    events = json.load(open(os.path.join(OUT, 'fo_events.json')))
    g = collections.defaultdict(dict)
    for s, teams in games.items():
        for ab, dates in teams.items():
            f = franchise(ab)
            if f:
                g[s][f] = dates
    return execs, g, events


# ----------------------------------------------------------------------------- the season spine
def team_seasons(execs, games):
    """{(franchise, season): [{'id','name','g','br_team'}]} for 1979-80 on."""
    ts = collections.defaultdict(list)
    for e in execs:
        for r in e['seasons']:
            if r.get('lg') not in (None, '', 'NBA') or start_year(r['season']) < 1979:
                continue
            f = franchise(r['team'])
            if not f:
                continue
            ts[(f, r['season'])].append({'id': e['id'], 'name': e['name'], 'g': r['g'], 'br_team': r['team'], 'url': e['url']})
    return ts


def segments(ts, games):
    """Place each person on the season's game line. Returns {(f, s): {'n': N, 'people': [...], 'flags': [...]}}
    with each person's [a, b) game interval and whether he arrived/left in the off-season before or after."""
    out = {}
    for (f, s), people in ts.items():
        dates = games.get(s, {}).get(f, [])
        n = len(dates)
        prev = {p['id'] for p in ts.get((f, season_label(start_year(s) - 1)), [])}
        nxt = {p['id'] for p in ts.get((f, season_label(start_year(s) + 1)), [])}
        flags, placed = [], []
        for p in people:
            q = dict(p, prev=p['id'] in prev, next=p['id'] in nxt)
            if n == 0:
                flags.append('no games for this team-season')
                q['a'] = q['b'] = 0
            elif p['g'] >= n or (len(people) == 1 and p['g'] >= n - 3):
                q['a'], q['b'] = 0, n                       # a lone executive 1-3 games short is the whole season (BR's count)
            elif p['g'] == 0:
                # in charge for none of the games: left before opening night, or arrived after the last game
                q['a'] = q['b'] = (0 if q['prev'] and not q['next'] else n)
            elif q['prev'] and not q['next']:
                q['a'], q['b'] = 0, p['g']                  # the incumbent ran the first games
            elif q['next'] and not q['prev']:
                q['a'], q['b'] = n - p['g'], n              # the newcomer ran the last games
            elif not q['prev'] and not q['next']:
                q['a'], q['b'] = None, None                 # an interim spell inside one season
            else:
                q['a'], q['b'] = 0, p['g']
                flags.append(f"{p['name']}: partial season but there before and after")
            placed.append(q)
        # interim spells: put them in the gap the others leave
        gap_people = [q for q in placed if q['a'] is None]
        if gap_people:
            cover = [0] * n
            for q in placed:
                if q['a'] is not None:
                    for i in range(q['a'], q['b']):
                        cover[i] += 1
            holes = [i for i in range(n) if cover[i] == 0]
            for q in sorted(gap_people, key=lambda q: -q['g']):
                twin = next((o for o in gap_people if o is not q and o['g'] == q['g'] and o['a'] is not None), None)
                if twin:
                    q['a'], q['b'] = twin['a'], twin['b']          # two interims in charge together
                elif holes and len(holes) >= q['g'] - 2:
                    k = min(q['g'], len(holes))                     # BR's counts overlap the handover game
                    q['a'], q['b'] = holes[0], holes[0] + k
                    holes = holes[k:]
                else:
                    q['a'], q['b'] = 0, 0
                    flags.append(f"{q['name']}: interim spell with no gap to sit in")
        cover = [0] * n
        for q in placed:
            for i in range(q['a'], q['b']):
                cover[i] += 1
        # a run of uncovered games between someone leaving and someone arriving is the handover window
        i = 0
        while n and i < n:
            if cover[i]:
                i += 1; continue
            j = i
            while j < n and not cover[j]:
                j += 1
            before = [q for q in placed if q['b'] == i and q['b'] > q['a']]
            after = [q for q in placed if q['a'] == j and q['b'] > q['a']]
            if before and after and j - i <= 12:
                for q in before:
                    q['b'] = j; q['gap_end'] = (i, j)
                for q in after:
                    q['a'] = i; q['gap_start'] = (i, j)
                for k in range(i, j):
                    cover[k] = len(before) + len(after)
                flags.append(f'handover window of {j - i} games (BR counts leave them to nobody)')
            else:
                flags.append(f'{j - i} games with nobody in charge')
            i = j
        out[(f, s)] = {'n': n, 'dates': dates, 'people': placed, 'cover': cover, 'flags': flags}
    return out


# ----------------------------------------------------------------------------- dated lines
def name_in(name, text):
    return norm(name) in norm(text)


def events_for(events, f, name, lo, hi, actions):
    hits = []
    for e in events:
        tf = franchise(e['team'], e.get('date')) if e.get('team') else None
        if tf is None and e.get('team_name') and e.get('date'):
            tf = team_by_name(e['team_name'], e['date'])
        if tf != f or not e.get('date') or not (lo <= e['date'] <= hi):
            continue
        if e['action'] in actions and name_in(name, e['text']):
            hits.append(e)
    return sorted(hits, key=lambda e: e['date'])


TEAMNAME = {}   # every team name Basketball-Reference's transaction pages link, -> franchise


def team_names():
    """From the links themselves: <a ... href="/teams/SEA/1999.html">Seattle SuperSonics</a>."""
    if TEAMNAME:
        return TEAMNAME
    import html as H
    import pagefacts
    for y, ab, nm in pagefacts.team_links():       # the transaction pages' team links, or their facts
        f = 'CHO' if ab == 'CHA' else franchise(ab)
        if f:
            TEAMNAME.setdefault(norm(H.unescape(nm)), {})[y] = f
    return TEAMNAME


def team_by_name(name, date):
    """A team name on a date -> franchise; 'Charlotte Hornets' is New Orleans' line before 2002 and Charlotte's from 2014."""
    yrs = team_names().get(norm(name))
    if not yrs:
        return None
    y = int(date[:4]) + (1 if date[5:7] >= '07' else 0)
    return yrs[min(yrs, key=lambda k: abs(k - y))]


def off_window(games, f, s, where):
    """The off-season around season s: 'before' = after last season's last game .. this season's first;
    'after' = this season's last game .. next season's first game (or today)."""
    d = games.get(s, {}).get(f, [])
    if where == 'before':
        pd = games.get(season_label(start_year(s) - 1), {}).get(f, [])
        return (pd[-1] if pd else f'{start_year(s)}-05-01'), (d[0] if d else f'{start_year(s)}-11-01')
    nd = games.get(season_label(start_year(s) + 1), {}).get(f, [])
    return (d[-1] if d else f'{start_year(s) + 1}-04-01'), (nd[0] if nd else dt.date.today().isoformat())


def build():
    execs, games, events = load()
    team_names()
    ts = team_seasons(execs, games)
    seg = segments(ts, games)
    global BEFORE
    BEFORE = {(e['id'], franchise(r['team'])) for e in execs for r in e['seasons'] if r['season'] == '1978-79'}

    # runs: consecutive seasons of one person at one franchise
    runs = collections.defaultdict(list)
    for (f, s), v in seg.items():
        for q in v['people']:
            runs[(q['id'], f)].append((s, q, v))
    tenures = []
    for (pid, f), rows in runs.items():
        rows.sort(key=lambda x: x[0])
        chunks, cur = [], [rows[0]]
        for r in rows[1:]:
            if start_year(r[0]) == start_year(cur[-1][0]) + 1:
                cur.append(r)
            else:
                chunks.append(cur); cur = [r]
        chunks.append(cur)
        for ch in chunks:
            tenures.append(apply_dates(place_tenure(pid, f, ch, games, events)))
    return tenures, seg, ts


def place_tenure(pid, f, ch, games, events):
    (s0, q0, v0), (s1, q1, v1) = ch[0], ch[-1]
    name, url = q0['name'], q0['url']
    t = {'tenure_id': f'{pid}:{f}:{s0[:4]}', 'person_id': pid, 'person': name, 'team': f, 'br_teams': sorted({c[1]['br_team'] for c in ch}),
         'first_season': s0, 'last_season': s1, 'seasons': [c[0] for c in ch], 'games': {c[0]: c[1]['g'] for c in ch},
         'sources': [url], 'title': None, 'notes': []}
    # ---- start
    d = v0['dates']
    if s0 == '1979-80' and (pid, f) in BEFORE and q0['a'] == 0:
        t['start'], t['start_precision'], t['notes'] = '1979-07-01', 'before coverage', ['in office before 1979-80; credit starts with the first season covered']
        return place_end(t, pid, f, ch, games, events)
    if q0['a'] is None or not d:
        lo, hi, prec = f'{s0[:4]}-07-01', f'{int(s0[:4]) + 1}-06-30', 'season'
    elif q0['a'] == 0 and q0['b'] > 0:
        lo, hi = off_window(games, f, s0, 'before'); prec = 'offseason'
    elif q0['a'] == q0['b'] == len(d):
        lo, hi = off_window(games, f, s0, 'after'); prec = 'offseason'
    elif q0.get('gap_start'):
        i, j = q0['gap_start']
        lo, hi, prec = d[max(i - 1, 0)], d[min(j, len(d) - 1)], 'games'
    else:
        lo, hi, prec = d[q0['a'] - 1], d[q0['a']], 'game'
    hits = events_for(events, f, name, shift(lo, -45), shift(hi, 45), {'hired', 'promoted', 'title'})
    hits = [e for e in hits if e['level'] == 'lead'] or hits        # the head job, not an adviser's line first
    if hits:
        e = hits[0]
        t['start'], t['start_precision'] = e['date'], 'day'
        t['title'] = e['title'] or None
        t['sources'].append(e['source'])
        t['start_line'] = e['text']
        if not (shift(lo, -45) <= e['date'] <= shift(hi, 45)):
            t['notes'].append('start line outside the games window')
    else:
        w = wiki_hits(name, f, lo, hi, 'start') if prec in ('offseason', 'season', 'games') else []
        if w:
            e = w[0]
            t['start'], t['start_precision'], t['start_line'] = e['date'], e['precision'], e['sentence']
            t['sources'] += e['refs'][:2] + [e['wiki']]
            if e['precision'] == 'month':
                t['start_window'] = [max(lo, e['date']), min(hi, e['date'][:8] + '28')]
        else:
            t['start'], t['start_precision'], t['start_window'] = hi, prec, [shift(lo, 1) if prec in ('game', 'games') else lo, hi]
    return place_end(t, pid, f, ch, games, events)


def apply_dates(t):
    """facts.DATES over the feeds: a sourced start or end near this tenure's ends wins."""
    import facts
    for (who, ff), rows in facts.DATES.items():
        if ff != t['team'] or norm(who) != norm(t['person']):
            continue
        for kind, d, src, says in rows:
            near_start = bool(d) and abs((dt.date.fromisoformat(d) - dt.date.fromisoformat(t['start'])).days) <= 250
            near_end = bool(d and t['end'] and abs((dt.date.fromisoformat(d) - dt.date.fromisoformat(t['end'])).days) <= 250)
            near_start = bool(d) and near_start
            if kind == 'start' and d and (near_start or abs((dt.date.fromisoformat(d) - dt.date.fromisoformat(t['start'])).days) <= 400):
                t['start'], t['start_precision'], t['start_line'] = d, 'day', says
                t.pop('start_window', None); t['sources'].append(src)
            elif kind == 'start_any' and d and d < t['start']:      # a sourced earlier start, however far (a coach-president under-listed by BR)
                t['start'], t['start_precision'], t['start_line'] = d, 'month', says
                t.pop('start_window', None); t['sources'].append(src)
            elif kind == 'extend' and (d is None or d >= t['start']):
                t['end'], t['end_precision'], t['end_line'] = d, 'day' if d else 'active', says
                t.pop('end_window', None); t['sources'].append(src)
            elif kind == 'end' and d and (near_end or (t['end'] is None and d >= t['start'])):
                t['end'], t['end_precision'], t['end_line'] = d, 'day', says
                t.pop('end_window', None); t['sources'].append(src)
    t['sources'] = sorted(set(t['sources']))
    return t


def place_end(t, pid, f, ch, games, events):
    (s1, q1, v1) = ch[-1]
    name = t['person']
    # ---- end
    d = v1['dates']
    active = start_year(s1) >= current_season_year() and q1['b'] == len(d)
    if active:
        t['end'], t['end_precision'] = None, 'active'
    else:
        if q1['a'] is None or not d:
            lo, hi, prec = f'{s1[:4]}-07-01', f'{int(s1[:4]) + 1}-06-30', 'season'
        elif q1['b'] == len(d):
            lo, hi = off_window(games, f, s1, 'after'); prec = 'offseason'
        elif q1['a'] == q1['b'] == 0:
            lo, hi = off_window(games, f, s1, 'before'); prec = 'offseason'
        elif q1.get('gap_end'):
            i, j = q1['gap_end']
            lo, hi, prec = d[max(i - 1, 0)], d[min(j, len(d) - 1)], 'games'
        else:
            lo, hi, prec = d[q1['b'] - 1], d[q1['b']], 'game'
        hits = events_for(events, f, name, shift(lo, -10), shift(hi, 10), {'fired', 'resigned', 'reassigned', 'title'})
        if hits:
            e = hits[-1]
            t['end'], t['end_precision'], t['end_line'] = e['date'], 'day', e['text']
            t['sources'].append(e['source'])
        else:
            w = wiki_hits(name, f, lo, hi, 'end') if prec in ('offseason', 'season', 'games') else []
            if w:
                e = w[0]
                t['end'], t['end_precision'], t['end_line'] = e['date'], e['precision'], e['sentence']
                t['sources'] += e['refs'][:2] + [e['wiki']]
                if e['precision'] == 'month':
                    t['end_window'] = [max(lo, e['date']), min(hi, e['date'][:8] + '28')]
            else:
                t['end'], t['end_precision'], t['end_window'] = lo, prec, [lo, shift(hi, -1) if prec in ('game', 'games') else hi]
    t['sources'] = sorted(set(t['sources']))
    return t


WIKI = None


def wiki_hits(name, f, lo, hi, kind):
    """Dated Wikipedia sentences (out/wiki_events.json) of this person, naming this franchise, inside [lo, hi]."""
    global WIKI
    if WIKI is None:
        p = os.path.join(OUT, 'wiki_events.json')
        WIKI = json.load(open(p)) if os.path.exists(p) else {}
    a = WIKI.get(name)
    if not a:
        return []
    words = {n.split()[-1] for n, yrs in team_names().items() if f in yrs.values() and len(n.split()) > 1}
    words = {('76ers' if w == 'ers' else 'Trail Blazers' if w == 'blazers' else w.title()) for w in words}
    out = []
    for e in a['events']:
        if e['kind'] != kind and not e.get('both'):
            continue
        if not any(w in e['sentence'] for w in words):
            continue
        d = e['date']
        inside = lo <= d <= hi if e['precision'] == 'day' else (lo[:7] <= d[:7] <= hi[:7])
        if inside:
            out.append(e)
    return sorted(out, key=lambda e: (e['precision'] != 'day', e['date']))


def shift(d, days):
    return (dt.date.fromisoformat(d) + dt.timedelta(days=days)).isoformat()


def current_season_year():
    t = dt.date.today()
    return t.year if t.month >= 9 else t.year - 1


if __name__ == '__main__':
    tenures, seg, ts = build()
    print('tenures', len(tenures), 'team-seasons', len(seg))
    print('start precision', collections.Counter(t['start_precision'] for t in tenures))
    print('end precision', collections.Counter(t['end_precision'] for t in tenures))
    fl = [(k, v['flags']) for k, v in seg.items() if v['flags']]
    print('team-seasons with flags', len(fl))
    for k, f in fl[:12]:
        print('  ', k, f)
    shared = [(k, [p['name'] for p in v['people'] if p['b'] > p['a']]) for k, v in seg.items() if v['n'] and max(v['cover']) > 1]
    print('team-seasons with two or more in charge at once', len(shared))
    json.dump(tenures, open(os.path.join(OUT, 'gm_tenures_draft.json'), 'w'), indent=0)
