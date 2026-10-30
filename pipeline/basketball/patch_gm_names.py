"""
Fix the join between the contract sheet and the ratings, and give every contract a rating.

Three separate failures, all of which made players into interchangeable replacement-level
filler — which is how a trade engine ends up offering Deni Avdija for Ron Holland:

1. NAMES. Basketball-Reference writes "Nikola Jokić" and "Jimmy Butler"; Savant writes
   "Nikola Jokic" and "Jimmy Butler III". Eighty-seven of 470 contracts matched nothing,
   and the two best players in basketball were rated as replacement bodies. Normalising
   (strip diacritics, punctuation and suffixes, casefold) recovers twenty-seven, Luka
   Dončić and Jokić among them.

2. PLAYERS WHO MISSED THE WHOLE SEASON. Tyrese Haliburton, Kyrie Irving, Damian Lillard
   and Fred VanVleet have no 2025-26 row because they did not play. They are not
   replacement level; they are stars on the shelf. Fall back to their most recent real
   season, aged forward, and mark it stale.

3. ACTUAL ROOKIES. The 2026 draft class has never played an NBA game, so there is nothing
   to read. But their salary IS their draft slot — rookie scale is a published table — so
   the empirical pick curve gives an honest prior: a number one pick projects like a
   number one pick rather than like a minimum contract.

  python patch_gm_names.py
"""
import json, os, re, sys, unicodedata

REPO = os.path.expanduser('~/mnt/western-conference-elitists')
SEEDJS = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/src/lib/gm/seed.js'

def norm(n):
    s = unicodedata.normalize('NFKD', n or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace('.', '').replace("'", '').replace('-', ' ').replace('`', '')
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    return re.sub(r'\s+', ' ', s).strip()

players = json.load(open('out/players.json'))['data']
seasons = sorted(players)              # oldest -> newest
skills = json.load(open('out/skills.json'))['data']
positions = json.load(open('out/positions.json'))['data']

def val(p, k):
    m = p['m'].get(k)
    return m['season']['v'] if m and m.get('season') else None

# name -> (row, season) for the most recent season a player appears in
index = {}
initials = {}
for s in seasons:
    for p in players[s]['players']:
        k = norm(p['name'])
        index[k] = (p, s)
        # "Ron Holland" and "Ronald Holland II" normalise differently and always will.
        # First initial plus surname catches the nickname class; collisions are dropped
        # rather than guessed at, because a wrong join is worse than a missing one.
        parts = k.split()
        if len(parts) >= 2:
            ik = parts[0][0] + ' ' + parts[-1]
            prev = initials.get(ik, 'unset')
            if prev == 'unset':
                initials[ik] = (p, s)
            elif prev is None:
                pass
            elif prev[0]['id'] != p['id']:
                initials[ik] = None

src = open(SEEDJS).read()
head, body = src.split('export const SEED = ', 1)
seed = json.loads(body.rstrip().rstrip(';'))
latest = seasons[-1]

# The rookie-scale table implies a draft slot, and the pick curve implies an outcome.
SCALE = seed['picks']['slotValue']
def slot_from_salary(s):
    # rookie scale ~ 12.5M * pick^-0.43 (fitted in offseason.js); invert it
    if not s or s < 1.4e6:
        return None
    slot = (12_500_000 / s) ** (1 / 0.43)
    return max(1, min(60, round(slot)))

# Expected first-four-year VORP by pick, from the same 328-player join the pick curve uses.
def rookie_vorp(slot):
    # 9.28 total VORP over four years at pick 1, 1.36 at picks 21-30 (value_engine.py)
    per4 = 9.28 * (slot ** -0.62)
    return round(per4 / 4.0, 3)

stats = {'exact': 0, 'normalised': 0, 'stale': 0, 'rookie': 0, 'none': 0}
for team, roster in seed['rosters'].items():
    for p in roster:
        if 'bpm' in p and 'pid' in p and 'a' in p:
            stats['exact'] += 1
            continue
        k = norm(p['n'])
        hit = index.get(k)
        if not hit:
            parts = k.split()
            if len(parts) >= 2:
                cand = initials.get(parts[0][0] + ' ' + parts[-1])
                hit = cand if cand and cand != 'unset' else None
        if hit:
            row, season = hit
            bpm, avail, mpg = val(row, 'bpm'), val(row, 'avail'), val(row, 'mpg')
            pid = str(row['id'])
            p['pid'] = pid
            gap = seasons.index(latest) - seasons.index(season)
            if bpm is not None:
                # A season that is not the current one is worth less: age forward and widen.
                decay = 0.0 if gap == 0 else (-0.35 * gap)
                p['bpm'] = round(bpm + decay, 1)
                if gap:
                    p['stale'] = season
                    stats['stale'] += 1
                else:
                    stats['normalised'] += 1
            if avail is not None:
                p['av'] = round(avail, 1) if not gap else round(min(avail, 70.0), 1)
            if mpg is not None and not p.get('mpg'):
                p['mpg'] = round(mpg, 1)
            # Age drives the projection, the control premium and the timeline guard. Left
            # missing it defaulted to 26 for everyone, which made a 31-year-old MVP and a
            # 19-year-old lottery pick the same age.
            if row.get('age') is not None:
                p['a'] = round(row['age'] + gap, 2)
            if row.get('exp') is not None and 'exp' not in p:
                p['exp'] = row['exp'] + gap
            # VORP is the currency the trade engine anchors on, so set it directly rather
            # than making it round-trip through box plus/minus.
            if bpm is not None and 'v' not in p:
                mp = p.get('mpg') or mpg or 20
                av2 = (p.get('av') or 75) / 100.0
                p['v'] = round((p['bpm'] + 2.0) * (mp * av2) / 48.0, 3)
            sk = (skills.get(season, {}).get(pid, {}) or {}).get('s', {}) or {}
            for field, key in (('sh', 'shooting_3'), ('gr', 'gravity'), ('rp', 'rim_protection'),
                               ('pd', 'perimeter_def'), ('pm', 'playmaking'), ('sc', 'self_creation'),
                               ('sz', 'size'), ('rpr', 'rim_pressure'), ('bs', 'ball_security')):
                v = sk.get(key)
                if v and field not in p:
                    p[field] = round(v.get('vs', v['v']), 1)
            slot = (positions.get(season, {}).get(pid, {}) or {}).get('slot')
            if slot is not None and 'slot' not in p:
                p['slot'] = round(slot, 2)
            continue
        # No NBA season at all: a 2026 draftee. His salary is his draft slot.
        # Only a FIRST-year rookie deal tells you the draft slot. Rookie scale rises about
        # 13% a year, so reading a third-year salary as a first-year one turned every
        # unmatched young player into a lottery pick — Ron Holland came out as the number
        # two selection.
        slot = slot_from_salary(p['s']) if (p.get('yr') or 0) >= 4 else None
        if slot:
            v = rookie_vorp(slot)
            # VORP = (BPM + 2) x minutes / 48, so invert at a rookie's minutes.
            mpg = 12 + max(0, (31 - slot)) * 0.45
            p['mpg'] = round(mpg, 1)
            # Year one is below the four-year average; the aging curve carries him up.
            p['v'] = round(v * 0.6, 3)
            p['bpm'] = round((p['v'] * 48 / max(6, mpg)) - 2, 1)
            p['av'] = 88
            p['a'] = 19.5 + (slot / 60.0)
            p['exp'] = 0
            p['rookie_slot'] = slot
            stats['rookie'] += 1
        else:
            # Unmatched and not a rookie: a two-way conversion, a 10-day, or dead money.
            # A modest prior, not a star and not a hole in the roster.
            p['bpm'] = -2.2
            p['av'] = 70
            p['mpg'] = 11
            p['v'] = round((p['bpm'] + 2.0) * (11 * 0.7) / 48.0, 3)
            p['a'] = p.get('a', 25)
            stats['none'] += 1

open(SEEDJS, 'w').write(head + 'export const SEED = ' + json.dumps(seed, separators=(',', ':')) + '\n')
rated = sum(1 for t in seed['rosters'] for p in seed['rosters'][t] if 'bpm' in p)
total = sum(len(r) for r in seed['rosters'].values())
print(f'rated contracts: {rated}/{total}')
print(f'  already matched {stats["exact"]}, recovered by normalising {stats["normalised"]}, '
      f'from an earlier season {stats["stale"]}, from draft slot {stats["rookie"]}, '
      f'still unrated {stats["none"]}')
