
// ---------------------------------------------------------------- coach page
async function openCoach(id, hash){
  document.body.className = 'view-coach anim';
  syncTabs('coaches');
  const el = document.getElementById('coach');
  if (!COACH || COACH.id !== id) {
    el.innerHTML = '<div class="col wide"><div class="empty">loading…</div></div>';
    try { COACH = await fetchJSON(`${BASE}/c/${encodeURIComponent(id)}.json`); }
    catch (e) { el.innerHTML = `<div class="col wide"><h2 class="col-h">No page for “${esc(id)}”</h2><p class="small">Search above for a head coach or assistant.</p></div>`; return; }
    cmp = cmp.filter(c => c !== id);
  }
  const m = /season=([0-9-]+)/.exec(hash || '');
  const rotSeasons = COACH.seasons.filter(s => s.rotation);
  state.mode = (m && COACH.seasons.find(s => s.season === m[1])) ? m[1] : 'career';
  const want = state.mode === 'career' ? null : state.mode;
  const full = rotSeasons.filter(s => s.g >= 20);
  state.season = (want && rotSeasons.find(s => s.season === want)) ? want : (full.length ? full[full.length - 1].season : (rotSeasons.length ? rotSeasons[rotSeasons.length - 1].season : null));
  state.game = null; state.kind = 'RS';
  renderCoach();
  if (!m) window.scrollTo(0, 0);
  document.title = `${COACH.name} — Basketball Coaching Savant`;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.id === id));
}
function pickSeason(season){
  const h = `c=${COACH.id}${season === 'career' ? '' : `&season=${season}`}`;
  if (decodeURIComponent(location.hash.slice(1)) === h) return;
  const y = window.scrollY;
  history.replaceState(null, '', '#' + h);
  state.mode = season;
  const rotSeasons = COACH.seasons.filter(s => s.rotation);
  state.season = season !== 'career' && rotSeasons.find(s => s.season === season) ? season : state.season;
  state.game = null;
  renderCoach();
  window.scrollTo(0, y);
}
const modeRow = () => state.mode === 'career' ? null : COACH.seasons.find(s => s.season === state.mode);
const modeLabel = () => state.mode === 'career' ? 'career' : `${state.mode} ${modeRow()?.team || ''}`;
// a season under the 41-game line but in progress is ranked provisionally among coaches with 10+ games
const liveMode = sr => !!(sr && !sr.ranked && sr.live_pct);
const seasonPct = sr => liveMode(sr) ? sr.live_pct : (sr.ranked ? sr.pct || {} : {});
const seasonPools = sr => liveMode(sr) ? (sr.live_pools || {}) : (IDX.league[sr.season]?.pools || {});
function cardRows(sr, page){
  // {key: {v, n, pct, pool, seasons}} for the career or for one season, for this coach or a compared one
  page = page || COACH;
  if (!sr) return page.career.stats;
  const row = page === COACH ? sr : page.seasons.find(s => s.season === sr.season);
  if (!row) return {};
  const pools = seasonPools(row), P = seasonPct(row), out = {};
  for (const [k, v] of Object.entries(row.values || {})) if (v && !miss(v[0])) out[k] = {v: v[0], n: v[1], pct: P[k], pool: pools[k], seasons: 1};
  return out;
}

function renderCoach(){
  const el = document.getElementById('coach');
  const sr = modeRow();
  const parts = [];
  parts.push(renderIdentity(sr));
  parts.push(renderControls(sr));
  parts.push(`<div class="ctxrow">${panelHTML('record', 'Results and expectation', sr, true)}</div>`);
  parts.push(`<div class="panels">${panelHTML('rotation', 'Rotation and lineups', sr)}${panelHTML('management', 'Game management', sr, false, renderManagement(sr))}</div>`);
  parts.push(`<div class="panels">${panelHTML('offense', 'Offensive identity', sr, false, renderDiet(sr, 'o') + renderPlayTypes(sr, 'o'))}${panelHTML('defense', 'Defensive identity', sr, false, renderDiet(sr, 'd') + renderPlayTypes(sr, 'd'))}</div>`);
  parts.push(`<div class="panels">${panelHTML('development', 'Players under him', sr)}${panelHTML('context', 'Situation by situation', sr, false, renderSplits(sr))}</div>`);
  parts.push(renderScouting(sr));
  parts.push(renderCareerChart());
  parts.push(`<div class="col wide" id="rotation"><h2 class="col-h">The Rotation Map<span class="q">when each man plays</span></h2><p class="since">2002-03 on · the model's view, not a verdict · hover a cell for the man, the minute and the share</p><div id="rotbody"></div></div>`);
  parts.push(`<div class="col wide" id="pairs"><h2 class="col-h">Who he plays together<span class="q">and does it work</span></h2><p class="since">2002-03 on · above the diagonal: share of the row's minutes with the column; below: sample-adjusted net together (luck-adjusted, pulled toward the team by k possessions) · hover a cell</p><div id="pairbody"></div></div>`);
  parts.push(`<div class="col wide" id="quad"><h2 class="col-h">Is he playing his best groups?</h2><p class="since">2002-03 on · every five-man unit with 25 minutes: minutes against its projection from parts · hover a dot</p><div id="quadbody"></div></div>`);
  parts.push(`<div class="col wide" id="mvi"><h2 class="col-h">Who he trusts<span class="q">and is he right</span></h2><p class="since">2002-03 on · minutes per game against impact, with the league's fair-minutes line for that season · hover a dot</p><div id="mvibody"></div></div>`);
  parts.push(renderArrival());
  parts.push(renderDevelopment(sr));
  parts.push(renderStaff(sr));
  parts.push(`<div class="col wide" id="treecard"><h2 class="col-h">His place in the tree</h2><p class="since">drag to pan, scroll or pinch to zoom, hover a coach to light his line, click to open his page · <a href="#tree=${COACH.id}">the whole forest ↗</a></p><div class="treestage embed" id="treeEmbed"></div></div>`);
  parts.push(renderComps(sr));
  parts.push(renderSeasons());
  el.innerHTML = parts.join('');
  wireCoach();
  loadSeason(state.season);
  const fb = document.querySelector('#fpplate .tab');
  document.querySelectorAll('#fpplate [data-fp]').forEach(x => x.addEventListener('click', () => drawFingerprint(x.dataset.fp, sr)));
  if (fb) drawFingerprint(fb.dataset.fp, sr); else drawFingerprint(null, sr);
  mountTree(document.getElementById('treeEmbed'), COACH.id);
  requestAnimationFrame(() => document.querySelectorAll('.fill[data-w]').forEach(f => { f.style.width = f.dataset.w + '%'; }));
}

// ---------------------------------------------------------------- identity card
function renderIdentity(sr){
  const c = COACH, b = c.bio, at = c.career.all_time, cs = c.career.stats;
  const bits = [];
  if (b.born) bits.push(`born ${b.born}${b.birthplace ? ', ' + esc(b.birthplace) : ''}`);
  if (b.college) bits.push(esc(b.college));
  if (b.played) bits.push(`played ${b.player_games ? b.player_games + ' NBA games' : 'in the NBA'}`);
  if (b.age_first_hc) bits.push(`first head job at <b>${b.age_first_hc}</b>`);
  if (b.assistant_seasons_before) bits.push(`${b.assistant_seasons_before} season${b.assistant_seasons_before === 1 ? '' : 's'} as an assistant before it`);
  const teams = [...new Set(c.stints.map(s => s.team))];
  const stat = (v, l, tip) => `<span class="st"${tip ? tipAttr(tip) : ''}><b>${v}</b> ${l}</span>`;
  const sl = `<div class="statline">${stat(`${at.w}–${at.l}`, 'W–L', 'Basketball-Reference, every regular season as a head coach')}${stat(at.g ? (100 * at.w / at.g).toFixed(1) + '%' : '—', 'WIN %')}${stat(at.titles, at.titles === 1 ? 'TITLE' : 'TITLES')}${stat(c.career.eligible ? signed(c.career.w_talent_sum_raw) : '—', 'ABOVE TALENT', statTip('w_talent', cs.w_talent ? {v: cs.w_talent.v, pct: cs.w_talent.pct, pool: cs.w_talent.pool, n: cs.w_talent.n, seasons: cs.w_talent.seasons} : {}) + '<div class="def">Added up over his career: actual wins minus the wins his rosters\' prior-season impact predicted.</div>')}${stat(c.career.eligible ? signed(c.career.w_market_sum_raw) : '—', 'ABOVE THE MARKET', statTip('w_market', cs.w_market ? {v: cs.w_market.v, pct: cs.w_market.pct, pool: cs.w_market.pool, n: cs.w_market.n, seasons: cs.w_market.seasons} : {}) + '<div class="def">Added up over his career: actual wins minus the preseason win total.</div>')}</div>`;
  const acc = [];
  for (const y of at.coy) acc.push(`<span class="acco major" title="Coach of the Year, ${y}">Coach of the Year ${y}</span>`);
  if (at.titles) acc.push(`<span class="acco gold">${at.titles} title${at.titles > 1 ? 's' : ''}</span>`);
  if (b.hof) acc.push('<span class="acco">Hall of Fame</span>');
  if (c.career.eligible) acc.push(`<span class="acco" title="ranked against ${IDX.meta.rules.career_pool} careers with ${IDX.meta.rules.min_career_seasons}+ seasons and ${IDX.meta.rules.min_career_games}+ games">ranked career</span>`);
  if (b.stub) acc.push('<span class="acco">no Basketball-Reference page</span>');
  const meta = `${teams.map(t => `<b>${esc(t)}</b>`).join(', ')}${at.first ? ` · ${at.first}–${(at.last || '').slice(0, 7)}` : ''} · ${at.seasons} season${at.seasons === 1 ? '' : 's'} as head coach${at.po_seasons ? ` · ${at.po_seasons} playoff seasons (${c.career.pw}–${c.career.pl} since 1996-97)` : ''}${bits.length ? '<br>' + bits.join(' · ') : ''}`;
  let ch = '<div class="cmpbar">';
  if (cmp.length) {
    const yr = sr ? startYear(sr.season) : null;
    ch += `<span class="cmp-pill"><span class="hf" style="--cc:${CMP_COLORS[0]}">${faceHTML(c.id, yr, c.name)}</span>${esc(c.name)}</span>`;
    cmp.forEach((id, i) => { const nm = CMPC[id]?.name || nameOf(id); ch += `<span class="cmp-pill"><span class="hf" style="--cc:${CMP_COLORS[i + 1]}">${faceHTML(id, yr, nm)}</span>${coachLink(id, nm)}<button class="cmp-x" data-idx="${i}" aria-label="Remove">&times;</button></span>`; });
  }
  if (1 + cmp.length < 3) ch += '<button class="cmp-add" id="cmpAdd">+ Compare</button>';
  ch += '</div>';
  if (cmp.length) ch += `<div class="cmp-note">${sr ? `Each coach's ${sr.season}, where he coached it; a coach without that season shows no bar.` : 'Careers, each ranked in the career pool.'}</div>`;
  return `<div class="id" id="id"><div class="id-head"><div class="headwrap"${tipAttr(headNote(c.id, sr ? startYear(sr.season) : null, sr ? sr.season : null))}>${faceHTML(c.id, sr ? startYear(sr.season) : null, c.name, true)}</div>
    <div class="id-headtext"><div class="id-name">${esc(c.name)}</div><div class="id-meta">${meta}</div>${sl}${acc.length ? `<div class="accos">${acc.join('')}</div>` : ''}${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}${ch}
    ${renderArcButton()}</div></div>${renderArcRail()}</div>`;
}
// the career arc: one tick per season, height his wins per 82 against his own range, the star on his
// peak (playoff success first, then the regular season); a tick picks that season
function arcPoints(){
  const rows = careerRows(), peak = peakOf(rows);
  const w82 = r => r.g ? 82 * r.w / r.g : 0;
  const vals = rows.filter(r => r.g).map(w82), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo;
  return {pts: rows.map(r => ({s: r.season, team: r.team, w: r.w, l: r.l, h: span > 0 ? (w82(r) - lo) / span : 1, has: r.has, tier: r.tier, title: r.title, w82: w82(r), unknownRound: r.unknownRound})), peak: peak ? peak.season : null};
}
function renderArcButton(){
  if (!COACH.records.length && !COACH.seasons.length) return '';
  const {peak} = arcPoints();
  const cur = state.mode === 'career' ? null : state.mode;
  return `<button type="button" class="arcbtn" id="arcBtn" aria-expanded="${state.arcOpen}">Career arc${cur && cur !== peak ? ` <span class="cur">${cur}</span>` : ''}${peak ? ` <span class="pk">★ ${peak}</span>` : ''}<span class="caret" aria-hidden="true">▾</span></button>`;
}
function renderArcRail(){
  if (!state.arcOpen) return '<div class="arcrail" id="arcrail" hidden></div>';
  const {pts, peak} = arcPoints();
  if (!pts.length) return '';
  const cur = state.mode;
  const bars = pts.map(p => {
    const on = p.s === cur, isPk = p.s === peak;
    const h = 14 + 86 * p.h, bg = isPk ? 'var(--gold)' : (p.has ? teamColor(p.team) : 'var(--track)');
    const t = `${p.s} ${teamName(p.team)} · ${p.w}–${p.l}${p.title ? ' · won the title' : p.unknownRound ? ' · playoffs' : p.tier > 0 ? ' · ' + ROUND_L[p.tier] : ''}${isPk ? ' · peak' : ''}${p.has ? '' : ' · before the game-level data'}`;
    return `<button type="button" class="arc-col${on ? ' on' : ''}" data-s="${p.s}" data-has="${p.has ? 1 : 0}"${tipAttr(esc(t) + (p.has ? '<br><span class="k">click to view this season</span>' : ''))} aria-label="${esc(t)}">${isPk ? '<span class="arc-star" aria-hidden="true">★</span>' : ''}<span class="arc-bar" style="height:${h.toFixed(1)}%;background:${bg};opacity:${p.has ? 1 : .55}"></span></button>`;
  }).join('');
  return `<div class="arcrail" id="arcrail" style="max-width:${pts.length * 48 + 96}px"><div class="arc-h">Career arc<span>wins per 82, against his own range · team colours · grey: before 1996-97</span></div><div class="arc-ticks">${bars}</div><div class="arc-foot"><span>${pts[0].s}</span>${peak ? `<span class="arc-pklab">★ peak ${peak}</span>` : ''}<span>${pts[pts.length - 1].s}</span></div></div>`;
}

// ---------------------------------------------------------------- the controls bar
function renderControls(sr){
  const S = COACH.seasons;
  if (!S.length && !COACH.records.length) return '';
  const {peak} = arcPoints();
  const cur = IDX.meta.current;
  const label = state.mode === 'career' ? 'Career' : `${state.mode}${state.mode === peak ? ' <span class="selx-star">★</span>' : ''}`;
  const opts = [`<button type="button" class="selx-opt" role="option" data-s="career" aria-selected="${state.mode === 'career'}"><span>Career</span><span class="selx-tag">${COACH.career.eligible ? 'ranked pool' : 'not ranked'}</span></button>`]
    .concat(S.slice().reverse().map(s => `<button type="button" class="selx-opt" role="option" data-s="${s.season}" aria-selected="${state.mode === s.season}"><span>${s.season}${s.season === peak ? ' <span class="selx-star">★</span>' : ''}</span><span class="selx-tag">${s.team}${s.season === cur ? ' · live' : ''}${s.g < IDX.meta.rules.min_season_games && s.season !== cur ? ' · ' + s.g + ' g' : ''}</span></button>`));
  const rank = state.mode === 'career' ? `the career pool, ${IDX.meta.rules.career_pool} coaches` : (sr && liveMode(sr) ? `this season's coaches with 10+ games, provisional` : `${state.mode}'s coaches with ${IDX.meta.rules.min_season_games}+ games`);
  return `<div class="controls"><div class="ctl"><span class="ctl-lab">Season</span><div class="selx" id="selx"><button type="button" class="selx-btn" id="selxBtn" aria-haspopup="listbox" aria-expanded="false"><span>${label}</span><span class="selx-caret" aria-hidden="true">▾</span></button><div class="selx-pop" id="selxPop" role="listbox" hidden>${opts.join('')}</div></div></div>
    <div class="ctl"><span class="ctl-lab">Ranked against</span><span style="font-family:var(--mono);font-size:12px">${rank}</span></div>
    <div class="legend"><div class="legbox"><div class="legbar"></div><div class="ends"><span>poor</span><span>elite</span></div></div><div class="leg"><span class="goldswatch"></span>a tendency</div><div class="leg"><span class="hatchswatch"></span>under its settle point</div></div></div>`;
}

// ---------------------------------------------------------------- the panels: Savant's card rows
function statBtn(key, label){
  return `<button type="button" class="statbtn" data-stat="${key}" aria-expanded="false" title="Chart ${esc(label)} season by season" aria-label="Chart ${esc(label)} season by season"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11.5L6 7l3 2.5L14 4"/><circle cx="2" cy="11.5" r="1.1"/><circle cx="6" cy="7" r="1.1"/><circle cx="9" cy="9.5" r="1.1"/><circle cx="14" cy="4" r="1.1"/></svg></button>`;
}
function rowHTML(s, v, sr){
  const p = v.pct, un = v.n < s.thr, col = s.kind === 'good' ? gradeColor(p) : muchColor();
  const shown = miss(p) ? 0 : p;
  const numLeft = shown > 88 ? `calc(${shown}% - 24px)` : `calc(${shown}% + 6px)`;
  return `<div class="row${un ? ' un' : ''}${miss(p) ? ' na' : ''}" data-k="${s.key}"${tipAttr(statTip(s.key, {v: v.v, pct: p, pool: v.pool, n: v.n, seasons: v.seasons, season: sr?.season}))}><div class="rl"><div class="name">${esc(s.label)}</div><div class="tag">${s.kind === 'good' ? 'how good' : 'how much'}${s.lower ? ' · lower is better' : ''}${un ? ' · low sample' : ''}${s.sub ? ' · ' + esc(s.sub) : ''}</div></div>
    <div class="track"><div class="tick" style="left:25%"></div><div class="tick mid" style="left:50%"></div><div class="tick" style="left:75%"></div><div class="fill" data-w="${miss(p) ? 0 : Math.max(p, 1.5)}" style="background:${col}"><div class="hatch"></div></div><div class="pnum" style="left:${numLeft}">${miss(p) ? '·' : p}</div></div>
    <div class="rv">${fmt(s.unit, v.v)}</div>${statBtn(s.key, s.label)}</div>`;
}
// compare: the way player compare draws it, one thin bar per coach inside the track
function cmpRowHTML(s, entries, sr){
  const bh = entries.length > 2 ? 12 : 14, gap = 4, pad = 5, trH = entries.length * bh + (entries.length - 1) * gap + 10;
  const items = entries.map(e => { const v = e.rows[s.key]; return v ? {pct: miss(v.pct) ? 0 : v.pct, p: v.pct, txt: fmt(s.unit, v.v), v: v.v, n: v.n, pool: v.pool, nm: e.name} : {pct: 0, p: null, txt: '—', nm: e.name}; });
  const bars = items.map((it, i) => `<div class="cbar" style="top:${pad + i * (bh + gap)}px;height:${bh}px;width:${Math.max(it.pct, 1.5)}%;background:${CMP_COLORS[i]}">${it.pct >= 22 ? `<span class="cbar-lab">${esc(last(it.nm))}${it.p != null ? ' ' + it.p : ''}</span>` : ''}</div>`).join('');
  const vals = items.map((it, i) => `<div class="cv"><span class="cdot" style="background:${CMP_COLORS[i]}"></span>${it.txt}</div>`).join('');
  const tip = `<b>${esc(s.label)}</b><br>` + items.map((it, i) => `<span class="cdot" style="background:${CMP_COLORS[i]};margin-right:5px"></span>${esc(it.nm)}: <b>${it.txt}</b>${it.p != null ? ` ${s.kind === 'good' ? pbox(it.p) : goldbox(it.p)}<span class="k">of ${it.pool ?? '—'}</span>` : ' <span class="k">not ranked</span>'}`).join('<br>') + `<div class="def">${esc(s.what)}</div>`;
  return `<div class="row nochart" data-k="${s.key}"${tipAttr(tip)}><div class="rl"><div class="name">${esc(s.label)}</div><div class="tag">${s.kind === 'good' ? 'how good' : 'how much'}${s.lower ? ' · lower is better' : ''}</div></div><div class="track" style="height:${trH}px"><div class="tick" style="left:25%"></div><div class="tick mid" style="left:50%"></div><div class="tick" style="left:75%"></div>${bars}</div><div class="rv" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">${vals}</div></div>`;
}
function cmpEntries(sr){
  const e = [{id: COACH.id, name: COACH.name, rows: cardRows(sr)}];
  for (const id of cmp) if (CMPC[id]) e.push({id, name: CMPC[id].name, rows: cardRows(sr, CMPC[id])});
  return e;
}
function panelHTML(group, title, sr, wide, extra){
  const cs = cardRows(sr), entries = cmp.length ? cmpEntries(sr) : null;
  const all = IDX.stats.filter(s => s.group === group && (cs[s.key] || (entries && entries.some(e => e.rows[s.key]))));
  const head = HEADLINE[group] || [], top = all.filter(s => head.includes(s.key)).sort((a, b) => head.indexOf(a.key) - head.indexOf(b.key)), more = all.filter(s => !head.includes(s.key));
  const row = s => entries ? cmpRowHTML(s, entries, sr) : rowHTML(s, cs[s.key], sr);
  const none = !all.length;
  const q = {record: 'does he beat what he is given?', rotation: 'who plays, and does he stick to it?', management: 'timeouts, challenges, the clock', offense: 'what his teams hunt', defense: 'what they take away', development: 'against the aging curve', context: 'where the margin moves'}[group];
  const since = Math.min(...all.map(s => +s.first.slice(0, 4)).filter(Boolean));
  return `<div class="col${wide ? ' wide' : ''}" data-group="${group}"><h2 class="col-h">${title}<span class="q">${q}</span></h2>${none ? `<div class="empty">${sr ? `nothing for ${sr.season}` : (COACH.career.eligible ? 'nothing in this group' : `career stats are ranked only for head coaches with ${IDX.meta.rules.min_career_seasons}+ seasons and ${IDX.meta.rules.min_career_games}+ games since 1996-97; pick a season above`)}</div>` : `<p class="since">${isFinite(since) ? `from ${since}-${String(since + 1).slice(2)}` : ''}${sr ? ` · ${sr.season} ${sr.team}, ${sr.g} games` : ' · career, games-weighted'}${sr && !sr.ranked && !liveMode(sr) ? ' · under the line, shown without percentiles' : ''}</p>${top.map(row).join('')}`}
    ${(more.length || extra) ? `<div class="xmore"><button type="button" class="xmore-btn" aria-expanded="false"><span class="xmore-lab">More ${esc(title.toLowerCase())}</span>${more.length ? `<span class="xmore-n">${more.length} stat${more.length === 1 ? '' : 's'}</span>` : ''}${extra ? '<span class="xmore-n">detail</span>' : ''}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg></button><div class="xmore-body">${more.map(row).join('')}${extra || ''}</div></div>` : ''}</div>`;
}
function explain(key, after, sr){
  const s = STATS[key]; if (!s) return;
  const nxt = after.nextElementSibling;
  if (nxt && nxt.classList.contains('expl')) { nxt.remove(); return; }
  document.querySelectorAll('.expl').forEach(e => e.remove());
  const v = cardRows(sr)[key];
  const div = document.createElement('div'); div.className = 'expl';
  div.innerHTML = `<b>${esc(s.label)}</b> <span class="k">${s.kind === 'good' ? 'how good' : 'how much'}${s.lower ? ' · lower is better' : ''} · from ${s.first}</span><br>${esc(s.what)}<br><span class="k">${esc(s.formula)}</span><br><span class="k">Source: ${esc(s.source)} · ${esc(s.sample)}${v ? ` · his sample ${Number(v.n).toLocaleString()}${v.seasons ? `, ${v.seasons} season${v.seasons === 1 ? '' : 's'}` : ''}, pool ${v.pool ?? '—'}` : ''}</span>`;
  after.insertAdjacentElement('afterend', div);
}
// the per-row chart: his seasons, dots coloured by that season's percentile, the league median dashed
function rcOpen(btn, key){
  const row = btn.closest('.row'); if (!row) return;
  rcClose();
  const host = document.createElement('div'); host.className = 'statchart'; host.dataset.stat = key;
  row.parentNode.insertBefore(host, row.nextSibling);
  btn.setAttribute('aria-expanded', 'true');
  const s = STATS[key];
  const pts = COACH.seasons.filter(x => x.values?.[key] && !miss(x.values[key][0])).map(x => ({s: x.season, team: x.team, v: x.values[key][0], n: x.values[key][1], pct: (x.ranked ? x.pct?.[key] : x.live_pct?.[key]) ?? null, med: IDX.league[x.season]?.median?.[key]}));
  const head = `<div class="rc-top"><div class="rc-name">${esc(s.label)}<em>season by season</em></div><button type="button" class="rc-x" aria-label="Close">×</button></div>`;
  if (pts.length < 2) { host.innerHTML = head + '<div class="rc-empty">Only one season of this stat — nothing to plot yet.</div>'; return; }
  const W = Math.max(260, Math.min(680, (host.clientWidth || 520) - 28)), H = W < 360 ? 132 : 158, L = W < 360 ? 38 : 48, R = 10, T = 10, B = 22;
  const vals = pts.map(p => p.v).concat(pts.map(p => p.med).filter(v => !miss(v)));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  if (s.unit === 'pct1' && lo < 0 && Math.min(...vals) >= 0) lo = 0;
  const X = i => L + (W - L - R) * i / (pts.length - 1), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let t = 0; t <= 2; t++) { const v = lo + (hi - lo) * t / 2, y = Y(v); g += `<line class="rc-gl" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="rc-ax" x="${L - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmt(s.unit, v)}</text>`; }
  const step = Math.max(1, Math.ceil(pts.length / (W < 360 ? 4 : 8)));
  for (let i = pts.length - 1; i >= 0; i -= step) g += `<text class="rc-ax" x="${X(i).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${pts[i].s.slice(2, 4)}-${pts[i].s.slice(5)}</text>`;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  g += `<path class="rc-ar" d="${line} L${X(pts.length - 1).toFixed(1)} ${H - B} L${X(0).toFixed(1)} ${H - B} Z"/>`;
  const medPts = pts.map((p, i) => miss(p.med) ? null : `${X(i).toFixed(1)} ${Y(p.med).toFixed(1)}`);
  if (medPts.some(Boolean)) { let d = '', pen = false; medPts.forEach(m => { if (!m) { pen = false; return; } d += (pen ? 'L' : 'M') + m + ' '; pen = true; }); g += `<path class="rc-med" d="${d}"/>`; }
  g += `<path class="rc-ln" d="${line}"/>`;
  pts.forEach((p, i) => { g += `<circle class="rc-pt hit" cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.6" fill="${p.pct == null ? '#22395A' : (s.kind === 'good' ? gradeColor(p.pct) : '#C2A263')}"${tipAttr(`<b>${p.s} ${esc(teamName(p.team))}</b><br>${esc(s.label)}: <b>${fmt(s.unit, p.v)}</b>${p.pct != null ? ` ${s.kind === 'good' ? pbox(p.pct) : goldbox(p.pct)}<span class="k">that season</span>` : ''}${miss(p.med) ? '' : `<br><span class="k">league median ${fmt(s.unit, p.med)}</span>`}<br><span class="k">sample ${Number(p.n).toLocaleString()}</span>`)}></circle>`; });
  const first = pts[0], lastp = pts[pts.length - 1];
  host.innerHTML = head + `<svg class="rc-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label)} for ${esc(COACH.name)}, ${first.s} to ${lastp.s}">${g}</svg><div class="rc-note">${pts.length} seasons · ${first.s} → ${lastp.s} · dot colour = percentile that season · <span style="color:var(--gold)">- - -</span> league median</div>`;
}
function rcClose(){ document.querySelectorAll('.statchart').forEach(n => n.remove()); document.querySelectorAll('.statbtn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false')); }

// ---------------------------------------------------------------- compare
async function addCompare(id){
  if (!id || id === COACH.id || cmp.includes(id) || cmp.length >= 2) return;
  if (!CMPC[id]) { try { CMPC[id] = await fetchJSON(`${BASE}/c/${encodeURIComponent(id)}.json`); } catch (e) { return; } }
  cmp.push(id); const y = window.scrollY; renderCoach(); window.scrollTo(0, y);
}

// ---------------------------------------------------------------- events (delegated: the page is rebuilt on every change)
function wireCoach(){
  const sr = modeRow();
  document.querySelectorAll('#coach [data-pick]').forEach(x => x.addEventListener('click', e => { if (e.target.closest('a')) return; pickSeason(x.dataset.pick); }));
  const btn = document.getElementById('selxBtn'), pop = document.getElementById('selxPop');
  if (btn) {
    btn.addEventListener('click', () => { const open = pop.hidden; pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { const on = pop.querySelector('[aria-selected="true"]'); if (on) on.scrollIntoView({block:'nearest'}); } });
    pop.querySelectorAll('.selx-opt').forEach(o => o.addEventListener('click', () => { pop.hidden = true; pickSeason(o.dataset.s); }));
    document.addEventListener('click', e => { if (!e.target.closest('#selx')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }, {once: true, capture: true});
  }
  const arc = document.getElementById('arcBtn');
  if (arc) arc.addEventListener('click', () => { state.arcOpen = !state.arcOpen; const y = window.scrollY; renderCoach(); window.scrollTo(0, y); });
  document.querySelectorAll('.arc-col').forEach(a => a.addEventListener('click', () => { if (a.dataset.has === '1') pickSeason(a.dataset.s); }));
}
document.addEventListener('click', e => {
  const t = e.target;
  const b = t.closest ? t.closest('.statbtn') : null;
  if (b) { if (b.getAttribute('aria-expanded') === 'true') rcClose(); else rcOpen(b, b.dataset.stat); return; }
  if (t.closest && t.closest('.rc-x')) { rcClose(); return; }
  const xm = t.closest ? t.closest('.xmore-btn') : null;
  if (xm) { const box = xm.closest('.xmore'); const open = !box.classList.contains('open'); box.classList.toggle('open', open); xm.setAttribute('aria-expanded', String(open)); if (open) requestAnimationFrame(() => box.querySelectorAll('.fill[data-w]').forEach(f => { f.style.width = f.dataset.w + '%'; })); return; }
  const x = t.closest ? t.closest('.cmp-x') : null;
  if (x) { cmp.splice(+x.dataset.idx, 1); const y = window.scrollY; renderCoach(); window.scrollTo(0, y); return; }
  if (t.closest && t.closest('#cmpAdd')) { enterAdd(); return; }
  const rl = t.closest ? t.closest('.rl') : null;
  if (rl) { const row = rl.closest('.row'); if (row && row.dataset.k && COACH) explain(row.dataset.k, row, modeRow()); }
});

// ---------------------------------------------------------------- scouting report
function seasonScout(sr){
  const pools = seasonPools(sr), P = seasonPct(sr);
  if (COACH.scouting_season && COACH.scouting_season.season === sr.season) return COACH.scouting_season.lines;
  const out = [];
  for (const g of IDX.groups) {
    const cands = [];
    for (const s of IDX.stats) {
      if (s.group !== g) continue;
      const p = P[s.key], v = sr.values?.[s.key];
      if (miss(p) || !v || miss(v[0]) || v[1] < Math.max(1, Math.floor(s.thr / 4))) continue;
      if (p >= 85 || p <= 15) cands.push({d: Math.abs(p - 50), s, p, v: v[0], n: v[1]});
    }
    cands.sort((a, b) => b.d - a.d);
    for (const c of cands.slice(0, 2)) {
      const how = c.s.kind === 'much' ? (c.p >= 85 ? 'among the most' : 'among the least') : (c.p >= 85 ? 'among the best' : 'among the worst');
      const settled = c.n >= c.s.thr;
      out.push({group: g, key: c.s.key, pct: c.p, value: c.v, n: c.n, settled, text: `${c.s.label}: ${fmt(c.s.unit, c.v)}, ${how} of ${pools[c.s.key] ?? '—'} coaches in ${sr.season} (${ord(c.p)} percentile), over ${Number(c.n).toLocaleString()} ${c.s.thr === 41 || c.s.thr === 82 ? 'games' : 'in the sample'}${settled ? '.' : `; it settles at ${c.s.thr.toLocaleString()}, so this can still move.`}`});
    }
  }
  return out;
}
function renderScouting(sr){
  const live = sr && sr.in_progress;
  const L = sr ? seasonScout(sr) : (COACH.scouting || []);
  if (!L.length) return '';
  const title = sr ? `Scouting report, ${sr.season}${live ? ' so far' : ''}` : 'Scouting report';
  const since = sr ? (live ? `written by rule from this season's numbers, ranked against ${sr.season}'s coaches; rewritten with every refresh` : `written by rule from his ${sr.season} numbers, ranked against that season's coaches`) : 'written by rule from the card: the two rows furthest from the middle in each group, with their sample';
  const line = l => `<li${tipAttr(statTip(l.key, {v: l.value, pct: l.pct, n: l.n, pool: sr ? seasonPools(sr)[l.key] : COACH.career.stats[l.key]?.pool, season: sr?.season, seasons: sr ? null : COACH.career.stats[l.key]?.seasons}))}>${esc(l.text)}${l.settled === false ? ' <span class="k">small sample</span>' : ''}</li>`;
  return `<div class="col wide" id="scout"><h2 class="col-h">${title}${sr && liveMode(sr) ? ' <span class="pill">provisional</span>' : ''}</h2><p class="since">${since}</p><ul class="lines">${L.map(line).join('')}</ul><div class="small">${esc(IDX.meta.model_note)}</div></div>`;
}
