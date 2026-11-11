// JS side of the parity test, and the comparison. Usage: node tools/live-lineups/parity.mjs <list.txt> <python.jsonl>
import fs from 'node:fs'; import zlib from 'node:zlib';
import { compact, parseGame, stintWindows, stintRows } from '../../public/live-lineups/js/engine.js';
const [list, pyOut] = process.argv.slice(2);
const py = new Map(fs.readFileSync(pyOut, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.path, r]));
let otRows = 0, emptyOk = 0; let same = 0, diff = 0, games = 0; const statuses = {}; const diffs = [];
const canon = x => JSON.stringify(x);
for (const path of fs.readFileSync(list, 'utf8').split(/\s+/).filter(Boolean)) {
  const p = py.get(path); games++;
  const g = compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(path))));
  let res, st; try { [res, st] = parseGame(g); } catch (e) { res = null; st = 'exc ' + e.constructor.name; }
  const rec = { status: st };
  if (res) {
    rec.errs = res.errs; rec.checks = res.checks; rec.poss = res.poss; rec.stints = {};
    const names = {}; for (const ath of Object.values(g.box)) for (const a of ath) names[a[0]] = a[1];
    for (const t of Object.keys(g.box).filter(Boolean)) {
      const W = stintWindows(g, t);
      if (!W.ok) { rec.stints[t] = W.err === 'size' ? 'size' : 'exc'; continue; }
      rec.stints[t] = stintRows(W.windows, res.poss, t).map(r => ({ half: r.half, start: r.start, end: r.end, players: r.players.map(x => names[x]).sort(),
        u: Object.fromEntries(Object.entries(r.u).filter(([k, v]) => v)) }));
    }
  }
  statuses[st] = (statuses[st] || 0) + 1;
  const bad = [];
  if (p.status !== rec.status) bad.push(`status py=${p.status} js=${rec.status}`);
  else if (res) {
    if (p.errs !== rec.errs || p.checks !== rec.checks) bad.push(`errs/checks py=${p.errs}/${p.checks} js=${rec.errs}/${rec.checks}`);
    if (p.poss.length !== rec.poss.length) bad.push(`poss count py=${p.poss.length} js=${rec.poss.length}`);
    else p.poss.forEach((a, i) => { const b = rec.poss[i]; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (canon(a[k]) !== canon(b[k])) bad.push(`poss ${i} ${k} py=${canon(a[k])} js=${canon(b[k])}`); });
    for (const t of Object.keys(p.stints)) {
      const a = p.stints[t], b = rec.stints[t];
      if (a === 'exc IndexError' && Array.isArray(b) && b.length === 0) { emptyOk++; continue; } // no plays: Python's plays[-1] raises, JS returns no stints
      if (typeof a === 'string' || typeof b === 'string') { if (a !== b && !(String(a).startsWith('exc') && b === 'exc')) bad.push(`stints ${t} py=${a} js=${b}`); continue; }
      if (a.length !== b.length) { bad.push(`stints ${t} count py=${a.length} js=${b.length}`); continue; }
      a.forEach((x, i) => { if (String(b[i].half).startsWith('OT')) { otRows++; x = { ...x, half: b[i].half, start: b[i].start, end: b[i].end }; } // reference prints OT clocks as negative 2nd-half clocks
        if (canon(x) !== canon({ half: b[i].half, start: b[i].start, end: b[i].end, players: b[i].players, u: Object.fromEntries(Object.keys(x.u).map(k => [k, b[i].u[k]]).concat(Object.entries(b[i].u).filter(([k]) => !(k in x.u)))) })) bad.push(`stint ${t} ${i} py=${canon(x)} js=${canon(b[i])}`); });
    }
  }
  if (bad.length) { diff++; diffs.push([path, bad.slice(0, 4)]); } else same++;
}
const nposs = [...py.values()].reduce((a, r) => a + (r.poss ? r.poss.length : 0), 0);
console.log(`games ${games}: identical ${same}, different ${diff}; parser status ${JSON.stringify(statuses)}; possessions compared ${nposs}; stint rows in overtime relabelled (stats compared) ${otRows}; no-play games ${emptyOk}`);
for (const [p, b] of diffs.slice(0, 10)) console.log('DIFF', p, b);
process.exitCode = diff ? 1 : 0;
