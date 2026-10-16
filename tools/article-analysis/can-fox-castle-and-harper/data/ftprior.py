import pandas as pd, numpy as np, statsmodels.api as sm, json
df = pd.read_pickle('ps.pkl'); df = df[df.yr >= 2019]
for c in ['tp3','ft']: df[c] = df[c]/100
s = df[(df.tp3_n >= 100) & (df.ft_n >= 50)].copy()
m = sm.WLS(s.tp3, sm.add_constant(s[['ft']]), weights=s.tp3_n).fit()
a, b = m.params['const'], m.params['ft']
res = s.tp3 - m.fittedvalues
p = np.average(s.tp3, weights=s.tp3_n)
var_res = np.average(res**2, weights=s.tp3_n); noise = np.average(s.tp3*(1-s.tp3)/s.tp3_n, weights=s.tp3_n)
tau = np.sqrt(var_res - noise)
# unconditional
var_obs = np.average((s.tp3-p)**2, weights=s.tp3_n); tau0 = np.sqrt(var_obs - noise)
print('a,b', round(a,4), round(b,4), 'tau|FT', round(tau,4), 'tau0', round(tau0,4), 'league p', round(p,4), 'n', len(s))
print('k|FT', round(p*(1-p)/tau**2), 'k0', round(p*(1-p)/tau0**2))
# guards-only version
g = s[s.pos=='Guard']
mg = sm.WLS(g.tp3, sm.add_constant(g[['ft']]), weights=g.tp3_n).fit(); print('guards a,b', mg.params.round(4).to_dict())
json.dump(dict(a=a,b=b,tau=tau,tau0=tau0,p=p,k_ft=p*(1-p)/tau**2,k0=p*(1-p)/tau0**2), open('ft_prior.json','w'))
def post(makes_att, ft, w_recent=None):
    mu = a + b*ft; k = p*(1-p)/tau**2
    M = sum(mk for mk,at in makes_att); N = sum(at for mk,at in makes_att)
    mean = (k*mu + M)/(k+N); sd = np.sqrt(mean*(1-mean)/(k+N))
    return mu, mean, sd
# Castle: 24-25 28.5% of 333 = 95; 25-26 33.2% of 244 = 81
print('Castle', [round(x,4) for x in post([(95,333),(81,244)], 0.732)])
print('Castle+L25x', [round(x,4) for x in post([(95,333),(81,244),(32,78)], 0.732)])
print('Harper', [round(x,4) for x in post([(61,178)], 0.756)])
print('Fox 3yr', [round(x,4) for x in post([(214,580),(118,381),(131,395)], 0.776)])
