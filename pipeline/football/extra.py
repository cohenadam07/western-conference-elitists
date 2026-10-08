"""The inputs and arithmetic behind the rows added in October 2026.

build.py already joins the season table, the charting, the tracking and the play-by-play
aggregates. This module adds what those could not reach on their own:

  * week-by-week snap counts, which say how much of each game a man played. That one fact
    turns a team's numbers into "the unit's numbers on his snaps" without the after-season
    on-field file, and it is what a lineman's in-season card is built from.
  * the team-week table from pbp_agg.py and ftn_agg.py, which every "share of his team"
    row divides by.
  * the play-by-play credits for defenders, kickers, punters, returners and drives.
  * pass-play and run-play snaps: counted where the on-field file exists, estimated from
    snap counts and the opponent's pass rate where it does not.

Everything a Season hands out through bundle() is a plain sum, so two bundles add: a
season is the sum of its weeks, and a last-17-games window is the sum of two part-seasons.
build_player() does the dividing, in apply() below, which is the only place a rate is made.
"""
import csv, json, math, os
from collections import defaultdict

import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')
AGG = os.environ.get('NFL_AGG', 'agg')
HERE = os.path.dirname(os.path.abspath(__file__))
PRIORS = os.environ.get('NFL_PRIORS', os.path.join(HERE, 'priors.json'))

GAPS = ['le', 'lt', 'lg', 'md', 'rg', 'rt', 're']
# The gaps a run "behind him" goes through. A tackle owns the off-tackle lane and the edge
# outside it; a guard his own gap; the centre the middle.
SPOT_GAPS = {'LT': ['lt', 'le'], 'LG': ['lg'], 'C': ['md'], 'RG': ['rg'], 'RT': ['rt', 're']}
OFFENSE = ('QB', 'RB', 'WR', 'TE', 'OL', 'OT', 'OG', 'OC')
LINE = ('OL', 'OT', 'OG', 'OC')
DEFENSE = ('ED', 'DI', 'LB', 'CB', 'S')

# How a defender's real share of pass plays compares with the naive guess (his snaps times
# the opponent's pass rate), by position: the median across 2025's defenders. Interior
# linemen come off the field on passing downs, so the guess runs high for them; edges and
# corners run a shade the other way. Used only for a player with no ratio of his own from
# last season, and only when priors.json has no position medians of its own.
POS_PASS_RATIO = {'ED': 1.02, 'DI': 0.93, 'LB': 0.98, 'CB': 1.03, 'S': 1.01}

# Snap counts and PFR's weekly files still call a franchise what it was called that year;
# the play-by-play calls every season's Raiders LV. Team-week lookups go through this.
ALIAS = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LA', 'SDG': 'LAC', 'RAI': 'LV', 'RAM': 'LA'}


def canon(t):
    return ALIAS.get(t, t) if isinstance(t, str) else t


TEAM_KEYS = ['t_car', 't_i10', 't_i5', 't_tgt', 't_recy', 't_rectd', 't_recfd', 't_ez',
             't_rd1', 't_prss', 't_plays']


def num(x, default=None):
    try:
        if x is None:
            return default
        f = float(x)
        if not math.isfinite(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _load(path):
    return json.load(open(path)) if os.path.exists(path) else {}


def add_into(a, b):
    """a += b, for the nested dicts of sums and lists a bundle is made of."""
    for k, v in b.items():
        if isinstance(v, dict):
            add_into(a.setdefault(k, {}), v)
        elif isinstance(v, list):
            a.setdefault(k, [])
            a[k] = a[k] + v
        elif isinstance(v, bool):
            a[k] = bool(a.get(k)) or v
        elif isinstance(v, (int, float)):
            a[k] = a.get(k, 0.0) + v
        else:
            a.setdefault(k, v)
    return a


def load_priors():
    """Last season's ratio of real pass-play snaps to the naive guess, per defender."""
    j = _load(PRIORS)
    return j if isinstance(j, dict) else {}


class Season:
    """One season's weekly inputs, loaded once."""

    def __init__(self, y, by_pfr, priors=None, live=False):
        """`live` reads the season the way it looked while it was being played: without
        the on-field file, which is only published once it is over."""
        self.y = y
        self.by_pfr = by_pfr
        self.live = live
        self.pbp = _load(os.path.join(AGG, 'pbp_%d.json' % y))
        self.ftn = _load(os.path.join(AGG, 'ftn_%d.json' % y))
        self.roles = _load(os.path.join(AGG, 'roles_%d.json' % y))
        self._snaps()
        self._team_weeks()
        self._by_week()
        self._punt_curve()
        self._xfp()
        self._onfield()
        pr = priors or {}
        fresh = pr.get('season') == y - 1
        self.prior = (pr.get('def') or {}) if fresh else {}
        self.pos_ratio = dict(POS_PASS_RATIO)
        if isinstance(pr.get('pos'), dict):
            self.pos_ratio.update(pr['pos'])

    # ------------------------------------------------------------ loading
    def _snaps(self):
        """snapw[gid] = [dict(week, tm, opp, off, dfn, st, offt, deft, stt)] in week order."""
        self.snapw = defaultdict(list)
        self.snapinfo = {}
        self.team_weeks = defaultdict(set)          # tm -> weeks it played
        p = os.path.join(RAW, 'snaps_%d.csv' % self.y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            return
        df = pd.read_csv(p, low_memory=False)
        if 'game_type' in df.columns:
            df = df[df.game_type == 'REG']
        for c in ('offense_snaps', 'defense_snaps', 'st_snaps'):
            df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0.0)
        gt = df.groupby(['game_id', 'team'])
        idx = df.set_index(['game_id', 'team']).index
        df['offt'] = idx.map(gt.offense_snaps.max())
        df['deft'] = idx.map(gt.defense_snaps.max())
        df['stt'] = idx.map(gt.st_snaps.max())
        pos_ct = defaultdict(lambda: defaultdict(float))
        for r in df.itertuples(index=False):
            tm = canon(r.team)
            self.team_weeks[tm].add(int(r.week))
            gid = self.by_pfr.get(r.pfr_player_id)
            if not gid:
                continue
            tot = r.offense_snaps + r.defense_snaps + r.st_snaps
            self.snapw[gid].append(dict(
                week=int(r.week), tm=tm, opp=canon(r.opponent), off=float(r.offense_snaps),
                dfn=float(r.defense_snaps), st=float(r.st_snaps), offt=float(r.offt or 0),
                deft=float(r.deft or 0), stt=float(r.stt or 0)))
            pos_ct[gid][str(r.position)] += tot
            info = self.snapinfo.setdefault(gid, dict(name=r.player, tot=0.0))
            info['tot'] += tot
            info['team'] = r.team                  # as the snap file spells it, for the card
        last_team = {}
        for r in df.sort_values('week').itertuples(index=False):
            gid = self.by_pfr.get(r.pfr_player_id)
            if gid:
                last_team[gid] = r.team
        for gid, rows in self.snapw.items():
            rows.sort(key=lambda x: x['week'])
            self.snapinfo[gid]['team'] = last_team.get(gid, rows[-1]['tm'])
            pc = pos_ct[gid]
            self.snapinfo[gid]['pos'] = max(sorted(pc), key=lambda k: pc[k]) if pc else None

    def _team_weeks(self):
        """TW[(week, tm)] = the offense's row; the defense's is the row whose opp is tm."""
        self.TW, self.DW = {}, {}
        for r in self.pbp.get('line', []):
            self.TW[(int(r['week']), r['tm'])] = r
            if isinstance(r.get('opp'), str):
                self.DW[(int(r['week']), r['opp'])] = r
        self.FT = {}
        for r in self.ftn.get('team', []):
            if isinstance(r.get('tm'), str):
                self.FT[(int(r['week']), r['tm'])] = r
        # charted pressures on a team's quarterbacks, and by a team's defenders, per game
        self.QP, self.PD = {}, {}
        p = os.path.join(RAW, 'advw_pass_%d.csv' % self.y)
        if os.path.exists(p) and os.path.getsize(p) > 200:
            df = pd.read_csv(p, low_memory=False)
            if 'game_type' in df.columns:
                df = df[df.game_type == 'REG']
            g = df.groupby(['week', 'team']).times_pressured.sum()
            self.QP = {(int(w), canon(t)): float(v) for (w, t), v in g.items() if v == v}
        p = os.path.join(RAW, 'advw_def_%d.csv' % self.y)
        if os.path.exists(p) and os.path.getsize(p) > 200:
            df = pd.read_csv(p, low_memory=False)
            if 'game_type' in df.columns:
                df = df[df.game_type == 'REG']
            g = df.groupby(['week', 'team']).def_pressures.sum()
            self.PD = {(int(w), canon(t)): float(v) for (w, t), v in g.items() if v == v}

    def _by_week(self):
        def idx(rows):
            out = defaultdict(list)
            for r in rows:
                out[r['pid']].append(r)
            return out
        self.w_def = idx(self.pbp.get('def', []))
        self.w_drv = idx(self.pbp.get('drive', []))
        self.w_kick = idx(self.pbp.get('kick', []))
        self.w_punt = idx(self.pbp.get('punt', []))
        self.w_ret = idx(self.pbp.get('ret', []))
        # the weeks a man shows up in the play-by-play, for seasons with no snap counts
        self.w_seen = defaultdict(set)
        for kind in ('qb', 'rush', 'rec'):
            for r in self.pbp.get(kind, []):
                if isinstance(r.get('tm'), str):
                    self.w_seen[r['pid']].add((int(r['week']), r['tm']))

    def _punt_curve(self):
        """League net yards by where the punt was kicked from, this season.

        Smoothed over the neighbouring yard lines, the same way the field-goal curve is,
        so one season's handful of punts from the opponent's 38 does not set the bar."""
        tot, n = defaultdict(float), defaultdict(float)
        for r in self.pbp.get('punt', []):
            for yl, net in r.get('pts', []):
                tot[yl] += net
                n[yl] += 1
        self._pexp = {}
        for yl in range(1, 100):
            s = c = 0.0
            for k in range(yl - 5, yl + 6):
                w = 1.0 - abs(k - yl) / 6.0
                s += tot.get(k, 0.0) * w
                c += n.get(k, 0.0) * w
            if c >= 8:
                self._pexp[yl] = s / c

    def _xfp(self):
        """Expected fantasy points per opportunity, from the ffopportunity model."""
        self.w_xfp = defaultdict(list)
        p = os.path.join(RAW, 'xfp_%d.csv' % self.y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            return
        last = 18 if self.y >= 2021 else 17
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                wk = num(r.get('week'))
                gid = (r.get('player_id') or '').strip()
                if not gid or wk is None or wk > last:
                    continue
                x = num(r.get('total_fantasy_points_exp'))
                if x is None:
                    continue
                self.w_xfp[gid].append(dict(
                    week=int(wk), x=x, diff=num(r.get('total_fantasy_points_diff'), 0.0),
                    td=num(r.get('total_touchdown'), 0.0),
                    tdx=num(r.get('total_touchdown_exp'), 0.0)))

    def _onfield(self):
        """Defenders' real pass-play and run-play snaps, where the on-field file exists."""
        j = {} if self.live else _load(os.path.join(AGG, 'onfield_%d.json' % self.y))
        self.don = defaultdict(lambda: defaultdict(float))
        self.don_off = defaultdict(lambda: defaultdict(float))
        dteams = j.get('dteams') or {}
        for r in j.get('defs', []):
            a = self.don[r['pid']]
            for k, v in r.items():
                if k not in ('pid', 'tm', 'g'):
                    a[k] += float(v or 0)
            t = dteams.get(r['tm'])
            if t:
                o = self.don_off[r['pid']]
                for k in ('dpass', 'drun', 'dpepa', 'drsucc'):
                    o[k] += float(t.get(k, 0)) - float(r.get(k, 0) or 0)
        # offense: his real share of pass plays, for the routes stand-in
        self.oon = defaultdict(lambda: defaultdict(float))
        for r in j.get('players', []):
            a = self.oon[r['pid']]
            a['snaps'] += float(r.get('snaps') or 0)
            a['pblk'] += float(r.get('pblk') or 0)

    # ------------------------------------------------------------ handing out
    def has_snaps(self):
        return bool(self.snapw)

    def weeks_of(self, gid):
        """[(week, team)] he played, from snap counts where they exist."""
        rows = self.snapw.get(gid)
        if rows:
            return [(r['week'], r['tm']) for r in rows if (r['off'] or r['dfn'] or r['st'])]
        return sorted(self.w_seen.get(gid, ()))

    def spot(self, gid):
        return (self.roles.get('spot') or {}).get(gid)

    def bundle(self, gid, pos, weeks=None):
        """Every extra input for one player, summed over `weeks` (None = the season)."""
        x = {}
        keep = (lambda w: True) if weeks is None else (lambda w: w in weeks)
        played = [(w, t) for (w, t) in self.weeks_of(gid) if keep(w)]

        # ---- his team's totals in the games he played
        t = defaultdict(float)
        for wt in played:
            row = self.TW.get(wt)
            if row:
                for k in ('t_car', 't_i10', 't_i5', 't_tgt', 't_recy', 't_rectd', 't_recfd',
                          't_ez', 't_ay', 't_plays'):
                    t[k] += float(row.get(k) or 0)
            f = self.FT.get(wt)
            if f:
                t['t_rd1'] += float(f.get('t_rd1') or 0)
            if wt in self.PD:
                t['t_prss'] += self.PD[wt]
        if t:
            x['t'] = dict(t)

        # ---- play-by-play credits
        for name, src in (('dfn', self.w_def), ('drv', self.w_drv)):
            acc = defaultdict(float)
            for r in src.get(gid, ()):
                if keep(int(r['week'])):
                    for k, v in r.items():
                        if k not in ('pid', 'week'):
                            acc[k] += float(v or 0)
            if acc:
                x[name] = dict(acc)
        kk = {}
        for r in self.w_kick.get(gid, ()):
            if keep(int(r['week'])):
                for k, v in r.items():
                    if k in ('pid', 'week'):
                        continue
                    if isinstance(v, list):
                        kk[k] = kk.get(k, []) + v
                    else:
                        kk[k] = kk.get(k, 0.0) + float(v or 0)
        if kk:
            x['kick'] = kk
        pn = defaultdict(float)
        for r in self.w_punt.get(gid, ()):
            if keep(int(r['week'])):
                pn['pn'] += float(r.get('pn') or 0)
                pn['pin10'] += float(r.get('pin10') or 0)
                for yl, net in r.get('pts', []):
                    e = self._pexp.get(yl)
                    if e is not None:
                        pn['noe'] += net - e
                        pn['noe_n'] += 1
        if pn:
            x['punt'] = dict(pn)
        rt = defaultdict(float)
        for r in self.w_ret.get(gid, ()):
            if keep(int(r['week'])):
                for k in ('n', 'yds', 'epa'):
                    rt[r['k'] + '_' + k] += float(r.get(k) or 0)
        if rt:
            x['ret'] = dict(rt)
        xf = defaultdict(float)
        for r in self.w_xfp.get(gid, ()):
            if keep(r['week']):
                for k in ('x', 'diff', 'td', 'tdx'):
                    xf[k] += r[k]
                xf['n'] += 1
        if xf:
            x['xfp'] = dict(xf)

        # ---- everything that needs to know how much of each game he played
        snaps = [r for r in self.snapw.get(gid, ()) if keep(r['week'])]
        if not snaps:
            return x
        st = defaultdict(float)
        for r in snaps:
            st['st'] += r['st']
            st['stt'] += r['stt']
        x['st'] = dict(st)

        if pos in LINE:
            x['unit'] = self._unit(gid, snaps)
            if weeks is None:
                wo = self._with_without(gid, snaps)
                if wo:
                    x['wo'] = wo
        if pos in OFFENSE:
            ps = self._pass_snaps_off(gid, pos, snaps)
            if ps:
                x.update(ps)
        if pos in DEFENSE:
            x.update(self._pass_snaps_def(gid, pos, snaps))
            if weeks is None and gid in self.don:
                d = self.don[gid]
                o = self.don_off.get(gid, {})
                x['don'] = dict(dpass=d['dpass'], drun=d['drun'], dpepa=d['dpepa'],
                                drsucc=d['drsucc'], o_dpass=o.get('dpass', 0.0),
                                o_drun=o.get('drun', 0.0), o_dpepa=o.get('dpepa', 0.0),
                                o_drsucc=o.get('drsucc', 0.0))
        return x

    def _unit(self, gid, snaps):
        """What the offense did, weighted by the share of each game he was on the field for."""
        u = defaultdict(float)
        spot = self.spot(gid)
        gaps = SPOT_GAPS.get(spot or '', [])
        for r in snaps:
            if not r['off'] or not r['offt']:
                continue
            sh = min(1.0, r['off'] / r['offt'])
            wt = (r['week'], r['tm'])
            row = self.TW.get(wt)
            if not row:
                continue
            for a, b in (('db', 'db'), ('sk', 'sk'), ('hit', 'hit'), ('pepa', 'pepa'),
                         ('psucc', 'psucc'), ('run', 'run'), ('rsucc', 'run_succ'),
                         ('ryds', 'ryds'), ('stuff', 'rstuff')):
                u[a] += sh * float(row.get(b) or 0)
            f = self.FT.get(wt)
            if f:
                for k in ('t_rush_sum', 't_rush_n', 't_box_sum', 't_box_n'):
                    u[k[2:]] += sh * float(f.get(k) or 0)
            if wt in self.QP:
                u['cprs'] += sh * self.QP[wt]
                u['cprs_db'] += sh * float(row.get('db') or 0)
            for g in gaps:
                u['gn'] += sh * float(row.get('gn_' + g) or 0)
                u['gs'] += sh * float(row.get('gs_' + g) or 0)
                u['gy'] += sh * float(row.get('gy_' + g) or 0)
                u['gf'] += sh * float(row.get('gf_' + g) or 0)
        return dict(u)

    def _with_without(self, gid, snaps):
        """His team's sack rate and rush success in the games he played and the games he
        did not. The team is the one he took the most snaps for."""
        by_tm = defaultdict(float)
        for r in snaps:
            by_tm[r['tm']] += r['off']
        if not by_tm:
            return None
        tm = max(sorted(by_tm), key=lambda k: by_tm[k])
        on_weeks = {r['week'] for r in snaps if r['tm'] == tm and r['off'] > 0}
        out = defaultdict(float)
        for w in sorted(self.team_weeks.get(tm, ())):
            row = self.TW.get((w, tm))
            if not row:
                continue
            side = 'on' if w in on_weeks else 'off'
            out[side + '_g'] += 1
            out[side + '_db'] += float(row.get('db') or 0)
            out[side + '_sk'] += float(row.get('sk') or 0)
            out[side + '_run'] += float(row.get('run') or 0)
            out[side + '_rs'] += float(row.get('run_succ') or 0)
        return dict(out)

    def _pass_snaps_off(self, gid, pos, snaps):
        """Pass plays he was on the field for: the routes stand-in.

        Counted when the on-field file exists (his real share of pass plays, applied to
        his snap count, so a hole in that file cannot shrink the answer). Otherwise
        estimated from his snaps and his team's pass rate in each game - which holds for
        receivers, who stay on the field whatever is called, and is not offered for backs
        and tight ends, who come off by down and distance."""
        naive = tot = 0.0
        for r in snaps:
            row = self.TW.get((r['week'], r['tm']))
            if not row or not r['off']:
                continue
            plays = float(row.get('t_plays') or 0)
            if plays > 0:
                naive += r['off'] * float(row.get('db') or 0) / plays
                tot += r['off']
        if tot <= 0:
            return None
        on = self.oon.get(gid)
        if on and on['snaps'] >= 20:
            return dict(psnap=tot * on['pblk'] / on['snaps'], ps_est=False)
        if pos == 'WR':
            return dict(psnap=naive, ps_est=True)
        return None

    def _pass_snaps_def(self, gid, pos, snaps):
        naive = tot = 0.0
        for r in snaps:
            row = self.DW.get((r['week'], r['tm']))
            if not row or not r['dfn']:
                continue
            plays = float(row.get('t_plays') or 0)
            if plays > 0:
                naive += r['dfn'] * float(row.get('db') or 0) / plays
                tot += r['dfn']
        if tot <= 0:
            return {}
        on = self.don.get(gid)
        if on and (on['dpass'] + on['drun']) >= 20:
            share = on['dpass'] / (on['dpass'] + on['drun'])
            return dict(dpass=tot * share, drun=tot * (1 - share), dnaive=naive, dtot=tot,
                        dp_est=False)
        ratio = self.prior.get(gid)
        if ratio is None:
            ratio = self.pos_ratio.get(pos, 1.0)
        dpass = min(tot, naive * float(ratio))
        return dict(dpass=dpass, drun=tot - dpass, dnaive=naive, dtot=tot, dp_est=True)


# ---------------------------------------------------------------------------------------
# The arithmetic. Called at the end of build_player(), on the m and d it has already made.
# ---------------------------------------------------------------------------------------
def _band(a, band):
    att = sum(a.get('z_%s%s' % (band, x), 0.0) for x in 'lmr')
    cmp_ = sum(a.get('zc_%s%s' % (band, x), 0.0) for x in 'lmr')
    yds = sum(a.get('zy_%s%s' % (band, x), 0.0) for x in 'lmr')
    return att, cmp_, yds


def kicker_points(made_list):
    """Fantasy points for a kicker: 3 under 40 yards, 4 from 40-49, 5 from 50 on."""
    pts = 0.0
    if isinstance(made_list, str):
        for d in made_list.split(';'):
            d = d.strip()
            if d.isdigit():
                n = int(d)
                pts += 5 if n >= 50 else 4 if n >= 40 else 3
    return pts


def apply(m, d, r, pos, y, G, off_s, def_s, ng, pf, qb, rush, rec, pens, onf, fqb, frush,
          frec, x, pmake, tier):
    """Add the October 2026 rows to m and their denominators to d.

    Returns the keys in m that are estimates rather than counts, so the page can say so.
    """
    x = x or {}
    est = []
    t = x.get('t') or {}
    att = num(r.get('attempts'), 0) or 0
    car = num(r.get('carries'), 0) or 0
    tgt = num(r.get('targets'), 0) or 0

    # ------------------------------------------------------------------ passing
    if att >= 1:
        tp = num(pf.get('pass_times_pressured'))
        if tp is not None and y >= tier[6]:
            pdb = num(pf.get('pass_prs_db'))
            if pdb is None:
                pp = num(pf.get('pass_pressure_pct'))
                pdb = tp / (pp / 100.0) if pp else None
            sk = num(pf.get('pass_times_sacked'))
            if sk is None:
                sk = num(r.get('sacks_suffered'), 0) or 0
            if tp > 0:
                d['prs'] = tp
                m['p2s'] = min(100.0, sk / tp * 100.0)
            if pdb:
                for src, key in (('pass_times_hit', 'hitpct'), ('pass_times_hurried', 'hurrypct')):
                    v = num(pf.get(src))
                    if v is not None:
                        m[key] = v / pdb * 100.0
        if fqb and (fqb.get('loc_n') or 0) > 0:
            m['ucrate'] = fqb['uc'] / fqb['loc_n'] * 100.0
        py_ = num(r.get('passing_yards'), 0) or 0
        yac = num(r.get('passing_yards_after_catch'))
        if yac is not None and py_ > 0 and y >= tier[2]:
            m['yacshr'] = max(0.0, min(100.0, yac / py_ * 100.0))
        if y >= tier[5]:
            for src, key in (('pas_avg_air_distance', 'airdist'), ('pas_max_air_distance', 'maxair'),
                             ('pas_completion_percentage_above_expectation', 'ngscpoe')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if 'iwrate' in m and 'intpct' in m:
            m['intluck'] = m['iwrate'] - m['intpct']
        if qb:
            if y >= tier[2]:
                for band, ck, dk in (('s', 'cmpsh', 'attsh'), ('m', 'cmpmd', 'attmd'), ('d', 'cmpdp', 'attdp')):
                    a, c, yd = _band(qb, band)
                    if a >= 1:
                        d[dk] = a
                        m[ck] = c / a * 100.0
                        if band == 'd':
                            m['ypadp'] = yd / a
            if qb.get('ng_db'):
                d['ngdb'] = qb['ng_db']
                m['epang'] = qb['ng_epa'] / qb['ng_db']
            if qb.get('db') and 'wpa' in qb:
                m['wpadb'] = qb['wpa'] / qb['db'] * 100.0
        dv = x.get('drv')
        if dv and dv.get('drv'):
            d['drv'] = dv['drv']
            m['ppd'] = dv['drv_pts'] / dv['drv']
            m['scorepct'] = dv['drv_sc'] / dv['drv'] * 100.0
            m['toopct'] = dv['drv_3o'] / dv['drv'] * 100.0

    # ------------------------------------------------------------------ rushing
    if car >= 1 and rush and rush.get('car'):
        n = rush['car']
        scr = rush.get('scr', 0.0)
        des = n - scr
        if pos == 'QB':
            if G:
                m['desg'] = des / G
                m['scrg'] = scr / G
            if des >= 1:
                d['des'] = des
                m['epades'] = (rush['car_epa'] - rush.get('scr_epa', 0.0)) / des
            if scr >= 1:
                d['scrn'] = scr
                m['epascr'] = rush.get('scr_epa', 0.0) / scr
                m['ypscr'] = rush.get('scr_yds', 0.0) / scr
        if t.get('t_car'):
            m['carshr'] = min(100.0, n / t['t_car'] * 100.0)
        if t.get('t_i10'):
            m['i10shr'] = min(100.0, rush.get('i10', 0.0) / t['t_i10'] * 100.0)
        if t.get('t_i5'):
            m['i5shr'] = min(100.0, rush.get('i5', 0.0) / t['t_i5'] * 100.0)
        if rush.get('i5'):
            d['car5'] = rush['i5']
            m['gltd'] = rush.get('i5_td', 0.0) / rush['i5'] * 100.0
        if rush.get('sy'):
            d['sy'] = rush['sy']
            m['syconv'] = rush.get('sy_conv', 0.0) / rush['sy'] * 100.0
        inside = sum(rush.get('g_' + g, 0.0) for g in ('lg', 'md', 'rg'))
        outside = sum(rush.get('g_' + g, 0.0) for g in ('le', 'lt', 'rt', 're'))
        if inside + outside >= 1:
            d['cargap'] = inside + outside
            m['insidepct'] = inside / (inside + outside) * 100.0
            if inside >= 1:
                d['carin'] = inside
                m['ypcin'] = sum(rush.get('gy_' + g, 0.0) for g in ('lg', 'md', 'rg')) / inside
            if outside >= 1:
                d['carout'] = outside
                m['ypcout'] = sum(rush.get('gy_' + g, 0.0) for g in ('le', 'lt', 'rt', 're')) / outside
        if y >= tier[5]:
            v = num(ng.get('rus_rush_pct_over_expected'))
            if v is not None:
                m['roepct'] = v * 100.0
            v = num(ng.get('rus_efficiency'))
            if v is not None:
                m['ngseff'] = v
    if car >= 1 and frush and y >= tier[7]:
        if frush.get('bl_n'):
            d['carl'] = frush['bl_n']
            m['ypclight'] = frush['bl_yds'] / frush['bl_n']
        if frush.get('bs_n'):
            d['cars'] = frush['bs_n']
            m['ypcstack'] = frush['bs_yds'] / frush['bs_n']
        if frush.get('sneak'):
            d['sneak'] = frush['sneak']
            m['sneakconv'] = frush['sneak_conv'] / frush['sneak'] * 100.0

    # ------------------------------------------------------------------ receiving
    if rec and rec.get('tgt'):
        n = rec['tgt']
        if t.get('t_recy'):
            m['recyshr'] = max(0.0, min(100.0, rec.get('yds', 0.0) / t['t_recy'] * 100.0))
        if t.get('t_rectd'):
            m['rectdshr'] = min(100.0, rec.get('td', 0.0) / t['t_rectd'] * 100.0)
        if t.get('t_recfd'):
            m['recfdshr'] = min(100.0, rec.get('fd', 0.0) / t['t_recfd'] * 100.0)
        if y >= tier[3]:
            if rec.get('cp_n'):
                m['croe'] = (rec.get('cp_rec', 0.0) - rec['cp_sum']) / rec['cp_n'] * 100.0
            for band, ck, dk in (('s', 'crsh', 'tgtsh'), ('m', 'crmd', 'tgtmd'), ('d', 'crdp', 'tgtdp')):
                a, c, yd = _band(rec, band)
                if a >= 1:
                    d[dk] = a
                    m[ck] = c / a * 100.0
                    if band == 'd':
                        m['yptdp'] = yd / a
            if G:
                m['eztgt'] = rec.get('ez', 0.0) / G
            if t.get('t_ez'):
                m['ezshr'] = min(100.0, rec.get('ez', 0.0) / t['t_ez'] * 100.0)
            if rec.get('td3'):
                d['tgt3'] = rec['td3']
                m['c3conv'] = rec.get('td3_conv', 0.0) / rec['td3'] * 100.0
        if y >= tier[2] and rec.get('xyac_n'):
            m['yacoex'] = (rec.get('xyac_yac', 0.0) - rec['xyac']) / rec['xyac_n']
    if rec and G and (rec.get('tgt') or rec.get('dpi')):
        m['dpiyds'] = rec.get('dpi_yds', 0.0) / G
    if tgt >= 1 and x.get('psnap') and y >= tier[5]:
        ps = x['psnap']
        if ps >= 1:
            d['psnap'] = ps
            m['tpps'] = tgt / ps * 100.0
            m['ypps'] = (num(r.get('receiving_yards'), 0) or 0) / ps
            if x.get('ps_est'):
                est += ['tpps', 'ypps']
    if frec and y >= tier[7]:
        ct = frec.get('chart_tgt') or 0
        if ct:
            m['scrnpct'] = frec.get('screen', 0.0) / ct * 100.0
        rn = frec.get('rd_n') or 0
        if rn:
            m['frpct'] = frec.get('rd_1', 0.0) / rn * 100.0
            m['despct'] = frec.get('rd_des', 0.0) / rn * 100.0
            m['chkpct'] = frec.get('rd_chk', 0.0) / rn * 100.0
        if t.get('t_rd1'):
            m['frshr'] = min(100.0, frec.get('rd_1', 0.0) / t['t_rd1'] * 100.0)

    # ------------------------------------------------------------------ blocking
    blocker = pos in LINE or pos == 'TE'
    if blocker and G and (off_s or pens):
        # A blocker who was never flagged has no row in the penalty table. That is a clean
        # sheet, not a missing one - and leaving it missing meant the pool these rows are
        # ranked in held only the men who had been flagged.
        pp = pens or {}
        m.setdefault('fsg', pp.get('pen_fs', 0.0) / G)
        m.setdefault('holdg', pp.get('pen_hold', 0.0) / G)
        m.setdefault('pen', pp.get('pen', 0.0) / G)
        m['penydsg'] = pp.get('pen_yds', 0.0) / G
        m['penepag'] = pp.get('pen_epa', 0.0) / G
        if off_s:
            m['pensnap'] = pp.get('pen', 0.0) / off_s * 100.0
    u = x.get('unit')
    if pos in LINE and u and u.get('db'):
        if not onf:
            # No on-field file yet: the unit's numbers, weighted by how much of each game
            # he played. Against the real thing on 2025 these land at r = 0.97 to 0.99.
            d['pblk'] = u['db']
            d['rblk'] = u.get('run', 0.0)
            if G:
                m['pblkg'] = u['db'] / G
                m['rblkg'] = u.get('run', 0.0) / G
            m['sackallow'] = u['sk'] / u['db'] * 100.0
            m['epadbon'] = u['pepa'] / u['db']
            m['srdbon'] = u['psucc'] / u['db'] * 100.0
            est += ['pblkg', 'rblkg', 'sackallow', 'epadbon', 'srdbon']
            if u.get('rush_n'):
                m['rushfaced'] = u['rush_sum'] / u['rush_n']
                est.append('rushfaced')
            if u.get('run'):
                m['ypcon'] = u['ryds'] / u['run']
                m['srrunon'] = u['rsucc'] / u['run'] * 100.0
                m['stuffon'] = u['stuff'] / u['run'] * 100.0
                est += ['ypcon', 'srrunon', 'stuffon']
            if u.get('box_n'):
                m['boxfaced'] = u['box_sum'] / u['box_n']
                est.append('boxfaced')
        d.setdefault('pblk', u['db'])
        m['hitallow'] = u['hit'] / u['db'] * 100.0
        if u.get('cprs_db') and y >= tier[6]:
            m['prsqb'] = u['cprs'] / u['cprs_db'] * 100.0
        if u.get('gn', 0) >= 1:
            d['gaprun'] = u['gn']
            m['gapsr'] = u['gs'] / u['gn'] * 100.0
            m['gapypc'] = u['gy'] / u['gn']
            m['gapstf'] = u['gf'] / u['gn'] * 100.0
    wo = x.get('wo')
    if pos in LINE and wo and wo.get('on_g', 0) >= 2 and wo.get('off_g', 0) >= 1:
        d['gmiss'] = wo['off_g']
        if wo.get('on_db') and wo.get('off_db', 0) >= 25:
            m['wosack'] = (wo['on_sk'] / wo['on_db'] - wo['off_sk'] / wo['off_db']) * 100.0
        if wo.get('on_run') and wo.get('off_run', 0) >= 15:
            m['worun'] = (wo['on_rs'] / wo['on_run'] - wo['off_rs'] / wo['off_run']) * 100.0

    # ------------------------------------------------------------------ defense
    if pos in DEFENSE:
        dfn = x.get('dfn') or {}
        dsk = num(r.get('def_sacks'), 0) or 0
        prs = num(pf.get('def_prss')) if (pf and y >= tier[6]) else None
        if dfn.get('rt'):
            d['rtkl'] = dfn['rt']
            m['rstopshr'] = dfn.get('rs', 0.0) / dfn['rt'] * 100.0
            m['tkldepth'] = dfn.get('rd', 0.0) / dfn['rt']
        if G and (dfn.get('rt') or def_s):
            m['rstopg'] = dfn.get('rs', 0.0) / G
        if dfn.get('skn'):
            d['sk'] = dfn['skn']
            m['skepa'] = dfn['ske'] / dfn['skn']
            m['skyds'] = dfn['sky'] / dfn['skn']
            m['sk3pct'] = dfn.get('sk3', 0.0) / dfn['skn'] * 100.0
        if dfn.get('ptk'):
            d['ptk'] = dfn['ptk']
            m['ptkgain'] = dfn['pty'] / dfn['ptk']
        if def_s and y >= tier[4]:
            hv = sum(num(r.get(k), 0) or 0 for k in ('def_tackles_for_loss', 'def_fumbles_forced',
                                                    'def_pass_defended', 'def_interceptions'))
            m['havoc'] = hv / def_s * 100.0
        if G and def_s:
            pp = pens or {}
            m['jumpg'] = pp.get('pen_jump', 0.0) / G
            m['roughg'] = pp.get('pen_rough', 0.0) / G
            m['covpeng'] = pp.get('pen_cov', 0.0) / G
            m['covpenyds'] = pp.get('pen_cov_yds', 0.0) / G
        if prs is not None and t.get('t_prss'):
            m['prsshr'] = min(100.0, prs / t['t_prss'] * 100.0)
        dp, dr = x.get('dpass'), x.get('drun')
        if dp and dp >= 1 and y >= tier[5]:
            d['dpass'] = dp
            flag = bool(x.get('dp_est'))
            made = ['passshr', 'skpass']
            m['passshr'] = dp / (dp + (dr or 0.0)) * 100.0
            m['skpass'] = dsk / dp * 100.0
            if dr and dr >= 1:
                d['drun'] = dr
                m['rstoprate'] = dfn.get('rs', 0.0) / dr * 100.0
                made.append('rstoprate')
            if prs is not None:
                m['prsspass'] = prs / dp * 100.0
                made.append('prsspass')
            if pf and y >= tier[6]:
                bl = num(pf.get('def_bltz'))
                if bl is not None:
                    m['blitzrate'] = bl / dp * 100.0
                    made.append('blitzrate')
                ct = num(pf.get('def_tgt'))
                if ct is not None and ct > 0:
                    m['ctgtpass'] = ct / dp * 100.0
                    made.append('ctgtpass')
                    cy = num(pf.get('def_yds'))
                    if cy is not None:
                        m['ycpass'] = cy / dp
                        made.append('ycpass')
            if flag:
                est += made
        if pf and y >= tier[6]:
            ct = num(pf.get('def_tgt'))
            if ct is not None and ct > 0:
                td = num(pf.get('def_td'))
                if td is not None:
                    m['tdallrate'] = td / ct * 100.0
                air, cm = num(pf.get('def_air')), num(pf.get('def_cmp'))
                if air is not None and cm:
                    m['airall'] = air / cm
        on = x.get('don')
        if on and y >= tier[5]:
            if on['dpass'] >= 60 and on['o_dpass'] >= 60:
                m['dpepaoo'] = on['dpepa'] / on['dpass'] - on['o_dpepa'] / on['o_dpass']
            if on['drun'] >= 50 and on['o_drun'] >= 50:
                m['drsroo'] = (on['drsucc'] / on['drun'] - on['o_drsucc'] / on['o_drun']) * 100.0

    # ------------------------------------------------------------------ kicking
    kk = x.get('kick')
    if kk:
        if kk.get('ko'):
            d['ko'] = kk['ko']
            m['kotb'] = kk['ko_tb'] / kk['ko'] * 100.0
            m['kooob'] = kk['ko_oob'] / kk['ko'] * 100.0
            if kk.get('ko_dn'):
                m['kodist'] = kk['ko_dist'] / kk['ko_dn']
        if pos == 'K' and kk.get('k_n'):
            m['kwpa'] = kk.get('k_wpa', 0.0)
            over = n = 0.0
            for lst, made in ((kk.get('fgo_made', []), 1.0), (kk.get('fgo_miss', []), 0.0)):
                for dist in lst:
                    p = pmake(y, int(dist))
                    if p is not None:
                        over += made - p
                        n += 1
            if n:
                d['fgaout'] = n
                m['fgoeout'] = over / n
    if pos == 'K' and G and (num(r.get('fg_att'), 0) or num(r.get('pat_att'), 0)):
        pts = kicker_points(r.get('fg_made_list')) + (num(r.get('pat_made'), 0) or 0)
        m['fppg'] = pts / G
    pu = x.get('punt')
    if pu and pu.get('pn'):
        m['pin10'] = pu.get('pin10', 0.0) / pu['pn'] * 100.0
        if pu.get('noe_n'):
            m['pnoe'] = pu['noe'] / pu['noe_n']

    # ------------------------------------------------------------------ value
    xf = x.get('xfp')
    if xf and G and y >= tier[2] and pos in ('QB', 'RB', 'WR', 'TE'):
        m['xfpg'] = xf['x'] / G
        m['fpoeg'] = xf['diff'] / G
        m['tdoeg'] = (xf['td'] - xf['tdx']) / G

    # ------------------------------------------------------------------ special teams
    st, rt, dfn = x.get('st') or {}, x.get('ret') or {}, x.get('dfn') or {}
    share = st['st'] / st['stt'] * 100.0 if st.get('stt') else None
    returner = (rt.get('kr_n', 0) >= 4) or (rt.get('pr_n', 0) >= 4)
    if pos not in ('K', 'P', 'QB') and ((share is not None and share >= 20.0) or returner):
        if share is not None and y >= tier[4]:
            m['stshr'] = min(100.0, share)
        if G:
            m['sttklg'] = dfn.get('stk', 0.0) / G
        for k in ('kr', 'pr'):
            n = rt.get(k + '_n', 0)
            if n >= 4:
                d[k] = n
                m[k + 'avg'] = rt[k + '_yds'] / n
                m[k + 'epa'] = rt[k + '_epa'] / n
    return est


# ---------------------------------------------------------------------------------------
# Season-level pieces main() attaches: priors, contracts, roster status, the team block.
# ---------------------------------------------------------------------------------------
def write_priors(S, pos_of):
    """Save each defender's real-to-naive pass-snap ratio from a finished season.

    Next season, before the on-field file exists, a defender's pass-play snaps are his snap
    count times the opponent's pass rate times this ratio. A nose tackle who left the field
    on third down last year probably still does; his own ratio says so better than his
    position's does. Only ever moves forward: an older season never overwrites a newer one.
    """
    have = load_priors()
    if (have.get('season') or 0) > S.y:
        return None
    per, by_pos = {}, defaultdict(list)
    for gid, on in S.don.items():
        pos = pos_of.get(gid)
        if pos not in DEFENSE or (on['dpass'] + on['drun']) < 150:
            continue
        snaps = S.snapw.get(gid) or []
        got = S._pass_snaps_def(gid, pos, snaps)
        if not got or got.get('dp_est') or got['dnaive'] < 60:
            continue
        ratio = got['dpass'] / got['dnaive']
        if 0.4 <= ratio <= 1.6:
            per[gid] = round(ratio, 4)
            by_pos[pos].append(ratio)
    if len(per) < 200:
        return None
    pos_ratio = {}
    for pos, v in by_pos.items():
        v.sort()
        pos_ratio[pos] = round(v[len(v) // 2], 4)
    with open(PRIORS, 'w') as f:
        json.dump({'season': S.y, 'pos': pos_ratio, 'def': per}, f, separators=(',', ':'),
                  sort_keys=True)
    return len(per), pos_ratio


def load_contracts():
    """{gsis_id: [(year_signed, years, apy, cap share, guaranteed, active)]}, newest first.

    OverTheCap's list, one row a deal. Money is in millions of dollars."""
    p = os.path.join(RAW, 'contracts.parquet')
    if not os.path.exists(p):
        return {}
    df = pd.read_parquet(p, columns=['gsis_id', 'is_active', 'year_signed', 'years', 'apy',
                                     'apy_cap_pct', 'guaranteed'])
    df = df[df.gsis_id.notna() & df.year_signed.notna()]
    out = defaultdict(list)
    for r in df.itertuples(index=False):
        ys, yrs, apy = num(r.year_signed), num(r.years, 0) or 0, num(r.apy)
        if not ys or ys < 1990 or apy is None or apy <= 0:
            continue
        out[r.gsis_id].append((int(ys), int(yrs), apy, num(r.apy_cap_pct), num(r.guaranteed),
                               bool(r.is_active)))
    for v in out.values():
        v.sort(key=lambda t: (t[0], t[5]), reverse=True)
    return dict(out)


def contract_for(deals, y, current):
    """The deal he was playing on in season y, as [apy, cap share %, guaranteed, years,
    year signed], or None.

    For the season in progress that is the deal OverTheCap marks active. For a past season
    it is the last one signed by that season whose years reach it - and where the length
    is not recorded, the last one signed, full stop, as long as a newer one had not
    replaced it."""
    if not deals:
        return None
    pick = None
    if current:
        pick = next((d for d in deals if d[5] and d[0] <= y), None)
    if pick is None:
        for d in deals:                              # newest first
            if d[0] > y:
                continue
            if d[1] and y >= d[0] + d[1]:
                break                                # the newest deal by then had run out
            pick = d
            break
    if pick is None:
        return None
    out = [round(pick[2], 3), None if pick[3] is None else round(pick[3] * 100.0, 2),
           None if pick[4] is None else round(pick[4], 2), pick[1] or None, pick[0]]
    return out


# What the weekly roster file's codes mean, in the words a card can print. Anything on the
# reserve list with a code not named here is still on the reserve list.
ROSTER_CODES = {'R01': 'IR', 'R48': 'IRR', 'R04': 'PUP', 'R05': 'NFI', 'R02': 'RET',
                'R40': 'SUS', 'R27': 'SUS'}


def load_roster_status(y):
    """Where every man on a roster stood in the latest week: {gid: (code, team, name, pos)}.

    Codes: ACT active, INA inactive on game day, IR injured reserve, IRR injured reserve
    and designated to return, PUP, NFI, SUS, RES (some other reserve list), PS practice
    squad, CUT, RET. Only meaningful for a season in progress."""
    p = os.path.join(RAW, 'rosterw_%d.csv' % y)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return {}
    last = {}
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            if (r.get('game_type') or 'REG') != 'REG':
                continue
            gid = (r.get('gsis_id') or '').strip()
            wk = num(r.get('week'), 0) or 0
            if not gid:
                continue
            if gid not in last or wk >= last[gid][0]:
                last[gid] = (wk, r)
    if not last:
        return {}
    top = max(w for w, _ in last.values())
    out = {}
    for gid, (wk, r) in last.items():
        st = (r.get('status') or '').strip().upper()
        ab = (r.get('status_description_abbr') or '').strip().upper()
        if wk < top:
            code = 'CUT'                 # off every roster since: released or unsigned
        elif st == 'ACT':
            code = 'ACT'
        elif st == 'INA':
            code = 'INA'
        elif st == 'RES':
            code = ROSTER_CODES.get(ab, 'RES')
        elif st == 'DEV':
            code = 'PS'
        elif st in ('CUT', 'RET'):
            code = st
        elif st == 'EXE':
            code = 'RES'
        else:
            continue
        out[gid] = (code, (r.get('team') or '').strip(), (r.get('full_name') or '').strip(),
                    (r.get('position') or '').strip())
    return out


def _rank(vals, lower):
    """{key: 1-based rank}, 1 = best. Ties share the better rank."""
    order = sorted(vals.items(), key=lambda kv: kv[1], reverse=not lower)
    out, prev, rank = {}, None, 0
    for i, (k, v) in enumerate(order):
        if v != prev:
            rank, prev = i + 1, v
        out[k] = rank
    return out


def team_block(S, records, pos_of):
    """Every team's season in one small block, for the team page.

      g     games in the play-by-play
      o     offense: [EPA per play, success %, EPA per dropback, EPA per designed run,
            sack rate %, points per game]
      d     defense: the same six, allowed
      orank / drank   where each of those ranks, 1 = best in the league
      vs    what the defense has given up to each position, per game:
              WR, TE: [targets, yards, touchdowns, EPA per target, rank]
              RB:     [carries + targets, scrimmage yards, touchdowns, EPA per touch chance, rank]
            The rank is on EPA per play, 1 = hardest defense for that position.
    """
    off, dfn = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    for (wk, tm), r in S.TW.items():
        for side, key in ((off, tm), (dfn, r.get('opp'))):
            if not isinstance(key, str):
                continue
            a = side[key]
            a['g'] += 1
            for k in ('t_plays', 't_epa', 't_succ', 'db', 'pepa', 'sk', 'run', 'repa'):
                a[k] += float(r.get(k) or 0)
    teams = {}
    stats = {}
    for name, side in (('o', off), ('d', dfn)):
        for tm, a in side.items():
            if not a['t_plays'] or not a['db'] or not a['run']:
                continue
            tr = records.get((tm, S.y)) or {}
            pts = tr.get('pf' if name == 'o' else 'pa')
            games = (tr.get('w', 0) + tr.get('l', 0) + tr.get('t', 0)) or a['g']
            row = [a['t_epa'] / a['t_plays'], a['t_succ'] / a['t_plays'] * 100.0,
                   a['pepa'] / a['db'], a['repa'] / a['run'], a['sk'] / a['db'] * 100.0,
                   (pts / games) if (pts is not None and games) else None]
            stats[(name, tm)] = row
            teams.setdefault(tm, {})['g'] = int(off[tm]['g']) if tm in off else int(a['g'])
    # ranks: for the offense more is better except sack rate; for the defense the reverse
    for name in ('o', 'd'):
        for i in range(6):
            vals = {tm: row[i] for (n, tm), row in stats.items() if n == name and row[i] is not None}
            lower = (i == 4) if name == 'o' else (i != 4)
            ranks = _rank(vals, lower)
            for tm, rk in ranks.items():
                teams[tm].setdefault(name + 'rank', [None] * 6)[i] = rk
    for (name, tm), row in stats.items():
        teams[tm][name] = [None if v is None else round(v, 2 if i in (1, 4, 5) else 4)
                           for i, v in enumerate(row)]

    # what each defense has allowed, by the position of the man with the ball
    vs = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for r in S.pbp.get('rec', []):
        pos, opp = pos_of.get(r['pid']), r.get('opp')
        if pos in ('WR', 'TE', 'RB') and isinstance(opp, str):
            a = vs[opp][pos]
            a['n'] += float(r.get('tgt') or 0)
            a['yds'] += float(r.get('yds') or 0)
            a['td'] += float(r.get('td') or 0)
            a['epa'] += float(r.get('tgt_epa') or 0)
    for r in S.pbp.get('rush', []):
        pos, opp = pos_of.get(r['pid']), r.get('opp')
        if pos == 'RB' and isinstance(opp, str):
            a = vs[opp][pos]
            a['n'] += float(r.get('car') or 0)
            a['yds'] += float(r.get('yds') or 0)
            a['td'] += float(r.get('td') or 0)
            a['epa'] += float(r.get('car_epa') or 0)
    for pos in ('WR', 'TE', 'RB'):
        vals = {tm: v[pos]['epa'] / v[pos]['n'] for tm, v in vs.items() if v[pos]['n'] >= 10}
        ranks = _rank(vals, True)
        for tm, rk in ranks.items():
            if tm not in teams:
                continue
            g = float(dfn[tm]['g'] or 1)
            a = vs[tm][pos]
            teams[tm].setdefault('vs', {})[pos] = [round(a['n'] / g, 1), round(a['yds'] / g, 1),
                                                   round(a['td'] / g, 2), round(vals[tm], 3), rk]
    return teams


def patch_ids(by_pfr, bio, seasons):
    """Snap counts name a man by his PFR id, and a handful of men have none on file.

    Each of those took the field and got no card - or got a card with no snaps on it. Where
    his name matches exactly one man in the player table who has no PFR id of his own, that
    is him. Anything less certain is left alone: two men with one name is how a rookie
    guard ends up wearing a retired linebacker's career.
    """
    def norm(s):
        return ''.join(ch for ch in str(s).lower() if ch.isalnum())
    free = defaultdict(list)
    for gid, b in bio.items():
        if not b.get('pfr') and b.get('name'):
            free[norm(b['name'])].append(gid)
    added = {}
    for y in seasons:
        p = os.path.join(RAW, 'snaps_%d.csv' % y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            continue
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                pid = (r.get('pfr_player_id') or '').strip()
                if not pid or pid in by_pfr or pid in added:
                    continue
                cands = free.get(norm(r.get('player') or ''), [])
                # he has to have been in the league that year
                cands = [g for g in cands if (bio[g].get('rookie') or 0) <= y
                         and y - (bio[g].get('rookie') or y) <= 22]
                if len(cands) == 1:
                    added[pid] = cands[0]
    by_pfr.update(added)
    return added
