// Test: the kill switch in /live-lineups/config.json. Both states, on every kind of open screen.
//   on:  enabled true and the team listed -> the page runs and keeps polling ESPN
//   off: enabled false, or the team not listed -> within one refresh (config is read every 10 s on every screen), polling
//        stops and only the message shows; nothing more goes to ESPN
//   config missing or unparseable -> keep running; switched back on -> the page starts again by itself
// ESPN is stubbed with saved feeds (MARQ at MICH, 401909524, Michigan = 130). config.json is stubbed per page, except in
// the last two checks, which read the real file in public/ (teams ["201"]).
// usage: LL_CHROME=... node tools/live-lineups/kill-switch-test.mjs   (static server on :4173 serving public/)
import { chromium } from 'playwright'; import fs from 'node:fs'; import zlib from 'node:zlib';
const BASE = process.env.LL_BASE || 'http://localhost:4173';
const GID = '401909524';
const tip = JSON.parse(fs.readFileSync('research/live-lineups-test/live/feeds/401909524-tip-3plays.json'));
const final = JSON.parse(zlib.gunzipSync(fs.readFileSync('research/live-lineups-test/live/feeds/401909524-final.json.gz')));
const pre = structuredClone(tip); pre.plays = []; for (const c of pre.header.competitions[0].competitors) delete c.score;
Object.assign(pre.header.competitions[0].status, { displayClock: '0:00', period: 0 }); Object.assign(pre.header.competitions[0].status.type, { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false });
const FEEDS = { pre, live: tip, final };
const ON = { enabled: true, teams: ['130'], message: 'This page is no longer available.' };
const OFF = { ...ON, enabled: false, message: 'Switched off for the test.' };
const NOT_LISTED = { ...ON, teams: ['201'], message: 'Not your team.' };

const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const results = []; const ok = (pass, what) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${what}`); };

async function open({ feed = 'live', cfg = ON, cfgStatus = 200, cfgBody = null, drawer = false, team = '130', game = GID, realConfig = false }) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const P = { p, ctx, cfg, cfgStatus, cfgBody, espn: [], cfgReads: [], errs: [] };
  p.on('pageerror', e => P.errs.push(String(e))); p.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && P.errs.push(m.text()));
  p.on('request', r => { const u = r.url(); if (u.includes('site.api.espn.com') || u.includes('/api/espn-summary')) P.espn.push([Date.now(), u]); if (u.includes('/live-lineups/config.json')) P.cfgReads.push(Date.now()); });
  const json = body => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  await p.route(`**/summary?event=${GID}*`, r => r.fulfill(json(FEEDS[feed])));
  await p.route('**/teams/*/schedule', r => r.fulfill(json('{"events":[]}')));
  await p.route('**/api/espn-summary**', r => r.fulfill({ status: 500, body: '' }));
  if (!realConfig) await p.route('**/live-lineups/config.json*', r => P.cfgBody != null ? r.fulfill({ status: P.cfgStatus, contentType: 'application/json', body: P.cfgBody }) : r.fulfill({ status: P.cfgStatus, contentType: 'application/json', body: JSON.stringify(P.cfg) }));
  await p.goto(`${BASE}/live-lineups.html?team=${team}${game ? `&game=${game}` : ''}${drawer ? '&drawer=1' : ''}`);
  return P;
}
const look = p => p.evaluate(() => ({ killed: !!document.querySelector('[data-killed]'), only: document.getElementById('app').children.length === 1 && !!document.querySelector('#app > [data-killed]'),
  text: document.getElementById('app').innerText.replace(/\s+/g, ' ').trim().slice(0, 90), pre: !!document.querySelector('main.pre'), now: !!document.querySelector('.now-main'), drawer: !!document.querySelector('.drawer'), title: document.title }));
async function untilKilled(P, maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if ((await look(P.p)).killed) return Date.now() - t0; await P.p.waitForTimeout(250); } return null; }

// 1. on: each screen runs and polls
const screens = [['pre-game (60 s poll)', { feed: 'pre' }, '.pre, main.pre'], ['live (15 s poll)', { feed: 'live' }, '.now-main'], ['live with the drawer open', { feed: 'live', drawer: true }, '.drawer'], ['final (no poll)', { feed: 'final' }, '.band, main']];
const pages = await Promise.all(screens.map(async ([name, o, sel]) => { const P = await open(o); await P.p.waitForSelector(sel, { timeout: 30000 }); return [name, P]; }));
for (const [name, P] of pages) { const L = await look(P.p); ok(!L.killed && L.text.length > 20, `on, ${name}: page runs ("${L.text.slice(0, 60)}")`); }
await pages[1][1].p.waitForTimeout(16000);
ok(pages[1][1].espn.filter(([, u]) => u.includes('summary')).length >= 2, `on, live: still polling ESPN after 16 s (${pages[1][1].espn.length} ESPN requests)`);

// 2. off: flip every open page; each shows only the message within one refresh (<= 15 s) and stops calling ESPN
for (const [, P] of pages) P.cfg = OFF;
const tFlip = Date.now();
const took = await Promise.all(pages.map(([, P]) => untilKilled(P, 20000)));
for (let i = 0; i < pages.length; i++) {
  const [name, P] = pages[i]; const L = await look(P.p);
  ok(took[i] != null && took[i] <= 15000 && L.only && L.text === OFF.message && !L.drawer, `off, ${name}: only the message after ${took[i] == null ? 'never' : (took[i] / 1000).toFixed(1) + ' s'} ("${L.text}")`);
}
await pages[0][1].p.waitForTimeout(65000); // longer than the pre-game poll, so a missed stop would show
for (const [name, P] of pages) {
  const after = P.espn.filter(([t]) => t > tFlip + 15000).length; const L = await look(P.p);
  ok(after === 0 && L.only, `off, ${name}: 0 ESPN requests in the 65 s after the stop (still only the message: ${L.only})`);
}

// 3. back on: the page starts again without a manual reload
{ const P = pages[1][1]; P.cfg = ON; let back = null; const t0 = Date.now();
  while (Date.now() - t0 < 25000) { const L = await look(P.p).catch(() => ({})); if (L.now) { back = Date.now() - t0; break; } await P.p.waitForTimeout(250); }
  ok(back != null && back <= 20000, `back on, live: live view returns by itself after ${back == null ? 'never' : (back / 1000).toFixed(1) + ' s'}`); }

// 4. off on load: team not listed, and enabled false -> message only, and ESPN is never called
for (const [name, cfg] of [['team not in teams', NOT_LISTED], ['enabled false', OFF]]) {
  const P = await open({ feed: 'live', cfg }); await P.p.waitForSelector('[data-killed]', { timeout: 10000 }).catch(() => {}); await P.p.waitForTimeout(3000); const L = await look(P.p);
  ok(L.only && L.text === cfg.message && P.espn.length === 0, `off on load, ${name}: "${L.text}", ESPN requests ${P.espn.length}`); await P.ctx.close();
}

// 5. config can't be fetched or parsed -> keep running
for (const [name, o] of [['config 404', { cfgStatus: 404, cfgBody: 'not found' }], ['config not JSON', { cfgBody: '{"enabled": fal' }], ['config 500', { cfgStatus: 500, cfgBody: '' }]]) {
  const P = await open({ feed: 'live', ...o }); await P.p.waitForSelector('.now-main', { timeout: 30000 }).catch(() => {}); await P.p.waitForTimeout(16000); const L = await look(P.p);
  ok(L.now && !L.killed && P.espn.filter(([, u]) => u.includes('summary')).length >= 2, `${name}: keeps running and polling (live view ${L.now}, ESPN requests ${P.espn.length})`); await P.ctx.close();
}
// ...and a page that is running keeps running when config later fails
{ const P = await open({ feed: 'live' }); await P.p.waitForSelector('.now-main', { timeout: 30000 }); P.cfgStatus = 503; P.cfgBody = '';
  const n0 = P.espn.length; await P.p.waitForTimeout(31000); const L = await look(P.p);
  ok(L.now && !L.killed && P.espn.length - n0 >= 2, `config starts failing mid-game: keeps running (${P.espn.length - n0} more ESPN requests in 31 s)`); await P.ctx.close(); }

// 6. the real public/live-lineups/config.json: on for 201, off for any other team
{ const P = await open({ team: '201', game: null, realConfig: true }); await P.p.waitForTimeout(4000); const L = await look(P.p); const real = JSON.parse(fs.readFileSync('public/live-lineups/config.json'));
  ok(real.enabled === true && JSON.stringify(real.teams) === '["201"]' && !L.killed && P.espn.length > 0, `real config.json, team 201: on (${JSON.stringify(real)}), page went on to ESPN (${P.espn.length} requests, "${L.text}")`); await P.ctx.close(); }
{ const P = await open({ team: '130', realConfig: true }); await P.p.waitForSelector('[data-killed]', { timeout: 10000 }).catch(() => {}); const L = await look(P.p);
  ok(L.only && L.text === 'This page is no longer available.' && P.espn.length === 0, `real config.json, team 130: "${L.text}", ESPN requests ${P.espn.length}`); await P.ctx.close(); }

const errs = pages.flatMap(([, P]) => P.errs); ok(errs.length === 0, `console/page errors: ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
