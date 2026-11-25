"""
fo_events.py — front-office moves as dated events, read from the transaction feeds.

Each event: date, team, action (hired / fired / resigned / reassigned / promoted / extended /
title), person, title, level (lead / staff / other), the sentence it came from, and the URL.
Only what a line says; nothing is inferred here.

    python3 fo_events.py        # -> out/fo_events.json, and a summary
"""
import json, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

LEAD = [r'president of basketball operations', r'head of basketball operations', r'executive vice president of basketball operations',
        r'(?<!assistant )(?<!assistant to the )general manager', r'team president', r'executive director of basketball operations',
        r'chief basketball officer', r'director of basketball operations', r'president and general manager', r'\bgm\b']
STAFF = [r'assistant general manager', r'vice president of basketball operations', r'vice president of player personnel',
         r'director of player personnel', r'director of scouting', r'senior (?:vice president|adviser|advisor)', r'special (?:assistant|adviser|advisor|consultant)',
         r'director of pro personnel', r'vice president of basketball', r'player personnel']
NOT_NBA = r'(g league|d-league|nba development|gatorade|capital city|wolves general manager|affiliate|summer league|wnba|liberty|sparks|storm|mercury|lynx|fever|dream|aces|mystics|sky|sun|wings)'
VERBS = {'hired': 'hired', 'named': 'hired', 'appointed': 'hired', 'promoted': 'promoted', 'fired': 'fired', 'relieved': 'fired', 'dismissed': 'fired',
         'parted ways': 'fired', 'resigned': 'resigned', 'resignation': 'resigned', 'stepped down': 'resigned', 'step down': 'resigned', 'terminated': 'fired', 'will not return': 'fired', 'not renew': 'fired', 'contract was not': 'fired', 'reassigned': 'reassigned', 'retired': 'resigned',
         'extension': 'extended', 'extended': 'extended', 'transition': 'title', 'will become': 'title', 'mutually agreed': 'fired'}
NAME = r"((?:[A-Z][a-zA-Z'\.\-]+|de|van|Van|Mc[A-Z][a-z]+)(?: (?:[A-Z][a-zA-Z'\.\-]+|Jr\.|Sr\.|III|II|de|van|Van|del|Del)){1,3})"


def level_of(title):
    t = title.lower()
    if re.search(NOT_NBA, t):
        return 'other'
    if any(re.search(p, t) for p in STAFF):
        return 'staff'
    if any(re.search(p, t) for p in LEAD):
        return 'lead'
    return 'other'


def parse_clause(c):
    low = c.lower()
    verb = next((v for k, v in VERBS.items() if k in low), None)
    if not verb:
        return None
    # title words near the verb
    m = (re.search(r'(?:as|to)(?: the)? ((?:[a-z\-]+ ){0,7}?(?:general manager|basketball operations|president|player personnel|scouting|adviser|advisor|consultant|director|vice president|officer|executive)(?: and general manager)?)', c)
         or re.search(r'((?:executive )?(?:vice )?president of basketball operations(?: and general manager)?|(?:assistant )?general manager|team president|director of player personnel)', low))
    title = m.group(1).strip() if m else ''
    lead_words = r'^(?:Named|Hired|Fired|Promoted|Signed|Agreed|Announced|Relieved|Appointed|Reassigned|The|President|General|Vice|Executive|Director|Basketball|Head|Assistant)\s+'
    names = [re.sub(lead_words, '', n) for n in re.findall(NAME, c)]
    names = [n for n in names if len(n.split()) >= 2 and not re.match(lead_words, n + ' ')]
    return {'action': verb, 'title': title, 'level': level_of(title) if title else 'other', 'person': names[0] if names else None}


def from_espn():
    rows = json.load(open(os.path.join(OUT, 'espn_tx.json')))
    ev = []
    for r in rows:
        if not re.search(r'general manager|president|basketball operations|player personnel|scouting|adviser|advisor|consultant|\bGM\b', r['text'], re.I):
            continue
        for c in re.split(r';|\. (?=[A-Z])', r['text']):
            p = parse_clause(c.strip())
            if p:                       # the person is matched against the line later; the parse is only a hint
                ev.append(dict(p, date=r['date'], team=r['team'], text=c.strip(), line=r['text'], source=r['source'], feed='espn'))
    return ev


def from_br():
    rows = json.load(open(os.path.join(OUT, 'br_tx.json')))
    ev = []
    for r in rows:
        m = re.match(r'The (.+?) (hired|fired|appointed|named|reassigned|promoted) (.+?) as (.+?)\.$', r['text'])
        m2 = re.match(r'The (.+?) (fired|reassigned) (.+?) (?:as )?(General Manager|President.*|Team President|Executive.*)\.$', r['text'])
        if m and level_of(m.group(4)) != 'other':
            ev.append({'action': VERBS.get(m.group(2), m.group(2)), 'title': m.group(4), 'level': level_of(m.group(4)), 'person': m.group(3),
                       'date': r['date'], 'team': (r['from'] + r['to'] + [None])[0], 'team_name': m.group(1), 'text': r['text'], 'source': r['source'], 'feed': 'br'})
        elif re.search(r'(General Manager|President of Basketball|Team President)', r['text']) and re.search(r'\b(reassigned|fired|resigned)\b', r['text']):
            mm = re.match(r'The (.+?) (reassigned|fired) (?:General Manager |President |)(.+?)\.$', r['text'])
            if mm:
                ev.append({'action': VERBS.get(mm.group(2)), 'title': 'general manager' if 'General Manager' in r['text'] else 'president', 'level': 'lead',
                           'person': mm.group(3), 'date': r['date'], 'team': None, 'team_name': mm.group(1), 'text': r['text'], 'source': r['source'], 'feed': 'br'})
    return ev


if __name__ == '__main__':
    ev = from_espn() + from_br()
    json.dump(ev, open(os.path.join(OUT, 'fo_events.json'), 'w'), indent=0)
    print('events', len(ev), collections.Counter((e['feed'], e['level']) for e in ev))
    print(collections.Counter(e['action'] for e in ev if e['level'] == 'lead'))
    for e in [e for e in ev if e['level'] == 'lead'][::12][:14]:
        print(f"  {e['date']} {e['team']} {e['action']:9} {str(e['person'])[:24]:24} | {e['title'][:45]:45} | {e['text'][:70]}")
