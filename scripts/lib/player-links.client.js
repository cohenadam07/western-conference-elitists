/* Basketball Savant <-> player pages.
   scripts/lib/seo-build.mjs adds this to basketball-savant.html at build time, right after the
   page's own script, so it survives the page being regenerated. It does three things:

   1. Keeps the address bar on the player (and season) you are looking at, so a copied URL
      opens the same profile. Before this the bar only ever said "#p".
   2. Puts the player's page link (wcehoops.com/player/<slug>) into what Share sends, next to
      the card image. That page has its own title and preview image; the tool's URL doesn't.
   3. Adds a copy-link button beside Share.

   It hooks the page's top-level functions by name. If the page changes shape and they are not
   there, it does nothing at all. Every step is wrapped so it can never break the tool. */
(function () {
  'use strict';
  try {
    if (typeof selectPlayer !== 'function' || typeof render !== 'function' || typeof showHome !== 'function' || typeof asId !== 'function') return;
  } catch (e) { return; }

  /*__SLUGIFY__*/
  var ODD = /*__ODD__*/{};

  function slugOf(id, name) { return ODD[String(id)] || slugify(name); }
  function playerUrl() {
    // The build names each page after the spelling in the player's newest season (PIDX[id].ref),
    // so use that here too: a few names are spelled with accents in some seasons and without in others.
    try {
      if (curId == null) return null;
      var ref = PIDX[curId] && PIDX[curId].ref;
      var name = (ref && ref.name) || (cur && cur.name);
      return name ? location.origin + '/player/' + slugOf(curId, name) : null;
    } catch (e) { return null; }
  }
  function inPlayerView() {
    var c = document.body.classList;
    return !c.contains('home-open') && !c.contains('lb-open');
  }
  function params() { try { return new URLSearchParams(location.search); } catch (e) { return null; } }

  /* ---- 1. address bar ---------------------------------------------------------------- */
  var ready = false;                       // stays false until the page has finished booting,
  var first = params();                    // so the ?p= it boots from is never stripped early
  var bootP = first ? first.get('p') : null, bootS = first ? first.get('s') : null;
  // A reload (or a pasted address-bar link) arrives as ?p=…#p. Boot pushes its own "#p" entry
  // for the player, so drop the hash first; otherwise there are two identical entries and the
  // first Back press does nothing.
  try { if (bootP != null && location.hash === '#p') history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {}

  function sync() {
    if (!ready) return;
    try {
      if (typeof playing !== 'undefined' && playing) return;        // autoplay walks seasons fast
      var u = new URL(location.href);
      if (inPlayerView() && curId != null) {
        u.searchParams.set('p', String(curId));
        if (curSeason) u.searchParams.set('s', curSeason); else u.searchParams['delete']('s');
      } else {
        u.searchParams['delete']('p'); u.searchParams['delete']('s');
      }
      var next = u.pathname + u.search + u.hash;
      if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
    } catch (e) {}
  }
  function seasonFromUrl(s) {              // ?s=2015-16 opens that season, when he played it
    try {
      if (s && curId != null && DATA.seasons.indexOf(s) > -1 && inSpan(curId, s) && curSeason !== s) setSeason(s);
    } catch (e) {}
  }
  function start() {
    if (ready) return;
    ready = true;
    try { if (bootP != null && String(asId(bootP)) === String(curId) && inPlayerView()) seasonFromUrl(bootS); } catch (e) {}
    sync();
  }
  function after(name, fn) {               // run fn after a top-level page function
    try {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () { var r = orig.apply(this, arguments); try { fn(); } catch (e) {} return r; };
    } catch (e) {}
  }
  after('render', sync);
  after('showLB', sync);
  after('stopPlay', sync);
  after('showHome', function () { if (ready) sync(); else setTimeout(start, 0); });   // boot ends with showHome + the ?p= deep link
  try { if (DATA && cur) setTimeout(start, 0); } catch (e) {}                         // already booted (should not happen)

  // Back/forward onto a player entry: show the player that entry was for, not whoever was open last.
  window.addEventListener('popstate', function () {
    try {
      if (location.hash !== '#p') return;
      // This listener was added before the page's own, so it runs first: put the page in
      // player view now (the page's handler is about to do the same), or the render below
      // would be read as "still on the home screen" and strip the player from the URL.
      document.body.classList.remove('home-open'); document.body.classList.remove('lb-open');
      var q = params(), p = q && q.get('p');
      if (p == null) return;
      var id = asId(p);
      if (String(id) !== String(curId) && PIDX[id]) selectPlayer(id);
      seasonFromUrl(q.get('s'));
    } catch (e) {}
  });

  /* ---- 2. Share carries the player's link ---------------------------------------------- */
  try {
    if (navigator.share) {
      var nativeShare = navigator.share.bind(navigator);
      navigator.share = function (d) {
        try {
          var u = playerUrl();
          if (u && d && d.files && inPlayerView()) {
            var withLink = { files: d.files, title: d.title, text: cur.name + ' · ' + curSeason + ' — Basketball Savant\n' + u };
            if (!navigator.canShare || navigator.canShare(withLink)) d = withLink;
          }
        } catch (e) {}
        return nativeShare(d);
      };
    }
  } catch (e) {}

  /* ---- 3. copy-link button -------------------------------------------------------------- */
  try {
    var bar = document.querySelector('#id .idbtns');
    if (bar && !document.getElementById('linkbtn')) {
      var LINK = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="M10 13a5 5 0 0 0 7.1.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></svg>';
      var DONE = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'linkbtn'; b.className = 'playbtn';
      b.title = 'Copy a link to this player';
      b.setAttribute('aria-label', 'Copy a link to this player');
      b.innerHTML = LINK;
      b.onclick = function () {
        var u = playerUrl();
        if (!u || !navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(u).then(function () {
          b.innerHTML = DONE; b.title = 'Link copied';
          setTimeout(function () { b.innerHTML = LINK; b.title = 'Copy a link to this player'; }, 1400);
        }, function () {});
      };
      bar.appendChild(b);
    }
  } catch (e) {}
})();
