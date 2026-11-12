// Test: ESPN marks a game live before it posts any play (MARQ at MICH, Nov 11, 19:02: one pull at 1st 19:56 with
// 0 plays). The page used to show "Lineups are hidden" for that pull. Now it keeps the pre-game card, marked as tipped
// off, and opens the live view without a reload as soon as the jump ball arrives.
// usage: LL_CHROME=... node tools/live-lineups/tip-test.mjs   (local server on 4173)
import { chromium } from 'playwright'; import fs from 'node:fs';
const tip = JSON.parse(fs.readFileSync('research/live-lineups-test/live/feeds/401909524-tip-3plays.json'));
const empty = structuredClone(tip); empty.plays = []; for (const c of empty.header.competitions[0].competitors) delete c.score;
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errs = [];
p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
let body = JSON.stringify(empty);
await p.route('**/summary?event=401909524*', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body }));
await p.route('**/teams/130/schedule', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"events":[]}' }));
await p.goto('http://localhost:4173/live-lineups.html?game=401909524&team=130');
await p.waitForSelector('main.pre', { timeout: 30000 });
const look = () => p.evaluate(() => ({ pre: !!document.querySelector('main.pre'), text: document.querySelector('main')?.innerText.replace(/\s+/g, ' ').slice(0, 160),
  banners: [...document.querySelectorAll('.banner')].map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 60)), now: !!document.querySelector('.now-main'), lineupOk: window.__ll?.A?.lineupOk }));
const a = await look(); body = JSON.stringify(tip);
await p.waitForSelector('.now-main', { timeout: 40000 }).catch(() => {}); await p.waitForTimeout(500);
const c = await look(); await b.close();
const r1 = a.pre && /Tipped off/.test(a.text) && !a.banners.length; const r2 = c.now && c.lineupOk === true && !c.banners.length;
console.log(`${r1 ? 'PASS' : 'FAIL'} live with 0 plays: pre-game card "${a.text}", banners ${JSON.stringify(a.banners)}`);
console.log(`${r2 ? 'PASS' : 'FAIL'} next pull with the jump ball: live view ${c.now}, lineups ok ${c.lineupOk}, banners ${JSON.stringify(c.banners)}`);
console.log(`${errs.length ? 'FAIL' : 'PASS'} console/page errors: ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
