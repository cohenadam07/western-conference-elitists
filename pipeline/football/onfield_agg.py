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

The same file names the eleven defenders, and the page had never read them. They answer the
question every defensive rate on this site has had to dodge: how many of a man's snaps were
pass plays? A nose tackle who comes off the field on third down and an edge rusher who only
plays third down can post the same pressures per snap and be nothing alike. So each defender
gets his snaps split into dropbacks and designed runs, and the same on-field / off-field
treatment the line gets, from the other side of the ball.

And from 2018 the file says whether the coverage was man or zone, which is laid beside the
passer and the targeted receiver.

Output: agg/onfield_<season>.json
  {"players":[{pid, tm, ...counters}], "teams":{tm: {...same counters}},
   "def":[{pid, tm, g, ...defensive counters}], "dteams":{tm: {...same}},
   "wk":[{pid, week, ops, ors, dps, drs}],     pass and run plays on the field, by week
   "qbmz":[{pid, man, man_epa, zone, zone_epa}],
   "recmz":[{pid, man, man_rec, man_yds, zone, zone_rec, zone_yds}]}
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list_from_env
from collections import defaultdict

import numpy as np
import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('NFL_AGG', 'agg')
FIRST = 2016                      # participation data starts here

PART_COLS = ['nflverse_game_id', 'play_id', 'offense_players', 'was_pressure',
             'number_of_pass_rushers', 'defenders_in_box', 'possession_team',
             'defense_players', 'defense_man_zone_type']
PBP_COLS = ['game_id', 'play_id', 'week', 'season_type', 'play_type', 'posteam',
            'qb_dropback', 'qb_kneel', 'qb_spike', 'sack', 'epa', 'success',
            'yards_gained', 'rush_attempt',
            'defteam', 'qb_hit', 'qb_epa', 'complete_pass',
            'passer_player_id', 'rusher_player_id', 'receiver_player_id',
            'two_point_attempt', 'aborted_play', 'receiving_yards']

# every counter the aggregate carries, so player rows and team rows stay the same shape
FIELDS = ['snaps', 'pblk', 'rblk', 'prs_n', 'prs', 'sk',
          'pepa', 'psucc', 'repa', 'rsucc', 'ryds', 'stuff',
          'rush_sum', 'rush_n', 'box_sum', 'box_n', 'hit']
# the defensive side: his snaps by kind of play, and what the offense did on them
DFIELDS = ['dsn', 'dps', 'drs', 'de', 'dpe', 'dpsucc', 'dprs_n', 'dprs', 'dre', 'drsucc', 'dryds']


def _num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0)


def run_season(year):
    ppath = os.path.join(RAW, 'part', 'part_%d.csv' % year)
    bpath = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not (os.path.exists(ppath) and os.path.exists(bpath)):
        return None

    head = pd.read_csv(ppath, nrows=0).columns
    pa = pd.read_csv(ppath, low_memory=False, usecols=[c for c in PART_COLS if c in head])
    for c in PART_COLS:
        if c not in pa.columns:
            pa[c] = np.nan
    pb = pd.read_parquet(bpath, columns=PBP_COLS)
    pb = pb[(pb.season_type == 'REG') & (pb.play_type.isin(['pass', 'run']))
            & (pb.qb_kneel == 0) & (pb.qb_spike == 0) & pb.posteam.notna()
            # a two-point try is not a play from scrimmage (see pbp_agg.run_season)
            & (pb.two_point_attempt.fillna(0) == 0)]
    d = pb.merge(pa, left_on=['game_id', 'play_id'],
                 right_on=['nflverse_game_id', 'play_id'], how='inner')
    d = d[d.offense_players.notna() & (d.offense_players != '')]
    if not len(d):
        return None

    isdb = (d.qb_dropback == 1)
    isrun = (d.rush_attempt == 1) & ~isdb & (d.aborted_play.fillna(0) == 0)
    # was_pressure only means anything on a dropback, and is blank on some older plays
    prs_known = isdb & d.was_pressure.notna()
    prs = prs_known & d.was_pressure.astype(str).str.upper().isin(['TRUE', '1'])
    rushers = _num(d.number_of_pass_rushers)
    box = _num(d.defenders_in_box)

    play = pd.DataFrame({
        'tm': d.posteam,
        'game': d.game_id,
        'week': d.week,
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
        'hit': (((_num(d.sack) + _num(d.qb_hit)) > 0) & isdb).astype(float),
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
    # the same men by week, so a game-by-game line can use true counts where they exist
    owk = ex.groupby(['pid', 'week'])[['pblk', 'rblk']].sum().reset_index()
    wk_rows = {(r.pid, int(r.week)): dict(ops=float(r.pblk), ors=float(r.rblk))
               for r in owk.itertuples(index=False)}

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

    # ---- the defense: the same plays, read from the other huddle
    dd = d[d.defense_players.notna() & (d.defense_players != '') & d.defteam.notna()]
    if len(dd):
        ddb = (dd.qb_dropback == 1)
        drun = (dd.rush_attempt == 1) & ~ddb & (dd.aborted_play.fillna(0) == 0)
        dknown = ddb & dd.was_pressure.notna()
        dprs = dknown & dd.was_pressure.astype(str).str.upper().isin(['TRUE', '1'])
        dplay = pd.DataFrame({
            'tm': dd.defteam, 'game': dd.game_id, 'week': dd.week,
            'players': dd.defense_players.str.split(';'),
            'dsn': 1.0,
            'dps': ddb.astype(float),
            'drs': drun.astype(float),
            'de': _num(dd.epa),
            'dpe': _num(dd.epa).where(ddb, 0.0),
            'dpsucc': _num(dd.success).where(ddb, 0.0),
            'dprs_n': dknown.astype(float),
            'dprs': dprs.astype(float),
            'dre': _num(dd.epa).where(drun, 0.0),
            'drsucc': _num(dd.success).where(drun, 0.0),
            'dryds': _num(dd.yards_gained).where(drun, 0.0),
        })
        dteams = dplay.groupby('tm')[DFIELDS].sum()
        dgames = dplay.groupby('tm').game.nunique()
        dex = dplay.explode('players').rename(columns={'players': 'pid'})
        dex = dex[dex.pid.notna() & (dex.pid != '')]
        dgrp = dex.groupby(['pid', 'tm'])
        dper = dgrp[DFIELDS].sum()
        dper['g'] = dgrp.game.nunique()
        dper = dper.reset_index()
        dwk = dex.groupby(['pid', 'week'])[['dps', 'drs']].sum().reset_index()
        for r in dwk.itertuples(index=False):
            wk_rows.setdefault((r.pid, int(r.week)), {}).update(dps=float(r.dps), drs=float(r.drs))
        out['def'] = [dict(pid=r.pid, tm=r.tm, g=int(r.g),
                           **{f: round(float(getattr(r, f)), 3) for f in DFIELDS})
                      for r in dper.itertuples(index=False)]
        out['dteams'] = {tm: dict(g=int(dgames[tm]),
                                  **{f: round(float(dteams.loc[tm, f]), 3) for f in DFIELDS})
                         for tm in dteams.index}

    out['wk'] = [dict(pid=k[0], week=k[1], **v) for k, v in sorted(wk_rows.items())]

    # ---- man or zone (2018 on), beside the passer and the man he threw to
    mz = d[isdb & d.defense_man_zone_type.notna()]
    if len(mz):
        kind = mz.defense_man_zone_type.astype(str).str.upper()
        man, zone = kind.str.startswith('MAN'), kind.str.startswith('ZONE')
        qpid = mz.passer_player_id.where(mz.passer_player_id.notna(), mz.rusher_player_id)
        q = pd.DataFrame({'pid': qpid, 'man': man.astype(float), 'zone': zone.astype(float),
                          'man_epa': _num(mz.qb_epa).where(man, 0.0),
                          'zone_epa': _num(mz.qb_epa).where(zone, 0.0)})
        q = q[q.pid.notna()].groupby('pid', as_index=False).sum()
        out['qbmz'] = [{k: (v if k == 'pid' else round(float(v), 3)) for k, v in r.items()}
                       for r in q.to_dict('records')]
        t = mz[(mz.play_type == 'pass') & (mz.sack != 1) & mz.receiver_player_id.notna()]
        if len(t):
            tk = t.defense_man_zone_type.astype(str).str.upper()
            tman, tzone = tk.str.startswith('MAN'), tk.str.startswith('ZONE')
            comp = _num(t.complete_pass)
            # his own yards, not a lateral's
            yd = _num(t.receiving_yards.where(t.receiving_yards.notna(), t.yards_gained)).where(comp == 1, 0.0)
            rr = pd.DataFrame({'pid': t.receiver_player_id,
                               'man': tman.astype(float), 'man_rec': comp.where(tman, 0.0),
                               'man_yds': yd.where(tman, 0.0),
                               'zone': tzone.astype(float), 'zone_rec': comp.where(tzone, 0.0),
                               'zone_yds': yd.where(tzone, 0.0)}).groupby('pid', as_index=False).sum()
            out['recmz'] = [{k: (v if k == 'pid' else round(float(v), 3)) for k, v in r.items()}
                            for r in rr.to_dict('records')]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'onfield_%d.json' % year), 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    return {'players': len(out['players']), 'teams': len(out['teams']),
            'plays': int(len(d)), 'def': len(out.get('def', [])),
            'qbmz': len(out.get('qbmz', [])), 'recmz': len(out.get('recmz', []))}


if __name__ == '__main__':
    years = [int(a) for a in sys.argv[1:]] or [y for y in season_list_from_env() if y >= FIRST]
    for y in years:
        print(y, run_season(y), flush=True)
