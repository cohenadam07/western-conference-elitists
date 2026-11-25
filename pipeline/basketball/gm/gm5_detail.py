"""
gm5_detail.py — the skill detail behind each spell, cut from the graded decisions and the ledger.

  drafting     the drafting grade (against the consensus board where one exists, else the slot), hit rate, bust rate (a first-rounder under a quarter of his
               slot's expectation), second-round finds, undrafted finds, and who he passed on (the best player taken
               within the next ten picks, when better than his)
  trades       both grades; deadline (Jan 15 - Feb 28) / offseason (Jun 1 - Oct 15) / other; buying (more value this
               season in than out) vs selling; results against each partner
  free agency  new signings split: stars (worth 300+ points at the time) and role players
  role players two-way, 10-day and Exhibit 10 signings, second-round picks, undrafted signings: how they turned out
  development  players beating the projection made when he got them, over the seasons he had them (shared with the
               coach, and labeled so)
  luck         lottery: his own pick's slot value against what its pre-lottery odds gave; games missed (any reason):
               value per game times games missed by his players; the gap between his two grades
  style        decisions per season; spread of his at-the-time trade grades (risk); age of players he acquired;
               picks owned at each season's start
Pending the Contract tab: value per dollar, minimum signings, cap management.

    python3 gm5_detail.py     # -> out/gm_detail.json
"""
import collections, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
import gm5  # noqa: E402
GR = gm5.GR
SN = GR.SN

SP = json.load(open(os.path.join(OUT, 'gm_spells.json')))
D = gm5.D
ROWS = {(r['id'], r['y']): r for r in GR.ROWS}


def decisions_of(sp):
    out = []
    end = sp['end'] or GR.TODAY
    for d in D:
        if d['team'] != sp['team'] or not (sp['start'] <= d['agreed'] <= end):
            continue
        wt = sum(p['weight'] for p in d['credit']['people'] if gm5.TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == sp['person_id'])
        if wt:
            out.append((d, wt))
    return out


# the draft board as it turned out: realized ten-season value by year and slot
REAL = collections.defaultdict(dict)
for d in D:
    if d['type'] == 'draft':
        REAL[int(d['date'][:4])][d['slot']] = (d['outcome'], d['player'])


def holds_of(sp):
    """His holding credits (holding.py): young players he kept through a deadline or an offseason, credit-weighted."""
    end = sp['end'] or GR.TODAY
    out = []
    for h in gm5.HOLDS:
        if h['team'] != sp['team'] or not (sp['start'] <= h['agreed'] <= end):
            continue
        wt = sum(p['weight'] for p in h['credit']['people'] if gm5.TID.get(p['tenure_id'], {}).get('person_id', p['tenure_id']) == sp['person_id'])
        if wt:
            out.append((h, wt))
    return out


def holding(sp):
    hs = holds_of(sp)
    by = collections.defaultdict(lambda: [0.0, 0.0, 0])
    for h, w in hs:
        b = by[h['player']]
        b[0] += h['turned_out'] * w
        b[1] += (h['at_time'] or 0) * w
        b[2] += h['windows']
    top = sorted(by.items(), key=lambda x: -x[1][0])[:3]
    return {'holds': sum(h['windows'] for h, w in hs), 'turned_out': round(sum(h['turned_out'] * w for h, w in hs), 1),
            'at_time': round(sum((h['at_time'] or 0) * w for h, w in hs), 1),
            'players': len(by), 'biggest': [{'player': k, 'turned_out': round(v[0], 1), 'at_time': round(v[1], 1), 'windows': v[2]} for k, v in top]}


def draft_style(dr):
    """Board picks only (drafts with two or more boards): how often and how far he left the consensus board, how those
    picks did against the player he passed on, and fit against talent (inferred from roster needs)."""
    b = [(d, w) for d, w in dr if d.get('style')]
    if not b:
        return None
    dev = [(d, w) for d, w in b if d['style']['deviation']]
    def cls(name):
        xs = [(d, w) for d, w in b if d['style']['fit_class'] == name]
        played = [d['style']['minutes_for_team'] / d['style']['minutes_seasons'] for d, w in xs if d['style']['minutes_seasons']]
        return {'n': len(xs), 'value_vs_best_available': round(sum(d['turned_out'] * w for d, w in xs), 1),
                'value_over_slot': round(float(np.mean([d['turned_out_slot'] for d, w in xs])), 1) if xs else None,
                'minutes_per_season_for_team': round(float(np.mean(played))) if played else None}
    return {'board_picks': len(b), 'deviations': len(dev), 'deviation_rate': round(len(dev) / len(b), 3),
            'mean_reach': round(float(np.mean([d['style']['reach'] for d, w in dev])), 1) if dev else None,
            'hit_rate': round(float(np.mean([d['style']['hit'] for d, w in dev])), 3) if dev else None,
            'deviation_value': round(sum(d['turned_out'] * w for d, w in dev), 1),
            'deviation_value_at_time': round(sum((d['at_time'] or 0) * w for d, w in dev), 1),
            'talent': cls('talent'), 'fit': cls('fit'), 'other': cls('other'), 'fit_label': 'inferred from roster needs'}


def lottery_luck(sp):
    """His own first-round pick, each draft he was in charge for on lottery day (May 15): slot value vs pre-lottery odds."""
    out = []
    end = sp['end'] or GR.TODAY
    for y in range(int(sp['start'][:4]), int(end[:4]) + 1):
        day = f'{y}-05-15'
        if not (sp['start'] <= day <= end) or y < 1985 or y > 2026 or str(y) not in SN.WD:
            continue
        own = next((int(ov) for ov, v in SN.WD[str(y)]['picks'].items() if v['round'] == 1 and (v['from'] or v['team']) == sp['team']), None)
        if not own:
            continue
        dist = SN.slot_dist(y, f'{y}-04-30').get(sp['team'])
        cm, _ = SN.cmodel(SN.origin(day) or 1990)
        curve = np.array([0.0] + cm['v5_by_slot'])
        if dist is None:
            continue
        exp = float((np.array(dist)[:61] * curve[:61]).sum())
        out.append({'year': y, 'slot': own, 'expected': round(exp, 1), 'got': round(float(curve[own]), 1), 'luck': round(float(curve[own]) - exp, 1)})
    return out


def games_missed(sp):
    lost = 0.0
    end = sp['end'] or GR.TODAY
    for y in range(GR.season_of(sp['start']), min(GR.season_of(end), GR.NOW_SEASON - 1) + 1):
        for (pid, yy), sh in GR.SHARE.items():
            if yy != y or sp['team'] not in sh:
                continue
            r = ROWS.get((pid, y))
            if not r or not r['gp'] or r['gp'] < 10:
                continue
            missed = max(0, r['team_games'] - r['gp'])
            lost += max(0.0, r['valuer'] / r['gp']) * missed * sh[sp['team']]
    return round(lost, 1)


def development(sp, decs):
    """Acquisitions (trades in, signings, re-signings, draft picks): realized value with the team minus what the projection
    at acquisition expected, season by season, while he had them."""
    tot, n = 0.0, 0
    for d, wt in decs:
        aids = d.get('in') if d['type'] == 'trade' else ([d.get('asset')] if d.get('asset') else [])
        if d['type'] == 'draft':
            aids = []
        for aid in aids or []:
            if not aid or not aid.startswith('player:'):
                continue
            seasons, _, _ = GR.pv(aid, d['agreed'])
            pid = GR.pid_of(aid)
            last = GR.season_of(sp['end'] or GR.TODAY)
            for y, exp in seasons.items():
                if y >= GR.NOW_SEASON or y > last:          # only seasons he was in charge for (not his successors')
                    continue
                sh = GR.SHARE.get((pid, y), {}).get(sp['team'], 0.0)
                if sh <= 0:
                    continue
                tot += (GR.VAL.get((pid, y), 0.0) * sh - exp * sh) * wt
                n += 1
    return round(tot, 1), n


# Each season's own calendar, from the data, not fixed dates (2021's deadline was in late March; the 2020 offseason ran
# into November): the deadline is the last day trades were made before that regular season ended (no trade can be made
# after it until the season is over), and the window is the 30 days up to it; the offseason runs from the regular
# season's last game to the next season's first.
import datetime as _dt
_games = sorted({d for s_ in gm5.G.values() for ds in s_.values() for d in ds})
_first = {}
_last = {}
for _s, _teams in gm5.G.items():
    _y = int(_s[:4]) + 1
    _ds = [d for ds in _teams.values() for d in ds]
    if _ds:
        _first[_y], _last[_y] = min(_ds), max(_ds)
DEADLINE = {}
for _e in GR.E:
    if _e['kind'] == 'trade':
        _y = GR.season_of(_e['date'])
        # a season's deadline is its last in-season trade, so it is known only once the season is over: the season in
        # progress has none yet (its latest trade so far is not its deadline), and its trades count as "other"
        if _y in _first and _y < GR.NOW_SEASON and _first[_y] <= _e['date'] <= _last[_y]:
            DEADLINE[_y] = max(DEADLINE.get(_y, ''), _e['date'])


def trade_window(date):
    y = GR.season_of(date)
    dl, first, last = DEADLINE.get(y), _first.get(y), _last.get(y)
    if first and date < first:
        return 'offseason'                                     # before the season's first game
    if last and date > last:
        return 'offseason'                                     # after its last regular-season game
    if dl and (_dt.date.fromisoformat(dl) - _dt.date.fromisoformat(date)).days <= 30 and date <= dl:
        return 'deadline'
    return 'other'


def detail(sp):
    decs = decisions_of(sp)
    dr = [(d, w) for d, w in decs if d['type'] == 'draft']
    tr = [(d, w) for d, w in decs if d['type'] == 'trade']
    sg = [(d, w) for d, w in decs if d['type'] == 'signing']
    passed = []
    for d, w in dr:
        y = int(d['date'][:4]); mine = d['outcome']
        later = [(v, nm, s) for s, (v, nm) in REAL[y].items() if d['slot'] < s <= d['slot'] + 10]
        if later:
            v, nm, s = max(later)
            if v > mine:
                passed.append({'year': y, 'took': d['player'], 'slot': d['slot'], 'passed_on': nm, 'their_slot': s, 'by': round(v - mine, 1)})
    def window(d):
        return trade_window(d['date'])
    partners = collections.Counter()
    buy = collections.Counter()
    for d, w in tr:
        others = {e['to'] for e in GR.BYTX.get(d['tx'], []) if e['from'] == d['team']} | {e['from'] for e in GR.BYTX.get(d['tx'], []) if e['to'] == d['team']}
        for o in sorted(others - {d['team']}):      # sorted: float sums in a fixed order, so reruns agree to the last digit
            partners[o] += d['turned_out'] * w / max(1, len(others - {d['team']}))
        y0 = GR.season_of(d['agreed'])
        now_in = sum(GR.pv(a, d['agreed'])[0].get(y0, 0) for a in d['in'])
        now_out = sum(GR.pv(a, d['agreed'])[0].get(y0, 0) for a in d['out'])
        buy['buying' if now_in > now_out else 'selling'] += d['turned_out'] * w
    by_window = collections.Counter()
    for d, w in tr:
        by_window[window(d)] += d['turned_out'] * w
    dev, dev_n = development(sp, decs)
    luck = lottery_luck(sp)
    ages = [GR.ROWS and ROWS.get((GR.pid_of(a), GR.season_of(d['agreed']) - 1), {}).get('age') for d, w in tr for a in d['in'] if a.startswith('player:')]
    ages = [a for a in ages if a]
    picks_held = []
    return {
        'person_id': sp['person_id'], 'person': sp['person'], 'team': sp['team'], 'start': sp['start'], 'end': sp['end'],
        'drafting': {'picks': len(dr), 'board_picks': sum(1 for d, w in dr if d.get('grade_basis') == 'consensus'), 'over_slot': round(sum(d['turned_out'] * w for d, w in dr), 1),
                     'over_slot_only': round(sum(d['turned_out_slot'] * w for d, w in dr), 1),
                     'hit_rate': round(np.mean([d['turned_out'] > 0 for d, w in dr]), 3) if dr else None,
                     'bust_rate': round(np.mean([d['outcome'] < 0.25 * d['slot_expected'] for d, w in dr if d['round'] == 1]), 3) if any(d['round'] == 1 for d, w in dr) else None,
                     'second_round_finds': round(sum(max(0, d['turned_out']) * w for d, w in dr if d['round'] == 2), 1),
                     'passed_on': sorted(passed, key=lambda x: -x['by'])[:3]},
        'holding': holding(sp),
        'draft_style': draft_style(dr),
        'undrafted_finds': round(sum(max(0, d['turned_out']) * w for d, w in sg if GR.A.get(d['asset'], {}).get('drafted') is None and d['turned_out'] is not None), 1),
        'trades': {'n': len(tr), 'at_time': round(sum((d['at_time'] or 0) * w for d, w in tr), 1), 'turned_out': round(sum(d['turned_out'] * w for d, w in tr), 1),
                   'by_window': {k: round(v, 1) for k, v in by_window.items()}, 'buying_vs_selling': {k: round(v, 1) for k, v in buy.items()},
                   'best_partner': max(((k, round(v, 1)) for k, v in partners.items()), key=lambda x: (x[1], x[0])) if partners else None,
                   'worst_partner': min(((k, round(v, 1)) for k, v in partners.items()), key=lambda x: (x[1], x[0])) if partners else None,
                   'risk_sd_at_time': round(float(np.std(at_)), 1) if len(at_ := [d['at_time'] for d, w in tr if d['at_time'] is not None]) > 2 else None},
        'free_agency': {'stars': round(sum(d['turned_out'] * w for d, w in sg if (d['at_time'] or 0) >= 300), 1),
                        'role': round(sum(d['turned_out'] * w for d, w in sg if (d['at_time'] or 0) < 300), 1), 'value_per_dollar': 'pending the Contract tab'},
        'role_players': round(sum(d['turned_out'] * w for d, w in sg if d.get('contract') in ('two-way', '10-day', 'exhibit 10'))
                              + sum(d['turned_out'] * w for d, w in dr if d['round'] == 2), 1),
        're_signing': round(sum(d['turned_out'] * w for d, w in decs if d['type'] in ('re-signing', 'extension')), 1),
        'development': {'value_over_projection': dev, 'player_seasons': dev_n, 'note': 'shared with the coach'},
        'coach_hiring': round(sum((d['turned_out'] or 0) * w for d, w in decs if d['type'] in ('coach hire', 'coach firing')), 1),
        'luck': {'lottery': round(sum(x['luck'] for x in luck), 1), 'lottery_draws': luck, 'games_missed_value': games_missed(sp),
                 'grade_gap': sp['luck_gap']},
        'style': {'decisions_per_season': round(len(decs) / max(sp['seasons'], 0.25), 1),
                  'mix': dict(collections.Counter(d['type'] for d, w in decs)), 'age_acquired': round(float(np.mean(ages)), 1) if ages else None},
        'cap_management': 'pending the Contract tab',
    }


if __name__ == '__main__':
    out = []
    for i, sp in enumerate(SP):
        out.append(detail(sp))
        if i % 50 == 0:
            print(i, len(SP), flush=True)
    json.dump(out, open(os.path.join(OUT, 'gm_detail.json'), 'w'), indent=0)
    print('detail for', len(out), 'spells')
