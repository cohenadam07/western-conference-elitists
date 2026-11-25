"""
report6.py — Module 6, the review report (nothing ships until it is approved).

  1. top and bottom 15 by GM Value Added (above an average GM, 5%), two or more seasons, all-time and active, with
     each one's skill profile; and the discount sensitivity (0, 5, 10, 20%) for the top and bottom 10
  2. the repeatability results (repeat6.py) and the verdict on each skill
  3. ten GMs to check by hand: their biggest decisions, both grades
  4. what is missing by era, and the wording the page will use for each gap

    python3 report6.py     # -> out/review_report.txt
"""
import collections, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
SP = json.load(open(os.path.join(OUT, 'gm_spells.json')))
DT = {(d['person_id'], d['team'], d['start']): d for d in json.load(open(os.path.join(OUT, 'gm_detail.json')))}
D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
TID = {t['tenure_id']: t for t in T}
REP = json.load(open(os.path.join(OUT, 'gm_repeatability.json')))
K = '0.05'
L = []
w = L.append


def yrs(r):
    return f"{r['start'][:4]}-{(r['end'] or 'now')[:4]}"


def profile(r):
    d = DT.get((r['person_id'], r['team'], r['start']))
    if not d:
        return ''
    dr, tr = d['drafting'], d['trades']
    return (f"draft {dr['over_slot']:+.0f} over slot ({dr['picks']} picks); trades {tr['turned_out']:+.0f} turned out / {tr['at_time']:+.0f} at the time ({tr['n']}); "
            f"FA {d['free_agency']['stars'] + d['free_agency']['role']:+.0f}; re-sign {d['re_signing']:+.0f}; develop {d['development']['value_over_projection']:+.0f}; "
            f"coach {d['coach_hiring']:+.0f}; luck: lottery {d['luck']['lottery']:+.0f}, grade gap {d['luck']['grade_gap']:+.0f}")


def line(r, i):
    return (f"{i:2}. {r['person'][:22]:22} {r['team']} {yrs(r):9} {r['gm_value_added'][K]:+7.0f}  ({r['gm_value_added_per_season']:+5.0f}/season, {r['seasons']:.1f} seasons)"
            f"  produced (adj. margin) {r['produced_margin_adj']:+6.0f}, left {r['left'][K]:5.0f}, inherited {r['inherited'][K]:5.0f}"
            + f"  | player-value line {r['gm_value_added_player'][K]:+7.0f}"
            + ('  [early era]' if r['early_era'] else '') + ('  [shared]' if r['shared'] else ''))


ranked = [r for r in SP if r['ranked']]
w('GM SAVANT, MODULE 6: REVIEW REPORT')
w(f'{len(SP)} spells (a person credited at one team); {len(ranked)} ranked (two or more seasons in charge). Headline: GM Value Added = '
  'value produced above an average GM in his seat (the league average team that season taken off) + what he left - what he '
  'inherited; ten seasons, 5% a year. Points: 31.7 = one win. The spec formula (no average taken off) stays in the Data Room only.')
w('')
for label, pool in (('ALL-TIME', ranked), ('ACTIVE', [r for r in ranked if r['active']])):
    pool = sorted(pool, key=lambda r: -r['gm_value_added'][K])
    n = min(15, len(pool) // 2)
    w(f'== 1. {label}: top {n}')
    for i, r in enumerate(pool[:n], 1):
        w(line(r, i)); w('      ' + profile(r))
    w(f'== {label}: bottom {n}')
    for i, r in enumerate(pool[::-1][:n], 1):
        w(line(r, i)); w('      ' + profile(r))
    w('')

w('== Discount sensitivity: rank at 0%, 5%, 10%, 20% (top and bottom 10 at 5%)')
rk = {}
for rate in ('0.0', '0.05', '0.1', '0.2'):
    order = sorted(ranked, key=lambda r: -r['gm_value_added'][rate])
    rk[rate] = {(r['person_id'], r['team'], r['start']): i for i, r in enumerate(order, 1)}
base = sorted(ranked, key=lambda r: -r['gm_value_added'][K])
for part, rows in (('top', base[:10]), ('bottom', base[::-1][:10])):
    for r in rows:
        k = (r['person_id'], r['team'], r['start'])
        w(f"  {part:6} {r['person'][:22]:22} {r['team']} {yrs(r):9}  rank " + ' / '.join(f"{rk[x][k]:3}" for x in ('0.0', '0.05', '0.1', '0.2'))
          + '   value ' + ' / '.join(f"{r['gm_value_added'][x]:+6.0f}" for x in ('0.0', '0.05', '0.1', '0.2')))
mv = [abs(rk['0.2'][k] - rk['0.05'][k]) for k in rk['0.05']]
w(f'  across all {len(ranked)} ranked spells, 5% to 20% moves the median spell {np.median(mv):.0f} places, the largest move {max(mv)} places')
w('')

mr = {(r['person_id'], r['team'], r['start']): i for i, r in enumerate(sorted(ranked, key=lambda r: -r['gm_value_added_player'][K]), 1)}
vr = {(r['person_id'], r['team'], r['start']): i for i, r in enumerate(base, 1)}
w('== Headline (luck-adjusted margin) vs the player-value line: the biggest rank changes')
ch = sorted(ranked, key=lambda r: -abs(mr[(r['person_id'], r['team'], r['start'])] - vr[(r['person_id'], r['team'], r['start'])]))[:12]
for r in ch:
    k = (r['person_id'], r['team'], r['start'])
    w(f"  {r['person'][:22]:22} {r['team']} {yrs(r):9}  rank {vr[k]:3} (player-value line {mr[k]:3})   produced: adj. margin {r['produced_margin_adj']:+6.0f}, player value {r['produced_above_average']:+6.0f}")
xs = np.array([r['produced_above_average'] for r in ranked]); ys = np.array([r['produced_margin_adj'] for r in ranked])
w(f'  correlation of the two production measures across ranked spells: {np.corrcoef(xs, ys)[0, 1]:.2f}')
w('')

w('== 2. Is it skill? (out/gm_repeatability.txt has every line)')
for key, row in REP['results'].items():
    sk, g = key.split('|')
    cells = []
    for t in ('date', 'oddeven', 'stakes', 'stake-weighted', 'spell'):
        v = row[t]
        cells.append(f"{t} {v['r']:+.2f} [{v['lo']:+.2f},{v['hi']:+.2f}] n{v['people']} mde{v['mde']:.2f}" if v.get('r') is not None else f"{t} n/a ({v['people']})")
    w(f"  {sk} ({g.replace('_', ' ')}): {row['verdict']}")
    w('      ' + ' | '.join(cells))
w('')

# ---------------------------------------------------------------- ten to check
def decisions_of(r):
    end = r['end'] or '9999'
    out = []
    for d in D:
        if d['team'] != r['team'] or not (r['start'] <= d['agreed'] <= end):
            continue
        wt = sum(p['weight'] for p in d['credit']['people'] if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == r['person_id'])
        if wt:
            out.append((d, wt))
    return out


def label(d):
    if d['type'] == 'draft':
        return f"drafted {d['player']} at {d['slot']}"
    if d['type'] in ('coach hire', 'coach firing'):
        return f"{d['type']}: {d['coach']}" + (f" -> {d['replacement']}" if d.get('replacement') else '')
    if d.get('text'):
        return d['text'][:150]
    return f"{d['type']}: {d.get('player', d.get('asset'))}"


picks = []
byv = sorted(ranked, key=lambda r: -r['gm_value_added'][K])
want = [byv[0], byv[1], byv[-1], byv[-2]]
act = [r for r in byv if r['active']]
want += [act[0], act[-1]]
want += [r for r in byv if r['shared']][:1]
want += [r for r in byv if r['early_era'] and r not in want][:1]
gap = sorted(ranked, key=lambda r: -abs(DT[(r['person_id'], r['team'], r['start'])]['luck']['grade_gap']))
want += [r for r in gap if r not in want][:1]
mid = sorted(ranked, key=lambda r: abs(r['gm_value_added'][K]))
want += [r for r in mid if r not in want and r['seasons'] >= 6][:1]
w('== 3. Ten GMs to check by hand: the five biggest decisions of each, both grades (at the time | how it turned out)')
for r in want[:10]:
    w(f"-- {r['person']} ({r['team']} {yrs(r)}): GM Value Added {r['gm_value_added'][K]:+.0f}, {r['n_decisions']} decisions")
    decs = sorted(decisions_of(r), key=lambda x: -abs((x[0].get('turned_out') or 0) * x[1]))[:5]
    for d, wt in decs:
        at = '   n/a' if d.get('at_time') is None else f"{d['at_time']:+6.0f}"
        lc = ' [low confidence]' if d['low_confidence'] and d['type'] in ('trade', 'sign-and-trade', 'draft') else ''
        w(f"     {d['agreed']} {at} | {d['turned_out']:+6.0f}{'' if wt == 1 else f'  (credit {wt:.2f})'}  {label(d)}{lc}")
w('')

# ---------------------------------------------------------------- gaps by era
def era(d):
    y = int(d['agreed'][:4])
    return '1979-89' if y < 1990 else '1990-99' if y < 2000 else '2000-09' if y < 2010 else '2010-19' if y < 2020 else '2020-26'


E = collections.defaultdict(collections.Counter)
for d in D:
    e = era(d)
    E[e]['decisions'] += 1
    note = d.get('at_time_note') or ''
    if d.get('at_time') is None:
        E[e]['no at-the-time grade'] += 1
    if any('protections unknown' in x for x in d['low_confidence']):
        E[e]['pick protections unknown'] += 1
    if any('repaired ledger event' in x or 'uncertain stretch' in x for x in d['low_confidence']):
        E[e]['repaired ledger'] += 1
    if d['type'] == 'draft':
        E[e]['draft picks'] += 1
    if d['type'] in ('signing', 're-signing', 'extension', 'left in free agency', 'sign-and-trade'):
        E[e]['salary pending'] += 1
eras = ['1979-89', '1990-99', '2000-09', '2010-19', '2020-26']
w('== 4. What is missing, by era (counts of decisions)')
cols = ['decisions', 'no at-the-time grade', 'pick protections unknown', 'repaired ledger', 'draft picks', 'salary pending']
w('  ' + f"{'':26}" + ''.join(f'{e:>10}' for e in eras))
for c in cols:
    w('  ' + f'{c:26}' + ''.join(f'{E[e][c]:>10}' for e in eras))
w('')
WORDING = [
    ('Before 1985 (models)', 'There were not enough earlier seasons to grade this at the time. How it turned out is shown.'),
    ('Drafts before 1990', 'Graded on how it turned out only: no pick curve could be fit on earlier drafts.'),
    ('Pick protections before 2017', 'The protections on this pick are not in our sources, so its at-the-time grade is low confidence.'),
    ('Transactions before 2000', 'Moves before 2000 come from Basketball-Reference, checked against who actually played for each team.'),
    ('Defense before 2007-08', 'Savant value before 2007-08 counts defense only through steals, blocks and rebounds.'),
    ('In-season inputs before 1996-97', 'Deadline moves before 1996-97 are graded without the season so far.'),
    ('Coach moves before 2002-03', 'Shown, not scored: coach moves are scored from 2002-03 on.'),
    ('Boards (every era for now)', 'Drafts are graded against the slot. A consensus board is used only where two independent boards exist (2005 on); until it is built, slot only.'),
    ('Salaries (every era)', 'Value is counted without what he was paid. Value per dollar, cap management and minimum signings arrive with the Contract tab.'),
    ('Departures (every era)', 'When a player leaves with no transaction, the date is inferred from his last game for the team.'),
    ('Repaired ledger', 'This decision depends on a move we reconstructed, so its grades are low confidence.'),
    ('Shared credit', 'Credit is split where two people ran the team at once or the handover date is not known.'),
    ('Headline production', 'Production is the team\'s scoring margin, with opponents\' three-point and free-throw shooting set to the league average. Margin includes coaching.'),
    ('Decision grades', 'Decision grades use Savant player value, which undersells defenders, until RAPM is part of Savant value.'),
    ('Re-signing', 'Re-signings are credited with the value of the player kept, so this may reflect the stars he had. A percentile waits until salaries let us test value against cost.'),
    ('Free-agency departures', 'A player who left in free agency before playing a game for the next GM counts in neither what one GM left nor what the other inherited.'),
    ('2027 lottery', 'The 2027 lottery follows the NBA\'s announced format; later years assume the current rules.'),
]
w('  The page wording for each gap:')
for k, v in WORDING:
    w(f'   - {k}: "{v}"')
open(os.path.join(OUT, 'review_report.txt'), 'w').write('\n'.join(L) + '\n')
print('\n'.join(L[:3]))
