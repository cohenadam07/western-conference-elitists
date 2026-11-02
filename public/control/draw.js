// The Control Room's drawings: the data-flow map and the timeline, as SVG text the panel hands
// to an Svg element (desktop and mobile draw it in a sandboxed frame where SMIL animation runs).
// Pure functions of the feed: no engine calls here, so the tests can draw them directly.
/* ------------------------------------------------------------------ *
 * Brand and status colors
 * ------------------------------------------------------------------ */
export const C = {
    bg: '#0B1626', panel: '#12233A', group: '#0F1E33', wire: '#284263', wireDim: '#1D3150',
    navy: '#22395A', gold: '#C2A263', goldSoft: '#8C7748', cream: '#ECEBE8', dim: '#8B9BB2', faint: '#5C6E86',
    red: '#BC3A2C',
};
export const STATUS_COLOR = {
    ok: '#4FBF8A', running: '#5AB0FF', failed: '#F0583F', late: '#E8A33A', stalled: '#E8A33A',
    waiting: '#5C6E86', manual: '#5C6E86', cancelled: '#9AA6B8',
    'deploy-ok': '#4FBF8A', 'deploy-error': '#F0583F', 'deploy-building': '#5AB0FF',
};
export const STATUS_WORD = {
    ok: 'green', running: 'running', failed: 'failed', late: 'late', stalled: 'stalled',
    waiting: 'waiting for its first check-in', manual: 'by hand only', cancelled: 'cancelled',
};
/* ------------------------------------------------------------------ *
 * Time, in Eastern (US rules), without Intl: the hooks environment may not carry it
 * ------------------------------------------------------------------ */
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
function nthSunday(y, month, n) {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
export function eastern(t) {
    const y = new Date(t).getUTCFullYear();
    const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7); // 2am EST, second Sunday of March
    const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6); // 2am EDT, first Sunday of November
    const l = new Date(t + (t >= start && t < end ? -4 : -5) * HOUR);
    return { h: l.getUTCHours(), m: l.getUTCMinutes(), dow: l.getUTCDay(), date: l.getUTCDate(), mon: l.getUTCMonth(), dayKey: Math.floor((t + (t >= start && t < end ? -4 : -5) * HOUR) / DAY) };
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function clock(t) {
    const e = eastern(t);
    const h12 = e.h % 12 === 0 ? 12 : e.h % 12;
    return `${h12}:${String(e.m).padStart(2, '0')}${e.h < 12 ? 'am' : 'pm'}`;
}
// "6:35am", "yesterday 11:30pm", "Thu 7:17am", "Oct 28"
export function when(t, now) {
    const a = eastern(t), b = eastern(now);
    const days = b.dayKey - a.dayKey;
    if (days === 0)
        return clock(t);
    if (days === 1)
        return `yesterday ${clock(t)}`;
    if (days === -1)
        return `tomorrow ${clock(t)}`;
    if (Math.abs(days) < 7)
        return `${DOW[a.dow]} ${clock(t)}`;
    return `${MON[a.mon]} ${a.date}`;
}
export function ago(t, now) {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60)
        return 'just now';
    const m = Math.round(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 36)
        return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}
export function until(t, now) {
    const m = Math.round((t - now) / 60000);
    if (m <= 0)
        return 'due now';
    if (m < 60)
        return `in ${m}m`;
    if (m < 12 * 60)
        return `in ${Math.round(m / 6) / 10}h`;
    return when(t, now);
}
export function span(ms) {
    if (ms == null)
        return '';
    const s = Math.round(ms / 1000);
    if (s < 90)
        return `${s}s`;
    const m = Math.round(s / 60);
    return m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} hr`;
}
export const num = (n) => n == null ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TOP = 24; // room for the title band
const node = (id, x, cy, w, h, label) => ({ id, x, y: cy + TOP - h / 2, w, h, label });
const SRC_X = 24, SRC_W = 150, ENG_X = 268, ENG_W = 208, SITE_X = 560, SITE_W = 176, REACH_X = 822, REACH_W = 156;
export const SOURCES = [
    node('src-nba', SRC_X, 82, SRC_W, 32, 'stats.nba.com'),
    node('src-feeds', SRC_X, 138, SRC_W, 32, 'News feeds'),
    node('src-espn', SRC_X, 300, SRC_W, 32, 'ESPN'),
    node('src-nflverse', SRC_X, 352, SRC_W, 32, 'nflverse'),
    node('src-sleeper', SRC_X, 414, SRC_W, 32, 'Sleeper'),
    node('src-ufc', SRC_X, 470, SRC_W, 32, 'UFCStats'),
];
// The engines: one node per job that moves data. `from` names its sources.
export const ENGINES = [
    { ...node('basketball-tracking', ENG_X, 82, ENG_W, 46, 'NBA tracking upload'), from: ['src-nba'], pushes: false },
    { ...node('news', ENG_X, 138, ENG_W, 46, 'News feed'), from: ['src-feeds'], pushes: true },
    { ...node('basketball-savant', ENG_X, 232, ENG_W, 46, 'Basketball Savant'), from: ['src-espn'], pushes: true },
    { ...node('basketball-history', ENG_X, 288, ENG_W, 46, 'History additions'), from: [], pushes: true },
    { ...node('football-savant', ENG_X, 352, ENG_W, 46, 'Football Savant'), from: ['src-nflverse'], pushes: true },
    { ...node('football-injuries', ENG_X, 408, ENG_W, 46, 'Football injuries'), from: ['src-espn', 'src-sleeper'], pushes: true },
    { ...node('ufc-savant', ENG_X, 464, ENG_W, 46, 'UFC Savant'), from: ['src-ufc'], pushes: true },
    { ...node('weekly-snapshot', ENG_X, 520, ENG_W, 46, 'Weekly snapshot'), from: [], pushes: true },
];
// Small watchers along the bottom of the GitHub group: they check, they don't publish.
export const WATCHERS = [
    node('basketball-freshness', ENG_X, 574, 100, 22, 'Freshness'),
    node('connector-coverage', ENG_X + 108, 574, 100, 22, 'Coverage'),
    node('football-rebuild', ENG_X, 602, 100, 22, 'Rebuild'),
    node('site-watch', ENG_X + 108, 602, 100, 22, 'Site watch'),
];
export const SITE = [
    node('deploy', SITE_X, 300, SITE_W, 56, 'Vercel deploy'),
    node('site', SITE_X, 420, SITE_W, 56, 'wcehoops.com'),
    node('store', SITE_X, 540, SITE_W, 44, 'Data store'),
];
export const REACH = [
    { ...node('visitors', REACH_X, 150, REACH_W, 46, 'Visitors'), from: 'site', live: true },
    { ...node('connector', REACH_X, 210, REACH_W, 46, 'AI connector'), from: 'site', live: true },
    { ...node('founding', REACH_X, 270, REACH_W, 46, 'Founding members'), from: 'store', live: true },
    { ...node('newsletter', REACH_X, 330, REACH_W, 46, 'Newsletter'), from: 'site', live: true },
    { ...node('dynasty', REACH_X, 390, REACH_W, 46, 'Dynasty ballots'), from: 'store', live: true },
    { ...node('youtube', REACH_X, 466, REACH_W, 40, 'YouTube'), from: 'site', live: false },
    { ...node('social', REACH_X, 516, REACH_W, 40, 'X · Bluesky'), from: 'site', live: false },
    { ...node('google', REACH_X, 566, REACH_W, 40, 'Google search'), from: 'site', live: false },
];
export const MAP_W = 1000;
export const MAP_H = 700;
const all = () => [...SOURCES, ...ENGINES, ...WATCHERS, ...SITE, ...REACH];
const byId = (id) => all().find((b) => b.id === id);
const right = (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
const left = (b) => ({ x: b.x, y: b.y + b.h / 2 });
// A wire from one box's right edge to another's left edge, as an S-curve.
function curve(a, b) {
    const dx = Math.max(30, (b.x - a.x) / 2);
    return `C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}
const wire = (from, to) => { const a = right(from), b = left(to); return `M${a.x},${a.y} ${curve(a, b)}`; };
// The Mac's tracking upload starts a Basketball Savant run: a bracket down the group's left side.
function trackingWire() {
    const a = byId('basketball-tracking'), b = byId('basketball-savant');
    const x = ENG_X - 8;
    return `M${a.x},${a.y + a.h / 2 + 8} C${x},${a.y + a.h / 2 + 8} ${x},${a.y + a.h / 2 + 8} ${x},${a.y + a.h + 10} L${x},${b.y - 10} C${x},${b.y + b.h / 2 - 6} ${x},${b.y + b.h / 2 - 6} ${b.x},${b.y + b.h / 2 - 6}`;
}
// Every route a light can take, by lane name.
export function lanePath(lane) {
    const [kind, id] = lane.split(':');
    const deploy = byId('deploy'), site = byId('site'), store = byId('store');
    if (kind === 'in') {
        if (id === 'basketball-savant-tracking')
            return trackingWire();
        const eng = ENGINES.find((e) => e.id === id);
        const src = eng?.from[0] ? byId(eng.from[0]) : null;
        return eng && src ? wire(src, eng) : null;
    }
    // The deploy sits above the site, so a publish runs into the deploy, then straight down.
    const mid = deploy.x + deploy.w / 2;
    if (kind === 'out') {
        const eng = ENGINES.find((e) => e.id === id);
        if (!eng)
            return null;
        const a = right(eng), d1 = left(deploy);
        return `M${a.x},${a.y} ${curve(a, d1)} L${mid},${d1.y} L${mid},${deploy.y + deploy.h} L${mid},${site.y}`;
    }
    if (kind === 'deploy')
        return `M${mid},${deploy.y + deploy.h} L${mid},${site.y}`;
    if (kind === 'watch')
        return wire(byId('site-watch'), site);
    if (kind === 'reach') {
        const r = REACH.find((x) => x.id === id);
        if (!r)
            return null;
        return wire(r.from === 'store' ? store : site, r);
    }
    return null;
}
const LANE_SECONDS = { in: 1.9, out: 3.2, deploy: 1.5, watch: 1.2, reach: 1.7, burst: 1.8, blip: 1.4 };
export const laneSeconds = (lane) => LANE_SECONDS[lane.split(':')[0] ?? ''] ?? 2;
/* ------------------------------------------------------------------ *
 * Drawing pieces
 * ------------------------------------------------------------------ */
function glow(cx, cy, color, dur = 1.6, r0 = 5, r1 = 13) {
    return `<circle cx="${cx}" cy="${cy}" r="${r0}" fill="none" stroke="${color}" stroke-width="2"><animate attributeName="r" values="${r0};${r1}" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="${dur}s" repeatCount="indefinite"/></circle>`;
}
function nodeBox(b, opts) {
    const color = opts.color || C.faint;
    const stroke = opts.selected ? C.gold : opts.status === 'failed' ? STATUS_COLOR.failed : opts.dim ? C.wireDim : C.wire;
    const sw = opts.selected ? 2 : opts.status === 'failed' ? 1.5 : 1;
    const cy = b.y + b.h / 2;
    const dotX = b.x + 14;
    let s = `<g data-id="${b.id}" class="node"${opts.dim ? ' opacity="0.45"' : ''}>`;
    if (opts.title)
        s += `<title>${esc(opts.title)}</title>`;
    s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${opts.small ? 11 : 9}" fill="${C.panel}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (opts.status === 'running')
        s += glow(dotX, cy, color);
    if (opts.status === 'failed')
        s += glow(dotX, cy, color, 1.1, 5, 15);
    if (opts.status === 'late' || opts.status === 'stalled')
        s += `<circle cx="${dotX}" cy="${cy}" r="8" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.35;0.05;0.35" dur="2.4s" repeatCount="indefinite"/></circle>`;
    s += `<circle cx="${dotX}" cy="${cy}" r="${opts.small ? 3.5 : 4.5}" fill="${color}"/>`;
    if (opts.small) {
        s += `<text x="${dotX + 8}" y="${cy + 3.5}" font-size="10" fill="${C.cream}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${esc(b.label)}</text>`;
    }
    else if (opts.sub) {
        const fit = Math.floor((b.w - 34) / 6.2);
        s += `<text x="${dotX + 12}" y="${cy - (opts.sub2 ? 7 : 2)}" font-size="12.5" font-weight="600" fill="${C.cream}" font-family="IBM Plex Sans, system-ui, sans-serif">${esc(cut(b.label, Math.floor((b.w - 34) / 7.2)))}</text>`;
        s += `<text x="${dotX + 12}" y="${cy + (opts.sub2 ? 7 : 11)}" font-size="10" fill="${C.dim}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${esc(cut(opts.sub, fit))}</text>`;
        if (opts.sub2)
            s += `<text x="${dotX + 12}" y="${cy + 19}" font-size="10" fill="${C.faint}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${esc(cut(opts.sub2, fit))}</text>`;
    }
    else {
        s += `<text x="${dotX + 12}" y="${cy + 4}" font-size="12.5" font-weight="600" fill="${C.cream}" font-family="IBM Plex Sans, system-ui, sans-serif">${esc(b.label)}</text>`;
    }
    return s + '</g>';
}
function pulseSvg(p, now) {
    const kind = p.lane.split(':')[0];
    const dur = laneSeconds(p.lane);
    const age = (now - p.at) / 1000;
    if (age > dur + 0.2)
        return '';
    const begin = (-age).toFixed(2);
    if (kind === 'burst' || kind === 'blip') {
        const b = byId(p.lane.split(':')[1] ?? '');
        if (!b)
            return '';
        const cx = b.x + 14, cy = b.y + b.h / 2;
        const r1 = kind === 'burst' ? 30 : 18;
        return `<circle cx="${cx}" cy="${cy}" r="4" fill="none" stroke="${p.color}" stroke-width="2.5" opacity="0"><animate attributeName="r" values="4;${r1}" dur="${dur}s" begin="${begin}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="${dur}s" begin="${begin}s" fill="freeze"/></circle>`;
    }
    const path = lanePath(p.lane);
    if (!path)
        return '';
    const motion = `<animateMotion dur="${dur}s" begin="${begin}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1" path="${path}"/>`;
    const fade = `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.85;1" dur="${dur}s" begin="${begin}s" fill="freeze"/>`;
    return `<g opacity="0"><circle r="9" fill="${p.color}" opacity="0.22" filter="url(#soft)"/><circle r="3.6" fill="${p.color}"/><circle r="1.6" fill="#fff" opacity="0.9"/>${motion}${fade}</g>`;
}
/* ------------------------------------------------------------------ *
 * The map
 * ------------------------------------------------------------------ */
function jobSub(j, now) {
    if (!j)
        return { sub: 'not reporting yet' };
    if (j.status === 'running' && j.since)
        return { sub: `running ${span(now - j.since)}`, sub2: j.next ? `then ${until(j.next, now)}` : undefined };
    if (!j.last)
        return { sub: j.status === 'manual' ? 'by hand only' : 'no check-in yet', sub2: j.next ? `next ${until(j.next, now)}` : undefined };
    const lastWord = j.status === 'failed' ? 'failed' : j.status === 'late' ? 'late · last' : j.last.state === 'cancelled' ? 'stopped' : 'ok';
    return { sub: `${lastWord} ${when(j.last.t, now)}`, sub2: j.next ? `next ${until(j.next, now)}` : undefined };
}
// A canceled deploy was superseded (or is a branch Vercel skips): it says nothing about the site.
export function latestProduction(deploys) {
    return deploys?.list?.find((d) => d.target === 'production' && d.state !== 'CANCELED') || null;
}
export function deployStatus(d) {
    if (!d)
        return 'waiting';
    if (d.state === 'READY')
        return 'deploy-ok';
    if (d.state === 'ERROR')
        return 'deploy-error';
    return 'deploy-building';
}
export function summary(feed) {
    if (!feed)
        return { text: 'connecting…', worst: 'none' };
    const n = (s) => feed.jobs.filter((j) => j.status === s).length;
    const red = n('failed'), late = n('late') + n('stalled'), run = n('running'), ok = n('ok');
    const parts = [`${ok} green`];
    if (run)
        parts.push(`${run} running`);
    if (late)
        parts.push(`${late} late`);
    parts.push(`${red} red`);
    return { text: parts.join(' · '), worst: red ? 'failed' : late ? 'late' : run ? 'running' : 'ok' };
}
export function drawMap(feed, reach, pulses, now, selected) {
    const jobs = new Map((feed?.jobs || []).map((j) => [j.id, j]));
    const color = (id) => STATUS_COLOR[(jobs.get(id)?.status || 'waiting')];
    const dep = latestProduction(feed?.deploys);
    const depStat = deployStatus(dep);
    const watch = jobs.get('site-watch');
    const sum = summary(feed);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}" font-family="IBM Plex Sans, system-ui, sans-serif">`;
    s += `<defs><filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter>`;
    s += `<radialGradient id="vignette" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#132A45"/><stop offset="1" stop-color="${C.bg}"/></radialGradient>`;
    s += `<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#16304F" stroke-width="0.6"/></pattern></defs>`;
    s += `<rect width="${MAP_W}" height="${MAP_H}" rx="14" fill="url(#vignette)"/><rect width="${MAP_W}" height="${MAP_H}" rx="14" fill="url(#grid)" opacity="0.55"/>`;
    // Title band
    s += `<text x="24" y="26" font-size="10.5" letter-spacing="2.2" fill="${C.gold}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">WESTERN CONFERENCE ELITISTS</text>`;
    s += `<text x="300" y="27" font-size="19" fill="${C.cream}" font-family="Newsreader, Georgia, serif" font-style="italic">Control Room</text>`;
    const sumColor = sum.worst === 'failed' ? STATUS_COLOR.failed : sum.worst === 'late' ? STATUS_COLOR.late : sum.worst === 'running' ? STATUS_COLOR.running : STATUS_COLOR.ok;
    const sumX = MAP_W - 24 - sum.text.length * 6.7 - 12;
    s += `<circle cx="${sumX}" cy="22" r="4" fill="${sumColor}"/>${sum.worst === 'failed' || sum.worst === 'running' ? glow(sumX, 22, sumColor, sum.worst === 'failed' ? 1.1 : 1.6) : ''}`;
    s += `<text x="${MAP_W - 24}" y="26" text-anchor="end" font-size="11" fill="${C.cream}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${esc(sum.text)}</text>`;
    s += `<rect x="24" y="36" width="${MAP_W - 48}" height="2" fill="${C.gold}" opacity="0.85"/>`;
    // Column heads and group boxes
    const head = (x, t) => `<text x="${x}" y="${TOP + 38}" font-size="9.5" letter-spacing="1.8" fill="${C.goldSoft}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${t}</text>`;
    s += head(SRC_X, 'SOURCES') + head(ENG_X, 'ENGINES') + head(SITE_X, 'THE SITE') + head(REACH_X, 'REACH');
    // Group labels sit in the box's bottom corner, clear of the nodes.
    const groupBox = (y, h, label) => `<rect x="${ENG_X - 14}" y="${y + TOP}" width="${ENG_W + 28}" height="${h}" rx="12" fill="${C.group}" stroke="${C.wireDim}" stroke-dasharray="3 4"/><text x="${ENG_X + ENG_W + 8}" y="${y + TOP + h - 6}" text-anchor="end" font-size="8.5" letter-spacing="1.6" fill="${C.faint}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${label}</text>`;
    s += groupBox(46, 137, 'YOUR MAC') + groupBox(197, 446, 'GITHUB ACTIONS');
    // Wires (under everything)
    const W = (d, active, dashed = false, dim = false) => {
        let w = `<path d="${d}" fill="none" stroke="${dim ? C.wireDim : C.wire}" stroke-width="1.4"${dashed ? ' stroke-dasharray="3 5"' : ''}/>`;
        if (active)
            w += `<path d="${d}" fill="none" stroke="${active}" stroke-width="2" stroke-dasharray="5 11" opacity="0.85"><animate attributeName="stroke-dashoffset" values="16;0" dur="0.7s" repeatCount="indefinite"/></path>`;
        return w;
    };
    for (const e of ENGINES) {
        const running = jobs.get(e.id)?.status === 'running';
        for (const f of e.from)
            s += W(wire(byId(f), e), running ? STATUS_COLOR.running : null);
        if (e.pushes)
            s += W(wire(e, byId('deploy')), null);
    }
    s += W(trackingWire(), jobs.get('basketball-tracking')?.status === 'running' ? STATUS_COLOR.running : null, true);
    s += W(lanePath('deploy:'), depStat === 'deploy-building' ? STATUS_COLOR.running : null);
    s += W(lanePath('watch:'), watch?.status === 'running' ? STATUS_COLOR.running : null, true, true);
    const site = byId('site'), store = byId('store');
    s += W(`M${site.x + site.w / 2},${site.y + site.h} L${store.x + store.w / 2},${store.y}`, null);
    for (const r of REACH)
        s += W(lanePath(`reach:${r.id}`), null, !r.live, !r.live);
    // Lights in flight
    for (const p of pulses)
        s += pulseSvg(p, now);
    // Nodes
    for (const b of SOURCES)
        s += nodeBox(b, { color: C.goldSoft, title: `${b.label}: where the data comes from` });
    for (const e of ENGINES) {
        const j = jobs.get(e.id);
        const st = j?.status || 'waiting';
        s += nodeBox(e, { color: color(e.id), status: st, ...jobSub(j, now), selected: selected === e.id, title: j ? `${j.name}: ${STATUS_WORD[st]}` : e.label });
    }
    for (const w of WATCHERS) {
        const j = jobs.get(w.id);
        s += nodeBox(w, { color: color(w.id), status: j?.status, small: true, selected: selected === w.id, title: j ? `${j.name}: ${STATUS_WORD[j.status]}` : w.label });
    }
    // Site column
    const depBox = byId('deploy');
    const depSub = dep ? `${dep.state === 'READY' ? 'live' : dep.state.toLowerCase()} ${dep.ready || dep.created ? when((dep.ready || dep.created), now) : ''}` : feed?.deploys?.error ? 'can\'t read deploys' : 'no deploys yet';
    s += nodeBox(depBox, { color: STATUS_COLOR[depStat], status: depStat === 'deploy-building' ? 'running' : depStat === 'deploy-error' ? 'failed' : undefined, sub: depSub, sub2: dep?.message ? cut(dep.message, 30) : undefined, selected: selected === 'deploy' });
    const siteDown = watch?.status === 'failed';
    s += nodeBox(site, { color: siteDown ? STATUS_COLOR.failed : watch?.last ? STATUS_COLOR.ok : C.faint, status: siteDown ? 'failed' : undefined, sub: siteDown ? 'trouble: see Site watch' : watch?.last ? `up · checked ${ago(watch.last.t, now)}` : 'not checked yet', sub2: watch?.last?.detail ? watch.last.detail.replace(/^(All good|Trouble): /, '') : undefined, selected: selected === 'site' });
    s += nodeBox(store, { color: reach && !reach.keys?.error ? STATUS_COLOR.ok : C.faint, sub: 'Upstash', sub2: 'keys · Dynasty · usage' });
    // Reach column
    const v = reach?.visits, c = reach?.connector;
    const reachSub2 = {
        visitors: v?.today ? `${num(v.today.pageviews)} page views` : undefined,
        connector: c && c.connectionsToday != null ? `${num(c.connectionsToday)} connections` : undefined,
    };
    const reachSub = {
        visitors: v?.today ? `${num(v.today.visitors)} today` : v?.error ? 'not readable' : '…',
        connector: c && c.today != null ? `${num(c.today)} calls today` : c?.error ? 'not readable' : '…',
        founding: reach?.keys?.founding != null ? `${num(reach.keys.founding)} keys` : '…',
        newsletter: reach?.newsletter?.subscribers != null ? `${num(reach.newsletter.subscribers)} subscribers` : reach?.newsletter?.error ? 'not readable' : '…',
        dynasty: reach?.dynasty?.ballots != null ? `${num(reach.dynasty.ballots)} cast` : '…',
        youtube: 'not connected yet', social: 'not connected yet', google: 'not connected yet',
    };
    for (const r of REACH)
        s += nodeBox(r, { color: r.live ? C.gold : C.faint, sub: reachSub[r.id], sub2: reachSub2[r.id], dim: !r.live, selected: selected === r.id });
    // Legend
    const L = [['running', 'running'], ['ok', 'green'], ['late', 'late'], ['failed', 'red'], ['waiting', 'no check-in']];
    let lx = 24;
    for (const [k, word] of L) {
        s += `<circle cx="${lx + 4}" cy="${MAP_H - 16}" r="4" fill="${STATUS_COLOR[k]}"/><text x="${lx + 13}" y="${MAP_H - 12.5}" font-size="10" fill="${C.dim}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${word}</text>`;
        lx += 22 + word.length * 6.4;
    }
    s += `<text x="${MAP_W - 24}" y="${MAP_H - 12.5}" text-anchor="end" font-size="10" fill="${C.faint}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">each light is a real event · ${feed ? `as of ${clock(feed.now)}` : 'waiting for the feed'}</text>`;
    return s + '</svg>';
}
/* ------------------------------------------------------------------ *
 * The timeline: the last 24 hours and the next 12, a row per job
 * ------------------------------------------------------------------ */
export const TIMELINE_ORDER = [
    'basketball-tracking', 'news', 'basketball-savant', 'basketball-history', 'football-savant', 'football-injuries',
    'ufc-savant', 'weekly-snapshot', 'basketball-freshness', 'connector-coverage', 'football-rebuild', 'site-watch',
];
function segments(events, now) {
    const bars = [], dots = [];
    let open = null;
    for (const e of events) {
        if (e.state === 'start') {
            open = e;
            continue;
        }
        if (open && e.t - open.t < 7 * HOUR) {
            bars.push({ a: open.t, b: e.t, state: e.state });
            open = null;
        }
        else
            dots.push(e);
    }
    if (open && now - open.t < 7 * HOUR)
        bars.push({ a: open.t, b: now, state: 'running', open: true });
    return { bars, dots };
}
const stateColor = (st) => st === 'success' ? STATUS_COLOR.ok : st === 'failure' ? STATUS_COLOR.failed : st === 'running' ? STATUS_COLOR.running : STATUS_COLOR.cancelled;
export function drawTimeline(feed, now) {
    const rows = TIMELINE_ORDER.map((id) => feed?.jobs.find((j) => j.id === id)).filter(Boolean);
    for (const j of feed?.jobs || [])
        if (!TIMELINE_ORDER.includes(j.id))
            rows.push(j);
    const RH = 30, TOPH = 54, LABEL = 214, X1 = 976;
    const H = TOPH + (rows.length + 1) * RH + 30;
    const from = now - DAY, to = now + 12 * HOUR;
    const x = (t) => LABEL + ((t - from) / (to - from)) * (X1 - LABEL);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${H}" viewBox="0 0 ${MAP_W} ${H}" font-family="IBM Plex Sans, system-ui, sans-serif">`;
    s += `<rect width="${MAP_W}" height="${H}" rx="14" fill="${C.bg}"/>`;
    s += `<text x="24" y="26" font-size="10.5" letter-spacing="2.2" fill="${C.gold}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">THE LAST 24 HOURS · THE NEXT 12</text>`;
    s += `<rect x="24" y="36" width="${MAP_W - 48}" height="2" fill="${C.gold}" opacity="0.85"/>`;
    // the future, shaded
    s += `<rect x="${x(now)}" y="${TOPH - 6}" width="${X1 - x(now)}" height="${H - TOPH - 18}" fill="#11243C" opacity="0.7"/>`;
    // hour lines every 3 hours, Eastern
    for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) {
        const e = eastern(t);
        if (e.h % 3 !== 0)
            continue;
        const label = e.h === 0 ? `${DOW[e.dow]}` : `${e.h % 12 === 0 ? 12 : e.h % 12}${e.h < 12 ? 'a' : 'p'}`;
        s += `<line x1="${x(t)}" y1="${TOPH - 6}" x2="${x(t)}" y2="${H - 24}" stroke="${e.h === 0 ? C.wire : '#18304D'}" stroke-width="${e.h === 0 ? 1.2 : 0.8}"/>`;
        s += `<text x="${x(t)}" y="${TOPH - 12}" text-anchor="middle" font-size="9.5" fill="${e.h === 0 ? C.gold : C.faint}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">${label}</text>`;
    }
    const events = feed?.events || [];
    rows.forEach((j, i) => {
        const y = TOPH + i * RH + RH / 2;
        s += `<rect x="16" y="${y - RH / 2 + 2}" width="${MAP_W - 32}" height="${RH - 4}" rx="6" fill="${i % 2 ? 'transparent' : '#0F2036'}" opacity="0.8"/>`;
        s += `<circle cx="32" cy="${y}" r="4" fill="${STATUS_COLOR[j.status]}"/>`;
        if (j.status === 'running')
            s += glow(32, y, STATUS_COLOR.running);
        s += `<text x="44" y="${y + 4}" font-size="11.5" fill="${C.cream}">${esc(cut(j.name, 27))}</text>`;
        const mine = events.filter((e) => e.job === j.id && e.t >= from - 7 * HOUR).sort((a, b) => a.t - b.t);
        const { bars, dots } = segments(mine, now);
        for (const b of bars) {
            if (b.b < from)
                continue;
            const xa = Math.max(LABEL, x(b.a)), xb = Math.max(xa + 6, x(b.b));
            s += `<rect x="${xa}" y="${y - 6}" width="${xb - xa}" height="12" rx="4" fill="${stateColor(b.state)}" opacity="${b.open ? 0.9 : 0.75}">${b.open ? `<animate attributeName="opacity" values="0.95;0.45;0.95" dur="1.4s" repeatCount="indefinite"/>` : ''}<title>${esc(`${j.name}: ${b.open ? 'running since' : b.state} ${clock(b.a)}${b.open ? '' : `–${clock(b.b)}`}`)}</title></rect>`;
        }
        for (const d of dots) {
            if (d.t < from)
                continue;
            const cx = x(d.t);
            s += d.state === 'failure'
                ? `<path d="M${cx},${y - 6} L${cx + 6},${y} L${cx},${y + 6} L${cx - 6},${y} Z" fill="${STATUS_COLOR.failed}"><title>${esc(`${j.name} failed ${clock(d.t)}`)}</title></path>`
                : `<circle cx="${cx}" cy="${y}" r="4.2" fill="${stateColor(d.state)}"><title>${esc(`${j.name} ${d.state} ${clock(d.t)}${d.detail ? `: ${d.detail}` : ''}`)}</title></circle>`;
        }
        for (const u of feed?.upcoming || []) {
            if (u.job !== j.id)
                continue;
            s += `<circle cx="${x(u.t)}" cy="${y}" r="3.6" fill="none" stroke="${C.dim}" stroke-width="1.2" opacity="0.8"><title>${esc(`${j.name} due ${clock(u.t)}`)}</title></circle>`;
        }
    });
    // deploys row
    const dy = TOPH + rows.length * RH + RH / 2;
    s += `<circle cx="32" cy="${dy}" r="4" fill="${C.gold}"/><text x="44" y="${dy + 4}" font-size="11.5" fill="${C.cream}">Vercel deploys</text>`;
    for (const d of feed?.deploys?.list || []) {
        const t = d.created || 0;
        if (t < from || d.state === 'CANCELED')
            continue;
        const col = d.state === 'READY' ? (d.target === 'production' ? C.gold : C.goldSoft) : d.state === 'ERROR' ? STATUS_COLOR.failed : STATUS_COLOR.running;
        s += `<rect x="${x(t) - 4}" y="${dy - 4}" width="8" height="8" rx="1.5" fill="${col}" transform="rotate(45 ${x(t)} ${dy})"><title>${esc(`Deploy ${d.state.toLowerCase()} ${clock(t)}${d.message ? `: ${d.message}` : ''}`)}</title></rect>`;
    }
    // now
    s += `<line x1="${x(now)}" y1="${TOPH - 8}" x2="${x(now)}" y2="${H - 24}" stroke="${C.gold}" stroke-width="1.6"/>`;
    s += `<circle cx="${x(now)}" cy="${TOPH - 8}" r="3.5" fill="${C.gold}">${'<animate attributeName="r" values="3.5;6;3.5" dur="2s" repeatCount="indefinite"/>'}</circle>`;
    s += `<text x="${x(now) + 6}" y="${H - 10}" font-size="9.5" fill="${C.gold}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">now ${clock(now)}</text>`;
    // key
    s += `<text x="24" y="${H - 10}" font-size="9.5" fill="${C.faint}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace">bar = a run · dot = a check-in · red ◆ = failed · ○ = due</text>`;
    return s + '</svg>';
}
export function timelineHeight(feed) {
    const n = Math.max(TIMELINE_ORDER.length, feed?.jobs.length || 0);
    return 54 + (n + 1) * 30 + 30;
}
