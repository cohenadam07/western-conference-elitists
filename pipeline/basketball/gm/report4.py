"""report4.py — Module 4's report: best and worst decisions by each grade (all time and the last ten seasons),
the ten where the grades disagree most, coverage and confidence. -> out/decisions_report.txt"""
import collections, json, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
PENDING = {'extension', 're-signing', 'left in free agency', 'sign-and-trade'}        # need salaries to mean what they say (the Contract tab)
rep = []
say = rep.append


def lab(d):
    who = ', '.join(f"{p['person']}" + (f" {p['weight']:.0%}" if p['weight'] < 1 else '') for p in d['credit']['people']) or 'nobody credited'
    what = d.get('player') or d.get('coach') or (d.get('text') or '')
    lc = ' [low confidence]' if d['low_confidence'] else ''
    return f"{d['date']} {d['team']} {d['type']}: {what[:95]} | {who}{lc}"


c = collections.Counter(d['type'] for d in D)
say(f"{len(D)} decisions: " + ', '.join(f'{k} {v}' for k, v in c.most_common()))
say(f"at the time graded: {sum(1 for d in D if d['at_time'] is not None)}; dropped for want of earlier data: {sum(1 for d in D if d['at_time'] is None and d.get('at_time_note', '') and 'earlier data' in d['at_time_note'])}; "
    f"low confidence: {sum(1 for d in D if d['low_confidence'])}; nobody credited: {sum(1 for d in D if not d['credit']['people'])}")
say('Units: Savant points, era footing, ten seasons from the decision, later seasons discounted 5% a year. '
    'Extensions, re-signings and let-walk decisions are listed apart: without salaries they measure value kept or lost, not value over cost.\n')
main = [d for d in D if d['type'] not in PENDING]
for key, title in (('at_time', 'AT THE TIME'), ('turned_out', 'HOW IT TURNED OUT')):
    for span, cond in (('all time', lambda d: True), ('last ten seasons (2016-17 on)', lambda d: d['date'] >= '2016-07-01')):
        xs = sorted([d for d in main if d.get(key) is not None and cond(d)], key=lambda d: d[key])
        say(f'== {title}, {span}: 20 best')
        for d in xs[::-1][:20]:
            say(f"  {d[key]:+7.0f}  {lab(d)}")
        say(f'== {title}, {span}: 20 worst')
        for d in xs[:20]:
            say(f"  {d[key]:+7.0f}  {lab(d)}")
        say('')
both = [d for d in main if d.get('at_time') is not None and d.get('turned_out') is not None]
say('== the ten where the two grades disagree most (at the time vs how it turned out)')
seen_tx = set(); n = 0
for d in sorted(both, key=lambda d: -abs(d['at_time'] - d['turned_out'])):
    if d.get('tx') and d['tx'] in seen_tx:
        continue                                   # one side of each trade (the other is its mirror)
    seen_tx.add(d.get('tx')); n += 1
    say(f"  at the time {d['at_time']:+6.0f}, turned out {d['turned_out']:+6.0f}  {lab(d)}")
    if n == 10:
        break
say('\n== listed apart until the Contract tab: the biggest extensions, re-signings and let-walk decisions (how it turned out)')
for d in sorted([d for d in D if d['type'] in PENDING and d.get('turned_out') is not None], key=lambda d: -abs(d['turned_out']))[:12]:
    say(f"  {d['turned_out']:+7.0f}  {lab(d)}")
open(os.path.join(OUT, 'decisions_report.txt'), 'w').write('\n'.join(rep) + '\n')
print('\n'.join(rep[:3]))
