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
    advstats_week_pass_<y>.csv  ->  pass_times_pressured, pass_pressure_pct, pass_times_hit,
                                    pass_times_hurried, pass_bad_throw_pct, pass_times_sacked

Rates are rebuilt from the summed counts, never averaged week to week. Validated against the
2025 season file, where the two agree (see validate() below; run `python3 pfr_week.py 2025`).

The quarterback file was the one left out at first, which is why pressure rate and bad-throw
rate sat blank on every quarterback until spring. Its two rates need a denominator the file
does not print. Pressure rate is pressures over dropbacks, and the dropbacks are the
play-by-play's for the same games (PFR's own, recovered from its printed rate, match them to
within a hundredth of a play on average). Bad-throw rate is over throws that were aimed at
somebody, which is recovered from PFR's printed rate in every game it charted one.

Three things the weekly files do not carry and are therefore left unset in season: batted
balls (def_bats), pocket time and on-target rate.

The counts are also available one game at a time (week_counts), and finish() turns any sum
of them back into a row - which is what puts the charted rows on the week-by-week charts
and in the last-four and last-eight windows.
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


def _receiving_totals(y, raw, weekly=False):
    """Receptions and targets by gsis id (or by (gsis id, week)), from nflverse's weekly
    stat table - the weekly PFR receiving file has broken tackles and drops but not the
    denominators."""
    p = os.path.join(raw, 'wk_%d.csv' % y)
    if not os.path.exists(p):
        return {}
    df = pd.read_csv(p, usecols=['player_id', 'week', 'season_type', 'receptions', 'targets'],
                     low_memory=False)
    df = df[df.season_type == 'REG']
    g = df.groupby(['player_id', 'week'] if weekly else 'player_id')[['receptions', 'targets']].sum()
    return {pid: (float(r.receptions or 0), float(r.targets or 0)) for pid, r in g.iterrows()}


def _qb_dropbacks(y):
    """{(week, gsis_id): (dropbacks, attempts)} from the play-by-play aggregates."""
    import json
    p = os.path.join(os.environ.get('NFL_AGG', 'agg'), 'pbp_%d.json' % y)
    if not os.path.exists(p):
        return {}
    return {(int(r['week']), r['pid']): (float(r.get('db') or 0), float(r.get('att') or 0))
            for r in json.load(open(p)).get('qb', [])}


DEF_COLS = ['def_ints', 'def_targets', 'def_completions_allowed', 'def_yards_allowed',
            'def_receiving_td_allowed', 'def_air_yards_completed', 'def_yards_after_catch',
            'def_times_blitzed', 'def_times_hurried', 'def_times_hitqb', 'def_sacks',
            'def_pressures', 'def_tackles_combined', 'def_missed_tackles', '_ay_t']
RUSH_COLS = ['carries', 'rushing_yards_before_contact', 'rushing_yards_after_contact',
             'rushing_broken_tackles']
REC_COLS = ['receiving_broken_tackles', 'receiving_drop']
PASS_COLS = ['passing_drops', 'passing_bad_throws', 'times_sacked', 'times_blitzed',
             'times_hurried', 'times_hit', 'times_pressured', '_db', '_att', '_aim', '_drp']


def week_counts(y, by_pfr, raw=RAW):
    """{(gsis_id, week): {count: n}} - every charted count, one game at a time.

    Counts only, so any set of games can be added together (a season, the last four, a
    window that runs across New Year) and the rates worked out once at the end by
    finish(). A man has a key for a kind of count only in a game PFR charted him in it.
    """
    out = defaultdict(dict)

    def put(d, cols):
        g = d.groupby(['pfr_player_id', 'week'])[cols].sum()
        for (pid, wk), r in g.iterrows():
            gid = by_pfr.get(pid)
            if gid:
                out[(gid, int(wk))].update({c: float(r[c]) for c in cols})

    d = _read('def', y, raw)
    if d is not None and len(d):
        d = d.copy()
        d['_ay_t'] = pd.to_numeric(d.def_adot, errors='coerce').fillna(0) * \
            pd.to_numeric(d.def_targets, errors='coerce').fillna(0)
        for c in DEF_COLS:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        put(d, DEF_COLS)

    d = _read('rush', y, raw)
    if d is not None and len(d):
        d = d.copy()
        for c in RUSH_COLS:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        put(d, RUSH_COLS)

    d = _read('rec', y, raw)
    if d is not None and len(d):
        d = d.copy()
        for c in REC_COLS:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        put(d, REC_COLS)

    d = _read('pass', y, raw)
    if d is not None and len(d) and 'times_pressured' in d.columns:
        dbs = _qb_dropbacks(y)
        d = d.copy()
        for c in ['passing_drops', 'passing_bad_throws', 'times_sacked', 'times_blitzed',
                  'times_hurried', 'times_hit', 'times_pressured', 'passing_bad_throw_pct',
                  'passing_drop_pct', 'week']:
            d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0)
        gids = d.pfr_player_id.map(by_pfr)
        pair = [dbs.get((int(w), g), (0.0, 0.0)) for w, g in zip(d.week, gids)]
        d['_db'] = [p[0] for p in pair]
        d['_att'] = [p[1] for p in pair]
        # Throws that were aimed at somebody: PFR's own count where its printed rate lets
        # it be recovered, the play-by-play's attempts in a game with no bad throw at all.
        d['_aim'] = (d.passing_bad_throws / d.passing_bad_throw_pct).where(
            d.passing_bad_throw_pct > 0, d._att)
        d['_drp'] = (d.passing_drops / d.passing_drop_pct).where(d.passing_drop_pct > 0, d._att)
        put(d, PASS_COLS)
    return dict(out)


def add_counts(rows):
    """Sum any number of week_counts() rows into one."""
    out = {}
    for c in rows:
        for k, v in c.items():
            out[k] = out.get(k, 0.0) + v
    return out


def finish(c, rec_tot=None):
    """Summed counts -> a row shaped exactly like the all-seasons files' rows.

    `rec_tot` is (receptions, targets) over the same games, from the stat table: the PFR
    receiving file has broken tackles and drops but not what to divide them by.
    """
    row = {}
    if 'def_targets' in c:
        tgt, cmp_, yds = c['def_targets'], c['def_completions_allowed'], c['def_yards_allowed']
        row.update(def_int=c['def_ints'], def_tgt=tgt, def_cmp=cmp_, def_yds=yds,
                   def_td=c['def_receiving_td_allowed'], def_air=c['def_air_yards_completed'],
                   def_yac=c['def_yards_after_catch'], def_bltz=c['def_times_blitzed'],
                   def_hrry=c['def_times_hurried'], def_qbkd=c['def_times_hitqb'],
                   def_sk=c['def_sacks'], def_prss=c['def_pressures'],
                   def_comb=c['def_tackles_combined'], def_m_tkl=c['def_missed_tackles'])
        if tgt:
            row['def_cmp_percent'] = cmp_ / tgt
            row['def_yds_tgt'] = yds / tgt
            row['def_rat'] = passer_rating(cmp_, tgt, yds, c['def_receiving_td_allowed'], c['def_ints'])
            row['def_dadot'] = c['_ay_t'] / tgt
        if cmp_:
            row['def_yds_cmp'] = yds / cmp_
        att = c['def_tackles_combined'] + c['def_missed_tackles']
        if att:
            row['def_m_tkl_percent'] = c['def_missed_tackles'] / att
    if c.get('carries'):
        n = c['carries']
        row.update(rush_att=n, rush_ybc=c['rushing_yards_before_contact'],
                   rush_yac=c['rushing_yards_after_contact'],
                   rush_brk_tkl=c['rushing_broken_tackles'],
                   rush_ybc_att=c['rushing_yards_before_contact'] / n,
                   rush_yac_att=c['rushing_yards_after_contact'] / n)
    if 'receiving_drop' in c:
        rec, tgt = rec_tot or (0.0, 0.0)
        row.update(rec_brk_tkl=c['receiving_broken_tackles'], rec_drop=c['receiving_drop'])
        if rec:
            row['rec_rec'] = rec
        if tgt:
            row['rec_drop_percent'] = c['receiving_drop'] / tgt
    if c.get('_db'):
        row.update(pass_times_pressured=c['times_pressured'], pass_times_hit=c['times_hit'],
                   pass_times_hurried=c['times_hurried'], pass_times_sacked=c['times_sacked'],
                   pass_times_blitzed=c['times_blitzed'], pass_prs_db=c['_db'],
                   pass_pressure_pct=c['times_pressured'] / c['_db'] * 100.0,
                   pass_bad_throws=c['passing_bad_throws'], pass_drops=c['passing_drops'])
        if c.get('_att'):
            row['pass_pass_attempts'] = c['_att']
        if c.get('_aim'):
            row['pass_bad_throw_pct'] = c['passing_bad_throws'] / c['_aim'] * 100.0
        if c.get('_drp'):
            row['pass_drop_pct'] = c['passing_drops'] / c['_drp'] * 100.0
    return row


def season_rows(y, by_pfr, raw=RAW):
    """{(gsis_id, y): {'def_tgt': .., 'rush_yac_att': .., ...}} for one season, or {}."""
    per = defaultdict(list)
    for (gid, _), c in week_counts(y, by_pfr, raw).items():
        per[gid].append(c)
    tot = _receiving_totals(y, raw)
    out = {}
    for gid, rows in per.items():
        row = finish(add_counts(rows), tot.get(gid))
        if row:
            out[(gid, y)] = row
    return out


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
                       ('rec', ['brk_tkl', 'rec', 'drop_percent']),
                       ('pass', ['times_pressured', 'pressure_pct', 'times_hit', 'times_hurried',
                                 'bad_throw_pct', 'times_blitzed'])):
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
