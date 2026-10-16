import json, glob, collections, re
fs = sorted(glob.glob('nba/spurs-article-data/pbp/*.json'))
lob = collections.Counter(); wemb_ast = collections.Counter(); dunks = collections.Counter(); seasons = collections.Counter()
games = 0; ex = []
for f in fs:
    gid = f.split('/')[-1][:-5]; typ = {'002':'rs','004':'po','001':'pre'}[gid[:3]]
    acts = json.load(open(f))['game']['actions']; games += 1
    for a in acts:
        if a.get('teamTricode') != 'SAS' or a.get('personId') != 1641705: continue
        if a.get('isFieldGoal') != 1 or a.get('shotResult') != 'Made': continue
        desc = a.get('description','')
        m = re.search(r'\((\S+) (\d+) AST\)', desc)
        passer = m.group(1) if m else None
        st = (a.get('subType') or '') + ' ' + desc
        if 'Alley Oop' in st or 'alley oop' in st.lower():
            lob[(typ, passer)] += 1
            if len(ex) < 4: ex.append(desc)
        if passer: wemb_ast[(typ, passer)] += 1
print('games', games); print('examples', ex)
for typ in ('rs','po','pre'):
    print(typ, 'lobs by passer', sorted([(p, c) for (t,p),c in lob.items() if t==typ], key=lambda x:-x[1])[:8])
    print(typ, 'assisted Wemby FG by passer', sorted([(p, c) for (t,p),c in wemb_ast.items() if t==typ], key=lambda x:-x[1])[:8])
json.dump(dict(lobs={f'{t}|{p}':c for (t,p),c in lob.items()}, ast={f'{t}|{p}':c for (t,p),c in wemb_ast.items()}), open('out/lobs.json','w'))
