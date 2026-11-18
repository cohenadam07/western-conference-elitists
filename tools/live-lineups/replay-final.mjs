// Replay one finished game through the real page at a given speed, check the reconciliation light at every refresh and
// the final score and minutes, then download "This game" (.xlsx and .csv) for recalc.sh + final_check.py.
// usage: LL_CHROME=... node tools/live-lineups/replay-final.mjs <gid> <outdir> [speed=10] [base=http://localhost:4173]
import { chromium } from 'playwright'; import fs from 'node:fs';
const [gid, out, speed = '10', base = 'http://localhost:4173'] = process.argv.slice(2);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'; // ESPN's edge 403s HeadlessChrome
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const ctx = await b.newContext({ userAgent: UA, acceptDownloads: true, viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
const t0 = Date.now();
await p.goto(`${base}/live-lineups.html?replay=${gid}&speed=${speed}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__llControl && window.__ll?.A, null, { timeout: 30000 });
const samples = []; let last = null;
while (true) {
  const s = await p.evaluate(() => ({ t: window.__llControl.t, state: window.__ll.S.state, score: window.__ll.A.score, parsed: window.__ll.A.parsed, lineupOk: window.__ll.A.lineupOk, banners: [...document.querySelectorAll('.banner')].map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 80)) }));
  if (!last || s.t !== last.t) samples.push(s); last = s;
  if (s.state === 'final') break;
  if (Date.now() - t0 > 15 * 60e3) throw new Error('replay did not reach the final');
  await p.waitForTimeout(250);
}
const fin = await p.evaluate(() => ({ score: window.__ll.A.score, parsed: window.__ll.A.parsed, stints: window.__ll.A.stints.length, mins: window.__ll.A.stints.reduce((a, s) => a + (s.t1 - s.t0), 0) / 60, rows: window.__ll.A.rows.length, footer: document.querySelector('.ver')?.textContent }));
const mism = samples.filter(s => s.parsed.OU !== s.score.OU || s.parsed.OPP !== s.score.OPP);
const bannerMoments = samples.filter(s => s.banners.length);
await p.locator('[data-tab="sheet"]:visible').first().click();
await p.waitForFunction(() => { const s = window.__ll.sheet(); return s && !s.loading && s.ready; }, null, { timeout: 120000 });
await p.locator('[data-scope="game"]').click(); await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/final-sheet-1440x900.png`, fullPage: true });
const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.sheetbar [data-act="xlsx"]').click()]); const xlsx = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(xlsx);
const [dc] = await Promise.all([p.waitForEvent('download'), p.locator('.sheetbar [data-act="csv"]').click()]); const csv = `${out}/${dc.suggestedFilename()}`; await dc.saveAs(csv);
await b.close();
const res = { gid, speed: Number(speed), realSeconds: Math.round((Date.now() - t0) / 1000), refreshes: samples.length, reconMismatches: mism.length, bannerMoments: bannerMoments.length, final: fin, xlsx, csv, errors: errs };
fs.writeFileSync(`${out}/replay-final.json`, JSON.stringify({ ...res, samples }, null, 1));
console.log(JSON.stringify(res, null, 1));
for (const s of mism.slice(0, 5)) console.log('MISMATCH', JSON.stringify(s)); for (const s of bannerMoments.slice(0, 5)) console.log('BANNER', JSON.stringify(s));
