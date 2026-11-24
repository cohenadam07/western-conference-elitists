/* wce-human.js — the human gate for wcehoops.com's data pages.
 *
 * Why: since Nov 23, 2026 a bot running a real Chrome browser through rotating home IPs has been
 * opening NBA Savant ~100 times an hour, staying a few seconds and leaving. It passes Vercel's Bot
 * Protection challenge. Each visit used to download ~9 MB of Savant data (tens of GB a day) and
 * count as a pageview. This script makes sure a visit only gets the data, and only counts, once
 * the visitor is confirmed human. See BOT-SHIELD.md.
 *
 * How:
 *   1. It must load before the page's own scripts (a plain <script> in <head>, added at build by
 *      scripts/lib/seo-build.mjs and scripts/lib/player-pages.mjs).
 *   2. It wraps window.fetch. Same-origin .json requests (except /api/, /mcp/, /savant-api/,
 *      /.well-known/) wait for wceHuman.ready, so the page's own code needs no changes: it shows
 *      its normal "Loading…" state until the gate opens.
 *   3. wceHuman.ready resolves on the first of:
 *        - the wce_hh cookie (passed in the last 12 hours, so moving between pages is instant);
 *        - a Cloudflare Turnstile pass, checked server-side by /api/human (invisible for nearly
 *          every real visitor, so deep links load without a click);
 *        - a real interaction (click, key, touch, wheel, mouse move, scroll), but only when
 *          Turnstile could not run at all: no site key, its script blocked, or /api/human down.
 *          A visitor Turnstile actually failed gets the visible checkbox instead.
 *   4. Vercel Web Analytics (/_vercel/insights/script.js) loads only after ready, so pageviews
 *      count people, not bots.
 *
 * The Turnstile site key is public; the build writes it in place of the placeholder below from
 * the TURNSTILE_SITE_KEY env var. Empty key = interaction-only mode.
 */
(function () {
  'use strict';
  if (window.wceHuman) return;

  var SITE_KEY = '__WCE_TS_KEY__';
  if (SITE_KEY.indexOf('__') === 0) SITE_KEY = '';

  var COOKIE = 'wce_hh';
  var BYPASS = /^\/(api|mcp|savant-api|\.well-known)\//;

  var human = false;
  var fallbackOk = false;   // may a plain interaction open the gate?
  var interacted = false;
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  // Vercel Web Analytics queue, so anything calling va() before the script loads is kept.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

  function hasCookie() {
    return document.cookie.split(';').some(function (c) { return c.trim() === COOKIE + '=1'; });
  }

  function loadAnalytics() {
    if (document.querySelector('script[src="/_vercel/insights/script.js"]')) return;
    var s = document.createElement('script');
    s.defer = true;
    s.src = '/_vercel/insights/script.js';
    document.head.appendChild(s);
  }

  function open(how) {
    if (human) return;
    human = true;
    window.wceHuman.how = how;
    hideBox();
    resolveReady(true);
    loadAnalytics();
  }

  function allowFallback() {
    if (human) return;
    fallbackOk = true;
    if (interacted) open('interaction');
  }

  // ---- fetch gate -----------------------------------------------------------------------------
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function gated(input) {
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
      var u = new URL(raw, location.href);
      if (u.origin !== location.origin) return false;
      if (BYPASS.test(u.pathname)) return false;
      return /\.json(\.gz)?$/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }
  if (realFetch) {
    window.fetch = function (input, init) {
      if (!human && gated(input)) return ready.then(function () { return realFetch(input, init); });
      return realFetch(input, init);
    };
  }

  // ---- interaction fallback -------------------------------------------------------------------
  var startY = window.scrollY || 0;
  function onInteract(e) {
    if (e && e.isTrusted === false) return;
    if (e && e.type === 'scroll' && Math.abs((window.scrollY || 0) - startY) < 4) return;
    interacted = true;
    if (fallbackOk) open('interaction');
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove', 'scroll'].forEach(function (t) {
    window.addEventListener(t, onInteract, { passive: true, capture: true });
  });

  // ---- Turnstile ------------------------------------------------------------------------------
  var box = null;
  var widgetId = null;

  function ensureBox(visible) {
    if (!box) {
      box = document.createElement('div');
      box.id = 'wce-human';
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', 'Quick check');
      box.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483000;display:none;' +
        'background:#fff;color:#111;border:1px solid #d9d9d9;border-radius:10px;padding:10px 12px 12px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.12);font:500 13px/1.4 "IBM Plex Sans",system-ui,sans-serif;max-width:340px';
      var msg = document.createElement('div');
      msg.className = 'wce-human-msg';
      msg.textContent = 'Quick check to load the stats.';
      msg.style.cssText = 'margin:0 0 8px;display:none';
      var slot = document.createElement('div');
      slot.className = 'wce-human-slot';
      box.appendChild(msg);
      box.appendChild(slot);
      (document.body || document.documentElement).appendChild(box);
    }
    if (visible) {
      box.style.display = 'block';
      box.querySelector('.wce-human-msg').style.display = 'block';
    }
    return box;
  }
  function hideBox() { if (box) box.style.display = 'none'; }

  function verify(token) {
    if (!realFetch) { allowFallback(); return; }
    realFetch('/api/human', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: token })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok) open('turnstile');
        else if (j && j.failed) showCheckbox();   // Cloudflare said no: a visible retry, no fallback
        else allowFallback();                     // not configured or down: never strand a real visitor
      })
      .catch(allowFallback);
  }

  function showCheckbox() {
    ensureBox(true);
    try { if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); } catch (e) { allowFallback(); }
  }

  function render() {
    var ts = window.turnstile;
    if (!ts) { allowFallback(); return; }
    var slot = ensureBox(false).querySelector('.wce-human-slot');
    try {
      widgetId = ts.render(slot, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        action: 'data',
        callback: verify,
        'before-interactive-callback': function () { ensureBox(true); },
        'expired-callback': function () { try { ts.reset(widgetId); } catch (e) {} },
        'unsupported-callback': allowFallback,
        'error-callback': function (code) {
          // 6xxxxx = the challenge was failed; anything else = it couldn't run.
          if (String(code || '').charAt(0) === '6') { showCheckbox(); return true; }
          allowFallback();
          return true;
        }
      });
    } catch (e) {
      allowFallback();
    }
  }

  function startTurnstile() {
    var cb = '__wceTsLoaded';
    window[cb] = render;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=' + cb;
    s.async = true;
    s.defer = true;
    s.onerror = allowFallback;
    document.head.appendChild(s);
    // If Cloudflare hasn't answered in 8 s, let a real interaction through.
    setTimeout(function () { if (!human && widgetId === null) allowFallback(); }, 8000);
  }

  window.wceHuman = {
    ready: ready,
    get isHuman() { return human; },
    how: null
  };

  if (hasCookie()) { open('cookie'); return; }
  if (!SITE_KEY) { allowFallback(); return; }
  if (document.body) startTurnstile();
  else document.addEventListener('DOMContentLoaded', startTurnstile);
})();
