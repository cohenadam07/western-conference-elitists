"""
repeat6.py — is each GM skill a skill? The repeatability test four ways, plus how small a correlation each could see.

Every grade is first taken against the league average for that decision type that season (gm5.demean), and
weighted by the person's credit share, as in gm5.

  date     a person's decisions in date order, first half vs second half (gm5's test)
  oddeven  the same decisions, alternate ones (1st, 3rd, 5th... vs 2nd, 4th...): removes drift within a career
  stakes   only decisions that matter: first-round picks, and trades and signings whose value at stake at the time
           (the projected ten-season value of everything moving, both ways, 5% discount) is at least STAKE points;
           and, separately, every decision weighted by its value at stake
  spell    each spell (one person at one team) on its own, instead of a person pooled across all his spells
For each: the correlation across people, its 95% interval, the people in it, and the smallest true correlation the
test would find four times in five (80% power, two-sided 5%): tanh(2.80 / sqrt(people - 3)).

    python3 repeat6.py      # -> out/gm_repeatability.txt, out/gm_repeatability.json
"""
import collections, json, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
import gm5  # noqa: E402
GR = gm5.GR

STAKE = 300.0          # points over ten seasons: about nine and a half wins at 31.7 points per win
MIN_N = 8              # graded decisions a person needs to be split
SKILLS = gm5.SKILLS
GRADES = ('turned_out', 'at_time')


def stake(d):
    if d['type'] == 'draft':
        return d.get('slot_expected') or 0.0
    if d['type'] == 'hold':
        return max(0.0, d['proj'])                 # the young player's projected ten seasons when the window opened
    y0 = GR.season_of(d['agreed'])
    if d['type'] in ('trade', 'sign-and-trade'):
        return sum(GR.pv_total(a, d['agreed'], y0)[0] for a in d['in'] + d['out'])
    if d.get('asset'):
        return GR.pv_total(d['asset'], d['agreed'], y0)[0]
    return 0.0


def matters(d, st):
    if d['type'] == 'draft':
        return d.get('round') == 1
    if d['type'] in ('trade', 'sign-and-trade', 'signing', 're-signing', 'extension', 'hold'):
        return st >= STAKE
    return True                   # coach moves: every one matters


def corr(pairs):
    if len(pairs) < 12:
        return None
    x, y = np.array(pairs).T
    if x.std() == 0 or y.std() == 0:
        return None
    r = float(np.corrcoef(x, y)[0, 1])
    n = len(pairs)
    z, se = math.atanh(max(min(r, 0.999), -0.999)), 1 / math.sqrt(n - 3)
    return {'r': r, 'lo': math.tanh(z - 1.96 * se), 'hi': math.tanh(z + 1.96 * se), 'people': n, 'mde': math.tanh(2.80 / math.sqrt(n - 3))}


def halves(xs, how):
    """xs: [(date, value, weight)] -> (a, b) weighted means"""
    xs = sorted(xs)
    if how == 'oddeven':
        a, b = xs[0::2], xs[1::2]
    else:
        h = len(xs) // 2
        a, b = xs[:h], xs[h:]
    m = lambda z: sum(v * w for _, v, w in z) / sum(w for _, v, w in z)
    return m(a), m(b)


def main():
    spells = json.load(open(os.path.join(OUT, 'gm_spells.json')))
    D = gm5.D + gm5.HOLDS            # holding is a skill: its credits join the decisions here, and only here
    by_team = collections.defaultdict(list)
    for d in D:
        by_team[d['team']].append(d)
    print('value at stake ...', flush=True)
    ST = {}
    for d in D:
        if any(s in gm5.skill_of(d) for s in SKILLS):
            ST[id(d)] = stake(d)
    vals = [v for d in D if id(d) in ST and d['type'] in ('trade', 'signing', 're-signing', 'extension') for v in [ST[id(d)]]]
    share_kept = {t: np.mean([ST[id(d)] >= STAKE for d in D if d['type'] == t and id(d) in ST]) for t in ('trade', 'signing', 're-signing', 'extension')}
    per_spell, per_person = {}, collections.defaultdict(list)
    for sp in spells:
        end = sp['end'] or GR.TODAY
        decs = []
        for d in by_team[sp['team']]:
            if sp['start'] <= d['agreed'] <= end:
                wt = sum(p['weight'] for p in d['credit']['people'] if gm5.TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == sp['person_id'])
                if wt:
                    decs.append((d, wt))
        key = (sp['person_id'], sp['team'], sp['start'])
        per_spell[key] = decs
        per_person[sp['person_id']] += decs
    dm_person = gm5.demean(per_person)
    # demean the spell table with the same averages (the demeaned dicts are copies keyed by position)
    dm_lookup = {}
    for pid, decs in per_person.items():
        for (d, wt), (dd, _) in zip(decs, dm_person[pid]):
            dm_lookup[id(d)] = dd
    res, rep = {}, []
    rep.append('Is it skill? Grades taken against the league average for that decision type that season; credit-weighted. '
               f'Decisions that matter: first-round picks; trades and signings with {STAKE:.0f}+ points at stake at the time '
               '(everything moving, both ways, ten seasons at 5%); every coach move.')
    rep.append('kept by the stake rule: ' + ', '.join(f'{t} {v:.0%}' for t, v in share_kept.items()) +
               f'; median stake among trades and signings {np.median(vals):.0f} points')
    rep.append('mde = the smallest true correlation the test would find four times in five.')
    rep.append('')
    for sk in SKILLS:
        for g in GRADES:
            row = {}
            for test in ('date', 'oddeven', 'stakes', 'stake-weighted', 'spell'):
                pairs = []
                groups = per_spell.items() if test == 'spell' else per_person.items()
                for key, decs in groups:
                    xs = []
                    for d, wt in decs:
                        dd = dm_lookup[id(d)]
                        if sk not in gm5.skill_of(d) or dd.get(g) is None:
                            continue
                        stv = ST.get(id(d), 0.0)
                        if test == 'stakes' and not matters(d, stv):
                            continue
                        w = max(stv, 1.0) if test == 'stake-weighted' else 1.0
                        xs.append((d['agreed'], dd[g] * wt, w))
                    if len(xs) >= MIN_N:
                        pairs.append(halves(xs, 'oddeven' if test == 'oddeven' else 'date'))
                row[test] = corr(pairs)
                if row[test] is None:
                    row[test] = {'people': len(pairs)}
            res[f'{sk}|{g}'] = row
            sig = [t for t, v in row.items() if v.get('lo') is not None and v['lo'] > 0]
            neg = [t for t, v in row.items() if v.get('hi') is not None and v['hi'] < 0]
            tested = [t for t, v in row.items() if v.get('r') is not None]
            if not tested:
                verdict = 'not testable (too few people with 8+ graded decisions)'
            elif 'date' in sig and 'oddeven' in sig:
                verdict = 'skill: repeats'
            elif sig:
                verdict = 'unclear: repeats only in ' + ', '.join(sig)
            else:
                verdict = 'describes what happened'
            row['verdict'] = verdict
            rep.append(f'{sk} ({g.replace("_", " ")}): {verdict}')
            for t, v in row.items():
                if t == 'verdict':
                    continue
                if v.get('r') is None:
                    rep.append(f'    {t:15} too few people ({v["people"]})')
                else:
                    rep.append(f'    {t:15} r {v["r"]:+.2f} [{v["lo"]:+.2f}, {v["hi"]:+.2f}]  people {v["people"]:3}  mde {v["mde"]:.2f}')
    open(os.path.join(OUT, 'gm_repeatability.txt'), 'w').write('\n'.join(rep) + '\n')
    json.dump({'stake': STAKE, 'min_n': MIN_N, 'results': res}, open(os.path.join(OUT, 'gm_repeatability.json'), 'w'), indent=1)
    print('\n'.join(rep))


if __name__ == '__main__':
    main()
