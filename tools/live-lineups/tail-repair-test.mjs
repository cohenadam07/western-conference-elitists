// Test: bad-substitution handling on two real live feeds saved during test 6 (research/live-lineups-test/live/feeds/).
//  - KC vs FAMU at 1st half 7:47: ESPN's FAMU subs don't add up (a 10:25 sub was missing until halftime). Must repair,
//    reconcile, and warn. At halftime ESPN backfilled it: must parse clean with no repair and no warning.
//  - DART at UALB at 1st half 13:26: a five-man change half-posted at the feed's tail. Live, no warning (the next pull
//    completes it); the same broken group with later plays, or at the final, warns.
// usage: node tools/live-lineups/tail-repair-test.mjs
import fs from 'node:fs'; import zlib from 'node:zlib';
import { compact, analyze } from '../../public/live-lineups/js/engine.js'; import { banners } from '../../public/live-lineups/js/render.js';
const F = 'research/live-lineups-test/live/feeds/'; const load = f => compact(JSON.parse(zlib.gunzipSync(fs.readFileSync(F + f))));
const kc = load('401921005-kc-1st-7-47-bad-subs.json.gz'), kc2 = load('401921005-kc-halftime-corrected.json.gz'), g = load('401920234-dart-1st-13-26.json.gz');
const ins = g.plays.map((p, i) => [p, i]).filter(([p]) => p[0] === 1 && p[1] === '13:26' && p[3] === 'Substitution' && p[2] === '159' && /subbing in/.test(p[4])).map(x => x[1]);
const lastIn = ins[ins.length - 1]; const later = [...g.plays.find(p => p[2] === '399' && p[3] === 'JumpShot' && p[8]?.length)]; later[1] = '13:05'; later[5] = 0; later[6] = false; later[4] = 'misses (synthetic)'; later[11] = g.plays.at(-1)[11]; later[12] = g.plays.at(-1)[12];
const cases = [
  ['KC 7:47, bad FAMU subs mid-feed', kc, '140', 'live', true],
  ['KC halftime, ESPN corrected', kc2, '140', 'live', false],
  ['DART 13:26 group half-posted at tail', { ...g, plays: g.plays.slice(0, lastIn) }, '159', 'live', false],
  ['DART same group, a later play exists', { ...g, plays: [...g.plays.filter((p, i) => i !== lastIn), later] }, '159', 'live', true],
  ['DART half-posted at tail, game final', { ...g, plays: g.plays.slice(0, lastIn) }, '159', 'final', true],
  ['DART complete group', g, '159', 'live', false],
];
let fail = 0;
for (const [name, gg, team, state, wantWarn] of cases) {
  const A = analyze(gg, team, { prior: [], ratings: null }); const b = banners(A, { state }).replace(/<[^>]+>/g, '');
  const warn = /looks wrong/.test(b), rec = A.parsed.OU === A.score.OU && A.parsed.OPP === A.score.OPP, ok = warn === wantWarn && A.lineupOk && rec;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: lineups ${A.lineupOk ? 'shown' : 'HIDDEN'}, repairs ${A.repairs.length}, ${A.parsed.OU}-${A.parsed.OPP} vs ${A.score.OU}-${A.score.OPP}, warning ${warn ? 'shown' : 'none'} (want ${wantWarn ? 'shown' : 'none'})`);
}
process.exit(fail ? 1 : 0);
