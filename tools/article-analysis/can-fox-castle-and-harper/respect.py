import json, pandas as pd, numpy as np, statsmodels.formula.api as smf
T = json.load(open('out/tracking.json'))
rows = []
for pid, d in T['cd'].items():
    g = lambda k: d.get(k) or [0,0]
    tot = sum((g(k)[1] or 0) for k in ['0-2','2-4','4-6','6+'])
    if tot < 100: continue
    rows.append(dict(id=int(pid), tot=tot, wo=(g('6+')[1] or 0)/tot, wo_m=g('6+')[0] or 0, wo_a=g('6+')[1] or 0, op_m=g('4-6')[0] or 0, op_a=g('4-6')[1] or 0,
                     t_m=(g('2-4')[0] or 0)+(g('0-2')[0] or 0), t_a=(g('2-4')[1] or 0)+(g('0-2')[1] or 0)))
cd = pd.DataFrame(rows)
print('league wide-open 3P%', round(cd.wo_m.sum()/cd.wo_a.sum(),4), 'open 4-6', round(cd.op_m.sum()/cd.op_a.sum(),4), 'tight', round(cd.t_m.sum()/cd.t_a.sum(),4), 'players', len(cd))
ps = pd.read_pickle('data/ps.pkl')
prev = ps[ps.yr==2024][['id','tp3','tp3_n','ft','ft_n','pos']].rename(columns={'tp3':'tp3_prev','tp3_n':'n_prev'})
cur = ps[ps.yr==2025][['id','name','pos','tp3','tp3_n','tp3a','ft','usg','grav']].rename(columns={'pos':'pos_c'})
d = cd.merge(cur, on='id').merge(prev[['id','tp3_prev','n_prev']], on='id', how='left')
d['rep'] = 36 + (d.tp3_prev.fillna(36) - 36) * d.n_prev.fillna(0)/(d.n_prev.fillna(0)+351)  # shrunk prior-year reputation
d['wo_pct'] = d.wo*100
m = smf.wls('wo_pct ~ rep + C(pos_c) + tp3a', d, weights=d.tot).fit(); print({k:(round(v,3), round(m.bse[k],3)) for k,v in m.params.items()}, 'n', len(d))
m2 = smf.wls('wo_pct ~ ft + C(pos_c) + tp3a', d, weights=d.tot).fit(); print('FT', {k:(round(v,3), round(m2.bse[k],3)) for k,v in m2.params.items()})
# guards only
gd = d[d.pos_c=='Guard']; print('guards wide-open share mean', round(np.average(gd.wo_pct, weights=gd.tot),1), 'pct rank Castle', round((gd.wo_pct < gd[gd.name=='Stephon Castle'].wo_pct.iloc[0]).mean()*100), 'Harper', round((gd.wo_pct < gd[gd.name=='Dylan Harper'].wo_pct.iloc[0]).mean()*100), 'Fox', round((gd.wo_pct < gd[gd.name=="De'Aaron Fox"].wo_pct.iloc[0]).mean()*100))
print(d[['name','wo_pct','rep','tp3','grav']].sort_values('wo_pct', ascending=False).head(15).round(1).to_string(index=False))
d[['id','name','pos_c','tot','wo_pct','tp3','rep','grav','tp3a']].to_json('out/respect.json', orient='records')
# grav vs wo
g2 = d.dropna(subset=['grav']); print('corr grav vs wide-open share', round(np.corrcoef(g2.grav, g2.wo_pct)[0,1],3), len(g2))
