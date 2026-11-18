"""Shots, points sources, runs/droughts and opponent impact for the v4 mockups.
Usage: python3 -I code/snapshot_shots.py <code_dir> <live.json> <out.json>
Reads OU vs MVSU (401906802) up to the snapshot cut stored in live.json."""
import sys, json, gzip, collections, re
sys.path.insert(0, sys.argv[1]); import parse
L = json.load(open(sys.argv[2])); OUT = sys.argv[3]
OU = '201'; RIM = parse.RIM_TYPES
g = json.load(gzip.open('bt/ou27/games/401906802.json.gz'))
cut = L['cut']
names = {a[0]: a[1] for t, ath in g['box'].items() for a in ath}
team_of = {a[0]: t for t, ath in g['box'].items() for a in ath}
el = lambda p: parse.elapsed(p[0], p[1])
plays = [p for p in g['plays'] if el(p) <= cut]
side = lambda tid: 'OU' if tid == OU else 'OPP'

# ---- possessions with start type (what ended the previous possession) ----
r, st = parse.parse_game(dict(g, plays=plays)); P = r['poss']
for i, p in enumerate(P):
    p['start'] = P[i - 1]['end'] if i else 'tip'
    p['start_t'] = P[i - 1]['t0'] if i else 0   # refined below
    p['t1'] = P[i + 1]['t0'] if i + 1 < len(P) else cut
# start time = time of the event that ended the previous possession; approximate with this possession's first event time
def poss_at(t, team):
    best = None
    for p in P:
        if p['t0'] <= t and p['off'] == team: best = p
        if p['t0'] > t: break
    return best

# ---- shots ----
shots = []
for p in plays:
    if not p[7] or 'FreeThrow' in p[3] or p[9] is None or p[10] is None or p[10] < -1: continue
    t = el(p); made = bool(p[6]); parts = p[8] or []
    shots.append(dict(team=side(p[2]), x=p[9], y=max(0, p[10]) + 5.25, made=made, ast=made and len(parts) >= 2,
                      shooter=names.get(parts[0], '?') if parts else '?', sid=parts[0] if parts else None,
                      three=p[5] == 3 or 'three point' in p[4], rim=p[3] in RIM, t=t,
                      dist=int(m.group(1)) if (m := re.search(r'(\d+)-foot', p[4])) else None))
# attach the OU five on the floor (by stint windows)
stints = L['stints']
for s in shots:
    for k, w in enumerate(stints):
        if w['t0'] <= s['t'] < w['t1'] or (k == len(stints) - 1 and s['t'] <= w['t1']):
            s['five'] = '|'.join(w['players']); break

# ---- points sources ----
# For each score, look back for the event that gave this team the ball: opponent turnover, own defensive rebound,
# or opponent made FG / last made FT. Then: off turnovers (start = turnover), fast break (live-ball start and the
# FG comes within 8 s), second chance (own offensive rebound after the start).
src = {'OU': collections.Counter(), 'OPP': collections.Counter()}
def start_of(i, team):
    for k in range(i - 1, -1, -1):
        q = plays[k]; ty = q[3]
        if q[2] != team and q[2] and 'Turnover' in ty: return 'tov', el(q), k
        if q[2] == team and ty == 'Defensive Rebound': return 'dreb', el(q), k
        if q[2] != team and q[2] and q[6] and q[5]: return 'make', el(q), k
        if ty in ('End Period',): return 'period', el(q), k
    return 'tip', 0, 0
events = []
for i, p in enumerate(plays):
    if not p[6] or not p[5]: continue
    t = el(p); team = p[2]; pts = p[5]; s = side(team); tags = []
    if 'FreeThrow' in p[3]: tags.append('Free throws')
    kind, t_s, k = start_of(i, team)
    if kind == 'tov': tags.append('Off turnovers')
    if any(plays[j][3] == 'Offensive Rebound' and plays[j][2] == team for j in range(k, i)): tags.append('Second chance')
    if kind in ('tov', 'dreb') and t - t_s <= 6 and 'FreeThrow' not in p[3]: tags.append('Fast break')
    for tg in tags: src[s][tg] += pts
    events.append(dict(team=s, t=t, pts=pts, tags=tags))

# ---- runs and droughts ----
seq = [(el(p), side(p[2]), p[5]) for p in plays if p[6] and p[5]]
runs = []; cur = None
for t, s, pts in seq:
    if cur and cur['team'] == s: cur['pts'] += pts; cur['t1'] = t
    else:
        if cur: runs.append(cur)
        cur = dict(team=s, pts=pts, t0=t, t1=t, opp_pts=0)
runs.append(cur)
# a "run" in basketball usage: X-Y where the other team scored little; compute best window: max (us - them) over windows
best = dict(margin=0)
for i in range(len(seq)):
    us = them = 0
    for j in range(i, len(seq)):
        t, s, pts = seq[j]
        if s == seq[i][1]: us += pts
        else: them += pts
        if us - them > best['margin'] and them <= 4:
            best = dict(team=seq[i][1], us=us, them=them, t0=seq[i][0], t1=t, margin=us - them)
last_fg = {}
for p in plays:
    if p[6] and p[7] and 'FreeThrow' not in p[3]: last_fg[side(p[2])] = el(p)
current_run = runs[-1]
# the run that is still going: consecutive unanswered points by the last team to score
cr = dict(team=current_run['team'], pts=current_run['pts'], since=current_run['t0'])
# include previous segments if the other side scored <= 2 in between (e.g. 9-2)
drought = {s: round(cut - last_fg.get(s, 0)) for s in ('OU', 'OPP')}

# ---- box score and impact (Hollinger game score components) ----
B = collections.defaultdict(collections.Counter)
for p in plays:
    parts = p[8] or []
    if not parts: continue
    pid = parts[0]; typ = p[3]
    if p[7] and 'FreeThrow' not in typ:
        B[pid]['fga'] += 1
        if p[5] == 3 or 'three point' in p[4]: B[pid]['3pa'] += 1
        if typ in RIM: B[pid]['rima'] += 1
        if p[6]:
            B[pid]['fgm'] += 1; B[pid]['pts'] += p[5]
            if p[5] == 3: B[pid]['3pm'] += 1
            if typ in RIM: B[pid]['rimm'] += 1
            if len(parts) >= 2: B[parts[1]]['ast'] += 1
    elif 'FreeThrow' in typ:
        B[pid]['fta'] += 1
        if p[6]: B[pid]['ftm'] += 1; B[pid]['pts'] += 1
    elif typ == 'Offensive Rebound': B[pid]['orb'] += 1
    elif typ == 'Defensive Rebound': B[pid]['drb'] += 1
    elif typ == 'Steal': B[pid]['stl'] += 1
    elif typ == 'Block Shot': B[pid]['blk'] += 1
    elif 'Turnover' in typ: B[pid]['tov'] += 1
    elif typ == 'PersonalFoul': B[pid]['pf'] += 1
mins = {r_['name']: r_['min'] for r_ in L['opp_players'] + L['ou_players']}
opp = []
for pid, b in B.items():
    if team_of.get(pid) == OU: continue
    sc = b['pts'] + .4 * b['fgm'] - .7 * b['fga'] - .4 * (b['fta'] - b['ftm'])
    pm = .7 * b['ast'] - b['tov']
    gl = .7 * b['orb'] + .3 * b['drb']
    df = b['stl'] + .7 * b['blk'] - .4 * b['pf']
    opp.append(dict(pid=pid, name=names[pid], min=mins.get(names[pid], 0), box=dict(b), scoring=round(sc, 1), playmaking=round(pm, 1),
                    glass=round(gl, 1), defense=round(df, 1), gs=round(sc + pm + gl + df, 1)))
opp.sort(key=lambda o: -o['gs'])

data = dict(events=events, shots=shots, sources={k: dict(v) for k, v in src.items()}, best_run=best, current_run=cr, drought=drought,
            opp_impact=opp, cut=cut)
json.dump(data, open(OUT, 'w'), indent=1)
print('shots', len(shots), 'OU', sum(s['team'] == 'OU' for s in shots), 'with five', sum('five' in s for s in shots))
print('sources', data['sources'])
print('best run', best, 'current', cr, 'drought', drought)
for o in opp[:5]: print(o['name'], o['min'], o['gs'], o['scoring'], o['playmaking'], o['glass'], o['defense'], o['box'])
# reconcile points
print('pts check', sum(s['made'] * (3 if s['three'] else 2) for s in shots if s['team'] == 'OU') + src['OU']['Free throws'], L['score'])
