const BASE = '/bcs';
const SAVANT = '/basketball-savant.html?p=';
const Z = ['ra','paint','mid','c3','ab3'], ZL = {ra:'Rim', paint:'Short mid', mid:'Mid-range', c3:'Corner 3', ab3:'Above-break 3'};
const CAUSES = ['absence','blowout','foul','choice'], CAUSE_C = {absence:'#8B9099', blowout:'#C2C0B6', foul:'#C2A263', choice:'#BC3A2C'}, CAUSE_L = {absence:'absence', blowout:'blowout', foul:'foul trouble', choice:"the coach's choice"};
const PT = {Isolation:'Isolation', Transition:'Transition', PRBallHandler:'P&R handler', PRRollman:'P&R roll man', Postup:'Post-up', Spotup:'Spot-up', Handoff:'Hand-off', Cut:'Cut', OffScreen:'Off screen', OffRebound:'Putback', Misc:'Misc'};
const ROUND_L = {0:'missed the playoffs', 1:'lost in the first round', 2:'lost in the second round', 3:'lost in the conference finals', 4:'lost in the Finals', 5:'won the title'};
const CMP_COLORS = ['#22395A', '#C2A263', '#BC3A2C'];
// the headline rows of each panel; the rest sit behind "more"
const HEADLINE = {
  record: ['winpct', 'net', 'w_talent', 'w_market', 'po_rate', 'adj_net'],
  rotation: ['stability', 'chosen_dev', 'left_table', 'depth10', 'closes_best', 'overplay'],
  management: ['ato', 'ch_success', 'to_g', 'run_stop', 'ato_vs', 'clutch_net'],
  offense: ['pace', 'fg3r', 'rim', 'ortg', 'mid', 'ast_pct'],
  defense: ['o_efg', 'o_rim', 'drtg', 'o_fg3r', 'o_tov', 'pf100'],
  development: ['aging', 'aging_young'],
  context: ['gap_top10', 'gap_road', 'gap_missing', 'gap_trail', 'tempo_ctl', 'gap_b2b', 'gap_fav'],
};
let IDX = null, COACH = null, TFILE = null, TCACHE = {}, STATS = {}, CMPC = {}, cmp = [], addMode = false;
let state = {mode:'career', base:'played', kind:'RS', game:null, season:null, allCauses:false, arcOpen:false};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const miss = v => v === null || v === undefined || Number.isNaN(v);
function fmt(unit, v){
  if (miss(v)) return '—';
  v = +v;
  switch (unit){
    case 'pct1': return v.toFixed(1) + '%';
    case 'num0': return String(Math.round(v));
    case 'num1': return v.toFixed(1);
    case 'num2': return v.toFixed(2);
    case 'sgn1': return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
    case 'sgn2': return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
    default: return String(v);
  }
}
const signed = (v, d=1) => miss(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const pc1 = v => miss(v) ? '—' : (100 * v).toFixed(1) + '%';
function mix(a, b, t){ const p = x => parseInt(x,16); const c = (i) => Math.round(p(a.slice(i,i+2)) + (p(b.slice(i,i+2)) - p(a.slice(i,i+2))) * t); return `rgb(${c(1)},${c(3)},${c(5)})`; }
function gradeColor(p){ if (miss(p)) return '#C2C0B6'; const t = (p - 1) / 98; return t < .5 ? mix('#1C4E86', '#C2C0B6', t * 2) : mix('#C2C0B6', '#BC3A2C', (t - .5) * 2); }
const muchColor = () => '#C2A263';
const ord = n => { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const QN = ['1st','2nd','3rd','4th'];
const teamName = (k) => IDX.teams[k]?.name || k;
const teamColor = k => IDX.teams[k]?.color || '#22395A';
const fetchJSON = async (p) => { const r = await fetch(p, {cache:'no-cache'}); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const nameOf = id => (IDX.tree.nodes[id]?.name) || (IDX.coaches.find(c => c.id === id)?.name) || id;
const last = n => String(n || '').split(' ').slice(-1)[0];
const initials = nm => String(nm || '').split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
const CW = (max) => Math.max(340, Math.min(max || 1000, (document.getElementById('coach')?.clientWidth || 1000) - 40));
// links: a coach to his page here, a player to his Basketball Savant card. An ESPN-only id ("e123")
// has no card, so it stays plain text.
const coachLink = (id, name) => id ? `<a class="cl" href="#c=${encodeURIComponent(id)}">${esc(name ?? nameOf(id))}</a>` : esc(name);
const playerLink = (pid, name) => (pid != null && /^\d+$/.test(String(pid))) ? `<a class="pl" href="${SAVANT}${pid}" title="his Basketball Savant card">${esc(name)}</a>` : esc(name);
const svgCoach = (id, x, y, text, attrs='') => `<a href="#c=${encodeURIComponent(id)}"><text x="${x}" y="${y}" ${attrs}>${esc(text)}</text></a>`;
const svgPlayer = (pid, x, y, text, attrs='') => /^\d+$/.test(String(pid)) ? `<a href="${SAVANT}${pid}"><text x="${x}" y="${y}" ${attrs}>${esc(text)}</text></a>` : `<text x="${x}" y="${y}" ${attrs}>${esc(text)}</text>`;
const tipAttr = html => ` data-tip="${String(html).replace(/"/g, '&quot;')}"`;
const pbox = p => miss(p) ? '<span class="pbox" style="background:#C2C0B6">—</span>' : `<span class="pbox" style="background:${gradeColor(p)};color:${p > 30 && p < 70 ? '#191B1F' : '#fff'}">${p}</span>`;
const goldbox = p => miss(p) ? '<span class="pbox" style="background:#C2C0B6">—</span>' : `<span class="pbox" style="background:#C2A263;color:#191B1F">${p}</span>`;

// ---------------------------------------------------------------- the tooltip
// One box for everything on the page. An element says what to show with data-tip (HTML); a
// canvas feeds it by hand. It opens where the pointer entered and stays put, so a link inside
// it can be reached; it closes a beat after the pointer has left both the anchor and the box.
const TIP = document.getElementById('tip');
let tipAnchor = null, tipTimer = null, tipKey = null;
function placeTip(x, y, opts){
  opts = opts || {};
  TIP.style.left = '0px'; TIP.style.top = '0px';
  const r = TIP.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  let left = x + 14, top = y + 16;
  if (left + r.width > vw - 8) left = x - r.width - 14;
  if (opts.minLeft != null && left < opts.minLeft) left = Math.min(opts.minLeft, vw - r.width - 8);
  if (left < 8) left = 8;
  if (top + r.height > vh - 8) top = y - r.height - 12;
  if (top < 8) top = 8;
  TIP.style.left = left + 'px'; TIP.style.top = top + 'px';
}
function showTip(html, x, y, opts){ clearTimeout(tipTimer); TIP.innerHTML = html; TIP.style.display = 'block'; placeTip(x, y, opts); }
function hideTip(){ TIP.style.display = 'none'; tipAnchor = null; tipKey = null; }
function armHide(ms){ clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, ms || 180); }
document.addEventListener('pointerover', e => {
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!el) return;
  if (el === tipAnchor) { clearTimeout(tipTimer); return; }
  tipAnchor = el; tipKey = null;
  showTip(el.dataset.tip, e.clientX, e.clientY);
});
document.addEventListener('pointerout', e => {
  if (!tipAnchor) return;
  const to = e.relatedTarget;
  if (to && (TIP.contains(to) || (to.closest && to.closest('[data-tip]') === tipAnchor))) return;
  armHide(180);
});
TIP.addEventListener('pointerenter', () => clearTimeout(tipTimer));
TIP.addEventListener('pointerleave', () => armHide(150));
window.addEventListener('scroll', () => { if (TIP.style.display === 'block' && !TIP.matches(':hover')) hideTip(); }, {passive:true});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });

// A stat's explainer, from config.STATS: value, percentile and pool, sample, definition.
function statTip(key, d){
  const s = STATS[key]; if (!s) return '';
  d = d || {};
  const how = s.kind === 'good' ? 'how good' : 'how much';
  const where = d.pool ? (d.season ? `percentile among ${d.pool} coaches of ${d.season}` : `percentile among ${d.pool} coaches, career`) : (d.season ? `not ranked in ${d.season}` : 'not ranked');
  const settled = (d.n == null) ? '' : (d.n >= s.thr ? ' · past its settle point' : ` · under its settle point of ${s.thr.toLocaleString()}`);
  return `<b>${esc(s.label)}</b> <span class="k">${how}${s.lower ? ' · lower is better' : ''} · from ${s.first}</span><br>` +
    `${d.v === undefined ? '' : `<b>${fmt(s.unit, d.v)}</b> `}${miss(d.pct) ? '' : (s.kind === 'good' ? pbox(d.pct) : goldbox(d.pct))}<span class="k">${miss(d.pct) ? (d.pool ? 'not ranked, ' + where.replace('percentile ', '') : where) : where}</span>` +
    `${d.n != null ? `<br><span class="k">sample ${Number(d.n).toLocaleString()}${d.seasons ? `, ${d.seasons} season${d.seasons === 1 ? '' : 's'}` : ''}${settled}</span>` : ''}` +
    `<div class="def">${esc(s.what)}<br><span class="k">${esc(s.formula)} · ${esc(s.source)}</span></div>`;
}

// ---------------------------------------------------------------- routing and the shell
function syncTabs(view){
  document.querySelectorAll('.sv-tab[data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === view));
}
function route(){
  const h = decodeURIComponent(location.hash.slice(1));
  hideTip();
  if (h.startsWith('c=')) return openCoach(h.slice(2).split('&')[0], h);
  if (h === 'tree' || h.startsWith('tree=')) return openTree(h.startsWith('tree=') ? h.slice(5) : null);
  document.body.className = 'view-home anim';
  document.title = 'Basketball Coaching Savant — WCE Hoops';
  syncTabs(h === 'leaders' ? 'leaders' : 'coaches');
  if (h === 'leaders') { const el = document.getElementById('leadersplate'); if (el) setTimeout(() => el.scrollIntoView({behavior:'smooth', block:'start'}), 30); }
  else window.scrollTo(0, 0);
}
async function init(){
  IDX = await fetchJSON(`${BASE}/index.json`);
  for (const s of IDX.stats) STATS[s.key] = s;
  const m = IDX.meta, cur = IDX.coaches.filter(c => c.active).length;
  document.getElementById('srcpill').textContent = `live data · ${IDX.meta.seasons.length} seasons · ${m.current} through ${m.generated.slice(5, 10).replace('-', '/')}`;
  document.getElementById('verchip').textContent = 'v' + m.version;
  renderChips();
  renderHome();
  wireSearch();
  window.addEventListener('hashchange', route);
  route();
}
// trending: the head coaches of the season in progress, the busiest careers first
function renderChips(){
  const el = document.getElementById('chips');
  const act = IDX.coaches.filter(c => c.active && c.hc).sort((a, b) => b.all_g - a.all_g).slice(0, 7);
  el.innerHTML = '<span class="chips-label">Trending</span>' + act.map(c => `<a class="chip" href="#c=${c.id}" data-id="${c.id}">${esc(c.name)}</a>`).join('');
}

// ---------------------------------------------------------------- home
function renderHome(){
  const m = IDX.meta;
  document.getElementById('homeintro').innerHTML = `<h2 class="col-h">Every NBA head coach, judged from the floor up</h2><p class="since">${IDX.coaches.filter(c => c.hc).length} head coaches since 1946-47 · ${IDX.coaches.filter(c => c.g).length} with games since 1996-97 · a pool of ${m.rules.career_pool} ranked careers · built ${m.generated.slice(0,10)}</p>
    <p class="small" style="max-width:720px">When each player plays and how often the coach goes off-script. Lineups judged from their parts. Timeouts that stop runs, or don't. Wins against what the roster and the market expected. Records and the coaching tree to 1946-47; everything else from the year its data begins. Start with a name above, or a trending coach.</p>`;
  document.getElementById('lead-since').textContent = `career boards: head coaches with ${m.rules.min_career_seasons}+ seasons and ${m.rules.min_career_games}+ games in the stat's window; this season: ${m.current}`;
  renderLeaders();
  renderTrends();
  const pr = IDX.produced.slice(0, 16).map(([n, id, kids]) => `<div class="lrow"${tipAttr(`<b>${esc(n)}</b><br>${kids.slice(0, 12).map(esc).join(', ')}${kids.length > 12 ? ` and ${kids.length - 12} more` : ''}`)}><span class="ln">${coachLink(id, n)}</span><span class="lv">${kids.length}</span></div>`).join('');
  document.getElementById('produced').innerHTML = `<div class="grid3"><div>${pr}</div><div class="small" style="grid-column:span 2">Head coaches who served on a man's staff before their own first head job, counted by Basketball-Reference's assistant stints and the NBA's staff tables (which begin in the 2000s). ${esc(IDX.tree.note)} <a href="#tree">Open the tree ↗</a></div></div>`;
  const t = m.fits.talent || {}, p = m.fits.parts || {};
  document.getElementById('howto').innerHTML = `
    <p><b>Two kinds of rows.</b> A graded row (blue to red) is "how good": higher percentile, better, with lower-is-better rows already flipped. A gold row is "how much": a tendency, where a high percentile means more of it, not better. The number riding the bar is the percentile; every percentile names its pool. A hatched bar is under its settle point and should be read as what happened, not who he is. Hover anything for its value, its pool, its sample and its definition; click a row's name to pin the explainer; the small chart glyph draws his seasons against the league median.</p>
    <p><b>Two expectations.</b> <i>Talent</i> is ours: each player's impact the season before, weighted by his role the season before, so the coach's own minutes cannot move it (out-of-sample R² ${t.oos_r2 ?? '—'} on team net rating, ${t.rmse ?? '—'} points of error, ${t.n ?? '—'} team-seasons). <i>The market</i> is the preseason win total, with the source page, and from 2015-16 the closing spread game by game.</p>
    <p><b>The Rotation Map</b> shows, for every man with 100 minutes under a coach, the share of games he was on the floor in each of the 48 minutes, measured on minutes still in the balance. His usual windows are where that share is 60% or better. Each game's off-script share is the minutes where someone's actual status differed from his usual one, and each off-script minute gets the first cause that fits: absence, blowout, foul trouble, then choice. ${esc(m.model_note)}</p>
    <p><b>Lineups are judged from their parts</b> (Σ impact of the five; out-of-sample R² ${p.oos_r2_talent ?? '—'} on luck-adjusted unit net over ${p.n ?? '—'} units), never from raw lineup net ratings, which inside a team are mostly noise. ${pairText(m.fits.pairings)}</p>`;
}
function pairText(pr){
  if (!pr) return 'The lineup pairings were not tested in this build.';
  const names = {hub_stretch:'hub big + stretch big', rimprot_stretch:'rim protector + stretch big', spacer_stopper:'spacer + stopper', two_noshoot_bigs:'two bigs where neither shoots'};
  const used = Object.entries(pr.replicated).filter(([k, v]) => v.replicates).map(([k]) => k);
  const rows = Object.keys(names).map(k => { const d = pr.results.discovery_even[k], r = pr.results.replication_odd[k]; return `${names[k]} ${signed(d.coef)} then ${signed(r.coef)}`; }).join('; ');
  return `The four pairings the lineup fit study found were retested on ${pr.n_units.toLocaleString()} units, ${pr.seasons[0]} to ${pr.seasons[1]}, with team-season fixed effects and errors clustered by team-season, discovered on even seasons and replicated on odd (${rows}). ${used.length ? `Used in the projection, at the pooled coefficient, because it keeps its sign in both halves and the pooled estimate clears p < .05: ${used.map(k => `${names[k]} (${signed(pr.replicated[k].coef)} per 100)`).join(', ')}. The other three flip sign or do not clear, and are left out.` : 'None replicated across the two halves, so the projection stays talent only; spacer + stopper kept its sign in both and is the one worth watching.'}`;
}
function renderLeaders(){
  const el = document.getElementById('leaders');
  el.innerHTML = IDX.leaders.map(b => `<div><h3 class="lead-h"${tipAttr(`<b>${esc(b.title)}</b><br>${esc(b.note || '')}<br><span class="k">${esc(b.pool)}</span>`)}>${esc(b.title)}</h3><p class="lead-p">${esc(b.pool)}${b.rows.length ? ` · ${b.rows.length}` : ''}</p>${b.rows.slice(0, 10).map((r, i) => `<div class="lrow"><span class="lrk">${i + 1}</span><span class="ln">${coachLink(r.id, r.name)}${r.team ? ` <small style="color:var(--faint)">${r.team}${r.season ? ' ' + r.season : ''}</small>` : ''}</span><span class="lv">${esc(r.display)}</span></div>`).join('') || '<div class="empty">nothing to rank yet</div>'}</div>`).join('');
}
function renderTrends(){
  const el = document.getElementById('trends');
  const keys = [['pace','Pace'],['fg3r','3-point rate'],['depth10','Rotation depth (10+ min)'],['stability','Rotation stability'],['ch_success','Challenge success'],['to_g','Timeouts per game']];
  el.innerHTML = keys.map(([k, label]) => {
    const pts = IDX.trends.filter(t => !miss(t[k])).map(t => [t.season, t[k]]);
    if (pts.length < 2) return `<div><h3 class="lead-h">${label}</h3><div class="empty">no seasons yet</div></div>`;
    const vals = pts.map(p => p[1]); const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * .15 || 1;
    const W = 300, H = 90, x = i => 30 + i * (W - 40) / (pts.length - 1), y = v => 10 + (H - 30) * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    const u = STATS[k]?.unit || 'num1';
    return `<div><h3 class="lead-h"${tipAttr(statTip(k))}>${label}</h3><p class="lead-p">${pts[0][0]} → ${pts[pts.length-1][0]}: ${fmt(u, pts[0][1])} → ${fmt(u, pts[pts.length-1][1])}</p>
      <svg class="chart" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="#22395A" stroke-width="2"/>${pts.map((p, i) => `<circle class="hit" cx="${x(i)}" cy="${y(p[1])}" r="3.5" fill="#C2A263"${tipAttr(`<b>${p[0]}</b><br>${esc(label)}: ${fmt(u, p[1])}<br><span class="k">league, games-weighted over every coach-season</span>`)}></circle>`).join('')}
      <text x="30" y="${H-4}" font-size="9" fill="#8B9099">${pts[0][0]}</text><text x="${W-10}" y="${H-4}" font-size="9" fill="#8B9099" text-anchor="end">${pts[pts.length-1][0]}</text></svg></div>`;
  }).join('');
}

// ---------------------------------------------------------------- search (and "+ Compare", which borrows it)
function wireSearch(){
  const q = document.getElementById('q'), box = document.getElementById('results');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
  let sel = -1, hits = [];
  function show(){
    const v = norm(q.value);
    if (!v) { box.hidden = true; return; }
    hits = IDX.coaches.filter(c => norm(c.name).includes(v) && !(addMode && COACH && c.id === COACH.id)).sort((a, b) => (norm(b.name).startsWith(v) - norm(a.name).startsWith(v)) || (b.all_g - a.all_g)).slice(0, 12);
    box.innerHTML = (addMode ? '<div class="res"><span class="rs">adding a coach to compare — Esc to cancel</span></div>' : '') + hits.map((c, i) => `<div class="res${i === sel ? ' on' : ''}" data-i="${i}"><span class="rn">${esc(c.name)}</span><span class="rs">${c.hc ? `${c.all_w}–${c.all_l}, ${c.all_seasons} seasons` : 'assistant'}${c.first ? ` · ${c.first.slice(0,4)}–${(c.last||'').slice(0,4)}` : ''}</span></div>`).join('') || '<div class="res"><span class="rs">no coach by that name</span></div>';
    box.hidden = false;
    box.querySelectorAll('.res[data-i]').forEach(r => r.addEventListener('mousedown', () => go(+r.dataset.i)));
  }
  function go(i){
    const c = hits[i]; if (!c) return; box.hidden = true; q.value = '';
    if (addMode) { leaveAdd(); addCompare(c.id); return; }
    location.hash = 'c=' + c.id;
  }
  q.addEventListener('input', () => { sel = -1; show(); });
  q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); show(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); show(); } else if (e.key === 'Enter') go(Math.max(0, sel)); else if (e.key === 'Escape') { box.hidden = true; leaveAdd(); } });
  q.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
}
function enterAdd(){ addMode = true; const q = document.getElementById('q'); q.placeholder = 'Add a coach to compare…'; q.classList.add('adding'); q.focus(); }
function leaveAdd(){ addMode = false; const q = document.getElementById('q'); q.placeholder = 'Search a head coach or assistant…'; q.classList.remove('adding'); }
