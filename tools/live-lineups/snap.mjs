// Screenshot one replay moment. Usage: node tools/live-lineups/snap.mjs <gid> <at> <outdir> <tabs comma> <WxH,...> [drawer]
import { chromium } from 'playwright'; import fs from 'node:fs';
const [gid, at, out, tabs, vps, drawer] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const p = await b.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto(`http://localhost:4173/live-lineups.html?replay=${gid}&at=${at}&speed=0`); await p.waitForFunction(() => window.__ll?.A, null, { timeout: 30000 }); await p.waitForTimeout(2500);
for (const vp of vps.split(',')) { const [w, h] = vp.split('x').map(Number); await p.setViewportSize({ width: w, height: h });
  for (const t of tabs.split(',')) { await p.locator(`[data-tab="${t}"]:visible`).first().click(); await p.waitForTimeout(200);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); await p.screenshot({ path: `${out}/${t}-${vp}.png`, fullPage: true }); console.log(t, vp, 'overflow', over); }
  if (drawer) { await p.locator('[data-tab="now"]:visible').first().click(); await p.locator('[data-act="drawer"]').click(); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/drawer-${vp}.png` }); await p.locator('.drawer .x').click(); } }
console.log(errs.join('\n') || 'no errors'); await b.close();
