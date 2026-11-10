"""Who plays for a Power 4 conference title: the published tiebreakers, implemented (BUILD decision 5).

    python -m pipeline.cfb.tiebreak            # the unit tests: the rulebooks' own worked examples

The rulebooks are quoted in research/cfb/tiebreakers/TIEBREAKERS.md, section by section; this
module follows that file, and every reading that is not in the published text is marked READING
here and listed there under "could not confirm".

All four leagues send the two teams with the best conference winning percentage. They differ in
how a tie is broken:

  step                               ACC   Big Ten   Big 12   SEC
  head-to-head                        x       x        x       x
  record vs common opponents                  x        x       x
  common opponents, standings order           x        x       x
  opponents' conference win %                 x        x       x
  total wins                                           x
  an outside number                   x       x        x       x (formula published)
  a draw                              x       x        x       x

The outside number is SportSource Analytics' and is not published (the SEC's is a published
formula over scores). Our power rating stands in for it, and a draw is settled by the power
rating too; any seat decided that way is flagged `outside`, because the real one could differ.

A race is a set of teams 0..n-1 and a matrix `res`: res[i][j] is +1 if i beat j in a conference
game, -1 if i lost, 0 if they have not played.
"""
import numpy as np

STEPS = {
    "ACC": ["h2h", "rating", "draw"],
    "Big Ten": ["h2h", "common", "common_order", "opp_pct", "rating", "draw"],
    "Big 12": ["h2h", "common", "common_order", "opp_pct", "total_wins", "rating", "draw"],
    "SEC": ["h2h", "common", "common_order", "opp_pct", "margin", "draw"],
}
LOST_TO_ALL = {"ACC", "SEC"}          # "the team which lost to each of the others is removed": only these two say it
STEP_NAME = {"h2h": "head-to-head", "common": "record against common opponents",
             "common_order": "record against common opponents in standings order",
             "opp_pct": "opponents' conference winning percentage", "total_wins": "total wins",
             "rating": "our power rating, standing in for SportSource's unpublished ranking",
             "margin": "capped relative scoring margin", "draw": "a draw (shown here by our power rating)"}
OUTSIDE = {"rating", "draw"}
EPS = 1e-9


class Race:
    def __init__(self, conf, res, rating, total_wins=None, margin=None, final=False):
        self.conf = conf
        self.res = np.asarray(res, dtype=np.int8)
        self.n = len(self.res)
        self.rating = np.asarray(rating, dtype=float)
        self.total_wins = total_wins
        self.margin = margin
        self.final = final
        self.w = (self.res > 0).sum(1)
        self.l = (self.res < 0).sum(1)
        self.gp = self.w + self.l
        self.pct = self.w / np.maximum(self.gp, 1)
        self.used = []                 # (step, teams it was applied to, teams it picked)

    # ------------------------------------------------------------ the metrics
    def _wp(self, t, opps):
        r = self.res[t, opps]
        g = int((r != 0).sum())
        return (float((r > 0).sum()) / g) if g else None

    def _h2h(self, T):
        sub = self.res[np.ix_(T, T)]
        full = bool((sub[~np.eye(len(T), dtype=bool)] != 0).all())
        return sub, full

    def _common(self, T):
        played = (self.res[T] != 0).all(axis=0)
        played[T] = False
        return np.where(played)[0]

    def _groups(self):
        """The standings as groups of teams level on conference percentage, best first."""
        order = np.argsort(-self.pct, kind="stable")
        out, cur = [], [int(order[0])]
        for t in order[1:]:
            if abs(self.pct[t] - self.pct[cur[0]]) < EPS:
                cur.append(int(t))
            else:
                out.append(cur)
                cur = [int(t)]
        out.append(cur)
        return out

    def _values(self, step, T):
        """Each tied team's number at a step (higher is better), or None when the step cannot separate them."""
        if step == "common":
            co = self._common(T)
            if not len(co):
                return None
            return [self._wp(t, co) for t in T]
        if step == "common_order":
            co = set(self._common(T).tolist())
            for grp in self._groups():
                g = [t for t in grp if t in co]
                if not g:
                    continue
                for part in self._split(g):
                    v = [self._wp(t, part) for t in T]
                    if max(v) - min(v) > EPS:
                        return v
            return None
        if step == "opp_pct":
            v = []
            for t in T:
                opp = np.where(self.res[t] != 0)[0]
                if not len(opp):
                    return None
                if self.conf == "SEC":      # "the average ... of the winning percentage of all 8 of their Conference opponents"
                    v.append(float(self.pct[opp].mean()))
                else:                       # "combined win percentage": pooled wins over pooled games (READING; equal when balanced)
                    v.append(float(self.w[opp].sum() / max(self.gp[opp].sum(), 1)))
            return v
        if step == "total_wins":
            return None if self.total_wins is None else [float(self.total_wins[t]) for t in T]
        if step == "margin":
            return [float(self.rating[t]) for t in T] if self.margin is None else [float(self.margin[t]) for t in T]
        return [float(self.rating[t]) for t in T]          # rating, draw

    def _split(self, g):
        """A group of common opponents level in the standings, as the league compares against it.

        Big 12: the group as one. SEC: ordered by head-to-head when that orders them completely,
        otherwise combined. Big Ten: silent, so the group as one (READING).
        """
        if self.conf != "SEC" or len(g) == 1:
            return [g]
        sub, full = self._h2h(g)
        if full:
            wins = (sub > 0).sum(1)
            if len(set(wins.tolist())) == len(g):
                return [[g[i]] for i in np.argsort(-wins)]
        return [g]

    # ------------------------------------------------------------ the procedure
    def choose(self, T, spots):
        """`spots` teams out of the tied set T, best first."""
        T = list(T)
        if len(T) <= spots:
            return self.two(T) if len(T) == 2 else T
        if len(T) == 2:
            return self.two(T)[:1]
        for step in STEPS[self.conf]:
            if step == "h2h":
                sub, full = self._h2h(T)
                if not full:
                    beat_all = [T[i] for i in range(len(T)) if (np.delete(sub[i], i) > 0).all()]
                    if beat_all:
                        self.used.append((step, T, beat_all))
                        rest = [t for t in T if t != beat_all[0]]
                        return beat_all + (self.choose(rest, spots - 1) if spots > 1 else [])
                    lost_all = [T[i] for i in range(len(T)) if (np.delete(sub[i], i) < 0).all()]
                    if lost_all and self.conf in LOST_TO_ALL:
                        rest = [t for t in T if t != lost_all[0]]
                        self.used.append((step, T, rest))
                        return self.choose(rest, spots)
                    continue
                g = (sub != 0).sum(1)
                v = [float((sub[i] > 0).sum() / g[i]) for i in range(len(T))]
            else:
                v = self._values(step, T)
            if v is None or max(v) - min(v) <= EPS:
                if step != "draw":
                    continue
                v = [-i for i in range(len(T))]          # cannot happen with distinct ratings; keeps the order stable
            best = max(v)
            lead = [t for t, x in zip(T, v) if best - x <= EPS]
            self.used.append((step, T, lead))
            if len(lead) == 1:
                rest = [t for t in T if t != lead[0]]
                return lead + (self.choose(rest, spots - 1) if spots > 1 else [])
            if len(lead) == 2 and spots == 2:
                return self.two(lead)
            # level at the top with teams below: the leaders start again, the rest are out
            # (the SEC says so; READING for the other three, which name only the clear leader)
            return self.choose(lead, spots)
        return T[:spots]

    def two(self, T):
        """Two teams in order."""
        a, b = T
        if self.res[a, b] != 0:
            self.used.append(("h2h", T, [a if self.res[a, b] > 0 else b]))
            return [a, b] if self.res[a, b] > 0 else [b, a]
        for step in STEPS[self.conf][1:]:
            v = self._values(step, T)
            if v is None or abs(v[0] - v[1]) <= EPS:
                continue
            self.used.append((step, T, [a if v[0] > v[1] else b]))
            return [a, b] if v[0] > v[1] else [b, a]
        return [a, b]

    def _level(self, pool, lead):
        """Teams level with `lead` at the top of `pool`. The ACC adds teams with a different number of
        conference games and the same wins or the same losses, once the schedule is complete."""
        g = [t for t in pool if abs(self.pct[t] - self.pct[lead]) < EPS]
        if self.conf == "ACC" and self.final:
            g += [t for t in pool if t not in g and self.gp[t] != self.gp[lead]
                  and (self.w[t] == self.w[lead] or self.l[t] == self.l[lead])]
        return g

    def top_two(self, eligible=None):
        """(first, second, how). `how[team]` is None when his seat needed no tiebreaker, else
        {"step", "outside", "with"} for the step that settled it."""
        pool = [t for t in range(self.n) if eligible is None or eligible[t]]
        order = sorted(pool, key=lambda t: -self.pct[t])
        g1 = self._level(pool, order[0])
        mark = len(self.used)
        how = {}

        def why(team, tied, start):
            steps = [u for u in self.used[start:] if team in u[1]]
            last = steps[-1][0] if steps else "h2h"
            return {"step": last, "name": STEP_NAME[last], "outside": any(u[0] in OUTSIDE for u in steps),
                    "with": [t for t in tied if t != team]}

        if len(g1) == 1:
            first = g1[0]
            how[first] = None
            rest = [t for t in pool if t != first]
            g2 = self._level(rest, max(rest, key=lambda t: self.pct[t]))
            if len(g2) == 1:
                second = g2[0]
                how[second] = None
            else:
                second = self.choose(g2, 1)[0]
                how[second] = why(second, g2, mark)
        elif len(g1) == 2:
            first, second = self.two(g1)           # both are in; the procedure only orders them
            how[first] = how[second] = None
        else:
            first, second = self.choose(g1, 2)[:2]
            how[first], how[second] = why(first, g1, mark), why(second, g1, mark)
        return first, second, how


def sec_margin(members, games, all_games):
    """The SEC's capped relative scoring margin (its Appendix A), from scores.

    games: (team, opponent, points for, points against) for every conference game, both directions.
    all_games: the same for every game of the season (an opponent's season averages; READING: the
    appendix says "per game for the season" and does not say conference games only).
    """
    pf, pa, n = {}, {}, {}
    for t, o, f, a in all_games:
        pf[t] = pf.get(t, 0.0) + f
        pa[t] = pa.get(t, 0.0) + a
        n[t] = n.get(t, 0) + 1
    out = {}
    for t, o, f, a in games:
        if not n.get(o):
            continue
        allowed, scored = pa[o] / n[o], pf[o] / n[o]
        off = min(200.0, 100.0 * f / allowed) if allowed > 0 else 200.0
        dfn = 100.0 * a / scored if scored > 0 else 0.0
        out.setdefault(t, []).append(off - dfn)
    return np.array([float(np.mean(out[m])) if m in out else 0.0 for m in members])


# ---------------------------------------------------------------- tests: the rulebooks' own examples
def _res(n, wins):
    r = np.zeros((n, n), dtype=np.int8)
    for a, b in wins:
        r[a, b], r[b, a] = 1, -1
    return r


def tests():
    R = np.arange(20, 0, -1.0)
    # SEC 5.7: three tied for first, A lost to B and C, B and C did not play -> A out, B and C both in
    r = _res(6, [(1, 0), (2, 0), (0, 3), (0, 4), (3, 1), (1, 4), (2, 3), (4, 2)])
    x = Race("SEC", r, R)
    assert set(x.choose([0, 1, 2], 2)) == {1, 2}
    # the Big Ten and Big 12 have no "lost to all" rule: the same tie goes on to common opponents instead
    x = Race("Big Ten", r, R)
    x.choose([0, 1, 2], 2)
    assert x.used and x.used[0][0] != "h2h", x.used
    # SEC 5.7: four tied, records against the one common opponent 1-0, 1-0, 1-0, 0-1 -> the 0-1 team is out
    r = _res(6, [(0, 4), (1, 4), (2, 4), (4, 3), (0, 5), (1, 5), (2, 5), (3, 5)])
    x = Race("SEC", r, R)
    v = x._values("common", [0, 1, 2, 3])
    assert v == [1.0, 1.0, 1.0, 0.5] or v[3] < v[0]
    # SEC 5.7: 2-0, 1-1, 1-1, 0-2 against common opponents -> the 2-0 team is in and the other three start again
    r = _res(6, [(0, 4), (0, 5), (1, 4), (5, 1), (2, 4), (5, 2), (4, 3), (5, 3)])
    x = Race("SEC", r, R)
    got = x.choose([0, 1, 2, 3], 2)
    assert got[0] == 0 and got[1] in (1, 2), got
    # two tied for first are both in, and head-to-head orders them
    r = _res(4, [(1, 0), (0, 2), (0, 3), (1, 2), (3, 1), (2, 3)])
    f, s, how = Race("Big 12", r, R).top_two()
    assert (f, s) == (1, 0) and how[f] is None and how[s] is None
    # ACC: head-to-head, then straight to the ranking (flagged as outside)
    r = _res(5, [(0, 3), (0, 4), (1, 3), (1, 4), (2, 3), (2, 4), (0, 1), (0, 2)])       # 0: 4-0; 1 and 2 level for second, did not play
    x = Race("ACC", r, np.array([5.0, 1.0, 9.0, 0.0, 0.0]))
    f, s, how = x.top_two()
    assert f == 0 and s == 2 and how[s]["outside"] and how[s]["step"] == "rating", (f, s, how)
    # ACC: a team that beat each of the others goes in; one that lost to each is removed
    # three level for first, 0 beat 1 and 2, 2 lost to 0 and 1 -> 0 goes in, then 1 over 2 head-to-head
    r = _res(7, [(0, 1), (0, 2), (1, 2), (3, 0), (4, 1), (2, 5), (2, 6), (1, 5), (0, 6), (5, 6), (2, 3), (4, 5)])
    x = Race("ACC", r, R)       # 0: 3-1, 1: 2-2 ... keep it simple: check the three-team head-to-head directly
    assert x.choose([0, 1, 2], 2) == [0, 1]
    # Big 12 step e: total wins
    x = Race("Big 12", _res(4, [(0, 2), (1, 2), (0, 3), (1, 3)]), np.array([1.0, 2.0, 0, 0]), total_wins=[10, 9, 5, 5])
    f, s, how = x.top_two()
    assert (f, s) == (0, 1) and x.used[-1][0] == "total_wins", x.used
    # SEC Appendix A's worked example: 31-28 against a team averaging 24 scored and 21 allowed -> +30.9
    m = sec_margin(["A"], [("A", "B", 31, 28)], [("B", "x", 24, 21)])
    assert abs(m[0] - (31 / 21 * 100 - 28 / 24 * 100)) < 1e-9 and abs(m[0] - 30.95) < 0.1
    m = sec_margin(["A"], [("A", "B", 50, 0)], [("B", "x", 24, 21)])
    assert m[0] == 200.0
    print("tiebreak: all tests pass")


if __name__ == "__main__":
    tests()
