"""tools/analysis/stability_parity.py — savant_analyze stability against Basketball Savant's published settle
points (SETTLE_K in public/basketball-savant.html, from pipeline/basketball/settle_points.py).

    python3 tools/analysis/stability_parity.py

Each stat is one stability study over nba.player_games, written the way settle_points.py measures it:
the page's qualified player-seasons and positions (nba.player_seasons, the analysis-only copy of the page's
own player-seasons), 2010-11 on, the window the team's last 25 games against the rest of the season, the
prior the qualified mean at his position, the same estimator and k grid. What still differs: the page's
season and window numbers come from the NBA's season and last-25 splits, the study's from summing the game
lines, so a k can land one grid step either side. A stat passes when its k is within 20% of the published
one (the published k's own season-to-season spread, settle_points.json by_season, is far wider).
Writes tools/analysis/stability_parity.json; exits 1 if fewer than 10 stats pass.
"""
import json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
Q = ("SELECT g.season, g.player_id, g.team, g.date, {num} AS num, {den} AS den, s.pos FROM nba.player_games g "
     "JOIN nba.player_seasons s USING (season, player_id) WHERE s.qualified AND g.season BETWEEN '2010-11' AND '2025-26'")
STATS = {
    'tp3': ('fg3m', 'fg3a'), 'tp2': ('fgm - fg3m', 'fga - fg3a'), 'ft': ('ftm', 'fta'), 'efg': ('fgm + 0.5 * fg3m', 'fga'),
    'ts': ('pts / 2.0', 'fga + 0.44 * fta'), 'tp3r': ('fg3a', 'fga'), 'ftr': ('fta', 'fga'),
    'pts': ('pts', 'poss'), 'ast75': ('ast', 'poss'), 'tov75': ('tov', 'poss'), 'reb75': ('reb', 'poss'),
    'stl': ('stl', 'poss'), 'blk': ('blk', 'poss'), 'stk75': ('stl + blk', 'poss'),
}
TOL = 0.20


def published():
    html = open(os.path.join(ROOT, 'public', 'basketball-savant.html'), encoding='utf8').read()
    m = re.search(r'const SETTLE_K=(\{[^;]*\});', html)
    return {k: [int(a), int(b)] for k, a, b in re.findall(r'(\w+):\[(\d+),(\d+)\]', m.group(1))}


def main():
    pub = published()
    studies = [dict(study='stability', sql=Q.format(num=n, den=d), player='player_id', season='season', date='date', numerator='num', denominator='den', window='team_last_25', team='team', pool='pos', stat=k) for k, (n, d) in STATS.items()]
    out = tempfile.mktemp(suffix='.json')
    p = subprocess.run(['node', os.path.join(ROOT, 'tools', 'analysis', 'run.mjs')], input=json.dumps({'studies': studies}).encode(), capture_output=True, cwd=ROOT, env={**os.environ, 'OUT': out}, timeout=3600)
    if p.returncode:
        raise SystemExit(p.stderr.decode()[-2000:])
    res = json.load(open(out))['studies']
    os.remove(out)
    rows, good = [], 0
    for (k, _), r in zip(STATS.items(), res):
        if 'error' in r:
            print(f'FAIL {k}: {r["error"]}')
            rows.append({'stat': k, 'ok': False, 'error': r['error']})
            continue
        kk = r['settle']['k'] if r.get('settle') else None
        pk = pub[k][0]
        ok = kk is not None and abs(kk - pk) / pk <= TOL
        good += ok
        rows.append({'stat': k, 'k': kk, 'published': pk, 'ratio': round(kk / pk, 3) if kk else None, 'pairs': r['settle']['pairs'] if r.get('settle') else 0, 'full_season_reliability': round(r['split_half']['full_season_reliability'], 3), 'verdict': r['verdict'], 'ok': ok})
        print(f"{'ok  ' if ok else 'FAIL'} {k:6} k {kk:>7} vs published {pk:>5} ({kk / pk:.2f}x); reliability {r['split_half']['full_season_reliability']:.2f}, {r['verdict']}")
    json.dump(rows, open(os.path.join(ROOT, 'tools', 'analysis', 'stability_parity.json'), 'w'), indent=1)
    print(f'\n{good} of {len(STATS)} stats within {int(TOL * 100)}% of the published settle point')
    sys.exit(0 if good >= 10 else 1)


if __name__ == '__main__':
    main()
