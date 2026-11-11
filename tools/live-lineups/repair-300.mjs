// Bad-substitution repair over the 300-game sample: games whose parse fails, how many repair rescues, whether rescued
// games reconcile, that clean games are never touched, and (live) how often a game cut mid-feed hides its lineups.
// usage: node tools/live-lineups/repair-300.mjs
import fs from 'node:fs'; import zlib from 'node:zlib';
import { compact, parseGame, analyze, elapsed } from '../../public/live-lineups/js/engine.js';
const files = fs.readFileSync('tools/live-lineups/random300.txt', 'utf8').trim().split('\n');
const s = { bad: 0, rescued: 0, rescuedReconcile: 0, ok: 0, crash: 0, cleanGamesRepaired: 0, liveCuts: 0, liveCutsHidden: 0, liveCutsRepaired: 0, liveCutsRecon: 0 }; const lines = [];
for (const f of files) {
  const g = compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)))); const id = f.split('/').pop();
  const team = Object.keys(g.box)[0];
  try {
    const [res] = parseGame(g); const A = analyze(g, team, { prior: [], ratings: null });
    const rec = A.parsed.OU === A.score.OU && A.parsed.OPP === A.score.OPP;
    if (res) { s.ok++; if (A.repairs.length) s.cleanGamesRepaired++; }
    else { s.bad++; if (A.lineupOk) { s.rescued++; if (rec) s.rescuedReconcile++; lines.push(`${id} rescued, repairs ${A.repairs.length}, score ${rec ? 'reconciles' : 'off'}, first ${A.repairs[0].period}-${A.repairs[0].clock}`); } else lines.push(`${id} NOT rescued: lineups hidden, light ${rec ? 'green' : 'off'}`); }
    if (!res) continue;
    // live: clean games cut every ~2 min of game time, as the feed would look mid-game
    const els = g.plays.map(p => elapsed(p[0], p[1]));
    for (let cut = 90; cut < 2400; cut += 130) {
      const keep = g.plays.filter((p, i) => els[i] <= cut); if (keep.length < 10) continue; const last = keep[keep.length - 1];
      const gg = { ...g, plays: keep, status: { ...g.status, state: 'in', period: last[0], clock: last[1] } };
      const B = analyze(gg, team, { prior: [], ratings: null }); s.liveCuts++;
      if (!B.lineupOk) s.liveCutsHidden++; if (B.repairs.length) s.liveCutsRepaired++;
      if (B.parsed.OU === B.score.OU && B.parsed.OPP === B.score.OPP) s.liveCutsRecon++;
    }
  } catch (e) { s.crash++; lines.push(`${id} CRASH ${e.message}`); }
}
console.log(s); for (const l of lines) console.log(l);
