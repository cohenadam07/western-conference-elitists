"""
Regenerate tools/gm/fixtures.json — the cross-runtime determinism fixtures.

sim_engine.py and src/lib/gm/sim.js must produce identical games from identical seeds,
because the server verifies a claimed season by replaying it. Run this whenever anything
that feeds the simulation changes, then run `node tools/gm/verify.mjs` in the site repo.

  python gm_fixtures.py
"""
import json, os
import sim_engine as S

REPO = os.path.expanduser('~/mnt/western-conference-elitists')
DEST = f'{REPO}/tools/gm/fixtures.json'

old = json.load(open(DEST))
teams = S.load_league()
cases = []
for c in old['cases']:
    h, a, seed = c['home'], c['away'], c['seed']
    res = S.simulate(teams[h], teams[a], seed)
    score, box, nposs = res[0], res[1], res[2]
    tot = lambda k: sum(v.get(k, 0) for v in box.s.values())
    cases.append({'home': h, 'away': a, 'seed': seed,
                  'hs': score['home'], 'as': score['away'], 'poss': nposs,
                  'pts': tot('pts'), 'fga': tot('fga'), 'ast': tot('ast'), 'reb': tot('reb'),
                  # stl and blk are here because they were NOT, and the two engines spent a
                  # while disagreeing about them in silence: the browser read its steal and
                  # block constants from the seed, this engine kept module defaults, and every
                  # fixture still matched because none of them looked.
                  'stl': tot('stl'), 'blk': tot('blk')})
# WHAT THIS ENGINE BELIEVED WHEN THESE WERE GENERATED.
#
# Carried in the fixture file so verify.mjs can compare it against SEED.cal directly, by name.
# Constant drift between the two runtimes used to surface — when it surfaced at all — as three
# mismatched box scores with no indication which number had moved; STL_CAL and BLK_CAL managed
# not to surface at all for a while, because the columns that would have shown them were not
# being compared. A parity check on the constants themselves fails in the right place and says
# the right thing.
CAL_KEYS = ['FG2_CAL', 'FG3_CAL', 'TOV_CAL', 'FTR_CAL', 'ORB_CAL', 'AST_CAL', 'TEAM_REB',
            'DEF_RIM', 'DEF_POA', 'DEF_EVT', 'HCA', 'GAME_LUCK', 'SCORE_EFFECT',
            'SCORE_THRESHOLD', 'HOT_UP', 'HOT_DOWN', 'HOT_DECAY', 'STL_CAL', 'BLK_CAL']
cal = {k: getattr(S, k) for k in CAL_KEYS if hasattr(S, k)}
cal['pace'] = S.LG['pace']

json.dump({'note': old['note'], 'cal': cal, 'cases': cases}, open(DEST, 'w'), indent=1)
print(f'{len(cases)} fixtures written to {DEST}')
for c in cases[:3]:
    print(' ', c['away'], '@', c['home'], 'seed', c['seed'], '→', c['as'], '-', c['hs'])
