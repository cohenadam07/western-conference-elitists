
// ============================================================================ College Basketball Coaching Savant
// The NBA page's functions above stay as the shared shell; everything below redefines the ones that
// differ in college (a later function declaration wins), and adds the four college-only sections:
// roster building, the NCAA Tournament against the seed, resources and similar players.
// Data: /cbcs/index.json, /cbcs/c/<coach>.json, /cbcs/t/<team>-<season>.json.gz (pipeline/college/coaching/build.py).

const CUR = () => IDX.meta.current;
const tAbbr = k => IDX.teams[k]?.abbr || IDX.teams[k]?.name || k;
const teamLink = (k, season, label) => k ? `<a class="tl2" href="${CBB}#team-${k}/${season || curSeason()}" title="the team on College Basketball Savant">${esc(label || teamName(k))}</a>` : '—';
const GQ = {record: 'does he beat the roster he was given?', rotation: 'who plays, and does he stick to it?', management: 'timeouts, challenges, the clock', offense: 'what his teams hunt', defense: 'what they take away',
  development: 'do players get better under him?', roster: 'how he builds it, and do the additions hit?', tournament: 'March, measured fairly', resources: 'with money, or without it', context: 'where the margin moves'};
const SRC_L = {returning: 'returning', transfer: 'D1 transfers', hs: 'high-school freshmen', juco: 'JUCO or non-D1', intl: 'international'};
const SRC_C = {returning: '#22395A', transfer: '#BC3A2C', hs: '#C2A263', juco: '#8B9099', intl: '#1C4E86'};

// ---------------------------------------------------------------- home
function renderHome(){
  const m = IDX.meta, hc = IDX.coaches.filter(c => c.hc);
  document.getElementById('homeintro').innerHTML = `<h2 class="col-h">Every men's D1 head coach, judged from the floor up</h2><p class="since">${hc.length.toLocaleString()} head coaches on record · ${IDX.coaches.filter(c => c.g).length.toLocaleString()} with games since ${m.rules.stats_from} · a pool of ${m.rules.career_pool} ranked careers · data through ${m.through || m.generated.slice(0, 10)}</p>
    <p class="small" style="max-width:760px">Wins against the roster he was handed, read from last season before he coached it. Whether players get better under him, by class year and starting level. How he builds a roster: the portal, high school, retention. When each man plays and how often he goes off script. Timeouts that stop runs, or don't. March against the seed. Spending, from the Department of Education. Records and the coaching tree as far back as the sources go. Start with a name above, or a trending coach. Paired with <a href="${CBB}">College Basketball Savant</a>.</p>`;
  document.getElementById('lead-since').textContent = `career boards: head coaches with ${m.rules.min_career_seasons}+ seasons and ${m.rules.min_career_games}+ games from ${m.rules.stats_from}; this season: ${m.current}, provisional until ${m.rules.min_live_games} games`;
  renderLeaders();
  renderTrends();
  const pr = IDX.produced.slice(0, 16).map(([n, id, kids]) => `<div class="lrow"${tipAttr(`<b>${esc(n)}</b><br>${kids.slice(0, 12).map(esc).join(', ')}${kids.length > 12 ? ` and ${kids.length - 12} more` : ''}`)}><span class="hf">${faceHTML(id, null, n)}</span><span class="ln">${coachLink(id, n)}</span><span class="lv">${kids.length}</span></div>`).join('');
  document.getElementById('produced').innerHTML = `<div class="grid3"><div>${pr || '<div class="empty">none yet</div>'}</div><div class="small" style="grid-column:span 2">Head coaches who served on a man's staff before their own first head job, read from Wikipedia's team-season staffs and coach biographies. ${esc(IDX.tree.note)} <a href="#tree">Open the tree ↗</a><br><span class="k">${esc(m.credit)}</span></div></div>`;
  const nh = IDX.next_hc || [];
  document.getElementById('nexthc').innerHTML = nh.length ? `<div class="scroll"><table class="t"><thead><tr><th style="text-align:left">assistant</th><th>now at</th><th>seasons on staffs</th><th>NCAA seasons</th><th>those teams' net</th><th style="text-align:left">head coaches served</th></tr></thead><tbody>${nh.slice(0, 20).map(r => `<tr><td style="text-align:left;font-family:var(--body)">${r.wiki ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(r.wiki.replace(/ /g, '_'))}" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td><td>${teamLink(r.team, CUR(), tAbbr(r.team))}</td><td>${r.seasons}</td><td>${r.ncaa}</td><td>${signed(r.mean_net)}</td><td style="text-align:left;font-family:var(--body)">${(r.heads || []).map(h => coachLink(h[0], h[1])).join(', ')}</td></tr>`).join('')}</tbody></table></div><div class="small">The rank is context, not credit: an assistant's job is not measured in public data. Staffs from Wikipedia's team-season articles.</div>` : '<div class="empty">no staffs on record</div>';
  const t = m.fits.roster || {}, p = m.fits.parts || {}, f = m.fits.fit || {};
  document.getElementById('howto').innerHTML = `
    <p><b>Two kinds of rows.</b> A graded row (blue to red) is "how good": higher percentile, better, with lower-is-better rows already flipped. A gold row is "how much": a tendency, where a high percentile means more of it, not better. The number riding the bar is the percentile; every percentile names its pool: that season's D1 head coaches with ${m.rules.min_season_games}+ games, or the ${m.rules.career_pool} ranked careers. A hatched bar is under its settle point. Hover anything for its value, pool, sample and definition; click a row's name to pin the explainer; the chart glyph draws his seasons against the D1 median.</p>
    <p><b>The roster model is the headline.</b> Each returning player's Savant rate and role last season, each transfer's at his old school plus a level-jump term fitted on 2021-on portal moves, each freshman's recruit rank, summed into an expected net and expected wins against the schedule actually played. Out of sample it missed team net by ${t.vs_last?.ours_rmse?.toFixed(2) ?? '—'} points per 100 against ${t.vs_last?.baseline_rmse?.toFixed(2) ?? '—'} for last season's net (${(t.vs_last?.n || 0).toLocaleString()} team-seasons), and by ${t.vs_ap?.ours_rmse?.toFixed(2) ?? '—'} against ${t.vs_ap?.baseline_rmse?.toFixed(2) ?? '—'} for the preseason AP rank on ranked teams (${t.vs_ap?.n ?? '—'}): ${t.headline ? 'it beat both, so it is the baseline' : 'it did not beat both'}. The AP poll is context only. The market (the spread, 2013-14 on) is the third lens.</p>
    <p><b>The Rotation Map</b> (2023-24 on, where College Savant's lineup gate passes) shows, for every man with 60 minutes under a coach, the share of games he was on the floor in each of the 40 minutes. His usual windows are where that share is 60% or better. Each off-script minute gets the first cause that fits: absence, blowout (College Savant's safe-lead rule), foul trouble (a 2nd foul in the first half; a 4th with 8:00 or more left), then choice. ${esc(m.model_note)}</p>
    <p><b>Lineups judged from their parts</b> use each five's Savant rates. Tested where the rates cannot see the games (last season's rates, odd games fit, even games scored), the projection's error was ${p.rmse_projection?.toFixed(2) ?? '—'} against ${p.rmse_team_net?.toFixed(2) ?? '—'} for the team's own net: ${p.validated ? 'validated' : 'not a real gain, so everything built on it is shown as unvalidated'}. <b>System fit</b> was tested on ${(f.n || 0).toLocaleString()} transfers: ${f.ships_as === 'fit score' ? 'it predicted their change, so it is a fit score' : 'it did not predict their change better than the roster model, so it is shown only as similar players under him'}.</p>
    <p class="k">${esc(m.credit)} Spending: the U.S. Department of Education's Equity in Athletics data. Player numbers: College Basketball Savant.</p>`;
}
function renderTrends(){
  const el = document.getElementById('trends');
  const keys = [['pace','Tempo'],['fg3r','3-point rate'],['tr_min','Minutes to D1 transfers'],['ret_min','Returning minutes'],['to_g','Timeouts per game'],['stability','Rotation stability']];
  el.innerHTML = keys.map(([k, label]) => {
    const pts = IDX.trends.filter(t => !miss(t[k])).map(t => [t.season, t[k]]);
    if (pts.length < 2) return `<div><h3 class="lead-h">${label}</h3><div class="empty">${pts.length ? 'one season so far' : 'no seasons yet'}</div></div>`;
    const vals = pts.map(p => p[1]); const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * .15 || 1;
    const W = 300, H = 90, x = i => 30 + i * (W - 40) / (pts.length - 1), y = v => 10 + (H - 30) * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    const u = STATS[k]?.unit || 'num1';
    return `<div><h3 class="lead-h"${tipAttr(statTip(k))}>${label}</h3><p class="lead-p">${pts[0][0]} → ${pts[pts.length-1][0]}: ${fmt(u, pts[0][1])} → ${fmt(u, pts[pts.length-1][1])}</p>
      <svg class="chart" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="#22395A" stroke-width="2"/>${pts.map((p, i) => `<circle class="hit" cx="${x(i)}" cy="${y(p[1])}" r="3.5" fill="#C2A263"${tipAttr(`<b>${p[0]}</b><br>${esc(label)}: ${fmt(u, p[1])}<br><span class="k">D1 median over coach-seasons with 15+ games</span>`)}></circle>`).join('')}
      <text x="30" y="${H-4}" font-size="9" fill="#8B9099">${pts[0][0]}</text><text x="${W-10}" y="${H-4}" font-size="9" fill="#8B9099" text-anchor="end">${pts[pts.length-1][0]}</text></svg></div>`;
  }).join('');
}
function renderLeaders(){
  const el = document.getElementById('leaders');
  el.innerHTML = IDX.leaders.map(b => `<div><h3 class="lead-h"${tipAttr(`<b>${esc(b.title)}</b><br>${esc(b.note || '')}<br><span class="k">${esc(b.pool)}</span>`)}>${esc(b.title)}</h3><p class="lead-p">${esc(b.pool)}</p>${b.rows.slice(0, 10).map((r, i) => `<div class="lrow"><span class="lrk">${i + 1}</span>${r.id ? `<span class="hf">${faceHTML(r.id, r.season ? startYear(r.season) : null, r.name)}</span>` : ''}<span class="ln">${r.id ? coachLink(r.id, r.name) : esc(r.name)}${r.team ? ` <small style="color:var(--faint)">${esc(r.team)}${r.season ? ' ' + r.season : ''}</small>` : ''}</span><span class="lv">${esc(r.display)}</span></div>`).join('') || '<div class="empty">nothing to rank yet</div>'}</div>`).join('');
}

// ---------------------------------------------------------------- the coach page: opens on the current season
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
  const m = /season=([0-9-]+|career)/.exec(hash || '');
  const rotSeasons = COACH.seasons.filter(s => s.rotation);
  const cur = COACH.seasons.find(s => s.season === CUR());
  state.mode = m ? (m[1] === 'career' ? 'career' : (COACH.seasons.find(s => s.season === m[1]) ? m[1] : 'career')) : (cur ? CUR() : 'career');
  const want = state.mode === 'career' ? null : state.mode;
  const full = rotSeasons.filter(s => s.g >= 15);
  state.season = (want && rotSeasons.find(s => s.season === want)) ? want : (full.length ? full[full.length - 1].season : (rotSeasons.length ? rotSeasons[rotSeasons.length - 1].season : null));
  state.game = null; state.kind = 'RS';
  renderCoach();
  if (!m) window.scrollTo(0, 0);
  document.title = `${COACH.name} — College Basketball Coaching Savant`;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.id === id));
}
function pickSeason(season){
  const h = `c=${COACH.id}&season=${season}`;
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
function renderCoach(){
  const el = document.getElementById('coach');
  const sr = modeRow();
  const parts = [];
  parts.push(renderIdentity(sr));
  parts.push(renderControls(sr));
  parts.push(renderCareerChart());
  parts.push(`<div class="ctxrow">${panelHTML('record', 'Results and expectation', sr, true)}</div>`);
  parts.push(`<div class="panels">${panelHTML('rotation', 'Rotation and lineups', sr)}${panelHTML('management', 'Game management', sr, false, renderManagement(sr))}</div>`);
  parts.push(`<div class="col wide" id="rotation"><h2 class="col-h">The Rotation Map<span class="q">when each man plays</span></h2><p class="since">2023-24 on, the games College Savant's lineup gate passes · 40 minutes, halftime marked · the model's view, not a verdict · hover a cell for the man, the minute and the share</p><div id="rotbody"></div></div>`);
  parts.push(`<div class="col wide" id="pairs"><h2 class="col-h">Who he plays together<span class="q">and does it work</span></h2><p class="since">2023-24 on · above the diagonal: share of the row's minutes with the column; below: net together, pulled toward the team by 1,800 possessions (College Savant's pair constant) · hover a cell</p><div id="pairbody"></div></div>`);
  parts.push(`<div class="col wide" id="quad"><h2 class="col-h">Is he playing his best groups?</h2><p class="since">2023-24 on · five-man units with 10+ minutes: minutes against a projection from the five men's Savant rates · ${IDX.meta.fits.parts?.validated ? 'validated out of sample' : '<b>unvalidated</b>: out of sample it barely beat the team\'s own net'} · hover a dot</p><div id="quadbody"></div></div>`);
  parts.push(`<div class="col wide" id="mvi"><h2 class="col-h">Who he trusts<span class="q">and is he right</span></h2><p class="since">2013-14 on · minutes per game against Savant rate, with D1's fair-minutes line that season · hover a dot</p><div id="mvibody"></div></div>`);
  parts.push(renderDevelopment(sr));
  parts.push(`<div class="panels">${panelHTML('development', 'Players under him', sr)}${panelHTML('roster', 'Roster building', sr, false)}</div>`);
  parts.push(renderRosterBuilding(sr));
  parts.push(`<div class="panels">${panelHTML('tournament', 'NCAA Tournament', sr)}${panelHTML('resources', 'Resources', sr)}</div>`);
  parts.push(renderTournament(sr));
  parts.push(`<div class="col wide" id="resources"><h2 class="col-h">Did he win with money, or without it?</h2><p class="since">every D1 program-season: men's basketball spending percentile (EADA) against net above the roster model; his seasons ringed · from 2021-22 NIL and collective money is not in EADA, so read those seasons as weaker · hover a dot</p><div id="resbody"><div class="empty">loading the programs…</div></div></div>`);
  parts.push(`<div class="panels">${panelHTML('context', 'Situation by situation', sr, false, renderSplits(sr))}${panelHTML('offense', 'Offensive identity', sr, false, renderDiet(sr, 'o'))}</div>`);
  parts.push(`<div class="ctxrow">${panelHTML('defense', 'Defensive identity', sr, true, renderDiet(sr, 'd'))}</div>`);
  parts.push(renderComps(sr));
  parts.push(renderArrival());
  parts.push(renderStaff(sr));
  parts.push(`<div class="col wide" id="treecard"><h2 class="col-h">His place in the tree</h2><p class="since">drag to pan, scroll or pinch to zoom, hover a coach to light his line, click to open his page · <a href="#tree=${COACH.id}">the whole forest ↗</a></p><div class="treestage embed" id="treeEmbed"></div></div>`);
  parts.push(renderFits());
  parts.push(renderSeasons());
  parts.push(renderScouting(sr));
  el.innerHTML = parts.join('');
  wireCoach();
  loadSeason(state.season);
  loadResources(sr);
  const fb = document.querySelector('#fpplate .tab');
  document.querySelectorAll('#fpplate [data-fp]').forEach(x => x.addEventListener('click', () => drawFingerprint(x.dataset.fp, sr)));
  if (fb) drawFingerprint(fb.dataset.fp, sr); else drawFingerprint(null, sr);
  mountTree(document.getElementById('treeEmbed'), COACH.id);
  requestAnimationFrame(() => document.querySelectorAll('.fill[data-w]').forEach(f => { f.style.width = f.dataset.w + '%'; }));
}
function renderIdentity(sr){
  const c = COACH, b = c.bio, at = c.career.all_time, cs = c.career.stats;
  const bits = [];
  if (b.born) bits.push(`born ${b.born}${b.birthplace ? ', ' + esc(b.birthplace) : ''}`);
  if (b.age_first_hc) bits.push(`first D1 head job at <b>${b.age_first_hc}</b>`);
  if (b.assistant_seasons_before) bits.push(`${b.assistant_seasons_before} season${b.assistant_seasons_before === 1 ? '' : 's'} on D1 staffs before it`);
  if (b.nba) bits.push(`<a href="/basketball-coaching-savant.html#c=${encodeURIComponent(b.nba)}">his NBA page on Basketball Coaching Savant ↗</a>`);
  if (b.wiki_url) bits.push(`<a href="${esc(b.wiki_url)}" rel="noopener">Wikipedia ↗</a>`);
  const teams = [...new Set(c.stints.map(s => s.team))];
  const stat = (v, l, tip) => `<span class="st"${tip ? tipAttr(tip) : ''}><b>${v}</b> ${l}</span>`;
  const wr = cs.w_roster;
  const sl = `<div class="statline">${stat(`${at.w}–${at.l}`, 'W–L', 'Every season as a D1 head coach on record: ESPN\'s games where they exist, Wikipedia before')}${stat(at.g ? (100 * at.w / at.g).toFixed(1) + '%' : '—', 'WIN %')}${stat(at.ncaa, 'NCAA', 'NCAA Tournament appearances, 2002-03 on (ESPN\'s games, seeds checked against Wikipedia\'s brackets)')}${stat(at.f4, at.f4 === 1 ? 'FINAL FOUR' : 'FINAL FOURS', 'Final Fours, 2002-03 on')}${stat(at.titles, at.titles === 1 ? 'TITLE' : 'TITLES', 'National titles, 2002-03 on: earlier titles are not in the tournament table')}${stat(wr ? signed(wr.sum) : '—', 'ABOVE THE ROSTER', statTip('w_roster', wr ? {v: wr.v, pct: wr.pct, pool: wr.pool, n: wr.n, seasons: wr.seasons} : {}) + '<div class="def">Added up over his seasons from 2010-11: actual wins minus the wins the roster model expected from the players he had.</div>')}</div>`;
  const acc = [];
  if (at.titles) acc.push(`<span class="acco gold">${at.titles} national title${at.titles > 1 ? 's' : ''}</span>`);
  if (c.career.eligible) acc.push(`<span class="acco" title="ranked against ${IDX.meta.rules.career_pool} careers with ${IDX.meta.rules.min_career_seasons}+ seasons and ${IDX.meta.rules.min_career_games}+ games">ranked career</span>`);
  if ((c.records || []).some(r => !r.confirmed)) acc.push('<span class="acco" title="at least one season\'s head coach is not confirmed by a season-specific source; see Every season">unconfirmed rows</span>');
  if ((c.records || []).some(r => r.interim)) acc.push('<span class="acco">interim seasons</span>');
  const meta = `${teams.map(t => `<b>${esc(teamName(t))}</b>`).join(', ')}${at.first ? ` · ${at.first}–${(at.last || '').slice(0, 7)}` : ''} · ${at.seasons} season${at.seasons === 1 ? '' : 's'} as head coach${bits.length ? '<br>' + bits.join(' · ') : ''}`;
  let ch = '<div class="cmpbar">';
  if (cmp.length) {
    const yr = sr ? startYear(sr.season) : null;
    ch += `<span class="cmp-pill"><span class="hf" style="--cc:${CMP_COLORS[0]}">${faceHTML(c.id, yr, c.name)}</span>${esc(c.name)}</span>`;
    cmp.forEach((id, i) => { const nm = CMPC[id]?.name || nameOf(id); ch += `<span class="cmp-pill"><span class="hf" style="--cc:${CMP_COLORS[i + 1]}">${faceHTML(id, yr, nm)}</span>${coachLink(id, nm)}<button class="cmp-x" data-idx="${i}" aria-label="Remove">&times;</button></span>`; });
  }
  if (1 + cmp.length < 3) ch += '<button class="cmp-add" id="cmpAdd">+ Compare</button>';
  ch += '</div>';
  if (cmp.length) ch += `<div class="cmp-note">${sr ? `Each coach's ${sr.season}, where he coached it; a coach without that season shows no bar.` : 'Careers, each ranked in the career pool.'}</div>`;
  return `<div class="id" id="id"><div class="id-head"><div class="headwrap"${tipAttr(`<b>No college coach photos are used</b><br><span class="k">a badge in ${sr ? esc(teamName(sr.team)) : 'his school'}'s colours</span>`)}>${faceHTML(c.id, sr ? startYear(sr.season) : null, c.name, true)}</div>
    <div class="id-headtext"><div class="id-name">${esc(c.name)}</div><div class="id-meta">${meta}</div>${sl}${acc.length ? `<div class="accos">${acc.join('')}</div>` : ''}${ch}
    ${renderArcButton()}</div></div>${renderArcRail()}</div>`;
}
function renderControls(sr){
  const S = COACH.seasons;
  if (!S.length && !COACH.records.length) return '';
  const {peak} = arcPoints();
  const cur = CUR();
  const label = state.mode === 'career' ? 'Career' : `${state.mode}${state.mode === peak ? ' <span class="selx-star">★</span>' : ''}`;
  const opts = [`<button type="button" class="selx-opt" role="option" data-s="career" aria-selected="${state.mode === 'career'}"><span>Career</span><span class="selx-tag">${COACH.career.eligible ? 'ranked pool' : 'not ranked'}</span></button>`]
    .concat(S.slice().reverse().map(s => `<button type="button" class="selx-opt" role="option" data-s="${s.season}" aria-selected="${state.mode === s.season}"><span>${s.season}${s.season === peak ? ' <span class="selx-star">★</span>' : ''}</span><span class="selx-tag">${esc(tAbbr(s.team))}${s.season === cur ? ' · live' : ''}${s.g < IDX.meta.rules.min_season_games && s.season !== cur ? ' · ' + s.g + ' g' : ''}</span></button>`));
  const rank = state.mode === 'career' ? `the career pool, ${IDX.meta.rules.career_pool} coaches` : (sr && liveMode(sr) ? `this season's coaches with ${IDX.meta.rules.min_live_games}+ games, provisional` : `${state.mode}'s D1 head coaches with ${IDX.meta.rules.min_season_games}+ games`);
  return `<div class="controls"><div class="ctl"><span class="ctl-lab">Season</span><div class="selx" id="selx"><button type="button" class="selx-btn" id="selxBtn" aria-haspopup="listbox" aria-expanded="false"><span>${label}</span><span class="selx-caret" aria-hidden="true">▾</span></button><div class="selx-pop" id="selxPop" role="listbox" hidden>${opts.join('')}</div></div></div>
    <div class="ctl"><span class="ctl-lab">Ranked against</span><span style="font-family:var(--mono);font-size:12px">${rank}</span></div>
    <div class="legend"><div class="legbox"><div class="legbar"></div><div class="ends"><span>poor</span><span>elite</span></div></div><div class="leg"><span class="goldswatch"></span>a tendency</div><div class="leg"><span class="hatchswatch"></span>under its settle point</div></div></div>`;
}
function panelHTML(group, title, sr, wide, extra){
  const cs = cardRows(sr), entries = cmp.length ? cmpEntries(sr) : null;
  const all = IDX.stats.filter(s => s.group === group && (cs[s.key] || (entries && entries.some(e => e.rows[s.key]))));
  const head = HEADLINE[group] || [], top = all.filter(s => head.includes(s.key)).sort((a, b) => head.indexOf(a.key) - head.indexOf(b.key)), more = all.filter(s => !head.includes(s.key));
  const row = s => entries ? cmpRowHTML(s, entries, sr) : rowHTML(s, cs[s.key], sr);
  const none = !all.length;
  const since = Math.min(...IDX.stats.filter(s => s.group === group).map(s => +s.first.slice(0, 4)).filter(Boolean));
  return `<div class="col${wide ? ' wide' : ''}" data-group="${group}"><h2 class="col-h">${title}<span class="q">${GQ[group] || ''}</span></h2>${none ? `<div class="empty">${sr ? `nothing for ${sr.season}${+sr.season.slice(0, 4) < since ? ` (this group begins in ${since}-${String(since + 1).slice(2)})` : ''}` : (COACH.career.eligible ? 'nothing in this group' : `career stats are ranked only for head coaches with ${IDX.meta.rules.min_career_seasons}+ seasons and ${IDX.meta.rules.min_career_games}+ games from ${IDX.meta.rules.stats_from}; pick a season above`)}</div>` : `<p class="since">${isFinite(since) ? `from ${since}-${String(since + 1).slice(2)}` : ''}${sr ? ` · ${sr.season} ${esc(tAbbr(sr.team))}, ${sr.g} games` : ' · career, games-weighted'}${sr && !sr.ranked && !liveMode(sr) ? ' · under the line, shown without percentiles' : ''}</p>${top.map(row).join('')}`}
    ${(more.length || extra) ? `<div class="xmore"><button type="button" class="xmore-btn" aria-expanded="false"><span class="xmore-lab">More ${esc(title.toLowerCase())}</span>${more.length ? `<span class="xmore-n">${more.length} stat${more.length === 1 ? '' : 's'}</span>` : ''}${extra ? '<span class="xmore-n">detail</span>' : ''}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg></button><div class="xmore-body">${more.map(row).join('')}${extra || ''}</div></div>` : ''}</div>`;
}

// ---------------------------------------------------------------- the career arc and the verdict strip
function careerRows(){
  const rows = [];
  for (const r of COACH.records) {
    const s = COACH.seasons.find(x => x.season === r.season && x.team === r.team);
    const tier = r.seed ? (ROUND_TIER[r.ncaa] || 1) : 0;
    rows.push({season: r.season, team: r.team, g: (r.w || 0) + (r.l || 0), w: r.w || 0, l: r.l || 0, net: s?.net, pct: s?.pct || {}, exp: s?.exp || {}, tier, title: r.ncaa === 'CH', seed: r.seed, ncaa: r.ncaa, has: !!s, interim: r.interim, confirmed: r.confirmed});
  }
  rows.sort((a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team));
  return rows;
}
function peakOf(rows){
  let best = null;
  for (const r of rows) {
    if (!r.g) continue;
    const key = [r.tier || 0, r.w / r.g, r.net ?? -99];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = {r, key};
  }
  return best?.r || null;
}
function arcPoints(){
  const rows = careerRows(), peak = peakOf(rows);
  const wp = r => r.g ? r.w / r.g : 0;
  const vals = rows.filter(r => r.g).map(wp), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo;
  return {pts: rows.map(r => ({s: r.season, team: r.team, w: r.w, l: r.l, h: span > 0 ? (wp(r) - lo) / span : 1, has: r.has, tier: r.tier, title: r.title, ncaa: r.ncaa})), peak: peak ? peak.season : null};
}
function renderArcRail(){
  if (!state.arcOpen) return '<div class="arcrail" id="arcrail" hidden></div>';
  const {pts, peak} = arcPoints();
  if (!pts.length) return '';
  const cur = state.mode;
  const bars = pts.map(p => {
    const on = p.s === cur, isPk = p.s === peak;
    const h = 14 + 86 * p.h, bg = isPk ? 'var(--gold)' : (p.has ? teamColor(p.team) : 'var(--track)');
    const t = `${p.s} ${teamName(p.team)} · ${p.w}–${p.l}${p.ncaa ? ' · NCAA: ' + (ROUND_L[p.ncaa] || p.ncaa) : ''}${isPk ? ' · peak' : ''}${p.has ? '' : ' · record only'}`;
    return `<button type="button" class="arc-col${on ? ' on' : ''}" data-s="${p.s}" data-has="${p.has ? 1 : 0}"${tipAttr(esc(t) + (p.has ? '<br><span class="k">click to view this season</span>' : ''))} aria-label="${esc(t)}">${isPk ? '<span class="arc-star" aria-hidden="true">★</span>' : ''}<span class="arc-bar" style="height:${h.toFixed(1)}%;background:${bg};opacity:${p.has ? 1 : .55}"></span></button>`;
  }).join('');
  return `<div class="arcrail" id="arcrail" style="max-width:${pts.length * 48 + 96}px"><div class="arc-h">Career arc<span>win %, against his own range · school colours · grey: record only</span></div><div class="arc-ticks">${bars}</div><div class="arc-foot"><span>${pts[0].s}</span>${peak ? `<span class="arc-pklab">★ peak ${peak}</span>` : ''}<span>${pts[pts.length - 1].s}</span></div></div>`;
}
function seasonTipHTML(r){
  const e = r.exp || {}, p = r.pct || {};
  const ex = !miss(e.exp_w) && r.g ? 100 * e.exp_w / r.g : null;
  const lines = [`<b>${r.season} ${esc(teamName(r.team))}</b>${r.interim ? ' <span class="k">interim</span>' : ''}${r.confirmed === false ? ' <span class="k">unconfirmed</span>' : ''}`, `${r.w}–${r.l} (${r.g ? (100 * r.w / r.g).toFixed(1) : '—'}%) · ${r.seed ? `NCAA ${r.seed} seed, ${ROUND_L[r.ncaa] || r.ncaa}` : 'no NCAA Tournament'}`];
  if (!miss(r.net)) lines.push(`adjusted net ${signed(r.net)} ${miss(p.net) ? '' : pbox(p.net) + '<span class="k">among that season\'s coaches</span>'}`);
  if (!miss(ex)) lines.push(`the roster model expected ${e.exp_w.toFixed(1)} wins (${ex.toFixed(1)}%) → <b>${signed(e.w_roster)}</b> above the roster${miss(p.w_roster) ? '' : ' ' + pbox(p.w_roster)}`);
  if (e.ap_pre || e.ap_final) lines.push(`<span class="k">AP: preseason ${e.ap_pre ? '#' + e.ap_pre : 'unranked'}, peak ${e.ap_peak ? '#' + e.ap_peak : '—'}, final ${e.ap_final ? '#' + e.ap_final : '—'} (context, never the baseline)</span>`);
  lines.push(r.has ? '<span class="k">click to open the season</span>' : '<span class="k">record only: the game-level data begins in 2009-10</span>');
  return lines.join('<br>');
}
// the verdict strip: wins as bars (win %), the roster model's expected win % as a tick, the preseason AP rank as a dot
function renderCareerChart(){
  const rows = careerRows();
  if (!rows.length) return '';
  const peak = peakOf(rows);
  const n = rows.length, W = CW(), narrow = W < 600, left = narrow ? 34 : 44, right = 12, bw = (W - left - right) / n, barw = Math.max(2, Math.min(30, bw * .72));
  const TOP = 34, HW = 140, GAP = 10, SUB = 30;
  const hasNet = rows.some(r => !miss(r.net)), hasR = rows.some(r => !miss(r.exp?.w_roster));
  const subs = [hasNet && ['net', 'adjusted net', r => r.net], hasR && ['w_roster', 'wins above the roster', r => r.exp?.w_roster]].filter(Boolean);
  const H = TOP + HW + subs.length * (SUB + GAP) + 26;
  const x = i => left + i * bw + (bw - barw) / 2;
  const yw = v => TOP + HW * (1 - Math.max(0, Math.min(1, v)));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="career, season by season">`;
  for (const g of [.25, .5, .75, 1]) svg += `<line x1="${left}" x2="${W - right}" y1="${yw(g)}" y2="${yw(g)}" stroke="${g === .5 ? '#C4C0B6' : '#E4E1D9'}"/><text x="${left - 6}" y="${yw(g) + 3}" font-size="9" text-anchor="end" fill="#8A95A3">${Math.round(100 * g)}%</text>`;
  svg += `<text x="2" y="${TOP - 14}" font-size="9" fill="#8A95A3">${narrow ? 'NCAA' : 'NCAA rounds'}</text><text transform="translate(10 ${TOP + HW / 2}) rotate(-90)" font-size="9" text-anchor="middle" fill="#8A95A3">win %</text>`;
  rows.forEach((r, i) => {
    const wp = r.g ? r.w / r.g : 0, X = x(i), isPeak = r === peak, on = state.mode === r.season;
    svg += `<g${r.has ? ` data-pick="${r.season}" class="hit"` : ''}${tipAttr(seasonTipHTML(r))}>`;
    svg += `<rect x="${X - (bw - barw) / 2}" y="${TOP - 18}" width="${bw}" height="${H - TOP + 18}" fill="${on ? '#F1EBDD' : 'transparent'}"/>`;
    svg += `<rect x="${X}" y="${yw(wp)}" width="${barw}" height="${yw(0) - yw(wp)}" fill="${teamColor(r.team)}" opacity="${r.has ? .92 : .5}" rx="1.5"${isPeak ? ' stroke="#C2A263" stroke-width="2.5"' : ''}/>`;
    if (!miss(r.exp?.exp_w) && r.g) svg += `<line x1="${X - 2}" x2="${X + barw + 2}" y1="${yw(r.exp.exp_w / r.g)}" y2="${yw(r.exp.exp_w / r.g)}" stroke="#1A2332" stroke-width="1.8"/>`;
    if (r.exp?.ap_pre) svg += `<circle cx="${X + barw / 2}" cy="${yw(1 - (r.exp.ap_pre - 1) / 50)}" r="2.6" fill="#BC3A2C"/>`;
    const cx = X + barw / 2;
    if (r.title) svg += `<text x="${cx}" y="${TOP - 6}" font-size="14" text-anchor="middle" fill="#C2A263">★</text>`;
    else if (r.tier > 0) for (let k = 0; k < r.tier; k++) svg += `<rect x="${cx - 4}" y="${TOP - 7 - k * 3.4}" width="8" height="2.6" fill="${k === r.tier - 1 ? '#8A95A3' : '#22395A'}"/>`;
    if (isPeak) svg += `<text x="${cx}" y="${TOP - 28}" font-size="8.5" text-anchor="middle" fill="#C2A263" letter-spacing=".06em">PEAK</text>`;
    subs.forEach(([key, label, get], j) => {
      const v = get(r), y0 = TOP + HW + GAP + j * (SUB + GAP), mid = y0 + SUB / 2, sc = key === 'net' ? SUB / 2 / 25 : SUB / 2 / 8;
      if (miss(v)) return;
      const h = Math.min(SUB / 2, Math.abs(v) * sc);
      svg += `<rect x="${X}" y="${v >= 0 ? mid - h : mid}" width="${barw}" height="${Math.max(h, .8)}" fill="${v >= 0 ? '#BC3A2C' : '#1C4E86'}" opacity=".85"/>`;
    });
    svg += '</g>';
  });
  subs.forEach(([key, label], j) => { const y0 = TOP + HW + GAP + j * (SUB + GAP); svg += `<line x1="${left}" x2="${W - right}" y1="${y0 + SUB / 2}" y2="${y0 + SUB / 2}" stroke="#D9D6CF"/><text x="${left}" y="${y0 + 8}" font-size="9" fill="#8A95A3"${tipAttr(statTip(key))}>${label}</text>`; });
  const step = Math.max(1, Math.ceil(n / (narrow ? 6 : 14)));
  for (let i = 0; i < n; i += step) svg += `<text x="${x(i) + barw / 2}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#8A95A3">${rows[i].season.slice(2, 4)}-${rows[i].season.slice(5)}</text>`;
  svg += '</svg>';
  return `<div class="col wide" id="career"><h2 class="col-h">The career, season by season<span class="q">the verdict strip</span></h2><p class="since">win % as bars in his school's colours · <b>black tick</b>: the roster model's expected win % · <span style="color:#BC3A2C">●</span> the preseason AP rank (top of the bar = No. 1, context only) · notches above: NCAA rounds reached, ★ a title · peak: March first, then the regular season · hover a season; click to open it</p>${svg}</div>`;
}

// ---------------------------------------------------------------- the Rotation Map (40 minutes, halves)
function renderRotation(srow){
  const t = TFILE, rb = document.getElementById('rotbody');
  const view = t.rotation;
  if (!view) { rb.innerHTML = '<div class="empty">no lineup games for this season</div>'; return; }
  const rows = view.rows, rot = srow.rotation || {}, bc = rot.by_cause || view.by_cause || {};
  const P = seasonPct(srow), pools = seasonPools(srow);
  const tile = (key, label, value, sub) => `<div class="tile"${tipAttr(key && STATS[key] ? statTip(key, {v: srow.values?.[key]?.[0], pct: P[key], pool: pools[key], n: srow.values?.[key]?.[1], season: srow.season}) : `<b>${esc(label)}</b><br>${esc(sub)}`)}><div class="tl">${label}</div><div class="tv">${value}${key && !miss(P[key]) ? `<span class="pb" style="background:${STATS[key]?.kind === 'good' ? gradeColor(P[key]) : '#C2A263'}">${P[key]}</span>` : ''}</div><div class="ts">${sub}</div></div>`;
  rb.innerHTML = seasonTabs(`<span style="flex:1"></span><button class="tab${state.base === 'played' ? ' on' : ''}" data-base="played">games he played</button><button class="tab${state.base === 'all' ? ' on' : ''}" data-base="all">all games</button>`) +
    `<div class="tiles" style="margin-bottom:12px">
      ${tile('stability', 'On script', miss(view.off_script) ? '—' : (100 * (1 - view.off_script)).toFixed(1) + '%', 'share of scripted minutes that went as usual')}
      ${tile('chosen_dev', 'Chosen deviation', pc1(bc.choice), 'off script with no absence, blowout or foul trouble')}
      ${tile('after_loss', 'After a loss vs a win', miss(rot.after_loss) || miss(rot.after_win) ? '—' : signed(100 * (rot.after_loss - rot.after_win)), 'points more off script after a loss')}
      ${tile('first_sub', 'First substitution', miss(view.shape?.first_sub) ? '—' : view.shape.first_sub.toFixed(1), 'minutes into the game')}
      ${tile('stagger2', 'Staggers his top two', miss(view.shape?.stagger2) ? '—' : pc1(view.shape.stagger2), 'exactly one of the two on the floor')}
      ${tile('closes_best', 'Closing five gap', miss(view.closing?.gap) ? '—' : view.closing.gap.toFixed(2), `Savant rate below the best five available, ${view.closing?.gap_n ?? 0} close games`)}
    </div>
    <div class="rot"><div class="rotnames">${rows.map(r => `<div class="rotname"${tipAttr(`<b>${playerLink(r.id, r.name, srow.season)}</b> <span class="k">${r.mpg} mpg, ${r.gp} games${r.starts ? `, ${r.starts} starts` : ''}${r.rate != null ? `, Savant rate ${signed(r.rate)}` : ''}</span><br>${esc(r.text)}<br><span class="k">off his script ${pc1(r.off)} of his minutes, ${pc1(r.off_choice)} by choice</span>`)}>${playerLink(r.id, r.name, srow.season)} <small>${r.mpg}</small></div>`).join('')}</div>
      <div class="rotwrap">${axisHTML()}<canvas class="map" id="rotmap"></canvas><div class="rotmin"><span>tip-off</span><span>10</span><span>half</span><span>30</span><span>40 min</span></div></div></div>
    <div class="legend2"><span><span class="sw" style="background:#22395A"></span>never on</span><span><span class="sw" style="background:#C2A263"></span>always on</span><span>white outline: his usual windows (60%+ of the games he played, minutes still in the balance)</span><span>thick line: halftime</span><span>red marks: the selected game's minutes</span><span>${rows.length} men with 60+ minutes · ${view.games} lineup games</span></div>
    <h3 class="sub">Game by game: how far he went off script, and why</h3>
    <p class="since">each bar is one game; height is the share of that game's scripted player-minutes that went off script · hover a game for who was missing and who moved; click it to lay the game over the map</p>
    <div class="tabs"><button class="tab${!state.allCauses ? ' on' : ''}" data-causes="choice">the coach's choice only</button><button class="tab${state.allCauses ? ' on' : ''}" data-causes="all">add absence, blowout and foul trouble</button></div>
    <div id="gchart">${offScriptChart(view, rows)}</div>
    <div class="legend2">${(state.allCauses ? CAUSES : ['choice']).map(c => `<span><span class="sw" style="background:${CAUSE_C[c]}"></span>${CAUSE_L[c]}: ${pc1(bc[c])} of the season's scripted minutes</span>`).join('')}${!miss(rot.overtime_min) && rot.overtime_min > 0 ? `<span>overtime, unscripted: ${rot.overtime_min.toFixed(1)} min a game</span>` : ''}</div>
    <div class="ginfo small" id="ginfo" style="margin-top:6px">${state.game !== null && view.game_rows[state.game] ? gameLine(view.game_rows[state.game], rows) : 'no game selected'}</div>
    ${view.months && Object.keys(view.months).length ? `<h3 class="sub">How it evolved, month by month</h3><p class="since">the same map, games he played in each month · hover a cell</p><div class="months">${Object.keys(view.months).map(mo => `<div class="month"><h4>${mo}</h4>${axisHTML()}<canvas class="map" data-month="${mo}"></canvas></div>`).join('')}</div>` : ''}`;
  const main = document.getElementById('rotmap');
  drawMap(main, rows, state.base, true, state.game !== null ? view.game_rows[state.game] : null);
  wireMapHover(main, rows, state.base, null);
  rb.querySelectorAll('canvas[data-month]').forEach(cv => {
    const map = view.months[cv.dataset.month];
    const mrows = rows.filter(r => map[r.id]).map(r => ({...r, played: map[r.id], all: map[r.id], windows: []}));
    drawMap(cv, mrows, 'played', false, null, 9);
    wireMapHover(cv, mrows, 'played', cv.dataset.month);
  });
  rb.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => { state.base = b.dataset.base; renderRotation(srow); }));
  rb.querySelectorAll('[data-causes]').forEach(b => b.addEventListener('click', () => { state.allCauses = b.dataset.causes === 'all'; renderRotation(srow); }));
  wireSeasonTabs(rb);
  rb.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.g; state.game = state.game === i ? null : i; hideTip(); renderRotation(srow); }));
}
async function loadSeason(season){
  const rb = document.getElementById('rotbody'), pb = document.getElementById('pairbody'), qb = document.getElementById('quadbody'), mb = document.getElementById('mvibody');
  if (!rb) return;
  const want = state.mode !== 'career' ? state.mode : season;
  const srow = COACH.seasons.find(s => s.season === season && s.rotation) || COACH.seasons.find(s => s.season === want);
  const anyT = COACH.seasons.find(s => s.season === want) || srow;
  const why = state.mode !== 'career' && !COACH.seasons.find(s => s.season === state.mode && s.rotation) ? `no lineup data for ${state.mode} (College Savant's lineups begin in 2023-24)${srow && srow.season !== state.mode ? `; showing ${srow.season}` : ''}` : null;
  if (!anyT) { for (const el of [rb, pb, qb, mb]) el.innerHTML = '<div class="empty">no season with games for him</div>'; return; }
  const row = srow || anyT;
  const key = `${row.team}-${row.season}`;
  rb.innerHTML = '<div class="empty">loading the season…</div>';
  try {
    const file = TCACHE[key] || (TCACHE[key] = await fetchJSON(`${BASE}/t/${key}.json`));
    const entry = (file.coaches || []).find(e => e.coach === COACH.id);
    if (!entry) throw new Error('no entry');
    TFILE = {...entry, names: file.names, fair: file.fair, parts: file.parts, season: file.season, team: file.team, why};
  } catch (e) {
    TFILE = {names: {}, why};
    const msg = `<div class="empty">${why || `no lineup data for ${row.season}`}</div>`;
    rb.innerHTML = msg; pb.innerHTML = msg; qb.innerHTML = msg; mb.innerHTML = msg; return;
  }
  if (TFILE.rotation) renderRotation(row); else rb.innerHTML = `<div class="empty">${why || `no lineup data for ${row.season} (College Savant's lineups begin in 2023-24)`}</div>`;
  if (TFILE.matrix) renderPairs(row); else pb.innerHTML = `<div class="empty">no lineup data for ${row.season}</div>`;
  if (TFILE.units5) renderQuadrant(row); else qb.innerHTML = `<div class="empty">no lineup data for ${row.season}</div>`;
  renderMVI(row);
}
function renderPairs(srow){
  const t = TFILE, pb = document.getElementById('pairbody');
  const men = (t.men || []).slice(0, 12); if (men.length < 2) { pb.innerHTML = seasonTabs() + '<div class="empty">not enough men with 60 minutes</div>'; wireSeasonTabs(pb); return; }
  const pair = {}; for (const [a, b, min, est, raw, poss] of t.matrix) { pair[a + '|' + b] = pair[b + '|' + a] = {min, est, raw, poss}; }
  const name = p => last(pname(p));
  const minOf = p => t.onoff?.[p]?.on?.min || 1;
  const vals = t.matrix.map(x => x[3]).filter(v => !miss(v)); const lo = Math.min(...vals, -5), hi = Math.max(...vals, 5);
  let html = '<div class="scroll"><table class="matrix"><thead><tr><th></th>' + men.map(p => `<th>${esc(name(p))}</th>`).join('') + '</tr></thead><tbody>';
  men.forEach((a, i) => {
    html += `<tr><th>${playerLink(a, name(a), srow.season)}</th>`;
    men.forEach((b, j) => {
      if (i === j) { html += '<td class="d"></td>'; return; }
      const x = pair[a + '|' + b];
      if (!x) { html += '<td class="d" style="background:#F7F6F2"></td>'; return; }
      if (j > i) { const sh = Math.min(1, x.min / minOf(a)); html += `<td class="c" style="background:${mix('#ECEBE8', '#22395A', sh)};color:${sh > .5 ? '#fff' : '#1A2332'}"${tipAttr(`<b>${esc(pname(a))}</b> with <b>${esc(pname(b))}</b><br>${Math.round(x.min)} minutes together, <b>${(100 * sh).toFixed(0)}%</b> of ${esc(name(a))}'s minutes`)}>${(100 * sh).toFixed(0)}</td>`; }
      else { const v = x.est; const tt = miss(v) ? .5 : (v - lo) / (hi - lo); html += `<td class="c" style="background:${miss(v) ? '#E4E1D9' : (tt < .5 ? mix('#1C4E86', '#E4E1D9', tt * 2) : mix('#E4E1D9', '#BC3A2C', (tt - .5) * 2))};color:${Math.abs(tt - .5) > .3 ? '#fff' : '#1A2332'}"${tipAttr(`<b>${esc(pname(a))}</b> + <b>${esc(pname(b))}</b><br>net <b>${signed(x.est)}</b> sample-adjusted (raw ${signed(x.raw)})<br><span class="k">${x.poss.toLocaleString()} possessions, ${Math.round(x.min)} minutes · pulled toward the team's ${signed(t.team_rates?.adj)} by 1,800 possessions</span>`)}>${miss(v) ? '' : signed(v, 0)}</td>`; }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  pb.innerHTML = seasonTabs() + html;
  wireSeasonTabs(pb);
}
function renderQuadrant(srow){
  const t = TFILE, qb = document.getElementById('quadbody');
  const units = (t.units5 || []).filter(u => !miss(u.proj));
  if (!units.length) { qb.innerHTML = seasonTabs() + '<div class="empty">no projections for this season (a man without a Savant rate has no number)</div>'; wireSeasonTabs(qb); return; }
  const name = p => last(pname(p));
  const W = CW(760) > 660 ? 560 : CW(760), H = W < 600 ? 320 : 380, mins = units.map(u => u.min), projs = units.map(u => u.proj);
  const xmax = Math.max(...mins) * 1.05, ylo = Math.min(...projs) - 2, yhi = Math.max(...projs) + 2;
  const x = v => 50 + (W - 70) * v / xmax, y = v => 20 + (H - 60) * (1 - (v - ylo) / (yhi - ylo));
  const midm = Math.max(40, (Math.max(...mins) + 10) / 3), midp = units.reduce((s, u) => s + u.proj * u.min, 0) / units.reduce((s, u) => s + u.min, 0);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${x(midm)}" x2="${x(midm)}" y1="20" y2="${H-40}" stroke="#D9D6CF" stroke-dasharray="4 3"/><line x1="50" x2="${W-20}" y1="${y(midp)}" y2="${y(midp)}" stroke="#D9D6CF" stroke-dasharray="4 3"/>`;
  const lab = (tx, ty, s, anchor) => `<text x="${tx}" y="${ty}" font-size="10" fill="#8A95A3" text-anchor="${anchor}">${s}</text>`;
  svg += lab(W - 22, 32, 'rode it, the parts like it', 'end') + lab(W - 22, H - 46, 'rode it, the parts say no', 'end') + lab(54, 32, 'left on the table', 'start') + lab(54, H - 46, 'rightly benched', 'start');
  for (const u of units) {
    const r = 3 + Math.sqrt(u.poss) / 5;
    const tip = `<b>${u.ids.map(p => esc(name(p))).join(' · ')}</b><br>${Math.round(u.min)} minutes, ${u.poss.toLocaleString()} possessions<br>projected <b>${signed(u.proj)}</b> from the parts (mean Savant rate ${signed(u.sum_rate)})<br>played <b>${signed(u.adj)}</b> sample-adjusted (raw ${signed(u.net)})<br><span class="k">${IDX.meta.fits.parts?.validated ? '' : 'the projection is unvalidated'}</span>`;
    svg += `<circle class="hit" cx="${x(u.min)}" cy="${y(u.proj)}" r="${r}" fill="${u.adj > u.proj ? '#BC3A2C' : '#22395A'}" opacity=".7"${tipAttr(tip)}></circle>`;
  }
  svg += lab(W / 2, H - 8, 'minutes together', 'middle') + `<text transform="translate(14 ${H/2}) rotate(-90)" font-size="10" fill="#8A95A3" text-anchor="middle">projected net, from the parts</text></svg>`;
  const left = units.filter(u => u.min < midm && u.proj > midp).sort((a, b) => b.proj - a.proj).slice(0, 5);
  const rode = units.filter(u => u.min >= midm && u.proj < midp).sort((a, b) => b.min - a.min).slice(0, 5);
  const list = (arr, title) => `<div><h4 style="margin:0 0 4px;font-family:var(--mono);font-size:10.5px;color:var(--faint);text-transform:uppercase">${title}</h4>${arr.map(u => `<div class="small">${u.ids.map(p => playerLink(p, name(p), srow.season)).join(', ')} — ${Math.round(u.min)} min, projected ${signed(u.proj)}, played ${signed(u.adj)}</div>`).join('') || '<div class="empty">none</div>'}</div>`;
  const lt = srow.values?.left_table?.[0];
  qb.innerHTML = seasonTabs() + `<div class="grid2"><div>${svg}</div><div>${list(left, 'Projected strong, barely played')}<br>${list(rode, 'Kept riding, the parts say no')}<div class="small" style="margin-top:10px"${tipAttr(statTip('left_table', {v: lt, pct: seasonPct(srow).left_table, pool: seasonPools(srow).left_table, season: srow.season}))}>Lineups left on the table: <b>${miss(lt) ? '—' : lt.toFixed(1)}</b> minutes a game. Red: played better than projected; navy: worse. ${IDX.meta.fits.parts?.validated ? '' : '<b>Unvalidated</b>: out of sample the projection barely beat the team\'s own net, so read this as a description, not a judgment. '}${esc(IDX.meta.model_note)}</div></div></div>`;
  wireSeasonTabs(qb);
}
function renderMVI(srow){
  const t = TFILE, mb = document.getElementById('mvibody');
  const pl = (t.mvi?.players || []).filter(p => !miss(p.rate));
  if (!pl.length) { mb.innerHTML = seasonTabs() + '<div class="empty">no Savant rates for this season</div>'; wireSeasonTabs(mb); return; }
  const W = CW(760), H = W < 600 ? 300 : 340, xs = pl.map(p => p.rate), xlo = Math.min(-10, ...xs) - 1, xhi = Math.max(10, ...xs) + 1;
  const x = v => 50 + (W - 70) * (v - xlo) / (xhi - xlo), y = v => 20 + (H - 60) * (1 - v / 40);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  if (t.fair) { const pts = t.fair.filter(([b]) => b >= xlo && b <= xhi); if (pts.length) { const d = pts.map(([b, m], i) => `${i ? 'L' : 'M'}${x(b)},${y(m)}`).join(' '); svg += `<path d="${d}" fill="none" stroke="#C2A263" stroke-width="2" stroke-dasharray="5 3"${tipAttr(`<b>Fair minutes, D1 ${srow.season}</b><br>mean minutes per game at each whole point of Savant rate over players with 10+ games, made monotone`)}/>`; } }
  for (const g of [10, 20, 30]) svg += `<line x1="50" x2="${W-20}" y1="${y(g)}" y2="${y(g)}" stroke="#ECEBE8"/><text x="44" y="${y(g)+3}" font-size="9" text-anchor="end" fill="#8A95A3">${g}</text>`;
  svg += `<line x1="${x(0)}" x2="${x(0)}" y1="20" y2="${H-40}" stroke="#ECEBE8"/>`;
  for (const p of pl) {
    const col = SRC_C[p.src] || '#22395A', r = 3 + Math.sqrt(p.gp) / 2;
    const tip = `<b>${playerLink(p.id, p.name, srow.season)}</b><br>${p.mpg} minutes a game over ${p.gp} games · Savant rate ${signed(p.rate)}<br><span class="k">${esc(p.cls || '')} · ${SRC_L[p.src] || p.src}</span>`;
    svg += `<circle class="hit" cx="${x(p.rate)}" cy="${y(p.mpg)}" r="${r}" fill="${col}" opacity=".78"${tipAttr(tip)}></circle>`;
    if (p.mpg >= 22) svg += svgPlayer(p.id, x(p.rate) + r + 2, y(p.mpg) + 3, last(p.name), 'font-size="9.5" fill="#5B6878" font-family="IBM Plex Sans"');
  }
  svg += `<text x="${W/2}" y="${H-8}" font-size="10" fill="#8A95A3" text-anchor="middle">Savant rate (points per 100 over his possessions)</text><text transform="translate(14 ${H/2}) rotate(-90)" font-size="10" fill="#8A95A3" text-anchor="middle">minutes per game</text></svg>`;
  const ov = srow.values?.overplay?.[0];
  mb.innerHTML = seasonTabs() + svg + `<div class="legend2">${Object.entries(SRC_L).map(([k, l]) => `<span><span class="sw" style="background:${SRC_C[k]};border-radius:50%"></span>${l}</span>`).join('')}<span>dot size: games</span><span${tipAttr(statTip('overplay', {v: ov, pct: seasonPct(srow).overplay, pool: seasonPools(srow).overplay, season: srow.season}))}>overplayed minutes above the fair line: ${miss(ov) ? '—' : ov.toFixed(1)} a game${seasonPct(srow).overplay ? ` (${ord(seasonPct(srow).overplay)} percentile, lower is better)` : ''}</span></div>`;
  wireSeasonTabs(mb);
}

// ---------------------------------------------------------------- game management
function renderManagement(sr){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.management);
  if (!S.length) return `<div class="col wide"><div class="empty">${sr ? `no play-by-play for ${sr.season} (game management begins in 2013-14)` : 'no play-by-play seasons for him'}</div></div>`;
  const cs = cardRows(sr);
  const tile = key => { const s = STATS[key], v = cs[key]; if (!s) return ''; return `<div class="tile"${tipAttr(statTip(key, v ? {v: v.v, pct: v.pct, pool: v.pool, n: v.n, seasons: v.seasons, season: sr?.season} : {}))}><div class="tl">${esc(s.label)}</div><div class="tv">${v ? fmt(s.unit, v.v) : '—'}${v && !miss(v.pct) ? `<span class="pb" style="background:${s.kind === 'good' ? gradeColor(v.pct) : '#C2A263'}">${v.pct}</span>` : ''}</div><div class="ts">${v && !miss(v.pct) ? `${ord(v.pct)} pct of ${v.pool}` : v ? 'not ranked' : 'no value'}${v && v.n < s.thr ? ' · small sample' : ''}</div></div>`; };
  const ch = S.reduce((a, s) => { a.n += s.management.challenges?.n || 0; a.won += s.management.challenges?.won || 0; return a; }, {n: 0, won: 0});
  const half = S.filter(s => !miss(s.management.halftime));
  return `<div class="col wide"><h3 class="sub">Timeouts, challenges and halftime</h3><p class="since">team-called timeouts only (TV timeouts are not his) · 2013-14 on · challenges 2025-26 on · ${sr ? sr.season : 'career'}</p>
    <div class="tiles">${['to_g', 'to_run', 'to_media', 'unused', 'run_stop', 'ato', 'ato_vs', 'ato_late', 'ato_d', 'halftime', 'two41', 'eoh', 'foul_up3', 'chase', 'clutch_net', 'ch_g', 'ch_success'].map(tile).join('')}</div>
    <div class="grid2" style="margin-top:14px"><div><h3 class="lead-h">Challenges</h3><p class="lead-p">men's coach's challenge, 2025-26 on: the team must have a timeout; overturned, it keeps it</p>${ch.n ? `<div class="small">${ch.n} challenge${ch.n === 1 ? '' : 's'}: ${ch.won} overturned, ${ch.n - ch.won} stood. The result is the play's own parenthetical ("Overturned" or "Upheld"): in 2025-26 ESPN's type id and its timeout clause each contradicted it on part of the season, and the rule (a second challenge only after a win) sided with the parenthetical.</div>` : '<div class="empty">none in his seasons</div>'}</div>
    <div><h3 class="lead-h">Halftime: does his team come out better?</h3><p class="lead-p">second-half net minus first-half net, per season</p>${half.map(s => { const v = s.management.halftime; return `<div class="srl"${tipAttr(`<b>${s.season} ${esc(teamName(s.team))}</b><br>second-half net minus first-half net: <b>${signed(v)}</b> per game<br><span class="k">each game's opponent is on both sides of the difference</span>`)}><span>${s.season} ${esc(tAbbr(s.team))}</span><span class="sb"><i style="left:${v >= 0 ? 50 : 50 - Math.min(50, Math.abs(v) * 3)}%;width:${Math.min(50, Math.abs(v) * 3)}%;background:${v >= 0 ? '#BC3A2C' : '#1C4E86'}"></i><b style="left:50%"></b></span><span class="sn">${signed(v)}</span></div>`; }).join('') || '<div class="empty">—</div>'}</div></div></div>`;
}

// ---------------------------------------------------------------- context splits
const SPLIT_LABELS = {venue: 'home, road, neutral', tier: 'opponent, as of that night', conf: 'conference play', phase: 'season phase', strength: 'rotation players missing'};
const ORDER = {venue: ['home', 'road', 'neutral'], tier: ['top50', '51-150', '151+'], conf: ['conf', 'nonconf'], phase: ['nov_dec', 'jan_feb', 'march'], strength: ['full', 'missing']};
const BUCKET_L = {home: 'home', road: 'road', neutral: 'neutral', top50: 'top 50', '51-150': '51 to 150', '151+': '151 and below', conf: 'conference', nonconf: 'non-conference', nov_dec: 'Nov–Dec', jan_feb: 'Jan–Feb', march: 'March', full: 'full strength', missing: 'missing a regular'};
function renderSplits(sr){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.splits && Object.keys(s.splits).length && s.g >= 10);
  if (!S.length) return sr ? `<div class="col wide"><div class="empty">${sr.season}: fewer than 10 games, or no splits yet</div></div>` : '';
  const agg = {};
  for (const s of S) {
    const all = Object.values(s.splits).filter(v => v.net != null), tot = {};
    for (const [k, v] of Object.entries(s.splits)) { const [split, b] = k.split(':'); if (v.net == null) continue; const T = tot[split] = tot[split] || [0, 0]; T[0] += v.net * v.g; T[1] += v.g; }
    for (const [k, v] of Object.entries(s.splits)) {
      const [split, b] = k.split(':'); if (v.net == null || !tot[split]) continue;
      const base = tot[split][0] / tot[split][1];
      const a = (agg[split] = agg[split] || {}), x = (a[b] = a[b] || {g: 0, w: 0, gap: 0, pace: 0});
      x.g += v.g; x.w += v.w; x.gap += (v.net - base) * v.g; x.pace += (v.pace || 0) * v.g;
    }
  }
  const panels = Object.entries(agg).map(([split, buckets]) => {
    const rows = (ORDER[split] || Object.keys(buckets)).filter(b => buckets[b]).map(b => { const x = buckets[b], gap = x.gap / x.g; return `<div class="srl"${tipAttr(`<b>${esc(SPLIT_LABELS[split] || split)}: ${esc(BUCKET_L[b] || b)}</b><br>${x.w}–${x.g - x.w} in ${x.g} games · pace ${(x.pace / x.g).toFixed(1)}<br>game-adjusted net <b>${signed(gap)}</b> against his own across the split<br><span class="k">game-adjusted: each game's margin per 100 plus the opponent's rating, home edge removed</span>`)}><span>${esc(BUCKET_L[b] || b)} <small style="color:var(--faint)">${x.g}</small></span><span class="sb"><i style="left:${gap >= 0 ? 50 : 50 - Math.min(50, Math.abs(gap) * 2)}%;width:${Math.min(50, Math.abs(gap) * 2)}%;background:${gap >= 0 ? '#BC3A2C' : '#1C4E86'}"></i><b style="left:50%"></b></span><span class="sn">${signed(gap)}</span></div>`; }).join('');
    return `<div class="split"><h4>${SPLIT_LABELS[split] || split}</h4>${rows}</div>`;
  }).join('');
  return `<div class="col wide"><h3 class="sub">Every situation, bucket by bucket</h3><p class="since">2013-14 on · each bar is his game-adjusted net in that bucket minus his net across the split${sr ? '' : ', games-weighted over his career'}; the gaps are ranked against every coach in the panel rows above · hover a bar</p><div class="splits">${panels}</div></div>`;
}

// ---------------------------------------------------------------- shot diet (College Savant's zones)
function renderDiet(sr, only){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.identity && !miss(s.identity.rim));
  if (!S.length) return '';
  const keys = only === 'd' ? [['o_rim', 'Rim'], ['o_mid', 'Mid-range'], ['o_fg3r', 'Threes'], ['o_trans', 'Transition']] : [['rim', 'Rim'], ['mid', 'Mid-range'], ['fg3r', 'Threes'], ['c3', 'Corner share of threes'], ['trans', 'Transition'], ['early', 'Early offense']];
  const wavg = (k, med) => { let a = 0, b = 0; for (const s of S) { const v = med ? IDX.league[s.season]?.median?.[k] : (s.values?.[k]?.[0]); if (v == null) continue; a += v * s.g; b += s.g; } return b ? a / b : null; };
  const rows = keys.map(([k, l]) => { const v = wavg(k), m = wavg(k, true); if (v == null) return ''; const d = m != null ? v - m : 0; return `<div class="srl"${tipAttr(statTip(k) + `<div class="def">his ${fmt('pct1', v)} against a D1 median of ${fmt('pct1', m)}${sr ? '' : ', games-weighted over his seasons'}</div>`)}><span>${l}</span><span class="sb"><i style="left:${d >= 0 ? 50 : 50 - Math.min(50, Math.abs(d) * 3)}%;width:${Math.min(50, Math.abs(d) * 3)}%;background:${d >= 0 ? '#C2A263' : '#8A95A3'}"></i><b style="left:50%"></b></span><span class="sn">${fmt('pct1', v)}</span></div>`; }).join('');
  return `<div class="col wide"><h3 class="sub">${only === 'd' ? 'What he allows' : 'What he hunts'}</h3><p class="since">College Savant's shot zones, located shots, garbage time out · ${sr ? sr.season : 'his career'} against the D1 median · gold: more than D1, grey: less · hover a row</p>${rows}</div>`;
}
function renderPlayTypes(){ return ''; }

// ---------------------------------------------------------------- arrival: before, first season, after
function renderArrival(){
  const ar = COACH.arrivals || [];
  if (!ar.length) return '';
  const keys = ['net','winpct','pace','fg3r','rim','ast_pct','orb_pct','o_fg3r','o_tov','to_g','depth10','ret_min','tr_min'];
  const blocks = ar.map(a => {
    const ks = keys.filter(k => a.rows[k] && a.rows[k].p && a.rows[k].p[1] != null);
    const W = CW(760), L = W < 600 ? 128 : 190, R = 16, H = 44 + 22 * ks.length;
    const x = p => L + (W - L - R) * p / 100;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
    for (const g of [0, 25, 50, 75, 100]) svg += `<line x1="${x(g)}" x2="${x(g)}" y1="14" y2="${H - 24}" stroke="${g === 50 ? '#C4C0B6' : '#E4E1D9'}"/><text x="${x(g)}" y="${H - 10}" font-size="9" text-anchor="${g === 0 ? 'start' : g === 100 ? 'end' : 'middle'}" fill="#8A95A3">${g === 0 ? 'lowest in D1' : g === 100 ? 'highest' : g + 'th'}</text>`;
    ks.forEach((k, i) => {
      const {v, p} = a.rows[k], s = STATS[k], y = 26 + 22 * i, u = s?.unit || 'num1';
      svg += `<text x="${L - 10}" y="${y + 4}" font-size="${W < 600 ? 10 : 11}" text-anchor="end" fill="#1A2332" font-family="IBM Plex Sans"${tipAttr(statTip(k))}>${esc(s?.label || k)}${s?.lower ? ' ↓' : ''}</text>`;
      if (p[0] != null) svg += `<line x1="${x(p[0])}" y1="${y}" x2="${x(p[1])}" y2="${y}" stroke="#C4C0B6" stroke-width="2"/>`;
      if (p[2] != null) svg += `<line x1="${x(p[1])}" y1="${y}" x2="${x(p[2])}" y2="${y}" stroke="#C4C0B6" stroke-width="2" stroke-dasharray="3 3"/>`;
      const dot = (j, col, r, label, season) => p[j] == null ? '' : `<circle class="hit" cx="${x(p[j])}" cy="${y}" r="${r}" fill="${col}"${tipAttr(`<b>${esc(s?.label || k)}, ${label}</b> (${season} ${esc(teamName(a.team))})<br><b>${fmt(u, v[j])}</b> · ${ord(p[j])} percentile of that season's D1 teams${s?.lower ? ' (lower is better, so flipped)' : ''}`)}></circle>`;
      svg += dot(0, '#8A95A3', 4.5, 'the season before him', a.before_season) + dot(2, '#BC3A2C', 4.5, 'the season after he left', a.after_season) + dot(1, '#22395A', 5.5, 'his first season', a.first_season);
    });
    svg += '</svg>';
    const ret = a.returners ? `<div class="small" style="margin:2px 0 6px"${tipAttr('<b>Returning players only</b><br>the men who were on the team before he arrived: their change in Savant rate in his first season, against D1\'s expected change for their class step and level')}>Returning players only: <b>${signed(a.returners.dev)}</b> per 100 against the curve, ${a.returners.n} men, ${a.returners.min.toLocaleString()} weighted minutes.</div>` : '';
    return `<h3 class="sub">${esc(teamName(a.team))}, ${a.first_season}${a.last_season && a.last_season !== a.first_season ? ` to ${a.last_season}` : ''}</h3><p class="since">${a.before_season ? `${a.before_season} before him → ` : 'no season before him in the data → '}${a.first_season} his first → ${a.after_season ? `${a.after_season} after he left` : 'still there, or no season after yet'}</p>${ret}${svg}`;
  }).join('');
  return `<div class="col wide"><h2 class="col-h">What changed when he arrived, and after he left</h2><p class="since">team-season figures, whoever coached, each as a percentile among that season's D1 teams · the gap between dots is the size of the change · a new roster moves numbers too, which is why returning minutes and the returning players' development are beside it · hover a dot</p>${blocks}
    <div class="legend2"><span><span class="sw" style="background:#8A95A3;border-radius:50%"></span>the season before him</span><span><span class="sw" style="background:#22395A;border-radius:50%"></span>his first season</span><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>the season after he left</span><span>↓ lower is better, already flipped</span></div></div>`;
}

// ---------------------------------------------------------------- development: dumbbells
function renderDevelopment(sr){
  const S = (sr ? [sr] : COACH.seasons).filter(s => s.development?.players?.length);
  if (!S.length) return '';
  // players: [eid, name, step, rate before, rate after, expected change, residual, weight, arrived, from]
  const rows = S.flatMap(s => s.development.players.map(p => [s.season, ...p])).sort((a, b) => b[7] - a[7]);
  const top = rows.slice(0, 10), bottom = rows.length > 16 ? rows.slice(-6) : [];
  const all = [...top, ...bottom]; const W = CW(760), L = W < 600 ? 130 : 210, H = 24 + 20 * (all.length + 1);
  const lo = Math.min(...all.map(r => Math.min(r[6], r[5] - r[4]))) - .5, hi = Math.max(...all.map(r => Math.max(r[6], r[5] - r[4]))) + .5;
  const x = v => L + (W - L - 20) * (v - lo) / (hi - lo);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${H - 10}" stroke="#D9D6CF"/>`;
  let i = 0;
  for (const r of all) { if (i === top.length) i++; const y = 18 + 20 * i++; const act = r[5] - r[4], nm = r[2];
    const tip = `<b>${playerLink(r[1], nm, r[0])}</b>, ${r[0]} (${esc(r[3])})<br>Savant rate ${signed(r[4])} → ${signed(r[5])} (<b>${signed(act)}</b>) over ${Math.round(r[8]).toLocaleString()} weighted minutes<br>D1 expected ${signed(r[6], 2)} for his class step and level<br><span class="k">${act >= r[6] ? 'beat it by' : 'fell short by'} ${Math.abs(r[7]).toFixed(1)} · arrived ${SRC_L[r[9]] || r[9]}${r[10] ? `, from ${esc(teamName(r[10]))}` : ''}</span>`;
    svg += svgPlayer(r[1], L - 10, y + 4, W < 600 ? last(nm) : nm, 'font-size="11" text-anchor="end" fill="#1A2332" font-family="IBM Plex Sans"') + `<g class="hit"${tipAttr(tip)}><line x1="${x(r[6])}" x2="${x(act)}" y1="${y}" y2="${y}" stroke="#C4C0B6" stroke-width="2"/><circle cx="${x(r[6])}" cy="${y}" r="4" fill="#C2A263"></circle><circle cx="${x(act)}" cy="${y}" r="5" fill="${act >= r[6] ? '#BC3A2C' : '#1C4E86'}"></circle></g>`; }
  svg += `<text x="${x(0)}" y="${H - 2}" font-size="9" text-anchor="middle" fill="#8A95A3">no change</text></svg>`;
  return `<div class="col wide" id="dev"><h2 class="col-h">Do players get better under him?</h2><p class="since">2010-11 on · change in Savant rate from the season before against D1's expected change for the same class step (Fr→So, So→Jr …) and the same starting level, with each season's league-wide shift taken out · ${sr ? sr.season : 'his career'}: the ten who beat it most${bottom.length ? ' and the six who fell shortest' : ''} · hover a row; a name opens his card</p>${svg}
    <div class="legend2"><span><span class="sw" style="background:#C2A263;border-radius:50%"></span>expected for his class and level</span><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>beat it</span><span><span class="sw" style="background:#1C4E86;border-radius:50%"></span>fell short</span><span>Selection (he plays the men who improve), regression to the mean and the strength staff all live in this number.</span></div></div>`;
}

// ---------------------------------------------------------------- roster building
function renderRosterBuilding(sr){
  const S = COACH.seasons.filter(s => s.roster?.minutes);
  if (!S.length) return '';
  const W = CW(), n = S.length, left = 44, bw = (W - left - 10) / n, H = 170;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H + 24}">`;
  for (const g of [0, 50, 100]) svg += `<line x1="${left}" x2="${W - 10}" y1="${10 + H * (1 - g / 100)}" y2="${10 + H * (1 - g / 100)}" stroke="#E4E1D9"/><text x="${left - 6}" y="${13 + H * (1 - g / 100)}" font-size="9" text-anchor="end" fill="#8A95A3">${g}%</text>`;
  S.forEach((s, i) => {
    let acc = 0; const X = left + i * bw + bw * .12, w = Math.max(2, bw * .76), m = s.roster.minutes;
    const tip = `<b>${s.season} ${esc(teamName(s.team))}</b><br>${Object.keys(SRC_L).map(k => `${SRC_L[k]}: ${(m[k] || 0).toFixed(1)}%`).join('<br>')}${s.roster.class_rank ? `<br>recruiting class: ${ord(s.roster.class_rank)} by WCE's class score` : ''}<br><span class="k">click to open the season</span>`;
    svg += `<g class="hit" data-pick="${s.season}"${tipAttr(tip)}>`;
    for (const k of ['returning', 'transfer', 'hs', 'juco', 'intl']) { const v = m[k] || 0; if (v <= 0) continue; svg += `<rect x="${X}" y="${10 + H * (1 - (acc + v) / 100)}" width="${w}" height="${H * v / 100}" fill="${SRC_C[k]}"/>`; acc += v; }
    svg += `<rect x="${X}" y="10" width="${w}" height="${H}" fill="transparent"${state.mode === s.season ? ' stroke="#C2A263" stroke-width="2"' : ''}/></g>`;
  });
  const step = Math.max(1, Math.ceil(n / 12));
  for (let i = 0; i < n; i += step) svg += `<text x="${left + i * bw + bw / 2}" y="${H + 22}" font-size="9" text-anchor="middle" fill="#8A95A3">${S[i].season.slice(2, 4)}-${S[i].season.slice(5)}</text>`;
  svg += '</svg>';
  const s = sr || S[S.length - 1], r = s.roster || {};
  const lst = (arr, title, f) => `<div><h4 style="margin:0 0 4px;font-family:var(--mono);font-size:10.5px;color:var(--faint);text-transform:uppercase">${title}</h4>${(arr || []).map(f).join('') || '<div class="empty">none</div>'}</div>`;
  const tin = lst(r.transfers_in, `Transfers in, ${s.season}`, t => `<div class="small">${playerLink(t.eid, t.name, s.season)} <span class="k">from ${esc(tAbbr(t.frm))}</span> · rate ${signed(t.rate)} against ${signed(t.exp)} expected <b style="color:${t.rate >= t.exp ? 'var(--red)' : 'var(--c-lo)'}">${signed(t.rate - t.exp)}</b></div>`);
  const tout = lst(r.transfers_out, `Transferred out after ${RSprev(s.season)}`, t => `<div class="small">${playerLink(t.eid, t.name, RSprev(s.season))} <span class="k">to ${t.to ? esc(tAbbr(t.to)) : '—'}</span> · value ${signed(t.value)}</div>`);
  return `<div class="col wide" id="roster"><h2 class="col-h">How he builds a roster<span class="q">minutes by how each man arrived</span></h2><p class="since">2009-10 on · every player-season labelled from ESPN's box scores and CBBD's rosters: returning, D1 transfer, high-school freshman, JUCO or non-D1, international · the portal has no dates, so moves are read season to season · hover a season; click to open it</p>${svg}
    <div class="legend2">${Object.entries(SRC_L).map(([k, l]) => `<span><span class="sw" style="background:${SRC_C[k]}"></span>${l}</span>`).join('')}</div><div class="grid2" style="margin-top:10px">${tin}${tout}</div></div>`;
}
const RSprev = s => { const y = +s.slice(0, 4); return `${y - 1}-${String(y).slice(2)}`; };

// ---------------------------------------------------------------- the NCAA Tournament
function renderTournament(sr){
  const S = COACH.seasons.filter(s => s.tournament?.seed);
  const all = COACH.records.filter(r => r.seed);
  if (!all.length) return `<div class="col wide" id="ncaa"><h2 class="col-h">March, measured fairly</h2><div class="empty">no NCAA Tournament appearance on record (2002-03 on)</div></div>`;
  const rows = all.map(r => { const s = COACH.seasons.find(x => x.season === r.season && x.team === r.team), t = s?.tournament || {}; return {season: r.season, team: r.team, seed: r.seed, res: r.ncaa, w: t.wins ?? r.ncaa_w, avg: t.seed_avg, exp: t.exp_wins_prob}; });
  const tw = rows.reduce((a, r) => a + (r.w || 0), 0), ta = rows.filter(r => r.avg != null).reduce((a, r) => a + r.avg, 0), te = rows.filter(r => r.exp != null).reduce((a, r) => a + r.exp, 0), ne = rows.filter(r => r.exp != null).length;
  const se = Math.sqrt(rows.length) * 0.95;
  const tbl = `<div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>seed</th><th>result</th><th>wins</th><th>seed average</th><th>vs seed</th><th>by the odds</th><th>vs odds</th></tr></thead><tbody>${rows.slice().reverse().map(r => `<tr${COACH.seasons.find(x => x.season === r.season) ? ` class="link" data-pick="${r.season}"` : ''}><td>${r.season}</td><td>${esc(tAbbr(r.team))}</td><td>${r.seed}</td><td style="text-align:left;font-family:var(--body)">${esc(ROUND_L[r.res] || r.res || '')}</td><td>${r.w ?? '—'}</td><td>${r.avg != null ? r.avg.toFixed(2) : '—'}</td><td>${r.avg != null ? signed(r.w - r.avg, 2) : '—'}</td><td>${r.exp != null ? r.exp.toFixed(2) : '—'}</td><td>${r.exp != null ? signed(r.w - r.exp, 2) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="col wide" id="ncaa"><h2 class="col-h">March, measured fairly<span class="q">against the seed and against the odds</span></h2><p class="since">2002-03 on · every seed checked against Wikipedia's bracket · the seed's average is over the 2002-03 to 2025-26 brackets on file (First Four wins excluded); the odds are WCE's pre-game win probabilities from both teams' adjusted ratings, from 2009-10 · always read with the interval: March is short</p>
    <div class="tiles"><div class="tile"><div class="tl">Appearances</div><div class="tv">${rows.length}</div><div class="ts">${tw} wins · ${COACH.career.all_time.f4} Final Four${COACH.career.all_time.f4 === 1 ? '' : 's'} · ${COACH.career.all_time.titles} title${COACH.career.all_time.titles === 1 ? '' : 's'}</div></div>
      <div class="tile"${tipAttr(statTip('t_seed'))}><div class="tl">Over the seed</div><div class="tv">${signed(tw - ta, 1)}</div><div class="ts">wins in all, ±${(1.96 * se).toFixed(1)} (95%) over ${rows.length} appearance${rows.length === 1 ? '' : 's'}</div></div>
      <div class="tile"${tipAttr(statTip('t_prob'))}><div class="tl">Over the odds</div><div class="tv">${ne ? signed(tw - rows.filter(r => r.exp == null).reduce((a, r) => a + (r.w || 0), 0) - te, 1) : '—'}</div><div class="ts">wins in all over ${ne} appearance${ne === 1 ? '' : 's'} with ratings, ±${(1.96 * Math.sqrt(ne) * 0.9).toFixed(1)} (95%)</div></div></div>
    ${tbl}</div>`;
}

// ---------------------------------------------------------------- resources: spending vs net above the roster
let PROGRAMS = null;
async function loadResources(sr){
  const el = document.getElementById('resbody'); if (!el) return;
  try { PROGRAMS = PROGRAMS || await fetchJSON(`${BASE}/data/programs.json`); } catch (e) { el.innerHTML = '<div class="empty">could not load the programs</div>'; return; }
  const c = PROGRAMS.cols, I = k => c.indexOf(k);
  const pts = PROGRAMS.rows.filter(r => r[I('spend_pct')] != null && r[I('adj_net')] != null && r[I('exp_net_roster')] != null && (!sr || r[0] === sr.season));
  if (!pts.length) { el.innerHTML = `<div class="empty">no spending figures ${sr ? 'for ' + sr.season : ''} (EADA files run 2002-03 to 2024-25; the roster model from 2010-11)</div>`; return; }
  const W = CW(760), H = W < 600 ? 300 : 360, x = v => 46 + (W - 66) * v / 100;
  const ys = pts.map(r => r[I('adj_net')] - r[I('exp_net_roster')]), ylo = Math.max(-25, Math.min(...ys)), yhi = Math.min(25, Math.max(...ys));
  const y = v => 16 + (H - 56) * (1 - (Math.max(ylo, Math.min(yhi, v)) - ylo) / (yhi - ylo));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="46" x2="${W - 20}" y1="${y(0)}" y2="${y(0)}" stroke="#C4C0B6"/><line x1="${x(50)}" x2="${x(50)}" y1="16" y2="${H - 40}" stroke="#E4E1D9" stroke-dasharray="4 3"/>`;
  const mine = [];
  for (const r of pts) { const me = r[I('coach')] === COACH.id, v = r[I('adj_net')] - r[I('exp_net_roster')]; if (me) { mine.push(r); continue; } svg += `<circle cx="${x(r[I('spend_pct')])}" cy="${y(v)}" r="2" fill="#8B9099" opacity=".28"/>`; }
  for (const r of mine) { const v = r[I('adj_net')] - r[I('exp_net_roster')]; svg += `<circle class="hit" cx="${x(r[I('spend_pct')])}" cy="${y(v)}" r="6" fill="${teamColor(r[1])}" stroke="#C2A263" stroke-width="2"${tipAttr(`<b>${r[0]} ${esc(teamName(r[1]))}</b><br>spending: ${ord(Math.round(r[I('spend_pct')]))} percentile of D1 (EADA)<br>net above the roster model: <b>${signed(v)}</b> per 100${+r[0].slice(0, 4) >= 2021 ? '<br><span class="k">2021-22 on: NIL money is not in EADA</span>' : ''}`)}/>`; }
  svg += `<text x="${W / 2}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#8A95A3">men's basketball spending, D1 percentile (EADA)</text><text transform="translate(14 ${H / 2}) rotate(-90)" font-size="10" fill="#8A95A3" text-anchor="middle">net above the roster model</text><text x="${W - 22}" y="28" font-size="10" fill="#8A95A3" text-anchor="end">more with more</text><text x="52" y="28" font-size="10" fill="#8A95A3">more with less</text></svg>`;
  el.innerHTML = svg + `<div class="small">${sr ? `${sr.season}, every D1 program with both figures (${pts.length})` : `every program-season with both figures (${pts.length.toLocaleString()})`}; his seasons ringed in gold. The resource-adjusted expectation (the "Wins above resources" row) adds the fitted effect of spending, ${signed(IDX.meta.fits.resources?.b)} points of net per 100 percentile points, to the roster model; it is kept off the headline because schools account differently.</div>`;
}

// ---------------------------------------------------------------- staff, lineage, NBA
function renderStaff(sr){
  const L = COACH.lineage || {};
  const chain = []; let at = L.mentor, guard = 0; const nodes = IDX.tree.nodes;
  while (at && nodes[at] && guard++ < 12) { chain.push([at, nodes[at].name]); at = nodes[at].mentor; }
  const seasons = (sr ? [sr] : COACH.seasons).filter(s => s.staff && s.staff.length);
  const assist = COACH.assistant || [];
  const first = COACH.bio?.first_hc;
  const wl = (n, t) => t ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}" rel="noopener">${esc(n)}</a>` : esc(n);
  return `<div class="col wide"><h2 class="col-h">Where he comes from, who he produced</h2><p class="since">staffs from Wikipedia's team-season articles and coach biographies, best effort and patchier before 2010 · a mentor counts only from stints before his first D1 head job · every coach credited with his staff beside him</p>
    <div class="grid2"><div><h3 class="lead-h">Lineage</h3>${L.mentor ? `<div class="small">Suggested mentor: <b>${coachLink(L.mentor, L.mentor_name)}</b> (${esc(L.role || '')}) · from the record${L.tie ? ' · <span class="pill">a tie</span>' : ''}${L.mentor_closer_than != null ? ` · on style, closer than ${L.mentor_closer_than}% of pairs` : ''}</div>` : `<div class="small">No D1 staff stint on record before his first head job${first ? ` (${first})` : ''}, so no mentor is suggested. That means the lineage is missing from the sources, not that he learned it alone.</div>`}
      ${chain.length > 1 ? `<div class="small" style="margin-top:4px">Line: ${[`<b>${esc(COACH.name)}</b>`, ...chain.map(c => coachLink(c[0], c[1]))].join(' ← ')}</div>` : ''}
      ${L.also?.length ? `<div class="small" style="margin-top:4px">Also shaped by: ${L.also.map(a => `${coachLink(a[0], a[1])} (${a[2]} season${a[2] === 1 ? '' : 's'})`).join(', ')}</div>` : ''}
      ${L.later?.length ? `<div class="small" style="margin-top:4px">On a staff after he had been a head coach (a job, not an apprenticeship): ${L.later.map(u => `${coachLink(u[0], u[1])} (${u[2]})`).join(', ')}</div>` : ''}
      ${L.kids?.length ? `<div class="small" style="margin-top:8px"><b>Head coaches off his staff:</b> ${L.kids.map(k => coachLink(k[0], k[1])).join(', ')}</div>` : ''}
      ${COACH.bio?.nba ? `<div class="small" style="margin-top:8px">He was also an NBA head coach: <a href="/basketball-coaching-savant.html#c=${encodeURIComponent(COACH.bio.nba)}">Basketball Coaching Savant ↗</a></div>` : ''}
      <div class="small" style="margin-top:8px"><a href="#tree=${COACH.id}">See him in the tree ↗</a></div>
      ${assist.length ? `<h3 class="lead-h" style="margin-top:14px">His own stints as an assistant</h3><div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>head coach</th><th>source</th></tr></thead><tbody>${assist.map(a => `<tr${first && a.season >= first ? ' style="color:var(--faint)"' : ''}><td>${a.season}</td><td>${esc(tAbbr(a.team))}</td><td style="text-align:left;font-family:var(--body)">${(a.heads || []).map(h => coachLink(h, nodes[h]?.name || h)).join(', ') || '—'}</td><td>${a.src === 'infobox' ? 'team-season article' : 'biography'}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
    <div><h3 class="lead-h">Staff room</h3>${seasons.length ? seasons.slice().reverse().map(s => `<div class="staff" style="margin:4px 0"><b>${s.season} ${esc(tAbbr(s.team))}</b>: ${s.staff.map(a => a.id ? coachLink(a.id, a.name) : wl(a.name, a.wiki)).join(', ')} <span class="small"><a href="${esc(s.staff[0].src)}" rel="noopener">source ↗</a></span></div>`).join('') : '<div class="empty">no staff recorded for ' + (sr ? sr.season : 'his seasons') + '</div>'}
      <div class="small" style="margin-top:8px">What each assistant is responsible for is not in any free source. Team results while on a staff are context, not credit.</div></div></div></div>`;
}

// ---------------------------------------------------------------- similar players (the fit model's label)
let FITT = null;
function renderFits(){
  const F = COACH.fits;
  if (!F || !F.rows?.length) return '';
  const t = IDX.meta.fits.fit || {};
  return `<div class="col wide" id="fits"><h2 class="col-h">Players like the ones he uses<span class="q">${t.ships_as === 'fit score' ? 'system fit' : 'similar players, not a prediction'}</span></h2><p class="since">College Savant's players (${esc(F.rows[0].season)} and the current season) whose profiles (usage, shot diet, rebounding, free throws, turnovers, tempo) sit nearest the men he has played at their position · the match is a closeness score, 0-100 · tested on ${(t.n || 0).toLocaleString()} transfers: ${t.ships_as === 'fit score' ? 'it predicted their change' : 'a closer match did not predict a transfer\'s change better than the roster model, so this is similarity, not a forecast'}</p>
    <div class="scroll"><table class="t"><thead><tr><th style="text-align:left">player</th><th>pos</th><th>team</th><th>match</th><th style="text-align:left">most like, under him</th></tr></thead><tbody>${F.rows.slice(0, 20).map(r => `<tr><td style="text-align:left;font-family:var(--body)">${playerLink(r.eid, r.name || r.eid, r.season)}</td><td>${esc(r.pos)}</td><td>${teamLink(r.team, r.season, tAbbr(r.team))}</td><td>${r.match ?? '—'}</td><td style="text-align:left;font-family:var(--body)">${(r.like || []).map(l => `${playerLink(l[0], l[3] || l[0], l[1])} <span class="k">${l[1]}</span>`).join(', ') || '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- every season
function renderSeasons(){
  const S = COACH.seasons;
  const recTable = rows => `<div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>W</th><th>L</th><th>NCAA</th><th></th><th style="text-align:left">source</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.season}</td><td>${esc(tAbbr(r.team))}</td><td>${r.w ?? ''}</td><td>${r.l ?? ''}</td><td>${r.seed ? `${r.seed} seed, ${esc(ROUND_L[r.ncaa] || r.ncaa || '')}` : ''}</td><td>${r.interim ? '<span class="pill">interim</span>' : ''}${r.confirmed ? '' : ' <span class="pill">unconfirmed</span>'}${r.vacated ? ' <span class="pill">vacated on record</span>' : ''}</td><td style="text-align:left">${(r.src || []).slice(0, 2).map((u, i) => `<a href="${esc(u)}" rel="noopener">${u.includes('wikipedia') ? 'Wikipedia' : 'ESPN'}${i ? ' 2' : ''} ↗</a>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
  const pcell = (k, p) => p && p[k] != null ? ` <span class="pb" style="background:${STATS[k]?.kind === 'good' ? gradeColor(p[k]) : '#C2A263'};font-size:9.5px">${p[k]}</span>` : '';
  const row = s => { const e = s.exp || {}, v = s.values || {}, p = s.ranked ? s.pct : s.live_pct, r = COACH.records.find(x => x.season === s.season && x.team === s.team) || {}; return `<tr class="link${state.mode === s.season ? ' on' : ''}" data-pick="${s.season}"><td>${s.season}${s.in_progress ? ' <span class="pill">live</span>' : ''}</td><td>${esc(tAbbr(s.team))}</td><td>${s.w}–${s.l}</td><td>${s.cw != null ? `${s.cw}–${s.cl}` : ''}</td><td>${r.seed ? `${r.seed}, ${r.ncaa}` : ''}</td><td>${signed(s.net)}${pcell('net', p)}</td><td>${e.exp_net != null ? signed(e.exp_net) : '—'}</td><td>${v.w_roster ? signed(v.w_roster[0]) : '—'}${pcell('w_roster', p)}</td><td>${e.ap_pre ? '#' + e.ap_pre : '—'}</td><td>${e.ap_final ? '#' + e.ap_final : '—'}</td><td>${v.stability ? fmt('pct1', v.stability[0]) : '—'}</td><td>${v.depth10 ? v.depth10[0].toFixed(1) : '—'}</td><td>${v.to_g ? v.to_g[0].toFixed(1) : '—'}</td><td>${v.ato ? v.ato[0].toFixed(2) : '—'}</td><td>${v.pace ? v.pace[0].toFixed(1) : '—'}</td><td>${v.tr_min ? fmt('pct1', v.tr_min[0]) : '—'}</td><td>${v.spend_pct ? Math.round(v.spend_pct[0]) : '—'}</td><td>${s.staff?.length || '—'}</td></tr>`; };
  const older = COACH.records.filter(r => !S.find(s => s.season === r.season && s.team === r.team));
  return `<div class="col wide" id="seasons"><h2 class="col-h">Every season</h2><p class="since">coloured numbers are percentiles among that season's D1 head coaches with ${IDX.meta.rules.min_season_games}+ games · click a season to view it everywhere above</p>
    ${S.length ? `<div class="scroll"><table class="t"><thead><tr><th>season</th><th>team</th><th>record</th><th>conf</th><th>NCAA</th><th>net</th><th>roster exp net</th><th>vs roster</th><th>AP pre</th><th>AP final</th><th>on script</th><th>depth</th><th>TO/g</th><th>ATO ppp</th><th>tempo</th><th>transfer min</th><th>spend pct</th><th>staff</th></tr></thead><tbody>${S.slice().reverse().map(row).join('')}</tbody></table></div>` : ''}
    <h3 class="lead-h" style="margin-top:14px">The record, every season on file</h3><p class="since">head coach of record per team-season, each row with its source; interims and unconfirmed rows tagged · ${esc(IDX.meta.credit)}</p>${recTable(COACH.records.slice().reverse())}</div>`;
}

// ---------------------------------------------------------------- scouting report, written by rule; the current season first
function renderScouting(sr){
  const cur = sr && sr.season === CUR() && COACH.scouting_season && COACH.scouting_season.season === sr.season ? COACH.scouting_season : null;
  const L = cur ? cur.lines : (sr ? seasonScout(sr) : (COACH.scouting || []));
  const last = cur && cur.last && cur.lines.length < 4 ? cur.last : null;
  if (!L.length && !last) return '';
  const pools = s => s ? seasonPools(s) : null;
  const line = (l, season) => `<li${tipAttr(statTip(l.key, {v: l.value, pct: l.pct, n: l.n, pool: season ? (COACH.seasons.find(x => x.season === season)?.ranked ? IDX.league[season]?.pools?.[l.key] : COACH.seasons.find(x => x.season === season)?.live_pools?.[l.key]) : COACH.career.stats[l.key]?.pool, season}))}>${esc(l.text)}${l.settled === false ? ' <span class="k">small sample</span>' : ''}</li>`;
  const title = sr ? `Scouting report, ${sr.season}${sr.in_progress ? ' so far' : ''}` : 'Scouting report';
  const since = sr ? (sr.in_progress ? `written by rule from this season's numbers, ranked against ${sr.season}'s coaches with ${IDX.meta.rules.min_live_games}+ games; rewritten after every refresh` : `written by rule from his ${sr.season} numbers, ranked against that season's coaches`) : 'written by rule from the card: the two rows furthest from the middle in each group, each with its sample';
  const lead = cur && !L.length ? `<p class="small">${sr.season} has ${sr.g} game${sr.g === 1 ? '' : 's'} for him so far: nothing ranks until ${IDX.meta.rules.min_live_games}, and a line needs a quarter of its stat's settle point.</p>` : '';
  return `<div class="col wide" id="scout"><h2 class="col-h">${title}${sr && liveMode(sr) ? ' <span class="pill">provisional</span>' : ''}</h2><p class="since">${since}</p>${lead}${L.length ? `<ul class="lines">${L.map(l => line(l, sr?.season)).join('')}</ul>` : ''}${last && last.lines.length ? `<h3 class="sub">Last season, ${last.season}</h3><ul class="lines">${last.lines.map(l => line(l, last.season)).join('')}</ul>` : ''}<div class="small">${esc(IDX.meta.model_note)}</div></div>`;
}

function seasonTabs(extra){
  const srow = COACH.seasons.find(s => s.season === (TFILE?.season || state.season));
  const note = TFILE?.why ? `<div class="small" style="margin-bottom:6px">${esc(TFILE.why)}</div>` : '';
  return note + `<div class="tabs"><span class="pill" style="align-self:center">${srow?.season || state.season || ''} ${esc(tAbbr(srow?.team) || '')}</span>${extra || ''}</div>`;
}
