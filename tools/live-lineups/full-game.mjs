// Full-game rehearsal: follow one real game on the live code path (?game=) from pre-game through the final, log every
// refresh like live-test.mjs, shoot every tab and the drawer (all four segments) at 1440x900 and at phone size 390x844
// once per half / overtime period and at halftime and the final, then download "This game" as .xlsx and .csv.
// usage: LL_CHROME=... node tools/live-lineups/full-game.mjs <gid> <teamId> <label> [base=http://localhost:4173]
//   base can be a Vercel share link (https://<preview>/?_vercel_share=...): it is opened once to set the auth cookie,
//   then the page is loaded from that origin.
import { chromium } from 'playwright'; import fs from 'node:fs';
const [gid, team, label, base = 'http://localhost:4173'] = process.argv.slice(2);
const OUT = `research/live-lineups-test/live/${label}`; fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const jl = fs.createWriteStream(`${OUT}/refresh-log.jsonl`, { flags: 'a' }); const tl = fs.createWriteStream(`${OUT}/refresh-log.txt`, { flags: 'a' });
const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
const say = (o, line) => { jl.write(JSON.stringify({ wall: new Date().toISOString(), ...o }) + '\n'); tl.write(`${ts()} ${line}\n`); console.log(`[${label}] ${ts()} ${line}`); };

const b = await chromium.launch({ executablePath: process.env.LL_CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, acceptDownloads: true }); const p = await ctx.newPage();
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

const TABS = ['now', 'shots', 'players', 'sheet']; const SEGS = ['lineups', 'players', 'shooting', 'opp'];
let busy = false;
async function shoot(tag) {
  busy = true; const notes = [];
  try {
    for (const [w, h, pre] of [[1440, 900, ''], [390, 844, 'phone-']]) {
      await p.setViewportSize({ width: w, height: h });
      for (const t of TABS) {
        await p.locator(`[data-tab="${t}"]:visible`).first().click(); await p.waitForTimeout(700);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (over > 1) notes.push(`${pre}${t} overflow +${over}px`);
        await p.screenshot({ path: `${OUT}/${tag}-${pre}${t}.png`, fullPage: true });
      }
      await p.locator('[data-tab="now"]:visible').first().click(); await p.waitForTimeout(300);
      await p.locator('[data-act="drawer"]:visible').first().click(); await p.waitForSelector('.drawer', { timeout: 5000 });
      for (const s of SEGS) {
        await p.locator(`.drawer [data-seg="${s}"]`).first().click(); await p.waitForTimeout(250);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (over > 1) notes.push(`${pre}drawer-${s} overflow +${over}px`);
        await p.screenshot({ path: `${OUT}/${tag}-${pre}drawer-${s}.png` });
      }
      await p.locator('.drawer [data-act="drawer-close"]').first().click(); await p.waitForTimeout(200);
    }
  } catch (e) { notes.push(`screenshot step failed: ${String(e).split('\n')[0]}`); }
  await p.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await p.locator('[data-tab="now"]:visible').first().click().catch(() => {});
  say({ kind: 'screenshots', tag, notes }, `SCREENSHOTS ${tag}: 4 tabs + drawer (4 segments) at 1440x900 and phone 390x844${notes.length ? ' | ' + notes.join('; ') : ' | no overflow'}`);
  busy = false;
}

let refreshes = 0, firstLive = null, done = false, lastBan = '', prevClock = null; const shot = new Set();
const isTO = t => /time ?out/i.test(t || '');
const secs = c => { const [m, s] = String(c || '0:0').split(':').map(Number); return m * 60 + (s || 0); };
p.on('response', async res => {
  if (!res.url().includes(`event=${gid}`) || !/summary/.test(res.url())) return;
  let espn = {};
  try { const d = await res.json(); const c = d.header.competitions[0]; const pl = d.plays || []; const last = pl[pl.length - 1];
    espn = { url: res.url().includes('/api/espn-summary') ? 'proxy' : 'espn', status: res.status(), state: c.status.type.state, detail: c.status.type.shortDetail || c.status.type.detail,
      clock: c.status.displayClock, period: c.status.period, plays: pl.length,
      score: c.competitors.map(x => `${x.team.abbreviation} ${x.score}`).join(' '),
      lastType: last?.type?.text, lastText: last?.text, lastClock: last ? `${last.period.number}-${last.clock.displayValue}` : null };
  } catch (e) { espn = { status: res.status(), err: String(e) }; }
  await p.waitForTimeout(600);
  const d = await dom().catch(() => ({ banners: [], repairs: [] })); refreshes++;
  if (espn.state === 'in' && !firstLive) firstLive = Date.now();
  const timeout = espn.state === 'in' && isTO(espn.lastType) ? espn.lastType : espn.state === 'in' && prevClock === espn.clock && espn.detail ? 'clock stopped' : '';
  prevClock = espn.clock;
  const ban = (d.banners || []).join(' | ');
  say({ kind: 'refresh', n: refreshes, espn, page: d, timeout },
    `#${refreshes} ${espn.url || ''} ESPN ${espn.state} ${espn.detail || ''} [${espn.score || ''}] (${espn.plays} plays, last ${espn.lastClock} ${espn.lastType || ''}) | light ${d.recon ? d.recon.cls : '-'}: ${d.recon ? d.recon.text : '-'} | ${d.ago} | banners: ${ban || 'none'} | repairs: ${(d.repairs || []).join(',') || 'none'}${d.lineupOk === false ? ' LINEUPS HIDDEN' : ''}${timeout ? ` | STOPPAGE: ${timeout}` : ''}`);
  if (busy) return;
  // one screenshot set per half / OT period (once the half is under way), at halftime, and at the final
  let tag = null;
  if (espn.state === 'in' && /half/i.test(espn.detail || '') && espn.period === 1 && secs(espn.clock) === 0) tag = 'halftime';
  else if (espn.state === 'in' && espn.period === 1 && secs(espn.clock) <= 12 * 60 && secs(espn.clock) > 0) tag = '1st-half';
  else if (espn.state === 'in' && espn.period === 2 && secs(espn.clock) <= 12 * 60 && secs(espn.clock) > 0) tag = '2nd-half';
  else if (espn.state === 'in' && espn.period >= 3 && secs(espn.clock) <= 4 * 60 && secs(espn.clock) > 0) tag = `ot${espn.period - 2}`;
  if (tag && !shot.has(tag)) { shot.add(tag); await shoot(tag); }
  if (espn.state === 'post') done = true;
});

if (base.includes('_vercel_share')) { await p.goto(base); await p.waitForTimeout(1500); }
const origin = new URL(base).origin;
await p.goto(`${origin}/live-lineups.html?game=${gid}&team=${team}`);
say({ kind: 'start', url: `${origin}/live-lineups.html?game=${gid}&team=${team}` }, `START ${origin}/live-lineups.html?game=${gid}&team=${team}`);
const t0 = Date.now();
while (!done) {
  await p.waitForTimeout(1000);
  const d = await dom().catch(() => null); if (!d) continue;
  const ban = d.banners.join(' | ');
  if (ban !== lastBan) { say({ kind: 'banner-change', banners: d.banners, band: d.band }, `BANNER CHANGE at ${d.band}: ${ban || 'none'}`); lastBan = ban; }
  if (Date.now() - t0 > 9 * 3600e3) break;
}
// final: let the page settle on the final feed, shoot, then download "This game"
while (busy) await p.waitForTimeout(500);
await p.waitForTimeout(5000);
const fin = await dom(); say({ kind: 'final-state', page: fin }, `FINAL STATE light ${fin.recon?.cls}: ${fin.recon?.text} | banners: ${fin.banners.join(' | ') || 'none'} | stints ${fin.stints} | repairs ${fin.repairs.join(',') || 'none'}`);
await shoot('final');
try {
  await p.locator('[data-tab="sheet"]:visible').first().click();
  await p.waitForFunction(() => { const s = window.__ll.sheet(); return s && !s.loading && s.ready; }, null, { timeout: 120000 });
  await p.locator('[data-scope="game"]').click(); await p.waitForTimeout(300);
  const sheetNotes = await p.evaluate(() => document.querySelector('.sheetbar')?.parentElement?.innerText.slice(0, 600));
  await p.screenshot({ path: `${OUT}/final-sheet-this-game.png`, fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-act="xlsx"]').click()]);
  const xf = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(xf);
  const [csv] = await Promise.all([p.waitForEvent('download'), p.locator('.sheetbar [data-act="csv"]').click()]);
  const cf = `${OUT}/${csv.suggestedFilename()}`; await csv.saveAs(cf);
  say({ kind: 'download', xlsx: xf, csv: cf, sheetNotes }, `DOWNLOADED ${xf} | ${cf}`);
} catch (e) { say({ kind: 'download-failed', err: String(e) }, `DOWNLOAD FAILED ${e}`); }
say({ kind: 'end', refreshes, errors: errors.length, liveMinutes: firstLive ? (Date.now() - firstLive) / 60000 : 0 }, `END ${refreshes} refreshes, ${errors.length} errors, ${firstLive ? ((Date.now() - firstLive) / 60000).toFixed(1) : 0} live minutes`);
await b.close(); jl.end(); tl.end();
