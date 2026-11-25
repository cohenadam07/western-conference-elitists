"""
instream.py — season-to-date performance as a projection input for decisions made during a season,
1996-97 on (the Data Room's player-games table), using only games played before the decision date.

The in-season model is the projection model's inputs as of the last completed season, plus the season
so far: share of the season played, games and minutes, per-100-possession rates (points, assists,
turnovers, rebounds, steals, blocks, shots, free throws, threes), true shooting and usage, and
plus-minus per 100; the three main rates also times the share played (so an early-season sample counts
less). Same two-part model and regularization as proj.py.

Point in time: version T is fit on seasons whose outcomes ended by T; a decision in season T+1 uses it.

    python3 instream.py eval     # with vs without season-to-date inputs, at Dec 15 and Feb 1 -> out/instream_eval.txt
    python3 instream.py fit      # -> out/models/instream_<T>.json
"""
import collections, gzip, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, HERE)
import proj  # noqa: E402
from proj import GroupKFold  # noqa: E402  (sklearn, imported only when fitting)

# the Data Room's per-season player-game tables (release 'dataroom'), kept under the fetch cache: the Mac's, or the
# cloud job's .gm-cache (gm_cloud_run.sh downloads the season in progress each run)
PG = os.path.join(os.environ.get('GM_CACHE') or os.path.expanduser('~/Basketball-Savant/cache_gm'), 'dataroom')
VERSION = 'instream-1.0'
CUTS = ('12-01', '01-01', '02-01', '03-01')
STD_NAMES = ['share', 'gp', 'mpg', 'poss_k', 'pts100', 'ast100', 'tov100', 'oreb100', 'dreb100', 'stl100', 'blk100', 'fga100', 'fta100', 'fg3a100',
             'ts', 'usg', 'pm100', 'pts100xshare', 'pm100xshare', 'ast100xshare', 'played']


NUM = ('min', 'poss', 'pts', 'ast', 'tov', 'oreb', 'dreb', 'stl', 'blk', 'fga', 'fta', 'fg3a', 'usg', 'plus_minus')


class Seasons:
    """The player-game tables by season, each read once when first asked for, holding only what std() uses: per
    player, the dates and each number column as tuples, in file order, with each value exactly as the source gave it
    (an int stays an int: Python sums ints exactly and floats with compensation, so turning them into one float
    array moves the last digit). All 31 seasons this way cost about 200 MB; as Python rows they cost 656 MB, which
    with everything else put each step over 1 GB (the Mac ran out of memory running two at once)."""

    def __init__(self):
        self.files = {int(f.split('-')[-2]) + 1: os.path.join(PG, f) for f in (os.listdir(PG) if os.path.isdir(PG) else [])
                      if f.startswith('nba-player_games-') and f.endswith('.json.gz')}
        self.mem = {}

    def __contains__(self, y):
        return y in self.files

    def __len__(self):
        return len(self.files)

    def __getitem__(self, y):
        if y not in self.mem:
            d = json.load(gzip.open(self.files[y]))
            col = {k: i for i, k in enumerate(d['columns'])}
            rows = d.pop('rows')
            del d
            by = collections.defaultdict(list)
            for r in rows:
                by[r[col['player_id']]].append(r)
            dates = sorted({r[col['date']] for r in rows})
            del rows
            ci = [col[k] for k in NUM]
            one = {}                                       # one object per distinct value (keyed by type: 15 and 15.0 stay apart)
            same = lambda v: one.setdefault((type(v), v), v)
            self.mem[y] = ({p: (tuple(same(r[col['date']]) for r in rs), tuple(tuple(same(r[i] or 0) for r in rs) for i in ci))
                            for p, rs in by.items()}, dates)
            del by
        return self.mem[y]


_SHARED = None


def shared():
    """The one lazy instance a process uses (grade, snapshots)."""
    global _SHARED
    if _SHARED is None:
        _SHARED = Seasons()
    return _SHARED


def load():
    return shared()


def std(PGD, pid, y, as_of):
    if y not in PGD:
        return None
    by, dates = PGD[y]
    season_days = [d for d in dates if d < as_of]
    share = len(season_days) / max(1, len(dates))
    p = by.get(pid)
    sel = [i for i, d in enumerate(p[0]) if d < as_of] if p else []
    if not sel:
        return [share] + [0.0] * (len(STD_NAMES) - 2) + [0.0]
    cols = dict(zip(NUM, p[1]))
    g = lambda k: sum(cols[k][i] for i in sel)       # in file order, each value as given: the same sum as over the rows
    poss = max(1.0, g('poss'))
    per = lambda k: 100 * g(k) / poss
    fga, fta = g('fga'), g('fta')
    ts = (g('pts') + 0.54 * 2 * 100 * 0.44) / (2 * (fga + 0.44 * fta) + 2 * 100 * 0.44)   # pulled toward .54 by 100 attempts
    usg = np.mean([cols['usg'][i] for i in sel])
    n = len(sel)
    x = [share, n, g('min') / n, poss / 1000, per('pts'), per('ast'), per('tov'), per('oreb'), per('dreb'), per('stl'), per('blk'),
         per('fga'), per('fta'), per('fg3a'), ts, usg, per('plus_minus')]
    x += [x[4] * share, x[16] * share, x[5] * share, 1.0]
    return x


def pairs(by, PGD, k, cuts=CUTS, last=proj.LAST_COMPLETE, first=1997):
    XA, XB, inn, val, grp = [], [], [], [], []
    for pid, bp in by.items():
        if not isinstance(pid, int):
            continue
        for y in range(first, last + 1):
            if y - 1 not in bp or y - 1 + k > last or y not in PGD:
                continue
            xa = proj.feats({kk: v for kk, v in bp.items() if kk <= y - 1}, y - 1)
            r = bp.get(y - 1 + k)
            for cut in cuts:
                as_of = f'{y - 1 if cut[:2] in ("10", "11", "12") else y}-{cut}'
                xs = std(PGD, pid, y, as_of)
                XA.append(xa); XB.append(xa + xs)
                inn.append(1 if r else 0); val.append(r[proj.VKEY] if r else 0.0); grp.append(str(pid))
    return np.array(XA), np.array(XB), np.array(inn), np.array(val), np.array(grp)


def evaluate():
    rows, by = proj.table()
    PGD = load()
    hp = json.load(open(os.path.join(OUT, 'proj_hp.json')))
    rep = [f'{VERSION}: decisions during the season, 1996-97 to 2025-26, players who played the season before. Out of sample, split by player.',
           'RMSE in Savant points (era footing). "this season" = the season the decision is made in (k=1 from the last completed season).', '']
    for cut in ('12-15', '02-01'):
        for k, label in ((1, 'this season'), (2, 'next season'), (3, 'two seasons on')):
            XA, XB, inn, val, grp = pairs(by, PGD, k, cuts=(cut,))
            pa, pb = np.zeros(len(val)), np.zeros(len(val))
            for tr, te in GroupKFold(5).split(XA, val, grp):
                pa[te] = proj.Model(hp['C'], hp['alpha']).fit(XA[tr], inn[tr], val[tr]).predict(XA[te])[1]
                pb[te] = proj.Model(hp['C'], hp['alpha']).fit(XB[tr], inn[tr], val[tr]).predict(XB[te])[1]
            ra, rb = math.sqrt(np.mean((pa - val) ** 2)), math.sqrt(np.mean((pb - val) ** 2))
            rep.append(f'as of {cut}, {label:15}: without season-to-date {ra:6.1f}, with {rb:6.1f}  ({1 - rb / ra:+.0%})   n={len(val)}')
    open(os.path.join(OUT, 'instream_eval.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))


def fit_all():
    rows, by = proj.table()
    PGD = load()
    hp = json.load(open(os.path.join(OUT, 'proj_hp.json')))
    only = os.environ.get('GM_FIT_ONLY')
    for T in ([int(only)] if only else range(2001, proj.LAST_COMPLETE + 1)):
        ver = {'version': f'{VERSION}@{T}', 'fit_through_season_end': T, 'features': proj.NAMES + STD_NAMES, 'k': {}}
        for k in range(1, proj.K + 1):
            XA, XB, inn, val, grp = pairs(by, PGD, k, last=T)
            if len(val) < 500:
                continue
            ver['k'][k] = dict(proj.Model(hp['C'], hp['alpha']).fit(XB, inn, val).dump(), n=len(val))
        json.dump(ver, open(os.path.join(OUT, 'models', f'instream_{T}.json'), 'w'))
    print('in-season versions written')


if __name__ == '__main__':
    {'eval': evaluate, 'fit': fit_all}[sys.argv[1] if len(sys.argv) > 1 else 'eval']()
