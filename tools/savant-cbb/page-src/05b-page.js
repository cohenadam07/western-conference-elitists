function fit(){q.placeholder=window.innerWidth<520?'Search':'Search players and teams';}
window.addEventListener('resize',function(){fit();if(pending.length)pending.forEach(function(f){f();});});
readScale();fit();
Promise.all([load('registry.json'),load('index.json'),load('search.json'),load('links.json').catch(function(){return {};}),load('honours.json').catch(function(){return {};})]).then(function(a){
  REG=a[0];IDX=a[1];SEARCH=a[2];LINKS=a[3]||{};HON=a[4]||{};REG.stats.forEach(function(s){BYK[s.key]=s;});
  SEARCH.teams.forEach(function(t){TEAMS[t[0]]={name:t[1],abbr:t[2],conf:t[3],color:t[5]};});
  S.season=IDX.current||IDX.default_season;
  $('#ver').textContent='Version '+REG.version;
  render();
}).catch(function(e){console.error(e);$('#view').innerHTML='<p class="empty">The data could not load. Refresh to try again.</p>';});
})();
