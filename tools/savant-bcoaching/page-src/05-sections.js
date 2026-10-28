
// ---------------------------------------------------------------- game management
function ci(n){ if (!n) return ''; const se = 1.1 / Math.sqrt(n); return ` ±${(1.96 * se).toFixed(2)}`; }
function renderManagement(sr){
  const c = COACH, S = sr ? [sr].filter(s => s.management) : c.seasons.filter(s => s.management);
  if (!S.length) return `<div class="col wide"><div class="empty">${sr ? `no play-by-play for ${sr.season}` : 'no play-by-play seasons for him'}</div></div>`;
  const cs = cardRows(sr);
  const tile = (key, extra) => { const s = STATS[key], v = cs[key]; if (!s) return ''; return `<div class="tile"${tipAttr(statTip(key, v ? {v: v.v, pct: v.pct, pool: v.pool, n: v.n, seasons: v.seasons, season: sr?.season} : {}))}><div class="tl">${esc(s.label)}</div><div class="tv">${v ? fmt(s.unit, v.v) : '—'}<span style="font-size:12px;color:var(--faint)">${extra || ''}</span>${v && !miss(v.pct) ? `<span class="pb" style="background:${s.kind === 'good' ? gradeColor(v.pct) : '#C2A263'}">${v.pct}</span>` : ''}</div><div class="ts">${v && !miss(v.pct) ? `${ord(v.pct)} pct of ${v.pool}` : v ? 'not ranked' : 'no value'}${v && v.n < s.thr ? ' · small sample' : ''}</div></div>`; };
  const ch = S.reduce((a, s) => { const x = s.management.challenges || {}; for (const k in x) a[k] = (a[k] || 0) + x[k]; return a; }, {});
  const runs = S.reduce((a, s) => { for (const [k, r] of Object.entries(s.management.runs || {})) { a[k] = a[k] || {to:[0,0], no:[0,0], lg:[0,0]}; if (r.to_ppp != null) { a[k].to[0] += r.to_ppp * r.to_n; a[k].to[1] += r.to_n; } if (r.no_ppp != null) { a[k].no[0] += r.no_ppp * r.no_n; a[k].no[1] += r.no_n; } const lg = IDX.league[s.season]?.runs?.[k]; if (lg != null && r.to_n) { a[k].lg[0] += lg * r.to_n; a[k].lg[1] += r.to_n; } } return a; }, {});
  const runRows = Object.entries(runs).map(([k, r]) => `<tr${tipAttr(`<b>Opponent run of ${k.replace('-', '–').replace(/–$/, '+')}</b><br>after his timeout: ${r.to[1] ? (r.to[0] / r.to[1]).toFixed(2) + ' points per possession over the next five, ' + r.to[1] + ' runs' : '—'}<br>when he let it ride: ${r.no[1] ? (r.no[0] / r.no[1]).toFixed(2) + ', ' + r.no[1] + ' runs' : '—'}<br>league, no timeout: ${r.lg[1] ? (r.lg[0] / r.lg[1]).toFixed(2) : '—'}`)}><td>Opponent run of ${k.replace('-', '–').replace(/–$/, '+')}</td><td>${r.to[1] ? (r.to[0] / r.to[1]).toFixed(2) + ci(r.to[1]) : '—'}</td><td>${r.to[1]}</td><td>${r.no[1] ? (r.no[0] / r.no[1]).toFixed(2) : '—'}</td><td>${r.no[1]}</td><td>${r.lg[1] ? (r.lg[0] / r.lg[1]).toFixed(2) : '—'}</td></tr>`).join('');
  return `<div class="col wide"><h3 class="sub">Timeouts, challenges and halftime</h3><p class="since">2002-03 on · challenges 2019-20 on · ${sr ? sr.season : 'career'}</p>
    <div class="grid2" style="margin-top:14px"><div><h3 class="lead-h">Do his timeouts stop runs?</h3><p class="lead-p">opponent points per possession over the next five possessions</p><div class="scroll"><table class="t"><thead><tr><th></th><th>after his timeout</th><th>n</th><th>no timeout, his games</th><th>n</th><th>league, no timeout</th></tr></thead><tbody>${runRows || '<tr><td colspan="6" class="empty">no runs</td></tr>'}</tbody></table></div><div class="small">Runs cool off on their own; the comparison is the league's figure for runs of the same size with no timeout called, weighted by his timeouts. Intervals are ±1.96 standard errors at 1.1 points of spread per possession.</div></div>
    <div><h3 class="lead-h">Challenges</h3><p class="lead-p">2019-20 on</p>${ch.n ? `<div class="small">${ch.n} challenges: ${ch.overturned || 0} overturned, ${ch.supported || 0} upheld, ${ch.stands || 0} stood${ch.unknown ? `, ${ch.unknown} without a logged result` : ''}; ${ch.q4 || 0} in the fourth or overtime; ${ch.to_lost || 0} cost a timeout.</div>` : '<div class="empty">none in his seasons</div>'}
    <h3 class="lead-h" style="margin-top:12px">Halftime: does his team come out better?</h3><p class="lead-p">third-quarter net minus first-half net, per season; the tick is the league's typical change</p>${S.map(s => { const v = s.management.halftime || 0, lg = IDX.league[s.season]?.halftime || 0; return `<div class="srl"${tipAttr(`<b>${s.season} ${s.team}</b><br>third quarter net minus first-half net: <b>${signed(v)}</b><br><span class="k">league that season: ${signed(lg)}</span>`)}><span>${s.season} ${s.team}</span><span class="sb"><i style="left:${v >= 0 ? 50 : 50 - Math.min(50, Math.abs(v) * 3)}%;width:${Math.min(50, Math.abs(v) * 3)}%;background:${v >= 0 ? '#BC3A2C' : '#1C4E86'}"></i><b style="left:${50 + Math.max(-50, Math.min(50, 3 * lg))}%"></b></span><span class="sn">${signed(s.management.halftime)}</span></div>`; }).join('')}</div></div></div>`;
}

// ---------------------------------------------------------------- context splits
const SPLIT_LABELS = {opp_tier:'opponent as of that night', opp_final:'opponent by season end', opp_playoff:'playoff teams', home:'home and away', rest:'rest', rest_adv:'rest advantage', three_in_four:'3 in 4 nights', trip:'road trip game', travel:'miles travelled', tz:'time zones crossed', altitude:'altitude', missing:'regulars missing (impact)', starters:'starting five', half:'at the half', market:'the market', phase:'season phase', ot:'overtime'};
const ORDER = {opp_tier:['top10','middle','bottom10'], rest:['b2b','1 day','2 days','3+ days'], trip:['1','2','3+'], travel:['0','<500','500-1500','1500+'], tz:['0','1','2+'], missing:['none','<5','5+'], phase:['first10','pre_asb','post_asb','last10'], half:['leading','tied','trailing'], market:['favoured','pick','underdog']};
function renderSplits(sr){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.splits && s.g >= 20);
  if (!S.length) return sr ? `<div class="col wide"><div class="empty">${sr.season}: under 20 games, so no splits yet</div></div>` : '';
  const agg = {};
  for (const s of S) for (const [split, buckets] of Object.entries(s.splits)) {
    if (!buckets || typeof buckets !== 'object' || ['tempo','market_n','wp','officials','fouls'].includes(split)) continue;
    for (const [b, v] of Object.entries(buckets)) {
      if (!v || v.net == null || s.net == null) continue;
      const a = (agg[split] = agg[split] || {}); const x = (a[b] = a[b] || {g:0, w:0, gap:0, lg:0});
      x.g += v.g; x.w += v.w; x.gap += (v.net - s.net) * v.g; const lg = IDX.league[s.season]?.split_gaps?.[split]?.[b]; if (lg != null) x.lg += lg * v.g;
    }
  }
  const panels = Object.entries(agg).map(([split, buckets]) => {
    const order = ORDER[split] || Object.keys(buckets).sort();
    const rows = order.filter(b => buckets[b]).map(b => { const x = buckets[b]; const gap = x.gap / x.g, lg = x.lg / x.g; return `<div class="srl"${tipAttr(`<b>${esc(SPLIT_LABELS[split] || split)}: ${esc(b)}</b><br>${x.w}–${x.g - x.w} in ${x.g} games<br>net <b>${signed(gap)}</b> against his own season's net<br><span class="k">the league's typical gap in this bucket: ${signed(lg)}</span>`)}><span>${esc(b)} <small style="color:var(--faint)">${x.g}</small></span><span class="sb"><i style="left:${gap >= 0 ? 50 : 50 - Math.min(50, Math.abs(gap) * 2.5)}%;width:${Math.min(50, Math.abs(gap) * 2.5)}%;background:${gap >= 0 ? '#BC3A2C' : '#1C4E86'}"></i><b style="left:${50 + Math.max(-50, Math.min(50, lg * 2.5))}%"></b></span><span class="sn">${signed(gap)}</span></div>`; }).join('');
    return `<div class="split"><h4>${SPLIT_LABELS[split] || split}</h4>${rows}</div>`;
  }).join('');
  const tc = S.filter(s => s.splits.tempo?.toward_own != null);
  const tempo = tc.length ? tc.reduce((a, s) => a + s.splits.tempo.toward_own * s.splits.tempo.n, 0) / tc.reduce((a, s) => a + s.splits.tempo.n, 0) : null;
  const wp = S.reduce((a, s) => { const w = s.splits.wp || {}; a.g += w.games || 0; a.cb += w.comebacks || 0; a.bl += w.blown || 0; a.cb10 += w.comeback10 || 0; a.bl10 += w.blown10 || 0; return a; }, {g:0,cb:0,bl:0,cb10:0,bl10:0});
  const offs = {}; for (const s of S) for (const [o, g, w, f] of s.splits.officials || []) { const x = offs[o] = offs[o] || [0,0,0]; x[0] += g; x[1] += w; x[2] += f * g; }
  const topo = Object.entries(offs).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8).map(([o, [g, w, f]]) => `<tr><td>${esc(o)}</td><td>${g}</td><td>${w}–${g - w}</td><td>${(f / g).toFixed(1)}</td></tr>`).join('');
  return `<div class="col wide"><h3 class="sub">Every situation, bucket by bucket</h3><p class="since">1996-97 on; play-by-play splits 2002-03 on; the market 2015-16 on · each bar is his net rating in that bucket minus his net that season${sr ? '' : ', games-weighted over his career'}; the tick is the league's typical gap · hover a bar</p>
    <div class="splits">${panels}</div>
    <div class="grid3" style="margin-top:14px"><div class="tile"${tipAttr('<b>Tempo control</b><br>where each game\'s pace sat between his usual pace (100) and the opponent\'s (0), averaged; above 50 means games were played at his speed')}><div class="tl">Tempo control</div><div class="tv">${miss(tempo) ? '—' : (100 * tempo).toFixed(0) + '%'}</div><div class="ts">where the game's pace sat between his usual pace (100) and the opponent's (0)</div></div>
    <div class="tile"${tipAttr(`<b>Comebacks and blown leads</b><br>won from 10 down: ${wp.cb10} · lost from 10 up: ${wp.bl10}${wp.g ? `<br>by ESPN win probability (${wp.g} games): ${wp.cb} wins from under 10%, ${wp.bl} losses from over 90%` : ''}`)}><div class="tl">Comebacks and blown leads</div><div class="tv">${wp.cb10} / ${wp.bl10}</div><div class="ts">won from 10 down / lost from 10 up${wp.g ? `; by win probability (${wp.g} games): ${wp.cb} from under 10%, ${wp.bl} from over 90%` : ''}</div></div>
    <div><h4 style="margin:0 0 4px;font-family:var(--mono);font-size:10.5px;color:var(--faint);text-transform:uppercase">officials he has seen most</h4><div class="scroll"><table class="t"><thead><tr><th>crew member</th><th>g</th><th>record</th><th>fouls called</th></tr></thead><tbody>${topo || '<tr><td class="empty">—</td></tr>'}</tbody></table></div></div></div></div>`;
}

// ---------------------------------------------------------------- shot diet and play types
function court(diet, lgDiet, title){
  const W = 300, H = 290, sx = W / 50, hoop = {x: W / 2, y: 40};
  const shade = (k) => { const v = diet?.[k]?.[0], l = lgDiet?.[k]; if (v == null) return '#ECEBE8'; const d = l != null ? (v - l) / Math.max(0.02, l) : 0; return d >= 0 ? mix('#F7F6F2', '#C2A263', Math.min(1, d)) : mix('#F7F6F2', '#1C4E86', Math.min(1, -d)); };
  const tipOf = k => { const v = diet?.[k]?.[0], l = lgDiet?.[k], fg = diet?.[k]?.[1]; return tipAttr(`<b>${ZL[k]}</b><br>${v == null ? 'no shots' : `<b>${(100 * v).toFixed(1)}%</b> of attempts${l == null ? '' : `, league ${(100 * l).toFixed(1)}%`}${fg == null ? '' : `<br>${(100 * fg).toFixed(1)}% made`}`}`); };
  const txt = (k, x, y) => { const v = diet?.[k]?.[0], l = lgDiet?.[k], fg = diet?.[k]?.[1]; return `<text x="${x}" y="${y}" font-size="10" text-anchor="middle" fill="#1A2332">${v == null ? '—' : (100 * v).toFixed(0) + '%'}</text><text x="${x}" y="${y + 11}" font-size="8.5" text-anchor="middle" fill="#8A95A3">${l == null ? '' : 'lg ' + (100 * l).toFixed(0) + '%'}${fg == null ? '' : ' · ' + (100 * fg).toFixed(0) + ' FG%'}</text>`; };
  const r3 = 23.75 * sx, ra = 4 * sx;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:320px">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${shade('ab3')}"${tipOf('ab3')}/>
    <rect x="0" y="0" width="${3 * sx}" height="${14 * sx}" fill="${shade('c3')}"${tipOf('c3')}/><rect x="${W - 3 * sx}" y="0" width="${3 * sx}" height="${14 * sx}" fill="${shade('c3')}"${tipOf('c3')}/>
    <path d="M${3 * sx},${14 * sx} A${r3},${r3} 0 0 0 ${W - 3 * sx},${14 * sx} L${W - 3 * sx},0 L${3 * sx},0 Z" fill="${shade('mid')}"${tipOf('mid')}/>
    <rect x="${W/2 - 8 * sx}" y="0" width="${16 * sx}" height="${19 * sx}" fill="${shade('paint')}"${tipOf('paint')}/>
    <circle cx="${hoop.x}" cy="${hoop.y}" r="${ra}" fill="${shade('ra')}"${tipOf('ra')}/>
    <path d="M${3 * sx},${14 * sx} A${r3},${r3} 0 0 0 ${W - 3 * sx},${14 * sx}" fill="none" stroke="#22395A" stroke-width="1.5" pointer-events="none"/><line x1="${3 * sx}" y1="0" x2="${3 * sx}" y2="${14 * sx}" stroke="#22395A" stroke-width="1.5"/><line x1="${W - 3 * sx}" y1="0" x2="${W - 3 * sx}" y2="${14 * sx}" stroke="#22395A" stroke-width="1.5"/>
    <rect x="${W/2 - 8 * sx}" y="0" width="${16 * sx}" height="${19 * sx}" fill="none" stroke="#22395A" stroke-width="1.5" pointer-events="none"/><circle cx="${hoop.x}" cy="${hoop.y}" r="${ra}" fill="none" stroke="#22395A" pointer-events="none"/><circle cx="${hoop.x}" cy="${hoop.y}" r="4" fill="none" stroke="#BC3A2C" pointer-events="none"/>
    <g pointer-events="none">${txt('ra', hoop.x, hoop.y + 32)}${txt('paint', hoop.x, 19 * sx - 18)}${txt('mid', hoop.x, 19 * sx + 42)}${txt('c3', 1.5 * sx + 14, 14 * sx + 28)}${txt('ab3', hoop.x, H - 26)}</g>
    <text x="${W/2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#5B6878">${title}</text></svg>`;
}
function renderDiet(sr, only){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.identity?.diet);
  if (!S.length) return '';
  const wavg = (pick) => { const acc = {}; for (const s of S) for (const z of Z) { const v = pick(s)?.[z]; if (!v || v[0] == null) continue; const a = acc[z] = acc[z] || [0,0,0,0]; a[0] += v[0] * s.g; a[1] += s.g; if (v[1] != null) { a[2] += v[1] * v[0] * s.g; a[3] += v[0] * s.g; } } return Object.fromEntries(Object.entries(acc).map(([z, a]) => [z, [a[0] / a[1], a[3] ? a[2] / a[3] : null]])); };
  const lgavg = (key) => { const acc = {}; for (const s of S) for (const z of Z) { const v = IDX.league[s.season]?.[key]?.[z]; if (v == null) continue; const a = acc[z] = acc[z] || [0,0]; a[0] += v * s.g; a[1] += s.g; } return Object.fromEntries(Object.entries(acc).map(([z, a]) => [z, a[0] / a[1]])); };
  const mine = `<div>${court(wavg(s => s.identity.diet), lgavg('diet'), 'his teams\' shots')}</div>`, theirs = `<div>${court(wavg(s => s.identity.o_diet), lgavg('o_diet'), 'what opponents got')}</div>`;
  return `<div class="col wide"><h3 class="sub">${only === 'd' ? 'What he takes away' : only === 'o' ? 'What he hunts' : 'What he hunts, and what he takes away'}</h3><p class="since">shot zones 2002-03 on · share of field-goal attempts by zone, ${sr ? sr.season : 'his career (games-weighted)'} against the league of the same season${sr ? '' : 's'}; gold more than the league, blue less · hover a zone</p>
    <div class="grid2">${only === 'd' ? theirs : only === 'o' ? mine : mine + theirs}</div></div>`;
}
function renderPlayTypes(sr, only){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.nba?.synergy);
  if (!S.length) return '';
  const side = (k, title) => {
    const acc = {};
    for (const s of S) for (const [pt, v] of Object.entries(s.nba.synergy[k] || {})) { const a = acc[pt] = acc[pt] || [0,0,0,0,0]; a[0] += v[0] * s.g; a[1] += s.g; a[2] += v[1] * v[2]; a[3] += v[2]; const lg = IDX.league[s.season]?.synergy?.[k]?.[pt]; if (lg) { a[4] += lg[0] * s.g; } }
    const rows = Object.entries(acc).map(([pt, a]) => ({pt, freq: a[0] / a[1], ppp: a[3] ? a[2] / a[3] : null, lg: a[4] / a[1]})).sort((x, y) => y.freq - x.freq);
    return `<div><h3 class="lead-h">${title}</h3><p class="lead-p">frequency vs the league (bar), points per possession (number)</p>${rows.map(r => { const d = r.freq - r.lg; return `<div class="srl"${tipAttr(`<b>${PT[r.pt] || r.pt}</b> (${k === 'o' ? 'offense' : 'defense, allowed'})<br><b>${r.freq.toFixed(1)}%</b> of possessions, league ${r.lg.toFixed(1)}%<br>${r.ppp == null ? '' : `${r.ppp.toFixed(2)} points per possession`}`)}><span>${PT[r.pt] || r.pt}</span><span class="sb"><i style="left:${d >= 0 ? 50 : 50 - Math.min(50, Math.abs(d) * 6)}%;width:${Math.min(50, Math.abs(d) * 6)}%;background:${d >= 0 ? '#C2A263' : '#8A95A3'}"></i><b style="left:50%"></b></span><span class="sn">${r.ppp == null ? '—' : r.ppp.toFixed(2)}</span></div>`; }).join('')}</div>`;
  };
  const body = only === 'o' ? side('o', 'By play type') : only === 'd' ? side('d', 'By play type, allowed') : `<div class="grid2">${side('o', 'Offense')}${side('d', 'Defense (allowed)')}</div>`;
  return `<div class="col wide"><p class="since">play types 2015-16 on · Synergy, team tables; a season with two coaches shares the team's table · hover a row</p>${body}</div>`;
}

// ---------------------------------------------------------------- fingerprint, comps, arrival, development
// Every metric on one scale: its percentile among that season's 30 teams (lower-is-better flipped),
// so the distance between the dots is how big the change was.
function renderArrival(){
  const ar = COACH.arrivals || [];
  if (!ar.length) return '';
  const keys = ['net','winpct','pace','fg3r','rim','mid','ast_pct','orb_pct','depth10','stability','to_g','o_fg3r','o_tov'];
  const blocks = ar.map(a => {
    const ks = keys.filter(k => a.rows[k] && a.rows[k].p && a.rows[k].p[1] != null);
    const W = CW(760), L = W < 600 ? 128 : 190, R = 16, H = 44 + 22 * ks.length;
    const x = p => L + (W - L - R) * p / 100;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
    for (const g of [0, 25, 50, 75, 100]) svg += `<line x1="${x(g)}" x2="${x(g)}" y1="14" y2="${H - 24}" stroke="${g === 50 ? '#C4C0B6' : '#E4E1D9'}"/><text x="${x(g)}" y="${H - 10}" font-size="9" text-anchor="${g === 0 ? 'start' : g === 100 ? 'end' : 'middle'}" fill="#8A95A3">${g === 0 ? (W < 600 ? 'worst' : 'worst in the league') : g === 100 ? 'best' : g + 'th'}</text>`;
    ks.forEach((k, i) => {
      const {v, p} = a.rows[k], s = STATS[k], y = 26 + 22 * i, u = s?.unit || 'num1';
      const lab = `${esc(s?.label || k)}${s?.lower ? ' ↓' : ''}`;
      svg += `<text x="${L - 10}" y="${y + 4}" font-size="${W < 600 ? 10 : 11}" text-anchor="end" fill="#1A2332" font-family="IBM Plex Sans"${tipAttr(statTip(k))}>${lab}</text>`;
      if (p[0] != null) svg += `<line x1="${x(p[0])}" y1="${y}" x2="${x(p[1])}" y2="${y}" stroke="#C4C0B6" stroke-width="2"/>`;
      if (p[2] != null) svg += `<line x1="${x(p[1])}" y1="${y}" x2="${x(p[2])}" y2="${y}" stroke="#C4C0B6" stroke-width="2" stroke-dasharray="3 3"/>`;
      const dot = (j, col, r, label, season) => p[j] == null ? '' : `<circle class="hit" cx="${x(p[j])}" cy="${y}" r="${r}" fill="${col}"${tipAttr(`<b>${esc(s?.label || k)}, ${label}</b> (${season} ${esc(teamName(a.team))})<br><b>${fmt(u, v[j])}</b> · ${ord(p[j])} percentile of that season's teams${s?.lower ? ' (lower is better, so flipped)' : ''}`)}></circle>`;
      svg += dot(0, '#8A95A3', 4.5, 'the season before him', a.before_season) + dot(2, '#BC3A2C', 4.5, 'the season after he left', a.after_season) + dot(1, '#22395A', 5.5, 'his first season', a.first_season);
    });
    svg += '</svg>';
    return `<h3 class="sub">${esc(teamName(a.team))}, ${a.first_season}${a.last_season && a.last_season !== a.first_season ? ` to ${a.last_season}` : ''}</h3><p class="since">${a.before_season ? `${a.before_season} before him → ` : 'no season before him in the data → '}${a.first_season} his first → ${a.after_season ? `${a.after_season} after he left` : 'still there, or no season after yet'}</p>${svg}`;
  }).join('');
  return `<div class="col wide"><h2 class="col-h">What changed when he arrived, and after he left</h2><p class="since">team-season figures, whoever coached, each as a percentile among that season's teams · the gap between dots is the size of the change · hover a dot for the value</p>${blocks}
    <div class="legend2"><span><span class="sw" style="background:#8A95A3;border-radius:50%"></span>the season before him</span><span><span class="sw" style="background:#22395A;border-radius:50%"></span>his first season</span><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>the season after he left</span><span>↓ lower is better, already flipped</span><span>a new roster moves numbers too; the returning-minutes share is in each season's row</span></div></div>`;
}
function renderDevelopment(sr){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.development?.players?.length);
  if (!S.length) return sr ? '' : '';
  const cs = COACH.career.stats;
  const rows = S.flatMap(s => s.development.players.map(p => [s.season, ...p])).sort((a, b) => (b[4] - b[3] - b[5]) - (a[4] - a[3] - a[5]));
  const top = rows.slice(0, 10), bottom = rows.length > 16 ? rows.slice(-6) : [];
  const all = [...top, ...bottom]; const W = CW(760), L = W < 600 ? 130 : 200, H = 24 + 20 * (all.length + 1);
  const lo = Math.min(...all.map(r => Math.min(r[5], r[4] - r[3]))) - .5, hi = Math.max(...all.map(r => Math.max(r[5], r[4] - r[3]))) + .5;
  const x = v => L + (W - L - 20) * (v - lo) / (hi - lo);
  const nm = pid => COACH.player_names?.[String(pid)] || (() => { for (const k in TCACHE) { const n = TCACHE[k].names?.[String(pid)]; if (n) return n; } return String(pid); })();
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${H - 10}" stroke="#D9D6CF"/>`;
  let i = 0;
  for (const r of all) { if (i === top.length) i++; const y = 18 + 20 * i++; const act = r[4] - r[3]; const name = nm(r[1]);
    const tip = `<b>${playerLink(r[1], name)}</b>, ${r[0]}, age ${r[2] ?? '—'}<br>BPM percentile ${r[3]} → ${r[4]} (<b>${signed(act)}</b>) over ${Math.round(r[6]).toLocaleString()} minutes<br>the aging curve expected ${signed(r[5], 2)} at his age<br><span class="k">${act >= r[5] ? 'beat the curve by' : 'fell short by'} ${Math.abs(act - r[5]).toFixed(1)} points</span>`;
    svg += svgPlayer(r[1], L - 10, y + 4, W < 600 ? last(name) : name, 'font-size="11" text-anchor="end" fill="#1A2332" font-family="IBM Plex Sans"') + `<text x="${L - 10}" y="${y + 4}" font-size="9" fill="#8A95A3" text-anchor="end" dx="${-(String(W < 600 ? last(name) : name).length * 6.4)}">${r[0].slice(2)}</text><g class="hit"${tipAttr(tip)}><line x1="${x(r[5])}" x2="${x(act)}" y1="${y}" y2="${y}" stroke="#C4C0B6" stroke-width="2"/><circle cx="${x(r[5])}" cy="${y}" r="4" fill="#C2A263"></circle><circle cx="${x(act)}" cy="${y}" r="5" fill="${act >= r[5] ? '#BC3A2C' : '#1C4E86'}"></circle></g>`; }
  svg += `<text x="${x(0)}" y="${H - 2}" font-size="9" text-anchor="middle" fill="#8A95A3">no change</text></svg>`;
  const ag = sr ? sr.development : null;
  const tiles = sr ? `<div class="tile"${tipAttr(statTip('aging', {v: ag.aging, pct: seasonPct(sr).aging, pool: seasonPools(sr).aging, n: ag.aging_w, season: sr.season}))}><div class="tl">Beats the aging curve</div><div class="tv">${miss(ag.aging) ? '—' : signed(ag.aging, 1)}</div><div class="ts">${miss(seasonPct(sr).aging) ? 'not ranked' : ord(seasonPct(sr).aging) + ' pct of ' + sr.season} · ${Math.round(ag.aging_w || 0).toLocaleString()} weighted minutes</div></div><div class="tile"${tipAttr(statTip('aging_young', {v: ag.aging_young, pct: seasonPct(sr).aging_young, pool: seasonPools(sr).aging_young, n: ag.aging_young_w, season: sr.season}))}><div class="tl">Players 24 and under</div><div class="tv">${miss(ag.aging_young) ? '—' : signed(ag.aging_young, 1)}</div><div class="ts">${miss(seasonPct(sr).aging_young) ? 'not ranked' : ord(seasonPct(sr).aging_young) + ' pct of ' + sr.season}</div></div>`
    : `<div class="tile"${tipAttr(statTip('aging', cs.aging ? {v: cs.aging.v, pct: cs.aging.pct, pool: cs.aging.pool, n: cs.aging.n, seasons: cs.aging.seasons} : {}))}><div class="tl">Beats the aging curve</div><div class="tv">${cs.aging ? signed(cs.aging.v, 1) : '—'}</div><div class="ts">${cs.aging ? `${miss(cs.aging.pct) ? 'not ranked' : ord(cs.aging.pct) + ' pct of ' + cs.aging.pool} · ${Math.round(cs.aging.n).toLocaleString()} weighted minutes` : 'no value'}</div></div><div class="tile"${tipAttr(statTip('aging_young', cs.aging_young ? {v: cs.aging_young.v, pct: cs.aging_young.pct, pool: cs.aging_young.pool, n: cs.aging_young.n, seasons: cs.aging_young.seasons} : {}))}><div class="tl">Players 24 and under</div><div class="tv">${cs.aging_young ? signed(cs.aging_young.v, 1) : '—'}</div><div class="ts">${cs.aging_young ? (miss(cs.aging_young.pct) ? 'not ranked' : `${ord(cs.aging_young.pct)} pct of ${cs.aging_young.pool}`) : 'no value'}</div></div>`;
  return `<div class="col wide"><h2 class="col-h">Do players get better under him?</h2><p class="since">1997-98 on · change in position-adjusted BPM percentile from the season before against what the aging curve expects at his age (the curve's own currency) · ${sr ? sr.season : 'his career'}: the ten who beat it most${bottom.length ? ' and the six who fell shortest' : ''} · hover a row; a name opens his card</p>
    <div class="tiles" style="margin-bottom:12px">${tiles}</div>${svg}
    <div class="legend2"><span><span class="sw" style="background:#C2A263;border-radius:50%"></span>expected at his age</span><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>beat it</span><span><span class="sw" style="background:#1C4E86;border-radius:50%"></span>fell short</span><span>Selection, the team's development staff and regression to the mean all live in this number.</span></div></div>`;
}
function renderStaff(sr){
  const L = COACH.lineage || {};
  const chain = []; let at = L.mentor, guard = 0; const nodes = IDX.tree.nodes;
  while (at && nodes[at] && guard++ < 12) { chain.push([at, nodes[at].name]); at = nodes[at].mentor; }
  const seasons = (sr ? [sr] : COACH.seasons).filter(s => s.staff && s.staff.length);
  const assist = COACH.assistant || [];
  const first = COACH.bio?.first_hc;
  return `<div class="col wide"><h2 class="col-h">Where he comes from, who he produced</h2><p class="since">assistant stints from Basketball-Reference (men who later became head coaches) and the NBA's staff tables (2000s on, as pulled) · a mentor is counted only from stints before his first head job</p>
    <div class="grid2"><div><h3 class="lead-h">Lineage</h3>${L.mentor ? `<div class="small">Suggested mentor: <b>${coachLink(L.mentor, L.mentor_name)}</b> (${esc(L.role || '')})${L.override ? ' · set by hand' : ' · from the record'}${L.tie ? ' · a tie in the record' : ''}${L.unconfirmed ? ' · <span class="pill">unconfirmed</span>' : ''}${L.mentor_closer_than != null ? ` · on style, closer than ${L.mentor_closer_than}% of pairs` : ''}</div>` : `<div class="small">No NBA assistant stint on record before his first head job${first ? ` (${first})` : ''}, so no mentor is suggested. That means the lineage is missing, not that he learned it alone.</div>`}
      ${chain.length > 1 ? `<div class="small" style="margin-top:4px">Line: ${[`<b>${esc(COACH.name)}</b>`, ...chain.map(c => coachLink(c[0], c[1]))].join(' ← ')}</div>` : ''}
      ${L.also?.length ? `<div class="small" style="margin-top:4px">Also served under: ${L.also.map(a => `${coachLink(a[0], a[1])} (${esc(a[2])})`).join(', ')}</div>` : ''}
      ${L.suggested?.length ? `<div class="small" style="margin-top:4px">Every head coach he served under before his first head job: ${L.suggested.map(u => `${coachLink(u[0], nodes[u[0]]?.name || u[0])} (${u[1]}${u[2]?.length ? `: ${u[2][0]}${u[2].length > 1 ? '–' + u[2][u[2].length - 1] : ''}` : ''})`).join(', ')}</div>` : ''}
      ${L.later?.length ? `<div class="small" style="margin-top:4px">On a staff after he had been a head coach (a job, not an apprenticeship): ${L.later.map(u => `${coachLink(u[0], nodes[u[0]]?.name || u[0])} (${u[1]}${u[2]?.length ? `: ${u[2][0]}${u[2].length > 1 ? '–' + u[2][u[2].length - 1] : ''}` : ''})`).join(', ')}</div>` : ''}
      ${L.kids?.length ? `<div class="small" style="margin-top:8px"><b>Head coaches off his staff:</b> ${L.kids.map(k => coachLink(k[0], k[1])).join(', ')}</div>` : ''}
      <div class="small" style="margin-top:8px"><a href="#tree=${COACH.id}">See him in the tree ↗</a></div>
      ${assist.length ? `<h3 class="lead-h" style="margin-top:14px">His own stints as an assistant</h3><div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>role</th><th>head coach</th></tr></thead><tbody>${assist.map(a => `<tr${first && a.season >= first ? ' style="color:var(--faint)"' : ''}><td>${a.season}${first && a.season >= first ? ' <span class="small">after his first head job</span>' : ''}</td><td>${esc(a.team)}</td><td style="text-align:left;font-family:var(--body)">${esc(a.role)}</td><td style="text-align:left;font-family:var(--body)">${(a.heads || []).map(h => coachLink(h, nodes[h]?.name || h)).join(', ') || '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
    <div><h3 class="lead-h">Staff room</h3>${seasons.length ? seasons.slice().reverse().map(s => `<div class="staff" style="margin:4px 0"><b>${s.season} ${s.team}</b>: ${s.staff.map(a => a.id ? coachLink(a.id, a.name) : esc(a.name)).join(', ')}<span class="small"> (${[...new Set(s.staff.flatMap(a => a.src))].map(x => x === 'br' ? 'Basketball-Reference' : 'NBA staff table').join(' and ')})</span></div>`).join('') : '<div class="empty">no staff recorded for ' + (sr ? sr.season : 'his seasons') + ' (team results while on staff are context, not credit)</div>'}</div></div></div>`;
}
function renderSeasons(){
  const S = COACH.seasons;
  const recTable = (rows) => `<div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>lg</th><th>W</th><th>L</th><th>finish</th><th>playoffs</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.season}</td><td>${esc(r.team)}</td><td>${r.lg}</td><td>${r.w}</td><td>${r.l}</td><td>${r.finish || ''}</td><td>${r.pg ? `${r.pw}–${r.pl}` : ''}</td><td style="text-align:left">${esc(r.remarks || '')}</td></tr>`).join('')}</tbody></table></div>`;
  if (!S.length) return COACH.records.length ? `<div class="col wide"><h2 class="col-h">Every season</h2><p class="since">Basketball-Reference records; the game-level data begins in 1996-97</p>${recTable(COACH.records)}</div>` : '';
  const pcell = (k, p) => p[k] != null ? ` <span class="pb" style="background:${STATS[k]?.kind === 'good' ? gradeColor(p[k]) : '#C2A263'};font-size:9.5px">${p[k]}</span>` : '';
  const row = s => { const e = s.exp || {}, m = s.management || {}, r = s.rotation || {}, p = s.pct || {}; return `<tr class="link${state.mode === s.season ? ' on' : ''}" data-pick="${s.season}"><td>${s.season}${s.in_progress ? ' <span class="pill">live</span>' : ''}</td><td>${s.team}</td><td>${s.w}–${s.l}</td><td>${s.pg ? `${s.pw}–${s.pl}${s.title ? ' ★' : ''}` : ''}</td><td>${signed(s.net)}${pcell('net', p)}</td><td>${e.exp_w82 != null ? e.exp_w82.toFixed(1) : '—'}</td><td>${e.w_talent != null ? signed(e.w_talent) : '—'}${pcell('w_talent', p)}</td><td>${e.market_total ?? '—'}</td><td>${e.w_market != null ? signed(e.w_market) : '—'}${pcell('w_market', p)}</td><td>${r.off_script != null ? (100 * (1 - r.off_script)).toFixed(0) + '%' : '—'}${pcell('stability', p)}</td><td>${r.shape ? r.shape.depth10 : '—'}</td><td>${m.to_g ?? '—'}</td><td>${m.ato_own != null ? m.ato_own.toFixed(2) : '—'}</td><td>${m.challenges?.n ? `${m.challenges.overturned || 0}/${m.challenges.n}` : '—'}</td><td>${s.identity?.pace ?? '—'}</td><td>${e.w_spread != null ? signed(e.w_spread) : '—'}</td><td>${s.staff?.length || '—'}</td></tr>`; };
  const older = COACH.records.filter(r => +r.season.slice(0,4) < 1996);
  return `<div class="col wide"><h2 class="col-h">Every season</h2><p class="since">the coloured numbers are percentiles among that season's coaches with ${IDX.meta.rules.min_season_games}+ games · click a season to view it everywhere above</p>
    <div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>record</th><th>playoffs</th><th>net</th><th>talent exp W/82</th><th>vs talent</th><th>win total</th><th>vs market</th><th>on script</th><th>depth</th><th>TO/g</th><th>ATO ppp</th><th>challenges</th><th>pace</th><th>ATS</th><th>staff</th></tr></thead><tbody>${S.slice().reverse().map(row).join('')}</tbody></table></div>
    ${older.length ? `<h3 class="lead-h" style="margin-top:14px">Before 1996-97</h3>${recTable(older)}` : ''}</div>`;
}

