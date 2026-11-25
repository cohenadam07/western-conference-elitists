"""
lottery.py — where an unconveyed pick will land: the chance of each slot given the standings as of a
date, the lottery rules that applied that year, and protections. Built fresh.

Team strength is measured, not assumed:
  ahead    a team's win% k seasons on, regressed on its latest full-season win%: w = mu + rho_k (w0 - mu) + e
  in season  record so far blended with that prior as (m x prior + wins) / (m + games); m fitted
  The rest of the season is simulated (binomial), every team at once, then the year's lottery is drawn.

Lottery rules (sources in RULES): coin flip 1980-84, equal-odds envelopes 1985-89 (all lottery slots
drawn 1985-86, top three 1987-89), weighted 11..1 of 66 in 1990-93, 1,000 combinations 1994-2018 (the
14-team ladder from Hoops Rumors; for 1994-2004's 11-13 lottery teams the top of that ladder, an
approximation), the 2019-26 ladder with four picks drawn, and the 2027 3-2-1 format as Wikipedia describes
it (every lottery slot drawn, an assumption past what it says).
Approximations, all flagged: playoff and play-in teams are the top 16 records league-wide (conferences
ignored); 1980-84's coin flip is between the two worst records; ties are broken at random.

    python3 lottery.py eval     # how well the slot distribution predicted each team's own first-round slot
"""
import collections, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, os.path.join(HERE, '..'))
from tenures import franchise  # noqa: E402

LADDER_1994 = [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5]
LADDER_2019 = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5]
RULES = {
    'source_history': 'https://en.wikipedia.org/w/index.php?title=NBA_draft_lottery&oldid=1386715810',
    'source_1994_ladder': 'https://www.hoopsrumors.com/2012/04/draft-lottery.html',
    'source_2027': 'https://pr.nba.com/nba-board-of-governors-approves-new-draft-lottery-system-to-address-tanking/',
    'note_2027': 'NBA release, May 28, 2026: three balls for teams outside the playoffs and play-in, the three worst records "draft relegated" to two, '
                 'No. 9 and 10 play-in seeds two, losers of 7 vs 8 one; all 16 drawn; relegated teams no lower than No. 12; no team\'s pick first in two '
                 'consecutive drafts. In effect 2027-2029 (NBA explainer); 2030 on is for a Board of Governors vote, so those years use these rules, flagged.',
}
VERSION = 'lottery-1.0'


def results():
    R = json.load(open(os.path.join(OUT, 'results.json')))
    out = {}
    for s, teams in R.items():
        y = int(s[:4]) + 1
        out[y] = {}
        for ab, games in teams.items():
            f = franchise(ab) if ab != 'CHA' else 'CHO'
            if f:
                out[y][f] = games
    return out


def record(games, as_of=None):
    g = [r[1] for r in games if as_of is None or r[0] < as_of]
    return sum(1 for w in g if w == 'W'), len(g)


def measure(R):
    """rho_k and the noise k seasons ahead; the in-season weight m."""
    years = sorted(R)
    fits = {}
    for k in range(1, 8):
        x, yv = [], []
        for y in years:
            if y + k not in R:
                continue
            for f, g in R[y].items():
                if f in R[y + k]:
                    w0, n0 = record(g); w1, n1 = record(R[y + k][f])
                    if n0 >= 40 and n1 >= 40:
                        x.append(w0 / n0); yv.append(w1 / n1)
        x, yv = np.array(x), np.array(yv)
        rho = np.cov(x, yv)[0, 1] / np.var(x)
        res = yv - (0.5 + rho * (x - 0.5))
        fits[k] = (float(rho), float(res.std()), len(x))
    # in-season: which m makes (m*prior + W)/(m + n) best predict the rest of the season?
    best = None
    for m in (5, 10, 15, 20, 30, 45, 60):
        err = []
        for y in years:
            if y - 1 not in R:
                continue
            for f, g in R[y].items():
                if f not in R[y - 1] or len(g) < 70:
                    continue
                w0, n0 = record(R[y - 1][f]); prior = 0.5 + fits[1][0] * (w0 / n0 - 0.5)
                for cut in (10, 20, 41, 60):
                    W, n = sum(1 for r in g[:cut] if r[1] == 'W'), cut
                    rest = [r[1] for r in g[cut:]]
                    est = (m * prior + W) / (m + n)
                    err.append((est - sum(1 for w in rest if w == 'W') / len(rest)) ** 2)
        e = float(np.mean(err))
        if best is None or e < best[1]:
            best = (m, e)
    return fits, best[0]


def draw_order(order, Y, rng, banned_first=None):
    """order: lottery teams worst first. Returns them in pick order."""
    N = len(order)
    if Y <= 1984:
        top = list(order[:2]); rng.shuffle(top)
        return top + list(order[2:])
    if Y <= 1986:
        o = list(order); rng.shuffle(o); return o
    if Y <= 1989:
        w = np.ones(N); drawn = 3
    elif Y <= 1993:
        w = np.arange(N, 0, -1, dtype=float); drawn = 3
    elif Y <= 2018:
        w = np.array(LADDER_1994[:N], dtype=float); drawn = 3
    elif Y <= 2026:
        w = np.array((LADDER_2019 + [5] * N)[:N], dtype=float); drawn = 4
    else:
        balls = [2, 2, 2] + [3] * 7 + [2] * 4 + [1] * 2
        w = np.array((balls + [1] * N)[:N], dtype=float); drawn = N
    picked, left = [], list(range(N))
    for slot in range(min(drawn, N)):
        if Y >= 2027:
            need = [i for i in left if i < 3]            # the three worst can fall no lower than 12th
            if need and len(picked) >= 12 - len(need):
                i = need[0]; picked.append(i); left.remove(i); continue
        p = w[left] / w[left].sum()
        i = left[rng.choice(len(left), p=p)]
        while Y >= 2027 and slot == 0 and banned_first and order[i] == banned_first and len(left) > 1:
            i = left[rng.choice(len(left), p=p)]     # no team's pick first in two consecutive drafts (NBA release)
        picked.append(i); left.remove(i)
    return [order[i] for i in picked] + [order[i] for i in left]


SCHEDULED = {1999: 50, 2012: 66, 2021: 72}     # lockout and pandemic schedules, announced before each season began
SEASON_END = {1999: '1999-05-06', 2012: '2012-04-27', 2020: '2020-08-15', 2021: '2021-05-17'}   # regular seasons that ran past April


def simulate(R, fits, m, Y, as_of, n=2000, seed=0, teams=None, banned_first=None):
    """Slot distribution of every team's own first-round pick in draft Y, as of a date. Draft years after 2029
    use the 2027-29 rules (the NBA has not set later ones): the result says so (rules_flag)."""
    rng = np.random.default_rng(seed)
    season = R.get(Y)
    teams = teams or sorted(season) if season else sorted(R[max(R)])
    started = [y for y in R if any(d < as_of for f in R[y] for d, *_ in R[y][f][:1])] if as_of else []
    base_y = max(started) if started else Y - 1
    k = max(1, Y - base_y)
    rho, sd, _ = fits[min(k, 7)]
    prior = {}
    for f in teams:
        last = None
        for y in sorted(R, reverse=True):
            if y < Y and f in R[y] and record(R[y][f])[1] >= 40 and R[y][f][-1][0] < as_of:
                w0, n0 = record(R[y][f]); last = (w0 / n0, Y - y); break
        if last:
            r_k, s_k, _ = fits[min(last[1], 7)]
            prior[f] = (0.5 + r_k * (last[0] - 0.5), s_k)
        else:
            prior[f] = (0.5, fits[7][1])
    # The season's length as scheduled, not as many games as the data happens to hold: a season still being played
    # (the current one, or any season seen from a date inside it) would otherwise be simulated as a 15- or 50-game
    # season, and the grade of a 2019 trade would move with how far into 2026 the data ran. Once the regular season's
    # real end has passed, nothing is left to play.
    over = as_of is not None and as_of >= SEASON_END.get(Y, f'{Y}-05-01')
    games = SCHEDULED.get(Y, 82)
    W0, N0 = {}, {}
    for f in teams:
        W0[f], N0[f] = record(season[f], as_of) if season and f in season else (0, 0)
    left_ = {f: 0 if over else max(0, games - N0[f]) for f in teams}
    slots = {f: np.zeros(61) for f in teams}
    for _ in range(n):
        final = {}
        for f in teams:
            mu, s = prior[f]
            if N0[f]:
                mu = (m * mu + W0[f]) / (m + N0[f]); s = s * math.sqrt(m / (m + N0[f]))
            p = float(np.clip(rng.normal(mu, s), 0.05, 0.95))
            final[f] = W0[f] + rng.binomial(left_[f], p) + rng.random() * 1e-3
        order = sorted(teams, key=lambda f: final[f])
        lot = order[:max(0, len(order) - 16)]
        picks = draw_order(lot, Y, rng, banned_first) + order[len(lot):]
        for s_, f in enumerate(picks, 1):
            slots[f][s_] += 1
    return {f: v / n for f, v in slots.items()}


def evaluate():
    R = results()
    fits, m = measure(R)
    W = {int(k): v for k, v in json.load(open(os.path.join(OUT, 'wiki_drafts.json'))).items()}
    rep = [f'{VERSION}. Team strength k seasons ahead (rho, sd of win%, n):'] + [f'   k={k}: rho {r:.2f}, sd {s:.3f}, n {n}' for k, (r, s, n) in fits.items()]
    rep.append(f'In-season prior weight m = {m} games')
    rep.append('\nOwn first-round pick: mean absolute error of the expected slot (actual slot from Wikipedia\'s draft tables), drafts 1990-2026:')
    for label, when in (('a season ahead (Oct 1, a year before)', lambda Y: f'{Y - 2}-10-01'), ('season start (Oct 1)', lambda Y: f'{Y - 1}-10-01'),
                        ('midseason (Feb 1)', lambda Y: f'{Y}-02-01'), ('after the regular season (Apr 30)', lambda Y: f'{Y}-04-30')):
        errs, base, ll = [], [], []
        for Y in range(1990, 2027):
            if Y not in W or Y not in R:
                continue
            own = {}
            for ov, v in W[Y]['picks'].items():
                if v['round'] == 1:
                    o = v['from'] or v['team']
                    if o:
                        own.setdefault(o, int(ov))
            dist = simulate(R, fits, m, Y, when(Y), n=400, seed=Y)
            known = max(y for y in R if R[y] and max(g[-1][0] for g in R[y].values()) < when(Y))     # the latest season complete at the time
            last_rank = {f: i + 1 for i, f in enumerate(sorted(dist, key=lambda f: record(R[known][f])[0] / max(1, record(R[known][f])[1]) if f in R.get(known, {}) else 0.5))}
            for f, s in own.items():
                if f in dist:
                    p = dist[f]
                    exp = float((p * np.arange(len(p))).sum())
                    errs.append(abs(exp - s)); ll.append(math.log(max(p[s], 1e-3)))
                    base.append(abs(last_rank.get(f, 15) - s))
        rep.append(f'   {label:40} MAE {np.mean(errs):5.2f} slots   (latest complete season\'s order as the guess: {np.mean(base):5.2f})   mean log-likelihood {np.mean(ll):6.2f}   n={len(errs)}')
    open(os.path.join(OUT, 'lottery_eval.txt'), 'w').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))
    json.dump({'fits': fits, 'm': m, 'version': VERSION, 'rules': RULES}, open(os.path.join(OUT, 'models', 'lottery.json'), 'w'))


def convey(dist, protected_top=None):
    """P(the pick conveys) for a top-N protection."""
    if not protected_top:
        return 1.0
    return float(dist[protected_top + 1:].sum())


if __name__ == '__main__':
    evaluate()
