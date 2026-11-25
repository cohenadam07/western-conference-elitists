"""
credit.py — the second stage of nba.gm_tenures: co-decision-makers, the day-by-day credit
table, confidence, and the executive tree.

  co-decision-makers  A dated line (ESPN) naming someone to a lead job (president of basketball
                      operations, general manager) at a team where Basketball-Reference has a
                      different person in charge that day. He shares credit from that date to the
                      last date a source still places him there ('last seen'), or to a dated
                      departure, or to the day he becomes the team's listed head.
  credit              For every franchise, segments of days with a constant set of people. Weights
                      split equally (the spec's default) unless CREDIT_SPLITS has a sourced split.
                      Inside an off-season handover no source dates, outgoing and incoming share the
                      window equally and the segment says 'date unknown'.
  confidence          clear: both ends dated to the day or pinned between two games (or still in
                      office), and nothing flagged. likely: an end known only to the off-season, or
                      a co-decision-maker's end known only as 'last seen'. disputed: the spine is
                      inconsistent (overlap with no split, a spell that fits nowhere) or two
                      sources disagree.
  tree                Who worked under whom: a staff hire (assistant GM, VP of basketball
                      operations, director of player personnel) and a co-decision-maker sit under
                      the head in charge that day. People who are also Coaching Savant coaches
                      are linked to it.

    python3 credit.py      # -> out/gm_tenures.json, out/gm_credit.json, out/gm_tree.json, a summary
"""
import collections
import datetime as dt
import json
import os
import re
from difflib import SequenceMatcher

from tenures import OUT, build, franchise, norm, shift, CREDIT_SPLITS, OWNER_FLAGS
import facts

NOISE = r'development league|minor league|affiliate|bighorns|reno|arena|nbdl|nbadl|d-league|g league|rio grande|vipers|wolves|skyforce|legends|herd|consultant|advis|special assistant|business|ticket|marketing|public relations|broadcast|scouting coordinator|of the .*(?:flash|hustle|swarm|stampede|charge)'
LEAD_TITLE = r'president of basketball operations|(?<!assistant )general manager|executive vice president of basketball operations|head of basketball operations'
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TODAY = os.environ.get('GM_ASOF') or dt.date.today().isoformat()   # an as-of build (the replay) is as of its day, not the clock's


def same_person(a, b):
    """Same first name and a near-identical surname (a feed's typo); never a prefix match, which
    would merge Don Nelson with Donn Nelson."""
    a = [w for w in norm(a).split() if w not in ('jr', 'sr', 'ii', 'iii')]
    b = [w for w in norm(b).split() if w not in ('jr', 'sr', 'ii', 'iii')]
    if not a or not b:
        return False
    if a == b:
        return True
    return a[0] == b[0] and SequenceMatcher(None, ' '.join(a[1:]), ' '.join(b[1:])).ratio() >= 0.85


def maybe_same(a, b):
    """Same surname and one first name starting the other: flagged for review, never merged."""
    a, b = norm(a).split(), norm(b).split()
    return len(a) > 1 and len(b) > 1 and a[1:] == b[1:] and a[0] != b[0] and (a[0].startswith(b[0][:3]) or b[0].startswith(a[0][:3]))


def lo_of(t):
    return t['start'] if t['start_precision'] in ('day', 'before coverage') else t.get('start_window', [t['start']])[0]


def hi_of(t):
    if t['end'] is None:
        return TODAY
    return t['end'] if t['end_precision'] in ('day', 'last seen', 'assumed') else t.get('end_window', [t['end'], t['end']])[1]


def co_decision_makers(T, E):
    by_team = collections.defaultdict(list)
    for t in T:
        by_team[t['team']].append(t)
    heads = lambda f, d: [t for t in by_team[f] if lo_of(t) <= d <= hi_of(t)]
    people = collections.defaultdict(list)
    for e in E:
        if e['feed'] != 'espn' or not e.get('team'):
            continue
        f = franchise(e['team'], e['date'])
        if not f or re.search(NOISE, e['text'], re.I):
            continue
        for c in re.split(r'(?<=\.) |; | and (?=[A-Z][a-z]+ [A-Z])', e['line']):
            m = re.search(rf"(?:Named|Hired|Promoted|named|hired|promoted|appointed) ([A-Z][\w'\.\-]+(?: [A-Z][\w'\.\-]+){{1,3}}) (?:as |to )?(?:the )?(?:team's )?({LEAD_TITLE}(?: and (?:{LEAD_TITLE}))?)", c)
            if not m or re.search(NOISE, c, re.I):
                continue
            who, title = re.sub(r'^(?:[A-Z]{2,5} )+', '', m.group(1)), m.group(2)
            if any(same_person(t['person'], who) for t in heads(f, e['date'])):
                continue
            people[(f, norm(who))].append({'date': e['date'], 'name': who, 'title': title, 'text': c, 'source': e['source'], 'kind': 'start'})
    # later lines that still place him there (extensions, promotions, titles) and dated departures
    co = []
    for (f, key), starts in people.items():
        starts.sort(key=lambda x: x['date'])
        s0 = starts[0]
        seen, end, end_line = s0['date'], None, None
        DEP = r'\b(fired|resign|stepped down|reassigned|relieved|dismissed|parted ways|will not return|left)'
        for e in E:
            if not e.get('team') or franchise(e['team'], e['date']) != f or e['date'] <= s0['date']:
                continue
            for c in re.split(r'; |(?<=\.) ', e['line'] if e.get('line') else e['text']):
                if key not in norm(c):
                    continue
                if re.search(DEP, c, re.I) and not end:
                    end, end_line = e['date'], c
                elif not end:
                    seen = max(seen, e['date'])
        cands = []
        if end:
            cands.append((end, end_line, 'day'))
        sp = facts.SAME_PERSON.get(s0['name'])
        own = [t for t in by_team[f] if (same_person(t['person'], s0['name']) or (sp and t['person_id'] == sp[0])) and lo_of(t) >= s0['date']]
        if own:
            cands.append((shift(lo_of(own[0]), -1), f"becomes the head Basketball-Reference lists ({own[0]['tenure_id']})", 'day'))
        elsewhere = sorted([(e['date'], 'named elsewhere: ' + e['text'][:80]) for e in E if e.get('team') and franchise(e['team'], e['date']) != f and key in norm(e['text']) and e['date'] > s0['date'] and e['level'] == 'lead']
                           + [(lo_of(t), f"head elsewhere ({t['tenure_id']})") for t in T if t['team'] != f and norm(t['person']) == key and lo_of(t) > s0['date']])
        if elsewhere:
            cands.append((shift(elsewhere[0][0], -1), elsewhere[0][1], 'day'))
        new_head = sorted(lo_of(t) for t in by_team[f] if lo_of(t) > shift(s0['date'], 30) and norm(t['person']) != key)
        fx = next(((d, src, says) for (who, ff), rows in facts.DATES.items() if ff == f and same_person(who, s0['name'])
                   for kind, d, src, says in rows if kind == 'end' and d >= s0['date']), None)
        if fx:
            cands.append((fx[0], f'{fx[2]} ({fx[1]})', 'day'))
            fx = (fx[0], fx[1], fx[2])
        if not cands:
            # no sourced evidence he left: open, flagged for the press pass (rule 8 replaced, Nov 22)
            cands.append((TODAY, 'no sourced departure yet', 'open'))
        end, end_line, end_prec = min(cands)
        if fx:
            srcs_extra = [fx[1]]
        else:
            srcs_extra = []
        flags = [] if facts.SAME_PERSON.get(s0['name']) else [f"possibly the same person as {t['person']} ({t['tenure_id']})" for t in by_team[f] if maybe_same(t['person'], s0['name'])]
        under = heads(f, s0['date'])
        same = facts.SAME_PERSON.get(s0['name'])
        pid, pname = (same[0], next((t['person'] for t in T if t['person_id'] == same[0]), s0['name'])) if same else (f"espn:{key.replace(' ', '')}", s0['name'])
        co.append({'tenure_id': f"{pid}:{f}:{s0['date'][:4]}:co", 'person_id': pid, 'person': pname, 'feed_name': s0['name'],
                   'same_person_source': same[1] if same else None,
                   'team': f, 'title': s0['title'], 'role': 'shared', 'start': s0['date'], 'start_precision': 'day', 'start_line': s0['text'],
                   'end': None if end == TODAY else end, 'end_precision': end_prec if end != TODAY else ('active' if end_prec != 'open' else 'open'), 'last_seen': seen, 'end_line': end_line, 'flags': flags,
                   'under': [t['tenure_id'] for t in under], 'sources': sorted({s0['source']} | set(srcs_extra) | ({same[1]} if same else set())), 'kind': 'co'})
    return co


def segments_for(f, T):
    """Day segments with a constant set of (tenure, weight) for one franchise."""
    ts = [t for t in T if t['team'] == f]
    cuts = set()
    for t in ts:
        cuts.add(lo_of(t)); cuts.add(shift(hi_of(t), 1))
        if t.get('start_window'):
            cuts.update([t['start_window'][0], shift(t['start_window'][1], 1)])
        if t.get('end_window'):
            cuts.update([t['end_window'][0], shift(t['end_window'][1], 1)])
    cuts.add('1979-07-01')
    for r in facts.HIERARCHY:
        if r['team'] == f:
            cuts.add(r['from'])
            if r.get('to'):
                cuts.add(shift(r['to'], 1))
    cuts = sorted(c for c in cuts if c >= '1979-07-01')
    segs = []
    for a, b in zip(cuts, cuts[1:]):
        last = shift(b, -1)
        on = [t for t in ts if lo_of(t) <= a and last <= hi_of(t)]
        if not on:
            before = [t for t in ts if hi_of(t) < a and t['end_precision'] == 'day']
            after = [t for t in ts if lo_of(t) > last and t['start_precision'] == 'day']
            if before and after and max(hi_of(t) for t in before) == shift(a, -1) and min(lo_of(t) for t in after) == b:
                segs.append({'team': f, 'from': a, 'to': last, 'people': [], 'vacancy': True, 'date_unknown': False, 'split': None,
                             'source': [max(before, key=hi_of).get('end_line'), min(after, key=lo_of).get('start_line')]})
            continue
        unsure = [t for t in on if (t.get('start_window') and t['start_window'][0] <= a and last <= t['start_window'][1] and t['start_precision'] in ('offseason', 'games', 'game', 'month'))
                  or (t.get('end_window') and t['end_window'][0] <= a and last <= t['end_window'][1] and t['end_precision'] in ('offseason', 'games', 'game', 'month'))]
        w = round(1.0 / len(on), 6)
        ppl = [{'tenure_id': t['tenure_id'], 'person': t['person'], 'weight': w} for t in on]
        ppl[-1]['weight'] = round(1.0 - w * (len(on) - 1), 6)
        segs.append({'team': f, 'from': a, 'to': last, 'people': ppl,
                     'date_unknown': bool(unsure), 'split': 'equal', 'source': None})
    # merge neighbours with the same people
    out = []
    for s in segs:
        if out and out[-1]['to'] == shift(s['from'], -1) and [p['tenure_id'] for p in out[-1]['people']] == [p['tenure_id'] for p in s['people']] and out[-1]['date_unknown'] == s['date_unknown'] and not s.get('vacancy'):
            out[-1]['to'] = s['to']
        else:
            out.append(s)
    return out


def rank(title):
    """1 president / head / CEO, 2 executive VP, 3 senior VP, 4 GM or VP of basketball operations, 9 unknown."""
    t = (title or '').lower()
    if not t:
        return 9
    if (re.search(r'\bpresident\b', t) and not re.search(r'vice[ -]president', t)) or re.search(r'head of basketball operations|chief basketball officer|\bceo\b', t):
        return 1
    if 'executive vice' in t:
        return 2
    if 'senior vice' in t:
        return 3
    if re.search(r'general manager|\bgm\b|vice president of basketball|director of basketball operations|run the basketball', t):
        return 4
    return 9


def title_at(t, date):
    rows = facts.TITLES.get((t['person'], t['team'])) or next((v for (who, ff), v in facts.TITLES.items() if ff == t['team'] and same_person(who, t['person'])), [])
    best = None
    for d, title, src in sorted(rows):
        if d <= date:
            best = (title, src)
    if best:
        return best
    if t.get('title') and lo_of(t) <= date:
        return t['title'], (t['sources'] or [None])[0]
    return None, None


def who(seg_people, name, allt):
    return next((p for p in seg_people if same_person(p['person'], name) or (facts.SAME_PERSON.get(name) and allt[p['tenure_id']]['person_id'] == facts.SAME_PERSON[name][0])), None)


def resolve(segs, allt):
    """The hierarchy rule (Nov 22): a clear lead takes the credit; a No. 2 is recorded under him;
    equal split only for real co-leads, undated handovers and same-day handovers."""
    for s in segs:
        ppl = s['people']
        s['under'] = []
        if len(ppl) < 2:
            s['split'] = 'one person' if ppl else s.get('split')
            continue
        if s['date_unknown'] and not any(r['team'] == s['team'] and r['from'] <= s['from'] and s['to'] <= (r.get('to') or TODAY) for r in facts.HIERARCHY):
            s['split'] = 'undated handover'     # a sourced hierarchy over the window (both in post, one under the other) wins
            continue
        if s['from'] == s['to'] and any(hi_of(allt[p['tenure_id']]) == s['to'] for p in ppl) and any(lo_of(allt[p['tenure_id']]) == s['from'] for p in ppl):
            s['split'] = 'same-day handover'
            continue
        rules = [r for r in facts.HIERARCHY if r['team'] == s['team'] and r['from'] <= s['from'] and s['to'] <= (r.get('to') or TODAY)]
        # sourced reporting on who decides beats a title (Nov 22); a title rule is only the fallback
        rule = next((r for r in rules if r['basis'] != 'title'), None) or next(iter(rules), None)
        lead, co, why, src = None, None, None, None
        if rule and rule.get('co'):
            co = [x for x in (who(ppl, n, allt) for n in rule['co']) if x]
            why, src = rule['basis'], rule['source']
        elif rule and rule.get('lead'):
            lead = who(ppl, rule['lead'], allt)
            why, src = rule['basis'], rule['source']
        if not lead and not co:
            titled = [(rank(title_at(allt[p['tenure_id']], s['from'])[0]), p) for p in ppl]
            top = min(r for r, p in titled)
            best = [p for r, p in titled if r == top]
            if top == 9 or any(r == 9 for r, p in titled):
                s['split'], s['flag'] = 'hierarchy not sourced', 'titles missing for ' + ', '.join(p['person'] for r, p in titled if r == 9)
                continue
            if len(best) == 1:
                lead, why = best[0], 'title'
                src = title_at(allt[lead['tenure_id']], s['from'])[1]
            else:
                co, why = best, 'equal titles'
        if co:
            if rule and rule['basis'] in ('hierarchy not sourced', 'sources conflict'):
                s['flag'] = rule['basis'] + ': ' + rule['says']
            w = round(1.0 / len(co), 6)
            s['under'] = [{'tenure_id': p['tenure_id'], 'person': p['person'], 'under': ' / '.join(c['person'] for c in co)} for p in ppl if p not in co]
            s['people'] = [dict(p, weight=w) for p in co]
            s['people'][-1]['weight'] = round(1.0 - w * (len(co) - 1), 6)
            s['split'], s['basis'], s['source'] = 'co-leads', why, src
        else:
            s['under'] = [{'tenure_id': p['tenure_id'], 'person': p['person'], 'under': lead['person']} for p in ppl if p is not lead]
            s['people'] = [dict(lead, weight=1.0)]
            s['split'], s['basis'], s['source'] = 'lead', why, src
    return segs


def credit_on(credit, f, date):
    """The people credited with a decision by franchise f on date, with weights adding to 1."""
    for s in credit.get(f, []):
        if s['from'] <= date <= s['to']:
            return s
    return None


def confidence(t, flagged):
    if t['tenure_id'] in flagged or t.get('flags'):
        return 'disputed'
    ends = [t['start_precision'], t['end_precision']]
    if t.get('kind') == 'co':
        return 'clear' if t['end_precision'] == 'day' else 'likely'     # a dated end of either kind; assumed ends stay likely
    if all(p in ('day', 'game', 'active', 'before coverage') for p in ends):
        return 'clear'
    return 'likely'


def tree(T, co, E):
    """(junior, senior, team, from, how, source)."""
    edges = []
    all_t = T + co
    for c in co:
        for u in c['under']:
            s = next(t for t in T if t['tenure_id'] == u)
            edges.append({'junior': c['person'], 'senior': s['person'], 'team': c['team'], 'from': c['start'], 'how': c['title'], 'source': c['sources'][0]})
    for e in E:
        if e['level'] != 'staff' or e['feed'] != 'espn' or not e.get('team') or re.search(NOISE, e['text'], re.I):
            continue
        f = franchise(e['team'], e['date'])
        m = re.search(r"(?:Named|Hired|Promoted|named|hired|promoted) ([A-Z][\w'\.\-]+(?: [A-Z][\w'\.\-]+){1,3}) (?:as |to )?(?:the )?(assistant general manager|vice president of basketball operations|director of player personnel|vice president of player personnel|director of pro personnel)", e['text'])
        if not m:
            continue
        for t in all_t:
            if t['team'] == f and lo_of(t) <= e['date'] <= hi_of(t) and norm(t['person']) != norm(m.group(1)):
                edges.append({'junior': m.group(1), 'senior': t['person'], 'team': f, 'from': e['date'], 'how': m.group(2), 'source': e['source']})
    return edges


def coaches():
    p = os.path.join(REPO, 'public', 'bcs', 'index.json')
    if not os.path.exists(p):
        return {}
    d = json.load(open(p))
    cs = d['coaches'] if isinstance(d['coaches'], list) else list(d['coaches'].values())
    return {norm(c['name']): c['id'] for c in cs}


def repair_inverted(T):
    """A tenure that ends before it starts is a zero-game spell placed across an offseason window the wrong way round.
    Keep whichever end is sourced to the day and take the other from the neighbouring tenure at the team."""
    fixed = []
    by = collections.defaultdict(list)
    for t in T:
        by[t['team']].append(t)
    for f, ts in by.items():
        for t in ts:
            if not t['end'] or t['end'] >= t['start']:
                continue
            others = [o for o in ts if o is not t and not same_person(o['person'], t['person'])]
            s0, e0 = t['start'], t['end']
            prev = max((o['end'] for o in others if o['end'] and o['end'] <= max(s0, e0)), default=None)
            nxt = min((o['start'] for o in others if o['start'] > min(s0, e0)), default=None)
            if t['start_precision'] == 'day':
                t['end'], t['end_precision'] = shift(nxt, -1) if nxt and nxt > s0 else s0, 'offseason'
            elif t['end_precision'] == 'day':
                t['start'], t['start_precision'] = shift(prev, 1) if prev and prev < e0 else e0, 'offseason'
            else:
                t['start'], t['end'] = (shift(prev, 1) if prev and prev < s0 else e0), (shift(nxt, -1) if nxt and nxt > e0 else s0)
                t['start_precision'] = t['end_precision'] = 'offseason'
            t.pop('start_window', None); t.pop('end_window', None)
            if t['end'] < t['start']:
                t['end'] = t['start']
            t.setdefault('notes', []).append('zero-game spell: one end taken from the neighbouring tenure')
            fixed.append((f, t['person'], s0, e0, t['start'], t['end']))
    return fixed


def cap_two_jobs(T):
    """No person holds jobs on two teams at once: an undated end that runs past a dated start elsewhere ends the day before."""
    fixed = []
    for t in T:
        if t['end_precision'] == 'day' or t['end'] is None:
            continue
        for o in T:
            if o is t or o['team'] == t['team'] or o['start_precision'] not in ('day', 'month') or not same_person(o['person'], t['person']):
                continue
            if t['start'] < o['start'] <= hi_of(t):
                t['end'], t['end_precision'] = shift(o['start'], -1), 'day'
                t['end_line'] = f"the day before his {o['team']} start ({o['start']})"
                t.pop('end_window', None)
                fixed.append((t['person'], t['team'], t['end'], o['team']))
    return fixed


def main():
    T, seg, ts = build()
    for x in repair_inverted(T):
        print('repaired', x)
    for x in cap_two_jobs(T):
        print('two jobs', x)
    E = json.load(open(os.path.join(OUT, 'fo_events.json')))
    flagged = set()
    for (f, s), v in seg.items():
        for fl in v['flags']:
            for q in v['people']:
                if q['name'] in fl:
                    flagged.update(t['tenure_id'] for t in T if t['person_id'] == q['id'] and t['team'] == f and s in t['seasons'])
    co = co_decision_makers(T, E)
    for t in T:
        t['role'] = 'lead'
        t['kind'] = 'br'
    for x in facts.EXTRA_TENURES:
        end = next((d for (w, ff), rows in facts.DATES.items() if ff == x['team'] and same_person(w, x['person']) for k, d, _, _ in rows if k in ('end', 'extend') and d), None)
        co.append({'tenure_id': f"fact:{norm(x['person']).replace(' ', '')}:{x['team']}:{x['start'][:4]}", 'person_id': 'fact:' + norm(x['person']).replace(' ', ''),
                   'person': x['person'], 'team': x['team'], 'title': x['title'], 'role': 'shared', 'start': x['start'], 'start_precision': 'day', 'start_line': x['says'],
                   'end': end, 'end_precision': 'day' if end else 'active', 'end_line': None, 'flags': [], 'under': [], 'kind': 'fact',
                   'sources': sorted({x['source']} | ({x['also']} if x.get('also') else set()))})
    # front-office changes found by the daily refresh (gm_update.py): each opens or closes a tenure with its source at
    # once, as "pending confirmation" until a second source agrees
    fp = os.path.join(OUT, 'fo_pending.json')
    for r in (json.load(open(fp)).values() if os.path.exists(fp) else []):
        if r['kind'] == 'starts':
            co.append({'tenure_id': f"auto:{norm(r['person']).replace(' ', '')}:{r['team']}:{r['date'][:4]}", 'person_id': 'auto:' + norm(r['person']).replace(' ', ''),
                       'person': r['person'], 'team': r['team'], 'title': None, 'role': 'shared', 'start': r['date'], 'start_precision': 'day', 'start_line': r['line'],
                       'end': None, 'end_precision': 'active', 'end_line': None, 'flags': [], 'under': [], 'kind': 'auto', 'status': r['status'],
                       'sources': [r['source']] + r['confirmations']})
        else:
            for t in T + co:
                if t['team'] == r['team'] and same_person(t['person'], r['person']) and t['end'] is None:
                    t['end'], t['end_precision'], t['end_line'], t['status'] = shift(r['date'], -1), 'day', r['line'], r['status']
                    t['sources'] = sorted(set(t['sources'] + [r['source']] + r['confirmations']))
    allt = T + co
    byid = {t['tenure_id']: t for t in allt}
    credit = {f: resolve(segments_for(f, allt), byid) for f in sorted({t['team'] for t in allt})}
    # role: shared wherever a segment of his has more than one person
    shared = {p['tenure_id'] for segs in credit.values() for s in segs if s.get('split') == 'co-leads' for p in s['people']}
    credited = {p['tenure_id'] for segs in credit.values() for s in segs for p in s['people']}
    under = []
    for f, segs in credit.items():
        for sg in segs:
            for u in sg.get('under', []):
                last = under[-1] if under else None
                if last and last['tenure_id'] == u['tenure_id'] and last['under'] == u['under'] and last['to'] == shift(sg['from'], -1):
                    last['to'] = sg['to']
                else:
                    t = byid[u['tenure_id']]
                    under.append({'tenure_id': u['tenure_id'], 'person': t['person'], 'person_id': t['person_id'], 'team': f, 'from': sg['from'], 'to': sg['to'],
                                  'under': u['under'], 'title': title_at(t, sg['from'])[0], 'basis': sg.get('basis'), 'source': sg.get('source'), 'tenure_sources': t['sources']})
    for x in facts.UNDER:
        under.append({'tenure_id': None, 'person': x['person'], 'person_id': None, 'team': x['team'], 'from': x['start'], 'to': x['end'] or TODAY,
                      'under': x['under'], 'title': x['title'], 'basis': 'source', 'source': x['source'], 'says': x['says']})
    for t in allt:
        t['credited'] = t['tenure_id'] in credited
    json.dump(under, open(os.path.join(OUT, 'gm_under.json'), 'w'), indent=0)
    cmap = coaches()
    CIDS = set(cmap.values())
    for t in allt:
        t['role'] = 'shared' if t['tenure_id'] in shared else 'lead' if t['credited'] else 'under only'
        t['confidence'] = confidence(t, flagged)
        stem = t['person_id'][:-1] + 'c' if t['kind'] == 'br' else None
        lab = next((v for (ff, a, b), v in facts.TEAM_LABELS.items() if ff == t['team'] and 'CHH' in t.get('br_teams', [])), None)
        if lab:
            t['team_label'], t['team_note'] = lab['label'], lab['note']
        t['coach_id'] = stem if stem in CIDS else (cmap.get(norm(t['person'])) if t['kind'] == 'co' else None)
        t['weights'] = sorted({p['weight'] for segs in credit.get(t['team'], []) for p in segs['people'] if p['tenure_id'] == t['tenure_id']})
    edges = tree(T, co, E)
    json.dump(allt, open(os.path.join(OUT, 'gm_tenures.json'), 'w'), indent=0)
    json.dump(credit, open(os.path.join(OUT, 'gm_credit.json'), 'w'), indent=0)
    json.dump(edges, open(os.path.join(OUT, 'gm_tree.json'), 'w'), indent=0)
    return allt, credit, edges, seg


if __name__ == '__main__':
    allt, credit, edges, seg = main()
    print('tenures', len(allt), collections.Counter(t['kind'] for t in allt), collections.Counter(t['confidence'] for t in allt))
    print('roles', collections.Counter(t['role'] for t in allt))
    sp = collections.Counter(s.get('split') for v in credit.values() for s in v if len(s['people']) > 1 or s.get('under'))
    print('two or more in charge, by outcome:', dict(sp))
    segs = [s for v in credit.values() for s in v]
    bad = [s for s in segs if not s.get('vacancy') and abs(sum(p['weight'] for p in s['people']) - 1) > 1e-4]
    print('vacancies (a dated departure and a dated hire with nobody between)', sum(1 for s in segs if s.get('vacancy')))
    print('credit segments', len(segs), 'weights not adding to 1:', len(bad), 'date-unknown segments', sum(s['date_unknown'] for s in segs))
    print('tree edges', len(edges), 'people linked to Coaching Savant', sum(1 for t in allt if t['coach_id']))
