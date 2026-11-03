"""
allsavant.py — the All-Savant Teams, from Savant value. Part 3.

    teams(doc, ...)    national 1st, 2nd, 3rd; one conference team each; All-Freshman; Savant POY

Shape 2 guards, 2 wings, 1 big, by this site's positions, qualified players only. A player makes
one national team. A conference with no qualified player at a position fills the seat with the next
best at any position, and the seat says so. All-Freshman is ESPN's class listing: its "Freshman"
takes redshirt freshmen in, and it has no separate label for them.

A season is a standing ("so far") until the national championship has been played. 2019-20 had no
tournament, so it is final from the day the season was called off.
"""
import numpy as np

SHAPE = [("Guard", 2), ("Wing", 2), ("Big", 1)]
ID, NAME, TEAM, POS, CLS, QUAL, CONF, HEAD = 0, 1, 2, 3, 4, 11, 12, 13


def entry(p, i, value, slot, filled=False):
    d = dict(id=p[ID], name=p[NAME], team=p[TEAM], pos=p[POS], cls=p[CLS], head=p[HEAD], value=value, slot=slot)
    if filled:
        d["filled"] = True
    return d


def pick(pool, P, V, used=None, fill=False):
    """One team from indices sorted best first. `used` holds national picks."""
    team, taken = [], set()
    for pos, n in SHAPE:
        got = 0
        for i in pool:
            if got == n:
                break
            if P[i][POS] != pos or i in taken or (used is not None and i in used):
                continue
            team.append(entry(P[i], i, V[i], pos))
            taken.add(i)
            got += 1
        if fill:
            for i in pool:
                if got == n:
                    break
                if i not in taken:
                    team.append(entry(P[i], i, V[i], pos, True))
                    taken.add(i)
                    got += 1
    if used is not None:
        used |= taken
    return team


def teams(doc, final, note=None):
    P, V = doc["players"], doc["values"]["value"]["r"]
    q = [i for i, p in enumerate(P) if p[QUAL] and V[i] is not None and p[POS]]
    q.sort(key=lambda i: (-V[i], P[i][ID]))
    used = set()
    national = {str(k): pick(q, P, V, used) for k in (1, 2, 3)}
    conf = {}
    for c in sorted({P[i][CONF] for i in q if P[i][CONF]}, key=str):
        conf[str(c)] = pick([i for i in q if P[i][CONF] == c], P, V, fill=True)
    fr = pick([i for i in q if P[i][CLS] == "Fr"], P, V)
    poy = entry(P[q[0]], q[0], V[q[0]], P[q[0]][POS]) if q else None
    return dict(season=doc["season"], through=doc["through"], final=final, so_far=not final, national=national, conference=conf, freshman=fr, poy=poy, replacement=doc.get("repl"), qualified=len(q), note=note)


def honours(t):
    """[(player id, key, label)] for a finished season."""
    if not t["final"]:
        return []
    out = []
    if t["poy"]:
        out.append((t["poy"]["id"], "poy", "Savant POY"))
    for k in ("1", "2", "3"):
        lab = {"1": "All-Savant 1st", "2": "All-Savant 2nd", "3": "All-Savant 3rd"}[k]
        out += [(p["id"], "ast" + k, lab) for p in t["national"][k]]
    for team in t["conference"].values():
        out += [(p["id"], "conf", "All-Conference Savant") for p in team]
    out += [(p["id"], "frosh", "All-Freshman Savant") for p in t["freshman"]]
    return out
