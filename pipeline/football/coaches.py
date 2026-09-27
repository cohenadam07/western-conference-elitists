"""Build public/coaching-savant-data.json (and, in season, coaching-savant-current.json).

A head coach leaves two kinds of trace in open data, and they answer different questions:

  the schedule       who he beat, when he reached the playoffs, and — through the closing
                     spread — whether his teams did better than the market expected
  the play-by-play   what he actually called: how often he passed, how fast he played,
                     whether he went for it, and how good his three units were

Both are joined on the game, not the season, so a coach fired in week 9 gets exactly the
games he coached and his interim replacement gets the rest.

Since v2 there are two more layers, built in coach_units.py and coach_identity.py:

  decisions   every fourth down since 2014 scored by the nfl4th model - the head coach's
  units       every offence and defence since 2018 credited to the man who CALLED it,
              from the hand-curated play_callers.py, with its scheme fingerprint

What is NOT computed: the coaching tree (coach_tree.py) and who called the plays
(play_callers.py). No open dataset records either.

Runs two ways:

  full         NFL_SEASONS unset (1999..current) -> the whole archive
  merge        COACH_BASE=<an existing archive> NFL_SEASONS=2026 -> rebuild only those
               seasons' play-by-play layers and carry every other season over from the
               base. Records always come from the whole schedule, which is cheap.

With COACH_CURRENT=<path> it also writes the small in-season file the page overlays on
the archive: the current season's units, and the full records of everyone active in it.
"""
import json, math, os, sys, datetime
from collections import defaultdict

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seasons import seasons as season_list, current_season
from coach_tree import TREE, TREE_NOTE, ROOTS
from play_callers import fix_head_coaches, FIRST_SEASON as CALLER_FIRST

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('COACH_OUT', 'coaching-savant-data.json')
BASE = os.environ.get('COACH_BASE')
CURRENT = os.environ.get('COACH_CURRENT')
SEASONS = season_list()

ROUND_ORDER = {'WC': 1, 'DIV': 2, 'CON': 3, 'SB': 4}
ROUND_NAME = {1: 'Wild card', 2: 'Divisional', 3: 'Conference championship', 4: 'Super Bowl'}


def rnd(v, p=4):
    if v is None:
        return None
    v = float(v)
    return round(v, p) if math.isfinite(v) else None


# ---------------------------------------------------------------- the market's expectation
def spread_win_curve(g):
    """Empirical P(win) as a function of the closing spread.

    Fitting a logistic would be tidier, but twenty-seven seasons of games is plenty to just
    read the answer off the data, and an empirical curve can't be wrong about the shape.
    Smoothed across neighbouring half-point buckets because the extremes are thin.
    """
    rows = []
    for r in g.itertuples(index=False):
        rows.append((float(r.spread_line), 1.0 if r.home_score > r.away_score
                     else (0.5 if r.home_score == r.away_score else 0.0)))
        rows.append((-float(r.spread_line), 1.0 if r.away_score > r.home_score
                     else (0.5 if r.home_score == r.away_score else 0.0)))
    df = pd.DataFrame(rows, columns=['sp', 'win'])
    grp = df.groupby(df.sp.round(0)).agg(w=('win', 'sum'), n=('win', 'size'))

    def p(sp):
        s = round(sp)
        num = den = 0.0
        for k in range(int(s) - 3, int(s) + 4):
            if k in grp.index:
                wgt = 1.0 - abs(k - s) / 4.0
                num += grp.loc[k, 'w'] * wgt
                den += grp.loc[k, 'n'] * wgt
        if den < 25:                      # thin tails fall back to a sane asymptote
            return 0.97 if sp > 0 else 0.03
        return min(0.985, max(0.015, num / den))
    return p


# ---------------------------------------------------------------- schedule -> records
def build_records(g, pwin):
    """Per coach-season: record, playoff result, and performance against the spread."""
    seasons = defaultdict(lambda: dict(
        w=0, l=0, t=0, pf=0, pa=0, pw=0, pl=0, best=0, sb_w=0,
        exp_w=0.0, cover=0, atsn=0, mov_oe=0.0, games=0, teams=set(), wks=[]))
    for r in g.itertuples(index=False):
        yr = int(r.season)
        spread = float(r.spread_line) if pd.notna(r.spread_line) else None
        for coach, team, own, opp, sp in (
                (r.home_coach, r.home_team, r.home_score, r.away_score, spread),
                (r.away_coach, r.away_team, r.away_score, r.home_score, (-spread if spread is not None else None))):
            if not isinstance(coach, str) or not coach.strip():
                continue
            e = seasons[(coach.strip(), yr)]
            e['teams'].add(team)
            e['games'] += 1
            won = own > opp
            tie = own == opp
            if r.game_type == 'REG':
                e['wks'].append(int(r.week))
                e['w' if won else ('t' if tie else 'l')] += 1
                e['pf'] += float(own)
                e['pa'] += float(opp)
            else:
                e['pw' if won else 'pl'] += 1
                e['best'] = max(e['best'], ROUND_ORDER.get(r.game_type, 0))
                if r.game_type == 'SB' and won:
                    e['sb_w'] += 1
            if sp is not None:
                # the market's own expectation for this game, and what actually happened
                e['exp_w'] += pwin(sp)
                margin = float(own) - float(opp)
                e['mov_oe'] += margin - sp
                e['atsn'] += 1
                if margin > sp:
                    e['cover'] += 1
                elif margin == sp:
                    e['atsn'] -= 1        # a push is not a bet either way
    return seasons


# ---------------------------------------------------------------- play-by-play -> style
NEUTRAL = "in the first three quarters with the game still in the balance"


def fourth_downs(pb):
    """Fourth downs worth judging a coach on.

    Restricted to neutral game states for the same reason the other tendencies are: a team
    losing by three scores in the fourth quarter goes for it on everything, so a baseline
    that ignores the scoreboard makes every *winning* coach look timid. Measured this way,
    a coach is aggressive only if he goes for it in spots where the game is still level.
    """
    d = pb[(pb.down == 4) & pb.play_type.notna()
           & (pb.qtr <= 3) & pb.wp.between(0.2, 0.8)]
    d = d[d.play_type.isin(['pass', 'run', 'punt', 'field_goal'])]
    if not len(d):
        return None, None
    tg = pd.cut(d.ydstogo, [0, 1, 2, 4, 7, 100], labels=False)
    fp = pd.cut(d.yardline_100, [0, 30, 45, 60, 75, 100], labels=False)
    went = d.play_type.isin(['pass', 'run']).astype(float)
    base = pd.DataFrame({'tg': tg, 'fp': fp, 'go': went}).groupby(['tg', 'fp']).go.mean()
    return base, d.assign(tg=tg, fp=fp, went=went)


def build_style(year, g):
    """One row per (coach, team) for a season: what he called and how the units played."""
    cols = ['game_id', 'posteam', 'defteam', 'play_type', 'epa', 'down', 'ydstogo',
            'yardline_100', 'wp', 'qtr', 'half_seconds_remaining', 'shotgun', 'no_huddle',
            'qb_dropback', 'pass_oe', 'special', 'two_point_attempt', 'season_type',
            'game_seconds_remaining', 'penalty', 'aborted_play']
    p = os.path.join(RAW, 'pbp', 'pbp_%d.parquet' % year)
    if not os.path.exists(p):
        return {}
    pb = pd.read_parquet(p, columns=cols)
    pb = pb[(pb.season_type == 'REG') & pb.posteam.notna()]

    # who coached each side of each game — attribution follows the game, not the season
    gy = g[g.season == year]
    hc = dict(zip(gy.game_id, gy.home_coach))
    ac = dict(zip(gy.game_id, gy.away_coach))
    ht = dict(zip(gy.game_id, gy.home_team))
    off_coach = [hc.get(gid) if pt == ht.get(gid) else ac.get(gid)
                 for gid, pt in zip(pb.game_id, pb.posteam)]
    def_coach = [ac.get(gid) if pt == ht.get(gid) else hc.get(gid)
                 for gid, pt in zip(pb.game_id, pb.posteam)]
    pb = pb.assign(off_coach=off_coach, def_coach=def_coach)

    scrim = pb[pb.play_type.isin(['pass', 'run'])]
    neutral = scrim[(scrim.qtr <= 3) & (scrim.wp.between(0.2, 0.8))]
    early = neutral[neutral.down.isin([1, 2])]

    base4, d4 = fourth_downs(pb)
    out = {}

    def agg(key, frame, fn):
        for k, v in fn(frame).items():
            out.setdefault(k, {})[key] = v

    def by_off(frame, col_fn):
        r = {}
        for (c, t), sub in frame.groupby(['off_coach', 'posteam']):
            if isinstance(c, str):
                r[(c, t)] = col_fn(sub)
        return r

    agg('pass_rate', neutral, lambda f: by_off(f, lambda s: float(s.qb_dropback.mean() * 100)))
    agg('early_pass', early, lambda f: by_off(f, lambda s: float(s.qb_dropback.mean() * 100)))
    agg('shotgun', neutral, lambda f: by_off(f, lambda s: float(s.shotgun.mean() * 100)))
    agg('nohuddle', neutral, lambda f: by_off(f, lambda s: float(s.no_huddle.mean() * 100)))
    agg('proe', neutral[neutral.pass_oe.notna()],
        lambda f: by_off(f, lambda s: float(s.pass_oe.mean())))
    agg('off_epa', scrim, lambda f: by_off(f, lambda s: float(s.epa.mean())))
    agg('plays_g', scrim,
        lambda f: by_off(f, lambda s: float(len(s) / max(s.game_id.nunique(), 1))))

    # Tempo: seconds burned between snaps. The gap has to be measured on the full play
    # sequence and only then filtered to neutral plays — diffing an already-filtered frame
    # measures the time between two neutral plays with a punt and a possession change in
    # between, which is not tempo.
    seq = pb.sort_values(['game_id', 'game_seconds_remaining'], ascending=[True, False]).copy()
    seq['gap'] = seq.groupby('game_id').game_seconds_remaining.diff(-1)
    tempo = seq[seq.play_type.isin(['pass', 'run']) & (seq.qtr <= 3)
                & seq.wp.between(0.2, 0.8) & seq.gap.between(3, 60)]
    agg('sec_play', tempo, lambda f: by_off(f, lambda s: float(s.gap.mean())))

    # defence and special teams are the other side of the same play
    for (c, t), sub in pb[pb.play_type.isin(['pass', 'run'])].groupby(['def_coach', 'defteam']):
        if isinstance(c, str):
            out.setdefault((c, t), {})['def_epa'] = float(sub.epa.mean())
    st = pb[pb.special == 1]
    for (c, t), sub in st.groupby(['off_coach', 'posteam']):
        if isinstance(c, str):
            out.setdefault((c, t), {})['st_epa'] = float(sub.epa.mean())

    # fourth-down aggression, against what the league does in the same spot and game state
    if d4 is not None:
        d4 = d4.copy()
        d4['exp'] = [base4.get((a, b), np.nan) for a, b in zip(d4.tg, d4.fp)]
        for (c, t), sub in d4.groupby(['off_coach', 'posteam']):
            if not isinstance(c, str):
                continue
            e = out.setdefault((c, t), {})
            e['go_rate'] = float(sub.went.mean() * 100)
            ok = sub[sub.exp.notna()]
            if len(ok) >= 8:
                e['go_oe'] = float((ok.went - ok.exp).mean() * 100)
            e['fourths'] = int(len(sub))

    tp = pb[pb.two_point_attempt == 1]
    for (c, t), sub in tp.groupby(['off_coach', 'posteam']):
        if isinstance(c, str):
            out.setdefault((c, t), {})['two_pt'] = int(len(sub))
    return out


STYLE_KEYS = ('pass_rate', 'early_pass', 'proe', 'shotgun', 'nohuddle', 'sec_play',
              'plays_g', 'off_epa', 'def_epa', 'st_epa', 'go_rate', 'go_oe', 'fourths', 'two_pt')
D4_SUM = ('d4_n', 'd4_go', 'd4_dg', 'd4_dg_go', 'd4_pg', 'd4_pg_go', 'd4_pk', 'd4_pk_go',
          'd4_dk', 'd4_dk_go', 'd4_bad')
D4_KEYS = D4_SUM + ('d4_lost', 'd4_grid', 'd4_worst')


def load_base():
    if not BASE or not os.path.exists(BASE):
        return None
    with open(BASE) as f:
        return json.load(f)


def career_of(ss):
    tot = dict(g=0, w=0, l=0, t=0, pw=0, pl=0, sb=0, po=0, exp_w=0.0, waa=0.0,
               cover=0.0, atsn=0, mov=0.0)
    for s in ss:
        tot['g'] += s['g']; tot['w'] += s['w']; tot['l'] += s['l']; tot['t'] += s['t']
        tot['pw'] += s['pw']; tot['pl'] += s['pl']; tot['sb'] += s['sb']
        if s['best'] > 0:
            tot['po'] += 1
        if 'waa' in s:
            tot['waa'] += s['waa']; tot['exp_w'] += s['exp_w']
            tot['mov'] += s['mov_oe'] * s['g']; tot['atsn'] += s['g']
    wl = tot['w'] + tot['l'] + tot['t']
    career = dict(
        seasons=len(ss), g=tot['g'], w=tot['w'], l=tot['l'], t=tot['t'],
        winpct=rnd(100.0 * (tot['w'] + 0.5 * tot['t']) / wl, 1) if wl else None,
        pw=tot['pw'], pl=tot['pl'], sb=tot['sb'], po=tot['po'],
        porate=rnd(100.0 * tot['po'] / len(ss), 1),
        waa=rnd(tot['waa'], 2),
        mov_oe=rnd(tot['mov'] / tot['atsn'], 2) if tot['atsn'] else None,
        first=ss[0]['season'], last=ss[-1]['season'],
        teams=sorted({t for s in ss for t in s['team'].split('/')}),
    )
    # career style is a games-weighted mean of the seasons that carry each number
    for k in ('pass_rate', 'early_pass', 'proe', 'shotgun', 'nohuddle', 'sec_play',
              'plays_g', 'off_epa', 'def_epa', 'st_epa', 'go_rate', 'go_oe'):
        num = den = 0.0
        for s in ss:
            if s.get(k) is not None:
                num += s[k] * s['g']; den += s['g']
        if den:
            career[k] = rnd(num / den, 3)
    # fourth downs: counts add up, and the rates are taken on the totals
    d4 = [s for s in ss if s.get('d4_n')]
    if d4:
        for k in D4_SUM:
            career[k] = sum(s.get(k, 0) for s in d4)
        career['d4_g'] = sum(s['g'] for s in d4)
        career['d4_lost'] = rnd(sum(s.get('d4_lost') or 0 for s in d4), 2)
        career['d4_lost_g'] = rnd(career['d4_lost'] / career['d4_g'], 3) if career['d4_g'] else None
        career['d4_follow'] = rnd(100.0 * career['d4_dg_go'] / career['d4_dg'], 1) if career['d4_dg'] else None
        career['d4_follow_p'] = rnd(100.0 * career['d4_pg_go'] / career['d4_pg'], 1) if career['d4_pg'] else None
        kicks = career['d4_pk'] + career['d4_dk']
        career['d4_rash'] = rnd(100.0 * (career['d4_pk_go'] + career['d4_dk_go']) / kicks, 1) if kicks else None
        # the decision map, summed across seasons
        grid = None
        for s in d4:
            gd = s.get('d4_grid')
            if not gd:
                continue
            if grid is None:
                grid = [[[0, 0, 0, 0] for _ in row] for row in gd]
            for i, row in enumerate(gd):
                for j, cell in enumerate(row):
                    for k in range(4):
                        grid[i][j][k] += cell[k]
        career['d4_grid'] = grid
        worst = [dict(w, season=s['season'], team=s['team']) for s in d4 for w in (s.get('d4_worst') or [])]
        worst.sort(key=lambda w: -(w.get('lost') or 0))
        career['d4_worst'] = worst[:5]
    return career


def main():
    from coach_units import load_season, build_units
    from coach_identity import build_identity

    g = pd.read_csv(os.path.join(RAW, 'schedules.csv'), low_memory=False)
    g = fix_head_coaches(g)
    last = max(max(SEASONS), current_season())
    g = g[g.home_score.notna() & g.away_score.notna() & (g.season <= last)]
    pwin = spread_win_curve(g[g.spread_line.notna()])
    recs = build_records(g, pwin)
    base = load_base()
    built = set()

    style, dec, units, league = {}, {}, {}, {}
    for y in SEASONS:
        st = build_style(y, g)
        if not st:
            continue                      # nflverse has nothing for this season yet
        built.add(y)
        for k, v in st.items():
            style[(k[0], y, k[1])] = v
        if y >= 2014:
            pb = load_season(y, g)
            if pb is not None:
                u, d, lg = build_units(pb, y)
                units.update(u)
                for k, v in d.items():
                    dec[(k[0], y, k[1])] = v
                if lg:
                    league[str(y)] = dict(d4=lg)
        print('season', y, '— units', sum(1 for x in units.values() if x['season'] == y), flush=True)

    # everything not rebuilt comes over from the base archive untouched
    carried = 0
    if base:
        for name, c in base.get('coaches', {}).items():
            for s in c['seasons']:
                if s['season'] in built:
                    continue
                key = (name, s['season'], s['team'].split('/')[0])
                st = {k: s[k] for k in STYLE_KEYS if s.get(k) is not None}
                if st:
                    style.setdefault(key, st)
                dd = {k: s[k] for k in D4_KEYS if s.get(k) is not None}
                if dd:
                    dec.setdefault(key, dd)
                carried += 1
        for uid, u in base.get('units', {}).items():
            if u['season'] not in built:
                u = dict(u)
                for k in ('z', 'comps', 'arrival'):
                    u.pop(k, None)
                units[uid] = u
        for y, v in base.get('league', {}).items():
            if int(y) not in built:
                league[y] = v
    print('carried', carried, 'season rows from the base archive')

    coaches = defaultdict(lambda: dict(seasons=[]))
    for (coach, yr), e in sorted(recs.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        teams = sorted(e['teams'])
        row = dict(season=yr, team='/'.join(teams), g=e['games'],
                   w=e['w'], l=e['l'], t=e['t'], pf=e['pf'], pa=e['pa'],
                   pw=e['pw'], pl=e['pl'], best=e['best'], sb=e['sb_w'])
        if e['wks']:
            row['wk'] = [min(e['wks']), max(e['wks'])]
        if e['atsn']:
            row['exp_w'] = rnd(e['exp_w'], 2)
            row['cover'] = rnd(100.0 * e['cover'] / e['atsn'], 1)
            row['mov_oe'] = rnd(e['mov_oe'] / e['games'], 2)
            row['waa'] = rnd((e['w'] + 0.5 * e['t'] + e['pw']) - e['exp_w'], 2)
        for t in teams:
            for k, v in style.get((coach, yr, t), {}).items():
                row[k] = rnd(v, 3) if isinstance(v, float) else v
            for k, v in dec.get((coach, yr, t), {}).items():
                row[k] = v
        # the units his team fielded while he was the head coach, whoever called them
        if yr >= CALLER_FIRST and 'wk' in row:
            a, b = row['wk']
            row['units'] = sorted(uid for uid, u in units.items()
                                  if u['season'] == yr and u['team'] in teams
                                  and u['wk'][0] <= b and u['wk'][1] >= a)
        coaches[coach]['seasons'].append(row)

    out_coaches = {}
    for coach, d in coaches.items():
        out_coaches[coach] = dict(name=coach, seasons=d['seasons'],
                                  career=career_of(d['seasons']), tree=TREE.get(coach))

    callers = build_identity(units, TREE)
    for c in callers.values():
        c['hc'] = c['name'] in out_coaches
        c['tree'] = TREE.get(c['name'])

    seasons_all = sorted({s['season'] for c in out_coaches.values() for s in c['seasons']}, reverse=True)
    cur = current_season()
    wk = None
    gc = g[(g.season == cur) & (g.game_type == 'REG')]
    if len(gc):
        wk = int(gc.week.max())
    payload = dict(
        generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        source='nflverse schedules, play-by-play, FTN charting and participation; nfl4th '
               'fourth-down model; coaching lineage and play-callers hand-curated',
        seasons=[str(y) for y in seasons_all],
        treeNote=TREE_NOTE, roots=ROOTS, tree=TREE,
        callerNote=CALLER_NOTE,
        coaches=out_coaches, callers=callers, units=units, league=league,
        current=dict(season=cur, week=wk))
    with open(OUT, 'w') as f:
        json.dump(payload, f, separators=(',', ':'), allow_nan=False)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB —', len(out_coaches), 'head coaches,',
          len(callers), 'play-callers,', len(units), 'units')

    if CURRENT:
        # The in-season overlay: everybody active this season, in full, and this season's
        # units. The page lays it over the archive, so the archive only needs rebuilding
        # when a season is finished.
        active = {n: c for n, c in out_coaches.items() if any(s['season'] == cur for s in c['seasons'])}
        cu = {uid: u for uid, u in units.items() if u['season'] == cur}
        cc = {n: c for n, c in callers.items() if any(units[x]['season'] == cur for x in c['units'])}
        small = dict(generated=payload['generated'], season=cur, week=wk,
                     coaches=active, callers=cc, units=cu,
                     league={str(cur): league[str(cur)]} if str(cur) in league else {})
        with open(CURRENT, 'w') as f:
            json.dump(small, f, separators=(',', ':'), allow_nan=False)
        print('wrote', CURRENT, os.path.getsize(CURRENT) // 1024, 'KB')


CALLER_NOTE = (
    "Scheme belongs to whoever called the plays, not automatically to the head coach, so "
    "every offence and defence since 2018 is credited to its play-caller. No open dataset "
    "records who that was: the list is hand-curated from team announcements and beat "
    "reporting, and when play-calling changed hands mid-season the season is split at the "
    "week it did. Rows marked unconfirmed are the coordinator with the title where no report "
    "names the caller. Before 2018, style is shown under the head coach.")


if __name__ == '__main__':
    main()
