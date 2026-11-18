// The WCE Control Room page (wcehoops.com/control): everything behind the site, live.
//
// Source: tools/control-room/page.ts and draw.ts (the drawings, shared with the /wce Claude mod).
// Built into public/control/ by tools/control-room/build.sh; public/control.html loads it.
//
// It reads the private feed, /api/status (api/_status.js), with the feed's key, which the page asks
// for once and keeps in this browser's localStorage. Jobs every 20 seconds, the reach every 2
// minutes, both paused while the tab is hidden. Every new event since the last read sends a light
// down its wire on the map; nothing moves that didn't happen.
import { C, ENGINES, MAP_JOB_IDS, STATUS_COLOR, STATUS_WORD, ago, clock, deployStatus, drawMap, drawTimeline, latestProduction, laneSeconds, num, span, summary, until, when, } from './draw.js';
const FEED = '/api/status';
const JOBS_EVERY = 20000;
const LL_EVERY = 60000;
const REACH_EVERY = 120000;
const KEY_RE = /^wcs_[a-f0-9]{48}$/;
const STORE = 'wce-control-key';
/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
let key = null;
let feed = null;
let reach = null;
let pulses = [];
let tab = 'map';
let selected = null;
let problem = null;
let lastJobs = 0;
let lastReach = 0;
let ll = null;
let lastLl = 0;
let llOpen = null;
const $ = (id) => document.getElementById(id);
function savedKey() {
    try {
        const k = localStorage.getItem(STORE);
        return k && KEY_RE.test(k) ? k : null;
    }
    catch {
        return null;
    }
}
function saveKey(k) {
    try {
        if (k)
            localStorage.setItem(STORE, k);
        else
            localStorage.removeItem(STORE);
    }
    catch { /* private window: the key lasts for this visit */ }
}
/* ------------------------------------------------------------------ *
 * Turning what changed into lights (the same rules as the /wce mod)
 * ------------------------------------------------------------------ */
const PUSHES = new Set(ENGINES.filter((e) => e.pushes).map((e) => e.id));
const HAS_SOURCE = new Set(ENGINES.filter((e) => e.from.length).map((e) => e.id));
const NODE_IDS = new Set([...MAP_JOB_IDS, 'deploy', 'site']);
function pulsesForJobs(prev, next, now) {
    const out = [];
    const failed = [];
    if (!prev)
        return { pulses: out, failed };
    const seen = Math.max(0, ...prev.events.map((e) => e.t), prev.now - JOBS_EVERY * 2);
    let k = 0;
    const add = (lane, color, delay = 0) => out.push({ id: `${lane}@${now}#${k++}`, at: now + delay, lane, color });
    for (const e of next.events) {
        if (e.t <= seen)
            continue;
        const id = e.job;
        if (e.state === 'start') {
            if (HAS_SOURCE.has(id))
                add(`in:${id}`, STATUS_COLOR.running);
            else if (NODE_IDS.has(id))
                add(`blip:${id}`, STATUS_COLOR.running);
        }
        else if (e.state === 'success') {
            if (id === 'site-watch')
                add('watch:', STATUS_COLOR.ok);
            else if (id === 'basketball-tracking') {
                add('blip:basketball-tracking', STATUS_COLOR.ok);
                add('in:basketball-savant-tracking', C.gold, 400);
            }
            else if (PUSHES.has(id) && /^Published/i.test(e.detail || ''))
                add(`out:${id}`, C.gold);
            else if (NODE_IDS.has(id))
                add(`blip:${id}`, STATUS_COLOR.ok);
        }
        else if (e.state === 'failure' && NODE_IDS.has(id))
            add(`burst:${id}`, STATUS_COLOR.failed);
    }
    for (const j of next.jobs) {
        const before = prev.jobs.find((p) => p.id === j.id);
        if (j.status === 'failed' && before && before.status !== 'failed')
            failed.push(j);
    }
    const a = latestProduction(prev.deploys), b = latestProduction(next.deploys);
    if (b && (b.id !== a?.id || b.state !== a?.state)) {
        if (b.state === 'READY') {
            add('deploy:', C.gold);
            add('blip:deploy', C.gold);
        }
        else if (b.state === 'ERROR')
            add('burst:deploy', STATUS_COLOR.failed);
        else if (b.id !== a?.id)
            add('blip:deploy', STATUS_COLOR.running);
    }
    return { pulses: out, failed };
}
// Counts that went up send that many lights (up to 10), spread over the next two minutes.
function pulsesForReach(prev, next, now) {
    if (!prev)
        return [];
    const out = [];
    const lanes = [
        ['visitors', prev.visits?.today?.pageviews, next.visits?.today?.pageviews],
        ['connector', prev.connector?.today, next.connector?.today],
        ['founding', prev.keys?.founding, next.keys?.founding],
        ['newsletter', prev.newsletter?.subscribers, next.newsletter?.subscribers],
        ['dynasty', prev.dynasty?.ballots, next.dynasty?.ballots],
    ];
    for (const [lane, a, b] of lanes) {
        if (a == null || b == null || b <= a)
            continue;
        const n = Math.min(10, b - a);
        for (let i = 0; i < n; i++) {
            const delay = Math.round((i + Math.random() * 0.6) * ((REACH_EVERY - 15000) / n));
            out.push({ id: `reach:${lane}@${now}#${i}`, at: now + delay, lane: `reach:${lane}`, color: C.gold, n: b - a });
        }
    }
    return out;
}
/* ------------------------------------------------------------------ *
 * Asking the feed
 * ------------------------------------------------------------------ */
async function getJSON(part) {
    if (!key)
        return null;
    try {
        const res = await fetch(`${FEED}?part=${part}&key=${encodeURIComponent(key)}`, { cache: 'no-store' });
        if (res.status === 401) {
            problem = 'That key wasn\'t accepted.';
            saveKey(null);
            key = null;
            render();
            return null;
        }
        if (res.status === 503) {
            problem = 'The feed is off: WCE_STATUS_KEY isn\'t set on Vercel.';
            return null;
        }
        if (!res.ok) {
            problem = `The feed answered ${res.status}. Retrying.`;
            return null;
        }
        problem = null;
        return (await res.json());
    }
    catch {
        problem = 'Couldn\'t reach the feed. Retrying.';
        return null;
    }
}
async function pullJobs() {
    const now = Date.now();
    lastJobs = now;
    const next = await getJSON('jobs');
    if (next) {
        const { pulses: add, failed } = pulsesForJobs(feed, next, now);
        feed = next;
        pulses = [...pulses, ...add].slice(-160);
        for (const j of failed)
            toast(`${j.name} failed`);
        if (failed.length && Notification?.permission === 'granted') {
            try {
                new Notification('WCE Control Room', { body: failed.map((j) => `${j.name} failed`).join('\n') });
            }
            catch { /* not allowed here */ }
        }
    }
    render();
}
async function pullReach() {
    const now = Date.now();
    lastReach = now;
    const next = await getJSON('reach');
    if (next) {
        pulses = [...pulses, ...pulsesForReach(reach, next, now)].slice(-160);
        reach = next;
    }
    render();
}
async function pullLl() {
    lastLl = Date.now();
    const next = await getJSON('ll');
    if (next)
        ll = next;
    render();
}
function tick(force = false) {
    if (!key || (document.hidden && !force))
        return;
    const now = Date.now();
    pulses = pulses.filter((p) => now - p.at < (laneSeconds(p.lane) + 1) * 1000);
    if (force || now - lastJobs >= JOBS_EVERY)
        void pullJobs();
    if (force || now - lastReach >= REACH_EVERY)
        void pullReach();
    if (tab === 'll' && (force || now - lastLl >= LL_EVERY))
        void pullLl();
}
/* ------------------------------------------------------------------ *
 * Drawing the page
 * ------------------------------------------------------------------ */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dot = (color) => `<span class="dot" style="background:${color}"></span>`;
let lastSvg = '';
function render() {
    const now = Date.now();
    document.body.dataset.state = key ? 'live' : 'locked';
    $('summary').textContent = feed ? `${summary(feed).text} · as of ${clock(feed.now)}` : key ? 'connecting…' : '';
    $('problem').textContent = problem || '';
    $('problem').hidden = !problem;
    for (const b of document.querySelectorAll('[data-tab]'))
        b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const stage = $('stage');
    if (tab === 'map' || tab === 'timeline') {
        const svg = tab === 'map' ? drawMap(feed, reach, pulses, now, selected) : drawTimeline(feed, now);
        // Only redraw when something changed: a redraw restarts the running glows.
        if (svg !== lastSvg) {
            stage.innerHTML = svg;
            lastSvg = svg;
        }
        stage.className = 'stage drawing';
    }
    else if (tab === 'll') {
        lastSvg = '';
        stage.className = 'stage';
        stage.innerHTML = llHtml();
    }
    else {
        lastSvg = '';
        stage.className = 'stage';
        stage.innerHTML = listHtml(now);
    }
    $('chips').innerHTML = chipsHtml();
    $('card').innerHTML = cardHtml(now);
    $('card').hidden = !$('card').innerHTML;
}
function chipsHtml() {
    if (!feed)
        return '';
    const dep = deployStatus(latestProduction(feed.deploys));
    const chip = (id, color, label) => `<button class="chip${selected === id ? ' on' : ''}" data-pick="${esc(id)}">${dot(color)}${esc(label)}</button>`;
    return [
        ...feed.jobs.map((j) => chip(j.id, STATUS_COLOR[j.status], j.name)),
        chip('deploy', STATUS_COLOR[dep] || C.faint, 'Deploys'),
        chip('reach', C.gold, 'Reach'),
    ].join('');
}
function listHtml(now) {
    if (!feed)
        return '<p class="muted">Waiting for the feed…</p>';
    const groups = [['mac', 'Your Mac'], ['github', 'GitHub Actions'], ['site', 'The site']];
    let h = '';
    for (const [lane, title] of groups) {
        const rows = feed.jobs.filter((j) => j.lane === lane || (lane === 'github' && !['mac', 'site'].includes(j.lane)));
        if (!rows.length)
            continue;
        h += `<h3>${title}</h3><div class="rows">`;
        for (const j of rows) {
            const last = j.status === 'running' && j.since ? `running ${span(now - j.since)}` : j.last ? `${j.last.state === 'failure' ? 'failed' : 'last'} ${ago(j.last.t, now)}` : STATUS_WORD[j.status];
            h += `<button class="row${selected === j.id ? ' on' : ''}" data-pick="${esc(j.id)}">${dot(STATUS_COLOR[j.status])}<span class="name">${esc(j.name)}</span><span class="muted">${esc(last)}</span><span class="muted next">${j.next ? `next ${esc(until(j.next, now))}` : ''}</span></button>`;
        }
        h += '</div>';
    }
    return h + reachHtml();
}
/* ------------------------------------------------------------------ *
 * Live Lineups usage (wcehoops.com/live-lineups.html): what Oklahoma's staff use, read from the
 * page's own beacons (api/_ll-usage.js). Production only; previews and ?me=1 visits aren't counted.
 * ------------------------------------------------------------------ */
const CT = (t, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(new Date(t));
const ctTime = (t) => CT(t, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const ctDay = (t) => CT(t, { weekday: 'short', month: 'short', day: 'numeric' });
const TAB_NAME = { now: 'Right now', shots: 'Shots and scoring', players: 'Their key players', sheet: 'Spreadsheet' };
const SEG_NAME = { lineups: 'Lineups', players: 'Players', shooting: 'Shooting', opp: 'Opponent' };
const BANNER_NAME = { delayed: 'Data delayed', badsub: 'Bad substitution', hidden: 'Lineups hidden', unreachable: 'Can\'t reach ESPN', other: 'Other' };
const KIND_COLOR = { open: C.gold, tab: '#7FB3E0', pick: '#9AD08F', drawer: '#C9A0E8', seg: '#C9A0E8', download: '#F0C060', half: '#ECEBE8', banner: '#F0583F' };
function bars(rows, names = {}, empty = 'None yet') {
    if (!rows.length)
        return `<p class="muted small">${empty}</p>`;
    const max = Math.max(...rows.map((r) => r.n));
    return `<div class="ll-bars">${rows.map((r) => `<div class="ll-bar"><span class="ll-name">${esc(names[r.name] || r.name)}</span><span class="ll-track"><i style="width:${Math.max(3, (r.n / max) * 100)}%"></i></span><b>${num(r.n)}</b></div>`).join('')}</div>`;
}
function evText(e) {
    switch (e.k) {
        case 'open': return `opened (${[e.mode, e.dev, e.team === '201' ? '' : `team ${e.team}`].filter(Boolean).join(', ')})`;
        case 'tab': return `tab: ${TAB_NAME[String(e.tab)] || e.tab || '?'}`;
        case 'pick': return `lineup: ${e.label || (e.sel ? 'a five' : 'Whole game')}`;
        case 'drawer': return 'opened All the numbers';
        case 'seg': return `drawer: ${SEG_NAME[String(e.seg)] || e.seg}`;
        case 'download': return `download ${e.fmt} · ${e.scope === 'season' ? 'Whole season' : 'This game'}`;
        case 'half': return 'halftime screen shown';
        case 'banner': return `banner: ${BANNER_NAME[String(e.kind)] || e.kind}`;
        default: return e.k;
    }
}
function sessionHtml(s) {
    const span0 = Math.max(60000, s.last - s.first);
    const ticks = s.events.map((e) => `<i title="${esc(ctTime(e.t) + ' · ' + evText(e))}" style="left:${((e.t - s.first) / span0) * 100}%;background:${KIND_COLOR[e.k] || C.faint}"></i>`).join('');
    const mins = Object.entries(s.minutes).map(([k, n]) => `${esc(k)} ${n} min`).join(' · ');
    const open = llOpen === s.id;
    return `<div class="ll-sess">
    <button class="ll-head" data-ll="${esc(s.id)}" aria-expanded="${open}"><span>${esc(ctDay(s.first))}, ${esc(ctTime(s.first))}–${esc(ctTime(s.last))} CT</span><span class="muted">${esc(s.dev || '?')} · ${esc(s.mode || '?')} · open ${s.openMin} min</span></button>
    <div class="ll-strip">${ticks}</div>
    <div class="muted small">${mins || 'no heartbeat yet (heartbeats come every minute the page is visible)'}</div>
    ${open ? `<ol class="ll-evs">${s.events.map((e) => `<li><span class="muted">${esc(ctTime(e.t))}</span> ${esc(evText(e))}</li>`).join('')}</ol>` : ''}
  </div>`;
}
function llHtml() {
    if (!ll)
        return '<p class="muted">Reading Live Lineups usage…</p>';
    const max = Math.max(1, ...ll.days.map((d) => d.events));
    const T = ll.totals;
    const tot = (f) => ll.days.reduce((a, d) => a + d[f], 0);
    const dls = T.downloads.reduce((a, d) => a + d.n, 0);
    return `<h3>Live Lineups · last 14 days</h3>
  <div class="stats">
    <div><b>${num(tot('opens'))}</b><span>page opens</span></div>
    <div><b>${num(tot('sessions'))}</b><span>sessions</span></div>
    <div><b>${num(T.picks.reduce((a, d) => a + d.n, 0))}</b><span>lineup picks</span></div>
    <div><b>${num(dls)}</b><span>downloads</span></div>
    <div><b>${num(T.drawer)}</b><span>drawer opens</span></div>
    <div><b>${num(T.halftime)}</b><span>halftime screens</span></div>
  </div>
  <h3>Events per day (Central)</h3>
  <div class="ll-days">${ll.days.map((d) => `<div class="ll-day" title="${esc(d.day)}: ${d.events} events, ${d.sessions} sessions, ${d.opens} opens"><span class="ll-col"><i style="height:${(d.events / max) * 100}%"></i></span><b>${d.events ? num(d.events) : ''}</b><span class="muted small"><span class="ll-m">${esc(String(Number(d.day.slice(5, 7))))}/</span>${esc(String(Number(d.day.slice(8))))}</span></div>`).join('')}</div>
  <div class="ll-grid">
    <div><h3>Tabs viewed</h3>${bars(T.tabs, TAB_NAME)}</div>
    <div><h3>Downloads</h3>${bars(T.downloads)}</div>
    <div><h3>Drawer sections</h3>${bars(T.segments, SEG_NAME)}</div>
    <div><h3>Banners shown</h3>${bars(T.banners, BANNER_NAME, 'None')}</div>
    <div><h3>Devices (page opens)</h3>${bars(T.devices)}</div>
    <div><h3>Lineups picked on Shots and scoring</h3>${bars(T.picks)}</div>
  </div>
  <h3>Sessions, newest first</h3>
  <p class="muted small">One session per page load. Each mark is an event (hover for it); heartbeats count the minutes the page was visible, by game state. Open with ?me=1 on your own devices to leave them out.</p>
  ${ll.sessions.length ? ll.sessions.map(sessionHtml).join('') : '<p class="muted">No sessions yet.</p>'}`;
}
function reachHtml() {
    const v = reach?.visits, c = reach?.connector;
    return `<h3>Reach today</h3><div class="stats">
    <div><b>${num(v?.today?.visitors)}</b><span>visitors</span></div>
    <div><b>${num(v?.today?.pageviews)}</b><span>page views</span></div>
    <div><b>${num(c?.today)}</b><span>connector calls</span></div>
    <div><b>${num(reach?.keys?.founding)}</b><span>founding members</span></div>
    <div><b>${num(reach?.newsletter?.subscribers)}</b><span>newsletter</span></div>
    <div><b>${num(reach?.dynasty?.ballots)}</b><span>Dynasty ballots</span></div></div>`;
}
function cardHtml(now) {
    if (!selected || !feed)
        return '';
    if (selected === 'reach')
        return `<div class="card" style="--c:${C.gold}">${reachHtml()}<p class="muted small">Last 7 days of visitors: ${(reach?.visits?.week || []).map((d) => num(d.visitors)).join(' · ') || '–'}. Connector calls: ${(reach?.connector?.week || []).map((d) => num(d.calls)).join(' · ') || '–'}. YouTube, X/Bluesky and Google search join once their keys are added.</p><button class="ghost" data-pick="">Close</button></div>`;
    if (selected === 'deploy') {
        const list = (feed.deploys?.list || []).filter((d) => d.state !== 'CANCELED').slice(0, 8);
        return `<div class="card" style="--c:${C.gold}"><h2>Vercel deploys</h2>${feed.deploys?.error ? `<p class="warn">Can't read deploys: ${esc(feed.deploys.error)}</p>` : ''}
      ${list.map((d) => `<p>${dot(STATUS_COLOR[deployStatus(d)] || C.faint)}<b>${esc(d.state.toLowerCase())}</b> ${d.created ? esc(when(d.created, now)) : ''} <span class="muted">${d.target === 'production' ? '' : '(preview) '}${esc(d.message || d.sha || '')}</span></p>`).join('')}
      <div class="actions">${list[0]?.inspect ? `<a href="${esc(list[0].inspect)}" target="_blank" rel="noopener">Latest on Vercel</a>` : ''}<button class="ghost" data-pick="">Close</button></div></div>`;
    }
    const j = feed.jobs.find((x) => x.id === selected);
    if (!j)
        return '';
    const col = STATUS_COLOR[j.status];
    const run = (j.status === 'failed' ? j.failRun : null) || j.last?.run;
    return `<div class="card" style="--c:${col}">
    <h2>${dot(col)}${esc(j.name)} <span style="color:${col}">${esc(STATUS_WORD[j.status])}</span></h2>
    <p class="muted">${esc(j.cadence)}</p>
    ${j.status === 'running' && j.since ? `<p style="color:${STATUS_COLOR.running}">Running for ${esc(span(now - j.since))}, since ${esc(clock(j.since))}</p>` : ''}
    ${j.last && j.last.state !== 'start' ? `<p>Last run: ${j.last.state === 'success' ? 'finished' : j.last.state === 'failure' ? 'failed' : esc(j.last.state)} ${esc(when(j.last.t, now))} (${esc(ago(j.last.t, now))})${j.last.dur ? `, took ${esc(span(j.last.dur))}` : ''}</p>` : ''}
    ${j.last?.detail ? `<p class="muted">${esc(j.last.detail)}</p>` : ''}
    ${j.status === 'failed' && j.failDetail && j.failDetail !== j.last?.detail ? `<p class="warn">${esc(j.failDetail)}</p>` : ''}
    ${j.status === 'failed' && j.streak > 1 ? `<p class="warn">${j.streak} runs in a row</p>` : ''}
    ${j.status === 'late' && j.maxAgeH ? `<p class="warn">No check-in for over ${j.maxAgeH} hours.</p>` : ''}
    ${j.lastOk && j.status !== 'ok' ? `<p class="muted">Last clean run: ${esc(when(j.lastOk, now))}</p>` : ''}
    ${j.next ? `<p>Next: ${esc(until(j.next, now))} (${esc(when(j.next, now))})</p>` : ''}
    <div class="actions">
      <button class="primary" data-ask="${esc(j.id)}">${j.status === 'failed' ? 'Copy a fix request for Claude' : 'Copy a question for Claude'}</button>
      ${run ? `<a href="${esc(run)}" target="_blank" rel="noopener">This run on GitHub</a>` : ''}
      ${j.workflow ? `<a href="${esc(j.workflow)}" target="_blank" rel="noopener">All runs</a>` : ''}
      <button class="ghost" data-pick="">Close</button>
    </div></div>`;
}
function askFor(j) {
    const now = Date.now();
    return j.status === 'failed'
        ? `The WCE Control Room shows "${j.name}" failed ${j.lastFail ? when(j.lastFail, now) : ''}${j.streak > 1 ? ` (${j.streak} runs in a row)` : ''}. ${j.failDetail || j.last?.detail || ''} Run: ${j.failRun || j.last?.run || j.workflow || 'n/a'}. Find out why it broke and fix it in cohenadam07/western-conference-elitists.`
        : `The WCE Control Room shows "${j.name}" as ${STATUS_WORD[j.status]}${j.last ? `, last ${j.last.state} ${when(j.last.t, now)}` : ''}. ${j.last?.detail || ''} Its schedule: ${j.cadence} Take a look and tell me if anything is wrong.`;
}
let toastTimer = 0;
function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { t.hidden = true; }, 4000);
}
/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
function connect(k) {
    key = k;
    saveKey(k);
    problem = null;
    feed = null;
    reach = null;
    render();
    tick(true);
}
document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-tab],[data-pick],[data-ask],[data-ll],.node');
    if (!el)
        return;
    if (el.dataset.tab) {
        tab = el.dataset.tab;
        lastSvg = '';
        render();
        if (tab === 'll')
            void pullLl();
        return;
    }
    if (el.dataset.ll) {
        llOpen = llOpen === el.dataset.ll ? null : el.dataset.ll;
        render();
        return;
    }
    if (el.dataset.ask) {
        const j = feed?.jobs.find((x) => x.id === el.dataset.ask);
        if (!j)
            return;
        try {
            await navigator.clipboard.writeText(askFor(j));
            toast('Copied. Paste it into Claude.');
        }
        catch {
            toast('Couldn\'t copy here.');
        }
        return;
    }
    const pick = el.dataset.pick ?? el.getAttribute('data-id') ?? '';
    const id = pick && (feed?.jobs.some((j) => j.id === pick) || pick === 'deploy' || pick === 'reach') ? pick
        : ['visitors', 'connector', 'founding', 'newsletter', 'dynasty', 'site', 'store'].includes(pick) ? 'reach' : '';
    selected = !id || selected === id ? null : id;
    lastSvg = '';
    render();
    if (selected)
        $('card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('key-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const k = ($('key-input').value || '').trim();
    if (!KEY_RE.test(k)) {
        $('key-error').textContent = 'That doesn\'t look like a Control Room key (it starts with wcs_).';
        return;
    }
    $('key-error').textContent = '';
    connect(k);
});
$('forget').addEventListener('click', () => { saveKey(null); key = null; feed = null; reach = null; ll = null; render(); });
$('notify').addEventListener('click', async () => {
    try {
        const p = await Notification.requestPermission();
        toast(p === 'granted' ? 'This browser will alert you when a job fails.' : 'Alerts not allowed here.');
    }
    catch {
        toast('This browser can\'t show alerts.');
    }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    tick(true); });
setInterval(() => tick(), 5000);
// A key in the address (#key=wcs_…) is taken once, saved, and wiped from the address bar.
const fromHash = new URLSearchParams(location.hash.slice(1)).get('key');
if (fromHash && KEY_RE.test(fromHash)) {
    history.replaceState(null, '', location.pathname);
    connect(fromHash);
}
else {
    key = savedKey();
    render();
    tick(true);
}
