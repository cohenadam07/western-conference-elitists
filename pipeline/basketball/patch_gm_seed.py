"""
Patch the browser seed with the two things the front office was missing.

1. A RATE rating input. `v` (VORP) is cumulative, so a star who missed most of a season
   reads as a bench player — Jayson Tatum came out 68 overall on a 4.8 BPM. Every cap row
   now carries `bpm` (a rate) and `av` (availability, %), and the game rates on the rate.

2. Expected minutes, not last season's minutes. `load` was mpg x last season's
   availability, which budgeted an injured star six minutes a night in the season AFTER
   the injury. Fitted on 12,914 consecutive player-seasons: next season's minutes are
   0.652 x this season's + 0.248 x the season before (R2 0.474 against 0.379 for this
   season alone), or 1.020 x this season's for a player with no prior year. No intercept,
   so a three-game call-up who played 36 minutes twice is not handed a rotation spot.

  python patch_gm_seed.py [path/to/seed.js]
"""
import json, sys, os

REPO = os.path.expanduser('~/mnt/western-conference-elitists')
SEEDJS = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/src/lib/gm/seed.js'
OUT = 'out'

# Must match sim_engine.expected_load exactly — the server replays what the browser
# simulated, so the two runtimes have to read identical inputs.
EXP_LOAD_T, EXP_LOAD_PREV, EXP_LOAD_ONLY = 0.652, 0.248, 1.020
def expected_load(load_t, load_prev):
    if load_prev is None:
        return round(EXP_LOAD_ONLY * load_t, 6)
    return round(EXP_LOAD_T * load_t + EXP_LOAD_PREV * load_prev, 6)

data = json.load(open(f'{OUT}/players.json'))['data']
order = sorted(data)
season = order[-1]
prior = {}
if len(order) > 1:
    for q in data[order[-2]]['players']:
        m = q['m']
        mq = (m.get('mpg') or {}).get('season', {}).get('v')
        aq = (m.get('avail') or {}).get('season', {}).get('v')
        if mq is not None and aq is not None:
            prior[str(q['id'])] = mq * aq / 100.0
byid, byname = {}, {}
for p in data[season]['players']:
    m = p['m']
    def g(k):
        x = m.get(k)
        return x['season']['v'] if x and x.get('season') else None
    row = {'bpm': g('bpm'), 'avail': g('avail'), 'mpg': g('mpg')}
    byid[str(p['id'])] = row
    byname[p['name']] = row

src = open(SEEDJS).read()
head, body = src.split('export const SEED = ', 1)
seed = json.loads(body.rstrip().rstrip(';'))

# --- 1. rate stats on the cap sheet
#
# `v` is rewritten to the VORP the player would post at the minutes the rotation now
# expects of him, which is the number a GM should be valuing. VORP is exactly
# (BPM + 2) x minutes / 48 — confirmed against the source data to three decimals — so
# this stays the same quantity the trade, free-agency and pick engines already price in,
# rather than a second currency.
n_rate = 0
for team, roster in seed['rosters'].items():
    for p in roster:
        r = byname.get(p['n'])
        if not r:
            continue
        if r['bpm'] is not None:
            p['bpm'] = round(r['bpm'], 1); n_rate += 1
        if r['avail'] is not None:
            p['av'] = round(r['avail'], 1)

# --- 2. rotation minutes off EXPECTED minutes
n_load, moved = 0, []
for team, roster in seed['sim'].items():
    for p in roster:
        r = byid.get(str(p['id'])) or byname.get(p['n'])
        if not r or r['avail'] is None:
            continue
        before = p['load']
        p['load'] = expected_load(r['mpg'] * r['avail'] / 100.0, prior.get(str(p['id'])))
        n_load += 1
        if abs(p['load'] - before) > 4:
            moved.append((p['n'], round(before, 1), p['load']))

# --- 3. re-price contracts on those expected minutes
loads = {}
for team, roster in seed['sim'].items():
    for p in roster:
        loads[p['n']] = p['load']
n_v = 0
for team, roster in seed['rosters'].items():
    for p in roster:
        if 'bpm' not in p or p['n'] not in loads:
            continue
        p['v'] = round((p['bpm'] + 2.0) * loads[p['n']] / 48.0, 3)
        n_v += 1
print(f'{n_v} contracts re-priced on expected minutes')

open(SEEDJS, 'w').write(head + 'export const SEED = ' + json.dumps(seed, separators=(',', ':')) + '\n')
print(f'rate stats written to {n_rate} contracts; {n_load} rotation loads recomputed')
moved.sort(key=lambda x: x[2] - x[1])
print('biggest minute changes:')
for n, b, a in moved[:4] + moved[-6:]:
    print(f'  {n:26s} {b:5.1f} -> {a:5.1f}')
