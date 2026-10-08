"""Week-by-week game lines, every season -> public/football-weekly/<season>/, and the
last-four, last-eight and last-seventeen windows for the season in progress ->
public/football-form/.

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
  * that week's PFR charting (2018 on): pressures, coverage, contact yards, missed tackles
  * the team-week inputs every share-of-his-team row divides by (extra.py)
  * NOT participation, which is published after the season. Metrics that only mean
    something over a season (games played, availability, starts, positions played, the
    combine) are dropped rather than shown as a line of 1s.

A game's inputs are all sums, so any set of games adds up the same way one game does
(combine() below). That is the whole of the form windows: a man's last four games are four
games' inputs added together and handed to build_player() - not four games' rates
averaged, which would let a two-carry afternoon count as much as a twenty-carry one. The
windows run back into last season when this one is young; "last seventeen" in week 5 is
five games of this year and twelve of last, and says so.

What comes out of an old season is whatever that season tracked: snap counts start in 2012,
Next Gen Stats in 2016, PFR charting in 2018, FTN charting in 2022, game-level QBR in 2006.
A 2003 game has its stat line and its play-by-play rates and nothing else, exactly as the
2003 season card does.

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

The windows, for the newest season in the run only:

  football-form/index.json              {s, week, windows:[4, 8, 17]}
  football-form/L4.json                 {s, week, n:4, players:[{id, pos, g, q, sp, m, d, est}]}

  g is how many games the window actually holds (a rookie in week 2 has two), q whether
  that is enough to be ranked, sp the span in words.

A file is rewritten only when its contents change, and nothing in it is a timestamp, so a
refresh that brings no new game touches nothing and the repository's history stays small:
a player's file changes about once a week, when he plays.

  NFL_SEASONS=2026 python3 weekly.py            # writes to $NFL_WEEKLY (default below)
  NFL_SEASONS=1999-2025 python3 weekly.py       # backfill; needs those seasons' raw/ and agg/
"""
import json, os, sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
import extra
import pfr_week

RAW, AGG = B.RAW, B.AGG
OUT_ROOT = os.environ.get('NFL_WEEKLY', os.path.join('..', '..', 'public', 'football-weekly'))
FORM_ROOT = os.environ.get('NFL_FORM', os.path.join(os.path.dirname(os.path.abspath(OUT_ROOT)),
                                                    'football-form'))
WINDOWS = (4, 8, 17)

# A season total, not a game fact. Everything else build_player makes survives.
SEASON_ONLY = {'g', 'avail', 'starts', 'posver', 'comp'}

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
        out[r.home_team][str(int(r.week))] = r.away_team
        out[r.away_team][str(int(r.week))] = '@' + r.home_team
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


# ---------------------------------------------------------------- one game, any games
# Columns of the weekly stat line that are ratios of other columns. They cannot be added
# across games; combine() rebuilds the ones build_player() reads and drops the rest.
RATIO_COLS = {'target_share', 'air_yards_share', 'wopr', 'racr', 'pacr', 'passing_cpoe',
              'dakota', 'fg_pct', 'pat_pct'}
LIST_COLS = {'fg_made_list', 'fg_missed_list', 'fg_blocked_list'}
MAX_COLS = {'fg_long'}
# Next Gen Stats come as per-game averages. Across games each is weighted by the plays it
# was an average of; a longest throw is the longest of them.
NGS_WEIGHT = {'pas': 'pas_attempts', 'rus': 'rus_rush_attempts', 'rec': 'rec_targets'}
NGS_OWN_WEIGHT = {'rec_avg_yac_above_expectation': 'rec_receptions'}


class Games:
    """Every game's inputs for one season, loaded once and handed out a game at a time."""

    def __init__(self, y, bio, by_pfr, by_espn, priors=None, live=False):
        self.y, self.ok = y, False
        wkp = os.path.join(RAW, 'wk_%d.csv' % y)
        regp = os.path.join(RAW, 'reg_%d.csv' % y)
        if not (os.path.exists(wkp) and os.path.exists(regp)):
            return
        self.ok = True
        wk = pd.read_csv(wkp, low_memory=False)
        self.wk = wk = wk[wk.season_type == 'REG']
        reg = pd.read_csv(regp, low_memory=False)
        line_a = B.load_line(y)
        self.S = extra.Season(y, by_pfr, priors, live=live)

        # The cohort a man is charted in is the one his season is ranked in, so a game's
        # panels are exactly the rows his card shows. The men with snaps and no stat line
        # are in it too, the same way build.py puts them on the page.
        self.cohort = {}
        def place(gid, season_pos):
            b = bio.get(gid, {})
            pos = B.cohort(season_pos, b.get('pff_pos'), b.get('ngs_pos'))
            if pos == 'OL':
                pos = line_a.get(gid) or 'OL'
            if pos:
                self.cohort[gid] = pos
        for r in reg.to_dict('records'):
            if isinstance(r.get('player_id'), str):
                place(r['player_id'], r.get('position'))
        for gid, si in self.S.snapinfo.items():
            if gid not in self.cohort and si.get('tot') and si.get('pos') not in (None, 'LS'):
                place(gid, si['pos'])

        self.qb_w, self.rush_w, self.rec_w, self.pen_w = load_week_pbp(y)
        self.fqb_w, self.frush_w, self.frec_w = load_week_ftn(y)
        self.snaps_w = load_week_snaps(y, by_pfr)
        self.ngs_w = load_week_ngs(y)
        self.qbr_w = load_week_qbr(y, by_espn)
        self.pfr_c = pfr_week.week_counts(y, by_pfr, RAW) if y >= B.TIER_SINCE[6] else {}

        # A lineman has no stat line, only snaps. Give every man who took a snap a blank
        # line for that week so he still gets his snaps, snap share and penalties charted.
        self.lines = defaultdict(dict)
        for r in wk.to_dict('records'):
            gid = r.get('player_id')
            if isinstance(gid, str):
                r['games'] = 1
                r['recent_team'] = r.get('team')
                self.lines[int(r['week'])][gid] = r
        self.team_of = {}
        for w, (snap, _) in self.snaps_w.items():
            for (gid, _y) in snap:
                if gid not in self.lines[w] and gid in self.cohort:
                    self.lines[w][gid] = dict(player_id=gid, games=1)
        p = os.path.join(RAW, 'snaps_%d.csv' % y)
        if os.path.exists(p):
            sd = pd.read_csv(p, usecols=['week', 'pfr_player_id', 'team', 'opponent', 'game_type'],
                             low_memory=False)
            for r in sd[sd.game_type == 'REG'].itertuples(index=False):
                gid = by_pfr.get(r.pfr_player_id)
                if gid:
                    self.team_of[(gid, int(r.week))] = (r.team, r.opponent)
        self.last = int(wk.week.max()) if len(wk) else 0
        self.played = defaultdict(list)                 # gid -> the weeks he has a line for
        for w in sorted(self.lines):
            for gid in self.lines[w]:
                if gid in self.cohort:
                    self.played[gid].append(w)

    def game(self, gid, w):
        """One game's inputs, or None if he has no line that week."""
        r = self.lines.get(w, {}).get(gid)
        pos = self.cohort.get(gid)
        if r is None or not pos:
            return None
        y = self.y
        snap, starts = self.snaps_w.get(w, ({}, {}))
        return dict(
            y=y, w=w, r=r, snap=snap.get((gid, y)), starts=starts.get(gid),
            ngs=self.ngs_w.get(w, {}).get((gid, y)), qbr=self.qbr_w.get(w, {}).get((gid, y)),
            qb=self.qb_w.get(w, {}).get(gid), rush=self.rush_w.get(w, {}).get(gid),
            rec=self.rec_w.get(w, {}).get(gid), pen=self.pen_w.get(w, {}).get(gid),
            fqb=self.fqb_w.get(w, {}).get(gid), frush=self.frush_w.get(w, {}).get(gid),
            frec=self.frec_w.get(w, {}).get(gid), pfr=self.pfr_c.get((gid, w)),
            xb=self.S.bundle(gid, pos, {w}))


def _add(rows):
    """Sum weekly aggregate rows; the words in them (player, week, team) are not counts."""
    rows = [r for r in rows if r]
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    out = defaultdict(float)
    for r in rows:
        for k, v in r.items():
            if k in ('pid', 'week', 'tm', 'opp'):
                continue
            out[k] += float(v or 0)
    return out


# A weekly Next Gen row only exists for a man who cleared that week's volume cut, so a
# window's rows can cover a fraction of what he did in it. Below this share of his plays
# the average is of his big games only, and is not reported.
NGS_COVER = 0.7


def _add_ngs(rows, volume):
    """`volume` is {'pas': attempts, 'rus': carries, 'rec': targets} over the same games."""
    n_games = len(rows)
    rows = [r for r in rows if r]
    if not rows:
        return {}
    if n_games == 1:
        return rows[0]
    out = {}
    for kind, wkey in NGS_WEIGHT.items():
        seen = sum(B.num(r.get(wkey), 0) or 0 for r in rows)
        if volume.get(kind) and seen < NGS_COVER * volume[kind]:
            rows = [{k: v for k, v in r.items() if not k.startswith(kind + '_')} for r in rows]
    keys = set()
    for r in rows:
        keys |= set(r)
    for k in keys:
        vals = [(B.num(r.get(k)), r) for r in rows]
        vals = [(v, r) for v, r in vals if v is not None]
        if not vals:
            continue
        if 'max' in k:
            out[k] = max(v for v, _ in vals)
            continue
        wkey = NGS_OWN_WEIGHT.get(k) or NGS_WEIGHT.get(k[:3])
        if k == wkey or wkey is None or not k[4:].startswith(('avg', 'percent', 'aggress',
                                                               'expected', 'completion_percentage',
                                                               'rush_yards_over_expected_per',
                                                               'rush_pct', 'efficiency', 'passer')):
            out[k] = sum(v for v, _ in vals)             # a count: yards, attempts, catches
            continue
        ws = [(v, B.num(r.get(wkey), 0) or 0) for v, r in vals]
        tot = sum(w for _, w in ws)
        if tot > 0:
            out[k] = sum(v * w for v, w in ws) / tot
    return out


def _add_lines(rows, xb, qb):
    """Sum stat lines. Ratios are rebuilt from the sums they are ratios of."""
    if len(rows) == 1:
        return rows[0]
    out = {}
    for r in rows:
        for k, v in r.items():
            if k in RATIO_COLS:
                continue
            if k in LIST_COLS:
                if isinstance(v, str) and v.strip():
                    out[k] = (out[k] + ';' + v) if isinstance(out.get(k), str) else v
                continue
            if isinstance(v, bool) or isinstance(v, str) or v is None:
                out[k] = v if v is not None else out.get(k)        # a word: keep the latest
                continue
            f = B.num(v)
            if f is None:
                continue
            if k in MAX_COLS:
                out[k] = max(out.get(k, f), f)
            elif k in ('season', 'week'):
                out[k] = v
            else:
                out[k] = (out.get(k) or 0) + f
    out['games'] = len(rows)
    t = (xb or {}).get('t') or {}
    tgt, ay = B.num(out.get('targets'), 0) or 0, B.num(out.get('receiving_air_yards'), 0) or 0
    if t.get('t_tgt'):
        out['target_share'] = tgt / t['t_tgt']
        if t.get('t_ay'):
            out['air_yards_share'] = ay / t['t_ay']
            out['wopr'] = 1.5 * out['target_share'] + 0.7 * out['air_yards_share']
    if ay:
        out['racr'] = (B.num(out.get('receiving_yards'), 0) or 0) / ay
    if qb and qb.get('cpoe_n'):
        out['passing_cpoe'] = qb['cpoe_sum'] / qb['cpoe_n']
    return out


def combine(parts):
    """Any number of games' inputs -> one set, shaped as build_player() takes them."""
    if len(parts) == 1:
        p = parts[0]
        pf = pfr_week.finish(p['pfr'], (B.num(p['r'].get('receptions'), 0) or 0,
                                        B.num(p['r'].get('targets'), 0) or 0)) if p['pfr'] else {}
        return dict(p, pfr=pf, ngs=p['ngs'] or {})
    xb = {}
    for p in parts:
        extra.add_into(xb, p['xb'] or {})
    qb = _add([p['qb'] for p in parts])
    r = _add_lines([p['r'] for p in parts], xb, qb)
    snap = None
    for p in parts:
        if p['snap']:
            snap = snap or dict(off=0.0, dfn=0.0, st=0.0, gp=0, offt=0.0, deft=0.0)
            for k in snap:
                snap[k] += p['snap'].get(k, 0)
    starts = None
    for p in parts:
        if p['starts']:
            starts = starts or dict(starts=0, vers=0, games=0)
            starts['starts'] += p['starts']['starts']
            starts['games'] += p['starts']['games']
    counts = pfr_week.add_counts([p['pfr'] for p in parts if p['pfr']])
    pf = pfr_week.finish(counts, (B.num(r.get('receptions'), 0) or 0,
                                  B.num(r.get('targets'), 0) or 0)) if counts else {}
    vol = dict(pas=B.num(r.get('attempts'), 0) or 0, rus=B.num(r.get('carries'), 0) or 0,
               rec=B.num(r.get('targets'), 0) or 0)
    # ESPN's QBR for a stretch of games is not the average of its game QBRs, and the two
    # can sit six points apart. A window therefore carries none rather than a near miss.
    return dict(y=parts[-1]['y'], w=parts[-1]['w'], r=r, snap=snap, starts=starts,
                ngs=_add_ngs([p['ngs'] for p in parts], vol), qbr=None,
                qb=qb, rush=_add([p['rush'] for p in parts]), rec=_add([p['rec'] for p in parts]),
                pen=_add([p['pen'] for p in parts]), fqb=_add([p['fqb'] for p in parts]),
                frush=_add([p['frush'] for p in parts]), frec=_add([p['frec'] for p in parts]),
                pfr=pf, xb=xb)


def run(c, gid, pos, bio, pmake, y, team_games=1):
    """build_player() over one combined set of inputs -> (m, d, est)."""
    key = (gid, y)
    info = {}
    m, d = B.build_player(
        c['r'], pos, bio, {key: c['ngs']} if c['ngs'] else {}, {key: c['pfr']} if c['pfr'] else {},
        {key: c['snap']} if c['snap'] else {}, {key: c['qbr']} if c['qbr'] is not None else {}, {},
        c['qb'], c['rush'], c['rec'], c['pen'], None, {}, c['starts'], team_games, pmake, y,
        c['fqb'], c['frush'], c['frec'], xb=c['xb'], info=info)
    m = {k: v for k, v in m.items() if k not in SEASON_ONLY and B.MBY[k]['grp'] != 'ath'}
    return m, d, info.get('est') or []


def build_season(y, bio, by_pfr, by_espn, pmake, priors=None):
    G = Games(y, bio, by_pfr, by_espn, priors)
    if not G.ok:
        print(y, 'no weekly table - skipped')
        return None
    slates = team_slates(y)
    per = defaultdict(lambda: dict(w=[], t=[], o=[], m=defaultdict(dict), d=defaultdict(dict)))
    for w in sorted(G.lines):
        for gid in G.lines[w]:
            pos = G.cohort.get(gid)
            if not pos:
                continue
            g = G.game(gid, w)
            m, d, _ = run(combine([g]), gid, pos, bio, pmake, y)
            if not m:
                continue
            r = g['r']
            team = B.sstr(r.get('team')) or (G.team_of.get((gid, w)) or (None,))[0]
            opp = B.sstr(r.get('opponent_team')) or (G.team_of.get((gid, w)) or (None, None))[1]
            # home or away comes from the schedule, which knows; the stat line doesn't
            slate = slates.get(team, {}).get(str(w), '') if team else ''
            if opp and slate.startswith('@'):
                opp = '@' + opp
            e = per[gid]
            e['pos'] = pos
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
    last = G.last
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
        for gid, rec in recs.items():
            changed += write_if_changed(os.path.join(out_dir, gid + '.json'), rec)
    write_if_changed(os.path.join(out_dir, 'index.json'), index)
    print(y, 'weekly: %d players through week %d%s, %d file(s) changed'
          % (len(recs), last, ', packed' if done else '', changed))
    return G


# ---------------------------------------------------------------- the form windows
def span_words(games):
    """[(season, week), ...] oldest first -> 'Weeks 15-18, 2025 and weeks 1-4, 2026'."""
    by = defaultdict(list)
    for y, w in games:
        by[y].append(w)
    bits = []
    for y in sorted(by):
        ws = sorted(by[y])
        bits.append(('week %d' % ws[0] if len(ws) == 1 else 'weeks %d-%d' % (ws[0], ws[-1]))
                    + ', %d' % y)
    out = ' and '.join(bits)
    return out[:1].upper() + out[1:]


def build_form(G, prev, bio, pmake):
    """Last-N-games windows for everybody with a game this season.

    A window is his own last N games, not his team's: a man back from four weeks out is
    read on the four he played. It reaches into last season when this one is young.
    """
    y = G.y
    full = 17 if y >= 2021 else 16
    os.makedirs(FORM_ROOT, exist_ok=True)
    made = []
    for n in WINDOWS:
        players = []
        for gid in sorted(G.played):
            pos = G.cohort[gid]
            games = [(y, w) for w in G.played[gid]]
            if len(games) < n and prev is not None and prev.ok:
                games = [(prev.y, w) for w in prev.played.get(gid, [])] + games
            games = games[-n:]
            parts = [(G if gy == y else prev).game(gid, w) for gy, w in games]
            parts = [p for p in parts if p]
            if not parts:
                continue
            m, d, est = run(combine(parts), gid, pos, bio, pmake, y, team_games=len(parts))
            if not m:
                continue
            qkey, qmin = B.QUALIFY.get(pos, ('g', 6))
            have = d.get(qkey)
            if have is None and pos in B.QUALIFY_FALLBACK:
                qkey, qmin = B.QUALIFY_FALLBACK[pos]
                have = d.get(qkey)
            # the qualifying line scaled to the games the window actually holds
            qmin = max(qmin * len(parts) / float(full), qmin / float(full))
            rec = dict(id=gid, pos=pos, g=len(parts), q=bool(have is not None and have >= qmin),
                       sp=span_words(games), m={k: sig(v) for k, v in sorted(m.items())},
                       d={k: round(v, 1) for k, v in sorted(d.items()) if v})
            if est:
                rec['est'] = est
            players.append(rec)
        write_if_changed(os.path.join(FORM_ROOT, 'L%d.json' % n),
                         dict(s=y, week=G.last, n=n, players=players))
        made.append((n, len(players), sum(1 for p in players if p['q'])))
    write_if_changed(os.path.join(FORM_ROOT, 'index.json'),
                     dict(s=y, week=G.last, windows=list(WINDOWS)))
    print(y, 'form windows:', ', '.join('last %d: %d players (%d ranked)' % t for t in made))


def main():
    bio, by_pfr, by_espn = B.load_players()
    extra.patch_ids(by_pfr, bio, B.SEASONS)
    priors = extra.load_priors()
    curve = {}
    for yy in range(1999, max(B.SEASONS) + 1):
        p = os.path.join(RAW, 'reg_%d.csv' % yy)
        if os.path.exists(p):
            curve[yy] = pd.read_csv(p, usecols=['fg_made_list', 'fg_missed_list'], low_memory=False)
    pmake = B.fg_curve(curve)
    newest = None
    for y in B.SEASONS:
        G = build_season(y, bio, by_pfr, by_espn, pmake, priors)
        if G is not None:
            newest = G
    # The page asks this which seasons have game lines at all.
    have = sorted(int(n) for n in os.listdir(OUT_ROOT)
                  if n.isdigit() and os.path.exists(os.path.join(OUT_ROOT, n, 'index.json')))
    write_if_changed(os.path.join(OUT_ROOT, 'index.json'), dict(seasons=have))
    # Form windows, for the newest season on the site only: "his last four games" is a
    # statement about now. Last season's games are read if its files are on disk (the
    # daily refresh fetches them); without them the windows simply stop at week 1.
    if newest is not None and have and newest.y == have[-1] and not os.environ.get('NFL_NO_FORM'):
        prev = Games(newest.y - 1, bio, by_pfr, by_espn, None)
        build_form(newest, prev if prev.ok else None, bio, pmake)


if __name__ == '__main__':
    main()
