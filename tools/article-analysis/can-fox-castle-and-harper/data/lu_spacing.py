import pandas as pd, numpy as np, statsmodels.api as sm, json
df = pd.read_pickle('ps.pkl')
rows = []
for yr in range(2018, 2026):
    s = f"{yr}-{str(yr+1)[2:]}"
    L = json.load(open(f'/home/claude/western-conference-elitists/public/lineups/{s}.json'))
    pl = df[df.yr == yr].set_index('id')
    for u in L['units']['5']:
        ps = [pl.loc[i] if i in pl.index else None for i in u['ids']]
        if any(p is None for p in ps): continue
        if isinstance(ps[0], pd.DataFrame): continue
        tp3 = [p.tp3/100 if p.tp3_n and p.tp3_n >= 50 else np.nan for p in ps]
        r = dict(yr=yr, t=u['t'], poss=u['poss'], ortg=u['ortg'], drtg=u['drtg'], net=u['net'], adj=u['adj'], min=u['min'],
                 obpm=sum(p.obpm for p in ps), dbpm=sum(p.dbpm for p in ps), usg=sum(p.usg for p in ps),
                 n_bad=sum(1 for p in ps if (p.tp3_n or 0) >= 50 and p.tp3 < 34.5) + sum(1 for p in ps if (p.tp3_n or 0) < 50),
                 n_good=sum(1 for p in ps if (p.tp3_n or 0) >= 150 and p.tp3 >= 37.5),
                 tp3r=np.nansum([p.tp3r for p in ps]), ids=u['ids'])
        rows.append(r)
lu = pd.DataFrame(rows).dropna(subset=['obpm','dbpm','usg']); print(len(lu), lu.groupby('yr').size().to_dict())
lu['usg_over'] = lu.usg - 100
X = sm.add_constant(lu[['obpm','n_bad','usg_over']]); m = sm.WLS(lu.ortg, X, weights=lu.poss).fit(); print(m.params.round(3).to_dict(), m.bse.round(3).to_dict())
X2 = sm.add_constant(lu[['obpm','n_good','n_bad']]); m2 = sm.WLS(lu.ortg, X2, weights=lu.poss).fit(); print(m2.params.round(3).to_dict(), m2.bse.round(3).to_dict())
# net rating version
X3 = sm.add_constant(lu[['obpm','dbpm','n_bad','usg_over']]); m3 = sm.WLS(lu.adj, X3, weights=lu.poss).fit(); print('net', m3.params.round(3).to_dict(), m3.bse.round(3).to_dict())
# distribution of n_bad and avg ortg residual by n_bad
lu['res'] = lu.ortg - sm.WLS(lu.ortg, sm.add_constant(lu[['obpm']]), weights=lu.poss).fit().fittedvalues
print(lu.groupby('n_bad').apply(lambda g: pd.Series({'units':len(g),'poss':g.poss.sum(),'res':np.average(g.res, weights=g.poss)})).round(2))
lu.to_pickle('lu5.pkl')
