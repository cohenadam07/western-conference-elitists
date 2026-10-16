import pandas as pd, numpy as np, statsmodels.formula.api as smf
df = pd.read_pickle('ps.pkl'); df = df[(df.yr >= 2010)].copy()
df['tsp'] = df.ts*100
a = df[['id','yr','team','age','usg','tsp','tov','ast','mpg','usg_n']].rename(columns={'usg_n':'poss'})
b = a.copy(); b['yr'] -= 1; b = b.add_prefix('x_').rename(columns={'x_id':'id','x_yr':'yr'})
p = a.merge(b, on=['id','yr'])
p = p[(p.poss >= 1500) & (p.x_poss >= 1500)].copy()
p['dU'] = p.x_usg - p.usg; p['dTS'] = p.x_tsp - p.tsp; p['dTOV'] = p.x_tov - p.tov; p['dAST'] = p.x_ast - p.ast
p['moved'] = (p.team != p.x_team).astype(int); p['w'] = 1/(1/p.poss + 1/p.x_poss)
for f in ['dTS ~ dU', 'dTS ~ dU + age', 'dTS ~ dU*moved + age', 'dTOV ~ dAST + dU + age']:
    m = smf.wls(f, p, weights=p.w).fit(); print(f, {k:(round(v,3), round(m.bse[k],3)) for k,v in m.params.items()}, 'n', len(p))
# usage drops of 3+ points: what happened
dr = p[p.dU <= -3]; print('drops', len(dr), 'mean dU', round(dr.dU.mean(),2), 'mean dTS', round(dr.dTS.mean(),2), 'dTOV', round(dr.dTOV.mean(),2))
rest = p[p.dU.abs() < 1]; print('flat', len(rest), 'dTS', round(rest.dTS.mean(),2))
# guards with high AST% jumps -> TOV
g = p[(p.dAST >= 6)]; print('ast jump', len(g), 'dAST', round(g.dAST.mean(),1), 'dTOV', round(g.dTOV.mean(),2))
g2 = p[(p.dAST <= -6)]; print('ast drop', len(g2), 'dAST', round(g2.dAST.mean(),1), 'dTOV', round(g2.dTOV.mean(),2))
