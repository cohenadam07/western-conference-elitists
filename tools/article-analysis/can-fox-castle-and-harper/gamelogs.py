import json
D = '/home/claude/spurs-article/nba/spurs-article-data/'
def rows(f):
    d = json.load(open(D+f)); s = d['resultSets'][0]; return [dict(zip(s['headers'], r)) for r in s['rowSet']]
P = {1628368:'Fox', 1642264:'Castle', 1642844:'Harper', 1641705:'Wemby', 1630170:'Vassell', 1630577:'Champagnie'}
out = {}
for tag in ('rs','po'):
    base = rows(f'pgamelogs_{tag}_Base.json'); adv = {(r['PLAYER_ID'], r['GAME_ID']): r for r in rows(f'pgamelogs_{tag}_Advanced.json')}
    for r in base:
        if r['PLAYER_ID'] not in P: continue
        a = adv.get((r['PLAYER_ID'], r['GAME_ID']), {})
        out.setdefault(P[r['PLAYER_ID']], []).append(dict(d=r['GAME_DATE'][:10], g=r['GAME_ID'], t=tag, opp=r['MATCHUP'][-3:], wl=r['WL'], min=round(r['MIN'],1),
            p3m=r['FG3M'], p3a=r['FG3A'], ftm=r['FTM'], fta=r['FTA'], fgm=r['FGM'], fga=r['FGA'], pts=r['PTS'], ast=r['AST'], tov=r['TOV'], pm=r['PLUS_MINUS'],
            usg=a.get('USG_PCT'), ts=a.get('TS_PCT'), astp=a.get('AST_PCT'), tovp=a.get('TM_TOV_PCT') or a.get('TOV_PCT'), poss=a.get('POSS')))
for k in out: out[k].sort(key=lambda x: x['d'])
for k, v in out.items():
    rs = [g for g in v if g['t']=='rs']; po = [g for g in v if g['t']=='po']
    s3 = lambda L: (sum(g['p3m'] for g in L), sum(g['p3a'] for g in L)); sft = lambda L: (sum(g['ftm'] for g in L), sum(g['fta'] for g in L))
    print(k, 'rs games', len(rs), 'rs 3P', s3(rs), 'last25', s3(rs[-25:]), 'FT', sft(rs), 'FT l25', sft(rs[-25:]), '| po', len(po), s3(po), sft(po))
json.dump(out, open('/home/claude/spurs-article/out/gamelogs.json','w'))
print(list(json.load(open(D+'pgamelogs_rs_Advanced.json'))['resultSets'][0]['headers'])[:40])
