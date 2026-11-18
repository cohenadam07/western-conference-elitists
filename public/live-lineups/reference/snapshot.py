"""Build real data for the mockups: OU vs MVSU (401906802) frozen at a moment, plus OU's opener for season-to-date.
Usage: python3 -I snapshot.py <code_dir> <out.json> <period> <clock_remaining_seconds>"""
import sys, json, gzip, collections
sys.path.insert(0, sys.argv[1]); import parse
OUT, PER, REM = sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
OU = '201'; P3 = 0.339; K5 = 1000; SD = 1.167
R = json.load(open('bt/ratings.json')); RP = R['players']

def load(gid):
    return json.load(gzip.open(f'bt/ou27/games/{gid}.json.gz'))
g2 = load('401906802'); g1 = load('401906801')
names = {}
for g in (g1, g2):
    for t, ath in g['box'].items():
        for a in ath: names[a[0]] = a[1]
cut = parse.elapsed(PER, f'{int(REM // 60)}:{int(REM % 60):02d}')
plays = [p for p in g2['plays'] if parse.elapsed(p[0], p[1]) <= cut]
g2s = dict(g2, plays=plays)
opp = [t for t in g2['box'] if t != OU][0]

def possessions(g):
    r, st = parse.parse_game(g); assert r, st
    return r['poss']
P1, P2 = possessions(g1), possessions(g2s)
last = plays[-1]
score = {'OU': last[11] if g2['home'] == OU else last[12], 'OPP': last[12] if g2['home'] == OU else last[11]}

# minutes and fouls (tonight, to the snapshot)
mins = collections.Counter(); fouls = collections.Counter()
for i, p in enumerate(P2):
    nxt = P2[i + 1]['t0'] if i + 1 < len(P2) else cut
    dur = max(0, min(nxt, cut) - p['t0']) / 60
    for pid in (p['off5'] + '|' + p['def5']).split('|'): mins[pid] += dur
for p in plays:
    if 'Foul' in p[3] and p[8]: fouls[p[8][0]] += 1
cur = P2[-1]; ou_now = cur['off5'] if cur['off'] == OU else cur['def5']; op_now = cur['def5'] if cur['off'] == OU else cur['off5']
# stint length of the current OU five
stint_start = cut
for p in reversed(P2):
    five = p['off5'] if p['off'] == OU else p['def5']
    if five != ou_now: break
    stint_start = p['t0']

def agg(P, keyfn):
    U = collections.defaultdict(lambda: collections.Counter())
    for p in P:
        side = 'o' if p['off'] == OU else 'd'
        five = p['off5'] if side == 'o' else p['def5']
        for k in keyfn(five):
            u = U[k]; u[side + '_poss'] += 1; u[side + '_pts'] += p['pts']
            for s in ('fga', 'fg3a', 'fg3m', 'rim_fga', 'fta', 'tov'): u[f'{side}_{s}'] += p[s]
    return U
def rate(u, a, b): return 100 * u[a] / u[b] if u[b] else None
def summarize(u):
    op, dp = u['o_poss'], u['d_poss']
    if not op or not dp: return None
    net = 100 * (u['o_pts'] / op - u['d_pts'] / dp)
    lo = u['o_pts'] - 3 * (u['o_fg3m'] - P3 * u['o_fg3a']); ld = u['d_pts'] - 3 * (u['d_fg3m'] - P3 * u['d_fg3a'])
    lnet = 100 * (lo / op - ld / dp)
    n = (op + dp) / 2
    return dict(op=op, dp=dp, pm=u['o_pts'] - u['d_pts'], net=round(net, 1), lnet=round(lnet, 1),
                pm_opp3_luck=round(-3 * (u['d_fg3m'] - P3 * u['d_fg3a']), 1), pm_own3_luck=round(3 * (u['o_fg3m'] - P3 * u['o_fg3a']), 1),
                opp3=f"{u['d_fg3m']}-{u['d_fg3a']}", own3=f"{u['o_fg3m']}-{u['o_fg3a']}",
                pm95=round(1.96 * SD * 100 * (1 / op + 1 / dp) ** .5), n=n,
                rim=rate(u, 'o_rim_fga', 'o_fga'), rim_allowed=rate(u, 'd_rim_fga', 'd_fga'),
                tpa=rate(u, 'o_fg3a', 'o_fga'), tpa_allowed=rate(u, 'd_fg3a', 'd_fga'), tov_forced=rate(u, 'd_tov', 'd_poss'))
tonight = {k: s for k, u in agg(P2, lambda f: [f]).items() if (s := summarize(u))}
season = {k: s for k, u in agg(P1 + P2, lambda f: [f]).items() if (s := summarize(u))}
team_t = summarize(agg(P2, lambda f: ['T'])['T']); team_s = summarize(agg(P1 + P2, lambda f: ['T'])['T'])
for k, s in season.items():
    s['trust'] = s['n'] / (s['n'] + K5); s['best'] = round((s['lnet'] - team_s['lnet']) * s['trust'], 1)

def expected(ours, theirs):
    o = lambda pid: RP.get(pid, {}).get('o', 0.0); d = lambda pid: RP.get(pid, {}).get('d', 0.0)
    us, th = ours.split('|'), theirs.split('|')
    return round(sum(o(p) for p in us) - sum(d(p) for p in th) - (sum(o(p) for p in th) - sum(d(p) for p in us)), 1)
def rated(pid): return RP.get(pid, {}).get('poss', 0) >= 300
nm = lambda five: [names.get(p, p) for p in five.split('|')]

units = []
for k in season:
    s = season[k]; t = tonight.get(k)
    units.append(dict(players=nm(k), on_now=(k == ou_now), season=s, tonight=t, exp_vs_now=expected(k, op_now)))
units.sort(key=lambda u: -(u['tonight']['n'] if u['tonight'] else 0))

ou_players = sorted({p for k in tonight for p in k.split('|')}, key=lambda p: -mins[p])
opp_players = sorted({p for pz in P2 for p in (pz['def5'] if pz['off'] == OU else pz['off5']).split('|')}, key=lambda p: -mins[p])
def prow(pid):
    r = RP.get(pid, {})
    return dict(name=names.get(pid, pid), min=round(mins[pid], 1), fouls=fouls[pid], on=(pid in ou_now.split('|') or pid in op_now.split('|')),
                o=round(r.get('o', 0), 1) if rated(pid) else None, d=round(r.get('d', 0), 1) if rated(pid) else None, prior_poss=r.get('poss', 0))

# v3 extras: margin timeline, OU stints, team fouls this half
home_is_ou = g2['home'] == OU
timeline = [(0, 0)]
for p in plays:
    m = (p[11] - p[12]) if home_is_ou else (p[12] - p[11])
    t = parse.elapsed(p[0], p[1])
    if m != timeline[-1][1]: timeline.append((t, m))
timeline.append((cut, timeline[-1][1]))
stints = []
for p in P2:
    five = p['off5'] if p['off'] == OU else p['def5']
    opp5 = p['def5'] if p['off'] == OU else p['off5']
    pts = p['pts'] if p['off'] == OU else -p['pts']
    if stints and stints[-1]['key'] == five: stints[-1]['pm'] += pts; stints[-1]['poss'] += 1
    else: stints.append(dict(key=five, t0=p['t0'], pm=pts, poss=1))
for i, s in enumerate(stints):
    s['t1'] = stints[i + 1]['t0'] if i + 1 < len(stints) else cut
    s['players'] = nm(s.pop('key'))
half_start = 0 if PER == 1 else 1200
tf = collections.Counter()
for p in plays:
    if p[3] == 'PersonalFoul' and parse.elapsed(p[0], p[1]) >= half_start and p[2]: tf['OU' if p[2] == OU else 'OPP'] += 1
team_prior = summarize(agg(P1, lambda f: ['T'])['T'])
data_x = dict(team_prior=team_prior, timeline=timeline, stints=stints, team_fouls=dict(tf), cut=cut)
print('stints', len(stints), 'team fouls', dict(tf), 'last', stints[-1])
data = dict(**data_x, game='Oklahoma vs Mississippi Valley State', date='Nov 6, 2026', period=PER, clock=f'{int(REM // 60)}:{int(REM % 60):02d}',
            score=score, final='84-57', ou_now=nm(ou_now), opp_now=[prow(p) for p in op_now.split('|')],
            ou_now_rows=[prow(p) for p in ou_now.split('|')], stint_min=round((cut - stint_start) / 60, 1),
            exp_now=expected(ou_now, op_now), exp_unrated=sum(not rated(p) for p in (ou_now + '|' + op_now).split('|')),
            team_tonight=team_t, team_season=team_s, units=units, ou_players=[prow(p) for p in ou_players],
            opp_players=[prow(p) for p in opp_players], n_units_tonight=len(tonight), opp_name='MVSU')
json.dump(data, open(OUT, 'w'), indent=1, default=float)
print(json.dumps({k: data[k] for k in ('score', 'ou_now', 'stint_min', 'exp_now', 'exp_unrated', 'n_units_tonight')}, default=float))
print('opp now', [(r['name'], r['fouls'], r['o'], r['d']) for r in data['opp_now']])
print('team tonight', team_t)
for u in units[:6]: print(u['players'], u['tonight'] and (u['tonight']['pm'], u['tonight']['net'], u['tonight']['opp3'], u['tonight']['pm_opp3_luck']), 'season best', u['season']['best'], 'exp', u['exp_vs_now'])
