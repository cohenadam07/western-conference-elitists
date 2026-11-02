"""
join.py — add CBBD's five-on-the-floor and shot locations to an ESPN game that lacks them.

ESPN stays the record of what happened; CBBD's play ids ARE ESPN's play ids, so each ESPN play
looks itself up. Only `fives` and missing `x, y` are taken. Used for games before ESPN's own
substitutions begin (cbbd_source.ESPN_COMPLETE_FROM).

Cleaning the fives. CBBD lists 8 to 13 men on some plays (2023-24 especially: 9-11 on 19% of
plays; 2024-25 almost never). A side with exactly five is taken as it stands. A side with more
keeps the men who were out there on the last clean play or are on the next one; a side with fewer
is filled from those same two lists. A game whose stint minutes then disagree with the box is
caught by the same gate as any other (rebuild.py).

Coordinates. CBBD's court is tenths of a foot on the full floor: x along it (0-940), y across
(0-500), hoops at x = 52.5 and 887.5. ESPN's is feet on one folded half: x across (hoop 25), y up
from the hoop. fit_coords.py measured the conversion on matched plays; see COORD below.
"""
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))

import cbbd_source as CS  # noqa: E402
from namematch import words  # noqa: E402

# Fitted by fit_coords.py on matched shots: y_espn = round up of feet from the hoop line
COORD = {"hoops": (52.5, 887.5), "centre_y": 250.0, "y_offset": 0.3}


def to_feet(x, y):
    if x is None or y is None:
        return None, None
    hx = min(COORD["hoops"], key=lambda h: abs(x - h))
    flip = 1.0 if hx == COORD["hoops"][0] else -1.0
    ex = 25.0 - flip * (y - COORD["centre_y"]) / 10.0
    ey = abs(x - hx) / 10.0 + COORD["y_offset"]
    return round(ex, 1), round(ey, 1)


def _idmap(g, c):
    """CBBD player id -> ESPN athlete id, by name inside the game's box score."""
    box = {}
    for p in g["players"]:
        w = words(p["name"])
        box["".join(w)] = p["eid"]
        if w:
            box.setdefault(("last", p["team"], w[-1]), p["eid"])
    out = {}
    for cid, name in c["names"].items():
        w = words(name)
        e = box.get("".join(w))
        if e is None and w:
            hits = {v for k, v in box.items() if isinstance(k, tuple) and k[2] == w[-1]}
            e = next(iter(hits)) if len(hits) == 1 else None
        if e is not None:
            out[cid] = e
    return out


def _sides(g, c):
    """CBBD's team name in a play's on-floor list -> ESPN team id."""
    return {c.get("home"): g["home"], c.get("away"): g["away"]}


def apply(g):
    """Fill g["fives"] and missing x, y from the CBBD file, when there is one. Returns what it did."""
    if any(p["tid"] == "584" for p in g["plays"]):
        return None
    path = CS.game_path(g["season"], g["gid"])
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as fh:
        c = json.load(fh)
    ids = _idmap(g, c)
    sides = _sides(g, c)
    d1 = [t for t in (g["home"], g["away"]) if t not in g["non_d1"]]
    by = {r[0]: r for r in c["plays"]}
    order = [p["pid"] for p in sorted((q for q in g["plays"] if q["period"]), key=lambda q: (q["period"], -q["clock"]))]
    raw = {t: [] for t in d1}
    locs = 0
    for pid in order:
        r = by.get(pid)
        floor = (r[16] if r else None) or []
        for t in d1:
            raw[t].append([ids[str(a)] for a, tm in floor if sides.get(tm) == t and str(a) in ids])
    for p in g["plays"]:
        r = by.get(p["pid"])
        if r and p["x"] is None and p["shooting"] and r[13] is not None:
            p["x"], p["y"] = to_feet(r[13], r[14])
            locs += 1
    have = any(any(v) for v in raw.values())
    if have:
        fives = {pid: {} for pid in order}
        for t in d1:
            seq = raw[t]
            nxt = [None] * len(seq)
            last = None
            for i in range(len(seq) - 1, -1, -1):
                if len(seq[i]) == 5:
                    last = seq[i]
                nxt[i] = last
            prev = None
            for i, pid in enumerate(order):
                cand = seq[i]
                if len(cand) != 5:
                    near = [x for x in (prev, nxt[i]) if x]
                    if len(cand) > 5:
                        cand = sorted(cand, key=lambda a: (-sum(a in x for x in near), a))[:5]
                    else:
                        for x in near:
                            for a in x:
                                if a not in cand and len(cand) < 5:
                                    cand = cand + [a]
                else:
                    prev = cand
                fives[pid][t] = cand
        g["fives"] = fives
    return {"locs": locs, "fives": have}
