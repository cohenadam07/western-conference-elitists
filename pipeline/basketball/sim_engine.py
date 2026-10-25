"""
sim_engine.py — possession-lite game simulation.

Design contract (from the GM-mode plan, section 5):
  * A real possession loop, not a team-strength coin flip.
  * A SIMPLIFIED matchup layer: the five on-court defenders produce a team defensive
    profile rather than each guarding a specific man. ~90% of the realism at ~10% of
    the cost, and it still produces defensible box scores.
  * Variance is CLUSTERED, not uniform white noise — that is what makes runs happen.
  * Seeded RNG throughout, so any game is exactly reproducible from its seed.

Everything the engine consumes is a RAW Savant rate (usage %, 3PA rate, 3P%, TOV%,
OREB%...). Percentiles cannot produce a box score. The skill/archetype layer feeds
adjustments on top, never the base rates.

Usage:
  python sim_engine.py game BOS OKC          # one game, box score
  python sim_engine.py calibrate             # league aggregates vs reality
"""
import json, sys, math, random, collections
from prng import Rng

OUT = "out"
SEASON = None            # set at load: latest season in players.json

# --- league anchors, 2025-26 (from Basketball-Reference team tables) --------------
# The engine is calibrated so that a league-average team against a league-average
# defence reproduces these. They are targets, not inputs to any single possession.
LG = {"pace": 98.5, "ortg": 114.0, "tov": 0.128, "fg3r": 0.425, "ftr": 0.255,
      "orb": 0.265, "fg3": 0.360, "fg2": 0.548, "ft": 0.784}

# calibration constants — set by `calibrate`, not guessed
FG2_CAL, FG3_CAL, TOV_CAL, FTR_CAL, ORB_CAL, AST_CAL = 1.0, 1.0, 1.0, 0.55, 1.25, 0.645
# Steals per turnover and blocks per missed two, scaled by the rates of the five men on the
# floor. Solved so the league averages 7.5 steals and 5.0 blocks a team a game — the same
# way every other constant here is set, and identical to SEED.cal in the browser.
# Loaded from sim_defense.json like the other solved constants — NOT left as module
# defaults. They were, and the browser's SEED.cal was a second hand-maintained copy with
# nothing keeping the two in step, so a recalibration on one side moved the league's steals
# and blocks in the browser and not here. The thirty replay fixtures did not notice because
# they compared points, shots, assists and rebounds and never these two. Both holes are now
# closed: the constant has a file, and the fixtures compare stl and blk.
STL_CAL, BLK_CAL = 0.0730, 0.0225
TEAM_REB = 0.055
# Defensive sensitivity. These are the knobs that decide how much better a good defence
# is than a bad one, and therefore how far apart good and bad TEAMS finish. They are
# solved against the real league's net-rating dispersion, not guessed.
DEF_RIM, DEF_POA, DEF_EVT = 0.16, 0.10, 0.30
HCA = 1.022          # home offensive multiplier; ~2.5 net points, the historical value
GAME_LUCK = 0.012    # sd of a team's per-game shooting luck; solved against margin sd
HOT_UP, HOT_DOWN, HOT_DECAY = 0.030, 0.014, 0.93   # clustered streaks
# Score effects. Real NBA margins are far tighter than independent possessions imply
# (margin sd 13.5 against ~17.4 if the two teams were independent): leaders coast and
# empty the bench, trailing teams score against those bench units. Without this the sim
# blows games open, every favourite runs away, and the standings compress — which is
# exactly what the first season test showed. This is a real basketball effect, not a
# variance fudge, and it is also what produces watchable comebacks.
# Applied only BEYOND a threshold. Applying it from +1 was a mistake that only showed
# up two layers downstream: it fixed margin sd (18.0 -> 13.7) but simultaneously crushed
# team net-rating dispersion from 6.38 to 4.93, because throttling a leading team on
# every possession penalises a good team's ordinary edge, not just its blowouts. Real
# coasting starts when the game is decided, around +15, so the threshold is where the
# mechanism actually lives.
SCORE_EFFECT = 0.010
SCORE_THRESHOLD = 12.0

RATE_KEYS = ["usg", "tp3r", "tp3", "tp2", "ft", "ftr", "tov", "oreb", "dreb",
             "ast", "stlpct", "blkpct", "mpg", "minshare", "avail"]


def load_calibration():
    import os
    g = globals()
    for p, keys in ((f"{OUT}/sim_calibration.json",
                     ("FG2_CAL", "FG3_CAL", "TOV_CAL", "FTR_CAL", "ORB_CAL", "AST_CAL", "TEAM_REB")),
                    (f"{OUT}/sim_defense.json",
                     # SCORE_EFFECT, SCORE_THRESHOLD and GAME_LUCK were missing from this
                     # list, so `tune` persisted values the engine then ignored and the
                     # module defaults silently won. Found by porting to the browser: the
                     # two runtimes disagreed on constants that were supposed to be shared.
                     ("DEF_RIM", "DEF_POA", "DEF_EVT", "HCA",
                      "GAME_LUCK", "SCORE_EFFECT", "SCORE_THRESHOLD",
                      "STL_CAL", "BLK_CAL"))):
        if not os.path.exists(p):
            continue
        c = json.load(open(p))
        for k in keys:
            if k in c:
                g[k] = c[k]


def raw(p, k, dflt=None):
    v = ((p.get("m", {}).get(k) or {}).get("season") or {}).get("v")
    return dflt if v is None else float(v)


# Team-level multipliers (coaching, chemistry). Section 5.6 diagnosed the missing
# variance precisely: real corr(ORtg, DRtg) is -0.650 and the sim's was -0.243, because
# nothing in a roster of independently-rated players makes a team good at BOTH ends at
# once. These are that mechanism. Empty = no coaching layer, the pre-franchise behaviour.
TEAM_MULT = {}


def set_team_multipliers(m):
    globals()["TEAM_MULT"] = m or {}


# Minutes carry over: measured, not assumed. See the note on "load" below.
EXP_LOAD_T, EXP_LOAD_PREV, EXP_LOAD_ONLY = 0.652, 0.248, 1.020


def expected_load(load_t, load_prev):
    if load_prev is None:
        return round(EXP_LOAD_ONLY * load_t, 6)
    return round(EXP_LOAD_T * load_t + EXP_LOAD_PREV * load_prev, 6)


def load_league(season=None):
    global SEASON
    load_calibration()
    data = json.load(open(f"{OUT}/players.json"))["data"]
    SEASON = season or max(data)
    skills = json.load(open(f"{OUT}/skills.json"))["data"].get(SEASON, {})
    pos = json.load(open(f"{OUT}/positions.json"))["data"].get(SEASON, {})
    # The season before, for the minutes carry-over.
    order = sorted(data)
    idx = order.index(SEASON)
    prior = {}
    if idx > 0:
        for q in data[order[idx - 1]]["players"]:
            mq = raw(q, "mpg", 0) or 0
            aq = (raw(q, "avail", 100) or 100) / 100.0
            prior[str(q["id"])] = mq * aq

    teams = collections.defaultdict(list)
    for p in data[SEASON]["players"]:
        t = p.get("team")
        if not t:
            continue
        mp = raw(p, "mpg", 0) or 0
        if mp < 4:
            continue
        pid = str(p["id"])
        sk = skills.get(pid, {}).get("s", {})
        av = (raw(p, "avail", 100) or 100) / 100.0
        teams[t].append({
            "id": pid, "name": p["name"],
            "mpg": mp,
            # Total minutes, not minutes per game played. `mpg` alone treats a 30-mpg
            # player who appeared in five games as a starter, which is how a team full
            # of injury churn ended up simulating like a healthy one — and why the win
            # spread stayed compressed.
            #
            # But last season's total is not this season's expectation either. Used
            # directly it budgeted a star who missed a year six minutes a night in the
            # year AFTER the injury — one lost season treated as a permanent condition.
            # Fitted on 12,914 consecutive player-seasons in this data, next season's
            # minutes are 0.652 x this season's + 0.248 x the season before (R2 0.474
            # against 0.379 for using this season alone); a player with no prior season
            # gets 1.020 x his own. No intercept, deliberately — a three-game call-up
            # must not be handed a rotation spot for having played 36 minutes twice.
            "load": expected_load(mp * av, prior.get(pid)),
            "avail": av,
            "usg":  (raw(p, "usg", 18) or 18) / 100.0,
            "fg3r": (raw(p, "tp3r", 40) or 40) / 100.0,
            "fg3":  (raw(p, "tp3", 35) or 35) / 100.0,
            "fg2":  (raw(p, "tp2", 52) or 52) / 100.0,
            "ft":   (raw(p, "ft", 78) or 78) / 100.0,
            "ftr":  (raw(p, "ftr", 25) or 25) / 100.0,
            "tov":  (raw(p, "tov", 12) or 12) / 100.0,
            "oreb": (raw(p, "oreb", 4) or 4) / 100.0,
            "dreb": (raw(p, "dreb", 15) or 15) / 100.0,
            "ast":  (raw(p, "ast", 12) or 12) / 100.0,
            # defensive profile inputs (0-100 skill percentiles)
            "d_rim":  (sk.get("rim_protection") or {}).get("vs", 50.0),
            "d_poa":  (sk.get("perimeter_def") or {}).get("vs", 50.0),
            "d_evt":  (sk.get("event_creation") or {}).get("vs", 50.0),
            # Real steal and block rates: steals per hundred opponent possessions, and the
            # share of opponent two-point attempts he blocks. The game used to have neither
            # and guessed both from d_evt after the fact.
            "stlr":   raw(p, "stlpct", 1.7) or 1.7,
            "blkr":   raw(p, "blkpct", 1.8) or 1.8,
            "slot":   pos.get(pid, {}).get("slot", 3.0),
        })
    for t in teams:
        for p in teams[t]:
            p["team_key"] = t
        teams[t].sort(key=lambda x: -x["load"])
    return teams


# --------------------------------------------------------------------- rotations

# AVAILABILITY IS A PER-GAME THING, NOT A PER-MINUTE THING.
#
# Mirrors src/lib/gm/sim.js exactly; see the comment there for why. In short: `load` is
# minutes discounted by availability, and sharing the night out by it conflated how often a
# man is fit with how much he plays when he is. A player expected to miss half the year was
# on the floor for sixteen minutes of every game instead of thirty-three minutes of half of
# them, thirteen of thirty clubs had their best player outside their own top three in
# minutes, and one man came out at 42.4 a night.
MIN_DRESSED = 8
GAME_LENGTH = 240
MAX_MINUTES = 38
CAP_PASSES = 3


def availability_of(p):
    """Recovered from the profile: load is mpg times availability."""
    mpg = p.get("mpg") or 0.0
    load = p.get("load") or 0.0
    return max(0.05, min(1.0, load / max(1.0, mpg)))


def draw_order(roster):
    """Canonical order for the availability draws.

    NOT roster order. This loader and the seed file hold the same men in different orders —
    they diverge from the fourth man on Boston — which never mattered while the rotation
    sorted by load, because sorting does not care how the list arrived. The moment a draw is
    spent PER MAN IN SEQUENCE the order decides who gets which number, and the same seed
    dressed two different nines in the two runtimes. Possession counts still matched, which
    is what made it look like a scoring bug rather than an ordering one.
    """
    return sorted(roster, key=lambda p: str(p.get("id", "")))


def dressed(roster, rng):
    """Who is fit tonight.

    ONE DRAW PER MAN, ALWAYS — the count of draws cannot depend on the outcome or the two
    runtimes fall out of step on the very next number.
    """
    fit, out = [], []
    for p in draw_order(roster):
        if rng.rand() < availability_of(p):
            fit.append(p)
        else:
            out.append(p)
    if len(fit) >= MIN_DRESSED:
        return fit
    # Nobody forfeits. Short of eight, the most available of the missing dress anyway —
    # decided without drawing, so the stream stays aligned, and tie-broken on id.
    spare = sorted(out, key=lambda p: (-availability_of(p), str(p.get("id", ""))))
    return fit + spare[: MIN_DRESSED - len(fit)]


def rotation(roster, n=10):
    """The night, shared out by what these men actually play, capped so a thin bench
    cannot hand one man forty-four minutes."""
    # Ties broken on id for the same reason: never leave the answer to how the list arrived.
    pool = sorted(roster, key=lambda p: (-p["mpg"], str(p.get("id", ""))))[:n]
    tot = sum(p["mpg"] for p in pool) or 1.0
    cap = MAX_MINUTES / GAME_LENGTH
    share = [p["mpg"] / tot for p in pool]
    # A fixed number of passes rather than a loop to convergence: it settles in one or two,
    # and a fixed count is the same arithmetic in both runtimes every time.
    for _ in range(CAP_PASSES):
        over = sum(x - cap for x in share if x > cap)
        room = sum(cap - x for x in share if x <= cap)
        if over <= 0 or room <= 0:
            break
        share = [cap if x > cap else x + (over * (cap - x)) / room for x in share]
    for p, x in zip(pool, share):
        p["_share"] = x
    return pool


class Lineup:
    """Deficit-driven rotation.

    Redrawing five players at random every possession — the obvious first cut — is
    structurally wrong twice over: it flattens minutes so a star and a 12th man get the
    same load, and it lets a player defend a possession he was not on the floor for.
    Here each team carries ONE five at a time, and substitutions happen when a player's
    played share drifts from his target share. Minutes come out right by construction.
    """
    def __init__(self, pool, total_poss):
        self.pool = pool
        self.total = max(1, total_poss)
        self.played = {p["id"]: 0.0 for p in pool}
        self.five = sorted(pool, key=lambda p: -p["_share"])[:5]

    def tick(self, i):
        for p in self.five:
            self.played[p["id"]] += 1.0
        # every ~6 possessions, swap the most over-used starter for the most under-used
        if i % 6 or i == 0:
            return self.five
        elapsed = i + 1
        def deficit(p):
            return p["_share"] * 5.0 * elapsed - self.played[p["id"]]
        bench = [p for p in self.pool if p not in self.five]
        if not bench:
            return self.five
        out = min(self.five, key=deficit)
        inn = max(bench, key=deficit)
        if deficit(inn) > deficit(out):
            self.five = [inn if p is out else p for p in self.five]
        return self.five


# ------------------------------------------------------------------ team profile

def def_profile(five):
    """Five defenders -> one team defensive profile (the 'lite' in possession-lite).

    A flat mean, deliberately. The obvious refinement — weight perimeter defence toward
    the WORST defender on the floor (offences hunt him) and rim protection toward the
    BEST — was implemented and measured, and it made every diagnostic worse: correlation
    with real team defence fell 0.696 -> 0.679, with real offence 0.872 -> 0.827, and net
    rating dispersion dropped 5.19 -> 4.59. It sounds like basketball and it is not in
    this data at this resolution. Reverted rather than kept for narrative reasons.
    """
    n = len(five)
    return {
        "rim": sum(p["d_rim"] for p in five) / n,
        "poa": sum(p["d_poa"] for p in five) / n,
        "evt": sum(p["d_evt"] for p in five) / n,
        "dreb": sum(p["dreb"] for p in five) / n,
    }


def _adj(pct, scale):
    """A 0-100 defensive percentile -> a multiplicative adjustment centred on 1.0."""
    return 1.0 + (50.0 - pct) / 50.0 * scale


# ------------------------------------------------------------------- possessions

class Box:
    def __init__(self):
        self.s = collections.defaultdict(lambda: collections.Counter())
    def add(self, pid, k, v=1):
        self.s[pid][k] += v


def _credit(five, key, cal, rng, box, stat):
    """Who took it, or who blocked it.

    EXACTLY ONE DRAW, ALWAYS — never one draw when somebody has a rate and none otherwise.
    The number of times this touches the random stream must not depend on the data, or this
    engine and sim.js drift the moment one of them is missing a rate, and thirty replay
    fixtures start failing for a reason nobody can find. The single draw decides both whether
    it happened and who did it: given that it happened, x is uniform below the threshold, so
    rescaling it picks the man at no further cost.
    """
    x = rng.rand()
    w = [max(0.0, p.get(key) or 0.0) for p in five]
    s = sum(w)
    if s <= 0:
        return None
    p_ev = min(0.9, s * cal)
    if x >= p_ev:
        return None
    y = (x / p_ev) * s
    acc = 0.0
    for pl, wi in zip(five, w):
        acc += wi
        if acc >= y:
            box.add(pl["id"], stat)
            return pl
    box.add(five[-1]["id"], stat)
    return five[-1]


def possession(off5, dfn, rng, hot, box, team_state):
    """One possession. Returns points scored."""
    D = def_profile(dfn)
    # --- who uses it
    w = [p["usg"] for p in off5]
    tot = sum(w) or 1.0
    r, acc = rng.rand() * tot, 0.0
    man = off5[-1]
    for p, wi in zip(off5, w):
        acc += wi
        if acc >= r:
            man = p; break

    pid = man["id"]
    # --- turnover
    tov_p = TOV_CAL * man["tov"] * _adj(D["evt"], -DEF_EVT) * team_state["momentum_tov"]
    if rng.rand() < min(0.35, tov_p):
        box.add(pid, "tov")
        _credit(dfn, "stlr", STL_CAL, rng, box, "stl")
        return 0

    # --- shooting foul / free throws
    if rng.rand() < min(0.45, man["ftr"] * FTR_CAL):
        made = sum(1 for _ in range(2) if rng.rand() < man["ft"])
        box.add(pid, "fta", 2); box.add(pid, "ftm", made); box.add(pid, "pts", made)
        return made

    # --- shot type
    three = rng.rand() < man["fg3r"]
    if three:
        p_make = FG3_CAL * man["fg3"] * _adj(D["poa"], DEF_POA) * hot.get(pid, 1.0) * team_state["momentum_shot"]
        box.add(pid, "fg3a"); box.add(pid, "fga")
        if rng.rand() < max(0.05, min(0.75, p_make)):
            box.add(pid, "fg3m"); box.add(pid, "fgm"); box.add(pid, "pts", 3)
            _assist(off5, man, rng, box)
            hot[pid] = hot.get(pid, 1.0) + HOT_UP
            return 3
        hot[pid] = hot.get(pid, 1.0) - HOT_DOWN
    else:
        p_make = FG2_CAL * man["fg2"] * _adj(D["rim"], DEF_RIM) * hot.get(pid, 1.0) * team_state["momentum_shot"]
        box.add(pid, "fga")
        if rng.rand() < max(0.15, min(0.85, p_make)):
            box.add(pid, "fgm"); box.add(pid, "pts", 2)
            _assist(off5, man, rng, box)
            hot[pid] = hot.get(pid, 1.0) + HOT_UP
            return 2
        # Only twos. Blocked threes happen and they are rare enough that the rate Savant
        # measures — share of opponent TWO-point attempts blocked — is the one to use.
        _credit(dfn, "blkr", BLK_CAL, rng, box, "blk")
        hot[pid] = hot.get(pid, 1.0) - HOT_DOWN

    # --- miss -> rebound. ~10% of misses go out of bounds or are team rebounds and
    # never appear on a player's line; without this the league over-counts boards.
    if rng.rand() < TEAM_REB:
        return 0
    orb_rate = sum(p["oreb"] for p in off5) / 5.0
    drb_rate = D["dreb"]
    p_orb = orb_rate / max(1e-6, orb_rate + drb_rate)
    if rng.rand() < p_orb * ORB_CAL:
        reb = _weighted(off5, "oreb", rng)
        box.add(reb["id"], "oreb"); box.add(reb["id"], "reb")
        if team_state.get("_depth", 0) < 3:
            team_state["_depth"] = team_state.get("_depth", 0) + 1
            pts = possession(off5, dfn, rng, hot, box, team_state)
            team_state["_depth"] -= 1
            return pts
        return 0
    reb = _weighted(dfn, "dreb", rng)
    box.add(reb["id"], "dreb"); box.add(reb["id"], "reb")
    return 0


def _weighted(five, key, rng):
    w = [max(1e-6, p[key]) for p in five]
    r, acc = rng.rand() * sum(w), 0.0
    for p, wi in zip(five, w):
        acc += wi
        if acc >= r:
            return p
    return five[-1]


def _assist(off5, shooter, rng, box):
    cands = [p for p in off5 if p is not shooter]
    if not cands:
        return
    w = [p["ast"] for p in cands]
    if rng.rand() < AST_CAL:
        tot = sum(w) or 1.0
        r, acc = rng.rand() * tot, 0.0
        for p, wi in zip(cands, w):
            acc += wi
            if acc >= r:
                box.add(p["id"], "ast"); return


def win_prob(margin, poss_left, sd_per_poss=1.16):
    """Live win probability for the home team from margin and possessions remaining.

    The swing of this line IS the drama in the animation (section 14) — a run is visible
    as the line moving, not as a number changing. Normal approximation on the remaining
    possessions, which is accurate enough well inside a game and exact enough at the end.
    """
    if poss_left <= 0:
        return 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
    sd = sd_per_poss * math.sqrt(2 * poss_left)
    z = margin / max(1e-6, sd)
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def simulate(home_roster, away_roster, seed=0, trace=False):
    # Rng, not random.Random: the browser has to reproduce this exactly (see prng.py).
    rng = Rng(seed)
    # Home first, then away, every man drawn for exactly once. Both runtimes do this in
    # this order before any other number is taken.
    H = rotation(dressed(home_roster, rng))
    A = rotation(dressed(away_roster, rng))
    box = Box()
    score = {"home": 0, "away": 0}
    # game-level shooting luck: each team draws one, which is why some nights are cold
    hm = TEAM_MULT.get(home_roster[0].get("team_key")) if home_roster else None
    am = TEAM_MULT.get(away_roster[0].get("team_key")) if away_roster else None
    luck = {"home": rng.gauss(1.0, GAME_LUCK), "away": rng.gauss(1.0, GAME_LUCK)}
    hot = {}
    n_poss = int(round(rng.gauss(LG["pace"], 4.0)))
    off_m = {"home": (hm or {}).get("off", 1.0), "away": (am or {}).get("off", 1.0)}
    def_m = {"home": (am or {}).get("def", 1.0), "away": (hm or {}).get("def", 1.0)}
    state = {s: {"momentum_shot": luck[s] * (HCA if s == "home" else 1.0)
                 * off_m[s] * def_m[s],
                 "momentum_tov": 1.0} for s in ("home", "away")}

    LH, LA = Lineup(H, n_poss), Lineup(A, n_poss)
    tr = [] if trace else None
    for i in range(n_poss):
        h5, a5 = LH.tick(i), LA.tick(i)
        for side, o5, d5 in (("home", h5, a5), ("away", a5, h5)):
            lead = score[side] - score["away" if side == "home" else "home"]
            st_ = state[side]
            sv = st_["momentum_shot"]
            over = 0.0
            if lead > SCORE_THRESHOLD:
                over = min(28.0, lead - SCORE_THRESHOLD)
            elif lead < -SCORE_THRESHOLD:
                over = max(-28.0, lead + SCORE_THRESHOLD)
            st_["momentum_shot"] = sv * (1.0 - SCORE_EFFECT * over)
            pts = possession(o5, d5, rng, hot, box, st_)
            st_["momentum_shot"] = sv
            score[side] += pts
            # A make nudges the shooter hot, a miss cools him, both decay back. Uniform
            # white noise makes every game feel the same; this is what makes runs.
            for p in o5:
                h = hot.get(p["id"], 1.0)
                if h != 1.0:
                    hot[p["id"]] = 1.0 + (h - 1.0) * HOT_DECAY
            base = (luck[side] * (HCA if side == "home" else 1.0)
                    * off_m[side] * def_m[side])
            state[side]["momentum_shot"] = base + (state[side]["momentum_shot"] - base) * 0.98
        if tr is not None:
            m = score["home"] - score["away"]
            tr.append({"p": i + 1, "h": score["home"], "a": score["away"],
                       "wp": round(win_prob(m, n_poss - i - 1), 4),
                       "q": min(4, i * 4 // n_poss + 1)})
    # Overtime. Without it a tie is resolved by whichever comparison happens to be
    # written first, and the box score shows a 113-113 loss — which is not a thing.
    ot = 0
    while score["home"] == score["away"] and ot < 6:
        ot += 1
        for j in range(5):
            i = n_poss + (ot - 1) * 5 + j
            h5, a5 = LH.tick(i), LA.tick(i)
            for side, o5, d5 in (("home", h5, a5), ("away", a5, h5)):
                score[side] += possession(o5, d5, rng, hot, box, state[side])
            if tr is not None:
                tr.append({"p": i + 1, "h": score["home"], "a": score["away"],
                           "wp": 0.5, "q": 4 + ot})
        n_poss += 5
    if trace:
        return score, box, n_poss, tr
    return score, box, n_poss


def _fmt_box(box, roster, limit=9):
    rows = []
    for p in roster[:limit]:
        s = box.s.get(p["id"])
        if not s:
            continue
        rows.append((p["name"], s["pts"], s["fgm"], s["fga"], s["fg3m"], s["fg3a"],
                     s["ftm"], s["fta"], s["reb"], s["ast"], s["tov"]))
    return rows


def cmd_game(argv):
    teams = load_league()
    h, a = (argv + ["BOS", "OKC"])[:2]
    seed = int(argv[2]) if len(argv) > 2 else 1
    score, box, np_ = simulate(teams[h], teams[a], seed)
    print(f"{SEASON}   {a} {score['away']}  @  {h} {score['home']}   ({np_} possessions)\n")
    for name, roster in ((h, teams[h]), (a, teams[a])):
        print(f"{name:26}{'PTS':>4}{'FG':>8}{'3P':>8}{'FT':>8}{'REB':>5}{'AST':>5}{'TO':>4}")
        for r in _fmt_box(box, roster):
            print(f"  {r[0][:24]:24}{r[1]:4d}{r[2]:4d}-{r[3]:<3d}{r[4]:4d}-{r[5]:<3d}"
                  f"{r[6]:4d}-{r[7]:<3d}{r[8]:5d}{r[9]:5d}{r[10]:4d}")
        print()



# ------------------------------------------------------------------- calibration

def league_run(teams, n_games=240, seed=11):
    """Round-robin sample -> league aggregate rates per team-game."""
    import itertools
    rng = random.Random(seed)
    names = sorted(teams)
    agg = collections.Counter()
    games = 0
    pairs = [(h, a) for h, a in itertools.permutations(names, 2)]
    rng.shuffle(pairs)
    for h, a in pairs[:n_games]:
        score, box, npos = simulate(teams[h], teams[a], rng.randrange(10**6))
        for k in ("pts", "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "tov",
                  "oreb", "dreb", "reb", "ast"):
            agg[k] += sum(v[k] for v in box.s.values())
        agg["poss"] += npos * 2
        games += 2
    return agg, games


def report(agg, games):
    poss = agg["poss"]
    r = {
        "pace":  poss / games,
        "ortg":  100.0 * agg["pts"] / poss,
        "tov":   agg["tov"] / poss,
        "fg3r":  agg["fg3a"] / max(1, agg["fga"]),
        "ftr":   agg["fta"] / max(1, agg["fga"]),
        "orb":   agg["oreb"] / max(1, agg["oreb"] + agg["dreb"]),
        "fg3":   agg["fg3m"] / max(1, agg["fg3a"]),
        "fg2":   (agg["fgm"] - agg["fg3m"]) / max(1, agg["fga"] - agg["fg3a"]),
        "ft":    agg["ftm"] / max(1, agg["fta"]),
        "reb_g": agg["reb"] / games,
        "ast_g": agg["ast"] / games,
    }
    return r


def cmd_calibrate():
    global FG2_CAL, FG3_CAL, TOV_CAL, FTR_CAL, ORB_CAL, AST_CAL, TEAM_REB
    teams = load_league()
    print(f"{SEASON}  calibrating against Basketball-Reference league rates\n")
    trail = []
    for it in range(8):
        agg, games = league_run(teams, n_games=200, seed=11 + it)
        r = report(agg, games)
        if it == 0:
            print(f"{'':10}{'sim':>9}{'target':>9}")
            for k in ("pace", "ortg", "tov", "fg3r", "ftr", "orb", "fg3", "fg2", "ft"):
                print(f"  {k:8}{r[k]:9.3f}{LG[k]:9.3f}")
            print(f"  {'reb/g':8}{r['reb_g']:9.1f}{43.5:9.1f}")
            print(f"  {'ast/g':8}{r['ast_g']:9.1f}{26.5:9.1f}\n  --- solving ---")
        # proportional corrections, damped
        FG2_CAL *= (LG["fg2"] / r["fg2"]) ** 0.7
        FG3_CAL *= (LG["fg3"] / r["fg3"]) ** 0.7
        TOV_CAL *= (LG["tov"] / r["tov"]) ** 0.7
        FTR_CAL *= (LG["ftr"] / r["ftr"]) ** 0.7
        ORB_CAL *= (LG["orb"] / r["orb"]) ** 0.7
        AST_CAL = min(0.95, AST_CAL * (26.5 / max(1e-6, r["ast_g"])) ** 0.7)
        TEAM_REB = max(0.0, min(0.25, 1 - (1 - TEAM_REB) * (43.5 / max(1e-6, r["reb_g"])) ** 0.7))
        _push(FG2_CAL, FG3_CAL, TOV_CAL, FTR_CAL, ORB_CAL, AST_CAL, TEAM_REB)
        trail.append((FG2_CAL, FG3_CAL, TOV_CAL, FTR_CAL, ORB_CAL, AST_CAL, TEAM_REB))
        print(f"  iter {it+1}: fg2 {FG2_CAL:.3f} fg3 {FG3_CAL:.3f} tov {TOV_CAL:.3f} "
              f"ftr {FTR_CAL:.3f} orb {ORB_CAL:.3f} ast {AST_CAL:.3f} treb {TEAM_REB:.3f}"
              f"   ortg {r['ortg']:.1f}")

    # THE ANSWER IS THE CONVERGED TAIL, NOT THE LAST DRAW.
    #
    # Each iteration measures a 200-game sample, so every correction carries sampling noise.
    # Taking the final iteration's values means adopting whichever way the last sample happened
    # to fall. Mostly harmless — fg2 and fg3 wander by a few tenths of a per cent — but TEAM_REB
    # ranged 0.043 to 0.062 across one run's eight iterations, and the last draw was the bottom
    # of that range: a 17% change to a solved constant, from noise. Averaging the second half
    # keeps the convergence and drops the wobble.
    tail = trail[len(trail) // 2:]
    avg = [sum(v[i] for v in tail) / len(tail) for i in range(7)]
    _push(*avg)
    FG2_CAL, FG3_CAL, TOV_CAL, FTR_CAL, ORB_CAL, AST_CAL, TEAM_REB = avg
    print(f"\n  averaged over the last {len(tail)}: fg2 {FG2_CAL:.3f} fg3 {FG3_CAL:.3f} "
          f"tov {TOV_CAL:.3f} ftr {FTR_CAL:.3f} orb {ORB_CAL:.3f} ast {AST_CAL:.3f} "
          f"treb {TEAM_REB:.3f}")

    agg, games = league_run(teams, n_games=300, seed=99)
    r = report(agg, games)
    print(f"\nFINAL   {'sim':>9}{'target':>9}{'error':>9}")
    for k in ("pace", "ortg", "tov", "fg3r", "ftr", "orb", "fg3", "fg2", "ft"):
        e = (r[k] - LG[k]) / LG[k]
        print(f"  {k:8}{r[k]:9.3f}{LG[k]:9.3f}{e:+9.1%}")
    print(f"  {'reb/g':8}{r['reb_g']:9.1f}{43.5:9.1f}")
    print(f"  {'ast/g':8}{r['ast_g']:9.1f}{26.5:9.1f}")
    json.dump({"FG2_CAL": FG2_CAL, "FG3_CAL": FG3_CAL, "TOV_CAL": TOV_CAL,
               "FTR_CAL": FTR_CAL, "ORB_CAL": ORB_CAL, "AST_CAL": AST_CAL,
               "TEAM_REB": TEAM_REB,
               "season": SEASON, "targets": LG},
              open(f"{OUT}/sim_calibration.json", "w"), indent=1)
    print(f"\nwrote {OUT}/sim_calibration.json")


def _push(a, b, c, d, e, f, t):
    g = globals()
    (g["FG2_CAL"], g["FG3_CAL"], g["TOV_CAL"], g["FTR_CAL"],
     g["ORB_CAL"], g["AST_CAL"], g["TEAM_REB"]) = a, b, c, d, e, f, t



# ------------------------------------------------------------------- season test

def cmd_season():
    """Sim a full 82-game season and check the SPREAD of win totals, not just the mean.

    This is the test the plan calls non-negotiable. A sim whose team wins cluster more
    tightly than the real league has too little variance — every favourite converges to
    its rating and upsets stop happening. Too wide and the model is noise.
    """
    import statistics as st
    teams = load_league()
    names = sorted(teams)
    real = {r["team"]: r for r in
            [dict(t, team=None) for t in []]}          # filled below
    tf = json.load(open(f"{OUT}/team_features.json"))
    real = {r["team"]: r for r in tf if r["season"] == SEASON}

    rng = random.Random(2026)
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    tally = collections.defaultdict(list)
    for rep in range(reps):
        wins = collections.Counter()
        # 82 games: each team plays every other ~2.83 times; approximate with a
        # balanced double round robin (58) plus 24 random extra games.
        sched = []
        for i, h in enumerate(names):
            for a in names:
                if h != a:
                    sched.append((h, a))
        rng.shuffle(sched)
        sched = sched[:int(30 * 82 / 2)]
        for h, a in sched:
            sc, _, _ = simulate(teams[h], teams[a], rng.randrange(10 ** 7))
            if sc["home"] >= sc["away"]:
                wins[h] += 1
            else:
                wins[a] += 1
        for t in names:
            tally[t].append(wins[t])

    # Spread must be measured WITHIN a season, not across rep-averaged wins. Averaging
    # reps removes luck, and the real 13.61 is one season's observed spread WITH luck in
    # it. Comparing an averaged sim to a single real season understates the sim every
    # time — it is the same mistake as measuring dispersion on too few games.
    per_rep_sd = []
    for i in range(reps):
        w = [tally[t][i] for t in names if t in real]
        gpi = 82.0 / max(1e-9, (2 * len(sched) / len(names)))
        per_rep_sd.append(st.pstdev([x * gpi for x in w]))

    sim_w = {t: sum(v) / len(v) for t, v in tally.items()}
    # scale to an 82-game season
    gp = {t: sum(1 for h, a in sched if h == t or a == t) for t in names}
    sim82 = {t: sim_w[t] * 82.0 / max(1, gp[t]) for t in names}
    have = [t for t in names if t in real and real[t].get("wins")]
    rw = [real[t]["wins"] for t in have]
    sw = [sim82[t] for t in have]

    print(f"{SEASON}   simulated season ({reps} reps)\n")
    print(f"{'team':6}{'sim W':>8}{'real W':>8}{'diff':>7}")
    for t in sorted(have, key=lambda x: -sim82[x]):
        print(f"  {t:4}{sim82[t]:8.1f}{real[t]['wins']:8.0f}{sim82[t]-real[t]['wins']:+7.1f}")
    mae = sum(abs(a - b) for a, b in zip(sw, rw)) / len(rw)
    corr = st.correlation(sw, rw) if len(rw) > 2 else float("nan")
    print(f"\n  sim  win spread (sd): {sum(per_rep_sd)/len(per_rep_sd):5.2f}"
          f"   (single season, luck included — the like-for-like number)")
    print(f"  sim  talent spread  : {st.pstdev(sw):5.2f}   (rep-averaged, luck removed)")
    print(f"  real win spread (sd): {st.pstdev(rw):5.2f}   <- the number that matters")
    print(f"  mean absolute error : {mae:5.2f} wins")
    print(f"  correlation         : {corr:5.3f}")



def cmd_spread():
    """How far apart do teams finish, and is that the real distance?"""
    import statistics as st, itertools
    teams = load_league()
    names = sorted(teams)
    rng = random.Random(5)
    pf = collections.Counter(); pa = collections.Counter(); pos = collections.Counter()
    for h, a in itertools.permutations(names, 2):
        sc, _, n = simulate(teams[h], teams[a], rng.randrange(10**7))
        pf[h] += sc["home"]; pa[h] += sc["away"]
        pf[a] += sc["away"]; pa[a] += sc["home"]
        pos[h] += n; pos[a] += n
    ortg = {t: 100 * pf[t] / pos[t] for t in names}
    drtg = {t: 100 * pa[t] / pos[t] for t in names}
    net  = {t: ortg[t] - drtg[t] for t in names}
    tf = [r for r in json.load(open(f"{OUT}/team_features.json")) if r["season"] == SEASON]
    r_o = [r["off_rtg"] for r in tf]; r_d = [r["def_rtg"] for r in tf]
    r_n = [r["net_rtg"] for r in tf]
    print(f"{SEASON}  dispersion (standard deviation across the 30 teams)\n")
    print(f"{'':12}{'sim':>8}{'real':>8}")
    print(f"  {'ORtg':10}{st.pstdev(list(ortg.values())):8.2f}{st.pstdev(r_o):8.2f}")
    print(f"  {'DRtg':10}{st.pstdev(list(drtg.values())):8.2f}{st.pstdev(r_d):8.2f}")
    print(f"  {'Net':10}{st.pstdev(list(net.values())):8.2f}{st.pstdev(r_n):8.2f}   <- the gap to close")
    real = {r["team"]: r["net_rtg"] for r in tf}
    have = [t for t in names if t in real]
    print(f"\n  correlation with real net rating: "
          f"{st.correlation([net[t] for t in have], [real[t] for t in have]):.3f}")



def _drtg_sd(teams, names, rng, per_team=84):
    """Dispersion of team defensive rating, measured over the SAME number of games a
    real team plays.

    Measuring it over a 420-game sample (28 games a team) was a mistake: the observed
    spread is true spread plus sampling noise, and at 28 games the noise term alone
    faked the entire gap — it read 3.48 against a target of 3.44 while the full
    round-robin read 2.51. Matching the real 82-game sample size makes the two numbers
    comparable instead of flattering the sim.
    """
    import statistics as st, itertools
    pairs = list(itertools.permutations(names, 2))
    need = int(len(names) * per_team / 2)
    while len(pairs) < need:
        pairs += list(itertools.permutations(names, 2))
    rng.shuffle(pairs)
    pa = collections.Counter(); pos = collections.Counter()
    for h, a in pairs[:need]:
        sc, _, np_ = simulate(teams[h], teams[a], rng.randrange(10**7))
        pa[h] += sc["away"]; pa[a] += sc["home"]
        pos[h] += np_; pos[a] += np_
    return st.pstdev([100 * pa[t] / pos[t] for t in names if pos[t]])


def cmd_tune():
    """Solve defensive sensitivity so team DEFENCES differ as much as real ones do.

    The first season test produced a win spread of 8.8 against the league's real 13.6 —
    the classic too-little-variance failure. The cause was not the noise model: offence
    already dispersed correctly (ORtg sd 3.53 vs 3.31). Defence was flat (2.51 vs 3.44),
    so every team defended about the same and the standings compressed toward .500.
    """
    global DEF_RIM, DEF_POA, DEF_EVT
    import statistics as st
    teams = load_league(); names = sorted(teams)
    tf = [r for r in json.load(open(f"{OUT}/team_features.json")) if r["season"] == SEASON]
    target = st.pstdev([r["def_rtg"] for r in tf])
    rng = random.Random(5)
    print(f"target DRtg dispersion: {target:.2f}\n")
    for it in range(4):
        sd = _drtg_sd(teams, names, rng)
        k = (target / max(0.1, sd)) ** 0.8
        print(f"  iter {it}: sim DRtg sd {sd:5.2f}   scale x{k:.3f}   "
              f"(rim {DEF_RIM:.3f} poa {DEF_POA:.3f} evt {DEF_EVT:.3f})")
        if abs(sd - target) < 0.06:
            break
        g = globals()
        g["DEF_RIM"] = min(0.60, DEF_RIM * k)
        g["DEF_POA"] = min(0.60, DEF_POA * k)
        g["DEF_EVT"] = min(0.90, DEF_EVT * k)
    json.dump({"DEF_RIM": DEF_RIM, "DEF_POA": DEF_POA, "DEF_EVT": DEF_EVT, "HCA": HCA,
               "GAME_LUCK": GAME_LUCK, "SCORE_EFFECT": SCORE_EFFECT,
               "SCORE_THRESHOLD": SCORE_THRESHOLD},
              open(f"{OUT}/sim_defense.json", "w"), indent=1)
    print(f"\nwrote {OUT}/sim_defense.json")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "game"
    {"game": lambda: cmd_game(sys.argv[2:]), "calibrate": cmd_calibrate, "season": cmd_season, "spread": cmd_spread, "tune": cmd_tune}[cmd]()
