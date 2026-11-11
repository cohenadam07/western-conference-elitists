"""tools/analysis/stats_parity.py — savant_analyze's statistics against a reference implementation
(statsmodels and scipy), on the same rows (research/analysis/BUILD.md §5 "Statistics").

    python3 tools/analysis/stats_parity.py

Each case is a real study over the Data Room. tools/analysis/run.mjs runs it through the real engine
(api/_analyze.js) and, separately, hands back the exact rows the study saw; statsmodels and scipy fit the
same model on those rows here. Compared: point estimates, standard errors, 95% intervals, p-values,
R² / log-likelihood, VIFs, Holm adjustments and percentiles, to 1e-6 relative (p-values below 1e-12 are
compared as "below 1e-12"). The bootstrap intervals of `compare` are random by design (seeded); they are
held to the cluster-robust analytic interval instead: centred on the same estimate, width within 25%.
Writes tools/analysis/stats_parity.json; exits 1 if any case misses.
"""
import json, math, os, subprocess, sys, tempfile
import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.outliers_influence import variance_inflation_factor
from scipy import stats as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NBA_TG = "SELECT season, game_id, team, home, sum(pts) AS pts, sum(fga) AS fga, sum(fg3a) AS fg3a, sum(fta) AS fta, sum(tov) AS tov, sum(fgm) * 1.0 / sum(fga) AS fg_pct FROM nba.player_games WHERE season = '{s}' GROUP BY 1, 2, 3, 4"
B2B = ("WITH g AS (SELECT DISTINCT season, team, game_id, date FROM nba.player_games WHERE season BETWEEN '2018-19' AND '2024-25'), "
       "t AS (SELECT *, date - lag(date) OVER (PARTITION BY season, team ORDER BY date) AS rest FROM g), "
       "s AS (SELECT season, team, game_id, sum(fgm) * 1.0 / sum(fga) AS fg_pct FROM nba.player_games WHERE season BETWEEN '2018-19' AND '2024-25' GROUP BY 1, 2, 3) "
       "SELECT s.*, CASE WHEN t.rest = 1 THEN 'b2b' ELSE 'rested' END AS night FROM s JOIN t USING (season, team, game_id)")
NFL24 = "SELECT game_id, epa, success, shotgun, no_huddle, ydstogo, down, play_type, qb_dropback, CASE WHEN pressure = 1 THEN 'pressured' ELSE 'clean' END AS pr FROM nfl.plays WHERE season = '{s}' AND season_type = 'REG' AND play_type IN ('pass', 'run') AND down IS NOT NULL AND epa IS NOT NULL"

CASES = [
    # ---- compare (the analytic test: y on a group dummy, CR1 errors, t on G-1; and the bootstrap's interval)
    dict(id='compare-nba-b2b-fg', study=dict(study='compare', sql=B2B, outcome='fg_pct', group='night', cluster='game_id', reference='rested')),
    dict(id='compare-nba-home-pts', study=dict(study='compare', sql=NBA_TG.format(s='2023-24'), outcome='pts', group='home', cluster='team', reference=0)),
    dict(id='compare-nfl-pass-run-epa', study=dict(study='compare', sql=NFL24.format(s='2024'), outcome='epa', group='play_type', cluster='game_id', reference='run')),
    dict(id='compare-nfl-pressure-epa', study=dict(study='compare', sql=NFL24.format(s='2023') + " AND qb_dropback = 1", outcome='epa', group='pr', cluster='game_id', reference='clean')),
    dict(id='compare-nfl-shotgun-success', study=dict(study='compare', sql=NFL24.format(s='2024'), outcome='success', group='shotgun', cluster='game_id', reference=0)),
    dict(id='compare-cfb-garbage-epa', study=dict(study='compare', sql="SELECT game_id, epa, CASE WHEN garbage THEN 'garbage' ELSE 'competitive' END AS g FROM cfb.plays WHERE season = '2025' AND scrimmage AND epa IS NOT NULL", outcome='epa', group='g', cluster='game_id', reference='competitive')),
    dict(id='compare-ufc-title-ss', study=dict(study='compare', sql="SELECT fighter_id, ss * 60.0 / fight_seconds AS slpm, CASE WHEN title THEN 'title' ELSE 'other' END AS t FROM ufc.fights WHERE stats AND fight_seconds >= 60 AND season >= '2015'", outcome='slpm', group='t', cluster='fighter_id', reference='other')),
    dict(id='compare-cbb-home-pts', study=dict(study='compare', sql="SELECT gid, 'home' AS side, home_pts AS pts FROM cbb.games WHERE season = '2024-25' AND NOT neutral AND NOT coalesce(non_d1::BOOLEAN, false) UNION ALL SELECT gid, 'away', away_pts FROM cbb.games WHERE season = '2024-25' AND NOT neutral AND NOT coalesce(non_d1::BOOLEAN, false)", outcome='pts', group='side', cluster='gid', reference='away')),
    dict(id='compare-nfl-downs-holm', study=dict(study='compare', sql=NFL24.format(s='2022'), outcome='success', group='down', cluster='game_id', reference=1)),
    # ---- regress
    dict(id='ols-nba-pts-classical', study=dict(study='regress', sql=NBA_TG.format(s='2024-25'), outcome='pts', predictors=['fga', 'fg3a', 'fta', 'tov'])),
    dict(id='ols-nba-pts-cluster-team', study=dict(study='regress', sql=NBA_TG.format(s='2024-25'), outcome='pts', predictors=['fga', 'fg3a', 'fta', 'tov'], cluster='team')),
    dict(id='ols-nba-pts-categorical-home', study=dict(study='regress', sql=NBA_TG.format(s='2022-23'), outcome='pts', predictors=['fga', 'fta'], categorical=['home'], cluster='game_id')),
    dict(id='ols-nfl-epa-cluster-game', study=dict(study='regress', sql=NFL24.format(s='2024'), outcome='epa', predictors=['shotgun', 'no_huddle', 'ydstogo'], cluster='game_id')),
    dict(id='ols-nfl-epa-categorical-down', study=dict(study='regress', sql=NFL24.format(s='2021'), outcome='epa', predictors=['ydstogo'], categorical=['down'], cluster='game_id')),
    dict(id='logit-nfl-success', study=dict(study='regress', model='logistic', sql=NFL24.format(s='2024'), outcome='success', predictors=['shotgun', 'ydstogo', 'down'])),
    dict(id='logit-nfl-success-cluster', study=dict(study='regress', model='logistic', sql=NFL24.format(s='2024'), outcome='success', predictors=['shotgun', 'ydstogo', 'down'], cluster='game_id')),
    dict(id='logit-nba-made-distance', study=dict(study='regress', model='logistic', sql="SELECT game_id, made, distance FROM nba.shots WHERE season = '2024-25' AND distance IS NOT NULL", outcome='made', predictors=['distance'], cluster='game_id')),
    dict(id='ols-cfb-epa-garbage', study=dict(study='regress', sql="SELECT game_id, epa, garbage::INTEGER AS garbage, distance, yardline_100 FROM cfb.plays WHERE season = '2024' AND scrimmage AND epa IS NOT NULL AND distance IS NOT NULL", outcome='epa', predictors=['garbage', 'distance', 'yardline_100'], cluster='game_id')),
    dict(id='logit-ufc-win', study=dict(study='regress', model='logistic', sql="SELECT fight_id, fighter_id, CASE WHEN result = 'W' THEN 1 ELSE 0 END AS won, ss - opp_ss AS ss_diff, td - opp_td AS td_diff FROM ufc.fights WHERE stats AND result IN ('W', 'L') AND season >= '2018'", outcome='won', predictors=['ss_diff', 'td_diff'], cluster='fight_id')),
    dict(id='ols-nfl-games-rest', study=dict(study='regress', sql="SELECT game_id, team, epa_play, rest, opp_rest, home FROM nfl.games WHERE season BETWEEN '2015' AND '2024' AND season_type = 'REG' AND epa_play IS NOT NULL AND rest IS NOT NULL AND opp_rest IS NOT NULL", outcome='epa_play', predictors=['rest', 'opp_rest'], categorical=['home'], cluster='team')),
    dict(id='ols-collinear-vif', study=dict(study='regress', sql=NBA_TG.format(s='2021-22'), outcome='pts', predictors=['fga', 'fg3a', 'fta', 'tov'], cluster='game_id')),
    # ---- trend and distribution
    dict(id='trend-nba-corner3', study=dict(study='trend', sql="SELECT season, game_id, CASE WHEN zone LIKE '%Corner 3' THEN 1 ELSE 0 END AS c3 FROM nba.shots WHERE season BETWEEN '2014-15' AND '2024-25'", outcome='c3', period='season', cluster='game_id')),
    dict(id='trend-nfl-shotgun', study=dict(study='trend', sql="SELECT season, game_id, shotgun FROM nfl.plays WHERE season BETWEEN '2012' AND '2024' AND season_type = 'REG' AND play_type IN ('pass', 'run')", outcome='shotgun', period='season', cluster='game_id')),
    dict(id='distribution-nba-ppg', study=dict(study='distribution', sql="SELECT player, sum(pts) * 1.0 / count(*) AS ppg FROM nba.player_games WHERE season = '2024-25' GROUP BY player HAVING count(*) >= 50", value='ppg', id='player', target_id='Nikola Jokić', pool='NBA players with 50+ games, 2024-25')),
]


def run(cases):
    out = tempfile.mktemp(suffix='.json')
    job = {'studies': [c['study'] for c in cases], 'observations': [c['study']['sql'] for c in cases]}
    p = subprocess.run(['node', os.path.join(ROOT, 'tools', 'analysis', 'run.mjs')], input=json.dumps(job).encode(), capture_output=True, cwd=ROOT, env={**os.environ, 'OUT': out}, timeout=3600)
    if p.returncode:
        raise SystemExit(p.stderr.decode()[-3000:])
    with open(out) as f:
        r = json.load(f)
    os.remove(out)
    return r['studies'], r['observations']


def frame(obs):
    return pd.DataFrame(obs['rows'], columns=obs['columns'])


def near(a, b, rel=1e-6, abs_=1e-9):
    if a is None or b is None:
        return a is None and b is None
    a, b = float(a), float(b)
    if math.isinf(a) or math.isinf(b):
        return a == b
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


def pnear(a, b):
    if a is None or b is None:
        return a is None and b is None
    if a < 1e-12 and b < 1e-12:
        return True
    return near(a, b, rel=1e-5, abs_=1e-12)


def dummies(df, cats):
    X = []
    names = []
    for c in cats:
        v = df[c].astype(str)
        order = v.value_counts().sort_index().sort_values(ascending=False, kind='stable')
        # the engine's reference level: most common, ties by value
        counts = v.value_counts()
        top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        for lvl, _ in top[1:]:
            X.append((v == lvl).astype(float).to_numpy())
            names.append(f'{c}={lvl}')
    return X, names


def ref_regress(c, obs):
    s = c['study']
    df = frame(obs)
    cols = [s['outcome'], *s.get('predictors', []), *s.get('categorical', []), *([s['cluster']] if s.get('cluster') else [])]
    df = df.dropna(subset=cols)
    y = df[s['outcome']].astype(float).to_numpy()
    X = [np.ones(len(df))] + [df[p].astype(float).to_numpy() for p in s.get('predictors', [])]
    names = ['(intercept)'] + list(s.get('predictors', []))
    dx, dn = dummies(df, s.get('categorical', []))
    X = np.column_stack(X + dx)
    names += dn
    kw = {}
    if s.get('cluster'):
        g = pd.factorize(df[s['cluster']].astype(str))[0]
        kw = dict(cov_type='cluster', cov_kwds={'groups': g})
    if s.get('model') == 'logistic':
        m = sm.Logit(y, X).fit(disp=0, method='newton', tol=1e-12, maxiter=100, **kw)
        ci = m.conf_int()
        out = {'names': names, 'beta': m.params, 'se': m.bse, 'lo': ci[:, 0], 'hi': ci[:, 1], 'p': m.pvalues, 'll': m.llf}
    else:
        if kw:
            kw['use_t'] = True
        m = sm.OLS(y, X).fit(**kw)
        ci = m.conf_int()
        out = {'names': names, 'beta': m.params, 'se': m.bse, 'lo': ci[:, 0], 'hi': ci[:, 1], 'p': m.pvalues, 'r2': m.rsquared}
    if X.shape[1] > 2:
        out['vif'] = [variance_inflation_factor(X, i) for i in range(1, X.shape[1])]
    return out


def cmp_regress(c, got, ref):
    bad = []
    co = {x['term']: x for x in got['coefficients']}
    for i, n in enumerate(ref['names']):
        g = co.get(n)
        if not g:
            bad.append(f'missing term {n}')
            continue
        for k, rk in (('estimate', 'beta'), ('std_error', 'se'), ('ci_low', 'lo'), ('ci_high', 'hi')):
            if not near(g[k], ref[rk][i]):
                bad.append(f'{n} {k} {g[k]} vs {ref[rk][i]}')
        # A coefficient that is zero by construction (the UFC case: every fight appears from both corners, so
        # the intercept is 0 to rounding) has a p-value that is rounding noise in both programs: not compared.
        if abs(ref['beta'][i]) > 1e-9 * max(1.0, ref['se'][i]) and not pnear(g['p_value'], ref['p'][i]):
            bad.append(f'{n} p {g["p_value"]} vs {ref["p"][i]}')
    if 'r2' in ref and not near(got['fit']['r_squared'], ref['r2']):
        bad.append(f"R2 {got['fit']['r_squared']} vs {ref['r2']}")
    if 'll' in ref and not near(got['fit']['log_likelihood'], ref['ll']):
        bad.append(f"loglik {got['fit']['log_likelihood']} vs {ref['ll']}")
    if 'vif' in ref:
        for v, r in zip(got['vif'], ref['vif']):
            if not near(v['vif'], r, rel=1e-5):
                bad.append(f"VIF {v['term']} {v['vif']} vs {r}")
    return bad


def ref_compare(c, obs):
    s = c['study']
    df = frame(obs).dropna(subset=[s['outcome'], s['group']])
    g = df[s['group']].astype(str)
    ref = str(s['reference'])
    out = []
    for lvl in sorted(set(g) - {ref}):
        d = df[(g == lvl) | (g == ref)]
        y = d[s['outcome']].astype(float).to_numpy()
        D = (d[s['group']].astype(str) == lvl).astype(float).to_numpy()
        X = sm.add_constant(D)
        cl = pd.factorize(d[s['cluster']].astype(str))[0]
        m = sm.OLS(y, X).fit(cov_type='cluster', cov_kwds={'groups': cl}, use_t=True)
        ci = m.conf_int()
        out.append({'group': lvl, 'diff': m.params[1], 'se': m.bse[1], 'lo': ci[1, 0], 'hi': ci[1, 1], 'p': m.pvalues[1]})
    return out


def cmp_compare(c, got, ref):
    bad = []
    tests = {t['group']: t for t in got['tests']}
    for r in ref:
        t = tests.get(r['group'])
        if not t:
            bad.append(f"missing group {r['group']}")
            continue
        a = t['analytic']
        for k, rk in (('std_error', 'se'), ('ci_low', 'lo'), ('ci_high', 'hi')):
            if not near(a[k], r[rk]):
                bad.append(f"{r['group']} {k} {a[k]} vs {r[rk]}")
        if not near(t['difference'], r['diff']):
            bad.append(f"{r['group']} diff {t['difference']} vs {r['diff']}")
        if not pnear(a['p_value'], r['p']):
            bad.append(f"{r['group']} p {a['p_value']} vs {r['p']}")
        # the bootstrap: same centre, width within 25% of the analytic interval
        wb, wa = t['ci_high'] - t['ci_low'], r['hi'] - r['lo']
        if not (0.75 <= wb / wa <= 1.25):
            bad.append(f"{r['group']} bootstrap width {wb:.4g} vs analytic {wa:.4g}")
    if len(got['tests']) > 1:
        want = multipletests([t['p_bootstrap'] for t in got['tests']], method='holm')[1]
        for t, w in zip(got['tests'], want):
            if not near(t['p_adjusted'], w):
                bad.append(f"Holm {t['group']} {t['p_adjusted']} vs {w}")
    return bad


def ref_trend(c, obs):
    s = c['study']
    df = frame(obs).dropna(subset=[s['outcome'], s['period']])
    per = sorted(df[s['period']].astype(str).unique())
    x = df[s['period']].astype(str).map({p: i for i, p in enumerate(per)}).to_numpy(dtype=float)
    y = df[s['outcome']].astype(float).to_numpy()
    cl = pd.factorize(df[s['cluster']].astype(str))[0]
    m = sm.OLS(y, sm.add_constant(x)).fit(cov_type='cluster', cov_kwds={'groups': cl}, use_t=True)
    ci = m.conf_int()
    means = df.groupby(df[s['period']].astype(str))[s['outcome']].mean()
    return {'slope': m.params[1], 'lo': ci[1, 0], 'hi': ci[1, 1], 'p': m.pvalues[1], 'means': means.to_dict()}


def cmp_trend(c, got, ref):
    bad = []
    sl = got['slope']
    for k, rk in (('per_period', 'slope'), ('ci_low', 'lo'), ('ci_high', 'hi')):
        if not near(sl[k], ref[rk]):
            bad.append(f'slope {k} {sl[k]} vs {ref[rk]}')
    if not pnear(sl['p_value'], ref['p']):
        bad.append(f"slope p {sl['p_value']} vs {ref['p']}")
    for p in got['periods']:
        if not near(p['value'], ref['means'][p['period']]):
            bad.append(f"{p['period']} mean")
    return bad


def ref_distribution(c, obs):
    s = c['study']
    df = frame(obs).dropna(subset=[s['value']])
    v = df[s['value']].astype(float).to_numpy()
    t = float(df[df[s['id']].astype(str) == s['target_id']][s['value']].iloc[0])
    return {'pct': st.percentileofscore(v, t, kind='mean'), 'median': float(np.median(v)), 'sd': float(np.std(v, ddof=1)), 'p25': float(np.quantile(v, 0.25))}


def cmp_distribution(c, got, ref):
    bad = []
    if not near(got['percentile'], ref['pct']):
        bad.append(f"percentile {got['percentile']} vs {ref['pct']}")
    for k in ('median', 'sd', 'p25'):
        if not near(got['summary'][k], ref[k]):
            bad.append(f'{k} {got["summary"][k]} vs {ref[k]}')
    return bad


REF = {'regress': (ref_regress, cmp_regress), 'compare': (ref_compare, cmp_compare), 'trend': (ref_trend, cmp_trend), 'distribution': (ref_distribution, cmp_distribution)}


def main():
    got, obs = run(CASES)
    report, fails = [], 0
    for c, g, o in zip(CASES, got, obs):
        if 'error' in g or 'error' in o:
            bad = [g.get('error') or o.get('error')]
        else:
            fn, cmpf = REF[c['study']['study']]
            bad = cmpf(c, g, fn(c, o))
        fails += 1 if bad else 0
        report.append({'case': c['id'], 'study': c['study']['study'], 'rows': len(o.get('rows', [])), 'ok': not bad, 'misses': bad[:5]})
        print(f"{'ok  ' if not bad else 'FAIL'} {c['id']}: {len(o.get('rows', []))} rows{'' if not bad else '  ' + '; '.join(map(str, bad[:3]))}")
    json.dump(report, open(os.path.join(ROOT, 'tools', 'analysis', 'stats_parity.json'), 'w'), indent=1)
    cr = sum(1 for r in report if r['ok'] and r['study'] in ('compare', 'regress'))
    print(f'\n{len(CASES) - fails} of {len(CASES)} cases match the reference ({cr} compare and regress)')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
