"""
withwithout.py — With/Without, from the stints: public/bcs/ww/<team>-<season>.json.gz.

    python3 withwithout.py 2002-03 2025-26

What a teammate's presence does to a player, split by who was on the floor. The page and the
connector ask for any teammates, several at once, so the answer can't be precomputed by pair: a
team-season's file holds what any such question sums over.

    units   every five-man unit: its seconds, the team's and the opponent's line while it played,
            and each of the five men's own box
    games   every game he played: his seconds, box and on-floor lines, for "games he missed"

The stints and the events inside them are espn_tables.parse_game's (the engine Coaching Savant
reads); it only gained each player's own counts per stint. The sums and the rates over them are
public/savant-ww.js, one implementation for the card and the connector.

Reconciling with the box score. ESPN's play-by-play and its box score are one record kept twice,
and they disagree a little. Two things keep With + Without equal to the season:
  * an event by a man the substitutions have off the floor (a free throw after a dead-ball change
    logged early) goes to the stint nearest in time that has him on it
  * what's left, per player and game, goes on his longest unit that game, so totals are the box
    score's, but only where the box score adds up to the final score. ESPN's is blank for some
    games (all zeros), and there the play-by-play stands alone. The build prints all of these
    rates, and the check holds them down.
Regular season only, as the card's numbers are.
"""
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import espn_games as G  # noqa: E402
import espn_tables as T  # noqa: E402
import gamefile as GF  # noqa: E402
import process as P  # noqa: E402
import teams as TM  # noqa: E402

PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
BOX = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "ast", "oreb", "dreb", "tov", "stl", "blk", "pf")
ZONES = ("ra_a", "ra_m", "pnt_a", "pnt_m", "mid_a", "mid_m")
ON = ("poss", "pts", "fga", "fgm", "fg3a", "fg3m", "fta", "ftm", "oreb", "dreb", "tov")
SCHEMA = 1


def _zone(s):
    """gamefile.zone of a parse_game shot row."""
    return GF.zone({"pts_att": 3 if s["three"] else 2, "x": s["x"], "y": s["y"], "text": f"{s['dist']}-foot" if s["dist"] is not None else ""})


def game_rows(g):
    """One game -> {team: [unit rows]}, plus how much had to be moved to reconcile it."""
    parsed = T.parse_game(g)
    shots = parsed["shots"]
    team_of = parsed["team_of"]
    home, away = g["home"], g["away"]
    opp = {home: away, away: home}
    sts = [s for s in parsed["stints"] if s.seconds > 0 or s.box or s.shots]
    timed = [s for s in sts if s.seconds > 0]
    moved = unplaced = 0

    # a stint's counts for one man -> the stint nearest it that has him on the floor
    def home_for(eid, s):
        team = team_of.get(eid)
        if team is None:
            return None
        if eid in s.on.get(team, ()) and s.seconds > 0:
            return s
        i = sts.index(s)
        best, gap = None, None
        for x in timed:
            if eid in x.on.get(team, ()):
                d = abs(sts.index(x) - i)
                if gap is None or d < gap:
                    best, gap = x, d
        return best

    rows = {}       # (team, five) -> {"sec", "t": {...}, "o": {...}, "box": {eid: {...}}}

    def unit(team, s):
        return rows.setdefault((team, tuple(sorted(s.on[team]))), {"sec": 0.0, "t": defaultdict(float), "o": defaultdict(float), "box": defaultdict(lambda: defaultdict(int))})

    for s in timed:
        for team in (home, away):
            if len(s.on.get(team, ())) != 5:
                continue
            u = unit(team, s)
            u["sec"] += s.seconds
            for k in ON:
                u["t"][k] += s.t[team][k]
                u["o"][k] += s.t[opp[team]][k]
    for s in sts:
        for eid, box in s.box.items():
            target = home_for(eid, s)
            if target is None:
                unplaced += sum(box.values())
                continue
            moved += sum(box.values()) if target is not s else 0
            team = team_of[eid]
            if len(target.on[team]) != 5:
                unplaced += sum(box.values())
                continue
            u = unit(team, target)
            for k, v in box.items():
                u["box"][eid][k] += v
        for i in s.shots:
            sh = shots[i]
            target = home_for(sh["eid"], s)
            z = _zone(sh)
            if target is None or z not in ("ra", "paint", "mid") or len(target.on[team_of[sh["eid"]]]) != 5:
                continue
            key = {"ra": "ra", "paint": "pnt", "mid": "mid"}[z]
            u = unit(team_of[sh["eid"]], target)
            u["box"][sh["eid"]][key + "_a"] += 1
            u["box"][sh["eid"]][key + "_m"] += bool(sh["made"])

    # the box score has the last word
    fixed = 0
    box = {p["eid"]: p for p in g["players"]}
    final = next(((p["score_home"] or 0) + (p["score_away"] or 0) for p in reversed(g["plays"]) if p.get("score_home") is not None), 0)
    trust = final > 0 and abs(sum(p.get("pts") or 0 for p in box.values()) - final) <= 2
    for eid, p in box.items():
        if not trust or (not p.get("min") and not any(p.get(k) for k in BOX)):
            continue
        team = p["team"]
        mine = [(k, u) for k, u in rows.items() if k[0] == team and eid in k[1]]
        if not mine:
            unplaced += sum(abs(int(p.get(k) or 0)) for k in BOX)
            continue
        have = {k: sum(u["box"][eid][k] for _, u in mine) for k in BOX}
        longest = max(mine, key=lambda x: x[1]["sec"])[1]
        for k in BOX:
            d = int(p.get(k) or 0) - have[k]
            if d:
                longest["box"][eid][k] += d
                fixed += abs(d)
    total = sum(sum(v.values()) for s in sts for v in s.box.values())
    return rows, dict(moved=moved, fixed=fixed, unplaced=unplaced, total=total, games=1, blank_box=int(not trust))


def _vec(d, keys):
    return [int(round(d.get(k, 0))) for k in keys]


def _work(args):
    season, gid, date = args
    with gzip.open(os.path.join(G.CACHE_ROOT, season, "games", f"{gid}.json.gz"), "rt") as fh:
        g = json.load(fh)
    rows, rec = game_rows(g)
    out = defaultdict(list)
    names = {p["eid"]: p["name"] for p in g["players"]}
    for (team, five), u in rows.items():
        out[team].append([list(five), round(u["sec"], 1), _vec(u["t"], ON), _vec(u["o"], ON),
                          {e: _vec(b, BOX + ZONES) for e, b in u["box"].items()}])
    return gid, date, g["home"], g["away"], dict(out), names, rec


def build_season(season, public=PUBLIC, workers=6, log=print):
    """Every regular-season game of a season -> one file per team."""
    t0 = time.time()
    idx = {g: v for g, v in (G.index_of(season) or {}).items() if v[1] == 2}
    if not idx:
        log(f"{season}: no ESPN games cached")
        return None
    bundle = P.load(season)
    idmap = (bundle or {}).get("idmap") or {}
    m = lambda e: idmap.get(str(e), f"e{e}")  # noqa: E731
    jobs = sorted(((season, g, v[0]) for g, v in idx.items()), key=lambda j: j[2])
    teams = defaultdict(lambda: {"units": {}, "games": []})
    names = {}
    rec = defaultdict(int)
    with cf.ProcessPoolExecutor(workers) as ex:
        for gid, date, home, away, out, nm, r in ex.map(_work, jobs, chunksize=20):
            for k, v in r.items():
                rec[k] += v
            for e, n in nm.items():
                names[str(m(e))] = n
            for team, units in out.items():
                fr = TM.franchise(team) or team
                T_ = teams[fr]
                other = TM.franchise(away if team == home else home) or (away if team == home else home)
                game = {"d": date[5:], "o": other, "p": {}}
                for five, sec, tv, ov, box in units:
                    ids = tuple(sorted(str(m(e)) for e in five))
                    u = T_["units"].setdefault(ids, {"sec": 0.0, "t": [0] * len(ON), "o": [0] * len(ON), "box": {}})
                    u["sec"] += sec
                    u["t"] = [a + b for a, b in zip(u["t"], tv)]
                    u["o"] = [a + b for a, b in zip(u["o"], ov)]
                    bv = {str(m(e)): v for e, v in box.items()}
                    for pid in ids:
                        v = bv.get(pid, [0] * (len(BOX) + len(ZONES)))
                        old = u["box"].get(pid)
                        u["box"][pid] = v if old is None else [a + b for a, b in zip(old, v)]
                        g = game["p"].setdefault(pid, {"sec": 0.0, "t": [0] * len(ON), "o": [0] * len(ON), "b": [0] * (len(BOX) + len(ZONES))})
                        g["sec"] += sec
                        g["t"] = [a + b for a, b in zip(g["t"], tv)]
                        g["o"] = [a + b for a, b in zip(g["o"], ov)]
                        g["b"] = [a + b for a, b in zip(g["b"], v)]
                T_["games"].append(game)
    out_dir = os.path.join(public, "bcs", "ww")
    os.makedirs(out_dir, exist_ok=True)
    size = 0
    for fr, d in teams.items():
        ids = sorted({p for five in d["units"] for p in five})
        ix = {p: i for i, p in enumerate(ids)}
        units = []
        for five, u in sorted(d["units"].items(), key=lambda kv: -kv[1]["sec"]):
            units.append([[ix[p] for p in five], round(u["sec"]), u["t"], u["o"], [u["box"][p] for p in five]])
        games = []
        for x in d["games"]:
            games.append([x["d"], x["o"], [[ix[p], round(v["sec"]), v["b"], v["t"], v["o"]] for p, v in sorted(x["p"].items(), key=lambda kv: ix[kv[0]])]])
        doc = dict(schema=SCHEMA, season=season, team=fr, box=list(BOX + ZONES), on=list(ON),
                   players=[[int(p) if p.isdigit() else p, names.get(p, "")] for p in ids], units=units, games=games)
        path = os.path.join(out_dir, f"{fr}-{season}.json.gz")
        raw = json.dumps(doc, separators=(",", ":")).encode()
        with open(path + ".tmp", "wb") as fh:
            fh.write(gzip.compress(raw, 9, mtime=0))
        os.replace(path + ".tmp", path)
        size += os.path.getsize(path)
    # which team files a player's season is in, his longest first (a traded player has several)
    where = defaultdict(list)
    for fr, d in teams.items():
        sec = defaultdict(float)
        for five, u in d["units"].items():
            for p in five:
                sec[p] += u["sec"]
        for p, v in sec.items():
            where[p].append([fr, round(v)])
    for v in where.values():
        v.sort(key=lambda x: -x[1])
    with open(os.path.join(out_dir, f"index-{season}.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps(dict(schema=SCHEMA, season=season, players=where), separators=(",", ":")).encode(), 9, mtime=0))
    t = rec["total"] or 1
    log(f"{season}: {len(jobs)} games, {len(teams)} teams, {size / 1e6:.1f} MB; of {rec['total']:,} box counts "
        f"moved to his stint {100 * rec['moved'] / t:.2f}%, set by the box {100 * rec['fixed'] / t:.2f}%, "
        f"unplaced {100 * rec['unplaced'] / t:.3f}%, blank box {rec['blank_box']} games ({time.time() - t0:.0f}s)")
    return dict(rec)


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    first = a[0] if a else G.FIRST_SEASON
    last = a[1] if len(a) > 1 else first
    for y in range(int(last[:4]), int(first[:4]) - 1, -1):
        build_season(G.season_label(y))
