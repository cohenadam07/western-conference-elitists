import pandas as pd, numpy as np, statsmodels.formula.api as smf, json
df = pd.read_pickle('ps.pkl')
g = df[(df.yr == 2025) & (df.pos == 'Guard') & (df.qualified == True)].dropna(subset=['ast','tov','usg']).copy()
m = smf.wls('tov ~ ast + usg', g, weights=g.usg_n).fit(); print(m.params.round(3).to_dict(), m.bse.round(3).to_dict(), 'r2', round(m.rsquared,3), 'n', len(g))
m1 = smf.wls('tov ~ ast', g, weights=g.usg_n).fit(); print('simple', m1.params.round(3).to_dict())
g['pred'] = m.fittedvalues; g['res'] = g.tov - g.pred
c = g[g.name=='Stephon Castle'].iloc[0]; print('Castle tov', c.tov, 'pred', round(c.pred,2), 'res', round(c.res,2), 'res pct rank', round((g.res < c.res).mean()*100,1))
for n in ["De'Aaron Fox", 'Dylan Harper', 'Devin Vassell']:
    r = g[g.name==n].iloc[0]; print(n, r.ast, r.tov, round(r.pred,2), round(r.res,2))
# if Castle's AST% fell to 25 and usage to 22
x = pd.DataFrame({'ast':[25.0, 23.1, 34.4], 'usg':[22.0, 24.3, 24.3]}); print('pred', m.predict(x).round(2).tolist(), 'resid add', round(c.res,2))
# players with AST%>=30 and TOV% list
hi = g[g.ast >= 30].sort_values('tov', ascending=False)[['name','team','ast','tov','usg']]; print(hi.head(12).to_string(index=False))
pts = g[['id','name','team','ast','tov','usg']].round(1).to_dict(orient='records')
c24 = df[(df.yr==2024)&(df.name=='Stephon Castle')].iloc[0]
json.dump(dict(points=pts, fit=dict(a=m1.params['Intercept'], b=m1.params['ast']), fit2=m.params.to_dict(), castle24=dict(ast=c24.ast, tov=c24.tov)), open('chart_asttov.json','w'))
