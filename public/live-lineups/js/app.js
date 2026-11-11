// Live Lineups app: fetch ESPN, rebuild the whole game from scratch on every pull, render. Replay mode feeds the same
// path a summary cut to a moving clock.
import { CONFIG, compact, analyze, digest, elapsed, periodOf, periodEnd, fmtClock, teamNames, chicagoDate, lastName } from './engine.js';
import * as R from './render.js';
import { fillWorkbook, readRoster, rosterMatch } from './xlsx.js';

const qs = new URLSearchParams(location.search);
const TEAM = qs.get('team') || '201';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const CACHE = 'll1:';
const $app = document.getElementById('app');

const view = { tab: ['now', 'shots', 'players', 'sheet'].includes(qs.get('tab')) ? qs.get('tab') : 'now', sel: null, seg: 'lineups', scope: 'game', sheetTab: 'Stint Log', drawer: qs.get('drawer') === '1' };
const st = { useProxy: false, unreachable: false, lastChange: Date.now(), sig: '', reconBadSince: null, g: null, A: null, S: null, ratings: null, prior: [], priorLoaded: false, priorLoading: false, missing: [],
  roster: null, rosterAdded: [], info: {}, busy: false, timer: null, replay: null, lastPoll: Date.now() };

// ---------------------------------------------------------------- fetching (direct, then the Vercel proxy if the browser blocks it)
async function getJSON(url, proxy) {
  if (!st.useProxy || !proxy) {
    try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { if (!proxy || !(e instanceof TypeError)) throw e; }
  }
  const r = await fetch(proxy); if (!r.ok) throw new Error('proxy ' + r.status); st.useProxy = true; return r.json();
}
const summaryURL = gid => [`${ESPN}/summary?event=${gid}`, `/api/espn-summary?event=${gid}`];
const fetchSummary = gid => getJSON(...summaryURL(gid));
const fetchSchedule = () => getJSON(`${ESPN}/teams/${TEAM}/schedule`, `/api/espn-summary?schedule=${TEAM}`);
const store = { get(k) { try { const v = localStorage.getItem(CACHE + k); return v ? JSON.parse(v) : null; } catch { return null; } }, set(k, v) { try { localStorage.setItem(CACHE + k, JSON.stringify(v)); } catch { /* storage off or full: fine */ } } };

// ---------------------------------------------------------------- status from a compact game
function statusOf(g, A) {
  const N = teamNames(g, TEAM); const s = g.status || {};
  let state = s.state === 'pre' ? 'pre' : s.state === 'post' ? 'final' : 'live';
  if (state === 'live' && (s.name === 'STATUS_HALFTIME' || (s.name === 'STATUS_END_PERIOD' && s.period === 1))) state = 'half';
  if (g.replayState) state = g.replayState;
  const score = A ? A.score : { OU: Number(g.score[TEAM]) || 0, OPP: Number(g.score[N.opp]) || 0 };
  let period = A ? A.period : s.period || 1, clock = s.clock || '';
  if (g.replayClock != null) clock = g.replayClock;
  const dt = new Date(g.date);
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' }).format(dt);
  const tip = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(dt).toLowerCase().replace(' ', ' ') + ' CT';
  return { state, period, clock, score, oppFull: N.oppFull, oppShort: N.oppShort, when, tip, periods: A ? A.period : period };
}

// ---------------------------------------------------------------- season: every completed game before this one, parsed once and cached
async function loadSeason(g) {
  if (st.priorLoading || st.priorLoaded) return; st.priorLoading = true;
  try {
    const sched = await fetchSchedule(); const t0 = new Date(g.date).getTime();
    const evs = (sched.events || []).filter(e => e.id !== g.gid && new Date(e.date).getTime() < t0 && e.competitions?.[0]?.status?.type?.completed).sort((a, b) => new Date(a.date) - new Date(b.date));
    const out = [];
    for (const e of evs) {
      let d = store.get('dg:' + e.id);
      if (!d || d.v !== CONFIG.version) {
        try {
          const gg = compact(await fetchSummary(e.id)); const dg = digest(gg, TEAM); const N = teamNames(gg, TEAM); const dt = chicagoDate(gg.date);
          const info = {}; for (const a of gg.box[TEAM] || []) info[a[0]] = { name: a[1], jersey: a[5], pos: a[4] };
          d = { ...dg, v: CONFIG.version, label: `${N.oppShort} ${dt.m}/${dt.d}`, date: dt, opp: N.oppShort, iso: gg.date, info };
          if (dg.ok) store.set('dg:' + e.id, d);
        } catch { st.missing.push(e.id); continue; }
      }
      out.push(d);
    }
    st.prior = out; st.priorLoaded = true;
  } catch { st.priorLoaded = true; }
  st.priorLoading = false;
  if (st.g) ingest(st.g, true);
}

// ---------------------------------------------------------------- roster (the template's Roster tab) for spelling and the download
let JSZipP = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return (JSZipP ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = rej; document.head.append(s); }));
}
let templateP = null;
const loadTemplate = () => (templateP ||= fetch('/live-lineups/tracker-template.xlsx').then(r => r.arrayBuffer()));
async function loadRoster() {
  try { const [JZ, buf] = await Promise.all([loadJSZip(), loadTemplate()]); st.roster = await readRoster(JZ, buf); if (st.g) render(); } catch { st.roster = []; }
}

// ---------------------------------------------------------------- sheet model
function sheetModel() {
  const A = st.A; const g = st.g; if (!A || !g) return null;
  const info = { ...st.info }; for (const d of st.prior) Object.assign(info, d.info || {});
  const dt = chicagoDate(g.date);
  const cur = { label: `${A.N.oppShort} ${dt.m}/${dt.d}`, date: dt, opp: A.N.oppShort, rows: A.rows.map(r => ({ ...r, flagged: A.repairT != null && r.t1 > A.repairT })), current: true };
  const games = [...st.prior.filter(d => d.ok && d.rows).map(d => ({ label: d.label, date: d.date, opp: d.opp, rows: d.rows, current: false })), cur];
  const roster = st.roster || [];
  const added = [];
  const spell = pid => { const p = info[pid] || { name: A.names[pid] || pid }; if (!st.roster) return p.name; const hit = rosterMatch(roster, p.name, p.jersey); if (!hit && !added.find(a => a.name === p.name)) added.push({ name: p.name, jersey: p.jersey }); return hit || p.name; };
  const fiveNames = pids => [...pids].sort((a, b) => { const x = lastName((info[a] || {}).name || A.names[a] || a).toLowerCase(), y = lastName((info[b] || {}).name || A.names[b] || b).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }).map(spell);
  const seasonIds = new Set(games.flatMap(gm => gm.rows.flatMap(r => r.players)));
  for (const pid of seasonIds) spell(pid);
  const rosterRows = [...roster.map(r => ({ jersey: r.jersey, name: r.name })), ...added.map(a => ({ jersey: a.jersey, name: a.name, pos: '(added)' }))];
  return { games, info, fiveNames, added, roster: rosterRows, ready: !!st.roster, busy: st.busy, loading: !st.priorLoaded, missing: st.missing };
}
function downloadBlob(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function downloadXlsx() {
  const SH = sheetModel(); if (!SH) return; st.busy = true; render();
  try {
    const [JZ, buf] = await Promise.all([loadJSZip(), loadTemplate()]);
    const games = (view.scope === 'season' ? SH.games : SH.games.filter(x => x.current)).map(gm => ({ ...gm,
      rows: gm.rows.map(r => ({ ...r, end: gm.current && r.open && st.S.state === 'live' ? '' : r.end, note: r.flagged ? 'Auto-filled; check: after a repaired substitution' : gm.current && r.open && st.S.state === 'live' ? 'Auto-filled; still on the floor at download' : 'Auto-filled from play-by-play',
        players: r.players.map(pid => SH.info[pid] || { name: st.A.names[pid] || pid }) })) }));
    const res = await fillWorkbook(JZ, buf, games);
    const dt = chicagoDate(st.g.date);
    const name = view.scope === 'season' ? `OU Lineup Tracker - season to ${dt.m}-${dt.d}.xlsx` : `OU Lineup Tracker - ${st.A.N.oppShort} ${dt.m}-${dt.d}.xlsx`;
    downloadBlob(res.data, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { console.error('[live-lineups] download failed', e); alertLine('The download could not be built. Try again, or use CSV.'); }
  st.busy = false; render();
}
function downloadCsv() {
  const SH = sheetModel(); if (!SH) return;
  const H = ['Game', 'Date', 'Opponent', 'Half', 'Stint #', 'Start Clock', 'End Clock', 'P1', 'P2', 'P3', 'P4', 'P5', 'OU Pts', 'Opp Pts', 'Off Poss (manual)', 'Def Poss (manual)', 'OU FGA', 'OU OREB', 'OU TOV', 'OU FTA', 'Opp FGA', 'Opp OREB', 'Opp TOV', 'Opp FTA', 'OU 3PM', 'OU 3PA', 'Opp 3PM', 'Opp 3PA', 'OU Rim FGA', 'Opp Rim FGA', 'Notes'];
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [H.join(',')];
  for (const gm of (view.scope === 'season' ? SH.games : SH.games.filter(x => x.current))) gm.rows.forEach((r, k) => {
    const u = r.u; const open = gm.current && r.open && st.S.state === 'live'; const nm = SH.fiveNames(r.players);
    lines.push([gm.label, `${gm.date.m}/${gm.date.d}/${gm.date.y}`, gm.opp, r.half, k + 1, r.start, open ? '' : r.end, ...nm, u.OU_pts, u.Opp_pts, u.OU_poss, u.Opp_poss, u.OU_fga, u.OU_oreb, u.OU_tov, u.OU_fta, u.Opp_fga, u.Opp_oreb, u.Opp_tov, u.Opp_fta, u.OU_fg3m, u.OU_fg3a, u.Opp_fg3m, u.Opp_fg3a, u.OU_rim_fga, u.Opp_rim_fga, 'Auto-filled from play-by-play'].map(q).join(','));
  });
  const dt = chicagoDate(st.g.date);
  downloadBlob(lines.join('\r\n') + '\r\n', view.scope === 'season' ? `OU Stint Log - season to ${dt.m}-${dt.d}.csv` : `OU Stint Log - ${st.A.N.oppShort} ${dt.m}-${dt.d}.csv`, 'text/csv');
}
function alertLine(msg) { const b = document.createElement('div'); b.className = 'banner err'; b.setAttribute('role', 'alert'); b.textContent = msg; $app.prepend(b); setTimeout(() => b.remove(), 6000); }

// ---------------------------------------------------------------- the one pipeline: compact game in, screens out
function ingest(g, quiet = false) {
  st.g = g;
  for (const a of g.box[TEAM] || []) st.info[a[0]] = { name: a[1], jersey: a[5], pos: a[4] };
  const prior = st.prior.filter(d => new Date(d.iso).getTime() < new Date(g.date).getTime());
  const S0 = statusOf(g, null);
  if (S0.state === 'pre') { st.A = null; st.S = { ...S0, replay: !!st.replay }; render(); return; }
  st.A = analyze(g, TEAM, { prior, ratings: st.ratings, replay: !!st.replay });
  const S = statusOf(g, st.A);
  const ok = st.A.parsed.OU === st.A.score.OU && st.A.parsed.OPP === st.A.score.OPP;
  if (ok) st.reconBadSince = null; else if (st.reconBadSince == null) st.reconBadSince = Date.now();
  S.reconBadFor = st.reconBadSince ? (Date.now() - st.reconBadSince) / 1000 : 0;
  S.replay = !!st.replay; S.speed = st.replay?.speed; S.paused = st.replay?.paused;
  st.S = S; if (!quiet) st.pulse = true;
  document.title = `Oklahoma ${S.score.OU}, ${S.oppShort} ${S.score.OPP} · Live lineups`;
  if (S.state === 'live' && st.priorLoaded && !st.replay) { /* keep it fresh */ }
  try { render(); } catch (e) { console.error('[live-lineups] render failed', e); $app.insertAdjacentHTML('afterbegin', '<div class="banner err" role="alert"><b>This view hit an error.</b> The data keeps updating; switch tabs or reload.</div>'); }
  window.__ll = { A: st.A, S: st.S, view, sheet: () => sheetModel() }; // test hook
}

// ---------------------------------------------------------------- rendering, keeping scroll and focus
function focusKey(el) { if (!el || !el.dataset) return null; for (const k of ['tab', 'sel', 'five', 'seg', 'sheet', 'scope', 'act']) if (el.dataset[k] !== undefined) return [k, el.dataset[k], el.closest('.bottomtabs') ? 'b' : '']; return null; }
function render() {
  const A = st.A, S = st.S; if (!S) return;
  const scroll = {}; $app.querySelectorAll('[data-scroll]').forEach(el => { scroll[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]; });
  const fk = focusKey(document.activeElement);
  S.unreachable = st.unreachable;
  const age = (Date.now() - st.lastChange) / 1000;
  S.stale = !st.replay && S.state === 'live' && age > CONFIG.STALE_S ? fmtClock(age) : null;
  S.drawer = view.drawer;
  let main;
  if (S.state === 'pre' || !A) main = R.preGame(S);
  else if (view.tab === 'shots') main = R.shotsTab(A, S, view);
  else if (view.tab === 'players') main = R.playersTab(A, S);
  else if (view.tab === 'sheet') main = R.sheetTab(A, S, view, sheetModel());
  else main = R.nowTab(A, S);
  $app.innerHTML = R.band(A, S, view) + R.banners(A, S) + main + R.footer(A, S) + R.bottomTabs(view) + (view.drawer && A ? R.drawer(A, S, view) : '');
  $app.querySelectorAll('[data-scroll]').forEach(el => { const s = scroll[el.dataset.scroll]; if (s) { el.scrollLeft = s[0]; el.scrollTop = s[1]; } });
  if (!st.pulse) $app.querySelectorAll('.dot.beat').forEach(d => d.classList.remove('beat'));
  st.pulse = false;
  if (fk) { const sel = `${fk[2] === 'b' ? '.bottomtabs ' : ''}[data-${fk[0]}="${CSS.escape(fk[1])}"]`; const el = $app.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
  tickAgo();
}
function tickAgo() {
  const el = $app.querySelector('[data-ago]'); if (!el || !st.S) return;
  if (st.S.state === 'live') el.textContent = st.replay ? `Replay at ${st.replay.speed}x` : `Live, updated ${Math.max(0, Math.round((Date.now() - st.lastPoll) / 1000))} sec ago`;
}
setInterval(() => { tickAgo(); if (!st.replay && st.S?.state === 'live' && (Date.now() - st.lastChange) / 1000 > CONFIG.STALE_S && !document.querySelector('.banner')) render(); }, 1000);

// ---------------------------------------------------------------- live
async function poll(gid) {
  clearTimeout(st.timer);
  let next = CONFIG.REFRESH_LIVE_S;
  try {
    const raw = await fetchSummary(gid); st.unreachable = false; st.lastPoll = Date.now();
    const g = compact(raw);
    const last = g.plays[g.plays.length - 1];
    const sig = `${g.plays.length}|${last ? last[1] + last[3] + last[11] + last[12] : ''}|${g.status.clock}|${g.status.name}`;
    if (sig !== st.sig) { st.sig = sig; st.lastChange = Date.now(); }
    ingest(g);
    if (!st.priorLoaded) loadSeason(g);
    const s = g.status.state; if (s === 'pre') next = CONFIG.REFRESH_PRE_S; else if (s === 'post') next = 0;
  } catch (e) {
    console.warn('[live-lineups] fetch failed', e); st.unreachable = true; if (st.S) render(); else $app.innerHTML = `<div class="banner err" role="alert"><b>Can't reach ESPN's play-by-play.</b> Retrying every 15 seconds.</div>`;
  }
  if (next) st.timer = setTimeout(() => poll(gid), next * 1000);
}

// ---------------------------------------------------------------- replay: the same pipeline, plays revealed up to a moving clock
function startReplay(raw, speed, at) {
  const full = compact(raw);
  const els = full.plays.map(p => elapsed(p[0], p[1]));
  const endT = Math.max(...els);
  const rp = st.replay = { full, els, endT, speed, t: 0, paused: speed === 0, hold: 0 };
  if (at) { if (at === 'half') rp.t = 1200; else if (at === 'end') rp.t = endT; else { const m = /^(\d)-(\d+:\d+(?:\.\d+)?)$/.exec(at); if (m) rp.t = elapsed(Number(m[1]), m[2]); } }
  if (qs.get('pause') === '1') rp.paused = true;
  const snapshot = () => {
    const t = rp.t; const plays = full.plays.filter((p, i) => els[i] <= t);
    const lastP = plays[plays.length - 1];
    const endedHere = !!(lastP && lastP[3] === 'End Period' && t === periodEnd(lastP[0]));
    const state = t >= endT ? 'final' : endedHere && lastP[0] === 1 ? 'half' : 'live';
    let per = t <= 0 ? 1 : periodOf(t - 1e-9);
    if (endedHere && state === 'live') per = lastP[0] + 1; // between periods: show the next one at its full clock
    const clock = state === 'final' ? 'Final' : fmtClock(Math.max(0, periodEnd(per) - t));
    const g = { ...full, plays, cut: t, final: state === 'final', replayState: state, replayClock: clock, status: { ...full.status, state: state === 'final' ? 'post' : 'in', period: per } };
    return g;
  };
  const step = () => {
    if (!rp.paused) {
      if (rp.hold > 0) rp.hold--;
      else {
        const nt = Math.min(endT, rp.t + CONFIG.REFRESH_LIVE_S);
        if (rp.t < 1200 && nt >= 1200) { rp.t = 1200; rp.hold = Math.max(1, Math.round(6 * (rp.speed / 10))); } else rp.t = nt;
      }
    }
    st.lastPoll = Date.now(); st.lastChange = Date.now();
    ingest(snapshot());
    if (rp.t < endT && !rp.stopped) st.timer = setTimeout(step, rp.paused ? 1000 : (CONFIG.REFRESH_LIVE_S * 1000) / Math.max(0.1, rp.speed));
    if (rp.t >= endT) window.__llReplayDone = true;
  };
  rp.step = step;
  window.__llControl = { pause() { rp.paused = true; }, play() { rp.paused = false; }, seek(t) { rp.t = t; rp.hold = 0; ingest(snapshot()); }, get t() { return rp.t; }, endT };
  ingest(snapshot()); loadSeason(full);
  st.timer = setTimeout(step, rp.paused ? 1000 : (CONFIG.REFRESH_LIVE_S * 1000) / Math.max(0.1, speed));
}

// ---------------------------------------------------------------- events
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-sel],[data-five],[data-seg],[data-sheet],[data-scope],[data-act]'); if (!t) return;
  const d = t.dataset;
  if (d.tab !== undefined) { view.tab = d.tab; render(); window.scrollTo({ top: 0 }); return; }
  if (d.five !== undefined) { view.tab = 'shots'; view.sel = d.five; render(); window.scrollTo({ top: 0 }); return; }
  if (d.sel !== undefined) { view.sel = d.sel || null; render(); return; }
  if (d.seg !== undefined) { view.seg = d.seg; render(); return; }
  if (d.sheet !== undefined) { view.sheetTab = d.sheet; render(); return; }
  if (d.scope !== undefined) { view.scope = d.scope; render(); return; }
  if (d.act === 'drawer') { view.drawer = true; render(); $app.querySelector('.drawer .x')?.focus(); return; }
  if (d.act === 'drawer-close') { view.drawer = false; render(); $app.querySelector('[data-act="drawer"]')?.focus(); return; }
  if (d.act === 'xlsx') { downloadXlsx(); return; }
  if (d.act === 'csv') { downloadCsv(); return; }
  if (d.act === 'replay-toggle' && st.replay) { st.replay.paused = !st.replay.paused; st.S.paused = st.replay.paused; render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && view.drawer) { view.drawer = false; render(); $app.querySelector('[data-act="drawer"]')?.focus(); } });

// ---------------------------------------------------------------- start
async function pickGame() {
  const sched = await fetchSchedule(); const evs = sched.events || [];
  const today = chicagoDate(new Date().toISOString()); const isToday = e => { const d = chicagoDate(e.date); return d.y === today.y && d.m === today.m && d.d === today.d; };
  const stateOf = e => e.competitions?.[0]?.status?.type?.state;
  const live = evs.find(e => stateOf(e) === 'in'); if (live) return live.id;
  const todayPre = evs.find(e => isToday(e) && stateOf(e) === 'pre'); if (todayPre) return todayPre.id;
  const finals = evs.filter(e => stateOf(e) === 'post').sort((a, b) => new Date(b.date) - new Date(a.date));
  const next = evs.filter(e => stateOf(e) === 'pre').sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  if (finals[0] && (!next || isToday(finals[0]) || Date.now() - new Date(finals[0].date).getTime() < 36 * 3600e3)) return finals[0].id;
  return (next || finals[0])?.id;
}
(async function main() {
  fetch('/live-lineups/ratings-2025-26.json').then(r => r.json()).then(j => { st.ratings = j; if (st.g) ingest(st.g, true); }).catch(() => {});
  loadRoster();
  try {
    const rgid = qs.get('replay');
    if (rgid) { const raw = await fetchSummary(rgid); const sp = qs.get('speed'); startReplay(raw, sp == null ? 10 : Number(sp), qs.get('at')); return; }
    const gid = qs.get('game') || await pickGame();
    if (!gid) { $app.innerHTML = '<p class="empty">No Oklahoma game found on ESPN\'s schedule.</p>'; return; }
    poll(gid);
  } catch (e) {
    console.warn('[live-lineups] start failed', e); st.unreachable = true;
    $app.innerHTML = `<div class="banner err" role="alert"><b>Can't reach ESPN's play-by-play.</b> Retrying every 15 seconds.</div>`;
    setTimeout(main, CONFIG.REFRESH_LIVE_S * 1000);
  }
})();
