import json, pandas as pd, numpy as np
OUT = '/home/claude/spurs-article/export/'
ps = pd.read_pickle('data/ps.pkl')
SH = {1628368:'Fox', 1642264:'Castle', 1642844:'Harper', 1641705:'Wemby', 1630170:'Vassell', 1630577:'Champagnie', 1629640:'K. Johnson', 203084:'Barnes', 1628436:'Kornet', 1642868:'Bryant'}
FULL = {1628368:"De'Aaron Fox", 1642264:'Stephon Castle', 1642844:'Dylan Harper', 1641705:'Victor Wembanyama', 1630170:'Devin Vassell', 1630577:'Julian Champagnie', 1629640:'Keldon Johnson', 203084:'Harrison Barnes', 1628436:'Luke Kornet', 1642868:'Carter Bryant'}
cur = ps[ps.yr==2025].drop_duplicates('id').set_index('id')
T = json.load(open('out/tracking.json')); cs = {r['PLAYER_ID']: r for r in T['cs']}; cd = {int(k): v for k, v in T['cd'].items()}
G = json.load(open('out/gamelogs.json'))
lab = json.load(open('out/lab_model.json'))
proj = json.load(open('data/proj_model.json'))
# ---- roster (usage builder + lab)
roster = []
for pid, s in SH.items():
    r = cur.loc[pid]; c = cs.get(pid, {}); d = cd.get(pid, {})
    tot = sum((d.get(k) or [0,0])[1] or 0 for k in ['0-2','2-4','4-6','6+'])
    po = [g for g in G.get(s, []) if g['t']=='po']
    roster.append(dict(id=pid, short=s, name=FULL[pid], pos=r.pos, usg=r.usg, obpm=r.obpm, dbpm=r.dbpm, bpm=r.bpm, tp3=r.tp3, tp3_n=int(r.tp3_n) if pd.notna(r.tp3_n) else 0, tp3a=r.tp3a,
        ft=r.ft, cs3=c.get('CATCH_SHOOT_FG3_PCT'), cs3a=c.get('CATCH_SHOOT_FG3A'), wo=round(((d.get('6+') or [0,0])[1] or 0)/tot*100,1) if tot else None, wop=round(100*((d.get('6+') or [0,0])[0] or 0)/((d.get('6+') or [0,0])[1] or 1),1) if ((d.get('6+') or [0,0])[1] or 0) >= 30 else None,
        onoff=r.onoffadj, mpg=r.mpg, ht=r.height, wt=r.strength, ast=r.ast, tov=r.tov))
json.dump(dict(roster=roster, modelA=lab['A'], modelB=lab['B']), open(OUT+'roster.json','w'), default=float)
# ---- asttov
json.dump(json.load(open('data/chart_asttov.json')), open(OUT+'asttov.json','w'))
# ---- respect (defender distance) for Spurs core + league buckets
lg = dict(wo=0.3897, open=0.3475, tight=0.3216)
resp = []
for pid in [1642264,1642844,1628368,1630170,1630577,1641705]:
    d = cd[pid]; g = lambda k: d.get(k) or [0,0]
    resp.append(dict(short=SH[pid], tight=[(g('0-2')[0] or 0)+(g('2-4')[0] or 0), (g('0-2')[1] or 0)+(g('2-4')[1] or 0)], open=g('4-6'), wide=g('6+'),
                     cs=[cs[pid]['CATCH_SHOOT_FG3M'], cs[pid]['CATCH_SHOOT_FG3A']]))
json.dump(dict(players=resp, league=lg, lg_cs=0.3711), open(OUT+'respect.json','w'))
# ---- trend: compact game logs
tr = {}
for s in ['Fox','Castle','Harper']:
    tr[s] = [[g['d'], 1 if g['t']=='po' else 0, g['p3m'], g['p3a'], g['ftm'], g['fta'], g['tov'], g['ast'], g['min'], g['opp']] for g in G[s]]
json.dump(dict(fields=['date','playoffs','3pm','3pa','ftm','fta','tov','ast','min','opp'], players=tr), open(OUT+'trend.json','w'))
# ---- shooting projector
def hist(pid):
    h = ps[ps.id==pid].sort_values('yr')
    return [dict(season=r.season, m=int(round(r.tp3/100*r.tp3_n)) if pd.notna(r.tp3_n) else 0, a=int(r.tp3_n) if pd.notna(r.tp3_n) else 0, ft=r.ft, fta=int(r.ft_n) if pd.notna(r.ft_n) else 0) for r in h.itertuples() if pd.notna(r.tp3)]
# "Last 25" is Basketball Savant's window: the team's last 25 regular-season games.
_t = json.load(open('nba/spurs-article-data/tgamelogs_rs.json'))['resultSets'][0]
_dates = sorted(r[_t['headers'].index('GAME_DATE')][:10] for r in _t['rowSet'])
LAST25 = set(_dates[-25:])
shoot = {}
for pid, s in [(1642264,'Castle'),(1642844,'Harper'),(1628368,'Fox'),(1630170,'Vassell'),(1630577,'Champagnie')]:
    rs = [g for g in G[s] if g['t']=='rs']; po = [g for g in G[s] if g['t']=='po']
    l25 = [g for g in rs if g['d'][:10] in LAST25]
    shoot[s] = dict(seasons=hist(pid)[-4:], l25=[sum(g['p3m'] for g in l25), sum(g['p3a'] for g in l25), sum(g['ftm'] for g in l25), sum(g['fta'] for g in l25)],
                    po=[sum(g['p3m'] for g in po), sum(g['p3a'] for g in po), sum(g['ftm'] for g in po), sum(g['fta'] for g in po)], model=proj['proj'].get(s))
fp = json.load(open('data/ft_prior.json'))
json.dump(dict(players=shoot, prior=dict(a=fp['a'], b=fp['b'], tau=fp['tau'], p=fp['p']), tsd=proj['tsd']), open(OUT+'shooting.json','w'), default=float)
# ---- playtypes
P = json.load(open('out/playtypes.json'))
PT = ['PRRollman','Cut','Spotup','Transition','Postup','Handoff','OffScreen','Isolation','PRBallHandler']
lbl = dict(PRRollman='Roll man', Cut='Cuts', Spotup='Spot-ups', Transition='Transition', Postup='Post-ups', Handoff='Handoffs', OffScreen='Off screens', Isolation='Isolation', PRBallHandler='P&R ball handler')
pt = dict(spurs=[dict(k=k, label=lbl[k], **P['team'][f'{k}|offensive']) for k in PT], league={k: P['team'][f'{k}|lg'] for k in PT},
          wemby=[dict(k=k, label=lbl[k], **P['players'][f'Wemby|{k}|offensive']) for k in PT if f'Wemby|{k}|offensive' in P['players']])
json.dump(pt, open(OUT+'playtypes.json','w'))
# ---- lineups (trimmed)
L = json.load(open('out/lineups_sas.json'))
lu = dict(k=L['k'], team=L['team'])
for key in ['rs2','rs3','rs4','rs5','po2','po3','po4','po5']:
    n = int(key[-1]); keep = [u for u in L[key] if u['min'] >= (5 if n >= 4 else 3)]
    lu[key] = [dict(p=u['p'], min=u['min'], poss=u['poss'], pm=u['pm'], ortg=u['ortg'], drtg=u['drtg'], net=u['net'], adj=u['adj'], est=u['est']) for u in keep]
json.dump(lu, open(OUT+'lineups.json','w'))
import os
for f in os.listdir(OUT): print(f, os.path.getsize(OUT+f))

import math
def clean(o):
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)): return None
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    return o
for f in os.listdir(OUT):
    if f.endswith('.json') and f != 'body.json':
        d = json.load(open(OUT+f)); json.dump(clean(d), open(OUT+f, 'w'), separators=(',', ':'))
print('cleaned')
