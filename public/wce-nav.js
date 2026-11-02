/* WCE site ribbon: the one top bar every page on wcehoops.com shares.
 *
 * THE MENU LIVES HERE AND ONLY HERE. Add, rename or move a page in WCE_NAV below and every
 * page picks it up: the React pages (src/components/Navbar.jsx), the standalone Savant pages,
 * the NFL game page, and the build-time player pages (scripts/lib/player-pages.mjs reads this
 * file in Node to print crawlable fallback links).
 *
 * On a page it is one tag plus this script:
 *     <wce-nav></wce-nav>
 *     <script src="/wce-nav.js" defer></script>
 * Put the tag first in <body> (style="display:block;min-height:60px" holds its place until the
 * script runs, so the page doesn't jump). It is 60px tall on every screen. It pins itself to the top (position: sticky), so it needs no
 * spacer, and it publishes its height as the CSS variable --wce-nav-h on <html> for anything
 * else on the page that sticks to the top (offset it with top: var(--wce-nav-h, 0px)).
 *
 * Styles live in a shadow root, so a Savant page's own CSS can't restyle the ribbon and the
 * ribbon can't restyle the page. If the page doesn't already load IBM Plex Sans and Mono, the
 * ribbon adds them.
 *
 * Links marked spa: true are React routes. On a React page the ribbon fires a cancelable
 * 'wce-navigate' event first, so the router can switch pages without a reload; anywhere else
 * they are ordinary links.
 */
;(function () {
  'use strict'

  // ── The menu ────────────────────────────────────────────────────────────────────────────
  // A group with `items` is a dropdown on desktop and a labelled run of links on phones.
  // A group with `href` is a plain link. `match` (optional) lists extra path prefixes that
  // count as being on that page, e.g. every /articles/<slug> counts as Analysis.
  var WCE_NAV = {
    groups: [
      {
        label: 'Basketball',
        items: [
          // the /player/<slug> pages are search landing pages, kept out of the menu on purpose;
          // they count as Basketball Savant so the Basketball tab still lights up on them
          { label: 'Basketball Savant', href: '/basketball-savant.html', match: ['/player'] },
          { label: 'NBA Coaching Savant', href: '/basketball-coaching-savant.html' },
          { label: 'College Basketball Savant', href: '/college-basketball-savant.html' },
        ],
      },
      {
        label: 'Draft',
        items: [
          { label: 'Draft Savant', href: '/draft-savant.html' },
          { label: 'Big Board', href: '/rankings', spa: true },
          { label: 'Draft Hub', href: '/draft', spa: true },
        ],
      },
      {
        label: 'Football',
        items: [
          { label: 'Football Savant', href: '/football-savant.html', match: ['/game.html'] },
          { label: 'NFL Coaching Savant', href: '/coaching-savant.html' },
        ],
      },
      { label: 'UFC Savant', href: '/ufc-savant.html' },
      { label: 'Dynasty', href: '/dynasty', spa: true },
      {
        label: 'Read',
        items: [
          { label: 'Analysis', href: '/articles', spa: true, match: ['/articles/'] },
          { label: 'News', href: '/news', spa: true },
          { label: 'Newsletter', href: '/newsletter', spa: true },
        ],
      },
      {
        label: 'Games',
        items: [
          { label: 'Flappy Hoops', href: '/hoops', spa: true },
          { label: 'Comp Chain', href: '/comp-chain', spa: true },
        ],
      },
      {
        label: 'About',
        items: [
          { label: 'About WCE', href: '/about', spa: true },
          { label: 'Contact', href: '/contact', spa: true },
        ],
      },
    ],
    cta: { label: 'Subscribe', href: '/newsletter', spa: true },
  }

  // ── Helpers shared by the browser and the Node build ────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  // /basketball-savant and /basketball-savant.html are the same page (vercel.json redirects one
  // to the other); /player and /player/ too.
  function norm(p) {
    p = (p || '/').split('?')[0].split('#')[0].replace(/\.html$/, '')
    if (p.length > 1) p = p.replace(/\/+$/, '')
    return p || '/'
  }

  // On this page: the item's own path, or one of its `match` paths, or anything beneath one.
  function isOn(item, path) {
    var here = norm(path)
    return [item.href].concat(item.match || []).some(function (m) {
      var n = norm(m)
      return here === n || (n !== '/' && here.indexOf(n + '/') === 0)
    })
  }

  function groupOn(g, path) {
    return g.items ? g.items.some(function (i) { return isOn(i, path) }) : isOn(g, path)
  }

  // Plain links for crawlers and for anyone without JavaScript. Generated pages put this inside
  // <wce-nav>; once the script runs, the shadow root takes over and these stop showing.
  function fallbackHTML() {
    var out = []
    WCE_NAV.groups.forEach(function (g) {
      ;(g.items || [g]).forEach(function (i) { out.push('<a href="' + esc(i.href) + '">' + esc(i.label) + '</a>') })
    })
    return '<a href="/">Western Conference Elitists</a> ' + out.join(' ')
  }

  // Node reads this through vm.runInContext (player-pages.mjs) and picks up globalThis.WCE_NAV.
  globalThis.WCE_NAV = { nav: WCE_NAV, fallbackHTML: fallbackHTML, isOn: isOn }
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return
  if (customElements.get('wce-nav')) return

  // ── Browser: the <wce-nav> element ──────────────────────────────────────────────────────
  var CSS = [
    ':host{all:initial;display:block;position:sticky;top:0;z-index:900;',
    '--paper:#ECEBE8;--surface:#FFFFFF;--wash:#F4F3F0;--line:#DDDBD5;--line-soft:#E6E4DF;',
    '--ink:#191B1F;--muted:#4E535B;--faint:#676C75;--navy:#22395A;--navy-deep:#182B47;--gold:#C2A263;--gold-deep:#96793F;',
    '--sans:"IBM Plex Sans",system-ui,-apple-system,sans-serif;--mono:"IBM Plex Mono",ui-monospace,"SF Mono",monospace;',
    'font-family:var(--sans);color:var(--ink);-webkit-font-smoothing:antialiased;text-align:left;line-height:normal}',
    ':host([hidden]){display:none}',
    '*,*::before,*::after{box-sizing:border-box}',
    'a{color:inherit;text-decoration:none}',
    'button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer}',
    /* the hairline is a shadow, not a border, so the bar stays exactly 60px */
    '.bar{background:var(--paper);box-shadow:inset 0 -1px 0 transparent;transition:background-color .25s,box-shadow .25s}',
    ':host([data-scrolled]) .bar,:host([data-open]) .bar{background:rgba(236,235,232,.9);',
    '-webkit-backdrop-filter:saturate(1.2) blur(12px);backdrop-filter:saturate(1.2) blur(12px);box-shadow:inset 0 -1px 0 var(--line),0 1px 0 rgba(25,27,31,.02)}',
    'nav{max-width:1280px;margin:0 auto;height:60px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;gap:24px}',

    /* wordmark: the same badge + two-line name as the React site's Logo */
    '.logo{display:flex;align-items:center;gap:11px;flex:none}',
    '.badge{width:34px;height:34px;border-radius:9px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;',
    'font:700 12px/1 var(--sans);letter-spacing:-.01em;transition:background-color .25s}',
    '.logo:hover .badge{background:var(--navy-deep)}',
    '.word{display:flex;flex-direction:column;font:700 12.5px/1 var(--sans);letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}',
    '.word span{margin-top:3px;color:var(--navy)}',

    /* desktop row */
    '.row{display:flex;align-items:center;gap:2px}',
    '.top{position:relative;display:inline-flex;align-items:center;gap:6px;height:60px;padding:0 11px;',
    'font:500 10.5px/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;transition:color .15s}',
    '.top:hover,.grp:hover>.top,.grp.open>.top,.top:focus-visible{color:var(--ink)}',
    '.top.on{color:var(--ink)}',
    '.top.on::after{content:"";position:absolute;left:11px;right:11px;bottom:12px;height:3px;background:var(--gold)}',
    '.top:focus-visible{outline:2px solid var(--gold-deep);outline-offset:-6px;border-radius:4px}',
    '.caret{width:8px;height:8px;color:var(--faint);transition:transform .2s}',
    '.grp:hover .caret,.grp.open .caret{transform:rotate(180deg)}',
    '.grp{position:relative}',
    '.menu{position:absolute;left:0;top:100%;padding-top:2px;visibility:hidden;opacity:0;transform:translateY(-4px);',
    'transition:opacity .14s,transform .14s,visibility .14s;pointer-events:none}',
    '.grp:hover .menu,.grp.open .menu{visibility:visible;opacity:1;transform:none;pointer-events:auto}',
    '.grp.shut .menu{visibility:hidden;opacity:0;pointer-events:none}',
    '.grp.right .menu{left:auto;right:0}',
    '.panel{min-width:236px;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;',
    'box-shadow:0 18px 40px -18px rgba(25,27,31,.28),0 2px 6px rgba(25,27,31,.05)}',
    '.panel a{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;',
    'border-bottom:1px solid var(--line-soft);font:600 14px/1.2 var(--sans);color:var(--ink);transition:background-color .12s}',
    '.panel a:last-child{border-bottom:0}',
    '.panel a:hover,.panel a:focus-visible{background:var(--wash);outline:none}',
    '.panel a.on{background:var(--wash)}',
    '.panel a.on::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold)}',
    '.panel a .go{color:var(--gold-deep);font-size:12px;opacity:0;transform:translateX(-3px);transition:opacity .12s,transform .12s}',
    '.panel a:hover .go,.panel a:focus-visible .go{opacity:1;transform:none}',
    '.cta{flex:none;display:inline-flex;align-items:center;height:38px;padding:0 18px;border-radius:3px;background:var(--navy);color:#fff;',
    'font:500 11.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;transition:background-color .2s,box-shadow .2s,transform .2s;',
    'box-shadow:0 1px 2px rgba(24,43,71,.2)}',
    '.cta:hover{background:var(--navy-deep);transform:translateY(-1px);box-shadow:0 6px 16px -6px rgba(24,43,71,.45)}',
    '.cta:focus-visible{outline:2px solid var(--gold-deep);outline-offset:2px}',

    /* phones and narrow windows */
    '.burger{display:none;width:40px;height:40px;border:1px solid var(--line);border-radius:9px;background:var(--surface);',
    'align-items:center;justify-content:center;flex:none}',
    '.burger i{display:block;width:18px;height:1.5px;background:var(--ink);transition:transform .25s}',
    '.burger i+i{margin-top:5px}',
    ':host([data-open]) .burger i:first-child{transform:translateY(3.25px) rotate(45deg)}',
    ':host([data-open]) .burger i:last-child{transform:translateY(-3.25px) rotate(-45deg)}',
    '.burger span{display:flex;flex-direction:column}',
    '.sheet{display:none}',
    '@media (max-width:1120px){',
    '  nav{padding:0 16px}',
    '  .row,.desk-cta{display:none}',
    '  .burger{display:inline-flex}',
    '  .sheet{display:block;position:absolute;left:0;right:0;top:100%;max-height:0;overflow:hidden;background:var(--paper);',
    '  box-shadow:0 18px 30px -20px rgba(25,27,31,.35);transition:max-height .3s ease}',
    '  :host([data-open]) .sheet{max-height:calc(100dvh - 60px);overflow-y:auto;border-bottom:1px solid var(--line)}',
    '  .sheet-in{max-width:640px;margin:0 auto;padding:4px 20px 22px}',
    '  .sec{padding:14px 0 6px;border-bottom:1px solid var(--line-soft)}',
    '  .sec h3{margin:0 0 4px;font:500 10.5px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}',
    '  .sec a,.solo{display:flex;align-items:center;gap:10px;padding:10px 0;font:600 16px/1.2 var(--sans);color:var(--ink)}',
    '  .solo{padding:16px 0;border-bottom:1px solid var(--line-soft)}',
    '  .sec a.on::before,.solo.on::before{content:"";width:16px;height:3px;background:var(--gold);flex:none}',
    '  .sheet .cta{margin-top:18px;width:100%;justify-content:center;height:46px}',
    '}',
    '@media (max-width:380px){.word{font-size:11.5px}.badge{width:32px;height:32px}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}',
    '@media print{:host{display:none}}',
  ].join('\n')

  var CARET = '<svg class="caret" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  function linkAttrs(i, path, cls) {
    var on = isOn(i, path)
    return 'href="' + esc(i.href) + '"' + (i.spa ? ' data-spa' : '') +
      ' class="' + (cls || '') + (on ? ' on' : '') + '"' + (on ? ' aria-current="page"' : '')
  }

  function render(path) {
    var g = WCE_NAV.groups
    var desk = g.map(function (grp, n) {
      var on = groupOn(grp, path)
      if (!grp.items) return '<a ' + linkAttrs(grp, path, 'top') + '>' + esc(grp.label) + '</a>'
      var id = 'm' + n
      return '<div class="grp' + (n >= g.length - 2 ? ' right' : '') + '" data-group="' + esc(grp.label) + '">' +
        '<button type="button" class="top' + (on ? ' on' : '') + '" aria-expanded="false" aria-controls="' + id + '">' +
        esc(grp.label) + CARET + '</button>' +
        '<div class="menu" id="' + id + '"><div class="panel">' +
        grp.items.map(function (i) {
          return '<a ' + linkAttrs(i, path) + '>' + esc(i.label) + '<span class="go" aria-hidden="true">→</span></a>'
        }).join('') +
        '</div></div></div>'
    }).join('')
    var phone = g.map(function (grp) {
      if (!grp.items) return '<a ' + linkAttrs(grp, path, 'solo') + '>' + esc(grp.label) + '</a>'
      return '<div class="sec"><h3>' + esc(grp.label) + '</h3>' +
        grp.items.map(function (i) { return '<a ' + linkAttrs(i, path) + '>' + esc(i.label) + '</a>' }).join('') + '</div>'
    }).join('')
    var c = WCE_NAV.cta
    return '<style>' + CSS + '</style>' +
      '<div class="bar"><nav aria-label="Western Conference Elitists">' +
      '<a class="logo" href="/" data-spa aria-label="Western Conference Elitists, home">' +
      '<span class="badge">WCE</span><span class="word">Western Conference<span>Elitists</span></span></a>' +
      '<div class="row">' + desk + '</div>' +
      '<a class="cta desk-cta" href="' + esc(c.href) + '"' + (c.spa ? ' data-spa' : '') + '>' + esc(c.label) + '</a>' +
      '<button type="button" class="burger" aria-label="Open menu" aria-expanded="false" aria-controls="sheet"><span><i></i><i></i></span></button>' +
      '</nav>' +
      '<div class="sheet" id="sheet"><div class="sheet-in">' + phone +
      '<a class="cta" href="' + esc(c.href) + '"' + (c.spa ? ' data-spa' : '') + '>' + esc(c.label) + '</a>' +
      '</div></div></div>'
  }

  function ensureFonts() {
    var have = Array.prototype.some.call(document.querySelectorAll('link[href*="fonts.googleapis.com"]'), function (l) {
      return l.href.indexOf('IBM+Plex+Sans') > -1 && l.href.indexOf('IBM+Plex+Mono') > -1
    })
    if (have) return
    var l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;600;700&family=IBM+Plex+Mono:wght@500&display=swap'
    document.head.appendChild(l)
  }

  class WceNav extends HTMLElement {}
  WceNav.observedAttributes = ['current']

  WceNav.prototype.connectedCallback = function () {
    if (this._ready) return
    this._ready = true
    var self = this
    ensureFonts()
    this._root = this.attachShadow({ mode: 'open' })
    this._paint()

    // Clicks: dropdown toggles, the burger, and router hand-off for React routes.
    this._root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : e.target.parentElement
      var top = t.closest('button.top')
      if (top) {
        var grp = top.parentElement
        var willOpen = !grp.classList.contains('open')
        self._closeAll()
        if (willOpen) { grp.classList.add('open'); top.setAttribute('aria-expanded', 'true') }
        return
      }
      if (t.closest('.burger')) { self._setOpen(!self.hasAttribute('data-open')); return }
      var a = t.closest('a[href]')
      if (!a) return
      if (a.hasAttribute('data-spa') && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
        var ev = new CustomEvent('wce-navigate', { detail: { href: a.getAttribute('href') }, bubbles: true, composed: true, cancelable: true })
        if (!self.dispatchEvent(ev)) e.preventDefault()
      }
      self._closeAll()
      self._setOpen(false)
      // a mouse click leaves the pointer over the dropdown; hide it until the pointer leaves
      var g = a.closest('.grp')
      if (g) { g.classList.add('shut'); g.addEventListener('mouseleave', function () { g.classList.remove('shut') }, { once: true }) }
    })
    this._outside = function (e) { if (e.composedPath().indexOf(self) < 0) { self._closeAll(); self._setOpen(false) } }
    this._key = function (e) { if (e.key === 'Escape') { self._closeAll(); self._setOpen(false) } }
    this._scroll = function () {
      if (window.scrollY > 4) self.setAttribute('data-scrolled', '')
      else self.removeAttribute('data-scrolled')
    }
    document.addEventListener('click', this._outside)
    document.addEventListener('keydown', this._key)
    window.addEventListener('scroll', this._scroll, { passive: true })
    this._scroll()

    // Publish the bar's height for anything else that sticks to the top of the page.
    var bar = this._root.querySelector('nav')
    var publish = function () { document.documentElement.style.setProperty('--wce-nav-h', bar.offsetHeight + 'px') }
    publish()
    if (window.ResizeObserver) { this._ro = new ResizeObserver(publish); this._ro.observe(bar) }
  }

  WceNav.prototype.disconnectedCallback = function () {
    document.removeEventListener('click', this._outside)
    document.removeEventListener('keydown', this._key)
    window.removeEventListener('scroll', this._scroll)
    if (this._ro) this._ro.disconnect()
    this._ready = false
  }

  WceNav.prototype.attributeChangedCallback = function () { if (this._root) this._paint() }

  WceNav.prototype._paint = function () {
    this._root.innerHTML = render(this.getAttribute('current') || location.pathname)
    this.removeAttribute('data-open')
  }

  WceNav.prototype._closeAll = function () {
    Array.prototype.forEach.call(this._root.querySelectorAll('.grp.open'), function (g) {
      g.classList.remove('open')
      g.querySelector('.top').setAttribute('aria-expanded', 'false')
    })
  }

  WceNav.prototype._setOpen = function (open) {
    var b = this._root && this._root.querySelector('.burger')
    if (open) this.setAttribute('data-open', '')
    else this.removeAttribute('data-open')
    if (b) { b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', open ? 'Close menu' : 'Open menu') }
  }

  customElements.define('wce-nav', WceNav)
})()
