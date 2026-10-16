import pandas as pd, numpy as np, statsmodels.formula.api as smf
df = pd.read_pickle('ps.pkl')
out=[]
for yr in range(2015, 2026):
    g = df[(df.yr==yr)&(df.pos=='Guard')&(df.usg_n>=1500)].dropna(subset=['ast','tov','usg']).copy()
    m = smf.wls('tov ~ ast + usg', g, weights=g.usg_n).fit(); g['res']=g.tov-m.fittedvalues; out.append(g[['id','yr','name','res','usg_n','tov','ast']])
r = pd.concat(out); nx = r[['id','yr','res']].copy(); nx['yr']-=1
p = r.merge(nx, on=['id','yr'], suffixes=('','_next'))
print('yoy corr of TOV residual', round(np.corrcoef(p.res, p.res_next)[0,1],3), 'n', len(p))
print(r[r.name=='Stephon Castle'][['yr','res','tov','ast']])
b = smf.ols('res_next ~ res', p).fit(); print(b.params.round(3).to_dict())
