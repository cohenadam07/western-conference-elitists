// Test: the page renders the same as another build (e.g. production's) at the same moments, apart from the footer
// version. Both are served locally: A on :4173 (this tree), B on :4174 (the other tree's public/).
// usage: LL_CHROME=... node tools/live-lineups/same-page-test.mjs [vA vB]   (default: 1.0.1 vs 1.0)
import { chromium } from 'playwright';
const [vA = '1.0.1', vB = '1.0'] = process.argv.slice(2);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const b = await chromium.launch({ executablePath: process.env.LL_CHROME }); const results = [];
const moments = [['401906803', '1-8:00'], ['401906803', 'half'], ['401906802', '2-9:00'], ['401906804', 'end']];
async function grab(port, gid, at, vw) {
  const p = await (await b.newContext({ userAgent: UA, viewport: vw })).newPage();
  await p.route('**/api/ll-usage*', r => r.fulfill({ status: 204 }));
  await p.goto(`http://localhost:${port}/live-lineups.html?replay=${gid}&speed=0&at=${at}&me=1`); await p.waitForFunction(() => window.__ll?.A && window.__ll.sheet()?.ready && !window.__ll.sheet()?.loading, null, { timeout: 90000 }); await p.waitForTimeout(800);
  const out = {};
  for (const t of ['now', 'shots', 'players', 'sheet']) { await p.locator(`[data-tab="${t}"]:visible`).first().click(); await p.waitForTimeout(250); out[t] = await p.evaluate(() => document.getElementById('app').innerHTML.replace(/Live, updated \d+ sec ago/, '').replace(/dot beat/g, 'dot')); }
  await p.locator('[data-tab="now"]:visible').first().click(); await p.locator('[data-act="drawer"]').click(); await p.waitForSelector('.drawer');
  for (const s of ['lineups', 'players', 'shooting', 'opp']) { await p.locator(`[data-seg="${s}"]`).click(); await p.waitForTimeout(100); out['drawer-' + s] = await p.evaluate(() => document.querySelector('.drawer').innerHTML); }
  await p.context().close(); return out;
}
for (const [gid, at] of moments) for (const vw of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const [A, B] = await Promise.all([grab(4173, gid, at, vw), grab(4174, gid, at, vw)]);
  const diff = Object.keys(B).filter(k => A[k].replaceAll(`Version ${vA}`, 'V') !== B[k].replaceAll(`Version ${vB}`, 'V'));
  const pass = !diff.length && Object.keys(A).length === 8; results.push(pass);
  for (const k of diff) { const a = A[k].replaceAll(`Version ${vA}`, 'V'), c = B[k].replaceAll(`Version ${vB}`, 'V'); let i = 0; while (a[i] === c[i]) i++; console.log('   ', k, '@', i, '\n    A:', a.slice(Math.max(0, i - 120), i + 160), '\n    B:', c.slice(Math.max(0, i - 120), i + 160)); }
  console.log(`${pass ? 'PASS' : 'FAIL'} ${gid} at ${at}, ${vw.width}px: 4 tabs + 4 drawer sections identical apart from the version${diff.length ? ' — differs: ' + diff : ''}`);
}
await b.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
