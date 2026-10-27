"""
archive.py — the Basketball Savant player archive, read for the coaching build: each player's
impact, role, age and archetype by season, from the same files the player cards draw.

    players(season) -> {nba id: {"name", "team", "pos", "age", "exp", "bpm", "obpm", "dbpm",
                                 "mpg", "gp", "min", "arch", "qualified"}}

Impact is Basketball-Reference's box plus-minus as carried on the card (metric "bpm"), the one
impact number the archive has for every season since 1979-80. Minutes: "minshare"'s sample is
total minutes; "avail"'s is games played. Archetypes: ~/Basketball-Savant/out/archetypes.json
(archetype_engine), in sample from 2013-14, indicative before. The season in progress comes
from public/savant-current.json.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
_data = {}
_arch = None
_cache = {}


def _load(name):
    if name not in _data:
        p = os.path.join(PUBLIC, name)
        _data[name] = json.load(open(p)) if os.path.exists(p) else {"data": {}}
    return _data[name]


def _archetypes():
    global _arch
    if _arch is None:
        p = os.path.join(SAVANT, "out", "archetypes.json")
        _arch = json.load(open(p)).get("data", {}) if os.path.exists(p) else {}
    return _arch


def _cell(p, key):
    return ((p.get("m") or {}).get(key) or {}).get("season") or {}


def players(season):
    if season in _cache:
        return _cache[season]
    rows = _load("savant-data.json").get("data", {}).get(season, {}).get("players", [])
    if not rows:
        rows = _load("savant-current.json").get("data", {}).get(season, {}).get("players", [])
    arch = _archetypes().get(season, {})
    out = {}
    for p in rows:
        pid = p.get("id")
        if pid is None:
            continue
        ms, av, mpg, bpm = _cell(p, "minshare"), _cell(p, "avail"), _cell(p, "mpg"), _cell(p, "bpm")
        a = arch.get(str(pid)) or {}
        out[int(pid) if str(pid).isdigit() else pid] = {
            "name": p.get("name"), "team": p.get("team"), "pos": p.get("pos"), "age": p.get("age"), "exp": p.get("exp"),
            "bpm": bpm.get("v"), "obpm": _cell(p, "obpm").get("v"), "dbpm": _cell(p, "dbpm").get("v"), "vorp": _cell(p, "vorp").get("v"),
            "mpg": mpg.get("v"), "gp": av.get("n"), "min": ms.get("n"), "qualified": bool(p.get("qualified")),
            "arch": a.get("a"), "arch_pure": a.get("pure"), "birthdate": p.get("birthdate"),
        }
    impute_bpm(out, rows)
    # the aging curve (savant_config.AGING) is fitted on the position-adjusted BPM percentile, not on
    # BPM itself: rank each man inside his position pool the way the card does (midrank among the
    # qualified; an unqualified man against that pool plus himself)
    import bisect
    by_pos = {}
    for pid, v in out.items():
        if v["bpm"] is not None:
            by_pos.setdefault(v["pos"], []).append((pid, v["bpm"], v["qualified"]))
    for pos, rows in by_pos.items():
        pool = sorted(b for _, b, q in rows if q)
        if len(pool) < 2:
            continue
        for pid, b, q in rows:
            vals = pool if q else sorted(pool + [b])
            lo, hi = bisect.bisect_left(vals, b), bisect.bisect_right(vals, b)
            out[pid]["bpm_pct"] = round(100.0 * (lo + 0.5 * (hi - lo)) / len(vals), 2)
    _cache[season] = out
    return out


# BPM comes from Basketball-Reference through a name join that misses a few men a season (Jimmy
# Butler III, AJ Green, Robert Williams III: suffixes and initials the join does not reconcile),
# 215 player-seasons with 200+ minutes since 1996-97. Their BPM is imputed from the box score:
# a ridge regression fitted per season on every player with 200+ minutes and a BPM, on sixteen
# box and derived rates (points, assists, rebounds, stocks and turnovers per 75, true shooting,
# usage, block and steal rates, rebounding rates, 3PA and FT rates, assist rate, eFG, minutes).
# Five-fold cross-validated R² 0.889 across seasons (0.856 at worst). A player under 200 minutes
# is left without one. Imputed rows carry bpm_imputed = True.
IMPUTE_FEATS = ["pts", "ast75", "reb75", "stk75", "tov75", "ts", "usg", "blkpct", "stlpct", "oreb", "dreb", "tp3r", "ftr", "ast", "efg", "mpg"]
IMPUTE_MIN = 200


def impute_bpm(out, rows):
    import numpy as np
    if os.environ.get("BCS_NO_IMPUTE"):      # for measuring the fits with and without the fill-in
        return
    def feats(p):
        return [_cell(p, f).get("v") for f in IMPUTE_FEATS]
    have, miss = [], []
    for p in rows:
        pid = p.get("id")
        if pid is None or (_cell(p, "minshare").get("n") or 0) < IMPUTE_MIN:
            continue
        x = feats(p)
        if any(v is None for v in x):
            continue
        (have if _cell(p, "bpm").get("v") is not None else miss).append((int(pid) if str(pid).isdigit() else pid, x, _cell(p, "bpm").get("v")))
    if len(have) < 50 or not miss:
        return
    X = np.array([x for _, x, _ in have], float); y = np.array([b for _, _, b in have], float)
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.c_[np.ones(len(X)), (X - mu) / sd]
    I = np.eye(Z.shape[1]); I[0, 0] = 0
    beta = np.linalg.solve(Z.T @ Z + 1.0 * I, Z.T @ y)
    for pid, x, _ in miss:
        z = np.r_[1.0, (np.array(x, float) - mu) / sd]
        if pid in out:
            out[pid]["bpm"] = round(float(z @ beta), 2)
            out[pid]["bpm_imputed"] = True


def seasons():
    return sorted(set(_load("savant-data.json").get("data", {}).keys()) | set(_load("savant-current.json").get("data", {}).keys()))
