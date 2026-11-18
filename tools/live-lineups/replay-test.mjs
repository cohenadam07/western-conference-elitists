// Test 2 (+3): replay OU's games at 10x through the real page; at checkpoints, pause and screenshot every tab, halftime
// and the drawer at every viewport; then download "Whole season" from the last game.
// Usage: node tools/live-lineups/replay-test.mjs [gid ...]   (static server on :4173 serving public/)
import { chromium } from 'playwright'; import fs from 'node:fs';
const GIDS = process.argv.slice(2).length ? process.argv.slice(2) : ['401906801', '401906802', '401906803'];
const VIEWPORTS = [[390, 844], [430, 932], [820, 1180], [1180, 820], [1194, 834], [1440, 900]];
const OUT = 'research/live-lineups-test'; fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'; // ESPN's edge 403s HeadlessChrome
const TABS = ['now', 'shots', 'players', 'sheet'];
const FINALS = { '401906801': [64, 68, 33], '401906802': [84, 57, 25], '401906803': [81, 72, 28] };
const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const results = {};
async function runGame(gid) {
  const ctx = await b.newContext({ userAgent: UA, acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const R = results[gid] = { shots: [], overflow: [], errors: [], checks: [], recon: [] };
  p.on('console', m => { if (m.type() === 'error') R.errors.push(m.text()); }); p.on('pageerror', e => R.errors.push('PAGEERROR ' + e.message));
  const t0 = Date.now();
  await p.goto(`http://localhost:4173/live-lineups.html?replay=${gid}&speed=10`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__llControl && window.__ll?.A, null, { timeout: 30000 });
  const endT = await p.evaluate(() => window.__llControl.endT);
  const cps = [['live-1st-half-8-00', s => s.t >= 720 && s.state === 'live'], ['halftime', s => s.state === 'half'], ['live-2nd-half-9-00', s => s.t >= 1860 && s.state === 'live'], ['final', s => s.state === 'final']];
  for (const [name, cond] of cps) {
    try { await p.waitForFunction(c => { const s = { t: window.__llControl.t, state: window.__ll.S.state }; return (new Function('s', 'return (' + c + ')(s)'))(s); }, cond.toString(), { timeout: 600000, polling: 200 }); } catch (e) { const st = await p.evaluate(() => [window.__llControl?.t, window.__ll?.S?.state]); console.log(gid, 'STUCK before', name, 'at', st, R.errors.slice(-3)); throw e; }
    console.log(gid, 'reached', name, 'after', Math.round((Date.now() - t0) / 1000), 's');
    await p.evaluate(() => window.__llControl.pause());
    const snap = await p.evaluate(() => ({ t: window.__llControl.t, state: window.__ll.S.state, score: window.__ll.A.score, parsed: window.__ll.A.parsed, stints: window.__ll.A.stints.length, mins: window.__ll.A.stints.reduce((a, s) => a + (s.t1 - s.t0), 0) / 60, lineupOk: window.__ll.A.lineupOk }));
    R.recon.push({ checkpoint: name, ...snap, match: snap.parsed.OU === snap.score.OU && snap.parsed.OPP === snap.score.OPP, realSeconds: Math.round((Date.now() - t0) / 1000) });
    const tabs = name === 'live-1st-half-8-00' ? ['now'] : name === 'halftime' ? ['now'] : TABS;
    for (const [w, h] of VIEWPORTS) {
      await p.setViewportSize({ width: w, height: h });
      for (const tab of tabs) {
        await p.locator(`[data-tab="${tab}"]:visible`).first().click(); await p.waitForTimeout(150);
        const ok = await p.evaluate(tab => ({ over: document.documentElement.scrollWidth - window.innerWidth, has: !!document.querySelector({ now: '.now-main', shots: '.shots svg.court', players: '.kp-h', sheet: '.sheetbar' }[tab]) }), tab);
        if (ok.over > 1) R.overflow.push(`${name} ${tab} ${w}x${h} +${ok.over}px`);
        if (!ok.has) R.checks.push(`MISSING ${tab} at ${name} ${w}x${h}`);
        const f = `${OUT}/${gid}/${name}/${tab}-${w}x${h}.png`; fs.mkdirSync(`${OUT}/${gid}/${name}`, { recursive: true });
        await p.screenshot({ path: f, fullPage: true }); R.shots.push(f);
      }
      if (name === 'halftime' || name === 'live-2nd-half-9-00') {
        await p.locator('[data-tab="now"]:visible').first().click();
        await p.locator('[data-act="drawer"]').click(); await p.waitForSelector('.drawer');
        for (const seg of ['lineups', 'players', 'shooting', 'opp']) {
          if (seg !== 'lineups' && !(w === 1440 || w === 390)) continue;
          await p.locator(`[data-seg="${seg}"]`).click(); await p.waitForTimeout(100);
          const f = `${OUT}/${gid}/${name}/drawer-${seg}-${w}x${h}.png`; await p.screenshot({ path: f }); R.shots.push(f);
        }
        await p.locator('.drawer [data-act="drawer-close"]').first().click();
      }
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.locator('[data-tab="now"]:visible').first().click();
    if (name !== 'final') await p.evaluate(() => window.__llControl.play());
  }
  const fin = R.recon.find(r => r.checkpoint === 'final'); const [a, bb, n] = FINALS[gid] || [];
  R.final = { score: `${fin.score.OU}-${fin.score.OPP}`, expected: `${a}-${bb}`, stints: fin.stints, expectedStints: n, minutes: Math.round(fin.mins * 100) / 100,
    pass: fin.score.OU === a && fin.score.OPP === bb && fin.stints === n && Math.abs(fin.mins - 40) < 1e-9 && R.recon.every(r => r.match) };
  R.realSeconds = Math.round((Date.now() - t0) / 1000);
  if (gid === GIDS[GIDS.length - 1]) {
    await p.locator('[data-tab="sheet"]:visible').first().click();
    await p.waitForFunction(() => { const s = window.__ll.sheet(); return s && !s.loading && s.ready; }, null, { timeout: 120000 });
    await p.locator('[data-scope="season"]').click(); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/${gid}/final/sheet-whole-season-1440x900.png`, fullPage: true });
    for (const t of ['Lineup Summary', 'Player On-Off', 'Game Summary', 'Roster']) { await p.locator(`[data-sheet="${t}"]`).click(); await p.waitForTimeout(100); await p.screenshot({ path: `${OUT}/${gid}/final/sheet-tab-${t.replace(/\W+/g, '-')}-1440x900.png`, fullPage: true }); }
    await p.locator('[data-sheet="Stint Log"]').click();
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-act="xlsx"]').click()]);
    R.download = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(R.download);
    const [csv] = await Promise.all([p.waitForEvent('download'), p.locator('.sheetbar [data-act="csv"]').click()]);
    R.csv = `${OUT}/${csv.suggestedFilename()}`; await csv.saveAs(R.csv);
  }
  await ctx.close();
}
await Promise.all(GIDS.map(runGame));
await b.close();
fs.writeFileSync(`${OUT}/replay-results.json`, JSON.stringify(results, null, 1));
for (const [gid, R] of Object.entries(results)) {
  console.log(`${gid}: final ${R.final.score} (expected ${R.final.expected}), stints ${R.final.stints}/${R.final.expectedStints}, minutes ${R.final.minutes}, recon all match ${R.recon.every(r => r.match)}, PASS ${R.final.pass}; ${R.shots.length} screenshots in ${R.realSeconds}s; overflow ${R.overflow.length}; console errors ${R.errors.length}; missing ${R.checks.length}`);
  for (const o of R.overflow.slice(0, 8)) console.log('  OVERFLOW', o); for (const e of R.errors.slice(0, 5)) console.log('  ERROR', e); for (const c of R.checks.slice(0, 5)) console.log('  ', c);
  if (R.download) console.log('  downloaded', R.download, '|', R.csv);
}
