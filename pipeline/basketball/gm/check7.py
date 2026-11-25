"""
check7.py — the follow-ups asked for before Module 7: the active top and bottom 10, Riley (since 2008), Rose and
Weltman season by season (margin, luck, player value), Pat Williams at Orlando, and how much of Rose's number is
picks traded away against production.

    python3 check7.py      # -> out/check7.txt
"""
import json, os
import gm5

GR = gm5.GR
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
SP = json.load(open(os.path.join(OUT, 'gm_spells.json')))
L = []
w = L.append
f = lambda r: (f"{r['person'][:18]:18} {r['team']} {r['start'][:4]}  {r['gm_value_added']['0.05']:+6.0f} ({r['gm_value_added_per_season']:+5.0f}/season)  player-value line {r['gm_value_added_player']['0.05']:+6.0f}"
               f"  produced: margin {r['produced_margin_adj']:+6.0f} / player value {r['produced_above_average']:+6.0f}  left {r['left']['0.05']:5.0f}  inherited {r['inherited']['0.05']:5.0f}")
ranked = [r for r in SP if r['ranked']]
act = sorted([r for r in ranked if r['active']], key=lambda r: -r['gm_value_added']['0.05'])
w('ACTIVE TOP 10'); [w('  ' + f(r)) for r in act[:10]]
w('ACTIVE BOTTOM 10'); [w('  ' + f(r)) for r in act[::-1][:10]]
w('')
pw = next(r for r in SP if r['person'] == 'Pat Williams' and r['team'] == 'ORL')
w('Pat Williams, Orlando: ' + f(pw)); w('   left out (walked in free agency before a game for the next GM): ' + ', '.join(pw['walked_before_left']))
w('')


def value_split(aids, d, team):
    y0 = GR.season_of(d)
    pl = pk = 0.0
    for a in aids:
        if a.startswith('player:') and gm5.walks_first(a, d, team):
            continue
        if not (a.startswith('player:') or a.startswith('pick:')):
            continue
        s, e = gm5.asset_seasons(a, d)
        v = sum(x / 1.05 ** (y - y0) for y, x in s.items() if y0 <= y < y0 + GR.HORIZON)
        if a.startswith('pick:'):
            pk += v
        else:
            pl += v
    return pl, pk


for name, team in (('Pat Riley', 'MIA'), ('Leon Rose', 'NYK'), ('Jeff Weltman', 'ORL')):
    rs = [x for x in SP if x['person'] == name and x['team'] == team]
    for r in rs:
        w(f'{name}, {team}: ' + f(r))
        segs = [(sg['from'], sg['to'], p['weight']) for sg in gm5.C.get(team, []) for p in sg['people']
                if gm5.TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == r['person_id'] and sg['to'] >= r['start'] and sg['from'] <= (r['end'] or GR.TODAY)]
        segs.sort()
        for y in range(GR.season_of(r['start']), min(GR.season_of(r['end'] or GR.TODAY), GR.NOW_SEASON) + 1):
            dates = gm5.season_games(team, y)
            if not dates:
                continue
            share = sum(gm5.weight_on(segs, x) for x in dates) / len(dates)
            if share <= 0:
                continue
            k = (team, y)
            w(f"    {y - 1}-{str(y)[2:]}: share {share:.2f}  margin {gm5.MARGIN.get(k, 0):+5.1f}  opp. shooting luck {gm5.LUCK.get(k, 0):+4.1f}  adjusted {gm5.ADJ.get(k, 0):+5.1f}"
              f" -> {gm5.ADJ.get(k, 0) * gm5.ADJ_TO_VALUE * share:+5.0f}   player value over avg {(gm5.TEAMVAL.get(k, 0) - gm5.LEAGUE_AVG.get(y, 0)) * share:+5.0f}")
    w('')

# Rose: picks against production
r = next(x for x in SP if x['person'] == 'Leon Rose' and x['active'])
i_day, l_day = r['start'], GR.TODAY
H = gm5.holdings([(i_day, 'NYK'), (l_day, 'NYK')])
ipl, ipk = value_split(H[(i_day, 'NYK')], i_day, 'NYK')
lpl, lpk = value_split(H[(l_day, 'NYK')], l_day, 'NYK')
out_at = in_at = out_to = in_to = 0.0
n_out = n_in = 0
for d in gm5.D:
    if d['team'] != 'NYK' or d['type'] not in ('trade', 'sign-and-trade') or not (r['start'] <= d['agreed'] <= GR.TODAY):
        continue
    y0 = GR.season_of(d['agreed'])
    for a in d['out']:
        if a.startswith('pick:'):
            n_out += 1; out_at += GR.pv_total(a, d['agreed'], y0)[0]
    for a in d['in']:
        if a.startswith('pick:'):
            n_in += 1; in_at += GR.pv_total(a, d['agreed'], y0)[0]
w('Leon Rose, New York: where the number comes from (5%, ten seasons)')
w(f"  GM Value Added {r['gm_value_added']['0.05']:+.0f} = produced {r['produced_margin_adj']:+.0f} + left {r['left']['0.05']:.0f} - inherited {r['inherited']['0.05']:.0f}")
w(f"  inherited: players {ipl:.0f}, picks {ipk:.0f}   |   left today: players {lpl:.0f}, picks {lpk:.0f}")
w(f"  so picks contribute {lpk - ipk:+.0f} (left minus inherited) and players {lpl - ipl:+.0f}; production {r['produced_margin_adj']:+.0f}")
w(f"  his trades sent out {n_out} picks worth {out_at:.0f} at the time and brought in {n_in} worth {in_at:.0f} (net {in_at - out_at:+.0f})")
open(os.path.join(OUT, 'check7.txt'), 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
