// Test: ESPN's status still says Halftime after 2nd-half plays arrive (seen live on FDU at ETAM, Nov 11). The page shows
// halftime while only the 20:00 substitutions are in, and the 2nd half as soon as a real play is.
// usage: LL_CHROME=... node tools/live-lineups/half-lag-test.mjs   (local server on 4173)
import { chromium } from 'playwright'; import fs from 'node:fs'; import zlib from 'node:zlib'; import os from 'node:os';
const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${os.homedir()}/Basketball-Savant/espn-cache/cbb/2026-27/raw/401906803.json.gz`)));
const i2 = raw.plays.findIndex(p => p.period.number === 2 && p.type.text !== 'Substitution');
const iSubs = i2 - 1; // last 2nd-half 20:00 substitution before the first real play
const cut = n => { const r = structuredClone(raw); r.plays = r.plays.slice(0, n + 1); const last = r.plays[r.plays.length - 1];
  for (const c of r.header.competitions[0].competitors) c.score = String(c.homeAway === 'home' ? last.homeScore : last.awayScore);
  r.header.competitions[0].status = { period: 1, displayClock: '0:00', type: { state: 'in', name: 'STATUS_HALFTIME', completed: false, shortDetail: 'Halftime' } }; return r; };
const b = await chromium.launch({ executablePath: process.env.LL_CHROME }); const results = [];
for (const [name, n, want] of [['only 20:00 subs in', iSubs, /Halftime/], ['first 2nd-half play in', i2 + 2, /2nd half/]]) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const body = JSON.stringify(cut(n));
  await p.route('**/summary?event=401906803*', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body }));
  await p.route('**/teams/201/schedule', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"events":[]}' }));
  await p.goto('http://localhost:4173/live-lineups.html?game=401906803'); await p.waitForFunction(() => window.__ll?.S, null, { timeout: 30000 });
  const band = await p.evaluate(() => (document.querySelector('.clk')?.innerText || '') + ' ' + (document.querySelector('.per')?.innerText || ''));
  const last = raw.plays[n]; results.push({ name, lastPlay: `${last.period.number}-${last.clock.displayValue} ${last.type.text}`, band, ok: want.test(band) });
  await p.close();
}
await b.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ESPN says Halftime, ${r.name} (last ${r.lastPlay}): band "${r.band}"`);
