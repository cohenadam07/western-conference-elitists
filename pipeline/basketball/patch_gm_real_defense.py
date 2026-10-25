"""
Give the front office the defensive numbers it was inventing, and give the draft class
the college seasons it actually played.

Three things the browser seed was missing, all of them already measured in out/players.json
and out/draft_players.json:

1. STEAL AND BLOCK RATES on every simulation profile. The game had no per-player steal or
   block data at all, so the season attributed both after the fact from a generic defensive
   rating — which put Nikola Jokic on top of the league in steals, twice, in two different
   ways. Savant has stlpct (steals per 100 opponent possessions), blkpct (share of opponent
   two-point attempts blocked) and deflections for all 582 players. Real rates mean the
   possession engine can credit a steal to the man who actually takes them.

2. THE DRAFT CLASS'S COLLEGE SEASON. Every rookie was built from three facts — board rank,
   position, height — so a class of thirty-eight came out as five archetypes wearing
   different names. out/draft_players.json has the whole season for each of them: usage,
   true shooting, three-point rate, assist and turnover rates, offensive and defensive
   rebounding, steal and block rates, box plus/minus split into its halves, plus measured
   height, weight, wingspan and standing reach.

3. COMPARABLE PLAYERS. The player page computed its own comps from a nine-axis distance and
   they read badly. Savant already publishes comps with a similarity score, computed against
   far more than nine axes, and they are the ones on the website.

  python patch_gm_real_defense.py [path/to/seed.js]
"""
import json, os, sys, unicodedata, re

REPO = os.path.expanduser('~/mnt/western-conference-elitists')
SEEDJS = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/src/lib/gm/seed.js'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')

def norm(n):
    s = unicodedata.normalize('NFKD', str(n or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'`‘’]", '', s).replace('-', ' ')
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    return re.sub(r'\s+', ' ', s).strip()

pl = json.load(open(f'{OUT}/players.json'))
season = sorted(pl['data'])[-1]
cur = pl['data'][season]['players']

def sv(p, k):
    x = (p.get('m') or {}).get(k)
    if not x: return None
    s = x.get('season') if isinstance(x, dict) else None
    return s.get('v') if isinstance(s, dict) else None

byid, byname = {}, {}
for p in cur:
    row = {
        'stlr': sv(p, 'stlpct'), 'blkr': sv(p, 'blkpct'), 'defl': sv(p, 'defl'),
        'comps': [{'n': c['name'], 't': c.get('team'), 's': c.get('score')}
                  for c in (p.get('comps') or [])[:3]],
    }
    byid[str(p['id'])] = row
    byname[norm(p['name'])] = row

# --- the draft class
dp = json.load(open(f'{OUT}/draft_players.json'))['players']
COL = ['ts', 'usg', 'tp3', 'tp3r', 'ftr', 'ft', 'ast', 'tov', 'ator', 'oreb', 'dreb',
       'stl', 'blk', 'efg', 'ortg', 'per', 'bpm', 'obpm', 'dbpm', 'sos']
BODY = ['height', 'weight', 'wing', 'reach', 'vert']
prospects = {}
for p in dp:
    def g(k):
        x = (p.get('m') or {}).get(k)
        return x.get('v') if isinstance(x, dict) else None
    row = {'col': {k: g(k) for k in COL if g(k) is not None},
           'body': {k: g(k) for k in BODY if g(k) is not None},
           'gp': p.get('gp'), 'school': p.get('college'), 'confr': p.get('conference'),
           'born': p.get('birthdate'), 'dpos': p.get('pos'), 'dyear': p.get('draft_year'),
           'dpick': p.get('draft_pick'), 'darch': p.get('archetype')}
    prospects[norm(p['name'])] = row

src = open(SEEDJS).read()
head, body = src.split('export const SEED = ', 1)
seed = json.loads(body.rstrip().rstrip(';'))

# 1. defensive rates onto the simulation profiles
n_def = 0
miss = []
for team, roster in seed['sim'].items():
    for p in roster:
        row = byid.get(str(p.get('id'))) or byname.get(norm(p.get('n')))
        if not row:
            miss.append(p.get('n')); continue
        if row['stlr'] is not None: p['stlr'] = round(row['stlr'], 3)
        if row['blkr'] is not None: p['blkr'] = round(row['blkr'], 3)
        if row['defl'] is not None: p['defl'] = round(row['defl'], 2)
        n_def += 1

# 2. comps and 3. the draft class onto the cap sheet
n_comp = n_pro = 0
unmatched = []
for team, roster in seed['rosters'].items():
    for p in roster:
        k = norm(p.get('n'))
        row = byid.get(str(p.get('pid'))) or byname.get(k)
        if row and row['comps']:
            p['comps'] = row['comps']; n_comp += 1
        if p.get('exp') == 0 or p.get('rookie_slot') is not None or 'exp' not in p:
            pr = prospects.get(k)
            if pr:
                p.update({x: y for x, y in pr.items() if y})
                n_pro += 1
            else:
                unmatched.append(f'{team} {p["n"]}')

open(SEEDJS, 'w').write(head + 'export const SEED = ' + json.dumps(seed, separators=(',', ':')) + '\n')
print(f'season {season}')
print(f'{n_def} simulation profiles carry real steal/block/deflection rates')
print(f'{n_comp} contracts carry Savant comps')
print(f'{n_pro} draft-class contracts carry a college season')
if miss: print(f'  {len(miss)} profiles with no Savant row: {", ".join(miss[:8])}')
if unmatched: print(f'  no prospect row for: {", ".join(unmatched[:12])}')
