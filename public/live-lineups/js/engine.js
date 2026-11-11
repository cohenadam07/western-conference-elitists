// Live Lineups engine: pure functions, no DOM. The browser and the Node tests import this same file.
// parseGame() is a line-for-line port of public/live-lineups/reference/parse.py (the backtest parser);
// tools/live-lineups/parity.mjs checks it against the Python on real games. Do not "improve" it in place.

// All constants in one place. Source: project doc claude/ou-lineup-backtests.md (WCE backtests, 2025-26 D1).
export const CONFIG = {
  version: '1.0',
  P3: 0.339,            // D1 three-point percentage, for luck-adjusted points
  SD: 1.167,            // per-possession points SD, for the 95% band
  K_LINEUP: 1000,       // lineup Trust = n / (n + 1000)
  K_PLAYER: 2000,       // player on/off Trust = n_eff / (n_eff + 2000)
  MIN_RATED_POSS: 300,  // only for the "N of the 10 have little college data" count; the matchup uses every rating (ridge already shrinks small samples; backtest calibration slope 0.93)
  D1_TOV_FORCED: 17,    // D1 average turnovers forced per 100
  FAST_BREAK_S: 6,      // field goal within 6 s of a live-ball start
  BONUS: 7, DOUBLE_BONUS: 10, // NCAA men: one-and-one on the 7th team foul of the half, double bonus on the 10th
  REFRESH_LIVE_S: 15, REFRESH_PRE_S: 60, STALE_S: 60,
};

export const RIM_TYPES = new Set(['LayUpShot', 'DunkShot', 'TipShot']);

export function clockS(c) {
  c = String(c);
  if (c.includes(':')) { const [m, s] = c.split(':'); return parseInt(m, 10) * 60 + parseFloat(s); }
  return parseFloat(c);
}
export function elapsed(period, c) {
  const t = clockS(c);
  if (period <= 2) return (period - 1) * 1200 + (1200 - t);
  return 2400 + (period - 3) * 300 + (300 - t);
}
export function fmtClock(secLeft) { const s = Math.round(secLeft); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function mmss(min) { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function periodOf(t) { return t < 1200 ? 1 : t < 2400 ? 2 : 3 + Math.floor((t - 2400) / 300); }
export function periodEnd(per) { return per <= 2 ? per * 1200 : 2400 + (per - 2) * 300; }
export function halfLabel(per) { return per <= 2 ? per : `OT${per - 2}`; }
export function lastName(n) { const p = String(n).split(/\s+/); return ['Jr.', 'Sr.', 'II', 'III', 'IV', 'Jr'].includes(p[p.length - 1]) && p.length > 1 ? p[p.length - 2] : p[p.length - 1]; }

// ---------------------------------------------------------------- ESPN summary -> compact game
export function compact(raw) {
  const comp = raw.header.competitions[0];
  let home = null, away = null; const score = {}, teams = {};
  for (const c of comp.competitors) {
    const tid = c.team.id;
    if (c.homeAway === 'home') home = tid; else away = tid;
    score[tid] = c.score ?? null;
    teams[tid] = { location: c.team.location || c.team.displayName, abbreviation: c.team.abbreviation, shortDisplayName: c.team.shortDisplayName, displayName: c.team.displayName, logo: (c.team.logos || [])[0]?.href };
  }
  const box = {};
  for (const t of (raw.boxscore?.players || [])) {
    const rows = [];
    for (const st of (t.statistics || []).slice(0, 1)) for (const a of (st.athletes || [])) {
      const ath = a.athlete;
      rows.push([ath.id, ath.displayName || '', !!a.starter, !!a.didNotPlay, ath.position?.abbreviation || '', ath.jersey ?? null]);
    }
    box[t.team.id] = rows;
  }
  const plays = (raw.plays || []).map(p => {
    const co = p.coordinate || {};
    return [p.period.number, p.clock.displayValue, p.team?.id ?? null, p.type?.text || '', p.text || '', p.scoreValue || 0,
      !!p.scoringPlay, !!p.shootingPlay, (p.participants || []).filter(a => a.athlete).map(a => a.athlete.id),
      co.x ?? null, co.y ?? null, p.homeScore ?? null, p.awayScore ?? null, p.wallclock || null];
  });
  const st = comp.status || raw.header?.competitions?.[0]?.status || {};
  const official = {};
  for (const t of (raw.boxscore?.teams || [])) {
    const o = {}; for (const s of (t.statistics || [])) if (['turnoverPoints', 'fastBreakPoints', 'pointsInPaint'].includes(s.name)) o[s.name] = Number(s.displayValue);
    official[t.team.id] = o;
  }
  return { gid: comp.id, date: comp.date, home, away, score, teams, box, plays, official,
    status: { state: st.type?.state, name: st.type?.name, completed: !!st.type?.completed, period: st.period, clock: st.displayClock, detail: st.type?.shortDetail } };
}

// ---------------------------------------------------------------- the backtest parser (exact port)
export function parseGame(g) {
  const plays = g.plays, box = g.box;
  const teams = Object.keys(box).filter(t => t);
  if (teams.length !== 2) return [null, 'teams'];
  const lineup = {};
  for (const t of teams) {
    const st = box[t].filter(a => a[2]).map(a => a[0]);
    if (st.length !== 5) return [null, 'starters'];
    lineup[t] = new Set(st);
  }
  const opp = { [teams[0]]: teams[1], [teams[1]]: teams[0] };
  const home = g.home;
  const roster = {}; for (const t of teams) roster[t] = new Set(box[t].map(a => a[0]));
  let errs = 0, checks = 0;
  const poss = []; let cur = null;
  const newPoss = (off, i) => {
    const p = plays[i]; const hs = p[11] || 0, as_ = p[12] || 0;
    const m = off === home ? hs - as_ : as_ - hs;
    return { off, de: opp[off], period: p[0], clock: p[1], t0: elapsed(p[0], p[1]), margin: m, pts: 0, opp_pts: 0, fga: 0, fg3a: 0, fg3m: 0, fg2a: 0,
      rim_fga: 0, rim_fgm: 0, fgm: 0, fta: 0, ftm: 0, oreb: 0, tov: 0, off5: null, def5: null, n_ev: 0, sh3: [] };
  };
  const close = (endtype) => { if (cur !== null && cur.n_ev > 0) { cur.end = endtype; poss.push(cur); } cur = null; };
  const snap = (c) => { if (c.off5 === null) { c.off5 = [...lineup[c.off]].sort().join('|'); c.def5 = [...lineup[c.de]].sort().join('|'); } };
  const n = plays.length; let i = 0; const consumed = new Set();
  const isDeadOrFT = (ty) => ty.includes('FreeThrow') || ty === 'PersonalFoul' || ty === 'Technical Foul' || ty === 'Dead Ball Rebound' || ty.includes('TimeOut');
  while (i < n) {
    const p = plays[i];
    const [per, clk, tid, typ, txt, sv, scoring, shooting, parts] = p;
    if (typ === 'Substitution') {
      if (consumed.has(i)) { i += 1; continue; }
      let j = i; const touched = new Set();
      while (j < n && plays[j][1] === clk && plays[j][0] === per) {
        const q = plays[j];
        if (q[3] === 'Substitution') {
          const pid = q[8] && q[8].length ? q[8][0] : null; const t = q[2];
          if (pid && t in lineup) {
            touched.add(t);
            if (q[4].includes('subbing out')) { if (lineup[t].has(pid)) lineup[t].delete(pid); else errs += 1; }
            else { if (lineup[t].has(pid)) errs += 1; lineup[t].add(pid); }
          }
          if (j !== i) consumed.add(j);
        } else if (!isDeadOrFT(q[3])) break;
        j += 1;
      }
      j = i + 1;
      for (const t of touched) if (lineup[t].size !== 5) return [null, 'size'];
      i = j; continue;
    }
    if (typ === 'End Period' || typ === 'End Game') { close('period'); i += 1; continue; }
    if (!(tid in lineup)) { i += 1; continue; }
    if (parts && parts.length && typ !== 'PersonalFoul' && typ !== 'Technical Foul' && roster[tid] && roster[tid].has(parts[0])) {
      checks += 1; if (!lineup[tid].has(parts[0])) errs += 1;
    }
    const isFt = typ.includes('FreeThrow');
    const isFga = shooting && !isFt;
    const isTov = typ.includes('Turnover');
    if (typ === 'Offensive Rebound') {
      if (cur === null) cur = newPoss(tid, i);
      if (cur.off === tid) { cur.oreb += 1; cur.n_ev += 1; }
      i += 1; continue;
    }
    if (typ === 'Defensive Rebound') {
      if (cur !== null && cur.off === opp[tid]) close('dreb');
      i += 1; continue;
    }
    if (isFga || isFt || isTov) {
      if (cur === null || cur.off !== tid) { close('flip'); cur = newPoss(tid, i); }
      snap(cur); cur.n_ev += 1;
      if (isTov) { cur.tov += 1; close('tov'); i += 1; continue; }
      if (isFga) {
        const three = sv === 3;
        cur.fga += 1;
        if (three) { cur.fg3a += 1; cur.sh3.push(parts && parts.length ? parts[0] : null); }
        else { cur.fg2a += 1; if (RIM_TYPES.has(typ)) cur.rim_fga += 1; }
        if (scoring) {
          cur.fgm += 1; cur.pts += sv;
          if (three) cur.fg3m += 1; else if (RIM_TYPES.has(typ)) cur.rim_fgm += 1;
          let k = i + 1, andone = false;
          while (k < n && plays[k][1] === clk && plays[k][0] === per) {
            if (plays[k][3].includes('FreeThrow') && plays[k][2] === tid) { andone = true; break; }
            const ty = plays[k][3];
            if (ty === 'PersonalFoul' || ty === 'Substitution' || ty === 'Technical Foul' || ty.includes('TimeOut')) { k += 1; continue; }
            break;
          }
          if (!andone) close('fgm');
        }
        i += 1; continue;
      }
      if (isFt) {
        cur.fta += 1;
        if (scoring) { cur.ftm += 1; cur.pts += 1; }
        let k = i + 1, more = false;
        while (k < n) {
          const q = plays[k];
          if (q[3].includes('FreeThrow') && q[2] === tid) { more = true; break; }
          if (q[3] === 'Substitution' || q[3] === 'PersonalFoul' || q[3] === 'Technical Foul' || q[3] === 'Dead Ball Rebound' || q[3].includes('TimeOut')) { k += 1; continue; }
          break;
        }
        if (!more && scoring) close('ftm');
        i += 1; continue;
      }
    }
    i += 1;
  }
  close('end');
  return [{ poss, errs, checks }, 'ok'];
}

// ---------------------------------------------------------------- stints (reference/fill_sheet.py stints_for, any team, with OT)
export function stintWindows(g, team) {
  const plays = g.plays;
  const five = (g.box[team] || []).filter(a => a[2]).map(a => a[0]);
  if (five.length !== 5) return { ok: false, err: 'starters', windows: [] };
  const out = []; let start = 0, cur = new Set(five); const key = s => [...s].sort().join('|');
  let i = 0; const n = plays.length;
  while (i < n) {
    const p = plays[i];
    if (p[3] === 'Substitution' && p[2] === team) {
      const t = elapsed(p[0], p[1]); const per = p[0], clk = p[1]; const nw = new Set(cur);
      while (i < n && plays[i][0] === per && plays[i][1] === clk) {
        const q = plays[i];
        if (q[3] === 'Substitution' && q[2] === team && q[8] && q[8].length) { if (q[4].includes('subbing out')) nw.delete(q[8][0]); else nw.add(q[8][0]); }
        i += 1;
      }
      if (key(nw) !== key(cur)) {
        if (nw.size !== 5) return { ok: false, err: 'size', at: { period: per, clock: clk }, windows: out };
        if (t > start) out.push({ t0: start, t1: t, key: key(cur) });
        start = t; cur = nw;
      }
      continue;
    }
    if (p[3] === 'End Period') { const t = elapsed(p[0], p[1]); if (t > start) out.push({ t0: start, t1: t, key: key(cur) }); start = t; }
    i += 1;
  }
  const lastT = plays.length ? elapsed(plays[plays.length - 1][0], plays[plays.length - 1][1]) : 0;
  const endT = g.cut != null ? Math.max(g.cut, lastT) : lastT;
  if (endT > start) out.push({ t0: start, t1: endT, key: key(cur), open: !g.final });
  return { ok: true, windows: out, current: key(cur), currentStart: start };
}

const STAT_KEYS = ['pts', 'fga', 'oreb', 'tov', 'fta', 'fg3m', 'fg3a', 'rim_fga'];
// One Stint Log row per stint: stats = possessions whose first event falls in the window (fill_sheet.py).
export function stintRows(windows, poss, team) {
  return windows.map((w, k) => {
    const u = { OU_poss: 0, Opp_poss: 0, mismatch: 0 }; for (const s of STAT_KEYS) { u['OU_' + s] = 0; u['Opp_' + s] = 0; }
    for (const p of poss) {
      if (!((w.t0 <= p.t0 && p.t0 < w.t1) || (p.t0 === w.t1 && k === windows.length - 1))) continue;
      const side = p.off === team ? 'OU' : 'Opp';
      const five = p.off === team ? p.off5 : p.def5;
      if (five !== w.key) u.mismatch += 1;
      u[side + '_poss'] += 1;
      for (const s of STAT_KEYS) u[`${side}_${s}`] += p[s];
    }
    const per = periodOf(w.t0); const base = periodEnd(per);
    return { ...w, half: halfLabel(per), period: per, start: fmtClock(base - w.t0), end: fmtClock(base - w.t1), minutes: (w.t1 - w.t0) / 60, u, players: w.key.split('|') };
  });
}

// ---------------------------------------------------------------- bad-substitution repair
// A player credited with an action while "off" goes on; the teammate idle longest comes off. A substitution group that
// leaves a team with more or fewer than five is fixed the same way. Returns repaired plays and where it happened.
export function repairPlays(g) {
  const plays = g.plays, box = g.box; const teams = Object.keys(box);
  const lineup = {}, roster = {}, lastSeen = {};
  for (const t of teams) { lineup[t] = new Set(box[t].filter(a => a[2]).map(a => a[0])); roster[t] = new Set(box[t].map(a => a[0])); if (lineup[t].size !== 5) return null; }
  const out = [], repairs = [];
  const nextAction = (from, t, exclude) => { // bench player of team t who is next credited with an action
    for (let k = from; k < plays.length; k++) { const q = plays[k]; if (q[2] !== t || q[3] === 'Substitution' || !q[8]?.length) continue; const pid = q[8][0]; if (roster[t].has(pid) && !lineup[t].has(pid) && !exclude.has(pid)) return pid; }
    return null;
  };
  const recentBench = t => [...roster[t]].filter(x => !lineup[t].has(x) && lastSeen[x] != null).sort((a, b) => lastSeen[b] - lastSeen[a])[0] || null;
  const idlest = (t, keep) => [...lineup[t]].filter(x => !keep.has(x)).sort((a, b) => (lastSeen[a] ?? -1) - (lastSeen[b] ?? -1))[0];
  const synth = (p, t, pid, inOut) => [p[0], p[1], t, 'Substitution', `${pid} subbing ${inOut} (repaired)`, 0, false, false, [pid], null, null, p[11], p[12], null, 'repair'];
  let i = 0;
  while (i < plays.length) {
    const p = plays[i]; const t = p[2];
    if (p[3] === 'Substitution') {
      // apply the whole group at this clock, then fix sizes
      const per = p[0], clk = p[1]; let j = i; const touched = new Set(), cameIn = new Set();
      while (j < plays.length && plays[j][0] === per && plays[j][1] === clk) {
        const q = plays[j]; out.push(q);
        if (q[3] === 'Substitution' && q[8]?.length && lineup[q[2]]) {
          touched.add(q[2]); const pid = q[8][0];
          if (q[4].includes('subbing out')) lineup[q[2]].delete(pid); else { lineup[q[2]].add(pid); cameIn.add(pid); lastSeen[pid] = elapsed(per, clk); }
        } else if (q[8]?.length) lastSeen[q[8][0]] = elapsed(q[0], q[1]);
        j += 1;
      }
      for (const tt of touched) {
        let guard = 0;
        while (lineup[tt].size > 5 && guard++ < 5) { const x = idlest(tt, cameIn); lineup[tt].delete(x); out.push(synth(p, tt, x, 'out')); repairs.push({ period: per, clock: clk, team: tt }); }
        // Short-handed: the next bench player credited with an action comes on. Live, that action may not have happened
        // yet (KC vs FAMU, 1st half 8:20, the feed ended at 7:47), so fall back to the bench player seen most recently.
        while (lineup[tt].size < 5 && guard++ < 10) { const x = nextAction(j, tt, new Set()) || recentBench(tt); if (!x) break; lineup[tt].add(x); out.push(synth(p, tt, x, 'in')); repairs.push({ period: per, clock: clk, team: tt }); }
      }
      i = j; continue;
    }
    const pid = p[8]?.[0];
    if (pid && t && lineup[t] && roster[t].has(pid) && !lineup[t].has(pid) && p[3] !== 'PersonalFoul' && p[3] !== 'Technical Foul') {
      const keep = new Set(); for (let k = i; k < plays.length && plays[k][1] === p[1] && plays[k][0] === p[0]; k++) if (plays[k][2] === t && plays[k][8]?.length) keep.add(plays[k][8][0]);
      const x = idlest(t, keep);
      out.push(synth(p, t, pid, 'in'), synth(p, t, x, 'out'));
      lineup[t].add(pid); lineup[t].delete(x); repairs.push({ period: p[0], clock: p[1], team: t });
    }
    if (pid) lastSeen[pid] = elapsed(p[0], p[1]);
    out.push(p); i += 1;
  }
  return { plays: out, repairs };
}

// ---------------------------------------------------------------- summaries (identical formulas to the Excel tracker)
const SUM_KEYS = ['fga', 'fg3a', 'fg3m', 'rim_fga', 'rim_fgm', 'fta', 'ftm', 'tov', 'oreb', 'fgm'];
export function emptyCounter() { const u = { o_poss: 0, d_poss: 0, o_pts: 0, d_pts: 0 }; for (const s of SUM_KEYS) { u['o_' + s] = 0; u['d_' + s] = 0; } return u; }
export function addPoss(u, p, team) {
  const side = p.off === team ? 'o' : 'd';
  u[side + '_poss'] += 1; u[side + '_pts'] += p.pts; for (const s of SUM_KEYS) u[`${side}_${s}`] += p[s];
}
export function addCounter(a, b) { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }
export function summarize(u) {
  const op = u.o_poss, dp = u.d_poss; if (!op || !dp) return null;
  const { P3, SD } = CONFIG;
  const net = 100 * (u.o_pts / op - u.d_pts / dp);
  const lo = u.o_pts - 3 * (u.o_fg3m - P3 * u.o_fg3a), ld = u.d_pts - 3 * (u.d_fg3m - P3 * u.d_fg3a);
  const rate = (a, b) => (u[b] ? 100 * u[a] / u[b] : null);
  return { op, dp, pm: u.o_pts - u.d_pts, net, lnet: 100 * (lo / op - ld / dp), ortg: 100 * u.o_pts / op, drtg: 100 * u.d_pts / dp,
    pm_opp3_luck: -3 * (u.d_fg3m - P3 * u.d_fg3a), pm_own3_luck: 3 * (u.o_fg3m - P3 * u.o_fg3a),
    opp3: [u.d_fg3m, u.d_fg3a], own3: [u.o_fg3m, u.o_fg3a], pm95: 1.96 * SD * 100 * Math.sqrt(1 / op + 1 / dp), n: (op + dp) / 2,
    rim: rate('o_rim_fga', 'o_fga'), rim_allowed: rate('d_rim_fga', 'd_fga'), tpa: rate('o_fg3a', 'o_fga'), tpa_allowed: rate('d_fg3a', 'd_fga'),
    tov_forced: rate('d_tov', 'd_poss'), tov_rate: rate('o_tov', 'o_poss') };
}

// Per-game digest: everything later games need from this one (cached in the browser).
export function digest(g, team) {
  const [r, st] = parseGame(g); if (!r) return { gid: g.gid, ok: false, err: st };
  const W = stintWindows(g, team);
  const units = {}, players = {}, teamU = emptyCounter();
  for (const p of r.poss) {
    addPoss(teamU, p, team);
    const five = p.off === team ? p.off5 : p.def5; if (!five) continue; // a possession that never got a lineup snapshot (parser keeps it)
    addPoss(units[five] ||= emptyCounter(), p, team);
    for (const pid of five.split('|')) addPoss(players[pid] ||= emptyCounter(), p, team);
  }
  return { gid: g.gid, ok: true, team, teamU, units, players, rows: W.ok ? stintRows(W.windows, r.poss, team) : null };
}

// ---------------------------------------------------------------- helpers for the screens
export function teamNames(g, team) {
  const opp = Object.keys(g.box).find(t => t !== team) || (g.home === team ? g.away : g.home);
  const T = g.teams || {}; const o = T[opp] || {};
  const full = o.location || o.displayName || 'Opponent';
  const short = full.length <= 16 ? full : (o.abbreviation || o.shortDisplayName || full);
  return { opp, us: (T[team]?.location) || 'Oklahoma', oppFull: full, oppShort: short };
}
export function chicagoDate(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = k => Number(parts.find(p => p.type === k).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function sourcesAndRuns(plays, team, side) {
  const el = p => elapsed(p[0], p[1]);
  const startOf = (i, tm) => {
    for (let k = i - 1; k >= 0; k--) {
      const q = plays[k], ty = q[3];
      if (q[2] !== tm && q[2] && ty.includes('Turnover')) return ['tov', el(q), k];
      if (q[2] === tm && ty === 'Defensive Rebound') return ['dreb', el(q), k];
      if (q[2] !== tm && q[2] && q[6] && q[5]) return ['make', el(q), k];
      if (ty === 'End Period') return ['period', el(q), k];
    }
    return ['tip', 0, 0];
  };
  const events = [];
  plays.forEach((p, i) => {
    if (!p[6] || !p[5] || !p[2]) return;
    const t = el(p), tm = p[2], tags = [];
    const isFt = p[3].includes('FreeThrow');
    if (isFt) tags.push('Free throws');
    const [kind, ts, k] = startOf(i, tm);
    if (kind === 'tov') tags.push('Off turnovers');
    for (let j = k; j < i; j++) if (plays[j][3] === 'Offensive Rebound' && plays[j][2] === tm) { tags.push('Second chance'); break; }
    if ((kind === 'tov' || kind === 'dreb') && t - ts <= CONFIG.FAST_BREAK_S && !isFt) tags.push('Fast break');
    events.push({ team: side(tm), t, pts: p[5], tags });
  });
  // runs
  const seq = events.map(e => [e.t, e.team, e.pts]);
  let best = { margin: 0 };
  for (let i = 0; i < seq.length; i++) {
    let us = 0, them = 0;
    for (let j = i; j < seq.length; j++) {
      if (seq[j][1] === seq[i][1]) us += seq[j][2]; else them += seq[j][2];
      if (us - them > best.margin && them <= 4) best = { team: seq[i][1], us, them, t0: seq[i][0], t1: seq[j][0], margin: us - them };
    }
  }
  let current = null;
  if (seq.length) { const last = seq[seq.length - 1][1]; let pts = 0, since = 0; for (let j = seq.length - 1; j >= 0 && seq[j][1] === last; j--) { pts += seq[j][2]; since = seq[j][0]; } current = { team: last, pts, since }; }
  // "on a 9-2 run": ending at the latest score, the opponent's points while we have 2 or fewer
  const runFor = (who) => {
    let a = 0, b = 0, out = null;
    for (let j = seq.length - 1; j >= 0; j--) { if (seq[j][1] === who) a += seq[j][2]; else b += seq[j][2]; if (b > 2) break; if (!out || a > out.us) out = { us: a, them: b, t0: seq[j][0] }; }
    return out;
  };
  const lastFg = {};
  for (const p of plays) if (p[6] && p[7] && !p[3].includes('FreeThrow') && p[2]) lastFg[side(p[2])] = el(p);
  return { events, best, current, runFor, lastFg };
}

function boxFromPlays(plays) {
  const B = {}; const b = pid => (B[pid] ||= { pts: 0, fgm: 0, fga: 0, '3pm': 0, '3pa': 0, rimm: 0, rima: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 });
  for (const p of plays) {
    const parts = p[8] || []; if (!parts.length) continue;
    const pid = parts[0], typ = p[3];
    if (p[7] && !typ.includes('FreeThrow')) {
      const x = b(pid); x.fga += 1; const three = p[5] === 3 || p[4].includes('three point');
      if (three) x['3pa'] += 1; if (RIM_TYPES.has(typ)) x.rima += 1;
      if (p[6]) { x.fgm += 1; x.pts += p[5]; if (p[5] === 3) x['3pm'] += 1; if (RIM_TYPES.has(typ)) x.rimm += 1; if (parts.length >= 2) b(parts[1]).ast += 1; }
    } else if (typ.includes('FreeThrow')) { const x = b(pid); x.fta += 1; if (p[6]) { x.ftm += 1; x.pts += 1; } }
    else if (typ === 'Offensive Rebound') b(pid).orb += 1;
    else if (typ === 'Defensive Rebound') b(pid).drb += 1;
    else if (typ === 'Steal') b(pid).stl += 1;
    else if (typ === 'Block Shot') b(pid).blk += 1;
    else if (typ.includes('Turnover')) b(pid).tov += 1;
    else if (typ === 'PersonalFoul' || typ === 'Technical Foul') b(pid).pf += 1;
  }
  return B;
}

export function shotsFrom(plays, team, names) {
  const shots = [];
  for (const p of plays) {
    if (!p[7] || p[3].includes('FreeThrow')) continue;
    const parts = p[8] || []; const made = !!p[6];
    const hasXY = p[9] != null && p[10] != null && p[10] >= -1 && p[9] > -1000;
    shots.push({ team: p[2] === team ? 'OU' : 'OPP', x: hasXY ? p[9] : null, y: hasXY ? Math.max(0, p[10]) + 5.25 : null, chart: hasXY, made, ast: made && parts.length >= 2,
      sid: parts[0] || null, shooter: names[parts[0]] || '?', three: p[5] === 3 || p[4].includes('three point'), rim: RIM_TYPES.has(p[3]), t: elapsed(p[0], p[1]) });
  }
  return shots;
}

// ---------------------------------------------------------------- the whole picture at one moment
// g: compact game (plays possibly cut to a moment); team: our ESPN id; prior: digests of earlier games; ratings: RAPM file.
export function analyze(g, team, { prior = [], ratings = null, replay = false, rosterNames = null } = {}) {
  const N = teamNames(g, team); const opp = N.opp;
  const names = {}, jersey = {}, teamOf = {};
  for (const [t, ath] of Object.entries(g.box)) for (const a of ath) { names[a[0]] = a[1]; jersey[a[0]] = a[5]; teamOf[a[0]] = t; }
  const side = tid => (tid === team ? 'OU' : 'OPP');
  const plays = g.plays;
  const lastPlay = plays[plays.length - 1];
  const cut = g.cut != null ? g.cut : (lastPlay ? elapsed(lastPlay[0], lastPlay[1]) : 0);
  const usHome = g.home === team;
  const scoreAt = p => (p ? (usHome ? [p[11] || 0, p[12] || 0] : [p[12] || 0, p[11] || 0]) : [0, 0]);
  let [usScore, oppScore] = scoreAt(lastPlay);

  // parse, repairing a bad substitution if needed
  let gp = g, repairs = [], [res, status] = parseGame(g);
  let W = res ? stintWindows(g, team) : { ok: false };
  let Wopp = res ? stintWindows(g, opp) : { ok: false };
  if (!res || !W.ok || !Wopp.ok) {
    const rp = repairPlays(g);
    if (rp) {
      const g2 = { ...g, plays: rp.plays }; const [r2, s2] = parseGame(g2);
      if (r2) { const W2 = stintWindows(g2, team), Wo2 = stintWindows(g2, opp); if (W2.ok) { gp = g2; res = r2; status = s2; W = W2; Wopp = Wo2; repairs = rp.repairs; } }
    }
  }
  const lineupOk = !!(res && W.ok);
  const poss = res ? res.poss : [];
  const firstRepair = repairs[0];
  const repairT = firstRepair ? elapsed(firstRepair.period, firstRepair.clock) : null;

  // minutes from stint windows (both teams), fouls from plays
  const minutes = {};
  const addMin = (ws) => { for (const w of ws) for (const pid of w.key.split('|')) minutes[pid] = (minutes[pid] || 0) + (w.t1 - w.t0) / 60; };
  if (W.ok) addMin(W.windows); if (Wopp.ok) addMin(Wopp.windows);
  const fouls = {};
  for (const p of plays) if (p[3].includes('Foul') && p[8]?.length) fouls[p[8][0]] = (fouls[p[8][0]] || 0) + 1;
  const curPer = lastPlay ? lastPlay[0] : 1;
  const halfStart = curPer >= 2 ? 1200 : 0;
  const tf = { OU: 0, OPP: 0 };
  for (const p of plays) if (p[3] === 'PersonalFoul' && p[2] && elapsed(p[0], p[1]) >= halfStart && !(elapsed(p[0], p[1]) === halfStart && p[0] < curPer)) tf[side(p[2])] += 1;
  const tfFirst = { OU: 0, OPP: 0 };
  for (const p of plays) if (p[3] === 'PersonalFoul' && p[2] && p[0] === 1) tfFirst[side(p[2])] += 1;

  // stints (ours) with +/-
  const rows = W.ok ? stintRows(W.windows, poss, team) : [];
  const stints = rows.map(r => ({ t0: r.t0, t1: r.t1, key: r.key, players: r.players, pm: r.u.OU_pts - r.u.Opp_pts, open: !!r.open, flagged: repairT != null && r.t1 > repairT }));
  // the five on the floor now: the lineup after the latest substitution, even if it has not played a second yet
  const usNowKey = W.ok ? W.current : null;
  const oppNowKey = Wopp.ok ? Wopp.current : null;
  const together = W.ok ? Math.max(0, cut - W.currentStart) / 60 : 0;

  // tonight + prior
  const teamT = emptyCounter(), unitsT = {};
  for (const p of poss) { addPoss(teamT, p, team); const five = p.off === team ? p.off5 : p.def5; if (five) addPoss(unitsT[five] ||= emptyCounter(), p, team); }
  const teamP = emptyCounter(); const unitsP = {}; const playersP = {};
  for (const d of prior) { if (!d.ok) continue; addCounter(teamP, d.teamU); for (const [k, u] of Object.entries(d.units)) addCounter(unitsP[k] ||= emptyCounter(), u); for (const [k, u] of Object.entries(d.players)) addCounter(playersP[k] ||= emptyCounter(), u); }
  const T = summarize(teamT), P = summarize(teamP);
  const teamS = summarize(addCounter(addCounter(emptyCounter(), teamT), teamP));
  const units = Object.entries(unitsT).map(([k, u]) => {
    const t = summarize(u); const s = summarize(addCounter(addCounter(emptyCounter(), u), unitsP[k] || {}));
    let best = null, trust = 0;
    if (s && teamS) { trust = s.n / (s.n + CONFIG.K_LINEUP); best = (s.lnet - teamS.lnet) * trust; }
    return { key: k, players: k.split('|'), tonight: t, season: s, trust, best, rawT: u };
  });

  // players: tonight's on-court +/- and season on/off best guess
  const playersT = {};
  for (const p of poss) { const five = p.off === team ? p.off5 : p.def5; if (five) for (const pid of five.split('|')) addPoss(playersT[pid] ||= emptyCounter(), p, team); }
  const teamAll = addCounter(addCounter(emptyCounter(), teamT), teamP);
  const onoff = {};
  for (const pid of new Set([...Object.keys(playersT), ...Object.keys(playersP)])) {
    const on = addCounter(addCounter(emptyCounter(), playersT[pid] || {}), playersP[pid] || {});
    const off = emptyCounter(); for (const k in off) off[k] = teamAll[k] - on[k];
    const sOn = summarize(on), sOff = summarize(off);
    let best = null, trust = 0;
    if (sOn && sOff) { const nOn = sOn.n, nOff = sOff.n; const neff = nOn * nOff / (nOn + nOff); trust = neff / (neff + CONFIG.K_PLAYER); best = (sOn.lnet - sOff.lnet) * trust; }
    const tn = playersT[pid]; onoff[pid] = { tonightPm: tn ? tn.o_pts - tn.d_pts : 0, tonightPoss: tn ? (tn.o_poss + tn.d_poss) / 2 : 0, best, trust };
  }

  // on paper
  const RP = ratings?.players || {};
  const rated = pid => (RP[pid]?.[2] || 0) >= CONFIG.MIN_RATED_POSS;
  const o = pid => (RP[pid] ? RP[pid][0] : 0), d = pid => (RP[pid] ? RP[pid][1] : 0); // every rating; players with none count as average
  let expNow = null, expUnrated = null;
  if (usNowKey && oppNowKey) {
    const us = usNowKey.split('|'), th = oppNowKey.split('|'); const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
    expNow = sum(us, o) - sum(th, d) - (sum(th, o) - sum(us, d));
    expUnrated = [...us, ...th].filter(pid => !rated(pid)).length;
  }

  // shots, sources, runs, droughts, impact
  const shots = shotsFrom(plays, team, names);
  for (const s of shots) { const w = W.ok ? W.windows.find((w, k) => (w.t0 <= s.t && s.t < w.t1) || (k === W.windows.length - 1 && s.t <= w.t1)) : null; s.five = w ? w.key : null; }
  const SR = sourcesAndRuns(plays, team, side);
  const drought = { OU: cut - (SR.lastFg.OU ?? 0), OPP: cut - (SR.lastFg.OPP ?? 0) };
  const B = boxFromPlays(plays);
  const impact = [];
  for (const [pid, b] of Object.entries(B)) {
    if (teamOf[pid] === team || !teamOf[pid]) continue;
    const sc = b.pts + 0.4 * b.fgm - 0.7 * b.fga - 0.4 * (b.fta - b.ftm), pm = 0.7 * b.ast - b.tov, gl = 0.7 * b.orb + 0.3 * b.drb, df = b.stl + 0.7 * b.blk - 0.4 * b.pf;
    impact.push({ pid, name: names[pid], min: minutes[pid] || 0, box: b, scoring: sc, playmaking: pm, glass: gl, defense: df, gs: sc + pm + gl + df, on: !!(oppNowKey && oppNowKey.split('|').includes(pid)) });
  }
  impact.sort((a, b) => b.gs - a.gs);

  // whole-game point sources: ESPN's official numbers when present (live only), else computed
  const src = { OU: {}, OPP: {} };
  for (const e of SR.events) for (const tg of e.tags) src[e.team][tg] = (src[e.team][tg] || 0) + e.pts;
  const off = g.official || {};
  const srcGame = { OU: { ...src.OU }, OPP: { ...src.OPP } };
  if (!replay) for (const [tid, sd] of [[team, 'OU'], [opp, 'OPP']]) {
    if (off[tid]?.turnoverPoints != null && !Number.isNaN(off[tid].turnoverPoints)) srcGame[sd]['Off turnovers'] = off[tid].turnoverPoints;
    if (off[tid]?.fastBreakPoints != null && !Number.isNaN(off[tid].fastBreakPoints)) srcGame[sd]['Fast break'] = off[tid].fastBreakPoints;
  }

  // timeline of the lead
  const timeline = [[0, 0]];
  for (const p of plays) { if (p[11] == null) continue; const [a, b] = scoreAt(p); const m = a - b; const t = elapsed(p[0], p[1]); if (m !== timeline[timeline.length - 1][1]) timeline.push([t, m]); }
  timeline.push([cut, timeline[timeline.length - 1][1]]);

  // reconciliation: parsed points vs ESPN's running score
  // Points from the play-by-play. With a lineup parse, from its possessions (that also checks the parser); without one,
  // straight from the scoring plays, so bad substitutions never turn the light red when the points are all there.
  const parsed = { OU: 0, OPP: 0 };
  if (res) for (const p of poss) parsed[side(p.off)] += p.pts;
  else for (const p of plays) if (p[6] && p[2] && p[5]) parsed[side(p[2])] += p[5];

  // per-player rows
  const prow = pid => ({ pid, name: names[pid] || pid, min: minutes[pid] || 0, fouls: fouls[pid] || 0, on: !!((usNowKey && usNowKey.split('|').includes(pid)) || (oppNowKey && oppNowKey.split('|').includes(pid))),
    o: rated(pid) ? RP[pid][0] : null, d: rated(pid) ? RP[pid][1] : null, box: B[pid] || null, jersey: jersey[pid] });
  const ouPlayers = Object.keys(minutes).filter(pid => teamOf[pid] === team).sort((a, b) => minutes[b] - minutes[a]).map(prow);
  const oppPlayers = Object.keys(minutes).filter(pid => teamOf[pid] === opp).sort((a, b) => minutes[b] - minutes[a]).map(prow);

  return { team, opp, N, names, jersey, teamOf, cut, period: curPer, score: { OU: usScore, OPP: oppScore }, teamFouls: tf, teamFoulsFirst: tfFirst, fouls, minutes,
    usNow: usNowKey ? usNowKey.split('|') : [], oppNow: oppNowKey ? oppNowKey.split('|') : [], usNowKey, oppNowKey, together,
    stints, rows, poss, T, P, teamS, units, onoff, expNow, expUnrated, shots, events: SR.events, srcGame, bestRun: SR.best, currentRun: SR.current,
    runFor: SR.runFor, drought, impact, timeline, parsed, lineupOk, parseStatus: status, repairs, repairT, ouPlayers, oppPlayers, prior: prior.filter(d => d.ok).length, B };
}

// ---------------------------------------------------------------- takeaways (reference/mock3.py takeaways(), plus runs and droughts)
const r0 = x => Math.round(x);
const pct = x => `${Math.round(x)}%`;
export function takeaways(A, mode) {
  const T = A.T, P = A.P, OPP = A.N.oppShort; const out = [];
  if (!T) return out;
  const tfOpp = A.teamFouls.OPP; const second = A.period >= 2;
  const clockMin = Math.floor(Math.max(0, periodEnd(A.period) - A.cut) / 60);
  if (mode === 'live' || mode === 'all') {
    const rank = {}; [...A.oppPlayers].sort((a, b) => b.min - a.min).forEach((r, i) => { rank[r.pid] = i; });
    for (const pid of A.oppNow) {
      const f = A.fouls[pid] || 0; const nm = A.names[pid];
      const trouble = f >= 4 || (!second && f >= 3) || (!second && f >= 2 && clockMin >= 10);
      if (!trouble) continue;
      const rk = rank[pid] ?? 99;
      const role = ['their most-used player', 'their second most-used player', 'their third most-used player'][rk] || 'in the game';
      let why = rk < 3 ? `He is ${role} tonight (${r0(A.minutes[pid] || 0)} min).` : `He has played ${r0(A.minutes[pid] || 0)} min tonight.`;
      if (tfOpp === 6) why += ` ${OPP} also has 6 team fouls, so their next foul puts you in the bonus.`;
      else if (tfOpp >= 7) why += ` ${OPP} has ${tfOpp} team fouls, so every foul sends you to the line.`;
      out.push({ p: 1, kind: 'Attack', head: `Go at ${nm}. He has ${f} fouls.`, why });
    }
    if (!out.length && tfOpp >= 6) out.push({ p: 2, kind: 'Attack', head: `${OPP} has ${tfOpp} team fouls.`, why: tfOpp === 6 ? 'Their next foul puts you in the bonus.' : 'Every foul now sends you to the line.' });
    // runs and droughts
    const run = A.runFor('OPP');
    if (run && run.us >= 8 && run.them <= 2) out.push({ p: 2.5, kind: 'Watch out', head: `${OPP} is on a ${run.us}-${run.them} run.`, why: `It started with ${fmtClock(Math.max(0, periodEnd(periodOf(run.t0)) - run.t0))} left in the ${periodOf(run.t0) === 1 ? '1st half' : periodOf(run.t0) === 2 ? '2nd half' : 'overtime'}.` });
    if (A.drought.OU >= 180) out.push({ p: 2.6, kind: 'Watch out', head: `No Oklahoma field goal in ${mmss(A.drought.OU / 60)}.`, why: 'Free throws aside, the last basket was a while ago.' });
  }
  const lo = T.pm_opp3_luck, lw = T.pm_own3_luck, adj = T.pm - lo - lw;
  if (Math.abs(lo) >= 4 || Math.abs(lw) >= 4) {
    const lead = T.pm; let head, kind;
    if (Math.abs(adj - lead) <= 2.5) { head = lead > 0 ? `The ${lead}-point lead is earned. Shooting luck has about cancelled out.` : 'Shooting luck has about cancelled out.'; kind = 'Big picture'; }
    else if (adj < lead) { const a = Math.round(adj);
      head = lead <= 0 ? `Shooting luck is hurting them more than you. Without it you would be down about ${-a}.`
        : a >= lead / 2 ? `Most of the ${lead}-point lead is real: about ${a} without shooting luck.`
        : a >= 1 ? `Shooting luck is carrying much of this lead. Without it you would be up only about ${a}.`
        : a === 0 ? 'Shooting luck is carrying this lead. Without it the game would be about even.'
        : `Shooting luck is carrying this lead. Without it you would be down about ${-a}.`; kind = "Don't overreact"; }
    // Found live on FDU at ETAM: down 8 with luck worth 8 printed "about 0 the other way". Adjusted can still be a deficit.
    else { const a = Math.round(adj); head = `You are playing better than the score. ${a >= 1 ? `Without shooting luck you would be up about ${a}.` : a <= -1 ? `Without shooting luck you would be down only about ${-a}.` : 'Without shooting luck it would be about even.'}`; kind = "Don't overreact"; }
    const part = (m, a, luck, who) => { const v = Math.abs(Math.round(luck * 2) / 2);
      return v < 1 ? `${who} ${m} for ${a} from three, about what you would expect` : `${who} ${m} for ${a} from three, which has ${luck > 0 ? 'helped you by' : 'cost you'} about ${v} points`; };
    const why = part(T.opp3[0], T.opp3[1], lo, `${OPP} is`) + '. ' + part(T.own3[0], T.own3[1], lw, 'You are') + '. Neither tends to last.';
    out.push({ p: 3, kind, head, why });
  }
  if (P && T.tpa != null && P.tpa != null) {
    if (T.tpa - P.tpa >= 8) out.push({ p: 4, kind: 'Worth knowing', head: 'You are taking far more threes than usual.', why: `${pct(T.tpa)} of your shots tonight are threes, up from ${pct(P.tpa)} before tonight. Shots at the rim are ${pct(T.rim)}, ${T.rim <= P.rim ? 'down' : 'up'} from ${pct(P.rim)}.` });
    else if (P.tpa - T.tpa >= 8) out.push({ p: 4, kind: 'Worth knowing', head: 'You are taking fewer threes than usual.', why: `${pct(T.tpa)} of your shots are threes, down from ${pct(P.tpa)} before tonight.` });
  }
  if (T.tov_forced >= 24) out.push({ p: 5, kind: 'Keep doing', head: 'Your defense is forcing a lot of turnovers.', why: `${r0(T.tov_forced)} per 100 possessions tonight. The D1 average is ${CONFIG.D1_TOV_FORCED}.` });
  out.sort((a, b) => a.p - b.p);
  return mode === 'all' ? out : out.slice(0, mode === 'live' ? 3 : 4);
}
export function onPaper(A) {
  if (A.expNow == null) return null;
  const e = A.expNow, u = A.expUnrated;
  const head = e >= 2 ? `On paper, this five beats theirs by about ${r0(Math.abs(e))} per 100 possessions.` : e <= -2 ? `On paper, this five loses to theirs by about ${r0(Math.abs(e))} per 100 possessions.` : 'On paper, this matchup is about even.';
  const why = u >= 4 ? `Rough read: ${u} of the 10 have little college data yet.` : 'Based on every player’s results over the last season.';
  return { head, why };
}
