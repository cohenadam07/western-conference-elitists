"""
games.py — every team's regular-season game dates, 1979-80 on, from the NBA's LeagueGameLog
(team mode) through the engine's cache. Used to turn Basketball-Reference's "games in charge"
into a calendar handover window. Mac lane (stats.nba.com); one call per season, cached.

    cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/gm/games.py
    -> out/games.json   {"<season>": {"<NBA abbr>": ["YYYY-MM-DD", ...]}}
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import savant_engine as E  # noqa: E402
RESULTS = {}


def season_label(y):
    return f'{y}-{str(y + 1)[2:]}'


def pull(first=1979, last=2026):
    from nba_api.stats.endpoints import leaguegamelog as L
    out = {}
    for y in range(first, last + 1):
        s = season_label(y)
        df = E.call(L.LeagueGameLog, dict(season=s, season_type_all_star='Regular Season', player_or_team_abbreviation='T'))
        d, res = {}, {}
        for ab, date, wl, pm in zip(df['TEAM_ABBREVIATION'], df['GAME_DATE'], df['WL'], df['PLUS_MINUS']):
            d.setdefault(ab, []).append(str(date)[:10])
            res.setdefault(ab, []).append((str(date)[:10], wl, float(pm) if pm == pm else 0.0))
        out[s] = {k: sorted(v) for k, v in d.items()}
        RESULTS[s] = {k: sorted(v) for k, v in res.items()}
        print(s, len(d), 'teams', sum(len(v) for v in d.values()), 'team-games', flush=True)
    return out


if __name__ == '__main__':
    g = pull()
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    json.dump(g, open(os.path.join(HERE, 'out', 'games.json'), 'w'))
    json.dump(RESULTS, open(os.path.join(HERE, 'out', 'results.json'), 'w'))   # (date, W/L) per team-game
