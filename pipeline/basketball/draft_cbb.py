"""
draft_cbb.py — Draft Savant's NCAA prospects read their college numbers from College Basketball
Savant, for D1 players from the 2027 class on. Older classes keep their rows until Draft Savant 2.0.

    overlay(prospect, public_dir) -> the prospect with its college production replaced in place

A prospect is joined by an explicit `espn_id` when it has one, else by name and school through
public/cbb/search.json. A prospect who can't be joined keeps what it has, and the build says so:
nothing here guesses. Raw (unadjusted) rates, because Draft Savant's own pools are built on raw rows.
"""
import gzip
import json
import os
import re

FIRST_CLASS = 2027
# Draft Savant metric key -> College Basketball Savant key, and how the values scale
MAP = {"ts": ("ts", 0.01), "efg": ("efg", 1), "usg": ("usg", 1), "ft": ("ft", 1), "tp3": ("fg3", 1), "tp3r": ("tpar", 1), "ftr": ("ftr", 1),
       "ast": ("ast_pct", 1), "tov": ("tov_pct", 1), "oreb": ("orb_pct", 1), "dreb": ("drb_pct", 1), "stl": ("stl_pct", 1), "blk": ("blk_pct", 1)}


def _read(public, rel):
    with gzip.open(os.path.join(public, "cbb", rel + ".gz"), "rt") as fh:
        return json.load(fh)


def _norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def find(prospect, public):
    if prospect.get("espn_id"):
        return str(prospect["espn_id"])
    d = _read(public, "search.json")
    teams = {t[0]: _norm(t[1]) for t in d["teams"]}
    want = _norm(prospect.get("college"))
    hits = [p for p in d["players"] if _norm(p[1]) == _norm(prospect.get("name")) and (not want or teams.get(p[2], "") in want or want in teams.get(p[2], ""))]
    return hits[0][0] if len(hits) == 1 else None


def overlay(prospect, public):
    """Returns True when the prospect's college numbers now come from public/cbb."""
    if (prospect.get("draft_year") or 0) < FIRST_CLASS:
        return False
    eid = find(prospect, public)
    if not eid:
        return False
    idx = _read(public, "index.json")
    for s in [x["season"] for x in reversed(idx["seasons"])]:
        doc = _read(public, f"s/{s}.json")
        i = next((n for n, p in enumerate(doc["players"]) if p[0] == eid), None)
        if i is None:
            continue
        p = doc["players"][i]
        gp = p[8]
        m = prospect.setdefault("m", {})
        for k, (key, sc) in MAP.items():
            v = (doc["values"].get(key) or {}).get("rg") or (doc["values"].get(key) or {}).get("r")
            if v and v[i] is not None:
                m[k] = {"v": round(v[i] * sc, 3), "n": gp}
        prospect["gp"] = gp
        prospect["espn_id"] = eid
        prospect["cbb_season"] = s
        return True
    return False
