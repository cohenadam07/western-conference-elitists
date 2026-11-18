// Engine at a moment, no browser. Usage: node tools/live-lineups/moment.mjs <gid> <period-clock e.g. 2-9:00> [priorGid,...]
import fs from 'node:fs'; import zlib from 'node:zlib'; import os from 'node:os';
import { compact, analyze, digest, elapsed, takeaways, onPaper, mmss } from '../../public/live-lineups/js/engine.js';
const [gid, at, priors = ''] = process.argv.slice(2);
const load = id => compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(`${os.homedir()}/Basketball-Savant/espn-cache/cbb/2026-27/raw/${id}.json.gz`))));
const full = load(gid); const [p, c] = at.split('-'); const cut = elapsed(Number(p), c);
const g = { ...full, plays: full.plays.filter(q => elapsed(q[0], q[1]) <= cut), cut };
const ratings = JSON.parse(fs.readFileSync('public/live-lineups/ratings-2025-26.json'));
const prior = priors.split(',').filter(Boolean).map(id => digest(load(id), '201'));
const A = analyze(g, '201', { prior, ratings, replay: true });
const nm = k => k.split('|').map(x => A.names[x]).join(', ');
console.log('score', A.score, 'parsed', A.parsed, 'team fouls', A.teamFouls, 'lead', A.score.OU - A.score.OPP);
console.log('OU now', nm(A.usNowKey), 'together', mmss(A.together)); console.log('Opp now', A.oppNow.map(x => `${A.names[x]} ${A.fouls[x] || 0}f ${Math.round(A.minutes[x])}m`).join('; '));
console.log('best run', A.bestRun, 'current', A.currentRun, 'drought', A.drought);
for (const t of takeaways(A, 'live')) console.log('TAKEAWAY', t.kind, '|', t.head, '|', t.why);
console.log('PAPER', onPaper(A));
const sh = A.shots; const f = (a) => `${a.filter(s => s.made).length} of ${a.length}`;
for (const t of ['OU', 'OPP']) { const S = sh.filter(s => s.team === t); console.log(t, 'shots', S.length, 'charted', S.filter(s => s.chart).length, 'rim', f(S.filter(s => s.rim)), 'three', f(S.filter(s => s.three)), 'other', f(S.filter(s => !s.rim && !s.three)), 'ast', `${S.filter(s => s.ast).length} of ${S.filter(s => s.made).length}`); }
console.log('sources', JSON.stringify(A.srcGame)); console.log('impact', A.impact.slice(0, 3).map(o => `${o.name} ${o.gs.toFixed(1)}`).join('; '));
console.log('stints', A.stints.length, 'T', A.T && { pm: A.T.pm, tpa: A.T.tpa.toFixed(1), rim: A.T.rim.toFixed(1), tovf: A.T.tov_forced.toFixed(1) }, 'P', A.P && { tpa: A.P.tpa.toFixed(1), rim: A.P.rim.toFixed(1) });
console.log('minutes OU now', A.usNow.map(x => `${A.names[x]} ${Math.round(A.minutes[x])}`).join(', '));
