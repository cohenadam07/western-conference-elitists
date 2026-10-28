
// ---------------------------------------------------------------- the career chart
// One column per season, in the team's colour. Height is wins per 82; the strip above says how the
// playoffs ended; the rows below are net rating, wins above talent and wins above the market. Peak
// season: playoff success first (title, Finals, conference finals, second round, first round,
// missed), then regular-season results.
function careerRows(){
  const rows = [];
  const recs = COACH.records.filter(r => r.lg === 'NBA' || r.lg === 'BAA' || r.lg === 'ABA');
  const seen = new Set();
  for (const r of recs) {
    const s = COACH.seasons.find(x => x.season === r.season && x.team === r.team);
    const title = !!(s?.title) || /^(NBA|BAA|ABA) Champions/.test(r.remarks || '');
    const rounds = s ? s.rounds : null;
    const po = (s ? s.pg : r.pg) > 0;
    const tier = title ? 5 : rounds != null ? rounds : (po ? 1 : 0);      // 5 title, 4 lost Finals … 1 first round, 0 missed
    const unknownRound = !s && po && !title;
    rows.push({season: r.season, team: r.team, lg: r.lg, g: s ? s.g : r.g, w: s ? s.w : r.w, l: s ? s.l : r.l, pw: s ? s.pw : r.pw, pl: s ? s.pl : r.pl, net: s?.net, pct: s?.pct || {}, exp: s?.exp || {}, tier, title, unknownRound, has: !!s, remarks: r.remarks, finish: r.finish});
    seen.add(r.season + r.team);
  }
  for (const s of COACH.seasons) if (!seen.has(s.season + s.team)) rows.push({season: s.season, team: s.team, lg: 'NBA', g: s.g, w: s.w, l: s.l, pw: s.pw, pl: s.pl, net: s.net, pct: s.pct || {}, exp: s.exp || {}, tier: s.title ? 5 : s.rounds, title: s.title, has: true});
  rows.sort((a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team));
  return rows;
}
function peakOf(rows){
  let best = null;
  for (const r of rows) {
    if (!r.g) continue;
    const key = [r.tier || 0, r.g ? r.w / r.g : 0, r.net ?? -99];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = {r, key};
  }
  return best?.r || null;
}
function seasonTipHTML(r){
  const e = r.exp || {}, p = r.pct || {};
  const po = r.tier === 5 ? 'won the title' : r.unknownRound ? `playoffs ${r.pw}–${r.pl}` : (r.tier > 0 ? `${ROUND_L[r.tier]}${r.pw != null ? ` (${r.pw}–${r.pl})` : ''}` : 'missed the playoffs');
  const lines = [`<b>${r.season} ${esc(teamName(r.team))}</b> <span class="k">${r.lg !== 'NBA' ? r.lg : ''}</span>`, `${r.w}–${r.l}${r.g && r.g !== 82 ? ` <span class="k">(${(82 * r.w / r.g).toFixed(1)} per 82)</span>` : ''} · ${po}`];
  if (!miss(r.net)) lines.push(`net ${signed(r.net)} ${miss(p.net) ? '' : pbox(p.net) + '<span class="k">percentile of that season\'s coaches</span>'}`);
  if (!miss(e.exp_w82)) lines.push(`talent expected ${e.exp_w82.toFixed(1)} wins per 82 → <b>${signed(e.w_talent)}</b> above talent${miss(p.w_talent) ? '' : ' ' + pbox(p.w_talent)}`);
  if (!miss(e.market_total)) lines.push(`preseason total ${e.market_total} → <b>${signed(e.w_market)}</b> above the market${miss(p.w_market) ? '' : ' ' + pbox(p.w_market)}`);
  if (r.remarks && !/Champions/.test(r.remarks)) lines.push(`<span class="k">${esc(r.remarks)}</span>`);
  if (!r.has) lines.push('<span class="k">before the game-level data (1996-97 on)</span>');
  else lines.push('<span class="k">click to open the season</span>');
  return lines.join('<br>');
}
function renderCareerChart(){
  const rows = careerRows();
  if (!rows.length) return '';
  const peak = peakOf(rows);
  const n = rows.length, W = CW(), narrow = W < 600, left = narrow ? 34 : 44, right = 12, bw = (W - left - right) / n, barw = Math.max(2, Math.min(34, bw * .72));
  const TOP = 34, HW = 150, GAP = 10, SUB = 34;              // playoff strip, wins panel, gaps, three sub rows
  const hasNet = rows.some(r => !miss(r.net)), hasT = rows.some(r => !miss(r.exp?.w_talent)), hasM = rows.some(r => !miss(r.exp?.w_market));
  const subs = [hasNet && ['net', 'net rating', r => r.net, 'sgn1'], hasT && ['w_talent', 'wins above talent', r => r.exp?.w_talent, 'sgn1'], hasM && ['w_market', 'wins above the market', r => r.exp?.w_market, 'sgn1']].filter(Boolean);
  const H = TOP + HW + subs.length * (SUB + GAP) + 26;
  const x = i => left + i * bw + (bw - barw) / 2;
  const yw = v => TOP + HW * (1 - Math.max(0, Math.min(82, v)) / 82);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="career, season by season">`;
  for (const g of [20, 41, 60, 82]) svg += `<line x1="${left}" x2="${W - right}" y1="${yw(g)}" y2="${yw(g)}" stroke="${g === 41 ? '#C4C0B6' : '#E4E1D9'}"/><text x="${left - 6}" y="${yw(g) + 3}" font-size="9" text-anchor="end" fill="#8A95A3">${g}</text>`;
  svg += `<text x="2" y="${TOP - 14}" font-size="9" text-anchor="start" fill="#8A95A3">${narrow ? 'PO' : 'playoffs'}</text><text transform="translate(10 ${TOP + HW / 2}) rotate(-90)" font-size="9" text-anchor="middle" fill="#8A95A3">wins per 82</text>`;
  rows.forEach((r, i) => {
    const w82 = r.g ? 82 * r.w / r.g : 0, col = teamColor(r.team), X = x(i), isPeak = r === peak, on = state.mode === r.season;
    const tip = tipAttr(seasonTipHTML(r));
    const open = r.has ? ` data-pick="${r.season}" class="hit"` : '';
    svg += `<g${open}${tip}>`;
    svg += `<rect x="${X - (bw - barw) / 2}" y="${TOP - 18}" width="${bw}" height="${H - TOP + 18}" fill="${on ? '#F1EBDD' : 'transparent'}"/>`;
    svg += `<rect x="${X}" y="${yw(w82)}" width="${barw}" height="${yw(0) - yw(w82)}" fill="${col}" opacity="${r.has ? .92 : .55}" rx="1.5"${isPeak ? ' stroke="#C2A263" stroke-width="2.5"' : ''}/>`;
    if (!miss(r.exp?.exp_w82)) svg += `<line x1="${X - 2}" x2="${X + barw + 2}" y1="${yw(r.exp.exp_w82)}" y2="${yw(r.exp.exp_w82)}" stroke="#1A2332" stroke-width="1.8"/>`;
    if (!miss(r.exp?.market_total)) svg += `<line x1="${X - 2}" x2="${X + barw + 2}" y1="${yw(r.exp.market_total)}" y2="${yw(r.exp.market_total)}" stroke="#BC3A2C" stroke-width="1.8" stroke-dasharray="3 2"/>`;
    // the playoff strip: one notch per round won, a star for the title, a hollow box for an old season whose round is not on record
    const cx = X + barw / 2;
    if (r.tier === 5) svg += `<text x="${cx}" y="${TOP - 6}" font-size="14" text-anchor="middle" fill="#C2A263">★</text>`;
    else if (r.unknownRound) svg += `<rect x="${cx - 4}" y="${TOP - 14}" width="8" height="8" fill="none" stroke="#8A95A3"/>`;
    else if (r.tier > 0) for (let k = 0; k < r.tier; k++) svg += `<rect x="${cx - 4}" y="${TOP - 7 - k * 4}" width="8" height="3" fill="${k === r.tier - 1 ? '#8A95A3' : '#22395A'}"/>`;
    if (isPeak) svg += `<text x="${cx}" y="${TOP - 26}" font-size="8.5" text-anchor="middle" fill="#C2A263" letter-spacing=".06em">PEAK</text>`;
    // the sub rows
    subs.forEach(([key, label, get, unit], j) => {
      const v = get(r), y0 = TOP + HW + GAP + j * (SUB + GAP), mid = y0 + SUB / 2, sc = key === 'net' ? SUB / 2 / 14 : SUB / 2 / 20;
      if (miss(v)) return;
      const h = Math.min(SUB / 2, Math.abs(v) * sc);
      svg += `<rect x="${X}" y="${v >= 0 ? mid - h : mid}" width="${barw}" height="${Math.max(h, .8)}" fill="${v >= 0 ? '#BC3A2C' : '#1C4E86'}" opacity=".85"/>`;
    });
    svg += '</g>';
    if (n <= (narrow ? 12 : 26) || i % (narrow ? 3 : 2) === 0 || isPeak) svg += `<text x="${cx}" y="${H - 8}" font-size="9" text-anchor="middle" fill="${isPeak ? '#C2A263' : '#5B6878'}">${r.season.slice(2, 4)}-${r.season.slice(5)}</text>`;
  });
  subs.forEach(([key, label], j) => { const y0 = TOP + HW + GAP + j * (SUB + GAP), mid = y0 + SUB / 2; svg += `<line x1="${left}" x2="${W - right}" y1="${mid}" y2="${mid}" stroke="#C4C0B6"/><text x="${left - 6}" y="${mid + 3}" font-size="9" text-anchor="end" fill="#8A95A3">${label.replace('wins above the market', 'vs market').replace('wins above talent', 'vs talent').replace('net rating', 'net')}</text>`; });
  svg += '</svg>';
  const pk = peak ? `${peak.season} ${teamName(peak.team)}: ${peak.w}–${peak.l}, ${peak.tier === 5 ? 'won the title' : peak.unknownRound ? 'reached the playoffs' : ROUND_L[peak.tier || 0]}` : '—';
  return `<div class="col wide"><h2 class="col-h">His career, season by season</h2><p class="since">every season as a head coach · columns are wins per 82 in the team's colour · peak season outlined in gold (playoff success first, then the regular season) · hover a season for its line, click it to open that season</p>${svg}
    <div class="legend2"><span><span class="sw" style="background:#1A2332;height:3px;vertical-align:2px"></span>talent expected wins (2003-04 on)</span><span><span class="sw" style="background:#BC3A2C;height:3px;vertical-align:2px"></span>preseason win total</span><span>★ title · notches: rounds won · ▢ playoffs, round not on record</span><span><span class="sw" style="background:#BC3A2C"></span>above / <span class="sw" style="background:#1C4E86"></span>below, in the three rows beneath</span><span>peak: ${esc(pk)}</span></div></div>`;
}
