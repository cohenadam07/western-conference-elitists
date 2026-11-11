// Live Lineups screens. Pure string builders: state in, HTML out. Copy and rules follow reference/mock3.py, mock4.py, mock5.py.
import { CONFIG, mmss, lastName, fmtClock, periodEnd, takeaways, onPaper, summarize, emptyCounter, addCounter } from './engine.js';

export const E = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const sgn = (x, d = 0) => { const v = d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x); if (v === 0) return '0'; return v > 0 ? `+${v}` : `−${Math.abs(v)}`; };
const pmc = v => (v > 0 ? 'p' : v < 0 ? 'n' : 'z');
const pct = x => (x == null ? '—' : `${Math.round(x)}%`);
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fiveLabel = (A, key) => key.split('|').map(pid => lastName(A.names[pid] || pid));
const sortFive = (A, key) => [...key.split('|')].sort((a, b) => (A.minutes[b] || 0) - (A.minutes[a] || 0)).join('|');
export const TABS = [['now', 'Right now'], ['shots', 'Shots and scoring'], ['players', 'Their key players'], ['sheet', 'Spreadsheet']];

// ---------------------------------------------------------------- court (feet). NCAA men: rim 5.25 ft from baseline, arc 22.146 ft, corner 21.65 ft
const RIM_X = 5.25, ARC = 22.146, CORNER = 21.65, ARC_X = RIM_X + Math.sqrt(ARC ** 2 - CORNER ** 2), B = 3.6;
const PLANK = ['#E9D2A8', '#E5CCA0', '#ECD6AE', '#E7CFA5'];
function placeShots(shots, mapXY) {
  const seen = new Map(); let out = '';
  for (const s of shots) {
    if (!s.chart) continue;
    const yb = Math.min(s.y, 46.5); let [X, Y] = mapXY(s, yb);
    const key = `${Math.round(X * 2)},${Math.round(Y * 2)}`; const n = seen.get(key) || 0; seen.set(key, n + 1);
    if (n) { const a = n * 2.4; X += 0.9 * Math.sqrt(n) * Math.cos(a); Y += 0.9 * Math.sqrt(n) * Math.sin(a); }
    const cls = !s.made ? 'mx' : s.ast ? 'ma' : 'mu';
    out += `<circle cx="${X.toFixed(2)}" cy="${Y.toFixed(2)}" r=".82" class="${cls}"/>`;
  }
  return out;
}
function endLines(left) {
  const tr = left ? '' : ' transform="translate(94,50) rotate(180)"';
  return `<g${tr} class="ln"><rect x="0" y="19" width="19" height="12" class="lane"/><path d="M19,19 V31"/><circle cx="19" cy="25" r="6" class="ftc"/>
<path d="M0,${(25 - CORNER).toFixed(3)} H${ARC_X.toFixed(3)} A${ARC},${ARC} 0 0 1 ${ARC_X.toFixed(3)},${(25 + CORNER).toFixed(3)} H0"/>
<path d="M${RIM_X},21 A4,4 0 0 1 ${RIM_X},29" class="ra"/><path d="M4,22 V28" class="bb"/><circle cx="${RIM_X}" cy="25" r=".75" class="rim"/></g>`;
}
export function courtSVG(shots, oppShort, vertical = false) {
  const marks = placeShots(shots, (s, yb) => (s.team === 'OU' ? [yb, s.x] : [94 - yb, 50 - s.x]));
  const planks = PLANK.flatMap(() => 0).length ? Array.from({ length: 20 }, (_, i) => `<rect x="0" y="${i * 2.5}" width="94" height="2.5" fill="${PLANK[i % 4]}"/>`).join('') : '';
  const inner = `<rect x="${-B}" y="${-B}" width="${94 + 2 * B}" height="${50 + 2 * B}" fill="#841617"/>
<text x="47" y="${(-B / 2 + 0.05).toFixed(2)}" class="oob">OKLAHOMA</text><text x="47" y="${(50 + B / 2 + 0.05).toFixed(2)}" class="oob">BOOMER  SOONER</text>
<g>${planks}</g>${endLines(true)}${endLines(false)}
<g class="ln"><path d="M47,0 V50"/><circle cx="47" cy="25" r="6"/><rect x="0" y="0" width="94" height="50" class="bnd"/></g>`;
  const label = `Shot chart: Oklahoma shots at the ${vertical ? 'top' : 'left'} basket, ${oppShort} shots at the ${vertical ? 'bottom' : 'right'}`;
  if (!vertical) return `<svg class="court h" viewBox="${-B} ${-B} ${94 + 2 * B} ${50 + 2 * B}" role="img" aria-label="${E(label)}">${inner}
<image href="/live-lineups/ou-mark-crimson.png" x="${47 - 4.6}" y="${25 - 5.95}" width="9.2" height="11.9" opacity=".9"/><g>${marks}</g></svg>`;
  return `<svg class="court v" viewBox="${-B} ${-B} ${50 + 2 * B} ${94 + 2 * B}" role="img" aria-label="${E(label)}"><g transform="translate(50,0) rotate(90)">${inner}<g>${marks}</g></g>
<image href="/live-lineups/ou-mark-crimson.png" x="${25 - 4.6}" y="${47 - 5.95}" width="9.2" height="11.9" opacity=".9"/></svg>`;
}
export function miniCourtSVG(shots, name) {
  const D = 32;
  const marks = placeShots(shots, (s, yb) => [50 - s.x, yb]);
  const planks = Array.from({ length: 20 }, (_, i) => `<rect x="${i * 2.5}" y="0" width="2.5" height="${D}" fill="${PLANK[i % 4]}"/>`).join('');
  return `<svg class="mini" viewBox="-1.5 -1.5 53 ${D + 1.5}" role="img" aria-label="${E(name)} shots"><rect x="-1.5" y="-1.5" width="53" height="${D + 1.5}" fill="#841617"/><g>${planks}</g>
<g class="ln"><rect x="19" y="0" width="12" height="19" class="lane"/><path d="M19,19 H31"/><path d="M19,19 A6,6 0 0 0 31,19" class="ftc"/>
<path d="M${(25 - CORNER).toFixed(3)},0 V${ARC_X.toFixed(3)} A${ARC},${ARC} 0 0 0 ${(25 + CORNER).toFixed(3)},${ARC_X.toFixed(3)} V0"/>
<path d="M21,${RIM_X} A4,4 0 0 0 29,${RIM_X}" class="ra"/><path d="M22,4 H28" class="bb"/><circle cx="25" cy="${RIM_X}" r=".75" class="rim"/><path d="M0,0 H50"/></g><g>${marks}</g></svg>`;
}
const keySw = cls => `<svg width="15" height="15" viewBox="-1 -1 2 2" aria-hidden="true"><circle r=".78" class="${cls}" style="stroke-width:.14"/></svg>`;
export const shotKey = () => `<ul class="key" aria-label="Shot key"><li>${keySw('mu')}Made, unassisted</li><li>${keySw('ma')}Made, assisted</li><li>${keySw('mx')}Missed</li></ul>`;

// ---------------------------------------------------------------- band, banners, footer
function statusLabel(S) {
  if (S.state === 'pre') return { per: S.when || 'Today', clk: S.tip || '', small: true };
  if (S.state === 'half') return { per: 'End of first half', clk: 'Halftime', small: true };
  if (S.state === 'final') return { per: S.periods > 2 ? `Final, ${S.periods === 3 ? 'overtime' : `${S.periods - 2} overtimes`}` : 'Final', clk: 'Final', small: true };
  const p = S.period; const per = p === 1 ? '1st half' : p === 2 ? '2nd half' : p === 3 ? 'Overtime' : `${p - 2}nd overtime`.replace('2nd overtime', '2nd overtime').replace(/^3nd/, '3rd').replace(/^(\d)nd/, (m, d) => (d === '2' ? '2nd' : `${d}th`));
  return { per, clk: S.clock, small: false };
}
export function band(A, S, view) {
  const st = statusLabel(S);
  const tf = A ? A.teamFouls : { OU: 0, OPP: 0 }; const oppF = tf.OPP;
  const chip = oppF === CONFIG.BONUS - 1 ? '<span class="chip soft">Bonus on next foul</span>' : oppF >= CONFIG.DOUBLE_BONUS ? '<span class="chip">Double bonus</span>' : oppF >= CONFIG.BONUS ? '<span class="chip">In the bonus</span>' : '';
  const live = S.state === 'live';
  const upd = `<span class="dot ${live ? 'beat' : 'still'}" data-pulse></span>${live ? 'Live' : S.state === 'half' ? 'Halftime' : S.state === 'final' ? 'Final' : 'Not started'}${S.replay ? ' replay' : ''}`;
  const tabs = TABS.map(([k, l]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${view.tab === k}">${l}</button>`).join('');
  const foulRow = S.state === 'half'
    ? `<span>Team fouls reset for the second half</span><span class="vh">First half: Oklahoma ${A?.teamFoulsFirst.OU ?? 0}, ${E(S.oppShort)} ${A?.teamFoulsFirst.OPP ?? 0}</span>`
    : S.state === 'pre' ? `<span>Tip-off ${E(S.tip || '')}</span>` : `<span>Oklahoma team fouls <b>${tf.OU}</b></span><span>${E(S.oppShort)} team fouls <b>${oppF}</b>${chip}</span>`;
  return `<header class="band">
<div class="sb">
  <div class="team us"><img class="mark" src="/live-lineups/ou-mark.png" alt="" width="46" height="46"><span class="tn">Oklahoma</span><span class="sc" aria-label="Oklahoma ${S.score.OU}">${S.state === 'pre' ? '' : S.score.OU}</span></div>
  <div class="status" aria-live="polite"><span class="per">${E(st.per)}</span><span class="clk${st.small ? ' small' : ''}">${E(st.clk)}</span><span class="upd">${upd}</span></div>
  <div class="team them"><span class="sc" aria-label="${E(S.oppFull)} ${S.score.OPP}">${S.state === 'pre' ? '' : S.score.OPP}</span><span class="tn"><span class="full">${E(S.oppFull)}</span><span class="short">${E(S.oppShort)}</span></span></div>
</div>
<div class="fouls">${foulRow}<span class="liveline"><span class="dot ${live ? 'beat' : 'still'}" data-pulse></span><span data-ago>${live ? 'Live' : st.per}</span></span><nav class="tabs" role="tablist" aria-label="Views">${tabs}</nav></div>
</header>`;
}
export function bottomTabs(view) {
  return `<nav class="bottomtabs" role="tablist" aria-label="Views">${TABS.map(([k, l]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${view.tab === k}">${l}</button>`).join('')}</nav>`;
}
export function banners(A, S) {
  const b = [];
  if (S.unreachable) b.push(`<div class="banner err" role="alert"><b>Can't reach ESPN's play-by-play.</b> Retrying every 15 seconds.</div>`);
  if (S.stale) b.push(`<div class="banner" role="status"><b>Data delayed.</b> Last update ${E(S.stale)} ago.</div>`);
  if (A && !A.lineupOk) b.push(`<div class="banner err" role="status"><b>Lineups are hidden for this game.</b> ESPN's substitutions don't add up to five players on the floor and could not be repaired, so the score, shots, players and box numbers are shown without them.</div>`);
  else if (A && A.repairs.length) { const r = A.repairs[0]; const h = r.period === 1 ? '1st half' : r.period === 2 ? '2nd half' : 'overtime'; b.push(`<div class="banner" role="status"><b>One substitution looks wrong at ${h} ${E(r.clock)}.</b> Lineups after that may be off.</div>`); }
  return b.join('');
}
export function footer(A, S) {
  let recon = '';
  if (A && S.state !== 'pre') {
    const ok = A.parsed.OU === A.score.OU && A.parsed.OPP === A.score.OPP;
    const cls = ok ? '' : S.reconBadFor >= 60 ? 'red' : 'amber';
    recon = `<span class="recon ${cls}" title="Points counted from the play-by-play vs ESPN's score"><i></i>${ok ? 'Play-by-play matches the score' : `Play-by-play ${A.parsed.OU}-${A.parsed.OPP}, score ${A.score.OU}-${A.score.OPP}${cls === 'red' ? '' : ', catching up'}`}</span>`;
  }
  const rp = S.replay ? `<span class="replaybar">Replay at ${S.speed}x <button type="button" data-act="replay-toggle">${S.paused ? 'Play' : 'Pause'}</button></span>` : '';
  return `<footer class="foot"><button class="btn" type="button" data-act="drawer" aria-haspopup="dialog" aria-expanded="${!!S.drawer}">See all the numbers</button>
<span class="src">ESPN play-by-play, refreshed every 15 seconds</span>${recon}${rp}<span class="ver">Version ${CONFIG.version}</span>
<a class="wce" href="https://wcehoops.com" aria-label="Powered by Western Conference Elitists"><img src="/wce-logo-512.png" alt=""><span>Powered by <b>WCE</b></span></a></footer>`;
}

// ---------------------------------------------------------------- right now
function pips(f, warn) {
  return `<span class="pips${warn ? ' warn' : ''}" role="img" aria-label="${f} fouls">${[0, 1, 2, 3, 4].map(i => `<i class="${i < f ? 'on' : ''}"></i>`).join('')}<span class="fn" aria-hidden="true">${f}</span></span>`;
}
function floorRows(A, pids, opp, second) {
  return pids.map(pid => {
    const f = A.fouls[pid] || 0; const warn = f >= 4 || (!second && f >= 3);
    const hl = opp && warn ? ' hot' : warn ? ' warn' : '';
    return `<li class="pl${hl}"><span class="nm">${E(A.names[pid])}</span><span class="mn">${Math.round(A.minutes[pid] || 0)} min</span>${pips(f, warn)}</li>`;
  }).join('');
}
function tkHtml(items, S) {
  if (!items.length) return `<div class="lead"><p class="kind">${S.state === 'final' ? 'Final' : 'Right now'}</p><h1>Nothing here needs a change.</h1><p class="why">No foul trouble to attack, no run, and shooting luck is small so far. Check back after the next stoppage.</p></div>`;
  const [lead, ...rest] = items;
  return `<div class="lead"><p class="kind">${E(lead.kind)}</p><h1>${E(lead.head)}</h1><p class="why">${E(lead.why)}</p></div><ul class="notes">${rest.map(t => `<li><p class="kind">${E(t.kind)}</p><div><p class="nh">${E(t.head)}</p><p class="why">${E(t.why)}</p></div></li>`).join('')}</ul>`;
}
function strip(A, S, { live }) {
  const G = Math.max(2400, periodEnd(A.period)); const cut = A.cut;
  const x = t => (100 * t / G);
  const tl = A.timeline; const ms = tl.map(p => p[1]);
  const top = Math.max(8, Math.max(...ms) + 4), bot = Math.min(-8, Math.min(...ms) - 4);
  const y = m => 100 * (top - m) / (top - bot);
  let pth = `M0,${y(0).toFixed(2)}`; for (const [t, m] of tl) pth += ` H${x(t).toFixed(2)} V${y(m).toFixed(2)}`;
  const area = pth + ` H${x(cut).toFixed(2)} V${y(0).toFixed(2)} Z`; const y0 = y(0);
  const svg = `<svg class="flow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="up"><rect x="0" y="0" width="100" height="${y0.toFixed(2)}"/></clipPath><clipPath id="dn"><rect x="0" y="${y0.toFixed(2)}" width="100" height="${(100 - y0).toFixed(2)}"/></clipPath></defs>
<rect x="${x(cut).toFixed(2)}" y="0" width="${Math.max(0, 100 - x(cut)).toFixed(2)}" height="100" class="future"/><line x1="0" x2="100" y1="${y0.toFixed(2)}" y2="${y0.toFixed(2)}" class="zero"/>
<line x1="${x(1200).toFixed(2)}" x2="${x(1200).toFixed(2)}" y1="0" y2="100" class="half"/>${G > 2400 ? `<line x1="${x(2400).toFixed(2)}" x2="${x(2400).toFixed(2)}" y1="0" y2="100" class="half"/>` : ''}
<path d="${area}" class="a-up" clip-path="url(#up)"/><path d="${area}" class="a-dn" clip-path="url(#dn)"/><path d="${pth}" class="ln"/></svg>`;
  const lead = A.score.OU - A.score.OPP;
  const ticks = [-30, -20, -10, 10, 20, 30].filter(v => bot < v && v < top).map(v => `<span class="yt" style="top:${y(v).toFixed(2)}%">${sgn(v)}</span>`).join('');
  const br = A.bestRun; let runtag = '';
  if (br && br.margin >= 10) runtag = `<span class="run${br.team === 'OU' ? '' : ' them'}" style="left:${x(br.t0).toFixed(2)}%;width:${Math.max(1, x(br.t1) - x(br.t0)).toFixed(2)}%"><b>${br.team === 'OU' ? 'Oklahoma' : E(S.oppShort)} ${br.us}–${br.them} run</b></span>`;
  const tagLeft = x(cut) > 88 ? ' left' : '';
  const flow = `<div class="row flowrow"><div class="lab"><span class="lab-h">Oklahoma lead</span></div><div class="track flowtrack">${svg}${ticks}<span class="nowl" style="left:${x(cut).toFixed(2)}%"></span><span class="nowtag${lead < 0 ? ' neg' : ''}${tagLeft}" style="left:${x(cut).toFixed(2)}%;top:${y(lead).toFixed(2)}%">${sgn(lead)}</span>${runtag}</div><div class="tot"></div></div>`;
  if (!A.lineupOk) return flow + `<p class="note">Lineup rows are hidden because the substitutions in ESPN's feed don't add up.</p>`;
  const agg = new Map();
  for (const s of A.stints) { const a = agg.get(s.key) || { min: 0, pm: 0, st: [] }; a.min += (s.t1 - s.t0) / 60; a.pm += s.pm; a.st.push(s); agg.set(s.key, a); }
  const now = live ? A.usNowKey : null;
  const order = [...agg.keys()].sort((a, b) => agg.get(b).min - agg.get(a).min);
  const keep = order.slice(0, 3); if (now && !keep.includes(now)) { keep.push(now); if (!agg.has(now)) agg.set(now, { min: 0, pm: 0, st: [] }); } // just checked in
  const rest = order.filter(k => !keep.includes(k));
  const lastSt = A.stints[A.stints.length - 1];
  const blocks = sts => sts.map(s => `<span class="blk ${pmc(s.pm)}${live && s === lastSt ? ' cur' : ''}${s.flagged ? ' flag' : ''}" style="left:${x(s.t0).toFixed(2)}%;width:${Math.max(0.35, x(s.t1) - x(s.t0)).toFixed(2)}%" title="${sgn(s.pm)}"></span>`).join('');
  const nowl = `<span class="nowl" style="left:${x(cut).toFixed(2)}%"></span>`;
  const rows = keep.map(k => {
    const a = agg.get(k); const isnow = k === now;
    return `<button type="button" class="row${isnow ? ' isnow' : ''}" data-five="${E(k)}" aria-label="${E(fiveLabel(A, sortFive(A, k)).join(', '))}: ${mmss(a.min)} together, ${sgn(a.pm)}. Show their shots."><span class="lab"><span class="five">${E(fiveLabel(A, k).join(', '))}</span>${isnow ? '<span class="ontag">Now</span>' : ''}</span>
<span class="track">${blocks(a.st)}${nowl}</span><span class="tot"><span class="tm">${mmss(a.min)}</span><span class="pm ${pmc(a.pm)}">${sgn(a.pm)}</span></span></button>`;
  });
  if (rest.length) {
    const rm = rest.reduce((s, k) => s + agg.get(k).min, 0), rp = rest.reduce((s, k) => s + agg.get(k).pm, 0);
    rows.push(`<div class="row other"><div class="lab"><span class="five">${rest.length} other group${rest.length === 1 ? '' : 's'}</span></div><div class="track">${blocks(rest.flatMap(k => agg.get(k).st))}${nowl}</div><div class="tot"><span class="tm">${mmss(rm)}</span><span class="pm ${pmc(rp)}">${sgn(rp)}</span></div></div>`);
  }
  const axis = `<div class="row axis" aria-hidden="true"><div class="lab"></div><div class="track axtrack"><span style="left:0">Tip-off</span><span style="left:${x(1200).toFixed(2)}%">Half</span><span style="left:100%">End</span></div><div class="tot"><span class="tm">Min</span><span class="pm z">+/−</span></div></div>`;
  return flow + rows.join('') + axis;
}
export function nowTab(A, S) {
  const second = A.period >= 2;
  if (S.state === 'half' || S.state === 'final') {
    const items = takeaways(A, 'half'); const full = S.state === 'final';
    const cap = full ? Math.max(40, A.cut / 60) : 20;
    const rows = A.ouPlayers.map(r => { const warn = r.fouls >= (full ? 4 : 3); return `<li class="pl${warn ? ' warn' : ''}"><span class="nm">${E(r.name)}</span><span class="mbar" role="img" aria-label="${Math.round(r.min)} minutes"><i style="width:${Math.min(100, 100 * r.min / cap).toFixed(0)}%"></i></span>${pips(r.fouls, warn)}</li>`; }).join('');
    return `<main class="now-main"><section class="say" aria-label="${full ? 'Final' : 'Halftime'}">${tkHtml(items, S)}</section>
<section class="floor minutes" aria-labelledby="mn"><h2 id="mn">${full ? 'Minutes and fouls' : 'First-half minutes and fouls'}</h2><div class="grp"><div class="grp-h"><span>Bars show minutes out of ${full ? 40 : 20}</span><span>Fouls</span></div><ul>${rows}</ul></div></section></main>
<section class="strip" aria-labelledby="st"><div class="strip-h"><h2 id="st">Who was out there</h2><p>A record of who played when. One ${full ? 'game' : 'half'} is too few minutes to judge a group.</p></div>${strip(A, S, { live: false })}</section>`;
  }
  const items = takeaways(A, 'live'); const paper = onPaper(A);
  const usRows = A.lineupOk ? floorRows(A, sortFive(A, A.usNowKey).split('|'), false, second) : '';
  const opRows = A.oppNowKey ? floorRows(A, sortFive(A, A.oppNowKey).split('|'), true, second) : '';
  const floor = `<section class="floor" aria-label="On the floor">
<div class="grp"><div class="grp-h"><b>Oklahoma on the floor</b><span>${A.lineupOk ? `Together ${mmss(A.together)}` : 'Hidden'}</span></div><ul>${usRows || '<li class="pl"><span class="nm" style="color:var(--muted)">Not shown: the substitutions don\'t add up</span></li>'}</ul></div>
<div class="grp"><div class="grp-h"><b>${E(S.oppShort)} on the floor</b><span>Minutes and fouls tonight</span></div><ul>${opRows}</ul></div>
${paper && A.lineupOk ? `<p class="paper"><b>${E(paper.head)}</b> ${E(paper.why)}</p>` : ''}</section>`;
  return `<main class="now-main"><section class="say" aria-label="What matters now">${tkHtml(items, S)}</section>${floor}</main>
<section class="strip" aria-labelledby="st"><div class="strip-h"><h2 id="st">Who has been out there</h2><p>A record of who played when. One game is too few minutes to judge a group.</p></div>${strip(A, S, { live: true })}</section>`;
}

// ---------------------------------------------------------------- shots and scoring
const inW = (t, W) => W.some(([a, b], i) => (a <= t && t < b) || (t === b && i === W.length - 1));
function shotMix(shots, team) {
  const S = shots.filter(s => s.team === team); const rim = S.filter(s => s.rim), three = S.filter(s => s.three), other = S.filter(s => !s.rim && !s.three), mk = S.filter(s => s.made);
  const f = a => `${a.filter(s => s.made).length} of ${a.length}`;
  return { rim: f(rim), other: f(other), three: f(three), n: S.length, nr: rim.length, n3: three.length, ast: `${mk.filter(s => s.ast).length} of ${mk.length}` };
}
export function lineupOptions(A, live) {
  const agg = new Map(); for (const s of A.stints) { const a = agg.get(s.key) || { min: 0, pm: 0, W: [] }; a.min += (s.t1 - s.t0) / 60; a.pm += s.pm; a.W.push([s.t0, s.t1]); agg.set(s.key, a); }
  const order = [...agg.keys()].sort((a, b) => agg.get(b).min - agg.get(a).min).slice(0, 4);
  if (live && A.usNowKey && !order.includes(A.usNowKey)) { order.push(A.usNowKey); if (!agg.has(A.usNowKey)) agg.set(A.usNowKey, { min: 0, pm: 0, W: [] }); }
  return { agg, order };
}
export function shotsTab(A, S, view) {
  const live = S.state === 'live';
  const { agg, order } = A.lineupOk ? lineupOptions(A, live) : { agg: new Map(), order: [] };
  const sel = view.sel && agg.has(view.sel) ? view.sel : null;
  const W = sel ? agg.get(sel).W : null;
  const shots = A.shots.filter(s => (W ? inW(s.t, W) : true));
  let opts = `<li><button type="button" class="opt" data-sel="" aria-pressed="${!sel}"><span class="o1">Whole game</span><span class="pm z"></span><span class="o2">${A.shots.length} shots${live ? ' so far' : ''}</span></button></li>`;
  for (const k of order) {
    const a = agg.get(k); const n = A.shots.filter(s => inW(s.t, a.W)).length;
    opts += `<li><button type="button" class="opt" data-sel="${E(k)}" aria-pressed="${sel === k}"><span class="o1">${E(fiveLabel(A, k).join(', '))}${live && k === A.usNowKey ? '<span class="ontag">Now</span>' : ''}</span><span class="pm ${pmc(a.pm)}">${sgn(a.pm)}</span><span class="o2">${mmss(a.min)} together, ${n} shots</span></button></li>`;
  }
  const pick = `<aside class="pick" aria-labelledby="pk"><h2 id="pk">Show shots for</h2><ul>${opts}</ul><p class="hint">Tap any group in Who has been out there to see it here.</p></aside>`;
  const mid = sel ? `${fiveLabel(A, sel).join(', ')}: ${mmss(agg.get(sel).min)} together. A handful of shots, so read where, not makes.` : live ? 'Whole game so far' : 'Whole game';
  const nou = shots.filter(s => s.team === 'OU').length, nop = shots.length - nou;
  const offChart = shots.filter(s => !s.chart).length;
  const court = `<div class="courtwrap"><div class="cap"><span><b>Oklahoma shots</b> (${nou})</span><span class="mid">${E(mid)}</span><span><b>${E(S.oppShort)} shots</b> (${nop})</span></div>
${courtSVG(shots, S.oppShort, false)}${courtSVG(shots, S.oppShort, true)}${shotKey()}${offChart ? `<p class="src" style="text-align:center;margin-top:4px">${offChart} shot${offChart === 1 ? ' has' : 's have'} no location from ESPN and ${offChart === 1 ? 'is' : 'are'} counted below but not drawn.</p>` : ''}</div>`;
  const a = shotMix(shots, 'OU'), b = shotMix(shots, 'OPP');
  const mix = `<table class="tbl"><thead><tr><th scope="col"><span class="vh">Shot type</span></th><th scope="col">Oklahoma</th><th scope="col">${E(S.oppShort)}</th></tr></thead><tbody>
<tr><td>At the rim</td><td>${a.rim}</td><td>${b.rim}</td></tr><tr><td>Other twos</td><td>${a.other}</td><td>${b.other}</td></tr><tr><td>Threes</td><td>${a.three}</td><td>${b.three}</td></tr><tr><td>Makes that were assisted</td><td>${a.ast}</td><td>${b.ast}</td></tr></tbody></table>`;
  let mixSay;
  if (sel) mixSay = `With this group on the floor, ${a.n3} of Oklahoma’s ${a.n} shots were threes and ${a.nr} were at the rim.`;
  else {
    const ra = a.nr / Math.max(1, a.n), rb = b.nr / Math.max(1, b.n);
    mixSay = `${a.n3} of Oklahoma’s ${a.n} shots are threes, and ${a.nr} are at the rim.`;
    if (rb - ra >= 0.08) mixSay += ` ${S.oppShort} is getting to the rim more: ${b.nr} of ${b.n}.`; else if (ra - rb >= 0.08) mixSay += ` ${S.oppShort} gets there less: ${b.nr} of ${b.n}.`;
  }
  const cats = ['Off turnovers', 'Fast break', 'Second chance', 'Free throws'];
  let src;
  if (sel) { src = { OU: {}, OPP: {} }; for (const e of A.events) if (inW(e.t, W)) for (const tg of e.tags) src[e.team][tg] = (src[e.team][tg] || 0) + e.pts; }
  else src = A.srcGame;
  const g = (t, c) => src[t][c] || 0;
  const mx = Math.max(1, ...cats.flatMap(c => [g('OU', c), g('OPP', c)]));
  const rows = cats.map(c => { const u = g('OU', c), o = g('OPP', c); const bar = (v, col) => `<span class="mbar2" style="width:${(70 * v / mx).toFixed(0)}px;background:${col}"></span>`;
    return `<tr><td>${c}</td><td class="${u > o ? 'big' : ''}"><span class="duo">${bar(u, 'var(--crimson)')}${u}</span></td><td class="${o > u ? 'big' : ''}"><span class="duo">${bar(o, 'var(--minus)')}${o}</span></td></tr>`; }).join('');
  const gaps = cats.map(c => [g('OU', c) - g('OPP', c), c]).sort((p, q) => q[0] - p[0]);
  const [gap, gc] = gaps[0];
  const phr = { 'Off turnovers': 'points off turnovers', 'Fast break': 'fast-break points', 'Second chance': 'second-chance points', 'Free throws': 'points at the line' }[gc];
  const worst = gaps[gaps.length - 1];
  const phr2 = { 'Off turnovers': 'points off turnovers', 'Fast break': 'fast-break points', 'Second chance': 'second-chance points', 'Free throws': 'points at the line' }[worst[1]];
  const srcSay = gap >= 4 ? `<b>The biggest edge is ${phr}:</b> ${g('OU', gc)} to ${g('OPP', gc)}.` : worst[0] <= -4 ? `<b>${E(S.oppShort)}’s biggest edge is ${phr2}:</b> ${g('OPP', worst[1])} to ${g('OU', worst[1])}.` : sel ? 'Too few points with this group to see a pattern.' : 'No clear edge in where the points come from.';
  const offNote = !sel && !S.replay && (A.srcGame.OU['Off turnovers'] !== undefined) ? '' : '';
  const below = `<div class="below"><section><h3>Where the shots come from</h3><p class="say1">${E(mixSay)}</p>${mix}</section>
<section><h3>How the points are scored</h3><p class="say1">${srcSay}</p><table class="tbl"><thead><tr><th scope="col"><span class="vh">Source</span></th><th scope="col">Oklahoma</th><th scope="col">${E(S.oppShort)}</th></tr></thead><tbody>${rows}</tbody></table>${offNote}</section></div>`;
  return `<main class="shots">${pick}${court}</main>${below}`;
}

// ---------------------------------------------------------------- their key players
export function playersTab(A, S) {
  const top = A.impact.filter(o => o.gs >= 3).slice(0, 3);
  const head = `<div class="kp-h"><h2>Their most impactful players tonight</h2><p>Ranked by a box-score impact score, which misses some defense.</p></div>`;
  if (!top.length) return head + `<p class="empty">Nobody on ${E(S.oppShort)} has had a big enough game to single out yet.</p>`;
  const F = [['scoring', 'Scoring'], ['playmaking', 'Playmaking'], ['glass', 'On the glass'], ['defense', 'Defense']];
  const mx = Math.max(1, ...top.flatMap(o => F.map(([k]) => Math.abs(o[k]))));
  const WORD = { scoring: 'scoring', playmaking: 'setting up teammates', glass: 'rebounding', defense: 'defense' };
  const detail = (k, b) => {
    if (k === 'scoring') { let s = `${b.pts} pts on ${b.fgm} of ${b.fga}`; if (b.rima) s += `, ${b.rimm} of ${b.rima} at the rim`; if (b['3pa']) s += `, ${b['3pm']} of ${b['3pa']} from three`; if (b.fta) s += `, ${b.ftm} of ${b.fta} at the line`; return s; }
    if (k === 'playmaking') return `${pl(b.ast, 'assist')}, ${pl(b.tov, 'turnover')}`;
    if (k === 'glass') return `${b.orb} offensive, ${pl(b.drb, 'defensive rebound')}`;
    return `${pl(b.stl, 'steal')}, ${pl(b.blk, 'block')}, ${pl(b.pf, 'foul')}`;
  };
  const cols = top.map(o => {
    const b = o.box; const ranked = [...F].sort((p, q) => o[q[0]] - o[p[0]]);
    const good = ranked.filter(([k]) => o[k] >= 1.5).map(([k]) => WORD[k]).slice(0, 2);
    let how = good.length ? `Hurting you with ${good.join(' and ')}.` : 'A bit of everything.';
    if (o.playmaking <= -1.5) how += ` But ${pl(b.tov, 'turnover')}.`;
    const fac = F.map(([k, lab]) => { const v = o[k]; const w = 70 * Math.abs(v) / mx;
      const st = v >= 0 ? `left:30%;width:${w.toFixed(0)}%;background:var(--crimson)` : `left:${(30 - Math.min(30, w)).toFixed(0)}%;width:${Math.min(30, w).toFixed(0)}%;background:var(--minus)`;
      return `<div class="facet${k === ranked[0][0] ? ' top' : ''}"><span class="fl">${lab}</span><span class="fb" role="img" aria-label="${lab} ${v.toFixed(1)}"><i style="${st}"></i></span><span class="fd">${detail(k, b)}</span></div>`; }).join('');
    const fouls = A.fouls[o.pid] || 0;
    const fchip = fouls >= 4 ? `<span class="chip">${fouls} fouls</span>` : `<span>${pl(fouls, 'foul')}</span>`;
    const onf = S.state === 'live' ? (o.on ? 'On the floor now' : 'On the bench') : '';
    const mine = A.shots.filter(s => s.sid === o.pid);
    return `<article class="pc"><h3>${E(o.name)}</h3><p class="meta"><span>${Math.round(o.min)} min</span>${fchip}${onf ? `<span>${onf}</span>` : ''}</p><p class="how">${E(how)}</p>${fac}${miniCourtSVG(mine, o.name)}</article>`;
  }).join('');
  return head + `<main class="kp">${cols}</main><div class="kp-note">${shotKey()}</div>`;
}

// ---------------------------------------------------------------- spreadsheet
const SHEET_TABS = ['Instructions', 'Roster', 'Stint Log', 'Lineup Summary', 'Player On-Off', 'Game Summary'];
const fmt = (v, d = 1) => { if (v === null || v === undefined || v === '' || Number.isNaN(v)) return ''; const s = typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(d) : String(v); return s.startsWith('-') ? '−' + s.slice(1) : s; };
const numTd = (v, cls, d = 1) => `<td class="${cls} n">${typeof v === 'number' && v < 0 ? `<span class="neg">${fmt(v, d)}</span>` : fmt(v, d)}</td>`;
function rowCalc(r) {
  const u = r.u; const op = u.OU_poss, dp = u.Opp_poss; const { P3, SD } = CONFIG;
  const ortg = op ? 100 * u.OU_pts / op : null, drtg = dp ? 100 * u.Opp_pts / dp : null;
  const net = ortg != null && drtg != null ? ortg - drtg : null;
  const ci = op && dp ? 1.96 * SD * 100 * Math.sqrt(1 / op + 1 / dp) : null;
  const lnet = op && dp ? (u.OU_pts - 3 * (u.OU_fg3m - P3 * u.OU_fg3a)) / op * 100 - (u.Opp_pts - 3 * (u.Opp_fg3m - P3 * u.Opp_fg3a)) / dp * 100 : null;
  const pace = op && r.minutes ? (op + dp) / 2 / r.minutes * 40 : null;
  return { ortg, drtg, net, ci, lnet, pm: u.OU_pts - u.Opp_pts, pace };
}
export function sheetTab(A, S, view, SH) {
  // SH: { games:[{label, rows:[...] , current}], roster:[...], added:[...], spell(pid)->name }
  const scope = view.scope || 'game';
  const bar = `<div class="sheetbar"><div><h2>Your lineup tracker</h2><p>The workbook we sent, filling itself in. A new row starts at every substitution. The download keeps all your tabs and formulas.</p></div>
<div class="acts"><div class="scope" role="group" aria-label="What to include"><button type="button" data-scope="game" aria-pressed="${scope === 'game'}">This game</button><button type="button" data-scope="season" aria-pressed="${scope === 'season'}">Whole season</button></div>
<button class="btn" type="button" data-act="xlsx"${SH.ready ? '' : ' disabled'}>${SH.busy ? 'Preparing…' : 'Download for Excel'}</button><button class="btn ghost" type="button" data-act="csv">CSV</button><p class="opens">Opens in Excel or Google Sheets.</p></div></div>`;
  if (!A.lineupOk) return bar + `<p class="empty">The Stint Log can't be filled for this game: ESPN's substitutions don't add up to five players on the floor.</p>`;
  const tab = view.sheetTab || 'Stint Log';
  const games = scope === 'season' ? SH.games : SH.games.filter(g => g.current);
  let body = '';
  if (tab === 'Stint Log') {
    const cols = [['Half', 'in c', 1], ['Stint #', 'in c', 2], ['Start Clock', 'in c'], ['End Clock', 'in c'], ['Minutes', 'calc n'], ...(scope === 'season' ? [['Game', 'in l']] : []), ['P1', 'in l'], ['P2', 'in l'], ['P3', 'in l'], ['P4', 'in l'], ['P5', 'in l'],
      ['OU Pts', 'in n'], ['Opp Pts', 'in n'], ['Off Poss', 'in n'], ['Def Poss', 'in n'], ['ORtg', 'calc n'], ['DRtg', 'calc n'], ['Net Rtg', 'calc n'], ['+/- (95%)', 'calc n'], ['Luck-Adj Net', 'calc n'], ['+/-', 'calc n'], ['Pace', 'calc n'],
      ['OU FGA', 'in n'], ['OU OREB', 'in n'], ['OU TOV', 'in n'], ['OU FTA', 'in n'], ['Opp FGA', 'in n'], ['Opp OREB', 'in n'], ['Opp TOV', 'in n'], ['Opp FTA', 'in n'], ['OU 3PM', 'in n'], ['OU 3PA', 'in n'], ['Opp 3PM', 'in n'], ['Opp 3PA', 'in n'], ['OU Rim FGA', 'in n'], ['Opp Rim FGA', 'in n'], ['Notes', 'in l']];
    const th = `<th class="rn" scope="col"><span class="vh">Row</span></th>` + cols.map(([c, , fz]) => `<th scope="col"${fz ? ` class="fz${fz}"` : ''}>${E(c)}</th>`).join('');
    let rn = 2, trs = '';
    for (const gm of games) gm.rows.forEach((r, k) => {
      const c = rowCalc(r); const u = r.u; const open = gm.current && r.open && S.state === 'live';
      const names = SH.fiveNames(r.players);
      const v = { Half: r.half, 'Stint #': k + 1, 'Start Clock': r.start, 'End Clock': open ? '' : r.end, Minutes: r.minutes, Game: gm.label, P1: names[0], P2: names[1], P3: names[2], P4: names[3], P5: names[4],
        'OU Pts': u.OU_pts, 'Opp Pts': u.Opp_pts, 'Off Poss': u.OU_poss, 'Def Poss': u.Opp_poss, ORtg: c.ortg, DRtg: c.drtg, 'Net Rtg': c.net, '+/- (95%)': c.ci != null ? `±${Math.round(c.ci)}` : '', 'Luck-Adj Net': c.lnet, '+/-': c.pm, Pace: c.pace,
        'OU FGA': u.OU_fga, 'OU OREB': u.OU_oreb, 'OU TOV': u.OU_tov, 'OU FTA': u.OU_fta, 'Opp FGA': u.Opp_fga, 'Opp OREB': u.Opp_oreb, 'Opp TOV': u.Opp_tov, 'Opp FTA': u.Opp_fta,
        'OU 3PM': u.OU_fg3m, 'OU 3PA': u.OU_fg3a, 'Opp 3PM': u.Opp_fg3m, 'Opp 3PA': u.Opp_fg3a, 'OU Rim FGA': u.OU_rim_fga, 'Opp Rim FGA': u.Opp_rim_fga, Notes: r.flagged ? 'Check: after a repaired substitution' : 'Auto-filled from play-by-play' };
      const tds = cols.map(([col, cls, fz]) => { const val = v[col]; const fzc = fz ? ` fz${fz}` : '';
        if (cls.endsWith(' n') && typeof val === 'number') return numTd(val, cls.split(' ')[0] + fzc, col === 'Minutes' ? 1 : 1).replace('<td class="', `<td class="`);
        return `<td class="${cls}${fzc}">${E(val)}</td>`; }).join('');
      trs += `<tr class="${open ? 'onrow' : ''}${r.flagged ? ' flagged' : ''}"><td class="rn">${open ? 'Now' : rn}</td>${tds}</tr>`; rn++;
    });
    body = `<div class="grid" role="region" aria-label="Stint Log" tabindex="0" data-scroll="grid"><table class="xl"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
  } else body = `<div class="grid" role="region" aria-label="${E(tab)}" tabindex="0" data-scroll="grid">${sheetOther(tab, games, SH, A)}</div>`;
  const tabs = `<div class="sheettabs" role="tablist" aria-label="Workbook tabs">${SHEET_TABS.map(t => `<button type="button" role="tab" data-sheet="${E(t)}" aria-selected="${t === tab}">${E(t)}</button>`).join('')}</div>`;
  const legend = `<div class="legend"><span><i style="background:#FFF8E1"></i>Filled in from the play-by-play</span><span><i style="background:#EEF6E8"></i>Your formulas</span><span><i style="background:#FCEDED"></i>The group on the floor now, still counting</span></div>`;
  const notes = [];
  if (SH.added.length) notes.push(`<b>Added to the Roster tab in the download:</b> ${SH.added.map(a => `${E(a.name)} (#${E(a.jersey)})`).join(', ')}. They were not on the roster you have.`);
  if (scope === 'season' && SH.missing?.length) notes.push(`${SH.missing.length} earlier game${SH.missing.length === 1 ? '' : 's'} could not be read and ${SH.missing.length === 1 ? 'is' : 'are'} left out.`);
  if (SH.loading) notes.push('Loading earlier games for the whole season…');
  return bar + body + tabs + legend + (notes.length ? `<p class="sheetnote">${notes.join(' ')}</p>` : '');
}
function aggRows(rows, keyfn) {
  const m = new Map();
  for (const r of rows) for (const k of keyfn(r)) { const a = m.get(k) || { stints: 0, min: 0, op: 0, dp: 0, o: 0, d: 0, o3m: 0, o3a: 0, d3m: 0, d3a: 0, orim: 0, drim: 0, ofga: 0, dfga: 0 };
    const u = r.u; a.stints++; a.min += r.minutes; a.op += u.OU_poss; a.dp += u.Opp_poss; a.o += u.OU_pts; a.d += u.Opp_pts; a.o3m += u.OU_fg3m; a.o3a += u.OU_fg3a; a.d3m += u.Opp_fg3m; a.d3a += u.Opp_fg3a; a.orim += u.OU_rim_fga; a.drim += u.Opp_rim_fga; a.ofga += u.OU_fga; a.dfga += u.Opp_fga; m.set(k, a); }
  return m;
}
function rates(a) { const { P3, SD } = CONFIG; const ortg = a.op ? 100 * a.o / a.op : null, drtg = a.dp ? 100 * a.d / a.dp : null;
  return { ortg, drtg, net: ortg != null && drtg != null ? ortg - drtg : null, ci: a.op && a.dp ? 1.96 * SD * 100 * Math.sqrt(1 / a.op + 1 / a.dp) : null,
    lnet: a.op && a.dp ? (a.o - 3 * (a.o3m - P3 * a.o3a)) / a.op * 100 - (a.d - 3 * (a.d3m - P3 * a.d3a)) / a.dp * 100 : null }; }
const readOf = t => (t == null ? '' : t < 0.1 ? 'Mostly noise' : t < 0.25 ? 'Early read' : t < 0.5 ? 'Some signal' : 'Solid');
function sheetOther(tab, games, SH, A) {
  const rows = games.flatMap(g => g.rows);
  const tbl = (head, body) => `<table class="xl"><thead><tr><th class="rn" scope="col"><span class="vh">Row</span></th>${head.map(h => `<th scope="col">${E(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  if (tab === 'Instructions') return `<div class="instr"><p><b>Oklahoma Sooners in-game lineup tracker (v2, with WCE).</b></p><p>Roster: the player list with jersey numbers; every dropdown on the Stint Log reads from it.</p><p>Stint Log: one row per lineup stint, the five on the floor between substitutions. Yellow cells are inputs, green cells calculate. This page fills the yellow cells from ESPN's play-by-play, including exact possessions.</p><p>Lineup Summary and Player On-Off: every lineup and player, with Best Guess, the +/- range and how much to trust it.</p><p>Game Summary: team totals by game. Research &amp; Settings (in the download): what the numbers mean and the constants behind them.</p></div>`;
  if (tab === 'Roster') return tbl(['#', 'Player', 'Pos', 'Class'], SH.roster.map((r, i) => `<tr><td class="rn">${i + 2}</td><td class="in n">${E(r.jersey)}</td><td class="in l">${E(r.name)}</td><td class="in c">${E(r.pos || '')}</td><td class="in c">${E(r.cls || '')}</td></tr>`).join(''));
  const team = rates(aggRows(rows, () => ['T']).get('T') || { op: 0, dp: 0 });
  if (tab === 'Lineup Summary') {
    const m = aggRows(rows, r => [r.players.slice().sort().join('|')]);
    const body = [...m.entries()].sort((p, q) => q[1].min - p[1].min).map(([k, a], i) => { const r = rates(a); const n = (a.op + a.dp) / 2; const trust = n / (n + CONFIG.K_LINEUP); const best = r.lnet != null && team.lnet != null ? (r.lnet - team.lnet) * trust : null;
      return `<tr><td class="rn">${i + 5}</td><td class="calc l">${E(SH.fiveNames(k.split('|')).join(', '))}</td><td class="calc n">${a.stints}</td><td class="calc n">${fmt(a.min)}</td><td class="calc n">${a.o}</td><td class="calc n">${a.d}</td><td class="calc n">${a.op}</td><td class="calc n">${a.dp}</td>${numTd(r.net, 'calc')}<td class="calc n">${r.ci != null ? '±' + Math.round(r.ci) : ''}</td>${numTd(r.lnet, 'calc')}${numTd(best, 'calc')}<td class="calc n">${Math.round(trust * 100)}%</td><td class="calc l">${readOf(trust)}</td>${numTd(a.o - a.d, 'calc')}</tr>`; }).join('');
    return tbl(['Lineup', 'Stints', 'Minutes', 'OU Pts', 'Opp Pts', 'Off Poss', 'Def Poss', 'Net Rtg', '+/- (95%)', 'Luck-Adj Net', 'Best Guess (vs team)', 'Trust %', 'Read', '+/-'], body);
  }
  if (tab === 'Player On-Off') {
    const all = aggRows(rows, () => ['T']).get('T') || { op: 0, dp: 0, o: 0, d: 0, o3m: 0, o3a: 0, d3m: 0, d3a: 0, min: 0 };
    const m = aggRows(rows, r => r.players);
    const body = [...m.entries()].sort((p, q) => q[1].min - p[1].min).map(([pid, on], i) => {
      const off = {}; for (const k in all) off[k] = all[k] - (on[k] || 0);
      const a = rates(on), b = rates(off); const nOn = (on.op + on.dp) / 2, nOff = (off.op + off.dp) / 2; const neff = nOn && nOff ? nOn * nOff / (nOn + nOff) : 0; const trust = neff ? neff / (neff + CONFIG.K_PLAYER) : null;
      const onoff = a.net != null && b.net != null ? a.net - b.net : null; const lon = a.lnet != null && b.lnet != null ? a.lnet - b.lnet : null;
      return `<tr><td class="rn">${i + 5}</td><td class="calc l">${E(SH.fiveNames([pid])[0])}</td><td class="calc n">${fmt(on.min)}</td>${numTd(a.net, 'calc')}<td class="calc n">${fmt(off.min)}</td>${numTd(b.net, 'calc')}${numTd(onoff, 'calc')}${numTd(lon, 'calc')}${numTd(lon != null && trust != null ? lon * trust : null, 'calc')}<td class="calc n">${trust != null ? Math.round(trust * 100) + '%' : ''}</td><td class="calc l">${readOf(trust)}</td>${numTd(on.o - on.d, 'calc')}</tr>`; }).join('');
    return tbl(['Player', 'Min ON', 'Net ON', 'Min OFF', 'Net OFF', 'Net ON-OFF', 'Luck-Adj ON-OFF', 'Best Guess', 'Trust %', 'Read', '+/- ON'], body);
  }
  // Game Summary
  const body = games.map((g, i) => { const a = aggRows(g.rows, () => ['T']).get('T') || { stints: 0, min: 0, op: 0, dp: 0, o: 0, d: 0, o3m: 0, o3a: 0, d3m: 0, d3a: 0, orim: 0, drim: 0, ofga: 0, dfga: 0 }; const r = rates(a);
    const lineups = new Set(g.rows.map(x => x.players.slice().sort().join('|'))).size;
    return `<tr><td class="rn">${i + 2}</td><td class="calc l">${E(g.label)}</td><td class="calc l">${E(g.opp)}</td><td class="calc n">${a.stints}</td><td class="calc n">${fmt(a.min)}</td><td class="calc n">${a.o}</td><td class="calc n">${a.d}</td><td class="calc n">${a.op}</td><td class="calc n">${a.dp}</td>${numTd(r.ortg, 'calc')}${numTd(r.drtg, 'calc')}${numTd(r.net, 'calc')}${numTd(r.lnet, 'calc')}<td class="calc n">${pct(a.o3a ? 100 * a.o3m / a.o3a : null)}</td><td class="calc n">${pct(a.d3a ? 100 * a.d3m / a.d3a : null)}</td><td class="calc n">${pct(a.ofga ? 100 * a.orim / a.ofga : null)}</td><td class="calc n">${pct(a.dfga ? 100 * a.drim / a.dfga : null)}</td><td class="calc n">${a.min ? fmt((a.op + a.dp) / 2 / a.min * 40) : ''}</td><td class="calc n">${lineups}</td></tr>`; }).join('');
  return tbl(['Game', 'Opponent', 'Stints', 'Minutes logged', 'OU Pts', 'Opp Pts', 'Off Poss', 'Def Poss', 'ORtg', 'DRtg', 'Net Rtg', 'Luck-Adj Net', 'OU 3P%', 'Opp 3P%', 'OU Rim Share', 'Opp Rim Share', 'Pace', 'Lineups used'], body);
}

// ---------------------------------------------------------------- drawer: all the numbers
export function drawer(A, S, view) {
  const seg = view.seg || 'lineups'; const live = S.state === 'live';
  const segs = [['lineups', 'Lineups'], ['players', 'Players'], ['shooting', 'Shooting'], ['opp', S.oppShort]];
  let body = '';
  const barFor = best => { const w = Math.min(50, Math.abs(best) / 6 * 50); return `<span class="bar" aria-hidden="true"><i class="${best < 0 ? 'neg' : ''}" style="${best >= 0 ? 'left:50%' : `left:${(50 - w).toFixed(0)}%`};width:${w.toFixed(0)}%"></i></span>`; };
  if (seg === 'lineups') {
    if (!A.lineupOk) body = `<p class="intro">Lineups are hidden for this game because ESPN's substitutions don't add up.</p>`;
    else {
      const agg = new Map(); for (const s of A.stints) agg.set(s.key, (agg.get(s.key) || 0) + (s.t1 - s.t0) / 60);
      const U = new Map(A.units.map(u => [u.key, u]));
      const rows = [...agg.keys()].sort((a, b) => agg.get(b) - agg.get(a)).map(k => {
        const u = U.get(k); const t = u?.tonight; const isnow = live && k === A.usNowKey;
        const pm = t ? t.pm : 0; const adj = t ? t.pm - t.pm_opp3_luck - t.pm_own3_luck : 0;
        const best = u && u.trust >= 0.05 && u.best != null ? `${sgn(u.best, 1)}${barFor(u.best)}` : '<span class="early">Too early</span>';
        return `<tr class="${isnow ? 'isnow' : ''}"><td class="g">${E(fiveLabel(A, k).join(', '))}${isnow ? '<span class="ontag">Now</span>' : ''}</td><td>${mmss(agg.get(k))}</td><td class="${pm > 0 ? 'p' : ''}">${sgn(pm)}</td><td>${t ? sgn(adj) : '—'}</td><td>${best}</td></tr>`;
      }).join('');
      body = `<h3>Every Oklahoma five tonight</h3><p class="intro">Season best guess is how much better or worse than Oklahoma’s average we expect a group to be, per 100 possessions. It needs a few hundred possessions together before it says much, so early in the season every group reads too early.</p>
<table class="dt"><thead><tr><th scope="col">Group</th><th scope="col">Min</th><th scope="col">+/−</th><th scope="col">Without shooting luck</th><th scope="col">Season best guess</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  } else if (seg === 'players') {
    const rows = A.ouPlayers.map(r => { const oo = A.onoff[r.pid] || {}; const b = r.box || {}; const best = oo.best != null && oo.trust >= 0.05 ? `${sgn(oo.best, 1)}${barFor(oo.best)}` : '<span class="early">Too early</span>';
      return `<tr class="${live && r.on ? 'isnow' : ''}"><td class="g">${E(r.name)}</td><td>${Math.round(r.min)}</td><td>${b.pts || 0}</td><td>${r.fouls}</td><td class="${(oo.tonightPm || 0) > 0 ? 'p' : ''}">${sgn(oo.tonightPm || 0)}</td><td>${best}</td></tr>`; }).join('');
    body = `<h3>Oklahoma players tonight</h3><p class="intro">+/− is the score while he was on the floor tonight. Season best guess compares the team with him on and off the floor, discounted heavily until there are thousands of possessions.</p>
<table class="dt"><thead><tr><th scope="col">Player</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Fouls</th><th scope="col">+/−</th><th scope="col">Season best guess</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else if (seg === 'shooting') {
    const T = A.T, P = A.P;
    const f3 = (m) => (m ? `${m[0]}–${m[1]} <span style="color:var(--muted)">(${m[1] ? Math.round(100 * m[0] / m[1]) : 0}%)</span>` : '—');
    const sh = [['Your threes', f3(T?.own3), f3(P?.own3)], [`${E(S.oppShort)} threes`, f3(T?.opp3), f3(P?.opp3)], ['Share of your shots that are threes', pct(T?.tpa), pct(P?.tpa)], ['Share of your shots at the rim', pct(T?.rim), pct(P?.rim)],
      ['Share of their shots at the rim', pct(T?.rim_allowed), pct(P?.rim_allowed)], ['Turnovers forced per 100 possessions', T ? Math.round(T.tov_forced) : '—', P ? Math.round(P.tov_forced) : '—']];
    body = `<h3>Shooting and shot mix</h3><p class="intro">Three-point percentages swing a lot in one game. Shot mix tells you more about how a game is being played.${P ? '' : ' This is the first game we have, so there is no “before tonight” yet.'}</p>
<table class="dt"><thead><tr><th scope="col"><span class="vh">Measure</span></th><th scope="col">Tonight</th><th scope="col">Before tonight</th></tr></thead><tbody>${sh.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}</tbody></table>`;
  } else {
    const imp = new Map(A.impact.map(o => [o.pid, o]));
    const rows = A.oppPlayers.map(r => { const b = r.box || {}; const o = imp.get(r.pid);
      return `<tr class="${live && r.on ? 'isnow' : ''}"><td class="g">${E(r.name)}</td><td>${Math.round(r.min)}</td><td>${b.pts || 0}</td><td>${(b.orb || 0) + (b.drb || 0)}</td><td>${b.ast || 0}</td><td>${r.fouls}</td><td>${o ? o.gs.toFixed(1) : '0.0'}</td></tr>`; }).join('');
    body = `<h3>${E(S.oppFull)} tonight</h3><p class="intro">Impact is the box-score score used on Their key players: scoring, playmaking, rebounding and defense added up.</p>
<table class="dt"><thead><tr><th scope="col">Player</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Reb</th><th scope="col">Ast</th><th scope="col">Fouls</th><th scope="col">Impact</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `<div class="scrim" data-act="drawer-close"></div><aside class="drawer" id="numbers" role="dialog" aria-modal="true" aria-labelledby="dt">
<div class="dh"><h2 id="dt">All the numbers</h2><button class="x" type="button" data-act="drawer-close">Close</button></div>
<div class="seg" role="tablist" aria-label="Numbers">${segs.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}" aria-selected="${seg === k}">${E(l)}</button>`).join('')}</div>
<div class="db" data-scroll="drawer">${body}</div>
<div class="df"><button class="btn ghost" type="button" data-act="csv">Download for your tracker (CSV)</button><span class="src">Matches the Stint Log tab</span></div></aside>`;
}

export function preGame(S) {
  return `<main class="pre"><h1>Oklahoma vs ${E(S.oppFull)}</h1><p>${E(S.when || '')}${S.tip ? `, tip-off ${E(S.tip)}` : ''}.</p><p>This page goes live at tip-off and refreshes itself every 15 seconds. Leave it open.</p>${S.lastFinal ? `<p><a href="?game=${E(S.lastFinal.id)}">See the last game against ${E(S.lastFinal.opp)}</a>, or <a href="?replay=${E(S.lastFinal.id)}&amp;speed=10">replay it at 10x</a>.</p>` : ''}</main>`;
}
export { summarize, emptyCounter, addCounter, fmtClock };
