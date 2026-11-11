// Test 6: watch a real live game on the local page (live code path, ?game=) and log every refresh.
// usage: LL_CHROME=... node tools/live-lineups/live-test.mjs <gid> <teamId> <label> [liveMinutes=30] [shots=0|1]
// Logs, per ESPN summary response: ESPN's clock and last play, the page's reconciliation light, every banner, repairs.
// A 1 s sampler logs any banner change between refreshes. Waits through pre-game; stops after liveMinutes of live play
// (wall clock) or at the final.
import { chromium } from 'playwright'; import fs from 'node:fs';
const [gid, team, label, liveMin = '30', shots = '0'] = process.argv.slice(2);
const OUT = `research/live-lineups-test/live/${label}`; fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const jl = fs.createWriteStream(`${OUT}/refresh-log.jsonl`, { flags: 'a' }); const tl = fs.createWriteStream(`${OUT}/refresh-log.txt`, { flags: 'a' });
const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
const say = (o, line) => { jl.write(JSON.stringify({ wall: new Date().toISOString(), ...o }) + '\n'); tl.write(`${ts()} ${line}\n`); console.log(`[${label}] ${ts()} ${line}`); };

const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA }); const p = await ctx.newPage();
const errors = []; p.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); say({ kind: 'console-error', text: m.text() }, `CONSOLE ERROR ${m.text()}`); } });
p.on('pageerror', e => { errors.push(String(e)); say({ kind: 'pageerror', text: String(e) }, `PAGE ERROR ${e}`); });

const dom = () => p.evaluate(() => {
  const r = document.querySelector('.recon'); const ll = window.__ll || {};
  return { recon: r ? { cls: r.className.replace('recon', '').trim() || 'green', text: r.innerText.trim() } : null,
    banners: [...document.querySelectorAll('.banner')].map(x => x.innerText.replace(/\s+/g, ' ').trim()),
    ago: document.querySelector('[data-ago]')?.innerText || '', band: (document.querySelector('.clk')?.innerText || '') + ' ' + (document.querySelector('.per')?.innerText || ''),
    repairs: ll.A ? ll.A.repairs.map(x => `${x.period}-${x.clock}`) : [], lineupOk: ll.A ? ll.A.lineupOk : null, repairT: ll.A ? ll.A.repairT : null,
    parsed: ll.A ? ll.A.parsed : null, score: ll.A ? ll.A.score : null, state: ll.S ? ll.S.state : null, stints: ll.A ? ll.A.rows.length : null };
});

let refreshes = 0, firstLive = null, done = false, lastBan = '', shotsTaken = { start: false, timeout: false }, prevClock = null;
const isTO = t => /time ?out/i.test(t || '');
async function shoot(tag) {
  const tabs = ['now', 'shots', 'players', 'sheet'];
  for (const t of tabs) {
    await p.evaluate(t => { const el = [...document.querySelectorAll(`[data-tab="${t}"]`)].find(e => e.offsetParent); el && el.click(); }, t);
    await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${tag}-${t}.png`, fullPage: true });
  }
  await p.evaluate(() => { const el = [...document.querySelectorAll('[data-act="drawer"]')].find(e => e.offsetParent); el && el.click(); });
  await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${tag}-drawer.png` });
  await p.keyboard.press('Escape'); await p.evaluate(() => { const el = [...document.querySelectorAll('[data-act="drawer"]')].find(e => e.offsetParent && e.getAttribute('aria-expanded') === 'true'); el && el.click(); });
  await p.setViewportSize({ width: 390, height: 844 });
  for (const t of tabs) {
    await p.evaluate(t => { const el = [...document.querySelectorAll(`[data-tab="${t}"]`)].find(e => e.offsetParent); el && el.click(); }, t);
    await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${tag}-phone-${t}.png`, fullPage: true });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.evaluate(() => { const el = [...document.querySelectorAll('[data-tab="now"]')].find(e => e.offsetParent); el && el.click(); });
  say({ kind: 'screenshots', tag }, `SCREENSHOTS ${tag}: now, shots, players, sheet, drawer (1440x900) and phone (390x844)`);
}

p.on('response', async res => {
  if (!res.url().includes(`summary?event=${gid}`)) return;
  let espn = {};
  try { const d = await res.json(); const c = d.header.competitions[0]; const pl = d.plays || []; const last = pl[pl.length - 1];
    espn = { status: res.status(), state: c.status.type.state, detail: c.status.type.shortDetail || c.status.type.detail, clock: c.status.displayClock, period: c.status.period, plays: pl.length,
      lastType: last?.type?.text, lastText: last?.text, lastClock: last ? `${last.period.number}-${last.clock.displayValue}` : null };
  } catch (e) { espn = { status: res.status(), err: String(e) }; }
  await p.waitForTimeout(600);
  const d = await dom(); refreshes++;
  if (espn.state === 'in' && !firstLive) firstLive = Date.now();
  const timeout = espn.state === 'in' && isTO(espn.lastType) ? espn.lastType : espn.state === 'in' && prevClock === espn.clock && espn.detail ? 'clock stopped' : '';
  prevClock = espn.clock;
  const ban = d.banners.join(' | ');
  say({ kind: 'refresh', n: refreshes, espn, page: d, timeout },
    `#${refreshes} ESPN ${espn.state} ${espn.detail || ''} (${espn.plays} plays, last ${espn.lastClock} ${espn.lastType || ''}) | light ${d.recon ? d.recon.cls : '-'}: ${d.recon ? d.recon.text : '-'} | ${d.ago} | banners: ${ban || 'none'} | repairs: ${d.repairs.join(',') || 'none'}${d.lineupOk === false ? ' LINEUPS HIDDEN' : ''}${timeout ? ` | STOPPAGE: ${timeout}` : ''}`);
  if (espn.state === 'post') done = true;
  if (shots === '1' && espn.state === 'in' && !shotsTaken.start && refreshes >= 2) { shotsTaken.start = true; await shoot('live'); }
  if (shots === '1' && isTO(espn.lastType) && /TV/i.test(espn.lastType) && !shotsTaken.timeout) { shotsTaken.timeout = true; await shoot('media-timeout'); }
});

await p.goto(`http://localhost:4173/live-lineups.html?game=${gid}&team=${team}`);
const t0 = Date.now();
while (!done) {
  await p.waitForTimeout(1000);
  const d = await dom().catch(() => null); if (!d) continue;
  const ban = d.banners.join(' | ');
  if (ban !== lastBan) { say({ kind: 'banner-change', banners: d.banners, band: d.band }, `BANNER CHANGE at ${d.band}: ${ban || 'none'}`); lastBan = ban; }
  if (firstLive && Date.now() - firstLive > Number(liveMin) * 60000) break;
  if (Date.now() - t0 > 4 * 3600e3) break;
}
say({ kind: 'end', refreshes, errors: errors.length, liveMinutes: firstLive ? (Date.now() - firstLive) / 60000 : 0 }, `END ${refreshes} refreshes, ${errors.length} errors, ${firstLive ? ((Date.now() - firstLive) / 60000).toFixed(1) : 0} live minutes`);
await p.screenshot({ path: `${OUT}/end.png`, fullPage: true });
await b.close(); jl.end(); tl.end();
