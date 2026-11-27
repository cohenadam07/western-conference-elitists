'use strict';
// NBA GM Savant — reads /gms/index.json and /gms/g/<gm>.json (pipeline/basketball/gm/build_page.py).
// Only the headline carries a percentile, always with its pool. Skills are what happened, in Savant
// points, with no percentile: none repeats (How it works). Grades are the model's view, not a verdict.
const BASE = '/gms';
const SAVANT = '/nba-savant?p=';
const COACH = '/nba-coaching-savant#c=';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-US'));
const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const ord = (n) => (n == null ? '—' : n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')));
const yr = (d) => (d ? d.slice(0, 4) : 'today');
// titles: two decimals, three below a tenth (a single decision's share of a title is often small)
// titles, always to two decimals (expected titles, titles added, playoff luck): a sign only when the rounded value is not zero
const tt = (v) => { if (v == null) return '—'; const r = Math.abs(v).toFixed(2); return (+r === 0 ? '' : v > 0 ? '+' : '−') + r; };
const tn = (v) => (v == null ? '—' : Math.abs(v).toFixed(2));
// one decision's expected titles are small (most under 0.01): the log and the moves print them to three decimals, every row the same
const td3 = (v) => { if (v == null) return '—'; const r = Math.abs(v).toFixed(3); return (+r === 0 ? '' : v > 0 ? '+' : '−') + r; };
// titles won: whole when whole; a title shared within a season (a co-lead, or a season he took over midway) leaves a
// fraction, shown to one decimal with a marker whose tap says why
const tw = (v) => {
  if (v == null) return '—';
  if (Math.abs(v - Math.round(v)) < 0.005) return String(Math.round(v));
  return tip(`Shared credit: ${v.toFixed(2)} titles. At least one of his title seasons was shared (a co-lead, or a season he took over or left midway), and each GM gets his share of that title, the same split as the points.`, `${v.toFixed(1)}<sup class="shm" aria-hidden="true">*</sup>`, 'sh');
};
const span = (s) => `${yr(s.start)}–${s.end ? yr(s.end) : 'today'}`;
const TEAM = { ATL: 'Atlanta', BOS: 'Boston', BRK: 'Brooklyn', CHI: 'Chicago', CHO: 'Charlotte', CLE: 'Cleveland', DAL: 'Dallas', DEN: 'Denver', DET: 'Detroit', GSW: 'Golden State',
  HOU: 'Houston', IND: 'Indiana', LAC: 'LA Clippers', LAL: 'LA Lakers', MEM: 'Memphis', MIA: 'Miami', MIL: 'Milwaukee', MIN: 'Minnesota', NOP: 'New Orleans', NYK: 'New York',
  OKC: 'Oklahoma City', ORL: 'Orlando', PHI: 'Philadelphia', PHO: 'Phoenix', POR: 'Portland', SAC: 'Sacramento', SAS: 'San Antonio', TOR: 'Toronto', UTA: 'Utah', WAS: 'Washington' };
const team = (t) => TEAM[t] || t;
function pctColor(p) {
  const lo = [28, 78, 134], mid = [194, 192, 182], hi = [188, 58, 44];
  const t = Math.max(0, Math.min(100, p)) / 100, [a, b, u] = t < 0.5 ? [lo, mid, t / 0.5] : [mid, hi, (t - 0.5) / 0.5];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * u)).join(',')})`;
}
// a thick percentile bar, filled to the percentile and colored by it, the number on the bar
function pbar(p, label, value, pool, k) {
  return `<div class="row nochart"><div class="rl"><div class="name">${esc(label)} ${info(k)}</div><div class="tag">${esc(pool)}</div></div>
    <div class="track"><div class="fill" style="width:${p}%;background:${pctColor(p)}"></div><span class="pnum" style="left:calc(${Math.max(p, 6)}% - 26px)">${ord(p)}</span></div>
    <div class="rv">${value}</div></div>`;
}
// a value bar for what happened: centered on zero, scaled to the largest on the board, no percentile
function vbar(label, v, max, tag, k, extra = '') {
  const w = max ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  return `<div class="row nochart vrow"><div class="rl"><div class="name">${esc(label)} ${info(k)}${extra ? ` ${extra}` : ''}</div><div class="tag">${esc(tag)}</div></div>
    <div class="track vtrack"><div class="zero"></div><div class="vfill ${v < 0 ? 'neg' : 'pos'}" style="${v < 0 ? `right:50%` : `left:50%`};width:${w}%"></div></div>
    <div class="rv">${sgn(v)}</div></div>`;
}
// tap-to-open explainers (EXPL is page/explainers.json, inlined by assemble.py)
const info = (k) => (EXPL[k] ? `<button class="ib" type="button" data-x="${k}" aria-expanded="false" aria-label="What is ${esc(EXPL[k].title)}?">i</button>` : '');
function openExpl(btn) {
  const pop = $('expl'), k = btn.dataset.x, e = EXPL[k];
  if (!pop.hidden && pop.dataset.k === k) { closeExpl(); return; }
  document.querySelectorAll('.ib[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  pop.dataset.k = k;
  pop.innerHTML = `<div class="xh">${esc(e.title)}<button class="xx" type="button" aria-label="Close">×</button></div><p><b>What it is.</b> ${esc(e.what)}</p><p><b>How it's calculated.</b> ${esc(e.how)}</p><p><b>The data.</b> ${esc(e.data)}</p><p><b>Limits.</b> ${esc(e.limits)}</p>`;
  pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), W = Math.min(360, window.innerWidth - 24);
  pop.style.width = W + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - W - 12, r.left + window.scrollX - 20)) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  pop.querySelector('.xx').focus();
}
// tap-to-read details (a grade's model, a low-confidence reason, a frozen date): a button, so a phone can open it
const tip = (text, inner, cls = '') => (text ? `<button class="tipb ${cls}" type="button" data-tip="${esc(text)}">${inner}</button>` : inner);
function openTip(btn) {
  const pop = $('expl'), k = 'tip:' + btn.dataset.tip;
  if (!pop.hidden && pop.dataset.k === k) { closeExpl(); return; }
  pop.dataset.k = k;
  pop.innerHTML = `<div class="xh">Details<button class="xx" type="button" aria-label="Close">×</button></div><p>${esc(btn.dataset.tip)}</p>`;
  pop.hidden = false;
  const r = btn.getBoundingClientRect(), W = Math.min(320, window.innerWidth - 24);
  pop.style.width = W + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - W - 12, r.left + window.scrollX - 20)) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  pop.querySelector('.xx').focus();
}
function closeExpl() { const pop = $('expl'); pop.hidden = true; document.querySelectorAll('.ib[aria-expanded="true"]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); }); }
const pl = (id, name) => (id ? `<a class="pl" href="${SAVANT}${encodeURIComponent(id)}">${esc(name)}</a>` : esc(name));
const gmLink = (file, name) => `<a class="gl" href="#g=${encodeURIComponent(file)}">${esc(name)}</a>`;
// salaries (v1.1.0): every salary field is in the data now, null until then. A number shows where one is present; where
// none is, a "salaries coming" badge opens the banner's list at what salaries will change there (SALARY_SLOTS.md).
const SALON = () => !!(IDX && IDX.meta.salaries && IDX.meta.salaries.available);
const soon = (k) => (SALON() ? '' : `<button class="soon" type="button" data-soon="${k}" aria-label="Salaries coming: what they will change">salaries coming</button>`);
const money = (v) => (v == null ? '—' : `$${(v / 1e6).toFixed(1)}M`);
const vpd = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`);
function salBanner() {
  const S = IDX.meta.salaries, b = $('salaries');
  if (!S || S.available) { b.hidden = true; return; }
  $('salList').innerHTML = S.changes.map((c) => `<li data-k="${esc(c.key)}"><b>${esc(c.what)}:</b> ${esc(c.change)}.</li>`).join('');
  b.hidden = false;
}
function openSoon(btn) {
  const b = $('salaries');
  b.open = true;
  b.querySelectorAll('li').forEach((li) => li.classList.toggle('hl', li.dataset.k === btn.dataset.soon));
  b.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  b.querySelector('summary').focus({ preventScroll: true });
}

let IDX = null, CUR = null, CURFILE = null, SPELL = 0, LOGTYPE = 'all';
const cache = {};
const load = (p) => (cache[p] = cache[p] || fetch(`${BASE}/${p}`).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }));

// ---------------------------------------------------------------- home and leaders
// Ranked by the blend at the default: points + lambda x expected titles added, lambda set so each accounts for half of
// the spread across every GM spell. The slider runs from wins only (0) through the default (50) to titles only (100):
// lambda(p) = lambda x p / (100 - p).
const STATE = { home: { metric: 'blended', p: 50 }, lb: { metric: 'blended', p: 50 } };
const lam = () => IDX.meta.titles.lambda;
const lamAt = (p) => lam() * p / (100 - p);
function score(r, metric, p) {
  if (metric === 'points') return r.gva;
  if (metric === 'titles' || p >= 100) return r.titles_added;
  return r.gva + lamAt(p) * r.titles_added;
}
const shown = (v, metric, p) => (metric === 'titles' || (metric === 'blended' && p >= 100) ? tt(v) : sgn(v));
function pctIn(v, xs) { const lo = xs.filter((x) => x < v).length; return Math.round(100 * lo / Math.max(1, xs.length - 1)); }
function boardTable(rows, n, which, st, pool) {
  const at = which === 'at_time', m = st.metric, p = st.p;
  const xs = pool.map((r) => score(r, m, p));
  const name = m === 'points' ? `GM Value Added${at ? ', at the time' : ''}` : m === 'titles' ? `Expected titles added${at ? ', at the time' : ''}` : (p >= 100 ? 'Titles only' : p <= 0 ? 'Wins only (points)' : `Blended${at ? ', at the time' : ''}`);
  const key = m === 'points' ? (at ? 'gva_at_time' : 'gva') : m === 'titles' ? 'titles_added' : 'blended';
  const head = `<tr><th>GM</th><th>${name} ${info(key)}</th>${m !== 'points' ? `<th>Points ${info(at ? 'gva_at_time' : 'gva')}</th>` : ''}${m !== 'titles' ? `<th>Expected titles added ${info('titles_added')}</th>` : ''}<th>Titles won ${info('titles_won')}</th><th>Expected titles ${info('titles_expected')}</th><th>Playoff luck ${info('playoff_luck')}</th><th>Percentile ${info('pct')}</th><th class="tm">Team</th><th>Years</th></tr>`;
  return head + rows.slice(0, n || rows.length).map((r) => { const v = score(r, m, p), pc = pctIn(v, xs); return `<tr class="link" data-g="${esc(r.file)}"><td>${gmLink(r.file, r.name)}</td>
    <td><b>${shown(v, m, p)}</b></td>${m !== 'points' ? `<td>${sgn(r.gva)}</td>` : ''}${m !== 'titles' ? `<td class="tn">${tt(r.titles_added)}</td>` : ''}<td class="tn">${tw(r.titles_won)}</td><td class="tn">${tn(r.titles_expected)}</td><td class="tn">${tt(r.playoff_luck)}</td><td><span class="pchip" style="background:${pctColor(pc)}">${ord(pc)}</span></td><td class="tm">${esc(r.team_name || r.team)}</td><td>${span(r)}</td></tr>`; }).join('');
}
const poolOf = (which) => (which === 'at_time' ? IDX.meta.pool_at_time : which === 'active' ? IDX.meta.pool_active : IDX.meta.pool_all);
function ranked(which, st) {
  const pool = IDX.boards[which === 'at_time' ? 'at_time' : 'all'];
  const rows = IDX.boards[which].slice().sort((a, b) => score(b, st.metric, st.p) - score(a, st.metric, st.p));
  return { rows, pool };
}
function blendNote(k) {
  const st = STATE[k], c = $(k + 'BlendCtl');
  c.hidden = st.metric !== 'blended';
  const p = st.p;
  $(k + 'BlendNote').textContent = p <= 0 ? 'Wins only: ranked by points.' : p >= 100 ? 'Titles only: ranked by expected titles added.'
    : `One title = ${Math.round(lamAt(p)).toLocaleString('en-US')} points${p === 50 ? ' (the default: points and titles each half of the spread)' : ` (default ${Math.round(lam()).toLocaleString('en-US')})`}.`;
}
function poolLine(which, st) {
  const what = st.metric === 'points' ? 'GM Value Added' : st.metric === 'titles' ? 'expected titles added' : 'the blend';
  return `Ranked by ${what}; percentiles of ${what} against ${which === 'active' ? IDX.meta.pool_all : poolOf(which)}. Points: ${IDX.meta.points_per_win} = one win; titles: expected titles, seasons ${IDX.meta.titles.seasons}.`;
}
function home(which) {
  which = which || document.querySelector('#homeSeg [aria-pressed="true"]').dataset.v;
  const st = STATE.home, { rows, pool } = ranked(which, st);
  blendNote('home');
  $('homePool').textContent = poolLine(which, st);
  const top = rows.slice(0, 15), bottom = rows.slice(-15).reverse();
  $('homeBoard').innerHTML = `<div class="panels stack"><div><div class="group-h">Top 15</div><div class="scroll"><table class="t">${boardTable(top, 0, which, st, pool)}</table></div></div>
    <div><div class="group-h">Bottom 15</div><div class="scroll"><table class="t">${boardTable(bottom, 0, which, st, pool)}</table></div></div></div>`;
}
function leaders(which) {
  which = which || document.querySelector('#lbSeg [aria-pressed="true"]').dataset.v;
  const st = STATE.lb, { rows, pool } = ranked(which, st);
  blendNote('lb');
  $('lbPool').textContent = `Two or more seasons in charge. ${poolLine(which, st)}`;
  $('lb').innerHTML = boardTable(rows, 0, which, st, pool);
  const sel = $('skillSel');
  if (!sel.options.length) sel.innerHTML = Object.entries(IDX.skills).map(([k, s]) => `<option value="${esc(k)}">${esc(s.label)}</option>`).join('');
  const s0 = IDX.skills[sel.value], s = { ...s0, rows: which === 'active' ? s0.rows.filter((r) => r.active) : s0.rows };
  $('skillNote').innerHTML = `${info({ drafting: 'drafting', 'second-round finds': 'second_round', 'deviation success': 'deviation', 'fit picks': 'fit', holding: 'holding', trades: 'trades_out', 'free agency': 'fa', 'role players': 'role', 're-signing and extensions': 'resign', 'coach hiring': 'coach' }[sel.value])} ${esc(s.verdict)}. Savant points, how it turned out, weighted by his share of the credit${which === 'active' ? '; active GMs' : ''}.${{ 'free agency': ' ' + soon('fa'), 're-signing and extensions': ' ' + soon('resign'), trades: ' ' + soon('trades') }[sel.value] || ''}`;
  const max = Math.max(...s.rows.map((r) => Math.abs(r.value)), 1);
  const part = (rows) => rows.map((r) => vbar(`${r.name}, ${r.team_name || r.team} ${span(r)}`, r.value, max, 'what happened')).join('');
  $('skillBoard').innerHTML = `<div class="group-h">Most</div>${part(s.rows.slice(0, 12))}<div class="group-h">Least</div>${part(s.rows.slice(-8).reverse())}`;
}
function controls(k, redraw) {
  $(k + 'Metric').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $(k + 'Metric').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); STATE[k].metric = b.dataset.v; redraw(); });
  $(k + 'Blend').addEventListener('input', (e) => { STATE[k].p = +e.target.value; redraw(); });
}

// ---------------------------------------------------------------- one GM
function show(file) {
  load(`g/${file}.json`).then((g) => { CUR = g; CURFILE = file; SPELL = Math.max(0, g.spells.findIndex((s) => s.active)); if (SPELL < 0) SPELL = g.spells.length - 1; LOGTYPE = 'all'; card(); })
    .catch(() => { $('name').textContent = 'Not found'; });
}
function card() {
  const g = CUR, s = g.spells[SPELL];
  view('card');
  document.title = `${g.name} — NBA GM Savant — WCE Hoops`;
  $('name').textContent = g.name;
  const mono = g.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const ph = (IDX.people.find((p) => p.file === CURFILE) || {}).photo;
  $('ini').innerHTML = ph ? `<img src="${esc(ph.src)}" alt="${esc(g.name)}">` : `<span class="mono">${esc(mono)}</span>`;
  $('ini').classList.toggle('hasphoto', !!ph);
  $('photoCredit').textContent = ph && ph.credit ? `Photo: ${ph.credit}` : '';
  const coach = g.coach_id ? ` · also a head coach: <a href="${COACH}${encodeURIComponent(g.coach_id)}">NBA Coaching Savant</a>` : '';
  $('meta').innerHTML = `${g.spells.map((x) => `<b>${esc(x.team_name || team(x.team))}</b> ${span(x)}`).join(' · ')}${coach}`;
  $('spellChips').innerHTML = g.spells.length > 1 ? g.spells.map((x, i) => `<button class="chip" aria-pressed="${i === SPELL}" data-i="${i}">${esc(x.team_name || x.team)} ${span(x)}</button>`).join('') : '';
  $('report').textContent = s.report;
  $('gvaSince').textContent = `${span(s)}${s.early_era ? ' · early era' : ''}`;
  const pool = s.pct_all == null ? 'under two seasons: not ranked' : `${s.active ? 'on projection (still in office)' : 'as it turned out'} · vs ${IDX.meta.pool_all}`;
  $('gva').innerHTML = (s.pct_all == null ? `<p class="cap">Under two seasons in charge, so GM Value Added (${sgn(s.gm_value_added['0.05'])}) is shown but not ranked.</p>` :
    pbar(s.pct_all, 'GM Value Added', sgn(s.gm_value_added['0.05']), pool, 'gva') + (s.pct_active != null ? pbar(s.pct_active, 'Among active GMs', sgn(s.gm_value_added['0.05']), `vs ${IDX.meta.pool_active}`, 'pct') : ''));
  const t = (l, v, sub, k, cls = '') => `<div class="tile${cls}"><div class="tl">${l} ${info(k)}</div><div class="tv">${v}</div><div class="ts">${sub}</div></div>`;
  $('inhNote').innerHTML = s.inherited_note ? `${esc(s.inherited_note)} ${info('inherited')}` : '';
  $('inhNote').hidden = !s.inherited_note;
  $('gvaTiles').innerHTML = t('Per season', sgn(s.gm_value_added_per_season), `${s.seasons.toFixed(1)} seasons`, 'per_season') +
    t('Produced', sgn(s.produced_margin_adj), 'luck-adjusted margin, above average', 'produced') + t('Left behind', num(s.left['0.05']), `${s.active ? 'projected' : 'as it turned out'}, ten seasons`, 'left') +
    t('Inherited', num(s.inherited['0.05']), `${s.active ? 'projected' : 'as it turned out'}, ten seasons`, 'inherited') + t('Player-value line', sgn(s.gm_value_added_player['0.05']), 'production as Savant player value', 'player_line') +
    (s.active ? '' : t('At the time', sgn(s.gm_value_added_at_time['0.05']), `inherited ${num(s.inherited_at_time['0.05'])}, left ${num(s.left_at_time['0.05'])}, as projected`, 'gva_at_time')) +
    (s.value_per_dollar == null ? '' : t('Value per dollar', vpd(s.value_per_dollar), 'points per $1M of payroll', 'fa') + t('Payroll', money(s.payroll_per_season), 'a season, his share', 'cap') +
      t('Tax paid', money(s.tax_paid), 'his share', 'cap') + t('Dead money', money(s.dead_money), 'his share', 'cap'));
  $('rates').innerHTML = `<table class="t"><tr><th>Discount a year ${info('rates')}</th><th>0%</th><th>5% (headline)</th><th>10%</th><th>20%</th></tr>
    <tr><td>GM Value Added</td>${['0.0', '0.05', '0.1', '0.2'].map((k) => `<td>${sgn(s.gm_value_added[k])}</td>`).join('')}</tr>${s.active ? '' : `
    <tr><td>At the time ${info('gva_at_time')}</td>${['0.0', '0.05', '0.1', '0.2'].map((k) => `<td>${sgn(s.gm_value_added_at_time[k])}</td>`).join('')}</tr>`}</table>`;
  const sp = s.splits.length ? `<p class="cap"><b>Shared credit.</b> ${info('shared')} ${s.splits.slice(0, 6).map((x) => `${x.from} to ${x.to}: ${x.people.map((p) => `${esc(p[0])} ${Math.round(p[1] * 100)}%`).join(', ')} (${esc(x.why)})`).join('; ')}${s.splits.length > 6 ? `; and ${s.splits.length - 6} more` : ''}.</p>` : '';
  const over = s.leads_over.length ? `<p class="cap">Ran the team over ${s.leads_over.map(esc).join(', ')} (shown under him, not counted).</p>` : '';
  const und = (g.under || []).length ? `<p class="cap">Also worked under: ${g.under.map((u) => `${esc(u.under)} (${esc(u.team_name || u.team)} ${yr(u.from)}–${yr(u.to)}, ${esc(u.title || '')})`).join('; ')}.</p>` : '';
  const walked = s.walked_before_left.length ? `<p class="cap">Not counted in what he left: ${s.walked_before_left.map(esc).join(', ')}, who left in free agency before a game for the next GM. ${soon('left_fa')}</p>` : '';
  $('splits').innerHTML = sp + over + und + walked;
  // titles: the blend's percentile and expected titles added, each with its pool
  const basis = s.active ? 'on projection (still in office)' : 'as it turned out';
  $('tbars').innerHTML = s.pct_blended == null ? `<p class="cap">Under two seasons in charge: blended ${sgn(s.blended)}, expected titles added ${tt(s.titles_added)}, not ranked.</p>` :
    pbar(s.pct_blended, 'Blended', sgn(s.blended), `${basis} · one title = ${Math.round(IDX.meta.titles.lambda).toLocaleString('en-US')} points · vs ${IDX.meta.pool_all}`, 'blended') +
    pbar(s.pct_titles, 'Expected titles added', tt(s.titles_added), `${basis} · vs ${IDX.meta.pool_all}`, 'titles_added');
  $('titleTiles').innerHTML = t('Expected titles added', tt(s.titles_added), 'above an average GM, plus left minus inherited', 'titles_added') +
    t('While he ran it', tt(s.titles_produced_above_average), 'title chances above an average team', 'titles_produced') +
    t('Left behind', tn(s.titles_left), `${s.active ? 'projected' : 'as it turned out'}, ten seasons`, 'titles_left') + t('Inherited', tn(s.titles_inherited), `${s.active ? 'projected' : 'as it turned out'}, ten seasons`, 'titles_left') +
    t('Titles won', tw(s.titles_won), 'his share of each title season', 'titles_won') + t('Expected titles', tn(s.titles_expected), 'the same seasons, as the model rated them', 'titles_expected') +
    (s.active ? '' : t('At the time', tt(s.titles_added_at_time), `inherited ${tn(s.titles_inherited_at_time)}, left ${tn(s.titles_left_at_time)}, as projected`, 'titles_at_time'));
  const best = Object.entries(s.titles_by_season || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).filter((x) => x[1] > 0);
  $('titleNote').innerHTML = best.length ? `His best title chances above an average team's: ${best.map(([y, v]) => `${+y - 1}-${String(y).slice(2)} ${tt(v)}`).join(', ')} (his share of the season).` : '';
  const L = s.detail.luck || {};
  $('luck').innerHTML = t('Playoff luck', tt(s.playoff_luck), 'titles won minus expected titles', 'playoff_luck') + t('Lottery', sgn(L.lottery), 'his own pick against its odds', 'lottery') + t('Games missed', num(L.games_missed_value), "value lost to his players' absences", 'games_missed') +
    t('Grade gap', sgn(L.grade_gap), 'how it turned out minus at the time', 'grade_gap');
  skills(s);
  portfolio(s);
  const lst = (rows) => rows.length ? rows.map((a) => `<div class="lrow"><span class="lv">${num(a.value)}</span><span>${a.player_id ? pl(a.player_id, a.label) : esc(a.label)}${a.years_of_control == null ? '' : ` <span class="ts">${a.years_of_control} yr${a.years_of_control === 1 ? '' : 's'} of control</span>`}</span></div>`).join('') : '<p class="cap">Nothing of value on the books.</p>';
  $('inhSoon').innerHTML = $('leftSoon').innerHTML = soon('lists');
  $('inhDay').textContent = `on ${s.start}`; $('leftDay').textContent = s.end ? `on ${s.end}` : 'today';
  $('inh').innerHTML = lst(s.inherited_list); $('left').innerHTML = lst(s.left_list);
  $('activePanel').hidden = !s.active;
  if (s.active) {
    $('activeTiles').innerHTML = t("Today's minutes he built", s.roster_built == null ? '—' : Math.round(s.roster_built * 100) + '%', 'players who came in on his watch, 2026-27 minutes', 'built') +
      t('Picks owned', (s.picks_owned || []).length, 'future picks on the books', 'picks') +
      (s.cap_outlook ? t('Cap outlook', money(s.cap_outlook.payroll), `${esc(s.cap_outlook.apron_status || '')}${s.cap_outlook.cap_space != null ? `, ${money(s.cap_outlook.cap_space)} of space` : ''}`, 'cap')
        : `<div class="tile soon-card"><div class="tl">Cap outlook ${info('cap')}</div><div class="tv">Coming soon</div><div class="ts">payroll, cap space, tax and aprons arrive with salaries in v${esc(IDX.meta.salaries.arrives)}</div>${soon('cap')}</div>`);
    $('picks').innerHTML = (s.picks_owned || []).map((a) => `<div class="lrow"><span class="lv">${num(a.value)}</span><span>${esc(a.label)}</span></div>`).join('');
  }
  moves(s);
  log();
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function skills(s) {
  const d = s.detail;
  if (!d || !d.drafting) { $('skills').innerHTML = '<p class="cap">No graded decisions credited to him in this spell.</p>'; return; }
  const rows = [
    ['Drafting', d.drafting.over_slot, `${d.drafting.picks} picks: ${d.drafting.board_picks || 0} against the consensus board, ${d.drafting.picks - (d.drafting.board_picks || 0)} against the slot`, 'drafting'],
    ['Second-round finds', d.drafting.second_round_finds, 'value found after pick 30', 'second_round'],
    ['Undrafted finds', d.undrafted_finds, 'undrafted signings that worked', 'undrafted'],
    ['Trades, as they turned out', d.trades.turned_out, `${d.trades.n} trades`, 'trades_out', 'trades'],
    ['Trades, at the time', d.trades.at_time, 'with only what was known that day', 'trades_at'],
    ['Free agency', d.free_agency.stars + d.free_agency.role, 'new signings', 'fa', 'fa'],
    ['Role players', d.role_players, 'two-ways, 10-days, Exhibit 10s, second-rounders', 'role'],
    ['Development', d.development.value_over_projection, 'beating the projection after he got them; shared with the coach', 'development'],
    ['Holding young players', (d.holding || {}).turned_out, `${(d.holding || {}).holds || 0} windows he kept a young player through; against an average GM, not added to GM Value Added`, 'holding'],
    ['Coach hiring and firing', d.coach_hiring, 'scored from 2002-03', 'coach'],
  ];
  const re = ['Re-signing and extensions', d.re_signing, 'its own scale: the value of players kept; may reflect the stars he had', 'resign', 'resign'];
  const max = Math.max(...rows.map((r) => Math.abs(r[1] || 0)), 1);
  const pass = (d.drafting.passed_on || []).map((x) => `${x.year}: took ${esc(x.took)} at ${x.slot}; ${esc(x.passed_on)} went ${x.their_slot}th (${sgn(x.by)})`).join(' · ');
  const tw = d.trades.by_window || {}, bs = d.trades.buying_vs_selling || {};
  $('skills').innerHTML = rows.map((r) => vbar(r[0], r[1] || 0, max, r[2], r[3], r[4] ? soon(r[4]) : '')).join('') +
    `<div class="group-h">On its own scale</div>` + vbar(re[0], re[1] || 0, Math.max(Math.abs(re[1] || 0), 1) * 1.25, re[2], re[3], soon(re[4])) +
    `<div class="cap">${info('windows')} Trades by window: deadline ${sgn(tw.deadline)}, offseason ${sgn(tw.offseason)}, other ${sgn(tw.other)} · buying ${sgn(bs.buying)}, selling ${sgn(bs.selling)}` +
    `${d.trades.best_partner ? ` · best against ${esc(d.trades.best_partner[0])} (${sgn(d.trades.best_partner[1])}), worst against ${esc(d.trades.worst_partner[0])} (${sgn(d.trades.worst_partner[1])})` : ''}` +
    `${pass ? `<br><b>Who he passed on</b> ${info('passed')}: ${pass}` : ''}` +
    `${draftStyle(d.draft_style)}` +
    `${(d.holding && d.holding.biggest.length) ? `<br><b>Holding</b> ${info('holding')}: ${d.holding.biggest.map((x) => `${esc(x.player)} ${sgn(x.turned_out)} (${x.windows} windows)`).join(' · ')}` : ''}` +
    `<br><b>Style</b> ${info('style')}: ${d.style.decisions_per_season} decisions a season${d.style.age_acquired ? `, players acquired by trade averaged ${d.style.age_acquired}` : ''}. Value per dollar and cap management arrive with salaries.</div>`;
}
function draftStyle(ds) {
  if (!ds) return '';
  const c = (k, x) => `${k} ${x.n}${x.n ? ` (${sgn(x.value_over_slot)} over the slot on average, ${x.minutes_per_season_for_team == null ? 'no minutes yet' : num(x.minutes_per_season_for_team) + ' minutes a season for his team'})` : ''}`;
  return `<br><b>Draft style</b> ${info('deviation')}: off the consensus board on ${Math.round(100 * ds.deviation_rate)}% of ${ds.board_picks} board picks` +
    (ds.deviations ? `, ${ds.mean_reach > 0 ? 'reaching' : 'falling'} ${Math.abs(ds.mean_reach)} board places on average; those picks beat the player he passed on ${Math.round(100 * ds.hit_rate)}% of the time, ${sgn(ds.deviation_value)} in all` : '') +
    `. ${info('fit')} Talent and fit, ${esc(ds.fit_label)}: ${c('talent picks', ds.talent)}; ${c('fit picks', ds.fit)}; ${c('other passes', ds.other)}.`;
}
function portfolio(s) {
  const P = s.portfolio, svg = $('port'), W = svg.clientWidth || 860, Hh = 220, m = { l: 44, r: 12, t: 12, b: 26 };
  if (!P.length) { svg.innerHTML = ''; return; }
  const t0 = Date.parse(P[0].date), t1 = Date.parse(P[P.length - 1].date) || t0 + 1;
  const vmax = Math.max(...P.map((p) => p.value), 1);
  const x = (d) => m.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
  const y = (v) => Hh - m.b - (v / vmax) * (Hh - m.t - m.b);
  const line = (k, cls) => `<path class="${cls}" d="${P.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[k]).toFixed(1)}`).join('')}"/>`;
  const ticks = [0, 0.5, 1].map((f) => `<g><line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(vmax * f)}" y2="${y(vmax * f)}"/><text class="ax" x="${m.l - 6}" y="${y(vmax * f) + 3}" text-anchor="end">${num(vmax * f)}</text></g>`).join('');
  const years = [...new Set(P.map((p) => p.date.slice(0, 4)))].filter((_, i, a) => a.length < 12 || i % Math.ceil(a.length / 10) === 0)
    .map((yy) => `<text class="ax" x="${x(yy + '-07-01')}" y="${Hh - 8}" text-anchor="middle">${yy}</text>`).join('');
  const marks = s.marks.filter((k) => k.date >= P[0].date && k.date <= P[P.length - 1].date).map((k, i) => {
    const near = P.reduce((a, b) => (Math.abs(Date.parse(b.date) - Date.parse(k.date)) < Math.abs(Date.parse(a.date) - Date.parse(k.date)) ? b : a));
    return `<circle class="mark ${k.turned_out < 0 ? 'neg' : 'pos'}" cx="${x(k.date)}" cy="${y(near.value)}" r="5" tabindex="0" data-i="${i}"><title>${esc(k.date)}: ${esc(k.label)} (${sgn(k.turned_out)})</title></circle>`;
  }).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.setAttribute('height', Hh);
  svg.innerHTML = ticks + years + line('picks', 'lpicks') + line('players', 'lplayers') + line('value', 'lall') + marks +
    P.map((p, i) => `<rect class="hit" x="${x(p.date) - 6}" y="${m.t}" width="12" height="${Hh - m.t - m.b}" data-p="${i}"/>`).join('');
  const tip = $('tip');
  const MOVES = s.marks.filter((k) => k.date >= P[0].date && k.date <= P[P.length - 1].date);
  const show = (r) => {
    const p = P[+r.dataset.p], i = +r.dataset.p;
    const lo = i ? P[i - 1].date : '0000', hi = P[i + 1] ? P[i + 1].date : '9999';
    const near = MOVES.filter((k) => k.date > lo && k.date <= hi);         // his big moves since the point before
    tip.hidden = false; tip.style.left = Math.min(W - 220, x(p.date) + 8) + 'px'; tip.style.top = '10px';
    tip.innerHTML = `<b>${p.date}</b><br>All ${num(p.value)} · players ${num(p.players)} · picks ${num(p.picks)}<br><span class="ts">${p.top.map(esc).join(', ')}</span>` +
      near.map((k) => `<br><span class="ts">${esc(k.date)}: ${esc(k.label)} (${sgn(k.turned_out)})</span>`).join('');
  };
  // a tap (phone) or a hover (mouse) on a point shows it; a tap elsewhere on the chart, or leaving it, hides it
  svg.querySelectorAll('.hit').forEach((r) => { r.addEventListener('mouseenter', () => show(r)); r.addEventListener('click', (e) => { e.stopPropagation(); show(r); }); });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; });
  if (!window.__portTap) { window.__portTap = true; document.addEventListener('click', (e) => { if (!e.target.closest('#port')) $('tip').hidden = true; }); }
  $('portLegend').innerHTML = '<span class="leg"><i class="sw all"></i>everything</span><span class="leg"><i class="sw pl"></i>players</span><span class="leg"><i class="sw pk"></i>picks</span><span class="leg"><i class="dot pos"></i><i class="dot neg"></i>his biggest moves (tap or hover the line)</span>';
}
function node(a) {
  const name = a.player_id ? pl(a.player_id, a.label) : (a.became_id ? `${esc(a.label.split(' -> ')[0])} → ${pl(a.became_id, (a.label.split(' -> ')[1] || '').split(' (#')[0])}` : esc(a.label));
  const kids = (a.then || []).map((st) => `<li><span class="how">${st.how === 'became' ? 'became' : `traded to ${esc(st.to)}`} on ${esc(st.date)}${st.sent_with.length ? `, with ${st.sent_with.map((x) => esc(x.label)).join('; ')}` : ''}</span><ul>${st.got.map((g) => `<li>${node(g)}</li>`).join('')}</ul></li>`).join('');
  return kids ? `<details><summary>${name}</summary><ul>${kids}</ul></details>` : `<span class="leafname">${name}</span>`;
}
function moves(s) {
  $('moves').innerHTML = s.big_moves.length ? s.big_moves.map((m) => `<div class="move"><div class="mh"><span class="md">${esc(m.date)}</span> ${esc(m.label)}</div>
    <div class="mg">At the time <b>${m.at_time == null ? 'not graded' : sgn(m.at_time)}</b> · how it turned out <b>${sgn(m.turned_out)}</b> · expected titles <b>${td3(m.titles_turned_out)}</b> ${info('dec_titles')} · blended <b>${sgn(m.blended)}</b>${m.weight < 1 ? ` · his share ${Math.round(m.weight * 100)}%` : ''}</div>
    ${m.tree ? `<div class="tree">${m.tree.gave.length ? `<div class="gave">Gave: ${m.tree.gave.map((a) => (a.player_id ? pl(a.player_id, a.label) : esc(a.label))).join(', ')}</div>` : ''}<ul>${m.tree.got.map((a) => `<li>${node(a)}</li>`).join('')}</ul></div>` : ''}</div>`).join('') : '<p class="cap">No trades or drafts credited to him.</p>';
}
function boardNote(d) {
  if (d.best_available == null) return `${esc(d.grade_label || '')} ${info('board')}`;
  return d.easy_pick ? `took the consensus best available (No. ${d.consensus_rank} on the board) ${info('easy_picks')}`
    : `consensus No. ${d.consensus_rank}; the best available was ${esc(d.best_available)} (No. ${d.best_available_rank}) ${info('board')}`;
}
function log() {
  const D = CUR.decisions, types = ['all', ...new Set(D.map((d) => d.type))];
  $('logFilter').innerHTML = types.map((k) => `<button class="chip" aria-pressed="${k === LOGTYPE}" data-t="${esc(k)}">${esc(k)} ${k === 'all' ? D.length : D.filter((d) => d.type === k).length}</button>`).join('');
  const rows = D.filter((d) => LOGTYPE === 'all' || d.type === LOGTYPE).slice().reverse();
  $('logSince').textContent = `${D.length} decisions`;
  const sal = D.some((d) => d.salary_cost != null);
  $('logNote').innerHTML = LOGTYPE === 'left in free agency' ? `Players whose rights ended and who signed elsewhere ${info('left_fa')}. What keeping each would have cost, and whether it fit under the cap and aprons, arrives with salaries. ${soon('left_fa')}` : '';
  $('logNote').hidden = !$('logNote').innerHTML;
  $('log').innerHTML = `<tr><th>Date</th><th>Team</th><th>Decision</th><th>At the time ${info('at_time')}</th><th>How it turned out ${info('turned_out')}</th><th>Titles, at the time ${info('dec_titles')}</th><th>Titles, turned out ${info('dec_titles')}</th><th>Blended ${info('dec_blended')}</th>${sal ? `<th>Cost</th><th>Cap hit</th><th>Value per $1M</th><th>Dead money</th><th>Years of control</th>` : ''}<th>His share ${info('share')}</th><th>Graded by ${info('graded_by')}</th></tr>` + rows.slice(0, 400).map((d) => `<tr>
    <td>${esc(d.date)}</td><td>${esc(d.team_name || d.team)}</td><td class="dl">${d.player_id && !d.label.includes(' traded ') ? pl(d.player_id, d.label) : esc(d.label.length > 140 ? d.label.slice(0, 137) + '…' : d.label)}${d.coach_id ? ` <a href="${COACH}${encodeURIComponent(d.coach_id)}">coach</a>` : ''}${d.type === 'left in free agency' ? ` ${info('left_fa')}` : ''}${d.type === 'draft' ? ` <span class="ts">${boardNote(d)}</span>` : ''}${d.low_confidence.length ? ` ${tip(d.low_confidence.join('; '), 'low confidence', 'lc')}${info('low_conf')}` : ''}</td>
    <td>${tip(d.at_time_note || (d.models || []).join(', '), d.at_time == null ? '<span class="na">—</span>' : sgn(d.at_time))}</td><td>${sgn(d.turned_out)}</td><td class="tn">${td3(d.titles_at_time)}</td><td class="tn">${td3(d.titles_turned_out)}</td><td>${sgn(d.blended_turned_out)}</td>${sal ? `<td>${money(d.salary_cost)}</td><td>${money(d.cap_hit)}</td><td>${vpd(d.value_per_dollar)}</td><td>${money(d.dead_money)}</td><td>${d.years_of_control ?? '—'}</td>` : ''}<td>${d.weight < 1 ? Math.round(d.weight * 100) + '%' : ''}</td><td class="gb">${tip(`Graded by ${(d.models || []).join(', ') || 'no model'}; grade version ${d.grade_version || ''}${d.frozen_on ? `; frozen ${d.frozen_on}` : ''}`, esc((d.models || []).join(', ') || '—') + (d.frozen_on ? ` · frozen ${esc(d.frozen_on)}` : ''))}</td></tr>`).join('');
  $('logMore').textContent = rows.length > 400 ? `Showing the latest 400 of ${rows.length}. Every one is in the Data Room (nba gm_decisions).` : `Grades by ${CUR.decisions[0] ? CUR.decisions[0].grade_version : ''}; tap an at-the-time grade for the model that made it.`;
}

// ---------------------------------------------------------------- tree, method
function treeTab() {
  const by = {};
  IDX.tree.forEach((e) => { (by[e.senior] = by[e.senior] || []).push(e); });
  const file = (n) => (IDX.people.find((p) => p.name === n) || {}).file;
  $('treeList').innerHTML = Object.keys(by).sort().map((s) => `<div class="lrow tr"><span class="sen">${file(s) ? gmLink(file(s), s) : esc(s)}</span><span>${by[s].map((e) => `${file(e.junior) ? gmLink(file(e.junior), e.junior) : esc(e.junior)} <span class="ts">(${esc(e.team)} ${yr(e.from)}, ${esc(e.how)}, <a href="${esc(e.source)}">source</a>)</span>`).join('; ')}</span></div>`).join('');
}
function method() {
  $('notes').innerHTML = IDX.meta.notes.map(([k, v]) => `<div class="lrow"><span class="sen">${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  $('changelog').innerHTML = (IDX.meta.changelog || []).map(([v, d, t]) => `<div class="lrow"><span class="sen">v${esc(v)} <span class="ts">${d === 'coming' ? 'coming' : esc(d)}</span></span><span>${esc(t)}</span></div>`).join('');
  const T = ['date', 'oddeven', 'stakes', 'stake-weighted', 'spell'];
  $('rep').innerHTML = `<tr><th>Skill</th><th>Grade</th>${T.map((t) => `<th>${t}</th>`).join('')}<th>Verdict</th></tr>` + Object.entries(IDX.repeatability).map(([k, r]) => {
    const [sk, g] = k.split('|');
    return `<tr><td>${esc(sk)}</td><td>${g === 'at_time' ? 'at the time' : 'turned out'}</td>${T.map((t) => { const v = r[t] || {}; return `<td>${v.r == null ? '—' : tip(`95% ${v.lo.toFixed(2)} to ${v.hi.toFixed(2)}, ${v.people} people, smallest it can detect ${v.mde.toFixed(2)}`, (v.lo > 0 ? '<b>' : '') + v.r.toFixed(2) + (v.lo > 0 ? '</b>' : ''))}</td>`; }).join('')}<td class="dl">${esc(r.verdict)}</td></tr>`;
  }).join('');
}

// ---------------------------------------------------------------- shell
function view(v) {
  ['home', 'card', 'leaders', 'tree', 'method'].forEach((k) => { $(k).hidden = k !== v; });
  const tab = { home: 'gms', card: 'gms' }[v] || v;
  document.querySelectorAll('.sv-tab').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}
function route() {
  const h = location.hash.slice(1);
  if (h.startsWith('g=')) return show(decodeURIComponent(h.slice(2)));
  document.title = 'NBA GM Savant — WCE Hoops';
  if (h === 'leaders') { view('leaders'); return leaders(document.querySelector('#lbSeg [aria-pressed="true"]').dataset.v); }
  if (h === 'tree') { view('tree'); return treeTab(); }
  if (h === 'method') { view('method'); return method(); }
  view('home'); home(document.querySelector('#homeSeg [aria-pressed="true"]').dataset.v);
}
function seg(id, fn) {
  $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); fn(b.dataset.v); });
}
function search() {
  const q = $('q'), res = $('res');
  let on = -1;
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { res.hidden = true; return; }
    const hits = IDX.people.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 12);
    res.innerHTML = hits.map((p, i) => `<div class="res${i === on ? ' on' : ''}" role="option" data-g="${esc(p.file)}"><span class="rn">${esc(p.name)}</span><span class="rs">${p.spells.map((x) => `${x.team_name || x.team} ${span(x)}`).join(', ')}</span></div>`).join('') || '<div class="res"><span class="rs">No GM by that name.</span></div>';
    res.hidden = false;
  };
  q.addEventListener('input', () => { on = -1; draw(); });
  q.addEventListener('keydown', (e) => {
    const items = res.querySelectorAll('.res[data-g]');
    if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[Math.max(0, on)]) { location.hash = 'g=' + items[Math.max(0, on)].dataset.g; res.hidden = true; q.value = ''; }
    else if (e.key === 'Escape') res.hidden = true;
  });
  res.addEventListener('click', (e) => { const r = e.target.closest('[data-g]'); if (r) { location.hash = 'g=' + r.dataset.g; res.hidden = true; q.value = ''; } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) res.hidden = true; });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('expl').hidden) closeExpl(); });
document.addEventListener('click', (e) => {
  const ib = e.target.closest('.ib');
  if (ib) { e.preventDefault(); e.stopPropagation(); openExpl(ib); return; }
  const sb = e.target.closest('.soon');
  if (sb) { e.preventDefault(); e.stopPropagation(); openSoon(sb); return; }
  const tb = e.target.closest('.tipb');
  if (tb) { e.preventDefault(); e.stopPropagation(); openTip(tb); return; }
  if (e.target.closest('.xx') || (!$('expl').hidden && !e.target.closest('#expl'))) closeExpl();
  const r = e.target.closest('tr.link[data-g]');
  if (r && !e.target.closest('a')) location.hash = 'g=' + r.dataset.g;
  const c = e.target.closest('#spellChips .chip');
  if (c) { SPELL = +c.dataset.i; card(); }
  const f = e.target.closest('#logFilter .chip');
  if (f) { LOGTYPE = f.dataset.t; log(); }
});
load('index.json').then((idx) => {
  IDX = idx;
  $('ver').textContent = $('footVer').textContent = 'v' + idx.meta.version;
  $('through').textContent = `Decisions through ${idx.meta.through}.`;
  salBanner();
  seg('homeSeg', home); seg('lbSeg', leaders);
  controls('home', () => home()); controls('lb', () => leaders());
  $('skillSel').addEventListener('change', () => leaders(document.querySelector('#lbSeg [aria-pressed="true"]').dataset.v));
  search();
  window.addEventListener('hashchange', route);
  route();
}).catch((e) => { $('homeBoard').innerHTML = `<p class="cap">NBA GM Savant's data could not be loaded (${esc(e.message)}). Try again in a minute.</p>`; });
