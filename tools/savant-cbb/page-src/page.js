(function(){
'use strict';
var M=window.SavantCBB,C=M.COL,$=function(s){return document.querySelector(s);};
var API='/cbb/',cache={},REG,IDX,SEARCH,LINKS={},HON={},BYK={},TEAMS={};
var S={season:null,pool:'pos',adj:true,gt:false,per:70,lstat:'bi',lpos:'all',lmin:300,tsort:'net',tab5:'5',splitTab:'site',wwA:null,wwOn:[],wwOff:[],cmpA:null,cmpB:null,lastP:null,lastT:null,astTab:'1',astConf:null};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function ord(n){var s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
function sg(v,d){d=d==null?1:d;if(v==null||!isFinite(v))return '—';if(Math.abs(v)<0.5*Math.pow(10,-d))return (0).toFixed(d);return (v>=0?'+':'−')+Math.abs(v).toFixed(d);}
function num(v,d){return v==null||!isFinite(v)?'—':(+v).toFixed(d==null?1:d);}
function ini(n){return String(n||'').split(/[\s-]+/).map(function(w){return w.charAt(0);}).join('').toUpperCase().slice(0,3);}
function load(p){if(!cache[p])cache[p]=fetch(API+p).then(function(r){if(!r.ok)throw new Error(p+': '+r.status);return r.json();}).catch(function(e){delete cache[p];throw e;});return cache[p];}
function cssv(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
var SC={};function readScale(){SC={lo:cssv('--lo'),mid:cssv('--mid'),hi:cssv('--hi')};}
function hex(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function col(p){var a=hex(SC.lo),m=hex(SC.mid),b=hex(SC.hi),x,y,t;if(p<=50){x=a;y=m;t=p/50;}else{x=m;y=b;t=(p-50)/50;}return 'rgb('+x.map(function(c,i){return Math.round(c+(y[i]-c)*t);}).join(',')+')';}
function inkOn(c){var v=c.match(/\d+/g).map(Number),L=(0.2126*v[0]+0.7152*v[1]+0.0722*v[2])/255;return L>0.55?'#111214':'#FFFFFF';}
var CONF={1:'America East',2:'ACC',3:'A-10',4:'Big East',5:'Big Sky',6:'Big South',7:'Big Ten',8:'Big 12',9:'Big West',10:'CAA',11:'CUSA',12:'Ivy',13:'MAAC',14:'MAC',16:'MEAC',18:'MVC',19:'NEC',20:'OVC',21:'Pac-12',22:'Patriot',23:'SEC',24:'SoCon',25:'Southland',26:'SWAC',27:'Sun Belt',29:'WCC',30:'WAC',44:'Mountain West',45:'Horizon',46:'ASUN',49:'Summit',62:'American'};
function confName(id){return CONF[id]||'Independent';}
function tname(id){return (TEAMS[id]&&TEAMS[id].name)||'Non-D1';}
function teamLink(id){var t=TEAMS[id];if(!t)return '<span class="pos">Non-D1 opponent</span>';return '<a href="#team-'+id+'"><span class="sw" style="background:#'+esc(t.color||'8B9099')+'"></span>'+esc(t.name)+'</a>';}
function playerLink(id,name){return '<a href="#player-'+esc(id)+'">'+esc(name)+'</a>';}
function head(p){var id=p[C.id],n=p[C.name],t=TEAMS[p[C.team]]||{};if(p[C.head])return '<img class="hs" alt="" width="64" height="64" loading="lazy" src="https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+esc(id)+'.png" onerror="this.remove()">';return '<span class="hs ib" style="background:#'+esc(t.color||'22395A')+';color:#'+esc(t.alt&&t.alt!=='000000'&&t.alt!==t.color?'FFFFFF':'FFFFFF')+'" aria-hidden="true">'+esc(ini(n))+'</span>';}
function statOf(k){return BYK[k];}
function seasonSel(id,list,v){return '<label class="ctl" for="'+id+'">Season<select class="sel" id="'+id+'">'+list.map(function(s){return '<option value="'+s+'"'+(s===v?' selected':'')+'>'+s+'</option>';}).join('')+'</select></label>';}
function seg(attr,opts,v,label){return '<span class="seg" role="group" aria-label="'+esc(label)+'">'+opts.map(function(o){return '<button type="button" data-'+attr+'="'+o[0]+'" aria-pressed="'+(String(o[0])===String(v))+'">'+esc(o[1])+'</button>';}).join('')+'</span>';}
function legend(){return '<div class="legend"><span>Poor<i class="grad"></i>Elite</span><span><i class="lgk"></i>Before adjusting for opponents</span><span><i class="lgh"></i>Small sample</span><span><i class="lgdm"></i>Likely to settle</span></div>';}
function empty(msg){return '<p class="empty">'+esc(msg)+'</p>';}
function dateShort(d){var m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],p=String(d).split('-');var a=p.length===3?p.slice(1):p;return m[+a[0]-1]+' '+(+a[1]);}

/* ---------- bars: same as the prototype and Basketball Savant ---------- */
function bar(r,label,size,who){
  var a=r.pct,raw=(r.raw!=null&&r.raw!==a)?r.raw:null,lp=r.settling?r.likelyPct:null,c=col(a),s=statOf(r.key);
  var lab=(who?who+', ':'')+label+': '+ord(a)+' percentile'+(raw!=null?' after adjusting for opponents, '+ord(raw)+' before':'')+(lp!=null?'; small sample, likely to settle near the '+ord(lp):'');
  var h='<span class="bar'+(size?' '+size:'')+'" role="img" aria-label="'+esc(lab)+'"><i class="g" style="left:25%"></i><i class="g" style="left:50%"></i><i class="g" style="left:75%"></i><i class="f'+(r.settling?' h':'')+'" style="width:'+a+'%;background-color:'+c+'"></i>';
  if(raw!=null)h+='<i class="k" style="left:'+raw+'%"></i>';
  if(lp!=null)h+='<i class="d" style="left:'+lp+'%"></i>';
  if(a>=(size?80:84)){var e=a;[raw,lp].forEach(function(x){if(x!=null&&x<a&&a-x<9)e=Math.min(e,x);});h+='<i class="n" style="right:calc('+(100-e)+'% + 6px);color:'+(r.settling?'var(--text)':inkOn(c))+'">'+a+'</i>';}
  else{var o=a;[raw,lp].forEach(function(x){if(x!=null&&x>=a&&x-a<10)o=Math.max(o,x);});h+='<i class="n" style="left:calc('+o+'% + 7px)">'+a+'</i>';}
  return h+'</span>';
}
function prow(r){
  var s=statOf(r.key),l=esc(s.label);
  if(!r.tracked)return '<div class="pr off"><div class="pl">'+l+'</div><span class="bar none">'+esc(r.reason==='no value'?'no value this season':r.reason)+'</span><div class="pv">—</div></div>';
  if(r.low)return '<div class="pr off"><div class="pl">'+l+'</div><span class="bar none">low sample, '+esc(r.n==null?0:r.n)+' possessions in the pool</span><div class="pv">'+esc(r.shown)+'</div></div>';
  var sm=r.settling?'<small>Likely to settle at '+esc(r.likelyShown)+'</small>':(s.lower?'<small>Lower is better</small>':(r.key.indexOf('rapm')===0?'<small>Early</small>':''));
  return '<div class="pr'+(r.settling?' settle':'')+'"><div class="pl">'+l+sm+'</div>'+bar(r,s.label)+'<div class="pv">'+esc(r.shown)+'</div></div>';
}

/* ---------- home ---------- */
function vHome(){
  var si=IDX.seasons.filter(function(x){return x.season===S.season;})[0]||{};
  return Promise.all([load('s/'+S.season+'.json'),load('teams/'+S.season+'.json'),load('allsavant/'+S.season+'.json').catch(function(){return null;})]).then(function(a){
    var d=a[0],t=a[1],ast=a[2];
    var top=t.teams.slice(0,8);
    var ids=d.players.map(function(p,i){return i;}).filter(function(i){return d.players[i][C.qual];});
    function leaders(k){var c=M.column(d,k,{adj:true,gt:false}),s=statOf(k);return ids.filter(function(i){return M.ok(c[i])&&(k.indexOf('rapm')<0||(d.samples.rapm_n[i]||0)>=REG.rapm_min);}).sort(function(x,y){return s.lower?c[x]-c[y]:c[y]-c[x];}).slice(0,8).map(function(i){return [d.players[i],c[i]];});}
    var keyL=M.column(d,'rapm',{adj:true})&&leaders('rapm').length?'rapm':'bi',L=leaders(keyL),st=statOf(keyL);
    var h='<section class="trow"><div><h1>Men\'s Division I, '+esc(S.season)+'</h1><p class="sub">Every player and team, on the same percentile bars as Basketball Savant. Data through '+esc(dateShort(d.through))+'.</p></div><div class="actions">'+seasonSel('hseason',IDX.seasons.map(function(x){return x.season;}).reverse(),S.season)+'</div></section>';
    h+='<p class="finding"><strong>'+esc(top[0].name)+'</strong> leads our ratings at '+sg(top[0].net)+' per 100 possessions. <strong>'+esc(L[0][0][C.name])+'</strong> leads D1 in '+esc(st.label)+' at '+esc(M.display(st,L[0][1],S.per))+'.</p>';
    h+='<div class="cols even"><section class="card"><div class="hd"><h2>Top teams</h2><a class="meta" href="#teams">All 365</a></div><div class="twrap"><table class="tbl"><thead><tr><th>Team</th><th class="r">Net</th><th class="r hide-s">Off</th><th class="r hide-s">Def</th><th class="r">Record</th></tr></thead><tbody>'+
      top.map(function(r){return '<tr><td>'+teamLink(r.id)+'</td><td class="r">'+sg(r.net)+'</td><td class="r hide-s">'+num(r.adjo)+'</td><td class="r hide-s">'+num(r.adjd)+'</td><td class="r">'+r.w+'–'+r.l+'</td></tr>';}).join('')+'</tbody></table></div></section>';
    h+='<section class="card"><div class="hd"><h2>'+esc(st.label)+' leaders</h2><a class="meta" href="#leaders">All leaders</a></div>'+(st.key==='rapm'?'<p class="pool-n" style="margin-top:0">'+esc(REG.rapm_early)+'</p>':'')+'<div class="twrap"><table class="tbl"><thead><tr><th>Player</th><th>Team</th><th class="r">'+esc(st.label)+'</th></tr></thead><tbody>'+
      L.map(function(x){var p=x[0];return '<tr><td>'+playerLink(p[C.id],p[C.name])+'</td><td>'+teamLink(p[C.team])+'</td><td class="r">'+esc(M.display(st,x[1],S.per))+'</td></tr>';}).join('')+'</tbody></table></div></section></div>';
    if(!(si.court))h+='<p class="meta" style="margin-top:12px">On/off, lineups and RAPM are not tracked this season: clean lineup data starts in 2024-25.</p>';
    if(ast){var one=ast.national['1']||[];h+='<section class="ast" style="margin-top:24px"><div class="hd"><h2>All-Savant 1st team'+(ast.so_far?', so far':'')+'</h2><a class="meta" href="#all-savant">All teams</a></div>'+(IDX.landing_note&&S.season===IDX.default_season?'<p class="pool-n" style="margin-top:0">'+esc(IDX.landing_note)+'</p>':'')+'<div class="ast-row">'+one.map(function(x,i){return astCard(x,i,S.season);}).join('')+'</div></section>';}
    return {html:h,cur:'players'};
  });
}

/* ---------- player ---------- */
function statRows(d,i,o){var R={};REG.stats.forEach(function(s){R[s.key]=M.row(d,REG,s,i,o);});return R;}
var ZONES=[['rim','At the rim','n_rim','rim_fg',250,64],['pnt','In the paint','n_pnt','pnt_fg',250,176],['mid','Mid-range','n_mid','mid_fg',392,176],['c3','Corner three','n_c3','c3_fg',46,64],['ab3','Above the break','n_ab3','ab3_fg',250,336]];
function court(zs,season,label){
  var old=season<'2019-20',R=old?207.5:221,sv='<svg class="court" viewBox="0 0 500 470" role="img" aria-label="'+esc(label)+'"><rect class="cbg" x="0" y="0" width="500" height="470"/><g class="ln"><rect x="1" y="1" width="498" height="468"/><rect x="190" y="1" width="120" height="189"/><circle cx="250" cy="190" r="60"/><path d="M'+(250-R+5)+' 1 L'+(250-R+5)+' 98.7 A'+R+' '+R+' 0 0 0 '+(250+R-5)+' 98.7 L'+(250+R-5)+' 1"/><path d="M210 52 A40 40 0 0 0 290 52"/><line x1="220" y1="40" x2="280" y2="40"/><circle cx="250" cy="52" r="7.5"/><path d="M190 469 A60 60 0 0 1 310 469"/></g>';
  zs.forEach(function(z){if(z.pct==null)return;var c=col(z.pct),r=Math.sqrt(z.freq)*7+9;sv+='<circle class="zb" cx="'+z.x+'" cy="'+z.y+'" r="'+r.toFixed(1)+'" fill="'+c+'"/><text class="zt" x="'+z.x+'" y="'+(z.y+5)+'" text-anchor="middle" fill="'+inkOn(c)+'">'+z.pct+'</text>';});
  return sv+'</svg>';
}
function chartPts(rows,W){
  var sm=W<520,H=sm?190:230,l=30,rp=sm?50:66,tp=30,bp=26,n=rows.length,mx=Math.max.apply(null,rows.map(function(r){return r.pts;}).concat([9])),top=Math.max(10,Math.ceil((mx+1)/10)*10),ih=H-tp-bp,iw=W-l-rp,bw=iw/n;
  function y(v){return tp+ih-(v/top)*ih;}
  var avg=rows.reduce(function(a,r){return a+r.pts;},0)/n;
  var s='<svg class="gl" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Points in each of '+n+' games; average '+avg.toFixed(1)+'">';
  for(var v=10;v<=top;v+=10)s+='<line class="gr" x1="'+l+'" x2="'+(W-rp)+'" y1="'+y(v)+'" y2="'+y(v)+'"/>';
  for(v=0;v<=top;v+=10)s+='<text class="tk" x="'+(l-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>';
  rows.forEach(function(r,i){var x=l+i*bw+bw*0.18,w=bw*0.64,hh=(r.pts/top)*ih;s+='<rect class="b'+(i>=n-5?' now':'')+'" x="'+x.toFixed(1)+'" y="'+(tp+ih-hh).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+hh.toFixed(1)+'"><title>'+esc(r.date+': '+r.pts+' points vs '+r.opp)+'</title></rect>';});
  var ln=rows.map(function(r,i){var a=rows.slice(Math.max(0,i-4),i+1),m=a.reduce(function(x,q){return x+q.pts;},0)/a.length;return (l+i*bw+bw/2).toFixed(1)+','+y(m).toFixed(1);}).join(' ');
  if(n>=5)s+='<polyline class="roll" points="'+ln+'"/>';
  s+='<line class="base" x1="'+l+'" x2="'+(W-rp)+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
  var lm='';rows.forEach(function(r,i){var m=r.date.split(' ')[0];if(m!==lm){lm=m;s+='<text class="tk" x="'+(l+i*bw+bw*0.18).toFixed(1)+'" y="'+(H-6)+'">'+m+'</text>';}});
  var ya=y(avg);s+='<line class="ref" x1="'+l+'" x2="'+(W-rp)+'" y1="'+ya.toFixed(1)+'" y2="'+ya.toFixed(1)+'"/><text class="tk" x="'+(W-rp+6)+'" y="'+(ya+4).toFixed(1)+'">Avg '+avg.toFixed(1)+'</text>';
  var hi=rows.reduce(function(a,b){return b.pts>a.pts?b:a;}),hiI=rows.indexOf(hi),hx=l+hiI*bw+bw/2,anc=hiI>n*0.7?'end':hiI<n*0.3?'start':'middle';
  s+='<line class="lead" x1="'+hx.toFixed(1)+'" x2="'+hx.toFixed(1)+'" y1="17" y2="'+(y(hi.pts)-3).toFixed(1)+'"/><text class="ann" x="'+hx.toFixed(1)+'" y="12" text-anchor="'+anc+'">'+(sm?'High: '+hi.pts:'Season high: '+hi.pts+', '+hi.date)+'</text>';
  return s+'</svg>';
}
var pending=[];
function vPlayer(id,season){
  var shard=String(id).slice(-2);
  return load('p/'+shard+'.json').then(function(cs){
    var car=cs[id];if(!car)return {html:empty('No player with that id. Try the search above.'),cur:'players'};
    var rows=car.r,have=rows.map(function(r){return r.s;}),sn=season&&have.indexOf(season)>=0?season:(have.indexOf(S.season)>=0&&S.pseason?S.season:have[have.length-1]);
    var cr=rows.filter(function(r){return r.s===sn;})[0];
    return Promise.all([load('s/'+sn+'.json'),load('t/'+sn+'/'+cr.t+'.json')]).then(function(a){
      var d=a[0],T=a[1],i=d.players.findIndex(function(p){return p[C.id]===id;}),p=d.players[i];S.lastP=id;S.lastT=p[C.team];
      var o={poolName:S.pool,adj:S.adj,gt:S.gt,per:S.per},R=statRows(d,i,o),pl=R.pts.pool,label=M.poolLabel(pl,p,{adj:S.adj,season:sn,conf:confName(p[C.conf])});
      var skill=REG.stats.filter(function(s){return s.kind==='skill'&&R[s.key].tracked&&!R[s.key].low&&R[s.key].pct!=null&&!R[s.key].settling;}),top=skill.reduce(function(b,s){return !b||R[s.key].pct>R[b.key].pct?s:b;},null);
      var sos=R.sos,findA=top?'<strong>'+ord(R[top.key].pct)+' percentile in '+esc(/^[A-Z]{2}/.test(top.label)?top.label:top.label.toLowerCase())+'</strong> '+esc(label)+'.':'Not enough minutes for a pool yet.';
      var findB='';
      var ix=T.roster.findIndex(function(r){return r[0]===id;}),hist=rows.map(function(r,k){var moved=k>0&&r.t!==rows[k-1].t;return '<dt>'+esc(r.s)+'</dt><dd>'+teamLink(r.t)+(moved?'<span class="tag">Transferred</span>':'')+'</dd>';}).join('');
      var ribbon=rows.map(function(r,k){return (k&&r.t!==rows[k-1].t?'<span class="tr">→</span>':'')+'<a class="rb" href="#team-'+r.t+'"><span class="sw" style="background:#'+esc((TEAMS[r.t]||{}).color||'8B9099')+'"></span>'+esc(tname(r.t))+' <small>'+esc(r.s)+'</small></a>';}).join('');
      var ht=p[C.ht]?Math.floor(p[C.ht]/12)+'′'+(p[C.ht]%12)+'″':null;
      var sub=[tname(p[C.team]),confName(p[C.conf]),p[C.pos],p[C.cls],p[C.age]?p[C.age].toFixed(1)+' (age on Feb 1)':null,ht,p[C.wt]?p[C.wt]+' lb':null,p[C.home]].filter(Boolean).join(' · ');
      var h='<section class="trow"><div class="who-h">'+head(p)+'<div><h1>'+esc(p[C.name])+'</h1><p class="sub">'+esc(sub)+'</p></div></div><div class="actions"><a class="btn primary" href="#compare" data-cmp="'+esc(id)+'">Compare</a><a class="btn" href="#team-'+esc(p[C.team])+'">'+esc(tname(p[C.team]))+'</a></div></section>';
      var honNow=(HON[id]||[]).filter(function(x){return x[0]===sn;}),sc=M.schedule(d,i),cfc=M.confidence(d,i);
      h+='<div class="ribbon">'+ribbon+honNow.map(function(x){return '<span class="tag gold">'+esc(x[2])+'</span>';}).join('')+'</div><p class="finding">'+findA+findB+'</p>';
      h+='<p class="sched">'+(sc?'<span>'+esc(sc.text)+', '+esc(sn)+'.</span> ':'')+(cfc?'<span class="conf '+esc(cfc.label.toLowerCase())+'" title="How sure the opponent adjustment is: measured from how far schedule reads moved over four seasons">Adjustment confidence: '+esc(cfc.text)+'</span>':'')+'</p>';
      if(d.tier==='box')h+='<p class="pool-n">'+esc(sn)+' is a box-score season: shot zones, lineups, on/off and RAPM are not tracked, and garbage time can’t be taken out.</p>';
      var kp=[['value','Savant value'],['rapm','RAPM'],['bi','Box impact'],['pts','Points / '+S.per],['ts','True shooting'],['usg','Usage']];
      h+='<div class="kpis">'+kp.map(function(k,n){var r=R[k[0]];var v=r.tracked?r.shown:'—',s=r.tracked?(r.low?'low sample':r.pct!=null?ord(r.pct)+' percentile':''):esc(r.reason);return '<div class="kpi"><div class="k">'+esc(k[1])+'</div><div class="v'+(n===0?' lead':'')+'">'+esc(v)+'</div><div class="s">'+s+'</div></div>';}).join('')+'</div>';
      // percentile card
      var opts=[['pos','D1 at position'],['all','All D1'],['hm','High-major'],['conf','Same conference'],['age','Same age']];
      h+='<div class="cols"><section class="card"><div class="hd"><h2>Percentiles</h2><span class="meta">'+esc(label)+'</span></div>';
      h+='<div class="ctrls"><label class="ctl" for="pool">Compare against<select class="sel" id="pool">'+opts.map(function(x){return '<option value="'+x[0]+'"'+(x[0]===S.pool?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label>'+seasonSel('pseason',have.slice().reverse(),sn)+
        '<span class="ctl">'+seg('adj',[[1,'Adjusted'],[0,'Raw']],S.adj?1:0,'Opponent adjustment')+'</span><span class="ctl">'+seg('per',[[70,'Per 70'],[100,'Per 100']],S.per,'Rates per')+'</span>'+(d.tier==='box'?'':'<span class="ctl">'+seg('gt',[[0,'No garbage time'],[1,'All']],S.gt?1:0,'Garbage time')+'</span>')+'</div>';
      h+='<p class="pool-n">Pool: '+esc(label.replace(/^vs /,''))+', '+esc(pl.ids.length)+' qualified players (30% of team minutes).'+(pl.widened?' '+esc(pl.widened)+'.':'')+'</p>'+legend();
      REG.groups.forEach(function(g){
        var ss=REG.stats.filter(function(s){return s.group===g;});
        h+='<div class="grp"><h3>'+esc(g==='Context'?'Context':g)+(g==='Context'?'<small>CONTEXT: how much, not how good</small>':g==='Impact'?'<small>'+esc(REG.rapm_early)+'</small>':'')+'</h3>'+ss.map(function(s){return prow(R[s.key]);}).join('')+'</div>';
      });
      h+='</section><div class="stack">';
      var rec=car.b,recL=(cs[id].r.filter(function(x){return x.rec;})[0]||{}).rec;
      h+='<section class="card"><div class="hd"><h2>Profile</h2><span class="meta">Age on Feb 1</span></div><dl class="kv"><dt>Team</dt><dd>'+teamLink(p[C.team])+'</dd><dt>Conference</dt><dd>'+esc(confName(p[C.conf]))+'</dd><dt>Position</dt><dd>'+esc(p[C.pos]||'—')+'</dd><dt>Class</dt><dd>'+esc(p[C.cls]||'—')+'</dd><dt>Age</dt><dd class="num">'+(p[C.age]?p[C.age].toFixed(1):'—')+'</dd><dt>Hometown</dt><dd>'+esc(p[C.home]||'—')+'</dd><dt>Recruiting</dt><dd>'+(p[C.rrank]?esc((p[C.stars]?p[C.stars]+'-star, ':'')+'No. '+p[C.rrank]+' in class'):'Not ranked')+'</dd><dt>Games</dt><dd class="num">'+p[C.gp]+' ('+p[C.gs]+' starts)</dd><dt>Minutes</dt><dd class="num">'+num(p[C.min]/Math.max(1,p[C.gp]))+' a game</dd>'+(LINKS.draft&&LINKS.draft[id]?'<dt>Draft Savant</dt><dd><a href="/draft-savant.html">Draft profile</a></dd>':'')+(LINKS.nba&&LINKS.nba[id]?'<dt>Basketball Savant</dt><dd><a href="/basketball-savant.html">NBA card</a></dd>':'')+'</dl><div class="hd" style="margin:18px 0 4px"><h2>Seasons</h2><span class="meta">From 2013-14</span></div><dl class="kv">'+hist+'</dl></section>';
      // zones
      var tr=IDX.seasons.filter(function(x){return x.season===sn;})[0]||{};
      var zs=ZONES.map(function(z){var n=d.samples[z[2]][i]||0,all=d.samples.n_fg[i]||0,r=R[z[3]];var vals=M.valuesFor(d,z[3],r.pool?r.pool.ids:[],{adj:false,gt:S.gt}),m=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:null;return {name:z[1],x:z[4],y:z[5],freq:all?Math.round(100*n/all):0,fg:r.tracked?r.value:null,pct:r.tracked&&r.pct!=null?r.pct:null,avg:m,n:n};});
      if(tr.shots){
        h+='<section class="card"><div class="hd"><h2>Shot zones</h2><span class="meta">Size: share of shots · colour: FG% percentile</span></div>'+court(zs,sn,'Shot zones: '+zs.map(function(z){return z.name+', '+z.freq+'% of shots'+(z.pct!=null?', '+ord(z.pct)+' percentile':'');}).join('; '))+
        '<div class="twrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Zone</th><th class="r">Share</th><th class="r">FG%</th><th class="r">D1 '+esc((p[C.pos]||'').toLowerCase())+'s</th><th class="r">Pctl</th></tr></thead><tbody>'+zs.map(function(z){return '<tr><td>'+z.name+'</td><td class="r">'+z.freq+'%</td><td class="r">'+num(z.fg)+'%</td><td class="r">'+num(z.avg)+'%</td><td class="r">'+(z.pct==null?'—':z.pct)+'</td></tr>';}).join('')+'</tbody></table></div></section>';
      } else h+='<section class="card"><div class="hd"><h2>Shot zones</h2></div>'+empty('Shot locations are not tracked this season.')+'</section>';
      var L=(T.log[String(ix)]||[]).map(function(g){return {gid:g[0],date:dateShort(g[1]),opp:g[2],home:g[3],neutral:g[4],pf:g[5],pa:g[6],min:g[7],pts:g[8],fgm:g[9],fga:g[10],m3:g[11],a3:g[12],ftm:g[13],fta:g[14],reb:g[15],ast:g[16],tov:g[17],stl:g[18],blk:g[19],pfl:g[20],nd:g[22],post:g[23]};});
      var last=L.slice(-6).reverse();
      h+='<section class="card"><div class="hd"><h2>Recent games</h2><a class="meta" href="#team-'+esc(p[C.team])+'">Team schedule</a></div><div class="twrap"><table class="tbl"><thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th class="r hide-s">Min</th><th class="r">Pts</th></tr></thead><tbody>'+last.map(function(g){var w=g.pf>g.pa;return '<tr><td class="num">'+g.date+'</td><td>'+(g.neutral?'vs ':g.home?'vs ':'at ')+teamLink(g.opp)+'</td><td class="num '+(w?'res-w':'res-l')+'">'+(w?'W ':'L ')+g.pf+'–'+g.pa+'</td><td class="r hide-s">'+num(g.min,0)+'</td><td class="r">'+g.pts+'</td></tr>';}).join('')+'</tbody></table></div></section></div></div>';
      h+='<section class="card full"><div class="hd"><h2>Points by game</h2><div class="legend"><span><i class="lgb"></i>Last five games</span><span><i class="lgl"></i>Five-game average</span><span>Dashed: season average</span></div></div><div class="glh" id="ptschart"></div></section>';
      // splits
      var sp=T.splits[String(ix)]||{},tabs=[['quality','Opponent quality'],['site','Home / road'],['conf','Conference'],['quad','Quad'],['month','Month'],['garbage','Garbage time'],['post','Postseason']].filter(function(t){return sp[t[0]];});
      if(tabs.length){var tab=sp[S.splitTab]?S.splitTab:tabs[0][0];
        h+='<section class="card full"><div class="hd"><h2>Splits</h2><span class="meta">'+esc(sn)+', D1 opponents. '+(sp.quad?'NET quads by venue.':'NET quads: not tracked this season.')+' Postseason games are flagged, with no percentiles.</span></div><div class="tabs" role="tablist">'+tabs.map(function(t){return '<button type="button" role="tab" data-split="'+t[0]+'" aria-selected="'+(t[0]===tab)+'">'+esc(t[1])+'</button>';}).join('')+'</div><div class="twrap"><table class="tbl"><thead><tr><th>Split</th><th class="r">G</th><th class="r">Min</th><th class="r">Pts/'+S.per+'</th><th class="r">TS%</th><th class="r hide-s">eFG%</th><th class="r hide-s">3P%</th><th class="r">Ast/'+S.per+'</th><th class="r hide-s">Reb/'+S.per+'</th><th class="r hide-s">TOV%</th><th class="r">Usg</th></tr></thead><tbody>'+
        sp[tab].map(function(r){return '<tr><td>'+esc(r[0])+'</td><td class="r">'+r[1]+'</td><td class="r">'+num(r[2],0)+'</td><td class="r">'+num(r[4]*S.per)+'</td><td class="r">'+num(r[5])+'</td><td class="r hide-s">'+num(r[6])+'</td><td class="r hide-s">'+num(r[7])+'</td><td class="r">'+num(r[8]*S.per)+'</td><td class="r hide-s">'+num(r[9]*S.per)+'</td><td class="r hide-s">'+num(r[10])+'</td><td class="r">'+num(r[11])+'</td></tr>';}).join('')+'</tbody></table></div></section>';}
      // game log
      h+='<section class="card full"><div class="hd"><h2>Game log</h2><span class="meta">'+esc(sn)+', '+L.length+' games. Non-D1 games are flagged and count in no rate.</span></div><div class="twrap scroll"><table class="tbl"><thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th class="r">Min</th><th class="r">Pts</th><th class="r">FG</th><th class="r">3P</th><th class="r">FT</th><th class="r">Reb</th><th class="r">Ast</th><th class="r">TO</th><th class="r">Stl</th><th class="r">Blk</th></tr></thead><tbody>'+L.slice().reverse().map(function(g){var w=g.pf>g.pa;return '<tr><td class="num">'+g.date+'</td><td>'+(g.home?'vs ':'at ')+teamLink(g.opp)+(g.post?'<span class="tag">Postseason</span>':'')+'</td><td class="num '+(w?'res-w':'res-l')+'">'+(w?'W ':'L ')+g.pf+'–'+g.pa+'</td><td class="r">'+num(g.min,0)+'</td><td class="r">'+g.pts+'</td><td class="r">'+g.fgm+'–'+g.fga+'</td><td class="r">'+g.m3+'–'+g.a3+'</td><td class="r">'+g.ftm+'–'+g.fta+'</td><td class="r">'+g.reb+'</td><td class="r">'+g.ast+'</td><td class="r">'+g.tov+'</td><td class="r">'+g.stl+'</td><td class="r">'+g.blk+'</td></tr>';}).join('')+'</tbody></table></div></section>';
      // career
      var CK=['value','pts','ts','fg3','ast_pct','orb_pct','drb_pct','stl_pct','blk_pct','usg','bi'];
      h+='<section class="card full"><div class="hd"><h2>Career</h2><span class="meta">From 2013-14 · percentile vs D1 at position, adjusted where the stat has it</span></div><div class="twrap scroll"><table class="tbl"><thead><tr><th>Season</th><th>Team</th><th>Honours</th><th class="r">G</th><th class="r">Min</th>'+CK.map(function(k){return '<th class="r">'+esc(statOf(k).label)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.slice().reverse().map(function(r){return '<tr'+(r.s===sn?' class="me"':'')+'><td class="num"><a href="#player-'+esc(id)+'/'+r.s+'">'+esc(r.s)+'</a></td><td>'+teamLink(r.t)+'</td><td class="hon">'+esc((HON[id]||[]).filter(function(x){return x[0]===r.s;}).map(function(x){return x[2];}).join(', '))+'</td><td class="r">'+r.g+'</td><td class="r">'+num(r.m,0)+'</td>'+CK.map(function(k){var v=(r.v[k]||[]);return '<td class="r">'+(M.ok(v[0])?esc(M.display(statOf(k),v[0],S.per)):'—')+(v[1]!=null?' <small class="pct">'+v[1]+'</small>':'')+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div></section>';
      // comps
      var cm=cr.cmp||[];h+='<section class="card full"><div class="hd"><h2>Nearest players</h2><span class="meta">Same position, within a year of age, seasons on file. The model’s view, not a verdict.</span></div>'+(cm.length?'<div class="twrap"><table class="tbl"><thead><tr><th>Player</th><th>Season</th><th>Team</th><th class="r">Match</th></tr></thead><tbody>'+cm.map(function(c){return '<tr><td><a href="#player-'+esc(c[0])+'/'+c[2]+'">'+esc(c[1])+'</a></td><td class="num">'+esc(c[2])+'</td><td>'+teamLink(c[3])+'</td><td class="r">'+Math.round(c[4]*100)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('Needs a qualified season and a birthdate.'))+'</section>';
      // links
      h+='<section class="card full"><div class="hd"><h2>What these numbers mean</h2><span class="meta">What it is, how it is figured, where it comes from, what sample it needs</span></div><div class="exp">'+REG.groups.map(function(g){return '<details><summary>'+esc(g)+'</summary>'+REG.stats.filter(function(s){return s.group===g;}).map(function(s){return '<div class="ex"><strong>'+esc(s.label)+'.</strong> '+esc(s.what)+'<div class="meta">Formula: '+esc(s.formula)+'. Source: '+esc(s.source)+'. From '+esc(s.start)+'.'+(s.k?' Settles around '+Math.round(s.k)+' '+esc(s.sample_unit||'')+'.':'')+(s.note?' '+esc(s.note):'')+'</div></div>';}).join('')+'</details>';}).join('')+'</div></section>';
      pending.push(function(){var el=$('#ptschart');if(el&&L.length)el.innerHTML=chartPts(L.filter(function(g){return g.min>0;}),Math.max(300,el.clientWidth));});
      return {html:h,cur:'players'};
    });
  });
}

/* ---------- team ---------- */
function vTeam(id,season){
  var sn=season||S.season;
  return Promise.all([load('teams/'+sn+'.json'),load('t/'+sn+'/'+id+'.json').catch(function(){return null;}),load('s/'+sn+'.json')]).then(function(a){
    var tb=a[0],T=a[1],d=a[2],r=tb.teams.filter(function(x){return x.id===id;})[0];
    if(!r||!T)return {html:empty('No file for that team this season.'),cur:'teams'};
    S.lastT=id;var names=T.roster,byId={};d.players.forEach(function(p,i){byId[p[C.id]]=i;});
    var tr=IDX.seasons.filter(function(x){return x.season===sn;})[0]||{};
    var h='<section class="trow"><div><h1>'+esc(r.full||r.name)+'</h1><p class="sub">'+esc(confName(r.conf))+' · '+r.w+'–'+r.l+' vs D1 ('+r.cw+'–'+r.cl+' in conference)</p></div><div class="actions">'+seasonSel('tseason',IDX.seasons.map(function(x){return x.season;}).reverse(),sn)+'</div></section>';
    h+='<p class="finding"><strong>'+ord(r.rank)+' of '+tb.teams.length+' in our ratings</strong>, '+sg(r.net)+' per 100 possessions against an average D1 team on a neutral floor. The market has them at '+sg(r.market)+' points.'+(r.luck!=null?' They have '+(r.luck>=0?'won ':'lost ')+Math.abs(r.luck).toFixed(1)+' more games than their ratings expected.':'')+'</p>';
    h+='<div class="kpis"><div class="kpi"><div class="k">Net rating</div><div class="v lead">'+sg(r.net)+'</div><div class="s">'+ord(r.rank)+' in D1</div></div><div class="kpi"><div class="k">Offense</div><div class="v">'+num(r.adjo)+'</div><div class="s">per 100, adjusted</div></div><div class="kpi"><div class="k">Defense</div><div class="v">'+num(r.adjd)+'</div><div class="s">per 100, adjusted</div></div><div class="kpi"><div class="k">Pace</div><div class="v">'+num(r.tempo)+'</div><div class="s">poss per 40</div></div><div class="kpi"><div class="k">Market</div><div class="v">'+sg(r.market)+'</div><div class="s">points, from spreads</div></div><div class="kpi"><div class="k">BPI / NET</div><div class="v">'+sg(r.bpi)+'</div><div class="s">'+(r.netrank?'NET '+r.netrank:'NET not tracked')+'</div></div></div>';
    h+='<div class="cols"><section class="card"><div class="hd"><h2>Roster</h2><span class="meta">By minutes · box impact percentile vs D1 at position</span></div><div class="twrap"><table class="tbl"><thead><tr><th>Player</th><th class="hide-s">Pos</th><th class="r hide-s">Min</th><th class="tw">Box impact</th></tr></thead><tbody>'+names.slice(0,13).map(function(n){var i=byId[n[0]];var R=i==null?null:M.row(d,REG,statOf('bi'),i,{poolName:'pos',adj:true,gt:false,per:S.per});return '<tr><td class="who">'+playerLink(n[0],n[1])+'<small>'+esc(n[3]||'')+'</small></td><td class="pos hide-s">'+esc(n[2]||'')+'</td><td class="r hide-s">'+num(n[4],0)+'</td><td class="tw">'+(R&&R.tracked&&R.pct!=null?bar(R,'Box impact','sm',n[1]):'<span class="pos">—</span>')+'</td></tr>';}).join('')+'</tbody></table></div></section>';
    var res=T.results.slice(-10).reverse();
    h+='<section class="card"><div class="hd"><h2>Results</h2><span class="meta">Last '+res.length+' of '+T.results.length+' games</span></div><div class="twrap"><table class="tbl"><thead><tr><th>Date</th><th>Opponent</th><th class="r">Result</th></tr></thead><tbody>'+res.map(function(g){var w=g[5]>g[6];return '<tr><td class="num">'+dateShort(g[1])+'</td><td>'+(g[4]?'vs ':g[3]?'vs ':'at ')+teamLink(g[2])+(g[8]?'<span class="tag">Postseason</span>':'')+'</td><td class="r '+(w?'res-w':'res-l')+'">'+(w?'W ':'L ')+g[5]+'–'+g[6]+'</td></tr>';}).join('')+'</tbody></table></div></section></div>';
    // team tables
    h+='<section class="card full"><div class="hd"><h2>Four factors and shot diet</h2><span class="meta">Own and allowed, D1 games</span></div><div class="twrap"><table class="tbl"><thead><tr><th></th><th class="r">eFG%</th><th class="r">TOV%</th><th class="r">Reb%</th><th class="r">FT rate</th><th class="r">Rim</th><th class="r">Mid</th><th class="r">Three</th></tr></thead><tbody><tr><td>Offense</td><td class="r">'+num(r.efg)+'</td><td class="r">'+num(r.tov)+'</td><td class="r">'+num(r.orb)+'</td><td class="r">'+num(r.ftr)+'</td><td class="r">'+num(r.rim)+'</td><td class="r">'+num(r.mid)+'</td><td class="r">'+num(r.three)+'</td></tr><tr><td>Defense</td><td class="r">'+num(r.oefg)+'</td><td class="r">'+num(r.otov)+'</td><td class="r">'+num(r.drb)+'</td><td class="r">'+num(r.oftr)+'</td><td class="r">'+num(r.orim)+'</td><td class="r">'+num(r.omid)+'</td><td class="r">'+num(r.othree)+'</td></tr></tbody></table></div></section>';
    if(tr.court){
      var n=S.tab5,u=(T.units[n]||[]).slice(0,10);
      var nm=function(ids){return ids.map(function(x){var y=names[x];if(!y)return '—';var w=String(y[1]).split(' ');return w[w.length-1];}).join(', ');};
      h+='<section class="card full"><div class="hd"><h2>Most-used lineups</h2><span class="meta">From 2024-25 · net per 100 · shrunk pulls small samples to the team and takes out opponents’ shooting luck</span></div><div class="tabs" role="tablist">'+[['5','5-man'],['4','4-man'],['3','3-man'],['2','2-man']].map(function(t){return '<button type="button" role="tab" data-units="'+t[0]+'" aria-selected="'+(t[0]===n)+'">'+t[1]+'</button>';}).join('')+'</div><div class="twrap"><table class="tbl"><thead><tr><th>Unit</th><th class="r">Poss</th><th class="r hide-s">Off</th><th class="r hide-s">Def</th><th class="r">Net</th><th class="r">Shrunk</th></tr></thead><tbody>'+(u.length?u.map(function(x){return '<tr><td class="who">'+esc(nm(x.ids))+'</td><td class="r">'+x.poss+'</td><td class="r hide-s">'+num(x.ortg)+'</td><td class="r hide-s">'+num(x.drtg)+'</td><td class="r">'+sg(x.net)+'</td><td class="r">'+sg(x.est)+'</td></tr>';}).join(''):'<tr><td colspan="6" class="pos">No units with enough possessions yet.</td></tr>')+'</tbody></table></div></section>';
      // pair matrix: ranked list on phones, a matrix on wide screens
      var top8=names.slice(0,8).map(function(x,i){return i;}),pairs={};(T.units['2']||[]).forEach(function(u2){pairs[u2.ids[0]+'-'+u2.ids[1]]=u2;pairs[u2.ids[1]+'-'+u2.ids[0]]=u2;});
      var cell=function(x,y){var q=pairs[x+'-'+y];if(!q)return '<td class="r pos">—</td>';var c=col(Math.max(1,Math.min(99,50+q.est*2)));return '<td class="r pc" style="background:'+c+';color:'+inkOn(c)+'" title="'+q.poss+' possessions">'+sg(q.est)+'</td>';};
      var ln=function(x){var w=String(names[x][1]).split(' ');return esc(w[w.length-1]);};
      var rank=(T.units['2']||[]).slice().sort(function(a,b){return b.est-a.est;}).slice(0,8);
      h+='<section class="card full"><div class="hd"><h2>Pairs</h2><span class="meta">Shrunk net per 100 with both on the floor</span></div><div class="twrap matrix"><table class="tbl mx"><thead><tr><th></th>'+top8.map(function(y){return '<th class="r">'+ln(y)+'</th>';}).join('')+'</tr></thead><tbody>'+top8.map(function(x){return '<tr><td>'+ln(x)+'</td>'+top8.map(function(y){return x===y?'<td class="r pos">·</td>':cell(x,y);}).join('')+'</tr>';}).join('')+'</tbody></table></div><ol class="plist">'+rank.map(function(q){return '<li><span>'+esc(nm(q.ids))+'</span><span class="fig">'+sg(q.est)+'</span></li>';}).join('')+'</ol></section>';
      // with / without
      var a0=S.wwA!=null&&names[S.wwA]?S.wwA:0,on=S.wwOn.filter(function(x){return names[x];}),off=S.wwOff.filter(function(x){return names[x];});
      var w=M.withWithout(T.fives,on,off),base=M.withWithout(T.fives,[],[]);
      h+='<section class="card full"><div class="hd"><h2>With / Without</h2><span class="meta">From 2024-25 · any set of players, garbage time out</span></div><div class="ww">'+names.slice(0,10).map(function(x,i){var st=on.indexOf(i)>=0?'on':off.indexOf(i)>=0?'off':'any';return '<button type="button" class="wwb '+st+'" data-ww="'+i+'" aria-pressed="'+(st!=='any')+'">'+esc(x[1])+'<small>'+(st==='on'?'on':st==='off'?'off':'either')+'</small></button>';}).join('')+'</div><div class="twrap"><table class="tbl"><thead><tr><th></th><th class="r">Min</th><th class="r">Poss</th><th class="r">Off</th><th class="r">Def</th><th class="r">Net</th></tr></thead><tbody><tr><td>Selected</td><td class="r">'+num(w.min,0)+'</td><td class="r">'+w.poss+'</td><td class="r">'+num(w.ortg)+'</td><td class="r">'+num(w.drtg)+'</td><td class="r">'+sg(w.net)+'</td></tr><tr><td>Whole team</td><td class="r">'+num(base.min,0)+'</td><td class="r">'+base.poss+'</td><td class="r">'+num(base.ortg)+'</td><td class="r">'+num(base.drtg)+'</td><td class="r">'+sg(base.net)+'</td></tr></tbody></table></div></section>';
    } else h+='<section class="card full"><div class="hd"><h2>Lineups, pairs and With / Without</h2></div>'+empty('Not tracked this season. They start in 2024-25.')+'</section>';
    return {html:h,cur:'teams'};
  });
}

/* ---------- all-savant ---------- */
var POSW={Guard:'guard',Wing:'wing',Big:'big'};
function astCard(x,i,season){
  var nm=String(x.name||''),sp=nm.indexOf(' '),first=sp>0?nm.slice(0,sp):'',last=sp>0?nm.slice(sp+1):nm,why=nm+', '+tname(x.team)+', '+x.value+' Savant value';
  return '<a class="ast-card" href="#player-'+esc(x.id)+'/'+esc(season)+'" style="--i:'+i+'" aria-label="'+esc(why)+'"><span class="ast-por'+(x.head?'':' noimg')+'"><span class="ast-pos">'+esc(x.slot)+'</span>'+(x.head?'<img src="https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+esc(x.id)+'.png" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add(\'noimg\');this.remove()">':'')+'<span class="ast-init" aria-hidden="true">'+esc(ini(nm))+'</span></span><span class="ast-body"><span class="ast-first">'+esc(first||' ')+'</span><span class="ast-last'+(last.length>13?' xlong':last.length>10?' long':'')+'">'+esc(last)+'</span><span class="ast-meta">'+esc(tname(x.team))+(x.cls?' · '+esc(x.cls):'')+(x.filled?' · filled seat, a '+esc(String(x.pos||'').toLowerCase()):'')+'</span><span class="ast-rule" aria-hidden="true"></span><span class="ast-num'+(x.value<0?' neg':'')+'">'+num(x.value)+'</span><span class="ast-unit">points over a replacement '+esc(POSW[x.pos]||'player')+'</span></span></a>';
}
function vAllSavant(){
  var sn=S.season;
  return load('allsavant/'+sn+'.json').then(function(t){
    var tab=S.astTab,confs=Object.keys(t.conference).sort(function(a,b){return confName(a).localeCompare(confName(b));}),cf=S.astConf&&t.conference[S.astConf]?S.astConf:confs[0];
    var row=tab==='fr'?t.freshman:tab==='conf'?(t.conference[cf]||[]):(t.national[tab]||[]);
    var titles={'1':'1st team','2':'2nd team','3':'3rd team','fr':'All-Freshman','conf':confName(cf)+' team'};
    var h='<section class="trow"><div><h1>All-Savant Teams</h1><p class="sub">The best of '+esc(sn)+' by Savant value: points added over a replacement-level player at the same position. The model’s view, not a verdict.</p></div></section>';
    if(t.poy)h+='<p class="finding"><strong>Savant Player of the Year'+(t.so_far?', so far':'')+':</strong> <a href="#player-'+esc(t.poy.id)+'/'+esc(sn)+'">'+esc(t.poy.name)+'</a>, '+esc(tname(t.poy.team))+', '+num(t.poy.value)+' points over replacement.</p>';
    if(t.so_far)h+='<p class="pool-n">Standings so far, through '+esc(dateShort(t.through))+'. These become honours after the national championship.</p>';
    if(t.note)h+='<p class="pool-n">'+esc(t.note)+'</p>';
    if(IDX.landing_note&&sn===IDX.default_season)h+='<p class="pool-n">'+esc(IDX.landing_note)+'</p>';
    h+='<section class="ast"><div class="ast-ctl">'+seg('ast',[['1','1st'],['2','2nd'],['3','3rd'],['conf','Conference'],['fr','Freshman']],tab,'Which team')+seasonSel('hseason',IDX.seasons.map(function(x){return x.season;}).reverse(),sn)+(tab==='conf'?'<label class="ctl" for="astconf">Conference<select class="sel" id="astconf">'+confs.map(function(c){return '<option value="'+esc(c)+'"'+(c===cf?' selected':'')+'>'+esc(confName(c))+'</option>';}).join('')+'</select></label>':'')+'</div><h2 class="vh">'+esc(titles[tab])+'</h2><div class="ast-row">'+(row.length?row.map(function(x,i){return astCard(x,i,sn);}).join(''):'<p class="ast-empty">No qualified players yet.</p>')+'</div></section>';
    h+='<p class="pool-n" style="margin-top:18px">Two guards, two wings and a big, by this site’s positions. A player makes one national team. '+(sn>='2024-25'?'This season’s value includes the on-floor part, from lineups.':'This season’s value is box score only: lineups start in 2024-25.')+' Every D1 game counts, through the national championship. Missed games count: a player earns nothing on a night not played.</p>';
    return {html:h,cur:'allsavant'};
  });
}

/* ---------- all teams ---------- */
var TCOLS=[['rank','#',0,1],['net','Net',1],['adjo','Off',1],['adjd','Def',1,1],['market','Market',1],['bpi','BPI',1],['netrank','NET',0,1],['tempo','Pace',1],['efg','eFG%',1],['tov','TOV%',1,1],['orb','OReb%',1],['ftr','FT rate',1],['oefg','Opp eFG%',1,1],['rim','Rim',1],['three','Three',1],['luck','Luck',1],['sos','SOS',1]];
function vTeams(){
  return load('teams/'+S.season+'.json').then(function(tb){
    var k=S.tsort,def=TCOLS.filter(function(c){return c[0]===k;})[0]||TCOLS[1],low=def[3],rows=tb.teams.slice().sort(function(a,b){var x=a[k],y=b[k];if(x==null)return 1;if(y==null)return -1;return low?x-y:y-x;});
    var h='<section class="trow"><div><h1>Teams</h1><p class="sub">Our adjusted ratings, the market’s view, and BPI and NET as reference columns. Market-implied ratings are the model’s view of the spreads, not a verdict.</p></div><div class="actions">'+seasonSel('hseason',IDX.seasons.map(function(x){return x.season;}).reverse(),S.season)+'</div></section>';
    h+='<section class="card full"><div class="hd"><h2>All '+rows.length+' teams</h2><span class="meta">'+esc(S.season)+' · D1 games · click a column to sort</span></div><div class="twrap scroll"><table class="tbl sticky"><thead><tr><th>Team</th>'+TCOLS.map(function(c){return '<th class="r"><button type="button" class="th" data-tsort="'+c[0]+'" aria-pressed="'+(c[0]===k)+'">'+esc(c[1])+'</button></th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+teamLink(r.id)+'</td>'+TCOLS.map(function(c){var v=r[c[0]];return '<td class="r">'+(v==null?'—':(c[0]==='rank'||c[0]==='netrank'?v:(c[0]==='net'||c[0]==='market'||c[0]==='bpi'||c[0]==='luck'||c[0]==='sos')?sg(v):num(v)))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div></section>';
    return {html:h,cur:'teams'};
  });
}

/* ---------- leaders ---------- */
function vLeaders(){
  return load('s/'+S.season+'.json').then(function(d){
    var st=statOf(S.lstat),c=M.column(d,st.key,{adj:S.adj,gt:S.gt})||[],ns=st.sample?d.samples[st.sample]:null,P=d.players;
    var ids=[];for(var i=0;i<P.length;i++){if(!M.ok(c[i]))continue;if((d.samples.poss[i]||0)<S.lmin)continue;if(S.lpos!=='all'&&P[i][C.pos]!==S.lpos)continue;if(st.key.indexOf('rapm')===0&&(d.samples.rapm_n[i]||0)<REG.rapm_min)continue;ids.push(i);}
    ids.sort(function(a,b){return st.lower?c[a]-c[b]:c[b]-c[a];});
    var opts=REG.groups.map(function(g){return '<optgroup label="'+esc(g)+'">'+REG.stats.filter(function(s){return s.group===g;}).map(function(s){return '<option value="'+s.key+'"'+(s.key===st.key?' selected':'')+'>'+esc(s.label)+'</option>';}).join('')+'</optgroup>';}).join('');
    var label='vs D1'+(S.lpos==='all'?' players':' '+S.lpos.toLowerCase()+'s')+', '+(S.adj&&M.hasAdj(d,st.key)?'opponent-adjusted':'raw')+', '+S.season;
    var h='<section class="trow"><div><h1>Leaders</h1><p class="sub">'+esc(st.what)+'</p></div></section><section class="card full"><div class="hd"><h2>'+esc(st.label)+'</h2><span class="meta">'+esc(label)+' · '+ids.length+' players</span></div><div class="ctrls" style="margin-bottom:12px"><label class="ctl" for="lstat">Stat<select class="sel" id="lstat">'+opts+'</select></label>'+seasonSel('hseason',IDX.seasons.map(function(x){return x.season;}).reverse(),S.season)+'<span class="ctl">'+seg('lpos',[['all','All'],['Guard','Guards'],['Wing','Wings'],['Big','Bigs']],S.lpos,'Position')+'</span><label class="ctl" for="lmin">Min. possessions<select class="sel" id="lmin">'+[100,300,500,800].map(function(v){return '<option value="'+v+'"'+(v===S.lmin?' selected':'')+'>'+v+'</option>';}).join('')+'</select></label></div>';
    var rows=ids.slice(0,100);
    h+='<div class="twrap"><table class="tbl"><thead><tr><th class="r">#</th><th>Player</th><th class="hide-s">Team</th><th class="hide-s">Pos</th><th class="r">'+esc(st.label)+'</th><th class="tw hide-s">Percentile</th></tr></thead><tbody>'+rows.map(function(i,k){var p=P[i],r=M.row(d,REG,st,i,{poolName:S.lpos==='all'?'all':'pos',adj:S.adj,gt:S.gt,per:S.per});return '<tr><td class="r">'+(k+1)+'</td><td>'+playerLink(p[C.id],p[C.name])+'</td><td class="hide-s">'+teamLink(p[C.team])+'</td><td class="pos hide-s">'+esc(p[C.pos]||'')+'</td><td class="r">'+esc(M.display(st,c[i],S.per))+'</td><td class="tw hide-s">'+(r.pct!=null?bar(r,st.label,'sm',p[C.name]):'')+'</td></tr>';}).join('')+'</tbody></table></div></section>';
    return {html:h,cur:'leaders'};
  });
}

/* ---------- compare ---------- */
function vCompare(){
  return load('s/'+S.season+'.json').then(function(d){
    var P=d.players,q=[];P.forEach(function(p,i){if(p[C.qual])q.push(i);});
    var find=function(id){return P.findIndex(function(p){return p[C.id]===id;});};
    var a=S.cmpA!=null?find(S.cmpA):-1,b=S.cmpB!=null?find(S.cmpB):-1;if(a<0)a=q[0];if(b<0||b===a)b=q[1];
    var sl=function(id,i){return '<select class="sel" id="'+id+'" aria-label="Player">'+q.slice().sort(function(x,y){return String(P[x][C.name]).localeCompare(String(P[y][C.name]));}).map(function(j){return '<option value="'+esc(P[j][C.id])+'"'+(j===i?' selected':'')+'>'+esc(P[j][C.name]+', '+tname(P[j][C.team]))+'</option>';}).join('')+'</select>';};
    var oA={poolName:'pos',adj:S.adj,gt:S.gt,per:S.per},Ra=statRows(d,a,oA),Rb=statRows(d,b,oA);
    var la=M.poolLabel(Ra.pts.pool,P[a],{adj:S.adj,season:S.season}),lb=M.poolLabel(Rb.pts.pool,P[b],{adj:S.adj,season:S.season});
    var h='<section class="trow"><div><h1>Compare</h1><p class="sub">Each player ranked in their own pool: '+esc(la.replace('vs ',''))+'; '+esc(lb.replace('vs ',''))+'.</p></div></section><section class="card full"><div class="ctrls" style="margin-bottom:12px">'+sl('ca',a)+sl('cb',b)+seasonSel('hseason',IDX.seasons.map(function(x){return x.season;}).reverse(),S.season)+'<span class="ctl">'+seg('adj',[[1,'Adjusted'],[0,'Raw']],S.adj?1:0,'Opponent adjustment')+'</span></div>'+legend();
    REG.groups.forEach(function(g){var ss=REG.stats.filter(function(s){return s.group===g&&Ra[s.key].pct!=null&&Rb[s.key].pct!=null;});if(!ss.length)return;
      h+='<div class="grp"><h3>'+esc(g)+'</h3>'+ss.map(function(s){var x=Ra[s.key],y=Rb[s.key];return '<div class="pr cmp"><div class="pl">'+esc(s.label)+'</div><div class="bars"><b>'+esc(ini(P[a][C.name]))+'</b>'+bar(x,s.label,'md',P[a][C.name])+'<b>'+esc(ini(P[b][C.name]))+'</b>'+bar(y,s.label,'md',P[b][C.name])+'</div><div class="pv"><span>'+esc(x.shown)+'</span><span>'+esc(y.shown)+'</span></div></div>';}).join('')+'</div>';});
    return {html:h+'</section>',cur:'compare'};
  });
}

/* ---------- shell ---------- */
var lastHash='',rid=0;
function render(){
  var h=(location.hash||'#home').slice(1),my=++rid,p;pending=[];
  if(h.indexOf('team-')===0){var a=h.slice(5).split('/');p=vTeam(a[0],a[1]);}
  else if(h==='teams')p=vTeams();
  else if(h==='leaders')p=vLeaders();
  else if(h==='all-savant')p=vAllSavant();
  else if(h==='compare')p=vCompare();
  else if(h.indexOf('player-')===0){var b=h.slice(7).split('/');p=vPlayer(b[0],b[1]);}
  else p=vHome();
  p.then(function(r){
    if(my!==rid)return;
    $('#view').innerHTML=r.html;pending.forEach(function(f){f();});
    document.querySelectorAll('.nav a').forEach(function(x){x.setAttribute('aria-current',x.dataset.k===r.cur?'page':'false');});
    var si=IDX.seasons.filter(function(x){return x.season===S.season;})[0]||{};
    $('#scope').textContent='Men’s Division I · '+S.season+(si.through?' · through '+dateShort(si.through):'');
    if(h!==lastHash){lastHash=h;window.scrollTo(0,0);}
  }).catch(function(e){if(my!==rid)return;console.error(e);$('#view').innerHTML='<p class="empty">That page could not load. '+esc(e.message)+'. Refresh to try again.</p>';});
}
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-per],[data-lpos],[data-cmp],[data-adj],[data-gt],[data-split],[data-units],[data-tsort],[data-ww],[data-ast]');if(!t)return;var d=t.dataset;
  if(d.ast)S.astTab=d.ast;
  if(d.cmp){S.cmpA=d.cmp;return;}
  if(d.per)S.per=+d.per;if(d.lpos)S.lpos=d.lpos;if(d.adj!=null)S.adj=d.adj==='1';if(d.gt!=null)S.gt=d.gt==='1';if(d.split)S.splitTab=d.split;if(d.units)S.tab5=d.units;if(d.tsort)S.tsort=d.tsort;
  if(d.ww!=null){var i=+d.ww,on=S.wwOn.indexOf(i),off=S.wwOff.indexOf(i);if(on>=0){S.wwOn.splice(on,1);S.wwOff.push(i);}else if(off>=0){S.wwOff.splice(off,1);}else S.wwOn.push(i);}
  render();
});
document.addEventListener('change',function(e){
  var id=e.target.id,v=e.target.value;
  if(id==='pool'){S.pool=v;render();}
  if(id==='hseason'){S.season=v;render();}
  if(id==='pseason'){location.hash='#player-'+location.hash.slice(8).split('/')[0]+'/'+v;}
  if(id==='tseason'){location.hash='#team-'+location.hash.slice(6).split('/')[0]+'/'+v;}
  if(id==='lstat'){S.lstat=v;render();}
  if(id==='lmin'){S.lmin=+v;render();}
  if(id==='astconf'){S.astConf=v;render();}
  if(id==='ca'){S.cmpA=v;render();}
  if(id==='cb'){S.cmpB=v;render();}
});
var q=$('#q'),res=$('#res');
q.addEventListener('input',function(){
  var v=q.value.trim().toLowerCase();if(!v||!SEARCH){res.hidden=true;return;}
  var hits=SEARCH.teams.filter(function(t){return String(t[1]).toLowerCase().indexOf(v)>=0;}).slice(0,3).map(function(t){return '<li><a href="#team-'+esc(t[0])+'">'+esc(t[1])+'<small>Team · '+esc(confName(t[3]))+'</small></a></li>';})
    .concat(SEARCH.players.filter(function(p){return String(p[1]).toLowerCase().indexOf(v)>=0;}).sort(function(a,b){return b[3].localeCompare(a[3])||b[5]-a[5];}).slice(0,7).map(function(p){return '<li><a href="#player-'+esc(p[0])+'">'+esc(p[1])+'<small>'+esc(tname(p[2])+' · '+(p[4]||'')+' · '+p[3])+'</small></a></li>';}));
  res.innerHTML=hits.length?hits.join(''):'<li class="none">No players or teams match.</li>';res.hidden=false;
});
q.addEventListener('keydown',function(e){if(e.key==='Escape'){res.hidden=true;q.blur();}if(e.key==='Enter'){var a=res.querySelector('a');if(a){location.hash=a.getAttribute('href');res.hidden=true;q.value='';}}});
res.addEventListener('click',function(){res.hidden=true;q.value='';});
document.addEventListener('click',function(e){if(!e.target.closest('.search'))res.hidden=true;});
window.addEventListener('hashchange',render);
var navtog=$('#navtog');
function setNav(c,save){document.documentElement.classList.toggle('nav-collapsed',c);var t=c?'Expand sidebar':'Collapse sidebar';navtog.setAttribute('aria-expanded',String(!c));navtog.title=t+' ( [ )';navtog.querySelector('.vh').textContent=t;if(save){try{localStorage.setItem('cbs-nav',c?'1':'0');}catch(e){}}}
navtog.addEventListener('click',function(){setNav(!document.documentElement.classList.contains('nav-collapsed'),true);});
document.addEventListener('keydown',function(e){if(e.key!=='['||e.metaKey||e.ctrlKey||e.altKey)return;var t=e.target;if(t&&(t.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)))return;if(window.innerWidth>760){e.preventDefault();navtog.click();}});
var saved=null;try{saved=localStorage.getItem('cbs-nav');}catch(e){}
setNav(saved==null?window.innerWidth<1100:saved==='1',false);
function fit(){q.placeholder=window.innerWidth<520?'Search':'Search players and teams';}
window.addEventListener('resize',function(){fit();if(pending.length)pending.forEach(function(f){f();});});
readScale();fit();
Promise.all([load('registry.json'),load('index.json'),load('search.json'),load('links.json').catch(function(){return {};}),load('honours.json').catch(function(){return {};})]).then(function(a){
  REG=a[0];IDX=a[1];SEARCH=a[2];LINKS=a[3]||{};HON=a[4]||{};REG.stats.forEach(function(s){BYK[s.key]=s;});
  SEARCH.teams.forEach(function(t){TEAMS[t[0]]={name:t[1],abbr:t[2],conf:t[3],color:t[5]};});
  S.season=IDX.default_season;
  $('#ver').textContent='Version '+REG.version;
  render();
}).catch(function(e){console.error(e);$('#view').innerHTML='<p class="empty">The data could not load. Refresh to try again.</p>';});
})();
