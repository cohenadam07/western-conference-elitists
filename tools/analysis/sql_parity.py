"""tools/analysis/sql_parity.py — savant_sql's answers against the Savant pages' own numbers
(research/analysis/BUILD.md §5 "Parity with the pages").

    python3 tools/analysis/sql_parity.py            # local Parquet copies (out/parquet)
    ANALYSIS_REMOTE=1 python3 tools/analysis/sql_parity.py   # the live release

Each check is one SQL query, written the way an assistant would write it, run through the real engine
(tools/analysis/run.mjs: api/_sql.js, every lock on), and compared with the numbers the page itself
publishes: Basketball Savant's season card, shot-zone bars and heat maps; Football Savant's player-seasons,
team table and season card; College Football Savant's season and game files; UFC Savant's career totals;
College Basketball Savant's season file; and two leaderboards. The page side is read with
tools/dataroom/reconcile.py's own loaders. Prints one line per query and writes
tools/analysis/sql_parity.json; exits 1 if any query misses.
"""
import gzip, json, os, subprocess, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'dataroom'))
import reconcile as R  # noqa: E402  the Data Room reconciliation's page loaders


def run(queries):
    import tempfile
    out = tempfile.mktemp(suffix='.json')
    p = subprocess.run(['node', os.path.join(ROOT, 'tools', 'analysis', 'run.mjs')], input=json.dumps({'sql': queries}).encode(), capture_output=True, cwd=ROOT, timeout=1800, env={**os.environ, 'OUT': out})
    if p.returncode:
        raise SystemExit(p.stderr.decode()[-2000:])
    with open(out) as f:
        res = json.load(f)
    os.remove(out)
    return res['sql']


def close(a, b, tol):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return R.close(a, b, tol)
    return str(a) == str(b) if a is not None and b is not None else a is None and b is None


CHECKS = []   # (name, sql, compare(rows) -> (n, bad, sample))
# Where the page's two files disagree with each other, not with the SQL: reported every run, not a failure.
KNOWN = {'cbb player_games 2018-19': 'College Basketball Savant\'s 2018-19 season file and its own team game logs differ by one or two minutes for 19 of 4,743 players (whole-minute game lines summed vs the season total); games played match for all of them.'}


def check(name, sql):
    def deco(fn):
        CHECKS.append((name, sql, fn))
        return fn
    return deco


def tally(pairs):
    n = bad = 0
    smp = None
    for who, checks in pairs:
        if not checks:
            continue
        n += 1
        off = [c for c in checks if not close(c[1], c[2], c[3])]
        if off:
            bad += 1
            smp = smp or {'who': who, **{c[0]: (c[1], c[2]) for c in off[:3]}}
    return n, bad, smp


# ---------------------------------------------------------------- NBA
SAV = None


def sav():
    global SAV
    if SAV is None:
        SAV = R._savant_seasons()
    return SAV


for S in ('2024-25', '2016-17', '2005-06', '1998-99'):
    @check(f'nba player_games {S}: 3PA, FTA, 2PA, TS% per player vs the Basketball Savant card',
           f"SELECT player_id, sum(fg3a) AS fg3a, sum(fta) AS fta, sum(fga) - sum(fg3a) AS fg2a, sum(pts) / (2 * (sum(fga) + 0.44 * sum(fta))) AS ts FROM nba.player_games WHERE season = '{S}' GROUP BY player_id")
    def _(rows, S=S):
        got = {r[0]: r for r in rows}
        out = []
        for p in sav().get(S, []):
            t = got.get(p['id'])
            if not t:
                continue
            c = []
            v, n = R._mv(p, 'tp3')
            if n is not None: c.append(('3PA', t[1], n, 0))
            v, n = R._mv(p, 'ft')
            if n is not None: c.append(('FTA', t[2], n, 0))
            v, n = R._mv(p, 'tp2')
            if n is not None: c.append(('2PA', t[3], n, 0))
            v, n = R._mv(p, 'ts')
            if v is not None and t[4] is not None: c.append(('TS', round(t[4], 3), v, 0.0011))
            out.append((p['name'], c))
        return tally(out)

ZK = {'ra': "zone = 'Restricted Area'", 'pnt': "zone = 'In The Paint (Non-RA)'", 'mid': "zone = 'Mid-Range'", 'c3': "zone LIKE '%Corner 3'", 'ab3': "zone = 'Above the Break 3'"}
for S in ('2024-25', '2019-20', '2013-14'):
    sel = ', '.join(f"count(*) FILTER (WHERE {w}) AS {k}_a, sum(made) FILTER (WHERE {w}) AS {k}_m" for k, w in ZK.items())
    @check(f'nba shots {S}: attempts and makes by zone vs the shot-zone bars', f"SELECT player_id, count(*) AS fga, {sel} FROM nba.shots WHERE season = '{S}' GROUP BY player_id")
    def _(rows, S=S):
        ep = os.path.join(ROOT, 'public', 'savant-ext', 's', f'{S}.json')
        E = json.load(open(ep))
        ki = {k: i for i, k in enumerate(E['keys'])}
        got = {str(r[0]): r for r in rows}
        out = []
        for pid, w in E['players'].items():
            vals = (w or {}).get('season') if isinstance(w, dict) else None
            r = got.get(pid)
            if not vals or r is None:
                continue
            fga = r[1]
            z = {k: (r[2 + 2 * i] or 0, r[3 + 2 * i] or 0) for i, k in enumerate(ZK)}
            c = []
            for key, num, den in (('rimfreq', z['ra'][0], fga), ('pntfreq', z['pnt'][0], fga), ('midfreq', z['mid'][0], fga), ('rimfg', z['ra'][1], z['ra'][0]), ('c3pct', z['c3'][1], z['c3'][0]), ('ab3pct', z['ab3'][1], z['ab3'][0])):
                cell = vals[ki[key]] if key in ki and ki[key] < len(vals) else None
                if cell is None or not den:
                    continue
                c += [(key + ' n', den, cell[1], 0), (key, round(100.0 * num / den, 1), cell[0], 0.051)]
            out.append((pid, c))
        return tally(out)


@check('nba shots 2024-25: attempts inside the heat map window per player vs public/shots', "SELECT player_id, count(*) FILTER (WHERE y BETWEEN -52 AND 418) AS n FROM nba.shots WHERE season = '2024-25' GROUP BY player_id")
def _(rows):
    got = {r[0]: r[1] for r in rows}
    out = []
    hdir = os.path.join(ROOT, 'public', 'shots')
    for fn in os.listdir(hdir):
        if fn.endswith('.json') and fn[:-5].isdigit():
            v = json.load(open(os.path.join(hdir, fn))).get('2024-25')
            if v and v.get('n') is not None:
                out.append((fn, [('n', got.get(int(fn[:-5]), 0), v['n'], 0)]))
    return tally(out)


@check('nba leaderboard 2024-25: the ten most three-point attempts vs the card', "SELECT player_id, sum(fg3a) AS fg3a FROM nba.player_games WHERE season = '2024-25' GROUP BY player_id ORDER BY fg3a DESC, player_id LIMIT 10")
def _(rows):
    card = sorted(((R._mv(p, 'tp3')[1] or 0, p['id']) for p in sav()['2024-25']), reverse=True)[:10]
    return tally([(i, [('rank %d 3PA' % (i + 1), rows[i][1], card[i][0], 0)]) for i in range(10)])


# ---------------------------------------------------------------- NFL
FS = None


def fs():
    global FS
    if FS is None:
        FS = R._fs_seasons()
    return FS


for S in ('2025', '2018', '2010', '2001'):
    @check(f'nfl plays {S}: dropbacks, EPA per dropback, EPA per carry per player vs Football Savant',
           f"""SELECT pid, sum(db) AS db, sum(dbe) AS dbe, sum(car) AS car, sum(care) AS care FROM (
                 SELECT coalesce(passer_id, rusher_id) AS pid, 1 AS db, coalesce(qb_epa, 0) AS dbe, 0 AS car, 0.0 AS care FROM nfl.plays
                   WHERE season = '{S}' AND season_type = 'REG' AND coalesce(two_point, 0) = 0 AND qb_dropback = 1 AND coalesce(kneel, 0) = 0 AND coalesce(spike, 0) = 0 AND coalesce(passer_id, rusher_id) IS NOT NULL
                 UNION ALL
                 SELECT rusher_id, 0, 0.0, 1, coalesce(epa, 0) FROM nfl.plays
                   WHERE season = '{S}' AND season_type = 'REG' AND coalesce(two_point, 0) = 0 AND play_type = 'run' AND coalesce(kneel, 0) = 0 AND rusher_id IS NOT NULL
               ) GROUP BY pid""")
    def _(rows, S=S):
        got = {r[0]: r for r in rows}
        out = []
        for p in fs()[S]['players']:
            m, dd, t = p.get('m') or {}, p.get('d') or {}, got.get(p['id'])
            if not t:
                continue
            c = []
            if m.get('epadb') is not None and dd.get('db'):
                c += [('dropbacks', t[1], dd['db'], 0), ('EPA/db', t[2] / t[1] if t[1] else None, m['epadb'], 0.0006)]
            if m.get('epacar') is not None and t[3]:
                c.append(('EPA/carry', t[4] / t[3], m['epacar'], 0.0006))
            out.append((p['name'], c))
        return tally(out)

for S in ('2024', '2012'):
    @check(f'nfl games {S}: team plays, EPA, dropbacks, runs, sacks both ways vs the team table',
           f"SELECT team, sum(plays), sum(epa), sum(dropbacks), sum(pass_epa), sum(runs), sum(rush_epa), sum(sacks), sum(d_plays), sum(d_epa), sum(d_dropbacks), sum(d_runs) FROM nfl.games WHERE season = '{S}' AND season_type = 'REG' AND plays IS NOT NULL GROUP BY team")
    def _(rows, S=S):
        got = {r[0]: r for r in rows}
        out = []
        for tm, row in fs()[S]['tm'].items():
            t = got.get(tm)
            if not t:
                continue
            o, d = row.get('o', {}), row.get('d', {})
            c = []
            for i, k in enumerate(('plays', 'epa', 'db', 'pepa', 'run', 'repa', 'sk')):
                if o.get(k) is not None: c.append(('o.' + k, t[1 + i], o[k], 0.06 if 'epa' in k else 0))
            for i, k in enumerate(('plays', 'epa', 'db', 'run')):
                if d.get(k) is not None: c.append(('d.' + k, t[8 + i], d[k], 0.06 if 'epa' in k else 0))
            out.append((tm, c))
        return tally(out)

for S in ('2025', '2016'):
    @check(f'nfl player_games {S}: pass attempts, targets, receptions per player vs the season card',
           f"SELECT player_id, sum(attempts), sum(targets), sum(receptions) FROM nfl.player_games WHERE season = '{S}' GROUP BY player_id")
    def _(rows, S=S):
        got = {r[0]: r for r in rows}
        out = []
        for p in fs()[S]['players']:
            dd, t = p.get('d') or {}, got.get(p['id'])
            if not t:
                continue
            out.append((p['name'], [(k, t[1 + i], dd[k], 0) for i, k in enumerate(('att', 'tgt', 'rec')) if dd.get(k) is not None and t[1 + i] is not None]))
        return tally(out)


@check('nfl leaderboard 2024: the ten best EPA per dropback (200+ dropbacks) vs Football Savant',
       """SELECT coalesce(passer_id, rusher_id) AS pid, avg(coalesce(qb_epa, 0)) AS epadb FROM nfl.plays
          WHERE season = '2024' AND season_type = 'REG' AND coalesce(two_point, 0) = 0 AND qb_dropback = 1 AND coalesce(kneel, 0) = 0 AND coalesce(spike, 0) = 0
          GROUP BY 1 HAVING count(*) >= 200 ORDER BY epadb DESC LIMIT 10""")
def _(rows):
    page = sorted(((p['m']['epadb'], p['id']) for p in fs()['2024']['players'] if (p.get('m') or {}).get('epadb') is not None and ((p.get('d') or {}).get('db') or 0) >= 200), reverse=True)[:10]
    return tally([(i, [('rank %d player' % (i + 1), rows[i][0], page[i][1], 0), ('EPA/db', rows[i][1], page[i][0], 0.0006)]) for i in range(10)])


# ---------------------------------------------------------------- CFB
for S in ('2025', '2019', '2015'):
    @check(f'cfb plays {S}: dropbacks (with and without garbage time), EPA per dropback, rushes, EPA per rush vs the season file',
           f"""SELECT pid, sum(db), sum(dba), sum(dbe), sum(ru), sum(rue) FROM (
                 SELECT passer_id AS pid, CASE WHEN NOT coalesce(garbage, false) THEN 1 ELSE 0 END AS db, 1 AS dba, CASE WHEN NOT coalesce(garbage, false) THEN coalesce(epa, 0) ELSE 0 END AS dbe, 0 AS ru, 0.0 AS rue
                   FROM cfb.plays WHERE season = '{S}' AND scrimmage AND pass AND passer_id IS NOT NULL
                 UNION ALL
                 SELECT rusher_id, 0, 0, 0.0, 1, coalesce(epa, 0) FROM cfb.plays WHERE season = '{S}' AND scrimmage AND rush AND rusher_id IS NOT NULL AND NOT coalesce(garbage, false)
               ) GROUP BY pid""")
    def _(rows, S=S):
        Sf = json.load(gzip.open(os.path.join(ROOT, 'public', 'cfb', 's', f'{S}.json.gz'), 'rt'))
        ci = {c: i for i, c in enumerate(Sf['cols'])}

        def arr(x, key, off):
            v, o = x[key], x.get(off, 0) or 0
            return lambda i: v[i - o] if 0 <= i - o < len(v) else None
        sdb, sdba, sru = (arr(Sf['samples'][k], 'v', 'o') for k in ('db', 'db_all', 'rush'))
        vq, vr = (arr(Sf['values'][k], 'r', 'or') for k in ('qb_epa_db', 'rb_epa_rush'))
        got = {r[0]: r for r in rows}
        out = []
        for i, p in enumerate(Sf['players']):
            pid, slot = p[ci['id']], p[ci['slot']]
            t = got.get(pid) or [pid, 0, 0, 0, 0, 0]
            c = []
            if slot == 'QB' and sdb(i):
                c += [('dropbacks', t[1], sdb(i), 0), ('dropbacks incl. garbage', t[2], sdba(i), 0)]
                if vq(i) is not None: c.append(('EPA/db', t[3] / t[1] if t[1] else None, vq(i), 0.00051))
            if slot == 'RB' and sru(i):
                c.append(('rushes', t[4], sru(i), 0))
                if vr(i) is not None: c.append(('EPA/rush', t[5] / t[4] if t[4] else None, vr(i), 0.00051))
            out.append((p[ci['name']], c))
        return tally(out)

for S in ('2025', '2017'):
    @check(f'cfb games {S}: plays, EPA per play, success rate per team-game vs the game file', f"SELECT game_id, team_id, plays, epa_play, 100 * success_rate FROM cfb.games WHERE season = '{S}' AND plays IS NOT NULL")
    def _(rows, S=S):
        G = json.load(gzip.open(os.path.join(ROOT, 'public', 'cfb', 'games', f'{S}.json.gz'), 'rt'))
        gi = {c: i for i, c in enumerate(G['cols'])}
        page = {}
        for r in G['rows']:
            if r[gi['h_plays']] is not None:
                page[(r[gi['gid']], r[gi['home']])] = (r[gi['h_plays']], r[gi['h_epa']], r[gi['h_sr']])
                page[(r[gi['gid']], r[gi['away']])] = (r[gi['a_plays']], r[gi['a_epa']], r[gi['a_sr']])
        out = []
        for r in rows:
            k = (r[0], r[1])
            if k in page:
                pl, ep, sr = page[k]
                out.append((k, [('plays', r[2], pl, 0), ('EPA/play', r[3], ep, 0.00051), ('SR', r[4], sr, 0.051)]))
        return tally(out)


# ---------------------------------------------------------------- UFC
@check('ufc fights, every year: career fights, minutes, strikes landed and absorbed per minute, win % vs UFC Savant',
       """SELECT fighter_id, count(*), sum(coalesce(fight_seconds, 0)) / 60.0 AS mins,
                 sum(CASE WHEN stats THEN coalesce(ss, 0) ELSE 0 END), sum(CASE WHEN stats THEN coalesce(opp_ss, 0) ELSE 0 END),
                 count(*) FILTER (WHERE result = 'W'), count(*) FILTER (WHERE result = 'L')
          FROM ufc.fights GROUP BY fighter_id""")
def _(rows):
    data = json.load(open(os.path.join(ROOT, 'public', 'ufc-savant-data.json')))
    got = {r[0]: r for r in rows}
    out = []
    for fid, f in data['fighters'].items():
        m = ((f.get('w') or {}).get('career') or {}).get('m')
        t = got.get(fid)
        if not m or not t:
            continue
        mins = t[2]
        g = {'n': t[1], 'min': round(mins, 2), 'slpm': round(t[3] / mins, 4) if mins else None, 'sapm': round(t[4] / mins, 4) if mins else None, 'winpct': round(100.0 * t[5] / (t[5] + t[6]), 1) if t[5] + t[6] else None}
        out.append((f['name'], [(k, g[k], m.get(k), 0.011 if k in ('min', 'winpct') else 0.0002) for k in g if m.get(k) is not None or g[k] is None]))
    return tally(out)


@check('ufc rounds 2024: significant strikes summed over rounds = each fight row',
       """SELECT f.fight_id, f.fighter_id, f.ss, sum(r.ss) FROM ufc.fights f JOIN ufc.rounds r USING (fight_id, fighter_id)
          WHERE f.season = '2024' AND r.season = '2024' GROUP BY 1, 2, 3""")
def _(rows):
    return tally([((r[0], r[1]), [('ss', r[3] or 0, r[2] or 0, 0)]) for r in rows])


# ---------------------------------------------------------------- CBB
for S in ('2024-25', '2018-19'):
    @check(f'cbb player_games {S}: D1 games and minutes per player vs the College Basketball Savant season file',
           f"SELECT player_id, count(*) AS gp, sum(min) AS mins FROM cbb.player_games WHERE season = '{S}' AND NOT coalesce(non_d1::BOOLEAN, false) GROUP BY player_id")
    def _(rows, S=S):
        D = json.load(gzip.open(os.path.join(ROOT, 'public', 'cbb', 's', f'{S}.json.gz'), 'rt'))
        ci = {c: i for i, c in enumerate(D['cols'])}
        got = {str(r[0]): r for r in rows}
        out = []
        for p in D['players']:
            t = got.get(str(p[ci['id']]))
            if not t or p[ci['gp']] is None:
                continue
            out.append((p[ci['name']], [('gp', t[1], p[ci['gp']], 0), ('min', t[2], p[ci['min']], 0.51)]))
        return tally(out)


def main():
    res = run([c[1] for c in CHECKS])
    report, fails = [], 0
    for (name, sql, fn), r in zip(CHECKS, res):
        if 'error' in r:
            n, bad, smp = 0, 1, {'error': r['error'][:300]}
        else:
            n, bad, smp = fn(r['rows'])
        ok = n > 0 and bad == 0
        known = next((v for k, v in KNOWN.items() if name.startswith(k)), None) if not ok and n > 0 else None
        fails += 0 if ok or known else 1
        report.append({'check': name, 'sql': ' '.join(sql.split()), 'compared': n, 'mismatches': bad, 'ok': ok, 'ms': r.get('ms'), **({'sample': smp} if smp else {}), **({'known': known} if known else {})})
        print(f"{'ok  ' if ok else 'KNOWN' if known else 'FAIL'} {name}: {n} compared, {bad} off{'' if ok else f'  {json.dumps(smp, default=str)[:300]}'}")
    json.dump(report, open(os.path.join(ROOT, 'tools', 'analysis', 'sql_parity.json'), 'w'), indent=1, default=str)
    good = sum(1 for x in report if x['ok'])
    print(f'\n{good} of {len(CHECKS)} queries match their pages exactly; {len(CHECKS) - good - fails} known page-side differences; {fails} failures')
    if good < 25:
        fails += 1
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
