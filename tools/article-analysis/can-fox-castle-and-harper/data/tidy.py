import json, pandas as pd
d = json.load(open('/home/claude/western-conference-elitists/public/savant-data.json'))
rows = []
KEYS = ['mpg','usg','ts','tp3','tp3a','tp3r','ft','fta','ftr','ast','tov','asttov','bpm','obpm','dbpm','grav','uast','uast3','xefg','shotmk','drv','pts','efg','tp2','onoff','onoffadj','selfcr','strength','height','length','dreb','oreb','stlpct','blkpct','rim','oppfg','mtch','avail','minshare','pps','p3pt','potast','gmsc','per','vorp','ws48']
for season, sd in d['data'].items():
    for p in sd['players']:
        r = dict(id=p['id'], name=p['name'], season=season, team=p['team'], pos=p['pos'], age=p['age'], exp=p.get('exp'), qualified=p.get('qualified'))
        for k in KEYS:
            m = p['m'].get(k)
            if not m: continue
            for w in ('season', 'l25', 'l10'):
                x = m.get(w) or {}
                r[f'{k}' if w == 'season' else f'{k}_{w}'] = x.get('v')
                if x.get('n') is not None:
                    r[f'{k}_n' if w == 'season' else f'{k}_{w}_n'] = x.get('n')
        rows.append(r)
df = pd.DataFrame(rows)
df['yr'] = df.season.str[:4].astype(int)
df.to_pickle('ps.pkl')
print(df.shape, df.yr.min(), df.yr.max())
print(df[df.yr==2025][['name','usg','usg_n','ts','ts_n','tp3','tp3_n','ft','ft_n','tp3_l25','tp3_l25_n']].head())
print(df.groupby('yr')[['usg','tp3_n','ft_n','tp3_l25_n','grav','xefg']].count().tail(15))
