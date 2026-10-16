import pandas as pd, numpy as np, statsmodels.api as sm, json
df = pd.read_pickle('ps.pkl'); df = df[df.yr >= 2010].copy()
for c in ['tp3','ft','tp3_l25']: df[c] = df[c]/100
base = df[['id','yr','name','age','tp3','tp3_n','ft','ft_n','tp3_l25','tp3_l25_n']]
prev = base[['id','yr','tp3','tp3_n','ft','ft_n']].rename(columns={'tp3':'tp3_p','tp3_n':'n_p','ft':'ft_p','ft_n':'ftn_p'}); prev['yr'] += 1
nxt = base[['id','yr','tp3','tp3_n']].rename(columns={'tp3':'y','tp3_n':'n_y'}); nxt['yr'] -= 1
d = base.merge(prev, on=['id','yr'], how='left').merge(nxt, on=['id','yr'])
d = d[(d.tp3_n >= 75) & (d.n_y >= 100) & (d.ft_n >= 40)].copy()
L = 0.3649
d['n_p'] = d.n_p.fillna(0); d['tp3_p'] = d.tp3_p.fillna(L)
# makes-based blend: regress next on shrunk components; let model learn weights
d['m1'] = d.tp3*d.tp3_n; d['m0'] = d.tp3_p*d.n_p
ftc = (d.ft*d.ft_n + d.ft_p.fillna(0)*d.ftn_p.fillna(0))/(d.ft_n + d.ftn_p.fillna(0))
d['ftc'] = ftc
d['young'] = (d.age < 23).astype(int)
d['l25d'] = (d.tp3_l25 - d.tp3).fillna(0) * (d.tp3_l25_n.fillna(0) >= 50)
# features: deviation-from-league scaled by reliability n/(n+k)
k = 351
d['r1'] = (d.tp3 - L) * d.tp3_n/(d.tp3_n + k)
d['r0'] = (d.tp3_p - L) * d.n_p/(d.n_p + k)
d['ftdev'] = d.ftc - 0.78
w = 1/(0.0013 + 0.25/d.n_y)
X = sm.add_constant(d[['r1','r0','ftdev']].assign(age_young=d.young, age=d.age, l25d=d.l25d, l25y=d.l25d*d.young))
m = sm.WLS(d.y, X, weights=w).fit(); print(m.params.round(4).to_dict()); print(m.bse.round(4).to_dict())
res = d.y - m.fittedvalues; noise = np.average(d.y*(1-d.y)/d.n_y, weights=w)
tsd = np.sqrt(max(np.average(res**2, weights=w) - noise, 0)); print('true-talent residual sd', round(tsd,4), 'n', len(d))
def P(tp3, n, tp3p, np_, ft, age, l25=None, l25n=0):
    r1 = (tp3-L)*n/(n+k); r0 = (tp3p-L)*np_/(np_+k) if np_ else 0
    l25d = (l25-tp3) if (l25 is not None and l25n >= 50) else 0
    x = dict(const=1, r1=r1, r0=r0, ftdev=ft-0.78, age_young=int(age<23), age=age, l25d=l25d, l25y=l25d*int(age<23))
    return sum(m.params[c]*v for c,v in x.items())
out = {
 'Castle': P(0.332,244,0.285,333,(0.734*384+0.724*344)/(384+344),21.25,0.41,78),
 'Castle_noL25': P(0.332,244,0.285,333,(0.734*384+0.724*344)/(384+344),21.25),
 'Harper': P(0.343,178,None,0,0.756,19.92,0.50,64),
 'Harper_noL25': P(0.343,178,None,0,0.756,19.92),
 'Fox': P(0.332,395,0.31,381,(0.76*246+0.827*318)/(246+318),28.12,0.299,127),
 'Vassell': P(0.384,432,0.368,429,0.80,25.44),
 'Champagnie': P(0.381,512,0.371,480,0.87,24.59),
}
print({k:round(v,4) for k,v in out.items()})
json.dump(dict(params=m.params.to_dict(), bse=m.bse.to_dict(), tsd=tsd, k=k, L=L, n=len(d), proj=out), open('proj_model.json','w'), indent=1)
