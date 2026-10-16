import pandas as pd, numpy as np, statsmodels.api as sm
df = pd.read_pickle('ps.pkl')
df = df[df.yr >= 2012].copy()
for c in ['tp3','ft','tp3_l25','ft_l25']: df[c] = df[c] / 100
# 1. true-talent spread for 3P% and FT% (method of moments), per season, players with n>=100
def mom(sub, col, ncol):
    p = np.average(sub[col], weights=sub[ncol]); var_obs = np.average((sub[col]-p)**2, weights=sub[ncol])
    noise = np.average(p*(1-p)/sub[ncol], weights=sub[ncol])
    vt = max(var_obs - noise, 1e-9); k = p*(1-p)/vt
    return p, np.sqrt(vt), k
for col, ncol, lo in [('tp3','tp3_n',100), ('ft','ft_n',100)]:
    out = []
    for yr, sub in df[(df[ncol] >= lo)].groupby('yr'):
        out.append((yr,)+mom(sub, col, ncol))
    o = pd.DataFrame(out, columns=['yr','mean','sd_true','k'])
    print(col, o.tail(6).round(4).to_string(index=False)); print(col, 'median k', o.k.median().round(0), 'median sd', o.sd_true.median().round(4))
# 2. pairs t -> t+1
nx = df[['id','yr','tp3','tp3_n']].rename(columns={'tp3':'tp3_next','tp3_n':'tp3_n_next'}); nx['yr'] -= 1
pr = df.merge(nx, on=['id','yr'])
pr = pr[(pr.tp3_n >= 100) & (pr.tp3_n_next >= 100) & (pr.ft_n >= 50)].copy()
print('pairs', len(pr))
X = pr[['tp3','ft']].copy(); X['l25_delta'] = (pr.tp3_l25 - pr.tp3).fillna(0); X['ln_n'] = np.log(pr.tp3_n)
X = sm.add_constant(X); w = 1/(1/pr.tp3_n + 1/pr.tp3_n_next)
m = sm.WLS(pr.tp3_next, X, weights=w).fit(); print(m.summary().tables[1])
# simple: only tp3 and ft
m2 = sm.WLS(pr.tp3_next, sm.add_constant(pr[['tp3','ft']]), weights=w).fit(); print(m2.params.round(4), m2.bse.round(4))
# 3. players with tp3 near 33% and modest attempts: how did next season go given FT%
sub = pr[(pr.tp3.between(0.31,0.35)) & (pr.tp3_n.between(150,400))]
sub['ftb'] = pd.cut(sub.ft, [0,0.7,0.75,0.8,0.85,1.0])
print(sub.groupby('ftb').apply(lambda g: pd.Series({'n':len(g), 'tp3':np.average(g.tp3, weights=g.tp3_n), 'next':np.average(g.tp3_next, weights=g.tp3_n_next)})).round(3))
# 4. L25 hot streak: players whose L25 3P% beat season by >=6 pts (l25 n>=60)
hot = pr[(pr.tp3_l25 - pr.tp3 >= 0.06) & (pr.tp3_l25_n >= 60)]
print('hot', len(hot), 'season', np.average(hot.tp3, weights=hot.tp3_n).round(4), 'l25', np.average(hot.tp3_l25, weights=hot.tp3_l25_n).round(4), 'next', np.average(hot.tp3_next, weights=hot.tp3_n_next).round(4))
pr.to_pickle('pairs.pkl')
