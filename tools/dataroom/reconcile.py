"""Reconcile every Data Room table with its Savant page's own numbers.

    python3 tools/dataroom/reconcile.py                 every sport
    python3 tools/dataroom/reconcile.py ufc nba          some
    options: --dataroom DIR (public/dataroom)  --hosted DIR (out/dataroom, the release-asset tables)

A table that fails is not shipped (BUILD.md ground rule 1). Each check sums the Data Room rows
the way the Savant build sums its inputs and compares with the number the Savant page shows,
player by player (or fighter, or team), for at least three seasons. It prints one line per
check and writes tools/dataroom/reconcile.json; exits 1 if any check fails.
"""
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = sys.argv[1:]


def opt(name, dflt):
    if f'--{name}' in args:
        i = args.index(f'--{name}')
        return args[i + 1]
    return dflt


PUB = opt('dataroom', os.path.join(ROOT, 'public', 'dataroom'))
HOSTED = opt('hosted', os.path.join(ROOT, 'out', 'dataroom'))
SPORTS = [a for a in args if not a.startswith('--') and a not in (opt('dataroom', None), opt('hosted', None))] or ['ufc', 'nba', 'nfl', 'cfb']
RESULTS = []


def table(sport, name, season, where=None):
    for base in ([where] if where else [PUB, HOSTED]):
        p = os.path.join(base, sport, name, f'{season}.json.gz')
        if os.path.exists(p):
            with gzip.open(p, 'rt') as f:
                d = json.load(f)
            ix = {c: i for i, c in enumerate(d['columns'])}
            return d, ix
    raise FileNotFoundError(f'{sport} {name} {season}')


def record(sport, tbl, season, what, compared, mismatches, sample=None):
    ok = compared > 0 and mismatches == 0
    RESULTS.append({'sport': sport, 'table': tbl, 'season': season, 'check': what, 'compared': compared,
                    'mismatches': mismatches, 'ok': ok, 'sample': sample})
    print(f"{'ok  ' if ok else 'FAIL'}  {sport} {tbl} {season}: {what} — {compared} compared, {mismatches} off" + (f"  e.g. {sample}" if sample and not ok else ''))


def close(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


# ---------------------------------------------------------------- UFC
def ufc():
    data = json.load(open(os.path.join(ROOT, 'public', 'ufc-savant-data.json')))
    years = sorted(os.listdir(os.path.join(PUB, 'ufc', 'fights')))
    rows = defaultdict(list)
    for fn in years:
        d, ix = table('ufc', 'fights', fn[:4])
        for r in d['rows']:
            rows[r[ix['fighter_id']]].append((r, ix))
    n = bad = 0
    sample = None
    for fid, f in data['fighters'].items():
        m = ((f.get('w') or {}).get('career') or {}).get('m')
        if not m:
            continue
        rs = rows.get(fid, [])
        secs = sum(r[ix['fight_seconds']] or 0 for r, ix in rs)
        mins = secs / 60.0
        ss = sum(r[ix['ss']] or 0 for r, ix in rs if r[ix['stats']])
        oss = sum(r[ix['opp_ss']] or 0 for r, ix in rs if r[ix['stats']])
        w = sum(1 for r, ix in rs if r[ix['result']] == 'W')
        l = sum(1 for r, ix in rs if r[ix['result']] == 'L')
        got = {'n': len(rs), 'min': round(mins, 2), 'slpm': round(ss / mins, 4) if mins else None,
               'sapm': round(oss / mins, 4) if mins else None, 'winpct': round(100.0 * w / (w + l), 1) if w + l else None}
        n += 1
        off = [k for k in got if not close(got[k], m.get(k), 0.011 if k in ('min', 'winpct') else 0.0002)]
        if off:
            bad += 1
            sample = sample or {'fighter': f['name'], **{k: (got[k], m.get(k)) for k in off}}
    record('ufc', 'fights', 'all years', 'career fights, minutes, strikes landed and absorbed per minute, win % vs UFC Savant career totals', n, bad, sample)
    # rounds: summed over rounds, each fight's significant strikes equal its fights row (where rounds exist)
    for y in [x[:4] for x in years][-3:] + ['2010', '2001']:
        try:
            fd, fx = table('ufc', 'fights', y)
            rd, rx = table('ufc', 'rounds', y)
        except FileNotFoundError:
            continue
        per = Counter()
        has = set()
        for r in rd['rows']:
            per[(r[rx['fight_id']], r[rx['fighter_id']])] += r[rx['ss']] or 0
            has.add((r[rx['fight_id']], r[rx['fighter_id']]))
        c = b = 0
        smp = None
        for r in fd['rows']:
            k = (r[fx['fight_id']], r[fx['fighter_id']])
            if k not in has:
                continue
            c += 1
            if per[k] != (r[fx['ss']] or 0):
                b += 1
                smp = smp or {'fight': k, 'rounds': per[k], 'fight_row': r[fx['ss']]}
        record('ufc', 'rounds', y, 'significant strikes summed over rounds = the fight row', c, b, smp)


# ---------------------------------------------------------------- NBA
def _savant_seasons():
    dd = json.load(open(os.path.join(ROOT, 'public', 'savant-data.json')))
    cur = json.load(open(os.path.join(ROOT, 'public', 'savant-current.json')))
    out = {s: dd['data'][s]['players'] for s in dd['seasons'] if s in dd['data']}
    for s in cur['seasons']:
        out[s] = cur['data'][s]['players']
    return out


def _mv(p, k):
    x = ((p.get('m') or {}).get(k) or {}).get('season') or {}
    return x.get('v'), x.get('n')


def nba():
    sav = _savant_seasons()
    pg_dir = os.path.join(HOSTED, 'nba', 'player_games')
    seasons = sorted(f[:7] for f in os.listdir(pg_dir))
    for s in seasons:
        if s not in sav:
            continue
        d, ix = table('nba', 'player_games', s)
        tot = defaultdict(Counter)
        for r in d['rows']:
            t = tot[r[ix['player_id']]]
            for k in ('min', 'pts', 'fga', 'fg3a', 'fg3m', 'fta', 'ftm', 'fgm'):
                t[k] += r[ix[k]] or 0
            t['gp'] += 1 if (r[ix['min']] or 0) > 0 else 0
        n = bad = 0
        smp = None
        for p in sav[s]:
            t = tot.get(p['id'])
            if t is None:
                continue
            checks = []
            v, nn = _mv(p, 'tp3')
            if nn is not None:
                checks.append(('3PA', t['fg3a'], nn, 0))
            v, nn = _mv(p, 'ft')
            if nn is not None:
                checks.append(('FTA', t['fta'], nn, 0))
            v, nn = _mv(p, 'tp2')
            if nn is not None:
                checks.append(('2PA', t['fga'] - t['fg3a'], nn, 0))
            v, nn = _mv(p, 'ts')
            if v is not None and (t['fga'] + 0.44 * t['fta']) > 0:
                checks.append(('TS', round(t['pts'] / (2 * (t['fga'] + 0.44 * t['fta'])), 3), v, 0.0011))
            if not checks:
                continue
            n += 1
            off = [c for c in checks if not close(c[1], c[2], c[3])]
            if off:
                bad += 1
                smp = smp or {'player': p['name'], **{c[0]: (c[1], c[2]) for c in off}}
        record('nba', 'player_games', s, '3PA, FTA, 2PA and TS% summed over games vs the Basketball Savant season card', n, bad, smp)
    # shots: zone counts vs Basketball Savant's shot-zone bars (savant-ext) and the heat maps' attempt counts (shots/<id>.json)
    sdir = os.path.join(HOSTED, 'nba', 'shots')
    heat = {}
    hdir = os.path.join(ROOT, 'public', 'shots')
    for fn in os.listdir(hdir) if os.path.isdir(hdir) else []:
        if fn.endswith('.json') and fn[:-5].isdigit():
            for season, v in json.load(open(os.path.join(hdir, fn))).items():
                heat[(int(fn[:-5]), season)] = v.get('n')
    ZK = {'Restricted Area': 'ra', 'In The Paint (Non-RA)': 'pnt', 'Mid-Range': 'mid', 'Left Corner 3': 'c3', 'Right Corner 3': 'c3', 'Above the Break 3': 'ab3'}
    for fn in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        s = fn[:7]
        d, ix = table('nba', 'shots', s, HOSTED)
        Z = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in d['rows']:
            z = Z[r[ix['player_id']]]
            z['n'][0] += 1
            if r[ix['y']] is not None and -52 <= r[ix['y']] <= 418:      # the heat map's own window (savant_shots.cell_kde)
                z['heat'][0] += 1
            k = ZK.get(r[ix['zone']])
            if k:
                z[k][0] += 1
                z[k][1] += r[ix['made']]
        # every shot belongs to a team in its game, and that team's games are its player-games
        pg = os.path.join(HOSTED, 'nba', 'player_games', f'{s}.json.gz')
        if os.path.exists(pg):
            P, px = table('nba', 'player_games', s, HOSTED)
            played = {(r[px['game_id']], r[px['player_id']]): (r[px['team']], r[px['opponent']], r[px['home']]) for r in P['rows']}
            n = bad = 0
            smp = None
            for r in d['rows']:
                k = (r[ix['game_id']], r[ix['player_id']])
                if k not in played:
                    continue
                n += 1
                if (r[ix['team']], r[ix['opponent']], r[ix['home']]) != played[k]:
                    bad += 1
                    smp = smp or {'shot': k, 'shots': (r[ix['team']], r[ix['opponent']], r[ix['home']]), 'player_games': played[k]}
            record('nba', 'shots', s, 'each shot\'s team, opponent and home flag vs the shooter\'s player-game', n, bad, smp)
        ep = os.path.join(ROOT, 'public', 'savant-ext', 's', f'{s}.json')
        if os.path.exists(ep):
            E = json.load(open(ep))
            ki = {k: i for i, k in enumerate(E['keys'])}
            n = bad = 0
            smp = None
            for pid, w in E['players'].items():
                vals = (w or {}).get('season') if isinstance(w, dict) else None
                z = Z.get(int(pid))
                if not vals or z is None:
                    continue
                fga = z['n'][0]
                checks = []
                for key, num, den in (('rimfreq', z['ra'][0], fga), ('pntfreq', z['pnt'][0], fga), ('midfreq', z['mid'][0], fga),
                                      ('rimfg', z['ra'][1], z['ra'][0]), ('c3pct', z['c3'][1], z['c3'][0]), ('ab3pct', z['ab3'][1], z['ab3'][0])):
                    cell = vals[ki[key]] if key in ki and ki[key] < len(vals) else None
                    if cell is None or not den:
                        continue
                    checks.append((key + ' sample', den, cell[1], 0))
                    checks.append((key, round(100.0 * num / den, 1), cell[0], 0.051))
                if not checks:
                    continue
                n += 1
                off = [c for c in checks if not close(c[1], c[2], c[3])]
                if off:
                    bad += 1
                    smp = smp or {'player': pid, **{c[0]: (c[1], c[2]) for c in off[:3]}}
            record('nba', 'shots', s, 'attempts and makes by zone (rim, paint, mid-range, corner and above-the-break 3) vs Basketball Savant\'s shot-zone bars', n, bad, smp)
        n = bad = 0
        smp = None
        for (pid, season), hn in heat.items():
            if season != s or hn is None:
                continue
            n += 1
            got = Z[pid]['heat'][0] if pid in Z else 0
            if got != hn:
                bad += 1
                smp = smp or {'player': pid, 'shots': got, 'heat map n': hn}
        if n:
            record('nba', 'shots', s, 'attempts per player inside the heat map\'s half-court window (y -52 to 418) vs the heat-map files (public/shots)', n, bad, smp)


# ---------------------------------------------------------------- NFL
def _fs_seasons():
    out = {}
    for f in ('football-savant-data.json', 'football-savant-current.json'):
        p = os.path.join(ROOT, 'public', f)
        if os.path.exists(p):
            d = json.load(open(p))
            for s in d['seasons']:
                if s in d['data']:
                    out[str(s)] = d['data'][s]
    return out


def nfl():
    fs = _fs_seasons()
    have = sorted(f[:4] for f in os.listdir(os.path.join(HOSTED, 'nfl', 'plays'))) if os.path.isdir(os.path.join(HOSTED, 'nfl', 'plays')) else []
    for s in have:
        if s not in fs:
            continue
        d, ix = table('nfl', 'plays', s)
        g = lambda r, c: r[ix[c]]  # noqa: E731
        db, dbe, car, care, tgt = Counter(), Counter(), Counter(), Counter(), Counter()
        for r in d['rows']:
            if g(r, 'season_type') != 'REG' or (g(r, 'two_point') or 0) == 1:
                continue
            pt = g(r, 'play_type')
            if g(r, 'qb_dropback') == 1 and not g(r, 'kneel') and not g(r, 'spike'):
                pid = g(r, 'passer_id') or g(r, 'rusher_id')
                if pid:
                    db[pid] += 1
                    dbe[pid] += g(r, 'qb_epa') or 0
            if pt == 'run' and not g(r, 'kneel') and g(r, 'rusher_id'):
                car[g(r, 'rusher_id')] += 1
                care[g(r, 'rusher_id')] += g(r, 'epa') or 0
            if pt == 'pass' and not g(r, 'sack') and g(r, 'receiver_id'):
                tgt[g(r, 'receiver_id')] += 1
        n = bad = 0
        smp = None
        for p in fs[s]['players']:
            m, dd, pid = p.get('m') or {}, p.get('d') or {}, p['id']
            checks = []
            if m.get('epadb') is not None and dd.get('db'):
                checks += [('dropbacks', db[pid], dd['db'], 0), ('EPA/dropback', dbe[pid] / db[pid] if db[pid] else None, m['epadb'], 0.0006)]
            if m.get('epacar') is not None and car[pid]:
                checks += [('EPA/carry', care[pid] / car[pid], m['epacar'], 0.0006)]
            if not checks:
                continue
            n += 1
            off = [c for c in checks if not close(c[1], c[2], c[3])]
            if off:
                bad += 1
                smp = smp or {'player': p['name'], **{c[0]: (c[1], c[2]) for c in off}}
        record('nfl', 'plays', s, 'dropbacks, EPA per dropback and EPA per carry summed from plays vs Football Savant player-seasons', n, bad, smp)
        # games: the team table
        try:
            gd, gx = table('nfl', 'games', s, PUB)
        except FileNotFoundError:
            continue
        T = defaultdict(Counter)
        for r in gd['rows']:
            if r[gx['season_type']] != 'REG' or r[gx['plays']] is None:
                continue
            t = T[r[gx['team']]]
            for k, c in (('plays', 'plays'), ('epa', 'epa'), ('db', 'dropbacks'), ('pepa', 'pass_epa'), ('run', 'runs'), ('repa', 'rush_epa'), ('sk', 'sacks')):
                t['o.' + k] += r[gx[c]] or 0
            for k, c in (('plays', 'd_plays'), ('epa', 'd_epa'), ('db', 'd_dropbacks'), ('run', 'd_runs')):
                t['d.' + k] += r[gx[c]] or 0
        n = bad = 0
        smp = None
        for tm, row in fs[s]['tm'].items():
            if tm not in T:
                continue
            n += 1
            off = []
            for side in ('o', 'd'):
                for k in ('plays', 'epa', 'db', 'pepa', 'run', 'repa', 'sk'):
                    if f'{side}.{k}' in T[tm] and row.get(side, {}).get(k) is not None:
                        tol = 0.06 if 'epa' in k else 0
                        if not close(T[tm][f'{side}.{k}'], row[side][k], tol):
                            off.append((f'{side}.{k}', round(T[tm][f'{side}.{k}'], 2), row[side][k]))
            if off:
                bad += 1
                smp = smp or {'team': tm, 'off': off[:3]}
        record('nfl', 'games', s, 'plays, EPA, dropbacks, runs and sacks summed over team-games vs the Football Savant team table, both ways', n, bad, smp)
        # player_games: the weekly lines add up to the season denominators
        try:
            pd_, px = table('nfl', 'player_games', s, HOSTED)
        except FileNotFoundError:
            continue
        S = defaultdict(Counter)
        BOXK = {'att': 'attempts', 'tgt': 'targets', 'rec': 'receptions'}
        for r in pd_['rows']:
            for k, c in BOXK.items():
                if c in px and r[px[c]] is not None:
                    S[r[px['player_id']]][k] += r[px[c]]
        n = bad = 0
        smp = None
        for p in fs[s]['players']:
            dd = p.get('d') or {}
            if p['id'] not in S:
                continue
            checks = [(k, S[p['id']][k], dd[k], 0) for k in ('att', 'tgt', 'rec') if dd.get(k) is not None and k in S[p['id']]]
            if not checks:
                continue
            n += 1
            off = [c for c in checks if not close(c[1], c[2], c[3])]
            if off:
                bad += 1
                smp = smp or {'player': p['name'], **{c[0]: (c[1], c[2]) for c in off}}
        record('nfl', 'player_games', s, 'pass attempts, targets and receptions summed over game lines vs the Football Savant season card', n, bad, smp)


# ---------------------------------------------------------------- CFB
def cfb():
    pdir = os.path.join(HOSTED, 'cfb', 'plays')
    seasons = sorted(f[:4] for f in os.listdir(pdir)) if os.path.isdir(pdir) else []
    for s in seasons:
        sp = os.path.join(ROOT, 'public', 'cfb', 's', f'{s}.json.gz')
        if not os.path.exists(sp):
            continue
        S = json.load(gzip.open(sp, 'rt'))
        ci = {c: i for i, c in enumerate(S['cols'])}
        d, ix = table('cfb', 'plays', s)
        g = lambda r, c: r[ix[c]]  # noqa: E731
        db, dbe, ru, rue, dba = Counter(), Counter(), Counter(), Counter(), Counter()
        for r in d['rows']:
            if not g(r, 'scrimmage'):
                continue
            garb = g(r, 'garbage')
            if g(r, 'pass') and g(r, 'passer_id') is not None:
                dba[g(r, 'passer_id')] += 1
                if not garb:
                    db[g(r, 'passer_id')] += 1
                    dbe[g(r, 'passer_id')] += g(r, 'epa') or 0
            if g(r, 'rush') and g(r, 'rusher_id') is not None and not garb:
                ru[g(r, 'rusher_id')] += 1
                rue[g(r, 'rusher_id')] += g(r, 'epa') or 0
        def arr(x, key, off):
            v, o = x[key], x.get(off, 0) or 0
            return lambda i: v[i - o] if 0 <= i - o < len(v) else None
        sdb, sdba, sru = (arr(S['samples'][k], 'v', 'o') for k in ('db', 'db_all', 'rush'))
        vq, vr = (arr(S['values'][k], 'r', 'or') for k in ('qb_epa_db', 'rb_epa_rush'))
        n = bad = 0
        smp = None
        for i, p in enumerate(S['players']):
            pid, slot = p[ci['id']], p[ci['slot']]
            checks = []
            if slot == 'QB' and sdb(i):
                checks += [('dropbacks', db[pid], sdb(i), 0), ('dropbacks incl. garbage', dba[pid], sdba(i), 0)]
                if vq(i) is not None:
                    checks.append(('EPA/dropback', dbe[pid] / db[pid] if db[pid] else None, vq(i), 0.00051))
            if slot == 'RB' and sru(i):
                checks.append(('rushes', ru[pid], sru(i), 0))
                if vr(i) is not None:
                    checks.append(('EPA/rush', rue[pid] / ru[pid] if ru[pid] else None, vr(i), 0.00051))
            if not checks:
                continue
            n += 1
            off = [c for c in checks if not close(c[1], c[2], c[3])]
            if off:
                bad += 1
                smp = smp or {'player': p[ci['name']], **{c[0]: (c[1], c[2]) for c in off}}
        record('cfb', 'plays', s, 'dropbacks (garbage time out and in), EPA per dropback, rushes and EPA per rush vs the College Football Savant season file', n, bad, smp)
        # games: each team-game's plays and EPA per play vs the page's game file
        try:
            gd, gx = table('cfb', 'games', s, PUB)
        except FileNotFoundError:
            continue
        G = json.load(gzip.open(os.path.join(ROOT, 'public', 'cfb', 'games', f'{s}.json.gz'), 'rt'))
        gi = {c: i for i, c in enumerate(G['cols'])}
        page = {}
        for r in G['rows']:
            if r[gi['h_plays']] is not None:
                page[(r[gi['gid']], r[gi['home']])] = (r[gi['h_plays']], r[gi['h_epa']], r[gi['h_sr']])
                page[(r[gi['gid']], r[gi['away']])] = (r[gi['a_plays']], r[gi['a_epa']], r[gi['a_sr']])
        n = bad = 0
        smp = None
        for r in gd['rows']:
            k = (r[gx['game_id']], r[gx['team_id']])
            if k not in page or r[gx['plays']] is None:
                continue
            n += 1
            pl, ep, sr = page[k]
            got = (r[gx['plays']], r[gx['epa_play']], 100 * r[gx['success_rate']] if r[gx['success_rate']] is not None else None)
            if not (close(got[0], pl, 0) and close(got[1], ep, 0.00051) and close(got[2], sr, 0.051)):
                bad += 1
                smp = smp or {'game': k, 'data_room': got, 'page': (pl, ep, sr)}
        record('cfb', 'games', s, 'plays, EPA per play and success rate per team-game vs the College Football Savant game file', n, bad, smp)


SPORT_FN = {'ufc': ufc, 'nba': nba, 'nfl': nfl, 'cfb': cfb}


def main():
    for s in SPORTS:
        if s in SPORT_FN:
            SPORT_FN[s]()
    out = os.path.join(ROOT, 'tools', 'dataroom', 'reconcile.json')
    prev = json.load(open(out)) if os.path.exists(out) else []
    keep = [r for r in prev if r['sport'] not in SPORTS]
    with open(out, 'w') as f:
        json.dump(keep + RESULTS, f, indent=1)
    bad = [r for r in RESULTS if not r['ok']]
    print(f"{len(RESULTS) - len(bad)} of {len(RESULTS)} checks pass")
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
