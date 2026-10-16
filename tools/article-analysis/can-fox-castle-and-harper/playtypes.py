import json, glob
D = '/home/claude/spurs-article/nba/spurs-article-data/'
def rows(f):
    d = json.load(open(D+f)); s = (d.get('resultSets') or [d['resultSet']])[0]; return [dict(zip(s['headers'], r)) for r in s['rowSet']]
PT = ['Isolation','PRBallHandler','PRRollman','Spotup','Cut','Transition','Handoff','OffScreen','Postup']
team = {}
for pt in PT:
    for tg in ('offensive','defensive'):
        R = rows(f'synteam_{pt}_{tg}.json')
        for r in R:
            if r['TEAM_ABBREVIATION'] == 'SAS':
                team[(pt,tg)] = dict(freq=round(r['POSS_PCT']*100,1), ppp=r['PPP'], pct=round(r['PERCENTILE']*100), poss=r['POSS'])
        # league distribution for scatter
        if tg == 'offensive':
            team[(pt,'lg')] = [dict(t=r['TEAM_ABBREVIATION'], freq=round(r['POSS_PCT']*100,1), ppp=r['PPP']) for r in R]
for pt in PT: print(pt, team.get((pt,'offensive')), '| def', team.get((pt,'defensive')))
IDS = {1628368:'Fox', 1642264:'Castle', 1642844:'Harper', 1641705:'Wemby', 1630170:'Vassell', 1630577:'Champagnie'}
pl = {}
for pt in PT:
    for tg in ('offensive','defensive'):
        for r in rows(f'syn_{pt}_{tg}.json'):
            if r['PLAYER_ID'] in IDS and r['TEAM_ABBREVIATION']=='SAS':
                pl[(IDS[r['PLAYER_ID']],pt,tg)] = dict(freq=round(r['POSS_PCT']*100,1), ppp=r['PPP'], pct=round(r['PERCENTILE']*100), poss=r['POSS'])
for k in sorted(pl): 
    if k[2]=='defensive' or k[0]=='Wemby': print(k, pl[k])
json.dump(dict(team={f'{a}|{b}':v for (a,b),v in team.items()}, players={f'{a}|{b}|{c}':v for (a,b,c),v in pl.items()}), open('out/playtypes.json','w'))
