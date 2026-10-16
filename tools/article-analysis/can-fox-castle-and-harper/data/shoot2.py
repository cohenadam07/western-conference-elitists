import pandas as pd, numpy as np, statsmodels.api as sm
pr = pd.read_pickle('pairs.pkl')
w = 1/(1/pr.tp3_n + 1/pr.tp3_n_next)
pr['young'] = (pr.age < 23).astype(int)
X = pr[['tp3','ft']].copy(); X['age'] = pr.age; X['l25_delta'] = (pr.tp3_l25 - pr.tp3).fillna(0)
X['l25_young'] = X.l25_delta * pr.young
m = sm.WLS(pr.tp3_next, sm.add_constant(X), weights=w).fit(); print(m.params.round(4)); print(m.bse.round(4))
for lab, g in [('young<23', pr[pr.age<23]), ('23+', pr[pr.age>=23])]:
    hot = g[(g.tp3_l25 - g.tp3 >= 0.06) & (g.tp3_l25_n >= 60)]
    print(lab, 'hot n', len(hot), 'season', round(np.average(hot.tp3, weights=hot.tp3_n),4), 'l25', round(np.average(hot.tp3_l25, weights=hot.tp3_l25_n),4), 'next', round(np.average(hot.tp3_next, weights=hot.tp3_n_next),4))
    allg = g
    print(lab, 'all next-minus-season', round(np.average(allg.tp3_next-allg.tp3, weights=w[allg.index]),4))
# delta vs ft for young players
y = pr[pr.age < 23]
yy = sm.WLS(y.tp3_next - y.tp3, sm.add_constant(y[['ft','tp3']]), weights=w[y.index]).fit(); print('young delta model', yy.params.round(4), yy.bse.round(4))
# predictions
def pred(tp3, ft, age, l25d=0):
    x = pd.DataFrame([[1, tp3, ft, age, l25d, l25d*(age<23)]], columns=['const','tp3','ft','age','l25_delta','l25_young'])
    return float(m.predict(x)[0])
print('Castle', round(pred(0.332, 0.734, 21.25, 0.41-0.332),4), 'no l25', round(pred(0.332,0.734,21.25),4))
print('Harper', round(pred(0.343, 0.756, 19.92, 0.50-0.343),4), round(pred(0.343,0.756,19.92),4))
print('Fox', round(pred(0.332, 0.76, 28.12, 0.299-0.332),4), round(pred(0.332,0.76,28.12),4))
res = pr.tp3_next - m.fittedvalues
print('resid sd (wtd)', np.sqrt(np.average(res**2, weights=w)).round(4))
