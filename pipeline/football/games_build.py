"""Build one JSON per postseason game for the game page.

Everything here comes out of the play-by-play games_fetch.py cached, plus nflverse's
schedule for the things a play doesn't know: the date, the building, the referee, the
closing spread. One file per game, loaded on demand the way the field maps already are,
because nobody opens more than one game at a time.

The win-probability series is the spine of the page. nflverse's home_wp is populated for
every postseason play back to 1999, so the chart is real for all 309 games rather than
only the modern ones.

    python3 games_fetch.py && python3 games_build.py
"""
import io, json, os, re, sys
from collections import defaultdict

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import requests

AGG = os.environ.get('NFL_AGG', 'agg')
PLAYS = os.path.join(AGG, 'post_plays.parquet')
OUT = os.environ.get('NFL_GAMES_OUT', '../../public/football-games')
SCHED = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'

ROUND = {'WC': 'Wild Card', 'DIV': 'Divisional', 'CON': 'Conference Championship',
         'SB': 'Super Bowl'}


def sb_name(season):
    """Super Bowls are known by number. The count starts with the 1966 season, and the
    league branded the fiftieth in Arabic rather than as 'L'."""
    n = int(season) - 1965
    if n == 50:
        return '50'
    out, rest = '', n
    for v, sym in ((1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'),
                   (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')):
        while rest >= v:
            out += sym
            rest -= v
    return out


def num(v, d=0):
    try:
        f = float(v)
        return d if not np.isfinite(f) else f
    except (TypeError, ValueError):
        return d


def r1(v, p=1):
    return None if v is None or not np.isfinite(v) else round(float(v), p)


OT_LEN = 900          # postseason overtime periods are fifteen minutes, not ten


def clock_secs(row):
    """Seconds elapsed since kickoff, so the chart has a monotonic x axis through overtime.

    Getting the overtime period length wrong does not just shift the tail — a 15-minute
    period measured against a 10-minute clock runs the x axis backwards, and the chart
    folds over itself.
    """
    q = int(num(row.qtr, 1))
    qsr = num(row.quarter_seconds_remaining, 0)
    if q <= 4:
        return (q - 1) * 900 + (900 - qsr)
    return 3600 + (q - 5) * OT_LEN + (OT_LEN - qsr)


def att_of(df):
    """Passing attempts the way a box score counts them.

    nflverse's pass_attempt flag is set on sacks and on plays a penalty wiped out, so
    summing it gives Brady 68 attempts in Super Bowl LI where the record says 62. What the
    record counts is completions plus incompletions plus interceptions, so count that.
    """
    return int(df.complete_pass.sum() + df.incomplete_pass.sum() + df.interception.sum())


def team_stats(g, team):
    o = g[g.posteam == team]
    d = g[g.defteam == team]
    rush = o[o.rush_attempt == 1]
    dropback = o[(o.pass_attempt == 1) | (o.sack == 1)]
    comp = o[o.complete_pass == 1]
    sacks_taken = o[o.sack == 1]
    rush_y = float(rush.yards_gained.sum())
    pass_y = float(comp.yards_gained.sum())
    sack_y = float(-sacks_taken.yards_gained.sum())
    t3 = o[(o.third_down_converted == 1) | (o.third_down_failed == 1)]
    t4 = o[(o.fourth_down_converted == 1) | (o.fourth_down_failed == 1)]
    pen = g[(g.penalty == 1) & (g.penalty_team == team)]
    scoring = o[o.sp == 1]
    rz = o[(o.yardline_100 <= 20) & (o.yardline_100.notna())]
    return {
        'plays': int(len(rush) + len(dropback)),
        'yds': round(rush_y + pass_y - sack_y),
        'passYds': round(pass_y - sack_y),
        'rushYds': round(rush_y),
        'passAtt': att_of(o),
        'passCmp': int(o.complete_pass.sum()),
        'rushAtt': int(len(rush)),
        'fd': int(o.first_down.sum()),
        'thirdC': int(o.third_down_converted.sum()), 'thirdA': int(len(t3)),
        'fourthC': int(o.fourth_down_converted.sum()), 'fourthA': int(len(t4)),
        'sacksTaken': int(len(sacks_taken)), 'sackYds': round(sack_y),
        'sacksMade': int(d.sack.sum()),
        'to': int(o.interception.sum() + o.fumble_lost.sum()),
        'takeaways': int(d.interception.sum() + d.fumble_lost.sum()),
        'pen': int(len(pen)), 'penYds': int(num(pen.penalty_yards.sum())),
        'epaPlay': r1(o.epa.mean(), 3),
        'success': r1(100 * o.success.mean(), 1),
        'rzTrips': int(rz.fixed_drive.nunique()),
        'scores': int(len(scoring)),
    }


def box(g):
    """Passing, rushing and receiving lines, in the order a box score prints them."""
    out = {'pass': [], 'rush': [], 'rec': []}
    p = g[g.passer_player_name.notna()]
    for (nm, tm), r in p.groupby(['passer_player_name', 'posteam'], dropna=True):
        out['pass'].append({
            'n': nm, 't': tm, 'att': att_of(r), 'cmp': int(r.complete_pass.sum()),
            'yds': round(float(r[r.complete_pass == 1].yards_gained.sum())),
            'td': int(r.pass_touchdown.sum()), 'int': int(r.interception.sum()),
            'sk': int(r.sack.sum()), 'epa': r1(r.epa.sum(), 1)})
    r_ = g[g.rusher_player_name.notna()]
    for (nm, tm), r in r_.groupby(['rusher_player_name', 'posteam'], dropna=True):
        out['rush'].append({
            'n': nm, 't': tm, 'att': int(r.rush_attempt.sum()),
            'yds': round(float(r.yards_gained.sum())), 'td': int(r.rush_touchdown.sum()),
            'epa': r1(r.epa.sum(), 1)})
    c_ = g[g.receiver_player_name.notna()]
    for (nm, tm), r in c_.groupby(['receiver_player_name', 'posteam'], dropna=True):
        out['rec'].append({
            'n': nm, 't': tm, 'tgt': att_of(r), 'rec': int(r.complete_pass.sum()),
            'yds': round(float(r[r.complete_pass == 1].yards_gained.sum())),
            'td': int(r.pass_touchdown.sum()), 'epa': r1(r.epa.sum(), 1)})
    out['pass'].sort(key=lambda x: -x['att'])
    out['rush'].sort(key=lambda x: -x['att'])
    out['rec'].sort(key=lambda x: -x['rec'])
    for k in out:
        out[k] = [x for x in out[k] if x.get('att') or x.get('rec') or x.get('tgt')]
    return out


def build_game(gid, g, meta):
    g = g.sort_values(['qtr', 'quarter_seconds_remaining'],
                      ascending=[True, False]).reset_index(drop=True)
    home, away = meta['home_team'], meta['away_team']
    gt = meta['game_type']

    # The win-probability spine. home_wp is the pure game-state model: it hands the home
    # team a small edge at kickoff, which at a neutral-site Super Bowl is an artifact of
    # the model rather than a fact about the game. vegas_wp starts from the closing spread
    # instead, so both are carried and the page opens on the market-aware one.
    wp, last = [], None
    vwp, vlast = [], None
    for row in g.itertuples(index=False):
        v = num(row.vegas_wp, None)
        if v is None or not isinstance(row.posteam, str):
            continue
        v = v if row.posteam == home else 1 - v
        t = clock_secs(row)
        v = round(float(v), 4)
        if vlast is not None and vlast[0] == t and vlast[1] == v:
            continue
        vwp.append([t, v])
        vlast = [t, v]
    for row in g.itertuples(index=False):
        v = num(row.home_wp, None) if row.home_wp is not None else None
        if v is None or not np.isfinite(num(row.home_wp, float('nan'))):
            continue
        t = clock_secs(row)
        v = round(float(row.home_wp), 4)
        if last is not None and last[0] == t and last[1] == v:
            continue
        wp.append([t, v])
        last = [t, v]

    # scoring plays, and the line score they add up to
    scoring = []
    for row in g[g.sp == 1].itertuples(index=False):
        desc = re.sub(r'\s+', ' ', str(row.desc or '')).strip()
        scoring.append({'q': int(num(row.qtr, 0)), 'c': str(row.time or ''),
                        't': row.posteam if isinstance(row.posteam, str) else None,
                        'd': desc[:240],
                        'a': int(num(row.total_away_score)), 'h': int(num(row.total_home_score)),
                        's': clock_secs(row)})
    qmax = int(num(g.qtr.max(), 4))
    line_a, line_h, pa, ph = [], [], 0, 0
    for q in range(1, max(qmax, 4) + 1):
        upto = g[g.qtr <= q]
        a = int(num(upto.total_away_score.max())) if len(upto) else 0
        h = int(num(upto.total_home_score.max())) if len(upto) else 0
        line_a.append(a - pa)
        line_h.append(h - ph)
        pa, ph = a, h

    # drives
    drives = []
    for dnum, d in g[g.fixed_drive.notna()].groupby('fixed_drive'):
        d = d[d.posteam.notna()]
        if not len(d):
            continue
        first = d.iloc[0]
        plays = d[(d.pass_attempt == 1) | (d.rush_attempt == 1) | (d.sack == 1)]
        drives.append({'t': first.posteam, 'q': int(num(first.qtr, 0)),
                       'c': str(first.time or ''), 'start': int(num(first.yardline_100, 0)),
                       'r': str(first.fixed_drive_result or ''), 'p': int(len(plays)),
                       'y': round(float(plays.yards_gained.sum()))})

    # the plays that actually moved it
    kp = g[g.wpa.notna() & g.play_type.notna()].copy()
    kp['abs'] = kp.wpa.abs()
    key = []
    for row in kp.sort_values('abs', ascending=False).head(6).itertuples(index=False):
        key.append({'q': int(num(row.qtr, 0)), 'c': str(row.time or ''),
                    't': row.posteam if isinstance(row.posteam, str) else None,
                    'd': re.sub(r'\s+', ' ', str(row.desc or '')).strip()[:240],
                    'wpa': r1(row.wpa, 4), 'epa': r1(row.epa, 2), 's': clock_secs(row)})
    key.sort(key=lambda x: x['s'])

    # Both models trail off before the whistle — the last kneel-downs carry no posteam and
    # the Vegas line never quite converges — so each series is closed on the result that
    # actually happened rather than left hanging at 4%.
    hs, as_ = int(num(meta.get('home_score'))), int(num(meta.get('away_score')))
    end = 1.0 if hs > as_ else (0.0 if as_ > hs else 0.5)
    for series in (wp, vwp):
        run = 0.0
        for pt in series:
            run = max(run, pt[0])
            pt[0] = run
        if series:
            last_t = max(series[-1][0], g.pipe(lambda d: max(clock_secs(r) for r in d.itertuples(index=False))))
            if series[-1][1] != end:
                series.append([last_t, end])

    name = ('Super Bowl ' + sb_name(meta['season'])) if gt == 'SB' else ROUND.get(gt, gt)
    return {
        'id': gid, 'season': int(meta['season']), 'type': gt, 'name': name,
        'week': int(num(meta.get('week'), 0)),
        'date': str(meta.get('gameday') or ''), 'kick': str(meta.get('gametime') or ''),
        'stadium': str(meta.get('stadium') or ''), 'roof': str(meta.get('roof') or ''),
        'surface': str(meta.get('surface') or ''), 'ref': str(meta.get('referee') or ''),
        'temp': None if pd.isna(meta.get('temp')) else int(num(meta.get('temp'))),
        'wind': None if pd.isna(meta.get('wind')) else int(num(meta.get('wind'))),
        'ot': bool(num(meta.get('overtime'), 0)),
        'spread': None if pd.isna(meta.get('spread_line')) else float(meta.get('spread_line')),
        'home': {'t': home, 'score': int(num(meta.get('home_score'))), 'line': line_h,
                 'coach': str(meta.get('home_coach') or ''), 'qb': str(meta.get('home_qb_name') or '')},
        'away': {'t': away, 'score': int(num(meta.get('away_score'))), 'line': line_a,
                 'coach': str(meta.get('away_coach') or ''), 'qb': str(meta.get('away_qb_name') or '')},
        'wp': wp, 'vwp': vwp, 'scoring': scoring, 'drives': drives, 'key': key,
        'team': {home: team_stats(g, home), away: team_stats(g, away)},
        'box': box(g),
    }


def main():
    if not os.path.exists(PLAYS):
        sys.exit('no %s — run games_fetch.py first' % PLAYS)
    pl = pq.read_table(PLAYS).to_pandas()
    sched = pd.read_csv(io.BytesIO(requests.get(SCHED, timeout=120).content), low_memory=False)
    sched = sched[sched.game_type.isin(ROUND)].set_index('game_id')

    os.makedirs(OUT, exist_ok=True)
    index, made, skipped = {}, 0, []
    for gid, g in pl.groupby('game_id'):
        if gid not in sched.index:
            skipped.append(gid)
            continue
        meta = sched.loc[gid].to_dict()
        try:
            rec = build_game(gid, g, meta)
        except Exception as e:
            skipped.append('%s (%s)' % (gid, e))
            continue
        with open(os.path.join(OUT, gid + '.json'), 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        index[gid] = {'s': rec['season'], 'ty': rec['type'], 'n': rec['name'],
                      'd': rec['date'], 'h': rec['home']['t'], 'a': rec['away']['t'],
                      'hs': rec['home']['score'], 'as': rec['away']['score']}
        made += 1
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'), sort_keys=True)
    # the game page needs team names and colours and nothing else from the big dataset
    from teams import TEAMS
    with open(os.path.join(OUT, 'teams.json'), 'w') as f:
        json.dump(TEAMS, f, separators=(',', ':'), sort_keys=True)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print('wrote %d games to %s (%.1f MB)' % (made, OUT, size / 1e6))
    if skipped:
        print('skipped %d: %s' % (len(skipped), ', '.join(map(str, skipped[:6]))))


if __name__ == '__main__':
    main()
