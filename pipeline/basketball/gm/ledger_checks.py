"""
ledger_checks.py — Module 2's tests and report.

  1 trades balance      every item leaves one team and reaches one; a trade whose text says "for" has a
                        return leg; NBA.com (2015 on) agrees on who received each player
  2 today's rosters     the ledger's holders today against ESPN's 30 rosters
  3 past rosters        everyone who played for a team that season was held by it during the season
  4 pick chains         every pick ends in a selection, a pending future pick, or a documented end
  5 counts, gaps, and five asset trees

    python3 ledger_checks.py          # -> out/ledger_report.txt
"""
import collections
import datetime as dt
import json
import os
import re

from fetch import get
from tenures import OUT, norm, franchise
from ledger import POOL, RETIRED, DRAFT

A = json.load(open(os.path.join(OUT, 'ledger_assets.json')))
E = json.load(open(os.path.join(OUT, 'ledger_events.json')))
X = json.load(open(os.path.join(OUT, 'ledger_edges.json')))
TR = json.load(open(os.path.join(OUT, 'ledger_trades.json')))
G = json.load(open(os.path.join(OUT, 'ledger_gaps.json')))
TODAY = dt.date.today().isoformat()
rep = []


def say(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    rep.append(s)


# hold intervals: asset -> [(holder, from, to)]
by_asset = collections.defaultdict(list)
for e in E:
    by_asset[e['asset']].append(e)
spans = collections.defaultdict(list)
for aid, ev in by_asset.items():
    ev.sort(key=lambda e: e['date'])
    for k, e in enumerate(ev):
        end = ev[k + 1]['date'] if k + 1 < len(ev) else TODAY
        spans[aid].append((e['to'], e['date'], end))


def held_by(aid, date):
    h = None
    for who, a, b in spans.get(aid, []):
        if a <= date:
            h = who
    return h


# ---------------------------------------------------------------- 1. trades balance
say('== 1. Trades')
one_way, empty_back = [], []
for t in TR:
    teams_out = {lg['from'] for lg in t['legs']}
    teams_in = {lg['to'] for lg in t['legs']}
    if any(lg['n'] == 0 for lg in t['legs']):
        empty_back.append(t)
    if teams_out != teams_in:
        one_way.append(t)
moved = collections.Counter((e['tx']) for e in E if e['kind'] == 'trade')
say(f'trades {len(TR)}; every item recorded with one giver and one receiver (double entry): {sum(moved.values())} item moves')
say(f'legs with nothing in them (text says "for" but no item parsed): {len(empty_back)}')
for t in empty_back[:5]:
    say('   ', t['date'], t['text'][:150])
say(f'one-way trades (a team gave without receiving anything named): {len(one_way)}')
# NBA.com, 2015 on: who received each player
c, b = get('https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json', offline=True)
nba = json.loads(b)['NBA_Player_Movement']['rows'] if c == 200 else []
NBAID = {1610612737: 'ATL', 1610612738: 'BOS', 1610612739: 'CLE', 1610612740: 'NOP', 1610612741: 'CHI', 1610612742: 'DAL', 1610612743: 'DEN', 1610612744: 'GSW', 1610612745: 'HOU',
         1610612746: 'LAC', 1610612747: 'LAL', 1610612748: 'MIA', 1610612749: 'MIL', 1610612750: 'MIN', 1610612751: 'BRK', 1610612752: 'NYK', 1610612753: 'ORL', 1610612754: 'IND',
         1610612755: 'PHI', 1610612756: 'PHO', 1610612757: 'POR', 1610612758: 'SAC', 1610612759: 'SAS', 1610612760: 'OKC', 1610612761: 'TOR', 1610612762: 'UTA', 1610612763: 'MEM',
         1610612764: 'WAS', 1610612765: 'DET', 1610612766: 'CHO'}
from ledger import pname
name_of = {aid: pname(a.get('name') or '') for aid, a in A.items() if a['kind'] == 'player'}
by_name = collections.defaultdict(list)
for aid, n in name_of.items():
    by_name[n].append(aid)
agree = miss = 0
misses = []
for r in nba:
    if r['Transaction_Type'] != 'Trade' or not r['PLAYER_ID']:
        continue
    m = re.match(r'(.+?) received (?:\w+ )?(?:guard|forward|center|guard-forward|forward-center|forward-guard|center-forward)?\s*(.+?) from (.+)\.$', r['TRANSACTION_DESCRIPTION'])
    if not m:
        continue
    who = pname(m.group(2))
    to = NBAID.get(int(r['TEAM_ID']))
    d = r['TRANSACTION_DATE'][:10]
    ids = by_name.get(who, [])
    ok = any(held_by(aid, (dt.date.fromisoformat(d) + dt.timedelta(days=3)).isoformat()) == to or
             any(e['to'] == to and e['kind'] in ('trade', 'drafted') and abs((dt.date.fromisoformat(e['date']) - dt.date.fromisoformat(d)).days) <= 7 for e in by_asset[aid]) for aid in ids)
    if ok:
        agree += 1
    else:
        miss += 1
        misses.append((d, to, m.group(2)))
say(f'NBA.com (July 2015 on): {agree} of {agree + miss} traded players reach the same team in the ledger within 7 days')
for d, to, n in misses[:8]:
    say('    NBA.com only:', d, to, n)

# ---------------------------------------------------------------- 2. today's rosters
say('\n== 2. Rosters today (ESPN, ' + TODAY + ')')
ESPN = {'ATL': 1, 'BOS': 2, 'BRK': 17, 'CHO': 30, 'CHI': 4, 'CLE': 5, 'DAL': 6, 'DEN': 7, 'DET': 8, 'GSW': 9, 'HOU': 10, 'IND': 11, 'LAC': 12, 'LAL': 13, 'MEM': 29,
        'MIA': 14, 'MIL': 15, 'MIN': 16, 'NOP': 3, 'NYK': 18, 'OKC': 25, 'ORL': 19, 'PHI': 20, 'PHO': 21, 'POR': 22, 'SAC': 23, 'SAS': 24, 'TOR': 28, 'UTA': 26, 'WAS': 27}
held_now = collections.defaultdict(set)
for aid, a in A.items():
    if a['kind'] == 'player':
        h = held_by(aid, TODAY)
        if h and h not in (POOL, RETIRED, DRAFT):
            held_now[h].add(aid)
tot_espn = found = 0
not_in_ledger, extra = [], collections.Counter()
for f, tid in ESPN.items():
    c, b = get(f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster', delay=1.5)
    if c != 200:
        say('   ESPN roster missing for', f, c)
        continue
    names = [pname(x['displayName']) for x in json.loads(b).get('athletes', [])]
    ours = {name_of[a] for a in held_now[f]}
    for n in names:
        tot_espn += 1
        if n in ours:
            found += 1
        else:
            not_in_ledger.append((f, n, [held_by(a, TODAY) for a in by_name.get(n, [])]))
    extra[f] = len([n for n in ours if n not in names])
say(f'ESPN players {tot_espn}; held by the same team in the ledger {found} ({found / max(tot_espn, 1):.1%})')
for f, n, where in not_in_ledger[:12]:
    say(f'    on {f} per ESPN, ledger has {where or "never seen"}: {n}')
stash = sum(1 for f in held_now for a in held_now[f] if name_of[a] not in [] and not any(e['kind'] != 'drafted' for e in by_asset[a] if e['to'] == f))
say(f'ledger holds {sum(extra.values())} players ESPN does not list; of all holdings, {stash} are unsigned draft rights (stashes). Most per team: {extra.most_common(5)}')

# ---------------------------------------------------------------- 3. past rosters
say('\n== 3. Past rosters: did the team hold everyone who played for it?')
from ledger import rosters
R = rosters()
season_ok = collections.Counter(); season_all = collections.Counter(); bad = collections.defaultdict(list)
for (f, y), ppl in R.items():
    a, b = f'{y - 1}-10-01', f'{y}-04-30'
    for pid, nm in ppl.items():
        aid = f'player:{pid}'
        ok = any(who == f and s <= b and e >= a for who, s, e in spans.get(aid, []))
        season_all[y] += 1
        if ok:
            season_ok[y] += 1
        else:
            bad[y].append((f, nm))
tot, ok = sum(season_all.values()), sum(season_ok.values())
say(f'player-team-seasons {tot}; reconciled {ok} ({ok / tot:.1%})')
for dec in range(1980, 2030, 10):
    t = sum(v for y, v in season_all.items() if dec <= y < dec + 10); o = sum(v for y, v in season_ok.items() if dec <= y < dec + 10)
    if t:
        say(f'   {dec}s: {o}/{t} ({o / t:.1%})')
worst = sorted(((len(v), y) for y, v in bad.items()), reverse=True)[:5]
say('   most unreconciled seasons:', [(f'{y - 1}-{str(y)[2:]}', n) for n, y in worst])
y0 = worst[0][1] if worst else None
if y0:
    say('   examples:', bad[y0][:8])

# ---------------------------------------------------------------- 4. pick chains
say('\n== 4. Pick chains')
end = collections.Counter(); unresolved = []
for aid, a in A.items():
    if a['kind'] != 'pick':
        continue
    notes = ' '.join(a.get('notes') or [])
    if a.get('resolved') == 'selected':
        end['selected'] += 1
    elif (a['year'] or 9999) > 2026:
        end['pending (future draft)'] += 1
    elif re.search(r'did not convey|not exercised|extinguish|became|forfeit|lapsed|swap', notes, re.I):
        end['documented end (note)'] += 1
    else:
        end['unresolved'] += 1
        unresolved.append(a)
say(dict(end))
say('   unresolved by era:', dict(collections.Counter((a['year'] // 10) * 10 for a in unresolved)))
say('   (pre-2017 picks that left no player and no note: protection unknown, graded low confidence per Adam, never guessed)')

# ---------------------------------------------------------------- 5. counts and gaps
say('\n== 5. Events by type and season')
C = json.load(open(os.path.join(OUT, 'ledger_counts.json')))
kinds = ['trade', 'sign', 'waive', 'release', 'claim', 'expansion', 'sale', 'draft', 'extend', 'convert', 'retire']
tab = collections.defaultdict(collections.Counter)
for k, v in C.items():
    kind, y = k.split('|'); tab[int(y)][kind] += v
say('season   ' + ' '.join(f'{k:>8}' for k in kinds))
for y in sorted(tab):
    if y % 5 == 0 or y >= 2024:
        say(f'{y - 1}-{str(y)[2:]}  ' + ' '.join(f'{tab[y][k]:>8}' for k in kinds))
say('\nGaps (the history before an event is missing, so the ledger repairs the holder and logs it):')
gc = collections.Counter((g['kind'], 'never seen before' if g.get('held') is None else 'held elsewhere') for g in G)
for k, v in gc.most_common():
    say(f'   {k[0]:8} {k[1]:20} {v}')
gd = collections.Counter((int(g['date'][:4]) // 10) * 10 for g in G if g.get('date'))
say('   by decade:', dict(sorted(gd.items())))

open(os.path.join(OUT, 'ledger_report.txt'), 'w').write('\n'.join(rep) + '\n')
