"""
gm5.py — Module 5: the GM numbers.

A spell is one person credited at one team, start to end. For each:
  GM Value Added = value produced while he ran the team (the team's season value times his credit weight on each
                   game date) + the value of what he left (every player and pick held on his last day, projected as
                   of that day) - the value of what he inherited (the same on his first day). Ten seasons, at 5%
                   a year, with 0% and 10% shown. A player who never played and was drafted more than a season
                   earlier is worth nothing (a stash).
Skills are cuts of the graded decisions (each grade times his credit weight). Repeatability: each person's
decisions split by date into halves; the halves' per-decision rates correlated across people, with a 95%
interval. A skill whose interval includes zero is labeled "describes what happened" and gets no percentile.
Shrinkage toward the average per decision uses k = half size x (1 - r) / r (the split-half reliability);
below k decisions, the low-sample hatch.

    python3 gm5.py      # -> out/gm_spells.json, out/gm_skills.json, out/gm_repeatability.txt
"""
import bisect, collections, datetime as dt, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
import grade as GR  # noqa: E402
from tenures import franchise, shift  # noqa: E402

RATES = (0.0, 0.05, 0.10, 0.20)
MIN_SEASONS = 2          # ranked only with two or more seasons in charge
G = json.load(open(os.path.join(OUT, 'games.json')))
T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
C = GR.C
D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
# Two comparisons that feed skills only (never GM Value Added, never the conservation check): how each board pick sits
# against the consensus (draftstyle.py), and the holding credit for young players kept (holding.py).
_STYLE = json.load(open(os.path.join(OUT, 'gm_draft_style.json'))) if os.path.exists(os.path.join(OUT, 'gm_draft_style.json')) else {}
for _d in D:
    if _d['type'] == 'draft' and _d.get('decision_id') in _STYLE:
        _d['style'] = _STYLE[_d['decision_id']]
HOLDS = json.load(open(os.path.join(OUT, 'gm_holds.json')))['holds'] if os.path.exists(os.path.join(OUT, 'gm_holds.json')) else []
NAME = {t['person_id']: t['person'] for t in T}
TID = {t['tenure_id']: t for t in T}


def season_games(team, y):
    s = f'{y - 1}-{str(y)[2:]}'
    for ab, dates in G.get(s, {}).items():
        f = 'CHO' if ab == 'CHA' and y >= 2005 else franchise(ab)
        if f == team:
            return dates
    return []


# ---------------------------------------------------------------- spells from the credit table
def spells():
    out = collections.defaultdict(lambda: {'segs': []})
    for team, segs in C.items():
        for s in segs:
            for p in s['people']:
                pid = TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id'])
                out[(pid, team)]['segs'].append((s['from'], s['to'], p['weight'], s.get('split')))
    res = []
    for (pid, team), v in out.items():
        segs = sorted(v['segs'])
        # spells: runs of segments with no gap longer than a day
        cur = [segs[0]]
        for sg in segs[1:]:
            if sg[0] <= shift(cur[-1][1], 1):
                cur.append(sg)
            else:
                res.append((pid, team, cur)); cur = [sg]
        res.append((pid, team, cur))
    return res


def weight_on(segs, d):
    i = bisect.bisect_right([s[0] for s in segs], d) - 1
    if i >= 0 and segs[i][0] <= d <= segs[i][1]:
        return segs[i][2]
    return 0.0


TEAMVAL = collections.defaultdict(float)
for (pid, y), v in GR.VAL.items():
    for team, sh in GR.SHARE.get((pid, y), {}).items():
        TEAMVAL[(team, y)] += v * sh


LEAGUE_AVG = {}
for (team, y), v in TEAMVAL.items():
    LEAGUE_AVG.setdefault(y, []).append(v)
LEAGUE_AVG = {y: float(np.mean(v)) for y, v in LEAGUE_AVG.items()}


# Team results: mean game margin by team-season. Savant value above the league average tracks margin at about 56
# value points per point of margin in every era (1980s 56, 1990s 55, 2000-07 57, 2008-25 56; correlation 0.80 in each),
# so margin x 56 is the same scale. It counts what player value misses: defense before 2007-08, fit, coaching.
MARGIN_TO_VALUE = 56.0
_R = json.load(open(os.path.join(OUT, 'results.json')))
MARGIN = {}
for _k, _teams in _R.items():
    _y = int(_k[:4]) + 1
    for _ab, _g in _teams.items():
        _f = 'CHO' if _ab == 'CHA' and _y >= 2005 else franchise(_ab)
        if _g:
            MARGIN[(_f, _y)] = float(np.mean([x[2] for x in _g]))


# Luck-adjusted (luck.py): opponent 3PM -> opp 3PA x league 3P%, opp FTM -> opp FTA x league FT% (the Nov 19 defense test).
_L = json.load(open(os.path.join(OUT, 'luck_margins.json')))
LUCK = {(f, int(k[:4]) + 1): v['luck'] for k, s in _L.items() for f, v in s['teams'].items()}
from luck import LUCK_SHARE  # noqa: E402  (0.3: the share of the luck term counted, measured in luck_study.py)
ADJ = {k: m + LUCK_SHARE * LUCK.get(k, 0.0) for k, m in MARGIN.items()}
_pts = [(ADJ[k], TEAMVAL[k] - LEAGUE_AVG[k[1]]) for k in ADJ if k in TEAMVAL and k[1] < 2026]
ADJ_TO_VALUE = float(np.polyfit([a for a, b in _pts], [b for a, b in _pts], 1)[0])   # value points per adjusted margin point
if os.environ.get('GM_ADJ_TO_VALUE'):              # diagnostics only: hold the scale (to separate its effect from the ledger's)
    ADJ_TO_VALUE = float(os.environ['GM_ADJ_TO_VALUE'])
LUCK_MISSING = sorted(k for k in MARGIN if k not in LUCK)


def produced_margin(team, segs, adjusted=True):
    """The headline's production: (luck-adjusted) margin per game x value points per margin point x his share of the
    season's games. Margin includes coaching (noted on the page)."""
    tot = 0.0
    for y in range(GR.season_of(segs[0][0]), min(GR.season_of(segs[-1][1]), GR.NOW_SEASON) + 1):
        dates = season_games(team, y)
        src = ADJ if adjusted else MARGIN
        if dates and (team, y) in src:
            tot += src[(team, y)] * (ADJ_TO_VALUE if adjusted else MARGIN_TO_VALUE) * sum(weight_on(segs, d) for d in dates) / len(dates)
    return tot


def produced(team, segs):
    """Season value times his weight on each game date (games of a season he was credited for); also the same with the
    league's average team value that season taken off (what an average GM would have produced in his seat)."""
    tot, by, above = 0.0, {}, 0.0
    y0, y1 = GR.season_of(segs[0][0]), GR.season_of(segs[-1][1])
    for y in range(y0, min(y1, GR.NOW_SEASON) + 1):
        dates = season_games(team, y)
        if not dates:
            continue
        wts = [weight_on(segs, d) for d in dates]
        share = sum(wts) / len(dates)
        if share:
            v = TEAMVAL.get((team, y), 0.0) * share
            by[y] = v
            tot += v
            above += (TEAMVAL.get((team, y), 0.0) - LEAGUE_AVG.get(y, 0.0)) * share
    return tot, by, above


# ---------------------------------------------------------------- holdings on a date
EVS = sorted([(e['date'], i, e) for i, e in enumerate(GR.E)], key=lambda x: (x[0], x[1]))


def holdings(queries):
    """queries: [(date, team)] -> {(date, team): [asset ids held at the start of that day]}"""
    qs = sorted(set(queries))
    holder, out, j = {}, {}, 0
    for d, team in qs:
        while j < len(EVS) and (EVS[j][0] < d or (EVS[j][2]['kind'] == 'opening' and EVS[j][0] <= d)):
            e = EVS[j][2]
            holder[e['asset']] = e['to']
            j += 1
        out[(d, team)] = [a for a, h in holder.items() if h == team]
    return out


def asset_seasons(aid, d):
    a = GR.A.get(aid, {})
    if aid.startswith('player:'):
        pid = GR.pid_of(aid)
        bp = GR.SN.BY.get(pid, {})
        dr = a.get('drafted')
        if not any(y <= GR.season_of(d) for y in bp) and dr and dr[0] < GR.season_of(d) - 1 and dr[1] > 30:
            return {}, False                     # a second-round stash: drafted more than a season ago, never played
        # a first-rounder who has not played yet (injured, or not yet over) is valued from his draft slot
    if not (aid.startswith('player:') or aid.startswith('pick:')):
        return {}, False
    s, early, _ = GR.pv(aid, d)
    return s, early


NEXT = collections.defaultdict(list)
for _e in GR.E:
    NEXT[_e['asset']].append((_e['date'], _e['kind'], _e['from']))
for _v in NEXT.values():
    _v.sort()
TEAM_GAMES = collections.defaultdict(list)
for _s, _teams in G.items():
    _y = int(_s[:4]) + 1
    for _ab, _dates in _teams.items():
        TEAM_GAMES['CHO' if _ab == 'CHA' and _y >= 2005 else franchise(_ab)] += _dates
for _v in TEAM_GAMES.values():
    _v.sort()


def walks_first(a, d, team, games_from=None):
    """True if his next move on or after d is a free-agency departure from the team with no team game in between:
    he never plays for the GM on the other side of d, so he is neither left nor inherited."""
    ev = NEXT.get(a, [])
    i = bisect.bisect_left(ev, (d,))
    if i >= len(ev):
        return False
    dd, kind, frm = ev[i]
    if kind != 'lapsed (inferred)' or frm != team:
        return False
    g = TEAM_GAMES.get(team, [])
    j = bisect.bisect_left(g, games_from or d)       # games under the other GM's sole charge
    return not (j < len(g) and g[j] <= dd)


def pv_rates(assets, d, team=None, dropped=None, games_from=None, by=None):
    """by: a Counter to collect the undiscounted value by season (for the titles version)."""
    y0 = GR.season_of(d)
    tot = {r: 0.0 for r in RATES}
    early = False
    for a in assets:
        if team and a.startswith('player:') and walks_first(a, d, team, games_from):
            if dropped is not None:
                dropped.append(a)
            continue
        s, e = asset_seasons(a, d)
        early = early or e
        for y, v in s.items():
            if y0 <= y < y0 + GR.HORIZON:
                if by is not None:
                    by[y] += v
                for r in RATES:
                    tot[r] += v / (1 + r) ** (y - y0)
    return tot, early


def realized_rates(assets, d, team, games_from=None, by=None):
    """As pv_rates, valued at what the team actually got from the assets (GR.rv): each player's production for this team
    while it held him, then whatever he was traded for, followed through the asset tree; a pick at its slot's
    expectation once it conveys (the player chosen is the grade of whoever made the pick); draft rights at the slot.
    Never a player's production for another team. The first season counts from day d on (its share of games left)."""
    y0 = GR.season_of(d)
    g = season_games(team, y0)
    after = (sum(1 for x in g if x >= d) / len(g)) if g else 1.0
    tot = {r: 0.0 for r in RATES}
    for a in assets:
        if a.startswith('player:') and walks_first(a, d, team, games_from):
            continue
        for y, v in GR.rv(a, team, d):
            if y0 <= y < y0 + GR.HORIZON:
                v = v * after if y == y0 and a.startswith('player:') and not GR.rights_window(a, d) else v
                if by is not None:
                    by[y] += v
                for r in RATES:
                    tot[r] += v / (1 + r) ** (y - y0)
    return tot


# ---------------------------------------------------------------- skills from decisions
SKILLS = ['drafting', 'second-round finds', 'deviation success', 'fit picks', 'holding', 'trades', 'free agency', 'role players',
          're-signing and extensions', 'coach hiring']

def skill_of(d):
    """Which skill a decision feeds, and its per-decision value under each grade."""
    t = d['type']
    if t == 'draft':
        st = d.get('style') or {}
        return ['drafting'] + (['second-round finds'] if d.get('round') == 2 else []) + \
            (['deviation success'] if st.get('deviation') else []) + (['fit picks'] if st.get('fit_class') == 'fit' else [])
    if t == 'hold':
        return ['holding']
    if t in ('trade',):
        return ['trades']
    if t == 'signing':
        k = ['free agency']
        if d.get('contract') in ('two-way', '10-day', 'exhibit 10'):
            k.append('role players')
        return k
    if t in ('re-signing', 'extension'):
        return ['re-signing and extensions']
    if t in ('coach hire', 'coach firing'):
        return ['coach hiring']
    return []


# ---------------------------------------------------------------- titles (titlecurve.py; titles.py has the model)
def spell_titles(team, segs, active, i_day, l_day, by_inh, by_left, by_inh_to, by_left_to, w0, w1):
    """Expected titles added, the same formula as the points: expected titles above an average team's while he ran it
    (each played season's title chance less 1/N, times his share of its games; the season in progress at today's
    projected chance) + the titles of what he left - the titles of what he inherited: the roster's share of the team's
    expected titles by its share of the team's player value, season by season (titlecurve.rate_level_*: projected as of
    the day for "at the time"; the played seasons, then today's projection, for "as it turned out"). Titles won,
    expected titles and their gap (playoff luck) count played seasons only."""
    import titlecurve as TC
    above = expected = won = 0.0
    above_by = {}
    for y in range(GR.season_of(segs[0][0]), min(GR.season_of(segs[-1][1]), GR.NOW_SEASON) + 1):
        dates = season_games(team, y)
        if not dates:
            continue
        share = sum(weight_on(segs, d) for d in dates) / len(dates)
        if not share:
            continue
        r = TC.realized(team, y)
        if r:
            above_by[y] = (r['E'] - 1 / r['n']) * share
            expected += r['E'] * share
            won += r['won'] * share
        elif y > TC.LAST_PLAYED:
            p = TC.projected(team, y, today=True)
            if p:
                above_by[y] = (p['chance'] - 1 / TC.n_teams(y)) * share
    above = sum(above_by.values())

    def league_value(day):
        played = [y for y in LEAGUE_AVG if y < GR.season_of(day) and y <= TC.LAST_PLAYED]
        return LEAGUE_AVG[max(played)] if played else LEAGUE_AVG[min(LEAGUE_AVG)]

    def proj(by, day, today):
        y0, lv = GR.season_of(day), league_value(day)
        return sum(v * GR.w(y, y0) * TC.rate_level_projected(team, y, lv, as_of=day, today=today) for y, v in by.items())

    def real(by, day):
        y0 = GR.season_of(day)
        lv = league_value(GR.TODAY)
        return sum(v * GR.w(y, y0) * (TC.rate_level_played(team, y, TEAMVAL.get((team, y), 0.0)) if y <= TC.LAST_PLAYED
                                      else TC.rate_level_projected(team, y, lv, today=True)) for y, v in by.items())
    inh_at, left_at = w0 * proj(by_inh, i_day, False), w1 * proj(by_left, l_day, active)
    res = {'titles_produced_above_average': round(above, 4), 'titles_expected': round(expected, 4), 'titles_won': round(won, 4),
           'playoff_luck': round(won - expected, 4), 'titles_inherited_at_time': round(inh_at, 4), 'titles_left_at_time': round(left_at, 4),
           'titles_added_at_time': round(above + left_at - inh_at, 4)}
    if by_inh_to is not None:
        inh_to, left_to = w0 * real(by_inh_to, i_day), w1 * real(by_left_to, l_day)
        res.update({'titles_inherited_turned_out': round(inh_to, 4), 'titles_left_turned_out': round(left_to, 4),
                    'titles_added_turned_out': round(above + left_to - inh_to, 4)})
        res['titles_added'] = res['titles_added_turned_out']
        res['titles_inherited'], res['titles_left'] = res['titles_inherited_turned_out'], res['titles_left_turned_out']
    else:
        res['titles_added'] = res['titles_added_at_time']
        res['titles_inherited'], res['titles_left'] = res['titles_inherited_at_time'], res['titles_left_at_time']
    res['titles_by_season'] = {str(y): round(v, 4) for y, v in above_by.items()}
    return res


def blend(rows):
    """The default exchange rate: lambda points per expected title, so that points and lambda x titles each account
    for half of the variation across every GM spell (equal spread: lambda = sd(points) / sd(titles)). Blended =
    points + lambda x expected titles added."""
    pts = np.array([r['gm_value_added']['0.05'] for r in rows])
    tit = np.array([r['titles_added'] for r in rows])
    lam = float(pts.std() / tit.std())
    ranked = [r for r in rows if r['ranked']]
    lam_ranked = float(np.std([r['gm_value_added']['0.05'] for r in ranked]) / np.std([r['titles_added'] for r in ranked]))
    for r in rows:
        r['blended'] = round(r['gm_value_added']['0.05'] + lam * r['titles_added'], 1)
    meta = {'lambda': round(lam, 1), 'spells': len(rows), 'sd_points': round(float(pts.std()), 1), 'sd_titles': round(float(tit.std()), 4),
            'corr_points_titles': round(float(np.corrcoef(pts, tit)[0, 1]), 3), 'lambda_ranked_spells_only': round(lam_ranked, 1),
            'rule': 'lambda = sd(points) / sd(expected titles added) across all GM spells: each accounts for half of the blend\'s spread',
            'points_per_win': GR.POINTS_PER_WIN}
    json.dump(meta, open(os.path.join(OUT, 'gm_titles_meta.json'), 'w'), indent=1)
    return meta


def main():
    SP = spells()
    print('spells', len(SP), flush=True)
    q = []
    for pid, team, segs in SP:
        top = max(sg[2] for sg in segs)
        full = [sg for sg in segs if sg[2] == top]
        q += [(full[0][0], team), (shift(full[-1][1], 1) if full[-1][1] < GR.TODAY else GR.TODAY, team)]
    H = holdings(q)
    print('holdings', len(H), flush=True)
    by_person_dec = collections.defaultdict(list)
    rows = []
    for pid, team, segs in SP:
        start, end = segs[0][0], segs[-1][1]
        active = end >= shift(GR.TODAY, -1)
        endq = GR.TODAY if active else shift(end, 1)
        prod, prod_by, prod_above = produced(team, segs)
        # inherited and left are valued at the edges of his fullest charge: a 50/50 handover window at either end is
        # split in the decisions, not by halving what he took over or handed on
        top = max(sg[2] for sg in segs)
        full = [sg for sg in segs if sg[2] == top]
        i_day = full[0][0]
        l_day = shift(full[-1][1], 1) if full[-1][1] < GR.TODAY else GR.TODAY
        w0 = w1 = top
        walked_in, walked_out = [], []
        by_inh, by_left, by_inh_to, by_left_to = (collections.Counter() for _ in range(4))
        inh, e0 = pv_rates(H[(i_day, team)], i_day, team, walked_in, by=by_inh)
        left, e1 = pv_rates(H[(l_day, team)], l_day, team, walked_out, None if active else shift(end, 1), by=by_left)
        pm = produced_margin(team, segs)
        # as it turned out (finished tenures): what he inherited and left, at what it went on to produce
        if not active:
            inh_to = realized_rates(H[(i_day, team)], i_day, team, by=by_inh_to)
            left_to = realized_rates(H[(l_day, team)], l_day, team, shift(end, 1), by=by_left_to)
        tt = spell_titles(team, segs, active, i_day, l_day, by_inh, by_left, None if active else by_inh_to, None if active else by_left_to, w0, w1)
        seasons = max(1e-9, sum(len([x for x in season_games(team, y) if weight_on(segs, x) > 0]) / max(1, len(season_games(team, y)))
                                for y in range(GR.season_of(start), min(GR.season_of(end), GR.NOW_SEASON) + 1)))
        gmva = {r: prod + w1 * left[r] - w0 * inh[r] for r in RATES}
        # decisions credited to him at this team in this spell
        decs = []
        for d in D:
            if d['team'] != team or not (start <= d['agreed'] <= end):
                continue
            wt = sum(p['weight'] for p in d['credit']['people'] if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == pid)
            if wt:
                decs.append((d, wt))
                by_person_dec[pid].append((d, wt))
        for d in HOLDS:                       # holding: a skill only, not one of his decisions
            if d['team'] != team or not (start <= d['agreed'] <= end):
                continue
            wt = sum(p['weight'] for p in d['credit']['people'] if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == pid)
            if wt:
                by_person_dec[pid].append((d, wt))
        # The headline: a finished tenure as it turned out (what he inherited and left at what it went on to produce), an
        # active one on projection (nothing has turned out yet). Both versions are kept for every tenure that has them.
        hi, hl = (inh, left) if active else (inh_to, left_to)
        rate = lambda x: {str(r): round(x(r), 1) for r in RATES}
        rows.append({'person_id': pid, 'person': NAME.get(pid, pid), 'team': team, 'start': start, 'end': None if active else end, 'active': active,
                     'seasons': round(seasons, 2), 'produced': round(prod, 1),
                     'headline_basis': 'projected (still in office)' if active else 'as it turned out',
                     'inherited': rate(lambda r: w0 * hi[r]), 'left': rate(lambda r: w1 * hl[r]),
                     'gmva_original': {str(r): round(gmva[r], 1) for r in RATES},          # the spec's formula: Data Room only
                     'gm_value_added': rate(lambda r: pm + w1 * hl[r] - w0 * hi[r]),     # the headline: luck-adjusted margin
                     'gm_value_added_player': rate(lambda r: prod_above + w1 * hl[r] - w0 * hi[r]),   # second line: player value
                     'produced_margin_adj': round(pm, 1),
                     'gm_value_added_at_time': rate(lambda r: pm + w1 * left[r] - w0 * inh[r]),   # on projection, every tenure
                     'inherited_at_time': rate(lambda r: w0 * inh[r]), 'left_at_time': rate(lambda r: w1 * left[r]),
                     'gm_value_added_turned_out': None if active else rate(lambda r: pm + w1 * left_to[r] - w0 * inh_to[r]),
                     'inherited_turned_out': None if active else rate(lambda r: w0 * inh_to[r]),
                     'left_turned_out': None if active else rate(lambda r: w1 * left_to[r]),
                     'walked_before_inherited': [GR.A.get(a, {}).get('name', a) for a in walked_in],
                     'walked_before_left': [GR.A.get(a, {}).get('name', a) for a in walked_out],
                     'ranked': seasons >= MIN_SEASONS,
                     'gm_value_added_per_season': round((pm + w1 * hl[0.05] - w0 * hi[0.05]) / max(seasons, 0.25), 1),
                     'produced_above_average': round(prod_above, 1),
                     'produced_from_margin_raw': round(produced_margin(team, segs, adjusted=False), 1), 'early_era': e0 or e1 or start < '1985-07-01',
                     'n_decisions': len(decs), 'shared': any(s[3] in ('co-leads',) for s in segs),
                     'luck_gap': round(sum((d['turned_out'] - d['at_time']) * wt for d, wt in decs if d.get('turned_out') is not None and d.get('at_time') is not None), 1),
                     **tt})
    lam = blend(rows)
    json.dump(rows, open(os.path.join(OUT, 'gm_spells.json'), 'w'), indent=0)
    print('GM Value Added for', len(rows), 'spells', flush=True)
    print(f"expected titles added: one title = {lam['lambda']:,.0f} points (each half of the variation across {lam['spells']} spells)", flush=True)
    return rows, by_person_dec


def kind_of(d):
    """What counts as the same kind of decision: its type and season, and for a draft pick also its pick range (a No. 1
    pick and a No. 45 are not alike, and bad teams keep picking high, so the range must not pass for skill)."""
    if d['type'] == 'draft':
        import consensus
        return ('draft', GR.season_of(d['agreed']), consensus.bucket(d['slot']))
    return (d['type'], GR.season_of(d['agreed']))


def demean(by_person_dec):
    """Each grade against the league's average for that kind of decision (kind_of), so an era, a decision type or a
    draft position cannot pass for a person's skill."""
    acc = collections.defaultdict(list)
    for decs in by_person_dec.values():
        for d, wt in decs:
            for g in ('turned_out', 'at_time'):
                if d.get(g) is not None:
                    acc[(kind_of(d), g)].append(d[g])
    m = {k: float(np.mean(v)) for k, v in acc.items()}
    out = collections.defaultdict(list)
    for pid, decs in by_person_dec.items():
        for d, wt in decs:
            dd = dict(d)
            for g in ('turned_out', 'at_time'):
                if d.get(g) is not None:
                    dd[g] = d[g] - m[(kind_of(d), g)]
            out[pid].append((dd, wt))
    return out


def repeatability(by_person_dec):
    by_person_dec = demean(by_person_dec)
    rep = ['Is it skill? Each grade taken against the league average for that kind of decision that season; each person\'s decisions split by date into halves; '
           'the per-decision rate in each half, correlated across people.', '']
    results = {}
    skills = SKILLS
    for sk in skills:
        for grade in ('turned_out', 'at_time'):
            pairs = []
            halves = []
            for pid, decs in by_person_dec.items():
                xs = sorted([(d['agreed'], d[grade] * wt) for d, wt in decs if sk in skill_of(d) and d.get(grade) is not None])
                if len(xs) < 8:
                    continue
                h = len(xs) // 2
                a, b = [v for _, v in xs[:h]], [v for _, v in xs[h:]]
                pairs.append((np.mean(a), np.mean(b)))
                halves.append(h)
            if len(pairs) < 12:
                results[(sk, grade)] = None
                rep.append(f'{sk:28} {grade:11}: too few people with 8+ graded decisions ({len(pairs)})')
                continue
            x, y = np.array(pairs).T
            r = float(np.corrcoef(x, y)[0, 1])
            z, se = math.atanh(max(min(r, 0.999), -0.999)), 1 / math.sqrt(len(pairs) - 3)
            lo, hi = math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se)
            nh = float(np.mean(halves))
            k = nh * (1 - r) / r if r > 0 else None
            verdict = 'skill (repeats)' if lo > 0 else 'describes what happened'
            results[(sk, grade)] = {'r': r, 'lo': lo, 'hi': hi, 'people': len(pairs), 'half_size': nh, 'k': k, 'verdict': verdict}
            rep.append(f'{sk:28} {grade:11}: r {r:+.2f} [{lo:+.2f}, {hi:+.2f}]  people {len(pairs):3}  half size {nh:5.1f}  '
                       + (f'shrinkage k {k:6.1f}' if k else 'no shrinkage (does not repeat)') + f'  -> {verdict}')
    open(os.path.join(OUT, 'gm_repeatability.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))
    return results


def skills_table(by_person_dec, rel):
    """Per person: each skill's raw total, per decision, shrunk rate, percentile (skills that repeat only), low-sample hatch."""
    out = {}
    skills = sorted({s for (s, g) in rel})
    mean = {}
    for sk in skills:
        for grade in ('turned_out', 'at_time'):
            vals = [d[grade] for decs in by_person_dec.values() for d, wt in decs if sk in skill_of(d) and d.get(grade) is not None]
            mean[(sk, grade)] = float(np.mean(vals)) if vals else 0.0
    for pid, decs in by_person_dec.items():
        row = {'person': NAME.get(pid, pid), 'skills': {}}
        for sk in skills:
            for grade in ('turned_out', 'at_time'):
                xs = [d[grade] * wt for d, wt in decs if sk in skill_of(d) and d.get(grade) is not None]
                n = len(xs)
                if not n:
                    continue
                raw = float(np.mean(xs))
                R = rel.get((sk, grade))
                k = R['k'] if R and R.get('k') else None
                shr = mean[(sk, grade)] + (n / (n + k)) * (raw - mean[(sk, grade)]) if k else None
                row['skills'][f'{sk}|{grade}'] = {'n': n, 'total': round(sum(xs), 1), 'per_decision': round(raw, 1),
                                                  'shrunk': None if shr is None else round(shr, 2), 'low_sample': bool(k and n < k),
                                                  'repeats': bool(R and R['verdict'].startswith('skill')) and sk != 're-signing and extensions',
                                                  'note': 'may reflect the stars he had to re-sign; a percentile waits until salaries let us test value against cost' if sk == 're-signing and extensions' else None}
        out[pid] = row
    # percentiles among people with the skill graded, repeating skills only
    for key in {k for r in out.values() for k in r['skills']}:
        vals = sorted(r['skills'][key]['shrunk'] for r in out.values() if key in r['skills'] and r['skills'][key]['shrunk'] is not None)
        for r in out.values():
            s = r['skills'].get(key)
            if s and s['shrunk'] is not None and s['repeats']:
                s['pct'] = round(100 * bisect.bisect_left(vals, s['shrunk']) / max(1, len(vals) - 1))
    json.dump(out, open(os.path.join(OUT, 'gm_skills.json'), 'w'), indent=0)
    return out


if __name__ == '__main__':
    rows, byp = main()
    rel = repeatability(byp)
    sk = skills_table(demean(byp), {k: v for k, v in rel.items() if v})
    print('value points per luck-adjusted margin point', round(ADJ_TO_VALUE, 1), '| team-seasons without a luck row', len(LUCK_MISSING), LUCK_MISSING[:5])
    act = [r for r in rows if r['active']]
    print('active spells', len(act), '| shared spells', sum(1 for r in rows if r['shared']), '| early-era', sum(1 for r in rows if r['early_era']))
