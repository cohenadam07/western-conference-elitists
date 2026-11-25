"""
conserve.py — the conservation check: no point of value is ever credited twice, or lost.

For every team-season (1980-81 to the last completed season), the value credited to all of the team's decisions for
that season (grade.py's decision streams: what each brought in less what it sent out, each asset at its own
production) plus the moves no one decided must equal what the team's players actually produced that season (each
player's Savant value times his share of the team's minutes). The moves no one decided are booked here, credited to
no GM: the rosters of 1979 and expansion drafts, each team's own draft picks, a pick becoming draft rights on draft
night, retirements, and the ledger's repairs (where the source shows a move the history before it lacks).

    python3 conserve.py              # -> out/conservation.json and a report; exit 1 if any team-season is off
"""
import collections, json, os, sys

import grade as G

TOL = 0.5          # value points: rounding in the stored streams
# What is left is a handful of ledger cases, each named below with its gap. The check fails the build if a team-season
# not named here is off by more than TOL, if a named one's gap moves by more than TOL, or if a named one now balances
# (take it off the list), and, as before, if any is off by more than MAX_ONE or all of them by more than MAX_ALL.
# (Nov 25, 2026: CHI 1999-00 was 1.6 off after a full rebuild and nothing failed: only the two limits were checked.)
MAX_ONE, MAX_ALL = 50.0, 150.0
KNOWN = {          # (team, season): gap, as of Nov 25, 2026, after same-day repeats in the source were skipped (ledger.py)
    ('IND', 2003): -41.2, ('BOS', 2026): -15.5, ('SAS', 2015): -5.3, ('TOR', 2023): -1.7, ('DET', 2025): -0.7, ('WAS', 2008): 0.6,
}


def booked():
    """{team: Counter(season -> value)} for the moves no decision covers, and their totals by kind."""
    out = collections.defaultdict(collections.Counter)
    kinds = collections.Counter()
    graded = {'trade', 'sale', 'sign', 'claim', 're-sign', 'waive', 'release', 'lapsed (inferred)'}
    for aid, ev in G.EV.items():
        if not (aid.startswith('player:') or aid.startswith('pick:')):
            continue
        for pos, (d, i, e) in enumerate(ev):
            k = e['kind']
            if k in graded:
                continue
            if k == 'drafted' and pos and ev[pos - 1][2]['to'] == e['to']:
                continue                                          # drafted by the team that already had him
            st = G.R(aid, pos)
            if e['from'] not in G.NON_TEAM:                       # it leaves a team's books
                for y, v in st:
                    out[e['from']][y] -= v
                kinds[k] -= sum(v for y, v in st if y < G.NOW_SEASON)
            if e['to'] not in G.NON_TEAM:                         # it arrives on a team's books
                for y, v in st:
                    out[e['to']][y] += v
                kinds[k] += sum(v for y, v in st if y < G.NOW_SEASON)
        # on a team's books before the ledger first sees it: each team's own picks (no one acquired them), and a
        # player whose first recorded move is out of a team (acquired before 1979-80, moved before its first game)
        if ev and ev[0][2]['from'] not in G.NON_TEAM and ev[0][2]['from'] != 'OPENING':
            st = G.R(aid, 0)
            for y, v in st:
                out[ev[0][2]['from']][y] += v
            kinds['own picks' if aid.startswith('pick:') else 'held before 1979-80'] += sum(v for y, v in st if y < G.NOW_SEASON)
    return out, kinds


def drafts_not_graded(D):
    """A drafted player whose draft is not graded (round 3 and later, before 1980, no Basketball-Reference id): his
    rights turn into his career with no decision to carry the difference, so it is booked here."""
    graded = {(d['player_br'], d['team']) for d in D if d['type'] == 'draft'}
    out = collections.defaultdict(collections.Counter)
    for aid, ev in G.EV.items():
        if not aid.startswith('player:'):
            continue
        for pos, (d, i, e) in enumerate(ev):
            if e['kind'] != 'drafted':
                continue
            pid = G.pid_of(aid)
            chose, already = G.rights_holder(aid, d, e['to'])
            if already or (aid.split(':', 1)[1], chose) in graded:
                continue
            rw = G.rights_window(aid, d)
            if not rw:
                continue
            vid = G.vid_of(aid)
            car = collections.Counter({y: G.VAL[(vid, y)] for y in range(rw[0] + 1, G.NOW_SEASON + 1) if (vid, y) in G.VAL})
            for y, v in G.stream_sum([(1, tuple(car.items())), (-1, G.slot_seasons(*rw))]):
                out[chose][y] += v
    return out


def main():
    D = json.load(open(os.path.join(G.OUT, 'gm_decisions.json')))
    S = json.load(open(os.path.join(G.OUT, 'decision_streams.json')))
    byid = {d['decision_id']: d for d in D}
    credited = collections.defaultdict(collections.Counter)
    by_type = collections.defaultdict(collections.Counter)
    for sid, st in S.items():
        d = byid[sid]
        for y, v in st:
            credited[(d['team'], y)][d['type']] += v
            by_type[d['type']][y] += v
    book, kinds = booked()
    nodraft = drafts_not_graded(D)
    produced = collections.Counter()
    for (pid, y), sh in G.SHARE.items():
        v = G.VAL.get((pid, y))
        if v is None:
            continue
        for t, f in sh.items():
            produced[(t, y)] += v * f
    seasons = range(1981, G.NOW_SEASON)
    teams = sorted({t for t, y in produced} | {t for t, y in credited})
    rows, off = [], []
    for t in teams:
        for y in seasons:
            dec = sum(credited[(t, y)].values())
            other = book[t][y] + nodraft[t][y]
            pr = produced[(t, y)]
            if not pr and not dec and not other:
                continue
            gap = dec + other - pr
            rows.append({'team': t, 'season': y, 'produced': round(pr, 1), 'decisions': round(dec, 1), 'booked': round(other, 1), 'gap': round(gap, 1),
                         'by_type': {k: round(v, 1) for k, v in credited[(t, y)].items() if abs(v) > 0.05}})
            if abs(gap) > TOL:
                off.append(rows[-1])
    json.dump({'tolerance': TOL, 'team_seasons': len(rows), 'off': off, 'booked_by_kind': {k: round(v, 1) for k, v in kinds.items()}, 'rows': rows},
              open(os.path.join(G.OUT, 'conservation.json'), 'w'))
    tot_pr = sum(r['produced'] for r in rows)
    print(f'{len(rows)} team-seasons, 1980-81 to {G.NOW_SEASON - 2}-{str(G.NOW_SEASON - 1)[2:]}: {len(rows) - len(off)} balance within {TOL} '
          f'points; {len(off)} do not (total gap {sum(abs(r["gap"]) for r in off):,.0f} of {tot_pr:,.0f} produced)')
    print('booked, credited to no GM:', {k: round(v) for k, v in kinds.most_common()}, '| drafts not graded:', round(sum(sum(c.values()) for c in nodraft.values())))
    for r in sorted(off, key=lambda r: -abs(r['gap']))[:12]:
        print(f"   {r['team']} {r['season']}: produced {r['produced']:,.0f}, decisions {r['decisions']:,.0f}, booked {r['booked']:,.0f}, gap {r['gap']:+,.0f}  {r['by_type']}")
    worst = max((abs(r['gap']) for r in off), default=0.0)
    total = sum(abs(r['gap']) for r in off)
    ok = worst <= MAX_ONE and total <= MAX_ALL
    print(f"{'PASS' if ok else 'FAIL'}: largest team-season gap {worst:.1f} (limit {MAX_ONE}), all gaps {total:.1f} (limit {MAX_ALL})")
    problems = []
    for r in off:
        k = (r['team'], r['season'])
        if k not in KNOWN:
            problems.append(f"{r['team']} {r['season']} is off by {r['gap']:+.1f}, and it is not a known case")
        elif abs(r['gap'] - KNOWN[k]) > TOL:
            problems.append(f"{r['team']} {r['season']}'s gap moved: {KNOWN[k]:+.1f} known, {r['gap']:+.1f} now")
    for k in sorted(set(KNOWN) - {(r['team'], r['season']) for r in off}):
        problems.append(f'{k[0]} {k[1]} now balances: take it off KNOWN')
    for x in problems:
        print('FAIL:', x)
    if not problems:
        print(f'PASS: every team-season off by more than {TOL} is a known case, at its known gap ({len(KNOWN)})')
    ok = ok and not problems
    return 0 if ok else 1


def per_asset(aid, drafts_of, netted):
    """{team: Counter(season -> value)} credited for one asset, by the same rules as the decisions and the booked
    moves (for diagnose: it must add up to the same team totals)."""
    out = collections.defaultdict(collections.Counter)
    ev = G.EV.get(aid, [])
    add = lambda t, st, sign: [out[t].__setitem__(y, out[t][y] + sign * v) for y, v in st] if t not in G.NON_TEAM else None
    if ev and ev[0][2]['from'] not in G.NON_TEAM and ev[0][2]['from'] != 'OPENING':
        add(ev[0][2]['from'], G.R(aid, 0), 1)
    for pos, (d, i, e) in enumerate(ev):
        k, before = e['kind'], (ev[pos - 1][2]['to'] if pos else (e['from'] if e['from'] not in G.NON_TEAM else None))
        if k in ('trade', 'sale'):
            if (aid, e.get('tx'), e['to']) not in netted:
                add(e['to'], G.R(aid, pos), 1)
            if (aid, e.get('tx'), e['from']) not in netted:
                add(e['from'], G.R(aid, pos), -1)
        elif k in ('sign', 'claim', 're-sign'):
            if before != e['to']:
                add(e['to'], G.R(aid, pos), 1)
        elif k in ('waive', 'release', 'lapsed (inferred)'):
            if before == e['from']:
                add(e['from'], G.R(aid, pos), -1)
        elif not (k == 'drafted' and pos and ev[pos - 1][2]['to'] == e['to']):
            add(e['to'], G.R(aid, pos), 1)
            add(e['from'], G.R(aid, pos), -1)
    if aid.startswith('player:'):
        vid = G.vid_of(aid)
        for team, Y, ov, dd in drafts_of.get(aid.split(':', 1)[1], []):
            for y, v in G.stream_sum([(1, tuple((y_, G.VAL[(vid, y_)]) for y_ in range(Y + 1, G.NOW_SEASON + 1) if (vid, y_) in G.VAL)), (-1, G.slot_seasons(Y, ov, dd))]):
                out[team][y] += v
    return out


def diagnose():
    """Every remaining gap, player by player, by kind."""
    D = json.load(open(os.path.join(G.OUT, 'gm_decisions.json')))
    drafts_of = collections.defaultdict(list)
    for d in D:
        if d['type'] == 'draft':
            drafts_of[d['player_br']].append((d['team'], int(d['date'][:4]), d['slot'], d['date']))
    for aid, ev in G.EV.items():                       # drafts not graded, as booked
        if not aid.startswith('player:'):
            continue
        for pos, (d, i, e) in enumerate(ev):
            if e['kind'] == 'drafted':
                pid = G.pid_of(aid)
                chose, already = G.rights_holder(aid, d, e['to'])
                rw = G.rights_window(aid, d)
                br = aid.split(':', 1)[1]
                if rw and not already and not any(t == chose for t, *_ in drafts_of.get(br, [])):
                    drafts_of[br].append((chose, rw[0], rw[1], rw[2]))
    netted = set()
    for tx, es in G.BYTX.items():
        ins, outs = collections.defaultdict(set), collections.defaultdict(set)
        for e in es:
            if e['kind'] in ('trade', 'sale'):
                ins[e['to']].add(e['asset']); outs[e['from']].add(e['asset'])
        for t in set(ins) | set(outs):
            for a in ins[t] & outs[t]:
                netted.add((a, tx, t))
    team = collections.defaultdict(collections.Counter)
    cat, ex = collections.Counter(), collections.defaultdict(list)
    for aid, ev in G.EV.items():
        if not (aid.startswith('player:') or aid.startswith('pick:')):
            continue
        c = per_asset(aid, drafts_of, netted)
        for t, st in c.items():
            for y, v in st.items():
                team[(t, y)]['credit'] += v
        if not aid.startswith('player:'):
            continue
        pid = G.vid_of(aid)
        for y in range(1981, G.NOW_SEASON):
            v = G.VAL.get((pid, y)) or 0.0
            sh = G.SHARE.get((pid, y), {})
            for t in set(sh) | {t for t in c if abs(c[t].get(y, 0)) > 0.05}:
                gap = c[t].get(y, 0.0) - v * sh.get(t, 0.0)
                if abs(gap) < 0.5:
                    continue
                on = any(x[0] < f'{y}-07-01' and x[2]['to'] == t for x in ev) and not all(
                    (x[2]['from'] == t and x[0] < f'{y - 1}-07-01') or x[0] >= f'{y}-07-01' or x[2]['to'] != t for x in ev)
                k = ('played there, not on its books' if sh.get(t) and gap < 0 else
                     'on its books, played elsewhere' if not sh.get(t) and gap > 0 else
                     'on its books, negative (left after a cut-off)' if not sh.get(t) else 'both, but credit differs')
                cat[k] += abs(gap)
                if len(ex[k]) < 6:
                    ex[k].append((aid, y, t, round(gap)))
    for (t, y), c in team.items():
        v = c['credit']
    for k, v in cat.most_common():
        print(f'{v:9,.0f}  {k}  {ex[k]}')
    return team


if __name__ == '__main__':
    if sys.argv[1:2] == ['diagnose']:
        diagnose()
        sys.exit(0)
    sys.exit(main())
