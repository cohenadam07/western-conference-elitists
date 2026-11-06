"""
expect.py — what a coach was given: the roster model, AP context and the market (spec §4 A, step 4).

    python3 expect.py            -> <CBCS_OUT>/expect.json (per team-season) and expect-fit.json

The roster model, built before the season from last season only:
  returning   last season's Savant rate (points per 100 over his own possessions, College Savant's
              `vparts.rate`), shrunk to his group's mean by possessions/(possessions + K), carried
              forward by a fitted line with a class-year step; his expected role comes from last season's
              minutes ÷ (40 × his team's games) by a fitted line (with his rate and a sophomore step), so
              availability counts and this coach's minutes do not.
  transfers   the same from the old school, plus a level-jump term (the new school's last net minus the
              old school's, per 10 points) fitted on 2021-on portal moves only (the spec's window).
  freshmen    CBBD's national recruit rank (2007 on; −ln rank, top 300), mapped to a first-year rate and role by a fitted line;
              unrated freshmen get the unrated mean.
  JUCO, intl  fitted group means.
The expected roles fill five places: if they add to more than five, the weakest expected players give
minutes up first; if to less, the uncovered share is its own fitted term. Expected net = a + b × (Σ role × rate) ÷ 5. Expected wins are
summed game by game over the schedule actually played: P(win) = Φ((exp net − opponent's net) × 0.69
+ home edge) ÷ σ), σ and the home edge measured on the season's own games; games against non-D1 teams
take the measured D1 win rate against them.

Every line here is fitted leave-one-season-out: a season's expectation never sees that season.

The test that decides the headline (spec §4 A.6): out-of-sample RMSE of team net rating, against
(1) last season's net for the same team, fitted the same way, on every team-season both cover, and
(2) the preseason AP rank, on ranked teams only. expect-fit.json records both, and `headline` is
true only if both are beaten.

Market: wins above the closing spread (Σ won − P(win | spread), the curve fitted on every D1 game with
a line) and points against the spread, where a line exists: ESPN's archived line for most seasons,
College Savant's cached CBBD lines for 2023-24 and 2024-25.
"""
import gzip
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import games as GM  # noqa: E402
import rosters as RS  # noqa: E402

OUT = RS.OUT
PUBLIC = RS.PUBLIC
K_SHRINK = 300.0
POSS_PER_PT = 0.69          # league possessions per game ÷ 100, about 69 a game across these seasons
GROUPS = ("returning", "transfer", "hs", "juco", "intl")


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def team_nets():
    out = {}
    for f in sorted(os.listdir(os.path.join(PUBLIC, "cbb", "teams"))):
        s = f[:7]
        d = json.loads(gzip.open(os.path.join(PUBLIC, "cbb", "teams", f)).read())
        out[s] = {t["id"]: t for t in d["teams"]}
    return out


def ols(X, y):
    X = np.column_stack([np.ones(len(X))] + [np.asarray(c, float) for c in X.T]) if X.ndim == 2 else np.column_stack([np.ones(len(X)), X])
    b, *_ = np.linalg.lstsq(X, np.asarray(y, float), rcond=None)
    return b


def prev_season(s):
    y = RS.year_of(s)
    return RS.season_label(y - 1)


def player_rows(R):
    idx = {}
    for s, teams in R["seasons"].items():
        for t, rows in teams.items():
            for r in rows:
                idx[(s, r["eid"])] = (t, r)
    return idx


class Model:
    """The player-level lines, fitted on the training seasons."""

    def __init__(self, R, nets, train, log=print):
        idx = player_rows(R)
        self.idx = idx
        self.nets = nets
        grp_rate = defaultdict(list)
        pairs = defaultdict(list)          # group -> [(prior rate shrunk, class step, level, new rate, weight)]
        fr = []                            # (rating or None, rate, role)
        new_role = defaultdict(list)
        rolep = defaultdict(list)          # group -> [(prior role, prior rate, sophomore, new role)]
        for s in train:
            for t, rows in R["seasons"].get(s, {}).items():
                for r in rows:
                    if r["rate"] is None or not r["poss"]:
                        continue
                    grp_rate[r["src"]].append((r["rate"], r["poss"]))
                    if r["src"] in ("returning", "transfer"):
                        p = self.prior(s, r)
                        if p is None:
                            continue
                        lvl = self.level(s, t, r) if r["src"] == "transfer" else 0.0
                        if r["src"] == "transfer" and RS.year_of(s) < 2022:
                            lvl = None             # the level-jump term is fitted on 2021-on moves only
                        pairs[r["src"]].append((p[0], 1.0 if r["cls"] in ("Jr", "Sr", "Gr") else 0.0, lvl, r["rate"], min(r["poss"], p[2])))
                        rolep[r["src"]].append((p[1], p[0], 1.0 if r["cls"] in ("So",) else 0.0, r["role"] or 0.0))
                    elif r["src"] == "hs":
                        fr.append((self.rx(r), r["rate"], r["role"] or 0.0, r["poss"]))
                    if r["src"] in ("hs", "juco", "intl"):
                        new_role[r["src"]].append(r["role"] or 0.0)
        self.mean = {g: float(np.average([a for a, _ in v], weights=[w for _, w in v])) for g, v in grp_rate.items() if v}
        self.fit = {}
        for g in ("returning", "transfer"):
            v = [x for x in pairs[g] if x[2] is not None] if g == "transfer" else pairs[g]
            X = np.array([[x[0], x[1]] + ([x[2]] if g == "transfer" else []) for x in v])
            y = np.array([x[3] for x in v])
            w = np.sqrt(np.array([x[4] for x in v], float))
            b = ols(X * w[:, None], y * w) if False else self._wls(X, y, w)
            self.fit[g] = [float(c) for c in b]
        for g in ("returning", "transfer"):
            v = rolep[g]
            self.fit[g + "_role"] = [float(c) for c in ols(np.array([[x[0], x[1], x[2]] for x in v]), np.array([x[3] for x in v]))]
        rated = [x for x in fr if x[0] is not None]
        self.fit["hs_rate"] = [float(c) for c in self._wls(np.array([[x[0]] for x in rated]), np.array([x[1] for x in rated]), np.sqrt([x[3] for x in rated]))]
        self.fit["hs_role"] = [float(c) for c in ols(np.array([[x[0]] for x in rated]), np.array([x[2] for x in rated]))]
        un = [x for x in fr if x[0] is None]
        self.mean["hs_unrated"] = float(np.average([x[1] for x in un], weights=[x[3] for x in un])) if un else self.mean.get("hs", 0.0)
        self.role = {g: float(np.mean(v)) for g, v in new_role.items()}
        self.role["hs_unrated"] = float(np.mean([x[2] for x in un])) if un else self.role.get("hs", 0.1)
        self.n = {g: len(v) for g, v in pairs.items()}
        self.n["hs_rated"] = len(rated)

    @staticmethod
    def rx(r):
        """A freshman's recruiting input: −ln(national rank) for the top 300, which bends where
        the composite rating is flat (a 5-star and a high 4-star differ by .02 in rating)."""
        rk = r.get("rrank")
        return -math.log(rk) if rk and rk <= 300 else None

    @staticmethod
    def _wls(X, y, w):
        A = np.column_stack([np.ones(len(X)), X]) * w[:, None]
        b, *_ = np.linalg.lstsq(A, y * w, rcond=None)
        return b

    def prior(self, s, r):
        """(shrunk prior rate, prior role, prior possessions) from his last season, or None."""
        ps = r.get("prev_season") or prev_season(s)
        hit = self.idx.get((ps, r["eid"]))
        if not hit:
            return None
        _, p = hit
        if p["rate"] is None or not p["poss"]:
            return None
        m = self.mean.get(p["src"], 0.0) if hasattr(self, "mean") else 0.0
        sh = p["poss"] / (p["poss"] + K_SHRINK)
        return (sh * p["rate"] + (1 - sh) * m, p["role"] or 0.0, p["poss"])

    def level(self, s, t, r):
        ps = r.get("prev_season") or prev_season(s)
        a = self.nets.get(ps, {}).get(t, {}).get("net")
        b = self.nets.get(ps, {}).get(r.get("prev"), {}).get("net")
        return (a - b) / 10.0 if a is not None and b is not None else 0.0

    def player(self, s, t, r):
        """(expected rate, expected role, how)."""
        g = r["src"]
        if g in ("returning", "transfer"):
            p = self.prior(s, r)
            if p is not None:
                f = self.fit[g]
                cls = 1.0 if r["cls"] in ("Jr", "Sr", "Gr") else 0.0
                rate = f[0] + f[1] * p[0] + f[2] * cls + (f[3] * self.level(s, t, r) if g == "transfer" else 0.0)
                q = self.fit[g + "_role"]
                role = min(1.0, max(0.0, q[0] + q[1] * p[1] + q[2] * p[0] + q[3] * (1.0 if r["cls"] == "So" else 0.0)))
                return rate, role, g
            return self.mean.get("hs_unrated", 0.0), self.role.get("hs_unrated", 0.1), g + "_noprior"
        if g == "hs":
            x = self.rx(r)
            if x is not None:
                a, b = self.fit["hs_rate"]
                c, d = self.fit["hs_role"]
                return a + b * x, max(0.0, c + d * x), "hs"
            return self.mean["hs_unrated"], self.role["hs_unrated"], "hs_unrated"
        return self.mean.get(g, 0.0), self.role.get(g, 0.1), g


def team_score(model, s, t, rows):
    """The team's features: Σ role × rate ÷ 5 by arrival group, the uncovered share of the five places,
    and the level the returning and transferring men earned their rates at (each man's old team's
    net, role-weighted): College Savant's rates are not fully schedule-adjusted, and this term took
    the team R² from .62 to .74 (diagnosis, Nov 6 2026)."""
    parts = []
    for r in rows:
        rate, role, how = model.player(s, t, r)
        parts.append((rate, role, how, r))
    # more expected minutes than the five places hold: the weakest expected players give them up first
    over = sum(p[1] for p in parts) - 5.0
    if over > 0:
        trimmed = []
        for rate, role, how, r in sorted(parts, key=lambda p: p[0]):
            cut = min(role, over)
            over -= cut
            trimmed.append((rate, role - cut, how, r))
        parts = trimmed
    k = 1.0
    covered = min(5.0, sum(p[1] for p in parts))
    grp = {"returning": 0.0, "transfer": 0.0, "hs": 0.0, "other": 0.0}
    ctx = 0.0
    ps = prev_season(s)
    for rate, role, how, r in parts:
        g = r["src"] if r["src"] in grp else "other"
        grp[g] += rate * role * k / 5.0
        if r["src"] in ("returning", "transfer"):
            n = model.nets.get(r.get("prev_season") or ps, {}).get(r.get("prev") or t, {}).get("net")
            ctx += (n or 0.0) * role * k / 5.0
    E = sum(grp.values())
    feats = [grp["returning"], grp["transfer"], grp["hs"], grp["other"], (5.0 - covered) / 5.0, ctx]
    return E, covered, parts, k, feats


def predict(line, feats):
    return line[0] + sum(c * f for c, f in zip(line[1:], feats))


def fill_and_line(model, R, nets, seasons):
    """The team line on the training seasons: net = a + Σ b_g × group sums + c × uncovered + d × level."""
    X, y = [], []
    for s in seasons:
        for t, rows in R["seasons"].get(s, {}).items():
            n = nets.get(s, {}).get(t, {}).get("net")
            if n is None:
                continue
            X.append(team_score(model, s, t, rows)[4]); y.append(n)
    return [float(c) for c in ols(np.array(X), np.array(y))]


def modelled_seasons(R):
    have = set(R["seasons"])
    return [s for s in sorted(have) if prev_season(s) in have]


def run(log=print):
    R = RS.load()
    nets = team_nets()
    ap = json.load(open(os.path.join(OUT, "ap", "ap.json")))
    seasons = modelled_seasons(R)
    final = [s for s in seasons if s != seasons[-1]]          # the season in progress is not scored
    pred = {}
    models = {}
    for s in seasons:
        train = [x for x in final if x != s]
        m = Model(R, nets, train)
        line = fill_and_line(m, R, nets, train)
        models[s] = (m, line)
        for t, rows in R["seasons"][s].items():
            E, cov, parts, k, feats = team_score(m, s, t, rows)
            pred[(s, t)] = dict(exp_net=predict(line, feats), E=E, covered=cov, feats=[round(f, 3) for f in feats],
                                parts=[[p[3]["eid"], round(p[0], 2), round(p[1] * k, 3), p[2]] for p in parts])
    # ---------------------------------------------------------------- the baselines, out of sample
    res = {"ours": [], "last": [], "ours_ap": [], "ap": []}
    rows_last, rows_ap = [], []
    for s in final:
        ps = prev_season(s)
        for t in R["seasons"][s]:
            n = nets.get(s, {}).get(t, {}).get("net")
            if n is None or (s, t) not in pred:
                continue
            ln = nets.get(ps, {}).get(t, {}).get("net")
            if ln is not None:
                rows_last.append((s, ln, pred[(s, t)]["exp_net"], n))
            pre = (ap.get(s, {}).get(t) or {}).get("pre")
            if pre:
                rows_ap.append((s, math.log(pre), pred[(s, t)]["exp_net"], n))

    def loso(rows):
        err_b, err_o = [], []
        for s in final:
            tr = [r for r in rows if r[0] != s]
            te = [r for r in rows if r[0] == s]
            if not te or len(tr) < 10:
                continue
            b = ols(np.array([[r[1]] for r in tr]), np.array([r[3] for r in tr]))
            for r in te:
                err_b.append(b[0] + b[1] * r[1] - r[3])
                err_o.append(r[2] - r[3])
        rm = lambda e: float(np.sqrt(np.mean(np.square(e)))) if e else None  # noqa: E731
        return dict(n=len(err_b), baseline_rmse=rm(err_b), ours_rmse=rm(err_o))
    t_last = loso(rows_last)
    t_ap = loso(rows_ap)
    headline = bool(t_last["ours_rmse"] and t_last["ours_rmse"] < t_last["baseline_rmse"] and t_ap["ours_rmse"] and t_ap["ours_rmse"] < t_ap["baseline_rmse"])
    log(f"roster model vs last season's net: {t_last}; vs preseason AP: {t_ap}; headline {headline}")
    # ---------------------------------------------------------------- expected wins, market
    out = {}
    have = lambda x: os.path.exists(os.path.join(OUT, "games", f"{x}.json.gz"))  # noqa: E731
    curve = spread_curve([x for x in seasons if have(x)])
    for s in seasons:
        if not have(s):
            continue
        sig, hca, nd_rate = margin_model(s, nets)
        G = GM.load(s)
        lines = extra_lines(s)
        for g in G:
            if g["stype"] != 2 and g["stype"] != 3:
                continue
            for t, o, home in ((g["home"], g["away"], True), (g["away"], g["home"], False)):
                if (s, t) not in pred:
                    continue
                pts = g["hs"] if home else g["as_"]
                opp = g["as_"] if home else g["hs"]
                won = pts > opp
                e = out.setdefault(f"{s}|{t}", dict(season=s, team=t, g=0, w=0, l=0, exp_w=0.0, spread_g=0, w_spread=0.0, ats_w=0, ats_l=0, ats_pts=0.0))
                e["g"] += 1; e["w"] += won; e["l"] += not won
                on = nets.get(s, {}).get(o, {}).get("net")
                edge = 0.0 if g["neutral"] else (hca if home else -hca)
                if o in g["non_d1"] or on is None:
                    p = nd_rate
                else:
                    p = phi(((pred[(s, t)]["exp_net"] - on) * POSS_PER_PT + edge) / sig)
                e["exp_w"] += p
                sp = (g.get("line") or {}).get("spread")
                if sp is None:
                    sp = lines.get(g["gid"])
                if sp is not None:
                    own = sp if home else -sp            # home spread, so the team's own number
                    pw = curve(own)
                    e["spread_g"] += 1
                    e["w_spread"] += won - pw
                    m = pts - opp + own
                    e["ats_pts"] += m
                    if m > 0:
                        e["ats_w"] += 1
                    elif m < 0:
                        e["ats_l"] += 1
    for k, e in out.items():
        s, t = e["season"], e["team"]
        e["sigma"] = None
        p = pred[(s, t)]
        a = ap.get(s, {}).get(t) or {}
        e.update(exp_net=round(p["exp_net"], 2), exp_w=round(e["exp_w"], 2), w_roster=round(e["w"] - e["exp_w"], 2),
                 w_spread=round(e["w_spread"], 2), ats_pts=round(e["ats_pts"] / e["spread_g"], 2) if e["spread_g"] else None,
                 net=nets.get(s, {}).get(t, {}).get("net"), ap_pre=a.get("pre"), ap_peak=a.get("peak"), ap_final=a.get("final"),
                 parts=p["parts"], covered=round(p["covered"], 2))
    m_last = models[final[-1]][0]
    fit = dict(headline=headline, vs_last=t_last, vs_ap=t_ap, seasons=seasons, scored=final, k_shrink=K_SHRINK,
               spread_slope=curve.slope, spread_n=curve.n,
               lines={g: [round(c, 4) for c in v] for g, v in m_last.fit.items()}, means={g: round(v, 3) for g, v in m_last.mean.items()},
               roles={g: round(v, 3) for g, v in m_last.role.items()}, n=m_last.n, team_line=[round(c, 4) for c in models[final[-1]][1]],
               note="Leave-one-season-out: each season's expectation is fitted without it. RMSE in points per 100 possessions of team net.")
    json.dump({"teams": out}, open(os.path.join(OUT, "expect.json"), "w"))
    json.dump(fit, open(os.path.join(OUT, "expect-fit.json"), "w"), indent=1)
    return out, fit


_MARGIN = {}


def margin_model(s, nets):
    """σ of the game margin around (net diff × 0.69 + home edge), the home edge, and the D1 win rate
    against non-D1 opponents, all measured on the season's own games. Cached per season."""
    if s not in _MARGIN:
        _MARGIN[s] = _margin_model(s, nets)
    return _MARGIN[s]


def _margin_model(s, nets):
    G = GM.load(s)
    xs, ys, nd = [], [], [0, 0]
    for g in G:
        h, a = g["home"], g["away"]
        if g["non_d1"]:
            d1 = a if h in g["non_d1"] else h
            won = (g["hs"] > g["as_"]) if d1 == h else (g["as_"] > g["hs"])
            nd[0] += won; nd[1] += 1
            continue
        nh, na = nets.get(s, {}).get(h, {}).get("net"), nets.get(s, {}).get(a, {}).get("net")
        if nh is None or na is None:
            continue
        xs.append(((nh - na) * POSS_PER_PT, 0.0 if g["neutral"] else 1.0)); ys.append(g["hs"] - g["as_"])
    X = np.array(xs); y = np.array(ys)
    hca = float(np.mean(y[X[:, 1] == 1] - X[X[:, 1] == 1, 0])) if len(y) else 3.3
    resid = y - X[:, 0] - hca * X[:, 1]
    return float(np.std(resid)) or 11.0, hca, (nd[0] / nd[1]) if nd[1] else 0.95


def extra_lines(s):
    """College Savant's cached CBBD lines for the seasons ESPN's archive lacks: {gid: home spread}."""
    p = os.path.join(RS.REF, f"lines-{s}.json")
    out = {}
    if os.path.exists(p):
        for gid, v in json.load(open(p)).items():
            sp = v[0] if isinstance(v, list) and v else (v.get("spread") if isinstance(v, dict) else None)
            if sp is not None:
                out[str(gid)] = float(sp)
    return out


def spread_curve(seasons):
    """P(win | own spread), the empirical curve over every D1 game with a line: a logistic in the spread."""
    xs, ys = [], []
    for s in seasons:
        lines = extra_lines(s)
        for g in GM.load(s):
            if g["non_d1"]:
                continue
            sp = (g.get("line") or {}).get("spread")
            if sp is None:
                sp = lines.get(g["gid"])
            if sp is None:
                continue
            xs.append(sp); ys.append(1.0 if g["hs"] > g["as_"] else 0.0)
    x = np.array(xs); y = np.array(ys)
    b = 0.0
    for _ in range(50):                      # Newton on one slope through the origin: P(-s) = 1 - P(s)
        p = 1 / (1 + np.exp(-b * -x))
        g_ = np.sum((y - p) * -x)
        h_ = -np.sum(p * (1 - p) * x * x)
        b -= g_ / h_
    slope = float(b)
    curve = lambda sp: 1 / (1 + math.exp(slope * sp))  # noqa: E731
    curve.slope = slope
    curve.n = len(x)
    return curve


def load():
    return json.load(open(os.path.join(OUT, "expect.json")))["teams"], json.load(open(os.path.join(OUT, "expect-fit.json")))


if __name__ == "__main__":
    run()
