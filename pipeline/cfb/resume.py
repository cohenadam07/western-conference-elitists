"""Steps 14 and 15. The resume score, the retroactive 12-team fields, and the playoff-odds simulator.

    python -m pipeline.cfb.resume fields      # 2014-2025 fields under the 2026 rules, vs the committee
    python -m pipeline.cfb.resume sim         # 20,000-run simulator from every week of 2016-2025 + calibration

Resume score (RESEARCH section 7): "how likely is it that the team right on the
playoff line would have done at least this well against this schedule?" The
bubble team is the 12th-best team by our power rating. For each game on a
team's schedule the bubble team's win probability comes from the power ratings
and the site; the chance of matching or beating the team's actual win total is
the exact sum over those games (a Poisson-binomial distribution). Lower is
better. Only wins and losses enter: margin never does. Ties break on the power
rating.

The 2026 selection rules, as the CFP's own page gives them (config switches in CFG):
  * automatic bids: the ACC, Big Ten, Big 12 and SEC champions, and the
    highest-ranked team from the American, Conference USA, MAC, Mountain West,
    Pac-12 or Sun Belt (it need not be a champion: `g6_requires_champion`, off);
  * Notre Dame is in if it ranks in the top 12;
  * the best remaining teams fill the field to 12;
  * straight seeding by rank; an automatic qualifier ranked outside the top 12
    goes to the bottom, in order. Seeds 1-4 get byes, 5-8 host.
Applied to past seasons with the conference champions those seasons actually
had. One judgment call: through 2023 the Pac-12 was a power conference, so its
champion gets an automatic bid in those seasons (`pac12_power_through_2023`,
on); from 2024 it sits in the Group of Six list, as the 2026 rules have it.
"""
import sys
import json
import numpy as np
import pandas as pd
from scipy.stats import norm
from .paths import RAW, WORK, OUT, CHARTS
from .rating import fw_of

CFG = {"g6_requires_champion": False, "pac12_power_through_2023": True, "bubble_rank": 12}
P4 = {"ACC", "Big Ten", "Big 12", "SEC"}
G5 = {"American Athletic", "Conference USA", "Mid-American", "Mountain West", "Sun Belt"}
ND = 87
FCS_RATING = -22.0        # an FCS opponent, in points against an average FBS team (hand-set; only feeds the resume)
# conference seasons with NO championship game (hand-entered from the conferences' histories)
NO_CCG = {("American Athletic", 2014), ("Big 12", 2014), ("Big 12", 2015), ("Big 12", 2016), ("Sun Belt", 2014), ("Sun Belt", 2015),
          ("Sun Belt", 2016), ("Sun Belt", 2017), ("Sun Belt", 2020), ("Pac-12", 2024), ("Pac-12", 2025)}
N_SIMS = 20000


def power_confs(y):
    return P4 | ({"Pac-12"} if (y <= 2023 and CFG["pac12_power_through_2023"]) else set())


def g6_confs(y):
    return (G5 | {"Pac-12"}) - power_confs(y)


class Season:
    """Everything about one season the resume and the simulator need."""

    def __init__(self, y):
        self.y = y
        g = pd.read_parquet(WORK / "games.parquet")
        g = g[(g.season == y) & g.final & (g.home_fbs | g.away_fbs) & (g.season_type == 2)].copy()
        g["fw"] = fw_of(g.date)
        cnt = g[g.fbs_game].groupby("fw").size()
        self.champ_fw = int(cnt[cnt >= 5].index.max())
        g = g[g.fw <= self.champ_fw]
        fbs = pd.read_parquet(WORK / "fbs_teams.parquet")
        fbs = fbs[fbs.season == y].reset_index(drop=True)
        self.teams = fbs.team_id.to_numpy()
        self.ix = {t: i for i, t in enumerate(self.teams)}
        self.name = dict(zip(fbs.team_id, fbs.school))
        self.conf = fbs.conference.to_numpy()
        self.div = fbs.division.fillna("").to_numpy()
        T = len(self.teams)
        g["hi"] = g.home.map(self.ix).fillna(-1).astype(int)
        g["ai"] = g.away.map(self.ix).fillna(-1).astype(int)
        g["site"] = np.where(g.neutral_site.fillna(False), 0, 1)
        g["confgame"] = (g.hi >= 0) & (g.ai >= 0) & (g.home_conf == g.away_conf) & ~g.home_conf.fillna("").str.contains("Independent")
        g["hwin"] = g.home_margin > 0
        # which same-conference game of championship weekend is the title game: the one between the two best records
        cw = np.zeros(T)
        cl = np.zeros(T)
        pre = g[g.confgame & (g.fw < self.champ_fw)]
        np.add.at(cw, pre.hi[pre.hwin], 1)
        np.add.at(cw, pre.ai[~pre.hwin], 1)
        np.add.at(cl, pre.hi[~pre.hwin], 1)
        np.add.at(cl, pre.ai[pre.hwin], 1)
        g["ccg"] = False
        self.has_ccg = {}
        for c in sorted(set(self.conf)):
            if "Independent" in c:
                continue
            ok = (c, y) not in NO_CCG
            cand = g[g.confgame & (g.fw == self.champ_fw) & (g.home_conf == c)]
            if ok and len(cand):
                pct = (cw / np.maximum(cw + cl, 1))
                best = (pct[cand.hi.to_numpy()] + pct[cand.ai.to_numpy()]).argmax()
                g.loc[cand.index[best], "ccg"] = True
                self.has_ccg[c] = True
            else:
                self.has_ccg[c] = False
        self.g = g.reset_index(drop=True)
        w = pd.read_parquet(WORK / "ratings_weekly.parquet")
        self.w = w[w.season == y]
        self.fws = sorted(self.g.fw.unique())

    def ratings(self, after_fw):
        """Ratings fitted on games through `after_fw` (the first snapshot whose week is later)."""
        s = self.w[self.w.fw > after_fw]
        s = s[s.fw == s.fw.min()].set_index("team")
        R = s.rating.reindex(self.teams).to_numpy()
        return R, float(s.hfa.iloc[0]), float(s.sigma.iloc[0])

    def champions(self, R):
        """Actual conference champions: the title-game winner, else the best conference record (head-to-head, then rating)."""
        out = {}
        g = self.g
        T = len(self.teams)
        cw, cl = np.zeros(T), np.zeros(T)
        cg = g[g.confgame & ~g.ccg]
        np.add.at(cw, cg.hi[cg.hwin], 1)
        np.add.at(cw, cg.ai[~cg.hwin], 1)
        np.add.at(cl, cg.hi[~cg.hwin], 1)
        np.add.at(cl, cg.ai[cg.hwin], 1)
        for c, has in self.has_ccg.items():
            members = np.where(self.conf == c)[0]
            if has:
                r = g[g.ccg & (g.home_conf == c)].iloc[0]
                out[c] = int(r.hi if r.hwin else r.ai)
                continue
            pct = cw[members] / np.maximum(cw[members] + cl[members], 1)
            top = members[np.isclose(pct, pct.max())]
            if len(top) == 2:
                h = cg[((cg.hi == top[0]) & (cg.ai == top[1])) | ((cg.hi == top[1]) & (cg.ai == top[0]))]
                if len(h):
                    r = h.iloc[-1]
                    out[c] = int(r.hi if r.hwin else r.ai)
                    continue
            out[c] = int(top[np.argmax(R[top])])
        return out

    def team_games(self, games):
        """Long form: one row per FBS team per game: (team index, opponent index or -1, site for the team, won)."""
        a = pd.DataFrame({"t": games.hi, "o": games.ai, "site": games.site, "won": games.hwin, "fw": games.fw, "ccg": games.ccg})
        b = pd.DataFrame({"t": games.ai, "o": games.hi, "site": -games.site, "won": ~games.hwin, "fw": games.fw, "ccg": games.ccg})
        x = pd.concat([a, b], ignore_index=True)
        return x[x.t >= 0]


def bubble_probs(R, hfa, sigma, opp, site):
    B = np.sort(R[~np.isnan(R)])[-CFG["bubble_rank"]]
    Ro = np.where(opp >= 0, R[np.clip(opp, 0, None)], FCS_RATING)
    return norm.cdf((B - Ro + hfa * site) / sigma), B


def pb_ge(p):
    """P(X >= w) for w = 0..n, X a sum of independent Bernoulli(p_i): the exact Poisson-binomial tail."""
    d = np.zeros(len(p) + 1)
    d[0] = 1.0
    for q in p:
        d[1:] = d[1:] * (1 - q) + d[:-1] * q
        d[0] *= (1 - q)
    return d[::-1].cumsum()[::-1]


def resume_table(S, through_fw=None):
    through_fw = S.champ_fw if through_fw is None else through_fw
    R, hfa, sigma = S.ratings(through_fw)
    tg = S.team_games(S.g[S.g.fw <= through_fw])
    p, B = bubble_probs(R, hfa, sigma, tg.o.to_numpy(), tg.site.to_numpy())
    tg = tg.assign(p=p)
    rows = []
    for t, x in tg.groupby("t"):
        w = int(x.won.sum())
        rows.append(dict(ti=t, team=S.teams[t], school=S.name[S.teams[t]], conf=S.conf[t], wins=w, losses=len(x) - w,
                         resume=float(pb_ge(x.p.to_numpy())[w]), exp_wins_bubble=float(x.p.sum()), rating=float(R[t])))
    r = pd.DataFrame(rows).sort_values(["resume", "rating"], ascending=[True, False]).reset_index(drop=True)
    r["rank"] = np.arange(1, len(r) + 1)
    return r, R


def select(order, champs, conf_of, y):
    """order: team indices best to worst. Returns [(seed, team index, how)] for the 12."""
    pos = {t: i for i, t in enumerate(order)}
    aq = {}
    for c in power_confs(y):
        if c in champs:
            aq[champs[c]] = f"{c} champion"
    g6 = [t for t in order if conf_of[t] in g6_confs(y)]
    if CFG["g6_requires_champion"]:
        g6 = [t for t in g6 if champs.get(conf_of[t]) == t]
    if g6:
        aq.setdefault(g6[0], "top Group of Six team")
    field = dict(aq)
    nd = [t for t in order if conf_of[t] == "__ND__"]
    for t in order[:12]:
        if conf_of[t] == "__ND__":
            field.setdefault(t, "Notre Dame, top 12")
    for t in order:
        if len(field) >= 12:
            break
        field.setdefault(t, "at large")
    seeded = sorted(field, key=lambda t: (1 if (t in aq and pos[t] >= 12) else 0, pos[t]))
    return [(i + 1, t, field[t]) for i, t in enumerate(seeded)]


def fields():
    polls = {}
    lines, res, allrows = [], {}, []
    for y in range(2014, 2026):
        S = Season(y)
        r, R = resume_table(S)
        champs = S.champions(R)
        conf_of = {i: ("__ND__" if S.teams[i] == ND and "Independent" in S.conf[i] else S.conf[i]) for i in range(len(S.teams))}
        ours = select(list(r.ti), champs, conf_of, y)
        # the committee's final ranking, put through the same rules
        p = pd.read_parquet(RAW / "cfb_poll_analytics" / f"cfb_poll_analytics_{y}.parquet")
        p = p[(p.poll == "cfp") & (p.season_type == 2)]
        p = p[p.week == p.week.max()].sort_values("rank")
        corder = [S.ix[t] for t in p.team_id.astype(int) if t in S.ix]
        rest = [t for t in r.ti if t not in set(corder)]
        theirs = select(corder + rest, champs, conf_of, y)
        o_set, t_set = {t for _, t, _ in ours}, {t for _, t, _ in theirs}
        rk = dict(zip(r.ti, r["rank"]))
        crk = {t: i + 1 for i, t in enumerate(corder)}
        info = r.set_index("ti")
        res[y] = {"field": [dict(seed=s, school=S.name[S.teams[t]], how=h, record=f"{int(info.wins[t])}-{int(info.losses[t])}",
                                 resume=float(info.resume[t]), power_rating=float(info.rating[t]), committee_rank=crk.get(t))
                            for s, t, h in ours],
                  "committee_field_same_rules": [S.name[S.teams[t]] for _, t, _ in theirs],
                  "in_ours_not_committee": [S.name[S.teams[t]] for t in o_set - t_set],
                  "in_committee_not_ours": [S.name[S.teams[t]] for t in t_set - o_set],
                  "same_teams": len(o_set & t_set), "champions": {c: S.name[S.teams[t]] for c, t in champs.items()},
                  "top4_ours": [S.name[S.teams[t]] for _, t, _ in ours[:4]], "top4_committee": [S.name[S.teams[t]] for t in corder[:4]]}
        for s, t, h in ours:
            allrows.append(dict(season=y, seed=s, team=int(S.teams[t]), school=S.name[S.teams[t]], how=h, wins=int(info.wins[t]),
                                losses=int(info.losses[t]), resume=float(info.resume[t]), rating=float(info.rating[t]),
                                committee_rank=crk.get(t)))
        r.assign(season=y).to_csv(OUT / f"resume_{y}.csv", index=False) if y >= 2024 else None
        lines += [f"### {y}", "", "| seed | team | record | how it got in | resume score | power rating | committee's final rank |", "|---:|---|---|---|---:|---:|---:|"]
        for s, t, h in ours:
            lines.append(f"| {s} | {S.name[S.teams[t]]} | {int(info.wins[t])}-{int(info.losses[t])} | {h} | {info.resume[t]:.3f} | "
                         f"{info.rating[t]:+.1f} | {crk.get(t, 'unranked')} |")
        d1 = ", ".join(f"{S.name[S.teams[t]]} (committee #{crk.get(t, 'NR')}, ours #{rk[t]})" for t in sorted(t_set - o_set, key=lambda t: crk.get(t, 99)))
        d2 = ", ".join(f"{S.name[S.teams[t]]} (ours #{rk[t]}, committee #{crk.get(t, 'NR')})" for t in sorted(o_set - t_set, key=lambda t: rk[t]))
        lines += ["", f"Same 12 as the committee's ranking put through the same rules: {len(o_set & t_set)} of 12. "
                  + (f"In ours, not theirs: {d2}. In theirs, not ours: {d1}." if d1 or d2 else "Identical fields."), ""]
        print(y, "same", len(o_set & t_set), "| ours-not-theirs:", d2, "| theirs-not-ours:", d1, flush=True)
    pd.DataFrame(allrows).to_csv(OUT / "retro_fields.csv", index=False)
    (OUT / "retro_fields.json").write_text(json.dumps(res, indent=1, default=float))
    (OUT / "retro_fields.md").write_text("\n".join(lines) + "\n")
    print("mean overlap", np.mean([v["same_teams"] for v in res.values()]))


# ---------------------------------------------------------------- simulator
def rating_uncertainty():
    """How far a week's rating sits from the season-end rating, by games played (sd, in points)."""
    w = pd.read_parquet(WORK / "ratings_weekly.parquet")
    w = w[w.season.between(2014, 2025)]
    fin = w[w.fw == 99999][["season", "team", "rating"]].rename(columns={"rating": "final"})
    m = w[w.fw != 99999].merge(fin, on=["season", "team"])
    m["g"] = m.games.clip(upper=12).astype(int)
    return m.groupby("g").apply(lambda x: float(np.sqrt(np.mean((x.rating - x.final) ** 2))), include_groups=False).to_dict()


def simulate(S, cut_fw, rng, tau_by_g, n=N_SIMS):
    y = S.y
    T = len(S.teams)
    R, hfa, sigma = S.ratings(cut_fw)
    g = S.g
    known = g[g.fw <= cut_fw]
    fut = g[(g.fw > cut_fw) & ~g.ccg]
    gp = np.bincount(np.concatenate([known.hi[known.hi >= 0], known.ai[known.ai >= 0]]), minlength=T)
    tau = np.array([tau_by_g.get(int(min(k, 12)), 3.0) for k in gp])
    delta = rng.normal(0, 1, (n, T)) * tau
    Rs = R + delta
    wins = np.zeros((n, T), dtype=np.int16)
    cw = np.zeros((n, T), dtype=np.int16)
    cg = np.zeros(T, dtype=np.int16)
    for df, sim in ((known, False), (fut, True)):
        hi, ai = df.hi.to_numpy(), df.ai.to_numpy()
        if sim and len(df):
            Rh = np.where(hi >= 0, Rs[:, np.clip(hi, 0, None)], FCS_RATING)
            Ra = np.where(ai >= 0, Rs[:, np.clip(ai, 0, None)], FCS_RATING)
            hw = (Rh - Ra + hfa * df.site.to_numpy() + rng.normal(0, sigma, (n, len(df)))) > 0
        else:
            hw = np.broadcast_to(df.hwin.to_numpy(), (n, len(df)))
        cf = df.confgame.to_numpy()
        for j in range(len(df)):
            if hi[j] >= 0:
                wins[:, hi[j]] += hw[:, j]
                if cf[j]:
                    cw[:, hi[j]] += hw[:, j]
                    cg[hi[j]] += 1
            if ai[j] >= 0:
                wins[:, ai[j]] += ~hw[:, j]
                if cf[j]:
                    cw[:, ai[j]] += ~hw[:, j]
                    cg[ai[j]] += 1
    # the bubble team's tail table over each team's whole regular season (title game excluded)
    allg = S.team_games(g[~g.ccg])
    p, B = bubble_probs(R, hfa, sigma, allg.o.to_numpy(), allg.site.to_numpy())
    allg = allg.assign(p=p)
    maxg = int(allg.groupby("t").size().max()) + 2
    GE = np.ones((T, maxg + 1))
    for t, x in allg.groupby("t"):
        ge = pb_ge(x.p.to_numpy())
        GE[t, :len(ge)] = ge
        GE[t, len(ge):] = 0.0
    score = GE[np.arange(T)[None, :], wins]
    # conference title games
    pct = cw / np.maximum(cg, 1)[None, :] + rng.random((n, T)) * 1e-3 + 1e-5 * R[None, :]
    champ = {}
    rows = np.arange(n)
    for c, has in S.has_ccg.items():
        mem = np.where(S.conf == c)[0]
        if not len(mem):
            continue
        if not has:
            champ[c] = mem[pct[:, mem].argmax(axis=1)]
            continue
        divs = sorted(set(S.div[mem]) - {""})
        if len(divs) == 2:
            a = mem[S.div[mem] == divs[0]]
            b = mem[S.div[mem] == divs[1]]
            t1 = a[pct[:, a].argmax(axis=1)]
            t2 = b[pct[:, b].argmax(axis=1)]
        else:
            o = np.argsort(-pct[:, mem], axis=1)
            t1, t2 = mem[o[:, 0]], mem[o[:, 1]]
        w1 = (Rs[rows, t1] - Rs[rows, t2] + rng.normal(0, sigma, n)) > 0
        champ[c] = np.where(w1, t1, t2)
        # one more game on both resumes: P'(>= W) = (1 - p) P(>= W) + p P(>= W - 1)
        for me, other, won in ((t1, t2, w1), (t2, t1, ~w1)):
            pb = norm.cdf((B - R[other]) / sigma)
            W = wins[rows, me] + won
            wins[rows, me] = W
            score[rows, me] = (1 - pb) * GE[me, np.minimum(W, maxg)] + pb * GE[me, np.clip(W - 1, 0, maxg)]
    score = score - 1e-9 * R[None, :]                # ties break on the power rating
    order = np.argsort(score, axis=1)
    pos = np.empty_like(order)
    pos[rows[:, None], order] = np.arange(T)[None, :]
    aq = np.zeros((n, T), dtype=bool)
    for c in power_confs(y):
        if c in champ:
            aq[rows, champ[c]] = True
    g6 = np.isin(S.conf, list(g6_confs(y)))
    if g6.any():
        s6 = np.where(g6[None, :], score, np.inf)
        if CFG["g6_requires_champion"]:
            isch = np.zeros((n, T), dtype=bool)
            for c in g6_confs(y):
                if c in champ:
                    isch[rows, champ[c]] = True
            s6 = np.where(isch, s6, np.inf)
        aq[rows, s6.argmin(axis=1)] = True
    adj = np.where(aq, -1.0, score)
    if ND in S.ix and "Independent" in S.conf[S.ix[ND]]:
        k = S.ix[ND]
        adj[:, k] = np.where(pos[:, k] < 12, -1.0, adj[:, k])
    fo = np.argsort(adj, axis=1)[:, :12]
    infield = np.zeros((n, T), dtype=bool)
    infield[rows[:, None], fo] = True
    key = np.where(infield, score + np.where(aq & (pos >= 12), 10.0, 0.0), np.inf)
    seed = np.argsort(np.argsort(key, axis=1), axis=1) + 1
    conf_win = np.zeros(T)
    for c, ch in champ.items():
        conf_win += np.bincount(ch, minlength=T) / n
    return pd.DataFrame({"season": y, "cut_fw": cut_fw, "team": S.teams, "p_field": infield.mean(0), "p_bye": (infield & (seed <= 4)).mean(0),
                         "p_host": (infield & (seed >= 5) & (seed <= 8)).mean(0), "p_conf": conf_win, "games_played": gp})


def sim():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    rng = np.random.default_rng(20261110)
    tau = rating_uncertainty()
    actual = pd.read_csv(OUT / "retro_fields.csv")
    out = []
    for y in range(2016, 2026):
        S = Season(y)
        fws = [f for f in S.fws if f < S.champ_fw]
        first = min(S.w[S.w.fw != 99999].fw)
        for k, cut in enumerate([first - 1] + fws):       # "week 0" = before any game, then after each week
            r = simulate(S, cut, rng, tau)
            r["week_index"] = k
            out.append(r)
        print(y, "weeks simulated", len(fws) + 1, flush=True)
    r = pd.concat(out, ignore_index=True)
    a = actual[["season", "team"]].assign(made=1)
    r = r.merge(a, on=["season", "team"], how="left").fillna({"made": 0})
    r.to_parquet(WORK / "sim_runs.parquet", index=False)
    bins = [-0.001, 0.01, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0]
    r["bin"] = pd.cut(r.p_field, bins)
    c = r.groupby("bin", observed=True).agg(team_weeks=("made", "size"), predicted=("p_field", "mean"), actual=("made", "mean")).reset_index()
    c["gap"] = c.actual - c.predicted
    nz = r[r.p_field >= 0.01]
    res = {"runs": int(r.groupby(["season", "cut_fw"]).ngroups), "sims_per_run": N_SIMS, "rating_uncertainty_by_games_played": tau,
           "brier": float(((r.p_field - r.made) ** 2).mean()), "brier_teams_with_a_chance": float(((nz.p_field - nz.made) ** 2).mean()),
           "weighted_abs_gap": float((c.gap.abs() * c.team_weeks).sum() / c.team_weeks.sum()),
           "max_bin_gap": float(c.gap.abs().max()), "calibration": c.assign(bin=c.bin.astype(str)).round(4).to_dict("records")}
    early = r[r.week_index <= 4]
    late = r[r.week_index >= 9]
    for name, x in (("weeks_0_4", early), ("weeks_9_plus", late)):
        cc = x.groupby("bin", observed=True).agg(n=("made", "size"), predicted=("p_field", "mean"), actual=("made", "mean")).reset_index()
        res[f"calibration_{name}"] = cc.assign(bin=cc.bin.astype(str)).round(4).to_dict("records")
    (OUT / "sim_calibration.json").write_text(json.dumps(res, indent=1, default=float))
    lines = ["| predicted chance of making the field | team-weeks | mean prediction | made our retroactive field | gap |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {x.bin} | {int(x.team_weeks):,} | {x.predicted:.1%} | {x.actual:.1%} | {x.gap:+.1%} |" for _, x in c.iterrows()]
    (OUT / "sim_calibration.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print({k: v for k, v in res.items() if k in ("runs", "brier", "weighted_abs_gap", "max_bin_gap")})
    fig, ax = plt.subplots(figsize=(5.5, 5))
    ax.plot(c.predicted, c.actual, "o-", color="#1f4e9c")
    ax.plot([0, 1], [0, 1], "--", color="#999")
    ax.set(title="Playoff-odds simulator calibration, 2016-2025", xlabel="predicted chance of making the field", ylabel="share that made it")
    fig.tight_layout()
    fig.savefig(CHARTS / "sim_calibration.png", dpi=110)


if __name__ == "__main__":
    {"fields": fields, "sim": sim}[sys.argv[1]]()
