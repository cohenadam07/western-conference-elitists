/* Savant value — the number the All-Savant Team is picked on.
   Points a player has added to his team this season above a replacement-level player at his
   position (guard, wing, big), on the stats that are his own and the possessions he played.

   The numbers are learned by tools/savant-value/value.py and live in savant-value.json;
   this file only applies them. One implementation for the page and the AI connector
   (scripts/lib/savant-value.mjs imports it), and tools/savant-value/check.mjs requires it to
   match value.py on every season. Change the math in both places or neither.

   Usage: SavantValue.season(players, model, posOf) -> Map(id -> {rate, value, parts, repl})
          SavantValue.team(players, results, model, posOf, n) -> [[...5 rows], ...]       */
(function (root) {
  'use strict';
  var POSITIONS = ['Guard', 'Wing', 'Big'];
  var SETTLE_SRC = ['ts', 'usg', 'ast', 'tov75', 'oreb', 'dreb', 'stl', 'blk', 'tp3r', 'ftr'];

  function cell(p, k) { var m = p.m && p.m[k]; return (m && m.season) || null; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function rowOf(p, pos) {
    var r = { id: p.id, p: p, pos: pos, q: !!p.qualified }, c;
    c = cell(p, 'pts');
    r.poss = (c && c.n) || 0;
    r.pts100 = c && num(c.v) != null ? c.v * 100 / 75 : null;
    SETTLE_SRC.forEach(function (k) {
      var c2 = cell(p, k);
      r[k] = c2 ? num(c2.v) : null;
      r[k + '_n'] = (c2 && c2.n) || 0;
    });
    c = cell(p, 'onoffadj');
    r.onoff = c ? num(c.v) : null;
    r.min = (c && c.n) || 0;
    c = cell(p, 'minshare');
    r.minshare = c ? num(c.v) : null;
    if (!r.min && c && c.n) r.min = c.n;
    return r;
  }

  function wmean(rows, vk, wf) {
    var s = 0, d = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][vk], w = wf(rows[i]);
      if (v == null || !w) continue;
      s += v * w; d += w;
    }
    return d ? s / d : null;
  }

  function onoffW(r) {
    var on = r.min, ms = r.minshare;
    if (!on || !ms || r.onoff == null) return 0;
    var teamMin = on / (ms / 100), off = Math.max(teamMin - on, 1);
    return 1 / (1 / on + 1 / off);
  }

  function features(rows, settle) {
    var lgTs = wmean(rows, 'ts', function (r) { return r.ts_n; });
    if (!lgTs) lgTs = 0.55;
    POSITIONS.forEach(function (pos) {
      var grp = rows.filter(function (r) { return r.pos === pos; });
      if (!grp.length) return;
      var mu = {};
      SETTLE_SRC.forEach(function (k) { mu[k] = wmean(grp, k, function (r) { return r[k + '_n']; }); });
      grp.forEach(function (r) {
        var sh = {};
        SETTLE_SRC.forEach(function (k) {
          var v = r[k], n = r[k + '_n'], m = mu[k], kk = settle[k];
          if (m == null) sh[k] = null;
          else if (v == null || !n) sh[k] = m;
          else sh[k] = (n * v + kk * m) / (n + kk);
        });
        r._sh = sh;
        r._sce = (r.pts100 != null && r.ts && sh.ts != null)
          ? 2 * (r.pts100 / (2 * r.ts)) * (sh.ts - lgTs) : null;
      });
      var sceMu = wmean(grp, '_sce', function (r) { return r.poss; }) || 0;
      grp.forEach(function (r) {
        var sh = r._sh, x = {};
        x.sceff = r._sce != null ? r._sce - sceMu : 0;
        ['usg', 'ast', 'oreb', 'dreb', 'tp3r', 'ftr'].forEach(function (k) {
          x[k] = (sh[k] != null && mu[k] != null) ? sh[k] - mu[k] : 0;
        });
        [['tov', 'tov75'], ['stl', 'stl'], ['blk', 'blk']].forEach(function (kk) {
          var src = kk[1];
          x[kk[0]] = (sh[src] != null && mu[src] != null) ? (sh[src] - mu[src]) * 100 / 75 : 0;
        });
        r.x = x;
      });
      var msMu = wmean(grp, 'minshare', function (r) { return r.min; }) || 0;
      var ooMu = wmean(grp, 'onoff', onoffW);
      grp.forEach(function (r) {
        r.msDm = r.minshare != null ? r.minshare - msMu : 0;
        r.ooDm = (r.onoff != null && ooMu != null) ? r.onoff - ooMu : null;
      });
    });
  }

  /* Linear-interpolated percentile of an ascending array (value.py pctile). */
  function pctile(a, p) {
    if (a.length === 1) return a[0];
    var h = (a.length - 1) * p / 100, lo = Math.floor(h), hi = Math.min(lo + 1, a.length - 1);
    return a[lo] + (h - lo) * (a[hi] - a[lo]);
  }

  function season(players, model, posOf) {
    posOf = posOf || function (p) { return p.pos; };
    var rows = (players || []).map(function (p) { return rowOf(p, posOf(p)); });
    features(rows, model.settle);
    var B = model.beta, C = model.credit, K = model.K, g = model.gamma, sc = model.scale;
    var out = new Map();
    rows.forEach(function (r) {
      if (!r.x) return;
      var full = 0, mine = 0, parts = {};
      model.parts.forEach(function (pt) {
        var s = 0;
        pt.feats.forEach(function (f) { s += B[f] * C[f] * r.x[f]; full += B[f] * r.x[f]; });
        parts[pt.key] = s; mine += s;
      });
      var floor = 0;
      if (r.ooDm != null && K != null) {
        var w = onoffW(r);
        floor = w / (w + K) * (r.ooDm - (full + g * r.msDm));
      }
      Object.keys(parts).forEach(function (k) { parts[k] *= sc; });
      parts.floor = sc * floor;
      r.rate = sc * (mine + floor);
      r.parts = parts;
    });
    POSITIONS.forEach(function (pos) {
      var q = rows.filter(function (r) { return r.pos === pos && r.q && r.rate != null; })
        .map(function (r) { return r.rate; }).sort(function (a, b) { return a - b; });
      var repl = q.length ? pctile(q, model.repl_pct) : 0;
      rows.forEach(function (r) {
        if (r.pos !== pos || r.rate == null) return;
        out.set(r.id, { id: r.id, pos: pos, q: r.q, rate: r.rate, repl: repl, poss: r.poss,
          value: (r.rate - repl) * r.poss / 100, parts: r.parts });
      });
    });
    return out;
  }

  /* The All-Savant teams: 2 guards, 2 wings, 1 big each, best value first, qualified only.
     A player goes on one team only. */
  function team(players, results, model, posOf, n) {
    posOf = posOf || function (p) { return p.pos; };
    var shape = model.shape || [['Guard', 2], ['Wing', 2], ['Big', 1]];
    var ranked = {};
    POSITIONS.forEach(function (pos) {
      ranked[pos] = (players || []).filter(function (p) {
        var v = results.get(p.id);
        return v && v.q && v.pos === pos;
      }).sort(function (a, b) { return results.get(b.id).value - results.get(a.id).value; });
    });
    var used = new Set(), teams = [];
    for (var t = 0; t < (n || 2); t++) {
      var five = [];
      shape.forEach(function (sl) {
        var k = 0, list = ranked[sl[0]] || [];
        for (var i = 0; i < list.length && k < sl[1]; i++) {
          if (used.has(list[i].id)) continue;
          used.add(list[i].id); k++;
          five.push({ p: list[i], pos: sl[0], v: results.get(list[i].id) });
        }
      });
      teams.push(five);
    }
    return teams;
  }

  root.SavantValue = { season: season, team: team, pctile: pctile, POSITIONS: POSITIONS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
