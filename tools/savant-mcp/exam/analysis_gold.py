"""tools/savant-mcp/exam/analysis_gold.py — gold answers for the analyst exam's 20 analysis questions (the
ones only savant_sql and savant_analyze can answer: whole-league, multi-season, needing an interval or a
regression). research/analysis/BUILD.md §5 "Exam".

    python3 tools/savant-mcp/exam/analysis_gold.py [--out FILE]      (exam.mjs gold runs it)

INDEPENDENT OF THE TOOLS UNDER TEST. Every answer here is computed with pandas and statsmodels straight from
the Data Room's JSON tables (the release-asset files in out/dataroom and the small ones in public/dataroom),
never through DuckDB, the Parquet copies, api/_sql.js or api/_analyze.js. Where a study resamples (the
bootstrap), the gold is the analytic quantity the study also reports (the cluster-robust interval), so it is
exact. Each function returns the value the question's read path picks out of the tool's answer.
"""
import gzip, json, os, sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
HOSTED = os.path.join(ROOT, 'out', 'dataroom')
PUB = os.path.join(ROOT, 'public', 'dataroom')


def table(sport, name, season, cols=None):
    for base in (HOSTED, PUB):
        p = os.path.join(base, sport, name, f'{season}.json.gz')
        if os.path.exists(p):
            d = json.load(gzip.open(p, 'rt'))
            df = pd.DataFrame(d['rows'], columns=d['columns'])
            if cols:
                df = df[[c for c in cols if c in df.columns]].copy()   # one season at a time, only what is used (8 GB of RAM)
            df['season'] = season
            return df
    raise FileNotFoundError(f'{sport} {name} {season}')


def seasons_nba(a, b):
    out, y = [], int(a[:4])
    while y <= int(b[:4]):
        out.append(f'{y}-{str((y + 1) % 100).zfill(2)}')
        y += 1
    return out


def many(sport, name, seasons, cols=None):
    return pd.concat([table(sport, name, s, cols) for s in seasons], ignore_index=True)


def cr_ols(y, X, groups):
    m = sm.OLS(np.asarray(y, float), np.asarray(X, float)).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(pd.Series(groups).astype(str))[0]}, use_t=True)
    return m


def two_group(df, y, g, ref, other, cl):
    d = df[df[g].isin([ref, other])].dropna(subset=[y])
    D = (d[g] == other).astype(float)
    m = cr_ols(d[y], sm.add_constant(D.to_numpy()), d[cl])
    ci = m.conf_int()
    return {'difference': m.params[1], 'ci_low': ci[1, 0], 'ci_high': ci[1, 1]}


def coef(m, i):
    ci = m.conf_int()
    return {'estimate': m.params[i], 'ci_low': ci[i, 0], 'ci_high': ci[i, 1]}


def nba_team_games(seasons):
    pg = many('nba', 'player_games', seasons)
    tg = pg.groupby(['season', 'game_id', 'team', 'home', 'date'], as_index=False).agg(pts=('pts', 'sum'), fgm=('fgm', 'sum'), fga=('fga', 'sum'), fg3a=('fg3a', 'sum'), fta=('fta', 'sum'))
    return tg


# ---- the questions ----------------------------------------------------------------------------------
def a01():
    tg = nba_team_games(seasons_nba('2015-16', '2024-25'))
    tg['date'] = pd.to_datetime(tg['date'])
    g = tg[['season', 'team', 'game_id', 'date']].drop_duplicates().sort_values(['season', 'team', 'date'])
    g['rest'] = g.groupby(['season', 'team'])['date'].diff().dt.days
    tg = tg.merge(g[['season', 'team', 'game_id', 'rest']], on=['season', 'team', 'game_id'])
    tg['night'] = np.where(tg['rest'] == 1, 'b2b', 'rested')
    tg['fg_pct'] = tg.fgm / tg.fga
    return two_group(tg, 'fg_pct', 'night', 'rested', 'b2b', 'game_id')


def a02():
    sh = many('nba', 'shots', seasons_nba('2014-15', '2024-25'), ['game_id', 'zone'])
    sh['c3'] = sh['zone'].fillna('').str.endswith('Corner 3').astype(float)
    per = sorted(sh.season.unique())
    x = sh.season.map({p: i for i, p in enumerate(per)}).astype(float)
    m = cr_ols(sh.c3, sm.add_constant(x.to_numpy()), sh.game_id)
    ci = m.conf_int()
    return {'per_period': m.params[1], 'ci_low': ci[1, 0], 'ci_high': ci[1, 1]}


def a03():
    tg = nba_team_games(['2004-05', '2014-15', '2024-25'])
    return [[s, v] for s, v in tg.groupby('season').fg3a.mean().items()]


def a04():
    tg = nba_team_games(['2024-25'])
    m = cr_ols(tg.pts, sm.add_constant(tg[['fg3a', 'fta']].to_numpy(float)), tg.team)
    return coef(m, 1)


def a05():
    tg = nba_team_games(['2023-24'])
    tg['fg_pct'] = tg.fgm / tg.fga
    tg['side'] = np.where(tg.home == 1, 'home', 'away')
    return two_group(tg, 'fg_pct', 'side', 'away', 'home', 'game_id')


def a06():
    sh = table('nba', 'shots', '2024-25').dropna(subset=['distance'])
    m = sm.Logit(sh.made.astype(float).to_numpy(), sm.add_constant(sh.distance.astype(float).to_numpy())).fit(disp=0, cov_type='cluster', cov_kwds={'groups': pd.factorize(sh.game_id.astype(str))[0]})
    ci = m.conf_int()
    return {'estimate': m.params[1], 'ci_low': ci[1, 0], 'ci_high': ci[1, 1]}


K_GRID = sorted({round(10 ** (i / 40), 1) for i in range(0, 161)})


def a07():
    """3P% settle point, settle_points.py's method over the game logs (pandas), positions and qualification from the page."""
    sav = json.load(open(os.path.join(ROOT, 'public', 'savant-data.json')))
    ss = seasons_nba('2010-11', '2025-26')
    pos = {(s, p['id']): p['pos'] for s in ss if s in sav['data'] for p in sav['data'][s]['players'] if p.get('qualified')}
    pg = many('nba', 'player_games', ss)
    pg = pg[[k in pos for k in zip(pg.season, pg.player_id)]].copy()
    pg['pos'] = [pos[k] for k in zip(pg.season, pg.player_id)]
    pg = pg[pg.fg3a > 0]
    last = pg[['season', 'team', 'date']].drop_duplicates().sort_values('date').groupby(['season', 'team']).tail(25)
    last = set(zip(last.season, last.team, last.date))
    pg['win'] = [k in last for k in zip(pg.season, pg.team, pg.date)]
    ps = pg.groupby(['season', 'player_id', 'pos']).agg(n=('fg3a', 'sum'), x=('fg3m', 'sum')).reset_index()
    ps['v'] = ps.x / ps.n
    means = ps.groupby(['season', 'pos']).v.agg(['mean', 'min', 'max', 'count']).reset_index()
    w = pg[pg.win].groupby(['season', 'player_id']).agg(nw=('fg3a', 'sum'), xw=('fg3m', 'sum')).reset_index()
    d = ps.merge(w, on=['season', 'player_id']).merge(means, on=['season', 'pos'])
    d = d[(d['count'] >= 5) & (d.nw > 0) & (d.n - d.nw >= 0.5 * d.n)]
    vw, vf = d.xw / d.nw, (d.x - d.xw) / (d.n - d.nw)
    prior = d['mean'].clip(d['min'], d['max'])
    best = min(K_GRID, key=lambda k: float(np.sqrt(np.mean(((d.nw * vw + k * prior) / (d.nw + k) - vf) ** 2))))
    return best


NFL_COLS = ['game_id', 'season_type', 'play_type', 'qb_dropback', 'pressure', 'epa', 'shotgun', 'no_huddle', 'ydstogo', 'down', 'success']
NFL_PLAYS = lambda s: table('nfl', 'plays', s, NFL_COLS)  # noqa: E731


def a08():
    p = pd.concat([NFL_PLAYS(s) for s in ('2022', '2023', '2024')])
    p = p[(p.season_type == 'REG') & (p.qb_dropback == 1) & p.epa.notna()].copy()
    p['pr'] = np.where(p.pressure == 1, 'pressured', 'clean')
    return two_group(p, 'epa', 'pr', 'clean', 'pressured', 'game_id')


def a09():
    p = pd.concat([NFL_PLAYS(str(y)) for y in range(2012, 2025)])
    p = p[(p.season_type == 'REG') & p.play_type.isin(['pass', 'run']) & p.shotgun.notna()]
    per = sorted(p.season.unique())
    x = p.season.map({q: i for i, q in enumerate(per)}).astype(float)
    m = cr_ols(p.shotgun, sm.add_constant(x.to_numpy()), p.game_id)
    ci = m.conf_int()
    return {'per_period': m.params[1], 'ci_low': ci[1, 0], 'ci_high': ci[1, 1]}


def nfl_scrim(s):
    p = NFL_PLAYS(s)
    return p[(p.season_type == 'REG') & p.play_type.isin(['pass', 'run']) & p.down.notna() & p.epa.notna()].dropna(subset=['shotgun', 'no_huddle', 'ydstogo'])


def a10():
    p = nfl_scrim('2024')
    m = cr_ols(p.epa, sm.add_constant(p[['shotgun', 'no_huddle', 'ydstogo']].to_numpy(float)), p.game_id)
    return coef(m, 1)


def a11():
    p = NFL_PLAYS('2023')
    p = p[(p.season_type == 'REG') & p.play_type.isin(['pass', 'run']) & p.down.notna() & p.epa.notna()].dropna(subset=['shotgun', 'ydstogo', 'down', 'success'])
    m = sm.Logit(p.success.astype(float).to_numpy(), sm.add_constant(p[['shotgun', 'ydstogo', 'down']].to_numpy(float))).fit(disp=0, cov_type='cluster', cov_kwds={'groups': pd.factorize(p.game_id.astype(str))[0]})
    ci = m.conf_int()
    return {'estimate': m.params[2], 'ci_low': ci[2, 0], 'ci_high': ci[2, 1]}


def a12():
    g = pd.concat([table('nfl', 'games', str(y)) for y in range(2010, 2025)])
    g = g[(g.season_type == 'REG') & (g.neutral != 1) & g.result.isin(['W', 'L'])].copy()
    g['win'] = (g.result == 'W').astype(float)
    g['side'] = np.where(g.home == 1, 'home', 'away')
    return two_group(g, 'win', 'side', 'away', 'home', 'game_id')


def a13():
    g = pd.concat([table('nfl', 'games', str(y)) for y in range(2015, 2025)])
    g = g[(g.season_type == 'REG')].dropna(subset=['epa_play', 'rest', 'opp_rest'])
    m = cr_ols(g.epa_play, sm.add_constant(g[['rest', 'opp_rest']].to_numpy(float)), g.team)
    return coef(m, 1)


def a14():
    p = table('cfb', 'plays', '2025')
    p = p[(p.scrimmage == True) & p.epa.notna()].copy()  # noqa: E712
    p['g'] = np.where(p.garbage == True, 'garbage', 'competitive')  # noqa: E712
    return two_group(p, 'epa', 'g', 'competitive', 'garbage', 'game_id')


def a15():
    p = pd.concat([table('cfb', 'plays', str(y), ['game_id', 'scrimmage', 'pass', 'rush']) for y in range(2014, 2026)])
    p = p[(p.scrimmage == True) & ((p['pass'] == True) | (p.rush == True))]  # noqa: E712
    p['is_pass'] = (p['pass'] == True).astype(float)  # noqa: E712
    per = sorted(p.season.unique())
    x = p.season.map({q: i for i, q in enumerate(per)}).astype(float)
    m = cr_ols(p.is_pass, sm.add_constant(x.to_numpy()), p.game_id)
    ci = m.conf_int()
    return {'per_period': m.params[1], 'ci_low': ci[1, 0], 'ci_high': ci[1, 1]}


def a16():
    g = table('cfb', 'games', '2024')
    g = g[(g.neutral != True) & g.epa_play.notna()].copy()  # noqa: E712
    g['home_flag'] = (g.home == True).astype(float)  # noqa: E712
    m = cr_ols(g.epa_play, sm.add_constant(g[['home_flag']].to_numpy(float)), g.team_id)
    return coef(m, 1)


def ufc_fights(since):
    return pd.concat([table('ufc', 'fights', str(y)) for y in range(since, 2027) if os.path.exists(os.path.join(PUB, 'ufc', 'fights', f'{y}.json.gz'))])


def a17():
    f = ufc_fights(2015)
    f = f[(f.stats == True) & (f.fight_seconds >= 60)].copy()  # noqa: E712
    f['slpm'] = f.ss * 60.0 / f.fight_seconds
    f['t'] = np.where(f.title == True, 'title', 'other')  # noqa: E712
    return two_group(f, 'slpm', 't', 'other', 'title', 'fighter_id')


def a18():
    f = ufc_fights(2018)
    f = f[(f.stats == True) & f.result.isin(['W', 'L'])].copy()  # noqa: E712
    f['won'] = (f.result == 'W').astype(float)
    f['ss_diff'] = f.ss - f.opp_ss
    f['td_diff'] = f.td - f.opp_td
    f = f.dropna(subset=['ss_diff', 'td_diff'])
    m = sm.Logit(f.won.to_numpy(float), sm.add_constant(f[['ss_diff', 'td_diff']].to_numpy(float))).fit(disp=0, cov_type='cluster', cov_kwds={'groups': pd.factorize(f.fight_id.astype(str))[0]})
    ci = m.conf_int()
    return {'estimate': m.params[2], 'ci_low': ci[2, 0], 'ci_high': ci[2, 1]}


def a19():
    d = json.load(gzip.open(os.path.join(ROOT, 'public', 'cbb', 'games', '2024-25.json.gz'), 'rt'))
    g = pd.DataFrame(d['rows'], columns=d['cols'])
    g = g[(g.neutral != True) & (g.non_d1.fillna(0).astype(bool) == False) & g.home_pts.notna()]  # noqa: E712
    long = pd.concat([pd.DataFrame({'gid': g.gid, 'side': 'home', 'pts': g.home_pts}), pd.DataFrame({'gid': g.gid, 'side': 'away', 'pts': g.away_pts})])
    return two_group(long, 'pts', 'side', 'away', 'home', 'gid')


def a20():
    pg = table('nba', 'player_games', '2024-25')
    a = pg.groupby('player').agg(n=('pts', 'size'), pts=('pts', 'sum'))
    a = a[a.n >= 50]
    v = (a.pts / a.n).to_numpy()
    return st.percentileofscore(v, float(a.loc['Nikola Jokić'].pts / a.loc['Nikola Jokić'].n), kind='mean')


GOLD = {f'a-{i:02d}': globals()[f'a{i:02d}'] for i in range(1, 21)}


def r6(v):
    if isinstance(v, dict):
        return {k: r6(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [r6(x) for x in v]
    if isinstance(v, (float, np.floating)):
        return round(float(v), 6)
    if isinstance(v, np.integer):
        return int(v)
    return v


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(ROOT, 'tools', 'savant-mcp', 'exam', 'analysis_gold.json')
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    res = {}
    for k, fn in GOLD.items():
        if only and k not in only:
            continue
        res[k] = r6(fn())
        print(k, json.dumps(res[k])[:120])
    json.dump(res, open(out, 'w'), indent=1)


if __name__ == '__main__':
    main()
