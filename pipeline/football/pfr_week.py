"""PFR advanced stats for a season still being played, summed up from the weekly files.

PFR's charting (coverage, pressures, missed tackles, yards after contact, broken tackles)
reaches build.py through nflverse's all-seasons-in-one files, `advstats_season_*.csv`. Those
are only written once a season is over. So from September to February every number that
comes from them was simply missing from the current season - a corner's whole headline set
(completion % allowed, passer rating allowed, yards allowed per snap, ball production,
targets per snap) is PFR's, which meant not one corner in the league could be scored, and
edge rushers, interior linemen and linebackers were being ranked with their pressures and
missed tackles left out.

nflverse also posts the same charting *weekly*, and those files do move during the season.
This turns them back into the season-level rows build.py already understands, column for
column, so nothing downstream has to know where a row came from:

    advstats_week_def_<y>.csv   ->  def_tgt, def_cmp, def_rat, def_prss, def_m_tkl_percent ...
    advstats_week_rush_<y>.csv  ->  rush_att, rush_ybc_att, rush_yac_att, rush_brk_tkl
    advstats_week_rec_<y>.csv   ->  rec_brk_tkl, rec_drop_percent, rec_rec

Rates are rebuilt from the summed counts, never averaged week to week. Validated against the
2025 season file, where the two agree (see validate() below; run `python3 pfr_week.py 2025`).

Two things the weekly files do not carry and are therefore left unset in season: batted
balls (def_bats) and the quarterback-side PFR rows (pocket time, on-target %), which the FTN
block in build.py mostly covers anyway.
"""
import os, sys
from collections import defaultdict

import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')


def _f(x):
    try:
        v = float(x)
        return v if v == v else 0.0
    except (TypeError, ValueError):
        return 0.0


def passer_rating(cmp_, att, yds, td, int_):
    if not att:
        return None
    a = min(max((cmp_ / att - 0.3) * 5, 0), 2.375)
    b = min(max((yds / att - 3) * 0.25, 0), 2.375)
    c = min(max((td / att) * 20, 0), 2.375)
    d = min(max(2.375 - (int_ / att * 25), 0), 2.375)
    return (a + b + c + d) / 6 * 100


def _read(kind, y, raw):
    p = os.path.join(raw, 'advw_%s_%d.csv' % (kind, y))
    if not os.path.exists(p) or os.path.getsize(p) < 200:
        return None
    df = pd.read_csv(p, low_memory=False)
    if 'game_type' in df.columns:
        df = df[df.game_type == 'REG']
    return df[df.pfr_player_id.notna()]


def _receiving_totals(y, raw):
    """Receptions and targets by gsis id, from nflverse's weekly stat table - the weekly
    PFR receiving file has broken tackles and drops but not the denominators."""
    p = os.path.join(raw, 'wk_%d.csv' % y)
    if not os.path.exists(p):
        return {}
    df = pd.read_csv(p, usecols=['player_id', 'season_type', 'receptions', 'targets'],
                     low_memory=False)
    df = df[df.season_type == 'REG']
    g = df.groupby('player_id')[['receptions', 'targets']].sum()
    return {pid: (float(r.receptions or 0), float(r.targets or 0)) for pid, r in g.iterrows()}


def season_rows(y, by_pfr, raw=RAW):
    """{(gsis_id, y): {'def_tgt': .., 'rush_yac_att': .., ...}} for one season, or {}."""
    out = defaultdict(dict)

    d = _read('def', y, raw)
    if d is not None and len(d):
        d = d.copy()
        d['_ay_t'] = pd.to_numeric(d.def_adot, errors='coerce').fillna(0) * \
            pd.to_numeric(d.def_targets, errors='coerce').fillna(0)
        cols = ['def_ints', 'def_targets', 'def_completions_allowed', 'def_yards_allowed',
                'def_receiving_td_allowed', 'def_air_yards_completed', 'def_yards_after_catch',
                'def_times_blitzed', 'def_times_hurried', 'def_times_hitqb', 'def_sacks',
                'def_pressures', 'def_tackles_combined', 'def_missed_tackles', '_ay_t']
        for c in cols:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        g = d.groupby('pfr_player_id')[cols].sum()
        for pid, r in g.iterrows():
            gid = by_pfr.get(pid)
            if not gid:
                continue
            tgt, cmp_, yds = r.def_targets, r.def_completions_allowed, r.def_yards_allowed
            row = dict(def_int=r.def_ints, def_tgt=tgt, def_cmp=cmp_, def_yds=yds,
                       def_td=r.def_receiving_td_allowed, def_air=r.def_air_yards_completed,
                       def_yac=r.def_yards_after_catch, def_bltz=r.def_times_blitzed,
                       def_hrry=r.def_times_hurried, def_qbkd=r.def_times_hitqb,
                       def_sk=r.def_sacks, def_prss=r.def_pressures,
                       def_comb=r.def_tackles_combined, def_m_tkl=r.def_missed_tackles)
            if tgt:
                row['def_cmp_percent'] = cmp_ / tgt
                row['def_yds_tgt'] = yds / tgt
                row['def_rat'] = passer_rating(cmp_, tgt, yds, r.def_receiving_td_allowed, r.def_ints)
                row['def_dadot'] = r._ay_t / tgt
            if cmp_:
                row['def_yds_cmp'] = yds / cmp_
            att = r.def_tackles_combined + r.def_missed_tackles
            if att:
                row['def_m_tkl_percent'] = r.def_missed_tackles / att
            out[(gid, y)].update(row)

    d = _read('rush', y, raw)
    if d is not None and len(d):
        cols = ['carries', 'rushing_yards_before_contact', 'rushing_yards_after_contact',
                'rushing_broken_tackles']
        d = d.copy()
        for c in cols:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        g = d.groupby('pfr_player_id')[cols].sum()
        for pid, r in g.iterrows():
            gid = by_pfr.get(pid)
            if not gid or not r.carries:
                continue
            out[(gid, y)].update(dict(
                rush_att=r.carries, rush_ybc=r.rushing_yards_before_contact,
                rush_yac=r.rushing_yards_after_contact, rush_brk_tkl=r.rushing_broken_tackles,
                rush_ybc_att=r.rushing_yards_before_contact / r.carries,
                rush_yac_att=r.rushing_yards_after_contact / r.carries))

    d = _read('rec', y, raw)
    if d is not None and len(d):
        tot = _receiving_totals(y, raw)
        cols = ['receiving_broken_tackles', 'receiving_drop']
        d = d.copy()
        for c in cols:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        g = d.groupby('pfr_player_id')[cols].sum()
        for pid, r in g.iterrows():
            gid = by_pfr.get(pid)
            if not gid:
                continue
            rec, tgt = tot.get(gid, (0.0, 0.0))
            row = dict(rec_brk_tkl=r.receiving_broken_tackles, rec_drop=r.receiving_drop)
            if rec:
                row['rec_rec'] = rec
            if tgt:
                row['rec_drop_percent'] = r.receiving_drop / tgt
            out[(gid, y)].update(row)
    return dict(out)


def validate(y, raw=RAW):
    """Weekly-summed rows against the season file, for a season that has both."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    pl = pd.read_csv(os.path.join(raw, 'players.csv'), low_memory=False)
    by_pfr = {r.pfr_id: r.gsis_id for r in pl.itertuples() if isinstance(r.pfr_id, str)
              and isinstance(r.gsis_id, str)}
    wk = season_rows(y, by_pfr, raw)
    for kind, keys in (('def', ['tgt', 'cmp', 'yds', 'cmp_percent', 'rat', 'dadot', 'prss',
                                'hrry', 'qbkd', 'bltz', 'm_tkl_percent', 'yac']),
                       ('rush', ['att', 'ybc_att', 'yac_att', 'brk_tkl']),
                       ('rec', ['brk_tkl', 'rec', 'drop_percent'])):
        s = pd.read_csv(os.path.join(raw, 'adv_%s.csv' % kind), low_memory=False)
        s = s[s.season == y]
        for k in keys:
            diffs, n = [], 0
            for r in s.to_dict('records'):
                gid = by_pfr.get(r.get('pfr_id'))
                w = wk.get((gid, y), {}).get('%s_%s' % (kind, k))
                v = r.get(k)
                if gid is None or w is None or v is None or v != v:
                    continue
                n += 1
                diffs.append(abs(_f(w) - _f(v)) / max(abs(_f(v)), 1e-9))
            diffs.sort()
            if diffs:
                print('%-5s %-15s n=%4d  median rel diff %.4f  p90 %.4f' % (
                    kind, k, n, diffs[len(diffs) // 2], diffs[int(len(diffs) * .9)]))


if __name__ == '__main__':
    for a in sys.argv[1:]:
        validate(int(a))
