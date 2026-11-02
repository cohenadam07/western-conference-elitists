"""
ratings.py — team ratings, ours and the market's. §6A and §6B, step 7's checks.

OURS follows T-Rank's published method, computed entirely from our own game tables:
    adjO_t = Σ w OE_g × (lgDE / adjD_opp) / Σ w,   adjD_t likewise, iterated to a fixed point
    recency  full weight for 40 days, then -1% a day, floor 60% from day 80
    home     OE and DE moved ±HOME (1.4% in the method; `tune` tests it)
    blowout  a game's net past BLOWOUT per 100 counts half beyond it, so one 50-point win over a
             bad team cannot buy a rating
    prior    last season's rating, pulled to average by returning minutes, worth PRIOR_GAMES games
             at the start and fading to nothing by game 13

Possessions in a game are the box-score estimate (FGA - OREB + TOV + 0.475 FTA) averaged over both
teams: it exists for every game, including those whose play-by-play failed its gate.

Non-Division I games are not rated. Rate a team on games against rated teams.

THE MARKET (§6B) is a ridge regression of the closing home margin on team indicators and a home
term. ESPN pickcenter for 2022-23 and 2025-26 on, CBBD /lines for the two seasons ESPN has none.

THE CHECK is walk-forward: for each game day from Dec 1, ratings use only earlier games and
predict that day. Mean absolute error of the margin, against BPI's own pre-game margin and the
closing spread, on the same games. It must be within 0.5 points of BPI or better.

    python3 ratings.py check 2025-26 2024-25
    python3 ratings.py build 2022-23 2023-24 2024-25 2025-26 2026-27
"""
import datetime as dt
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import lines as LN  # noqa: E402
import season as SZ  # noqa: E402

OUT = os.path.join(CC.HOME, "ratings")
HOME = 0.014
BLOWOUT = 30.0
PRIOR_GAMES = 8.0
FADE_GAMES = 13.0
RET_BASE, RET_SLOPE = 0.35, 0.55     # how much of last year carries: returning minutes share 0 -> .35, 1 -> .90


def load(season):
    d = os.path.join(SZ.OUT, season)
    return pd.read_pickle(os.path.join(d, "games.pkl")), pd.read_pickle(os.path.join(d, "tg.pkl"))


def game_table(season):
    """One row per D1-vs-D1 game: both teams' points and the shared possession estimate."""
    G, T = load(season)
    T = T.copy()
    T["est"] = T.b_fga - T.b_oreb + T.b_tov + 0.475 * T.b_fta
    h = T[T.home].set_index("gid")
    a = T[~T.home].set_index("gid")
    g = G[(G.non_d1 == 0)].set_index("gid")
    g = g[(g.index.isin(h.index)) & (g.index.isin(a.index))]
    out = pd.DataFrame({"date": g.date, "home": g.home, "away": g.away, "neutral": g.neutral, "hp": h.pts.reindex(g.index), "ap": a.pts.reindex(g.index),
                        "he": h.est.reindex(g.index), "ae": a.est.reindex(g.index), "spread": g.spread, "total": g.total, "stype": g.stype, "ot": g.ot})
    extra = LN.load(season)
    if extra:
        sp = pd.Series({k: v[0] for k, v in extra.items()}, dtype=float)
        out["spread"] = out["spread"].fillna(sp.reindex(out.index))
    out = out[(out.he > 30) & (out.ae > 30) & (out.hp > 0) & (out.ap > 0)]
    out["poss"] = (out.he + out.ae) / 2
    out["minutes"] = 40 + 5 * out.ot
    return out.reset_index().sort_values(["date", "gid"]).reset_index(drop=True)


def recency(days):
    return np.clip(1.0 - np.maximum(days - 40.0, 0.0) * 0.01, 0.6, 1.0)


def fit(gm, asof, prior=None, home=HOME, blowout=BLOWOUT, prior_games=PRIOR_GAMES, recency_on=True):
    """gm: game_table rows before asof. prior: {team: (adjO, adjD, tempo)}. -> DataFrame by team."""
    teams = sorted(set(gm.home) | set(gm.away) | set(prior or ()))
    ix = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    h = gm.home.map(ix).values
    a = gm.away.map(ix).values
    days = (pd.Timestamp(asof) - pd.to_datetime(gm.date)).dt.days.values.astype(float)
    w = recency(days) if recency_on else np.ones(len(gm))
    poss = gm.poss.values
    he, ae = 100 * gm.hp.values / poss, 100 * gm.ap.values / poss
    # blowouts: past the line, half
    net = he - ae
    over = np.maximum(np.abs(net) - blowout, 0.0)
    shrink = np.where(np.abs(net) > 0, 1 - 0.5 * over / np.maximum(np.abs(net), 1e-9), 1.0)
    mid = (he + ae) / 2
    he2, ae2 = mid + (he - mid) * shrink, mid + (ae - mid) * shrink
    hc = np.where(gm.neutral.values, 0.0, home)
    he3, ae3 = he2 / (1 + hc), ae2 * (1 + hc)     # as if on a neutral floor
    lg = float(np.mean(np.r_[he3, ae3]))
    O, D = np.full(n, lg), np.full(n, lg)
    gp = np.zeros(n)
    np.add.at(gp, h, 1)
    np.add.at(gp, a, 1)
    po, pd_, pt = np.full(n, lg), np.full(n, lg), np.zeros(n)
    k = np.zeros(n)
    if prior:
        for t, v in prior.items():
            i = ix[t]
            po[i], pd_[i], pt[i] = v
            k[i] = prior_games * max(0.0, (FADE_GAMES - gp[i]) / FADE_GAMES)
    W = np.zeros(n)
    np.add.at(W, h, w)
    np.add.at(W, a, w)
    for _ in range(25):
        no, nd = np.zeros(n), np.zeros(n)
        np.add.at(no, h, w * he3 * lg / D[a])
        np.add.at(no, a, w * ae3 * lg / D[h])
        np.add.at(nd, h, w * ae3 * lg / O[a])
        np.add.at(nd, a, w * he3 * lg / O[h])
        O = (no + k * po) / np.maximum(W + k, 1e-9)
        D = (nd + k * pd_) / np.maximum(W + k, 1e-9)
        sh = lg - np.average(O, weights=np.maximum(W, 1e-9))
        O = O + sh
        D = D + (lg - np.average(D, weights=np.maximum(W, 1e-9)))
    tp = 40 * poss / gm.minutes.values
    lt = float(np.mean(tp))
    T = np.full(n, lt)
    for _ in range(10):
        num = np.zeros(n)
        np.add.at(num, h, w * tp * lt / T[a])
        np.add.at(num, a, w * tp * lt / T[h])
        tk = np.where(pt > 0, k, 0.0)
        T = (num + tk * np.where(pt > 0, pt, lt)) / np.maximum(W + tk, 1e-9)
    return pd.DataFrame({"team": teams, "adjo": O, "adjd": D, "net": O - D, "tempo": T, "gp": gp}).set_index("team"), lg, lt


def predict(r, lg, lt, home, away, neutral, hca=HOME):
    """Home margin for one game from a rating table."""
    if home not in r.index or away not in r.index:
        return None
    H, A = r.loc[home], r.loc[away]
    p = H.tempo * A.tempo / lt
    hc = 0.0 if neutral else hca
    ho = H.adjo * A.adjd / lg * (1 + hc)
    ao = A.adjo * H.adjd / lg * (1 - hc)
    return (ho - ao) * p / 100


def returning_share(prev_pg, cur_pg):
    """Share of a team's last-season minutes held by men who are on it this season."""
    if cur_pg is None or not len(cur_pg):
        return {}
    last = prev_pg.groupby(["team", "eid"])["min"].sum().reset_index()
    here = set(zip(cur_pg.team, cur_pg.eid))
    last["back"] = [(t, e) in here for t, e in zip(last.team, last.eid)]
    g = last.groupby("team")
    return (last[last.back].groupby("team")["min"].sum() / g["min"].sum()).fillna(0.0).to_dict()


def prior_for(season, seasons_built):
    """From last season's final ratings and returning minutes."""
    y = int(season[:4])
    prev = f"{y - 1}-{str(y)[2:]}"
    p = os.path.join(OUT, f"{prev}.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    tb = d["teams"]
    lg, lt = d["lg"], d["lt"]
    ret = {}
    try:
        prev_pg = pd.read_pickle(os.path.join(SZ.OUT, prev, "pg.pkl"))
        cur_pg = pd.read_pickle(os.path.join(SZ.OUT, season, "pg.pkl"))
        ret = returning_share(prev_pg, cur_pg)
    except OSError:
        pass
    out = {}
    for t, v in tb.items():
        c = RET_BASE + RET_SLOPE * ret.get(t, 0.45)
        out[t] = (lg + (v["adjo"] - lg) * c, lg + (v["adjd"] - lg) * c, lt + (v["tempo"] - lt) * 0.7)
    return out


def walk_forward(season, prior, **kw):
    gm = game_table(season)
    start = f"{season[:4]}-12-01"
    days = sorted(d for d in gm.date.unique() if d >= start)
    preds = []
    for d in days:
        past = gm[gm.date < d]
        today = gm[gm.date == d]
        r, lg, lt = fit(past, d, prior, **kw)
        for row in today.itertuples():
            m = predict(r, lg, lt, row.home, row.away, row.neutral, hca=kw.get("home", HOME))
            if m is not None:
                preds.append((row.gid, m, row.hp - row.ap, row.spread, row.date, row.stype))
    return pd.DataFrame(preds, columns=["gid", "pred", "actual", "spread", "date", "stype"])


def build_season(season):
    gm = game_table(season)
    prior = prior_for(season, None)
    asof = str(pd.to_datetime(gm.date).max().date() + dt.timedelta(1)) if len(gm) else f"{season[:4]}-11-01"
    r, lg, lt = fit(gm, asof, prior)
    os.makedirs(OUT, exist_ok=True)
    json.dump({"season": season, "lg": lg, "lt": lt, "asof": asof, "teams": {t: {k: round(float(v), 3) for k, v in row.items()} for t, row in r.to_dict("index").items()}},
              open(os.path.join(OUT, f"{season}.json"), "w"))
    return r, lg, lt


def market(season, lam=2.0):
    """§6B. Home margin implied by the spread = r_home - r_away + home term. Ridge, closed form."""
    gm = game_table(season)
    m = gm[gm.spread.notna()]
    if len(m) < 300:
        return None
    teams = sorted(set(m.home) | set(m.away))
    ix = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    A = np.zeros((len(m), n + 1))
    A[np.arange(len(m)), m.home.map(ix).values] = 1
    A[np.arange(len(m)), m.away.map(ix).values] = -1
    A[:, n] = (~m.neutral.values).astype(float)
    y = -m.spread.astype(float).values
    R = lam * np.eye(n + 1)
    R[n, n] = 1e-6
    b = np.linalg.solve(A.T @ A + R, A.T @ y)
    r = b[:n] - b[:n].mean()
    return {"home": round(float(b[n]), 2), "games": len(m), "teams": {t: round(float(v), 2) for t, v in zip(teams, r)}}


def report(pr, bpi):
    p = pr.copy()
    p["bpi"] = p.gid.map(lambda g: (bpi.get(g) or {}).get("home_mov"))
    both = p[p.bpi.notna() & p.spread.notna()]
    on = p[p.bpi.notna()]
    return dict(games=len(p), with_bpi=len(on), ours_mae=round(float(abs(on.pred - on.actual).mean()), 3), bpi_mae=round(float(abs(on.bpi - on.actual).mean()), 3),
                both=len(both), ours_mae_both=round(float(abs(both.pred - both.actual).mean()), 3) if len(both) else None,
                bpi_mae_both=round(float(abs(both.bpi - both.actual).mean()), 3) if len(both) else None,
                spread_mae=round(float(abs(-both.spread - both.actual).mean()), 3) if len(both) else None)


if __name__ == "__main__":
    cmd = sys.argv[1]
    seasons = sys.argv[2:]
    if cmd == "build":
        for s in seasons:
            r, lg, lt = build_season(s)
            mk = market(s)
            if mk:
                json.dump(mk, open(os.path.join(OUT, f"market-{s}.json"), "w"))
            print(s, len(r), "lg", round(lg, 2), "tempo", round(lt, 1), "market home", (mk or {}).get("home"), "games", (mk or {}).get("games"), list(r.sort_values("net", ascending=False).head(2).index))
    elif cmd == "check":
        for s in seasons:
            prior = prior_for(s, None)
            bpi = json.load(open(os.path.join(CC.HOME, "bpi", f"games-{s}.json")))
            pr = walk_forward(s, prior)
            print(s, "prior" if prior else "no prior", report(pr, bpi), flush=True)
