"""
luck_study.py — is the luck adjustment too strong? Report only: nothing here changes the points.

The adjustment (luck.py) treats all of opponents' three-point and free-throw shooting away from the league average as
luck. A partial adjustment moves it only part of the way: margin + f x luck, f = 1 the current one, f = 0 the raw margin.
Three tests, each out of sample (every target season predicted by fits on earlier seasons only), each over f = 0 to 1:
  next season   this season's margin_f predicting next season's raw margin (team-seasons, 1980-81 on)
  second half   the first half's margin_f (its own luck, from the game logs) predicting the second half's raw margin
  playoffs      every playoff game on the margin_f difference and home court (log-likelihood), and the title model's
                log score (titles.playoff_scores: the raw share u = 1 - f)
The best f for each, chosen out of sample (each season's f the best over the seasons before it), its gain over f = 1,
and what GM Value Added would be for the showcase GMs at that f (production at margin_f, value per margin point refit).

    cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/gm/luck_study.py
    -> out/luck_study.txt     (the game logs come from the engine's cache: nothing is fetched)
"""
import collections, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, os.path.join(HERE, '..'))
FS = tuple(round(x, 2) for x in np.arange(0, 1.01, 0.1))


def logs():
    """{season: [(date, team, opp, margin, opp 3PM, opp 3PA, opp FTM, opp FTA)]} from the engine's cached game logs."""
    import savant_engine as E
    from nba_api.stats.endpoints import leaguegamelog as L
    from titles_data import nba_fr
    out = {}
    for y in range(1980, 2027):
        s = f'{y - 1}-{str(y)[2:]}'
        df = E.call(L.LeagueGameLog, dict(season=s, season_type_all_star='Regular Season', player_or_team_abbreviation='T'))
        by = collections.defaultdict(list)
        for row in zip(df['GAME_ID'], df['GAME_DATE'], df['TEAM_ABBREVIATION'], df['PTS'], df['FG3M'], df['FG3A'], df['FTM'], df['FTA']):
            by[row[0]].append(row)
        g = []
        for rows in by.values():
            if len(rows) != 2:
                continue
            nz = lambda v: 0.0 if v != v or v is None else float(v)      # a count the old logs leave empty is zero
            if any(r[3] != r[3] for r in rows):
                continue
            rows = [tuple(r[:3]) + tuple(nz(v) for v in r[3:]) for r in rows]
            for a, b in ((rows[0], rows[1]), (rows[1], rows[0])):
                if a[3] == b[3]:
                    continue
                g.append((str(a[1])[:10], nba_fr(a[2], y), nba_fr(b[2], y), a[3] - b[3], b[4], b[5], b[6], b[7]))
        out[s] = g
    return out


def luck_of(games, p3, pft):
    n = len(games)
    return (3 * (sum(g[4] for g in games) - sum(g[5] for g in games) * p3) + (sum(g[6] for g in games) - sum(g[7] for g in games) * pft)) / n if n else 0.0


def forward_mse(pairs, fs=FS, first=1990):
    """pairs: [(target season, {f: x}, y)]. For each f: the out-of-sample squared error by target season (a + b x fit
    on earlier target seasons). Returns {f: {season: mse}}."""
    out = {f: {} for f in fs}
    seasons = sorted({p[0] for p in pairs})
    for Y in seasons:
        if Y < first:
            continue
        tr = [p for p in pairs if p[0] < Y]
        te = [p for p in pairs if p[0] == Y]
        for f in fs:
            X = np.array([p[1][f] for p in tr]); yv = np.array([p[2] for p in tr])
            b = np.polyfit(X, yv, 1)
            xt = np.array([p[1][f] for p in te]); yt = np.array([p[2] for p in te])
            out[f][Y] = float(((np.polyval(b, xt) - yt) ** 2).mean())
    return out


def chosen(per, lower=True):
    """Each season's f: the best total over the seasons before it (f = 1 with fewer than five); its score that season."""
    seasons = sorted(next(iter(per.values())))
    pick, score = {}, {}
    for i, Y in enumerate(seasons):
        prior = seasons[:i]
        f = 1.0 if len(prior) < 5 else min(per, key=lambda f: sum(per[f][x] for x in prior))
        pick[Y], score[Y] = f, per[f][Y]
    return pick, score


def gain_line(name, per, unit):
    pick, sc = chosen(per)
    base = per[1.0]
    d = np.array([sc[Y] - base[Y] for Y in sc])
    rng = np.random.default_rng(2)
    bs = [rng.choice(d, len(d)).mean() for _ in range(3000)]
    best_fixed = min(per, key=lambda f: np.mean(list(per[f].values())))
    tab = ' '.join(f'{f:.1f}:{np.mean(list(per[f].values())):.4f}' for f in per)
    last = pick[max(pick)]
    return (f'{name}: chosen out of sample (latest f {last:.1f}) against the full adjustment {d.mean():+.4f} {unit} a season '
            f'[95% {np.percentile(bs, 2.5):+.4f}, {np.percentile(bs, 97.5):+.4f}]; best fixed f over the same seasons {best_fixed:.1f}\n'
            f'    by f (mean {unit}): {tab}'), last, best_fixed


def main():
    import titles as T
    L = json.load(open(os.path.join(OUT, 'luck_margins.json')))
    G = logs()
    rep = ['Is the luck adjustment too strong? (report only: the points are unchanged)', '']
    # league percentages per season and the game-log luck against luck.py's (Basketball-Reference totals)
    lg, chk = {}, []
    for s, g in G.items():
        p3 = sum(x[4] for x in g) / max(1, sum(x[5] for x in g))
        pft = sum(x[6] for x in g) / max(1, sum(x[7] for x in g))
        lg[s] = (p3, pft)
        by = collections.defaultdict(list)
        for x in g:
            by[x[1]].append(x)
        for t, gl in by.items():
            if t in L.get(s, {}).get('teams', {}):
                chk.append((luck_of(gl, p3, pft), L[s]['teams'][t]['luck']))
    a, b = np.array(chk).T
    good = set()
    for s, g in G.items():
        p3, pft = lg[s]
        by = collections.defaultdict(list)
        for x in g:
            by[x[1]].append(x)
        aa = np.array([(luck_of(gl, p3, pft), L[s]['teams'][t]['luck']) for t, gl in by.items() if t in L[s]['teams']])
        if np.corrcoef(aa.T)[0, 1] >= 0.99:
            good.add(s)
    bad = sorted(set(G) - good)
    rep.append(f'game-log luck against luck.py\'s: correlation {np.corrcoef(a, b)[0, 1]:.3f} over {len(a)} team-seasons; the logs\' shooting '
               f'counts are wrong in {bad[0]} to {bad[-1]} ({len(bad)} seasons, game-log luck off by up to 33 points), so the '
               f'second-half test uses only the {len(good)} seasons that match (correlation 0.99 or more)')
    # 1. next season
    pairs = []
    for s in T.SEASONS:
        y = T.y_of(s)
        s2 = f'{y}-{str(y + 1)[2:]}'
        if s2 not in T.P:
            continue
        for t in T.P[s]['teams']:
            if t in T.P[s2]['teams'] and t in L[s]['teams']:
                m, lk = T.MARGIN[(s, t)], L[s]['teams'][t]['luck']
                pairs.append((y + 1, {f: m + f * lk for f in FS}, T.MARGIN[(s2, t)]))
    line, f_next, fix_next = gain_line('next season (raw margin, squared error per team)', forward_mse(pairs), 'pts^2')
    rep.append(line)
    # 2. second half from the first
    pairs = []
    for s, g in G.items():
        if s not in good:
            continue
        y = T.y_of(s)
        p3, pft = lg[s]
        by = collections.defaultdict(list)
        for x in sorted(g):
            by[x[1]].append(x)
        for t, gl in by.items():
            h = len(gl) // 2
            if h < 15:
                continue
            first, second = gl[:h], gl[h:]
            m1 = np.mean([x[3] for x in first]); lk = luck_of(first, p3, pft)
            pairs.append((y, {f: m1 + f * lk for f in FS}, float(np.mean([x[3] for x in second]))))
    line, f_half, fix_half = gain_line('second half from the first (raw margin, squared error per team)', forward_mse(pairs), 'pts^2')
    rep.append(line)
    # 3. playoff games
    per = {f: {} for f in FS}
    rows = []
    for s in T.SEASONS:
        y, lk = T.y_of(s), L[s]['teams']
        for h, a_, won, home in T.games_of(s, 'po'):
            rows.append((y, home, {f: (T.MARGIN[(s, h)] + f * lk[h]['luck']) - (T.MARGIN[(s, a_)] + f * lk[a_]['luck']) for f in FS}, won))
    for Y in range(1990, 2027):
        tr = [r for r in rows if r[0] < Y]; te = [r for r in rows if r[0] == Y]
        for f in FS:
            X = np.array([(r[1], r[2][f]) for r in tr]); yv = np.array([r[3] for r in tr], float)
            bb = T.logit_fit(X, yv)
            Xt = np.array([(r[1], r[2][f]) for r in te]); yt = np.array([r[3] for r in te], float)
            p = T.sig(Xt @ bb)
            per[f][Y] = float(-np.where(yt == 1, np.log(p), np.log(1 - p)).mean())
    line, f_po, fix_po = gain_line('playoff games (log loss per game)', per, 'nats')
    rep.append(line)
    sc = T.playoff_scores()
    ev = [s for s in T.SEASONS if T.y_of(s) >= 1990]
    rep.append('title log score by f (no preseason blend | with the best fixed preseason weight): ' +
               ' '.join(f"{1 - u:.2f}: {np.mean([sc[s][(u, 0.0)] for s in ev]):.3f} | {min(np.mean([sc[s][(u, w)] for s in ev]) for w in T.BLEND_GRID):.3f}" for u in T.RAW_GRID))
    # what GM Value Added would be
    rep += ['', 'GM Value Added (5%) for the showcase GMs if production used margin + f x luck (value per margin point refit):']
    import gm5
    SP = {(r['person'], r['team']): r for r in json.load(open(os.path.join(OUT, 'gm_spells.json')))}
    segs = {(gm5.NAME.get(pid, pid), team): s for pid, team, s in gm5.spells()}
    show = [('Mitch Kupchak', 'LAL'), ('Jerry Krause', 'CHI'), ('Sam Presti', 'OKC'), ('Pat Riley', 'MIA'), ('Bob Myers', 'GSW'), ('Gregg Popovich', 'SAS')]
    fs = sorted({f_next, f_half, f_po, fix_next, fix_half, fix_po, 1.0, 0.5, 0.0})
    base_adj, base_k = dict(gm5.ADJ), gm5.ADJ_TO_VALUE
    res = {}
    for f in fs:
        gm5.ADJ = {k: m + f * gm5.LUCK.get(k, 0.0) for k, m in gm5.MARGIN.items()}
        pts = [(gm5.ADJ[k], gm5.TEAMVAL[k] - gm5.LEAGUE_AVG[k[1]]) for k in gm5.ADJ if k in gm5.TEAMVAL and k[1] < 2026]
        gm5.ADJ_TO_VALUE = float(np.polyfit([x for x, _ in pts], [v for _, v in pts], 1)[0])
        res[f] = {}
        for nm, tm in show:
            r = SP[(nm, tm)]
            pm_new = gm5.produced_margin(tm, segs[(nm, tm)])
            res[f][(nm, tm)] = (r['gm_value_added']['0.05'] - r['produced_margin_adj'] + pm_new, gm5.ADJ_TO_VALUE)
    gm5.ADJ, gm5.ADJ_TO_VALUE = base_adj, base_k
    rep.append('  f    ' + '  '.join(f'{nm.split()[-1]:>9}' for nm, _ in show) + '   value per margin point')
    for f in fs:
        rep.append(f'  {f:.1f}  ' + '  '.join(f'{res[f][k][0]:+9,.0f}' for k in show) + f'   {res[f][show[0]][1]:.1f}')
    open(os.path.join(OUT, 'luck_study.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))


if __name__ == '__main__':
    main()
