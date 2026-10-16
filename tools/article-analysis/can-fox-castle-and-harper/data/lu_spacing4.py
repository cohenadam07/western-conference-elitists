import pandas as pd, numpy as np, statsmodels.formula.api as smf
df = pd.read_pickle('ps.pkl'); lu = pd.read_pickle('lu5.pkl')
idx = df.set_index(['id','yr'])
def g(r, col):
    v=[]
    for i in r.ids:
        p = idx.loc[(i, r.yr)]
        if isinstance(p, pd.DataFrame): p = p.iloc[0]
        v.append(p[col])
    return np.nansum(v) if not all(pd.isna(v)) else np.nan
for col in ['onoffadj','ts','bpm']:
    lu[col+'_sum'] = lu.apply(lambda r: g(r,col), axis=1)
lu['ts_pts'] = (lu.ts_sum/5 - 0.57)*100
for f in ['ortg ~ onoffadj_sum + usg_over + lmin + C(ts)', 'ortg ~ onoffadj_sum + ts_pts + usg_over + lmin + C(ts)', 'adj ~ onoffadj_sum + usg_over + lmin + C(ts)', 'ortg ~ bpm_sum + usg_over + lmin + C(ts)']:
    d = lu.dropna(subset=['onoffadj_sum','ts_pts','bpm_sum'])
    m = smf.wls(f, d, weights=d.poss).fit(); keep=[c for c in m.params.index if not c.startswith('C(')]
    print(f, len(d), {c:(round(m.params[c],3), round(m.bse[c],3)) for c in keep})
lu.to_pickle('lu5.pkl')
