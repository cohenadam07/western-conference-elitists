"""Week-by-week game lines, every season -> public/football-weekly/<season>/.

The page's per-stat chart has always been season by season, because build.py rolls every
weekly aggregate into a season total before the page sees it. This stage keeps the weeks
apart. For every game a player appeared in, it runs the very same build_player() the
season build uses, over that one week's inputs, so a game's yards per attempt is worked out
exactly the way the season's is - same formulas, same eras, same cohort panels. Nothing
here is a second implementation of a metric.

What goes into one game:
  * the weekly stat line (stats_player_week) in place of the season line
  * that week's snap counts, play-by-play aggregates and FTN charting
  * that week's Next Gen Stats row and ESPN's game-level QBR
  * PFR's charting from its weekly files (2018 on): pressures, coverage, broken tackles,
    and the quarterback's pressure and bad-throw counts
  * that week's counters from extras.py: snap-share stand-ins for the line, team shares,
    tackles by kind, kicks, drives, expected fantasy points
  * NOT the on/off splits or man-and-zone, which need a whole season to mean anything.
    Metrics that only mean something over a season (games played, availability, starts,
    positions played, the combine, the schedule faced, a contract) are dropped rather
    than shown as a line of 1s.

Recent form. For the season being played this also writes form-4.json, form-8.json and
form-17.json: every player's last four games, last eight and last seventeen, reaching
back into last season where this one has fewer. A window is not an average of game lines:
the games' inputs are added up and build_player() runs once over the sum, exactly as it
does for a season, so a day with no targets counts as a day. (Only the join across the
winter is put together from two rows, the way the page builds a career out of seasons.)
"Last four games" is then ranked against everyone else's last four games.

What comes out of an old season is whatever that season tracked: snap counts start in 2012,
Next Gen Stats in 2016, FTN charting in 2022, game-level QBR in 2006. A 2003 game has its
stat line and its play-by-play rates and nothing else, exactly as the 2003 season card does.

Output. The season in progress is one small file per player, so the page fetches only the
man it is showing and a refresh rewrites only the men who played:

  football-weekly/index.json            {seasons:[1999, ..., 2026]}
  football-weekly/2026/index.json       {s, week, n, teams:{BUF:{"1":"@MIA","2":"NYJ",...}}}
  football-weekly/2026/<gsis_id>.json   {s, pos, w:[1,2], t:[team], o:[opp],
                                         m:{key:[v per week]}, d:{denom:[n per week]}}

A finished season never changes again, and two thousand files a year for twenty-seven
years is fifty thousand files nobody will ever rewrite. So a finished season is packed:
the same per-player records, a hundred to a file, keyed by the last two digits of the
player id. The season's index says so, and the page reads whichever shape it finds:

  football-weekly/2025/index.json       {s, week, n, pack:2, teams:{...}}
  football-weekly/2025/pack-57.json     {"00-0034857":{s, pos, w, t, o, m, d}, ...}

"Finished" is the line build.py draws: the weekly table has reached the last regular-season
week. The first run after that packs the season and removes its per-player files.

A file is rewritten only when its contents change, and nothing in it is a timestamp, so a
refresh that brings no new game touches nothing and the repository's history stays small:
a player's file changes about once a week, when he plays.

  NFL_SEASONS=2026 python3 weekly.py            # writes to $NFL_WEEKLY (default below)
  NFL_SEASONS=1999-2025 python3 weekly.py       # backfill; needs those seasons' raw/ and agg/
"""
import json, numbers, os, sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
import extras as E
import pfr_week
from teams import canon

RAW, AGG = B.RAW, B.AGG
OUT_ROOT = os.environ.get('NFL_WEEKLY', os.path.join('..', '..', 'public', 'football-weekly'))

# A season total, not a game fact. Everything else build_player makes survives.
SEASON_ONLY = {'g', 'avail', 'starts', 'posver', 'comp',
               # one opponent is not a schedule, and a contract is not a game
               'sosp', 'sosr', 'sospr', 'soso', 'epadbadj', 'epacaradj',
               'apy', 'capshr', 'linescore', 'linecont', 'gwo'}

# Rare events. One game of "strip sacks per game" is a row of zeros with a 1 in it: it
# tells nobody anything, and across twenty-eight seasons of game lines it is megabytes of
# zeros the site would ship. These stay season numbers.
RARE = {'offsideg', 'rtpg', 'stripsk', 'sk3rd', 'covpen', 'covpenyds', 'penstall', 'penydg',
        'pen100', 'dpig', 'dpiyds', 'tdall', 'koflag', 'sttk', 'stshr', 'skepa', 'skyd',
        'skshr', 'rtkdepth', 'tkyac', 'maxair', 'fgwpa', 'krg', 'prg'}
SEASON_ONLY |= RARE

# How a window of games is put back together. These mirror CAREER_SUM / CAREER_MAX in the
# page, which does the same job for a career built out of seasons.
FORM_SUM = {'epatot', 'wpa', 'tdoe', 'fgwpa'}
FORM_MAX = {'fglong', 'maxair'}
FORM_WINDOWS = (4, 8, 17)

# A finished season's players are packed by the last PACK characters of their id: two
# digits, so a hundred files a season of about twenty men each. The page fetches one.
PACK = 2


def sig(v):
    """Three significant figures is more than a chart can show and keeps the files small."""
    if v is None:
        return None
    a = abs(v)
    if a >= 100:
        return round(v, 1)
    if a >= 10:
        return round(v, 2)
    return round(v, 3)


def by_week(rows):
    out = defaultdict(dict)
    for r in rows:
        out[int(r['week'])][r['pid']] = r
    return out


def load_week_pbp(y):
    p = os.path.join(AGG, 'pbp_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}, {}, {}
    j = json.load(open(p))
    return by_week(j['qb']), by_week(j['rush']), by_week(j['rec']), by_week(j.get('pen', []))


def load_week_ftn(y):
    p = os.path.join(AGG, 'ftn_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}, {}
    j = json.load(open(p))
    return by_week(j.get('qb', [])), by_week(j.get('rush', [])), by_week(j.get('rec', []))


def load_week_snaps(y, by_pfr):
    """snap[(gid, y)] and starts[gid] for each week, shaped exactly as the season loaders
    shape them, so build_player can't tell a game from a season."""
    p = os.path.join(RAW, 'snaps_%d.csv' % y)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return {}
    df = pd.read_csv(p, low_memory=False)
    if 'game_type' in df.columns:
        df = df[df.game_type == 'REG']
    for c in ('offense_snaps', 'defense_snaps', 'st_snaps', 'offense_pct'):
        df[c] = pd.to_numeric(df[c], errors='coerce')
    off_team = df.groupby(['game_id', 'team']).offense_snaps.max()
    def_team = df.groupby(['game_id', 'team']).defense_snaps.max()
    idx = df.set_index(['game_id', 'team']).index
    df['off_team'] = idx.map(off_team)
    df['def_team'] = idx.map(def_team)
    out = defaultdict(lambda: ({}, {}))
    for r in df.itertuples(index=False):
        gid = by_pfr.get(r.pfr_player_id)
        if not gid:
            continue
        snap, starts = out[int(r.week)]
        o, dd, s = (float(x) if x == x else 0.0 for x in (r.offense_snaps, r.defense_snaps, r.st_snaps))
        snap[(gid, y)] = dict(off=o, dfn=dd, st=s, gp=1,
                              offt=float(r.off_team or 0) if r.off_team == r.off_team else 0.0,
                              deft=float(r.def_team or 0) if r.def_team == r.def_team else 0.0)
        played = 1 if (o or dd or s) else 0
        starts[gid] = dict(starts=int((r.offense_pct or 0) >= 0.5), vers=0, games=played)
    return out


def load_week_ngs(y):
    out = defaultdict(lambda: defaultdict(dict))
    for kind in ('passing', 'rushing', 'receiving'):
        p = os.path.join(RAW, 'ngs_%s.csv' % kind)
        if not os.path.exists(p):
            continue
        df = pd.read_csv(p, low_memory=False)
        df = df[(df.season == y) & (df.week > 0) & (df.season_type == 'REG')]
        for r in df.to_dict('records'):
            gid = r.get('player_gsis_id')
            if isinstance(gid, str):
                out[int(r['week'])][(gid, y)].update({kind[:3] + '_' + k: v for k, v in r.items()})
    return out


def load_week_qbr(y, by_espn):
    p = os.path.join(RAW, 'qbr_week.csv')
    out = defaultdict(dict)
    if not os.path.exists(p):
        return out
    df = pd.read_csv(p, low_memory=False)
    df = df[(df.season == y) & (df.season_type == 'Regular')]
    for r in df.itertuples(index=False):
        gid = by_espn.get(str(int(r.player_id))) if B.num(r.player_id) else None
        wk = B.num(r.game_week)
        if gid and wk:
            out[int(wk)][(gid, y)] = B.num(r.qbr_total)
    return out


def team_slates(y):
    """Every team's opponent by week, '@' for a road game, 'BYE' for the week off -
    so a gap in a man's line can say whether he sat or his team did."""
    p = os.path.join(RAW, 'schedules.csv')
    if not os.path.exists(p):
        return {}
    g = pd.read_csv(p, low_memory=False)
    g = g[(g.season == y) & (g.game_type == 'REG')]
    out = defaultdict(dict)
    for r in g.itertuples(index=False):
        home, away = canon(r.home_team), canon(r.away_team)   # one code per franchise (teams.CANON)
        out[home][str(int(r.week))] = away
        out[away][str(int(r.week))] = '@' + home
    last = int(g.week.max()) if len(g) else 0
    for t in out:
        for w in range(1, last + 1):
            out[t].setdefault(str(w), 'BYE')
    return {t: dict(sorted(v.items(), key=lambda kv: int(kv[0]))) for t, v in out.items()}


def write_if_changed(path, obj):
    body = json.dumps(B.clean(obj), separators=(',', ':'), allow_nan=False)
    if os.path.exists(path):
        with open(path) as f:
            if f.read() == body:
                return False
    with open(path, 'w') as f:
        f.write(body)
    return True


# ---------------------------------------------------------------------- a span of games
# A window of games is not an average of game lines. A line leaves a stat out on a day
# there was nothing to count (no targets, no pressure charted), and an average of the
# lines that remain forgets those days: built that way, the median interior lineman's
# pressure rate through four weeks came out two thirds too high, and "last four games" in
# week 4 disagreed with the season it was identical to. So a span is built the way a
# season is: the games' inputs are added up, and build_player() runs once over the sum.

# Dropped from a window or a through-week-N line: facts about a whole season or a man.
SPAN_DROP = {'g', 'avail', 'starts', 'posver', 'comp', 'apy', 'capshr',
             'linescore', 'linecont', 'gwo',
             # "yards run per yard gained" is published as a ratio per game and cannot be
             # added back up: a span of games read a full standard deviation high
             'rueff'}
# Rows that come ready-made for a season from Next Gen Stats or ESPN and can only be
# approximated from games (the games weighted by throws, carries or targets). Close enough
# for a window, where every player is treated alike; not for the same-point baselines,
# where the card on screen holds the published season figure and history would hold the
# approximation, a tenth to a sixth of a standard deviation apart.
PACE_SKIP = {'ropct', 'box8', 'yacoe', 'qbr'}
# Columns of the weekly stat line that are not counts.
STAT_MAX = ('fg_long', 'pt_long')
STAT_JOIN = ('fg_made_list', 'fg_missed_list', 'fg_blocked_list')
STAT_RATE = ('pacr', 'racr', 'target_share', 'air_yards_share', 'wopr', 'fg_pct', 'pat_pct')
# Next Gen Stats come as a rate per game, so a span is the games weighted by how much
# there was of each: throws, carries, targets.
NGS_WEIGHT = {'pas': 'pas_attempts', 'rus': 'rus_rush_attempts', 'rec': 'rec_targets'}
NGS_MAX = ('pas_max_completed_air_distance', 'pas_max_air_distance')
# Per-game counts, for joining a span of this season to the tail of last: a part with
# games in it and none of these is a zero, not a gap.
ZERO_FILL = {m['key'] for m in B.METRICS
             if m['den'] == 'g' and m['label'].endswith('/ game')} - {
                 'snaps', 'xfp', 'fpoe', 'fppg', 'pblkg', 'rblkg'}


def _add(acc, row):
    if row:
        for k, v in row.items():
            if k in ('pid', 'week'):
                continue
            if isinstance(v, numbers.Number) and v == v:
                acc[k] = acc.get(k, 0.0) + float(v)


class _Acc(object):
    """One player's inputs, added up over the weeks handed to add()."""

    def __init__(self, I, gid):
        self.I, self.gid, self.key = I, gid, (gid, I.y)
        self.weeks = []
        self.r, self.cp = {}, [0.0, 0.0]
        self.ng_x, self.ng_w, self.ng_max, self.ng_other = {}, {}, {}, {}
        self.snap, self.starts = {}, {}
        self.q = [0.0, 0.0]
        self.parts = dict(qb={}, rush={}, rec={}, pen={}, fqb={}, frush={}, frec={})

    def add(self, w):
        I, gid, key = self.I, self.gid, self.key
        line = I.lines.get(w, {}).get(gid)
        if line is None:
            return False
        self.weeks.append(w)
        out = self.r
        for k, v in line.items():
            tv = type(v)
            if tv is float or tv is int:         # the common case, kept cheap: 25,000 games a season
                if v != v or k in STAT_RATE:
                    continue
                if k == 'passing_cpoe':
                    a = B.num(line.get('attempts'), 0) or 0
                    if a:
                        self.cp[0] += v * a
                        self.cp[1] += a
                elif k in STAT_MAX:
                    out[k] = max(out.get(k, v), v)
                elif k == 'week' or k == 'season':
                    out[k] = v
                else:
                    out[k] = out.get(k, 0) + v
            elif tv is str:
                if k in STAT_JOIN:
                    if v:
                        out[k] = (out[k] + ';' + v) if out.get(k) else v
                else:
                    out[k] = v                   # ids, names, and the latest team
            elif tv is bool:
                out[k] = bool(out.get(k)) or v
            elif isinstance(v, numbers.Number) and v == v and k not in STAT_RATE:
                out[k] = out.get(k, 0) + float(v)
        if self.cp[1]:
            out['passing_cpoe'] = self.cp[0] / self.cp[1]
        ng = I.ngs_w.get(w, {}).get(key)
        if ng:
            for k, v in ng.items():
                if not isinstance(v, numbers.Number) or isinstance(v, bool):
                    self.ng_other[k] = v
                elif v == v:
                    if k in NGS_MAX:
                        self.ng_max[k] = max(self.ng_max.get(k, v), v)
                    else:
                        wt = B.num(ng.get(NGS_WEIGHT.get(k[:3], ''))) or 1.0
                        self.ng_x[k] = self.ng_x.get(k, 0.0) + v * wt
                        self.ng_w[k] = self.ng_w.get(k, 0.0) + wt
        snap, starts = I.snaps_w.get(w, ({}, {}))
        _add(self.snap, snap.get(key))
        _add(self.starts, starts.get(gid))
        q = I.qbr_w.get(w, {}).get(key)
        qrow = I.qb_w.get(w, {}).get(gid)
        if q is not None:
            wt = (qrow or {}).get('db') or 1.0
            self.q[0] += q * wt
            self.q[1] += wt
        for name, table in (('qb', I.qb_w), ('rush', I.rush_w), ('rec', I.rec_w), ('pen', I.pen_w),
                            ('fqb', I.fqb_w), ('frush', I.frush_w), ('frec', I.frec_w)):
            _add(self.parts[name], table.get(w, {}).get(gid))
        return True

    def row(self):
        """(m, d) for the weeks added so far, or None."""
        if not self.weeks:
            return None
        I, gid, key = self.I, self.gid, self.key
        ng = dict(self.ng_other)
        ng.update({k: self.ng_x[k] / self.ng_w[k] for k in self.ng_x if self.ng_w[k]})
        ng.update(self.ng_max)
        pf = I.pfr_span(self.weeks[0], self.weeks[-1]).get(key)
        P = self.parts
        ex = I.S.roll(gid, set(self.weeks))
        return B.build_player(
            dict(self.r), I.cohort[gid], I.bio, {key: ng} if ng else {}, {key: pf} if pf else {},
            {key: dict(self.snap)} if self.snap else {},
            {key: self.q[0] / self.q[1]} if self.q[1] else {}, {},
            dict(P['qb']) or None, dict(P['rush']) or None, dict(P['rec']) or None,
            dict(P['pen']) or None, None, {}, dict(self.starts) or None, len(self.weeks),
            I.pmake, I.y, dict(P['fqb']) or None, dict(P['frush']) or None, dict(P['frec']) or None,
            ex=ex, lg=I.S.lg)


class Inputs(object):
    """Everything build_player() needs for one season, held a week at a time."""

    def __init__(self, y, bio, by_pfr, by_espn, pmake):
        self.y, self.bio, self.pmake = y, bio, pmake
        by_pfr = B.pfr_for(y, by_pfr, bio)         # the PFR-id lookup as it holds this season
        self.by_pfr = by_pfr
        self.ok = False
        wkp = os.path.join(RAW, 'wk_%d.csv' % y)
        regp = os.path.join(RAW, 'reg_%d.csv' % y)
        if not (os.path.exists(wkp) and os.path.exists(regp)):
            return
        self.ok = True
        wk = pd.read_csv(wkp, low_memory=False)
        wk = wk[wk.season_type == 'REG']
        self.last = int(wk.week.max()) if len(wk) else 0
        reg = pd.read_csv(regp, low_memory=False)
        B.note_untracked(y, reg.to_dict('records'))
        line_a = B.load_line(y)
        swaps = B.team_swaps(y)
        # the same counters the season build uses, one week at a time
        S = self.S = E.Season(y, by_pfr, RAW, AGG, pmake,
                              E.load_prior_ratio(os.environ.get('NFL_ARCHIVE'), y - 1), swaps=swaps)

        # The cohort a man is charted in is the one his season is ranked in, so a game's
        # panels are exactly the rows his card shows.
        cohort = self.cohort = {}
        rows = [r for r in reg.to_dict('records') if isinstance(r.get('player_id'), str)]
        rows += S.snap_only({r['player_id'] for r in rows})
        for r in rows:
            gid = r['player_id']
            b = bio.get(gid, {})
            raw = (b.get('pos') or r.get('position')) if r.get('_snap_only') else r.get('position')
            pos = B.cohort(raw, b.get('pff_pos'), b.get('ngs_pos'))
            if pos == 'OL':
                pos = B.line_spot(line_a, S, gid)
            pos = B.secondary_spot(pos, S, gid)
            if pos:
                cohort[gid] = pos
        self.pfr_w = pfr_week.week_rows(y, by_pfr, RAW) if y >= B.TIER_SINCE[6] else {}
        self._pfr = {}
        self.qb_w, self.rush_w, self.rec_w, self.pen_w = load_week_pbp(y)
        self.fqb_w, self.frush_w, self.frec_w = load_week_ftn(y)
        self.snaps_w = load_week_snaps(y, by_pfr)
        self.ngs_w = load_week_ngs(y)
        self.qbr_w = load_week_qbr(y, by_espn)

        # A lineman has no stat line, only snaps. Give every man who took a snap a blank line
        # for that week so he still gets his snaps, snap share and penalties charted.
        lines = self.lines = defaultdict(dict)
        for r in wk.to_dict('records'):
            gid = r.get('player_id')
            if isinstance(gid, str):
                w = int(r['week'])
                r['games'] = 1
                r['team'] = swaps.get((gid, w), canon(r.get('team')))
                r['opponent_team'] = canon(r.get('opponent_team'))
                r['recent_team'] = r['team']
                lines[w][gid] = r
        self.team_of = {}
        for w, (snap, _) in self.snaps_w.items():
            for (gid, _y), sn in snap.items():
                # a man listed with no snaps at all did not play that day
                if gid not in lines[w] and gid in cohort and (sn['off'] or sn['dfn'] or sn['st']):
                    lines[w][gid] = dict(player_id=gid, games=1, _snap_only=True)
        p = os.path.join(RAW, 'snaps_%d.csv' % y)
        if os.path.exists(p):
            sd = pd.read_csv(p, usecols=['week', 'pfr_player_id', 'team', 'opponent', 'game_type'],
                             low_memory=False)
            for r in sd[sd.game_type == 'REG'].itertuples(index=False):
                gid = by_pfr.get(r.pfr_player_id)
                if gid:
                    self.team_of[(gid, int(r.week))] = (canon(r.team), canon(r.opponent))
        self._weeks = defaultdict(list)
        for w in sorted(lines):
            for gid in lines[w]:
                if gid in cohort:
                    self._weeks[gid].append(w)

    def weeks_of(self, gid):
        return self._weeks.get(gid, [])

    def pfr_span(self, w0, w1):
        """PFR's charting added up over weeks w0..w1, as season rows."""
        if self.y < B.TIER_SINCE[6]:
            return {}
        k = (w0, w1)
        if k not in self._pfr:
            self._pfr[k] = self.pfr_w.get(w0, {}) if w0 == w1 else \
                pfr_week.season_rows(self.y, self.by_pfr, RAW, weeks=list(range(w0, w1 + 1)))
        return self._pfr[k]

    def game(self, gid, w):
        """One game's (m, d), with the season-only rows taken out."""
        a = _Acc(self, gid)
        if not a.add(w):
            return None
        m, d = a.row()
        return {k: v for k, v in m.items() if k not in SEASON_ONLY and B.MBY[k]['grp'] != 'ath'}, d

    def span(self, gid, weeks):
        """Those games as one row: (m, d), or None."""
        a = _Acc(self, gid)
        for w in weeks:
            a.add(w)
        return trim(a.row())

    def running(self, gid):
        """(week, m, d) for his line as it stood after each of his games."""
        a = _Acc(self, gid)
        for w in self.weeks_of(gid):
            a.add(w)
            m, d = trim(a.row())
            yield w, m, d


def trim(row):
    """A span's row without what only a season or a man can have."""
    if row is None:
        return None
    m, d = row
    return {k: v for k, v in m.items() if k not in SPAN_DROP and B.MBY[k]['grp'] != 'ath'}, d


def join(rows):
    """Two spans from different seasons as one row: [(m, d), ...] -> (m, d).

    Inside a season a span is exact (see above). Across the winter the two halves are
    put together the way the page builds a career out of seasons: a rate is weighted by
    the sample each half took it over, a total is added, a longest is the longest. A
    per-game count one half has none of counts as that many games of zero."""
    D = defaultdict(float)
    for _, d in rows:
        for k, v in d.items():
            if v:
                D[k] += v
    keys = set()
    for m, _ in rows:
        keys.update(m)
    out = {}
    for key in keys:
        meta = B.MBY.get(key)
        if not meta:
            continue
        have = [(m[key], d) for m, d in rows if m.get(key) is not None]
        if key in FORM_SUM:
            out[key] = sum(v for v, _ in have)
        elif key in FORM_MAX:
            out[key] = max(v for v, _ in have)
        else:
            den = meta['den']
            acc = wt = 0.0
            for m, d in rows:
                w = d.get(den) or 0.0
                if w <= 0:
                    continue
                if m.get(key) is not None:
                    acc += m[key] * w
                    wt += w
                elif key in ZERO_FILL:
                    wt += w
            if wt > 0:
                out[key] = acc / wt
    return out, dict(D)


def games_of(rec):
    """A weekly record back into one (week, m, d) per game."""
    out = []
    for i, w in enumerate(rec['w']):
        m = {k: col[i] for k, col in rec['m'].items() if col[i] is not None}
        d = {k: col[i] for k, col in rec['d'].items() if col[i] is not None}
        out.append((w, m, d))
    return out


def load_packed(season):
    """A finished season's game lines, from the packs this stage wrote for it."""
    d = os.path.join(OUT_ROOT, str(season))
    out = {}
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        if name.startswith('pack-') and name.endswith('.json'):
            with open(os.path.join(d, name)) as f:
                out.update(json.load(f))
    return out


def built_rows(y):
    """{gid: (pos, m, d)} for season y from the data file build.py has just written, so
    that a window which is a man's whole season so far is his season, to the digit: the
    card's own row, not a second working of it. Empty if no such file is to hand."""
    pub = os.path.dirname(os.path.abspath(OUT_ROOT))
    for name in ('football-savant-current.json', 'football-savant-data.json'):
        p = os.environ.get('NFL_BUILT') or os.path.join(pub, name)
        if not os.path.exists(p):
            continue
        with open(p) as f:
            blk = (json.load(f).get('data') or {}).get(str(y))
        if blk:
            return {q['id']: (q['pos'], q['m'], q.get('d') or {}) for q in blk['players']}
        if os.environ.get('NFL_BUILT'):
            break
    return {}


def write_form(y, I, prev, out_dir):
    """form-<n>.json for the season being played: everyone's last n games as one row.

    His last n games are his last n games: where this season has fewer, the rest come
    from the end of last season (if he played the same position then), and the row says
    so in `from`. Where the window is his whole season so far and nothing more, it is the
    card's own row."""
    card = built_rows(y)
    full = 17.0 if y >= 2021 else 16.0
    changed = 0
    for n in FORM_WINDOWS:
        rows = {}
        for gid, pos in I.cohort.items():
            ws = I.weeks_of(gid)
            if not ws:
                continue
            take = ws[-n:]
            mine = card.get(gid)
            if len(take) == len(ws) and mine and mine[0] == pos:
                m = {k: v for k, v in mine[1].items() if k not in SPAN_DROP and B.MBY[k]['grp'] != 'ath'}
                d = dict(mine[2])
            else:
                cur = I.span(gid, take)
                if cur is None:
                    continue
                m, d = cur
            games, since = len(take), y
            if games < n and prev is not None and prev.cohort.get(gid) == pos:
                older = prev.weeks_of(gid)[-(n - games):]
                tail = prev.span(gid, older) if older else None
                if tail:
                    m, d = join([tail, (m, d)])
                    games += len(older)
                    since = y - 1
            if not m:
                continue
            qkey, qmin = B.QUALIFY.get(pos, ('g', 6))
            have = d.get(qkey)
            if have is None and pos in B.QUALIFY_FALLBACK:
                qkey, qmin = B.QUALIFY_FALLBACK[pos]
                have = d.get(qkey)
            need = qmin * min(1.0, games / full)
            row = dict(pos=pos, n=games, m={k: sig(v) for k, v in sorted(m.items())},
                       d={k: round(v, 1) for k, v in sorted(d.items()) if v})
            if have is not None and have >= need:
                row['q'] = 1
            if since != y:
                row['from'] = since
            rows[gid] = row
        changed += write_if_changed(os.path.join(out_dir, 'form-%d.json' % n),
                                    dict(s=y, week=I.last, n=n, players=rows))
    return changed


def build_season(y, bio, by_pfr, by_espn, pmake):
    I = Inputs(y, bio, by_pfr, by_espn, pmake)
    if not I.ok:
        print(y, 'no weekly table - skipped')
        return
    slates = team_slates(y)
    per = defaultdict(lambda: dict(w=[], t=[], o=[], m=defaultdict(dict), d=defaultdict(dict)))
    for w in sorted(I.lines):
        for gid, r in I.lines[w].items():
            if gid not in I.cohort:
                continue
            got = I.game(gid, w)
            if not got or not got[0]:
                continue
            m, d = got
            team = B.sstr(r.get('team')) or (I.team_of.get((gid, w)) or (None,))[0]
            opp = B.sstr(r.get('opponent_team')) or (I.team_of.get((gid, w)) or (None, None))[1]
            # home or away comes from the schedule, which knows; the stat line doesn't
            slate = slates.get(team, {}).get(str(w), '') if team else ''
            if opp and slate.startswith('@'):
                opp = '@' + opp
            e = per[gid]
            e['pos'] = I.cohort[gid]
            e['w'].append(w)
            e['t'].append(team)
            e['o'].append(opp)
            i = len(e['w']) - 1
            for k, v in m.items():
                e['m'][k][i] = sig(v)
            for k, v in d.items():
                if v and k != 'g':
                    e['d'][k][i] = round(v, 1)

    out_dir = os.path.join(OUT_ROOT, str(y))
    os.makedirs(out_dir, exist_ok=True)
    recs = {}
    for gid, e in per.items():
        n = len(e['w'])
        recs[gid] = dict(s=y, pos=e['pos'], w=e['w'], t=e['t'], o=e['o'],
                         m={k: [col.get(i) for i in range(n)] for k, col in sorted(e['m'].items())},
                         d={k: [col.get(i) for i in range(n)] for k, col in sorted(e['d'].items())})
    last = I.last
    # The same line build.py draws between a season in progress and a finished one.
    done = last >= (B.REG_WEEKS if y >= 2021 else 17)
    index = dict(s=y, week=last, n=len(recs), teams=slates)
    changed = 0
    if done:
        packs = defaultdict(dict)
        for gid in sorted(recs):
            packs[gid[-PACK:]][gid] = recs[gid]
        keep = {'index.json'}
        for key, body in packs.items():
            name = 'pack-%s.json' % key
            keep.add(name)
            changed += write_if_changed(os.path.join(out_dir, name), body)
        index['pack'] = PACK
        # the per-player files this season had while it was being played
        for name in os.listdir(out_dir):
            if name.endswith('.json') and name not in keep:
                os.remove(os.path.join(out_dir, name))
                changed += 1
    else:
        keep = {'index.json'} | {'form-%d.json' % n for n in FORM_WINDOWS} | {g + '.json' for g in recs}
        for gid, rec in recs.items():
            changed += write_if_changed(os.path.join(out_dir, gid + '.json'), rec)
        # a file for a man who is no longer in the season's data (an id put right) goes
        for name in os.listdir(out_dir):
            if name.endswith('.json') and name not in keep:
                os.remove(os.path.join(out_dir, name))
                changed += 1
        prev = Inputs(y - 1, bio, by_pfr, by_espn, pmake)
        changed += write_form(y, I, prev if prev.ok else None, out_dir)
    write_if_changed(os.path.join(out_dir, 'index.json'), index)
    print(y, 'weekly: %d players through week %d%s, %d file(s) changed'
          % (len(recs), last, ', packed' if done else '', changed))


def setup():
    """(bio, by_pfr, by_espn, pmake): what every season's Inputs is made with."""
    bio, by_pfr, by_espn = B.load_players()
    curve = {}
    for yy in range(1999, max(B.SEASONS) + 1):
        p = os.path.join(RAW, 'reg_%d.csv' % yy)
        if os.path.exists(p):
            curve[yy] = pd.read_csv(p, usecols=['fg_made_list', 'fg_missed_list'], low_memory=False)
    return bio, by_pfr, by_espn, B.fg_curve(curve)


def main():
    bio, by_pfr, by_espn, pmake = setup()
    for y in B.SEASONS:
        build_season(y, bio, by_pfr, by_espn, pmake)
    # The page asks this which seasons have game lines at all.
    have = sorted(int(n) for n in os.listdir(OUT_ROOT)
                  if n.isdigit() and os.path.exists(os.path.join(OUT_ROOT, n, 'index.json')))
    write_if_changed(os.path.join(OUT_ROOT, 'index.json'), dict(seasons=have))


if __name__ == '__main__':
    main()
