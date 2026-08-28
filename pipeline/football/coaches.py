"""Build public/coaching-savant-data.json.

A head coach leaves two kinds of trace in open data, and they answer different questions:

  the schedule       who he beat, when he reached the playoffs, and — through the closing
                     spread — whether his teams did better than the market expected
  the play-by-play   what he actually called: how often he passed, how fast he played,
                     whether he went for it, and how good his three units were

Both are joined on the game, not the season, so a coach fired in week 9 gets exactly the
games he coached and his interim replacement gets the rest.

What is NOT here: the coaching tree. No open dataset records who assisted whom, so that
lives in coach_tree.py as hand-curated data — see the note at the top of that file.
"""
import json, math, os, sys, datetime
from collections import defaultdict

import numpy as np
import pandas as pd

RAW = os.environ.get('NFL_RAW', 'raw')
OUT = os.environ.get('COACH_OUT', 'coaching-savant-data.json')
SEASONS = list(range(1999, 2026))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coach_tree import TREE, TREE_NOTE, ROOTS

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
        exp_w=0.0, cover=0, atsn=0, mov_oe=0.0, games=0, teams=set()))
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


def main():
    g = pd.read_csv(os.path.join(RAW, 'schedules.csv'), low_memory=False)
    g = g[g.home_score.notna() & g.away_score.notna() & (g.season <= max(SEASONS))]
    pwin = spread_win_curve(g[g.spread_line.notna()])
    recs = build_records(g, pwin)

    style = {}
    for y in SEASONS:
        for k, v in build_style(y, g).items():
            style[(k[0], y, k[1])] = v
        print('style', y, flush=True)

    coaches = defaultdict(lambda: dict(seasons=[]))
    for (coach, yr), e in sorted(recs.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        teams = sorted(e['teams'])
        st = {}
        for t in teams:
            st.update(style.get((coach, yr, t), {}))
        row = dict(season=yr, team='/'.join(teams), g=e['games'],
                   w=e['w'], l=e['l'], t=e['t'], pf=e['pf'], pa=e['pa'],
                   pw=e['pw'], pl=e['pl'], best=e['best'], sb=e['sb_w'])
        if e['atsn']:
            row['exp_w'] = rnd(e['exp_w'], 2)
            row['cover'] = rnd(100.0 * e['cover'] / e['atsn'], 1)
            row['mov_oe'] = rnd(e['mov_oe'] / e['games'], 2)
            row['waa'] = rnd((e['w'] + 0.5 * e['t'] + e['pw']) - e['exp_w'], 2)
        for k, v in st.items():
            row[k] = rnd(v, 3)
        coaches[coach]['seasons'].append(row)

    out_coaches = {}
    for coach, d in coaches.items():
        ss = d['seasons']
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
        out_coaches[coach] = dict(name=coach, seasons=ss, career=career,
                                  tree=TREE.get(coach))

    payload = dict(
        generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        source='nflverse schedules + play-by-play; coaching lineage hand-curated',
        seasons=[str(y) for y in reversed(SEASONS)],
        treeNote=TREE_NOTE, roots=ROOTS, tree=TREE,
        coaches=out_coaches)
    with open(OUT, 'w') as f:
        json.dump(payload, f, separators=(',', ':'), allow_nan=False)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB —', len(out_coaches), 'coaches')


if __name__ == '__main__':
    main()
