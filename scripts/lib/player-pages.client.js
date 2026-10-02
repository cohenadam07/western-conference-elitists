/* Player pages: the parts that need a script. Everything a search engine or link preview reads
   is plain HTML; this only adds conveniences for people. Shipped as dist/player/p.js by
   scripts/lib/player-pages.mjs. Lives here once instead of in ~3,800 pages. */
(function () {
  'use strict';
  var TOOL = '/basketball-savant.html';
  var canon = document.querySelector('link[rel="canonical"]');
  var url = (canon && canon.href) || location.href.split('#')[0];

  // 1. Share: the phone's share sheet where there is one, otherwise copy the link.
  var share = document.querySelector('[data-share]');
  if (share) {
    var label = share.textContent;
    var flash = function (t) { share.textContent = t; setTimeout(function () { share.textContent = label; }, 1600); };
    var copy = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { flash('Link copied'); }, function () { flash('Copy the address bar'); });
      } else { flash('Copy the address bar'); }
    };
    share.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: document.title, url: url }).catch(function (e) { if (!e || e.name !== 'AbortError') copy(); });
      } else { copy(); }
    });
  }

  // 2. Season table: each season opens in the interactive profile on that season.
  var table = document.querySelector('table[data-p]');
  if (table) {
    var pid = encodeURIComponent(table.getAttribute('data-p'));
    var cells = table.querySelectorAll('tbody th');
    for (var i = 0; i < cells.length; i++) {
      var node = cells[i].firstChild;
      if (!node || node.nodeType !== 3) continue;
      var a = document.createElement('a');
      a.href = TOOL + '?p=' + pid + '&s=' + encodeURIComponent(node.nodeValue);
      a.textContent = node.nodeValue;
      a.title = 'Open ' + node.nodeValue + ' in the interactive profile';
      cells[i].replaceChild(a, node);
    }
  }

  // 3. Newsletter: same endpoint and replies as the site's SubscribeForm (api/newsletter.js).
  var slot = document.querySelector('[data-nl]');
  if (slot) {
    var OK = {
      confirm: 'Check your inbox. We sent a confirmation link; click it and you’re on the list.',
      subscribed: 'You’re in.',
      resent: 'Check your inbox again. You’d signed up before, so we re-sent the confirmation link.',
      existing: 'You’re already on the list.',
      unconfirmed: 'Almost there. Find the confirmation email (check spam too) and click the link.',
      queued: 'Got it. Your spot is saved, and a confirmation email will follow.'
    };
    var ERR = {
      invalid: 'That email doesn’t look right. Check it and try again.',
      rejected: 'We couldn’t add that address. Try a different email.',
      unsubscribed: 'That address unsubscribed earlier, so it can’t be re-added from here.',
      rate: 'Too many tries from here. Give it a few minutes.',
      network: 'Couldn’t reach the server. Check your connection and try again.'
    };
    slot.className = 'nl';
    slot.innerHTML =
      '<div><h2>The Weekly Board</h2><p>WCE’s free weekly email. During the season: the biggest percentile movers from Basketball Savant.</p></div>' +
      '<form novalidate><label class="hp" for="nle">Email address</label>' +
      '<input id="nle" type="email" placeholder="you@example.com" autocomplete="email" required>' +
      '<input class="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button type="submit">Subscribe</button><p class="m" role="status"></p></form>';
    var form = slot.querySelector('form');
    var email = form.querySelector('input[type=email]');
    var trap = form.querySelector('input[type=text]');
    var btn = form.querySelector('button');
    var msg = form.querySelector('.m');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var value = (email.value || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) { msg.textContent = value ? ERR.invalid : 'Enter your email first.'; email.focus(); return; }
      btn.disabled = true; msg.textContent = '';
      fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source: slot.getAttribute('data-nl') || 'player-page', website: trap.value })
      }).then(function (r) { return r.json().catch(function () { return { ok: false, error: r.status === 429 ? 'rate' : 'server' }; }); })
        .catch(function () { return { ok: false, error: 'network' }; })
        .then(function (j) {
          btn.disabled = false;
          if (j && j.ok) { msg.textContent = OK[j.status] || OK.confirm; email.value = ''; return; }
          msg.textContent = (j && ERR[j.error]) || 'Something went wrong on our end. Try again in a minute.';
        });
    });
  }

  // 4. Directory page: filter the list as you type.
  var q = document.querySelector('[data-filter]');
  if (q) {
    var items = Array.prototype.slice.call(document.querySelectorAll('.dl li'));
    var secs = Array.prototype.slice.call(document.querySelectorAll('[data-sec]'));
    var fold = function (s) { s = s.toLowerCase(); return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s; };
    var names = items.map(function (li) { return fold(li.textContent); });
    q.addEventListener('input', function () {
      var t = fold(q.value.trim());
      for (var k = 0; k < items.length; k++) items[k].hidden = !!t && names[k].indexOf(t) < 0;
      for (var j = 0; j < secs.length; j++) secs[j].hidden = !!t && !secs[j].querySelector('.dl li:not([hidden])');
    });
  }
})();
