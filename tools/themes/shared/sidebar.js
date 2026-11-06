var navtog=$('#navtog');
function setNav(c,save){document.documentElement.classList.toggle('nav-collapsed',c);var t=c?'Expand sidebar':'Collapse sidebar';navtog.setAttribute('aria-expanded',String(!c));navtog.title=t+' ( [ )';navtog.querySelector('.vh').textContent=t;if(save){try{localStorage.setItem('cbs-nav',c?'1':'0');}catch(e){}}}
navtog.addEventListener('click',function(){setNav(!document.documentElement.classList.contains('nav-collapsed'),true);});
document.addEventListener('keydown',function(e){if(e.key!=='['||e.metaKey||e.ctrlKey||e.altKey)return;var t=e.target;if(t&&(t.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)))return;if(window.innerWidth>760){e.preventDefault();navtog.click();}});
var saved=null;try{saved=localStorage.getItem('cbs-nav');}catch(e){}
setNav(saved==null?window.innerWidth<1100:saved==='1',false);
