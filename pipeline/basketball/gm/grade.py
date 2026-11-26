"""
grade.py — Module 4: every decision, two grades, credited to its decision-makers by weight.

Units: Savant points on the era footing, ten seasons from the decision season, each later season
discounted 5% (a chosen rate: nothing in the data prices waiting yet; the Contract tab will let it be
measured). Pending change: once the Contract tab exists, a player counts only for seasons the team controls him.

At the time   value received minus value given up, from the point-in-time snapshots as of the agreement date
              (model versions that saw nothing later). A decision made during a season counts only the rest of it.
              Dropped (how it turned out only) where the snapshot is early-era: a model that saw later seasons.
How it turned out
              what each asset actually produced for the team (its share of the player's minutes with that team
              each season), and when the team traded it on, the share of what came back for it (pro rata to the
              values at that time), and so on; what is still held today counts at today's projection.

Decision types: trade (each team's side), draft pick, free-agent and other signings (two-way, 10-day, Exhibit
10 named), re-signing and extension, letting a player walk (inferred lapses), waiver and release, coach hire and
firing (Coaching Savant's wins against roster talent, 2002-03 on, at 31.7 points a win, measured from game margins).

    python3 grade.py            # -> out/gm_decisions.json, a summary
    python3 grade.py leakage    # recompute a sample of at-the-time grades with every later season deleted
"""
import bisect, collections, datetime as dt, json, math, os, re, sys, unicodedata
from functools import lru_cache
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..'))
import snapshots as SN  # noqa: E402
import proj  # noqa: E402
from br_crosswalk import canonical_id  # noqa: E402
from credit import credit_on  # noqa: E402
from tenures import franchise  # noqa: E402

VERSION = 'grade-1.0'
DISCOUNT = 0.05
HORIZON = 10
POINTS_PER_WIN = 31.7
TODAY = os.environ.get('GM_ASOF') or dt.date.today().isoformat()   # an as-of build (the replay) is as of its day, not the clock's
NOW_SEASON = 2027                    # the season in progress
NON_TEAM = {'POOL', 'RETIRED', 'DRAFT', 'OPENING', None}

A = json.load(open(os.path.join(OUT, 'ledger_assets.json')))
# Hand-filled protections for the biggest pre-2017 pick trades, from press coverage (protections.json, Module 6 follow-up).
# A top-N note is what pv_pick_seasons reads; "unprotected" clears the unknown-protections flag.
for _aid, _p in json.load(open(os.path.join(HERE, 'protections.json'))).items():
    if _p.get('applied') and _aid in A:
        A[_aid].setdefault('notes', []).append('unprotected' if not _p['top_n'] else f"top-{_p['top_n']}-protected")
        A[_aid]['protection_source'] = {'url': _p['source'], 'says': _p['says'], 'checked': _p['checked']}
E = json.load(open(os.path.join(OUT, 'ledger_events.json')))
TR = {t['tx']: t for t in json.load(open(os.path.join(OUT, 'ledger_trades.json')))}
C = json.load(open(os.path.join(OUT, 'gm_credit.json')))
REP = json.load(open(os.path.join(OUT, 'ledger_repairs.json')))
ERA = json.load(open(os.path.join(OUT, 'era_scale.json')))
# (out/snapshots.json, the stored point-in-time projections, is for reading; grades compute their own: 126 MB not loaded)

EV = collections.defaultdict(list)
for i, e in enumerate(E):
    EV[e['asset']].append((e['date'], i, e))
for k in EV:
    EV[k].sort(key=lambda x: (x[0], x[1]))
BYTX = collections.defaultdict(list)
for i, e in enumerate(E):
    if e.get('tx'):
        BYTX[e['tx']].append(e)
REP_TX = {r['tx'] for r in REP}
REP_ASSET = collections.defaultdict(list)
for r in REP:
    REP_ASSET[r['asset']].append((r['uncertain_from'], r['uncertain_to']))


def season_of(d):
    return int(d[:4]) + (1 if d[5:7] >= '07' else 0)


def w(y, y0):
    return 1 / (1 + DISCOUNT) ** (y - y0)


# ---------------------------------------------------------------- realized value by team
def team_shares():
    """{(Basketball-Reference id, season end year): {franchise: share of his minutes}} from the season totals (keyed by
    NBA id below, once nba_id can read every player's seasons)."""
    import pagefacts
    out = collections.defaultdict(dict)
    for y in range(1980, NOW_SEASON + 1):
        rows = pagefacts.totals_rows(y)          # the totals page, or its parsed rows (the cloud)
        if not rows:
            continue
        mp = collections.defaultdict(dict)
        names = {}
        for pid, tm, m, nm in rows:
            if m is not None and not re.match(r'TOT|\dTM', tm):
                f = 'CHO' if tm == 'CHA' and y >= 2005 else franchise(tm)
                if f:
                    mp[pid][f] = mp[pid].get(f, 0) + m
                    names[pid] = nm if nm else ''
        for br, teams in mp.items():
            tot = sum(teams.values()) or 1
            BR_MIN[(br, y)] = (tot, {f: v / tot for f, v in teams.items()})
            BR_NAME.setdefault(br, names.get(br, ''))
            out[(br, y)] = {f: v / tot for f, v in teams.items()}
    return out


BR_MIN, BR_NAME = {}, {}
_SHARE_BR = team_shares()
VAL = {}
ROWS = json.load(open(os.path.join(OUT, 'model_seasons.json')))
ERA_LAST = ERA['reference_total_per_team_season'] / ERA['per_team_season']['2025-26']
for r in ROWS:
    # the season in progress: points so far on the latest complete season's era factor
    VAL[(r['id'], r['y'])] = r['valuer'] if r['y'] < NOW_SEASON else r['value'] * ERA_LAST


# ---------------------------------------------------------------- which NBA id a Basketball-Reference id is
# The crosswalk (br_crosswalk.canonical_id) matches a name alone, and goes wrong two ways (the 1.0.2 audit, Nov 25,
# 2026): a son the ledger spells without his suffix gets his father's id ("Ron Harper" for Ron Harper Jr., harpero02:
# 166, not 1631199), and a name two NBA ids share gets none ("Mike Dunleavy", "Patrick Ewing", "Mike James": 38 players),
# so his NBA Savant seasons from 1996-97 on (kept under his NBA id) reached no grade. Here the candidates are every NBA
# id whose name is his with or without a suffix (Jr., Sr., II, III, IV, V), and his is the one whose NBA Savant seasons
# overlap his own seasons the most (the season totals, by Basketball-Reference id). No overlap, or a tie, keeps the
# crosswalk's answer. NBA Savant keeps a name it could not match under "br:<id>" for the seasons before 1996-97: those
# join the NBA id's (Patrick Ewing 1985-86 to 1995-96 and 1996-97 on are one career).
# Where his name finds no NBA id whose seasons are his (a nickname or another spelling: "Ronald Murray" is NBA.com's
# "Flip Murray", "Isaac Austin" its "Ike Austin"; a rookie the offline list does not have yet), his seasons are matched
# to NBA Savant's rows by season, team and minutes: in each completed season, the one row on one of his teams within
# 10 minutes or 2% of his total (where two rows are that close, the one within a minute), taken by no player his name
# already finds. Every season that matches must name the same NBA id (the last 33 players, Nov 25, 2026).
_SUFFIX = re.compile(r'[\s,]+(jr|sr|ii|iii|iv|v)\.?$')


def _base(name):
    s = ''.join(c for c in unicodedata.normalize('NFD', (name or '').lower()) if unicodedata.category(c) != 'Mn')
    return _SUFFIX.sub('', s.strip()).replace('.', '').strip()


def _family():
    from nba_api.stats.static import players as SP
    fam = collections.defaultdict(set)
    for p in SP.get_players():
        fam[_base(p['full_name'])].add(p['id'])
    return fam


FAMILY = _family()
NBA_YEARS = collections.defaultdict(set)          # NBA id -> the seasons NBA Savant has for him
for r in ROWS:
    if isinstance(r['id'], int):
        NBA_YEARS[r['id']].add(r['y'])
BR_YEARS = collections.defaultdict(set)           # Basketball-Reference id -> his seasons
for (_b, _y) in BR_MIN:
    BR_YEARS[_b].add(_y)


ROWS_AT = collections.defaultdict(list)          # (season, franchise) -> [(minutes, NBA id)] from NBA Savant's rows
for r in ROWS:
    if isinstance(r['id'], int) and r['y'] < NOW_SEASON and r.get('min') is not None:
        f = franchise(r['team'])
        if f:
            ROWS_AT[(r['y'], f)].append((r['min'], r['id']))


@lru_cache(maxsize=None)
def _by_family(br, *names):
    """The NBA id among his name's family (with or without a suffix) whose seasons overlap his the most, or None."""
    fam = set().union(*(FAMILY.get(_base(n), set()) for n in names)) if names else set()
    mine = BR_YEARS.get(br, set())
    if fam and mine:
        ov = {i: len(NBA_YEARS.get(i, set()) & mine) for i in fam}
        best = max(ov.values())
        top = [i for i, v in ov.items() if v == best]
        if best > 0 and len(top) == 1:
            return top[0]
    return None


_CLAIMED = None


def _by_minutes(br):
    """The NBA id whose rows match his completed seasons by team and minutes, or None."""
    global _CLAIMED
    if _CLAIMED is None:              # every id a name already finds (by family, or the crosswalk's exact name)
        _CLAIMED = set()
        for b in BR_YEARS:
            nm = [n for n in (BR_NAME.get(b, ''), A.get(f'player:{b}', {}).get('name') or '') if n]
            c = _by_family(b, *nm)
            if c is None:
                c = next((x for x in (canonical_id(b, n) for n in nm) if not isinstance(x, str)), None)
            if c is not None:
                _CLAIMED.add(c)
    votes = set()
    for y in sorted(BR_YEARS.get(br, ())):
        if y >= NOW_SEASON:
            continue
        tot, sh = BR_MIN[(br, y)]
        near = {(abs(m - tot), i) for f in sh for m, i in ROWS_AT.get((y, f), ()) if abs(m - tot) <= max(10, 0.02 * tot) and i not in _CLAIMED}
        hit = {i for d, i in near}
        if len(hit) > 1:                       # two rows close to his minutes: only an exact one (within a minute) tells
            hit = {i for d, i in near if d <= 1}
            if len(hit) != 1:
                return None
        votes |= hit
    return votes.pop() if len(votes) == 1 else None


@lru_cache(maxsize=None)
def nba_id(br, *names):
    """His NBA id (int), or "br:<id>" where none can be told: by seasons among his name's family; else by the first name
    the crosswalk matches, if that id has seasons of his; else by season, team and minutes; else the crosswalk's id."""
    names = tuple(n for n in names if n)
    c = _by_family(br, *names)
    if c is not None:
        return c
    mine = BR_YEARS.get(br, set())
    named = next((x for x in (canonical_id(br, n) for n in names) if not isinstance(x, str)), None)
    if named is not None and (NBA_YEARS.get(named, set()) & mine or not mine):
        return named
    m = _by_minutes(br) if mine else None
    if m is not None:
        return m
    return named if named is not None else f'br:{br}'


def _nba_id_any(br):
    """By the totals page's spelling, then the ledger's (the totals page and the ledger can spell him differently)."""
    return nba_id(br, BR_NAME.get(br, ''), A.get(f'player:{br}', {}).get('name') or '')


SHARE = {}
for (_b, _y), _sh in _SHARE_BR.items():
    SHARE[(_nba_id_any(_b), _y)] = _sh
# a career NBA Savant splits (seasons before 1996-97 under "br:<id>", later ones under the NBA id): one career here
for _b in sorted(BR_YEARS):
    _c = _nba_id_any(_b)
    if isinstance(_c, int):
        for _y in sorted(BR_YEARS[_b]):
            if (f'br:{_b}', _y) in VAL and (_c, _y) not in VAL:
                VAL[(_c, _y)] = VAL[(f'br:{_b}', _y)]


def pid_of(aid):
    return nba_id(aid.split(':', 1)[1], A.get(aid, {}).get('name') or '')


# Namesakes: the crosswalk maps a Basketball-Reference id to an NBA id by name alone, so two players with one name
# (two Lee Johnsons, three John Johnsons) can share an id, and each would be credited the other's seasons. For
# realized value each gets his own id carrying only the seasons his Basketball-Reference id played; a season both
# played goes to the one with more minutes. Projections keep the shared id (at-the-time grades do not move).
VID = {}
_groups = collections.defaultdict(set)
for _aid, _a in A.items():
    if _aid.startswith('player:'):
        _br = _aid.split(':', 1)[1]
        _groups[nba_id(_br, _a.get('name') or '')].add(_br)
for (_br, _y) in BR_MIN:
    _groups[nba_id(_br, BR_NAME.get(_br, ''))].add(_br)
for _c, _brs in _groups.items():
    if len(_brs) < 2 or isinstance(_c, str):
        continue
    _seasons = {y for (b, y) in BR_MIN if b in _brs}
    for _y in _seasons:
        _owner = max((b for b in _brs if (b, _y) in BR_MIN), key=lambda b: (BR_MIN[(b, _y)][0], b))
        if (_c, _y) in VAL:
            VAL[(f'br:{_owner}', _y)] = VAL[(_c, _y)]
        SHARE[(f'br:{_owner}', _y)] = BR_MIN[(_owner, _y)][1]
    for _y in [y for (c, y) in list(VAL) if c == _c]:
        del VAL[(_c, _y)]
    for _k in [k for k in SHARE if k[0] == _c]:
        del SHARE[_k]
    for _b in _brs:
        VID[_b] = f'br:{_b}'
NAMESAKES = {c: sorted(b) for c, b in _groups.items() if len(b) > 1 and not isinstance(c, str)}


def vid_of(aid):
    """The id realized value is kept under (pid_of, except for namesakes; and where the ledger's spelling finds no NBA
    id, the totals page's: "Danuel House" / "Danuel House Jr.")."""
    br = aid.split(':', 1)[1]
    if br in VID:
        return VID[br]
    c = pid_of(aid)
    if isinstance(c, str) and BR_NAME.get(br):
        c2 = nba_id(br, BR_NAME[br])
        return c2 if not isinstance(c2, str) else c
    return c


def pv_player_seasons(pid, as_of, team_hint=None, draft=None):
    """{season: expected value} from the snapshot (or a fresh one) as of the date."""
    snap = SN.project(pid, as_of, draft=draft)
    ys = SN.in_season(as_of)
    out = {}
    if snap.get('origin_season') is not None:
        base = snap['origin_season']
    elif draft:
        base = draft[0]
    else:
        base = season_of(as_of) - 1
    for k, v in enumerate(snap.get('expected') or [], 1):
        if v is None:
            continue
        y = base + k
        f = 1.0
        if ys and y == ys:
            f = 1 - SN.instream.std(SN.instream.shared(), pid, ys, as_of)[0] if isinstance(pid, int) and ys >= 1997 else 0.5
        out[y] = v * f
    return out, snap


DRAFT_DATE = {}
for _e in E:
    if _e['kind'] == 'drafted':
        _y = int(_e['date'][:4])
        DRAFT_DATE[_y] = min(DRAFT_DATE.get(_y, _e['date']), _e['date'])


def pv_pick_seasons(a, as_of):
    owner, prot = SN.pick_inputs(a, as_of, DRAFT_DATE.get(a.get('year')))
    s = SN.pick_value(a['year'], a.get('round') or 1, owner, as_of, prot)
    return {a['year'] + k: v for k, v in enumerate(s.get('by_season') or [], 1)}, s


@lru_cache(maxsize=200000)
def pv(aid, as_of):
    """Expected value by season of an asset as of a date, and whether that snapshot is early-era."""
    a = A.get(aid, {})
    if aid.startswith('player:'):
        dr = a.get('drafted')
        seasons, snap = pv_player_seasons(pid_of(aid), as_of, draft=(dr[0], dr[1]) if dr else None)   # used only while he has no NBA season (snapshots.project)
        return seasons, bool(snap.get('early_era')), snap.get('model')
    if aid.startswith('pick:') and a.get('year'):
        seasons, s = pv_pick_seasons(a, as_of)
        return seasons, bool(s.get('early_era')), s.get('model')
    return {}, False, None


def pv_total(aid, as_of, y0):
    s, early, model = pv(aid, as_of)
    return sum(v * w(y, y0) for y, v in s.items() if y0 <= y < y0 + HORIZON), early, model


IN_PROGRESS = set()
sys.setrecursionlimit(50000)


DRAFT_DAY = {}
for _a, _x in A.items():
    if _x.get('kind') == 'player' and _x.get('drafted'):
        _d = next((e['date'] for d_, i_, e in EV.get(_a, []) if e['kind'] == 'drafted'), None)
        if _d:
            DRAFT_DAY[_a] = _d


@lru_cache(maxsize=20000)
def slot_seasons(Y, ov, draft_day):
    """The slot's expectation by season (the curve the draft grade uses, as of the draft): what a pick is worth once it
    conveys, and what draft rights are worth before the season. Who was chosen there is the drafting team's grade."""
    cm, _ = SN.cmodel(SN.origin(draft_day) or 1985)
    ov = min(max(1, ov), 60)
    return tuple((Y + 1 + k, cm['by_season_after_draft'][k][ov - 1]) for k in range(len(cm['by_season_after_draft'])))


_ALL_GAMES = sorted({d for s_ in json.load(open(os.path.join(OUT, 'games.json'))).values() for ds in s_.values() for d in ds})


def season_opener_after(d):
    i = bisect.bisect_right(_ALL_GAMES, d)
    return _ALL_GAMES[i] if i < len(_ALL_GAMES) else '9999-12-31'


DRAFTS_OF = None


def drafts_of(aid):
    """[(draft day, year, overall)] for every time he was drafted (some were twice: Sabonis, 1985 and 1986)."""
    global DRAFTS_OF
    if DRAFTS_OF is None:
        from ledger import drafts as D_
        DRAFTS_OF = collections.defaultdict(list)
        for y, d in D_().items():
            for rnd, ov, team, br, name in d['picks']:
                if br:
                    DRAFTS_OF[f'player:{br}'].append((d['date'], y, ov))
    return DRAFTS_OF.get(aid, [])


def rights_window(aid, since):
    """(year, overall, draft day) while `aid` is a player's draft rights: from his (latest) draft day until the next
    season's first game (the 2020 draft was in November, so no fixed date works)."""
    past = [x for x in drafts_of(aid) if x[0] <= since]
    if past:
        dd, y, ov = max(past)
        if since < season_opener_after(dd):
            return y, ov, dd
        return None
    dr = A.get(aid, {}).get('drafted')
    dd = DRAFT_DAY.get(aid)
    if dr and dd and dd <= since < season_opener_after(dd):
        return dr[0], dr[1], dd
    return None


# ---- incremental nights (GM_INCREMENTAL=1, gm_update.py): what can't have changed is carried over, not recomputed.
# A value is "live" when it reads anything that moves: an asset still held (its projection, or a later trade), a
# season from the current one on, or draft rights whose next season hasn't started. Everything else is settled: it
# reads only seasons and transactions before the current season, which no night can change unless history itself
# changes (code, models, past values, past transactions), and then the basis below changes and the night is full.
INCR = os.environ.get('GM_INCREMENTAL') == '1'
CUR = season_of(TODAY)                                     # the season in progress (or about to start)
CUTOFF = f'{CUR - 1}-07-01'
_RV, _LIVE, _STACK = {}, {}, []


def mark_live():
    if _STACK:
        _STACK[-1][0] = True


def rv(aid, team, since):
    """Realized value by season (a dict as tuple) that `team` got from asset `aid` from date `since` on.

    An asset that comes back the same day is followed once: inside its own computation it counts as nothing. A value
    computed while such a loop was cut short (cut by a key still being computed further up) is used there but not
    remembered, so every value is the same whatever order the decisions are graded in. (The lru_cache this replaces
    kept the cut-short value for good: the first decision to ask got the full value, later ones the cut one; 18
    trades, all with an asset that came back the same day, were graded on the cut value.)"""
    key = (aid, team, since)
    if key in _RV:
        if _LIVE[key]:
            mark_live()
        return _RV[key]
    if key in IN_PROGRESS:
        for fr in reversed(_STACK):              # every computation inside this key's own is cut short by it
            if fr[2] == key:
                break
            fr[1].add(key)
        return ()
    IN_PROGRESS.add(key)
    _STACK.append([False, set(), key])
    try:
        r = _rv(aid, team, since)
    finally:
        IN_PROGRESS.discard(key)
        live, cut, _ = _STACK.pop()
    cut.discard(key)
    if cut:                                      # cut short by a computation still open above: not remembered
        if _STACK:
            _STACK[-1][1].update(cut)
    else:
        _RV[key], _LIVE[key] = r, live
    if live:
        mark_live()
    return r


def tracked(fn):
    """(fn(), whether it read anything live)."""
    _STACK.append([False, set(), None])
    try:
        v = fn()
    finally:
        live, cut, _ = _STACK.pop()
    if cut and _STACK:
        _STACK[-1][1].update(cut)
    if live:
        mark_live()
    return v, live


STATE = os.path.join(OUT, 'grade_state.json')


def basis():
    """What every settled value depends on: the code and models, past seasons' values and minutes, transactions and
    games before the current season. If any of it changes, nothing is carried over."""
    import hashlib, glob as _g
    h = hashlib.sha1(str(CUR).encode())
    for f in sorted(_g.glob(os.path.join(HERE, '*.py')) + _g.glob(os.path.join(HERE, '*.json')) + _g.glob(os.path.join(OUT, 'models', '*.json'))):
        h.update(os.path.basename(f).encode()); h.update(open(f, 'rb').read())
    h.update(repr(sorted(((k, v) for k, v in VAL.items() if k[1] < CUR), key=repr)).encode())   # ids are ints and strings: ordered by repr
    h.update(repr(sorted(((k, sorted(v.items())) for k, v in SHARE.items() if k[1] < CUR), key=repr)).encode())
    h.update(json.dumps([e for e in E if e['date'] < CUTOFF], sort_keys=True).encode())
    h.update(repr([d for d in _ALL_GAMES if d < CUTOFF]).encode())
    return h.hexdigest()


BASIS = basis() if INCR else None
_st = json.load(open(STATE)) if INCR and os.path.exists(STATE) else {}
PREV = _st.get('settled', {}) if _st.get('basis') == BASIS else {}           # yesterday's settled turned-out grades
# one-time re-grades (at_time_regrade.json): each batch is applied once, in the first production run that has it, to
# every stored grade it covers; out/regrade_applied.json records which batches this state has had
BATCHES = json.load(open(os.path.join(HERE, 'at_time_regrade.json')))['batches']
APPLIED = os.path.join(OUT, 'regrade_applied.json')
PENDING = [b for b in BATCHES if b not in (json.load(open(APPLIED)) if os.path.exists(APPLIED) else {}).get('points', {})] \
    if os.environ.get('GM_FREEZE') == '1' else []


def regrade_due(did):
    """The pending batch that re-grades this stored at-the-time grade, or None."""
    return next((b for b in PENDING if BATCHES[b].get('all') or did in BATCHES[b].get('ids', ())), None)


FROZ = {k: v for k, v in json.load(open(os.path.join(OUT, 'frozen_at_time.json'))).items() if not regrade_due(k)} \
    if INCR and os.environ.get('GM_FREEZE') == '1' and os.path.exists(os.path.join(OUT, 'frozen_at_time.json')) else {}
SETTLED = {}
CARRIED = collections.Counter()


def turned_out(sid, fn):
    """A decision's how-it-turned-out grade: yesterday's if it was settled, else computed (and kept if settled now)."""
    if sid in PREV:
        CARRIED['turned out carried over'] += 1
        SETTLED.setdefault(sid, PREV[sid])
        return PREV[sid]
    v, live = tracked(fn)
    if not live:
        SETTLED.setdefault(sid, v)        # a decision a source lists twice: the first, as the duplicates rule keeps
    CARRIED['turned out computed'] += 1
    return v


def at_time_of(sid, fn):
    """(value, early, model) at the time: a frozen decision's stored grade is never recomputed on an incremental night
    (freeze() applies the stored grade, note and models either way)."""
    if sid in FROZ:
        CARRIED['at the time frozen'] += 1
        return None, False, None
    CARRIED['at the time computed'] += 1
    return fn()


def _rv(aid, team, since):
    out = collections.Counter()
    if aid.startswith('player:'):
        rw = rights_window(aid, since)
        if rw:
            if season_opener_after(rw[2]) == '9999-12-31':
                mark_live()          # rights until a season not yet on the schedule
            return slot_seasons(*rw)
    ev = EV.get(aid, [])
    leave = next((e for d, i, e in ev if d >= since and e['from'] == team and e['to'] != team and e['kind'] not in ('repair', 'opening')), None)
    end_d = leave['date'] if leave else TODAY
    if not leave or min(season_of(end_d), NOW_SEASON) >= CUR:
        mark_live()                  # still held, or held into the current season
    if aid.startswith('player:'):
        pid = vid_of(aid)
        for y in range(season_of(since), min(season_of(end_d), NOW_SEASON) + 1):
            v = VAL.get((pid, y))
            if v is None:
                continue
            sh = SHARE.get((pid, y), {}).get(team, 0.0)
            out[y] += v * sh
        if not leave:
            seasons, _, _ = pv(aid, TODAY)
            for y, v in seasons.items():
                if y >= NOW_SEASON:              # the projection covers seasons not yet complete
                    out[y] += v
            return tuple(sorted(out.items()))
    elif not leave:
        if aid.startswith('pick:') and A.get(aid, {}).get('year') and A[aid]['year'] >= CUR:
            seasons, _, _ = pv(aid, TODAY)
            for y, v in seasons.items():
                out[y] += v
        return tuple(sorted(out.items()))
    # it left: what came back for it in the same transaction
    tx = leave.get('tx')
    if leave['kind'] == 'conveyed':
        a = A.get(aid, {})
        if a.get('year') and a.get('overall'):
            return slot_seasons(a['year'], a['overall'], leave['date'])
        p = a.get('became')
        if p:
            for y, v in rv(f'player:{p}', team, leave['date']):
                out[y] += v
        return tuple(sorted(out.items()))
    back = [e['asset'] for e in BYTX.get(tx, []) if e['to'] == team and e['kind'] not in ('repair',)] if tx else []
    if not back:
        return tuple(sorted(out.items()))
    sent = [e['asset'] for e in BYTX.get(tx, []) if e['from'] == team and e['kind'] not in ('repair',)]
    y0 = season_of(leave['date'])
    vals = {s: max(0.0, pv_total(s, leave['date'], y0)[0]) for s in sent}
    tot = sum(vals.values())
    share = vals.get(aid, 0.0) / tot if tot > 0 else 1.0 / max(1, len(sent))
    for b in back:
        for y, v in rv(b, team, leave['date']):
            out[y] += share * v
    return tuple(sorted(out.items()))


# ---------------------------------------------------------------- conserved value (the conservation check, conserve.py)
# Every decision is credited what it brought in minus what it sent out, each valued at the asset's own production
# from that day on: a player's actual seasons wherever he plays them (the rest of that season at the teams that held
# him after the decision, every later season in full) plus his projection while he is still in the league; a pick
# at its slot's expectation once it conveys (what the drafter makes of it beyond that is the draft grade), else the
# pick model; draft rights at the slot until the season begins. An asset is never followed into what it was traded
# for (that is the trade's own credit), so nothing is counted twice: for every team-season, the credits of all its
# decisions (with the few moves no one decided: 1979's rosters, each team's own picks, expansion drafts, the ledger's
# repairs) add up to exactly what its players produced.
POS = {}
for _a, _ev in EV.items():
    for _k, (_d, _i, _e) in enumerate(_ev):
        POS[(_a, _e.get('tx'), _e['kind'], _e['from'], _e['to'], _d)] = _k
_R, _RLIVE = {}, {}


def active(pid):
    return VAL.get((pid, NOW_SEASON)) is not None or VAL.get((pid, NOW_SEASON - 1)) is not None


def R(aid, pos):
    """The asset's own value by season from its event at EV[aid][pos] on, as a tuple of (season, value)."""
    if pos is None:
        return ()
    key = (aid, pos)
    if key in _R:
        if _RLIVE[key]:
            mark_live()
        return _R[key]
    live = False
    out = collections.Counter()
    ev = EV.get(aid, [])
    since = ev[pos][0]
    if aid.startswith('player:'):
        rw = rights_window(aid, since)
        # still draft rights: held along the chain from the draft (a team that signs him from the pool after they
        # were given up has signed a free agent)
        intact = rw and not any(x[2]['to'] in NON_TEAM or x[2]['from'] in NON_TEAM for x in ev[:pos + 1]
                                if x[0] >= rw[2] and x[2]['kind'] != 'drafted')
        if intact and ev[pos][2]['to'] not in NON_TEAM:
            # draft rights a team holds: the slot, until the season begins (the draft grade then carries the rest)
            live = season_opener_after(rw[2]) == '9999-12-31'
            r = slot_seasons(*rw)
        else:
            # (rights given up before the season are valued at what he went on to produce: the draft grade gave the
            # team his career, and whoever signs him later is credited it again from then)
            pid = vid_of(aid)
            y0 = season_of(since)
            end0 = f'{y0}-07-01'
            held = set()
            for d2, i2, e2 in ev[pos:]:
                if d2 >= end0:
                    break
                if e2['to'] not in NON_TEAM:
                    held.add(e2['to'])
            for y in range(y0, NOW_SEASON + 1):
                v = VAL.get((pid, y))
                if v is None:
                    continue
                sh = sum(SHARE.get((pid, y), {}).get(t, 0.0) for t in held) if y == y0 else 1.0
                if sh:
                    out[y] += v * sh
                    live = live or y >= CUR
            if active(pid) or (pid != pid_of(aid) and active(pid_of(aid)) and (pid, NOW_SEASON - 1) in VAL):
                seasons, _, _ = pv(aid, TODAY)
                for y, v in seasons.items():
                    if y >= NOW_SEASON:          # the projection covers seasons not yet complete; the rest happened
                        out[y] += v
                live = True
            r = tuple(sorted(out.items()))
    elif aid.startswith('pick:') and A.get(aid, {}).get('year'):
        a = A[aid]
        conv = next((e for d2, i2, e in ev if e['kind'] == 'conveyed'), None)
        if conv and a.get('overall'):
            r = slot_seasons(a['year'], a['overall'], conv['date'])
            live = season_of(conv['date']) >= CUR
        elif not conv and a['year'] >= CUR:
            seasons, _, _ = pv(aid, TODAY)
            r = tuple(sorted(seasons.items()))
            live = True
        else:
            r = ()
    else:
        r = ()
    _R[key], _RLIVE[key] = r, live
    if live:
        mark_live()
    return r


def own_from(aid, d, team, games_after=None):
    """What an asset `team` holds at the start of day d went on to produce from then on, by season: the realized
    counterpart of pv(aid, d) (GM Value Added as it turned out values what a GM inherited and left this way). A player:
    his production from d (the rest of that season at `team` by the share of its games still to play, and at the
    teams that held him after, every later season in full) plus his projection for seasons not yet complete; draft
    rights still on the drafting chain: the slot; a pick: its slot's expectation once used, else the pick model."""
    ev = EV.get(aid, [])
    if aid.startswith('player:'):
        rw = rights_window(aid, d)
        if rw and not any(x[2]['to'] in NON_TEAM or x[2]['from'] in NON_TEAM for x in ev if rw[2] <= x[0] < d and x[2]['kind'] != 'drafted'):
            return slot_seasons(*rw)
        pid = vid_of(aid)
        y0 = season_of(d)
        end0 = f'{y0}-07-01'
        later = {e['to'] for dd, i, e in ev if d <= dd < end0 and e['to'] not in NON_TEAM and e['to'] != team}
        out = collections.Counter()
        for y in range(y0, NOW_SEASON + 1):
            v = VAL.get((pid, y))
            if v is None:
                continue
            if y == y0:
                sh = SHARE.get((pid, y), {})
                v = v * (sh.get(team, 0.0) * (1.0 if games_after is None else games_after) + sum(sh.get(t, 0.0) for t in later))
            out[y] += v
        if active(pid) or (pid != pid_of(aid) and active(pid_of(aid))):
            seasons, _, _ = pv(aid, TODAY)
            for y, v in seasons.items():
                if y >= NOW_SEASON:
                    out[y] += v
        return tuple(sorted(out.items()))
    if aid.startswith('pick:') and A.get(aid, {}).get('year'):
        a = A[aid]
        conv = next((e for dd, i, e in ev if e['kind'] == 'conveyed'), None)
        if conv and a.get('overall'):
            return slot_seasons(a['year'], a['overall'], conv['date'])
        if not conv and a['year'] >= CUR:
            seasons, _, _ = pv(aid, TODAY)
            return tuple(sorted(seasons.items()))
    return ()


def pos_of(aid, tx, kind, frm, to, d):
    return POS.get((aid, tx, kind, frm, to, d))


def stream_sum(parts):
    """[(sign, stream)] -> one stream."""
    out = collections.Counter()
    for sign, st in parts:
        for y, v in st:
            out[y] += sign * v
    return tuple(sorted((y, v) for y, v in out.items() if v))


def horizon(stream, y0):
    return sum(v * w(y, y0) for y, v in stream if y0 <= y < y0 + HORIZON)


STREAMS = {}          # decision id -> its stream, for conserve.py
KEPT = {}             # decision id -> the season stream behind a grade that is shown, not conserved (value kept by a
                      # re-signing or extension, a coach hire's or firing's wins at 31.7 points), for the titles split


def rv_total(aid, team, since, y0):
    return sum(v * w(y, y0) for y, v in rv(aid, team, since) if y0 <= y < y0 + HORIZON)


def career_total(pid, y0, proj_id=None):
    """Everything a player produced (any team) over the horizon, plus his projection for seasons not yet played."""
    tot = 0.0
    for y in range(y0, min(y0 + HORIZON, NOW_SEASON + 1)):
        tot += VAL.get((pid, y), 0.0) * w(y, y0)
    if y0 + HORIZON > NOW_SEASON:
        seasons, _ = pv_player_seasons(proj_id or pid, TODAY)
        tot += sum(v * w(y, y0) for y, v in seasons.items() if max(y0, NOW_SEASON) <= y < y0 + HORIZON)
    return tot


# ---------------------------------------------------------------- confidence and credit
def low_conf(tx, assets, date):
    why = []
    if tx in REP_TX:
        why.append('a repaired ledger event in this transaction')
    for a in assets:
        if any(lo <= date <= hi for lo, hi in REP_ASSET.get(a, [])):
            why.append(f'{a} was in an uncertain stretch of the ledger')
            break
    return why


def credit(team, date):
    seg = credit_on(C, team, date)
    if not seg:
        return {'people': [], 'note': 'nobody credited (no head of basketball operations named)'}
    if seg.get('vacancy'):
        return {'people': [], 'note': 'vacancy'}
    return {'people': [{'person': p['person'], 'tenure_id': p['tenure_id'], 'weight': p['weight']} for p in seg['people']],
            'split': seg.get('split'), 'date_unknown': seg.get('date_unknown'), 'flag': seg.get('flag')}


# ---------------------------------------------------------------- decisions
def sign_and_trades():
    """(date, player) pairs ESPN describes as signed and then traded (2000 on): the player was a free agent."""
    from ledger import pname
    out = []
    for r in json.load(open(os.path.join(OUT, 'espn_tx.json'))):
        m = re.search(r'[Ss]igned (?:and traded the contract of )?(?:[A-Z]{1,2}(?:-[A-Z])? )?([A-Z][\w\.\'\-]+(?: [A-Z][\w\.\'\-]+){1,3})(?: and traded him| to\b.*sign-and-trade)', r['text']) \
            or re.search(r'(?:[A-Z]{1,2} )([A-Z][\w\.\'\-]+(?: [A-Z][\w\.\'\-]+){1,3})[^.]{0,80}sign-and-trade', r['text'])
        if m:
            out.append((r['date'], pname(m.group(1))))
    return out


SNT = None


def is_sign_and_trade(date, assets):
    global SNT
    from ledger import pname
    if SNT is None:
        SNT = sign_and_trades()
    names = {pname(A.get(a, {}).get('name') or '') for a in assets if a.startswith('player:')}
    d0 = dt.date.fromisoformat(date)
    return any(n in names and abs((dt.date.fromisoformat(d) - d0).days) <= 3 for d, n in SNT)


def sales():
    """Players and picks sold for cash: decisions like any trade, which the transaction table does not list."""
    out = {}
    for tx, es in BYTX.items():
        if tx and tx not in TR and any(e['kind'] == 'sale' for e in es):
            e = next(e for e in es if e['kind'] == 'sale')
            nm = A.get(e['asset'], {}).get('name') or e['asset'].split(':', 1)[1]
            out[tx] = {'tx': tx, 'date': e['date'], 'agreed': e['date'], 'text': f"The {e['from']} sold {nm} to the {e['to']}.", 'source': e.get('source')}
    return out


def trades():
    out = []
    for tx, t in list(TR.items()) + list(sales().items()):
        moves = [e for e in BYTX.get(tx, []) if e['kind'] in ('trade', 'sale')]
        teams = {e['from'] for e in moves} | {e['to'] for e in moves}
        agreed = t.get('agreed') or t['date']
        y0 = season_of(agreed)
        for team in sorted(x for x in teams if x not in NON_TEAM):
            ins = [e['asset'] for e in moves if e['to'] == team]
            outs = [(e['asset'], e['to']) for e in moves if e['from'] == team]
            both = set(ins) & {a for a, _ in outs}          # a source's repeated listing moves an asset there and back: it nets out
            ins = [a for a in ins if a not in both]
            outs = [(a, r) for a, r in outs if a not in both]
            if not ins and not outs:
                continue
            snt = is_sign_and_trade(t['date'], ins + [a for a, _ in outs])
            sid = stable_id({'type': 'sign-and-trade' if snt else 'trade', 'team': team, 'agreed': agreed, 'in': ins, 'out': [a for a, _ in outs]})
            if sid in FROZ:
                at_time_of(sid, None)
                at_in = at_out = []
                early, at = False, None
            else:
                CARRIED['at the time computed'] += 1
                at_in = [pv_total(a, agreed, y0) for a in ins]
                at_out = [pv_total(a, agreed, y0) for a, _ in outs]
                early = any(x[1] for x in at_in + at_out)
                at = None if early else sum(x[0] for x in at_in) - sum(x[0] for x in at_out)
            def conserved(ins=ins, outs=outs, team=team, tx=tx):
                parts = [(1, R(e['asset'], pos_of(e['asset'], tx, e['kind'], e['from'], e['to'], e['date']))) for e in moves if e['to'] == team and e['asset'] in ins]
                parts += [(-1, R(e['asset'], pos_of(e['asset'], tx, e['kind'], e['from'], e['to'], e['date']))) for e in moves if e['from'] == team and e['asset'] in {a for a, _ in outs}]
                return stream_sum(parts)
            st = turned_out(sid, conserved)
            STREAMS.setdefault(sid, st)       # a decision listed twice: the first, as the duplicates rule keeps
            to = horizon(st, y0)
            lc = low_conf(tx, ins + [a for a, _ in outs], t['date'])
            if t['date'] < '2017-01-01' and any(a.startswith('pick:') and not (A.get(a, {}).get('notes')) and A.get(a, {}).get('year')
                                                and t['date'] < f"{A[a]['year']}-06-01" for a in ins + [a for a, _ in outs]):   # a future pick, terms not in our sources
                lc.append('a pick traded before 2017 with protections unknown')
            if any(a.startswith('swap:') and 'low confidence' in str(A.get(a, {}).get('basis')) for a in ins + [a for a, _ in outs]):
                lc.append('a swap whose outcome is computed, not stated')
            if snt:
                lc.append('pending the Contract tab: a sign-and-trade (ESPN), so the player was a free agent the team could not simply keep')
            out.append({'type': 'sign-and-trade' if snt else 'trade', 'team': team, 'date': t['date'], 'agreed': agreed, 'tx': tx, 'in': ins, 'out': [a for a, _ in outs],
                        'at_time': None if at is None else round(at, 1), 'turned_out': round(to, 1),
                        'at_time_note': 'not enough earlier data: the snapshot used a model that saw later seasons' if early else None,
                        'models': sorted({x[2] for x in at_in + at_out if x[2]}), 'low_confidence': lc, 'credit': credit(team, agreed), 'text': t['text'][:300]})
    return out


def rights_holder(aid, draft_day, drafter):
    """(who held his draft rights when the season began or when they were given up, whether he was already the
    drafting team's when it drafted him). The chain follows the rights: the drafting team, then any team they were
    traded to; it stops when they go to the pool (a team that signs him from there signed a free agent)."""
    ev = EV.get(aid, [])
    opener = season_opener_after(draft_day)
    holder, already, started = drafter, False, False
    for k, (d, i, e) in enumerate(ev):
        if e['kind'] == 'drafted' and d == draft_day:
            started = True
            already = k > 0 and ev[k - 1][2]['to'] == e['to']
            holder = e['to']
            continue
        if not started or d < draft_day:
            continue
        if d >= opener or e['to'] in NON_TEAM or e['from'] != holder:
            break
        holder = e['to']
    return holder, already


SLOT_LABEL = 'graded against the slot: no consensus board exists for this draft'


def drafts():
    from ledger import drafts as D_
    import consensus
    DD = D_()
    CG = consensus.Grader(sys.modules[__name__])
    out = []
    for y, d in DD.items():
        if y < 1980:
            continue
        board = CG.grade(y, DD)            # {overall: consensus grade} where two or more boards exist
        for rnd, ov, team, br, name in d['picks']:
            if not br or ov > 60:
                continue
            pid = nba_id(br, name)
            vid = VID.get(br) or pid
            cm, early = SN.cmodel(SN.origin(d['date']) or 1985)
            # the slot's expectation as of the draft (point in time), ten seasons, discounted
            slot_exp = sum(cm['by_season_after_draft'][k][ov - 1] * w(y + 1 + k, y + 1) for k in range(len(cm['by_season_after_draft'])))
            got = career_total(vid, y + 1, proj_id=pid)
            note = None
            aid = f'player:{br}'
            chose, already = rights_holder(aid, d['date'], team)
            drafted_by = team
            if chose != team:
                team = chose          # drafted for a trade partner: the choice was theirs, and so is the grade
            if y < 1990 or early:
                note = 'not enough earlier data: no pick curve fit on drafts before this one'
            car = collections.Counter({y_: VAL[(vid, y_)] for y_ in range(y + 1, NOW_SEASON + 1) if (vid, y_) in VAL})
            if y + 1 + HORIZON > NOW_SEASON:
                for y_, v_ in pv_player_seasons(pid, TODAY)[0].items():
                    if y_ >= NOW_SEASON:
                        car[y_] += v_
            # (a player already on the drafting team's books when it drafted him: nothing new arrives, so the draft adds
            # nothing to the conserved total; his value is the move's that first brought him)
            STREAMS[stable_id({'type': 'draft', 'team': team, 'agreed': d['date'], 'slot': ov})] = () if already else \
                stream_sum([(1, tuple(car.items())), (-1, slot_seasons(y, ov, d['date']))])
            row = {'type': 'draft', 'team': team, 'date': d['date'], 'agreed': d['date'], 'player': name, 'player_id': pid, 'player_br': br, 'slot': ov, 'round': rnd,
                   'slot_expected': round(slot_exp, 1), 'outcome': round(got, 1), 'turned_out_slot': round(got - slot_exp, 1),
                   'turned_out': round(got - slot_exp, 1), 'at_time': None, 'grade_basis': 'slot', 'grade_label': SLOT_LABEL,
                   'drafted_by': drafted_by if drafted_by != team else None,
                   'at_time_note': note or 'no consensus board for this draft, so no grade at the time',
                   'models': [cm['version']], 'low_confidence': [], 'credit': credit(team, d['date'])}
            cg = board.get(ov)
            if cg:
                # graded against the consensus board: the chosen player against the best still available. The conserved
                # stream above is unchanged (the slot split): this grade is a comparison, not value that moved.
                bpa = cg['best_available']
                row.update({'grade_basis': 'consensus', 'grade_label': f"graded against the consensus board ({len(consensus.BOARDS[str(y)]['sources'])} boards)",
                            'consensus_rank': cg['consensus_rank'], 'best_available_br': bpa, 'best_available': CG.name(bpa, y, DD),
                            'best_available_rank': cg['best_available_rank'], 'boards_split': cg['boards_split'], 'easy_pick': cg['easy'],
                            'turned_out': round(cg['turned_out'], 1), 'at_time': round(cg['at_time'], 1), 'at_time_note': cg['board_note'],
                            'chosen_outcome': round(cg['chosen_outcome'], 1), 'best_available_outcome': round(cg['bpa_outcome'], 1),
                            'ev_curve': cg['ev_curve']})
            out.append(row)
    return out


def roster_moves():
    """Signings, claims, waivers, releases, inferred lapses; re-signings and extensions from the transaction text."""
    out = []
    for aid, ev in EV.items():
        if not aid.startswith('player:'):
            continue
        for pos, (d, i, e) in enumerate(ev):
            k = e['kind']
            if k in ('sign', 'claim', 're-sign'):
                team, sign = e['to'], 1
            elif k in ('waive', 'release', 'lapsed (inferred)'):
                team, sign = e['from'], -1
            else:
                continue
            # who held him just before this move (his first recorded move out of a team: that team, from before 1979-80)
            before = ev[pos - 1][2]['to'] if pos else (e['from'] if e['from'] not in NON_TEAM else None)
            if team in NON_TEAM:
                continue
            y0 = season_of(d)
            typ = {'sign': 'signing', 'claim': 'waiver claim', 're-sign': 're-signing', 'waive': 'waiver', 'release': 'release', 'lapsed (inferred)': 'left in free agency'}[k]
            sid = stable_id({'type': typ, 'team': team, 'agreed': d, 'asset': aid})
            at, early, model = at_time_of(sid, lambda: pv_total(aid, d, y0))
            additive, retained = True, None
            if sign > 0 and before == team:
                # he was already this team's (its draft rights, a player it re-signs, a sign-and-trade's other half):
                # no value moves, so the move is credited nothing; the value is the decision's that brought him in.
                # A re-signing's value kept (what letting him walk would have cost) is shown, not added.
                st = ()
                if k == 're-sign':
                    kept = turned_out(sid, lambda: R(aid, pos))
                    additive, retained = False, horizon(kept, y0)
                    KEPT[sid] = kept
            elif sign > 0:
                st = turned_out(sid, lambda: R(aid, pos))
            else:
                st = turned_out(sid, lambda: stream_sum([(-1, R(aid, pos))])) if before == team else ()
            if additive:
                # a decision listed twice: the first copy's stream, the one the duplicates rule keeps and an incremental
                # night carries over (the last copy's, before Nov 25, 2026, so a full rebuild could disagree with it)
                STREAMS.setdefault(sid, st)
            to = retained if retained is not None else horizon(st, y0)
            lc = low_conf(e.get('tx'), [aid], d)
            if k == 'lapsed (inferred)':
                lc.append('the departure is inferred (no transaction; the Contract tab will date it)')
                lc.append('pending the Contract tab: whether the team could have kept him (a free agent may simply leave)')
            if k == 're-sign':
                lc.append('pending the Contract tab: value retained, not value over what he was paid')
            if sign > 0 and before == team and k != 're-sign':
                lc.append('already his team\'s: credited to the move that brought him (his draft, or the trade)')
            out.append({'type': typ, 'contract': e.get('contract'), 'rights': e.get('rights'), 'team': team, 'date': d, 'agreed': d, 'asset': aid, 'player': A.get(aid, {}).get('name'),
                        'additive': additive,
                        'at_time': None if early or at is None else round(sign * at, 1), 'turned_out': round(to, 1),
                        'at_time_note': 'not enough earlier data: the snapshot used a model that saw later seasons' if early else None,
                        'models': [model] if model else [], 'low_confidence': lc, 'credit': credit(team, d), 'source': e.get('source')})
    # re-signings and extensions: no asset moves, so they come from the transaction text
    from ledger import paragraphs, parse
    for p in paragraphs():
        r = parse(p)
        if r['kind'] not in ('resign', 'extend') or not r.get('players') or not r.get('to') or not r['date']:
            continue
        aid = f"player:{r['players'][0]['id']}"
        if r['kind'] == 'resign' and any(e['kind'] == 're-sign' and d == r['date'] for d, i, e in EV.get(aid, [])):
            continue
        y0 = season_of(r['date'])
        typ = 'extension' if r['kind'] == 'extend' else 're-signing'
        sid = stable_id({'type': typ, 'team': r['to'], 'agreed': r['date'], 'asset': aid})
        at, early, model = at_time_of(sid, lambda: pv_total(aid, r['date'], y0))
        ev = EV.get(aid, [])
        p_ = max((k for k, (d_, i_, e_) in enumerate(ev) if d_ <= r['date']), default=None)
        kept = turned_out(sid, lambda: R(aid, p_)) if p_ is not None else ()
        KEPT[sid] = kept
        to = horizon(kept, y0) if p_ is not None else 0.0   # value kept: shown, not added
        out.append({'type': typ, 'team': r['to'], 'date': r['date'], 'agreed': r['date'], 'asset': aid, 'additive': False,
                    'player': r['players'][0]['name'], 'at_time': None if early or at is None else round(at, 1), 'turned_out': round(to, 1),
                    'at_time_note': 'not enough earlier data' if early else None, 'models': [model] if model else [],
                    'low_confidence': ['pending the Contract tab: value retained, not value over what he was paid'],
                    'credit': credit(r['to'], r['date']), 'source': r['source']})
    return out


def coaches():
    import glob
    out = []
    for f in sorted(glob.glob(os.path.join(REPO, 'public', 'bcs', 'c', '*.json'))):   # sorted: directory order differs by machine and checkout, and it set the coach decisions' order (Nov 25, 2026)
        c = json.load(open(f))
        rate, games = {}, {}
        for s in c.get('seasons', []):
            wt = (s.get('exp') or {}).get('w_talent')          # wins above roster talent, per 82 games
            if wt is not None and s['season'] >= '2002-03':
                rate[(franchise(s['team']) or s['team'], s['season'])] = wt * (s.get('g') or 0) / 82    # the season's actual games
                games[(franchise(s['team']) or s['team'], s['season'])] = (s.get('g') or 0) / 82
        for st in c.get('stints', []):
            team = franchise(st['team']) or st['team']
            hire = st['first']
            if hire < '1979-07-01' or hire > TODAY:
                continue                                  # (an as-of build: Coaching Savant's files run to today)
            y0 = season_of(hire)
            prior = [(v, games[k]) for k, v in rate.items() if int(k[1][:4]) + 1 < y0]
            seasons_here = {int(s[:4]) + 1: v for (t, s), v in rate.items() if t == team and st['first_season'] <= s <= st['last_season']}
            if y0 < 2003:
                to, at, note = None, None, 'coach hires before 2002-03 are shown, not scored'
            else:
                to = sum(v * POINTS_PER_WIN * w(y, y0) for y, v in seasons_here.items() if y0 <= y < y0 + HORIZON)
                KEPT[stable_id({'type': 'coach hire', 'team': team, 'agreed': hire, 'coach_id': c['id']})] = tuple(sorted(
                    (y, v * POINTS_PER_WIN) for y, v in seasons_here.items() if y0 <= y < y0 + HORIZON))
                n = sum(g for v, g in prior)
                at = (sum(v for v, g in prior) / (n + 3)) * POINTS_PER_WIN * 3 if n else 0.0   # prior wins above talent per 82, shrunk by three seasons of zero, over three seasons
                note = None if n else 'first head-coaching job: neutral at the time'
            out.append({'type': 'coach hire', 'team': team, 'date': hire, 'agreed': hire, 'coach': c['name'], 'coach_id': c['id'],
                        'at_time': None if at is None else round(at, 1), 'turned_out': None if to is None else round(to, 1), 'at_time_note': note,
                        'models': ['coaching-savant w_talent'], 'low_confidence': [], 'credit': credit(team, hire),
                        'source': f"https://wcehoops.com/basketball-coaching-savant.html#{c['id']}"})
    return out


def coach_firings():
    """A firing ("Fired as Head Coach", "Reassigned from Head Coach role"), 2002-03 on: the fired coach's projected wins
    above talent (his games-weighted record before the firing, shrunk by three seasons of zero) against what the
    replacement actually delivered over the same games, at 31.7 points a win. At the time: the average replacement's
    rate (measured) against that projection, over three seasons."""
    import glob
    from tenures import team_by_name
    coaches = {}
    for f in sorted(glob.glob(os.path.join(REPO, 'public', 'bcs', 'c', '*.json'))):   # sorted: directory order differs by machine and checkout, and it set the coach decisions' order (Nov 25, 2026)
        c = json.load(open(f))
        seas = {}
        for s_ in c.get('seasons', []):
            wt = (s_.get('exp') or {}).get('w_talent')
            if wt is not None and s_['season'] >= '2002-03':
                seas[(franchise(s_['team']) or s_['team'], int(s_['season'][:4]) + 1)] = (wt * (s_.get('g') or 0) / 82, (s_.get('g') or 0) / 82)
        coaches[c['id']] = (c, seas)
    stints = [(franchise(st['team']) or st['team'], st['first'], st['last'], cid, st) for cid, (c, _) in coaches.items() for st in c.get('stints', [])]
    # the average replacement: a coach's first season at a team that had just fired someone
    firings = []
    for cid, (c, seas) in coaches.items():
        for d, t in c.get('transactions', []):
            m = re.match(r'(?:Fired as Head Coach by|Reassigned from Head Coach role by) (?:the )?(.+?)\.$', t)
            if m:
                firings.append((d, team_by_name(m.group(1), d), cid))
    rep_first = []
    for d, team, cid in firings:
        nxt = sorted([x for x in stints if x[0] == team and x[1] >= d and x[3] != cid], key=lambda x: x[1])
        if nxt:
            r_c, r_seas = coaches[nxt[0][3]]
            v = r_seas.get((team, season_of(nxt[0][1])))
            if v and v[1] > 0:
                rep_first.append(v[0] / v[1])
    avg_rep = float(np.mean(rep_first)) if rep_first else 0.0
    out = []
    for d, team, cid in firings:
        if d < '1979-07-01' or d > TODAY:
            continue                                    # outside the ledger's coverage, or after an as-of build's day
        c, seas = coaches[cid]
        y0 = season_of(d)
        nxt = sorted([x for x in stints if x[0] == team and x[1] >= d and x[3] != cid], key=lambda x: x[1])
        cr = credit(team, d) if team else {'people': [], 'note': 'team not matched'}
        if any(p['person'] == c['name'] for p in cr['people']):
            cr = {'people': [], 'note': "the fired coach was also the head of basketball operations: an owner's decision, credited to no GM"}
        rec = {'type': 'coach firing', 'team': team, 'date': d, 'agreed': d, 'coach': c['name'], 'coach_id': cid, 'models': ['coaching-savant w_talent'],
               'low_confidence': [], 'credit': cr,
               'source': f"https://wcehoops.com/basketball-coaching-savant.html#{cid}"}
        if y0 < 2003 or not team:
            out.append(dict(rec, at_time=None, turned_out=None, at_time_note='coach firings before 2002-03 are shown, not scored'))
            continue
        prior = [v for (t, y), v in seas.items() if y <= y0]
        n = sum(g for v, g in prior)
        proj82 = sum(v for v, g in prior) / (n + 3) if n else 0.0
        at = (avg_rep - proj82) * 3 * POINTS_PER_WIN
        to, repl = None, None
        if nxt:
            repl = coaches[nxt[0][3]][0]['name']
            r_seas = coaches[nxt[0][3]][1]
            st = nxt[0][4]
            to = 0.0
            for (t, y), (v, g) in r_seas.items():
                if t == team and st['first_season'] <= f'{y - 1}-{str(y)[2:]}' <= st['last_season'] and y0 <= y < y0 + HORIZON:
                    to += (v - proj82 * g) * POINTS_PER_WIN * w(y, y0)
                    KEPT[stable_id(rec)] = KEPT.get(stable_id(rec), ()) + ((y, (v - proj82 * g) * POINTS_PER_WIN),)
        out.append(dict(rec, replacement=repl, fired_projected_per82=round(proj82, 2), average_replacement_per82=round(avg_rep, 2),
                        at_time=round(at, 1), turned_out=None if to is None else round(to, 1), at_time_note=None if n else 'no earlier record: projected at zero'))
    return out


def leakage(sample=300, seed=11):
    """Recompute at-the-time trade grades with every season after each snapshot's origin deleted: they must match exactly."""
    D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
    rng = np.random.default_rng(seed)
    tr = [d for d in D if d['type'] == 'trade' and d['at_time'] is not None]
    pick = [tr[i] for i in rng.choice(len(tr), min(sample, len(tr)), replace=False)]
    full_by = SN.BY
    bad = 0
    for d in pick:
        T = SN.origin(d['agreed'])
        cut = {k: {y: r for y, r in v.items() if y <= (T or 0)} for k, v in full_by.items()}
        SN.BY = {k: v for k, v in cut.items() if v}
        pv.cache_clear()
        y0 = season_of(d['agreed'])
        val = sum(pv_total(a, d['agreed'], y0)[0] for a in d['in']) - sum(pv_total(a, d['agreed'], y0)[0] for a in d['out'])
        if abs(round(val, 1) - d['at_time']) > 1e-9:
            bad += 1
            print('   mismatch', d['tx'], d['team'], d['at_time'], round(val, 1))
    SN.BY = full_by
    pv.cache_clear()
    print(f'leakage test: {len(pick)} at-the-time trade grades recomputed with every later season deleted; mismatches: {bad}')
    return bad


FROZEN = os.path.join(OUT, 'frozen_at_time.json')
REGRADED = []          # (decision id, stored grade, new grade, batch) re-graded this run


def stable_id(d):
    """A decision's id from what it is, not from row numbers in a source: type, team, agreement date, what moved."""
    typ = {'left in free agency': 'let walk'}.get(d['type'], d['type'])     # renamed Nov 2026: the id keeps the old name
    key = '|'.join([typ, d['team'] or '', d['agreed'], ','.join(sorted(d.get('in') or [])), ','.join(sorted(d.get('out') or [])),
                    str(d.get('asset') or ''), str(d.get('coach_id') or ''), str(d.get('slot') or '')])
    import hashlib
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def freeze(D):
    """At-the-time grades are written once and never change (Module 8). With GM_FREEZE=1 (the production refresh), a
    decision already in out/frozen_at_time.json keeps its stored grade, note and model versions, whatever the models
    say now; a new decision is graded with today's models and stored. Without it (development), nothing is frozen.
    Returns how many stored grades the current models would have changed (reported, never applied)."""
    for d in D:
        d['decision_id'] = stable_id(d)
    if os.environ.get('GM_FREEZE') != '1':
        return 0
    F = json.load(open(FROZEN)) if os.path.exists(FROZEN) else {}
    drift = 0
    for d in D:
        f = F.get(d['decision_id'])
        b = regrade_due(d['decision_id']) if f else None
        if b:
            # re-graded once (at_time_regrade.json): the same point-in-time models on corrected inputs; a grade that changes
            # keeps its old value beside the new one
            REGRADED.append((d['decision_id'], f['at_time'], d['at_time'], b))
            if (d['at_time'], d.get('at_time_note')) != (f['at_time'], f['at_time_note']):
                F[d['decision_id']] = {'at_time': d['at_time'], 'at_time_note': d.get('at_time_note'), 'models': d.get('models'), 'on': TODAY,
                                       'regraded': f.get('regraded', []) + [b], 'was': f['at_time'], 'was_note': f['at_time_note'], 'was_on': f['on']}
            f = F[d['decision_id']]
            d['at_time'], d['at_time_note'], d['models'], d['frozen_on'] = f['at_time'], f['at_time_note'], f['models'], f['on']
        elif f:
            if f['at_time'] != d['at_time'] and d['decision_id'] not in FROZ:     # (an incremental night computes none of them)
                drift += 1
            d['at_time'], d['at_time_note'], d['models'], d['frozen_on'] = f['at_time'], f['at_time_note'], f['models'], f['on']
        else:
            F[d['decision_id']] = {'at_time': d['at_time'], 'at_time_note': d.get('at_time_note'), 'models': d.get('models'), 'on': TODAY}
            d['frozen_on'] = TODAY
    tmp = FROZEN + '.tmp'
    json.dump(F, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, FROZEN)
    if PENDING:
        ap = json.load(open(APPLIED)) if os.path.exists(APPLIED) else {}
        ap.setdefault('points', {}).update({b: TODAY for b in PENDING})
        json.dump(ap, open(APPLIED, 'w'), indent=1)
    return drift


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'leakage':
        sys.exit(1 if leakage() else 0)
    D = trades()
    print('trades', len(D), flush=True)
    D += drafts()
    print('drafts', flush=True)
    D += roster_moves()
    print('roster moves', flush=True)
    D += coaches()
    D += coach_firings()
    # the same decision listed twice (a source repeating a waiver, a re-signing in both the moves and the text):
    # counted once
    seen, dup = set(), 0
    for d in D:
        sid = stable_id(d)
        dup += sid in seen
        d['_drop'] = sid in seen
        seen.add(sid)
    D = [d for d in D if not d.pop('_drop')]
    print(f'duplicates dropped: {dup}')
    if os.environ.get('GM_ASOF'):
        late = [d for d in D if min(d['agreed'], d['date']) > TODAY]
        print(f'as of {TODAY}: {len(late)} decisions dated later (must be 0)')
        D = [d for d in D if min(d['agreed'], d['date']) <= TODAY]
    drift = freeze(D)
    if drift:
        print(f'frozen: {drift} stored at-the-time grades differ from what the current models say (kept as stored)')
    if REGRADED:
        moved = [r for r in REGRADED if r[1] != r[2]]
        print(f're-graded once (at_time_regrade.json): {len(REGRADED)} stored at-the-time grades, {len(moved)} changed')
        log = os.path.join(OUT, 'at_time_regraded.json')
        old = json.load(open(log)) if os.path.exists(log) else []
        json.dump(old + [{'id': i, 'batch': bt, 'was': a, 'now': b, 'on': TODAY} for i, a, b, bt in moved], open(log, 'w'), indent=0)
    tmp = os.path.join(OUT, 'gm_decisions.json.tmp')
    json.dump(D, open(tmp, 'w'))
    os.replace(tmp, os.path.join(OUT, 'gm_decisions.json'))     # never a half-written file
    ids = {d['decision_id'] for d in D}
    json.dump({k: v for k, v in STREAMS.items() if k in ids}, open(os.path.join(OUT, 'decision_streams.json.tmp'), 'w'))
    os.replace(os.path.join(OUT, 'decision_streams.json.tmp'), os.path.join(OUT, 'decision_streams.json'))
    json.dump({k: [[y, round(v, 3)] for y, v in sorted(st)] for k, st in KEPT.items() if k in ids}, open(os.path.join(OUT, 'decision_kept_streams.json.tmp'), 'w'))
    os.replace(os.path.join(OUT, 'decision_kept_streams.json.tmp'), os.path.join(OUT, 'decision_kept_streams.json'))
    if INCR:
        json.dump({'basis': BASIS, 'cur': CUR, 'settled': SETTLED}, open(STATE + '.tmp', 'w'))
        os.replace(STATE + '.tmp', STATE)
        print('incremental:', dict(CARRIED), '| basis', 'unchanged' if PREV else 'new (nothing carried over)')
    c = collections.Counter(d['type'] for d in D)
    print('decisions', len(D), dict(c))
    print('at the time dropped (not enough earlier data):', sum(1 for d in D if d['at_time'] is None and d['type'] != 'draft'),
          '| low confidence:', sum(1 for d in D if d['low_confidence']), '| nobody credited:', sum(1 for d in D if not d['credit']['people']))
