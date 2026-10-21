/* Basketball Savant · the Teams and Lineups tabs.
 *
 * Data: savant-teams.json (every finished season, 1996-97 on) + savant-teams-current.json (the
 * season in progress, rebuilt with every refresh) and lineups/<season>.json (2007-08 on), all
 * from ~/Basketball-Savant/teams_engine.py. Styles and the explainer click handler come from
 * savant-fantasy.js. Every column name opens its explainer.
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

var T={data:null, loading:null, season:null, sort:'adjnet', team:null, lu:{}, luSeason:null, luN:'5', luTeam:'', luMin:null, luSort:'est', luQ:''};
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
      which==='tm'?renderTeams():renderLineups(); });
    return;
  }
  which==='tm'?renderTeams():renderLineups();
}
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
function renderTeams(){
  var v=$('svTm'), d=T.data, s=T.season, b=d.data[s]||{teams:[]};
  var up=d.upcoming&&d.seasons[0]===s?d.upcoming:null;   // preseason: show next season's schedule beside last season's ratings
  var teams=b.teams.map(function(t){ var c=Object.assign({},t); if(up&&up.sched[t.abbr]) c.sched=up.sched[t.abbr]; return c; });
  var hasSched=teams.some(function(t){ return t.sched; });
  var cols=[['w','W-L','tm_wl'],['net','Net','tm_net'],['adjnet','Luck-adj net','tm_adjnet'],['ortg','ORtg','tm_ortg'],['drtg','DRtg','tm_drtg'],['pace','Pace','tm_pace'],
    ['pythw','Pyth W','tm_pythw'],['xw','Exp. W','tm_xw'],['luck','Luck','tm_luck'],['efg','eFG%','tm_efg'],['tov','TOV%','tm_tov'],['orb','ORB%','tm_orb'],['ftr','FT rate','tm_ftr'],
    ['oefg','Opp eFG%','tm_oefg'],['otov','Opp TOV%','tm_otov'],['drb','DRB%','tm_drb'],['oftr','Opp FT rate','tm_oftr'],['fg3r','3PA rate','tm_fg3r']];
  if(hasSched) cols=cols.concat([['left','Games left','tm_left'],['next7','Next 7','tm_next7'],['b2b','B2Bs left','tm_b2b'],['oppb2b','Opp. on B2B','tm_oppb2b'],['sos','SOS','tm_sos']]);
  var sk=T.sort, lowg=LOW_GOOD[sk];
  teams.sort(function(a,b2){ var x=getv(a,sk==='w'?'wpct':sk), y=getv(b2,sk==='w'?'wpct':sk); if(!ok(x)) return 1; if(!ok(y)) return -1; return lowg?x-y:y-x; });
  var fmt=function(k,t){ var x=getv(t,k);
    if(k==='w') return t.w+'-'+t.l;
    if(['efg','tov','orb','ftr','oefg','otov','drb','oftr','fg3r'].indexOf(k)>=0) return pc(x);
    if(k==='net'||k==='adjnet'||k==='luck'||k==='sos') return sg(x);
    if(k==='left'||k==='b2b'||k==='oppb2b'||k==='next7') return f0(x);
    return f1(x); };
  var h='<div class="sv-head"><div><h1 class="sv-title">Teams <em>Savant</em></h1><div class="sv-sub">'+esc(s)+' · every team’s ratings, four factors, shot diet, play types'+(hasSched?' and the schedule ahead':'')+'</div></div>'
    +'<div class="sv-sub">'+(up?'Ratings are '+esc(s)+'; schedule columns are '+esc(up.season)+'.':'')+'</div></div>';
  h+='<div class="sv-ctl"><div class="sv-f"><label>Season</label><select id="tmSeason">'+d.seasons.map(function(x){ return '<option'+(x===s?' selected':'')+'>'+x+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>Sort by</label><select id="tmSort">'+cols.map(function(c){ return '<option value="'+c[0]+'"'+(sk===c[0]?' selected':'')+'>'+c[1]+'</option>'; }).join('')+'</select></div></div>';
  h+='<div class="sv-sec"><div class="sv-expl"></div><p class="sv-note">Click a team for its shot diet, play types, schedule, best lineups and roster. Click any column name for how it’s built.</p>';
  h+='<div class="sv-tw"><table class="sv-t"><tr><th>#</th><th class="l">Team</th>'+cols.map(function(c){ return th(c[1],c[2]); }).join('')+'</tr>'
    +teams.map(function(t,i){ return '<tr><td>'+(i+1)+'</td><td class="l"><span class="pl" data-team="'+esc(t.abbr)+'">'+esc(t.name||t.abbr)+'</span></td>'
      +cols.map(function(c){ return '<td'+(c[0]===sk?' class="big"':'')+'>'+fmt(c[0],t)+'</td>'; }).join('')+'</tr>'; }).join('')+'</table></div></div>';
  h+='<div id="tmDetail"></div>';
  v.innerHTML=h;
  var M=window.svMobile;
  if(M){ var pri=[];
    cols.forEach(function(c){ if(c[0]===sk) pri.push(c[2]); }); ['tm_wl','tm_adjnet','tm_net','tm_xw'].forEach(function(k){ if(pri.indexOf(k)<0) pri.push(k); });
    if(hasSched&&pri.indexOf('tm_sos')<0) pri.push('tm_sos');
    M.order(v.querySelector('.sv-tw > table.sv-t'),pri); }
  $('tmSeason').onchange=function(e){ T.season=e.target.value; T.team=null; renderTeams(); };
  $('tmSort').onchange=function(e){ T.sort=e.target.value; renderTeams(); };
  v.querySelectorAll('[data-team]').forEach(function(el){ el.onclick=function(){ T.team=el.dataset.team; renderTeamDetail(teams); var dd=$('tmDetail'); if(dd) dd.scrollIntoView({behavior:'smooth',block:'start'}); }; });
  if(T.team) renderTeamDetail(teams);
}
function bar(pct,max,color){ var w=Math.max(0,Math.min(100,100*pct/max)); return '<div style="height:8px;background:var(--track);border-radius:4px;overflow:hidden"><div style="height:8px;width:'+w+'%;background:'+color+'"></div></div>'; }
var ZN=[['ra','Restricted area'],['paint','Paint (non-RA)'],['mid','Mid-range'],['c3','Corner 3'],['ab3','Above-the-break 3']];
var PTN={Isolation:'Isolation',Transition:'Transition',PRBallHandler:'P&R ball handler',PRRollman:'P&R roll man',Postup:'Post-up',Spotup:'Spot-up',Handoff:'Handoff',Cut:'Cut',OffScreen:'Off screen',OffRebound:'Putbacks',Misc:'Misc'};
function renderTeamDetail(teams){
  var el=$('tmDetail'); var t=teams.filter(function(x){ return x.abbr===T.team; })[0]; if(!el||!t){ if(el) el.innerHTML=''; return; }
  var rk=function(k){ var r=rankOf(teams,k,LOW_GOOD[k])(getv(t,k)); return r?'<span class="sv-games">'+r+ordSuf(r)+'</span>':''; };
  var h='<div class="sv-sec sv-card" style="margin-top:14px"><h3 style="font-size:20px">'+esc(t.name)+' · '+esc(T.season)+'</h3><div class="sv-expl"></div>';
  h+='<div class="sv-kpis">'+[['W-L',t.w+'-'+t.l,'tm_wl'],['Net',sg(t.net),'tm_net'],['Luck-adj net',sg(t.adjnet),'tm_adjnet'],['ORtg',f1(t.ortg),'tm_ortg'],['DRtg',f1(t.drtg),'tm_drtg'],['Pace',f1(t.pace),'tm_pace'],['Exp. wins',f1(t.xw),'tm_xw']]
    .map(function(x){ return '<div class="sv-kpi"><div class="k">'+xk(x[0],x[2])+'</div><div class="v">'+x[1]+'</div></div>'; }).join('')+'</div>';
  // four factors
  h+='<h3 style="margin-top:12px">'+xk('Four factors','tm_ff')+'</h3><table class="sv-t"><tr><th class="l"></th>'+th('eFG%','tm_efg')+th('TOV%','tm_tov')+th('ORB%','tm_orb')+th('FT rate','tm_ftr')+'</tr>'
    +'<tr><td class="l">Offense</td><td>'+pc(getv(t,'efg'))+' '+rk('efg')+'</td><td>'+pc(getv(t,'tov'))+' '+rk('tov')+'</td><td>'+pc(getv(t,'orb'))+' '+rk('orb')+'</td><td>'+pc(getv(t,'ftr'))+' '+rk('ftr')+'</td></tr>'
    +'<tr><td class="l">Defense (allowed)</td><td>'+pc(getv(t,'oefg'))+' '+rk('oefg')+'</td><td>'+pc(getv(t,'otov'))+' '+rk('otov')+'</td><td>'+pc(1-(getv(t,'drb')||0))+' '+rk('drb')+'</td><td>'+pc(getv(t,'oftr'))+' '+rk('oftr')+'</td></tr></table>';
  // shot diet
  if(t.diet){
    h+='<h3 style="margin-top:14px">'+xk('Shot diet','tm_diet')+'</h3><table class="sv-t"><tr><th class="l">Zone</th><th>Their shots</th><th>FG%</th><th class="sv-hide-m" style="width:22%"></th><th>Allowed</th><th>Opp FG%</th><th class="sv-hide-m" style="width:22%"></th></tr>'
      +ZN.map(function(z){ var a=t.diet[z[0]]||[], o=(t.odiet||{})[z[0]]||[];
        return '<tr><td class="l">'+z[1]+'</td><td>'+f1(a[0])+'%</td><td>'+pc(a[1])+'</td><td class="sv-hide-m">'+bar(a[0]||0,45,'var(--navy)')+'</td><td>'+f1(o[0])+'%</td><td>'+pc(o[1])+'</td><td class="sv-hide-m">'+bar(o[0]||0,45,'var(--red)')+'</td></tr>'; }).join('')+'</table>';
  }
  // play types
  if(t.pt&&(Object.keys(t.pt.o||{}).length)){
    var keys=Object.keys(PTN).filter(function(k){ return (t.pt.o||{})[k]||(t.pt.d||{})[k]; });
    h+='<h3 style="margin-top:14px">'+xk('Play types','tm_pt')+'</h3><table class="sv-t"><tr><th class="l">Play type</th><th>Off. freq</th><th>PPP</th><th>Pctile</th><th>Def. freq</th><th>PPP allowed</th><th>Pctile</th></tr>'
      +keys.map(function(k){ var o=(t.pt.o||{})[k]||[], dd=(t.pt.d||{})[k]||[];
        return '<tr><td class="l">'+PTN[k]+'</td><td>'+f1(o[0])+'%</td><td>'+(ok(o[1])?o[1].toFixed(2):'—')+'</td><td>'+f0(o[2])+'</td><td>'+f1(dd[0])+'%</td><td>'+(ok(dd[1])?dd[1].toFixed(2):'—')+'</td><td>'+f0(dd[2])+'</td></tr>'; }).join('')+'</table>';
  }
  // schedule
  if(t.sched){
    var sc=t.sched;
    h+='<h3 style="margin-top:14px">'+xk('Schedule ahead','tm_sos')+'</h3><div class="sv-kpis">'
      +[['Games left',f0(sc.left),'tm_left'],['Home',f0(sc.home),'tm_left'],['Back-to-backs',f0(sc.b2b),'tm_b2b'],['Opp. on a B2B',f0(sc.oppb2b),'tm_oppb2b'],['SOS',sg(sc.sos),'tm_sos'],['Next 7 days',f0(sc.next7),'tm_next7']]
      .map(function(x){ return '<div class="sv-kpi"><div class="k">'+xk(x[0],x[2])+'</div><div class="v">'+x[1]+'</div></div>'; }).join('')+'</div>'
      +'<div class="sv-games">Next: '+(sc.next||[]).map(function(g){ var dd=new Date(g[0]+'T12:00:00Z'); return (dd.getUTCMonth()+1)+'/'+dd.getUTCDate()+(g[2]?' v ':' @ ')+esc(g[1]); }).join(', ')+'</div>';
  }
  // roster from the player data
  if(typeof DATA!=='undefined'&&DATA&&DATA.data&&DATA.data[T.season]){
    var ros=(DATA.data[T.season].players||[]).filter(function(p){ return p.team===t.abbr; }).sort(function(a,b){ return (b.mpg||0)-(a.mpg||0); });
    if(ros.length) h+='<h3 style="margin-top:14px">Roster</h3><div>'+ros.map(function(p){ return '<span class="sv-chip"><span class="pl" data-pid="'+p.id+'">'+esc(p.name)+'</span></span>'; }).join('')+'</div>';
  }
  h+='<p style="margin-top:12px"><button type="button" class="sv-btn ghost" id="tmLu">Best '+esc(t.abbr)+' lineups →</button></p></div>';
  el.innerHTML=h;
  if(window.svMobile) window.svMobile.wrap(el);
  el.querySelectorAll('[data-pid]').forEach(function(x){ x.onclick=function(){ if(window.svClear) window.svClear(); if(typeof pickHome==='function') pickHome(+x.dataset.pid); }; });
  var b=$('tmLu'); if(b) b.onclick=function(){ T.luTeam=t.abbr; T.luSeason=T.season; if(window.svGo) window.svGo('lu'); };
}
function ordSuf(n){ var s=['th','st','nd','rd'], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }

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

window.svTeams={open:open, load:load, state:T};
})();
