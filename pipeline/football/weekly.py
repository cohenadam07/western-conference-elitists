"""Week-by-week game lines for the season in progress -> public/football-weekly/<season>/.

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
  * NOT PFR's advanced tables or participation: both are season-only, and dead in-season
    anyway. Metrics that only mean something over a season (games played, availability,
    starts, positions played, the combine) are dropped rather than shown as a line of 1s.

Output, one small file per player so the page fetches only the man it is showing:

  football-weekly/index.json            {seasons:[2026]}
  football-weekly/2026/index.json       {s, week, teams:{BUF:{"1":"@MIA","2":"NYJ",...}}}
  football-weekly/2026/<gsis_id>.json   {s, pos, w:[1,2], t:[team], o:[opp],
                                         m:{key:[v per week]}, d:{denom:[n per week]}}

A file is rewritten only when its contents change, and nothing in it is a timestamp, so a
refresh that brings no new game touches nothing and the repository's history stays small:
a player's file changes about once a week, when he plays.

  NFL_SEASONS=2026 python3 weekly.py            # writes to $NFL_WEEKLY (default below)
"""
import json, os, sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B

RAW, AGG = B.RAW, B.AGG
OUT_ROOT = os.environ.get('NFL_WEEKLY', os.path.join('..', '..', 'public', 'football-weekly'))

# A season total, not a game fact. Everything else build_player makes survives.
SEASON_ONLY = {'g', 'avail', 'starts', 'posver', 'comp'}


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


def build_season(y, bio, by_pfr, by_espn, pmake):
    wkp = os.path.join(RAW, 'wk_%d.csv' % y)
    regp = os.path.join(RAW, 'reg_%d.csv' % y)
    if not (os.path.exists(wkp) and os.path.exists(regp)):
        print(y, 'no weekly table - skipped')
        return
    wk = pd.read_csv(wkp, low_memory=False)
    wk = wk[wk.season_type == 'REG']
    reg = pd.read_csv(regp, low_memory=False)
    line_a = B.load_line(y)

    # The cohort a man is charted in is the one his season is ranked in, so a game's
    # panels are exactly the rows his card shows.
    cohort = {}
    for r in reg.to_dict('records'):
        gid = r.get('player_id')
        if not isinstance(gid, str):
            continue
        b = bio.get(gid, {})
        pos = B.cohort(r.get('position'), b.get('pff_pos'), b.get('ngs_pos'))
        if pos == 'OL':
            pos = line_a.get(gid) or 'OL'
        if pos:
            cohort[gid] = pos

    qb_w, rush_w, rec_w, pen_w = load_week_pbp(y)
    fqb_w, frush_w, frec_w = load_week_ftn(y)
    snaps_w = load_week_snaps(y, by_pfr)
    ngs_w = load_week_ngs(y)
    qbr_w = load_week_qbr(y, by_espn)

    # A lineman has no stat line, only snaps. Give every man who took a snap a blank line
    # for that week so he still gets his snaps, snap share and penalties charted.
    lines = defaultdict(dict)
    for r in wk.to_dict('records'):
        gid = r.get('player_id')
        if isinstance(gid, str):
            r['games'] = 1
            r['recent_team'] = r.get('team')
            lines[int(r['week'])][gid] = r
    team_of = {}
    for w, (snap, _) in snaps_w.items():
        for (gid, _y) in snap:
            if gid not in lines[w] and gid in cohort:
                lines[w][gid] = dict(player_id=gid, games=1)
    p = os.path.join(RAW, 'snaps_%d.csv' % y)
    if os.path.exists(p):
        sd = pd.read_csv(p, usecols=['week', 'pfr_player_id', 'team', 'opponent', 'game_type'],
                         low_memory=False)
        for r in sd[sd.game_type == 'REG'].itertuples(index=False):
            gid = by_pfr.get(r.pfr_player_id)
            if gid:
                team_of[(gid, int(r.week))] = (r.team, r.opponent)

    slates = team_slates(y)
    per = defaultdict(lambda: dict(w=[], t=[], o=[], m=defaultdict(dict), d=defaultdict(dict)))
    for w in sorted(lines):
        snap, starts = snaps_w.get(w, ({}, {}))
        for gid, r in lines[w].items():
            pos = cohort.get(gid)
            if not pos:
                continue
            m, d = B.build_player(
                r, pos, bio, ngs_w.get(w, {}), {}, snap, qbr_w.get(w, {}), {},
                qb_w.get(w, {}).get(gid), rush_w.get(w, {}).get(gid), rec_w.get(w, {}).get(gid),
                pen_w.get(w, {}).get(gid), None, {}, starts.get(gid), 1, pmake, y,
                fqb_w.get(w, {}).get(gid), frush_w.get(w, {}).get(gid), frec_w.get(w, {}).get(gid))
            m = {k: v for k, v in m.items()
                 if k not in SEASON_ONLY and B.MBY[k]['grp'] != 'ath'}
            if not m:
                continue
            team = B.sstr(r.get('team')) or (team_of.get((gid, w)) or (None,))[0]
            opp = B.sstr(r.get('opponent_team')) or (team_of.get((gid, w)) or (None, None))[1]
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
    changed = 0
    for gid, e in per.items():
        n = len(e['w'])
        rec = dict(s=y, pos=e['pos'], w=e['w'], t=e['t'], o=e['o'],
                   m={k: [col.get(i) for i in range(n)] for k, col in sorted(e['m'].items())},
                   d={k: [col.get(i) for i in range(n)] for k, col in sorted(e['d'].items())})
        changed += write_if_changed(os.path.join(out_dir, gid + '.json'), rec)
    last = int(wk.week.max()) if len(wk) else 0
    write_if_changed(os.path.join(out_dir, 'index.json'),
                     dict(s=y, week=last, n=len(per), teams=slates))
    print(y, 'weekly: %d players through week %d, %d file(s) changed' % (len(per), last, changed))


def main():
    bio, by_pfr, by_espn = B.load_players()
    curve = {}
    for yy in range(1999, max(B.SEASONS) + 1):
        p = os.path.join(RAW, 'reg_%d.csv' % yy)
        if os.path.exists(p):
            curve[yy] = pd.read_csv(p, usecols=['fg_made_list', 'fg_missed_list'], low_memory=False)
    pmake = B.fg_curve(curve)
    for y in B.SEASONS:
        build_season(y, bio, by_pfr, by_espn, pmake)
    # The page asks this which seasons have game lines at all.
    have = sorted(int(n) for n in os.listdir(OUT_ROOT)
                  if n.isdigit() and os.path.exists(os.path.join(OUT_ROOT, n, 'index.json')))
    write_if_changed(os.path.join(OUT_ROOT, 'index.json'), dict(seasons=have))


if __name__ == '__main__':
    main()
