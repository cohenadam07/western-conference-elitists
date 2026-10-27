"""
ext_files.py — where the October 2026 additions live on the site, and how they are written.

The archive (public/savant-data.json) is near GitHub's 100 MB limit, so the ~145 new card stats
and the panels ship beside it in public/savant-ext/, fetched only for what a reader opens:

  savant-ext/s/<season>.json       every player's values for the new stats, that season
                                   {"schema", "season", "generated", "through", "keys",
                                    "windows", "players": {pid: {window: [[value, sample]|null,
                                    ...one per key]}}}. Finished seasons carry the full season
                                   only; the season in progress all four windows.
  savant-ext/panels/<season>.json  every player's panels that season (shot menu, shot splits,
                                   touches, defensive play types, passing network, clutch,
                                   splits, on/off four factors, turnover mix, Handle Score, Dunk
                                   Score, position estimate, and the offense play types' extra
                                   columns): {"schema", "season", "players": {pid: {panel: ...}}}
  savant-ext/p/<pid>.json          one player's finished seasons, for his career chart and
                                   career highs: {"schema", "id", "keys", "seasons": {season:
                                   [[value, league pct, position pct]|null, ...]}}
  savant-ext/index.json            which seasons exist, when each was built, what it carries

Percentiles in p/ are the page's: midrank among that season's qualified players with a value,
flipped for lower-is-better stats, rounded and held to 1..99; position pools use the page's
position corrections. The page and the connector rank the season files themselves.
"""
import bisect
import datetime as dt
import json
import math
import os
import re

import ext_config as XC

SCHEMA = 1
KEYS = XC.KEYS
PANELS = list(XC.EXT_PANELS) + ["ptx"]
LOWER = {m["key"]: bool(m["lower"]) for m in XC.EXT_METRICS}
POS_FIX_ID = {1629029: "Guard"}     # = POS_FIX_ID in basketball-savant.html (Luka Doncic)


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def split(players):
    """Take the new stats and panels off the season's player dicts (in place) and return them:
    ({pid: {window: {key: {"v","n"}}}}, {pid: {panel: data}}). What stays behind is exactly
    what savant-current.json carried before the additions."""
    vals, panels = {}, {}
    keyset = set(KEYS)
    for p in players:
        m = p.get("m") or {}
        mine = {k: m.pop(k) for k in [k for k in m if k in keyset]}
        if mine:
            vals[p["id"]] = mine
        pan = {k: p.pop(k) for k in PANELS if k in p}
        if pan:
            panels[p["id"]] = pan
    return vals, panels


def _row(cells):
    """{key: {"v","n"}} for one window -> [[v, n] | None, ...] aligned to KEYS, or None if empty."""
    out, any_ = [], False
    for k in KEYS:
        c = cells.get(k)
        v = _clean(c.get("v")) if c else None
        if v is None:
            out.append(None)
            continue
        any_ = True
        out.append([v, c.get("n")])
    return out if any_ else None


def season_doc(season, vals, windows, generated=None, through=None):
    players = {}
    for pid, by_key in vals.items():
        wins = {}
        for w in windows:
            r = _row({k: v[w] for k, v in by_key.items() if w in v})
            if r:
                wins[w] = r
        if wins:
            players[str(pid)] = wins
    return {"schema": SCHEMA, "season": season, "generated": generated or now(), "through": through,
            "keys": KEYS, "windows": list(windows), "players": players}


def panels_doc(season, panels, generated=None):
    return {"schema": SCHEMA, "season": season, "generated": generated or now(),
            "players": {str(pid): pan for pid, pan in panels.items() if pan}}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def dumps(obj):
    s = json.dumps(obj, separators=(",", ":"), allow_nan=True)
    s = re.sub(r"-?Infinity", "null", re.sub(r"\bNaN\b", "null", s))
    json.loads(s)
    return s


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(dumps(obj))
    os.replace(tmp, path)


def season_path(public, season):
    return os.path.join(public, "savant-ext", "s", f"{season}.json")


def panels_path(public, season):
    return os.path.join(public, "savant-ext", "panels", f"{season}.json")


def player_path(public, pid):
    return os.path.join(public, "savant-ext", "p", f"{pid}.json")


def index_path(public):
    return os.path.join(public, "savant-ext", "index.json")


# ------------------------------------------------------------------ percentiles (the page's)
def _pct(v, pool, lower):
    """`pool` sorted ascending."""
    n = len(pool)
    if v is None or n < 2:
        return None
    less = bisect.bisect_left(pool, v)
    eq = bisect.bisect_right(pool, v) - less
    p = 100.0 * (less + 0.5 * eq) / n
    if lower:
        p = 100 - p
    return max(1, min(99, int(math.floor(p + 0.5))))   # JS Math.round


def ranked(season_players, doc):
    """{pid: [[v, league pct, position pct] | None ...]} for the full season of one season doc.
    `season_players` are the archive's rows for that season (id, pos, qualified)."""
    meta = {p["id"]: (POS_FIX_ID.get(p["id"], p.get("pos")), bool(p.get("qualified"))) for p in season_players}
    rows = {int(pid): w.get("season") for pid, w in doc["players"].items() if w.get("season")}
    out = {pid: [None] * len(KEYS) for pid in rows}
    for i, k in enumerate(KEYS):
        league, by_pos = [], {}
        for pid, r in rows.items():
            pos, q = meta.get(pid, (None, False))
            if not q or r[i] is None:
                continue
            league.append(r[i][0])
            by_pos.setdefault(pos, []).append(r[i][0])
        league.sort()
        for pool in by_pos.values():
            pool.sort()
        for pid, r in rows.items():
            if r[i] is None:
                continue
            v = r[i][0]
            pos = meta.get(pid, (None, False))[0]
            out[pid][i] = [v, _pct(v, league, LOWER[k]), _pct(v, by_pos.get(pos, []), LOWER[k])]
    return out
