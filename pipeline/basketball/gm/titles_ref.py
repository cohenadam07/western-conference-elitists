"""
titles_ref.py — what the title model needs from the rosters (imports gm5, so one heavy step).

1. Projected team strength at reference dates, as known on the day. Four a season: July 15 (after the draft and the
   first days of free agency), opening night, this calendar day (today's month and day, so the season in progress has a
   like-for-like history), February 1 (around the trade deadline). On each, every team's
   holdings (players and picks, gm5.holdings) are projected season by season for ten seasons with the point-in-time
   snapshots (gm5.asset_seasons: the models as of that day, a second-round stash at nothing). A team's projected
   strength in a season is the sum; relative to the league is that minus the league's mean on the same day.
2. Each team-season's players by value (Savant value times his share of the team's minutes), for the top-heavy test.
3. The scale from luck-adjusted margin to value points (gm5.ADJ_TO_VALUE).

    python3 titles_ref.py     # -> out/title_refs.json
"""
import collections, datetime as dt, json, os, time

import gm5
import grade as GR

OUT = gm5.OUT
HORIZON = GR.HORIZON


def ref_dates():
    """[(date, kind, season)] from 1979-80 on, every one on or before today."""
    first = {}
    for s, teams in gm5.G.items():
        y = int(s[:4]) + 1
        first[y] = min(min(d) for d in teams.values() if d)
    out = []
    for y in sorted(first):
        # 'today': this calendar day in every season, so the season in progress has a like-for-like curve
        md = GR.TODAY[5:]
        today = (f'{y - 1}-{md}' if md >= '07-01' else f'{y}-{md}')
        for d, kind in ((f'{y - 1}-07-15', 'summer'), (first[y], 'open'), (today, 'today'), (f'{y}-02-01', 'mid')):
            if '1979-07-15' <= d <= GR.TODAY:
                out.append((d, kind, y))
    return sorted(set(out))


def teams_on(y):
    s = f'{y - 1}-{str(y)[2:]}'
    return sorted({'CHO' if ab == 'CHA' and y >= 2005 else gm5.franchise(ab) for ab in gm5.G.get(s, {})})


def main():
    t0 = time.time()
    refs = ref_dates()
    q = [(d, t) for d, k, y in refs for t in teams_on(min(y, GR.NOW_SEASON))]
    H = gm5.holdings(q)
    print('holdings', len(H), f'{time.time() - t0:.0f}s', flush=True)
    out = []
    for d, kind, y in refs:
        teams, early = {}, False
        for t in teams_on(min(y, GR.NOW_SEASON)):
            by = collections.Counter()
            for a in H[(d, t)]:
                s, e = gm5.asset_seasons(a, d)
                early = early or e
                for yy, v in s.items():
                    if y <= yy < y + HORIZON:
                        by[yy - y] += v
            teams[t] = [round(by[h], 1) for h in range(HORIZON)]
        out.append({'date': d, 'kind': kind, 'season': y, 'early': early, 'teams': teams})
        if kind == 'open':
            print(d, kind, y, len(teams), 'teams', f'{time.time() - t0:.0f}s', flush=True)
    vals = collections.defaultdict(lambda: collections.defaultdict(list))
    for (pid, y), v in GR.VAL.items():
        for team, sh in GR.SHARE.get((pid, y), {}).items():
            if sh > 0:
                vals[y][team].append(v * sh)
    tv = {str(y): {t: sorted((round(x, 1) for x in xs), reverse=True)[:15] + [round(sum(xs), 1)] for t, xs in d.items()}
          for y, d in vals.items()}
    res = {'adj_to_value': gm5.ADJ_TO_VALUE, 'horizon': HORIZON, 'today': GR.TODAY, 'refs': out,
           'team_values': tv, 'team_values_note': 'per team-season: the top 15 players by value (value x share of the team\'s minutes), then the team total'}
    tmp = os.path.join(OUT, 'title_refs.json.tmp')
    json.dump(res, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, os.path.join(OUT, 'title_refs.json'))
    print('refs', len(out), f'{time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
