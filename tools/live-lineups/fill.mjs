// Build the tracker download in Node with the page's own modules. Usage: node tools/live-lineups/fill.mjs <out.xlsx> <gid> [<gid>...]
import fs from 'node:fs'; import zlib from 'node:zlib'; import os from 'node:os';
import JSZip from 'jszip';
import { compact, digest, teamNames, chicagoDate } from '../../public/live-lineups/js/engine.js';
import { fillWorkbook } from '../../public/live-lineups/js/xlsx.js';
const [out, ...gids] = process.argv.slice(2); const TEAM = '201';
const games = gids.map(gid => {
  const g = compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(`${os.homedir()}/Basketball-Savant/espn-cache/cbb/2026-27/raw/${gid}.json.gz`))));
  const d = digest(g, TEAM); const N = teamNames(g, TEAM); const dt = chicagoDate(g.date);
  const info = {}; for (const a of g.box[TEAM]) info[a[0]] = { name: a[1], jersey: a[5], pos: a[4] };
  return { label: `${N.oppShort} ${dt.m}/${dt.d}`, date: dt, opp: N.oppShort, rows: d.rows.map(r => ({ ...r, players: r.players.map(p => info[p]) })) };
});
const res = await fillWorkbook(JSZip, fs.readFileSync('public/live-lineups/tracker-template.xlsx'), games);
fs.writeFileSync(out, res.data);
console.log('rows', res.rows, 'added to roster', res.added, 'truncated', res.truncated);
