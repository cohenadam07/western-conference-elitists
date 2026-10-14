/* Basketball Savant · the Fantasy tab, the tab bar, and the projection panel on the player card.
 *
 * Loaded after the main page script and reads its globals (DATA, cur, EXPL, explHtml, pickHome).
 * Data: savant-proj.json (~/Basketball-Savant/projections.py, rebuilt every refresh), the crowd
 * Dynasty board (/api/dynasty), and, when someone connects a league, Sleeper's public API
 * straight from the browser (CORS is open; nothing goes through our server).
 *
 * Adam's rule: every number here opens an explainer (what it is, how it is calculated, its
 * source, its sample) when its label is clicked. Labels carry class "xk" and data-k = an EXPL
 * key; tools/savant-api/check.mjs fails if a data-k here has no explainer.
 */
(function(){
'use strict';
var D=document;
function $(id){ return D.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function ok(v){ return v!=null&&isFinite(v); }
function f1(v){ return ok(v)?(Math.round(v*10)/10).toFixed(1):'—'; }
function f0(v){ return ok(v)?String(Math.round(v)):'—'; }
function f2(v){ return ok(v)?v.toFixed(2):'—'; }
function pc(v){ return ok(v)?(v*100).toFixed(1):'—'; }
function sg(v,d){ if(!ok(v)) return '—'; var s=Math.abs(v).toFixed(d==null?1:d); return (v>0.0001?'+':v<-0.0001?'−':'')+s; }
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function xk(text,k,tag){ tag=tag||'span'; return '<'+tag+' class="xk" data-k="'+k+'" title="What is this? Click">'+text+'</'+tag+'>'; }

/* ------------------------------------------------------------------ normal distribution */
function ncdf(x){ var t=1/(1+0.2316419*Math.abs(x)), d=0.3989422804014327*Math.exp(-x*x/2),
  p=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))); return x>0?1-p:p; }
function ninv(p){                                            // Acklam's rational approximation
  if(p<=0) return -8; if(p>=1) return 8;
  var a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.3577518672690,-30.66479806614716,2.506628277459239],
      b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],
      c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],
      d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416], q, r;
  if(p<0.02425){ q=Math.sqrt(-2*Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if(p>0.97575){ q=Math.sqrt(-2*Math.log(1-p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q=p-0.5; r=q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

/* ------------------------------------------------------------------ dates (US Eastern) */
function todayET(){ try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()); }catch(e){ return new Date().toISOString().slice(0,10); } }
function addDays(s,n){ var d=new Date(s+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function dow(s){ return new Date(s+'T12:00:00Z').getUTCDay(); }               // 0 = Sunday
var DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function shortDate(s){ var d=new Date(s+'T12:00:00Z'); return DOW[d.getUTCDay()]+' '+(d.getUTCMonth()+1)+'/'+d.getUTCDate(); }

/* ------------------------------------------------------------------ scoring */
// Verified defaults. Sleeper: fitted exactly to Sleeper's own standard points on 7,213 player-weeks
// of 2025-26 (zero error). ESPN: espn.com's default points-league page. Yahoo: help.yahoo.com SLN6919.
var PRESETS={
  sleeper:{label:'Sleeper', w:{pts:0.5,reb:1,ast:1,stl:2,blk:2,tov:-1,fg3m:0.5,dd:1,td:2,b40:2,b50:2}},
  espn:{label:'ESPN', w:{pts:1,fg3m:1,fga:-1,fgm:2,fta:-1,ftm:1,reb:1,ast:2,stl:4,blk:4,tov:-2}},
  yahoo:{label:'Yahoo', w:{pts:1,reb:1.2,ast:1.5,stl:3,blk:3,tov:-1}}
};
var WKEYS=[['pts','PTS'],['reb','REB'],['oreb','OREB'],['dreb','DREB'],['ast','AST'],['stl','STL'],['blk','BLK'],['tov','TO'],
  ['fg3m','3PM'],['fg3a','3PA'],['fgm','FGM'],['fga','FGA'],['fgmi','FG missed'],['ftm','FTM'],['fta','FTA'],['ftmi','FT missed'],['tpmi','3P missed'],
  ['dd','Double-double'],['td','Triple-double'],['b40','40+ pts bonus'],['b50','50+ pts bonus'],['a15','15+ ast bonus'],['r20','20+ reb bonus']];
// Sleeper league scoring_settings key -> ours
var SLP_KEY={pts:'pts',reb:'reb',oreb:'oreb',dreb:'dreb',ast:'ast',stl:'stl',blk:'blk',to:'tov',tpm:'fg3m',tpa:'fg3a',tpmi:'tpmi',
  fgm:'fgm',fga:'fga',fgmi:'fgmi',ftm:'ftm',fta:'fta',ftmi:'ftmi',dd:'dd',td:'td',bonus_pt_40p:'b40',bonus_pt_50p:'b50',
  bonus_ast_15p:'a15',bonus_reb_20p:'r20'};
var EVENTS=['dd','td','b40','b50','a15','r20'];
var CATS=[['pts','PTS'],['reb','REB'],['ast','AST'],['stl','STL'],['blk','BLK'],['fg3m','3PM'],['tov','TO'],['fgi','FG%'],['fti','FT%']];
var DYN_W=[1,0.8,0.6];                                       // this season, next, the one after

/* ------------------------------------------------------------------ state */
var FX={view:'rank', fmt:'points', preset:'sleeper', scope:'ros', basis:'total', pos:'All', q:'', teams:12, roster:13,
  sort:'value', hideOwned:false, custom:null, league:null, trade:{a:[],b:[]}, lock:{ids:[],scores:{},mine:null,opp:null,sd:null},
  streamWin:'next7'};
(function restore(){
  var s=lsGet('sv-fx'); if(!s) return;
  ['fmt','preset','scope','basis','teams','roster','custom','streamWin'].forEach(function(k){ if(s[k]!=null) FX[k]=s[k]; });
  if(s.lockIds) FX.lock.ids=s.lockIds;
})();
function save(){ lsSet('sv-fx',{fmt:FX.fmt,preset:FX.preset,scope:FX.scope,basis:FX.basis,teams:FX.teams,roster:FX.roster,
  custom:FX.custom,streamWin:FX.streamWin,lockIds:FX.lock.ids}); }

var P={data:null, loading:null, crowd:null, crowdLoading:null};
function loadProj(){
  if(P.data) return Promise.resolve(P.data);
  if(P.loading) return P.loading;
  P.loading=fetch('savant-proj.json',{cache:'no-cache'}).then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ if(d&&d.players){ prepProj(d); P.data=d; } return P.data; }).catch(function(){ return null; });
  return P.loading;
}
function loadCrowd(){
  if(P.crowd) return Promise.resolve(P.crowd);
  if(P.crowdLoading) return P.crowdLoading;
  P.crowdLoading=fetch('/api/dynasty?action=board&limit=600').then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ var m={}; ((j&&j.board)||[]).forEach(function(r){ m[String(r.id)]={rank:r.rank,value:10000*Math.exp(-r.rank/40)}; });
      P.crowd=m; return m; }).catch(function(){ P.crowd={}; return P.crowd; });
  return P.crowdLoading;
}
function prepProj(d){
  var ix={}; (d.log_cols||[]).forEach(function(c,i){ ix[c]=i; });
  d.ix=ix; d.list=[];
  var first=null; Object.keys(d.sched||{}).forEach(function(t){ var s=d.sched[t]; if(s.length&&(!first||s[0][0]<first)) first=s[0][0]; });
  d.firstGame=first;
  Object.keys(d.players).forEach(function(id){ var p=d.players[id]; p.id=+id; p._ev={}; d.list.push(p); });
}
function pg(p,scope){ return scope==='pre'?p.pre:p.ros; }

/* Per-game rates of the bonus events (double-doubles, 40-point games...), from his last 60
   games with each stat rescaled so the log averages what the projection says. */
function events(p,line){
  var key=line===p.pre?'pre':line===p.ros?'ros':null;          // three-season lines aren't cached
  if(key&&p._ev[key]) return p._ev[key];
  var L=p.log||[], ix=P.data.ix, n=L.length, out={dd:0,td:0,b40:0,b50:0,a15:0,r20:0,n:n};
  if(n){
    var S=['pts','reb','ast','stl','blk'], mean={}, sc={};
    S.forEach(function(k){ var s=0; for(var i=0;i<n;i++) s+=L[i][ix[k]]; mean[k]=s/n;
      sc[k]=mean[k]>0.05?Math.max(0.5,Math.min(2,(line[k]||0)/mean[k])):1; });
    for(var i=0;i<n;i++){
      var g=L[i], v={}, tens=0;
      S.forEach(function(k){ v[k]=g[ix[k]]*sc[k]; if(v[k]>=9.5) tens++; });
      if(tens>=2) out.dd++; if(tens>=3) out.td++;
      if(v.pts>=39.5) out.b40++; if(v.pts>=49.5) out.b50++; if(v.ast>=14.5) out.a15++; if(v.reb>=19.5) out.r20++;
    }
    var shrink=n/(n+5);
    EVENTS.forEach(function(e){ out[e]=out[e]/n*shrink; });
  }
  if(key) p._ev[key]=out; return out;
}
function statOf(line,k){
  if(k==='fgmi') return (line.fga||0)-(line.fgm||0);
  if(k==='ftmi') return (line.fta||0)-(line.ftm||0);
  if(k==='tpmi') return (line.fg3a||0)-(line.fg3m||0);
  return line[k]||0;
}
function weights(){
  if(FX.preset==='custom') return FX.custom||PRESETS.sleeper.w;
  if(FX.preset==='league'&&FX.league&&FX.league.w) return FX.league.w;
  return (PRESETS[FX.preset]||PRESETS.sleeper).w;
}
function fpPerGame(p,line,w){
  w=w||weights(); var ev=events(p,line), s=0;
  Object.keys(w).forEach(function(k){ s+=w[k]*(EVENTS.indexOf(k)>=0?(ev[k]||0):statOf(line,k)); });
  return s;
}
/* One game's fantasy points from a box-score row of his log, rescaled to the projection. */
function fpGames(p,line,w){
  w=w||weights(); var L=p.log||[], ix=P.data.ix, n=L.length;
  if(n<8) return null;
  var S=['min','pts','reb','ast','stl','blk','fg3m','tov','fgm','fga','ftm','fta','oreb','dreb'], mean={}, sc={};
  S.forEach(function(k){ var s=0; for(var i=0;i<n;i++) s+=L[i][ix[k]]; mean[k]=s/n; sc[k]=mean[k]>0.05?Math.max(0.4,Math.min(2.5,(line[k]||0)/mean[k])):1; });
  var out=[];
  for(var i=0;i<n;i++){
    var g=L[i], v={fg3a:0};
    S.forEach(function(k){ v[k]=g[ix[k]]*sc[k]; });
    v.fg3a=v.fg3m*((line.fg3a||0)/Math.max(0.01,line.fg3m||0.01));
    var tens=0; ['pts','reb','ast','stl','blk'].forEach(function(k){ if(v[k]>=9.5) tens++; });
    var e={dd:tens>=2?1:0,td:tens>=3?1:0,b40:v.pts>=39.5?1:0,b50:v.pts>=49.5?1:0,a15:v.ast>=14.5?1:0,r20:v.reb>=19.5?1:0}, s=0;
    Object.keys(w).forEach(function(k){ s+=w[k]*(EVENTS.indexOf(k)>=0?e[k]:statOf(v,k)); });
    out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ games in a window */
function seasonStarted(){ return P.data.firstGame&&todayET()>=P.data.firstGame; }
function weekBounds(){
  var t=todayET(), first=P.data.firstGame;
  if(first&&t<first) t=first;                                       // preseason: the opening week
  var start=addDays(t,-((dow(t)+6)%7));                              // Monday
  if(first&&start<first) start=first;
  var end=addDays(t,(7-dow(t))%7);                                   // Sunday
  return [start,end];
}
function teamGames(p,win){
  var s=(P.data.sched||{})[p.team]||[], t=todayET();
  if(win==='next7'){ var e=addDays(t,7); return s.filter(function(g){ return g[0]>=t&&g[0]<e; }); }
  if(win==='week'){ var b=weekBounds(); return s.filter(function(g){ return g[0]>=b[0]&&g[0]<=b[1]&&g[0]>=t; }); }
  return s.filter(function(g){ return g[0]>=t; });
}
/* Expected games he plays: each team game x his availability (games played ÷ team games, last
   three seasons), with today's injury designation applied to the games right in front of him. */
function playProbs(p,games){
  var r=Math.min(1,p.gp_rate||0.8), st=p.status||'', t=todayET();
  return games.map(function(g,i){
    if(st==='IR'||st==='Sus'||st==='Suspended') return g[0]<addDays(t,14)?0:r;
    if(st==='Out'||st==='OUT') return i===0?0:(g[0]<addDays(t,7)?r*0.5:r);
    if(i===0&&st) return p.play!=null?p.play:r;
    return r;
  });
}
function expGames(p,games){ return playProbs(p,games).reduce(function(a,b){ return a+b; },0); }

/* A player's line over the chosen window: totals (or per game) of every counting stat, plus
   fantasy points. Dynasty = this season + the next two, weighted 1 / 0.8 / 0.6. */
var COUNT=['min','pts','reb','oreb','dreb','ast','stl','blk','tov','fg3m','fg3a','fgm','fga','ftm','fta'];
function lineFor(p,scope,basis){
  var L={G:0}, w=weights();
  COUNT.forEach(function(k){ L[k]=0; }); L.fp=0;
  if(scope==='dyn'){
    (p.y3||[]).forEach(function(s,i){
      var g=82*Math.min(1,p.gp_rate||0.8)*(DYN_W[i]||0), ln=s.pg;
      COUNT.forEach(function(k){ L[k]+=(ln[k]||0)*g; }); L.fp+=fpPerGame(p,ln,w)*g; L.G+=g;
    });
  } else {
    var ln=pg(p,scope), G;
    if(scope==='pre') G=82*Math.min(1,p.gp_rate||0.8);
    else G=expGames(p,teamGames(p,scope==='ros'?'ros':scope));
    COUNT.forEach(function(k){ L[k]=(ln[k]||0)*G; }); L.fp=fpPerGame(p,ln,w)*G; L.G=G;
  }
  if(basis==='pg'&&L.G>0){ var g0=L.G; COUNT.forEach(function(k){ L[k]/=g0; }); L.fp/=g0; L.G=g0; L.pg=true; }
  return L;
}

/* ------------------------------------------------------------------ valuation
   Points: fantasy points over the window; replacement = the (teams × roster + 1)th player.
   9-cat: z-scores of each category over the pool of rosterable players (teams × roster),
   percentages as volume-weighted impact, recomputed until the pool settles (3 passes). */
function valueAll(scope,basis,fmt){
  var rows=P.data.list.map(function(p){ return {p:p, L:lineFor(p,scope,basis)}; })
    .filter(function(r){ return r.L.G>0||scope==='pre'; });
  var N=Math.max(1,FX.teams*FX.roster);
  if(fmt==='points'){
    rows.forEach(function(r){ r.v=r.L.fp; });
  } else {
    rows.sort(function(a,b){ return (b.L.pts+b.L.reb+b.L.ast)-(a.L.pts+a.L.reb+a.L.ast); });
    var pool=rows.slice(0,N);
    for(var it=0;it<3;it++){
      var sf=0,sa=0,tf=0,ta=0; pool.forEach(function(r){ sf+=r.L.fgm; sa+=r.L.fga; tf+=r.L.ftm; ta+=r.L.fta; });
      var lgFG=sa?sf/sa:0.47, lgFT=ta?tf/ta:0.78;
      rows.forEach(function(r){ r.c={pts:r.L.pts,reb:r.L.reb,ast:r.L.ast,stl:r.L.stl,blk:r.L.blk,fg3m:r.L.fg3m,tov:r.L.tov,
        fgi:r.L.fgm-r.L.fga*lgFG, fti:r.L.ftm-r.L.fta*lgFT}; });
      var mu={}, sd={};
      CATS.forEach(function(c){ var k=c[0], s=0, s2=0; pool.forEach(function(r){ s+=r.c[k]; s2+=r.c[k]*r.c[k]; });
        mu[k]=s/pool.length; sd[k]=Math.sqrt(Math.max(1e-9,s2/pool.length-mu[k]*mu[k])); });
      rows.forEach(function(r){ r.z={}; var t=0; CATS.forEach(function(c){ var k=c[0], z=(r.c[k]-mu[k])/sd[k]; if(k==='tov') z=-z; r.z[k]=z; t+=z; }); r.v=t; });
      rows.sort(function(a,b){ return b.v-a.v; }); pool=rows.slice(0,N);
      P.lg={fg:lgFG,ft:lgFT};
    }
  }
  rows.sort(function(a,b){ return b.v-a.v; });
  var repl=rows[Math.min(rows.length-1,N)]; var rv=repl?repl.v:0;
  rows.forEach(function(r,i){ r.rank=i+1; r.vor=r.v-rv; });
  rows.repl=rv;
  return rows;
}
var _cache={};
function valued(scope,basis,fmt){
  var key=[scope,basis,fmt,FX.preset,JSON.stringify(weights()),FX.teams,FX.roster].join('|');
  if(!_cache[key]){ _cache={}; _cache[key]=valueAll(scope,basis,fmt); }
  return _cache[key];
}
function byId(rows){ var m={}; rows.forEach(function(r){ m[r.p.id]=r; }); return m; }

/* ------------------------------------------------------------------ Sleeper */
function slp(path){ return fetch('https://api.sleeper.app/v1/'+path).then(function(r){ if(!r.ok) throw new Error('Sleeper '+r.status); return r.json(); }); }
function slpToNba(){
  if(P._s2n) return P._s2n; var m={}; P.data.list.forEach(function(p){ if(p.slp) m[String(p.slp)]=p.id; }); P._s2n=m; return m;
}
function ownerOf(id){
  var L=FX.league; if(!L||!L.owner) return null; return L.owner[id]||null;
}
/* Connect a Sleeper league: username -> leagues -> the chosen league's scoring, rosters,
   owners and this week's matchup. Everything stays in this browser. */
function sleeperFindLeagues(username){
  return slp('state/nba').catch(function(){ return {}; }).then(function(state){
    var season=String(state.season||(P.data&&P.data.season?P.data.season.slice(0,4):new Date().getFullYear()));
    return slp('user/'+encodeURIComponent(username)).then(function(u){
      if(!u||!u.user_id) throw new Error('No Sleeper user called “'+username+'”');
      return slp('user/'+u.user_id+'/leagues/nba/'+season).then(function(ls){ return {user:u,state:state,season:season,leagues:ls||[]}; });
    });
  });
}
function sleeperLoadLeague(user,state,leagueId){
  var wk=state&&state.week?state.week:1;
  return Promise.all([slp('league/'+leagueId),slp('league/'+leagueId+'/rosters'),slp('league/'+leagueId+'/users'),
    slp('league/'+leagueId+'/matchups/'+wk).catch(function(){ return []; })]).then(function(a){
    var lg=a[0], rosters=a[1]||[], users=a[2]||[], mus=a[3]||[], s2n=slpToNba();
    var uname={}; users.forEach(function(u){ uname[u.user_id]=(u.metadata&&u.metadata.team_name)||u.display_name||'Team'; });
    var w={}, unknown=[];
    Object.keys(lg.scoring_settings||{}).forEach(function(k){ var v=+lg.scoring_settings[k]; if(!v) return;
      if(SLP_KEY[k]) w[SLP_KEY[k]]=v; else unknown.push(k); });
    var owner={}, teams=rosters.map(function(r){
      var ids=(r.players||[]).map(function(s){ return s2n[String(s)]; }).filter(Boolean);
      var nm=uname[r.owner_id]||('Roster '+r.roster_id);
      ids.forEach(function(id){ owner[id]=nm; });
      return {rid:r.roster_id, owner:r.owner_id, name:nm, ids:ids, starters:(r.starters||[]).map(function(s){ return s2n[String(s)]; }).filter(Boolean),
        unmatched:(r.players||[]).filter(function(s){ return !s2n[String(s)]; }).length};
    });
    var mine=teams.filter(function(t){ return t.owner===user.user_id; })[0]||null;
    var slots=(lg.roster_positions||[]).filter(function(p){ return p!=='BN'&&p!=='IR'; }).length;
    var opp=null;
    if(mine){ var me=mus.filter(function(m){ return m.roster_id===mine.rid; })[0];
      if(me&&me.matchup_id!=null){ var o=mus.filter(function(m){ return m.matchup_id===me.matchup_id&&m.roster_id!==mine.rid; })[0];
        if(o) opp=teams.filter(function(t){ return t.rid===o.roster_id; })[0]||null; } }
    return {id:leagueId, name:lg.name, season:lg.season, dynasty:lg.settings&&lg.settings.type===2, keeper:lg.settings&&lg.settings.type===1,
      w:w, unknown:unknown, teams:teams, owner:owner, mine:mine, opp:opp, slots:slots||10, size:rosters.length,
      rosterSize:(lg.roster_positions||[]).filter(function(p){ return p!=='IR'; }).length||13, week:wk, user:user.display_name};
  });
}

/* ------------------------------------------------------------------ shell: tab bar + views */
var CSS=[
'.sv-tabs{display:flex;gap:4px;flex-wrap:wrap;max-width:1180px;margin:0 auto;padding:12px 18px 0}',
'body.home-open .sv-tabs{display:none}',
'.sv-tab{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;padding:7px 13px;border-radius:16px;border:1px solid var(--line);background:var(--surface);color:var(--navy);cursor:pointer}',
'.sv-tab:hover{border-color:var(--gold)}',
'.sv-tab.on{background:var(--navy);color:var(--gold);border-color:var(--navy)}',
'.sv-tab .new{font-size:8.5px;margin-left:5px;color:var(--red);letter-spacing:.04em}',
'.sv-tab.on .new{color:var(--gold)}',
'.svv{display:none;max-width:1180px;margin:0 auto;padding:18px 18px 90px}',
'body.tab-fx .home,body.tab-fx .wrap,body.tab-fx .lb,body.tab-tm .home,body.tab-tm .wrap,body.tab-tm .lb,body.tab-lu .home,body.tab-lu .wrap,body.tab-lu .lb{display:none}',
'body.tab-fx #svFx,body.tab-tm #svTm,body.tab-lu #svLu{display:block}',
'.sv-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--gold);padding-bottom:12px;margin-bottom:14px}',
'.sv-title{font-family:var(--body);font-weight:800;font-size:30px;line-height:1;color:var(--ink);margin:0}',
'.sv-title em{font-style:italic;color:var(--navy)}',
'.sv-sub{font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.04em;margin-top:6px}',
'.sv-seg{display:inline-flex;border:1px solid var(--line);border-radius:14px;overflow:hidden;flex-wrap:wrap}',
'.sv-seg button{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:6px 11px;border:none;background:var(--surface);color:var(--faint);cursor:pointer}',
'.sv-seg button.on{background:var(--navy);color:var(--gold)}',
'.sv-views{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}',
'.sv-vbtn{font-family:var(--body);font-weight:600;font-size:13px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}',
'.sv-vbtn.on{border-color:var(--navy);box-shadow:inset 0 -3px 0 var(--gold)}',
'.sv-ctl{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:flex-end;background:#F4F3F0;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}',
'.sv-f{display:flex;flex-direction:column;gap:4px}',
'.sv-f>label,.sv-lab{font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}',
'.sv-f select,.sv-f input,.sv-in{font-family:var(--mono);font-size:12.5px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px}',
'.sv-f input[type=number]{width:70px}',
'.sv-btn{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:8px 13px;border-radius:8px;border:none;background:var(--navy);color:var(--gold);cursor:pointer}',
'.sv-btn.ghost{background:var(--surface);color:var(--navy);border:1px solid var(--line)}',
'.sv-note{font-family:var(--mono);font-size:11px;color:var(--muted);line-height:1.55;margin:0 0 10px}',
'.sv-warn{color:var(--red)}',
'.sv-tw{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}',
'.sv-t{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}',
'.sv-t th{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);text-align:right;padding:8px 8px;border-bottom:1px solid var(--line);white-space:nowrap;background:#FAFAF8;position:sticky;top:0}',
'.sv-t th.l,.sv-t td.l{text-align:left}',
'.sv-t td{padding:7px 8px;border-bottom:1px solid #F0EFEC;text-align:right;white-space:nowrap}',
'.sv-t tr:hover td{background:#FBFAF7}',
'.sv-t .pl{font-weight:600;color:var(--ink);cursor:pointer}',
'.sv-t .pl:hover{color:var(--navy);text-decoration:underline}',
'.sv-t .tm{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-left:6px}',
'.sv-t .big{font-weight:700;color:var(--navy)}',
'.sv-st{display:inline-block;font-family:var(--mono);font-size:9px;letter-spacing:.04em;padding:1px 5px;border-radius:4px;background:#F6E3E0;color:var(--red);margin-left:6px;vertical-align:1px}',
'.sv-own{font-family:var(--mono);font-size:10.5px;color:var(--muted)}',
'.sv-fa{font-family:var(--mono);font-size:10px;color:#2E7D4F;font-weight:600}',
'.xk{cursor:pointer;border-bottom:1px dotted currentColor}',
'th.xk{border-bottom:1px solid var(--line)}',
'th.xk:hover,.xk:hover{color:var(--navy)}',
'.sv-expl{margin:0 0 10px}',
'.sv-expl .expl b{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--navy);margin-bottom:4px}',
'.sv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
'@media(max-width:760px){.sv-grid2{grid-template-columns:1fr}}',
'.sv-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px}',
'.sv-card h3{margin:0 0 8px;font-size:15px;font-weight:800}',
'.sv-pick{position:relative}',
'.sv-res{position:absolute;z-index:30;left:0;right:0;top:100%;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.08);max-height:260px;overflow:auto}',
'.sv-res div{padding:7px 10px;cursor:pointer;font-size:13px}',
'.sv-res div:hover{background:#F4F3F0}',
'.sv-chip{display:inline-flex;align-items:center;gap:6px;background:#F4F3F0;border:1px solid var(--line);border-radius:14px;padding:4px 6px 4px 10px;margin:3px 4px 3px 0;font-size:12.5px}',
'.sv-chip button{border:none;background:none;color:var(--faint);cursor:pointer;font-size:14px;line-height:1}',
'.sv-verdict{font-size:15px;font-weight:700;margin:10px 0 4px}',
'.sv-good{color:#2E7D4F}.sv-bad{color:var(--red)}',
'.sv-z{display:inline-block;min-width:38px;padding:1px 4px;border-radius:4px}',
'.sv-gap{font-family:var(--mono);font-size:11px;font-weight:700}',
'.sv-games{font-family:var(--mono);font-size:10.5px;color:var(--muted)}',
'.sv-b2b{color:var(--red);font-weight:700}',
'.sv-kpis{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px}',
'.sv-kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:120px}',
'.sv-kpi .v{font-size:20px;font-weight:800;color:var(--navy)}',
'.sv-kpi .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}',
'.home-tabs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px auto 0}',
'.home-tabs button{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:9px 16px;border-radius:20px;border:1px solid var(--navy);background:transparent;color:var(--navy);cursor:pointer}',
'.home-tabs button:hover{background:var(--navy);color:var(--gold)}',
'.projp table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}',
'.projp th{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);text-align:right;padding:4px 6px;font-weight:500}',
'.projp td{text-align:right;padding:4px 6px;border-top:1px solid var(--line)}',
'.projp th:first-child,.projp td:first-child{text-align:left}',
'@media(max-width:640px){.sv-title{font-size:24px}.svv{padding:14px 12px 80px}.sv-tabs{padding:10px 12px 0}}'
].join('\n');

function shell(){
  if($('svFx')) return;
  var st=D.createElement('style'); st.textContent=CSS; D.head.appendChild(st);
  var tabs=D.createElement('nav'); tabs.className='sv-tabs'; tabs.id='svTabs'; tabs.setAttribute('aria-label','Basketball Savant sections');
  tabs.innerHTML='<button type="button" class="sv-tab" data-t="players">Players</button>'
    +'<button type="button" class="sv-tab" data-t="lb">Leaderboards</button>'
    +'<button type="button" class="sv-tab" data-t="fx">Fantasy<span class="new">new</span></button>'
    +'<button type="button" class="sv-tab" data-t="tm">Teams<span class="new">new</span></button>'
    +'<button type="button" class="sv-tab" data-t="lu">Lineups<span class="new">new</span></button>';
  var wrap=D.querySelector('.wrap'); if(wrap) wrap.parentNode.insertBefore(tabs,wrap); else D.body.appendChild(tabs);
  tabs.addEventListener('click',function(e){ var b=e.target.closest('.sv-tab'); if(!b) return; go(b.dataset.t); });
  ['svFx','svTm','svLu'].forEach(function(id){ var v=D.createElement('div'); v.className='svv'; v.id=id; D.body.appendChild(v); });
  var hb=$('homeLbBtn');
  if(hb){ var ht=D.createElement('div'); ht.className='home-tabs';
    ht.innerHTML='<button type="button" data-t="fx">Fantasy</button><button type="button" data-t="tm">Teams</button><button type="button" data-t="lu">Lineups</button>';
    hb.parentNode.insertBefore(ht,hb.nextSibling);
    ht.addEventListener('click',function(e){ var b=e.target.closest('button'); if(b) go(b.dataset.t); }); }
  D.addEventListener('click',explClick);
  syncTabs();
}
function syncTabs(){
  var b=D.body.classList, on=b.contains('tab-fx')?'fx':b.contains('tab-tm')?'tm':b.contains('tab-lu')?'lu':b.contains('lb-open')?'lb':'players';
  D.querySelectorAll('.sv-tab').forEach(function(t){ t.classList.toggle('on',t.dataset.t===on); });
}
function svClear(){ D.body.classList.remove('tab-fx','tab-tm','tab-lu'); syncTabs(); }
function go(t,noPush){
  if(t==='players'){
    svClear(); D.body.classList.remove('lb-open');
    if(typeof curId!=='undefined'&&curId!=null){ D.body.classList.remove('home-open'); try{ history.pushState({app:1},'',location.pathname+location.search+'#p'); }catch(e){} window.scrollTo(0,0); }
    else if(typeof showHome==='function') showHome();
    syncTabs(); return;
  }
  if(t==='lb'){ svClear(); if(typeof showLB==='function') showLB(); syncTabs(); return; }
  D.body.classList.remove('home-open','lb-open','tab-fx','tab-tm','tab-lu');
  D.body.classList.add('tab-'+t);
  if(!noPush){ var h={fx:'#fantasy',tm:'#teams',lu:'#lineups'}[t]; try{ history.pushState({sv:t},'',location.pathname+location.search+h); }catch(e){} }
  window.scrollTo(0,0); syncTabs();
  if(t==='fx') openFantasy();
  else if(window.svTeams&&t==='tm') window.svTeams.open('tm');
  else if(window.svTeams&&t==='lu') window.svTeams.open('lu');
}
/* Route a hash: true when it is one of ours (the main page's popstate asks first). */
function route(hash){
  hash=hash||'';
  if(hash.indexOf('#fantasy')===0){ var v=hash.split('/')[1]; if(v&&VIEWS.some(function(x){ return x[0]===v; })) FX.view=v; go('fx',true); return true; }
  if(hash.indexOf('#teams')===0){ go('tm',true); return true; }
  if(hash.indexOf('#lineups')===0){ go('lu',true); return true; }
  svClear(); return false;
}

/* Explainers: any .xk label toggles its explainer in the nearest .sv-expl slot. */
function explClick(e){
  var el=e.target.closest&&e.target.closest('.xk'); if(!el) return;
  var root=el.closest('.sv-sec')||el.closest('.svv')||el.closest('.projp'); if(!root) return;
  var slot=root.querySelector('.sv-expl'); if(!slot) return;
  var k=el.dataset.k;
  if(slot.dataset.k===k){ slot.innerHTML=''; slot.dataset.k=''; return; }
  var h=(typeof explHtml==='function')?explHtml(k):'';
  if(!h) return;
  slot.dataset.k=k;
  slot.innerHTML='<div class="expl"><b>'+esc(el.textContent.replace(/[▲▼]/g,'').trim())+'</b>'+h+'</div>';
  e.preventDefault();
}

/* ------------------------------------------------------------------ the Fantasy view */
var VIEWS=[['rank','Rankings'],['dyn','Dynasty'],['trade','Trade'],['stream','Streamers'],['lock','Lock-In'],['inj','Injuries'],['league','My Sleeper league']];
var SCOPES=[['ros','Rest of season'],['next7','Next 7 days'],['week','This week'],['pre','Full season (preseason)'],['dyn','Dynasty (3 seasons)']];
function openFantasy(){
  var v=$('svFx');
  if(!P.data){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">Fantasy</h1><div class="sv-sub">Loading projections…</div></div></div>';
    loadProj().then(function(d){ if(!d){ v.innerHTML='<div class="sv-head"><div><h1 class="sv-title">Fantasy</h1><div class="sv-sub sv-warn">Projections aren’t available right now. They rebuild with every refresh; try again shortly.</div></div></div>'; return; }
      renderFx(); });
    return;
  }
  renderFx();
}
function headHtml(){
  var d=P.data, gen=d.generated?new Date(d.generated):null;
  var when=gen?gen.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET':'';
  return '<div class="sv-head"><div><h1 class="sv-title">Fantasy <em>Savant</em></h1>'
    +'<div class="sv-sub">'+esc(d.season)+' projections · '+d.list.length+' players · updated '+esc(when)+' · '+xk('how the projections work','pj_method')+'</div></div>'
    +'<div class="sv-sub">Points, 9-cat and dynasty · Sleeper, ESPN and Yahoo scoring · '+xk('connect your Sleeper league','fx_sleeper')+'</div></div>';
}
function renderFx(){
  var v=$('svFx'); if(!v||!P.data) return;
  var h=headHtml();
  h+='<div class="sv-views" id="fxViews">'+VIEWS.map(function(x){ return '<button type="button" class="sv-vbtn'+(FX.view===x[0]?' on':'')+'" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>';
  h+='<div class="sv-sec" id="fxSec"></div>';
  v.innerHTML=h;
  $('fxViews').onclick=function(e){ var b=e.target.closest('.sv-vbtn'); if(!b) return; FX.view=b.dataset.v;
    try{ history.replaceState({sv:'fx'},'',location.pathname+location.search+'#fantasy/'+FX.view); }catch(err){}
    renderFx(); };
  var sec=$('fxSec');
  ({rank:viewRank,dyn:viewDyn,trade:viewTrade,stream:viewStream,lock:viewLock,inj:viewInj,league:viewLeague}[FX.view]||viewRank)(sec);
}
/* Shared settings bar: format, scoring, league size. */
function settingsHtml(opts){
  opts=opts||{};
  var h='<div class="sv-ctl">';
  if(!opts.noFmt) h+='<div class="sv-f"><label>'+xk('Format','fx_format')+'</label><span class="sv-seg" data-set="fmt"><button type="button" data-v="points"'+(FX.fmt==='points'?' class="on"':'')+'>Points</button><button type="button" data-v="cats"'+(FX.fmt==='cats'?' class="on"':'')+'>9-cat</button></span></div>';
  if(FX.fmt==='points'||opts.noFmt){
    h+='<div class="sv-f"><label>'+xk('Scoring','fx_scoring')+'</label><select data-set="preset">'
      +Object.keys(PRESETS).map(function(k){ return '<option value="'+k+'"'+(FX.preset===k?' selected':'')+'>'+PRESETS[k].label+' default</option>'; }).join('')
      +(FX.league?'<option value="league"'+(FX.preset==='league'?' selected':'')+'>'+esc(FX.league.name)+' (your league)</option>':'')
      +'<option value="custom"'+(FX.preset==='custom'?' selected':'')+'>Custom…</option></select></div>';
  }
  if(!opts.noScope) h+='<div class="sv-f"><label>'+xk('Window','fx_window')+'</label><select data-set="scope">'+SCOPES.filter(function(s){ return !opts.scopes||opts.scopes.indexOf(s[0])>=0; }).map(function(s){ return '<option value="'+s[0]+'"'+(FX.scope===s[0]?' selected':'')+'>'+s[1]+'</option>'; }).join('')+'</select></div>';
  if(!opts.noBasis) h+='<div class="sv-f"><label>'+xk('Count','fx_basis')+'</label><span class="sv-seg" data-set="basis"><button type="button" data-v="total"'+(FX.basis==='total'?' class="on"':'')+'>Totals</button><button type="button" data-v="pg"'+(FX.basis==='pg'?' class="on"':'')+'>Per game</button></span></div>';
  h+='<div class="sv-f"><label>'+xk('League','fx_repl')+'</label><span style="display:flex;gap:6px;align-items:center"><input type="number" min="4" max="30" data-set="teams" value="'+FX.teams+'"><span class="sv-lab">teams ×</span><input type="number" min="5" max="30" data-set="roster" value="'+FX.roster+'"><span class="sv-lab">players</span></span></div>';
  h+=opts.extra||'';
  h+='</div>';
  if(FX.preset==='custom'&&(FX.fmt==='points'||opts.noFmt)){
    var w=FX.custom||PRESETS.sleeper.w;
    h+='<div class="sv-ctl" id="fxCustom">'+WKEYS.map(function(k){ return '<div class="sv-f"><label>'+k[1]+'</label><input type="number" step="0.1" data-w="'+k[0]+'" value="'+(w[k[0]]||0)+'"></div>'; }).join('')+'</div>';
  }
  if(FX.preset==='league'&&FX.league&&FX.league.unknown.length) h+='<p class="sv-note">Your league also scores '+FX.league.unknown.map(esc).join(', ')+', which the projections don’t cover; those are left out.</p>';
  return h;
}
function wireSettings(root,rerender){
  root.querySelectorAll('[data-set]').forEach(function(el){
    var k=el.dataset.set;
    if(el.classList.contains('sv-seg')){ el.onclick=function(e){ var b=e.target.closest('button'); if(!b) return; FX[k]=b.dataset.v; save(); rerender(); }; return; }
    var fn=function(){ var v=el.value; if(k==='teams'||k==='roster'){ v=Math.max(1,parseInt(v,10)||FX[k]); }
      FX[k]=v; if(k==='preset'&&v==='custom'&&!FX.custom) FX.custom=Object.assign({},PRESETS.sleeper.w); save(); rerender(); };
    if(el.tagName==='INPUT') el.onchange=fn; else el.onchange=fn;
  });
  root.querySelectorAll('[data-w]').forEach(function(el){ el.onchange=function(){ FX.custom=FX.custom||{}; var v=parseFloat(el.value);
    if(isFinite(v)&&v!==0) FX.custom[el.dataset.w]=v; else delete FX.custom[el.dataset.w]; save(); rerender(); }; });
}
function nameCell(p){
  var st=p.status?'<span class="sv-st" title="Sleeper injury designation">'+esc(p.status)+'</span>':'';
  var rk=p.rookie?'<span class="sv-st" style="background:#E7EEF7;color:var(--navy)">R</span>':'';
  return '<span class="pl" data-id="'+p.id+'">'+esc(p.name)+'</span><span class="tm">'+esc(p.team)+' · '+esc(p.pos)+'</span>'+st+rk;
}
function wirePlayers(root){
  root.querySelectorAll('.pl[data-id]').forEach(function(el){ el.onclick=function(){
    var id=+el.dataset.id;
    if(typeof pickHome==='function'){ svClear(); pickHome(id); } }; });
}
function zCell(z,txt){
  if(!ok(z)) return '<td>'+txt+'</td>';
  var a=Math.max(-2.5,Math.min(2.5,z))/2.5, bg=a>0?'rgba(188,58,44,'+(a*0.32).toFixed(3)+')':'rgba(28,78,134,'+(-a*0.32).toFixed(3)+')';
  return '<td><span class="sv-z" style="background:'+bg+'">'+txt+'</span></td>';
}
function ownerCell(id){
  if(!FX.league) return '';
  var o=ownerOf(id); return '<td class="l">'+(o?'<span class="sv-own">'+esc(o)+'</span>':'<span class="sv-fa">FREE AGENT</span>')+'</td>';
}

/* ---- Rankings */
function viewRank(sec){
  var rows=valued(FX.scope,FX.basis,FX.fmt);
  var crowd=P.crowd||{};
  if(!P.crowd) loadCrowd().then(function(){ if(FX.view==='rank'&&D.body.classList.contains('tab-fx')) renderFx(); });
  var q=FX.q.trim().toLowerCase();
  var list=rows.filter(function(r){
    if(FX.pos!=='All'&&r.p.pos!==FX.pos) return false;
    if(q&&r.p.name.toLowerCase().indexOf(q)<0&&r.p.team.toLowerCase()!==q) return false;
    if(FX.hideOwned&&FX.league&&ownerOf(r.p.id)) return false;
    return true;
  });
  var limit=FX.limit||150, cats=FX.fmt==='cats', per=FX.basis==='pg'||FX.scope==='pre'&&false;
  var extra='<div class="sv-f"><label>Position</label><select id="fxPos">'+['All','Guard','Wing','Big'].map(function(x){ return '<option'+(FX.pos===x?' selected':'')+'>'+x+'</option>'; }).join('')+'</select></div>'
    +'<div class="sv-f"><label>Find</label><input id="fxQ" class="sv-in" placeholder="Player or team (LAL)" value="'+esc(FX.q)+'"></div>'
    +(FX.league?'<label class="sv-lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fxHide"'+(FX.hideOwned?' checked':'')+'> free agents only</label>':'');
  var h=settingsHtml({extra:extra});
  h+='<div class="sv-expl"></div>';
  h+='<p class="sv-note">'+(cats?'9-cat value = the sum of his z-scores across the nine categories, ':'Fantasy points ')
    +(FX.scope==='dyn'?'over the next three seasons (weighted 1 / 0.8 / 0.6)':'over '+SCOPES.filter(function(s){ return s[0]===FX.scope; })[0][1].toLowerCase())
    +(FX.basis==='pg'?', per game':'')+'. Replacement level is player #'+(FX.teams*FX.roster+1)+'. Click any column name for how it’s built; click a player for his full Savant card.</p>';
  var cols='<tr><th class="xk" data-k="fx_rank">#</th><th class="l">Player</th><th class="xk" data-k="fx_games">G</th><th class="xk" data-k="pj_min">MIN</th>'
    +'<th class="xk" data-k="pj_pts">PTS</th><th class="xk" data-k="pj_reb">REB</th><th class="xk" data-k="pj_ast">AST</th><th class="xk" data-k="pj_stl">STL</th><th class="xk" data-k="pj_blk">BLK</th>'
    +'<th class="xk" data-k="pj_fg3m">3PM</th><th class="xk" data-k="pj_tov">TO</th><th class="xk" data-k="pj_fgpct">FG%</th><th class="xk" data-k="pj_ftpct">FT%</th>'
    +(cats?'<th class="xk" data-k="fx_z">Value</th>':'<th class="xk" data-k="fx_fpg">FP/G</th><th class="xk" data-k="fx_fp">FP</th>')
    +'<th class="xk" data-k="fx_vor">vs Repl</th><th class="xk" data-k="fx_dyn_crowd">Crowd</th>'+(FX.league?'<th class="l xk" data-k="fx_owner">Owner</th>':'')+'</tr>';
  var body=list.slice(0,limit).map(function(r){
    var p=r.p, L=r.L, G=L.pg?1:Math.max(L.G,1e-9), g=function(k){ return L[k]/G; };
    var fg=L.fga>0?L.fgm/L.fga:null, ft=L.fta>0?L.ftm/L.fta:null, cr=crowd[String(p.id)];
    var cell=function(k,txt){ return cats&&r.z?zCell(r.z[k],txt):'<td>'+txt+'</td>'; };
    return '<tr><td>'+r.rank+'</td><td class="l">'+nameCell(p)+'</td><td>'+(L.pg?'—':f1(L.G))+'</td><td>'+f1(g('min'))+'</td>'
      +cell('pts',f1(g('pts')))+cell('reb',f1(g('reb')))+cell('ast',f1(g('ast')))+cell('stl',f1(g('stl')))+cell('blk',f1(g('blk')))
      +cell('fg3m',f1(g('fg3m')))+cell('tov',f1(g('tov')))+cell('fgi',pc(fg))+cell('fti',pc(ft))
      +(cats?'<td class="big">'+f2(r.v)+'</td>':'<td>'+f1(L.pg?L.fp:L.fp/Math.max(L.G,1e-9))+'</td><td class="big">'+f0(L.pg?NaN:L.fp)+'</td>')
      +'<td>'+(cats?sg(r.vor,2):sg(r.vor,0))+'</td><td>'+(cr?cr.rank:'—')+'</td>'+ownerCell(p.id)+'</tr>';
  }).join('');
  h+='<div class="sv-tw"><table class="sv-t">'+cols+body+'</table></div>';
  if(list.length>limit) h+='<p style="text-align:center"><button type="button" class="sv-btn ghost" id="fxMore">Show '+Math.min(150,list.length-limit)+' more</button></p>';
  sec.innerHTML=h;
  wireSettings(sec,renderFx); wirePlayers(sec);
  $('fxPos').onchange=function(e){ FX.pos=e.target.value; renderFx(); };
  var qi=$('fxQ'); qi.oninput=function(){ FX.q=qi.value; var pos=qi.selectionStart; renderFx(); var n=$('fxQ'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } };
  var hd=$('fxHide'); if(hd) hd.onchange=function(){ FX.hideOwned=hd.checked; renderFx(); };
  var m=$('fxMore'); if(m) m.onclick=function(){ FX.limit=(FX.limit||150)+150; renderFx(); };
}

/* ---- Dynasty: our 3-season model next to the crowd board */
function viewDyn(sec){
  var rows=valued('dyn','total',FX.fmt), crowd=P.crowd;
  if(!crowd){ sec.innerHTML=settingsHtml({noScope:true,noBasis:true})+'<p class="sv-note">Loading the crowd board…</p>'; loadCrowd().then(function(){ if(FX.view==='dyn') renderFx(); }); return; }
  var ranked=rows.map(function(r){ var c=crowd[String(r.p.id)]; return {r:r,c:c}; }).filter(function(x){ return x.c||x.r.rank<=250; });
  var mode=FX.dynMode||'all';
  var list=ranked.filter(function(x){
    if(mode==='all') return true;
    if(!x.c) return mode==='model';
    var gap=x.c.rank-x.r.rank, big=Math.abs(gap)>=Math.max(15,0.35*Math.min(x.c.rank,x.r.rank));
    return big&&(mode==='model'?gap>0:gap<0);
  });
  if(mode==='crowd') list.sort(function(a,b){ return a.c.rank-b.c.rank; });
  var extra='<div class="sv-f"><label>'+xk('Show','fx_dyn_gap')+'</label><span class="sv-seg" id="fxDynMode">'
    +[['all','Everyone'],['model','Model likes more'],['crowd','Crowd likes more']].map(function(m){ return '<button type="button" data-v="'+m[0]+'"'+(mode===m[0]?' class="on"':'')+'>'+m[1]+'</button>'; }).join('')+'</span></div>';
  var h=settingsHtml({noScope:true,noBasis:true,extra:extra})+'<div class="sv-expl"></div>';
  h+='<p class="sv-note">The model values the next three seasons of projected production (age curves included). The crowd is the WCE Dynasty board, priced by thousands of head-to-head picks. Where they disagree by a lot, one of them knows something: that is where trades are.</p>';
  h+='<div class="sv-tw"><table class="sv-t"><tr><th class="xk" data-k="fx_dyn_model">Model</th><th class="l">Player</th><th class="xk" data-k="pj_age">Age</th>'
    +'<th class="xk" data-k="pj_y3">'+esc((P.data.list[0]&&P.data.list[0].y3&&P.data.list[0].y3[0].season)||'Yr 1')+'</th><th class="xk" data-k="pj_y3">+1</th><th class="xk" data-k="pj_y3">+2</th>'
    +'<th class="xk" data-k="fx_dyn_model">Model value</th><th class="xk" data-k="fx_dyn_crowd">Crowd</th><th class="xk" data-k="fx_dyn_crowd">Crowd value</th><th class="xk" data-k="fx_dyn_gap">Gap</th>'+(FX.league?'<th class="l xk" data-k="fx_owner">Owner</th>':'')+'</tr>';
  var w=weights();
  h+=list.slice(0,200).map(function(x){
    var p=x.r.p, y=p.y3||[], v=function(i){ if(!y[i]) return '—'; return FX.fmt==='points'?f1(fpPerGame(p,y[i].pg,w)):f1(y[i].pg.pts)+' pts'; };
    var gap=x.c?x.c.rank-x.r.rank:null, big=gap!=null&&Math.abs(gap)>=Math.max(15,0.35*Math.min(x.c.rank,x.r.rank));
    return '<tr><td>'+x.r.rank+'</td><td class="l">'+nameCell(p)+'</td><td>'+(p.age!=null?f1(p.age):'—')+'</td><td>'+v(0)+'</td><td>'+v(1)+'</td><td>'+v(2)+'</td>'
      +'<td class="big">'+(FX.fmt==='points'?f0(x.r.vor):f2(x.r.vor))+'</td><td>'+(x.c?x.c.rank:'—')+'</td><td>'+(x.c?f0(x.c.value):'—')+'</td>'
      +'<td><span class="sv-gap '+(big?(gap>0?'sv-good':'sv-bad'):'')+'">'+(gap==null?'—':(gap>0?'Model +'+gap:gap<0?'Crowd +'+(-gap):'even'))+'</span></td>'+ownerCell(p.id)+'</tr>';
  }).join('')+'</table></div>';
  sec.innerHTML=h; wireSettings(sec,renderFx); wirePlayers(sec);
  $('fxDynMode').onclick=function(e){ var b=e.target.closest('button'); if(!b) return; FX.dynMode=b.dataset.v; renderFx(); };
}

/* ---- player picker (search box with results) */
function picker(id,ph,onPick,pool){
  setTimeout(function(){
    var inp=$(id), res=$(id+'R'); if(!inp) return;
    inp.oninput=function(){
      var q=inp.value.trim().toLowerCase(); if(q.length<2){ res.hidden=true; return; }
      var hits=(pool||P.data.list).filter(function(p){ return p.name.toLowerCase().indexOf(q)>=0; }).slice(0,10);
      res.innerHTML=hits.map(function(p){ return '<div data-id="'+p.id+'">'+esc(p.name)+' <span class="tm">'+esc(p.team)+' · '+esc(p.pos)+'</span></div>'; }).join('');
      res.hidden=!hits.length;
    };
    res.onclick=function(e){ var d=e.target.closest('[data-id]'); if(!d) return; res.hidden=true; inp.value=''; onPick(+d.dataset.id); };
  },0);
  return '<div class="sv-pick"><input id="'+id+'" class="sv-in" style="width:100%" placeholder="'+esc(ph)+'" autocomplete="off"><div class="sv-res" id="'+id+'R" hidden></div></div>';
}

/* ---- Trade evaluator */
function tradeSide(ids,ros,dyn,nx){
  var t={ros:0,dyn:0,crowd:0,nx:0,rows:[]}, crowd=P.crowd||{};
  ids.forEach(function(id){ var a=ros[id], b=dyn[id], c=crowd[String(id)], n=nx[id]; if(!a) return;
    t.ros+=a.vor; t.dyn+=b?b.vor:0; t.crowd+=c?c.value:0; t.nx+=n?n.L.fp:0; t.rows.push({p:a.p,a:a,b:b,c:c,n:n}); });
  return t;
}
function viewTrade(sec){
  if(!P.crowd){ loadCrowd().then(function(){ if(FX.view==='trade') renderFx(); }); }
  var ros=byId(valued('ros','total',FX.fmt)), dyn=byId(valued('dyn','total',FX.fmt)), nx=byId(valued('next7','total','points'));
  var A=tradeSide(FX.trade.a,ros,dyn,nx), B=tradeSide(FX.trade.b,ros,dyn,nx), pts=FX.fmt==='points';
  var u=pts?' FP':' z', d=pts?0:2;
  var h=settingsHtml({noScope:true,noBasis:true})+'<div class="sv-expl"></div>';
  h+='<p class="sv-note">Add what each side gets. Everything is judged on value over replacement, so a 2-for-1 pays for the roster spot it costs. '+xk('How the trade math works','fx_trade')+'.</p>';
  var side=function(key,title,T){
    return '<div class="sv-card"><h3>'+title+'</h3>'+picker('fxTr'+key,'Add a player…',function(id){ if(FX.trade[key].indexOf(id)<0) FX.trade[key].push(id); renderFx(); })
      +'<div style="margin-top:8px">'+T.rows.map(function(r){ return '<span class="sv-chip">'+esc(r.p.name)+' <span class="tm">'+esc(r.p.team)+'</span><button type="button" data-rm="'+key+':'+r.p.id+'" aria-label="Remove">×</button></span>'; }).join('')+'</div>'
      +(T.rows.length?'<table class="sv-t" style="margin-top:8px"><tr><th class="l">Player</th><th class="xk" data-k="fx_vor">ROS</th><th class="xk" data-k="fx_dyn_model">Dynasty</th><th class="xk" data-k="fx_dyn_crowd">Crowd</th><th class="xk" data-k="fx_fp">Next 7</th></tr>'
        +T.rows.map(function(r){ return '<tr><td class="l">'+nameCell(r.p)+'</td><td>'+sg(r.a.vor,d)+'</td><td>'+(r.b?sg(r.b.vor,d):'—')+'</td><td>'+(r.c?f0(r.c.value):'—')+'</td><td>'+(r.n?f1(r.n.L.fp):'—')+'</td></tr>'; }).join('')
        +'<tr><td class="l"><b>Total</b></td><td class="big">'+sg(T.ros,d)+'</td><td class="big">'+sg(T.dyn,d)+'</td><td class="big">'+f0(T.crowd)+'</td><td class="big">'+f1(T.nx)+'</td></tr></table>':'')
      +'</div>';
  };
  h+='<div class="sv-grid2">'+side('a','Side A gets',A)+side('b','Side B gets',B)+'</div>';
  if(A.rows.length&&B.rows.length){
    var verdict=function(lab,k,a,b,unit,dd){ var diff=a-b, base=Math.max(Math.abs(a),Math.abs(b),1e-9);
      var who=Math.abs(diff)/base<0.05?'about even':(diff>0?'Side A':'Side B')+' by '+Math.abs(diff).toFixed(dd)+unit;
      return '<div class="sv-kpi"><div class="k">'+xk(lab,k)+'</div><div class="v">'+who+'</div></div>'; };
    h+='<div class="sv-kpis">'+verdict('Rest of season','fx_vor',A.ros,B.ros,u,d)+verdict('Dynasty · our model','fx_dyn_model',A.dyn,B.dyn,u,d)
      +verdict('Dynasty · the crowd','fx_dyn_crowd',A.crowd,B.crowd,' pts',0)+verdict('Next 7 days','fx_fp',A.nx,B.nx,' FP',1)+'</div>';
    var mA=A.dyn-B.dyn, cA=A.crowd-B.crowd;
    if(mA*cA<0&&Math.abs(cA)>300) h+='<p class="sv-note"><b>The model and the crowd disagree on this one.</b> Our three-season projection favors '+(mA>0?'Side A':'Side B')+'; the crowd board favors '+(cA>0?'Side A':'Side B')+'. Age, role changes and injuries are the usual reasons. '+xk('Why they can differ','fx_dyn_gap')+'.</p>';
  }
  h+='<p style="margin-top:10px"><button type="button" class="sv-btn ghost" id="fxTrClear">Clear trade</button></p>';
  sec.innerHTML=h; wireSettings(sec,renderFx); wirePlayers(sec);
  sec.querySelectorAll('[data-rm]').forEach(function(b){ b.onclick=function(){ var x=b.dataset.rm.split(':'); FX.trade[x[0]]=FX.trade[x[0]].filter(function(i){ return i!==+x[1]; }); renderFx(); }; });
  $('fxTrClear').onclick=function(){ FX.trade={a:[],b:[]}; renderFx(); };
}

/* ---- Streamers: who to pick up for the next 7 days / this week */
function viewStream(sec){
  var win=FX.streamWin, rows=valued(win,'total',FX.fmt), ros=byId(valued('ros','total',FX.fmt)), N=FX.teams*FX.roster;
  var list=rows.filter(function(r){
    if(FX.league) return !ownerOf(r.p.id);
    var rr=ros[r.p.id]; return rr&&rr.rank>N*0.75;          // without a league: players unlikely to be rostered
  }).filter(function(r){ return r.L.G>0.5; });
  var extra='<div class="sv-f"><label>'+xk('Window','fx_window')+'</label><span class="sv-seg" id="fxSW">'+[['next7','Next 7 days'],['week','This week']].map(function(w){ return '<button type="button" data-v="'+w[0]+'"'+(win===w[0]?' class="on"':'')+'>'+w[1]+'</button>'; }).join('')+'</span></div>';
  var h=settingsHtml({noScope:true,noBasis:true,extra:extra})+'<div class="sv-expl"></div>';
  h+='<p class="sv-note">'+(FX.league?'Free agents in '+esc(FX.league.name)+', ':'Players ranked outside the top '+Math.round(N*0.75)+' for the rest of the season (likely available), ')
    +'ranked by what they should score '+(win==='week'?'in the rest of this week':'in the next 7 days')+': per-game projection × games on the schedule × availability. '+xk('How streaming value works','fx_stream')+'.</p>';
  h+='<div class="sv-tw"><table class="sv-t"><tr><th class="xk" data-k="fx_rank">#</th><th class="l">Player</th><th class="l xk" data-k="fx_sched">Games</th><th class="xk" data-k="fx_games">Exp. G</th>'
    +(FX.fmt==='points'?'<th class="xk" data-k="fx_fpg">FP/G</th><th class="xk" data-k="fx_fp">Window FP</th>':'<th class="xk" data-k="fx_z">Window value</th>')
    +'<th class="xk" data-k="fx_rank">ROS rank</th></tr>';
  h+=list.slice(0,60).map(function(r,i){
    var p=r.p, gs=teamGames(p,win), b2b=gs.map(function(g,j){ return j>0&&gs[j-1][0]===addDays(g[0],-1); });
    var games=gs.map(function(g,j){ return '<span'+(b2b[j]?' class="sv-b2b" title="Second night of a back-to-back"':'')+'>'+DOW[dow(g[0])]+(g[2]?' v ':' @ ')+esc(g[1])+'</span>'; }).join(', ');
    var rr=ros[p.id];
    return '<tr><td>'+(i+1)+'</td><td class="l">'+nameCell(p)+'</td><td class="l sv-games">'+games+'</td><td>'+f1(r.L.G)+'</td>'
      +(FX.fmt==='points'?'<td>'+f1(r.L.fp/Math.max(r.L.G,1e-9))+'</td><td class="big">'+f1(r.L.fp)+'</td>':'<td class="big">'+f2(r.v)+'</td>')
      +'<td>'+(rr?rr.rank:'—')+'</td></tr>';
  }).join('')+'</table></div>';
  sec.innerHTML=h; wireSettings(sec,renderFx); wirePlayers(sec);
  $('fxSW').onclick=function(e){ var b=e.target.closest('button'); if(!b) return; FX.streamWin=b.dataset.v; save(); renderFx(); };
}

/* ---- Lock-In (Sleeper): when to lock a game, by backward induction.
   One game per player counts each week; unlocked, his last game counts (zero if he sits it).
   Value of waiting before game i:  V_i = q_i·E[max(X, V_{i+1})] + (1−q_i)·V_{i+1},  V_last = q_last·E[X].
   Lock game i if its score ≥ V_{i+1}. With a matchup, the same recursion runs on the chance
   of winning, P(win | this slot scores y) = Φ((others − opponent + y) / σ). */
function lockDist(p){
  var line=p.ros, xs=fpGames(p,line);
  if(xs&&xs.length) return {xs:xs, emp:true};
  var m=fpPerGame(p,line), sd=Math.max(1,0.38*m), out=[];        // no usable log: a normal at his projection
  for(var i=0;i<40;i++) out.push(Math.max(0,m+sd*ninv((i+0.5)/40)));
  return {xs:out, emp:false};
}
function lockPlan(p,margin,sigma){
  var b=weekBounds(), all=((P.data.sched||{})[p.team]||[]).filter(function(g){ return g[0]>=b[0]&&g[0]<=b[1]; });
  var t=todayET(), future=all.filter(function(g){ return g[0]>=t; }), dist=lockDist(p), xs=dist.xs, n=xs.length;
  var mean=xs.reduce(function(a,x){ return a+x; },0)/n;
  var q=playProbs(p,future), k=future.length;
  var V=new Array(k+1), U=new Array(k+1), th=[], thW=[], useW=margin!=null&&sigma>0;
  var win=function(y){ return ncdf((margin+y)/sigma); };
  if(k){
    V[k-1]=q[k-1]*mean;
    if(useW){ var s=0; xs.forEach(function(x){ s+=win(x); }); U[k-1]=q[k-1]*s/n+(1-q[k-1])*win(0); }
    for(var i=k-2;i>=0;i--){
      var e=0, eu=0; xs.forEach(function(x){ e+=Math.max(x,V[i+1]); if(useW) eu+=Math.max(win(x),U[i+1]); });
      V[i]=q[i]*e/n+(1-q[i])*V[i+1];
      if(useW) U[i]=q[i]*eu/n+(1-q[i])*U[i+1];
    }
    for(var j=0;j<k;j++){ th.push(j<k-1?V[j+1]:null); thW.push(useW&&j<k-1?Math.max(0,sigma*ninv(Math.min(0.9999,Math.max(0.0001,U[j+1])))-margin):null); }
  }
  var last=k?q[k-1]*mean:0;
  return {all:all, future:future, q:q, th:th, thW:thW, ev:k?V[0]:0, evLast:last, mean:mean, emp:dist.emp, win:useW&&k?U[0]:null,
    sd:Math.sqrt(xs.reduce(function(a,x){ return a+(x-mean)*(x-mean); },0)/n)};
}
function viewLock(sec){
  var ids=FX.lock.ids.filter(function(id){ return P.data.players[id]; });
  if(!ids.length&&FX.league&&FX.league.mine) ids=FX.league.mine.starters.slice();
  var b=weekBounds();
  var h=settingsHtml({noFmt:true,noScope:true,noBasis:true})+'<div class="sv-expl"></div>';
  h+='<p class="sv-note">Sleeper Lock-In: each player’s one game counts for the week. Lock a game when its score beats the value of waiting; if you never lock, his last game counts, even a zero. Week of '+shortDate(b[0])+' – '+shortDate(b[1])+'. '+xk('The math','fx_lock')+'.</p>';
  var M=FX.lock.mine, O=FX.lock.opp, S=FX.lock.sd;
  var auto=null;
  if(FX.league&&FX.league.mine&&FX.league.opp){
    var sum=function(team){ var m=0,v=0; team.starters.forEach(function(id){ var p=P.data.players[id]; if(!p) return; var pl=lockPlan(p,null,null); m+=pl.ev; v+=Math.pow(pl.sd*0.75,2); }); return {m:m,v:v}; };
    var me=sum(FX.league.mine), op=sum(FX.league.opp); auto={me:me.m, op:op.m, sd:Math.sqrt(me.v+op.v)};
  }
  h+='<div class="sv-ctl"><div class="sv-f" style="min-width:240px;flex:1"><label>Add a player</label>'+picker('fxLk','Search…',function(id){ if(FX.lock.ids.indexOf(id)<0) FX.lock.ids.push(id); save(); renderFx(); })+'</div>'
    +'<div class="sv-f"><label>'+xk('Your other slots','fx_lock_matchup')+'</label><input type="number" id="fxLkM" placeholder="'+(auto?f0(auto.me):'projected FP')+'" value="'+(M!=null?M:'')+'"></div>'
    +'<div class="sv-f"><label>'+xk('Opponent total','fx_lock_matchup')+'</label><input type="number" id="fxLkO" placeholder="'+(auto?f0(auto.op):'projected FP')+'" value="'+(O!=null?O:'')+'"></div>'
    +'<div class="sv-f"><label>'+xk('Uncertainty (SD)','fx_lock_matchup')+'</label><input type="number" id="fxLkS" placeholder="'+(auto?f0(auto.sd):'e.g. 60')+'" value="'+(S!=null?S:'')+'"></div></div>';
  if(auto) h+='<p class="sv-note">Matchup read from '+esc(FX.league.name)+': you vs '+esc(FX.league.opp.name)+' (projected '+f0(auto.me)+' vs '+f0(auto.op)+' across all starters). Type over the boxes with your live totals as the week goes.</p>';
  var cards=ids.map(function(id){
    var p=P.data.players[id]; if(!p) return '';
    var mine=(M!=null?+M:(auto?auto.me:null)), opp=(O!=null?+O:(auto?auto.op:null)), sd=(S!=null?+S:(auto?auto.sd:null));
    var pl0=lockPlan(p,null,null);
    var margin=(mine!=null&&opp!=null)?(mine-(auto&&M==null?pl0.ev:0))-opp:null;      // others = your total without this slot
    var pl=lockPlan(p,margin,sd||null);
    var sc=FX.lock.scores[id];
    var rows=pl.all.map(function(g){
      var past=g[0]<todayET(), j=pl.future.indexOf(g);
      var lab=DOW[dow(g[0])]+' '+(g[2]?'v ':'@ ')+esc(g[1]);
      if(past) return '<tr><td class="l">'+lab+'</td><td colspan="3" class="l sv-games">played</td></tr>';
      var t=pl.th[j], tw=pl.thW[j];
      return '<tr><td class="l">'+lab+'</td><td>'+(j===0&&p.status?'<span class="sv-st">'+esc(p.status)+'</span> ':'')+Math.round(pl.q[j]*100)+'%</td>'
        +'<td class="big">'+(t==null?'counts if unlocked':'lock ≥ '+f1(t))+'</td><td>'+(tw==null?(t==null?'':'—'):'lock ≥ '+f1(tw))+'</td></tr>';
    }).join('');
    var now='';
    if(sc!=null&&sc!==''){
      // the game he just played is today's (or earlier); waiting is worth V of the games after today
      var later=pl.future.filter(function(g){ return g[0]>todayET(); }).length, nextV=later?(later===pl.future.length?pl.ev:pl.th[pl.future.length-later-1]):null;
      now=nextV==null?'<div class="sv-verdict">That was his last game this week: it counts either way.</div>'
        :'<div class="sv-verdict '+(+sc>=nextV?'sv-good':'sv-bad')+'">'+(+sc>=nextV?'Lock it: '+f1(+sc)+' beats the '+f1(nextV)+' you can expect by waiting.':'Wait: '+f1(+sc)+' is below the '+f1(nextV)+' you can expect from his remaining games.')+'</div>'; }
    return '<div class="sv-card"><h3>'+nameCell(p)+' <button type="button" class="sv-btn ghost" style="float:right;padding:3px 8px" data-lrm="'+id+'">×</button></h3>'
      +'<div class="sv-games">'+(pl.emp?'Game-to-game spread from his last '+(p.log||[]).length+' games, rescaled to his projection.':'Not enough NBA games for his own spread; using a normal curve at his projection.')+' Avg '+f1(pl.mean)+' FP, SD '+f1(pl.sd)+'.</div>'
      +(pl.all.length?'<table class="sv-t" style="margin-top:6px"><tr><th class="l">Game</th><th class="xk" data-k="fx_play">Plays</th><th class="xk" data-k="fx_lock">Max points</th><th class="xk" data-k="fx_lock_matchup">Max win %</th></tr>'+rows+'</table>':'<p class="sv-note">No games this week.</p>')
      +'<div class="sv-kpis"><div class="sv-kpi"><div class="k">'+xk('Expected, smart locking','fx_lock')+'</div><div class="v">'+f1(pl.ev)+'</div></div>'
      +'<div class="sv-kpi"><div class="k">'+xk('Expected, never locking','fx_lock')+'</div><div class="v">'+f1(pl.evLast)+'</div></div>'
      +(pl.win!=null?'<div class="sv-kpi"><div class="k">'+xk('Win chance','fx_lock_matchup')+'</div><div class="v">'+Math.round(pl.win*100)+'%</div></div>':'')+'</div>'
      +'<div class="sv-f" style="max-width:260px"><label>He just scored (unlocked) →</label><input type="number" step="0.5" data-ls="'+id+'" value="'+(sc!=null?sc:'')+'" placeholder="fantasy points"></div>'+now+'</div>';
  }).join('');
  h+=ids.length?'<div class="sv-grid2">'+cards+'</div>':'<p class="sv-note">Add the players in your starting lineup, or connect your Sleeper league to load them.</p>';
  sec.innerHTML=h; wireSettings(sec,renderFx); wirePlayers(sec);
  var setN=function(id,key){ var el=$(id); el.onchange=function(){ FX.lock[key]=el.value===''?null:+el.value; renderFx(); }; };
  setN('fxLkM','mine'); setN('fxLkO','opp'); setN('fxLkS','sd');
  sec.querySelectorAll('[data-lrm]').forEach(function(bt){ bt.onclick=function(){ var id=+bt.dataset.lrm; FX.lock.ids=FX.lock.ids.filter(function(x){ return x!==id; });
    if(!FX.lock.ids.length&&FX.league&&FX.league.mine){ FX.lock.ids=FX.league.mine.starters.filter(function(x){ return x!==id; }); } save(); renderFx(); }; });
  sec.querySelectorAll('[data-ls]').forEach(function(el){ el.onchange=function(){ FX.lock.scores[+el.dataset.ls]=el.value===''?null:+el.value; renderFx(); }; });
}

/* ---- Injuries: who is out, and who gains when he sits (from the with/without game logs) */
function wwSeason(){
  if(typeof DATA==='undefined'||!DATA||!DATA.seasons) return null;
  for(var i=0;i<DATA.seasons.length;i++){ var ps=(DATA.data[DATA.seasons[i]]||{}).players||[];
    if(ps.some(function(p){ return p.ww&&p.ww.length; })) return DATA.seasons[i]; }
  return null;
}
function beneficiaries(id,team){
  var s=wwSeason(); if(!s) return [];
  var out=[], w=weights();
  ((DATA.data[s]||{}).players||[]).forEach(function(p){
    (p.ww||[]).forEach(function(r){
      if(String(r.id)!==String(id)) return;
      var cur=P.data.players[p.id]; if(!cur||cur.team!==team) return;           // still his teammate
      var fp=function(x){ return (x.min/36)*((w.pts||0)*x.pts+(w.reb||0)*x.reb+(w.ast||0)*x.ast); };
      out.push({p:cur, r:r, dfp:fp(r.wo)-fp(r.w), season:s});
    });
  });
  return out.sort(function(a,b){ return b.dfp-a.dfp; });
}
function viewInj(sec){
  var ros=byId(valued('ros','total',FX.fmt));
  var hurt=P.data.list.filter(function(p){ return p.status; }).sort(function(a,b){ var x=ros[a.id], y=ros[b.id]; return (y?y.v:-1e9)-(x?x.v:-1e9); });
  var h=settingsHtml({noScope:true,noBasis:true,noFmt:true})+'<div class="sv-expl"></div>';
  h+='<p class="sv-note">Every player with an injury designation on Sleeper’s feed, best first. Under each: the teammates whose numbers moved most in the games he missed ('+esc(wwSeason()||'')+' game logs), with the change in minutes and per-36 production. '+xk('How beneficiaries are found','fx_inj')+'.</p>';
  h+=hurt.slice(0,60).map(function(p){
    var b=beneficiaries(p.id,p.team), r=ros[p.id];
    return '<div class="sv-card" style="margin-bottom:10px"><h3>'+nameCell(p)+' <span class="sv-games">ROS rank '+(r?r.rank:'—')+' · '+xk('plays next game','fx_play')+' '+Math.round((p.play!=null?p.play:1)*100)+'%</span></h3>'
      +(b.length?'<table class="sv-t"><tr><th class="l">When he sits</th><th class="xk" data-k="ww">G without</th><th class="xk" data-k="ww">MIN</th><th class="xk" data-k="ww">Usage /36</th><th class="xk" data-k="ww">PTS /36</th><th class="xk" data-k="ww">REB /36</th><th class="xk" data-k="ww">AST /36</th><th class="xk" data-k="fx_inj">≈ FP/G</th>'+(FX.league?'<th class="l xk" data-k="fx_owner">Owner</th>':'')+'</tr>'
        +b.map(function(x){ var w=x.r.w, o=x.r.wo, ch=function(a,c){ return f1(c)+' <span class="sv-games">('+sg(c-a)+')</span>'; };
          return '<tr><td class="l">'+nameCell(x.p)+'</td><td>'+x.r.gwo+'</td><td>'+ch(w.min,o.min)+'</td><td>'+ch(w.usg,o.usg)+'</td><td>'+ch(w.pts,o.pts)+'</td><td>'+ch(w.reb,o.reb)+'</td><td>'+ch(w.ast,o.ast)+'</td><td class="big">'+sg(x.dfp)+'</td>'+ownerCell(x.p.id)+'</tr>'; }).join('')+'</table>'
        :'<p class="sv-note">No teammate showed a clear change in the games he missed (or he missed too few).</p>')+'</div>';
  }).join('');
  sec.innerHTML=h; wireSettings(sec,renderFx); wirePlayers(sec);
}

/* ---- My Sleeper league */
function viewLeague(sec){
  var saved=lsGet('sv-sleeper')||{};
  var h='<div class="sv-expl"></div><div class="sv-ctl"><div class="sv-f"><label>'+xk('Sleeper username','fx_sleeper')+'</label><input id="fxSu" class="sv-in" value="'+esc(saved.user||'')+'" placeholder="your Sleeper username"></div>'
    +'<button type="button" class="sv-btn" id="fxSgo">Find my leagues</button><div class="sv-f" id="fxSl"></div></div><div id="fxSmsg" class="sv-note"></div>';
  var L=FX.league;
  if(L){
    var ros=byId(valued('ros','total','points')), wk=byId(valued('week','total','points'));
    h+='<div class="sv-kpis"><div class="sv-kpi"><div class="k">League</div><div class="v" style="font-size:16px">'+esc(L.name)+'</div></div>'
      +'<div class="sv-kpi"><div class="k">Type</div><div class="v" style="font-size:16px">'+(L.dynasty?'Dynasty':L.keeper?'Keeper':'Redraft')+' · '+L.size+' teams</div></div>'
      +'<div class="sv-kpi"><div class="k">'+xk('Scoring','fx_scoring')+'</div><div class="v" style="font-size:13px;font-family:var(--mono)">'+Object.keys(L.w).map(function(k){ return esc(k)+' '+L.w[k]; }).join(' · ')+'</div></div></div>';
    // power: each team's best lineup (starting slots) by rest-of-season FP per game
    var power=L.teams.map(function(t){
      var vals=t.ids.map(function(id){ var r=ros[id]; return r?r.L.fp/Math.max(r.L.G,1e-9):0; }).sort(function(a,b){ return b-a; });
      var top=vals.slice(0,L.slots).reduce(function(a,b){ return a+b; },0);
      var week=t.starters.reduce(function(a,id){ var r=wk[id]; return a+(r?r.L.fp:0); },0);
      return {t:t, top:top, week:week};
    }).sort(function(a,b){ return b.top-a.top; });
    h+='<div class="sv-sec"><h3 style="margin:14px 0 6px">'+xk('Power rankings','fx_power')+'</h3><div class="sv-expl"></div><div class="sv-tw"><table class="sv-t"><tr><th>#</th><th class="l">Team</th><th class="xk" data-k="fx_power">Best lineup FP/G</th><th class="xk" data-k="fx_fp">Starters, rest of week</th><th>Unmatched</th></tr>'
      +power.map(function(x,i){ return '<tr'+(L.mine&&x.t.rid===L.mine.rid?' style="font-weight:700"':'')+'><td>'+(i+1)+'</td><td class="l">'+esc(x.t.name)+'</td><td class="big">'+f1(x.top)+'</td><td>'+f0(x.week)+'</td><td>'+(x.t.unmatched||'')+'</td></tr>'; }).join('')+'</table></div></div>';
    if(L.mine){
      var mine=L.mine.ids.map(function(id){ return {p:P.data.players[id], r:ros[id], w:wk[id], st:L.mine.starters.indexOf(id)>=0}; }).filter(function(x){ return x.p; })
        .sort(function(a,b){ return (b.r?b.r.v:0)-(a.r?a.r.v:0); });
      h+='<div class="sv-sec"><h3 style="margin:14px 0 6px">Your roster'+(L.opp?' · this week vs '+esc(L.opp.name):'')+'</h3><div class="sv-expl"></div><div class="sv-tw"><table class="sv-t"><tr><th class="l">Player</th><th class="xk" data-k="fx_rank">ROS rank</th><th class="xk" data-k="fx_fpg">FP/G</th><th class="xk" data-k="fx_games">G this week</th><th class="xk" data-k="fx_fp">FP this week</th><th class="l">Lineup</th></tr>'
        +mine.map(function(x){ return '<tr><td class="l">'+nameCell(x.p)+'</td><td>'+(x.r?x.r.rank:'—')+'</td><td>'+(x.r?f1(x.r.L.fp/Math.max(x.r.L.G,1e-9)):'—')+'</td><td>'+(x.w?f1(x.w.L.G):'0')+'</td><td class="big">'+(x.w?f1(x.w.L.fp):'0')+'</td><td class="l sv-games">'+(x.st?'starter':'bench')+'</td></tr>'; }).join('')+'</table></div></div>';
      h+='<p style="margin-top:10px"><button type="button" class="sv-btn ghost" data-go="lock">Lock-In planner for this lineup →</button> <button type="button" class="sv-btn ghost" data-go="stream">Best free agents →</button></p>';
    } else h+='<p class="sv-note">You don’t own a team in this league, so the roster views are off.</p>';
  }
  sec.innerHTML=h; wirePlayers(sec);
  sec.querySelectorAll('[data-go]').forEach(function(b){ b.onclick=function(){ FX.view=b.dataset.go; if(b.dataset.go==='lock') FX.lock.ids=[]; renderFx(); }; });
  var msg=$('fxSmsg');
  $('fxSgo').onclick=function(){
    var u=$('fxSu').value.trim(); if(!u) return; msg.textContent='Looking up '+u+'…';
    sleeperFindLeagues(u).then(function(r){
      lsSet('sv-sleeper',{user:u,league:saved.league});
      if(!r.leagues.length){ msg.textContent='No '+r.season+' NBA leagues on Sleeper for '+u+'.'; return; }
      $('fxSl').innerHTML='<label>League</label><select id="fxSlSel">'+r.leagues.map(function(l){ return '<option value="'+esc(l.league_id)+'"'+(saved.league===l.league_id?' selected':'')+'>'+esc(l.name)+'</option>'; }).join('')+'</select>';
      msg.innerHTML='Pick a league, then <button type="button" class="sv-btn" id="fxSload">Load it</button>';
      $('fxSload').onclick=function(){ var id=$('fxSlSel').value; msg.textContent='Loading the league…';
        sleeperLoadLeague(r.user,r.state,id).then(function(L){ FX.league=L; FX.preset='league'; FX.teams=L.size||FX.teams; FX.roster=L.rosterSize||FX.roster; FX.lock.ids=[];
          lsSet('sv-sleeper',{user:u,league:id}); _cache={}; save(); renderFx(); }).catch(function(e){ msg.textContent='Couldn’t load that league ('+e.message+').'; }); };
    }).catch(function(e){ msg.textContent=e.message; });
  };
}

/* ------------------------------------------------------------------ the player card panel */
function cardHook(row){
  var host=$('wwp'); if(!host) return;
  var el=$('projp');
  if(!el){ el=D.createElement('div'); el.className='col projp'; el.id='projp'; el.hidden=true; host.parentNode.insertBefore(el,host); }
  var go=function(){
    var p=row&&P.data&&P.data.players[row.id];
    if(!p){ el.hidden=true; el.innerHTML=''; return; }
    var w=weights(), rk=byId(valued('ros','total','points'))[p.id];
    var tr=function(lab,ln,g,k){ return '<tr><td>'+xk(lab,k)+'</td><td>'+(g==null?'—':f0(g))+'</td><td>'+f1(ln.min)+'</td><td>'+f1(ln.pts)+'</td><td>'+f1(ln.reb)+'</td><td>'+f1(ln.ast)+'</td><td>'+f1(ln.stl)+'</td><td>'+f1(ln.blk)+'</td><td>'+f1(ln.fg3m)+'</td><td>'+f1(ln.tov)+'</td>'
      +'<td>'+(ln.fga?pc(ln.fgm/ln.fga):'—')+'</td><td>'+(ln.fta?pc(ln.ftm/ln.fta):'—')+'</td><td><b>'+f1(fpPerGame(p,ln,w))+'</b></td></tr>'; };
    var n7=teamGames(p,'next7');
    var h='<h2 class="col-h panel-h" data-k="pj_method" title="Click for what this is and how it’s calculated">'+esc(P.data.season)+' projection</h2>'
      +'<div class="guard-cap">Per game. Our model, not this season’s stats'+(p.gp?' (blended with his '+p.gp+' games so far)':'')+'. Fantasy points use '+esc(FX.preset==='league'&&FX.league?FX.league.name:(PRESETS[FX.preset]||{label:'custom'}).label)+' scoring.'
      +(rk?' Rest-of-season points rank: <b>#'+rk.rank+'</b>.':'')+(p.status?' <span class="sv-st">'+esc(p.status)+'</span>':'')+'</div>'
      +'<div class="sv-expl"></div><table><tr><th></th><th class="xk" data-k="fx_games">G</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TO</th><th>FG%</th><th>FT%</th><th class="xk" data-k="fx_fpg">FP</th></tr>'
      +tr('Rest of season',p.ros,expGames(p,teamGames(p,'ros')),'pj_ros')
      +tr('Next 7 days',p.ros,expGames(p,n7),'pj_next7')
      +(p.y3||[]).map(function(s,i){ return tr(s.season+(i===0?' (full)':''),s.pg,i===0?82*Math.min(1,p.gp_rate||0.8):82*Math.min(1,p.gp_rate||0.8),'pj_y3'); }).join('')
      +'</table><div class="guard-cap" style="margin-top:6px">'+(n7.length?'Next 7: '+n7.map(function(g){ return DOW[dow(g[0])]+(g[2]?' v ':' @ ')+esc(g[1]); }).join(', ')+'. ':'')
      +'<a href="#fantasy" class="xgo" data-go-fx="1">Open Fantasy →</a></div>';
    el.innerHTML=h; el.hidden=false;
    var a=el.querySelector('[data-go-fx]'); if(a) a.onclick=function(e){ e.preventDefault(); go2fx(); };
  };
  if(P.data) go(); else loadProj().then(go);
}
function go2fx(){ go('fx'); }

/* ------------------------------------------------------------------ boot */
window.svRoute=route; window.svClear=svClear; window.svCardHook=cardHook; window.svGo=go;
window.svFantasy={prep:function(d,today){ prepProj(d); P.data=d; if(today) todayET=function(){ return today; }; _cache={}; }, valueAll:valueAll, load:loadProj, valued:valued, weights:weights, lockPlan:lockPlan, fpPerGame:fpPerGame, state:FX, P:P};
function boot(){
  shell(); syncTabs();
  // the main page switches views by body class (home-open, lb-open): keep the tab bar in step
  try{ new MutationObserver(syncTabs).observe(D.body,{attributes:true,attributeFilter:['class']}); }catch(e){}
}
if(D.readyState==='loading') D.addEventListener('DOMContentLoaded',boot); else boot();
})();
