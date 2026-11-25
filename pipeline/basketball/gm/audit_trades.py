"""
audit_trades.py — check one GM's trade grades from the ground up (Module 8 question on Presti; reusable for the
Module 9 spot-checks):

  (a) every season's trades, all sides together, sum to about zero (a trade only moves value between teams);
  (b) players drafted with picks a trade brought in flow back to that trade at the slot's expectation, and the
      draft grade (career minus slot) goes to the team that chose, so the two add up to the career;
  (c) unconveyed future picks: what each is worth today and how it is valued;
  (d) any partner's trades one by one;
  and the GM's biggest trades with both grades.

    python3 audit_trades.py "Sam Presti" HOU        -> out/audit_trades_<id>.txt
"""
import collections, json, os, sys

import grade as G

HERE = os.path.dirname(os.path.abspath(__file__))


def name(aid):
    a = G.A.get(aid, {})
    if aid.startswith('swap:'):
        y, r = aid.split(':')[1:3]
        return f"{y} {'1st' if r == '1' else '2nd'} swap"
    if aid.startswith('cash:'):
        return 'cash'
    if aid.startswith('pick:'):
        s = f"{a.get('year')} {'1st' if a.get('round') == 1 else '2nd'}"
        return s + (f" ({a['became_name']})" if a.get('became_name') else '')
    return a.get('name') or aid.split(':', 1)[1]


def main(person, partner):
    D = json.load(open(os.path.join(G.OUT, 'gm_decisions.json')))
    mine = lambda d: any(p['person'] == person for p in (d.get('credit') or {}).get('people', []))
    T = [d for d in D if d['type'] in ('trade', 'sign-and-trade') and mine(d)]
    out = [f'{person}: {len(T)} trades credited (both grades are value points, ten seasons, 5% a year).', '']

    # (a)
    by = collections.defaultdict(lambda: [0.0, 0.0, 0])
    for d in D:
        if d['type'] in ('trade', 'sign-and-trade'):
            s = G.season_of(d['agreed'])
            by[s][0] += d['turned_out'] or 0
            by[s][1] += d['at_time'] or 0
            by[s][2] += 1
    worst = max(by.items(), key=lambda kv: abs(kv[1][0]))
    tx_off = collections.defaultdict(float)
    for d in D:
        if d['type'] in ('trade', 'sign-and-trade'):
            tx_off[d['tx']] += d['turned_out'] or 0
    off = [(tx, v) for tx, v in tx_off.items() if abs(v) > 1]
    out.append(f"(a) Seasons summed over every team's side of every trade: the largest season total is {worst[1][0]:+.1f} "
               f"(as they turned out, {worst[0]}, {worst[1][2]} sides) and {max(abs(v[1]) for v in by.values()):.1f} at the time. "
               f"Of {len(tx_off):,} trades, {len(off)} don't net to zero within 1 point" +
               (f"; the largest is {max(abs(v) for _, v in off):.0f} (a three-team trade where one side's asset left the books)." if off else '.'))
    out.append(f"    {person}'s own seasons: as they turned out " + ', '.join(f"{s}: {sum(d['turned_out'] for d in T if G.season_of(d['agreed']) == s):+.0f}"
                                                           for s in sorted({G.season_of(d['agreed']) for d in T})))
    out.append('')

    # (b)
    team = T[0]['team'] if T else None
    drafts = {d['player_id']: d for d in D if d['type'] == 'draft'}
    rows, ok = [], 0
    for d in T:
        for aid in d['in']:
            a = G.A.get(aid, {})
            if not (aid.startswith('pick:') and a.get('became') and a.get('overall')):
                continue
            pid = G.pid_of('player:' + a['became'])
            in_trade = G.rv_total(aid, d['team'], d['date'], G.season_of(d['agreed']))
            y0 = G.season_of(d['agreed'])
            conv = next((e['date'] for e in G.E if e['asset'] == aid and e['kind'] == 'conveyed'), None)   # draft day: the slot as valued then
            slot = sum(v * G.w(y, y0) for y, v in G.slot_seasons(a['year'], a['overall'], conv or d['date']) if y0 <= y < y0 + G.HORIZON)
            dr = drafts.get(pid)
            ev = [e for e in G.E if e['asset'] == aid]
            used = any(e['kind'] == 'conveyed' and e['from'] == d['team'] for e in ev)     # still his when it was used
            gap = not used and any(e['kind'] == 'repair' and e['from'] == d['team'] for e in ev)
            if used:
                ok += abs(in_trade - slot) < 0.5
            rows.append((d['agreed'], name(aid), a['overall'], in_trade, slot, dr['team'] if dr else None, dr['turned_out'] if dr else None, used, gap))
    used = [r for r in rows if r[7]]
    out.append(f'(b) Picks his trades brought in that became players: {len(rows)}. {len(used)} he used himself: each is credited to '
               f'the trade at exactly the slot\'s expectation ({ok} of {len(used)} check out), and what the player made of it beyond '
               f'the slot is the drafting grade of whoever held him when the next season began (usually his own team; the team he '
               f'traded the rights to on draft night otherwise), so trade plus draft is the career, counted once. The other {len(rows) - len(used)} he '
               'traded on before the draft: the trade gets whatever the pick turned into, and the drafting grade goes to the team that chose.'
               + (f" {sum(1 for r in rows if r[8])} of those leave the books through a repair (the source shows another team trading a pick "
                  "the ledger had with him; the trade that moved it is missing), so the trade gets nothing for them: "
                  + '; '.join(f"{r[1]} ({r[3]:.0f})" for r in rows if r[8]) if any(r[8] for r in rows) else '') + ':')
    for r in sorted(rows, key=lambda r: -(r[6] or 0))[:12]:
        out.append(f"    {r[0]}  {r[1]:<34} slot {r[2]:>2}: in the trade {r[3]:>6.0f} (slot value {r[4]:>6.0f}); "
                   f"drafting grade {r[6]:+6.0f} to {r[5]}{'' if r[7] else '  (repair: value lost)' if r[8] else '  (traded on)'}" if r[6] is not None else f'    {r[0]}  {r[1]} slot {r[2]}: in the trade {r[3]:.0f}')
    out.append('')

    # (c)
    fut = []
    for d in T:
        for side, sign in (('in', 1), ('out', -1)):
            for aid in d[side]:
                a = G.A.get(aid, {})
                if aid.startswith('pick:') and not a.get('resolved') and (a.get('year') or 0) >= G.NOW_SEASON:
                    owner, prot = G.SN.pick_inputs(a, G.TODAY, G.DRAFT_DATE.get(a.get('year')))
                    v = G.rv_total(aid, d['team'] if sign > 0 else next((e['to'] for e in G.BYTX.get(d['tx'], []) if e['asset'] == aid), None),
                                   d['date'], G.season_of(d['agreed']))
                    fut.append((sign, d['agreed'], name(aid), owner, prot, v))
    net = sum(s * v for s, *_, v in fut)
    out.append(f'(c) Unconveyed future picks in his trades: {sum(1 for f in fut if f[0] > 0)} in, {sum(1 for f in fut if f[0] < 0)} out, '
               f'net {net:+.0f}. Each is the pick model as of today: the original owner\'s slot distribution from a lottery '
               'simulation of the seasons left before that draft, times the slot curve, minus protection where the terms are known:')
    for s, ag, nm, owner, prot, v in sorted(fut, key=lambda f: -f[5])[:10]:
        out.append(f"    {'got ' if s > 0 else 'gave'} {nm:<10} {owner or 'owner unknown':<14} {('top-%d protected' % prot) if prot else '':<16} {v:>5.0f}   ({ag})")
    out.append('')

    # (d)
    P = [d for d in T if partner and partner in {e['to'] for e in G.BYTX.get(d['tx'], [])} | {e['from'] for e in G.BYTX.get(d['tx'], [])}]
    out.append(f"(d) Against {partner}: {len(P)} trades, {sum(d['turned_out'] for d in P):+.0f} as they turned out, "
               f"{sum(d['at_time'] or 0 for d in P):+.0f} at the time:")
    for d in sorted(P, key=lambda d: d['agreed']):
        out.append(f"    {d['agreed']}  {d['turned_out']:+7.0f}  at the time {d['at_time'] if d['at_time'] is not None else '—':>7}   "
                   f"gave {', '.join(name(a) for a in d['out'])[:70]} | got {', '.join(name(a) for a in d['in'])[:80]}")
    out.append('')
    out.append(f"His ten biggest trades (by size as they turned out); total of all {len(T)}: {sum(d['turned_out'] for d in T):+.0f} as they "
               f"turned out, {sum(d['at_time'] or 0 for d in T):+.0f} at the time:")
    for d in sorted(T, key=lambda d: -abs(d['turned_out']))[:10]:
        out.append(f"    {d['agreed']}  turned out {d['turned_out']:+7.0f}  at the time {d['at_time'] if d['at_time'] is not None else '—':>7}   "
                   f"gave {', '.join(name(a) for a in d['out'])[:70]} | got {', '.join(name(a) for a in d['in'])[:90]}")
    pid = next((p['tenure_id'].split(':')[0] for d in T for p in d['credit']['people'] if p['person'] == person), 'gm')
    path = os.path.join(G.OUT, f'audit_trades_{pid}.txt')
    open(path, 'w').write('\n'.join(out) + '\n')
    print('\n'.join(out))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
