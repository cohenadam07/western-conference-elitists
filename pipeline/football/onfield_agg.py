"""Who was on the field, and what happened while they were — the offensive line's data.

An offensive lineman's box score is a blank page. He has no targets, no carries, no
tackles; the only thing the traditional record holds against his name is a penalty flag.
That is why most "OL rankings" are really team rankings wearing a player's name.

nflverse's participation release closes part of the gap. It carries the exact eleven
offensive players on the field for every play from 2016 on, plus `was_pressure` — so for
each lineman we can ask what the offense did on *his* snaps, and, by subtracting him from
his team's totals, what it did without him. That second half is the important one: five
linemen share a huddle, so their on-field numbers are nearly identical and only the
on/off split has any hope of separating them.

None of this is an individual blocking grade. It is unit performance attributed to
presence, which is a weaker claim, and the page says so where it shows it.

Output: agg/onfield_<season>.json
  {"players":[{pid, tm, ...counters}], "teams":{tm: {...same counters}}}
"""
import json, os, sys
from collections import defaultdict

import numpy as np
import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_AGG', 'agg')
FIRST = 2016                      # participation data starts here

PART_COLS = ['nflverse_game_id', 'play_id', 'offense_players', 'was_pressure',
             'number_of_pass_rushers', 'defenders_in_box', 'possession_team']
PBP_COLS = ['game_id', 'play_id', 'season_type', 'play_type', 'posteam',
            'qb_dropback', 'qb_kneel', 'qb_spike', 'sack', 'epa', 'success',
            'yards_gained', 'rush_attempt']

# every counter the aggregate carries, so player rows and team rows stay the same shape
FIELDS = ['snaps', 'pblk', 'rblk', 'prs_n', 'prs', 'sk',
          'pepa', 'psucc', 'repa', 'rsucc', 'ryds', 'stuff',
          'rush_sum', 'rush_n', 'box_sum', 'box_n']


def _num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0)


def run_season(year):
    ppath = os.path.join(RAW, 'part', 'part_%d.csv' % year)
    bpath = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not (os.path.exists(ppath) and os.path.exists(bpath)):
        return None

    pa = pd.read_csv(ppath, low_memory=False, usecols=PART_COLS)
    pb = pd.read_parquet(bpath, columns=PBP_COLS)
    pb = pb[(pb.season_type == 'REG') & (pb.play_type.isin(['pass', 'run']))
            & (pb.qb_kneel == 0) & (pb.qb_spike == 0) & pb.posteam.notna()]
    d = pb.merge(pa, left_on=['game_id', 'play_id'],
                 right_on=['nflverse_game_id', 'play_id'], how='inner')
    d = d[d.offense_players.notna() & (d.offense_players != '')]
    if not len(d):
        return None

    isdb = (d.qb_dropback == 1)
    isrun = (d.rush_attempt == 1) & ~isdb
    # was_pressure only means anything on a dropback, and is blank on some older plays
    prs_known = isdb & d.was_pressure.notna()
    prs = prs_known & d.was_pressure.astype(str).str.upper().isin(['TRUE', '1'])
    rushers = _num(d.number_of_pass_rushers)
    box = _num(d.defenders_in_box)

    play = pd.DataFrame({
        'tm': d.posteam,
        'game': d.game_id,
        'players': d.offense_players.str.split(';'),
        'snaps': 1.0,
        'pblk': isdb.astype(float),
        'rblk': isrun.astype(float),
        'prs_n': prs_known.astype(float),
        'prs': prs.astype(float),
        'sk': _num(d.sack).where(isdb, 0.0),
        'pepa': _num(d.epa).where(isdb, 0.0),
        'psucc': _num(d.success).where(isdb, 0.0),
        'repa': _num(d.epa).where(isrun, 0.0),
        'rsucc': _num(d.success).where(isrun, 0.0),
        'ryds': _num(d.yards_gained).where(isrun, 0.0),
        'stuff': ((_num(d.yards_gained) <= 0) & isrun).astype(float),
        'rush_sum': rushers.where(isdb & (rushers > 0), 0.0),
        'rush_n': (isdb & (rushers > 0)).astype(float),
        'box_sum': box.where(isrun & (box > 0), 0.0),
        'box_n': (isrun & (box > 0)).astype(float),
    })

    # team totals first — the off-field half of every split is team minus player
    teams = play.groupby('tm')[FIELDS].sum()
    tgames = play.groupby('tm').game.nunique()

    # then one row per (player, play): 11 offensive players a snap, ~360k rows a season
    ex = play.explode('players').rename(columns={'players': 'pid'})
    ex = ex[ex.pid.notna() & (ex.pid != '')]
    grp = ex.groupby(['pid', 'tm'])
    per = grp[FIELDS].sum()
    per['g'] = grp.game.nunique()
    per = per.reset_index()

    out = {
        'players': [
            dict(pid=r.pid, tm=r.tm, g=int(r.g),
                 **{f: round(float(getattr(r, f)), 3) for f in FIELDS})
            for r in per.itertuples(index=False)
        ],
        'teams': {
            tm: dict(g=int(tgames[tm]),
                     **{f: round(float(teams.loc[tm, f]), 3) for f in FIELDS})
            for tm in teams.index
        },
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'onfield_%d.json' % year), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    return {'players': len(out['players']), 'teams': len(out['teams']),
            'plays': int(len(d))}


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or list(range(FIRST, 2026))
    for y in years:
        print(y, run_season(y), flush=True)
