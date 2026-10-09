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

    advstats_week_pass_<y>.csv  ->  pass_times_pressured, pass_pressure_pct, pass_bad_throw_pct,
                                    pass_times_hurried, pass_times_hit

The passing file is the quarterback's side of the same charting, and it was not being read
at all, which left pressure rate faced and bad throw % blank from September to February.
It gives counts and a per-game rate, not the rate's denominator, so the denominator is
backed out of the two (pressures / pressure rate) and summed; a game with no pressures at
all falls back to his attempts plus sacks that day. Against 2025's season file, for the 41
quarterbacks who spent the year with one team and threw 150 passes: r = 0.98 for pressure
rate, 0.96 for bad throw %, both within half a point on average.

Three things the weekly files do not carry and are therefore left unset in season: batted
balls (def_bats), pocket time and on-target %.

week_rows() returns the same rows one week at a time, for the week-by-week charts.
"""
import os, sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from teams import canon

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


_CACHE = {}


def _read(kind, y, raw, weeks=None):
    key = (kind, y, raw)
    if key not in _CACHE:
        p = os.path.join(raw, 'advw_%s_%d.csv' % (kind, y))
        if not os.path.exists(p) or os.path.getsize(p) < 200:
            _CACHE[key] = None
        else:
            df = pd.read_csv(p, low_memory=False)
            if 'game_type' in df.columns:
                df = df[df.game_type == 'REG']
            df = df[df.pfr_player_id.notna()].copy()
            for c in ('team', 'opponent'):
                if c in df.columns:
                    df[c] = df[c].map(canon)         # OAK is LV, as the play-by-play has it
            _CACHE[key] = df
    df = _CACHE[key]
    if df is None or weeks is None:
        return df
    return df[df.week.isin(weeks)]


def _weekly_table(y, raw):
    key = ('wk', y, raw)
    if key not in _CACHE:
        p = os.path.join(raw, 'wk_%d.csv' % y)
        if not os.path.exists(p):
            _CACHE[key] = None
        else:
            df = pd.read_csv(p, usecols=['player_id', 'season_type', 'week', 'receptions', 'targets',
                                         'attempts', 'sacks_suffered', 'def_tackles_solo',
                                         'def_tackle_assists'], low_memory=False)
            _CACHE[key] = df[df.season_type == 'REG']
    return _CACHE[key]


def _receiving_totals(y, raw, weeks=None):
    """Receptions and targets by gsis id, from nflverse's weekly stat table - the weekly
    PFR receiving file has broken tackles and drops but not the denominators."""
    df = _weekly_table(y, raw)
    if df is None:
        return {}
    if weeks is not None:
        df = df[df.week.isin(weeks)]
    g = df.groupby('player_id')[['receptions', 'targets']].sum()
    return {pid: (float(r.receptions or 0), float(r.targets or 0)) for pid, r in g.iterrows()}


def _tackle_totals(y, raw, weeks=None):
    """Tackles by gsis id, from nflverse's weekly stat table. PFR's weekly file only has a
    row for a defender on a day he was charted doing something else (a target, a pressure,
    a missed tackle), so its own tackle column adds up to 85% of a season's: used as the
    denominator it doubled a quiet lineman's missed-tackle rate. Solo plus assists from
    the stat table agrees with PFR's season count to within a tackle or two."""
    df = _weekly_table(y, raw)
    if df is None:
        return {}
    if weeks is not None:
        df = df[df.week.isin(weeks)]
    g = df.groupby('player_id')[['def_tackles_solo', 'def_tackle_assists']].sum()
    return {pid: float((r.def_tackles_solo or 0) + (r.def_tackle_assists or 0)) for pid, r in g.iterrows()}


def _passing_rows(y, by_pfr, raw, weeks, out):
    """The quarterback's side: pressures, hurries, hits and bad throws, as season rows."""
    d = _read('pass', y, raw, weeks)
    if d is None or not len(d):
        return
    d = d.copy()
    cols = ['times_pressured', 'times_pressured_pct', 'times_hurried', 'times_hit',
            'times_sacked', 'times_blitzed', 'passing_bad_throws', 'passing_bad_throw_pct',
            'passing_drops']
    for c in cols:
        d[c] = pd.to_numeric(d.get(c), errors='coerce').fillna(0) if c in d.columns else 0.0
    # what he threw and was sacked that day, for the games the rate cannot be turned around on
    wk = _weekly_table(y, raw)
    back = {}
    if wk is not None:
        for r in wk[['player_id', 'week', 'attempts', 'sacks_suffered']].itertuples(index=False):
            back[(r.player_id, int(r.week))] = (float(r.attempts or 0) if r.attempts == r.attempts else 0.0,
                                                float(r.sacks_suffered or 0) if r.sacks_suffered == r.sacks_suffered else 0.0)
    acc = defaultdict(lambda: defaultdict(float))
    for r in d.itertuples(index=False):
        gid = by_pfr.get(r.pfr_player_id)
        if not gid:
            continue
        att, sk = back.get((gid, int(r.week)), (0.0, 0.0))
        a = acc[gid]
        a['prs'] += r.times_pressured
        a['prs_den'] += (r.times_pressured / r.times_pressured_pct) if r.times_pressured_pct > 0 else (att + sk)
        a['bad'] += r.passing_bad_throws
        a['bad_den'] += (r.passing_bad_throws / r.passing_bad_throw_pct) if r.passing_bad_throw_pct > 0 else att
        a['hrry'] += r.times_hurried
        a['hit'] += r.times_hit
        a['sk'] += r.times_sacked
        a['g'] += 1
    for gid, a in acc.items():
        row = dict(pass_times_pressured=a['prs'], pass_times_hurried=a['hrry'],
                   pass_times_hit=a['hit'], pass_times_sacked=a['sk'], pass_bad_throws=a['bad'],
                   pass_pressure_den=a['prs_den'], pass_weekly=1)
        if a['prs_den'] >= 1:
            row['pass_pressure_pct'] = a['prs'] / a['prs_den'] * 100.0     # the season file's scale
        if a['bad_den'] >= 1:
            row['pass_bad_throw_pct'] = a['bad'] / a['bad_den'] * 100.0
        out[(gid, y)].update(row)


def team_pressures(y, raw=RAW):
    """{(week, team): pressures its quarterbacks faced that game}, for the offensive line.

    Nothing public says which blocker gave up a pressure, in season or out of it. This is
    the unit's count, from the same charting crew as the quarterback's row, and it is the
    only pressure count that exists while a season is being played."""
    d = _read('pass', y, raw)
    if d is None or not len(d):
        return {}
    d = d.copy()
    d['times_pressured'] = pd.to_numeric(d.times_pressured, errors='coerce').fillna(0)
    g = d.groupby(['week', 'team']).times_pressured.sum()
    return {(int(w), t): float(v) for (w, t), v in g.items()}


def team_pressures_credited(y, raw=RAW):
    """{(week, team): pressures credited to that defense's own players that game}.

    A pass rusher's share of his team's pressures has to be taken against a count made
    the way his own was. The quarterback's "times pressured" is a different count by the
    same crew - one pressure on the passer can be two players' pressures - and dividing
    one by the other made a defense's shares add up to 108%."""
    d = _read('def', y, raw)
    if d is None or not len(d) or 'team' not in d.columns:
        return {}
    d = d.copy()
    d['def_pressures'] = pd.to_numeric(d.def_pressures, errors='coerce').fillna(0)
    g = d.groupby(['week', 'team']).def_pressures.sum()
    return {(int(w), t): float(v) for (w, t), v in g.items()}


def season_rows(y, by_pfr, raw=RAW, weeks=None):
    """{(gsis_id, y): {'def_tgt': .., 'rush_yac_att': .., ...}} for one season, or {}.
    `weeks` holds it to those weeks, which is how the week-by-week charts get their rows."""
    out = defaultdict(dict)
    _passing_rows(y, by_pfr, raw, weeks, out)

    d = _read('def', y, raw, weeks)
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
        tackles = _tackle_totals(y, raw, weeks)
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
            att = max(tackles.get(gid, 0.0), r.def_tackles_combined) + r.def_missed_tackles
            if att:
                row['def_m_tkl_percent'] = r.def_missed_tackles / att
            out[(gid, y)].update(row)

    d = _read('rush', y, raw, weeks)
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

    d = _read('rec', y, raw, weeks)
    if d is not None and len(d):
        tot = _receiving_totals(y, raw, weeks)
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


def week_rows(y, by_pfr, raw=RAW):
    """{week: {(gsis_id, y): row}} - season_rows(), one week at a time."""
    weeks = set()
    for kind in ('def', 'rush', 'rec', 'pass'):
        d = _read(kind, y, raw)
        if d is not None and len(d):
            weeks |= set(int(w) for w in d.week.unique())
    return {w: season_rows(y, by_pfr, raw, weeks=[w]) for w in sorted(weeks)}


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
                       ('pass', ['times_pressured', 'pressure_pct', 'bad_throw_pct',
                                 'times_hurried', 'times_hit'])):
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
