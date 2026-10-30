/* With / Without — what a teammate's presence does to a player, from who was on the floor.

   One implementation for the card and the AI connector (api/_basketball-lists.js imports it), so
   the two cannot disagree. It sums a team-season file (public/bcs/ww/<team>-<season>.json.gz,
   pipeline/basketball/coaching/withwithout.py) and turns the sums into the card's rates.

   Usage: SavantWW.teammates(doc, pid)              -> [{id, name, sec, with_sec}] by minutes together
          SavantWW.split(doc, pid, ids, mode)       -> {with, without, rows, ...}
            mode 'floor': the minutes he played with / without them on the floor
            mode 'games': the games they played / missed

   Several teammates: "without" is none of them, "with" is the rest, so the two always add up to
   his whole season with the team.

   Each row's sample is in the unit of the stat's settle point, and a side under that point is
   flagged for hatching. Settle points are the card's own (tools/savant-settle/settle.json, the
   number at which half of what a stat shows is the player). The on-court team stats had none and
   are measured here by tools/savant-settle/measure_ww.py; see ON_SETTLE. */
(function (root) {
  'use strict';

  var POSS = 'possessions', FGA = 'field-goal attempts';
  // key, label, group, format, lower is better, hatch under, unit, value(a)
  function rate(n, d, x) { return d > 0 ? (x || 1) * n / d : null; }
  function per75(k) { return function (a) { return rate(a[k], a.poss, 75); }; }
  function shoot(a) { return a.fga + 0.44 * a.fta; }
  function tmPlays(s) { return s.fga + 0.44 * s.fta + s.tov; }
  function efg(s) { return rate(s.fgm + 0.5 * s.fg3m, s.fga, 100); }
  function tovp(s) { return rate(s.tov, tmPlays(s), 100); }
  function ftr(s) { return rate(s.fta, s.fga, 100); }

  // Measured by measure_ww.py: possessions at which half of what the on-floor number shows is
  // real, odd games against even, 2013-14 to 2025-26. Replaced by that script, not typed.
  var ON_SETTLE = /*ON_SETTLE*/{"net":1200,"ortg":660,"drtg":770,"pace":180,"t_efg":760,"t_tov":1400,"t_oreb":700,"t_ftr":900,"o_efg":900,"o_tov":910,"o_oreb":1400,"o_ftr":890};

  function on(key) { return ON_SETTLE[key] || 0; }

  var STATS = [
    ['pts75', 'Points per 75', 'Scoring', 1, 0, 190, POSS, per75('pts')],
    ['ts', 'True shooting', 'Scoring', 'p', 0, 280, 'shooting attempts', function (a) { return rate(a.pts, 2 * shoot(a), 100); }, shoot],
    ['efg', 'Effective FG%', 'Scoring', 'p', 0, 250, FGA, function (a) { return efg(a); }, function (a) { return a.fga; }],
    ['tp2', '2-point %', 'Scoring', 'p', 0, 150, 'two-point attempts', function (a) { return rate(a.fgm - a.fg3m, a.fga - a.fg3a, 100); }, function (a) { return a.fga - a.fg3a; }],
    ['tp3', '3-point %', 'Scoring', 'p', 0, 94, 'three-point attempts', function (a) { return rate(a.fg3m, a.fg3a, 100); }, function (a) { return a.fg3a; }],
    ['ft', 'Free-throw %', 'Scoring', 'p', 0, 38, 'free-throw attempts', function (a) { return rate(a.ftm, a.fta, 100); }, function (a) { return a.fta; }],
    ['tp3r', '3-point attempt rate', 'Scoring', 'p', 0, 9, FGA, function (a) { return rate(a.fg3a, a.fga, 100); }, function (a) { return a.fga; }],
    ['ftr', 'Free-throw rate', 'Scoring', 'p', 0, 60, FGA, function (a) { return rate(a.fta, a.fga, 100); }, function (a) { return a.fga; }],
    ['rimfreq', 'Rim share of shots', 'Shot zones', 'p', 0, 28, FGA, function (a) { return rate(a.ra_a, a.fga, 100); }, function (a) { return a.fga; }],
    ['rimfg', 'FG% at the rim', 'Shot zones', 'p', 0, 84, 'rim attempts', function (a) { return rate(a.ra_m, a.ra_a, 100); }, function (a) { return a.ra_a; }],
    ['pntfreq', 'Paint share of shots', 'Shot zones', 'p', 0, 40, FGA, function (a) { return rate(a.pnt_a, a.fga, 100); }, function (a) { return a.fga; }],
    ['pntfg', 'FG% in the paint', 'Shot zones', 'p', 0, 60, 'paint attempts', function (a) { return rate(a.pnt_m, a.pnt_a, 100); }, function (a) { return a.pnt_a; }],
    ['midfreq', 'Mid-range share of shots', 'Shot zones', 'p', 0, 42, FGA, function (a) { return rate(a.mid_a, a.fga, 100); }, function (a) { return a.fga; }],
    ['midfg', 'FG% from mid-range', 'Shot zones', 'p', 0, 89, 'mid-range attempts', function (a) { return rate(a.mid_m, a.mid_a, 100); }, function (a) { return a.mid_a; }],
    ['usg', 'Usage', 'Creation', 'p', 0, 110, POSS, function (a) { return rate(tmPlays(a), tmPlays(a.t), 100); }],
    ['ast75', 'Assists per 75', 'Creation', 1, 0, 190, POSS, per75('ast')],
    ['ast', 'Assist %', 'Creation', 'p', 0, 140, POSS, function (a) { return rate(a.ast, a.t.fgm - a.fgm, 100); }],
    ['tov75', 'Turnovers per 75', 'Creation', 1, 1, 400, POSS, per75('tov')],
    ['reb75', 'Rebounds per 75', 'Rebounding', 1, 0, 220, POSS, function (a) { return rate(a.oreb + a.dreb, a.poss, 75); }],
    ['oreb', 'Offensive rebound %', 'Rebounding', 'p', 0, 270, POSS, function (a) { return rate(a.oreb, a.t.oreb + a.o.dreb, 100); }],
    ['dreb', 'Defensive rebound %', 'Rebounding', 'p', 0, 320, POSS, function (a) { return rate(a.dreb, a.t.dreb + a.o.oreb, 100); }],
    ['stl', 'Steals per 75', 'Defense and fouls', 1, 0, 750, POSS, per75('stl')],
    ['blk', 'Blocks per 75', 'Defense and fouls', 1, 0, 340, POSS, per75('blk')],
    ['pf75', 'Fouls per 75', 'Defense and fouls', 1, 1, 420, POSS, per75('pf')],
    ['net', 'Net rating', 'His team on the floor', 's', 0, 'net', POSS, function (a) { var o = rate(a.t.pts, a.t.poss, 100), d = rate(a.o.pts, a.o.poss, 100); return o == null || d == null ? null : o - d; }],
    ['ortg', 'Offensive rating', 'His team on the floor', 1, 0, 'ortg', POSS, function (a) { return rate(a.t.pts, a.t.poss, 100); }],
    ['drtg', 'Defensive rating', 'His team on the floor', 1, 1, 'drtg', POSS, function (a) { return rate(a.o.pts, a.o.poss, 100); }],
    ['pace', 'Pace', 'His team on the floor', 1, 0, 'pace', POSS, function (a) { return a.sec > 0 ? (a.t.poss + a.o.poss) / 2 * 2880 / a.sec : null; }],
    ['t_efg', 'Team eFG%', 'His team on the floor', 'p', 0, 't_efg', POSS, function (a) { return efg(a.t); }],
    ['t_tov', 'Team turnover %', 'His team on the floor', 'p', 1, 't_tov', POSS, function (a) { return tovp(a.t); }],
    ['t_oreb', 'Team offensive rebound %', 'His team on the floor', 'p', 0, 't_oreb', POSS, function (a) { return rate(a.t.oreb, a.t.oreb + a.o.dreb, 100); }],
    ['t_ftr', 'Team free-throw rate', 'His team on the floor', 'p', 0, 't_ftr', POSS, function (a) { return ftr(a.t); }],
    ['o_efg', 'Opponent eFG%', 'His team on the floor', 'p', 1, 'o_efg', POSS, function (a) { return efg(a.o); }],
    ['o_tov', 'Opponent turnover %', 'His team on the floor', 'p', 0, 'o_tov', POSS, function (a) { return tovp(a.o); }],
    ['o_oreb', 'Opponent offensive rebound %', 'His team on the floor', 'p', 1, 'o_oreb', POSS, function (a) { return rate(a.o.oreb, a.o.oreb + a.t.dreb, 100); }],
    ['o_ftr', 'Opponent free-throw rate', 'His team on the floor', 'p', 1, 'o_ftr', POSS, function (a) { return ftr(a.o); }],
  ];

  // Everything on the card that was measured some other way than who was on the floor.
  var NOT_SPLITTABLE = [
    ['Tracking', 'drives, touches, potential assists, passes, shot quality by defender and dribble, rim protection, speed and distance'],
    ['Synergy', 'play types and shot-making by play type'],
    ['Hustle', 'deflections, contests, box-outs, screen assists, charges and loose balls'],
  ];

  function blank(doc) {
    var o = { sec: 0, games: 0, poss: 0, t: {}, o: {} };
    doc.box.forEach(function (k) { o[k] = 0; });
    doc.on.forEach(function (k) { o.t[k] = 0; o.o[k] = 0; });
    return o;
  }
  function add(a, doc, sec, b, t, o) {
    a.sec += sec;
    doc.box.forEach(function (k, i) { a[k] += b[i]; });
    doc.on.forEach(function (k, i) { a.t[k] += t[i]; a.o[k] += o[i]; });
  }
  function finish(a) { a.poss = (a.t.poss + a.o.poss) / 2; return a; }

  function ixOf(doc, id) {
    for (var i = 0; i < doc.players.length; i++) if (String(doc.players[i][0]) === String(id)) return i;
    return -1;
  }

  function teammates(doc, pid) {
    var me = ixOf(doc, pid), sec = {}, total = {};
    doc.units.forEach(function (u) {
      u[0].forEach(function (i) { total[i] = (total[i] || 0) + u[1]; });
      if (u[0].indexOf(me) < 0) return;
      u[0].forEach(function (i) { if (i !== me) sec[i] = (sec[i] || 0) + u[1]; });
    });
    return Object.keys(sec).map(function (i) {
      return { id: doc.players[i][0], name: doc.players[i][1], with_sec: sec[i], sec: total[i] };
    }).sort(function (a, b) { return b.with_sec - a.with_sec; });
  }

  function split(doc, pid, ids, mode) {
    var me = ixOf(doc, pid);
    if (me < 0) return null;
    var want = (ids || []).map(function (id) { return ixOf(doc, id); }).filter(function (i) { return i >= 0 && i !== me; });
    var w = blank(doc), wo = blank(doc);
    if (mode === 'games') {
      doc.games.forEach(function (g) {
        var mine = null, any = false;
        g[2].forEach(function (r) {
          if (r[0] === me) mine = r;
          if (want.indexOf(r[0]) >= 0 && r[1] > 0) any = true;
        });
        if (!mine || mine[1] <= 0) return;
        var a = any ? w : wo;
        a.games++;
        add(a, doc, mine[1], mine[2], mine[3], mine[4]);
      });
    } else {
      doc.units.forEach(function (u) {
        var at = u[0].indexOf(me);
        if (at < 0) return;
        var any = u[0].some(function (i) { return want.indexOf(i) >= 0; });
        add(any ? w : wo, doc, u[1], u[4][at], u[2], u[3]);
      });
      doc.games.forEach(function (g) {
        var mine = g[2].filter(function (r) { return r[0] === me && r[1] > 0; })[0];
        if (mine) w.games++;
      });
      wo.games = 0;
    }
    finish(w); finish(wo);
    var rows = STATS.map(function (s) {
      var size = s[8] || function (a) { return a.poss; };
      var under = typeof s[5] === 'number' ? s[5] : on(s[5]);
      var x = s[7](w), y = s[7](wo), nx = size(w), ny = size(wo);
      return {
        key: s[0], label: s[1], group: s[2], fmt: s[3], lower: !!s[4], unit: s[6], settles_at: under,
        with: x, without: y, diff: x == null || y == null ? null : y - x,
        with_n: Math.round(nx), without_n: Math.round(ny), with_low: nx < under, without_low: ny < under,
      };
    });
    function side(a) {
      return { minutes: Math.round(a.sec / 6) / 10, possessions: Math.round(a.poss), games: a.games, sec: a.sec, totals: doc.box.reduce(function (o, k) { o[k] = a[k]; return o; }, {}) };
    }
    return { mode: mode, with: side(w), without: side(wo), rows: rows, not_splittable: NOT_SPLITTABLE };
  }

  // what a value looks like on the card
  function fmt(v, f) {
    if (v == null) return '—';
    if (f === 'p') return v.toFixed(1) + '%';
    if (f === 's') return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
    return v.toFixed(1);
  }

  var api = { teammates: teammates, split: split, fmt: fmt, STATS: STATS.map(function (s) { return s[0]; }), NOT_SPLITTABLE: NOT_SPLITTABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SavantWW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
