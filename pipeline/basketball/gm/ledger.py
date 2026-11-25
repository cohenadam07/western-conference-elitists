"""
ledger.py — Module 2: the asset ledger. Every asset a team holds, from the day it arrives to the
day it leaves, 1979-80 on.

Backbone: Basketball-Reference's season transaction pages (the HTML itself: every team anchor says
whether it gives or receives, `data-attr-from` / `data-attr-to`; every player is a link with his
Basketball-Reference id), its draft pages, and its season totals (who played for whom). ESPN and
NBA.com are second sources in checks, not inputs.

Assets
  player:<br_id>                  a player's rights (draft rights, contract, two-way): one asset per
                                  player; its holder changes
  pick:<year>:<round>:<key>       a draft pick. key = the original owner where a note gives it
                                  ("2031 2nd-rd pick is SAC own"), else the player it became
                                  ("Mark Jackson was later selected"), else the team that first gave it
  cash:<tx>:<n>, cons:<tx>:<n>    cash, future/draft considerations: created by the giver, held by the receiver
  exception:<tx>:<n>              a trade exception named in a trade

Events (double entry): every movement has a from and a to. POOL is the free-agent pool (signings
come from it, waivers and releases go to it); RETIRED and DRAFT (where a pick becomes a player) are
the other non-team accounts. A trade is a set of legs; each item leaves exactly one team and arrives
at exactly one.

Lineage: in a trade, what a team received "came from" what it sent; at the draft a pick "became" the
player. That graph is the asset tree.

    python3 ledger.py            # -> out/ledger_*.json and a summary
"""
import collections
import datetime as dt
import html as H
import json
import os
import re

from fetch import get
from tenures import franchise, OUT, norm, shift
from br_tx import url as tx_url, iso, FIRST, LAST
from br_more import draft_url, totals

POOL, RETIRED, DRAFT = 'POOL', 'RETIRED', 'DRAFT'
PLAYER = r'<a href="/players/\w/(\w+)\.html">([^<]+)</a>'
PICK = re.compile(r'a (\d{4}|future) (?:(\d)(?:st|nd|rd|th) round )?draft pick(?: \(' + PLAYER + r' was later selected\))?')
NOTE = re.compile(r'(?:Conditional )?(\d{4}) (1st|2nd)-rd pick (?:is )?(.*?)(?=\s*(?:Conditional )?\d{4} (?:1st|2nd)-rd pick |$)')


def fr(ab, date):
    return 'CHO' if ab == 'CHA' else franchise(ab, date)


# ----------------------------------------------------------------------------- parsing
ASOF = os.environ.get('GM_ASOF')          # replay: the ledger as it could be built on this day (sources up to it)


def held():
    """Basketball-Reference paragraphs held back because no second source has confirmed them yet (gm_update.py)."""
    p = os.path.join(OUT, 'ledger_hold.json')
    return set(json.load(open(p))) if os.path.exists(p) else set()


def para_key(p):
    import hashlib
    return hashlib.sha1(f"{p['date']}|{p['text']}".encode()).hexdigest()[:16]


def paragraphs():
    """Every transaction paragraph, in page order, with its HTML. With GM_ASOF, only those dated up to it; paragraphs
    in ledger_hold.json (unconfirmed) are left out until a second source agrees."""
    import pagefacts
    out = []
    hold = held()
    for y in range(FIRST, LAST + 1):
        for row in pagefacts.tx_rows(y) or []:       # the page when it is here, else its parsed facts (the cloud)
            if ASOF and row['date'] and row['date'] > ASOF:
                continue
            if para_key(row) in hold:
                continue
            out.append(row)
    out.sort(key=lambda r: (r['date'] or '', r['season_end'], r['n']))
    return out


def items_of(seg, date):
    """The things one side sends, in order: players, picks, cash, considerations, exceptions."""
    items = []
    spans = []
    for m in PICK.finditer(seg):
        spans.append((m.start(), m.end()))
        items.append({'kind': 'pick', 'year': int(m.group(1)) if m.group(1).isdigit() else int(date[:4]) + 2, 'year_unknown': not m.group(1).isdigit(), 'round': int(m.group(2)) if m.group(2) else None, 'became': m.group(3), 'became_name': m.group(4), 'pos': m.start()})
    for m in re.finditer(PLAYER, seg):
        if any(a <= m.start() < b for a, b in spans):
            continue
        pre = seg[max(0, m.start() - 40):m.start()]
        items.append({'kind': 'player', 'id': m.group(1), 'name': H.unescape(m.group(2)), 'rights': bool(re.search(r'rights to $', pre)), 'pos': m.start()})
    for m in re.finditer(r'<a href="/(?:coaches|executives)/(\w+)\.html">([^<]+)</a>', seg):
        items.append({'kind': 'staff', 'id': m.group(1), 'name': H.unescape(m.group(2)), 'pos': m.start()})
    plain = re.sub(r'<[^>]+>', '', seg)
    for m in re.finditer(r'(\$[\d\.]+[KM]? )?cash', plain):
        items.append({'kind': 'cash', 'amount': (m.group(1) or '').strip() or None, 'pos': 10 ** 6 + m.start()})
    for m in re.finditer(r'(future|draft) considerations', plain):
        items.append({'kind': 'cons', 'what': m.group(0), 'pos': 10 ** 6 + m.start()})
    for m in re.finditer(r'trade exception', plain):
        items.append({'kind': 'exception', 'pos': 10 ** 6 + m.start()})
    return sorted(items, key=lambda x: x['pos'])


def parse_trade(p):
    h = p['html']
    notes = [{'year': int(a), 'round': {'1st': 1, '2nd': 2}[b], 'note': re.split(r'(?<=[a-z\)])\.?\s+(?=(?:[A-Z][a-z]+ ){0,3}(?:received|Pick would|Conditional))', c.strip())[0]} for a, b, c in NOTE.findall(p['text'])]
    rescinded = re.search(r'Trade rescinded ([A-Z][a-z]+ \d{1,2}, \d{4})', p['text'])
    body = re.split(r'\.\s+(?=(?:Conditional )?\d{4} (?:1st|2nd)-rd)', h, maxsplit=1)[0] if notes else h
    legs = []
    for clause in re.split(r';\s*(?:and\s+)?(?=the <a)', body):
        a = re.search(r'data-attr-from="([A-Z]{3})"', clause)
        b = re.search(r'data-attr-to="([A-Z]{3})"', clause)
        if not a or not b:
            continue
        mid = clause[a.end():b.start()]
        mid = mid[mid.find('traded') + 6:] if 'traded' in mid else mid
        legs.append({'from': fr(a.group(1), p['date']), 'to': fr(b.group(1), p['date']), 'items': items_of(mid, p['date'])})
        close = clause.find('</a>', b.end())
        tail = clause[close + 4:] if close >= 0 else ''
        if tail.lstrip().startswith('for ') and len(re.findall(r'data-attr-', clause)) == 2:
            back = tail.split('for ', 1)[1]
            legs.append({'from': fr(b.group(1), p['date']), 'to': fr(a.group(1), p['date']), 'items': items_of(back, p['date'])})
    # notes attach to the picks in order of (year, round)
    picks = [it for lg in legs for it in lg['items'] if it['kind'] == 'pick']
    used = set()
    for it in picks:
        for k, nt in enumerate(notes):
            if k not in used and nt['year'] == it['year'] and (it['round'] in (None, nt['round'])):
                it['note'], it['round'] = nt['note'], it['round'] or nt['round']
                used.add(k)
                break
    return {'kind': 'trade', 'legs': legs, 'rescinded': iso(rescinded.group(1))[0] if rescinded else None, 'notes': notes}


KINDS = [  # (pattern on the text, kind)
    (r' traded ', 'trade'), (r' claimed .* on waivers', 'claim'), (r' waived ', 'waive'), (r' released ', 'release'),
    (r' converted .* from a two-way', 'convert'), (r' signed .* contract extension', 'extend'), (r' re-signed ', 'resign'),
    (r' signed ', 'sign'), (r' drafted .* expansion draft', 'expansion'), (r' sold the (?:player|draft) rights', 'sale'),
    (r'(?:announced retirement|retired from|retired\.)', 'retire'), (r' (?:assigned|recalled) ', 'gleague'),
    (r' (?:hired|fired|appointed|named|promoted|reassigned|resigned as|stepped down)', 'staff'), (r'suspended', 'suspension'),
]


def parse(p):
    if 'html' not in p and 'parsed' in p:         # from the facts: parsed on the Mac by this same function
        import copy
        return copy.deepcopy(p['parsed'])
    kind = next((k for pat, k in KINDS if re.search(pat, p['text'])), 'other')
    r = {'date': p['date'], 'approx': p['approx'], 'season_end': p['season_end'], 'n': p['n'], 'kind': kind, 'text': p['text'], 'source': p['source']}
    if kind == 'trade':
        r.update(parse_trade(p))
        return r
    pl = re.findall(PLAYER, p['html'])
    a = re.search(r'data-attr-from="([A-Z]{3})"', p['html'])
    b = re.search(r'data-attr-to="([A-Z]{3})"', p['html'])
    r['players'] = [{'id': i, 'name': H.unescape(n)} for i, n in pl]
    r['from'] = fr(a.group(1), p['date']) if a else None
    r['to'] = fr(b.group(1), p['date']) if b else None
    if kind == 'sign':
        t = p['text']
        r['contract'] = ('two-way' if 'two-way' in t else '10-day' if '10-day' in t else 'exhibit 10' if 'Exhibit 10' in t
                         else 'multi-year' if 'multi-year' in t else 'rest of season' if 'rest of the season' in t else 'free agent' if 'free agent' in t else 'contract')
    return r


# ----------------------------------------------------------------------------- drafts and rosters
def drafts():
    """{year: {'date', 'picks': [(round, overall, franchise, br_id, name)]}} from the draft pages, or their facts."""
    import pagefacts
    if not pagefacts.ONLY:
        out = _drafts_from_pages()
        if out:
            return out
    out = {}
    for y, d in (pagefacts.load('drafts') or {}).items():
        if ASOF and d['date'] > ASOF:
            continue
        out[int(y)] = {'date': d['date'], 'picks': [tuple(r) for r in d['picks']]}
    return out


def _drafts_from_pages():
    out = {}
    for y in range(1979, 2027):
        c, b = get(draft_url(y), offline=True)
        if c != 200:
            continue
        t = b.decode()
        body = t[t.find('<tbody'):t.rfind('</tbody>')]
        rows, rnd = [], 1
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
            m = re.search(r'>Round (\d)<', tr)
            if m:
                rnd = int(m.group(1))
                continue
            pk = re.search(r'data-stat="pick_overall"[^>]*>(?:<a[^>]*>)?(\d+)', tr)
            tm = re.search(r'data-stat="team_id"[^>]*>(?:<a[^>]*>)?([A-Z]{3})', tr)
            pl = re.search(r'data-stat="player"[^>]*>(?:<a href=[\'"]/players/\w/(\w+)\.html[\'"]>)?([^<]+)', tr)
            if pk and tm and pl:
                rows.append((rnd, int(pk.group(1)), fr(tm.group(1), f'{y}-06-15'), pl.group(1), H.unescape(pl.group(2))))
        d = re.search(r'<strong>Date</strong>:\s*(?:[A-Z][a-z]+, )?([A-Z][a-z]+ \d{1,2}, \d{4})', t)
        date = iso(d.group(1))[0] if d else f'{y}-06-25'
        if ASOF and date > ASOF:
            continue
        out[y] = {'date': date, 'picks': rows}
    return out


def rosters():
    """{(franchise, season_end): {br_id: name}} — everyone who played for the team that season."""
    import pagefacts
    out = collections.defaultdict(dict)
    for y in range(FIRST, LAST + 1):
        for pid, tm, mp, nm in pagefacts.totals_rows(y) or []:
            if not re.match(r'TOT|\dTM', tm):
                f = fr(tm, f'{y - 1}-12-01')
                if f:
                    out[(f, y)][pid] = H.unescape(nm) if nm else pid
    return out


def same_day(e):
    """Events in date order; on one day, the 1979 opening balance first, then a player's draft (his rights exist before
    anyone trades them that night), then everything else in the order it was booked."""
    return (e['date'], 0 if e['kind'] == 'opening' else 1 if e['kind'] == 'drafted' else 2)


# ----------------------------------------------------------------------------- the engine
class Ledger:
    def __init__(self):
        self.holder = {}          # asset -> account
        self.assets = {}          # asset -> {'kind', 'created', 'origin', ...}
        self.events = []
        self.edges = []           # (from_asset, to_asset, tx, how)
        self.gaps = collections.Counter()
        self.gap_rows = []
        self.picks_by = collections.defaultdict(list)    # (year, round) -> [asset ids]
        self.repairs = []
        self.last_team, self.last_kind = {}, {}

    def asset(self, aid, **kw):
        if aid not in self.assets:
            self.assets[aid] = dict(kw, id=aid)
        return self.assets[aid]

    def move(self, aid, frm, to, date, tx, kind, src, check=True):
        held = self.holder.get(aid)
        if check and frm not in (POOL, DRAFT) and held != frm:
            # the giver did not hold it on our books: a gap in the history before this event
            why = 'never seen' if held is None else f'held by {held}'
            self.gaps[(kind, why)] += 1
            self.gap_rows.append({'asset': aid, 'date': date, 'kind': kind, 'expected': frm, 'held': held, 'tx': tx})
            if held is not None and held != frm:
                self.events.append({'asset': aid, 'date': date, 'from': held, 'to': frm, 'kind': 'repair', 'tx': tx, 'source': src})
            last = next((e['date'] for e in reversed(self.events) if e['asset'] == aid and e['kind'] != 'repair'), None)
            self.repairs.append({'asset': aid, 'tx': tx, 'date': date, 'kind': kind, 'type': 'repair (held elsewhere on our books)' if held is not None else 'origin unknown (never seen before)',
                                 'books_holder': held, 'giver': frm, 'uncertain_from': last or '1979-07-01', 'uncertain_to': date,
                                 'rule': 'any decision in this transaction, or about this asset by either team between uncertain_from and uncertain_to, grades low confidence'})
        self.holder[aid] = to
        if to not in (POOL, RETIRED, DRAFT):
            self.last_team[aid] = to
            self.last_kind[aid] = kind
        self.events.append({'asset': aid, 'date': date, 'from': frm, 'to': to, 'kind': kind, 'tx': tx, 'source': src})

    # picks: find the asset a trade means
    def pick_asset(self, it, giver, date, receiver=None):
        y, r = it['year'], it['round']
        orig = None
        if it.get('note'):
            m = re.match(r'([A-Z]{3}) own', it['note'])
            orig = fr(m.group(1), date) if m else None
        if it.get('became'):
            aid = f'pick:{y}:{r}:p={it["became"]}'
        elif orig:
            aid = f'pick:{y}:{r}:{orig}'
        else:
            held = [a for a in self.picks_by[(y, r)] if self.holder.get(a) == giver and not self.assets[a].get('resolved')]
            # the source names neither the player it became nor its original owner, and the giver holds more than one
            # such pick: the one the receiver goes on to trade or use (2024: OKC's unnamed 1st to DAL, which DAL sent
            # to WAS as the Dillon Jones pick, not the Topic pick OKC kept)
            if len(held) > 1 and receiver:
                later = {b for d_, b in self.future.get((receiver, y, r), []) if d_ >= date}
                held.sort(key=lambda a: 0 if self.assets[a].get('became') in later else 1)
            aid = held[0] if held else f'pick:{y}:{r}:{giver}'
        a = self.asset(aid, kind='pick', year=y, round=r, original_owner=orig, became=it.get('became'), notes=[])
        # every note and the original owner carry the date a source first said them, so an at-the-time grade reads only
        # what was known on its day (a 2026 trade's "was HOU own" must not reach the 2019 trade of the same pick)
        if it.get('note') and it['note'] not in a['notes']:
            a['notes'].append(it['note'])
            a.setdefault('notes_dated', []).append([date, it['note']])
        if orig and not a.get('original_owner'):
            a['original_owner'] = orig
        if a.get('original_owner') and not a.get('owner_known'):
            a['owner_known'] = date
        if aid not in self.picks_by[(y, r)]:
            self.picks_by[(y, r)].append(aid)
        if aid not in self.holder:
            self.holder[aid] = (a.get('original_owner') or giver)
        return aid


def moves_of(p):
    """(asset, giver, receiver) for the players and named picks an event moves: enough to order a day."""
    out = []
    if p['kind'] == 'trade':
        for lg in p.get('legs', []):
            for it in lg['items']:
                if it['kind'] == 'player':
                    out.append((f"player:{it['id']}", lg['from'], lg['to']))
                elif it['kind'] == 'pick' and it.get('became'):
                    out.append((f"pick:{it['year']}:{it['round']}:p={it['became']}", lg['from'], lg['to']))
                elif it['kind'] == 'pick' and it.get('year'):
                    out.append((f"pick:{it['year']}:{it['round']}:*", lg['from'], lg['to']))      # unnamed: any such pick
    elif p['kind'] in ('waive', 'release') and p.get('players'):
        out.append((f"player:{p['players'][0]['id']}", p.get('from'), POOL))
    elif p['kind'] in ('sign', 'claim') and p.get('players'):
        out.append((f"player:{p['players'][0]['id']}", POOL, p.get('to')))
    elif p['kind'] in ('expansion', 'sale') and p.get('players'):
        out.append((f"player:{p['players'][0]['id']}", p.get('from'), p.get('to')))
    return out


def same_day_order(timeline):
    """Within one date and phase, put an event after the one that hands its giver the asset."""
    out, i = [], 0
    while i < len(timeline):
        j = i
        while j < len(timeline) and timeline[j][:2] == timeline[i][:2]:
            j += 1
        group = timeline[i:j]
        if len(group) > 1:
            arrive = collections.defaultdict(set)
            for k, g in enumerate(group):
                for a, frm, to in moves_of(g[3]):
                    arrive[(a, to)].add(k)
            order, placed = [], set()
            visiting = set()
            def place(k):
                if k in placed or k in visiting:
                    return
                visiting.add(k)
                for a, frm, to in moves_of(group[k][3]):
                    if frm in (POOL, None):
                        continue                      # a signing never waits for a waiver
                    deps = set(arrive.get((a, frm), ()))
                    if a.startswith('pick:') and ':p=' in a:   # a named pick also waits for an unnamed one of its year
                        deps |= arrive.get((a.split(':p=')[0] + ':*', frm), set())
                    for dep in deps:
                        if dep != k:
                            place(dep)
                placed.add(k)
                order.append(k)
            for k in range(len(group)):
                place(k)
            group = [group[k] for k in order]
        out += group
        i = j
    return out


NBAID = {1610612737: 'ATL', 1610612738: 'BOS', 1610612739: 'CLE', 1610612740: 'NOP', 1610612741: 'CHI', 1610612742: 'DAL', 1610612743: 'DEN', 1610612744: 'GSW', 1610612745: 'HOU',
         1610612746: 'LAC', 1610612747: 'LAL', 1610612748: 'MIA', 1610612749: 'MIL', 1610612750: 'MIN', 1610612751: 'BRK', 1610612752: 'NYK', 1610612753: 'ORL', 1610612754: 'IND',
         1610612755: 'PHI', 1610612756: 'PHO', 1610612757: 'POR', 1610612758: 'SAC', 1610612759: 'SAS', 1610612760: 'OKC', 1610612761: 'TOR', 1610612762: 'UTA', 1610612763: 'MEM',
         1610612764: 'WAS', 1610612765: 'DET', 1610612766: 'CHO'}
NBA_FEED = 'https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json'


def pname(n):
    return ' '.join(w for w in norm(n).split() if w not in ('jr', 'sr', 'ii', 'iii', 'iv'))


def nba_supplement(P):
    """NBA.com trades (July 2015 on) Basketball-Reference lacks. One counts only when ESPN also has it
    (a line naming the player at either team within 3 days); the rest are listed, not applied."""
    import pagefacts
    feed = pagefacts.nba_rows()
    if feed is None:
        return [], []
    rows = [r for r in feed if r['Transaction_Type'] == 'Trade' and r['PLAYER_ID'] and (not ASOF or r['TRANSACTION_DATE'][:10] <= ASOF)]
    espn = [e for e in json.load(open(os.path.join(OUT, 'espn_tx.json'))) if not ASOF or e['date'] <= ASOF]
    br_names = collections.defaultdict(set)
    ids = {}
    for p in P:
        for pl in p.get('players', []) or [it for lg in p.get('legs', []) for it in lg['items'] if it['kind'] == 'player']:
            ids.setdefault(pname(pl['name']), pl['id'])
            if p['kind'] == 'trade' and p['date']:
                br_names[pname(pl['name'])].add(p['date'])
    groups = collections.defaultdict(list)
    for r in rows:
        groups[r['GroupSort']].append(r)
    add, unconfirmed = [], []
    for g, rs in groups.items():
        d = rs[0]['TRANSACTION_DATE'][:10]
        legs = collections.defaultdict(list)
        for r in rs:
            m = re.match(r'(.+?) received (?:(?:guard|forward|center|guard-forward|forward-guard|forward-center|center-forward) )?(.+?) from (.+?)\.?$', r['TRANSACTION_DESCRIPTION'])
            if not m:
                continue
            to, frm = NBAID.get(int(r['TEAM_ID'])), NBAID.get(int(r['Additional_Sort'] or 0))
            if to and frm:
                legs[(frm, to)].append(m.group(2))
        names = [n for v in legs.values() for n in v]
        # covered when any of its players is in a Basketball-Reference trade within a week (spellings differ: Pöltl / Poeltl)
        if not names or any(any(abs((dt.date.fromisoformat(x) - dt.date.fromisoformat(d)).days) <= 7 for x in br_names.get(pname(n), ())) for n in names):
            continue
        ok = all(any(pname(n) in pname(e['text']) and abs((dt.date.fromisoformat(e['date']) - dt.date.fromisoformat(d)).days) <= 3 for e in espn) for n in names)
        rec = {'kind': 'trade', 'date': d, 'approx': False, 'season_end': int(d[:4]) + (1 if d[5:7] >= '07' else 0), 'n': 0, 'notes': [], 'rescinded': None,
               'legs': [{'from': f, 'to': t, 'items': [{'kind': 'player', 'id': ids.get(pname(n), 'nba:' + pname(n).replace(' ', '')), 'name': n, 'rights': False, 'pos': 0} for n in v]} for (f, t), v in legs.items()],
               'text': '; '.join(f'{t} received {", ".join(v)} from {f}' for (f, t), v in legs.items()), 'source': NBA_FEED + ' (confirmed by ESPN)' if ok else NBA_FEED}
        (add if ok else unconfirmed).append(rec)
    return add, unconfirmed


def press_trades(P):
    """facts.PRESS_TRADES as trade records: players resolved to Basketball-Reference ids by name."""
    import facts
    ids = {}
    for p in P:
        for pl in p.get('players', []) or [it for lg in p.get('legs', []) for it in lg['items'] if it['kind'] == 'player']:
            ids.setdefault(pname(pl['name']), pl['id'])
    out = []
    for k, t in enumerate(facts.PRESS_TRADES):
        if ASOF and min(t['agreed'] or t['official'], t['official']) > ASOF:
            continue                                   # an as-of build knows only the press of its day
        legs = []
        for frm, to, items in t['legs']:
            its = []
            for it in items:
                if it[0] == 'player':
                    its.append({'kind': 'player', 'id': it[2] or ids.get(pname(it[1]), 'nba:' + pname(it[1]).replace(' ', '')), 'name': it[1], 'rights': False, 'pos': 0})
                elif it[0] == 'pick':
                    its.append({'kind': 'pick', 'year': it[1], 'round': it[2], 'became': it[5] if len(it) > 5 else None,
                                'note': (f'{it[3]} own' if it[3] else '') + (f'; {it[4]}' if it[4] else ''), 'year_unknown': it[1] is None, 'pos': 0})
                elif it[0] == 'swap':
                    its.append({'kind': 'swap', 'year': it[1], 'round': it[2], 'teams': list(it[3]), 'pos': 0})
                else:
                    its.append({'kind': 'cash', 'amount': None, 'pos': 0})
            legs.append({'from': frm, 'to': to, 'items': its})
        out.append({'kind': 'trade', 'date': t['official'], 'agreed': t['agreed'], 'approx': False, 'season_end': int(t['official'][:4]) + (1 if t['official'][5:7] >= '07' else 0),
                    'n': 900 + k, 'legs': legs, 'notes': [], 'rescinded': None, 'text': t['says'], 'source': ' '.join(t['sources']), 'press': True})
    return out


def swaps_in(p):
    """Turn swap rights into swap items: a pick whose note says it is a right to swap, and Basketball-Reference's
    habit of listing a swap as two picks changing hands ("BOS got 2017 #1 overall pick from BRK as result of pick swap")."""
    if p['kind'] != 'trade':
        return
    for lg in p['legs']:
        for it in lg['items']:
            if it['kind'] == 'pick' and re.search(r'right to swap|swap rights|option to swap', it.get('note') or '', re.I):
                it.update(kind='swap', teams=[lg['from'], lg['to']])
    m = re.search(r'\((\w{3}) got (\d{4}) #\d+ overall pick from (\w{3}) as result of pick swap\)', p['text'])
    if m:
        got, y, frm = fr(m.group(1), p['date']), int(m.group(2)), fr(m.group(3), p['date'])
        a = next((it for lg in p['legs'] if lg['from'] == frm and lg['to'] == got for it in lg['items'] if it['kind'] == 'pick' and it['year'] == y), None)
        b = next((it for lg in p['legs'] if lg['from'] == got and lg['to'] == frm for it in lg['items'] if it['kind'] == 'pick' and it['year'] == y), None)
        if a and b:
            for lg in p['legs']:
                lg['items'] = [it for it in lg['items'] if it is not b]
            a.update(kind='swap', teams=[frm, got], picks={frm: a['became'], got: b['became']}, round=a['round'] or b['round'],
                     resolved_note=m.group(0))


def build():
    import facts
    L = Ledger()
    P = [parse(p) for p in paragraphs()]
    # what each team later gives or uses, by pick (for an unnamed pick, pick_asset): picks it trades with the player
    # they became, and the picks it selects with
    L.future = collections.defaultdict(list)
    for p in P:
        for lg in p.get('legs', []) if p['kind'] == 'trade' else []:
            for it in lg['items']:
                if it['kind'] == 'pick' and it.get('became') and p['date']:
                    L.future[(fr(lg['from'], p['date']) if lg['from'] else None, it['year'], it['round'])].append((p['date'], it['became']))
    for y_, d_ in drafts().items():
        for rnd, ov, team, br, name in d_['picks']:
            if br:
                L.future[(team, y_, rnd)].append((d_['date'], br))
    # moves a source dates on a transaction they were not part of (facts.DEFERRED): taken out of it here, booked
    # on their own date by press_trades
    DEFER = {(d['on'], d['became']) for d in facts.DEFERRED}
    press = press_trades(P)
    for p in P:
        swaps_in(p)
        if p['kind'] == 'trade':
            for o in facts.OFFICIAL_LATER:
                if p['date'] == o['br_date'] and all(n in p['text'] for n in o['players'][:2]):
                    p['agreed'], p['date'], p['official_source'] = p['date'], o['official'], o['source']
    extra, L.unconfirmed = nba_supplement(P + press)
    P += press + extra
    D = drafts()
    R = rosters()
    # opening balance: who held whom on July 1, 1979 = 1979-80's first team for each player
    first_team = {}
    for (f, y), ppl in sorted(R.items(), key=lambda x: x[0][1]):
        if y == 1980:
            for pid in ppl:
                first_team.setdefault(pid, set()).add(f)
    # the timeline: transactions plus each draft
    selected = {(y, pid): team for y, d in D.items() for rnd, ov, team, pid, nm in d['picks'] if pid}
    ddate = {y: d['date'] for y, d in D.items()}
    timeline = []
    for i, p in enumerate(P):
        date = p['date'] or f"{p['season_end'] - 1}-07-01"
        phase = 2
        if p['kind'] == 'trade':
            yrs = {it['year'] for lg in p['legs'] for it in lg['items'] if it['kind'] == 'pick' and it.get('became')}
            for y in yrs:
                dd = ddate.get(y)
                if not dd:
                    continue
                if date == dd:
                    phase = 0                          # a pick traded on draft day: before the selection
                elif dd < date <= shift(dd, 75) and any(it['kind'] == 'pick' and it.get('became') and selected.get((y, it['became'])) == lg['to']
                                                       for lg in p['legs'] for it in lg['items']):
                    # agreed before the pick (the draft page shows the receiver making it), official later:
                    # assets move on the official date; the "at the time" grade uses the draft day
                    p['agreed'], p['agreed_basis'] = dd, 'the draft page shows the receiving team making the selection'
        timeline.append((date, phase, i, p))
    for y, d in D.items():
        timeline.append((d['date'], 1, y, {'kind': 'draft', 'year': y, 'picks': d['picks'], 'date': d['date'], 'source': draft_url(y)}))
    later_official = {(it['year'], it['became']) for _, _, _, p in timeline if p.get('agreed_basis') for lg in p['legs'] for it in lg['items'] if it['kind'] == 'pick' and it.get('became')}
    # swaps exercised once the season's order is set (the day after the last regular-season game)
    G = json.load(open(os.path.join(OUT, 'games.json')))
    season_end = {int(s[:4]) + 1: m for s, v in G.items() for m in [max((d for ds in v.values() for d in ds), default=None)] if m}
    if ASOF:                       # a season still being played on the as-of day has no end yet
        season_end = {y: m for y, m in season_end.items() if m < ASOF}
    for i, p in enumerate(P):
        if p['kind'] != 'trade':
            continue
        for lg in p['legs']:
            for it in lg['items']:
                if it['kind'] == 'swap' and it.get('year') and it.get('picks') and it['year'] in season_end:
                    timeline.append((shift(season_end[it['year']], 1), 0, 10 ** 6 + i, {'kind': 'swap_exercise', 'date': shift(season_end[it['year']], 1), 'item': it, 'source': p['source'], 'text': it.get('resolved_note')}))
    # other swap rights (2020 on): resolved after the season from the slots each team originally owned
    wp = os.path.join(OUT, 'wiki_drafts.json')
    W = {int(k): v for k, v in json.load(open(wp)).items()} if os.path.exists(wp) else {}
    for i, p in enumerate(P):
        if p['kind'] != 'trade':
            continue
        date = p['date'] or f"{p['season_end'] - 1}-07-01"
        for j, lg in enumerate(p['legs']):
            for n, it in enumerate(lg['items']):
                if it['kind'] == 'swap' and not it.get('picks') and it.get('year') and it['year'] in season_end and it['year'] in D:
                    timeline.append((shift(season_end[it['year']], 1), 0, 2 * 10 ** 6 + i, {'kind': 'swap_resolve', 'date': shift(season_end[it['year']], 1), 'item': it,
                                     'aid': f"swap:{it['year']}:{it.get('round')}:{'/'.join(it['teams'])}:tx:{date}:{i}", 'source': W[it['year']]['url']}))
    timeline.sort(key=lambda x: (x[0], x[1], x[2]))
    timeline = same_day_order(timeline)
    counts = collections.Counter()
    tx_rows = []
    for date, _, i, p in timeline:
        tx = f'tx:{date}:{i}' if p['kind'] != 'draft' else f'draft:{p["year"]}'
        counts[(p['kind'], int(date[:4]) + (1 if date[5:7] >= '07' else 0))] += 1
        k = p['kind']
        if k == 'trade':
            legs = p['legs']
            if not legs:
                L.gaps[('trade', 'not parsed')] += 1
                L.gap_rows.append({'tx': tx, 'kind': 'trade not parsed', 'date': date, 'text': p['text'][:200]})
                continue
            sent = collections.defaultdict(list); got = collections.defaultdict(list)
            for j, lg in enumerate(legs):
                for n, it in enumerate(lg['items']):
                    if it['kind'] == 'player':
                        aid = f'player:{it["id"]}'
                        L.asset(aid, kind='player', name=it['name'])
                        if aid not in L.holder and date < '1980-07-01' and lg['from'] in first_team.get(it['id'], ()):
                            L.holder[aid] = lg['from']; L.events.append({'asset': aid, 'date': '1979-07-01', 'from': 'OPENING', 'to': lg['from'], 'kind': 'opening', 'tx': None, 'source': 'opening balance'})
                    elif it['kind'] == 'swap':
                        aid = f"swap:{it.get('year') or '?'}:{it.get('round')}:{'/'.join(it['teams'])}:{tx}"
                        L.asset(aid, kind='swap', year=it.get('year'), round=it.get('round'), teams=it['teams'], picks=it.get('picks'), note=it.get('resolved_note'))
                        L.holder.setdefault(aid, lg['from'])
                    elif it['kind'] == 'pick' and it.get('year_unknown'):
                        aid = f"pick:?:{it['round']}:{lg['from']}:{tx}"
                        L.asset(aid, kind='pick', year=None, round=it['round'], original_owner=lg['from'], notes=[it.get('note') or 'year not stated by the source'])
                        L.holder.setdefault(aid, lg['from'])
                    elif it['kind'] == 'pick' and it.get('became') and L.assets.get(f"pick:{it['year']}:{it['round']}:p={it['became']}", {}).get('resolved'):
                        aid = f"player:{it['became']}"     # the pick was already used: its player's rights move
                        L.asset(aid, kind='player', name=it.get('became_name'))
                    elif it['kind'] == 'pick' and (date, it.get('became')) in DEFER:
                        continue
                    elif it['kind'] == 'pick':
                        aid = L.pick_asset(it, lg['from'], date, lg['to'])
                    elif it['kind'] == 'staff':
                        aid = f'staff:{it["id"]}'
                        L.asset(aid, kind='staff', name=it['name'])
                        L.holder.setdefault(aid, lg['from'])
                    else:
                        aid = f'{it["kind"]}:{tx}:{j}.{n}'
                        L.asset(aid, kind=it['kind'], amount=it.get('amount'), what=it.get('what'))
                        L.holder[aid] = lg['from']
                    L.move(aid, lg['from'], lg['to'], date, tx, 'trade', p['source'])
                    sent[lg['from']].append(aid); got[lg['to']].append(aid)
            for team in got:
                for a in sent.get(team, []):
                    for b in got[team]:
                        L.edges.append((a, b, tx, 'traded for'))
            if p.get('rescinded'):
                for j, lg in enumerate(legs):
                    for e in [e for e in L.events if e['tx'] == tx and e['kind'] == 'trade' and e['to'] == lg['to']]:
                        L.move(e['asset'], e['to'], e['from'], p['rescinded'], tx + ':rescinded', 'rescinded', p['source'])
            tx_rows.append({'tx': tx, 'date': date, 'agreed': p.get('agreed') or date, 'agreed_basis': p.get('agreed_basis') or ('press' if p.get('press') else 'same as official (no earlier agreement found)'),
                            'kind': 'trade', 'legs': [{'from': lg['from'], 'to': lg['to'], 'n': len(lg['items'])} for lg in legs], 'text': p['text'], 'source': p['source'], 'rescinded': p.get('rescinded')})
        elif k == 'swap_resolve':
            it, sw = p['item'], p['aid']
            y, r = it['year'], it.get('round') or 1
            A_, B_ = it['teams']                      # A owes the swap; B (or whoever holds the right now) may take A's pick
            slots = {(v['from'] or v['team']): int(ov) for ov, v in W.get(y, {}).get('picks', {}).items() if v['round'] == r}
            pid_at = {ov: pid for rnd, ov, team, pid, name in D[y]['picks']}
            a_ov, b_ov = slots.get(A_), slots.get(B_)
            holder = L.holder.get(sw)
            note = (it.get('note') or '').lower()
            L.assets.setdefault(sw, {'id': sw, 'kind': 'swap'})['note'] = it.get('note')
            prot = re.search(r'top[- ]?\(?(\d+)\)?[- ]protected', note)
            became = re.search(r'became (\w{3})', note)
            complex_ = bool(re.search(r'favorable|least|swap \w+.s pick for', note))
            # the outcome a source states wins; otherwise compute it from the slots and any stated protection
            if 'did not convey' in note or 'renegotiated' in note:
                outcome, basis = False, 'stated by Basketball-Reference'
            elif became:
                outcome, basis = fr(became.group(1).upper(), date) == A_, 'stated by Basketball-Reference ("became ...")'
            elif a_ov is None or b_ov is None:
                outcome, basis = None, 'original slots not found'
            else:
                outcome = a_ov < b_ov and not (prot and a_ov <= int(prot.group(1)))
                basis = 'computed from the slots' + (' and the stated protection' if prot else '; no source states the outcome or any protection (low confidence)')
                sel_at = {ov: team for rnd, ov, team, pid, name in D[y]['picks']}
                if outcome and sel_at.get(a_ov) == A_:
                    outcome, basis = False, f'not exercised: the draft page shows {A_} making the #{a_ov} selection itself'
            if complex_:
                basis += '; defined against several teams\' picks (low confidence)'
            if outcome is None or holder in (None, RETIRED):
                L.assets[sw]['resolved'] = 'unresolved (' + basis + ')'
            elif outcome and a_ov is not None and b_ov is not None and a_ov < b_ov:
                pa, pb = f'pick:{y}:{r}:p={pid_at.get(a_ov)}', f'pick:{y}:{r}:p={pid_at.get(b_ov)}'
                for aid, own in ((pa, A_), (pb, B_)):
                    L.asset(aid, kind='pick', year=y, round=r, original_owner=own, notes=[])
                    L.holder.setdefault(aid, own)
                ha, hb = L.holder[pa], L.holder[pb]
                L.move(pa, ha, holder, date, tx, 'swap exercised', p['source'], check=False)
                L.move(pb, hb, ha, date, tx, 'swap exercised', p['source'], check=False)
                L.assets[sw].update(resolved=f'exercised: #{a_ov} for #{b_ov}', basis=basis)
                L.move(sw, holder, RETIRED, date, tx, 'swap exercised', p['source'], check=False)
                L.edges.append((sw, pa, tx, 'became'))
            elif outcome:
                L.assets[sw].update(resolved='exercised (pick not identified)', basis=basis)
                L.move(sw, holder, RETIRED, date, tx, 'swap exercised', p['source'], check=False)
            else:
                L.assets[sw].update(resolved='not exercised', basis=basis, slots=(a_ov, b_ov))
                L.move(sw, holder, RETIRED, date, tx, 'swap not exercised', p['source'], check=False)
        elif k == 'swap_exercise':
            it = p['item']
            frm, got = it['teams']
            pa, pb = f"pick:{it['year']}:{it['round']}:p={it['picks'][frm]}", f"pick:{it['year']}:{it['round']}:p={it['picks'][got]}"
            for aid in (pa, pb):
                L.asset(aid, kind='pick', year=it['year'], round=it['round'], notes=[])
            L.holder.setdefault(pa, frm); L.holder.setdefault(pb, got)
            L.move(pa, L.holder[pa], got, date, tx, 'swap exercised', p['source'], check=False)
            L.move(pb, L.holder[pb], frm, date, tx, 'swap exercised', p['source'], check=False)
            sw = [a for a, x in L.assets.items() if x['kind'] == 'swap' and x.get('picks') == it['picks']]
            for a in sw:
                L.assets[a]['resolved'] = 'exercised'
                L.move(a, L.holder.get(a), RETIRED, date, tx, 'swap exercised', p['source'], check=False)
                L.edges.append((a, pa, tx, 'became'))
        elif k == 'draft':
            for rnd, overall, team, pid, name in p['picks']:
                if not pid:
                    continue
                y = p['year']
                aid = f'pick:{y}:{rnd}:p={pid}'
                if aid not in L.assets:
                    # a pick no trade mentions by its player: the team's own, or one traded without the player named
                    cand = [a for a in L.picks_by[(y, rnd)] if L.holder.get(a) == team and not L.assets[a].get('resolved') and not L.assets[a].get('became')]
                    aid = cand[0] if cand else (f'pick:{y}:{rnd}:{team}' if f'pick:{y}:{rnd}:{team}' not in L.assets or L.assets[f'pick:{y}:{rnd}:{team}'].get('resolved') is None and not L.assets[f'pick:{y}:{rnd}:{team}'].get('became') else f'pick:{y}:{rnd}:{team}#{overall}')
                    if aid in L.assets and L.assets[aid].get('resolved'):
                        aid = f'pick:{y}:{rnd}:{team}#{overall}'
                    L.asset(aid, kind='pick', year=y, round=rnd, original_owner=team if not cand else L.assets.get(aid, {}).get('original_owner'), notes=[])
                    L.holder.setdefault(aid, team)
                a = L.assets[aid]
                a.update(resolved='selected', overall=overall, became=pid, became_name=name, selected_by=team)
                holder = L.holder.get(aid) or team
                if holder != team:
                    if (y, pid) in later_official:
                        a['selected_for'] = team            # made for the team an agreed trade will hand it to
                    else:
                        L.gaps[('draft', 'selecting team did not hold the pick')] += 1
                        L.gap_rows.append({'asset': aid, 'date': p['date'], 'kind': 'draft', 'expected': team, 'held': holder, 'tx': tx})
                        holder = team
                L.move(aid, L.holder.get(aid) or team, DRAFT, p['date'], tx, 'conveyed', p['source'], check=False)
                pa = f'player:{pid}'
                L.asset(pa, kind='player', name=name, drafted=(y, overall, team))
                L.move(pa, DRAFT, holder, p['date'], tx, 'drafted', p['source'], check=False)
                L.edges.append((aid, pa, tx, 'became'))
        elif k in ('sign', 'claim'):
            for pl in p['players'][:1]:
                aid = f'player:{pl["id"]}'
                L.asset(aid, kind='player', name=pl['name'])
                if not p['to']:
                    continue
                held = L.holder.get(aid)
                last_team = L.last_team.get(aid)
                rights = L.last_kind.get(aid)
                if k == 'sign' and (held == p['to'] or (held in (POOL, None) and last_team == p['to'])):
                    # the team that held his rights just before (his previous contract or his draft rights): a re-signing
                    basis = 'draft rights' if rights == 'drafted' else 'previous contract'
                    L.events.append({'asset': aid, 'date': date, 'from': p['to'] if held == p['to'] else POOL, 'to': p['to'], 'kind': 're-sign',
                                     'tx': tx, 'source': p['source'], 'contract': p.get('contract'), 'rights': basis})
                    L.holder[aid] = p['to']
                elif held != p['to']:
                    L.move(aid, POOL, p['to'], date, tx, k, p['source'], check=False)
                    L.events[-1]['contract'] = p.get('contract')
        elif k in ('waive', 'release'):
            for pl in p['players'][:1]:
                aid = f'player:{pl["id"]}'
                L.asset(aid, kind='player', name=pl['name'])
                if p['from']:
                    if aid not in L.holder and date < '1980-07-01' and p['from'] in first_team.get(pl['id'], ()):
                        L.holder[aid] = p['from']; L.events.append({'asset': aid, 'date': '1979-07-01', 'from': 'OPENING', 'to': p['from'], 'kind': 'opening', 'tx': None, 'source': 'opening balance'})
                    L.move(aid, p['from'], POOL, date, tx, k, p['source'])
        elif k in ('expansion', 'sale'):
            for pl in p['players'][:1]:
                aid = f'player:{pl["id"]}'
                L.asset(aid, kind='player', name=pl['name'])
                if p['from'] and p['to']:
                    L.move(aid, p['from'], p['to'], date, tx, k, p['source'])
        elif k == 'retire':
            for pl in p['players'][:1]:
                aid = f'player:{pl["id"]}'
                if L.holder.get(aid) not in (None, POOL, RETIRED):
                    L.move(aid, L.holder[aid], RETIRED, date, tx, 'retired', p['source'], check=False)
        # extend / resign / convert / gleague / staff / suspension / other: no asset moves
    # opening balance for players who played in 1979-80 and never moved before their first game (first, so the
    # departure rules below see these stints too)
    for pid, teams in first_team.items():
        aid = f'player:{pid}'
        if not any(e['asset'] == aid for e in L.events if e['date'] < '1980-07-01'):
            t0 = sorted(teams)[0]
            L.asset(aid, kind='player', name=R[(t0, 1980)].get(pid))
            L.events.insert(0, {'asset': aid, 'date': '1979-07-01', 'from': 'OPENING', 'to': t0, 'kind': 'opening', 'tx': None, 'source': 'opening balance (1979-80 roster)'})
    # the rosters against the books: a player who played for a team in a season when the books never have him there
    # (a return from retirement, a 10-day contract, a move Basketball-Reference does not list) is moved there by an
    # inferred repair at that team's first game of the season (midseason, if he also played for the team the books
    # have him at): booked, credited to no GM. Without it the team that last had him keeps him on its books.
    first_game = {}
    for s_, teams in G.items():
        y_ = int(s_[:4]) + 1
        for ab, ds in teams.items():
            f_ = franchise(ab if ab != 'CHA' or y_ < 2005 else 'CHO')
            if f_ and ds:
                first_game[(f_, y_)] = min(first_game.get((f_, y_), '9999'), min(ds))
    by_a = collections.defaultdict(list)
    for e in L.events:
        by_a[e['asset']].append(e)
    played = collections.defaultdict(lambda: collections.defaultdict(set))
    for (f_, y_), ppl in R.items():
        for pid_ in ppl:
            played[pid_][y_].add(f_)
    fixes = []
    names_ = {pid_: nm for (f_, y_), ppl in R.items() for pid_, nm in ppl.items()}
    for pid_ in played:                               # players no transaction names (two-way conversions...): on no books
        if f'player:{pid_}' not in by_a:
            L.asset(f'player:{pid_}', kind='player', name=names_.get(pid_))
            by_a[f'player:{pid_}'] = []
    for aid, ev in by_a.items():
        if not aid.startswith('player:'):
            continue
        pid_ = aid.split(':', 1)[1]
        ev.sort(key=same_day)
        for y_ in sorted(played[pid_]):
            if y_ < 1981 or (ASOF and f'{y_ - 1}-10-01' > ASOF):
                continue
            lo, hi = f'{y_ - 1}-07-01', f'{y_}-07-01'
            holder, held = None, set()
            for e in ev:
                if e['date'] < lo:
                    holder = e['to']
                elif e['date'] < hi:
                    if holder:
                        held.add(holder)
                    holder = e['to']
                    held.add(holder)
            if holder:
                held.add(holder)
            for t in sorted(played[pid_][y_] - held):
                book = None
                for e in ev:
                    if e['date'] < first_game.get((t, y_), f'{y_ - 1}-11-01'):
                        book = e['to']
                d_ = first_game.get((t, y_), f'{y_ - 1}-11-01')
                if book in played[pid_][y_]:
                    d_ = max(d_, f'{y_}-02-01')
                if ASOF and d_ > ASOF:
                    continue
                fix = {'asset': aid, 'date': d_, 'from': book if book not in (None, DRAFT, 'OPENING') else POOL, 'to': t, 'kind': 'repair', 'tx': None,
                       'source': f'inferred: played for {t} in {y_ - 1}-{str(y_)[2:]}, with no move to {t} in the sources'}
                fixes.append(fix)
                ev.append(fix)                     # his books from here on include it (next season sees him at t)
                ev.sort(key=same_day)
    L.events += fixes
    print('roster repairs inferred:', len(fixes))
    # contracts that ran out: rights lapse at the end of his last season with the team when no later
    # move of his involves that team (inferred until the Contract tab gives real expiry dates)
    seasons_with = collections.defaultdict(lambda: collections.defaultdict(list))
    for (f, y), ppl in R.items():
        for pid in ppl:
            seasons_with[pid][f].append(y)
    se = lambda d: int(d[:4]) + (1 if d[5:7] >= '07' else 0)
    by_a = collections.defaultdict(list)
    for e in L.events:
        by_a[e['asset']].append(e)
    lapses = []
    cur = LAST
    for aid, ev in by_a.items():
        if not aid.startswith('player:'):
            continue
        pid = aid.split(':', 1)[1]
        ev.sort(key=same_day)
        for k, e in enumerate(ev):
            team = e['to']
            if team in (POOL, RETIRED, DRAFT, 'OPENING') or not franchise(team):
                continue
            nxt = ev[k + 1] if k + 1 < len(ev) else None
            # his last season with the team in this stint: from this move to the next one (not his last ever there,
            # or a player who came back years later would never have left in between)
            hi = se(nxt['date']) if nxt else 10 ** 4
            ls = max((y for y in seasons_with[pid].get(team, []) if se(e['date']) <= y <= hi), default=None)
            if ls is None:
                if e['kind'] == 'drafted':
                    continue                          # unsigned draft rights: kept (a stash)
                ls = int(e['date'][:4]) + (1 if e['date'][5:7] >= '07' else 0)
            end = f'{ls}-06-30'
            # lapse only after a whole completed season with no games for the team (ls + 1 is over)
            if end <= e['date'] or ls + 1 >= cur:
                continue
            if nxt is None or (nxt['date'] > end and nxt['from'] != team):
                lapses.append({'asset': aid, 'date': end, 'from': team, 'to': POOL, 'kind': 'lapsed (inferred)', 'tx': None,
                               'source': 'inferred: no games for the team after ' + f'{ls - 1}-{str(ls)[2:]}' + ' and no later move involving it'})
    L.events += lapses
    # a signing from the pool while the books still have him at another team: that team let him go (the move that
    # ended it is missing). Inferred the day before, so the other team's books stop holding him and its GM is
    # charged the departure, as with any lapse (the conservation check found 1983's Donaldson twice on the books).
    import datetime as _dt
    by_a = collections.defaultdict(list)
    for e in L.events:
        by_a[e['asset']].append(e)
    gone = []
    for aid, ev in by_a.items():
        if not aid.startswith('player:'):
            continue
        ev.sort(key=same_day)
        holder = None
        for e in ev:
            if e['from'] in (POOL, DRAFT) and e['kind'] in ('sign', 'claim', 're-sign', 'drafted') and holder not in (None, POOL, RETIRED, DRAFT, 'OPENING') \
                    and holder != e['to'] and franchise(holder):
                gone.append({'asset': aid, 'date': (_dt.date.fromisoformat(e['date']) - _dt.timedelta(days=1)).isoformat(), 'from': holder, 'to': POOL,
                             'kind': 'lapsed (inferred)', 'tx': None,
                             'source': f"inferred: {'drafted again by' if e['kind'] == 'drafted' else 'signed with'} {e['to']} on {e['date']} while still on {holder}'s books"})
            holder = e['to']
    L.events += gone
    # the repairs written while the history was being read assumed the books as they stood then; with the moves
    # inferred since (departures, roster repairs), recompute them: wherever a giver did not hold what it gives,
    # the repair moves it from whoever did (a stale one would move it twice)
    keep, by_a = [], collections.defaultdict(list)
    for e in L.events:
        if e['asset'].startswith('player:') and e['kind'] == 'repair' and not str(e.get('source') or '').startswith('inferred: played'):
            continue
        (by_a[e['asset']] if e['asset'].startswith('player:') else keep).append(e)
    for aid, ev in by_a.items():
        ev.sort(key=same_day)
        holder = None
        for e in ev:
            if e['from'] not in (POOL, DRAFT, RETIRED, 'OPENING') and holder is not None and holder != e['from']:
                keep.append({'asset': aid, 'date': e['date'], 'from': holder, 'to': e['from'], 'kind': 'repair', 'tx': e.get('tx'), 'source': e.get('source')})
            keep.append(e)
            holder = e['to']
    L.events = keep
    L.events.sort(key=same_day)
    json.dump(L.unconfirmed, open(os.path.join(OUT, 'ledger_unconfirmed.json'), 'w'))
    return L, P, D, R, counts, tx_rows


if __name__ == '__main__':
    L, P, D, R, counts, tx_rows = build()
    print('paragraphs', len(P), 'kinds', collections.Counter(p['kind'] for p in P).most_common())
    print('assets', len(L.assets), collections.Counter(a['kind'] for a in L.assets.values()))
    print('events', len(L.events), collections.Counter(e['kind'] for e in L.events).most_common())
    print('gaps', L.gaps.most_common(12))
    json.dump(L.assets, open(os.path.join(OUT, 'ledger_assets.json'), 'w'))
    json.dump(L.events, open(os.path.join(OUT, 'ledger_events.json'), 'w'))
    json.dump(L.edges, open(os.path.join(OUT, 'ledger_edges.json'), 'w'))
    json.dump(tx_rows, open(os.path.join(OUT, 'ledger_trades.json'), 'w'))
    json.dump(L.gap_rows, open(os.path.join(OUT, 'ledger_gaps.json'), 'w'))
    json.dump(L.repairs, open(os.path.join(OUT, 'ledger_repairs.json'), 'w'), indent=0)
    print('repairs written for Module 4 (decisions touching them grade low confidence):', len(L.repairs), 'in', len({r['tx'] for r in L.repairs}), 'transactions')
    json.dump({f'{k[0]}|{k[1]}': v for k, v in counts.items()}, open(os.path.join(OUT, 'ledger_counts.json'), 'w'))
