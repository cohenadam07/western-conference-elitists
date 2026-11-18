// Tests 4 and 5: the MVSU game (401906802) replayed to 2nd half 9:00 in the real page.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = 'research/live-lineups-test/mockup-moment'; fs.mkdirSync(OUT, { recursive: true });
const ref = JSON.parse(fs.readFileSync('public/live-lineups/reference/shots.json'));
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1440, height: 900 } });
const res = { test4: {}, test5: {} }; let pass4 = true, pass5 = true;
const chk = (obj, name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); obj[name] = { got, want, ok }; return ok; };
async function open(at) { const p = await ctx.newPage(); await p.goto(`http://localhost:4173/live-lineups.html?replay=401906802&at=${at}&speed=0`); await p.waitForFunction(() => window.__ll?.A && window.__ll.A.prior > 0, null, { timeout: 60000 }); await p.waitForTimeout(1500); return p; }
// ---- test 4: shot chart counts at 9:00
let p = await open('2-9:00');
const A = await p.evaluate(() => ({ shots: window.__ll.A.shots, cut: window.__ll.A.cut }));
const S = A.shots, f = a => `${a.filter(s => s.made).length} of ${a.length}`;
const ou = S.filter(s => s.team === 'OU'), op = S.filter(s => s.team === 'OPP');
pass4 &= chk(res.test4, 'total shots', S.length, 93); pass4 &= chk(res.test4, 'Oklahoma shots', ou.length, 52); pass4 &= chk(res.test4, 'MVSU shots', op.length, 41);
pass4 &= chk(res.test4, 'OU at the rim', f(ou.filter(s => s.rim)), '12 of 20'); pass4 &= chk(res.test4, 'OU threes', f(ou.filter(s => s.three)), '9 of 31'); pass4 &= chk(res.test4, 'MVSU threes', f(op.filter(s => s.three)), '2 of 13');
const key = s => `${s.team}|${s.x}|${s.y}|${s.made}|${s.ast}|${s.three}|${s.rim}|${s.t}`;
const mine = S.filter(s => s.chart).map(key).sort(), theirs = ref.shots.map(key).sort();
pass4 &= chk(res.test4, 'every shot identical to reference/shots.json (team, x, y, made, assisted, three, rim, time)', mine.join() === theirs.join(), true);
await p.locator('[data-tab="shots"]:visible').first().click(); await p.waitForTimeout(300);
const dom = await p.evaluate(() => ({ dots: document.querySelectorAll('svg.court.h circle.mu, svg.court.h circle.ma, svg.court.h circle.mx').length, cap: document.querySelector('.cap').innerText.replace(/\s+/g, ' '), tbl: document.querySelector('.below .tbl').innerText.replace(/\s+/g, ' ') }));
pass4 &= chk(res.test4, 'dots drawn on the court', dom.dots, 93);
res.test4.caption = dom.cap; res.test4.table = dom.tbl;
await p.screenshot({ path: `${OUT}/shots-2nd-half-9-00-1440x900.png`, fullPage: true });
// ---- test 5: Right now at 9:00 and one tick earlier (9:08)
for (const at of ['2-9:00', '2-9:08']) {
  if (at !== '2-9:00') p = await open(at); else { await p.locator('[data-tab="now"]:visible').first().click(); await p.waitForTimeout(200); }
  const d = await p.evaluate(() => ({ lead: document.querySelector('.lead h1')?.innerText, leadWhy: document.querySelector('.lead .why')?.innerText, notes: [...document.querySelectorAll('.notes .nh')].map(e => e.innerText),
    nowtag: document.querySelector('.nowtag')?.innerText, run: document.querySelector('.run b')?.innerText, together: document.querySelector('.floor .grp-h span')?.innerText,
    ouFloor: [...document.querySelectorAll('.floor .grp:first-child .nm')].map(e => e.innerText), oppFloor: [...document.querySelectorAll('.floor .grp:nth-child(2) .pl')].map(e => e.innerText.replace(/\s+/g, ' ')), paper: document.querySelector('.paper')?.innerText,
    score: document.querySelector('.us .sc').innerText + '-' + document.querySelector('.them .sc').innerText, fouls: document.querySelector('.fouls').innerText.replace(/\s+/g, ' ') }));
  const R = res.test5[at] = { dom: d };
  const five = ['Derrion Reid', 'Quincy Wadley', 'Xzayvier Brown', 'Dayton Forsythe', 'Gage Mayfield'].sort();
  let ok = true;
  ok &= chk(R, 'lead +17', d.nowtag, '+17'); ok &= chk(R, 'run label', d.run, 'Oklahoma 20–3 run'); ok &= chk(R, 'current five', [...d.ouFloor].sort(), five);
  ok &= chk(R, 'lead takeaway', d.lead, 'Go at Tymias Williams. He has 4 fouls.'); ok &= chk(R, 'together', d.together, 'Together 1:01');
  R.allMatchMockup = !!ok; if (at === '2-9:00') res.test5.at900 = !!ok; else res.test5.at908 = !!ok;
  await p.screenshot({ path: `${OUT}/right-now-${at.replace(':', '-')}-1440x900.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: `${OUT}/right-now-${at.replace(':', '-')}-390x844.png`, fullPage: true }); await p.setViewportSize({ width: 1440, height: 900 });
}
await b.close();
fs.writeFileSync(`${OUT}/moment-results.json`, JSON.stringify(res, null, 1));
console.log('TEST 4', pass4 ? 'PASS' : 'FAIL'); for (const [k, v] of Object.entries(res.test4)) if (v && v.want !== undefined) console.log(`  ${v.ok ? 'ok  ' : 'FAIL'} ${k}: ${JSON.stringify(v.got)}`); console.log('  caption:', res.test4.caption);
for (const at of ['2-9:00', '2-9:08']) { const R = res.test5[at]; console.log(`TEST 5 at ${at}:`); for (const [k, v] of Object.entries(R)) if (v && v.want !== undefined) console.log(`  ${v.ok ? 'ok  ' : 'DIFF'} ${k}: ${JSON.stringify(v.got)}`);
  console.log('  why:', R.dom.leadWhy); console.log('  notes:', R.dom.notes.join(' / ')); console.log('  opp floor:', R.dom.oppFloor.join(' / ')); console.log('  paper:', R.dom.paper); console.log('  band:', R.dom.score, '|', R.dom.fouls); }
