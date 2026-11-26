"""
build_page.py — Module 7: the files NBA GM Savant's page, connector and Data Room read, under public/gms/.

  index.json            every GM (one row per person, his spells), the headline boards (all-time, active), a board for
                        each skill, the executive tree, the repeatability verdicts, the page notes, model versions
  g/<person>.json       one GM: each spell's card (GM Value Added at 0/5/10/20%, the player-value line, produced,
                        inherited, left, luck, shared credit, the scouting report), the portfolio over time with his
                        big moves marked, inherited vs left behind, the trees of his biggest moves, every decision
                        with both grades, and for active GMs how much of today's roster he built and the picks he holds
  data/<table>/<season>.json + data/dictionary.json   the Data Room: gm_tenures, assets, asset_events, gm_decisions,
                        gm_seasons ("all" for the two without a season)

Percentiles: the headline only, against every ranked spell (two or more seasons in charge, 1979-80 on) and against
active GMs. Skills get no percentile: none repeats (repeat6.py), and re-signing waits for salaries.

    python3 build_page.py      # after grade.py, gm5.py, gm5_detail.py, repeat6.py
"""
import bisect, collections, datetime as dt, gzip, hashlib, json, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PUB = os.path.join(ROOT, 'public', 'gms')
import gm5  # noqa: E402
import gm5_detail  # noqa: E402  (each season's trade deadline)
import ledger_trees as LT  # noqa: E402
import salary_slots as SAL  # noqa: E402  (null until 1.1.0: SALARY_SLOTS.md)
from tenures import shift  # noqa: E402

GR = gm5.GR


def dump(obj, path):
    """Every file is served gzipped (vercel.json: /gms/*.json -> *.json.gz with Content-Encoding), like /cbcs/."""
    raw = json.dumps(obj, separators=(',', ':'), default=str, ensure_ascii=False, allow_nan=False).encode('utf8')   # NaN is not JSON: a browser would refuse the file
    with open(path + '.gz', 'wb') as f:
        f.write(gzip.compress(raw, 9, mtime=0))
VERSION = '1.0.1'
# the page's changelog (How it works); the site's What's New entry is src/data/updates.json
CHANGELOG = [
    ('1.0.0', '2026-11-24', 'Launch: every NBA GM since 1979-80 on points (GM Value Added) and titles (expected titles added), blended with a slider; every decision graded at the time and as it turned out, with luck and shared credit kept apart; asset trees, the executive tree, the Data Room tables and five connector tools; nightly updates.'),
    ('1.0.1', '2026-11-25', 'Display: wide tables scroll sideways with the GM\'s name pinned and open on their numbers (his teams and years follow them), so no column is cut off on a laptop or a phone; titles won are whole numbers, and a title shared within a season shows to one decimal with a marker that explains shared credit; expected titles to two decimals everywhere on the boards and cards. '
     'Data: moves the source listed twice are counted once. The 2011 Perkins trade (Boston and Oklahoma City) and the 2025 Huff trade (Memphis and Indiana) each appeared twice in the decision log; the 2024 Grimes trade (Dallas and Detroit) counted Miami\'s 2028 second-round pick twice; and eight waivers listed twice put the player back on the books to be waived again (only one grade changes: Rusty LaRue\'s 1999 waiver by Chicago). 32,495 decisions become 32,491. '
     'What changes: Troy Weaver\'s GM Value Added, 1,820.2 to 1,815.1 (-5.1); the Grimes trade at the time, Detroit -9.8 to -46.3 and Dallas +9.8 to +46.3, and as it turned out Detroit -84.0 to -120.1; the Perkins trade as it turned out, Boston +150.7 to +159.8 and Oklahoma City -150.7 to -159.8; LaRue\'s waiver, 1.4 to 3.0; blended values by 0.2 or less (the default blend rate moved 0.1); no top-20 rank. The old ids of the removed and renumbered decisions lead to the new ones. '
     'A daily refresh and a full rebuild now give identical numbers, and a nightly refresh with nothing new writes nothing.'),
    ('1.1.0', 'coming', 'Salaries from the Contract tab: value per dollar, cap hits, dead money, tax and apron status, years of control, and a cap outlook for every active GM.'),
]
K = '0.05'
SP = json.load(open(os.path.join(OUT, 'gm_spells.json')))
DET = {(d['person_id'], d['team'], d['start']): d for d in json.load(open(os.path.join(OUT, 'gm_detail.json')))}
REP = json.load(open(os.path.join(OUT, 'gm_repeatability.json')))
TEN = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
CRED = json.load(open(os.path.join(OUT, 'gm_credit.json')))
UNDER = json.load(open(os.path.join(OUT, 'gm_under.json')))
TREE = json.load(open(os.path.join(OUT, 'gm_tree.json')))
D = gm5.D
# decision ids that no longer exist, with the id now holding the same move (decision_ids_moved.json): a saved link or
# query that names an old id keeps working. A target that is missing, or an old id in use again, stops the build.
MOVED = {k: v['to'] for k, v in json.load(open(os.path.join(HERE, 'decision_ids_moved.json')))['moved'].items()}
TID = gm5.TID
# titles (titles.py, titles_dec.py, gm5.blend): each decision's expected titles both ways, and the default exchange rate
TITLES = json.load(open(os.path.join(OUT, 'gm_decision_titles.json')))
TMETA = json.load(open(os.path.join(OUT, 'gm_titles_meta.json')))
LAM = TMETA['lambda']
TODDS = json.load(open(os.path.join(OUT, 'title_odds.json')))
for _d in D:
    _d.update(TITLES.get(_d.get('decision_id'), {}))


def blend(points, titles):
    return None if points is None or titles is None else round(points + LAM * titles, 1)
# which skills repeat, and in how many of the five tests (the notes and explainers say it from this, not typed)
_TESTS = ('date', 'oddeven', 'stakes', 'stake-weighted', 'spell')
REPEAT_PASSES = {k.split('|')[0]: sum(1 for t in _TESTS if (v.get(t) or {}).get('lo', -1) > 0) for k, v in REP['results'].items() if k.endswith('|turned_out')}
REPEATING = sorted(k for k, v in REP['results'].items() if k.endswith('|turned_out') and v.get('verdict', '').startswith('skill'))
REPEATING = [k.split('|')[0] for k in REPEATING]
NUMBER = ('no', 'one', 'two', 'three', 'four', 'five')


def _verdicts(grade):
    return {k.split('|')[0]: v.get('verdict', '') for k, v in REP['results'].items() if k.endswith('|' + grade)}


def _names(xs):
    xs = [{'re-signing and extensions': 're-signing'}.get(x, x) for x in xs]
    return xs[0] if len(xs) == 1 else ', '.join(xs[:-1]) + ' and ' + xs[-1]


def repeat_sentence():
    """From repeat6's verdicts (a skill repeats when both the date split and the alternating split agree), as it
    turned out and at the time; skills that pass only some tests are named as unclear. Never typed."""
    to, at = _verdicts('turned_out'), _verdicts('at_time')
    rep = sorted(k for k, v in to.items() if v.startswith('skill'))
    rep_at = sorted(k for k, v in at.items() if v.startswith('skill') and k not in rep)
    unclear = sorted(k for k, v in to.items() if v.startswith('unclear'))
    out = ('Only ' + _names(rep) + (' repeats' if len(rep) == 1 else ' repeat') + ' as it turned out') if rep else 'No skill repeats as it turned out'
    if rep_at:
        out += '; at the time, ' + _names(rep_at) + (' does' if len(rep_at) == 1 else ' do')
        if 'drafting' in rep_at:
            out += ', which says GMs keep agreeing or disagreeing with the boards, not that their picks keep beating them'
    if unclear:
        out += '; ' + _names(unclear) + (' passes' if len(unclear) == 1 else ' pass') + ' some tests but not both splits'
        if 're-signing and extensions' in unclear:
            out += ', and re-signing likely reflects having stars to re-sign'
    return out


# Teams by their name at the time (Seattle SuperSonics, New Jersey Nets, Charlotte Bobcats): the name the season's
# transaction page links each franchise under, its most common one that season.
def _team_names():
    import html as H, pagefacts
    from tenures import franchise
    c = collections.defaultdict(collections.Counter)
    for y, ab, nm in pagefacts.team_links():
        f = 'CHO' if ab == 'CHA' else franchise(ab)
        if f:
            c[(f, y)][H.unescape(nm)] += 1
    return {k: v.most_common(1)[0][0] for k, v in c.items() if v.most_common(1)[0][1] >= 2}


TEAM_NAMES = _team_names()


def team_name(team, day):
    """The franchise's name in the season of `day` (a season whose pages never link it, like an expansion team's first:
    the nearest season's name, earlier first)."""
    y = GR.season_of(day)
    for k in range(0, 60):
        for yy in (y - k, y + k):
            if (team, yy) in TEAM_NAMES:
                return TEAM_NAMES[(team, yy)]
    return team


def spell_team_name(team, start, end):
    """Its names over a spell, in order ("New Jersey Nets / Brooklyn Nets" for one that crossed the move)."""
    names = []
    for y in range(GR.season_of(start), min(GR.season_of(end or GR.TODAY), GR.NOW_SEASON) + 1):
        n = team_name(team, f'{y - 1}-12-01')
        if n not in names:
            names.append(n)
    return ' / '.join(names) or team


def implied_discount():
    """What trades of one pick for a later pick of the same round imply about the discount teams apply: the team taking
    the later pick gave up the earlier one, so (1 + r) ** years = later's value / earlier's, each as the pick model priced
    it that day (undiscounted, ten seasons). A pick whose owner the source does not state is taken to be the giving
    team's own, as Basketball-Reference writes it. Measured on every build: (median r, how many trades)."""
    rs = []
    for tx, t in GR.TR.items():
        moves = [e for e in GR.BYTX.get(tx, []) if e['kind'] == 'trade']
        if len(moves) != 2 or not all(e['asset'].startswith('pick:') for e in moves):
            continue
        a, b = moves
        if a['from'] != b['to'] or a['to'] != b['from']:
            continue
        pa, pb = GR.A.get(a['asset'], {}), GR.A.get(b['asset'], {})
        if not pa.get('year') or not pb.get('year') or pa['year'] == pb['year'] or pa.get('round') != pb.get('round') or pa.get('round') not in (1, 2):
            continue
        day = t.get('agreed') or t['date']

        def val(p, giver):
            owner, prot = GR.SN.pick_inputs(p, day, GR.DRAFT_DATE.get(p['year']))
            return GR.SN.pick_value(p['year'], p['round'], owner or giver, day, prot)['expected_v10']
        (early, eg), (late, lg) = sorted(((pa, a['from']), (pb, b['from'])), key=lambda x: x[0]['year'])
        ve, vl = val(early, eg), val(late, lg)
        if ve > 0 and vl > 0:
            rs.append((vl / ve) ** (1 / (late['year'] - early['year'])) - 1)
    rs.sort()
    return (rs[len(rs) // 2] if rs else None), len(rs)


DISCOUNT_IMPLIED, DISCOUNT_N = implied_discount()
FIRST_CURVE = json.load(open(os.path.join(OUT, 'models', 'picks_1990.json')))      # the earliest pick curve (drafts before 1990 use it)

def _skill():
    rep = open(os.path.join(OUT, 'title_report.txt')).read()
    m = re.search(r'skill against best record: \+([\d.]+)%', rep)
    return float(m.group(1)) if m else 0.0


def _calib():
    """The title model's calibration buckets as titles.calibration printed them: [{lo, hi, teams, expected, won}]."""
    rep = open(os.path.join(OUT, 'title_report.txt')).read()
    rows = re.findall(r'^\s*(\d+)% to\s+(\d+)%\s+(\d+)\s+([\d.]+)\s+(\d+)\s*$', rep, re.M)
    out = [{'lo': int(a), 'hi': int(b), 'teams': int(n), 'expected': float(e), 'won': int(w)} for a, b, n, e, w in rows]
    assert len(out) == 5, 'title_report.txt calibration table not found'
    return out


NOTES = [
    ('Production', "Production is the team's scoring margin, with opponents' three-point and free-throw shooting moved 30%% of the way to the league average (Basketball-Reference opponent totals; 30%% is the share that best predicts a team's second half from its first, measured out of sample: the rest of opponents' shooting persists, more like defense than luck), at %.1f value points per point of margin, measured. Margin includes coaching." % gm5.ADJ_TO_VALUE),
    ('The player-value line', 'The second line counts production as Savant player value above the league average team instead of margin.'),
    ('Decision grades', 'Decision grades use Savant player value, which undersells defenders, until RAPM is part of Savant value.'),
    ('Defense before 2007-08', 'Savant value before 2007-08 counts defense only through steals, blocks and rebounds.'),
    ('Free-agency departures', 'A player who left in free agency before playing a game for the next GM counts in neither what one GM left nor what the other inherited.'),
    ('Re-signing', 'Re-signings are credited with the value of the player kept, so the number may reflect the stars he had. A percentile waits until salaries let us test value against cost.'),
    ('Skills', f"{repeat_sentence()} (repeatability tests on this page), so skills are shown as what happened, without percentiles. Skills overlap, so they don't add up to GM Value Added."),
    ('Early era', 'Before 1985 there were not enough earlier seasons to grade a decision at the time; drafts before 1990 are graded on how they turned out only.'),
    ('Protections', 'Pick protections before 2017 are hand-filled from press coverage for the biggest trades; elsewhere an unknown protection makes the at-the-time grade low confidence.'),
    ('Transactions before 2000', "Moves before 2000 come from Basketball-Reference, checked against who actually played for each team."),
    ('Salaries', 'Value is counted without what he was paid. Salaries arrive in NBA GM Savant 1.1.0 from the Contract tab: value per dollar, cap hits, dead money, tax and apron status, and years of control, which will move what a GM inherited and left.'),
    ('Shared credit', 'Credit is split where two people ran the team at once or the handover date is not known; a No. 2 is shown under his lead and not counted.'),
    ('Titles', f"Expected titles come from simulating every season since 1979-80 on its real schedule, seeding, play-in and bracket, the regular season from the same strength as the points (30% of opponents' shooting luck taken out), the playoffs from the raw margin blended with each team's preseason projection (it won an out-of-sample test against the luck-adjusted rating and other versions); the chances add up to one each season and beat \"best record wins\" by {_skill():.0f}% on Brier score. Expected titles added follows the points: titles above an average team's while he ran it, plus the titles of the roster he left, minus those of the roster he inherited."),
    ('The blend', f"Blended = points + {LAM:,.0f} x expected titles added: at that rate points and titles each account for half of the spread across every GM spell, so one title = {LAM:,.0f} points (about {LAM / GR.POINTS_PER_WIN:.0f} wins). The slider moves from wins only to titles only."),
    ('Decision titles', "A decision's expected titles are with it minus without it, season by season, with the team moved along the measured curve from player value to margin (more value on a strong team buys less margin); a GM's are his teams' title chances shared out. The two answer different questions, so decisions' titles do not add up to a GM's."),
    ('Playoff luck', 'Titles won minus expected titles: how much the bounces, injuries and matchups of the playoffs gave or took. It sits with the other luck and is not part of expected titles added.'),
    ('Built for the playoffs', 'Tested and not used: neither the share of a team\'s value in its top seven or eight players nor the share in its top two or three stars predicted playoff games beyond its season strength, out of sample.'),
    ('Discount', f'Ten seasons of projected value, 5% a year; 0%, 10% and 20% are shown. Trades of one pick for a later pick in the same round imply about {100 * (DISCOUNT_IMPLIED or 0):.0f}% a year (median of {DISCOUNT_N} trades), so the rate is a choice, not a measurement.'),
]
SKILL_LABEL = {'drafting': 'Drafting (against the board, else the slot)', 'second-round finds': 'Second-round finds',
               'deviation success': 'Picks off the board, against the player passed on', 'fit picks': 'Fit picks (inferred from roster needs)',
               'holding': 'Holding young players', 'trades': 'Trades', 'free agency': 'Free agency',
               'role players': 'Role players', 're-signing and extensions': 'Re-signing and extensions', 'coach hiring': 'Coach hiring and firing'}


def season_label(y):
    return f'{y - 1}-{str(y)[2:]}'




def pid_num(aid):
    p = GR.pid_of(aid) if aid and aid.startswith('player:') else None
    return p if isinstance(p, int) else None


def did(d):
    if d.get('decision_id'):
        return d['decision_id']
    key = '|'.join(str(d.get(k)) for k in ('type', 'team', 'agreed', 'tx', 'asset', 'coach_id', 'slot'))
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def credited(d, pid):
    return sum(p['weight'] for p in d['credit']['people'] if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == pid)


def short(aid):
    a = GR.A.get(aid, {})
    if a.get('kind') == 'player':
        return a.get('name') or aid
    if a.get('kind') == 'pick':
        r = {1: '1st', 2: '2nd'}.get(a.get('round'), f"round-{a.get('round')}")
        own = f"{a['original_owner']} " if a.get('original_owner') else ''
        s = f"{own}{a.get('year') or 'undated'} {r}"
        return s + (f" ({a['became_name']})" if a.get('became_name') else '')
    if a.get('kind') == 'swap':
        return f"{a.get('year')} pick swap"
    return a.get('kind') or aid


def listing(aids, n=5):
    xs = [short(a) for a in aids]
    return ', '.join(xs[:n]) + (f' and {len(xs) - n} more' if len(xs) > n else '') if xs else 'nothing'


def decision_label(d):
    if d['type'] in ('trade', 'sign-and-trade') and (d.get('in') or d.get('out')):
        return f"Traded {listing(d['out'])} for {listing(d['in'])}" + (' (sign-and-trade)' if d['type'] == 'sign-and-trade' else '')
    if d['type'] == 'draft':
        return f"Drafted {d['player']} at No. {d['slot']}"
    if d['type'] in ('coach hire', 'coach firing'):
        return ('Hired ' if d['type'] == 'coach hire' else 'Fired ') + d['coach'] + (f" (replaced by {d['replacement']})" if d.get('replacement') else '')
    if d.get('text'):
        return d['text']
    verb = {'signing': 'Signed', 're-signing': 'Re-signed', 'extension': 'Extended', 'left in free agency': 'Left in free agency:', 'waiver': 'Waived', 'release': 'Released',
            'waiver claim': 'Claimed'}.get(d['type'], d['type'])
    return f"{verb} {d.get('player') or d.get('asset')}"


def asset_label(aid):
    return LT.label(aid)


def asset_ref(aid):
    a = GR.A.get(aid, {})
    r = {'id': aid, 'label': asset_label(aid), 'kind': a.get('kind')}
    if pid_num(aid):
        r['player_id'] = pid_num(aid)
    if a.get('kind') == 'pick' and a.get('became'):
        b = GR.pid_of('player:' + a['became'])
        if isinstance(b, int):
            r['became_id'] = b
    if a.get('protection_source'):
        r['protection_source'] = a['protection_source']['url']
    return r


# ---------------------------------------------------------------- trees, structured
def tree(node, since, holder, depth=3, seen=None, came_in=None):
    seen = seen if seen is not None else set()
    out = []
    by_tx = collections.defaultdict(list)
    for b, tx, how in LT.fwd.get(node, []):
        if LT.txdate(tx) < since or (node, tx) in seen or tx == came_in:
            continue
        frm, to = LT.giver(node, tx)
        if frm != holder:
            continue
        by_tx[(tx, how)].append(b)
    for (tx, how), kids in sorted(by_tx.items(), key=lambda x: LT.txdate(x[0][0])):
        seen.add((node, tx))
        frm, to = LT.giver(node, tx)
        sent = sorted({a for a, b2, t2, h2 in LT.X if t2 == tx and h2 != 'became' and a != node and LT.giver(a, tx)[0] == holder})
        step = {'date': LT.txdate(tx), 'how': 'became' if how == 'became' else 'traded', 'to': to, 'sent_with': [asset_ref(a) for a in sent], 'got': []}
        for b in sorted(set(kids)):
            g = asset_ref(b)
            if depth > 1:
                g['then'] = tree(b, LT.txdate(tx), holder, depth - 1, seen, came_in=tx)
            step['got'].append(g)
        out.append(step)
    return out


def move_tree(d):
    """For a trade: each asset he got, and what the team did with it after. For a draft pick: the player, and after."""
    if d['type'] in ('trade', 'sign-and-trade'):
        return {'gave': [asset_ref(a) for a in d['out']], 'got': [dict(asset_ref(a), then=tree(a, d['date'], d['team'], 3)) for a in d['in']]}
    if d['type'] == 'draft' and d.get('player_id'):
        aid = next((a for a, x in GR.A.items() if x.get('kind') == 'player' and GR.pid_of(a) == d['player_id']), None)
        if aid:
            return {'gave': [], 'got': [dict(asset_ref(aid), then=tree(aid, d['date'], d['team'], 3))]}
    return None


# ---------------------------------------------------------------- portfolio
def portfolio_dates(sp):
    start, end = sp['start'], sp['end'] or GR.TODAY
    ds = {start, end}
    for y in range(int(start[:4]), int(end[:4]) + 1):
        for md in ('-07-01', '-02-01'):
            d = f'{y}{md}'
            if start < d < end:
                ds.add(d)
    return sorted(ds)


def value_of(aids, d, team):
    y0 = GR.season_of(d)
    out = []
    for a in aids:
        if not (a.startswith('player:') or a.startswith('pick:')):
            continue
        if a.startswith('player:') and gm5.walks_first(a, d, team):
            continue
        s, e = gm5.asset_seasons(a, d)
        v = sum(x / 1.05 ** (y - y0) for y, x in s.items() if y0 <= y < y0 + GR.HORIZON)
        if v > 0.5:
            out.append((round(v, 1), a))
    return sorted(out, reverse=True)


def value_to(aids, d, team, games_from=None):
    """value_of, as it turned out: what the team got from each asset (production for it, then what it was traded for;
    picks at the slot once used), the basis of a finished tenure's headline (gm5.realized_rates, asset by asset)."""
    y0 = GR.season_of(d)
    g = gm5.season_games(team, y0)
    after = (sum(1 for x in g if x >= d) / len(g)) if g else 1.0
    out = []
    for a in aids:
        if not (a.startswith('player:') or a.startswith('pick:')):
            continue
        if a.startswith('player:') and gm5.walks_first(a, d, team, games_from):
            continue
        v = 0.0
        for y, x in GR.rv(a, team, d):
            if y0 <= y < y0 + GR.HORIZON:
                x = x * after if y == y0 and a.startswith('player:') and not GR.rights_window(a, d) else x
                v += x / 1.05 ** (y - y0)
        if abs(v) > 0.5:
            out.append((round(v, 1), a))
    return sorted(out, reverse=True)


def inherited_note(name, card):
    """One sentence when what he took over drives his number: inherited is at least twice everything else in it combined
    (his production and what he left). Names the players who made up most of it, up to three."""
    inh, left, prod = card['inherited']['0.05'], card['left']['0.05'], card['produced_margin_adj']
    if inh < 1000 or inh < 2 * (abs(prod) + max(left, 0)):
        return None
    players = [x for x in card['inherited_list'] if x['kind'] == 'player' and x['value'] > 0]
    top, run = [], 0.0
    for x in players[:3]:
        if top and (x['value'] < 0.25 * players[0]['value'] or run >= 0.6 * inh):
            break
        top.append(x['label']); run += x['value']
    if not top:
        return None
    names = top[0] if len(top) == 1 else ', '.join(top[:-1]) + ' and ' + top[-1]
    last = name.split()[-1]
    return f"{last} inherited {names}; this number credits only what he added beyond the roster he took over."


def spans(ys):
    out, run = [], []
    for y in sorted(ys):
        if run and y == run[-1] + 1:
            run.append(y)
        else:
            if run:
                out.append(run)
            run = [y]
    if run:
        out.append(run)
    parts = [str(r[0]) if len(r) == 1 else f'{r[0]}-{r[-1]}' for r in out]
    return parts[0] if len(parts) == 1 else ', '.join(parts[:-1]) + ' and ' + parts[-1]


def board_years():
    import consensus
    return spans(int(y) for y, b in consensus.BOARDS.items() if b['n_sources'] >= 2)


def board_sources():
    import consensus
    n = collections.Counter(s for b in consensus.BOARDS.values() if b['n_sources'] >= 2 for s in b['sources'])
    return ', '.join(f'{s} ({c})' for s, c in n.most_common())


# ---------------------------------------------------------------- active: today's roster and picks
LAST_IN = {}
for e in sorted(GR.E, key=lambda e: e['date']):
    if e['to'] not in ('POOL', 'RETIRED', 'DRAFT', 'OPENING'):
        LAST_IN[(e['asset'], e['to'])] = e['date']


def built_share(sp):
    y = GR.NOW_SEASON
    tot, mine, rows = 0.0, 0.0, []
    for (pid, yy), sh in GR.SHARE.items():
        if yy != y or sp['team'] not in sh:
            continue
        aid = next((a for a in GR.PID2AID.get(pid, [])), None) if hasattr(GR, 'PID2AID') else None
        w = sh[sp['team']]
        tot += w
        came = LAST_IN.get((aid, sp['team'])) if aid else None
        if came and came >= sp['start']:
            mine += w
        rows.append((w, pid, came))
    return (round(mine / tot, 3) if tot else None), len(rows)


def main():
    os.makedirs(os.path.join(PUB, 'g'), exist_ok=True)
    os.makedirs(os.path.join(PUB, 'data'), exist_ok=True)
    if not hasattr(GR, 'PID2AID'):
        GR.PID2AID = collections.defaultdict(list)
        for a, x in GR.A.items():
            if x.get('kind') == 'player':
                p = GR.pid_of(a)
                if isinstance(p, int):
                    GR.PID2AID[p].append(a)
    ranked = [r for r in SP if r['ranked']]
    vals_all = sorted(r['gm_value_added'][K] for r in ranked)
    vals_act = sorted(r['gm_value_added'][K] for r in ranked if r['active'])
    vals_blend = sorted(r['blended'] for r in ranked)
    vals_titles = sorted(r['titles_added'] for r in ranked)
    pct = lambda v, xs: round(100 * bisect.bisect_left(xs, v) / max(1, len(xs) - 1))
    by_person = collections.defaultdict(list)
    for r in SP:
        by_person[r['person_id']].append(r)
    # decisions credited, by person
    dec_by = collections.defaultdict(list)
    for d in D:
        for p in d['credit']['people']:
            pid = TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id'])
            dec_by[pid].append((d, p['weight']))
    # portfolio queries, one pass
    q = []
    for r in SP:
        q += [(x, r['team']) for x in portfolio_dates(r)]
    H = gm5.holdings(q)
    print('portfolio holdings', len(H), flush=True)
    people = []
    for pid, spells in sorted(by_person.items(), key=lambda x: x[1][0]['person']):
        name = spells[0]['person']
        cards = []
        for r in sorted(spells, key=lambda r: r['start']):
            key = (r['person_id'], r['team'], r['start'])
            det = DET.get(key, {})
            ranked_ = r['ranked']
            card = {k: r[k] for k in ('team', 'start', 'end', 'active', 'seasons', 'ranked', 'early_era', 'n_decisions', 'shared', 'gm_value_added', 'gm_value_added_player',
                                      'gm_value_added_per_season', 'produced_margin_adj', 'produced_above_average', 'inherited', 'left', 'walked_before_inherited', 'walked_before_left', 'luck_gap',
                                      'gm_value_added_turned_out', 'inherited_turned_out', 'left_turned_out', 'headline_basis',
                                      'gm_value_added_at_time', 'inherited_at_time', 'left_at_time',
                                      'titles_added', 'titles_added_at_time', 'titles_added_turned_out', 'titles_produced_above_average', 'titles_expected', 'titles_won',
                                      'playoff_luck', 'titles_inherited', 'titles_left', 'titles_inherited_at_time', 'titles_left_at_time', 'blended', 'titles_by_season') if k in r}
            card['blended_at_time'] = blend(r['gm_value_added_at_time'][K], r['titles_added_at_time'])
            card['pct_blended'] = pct(r['blended'], vals_blend) if ranked_ else None
            card['pct_titles'] = pct(r['titles_added'], vals_titles) if ranked_ else None
            card['pct_all'] = pct(r['gm_value_added'][K], vals_all) if ranked_ else None
            card['pct_active'] = pct(r['gm_value_added'][K], vals_act) if ranked_ and r['active'] else None
            card['detail'] = det
            # shared credit and under records inside the spell
            end = r['end'] or GR.TODAY
            card['team_name'] = spell_team_name(r['team'], r['start'], r['end'])
            card['splits'] = [{'from': s['from'], 'to': s['to'], 'people': [(p['person'], p['weight']) for p in s['people']], 'why': s.get('split'), 'source': s.get('source')}
                              for s in CRED.get(r['team'], []) if s['to'] >= r['start'] and s['from'] <= end and len(s['people']) > 1]
            card['leads_over'] = sorted({u['person'] for u in UNDER if u['team'] == r['team'] and u['under'] == name and u['to'] >= r['start'] and u['from'] <= end})
            # portfolio
            series = []
            for x in portfolio_dates(r):
                held = value_of(H[(x, r['team'])], x, r['team'])
                series.append({'date': x, 'value': round(sum(v for v, a in held), 1), 'players': round(sum(v for v, a in held if a.startswith('player:')), 1),
                               'picks': round(sum(v for v, a in held if a.startswith('pick:')), 1), 'top': [asset_label(a) for v, a in held[:4]]})
            card['portfolio'] = series
            first, last = portfolio_dates(r)[0], portfolio_dates(r)[-1]
            # the lists on the headline's basis: as it turned out for a finished tenure, projected for an active one
            if r['active']:
                card['inherited_list'] = [dict(asset_ref(a), value=v, years_of_control=SAL.asset(a, first)) for v, a in value_of(H[(first, r['team'])], first, r['team'])[:14]]
                card['left_list'] = [dict(asset_ref(a), value=v, years_of_control=SAL.asset(a, last)) for v, a in value_of(H[(last, r['team'])], last, r['team'])[:14]]
            else:
                card['inherited_list'] = [dict(asset_ref(a), value=v, years_of_control=SAL.asset(a, first)) for v, a in value_to(H[(first, r['team'])], first, r['team'])[:14]]
                card['left_list'] = [dict(asset_ref(a), value=v, years_of_control=SAL.asset(a, last)) for v, a in value_to(H[(last, r['team'])], last, r['team'], last)[:14]]
            card['inherited_note'] = inherited_note(name, card)
            decs = [(d, w) for d, w in dec_by[pid] if d['team'] == r['team'] and r['start'] <= d['agreed'] <= end]
            big = sorted([x for x in decs if x[0]['type'] in ('trade', 'sign-and-trade', 'draft')], key=lambda x: -abs((x[0]['turned_out'] or 0) * x[1]))[:6]
            card['big_moves'] = [{'id': did(d), 'date': d['agreed'], 'label': decision_label(d), 'at_time': d['at_time'], 'turned_out': d['turned_out'], 'weight': w,
                                  'titles_at_time': d.get('titles_at_time'), 'titles_turned_out': d.get('titles_turned_out'), 'blended': blend(d['turned_out'], d.get('titles_turned_out')),
                                  'tree': move_tree(d)} for d, w in big]
            card['marks'] = [{'date': d['agreed'], 'label': decision_label(d)[:90], 'turned_out': round((d['turned_out'] or 0) * w, 1)} for d, w in
                             sorted(decs, key=lambda x: -abs((x[0]['turned_out'] or 0) * x[1]))[:10]]
            if r['active']:
                share, n = built_share(r)
                card['roster_built'] = share
                today = H.get((last, r['team'])) or []
                card['picks_owned'] = [dict(asset_ref(a), value=v) for v, a in value_of(today, last, r['team']) if a.startswith('pick:')]
            card.update(SAL.spell(r))          # payroll, tax, dead money, value per dollar, cap outlook: null until 1.1.0
            card['report'] = scouting(name, r, card, det, decs)
            cards.append(card)
        log = [{'id': did(d), 'date': d['agreed'], 'official': d['date'], 'type': d['type'], 'team': d['team'], 'team_name': team_name(d['team'], d['agreed']), 'label': decision_label(d), 'weight': w,
                'source_text': d.get('text'), 'at_time': d['at_time'], 'turned_out': d['turned_out'], 'at_time_note': d.get('at_time_note'), 'low_confidence': d['low_confidence'],
                'models': d.get('models'), 'frozen_on': d.get('frozen_on'), 'grade_version': GR.VERSION, 'player_id': d.get('player_id') or pid_num(d.get('asset') or ''),
                'coach_id': d.get('coach_id'), 'in': [asset_ref(a) for a in d.get('in', [])], 'out': [asset_ref(a) for a in d.get('out', [])],
                'grade_label': d.get('grade_label'), 'best_available': d.get('best_available'), 'best_available_rank': d.get('best_available_rank'),
                'consensus_rank': d.get('consensus_rank'), 'easy_pick': d.get('easy_pick'),
                'titles_at_time': d.get('titles_at_time'), 'titles_turned_out': d.get('titles_turned_out'),
                'blended_at_time': blend(d['at_time'], d.get('titles_at_time')), 'blended_turned_out': blend(d['turned_out'], d.get('titles_turned_out')), **SAL.decision(d)}
               for d, w in sorted(dec_by[pid], key=lambda x: x[0]['agreed'])]
        coach = next((t.get('coach_id') for t in TEN if t['person_id'] == pid and t.get('coach_id')), None)
        g = {'id': pid, 'name': name, 'coach_id': coach, 'spells': cards, 'decisions': log,
             'under': [dict(u, team_name=spell_team_name(u['team'], u['from'], u.get('to'))) for u in UNDER if u['person'] == name], 'tree': [e for e in TREE if name in (e['junior'], e['senior'])], 'version': VERSION}
        dump(g, os.path.join(PUB, 'g', f'{safe(pid)}.json'))
        people.append({'id': pid, 'file': safe(pid), 'name': name, 'active': any(c['active'] for c in cards), 'coach_id': coach, 'photo': photo(safe(pid)),
                       'spells': [{k: c[k] for k in ('team', 'team_name', 'start', 'end', 'active', 'seasons', 'ranked', 'pct_all', 'pct_active', 'gm_value_added_per_season', 'early_era', 'shared')}
                                  | {'gva': c['gm_value_added'][K], 'player_line': c['gm_value_added_player'][K], 'titles_added': c['titles_added'], 'blended': c['blended'],
                                     'pct_blended': c['pct_blended']} for c in cards]})
    # boards
    def board(rows, n=None, key='gm_value_added', vals=None):
        at = key == 'gm_value_added_at_time'
        bl = (lambda r: blend(r[key][K], r['titles_added_at_time'])) if at else (lambda r: r['blended'])
        rows = sorted(rows, key=lambda r: -bl(r))              # ranked by the blend at the default
        vals = vals if vals is not None else vals_all
        return [{'id': r['person_id'], 'file': safe(r['person_id']), 'name': r['person'], 'team': r['team'], 'team_name': spell_team_name(r['team'], r['start'], r['end']), 'start': r['start'], 'end': r['end'], 'seasons': r['seasons'],
                 'gva': r[key][K], 'per_season': round(r[key][K] / max(r['seasons'], 0.25), 1), 'player_line': r['gm_value_added_player'][K],
                 'at_the_time': r['gm_value_added_at_time'][K], 'headline': r['gm_value_added'][K], 'basis': r['headline_basis'], 'rates': r[key], 'pct_all': pct(r[key][K], vals),
                 'active': r['active'], 'titles_added': r['titles_added_at_time'] if at else r['titles_added'], 'titles_won': r['titles_won'], 'titles_expected': r['titles_expected'],
                 'playoff_luck': r['playoff_luck'], 'blended': bl(r)} for r in (rows[:n] if n else rows)]
    vals_at = sorted(r['gm_value_added_at_time'][K] for r in ranked)
    skills = {}
    for sk, label in SKILL_LABEL.items():
        rows = []
        for r in ranked:
            det = DET.get((r['person_id'], r['team'], r['start']), {})
            v = skill_total(sk, det)
            if v is not None:
                rows.append({'id': r['person_id'], 'file': safe(r['person_id']), 'name': r['person'], 'team': r['team'], 'team_name': spell_team_name(r['team'], r['start'], r['end']), 'start': r['start'], 'end': r['end'], 'active': r['active'], 'value': v})
        skills[sk] = {'label': label, 'verdict': verdict(sk), 'rows': sorted(rows, key=lambda x: -x['value'])}
    passes, repeating = REPEAT_PASSES, REPEATING
    live = {did(d) for d in D}
    bad = [f'{o} -> {n}' for o, n in MOVED.items() if n not in live] + [f'{o} is a live id again' for o in MOVED if o in live]
    if bad:
        raise SystemExit('decision_ids_moved.json: ' + '; '.join(bad))
    through = max(d['date'] for d in D)
    games_through = max(d for v in gm5.G.values() for ds in v.values() for d in ds if d <= GR.TODAY)
    idx = {'meta': {'version': VERSION, 'generated': dt.datetime.utcnow().isoformat(timespec='seconds') + 'Z', 'through': through, 'games_through': games_through,
                    'grade_version': GR.VERSION, 'moved_ids': MOVED, 'known_gaps': json.load(open(os.path.join(OUT, 'conservation.json'))).get('known', []), 'value_per_margin_point': round(gm5.ADJ_TO_VALUE, 1), 'points_per_win': GR.POINTS_PER_WIN,
                    'pool_all': f'every GM spell of two or more seasons in charge, 1979-80 to {season_label(GR.NOW_SEASON)} ({len(vals_all)} spells; finished ones as they turned out, active ones on projection)',
                    'pool_active': f'active GMs with two or more seasons in charge ({len(vals_act)})',
                    'pool_at_time': f'every GM spell of two or more seasons in charge, all on projection ({len(vals_at)} spells)',
                    'headline_rule': 'finished tenures as they turned out; active GMs on projection',
                    'discount_implied': None if DISCOUNT_IMPLIED is None else round(DISCOUNT_IMPLIED, 3), 'discount_trades': DISCOUNT_N,
                    'repeating_skills': repeating, 'repeat_tests_passed': passes, 'repeat_sentence': repeat_sentence(), 'min_seasons': gm5.MIN_SEASONS,
                    'first_pick_curve_drafts': '%d-%s' % (FIRST_CURVE['drafts'][0], str(FIRST_CURVE['drafts'][-1])[2:]),
                    'deadlines': {str(y): d for y, d in sorted(gm5_detail.DEADLINE.items())}, 'notes': NOTES,
                    'board_drafts': board_years(), 'board_sources': board_sources(), 'salaries': SAL.meta(), 'changelog': CHANGELOG,
                    'titles': {'lambda': LAM, 'wins_per_title': round(LAM / GR.POINTS_PER_WIN, 1), 'corr_points_titles': TMETA['corr_points_titles'],
                               'rule': TMETA['rule'], 'top_heavy_used': TODDS['top_heavy_used'], 'brier_skill_vs_best_record': _skill(), 'calibration': _calib(),
                               'seasons': f"{min(TODDS['seasons'])} to {max(TODDS['seasons'])}"}},
           'people': people, 'boards': {'all': board(ranked), 'active': board([r for r in ranked if r['active']]),
                                        'at_time': board(ranked, key='gm_value_added_at_time', vals=vals_at)}, 'skills': skills,
           'repeatability': {k: {kk: vv for kk, vv in v.items()} for k, v in REP['results'].items()}, 'tree': TREE}
    # `generated` is when this content was made: a rebuild that changes nothing else keeps the old stamp, so the file
    # stays byte-identical and a refresh with no news commits nothing (Nov 25, 2026)
    try:
        with gzip.open(os.path.join(PUB, 'index.json.gz'), 'rt', encoding='utf8') as f:
            old = json.load(f)
        new = json.loads(json.dumps(idx, default=str, ensure_ascii=False))      # as it will be written
        new['meta']['generated'] = old['meta']['generated']
        if old['meta'].get('generated') and new == old:
            idx['meta']['generated'] = old['meta']['generated']
    except (OSError, ValueError, KeyError):
        pass
    dump(idx, os.path.join(PUB, 'index.json'))
    print('people', len(people), '| through', through, flush=True)
    dataroom(dec_by)


PHOTOS = os.path.join(ROOT, 'public', 'gm-photos')


def photo(file):
    """A photo Adam has added to public/gm-photos/ (<gm id>.jpg/.png/.webp), shown only with its credit line in
    public/gm-photos/credits.json ({"<file name>": "credit"}). Nothing is ever fetched; no file means the monogram."""
    try:
        credits = json.load(open(os.path.join(PHOTOS, 'credits.json')))
    except (OSError, ValueError):
        credits = {}
    for ext in ('jpg', 'jpeg', 'png', 'webp'):
        f = f'{file}.{ext}'
        if os.path.exists(os.path.join(PHOTOS, f)):
            if credits.get(f):
                return {'src': f'/gm-photos/{f}', 'credit': credits[f]}
            print(f'photo {f} has no credit line in gm-photos/credits.json: not shown', flush=True)
    return None


def safe(pid):
    return re.sub(r'[^A-Za-z0-9_-]+', '_', pid)


def skill_total(sk, det):
    if not det:
        return None
    return {'drafting': det['drafting']['over_slot'] if det['drafting']['picks'] else None, 'second-round finds': det['drafting']['second_round_finds'] if det['drafting']['picks'] else None,
            'trades': det['trades']['turned_out'] if det['trades']['n'] else None, 'free agency': det['free_agency']['stars'] + det['free_agency']['role'],
            'role players': det['role_players'], 're-signing and extensions': det['re_signing'], 'coach hiring': det['coach_hiring'],
            'holding': det['holding']['turned_out'] if det.get('holding', {}).get('holds') else None,
            'deviation success': det['draft_style']['deviation_value'] if (det.get('draft_style') or {}).get('deviations') else None,
            'fit picks': det['draft_style']['fit']['value_vs_best_available'] if (det.get('draft_style') or {}).get('fit', {}).get('n') else None}.get(sk)


def verdict(sk):
    r = REP['results'].get(f'{sk}|turned_out', {})
    v = r.get('verdict', 'not testable')
    if sk == 're-signing and extensions':
        n = sum(1 for t in ('date', 'oddeven', 'stakes', 'stake-weighted', 'spell') if (r.get(t) or {}).get('lo', -1) > 0)
        return f"repeats in {('no', 'one', 'two', 'three', 'four', 'five')[n]} of five tests, which likely reflects having stars to re-sign: no percentile until salaries"
    return 'describes what happened (does not repeat)' if not v.startswith('skill') else v


def fmt(v):
    return f'{v:+,.0f}'


def spell_seasons(r):
    """[(season, his share of its games, production in points: luck-adjusted margin x value per point x share)]"""
    segs = sorted((sg['from'], sg['to'], p['weight']) for sg in CRED.get(r['team'], []) for p in sg['people']
                  if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == r['person_id'] and sg['to'] >= r['start'] and sg['from'] <= (r['end'] or GR.TODAY))
    out = []
    for y in range(GR.season_of(r['start']), min(GR.season_of(r['end'] or GR.TODAY), GR.NOW_SEASON) + 1):
        dates = gm5.season_games(r['team'], y)
        if not dates or not segs:
            continue
        share = sum(gm5.weight_on(segs, x) for x in dates) / len(dates)
        if share > 0:
            out.append((y, share, gm5.ADJ.get((r['team'], y), 0) * gm5.ADJ_TO_VALUE * share))
    return out


def worst_stretch(seasons):
    """The longest run (two or more) of consecutive seasons with negative production, and what it cost."""
    best, cur = None, []
    for y, sh, pm in seasons + [(None, 0, 1)]:
        if pm < 0 and (not cur or y == cur[-1][0] + 1):
            cur.append((y, pm))
            continue
        if len(cur) >= 2 and (best is None or sum(p for _, p in cur) < sum(p for _, p in best)):
            best = cur
        cur = [(y, pm)] if pm < 0 else []
    return best


def scouting(name, r, card, det, decs):
    """A short report written from the numbers, rebuilt with every refresh."""
    last = name.split()[-1]
    s = []
    gva, ps = r['gm_value_added'][K], r['gm_value_added_per_season']
    span = f"{r['start'][:4]}–{(r['end'] or 'today')[:4] if r['end'] else 'today'}"
    if r['ranked']:
        pool = [x for x in SP if x['ranked']]
        rank = 1 + sum(1 for x in pool if x['gm_value_added'][K] > gva)
        s.append(f"{name} ran {r['team']} {span} and added {fmt(gva)} points of value against an average GM in his seat ({fmt(ps)} a season), "
                 f"{ordinal(rank)} of {len(pool)} spells ({ordinal(card['pct_all'])} percentile).")
    else:
        s.append(f"{name} ran {r['team']} {span}: under two seasons, so his number ({fmt(gva)}) is shown but not ranked.")
    prod, net = r['produced_margin_adj'], r['left'][K] - r['inherited'][K]
    if abs(prod) > abs(net):
        s.append(f"Most of it is what the team did on the floor while he ran it ({fmt(prod)} on luck-adjusted margin); what he left against what he inherited adds {fmt(net)}.")
    else:
        s.append(f"Most of it is the roster he handed on: {r['left'][K]:,.0f} left against {r['inherited'][K]:,.0f} inherited ({fmt(net)}), with {fmt(prod)} from the team's luck-adjusted margin.")
    won, exp = r.get('titles_won', 0), r.get('titles_expected', 0)
    if won >= 0.5 or exp >= 0.05:
        wn = f"{won:.0f}" if abs(won - round(won)) < 0.05 else f"{won:.1f}"
        s.append(f"His teams won {wn} title{'s' if wn != '1' else ''} against {exp:.1f} expected (playoff luck {r['playoff_luck']:+.1f}); "
                 f"counted in titles, he added {r['titles_added']:+.2f} expected titles against an average GM.")
    if r['ranked'] and (card['pct_all'] or 0) <= 10 and won >= 1:
        il = card.get('inherited_list', [])
        inh = [a['label'] for a in il[:3] if il and a['value'] >= max(500, 0.2 * il[0]['value'])]
        ws = worst_stretch(spell_seasons(r))
        why = []
        if inh and r['inherited'][K] > 2000:
            why.append(f"he inherited {' and '.join(inh)}, whose later production counts against him (what he inherited: {r['inherited'][K]:,.0f})")
        if ws:
            why.append(f"his teams from {season_label(ws[0][0])} to {season_label(ws[-1][0])} played below average ({fmt(sum(p for _, p in ws))})")
        if why:
            s.append(f"The low rank despite the titles: {'; and '.join(why)}.")
    if det:
        dr, tr = det['drafting'], det['trades']
        if dr['picks'] >= 5:
            s.append(f"His {dr['picks']} picks came out {fmt(dr['over_slot'])} against their slots" + (f"; the one that got away was {dr['passed_on'][0]['passed_on']}, taken {ordinal(dr['passed_on'][0]['their_slot'])}, after {last} chose {dr['passed_on'][0]['took']}." if dr.get('passed_on') else '.'))
        if tr['n'] >= 5:
            s.append(f"His {tr['n']} trades graded {fmt(tr['at_time'])} at the time and {fmt(tr['turned_out'])} as they turned out.")
        lot = det['luck']['lottery']
        if abs(lot) >= 100:
            s.append(f"The lottery {'helped' if lot > 0 else 'cost'} him {abs(lot):,.0f} points against his odds.")
    moves = [x for x in decs if x[0]['type'] in ('trade', 'sign-and-trade', 'draft', 'signing')]   # re-signings wait for salaries
    best = max(moves, key=lambda x: (x[0]['turned_out'] or 0) * x[1], default=None)
    worst = min(moves, key=lambda x: (x[0]['turned_out'] or 0) * x[1], default=None)
    if best and (best[0]['turned_out'] or 0) > 300:
        s.append(f"Best move ({best[0]['agreed'][:4]}, {fmt(best[0]['turned_out'] * best[1])}): {decision_label(best[0]).rstrip('.')}.")
    if worst and (worst[0]['turned_out'] or 0) < -300:
        s.append(f"Costliest ({worst[0]['agreed'][:4]}, {fmt(worst[0]['turned_out'] * worst[1])}): {decision_label(worst[0]).rstrip('.')}.")
    if card['splits']:
        s.append('Part of the spell is shared credit; the splits are listed below.')
    if r['early_era']:
        s.append('Early era: some decisions here have no at-the-time grade.')
    s.append("This is the model's view, not a verdict.")
    return ' '.join(s)


def ordinal(n):
    if n is None:
        return '—'
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


# ---------------------------------------------------------------- Data Room
DICT = {
    'gm_tenures': ('one person in charge of one team, start to end', {
        'tenure_id': ('id', 'the tenure', 'this build'), 'person_id': ('id', 'the person', 'Basketball-Reference executive id, or ESPN / fact ids'), 'person': ('text', 'name', ''),
        'team': ('code', 'franchise (Charlotte 1988-2002 on New Orleans\' line)', ''), 'title': ('text', 'title held, when a source gives it', 'press releases, ESPN, Wikipedia'),
        'start': ('date', 'first day in charge', ''), 'start_precision': ('text', 'day, month, offseason, season or before coverage', ''),
        'end': ('date', 'last day (empty while active)', ''), 'end_precision': ('text', 'as start_precision', ''), 'role': ('text', 'lead, shared or under only', ''),
        'confidence': ('text', 'clear, likely or disputed', ''), 'sources': ('text', 'source links, " | " between', '')}),
    'assets': ('one asset: a player, a draft pick, a swap right, cash or an exception', {
        'asset_id': ('id', 'the asset', ''), 'kind': ('text', 'player, pick, swap, cash, exception', ''), 'name': ('text', 'player name or pick label', ''),
        'player_id': ('id', 'Savant player id', ''), 'year': ('season', 'draft year (picks)', ''), 'round': ('int', 'round (picks)', ''),
        'original_owner': ('code', 'team whose pick it was', ''), 'overall': ('int', 'where it was used', ''), 'became_id': ('id', 'the player it became', ''),
        'protection': ('text', 'protection note, when known', 'hand-filled from press coverage for the biggest pre-2017 trades'), 'notes': ('text', 'ledger notes', '')}),
    'asset_events': ('one move of one asset between holders', {
        'date': ('date', 'the day it moved (the official date for a delayed trade)', ''), 'asset_id': ('id', 'the asset', ''), 'from': ('code', 'holder before (POOL = free agents, DRAFT, OPENING)', ''),
        'to': ('code', 'holder after', ''), 'kind': ('text', 'trade, sign, re-sign, waive, drafted, conveyed, lapsed (inferred), repair ...', ''),
        'tx': ('id', 'the transaction', ''), 'source': ('text', 'source link or "inferred"', 'Basketball-Reference, ESPN, NBA.com, press')}),
    'gm_decisions': ('one decision by one team, with both grades', {
        'decision_id': ('id', 'the decision', ''), 'agreed': ('date', 'agreement date (the at-the-time grade uses data before it)', ''), 'official': ('date', 'official date', ''),
        'type': ('text', 'trade, draft, signing, re-signing, extension, left in free agency (his rights ended and he signed elsewhere: whether the team made an offer is not known), waiver, release, waiver claim, sign-and-trade, coach hire, coach firing', ''),
        'team': ('code', 'the deciding team', ''), 'credited': ('text', 'person:weight, " | " between', 'credit table'),
        'at_time': ('points', 'value of the decision with only what was known that day (ten seasons, 5%)', 'point-in-time model, version in models'),
        'turned_out': ('points', 'what it produced and is projected to produce, following traded assets', 'Savant value, era footing'),
        'at_time_note': ('text', 'why there is no at-the-time grade, when there is none', ''), 'low_confidence': ('text', 'reasons, " | " between', ''),
        'models': ('text', 'model versions behind the at-the-time grade', ''), 'grade_version': ('text', 'grading code version', ''), 'label': ('text', 'what happened', ''),
        'grade_basis': ('text', 'drafts: consensus (graded against the best available on the consensus board) or slot (no consensus board exists for that draft)', 'boards.py: archived big boards'),
        'consensus_rank': ('int', 'drafts: the chosen player\'s consensus rank among that draft\'s players', 'boards.py'),
        'best_available': ('text', 'drafts: the highest consensus-ranked player still available at the pick', 'boards.py'),
        'best_available_rank': ('int', 'drafts: his consensus rank', 'boards.py'),
        'titles_at_time': ('titles', 'expected titles at the time: the at-the-time points by season x the projected title curve\'s slope that day', 'titles.py, titles_dec.py'),
        'titles_turned_out': ('titles', 'expected titles as it turned out: the points by season x the team-season\'s secant slope (played seasons), today\'s projection after', 'titles.py, titles_dec.py'),
        'blended_at_time': ('points', 'at_time + lambda x titles_at_time (lambda in the dictionary notes)', ''),
        'blended_turned_out': ('points', 'turned_out + lambda x titles_turned_out', ''),
        'salary_cost': ('dollars', 'salary committed by the decision over the deal (null until NBA GM Savant 1.1.0)', 'the Contract tab'),
        'cap_hit': ('dollars', 'first-season cap hit of what came in, less what went out (null until 1.1.0)', 'the Contract tab'),
        'value_per_dollar': ('points per $1M', 'turned_out per million dollars of salary_cost (null until 1.1.0)', 'the Contract tab'),
        'dead_money': ('dollars', 'salary still owed to players waived or stretched by the decision (null until 1.1.0)', 'the Contract tab'),
        'years_of_control': ('seasons', 'seasons under contract on the deal, options marked (null until 1.1.0)', 'the Contract tab')}),
    'gm_seasons': ('one person at one team in one season', {
        'person_id': ('id', 'the person', ''), 'person': ('text', 'name', ''), 'team': ('code', 'team', ''), 'share': ('share', 'his credit weight over the season\'s games', ''),
        'produced_margin': ('points', 'margin with 30% of opponents\' shooting luck taken out x value per margin point x share', 'Basketball-Reference opponent totals'),
        'produced_player_value': ('points', 'team Savant value above the league average x share', ''), 'decisions': ('int', 'decisions credited to him', ''),
        'turned_out': ('points', 'his decisions\' how-it-turned-out grades x his weight', ''), 'at_time': ('points', 'the same, at the time', ''),
        'title_chance': ('share', 'the team\'s chance of the title that season (played seasons; the season in progress on today\'s projection)', 'titles.py: the season simulated'),
        'title_chance_average_team': ('share', 'the same team replayed at league-average strength', 'titles.py'),
        'titles_above_average': ('titles', '(title_chance - 1/teams) x share', ''), 'expected_titles': ('titles', 'title_chance x share (played seasons)', ''),
        'titles_won': ('titles', 'won the title x share', 'the Finals'), 'playoff_luck': ('titles', 'titles_won - expected_titles', ''),
        'payroll': ('dollars', 'the team\'s total cap hits that season, x share (null until NBA GM Savant 1.1.0)', 'the Contract tab'),
        'tax_paid': ('dollars', 'luxury tax paid that season, x share (null until 1.1.0)', 'the Contract tab'),
        'apron_status': ('text', 'under the cap, over the cap, over the tax, over the first apron or over the second apron, at season end (null until 1.1.0)', 'the Contract tab'),
        'dead_money': ('dollars', 'cap hits for players no longer on the roster, x share (null until 1.1.0)', 'the Contract tab'),
        'value_per_dollar': ('points per $1M', 'produced_margin per million dollars of payroll (null until 1.1.0)', 'the Contract tab')}),
}


def season_titles(team, y, share):
    import titlecurve as TC
    re = TC.realized(team, y)
    if re:
        return [round(re['E'], 5), round(re['E0'], 5), round((re['E'] - 1 / re['n']) * share, 5), round(re['E'] * share, 5),
                round(float(re['won']) * share, 5), round((float(re['won']) - re['E']) * share, 5)]
    p = TC.projected(team, y, today=True) if y > TC.LAST_PLAYED else None
    if p:
        return [round(p['chance'], 5), round(p['chance0'], 5), round((p['chance'] - 1 / TC.n_teams(y)) * share, 5), None, None, None]
    return [None] * 6


def table_file(table, season, cols, rows):
    d = os.path.join(PUB, 'data', table)
    os.makedirs(d, exist_ok=True)
    dates = [r[cols.index(c)] for r in rows for c in ('date', 'agreed', 'end') if c in cols and r[cols.index(c)]]
    dump({'table': table, 'season': season, 'columns': cols, 'rows': rows, 'through': max(dates) if dates else None}, os.path.join(d, f'{season}.json'))


def dataroom(dec_by):
    seasons = collections.defaultdict(dict)
    c = list(DICT['gm_tenures'][1])
    table_file('gm_tenures', 'all', c, [[t.get('tenure_id'), t.get('person_id'), t.get('person'), t.get('team'), t.get('title'), t.get('start'), t.get('start_precision'),
                                          t.get('end'), t.get('end_precision'), t.get('role'), t.get('confidence'), ' | '.join(t.get('sources') or [])] for t in TEN])
    c = list(DICT['assets'][1])
    rows = []
    for aid, a in GR.A.items():
        b = GR.pid_of('player:' + a['became']) if a.get('became') else None
        rows.append([aid, a.get('kind'), a.get('name') or LT.label(aid), pid_num(aid), a.get('year'), a.get('round'), a.get('original_owner'), a.get('overall'),
                     b if isinstance(b, int) else None, next((n for n in (a.get('notes') or []) if 'protect' in n), None), ' | '.join(a.get('notes') or [])])
    table_file('assets', 'all', c, rows)
    c = list(DICT['asset_events'][1])
    by = collections.defaultdict(list)
    for e in GR.E:
        by[season_label(GR.season_of(e['date']))].append([e['date'], e['asset'], e['from'], e['to'], e['kind'], e.get('tx'), e.get('source')])
    for s, rows in by.items():
        table_file('asset_events', s, c, sorted(rows))
    c = list(DICT['gm_decisions'][1])
    by = collections.defaultdict(list)
    for d in D:
        cr = ' | '.join(f"{p['person']}:{p['weight']}" for p in d['credit']['people'])
        by[season_label(GR.season_of(d['agreed']))].append([did(d), d['agreed'], d['date'], d['type'], d['team'], cr, d['at_time'], d['turned_out'], d.get('at_time_note'),
                                                            ' | '.join(d['low_confidence']), ' | '.join(d.get('models') or []), GR.VERSION, decision_label(d),
                                                            d.get('grade_basis'), d.get('consensus_rank'), d.get('best_available'), d.get('best_available_rank'),
                                                            d.get('titles_at_time'), d.get('titles_turned_out'), blend(d['at_time'], d.get('titles_at_time')),
                                                            blend(d['turned_out'], d.get('titles_turned_out'))] + [SAL.decision(d)[k] for k in SAL.DECISION_FIELDS])
    for s, rows in by.items():
        # agreed, then the decision's own id: moves agreed the same day used to keep whatever order grading produced,
        # which varied run to run, so a refresh with nothing new rewrote every season file (Nov 25, 2026)
        table_file('gm_decisions', s, c, sorted(rows, key=lambda r: (r[1], r[0])))
    c = list(DICT['gm_seasons'][1])
    by = collections.defaultdict(list)
    for r in SP:
        segs = [(sg['from'], sg['to'], p['weight']) for sg in CRED.get(r['team'], []) for p in sg['people']
                if TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == r['person_id'] and sg['to'] >= r['start'] and sg['from'] <= (r['end'] or GR.TODAY)]
        segs.sort()
        if not segs:
            continue
        for y in range(GR.season_of(r['start']), min(GR.season_of(r['end'] or GR.TODAY), GR.NOW_SEASON) + 1):
            dates = gm5.season_games(r['team'], y)
            if not dates:
                continue
            share = sum(gm5.weight_on(segs, x) for x in dates) / len(dates)
            if share <= 0:
                continue
            k = (r['team'], y)
            ds = [(d, w) for d, w in dec_by[r['person_id']] if d['team'] == r['team'] and GR.season_of(d['agreed']) == y]
            by[season_label(y)].append([r['person_id'], r['person'], r['team'], round(share, 3), round(gm5.ADJ.get(k, 0) * gm5.ADJ_TO_VALUE * share, 1),
                                        round((gm5.TEAMVAL.get(k, 0) - gm5.LEAGUE_AVG.get(y, 0)) * share, 1), len(ds),
                                        round(sum((d['turned_out'] or 0) * w for d, w in ds), 1), round(sum((d['at_time'] or 0) * w for d, w in ds if d['at_time'] is not None), 1)]
                                       + season_titles(r['team'], y, share) + [SAL.season(r['team'], y)[k] for k in SAL.SEASON_FIELDS])
    for s, rows in by.items():
        table_file('gm_seasons', s, c, rows)
    dic = {'tables': {t: {'row': row, 'columns': {k: {'unit': u, 'what': w, 'source': src} for k, (u, w, src) in cols.items()}} for t, (row, cols) in DICT.items()},
           'notes': NOTES, 'version': VERSION, 'lambda_points_per_title': LAM,
           'moved_ids': {'about': 'decision ids that no longer exist (gm_decisions.decision_id): old id -> the id now holding the same move', 'ids': MOVED}}
    dump(dic, os.path.join(PUB, 'data', 'dictionary.json'))
    print('data room written', flush=True)


if __name__ == '__main__':
    main()
