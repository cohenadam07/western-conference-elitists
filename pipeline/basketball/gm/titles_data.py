"""
titles_data.py — what the title model is built from, one completed season at a time (1979-80 on).

  standings   Basketball-Reference's league page (the division standings table): each team's conference, division,
              wins and losses.  https://www.basketball-reference.com/leagues/NBA_<y>.html
  playoffs    Basketball-Reference's playoffs page (the "Playoff Series" table): every series, its round and
              conference, winner and loser, and each game with the home team and the score.
              https://www.basketball-reference.com/playoffs/NBA_<y>.html  -- 1979-80 to 2001-02
              The NBA's game log (LeagueGameLog, season type Playoffs), 2002-03 on: the series are the games between
              each pair of teams, the round is each series' place in a team's run, the Finals the series across
              conferences. 1996-97 to 2001-02 are read from both, as a check that the two agree game by game.
              (Basketball-Reference answered 2002-03 with a 429 on Nov 23 2026; a refusal is never retried, so its
              pages are read from the cache only.)
  play-in     the NBA's game log (LeagueGameLog, season type PlayIn), 2019-20 on, through the engine's cache (Mac lane)
  schedule    the NBA's game log (LeagueGameLog, regular season, team rows), through the engine's cache: every game's
              home team, visitor, home margin and whether it was at a neutral site (MATCHUP "X vs. Y" is X at home;
              both rows "@" is a neutral site), plus the NBA Cup's knockout games from 2023-24 (the Cup log), which count
              in the standings. Every team's games on the schedule must equal its wins plus losses.

    cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/gm/titles_data.py
    -> out/playoff_data.json  {season: {teams, schedule, series, play_in, champion, sources}}

Parsed facts only (the repo is public: no fetched page is ever written outside the cache).
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, os.path.join(HERE, '..'))
from fetch import get  # noqa: E402
from tenures import franchise  # noqa: E402

FIRST = 1980
def _last_completed():
    import datetime as dt
    t = dt.date.today()
    return t.year + (1 if t.month >= 7 else 0) - 1     # from July 1 the season just ended counts (the Finals end in June)


LAST = int(os.environ.get('TITLES_LAST') or _last_completed())


def fr(ab, y):
    return 'CHO' if ab in ('CHA', 'CHO') and y >= 2005 else franchise(ab)


def text(x):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', x or '')).replace('&nbsp;', ' ').strip()


def standings(y):
    url = f'https://www.basketball-reference.com/leagues/NBA_{y}.html'
    c, h = get(url, delay=4.0, offline=True)
    h = h.decode('utf8', 'ignore')
    teams, names = {}, {}
    for conf in ('E', 'W'):
        m = re.search(r'<table[^>]*id="divs_standings_%s".*?</table>' % conf, h, re.S)
        div = None
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(0), re.S):
            t = text(tr)
            if 'Division' in t and '/teams/' not in tr:
                div = t.replace(' Division', '').strip()
                continue
            ab = re.search(r'/teams/([A-Z]{3})/', tr)
            if not ab:
                continue
            cells = dict(re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', tr, re.S))
            nm = text(re.search(r'<a[^>]*>(.*?)</a>', tr).group(1))
            f = fr(ab.group(1), y)
            teams[f] = {'conf': conf, 'div': div, 'w': int(text(cells['wins'])), 'l': int(text(cells['losses'])),
                        'br': ab.group(1), 'playoffs': '*' in text(cells.get('team_name', ''))}
            names[nm] = f
    return teams, names, url


BR_LAST = 2002          # Basketball-Reference's playoff pages are the source through 2001-02, the NBA's game log after


def playoffs(y, names):
    url = f'https://www.basketball-reference.com/playoffs/NBA_{y}.html'
    c, h = get(url, delay=4.0, offline=True)
    if c != 200:
        return None, url
    h = h.decode('utf8', 'ignore')
    t = h[h.find('id="all_playoffs"'):]
    t = t[:t.find('</tbody>')]
    out = []
    # a series row (round, "Winner over Loser (4-2)") followed by its toggleable games table
    for m in re.finditer(r"<strong>(.*?)</strong></span></td>\s*<td>(.*?)</td>.*?<tr class=\"toggleable\"[^>]*>(.*?)</table>", t, re.S):
        rnd, who, games = text(m.group(1)), m.group(2), m.group(3)
        tm = re.findall(r"/teams/([A-Z]{3})/", who)
        score = re.search(r'\((\d+)-(\d+)\)', text(who))
        gl = []
        for g in re.findall(r'<tr>(.*?)</tr>', games, re.S):
            cells = [text(x) for x in re.findall(r'<td>(.*?)</td>', g, re.S)]
            box = re.search(r'/boxscores/(\d{8})', g)
            if len(cells) < 6 or not cells[3].isdigit() or not cells[5].isdigit():
                continue
            vis, home = names[cells[2]], names[cells[4].lstrip('@ ').strip()]
            gl.append([box.group(1)[:4] + '-' + box.group(1)[4:6] + '-' + box.group(1)[6:8] if box else None,
                       home, vis, int(cells[5]) - int(cells[3])])
        conf = 'E' if rnd.startswith('Eastern') else 'W' if rnd.startswith('Western') else None
        level = 'final' if rnd == 'Finals' else 'conf_final' if 'Conference Finals' in rnd else \
            'semi' if 'Semifinals' in rnd else 'first' if 'First Round' in rnd else rnd
        out.append({'round': level, 'conf': conf, 'winner': fr(tm[0], y), 'loser': fr(tm[1], y),
                    'wins': [int(score.group(1)), int(score.group(2))], 'games': gl})
    return out, url


def nba_log(y, kind, keep=None, ids=False):
    """The engine's cached LeagueGameLog (team rows) for season y (ending year), as [[date, home, visitor, home margin]]."""
    import savant_engine as E
    from nba_api.stats.endpoints import leaguegamelog as L
    s = f'{y - 1}-{str(y)[2:]}'
    try:
        df = E.call(L.LeagueGameLog, dict(season=s, season_type_all_star=kind, player_or_team_abbreviation='T'))
    except Exception as e:  # noqa: BLE001
        print('no', kind, s, e)
        return []
    by = {}
    for gid, ab, date, mu, pts in zip(df['GAME_ID'], df['TEAM_ABBREVIATION'], df['GAME_DATE'], df['MATCHUP'], df['PTS']):
        by.setdefault(gid, {'rows': [], 'date': str(date)[:10]})['rows'].append(('vs.' in mu, ab, pts))
    out = []
    for gid, g in sorted(by.items()):
        if len(g['rows']) != 2 or not (keep is None or keep(str(gid))):
            continue
        (h1, ab1, p1), (h2, ab2, p2) = sorted(g['rows'], key=lambda x: (not x[0], x[1]))
        neutral = int(h1 == h2)            # both "@": a neutral site (Paris, Mexico City, the Cup's Las Vegas games)
        out.append([g['date'], nba_fr(ab1, y), nba_fr(ab2, y), int(p1) - int(p2), neutral] + ([str(gid).lstrip('0')] if ids else []))
    return out


def series_from_games(games, teams):
    """Series from a season's playoff games: the games between each pair of teams; the round is the series' place in
    each team's run (both teams agree, or it is an error); the Finals is the series across conferences."""
    by = {}
    for g in sorted(games):
        by.setdefault(frozenset(g[1:3]), []).append(g)
    runs = {}
    for pair, gl in sorted(by.items(), key=lambda kv: kv[1][0][0]):
        for t in pair:
            runs.setdefault(t, []).append(pair)
    names = {1: 'first', 2: 'semi', 3: 'conf_final', 4: 'final'}
    out = []
    for pair, gl in by.items():
        a, b = sorted(pair)
        ra, rb = runs[a].index(pair) + 1, runs[b].index(pair) + 1
        assert ra == rb, (a, b, ra, rb)
        wins = {a: sum(1 for g in gl if (g[3] > 0) == (g[1] == a)), b: 0}
        wins[b] = len(gl) - wins[a]
        win, lose = (a, b) if wins[a] > wins[b] else (b, a)
        cross = teams[a]['conf'] != teams[b]['conf']
        assert cross == (ra == 4), (a, b, ra)
        out.append({'round': names[ra], 'conf': None if cross else teams[a]['conf'], 'winner': win, 'loser': lose,
                    'wins': [wins[win], wins[lose]], 'games': [[g[0], g[1], g[2], g[3]] for g in gl]})
    return sorted(out, key=lambda s: ('final', 'conf_final', 'semi', 'first').index(s['round']))


def nba_fr(ab, y):
    return 'CHO' if ab == 'CHA' and y >= 2005 else franchise(ab)


def main():
    out = {}
    path = os.path.join(OUT, 'playoff_data.json')
    for y in range(FIRST, LAST + 1):
        season = f'{y - 1}-{str(y)[2:]}'
        teams, names, su = standings(y)
        series, pu = playoffs(y, names) if y <= BR_LAST else (None, None)
        log = nba_log(y, 'Playoffs') if y >= 1997 else []
        check = None
        if series is None:
            series, pu = series_from_games(log, teams), 'stats.nba.com LeagueGameLog (Playoffs)'
        elif log:                                       # both sources: they must agree game by game
            a = sorted((g[1], g[2], g[3]) for s_ in series for g in s_['games'])
            b = sorted((g[1], g[2], g[3]) for g in log)          # (no neutral-site playoff games before 2019-20)
            check = {'games_br': len(a), 'games_nba': len(b), 'agree': a == b}
            assert a == b, (season, len(a), len(b), [x for x in a if x not in b][:3], [x for x in b if x not in a][:3])
        sched = nba_log(y, 'Regular Season', ids=True)
        if y >= 2024:          # the NBA Cup's knockout games count in the standings but sit in the Cup's own log
            have = {g[5] for g in sched}
            sched += [g for g in nba_log(y, 'IST', keep=lambda gid: gid.lstrip('0').startswith('2'), ids=True) if g[5] not in have]
        sched = sorted(g[:5] for g in sched if g[3] != 0)    # 0-0: a game the log lists but nobody played (BOS-IND, Apr 16 2013, cancelled)
        gp = {}
        for g in sched:
            for t in g[1:3]:
                gp[t] = gp.get(t, 0) + 1
        short = {t: (gp.get(t, 0), v['w'] + v['l']) for t, v in teams.items() if gp.get(t, 0) != v['w'] + v['l']}
        assert not short, (season, 'games on the schedule against the standings', short)
        play_in = nba_log(y, 'PlayIn') if y >= 2020 else []
        champ = next(s['winner'] for s in series if s['round'] == 'final')
        bad = [t for g in sched for t in g[1:3] if t not in teams]
        assert not bad, (season, set(bad))
        out[season] = {'teams': teams, 'schedule': sched, 'series': series, 'play_in': play_in, 'champion': champ, 'source_check': check,
                       'sources': {'standings': su, 'playoffs': pu, 'schedule': 'stats.nba.com LeagueGameLog (Regular Season, PlayIn)'}}
        print(season, len(teams), 'teams', len(sched), 'games', len(series), 'series', len(play_in), 'play-in', 'champion', champ, flush=True)
    tmp = path + '.tmp'
    json.dump(out, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, path)


if __name__ == '__main__':
    main()
