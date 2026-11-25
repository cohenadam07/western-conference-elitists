"""
titles.py — every team's chance of the title, every season since 1979-80, from the luck-adjusted strength the points use.

Strength. A team-season's rating is its luck-adjusted margin per game (luck.py: opponent 3PM and FTM at the league's
percentages), the same number the headline's production uses.

Playoff strength. Tested out of sample by log score (playoff_study, Nov 2026): the luck-adjusted rating, the raw margin,
a mix, each with and without the team's opening-night projection blended in. The raw margin with the preseason blend
won, so in the playoffs a team's strength is its raw margin + w x (projection on the margin scale - raw margin), w
chosen each season on the seasons before it. The regular season (seeding) is still played from the luck-adjusted rating.

Games. Win probability is logistic in the rating difference with a home edge: P(home wins) = 1/(1 + exp(-(a*home +
b*(home rating - visitor rating)))). Two fits: regular-season games and playoff games (the playoff fit is the one the
playoffs use; 2019-20's playoff and play-in games were at one site, home = 0). For season Y each fit uses only seasons
before Y (1979-80 to 1982-83 use the first four seasons' fit, flagged early), so a season's odds read nothing from its
own playoffs: the calibration below is out of sample.

The season, simulated (TITLE_SIMS runs, 10,000 by default). The regular season is replayed game by game on the real
schedule; standings by winning percentage, ties broken at random (the real tiebreakers are not replayed); seeds by that
era's rules; the play-in; a fixed bracket; series of the era's length with the era's home pattern; home court to the
better record. What comes from where:
  read from the games (playoff_data.json): series lengths (first round best-of-3 to 1982-83, best-of-5 to 2001-02, then
      best-of-7; every later round best-of-7), the home pattern of each round (2-2-1-1-1; the Finals 2-3-2 from 1985 to
      2013), teams per conference (6 to 1982-83, then 8), and home court: the better record hosted Game 1 in every series
      whose two records differed, in every era (checked each build).
  from the NBA's rules (SEEDING, each with its source): division winners and the top seeds, byes, the play-in.
Each build checks the seeding rules against what happened: applied to the real standings, they must give the real
first-round matchups (ties allowed either way).

Per team-season: E (its title chance), E0 (the same season replayed with that team at league-average strength, every
other team and every random draw unchanged), and the secant slope (E - E0) / rating: the title curve's slope from
average strength to the team's (derivative where the team is within NEAR of average). These split a team-season's
expected titles above average across its decisions (titles_dec.py). An average-strength team's chance (E0) is below
1/N, because titles go to the best teams; E0 - 1/N is the average team's shortfall, the same for everyone in the seat.

    python3 titles.py            # -> out/title_odds.json, out/title_report.txt
    python3 titles.py leakage    # the projected curves refit with every later season deleted: must match
"""
import collections, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
SIMS = int(os.environ.get('TITLE_SIMS', 10000))
NEAR = 0.5                      # margin points: within this of average, the derivative stands in for the secant
P = json.load(open(os.path.join(OUT, 'playoff_data.json')))
L = json.load(open(os.path.join(OUT, 'luck_margins.json')))
SEASONS = sorted(P)
FIRST_FIT = 4                   # the first fits use the first four seasons (in sample, flagged early)

SEEDING = {
    'div_top2': ('Division winners take the top two seeds; the rest by record.',
                 'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
                 'Prior to 2004, when the NBA was aligned into two conferences with two divisions each, the division '
                 'champions were guaranteed the top two seeds'),
    'div_top3': ('Division winners take the top three seeds; the rest by record.',
                 'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
                 'Each conference was realigned into three divisions with each division winner qualifying for a top-three seed regardless of record.'),
    'div_top4': ('The three division winners and the best other team take the top four seeds, in order of record.',
                 'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
                 'the division winners are now only guaranteed a top-four seed. The team with the second-best record in the conference is now guaranteed the second seed'),
    'record': ('Seeds by record.', 'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
               'The teams with the eight best records in each conference receive playoff berths, with no automatic berths'),
    'byes': ('Twelve teams; the two division winners in each conference have byes; 3 plays 6 and 4 plays 5 (best of three).',
             'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
             'The first round now included the sixth best team in each conference, which was matched against the third seed. Only the division winners received byes to the next round.'),
    'play_in': ('Seeds 7 to 10 play in: 7 v 8 (winner is the 7 seed); 9 v 10; the 7-8 loser v the 9-10 winner for the 8 seed.',
                'https://en.wikipedia.org/w/index.php?title=NBA_playoffs&action=raw',
                'the seventh- and eighth-place teams play each other in a qualification game, with the winner being given the opportunity to play as the seventh seed'),
    'play_in_2020': ('2019-20 (the season finished at one site): if the 9th team is within four games of the 8th, they play '
                     'for the 8 seed, the 8th needing one win and the 9th two.',
                     'https://en.wikipedia.org/w/index.php?title=2020_NBA_playoffs&action=raw', None),
}


def y_of(s):
    return int(s[:4]) + 1


def seeding_rule(y):
    return 'byes' if y <= 1983 else 'div_top2' if y <= 2004 else 'div_top3' if y <= 2006 else 'div_top4' if y <= 2015 else 'record'


from tenures import franchise  # noqa: E402
_R = json.load(open(os.path.join(OUT, 'results.json')))
MARGIN = {}
for _s, _teams in _R.items():
    _y = int(_s[:4]) + 1
    for _ab, _g in _teams.items():
        if _g:
            MARGIN[(_s, 'CHO' if _ab == 'CHA' and _y >= 2005 else franchise(_ab))] = float(np.mean([x[2] for x in _g]))


def rating(season):
    """Luck-adjusted margin per game, exactly as gm5.ADJ: the NBA game log's margin (by the NBA's abbreviations) plus
    luck.py's luck term (by franchise) times luck.LUCK_SHARE."""
    t = L[season]['teams']
    from luck import LUCK_SHARE
    return {T: MARGIN[(season, T)] + LUCK_SHARE * t.get(T, {}).get('luck', 0.0) for T in P[season]['teams']}


# ------------------------------------------------------------------ the game models
def sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def logit_fit(X, y, ridge=1e-6):
    b = np.zeros(X.shape[1])
    for _ in range(50):
        p = sig(X @ b)
        g = X.T @ (y - p) - ridge * b
        H = (X * (p * (1 - p))[:, None]).T @ X + ridge * np.eye(len(b))
        step = np.linalg.solve(H, g)
        b += step
        if np.abs(step).max() < 1e-10:
            break
    return b


def games_of(season, kind):
    """[(home, visitor, home won, home flag)] for a season's regular season or its playoffs (play-in included)."""
    D = P[season]
    neutral = season == '2019-20'
    if kind == 'reg':
        return [(g[1], g[2], g[3] > 0, 1.0 - g[4]) for g in D['schedule'] if g[3] != 0]
    gl = [g for s in D['series'] for g in s['games']] + D['play_in']
    return [(g[1], g[2], g[3] > 0, 0.0 if neutral else 1.0) for g in gl if g[3] != 0]


def design(seasons, kind):
    X, y = [], []
    for s in seasons:
        r = rating(s)
        for h, a, won, home in games_of(s, kind):
            X.append((home, r[h] - r[a])); y.append(won)
    return np.array(X, float), np.array(y, float)


FITS = {}


def fit_for(season, kind):
    """(a, b, early): fit on the seasons before this one (the first four seasons' fit before that)."""
    key = (season, kind)
    if key not in FITS:
        i = SEASONS.index(season)
        early = i < FIRST_FIT
        use = SEASONS[:FIRST_FIT] if early else SEASONS[:i]
        X, y = design(use, kind)
        a, b = logit_fit(X, y)
        FITS[key] = (float(a), float(b), early)
    return FITS[key]


# ------------------------------------------------------------------ how far playoff strength strays from the rating
# A team's strength in the playoffs is not exactly its season rating (injuries, a deadline trade, a rotation tightened),
# and that difference is shared by all its playoff games, which independent games would miss. tau (margin points) is
# fit by maximum likelihood on series outcomes from earlier seasons only, each series at its own season's game fit.
TAU_GRID = np.round(np.arange(0.0, 3.01, 0.25), 2)
_GH = np.polynomial.hermite_e.hermegauss(24)


def series_prob(d, a, b, neutral, pat, bo, sd):
    """P(the team hosting Game 1 wins the series): rating difference d, game fit (a, b), strength difference ~ N(d, sd^2)."""
    x, w = _GH
    dd = d + sd * x
    ah = 0.0 if neutral else a
    ph, pa = sig(ah + b * dd), 1.0 - sig(ah - b * dd)
    need = bo // 2 + 1
    st = {(0, 0): np.ones_like(dd)}
    win = np.zeros_like(dd)
    for g in range(bo):
        p = ph if pat[g] == 'H' else pa
        nxt = collections.defaultdict(lambda: 0.0)
        for (i, j), pr in st.items():
            if i == need or j == need:
                continue
            nxt[(i + 1, j)] = nxt[(i + 1, j)] + pr * p
            nxt[(i, j + 1)] = nxt[(i, j + 1)] + pr * (1 - p)
        st = nxt
        for (i, j), pr in st.items():
            if i == need:
                win = win + pr
    return float((win * w).sum() / w.sum())


_SER = None


def series_loglik():
    """{season: log-likelihood of its series at each tau on the grid}"""
    global _SER
    if _SER is None:
        _SER = {}
        for s in SEASONS:
            a, b, _ = fit_for(s, 'po')
            r = rating(s)
            ll = np.zeros(len(TAU_GRID))
            for se in P[s]['series']:
                h = se['games'][0][1]
                o = se['loser'] if h == se['winner'] else se['winner']
                bo, pat = FORMAT[s][se['round']]
                for k, t in enumerate(TAU_GRID):
                    p = series_prob(r[h] - r[o], a, b, s == '2019-20', pat, bo, t * math.sqrt(2))
                    ll[k] += math.log(p if h == se['winner'] else 1 - p)
            _SER[s] = ll
    return _SER


def tau_for(season):
    i = SEASONS.index(season)
    use = SEASONS[FIRST_FIT:i] if i > FIRST_FIT else SEASONS[:FIRST_FIT]
    tot = sum(series_loglik()[s] for s in use)
    return float(TAU_GRID[int(np.argmax(tot))])


# ------------------------------------------------------------------ the format, read from the games
def series_pattern(se):
    h0 = se['games'][0][1]
    return ''.join('H' if g[1] == h0 else 'A' for g in se['games'])


def formats():
    """{season: {round: (best_of, pattern)}}: lengths from the wins needed, patterns from who hosted each game (positions
    no series reached that season come from the nearest season with the same length whose series reached them)."""
    seen = {}
    for s in SEASONS:
        for se in P[s]['series']:
            bo = 2 * se['wins'][0] - 1
            pat = series_pattern(se)
            cur = seen.setdefault((s, se['round']), [bo, [None] * bo])
            assert cur[0] == bo, (s, se['round'])
            for k, c in enumerate(pat):
                assert cur[1][k] in (None, c), ('two patterns', s, se['round'])
                cur[1][k] = c
    out = {}
    for (s, rnd), (bo, pat) in seen.items():
        if None in pat:
            y = y_of(s)
            for d in sorted(SEASONS, key=lambda x: (abs(y_of(x) - y), y_of(x) > y)):     # the nearest, an earlier one first
                o = seen.get((d, rnd))
                if o and o[0] == bo and all(o[1][k] is not None for k, c in enumerate(pat) if c is None):
                    pat = [c if c is not None else o[1][k] for k, c in enumerate(pat)]
                    break
        assert None not in pat, (s, rnd, pat)
        out.setdefault(s, {})[rnd] = (bo, ''.join(pat))
    return out


FORMAT = formats()


# ------------------------------------------------------------------ one season, simulated
class Season:
    def __init__(self, season, sims=SIMS, seed=None):
        self.s, self.y = season, y_of(season)
        D = P[season]
        self.teams = sorted(D['teams'])
        self.ix = {t: i for i, t in enumerate(self.teams)}
        self.n = len(self.teams)
        self.conf = np.array([D['teams'][t]['conf'] for t in self.teams])
        self.div = [D['teams'][t]['div'] for t in self.teams]
        sch = [(self.ix[g[1]], self.ix[g[2]]) for g in D['schedule']]
        self.h = np.array([a for a, b in sch]); self.a = np.array([b for a, b in sch])
        self.home_flag = np.array([1.0 - g[4] for g in D['schedule']])          # 0 at a neutral site
        self.gp = np.bincount(self.h, minlength=self.n) + np.bincount(self.a, minlength=self.n)
        self.S = sims
        rng = np.random.default_rng(seed if seed is not None else self.y)
        self.U = rng.random((len(sch), sims), dtype=np.float32)        # one draw per game per run: common to every replay
        self.TB = rng.random((sims, self.n))                           # tiebreak order per run
        self.SU = rng.random((sims, 64))                               # one draw per series / play-in slot per run
        self.Z = rng.standard_normal((sims, self.n))                   # each team's playoff strength away from its rating, per run
        self.SZ = rng.standard_normal((sims, 64))                      # one series-level effect per series slot per run
        self.tau = 0.0             # tested Nov 2026 (titles_study.py): extra playoff noise lost out of sample to the blend
        self.sigma = 0.0                                               # series-level random effect (margin points)
        self.off = np.zeros(self.n)                                    # playoff strength offset per team (margin points)
        self.reg = fit_for(season, 'reg')
        self.po = fit_for(season, 'po')
        self.neutral = season == '2019-20'
        self.fmt = FORMAT[season]
        self.rule = seeding_rule(self.y)
        self.slot = 0
        self.by_team = [np.where((self.h == i) | (self.a == i))[0] for i in range(self.n)]
        self.Mh = np.zeros((self.n, len(sch)), np.float32); self.Mh[self.h, np.arange(len(sch))] = 1
        self.Ma = np.zeros((self.n, len(sch)), np.float32); self.Ma[self.a, np.arange(len(sch))] = 1

    # regular season ---------------------------------------------------
    def home_wins(self, r, rows=None):
        a, b, _ = self.reg
        rows = np.arange(len(self.h)) if rows is None else rows
        p = sig(a * self.home_flag[rows] + b * (r[self.h[rows]] - r[self.a[rows]])).astype(np.float32)
        return (self.U[rows] < p[:, None]).astype(np.float32)

    def wins(self, hw, rows=None):
        """(S, n) wins from home-win indicators (rows of the schedule: all, or a subset for a change)."""
        rows = np.arange(len(self.h)) if rows is None else rows
        return (self.Mh[:, rows] @ hw - self.Ma[:, rows] @ hw).T + (self.Ma[:, rows].sum(1)[None, :] if rows is not None else 0)

    # seeding ----------------------------------------------------------
    def key(self, W):
        return W / self.gp[None, :] + self.TB * 1e-6

    def seeds(self, K, conf):
        """(S, k) team indices in seed order for one conference."""
        idx = np.where(self.conf == conf)[0]
        k = K[:, idx]
        order = np.argsort(-k, axis=1)
        ranked = idx[order]
        if self.rule in ('record',):
            return ranked
        divs = sorted({self.div[i] for i in idx})
        winners = np.zeros_like(k, dtype=bool)
        for dv in divs:
            m = np.array([self.div[i] == dv for i in idx])
            sub = np.where(m, k, -np.inf)
            winners[np.arange(self.S), sub.argmax(axis=1)] = True
        top = {'byes': 2, 'div_top2': 2, 'div_top3': 3, 'div_top4': 4}[self.rule]
        pri = winners.copy()
        if self.rule == 'div_top4':                    # the best team that did not win its division joins them
            other = np.where(winners, -np.inf, k)
            pri[np.arange(self.S), other.argmax(axis=1)] = True
        assert (pri.sum(1) == top).all()
        score = k + np.where(pri, 10.0, 0.0)
        return idx[np.argsort(-score, axis=1)]

    # playoffs ---------------------------------------------------------
    def p_home(self, R, home, away, extra=0.0):
        """R: (S, n) playoff strengths; home, away: (S,) team indices; extra: a series-level shift toward home."""
        a, b, _ = self.po
        k = np.arange(self.S)
        return sig((0.0 if self.neutral else a) + b * (R[k, home] - R[k, away] + extra))

    def draw(self):
        u = self.SU[:, self.slot]
        self.slot += 1
        return u

    def game(self, r, home, away):
        """One game (the play-in): the winner."""
        return np.where(self.draw() < self.p_home(r, home, away), home, away)

    def series(self, r, K, x, z, rnd):
        """x, z: (S,) team indices. Home court to the better record; the winner, drawn from the exact series odds."""
        bo, pat = self.fmt[rnd]
        better = K[np.arange(self.S), x] >= K[np.arange(self.S), z]
        A, B = np.where(better, x, z), np.where(better, z, x)
        sz = self.sigma * self.SZ[:, self.slot] if self.sigma else 0.0     # this series' own swing, shared by its games
        pa_home, pa_away = self.p_home(r, A, B, sz), 1.0 - self.p_home(r, B, A, -sz)
        need = bo // 2 + 1
        # P(A wins the series): over game-by-game states (wins of A, wins of B)
        st = {(0, 0): np.ones(self.S)}
        win = np.zeros(self.S)
        for g in range(bo):
            p = pa_home if pat[g] == 'H' else pa_away
            nxt = collections.defaultdict(lambda: np.zeros(self.S))
            for (i, j), pr in st.items():
                if i == need or j == need:
                    continue
                nxt[(i + 1, j)] += pr * p
                nxt[(i, j + 1)] += pr * (1 - p)
            st = nxt
            for (i, j), pr in st.items():
                if i == need:
                    win += pr
        return np.where(self.draw() < win, A, B)

    def champion(self, r, W):
        self.slot = 0
        K = self.key(W)
        r = r[None, :] + self.off[None, :] + self.tau * self.Z   # playoff strength: the rating (+ any offset), give or take tau
        final = []
        for conf in ('E', 'W'):
            sd = self.seeds(K, conf)
            if self.y >= 2021:                          # the play-in
                w78 = self.game(r, sd[:, 6], sd[:, 7]); l78 = np.where(w78 == sd[:, 6], sd[:, 7], sd[:, 6])
                w910 = self.game(r, sd[:, 8], sd[:, 9])
                last = self.game(r, l78, w910)
                sd = np.concatenate([sd[:, :6], w78[:, None], last[:, None]], axis=1)
            elif self.y == 2020:                        # 8 v 9 if the 9th is within four games: the 8th needs one win of two
                W8, W9 = K[np.arange(self.S), sd[:, 7]], K[np.arange(self.S), sd[:, 8]]
                gb = (W8 - W9) * self.gp.mean()
                g1 = self.game(r, sd[:, 7], sd[:, 8]); g2 = self.game(r, sd[:, 7], sd[:, 8])
                eighth = np.where((gb <= 4) & (g1 != sd[:, 7]) & (g2 != sd[:, 7]), sd[:, 8], sd[:, 7])
                sd = np.concatenate([sd[:, :7], eighth[:, None]], axis=1)
            if self.rule == 'byes':
                w36 = self.series(r, K, sd[:, 2], sd[:, 5], 'first')
                w45 = self.series(r, K, sd[:, 3], sd[:, 4], 'first')
                s1 = self.series(r, K, sd[:, 0], w45, 'semi')
                s2 = self.series(r, K, sd[:, 1], w36, 'semi')
            else:
                f = [self.series(r, K, sd[:, i], sd[:, j], 'first') for i, j in ((0, 7), (3, 4), (2, 5), (1, 6))]
                s1 = self.series(r, K, f[0], f[1], 'semi')
                s2 = self.series(r, K, f[2], f[3], 'semi')
            final.append(self.series(r, K, s1, s2, 'conf_final'))
        return self.series(r, K, final[0], final[1], 'final')

    def odds(self, r, W):
        ch = self.champion(r, W)
        return np.bincount(ch, minlength=self.n) / self.S

    def with_team(self, r, hw, W, i, val):
        """The season replayed with team i at rating val, every draw unchanged: only its games are replayed."""
        r2 = r.copy(); r2[i] = val
        rows = self.by_team[i]
        W2 = W - self.wins(hw[rows], rows) + self.wins(self.home_wins(r2, rows), rows)
        return self.odds(r2, W2)[i]


def check_seeding(season):
    """The era's seeding rules, applied to the real standings (ties broken every way), must give the real first-round
    matchups."""
    D = P[season]
    S = Season(season, sims=400, seed=1)
    W = np.tile(np.array([D['teams'][t]['w'] for t in S.teams], float), (S.S, 1))
    K = S.key(W)
    real = {frozenset((se['winner'], se['loser'])) for se in D['series'] if se['round'] == 'first'}
    hits = 0
    for run in range(S.S):
        got = set()
        for conf in ('E', 'W'):
            sd = [S.teams[i] for i in S.seeds(K[run:run + 1].repeat(S.S, 0), conf)[0]]
            pairs = ((2, 5), (3, 4)) if S.rule == 'byes' else ((0, 7), (3, 4), (2, 5), (1, 6))
            for i, j in pairs:
                if S.y >= 2020 and (j >= 6):
                    continue                            # the play-in decides those
                got.add(frozenset((sd[i], sd[j])))
        if got <= real:
            hits += 1
    return hits > 0


# ------------------------------------------------------------------ title chance from projected strength (future seasons)
# For a season not yet played, the title chance of a team h seasons ahead is a curve of its projected strength relative
# to the league (titles_ref.py: every team's holdings, projected with the point-in-time snapshots, minus the league mean
# that day). Fit from history: on each reference date, each team's projection for the season h ahead against that
# season's simulated title chance (logistic, fractional outcomes). In season (this calendar day, and February 1) the
# team's margin so far is known on the day and is a second input. One version per season Y, fit only on seasons that
# finished before Y; with fewer than MIN_CURVE seasons behind it, the earliest version that has them, flagged early.
REFS_PATH = os.path.join(OUT, 'title_refs.json')
KINDS = ('summer', 'open', 'today', 'mid')
IN_SEASON = ('today', 'mid')
MIN_CURVE = 5
CURVE_SEASONS = range(1981, 2028)


def todate_margin():
    by = collections.defaultdict(list)
    for s_, teams in _R.items():
        y = int(s_[:4]) + 1
        for ab, g in teams.items():
            f = 'CHO' if ab == 'CHA' and y >= 2005 else franchise(ab)
            by[(y, f)] += [(x[0], x[2]) for x in g]
    for v in by.values():
        v.sort()

    def md(y, team, d):
        g = [m for dd, m in by.get((y, team), []) if dd < d]
        return float(np.mean(g)) if g else 0.0
    return md


def curve_rows(refs, odds):
    """{(kind, h): [(target season, x, margin so far, simulated chance of the target season)]}"""
    md = todate_margin()
    E = {(y_of(s), t): v['E'] for s, d in odds.items() for t, v in d['teams'].items()}
    out = collections.defaultdict(list)
    for r in refs:
        y = r['season']
        n = len(r['teams'])
        for h in range(len(next(iter(r['teams'].values())))):
            m = sum(v[h] for v in r['teams'].values()) / n
            for t, v in r['teams'].items():
                if (y + h, t) in E:
                    out[(r['kind'], h)].append((y + h, v[h] - m, md(y, t, r['date']) if r['kind'] in IN_SEASON else 0.0, E[(y + h, t)]))
    return out


def features(kind, x, m):
    x = np.asarray(x, float) / 100.0
    return np.c_[np.ones_like(x), x, np.asarray(m, float)] if kind in IN_SEASON else np.c_[np.ones_like(x), x]


def fit_curves(rows):
    """{kind: {h: {Y: [coefficients..., early]}}}"""
    out = {}
    for (kind, h), rs in rows.items():
        rs = np.array(rs)
        first_ok = None
        for Y in CURVE_SEASONS:
            if len({t for t in rs[:, 0] if t < Y}) >= MIN_CURVE:
                first_ok = Y
                break
        cur = out.setdefault(kind, {}).setdefault(str(h), {})
        for Y in CURVE_SEASONS:
            use = Y if first_ok is not None and Y >= first_ok else first_ok
            if use is None:
                continue
            sel = rs[rs[:, 0] < use]
            b = logit_fit(features(kind, sel[:, 1], sel[:, 2]), sel[:, 3])
            cur[str(Y)] = [round(float(c), 8) for c in b] + [use != Y]
    return out


def curve_report(rows, curves, odds):
    rep = ['', 'Title chance from projected strength (each reference date scored by the version fit before its season):']
    won = {(y_of(s), t): v['won'] for s, d in odds.items() for t, v in d['teams'].items()}
    for kind in KINDS:
        line = []
        for h in (0, 1, 3, 5, 9):
            rs = [r for r in rows.get((kind, h), []) if str(int(r[0] - h)) in curves[kind][str(h)] and not curves[kind][str(h)][str(int(r[0] - h))][-1]]
            if not rs:
                continue
            p = np.array([sig(features(kind, [r[1]], [r[2]]) @ np.array(curves[kind][str(h)][str(int(r[0] - h))][:-1]))[0] for r in rs])
            e = np.array([r[3] for r in rs])
            line.append(f'h={h}: r with the simulated chance {np.corrcoef(p, e)[0, 1]:.2f}, mean {p.mean():.3f} v {e.mean():.3f}')
        rep.append(f'  {kind:7} ' + ' | '.join(line))
    return rep


# ------------------------------------------------------------------ Part 2: do playoffs reward top-heavy rosters?
# Playoff rotations shrink, so value concentrated in a team's top players might count for more than its season rating
# says. The test: each playoff game's outcome on the rating difference and home court (model A), and the same plus the
# difference in the share of team value held by the top 8 players (model B; top 7 as a second look). Out of sample:
# every season from 1990 predicted by fits on the seasons before it; the gain is B's log-likelihood minus A's, with a
# 95% interval from resampling seasons. B goes into the title model only if the interval is above zero.
def concentration(tv, k):
    out = {}
    for y, teams in tv.items():
        for t, v in teams.items():
            top, total = v[:-1], v[-1]
            out[(int(y), t)] = sum(top[:k]) / total if total > 0 else 0.0
    return out


def top_heavy(tv, k=8, first_test=1990, boot=2000):
    C = concentration(tv, k)
    rows = []
    for s in SEASONS:
        y, r = y_of(s), rating(s)
        for h, a, won, home in games_of(s, 'po'):
            rows.append((y, home, r[h] - r[a], C[(y, h)] - C[(y, a)], won))
    R = np.array(rows, float)
    gain = {}
    for y in range(first_test, max(y_of(s) for s in SEASONS) + 1):
        tr, te = R[R[:, 0] < y], R[R[:, 0] == y]
        if not len(te):
            continue
        ba = logit_fit(tr[:, 1:3], tr[:, 4]); bb = logit_fit(tr[:, 1:4], tr[:, 4])
        pa, pb = sig(te[:, 1:3] @ ba), sig(te[:, 1:4] @ bb)
        ll = lambda p: np.where(te[:, 4] == 1, np.log(p), np.log(1 - p)).sum()
        gain[y] = float(ll(pb) - ll(pa))
    g = np.array(list(gain.values()))
    rng = np.random.default_rng(5)
    bs = [rng.choice(g, len(g)).sum() for _ in range(boot)]
    lo, hi = np.percentile(bs, [2.5, 97.5])
    full = logit_fit(R[:, 1:4], R[:, 4])
    p = sig(R[:, 1:4] @ full)
    H = (R[:, 1:4] * (p * (1 - p))[:, None]).T @ R[:, 1:4]
    se = float(np.sqrt(np.linalg.inv(H)[2, 2]))
    return {'k': k, 'games': len(R), 'seasons_tested': len(g), 'gain': float(g.sum()), 'lo': float(lo), 'hi': float(hi),
            'coef_all_seasons': float(full[2]), 'se': se, 'holds': bool(lo > 0)}


def leakage(sample=(1990, 2000, 2010, 2020, 2026)):
    """Every season from Y on deleted (its standings, games, playoffs, references): the game fits, tau, every earlier
    season's title chance and the projected curves' version Y must come out exactly as stored."""
    global P, SEASONS, FORMAT, _SER, _SC
    stored = json.load(open(os.path.join(OUT, 'title_odds.json')))
    refs = json.load(open(REFS_PATH))['refs']
    full_P = P
    bad = 0
    for Y in sample:
        P = {s: v for s, v in full_P.items() if y_of(s) < Y}
        SEASONS = sorted(P); FORMAT = formats(); FITS.clear(); _SER = None
        odds = {}
        _SC = None
        wch, _ = blend_choice()
        for s in SEASONS:
            if list(wch[s]) != stored['seasons'][s]['blend_w']:
                bad += 1
                print('   blend weight mismatch', Y, s, wch[s], stored['seasons'][s]['blend_w'])
            S, r, hw, W, pre, _, raw = setup(s)
            S.off = offset(r, raw, pre, *wch[s])
            E = S.odds(r, W)
            odds[s] = {'teams': {t: {'E': round(float(E[i]), 5)} for i, t in enumerate(S.teams)}}
            for t in S.teams:
                if odds[s]['teams'][t]['E'] != stored['seasons'][s]['teams'][t]['E']:
                    bad += 1
        cv = fit_curves(curve_rows([r for r in refs if r['season'] < Y], odds))
        for kind in cv:
            for h in cv[kind]:
                if str(Y) in cv[kind][h] and cv[kind][h][str(Y)] != stored['curves'][kind][h][str(Y)]:
                    bad += 1
                    print('   mismatch', Y, kind, h, cv[kind][h][str(Y)], stored['curves'][kind][h][str(Y)])
        print(f'  as of {Y}: {len(SEASONS)} seasons kept, mismatches so far {bad}', flush=True)
    P = full_P; SEASONS = sorted(P); FORMAT = formats(); FITS.clear(); _SER = None; _SC = None
    print(f'title leakage test: {len(sample)} as-of seasons, every later season deleted; mismatches: {bad}')
    return bad


# ------------------------------------------------------------------ playoff strength: the season blended with the preseason view
# titles_study.py (Nov 2026) scored 288 playoff models out of sample by log score: more playoff noise (per team or per
# series), the preseason projection blended in, the top 2-3 players' share, and their combinations. The blend won
# (1.902 against 1.983 for the model before it; noise 1.967; star share 1.992, worse; combinations no better), so a
# team's playoff strength is its rating + w x (its opening-night projection on the margin scale - its rating), with w
# for each season the one with the best log score over the seasons before it (BLEND_GRID; 0 before 1988-89).
BLEND_GRID = (0.0, 0.25, 0.5, 0.75)
FIRST_SCORED = 1984
GRID_DELTAS = tuple(range(-16, 17, 2))       # margin points: each team-season replayed at its strength plus each


def preseason():
    """{season: {team: opening-night projected strength relative to the league (value points)}}"""
    out = {}
    for r in json.load(open(REFS_PATH))['refs']:
        if r['kind'] == 'open':
            m = np.mean([v[0] for v in r['teams'].values()])
            out[r['season']] = {t: v[0] - m for t, v in r['teams'].items()}
    return out


_PRE = None


def pre_margin(season):
    """The opening-night projection on the margin scale (the rating's slope on it over earlier seasons; the first five
    seasons' slope before 1985), by team."""
    global _PRE
    if _PRE is None:
        _PRE = preseason()
    y = y_of(season)
    use = [x for x in SEASONS if y_of(x) < y]
    if len(use) < 5:
        use = SEASONS[:5]
    xs, rs = [], []
    for x in use:
        r = rating(x)
        for t, v in _PRE.get(y_of(x), {}).items():
            if t in r:
                xs.append(v); rs.append(r[t])
    xs, rs = np.array(xs), np.array(rs)
    k = float((xs * rs).sum() / (xs * xs).sum())
    return {t: k * v for t, v in _PRE.get(y, {}).items()}, k


def setup(season):
    S = Season(season)
    r = np.array([rating(season)[t] for t in S.teams])
    hw = S.home_wins(r)
    W = S.wins(hw)
    pm, k = pre_margin(season)
    pre = np.array([pm.get(t, 0.0) for t in S.teams])
    raw = np.array([MARGIN[(season, t)] for t in S.teams])
    return S, r, hw, W, pre, k, raw


# Playoff strength (Nov 2026, second test): the base is the luck-adjusted rating, the raw margin, or a mix (u: share of
# raw); then the preseason blend (w). Families tested out of sample by log score; FAMILY is the winner (playoff_study).
RAW_GRID = (0.0, 0.25, 0.5, 0.75, 1.0)
FAMILIES = {'luck-adjusted': ((0.0,), (0.0,)), 'luck-adjusted + preseason': ((0.0,), BLEND_GRID),
            'raw': ((1.0,), (0.0,)), 'raw + preseason': ((1.0,), BLEND_GRID),
            'mix of raw and luck-adjusted': (RAW_GRID, (0.0,)), 'mix + preseason': (RAW_GRID, BLEND_GRID)}
FAMILY = 'raw + preseason'


# Value into margin (Nov 2026): across team-seasons, a team's luck-adjusted margin against its players' value above the
# league average bends: per 100 value points about 1.1-1.3 points of margin for weak and average teams, 0.55-0.6 for the
# strongest quarter (more value on a strong team buys less margin: fewer shots, overlapping roles). A quadratic beat a
# straight line out of sample (squared error -0.14 a team, 95% -0.22 to -0.06). A decision's titles with and without it
# move the team along this curve, fit for each season on the seasons before it (the first five seasons' fit before 1985).
_VAL = None


def team_value(season):
    """{team: players' value above the league average that season, in hundreds of value points} (titles_ref.py)"""
    global _VAL
    if _VAL is None:
        _VAL = json.load(open(REFS_PATH))['team_values']
    tv = {t: v[-1] for t, v in _VAL[str(y_of(season))].items() if t in P[season]['teams']}
    m = np.mean(list(tv.values()))
    return {t: (v - m) / 100.0 for t, v in tv.items()}


def value_to_margin(season):
    """[a, b, c]: luck-adjusted margin = a + b v + c v^2 (v in hundreds of value points), fit on earlier seasons."""
    y = y_of(season)
    use = [x for x in SEASONS if y_of(x) < y]
    if len(use) < 5:
        use = SEASONS[:5]
    V, M = [], []
    for x in use:
        tv, r = team_value(x), rating(x)
        for t, v in tv.items():
            V.append(v); M.append(r[t])
    V, M = np.array(V), np.array(M)
    return [float(c) for c in np.linalg.lstsq(np.c_[np.ones_like(V), V, V * V], M, rcond=None)[0]]


def offset(r, raw, pre, u, w):
    """Playoff strength - rating: base = rating + u (raw margin - rating); strength = base + w (preseason - base)."""
    base = r + u * (raw - r)
    return (base - r) + w * (pre - base)


_SC = None


def playoff_scores():
    """{season: {(u, w): minus the log of the champion's chance}} over the whole grid (every draw the same)."""
    global _SC
    if _SC is None:
        _SC = {}
        for s_ in SEASONS:
            S, r, hw, W, pre, _, raw = setup(s_)
            ci = S.teams.index(P[s_]['champion'])
            _SC[s_] = {}
            for u in RAW_GRID:
                for w in BLEND_GRID:
                    S.off = offset(r, raw, pre, u, w)
                    _SC[s_][(u, w)] = -math.log(max(S.odds(r, W)[ci], 1e-4))
    return _SC


def blend_choice(family=None):
    """{season: (u, w)}: within a family, the grid point with the best log score over the scored seasons before it."""
    us, ws = FAMILIES[family or FAMILY]
    allowed = [(u, w) for u in us for w in ws]
    sc = playoff_scores()
    scored = [x for x in SEASONS if y_of(x) >= FIRST_SCORED]
    out = {}
    for s_ in SEASONS:
        prior = [x for x in scored if x < s_]
        out[s_] = allowed[0] if len(prior) < 5 else min(allowed, key=lambda c: sum(sc[x][c] for x in prior))
    return out, sc


def playoff_study(odds_by_family=None):
    """Each family, out of sample: the log score of every season from 1989-90 on, with the grid point chosen before it."""
    sc = playoff_scores()
    ev = [x for x in SEASONS if y_of(x) >= 1990]
    res = {}
    for f in FAMILIES:
        ch, _ = blend_choice(f)
        res[f] = {'log_score': float(np.mean([sc[x][ch[x]] for x in ev])), 'latest': ch[SEASONS[-1]], 'per_season': {x: sc[x][ch[x]] for x in ev}}
    return res


def main():
    import time
    t0 = time.time()
    out = {'sims': SIMS, 'near': NEAR, 'seeding': SEEDING, 'formats': FORMAT, 'seasons': {}}
    rep = []
    bad_seed = [s for s in SEASONS if not check_seeding(s)]
    rep.append(f'seeding rules against the real first-round matchups: {len(SEASONS) - len(bad_seed)} of {len(SEASONS)} seasons reproduced'
               + (f'; not: {bad_seed}' if bad_seed else ''))
    hc = collections.Counter()
    for s in SEASONS:
        T = P[s]['teams']
        for se in P[s]['series']:
            h0 = se['games'][0][1]
            o = se['loser'] if h0 == se['winner'] else se['winner']
            wp = lambda t: T[t]['w'] / (T[t]['w'] + T[t]['l'])
            if wp(h0) != wp(o):
                hc[wp(h0) > wp(o)] += 1
    rep.append(f'home court: the better record hosted Game 1 in {hc[True]} of {hc[True] + hc[False]} series whose records differed')
    assert not hc[False], 'home court is not always the better record: the simulation would be wrong'
    WCH, WSC = blend_choice()
    study = playoff_study()
    out['blend'] = {'family': FAMILY, 'raw_grid': RAW_GRID, 'grid': BLEND_GRID, 'choice': {k: list(v) for k, v in WCH.items()},
                    'study': {f: {k: v for k, v in x.items() if k != 'per_season'} for f, x in study.items()}, 'deltas': GRID_DELTAS}
    base = study['luck-adjusted']['per_season']
    rep.append('Playoff strength, out of sample (log score of the champion, every season from 1989-90; lower is better; each '
               'season\'s weights chosen on the seasons before it):')
    for f, x in sorted(study.items(), key=lambda kv: kv[1]['log_score']):
        dd = np.array([x['per_season'][k] - base[k] for k in base])
        bs = [np.random.default_rng(7 + i).choice(dd, len(dd)).mean() for i in range(2000)]
        rep.append(f"  {f:30} {x['log_score']:.3f}  against luck-adjusted alone {dd.mean():+.3f} [95% {np.percentile(bs, 2.5):+.3f}, {np.percentile(bs, 97.5):+.3f}]"
                   f"  latest (share raw, preseason weight) {tuple(x['latest'])}{'  <- used' if f == FAMILY else ''}")
    for s in SEASONS:
        S, r, hw, W, pre, kpre, raw = setup(s)
        S.off = offset(r, raw, pre, *WCH[s])  # a change in the team's strength moves every part: the offset stays
        E = S.odds(r, W)
        rows = {}
        for i, t in enumerate(S.teams):
            # the team's title chance at its strength plus each delta (margin points), every draw unchanged: a decision's
            # titles with it and without it are read off this
            grid = [round(float(E[i]), 5) if d == 0 else round(float(S.with_team(r, hw, W, i, r[i] + d)), 5) for d in GRID_DELTAS]
            e0 = S.with_team(r, hw, W, i, 0.0)
            if abs(r[i]) < NEAR:
                up, dn = S.with_team(r, hw, W, i, NEAR), S.with_team(r, hw, W, i, -NEAR)
                slope, basis = (up - dn) / (2 * NEAR), 'derivative'
            else:
                slope, basis = (E[i] - e0) / r[i], 'secant'
            rows[t] = {'rating': round(float(r[i]), 3), 'E': round(float(E[i]), 5), 'E0': round(float(e0), 5),
                       'slope_per_margin': round(float(slope), 6), 'slope_basis': basis, 'grid': grid,
                       'preseason_margin': round(float(pre[i]), 3), 'playoff_strength': round(float(r[i] + S.off[i]), 3),
                       'won': P[s]['champion'] == t, 'w': P[s]['teams'][t]['w'], 'l': P[s]['teams'][t]['l']}
        tv = team_value(s)
        for t in rows:
            rows[t]['value_above_average'] = round(tv.get(t, 0.0) * 100, 1)
        out['seasons'][s] = {'n': S.n, 'champion': P[s]['champion'], 'teams': rows, 'value_to_margin': value_to_margin(s),
                             'fit_regular': S.reg, 'fit_playoffs': S.po, 'tau': S.tau, 'blend_w': list(WCH[s]), 'preseason_scale': kpre, 'early': S.po[2]}
        print(s, 'champion', P[s]['champion'], f"{rows[P[s]['champion']]['E']:.3f}", '| top',
              max(rows, key=lambda t: rows[t]['E']), f"{max(v['E'] for v in rows.values()):.3f}", f'{time.time() - t0:.0f}s', flush=True)
    rep += calibration(out)
    refs = json.load(open(REFS_PATH))
    rows = curve_rows([r for r in refs['refs'] if r['kind'] != 'today' or r['date'] < refs['today']], out['seasons'])
    out['curves'] = fit_curves(rows)
    out['curve_note'] = 'logistic in (projected strength relative to the league)/100 value points' + \
        ' [, the margin so far in season]; version Y fit on seasons before Y; last element: early'
    rep += curve_report(rows, out['curves'], out['seasons'])
    rep += ['', 'Do playoffs reward top-heavy rosters? (out of sample, each season from 1990 on fit on the seasons before it)']
    th = {}
    for k in (8, 7):
        t = top_heavy(refs['team_values'], k)
        th[k] = t
        rep.append(f"  top {k} players' share of team value: log-likelihood gain {t['gain']:+.2f} over {t['seasons_tested']} seasons "
                   f"[95% {t['lo']:+.2f}, {t['hi']:+.2f}], {t['games']} games; coefficient {t['coef_all_seasons']:+.3f} (se {t['se']:.3f}) "
                   f"-> {'holds up: used' if t['holds'] else 'does not hold up: not used'}")
    out['top_heavy'] = th
    out['top_heavy_used'] = th[8]['holds']
    tmp = os.path.join(OUT, 'title_odds.json.tmp')
    json.dump(out, open(tmp, 'w'), indent=0)
    os.replace(tmp, os.path.join(OUT, 'title_odds.json'))
    open(os.path.join(OUT, 'title_report.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))


def calibration(out, skip_early=True):
    rep = ['', 'Calibration (each season from game fits on earlier seasons only; the first four seasons are in sample and left out):']
    rows = [(v['E'], v['won'], s, t, v['w'] / (v['w'] + v['l'])) for s, d in out['seasons'].items() if not (skip_early and d['early'])
            for t, v in d['teams'].items()]
    edges = [0, 0.02, 0.05, 0.15, 0.30, 1.01]
    rep.append(f"{'predicted':>14} {'team-seasons':>12} {'expected titles':>16} {'titles won':>10}")
    for lo, hi in zip(edges, edges[1:]):
        b = [x for x in rows if lo <= x[0] < hi]
        rep.append(f'{lo:6.0%} to {min(hi, 1):4.0%} {len(b):12} {sum(x[0] for x in b):16.1f} {sum(x[1] for x in b):10}')
    brier = np.mean([(e - w) ** 2 for e, w, *_ in rows])
    seasons = sorted({x[2] for x in rows})
    best = []
    for s in seasons:
        b = [x for x in rows if x[2] == s]
        top = max(x[4] for x in b)
        n = sum(1 for x in b if x[4] == top)
        best += [((1 / n if x[4] == top else 0.0), x[1]) for x in b]
    brier_best = np.mean([(e - w) ** 2 for e, w in best])
    brier_flat = np.mean([(1 / out['seasons'][x[2]]['n'] - x[1]) ** 2 for x in rows])
    rep.append(f'Brier score: {brier:.4f} | best record wins: {brier_best:.4f} | every team alike (1/N): {brier_flat:.4f} '
               f'| skill against best record: {1 - brier / brier_best:+.1%}')
    ll = -np.mean([math.log(max(1e-6, e)) for e, w, *_ in rows if w])
    rep.append(f'mean log score of the champion: {ll:.3f} ({len(seasons)} seasons); champion was the favourite in '
               f"{sum(1 for s in seasons if max(out['seasons'][s]['teams'].items(), key=lambda kv: kv[1]['E'])[0] == out['seasons'][s]['champion'])} of {len(seasons)}")
    sums = [sum(v['E'] for v in d['teams'].values()) for d in out['seasons'].values()]
    rep.append(f'chances add up to 1 in every season: min {min(sums):.6f} max {max(sums):.6f}')
    return rep


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'leakage':
        sys.exit(1 if leakage() else 0)
    main()
