/* NBA Savant · the Teams and Lineups tabs, and one page per team (2.10.0, #team=ATL).
 *
 * Data: savant-teams.json (finished seasons) + savant-teams-current.json (the season in
 * progress, rebuilt with every refresh) and lineups/<season>.json, all from
 * ~/Basketball-Savant/teams_engine.py. The engine builds teams from 1996-97 and lineups from
 * 2007-08, but the published files start in 2018-19: the Oct 14 2026 backfill of the older
 * seasons never ran (logs/backfill.log ends at a full disk). The pages follow whatever seasons the
 * files hold. Team pages also read NBA Savant's player data (DATA, the roster and Savant value),
 * bcs/t/<team>-<season>.json (the head coach) and bcs/heads.json (photos and team colours).
 * Styles and the explainer click handler come from savant-fantasy.js. Every column name opens
 * its explainer.
 */
(function(){
'use strict';
var D=document;
function $(id){ return D.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function ok(v){ return v!=null&&isFinite(v); }
function f1(v){ return ok(v)?(Math.round(v*10)/10).toFixed(1):'—'; }
function f0(v){ return ok(v)?String(Math.round(v)):'—'; }
function pc(v){ return ok(v)?(v*100).toFixed(1):'—'; }
function sg(v,d){ if(!ok(v)) return '—'; var s=Math.abs(v).toFixed(d==null?1:d); return (v>0.0001?'+':v<-0.0001?'−':'')+s; }
function th(lab,k,cls){ return '<th class="xk'+(cls?' '+cls:'')+'" data-k="'+k+'" title="What is this? Click">'+lab+'</th>'; }
function xk(text,k){ return '<span class="xk" data-k="'+k+'" title="What is this? Click">'+text+'</span>'; }

var T={data:null, loading:null, season:null, sort:'adjnet', page:null, pageSeason:null, lu:{}, luSeason:null, luN:'5', luTeam:'', luMin:null, luSort:'est', luQ:''};
function mergeTeams(a,c){
  if(!a) a={seasons:[],data:{}};
  if(!c||!c.data) return a;
  var out={seasons:a.seasons.slice(), data:Object.assign({},a.data), k:a.k||c.k, lineup_seasons:(a.lineup_seasons||[]).slice(), current:null};
  (c.seasons||[]).forEach(function(s){
    var b=c.data[s]; if(!b) return;
    if(b.preseason){ out.upcoming={season:s, sched:{}}; (b.teams||[]).forEach(function(t){ out.upcoming.sched[t.abbr]=t.sched; }); return; }
    out.data[s]=b; if(out.seasons.indexOf(s)<0) out.seasons.unshift(s); out.current=s;
    if(out.lineup_seasons.indexOf(s)<0) out.lineup_seasons.unshift(s);
  });
  out.seasons.sort(function(x,y){ return parseInt(y,10)-parseInt(x,10); });
  out.lineup_seasons.sort(function(x,y){ return parseInt(y,10)-parseInt(x,10); });
  return out;
}
function load(){
  if(T.data) return Promise.resolve(T.data);
  if(T.loading) return T.loading;
  var j=function(u,c){ return fetch(u,{cache:c}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }); };
  T.loading=Promise.all([j('savant-teams.json','default'),j('savant-teams-current.json','no-cache')]).then(function(a){
    if(!a[0]&&!a[1]) return null;
    T.data=mergeTeams(a[0],a[1]);
    // the season in progress only once it has ~10 games; before that, last season leads
    var s=T.data.seasons[0], b=T.data.data[s];
    if(b&&b.teams&&b.teams.length&&b.teams[0].gp<10&&T.data.seasons[1]) s=T.data.seasons[1];
    T.season=T.season||s; T.luSeason=T.luSeason||s;
    return T.data;
  });
  return T.loading;
}
function loadLineups(s){
  if(T.lu[s]) return Promise.resolve(T.lu[s]);
  return fetch('lineups/'+s+'.json',{cache:s===(T.data&&T.data.current)?'no-cache':'default'}).then(function(r){ return r.ok?r.json():null; })
    .catch(function(){ return null; }).then(function(d){ if(d) T.lu[s]=d; return d; });
}
function open(which){
  var v=$(which==='tm'?'svTm':'svLu');
  if(!T.data){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">'+(which==='tm'?'Teams':'Lineups')+'</h1><div class="sv-sub">Loading…</div></div></div>';
    load().then(function(d){ if(!d){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">'+(which==='tm'?'Teams':'Lineups')+'</h1><div class="sv-sub sv-warn">Team data isn’t available right now.</div></div></div>'; return; }
      show(which); });
    return;
  }
  show(which);
}
/* The Teams tab draws the all-30 table at #teams and one team's page at #team=ATL (the newest
   season) or #team=ATL&s=2023-24 (any other). The address is read every time the tab opens, so
   a fresh load, a reload, Back and a pasted link all land on the same view. */
function show(which){
  if(which!=='tm'){ untitle(); renderLineups(); return; }
  var r=parseTeamHash(location.hash);
  if(r){ T.page=r.team; T.pageSeason=r.season||T.data.seasons[0];
    if(location.search) try{ history.replaceState(history.state,'',location.pathname+location.hash); }catch{}   // drop a stray ?p=&s=
    renderTeamPage(); }
  else { T.page=null; untitle(); renderTeams(); }
}
function parseTeamHash(h){
  if(!h||h.indexOf('#team=')!==0) return null;
  var q={}; h.slice(1).split('&').forEach(function(kv){ var a=kv.split('='); if(a[0]) q[a[0]]=decodeURIComponent(a[1]||''); });
  return q.team?{team:q.team.toUpperCase(), season:q.s||null}:null;
}
/* The season is left off the address when it is the newest one the Teams tab has, the same rule
   the connector's links use (api/_basketball.js teamUrl). */
function teamHash(abbr,season){
  var newest=T.data&&T.data.seasons[0];
  return '#team='+encodeURIComponent(abbr)+(season&&season!==newest?'&s='+encodeURIComponent(season):'');
}
function goTeam(abbr,season){
  try{ history.pushState({sv:'tm'},'',location.pathname+teamHash(abbr,season)); }catch{}   // no ?p=: a team's address is only its own
  T.page=abbr; T.pageSeason=season; renderTeamPage(); window.scrollTo(0,0);
}
var TITLE0=D.title;
function untitle(){ if(D.title!==TITLE0) D.title=TITLE0; }
function rankOf(teams,key,lowGood){
  var vals=teams.map(function(t){ return getv(t,key); }).filter(ok).sort(function(a,b){ return lowGood?a-b:b-a; });
  return function(v){ if(!ok(v)) return null; return vals.indexOf(v)+1; };
}
function getv(t,k){
  var ff=t.ff||{};
  switch(k){
    case 'efg':return ff.efg; case 'tov':return ff.tov; case 'orb':return ff.orb; case 'ftr':return ff.ftr;
    case 'oefg':return ff.oefg; case 'otov':return ff.otov; case 'drb':return ok(ff.oorb)?1-ff.oorb:null; case 'oftr':return ff.oftr;
    case 'wpct':return t.gp?t.w/t.gp:null;
    case 'left':case 'b2b':case 'sos':case 'oppb2b':case 'next7': return t.sched?t.sched[k]:null;
    default: return t[k];
  }
}
var LOW_GOOD={drtg:1,tov:1,oefg:1,oftr:1,b2b:1,sos:1,adjd:1};

/* ------------------------------------------------------------------ Teams */
/* A season's 30 teams, with next season's schedule laid over them in the preseason (the table
   and the team page rank the same rows). */
function seasonTeams(s){
  var d=T.data, b=d.data[s]||{teams:[]};
  var up=d.upcoming&&d.seasons[0]===s?d.upcoming:null;
  return {up:up, teams:b.teams.map(function(t){ var c=Object.assign({},t); if(up&&up.sched[t.abbr]) c.sched=up.sched[t.abbr]; return c; })};
}
function renderTeams(){
  var v=$('svTm'), d=T.data, s=T.season, st=seasonTeams(s), up=st.up, teams=st.teams;
  var hasSched=teams.some(function(t){ return t.sched; });
  var cols=[['w','W-L','tm_wl'],['net','Net','tm_net'],['adjnet','Luck-adj net','tm_adjnet'],['ortg','ORtg','tm_ortg'],['drtg','DRtg','tm_drtg'],['pace','Pace','tm_pace'],
    ['pythw','Pyth W','tm_pythw'],['xw','Exp. W','tm_xw'],['luck','Luck','tm_luck'],['efg','eFG%','tm_efg'],['tov','TOV%','tm_tov'],['orb','ORB%','tm_orb'],['ftr','FT rate','tm_ftr'],
    ['oefg','Opp eFG%','tm_oefg'],['otov','Opp TOV%','tm_otov'],['drb','DRB%','tm_drb'],['oftr','Opp FT rate','tm_oftr'],['fg3r','3PA rate','tm_fg3r']];
  if(hasSched) cols=cols.concat([['left','Games left','tm_left'],['next7','Next 7','tm_next7'],['b2b','B2Bs left','tm_b2b'],['oppb2b','Opp. on B2B','tm_oppb2b'],['sos','SOS','tm_sos']]);
  var sk=T.sort, lowg=LOW_GOOD[sk];
  teams.sort(function(a,b2){ var x=getv(a,sk==='w'?'wpct':sk), y=getv(b2,sk==='w'?'wpct':sk); if(!ok(x)) return 1; if(!ok(y)) return -1; return lowg?x-y:y-x; });
  var h='<div class="sv-head"><div><h1 class="sv-title">Teams <em>Savant</em></h1><div class="sv-sub">'+esc(s)+' · every team’s ratings, four factors, shot diet, play types'+(hasSched?' and the schedule ahead':'')+'</div></div>'
    +'<div class="sv-sub">'+(up?'Ratings are '+esc(s)+'; schedule columns are '+esc(up.season)+'.':'')+'</div></div>';
  h+='<div class="sv-ctl"><div class="sv-f"><label>Season</label><select id="tmSeason">'+d.seasons.map(function(x){ return '<option'+(x===s?' selected':'')+'>'+x+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>Sort by</label><select id="tmSort">'+cols.map(function(c){ return '<option value="'+c[0]+'"'+(sk===c[0]?' selected':'')+'>'+c[1]+'</option>'; }).join('')+'</select></div></div>';
  h+='<div class="sv-sec"><div class="sv-expl"></div><p class="sv-note">Click a team for its own page: ratings with ranks, shot diet, play types, roster with Savant value, lineups, coach and every stat ranked. Click any column name for how it’s built.</p>';
  h+='<div class="sv-tw"><table class="sv-t"><tr><th>#</th><th class="l">Team</th>'+cols.map(function(c){ return th(c[1],c[2]); }).join('')+'</tr>'
    +teams.map(function(t,i){ return '<tr><td>'+(i+1)+'</td><td class="l"><a class="pl" href="'+esc(teamHash(t.abbr,s))+'" data-team="'+esc(t.abbr)+'">'+esc(t.name||t.abbr)+'</a></td>'
      +cols.map(function(c){ return '<td'+(c[0]===sk?' class="big"':'')+'>'+tmFmt(c[0],t)+'</td>'; }).join('')+'</tr>'; }).join('')+'</table></div></div>';
  v.innerHTML=h;
  var M=window.svMobile;
  if(M){ var pri=[];
    cols.forEach(function(c){ if(c[0]===sk) pri.push(c[2]); }); ['tm_wl','tm_adjnet','tm_net','tm_xw'].forEach(function(k){ if(pri.indexOf(k)<0) pri.push(k); });
    if(hasSched&&pri.indexOf('tm_sos')<0) pri.push('tm_sos');
    M.order(v.querySelector('.sv-tw > table.sv-t'),pri); }
  $('tmSeason').onchange=function(e){ T.season=e.target.value; renderTeams(); };
  $('tmSort').onchange=function(e){ T.sort=e.target.value; renderTeams(); };
  v.querySelectorAll('[data-team]').forEach(function(el){ el.onclick=function(e){
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1) return;          // a new tab keeps the link
    e.preventDefault(); goTeam(el.dataset.team,s); }; });
}
function tmFmt(k,t){ var x=getv(t,k);
  if(k==='w') return t.w+'-'+t.l;
  if(['efg','tov','orb','ftr','oefg','otov','drb','oftr','fg3r','ts','astpct','fg3','ft','ofg3','oft'].indexOf(k)>=0) return pc(x);
  if(k==='net'||k==='adjnet'||k==='luck'||k==='sos') return sg(x);
  if(k==='left'||k==='b2b'||k==='oppb2b'||k==='next7'||k==='poss'||k==='home') return ok(x)?Math.round(x).toLocaleString('en-US'):'—';
  if(k==='ast_to') return ok(x)?x.toFixed(2):'—';
  if(k==='adjd') return f1(x);
  return f1(x); }
function bar(pct,max,color){ var w=Math.max(0,Math.min(100,100*pct/max)); return '<div style="height:8px;background:var(--track);border-radius:4px;overflow:hidden"><div style="height:8px;width:'+w+'%;background:'+color+'"></div></div>'; }
var ZN=[['ra','Restricted area'],['paint','Paint (non-RA)'],['mid','Mid-range'],['c3','Corner 3'],['ab3','Above-the-break 3']];
var PTN={Isolation:'Isolation',Transition:'Transition',PRBallHandler:'P&R ball handler',PRRollman:'P&R roll man',Postup:'Post-up',Spotup:'Spot-up',Handoff:'Handoff',Cut:'Cut',OffScreen:'Off screen',OffRebound:'Putbacks',Misc:'Misc'};
function ordSuf(n){ var s=['th','st','nd','rd'], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }
function ord(n){ return n+ordSuf(n); }

/* ------------------------------------------------------------------ one team's page (2.10.0)
   What the old panel under the table showed (ratings, four factors, shot diet, play types, the
   schedule ahead), then the roster with Savant value and position rank, the team's best and
   most-used lineups, its head coach and every team stat with its rank among the 30. A section a
   season has no data for is left out. Every rank names its pool: the 30 teams that season. */
var TP={coach:{}, heads:null, headsLoading:null};
var CSS_TP=[
'.tp-back{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);text-decoration:none;display:inline-flex;align-items:center;min-height:40px;padding:0 2px}',
'.tp-back:hover{color:var(--navy)}',
'.tp-id{display:flex;align-items:center;gap:14px;min-width:0}',
'.tp-badge{width:52px;height:52px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-weight:600;font-size:14px;letter-spacing:.04em;box-shadow:inset 0 -5px 0 var(--tc2,transparent)}',
'.tp-name{font-family:var(--disp);font-weight:600;font-size:36px;line-height:1.02;margin:0;color:var(--ink)}',
'.tp-sub{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:5px;line-height:1.5}',
'.tp-jump{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}',
'.tp-jump button{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;padding:8px 12px;min-height:36px;border-radius:16px;border:1px solid var(--line);background:var(--surface);color:var(--navy);cursor:pointer}',
'.tp-jump button:hover{border-color:var(--gold)}',
'.tp-sec{margin-top:14px;scroll-margin-top:12px}',
'.tp-sec>h2{font-family:var(--disp);font-weight:600;font-size:22px;margin:0 0 4px;display:inline-block;border-bottom:3px solid var(--gold);padding-bottom:2px;line-height:1.1}',
'.tp-sec h3{margin:14px 0 6px;font-size:14px;font-weight:800}',
'.tp-since{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-left:8px;vertical-align:3px}',
'.sv-kpi .rk{font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:2px}',
'.tp-ros td.l .pl{display:inline-flex;align-items:center;gap:8px;text-decoration:none}',
'.tp-head{position:relative;width:30px;height:30px;border-radius:50%;overflow:hidden;flex:none;background:var(--tc,var(--track));color:var(--tc3,#fff);font-family:var(--mono);font-size:10px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}',
'.tp-head img{position:absolute;left:50%;top:0;height:100%;transform:translateX(-50%);background:var(--sunk)}',
'.tp-neg{color:var(--muted)}',
'.tp-unq{font-family:var(--mono);font-size:10px;color:var(--faint)}',
'.tp-lu .lu-n .pl{text-decoration:none}',
'.tp-coach{display:flex;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}',
'.tp-coach:first-of-type{border-top:none}',
'.tp-face{position:relative;width:56px;height:56px;border-radius:50%;overflow:hidden;flex:none;background:var(--tc,var(--navy));color:var(--tc3,#fff);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:600;font-size:20px;box-shadow:inset 0 -5px 0 var(--tc2,transparent)}',
'.tp-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 12%;background:var(--sunk)}',
'.tp-coach a{font-weight:700;font-size:16px;color:var(--ink);display:inline-flex;align-items:center;min-height:40px}',
'.tp-sec .sv-btn{min-height:40px}',
'.tp-back:focus-visible,.tp-coach a:focus-visible,.tp-jump button:focus-visible,.tp-ros .pl:focus-visible,.tp-lu .pl:focus-visible{outline:2px solid var(--navy);outline-offset:2px;border-radius:4px}',
'.tp-coach a:hover{color:var(--navy)}',
'.tp-coach .m{font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:2px}',
'.tp-rows .row{padding:6px 0}',
'.tp-rows .group-h{margin-top:14px}',
'.tp-rows .rv{font-family:var(--mono);font-size:13px;text-align:right}',
'.tp-rows .pnum{font-size:11px}',
'.tp-rows .xk{border-bottom:1px dotted currentColor}',
'.tp-credit{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin:18px 0 0;line-height:1.6}',
'@media(max-width:640px){',
'  .tp-name{font-size:27px}.tp-badge{width:44px;height:44px;font-size:12px}',
'  .tp-jump{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}',
'  .tp-jump button{white-space:nowrap;min-height:40px}',
'  .tp-head{width:26px;height:26px}',
'}'];
(function(){ var st=D.createElement('style'); st.textContent=CSS_TP.join('\n'); D.head.appendChild(st); })();

function loadHeads(){
  if(TP.heads) return Promise.resolve(TP.heads);
  if(TP.headsLoading) return TP.headsLoading;
  TP.headsLoading=fetch('bcs/heads.json',{cache:'default'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
    .then(function(h){ TP.heads=h||{}; return TP.heads; });
  return TP.headsLoading;
}
/* bcs/t/<team>-<season>.json is NBA Coaching Savant's team-season file (2002-03 on): its
   "coaches" are the season's head coaches in order, each with his first and last game. */
function loadCoach(abbr,season){
  var k=abbr+'-'+season;
  if(k in TP.coach) return Promise.resolve(TP.coach[k]);
  return fetch('bcs/t/'+encodeURIComponent(k)+'.json',{cache:'default'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
    .then(function(d){ TP.coach[k]=d&&Array.isArray(d.coaches)?d.coaches.map(function(c){
      return {id:c.coach, name:c.coach_name, first:c.first, last:c.last, games:c.rotation&&c.rotation.games}; }):null; return TP.coach[k]; });
}
function lum(hex){ var h=String(hex||'').replace('#',''); return [0,2,4].map(function(i){ var v=parseInt(h.substr(i,2),16)/255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); })
  .reduce(function(s,c,i){ return s+[0.2126,0.7152,0.0722][i]*c; },0); }
/* a team's two colours and an ink that reads on the first, as NBA Coaching Savant draws its badges */
function teamPair(abbr){
  var H=TP.heads||{}, k=(H.alias&&H.alias[abbr])||abbr, e=H.teams&&H.teams[k];
  var a=e?e[0]:'#22395A', b=e?e[1]:'#C2A263', la=lum(a), lb=lum(b), cr=(Math.max(la,lb)+.05)/(Math.min(la,lb)+.05);
  return [a,b,cr>=3?b:(la>.35?'#1A1A1A':'#FFFFFF')];
}
function pairStyle(abbr){ var c=teamPair(abbr); return '--tc:'+c[0]+';--tc2:'+c[1]+';--tc3:'+c[2]+';background:'+c[0]+';color:'+c[2]; }
function inits(n){ var w=String(n||'').replace(/[^A-Za-zÀ-ɏ' -]/g,'').trim().split(/\s+/); return ((w[0]||'').charAt(0)+(w.length>1?w[w.length-1].charAt(0):'')).toUpperCase(); }
function shortDate(iso){ if(!iso) return ''; var d=new Date(iso+'T12:00:00Z'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+' '+d.getUTCDate(); }

/* rank among the season's teams; ties share the better rank. n = teams with a value. */
function rankIn(teams,t,k,low){ var r=rankOf(teams,k,low)(getv(t,k)); if(!r) return null;
  return {r:r, n:teams.filter(function(x){ return ok(getv(x,k)); }).length}; }

/* Every stat on the all-30 table, and the rest of each team's row, with its rank.
   dir: 'hi' higher is better, 'lo' lower is better (flipped so 1st is best), 'ctx' context:
   1st is the most, with no good or bad colour. */
var STAT_ROWS=[
  ['Record',[['W-L','wpct','tm_wl','hi','w'],['Net rating','net','tm_net','hi'],['Luck-adj net','adjnet','tm_adjnet','hi'],['Pythagorean wins','pythw','tm_pythw','hi'],['Expected wins','xw','tm_xw','hi'],
    ['Opponent shooting luck','luck','tm_luck','ctx',null,'luckiest']]],
  ['Offense',[['ORtg','ortg','tm_ortg','hi'],['True shooting','ts','tm_ts','hi'],['eFG%','efg','tm_efg','hi'],['TOV%','tov','tm_tov','lo'],['ORB%','orb','tm_orb','hi'],['FT rate','ftr','tm_ftr','hi'],
    ['3P%','fg3','tm_fg3','hi'],['FT%','ft','tm_ft','hi'],['AST/TO','ast_to','tm_astto','hi'],['3PA rate','fg3r','tm_fg3r','ctx',null,'most threes'],['Assisted share','astpct','tm_astpct','ctx',null,'most assisted']]],
  ['Defense',[['DRtg','drtg','tm_drtg','lo'],['Luck-adj DRtg','adjd','tm_adjd','lo'],['Opp eFG%','oefg','tm_oefg','lo'],['Opp TOV%','otov','tm_otov','hi'],['DRB%','drb','tm_drb','hi'],['Opp FT rate','oftr','tm_oftr','lo'],
    ['Opp 3P%','ofg3','tm_ofg3','ctx',null,'highest'],['Opp FT%','oft','tm_oft','ctx',null,'highest']]],
  ['Pace',[['Pace','pace','tm_pace','ctx',null,'fastest'],['Possessions','poss','tm_poss','ctx',null,'most']]],
  ['Schedule ahead',[['Games left','left','tm_left','ctx',null,'most'],['Next 7 days','next7','tm_next7','ctx',null,'most'],['Back-to-backs left','b2b','tm_b2b','lo'],
    ['Opp. on a B2B','oppb2b','tm_oppb2b','hi'],['SOS','sos','tm_sos','lo']]]
];
function colorAtP(p){ if(typeof colorAt==='function') return colorAt(p); return 'var(--navy)'; }
function statRow(teams,t,s,row){
  var lab=row[0], k=row[1], ek=row[2], dir=row[3], disp=row[4]||k, most=row[5];
  var x=getv(t,k); if(!ok(x)) return '';
  var ri=rankIn(teams,t,k,dir==='lo'); if(!ri) return '';
  var p=ri.n>1?Math.round(100*(ri.n-ri.r)/(ri.n-1)):50;
  var col=dir==='ctx'?colorAtP(50):colorAtP(p);
  var tag=dir==='ctx'?'Context · 1st = '+most:(dir==='lo'?'Lower is better · 1st = lowest':'1st = best');
  var val=disp==='w'?t.w+'-'+t.l:tmFmt(k,t);
  var numLeft=p>88?'calc('+p+'% - 30px)':p+'%', numTf=p>88?'transform:translateY(-50%)':'transform:translate(6px,-50%)';
  var title=ord(ri.r)+' of '+ri.n+' teams, '+s+(dir==='ctx'?' (1st = '+most+'; context, not good or bad)':dir==='lo'?' (1st = lowest)':'');
  return '<div class="row nochart" title="'+esc(title)+'"><div class="rl"><div class="name">'+xk(esc(lab),ek)+'</div><div class="tag">'+esc(tag)+'</div></div>'
    +'<div class="track" role="img" aria-label="'+esc(lab+': '+title)+'"><div class="tick" style="left:25%"></div><div class="tick mid" style="left:50%"></div><div class="tick" style="left:75%"></div>'
    +'<div class="fill" style="width:'+Math.max(p,2)+'%;background:'+col+'"></div>'
    +'<div class="pnum" style="left:'+numLeft+';'+numTf+'">'+ord(ri.r)+'</div></div>'
    +'<div class="rv">'+val+'</div></div>';
}

/* Savant value is the page's own model (savant-value.js through astResults, the All-Savant
   Team's numbers): never recomputed here. Position rank: his value among every qualified player
   at his position (Guard, Wing, Big) that season, all 30 teams. */
function rosterRows(abbr,season){
  if(typeof DATA==='undefined'||!DATA||!DATA.data||!DATA.data[season]) return null;
  var ps=(DATA.data[season].players||[]).filter(function(p){ return p.team===abbr; });
  if(!ps.length) return null;
  var R=(typeof astResults==='function')?astResults(season):null, res=R&&R.res, pools={};
  if(res) res.forEach(function(v){ if(v.q) (pools[v.pos]=pools[v.pos]||[]).push(v.value); });
  Object.keys(pools).forEach(function(k){ pools[k].sort(function(a,b){ return b-a; }); });
  var mp=function(p){ return (p.line&&ok(p.line.mpg))?p.line.mpg:((p.m&&p.m.mpg&&p.m.mpg.season&&p.m.mpg.season.v)||0); };
  var gp=function(p){ var c=p.m&&p.m.avail&&p.m.avail.season; return c&&c.n||null; };
  return {hasValue:!!res, pools:pools, rows:ps.map(function(p){
    var v=res?res.get(p.id):null, pr=null;
    if(v&&v.q&&pools[v.pos]) pr={r:pools[v.pos].indexOf(v.value)+1, n:pools[v.pos].length};
    return {p:p, v:v, pr:pr, mpg:mp(p), gp:gp(p)};
  }).sort(function(a,b){ var x=a.v?a.v.value:null, y=b.v?b.v.value:null;
    if(x==null&&y==null) return b.mpg-a.mpg; if(x==null) return 1; if(y==null) return -1; return y-x; })};
}
var POS_WORD={Guard:'guards',Wing:'wings',Big:'bigs'};
function valFmt(v){ var r=Math.round(v); return (r>0?'+':r<0?'−':'')+Math.abs(r).toLocaleString('en-US'); }
function headImg(p,season){
  var hs=(typeof headSrc==='function')?headSrc(p.id,season,p.team):null;
  return '<span class="tp-head" style="'+pairStyle(p.team)+'" aria-hidden="true">'+esc(inits(p.name))
    +(hs&&typeof p.id==='number'?'<img '+hs+' alt="" loading="lazy" decoding="async" onerror="if(!(window.headRetry&&headRetry(this)))this.remove()">':'')+'</span>';
}
function rosterSec(abbr,season,live){
  var R=rosterRows(abbr,season); if(!R) return '';
  var h='<section class="sv-sec sv-card tp-sec" id="tpRos"><h2>'+xk('Roster','tm_roster')+'</h2><span class="tp-since">player data 1979-80 on</span><div class="sv-expl"></div>'
    +'<p class="sv-note">Every player NBA Savant has on '+esc(abbr)+' in '+esc(season)+(live?' so far':'')+', by '+xk('Savant value','tm_value')+'. '
    +'A player traded during the season is listed with the team he finished it with, and his numbers are his whole season. '
    +xk('Position rank','tm_posrank')+' is his value among every qualified player at his position in '+esc(season)+', all 30 teams'
    +(R.hasValue?' ('+['Guard','Wing','Big'].filter(function(k){ return R.pools[k]; }).map(function(k){ return R.pools[k].length+' '+POS_WORD[k]; }).join(', ')+').':'.')
    +' Click a name for his card.</p>';
  h+='<div class="sv-tw"><table class="sv-t tp-ros"><tr><th>#</th><th class="l">Player</th>'+th('Pos','tm_rpos','l')+th('GP','tm_gp')+th('MPG','mpg')+(R.hasValue?th('Savant value','tm_value')+th('Pos. rank','tm_posrank'):'')+'</tr>'
    +R.rows.map(function(x,i){ var p=x.p;
      var rk=x.pr?ord(x.pr.r)+' <span class="tp-unq">of '+x.pr.n+' '+POS_WORD[x.v.pos]+'</span>'
        :(x.v?'<span class="tp-unq" title="Under the games / minutes qualifier, so he is not ranked">not qualified</span>':'—');
      return '<tr><td>'+(i+1)+'</td><td class="l"><a class="pl" href="/nba-savant?p='+encodeURIComponent(p.id)+'" data-pid="'+esc(p.id)+'">'+headImg(p,season)+'<span>'+esc(p.name)+'</span></a></td>'
        +'<td class="l">'+esc(p.pos||'—')+'</td><td>'+(x.gp==null?'—':x.gp)+'</td><td>'+f1(x.mpg)+'</td>'
        +(R.hasValue?'<td class="big'+(x.v&&x.v.value<0?' tp-neg':'')+'">'+(x.v?valFmt(x.v.value):'—')+'</td><td>'+rk+'</td>':'')+'</tr>'; }).join('')
    +'</table></div></section>';
  return h;
}

function luTable(units,n,id){
  return '<div class="sv-tw"><table class="sv-t tp-lu" id="'+id+'"><tr><th>#</th>'+th(n==='5'?'Five-man unit':'Pair','lu_unit','l')+th('MIN','lu_min')+th('Poss','lu_poss')+th('ORtg','lu_ortg')+th('DRtg','lu_drtg')
    +th('Net','lu_net')+th('Luck-adj','lu_adj')+th('Sample-adj','lu_est')+'</tr>'
    +units.map(function(u,i){ return '<tr><td>'+(i+1)+'</td><td class="l">'+u.names.map(function(nm,j){ return '<span class="lu-n"><a class="pl" href="/nba-savant?p='+encodeURIComponent(u.ids[j])+'" data-pid="'+esc(u.ids[j])+'">'+esc(nm)+'</a>'+(j<u.names.length-1?' ·':'')+'</span>'; }).join(' ')+'</td>'
      +'<td>'+f0(u.min)+'</td><td>'+f0(u.poss)+'</td><td>'+f1(u.ortg)+'</td><td>'+f1(u.drtg)+'</td><td>'+sg(u.net)+'</td><td>'+sg(u.adj)+'</td><td class="big">'+sg(u.est)+'</td></tr>'; }).join('')
    +'</table></div>';
}
/* Best: the highest sample-adjusted net among units over the Lineups tab's own default floor
   (50 / 200 minutes; pro-rated in the season in progress). Most used: the most minutes. */
function lineupSec(abbr,season,L){
  if(!L||!L.units) return '';
  var parts=[], first=(T.data.lineup_seasons||[]).slice(-1)[0];
  ['5','2'].forEach(function(n){
    var units=(L.units[n]||[]).filter(function(u){ return u.t===abbr; }); if(!units.length) return;
    var floor=(L.view_min&&L.view_min[n]!=null)?L.view_min[n]:(n==='5'?50:200);
    var best=units.filter(function(u){ return u.min>=floor; }).sort(function(a,b){ return b.est-a.est; }).slice(0,5);
    var used=units.slice().sort(function(a,b){ return b.min-a.min; }).slice(0,5);
    var word=n==='5'?'five-man units':'two-man pairs';
    if(best.length) parts.push('<h3>Best '+word+' <span class="tp-unq">by sample-adjusted net, '+(Math.round(floor)===floor?f0(floor):f1(floor))+'+ minutes</span></h3>'+luTable(best,n,'tpLuB'+n));
    parts.push('<h3>Most-used '+word+' <span class="tp-unq">by minutes together</span></h3>'+luTable(used,n,'tpLuU'+n));
  });
  if(!parts.length) return '';
  return '<section class="sv-sec sv-card tp-sec" id="tpLu"><h2>'+xk('Lineups','tm_lineups')+'</h2><span class="tp-since">'+esc(first||'')+' on</span><div class="sv-expl"></div>'
    +'<p class="sv-note">Lineup ratings are noisy, so the best units are judged on the sample-adjusted net: the luck-adjusted net pulled toward the team’s own rating by k = '+f0((L.k||{})['5'])+' possessions for five-man units and '+f0((L.k||{})['2'])+' for pairs. '+xk('How','lu_est')+'.</p>'
    +parts.join('')+'<p style="margin-top:12px"><button type="button" class="sv-btn ghost" id="tmLu">Every '+esc(abbr)+' lineup in the Lineups tab →</button></p></section>';
}
function coachSec(abbr,season,list){
  if(!list||!list.length) return '';
  var y=parseInt(season,10), H=TP.heads||{};
  var face=function(c){
    var L=H.p&&H.p[c.id], e=null; if(L) for(var i=0;i<L.length;i++){ if(L[i][0]<=y) e=L[i]; else break; }
    var m=e&&e[2]===0&&e[1]&&String(e[1]).match(/^(\d+)\/(\d+)\/(\d+)$/), url=m?'https://cdn.nba.com/headshots/nba/'+m[1]+'/'+m[2]+'/260x190/'+m[3]+'.png':null;
    return '<span class="tp-face" style="'+pairStyle(abbr)+'" aria-hidden="true">'+esc(inits(c.name))+(url?'<img src="'+url+'" alt="" loading="lazy" onerror="this.remove()">':'')+'</span>';
  };
  return '<section class="sv-sec sv-card tp-sec" id="tpCoach"><h2>'+xk(list.length>1?'Head coaches':'Head coach','tm_coach')+'</h2><span class="tp-since">2002-03 on</span><div class="sv-expl"></div>'
    +list.map(function(c){ return '<div class="tp-coach">'+face(c)+'<div><a href="/nba-coaching-savant#c='+encodeURIComponent(c.id)+'">'+esc(c.name)+'</a>'
      +'<div class="m">'+(c.games?c.games+' game'+(c.games===1?'':'s')+' · ':'')+esc(shortDate(c.first))+' to '+esc(shortDate(c.last))+'</div>'
      +'<div class="m">His Rotation Map, lineups, timeouts and record against the roster’s talent on NBA Coaching Savant →</div></div></div>'; }).join('')
    +'</section>';
}

function renderTeamPage(){
  var v=$('svTm'), d=T.data, abbr=T.page, s=T.pageSeason;
  var back='<a class="tp-back" href="#teams" id="tpBack">← All 30 teams</a>';
  var b=d.data[s];
  if(!b){
    v.innerHTML=back+'<div class="sv-head"><div><h1 class="sv-title">'+esc(abbr)+'</h1><div class="sv-sub sv-warn">NBA Savant has no team data for '+esc(s)+'. Team pages cover '+esc(d.seasons[d.seasons.length-1])+' to '+esc(d.seasons[0])+'.</div></div></div>';
    wireBack(); return;
  }
  var st=seasonTeams(s), teams=st.teams, t=teams.filter(function(x){ return x.abbr===abbr; })[0];
  if(!t){
    v.innerHTML=back+'<div class="sv-head"><div><h1 class="sv-title">'+esc(abbr)+'</h1><div class="sv-sub sv-warn">No NBA team goes by '+esc(abbr)+' in '+esc(s)+'. Pick one from the all-30 table.</div></div></div>';
    wireBack(); return;
  }
  var live=d.current===s, nm=t.name||t.abbr;
  D.title=nm+' '+s+' · NBA Savant';
  var rk=function(k){ var r=rankIn(teams,t,k,LOW_GOOD[k]); return r?'<span class="sv-games">'+ord(r.r)+'</span>':''; };
  var kr=function(k,low){ var r=rankIn(teams,t,k,low); return r?'<div class="rk">'+ord(r.r)+' of '+r.n+'</div>':''; };
  var adjR=rankIn(teams,t,'adjnet',false);
  var h=back+'<div class="sv-head"><div class="tp-id"><span class="tp-badge" style="'+pairStyle(abbr)+'" aria-hidden="true">'+esc(abbr)+'</span><div><h1 class="tp-name">'+esc(nm)+'</h1>'
    +'<div class="tp-sub">'+esc(s)+(live?' so far, through '+t.gp+' games':'')+' · '+t.w+'-'+t.l+(adjR?' · '+ord(adjR.r)+' of '+adjR.n+' in luck-adjusted net':'')+'</div></div></div>'
    +'<div class="sv-ctl" style="margin:0"><div class="sv-f"><label for="tpSeason">Season</label><select id="tpSeason">'+d.seasons.map(function(x){ return '<option'+(x===s?' selected':'')+'>'+x+'</option>'; }).join('')+'</select></div></div></div>';
  h+='<nav class="tp-jump" aria-label="On this page">'+[['tpRat','Ratings'],['tpRos','Roster'],['tpLu','Lineups'],['tpCoach','Coach'],['tpAll','Every stat']].map(function(x){ return '<button type="button" data-to="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</nav>';
  // ---- the old panel's sections
  var first=d.seasons[d.seasons.length-1];
  h+='<section class="sv-sec sv-card tp-sec" id="tpRat"><h2>Ratings</h2><span class="tp-since">'+esc(first)+' on</span><div class="sv-expl"></div>'
    +'<p class="sv-note">Ranks are among the '+teams.length+' teams in '+esc(s)+(live?' so far':'')+'. 1st is the best: the lowest DRtg, the fewest turnovers, the lowest opponent eFG%. For pace, 1st is the fastest.</p>';
  h+='<div class="sv-kpis">'+[['W-L',t.w+'-'+t.l,'tm_wl',kr('wpct')],['Net',sg(t.net),'tm_net',kr('net')],['Luck-adj net',sg(t.adjnet),'tm_adjnet',kr('adjnet')],['ORtg',f1(t.ortg),'tm_ortg',kr('ortg')],
    ['DRtg',f1(t.drtg),'tm_drtg',kr('drtg',true)],['Pace',f1(t.pace),'tm_pace',kr('pace')],['Exp. wins',f1(t.xw),'tm_xw',kr('xw')]]
    .map(function(x){ return '<div class="sv-kpi"><div class="k">'+xk(x[0],x[2])+'</div><div class="v">'+x[1]+'</div>'+x[3]+'</div>'; }).join('')+'</div>';
  h+='<h3>'+xk('Four factors','tm_ff')+' <span class="tp-unq">rank of '+teams.length+' beside each</span></h3><table class="sv-t"><tr><th class="l"></th>'+th('eFG%','tm_efg')+th('TOV%','tm_tov')+th('ORB%','tm_orb')+th('FT rate','tm_ftr')+'</tr>'
    +'<tr><td class="l">Offense</td><td>'+pc(getv(t,'efg'))+' '+rk('efg')+'</td><td>'+pc(getv(t,'tov'))+' '+rk('tov')+'</td><td>'+pc(getv(t,'orb'))+' '+rk('orb')+'</td><td>'+pc(getv(t,'ftr'))+' '+rk('ftr')+'</td></tr>'
    +'<tr><td class="l">Defense (allowed)</td><td>'+pc(getv(t,'oefg'))+' '+rk('oefg')+'</td><td>'+pc(getv(t,'otov'))+' '+rk('otov')+'</td><td>'+pc(1-(getv(t,'drb')||0))+' '+rk('drb')+'</td><td>'+pc(getv(t,'oftr'))+' '+rk('oftr')+'</td></tr></table>';
  if(t.diet){
    h+='<h3>'+xk('Shot diet','tm_diet')+'</h3><table class="sv-t"><tr><th class="l">Zone</th><th>Their shots</th><th>FG%</th><th class="sv-hide-m" style="width:22%"></th><th>Allowed</th><th>Opp FG%</th><th class="sv-hide-m" style="width:22%"></th></tr>'
      +ZN.map(function(z){ var a=t.diet[z[0]]||[], o=(t.odiet||{})[z[0]]||[];
        return '<tr><td class="l">'+z[1]+'</td><td>'+f1(a[0])+'%</td><td>'+pc(a[1])+'</td><td class="sv-hide-m">'+bar(a[0]||0,45,'var(--navy)')+'</td><td>'+f1(o[0])+'%</td><td>'+pc(o[1])+'</td><td class="sv-hide-m">'+bar(o[0]||0,45,'var(--red)')+'</td></tr>'; }).join('')+'</table>';
  }
  if(t.pt&&(Object.keys(t.pt.o||{}).length)){
    var keys=Object.keys(PTN).filter(function(k){ return (t.pt.o||{})[k]||(t.pt.d||{})[k]; });
    h+='<h3>'+xk('Play types','tm_pt')+' <span class="tp-unq">Synergy, 2015-16 on; percentiles are the NBA’s, among the 30 teams</span></h3><table class="sv-t"><tr><th class="l">Play type</th><th>Off. freq</th><th>PPP</th><th>Pctile vs 30</th><th>Def. freq</th><th>PPP allowed</th><th>Pctile vs 30</th></tr>'
      +keys.map(function(k){ var o=(t.pt.o||{})[k]||[], dd=(t.pt.d||{})[k]||[];
        return '<tr><td class="l">'+PTN[k]+'</td><td>'+f1(o[0])+'%</td><td>'+(ok(o[1])?o[1].toFixed(2):'—')+'</td><td>'+f0(o[2])+'</td><td>'+f1(dd[0])+'%</td><td>'+(ok(dd[1])?dd[1].toFixed(2):'—')+'</td><td>'+f0(dd[2])+'</td></tr>'; }).join('')+'</table>';
  }
  if(t.sched){
    var sc=t.sched;
    h+='<h3>'+xk('Schedule ahead','tm_sos')+(st.up?' <span class="tp-unq">'+esc(st.up.season)+'</span>':'')+'</h3><div class="sv-kpis">'
      +[['Games left',f0(sc.left),'tm_left'],['Home',f0(sc.home),'tm_left'],['Back-to-backs',f0(sc.b2b),'tm_b2b'],['Opp. on a B2B',f0(sc.oppb2b),'tm_oppb2b'],['SOS',sg(sc.sos),'tm_sos'],['Next 7 days',f0(sc.next7),'tm_next7']]
      .map(function(x){ return '<div class="sv-kpi"><div class="k">'+xk(x[0],x[2])+'</div><div class="v">'+x[1]+'</div></div>'; }).join('')+'</div>'
      +'<div class="sv-games">Next: '+(sc.next||[]).map(function(g){ var dd=new Date(g[0]+'T12:00:00Z'); return (dd.getUTCMonth()+1)+'/'+dd.getUTCDate()+(g[2]?' v ':' @ ')+esc(g[1]); }).join(', ')+'</div>';
  }
  h+='</section>';
  // ---- the additions
  h+=rosterSec(abbr,s,live);
  h+='<div id="tpLuSlot"></div><div id="tpCoachSlot"></div>';
  h+='<section class="sv-sec sv-card tp-sec tp-rows" id="tpAll"><h2>'+xk('Every stat, ranked','tm_rank')+'</h2><span class="tp-since">'+esc(first)+' on</span><div class="sv-expl"></div>'
    +'<p class="sv-note">The team’s full row from the all-30 table and the rest of its team stats, each ranked among the '+teams.length+' teams in '+esc(s)+(live?' so far':'')
    +'. The bar is the rank: full is 1st, empty is last. Lower-is-better stats are flipped so 1st is the best; context stats rank 1st as the most and carry no good or bad colour.</p>'
    +STAT_ROWS.map(function(g){ var rows=g[1].map(function(r){ return statRow(teams,t,s,r); }).join(''); return rows?'<div class="group-h">'+g[0]+(g[0]==='Schedule ahead'&&st.up?' · '+esc(st.up.season):'')+'</div>'+rows:''; }).join('')
    +'</section>';
  h+='<p class="tp-credit">Sources: NBA.com stats (stats.nba.com) team, lineup and Synergy play-type stats through ~/Basketball-Savant/teams_engine.py; '
    +'NBA Savant’s player data and its Savant value model (savant-value.json); NBA Coaching Savant’s team-season files for the coach.</p>';
  v.innerHTML=h;
  var M=window.svMobile;
  if(M){ M.wrap(v); var ros=v.querySelector('table.tp-ros'); if(ros) M.order(ros,['tm_value','tm_posrank']); }
  wireBack(); wirePage(v);
  $('tpSeason').onchange=function(e){ T.pageSeason=e.target.value;
    try{ history.replaceState({sv:'tm'},'',location.pathname+teamHash(abbr,T.pageSeason)); }catch{}
    renderTeamPage(); };
  v.querySelectorAll('.tp-jump button').forEach(function(bt){ bt.onclick=function(){ var el=$(bt.dataset.to); if(el) el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); }; });
  // the parts that load on their own: lineups (2018-19 on here), the coach, the team colours
  var stamp=abbr+'|'+s;
  var still=function(){ return T.page+'|'+T.pageSeason===stamp&&D.body.classList.contains('tab-tm'); };
  var jumpOff=function(id){ var bt=v.querySelector('.tp-jump [data-to="'+id+'"]'); if(bt) bt.hidden=true; };
  if(!$('tpRos')) jumpOff('tpRos');
  if((d.lineup_seasons||[]).indexOf(s)>=0){
    loadLineups(s).then(function(L){ if(!still()) return; var slot=$('tpLuSlot'); var html=lineupSec(abbr,s,L);
      if(!html){ jumpOff('tpLu'); return; }
      slot.outerHTML=html; var sec=$('tpLu'); if(M){ M.wrap(sec); sec.querySelectorAll('table.tp-lu').forEach(function(tb){ M.order(tb,['lu_est','lu_min']); }); }
      wirePage(sec); var bt=$('tmLu'); if(bt) bt.onclick=function(){ T.luTeam=abbr; T.luSeason=s; if(window.svGo) window.svGo('lu'); }; });
  } else jumpOff('tpLu');
  Promise.all([loadCoach(abbr,s),loadHeads()]).then(function(a){ if(!still()) return; var html=coachSec(abbr,s,a[0]);
    if(!html){ jumpOff('tpCoach'); return; } var slot=$('tpCoachSlot'); if(slot) slot.outerHTML=html; });
  if(!TP.heads) loadHeads().then(function(){ if(!still()) return;     // repaint the badges in the team's colours
    v.querySelectorAll('.tp-badge,.tp-head').forEach(function(el){ el.setAttribute('style',pairStyle(abbr)); }); });
}
function wireBack(){ var bk=$('tpBack'); if(bk) bk.onclick=function(e){ if(e.metaKey||e.ctrlKey) return; e.preventDefault(); T.page=null; if(window.svGo) window.svGo('tm'); }; }
/* A player opens on his card in the season the page is showing; Back returns here. */
function openCard(id,season){
  if(window.svClear) window.svClear();
  try{ history.pushState({app:1},'',location.pathname+location.search+'#p'); }catch{}
  if(typeof hideHome==='function') hideHome();
  try{ if(typeof curSeason!=='undefined'&&curSeason!==season&&DATA&&DATA.data[season]){ curSeason=season; if(typeof fillRoster==='function') fillRoster(); } }catch{}
  if(typeof selectPlayer==='function') selectPlayer(typeof asId==='function'?asId(id):id);
}
function wirePage(root){
  root.querySelectorAll('[data-pid]').forEach(function(x){ x.onclick=function(e){ if(e.metaKey||e.ctrlKey||e.shiftKey) return; e.preventDefault(); openCard(x.dataset.pid,T.pageSeason); }; });
}

/* ------------------------------------------------------------------ Lineups */
function renderLineups(){
  var v=$('svLu'), d=T.data, seasons=(d.lineup_seasons||[]).filter(function(s){ return parseInt(s,10)>=2007; });
  if(!seasons.length){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">Lineups</h1><div class="sv-sub sv-warn">Lineup data isn’t available yet.</div></div></div>'; return; }
  if(seasons.indexOf(T.luSeason)<0) T.luSeason=seasons[0];
  var s=T.luSeason, L=T.lu[s];
  if(!L){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">Lineups</h1><div class="sv-sub">Loading '+esc(s)+'…</div></div></div>';
    loadLineups(s).then(function(x){ if(x) renderLineups(); else v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">Lineups</h1><div class="sv-sub sv-warn">No lineup file for '+esc(s)+'.</div></div></div>'; }); return; }
  // The season in progress carries its own default floors (view_min), pro-rated to the games
  // played so units show from opening week; finished seasons use 50 / 200 (teams_engine.py).
  var n=T.luN, units=(L.units||{})[n]||[], floor=T.luMin!=null?T.luMin:((L.view_min&&L.view_min[n]!=null)?L.view_min[n]:(n==='5'?50:200));
  var q=T.luQ.trim().toLowerCase();
  var teams=Array.from(new Set(units.map(function(u){ return u.t; }))).sort();
  var list=units.filter(function(u){ return u.min>=floor&&(!T.luTeam||u.t===T.luTeam)&&(!q||u.names.join(' ').toLowerCase().indexOf(q)>=0); });
  var sk=T.luSort, low=sk==='drtg';
  list.sort(function(a,b){ return low?a[sk]-b[sk]:b[sk]-a[sk]; });
  var k=(L.k||{})[n];
  var h='<div class="sv-head"><div><h1 class="sv-title">Lineups <em>Savant</em></h1><div class="sv-sub">'+esc(s)+' · every team’s '+(n==='5'?'five-man units':'two-man pairs')+', luck-adjusted and sample-adjusted</div></div></div>';
  h+='<div class="sv-ctl"><div class="sv-f"><label>Season</label><select id="luSeason">'+seasons.map(function(x){ return '<option'+(x===s?' selected':'')+'>'+x+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>Unit</label><span class="sv-seg" id="luN"><button type="button" data-v="5"'+(n==='5'?' class="on"':'')+'>5-man</button><button type="button" data-v="2"'+(n==='2'?' class="on"':'')+'>2-man</button></span></div>'
    +'<div class="sv-f"><label>Team</label><select id="luTeam"><option value="">All teams</option>'+teams.map(function(t){ return '<option'+(t===T.luTeam?' selected':'')+'>'+t+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>'+xk('Min minutes','lu_min')+'</label><input type="number" id="luMin" value="'+floor+'"></div>'
    +'<div class="sv-f"><label>Sort by</label><select id="luSort">'+[['est','Sample-adjusted net'],['adj','Luck-adjusted net'],['net','Raw net'],['min','Minutes'],['ortg','ORtg'],['drtg','DRtg']].map(function(o){ return '<option value="'+o[0]+'"'+(sk===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>Player</label><input id="luQ" class="sv-in" value="'+esc(T.luQ)+'" placeholder="Name"></div></div>';
  h+='<div class="sv-sec"><div class="sv-expl"></div><p class="sv-note">Lineup ratings are noisy: a unit’s raw net rating over 300 possessions can be 10 points off its true level. The sample-adjusted column pulls each unit toward its team’s rating by k = '+f0(k)+' possessions, a number measured from how well lineup ratings hold up from the first half of a season to the second. '+xk('How','lu_est')+'.</p>';
  h+='<div class="sv-tw"><table class="sv-t"><tr><th>#</th>'+th('Unit','lu_unit','l')+'<th class="l">Team</th>'+th('GP','lu_gp')+th('MIN','lu_min')+th('Poss','lu_poss')+th('ORtg','lu_ortg')+th('DRtg','lu_drtg')
    +th('Net','lu_net')+th('Luck-adj','lu_adj')+th('Sample-adj','lu_est')+th('eFG%','lu_efg')+th('TOV%','lu_tov')+th('ORB%','lu_orb')+th('Pace','lu_pace')+'</tr>'
    +list.slice(0,200).map(function(u,i){
      return '<tr><td>'+(i+1)+'</td><td class="l">'+u.names.map(function(nm,j){ return '<span class="lu-n"><span class="pl" data-pid="'+u.ids[j]+'">'+esc(nm)+'</span>'+(j<u.names.length-1?' ·':'')+'</span>'; }).join(' ')+'</td><td class="l">'+esc(u.t)+'</td>'
        +'<td>'+u.gp+'</td><td>'+f0(u.min)+'</td><td>'+f0(u.poss)+'</td><td>'+f1(u.ortg)+'</td><td>'+f1(u.drtg)+'</td><td>'+sg(u.net)+'</td><td>'+sg(u.adj)+'</td><td class="big">'+sg(u.est)+'</td>'
        +'<td>'+pc(u.efg)+'</td><td>'+pc(u.tov)+'</td><td>'+pc(u.orb)+'</td><td>'+f1(u.pace)+'</td></tr>'; }).join('')+'</table></div>'
    +(list.length>200?'<p class="sv-note">Showing 200 of '+list.length+'. Filter by team or player to see the rest.</p>':'')+'</div>';
  v.innerHTML=h;
  if(window.svMobile) window.svMobile.order(v.querySelector('.sv-tw > table.sv-t'),[{est:'lu_est',adj:'lu_adj',net:'lu_net',min:'lu_min',ortg:'lu_ortg',drtg:'lu_drtg'}[sk]||'lu_est','lu_est','lu_min','lu_net']);
  $('luSeason').onchange=function(e){ T.luSeason=e.target.value; renderLineups(); };
  $('luN').onclick=function(e){ var b=e.target.closest('button'); if(!b) return; T.luN=b.dataset.v; T.luMin=null; renderLineups(); };
  $('luTeam').onchange=function(e){ T.luTeam=e.target.value; renderLineups(); };
  $('luMin').onchange=function(e){ var x=parseFloat(e.target.value); T.luMin=isFinite(x)?x:null; renderLineups(); };
  $('luSort').onchange=function(e){ T.luSort=e.target.value; renderLineups(); };
  var qi=$('luQ'); qi.oninput=function(){ T.luQ=qi.value; var p=qi.selectionStart; renderLineups(); var nq=$('luQ'); if(nq){ nq.focus(); try{ nq.setSelectionRange(p,p); }catch(e){} } };
  v.querySelectorAll('[data-pid]').forEach(function(x){ x.onclick=function(){ if(window.svClear) window.svClear(); if(typeof pickHome==='function') pickHome(+x.dataset.pid); }; });
}

window.svTeams={open:open, load:load, state:T, untitle:untitle, teamHash:teamHash};
})();
