"""Receiver route trees: where the ball went, by the route the targeted man ran.

Only the TARGETED receiver's route is charted in public data (the participation file's
`route` column, 2016 on). Nobody publishes the routes a receiver ran without the ball, so
this is a tree of targets, not of routes run: how often he was thrown to on a slant, and
what came of it. The page says so.

The route names changed when the charting source did, in 2023:

    2016-22   FLAT  OUT                    HITCH       CROSS               IN      ANGLE
    2023 on   SWING QUICK OUT / DEEP OUT   HITCH/CURL  SHALLOW CROSS/DRAG  IN/DIG  TEXAS/ANGLE

Every season is stored in one fixed set of slots so a career can be added up. OUT keeps
its own slot beside QOUT and DOUT; a career view that spans 2023 folds the three together.

Output, one file per season (loaded only when a receiver card is opened):
  public/football-routes/<season>.json
      slots  the slot keys, in order
      p      {player id: {n, r: [[targets, catches, yards, EPA, air yards, 1st downs] per slot]}}
      lg     {WR|TE|RB: the same rows summed over every player at that position}
  public/football-routes/index.json   {player id: [seasons]}

The participation file is published after the Super Bowl, so a season in progress has no
routes; this stage skips it and the page shows the last finished season's tree.
"""
import json, os, sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_ROUTES', os.path.join('..', '..', 'public', 'football-routes'))
SEASONS = [y for y in season_list_from_env() if y >= 2016]
MIN_TARGETS = 10

SLOTS = ['SCREEN', 'FLAT', 'SLANT', 'QOUT', 'DOUT', 'OUT', 'HITCH', 'CROSS', 'IN',
         'CORNER', 'POST', 'GO', 'WHEEL', 'ANGLE']
NATIVE = {
    'SCREEN': 'SCREEN', 'FLAT': 'FLAT', 'SWING': 'FLAT', 'SLANT': 'SLANT',
    'QUICK OUT': 'QOUT', 'DEEP OUT': 'DOUT', 'OUT': 'OUT',
    'HITCH': 'HITCH', 'CURL': 'HITCH', 'HITCH/CURL': 'HITCH',
    'CROSS': 'CROSS', 'SHALLOW CROSS/DRAG': 'CROSS',
    'IN': 'IN', 'IN/DIG': 'IN', 'CORNER': 'CORNER', 'POST': 'POST', 'GO': 'GO',
    'WHEEL': 'WHEEL', 'ANGLE': 'ANGLE', 'TEXAS/ANGLE': 'ANGLE',
}
POS = {'WR': 'WR', 'TE': 'TE', 'RB': 'RB', 'FB': 'RB', 'HB': 'RB'}


def positions():
    p = os.path.join(RAW, 'players.csv')
    if not os.path.exists(p):
        return {}
    pl = pd.read_csv(p, usecols=['gsis_id', 'position'], low_memory=False)
    return {r.gsis_id: POS.get(r.position) for r in pl.itertuples() if POS.get(r.position)}


def season(y, pos):
    pbp_p = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % y)
    part_p = os.path.join(RAW, 'part', 'part_%d.csv' % y)
    if not (os.path.exists(pbp_p) and os.path.exists(part_p)):
        return None
    pb = pd.read_parquet(pbp_p, columns=['game_id', 'play_id', 'season_type', 'play_type', 'sack',
                                         'receiver_player_id', 'complete_pass', 'yards_gained',
                                         'epa', 'air_yards', 'first_down', 'two_point_attempt',
                                         'receiving_yards'])
    pb = pb[(pb.season_type == 'REG') & (pb.play_type == 'pass') & (pb.sack != 1)
            & pb.receiver_player_id.notna() & (pb.two_point_attempt.fillna(0) == 0)]
    # his own yards, not a lateral's
    pb['yards_gained'] = pb.receiving_yards.where(pb.receiving_yards.notna(), pb.yards_gained)
    q = pd.read_csv(part_p, usecols=['nflverse_game_id', 'play_id', 'route'], low_memory=False)
    q = q.rename(columns={'nflverse_game_id': 'game_id'}).drop_duplicates(['game_id', 'play_id'])
    d = pb.merge(q, on=['game_id', 'play_id'], how='left')
    d['slot'] = d.route.astype(str).str.strip().str.upper().map(NATIVE)
    unmapped = d[d.route.notna() & d.slot.isna()].route.unique()
    if len(unmapped):
        print('  unmapped route names in %d: %s' % (y, list(unmapped)))
    d = d[d.slot.notna()].copy()
    d['comp'] = d.complete_pass.fillna(0)
    d['yds'] = d.yards_gained.fillna(0) * d.comp      # yards only count on a catch
    d['fd'] = d.first_down.fillna(0) * d.comp
    idx = {s: i for i, s in enumerate(SLOTS)}

    def rows(frame):
        r = [[0, 0, 0.0, 0.0, 0.0, 0] for _ in SLOTS]
        for s, g in frame.groupby('slot'):
            i = idx[s]
            r[i] = [int(len(g)), int(g.comp.sum()), round(float(g.yds.sum()), 1),
                    round(float(g.epa.fillna(0).sum()), 2), round(float(g.air_yards.fillna(0).sum()), 1),
                    int(g.fd.sum())]
        return r

    players = {}
    for pid, g in d.groupby('receiver_player_id'):
        if len(g) >= MIN_TARGETS:
            players[pid] = dict(n=int(len(g)), r=rows(g))
    d['pos'] = d.receiver_player_id.map(pos)
    lg = {k: rows(d[d.pos == k]) for k in ('WR', 'TE', 'RB')}
    return dict(season=y, slots=SLOTS, p=players, lg=lg,
                charted=round(float(pb.merge(q, on=['game_id', 'play_id'], how='left').route.notna().mean()), 3))


def main():
    os.makedirs(OUT, exist_ok=True)
    ip = os.path.join(OUT, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    pos = positions()
    for y in SEASONS:
        blk = season(y, pos)
        if blk is None:
            print(y, 'no participation file yet - skipped')
            continue
        for pid in list(index):
            index[pid] = [s for s in index[pid] if s != y]
            if not index[pid]:
                del index[pid]
        with open(os.path.join(OUT, '%d.json' % y), 'w') as f:
            json.dump(blk, f, separators=(',', ':'))
        for pid in blk['p']:
            index.setdefault(pid, []).append(y)
        print(y, len(blk['p']), 'receivers, %.1f%% of targets charted' % (100 * blk['charted']), flush=True)
    for pid in index:
        index[pid] = sorted(set(index[pid]))
    with open(ip, 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print('index', len(index), 'players')


if __name__ == '__main__':
    main()
