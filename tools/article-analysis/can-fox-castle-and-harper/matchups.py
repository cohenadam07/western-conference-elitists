import json, pandas as pd, numpy as np
D='nba/spurs-article-data/'
ps = pd.read_pickle('data/ps.pkl'); cur = ps[ps.yr==2025].drop_duplicates('id').set_index('id')
def rows(f):
    d=json.load(open(D+f)); s=d['resultSets'][0]; return [dict(zip(s['headers'],r)) for r in s['rowSet']]
out={}
for p in ['fox','castle','harper']:
    df = pd.DataFrame(rows(f'matchups_def_{p}.json'))
    df['usg'] = df.OFF_PLAYER_ID.map(cur.usg); df['ts'] = df.OFF_PLAYER_ID.map(cur.ts); df['pos'] = df.OFF_PLAYER_ID.map(cur.pos)
    df['tier'] = np.where(df.usg >= 25, 'high', np.where(df.usg >= 18, 'mid', 'low'))
    tot = df.PARTIAL_POSS.sum()
    res = {}
    for t, g in df.groupby('tier'):
        pp = g.PARTIAL_POSS.sum()
        # expected FG%: weight each opponent's own season FG proxy -> use ts as efficiency proxy
        res[t] = dict(share=round(pp/tot*100,1), pts100=round(100*g.PLAYER_PTS.sum()/pp,1), fg=round(g.MATCHUP_FGM.sum()/max(g.MATCHUP_FGA.sum(),1)*100,1),
                      exp_ts=round(np.average(g.ts.fillna(0.56), weights=g.PARTIAL_POSS)*100,1), fga=int(g.MATCHUP_FGA.sum()))
    top = df.sort_values('PARTIAL_POSS', ascending=False).head(6)[['OFF_PLAYER_NAME','PARTIAL_POSS','PLAYER_PTS','MATCHUP_FGM','MATCHUP_FGA']]
    print(p, 'total partial poss', round(tot), res); print(top.to_string(index=False))
    out[p] = dict(total=round(tot), tiers=res)
json.dump(out, open('out/matchups.json','w'))
