import pandas as pd, numpy as np, json, statsmodels.formula.api as smf
df = pd.read_pickle('ps.pkl'); lu = pd.read_pickle('lu5.pkl')
idx = df.set_index(['id','yr'])
def feats(r):
    sh, vol, wvol = [], [], []
    for i in r.ids:
        p = idx.loc[(i, r.yr)]
        if isinstance(p, pd.DataFrame): p = p.iloc[0]
        n = p.tp3_n if pd.notna(p.tp3_n) else 0; t = p.tp3/100 if pd.notna(p.tp3) else 0.30
        shr = 0.36 + (t-0.36)*n/(n+351)
        sh.append(shr); vol.append(p.tp3a if pd.notna(p.tp3a) else 0)
    sh = np.array(sh); vol = np.array(vol)
    return pd.Series({'sh_mean': sh.mean(), 'sh_min3': np.sort(sh)[:3].mean(), 'vol': vol.sum(), 'sh_x_vol': ((sh-0.36)*vol).sum()})
F = lu.apply(feats, axis=1); lu = pd.concat([lu, F], axis=1)
lu['sh_mean_pts'] = (lu.sh_mean-0.36)*100; lu['sh_min3_pts'] = (lu.sh_min3-0.36)*100
for f in ['ortg ~ obpm + usg_over + sh_mean_pts + lmin + C(ts)', 'ortg ~ obpm + usg_over + sh_min3_pts + lmin + C(ts)', 'ortg ~ obpm + usg_over + sh_x_vol + vol + lmin + C(ts)', 'ortg ~ usg_over + sh_mean_pts + lmin + C(ts)']:
    m = smf.wls(f, lu, weights=lu.poss).fit(); keep=[c for c in m.params.index if not c.startswith('C(')]
    print(f, {c:(round(m.params[c],3), round(m.bse[c],3)) for c in keep})
lu.to_pickle('lu5.pkl')
