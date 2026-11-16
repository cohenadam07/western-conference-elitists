// Flappy Hoops records, before and after a release: a snapshot of every all-time record (with its count and its whole
// history) and the Knockout boards (Fastest per hole, Most KOs per world, their counts and histories), and a compare.
//   node tools/recsnap.mjs snap before.json         (before pushing to main)
//   node tools/recsnap.mjs snap after.json          (once wcehoops.com serves the new bundle: the snapshot's `build`)
//   node tools/recsnap.mjs compare before.json after.json    exits 1 and lists every difference
// Read-only: public GETs on /api/race (?rec=all, ?rec=history, ?rec=ko, ?rec=kohistory), four at a time.
// REC_BASE=http://localhost:8791/api/race to point it at tools/race-dev.mjs instead of the site.
import fs from 'node:fs';

const BASE = process.env.REC_BASE || 'https://wcehoops.com/api/race';
const get = async (q, tries = 4) => {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(`${BASE}?${q}&_=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 120)}`);
      return j;
    } catch (e) { if (k >= tries) throw new Error(`${q}: ${e.message}`); await new Promise((ok) => setTimeout(ok, 800 * (k + 1))); }
  }
};
async function pool(items, n, f) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } })); return out; }

async function snap(file) {
  const t0 = Date.now();
  const all = await get('rec=all');
  const keys = Object.keys(all.records).sort();
  const hist = {};
  await pool(keys, 4, async (key) => { const [h, b] = key.split('|'); const j = await get(`rec=history&h=${encodeURIComponent(h)}&b=${b}`); hist[key] = { entries: j.entries, breaks: j.breaks, hands: j.hands }; });
  const ko = await get('rec=ko');
  const kh = {}, kw = {};
  await pool(Object.keys(ko.holes).sort(), 4, async (h) => { const j = await get(`rec=kohistory&h=${encodeURIComponent(h)}`); kh[h] = { entries: j.entries, breaks: j.breaks, hands: j.hands }; });
  await pool(Object.keys(ko.worlds).sort(), 4, async (w) => { const j = await get(`rec=kohistory&w=${encodeURIComponent(w)}`); kw[w] = { entries: j.entries, breaks: j.breaks, hands: j.hands }; });
  const S = { at: new Date(t0).toISOString(), build: all.build, records: all.records, counts: all.counts, history: hist, ko: { holes: ko.holes, counts: ko.counts, worlds: ko.worlds, wcounts: ko.wcounts, holeHistory: kh, worldHistory: kw } };
  fs.writeFileSync(file, JSON.stringify(S));
  console.log(`${file}: build ${all.build}; ${keys.length} records, ${Object.keys(all.counts).length} counts, ${Object.values(hist).reduce((a, x) => a + x.entries.length, 0)} history entries; Knockout: ${Object.keys(ko.holes).length} hole boards (${Object.values(kh).reduce((a, x) => a + x.entries.length, 0)} history), ${Object.keys(ko.worlds).length} world boards (${Object.values(kw).reduce((a, x) => a + x.entries.length, 0)} history) (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

function compare(fa, fb) {
  const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
  const diffs = [];
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const cmpMap = (name, a, b) => {
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (!eq(a[k], b[k])) diffs.push(`${name} ${k}: ${JSON.stringify(a[k]).slice(0, 160)} -> ${JSON.stringify(b[k]).slice(0, 160)}`);
  };
  cmpMap('record', A.records, B.records); cmpMap('count', A.counts, B.counts); cmpMap('history', A.history, B.history);
  cmpMap('ko hole', A.ko.holes, B.ko.holes); cmpMap('ko count', A.ko.counts, B.ko.counts); cmpMap('ko world', A.ko.worlds, B.ko.worlds); cmpMap('ko wcount', A.ko.wcounts, B.ko.wcounts);
  cmpMap('ko hole history', A.ko.holeHistory, B.ko.holeHistory); cmpMap('ko world history', A.ko.worldHistory, B.ko.worldHistory);
  console.log(`before ${A.at} (build ${A.build}), after ${B.at} (build ${B.build})`);
  console.log(`records ${Object.keys(A.records).length} -> ${Object.keys(B.records).length}; Knockout hole boards ${Object.keys(A.ko.holes).length} -> ${Object.keys(B.ko.holes).length}, world boards ${Object.keys(A.ko.worlds).length} -> ${Object.keys(B.ko.worlds).length}`);
  console.log(diffs.length ? `${diffs.length} DIFFERENCES:\n` + diffs.join('\n') : 'IDENTICAL: every record, count, history entry and Knockout board (and its history)');
  process.exit(diffs.length ? 1 : 0);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'snap') await snap(a); else if (cmd === 'compare') compare(a, b); else { console.error('snap <file> | compare <a> <b>'); process.exit(2); }
