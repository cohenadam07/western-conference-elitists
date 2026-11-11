"""Step 10. The objective playoff field: today's, its odds, and every past season's.

    python -m pipeline.cfb.playoff today       # the season being played: field, leaders, odds
    python -m pipeline.cfb.playoff history     # 2014-2025 under the 2026 rules, with the champions they had
    python -m pipeline.cfb.playoff test        # the rule tests (Group of Six, Notre Dame, seeding, byes)

Ours only: no committee ranking is read here or written anywhere (BUILD decision 5).

The field is `resume.select` (prompt 1's, unchanged): seed by resume score, the four power
champions and the best Group of Six team in, Notre Dame in if top 12, straight seeding, an
automatic qualifier outside the top 12 at the bottom.

What this module adds for a season still being played:
  * the schedule that is left (resume.Season only knew finished games);
  * conference leaders standing in for champions until the title games are played, the Power 4
    by their published tiebreakers (tiebreak.py), every seat that needed one flagged;
  * the simulator with those tiebreakers inside it: in each of 20,000 seasons the two title-game
    teams of each Power 4 league are whoever the rulebook sends.

The simulator's draws are seeded by the season and the last football week played, so the same
results always give the same odds: a refresh and a full build agree to the byte.
"""
import sys
import json
import numpy as np
import pandas as pd
from scipy.stats import norm
from .paths import WORK, OUT
from .rating import fw_of
from . import resume as R
from .resume import CFG, FCS_RATING, ND, N_SIMS, bubble_probs, pb_ge, power_confs, g6_confs, select
from .tiebreak import Race, sec_margin, STEP_NAME

P4 = ["ACC", "Big Ten", "Big 12", "SEC"]
RULES_TEXT = [
    "Twelve teams. The ACC, Big Ten, Big 12 and SEC champions are in, whatever their record or rank.",
    "So is the highest-ranked team from the American, Conference USA, the MAC, the Mountain West, the Pac-12 or the Sun Belt. It does not have to be a champion.",
    "Notre Dame is in if it ranks in the top 12.",
    "The best remaining teams fill the field.",
    "Seeding is straight, by rank. Seeds 1 to 4 get a bye; seeds 5 to 8 host a first-round game. A team that qualified automatically from outside the top 12 goes to the bottom.",
    "Earlier seasons use their own power conferences: the Pac-12 through 2023, the Pac-10 in 2009 and 2010, and the Big East through 2012. Their champions get an automatic bid in those seasons, whatever their record.",
]


def champ_week(y):
    """The football week of the conference title games: the one holding the first Saturday of December."""
    d = pd.Timestamp(f"{y}-12-01", tz="UTC")
    d += pd.Timedelta(days=(5 - d.day_of_week) % 7)
    return int(fw_of(pd.Series([d])).iloc[0])


class Live:
    """The season being played: finished games, the schedule left, ratings as of today."""

    def __init__(self, y, state, games=None, weekly=None, fbs=None):
        self.y = y
        g = pd.read_parquet(WORK / "games.parquet") if games is None else games
        g = g[(g.season == y) & (g.home_fbs | g.away_fbs) & (g.season_type == 2)].copy()
        g["fw"] = fw_of(g.date)
        self.champ_fw = champ_week(y)
        self.title_rows = g[(g.fw == self.champ_fw)]
        g = g[g.fw < self.champ_fw].sort_values(["date", "game_id"]).reset_index(drop=True)
        fbs = (pd.read_parquet(WORK / "fbs_teams.parquet") if fbs is None else fbs)
        fbs = fbs[fbs.season == y].sort_values("team_id").reset_index(drop=True)
        self.teams = fbs.team_id.to_numpy()
        self.ix = {t: i for i, t in enumerate(self.teams)}
        self.name = dict(zip(fbs.team_id, fbs.school))
        self.conf = fbs.conference.to_numpy()
        self.div = fbs.division.fillna("").to_numpy()
        g["hi"] = g.home.map(self.ix).fillna(-1).astype(int)
        g["ai"] = g.away.map(self.ix).fillna(-1).astype(int)
        g["site"] = np.where(g.neutral_site.fillna(False), 0, 1)
        g["confgame"] = (g.hi >= 0) & (g.ai >= 0) & (g.home_conf == g.away_conf) & g.conference_game.fillna(False) \
            & ~g.home_conf.fillna("").str.contains("Independent")
        g["hwin"] = g.home_margin > 0
        g["ccg"] = False
        self.g = g
        self.played = g[g.final]
        self.left = g[~g.final]
        self.last_fw = int(self.played.fw.max()) if len(self.played) else int(g.fw.min()) - 1
        self.done = len(self.left) == 0
        w = pd.read_parquet(WORK / "ratings_weekly.parquet") if weekly is None else weekly
        w = w[(w.season == y) & (w.fw == 99999)].set_index("team")
        self.R = w.rating.reindex(self.teams).to_numpy()
        self.off, self.dfn, self.st = (w[c].reindex(self.teams).to_numpy() for c in ("off", "def", "st"))
        self.hfa, self.sigma = float(w.hfa.iloc[0]), float(w.sigma.iloc[0])
        self.tau = {int(k): float(v) for k, v in state["tau"].items()}
        self.has_ccg = {c: True for c in sorted(set(self.conf)) if "Independent" not in c}
        # a title game ESPN has already filled in (after the regular season): its pairing, and its result once played
        self.known = {}
        for r in self.title_rows.itertuples():
            if r.home in self.ix and r.away in self.ix and r.home_conf == r.away_conf and r.home_conf in self.has_ccg:
                res = None if not r.final else (r.home_margin > 0)
                self.known[r.home_conf] = (self.ix[r.home], self.ix[r.away], res)

    def team_games(self, games):
        a = pd.DataFrame({"t": games.hi, "o": games.ai, "site": games.site, "won": games.hwin, "fw": games.fw, "gid": games.game_id})
        b = pd.DataFrame({"t": games.ai, "o": games.hi, "site": -games.site, "won": ~games.hwin, "fw": games.fw, "gid": games.game_id})
        x = pd.concat([a, b], ignore_index=True)
        return x[x.t >= 0]

    # ---------------------------------------------------------------- standings and leaders
    def conf_frame(self, c):
        """Members of a conference and its games so far, in the members' own index space."""
        mem = np.where(self.conf == c)[0]
        loc = {t: i for i, t in enumerate(mem)}
        res = np.zeros((len(mem), len(mem)), dtype=np.int8)
        cg = self.played[self.played.confgame & (self.played.home_conf == c)]
        for h, a, hw in zip(cg.hi, cg.ai, cg.hwin):
            res[loc[h], loc[a]], res[loc[a], loc[h]] = (1, -1) if hw else (-1, 1)
        return mem, loc, res, cg

    def total_wins(self, mem):
        """Wins in the regular season with at most one over an FCS team counted (the Big 12's step e)."""
        tg = self.team_games(self.played)
        out = []
        for t in mem:
            x = tg[tg.t == t]
            fcs = int((x.won & (x.o < 0)).sum())
            out.append(int(x.won.sum()) - max(0, fcs - 1))
        return out

    def leaders(self):
        """Each conference's two title-game teams if the season ended today, and how each seat was decided."""
        out = {}
        for c in self.has_ccg:
            mem, loc, res, cg = self.conf_frame(c)
            w, l = (res > 0).sum(1), (res < 0).sum(1)
            if c in self.known:
                a, b, r = self.known[c]
                first, second = (a, b) if r in (None, True) else (b, a)
                out[c] = dict(first=int(first), second=int(second), how={}, set=True, champion=None if r is None else int(first))
            elif c in P4:
                margin = None
                if c == "SEC":
                    allg = self.played
                    every = [(h, a, hp, ap) for h, a, hp, ap in zip(allg.hi, allg.ai, allg.home_pts, allg.away_pts)]
                    every = [(h, a, hp, ap) for h, a, hp, ap in every] + [(a, h, ap, hp) for h, a, hp, ap in every]
                    confg = [(h, a, hp, ap) for h, a, hp, ap in zip(cg.hi, cg.ai, cg.home_pts, cg.away_pts)]
                    confg = confg + [(a, h, ap, hp) for h, a, hp, ap in confg]
                    margin = sec_margin(list(mem), confg, every)
                race = Race(c, res, self.R[mem], total_wins=self.total_wins(mem), margin=margin, final=self.done)
                f, s, how = race.top_two()
                out[c] = dict(first=int(mem[f]), second=int(mem[s]), set=False, champion=None,
                              how={int(mem[k]): (None if v is None else dict(step=v["step"], name=v["name"], outside=bool(v["outside"]),
                                                                           tied_with=[int(mem[t]) for t in v["with"]]))
                                   for k, v in how.items()})
            else:
                pct = w / np.maximum(w + l, 1)
                key = pct + 1e-6 * self.R[mem]
                divs = sorted(set(self.div[mem]) - {""})
                if len(divs) == 2:
                    a = [i for i in range(len(mem)) if self.div[mem[i]] == divs[0]]
                    b = [i for i in range(len(mem)) if self.div[mem[i]] == divs[1]]
                    f, s = sorted([max(a, key=lambda i: key[i]), max(b, key=lambda i: key[i])], key=lambda i: -key[i])
                else:
                    f, s = np.argsort(-key)[:2]
                out[c] = dict(first=int(mem[f]), second=int(mem[s]), how={}, set=False, champion=None)
            out[c]["standings"] = [dict(team=int(self.teams[mem[i]]), w=int(w[i]), l=int(l[i])) for i in np.lexsort((-self.R[mem], -(w - l), -w / np.maximum(w + l, 1)))]
        return out

    # ---------------------------------------------------------------- resume table
    def resume(self):
        tg = self.team_games(self.played)
        p, B = bubble_probs(self.R, self.hfa, self.sigma, tg.o.to_numpy(), tg.site.to_numpy())
        tg = tg.assign(p=p)
        rows = []
        for t in range(len(self.teams)):
            x = tg[tg.t == t]
            w = int(x.won.sum())
            rows.append(dict(ti=t, team=int(self.teams[t]), wins=w, losses=len(x) - w,
                             resume=float(pb_ge(x.p.to_numpy())[w]) if len(x) else 1.0,
                             exp_wins=float(x.p.sum()), sos=float(1 - x.p.mean()) if len(x) else np.nan, rating=float(self.R[t])))
        r = pd.DataFrame(rows).sort_values(["resume", "rating", "team"], ascending=[True, False, True]).reset_index(drop=True)
        r["rank"] = np.arange(1, len(r) + 1)
        r["rating_rank"] = r.rating.rank(ascending=False, method="min").astype(int)
        return r, float(B)

    def field(self, r, lead):
        champs = {c: self.ix_of(v["first"]) for c, v in lead.items()}
        conf_of = {i: ("__ND__" if self.teams[i] == ND and "Independent" in self.conf[i] else self.conf[i]) for i in range(len(self.teams))}
        return select(list(r.ti), champs, conf_of, self.y)

    def ix_of(self, i):
        return int(i)

    # ---------------------------------------------------------------- simulator
    def simulate(self, n=N_SIMS):
        y, T = self.y, len(self.teams)
        rng = np.random.default_rng([y, self.last_fw, 20261110])
        Rb, hfa, sigma = self.R, self.hfa, self.sigma
        known, fut = self.played, self.left
        gp = np.bincount(np.concatenate([known.hi[known.hi >= 0], known.ai[known.ai >= 0]]), minlength=T)
        tau = np.array([self.tau.get(int(min(k, 12)), 3.0) for k in gp])
        Rs = Rb + rng.normal(0, 1, (n, T)) * tau
        wins = np.zeros((n, T), dtype=np.int16)
        fcsw = np.zeros((n, T), dtype=np.int16)
        hi, ai = fut.hi.to_numpy(), fut.ai.to_numpy()
        Rh = np.where(hi >= 0, Rs[:, np.clip(hi, 0, None)], FCS_RATING)
        Ra = np.where(ai >= 0, Rs[:, np.clip(ai, 0, None)], FCS_RATING)
        fhw = (Rh - Ra + hfa * fut.site.to_numpy() + rng.normal(0, sigma, (n, len(fut)))) > 0 if len(fut) else np.zeros((n, 0), dtype=bool)
        for df, hw in ((known, np.broadcast_to(known.hwin.to_numpy(), (n, len(known)))), (fut, fhw)):
            h_, a_ = df.hi.to_numpy(), df.ai.to_numpy()
            for j in range(len(df)):
                if h_[j] >= 0:
                    wins[:, h_[j]] += hw[:, j]
                    if a_[j] < 0:
                        fcsw[:, h_[j]] += hw[:, j]
                if a_[j] >= 0:
                    wins[:, a_[j]] += ~hw[:, j]
                    if h_[j] < 0:
                        fcsw[:, a_[j]] += ~hw[:, j]
        # the bubble team's tail table over each team's whole regular season
        allg = self.team_games(self.g)
        p, B = bubble_probs(Rb, hfa, sigma, allg.o.to_numpy(), allg.site.to_numpy())
        allg = allg.assign(p=p)
        maxg = int(allg.groupby("t").size().max()) + 2
        GE = np.ones((T, maxg + 1))
        for t, x in allg.groupby("t"):
            ge = pb_ge(x.p.to_numpy())
            GE[t, :len(ge)] = ge
            GE[t, len(ge):] = 0.0
        score = GE[np.arange(T)[None, :], wins]
        rows = np.arange(n)
        champ, tb_used = {}, {}
        fut_conf = fut.confgame.to_numpy()
        fut_c = fut.home_conf.to_numpy()
        for c in self.has_ccg:
            mem, loc, res0, _ = self.conf_frame(c)
            if not len(mem):
                continue
            if c in self.known:
                a, b, r = self.known[c]
                t1, t2 = np.full(n, a), np.full(n, b)
            else:
                cols = np.where(fut_conf & (fut_c == c))[0]
                la = np.array([loc[x] for x in hi[cols]], dtype=int)
                lb = np.array([loc[x] for x in ai[cols]], dtype=int)
                cw = np.zeros((n, len(mem)), dtype=np.int16) + (res0 > 0).sum(1)[None, :]
                cl = np.zeros((n, len(mem)), dtype=np.int16) + (res0 < 0).sum(1)[None, :]
                for k, j in enumerate(cols):
                    cw[:, la[k]] += fhw[:, j]
                    cl[:, la[k]] += ~fhw[:, j]
                    cw[:, lb[k]] += ~fhw[:, j]
                    cl[:, lb[k]] += fhw[:, j]
                pct = cw / np.maximum(cw + cl, 1)
                if c in P4:
                    o = np.argsort(-pct, axis=1, kind="stable")
                    s = np.take_along_axis(pct, o[:, :3], axis=1)
                    clean = (s[:, 0] - s[:, 1] > 1e-9) & (s[:, 1] - s[:, 2] > 1e-9)
                    f, s2 = o[:, 0].copy(), o[:, 1].copy()
                    tw_all = wins[:, mem] - np.maximum(0, fcsw[:, mem] - 1)
                    need = np.where(~clean)[0]
                    for i in need:
                        res = res0.copy()
                        w_ = fhw[i, cols]
                        res[la, lb] = np.where(w_, 1, -1)
                        res[lb, la] = np.where(w_, -1, 1)
                        f[i], s2[i], _ = Race(c, res, Rb[mem], total_wins=tw_all[i], final=True).top_two()
                    tb_used[c] = float(len(need) / n)
                    t1, t2 = mem[f], mem[s2]
                else:
                    key = pct + rng.random((n, len(mem))) * 1e-3 + 1e-5 * Rb[mem][None, :]
                    divs = sorted(set(self.div[mem]) - {""})
                    if len(divs) == 2:
                        a = np.where(self.div[mem] == divs[0])[0]
                        b = np.where(self.div[mem] == divs[1])[0]
                        t1, t2 = mem[a[key[:, a].argmax(axis=1)]], mem[b[key[:, b].argmax(axis=1)]]
                    else:
                        o = np.argsort(-key, axis=1)
                        t1, t2 = mem[o[:, 0]], mem[o[:, 1]]
                r = None
            if r is None:
                w1 = (Rs[rows, t1] - Rs[rows, t2] + rng.normal(0, sigma, n)) > 0
            else:
                w1 = np.full(n, bool(r))
            champ[c] = np.where(w1, t1, t2)
            for me, other, won in ((t1, t2, w1), (t2, t1, ~w1)):      # one more game on both resumes
                pb = norm.cdf((B - Rb[other]) / sigma)
                W = wins[rows, me] + won
                wins[rows, me] = W
                score[rows, me] = (1 - pb) * GE[me, np.minimum(W, maxg)] + pb * GE[me, np.clip(W - 1, 0, maxg)]
        score = score - 1e-9 * Rb[None, :]
        order = np.argsort(score, axis=1)
        pos = np.empty_like(order)
        pos[rows[:, None], order] = np.arange(T)[None, :]
        aq = np.zeros((n, T), dtype=bool)
        for c in power_confs(y):
            if c in champ:
                aq[rows, champ[c]] = True
        g6 = np.isin(self.conf, list(g6_confs(y)))
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
        if ND in self.ix and "Independent" in self.conf[self.ix[ND]]:
            k = self.ix[ND]
            adj[:, k] = np.where(pos[:, k] < 12, -1.0, adj[:, k])
        fo = np.argsort(adj, axis=1)[:, :12]
        infield = np.zeros((n, T), dtype=bool)
        infield[rows[:, None], fo] = True
        key = np.where(infield, score + np.where(aq & (pos >= 12), 10.0, 0.0), np.inf)
        seed = np.argsort(np.argsort(key, axis=1), axis=1) + 1
        conf_win = np.zeros(T)
        for c, ch in champ.items():
            conf_win += np.bincount(ch, minlength=T) / n
        odds = pd.DataFrame({"team": self.teams, "p_field": infield.mean(0), "p_bye": (infield & (seed <= 4)).mean(0),
                             "p_host": (infield & (seed >= 5) & (seed <= 8)).mean(0), "p_conf": conf_win,
                             "exp_wins": wins.mean(0)})
        return odds, tb_used


def today(state, y=None, n=N_SIMS):
    from . import config as C
    y = y or C.CURRENT
    S = Live(y, state)
    r, B = S.resume()
    lead = S.leaders()
    fld = S.field(r, lead)
    odds, tb = S.simulate(n)
    return S, r, B, lead, fld, odds, tb


def history(y):
    """A finished season's field under the 2026 rules, with the champions it had (resume.fields, ours only)."""
    S = R.Season(y)
    r, Rr = R.resume_table(S)
    champs = S.champions(Rr)
    conf_of = {i: ("__ND__" if S.teams[i] == ND and "Independent" in S.conf[i] else S.conf[i]) for i in range(len(S.teams))}
    fld = select(list(r.ti), champs, conf_of, y)
    return S, r, champs, fld


# ---------------------------------------------------------------- tests of the rules
def test():
    conf = {0: "SEC", 1: "Big Ten", 2: "ACC", 3: "Big 12", 4: "SEC", 5: "Big Ten", 6: "SEC", 7: "Big Ten", 8: "ACC", 9: "Big 12",
            10: "SEC", 11: "Big Ten", 12: "SEC", 13: "Sun Belt", 14: "American Athletic", 15: "__ND__", 16: "Mountain West", 17: "ACC"}
    order = list(range(18))
    champs = {"SEC": 0, "Big Ten": 1, "ACC": 17, "Big 12": 3, "Sun Belt": 13, "American Athletic": 14}
    f = select(order, champs, conf, 2026)
    teams = [t for _, t, _ in f]
    how = {t: h for _, t, h in f}
    assert len(f) == 12 and [s for s, _, _ in f] == list(range(1, 13))
    # the ACC champion ranked 18th is in, and at the bottom; the Group of Six bid goes to the best such team (13th)
    assert teams[-1] == 17 and how[17] == "ACC champion"
    assert 13 in teams and how[13] == "top Group of Six team" and teams[-2] == 13
    assert 14 not in teams                       # a second Group of Six champion gets nothing
    assert 15 not in teams                       # Notre Dame ranked 16th is out
    assert teams[:4] == [0, 1, 2, 3]             # straight seeding: the byes are simply the top four
    assert teams[:10] == list(range(10))         # ten at-large or champion teams by rank, then the two low qualifiers
    # Notre Dame ranked 12th is in, and takes the last at-large place from the 10th-ranked team
    conf2 = dict(conf)
    conf2[11], conf2[15] = "__ND__", "Big Ten"
    f2 = select(order, champs, conf2, 2026)
    assert 11 in [t for _, t, _ in f2] and dict((t, h) for _, t, h in f2)[11] == "Notre Dame, top 12"
    # the Group of Six bid does not need a champion unless the switch is on
    champs3 = dict(champs)
    champs3["Sun Belt"] = 99
    assert 13 in [t for _, t, _ in select(order, champs3, conf, 2026)]
    CFG["g6_requires_champion"] = True
    try:
        t3 = [t for _, t, _ in select(order, champs3, conf, 2026)]
        assert 13 not in t3 and 14 in t3
    finally:
        CFG["g6_requires_champion"] = False
    # the Pac-12 champion: an automatic bid through 2023, a Group of Six team after
    conf4 = dict(conf)
    conf4[16] = "Pac-12"
    champs4 = dict(champs)
    champs4["Pac-12"] = 16
    assert 16 in [t for _, t, _ in select(order, champs4, conf4, 2023)]
    assert 16 not in [t for _, t, _ in select(order, champs4, conf4, 2026)]
    assert champ_week(2025) == 1352 and champ_week(2023) == 1247 and champ_week(2019) == 1039
    print("playoff: all rule tests pass")


def main(argv):
    from .state import load_state
    if argv[0] == "test":
        return test()
    if argv[0] == "history":
        for y in range(2014, 2026):
            S, r, champs, fld = history(y)
            print(y, [f"{s}. {S.name[S.teams[t]]}" for s, t, h in fld])
        return
    S, r, B, lead, fld, odds, tb = today(load_state(), n=int(argv[1]) if len(argv) > 1 else N_SIMS)
    nm = lambda t: S.name[S.teams[t]]
    print("field today:", [f"{s}. {nm(t)} ({h})" for s, t, h in fld])
    for c in P4:
        v = lead[c]
        notes = "; ".join(f"{nm(k)}: {x['name']}" + (" (outside number)" if x["outside"] else "") for k, x in v["how"].items() if x)
        print(f"  {c}: {nm(v['first'])} v {nm(v['second'])}" + (f" | tiebreakers: {notes}" if notes else ""))
    o = odds.assign(school=[S.name[t] for t in odds.team]).sort_values("p_field", ascending=False).head(16)
    print(o[["school", "p_field", "p_bye", "p_host", "p_conf"]].round(3).to_string(index=False))
    print("share of simulated seasons that needed a tiebreaker:", {k: round(v, 3) for k, v in tb.items()})


if __name__ == "__main__":
    main(sys.argv[1:])
