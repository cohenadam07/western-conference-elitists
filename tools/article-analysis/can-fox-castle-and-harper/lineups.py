import json, math
D = '/home/claude/spurs-article/nba/spurs-article-data/'
def rs(f, name=None):
    d = json.load(open(D+f)); sets = d.get('resultSets') or [d['resultSet']]
    s = sets[0] if name is None else [x for x in sets if x['name']==name][0]
    return [dict(zip(s['headers'], r)) for r in s['rowSet']]
LG3, LGFT = 0.35964603715510607, 0.7828555601717214
K = {2:1221, 3:round(1221*(843/1221)**(1/3)), 4:round(1221*(843/1221)**(2/3)), 5:843}
print('k', K)
# team luck-adjusted net (regular season)
ov = rs('onoff_rs_Advanced.json','OverallTeamPlayerOnOffDetails')[0]; oo = rs('onoff_rs_Opponent.json','OverallTeamPlayerOnOffDetails')[0]
def adjnet(ortg, drtg, poss, o):
    dadj = drtg - 100*(3*(o['OPP_FG3M'] - o['OPP_FG3A']*LG3) + (o['OPP_FTM'] - o['OPP_FTA']*LGFT))/poss
    return ortg - dadj, dadj
team_adj, _ = adjnet(ov['OFF_RATING'], ov['DEF_RATING'], ov['POSS'], oo)
print('team net', ov['NET_RATING'], 'adj', round(team_adj,2), 'poss', ov['POSS'], 'min', ov['MIN'])
out = {'k': K, 'team': dict(net=ov['NET_RATING'], adj=round(team_adj,1), ortg=ov['OFF_RATING'], drtg=ov['DEF_RATING'], poss=ov['POSS'])}
SHORT = {'D. Fox':'Fox','S. Castle':'Castle','D. Harper':'Harper','V. Wembanyama':'Wemby','J. Champagnie':'Champagnie','D. Vassell':'Vassell','K. Johnson':'K. Johnson','H. Barnes':'Barnes'}
for tag in ('rs','po'):
    for n in (2,3,4,5):
        adv = {r['GROUP_ID']: r for r in rs(f'lineups_{n}_{tag}_Advanced.json')}
        opp = {r['GROUP_ID']: r for r in rs(f'lineups_{n}_{tag}_Opponent.json')}
        base = {r['GROUP_ID']: r for r in rs(f'lineups_{n}_{tag}_Base.json')}
        units = []
        for gid, a in adv.items():
            o = opp[gid]; b = base[gid]; poss = a['POSS'] or 0
            if poss <= 0: continue
            adj, dadj = adjnet(a['OFF_RATING'], a['DEF_RATING'], poss, o)
            est = (poss*adj + K[n]*team_adj)/(poss + K[n])
            names = [x.strip() for x in a['GROUP_NAME'].split(' - ')]
            units.append(dict(p=[SHORT.get(x, x) for x in names], min=round(a['MIN'],1), poss=poss, pm=b['PLUS_MINUS'], ortg=a['OFF_RATING'], drtg=a['DEF_RATING'],
                              net=a['NET_RATING'], adj=round(adj,1), est=round(est,1), efg=a['EFG_PCT'], tov=a['TM_TOV_PCT'], orb=a['OREB_PCT'], drb=a['DREB_PCT'],
                              opp3=(o['OPP_FG3M'], o['OPP_FG3A']), fg3=(b['FG3M'], b['FG3A']), gp=a['GP']))
        units.sort(key=lambda u: -u['min'])
        out[f'{tag}{n}'] = units
        print(tag, n, len(units))
json.dump(out, open('/home/claude/spurs-article/out/lineups_sas.json','w'))
def find(tag, n, must):
    return [u for u in out[f'{tag}{n}'] if all(m in u['p'] for m in must)]
for tag in ('rs','po'):
    for u in find(tag, 3, ['Fox','Castle','Harper']): print(tag, 'TRIO', u)
    for u in find(tag, 5, ['Fox','Castle','Harper']): print(tag, '5 w trio', u['p'], u['min'], u['pm'], u['net'], u['adj'], u['est'])
for pr in [('Fox','Castle'),('Fox','Harper'),('Castle','Harper'),('Fox','Wemby'),('Castle','Wemby'),('Harper','Wemby'),('Champagnie','Wemby'),('Vassell','Wemby')]:
    for u in find('rs', 2, list(pr)): print('pair', pr, u['min'], u['net'], u['adj'], u['est'])
for u in out['rs5'][:12]: print('5man', u['p'], u['min'], u['net'], u['adj'], u['est'])
for u in find('rs',5,['Harper','Castle','Vassell','Champagnie','Wemby']): print('ALT5', u)
