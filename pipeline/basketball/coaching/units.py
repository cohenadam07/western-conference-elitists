"""
units.py — lineups, pairs and With/Without per coach-team-season, from the stints.

    build(season, games, who, impact, lg) -> {(team, coach): {...}}

Observed net ratings come straight from the stint tallies (points and possessions each way
while that five, that pair, or that man was on the floor). Two adjustments, both the ones the
Basketball Savant Lineups tab already makes (teams_engine.py):
  luck    opponents' 3P% and FT% set to the season's league averages, so a unit is not
          punished for the other side making its threes
  sample  the luck-adjusted net pulled toward the team's own luck-adjusted net by k
          possessions (k from out/lineup_k.json, measured from split-season reliability:
          843 for five-man units, 1,221 for pairs)
The projection from parts, Σ impact of the five plus the pairing effects that replicate, is
fitted league-wide in modules.py (fit_parts) and written back onto each unit; here each unit
carries the Σ impact of its five and the archetype pairs it contains, and the opposing fives'
Σ impact weighted by possessions (the quality of the lineups it faced).
"""
import json
import os
from collections import defaultdict
from itertools import combinations

SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
K_DEFAULT = {"5": 843.0, "2": 1221.0}
MIN_LIST = {5: 25.0, 2: 100.0}      # minutes to be listed (teams_engine.LINEUP_MIN)
# stint row: [per, start, end, h5, a5, poss_h, poss_a, pts_h, pts_a, margin, h fg3m, h fg3a, h ftm, h fta, a fg3m, a fg3a, a ftm, a fta,
#             h fga, h fgm, a fga, a fgm, h oreb, a oreb, h dreb, a dreb, h tov, a tov]


def load_k():
    try:
        return json.load(open(os.path.join(SAVANT, "out", "lineup_k.json")))["k"]
    except Exception:  # noqa
        return dict(K_DEFAULT)


class Acc:
    __slots__ = ("sec", "poss", "oposs", "pts", "opts", "o3m", "o3a", "oftm", "ofta", "fga", "fgm", "ofga", "ofgm", "oreb", "ooreb", "dreb", "odreb", "tov", "otov", "oppq", "games")

    def __init__(self):
        for k in self.__slots__:
            setattr(self, k, 0.0)
        self.games = set()

    def add(self, dur, own, opp, gid, oppq=0.0):
        self.sec += dur
        self.poss += own["poss"]; self.oposs += opp["poss"]; self.pts += own["pts"]; self.opts += opp["pts"]
        self.o3m += opp["fg3m"]; self.o3a += opp["fg3a"]; self.oftm += opp["ftm"]; self.ofta += opp["fta"]
        self.fga += own["fga"]; self.fgm += own["fgm"]; self.ofga += opp["fga"]; self.ofgm += opp["fgm"]
        self.oreb += own["oreb"]; self.ooreb += opp["oreb"]; self.dreb += own["dreb"]; self.odreb += opp["dreb"]
        self.tov += own["tov"]; self.otov += opp["tov"]
        self.oppq += oppq * own["poss"]
        self.games.add(gid)

    def rates(self, lg3, lgft, team_adj, k):
        poss, oposs = self.poss, self.oposs
        if poss <= 0 or oposs <= 0:
            return None
        ortg, drtg = 100 * self.pts / poss, 100 * self.opts / oposs
        net = ortg - drtg
        luck = 3 * (self.o3m - self.o3a * lg3) + (self.oftm - self.ofta * lgft)
        adj = net + 100 * luck / oposs
        est = (poss * adj + k * team_adj) / (poss + k) if k else adj
        return dict(min=round(self.sec / 60, 1), poss=int(poss), gp=len(self.games), ortg=round(ortg, 1), drtg=round(drtg, 1), net=round(net, 1),
                    adj=round(adj, 1), est=round(est, 1), efg=round((self.fgm) / self.fga, 3) if self.fga else None,
                    oefg=round(self.ofgm / self.ofga, 3) if self.ofga else None,
                    orb=round(self.oreb / (self.oreb + self.odreb), 3) if self.oreb + self.odreb else None,
                    tov=round(100 * self.tov / poss, 1), oppq=round(self.oppq / poss, 2) if poss else None)


def _sides(s, home):
    h = dict(poss=s[5], pts=s[7], fg3m=s[10], fg3a=s[11], ftm=s[12], fta=s[13], fga=s[18], fgm=s[19], oreb=s[22], dreb=s[24], tov=s[26])
    a = dict(poss=s[6], pts=s[8], fg3m=s[14], fg3a=s[15], ftm=s[16], fta=s[17], fga=s[20], fgm=s[21], oreb=s[23], dreb=s[25], tov=s[27])
    return (h, a) if home else (a, h)


def build(season, games, who, impact, lg, archetypes=None, kind="RS"):
    """lg: {"fg3": league 3P%, "ft": league FT%} for the luck adjustment. impact: {pid: bpm}."""
    k = load_k()
    k5, k2 = float(k.get("5", K_DEFAULT["5"])), float(k.get("2", K_DEFAULT["2"]))
    stype = (2,) if kind == "RS" else (3, 5)
    archetypes = archetypes or {}
    groups = defaultdict(list)
    for g in games:
        if g.get("stype") not in stype:
            continue
        for team in g["team"]:
            c = who(g, team)
            if c:
                groups[(team, c)].append(g)
    out = {}
    for (team, coach), gs in groups.items():
        five, pairs, on = defaultdict(Acc), defaultdict(Acc), defaultdict(Acc)
        total = Acc()
        for g in gs:
            home = g["team"][team]["home"]
            for s in g["stints"]:
                dur = s[1] - s[2]
                if dur <= 0:
                    continue
                mine, theirs = (s[3], s[4]) if home else (s[4], s[3])
                own, opp = _sides(s, home)
                oppq = sum(impact.get(p, 0.0) or 0.0 for p in theirs)
                key5 = tuple(sorted(mine, key=str))      # ids are ints, or "e<espn id>" for a man the archive lacks
                five[key5].add(dur, own, opp, g["gid"], oppq)
                for a, b in combinations(key5, 2):
                    pairs[(a, b)].add(dur, own, opp, g["gid"], oppq)
                for p in mine:
                    on[p].add(dur, own, opp, g["gid"], oppq)
                total.add(dur, own, opp, g["gid"], oppq)
        tr = total.rates(lg["fg3"], lg["ft"], 0.0, 0.0)
        team_adj = tr["adj"] if tr else 0.0
        u5 = []
        for key, acc in five.items():
            if acc.sec < MIN_LIST[5] * 60:
                continue
            r = acc.rates(lg["fg3"], lg["ft"], team_adj, k5)
            if not r:
                continue
            imps = [impact.get(p) for p in key]
            r.update(ids=list(key), sum_bpm=round(sum(x for x in imps if x is not None), 2) if all(x is not None for x in imps) else None,
                     arch=sorted(a for a in (archetypes.get(p) for p in key) if a))
            u5.append(r)
        u5.sort(key=lambda x: -x["min"])
        u2 = []
        for key, acc in pairs.items():
            if acc.sec < MIN_LIST[2] * 60:
                continue
            r = acc.rates(lg["fg3"], lg["ft"], team_adj, k2)
            if r:
                r.update(ids=list(key))
                u2.append(r)
        u2.sort(key=lambda x: -x["min"])
        onoff = {}
        for p, acc in on.items():
            r_on = acc.rates(lg["fg3"], lg["ft"], team_adj, 0.0)
            if not r_on:
                continue
            off = Acc()
            for kk in ("sec", "poss", "oposs", "pts", "opts", "o3m", "o3a", "oftm", "ofta", "fga", "fgm", "ofga", "ofgm", "oreb", "ooreb", "dreb", "odreb", "tov", "otov", "oppq"):
                setattr(off, kk, getattr(total, kk) - getattr(acc, kk))
            off.games = total.games
            r_off = off.rates(lg["fg3"], lg["ft"], team_adj, 0.0)
            onoff[p] = dict(on=r_on, off=r_off, diff=round(r_on["adj"] - r_off["adj"], 1) if r_off else None)
        # pair matrix over the men with 100+ minutes: seconds together, est net together
        men = sorted((p for p, acc in on.items() if acc.sec >= 100 * 60), key=lambda p: -on[p].sec)
        matrix = []
        for a, b in combinations(men, 2):
            acc = pairs.get(tuple(sorted((a, b), key=str)))
            if acc is None:
                continue
            r = acc.rates(lg["fg3"], lg["ft"], team_adj, k2)
            matrix.append([a, b, round(acc.sec / 60, 1), r["est"] if r else None, r["adj"] if r else None, int(acc.poss)])
        # stagger of the top two and three by minutes
        top = men[:3]
        stagger = {}
        for n in (2, 3):
            if len(top) < n:
                continue
            both = one = none = 0.0
            tt = set(top[:n])
            for g in gs:
                home = g["team"][team]["home"]
                for s in g["stints"]:
                    dur = s[1] - s[2]
                    mine = set(s[3] if home else s[4])
                    c = len(mine & tt)
                    if c == n:
                        both += dur
                    elif c == 0:
                        none += dur
                    else:
                        one += dur
            T = both + one + none or 1.0
            stagger[str(n)] = dict(ids=top[:n], together=round(both / T, 3), apart=round(one / T, 3), none=round(none / T, 3))
        out[(team, coach)] = dict(season=season, team=team, coach=coach, kind=kind, games=len(gs), team_rates=tr, units5=u5, units2=u2,
                                  onoff=onoff, matrix=matrix, men=men, stagger=stagger, k={"5": k5, "2": k2})
    return out


def check_against_nba(season, built, log=print):
    """Unit minutes vs the NBA's LeagueDashLineups as the Lineups tab publishes them
    (public/lineups/<season>.json, 2007-08 on). Returns (units compared, worst five differences)."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "lineups", f"{season}.json")
    if not os.path.exists(p):
        return 0, []
    d = json.load(open(p))
    nba = {}
    for u in d.get("units", {}).get("5", []):
        nba[(u["t"], tuple(sorted(int(x) for x in u["ids"])))] = float(u["min"])
    worst, n = [], 0
    import teams as TM
    for (team, coach), u in built.items():
        ab = TM.nba_abbr(team, int(season[:4]))
        for r in u["units5"][:6]:
            theirs = nba.get((ab, tuple(sorted(x for x in r["ids"] if isinstance(x, int)))))
            if theirs is None:
                continue
            n += 1
            worst.append((round(abs(r["min"] - theirs), 1), team, r["min"], theirs))
    worst.sort(reverse=True)
    return n, worst[:5]
