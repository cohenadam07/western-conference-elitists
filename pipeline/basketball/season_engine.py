"""
season_engine.py — real NBA season structure on top of sim_engine.

The sim engine's remaining error was never the game model (margin sd, home edge and
net-rating dispersion all matched reality); it was that a season of random pairings is
not an NBA season. The real schedule is conference- and division-weighted, and that
imbalance is part of why real standings spread as far as they do.

The actual 82-game formula:
    16  4 games vs each of 4 division opponents
    24  4 games vs 6 of the 10 other conference teams
    12  3 games vs the remaining 4 conference teams
    30  2 games vs all 15 teams in the other conference
    --
    82

Assigning which conference opponents get 4 and which get 3 has to be SYMMETRIC (if A
plays B four times, B plays A four times) and has to leave every team with exactly six
4-game opponents. Using position-within-division p and the rule
    4 games  <=>  (p_i - p_j) mod 5 in {0, 1, 4}
does both: the set {0,1,4} is closed under negation mod 5, so the relation is symmetric,
and it selects 3 of the 5 positions in each of the 2 other divisions = 6 opponents.

Usage:
  python season_engine.py schedule      # verify the schedule is a legal NBA schedule
  python season_engine.py season        # one full season + play-in + playoffs
  python season_engine.py validate      # win-spread test against the real league
"""
import json, sys, random, collections, statistics as st
from prng import Rng
import sim_engine as SE

OUT = "out"

DIVISIONS = {
    "East": {"Atlantic":  ["BOS", "BKN", "NYK", "PHI", "TOR"],
             "Central":   ["CHI", "CLE", "DET", "IND", "MIL"],
             "Southeast": ["ATL", "CHA", "MIA", "ORL", "WAS"]},
    "West": {"Northwest": ["DEN", "MIN", "OKC", "POR", "UTA"],
             "Pacific":   ["GSW", "LAC", "LAL", "PHX", "SAC"],
             "Southwest": ["DAL", "HOU", "MEM", "NOP", "SAS"]},
}

CONF, DIV, POS = {}, {}, {}
for c, divs in DIVISIONS.items():
    for d, ts in divs.items():
        for i, t in enumerate(ts):
            CONF[t], DIV[t], POS[t] = c, d, i
TEAMS = sorted(CONF)


def _three_game_hosts():
    """Who hosts the extra game in each 3-game series.

    Every team has four 3-game opponents and needs exactly two of them at 2-1 home to
    reach 41 home games. That is an orientation of a 4-regular graph with out-degree 2
    at every vertex — i.e. an Eulerian orientation. Splitting by a hash instead leaves
    teams at 39-43 home games, which quietly hands some teams extra home court.
    """
    hosts = {}
    for c in ("East", "West"):
        adj = collections.defaultdict(list)
        for i, a in enumerate(TEAMS):
            if CONF[a] != c:
                continue
            for b in TEAMS[i + 1:]:
                if CONF[b] != c or DIV[a] == DIV[b]:
                    continue
                if (POS[a] - POS[b]) % 5 not in (0, 1, 4):
                    adj[a].append(b); adj[b].append(a)
        # Hierholzer: every vertex has even degree (4), so an Eulerian circuit exists.
        used = set()
        start = next(iter(adj))
        stack, circuit = [start], []
        while stack:
            v = stack[-1]
            nxt = None
            for u in adj[v]:
                e = frozenset((v, u))
                if e not in used:
                    nxt = u; used.add(e); break
            if nxt is None:
                circuit.append(stack.pop())
            else:
                stack.append(nxt)
        circuit.reverse()
        for x, y in zip(circuit, circuit[1:]):
            hosts[frozenset((x, y))] = x        # orient along the circuit
    return hosts


THREE_HOSTS = None


def build_schedule(seed=0):
    global THREE_HOSTS
    if THREE_HOSTS is None:
        THREE_HOSTS = _three_game_hosts()
    """-> list of (home, away). Exactly 82 per team, 41 home."""
    rng = random.Random(seed)
    games = []
    for i, a in enumerate(TEAMS):
        for b in TEAMS[i + 1:]:
            if CONF[a] != CONF[b]:
                n, home_a = 2, 1                       # 2 games, one each
            elif DIV[a] == DIV[b]:
                n, home_a = 4, 2                       # 4 games, split
            else:
                d = (POS[a] - POS[b]) % 5
                if d in (0, 1, 4):
                    n, home_a = 4, 2
                else:
                    n = 3
                    home_a = 2 if THREE_HOSTS.get(frozenset((a, b))) == a else 1
            for k in range(n):
                if k < home_a:
                    games.append((a, b))
                else:
                    games.append((b, a))
    rng.shuffle(games)
    return games


def standings(wins, losses):
    """Conference standings. Tiebreak: win%, then head-to-head is skipped in favour of
    point differential, which is the practical proxy and avoids a bracket of edge cases."""
    out = {}
    for c in ("East", "West"):
        ts = [t for t in TEAMS if CONF[t] == c]
        ts.sort(key=lambda t: (-(wins[t] / max(1, wins[t] + losses[t])), -wins[t]))
        out[c] = ts
    return out


def play_series(teams, hi, lo, rng, best_of=7):
    """2-2-1-1-1 home court to the higher seed."""
    pattern = [hi, hi, lo, lo, hi, lo, hi]
    w = {hi: 0, lo: 0}
    log = []
    for g in range(best_of):
        home = pattern[g]
        away = lo if home == hi else hi
        sc, _, _ = SE.simulate(teams[home], teams[away], rng.randrange(10 ** 7))
        win = home if sc["home"] >= sc["away"] else away
        w[win] += 1
        log.append((home, sc["home"], away, sc["away"]))
        if w[win] == best_of // 2 + 1:
            break
    return (hi if w[hi] > w[lo] else lo), w, log


def play_in(teams, order, rng):
    """7/8 winner takes 7; 9/10 winner plays 7/8 loser for 8."""
    s7, s8, s9, s10 = order[6], order[7], order[8], order[9]
    a, _, _ = play_series(teams, s7, s8, rng, best_of=1)
    b_loser = s8 if a == s7 else s7
    c, _, _ = play_series(teams, s9, s10, rng, best_of=1)
    d, _, _ = play_series(teams, b_loser, c, rng, best_of=1)
    return a, d


def run_season(teams, seed=0, verbose=False):
    rng = Rng(seed)
    sched = build_schedule(seed)
    wins = collections.Counter(); losses = collections.Counter()
    pf = collections.Counter(); pa = collections.Counter()
    for h, a in sched:
        sc, _, _ = SE.simulate(teams[h], teams[a], rng.randrange(10 ** 7))
        pf[h] += sc["home"]; pa[h] += sc["away"]
        pf[a] += sc["away"]; pa[a] += sc["home"]
        if sc["home"] >= sc["away"]:
            wins[h] += 1; losses[a] += 1
        else:
            wins[a] += 1; losses[h] += 1
    for t in TEAMS:
        wins[t] += 0; losses[t] += 0
    tab = standings(wins, losses)

    bracket = {}
    for c in ("East", "West"):
        order = tab[c]
        seven, eight = play_in(teams, order, rng)
        bracket[c] = order[:6] + [seven, eight]

    champs = {}
    for c in ("East", "West"):
        r = bracket[c]
        rounds = []
        while len(r) > 1:
            nxt = []
            for i in range(len(r) // 2):
                hi, lo = r[i], r[len(r) - 1 - i]
                w, tally, _ = play_series(teams, hi, lo, rng)
                nxt.append(w)
                rounds.append((hi, lo, w, dict(tally)))
            r = nxt
        champs[c] = (r[0], rounds)
    fin, ftally, _ = play_series(teams, champs["East"][0], champs["West"][0], rng)
    return {"wins": wins, "losses": losses, "pf": pf, "pa": pa, "standings": tab,
            "bracket": bracket, "conf": champs, "champion": fin, "finals": dict(ftally)}


def cmd_schedule():
    sched = build_schedule(1)
    gp = collections.Counter(); home = collections.Counter()
    pair = collections.Counter()
    for h, a in sched:
        gp[h] += 1; gp[a] += 1; home[h] += 1
        pair[tuple(sorted((h, a)))] += 1
    print(f"total games           : {len(sched)}  (expect 1230)")
    print(f"games per team        : {min(gp.values())}-{max(gp.values())}  (expect 82)")
    print(f"home games per team   : {min(home.values())}-{max(home.values())}  (expect 41)")
    inter = [v for k, v in pair.items() if CONF[k[0]] != CONF[k[1]]]
    div   = [v for k, v in pair.items() if CONF[k[0]] == CONF[k[1]] and DIV[k[0]] == DIV[k[1]]]
    nond  = [v for k, v in pair.items() if CONF[k[0]] == CONF[k[1]] and DIV[k[0]] != DIV[k[1]]]
    print(f"inter-conference      : {set(inter)}  (expect 2)")
    print(f"same division         : {set(div)}  (expect 4)")
    print(f"conf, other division  : {sorted(set(nond))}  (expect 3 and 4)")
    fours = collections.Counter()
    for k, v in pair.items():
        if CONF[k[0]] == CONF[k[1]] and DIV[k[0]] != DIV[k[1]] and v == 4:
            fours[k[0]] += 1; fours[k[1]] += 1
    print(f"4-game conf opponents : {sorted(set(fours.values()))}  (expect 6)")



def cmd_season():
    teams = SE.load_league()
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    r = run_season(teams, seed)
    print(f"{SE.SEASON} simulated season (seed {seed})\n")
    for c in ("East", "West"):
        print(f"  {c}")
        for i, t in enumerate(r["standings"][c], 1):
            w, l = r["wins"][t], r["losses"][t]
            diff = (r["pf"][t] - r["pa"][t]) / 82.0
            mark = "*" if t in r["bracket"][c] else " "
            print(f"    {i:2d}{mark} {t:4} {w:3d}-{l:<3d}  {diff:+5.1f}")
        print()
    for c in ("East", "West"):
        print(f"  {c} bracket:")
        for hi, lo, w, tally in r["conf"][c][1]:
            print(f"    {hi} vs {lo}  ->  {w} ({tally[hi]}-{tally[lo]})")
    print(f"\n  FINALS: {r['conf']['East'][0]} vs {r['conf']['West'][0]}")
    print(f"  CHAMPION: {r['champion']}  {r['finals']}")


def cmd_validate():
    teams = SE.load_league()
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    tf = {x["team"]: x for x in json.load(open(f"{OUT}/team_features.json"))
          if x["season"] == SE.SEASON}
    real = {t: tf[t]["wins"] for t in TEAMS if t in tf and tf[t].get("wins")}
    sds, corrs, maes = [], [], []
    acc = collections.defaultdict(list)
    titles = collections.Counter()
    for i in range(n):
        r = run_season(teams, 100 + i)
        w = [r["wins"][t] for t in real]
        sds.append(st.pstdev(w))
        corrs.append(st.correlation(w, [real[t] for t in real]))
        maes.append(sum(abs(a - real[t]) for a, t in zip(w, real)) / len(real))
        for t in TEAMS:
            acc[t].append(r["wins"][t])
        titles[r["champion"]] += 1
    print(f"{SE.SEASON}  {n} full seasons on the real 82-game schedule\n")
    print(f"  sim  win spread (sd): {st.mean(sds):5.2f}   +- {st.pstdev(sds):.2f}")
    print(f"  real win spread (sd): {st.pstdev(list(real.values())):5.2f}")
    print(f"  correlation with real: {st.mean(corrs):5.3f}")
    print(f"  mean absolute error  : {st.mean(maes):5.2f} wins")
    print(f"\n  champions across {n} seasons: {dict(titles)}")
    print(f"\n  {'team':6}{'sim W':>8}{'real W':>8}")
    for t in sorted(TEAMS, key=lambda x: -st.mean(acc[x])):
        if t in real:
            print(f"  {t:6}{st.mean(acc[t]):8.1f}{real[t]:8.0f}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "schedule"
    {"schedule": cmd_schedule, "season": cmd_season, "validate": cmd_validate}[cmd]()
