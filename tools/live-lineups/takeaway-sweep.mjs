// Sweep: every takeaway the engine writes, over the 300-game sample cut at six moments, read from both teams. Flags
// nonsense numbers ("about 0", NaN, negatives). Found by test 6: FDU at ETAM printed "about 0 the other way".
// usage: node tools/live-lineups/takeaway-sweep.mjs   (expects 0 bad)
import fs from 'node:fs'; import zlib from 'node:zlib';
import { compact, analyze, takeaways, elapsed } from '../../public/live-lineups/js/engine.js';
const files = fs.readFileSync('tools/live-lineups/random300.txt', 'utf8').trim().split('\n');
const bad = /about -?0(\.5)? |about 0\.|NaN|undefined|null|about -\d|Infinity|the other way/;
let n = 0, hits = [], errs = 0; const heads = new Map();
for (const f of files) {
  const g = compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))));
  const teams = Object.keys(g.box);
  const els = g.plays.map(p => elapsed(p[0], p[1]));
  for (const cut of [600, 1100, 1200, 1800, 2280, Infinity]) {
    const keep = g.plays.filter((p, i) => els[i] <= cut); if (keep.length < 20) continue;
    const last = keep[keep.length - 1];
    const gg = { ...g, plays: keep };
    if (cut !== Infinity) { gg.status = { ...g.status, state: 'in', period: last[0], clock: last[1] }; gg.score = gg.score; }
    for (const tm of teams) {
      try { const A = analyze(gg, tm, { prior: [], ratings: null }); if (!A.lineupOk) continue;
        for (const x of takeaways(A)) { n++; const s = `${x.head} ${x.why || ''}`; const k = x.head.replace(/\d+/g, '#'); heads.set(k, (heads.get(k) || 0) + 1); if (bad.test(s)) hits.push(`${f.split('/').pop()} ${tm} @${cut}: ${s}`); }
      } catch (e) { errs++; if (errs < 4) console.log('ERR', f, tm, cut, e.message); }
    }
  }
}
console.log('takeaways checked', n, 'errors', errs, 'bad', hits.length); hits.slice(0, 25).forEach(h => console.log(' ', h));
console.log([...heads].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join('\n'));
