// Test: api/_ll-usage.js against an in-memory Upstash stand-in (RPUSH, LTRIM, EXPIRE, LRANGE over /pipeline).
// Intake through the real api/analytics/history.js dispatcher, field whitelisting, the session check, and the
// Control Room summary read by api/_status.js (part=ll).   usage: node tools/live-lineups/usage-server-test.mjs
import http from 'node:http';
const db = new Map();
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, k, ...a]) => {
      const l = db.get(k) || [];
      if (cmd === 'RPUSH') { l.push(...a); db.set(k, l); return { result: l.length }; }
      if (cmd === 'LTRIM') { const s = Number(a[0]); db.set(k, s < 0 ? l.slice(s) : l); return { result: 'OK' }; }
      if (cmd === 'EXPIRE') return { result: 1 };
      if (cmd === 'LRANGE') return { result: l };
      if (cmd === 'HGETALL') return { result: [] };
      return { error: 'unsupported ' + cmd };
    });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
  });
});
await new Promise(r => srv.listen(0, r));
process.env.KV_REST_API_URL = `http://127.0.0.1:${srv.address().port}`; process.env.KV_REST_API_TOKEN = 't'; process.env.VERCEL_ENV = 'production'; process.env.WCE_STATUS_KEY = 'wcs_' + 'a'.repeat(48);
const { default: history } = await import(process.cwd() + '/api/analytics/history.js');
const call = (method, url, body) => new Promise(done => {
  const u = new URL(url, 'http://x'); const req = { method, url, query: Object.fromEntries(u.searchParams), headers: { host: 'x' }, body };
  const res = { code: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, end() { done({ code: this.code }); }, json(o) { done({ code: this.code, json: o }); }, send(o) { done({ code: this.code, body: o }); } };
  history(req, res);
});
const results = []; const ok = (p, w) => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${w}`); };
const sid = '0123456789abcdef'; const now = Date.now();
const batch = { s: sid, ua: 'Mozilla/5.0 should be dropped', ip: '1.2.3.4', e: [
  [now, 'open', { team: '201', mode: 'live', dev: 'phone', ver: '1.0.1', ua: 'Mozilla', ip: '1.2.3.4' }],
  [now + 1, 'tab', { tab: 'shots', st: 'live' }],
  [now + 2, 'pick', { sel: '123|456|789|1011|1213', label: 'Brown, Isaacs, Reid, Brennan, Rogers', from: 'picker', st: 'live' }],
  [now + 3, 'drawer', { st: 'live' }], [now + 4, 'seg', { seg: 'players', st: 'live' }],
  [now + 5, 'download', { fmt: 'xlsx', scope: 'game', st: 'final' }], [now + 6, 'half'], [now + 7, 'banner', { kind: 'delayed' }],
  [now + 8, 'hb', { st: 'live', p: '1', vis: '1' }], [now + 9, 'hb', { st: 'half', vis: '1' }],
  [now + 10, 'tab', { tab: '<script>alert(1)</script>' }], [now + 11, 'typed', { text: 'secret' }], [now + 12, 'pick', { label: 'x'.repeat(500) }],
] };
const w = await call('POST', '/api/analytics/history?section=ll-usage', JSON.stringify(batch));
ok(w.code === 204, `beacon batch accepted (${w.code})`);
const stored = [...db.entries()];
const raw = stored.map(([, l]) => l.join('\n')).join('\n');
ok(stored.length === 1 && stored[0][0].startsWith('wce:ll:prod:d:'), `stored under ${stored.map(x => x[0])}`);
ok(!/Mozilla|1\.2\.3\.4|secret|script|xxxxx/.test(raw), 'no user agent, IP, typed text, markup or oversized label stored');
const evs = stored[0][1].map(x => JSON.parse(x));
ok(evs.length === 12 && evs.filter(e => e.k === 'typed').length === 0, `12 events kept, unknown kind dropped (${evs.length})`);
ok(Object.keys(evs[0]).sort().join() === 'dev,k,mode,s,t,team,ver', `open keeps only its fields: ${Object.keys(evs[0]).join(',')}`);
ok(evs.find(e => e.k === 'tab' && !e.tab) && evs.filter(e => e.k === 'tab' && e.tab === 'shots').length === 1, 'a tab outside the list keeps no value');
for (const bad of [{ s: 'nope', e: [] }, { s: sid }, 'not json']) { const r = await call('POST', '/api/analytics/history?section=ll-usage', typeof bad === 'string' ? bad : JSON.stringify(bad)); ok(r.code === 400, `bad batch rejected (${r.code})`); }
const big = await call('POST', '/api/analytics/history?section=ll-usage', JSON.stringify({ s: 'fedcba9876543210', e: Array.from({ length: 500 }, (_, i) => [now + i, 'hb', { st: 'pre', vis: '1' }]) }));
ok(big.code === 204 && db.get(stored[0][0]).length === 12 + 60, `a 500-event batch is capped at 60 (${db.get(stored[0][0]).length - 12})`);
const chk = await call('GET', `/api/analytics/history?section=ll-usage&check=${sid}`);
ok(chk.code === 200 && chk.json.events === 12 && chk.json.kinds.hb === 2 && chk.json.env === 'prod', `session check: ${JSON.stringify(chk.json)}`);
const noKey = await call('GET', '/api/analytics/history?section=status&part=ll');
ok(noKey.code === 401, `Control Room summary without the key: ${noKey.code}`);
const sum = await call('GET', `/api/analytics/history?section=status&part=ll&key=${process.env.WCE_STATUS_KEY}`);
const T = sum.json?.totals; const S0 = sum.json?.sessions?.find(s => s.id === sid);
ok(sum.code === 200 && sum.json.days.length === 14 && sum.json.days.at(-1).sessions === 2 && sum.json.days.at(-1).opens === 1, `per day: ${JSON.stringify(sum.json?.days?.at(-1))}`);
ok(T.tabs[0]?.name === 'shots' && T.picks[0]?.name.startsWith('Brown') && T.downloads[0]?.name === 'xlsx · This game' && T.drawer === 1 && T.halftime === 1 && T.banners[0]?.name === 'delayed', `totals: ${JSON.stringify(T).slice(0, 300)}`);
ok(S0 && S0.dev === 'phone' && S0.minutes['live 1st half'] === 1 && S0.minutes.halftime === 1 && S0.events.every(e => !('s' in e)), `session timeline: ${JSON.stringify(S0).slice(0, 260)}`);
process.env.VERCEL_ENV = 'preview';
srv.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
