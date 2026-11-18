// Live Lineups usage events: small, batched, fire-and-forget. Nothing here can block, slow or break the page:
// every call is wrapped, the queue is capped, and batches go out with navigator.sendBeacon (which never waits for an
// answer). No IP, user agent, location, cookies or anything typed is sent; only a random session id made on load,
// a time, an event kind and a few enumerated values. The server (api/_ll-usage.js) drops anything else.
//
// Off when: ?me=1 was opened on this device (until ?me=0), the kill switch is off, or the browser has no sendBeacon.
const ENDPOINT = '/api/ll-usage';
const FLAG = 'll-me';
const MAX_QUEUE = 200, FLUSH_AT = 25, HEARTBEAT_MS = 60000;

function optedOut(qs) {
  try {
    const me = qs.get('me');
    if (me === '1') localStorage.setItem(FLAG, '1');
    else if (me === '0') localStorage.removeItem(FLAG);
    return localStorage.getItem(FLAG) === '1';
  } catch { return qs.get('me') === '1'; } // storage blocked: honour the address for this visit
}
function sessionId() {
  try { const b = new Uint8Array(8); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch { return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
}
// coarse device class from the screen, never the user agent: phone, tablet (a touch screen up to iPad Pro size), desktop
export function deviceClass(w = screen.width, h = screen.height, touch = navigator.maxTouchPoints || 0) {
  const short = Math.min(w, h), long = Math.max(w, h);
  if (short < 600) return 'phone';
  if (touch > 0 && short <= 1100 && long <= 1400) return 'tablet';
  return 'desktop';
}

export function createUsage(qs, { isOff = () => false, gameState = () => ({}) } = {}) {
  let on = false; const sid = sessionId(); let q = []; let hb = null;
  try { on = !optedOut(qs) && typeof navigator.sendBeacon === 'function'; } catch { on = false; }
  const live = () => on && !isOff();
  function flush() {
    if (!q.length) return;
    if (!live()) { q = []; return; }
    const batch = q.splice(0, 60);
    try { navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify({ s: sid, e: batch })], { type: 'text/plain' })); } catch { /* lost: fine */ }
    if (q.length) flush();
  }
  function track(kind, data) {
    try {
      if (!live()) { q = []; return; }
      q.push(data ? [Date.now(), kind, data] : [Date.now(), kind]);
      if (q.length > MAX_QUEUE) q = q.slice(-MAX_QUEUE);
      if (q.length >= FLUSH_AT) flush();
    } catch { /* never let tracking throw */ }
  }
  function beat() {
    try {
      if (!live()) { q = []; return; }
      if (document.visibilityState === 'visible') { const g = gameState() || {}; track('hb', { st: g.st, p: g.p, vis: '1' }); }
      flush();
    } catch { /* ignore */ }
  }
  if (on) {
    hb = setInterval(beat, HEARTBEAT_MS);
    try {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      addEventListener('pagehide', flush);
    } catch { /* ignore */ }
  }
  return { track, flush, sid, get on() { return live(); }, stop() { on = false; q = []; clearInterval(hb); } };
}
