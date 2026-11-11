(function(){
'use strict';
var M=window.SavantCFB,C=M.COL,T=M.TCOL,SC=M.SCOL;
var API='/cfb/',cache={},REG,IDX,SEARCH,HON={},BYK={},TEAMK={};
var S={asView:(function(){try{return localStorage.getItem('cfb-as-view')==='list'?'list':'field';}catch(e){return 'field';}})(),season:null,pool:'pos',adj:true,gt:false,set:'national',tier:'1',conf:null,lbSlot:'QB',lbStat:null,lbQual:true,tSort:'rating',tDir:-1,tAdj:true,tConf:''};
var $=function(s,r){return (r||document).querySelector(s);};
var HEAD='https://a.espncdn.com/i/headshots/college-football/players/full/';
var LOGO='https://a.espncdn.com/i/teamlogos/ncaa/500/';
function load(p){if(!cache[p])cache[p]=fetch(API+p).then(function(r){if(!r.ok)throw new Error(p+' '+r.status);return r.json();}).catch(function(e){delete cache[p];throw e;});return cache[p];}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function mix(a,b,t){return a.map(function(v,i){return Math.round(v+(b[i]-v)*t);});}
function col(p){var L=[28,78,134],Md=[194,192,182],H=[188,58,44];var c=p<50?mix(L,Md,p/50):mix(Md,H,(p-50)/50);return 'rgb('+c.join(',')+')';}
function ink(p){return (p>30&&p<70)?'#191B1F':'#FFFFFF';}
function sg(v,d){if(v==null||!isFinite(v))return '—';var a=Math.abs(v).toFixed(d==null?1:d);return (v>0?'+':v<0?'−':'')+a;}
function ht(v){return v?Math.floor(v/12)+'-'+Math.round(v%12):'—';}
function ini(n){return String(n||'').split(/\s+/).filter(function(w){return /^[A-Za-z]/.test(w);}).map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();}
function tcolor(doc,t){var x=doc&&doc.teams&&doc.teams[String(t)];var c=x&&x[3];return c&&/^[0-9a-fA-F]{6}$/.test(c)&&c.toLowerCase()!=='ffffff'?'#'+c:(x&&x[4]&&/^[0-9a-fA-F]{6}$/.test(x[4])?'#'+x[4]:'#3A4763');}
function tname(doc,t){var x=doc&&doc.teams&&doc.teams[String(t)];return x?x[0]:(TEAMK[t]?TEAMK[t][1]:'Team '+t);}
function tconf(doc,t){var x=doc&&doc.teams&&doc.teams[String(t)];return x?x[2]:'';}
function logo(t){return '<img class="logo" src="'+LOGO+t+'.png" alt="" loading="lazy" onerror="this.remove()">';}
/* the photo where the build found one, the initials badge in team colours where it did not */
function hs(id,name,color,size,has){var st='width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*.42)+'px;background:'+color;
  if(!has||!id)return '<span class="hs" style="'+st+'" role="img" aria-label="'+esc(name)+'">'+esc(ini(name))+'</span>';
  return '<span class="hs" style="'+st+'"><img src="'+HEAD+id+'.png" alt="'+esc(name)+'" loading="lazy" onerror="this.parentNode.textContent=\''+esc(ini(name)).replace(/'/g,'')+'\'"></span>';}
function seasonInfo(y){return IDX.seasons.filter(function(s){return s.season===y;})[0];}
function day(d){if(!d)return '';var p=d.split('-');return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1]+' '+(+p[2])+', '+p[0];}
function asof(doc){return doc.final?'final':'through '+day(doc.through)+' (week '+doc.week+')';}
function tilt(i){return ['tl','tr2','tl2','tr'][i%4];}
function warnBox(t){return '<div class="warn" data-tilt><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"><path d="M12 3L2 20h20L12 3z" fill="none" stroke="#0B1730" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" stroke="#0B1730" stroke-width="2" stroke-linecap="round"/></svg><p>'+t+'</p></div>';}
function plink(id,season){return '#player-'+id+(season&&season!==IDX.current?'/'+season:'');}
function tlink(id,season){return '#team-'+id+(season&&season!==IDX.current?'/'+season:'');}

/* ---------- the bar ---------- */
function bar(r,mini){
  if(!r.tracked)return '<div class="bar none">'+esc(r.reason)+'</div>';
  if(r.none||r.pct==null)return '<div class="bar none">'+esc(r.reason||'no value')+'</div>';
  var c=col(r.pct),fill=r.hatched?'repeating-linear-gradient(135deg,'+c+' 0 7px,rgba(255,255,255,.6) 7px 11px)':c;
  var h='<div class="bar'+(mini?' mini':'')+'"><div class="f" style="width:'+r.pct+'%;background:'+fill+'"></div>';
  if(r.raw!=null&&r.raw!==r.pct)h+='<div class="k" aria-hidden="true" style="left:calc('+r.raw+'% - 1px)" title="Before opponent adjustment: '+M.nth(r.raw)+' percentile"></div>';
  if(r.settling&&r.likelyPct!=null)h+='<div class="d" aria-hidden="true" style="left:calc('+r.likelyPct+'% - 7px)" title="Likely to settle at '+esc(r.likelyShown)+'"></div>';
  h+='<div class="n" style="left:calc('+r.pct+'% - 16px);background:'+c+';color:'+ink(r.pct)+'">'+r.pct+'</div></div>';
  return h;}
function prow(stat,r,group){
  var note='';
  if(!r.tracked||r.none)note='';
  else if(r.settling)note='below settle point · likely to settle at '+r.likelyShown;
  else if(stat.lower)note='lower is better, flipped';
  else if(stat.verdict==='hatched')note='noisy in one season';
  else if(stat.note&&stat.note.length<34)note=stat.note.replace(/\.$/,'');
  if(r.tracked&&!r.none&&stat.lower&&r.settling)note+=' · lower is better, flipped';
  var tag=(stat.verdict==='context'&&group!=='Context')?' <span class="ctx">CONTEXT</span>':'';
  if(stat.tier==='B')tag+=' <span class="ctx tb" title="'+esc(REG.tier_b_note||'')+'">CHARTED</span>';
  return '<div class="prow"><div class="nm">'+esc(stat.label)+tag+(note?'<small>'+esc(note)+'</small>':'')+'</div>'+bar(r)+'<div class="v">'+(r.tracked&&!r.none?esc(r.shown):'—')+'</div></div>';}
function explain(reg,slot,season){
  var h='<div class="stk sm"><div class="pad"><h3 style="font-size:24px;color:var(--field)">What each stat means</h3>';
  M.cardGroups(reg,slot).concat(M.cardGroups(reg,'RET')).forEach(function(G){var g=G.group,ss=G.stats;
    h+='<details class="ex"><summary>'+esc(g)+'</summary>';
    ss.forEach(function(s){h+='<div class="exi"><strong>'+esc(s.label)+'.</strong> '+esc(s.what)+'<div class="meta">Formula: '+esc(s.formula)+'. Source: '+esc(s.source)+'. From '+s.start+'. '+(s.k?'Settles around '+s.k+' '+esc(s.unit_n)+'. ':'')+(s.adj?'Opponent-adjusted. ':'')+(s.tier==='B'?'Charted layer. ':'')+esc(s.note||'')+'</div></div>';});
    h+='</details>';});
  h+='<details class="ex"><summary>Savant value</summary><div class="exi">Expected points above a replacement-level player at his position, opponent-adjusted, on the plays he was credited with. His rate is pulled toward the position average until he has played enough, the replacement rate (the 25th-percentile qualified player) is taken away, and the rest is multiplied by his volume. Nothing in it knows whether his team won. Missed games and small roles cost value.<div class="meta">Garbage time ('+esc(reg.garbage_rule)+') is left out. FBS-vs-FBS games only. The model\'s view, not a verdict.</div></div></details>';
  return h+'</div></div>';}

function groupsHtml(G,d,i,o,openFirst){
  var h='',opened=false;
  G.forEach(function(g){var rows=g.stats.map(function(st){return [st,M.row(d,REG,st,i,o)];});
    var hd=rows.filter(function(x){return x[0].verdict!=='context'&&x[1].tracked&&!x[1].none&&x[1].pct!=null;})[0]||rows.filter(function(x){return x[1].tracked&&!x[1].none;})[0]||rows[0];
    var op=openFirst&&!opened&&g.group!=='Context'&&hd[1].tracked&&!hd[1].none;if(op)opened=true;
    h+='<details class="cg grp"'+(op?' open':'')+'><summary><span class="cgn">'+esc(g.group)+(g.group==='Context'?' <span class="ctx">CONTEXT</span>':'')+'</span><span class="cgh">'+esc(hd[0].label)+'</span><span class="cgb">'+bar(hd[1],true)+'</span><span class="cgv">'+(hd[1].tracked&&!hd[1].none?esc(hd[1].shown):'—')+'</span><span class="cgc" aria-hidden="true">'+rows.length+'</span></summary><div class="rows">';
    rows.forEach(function(x){h+=prow(x[0],x[1],g.group);});h+='</div></details>';});
  return h;}
function traj(P,y){
  var r=P.seasons.filter(function(x){return x[5]&&x[7]&&x[8];});if(r.length<2)return '';
  var pts=r.map(function(x){return [x[0],Math.round(100*(1-(x[7]-1)/x[8])),x[3]];}),w=300,hh=90,x0=Math.min.apply(null,pts.map(function(p){return p[0];})),x1=Math.max.apply(null,pts.map(function(p){return p[0];}));
  var X=function(v){return x1===x0?w/2:16+(v-x0)/(x1-x0)*(w-32);},Y=function(v){return hh-10-(v/100)*(hh-24);};
  var h='<div class="pnl"><h3>Career trajectory</h3><svg viewBox="0 0 '+w+' '+hh+'" width="100%" role="img" aria-label="Savant value percentile by season: '+pts.map(function(p){return p[0]+' '+M.nth(p[1]);}).join(', ')+'"><line x1="8" x2="'+(w-8)+'" y1="'+Y(50)+'" y2="'+Y(50)+'" stroke="var(--line)" stroke-dasharray="3 3"/><polyline fill="none" stroke="var(--field)" stroke-width="3" points="'+pts.map(function(p){return X(p[0])+','+Y(p[1]);}).join(' ')+'"/>';
  pts.forEach(function(p){h+='<circle cx="'+X(p[0])+'" cy="'+Y(p[1])+'" r="5" fill="'+col(p[1])+'" stroke="#0B1730" stroke-width="1.5"/><text x="'+X(p[0])+'" y="'+(hh-1)+'" text-anchor="middle" font-size="10">'+p[0]+'</text>';});
  return h+'</svg><p class="note">His Savant-value percentile among qualified players at his position, season by season'+(pts.some(function(p){return p[2];})?' (class: '+pts.map(function(p){return p[0]+' '+(p[2]||'?');}).join(', ')+')':'')+'.</p></div>';}
function extrasHtml(id,P,d,i,X){
  var p=d.players[i],slot=p[C.slot],y=d.season,h='',o={poolName:'pos',adj:true,gt:false};
  /* weakness comps */
  var wc=M.weakComps(d,REG,i,5);
  if(wc.length){h+='<section class="sec"><div class="rule"><h3>Weakness comps, '+y+'</h3></div><p class="note lt">Qualified '+esc(REG.slot_name[slot])+' whose percentiles sit closest to his on his five lowest bars ('+wc[0].on.map(function(k){return esc(BYK[k].label);}).join(', ')+'). Who shares his flaws, not a projection.</p><div class="cards">';
    wc.forEach(function(c,k){var q2=d.players[c.i];h+=pcard(d,{pid:q2[C.id],team:q2[C.team],slot:q2[C.slot],value:d.value.v[c.i],name:q2[C.name],head:q2[C.head]},k,Math.round(100-c.distance)+' match');});h+='</div></section>';}
  /* production vs pedigree */
  var pr=X.ped&&X.ped.rows.filter(function(r){return r[0]===id;})[0];
  if(pr)h+='<section class="stk sm"><div class="band"><h2>Production vs pedigree</h2><span class="lab">'+y+'</span></div><div class="pad"><p style="margin:0 0 8px;font-size:15px"><b>'+(pr[3]>0?'+':'')+pr[3].toFixed(0)+'</b> points: his Savant value sits in the '+M.nth(Math.round(pr[1]))+' percentile of qualified '+esc(REG.slot_name[slot])+', his recruiting rating in the '+M.nth(Math.round(pr[2]))+'. '+(pr[3]>=20?'He is outplaying his stars.':pr[3]<=-20?'His stars promised more than he has produced.':'Production and pedigree roughly agree.')+'</p><p class="note">'+esc(X.ped.note)+' <a href="#leaders">Leaderboards</a> rank it both ways.</p></div></section>';
  /* transfer impact */
  if(X.tr)h+=X.tr;
  /* NFL translation */
  var nc=X.comps&&X.comps[String(id)],N=X.nfl;
  if(nc&&N){var sh=N.show_outcomes,me=N.players[String(id)];
    h+='<section class="stk sm"><div class="band"><h2>NFL translation</h2><span class="lab">comparison, not a projection</span></div><div class="pad"><p class="note" style="margin-bottom:10px">The five final college seasons at his position most like his '+nc.season+' profile (his position\'s five headline stats, height, weight and recruiting rating), among players who reached the NFL. '+(sh?'Their NFL Savant value per season comes from Football Savant. On '+N.test.players+' NFL players\' college finals of 2014-2021, the comps\' NFL value rank-correlated '+N.test.spearman.toFixed(2)+' with the player\'s own.':'Their NFL outcomes are not averaged: on 2014-2021 college finals the comps\' NFL value did not track the player\'s own.')+'</p><div class="scroll"><table class="t"><thead><tr><th class="pin">Comp</th><th>Final college season</th><th>Drafted</th><th class="n">NFL seasons</th>'+(sh?'<th class="n">NFL value / season</th>':'')+'</tr></thead><tbody>';
    var vals=[];nc.comps.forEach(function(c){var q=N.players[String(c[0])];if(!q)return;var dr=q[5],ps=q[7];if(ps!=null)vals.push(ps);
      h+='<tr><td class="pin"><a href="'+plink(c[0],q[2])+'"><strong>'+esc(q[0])+'</strong></a></td><td>'+q[2]+' · '+esc(TEAMK[q[3]]?TEAMK[q[3]][1]:'')+'</td><td>'+(dr?(dr[1]?'Round '+dr[1]+', pick '+dr[2]+' ('+dr[0]+(dr[3]?', '+esc(dr[3]):'')+')':'Undrafted ('+dr[0]+')'):'Undrafted')+'</td><td class="n">'+q[6].length+'</td>'+(sh?'<td class="n">'+(ps==null?'—':sg(ps,1))+'</td>':'')+'</tr>';});
    h+='</tbody></table></div>'+(sh&&vals.length?'<p style="margin:10px 0 0;font-size:14px">The comps averaged <b>'+sg(vals.reduce(function(a,b){return a+b;},0)/vals.length,1)+'</b> NFL Savant value per season. A comparison, not a projection.</p>':'');
    var cb=N.combine&&N.combine[String(id)];
    if(cb)h+='<p style="margin:10px 0 0;font-size:14px"><strong>NFL combine</strong> (from Football Savant): '+[['forty','40-yard dash','s'],['vert','vertical','"'],['broad','broad jump','"'],['cone','3-cone','s'],['shuttle','shuttle','s'],['bench','bench','reps']].filter(function(k){return cb[k[0]]!=null;}).map(function(k){return k[1]+' '+cb[k[0]]+k[2];}).join(' · ')+'</p>';
    if(me&&me[5])h+='<p class="note" style="margin-top:8px">He reached the NFL himself: '+(me[5][1]?'round '+me[5][1]+', pick '+me[5][2]+' in '+me[5][0]:'undrafted, '+me[5][0])+'.</p>';
    h+='</div></section>';}
  return h;}
function transferHtml(id,P,cb){
  var sc=(P.bio&&P.bio.schools)||[],k=-1;sc.forEach(function(r,j){if(r[2]===1&&j>0)k=j;});
  if(k<0)return Promise.resolve('');
  var a=sc[k-1],b=sc[k];
  return Promise.all([load('s/'+a[0]+'.json').catch(function(){return null;}),load('s/'+b[0]+'.json').catch(function(){return null;})]).then(function(D){
    if(!D[0]||!D[1])return '';
    var ia=-1,ib=-1;D[0].players.forEach(function(p,j){if(p[C.id]===id)ia=j;});D[1].players.forEach(function(p,j){if(p[C.id]===id)ib=j;});
    if(ia<0||ib<0)return '';
    var sa=D[0].players[ia][C.slot],sb=D[1].players[ib][C.slot];if(M.SLOT_TABLE[sa]!==M.SLOT_TABLE[sb])return '';
    var hs_=M.headline(REG,sb),o={poolName:'pos',adj:true,gt:false};
    var h='<section class="stk sm"><div class="band"><h2>Transfer impact</h2><span class="lab">'+a[0]+' '+esc(TEAMK[a[1]]?TEAMK[a[1]][1]:'')+' → '+b[0]+' '+esc(TEAMK[b[1]]?TEAMK[b[1]][1]:'')+'</span></div><div class="scroll"><table class="t"><thead><tr><th class="pin">Stat</th><th class="n">'+a[0]+' (before)</th><th class="n">pct</th><th class="n">'+b[0]+' (after)</th><th class="n">pct</th></tr></thead><tbody>';
    hs_.forEach(function(st){var ra=M.row(D[0],REG,st,ia,o),rb=M.row(D[1],REG,st,ib,o);
      h+='<tr><td class="pin">'+esc(st.label)+'</td><td class="n">'+(ra.tracked&&!ra.none?esc(ra.shown):'—')+'</td><td class="n">'+(ra.pct!=null?ra.pct:'—')+'</td><td class="n">'+(rb.tracked&&!rb.none?esc(rb.shown):'—')+'</td><td class="n">'+(rb.pct!=null?rb.pct:'—')+'</td></tr>';});
    var va=D[0].value.v[ia],vb=D[1].value.v[ib];
    h+='<tr><td class="pin"><strong>Savant value</strong></td><td class="n">'+(va==null?'—':sg(va,1))+'</td><td></td><td class="n">'+(vb==null?'—':sg(vb,1))+'</td><td></td></tr></tbody></table></div><p class="note pad">The same stats each season, opponent-adjusted where the stat is, each against that season\'s FBS players at his position.</p></section>';
    return h;});}

/* ---------- home ---------- */
function vHome(){
  var y=S.season;
  return Promise.all([load('s/'+y+'.json'),load('allsavant/'+y+'.json')]).then(function(a){
    var d=a[0],A=a[1],ix={};d.players.forEach(function(p,i){ix[p[C.id]]=i;});
    var h='<section class="sec"><div class="rule"><h2>Savant Heisman'+(A.final?'':' race')+'</h2></div><p class="note lt">Pure Savant value, '+y+', '+esc(asof(A))+'. Expected points above a replacement player at his position, opponent-adjusted. Search any FBS player since 2014 above.</p><div class="cards">';
    A.heisman.slice(0,6).forEach(function(r,i){h+=pcard(d,r,i,'#'+(i+1));});
    h+='</div></section><section class="sec"><div class="rule"><h2>Non-QB Player of the Year</h2></div><div class="cards">';
    A.non_qb.slice(0,6).forEach(function(r,i){h+=pcard(d,r,i+1,'#'+(i+1));});
    h+='</div></section><section class="sec"><div class="rule"><h2>Best at each position</h2></div><p class="note lt">The top qualified player by Savant value at every position, '+y+'. Open a card for his percentile bars.</p><div class="cards">';
    REG.slots.forEach(function(sl,k){var best=null;d.players.forEach(function(p,i){if(p[C.slot]===sl&&p[C.qual]&&M.ok(d.value.v[i])&&(best===null||d.value.v[i]>d.value.v[best]))best=i;});
      if(best!==null)h+=pcard(d,{pid:d.players[best][C.id],team:d.players[best][C.team],slot:sl,value:d.value.v[best],name:d.players[best][C.name],head:d.players[best][C.head]},k,sl);});
    h+='</div></section>';
    return h;});}
function pcard(d,r,i,lead){var c=tcolor(d,r.team);
  return '<a class="stk sm pc '+tilt(i)+'" data-tilt href="'+plink(r.pid,d.season)+'">'+hs(r.pid,r.name,c,54,r.head)+'<div><div class="lab" style="color:var(--muted)">'+esc(lead)+' · '+esc(r.slot)+'</div><div class="nm">'+esc(r.name)+'</div><small>'+esc(tname(d,r.team))+'</small></div><span class="v">'+sg(r.value,1)+'</span></a>';}

/* ---------- player ---------- */
function shard(id){return load('p/'+('0'+(Math.abs(id)%100)).slice(-2)+'.json').then(function(d){return d[String(id)]||null;}).catch(function(){return null;});}
function vPlayer(id,want){
  return Promise.all([shard(id),load('s/'+IDX.current+'.json')]).then(function(a){
    var P=a[0]||{bio:{},seasons:[]},cur=a[1],seasons=P.seasons.map(function(r){return r[0];});
    var inCur=cur.players.some(function(p){return p[C.id]===id;});
    if(inCur&&seasons.indexOf(IDX.current)<0)seasons.push(IDX.current);
    if(!seasons.length){
      if(P.bio&&P.bio.name)return '<div class="stk who"><h2>'+esc(P.bio.name)+'</h2><p>No graded plays in an FBS-vs-FBS game yet. He appears on a roster; a card needs a pass, a run, a target, a tackle or a kick.</p></div>';
      return '<p class="empty">No player with that id.</p>';}
    var y=want&&seasons.indexOf(want)>=0?want:seasons[seasons.length-1];
    return load('s/'+y+'.json').then(function(d){
      var i=-1;d.players.forEach(function(p,k){if(p[C.id]===id)i=k;});
      if(i<0)return '<p class="empty">No graded plays in '+y+'.</p>';
      var team=d.players[i][C.team];
      return Promise.all([load('t/'+y+'/'+team+'.json').catch(function(){return null;}),load('teams/'+y+'.json').catch(function(){return null;}),load('allsavant/'+y+'.json').catch(function(){return null;}),
        load('x/comps/'+('0'+(Math.abs(id)%100)).slice(-2)+'.json').catch(function(){return null;}),load('x/nfl.json').catch(function(){return null;}),
        load('x/pedigree/'+y+'.json').catch(function(){return null;}),transferHtml(id,P).catch(function(){return '';})]).then(function(b){
        return playerHtml(id,P,d,i,b[0],b[1],b[2],seasons,cur,{comps:b[3],nfl:b[4],ped:b[5],tr:b[6]});});});});}
function schedFaced(TD,team){if(!TD)return '—';var rows=TD.teams,v=null,all=[];rows.forEach(function(r){if(M.ok(r[T.sos])){all.push(+r[T.sos]);if(r[T.id]===team)v=+r[T.sos];}});
  if(v===null)return '—';var p=M.pct(all,v,false);return M.nth(p)+' pct · '+(p>=60?'tougher':p<=40?'softer':'about average')+' <span style="font-weight:400;color:var(--muted)">(his team\'s)</span>';}
function historyRibbon(P,d,team){
  var sc=(P.bio&&P.bio.schools)||[],runs=[];
  sc.forEach(function(r){var last=runs[runs.length-1];if(last&&last.team===r[1])last.to=r[0];else runs.push({team:r[1],from:r[0],to:r[0],origin:r[3]});});
  if(!runs.length||runs[runs.length-1].team!==team)runs.push({team:team,from:d.season,to:d.season});
  if(runs[runs.length-1].to<d.season)runs[runs.length-1].to=d.season;
  var h='<div class="hist">';
  if(runs[0].origin)h+='<span class="s">'+esc(runs[0].origin)+'</span>'+arrow();
  runs.forEach(function(r,k){var on=r.team===team&&k===runs.length-1;
    if(k>0){if(r.origin&&r.origin!==tname(null,runs[k-1].team))h+='';h+=arrow();}
    h+='<span class="s'+(on?' c':'')+'"'+(on?' style="background:'+tcolor(d,team)+'"':'')+'>'+(r.from===r.to?r.from:r.from+'–'+String(r.to).slice(2))+' '+esc(TEAMK[r.team]?TEAMK[r.team][1]:tname(d,r.team))+'</span>';});
  if(runs.length>1||runs[0].origin)h+='<span class="lab">Transfer</span>';
  return h+'</div>';}
function arrow(){return '<svg aria-hidden="true" width="18" height="12" viewBox="0 0 18 12"><path d="M1 6h15M11 1l5 5-5 5" fill="none" stroke="#4E535B" stroke-width="2"/></svg>';}
function standing(A,id){
  if(!A)return [];var out=[],sfx=A.final?' · '+A.season:' · standing, week '+A.week;
  if(A.heisman[0]&&A.heisman[0].pid===id)out.push('Savant Heisman'+sfx);
  if(A.non_qb[0]&&A.non_qb[0].pid===id)out.push('Non-QB Player of the Year'+sfx);
  ['1','2','3'].forEach(function(t){if(A.national[t].some(function(r){return r.pid===id;}))out.push(['','1st','2nd','3rd'][+t]+'-team All-Savant'+sfx);});
  Object.keys(A.conference).forEach(function(c){if(A.conference[c].some(function(r){return r.pid===id;}))out.push('All-'+c+' Savant'+sfx);});
  if(A.freshman.some(function(r){return r.pid===id;}))out.push('Freshman All-Savant'+sfx);
  return out;}
function playerHtml(id,P,d,i,TF,TD,A,seasons,cur,X){
  var p=d.players[i],slot=p[C.slot],team=p[C.team],tc=tcolor(d,team),bio=P.bio||{},y=d.season,o={poolName:S.pool,adj:S.adj,gt:S.gt};
  var stats=M.statsFor(REG,slot),table=M.SLOT_TABLE[slot];
  var ros=TF?TF.roster.filter(function(r){return r[0]===id;})[0]:null;
  var home=bio.city?(bio.city+(bio.state?', '+bio.state:'')):(ros&&ros[9]?ros[9]+(ros[10]?', '+ros[10]:''):'—');
  var rec=bio.recruit?(bio.recruit[0]+'★'+(bio.recruit[1]?' · No. '+bio.recruit[1]+' in the '+bio.recruit[2]+' class':' · '+bio.recruit[2]+' class')):'No recruit record';
  var h='<div class="two"><section class="side" aria-label="Player">';
  h+='<div class="stk who tl" data-tilt><div class="top">'+hs(id,p[C.name],tc,96,p[C.head])+'<div style="min-width:0"><p class="pos">'+esc(slot)+(p[C.pos]&&p[C.pos]!==slot?' ('+esc(p[C.pos])+')':'')+(p[C.jersey]?' · #'+esc(p[C.jersey]):'')+(p[C.cls]?' · '+esc(p[C.cls]):'')+' · '+y+'</p><h2>'+esc(p[C.name])+'</h2><p class="tm"><span class="sw" style="background:'+tc+'"></span>'+logo(team)+'<a href="'+tlink(team,y)+'">'+esc(tname(d,team))+'</a> · '+esc(tconf(d,team))+'</p></div></div><div class="gr"></div>';
  h+='<dl><div><dt>Ht / Wt</dt><dd>'+ht(p[C.ht])+' · '+(p[C.wt]||'—')+'</dd></div><div><dt>Hometown</dt><dd>'+esc(home)+'</dd></div><div><dt>Recruit</dt><dd>'+esc(rec)+'</dd></div><div><dt>Schedule faced</dt><dd>'+schedFaced(TD,team)+'</dd></div></dl>';
  h+=historyRibbon(P,d,team);
  if(p[C.inferred])h+='<p class="note" style="margin-top:10px">Position: the roster lists him as '+esc(p[C.pos]||'no position')+'; '+esc(slot)+' is read from his size and the plays he makes.</p>';
  if(bio.nfl)h+='<p style="margin:12px 0 0;font-size:14px"><a href="/football-savant.html#p='+encodeURIComponent(bio.nfl[0])+(bio.nfl[1]?'&s='+bio.nfl[1]:'')+'">His NFL card on Football Savant ↗</a></p>';
  h+='</div>';
  var acc=standing(A,id).map(function(t){return t;});
  (P.honours||[]).forEach(function(r){if(r[0]!==y||!(A&&A.final))if(r[0]!==y)acc.push(r[2]+' · '+r[0]);});
  if(acc.length){h+='<div class="acc">';acc.slice(0,8).forEach(function(t,k){h+='<div class="badge '+(k%2?'tl2':'tr')+'" data-tilt><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.1l1.5-7L2 9.3l7-.8z" fill="none" stroke="#0B1730" stroke-width="2" stroke-linejoin="round"/></svg><span>'+esc(t)+'</span></div>';});h+='</div>';}
  var pl=M.pool(d,REG,i,S.pool),plabel=M.poolLabel(pl,p,{adj:S.adj,season:y,conf:tconf(d,team),reg:REG});
  h+='<div class="pnl"><h3>How to read the bars</h3><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.45"><li>Each bar is his percentile '+esc(plabel.replace(/^vs /,'against ').replace(/, (opponent-adjusted|raw), \d+$/,''))+' that season. Higher is always better; a stat where lower is better is flipped and says so.</li><li>The thin dark tick is where he would sit before the opponent adjustment.</li><li>Striped bars have not reached their settle point, or are noisy in any one season. The diamond marks where the stat is likely to land.</li><li>CONTEXT rows show how much, not how good.</li><li>Seasons are never pooled: a 2016 bar is against 2016.</li></ul></div>';
  h+='</section><div class="wide" style="display:flex;flex-direction:column;gap:28px"><section class="stk" aria-label="Percentiles">';
  var q=REG.qual[slot],qn=q?M.sample(d,q[0],i,true):null;
  h+='<div class="band"><h2>'+y+' Percentile Rankings</h2><span class="lab">'+esc(asof(d))+(qn!=null?' · '+Math.round(qn)+' '+esc(sampleName(q[0])):'')+'</span></div>';
  h+='<div class="ctl" role="group" aria-label="Percentile controls">';
  [['pos','vs FBS '+slot+'s'],['p4','Power 4 only'],['conf',esc(tconf(d,team))+' only']].forEach(function(x){h+='<button class="btn" data-pool="'+x[0]+'" aria-pressed="'+(S.pool===x[0])+'">'+x[1]+'</button>';});
  h+='<button class="btn" data-adj="1" aria-pressed="'+S.adj+'">Adjusted</button><button class="btn" data-adj="0" aria-pressed="'+!S.adj+'">Raw</button>';
  h+='<button class="btn" data-gt="'+(S.gt?0:1)+'" aria-pressed="'+S.gt+'">Garbage time '+(S.gt?'in':'out')+'</button>';
  h+='<label class="vh" for="pseason">Season</label><select class="btn" id="pseason">'+seasons.slice().reverse().map(function(s){return '<option value="'+s+'"'+(s===y?' selected':'')+'>Season: '+s+'</option>';}).join('')+'</select></div>';
  h+='<p class="poolline">POOL: '+esc(plabel)+', garbage time '+(S.gt?'included':'excluded')+' · '+pl.ids.length+' qualified players'+(pl.widened?' · '+esc(pl.widened):'')+'</p>';
  if(!p[C.qual]&&q)h+='<p class="poolline">He is under the qualifying sample ('+Math.round(q[1]*(d.scale||1))+' '+esc(sampleName(q[0]))+(d.scale<1?' at this point of the season':'')+'), so his bars show where his numbers would sit among qualified players.</p>';
  var vl=M.valueLine(d,i);
  if(vl)h+='<p class="valline"><b>'+sg(vl.value,1)+'</b> Savant value: expected points above a replacement '+esc(REG.slot_name[slot].replace(/s$/,''))+', opponent-adjusted'+(vl.rank?' · '+M.nth(vl.rank)+' of '+vl.of+' qualified '+esc(REG.slot_name[slot]):'')+'.</p>';
  var pf=M.profile(d,REG,i,o);
  if(pf)h+='<p class="valline"><b>'+pf.score+'</b> Profile score: the mean of his percentiles on the '+pf.n+' headline stats of a '+esc(REG.slot_name[slot].replace(/s$/,''))+' ('+M.headline(REG,slot).map(function(s){return esc(s.label);}).join(', ')+').</p>';
  h+=groupsHtml(M.cardGroups(REG,slot),d,i,o,true);
  var nr=M.sample(d,'returns',i,false);
  if(nr){var rp=M.retPool(d,REG);h+='<div class="band sub"><h2>Returner</h2><span class="lab">'+Math.round(nr)+' returns · POOL: vs FBS returners with '+Math.round(REG.qual.RET[1]*(d.scale||1))+'+ returns, raw, '+y+' · '+rp.ids.length+' qualified</span></div>';
    h+=groupsHtml(M.cardGroups(REG,'RET'),d,i,o,false);}
  var isD=table==='dfn';
  var cs=REG.cant_see&&REG.cant_see[M.cardKey(slot)];
  if(cs&&cs.length)h+='<div class="pad"><details class="ex"><summary>What the page can\'t see</summary><ul class="cant">'+cs.map(function(c){return '<li><strong>'+esc(c[0])+'</strong>: '+esc(c[1])+'</li>';}).join('')+'</ul></details></div>';
  h+='<div class="pad">'+(isD?'<p class="note">'+esc(REG.defender_note)+'</p>':'')+(isD&&y<2024?'<p class="note" style="margin-top:8px"><strong>'+esc(REG.pre_box_warning)+(REG.no_tacklers.indexOf(y)>=0?' '+esc(REG.early_def_note):'')+'</strong></p>':'')+'<p class="note" style="margin-top:8px">Sources: ESPN play-by-play and box scores; WCE\'s own expected-points model and opponent adjustment. FBS-vs-FBS games only.</p></div></section>';
  /* splits, game log, career */
  var rows=TF&&TF.logs[String(id)],cols=REG.logcols[table];
  if(rows&&rows.length){
    var sp=M.splits(rows,TF.sched,cols,table);
    h+='<section class="stk sm"><div class="band"><h2>Splits</h2><span class="lab">'+y+' · raw totals, garbage time included</span></div><div class="scroll"><table class="t"><thead><tr><th class="pin">Split</th>'+sp[0].line.map(function(c){return '<th class="n">'+esc(c[0])+'</th>';}).join('')+'</tr></thead><tbody>';
    sp.forEach(function(x){h+='<tr><td class="pin"><strong>'+esc(x.label)+'</strong></td>'+x.line.map(function(c){return '<td class="n">'+esc(c[1])+'</td>';}).join('')+'</tr>';});
    h+='</tbody></table></div><p class="note pad">"Our top 25" is the top 25 of WCE\'s power rating '+(d.final?'at season\'s end':'today')+'. Small splits are a few games: read them as a record of what happened, not a skill.</p></section>';
    h+='<section class="stk sm"><div class="band"><h2>Game Log</h2><span class="lab">'+y+' · FBS opponents</span></div><div class="scroll"><table class="t"><thead><tr><th class="pin">Date</th><th>Opponent</th><th>Result</th>'+M.line(table,M.total([rows[0]],cols)).slice(1).map(function(c){return '<th class="n">'+esc(c[0])+'</th>';}).join('')+'</tr></thead><tbody>';
    rows.forEach(function(r){var g=TF.sched[r[0]],won=g[SC.pf]>g[SC.pa];
      h+='<tr><td class="pin fig">'+esc(day(g[SC.date]).replace(/, \d+$/,''))+'</td><td>'+(g[SC.site]===-1?'at ':'vs ')+'<a href="'+tlink(g[SC.opp],y)+'">'+esc(tname(d,g[SC.opp]))+'</a>'+(M.ok(g[SC.opp_rank])&&g[SC.opp_rank]<=25?' <span class="lab" style="color:var(--muted)">#'+g[SC.opp_rank]+'</span>':'')+(g[SC.site]===0?' <span class="lab" style="color:var(--muted)">neutral</span>':'')+'</td><td class="fig">'+(g[SC.final]?(won?'W ':'L ')+g[SC.pf]+'-'+g[SC.pa]:'')+'</td>'+M.line(table,M.total([r],cols)).slice(1).map(function(c){return '<td class="n">'+esc(c[1])+'</td>';}).join('')+'</tr>';});
    h+='</tbody></table></div></section>';}
  var career=P.seasons.slice();
  if(rows&&y===IDX.current&&!career.some(function(r){return r[0]===y;})){var tt=M.total(rows,cols);career.push([y,team,slot,p[C.cls],p[C.gp],p[C.qual],vl?vl.value:null,vl?vl.rank:null,vl?vl.of:null,cols.map(function(c){return tt[c];})]);}
  if(career.length){
    var same=career.filter(function(r){return M.SLOT_TABLE[r[2]]===table;});
    var hdr=same.length?M.line(table,asTot(same[0][9],cols,same[0][4])).slice(1):[];
    h+='<section class="stk sm"><div class="band"><h2>Career</h2><span class="lab">across schools · since 2009</span></div><div class="scroll"><table class="t"><thead><tr><th class="pin">Season</th><th>School</th><th>Pos</th><th class="n">G</th><th class="n">Savant value</th><th class="n">Rank at pos</th>'+hdr.map(function(c){return '<th class="n">'+esc(c[0])+'</th>';}).join('')+'</tr></thead><tbody>';
    career.forEach(function(r){var sameT=M.SLOT_TABLE[r[2]]===table,ln=sameT?M.line(table,asTot(r[9],cols,r[4])).slice(1):hdr.map(function(){return ['','—'];});
      h+='<tr><td class="pin fig"><a href="'+plink(id,r[0])+'">'+r[0]+'</a></td><td><a href="'+tlink(r[1],r[0])+'">'+esc(TEAMK[r[1]]?TEAMK[r[1]][1]:tname(d,r[1]))+'</a></td><td>'+esc(r[2])+(r[3]?' · '+esc(r[3]):'')+'</td><td class="n">'+r[4]+'</td><td class="n">'+(r[6]==null?'—':sg(r[6],1))+'</td><td class="n">'+(r[7]?r[7]+' of '+r[8]:'—')+'</td>'+ln.map(function(c){return '<td class="n">'+esc(c[1])+'</td>';}).join('')+'</tr>';});
    h+='</tbody></table></div><p class="note pad">Games are FBS-vs-FBS games in which he recorded a play. Rank is among qualified players at his position that season.</p></section>';}
  h+=traj(P,y);
  var cm=M.comps(d,REG,i,6);
  if(cm.length){h+='<section class="sec"><div class="rule"><h3>Nearest players, '+y+'</h3></div><p class="note lt">Qualified '+esc(REG.slot_name[slot])+(cm[0].sameClass&&p[C.cls]?' in the same class ('+esc(p[C.cls])+')':'')+' whose percentile bars sit closest to his. A likeness of shape this season, not a projection.</p><div class="cards">';
    cm.forEach(function(c,k){var q2=d.players[c.i];h+=pcard(d,{pid:q2[C.id],team:q2[C.team],slot:q2[C.slot],value:d.value.v[c.i],name:q2[C.name],head:q2[C.head]},k,Math.round(100-c.distance)+' match');});h+='</div></section>';}
  h+=extrasHtml(id,P,d,i,X||{});
  h+=explain(REG,slot,y);
  return h+'</div></div>';}
function asTot(arr,cols,g){var t={g:g};cols.forEach(function(c,k){t[c]=arr[k];});return t;}
function sampleName(k){return {plays:'plays',rush:'rushes',tgt:'targets',dplays:'team defensive plays',fga:'field-goal attempts',punts:'punts',returns:'returns'}[k]||k;}

/* ---------- teams ---------- */
var TCOLS_SHOW=[['rating','Power','pts vs avg FBS',1],['off','Off','',1],['def','Def','',1],['st','ST','',1],['resume_rank','Résumé','rank',0],['sos','Schedule','tougher is higher',0],['off_epa','Off EPA/play','efficiency',0,1],['def_epa','Def EPA/play','lower is better',0,1],['off_sr','Off success','',0,1],['def_sr','Def success','lower is better',0,1],['off_expl','Explosiveness','EPA per successful play',0,1],['off_fp','Start field pos.','yards to go',0,1],['off_ppo','Pts per trip','inside the 40',0,1],['def_havoc','Havoc','',0,1],['pace','Pace','plays per game',0,1],['to_margin','TO margin','LUCK',0,1],['talent_rank','Talent','rank',0],['ret_off','Returning off.','share',0],['ret_def','Returning def.','share',0]];
function vTeams(){
  return load('teams/'+S.season+'.json').then(function(D){
    var ts=REG.team_stats,by={};ts.forEach(function(s){by[s.key]=s;});
    var rows=D.teams.map(function(r,i){return {r:r,i:i};});
    var confs=[];rows.forEach(function(x){if(confs.indexOf(x.r[T.conf])<0)confs.push(x.r[T.conf]);});confs.sort();
    if(S.tConf)rows=rows.filter(function(x){return x.r[T.conf]===S.tConf;});
    function get(x,k){if(k in T)return x.r[T[k]];var c=D.values[k];if(!c)return null;return (S.tAdj&&c.a?c.a:c.r)[x.i];}
    var key=S.tSort,dir=S.tDir;
    rows.sort(function(a,b){var u=get(a,key),v=get(b,key);if(u==null)return 1;if(v==null)return -1;return dir*(u-v)||a.r[T.school].localeCompare(b.r[T.school]);});
    var h='<section class="stk"><div class="band"><h2>All Teams · '+D.season+'</h2><span class="lab">'+esc(asof(D))+' · '+rows.length+' teams</span></div><div class="ctl"><button class="btn" data-tadj="1" aria-pressed="'+S.tAdj+'">Adjusted</button><button class="btn" data-tadj="0" aria-pressed="'+!S.tAdj+'">Raw</button><label class="vh" for="tconf">Conference</label><select class="btn" id="tconf"><option value="">All of FBS</option>'+confs.map(function(c){return '<option'+(c===S.tConf?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select></div>';
    h+='<p class="poolline">Ranked against all FBS teams, '+D.season+'. '+(S.tAdj?'Efficiency stats are opponent-adjusted where the backtest found the adjustment predicts better.':'Raw, before any opponent adjustment.')+' Garbage time excluded.</p><div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th class="n">#</th><th class="pin">Team</th><th>Record</th>';
    TCOLS_SHOW.forEach(function(c){var on=key===c[0];h+='<th class="n"'+(on?' aria-sort="'+(dir<0?'descending':'ascending')+'"':'')+'><button data-tsort="'+c[0]+'">'+esc(c[1])+'</button>'+(c[2]?'<small>'+esc(c[2])+'</small>':'')+'</th>';});
    h+='</tr></thead><tbody>';
    rows.forEach(function(x,n){var r=x.r,tc=tcolor({teams:teamsMap(D)},r[T.id]);
      h+='<tr><td class="n">'+(n+1)+'</td><td class="pin"><span class="chip" style="background:'+tc+'"></span>'+logo(r[T.id])+'<a href="'+tlink(r[T.id],D.season)+'"><strong>'+esc(r[T.school])+'</strong></a> <span class="lab" style="color:var(--muted)">'+esc(r[T.conf])+'</span></td><td class="fig">'+r[T.w]+'-'+r[T.l]+' <span style="color:var(--muted)">('+r[T.cw]+'-'+r[T.cl]+')</span></td>';
      TCOLS_SHOW.forEach(function(c){var v=get(x,c[0]),s=by[c[0]],t;
        if(v==null)t='—';else if(s)t=M.display(s,v);else if(c[0]==='sos')t=(100*v).toFixed(0)+'%';else if(c[0]==='ret_off'||c[0]==='ret_def')t=(100*v).toFixed(0)+'%';else if(c[3])t=sg(v,1);else t=String(v);
        h+='<td class="n">'+t+'</td>';});
      h+='</tr>';});
    h+='</tbody></table></div><div class="pad"><p class="note">Power is WCE\'s rating in points per game against an average FBS team, split into offense, defense and special teams. Résumé is the playoff résumé rank: wins and losses against the schedule, never margin. Schedule is how often the bubble team (the 12th-best by power) would have lost these games. Turnover margin behaves like luck: it takes about 33 games to be half signal. Talent is WCE\'s own, computed from the recruiting stars and class ranks of the players on each roster. Returning is the share of last season\'s offensive touches and tackles still on the roster. Tap a column to sort.</p></div></section>';
    h+='<section class="stk sm"><div class="pad"><h3 style="font-size:24px;color:var(--field)">What each team stat means</h3>';
    var gs=[];ts.forEach(function(s){if(gs.indexOf(s.group)<0)gs.push(s.group);});
    gs.forEach(function(g){h+='<details class="ex"><summary>'+esc(g)+'</summary>';ts.filter(function(s){return s.group===g;}).forEach(function(s){h+='<div class="exi"><strong>'+esc(s.label)+'.</strong> '+esc(s.what)+'<div class="meta">'+(s.verdict==='luck'?'Labeled luck. ':s.verdict==='context'?'Context. ':s.verdict==='hatched'?'Noisy early in a season. ':'')+(s.adj?'Opponent-adjusted. ':'')+'Source: ESPN play-by-play and team box scores, valued by WCE\'s expected-points model. From 2014.</div></div>';});h+='</details>';});
    return h+'</div></section>';});}
function teamsMap(D){if(!D._m){D._m={};D.teams.forEach(function(r){var k=TEAMK[r[T.id]];D._m[String(r[T.id])]=[r[T.school],r[T.abbr],r[T.conf],k?k[6]:null,k?k[7]:null,k?k[5]:null];});}return D._m;}
function vTeam(id,want){
  var y=want||S.season;
  return Promise.all([load('t/'+y+'/'+id+'.json'),load('teams/'+y+'.json'),load('s/'+y+'.json'),y>=2021?load('x/haul/'+y+'.json').catch(function(){return null;}):Promise.resolve(null)]).then(function(a){
    var F=a[0],D=a[1],d=a[2],HL=a[3],ti=-1;D.teams.forEach(function(r,k){if(r[T.id]===id)ti=k;});
    var r=D.teams[ti],tc=tcolor(d,id);
    var h='<div class="two"><section class="side"><div class="stk who tl" data-tilt><div class="top"><span class="hs" style="width:96px;height:96px;background:#fff;border-color:'+tc+'"><img src="'+LOGO+id+'.png" alt="" style="object-fit:contain;object-position:center;padding:10px;background:#fff" onerror="this.remove()"></span><div style="min-width:0"><p class="pos">'+esc(F.conf)+' · '+y+'</p><h2>'+esc(F.name)+'</h2><p class="tm"><span class="sw" style="background:'+tc+'"></span>'+r[T.w]+'-'+r[T.l]+' ('+r[T.cw]+'-'+r[T.cl]+' in conference)</p></div></div><div class="gr"></div>';
    h+='<dl><div><dt>Power rating</dt><dd>'+sg(r[T.rating],1)+' · '+M.nth(r[T.rating_rank])+'</dd></div><div><dt>Résumé rank</dt><dd>'+(r[T.resume_rank]?M.nth(r[T.resume_rank]):'—')+'</dd></div><div><dt>Offense / Defense / ST</dt><dd>'+sg(r[T.off],1)+' / '+sg(r[T.def],1)+' / '+sg(r[T.st],1)+'</dd></div><div><dt>Team talent</dt><dd>'+(r[T.talent_rank]?M.nth(r[T.talent_rank])+' <span style="font-weight:400;color:var(--muted)">from recruiting stars</span>':'—')+'</dd></div></dl>';
    if(F.coach&&F.coach.length)h+='<p style="margin:14px 0 0;font-size:14px">Head coach: <strong>'+esc(F.coach[0])+'</strong>'+(F.coach.length>1?' (also '+esc(F.coach.slice(1).join(', '))+')':'')+'</p>';
    if(F.ol)h+='<p style="margin:8px 0 0;font-size:14px">Offensive line, as a unit: <strong>'+sg(F.ol.value,1)+'</strong> points ('+M.nth(F.ol.rank)+' of '+F.ol.of+'), '+sg(F.ol.pass_pro,1)+' in pass protection and '+sg(F.ol.run_block,1)+' in run blocking.</p>';
    h+='<p style="margin:12px 0 0;font-size:14px"><a href="#playoff'+(y!==IDX.current?'/'+y:'')+'">Playoff field</a> · <a href="#teams'+(y!==IDX.current?'/'+y:'')+'">All teams</a></p></div>';
    h+='<div class="pnl"><h3>Reading this page</h3><p style="margin:0;font-size:14px">Bars are '+esc(F.name)+'\'s percentile among all FBS teams in '+y+', '+(S.tAdj?'opponent-adjusted where the backtest found it predicts better':'raw')+', garbage time excluded. Defense is flipped so higher is always better. Striped bars are noisy early in a season. Pregame win chances come from the power ratings as they stood before each game.</p></div></section>';
    h+='<div class="wide" style="display:flex;flex-direction:column;gap:28px">';
    /* schedule */
    h+='<section class="stk sm"><div class="band"><h2>Schedule</h2><span class="lab">'+esc(asof(D))+' · our pregame win chance</span></div><div class="scroll"><table class="t"><thead><tr><th class="pin">Date</th><th>Opponent</th><th>Result</th><th class="n">Win chance</th><th class="n">Opp. power rank</th></tr></thead><tbody>';
    F.sched.forEach(function(g){var won=g[SC.pf]>g[SC.pa],opn=g[SC.opp_name]||tname(d,g[SC.opp]),fb=!g[SC.opp_name];
      h+='<tr><td class="pin fig">'+esc(day(g[SC.date]).replace(/, \d+$/,''))+'</td><td>'+(g[SC.site]===-1?'at ':'vs ')+(fb?'<a href="'+tlink(g[SC.opp],y)+'">'+esc(opn)+'</a>':esc(opn)+' <span class="lab" style="color:var(--muted)">FCS</span>')+(g[SC.conf]?' <span class="lab" style="color:var(--muted)">conf</span>':'')+(g[SC.site]===0?' <span class="lab" style="color:var(--muted)">neutral</span>':'')+'</td><td class="fig">'+(g[SC.final]?'<strong>'+(won?'W':'L')+'</strong> '+g[SC.pf]+'-'+g[SC.pa]:'<span style="color:var(--muted)">week '+g[SC.week]+'</span>')+'</td><td class="n">'+M.chance(g[SC.wp])+'</td><td class="n">'+(g[SC.opp_rank]||'—')+'</td></tr>';});
    h+='</tbody></table></div></section>';
    /* team bars */
    h+='<section class="stk"><div class="band"><h2>'+y+' Team Percentiles</h2><span class="lab">vs all FBS teams</span></div><div class="ctl"><button class="btn" data-tadj="1" aria-pressed="'+S.tAdj+'">Adjusted</button><button class="btn" data-tadj="0" aria-pressed="'+!S.tAdj+'">Raw</button></div><p class="poolline">POOL: vs all '+D.teams.length+' FBS teams, '+(S.tAdj?'opponent-adjusted':'raw')+', garbage time excluded, '+y+'</p>';
    var gs=[];REG.team_stats.forEach(function(s){if(gs.indexOf(s.group)<0)gs.push(s.group);});
    gs.forEach(function(g){h+='<div class="grp"><div class="hd"><h3>'+esc(g)+'</h3>'+(g==='Turnovers'?'<span class="ctx">LUCK</span>':'')+'</div><div class="rows">';
      REG.team_stats.filter(function(s){return s.group===g;}).forEach(function(s){var x=M.teamRow(D,s,ti,S.tAdj);
        var rr=s.start&&y<s.start?{tracked:false,reason:'not tracked before '+s.start}:x?{tracked:true,pct:x.pct,shown:x.shown,hatched:s.verdict==='hatched'||s.verdict==='luck'}:{tracked:true,none:true,reason:'no value'};
        var st={label:s.label,lower:s.lower,verdict:s.verdict==='luck'?'context':s.verdict,note:'',tier:s.tier};
        h+=prow(st,rr,g==='Turnovers'?'Context':g);});
      h+='</div></div>';});
    h+='<div class="pad"><p class="note">Turnovers and fumble recoveries are labeled luck: they barely repeat from one half of a season to the other. CHARTED rows come from ESPN\'s charted play text, tracked from 2025 week 9. Fourth-down choices are judged by WCE\'s own model: expected points, and win probability in the last 15 minutes of a game within 16 points.</p></div></section>';
    var hl=HL&&HL.teams[String(id)];
    if(hl){var nm=function(r){var q=d.players.filter(function(p){return p[C.id]===r[0];})[0];return '<a href="'+plink(r[0],y)+'">'+esc(q?q[C.name]:'Player '+r[0])+'</a> '+sg(r[1],1);};
      h+='<section class="stk sm"><div class="band"><h2>Portal haul</h2><span class="lab">'+y+' · Savant value</span></div><div class="pad"><p style="margin:0 0 8px;font-size:15px">In: <b>'+sg(hl['in'],1)+'</b> from '+hl.n_in+' transfer'+(hl.n_in===1?'':'s')+' · Out: <b>'+sg(hl.out,1)+'</b> from '+hl.n_out+' who left · Net <b>'+sg(hl['in']-hl.out,1)+'</b></p>'+(hl.top_in.length?'<p style="margin:0 0 6px;font-size:14px">Best arrivals: '+hl.top_in.map(nm).join(', ')+'</p>':'')+(hl.top_out.length?'<p style="margin:0 0 6px;font-size:14px">Best departures (at their new schools): '+hl.top_out.map(nm).join(', ')+'</p>':'')+'<p class="note">'+esc(HL.note)+'</p></div></section>';}
    /* roster strip and depth */
    var gr=F.roster.filter(function(p){return p[11]!=null;}).sort(function(a,b){return (b[12]||-99)-(a[12]||-99);});
    h+='<section class="stk sm"><div class="band"><h2>Roster</h2><span class="lab">'+F.roster.length+' players · sorted by Savant value</span></div><div class="strip">';
    gr.slice(0,30).forEach(function(p){h+='<a href="'+plink(p[0],y)+'">'+hs(p[0],p[1],tc,64,p[8])+'<b>'+esc(p[1])+'</b><small>'+esc(p[3]||p[2]||'')+(p[12]!=null?' · '+sg(p[12],1):'')+'</small></a>';});
    h+='</div><div class="pad"><h3 style="font-size:20px;color:var(--field);margin-bottom:10px">Depth by usage</h3><div class="depth">';
    REG.slots.forEach(function(sl){var ps=F.roster.filter(function(p){return p[3]===sl&&p[11]!=null;}).sort(function(a,b){return b[11]-a[11];});if(!ps.length)return;
      var q=REG.qual[sl];h+='<div><h4>'+esc(REG.slot_name[sl])+' · '+esc(q?sampleName(q[0]):'')+'</h4>';ps.slice(0,sl==='WR'?6:sl==='QB'||sl==='K'||sl==='P'?2:4).forEach(function(p){h+='<a href="'+plink(p[0],y)+'">'+esc(p[1])+'<span>'+Math.round(p[11])+'</span></a>';});h+='</div>';});
    var olp=F.roster.filter(function(p){return p[3]==='OL';});
    if(olp.length)h+='<div><h4>offensive line · graded as a unit</h4>'+olp.slice(0,8).map(function(p){return '<a>'+esc(p[1])+'<span>'+esc(p[5]||'')+'</span></a>';}).join('')+'</div>';
    h+='</div><p class="note" style="margin-top:12px">No free source tracks snaps, so depth is by plays credited: dropbacks and runs, carries, targets, and for defenders their team\'s defensive plays in games they made a play.</p></div></section>';
    return h+'</div></div>';});}

/* ---------- playoff ---------- */
function vPlayoff(){
  return Promise.all([load('playoff/'+S.season+'.json'),load('s/'+S.season+'.json')]).then(function(a){
    var P=a[0],d=a[1],cur=!!P.odds,seed={},rowOf={};
    P.field.forEach(function(f){seed[f.seed]=f;});P.table.forEach(function(r){rowOf[r[0]]=r;});
    function nm(t){return esc(tname(d,t));}
    var h='<section class="sec"><div class="rule"><h2>The Bracket</h2></div><p class="note lt">'+(cur?'If the season ended today. '+P.season+', '+esc(asof(P))+'. Until the title games are played, each conference\'s current leader holds its champion\'s place.':'The '+P.season+' season under the 2026 rules, with the conference champions that season had. This is our field, not the one that was played.')+'</p><div class="brk"><div class="byes"><h3>FIRST-ROUND BYES · SEEDS 1–4</h3>';
    [[1,'8 / 9 winner'],[2,'7 / 10 winner'],[3,'6 / 11 winner'],[4,'5 / 12 winner']].forEach(function(x,k){var f=seed[x[0]];
      h+='<div class="stk sm bye '+tilt(k)+'" data-tilt><span class="sd">'+f.seed+'</span><span class="chip" style="height:30px;width:14px;background:'+tcolor(d,f.team)+'"></span><div style="min-width:0"><a class="nm" style="color:var(--ink);text-decoration:none" href="'+tlink(f.team,P.season)+'">'+logo(f.team)+nm(f.team)+'</a><small>'+esc(f.how)+' · '+f.w+'-'+f.l+'</small></div><span class="mt">meets<br>'+x[1]+'</span></div>';});
    h+='</div><div class="fr"><h3>FIRST ROUND · HIGHER SEED HOSTS</h3><div class="frg">';
    [[5,12,4],[8,9,1],[6,11,3],[7,10,2]].forEach(function(m,k){h+='<div class="stk sm gm '+tilt(k+1)+'" data-tilt><div class="lb">AT NO. '+m[0]+' · WINNER MEETS NO. '+m[2]+'</div>';
      [m[0],m[1]].forEach(function(s){var f=seed[s];h+='<div class="tm"><span class="sd">'+s+'</span><span class="chip" style="height:24px;width:10px;background:'+tcolor(d,f.team)+'"></span><a class="nm" style="color:var(--ink);text-decoration:none" href="'+tlink(f.team,P.season)+'">'+nm(f.team)+'</a><span class="fig" style="font-size:12px;color:var(--muted)">'+f.w+'-'+f.l+'</span></div>';});
      h+='</div>';});
    h+='</div></div></div>';
    var low=P.field.filter(function(f){return f.rank>12;}),fo=P.first_out[0],fr=rowOf[fo];
    h+='<div class="badge red tl2" data-tilt style="display:block;max-width:760px;font-size:22px">First out: '+nm(fo)+', ranked '+M.nth(fr[1])+'<p style="margin:6px 0 0;font:400 14px/1.45 var(--font);text-transform:none;letter-spacing:0">'+(low.length?low.map(function(f){return nm(f.team)+' ('+esc(f.how)+', ranked '+M.nth(f.rank)+')';}).join(' and ')+' qualif'+(low.length>1?'y':'ies')+' automatically from outside the top 12 and drop'+(low.length>1?'':'s')+' in at the bottom. That pushes out the lowest-ranked at-large team'+(low.length>1?'s':'')+'.':'Every automatic qualifier ranks inside the top 12, so the field is simply the top 12 and '+nm(fo)+' is the next team.')+' Next out: '+P.first_out.slice(1).map(nm).join(', ')+'.</p></div></section>';
    if(cur){h+='<section class="sec"><div class="rule"><h2>Conference leaders</h2></div><p class="note lt">Who would play for each title today. The Power 4 follow their published tiebreakers; a seat that needed one is marked, and where a rulebook calls for a number that is not public (SportSource\'s ranking) our power rating stands in for it and the seat is marked as such.</p><div class="cards">';
      Object.keys(P.leaders).forEach(function(c,k){var L=P.leaders[c],p4=REG.power4.indexOf(c)>=0,notes=[];
        Object.keys(L.how||{}).forEach(function(t){var x=L.how[t];if(x)notes.push(nm(+t)+'\'s place rests on a tiebreaker: '+esc(x.name)+(x.tied_with.length?' (level with '+x.tied_with.map(nm).join(', ')+')':''));});
        h+='<div class="stk sm" style="padding:12px 14px"><div class="lab" style="color:var(--muted)">'+esc(c)+(p4?' · automatic bid':'')+'</div><div style="font-weight:700;margin-top:4px">'+logo(L.first)+nm(L.first)+' <span style="font-weight:400;color:var(--muted)">v</span> '+nm(L.second)+'</div>'+(notes.length?'<p class="note" style="margin-top:6px"><span class="tag" style="background:var(--sticker);color:var(--field)">Tiebreaker</span> '+notes.join('. ')+'.</p>':'<p class="note" style="margin-top:6px">'+(L.set?'The title game is set.':'No tiebreaker needed today.')+'</p>')+'</div>';});
      h+='</div></section>';}
    h+='<section class="stk"><div class="band"><h2>The Résumé Ranking</h2><span class="lab">'+(cur?'odds from '+P.sims.toLocaleString()+' simulated seasons':P.season+' · final')+'</span></div><div class="scroll"><table class="t" style="min-width:'+(cur?900:640)+'px"><thead><tr><th class="n">Rk</th><th class="pin">Team</th><th>Record</th><th class="n">Résumé<small>bubble team matches it</small></th><th class="n">Power<small>pts vs avg FBS</small></th><th class="n">Schedule<small>bubble team loses</small></th>'+(cur?'<th>Makes field</th><th class="n">Bye</th><th class="n">Hosts</th><th class="n">Wins conf.</th>':'')+'<th>Bid'+(cur?' today':'')+'</th></tr></thead><tbody>';
    var inF={};P.field.forEach(function(f){inF[f.team]=f;});
    var show=P.table.filter(function(r,k){return k<40||inF[r[0]]||(cur&&P.odds[r[0]]&&P.odds[r[0]][0]>=0.005);});
    show.forEach(function(r){var f=inF[r[0]],o=cur?P.odds[r[0]]:null,tag,ts;
      if(f){if(/champion/.test(f.how)){tag=cur?'P4 leader':'P4 champion';ts='background:var(--field);color:#fff';}else if(/Group of Six/.test(f.how)){tag='G6 bid';ts='background:var(--sticker);color:var(--field)';}else if(/Notre Dame/.test(f.how)){tag='Notre Dame';ts='background:var(--gold);color:var(--field)';}else{tag='At-large';ts='background:var(--banner);color:#fff';}}
      else if(r[0]===fo){tag='First out';ts='background:var(--red);color:#fff';}else{tag='Out';ts='background:var(--track);color:var(--muted)';}
      h+='<tr'+(f?'':' class="dim"')+'><td class="n"><span class="rk">'+r[1]+'</span></td><td class="pin"><span class="chip" style="background:'+tcolor(d,r[0])+'"></span>'+logo(r[0])+'<a href="'+tlink(r[0],P.season)+'"><strong>'+nm(r[0])+'</strong></a> <span class="lab" style="color:var(--muted)">'+esc(tconf(d,r[0]))+'</span></td><td class="fig">'+r[2]+'-'+r[3]+'</td><td class="n"><strong>'+(100*r[4]).toFixed(1)+'%</strong></td><td class="n">'+sg(r[5],1)+'</td><td class="n">'+(r[7]==null?'—':(100*r[7]).toFixed(0)+'%')+'</td>';
      if(cur){var pf=o?Math.round(100*o[0]):0;h+='<td><div class="odds"><i><b style="width:'+pf+'%;background:'+(pf>=70?'var(--hi)':pf>=40?'var(--mid)':'var(--lo)')+'"></b></i><span class="fig">'+M.chance(o?o[0]:0)+'</span></div></td><td class="n">'+M.chance(o?o[1]:0)+'</td><td class="n">'+M.chance(o?o[2]:0)+'</td><td class="n">'+M.chance(o?o[3]:0)+'</td>';}
      h+='<td><span class="tag" style="'+ts+'">'+tag+'</span></td></tr>';});
    h+='</tbody></table></div><div class="pad"><p class="note"><strong>Margin never enters the résumé score.</strong> It counts wins and losses only: the chance that a bubble team (the 12th-best by our power rating, '+sg(P.bubble,1)+' points) would have won at least this many games against the same schedule. Lower is better; ties break on the power rating, which is shown for context. A Power 4 champion is in whatever its record: one ranked outside the top 12 takes the bottom seeds, and the lowest-ranked at-large team makes way. '+(cur?'Odds are the share of '+P.sims.toLocaleString()+' simulated seasons in which a team makes the field, earns a bye (seeds 1 to 4), hosts a first-round game (seeds 5 to 8) or wins its conference; each simulated season plays out the remaining schedule from the power ratings and sends each Power 4 league\'s top two to its title game by the league\'s own tiebreakers. The model\'s view, not a verdict.':'Past fields are history under today\'s rules, not a claim about what the committee should have done.')+' No committee ranking is used anywhere on this page.</p></div></section>';
    h+='<section class="rules"><h2>The 2026 rules we apply</h2>';
    var titles=['Twelve teams','Group of Six','Notre Dame','At-large','Seeding','Earlier power conferences'];
    P.rules.forEach(function(t,k){h+='<div class="pnl"><h3>'+titles[k]+'</h3><p>'+esc(t)+'</p></div>';});
    return h+'</section>';});}

/* ---------- All-Savant ---------- */
var DSPOTS=[['S',34,20],['S',66,20],['CB',8,130],['CB',92,130],['DB',21,200],['LB',38,200],['LB',50,200],['LB',62,200],['EDGE',24,372],['IDL',41,372],['IDL',59,372],['EDGE',76,372]];
var OSPOTS=[['WR',8,580],['WR',22,620],['OL',50,576,300],['TE',72,580],['WR',92,580],['QB',50,760],['RB',38,930],['RB',62,930]];
function vAllSavant(){
  return Promise.all([load('allsavant/'+S.season+'.json'),load('s/'+S.season+'.json')]).then(function(a){
    var A=a[0],d=a[1],confs=Object.keys(A.conference).sort();
    if(!S.conf||confs.indexOf(S.conf)<0)S.conf=confs[0];
    var rows=S.set==='national'?A.national[S.tier]:S.set==='freshman'?A.freshman:A.conference[S.conf];
    var h='<section class="awards">';
    [['Savant Heisman',A.heisman[0],'var(--sticker)','var(--field)'],['Non-QB Player of the Year',A.non_qb[0],'var(--banner)','#fff']].forEach(function(x,k){var r=x[1];if(!r)return;
      h+='<div class="stk aw '+(k?'tr':'tl')+'" data-tilt><div class="hd" style="background:'+x[2]+';color:'+x[3]+'">'+x[0]+(A.final?'':' · '+esc(A.standing))+'</div><div class="bd">'+hs(r.pid,r.name,tcolor(d,r.team),88,r.head)+'<div style="min-width:0"><div class="lab" style="color:var(--muted)">'+esc(r.slot)+' · '+esc(tname(d,r.team))+'</div><a href="'+plink(r.pid,A.season)+'"><div class="nm">'+esc(r.name)+'</div></a><div class="fig" style="margin-top:6px;font-size:14px;font-weight:600">'+sg(r.value,1)+' <span style="font-weight:400;color:var(--muted)">points above replacement</span></div></div></div></div>';});
    h+='</section><section class="sec"><div class="rule"><h2>Lined up at the snap</h2></div><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center" role="group" aria-label="Which team">';
    [['national','National'],['conference','Conference'],['freshman','Freshman']].forEach(function(x){h+='<button class="btn dk" data-set="'+x[0]+'" aria-pressed="'+(S.set===x[0])+'">'+x[1]+'</button>';});
    if(S.set==='national')['1','2','3'].forEach(function(t){h+='<button class="btn dk" data-tier="'+t+'" aria-pressed="'+(S.tier===t)+'">'+['','1st','2nd','3rd'][+t]+' Team</button>';});
    if(S.set==='conference')h+='<label class="vh" for="asconf">Conference</label><select class="btn dk" id="asconf" style="background:var(--panel)">'+confs.map(function(c){return '<option'+(c===S.conf?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select>';
    [['field','Field'],['list','List']].forEach(function(x){h+='<button class="btn dk as-mob" data-asv="'+x[0]+'" aria-pressed="'+(S.asView===x[0])+'">'+x[1]+'</button>';});
    h+='</div><p class="note lt">'+A.season+', '+esc(A.final?'final':A.standing+': a standing, not yet an award')+'. Pure individual Savant value, no credit for team success; missed games and small roles cost value. The shape follows the AP All-America team, with the offensive line picked as one unit'+(S.set==='freshman'?'. Freshmen include redshirt freshmen; no line unit is named':'')+'.</p>';
    var used={};
    function take(slot){for(var k=0;k<rows.length;k++){if(used[k])continue;if(rows[k].slot===slot){used[k]=1;return rows[k];}}return null;}
    // every pick in one list, taken in the order the field fills (defense, offense, then special teams), so the
    // desktop field, the phone chips, the list and the bottom sheet all show the same men
    var PD=DSPOTS.map(function(sp){return {sp:sp,r:take(sp[0]),side:'d'};}),PO=OSPOTS.map(function(sp){return {sp:sp,r:take(sp[0]),side:'o'};});
    var PS=[['K','K'],['P','P'],['AP','AP']].map(function(x){return {sp:x,r:take(x[0]),side:'s'};});
    AS={A:A,d:d,picks:PD.concat(PO,PS)};
    var pi=0;
    function card(sp,band,k){var r=AS.picks[pi++].r;if(!r)return '';var isOL=r.slot==='OL',c=tcolor(d,r.team),nm=isOL?tname(d,r.team)+' line':r.name;
      return '<div class="spot" style="left:'+sp[1]+'%;top:'+sp[2]+'px'+(sp[3]?';width:'+sp[3]+'px':'')+'"><a class="stk sm fc" data-tilt style="transform:rotate('+[-1.5,1,-.6,1.6,-1.1,.5][k%6]+'deg)" href="'+(isOL?tlink(r.team,A.season):plink(r.pid,A.season))+'"><div class="ph" style="background:'+band+'"><span>'+esc(sp[0]==='IDL'?'DL':sp[0])+'</span><i style="background:'+c+'"></i></div><div class="bd">'+(isOL?'<span class="hs" style="width:46px;height:46px;font-size:20px;border-radius:10px;border-width:0;background:'+c+'">OL</span>':hs(r.pid,r.name,c,46,r.head).replace('class="hs"','class="hs" data-s'))+'<div class="nm">'+esc(nm)+'</div><div class="sc">'+esc(isOL?'unit':tname(d,r.team))+'</div><div class="v">'+sg(r.value,1)+'</div></div></a></div>';}
    h+='<div class="fieldbox" tabindex="0" role="region" aria-label="The team in formation; scrolls sideways"><div class="turf"><div class="hash" style="left:33%"></div><div class="hash" style="left:67%"></div><div class="side" style="top:20px" aria-hidden="true">Defense</div><div class="side" style="bottom:20px" aria-hidden="true">Offense</div><div class="los" aria-hidden="true"></div><div class="losl" aria-hidden="true">LINE OF SCRIMMAGE</div>';
    DSPOTS.forEach(function(sp,k){h+=card(sp,'var(--red)',k);});OSPOTS.forEach(function(sp,k){h+=card(sp,'var(--field)',k+2);});
    h+='</div></div>';
    h+=phoneField(PD,PO,PS);
    if(A.warning)h+=warnBox('<strong>'+A.season+' is before 2024.</strong> '+esc(A.warning));
    h+='</section><section class="sec"><div class="rule"><h2>Special teams</h2></div><div class="strow">';
    [['K','K'],['P','P'],['AP','AP']].forEach(function(x,k){var r=PS[k].r;if(!r)return;var c=tcolor(d,r.team);
      h+='<a class="stk sm fc '+tilt(k)+'" data-tilt href="'+plink(r.pid,A.season)+'"><div class="ph" style="background:var(--st)"><span>'+(x[1]==='AP'?'All-purpose':x[1])+'</span><i style="background:'+c+'"></i></div><div class="bd">'+hs(r.pid,r.name,c,46,r.head)+'<div class="nm">'+esc(r.name)+'</div><div class="sc">'+esc(tname(d,r.team))+(x[0]==='AP'?' · '+esc(r.pos):'')+'</div><div class="v">'+sg(r.value,1)+'</div></div></a>';});
    h+='</div>'+(S.asView==='field'?'<div class="as-ph"><div class="asr ast-st">'+PS.map(function(p,k){return chip(p,PD.length+PO.length+k);}).join('')+'</div></div>':'')+'<p class="note lt">All-purpose is the best remaining back, receiver or tight end once return value is added. '+esc(A.note)+' Values are expected points above a replacement player at the position. The model\'s view, not a verdict.</p></section>';
    return h;});}

/* ---------- All-Savant on phones (below 640px): chips in formation, a list, a bottom sheet ---------- */
var AS=null;
var POSNAME={QB:'Quarterback',RB:'Running back',WR:'Wide receiver',TE:'Tight end',OL:'Offensive line',EDGE:'Edge rusher',IDL:'Defensive lineman',LB:'Linebacker',CB:'Cornerback',S:'Safety',DB:'Defensive back',K:'Kicker',P:'Punter',AP:'All-purpose'};
var BADGE={d:'var(--red)',o:'var(--field)',s:'var(--st)'};
function lastName(n){var w=String(n||'').split(/\s+/).filter(function(x){return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x);});return w.length?w[w.length-1]:n;}
function chip(p,i){var r=p.r;if(!r)return '';var isOL=r.slot==='OL',slot=p.sp[0],lab=slot==='IDL'?'DL':slot,nm=isOL?tname(AS.d,r.team):r.name;
  var aria=(isOL?'Offensive line unit, '+nm:POSNAME[slot]+', '+nm+', '+tname(AS.d,r.team))+', Savant value '+sg(r.value,1);
  return '<button type="button" class="cp'+(isOL?' w':'')+'" data-pick="'+i+'" aria-label="'+esc(aria)+'"><span class="b" style="background:'+BADGE[p.side]+'" aria-hidden="true">'+esc(lab)+'</span><span class="n" aria-hidden="true">'+esc(isOL?nm+' line':lastName(nm))+'</span><span class="v" aria-hidden="true">'+sg(r.value,1)+'</span></button>';}
function phoneField(PD,PO,PS){
  if(S.asView==='list'){
    var groups=[['Quarterback',['QB']],['Running backs',['RB']],['Receivers',['WR']],['Tight end',['TE']],['Offensive line',['OL']],['Defensive line',['EDGE','IDL']],['Linebackers',['LB']],['Defensive backs',['CB','S','DB']],['Special teams',['K','P','AP']]];
    var h='<div class="as-ph asl">';
    groups.forEach(function(g){var ps=AS.picks.map(function(p,i){return {p:p,i:i};}).filter(function(x){return x.p.r&&g[1].indexOf(x.p.sp[0])>=0;});if(!ps.length)return;
      h+='<h3>'+esc(g[0])+'</h3>';
      ps.forEach(function(x){var r=x.p.r,isOL=r.slot==='OL',c=tcolor(AS.d,r.team),slot=x.p.sp[0];
        h+='<a class="stk sm pc" href="'+(isOL?tlink(r.team,AS.A.season):plink(r.pid,AS.A.season))+'">'+(isOL?'<span class="hs" style="width:54px;height:54px;font-size:22px;border-radius:10px;background:'+c+'">OL</span>':hs(r.pid,r.name,c,54,r.head))+'<div style="min-width:0"><div class="lab" style="color:var(--muted)">'+esc(POSNAME[slot])+'</div><div class="nm">'+esc(isOL?tname(AS.d,r.team)+' offensive line':r.name)+'</div><small>'+esc(isOL?'unit':tname(AS.d,r.team))+'</small></div><span class="v">'+sg(r.value,1)+'</span></a>';});});
    return h+'</div>';}
  var off=PD.length;
  function row(idx,base){return '<div class="asr">'+idx.map(function(k){return chip((base?PO:PD)[k],(base?off:0)+k);}).join('')+'</div>';}
  return '<div class="as-ph"><div class="asf" role="group" aria-label="The team in formation. Tap a player for his card."><div class="ast-lab" aria-hidden="true">Defense</div>'+row([0,1])+row([2,4,3])+row([5,6,7])+row([8,9,10,11])+
    '<div class="ast-los" aria-hidden="true"></div>'+row([0,1,2,3,4],1)+row([5],1)+row([6,7],1)+'<div class="ast-lab" aria-hidden="true">Offense</div></div></div>';}
var sheetFrom=null;
function openSheet(i,from){
  var p=AS&&AS.picks[i];if(!p||!p.r)return;var r=p.r,d=AS.d,A=AS.A,isOL=r.slot==='OL',slot=p.sp[0],c=tcolor(d,r.team);
  var dlg=$('#assheet');
  if(!dlg){dlg=document.createElement('dialog');dlg.id='assheet';dlg.className='sheet';dlg.setAttribute('aria-labelledby','assheet-h');document.body.appendChild(dlg);
    dlg.addEventListener('click',function(e){if(e.target===dlg)dlg.close();});
    dlg.addEventListener('close',function(){if(sheetFrom&&document.body.contains(sheetFrom))sheetFrom.focus();sheetFrom=null;});}
  var rank='';
  if(!isOL){var k=-1;d.players.forEach(function(q,j){if(q[C.id]===r.pid)k=j;});var vl=k>=0?M.valueLine(d,k):null;
    if(vl&&vl.rank)rank=M.nth(vl.rank)+' of '+vl.of+' qualified '+REG.slot_name[d.players[k][C.slot]];}
  var head=isOL?'<span class="hs" style="width:72px;height:72px;font-size:30px;border-radius:12px;background:'+c+'">OL</span>':hs(r.pid,r.name,c,72,r.head);
  dlg.innerHTML='<div class="in"><div class="top">'+head+'<div style="min-width:0;flex:1"><div class="lab" style="color:var(--muted)">'+esc(isOL?'Offensive line, as a unit':POSNAME[slot])+'</div><h2 id="assheet-h">'+esc(isOL?tname(d,r.team)+' line':r.name)+'</h2><p class="sc">'+logo(r.team)+esc(tname(d,r.team))+' · '+esc(tconf(d,r.team))+'</p></div><button type="button" class="btn x" data-sheetclose="1" aria-label="Close">✕</button></div>'+
    '<dl><div><dt>Savant value</dt><dd>'+sg(r.value,1)+(slot==='AP'?' <small>with return value</small>':'')+'</dd></div><div><dt>Rank at his position</dt><dd id="assheet-rank">'+(isOL?'…':esc(rank||'below the qualifying sample'))+'</dd></div></dl>'+
    '<a class="go" href="'+(isOL?tlink(r.team,A.season):plink(r.pid,A.season))+'">'+(isOL?'Open '+esc(tname(d,r.team))+'\'s team page':'Open his full player card')+' →</a></div>';
  if(isOL)load('t/'+A.season+'/'+r.team+'.json').then(function(T){var e=$('#assheet-rank');if(e&&T.ol)e.textContent=M.nth(T.ol.rank)+' of '+T.ol.of+' offensive lines';}).catch(function(){var e=$('#assheet-rank');if(e)e.textContent='—';});
  sheetFrom=from;dlg.showModal();var x=dlg.querySelector('[data-sheetclose]');if(x)x.focus();}

/* ---------- leaders ---------- */
function vLeaders(){
  return load('s/'+S.season+'.json').then(function(d){
    var slot=S.lbSlot,stats=M.statsFor(REG,slot),key=S.lbStat,ret=slot==='RET';
    if(/^ped_/.test(key))return vPedigree(d,slot,key);
    if(key!=='value'&&!stats.some(function(s){return s.key===key;}))key=S.lbStat=ret?stats[0].key:'value';
    if(ret&&key==='value')key=S.lbStat=stats[0].key;
    var rpool=ret?M.retPool(d,REG):null;
    var stat=key==='value'?null:BYK[key],o={poolName:S.pool,adj:S.adj,gt:S.gt},rows=[];
    d.players.forEach(function(p,i){if(ret){if(S.lbQual&&rpool.ids.indexOf(i)<0)return;if(!M.sample(d,'returns',i,false))return;}else{if(p[C.slot]!==slot)return;if(S.lbQual&&!p[C.qual])return;}
      if(stat){var r=M.row(d,REG,stat,i,o);if(!r.tracked||r.none||r.pct==null)return;rows.push({i:i,v:r.value,r:r});}
      else{var v=d.value.v[i];if(!M.ok(v))return;rows.push({i:i,v:+v});}});
    var lower=stat&&stat.lower;rows.sort(function(a,b){return (lower?a.v-b.v:b.v-a.v)||d.players[a.i][C.id]-d.players[b.i][C.id];});
    var off=stat&&!M.tracked(stat,d.season);
    var h='<section class="stk"><div class="band"><h2>Leaders · '+d.season+'</h2><span class="lab">'+esc(asof(d))+'</span></div><div class="ctl"><label class="vh" for="lbslot">Position</label><select class="btn" id="lbslot">'+REG.slots.filter(function(s){return s!=='OL';}).concat(['RET']).map(function(s){return '<option value="'+s+'"'+(s===slot?' selected':'')+'>'+esc(REG.slot_name[s]||REG.pools_extra[s])+'</option>';}).join('')+'</select><label class="vh" for="lbstat">Stat</label><select class="btn" id="lbstat">'+(ret?'':'<option value="value">Savant value</option><option value="ped_up">Outplaying his stars</option><option value="ped_down">Stars ahead of production</option>')+stats.map(function(s){return '<option value="'+s.key+'"'+(s.key===key?' selected':'')+'>'+esc(s.label)+(s.verdict==='context'?' (context)':'')+'</option>';}).join('')+'</select>';
    [['pos','FBS'],['p4','Power 4'],['conf','His conference']].forEach(function(x){h+='<button class="btn" data-pool="'+x[0]+'" aria-pressed="'+(S.pool===x[0])+'">'+x[1]+'</button>';});
    h+='<button class="btn" data-adj="'+(S.adj?0:1)+'" aria-pressed="'+S.adj+'">Adjusted</button><button class="btn" data-gt="'+(S.gt?0:1)+'" aria-pressed="'+S.gt+'">Garbage time '+(S.gt?'in':'out')+'</button><button class="btn" data-lbq="'+(S.lbQual?0:1)+'" aria-pressed="'+S.lbQual+'">Qualified only</button></div>';
    var q=REG.qual[slot];
    h+='<p class="poolline">'+(stat?'Percentiles '+(S.pool==='conf'?'vs qualified '+esc(REG.slot_name[slot])+' in each player\'s own conference':'vs '+(S.pool==='p4'?'Power 4 ':'FBS ')+esc(REG.slot_name[slot]))+', '+(S.adj&&stat.adj?'opponent-adjusted':'raw')+', garbage time '+(S.gt?'included':'excluded')+', '+d.season+'. ':'Savant value: expected points above a replacement player, opponent-adjusted, '+d.season+'. ')+(q?'Qualified: '+Math.round(q[1]*(d.scale||1))+' '+esc(sampleName(q[0]))+(d.scale<1?' so far (scaled to the season played)':'')+'.':'')+'</p>';
    if(off)h+='<div class="pad"><div class="bar none">'+esc(d.season<stat.start?'not tracked before '+stat.start:'not tracked in '+d.season)+'</div></div>';
    else{h+='<div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th class="n">#</th><th class="pin">Player</th><th>Team</th><th class="n">'+esc(stat?stat.label:'Savant value')+'</th>'+(stat?'<th style="min-width:150px">Percentile</th><th class="n">'+esc(stat.unit_n)+'</th>':'<th class="n">Games</th>')+'</tr></thead><tbody>';
      rows.slice(0,60).forEach(function(x,n){var p=d.players[x.i];
        h+='<tr><td class="n">'+(n+1)+'</td><td class="pin"><a href="'+plink(p[C.id],d.season)+'"><strong>'+esc(p[C.name])+'</strong></a>'+(p[C.qual]?'':' <span class="lab" style="color:var(--muted)">below sample</span>')+'</td><td><span class="chip" style="height:18px;background:'+tcolor(d,p[C.team])+'"></span>'+esc(tname(d,p[C.team]))+'</td><td class="n"><strong>'+(stat?esc(x.r.shown):sg(x.v,1))+'</strong></td>'+(stat?'<td>'+bar(x.r)+'</td><td class="n">'+(x.r.n==null?'—':Math.round(x.r.n))+'</td>':'<td class="n">'+p[C.gp]+'</td>')+'</tr>';});
      h+='</tbody></table></div>';}
    h+='<div class="pad">'+(stat?'<p class="note"><strong>'+esc(stat.label)+'.</strong> '+esc(stat.what)+' Formula: '+esc(stat.formula)+'. Source: '+esc(stat.source)+'. From '+stat.start+'.'+(stat.k?' Settles around '+stat.k+' '+esc(stat.unit_n)+'.':'')+(stat.verdict==='context'?' A CONTEXT stat: how much, or too noisy to grade.':'')+(stat.lower?' Lower is better, so the bar is flipped.':'')+'</p>':'<p class="note">Savant value is expected points above a replacement-level player at the position, opponent-adjusted. Pure individual value: nothing in it knows whether his team won.</p>')+(M.SLOT_TABLE[slot]==='dfn'&&d.season<2024?'<p class="note" style="margin-top:8px"><strong>'+esc(REG.pre_box_warning)+(REG.no_tacklers.indexOf(d.season)>=0?' '+esc(REG.early_def_note):'')+'</strong></p>':'')+'</div></section>';
    return h;});}

function vPedigree(d,slot,key){
  return load('x/pedigree/'+d.season+'.json').catch(function(){return null;}).then(function(X){
    var ix={};d.players.forEach(function(p,i){ix[p[C.id]]=i;});
    var rows=(X?X.rows:[]).filter(function(r){var i=ix[r[0]];return i!=null&&d.players[i][C.slot]===slot;});
    rows.sort(function(a,b){return (key==='ped_up'?b[3]-a[3]:a[3]-b[3])||a[0]-b[0];});
    var h='<section class="stk"><div class="band"><h2>Production vs pedigree · '+d.season+'</h2><span class="lab">'+esc(REG.slot_name[slot])+'</span></div><div class="ctl"><label class="vh" for="lbslot">Position</label><select class="btn" id="lbslot">'+REG.slots.filter(function(s){return s!=='OL';}).map(function(s){return '<option value="'+s+'"'+(s===slot?' selected':'')+'>'+esc(REG.slot_name[s])+'</option>';}).join('')+'</select><label class="vh" for="lbstat">Board</label><select class="btn" id="lbstat"><option value="value">Savant value</option><option value="ped_up"'+(key==='ped_up'?' selected':'')+'>Outplaying his stars</option><option value="ped_down"'+(key==='ped_down'?' selected':'')+'>Stars ahead of production</option></select></div>';
    h+='<p class="poolline">POOL: qualified FBS '+esc(REG.slot_name[slot])+' with a recruiting rating, '+d.season+'. Gap = Savant-value percentile less recruiting-rating percentile.</p>';
    h+='<div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th class="n">#</th><th class="pin">Player</th><th>Team</th><th class="n">Gap</th><th class="n">Production pct</th><th class="n">Pedigree pct</th></tr></thead><tbody>';
    rows.slice(0,60).forEach(function(r,n){var p=d.players[ix[r[0]]];h+='<tr><td class="n">'+(n+1)+'</td><td class="pin"><a href="'+plink(r[0],d.season)+'"><strong>'+esc(p[C.name])+'</strong></a></td><td><span class="chip" style="height:18px;background:'+tcolor(d,p[C.team])+'"></span>'+esc(tname(d,p[C.team]))+'</td><td class="n"><strong>'+(r[3]>0?'+':'')+r[3].toFixed(0)+'</strong></td><td class="n">'+Math.round(r[1])+'</td><td class="n">'+Math.round(r[2])+'</td></tr>';});
    h+='</tbody></table></div><div class="pad"><p class="note">'+esc(X?X.note:'')+' Only players with a recruiting rating appear.</p></div></section>';
    return h;});}

/* ---------- search ---------- */
var q=$('#q'),res=$('#res'),curNames=null;
function norm(s){return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,'');}
function doSearch(){
  var t=norm(q.value).trim();if(t.length<2){res.hidden=true;q.setAttribute('aria-expanded','false');return;}
  var out=[],seen={};
  SEARCH.teams.forEach(function(x){if(out.length<6&&(norm(x[1]).indexOf(t)>=0||norm(x[5]||'').indexOf(t)===0||norm(x[2]).indexOf(t)===0))out.push('<li><a href="'+tlink(x[0],Math.min(x[4],S.season>x[4]?x[4]:S.season))+'"><span>'+esc(x[1])+(x[5]?' '+esc(x[5]):'')+'</span><small>TEAM · '+esc(x[3])+'</small></a></li>');});
  var confs={};SEARCH.teams.forEach(function(x){if(x[4]===IDX.current)confs[x[3]]=1;});
  Object.keys(confs).forEach(function(c){if(norm(c).indexOf(t)>=0)out.push('<li><a href="#teams" data-conf="'+esc(c)+'"><span>'+esc(c)+'</span><small>CONFERENCE</small></a></li>');});
  function add(id,name,slot,team,first,last){if(seen[id]||out.length>=24)return;if(norm(name).indexOf(t)<0)return;seen[id]=1;out.push('<li><a href="#player-'+id+'"><span>'+esc(name)+'</span><small>'+esc(slot)+' · '+esc(TEAMK[team]?TEAMK[team][1]:'')+' · '+(first===last?first:first+'–'+String(last).slice(2))+'</small></a></li>');}
  (curNames||[]).forEach(function(p){var h=SEARCH._first&&SEARCH._first[p[C.id]];add(p[C.id],p[C.name],p[C.slot],p[C.team],h||IDX.current,IDX.current);});
  for(var k=SEARCH.players.length-1;k>=0&&out.length<24;k--){var p=SEARCH.players[k];add(p[0],p[1],p[2],p[3],p[4],p[5]);}
  res.innerHTML=out.length?out.join(''):'<li><a><span>No player or team by that name</span></a></li>';res.hidden=false;q.setAttribute('aria-expanded','true');}
q.addEventListener('input',doSearch);
q.addEventListener('keydown',function(e){var as=res.querySelectorAll('a[href]');if(e.key==='Escape'){res.hidden=true;return;}if(e.key==='Enter'&&as.length){location.hash=as[0].getAttribute('href');res.hidden=true;q.blur();}});
document.addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('.res a');
  if(a){if(a.dataset.conf){S.tConf=a.dataset.conf;}res.hidden=true;q.value='';if(a.getAttribute('href')===location.hash)render();return;}
  if(!e.target.closest||!e.target.closest('.srch'))res.hidden=true;
  var b=e.target.closest&&e.target.closest('button');if(!b)return;var ds=b.dataset,hit=true;
  if(ds.pick!=null){openSheet(+ds.pick,b);return;}
  if(ds.sheetclose){var dl=$('#assheet');if(dl)dl.close();return;}
  if(ds.asv){S.asView=ds.asv;try{localStorage.setItem('cfb-as-view',ds.asv);}catch(err){}render(true);return;}
  if(ds.pool)S.pool=ds.pool;else if(ds.adj!=null)S.adj=ds.adj==='1';else if(ds.gt!=null)S.gt=ds.gt==='1';else if(ds.set)S.set=ds.set;else if(ds.tier)S.tier=ds.tier;
  else if(ds.lbq!=null)S.lbQual=ds.lbq==='1';else if(ds.tadj!=null)S.tAdj=ds.tadj==='1';
  else if(ds.tsort){if(S.tSort===ds.tsort)S.tDir=-S.tDir;else{S.tSort=ds.tsort;var lowerFirst=['resume_rank','talent_rank','def_epa','def_sr','off_fp'];S.tDir=lowerFirst.indexOf(ds.tsort)>=0?1:-1;}}
  else hit=false;
  if(hit)render(true);});
document.addEventListener('change',function(e){var t=e.target;
  if(t.id==='season'){S.season=+t.value;var h=location.hash.replace(/\/\d{4}$/,'');if(/^#(player|team)-/.test(h))location.hash=h+'/'+S.season;else render();}
  else if(t.id==='pseason'){location.hash=location.hash.replace(/\/\d{4}$/,'')+'/'+t.value;}
  else if(t.id==='tconf'){S.tConf=t.value;render(true);}
  else if(t.id==='asconf'){S.conf=t.value;render(true);}
  else if(t.id==='lbslot'){S.lbSlot=t.value;S.lbStat='value';render(true);}
  else if(t.id==='lbstat'){S.lbStat=t.value;render(true);}});

/* ---------- routing ---------- */
var seq=0;
function render(keep){
  var h=location.hash.replace(/^#/,'')||'home',m,view,key='home',small=true,my=++seq;
  var ys=/\/(\d{4})$/.exec(h),want=ys?+ys[1]:null;if(ys)h=h.slice(0,ys.index);
  if(want&&seasonInfo(want)&&!/^player-/.test(h))S.season=want;
  if((m=/^player-(-?\d+)$/.exec(h))){view=vPlayer(+m[1],want);key='home';}
  else if((m=/^team-(\d+)$/.exec(h))){view=vTeam(+m[1],want);key='teams';}
  else if(h==='teams'){view=vTeams();key='teams';}
  else if(h==='playoff'){view=vPlayoff();key='playoff';}
  else if(h==='all-savant'){view=vAllSavant();key='allsavant';}
  else if(h==='leaders'){view=vLeaders();key='leaders';}
  else{view=vHome();small=false;}
  $('#hero').className='hero'+(small?' small':'');
  document.body.classList.toggle('view-home',!small);
  document.querySelectorAll('#tabs a').forEach(function(a){if(a.dataset.k===key)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');var base=a.getAttribute('href').replace(/\/\d{4}$/,'');a.setAttribute('href',base+(S.season!==IDX.current&&base!=='#home'?'/'+S.season:''));});
  $('#season').value=String(want&&/^player-/.test(h)?want:S.season);
  var v=$('#view'),sy=window.scrollY;
  if(!keep)v.innerHTML='<p class="empty">Loading…</p>';
  view.then(function(html){if(my!==seq)return;v.innerHTML=html;if(keep)window.scrollTo(0,sy);else if(small)window.scrollTo(0,Math.min(window.scrollY,$('#hero').offsetTop));})
    .catch(function(e){if(my!==seq)return;console.error(e);v.innerHTML='<p class="empty">That page could not load. Check the address, or refresh to try again.</p>';});}
window.addEventListener('hashchange',function(){render();});
(function(){var bg=$('#herobg'),ph='COLLEGE FOOTBALL SAVANT · ',s='';for(var i=0;i<7;i++)s+='<div>'+(i%2?'&nbsp;&nbsp;&nbsp;&nbsp;':'')+new Array(9).join(ph)+'</div>';bg.innerHTML=s;
  [['left:3%;top:22px;width:80px;height:80px;border-radius:50%;background:#0F6E5C;transform:rotate(-8deg)'],['left:13%;top:128px;width:110px;height:50px;border-radius:10px;background:#BC3A2C;transform:rotate(9deg)'],['left:23%;top:30px;width:56px;height:56px;background:#FFD25A;transform:rotate(14deg)'],['right:4%;top:26px;width:96px;height:96px;border-radius:50%;background:#5B2A86;transform:rotate(6deg)'],['right:15%;top:134px;width:118px;height:46px;border-radius:26px;background:#C2561C;transform:rotate(-11deg)'],['right:25%;top:18px;width:50px;height:50px;background:#7A1F2B;transform:rotate(-18deg)']].forEach(function(c){var e=document.createElement('div');e.className='cp';e.setAttribute('aria-hidden','true');e.setAttribute('data-tilt','');e.style.cssText=c[0];$('#hero').insertBefore(e,$('#hero .in'));});})();
Promise.all([load('registry.json'),load('index.json'),load('search.json'),load('honours.json').catch(function(){return {};})]).then(function(a){
  REG=a[0];IDX=a[1];SEARCH=a[2];HON=a[3]||{};REG.stats.forEach(function(s){BYK[s.key]=s;});
  SEARCH.teams.forEach(function(t){TEAMK[t[0]]=t;});
  S.season=IDX.current;
  $('#season').innerHTML=IDX.seasons.map(function(s){return '<option value="'+s.season+'">'+s.season+(s.final?'':' · live')+'</option>';}).join('');
  $('#ver').textContent='Version '+REG.version;
  load('s/'+IDX.current+'.json').then(function(d){curNames=d.players;Object.keys(d.teams).forEach(function(t){var x=d.teams[t];if(TEAMK[t]){TEAMK[t][6]=x[3];TEAMK[t][7]=x[4];}});SEARCH._first={};SEARCH.players.forEach(function(p){SEARCH._first[p[0]]=p[4];});}).catch(function(){});
  render();
}).catch(function(e){console.error(e);$('#view').innerHTML='<p class="empty">The data could not load. Refresh to try again.</p>';});
})();
