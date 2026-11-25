"""
snapshots.py — point-in-time projections: any player or pick as of any past date, using only what was
known before it, with the model version and the inputs stored.

  project(player, as_of)   the latest regular season complete before as_of is the origin; the projection
                           model fit through that season (outcomes no later); five seasons of expected value
                           and the chance he is in the league each year. A player with no NBA season yet is
                           valued by his draft slot (the pick curve as of that date); an undrafted one, by
                           the average first five seasons of undrafted players complete before that date.
  pick_value(...)          the chance of each slot (lottery.py, as of the date) times the pick curve as of the
                           date, times the chance it conveys under a stated protection
  Before mid-1985 (projection) or 1990 (pick curve) there is not enough earlier data: the earliest fit is used
  and the snapshot says so (early_era).

    python3 snapshots.py      # every decision in the ledger -> out/snapshots.json
"""
import collections, json, math, os, re, sys
from functools import lru_cache
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, os.path.join(HERE, '..'))
import proj, lottery, instream  # noqa: E402
from br_crosswalk import canonical_id  # noqa: E402
from tenures import franchise  # noqa: E402

ROWS, BY = proj.table()
G = json.load(open(os.path.join(OUT, 'games.json')))
SEASON_END = {int(s[:4]) + 1: max(d for v in t.values() for d in v) for s, t in G.items()}   # last regular-season game
LR = lottery.results()
WD = json.load(open(os.path.join(OUT, 'wiki_drafts.json')))
LFITS = json.load(open(os.path.join(OUT, 'models', 'lottery.json')))
FITS = {int(k): tuple(v) for k, v in LFITS['fits'].items()}
M = LFITS['m']


def origin(as_of):
    """The latest season whose regular season ended before as_of."""
    done = [y for y, d in SEASON_END.items() if d < as_of and y <= proj.LAST_COMPLETE]
    return max(done) if done else None


@lru_cache(maxsize=64)
def pmodel(T):
    T2 = min(max(T, 1985), proj.LAST_COMPLETE)
    return json.load(open(os.path.join(OUT, 'models', f'proj_{T2}.json'))), T2 != T


@lru_cache(maxsize=64)
def cmodel(T):
    T2 = min(max(T, 1990), 2026)
    return json.load(open(os.path.join(OUT, 'models', f'picks_{T2}.json'))), T2 != T


def _apply(m, x):
    z = (np.array(x) - np.array(m['mu'])) / np.array(m['sd'])
    p = 1 / (1 + math.exp(-(float(np.dot(m['logit_coef'], z)) + m['logit_icpt'])))
    v = float(np.dot(m['ridge_coef'], z)) + m['ridge_icpt']
    return p, p * v


def undrafted_rookie(T):
    vals = []
    for pid, bp in BY.items():
        y0 = min(bp)
        r0 = bp[y0]
        if r0.get('draft_pick') or y0 < 1982 or y0 + 9 > T:
            continue
        vals.append([bp.get(y0 + k, {}).get(proj.VKEY, 0.0) for k in range(10)])
    return np.mean(vals, 0).tolist() if vals else [0.0] * 10


PGD = None


SEASON_START = {y: min(d for v in G[f'{y - 1}-{str(y)[2:]}'].values() for d in v) for y in SEASON_END}   # first game


def in_season(as_of):
    """The season being played on as_of, if any (first game on or before it, last regular-season game after it).
    (The first-game dates are computed once: scanning every game on each of 60,000 calls cost 11 minutes a run.)"""
    for y, end in SEASON_END.items():
        if SEASON_START[y] <= as_of < end:
            return y
    return None


@lru_cache(maxsize=64)
def imodel(T):
    return json.load(open(os.path.join(OUT, 'models', f'instream_{T}.json')))


def project(pid, as_of, draft=None):
    """draft: (year, overall) for a player with no NBA season yet."""
    global PGD
    T = origin(as_of)
    bp = BY.get(pid, {})
    first_era = False
    if T is None and 1980 in bp:
        T, first_era = 1980, True     # before any completed season: valued from 1979-80, the first in the data (early-era)
    seasons = [y for y in bp if T is not None and y <= T]
    ys = in_season(as_of)
    if seasons and ys and ys - 1 == T and T >= 2001 and T in bp and isinstance(pid, int):
        # a decision during a season, 2001-02 on: the season so far is an input (games before the date only)
        if PGD is None:
            PGD = instream.shared()
        mdl = imodel(T)
        x = proj.feats({k: v for k, v in bp.items() if k <= T}, T) + instream.std(PGD, pid, ys, as_of)
        out = [_apply(mdl['k'][str(k)], x) if str(k) in mdl['k'] else (None, None) for k in range(1, proj.K + 1)]
        return {'player': pid, 'as_of': as_of, 'basis': 'projection with the season so far', 'origin_season': T, 'seasons_out': 0,
                'p_in_league': [None if p is None else round(p, 3) for p, v in out], 'expected': [None if v is None else round(v, 1) for p, v in out],
                'model': mdl['version'], 'early_era': False, 'inputs': dict(zip(mdl['features'], [round(v, 3) for v in x]))}
    if seasons:
        y = max(seasons)
        mdl, early = pmodel(T)
        x = proj.feats({k: v for k, v in bp.items() if k <= T}, y)
        out = []
        for k in range(1, proj.K + 1):
            mk = mdl['k'].get(str(k))
            if not mk:
                out.append((None, None)); continue
            out.append(_apply(mk, x))
        gap = T - y            # he did not play in the seasons between his last one and the origin
        early = early or first_era
        return {'player': pid, 'as_of': as_of, 'basis': 'projection', 'origin_season': y, 'seasons_out': gap,
                'p_in_league': [None if p is None else round(p, 3) for p, v in out], 'expected': [None if v is None else round(v, 1) for p, v in out],
                'model': mdl['version'], 'early_era': early, 'inputs': dict(zip(proj.NAMES, [round(v, 3) for v in x]))}
    if draft:
        cm, early = cmodel(T or 1985)
        slot = min(draft[1], 60)
        ks = [cm['by_season_after_draft'][k][slot - 1] for k in range(len(cm['by_season_after_draft']))]
        return {'player': pid, 'as_of': as_of, 'basis': f'draft slot {draft[1]} ({draft[0]})', 'expected': [round(max(0, v), 1) for v in ks],
                'model': cm['version'], 'early_era': early}
    v = undrafted_rookie(T or 1985)
    return {'player': pid, 'as_of': as_of, 'basis': 'no NBA season and undrafted: undrafted players\' average first ten seasons', 'expected': [round(x, 1) for x in v],
            'model': f'undrafted-average@{T}', 'early_era': (T or 0) < 1992}


@lru_cache(maxsize=4096)
def slot_dist(Y, as_of):
    first = None
    if Y == 2027 and '2026' in WD:
        v = WD['2026']['picks'].get('1')
        first = (v['from'] or v['team']) if v else None      # 2026's first pick: barred from first again (NBA release)
    return lottery.simulate(LR, FITS, M, Y, as_of, n=500, seed=Y, banned_first=first)


def notes_as_of(a, as_of):
    """The pick's notes a source had stated by the date: dated trade notes up to it, plus the hand-filled protections
    (protections.json, the terms of the trade they were checked against). A 2026 trade's "was HOU own" must not reach
    the 2019 trade of the same pick."""
    if 'notes_dated' not in a:
        return [n for n in (a.get('notes') or []) if not re.search(r'\b[A-Z]{3} own\b', n)]
    said = {n for d, n in a['notes_dated'] if d <= as_of}
    dated = {n for _, n in a['notes_dated']}
    return [n for n in a.get('notes') or [] if n in said or n not in dated]


def pick_inputs(a, as_of, draft_date=None):
    """(original owner, top-N protection) of a pick as known on the date: the owner once a source has said it, or the
    trade's own "XXX own" note up to the date; the draft page only after the draft."""
    notes = ' '.join(notes_as_of(a, as_of))
    m = re.search(r'top[- ]?(\d+)[- ]protected', notes)
    owner = a.get('original_owner') if (a.get('owner_known') or '') <= as_of else None
    if not owner:
        o = re.search(r'\b([A-Z]{3}) own\b', notes)
        if o:
            owner = franchise(o.group(1)) or o.group(1)
    dd = draft_date or f"{a.get('year')}-06-25"
    if not owner and a.get('overall') and str(a.get('year')) in WD and dd <= as_of:
        v = WD[str(a['year'])]['picks'].get(str(a['overall']))
        owner = (v['from'] or v['team']) if v else None
    return owner, (int(m.group(1)) if m else None)


def pick_value(Y, rnd, owner, as_of, protected_top=None):
    T = origin(as_of) or 1985
    cm, early = cmodel(T)
    if not owner or Y < 1980:
        dist, basis = None, 'original owner unknown: the average slot of the round'
    else:
        dist = slot_dist(Y, as_of).get(owner)
        basis = 'slot distribution as of the date'
    BK = cm['by_season_after_draft']
    curve = np.array([0.0] + [sum(BK[k][s_] for k in range(len(BK))) for s_ in range(60)])   # ten seasons after the draft, undiscounted
    curves_k = [np.array([0.0] + BK[k]) for k in range(len(BK))]
    if rnd and rnd >= 3:
        # rounds 3-10 of the old drafts sit past slot 60: valued at the curve's last slot
        by_season = [float(c[60]) for c in curves_k]
        return {'pick': (Y, rnd, owner), 'as_of': as_of, 'basis': 'round 3 or later: the curve\'s last slot', 'p_convey': 1.0,
                'expected_v10': round(sum(by_season), 1), 'by_season': [round(x, 1) for x in by_season], 'model': cm['version'], 'early_era': early}
    if dist is None:
        exp = float(curve[1:31].mean() if rnd == 1 else curve[31:61].mean())
        by_season = [float(c[1:31].mean() if rnd == 1 else c[31:61].mean()) for c in curves_k]
        conv = 1.0
    else:
        d = np.array(dist)
        n = len(d) - 1
        if rnd == 2:
            d = np.concatenate([[0.0] * 31, d[1:31]])[:61]   # a second-round pick sits 30 slots later
        conv = lottery.convey(d, protected_top) if protected_top and rnd == 1 else 1.0
        dd = d.copy()
        if protected_top and rnd == 1:
            dd[:protected_top + 1] = 0
        exp = float((dd[:61] * curve[:len(dd[:61])]).sum())
        by_season = [float((dd[:61] * c[:len(dd[:61])]).sum()) for c in curves_k]
    return {'pick': (Y, rnd, owner), 'as_of': as_of, 'basis': basis + (' (draft rules after 2029 not yet set: the 2027-29 rules assumed)' if Y >= 2030 else ''),
            'p_convey': round(conv, 3), 'expected_v10': round(exp, 1), 'by_season': [round(x, 1) for x in by_season],
            'model': cm['version'] + ' + ' + LFITS['version'], 'early_era': early}


def build():
    E = json.load(open(os.path.join(OUT, 'ledger_events.json')))
    A = json.load(open(os.path.join(OUT, 'ledger_assets.json')))
    snaps, seen = [], set()
    for e in E:
        if e['kind'] not in ('trade', 'sign', 'claim', 'waive', 'release', 'expansion', 'sale', 'drafted', 'lapsed (inferred)'):
            continue
        aid, d = e['asset'], e['date']
        a = A.get(aid, {})
        key = (aid, d)
        if key in seen:
            continue
        seen.add(key)
        if aid.startswith('player:'):
            br = aid.split(':', 1)[1]
            pid = canonical_id(br, a.get('name') or '')
            dr = a.get('drafted')
            s = project(pid, d, draft=(dr[0], dr[1]) if dr else None)
            s.update(asset=aid, event=e['kind'], tx=e.get('tx'))
            snaps.append(s)
        elif aid.startswith('pick:') and e['kind'] == 'trade' and a.get('year') and a['year'] >= 1980:
            owner, prot = pick_inputs(a, d)
            s = pick_value(a['year'], a.get('round') or 1, owner, d, prot)
            s.update(asset=aid, event='trade', tx=e.get('tx'))
            snaps.append(s)
    json.dump(snaps, open(os.path.join(OUT, 'snapshots.json'), 'w'))
    return snaps


if __name__ == '__main__':
    snaps = build()
    c = collections.Counter(('player' if s['asset'].startswith('player:') else 'pick', ' '.join(s.get('basis', '').split(' ')[:4])) for s in snaps)
    print('snapshots', len(snaps), dict(c))
    print('early-era (model fit on later seasons, no earlier data exists):', sum(1 for s in snaps if s.get('early_era')))
