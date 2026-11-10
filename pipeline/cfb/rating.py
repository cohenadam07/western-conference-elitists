"""Step 9. The power rating, walked forward, against the closing spread and ESPN FPI.

    python -m pipeline.cfb.rating tune       # grid over the few tuned constants (tuned on 2016-2020 only)
    python -m pipeline.cfb.rating run        # the chosen constants: weekly ratings 2014-2026 + the backtest report

The rating (RESEARCH section 7), in points per game against an average FBS team:

  offence + defence   A ridge regression on every FBS-vs-FBS team-game of the
                      season so far: efficiency of team i's offence against team
                      j's defence = league + off_i + def_j + home edge. "Efficiency"
                      is a blend of EPA per play and success rate (success rate
                      rescaled to EPA units), garbage time out. Scaled to points
                      with plays per game.
  special teams       the same regression on net special-teams EPA per game.
  preseason prior     last season's offence and defence, team talent and returning
                      production, combined by a regression fitted only on earlier
                      seasons. It is the point the ridge shrinks toward, so it
                      fades by itself as games accumulate.
  recency             older games are down-weighted by exp(-weeks ago / TAU).
  home field          fitted on earlier seasons' predictions.

Nothing about a game is used to predict it: a week's games are predicted from
ratings fitted on games of earlier football weeks (Tuesday to Monday) only, and
every constant that is "learned" (prior weights, points scale, home field) is
re-fitted each season on the seasons before it.
"""
import sys
import json
import itertools
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT, CHARTS
from . import teamgame

FIRST, LAST = 2014, 2026
SCORED = list(range(2016, 2026))       # seasons the backtest is scored on
TUNE = list(range(2016, 2021))         # constants are tuned on these only; 2021-2025 are untouched
PLAYS = 66.0                           # scrimmage plays per team per game, the per-play -> per-game scale
DEFAULT = dict(k=3.0, tau=12.0, alpha=0.5, k_st=6.0, cap=99.0)


def fw_of(date):
    return ((date - pd.Timestamp("2000-01-04", tz="UTC")).dt.days // 7).astype(int)


def inputs():
    t = teamgame.load("cfbd", range(FIRST, LAST + 1))
    t["epa_pp"] = t.epa / t.epa_n.clip(lower=1)
    t["sr"] = t.succ / t.plays.clip(lower=1)
    t["fw"] = fw_of(t.date)
    # success rate in EPA units: slope of game EPA/play on game success rate, measured once on 2014-2015
    b = t[t.season <= 2015]
    kappa = np.polyfit(b.sr, b.epa_pp, 1)[0]
    g = pd.read_parquet(WORK / "games.parquet")
    g = g[g.fbs_game & g.final & g.season.between(FIRST, LAST)].copy()
    g["fw"] = fw_of(g.date)
    g["site"] = np.where(g.neutral_site.fillna(False), 0, 1)
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")
    tal = pd.concat([pd.read_parquet(RAW / "cfb_team_talent" / f"cfb_team_talent_{y}.parquet") for y in range(FIRST, LAST + 1)])
    tal["team_id"] = tal.team_id.astype("int64")
    ret = pd.concat([pd.read_parquet(RAW / "cfb_returning_production" / f"cfb_returning_production_{y}.parquet")
                     for y in range(FIRST, LAST + 1)])
    ret["team_id"] = ret.team_id.astype("int64")
    pre = fbs[fbs.season.between(FIRST, LAST)][["season", "team_id", "school", "conference"]].merge(
        tal[["season", "team_id", "talent_composite"]], on=["season", "team_id"], how="left").merge(
        ret[["season", "team_id", "off_returning", "def_returning"]], on=["season", "team_id"], how="left")
    pre["talent_z"] = pre.groupby("season").talent_composite.transform(lambda s: (s - s.mean()) / s.std()).fillna(-0.5)
    for c in ("off_returning", "def_returning"):
        pre[c] = pre[c] - pre.groupby("season")[c].transform("mean")
        pre[c] = pre[c].fillna(0.0)
    return t, g, pre, float(kappa)


def season_inputs(y):
    """One season's team-games and finished FBS-vs-FBS games, as chain() sees them."""
    t = teamgame.load("cfbd", [y])
    t["epa_pp"] = t.epa / t.epa_n.clip(lower=1)
    t["sr"] = t.succ / t.plays.clip(lower=1)
    t["fw"] = fw_of(t.date)
    g = pd.read_parquet(WORK / "games.parquet")
    g = g[g.fbs_game & g.final & (g.season == y)].copy()
    g["fw"] = fw_of(g.date)
    g["site"] = np.where(g.neutral_site.fillna(False), 0, 1)
    return t, g


def current(st):
    """The season being played, from the frozen prior in pipeline/cfb/state (state.py): (predictions, weekly ratings).
    Equal to chain()'s rows for that season to the last bit; `python -m pipeline.cfb.refresh check` proves it."""
    y = st["season"]
    t, g = season_inputs(y)
    pr, wk, _ = season_ratings(t, g, y, st["teams"], np.array(st["po"]), np.array(st["pdv"]), np.array(st["pst"]), st["beta"],
                               st["hfa"], st["sigma"], st["params"], st["kappa"])
    preds = pd.concat(pr, ignore_index=True) if pr else pd.DataFrame()
    return preds, pd.concat(wk, ignore_index=True)


def fit(tr, teams, po, pdv, pst, cur_fw, P, kappa):
    """Ridge toward the prior. Returns per-play offence and defence effects and per-game special teams."""
    T = len(teams)
    ix = {t: i for i, t in enumerate(teams)}
    o, d, st = po.copy(), pdv.copy(), pst.copy()
    if len(tr) < 4:
        return o, d, st
    ii = np.array([ix[x] for x in tr.team])
    jj = np.array([ix[x] for x in tr.opp])
    rec = np.exp(-(cur_fw - tr.fw.to_numpy()) / P["tau"])
    w = tr.plays.to_numpy(dtype=float) * rec
    y = P["alpha"] * tr.epa_pp.to_numpy() + (1 - P["alpha"]) * kappa * tr.sr.to_numpy()
    y = y - np.average(y, weights=w)
    n = len(tr)
    X = np.zeros((n, 2 * T + 1))
    X[np.arange(n), ii] = 1
    X[np.arange(n), T + jj] = 1
    X[:, 2 * T] = tr.site.to_numpy()
    resid = y - po[ii] - pdv[jj]
    sw = np.sqrt(w)
    A = X * sw[:, None]
    lam = np.full(2 * T + 1, P["k"] * float(np.mean(tr.plays)))
    lam[2 * T] = 1e-6 if n >= 200 else 1e6
    beta = np.linalg.solve(A.T @ A + np.diag(lam), A.T @ (resid * sw))
    o = po + beta[:T]
    d = pdv + beta[T:2 * T]
    # special teams: net ST EPA per game = st_i - st_j (each game appears once per team, antisymmetric)
    Xs = np.zeros((n, T))
    Xs[np.arange(n), ii] = 1
    Xs[np.arange(n), jj] -= 1
    ys = np.clip(tr.st_epa.to_numpy(dtype=float), -12, 12) - (pst[ii] - pst[jj])
    As = Xs * np.sqrt(rec)[:, None]
    bs = np.linalg.solve(As.T @ As + np.eye(T) * P["k_st"] * 2, As.T @ (ys * np.sqrt(rec)))
    st = pst + bs
    return o, d, st


STATE = {}


def season_ratings(t, g, y, teams, po, pdv, pst, beta, hfa, sigma, P, kappa, keep_weekly=True):
    """One season walked forward from its prior: (game predictions, weekly ratings, final effects).
    chain() calls it for every season; a refresh calls it for the current one with the frozen prior."""
    preds, weekly = [], []
    teams = np.asarray(teams)
    S = t[(t.season == y) & t.team.isin(teams) & t.opp.isin(teams)]
    G = g[(g.season == y) & g.home.isin(teams) & g.away.isin(teams)]
    ix = {x: i for i, x in enumerate(teams)}
    for fw in sorted(G.fw.unique()):
        o, d, st = fit(S[S.fw < fw], teams, po, pdv, pst, fw, P, kappa)
        R = PLAYS * (o - d) + st
        gw = G[G.fw == fw]
        hi = np.array([ix[x] for x in gw.home])
        ai = np.array([ix[x] for x in gw.away])
        raw = R[hi] - R[ai]
        site = gw.site.to_numpy()
        pred = beta * raw + hfa * site
        preds.append(pd.DataFrame({"season": y, "game_id": gw.game_id.to_numpy(), "fw": fw, "week": gw.week.to_numpy(),
                                   "season_type": gw.season_type.to_numpy(), "home": gw.home.to_numpy(), "away": gw.away.to_numpy(),
                                   "site": site, "pred": pred, "raw": raw, "margin": gw.home_margin.to_numpy(),
                                   "spread_home": gw.spread_home.to_numpy(), "fpi": gw.fpi_home_margin.to_numpy(),
                                   "sigma": sigma}))
        if keep_weekly:
            gp = S[S.fw < fw].groupby("team").size().reindex(teams).fillna(0).to_numpy()
            weekly.append(pd.DataFrame({"season": y, "fw": fw, "team": teams, "off": PLAYS * o * beta, "def": -PLAYS * d * beta,
                                        "st": st * beta, "rating": R * beta, "games": gp, "beta": beta, "hfa": hfa, "sigma": sigma}))
    o, d, st = fit(S, teams, po, pdv, pst, int(G.fw.max()) + 1 if len(G) else 0, P, kappa)
    if keep_weekly:
        gp = S.groupby("team").size().reindex(teams).fillna(0).to_numpy()
        weekly.append(pd.DataFrame({"season": y, "fw": 99999, "team": teams, "off": PLAYS * o * beta, "def": -PLAYS * d * beta,
                                    "st": st * beta, "rating": (PLAYS * (o - d) + st) * beta, "games": gp, "beta": beta,
                                    "hfa": hfa, "sigma": sigma}))
    return preds, weekly, (o, d, st)


def chain(t, g, pre, kappa, P, keep_weekly=False):
    """Walk every season forward. Returns game predictions (and weekly ratings if asked)."""
    preds, weekly, finals = [], [], {}
    prior_rows = []          # (season, o_prev, d_prev, talent_z, off_ret, def_ret, o_final, d_final, st_prev, st_final)
    pred_hist = []           # (season, raw_diff, site, margin) to fit the points scale and home field
    co = np.array([0.6, 0.0, 0.0])
    cd = np.array([0.6, 0.0, 0.0])
    cst = 0.3
    for y in range(FIRST, LAST + 1):
        pr = pre[pre.season == y]
        teams = pr.team_id.to_numpy()
        T = len(teams)
        prev = finals.get(y - 1)
        if prev is None:
            po, pdv, pst = np.zeros(T), np.zeros(T), np.zeros(T)
            oprev = dprev = np.zeros(T)
        else:
            so, sd_ = np.std(list(prev["o"].values())), np.std(list(prev["d"].values()))
            oprev = np.array([prev["o"].get(x, -so) for x in teams])      # a team new to FBS starts a standard deviation down
            dprev = np.array([prev["d"].get(x, sd_) for x in teams])
            stprev = np.array([prev["st"].get(x, 0.0) for x in teams])
            hist = pd.DataFrame(prior_rows, columns=["season", "o_prev", "d_prev", "tz", "ro", "rd", "o", "d", "st_prev", "st"])
            if len(hist) >= 100:
                Xo = hist[["o_prev", "tz", "ro"]].to_numpy()
                Xd = hist[["d_prev", "tz", "rd"]].to_numpy()
                co = np.linalg.lstsq(Xo, hist.o.to_numpy(), rcond=None)[0]
                cd = np.linalg.lstsq(Xd, hist.d.to_numpy(), rcond=None)[0]
                cst = float(np.linalg.lstsq(hist[["st_prev"]].to_numpy(), hist.st.to_numpy(), rcond=None)[0][0])
            tz, ro, rd = pr.talent_z.to_numpy(), pr.off_returning.to_numpy(), pr.def_returning.to_numpy()
            po = co[0] * oprev + co[1] * tz + co[2] * ro
            pdv = cd[0] * dprev + cd[1] * tz + cd[2] * rd
            pst = cst * stprev
        ph = pd.DataFrame(pred_hist, columns=["season", "raw", "site", "margin"])
        ph = ph[ph.season < y]
        if len(ph) >= 500:
            beta, hfa = np.linalg.lstsq(ph[["raw", "site"]].to_numpy(), ph.margin.to_numpy(), rcond=None)[0]
            sigma = float(np.std(ph.margin - beta * ph.raw - hfa * ph.site))
        else:
            beta, hfa, sigma = 1.0, 2.5, 16.5
        if y == LAST:           # what a refresh of the current season needs instead of every season before it
            STATE.update(season=y, teams=[int(x) for x in teams], po=po.tolist(), pdv=pdv.tolist(), pst=pst.tolist(),
                         beta=float(beta), hfa=float(hfa), sigma=float(sigma), kappa=float(kappa), params=dict(P))
        pr_, wk_, (o, d, st) = season_ratings(t, g, y, teams, po, pdv, pst, beta, hfa, sigma, P, kappa, keep_weekly)
        preds += pr_
        weekly += wk_
        for b, c, dd in zip(*[np.concatenate([x[k].to_numpy() for x in pr_]) if pr_ else np.array([]) for k in ("raw", "site", "margin")]):
            pred_hist.append((y, b, c, dd))
        finals[y] = {"o": dict(zip(teams, o)), "d": dict(zip(teams, d)), "st": dict(zip(teams, st))}
        if prev is not None:
            for i, x in enumerate(teams):
                prior_rows.append((y, oprev[i], dprev[i], pr.talent_z.to_numpy()[i], pr.off_returning.to_numpy()[i],
                                   pr.def_returning.to_numpy()[i], o[i], d[i], stprev[i], st[i]))
    out = pd.concat(preds, ignore_index=True)
    return (out, pd.concat(weekly, ignore_index=True), dict(co=co.tolist(), cd=cd.tolist(), cst=cst)) if keep_weekly else out


def mae(p, seasons, col="pred"):
    x = p[p.season.isin(seasons)]
    return float((x[col] - x.margin).abs().mean())


def tune():
    t, g, pre, kappa = inputs()
    rows = []
    grid = dict(k=[1.5, 3.0, 5.0], tau=[6.0, 12.0, 40.0], alpha=[0.3, 0.5, 0.7, 1.0], k_st=[6.0])
    for vals in itertools.product(*grid.values()):
        P = dict(zip(grid.keys(), vals), cap=99.0)
        p = chain(t, g, pre, kappa, P)
        rows.append(dict(P, mae_tune=mae(p, TUNE), mae_holdout=mae(p, range(2021, 2026))))
        print(rows[-1], flush=True)
    r = pd.DataFrame(rows).sort_values("mae_tune")
    r.to_csv(OUT / "rating_tuning.csv", index=False)
    best = r.iloc[0]
    (OUT / "rating_params.json").write_text(json.dumps({k: float(best[k]) for k in ("k", "tau", "alpha", "k_st")} | {"cap": 99.0, "kappa": kappa}, indent=1))
    print(r.head(8).to_string(index=False))


def run():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t, g, pre, kappa = inputs()
    pf = OUT / "rating_params.json"
    P = {k: v for k, v in json.loads(pf.read_text()).items() if k != "kappa"} if pf.exists() else DEFAULT
    p, weekly, pm = chain(t, g, pre, kappa, P, keep_weekly=True)
    p.to_parquet(WORK / "rating_preds.parquet", index=False)
    weekly.to_parquet(WORK / "ratings_weekly.parquet", index=False)
    (WORK / "rating_state.json").write_text(json.dumps(STATE))
    s = p[p.season.isin(SCORED)].copy()
    s["e_ours"] = (s.pred - s.margin).abs()
    s["e_spread"] = (-s.spread_home - s.margin).abs()
    s["e_fpi"] = (s.fpi - s.margin).abs()
    both = s[s.spread_home.notna() & s.fpi.notna()]
    res = {"params": P, "kappa": kappa, "prior_model": pm, "games_scored": int(len(s)), "games_with_spread_and_fpi": int(len(both)),
           "mae_ours_all": float(s.e_ours.mean()), "mae_ours": float(both.e_ours.mean()), "mae_spread": float(both.e_spread.mean()),
           "mae_fpi": float(both.e_fpi.mean()),
           "tune_seasons": {"ours": float(both[both.season.isin(TUNE)].e_ours.mean()), "fpi": float(both[both.season.isin(TUNE)].e_fpi.mean()),
                            "spread": float(both[both.season.isin(TUNE)].e_spread.mean())},
           "untouched_seasons_2021_2025": {"ours": float(both[both.season > 2020].e_ours.mean()), "fpi": float(both[both.season > 2020].e_fpi.mean()),
                                           "spread": float(both[both.season > 2020].e_spread.mean())},
           "winner_right": {"ours": float(((both.pred > 0) == (both.margin > 0)).mean()), "fpi": float(((both.fpi > 0) == (both.margin > 0)).mean()),
                            "spread": float(((-both.spread_home > 0) == (both.margin > 0)).mean())},
           "corr_ours_fpi": float(both.pred.corr(both.fpi)), "corr_ours_spread": float(both.pred.corr(-both.spread_home))}
    res["gap_to_fpi"] = res["mae_ours"] - res["mae_fpi"]
    res["passes_bar"] = bool(res["gap_to_fpi"] <= 0.5)
    by = both.groupby("season")[["e_ours", "e_fpi", "e_spread"]].mean().round(2)
    by["games"] = both.groupby("season").size()
    both = both.assign(part=np.where(both.season_type == 3, "bowls and playoff", np.where(both.week <= 4, "weeks 1-4",
                                                                                         np.where(both.week <= 9, "weeks 5-9", "weeks 10+"))))
    bw = both.groupby("part")[["e_ours", "e_fpi", "e_spread"]].mean().round(2)
    bw["games"] = both.groupby("part").size()
    res["by_season"] = by.reset_index().to_dict("records")
    res["by_part"] = bw.reset_index().to_dict("records")
    (OUT / "rating_backtest.json").write_text(json.dumps(res, indent=1, default=float))
    lines = ["| season | games | WCE power rating | ESPN FPI | closing spread |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {int(y)} | {int(r.games)} | {r.e_ours:.2f} | {r.e_fpi:.2f} | {r.e_spread:.2f} |" for y, r in by.iterrows()]
    lines += [f"| **2016-2025** | {len(both)} | **{res['mae_ours']:.2f}** | **{res['mae_fpi']:.2f}** | **{res['mae_spread']:.2f}** |", "",
              "| part of season | games | WCE | FPI | spread |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {k} | {int(r.games)} | {r.e_ours:.2f} | {r.e_fpi:.2f} | {r.e_spread:.2f} |" for k, r in bw.iterrows()]
    (OUT / "rating_backtest.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({k: v for k, v in res.items() if k not in ("by_season", "by_part")}, indent=1, default=float))
    print("\n".join(lines))
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(by.index, by.e_ours, "o-", label="WCE power rating", color="#1f4e9c")
    ax.plot(by.index, by.e_fpi, "s--", label="ESPN FPI", color="#b3261e")
    ax.plot(by.index, by.e_spread, "^:", label="closing spread", color="#444")
    ax.set(title="Mean absolute error of predicted margin, FBS-vs-FBS games", xlabel="season", ylabel="points")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "rating_backtest.png", dpi=110)


if __name__ == "__main__":
    {"tune": tune, "run": run}[sys.argv[1]]()
