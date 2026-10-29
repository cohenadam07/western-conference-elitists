
// ---------------------------------------------------------------- comps, with the fingerprint overlay
function renderComps(sr){
  const cs = COACH.comps || [];
  const fp = sr ? Object.fromEntries(IDX.fingerprint.filter(k => seasonPct(sr)[k] != null).map(k => [k, seasonPct(sr)[k]])) : COACH.fingerprint;
  const mentor = COACH.lineage?.mentor;
  const list = cs.length ? cs.map(([id, d, cl, name]) => `<div class="lrow"${tipAttr(`<b>${esc(name)}</b><br>distance ${d} on the tendency fingerprint; closer than ${cl}% of all pairs in the pool`)}><span class="ln">${coachLink(id, name)}</span><span class="lv">closer than ${cl}% of pairs</span></div>`).join('') : '<div class="empty">not enough seasons to place him</div>';
  const fpBlock = fp && Object.keys(fp).length >= 6 ? `<div id="fpplate"><h3 class="sub">What his teams look like</h3><p class="since">tendencies only, as season percentiles${sr ? ` in ${sr.season}` : ' averaged over his career'} · overlay: <span id="fpwho"></span> · hover a row</p>
    <div class="tabs">${mentor ? `<button class="tab" data-fp="${mentor}">mentor: ${esc(COACH.lineage.mentor_name)}</button>` : ''}${cs.slice(0, 3).map((c) => `<button class="tab" data-fp="${c[0]}">${esc(c[3])}</button>`).join('')}</div>
    <div class="fp" id="fpbody"></div><div class="legend2"><span><span class="sw" style="background:#22395A;border-radius:50%"></span>${esc(COACH.name)}</span><span><span class="sw" style="background:#BC3A2C;border-radius:50%"></span>overlay (career)</span><span>left: less of it · right: more of it</span></div></div>` : '';
  return `<div class="col wide"><h2 class="col-h">Who coaches like him</h2><p class="since">nearest on the fingerprint, among the career pool · "closer than X% of pairs"</p><div class="grid2"><div>${list}</div><div>${fpBlock}</div></div></div>`;
}
async function drawFingerprint(otherId, sr){
  const body = document.getElementById('fpbody'); if (!body) return;
  let other = null;
  if (otherId) { try { other = CMPC[otherId] || (CMPC[otherId] = await fetchJSON(`${BASE}/c/${otherId}.json`)); } catch (e) {} }
  const who = document.getElementById('fpwho'); if (who) who.innerHTML = other ? coachLink(other.id, other.name) : 'none';
  const fp = sr ? Object.fromEntries(IDX.fingerprint.filter(k => seasonPct(sr)[k] != null).map(k => [k, seasonPct(sr)[k]])) : COACH.fingerprint, ofp = other?.fingerprint || {};
  body.innerHTML = IDX.fingerprint.filter(k => fp[k] != null).map(k => `<span${tipAttr(statTip(k, {v: sr ? sr.values?.[k]?.[0] : undefined, pct: fp[k], pool: sr ? seasonPools(sr)[k] : COACH.career.stats[k]?.pool, season: sr?.season}) + (ofp[k] != null ? `<div class="def">${esc(other.name)}: ${ord(ofp[k])} percentile</div>` : ''))}>${esc(STATS[k]?.label || k)}</span><span class="track"><i style="left:${fp[k]}%;background:#22395A"></i>${ofp[k] != null ? `<i style="left:${ofp[k]}%;background:#BC3A2C;opacity:.85"></i>` : ''}</span>`).join('');
  document.querySelectorAll('[data-fp]').forEach(b => b.classList.toggle('on', b.dataset.fp === otherId));
}

// ---------------------------------------------------------------- the tree
// Football Coaching Savant's forest, grown from IDX.tree: every root is a tree, branches thin as the
// line thins, children fan upward. Branches take their root's colour; a node is a dot with the man's
// record beside his name once you are close enough to read it. Search flies to a coach, hover lights
// his line to the trunk, click opens his page. The assistants toggle adds men who were never a head
// coach of record. A stage is any element: the tree view's, or the small one on a coach's page.
const TRUNK_LEN = 150, DECAY = 0.85, SPREAD_MAX = 150, NODE_R = 6;
const ROOT_COLORS = ['#22395A', '#BC3A2C', '#C2A263', '#1C4E86', '#4E535B', '#7A4E8C', '#2E7D5B', '#B5651D', '#8A1C3A', '#3C6E71'];
let FOREST = {with: null, without: null};
function hash01(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
const recOf = id => IDX.coaches.find(c => c.id === id);
const isHC = id => !!(recOf(id)?.hc);
function buildForest(assistants){
  const N = IDX.tree.nodes, kids = {}, all = {};
  const memoKeep = {};
  const keep = id => { if (memoKeep[id] != null) return memoKeep[id]; memoKeep[id] = false; const k = assistants || isHC(id) || (N[id]?.kids || []).some(x => keep(x)); memoKeep[id] = k; return k; };
  for (const id in N) {
    if (!keep(id)) continue;
    all[id] = 1;
    const m = N[id].mentor;
    if (m && N[m]) { all[m] = 1; (kids[m] = kids[m] || []).push(id); }
  }
  const roots = Object.keys(all).filter(id => !(N[id].mentor && N[N[id].mentor]));
  const memo = {};
  const size = n => { if (memo[n] != null) return memo[n]; let s = 1; for (const k of kids[n] || []) s += size(k); return (memo[n] = s); };
  roots.forEach(size);
  return {kids, roots, size};
}
function growTree(root, f, color){
  const nodes = [], branches = [], rootSize = f.size(root);
  const maxW = Math.max(5, Math.min(14, 4 + Math.sqrt(rootSize) * 1.7));
  function grow(name, x, y, ang, depth, len){
    const s = f.size(name), w = Math.max(1.6, maxW * Math.pow(s / rootSize, 0.34));
    const ks = (f.kids[name] || []).slice().sort((a, b) => f.size(b) - f.size(a) || a.localeCompare(b));
    nodes.push({name, x, y, depth, size: s, ang, leaf: !ks.length, w});
    if (!ks.length) return;
    const spread = Math.min(SPREAD_MAX, 34 + 16 * ks.length), n = ks.length;
    let lo = ang - spread / 2, hi = ang + spread / 2;
    const UP_MIN = -172, UP_MAX = -8;
    if (lo < UP_MIN) { hi += UP_MIN - lo; lo = UP_MIN; }
    if (hi > UP_MAX) { lo -= hi - UP_MAX; hi = UP_MAX; }
    lo = Math.max(lo, UP_MIN); hi = Math.min(hi, UP_MAX);
    ks.forEach((k, i) => {
      const t = n === 1 ? 0.5 : (i + 0.5) / n, jitter = (hash01(k) - 0.5) * (n === 1 ? 26 : 14);
      let a = lo + (hi - lo) * t + jitter; a = Math.max(UP_MIN, Math.min(UP_MAX, a));
      const kl = len * DECAY * (0.82 + 0.36 * hash01(k + 'l')), rad = a * Math.PI / 180;
      const nx = x + Math.cos(rad) * kl, ny = y + Math.sin(rad) * kl, bow = (hash01(k + 'b') - 0.5) * kl * 0.30;
      const mx = (x + nx) / 2 + Math.cos(rad + Math.PI / 2) * bow, my = (y + ny) / 2 + Math.sin(rad + Math.PI / 2) * bow;
      branches.push({from: name, to: k, x1: x, y1: y, cx: mx, cy: my, x2: nx, y2: ny, w: Math.max(1.4, maxW * Math.pow(f.size(k) / rootSize, 0.34)), color});
      grow(k, nx, ny, a, depth + 1, kl);
    });
  }
  const trunk = TRUNK_LEN * (0.75 + 0.4 * Math.min(1, Math.log(rootSize + 1) / Math.log(40)));
  grow(root, 0, -trunk * 0.85, -90, 0, trunk);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const nd of nodes) { minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x); minY = Math.min(minY, nd.y); maxY = Math.max(maxY, nd.y); }
  return {root, color, nodes, branches, size: rootSize, minX: minX - 60, maxX: maxX + 60, minY: minY - 24, maxY: maxY + 10};
}
function layoutForest(assistants){
  const key = assistants ? 'with' : 'without';
  if (FOREST[key]) return FOREST[key];
  const f = buildForest(assistants);
  const sorted = f.roots.slice().sort((a, b) => f.size(b) - f.size(a) || a.localeCompare(b));
  const grown = sorted.map((r, i) => growTree(r, f, ROOT_COLORS[i % ROOT_COLORS.length]));
  const trees = grown.filter(t => t.nodes.length > 1), sprouts = grown.filter(t => t.nodes.length === 1).sort((a, b) => nameOf(a.root).localeCompare(nameOf(b.root)));
  const GAP = 70; let x = 0; const ground = 0, all = [];
  for (const t of trees) { t.ox = x - t.minX; t.oy = ground; x += (t.maxX - t.minX) + GAP; all.push(t); }
  const perRow = Math.max(20, Math.round(Math.max(x, 2200) / 110));
  let row = 0, col = 0;
  for (const t of sprouts) { t.ox = col * 110 + 50; t.oy = ground + 76 + row * 40; t.sprout = true; t.nodes[0].y = 0; col++; if (col >= perRow) { col = 0; row++; } all.push(t); }
  let minY = 0, maxY = 0;
  for (const t of all) { for (const nd of t.nodes) { nd.gx = nd.x + t.ox; nd.gy = nd.y + t.oy; maxY = Math.max(maxY, nd.gy + 30); } for (const br of t.branches) { br.gx1 = br.x1 + t.ox; br.gy1 = br.y1 + t.oy; br.gcx = br.cx + t.ox; br.gcy = br.cy + t.oy; br.gx2 = br.x2 + t.ox; br.gy2 = br.y2 + t.oy; } minY = Math.min(minY, t.minY + t.oy); }
  const pad = 70;
  return (FOREST[key] = {trees: all, sproutN: sprouts.length, w: Math.max(x, Math.min(sprouts.length, perRow) * 110 + 50) + pad, h: (maxY - minY) + pad * 2, groundY: ground, top: minY - pad, kids: f.kids});
}
function nodeLabel(id){ const r = recOf(id); return r?.hc ? `${r.all_w}–${r.all_l}` : 'assistant'; }
function nodeTip(id){
  const N = IDX.tree.nodes, n = N[id], r = recOf(id);
  const line = [];
  if (r?.hc) line.push(`${r.all_w}–${r.all_l}, ${r.all_seasons} season${r.all_seasons === 1 ? '' : 's'} as a head coach${r.titles ? `, ${r.titles} title${r.titles > 1 ? 's' : ''}` : ''}${r.first ? ` (${r.first.slice(0, 4)}–${(r.last || '').slice(0, 4)})` : ''}`);
  else line.push('never a head coach of record');
  if (n.mentor && N[n.mentor]) line.push(`<span class="k">mentor: ${esc(N[n.mentor].name)}${n.role ? ', ' + esc(n.role) : ''}${n.override ? ' · set by hand' : ''}${n.tie ? ' · a tie' : ''}</span>`);
  if (n.size > 1) line.push(`<span class="k">${n.size - 1} head coach${n.size === 2 ? '' : 'es'} beneath him</span>`);
  line.push('<span class="k">click to open his page</span>');
  return `<b>${esc(n.name)}</b><br>${line.join('<br>')}`;
}
// a stage holds its own state on the element
function stageState(st){ return st._tr || (st._tr = {scale: 1, x: 0, y: 0, labels: -1, moved: 0, assistants: false, wired: false, focus: null}); }
function renderTree(st){
  const S = stageState(st), F = layoutForest(S.assistants), svg = st.querySelector('svg'), N = IDX.tree.nodes;
  S.forest = F;
  let wood = '', leaves = '', labels = '', roots = '';
  const ground = `<line x1="-60" y1="${F.groundY + 10}" x2="${F.w + 60}" y2="${F.groundY + 10}" stroke="#E1E0DC" stroke-width="2"/>` + (F.sproutN ? `<text class="rootlbl" x="50" y="${F.groundY + 52}" text-anchor="start">${F.sproutN} HEAD COACHES WITH NO RECORDED LINEAGE BEFORE THEIR FIRST HEAD JOB</text>` : '');
  for (const t of F.trees) {
    for (const br of t.branches) wood += `<path class="branch" data-from="${esc(br.from)}" data-to="${esc(br.to)}" stroke="${t.color}" stroke-width="${br.w.toFixed(1)}" d="M${br.gx1.toFixed(1)} ${br.gy1.toFixed(1)} Q${br.gcx.toFixed(1)} ${br.gcy.toFixed(1)} ${br.gx2.toFixed(1)} ${br.gy2.toFixed(1)}"/>`;
    const r = t.nodes[0];
    if (!t.sprout) wood += `<path class="branch trunk" data-to="${esc(r.name)}" stroke="${t.color}" stroke-width="${(r.w + 2).toFixed(1)}" d="M${r.gx.toFixed(1)} ${F.groundY + 8} L${r.gx.toFixed(1)} ${r.gy.toFixed(1)}"/>`;
    for (const nd of t.nodes) {
      const hc = isHC(nd.name), rec = recOf(nd.name), rr = hc ? NODE_R : NODE_R - 1.5;
      const pct = rec?.hc && rec.all_g ? rec.all_w / rec.all_g : null;
      const fill = pct == null ? '#E9E8E4' : mix('#1C4E86', '#BC3A2C', Math.max(0, Math.min(1, (pct - .3) / .4)));
      const he = headEntry(nd.name), ir = rr - 1.2, img = he && he[2] !== 2 && he[1] ? `<image data-src="${headSrc(he[1])}" x="${-ir}" y="${-ir}" width="${2 * ir}" height="${2 * ir}" preserveAspectRatio="xMidYMin slice"/>` : '';
      leaves += `<g class="leaf${hc ? '' : ' ast'}" data-n="${esc(nd.name)}" transform="translate(${nd.gx.toFixed(1)},${nd.gy.toFixed(1)})"${tipAttr(nodeTip(nd.name))}><circle r="${rr}" fill="${fill}"/>${img}</g>`;
      const up = !t.sprout && Math.sin(nd.ang * Math.PI / 180) <= 0;
      labels += `<text class="lbl ${nd.leaf && !t.sprout ? 'minor' : 'major'}" data-n="${esc(nd.name)}" x="${nd.gx.toFixed(1)}" y="${(nd.gy + (up ? -11 : 20)).toFixed(1)}">${esc(N[nd.name]?.name || nd.name)} <tspan class="rec">${nodeLabel(nd.name)}</tspan></text>`;
    }
    if (!t.sprout) roots += `<text class="rootlbl" x="${t.nodes[0].gx.toFixed(1)}" y="${F.groundY + 32}">${esc((N[t.root]?.name || t.root).toUpperCase())}</text>`;
  }
  svg.innerHTML = `<g class="tg">${ground}${wood}${roots}<g class="leaves">${leaves}</g><g class="labels">${labels}</g></g>`;
  S.labels = -1;
  fitTree(st);
  svg.querySelectorAll('.leaf').forEach(g => {
    g.addEventListener('click', () => { if (S.moved > 8) return; location.hash = 'c=' + g.dataset.n; });
    g.addEventListener('pointerenter', () => highlight(st, g.dataset.n));
    g.addEventListener('pointerleave', () => highlight(st, S.focus));
  });
  if (S.focus) setTimeout(() => flyTo(st, S.focus, 1.1), 30);
}
function highlight(st, name){
  const svg = st.querySelector('svg'), N = IDX.tree.nodes, S = stageState(st);
  if (!name) { svg.querySelectorAll('.leaf,.branch,.lbl').forEach(e => e.classList.remove('dim', 'hl')); return; }
  const path = {}, edges = {}; let cur = name; path[cur] = 1; let guard = 0;
  while (N[cur]?.mentor && N[N[cur].mentor] && guard++ < 20) { const m = N[cur].mentor; edges[m + '>' + cur] = 1; path[m] = 1; cur = m; }
  edges['>' + cur] = 1;
  for (const k of (S.forest?.kids || {})[name] || []) { edges[name + '>' + k] = 1; path[k] = 1; }
  svg.querySelectorAll('.leaf,.lbl').forEach(e => { const on = path[e.dataset.n]; e.classList.toggle('hl', !!on); e.classList.toggle('dim', !on); });
  svg.querySelectorAll('.branch').forEach(e => { const on = edges[(e.dataset.from || '') + '>' + e.dataset.to]; e.classList.toggle('hl', !!on); e.classList.toggle('dim', !on); });
}
function applyTransform(st){
  const S = stageState(st), g = st.querySelector('.tg'); if (g) g.setAttribute('transform', `translate(${S.x},${S.y}) scale(${S.scale})`);
  const tier = S.scale >= 1.0 ? 2 : (S.scale >= 0.45 ? 1 : 0);
  if (tier !== S.labels) { S.labels = tier; const l = st.querySelector('.labels'); if (l) { l.style.display = tier === 0 ? 'none' : ''; l.classList.toggle('leaves-too', tier === 2); } }
  clearTimeout(S.imgTimer); S.imgTimer = setTimeout(() => syncLeafImages(st), 120);
}
// the faces are fetched only for nodes on screen once the tree is zoomed enough for a face to read (about 400 of
// them at 15 KB each would otherwise land on every coach page); once loaded a node keeps its picture
function syncLeafImages(st){
  const S = stageState(st), svg = st.querySelector('svg'); if (!svg || S.scale < 0.45) return;
  const W = st.clientWidth, H = st.clientHeight;
  svg.querySelectorAll('.leaf image[data-src]').forEach(im => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(im.parentNode.getAttribute('transform') || ''); if (!m) return;
    const sx = S.x + m[1] * S.scale, sy = S.y + m[2] * S.scale;
    if (sx > -40 && sx < W + 40 && sy > -40 && sy < H + 40) { im.setAttribute('href', im.dataset.src); im.removeAttribute('data-src'); }
  });
}
function fitTree(st){
  const S = stageState(st), F = S.forest; if (!F) return;
  S.scale = Math.max(0.12, Math.min(1.1, (st.clientHeight - 24) / F.h));
  const cw = F.w * S.scale;
  S.x = (cw < st.clientWidth - 28) ? (st.clientWidth - cw) / 2 : 14;
  S.y = -F.top * S.scale + 12;
  const svg = st.querySelector('svg'); svg.setAttribute('width', st.clientWidth); svg.setAttribute('height', st.clientHeight);
  applyTransform(st);
}
function zoomTo(st, ns, cx, cy){ const S = stageState(st); ns = Math.max(0.08, Math.min(4, ns)); S.x = cx - (cx - S.x) * (ns / S.scale); S.y = cy - (cy - S.y) * (ns / S.scale); S.scale = ns; applyTransform(st); }
function zoomBy(st, f){ const r = st.getBoundingClientRect(); zoomTo(st, stageState(st).scale * f, r.width / 2, r.height / 2); }
function flyTo(st, name, scale){
  const S = stageState(st), F = S.forest; if (!F) return;
  let hit = null; for (const t of F.trees) for (const nd of t.nodes) if (nd.name === name) hit = nd;
  if (!hit) return;
  S.scale = scale || Math.max(S.scale, 1.0);
  S.x = st.clientWidth / 2 - hit.gx * S.scale; S.y = st.clientHeight / 2 - hit.gy * S.scale;
  applyTransform(st); highlight(st, name);
}
function wireTree(st){
  const S = stageState(st); if (S.wired) return; S.wired = true;
  const pts = {}; let drag = false, lx = 0, ly = 0, pinch = null, cap = 0;
  const at = e => { const r = st.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
  const pair = () => { const k = Object.keys(pts); return k.length >= 2 ? [pts[k[0]], pts[k[1]]] : null; };
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const grab = id => { if (cap) return; try { st.setPointerCapture(id); cap = id || 1; } catch (err) {} };
  st.addEventListener('pointerdown', e => {
    if (e.target.closest('.tctl') || e.target.closest('.tfind')) return;
    pts[e.pointerId] = at(e);
    const t = pair();
    if (t) { drag = false; st.classList.remove('drag'); grab(e.pointerId); pinch = {d: gap(t[0], t[1]), mid: {x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2}}; }
    else { drag = true; S.moved = 0; lx = e.clientX; ly = e.clientY; st.classList.add('drag'); }
  });
  st.addEventListener('pointermove', e => {
    if (!(e.pointerId in pts)) return;
    pts[e.pointerId] = at(e);
    const t = pair();
    if (t && pinch) { const d = gap(t[0], t[1]); if (d < 12) return; const mid = {x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2}; S.moved += Math.abs(d - pinch.d) + Math.abs(mid.x - pinch.mid.x); S.x += mid.x - pinch.mid.x; S.y += mid.y - pinch.mid.y; zoomTo(st, S.scale * (d / pinch.d), mid.x, mid.y); pinch.d = d; pinch.mid = mid; return; }
    if (!drag) return;
    S.moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
    if (S.moved > 4) grab(e.pointerId);
    S.x += e.clientX - lx; S.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; applyTransform(st);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) st.addEventListener(ev, e => {
    delete pts[e.pointerId];
    const k = Object.keys(pts);
    if (k.length < 2) pinch = null;
    if (k.length === 1) { const r = st.getBoundingClientRect(); lx = pts[k[0]].x + r.left; ly = pts[k[0]].y + r.top; drag = true; st.classList.add('drag'); }
    else if (!k.length) { drag = false; st.classList.remove('drag'); if (cap) { try { st.releasePointerCapture(e.pointerId); } catch (err) {} cap = 0; } }
  });
  st.addEventListener('wheel', e => { e.preventDefault(); const p = at(e); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? st.clientHeight : 1)); const f = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0032)); zoomTo(st, S.scale * Math.max(0.2, Math.min(5, f)), p.x, p.y); }, {passive: false});
  st.querySelector('.zin').onclick = () => zoomBy(st, 1.3);
  st.querySelector('.zout').onclick = () => zoomBy(st, 1 / 1.3);
  st.querySelector('.zfit').onclick = () => fitTree(st);
  const fsBtn = st.querySelector('.zfull');
  const paint = () => { const on = st.classList.contains('pseudo'); document.documentElement.classList.toggle('fslock', on); fsBtn.textContent = on ? '⤡' : '⛶'; setTimeout(() => fitTree(st), 60); };
  fsBtn.onclick = () => { st.classList.toggle('pseudo'); paint(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.classList.contains('pseudo')) { st.classList.remove('pseudo'); paint(); } });
  window.addEventListener('hashchange', () => { if (st.classList.contains('pseudo')) { st.classList.remove('pseudo'); paint(); } });
  const ast = st.querySelector('.zast');
  ast.onclick = () => { S.assistants = !S.assistants; ast.classList.toggle('on', S.assistants); renderTree(st); };
  const find = st.querySelector('.tfind');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  find.addEventListener('input', () => {
    const q = norm(find.value).trim(); if (!q) { highlight(st, S.focus); return; }
    const names = []; for (const t of S.forest.trees) for (const n of t.nodes) names.push(n.name);
    const hit = names.filter(n => norm(IDX.tree.nodes[n]?.name || n).includes(q)).sort((a, b) => (norm(IDX.tree.nodes[a]?.name).startsWith(q) ? 0 : 1) - (norm(IDX.tree.nodes[b]?.name).startsWith(q) ? 0 : 1))[0];
    if (hit) flyTo(st, hit);
  });
  window.addEventListener('resize', () => { if (st.isConnected && st.offsetParent) fitTree(st); });
}
function mountTree(st, focus){
  if (!st) return;
  const S = stageState(st); S.focus = focus || null;
  st.innerHTML = `<svg></svg><input class="tfind" placeholder="Find a coach…" aria-label="Find a coach in the tree"/><div class="tctl"><button class="zast${S.assistants ? ' on' : ''}" title="Add assistants who never became head coaches">+asst</button><button class="zin" title="Zoom in">+</button><button class="zout" title="Zoom out">−</button><button class="zfit" title="Fit the whole forest">⤢</button><button class="zfull" title="Full screen">⛶</button></div>`;
  S.wired = false;
  wireTree(st);
  renderTree(st);
}
function openTree(focus){
  document.body.className = 'view-tree';
  syncTabs('tree');
  document.title = 'The coaching tree — Basketball Coaching Savant';
  const el = document.getElementById('treeview'), N = IDX.tree.nodes, roots = IDX.tree.roots;
  if (!document.getElementById('treestage')) {
    const sprouts = Object.keys(N).filter(k => !N[k].mentor && N[k].size === 1 && isHC(k)).length;
    el.innerHTML = `<div class="col wide" style="padding-bottom:12px"><h2 class="col-h">The coaching tree</h2><p class="since">${roots.length} trees with more than one coach · ${sprouts} head coaches with no recorded lineage · drag to pan, scroll or pinch to zoom, hover a coach to light his line, click to open his page</p><div class="small">${esc(IDX.tree.note)}</div></div>
      <div class="treestage" id="treestage"></div>
      <div class="legend2" style="margin-top:10px"><span>branch colour: the root of the tree</span><span><span class="sw" style="background:#1C4E86;border-radius:50%"></span> to <span class="sw" style="background:#BC3A2C;border-radius:50%"></span> node colour: career win %, .300 to .700</span><span><span class="sw" style="background:#E9E8E4;border-radius:50%"></span>no head-coaching record</span><span>dotted node: an assistant who never became a head coach (toggle +asst)</span><span>names show as you zoom in; a coach who forked the tree is named at any zoom</span></div>`;
    mountTree(document.getElementById('treestage'), focus);
  } else {
    const st = document.getElementById('treestage'); stageState(st).focus = focus || null; fitTree(st); if (focus && N[focus]) setTimeout(() => flyTo(st, focus, 1.1), 50);
  }
  window.scrollTo(0, 0);
}

init();
</script>
</body>
</html>
