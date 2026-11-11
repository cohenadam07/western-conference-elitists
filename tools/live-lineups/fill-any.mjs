// Fill the tracker for any team in any cached game (e.g. overtime checks). Usage: node tools/live-lineups/fill-any.mjs <out.xlsx> <team> <raw.json.gz>
import fs from 'node:fs'; import zlib from 'node:zlib';
import JSZip from 'jszip';
import { compact, digest, teamNames, chicagoDate } from '../../public/live-lineups/js/engine.js';
import { fillWorkbook } from '../../public/live-lineups/js/xlsx.js';
const [out, team, path] = process.argv.slice(2);
const g = compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(path))));
const d = digest(g, team); const N = teamNames(g, team); const dt = chicagoDate(g.date);
const info = {}; for (const a of g.box[team]) info[a[0]] = { name: a[1], jersey: a[5], pos: a[4] };
const res = await fillWorkbook(JSZip, fs.readFileSync('public/live-lineups/tracker-template.xlsx'),
  [{ label: `${N.oppShort} ${dt.m}/${dt.d}`, date: dt, opp: N.oppShort, rows: d.rows.map(r => ({ ...r, players: r.players.map(p => info[p]) })) }]);
fs.writeFileSync(out, res.data);
console.log(JSON.stringify({ team, opp: N.oppShort, final: g.score, rows: res.rows, added: res.added.length, halves: [...new Set(d.rows.map(r => r.half))],
  otRows: d.rows.filter(r => String(r.half).startsWith('OT')).map(r => `${r.half} ${r.start}-${r.end}`) }));
