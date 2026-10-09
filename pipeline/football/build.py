"""Build public/football-savant-data.json.

Joins nflverse's season tables, PFR charting, Next Gen Stats, snap counts, the combine
and the play-by-play aggregates from pbp_agg.py into one file the page can hold in memory:

  {seasons:[...], generated, source, cfg-side stuff lives in the HTML,
   data: {"2025": {players: [ {id,name,team,pos,...,m:{key:val}, d:{denom:count}} ]}}}

Design notes worth keeping:
  * Percentiles are computed in the browser, not here, because the cohort and the baseline
    (this season vs all-time) are things the reader changes.
  * `m` holds only non-null values. `d` holds the denominators the metric table's
    stabilization thresholds are expressed in. Together they are what a bar needs.
  * Comps and weakness comps ARE precomputed, because they need the whole league at once.
"""
import csv, json, math, os, re, sys, datetime
from collections import defaultdict

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from metrics import (METRICS, POS_PANELS, POS_LABEL, GROUP_LABEL, HEADLINE, WEAK_DIMS,
                     QUALIFY, QUALIFY_FALLBACK, TIER_SINCE, DENOMS, DENOM_CORE)
from teams import TEAMS, ERA, CANON, canon
from seasons import seasons as season_list_from_env
import extras as E
import roles_agg
from play_callers import NAME_FIXES

RAW = os.environ.get('NFL_RAW', 'raw')
AGG = os.environ.get('NFL_AGG', 'agg')
OUT = os.environ.get('NFL_OUT', 'football-savant-data.json')
SEASONS = season_list_from_env()
REG_WEEKS = 18            # the regular season is 17 games over 18 weeks (2021 on)

MBY = {m['key']: m for m in METRICS}


# ---------------------------------------------------------------- position cohorts
POS_MAP = {
    'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'FB': 'RB',
    'WR': 'WR', 'TE': 'TE',
    'T': 'OL', 'OT': 'OL', 'G': 'OL', 'OG': 'OL', 'C': 'OL', 'OL': 'OL',
    'DT': 'DI', 'NT': 'DI', 'DI': 'DI',
    'DE': 'ED', 'ED': 'ED', 'EDGE': 'ED',
    'LB': 'LB', 'ILB': 'LB', 'MLB': 'LB', 'OLB': 'LB',
    'CB': 'CB', 'DB': 'CB',
    'S': 'S', 'SAF': 'S', 'FS': 'S', 'SS': 'S',
    'K': 'K', 'PK': 'K', 'P': 'P',
}


def cohort(season_pos, pff_pos, ngs_pos):
    """Resolve a positional cohort.

    The season table says DE for both a wide-9 edge and a 320-pound five-technique, and
    OLB for both a stand-up rusher and an off-ball linebacker. PFF's position field draws
    the edge/interior line properly, so it wins where it exists; the season's own position
    is the fallback so the 1999 seasons still resolve.
    """
    for p in (pff_pos, ngs_pos, season_pos):
        if isinstance(p, str) and p.strip():
            v = POS_MAP.get(p.strip().upper())
            if v:
                return v
    return None


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


def safe(a, b, scale=1.0):
    a, b = num(a), num(b)
    if a is None or b in (None, 0):
        return None
    return a / b * scale


def sstr(x):
    """pandas hands back float('nan') for a missing string cell; that is not JSON."""
    if x is None:
        return None
    if isinstance(x, float) and not math.isfinite(x):
        return None
    s = str(x).strip()
    return s or None


def clean(o):
    """Strip anything json.dump would emit as NaN/Infinity — those are not valid JSON and
    a browser's JSON.parse rejects the whole file over one of them."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    return o


def rnd(v, p=4):
    if v is None:
        return None
    v = float(v)
    if not math.isfinite(v):
        return None
    return round(v, p)


# ---------------------------------------------------------------- source loading
def load_players():
    pl = pd.read_csv(os.path.join(RAW, 'players.csv'), low_memory=False)
    pl = pl[pl.gsis_id.notna()]
    bio, by_pfr, by_espn = {}, {}, {}
    for r in pl.itertuples(index=False):
        gid = r.gsis_id
        bio[gid] = dict(
            name=r.display_name, pfr=r.pfr_id if isinstance(r.pfr_id, str) else None,
            espn=str(int(r.espn_id)) if num(r.espn_id) else None,
            birth=r.birth_date if isinstance(r.birth_date, str) else None,
            college=r.college_name if isinstance(r.college_name, str) else None,
            head=r.headshot if isinstance(r.headshot, str) else None,
            jersey=int(r.jersey_number) if num(r.jersey_number) else None,
            rookie=int(r.rookie_season) if num(r.rookie_season) else None,
            last=int(r.last_season) if num(r.last_season) else None,
            dyear=int(r.draft_year) if num(r.draft_year) else None,
            dround=int(r.draft_round) if num(r.draft_round) else None,
            dpick=int(r.draft_pick) if num(r.draft_pick) else None,
            dteam=r.draft_team if isinstance(r.draft_team, str) else None,
            pos=r.position if isinstance(r.position, str) else None,
            pff_pos=r.pff_position if isinstance(r.pff_position, str) else None,
            ngs_pos=r.ngs_position if isinstance(r.ngs_position, str) else None,
            ht=num(r.height), wt=num(r.weight),
        )
        if bio[gid]['pfr']:
            by_pfr[bio[gid]['pfr']] = gid
        if bio[gid]['espn']:
            by_espn[bio[gid]['espn']] = gid
    return bio, by_pfr, by_espn


# ---- the same lookup, season by season
# Snap counts and PFR's charting name a player by his Pro Football Reference id, and the
# rest of the site by his NFL one. players.csv is the bridge, and it has two kinds of hole:
#
#   - It lags. A man can be four games into a season before his PFR id is filled in, so
#     his snaps and charting go nowhere. (Alec Anderson started at center for Buffalo.)
#   - PFR ids look alike. "WoodPe00" in the 2026 snap counts is Peter Woods, a rookie
#     defensive tackle in Kansas City; in players.csv it belongs to Pete Woods, a
#     quarterback whose last season was 1980. While only players with a stat line had a
#     card that sent the rookie's snaps into the void. Now that everyone with a snap has
#     one, it would print a card for a quarterback who retired 46 years ago.
#
# So the lookup is made per season. A match is kept only if that man's career covers the
# season; where it does not, or where there is no match at all, the snap file's own name
# is tried against players active that season, and used only when it points at one man
# who is not already somebody else in the same file.
_FAMILY = {}
for _fam, _codes in (('OL', 'T G C OT OG OL LT RT LG RG'), ('DL', 'DT DE DL NT'),
                     ('LB', 'LB OLB ILB MLB'), ('DB', 'CB S DB FS SS SAF'), ('RB', 'RB FB HB')):
    for _c in _codes.split():
        _FAMILY[_c] = _fam
_SUFFIX = re.compile(r'\s(jr|sr|ii|iii|iv|v)$')
_PFR_SEASON = {}


def _name_key(s):
    s = re.sub(r"[.'’`]", '', str(s).lower())
    return _SUFFIX.sub('', re.sub(r'[^a-z0-9]+', ' ', s).strip())


def _covers(b, y):
    """Could this man have played in season y? Loose on purpose: it is there to catch a
    career that ended decades earlier, not to argue about a practice-squad year."""
    return not ((b.get('rookie') and y < b['rookie'] - 1) or (b.get('last') and y > b['last'] + 2))


def pfr_for(y, by_pfr, bio):
    """The PFR-id -> NFL-id lookup as it holds in season y (see above)."""
    if y in _PFR_SEASON:
        return _PFR_SEASON[y]
    out = by_pfr
    p = os.path.join(RAW, 'snaps_%d.csv' % y)
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        df = pd.read_csv(p, low_memory=False, usecols=['pfr_player_id', 'player', 'position'])
        df = df[df.pfr_player_id.notna()].drop_duplicates('pfr_player_id')
        good, doubt = set(), []
        for r in df.itertuples(index=False):
            gid = by_pfr.get(r.pfr_player_id)
            if gid and _covers(bio[gid], y):
                good.add(gid)
            else:
                doubt.append(r)
        if doubt:
            names = defaultdict(list)
            for gid, b in bio.items():
                if gid.startswith('00-') and gid not in good and _covers(b, y):
                    names[_name_key(b['name'])].append(gid)
            out = dict(by_pfr)
            for r in doubt:
                c = names.get(_name_key(r.player), [])
                if len(c) > 1:
                    fam = _FAMILY.get(r.position, r.position)
                    same = [g for g in c if _FAMILY.get(bio[g].get('pos'), bio[g].get('pos')) == fam]
                    c = same if len(same) == 1 else c
                if len(c) == 1:
                    out[r.pfr_player_id] = c[0]
                    names[_name_key(r.player)] = []          # one file, one man
                    print(y, 'id by name: %s %s (%s) -> %s' % (r.pfr_player_id, r.player, r.position, c[0]), flush=True)
                elif by_pfr.get(r.pfr_player_id):
                    print(y, 'id dropped: %s %s (%s) is not %s' % (r.pfr_player_id, r.player, r.position,
                                                                 bio[by_pfr[r.pfr_player_id]]['name']), flush=True)
                    del out[r.pfr_player_id]
    _PFR_SEASON[y] = out
    return out


# Sample sizes that are estimates in a season the lineup file has not been published for.
EST_DENS = ('pblk', 'rblk', 'opsnap', 'dpsnap', 'drsnap', 'gaprun')

# What snap counts call a lineman, for the ones no depth chart has placed yet.
SNAP_LINE = {'T': 'OT', 'OT': 'OT', 'G': 'OG', 'OG': 'OG', 'C': 'OC'}


def secondary_spot(pos, S, gid):
    """Corner or safety, this season.

    The cohort lookup reads a defensive back's position off the player file, which holds one
    value for a whole career: the latest. Jalen Ramsey finished up at safety, so every one
    of his seasons at corner was ranked among safeties, 2017 included; a nickel back the
    file calls a safety could not be the All-Savant slot corner. A season's own sources
    say where he played that year: the club's depth chart (2001 on: the side of the
    secondary it listed him on most), then the position the snap counts list him at (2012
    on). The snap counts come second because they lag a move: they still had Kareem Jackson
    at corner in 2019, his first year at safety in Denver. A man neither places goes by the
    depth chart of his nearest season within three years, which is what sorts out 1999 and
    2000: the season table calls half the secondary plain "DB", and POS_MAP files a DB at
    corner. Only a man none of these place keeps the career value."""
    if pos not in ('CB', 'S') or S is None:
        return pos
    role = (S.roles.get(gid) or [None])[0]
    if role in ('LCB', 'RCB', 'NB'):
        return 'CB'
    if role in ('FS', 'SS'):
        return 'S'
    listed = S.db_spot.get(gid)
    if listed:
        return listed
    sp = S.snap_pos.get(gid)
    if sp == 'CB':
        return 'CB'
    if sp in ('S', 'FS', 'SS', 'SAF'):
        return 'S'
    return roles_agg.nearest_secondary_spot(S.y, gid, S.raw) or pos


def line_spot(line_a, S, gid):
    """Tackle, guard or centre. The depth charts say, where they list him; a rookie they
    have not caught up with (Detroit's first-round tackle played every snap of September
    2026 filed as plain "OL", ranked against nobody, every bar on his card blank) goes by
    what the snap counts call him; only a man neither source places keeps the old
    undivided cohort."""
    return line_a.get(gid) or SNAP_LINE.get(S.snap_pos.get(gid) if S else None) or 'OL'


def parse_ht(s):
    if not isinstance(s, str) or '-' not in s:
        return None
    a, b = s.split('-')[:2]
    try:
        return int(a) * 12 + int(b)
    except ValueError:
        return None


def load_combine(by_pfr):
    cb = pd.read_csv(os.path.join(RAW, 'combine.csv'), low_memory=False)
    out = {}
    for r in cb.itertuples(index=False):
        gid = by_pfr.get(r.pfr_id) if isinstance(r.pfr_id, str) else None
        if not gid:
            continue
        rec = dict(ht=parse_ht(r.ht), wt=num(r.wt), forty=num(r.forty), bench=num(r.bench),
                   vert=num(r.vertical), broad=num(r.broad_jump), cone=num(r.cone),
                   shuttle=num(r.shuttle))
        if rec['wt'] and rec['forty']:
            rec['spdscore'] = rec['wt'] * 200.0 / (rec['forty'] ** 4)
        out[gid] = {k: v for k, v in rec.items() if v is not None}
    return out


def load_ngs():
    """Season-level Next Gen Stats. week == 0 is the season row."""
    out = defaultdict(dict)
    for kind in ('passing', 'rushing', 'receiving'):
        p = os.path.join(RAW, 'ngs_%s.csv' % kind)
        if not os.path.exists(p):
            continue
        df = pd.read_csv(p, low_memory=False)
        df = df[(df.week == 0) & (df.season_type == 'REG')]
        for r in df.to_dict('records'):
            gid = r.get('player_gsis_id')
            if not isinstance(gid, str):
                continue
            out[(gid, int(r['season']))].update({kind[:3] + '_' + k: v for k, v in r.items()})
    return out


_WEEK_TEAMS = {}


def _week_teams(y):
    """{player: the teams he has a weekly stat line for} in one regular season."""
    if y not in _WEEK_TEAMS:
        out = defaultdict(set)
        p = os.path.join(RAW, 'wk_%d.csv' % y)
        if os.path.exists(p):
            with open(p, newline='', encoding='utf-8', errors='replace') as f:
                for r in csv.DictReader(f):
                    if (r.get('season_type') or 'REG') == 'REG' and r.get('player_id') and r.get('team'):
                        out[r['player_id'].strip()].add(canon(sstr(r.get('team'))))
        _WEEK_TEAMS[y] = out
    return _WEEK_TEAMS[y]


def _pfr_family(pos):
    """The position family of PFR's label: "LCB/RCB" and "DB" are both DB, "LOLB" is LB."""
    for tok in re.split(r'[/-]', str(pos or '').upper()):
        tok = tok.strip()
        for t in (tok, tok[1:] if tok[:1] in 'LR' and len(tok) > 2 else None):
            if t and _FAMILY.get(t):
                return _FAMILY[t]
    return None


def _shared_names(df, tc, bio):
    """{row number: player or None} for the charting rows whose id cannot be trusted.

    Where two men share a name the all-seasons charting files lose track of which is
    which. From 2024 they leave the id blank on both (Byron Murphy the Minnesota corner and
    Byron Murphy the Seattle tackle; the two Byron Youngs; the two Jaylon Joneses), and
    before that they print every row twice, once under each id (the two David Longs from
    2019 to 2021, the two Michael Carters in 2023). A blank id was dropped, so the corner
    had no coverage numbers at all in a season he was thrown at 119 times; a doubled row
    gave both men whichever line came last in the file. Each such row goes to the one
    namesake who played for that team that season, or failing that the one whose position
    it could be. A row that still fits two men, or none, is left out."""
    cols = [c for c in df.columns if c != 'pfr_id']
    key = df.player.map(_name_key)
    blank = df.pfr_id.isna()
    twice = df.duplicated(cols, keep=False) & ~df.duplicated(cols + ['pfr_id'], keep=False)
    # (only for the seasons this run builds: the refresh has two seasons of weekly tables)
    doubt = {(y, k) for y, k in zip(df.season[blank | twice], key[blank | twice]) if int(y) in SEASONS}
    if not doubt:
        return {}
    names = defaultdict(list)
    for gid, b in bio.items():
        if gid.startswith('00-'):
            names[_name_key(b['name'])].append(gid)
    out = {}
    for i, (y, k, tm, pos) in enumerate(zip(df.season, key, df[tc].astype(str), df.get('pos', key))):
        if (y, k) not in doubt:
            continue
        y = int(y)
        cands = [g for g in names.get(k, []) if _covers(bio[g], y)]
        teams = _week_teams(y)
        if re.match(r'^\dTM$', tm):
            pool = [g for g in cands if len(teams.get(g, ())) > 1] or cands
        else:
            pool = [g for g in cands if canon(tm) in teams.get(g, ())] or cands
        if len(pool) > 1:
            fam = _pfr_family(pos)
            same = [g for g in pool if _FAMILY.get(bio[g].get('pos'), bio[g].get('pos')) == fam]
            pool = same if len(same) == 1 else pool
        out[i] = pool[0] if len(pool) == 1 else None
        if out[i] is None:
            print(y, 'charting row left out, fits %d men: %s (%s, %s)' % (len(pool), df.player.iloc[i], tm, pos), flush=True)
    return out


def load_pfr(by_pfr, bio):
    out = defaultdict(dict)
    for kind in ('pass', 'rush', 'rec', 'def'):
        p = os.path.join(RAW, 'adv_%s.csv' % kind)
        df = pd.read_csv(p, low_memory=False)
        # A man traded in season has three rows in the newer files: one per club and a
        # "2TM" line that is the season. Read in file order the last club's partial line
        # won, and was then divided by the whole season's games and snaps: Sauce Gardner's
        # 2025 came out as 17 targets allowed, not 45. The total is the only one kept.
        tc = 'tm' if 'tm' in df.columns else 'team'
        total = df[tc].astype(str).str.match(r'^\dTM$')
        records = df.to_dict('records')
        named = _shared_names(df, tc, bio)
        gids = []
        for i, r in enumerate(records):
            pid = r.get('pfr_id')
            if i in named:
                gids.append(named[i])
            else:
                gids.append(pfr_for(int(r['season']), by_pfr, bio).get(pid) if isinstance(pid, str) else None)
        has_total = {(g, r['season']) for g, r, t in zip(gids, records, total) if t and g}
        for r, is_total, gid in zip(records, total, gids):
            if not gid:
                continue
            if not is_total and (gid, r['season']) in has_total:
                continue
            out[(gid, int(r['season']))].update({kind + '_' + k: v for k, v in r.items()})
    # A season still being played is summed up from PFR's weekly files instead, into rows
    # of exactly the same shape (pfr_week.py).
    #
    # This used to be "a season the all-seasons files don't have yet". That stopped being
    # the same thing in 2026: nflverse now writes the season in progress into three of the
    # four all-seasons files (not the passing one), and refreshes them about a week behind
    # the weekly files. On 8 October 2026 they held three games for a man who had played
    # four, so every charted defensive rate on the site was three games of targets and
    # pressures divided by four games played. The weekly files are the fresher source and
    # the only one that has the quarterbacks, so while a season is live they are the
    # source, whatever the all-seasons files happen to hold.
    have = {y for (_, y) in out}
    import pfr_week
    for y in SEASONS:
        wk = weeks_played(y)
        live = wk is not None and wk < (REG_WEEKS if y >= 2021 else 17)
        if y in have and not live:
            # The all-seasons files leave a few men out of a finished season (Justin Houston
            # and Bruce Irvin in 2023, Xavier Rhodes in 2022). The weekly files have them,
            # and without a row their pressure rate was printed as zero.
            added = 0
            for k, v in pfr_week.season_rows(y, pfr_for(y, by_pfr, bio), RAW).items():
                if k not in out:
                    out[k].update(v)
                    added += 1
            if added:
                print(y, 'PFR charting from the weekly files for %d men the season file leaves out' % added, flush=True)
            continue
        rows = pfr_week.season_rows(y, pfr_for(y, by_pfr, bio), RAW)
        if rows:
            print(y, 'PFR charting from the weekly files:', len(rows), 'players', flush=True)
            for k in [k for k in out if k[1] == y]:
                del out[k]
        for k, v in rows.items():
            out[k].update(v)
    return out


def load_snaps(by_pfr, bio):
    """Season snap totals plus snap share, from weekly snap counts (2013+)."""
    out = {}
    for y in range(2013, max(SEASONS) + 1):
        p = os.path.join(RAW, 'snaps_%d.csv' % y)
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            continue
        df = pd.read_csv(p, low_memory=False)
        df = df[df.game_type == 'REG'] if 'game_type' in df.columns else df
        # team snaps for a game = the largest single-player count on that side
        off_team = df.groupby(['game_id', 'team']).offense_snaps.max()
        def_team = df.groupby(['game_id', 'team']).defense_snaps.max()
        df['off_team'] = df.set_index(['game_id', 'team']).index.map(off_team)
        df['def_team'] = df.set_index(['game_id', 'team']).index.map(def_team)
        g = df.groupby('pfr_player_id').agg(
            off=('offense_snaps', 'sum'), dfn=('defense_snaps', 'sum'),
            st=('st_snaps', 'sum'), gp=('game_id', 'nunique'),
            offt=('off_team', 'sum'), deft=('def_team', 'sum')).reset_index()
        ids = pfr_for(y, by_pfr, bio)
        for r in g.itertuples(index=False):
            gid = ids.get(r.pfr_player_id)
            if not gid:
                continue
            out[(gid, y)] = dict(off=float(r.off or 0), dfn=float(r.dfn or 0),
                                 st=float(r.st or 0), gp=int(r.gp or 0),
                                 offt=float(r.offt or 0), deft=float(r.deft or 0))
    return out


def load_qbr(by_espn):
    p = os.path.join(RAW, 'qbr.csv')
    df = pd.read_csv(p, low_memory=False)
    df = df[df.season_type == 'Regular']
    out = {}
    for r in df.itertuples(index=False):
        gid = by_espn.get(str(int(r.player_id))) if num(r.player_id) else None
        if gid:
            out[(gid, int(r.season))] = num(r.qbr_total)
    return out


def load_records():
    """Team win-loss records and how each season ended, from the schedule.

    The schedule carries every game 1999 on with scores, the round (REG / WC / DIV / CON /
    SB) and both head coaches, so a season's record and its playoff fate fall straight out
    of it. A player card is much easier to read when you know whether he did this on a
    12-win team or a 3-win one.
    """
    p = os.path.join(RAW, 'schedules.csv')
    if not os.path.exists(p):
        return {}
    g = pd.read_csv(p, low_memory=False)
    g = g[g.home_score.notna() & g.away_score.notna()]
    rec = defaultdict(lambda: dict(w=0, l=0, t=0, pf=0, po=None, coach=None))
    ROUND = {'WC': 'Lost wild card', 'DIV': 'Lost divisional',
             'CON': 'Lost conference championship', 'SB': 'Lost Super Bowl'}
    for r in g.itertuples(index=False):
        yr = int(r.season)
        for team, own, opp, coach in ((r.home_team, r.home_score, r.away_score, r.home_coach),
                                      (r.away_team, r.away_score, r.home_score, r.away_coach)):
            # the schedule says OAK where the stat table says LV (teams.CANON): matched as
            # written, no Raider, Charger or Ram before the moves had a record or a coach
            k = (canon(team), yr)
            e = rec[k]
            if isinstance(coach, str):
                # the schedule misspells two coaches; Coaching Savant already corrects them,
                # and a card's link to his coach breaks if this side does not
                e['coach'] = NAME_FIXES.get(coach, coach)
            if r.game_type == 'REG':
                if own > opp:
                    e['w'] += 1
                elif own < opp:
                    e['l'] += 1
                else:
                    e['t'] += 1
                e['pf'] += float(own)
            else:
                # the last postseason game a team played is how its season ended
                e['po'] = 'Won Super Bowl' if (r.game_type == 'SB' and own > opp) else ROUND.get(r.game_type)
    return dict(rec)


# Season leaderboards worth a badge. Counting stats, because "led the league in receptions"
# is a claim about totals, not rates — and it is the kind of accolade a fan already knows.
ACCOLADE_STATS = [
    ('passing_yards', 'passing yards'), ('passing_tds', 'passing TDs'),
    ('completions', 'completions'), ('attempts', 'pass attempts'),
    ('rushing_yards', 'rushing yards'), ('rushing_tds', 'rushing TDs'),
    ('carries', 'carries'),
    ('receptions', 'receptions'), ('receiving_yards', 'receiving yards'),
    ('receiving_tds', 'receiving TDs'), ('targets', 'targets'),
    ('def_sacks', 'sacks'), ('def_tackles_solo', 'solo tackles'),
    ('def_tackles_for_loss', 'tackles for loss'), ('def_interceptions', 'interceptions'),
    ('def_pass_defended', 'passes defended'), ('def_fumbles_forced', 'forced fumbles'),
    ('def_qb_hits', 'QB hits'),
    ('fg_made', 'field goals'), ('pt_inside_20', 'punts inside the 20'),
    ('fantasy_points_ppr', 'fantasy points'),
]


def season_accolades(df):
    """Top-10 league finishes for one season, keyed by player id.

    Ranked across the whole league rather than inside a position, because that is what the
    phrase means: leading the league in receptions is a fact about everybody.
    """
    out = defaultdict(list)
    blank = _untracked_cols(df.to_dict('records'))
    for col, label in ACCOLADE_STATS:
        if col not in df.columns or col in blank:
            continue
        vals = pd.to_numeric(df[col], errors='coerce').fillna(0)
        if vals.max() <= 0:
            continue
        order = vals.sort_values(ascending=False)
        rank, prev, shown = 0, None, 0
        for idx, v in order.items():
            if v <= 0:
                break
            shown += 1
            if v != prev:
                rank = shown
                prev = v
            if rank > 10:
                break
            out[df.at[idx, 'player_id']].append(dict(r=rank, s=label))
    return out


def weeks_played(y):
    """The last regular-season week with a stat line in the weekly table, or None if the
    weekly file isn't there. This is how the build knows a season is still in progress."""
    p = os.path.join(RAW, 'wk_%d.csv' % y)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return None
    df = pd.read_csv(p, usecols=['week', 'season_type'], low_memory=False)
    df = df[df.season_type == 'REG']
    if df.empty:
        return None
    return int(pd.to_numeric(df.week, errors='coerce').max())


def season_progress(y, records):
    """(weeks played, games each team has played, share of the season complete).

    A qualifying line is a claim about a full season — 150 dropbacks is a starter's
    September and October. In week 2 nobody has 150 of anything, so an in-progress season
    would have an empty percentile pool and a blank front page. The line therefore scales
    with how much of the season his *team* has played, so a starter is a starter from the
    first Sunday and the pool fills the same way the leaderboards do.

    Team games come from the schedule where it has scores; the weekly table's last week is
    the fallback (right until byes start, one high for teams that have had theirs).

    Two different weeks come out of this. `wk` is the last week anybody has played, which
    is what decides whether the season is still in progress. `done` is the week most
    teams have finished, which is what the page should say out loud: on the Friday of
    week 2, one Thursday game does not put thirty-one other teams through two.
    """
    wk = weeks_played(y)
    full = 17 if y >= 2021 else 16
    if wk is None or wk >= (REG_WEEKS if y >= 2021 else 17):
        return None, {}, 1.0, None
    team_games = {}
    for (team, yr), tr in records.items():
        if yr == y:
            team_games[team] = tr['w'] + tr['l'] + tr['t']
    frac = min(1.0, (max(team_games.values()) if team_games else wk) / float(full))
    done = wk
    if team_games:
        counts = sorted(team_games.values())
        done = int(counts[len(counts) // 2])          # the median team's games played
    return wk, team_games, frac, done


def load_onfield(y):
    """Per-player on-field counters plus the team totals they are differenced against."""
    p = os.path.join(AGG, 'onfield_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}
    j = json.load(open(p))
    per = defaultdict(list)
    for r in j['players']:
        per[r['pid']].append(r)
    return per, j['teams']


def load_starts(y, by_pfr):
    """Games started and positions played, from weekly snap counts (2013+).

    Open data has no start column. A game in which he took at least half his unit's
    offensive snaps is the closest honest proxy, and it is also what separates a starter
    from a swing lineman in the percentile pool.
    """
    p = os.path.join(RAW, 'snaps_%d.csv' % y)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return {}
    df = pd.read_csv(p, low_memory=False)
    if 'game_type' in df.columns:
        df = df[df.game_type == 'REG']
    df = df[df.offense_snaps.notna()]
    out = {}
    for pid, grp in df.groupby('pfr_player_id'):
        gid = by_pfr.get(pid)
        if not gid:
            continue
        starts = int((pd.to_numeric(grp.offense_pct, errors='coerce') >= 0.5).sum())
        snaps = pd.to_numeric(grp.offense_snaps, errors='coerce').fillna(0)
        tot = float(snaps.sum())
        played = int(((snaps > 0) | (pd.to_numeric(grp.defense_snaps, errors='coerce').fillna(0) > 0)
                      | (pd.to_numeric(grp.st_snaps, errors='coerce').fillna(0) > 0)).sum())
        # a position counts as "played" only past a real share of his snaps, so one
        # emergency series at guard doesn't make a tackle look versatile
        byp = grp.assign(s=snaps).groupby('position').s.sum()
        nvers = int((byp >= max(30.0, 0.15 * tot)).sum()) if tot else 0
        out[gid] = dict(starts=starts, vers=nvers, games=played)
    return out


def load_pbp(y):
    p = os.path.join(AGG, 'pbp_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}, {}, {}
    j = json.load(open(p))
    def roll(rows):
        acc = defaultdict(lambda: defaultdict(float))
        for r in rows:
            pid = r['pid']
            for k, v in r.items():
                if k in ('pid', 'week'):
                    continue
                acc[pid][k] += float(v or 0)
        return acc
    return roll(j['qb']), roll(j['rush']), roll(j['rec']), roll(j.get('pen', []))


def load_ftn(y):
    """FTN charting aggregates from ftn_agg.py, rolled from weekly to season.

    Absent before 2022, and absent for a season nflverse has not charted yet, in which
    case every metric built from it simply is not set."""
    p = os.path.join(AGG, 'ftn_%d.json' % y)
    if not os.path.exists(p):
        return {}, {}, {}
    j = json.load(open(p))
    def roll(rows):
        acc = defaultdict(lambda: defaultdict(float))
        for r in rows:
            pid = r['pid']
            for k, v in r.items():
                if k in ('pid', 'week'):
                    continue
                acc[pid][k] += float(v or 0)
        return acc
    return roll(j.get('qb', [])), roll(j.get('rush', [])), roll(j.get('rec', []))


def load_line(y):
    """Which spot on the offensive line each man played, from line_agg.py. 2001 on."""
    p = os.path.join(AGG, 'line_%d.json' % y)
    return json.load(open(p)) if os.path.exists(p) else {}


_SWAPS = {}


def team_swaps(y):
    """{(gid, week): team} for the rows where the weekly stat table has a man's team and
    his opponent the wrong way round.

    It happens in exactly one place: Jacksonville's home games of 2001 and 2002, where
    every Jaguar is filed under the visiting club. (The old play-by-play wrote JAC, the
    schedule JAX, and the join that sorts players into teams lost them.) Left alone,
    Fred Taylor's 2002 reads IND -> JAX -> NYJ -> PHI -> JAX -> HOU, Mark Brunell finishes
    the year a Titan with Jeff Fisher for a coach, and the Texans' 2002 page lists 28
    Jaguars. A row is turned round only for a man whose every game has JAX on one side
    of it and who is, somewhere that season, either listed as a Jaguar or listed under
    two different "teams" on the days he faced them: an opponent who met them twice is
    always the same club, a Jaguar never is.
    """
    if y in _SWAPS:
        return _SWAPS[y]
    out = {}
    p = os.path.join(RAW, 'wk_%d.csv' % y)
    if y in (2001, 2002) and os.path.exists(p):
        rows = defaultdict(list)
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                if (r.get('season_type') or 'REG') != 'REG':
                    continue
                gid = (r.get('player_id') or '').strip()
                if gid:
                    rows[gid].append((int(num(r.get('week'), 0) or 0),
                                      canon(sstr(r.get('team'))), canon(sstr(r.get('opponent_team')))))
        T = 'JAX'
        for gid, rs in rows.items():
            if not all(t == T or o == T for _, t, o in rs):
                continue
            wrong = [(w, t) for w, t, o in rs if o == T and t != T]
            if not wrong:
                continue
            if any(t == T for _, t, _ in rs) or len({t for _, t in wrong}) >= 2:
                for w, _ in wrong:
                    out[(gid, w)] = T
    _SWAPS[y] = out
    return out


def load_weekteams(y, by_pfr):
    """Every team a player actually appeared for that season, in week order.

    The season table records one team - his last - so a man traded in October used to read
    as though he had spent the year where he finished it, and vanish from the club he left.
    His numbers really are the season's, and splitting six games off into their own row
    would make a percentile out of nothing, so the season stays whole and simply names
    both teams.

    "Appeared for" is the test, and it is deliberately narrower than the roster: the weekly
    roster file counts practice squads and waiver claims, which turns a journeyman into
    NYJ -> NYG -> PHI -> NYG without his ever having played a down for three of them. A
    weekly stat line settles it for anyone who touches the ball or makes a tackle, and
    weekly snap counts settle it for the linemen who do neither - which matters more now
    that a lineman is ranked against the others who play his spot.
    """
    weeks = defaultdict(list)
    swaps = team_swaps(y)
    p = os.path.join(RAW, 'wk_%d.csv' % y)
    if os.path.exists(p):
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                if (r.get('season_type') or 'REG') != 'REG':
                    continue
                gid, team = (r.get('player_id') or '').strip(), canon(sstr(r.get('team')))
                wk_n = num(r.get('week'), 0) or 0
                team = swaps.get((gid, int(wk_n)), team)
                if gid and team:
                    weeks[gid].append((wk_n, team))
    p = os.path.join(RAW, 'snaps_%d.csv' % y)
    if os.path.exists(p):
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            for r in csv.DictReader(f):
                if (r.get('game_type') or 'REG') != 'REG':
                    continue
                gid = by_pfr.get((r.get('pfr_player_id') or '').strip())
                team = canon(sstr(r.get('team')))
                if gid and team:
                    weeks[gid].append((num(r.get('week'), 0) or 0, team))
    out = {}
    for gid, rows in weeks.items():
        rows.sort()
        path = []
        for _, team in rows:
            if not path or path[-1] != team:
                path.append(team)
        if len(path) > 1:
            out[gid] = path
    return out


def load_injuries(y):
    """The latest week's injury report, by player. 2009 on.

    Only the most recent week matters: this is a fact about right now, not a season-long
    rate, and it is attached only while the season is being played. The game-day
    designation is the real answer; most rows do not carry one, so a man who simply did
    not practise is reported as that and not dressed up as a designation.
    """
    p = os.path.join(RAW, 'injuries_%d.csv' % y)
    if not os.path.exists(p):
        return {}
    rows = []
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            if (r.get('season_type') or 'REG') not in ('REG', 'POST'):
                continue
            rows.append(r)
    if not rows:
        return {}
    last = max(num(r.get('week'), 0) or 0 for r in rows)
    out = {}
    for r in rows:
        if (num(r.get('week'), 0) or 0) != last:
            continue
        gid = (r.get('gsis_id') or '').strip()
        if not gid:
            continue
        status = sstr(r.get('report_status'))
        prac = sstr(r.get('practice_status')) or ''
        if not status:
            if prac.startswith('Did Not'):
                status = 'Did not practise'
            elif prac.startswith('Limited'):
                status = 'Limited in practice'
            else:
                continue                      # full participation is not news
        hurt = sstr(r.get('report_primary_injury')) or sstr(r.get('practice_primary_injury'))
        if hurt and hurt.lower().startswith('not injury related'):
            # "Not injury related - resting player" is a thirty-four-year-old getting a
            # Wednesday off. Without a game-day designation there is nothing to report.
            if not sstr(r.get('report_status')):
                continue
            hurt = ''
        rec = dict(st=status, wk=int(last))
        if hurt:
            rec['inj'] = hurt
        out[gid] = rec
    return out


def fg_curve(reg_by_season):
    """League make-rate by distance, per season, for FG over expected.

    A logistic on distance is the standard shape; with one league-season of attempts a
    fitted logistic and a smoothed empirical curve agree closely, and the empirical one
    can't blow up on a season where nobody tried from 60. Falls back to the pooled
    all-season curve where a season is thin.
    """
    per, pooled = {}, defaultdict(lambda: [0, 0])
    for y, df in reg_by_season.items():
        made, missed = defaultdict(int), defaultdict(int)
        for r in df.itertuples(index=False):
            for lst, tgt in ((r.fg_made_list, made), (r.fg_missed_list, missed)):
                if isinstance(lst, str) and lst:
                    for d in lst.split(';'):
                        d = d.strip()
                        if d.isdigit():
                            tgt[int(d)] += 1
        per[y] = (made, missed)
        for d, n in made.items():
            pooled[d][0] += n
            pooled[d][1] += n
        for d, n in missed.items():
            pooled[d][1] += n

    def smooth(made, missed, d, half=4):
        m = t = 0
        for k in range(d - half, d + half + 1):
            w = 1.0 - abs(k - d) / (half + 1.0)
            m += made.get(k, 0) * w
            t += (made.get(k, 0) + missed.get(k, 0)) * w
        return (m, t)

    def p_make(y, d):
        made, missed = per.get(y, ({}, {}))
        m, t = smooth(made, missed, d)
        if t >= 12:
            return m / t
        pm = sum(pooled[k][0] * (1 - abs(k - d) / 5.0) for k in range(d - 4, d + 5) if k in pooled)
        pt = sum(pooled[k][1] * (1 - abs(k - d) / 5.0) for k in range(d - 4, d + 5) if k in pooled)
        if pt >= 12:
            return pm / pt
        return None
    return p_make


# ---------------------------------------------------------------- metric assembly
# Counts a season's stat table never recorded. It carries a zero for every man in the
# league (no tackle for loss from 2003 to 2011, no quarterback hit from 2003 to 2005),
# and a zero that means "nobody wrote it down" was being printed, and ranked, as none.
UNTRACKED = {}
_GAPS = (('def_tackles_for_loss', 'tackles for loss', ('tfl', 'tflsnap')),
         ('def_qb_hits', 'QB hits', ('hits',)))


def _untracked_cols(rows):
    """The columns of a season table that were never filled in. Sacks always were, and a
    season has about as many quarterback hits as sacks and twice as many tackles for loss,
    so a count under a tenth of the sacks is not a count. (Measured against sacks, not a
    fixed number, so the Thursday opener of a new season does not read as a blank.)"""
    sacks = sum(num(r.get('def_sacks'), 0) or 0 for r in rows)
    return {col for col, _, _ in _GAPS
            if sacks > 0 and sum(num(r.get(col), 0) or 0 for r in rows) < 0.1 * sacks}


def note_untracked(y, rows):
    """Work out which of those counts a season's table really has. `rows` is the season
    table, one dict per player."""
    cols = _untracked_cols(rows)
    out = {k for col, _, keys in _GAPS if col in cols for k in keys}
    UNTRACKED[y] = out
    return out


def build_player(r, pos, bio, ngs, pfr, snap, qbr, comb, qb, rush, rec, pens,
                 onf, onf_teams, starts, team_games, pmake, y, fqb=None, frush=None,
                 frec=None, ex=None, lg=None, live=False):
    m, d = {}, {}
    ex = ex or {}
    # A lineman in a season the participation file has not been published for - which is
    # every season while it is being played - gets his on-field rows from his share of
    # each game's snaps instead (extras.py). Marked, so the on/off rows stay blank: with no
    # play-by-play lineup there is no "off the field" to difference against.
    standin = False
    if not onf and pos in E.OLINE and y >= TIER_SINCE[5]:
        onf = E.standin_onfield(ex)
        standin = bool(onf)
    # `games` in the season table counts games in which he recorded a *stat*. For skill
    # players and defenders that is every game he played; for an offensive lineman it is
    # only the games he was flagged in, which read Trent Williams as a five-game season.
    # Snap counts know who actually took the field, so they win where they exist.
    G = num(r.get('games'), 0) or 0
    if starts and starts.get('games'):
        G = max(G, float(starts['games']))
    elif onf:
        G = max(G, float(sum(x['g'] for x in onf)))
    d['g'] = G
    if G:
        m['g'] = G
        if team_games:
            m['avail'] = min(1.0, G / team_games) * 100.0

    sn = snap.get((bio_id(r), y))
    off_s = def_s = None
    if sn:
        off_s, def_s = sn['off'], sn['dfn']
        tot = off_s + def_s + sn['st']
        d['snap'] = off_s
        d['dsnap'] = def_s
        if G:
            m['snaps'] = tot / G
        # A lineman arrives here already split into OT / OG / OC, so the offense test has
        # to name those too - it used to name only 'OL', which sent every tackle, guard and
        # centre down the defensive branch and gave the whole line a 0% snap share.
        # Kickers and punters live on special teams, where "share of the unit's snaps"
        # has no meaning, so they get no snap share at all rather than a false zero.
        offense = pos in ('QB', 'RB', 'WR', 'TE', 'OL', 'OT', 'OG', 'OC')
        base = sn['offt'] if offense else sn['deft']
        side = off_s if offense else def_s
        if base and pos not in ('K', 'P'):
            m['snapshr'] = side / base * 100.0
    pen = num(r.get('penalties'))
    if pen is None and r.get('_snap_only'):
        pen = pens.get('pen', 0.0) if pens else 0.0
    if pen is not None and G:
        m['pen'] = pen / G

    ng = ngs.get((bio_id(r), y), {})
    pf = pfr.get((bio_id(r), y), {})

    # ------------------------------------------------------------------ passing
    att = num(r.get('attempts'), 0) or 0
    sacks = num(r.get('sacks_suffered'), 0) or 0
    db = att + sacks + (qb.get('scr', 0) if qb else 0)
    if qb:
        db = qb.get('db', db)
    if att >= 1:
        d['att'] = att
        d['db'] = db
        py_ = num(r.get('passing_yards'), 0) or 0
        ptd = num(r.get('passing_tds'), 0) or 0
        pint = num(r.get('passing_interceptions'), 0) or 0
        syl = num(r.get('sack_yards_lost'), 0) or 0
        cmp_ = num(r.get('completions'), 0) or 0
        m['cmppct'] = cmp_ / att * 100.0
        m['ypa'] = py_ / att
        m['tdpct'] = ptd / att * 100.0
        m['intpct'] = pint / att * 100.0
        m['anya'] = (py_ + 20 * ptd - 45 * pint - syl) / max(att + sacks, 1)
        m['rate'] = passer_rating(cmp_, att, py_, ptd, pint)
        if db:
            m['sackpct'] = sacks / db * 100.0
        ay = num(r.get('passing_air_yards'))
        if ay is not None and y >= TIER_SINCE[2]:
            m['adot'] = ay / att
        cp = num(r.get('passing_cpoe'))
        if cp is not None:
            m['cpoe'] = cp
        if qb:
            if qb.get('db'):
                m['epadb'] = qb['db_epa'] / qb['db']
                m['srdb'] = qb['db_succ'] / qb['db'] * 100.0
                m['scrrate'] = qb['scr'] / qb['db'] * 100.0
                m['twrate'] = qb['tw'] / qb['db'] * 100.0
                m['fddb'] = (num(r.get('passing_first_downs'), 0) or 0) / qb['db'] * 100.0
            if qb.get('att') and y >= TIER_SINCE[2]:
                m['deeprate'] = qb['deep'] / qb['att'] * 100.0
            if qb.get('td3'):
                m['td3conv'] = qb['td3_conv'] / qb['td3'] * 100.0
                d['td3'] = qb['td3']
            if qb.get('rz_db'):
                m['rztd'] = qb['rz_td'] / qb['rz_db'] * 100.0
        q = qbr.get((bio_id(r), y))
        if q is not None:
            m['qbr'] = q
        if y >= TIER_SINCE[5]:
            for src, key in (('pas_avg_time_to_throw', 'ttt'),
                             ('pas_avg_air_yards_to_sticks', 'aysticks'),
                             ('pas_aggressiveness', 'aggr'),
                             ('pas_expected_completion_percentage', 'xcomp')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if y >= TIER_SINCE[6]:
            pa = num(pf.get('pass_pass_attempts'))
            for src, key, sc in (('pass_pressure_pct', 'prsspct', 1.0),
                                 ('pass_on_tgt_pct', 'ontgt', 1.0),
                                 ('pass_bad_throw_pct', 'badthrow', 1.0),
                                 ('pass_drop_pct', 'droppct', 1.0),
                                 ('pass_pocket_time', 'pocket', 1.0)):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v * sc
            tb = num(pf.get('pass_times_blitzed'))
            if tb is not None and pa:
                m['blitzpct'] = tb / pa * 100.0
            # Play-action and RPO run 2018-2021 on PFR's charting and 2022 on FTN's, and
            # unlike blitz rate and the drop rates the two crews do not agree: PFR's RPO
            # count runs about four times FTN's. The history is worth having, so both are
            # here, and the step at 2022 is named in the metric's own explanation rather
            # than left for a reader to trip over.
            pap = num(pf.get('pass_pa_pass_att'))
            if pap is not None and pa:
                m['parate'] = pap / pa * 100.0
            rpo = num(pf.get('pass_rpo_pass_att'))
            if rpo is not None and pa:
                m['rporate'] = rpo / pa * 100.0

        # FTN charts within days of a game, so this is the block that is alive in
        # September. It runs after the PFR block and overwrites it where the two crews
        # measure the same thing - blitz rate and both drop rates, which agree at
        # r = .90 to .95 with matching league means - so those rows keep their 2018 start
        # and change hands in 2022. Play-action and RPO are NOT the same measurement
        # (PFR stopped publishing play-action after 2023, and its RPO count is four times
        # FTN's), so they are tier 7: FTN's number from 2022, and nothing before it.
        # Each rate divides by its own charted denominator: the join to
        # play-by-play is high but not total, and a charted numerator over an uncharted
        # denominator is a number that is quietly too small.
        if y >= TIER_SINCE[7] and fqb:
            cdb = fqb.get('chart_db') or 0
            catt = fqb.get('chart_att') or 0
            rn = fqb.get('rush_n') or 0
            if rn:
                m['blitzpct'] = fqb['blitz'] / rn * 100.0
                m['rushfaceq'] = fqb['rush_sum'] / rn
            if cdb:
                m['parate'] = fqb['pa'] / cdb * 100.0
                m['rporate'] = fqb['rpo'] / cdb * 100.0
                m['motion'] = fqb['motion'] / cdb * 100.0
                m['nohuddle'] = fqb['nohuddle'] / cdb * 100.0
                m['oop'] = fqb['oop'] / cdb * 100.0
            if catt:
                m['catchable'] = fqb['catchable'] / catt * 100.0
                m['droppct'] = fqb['drop'] / catt * 100.0
                m['throwaway'] = fqb['throwaway'] / catt * 100.0
                m['iwrate'] = fqb['iw'] / catt * 100.0
                m['screen'] = fqb['screen'] / catt * 100.0
            rdn = fqb.get('read_n') or 0
            if rdn:
                m['firstread'] = fqb['read_1'] / rdn * 100.0
                m['checkdown'] = fqb['read_chk'] / rdn * 100.0
            skn = fqb.get('sack_n') or 0
            if skn:
                m['faultsack'] = fqb['sack_fault'] / skn * 100.0

    # ------------------------------------------------------------------ rushing
    car = num(r.get('carries'), 0) or 0
    if car >= 1:
        d['car'] = car
        ry = num(r.get('rushing_yards'), 0) or 0
        m['ypc'] = ry / car
        if G:
            m['car'] = car / G
        m['fumrate'] = (num(r.get('rushing_fumbles'), 0) or 0) / car * 100.0
        m['fdcar'] = (num(r.get('rushing_first_downs'), 0) or 0) / car * 100.0
        if G:
            m['rushy'] = ry / G
        if rush and rush.get('car'):
            n = rush['car']
            m['epacar'] = rush['car_epa'] / n
            m['srcar'] = rush['car_succ'] / n * 100.0
            m['stuff'] = rush['stuff'] / n * 100.0
            m['ex10'] = rush['ex10'] / n * 100.0
            m['ex20'] = rush['ex20'] / n * 100.0
            if rush.get('rz_car'):
                m['rztdcar'] = rush['rz_td'] / rush['rz_car'] * 100.0
        if y >= TIER_SINCE[5]:
            v = num(ng.get('rus_rush_yards_over_expected_per_att'))
            if v is not None:
                m['ryoe'] = v
            v = num(ng.get('rus_percent_attempts_gte_eight_defenders'))
            if v is not None:
                m['box8'] = v
            v = num(ng.get('rus_avg_time_to_los'))
            if v is not None:
                m['tlos'] = v
        if y >= TIER_SINCE[6]:
            ra = num(pf.get('rush_att'))
            for src, key in (('rush_ybc_att', 'ybc'), ('rush_yac_att', 'yacr')):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v
            bt = num(pf.get('rush_brk_tkl'))
            if bt is not None and ra:
                m['brkrate'] = bt / ra * 100.0
        if y >= TIER_SINCE[7] and frush:
            # Next Gen Stats says how often he saw eight or more; FTN says how many he
            # saw. Scrambles are excluded upstream, so this is the front he ran into on
            # designed runs.
            bn = frush.get('box_n') or 0
            if bn:
                m['boxcar'] = frush['box_sum'] / bn

    # ------------------------------------------------------------------ receiving
    tgt = num(r.get('targets'), 0) or 0
    rcp0 = num(r.get('receptions'), 0) or 0
    if rcp0 >= 1:
        # Receptions and receiving yardage are recorded in every season; targets are not
        # (see the tier note in metrics.py), so these two rows anchor the older cards.
        d['rec'] = rcp0
        recy0 = num(r.get('receiving_yards'), 0) or 0
        if G:
            m['recg'] = rcp0 / G
            m['recy'] = recy0 / G
        m['yprec'] = recy0 / rcp0
    if tgt >= 1:
        d['tgt'] = tgt
        rcp = rcp0
        recy = num(r.get('receiving_yards'), 0) or 0
        m['ypt'] = recy / tgt
        m['catch'] = rcp / tgt * 100.0
        m['fdtgt'] = (num(r.get('receiving_first_downs'), 0) or 0) / tgt * 100.0
        m['tdtgt'] = (num(r.get('receiving_tds'), 0) or 0) / tgt * 100.0
        m['ex20rec'] = (num(r.get('receiving_20'), 0) or 0) / tgt * 100.0
        if G:
            m['tgt'] = tgt / G
        rec_ay = num(r.get('receiving_air_yards'))
        # His share of the throws in the games he played. The season table's own share
        # columns divide by every game his team played, so a receiver who drew a third of
        # the targets for seven games and then got hurt (Garrett Wilson, 2025) read as a
        # 12% target share, the mark of a third option. The team totals for his own games
        # ride on the week counters (extras.py), which is also what lets a window of games
        # or a season through week N be worked out the same way.
        share = {}
        if ex.get('t_tgt'):
            share['target_share'] = tgt / ex['t_tgt']
            if rec_ay is not None and ex.get('t_ay') and ex['t_ay'] > 0:
                share['air_yards_share'] = rec_ay / ex['t_ay']
                share['wopr'] = 1.5 * share['target_share'] + 0.7 * share['air_yards_share']
        if rec_ay:
            share['racr'] = recy / rec_ay
        for src, key, sc in (('target_share', 'tgtshr', 100.0),
                             ('air_yards_share', 'ayshr', 100.0),
                             ('wopr', 'wopr', 1.0), ('racr', 'racr', 1.0)):
            v = share.get(src)
            if v is None:
                v = num(r.get(src))            # no team totals for these games: the table's own
            if v is None or (key != 'tgtshr' and y < TIER_SINCE[2]):
                continue
            # RACR is yards / air yards: with a shallow target diet the denominator goes to
            # zero and the ratio blows up, so it is only reported where it can mean something.
            if key == 'racr' and (rec_ay is None or rec_ay < 60):
                continue
            m[key] = v * sc
        if rec and rec.get('tgt'):
            n = rec['tgt']
            m['epatgt'] = rec['tgt_epa'] / n
            m['srtgt'] = rec['tgt_succ'] / n * 100.0
            if y >= TIER_SINCE[2]:
                m['adotr'] = rec['ay'] / n
                m['deeptgt'] = rec['deep'] / n * 100.0
                if rec.get('rec'):
                    m['yacrec'] = rec['yac'] / rec['rec']
                    # Yards before catch is where he was standing when it arrived, which
                    # is air yards on the balls he caught. PFR charts the same thing from
                    # 2018; this agrees with it to r = 0.997 on 2025 and reaches back to
                    # the first season air yards were recorded.
                    m['ybcr'] = rec['ay_c'] / rec['rec']
            if y >= TIER_SINCE[3]:
                # The rating his quarterback earns throwing at him. It needs incompletions
                # attributed to a receiver, which the gamebooks start doing in 2012.
                m['rattgt'] = passer_rating(rec.get('rec', 0.0), n, rec.get('yds', 0.0),
                                            rec.get('td', 0.0), rec.get('int', 0.0))
            m['rztgtr'] = rec['rz_tgt'] / n * 100.0
        if off_s:
            m['tprs'] = tgt / off_s * 100.0
            m['ypsnap'] = recy / off_s
        if y >= TIER_SINCE[5]:
            for src, key in (('rec_avg_separation', 'sep'), ('rec_avg_cushion', 'cush'),
                             ('rec_avg_yac_above_expectation', 'yacoe')):
                v = num(ng.get(src))
                if v is not None:
                    m[key] = v
        if y >= TIER_SINCE[6]:
            v = num(pf.get('rec_drop_percent'))
            if v is not None:
                m['dropr'] = v * 100.0
            bt, rc = num(pf.get('rec_brk_tkl')), num(pf.get('rec_rec'))
            if bt is not None and rc:
                m['brkrec'] = bt / rc * 100.0
        # The hands panel. Its whole point is that it separates a receiver from the man
        # throwing to him: a ball that was never catchable is not a failure of the hands.
        if y >= TIER_SINCE[7] and frec:
            ct = frec.get('chart_tgt') or 0
            if ct:
                m['dropr'] = frec['drop'] / ct * 100.0
                m['ctchtgt'] = frec['catchable'] / ct * 100.0
                m['contest'] = frec['contested'] / ct * 100.0
                m['created'] = frec['created'] / ct * 100.0
            cb = frec.get('catchable') or 0
            if cb:
                m['ctchhand'] = frec['catchable_rec'] / cb * 100.0
            cn = frec.get('contested') or 0
            if cn:
                m['contestw'] = frec['contested_rec'] / cn * 100.0

    # ------------------------------------------------------------------ defense
    tkl_s = num(r.get('def_tackles_solo'), 0) or 0
    tkl_a = num(r.get('def_tackle_assists'), 0) or 0
    comb_t = tkl_s + tkl_a
    dsk = num(r.get('def_sacks'), 0) or 0
    if G and (comb_t or dsk or num(r.get('def_qb_hits'), 0)):
        m['tkl'] = comb_t / G
        if comb_t:
            m['solopct'] = tkl_s / comb_t * 100.0
        m['sk'] = dsk / G
        m['hits'] = (num(r.get('def_qb_hits'), 0) or 0) / G
        m['tfl'] = (num(r.get('def_tackles_for_loss'), 0) or 0) / G
        m['ff'] = (num(r.get('def_fumbles_forced'), 0) or 0) / G
        m['int'] = (num(r.get('def_interceptions'), 0) or 0) / G
        m['pd'] = (num(r.get('def_pass_defended'), 0) or 0) / G
        if def_s:
            m['tklsnap'] = comb_t / def_s * 100.0
            m['sksnap'] = dsk / def_s * 100.0
            m['tflsnap'] = (num(r.get('def_tackles_for_loss'), 0) or 0) / def_s * 100.0
    if y >= TIER_SINCE[6] and pf:
        prs = num(pf.get('def_prss'))
        if prs is not None and G:
            m['prss'] = prs / G
            if def_s:
                m['prsssnap'] = prs / def_s * 100.0
        for src, key in (('def_hrry', 'hrry'), ('def_qbkd', 'qbkd'),
                         ('def_bltz', 'blitz'), ('def_bats', 'bats')):
            v = num(pf.get(src))
            if v is not None and G:
                m[key] = v / G
        hr, kd = num(pf.get('def_hrry')), num(pf.get('def_qbkd'))
        if hr is not None and kd is not None and def_s:
            m['prod'] = (dsk + 0.75 * (hr + kd)) / def_s * 100.0
        v = num(pf.get('def_m_tkl_percent'))
        if v is not None:
            m['mtklpct'] = v * 100.0
        ct = num(pf.get('def_tgt'))
        if ct is not None and ct > 0:
            d['ctgt'] = ct
            if G:
                m['ctgt'] = ct / G
            if def_s:
                m['ctgtsnap'] = ct / def_s * 100.0
            for src, key, sc in (('def_cmp_percent', 'cmpall', 100.0),
                                 ('def_yds_tgt', 'yptall', 1.0),
                                 ('def_rat', 'ratall', 1.0), ('def_dadot', 'dadot', 1.0)):
                v = num(pf.get(src))
                if v is not None:
                    m[key] = v * sc
            cy = num(pf.get('def_yds'))
            if cy is not None and def_s:
                m['ycs'] = cy / def_s
            yac = num(pf.get('def_yac'))
            cmpn = num(pf.get('def_cmp'))
            if yac is not None and cmpn:
                m['yacall'] = yac / cmpn
            ballp = (num(r.get('def_interceptions'), 0) or 0) + (num(r.get('def_pass_defended'), 0) or 0)
            m['ballrate'] = ballp / ct * 100.0

    # ------------------------------------------------------------------ kicking
    fga = num(r.get('fg_att'), 0) or 0
    if fga:
        d['fga'] = fga
        m['fgpct'] = (num(r.get('fg_made'), 0) or 0) / fga * 100.0
        m['fglong'] = num(r.get('fg_long'))
        if G:
            m['fga'] = fga / G
        pat_a = num(r.get('pat_att'), 0) or 0
        if pat_a:
            m['patpct'] = (num(r.get('pat_made'), 0) or 0) / pat_a * 100.0
        made50 = miss50 = 0
        over = under = 0.0
        for lst, is_made in ((r.get('fg_made_list'), True), (r.get('fg_missed_list'), False)):
            if isinstance(lst, str) and lst:
                for dd in lst.split(';'):
                    dd = dd.strip()
                    if not dd.isdigit():
                        continue
                    dist = int(dd)
                    if dist >= 50:
                        made50 += 1 if is_made else 0
                        miss50 += 0 if is_made else 1
                    p = pmake(y, dist)
                    if p is not None:
                        over += (1.0 if is_made else 0.0) - p
                        under += 1
        if made50 + miss50:
            m['fg50'] = made50 / (made50 + miss50) * 100.0
        if under:
            m['fgoe'] = over / under
    pa_ = num(r.get('pt_att'), 0) or 0
    if pa_:
        d['punt'] = pa_
        m['pgross'] = (num(r.get('pt_yards'), 0) or 0) / pa_
        m['pnet'] = (num(r.get('pt_net_yards'), 0) or 0) / pa_
        m['pin20'] = (num(r.get('pt_inside_20'), 0) or 0) / pa_ * 100.0
        m['ptb'] = (num(r.get('pt_touchback'), 0) or 0) / pa_ * 100.0
        m['pretr'] = (num(r.get('pt_returned'), 0) or 0) / pa_ * 100.0
        m['pretyds'] = (num(r.get('pt_return_yards'), 0) or 0) / pa_
        if G:
            m['punts'] = pa_ / G

    # ------------------------------------------------------------------ blocking
    # Three tiers of claim, kept apart because they are not equally his: what he did
    # (penalties, starts, alignment), what the offense did on his snaps, and the
    # difference between his snaps and his bench time.
    st = starts
    if pens and G:
        m['fsg'] = pens.get('pen_fs', 0.0) / G
        m['holdg'] = pens.get('pen_hold', 0.0) / G
    elif G and (st or onf):
        # Never flagged is a zero, not a blank. Leaving it blank ranked the flagged linemen
        # against each other and left the cleanest ones out of the percentile altogether.
        m['fsg'] = m['holdg'] = 0.0
    if st:
        m['starts'] = st['starts']
        if st['vers']:
            m['posver'] = st['vers']
    if onf:
        pblk = sum(x['pblk'] for x in onf)
        rblk = sum(x['rblk'] for x in onf)
        d['pblk'] = pblk
        d['rblk'] = rblk
        if G:
            m['pblkg'] = pblk / G
            m['rblkg'] = rblk / G
        prs_n = sum(x['prs_n'] for x in onf)
        if prs_n >= 1:
            m['prsallow'] = sum(x['prs'] for x in onf) / prs_n * 100.0
        if pblk:
            if all('hit' in x for x in onf):
                m['hitallow'] = sum(x['hit'] for x in onf) / pblk * 100.0
            m['sackallow'] = sum(x['sk'] for x in onf) / pblk * 100.0
            m['epadbon'] = sum(x['pepa'] for x in onf) / pblk
            m['srdbon'] = sum(x['psucc'] for x in onf) / pblk * 100.0
        rn = sum(x['rush_n'] for x in onf)
        if rn:
            m['rushfaced'] = sum(x['rush_sum'] for x in onf) / rn
        if rblk:
            m['ypcon'] = sum(x['ryds'] for x in onf) / rblk
            m['srrunon'] = sum(x['rsucc'] for x in onf) / rblk * 100.0
            m['stuffon'] = sum(x['stuff'] for x in onf) / rblk * 100.0
        bn = sum(x['box_n'] for x in onf)
        if bn:
            m['boxfaced'] = sum(x['box_sum'] for x in onf) / bn

        # On/off. The off-field half is his team's totals minus his own, so it only
        # exists for players who actually left the field — an iron-man lineman has
        # nothing to be compared against and gets no value at all rather than a zero.
        off = defaultdict(float)
        for x in ([] if standin else onf):
            t = onf_teams.get(x['tm'])
            if not t:
                continue
            for k in ('pblk', 'rblk', 'prs_n', 'prs', 'pepa', 'rsucc'):
                off[k] += t[k] - x[k]
        if off['prs_n'] >= 60 and prs_n >= 60 and 'prsallow' in m:
            m['prsoo'] = m['prsallow'] - off['prs'] / off['prs_n'] * 100.0
        if off['pblk'] >= 60 and pblk >= 60 and 'epadbon' in m:
            m['epaoo'] = m['epadbon'] - off['pepa'] / off['pblk']
        if off['rblk'] >= 50 and rblk >= 50 and 'srrunon' in m:
            m['sroo'] = m['srrunon'] - off['rsucc'] / off['rblk'] * 100.0

    # ------------------------------------------------------------------ value
    epa_tot = sum(num(r.get(k), 0) or 0 for k in
                  ('passing_epa', 'rushing_epa', 'receiving_epa'))
    if epa_tot:
        m['epatot'] = epa_tot
    fp = num(r.get('fantasy_points_ppr'))
    if pos == 'K':
        fp = E.kicker_points(r)          # the season table scores every kicker at zero
    if fp is not None and G:
        m['fppg'] = fp / G
    touches = car + (num(r.get('receptions'), 0) or 0)
    if touches and G:
        m['toucheg'] = touches / G

    # ------------------------------------------------------------------ October 2026 rows
    E.add_metrics(m, d, r, pos, y, G, ex, qb, rush, rec, pens, fqb, frush, frec, pf, ng,
                  off_s, def_s, lg, TIER_SINCE, num, live)

    # ------------------------------------------------------------------ athletic
    for k, v in comb.get(bio_id(r), {}).items():
        m[k] = v
    b = bio.get(bio_id(r)) or {}
    if 'ht' not in m and b.get('ht'):
        m['ht'] = b['ht']
    if 'wt' not in m and b.get('wt'):
        m['wt'] = b['wt']

    # only rows the cohort actually shows
    panels = set(POS_PANELS.get(pos, []))
    m = {k: rnd(v) for k, v in m.items()
         if v is not None and k in MBY and MBY[k]['grp'] in panels
         and pos in MBY[k]['pos'] and MBY[k]['since'] <= y}
    for k in UNTRACKED.get(y, ()):
        m.pop(k, None)
    return {k: v for k, v in m.items() if v is not None}, d


_CUR_ID = None


def bio_id(r):
    return r.get('player_id')


def passer_rating(cmp_, att, yds, td, int_):
    if not att:
        return None
    a = min(max((cmp_ / att - 0.3) * 5, 0), 2.375)
    b = min(max((yds / att - 3) * 0.25, 0), 2.375)
    c = min(max((td / att) * 20, 0), 2.375)
    dd = min(max(2.375 - (int_ / att * 25), 0), 2.375)
    return (a + b + c + dd) / 6 * 100


# ---------------------------------------------------------------- comps
def pct_rank(v, pool, lower):
    n = len(pool)
    if v is None or n < 2:
        return None
    less = sum(1 for x in pool if x < v)
    eq = sum(1 for x in pool if x == v)
    p = 100.0 * (less + 0.5 * eq) / n
    return 100.0 - p if lower else p


def add_comps(players, pos_pools):
    """Statistical comps and weakness comps, per cohort, inside one season."""
    for pos, group in pos_pools.items():
        qual = [p for p in group if p['qualified']]
        if len(qual) < 6:
            continue
        dims = [k for k in HEADLINE.get(pos, []) if k in MBY]
        wdims = [k for k in WEAK_DIMS.get(pos, []) if k in MBY]
        pools = {}
        for k in set(dims) | set(wdims):
            pools[k] = [p['m'][k] for p in qual if k in p['m']]
        def vec(p, keys):
            out = []
            for k in keys:
                v = p['m'].get(k)
                out.append(pct_rank(v, pools[k], MBY[k]['lower']) if v is not None else None)
            return out
        vecs = {p['id']: vec(p, dims) for p in qual}
        wvecs = {p['id']: vec(p, wdims) for p in qual}
        # An offensive lineman's headline stats are his unit's, so his four best matches
        # are otherwise always the four men beside him — true, and useless. Comps for the
        # line look outside his own team.
        same_team_ok = pos not in E.OLINE
        for p in qual:
            a = vecs[p['id']]
            scored = []
            for q in qual:
                if q['id'] == p['id']:
                    continue
                if not same_team_ok and q.get('team') and q['team'] == p.get('team'):
                    continue
                b = vecs[q['id']]
                pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
                if len(pairs) < max(2, len(dims) - 2):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                scored.append((round(max(0.0, 100.0 - dist * 1.6)), q))
            scored.sort(key=lambda t: -t[0])
            p['comps'] = [dict(id=q['id'], name=q['name'], team=q.get('team') or '', score=s)
                          for s, q in scored[:4]]
            # weakness: hinge at the median, keep only the below-average half
            aw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[p['id']]]
            flaws = sorted([(x, k) for x, k in zip(wvecs[p['id']], wdims)
                            if x is not None and x < 40], key=lambda t: t[0])[:3]
            p['wflaws'] = [dict(k=k, pct=int(round(x))) for x, k in flaws]
            worst = min([v for v in wvecs[p['id']] if v is not None], default=None)
            if worst is None or worst >= 40:
                p['wcomps'] = []
                continue
            wscored = []
            for q in qual:
                if q['id'] == p['id']:
                    continue
                if not same_team_ok and q.get('team') and q['team'] == p.get('team'):
                    continue
                bw = [None if x is None else min(x - 50.0, 0.0) for x in wvecs[q['id']]]
                pairs = [(x, y) for x, y in zip(aw, bw) if x is not None and y is not None]
                if len(pairs) < max(2, len(wdims) - 3):
                    continue
                dist = sum(abs(x - y) for x, y in pairs) / len(pairs)
                wscored.append((round(max(0.0, 100.0 - dist * 2.2)), q))
            wscored.sort(key=lambda t: -t[0])
            p['wcomps'] = [dict(id=q['id'], name=q['name'], team=q.get('team') or '', score=s)
                           for s, q in wscored[:4]]


# ---------------------------------------------------------------- the line, the returners
# The All-Savant Team on the front page needs two things no single player row can give it.
# Both are season-level blocks, graded here (like the comps) because they need the whole
# league at once, and both are small.

LINE_SPOTS = ('LT', 'LG', 'C', 'RG', 'RT')


def load_units(y):
    """The line (team-week) and return (returner-week) rows pbp_agg.py wrote."""
    p = os.path.join(AGG, 'pbp_%d.json' % y)
    if not os.path.exists(p):
        return [], []
    j = json.load(open(p))
    return j.get('line', []), j.get('ret', [])


def line_starters(y, by_pfr):
    """{team: [{id, slot}, ...]} - the five men who have played each spot most this season.

    The depth chart says where a man lines up (LT, LG, C, RG, RT) but not whether he
    played; snap counts say who played but not where. So each lineman's spot is the one
    the depth chart lists him first-string at most often during the regular season, and the
    spot goes to whoever has taken the most offensive snaps among the men listed there.
    Offseason snapshots are ignored - a July depth chart is a guess.
    """
    dp = os.path.join(RAW, 'depth_%d.csv' % y)
    sp = os.path.join(RAW, 'snaps_%d.csv' % y)
    if not os.path.exists(dp) or not os.path.exists(sp):
        return {}
    # regular-season window
    start = None
    sch = os.path.join(RAW, 'schedules.csv')
    if os.path.exists(sch):
        g = pd.read_csv(sch, usecols=['season', 'game_type', 'gameday'], low_memory=False)
        g = g[(g.season == y) & (g.game_type == 'REG')]
        if len(g):
            start = str(g.gameday.min())
    spot_ct = defaultdict(lambda: defaultdict(float))      # (team, gid) -> spot -> listings
    with open(dp, newline='', encoding='utf-8', errors='replace') as f:
        rd = csv.DictReader(f)
        cols = rd.fieldnames or []
        espn = 'pos_abb' in cols
        for r in rd:
            if espn:
                spot, rank, team = r.get('pos_abb'), r.get('pos_rank'), r.get('team')
                if start and (r.get('dt') or '')[:10] < start:
                    continue
            else:
                spot, rank, team = r.get('depth_position'), r.get('depth_team'), r.get('club_code')
                if (r.get('game_type') or 'REG') != 'REG':
                    continue
            spot = (spot or '').strip().upper()
            gid = (r.get('gsis_id') or '').strip()
            if spot not in LINE_SPOTS or not gid or not team:
                continue
            spot_ct[(canon(team.strip()), gid)][spot] += 2.0 if (rank or '').strip() == '1' else 1.0
    sn = pd.read_csv(sp, low_memory=False)
    if 'game_type' in sn.columns:
        sn = sn[sn.game_type == 'REG']
    sn = sn[sn.position.isin(['T', 'G', 'C', 'OT', 'OG', 'OL'])]
    snaps = defaultdict(float)
    for r in sn.itertuples(index=False):
        gid = by_pfr.get(r.pfr_player_id)
        if gid:
            snaps[(canon(r.team), gid)] += float(num(r.offense_snaps, 0) or 0)
    out = {}
    for team in sorted({t for t, _ in snaps}):
        used, five = set(), []
        home = {}                                   # gid -> his most-listed spot
        for (t, gid), sc in spot_ct.items():
            if t == team:
                home[gid] = max(sorted(sc), key=lambda k: sc[k])
        for spot in ('C', 'LT', 'RT', 'LG', 'RG'):
            cands = [(snaps.get((team, g), 0.0), g) for g, h in home.items()
                     if h == spot and g not in used]
            cands = [c for c in cands if c[0] > 0]
            if not cands:                           # nobody listed there has played:
                cands = [(v, g) for (t, g), v in snaps.items()      # the busiest spare
                         if t == team and g not in used and v > 0]
            if not cands:
                continue
            best = max(cands)[1]
            used.add(best)
            five.append(dict(id=best, slot=spot))
        five.sort(key=lambda x: LINE_SPOTS.index(x['slot']))
        out[team] = five
    return out


def grade_lines(y, line_rows, by_pfr, bio):
    """Every team's line, graded on sack rate, QB-hit rate and rush success, best first."""
    acc = defaultdict(lambda: defaultdict(float))
    for r in line_rows:
        a = acc[r['tm']]
        a['g'] += 1
        for k in ('db', 'sk', 'hit', 'run', 'run_succ'):
            a[k] += float(r.get(k) or 0)
    rows = []
    for tm, a in acc.items():
        if not a['db'] or not a['run']:
            continue
        rows.append(dict(tm=tm, g=int(a['g']), db=int(a['db']), run=int(a['run']),
                         sackr=a['sk'] / a['db'] * 100.0, hitr=a['hit'] / a['db'] * 100.0,
                         runsr=a['run_succ'] / a['run'] * 100.0))
    if len(rows) < 8:
        return []
    pools = {k: [r[k] for r in rows] for k in ('sackr', 'hitr', 'runsr')}
    lower = {'sackr': True, 'hitr': True, 'runsr': False}
    starters = line_starters(y, by_pfr)
    for r in rows:
        r['pct'] = {k: int(round(pct_rank(r[k], pools[k], lower[k]))) for k in pools}
        r['score'] = int(round(sum(r['pct'].values()) / 3.0))
        for k in ('sackr', 'hitr', 'runsr'):
            r[k] = round(r[k], 2)
        # Name and face ride along: plenty of linemen never touch a stat sheet, so they
        # have no player row this season for the page to look them up in.
        five = []
        for f in starters.get(r['tm'], []):
            b = bio.get(f['id']) or {}
            e = dict(f, name=b.get('name') or f['id'])
            if isinstance(b.get('head'), str) and b['head'].strip():
                e['h'] = b['head'].strip()
            five.append(e)
        r['five'] = five
    rows.sort(key=lambda r: (-r['score'], r['tm']))
    return rows


RET_MIN = {'kr': 1.5, 'pr': 1.25}      # returns per team game: a primary returner's volume


def grade_returns(ret_rows, line_rows, players):
    """Kick and punt returners, graded on yards and EPA per return, best first.

    Qualifying volume pro-rates to the games his team has in the play-by-play, the same way
    every other qualifying line on the page does, so the list means something in September.
    """
    team_g = defaultdict(set)
    for r in line_rows:
        team_g[r['tm']].add(r['week'])
    by_id = {p['id']: p for p in players}
    acc = defaultdict(lambda: defaultdict(float))
    for r in ret_rows:
        a = acc[(r['k'], r['pid'])]
        for k in ('n', 'yds', 'epa', 'td', 'fum'):
            a[k] += float(r.get(k) or 0)
    out = {}
    for kind in ('kr', 'pr'):
        rows = []
        for (k, pid), a in acc.items():
            p = by_id.get(pid)
            if k != kind or not p or not a['n']:
                continue
            tg = len(team_g.get(p.get('team'), ())) or max((len(v) for v in team_g.values()), default=0)
            if a['n'] < RET_MIN[kind] * tg:
                continue
            rows.append(dict(id=pid, tm=p.get('team'), n=int(a['n']), td=int(a['td']),
                             fum=int(a['fum']), ypr=a['yds'] / a['n'], epa=a['epa'] / a['n']))
        if len(rows) < 5:
            continue
        pools = {k: [r[k] for r in rows] for k in ('ypr', 'epa')}
        for r in rows:
            r['pct'] = {k: int(round(pct_rank(r[k], pools[k], False))) for k in pools}
            r['score'] = int(round(sum(r['pct'].values()) / 2.0))
            r['ypr'], r['epa'] = round(r['ypr'], 1), round(r['epa'], 3)
        rows.sort(key=lambda r: (-r['score'], -r['n']))
        out[kind] = rows[:12]
    return out


TEAM_KEYS = ('plays', 'epa', 'succ', 'db', 'pepa', 'psucc', 'sk', 'hit', 'run', 'repa',
             'rsucc', 'ryds', 'stuff', 'x20', 'd3', 'd3c', 'to')
POS_KEYS = tuple('%s%s_%s' % (a, P, s) for a, Ps in (('t', ('WR', 'TE', 'RB')), ('r', ('RB', 'QB')))
                 for P in Ps for s in ('n', 'y', 'e'))


def team_block(S):
    """{team: {g, o:{...}, d:{...}, sos:[...]}} - what each offense has done, what each
    defense has allowed, and what both gave to and took from each position. Sums, so the
    page takes the rates and the ranks. The team page is built from this."""
    out = {}
    for (week, team), r in S.tm.items():
        e = out.setdefault(team, dict(g=0, o=defaultdict(float), d=defaultdict(float),
                                      so=[], sd=[]))
        e['g'] += 1
        for k in TEAM_KEYS + POS_KEYS:
            e['o'][k] += float(r.get(k) or 0)
        if r.get('sos_d') is not None:
            e['sd'].append(float(r['sos_d']))     # the defenses this offense has faced
        if r.get('sos_o') is not None:
            e['so'].append(float(r['sos_o']))     # the offenses this defense has faced
        f = S.faced.get((week, team))
        if f:
            for k in TEAM_KEYS + POS_KEYS:
                e['d'][k] += float(f.get(k) or 0)
    for team, e in out.items():
        e['o'] = {k: rnd(v, 2) for k, v in e['o'].items() if v}
        e['d'] = {k: rnd(v, 2) for k, v in e['d'].items() if v}
        for k in ('so', 'sd'):
            v = e.pop(k)
            if v:
                e[k] = rnd(sum(v) / len(v), 4)
    return out


# ---------------------------------------------------------------- main
def main():
    bio, by_pfr, by_espn = load_players()
    records = load_records()
    comb = load_combine(by_pfr)
    ngs = load_ngs()
    pfr = load_pfr(by_pfr, bio)
    snap = load_snaps(by_pfr, bio)
    qbr = load_qbr(by_espn)
    print('sources loaded', flush=True)

    regs = {}
    for y in SEASONS:
        p = os.path.join(RAW, 'reg_%d.csv' % y)
        if os.path.exists(p):
            regs[y] = pd.read_csv(p, low_memory=False)
    # The FG curve's pooled fallback wants every season on disk, not just the ones being
    # built — a one-season refresh in September has a dozen kicks from 55 to learn from.
    curve_regs = dict(regs)
    for y in range(1999, max(SEASONS) + 1):
        p = os.path.join(RAW, 'reg_%d.csv' % y)
        if y not in curve_regs and os.path.exists(p):
            curve_regs[y] = pd.read_csv(p, usecols=['fg_made_list', 'fg_missed_list'],
                                        low_memory=False)
    pmake = fg_curve(curve_regs)

    contracts = E.load_contracts(RAW)
    archive = os.environ.get('NFL_ARCHIVE')
    ratios = {}                       # season -> {gid: true pass snaps / the naive estimate}
    data, season_list = {}, []
    for y in SEASONS:
        if y not in regs:
            continue
        df = regs[y]
        # Last season's correction for this season's pass-snap estimates: from this run if
        # it built last season too, else from the shipped archive, else position averages.
        prior = ratios.get(y - 1)
        if prior is None and archive:
            prior = E.load_prior_ratio(archive, y - 1)
        ids_y = pfr_for(y, by_pfr, bio)        # the PFR-id lookup as it holds this season
        S = E.Season(y, ids_y, RAW, AGG, pmake, prior, swaps=team_swaps(y))
        qb_a, rush_a, rec_a, pen_a = load_pbp(y)
        fqb_a, frush_a, frec_a = load_ftn(y)
        line_a = load_line(y)
        wteams = load_weekteams(y, ids_y)
        accos = season_accolades(df.reset_index(drop=True))
        onf_a, onf_teams = load_onfield(y)
        starts_a = load_starts(y, ids_y)
        full_games = 17 if y >= 2021 else 16
        wk, tgames, frac, wk_done = season_progress(y, records)
        partial = wk is not None
        # An injury report is a fact about this week. A finished season has no this week.
        injuries = load_injuries(y) if partial else {}
        if partial:
            print(y, 'in progress: through week', wk, '(%.0f%% of the season)' % (frac * 100), flush=True)
        status = E.load_status(y, RAW) if partial else {}
        line_rows, ret_rows = load_units(y)
        lines = grade_lines(y, line_rows, ids_y, bio)
        line_score = {r['tm']: r['score'] for r in lines}
        players, pos_pools = [], defaultdict(list)
        rows = df.to_dict('records')
        gaps = note_untracked(y, rows)
        if gaps:
            print(y, 'not recorded this season, left blank:', ', '.join(sorted(gaps)), flush=True)
        # Everyone who took a snap gets a card. The stat table only lists men who recorded
        # a stat, which left out most of the offensive line: through four weeks of 2026,
        # 35 of the 167 linemen with 100 snaps had no card at all.
        have = {r.get('player_id') for r in rows if isinstance(r.get('player_id'), str)}
        rows += S.snap_only(have)
        swapped = {g for (g, _) in team_swaps(y)}
        for r in rows:
            gid = r.get('player_id')
            if not isinstance(gid, str):
                continue
            b = bio.get(gid, {})
            # one code per franchise, and the 2001-02 Jaguars back in Jacksonville
            r['recent_team'] = 'JAX' if gid in swapped else canon(sstr(r.get('recent_team')))
            if r.get('_snap_only') and b.get('pos'):
                # snap counts say "DL" and "OL"; the player file knows which
                r['position'] = b['pos']
            pos = cohort(r.get('position'), b.get('pff_pos'), b.get('ngs_pos'))
            if not pos:
                continue
            # A lineman is graded against the men who do his job. Where the depth charts
            # do not say - every season before 2001, and anybody who never made one - he
            # keeps the undifferentiated cohort rather than being guessed into one.
            if pos == 'OL':
                pos = line_spot(line_a, S, gid)
            pos = secondary_spot(pos, S, gid)
            team_games = full_games
            if partial:
                team_games = tgames.get(sstr(r.get('recent_team'))) or wk
            ex = S.roll(gid)
            ex.update(S.only(gid))
            deal = E.contract_for(contracts, gid, y)
            if deal:
                ex['apy'], ex['capshr'] = deal
            if pos in E.OLINE:
                ex['linescore'] = line_score.get(S.snap_team.get(gid) or sstr(r.get('recent_team')))
            m, d = build_player(r, pos, bio, ngs, pfr, snap, qbr, comb,
                                qb_a.get(gid), rush_a.get(gid), rec_a.get(gid),
                                pen_a.get(gid), onf_a.get(gid), onf_teams,
                                starts_a.get(gid), team_games, pmake, y,
                                fqb_a.get(gid), frush_a.get(gid), frec_a.get(gid),
                                ex=ex, lg=S.lg, live=partial)
            if not m:
                continue
            qkey, qmin = QUALIFY.get(pos, ('g', 6))
            have = d.get(qkey)
            if have is None and pos in QUALIFY_FALLBACK:
                qkey, qmin = QUALIFY_FALLBACK[pos]
                have = d.get(qkey)
            if partial:
                # pro-rated to his team's share of the season, never below one game's worth
                qmin = max(qmin * (team_games / float(full_games)), qmin / float(full_games))
            qualified = bool(have is not None and have >= qmin)
            age = None
            if b.get('birth'):
                try:
                    by_ = int(str(b['birth'])[:4])
                    age = y - by_ + (0 if int(str(b['birth'])[5:7]) <= 8 else -1)
                except (ValueError, TypeError):
                    age = None
            rec_out = dict(
                id=gid, name=sstr(r.get('player_display_name')) or b.get('name') or gid,
                team=sstr(r.get('recent_team')), pos=pos, rawpos=sstr(r.get('position')),
                # a count worked out from snap share is a whole number of snaps, give or take
                m=m, d={k: (float(max(1, round(v))) if (k in EST_DENS and not S.has_part) else rnd(v, 1))
                        for k, v in d.items() if v},
                qualified=qualified,
            )
            if gid in wteams:
                rec_out['tms'] = wteams[gid]      # every team he appeared for, in order
            role = S.roles.get(gid)
            if role:
                rec_out['role'] = role            # depth-chart spot and best rank (2025 on)
            if gid in status:
                rec_out['st'] = status[gid]       # off the active roster this week
            if not partial:
                psr = S.pass_ratio(gid)
                if psr:
                    rec_out['psr'] = psr          # corrects next season's pass-snap estimates
                    ratios.setdefault(y, {})[gid] = psr
            if gid in injuries:
                rec_out['inj'] = injuries[gid]    # this week's report, in season only
            if age:
                rec_out['age'] = age
            tr = records.get((rec_out['team'], y))
            if tr:
                rec_out['rec'] = [tr['w'], tr['l'], tr['t']]
                if tr['po']:
                    rec_out['po'] = tr['po']
                elif not partial and tr['w'] + tr['l'] + tr['t'] >= 8:
                    rec_out['po'] = 'Missed the playoffs'
                if tr['coach']:
                    rec_out['coach'] = tr['coach']
            acc = accos.get(gid)
            if acc:
                rec_out['acc'] = sorted(acc, key=lambda a: a['r'])[:6]
            for k in ('college', 'head', 'jersey', 'birth'):
                v = b.get(k)
                if isinstance(v, str):
                    v = sstr(v)
                if v:
                    rec_out['h' if k == 'head' else k] = v
            if b.get('rookie'):
                rec_out['exp'] = max(0, y - b['rookie'])
            if b.get('dround'):
                rec_out['dr'] = b['dround']
                rec_out['dp'] = b.get('dpick')
                rec_out['dy'] = b.get('dyear')
                rec_out['dt'] = b.get('dteam')
            elif b.get('dyear') is None and b.get('rookie'):
                rec_out['udfa'] = 1
            players.append(rec_out)
            pos_pools[pos].append(rec_out)

        # EPA + CPOE composite: standardized inside the season so eras line up
        qbs = [p for p in pos_pools.get('QB', []) if p['qualified']]
        for key, parts in (('comp', ('epadb', 'cpoe')),):
            vals = {k: [p['m'][k] for p in qbs if k in p['m']] for k in parts}
            stats = {k: (float(np.mean(v)), float(np.std(v)) or 1.0)
                     for k, v in vals.items() if len(v) > 3}
            if len(stats) == len(parts):
                for p in qbs:
                    if all(k in p['m'] for k in parts):
                        z = sum((p['m'][k] - stats[k][0]) / stats[k][1] for k in parts)
                        p['m'][key] = rnd(z / len(parts), 3)

        add_comps(players, pos_pools)
        block = dict(players=players)
        teams = team_block(S)
        if teams:
            block['tm'] = teams
        if S.lg:
            block['lg'] = {k: rnd(v, 4) for k, v in S.lg.items()}
        if lines:
            block['lines'] = lines
        rets = grade_returns(ret_rows, line_rows, players)
        if rets:
            block['ret'] = rets
        if y >= TIER_SINCE[5] and not S.has_part:
            # The rows marked est='live' in metrics.py are worked out from snap counts
            # until the lineup file for this season is published, which is after the
            # Super Bowl - a month after `week` below has gone. This says so for as long
            # as it is true, so the page does not present a January estimate as a count.
            block['est'] = 1
        if partial:
            # The page says "through week N" while this is set, and everything that has
            # to wait for a finished season keys off its presence.
            block['week'] = max(wk_done, 1)
            if wk > wk_done:
                block['weekPlaying'] = wk
        data[str(y)] = block
        season_list.append(str(y))
        print(y, len(players), 'players,', sum(1 for p in players if p['qualified']),
              'qualified', flush=True)

    cfg = dict(metrics=METRICS, panels=POS_PANELS, posLabel=POS_LABEL,
               groupLabel=GROUP_LABEL, headline=HEADLINE, weakDims=WEAK_DIMS,
               qualify={k: list(v) for k, v in QUALIFY.items()},
               qualifyFallback={k: list(v) for k, v in QUALIFY_FALLBACK.items()},
               tierSince=TIER_SINCE, denoms=DENOMS, denomCore=DENOM_CORE, teams=TEAMS,
               # one code per franchise in the data; `era` is what a club was called
               # before it moved, `alias` the codes an old link might still carry
               era={k: list(v) for k, v in ERA.items()}, alias=dict(CANON),
               season=season_list[-1] if season_list else None)
    out = dict(seasons=list(reversed(season_list)),
               generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               source='nflverse (nflfastR pbp, FTN charting, PFR advanced, Next Gen Stats, snap counts, combine, ESPN QBR)',
               cfg=cfg, data=data)

    # Savant value: the one number the All-Savant Team is picked on. It needs every
    # position's whole pool, so it is stamped on after the last player is built.
    import award
    print('Savant value on', award.stamp(out), 'player-seasons', flush=True)

    # Career awards, if awards.py has been run. They are career-level and keyed by player
    # id, so they ride along as one top-level map rather than on every player-season.
    awards_path = os.environ.get('NFL_AWARDS', os.path.join(AGG, 'awards.json'))
    if os.path.exists(awards_path):
        import patch_awards
        with open(awards_path) as f:
            n = patch_awards.attach(out, json.load(f))
        print('awards attached for', n, 'players', flush=True)
    else:
        print('no awards.json at', awards_path, '— run awards.py to add Pro Bowls, '
              'All-Pro, Hall of Fame and the individual honours', flush=True)

    with open(OUT, 'w') as f:
        json.dump(clean(out), f, separators=(',', ':'), allow_nan=False)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
