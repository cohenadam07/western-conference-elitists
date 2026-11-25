"""
consensus.py — draft picks graded against the consensus board (boards.py), not the slot.

At each pick, the best available is the highest consensus-ranked player not yet chosen. For a pick:
  as it turned out   the chosen player's outcome minus the best available's (ten seasons, 5% a year, any team: the
                     outcome a drafting grade has always used)
  at the time        EV(chosen's consensus rank) - EV(best available's rank): a reach is a small minus, the best
                     available is zero. EV is a curve by consensus rank fit only on earlier board drafts, each earlier
                     player valued as he could be on this draft day (seasons played so far plus the projection as of
                     the day). With fewer than two earlier board drafts the slot curve stands in.
  easy picks         taking the best available is credited what an average GM gave up in the same spot: how often GMs
                     deviated in comparable spots (pick range, how split the boards were) x the typical cost of their
                     deviations, both fit only on earlier board drafts.
Drafts without two boards keep the slot grade.
"""
import collections, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BOARDS = json.load(open(os.path.join(OUT, 'boards.json'))) if os.path.exists(os.path.join(OUT, 'boards.json')) else {}
PICK_BUCKETS = ((1, 1), (2, 3), (4, 10), (11, 20), (21, 30), (31, 45), (46, 60))


def bucket(ov):
    return next(i for i, (a, b) in enumerate(PICK_BUCKETS) if a <= ov <= b) if ov <= 60 else len(PICK_BUCKETS) - 1


def split_of(board, bpa, available):
    """How split the boards were at this pick: the share of boards that rank some other still-available player above
    the consensus best available (0 = unanimous)."""
    srcs = board['n_sources']
    if not bpa:
        return 0.0
    r = {c['br']: c['ranks'] for c in board['consensus']}
    others = sum(1 for i in range(srcs) if any(r[b][i] < r[bpa][i] for b in available if b != bpa and b in r))
    return others / srcs


def split_bucket(s):
    return 0 if s == 0 else 1 if s < 0.5 else 2


class Grader:
    def __init__(self, G):
        self.G = G                       # grade.py: career_total, pv, VAL, slot_seasons, vid lookups
        self.cache = {}

    # ---- outcomes
    def outcome(self, br, Y):
        """Ten seasons from the season after the draft, 5% a year, any team (as the drafting grade always has)."""
        G = self.G
        aid = f'player:{br}'
        return G.career_total(G.vid_of(aid), Y + 1, proj_id=G.pid_of(aid))

    def known_value(self, br, Y_then, day):
        """An earlier draftee's ten-season value as it could be known on `day`: seasons played before it, plus the
        projection as of it for the rest."""
        G = self.G
        aid = f'player:{br}'
        vid = G.vid_of(aid)
        y_day = G.season_of(day)
        tot = 0.0
        for y in range(Y_then + 1, min(Y_then + 1 + G.HORIZON, y_day)):
            tot += (G.VAL.get((vid, y)) or 0.0) * G.w(y, Y_then + 1)
        seasons, _, _ = G.pv(aid, day)
        tot += sum(v * G.w(y, Y_then + 1) for y, v in seasons.items() if max(y_day, Y_then + 1) <= y < Y_then + 1 + G.HORIZON)
        return tot

    # ---- the board at each pick
    def walk(self, Y, picks):
        """[(pick, chosen br, chosen rank, best available br, its rank, split, available set)] for a board draft."""
        b = BOARDS.get(str(Y))
        if not b or b['n_sources'] < 2:
            return None
        rank = {c['br']: c['rank'] for c in b['consensus']}
        mean = {c['br']: c['mean_rank'] for c in b['consensus']}
        worst = len(rank) + 1
        chosen = set()
        out = []
        for rnd, ov, team, br, name in sorted(picks, key=lambda p: p[1]):
            if not br or ov > 60:
                continue
            avail = [x for x in rank if x not in chosen]
            bpa = min(avail, key=lambda x: rank[x]) if avail else None
            if bpa and br in mean and mean[br] == mean[bpa]:
                bpa = br                      # tied with the best available on the boards' mean rank: he is co-best
            out.append((ov, br, rank.get(br, worst), bpa, rank.get(bpa, worst) if bpa else worst, split_of(b, bpa, avail), team))
            chosen.add(br)
        return out

    # ---- the expected-value curve by consensus rank, fit on earlier board drafts as known on this day
    def ev_curve(self, Y, day, D):
        key = ('ev', Y)
        if key in self.cache:
            return self.cache[key]
        pts = []
        for y2 in sorted(int(k) for k in BOARDS if int(k) < Y and BOARDS[k]['n_sources'] >= 2):
            for ov, br, r, *_ in self.walk(y2, D[y2]['picks']) or []:
                pts.append((r, self.known_value(br, y2, day)))
        if len(pts) < 100:
            self.cache[key] = None        # fewer than two earlier board drafts: the slot curve stands in
            return None
        # EV(r) = a + b log r, least squares
        xs = [math.log(r) for r, v in pts]; ys = [v for r, v in pts]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        bb = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / max(1e-9, sum((x - mx) ** 2 for x in xs))
        aa = my - bb * mx
        self.cache[key] = (aa, bb, len(pts))
        return self.cache[key]

    def ev(self, Y, day, D, r):
        c = self.ev_curve(Y, day, D)
        if c:
            return c[0] + c[1] * math.log(r)
        G = self.G                          # stand-in: the slot curve as of the draft, rank as if slot
        return sum(v * G.w(y, Y + 1) for y, v in G.slot_seasons(Y, min(max(1, r), 60), day))

    # ---- deviation rates and costs by spot, fit on earlier board drafts
    def spots(self, Y, day, D):
        key = ('spots', Y)
        if key in self.cache:
            return self.cache[key]
        cells = collections.defaultdict(lambda: {'n': 0, 'dev': 0, 'cost_ev': 0.0, 'cost_to': 0.0})
        for y2 in sorted(int(k) for k in BOARDS if int(k) < Y and BOARDS[k]['n_sources'] >= 2):
            for ov, br, r, bpa, rb, sp, team in self.walk(y2, D[y2]['picks']) or []:
                for k in self.keys(ov, sp):
                    c = cells[k]
                    c['n'] += 1
                    if br != bpa:
                        c['dev'] += 1
                        c['cost_ev'] += self.ev(y2, D[y2]['date'], D, rb) - self.ev(y2, D[y2]['date'], D, r)
                        c['cost_to'] += self.outcome(bpa, y2) - self.outcome(br, y2)      # as it turned out: hindsight on earlier drafts
        self.cache[key] = cells
        return cells

    @staticmethod
    def keys(ov, sp):
        """The spot (pick range, how split the boards were) and its parent (the pick range alone)."""
        return (bucket(ov), split_bucket(sp)), (bucket(ov), None)

    @staticmethod
    def rate_in(cells, ov, sp, k):
        """Deviation rate in this spot, shrunk toward the pick range's rate with prior weight k (k = 0: the spot alone)."""
        c, p = (cells.get(x) for x in Grader.keys(ov, sp))
        if not p or not p['n']:
            return None, None, 0
        pr = p['dev'] / p['n']
        if not c or not c['n']:
            return pr, p, p['n']
        return (c['dev'] + k * pr) / (c['n'] + k), (c if c['dev'] >= 2 else p), c['n']

    PRIORS = (0, 1, 2, 4, 8, 16, 32, 64)

    def prior(self, Y, day, D, b):
        """The prior weight that best predicted deviations (Brier score) at this pick range in earlier board drafts,
        each predicted from the drafts before it: measured within the range (the boards' split matters at the top of
        a draft and little after it), and only on drafts before Y."""
        key = ('prior', Y, b)
        if key in self.cache:
            return self.cache[key]
        err = {k: 0.0 for k in self.PRIORS}
        n = 0
        for y2 in sorted(int(k) for k in BOARDS if int(k) < Y and BOARDS[k]['n_sources'] >= 2):
            cells = self.spots(y2, D[y2]['date'], D)
            for ov, br, r, bpa, rb, sp, team in self.walk(y2, D[y2]['picks']) or []:
                if bucket(ov) != b:
                    continue
                qs = [self.rate_in(cells, ov, sp, k)[0] for k in self.PRIORS]
                if qs[0] is None:
                    continue
                for k, q in zip(self.PRIORS, qs):
                    err[k] += (q - (br != bpa)) ** 2
                n += 1
        best = min(self.PRIORS, key=lambda k: (err[k], k)) if n else max(self.PRIORS)
        self.cache[key] = (best, n)
        return self.cache[key]

    def easy_credit(self, Y, day, D, ov, sp):
        """(at the time, as it turned out, rate, n, prior): what an average GM gave up in this spot by not taking the
        best available: the deviation rate x the mean cost of the deviations (the spot's own, once it has two, else
        the pick range's)."""
        cells = self.spots(Y, day, D)
        k, _ = self.prior(Y, day, D, bucket(ov))
        rate, c, n = self.rate_in(cells, ov, sp, k)
        if rate is None or not c['dev']:
            return 0.0, 0.0, 0.0, n, k
        return rate * c['cost_ev'] / c['dev'], rate * c['cost_to'] / c['dev'], rate, n, k

    def name(self, br, Y, D):
        return next((nm for rnd, ov, team, b, nm in D[Y]['picks'] if b == br), br)

    # ---- one draft
    def grade(self, Y, D):
        day = D[Y]['date']
        w = self.walk(Y, D[Y]['picks'])
        if not w:
            return {}
        stand_in = self.ev_curve(Y, day, D) is None
        out = {}
        for ov, br, r, bpa, rb, sp, team in w:
            co, bo = self.outcome(br, Y), self.outcome(bpa, Y) if bpa else 0.0
            if br == bpa:
                at, to, rate, n, k = self.easy_credit(Y, day, D, ov, sp)
                note = (f'took the consensus best available (rank {r}); credited what an average GM gave up in this spot: '
                        f'GMs deviated {rate:.0%} of the time in comparable spots ({n} earlier picks)' if n else
                        f'took the consensus best available (rank {r}); no earlier board drafts to measure an average GM against, so zero')
            else:
                at = self.ev(Y, day, D, r) - self.ev(Y, day, D, rb)
                to = co - bo
                note = f'consensus rank {r}; the best available was rank {rb}'
            out[ov] = {'grade_basis': 'consensus', 'consensus_rank': r, 'best_available': bpa, 'best_available_rank': rb,
                       'boards_split': round(sp, 2), 'at_time': at, 'turned_out': to, 'board_note': note, 'easy': br == bpa,
                       'chosen_outcome': co, 'bpa_outcome': bo,
                       'ev_curve': 'slot curve stands in (fewer than two earlier board drafts)' if stand_in else 'consensus-rank curve, earlier board drafts'}
        return out
