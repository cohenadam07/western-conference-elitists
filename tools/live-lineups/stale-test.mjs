// Test: "Data delayed" never shows during a media timeout or halftime, and does show when the feed is really behind.
// Serves 401906803's real ESPN summary cut at a moment, through the live code path (?game=), on a fake clock.
import { chromium } from 'playwright'; import fs from 'node:fs'; import zlib from 'node:zlib'; import os from 'node:os';
const OUT = 'research/live-lineups-test/stale'; fs.mkdirSync(OUT, { recursive: true });
const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${os.homedir()}/Basketball-Savant/espn-cache/cbb/2026-27/raw/401906803.json.gz`)));
const iTO = raw.plays.findIndex(p => p.type.text === 'OfficialTVTimeOut' && p.clock.displayValue === '15:01');
const iHalf = raw.plays.findIndex(p => p.type.text === 'End Period' && p.period.number === 1);
const cut = (n, period, clock, name = 'STATUS_IN_PROGRESS') => { const r = structuredClone(raw); r.plays = r.plays.slice(0, n + 1);
  const last = r.plays[r.plays.length - 1]; for (const c of r.header.competitions[0].competitors) c.score = String(c.homeAway === 'home' ? last.homeScore : last.awayScore);
  r.header.competitions[0].status = { period, displayClock: clock, type: { state: 'in', name, completed: false, shortDetail: clock } }; return r; };
let serve = cut(iTO, 1, '15:01'); let fail = false;
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.route('**/summary?event=401906803*', r => (fail ? r.abort('internetdisconnected') : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(serve) })));
await p.route('**/api/espn-summary**', r => r.fulfill({ status: 503, body: '' }));
await p.route('**/teams/201/schedule', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"events":[]}' }));
await p.clock.install({ time: new Date('2026-11-10T01:20:00Z') });
await p.goto('http://localhost:4173/live-lineups.html?game=401906803'); await p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 });
const log = []; const banner = () => p.evaluate(() => [...document.querySelectorAll('.banner')].map(b => b.innerText.replace(/\s+/g, ' ')).join(' | '));
async function phase(name, seconds, wantDelayed) {
  let seen = false, polls = 0; const samples = [];
  for (let s = 0; s < seconds; s += 5) { await p.clock.runFor(5000); await p.waitForTimeout(120); const t = await banner(); if (/Data delayed/.test(t)) seen = true; samples.push(t); }
  const clk = await p.evaluate(() => document.querySelector('.clk').innerText + ' ' + document.querySelector('.per').innerText);
  const ok = seen === wantDelayed; log.push({ phase: name, fakeSeconds: seconds, band: clk, dataDelayedShown: seen, expected: wantDelayed, ok, lastBanner: samples[samples.length - 1] || '(none)' });
  await p.screenshot({ path: `${OUT}/${name}.png` });
}
await phase('media-timeout-1st-half-15-01', 150, false);           // clock stopped at 15:01, no new plays, polls keep succeeding
serve = cut(iHalf, 1, '0:00', 'STATUS_HALFTIME'); await phase('halftime', 150, false);
serve = cut(iTO, 1, '15:01'); await p.clock.runFor(16000); await p.waitForTimeout(150);
serve = cut(iTO, 1, '13:55'); await phase('control-clock-runs-66s-no-plays', 30, true);  // ESPN's clock ran 1:06 with no plays
serve = cut(iTO, 1, '15:01'); await p.clock.runFor(16000); fail = true; await phase('control-espn-unreachable', 90, true);
await b.close();
fs.writeFileSync(`${OUT}/stale-results.json`, JSON.stringify(log, null, 1));
for (const l of log) console.log(`${l.ok ? 'PASS' : 'FAIL'} ${l.phase}: ${l.fakeSeconds}s, band "${l.band}", Data delayed shown ${l.dataDelayedShown} (want ${l.expected}); banner: ${l.lastBanner}`);
