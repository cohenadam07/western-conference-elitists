// Test: Live Lineups usage events in the real page. The beacons to /api/ll-usage are intercepted and read.
//   every event kind fires (open, tab, pick, drawer + sections, downloads, halftime, banner, heartbeat), each tagged
//   with one session id; nothing but enumerated values goes out; ?me=1 sends nothing and sticks until ?me=0; the kill
//   switch stops it; a failing or hanging endpoint changes nothing on the page.
// usage: LL_CHROME=... node tools/live-lineups/usage-page-test.mjs   (static server on :4173 serving public/)
//        LL_BASE=<preview url> LL_REAL=1 ... sends real beacons instead (no interception) and prints the session ids
import { chromium } from 'playwright'; import fs from 'node:fs';
const BASE = process.env.LL_BASE || 'http://localhost:4173'; const REAL = process.env.LL_REAL === '1';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const results = []; const ok = (p, w) => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${w}`); };
const share = process.env.LL_SHARE; // a preview's _vercel_share link, opened once per context to set the cookie

async function open(path, { beacon = 'ok', ctx = null, viewport = { width: 1440, height: 900 }, cfg = null, block = false } = {}) {
  const c = ctx || await b.newContext({ userAgent: UA, viewport, acceptDownloads: true, hasTouch: viewport.width < 1100 });
  if (share && !ctx) { const p0 = await c.newPage(); await p0.goto(share); await p0.close(); }
  const p = await c.newPage(); const P = { p, c, beacons: [], errs: [] };
  p.on('pageerror', e => P.errs.push(String(e))); p.on('console', m => m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text()) && P.errs.push(m.text()));
  p.on('request', r => { if (r.url().includes('/api/ll-usage') && r.method() === 'POST') { try { P.beacons.push(JSON.parse(r.postData())); } catch { P.beacons.push({ bad: r.postData() }); } } });
  if (!REAL) await p.route('**/api/ll-usage*', r => beacon === 'fail' ? r.abort() : beacon === 'hang' ? null : r.fulfill({ status: 204 }));
  if (cfg) await p.route('**/live-lineups/config.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg()) }));
  if (block) { await p.route('**/summary?event=*', r => r.abort()); await p.route('**/api/espn-summary**', r => r.abort()); }
  await p.goto(`${BASE}${path}`);
  return P;
}
const events = P => P.beacons.flatMap(x => x.e || []);
const kinds = P => events(P).map(e => e[1]);
const flush = P => P.p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('pagehide')); });
const hide = P => P.p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });

// 1. a replay of OU vs Purdue Fort Wayne (401906803), using every part of the page
const A = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00');
await A.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await A.p.waitForTimeout(1500);
await A.p.locator('[data-tab="shots"]:visible').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('.opt[data-sel]:not([data-sel=""])').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('.opt[data-sel=""]').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('[data-tab="players"]:visible').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('[data-tab="now"]:visible').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('[data-five]').first().click(); await A.p.waitForTimeout(200);
await A.p.locator('[data-tab="now"]:visible').first().click();
await A.p.locator('[data-act="drawer"]').click(); await A.p.waitForSelector('.drawer');
for (const seg of ['players', 'shooting', 'opp']) { await A.p.locator(`[data-seg="${seg}"]`).click(); await A.p.waitForTimeout(100); }
await A.p.locator('.drawer [data-act="drawer-close"]').first().click();
await A.p.locator('[data-tab="sheet"]:visible').first().click();
await A.p.waitForFunction(() => { const s = window.__ll.sheet(); return s && !s.loading && s.ready; }, null, { timeout: 120000 });
for (const [scope, act] of [['game', 'xlsx'], ['game', 'csv'], ['season', 'xlsx'], ['season', 'csv']]) {
  await A.p.locator(`[data-scope="${scope}"]`).click(); await A.p.waitForTimeout(100);
  await Promise.all([A.p.waitForEvent('download'), A.p.locator(`.sheetbar [data-act="${act}"]`).click()]);
}
await A.p.evaluate(() => window.__llControl.seek(1200)); await A.p.waitForTimeout(500); // halftime
const footer = await A.p.evaluate(() => document.querySelector('.ver')?.textContent);
await hide(A); await A.p.waitForTimeout(500);
const E = events(A); const K = kinds(A);
const sids = new Set(A.beacons.map(x => x.s));
const open1 = E.find(e => e[1] === 'open');
ok(sids.size === 1 && /^[a-f0-9]{16}$/.test([...sids][0]), `one random session id on every batch (${[...sids]})`);
ok(open1 && open1[2].team === '201' && open1[2].mode === 'replay' && open1[2].dev === 'desktop' && open1[2].ver === '1.0.1', `open: ${JSON.stringify(open1?.[2])}`);
const tabs = E.filter(e => e[1] === 'tab').map(e => e[2].tab);
ok(JSON.stringify(tabs) === JSON.stringify(['now', 'shots', 'players', 'now', 'shots', 'now', 'sheet']), `every tab view: ${tabs}`);
const picks = E.filter(e => e[1] === 'pick').map(e => [e[2].from, e[2].sel ? 'five' : 'whole', e[2].label]);
ok(picks.length === 3 && picks[0][0] === 'picker' && picks[0][1] === 'five' && /,/.test(picks[0][2]) && picks[1][2] === 'Whole game' && picks[2][0] === 'list', `lineup picks: ${JSON.stringify(picks)}`);
const segs = E.filter(e => e[1] === 'seg').map(e => e[2].seg);
ok(K.filter(k => k === 'drawer').length === 1 && JSON.stringify(segs) === '["lineups","players","shooting","opp"]', `drawer open + sections: ${segs}`);
const dls = E.filter(e => e[1] === 'download').map(e => `${e[2].fmt}/${e[2].scope}`);
ok(JSON.stringify(dls) === '["xlsx/game","csv/game","xlsx/season","csv/season"]', `downloads: ${dls}`);
ok(K.filter(k => k === 'half').length === 1, `halftime shown: ${K.filter(k => k === 'half').length}`);
ok(footer === 'Version 1.0.1', `footer: ${footer}`);
const allKeys = new Set(E.flatMap(e => Object.keys(e[2] || {}))); const top = new Set(A.beacons.flatMap(x => Object.keys(x)));
ok([...top].sort().join() === 'e,s' && [...allKeys].every(k => ['team', 'mode', 'dev', 'ver', 'tab', 'st', 'sel', 'label', 'from', 'seg', 'fmt', 'scope', 'kind', 'p', 'vis'].includes(k)) && !/Mozilla|Chrome|HeadlessChrome/.test(JSON.stringify(A.beacons)), `only enumerated fields go out: ${[...top]} / ${[...allKeys]}`);
ok(A.errs.length === 0, `console/page errors: ${A.errs.length} ${A.errs.slice(0, 2)}`);

// 2. a phone on the live path, with ESPN unreachable (banner), then the heartbeat after 60 s
const B = await open('/live-lineups.html?game=401906804&team=201', { viewport: { width: 390, height: 844 }, block: true });
await B.p.waitForTimeout(65000); await flush(B); await B.p.waitForTimeout(300);
const EB = events(B);
ok(EB.find(e => e[1] === 'open')?.[2].dev === 'phone' && EB.find(e => e[1] === 'open')?.[2].mode === 'live', `phone open: ${JSON.stringify(EB.find(e => e[1] === 'open')?.[2])}`);
ok(EB.some(e => e[1] === 'banner' && e[2].kind === 'unreachable'), `banner "can't reach ESPN": ${JSON.stringify(EB.filter(e => e[1] === 'banner'))}`);
ok(EB.filter(e => e[1] === 'hb').length >= 1, `heartbeat after 60 s: ${EB.filter(e => e[1] === 'hb').length}`);
ok(B.beacons.length <= 3, `batched: ${EB.length} events in ${B.beacons.length} beacons`);

// 3. ?me=1 sends nothing, and keeps sending nothing without it until ?me=0
const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
if (share) { const p0 = await ctx.newPage(); await p0.goto(share); await p0.close(); }
const M1 = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00&me=1', { ctx });
await M1.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await M1.p.locator('[data-tab="shots"]:visible').first().click(); await flush(M1); await M1.p.waitForTimeout(500);
const M2 = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00', { ctx });
await M2.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await M2.p.locator('[data-tab="players"]:visible').first().click(); await flush(M2); await M2.p.waitForTimeout(500);
const M3 = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00&me=0', { ctx });
await M3.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await flush(M3); await M3.p.waitForTimeout(500);
ok(M1.beacons.length === 0 && M2.beacons.length === 0, `?me=1: ${M1.beacons.length} beacons; later visit without it: ${M2.beacons.length}`);
ok(M3.beacons.length >= 1 && kinds(M3).includes('open'), `?me=0 turns it back on: ${kinds(M3)}`);
const flag = await M2.p.evaluate(() => localStorage.getItem('ll-me'));
ok(flag === null, `flag cleared after ?me=0 (${flag})`);

// 4. kill switch off -> nothing more is sent
let cfg = { enabled: true, teams: ['201'], message: 'Off for the test.' };
const KS = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00', { cfg: () => cfg });
await KS.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await flush(KS); await KS.p.waitForTimeout(300);
const before = KS.beacons.length; cfg = { ...cfg, enabled: false };
await KS.p.waitForSelector('[data-killed]', { timeout: 20000 });
await KS.p.locator('body').click().catch(() => {}); await flush(KS); await KS.p.waitForTimeout(500);
ok(before >= 1 && KS.beacons.length === before, `kill switch off: beacons before ${before}, after ${KS.beacons.length}`);

// 5. the endpoint failing or hanging changes nothing
for (const mode of ['fail', 'hang']) {
  const F = await open('/live-lineups.html?replay=401906803&speed=0&at=2-9:00', { beacon: mode });
  const t0 = Date.now(); await F.p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 });
  for (const t of ['shots', 'players', 'sheet', 'now']) { await F.p.locator(`[data-tab="${t}"]:visible`).first().click(); await flush(F); }
  const fine = await F.p.evaluate(() => !!document.querySelector('.now-main') && document.querySelector('.ver')?.textContent === 'Version 1.0.1');
  ok(fine && F.errs.length === 0 && Date.now() - t0 < 15000, `endpoint ${mode}: page works (${fine}), errors ${F.errs.length}, ${Date.now() - t0} ms`);
}
if (REAL) console.log('sessions sent for real:', [...sids, ...new Set(B.beacons.map(x => x.s))].join(' '));
fs.writeFileSync(process.env.LL_OUT || '/dev/null', JSON.stringify({ A: A.beacons, B: B.beacons }, null, 1));
await b.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
