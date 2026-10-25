"""
Add what the trade engine needs to the browser seed. Nothing here touches a simulation
input, so cross-runtime determinism and the fixtures are unaffected.

1. Three skill axes the fit model uses and the seed did not carry: size, rim pressure,
   ball security. Plus `slot`, the continuous 1-5 positional axis from position_engine,
   which is what minutes displacement should be reasoned about rather than a label.

2. `SEED.fit` — the standardised ridge coefficients from fit_engine.py, measured on 390
   team-seasons with leave-one-season-out validation (OOS R2 0.661 against 0.604 for
   individual impact alone). Target is team net rating, features are minutes-weighted, so
   the difference between two rosters' predictions IS a predicted net-rating change. That
   is the honest basis for "what is this player worth to THIS team".

  python patch_gm_trade_seed.py
"""
import json, os, sys

REPO = os.path.expanduser('~/mnt/western-conference-elitists')
SEEDJS = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/src/lib/gm/seed.js'
OUT = 'out'

skills = json.load(open(f'{OUT}/skills.json'))['data']
positions = json.load(open(f'{OUT}/positions.json'))['data']
arch = json.load(open(f'{OUT}/archetypes.json'))['data']
fit = json.load(open(f'{OUT}/fit_matrix.json'))
players = json.load(open(f'{OUT}/players.json'))['data']
season = sorted(players)[-1]

name_to_id = {p['name']: str(p['id']) for p in players[season]['players']}
S = skills.get(season, {})
P = positions.get(season, {})

def sk(pid, key):
    v = (S.get(pid, {}).get('s', {}) or {}).get(key)
    if not v:
        return None
    return round(v.get('vs', v.get('v')), 1)

src = open(SEEDJS).read()
head, body = src.split('export const SEED = ', 1)
seed = json.loads(body.rstrip().rstrip(';'))

added = 0
for team, roster in seed['rosters'].items():
    for p in roster:
        pid = name_to_id.get(p['n'])
        if not pid:
            continue
        for field, key in (('sz', 'size'), ('rpr', 'rim_pressure'), ('bs', 'ball_security')):
            v = sk(pid, key)
            if v is not None:
                p[field] = v
        slot = P.get(pid, {}).get('slot')
        if slot is not None:
            p['slot'] = round(slot, 2)
        # The projection table is keyed on the NBA person id, and the cap sheet only ever
        # carried a name — so every lookup missed and every valuation silently fell back
        # to a crude age curve. This is the join that was never made.
        p['pid'] = pid
        added += 1

# The fit model, carried as coefficients rather than re-fitted in the browser.
keys = ['spacing', 'gravity', 'rimprot', 'poa', 'playmaking', 'size', 'rimpress',
        'ballsec', 'onball_load', 'x_collide']
seed['fit'] = {
    'note': fit['note'],
    'oos_r2': fit['oos_r2'],
    'coef': {k: round(fit['coef'][k], 4) for k in keys if k in fit['coef']},
    'mean': {k: round(fit['mean'][k], 4) for k in keys if k in fit['mean']},
    'scale': {k: round(fit['scale'][k], 4) for k in keys if k in fit['scale']},
    # archetype shares enter as a block (individually collinear, jointly worth +0.048 R2)
    'arch_coef': {k: round(v, 4) for k, v in fit['coef'].items() if k.startswith('a_')},
    'arch_mean': {k: round(v, 4) for k, v in fit['mean'].items() if k.startswith('a_')},
    'arch_scale': {k: round(v, 4) for k, v in fit['scale'].items() if k.startswith('a_')},
    # net rating to wins, measured in sim_engine's own season runs
    'wins_per_net': 2.15,
}

open(SEEDJS, 'w').write(head + 'export const SEED = ' + json.dumps(seed, separators=(',', ':')) + '\n')
kb = os.path.getsize(SEEDJS) / 1024
print(f'{added} contracts given size / rim pressure / ball security / slot')
print(f'fit matrix carried: {len(seed["fit"]["coef"])} skill terms, '
      f'{len(seed["fit"]["arch_coef"])} archetype terms, OOS R2 {fit["oos_r2"]:.3f}')
print(f'seed is now {kb:.0f} KB')
