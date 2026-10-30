
// ---------------------------------------------------------------- the team-season file: rotation, pairs, quadrant, minutes vs impact
async function loadSeason(season){
  const rb = document.getElementById('rotbody'), pb = document.getElementById('pairbody'), qb = document.getElementById('quadbody'), mb = document.getElementById('mvibody');
  if (!rb) return;
  const srow = COACH.seasons.find(s => s.season === season && s.rotation);
  const why = state.mode !== 'career' && !COACH.seasons.find(s => s.season === state.mode && s.rotation) ? `no play-by-play for ${state.mode} (the rotation data begins in 2002-03)${srow ? `; showing ${srow.season} instead` : ''}` : null;
  if (!srow) { for (const el of [rb, pb, qb, mb]) el.innerHTML = `<div class="empty">${why || 'no play-by-play seasons for him (the rotation data begins in 2002-03)'}</div>`; return; }
  const key = `${srow.team}-${season}`;
  rb.innerHTML = '<div class="empty">loading the season…</div>';
  try {
    const file = TCACHE[key] || (TCACHE[key] = await fetchJSON(`${BASE}/t/${key}.json`));
    const entry = (file.coaches || []).find(e => e.coach === COACH.id);
    if (!entry) throw new Error('no entry');
    TFILE = {...entry, names: file.names, fair: file.fair, parts: file.parts, season: file.season, team: file.team, why};
  }
  catch (e) { rb.innerHTML = `<div class="empty">could not load ${key}</div>`; return; }
  renderRotation(srow); renderPairs(srow); renderQuadrant(srow); renderMVI(srow);
}
const pname = p => TFILE.names[p] || TFILE.names[String(p)] || COACH.player_names?.[String(p)] || String(p);
function seasonTabs(extra){
  // the sticky picker drives every section; here only which season is on the map, and the view buttons
  const srow = COACH.seasons.find(s => s.season === state.season);
  const note = TFILE?.why ? `<div class="small" style="margin-bottom:6px">${esc(TFILE.why)}</div>` : '';
  return note + `<div class="tabs"><span class="pill" style="align-self:center">${state.season} ${srow?.team || ''}${state.kind === 'PO' ? ' playoffs' : ''}</span>${extra || ''}</div>`;
}
function wireSeasonTabs(root){
  root.querySelectorAll('[data-season]').forEach(x => x.addEventListener('click', () => { state.season = x.dataset.season; state.game = null; loadSeason(state.season); }));
}
const clockAt = m => `${12 - (m % 12)}:00 of the ${QN[Math.floor(m / 12)]}`;
const axisHTML = () => `<div class="rotaxis"><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span></div>`;

// what a game's intervals say about each regular: missing (no minutes at all), or off his usual windows
function gameDeviations(g, rows){
  const missing = [], off = [];
  for (const r of rows) {
    if (!r.windows || !r.windows.length) continue;
    const iv = g.iv?.[r.id] || g.iv?.[String(r.id)];
    if (!iv) { missing.push(r); continue; }
    // minutes on the floor outside his windows + window minutes he sat
    const on = new Array(48).fill(0);
    for (const [a, b] of iv) for (let s = a; s < Math.min(b, 2880); s += 60) on[Math.floor(s / 60)] = 1;
    const win = new Array(48).fill(0);
    for (const [a, b] of r.windows) for (let m = a; m <= b; m++) win[m] = 1;
    let dev = 0; for (let m = 0; m < 48; m++) if (on[m] !== win[m]) dev++;
    if (dev >= 8) off.push([r, dev]);
  }
  return {missing, off: off.sort((a, b) => b[1] - a[1])};
}
function gameTip(g, rows){
  const d = gameDeviations(g, rows);
  const res = `${g.margin > 0 ? 'won' : 'lost'} by ${Math.abs(g.margin)}${g.ot ? ' in OT' : ''}`;
  const causes = CAUSES.map((c, k) => `${CAUSE_L[c]} ${g.scripted ? (100 * g.causes[k] / g.scripted).toFixed(0) : 0}%`).join(' · ');
  return `<b>${g.date} ${g.home ? 'vs' : '@'} ${esc(teamName(g.opp))}</b>, ${res}${g.garbage ? ' <span class="k">· garbage time</span>' : ''}<br>` +
    `<b>${(100 * g.share).toFixed(0)}%</b> of ${g.scripted} scripted player-minutes went off script<br><span class="k">${causes}</span>` +
    (d.missing.length ? `<br>missing: ${d.missing.map(r => playerLink(r.id, r.name)).join(', ')}` : '') +
    (d.off.length ? `<br>off his usual windows: ${d.off.slice(0, 6).map(([r, dv]) => `${playerLink(r.id, r.name)} <span class="k">${dv} min</span>`).join(', ')}` : '') +
    `<br><span class="k">click to lay this game over the Rotation Map</span>`;
}
function renderRotation(srow){
  const t = TFILE, rb = document.getElementById('rotbody');
  const view = state.kind === 'PO' && t.playoffs ? t.playoffs : t.rotation;
  const rows = view.rows;
  const rot = srow.rotation;
  const bc = rot.by_cause || {};
  const P = seasonPct(srow), pools = seasonPools(srow);
  const tile = (key, label, value, sub, extraTip) => `<div class="tile"${tipAttr((key && STATS[key] ? statTip(key, {v: srow.values?.[key]?.[0], pct: P[key], pool: pools[key], n: srow.values?.[key]?.[1], season: srow.season}) : `<b>${esc(label)}</b><br>${esc(sub)}`) + (extraTip || ''))}><div class="tl">${label}</div><div class="tv">${value}${key && !miss(P[key]) ? `<span class="pb" style="background:${STATS[key]?.kind === 'good' ? gradeColor(P[key]) : '#C2A263'}">${P[key]}</span>` : ''}</div><div class="ts">${sub}</div></div>`;
  rb.innerHTML = seasonTabs(`<span style="flex:1"></span><button class="tab${state.base === 'played' ? ' on' : ''}" data-base="played">games he played</button><button class="tab${state.base === 'all' ? ' on' : ''}" data-base="all">all games</button>${t.playoffs ? `<button class="tab${state.kind === 'PO' ? ' on' : ''}" data-kind="${state.kind === 'PO' ? 'RS' : 'PO'}">${state.kind === 'PO' ? 'back to the regular season' : 'playoffs'}</button>` : ''}`) +
    `<div class="tiles" style="margin-bottom:12px">
      ${tile('stability', 'On script', miss(rot.off_script) ? '—' : (100 * (1 - rot.off_script)).toFixed(1) + '%', 'share of scripted minutes that went as usual')}
      ${tile('chosen_dev', 'Chosen deviation', pc1(bc.choice), 'off-script with no absence, blowout or foul trouble')}
      ${tile(null, 'After a loss vs a win', miss(rot.after_loss) || miss(rot.after_win) ? '—' : signed(100 * (rot.after_loss - rot.after_win)), 'points more off-script after a loss than after a win')}
      ${tile('hot_hand', 'Rides the hot hand', miss(rot.hot?.extra_q4) ? '—' : signed(rot.hot.extra_q4), `extra Q4 minutes on ${rot.hot?.n ?? 0} hot nights · a tendency`)}
      ${tile('depth10', 'Depth', rot.shape?.depth10 ?? '—', 'men at 10+ minutes a game')}
      ${tile('first_sub', 'First substitution', miss(rot.shape?.first_sub) ? '—' : (rot.shape.first_sub / 60).toFixed(1), 'minutes into the game')}
      ${tile('close_gap', 'Closing five gap', miss(view.closing?.gap) ? '—' : view.closing.gap.toFixed(1), `Σ BPM below the best five available, ${view.closing?.gap_n ?? 0} close games`)}
    </div>
    <div class="rot"><div class="rotnames">${rows.map(r => `<div class="rotname"${tipAttr(`<b>${playerLink(r.id, r.name)}</b> <span class="k">${r.mpg} mpg, ${r.gp} games${r.starts ? `, ${r.starts} starts` : ''}${r.bpm != null ? `, BPM ${r.bpm}` : ''}</span><br>${esc(r.text)}<br><span class="k">off his script ${pc1(r.off)} of his minutes, ${pc1(r.off_choice)} by choice</span>`)}>${playerLink(r.id, r.name)} <small>${r.mpg}</small></div>`).join('')}</div>
      <div class="rotwrap">${axisHTML()}<canvas class="map" id="rotmap"></canvas><div class="rotmin"><span>tip-off</span><span>12</span><span>24</span><span>36</span><span>48 min</span></div></div></div>
    <div class="legend2"><span><span class="sw" style="background:#22395A"></span>never on</span><span><span class="sw" style="background:#C2A263"></span>always on</span><span>white outline: his usual windows (60%+ of the games he played, minutes still in the balance)</span><span>red marks: the selected game's actual minutes</span><span>${rows.length} men with 100+ minutes · ${view.games} games</span></div>
    <h3 class="sub">Game by game: how far he went off script, and why</h3>
    <p class="since">each bar is one game; height is the share of that game's scripted player-minutes that went off script · hover a game for who was missing and who moved; click it to lay the game over the map</p>
    <div class="tabs"><button class="tab${!state.allCauses ? ' on' : ''}" data-causes="choice">the coach's choice only</button><button class="tab${state.allCauses ? ' on' : ''}" data-causes="all">add absence, blowout and foul trouble</button></div>
    <div id="gchart">${offScriptChart(view, rows)}</div>
    <div class="legend2">${(state.allCauses ? CAUSES : ['choice']).map(c => `<span><span class="sw" style="background:${CAUSE_C[c]}"></span>${CAUSE_L[c]}: ${pc1(bc[c])} of the season's scripted minutes</span>`).join('')}</div>
    <div class="ginfo small" id="ginfo" style="margin-top:6px">${state.game !== null && view.game_rows[state.game] ? gameLine(view.game_rows[state.game], rows) : 'no game selected'}</div>
    ${state.kind === 'RS' && t.rotation.months && Object.keys(t.rotation.months).length ? `<h3 class="sub">How it evolved, month by month</h3><p class="since">the same map, games he played in each month · hover a cell</p><div class="months">${Object.keys(t.rotation.months).map(mo => `<div class="month"><h4>${mo}</h4>${axisHTML()}<canvas class="map" data-month="${mo}"></canvas></div>`).join('')}</div>` : ''}`;
  const main = document.getElementById('rotmap');
  drawMap(main, rows, state.base, true, state.game !== null ? view.game_rows[state.game] : null);
  wireMapHover(main, rows, state.base, null);
  rb.querySelectorAll('canvas[data-month]').forEach(cv => {
    const map = t.rotation.months[cv.dataset.month];
    const mrows = rows.filter(r => map[r.id] || map[String(r.id)]).map(r => ({...r, played: map[r.id] || map[String(r.id)], all: map[r.id] || map[String(r.id)], windows: []}));
    drawMap(cv, mrows, 'played', false, null, 10);
    wireMapHover(cv, mrows, 'played', cv.dataset.month);
  });
  rb.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => { state.base = b.dataset.base; renderRotation(srow); }));
  rb.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { state.kind = b.dataset.kind; state.game = null; renderRotation(srow); }));
  rb.querySelectorAll('[data-causes]').forEach(b => b.addEventListener('click', () => { state.allCauses = b.dataset.causes === 'all'; renderRotation(srow); }));
  wireSeasonTabs(rb);
  rb.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.g; state.game = state.game === i ? null : i; hideTip(); renderRotation(srow);
  }));
}
function gameLine(g, rows){
  const d = gameDeviations(g, rows);
  return `<b>${g.date} ${g.home ? 'vs' : '@'} ${esc(teamName(g.opp))}</b>, ${g.margin > 0 ? 'won' : 'lost'} by ${Math.abs(g.margin)}${g.ot ? ' in OT' : ''}: ${(100 * g.share).toFixed(0)}% of scripted minutes off script (${CAUSES.map((c, k) => `${CAUSE_L[c]} ${g.causes[k]}`).join(', ')} of ${g.scripted} player-minutes)${g.garbage ? ' · garbage time' : ''}.${d.missing.length ? ` Missing: ${d.missing.map(r => playerLink(r.id, r.name)).join(', ')}.` : ''}${d.off.length ? ` Off their usual windows: ${d.off.slice(0, 6).map(([r]) => playerLink(r.id, r.name)).join(', ')}.` : ''} Red marks on the map: who was actually on the floor.`;
}
function offScriptChart(view, rows){
  const G = view.game_rows; if (!G.length) return '<div class="empty">no games</div>';
  const W = CW(), H = W < 600 ? 150 : 190, left = 36, bottom = 22, top = 8, n = G.length, bw = (W - left - 8) / n;
  const val = (g, k) => g.scripted ? 100 * g.causes[k] / g.scripted : 0;
  const tot = g => state.allCauses ? CAUSES.reduce((s, c, k) => s + val(g, k), 0) : val(g, 3);
  const ymax = Math.max(10, Math.ceil(Math.max(...G.map(tot)) / 10) * 10);
  const y = v => top + (H - top - bottom) * (1 - v / ymax);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (let g = 0; g <= ymax; g += ymax > 40 ? 20 : 10) svg += `<line x1="${left}" x2="${W - 8}" y1="${y(g)}" y2="${y(g)}" stroke="#E4E1D9"/><text x="${left - 5}" y="${y(g) + 3}" font-size="9" text-anchor="end" fill="#8A95A3">${g}%</text>`;
  let lastMo = null;
  G.forEach((g, i) => {
    const x = left + i * bw;
    let acc = 0;
    const order = state.allCauses ? [3, 0, 1, 2] : [3];
    svg += `<g class="hit" data-g="${i}"${tipAttr(gameTip(g, rows))}><rect x="${x}" y="${top}" width="${bw}" height="${H - top - bottom}" fill="transparent"/>`;
    for (const k of order) { const v = val(g, k); if (v <= 0) continue; svg += `<rect x="${x + bw * .12}" y="${y(acc + v)}" width="${Math.max(1, bw * .76)}" height="${y(acc) - y(acc + v)}" fill="${CAUSE_C[CAUSES[k]]}"/>`; acc += v; }
    if (state.game === i) svg += `<rect x="${x + bw * .06}" y="${top}" width="${bw * .88}" height="${H - top - bottom}" fill="none" stroke="#BC3A2C" stroke-width="1.5"/>`;
    svg += '</g>';
    const mo = g.date.slice(0, 7);
    if (mo !== lastMo) { if (lastMo) svg += `<line x1="${x}" x2="${x}" y1="${top}" y2="${H - bottom}" stroke="#D9D6CF"/>`; svg += `<text x="${x + 2}" y="${H - 7}" font-size="9" fill="#8A95A3">${new Date(g.date + 'T12:00:00').toLocaleString('en-US', {month:'short'})}</text>`; lastMo = mo; }
  });
  svg += `<line x1="${left}" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}" stroke="#C4C0B6"/></svg>`;
  return svg;
}
function drawMap(cv, rows, base, outline, game, cell){
  const n = rows.length; if (!n) { cv.width = 1; cv.height = 1; return; }
  const CW = cell || 20, CH = cell || 22, W = 48 * CW, H = n * CH;
  cv.width = W; cv.height = H; cv.style.height = (n * CH) + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#22395A'; ctx.fillRect(0, 0, W, H);
  rows.forEach((r, i) => {
    const arr = base === 'all' ? r.all : r.played;
    for (let m = 0; m < 48; m++) {
      const v = (arr[m] || 0) / 100;
      ctx.fillStyle = mix('#22395A', '#C2A263', Math.pow(v, 0.9)); ctx.fillRect(m * CW, i * CH, CW, CH);
    }
    if (outline) for (const [a, b] of r.windows || []) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(a * CW + .75, i * CH + 1.5, (b - a + 1) * CW - 1.5, CH - 3); }
  });
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
  for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo(q * 12 * CW + .5, 0); ctx.lineTo(q * 12 * CW + .5, H); ctx.stroke(); }
  if (cell) { ctx.strokeStyle = 'rgba(255,255,255,.15)'; for (let q = 1; q < 8; q += 2) { ctx.beginPath(); ctx.moveTo(q * 6 * CW + .5, 0); ctx.lineTo(q * 6 * CW + .5, H); ctx.stroke(); } }
  if (game && game.iv) {
    rows.forEach((r, i) => {
      const iv = game.iv[r.id] || game.iv[String(r.id)]; if (!iv) return;
      ctx.fillStyle = 'rgba(188,58,44,.9)';
      for (const [a, b] of iv) { const x0 = Math.min(W, a / 60 * CW), x1 = Math.min(W, b / 60 * CW); ctx.fillRect(x0, i * CH + CH - 5, Math.max(1, x1 - x0), 4); }
    });
  }
}
// hover on the map: the man, the minute and the share. The box opens to the right of the pointer
// so it never sits on the names column.
function wireMapHover(cv, rows, base, month){
  const n = rows.length; if (!n) return;
  const move = e => {
    const r = cv.getBoundingClientRect();
    const m = Math.min(47, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 48))), i = Math.min(n - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * n)));
    const key = `${cv.id || cv.dataset.month}:${i}:${m}`;
    if (tipKey === key) return;
    tipKey = key; tipAnchor = cv;
    const row = rows[i], arr = base === 'all' ? row.all : row.played, v = arr[m] || 0;
    const inWin = (row.windows || []).some(([a, b]) => m >= a && m <= b);
    showTip(`<b>${playerLink(row.id, row.name)}</b>: on the floor in <b>${Math.round(v)}%</b> of ${base === 'all' ? 'all games' : 'the games he played'} at ${clockAt(m)}${month ? ` <span class="k">(${month})</span>` : ''}${inWin ? '<br><span class="k">inside his usual window</span>' : ''}`, e.clientX, e.clientY, {minLeft: r.left + 4});
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerdown', move);
  cv.addEventListener('pointerleave', () => armHide(200));
}
function renderPairs(srow){
  const t = TFILE, pb = document.getElementById('pairbody');
  const men = t.men.slice(0, 12); if (men.length < 2) { pb.innerHTML = seasonTabs() + '<div class="empty">not enough men with 100 minutes</div>'; wireSeasonTabs(pb); return; }
  const on = Object.fromEntries(men.map(p => [p, (t.onoff || {})[p] || (t.onoff || {})[String(p)]]));
  const pair = {}; for (const [a, b, min, est, adj, poss] of t.matrix) { pair[a + '|' + b] = pair[b + '|' + a] = {min, est, adj, poss}; }
  const name = p => last(pname(p));
  const minOf = p => on[p]?.on?.min || 1;
  const vals = t.matrix.map(x => x[3]).filter(v => !miss(v)); const lo = Math.min(...vals, -5), hi = Math.max(...vals, 5);
  let html = '<div class="scroll"><table class="matrix"><thead><tr><th></th>' + men.map(p => `<th>${esc(name(p))}</th>`).join('') + '</tr></thead><tbody>';
  men.forEach((a, i) => {
    html += `<tr><th>${playerLink(a, name(a))}</th>`;
    men.forEach((b, j) => {
      if (i === j) { html += '<td class="d"></td>'; return; }
      const x = pair[a + '|' + b];
      if (!x) { html += '<td class="d" style="background:#F7F6F2"></td>'; return; }
      if (j > i) { const sh = Math.min(1, x.min / minOf(a)); html += `<td class="c" data-a="${a}" data-b="${b}" style="background:${mix('#ECEBE8', '#22395A', sh)};color:${sh > .5 ? '#fff' : '#1A2332'}"${tipAttr(`<b>${esc(pname(a))}</b> with <b>${esc(pname(b))}</b><br>${Math.round(x.min)} minutes together, <b>${(100 * sh).toFixed(0)}%</b> of ${esc(name(a))}'s minutes<br><span class="k">click for the full with / without</span>`)}>${(100 * sh).toFixed(0)}</td>`; }
      else { const v = x.est; const tt = miss(v) ? .5 : (v - lo) / (hi - lo); html += `<td class="c" data-a="${a}" data-b="${b}" style="background:${miss(v) ? '#E4E1D9' : (tt < .5 ? mix('#1C4E86', '#E4E1D9', tt * 2) : mix('#E4E1D9', '#BC3A2C', (tt - .5) * 2))};color:${Math.abs(tt - .5) > .3 ? '#fff' : '#1A2332'}"${tipAttr(`<b>${esc(pname(a))}</b> + <b>${esc(pname(b))}</b><br>net <b>${signed(x.est)}</b> sample-adjusted, ${signed(x.adj)} luck-adjusted<br><span class="k">${x.poss.toLocaleString()} possessions, ${Math.round(x.min)} minutes · click for the full with / without</span>`)}>${miss(v) ? '' : signed(v, 0)}</td>`; }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  const st = t.stagger || {};
  const stag = st['2'] ? `<div class="small" style="margin-top:8px">Stagger: his top two (${st['2'].ids.map(p => playerLink(p, name(p))).join(' and ')}) share the floor ${(100 * st['2'].together).toFixed(0)}% of the time, exactly one of them is on ${(100 * st['2'].apart).toFixed(0)}%, neither ${(100 * st['2'].none).toFixed(0)}%.${st['3'] ? ` Top three together ${(100 * st['3'].together).toFixed(0)}%.` : ''}</div>` : '';
  pb.innerHTML = seasonTabs() + html + stag + '<div class="pairinfo" id="pairinfo">Click a cell for the full With / Without.</div>';
  pb.querySelectorAll('td.c').forEach(td => td.addEventListener('click', () => {
    const a = td.dataset.a, b = td.dataset.b; const x = pair[a + '|' + b]; const oa = on[a] || on[+a], ob = on[b] || on[+b];
    const line = (o, pid) => o ? `<b>${playerLink(pid, pname(pid))}</b>: on ${Math.round(o.on.min)} min, net ${signed(o.on.adj)} (ORtg ${o.on.ortg}, DRtg ${o.on.drtg}); off ${signed(o.off?.adj)} → with/without ${signed(o.diff)}` : `<b>${playerLink(pid, pname(pid))}</b>: —`;
    document.getElementById('pairinfo').innerHTML = `${line(oa, a)}<br>${line(ob, b)}<br><b>Together</b>: ${Math.round(x.min)} min, ${x.poss.toLocaleString()} possessions, net ${signed(x.adj)} luck-adjusted, ${signed(x.est)} once pulled toward the team's ${signed(t.team_rates?.adj)} by k = 1,221 possessions.<br><span class="small">Luck: opponents' 3P% and FT% set to league average. Sample: the Lineups tab's k, measured from split-season reliability.</span>`;
  }));
  wireSeasonTabs(pb);
}
function renderQuadrant(srow){
  const t = TFILE, qb = document.getElementById('quadbody');
  const units = t.units5.filter(u => !miss(u.proj));
  if (!units.length) { qb.innerHTML = seasonTabs() + '<div class="empty">no projections for this season (a man without a card has no impact number)</div>'; wireSeasonTabs(qb); return; }
  const name = p => last(pname(p));
  const W = CW(760) > 660 ? 560 : CW(760), H = W < 600 ? 320 : 380, mins = units.map(u => u.min), projs = units.map(u => u.proj);
  const xmax = Math.max(...mins) * 1.05, ylo = Math.min(...projs) - 2, yhi = Math.max(...projs) + 2;
  const x = v => 50 + (W - 70) * v / xmax, y = v => 20 + (H - 60) * (1 - (v - ylo) / (yhi - ylo));
  const midm = Math.max(60, (Math.max(...mins) + 25) / 3), midp = units.reduce((s, u) => s + u.proj * u.min, 0) / units.reduce((s, u) => s + u.min, 0);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  svg += `<line x1="${x(midm)}" x2="${x(midm)}" y1="20" y2="${H-40}" stroke="#D9D6CF" stroke-dasharray="4 3"/><line x1="50" x2="${W-20}" y1="${y(midp)}" y2="${y(midp)}" stroke="#D9D6CF" stroke-dasharray="4 3"/>`;
  const lab = (tx, ty, s, anchor) => `<text x="${tx}" y="${ty}" font-size="10" fill="#8A95A3" text-anchor="${anchor}">${s}</text>`;
  svg += lab(W - 22, 32, 'rode it, it should work', 'end') + lab(W - 22, H - 46, 'rode it, the parts say no', 'end') + lab(54, 32, 'left on the table', 'start') + lab(54, H - 46, 'rightly benched', 'start');
  for (const u of units) {
    const r = 3 + Math.sqrt(u.poss) / 6;
    const tip = `<b>${u.ids.map(p => playerLink(p, name(p))).join(' · ')}</b><br>${Math.round(u.min)} minutes, ${u.poss.toLocaleString()} possessions over ${u.gp} games<br>projected <b>${signed(u.proj)}</b> from the parts (Σ BPM ${u.sum_bpm}${u.pair_adj ? `, pairing ${signed(u.pair_adj)}` : ''})<br>played <b>${signed(u.adj)}</b> luck-adjusted, ${signed(u.est)} sample-adjusted${u.oppq != null ? `<br><span class="k">opposing fives Σ BPM ${u.oppq}</span>` : ''}`;
    svg += `<circle class="hit" cx="${x(u.min)}" cy="${y(u.proj)}" r="${r}" fill="${u.adj > u.proj ? '#BC3A2C' : '#22395A'}" opacity=".7"${tipAttr(tip)}></circle>`;
  }
  svg += lab(W / 2, H - 8, 'minutes together', 'middle') + `<text transform="translate(14 ${H/2}) rotate(-90)" font-size="10" fill="#8A95A3" text-anchor="middle">projected net, from the parts</text>`;
  svg += '</svg>';
  const left = units.filter(u => u.min < midm && u.proj > midp).sort((a, b) => b.proj - a.proj).slice(0, 5);
  const rode = units.filter(u => u.min >= midm && u.proj < midp).sort((a, b) => b.min - a.min).slice(0, 5);
  const list = (arr, title) => `<div><h4 style="margin:0 0 4px;font-family:var(--mono);font-size:10.5px;color:var(--faint);text-transform:uppercase">${title}</h4>${arr.map(u => `<div class="small">${u.ids.map(p => playerLink(p, name(p))).join(', ')} — ${Math.round(u.min)} min, projected ${signed(u.proj)}, played ${signed(u.adj)}</div>`).join('') || '<div class="empty">none</div>'}</div>`;
  const lt = srow.rotation?.left_table;
  qb.innerHTML = seasonTabs() + `<div class="grid2"><div>${svg}</div><div>${list(left, 'Projected strong, barely played')}<br>${list(rode, 'Kept riding, the parts say no')}<div class="small" style="margin-top:10px"${tipAttr(statTip('left_table', {v: lt, pct: seasonPct(srow).left_table, pool: seasonPools(srow).left_table, season: srow.season}))}>Minutes-weighted gap to his best used arrangement: <b>${miss(lt) ? '—' : lt.toFixed(1)}</b> points per 100${seasonPct(srow).left_table ? ` (${ord(seasonPct(srow).left_table)} percentile of ${srow.season}, lower is better)` : ''}. Red: played better than projected; navy: worse. ${esc(IDX.meta.model_note)}</div></div></div>`;
  wireSeasonTabs(qb);
}
function renderMVI(srow){
  const t = TFILE, mb = document.getElementById('mvibody');
  const pl = (t.mvi?.players || []).filter(p => !miss(p.bpm));
  if (!pl.length) { mb.innerHTML = seasonTabs() + '<div class="empty">no impact numbers for this season</div>'; wireSeasonTabs(mb); return; }
  const W = CW(760), H = W < 600 ? 300 : 340, xs = pl.map(p => p.bpm), xlo = Math.min(-8, ...xs) - 1, xhi = Math.max(8, ...xs) + 1;
  const x = v => 50 + (W - 70) * (v - xlo) / (xhi - xlo), y = v => 20 + (H - 60) * (1 - v / 42);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  if (t.fair) { const pts = t.fair.filter(([b]) => b >= xlo && b <= xhi); if (pts.length) { const d = pts.map(([b, m], i) => `${i ? 'L' : 'M'}${x(b)},${y(m)}`).join(' '); svg += `<path d="${d}" fill="none" stroke="#C2A263" stroke-width="2" stroke-dasharray="5 3"${tipAttr(`<b>Fair minutes, league ${srow.season}</b><br>mean minutes per game at each whole-BPM level over players with 200+ minutes, monotone-smoothed`)}/><text x="${x(xhi) - 4}" y="${y(pts[pts.length-1][1]) - 6}" font-size="10" fill="#C2A263" text-anchor="end">fair minutes, league ${srow.season}</text>`; } }
  for (const g of [10, 20, 30]) svg += `<line x1="50" x2="${W-20}" y1="${y(g)}" y2="${y(g)}" stroke="#ECEBE8"/><text x="44" y="${y(g)+3}" font-size="9" text-anchor="end" fill="#8A95A3">${g}</text>`;
  svg += `<line x1="${x(0)}" x2="${x(0)}" y1="20" y2="${H-40}" stroke="#ECEBE8"/>`;
  for (const p of pl) {
    const young = p.age != null && p.age <= 23.5; const r = 3 + Math.sqrt(p.gp) / 2;
    const tip = `<b>${playerLink(p.id, p.name)}</b><br>${p.mpg} minutes a game over ${p.gp} games · BPM ${p.bpm}${p.age ? ` · age ${p.age.toFixed(1)}` : ''}${p.exp != null ? ` · year ${p.exp + 1}` : ''}${p.arch ? `<br><span class="k">${esc(p.arch)}</span>` : ''}`;
    svg += `<circle class="hit" cx="${x(p.bpm)}" cy="${y(p.mpg)}" r="${r}" fill="${young ? '#BC3A2C' : '#22395A'}" opacity=".75"${tipAttr(tip)}></circle>`;
    if (p.mpg >= 20 || young) svg += svgPlayer(p.id, x(p.bpm) + r + 2, y(p.mpg) + 3, last(p.name), 'font-size="9.5" fill="#5B6878" font-family="IBM Plex Sans"');
  }
  svg += `<text x="${W/2}" y="${H-8}" font-size="10" fill="#8A95A3" text-anchor="middle">impact (BPM, as on his card)</text><text transform="translate(14 ${H/2}) rotate(-90)" font-size="10" fill="#8A95A3" text-anchor="middle">minutes per game</text></svg>`;
  const mv = srow.mvi || {}, ro = srow.rotation || {};
  mb.innerHTML = seasonTabs() + svg + `<div class="legend2"><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>23 and under</span><span><span class="sw" style="background:#22395A;border-radius:50%"></span>24 and over · dot size: games</span><span${tipAttr(statTip('young_min', {v: srow.values?.young_min?.[0], pct: seasonPct(srow).young_min, pool: seasonPools(srow).young_min, season: srow.season}))}>minutes to 23-and-under: ${pc1(mv.young_min_share)} (their BPM ${miss(mv.young_bpm) ? '—' : mv.young_bpm})</span><span>rookies: ${pc1(mv.rookie_min_share)}</span><span${tipAttr(statTip('overplay', {v: ro.overplay, pct: seasonPct(srow).overplay, pool: seasonPools(srow).overplay, season: srow.season}))}>overplayed minutes above the fair line: ${miss(ro.overplay) ? '—' : ro.overplay.toFixed(1)} per game${seasonPct(srow).overplay ? ` (${ord(seasonPct(srow).overplay)} percentile, lower is better)` : ''}</span></div>`;
  wireSeasonTabs(mb);
}

