"""Everything the October 2026 additions need that build_player was not already handed.

One idea runs through this file: a player-week row of plain additive counters. A season
is those rows added up, a game is one of them, the last four weeks are four of them.
build_player turns whichever sum it is handed into rates, so the season card, the
game-by-game line and the recent-form view are the same arithmetic over different windows
and nothing here is a second implementation of a metric.

What a player-week row carries (all of it optional - a 2003 row has almost none of it):

  snaps        off, dfn, st and his unit's totals that game (snap counts, 2012 on)
  team shares  t_car, t_tgt ... his team's totals in the games he played, so "share of
               team carries" has the game he dressed for and never touched the ball in
  stand-in     e_pblk, e_sk ... his team's game totals x his share of the offensive snaps.
               This is what lights up a lineman's card while a season is being played:
               the participation file, which says who was on the field for each play,
               is published after the Super Bowl. Against the 2025 participation file
               the stand-in lands at r = 0.99 (sack rate, EPA per dropback) and 0.97
               (rush success, yards per carry, stuffed rate) for 223 linemen.
  charted      c_prs, c_db: PFR's weekly count of pressures on his quarterback x his
               snap share. A different crew from the participation file's was_pressure
               (r = 0.73), so it is its own row on the card and is never spliced in.
  gaps         gp_n, gp_s ... designed runs through the gap his spot on the line owns
  pass snaps   e_ops, e_dps: snaps x the share of that game's plays that were dropbacks.
               ops, dps: the true counts, in seasons the participation file exists for.
  tackles      rtk, rstop, ptk ... from the play-by-play's own tackle credits
  kicks        ko, pu, fg_wpa, kr_n, pr_n ...
  drives       drv, drv_pts ... for the quarterback who led them
  fantasy      xfp, xtd ... the ffopportunity expected-points model (2006 on)

Season-only facts (a contract, a depth-chart role, on/off splits, man or zone) are not
additive and live in Season.only(gid).
"""
import csv, json, os
from collections import defaultdict

import pandas as pd

import pfr_week
import roles_agg
from teams import canon

OLINE = ('OL', 'OT', 'OG', 'OC')
# which gaps a spot on the line owns: the tackle gets his own gap and the edge outside it
SPOT_GAPS = {'LT': ('le', 'lt'), 'LG': ('lg',), 'C': ('md',), 'RG': ('rg',), 'RT': ('rt', 're')}
INSIDE, OUTSIDE = ('md', 'lg', 'rg'), ('lt', 'rt', 'le', 're')
BANDS = (('b', 'behind the line'), ('s', '0-9'), ('m', '10-19'), ('d', '20+'))
DIRS = ('l', 'm', 'r')

# True pass-play snaps / the naive estimate, by position: every player with 100 or more
# estimated pass-play snaps in the 2024 and 2025 participation files, pooled. The two years
# agree to the second decimal at every position. Used only for a player with no finished
# season of his own to learn the ratio from (a rookie, mostly).
PASS_RATIO = {'ED': 0.969, 'DI': 0.890, 'LB': 0.915, 'CB': 0.973, 'S': 0.960,
              'WR': 1.000, 'TE': 0.896, 'RB': 0.916}
# The same for designed-run snaps on defense (true count / snaps x the offense's run share).
# Pooled 2023-2025, every defender with 60 or more estimated run snaps; the three years
# agree to the second decimal. Both ratios sit under 1 for most positions because a snap
# count includes the three or four penalties, kneel-downs and spikes a game that are not plays.
RUN_RATIO = {'ED': 0.898, 'DI': 1.018, 'LB': 0.981, 'CB': 0.896, 'S': 0.911}

RESERVE = {'R01': 'Injured reserve', 'R48': 'Injured reserve (designated to return)',
           'R04': 'Physically unable to perform', 'R05': 'Non-football injury list',
           'R23': 'Injured reserve', 'R06': 'Suspended', 'R30': 'Commissioner exempt list'}
STATUS = {'INA': 'Inactive', 'DEV': 'Practice squad', 'CUT': 'Released', 'RET': 'Retired',
          'RES': 'Reserve list', 'SUS': 'Suspended', 'EXE': 'Exempt list'}


def _f(x, default=0.0):
    try:
        v = float(x)
        return v if v == v else default
    except (TypeError, ValueError):
        return default


def _json(path):
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


class Season(object):
    """One season's player-week counters and season-only facts."""

    def __init__(self, y, by_pfr, raw, agg, pmake=None, prior_ratio=None, swaps=None):
        self.y, self.raw, self.agg = y, raw, agg
        self.by_pfr = by_pfr
        self.swaps = swaps or {}             # (gid, week) -> team, where the stat table has it wrong
        self.pmake = pmake
        self.prior_ratio = prior_ratio or {}
        self.wk = defaultdict(dict)          # gid -> {week: counters}
        self.team = {}                       # (gid, week) -> team
        self.snap_pos = {}                   # gid -> the position snap counts list him at
        self.snap_team = {}                  # gid -> the team he took the most snaps for
        self.snap_name = {}
        self.has_part = False                # is there a participation file for this season?
        self.lg = {}
        self.tm = {}                         # (week, team) -> that team's offense that week
        self.spots = _json(os.path.join(agg, 'spot_%d.json' % y)) or {}
        self.roles = _json(os.path.join(agg, 'roles_%d.json' % y)) or {}
        # corner or safety that season, from the NFL's weekly depth charts (2001-2024)
        self.db_spot = roles_agg.secondary_spots(y, raw)
        self._only = {}
        self._load()

    # ------------------------------------------------------------------ loading
    def _load(self):
        y = self.y
        pbp = _json(os.path.join(self.agg, 'pbp_%d.json' % y)) or {}
        self.lg = pbp.get('lg') or {}
        tm = {(int(r['week']), r['tm']): r for r in pbp.get('tm', [])}
        self.tm = tm
        faced = {(int(r['week']), r['opp']): r for r in pbp.get('tm', [])}
        self.faced = faced
        ftn = _json(os.path.join(self.agg, 'ftn_%d.json' % y)) or {}
        fl = {(int(r['week']), r['tm']): r for r in ftn.get('line', [])}
        self.charted_weeks = {int(r['week']) for r in ftn.get('line', [])}
        tp = pfr_week.team_pressures(y, self.raw)            # what each offense's passers faced
        dp = pfr_week.team_pressures_credited(y, self.raw)   # what each defense's players were credited with
        self.pfr_weeks = set()

        snap, app = self._snaps()
        self._stat_weeks(app)

        side = defaultdict(dict)             # (gid, week) -> counters from the small tables
        for name in ('def', 'kick', 'punt', 'drv', 'dpi'):
            for r in pbp.get(name, []):
                k = (r['pid'], int(r['week']))
                for f, v in r.items():
                    if f not in ('pid', 'week'):
                        side[k][f] = side[k].get(f, 0.0) + _f(v)
        for r in pbp.get('ret', []):
            k, pre = (r['pid'], int(r['week'])), r['k']         # 'kr' or 'pr'
            for f in ('n', 'yds', 'epa', 'td', 'fum'):
                side[k][pre + '_' + f] = side[k].get(pre + '_' + f, 0.0) + _f(r.get(f))
        for r in pbp.get('fg', []):
            k = (r['pid'], int(r['week']))
            c = side[k]
            c['fg_wpa'] = c.get('fg_wpa', 0.0) + _f(r.get('wpa'))
            # A blocked kick is left out, as the all-kicks row leaves it out: the curve is
            # built from makes and misses only, so scoring a block as a miss against it
            # put the whole league under water by two points in a hundred.
            if r.get('out') and self.pmake and not r.get('blk'):
                p = self.pmake(y, int(r['dist']))
                if p is not None:
                    c['fgo_n'] = c.get('fgo_n', 0.0) + 1.0
                    c['fgo_over'] = c.get('fgo_over', 0.0) + (1.0 if r.get('made') else 0.0) - p
        self._weekly_pfr(side)
        self._ffopp(side)

        onf = _json(os.path.join(self.agg, 'onfield_%d.json' % y)) or {}
        self.onf = onf
        true_wk = {(r['pid'], int(r['week'])): r for r in onf.get('wk', [])}
        self.has_part = bool(true_wk)

        for (gid, week), team in app.items():
            c = {'gm': 1.0}
            self.team[(gid, week)] = team
            T, F, L = tm.get((week, team)), faced.get((week, team)), fl.get((week, team))
            if T:
                for src, dst in (('tm_car', 't_car'), ('tm_i10', 't_i10'), ('tm_i5', 't_i5'),
                                 ('tm_tgt', 't_tgt'), ('tm_ay', 't_ay'), ('tm_ez', 't_ez'), ('tm_recy', 't_recy'),
                                 ('tm_rectd', 't_rectd'), ('tm_recfd', 't_recfd')):
                    c[dst] = _f(T.get(src))
                p = dp.get((week, team))
                if p is not None:
                    c['t_dprs'] = p
            if L:
                c['t_rd1'] = _f(L.get('tm_rd1'))
            if F:
                c['t_dsk'] = _f(F.get('sk'))
            s = snap.get((gid, week))
            if s:
                c.update(off=s['off'], dfn=s['dfn'], st=s['st'], offt=s['offt'],
                         deft=s['deft'], stt=s['stt'])
                if s['off'] > 0:
                    c['gm_off'] = 1.0
                if s['dfn'] > 0:
                    c['gm_def'] = 1.0
                    # the offenses he faced are the ones he was on the field against: a
                    # week of special teams only is not a week of defense
                    if T and T.get('sos_o') is not None:
                        c['so_x'], c['so_n'] = _f(T['sos_o']), 1.0
                if s['off'] > 0 and s['offt'] > 0 and T and _f(T.get('plays')) > 0:
                    w = min(1.0, s['off'] / s['offt'])
                    for src, dst in (('db', 'e_pblk'), ('run', 'e_rblk'), ('sk', 'e_sk'),
                                     ('pepa', 'e_pepa'), ('psucc', 'e_psucc'), ('repa', 'e_repa'),
                                     ('ryds', 'e_ryds'), ('rsucc', 'e_rsucc'),
                                     ('stuff', 'e_stuff'), ('hit', 'e_hit')):
                        c[dst] = w * _f(T.get(src))
                    if L:
                        for f in ('rush_n', 'rush_sum', 'box_n', 'box_sum'):
                            c['e_' + f] = w * _f(L.get(f))
                    p = tp.get((week, team))
                    if p is not None:
                        c['c_prs'], c['c_db'] = w * p, w * _f(T.get('db'))
                    gaps = SPOT_GAPS.get(self.spots.get(gid))
                    if gaps:
                        c['gp_n'] = w * sum(_f(T.get('g_' + g)) for g in gaps)
                        c['gp_s'] = w * sum(_f(T.get('gs_' + g)) for g in gaps)
                        c['gp_y'] = w * sum(_f(T.get('gy_' + g)) for g in gaps)
                        c['gp_t'] = w * sum(_f(T.get('gt_' + g)) for g in gaps)
                    c['e_ops'] = s['off'] * _f(T.get('db')) / _f(T.get('plays'))
                if s['dfn'] > 0 and F and _f(F.get('plays')) > 0:
                    c['e_dps'] = s['dfn'] * _f(F.get('db')) / _f(F.get('plays'))
                    c['e_drs'] = s['dfn'] * _f(F.get('run')) / _f(F.get('plays'))
            t = true_wk.get((gid, week))
            if t:
                for f in ('ops', 'ors', 'dps', 'drs'):
                    if f in t:
                        c[f] = _f(t[f])
            c.update(side.get((gid, week), {}))
            if week in self.pfr_weeks:
                c['pfw'] = 1.0               # the charting crew has been through this week
            if (gid, week) in self.wsk:
                c['w_sk'] = self.wsk[(gid, week)]
            self.wk[gid][week] = c
        # a man can be in the small tables and nowhere else (a kicker with no stat line)
        for (gid, week), c in side.items():
            if week not in self.wk[gid]:
                self.wk[gid][week] = dict(c, gm=1.0)

    def _snaps(self):
        """Snap counts by player-game, with the unit totals each share is taken against."""
        p = os.path.join(self.raw, 'snaps_%d.csv' % self.y)
        snap, app = {}, {}
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            return snap, app
        df = pd.read_csv(p, low_memory=False)
        if 'game_type' in df.columns:
            df = df[df.game_type == 'REG']
        for c in ('offense_snaps', 'defense_snaps', 'st_snaps', 'st_pct'):
            df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0.0)
        key = ['game_id', 'team']
        offt = df.groupby(key).offense_snaps.max()
        deft = df.groupby(key).defense_snaps.max()
        # nobody plays every special-teams snap, so the unit total is backed out of each
        # man's count and share, and the middle answer taken
        st = df[df.st_pct > 0]
        stt = (st.st_snaps / st.st_pct).groupby([st.game_id, st.team]).median().round()
        idx = df.set_index(key).index
        df['offt'], df['deft'], df['stt'] = idx.map(offt), idx.map(deft), idx.map(stt)
        tot = defaultdict(lambda: defaultdict(float))
        posn = defaultdict(lambda: defaultdict(float))
        for r in df.itertuples(index=False):
            gid = self.by_pfr.get(r.pfr_player_id)
            if not gid:
                continue
            o, dd, s = float(r.offense_snaps), float(r.defense_snaps), float(r.st_snaps)
            if not (o or dd or s):
                continue
            week = int(r.week)
            team = canon(r.team)
            snap[(gid, week)] = dict(off=o, dfn=dd, st=s, offt=_f(r.offt), deft=_f(r.deft),
                                     stt=_f(r.stt))
            app[(gid, week)] = team
            tot[gid][team] += o + dd + s
            if isinstance(r.position, str):
                posn[gid][r.position] += o + dd + s
            self.snap_name[gid] = r.player
        for gid, t in tot.items():
            self.snap_team[gid] = max(sorted(t), key=lambda k: t[k])
        for gid, t in posn.items():
            self.snap_pos[gid] = max(sorted(t), key=lambda k: t[k])
        self.snap = snap
        return snap, app

    def _stat_weeks(self, app):
        """Weeks he has a stat line for, which is every week he played before snap counts."""
        p = os.path.join(self.raw, 'wk_%d.csv' % self.y)
        self.wsk = {}
        if not os.path.exists(p):
            return
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                if (r.get('season_type') or 'REG') != 'REG':
                    continue
                gid, team = (r.get('player_id') or '').strip(), canon((r.get('team') or '').strip())
                if not gid or not team:
                    continue
                week = int(_f(r.get('week')))
                team = self.swaps.get((gid, week), team)
                app.setdefault((gid, week), team)
                sk = _f(r.get('def_sacks'))
                if sk:
                    self.wsk[(gid, week)] = sk

    def _weekly_pfr(self, side):
        """His own charted pressures by week, to set against his team's that week."""
        d = pfr_week._read('def', self.y, self.raw)
        if d is None or not len(d):
            return
        self.pfr_weeks = set(int(w) for w in d.week.unique())
        for r in d[['pfr_player_id', 'week', 'def_pressures']].itertuples(index=False):
            gid = self.by_pfr.get(r.pfr_player_id)
            v = _f(r.def_pressures)
            if gid and v:
                k = (gid, int(r.week))
                side[k]['w_prs'] = side[k].get('w_prs', 0.0) + v

    def _ffopp(self, side):
        """Expected fantasy points from the ffopportunity model: what an average player
        would have scored with exactly his carries, targets and throws."""
        p = os.path.join(self.raw, 'ep_week_%d.csv' % self.y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            return
        cols = ['week', 'player_id', 'total_fantasy_points', 'total_fantasy_points_exp',
                'rec_touchdown', 'rush_touchdown', 'pass_touchdown',
                'rec_touchdown_exp', 'rush_touchdown_exp', 'pass_touchdown_exp']
        df = pd.read_csv(p, usecols=lambda c: c in cols, low_memory=False)
        # The file runs on into January. Week 18 is the regular season from 2021 and the
        # wild-card round before it, so "up to 18" let a playoff game into the expected
        # points of every man on a wild-card team from 2006 to 2020.
        last = 18 if self.y >= 2021 else 17
        for r in df.to_dict('records'):
            gid = r.get('player_id')
            if not isinstance(gid, str):
                continue
            week = int(_f(r.get('week')))
            if week < 1 or week > last:
                continue
            c = side[(gid, week)]
            c['xfp'] = c.get('xfp', 0.0) + _f(r.get('total_fantasy_points_exp'))
            c['xfp_fp'] = c.get('xfp_fp', 0.0) + _f(r.get('total_fantasy_points'))
            c['xfp_n'] = 1.0
            c['xtd'] = c.get('xtd', 0.0) + sum(_f(r.get(k)) for k in
                                                 ('rec_touchdown_exp', 'rush_touchdown_exp', 'pass_touchdown_exp'))
            c['xtd_td'] = c.get('xtd_td', 0.0) + sum(_f(r.get(k)) for k in
                                                       ('rec_touchdown', 'rush_touchdown', 'pass_touchdown'))

    # ------------------------------------------------------------------ windows
    def weeks_of(self, gid):
        return sorted(self.wk.get(gid, {}))

    def roll(self, gid, weeks=None):
        """His counters added up over `weeks` (every week he played when None)."""
        rows = self.wk.get(gid)
        if not rows:
            return {}
        out = defaultdict(float)
        for w, c in rows.items():
            if weeks is not None and w not in weeks:
                continue
            for k, v in c.items():
                out[k] += v
        x = dict(out)
        if x:
            x['_part'] = self.has_part
            x['_ratio'] = self.prior_ratio.get(gid)
        return x

    def pass_ratio(self, gid):
        """True pass-play snaps over the naive estimate, for a finished season: what next
        season's estimate is corrected by. None where there is too little to go on."""
        if not self.has_part:
            return None
        x = self.roll(gid)
        for true, est in (('dps', 'e_dps'), ('ops', 'e_ops')):
            if x.get(est, 0) >= 100 and x.get(true):
                return round(min(1.6, max(0.4, x[true] / x[est])), 3)
        return None

    # ------------------------------------------------------------------ season-only facts
    def only(self, gid):
        """What does not add up week by week: on/off splits, man or zone, with and without,
        the line he plays on. Keyed once, the first time it is asked for."""
        if not self._only:
            self._build_only()
        return self._only.get(gid, {})

    def _build_only(self):
        o = defaultdict(dict)
        onf = self.onf
        dteams = onf.get('dteams') or {}
        for r in onf.get('def', []):
            e = o[r['pid']]
            e.setdefault('ddef', []).append(r)
        for gid, e in o.items():
            e['dteams'] = dteams
        for r in onf.get('qbmz', []):
            o[r['pid']]['qbmz'] = r
        for r in onf.get('recmz', []):
            o[r['pid']]['recmz'] = r

        # with and without: his team's offense in the games he played against the games
        # it played without him, for the team he took most of his snaps with
        team_weeks = defaultdict(dict)
        for (week, team), r in self.tm.items():
            team_weeks[team][week] = r
        for gid, rows in self.wk.items():
            team = self.snap_team.get(gid)
            if not team:
                continue
            mine = {w for w, c in rows.items()
                    if c.get('gm_off') and self.team.get((gid, w)) == team}
            if not mine:
                continue
            a = b = an = bn = 0.0
            ga = gb = 0
            for w, r in team_weeks[team].items():
                if w in mine:
                    a += _f(r.get('epa')); an += _f(r.get('plays')); ga += 1
                else:
                    b += _f(r.get('epa')); bn += _f(r.get('plays')); gb += 1
            if ga >= 4 and gb >= 2 and an and bn:
                o[gid]['gwo'] = a / an - b / bn
                o[gid]['gwo_n'] = gb

        # continuity: how much of his team's line snaps its five busiest linemen took
        line = defaultdict(lambda: defaultdict(float))
        for gid, pos in self.snap_pos.items():
            if pos not in ('T', 'G', 'C', 'OT', 'OG', 'OL'):
                continue
            for w, c in self.wk.get(gid, {}).items():
                if c.get('off'):
                    line[self.team.get((gid, w))][gid] += c['off']
        cont = {}
        for team, m in line.items():
            tot = sum(m.values())
            if tot:
                cont[team] = sum(sorted(m.values(), reverse=True)[:5]) / tot * 100.0
        for gid, pos in self.snap_pos.items():
            if pos in ('T', 'G', 'C', 'OT', 'OG', 'OL') and self.snap_team.get(gid) in cont:
                o[gid]['linecont'] = cont[self.snap_team[gid]]
        self._only = dict(o)

    # ------------------------------------------------------------------ snap-only players
    def snap_only(self, have):
        """Players who took a snap this season and have no line in the stat table: most
        of the offensive line, and anyone who has not yet recorded a tackle or a catch.
        Returns stat-table-shaped rows so the build can treat them like everybody else."""
        out = []
        for gid in sorted(self.snap_team):
            if gid in have:
                continue
            c = self.roll(gid)
            if not (c.get('off') or c.get('dfn') or c.get('st')):
                continue
            out.append(dict(player_id=gid, position=self.snap_pos.get(gid),
                            recent_team=self.snap_team[gid], games=0,
                            player_display_name=self.snap_name.get(gid), _snap_only=True))
        return out


# ---------------------------------------------------------------------- one-off loaders
def load_status(y, raw):
    """{gid: label} for everyone not on the active roster in the latest week on file.
    Only meaningful for the season being played."""
    p = os.path.join(raw, 'roster_week_%d.csv' % y)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return {}
    df = pd.read_csv(p, usecols=lambda c: c in ('gsis_id', 'week', 'game_type', 'status',
                                                'status_description_abbr', 'team'),
                     low_memory=False)
    df = df[df.gsis_id.notna()]
    if 'game_type' in df.columns:
        df = df[df.game_type == 'REG']
    if not len(df):
        return {}
    last = df.week.max()
    out = {}
    for r in df[df.week == last].itertuples(index=False):
        st = (r.status or '').strip() if isinstance(r.status, str) else ''
        if not st or st == 'ACT':
            continue
        ab = r.status_description_abbr if isinstance(r.status_description_abbr, str) else ''
        label = RESERVE.get(ab) if st == 'RES' else None
        out[r.gsis_id] = label or STATUS.get(st) or 'Not on the active roster'
    return out


_CONTRACTS = {}


def load_contracts(raw):
    """{gid: [(year_signed, years, apy_in_millions, cap_share_pct), ...]} from Over the Cap,
    by way of nflverse. Coverage is thin before about 2013."""
    if raw in _CONTRACTS:
        return _CONTRACTS[raw]
    p = os.path.join(raw, 'contracts.parquet')
    out = defaultdict(list)
    if os.path.exists(p):
        df = pd.read_parquet(p, columns=['gsis_id', 'year_signed', 'years', 'apy', 'apy_cap_pct', 'value'])
        df = df[df.gsis_id.notna() & df.year_signed.notna()]
        for r in df.itertuples(index=False):
            apy = _f(r.apy)
            if apy <= 0:
                continue
            out[r.gsis_id].append((int(r.year_signed), max(1, int(_f(r.years, 1))), apy,
                                   _f(r.apy_cap_pct) * 100.0))
    for v in out.values():
        v.sort()
    _CONTRACTS[raw] = dict(out)
    return _CONTRACTS[raw]


def contract_for(contracts, gid, y):
    """The deal in force in season y: the most recent one signed by then and not yet run
    out. A deal signed in March covers that autumn.

    An extension's years are the new ones, and they start when the old deal ends, not
    when the pen comes out: Christian McCaffrey's two-year extension of 2024 runs through
    2027 because the deal it extends ran through 2025. Counting from the signing left him,
    and twenty others a season, with no contract at all in the year they were being paid."""
    best, end = None, None
    for signed, years, apy, cap in contracts.get(gid, ()):
        end = signed + years + (max(0, end - signed) if end is not None else 0)
        if signed <= y < end:
            best = (apy, cap)
    return best


def load_prior_ratio(path, season):
    """{gid: pass-snap ratio} from a built data file's `psr` fields for one season."""
    j = _json(path) if path else None
    if not j:
        return {}
    blk = (j.get('data') or {}).get(str(season)) or {}
    return {p['id']: p['psr'] for p in blk.get('players', []) if p.get('psr')}


# ---------------------------------------------------------------------- the metrics
def band(row, pre, b):
    return sum(_f(row.get('%s_%s%s' % (pre, b, d))) for d in DIRS)


def est_pass_snaps(x, pos, true_key, est_key):
    """(pass-play snaps, is it an estimate). True where the participation file exists."""
    if x.get('_part'):
        v = x.get(true_key)
        return (v, False) if v else (None, False)
    e = x.get(est_key)
    if not e:
        return None, True
    ratio = x.get('_ratio') or PASS_RATIO.get(pos, 1.0)
    return e * ratio, True


def add_metrics(m, d, r, pos, y, G, x, qb, rush, rec, pens, fqb, frush, frec, pf, ng,
                off_s, def_s, lg, T, num, live=False):
    """The October 2026 rows, written into m (values) and d (sample sizes) in place.

    T is the tier table; num is build.num. `live` is true for a season still being played.
    Every block checks for its own inputs, so an old season simply gets fewer rows."""
    x = x or {}
    lg = lg or {}
    att = num(r.get('attempts'), 0) or 0
    car = num(r.get('carries'), 0) or 0
    tgt = num(r.get('targets'), 0) or 0

    # ---------------------------------------------------------------- context
    if pens and G:
        m['offsideg'] = pens.get('pen_off', 0.0) / G
        m['rtpg'] = pens.get('pen_rtp', 0.0) / G
        m['covpen'] = pens.get('pen_cov', 0.0) / G
        m['covpenyds'] = pens.get('pen_cov_yds', 0.0) / G
        m['penydg'] = pens.get('pen_yds', 0.0) / G
        m['penstall'] = pens.get('pen_stall', 0.0) / G
        if off_s:
            m['pen100'] = pens.get('pen', 0.0) / off_s * 100.0
    elif G and x.get('gm'):
        # No flag all season is a zero, not a blank: before this, a lineman who was never
        # penalized had no row at all and the percentile ranked only the flagged.
        for k in ('offsideg', 'rtpg', 'covpen', 'covpenyds', 'penydg', 'penstall'):
            m[k] = 0.0
        if off_s:
            m['pen100'] = 0.0
    if x.get('stt'):
        m['stshr'] = min(100.0, x.get('st', 0.0) / x['stt'] * 100.0)
    if G and (x.get('sttk') or x.get('st')):
        m['sttk'] = x.get('sttk', 0.0) / G
    if x.get('so_n') and x.get('gm_def'):
        m['soso'] = x['so_x'] / x['so_n']

    # ---------------------------------------------------------------- passing
    if att >= 1:
        py_ = num(r.get('passing_yards'), 0) or 0
        yac = num(r.get('passing_yards_after_catch'))
        if yac is not None and y >= T[2]:
            m['cayatt'] = (py_ - yac) / att
            if py_ > 0:
                m['yacshr'] = max(0.0, min(100.0, yac / py_ * 100.0))
        if qb:
            for b, _ in BANDS:
                n = band(qb, 'z', b)
                if n and y >= T[2]:
                    d['att' + b] = n
                    m['cmp' + b] = band(qb, 'zc', b) / n * 100.0
                    m['ypa' + b] = band(qb, 'zy', b) / n
            if qb.get('ng_db'):
                d['ngdb'] = qb['ng_db']
                m['epadbng'] = qb['ng_epa'] / qb['ng_db']
            if qb.get('sos_n') and qb.get('db') and qb['sos_n'] >= 0.6 * qb['db']:
                m['sosp'] = qb['sos_x'] / qb['sos_n']
                if lg.get('db_epa') is not None:
                    m['epadbadj'] = qb['db_epa'] / qb['db'] - (m['sosp'] - lg['db_epa'])
        if x.get('drv'):
            d['drv'] = x['drv']
            m['ppd'] = x['drv_pts'] / x['drv']
            m['tddrv'] = x['drv_td'] / x['drv'] * 100.0
            m['to3'] = x['drv_3o'] / x['drv'] * 100.0
        if y >= T[5]:
            # maxair is the longest COMPLETION; max_air_distance is the longest throw,
            # caught or not, and read twenty yards long for half the league
            for src, key in (('pas_avg_air_distance', 'airdist'), ('pas_max_completed_air_distance', 'maxair'),
                             ('pas_completion_percentage_above_expectation', 'ngscpoe')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if y >= T[6]:
            prs = num(pf.get('pass_times_pressured'))
            pct = num(pf.get('pass_pressure_pct'))
            den = num(pf.get('pass_pressure_den'))
            if den is None and prs and pct:
                den = prs / (pct / 100.0)
            if prs:
                d['qprs'] = prs
                sk = num(pf.get('pass_times_sacked'))
                if sk is None:
                    sk = num(r.get('sacks_suffered'), 0) or 0
                m['p2s'] = min(100.0, sk / prs * 100.0)
            if den:
                for src, key in (('pass_times_hurried', 'hurrypct'), ('pass_times_hit', 'hitpct')):
                    v = num(pf.get(src))
                    if v is not None:
                        m[key] = v / den * 100.0
        if y >= T[7] and fqb:
            cdb = fqb.get('chart_db') or 0
            if cdb and 'uc' in fqb:
                m['ucrate'] = fqb['uc'] / cdb * 100.0
            for cnt, tot, key, dk in (('pa', 'pa_epa', 'epapa', 'padb'),
                                      ('blz', 'blz_epa', 'epablz', 'blzdb'),
                                      ('uc', 'uc_epa', 'epauc', 'ucdb')):
                n = fqb.get(cnt) or 0
                if n and tot in fqb:
                    d[dk] = n
                    m[key] = fqb[tot] / n
            catt = fqb.get('chart_att') or 0
            if catt:
                m['intluck'] = (num(r.get('passing_interceptions'), 0) or 0) / att * 100.0 \
                    - fqb.get('iw', 0.0) / catt * 100.0
        mz = x.get('qbmz')
        if mz and y >= T[6]:
            n = _f(mz.get('man')) + _f(mz.get('zone'))
            if n:
                m['manrate'] = _f(mz.get('man')) / n * 100.0
            if mz.get('man'):
                d['mandb'] = mz['man']
                m['epaman'] = mz['man_epa'] / mz['man']
            if mz.get('zone'):
                d['zonedb'] = mz['zone']
                m['epazone'] = mz['zone_epa'] / mz['zone']

    # ---------------------------------------------------------------- rushing
    # A quarterback who has thrown and has no called run to his name has a zero there, not
    # a blank: a blank reads as "not measured", and Savant value would call him average.
    if pos == 'QB' and G and att >= 1 and not (car >= 1 and rush):
        m['desrun'] = 0.0
        m['desepa'] = 0.0
    if car >= 1 and rush:
        if pos == 'QB':
            if G:
                m['desrun'] = rush.get('des', 0.0) / G
                # What his called runs were worth. Kneel-downs and aborted snaps are not in
                # it, and neither are scrambles, which are dropbacks and sit in EPA per dropback.
                m['desepa'] = rush.get('des_epa', 0.0) / G
            if rush.get('des'):
                d['descar'] = rush['des']
                m['ypcdes'] = rush['des_yds'] / rush['des']
            if rush.get('scr'):
                d['scr'] = rush['scr']
                m['ypcscr'] = rush['scr_yds'] / rush['scr']
                m['epascr'] = rush['scr_epa'] / rush['scr']
        if x.get('t_car'):
            m['carshr'] = min(100.0, rush.get('car', 0.0) / x['t_car'] * 100.0)
        if x.get('t_i10') and x['t_i10'] >= 3:
            m['i10shr'] = min(100.0, rush.get('i10', 0.0) / x['t_i10'] * 100.0)
        if x.get('t_i5') and x['t_i5'] >= 3:
            m['i5shr'] = min(100.0, rush.get('i5', 0.0) / x['t_i5'] * 100.0)
        gi = sum(rush.get('g_' + g, 0.0) for g in INSIDE)
        go = sum(rush.get('g_' + g, 0.0) for g in OUTSIDE)
        if gi + go:
            m['outrate'] = go / (gi + go) * 100.0
        if gi:
            d['carin'] = gi
            m['ypcin'] = sum(rush.get('gy_' + g, 0.0) for g in INSIDE) / gi
            m['srin'] = sum(rush.get('gs_' + g, 0.0) for g in INSIDE) / gi * 100.0
        if go:
            d['carout'] = go
            m['ypcout'] = sum(rush.get('gy_' + g, 0.0) for g in OUTSIDE) / go
            m['srout'] = sum(rush.get('gs_' + g, 0.0) for g in OUTSIDE) / go * 100.0
        if rush.get('sy'):
            d['sy'] = rush['sy']
            m['syconv'] = rush['sy_conv'] / rush['sy'] * 100.0
        des = rush.get('des') or 0
        if rush.get('sos_n') and des and rush['sos_n'] >= 0.6 * des:
            m['sosr'] = rush['sos_x'] / rush['sos_n']
            if lg.get('car_epa') is not None and rush.get('car'):
                m['epacaradj'] = rush['car_epa'] / rush['car'] - (m['sosr'] - lg['car_epa'])
        if y >= T[5]:
            v = num(ng.get('rus_rush_pct_over_expected'))
            if v is not None:
                m['ropct'] = v * 100.0
            v = num(ng.get('rus_efficiency'))
            if v is not None:
                m['rueff'] = v
        if y >= T[7] and frush:
            if frush.get('lt_n'):
                d['carlt'] = frush['lt_n']
                m['ypclt'] = frush['lt_yds'] / frush['lt_n']
            if frush.get('st_n'):
                d['carst'] = frush['st_n']
                m['ypcst'] = frush['st_yds'] / frush['st_n']
            if frush.get('snk'):
                d['snk'] = frush['snk']
                m['snkconv'] = frush['snk_conv'] / frush['snk'] * 100.0

    # ---------------------------------------------------------------- receiving
    # A day on the field with nothing thrown his way is a zero, not a blank: left blank,
    # it dropped out of every average built from his games and flattered him.
    if pos in ('WR', 'TE', 'RB') and y >= T[5]:
        ops, est = est_pass_snaps(x, pos, 'ops', 'e_ops')
        if ops and ops >= 1:
            d['opsnap'] = ops
            m['tpps'] = min(100.0, tgt / ops * 100.0)
            m['ypps'] = (num(r.get('receiving_yards'), 0) or 0) / ops
    if tgt >= 1:
        recy = num(r.get('receiving_yards'), 0) or 0
        if x.get('t_recy'):
            m['ydshr'] = recy / x['t_recy'] * 100.0
        if x.get('t_rectd') and x['t_rectd'] >= 2:
            m['tdshr'] = (num(r.get('receiving_tds'), 0) or 0) / x['t_rectd'] * 100.0
        if x.get('t_recfd'):
            m['fdshr'] = (num(r.get('receiving_first_downs'), 0) or 0) / x['t_recfd'] * 100.0
        if rec and rec.get('tgt'):
            if y >= T[3]:
                if G:
                    m['eztgt'] = rec.get('ez', 0.0) / G
                    m['td3tgt'] = rec.get('td3', 0.0) / G
                if x.get('t_ez') and x['t_ez'] >= 3:
                    m['ezshr'] = min(100.0, rec.get('ez', 0.0) / x['t_ez'] * 100.0)
                if rec.get('td3'):
                    d['td3t'] = rec['td3']
                    m['td3cv'] = rec['td3_conv'] / rec['td3'] * 100.0
                for b, _ in BANDS:
                    n = band(rec, 'z', b)
                    if n:
                        d['tgt' + b] = n
                        m['ypt' + b] = band(rec, 'zy', b) / n
                        if b != 'b':
                            m['catch' + b] = band(rec, 'zc', b) / n * 100.0
                if rec.get('cp_n') and 'cp_rec' in rec and rec['cp_n'] >= 0.5 * rec['tgt']:
                    m['croe'] = (rec['cp_rec'] - rec['cp_sum']) / rec['cp_n'] * 100.0
            if y >= T[2] and rec.get('xyac_n') and 'yac_x' in rec:
                m['xyacoe'] = (rec['yac_x'] - rec['xyac']) / rec['xyac_n']
            if rec.get('sos_n') and rec['sos_n'] >= 0.6 * rec['tgt']:
                m['sospr'] = rec['sos_x'] / rec['sos_n']
        if y >= T[7] and frec:
            rn = frec.get('rd_n') or 0
            if rn:
                m['tgt1st'] = frec['rd_1'] / rn * 100.0
                m['tgtdes'] = frec['rd_des'] / rn * 100.0
                m['tgtchk'] = frec['rd_chk'] / rn * 100.0
            ct = frec.get('chart_tgt') or 0
            if ct:
                m['tgtscr'] = frec.get('screen', 0.0) / ct * 100.0
            if x.get('t_rd1') and 'rd_1' in frec:
                m['frshr'] = min(100.0, frec['rd_1'] / x['t_rd1'] * 100.0)
        mz = x.get('recmz')
        if mz and y >= T[6]:
            if mz.get('man'):
                d['tgtman'] = mz['man']
                m['yptman'] = mz['man_yds'] / mz['man']
            if mz.get('zone'):
                d['tgtzone'] = mz['zone']
                m['yptzone'] = mz['zone_yds'] / mz['zone']
    if G and x.get('dpi'):
        m['dpig'] = x['dpi'] / G
        m['dpiyds'] = x['dpi_yds'] / G
    elif G and tgt >= 1:
        m['dpig'] = m['dpiyds'] = 0.0

    # ---------------------------------------------------------------- returns
    for k in ('kr', 'pr'):
        n = x.get(k + '_n')
        if n:
            d[k] = n
            if G:
                m[k + 'g'] = n / G
            m[k + 'avg'] = x[k + '_yds'] / n
            m[k + 'epa'] = x[k + '_epa'] / n

    # ---------------------------------------------------------------- blocking
    if pos in OLINE:
        if x.get('c_db') and y >= T[6]:
            m['prsallowc'] = min(100.0, x['c_prs'] / x['c_db'] * 100.0)
        if x.get('gp_n') and x['gp_n'] >= 1:
            d['gaprun'] = x['gp_n']
            m['gapsr'] = x['gp_s'] / x['gp_n'] * 100.0
            m['gapypc'] = x['gp_y'] / x['gp_n']
            m['gapstuff'] = x['gp_t'] / x['gp_n'] * 100.0
        for k in ('gwo', 'linecont', 'linescore'):
            if x.get(k) is not None:
                m[k] = x[k]

    # ---------------------------------------------------------------- pass rush / defense
    dsk = num(r.get('def_sacks'), 0) or 0
    tfl = num(r.get('def_tackles_for_loss'), 0) or 0
    is_def = pos in ('ED', 'DI', 'LB', 'CB', 'S')
    if is_def:
        dps, est = est_pass_snaps(x, pos, 'dps', 'e_dps')
        drs = None
        if x.get('_part'):
            drs = x.get('drs')
        elif x.get('e_drs'):
            # His snaps times the share of the offense's plays that were designed runs.
            # (Not "snaps minus pass snaps": snap counts include three or four penalties,
            # kneel-downs and spikes a game that are neither, and that ran 15% high.)
            drs = x['e_drs'] * RUN_RATIO.get(pos, 1.0)
        # Charted, with nothing charted against him, is a zero. `pfw` counts his games the
        # charting crew has been through; before the weekly files (2018) the season row
        # itself is the only evidence he was charted at all.
        charted = bool(pf) or bool(x.get('pfw'))
        if dps and dps >= 1 and y >= T[5]:
            d['dpsnap'] = dps
            if dsk or def_s:
                m['skpass'] = dsk / dps * 100.0
            if y >= T[6] and charted:
                prs = num(pf.get('def_prss'))
                if prs is not None or not pf:
                    m['prsspass'] = min(100.0, (prs or 0.0) / dps * 100.0)
                bl = num(pf.get('def_bltz'))
                if bl is not None or not pf:
                    m['blitzrate'] = min(100.0, (bl or 0.0) / dps * 100.0)
                ct = num(pf.get('def_tgt'))
                if ct is not None and ct > 0:
                    m['ctgtcov'] = min(100.0, ct / dps * 100.0)
                    cy = num(pf.get('def_yds'))
                    if cy is not None:
                        m['ycovsnap'] = cy / dps
        if drs and drs >= 1 and y >= T[5]:
            d['drsnap'] = drs
            m['rstoprate'] = min(100.0, x.get('rstop', 0.0) / drs * 100.0)
        if G:
            m['rstop'] = x.get('rstop', 0.0) / G
        if x.get('rtk'):
            d['rtk'] = x['rtk']
            m['rtkdepth'] = x['rtk_y'] / x['rtk']
        if x.get('ptk'):
            d['ptk'] = x['ptk']
            m['tkyac'] = x['ptk_yac'] / x['ptk']
        if x.get('sk_n'):
            d['skn'] = x['sk_n']
            m['skepa'] = x['sk_epa'] / x['sk_n']
            m['skyd'] = x['sk_yds'] / x['sk_n']
        if G and (x.get('sk_n') or dsk or def_s):
            m['sk3rd'] = x.get('sk_3d', 0.0) / G
            m['stripsk'] = x.get('sk_ff', 0.0) / G
        if x.get('t_dsk') and x['t_dsk'] >= 2:
            m['skshr'] = min(100.0, x.get('w_sk', 0.0) / x['t_dsk'] * 100.0)
        if x.get('t_dprs') and x['t_dprs'] >= 5 and y >= T[6]:
            m['prsshr'] = min(100.0, x.get('w_prs', 0.0) / x['t_dprs'] * 100.0)
        if def_s:
            hav = tfl + dsk + (num(r.get('def_fumbles_forced'), 0) or 0) \
                + (num(r.get('def_interceptions'), 0) or 0) + (num(r.get('def_pass_defended'), 0) or 0)
            m['havoc'] = hav / def_s * 100.0
        if y >= T[6] and pf:
            ct = num(pf.get('def_tgt'))
            if ct is not None and ct > 0:
                air, cmpn = num(pf.get('def_air')), num(pf.get('def_cmp'))
                if air is not None and cmpn:
                    m['airall'] = air / cmpn
                td = num(pf.get('def_td'))
                if td is not None and G:
                    m['tdall'] = td / G
        # true on-field splits, finished seasons only
        rows = x.get('ddef')
        if rows and y >= T[5]:
            tot = defaultdict(float)
            for q in rows:
                for k, v in q.items():
                    if k not in ('pid', 'tm', 'g'):
                        tot[k] += _f(v)
            if tot['dsn']:
                m['passshr'] = tot['dps'] / tot['dsn'] * 100.0
            off = defaultdict(float)
            for q in rows:
                t = (x.get('dteams') or {}).get(q['tm'])
                if not t:
                    continue
                for k in ('dsn', 'dps', 'drs', 'de', 'dpe', 'drsucc'):
                    off[k] += _f(t.get(k)) - _f(q.get(k))
            if off['dsn'] >= 100 and tot['dsn'] >= 100:
                m['depaoo'] = tot['de'] / tot['dsn'] - off['de'] / off['dsn']
            if off['dps'] >= 60 and tot['dps'] >= 60:
                m['dpepaoo'] = tot['dpe'] / tot['dps'] - off['dpe'] / off['dps']
            if off['drs'] >= 50 and tot['drs'] >= 50:
                m['drsoo'] = (tot['drsucc'] / tot['drs'] - off['drsucc'] / off['drs']) * 100.0

    # ---------------------------------------------------------------- kicking
    if x.get('ko'):
        d['ko'] = x['ko']
        m['kotb'] = x.get('ko_tb', 0.0) / x['ko'] * 100.0
        if x.get('ko_dist_n'):
            m['kodist'] = x['ko_dist'] / x['ko_dist_n']
        m['koflag'] = x.get('ko_oob', 0.0) / x['ko'] * 100.0
    if x.get('pu'):
        m['pepa'] = x['pu_epa'] / x['pu']
    if x.get('fgo_n'):
        d['fgaout'] = x['fgo_n']
        m['fgoeout'] = x['fgo_over'] / x['fgo_n']
    if 'fg_wpa' in x:
        m['fgwpa'] = x['fg_wpa']

    # ---------------------------------------------------------------- value
    if x.get('xfp_n') and G and y >= T[2]:
        m['xfp'] = x['xfp'] / G
        m['fpoe'] = (x['xfp_fp'] - x['xfp']) / G
        m['tdoe'] = x['xtd_td'] - x['xtd']
    # Every play he was the passer, the runner or the target on, each counted once: his
    # dropbacks (a scramble is a dropback), his designed runs, his targets. This used to
    # be either-or - a passer's line or a runner-receiver's - so one trick-play throw cost
    # Chris Olave a season of catches, and a quarterback lost the passes thrown to him.
    if (qb and 'wpa' in qb) or (rush and 'wpa' in rush) or (rec and 'wpa' in rec):
        m['wpa'] = (qb.get('wpa', 0.0) if qb else 0.0) + (rush.get('des_wpa', 0.0) if rush else 0.0) \
            + (rec.get('wpa', 0.0) if rec else 0.0)
    if x.get('apy') is not None:
        m['apy'] = x['apy']
        if x.get('capshr'):
            m['capshr'] = x['capshr']


def standin_onfield(x):
    """An on-field row shaped like the participation file's, built from snap share. Used
    for a lineman in a season the participation file does not exist for yet."""
    if not x or not x.get('e_pblk') and not x.get('e_rblk'):
        return None
    g = lambda k: x.get(k, 0.0)
    return [dict(tm=None, g=g('gm_off'), est=True,
                 pblk=g('e_pblk'), rblk=g('e_rblk'), prs_n=0.0, prs=0.0,
                 sk=g('e_sk'), pepa=g('e_pepa'), psucc=g('e_psucc'), repa=g('e_repa'),
                 rsucc=g('e_rsucc'), ryds=g('e_ryds'), stuff=g('e_stuff'),
                 rush_n=g('e_rush_n'), rush_sum=g('e_rush_sum'),
                 box_n=g('e_box_n'), box_sum=g('e_box_sum'), hit=g('e_hit'))]


def kicker_points(r):
    """Standard kicker scoring, which the season table leaves at zero: 3 for a field goal
    inside 40, 4 from 40 to 49, 5 from 50 and out, 1 for an extra point."""
    pts = 0.0
    lst = r.get('fg_made_list')
    if isinstance(lst, str):
        for dd in lst.split(';'):
            dd = dd.strip()
            if dd.isdigit():
                dist = int(dd)
                pts += 5.0 if dist >= 50 else 4.0 if dist >= 40 else 3.0
    try:
        pat = float(r.get('pat_made') or 0)
        pts += pat if pat == pat else 0.0
    except (TypeError, ValueError):
        pass
    return pts
