"""
audit.py — names a refresh de-accented: for every Savant, the player ids whose name appears with
accents in one place and with the accents stripped (the same letters otherwise) in another.

    python3 tools/accents/audit.py [--json out.json]

The rule (Adam, Nov 19 2026): a name that equals another spelling of the same id with the
accents stripped is the same name, and the accented spelling wins; a name with different letters
is a real change and stands. pipeline/accents.py holds the rule; this reads the published files and
counts, per sport:
  players  ids shown with a de-accented name somewhere on the site
  shown    ids whose newest (displayed) name is the de-accented one
  rows     player-season rows carrying the de-accented spelling

Sports and their files: Basketball Savant (savant-data.json + savant-current.json), Football Savant
(football-savant-data.json + football-savant-current.json), College Football (public/cfb/s/*.json.gz),
College Basketball (public/cbb/s/*.json.gz). UFC Savant is left out: its source (UFCStats) carries
no accents at all (0 of 2,780 fighters, Nov 2026), so nothing can be dropped there.
"""
import argparse
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import accents as A  # noqa: E402

PUB = os.path.join(ROOT, "public")


def _load(p):
    return json.load(gzip.open(p)) if p.endswith(".gz") else json.load(open(p, encoding="utf-8"))


def seasons_nba():
    for f in ("savant-data.json", "savant-current.json"):
        d = _load(os.path.join(PUB, f))
        for s, v in d["data"].items():
            for p in v.get("players", []):
                yield str(s), str(p["id"]), p["name"]


def seasons_nfl():
    for f in ("football-savant-data.json", "football-savant-current.json"):
        d = _load(os.path.join(PUB, f))
        for s, v in d["data"].items():
            for p in v.get("players", []):
                yield str(s), str(p["id"]), p["name"]


def _college(sport):
    for p in sorted(glob.glob(os.path.join(PUB, sport, "s", "*.json.gz"))):
        d = _load(p)
        i, n = d["cols"].index("id"), d["cols"].index("name")
        for r in d["players"]:
            yield str(d["season"]), str(r[i]), r[n]


SPORTS = {"Basketball Savant": seasons_nba, "Football Savant": seasons_nfl,
          "College Football Savant": lambda: _college("cfb"), "College Basketball Savant": lambda: _college("cbb")}


def audit(rows):
    by = defaultdict(dict)
    for s, i, n in rows:
        by[i][s] = n
    out = {"players": 0, "shown": 0, "rows": 0, "examples": []}
    for i, seasons in by.items():
        canon = A.canonical(seasons.values())
        bad = [s for s, n in seasons.items() if n != canon.get(n, n)]
        if not bad:
            continue
        out["players"] += 1
        out["rows"] += len(bad)
        newest = max(seasons, key=lambda s: s)
        if newest in bad:
            out["shown"] += 1
        if len(out["examples"]) < 12:
            out["examples"].append((i, seasons[newest], canon.get(seasons[newest], seasons[newest])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    a = ap.parse_args()
    res = {}
    for sport, rows in SPORTS.items():
        r = audit(rows())
        res[sport] = r
        print(f"{sport}: {r['players']} players shown de-accented somewhere ({r['shown']} in their newest season), {r['rows']} player-season rows")
        for i, shown, should in r["examples"][:6]:
            print(f"    {i}: {shown!r} -> {should!r}")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
