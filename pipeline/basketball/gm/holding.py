"""
holding.py — the holding skill: credit for keeping a young player an average GM would sometimes have traded away.

Every young player (24 or younger that season) on a team's books when a trade window opens is an opportunity:
  windows   each season's deadline (the 30 days up to its last in-season trade, as gm5_detail) and its offseason
            (the regular season's last game to the next season's first)
  held      on the books when the window opened and still on them when it closed, not traded in between
  traded    traded away by the team inside the window (a waiver or a departure in free agency is neither)
Cells: age (21 or younger, 22, 23, 24) x projected ten-season value at the window's opening (5% a year), from
the projection used everywhere else.
In each cell, from earlier seasons only:
  rate      traded / opportunities
  loss      when one was traded, the value the team gave up: minus that trade's grade, his share of it (his projected
            value against everything the team sent out); as it turned out from the trade's turned-out grade, at the
            time from its at-the-time grade
  credit    for each player held: rate x mean loss. A cell with fewer than 30 earlier opportunities uses the
            projection band alone, then every young player.
Holding is its own skill, taken against the league average for that season like every other skill (gm5.demean),
counted in players kept (a player's windows at one team under one credit, summed), not in windows.
It is a comparison with what an average GM would have done, not value that moved, so it stays out of GM Value
Added and out of the conservation check.

    python3 holding.py      # -> out/gm_holds.json
"""
import bisect, collections, datetime as _dt, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
import gm5  # noqa: E402
import gm5_detail as GD  # noqa: E402
GR = gm5.GR

YOUNG = 24
PROJ_EDGES = (150, 400, 800, 1500)
MIN_CELL = 30
MIN_TRADES = 10                  # trades behind a cell's mean loss (fewer and one trade decides it)
FIRST = 1990                     # at-the-time trade grades start here (the first projection fit on earlier seasons)


def age_band(a):
    return max(0, int(a) - 21)          # whole years that season: 21 or younger, 22, 23, 24


def proj_band(v):
    return bisect.bisect_right(PROJ_EDGES, v)


AGE = {}
for r in GR.ROWS:
    AGE[(r['id'], r['y'])] = r['age']


def age_of(aid, y):
    pid = GR.pid_of(aid)
    if (pid, y) in AGE:
        return AGE[(pid, y)]
    if (pid, y - 1) in AGE:
        return AGE[(pid, y - 1)] + 1
    return None


def windows():
    out = []
    for y in sorted(GD.DEADLINE):
        if y < FIRST or y > GR.NOW_SEASON:
            continue
        dl = GD.DEADLINE[y]
        start = (_dt.date.fromisoformat(dl) - _dt.timedelta(days=30)).isoformat()
        out.append(('deadline', y, start, dl))
        last, nxt = GD._last.get(y), GD._first.get(y + 1)
        if last and nxt and nxt <= GR.TODAY:
            out.append(('offseason', y, (_dt.date.fromisoformat(last) + _dt.timedelta(days=1)).isoformat(), nxt))
    return out


def main():
    W = windows()
    teams = sorted({e['to'] for e in GR.E if e['to'] and e['to'] not in GR.NON_TEAM})
    q = [(s, t) for k, y, s, e in W for t in teams] + [((_dt.date.fromisoformat(e) + _dt.timedelta(days=1)).isoformat(), t) for k, y, s, e in W for t in teams]
    H = gm5.holdings(q)
    TRADE = {(d['tx'], d['team']): d for d in gm5.D if d['type'] in ('trade', 'sign-and-trade') and d.get('tx')}
    OUTS = collections.defaultdict(list)          # (team, asset) -> trade-away dates and tx
    for e in GR.E:
        if e['kind'] == 'trade' and e['from'] and e['from'] not in GR.NON_TEAM:
            OUTS[(e['from'], e['asset'])].append((e['date'], e.get('tx')))
    opps = []
    for k, y, s, e in W:
        end_q = (_dt.date.fromisoformat(e) + _dt.timedelta(days=1)).isoformat()
        y0 = GR.season_of(s)
        for t in teams:
            held_after = set(H.get((end_q, t), []))
            for a in H.get((s, t), []):
                if not a.startswith('player:'):
                    continue
                age = age_of(a, y)
                if age is None or int(age) > YOUNG:
                    continue
                tr = [(d, tx) for d, tx in OUTS.get((t, a), []) if s <= d <= e]
                if tr:
                    status = 'traded'
                elif a in held_after:
                    status = 'held'
                else:
                    continue
                proj = GR.pv_total(a, s, y0)[0]
                o = {'window': k, 'season': y, 'start': s, 'end': e, 'team': t, 'asset': a, 'player': GR.A.get(a, {}).get('name'),
                     'age': age, 'proj': round(proj, 1), 'status': status}
                if tr:
                    d, tx = tr[0]
                    dec = TRADE.get((tx, t))
                    if dec:
                        outs = [x for x in dec['out'] if x.startswith('player:') or x.startswith('pick:')]
                        pvs = {x: max(0.0, GR.pv_total(x, d, GR.season_of(d))[0]) for x in outs}
                        share = pvs.get(a, 0.0) / (sum(pvs.values()) or 1.0)
                        o['trade'] = dec.get('decision_id')
                        o['traded_on'] = d
                        o['share'] = round(share, 3)
                        o['loss_turned_out'] = None if dec.get('turned_out') is None else round(-dec['turned_out'] * share, 1)
                        o['loss_at_time'] = None if dec.get('at_time') is None else round(-dec['at_time'] * share, 1)
                opps.append(o)
        print(k, y, len(opps), flush=True)

    # cells from earlier seasons only
    by_season = collections.defaultdict(list)
    for o in opps:
        by_season[o['season']].append(o)
    acc = collections.defaultdict(lambda: {'n': 0, 'traded': 0, 'to': [], 'at': []})

    def add(o):
        for key in ((age_band(o['age']), proj_band(o['proj'])), (None, proj_band(o['proj'])), (None, None)):
            c = acc[key]
            c['n'] += 1
            if o['status'] == 'traded':
                c['traded'] += 1
                if o.get('loss_turned_out') is not None:
                    c['to'].append(o['loss_turned_out'])
                if o.get('loss_at_time') is not None:
                    c['at'].append(o['loss_at_time'])

    def cell(o):
        for key in ((age_band(o['age']), proj_band(o['proj'])), (None, proj_band(o['proj'])), (None, None)):
            c = acc.get(key)
            if c and c['n'] >= MIN_CELL and len(c['to']) >= MIN_TRADES:
                return key, c
        return None, None

    holds = []
    for y in sorted(by_season):
        for o in by_season[y]:
            if o['status'] != 'held':
                continue
            key, c = cell(o)
            if not c:
                continue
            rate = c['traded'] / c['n']
            lt = sum(c['to']) / len(c['to'])
            la = sum(c['at']) / len(c['at']) if len(c['at']) >= MIN_TRADES else None
            cr = GR.credit(o['team'], o['end'])
            holds.append(dict(o, type='hold', agreed=o['end'], date=o['end'], cell=list(key), cell_n=c['n'], rate=round(rate, 3),
                              mean_loss_turned_out=round(lt, 1), mean_loss_at_time=None if la is None else round(la, 1),
                              turned_out=round(rate * lt, 1), at_time=None if la is None else round(rate * la, 1), credit=cr))
        for o in by_season[y]:
            add(o)
    # the unit a skill is measured in: one young player kept at one team under one credit, his windows summed (a
    # deadline and the offseason after it are the same player kept, so counting windows separately makes holding look
    # repeatable when it is not: measured, oddeven r +0.58 by window, +0.08 by player)
    kept = {}
    for h in holds:
        k = (h['team'], h['asset'], tuple(sorted((p['tenure_id'], p['weight']) for p in h['credit']['people'])))
        a = kept.get(k)
        if not a:
            kept[k] = dict(h, windows=1, first_window=h['end'], last_window=h['end'], at_time=h['at_time'])
            continue
        a['windows'] += 1
        a['last_window'] = h['end']
        a['turned_out'] = round(a['turned_out'] + h['turned_out'], 1)
        a['at_time'] = None if a['at_time'] is None and h['at_time'] is None else round((a['at_time'] or 0) + (h['at_time'] or 0), 1)
        a['proj'] = max(a['proj'], h['proj'])
    players = [dict(v, agreed=v['first_window'], date=v['first_window']) for v in kept.values()]
    cells = {f'{k[0]}|{k[1]}': {'n': c['n'], 'traded': c['traded'], 'rate': round(c['traded'] / c['n'], 3) if c['n'] else None,
                                'mean_loss_turned_out': round(sum(c['to']) / len(c['to']), 1) if c['to'] else None,
                                'mean_loss_at_time': round(sum(c['at']) / len(c['at']), 1) if c['at'] else None} for k, c in acc.items()}
    json.dump({'young': YOUNG, 'proj_edges': PROJ_EDGES, 'min_cell': MIN_CELL, 'cells_all_seasons': cells,
               'traded': [o for o in opps if o['status'] == 'traded'], 'windows': holds, 'holds': players},
              open(os.path.join(OUT, 'gm_holds.json'), 'w'), indent=0)
    print('opportunities', len(opps), '| windows held and credited', len(holds), '| players kept (the unit)', len(players), '| traded', sum(o['status'] == 'traded' for o in opps))


if __name__ == '__main__':
    main()
