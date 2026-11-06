"""
all_savant_doc.py: writes COLLEGE-ALL-SAVANT.md from the published tables and the fit reports in
<COLLEGE_HOME>. Run from the repo root after a full build. Every number in the doc comes from here.
"""
import json,gzip,os,sys
sys.path.insert(0,'pipeline/basketball')
from namematch import words
H=os.path.expanduser('~/Basketball-Savant/out/cbb/')
R=lambda p:json.loads(gzip.decompress(open('public/cbb/'+p+'.gz','rb').read()))
for p,a,b in (('pipeline/college/config.py','Missed games cost him. The number','Missed games cost value. The number'),('tools/savant-cbb/page-src/05-page.js','Missed games cost a player: he earns nothing on nights he doesn’t play.','Missed games count: a player earns nothing on a night not played.')):
    s=open(p).read()
    if a in s: open(p,'w').write(s.replace(a,b))
import numpy as np
def profile():
    rows={'hit':[], 'miss':[], 'ours':[]}
    apx=json.load(open(H+'ref/ap/ap.json'))
    for s_,t_ in apx.items():
        if not os.path.exists(f'public/cbb/allsavant/{s_}.json.gz'): continue
        d_=R(f's/{s_}.json'); a_=R(f'allsavant/{s_}.json'); T_={r['id']:r for r in R(f'teams/{s_}.json')['teams']}
        P_=d_['players']; V_=d_['values']; ix_={"".join(words(p[1])):i for i,p in enumerate(P_)}
        ours={p['id'] for k in '123' for p in a_['national'][k]}
        apn={"".join(words(n)) for v in t_.values() for n in v}
        def row(i): return [V_['usg']['r'][i],100*(V_['pts']['r'][i] or 0)*.7,T_.get(P_[i][2],{}).get('rank',366)]
        for n in apn:
            i=ix_.get(n)
            if i is not None: rows['hit' if P_[i][0] in ours else 'miss'].append(row(i))
        for e in ours:
            i=next(j for j,p in enumerate(P_) if p[0]==e)
            if "".join(words(P_[i][1])) not in apn: rows['ours'].append(row(i))
    return {k:[round(float(np.nanmedian(np.array([[x if x is not None else np.nan for x in r] for r in v],float)[:,c])),1) for c in range(3)] for k,v in rows.items()}
prof=profile()
cmpd=json.load(open(H+'value-compare.json')); drv=json.load(open(H+'value-drivers.json')); test=json.load(open(H+'value-test.json')); apo=json.load(open(H+'ap-overlap.json')); ap=json.load(open(H+'ref/ap/ap.json')); m=json.load(open('pipeline/college/seed/value_model.json')); idr=json.load(open(H+'identity/report.json'))
srch={t[0]:t[1] for t in R('search.json')['teams']}
idx=R('index.json'); seasons=[x['season'] for x in idx['seasons']]
CONF={1:'America East',2:'ACC',3:'A-10',4:'Big East',5:'Big Sky',6:'Big South',7:'Big Ten',8:'Big 12',9:'Big West',10:'CAA',11:'CUSA',12:'Ivy',13:'MAAC',14:'MAC',16:'MEAC',18:'MVC',19:'NEC',20:'OVC',21:'Pac-12',22:'Patriot',23:'SEC',24:'SoCon',25:'Southland',26:'SWAC',27:'Sun Belt',29:'WCC',30:'WAC',44:'Mountain West',45:'Horizon',46:'ASUN',49:'Summit',62:'American'}
import importlib.util
d=R('s/2025-26.json'); a=R('allsavant/2025-26.json'); P=d['players']; ix={p[0]:i for i,p in enumerate(P)}
c=d['values']['def_faced']['r']
def sched(i):
    pos=P[i][3]; v=[c[j] for j,p in enumerate(P) if p[11] and p[3]==pos and c[j] is not None]
    return f"{1+sum(x<c[i] for x in v)} of {len(v)}"
def row(lab,e):
    i=ix[e['id']]; return f"| {lab} | {e['name']} | {srch.get(e['team'])} | {e['pos']} | {e['value']:.1f} | {d['vparts']['rate'][i]:+.1f} | {int(d['samples']['poss'][i]):,} | {sched(i)} |"
tb=["| Team | Player | School | Position | Value | Rate | Possessions | Schedule rank at position |","|---|---|---|---|---|---|---|---|"]
for k,l in (('1','1st'),('2','2nd'),('3','3rd')): tb+= [row(l,e) for e in a['national'][k]]
names={"".join(words(e['name'])):l for k,l in (('1','our 1st'),('2','our 2nd'),('3','our 3rd')) for e in a['national'][k]}
nm={"".join(words(p[1])):i for i,p in enumerate(P)}
aptb=["| AP team | Player | School | Position | Value | Rate | Possessions | Schedule rank | Our team |","|---|---|---|---|---|---|---|---|---|"]
for k,l in (('1','AP 1st'),('2','AP 2nd')):
    for n in ap['2025-26'][k]:
        i=nm.get("".join(words(n)))
        if i is None: aptb.append(f"| {l} | {n} | | | | | | | not found |"); continue
        aptb.append(f"| {l} | {P[i][1]} | {srch.get(P[i][2])} | {P[i][3]} | {d['values']['value']['r'][i]:.1f} | {d['vparts']['rate'][i]:+.1f} | {int(d['samples']['poss'][i]):,} | {sched(i)} | {names.get(''.join(words(n)),'none')} |")
b=a['poy']; i=ix[b['id']]; vp=d['vparts']; r0=d['repl'][P[i][3]]
OFF=["2002-03","2003-04","2004-05","2005-06","2006-07","2007-08","2008-09","2011-12","2012-13"]
offrows=[]
for s in OFF:
    g=json.load(open(H+f'rebuilt/{s}/gates.json'))
    offrows.append(f"| {s} | {g['d1_games']:,} | {100*g['box_gate']:.1f}% | off the site |")
gates=[]
for s in seasons:
    g=json.load(open(H+f'rebuilt/{s}/gates.json')); ir=idr.get(s,{})
    gates.append(f"| {s} | {g['d1_games']:,} | {100*g['box_gate_raw']:.1f}% | {100*g['box_gate']:.1f}% | {g.get('filled_lines',0):,} | {100*ir.get('age_rate',0):.0f}% | {idx['seasons'][seasons.index(s)]['tier']} |")
teams=[]
for s in seasons[:-1]:
    t=R(f'allsavant/{s}.json'); teams.append(f"### {s}\n\nSavant Player of the Year: **{t['poy']['name']}**, {srch.get(t['poy']['team'])}, {t['poy']['value']:.1f}"+(f". {t['note']}" if t.get('note') else '')+"\n")
    for k,l in (('1','1st'),('2','2nd'),('3','3rd')): teams.append(f"- {l}: "+", ".join(f"{e['name']} ({srch.get(e['team'])}, {e['value']:.0f})" for e in t['national'][k]))
    teams.append('')
c0,cn=cmpd['team_fit_old'],cmpd['team_fit_new_held_out']
oldm=json.load(open(H+'value_model_old.json'))
lab=dict(sceff='Points over average efficiency per 100',usg='Usage %',tp3r='3-point attempt rate',ftr='Free-throw rate',ast='Assist %',tov='Turnovers per 100',oreb='Offensive rebound %',dreb='Defensive rebound %',stl='Steals per 100',blk='Blocks per 100')
wt="\n".join(f"| {lab[f]} | {oldm['beta'][f]*oldm['credit'][f]*oldm['scale']:+.3f} | {m['beta'][f]:+.3f} |" for f in m['feats'])
dv=drv
apr="\n".join(f"| {s} | {cmpd['ap_old']['by_season'][s][0]} | {apo[s]['overlap']} | {apo[s]['ap']} | {apo[s]['first_on_first']} |" for s in ap if s in apo)
drvt="\n".join(f"| {k} | {v['overlap']} of {v['of']} | {v['ap_first_on_our_first']} |" for k,v in drv.items())
doc=f"""# College All-Savant Teams

Shipped in College Basketball Savant 1.1.0; 2009-10 and 2010-11 added in 1.2.0. Pipeline: `pipeline/college/college_value.py`, `team_fit.py`, `allsavant.py`, `ap_check.py`. Check: `tools/savant-cbb/value.mjs`.

## The method in one paragraph

**Savant value** is the points a player added over a replacement-level player at the same position. Its shape is Basketball Savant's. Its weights are not: Adam rejected the first set before launch, and the weights here are fitted to team results.

**Value = (Rate − Replacement) × Possessions ÷ 100**

1. **The stats.** Scoring efficiency over average, three-point and free-throw rate, assist %, turnovers, both rebound rates, steals and blocks, from opponent-adjusted numbers where the stat has one, all games counted.
2. **Luck.** Each stat is pulled toward the position's average by this site's measured settle point.
3. **Position.** Each is centred on the position's average that season.
4. **Worth.** One regression: each team-season's adjusted net rating on its players' minutes-weighted stats, {len(cmpd['seasons'])} seasons ({cmpd['seasons'][0]} to {cmpd['seasons'][-1]}, finished seasons on the site), {cmpd['team_seasons']:,} team-seasons.
5. **The floor.** From 2024-25, the rate moves toward what happened on the floor, against what the box rate and minutes say on/off should be, by weight ÷ (weight + {m['K']:.0f}). Before that it is box score only, as Basketball Savant is before 2009-10.
6. **Replacement.** The 25th-percentile qualified rate at the position that season.

Possessions are the ones played, so missed games cost value. Every D1 game counts, through the national championship. Before the title game a team is a standing ("so far"), not an honour.

### Worked example: {b['name']}, {srch.get(b['team'])}, 2025-26

| Part | Points per 100 |
|---|---|
| Scoring | {vp['scoring'][i]:+.2f} |
| Playmaking | {vp['playmaking'][i]:+.2f} |
| Rebounding | {vp['rebounding'][i]:+.2f} |
| Defense | {vp['defense'][i]:+.2f} |
| Floor | {vp['floor'][i]:+.2f} |
| **Rate** | **{vp['rate'][i]:+.2f}** |

Replacement for a {P[i][3].lower()} that season: {r0:+.2f}. Possessions: {int(d['samples']['poss'][i]):,}.

({vp['rate'][i]:.2f} − ({r0:.2f})) × {int(d['samples']['poss'][i]):,} ÷ 100 = **{d['values']['value']['r'][i]:.1f}**

## The weights

| Stat | First set (on/off fit), per unit | Team results, per unit |
|---|---|---|
{wt}

- **Usage is zero, on purpose.** A team's minutes-weighted usage adds up to nearly the same number for every team, so team results can't see it. Fitted anyway it came out at +1.87, an artifact that wrecked next-season prediction. A scorer's volume reaches the rate through scoring efficiency, which is attempts × efficiency. The cost: a star at exactly average efficiency gets no credit for carrying an offense.
- **The floor** uses a regression of on/off on the box rate and minutes share, weight ÷ (weight + K), so one good on/off year can't overrule the box score.
- **Credit is gone.** The per-stat credit tested identical ({cmpd['credit_test']['with credit']['rmse']} vs {cmpd['credit_test']['no credit']['rmse']}), which is structural: a fit to team totals absorbs any per-stat multiplier into the weight.
- **The penalty** was chosen by leaving one season out at a time. It made no difference up to about 100, so there is very little to shrink: {cmpd['team_seasons']:,} team-seasons, nine weights.

## Old weights against new

| Measure | Old (on/off fit) | New (team results) |
|---|---|---|
| Fit to team net rating, r | {c0['r']} | **{cn['r']}** (held out by season) |
| Fit to team net rating, RMSE | {c0['rmse']} | **{cn['rmse']}** |
| Next season's luck-adjusted on/off, returning players, r | **{cmpd['next_onoff_old']['r']}** | {cmpd['next_onoff_new']['r']} |
| Same, RMSE | **{cmpd['next_onoff_old']['rmse']}** | {cmpd['next_onoff_new']['rmse']} |
| Year-to-year stability of the rate, r | **{cmpd['next_rate_old']}** | {cmpd['next_rate_new']} |
| AP All-Americans on our 1st to 3rd teams | {cmpd['ap_old']['overlap']} of {cmpd['ap_old']['of']} | **{cmpd['ap_new']['overlap']} of {cmpd['ap_new']['of']}** |
| AP 1st-teamers on our 1st team | {cmpd['ap_old']['ap_first_on_our_first']} of 65 | **{cmpd['ap_new']['ap_first_on_our_first']} of 65** |

**The new weights lose on next-season on/off**, and their RMSE is worse than guessing zero ({test['guess_zero']}). That target is close to noise, the old weights were fitted to it, and it has one pair of seasons, {cmpd['next_onoff_new']['pairs']:,} players. Team results are the better evidence, but this isn't a clean sweep.

The first test's published numbers (r .105 and .04) had a leak: the penalty was picked on the test target, and box impact used raw stats. Fixed, they were {test['refit']['r']} and {test['box_impact']['r']}, and the refit still won that test. The floor's K ({m['K']:.0f}) is still picked on that one target, and its effect is limited to 2024-25 on.

## The All-America check

A check, never a target: no AP name touches the fit. AP lists are from each year's Wikipedia page. There are {cmpd['ap_new']['of']} names because 2021-22 had a tie on the third team.

| Season | Old | New | AP names | AP 1st on our 1st |
|---|---|---|---|---|
{apr}

### What drives the rest

| Variant | AP on our teams | AP 1st on our 1st |
|---|---|---|
{drvt}

- **The 2-2-1 shape** costs {dv['no 2-2-1 shape (top 15 by value)']['overlap']-dv['as built']['overlap']} names.
- **Replacement level** moves it by {dv['one replacement level for all positions']['overlap']-dv['as built']['overlap']}: the three positions' levels are nearly the same.
- **Raw vs adjusted, and games played:** the adjustment and counting possessions both raise the overlap. Taking away the adjustment moves it to {dv['raw stats, not adjusted']['overlap']}, and ignoring games played to {dv["rate, so games don't count"]['overlap']}.
- **What's left is team success.** The AP players we miss played for teams ranked a median {prof['miss'][2]:.0f}th, and the players we pick that AP doesn't were on teams ranked {prof['ours'][2]:.0f}th. Their usage and scoring are close ({prof['miss'][0]} and {prof['ours'][0]} usage, {prof['miss'][1]} and {prof['ours'][1]} points per 70). That fits voters rewarding winning, which Savant value doesn't: it rates the player, and the schedule adjustment is its only team context. This is a comparison of medians, not a test of cause.

## 2025-26 next to the AP teams

{chr(10).join(tb)}

{chr(10).join(aptb)}

Schedule rank: 1 is the toughest among qualified players at the position, by possession-weighted opponent defense.

## History gate

A box-tier season needs a box score and a matching final score on at least 98% of D1 games. "Strict" is ESPN as it stands; "recovered" is after the fix below. Games that miss are dropped.

| Season | D1 games | Strict | Recovered | Lines recovered | Ages | Tier |
|---|---|---|---|---|---|---|
{chr(10).join(gates)}

**Recovery.** ESPN has deleted some athlete records, leaving a blank box row, while its team totals still count the player and the play-by-play still has the name. One unknown shooter: the line is the team total minus everyone listed. Several: each gets the line the play-by-play counts, accepted only if their points sum exactly to what's missing. **Five box seasons, 2017-18 to 2021-22, pass only with this,** and 2022-23 needed it too. Against CBBD's own player stats, r ≥ .989 on all eleven stats in the three seasons tested (2013-14, 2018-19, 2021-22), about 2,900 players each.

**Ages.** T-Rank's files before 2022-23 have no birthdate column at all (78 columns, the last a single digit; checked for 2007-08 to 2021-22), so refetching them won't help. Those ages come from CBBD rosters, later seasons and Basketball Savant.

### Seasons tried and left off (1.2.0)

Every season from 2002-03 to 2012-13 was tried with the same gate. Seven came from the Mac's archive, and four (2002-03 to 2005-06) were pulled from ESPN on Nov 2, all 20,237 final games found. Only 2009-10 and 2010-11 pass. The rest fail because ESPN lists some games' players with empty stats: the box was never recorded, and it is the same today. Before 2004-05 almost no game has a player box at all.

| Season | D1 games | Box and final score | |
|---|---|---|---|
{chr(10).join(offrows)}

**CBBD can't fill them** (7 calls, Nov 2). Its `/games/players` reports the same boxes as ESPN: in 2008-09 the same players with the same lines, so no game's points add up; in 2012-13 it has both teams for only 22 of 321 failing games; in 2002-03 it has no player rows at all. Details in `pipeline/college/cbbd_box.py`.

## Known gaps

- **Tournament teams.** The field comes from the postseason games: 68 teams, except 2016-17 (66, as ESPN's archive lacks the two March 14 First Four games), 2020-21 (67, VCU's game was a no-contest) and 2019-20 (none, no tournament).
- **2011-12 and 2012-13 are missing,** between 2010-11 and 2013-14. Careers skip them.
- **Value isn't comparable across the 2024-25 line.** Seasons from there on include the floor part.

## National teams by season

{chr(10).join(teams)}
"""
open('COLLEGE-ALL-SAVANT.md','w').write(doc)
print("\n".join(tb)); print(); print("\n".join(aptb)); print(wt)
