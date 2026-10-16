import json
D = '/home/claude/spurs-article/nba/spurs-article-data/'
def rows(f, name=None):
    d = json.load(open(D+f)); sets = d.get('resultSets') or [d['resultSet']]
    s = sets[0] if name is None else [x for x in sets if x['name']==name][0]
    return [dict(zip(s['headers'], r)) for r in s['rowSet']]
IDS = {1628368:'Fox', 1642264:'Castle', 1642844:'Harper', 1641705:'Wemby', 1630170:'Vassell', 1630577:'Champagnie', 1629640:'K. Johnson', 203084:'Barnes'}
cs = rows('lg_track_CatchShoot.json'); pu = rows('lg_track_PullUpShot.json')
print([h for h in pu[0].keys()][:30])
cs = [r for r in cs if r['CATCH_SHOOT_FG3A'] is not None]; qual = [r for r in cs if r['CATCH_SHOOT_FG3A'] >= 150]
import statistics
lg = sum(r['CATCH_SHOOT_FG3M'] for r in cs)/sum(r['CATCH_SHOOT_FG3A'] for r in cs); print('league C&S 3P%', round(lg,4))
def pct(v, arr): return round(100*sum(1 for a in arr if a < v)/len(arr))
for r in cs:
    if r['PLAYER_ID'] in IDS:
        print(IDS[r['PLAYER_ID']], 'C&S 3P', r['CATCH_SHOOT_FG3M'], r['CATCH_SHOOT_FG3A'], r['CATCH_SHOOT_FG3_PCT'], 'pctile among 150+', pct(r['CATCH_SHOOT_FG3_PCT'], [q['CATCH_SHOOT_FG3_PCT'] for q in qual]))
for r in pu:
    if r['PLAYER_ID'] in IDS:
        print(IDS[r['PLAYER_ID']], 'PU 3P', r.get('PULL_UP_FG3M'), r.get('PULL_UP_FG3A'), r.get('PULL_UP_FG3_PCT'))
# closest defender on 3s
cd = {}
for key in ['0-2','2-4','4-6','6+']:
    for r in rows(f'lg_closedef_{key}.json'):
        cd.setdefault(r['PLAYER_ID'], {})[key] = (r.get('FG3M'), r.get('FG3A'))
print(list(rows('lg_closedef_6+.json')[0].keys()))
for pid, n in IDS.items():
    d = cd.get(pid, {}); tot = sum((d.get(k) or (0,0))[1] or 0 for k in d)
    if tot: print(n, {k: d[k] for k in d}, 'wide-open share', round((d.get('6+',(0,0))[1] or 0)/tot,3), 'open+wide', round(((d.get('6+',(0,0))[1] or 0)+(d.get('4-6',(0,0))[1] or 0))/tot,3))
json.dump(dict(cs=[{k:r[k] for k in ('PLAYER_ID','PLAYER_NAME','CATCH_SHOOT_FG3M','CATCH_SHOOT_FG3A','CATCH_SHOOT_FG3_PCT')} for r in cs], cd={str(k):v for k,v in cd.items()}), open('out/tracking.json','w'))
