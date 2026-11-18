"""
common.py — the measuring instruments behind mtchc's Modules 2-4 reports: read every season's
published Basketball Savant values, run threat.py over them, and build the defender table
from the cached LeagueSeasonMatchups (the same table and weights mtch uses).

    from common import table          # one season's defenders: mtchc, its parts, mtch, targets
    python3 tools/savant-mtchc/common.py   # build 2017-18 .. 2026-27 and print the sample sizes

Reads only: public/savant-data.json, public/savant-current.json, public/savant-ext/s/,
~/Basketball-Savant/cache (matchups). The built table is cached under $MTCHC_CACHE (default
the system temp dir), never in the repo.
"""
import hashlib
import json
import os
import sys
import tempfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
sys.path.insert(0, os.path.join(ROOT, "tools", "savant-settle"))
import threat as T  # noqa: E402

PUB = os.path.join(ROOT, "public")
MATCHUPS = os.path.expanduser("~/Basketball-Savant/cache")
OUT = os.environ.get("MTCHC_CACHE") or os.path.join(tempfile.gettempdir(), "mtchc-cache")
MAIN = ["pts", "ts", "ast", "potast", "obpm", "dbpm", "mtch"]
EXT = ["astpts75", "top75", "gravonp", "gravoni", "onoffd", "levd", "levob"]
SEASONS = [f"{y}-{str(y + 1)[2:]}" for y in range(2017, 2027)]

_D = None


def archive():
    global _D
    if _D is None:
        _D = json.load(open(os.path.join(PUB, "savant-data.json")))["data"]
        C = json.load(open(os.path.join(PUB, "savant-current.json")))
        _D.update(C["data"])
        _D["_qualify"] = C["qualify"]
    return _D


def team_games(season):
    q = archive()["_qualify"].get(season)
    return q["team_games"] if q else None


def season_rows(season):
    """threat.py's rows, plus each player's name, team, qualifier and published mtch sample."""
    P = archive()[season]["players"]
    X = json.load(open(os.path.join(PUB, "savant-ext", "s", f"{season}.json")))
    idx = {k: X["keys"].index(k) for k in EXT if k in X["keys"]}
    rows, meta = {}, {}
    for p in P:
        m = p.get("m") or {}
        cell = lambda k: (m.get(k) or {}).get("season") or {}  # noqa: E731
        v = {k: cell(k).get("v") for k in MAIN}
        xr = (X["players"].get(str(p["id"])) or {}).get("season")
        for k, i in idx.items():
            c = xr[i] if xr else None
            v[k] = c[0] if c else None
        rows[p["id"]] = {"min": cell("minshare").get("n") or 0, "pos": p.get("pos"),
                         "tsa": cell("ts").get("n"), "v": v}
        meta[p["id"]] = {"name": p["name"], "team": p.get("team"), "q": bool(p.get("qualified")),
                         "mtch_n": cell("mtch").get("n"), "ppg": (p.get("line") or {}).get("ppg")}
    return rows, meta


def matchups(season):
    p = dict(season=season, season_type_playoffs="Regular Season", per_mode_simple="Totals")
    key = hashlib.md5(("LeagueSeasonMatchups" + json.dumps(p, sort_keys=True) + "#f0").encode()).hexdigest()
    m = pd.read_json(os.path.join(MATCHUPS, key + ".json"))
    return list(zip(m.DEF_PLAYER_ID.astype(int), m.OFF_PLAYER_ID.astype(int), m.PARTIAL_POSS.astype(float)))


def pctl(v, pool):
    """The page's percentile: midrank, clamped to 1..99."""
    n = len(pool)
    if v is None or n < 2:
        return None
    less = sum(x < v for x in pool)
    eq = sum(x == v for x in pool)
    return max(1, min(99, round(100 * (less + 0.5 * eq) / n)))


def build(season, k=None, mode="resid", gravity=True):
    rows, meta = season_rows(season)
    line = T.pool_line(team_games(season))
    Tt, _ = T.threat_table(rows, season, line, k or (T.K if mode == "resid" else T.K_EQUAL), gravity, mode)
    pairs = matchups(season)
    Dt = T.defender_table(pairs, Tt)
    acc = {}
    for d, o, w in pairs:                     # mtch the engine's way (PPG), from the same table
        ppg = meta.get(o, {}).get("ppg")
        if w > 0 and ppg is not None:
            a = acc.setdefault(d, [0.0, 0.0])
            a[0] += w * ppg
            a[1] += w
    out = []
    for d, r in Dt.items():
        if d not in rows:
            continue
        mm = acc.get(d)
        out.append(dict(season=season, pid=d, name=meta[d]["name"], team=meta[d]["team"],
                        pos=rows[d]["pos"], q=meta[d]["q"], min=rows[d]["min"], **r,
                        mtch=round(mm[0] / mm[1], 1) if mm else None,
                        mtch_pub=rows[d]["v"].get("mtch"), mtch_pub_n=meta[d]["mtch_n"],
                        **{t: rows[d]["v"].get(t) for t in ("dbpm", "onoffd", "levd", "levob")}))
    return pd.DataFrame(out), Tt, meta


def table(rebuild=False):
    """Every season's defenders, resid (the stat) plus the equal-weight comparison column."""
    os.makedirs(OUT, exist_ok=True)
    f = os.path.join(OUT, "defenders.pkl")
    if os.path.exists(f) and not rebuild:
        return pd.read_pickle(f)
    parts = []
    for s in SEASONS:
        a, _, _ = build(s)
        b, _, _ = build(s, mode="equal")
        a = a.merge(b[["pid", "mtchc"]].rename(columns={"mtchc": "mtchc_equal"}), on="pid")
        for col in ("mtchc", "mtchc_score", "mtchc_create", "mtchc_equal", "mtch"):
            q = a[a.q]
            a[col + "_lg"] = [pctl(v, list(q[col].dropna())) for v in a[col]]
            a[col + "_pos"] = [pctl(v, list(q[q.pos == p][col].dropna())) for v, p in zip(a[col], a.pos)]
        parts.append(a)
    df = pd.concat(parts, ignore_index=True)
    df.to_pickle(f)
    return df


if __name__ == "__main__":
    df = table(rebuild=True)
    g = df.groupby("season")
    print(g.apply(lambda d: pd.Series(dict(defenders=len(d), qualified=int(d.q.sum()),
          over_560=int((d.q & (d.n >= 560)).sum()), poss=int(d.n.sum()),
          mtch_matches_published=f"{(d.mtch == d.mtch_pub).sum()}/{d.mtch_pub.notna().sum()}"))).to_string())
    print("max |mtchc - mean(parts)|:", float((df[["mtchc_score", "mtchc_create", "mtchc_overall"]].mean(axis=1) - df.mtchc).abs().max()))
