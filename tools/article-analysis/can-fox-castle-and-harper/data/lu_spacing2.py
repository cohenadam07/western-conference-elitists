import pandas as pd, numpy as np, statsmodels.formula.api as smf
lu = pd.read_pickle('lu5.pkl'); lu['ts'] = lu.t + lu.yr.astype(str)
lu['usg_over'] = lu.usg - 100; lu['lmin'] = np.log(lu['min'])
print('usage sum dist', lu.usg.describe().round(1).to_dict())
for f in ['ortg ~ obpm + n_bad + usg_over', 'ortg ~ obpm + n_bad + usg_over + lmin', 'ortg ~ obpm + n_bad + usg_over + C(ts)', 'ortg ~ obpm + n_bad + usg_over + lmin + C(ts)',
          'drtg ~ dbpm + n_bad + usg_over + lmin + C(ts)', 'adj ~ obpm + dbpm + n_bad + usg_over + lmin + C(ts)']:
    m = smf.wls(f, lu, weights=lu.poss).fit()
    keep = [c for c in m.params.index if not c.startswith('C(')]
    print(f, '|', {c: (round(m.params[c],3), round(m.bse[c],3)) for c in keep})
# nonlinearity in usage: bins
lu['ub'] = pd.cut(lu.usg, [0,92,96,100,104,108,112,130])
m = smf.wls('ortg ~ obpm + C(ts)', lu, weights=lu.poss).fit(); lu['r'] = lu.ortg - m.fittedvalues
print(lu.groupby('ub').apply(lambda g: pd.Series({'units':len(g),'poss':g.poss.sum(),'res':np.average(g.r, weights=g.poss)})).round(2))
lu.to_pickle('lu5.pkl')
