"""
espn_coaches.py — ESPN's season coaches: who ESPN says coached each team-season.

    python3 espn_coaches.py pull 2003 2027        every season's coach list, then every coach
    python3 espn_coaches.py census                 first covered season, coaches per season

ESPN's core API lists a season's coaches (`seasons/<y>/coaches`), and each coach record carries
his ESPN coach id, name, birthdate, birthplace, experience, the team he coached that season
and his regular-season record there. Measured on first run (Nov 5, 2026): Duke has a coach
for 2018 and 2026 and none for 2003 or 2010; the season lists exist from 2009-10 but are
partial before 2013-14 (307 coaches in 2009-10, 366 in 2013-14). census() writes the
coverage for the build notes.

Cache: ~/Basketball-Savant/out/cbcs/espn-coaches/<year>/list.json and <coach id>.json, the
responses byte for byte. The same six-at-a-time rule as espn_cbb.py. Nothing here leaves the Mac
raw: registry.py reads it and publishes only the fields the page needs, with ESPN's coach id.
"""
import concurrent.futures as cf
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import espn_cbb as E  # noqa: E402

OUT = os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs")
ROOT = os.path.join(OUT, "espn-coaches")
E.UA = {"User-Agent": "wcehoops.com College Basketball Coaching Savant (research)"}


def _get_cached(path, url):
    if os.path.exists(path):
        return json.load(open(path))
    raw = E.fetch(url)
    d = None if raw is None else E.loads(raw)
    with open(path, "w") as fh:
        json.dump(d, fh)
    return d


def pull_year(y, log=print):
    d = os.path.join(ROOT, str(y))
    os.makedirs(d, exist_ok=True)
    lst = _get_cached(os.path.join(d, "list.json"), f"{E.CORE}/seasons/{y}/coaches?limit=1000")
    refs = [i["$ref"] for i in (lst or {}).get("items", [])]
    ids = [r.split("/coaches/")[1].split("?")[0] for r in refs]

    def one(cid):
        c = _get_cached(os.path.join(d, f"{cid}.json"), f"{E.CORE}/seasons/{y}/coaches/{cid}")
        if c and not os.path.exists(os.path.join(d, f"{cid}.rec.json")):
            recs = []
            for r in c.get("records") or []:
                u = (r.get("record") or {}).get("$ref")
                if u:
                    recs.append(E.get(u.replace("http://", "https://")))
            json.dump(recs, open(os.path.join(d, f"{cid}.rec.json"), "w"))
        return cid

    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        n = sum(1 for _ in ex.map(one, ids))
    log(f"{y}: {n} coaches")
    return n


def load_year(y):
    """[{cid, first, last, born, birthplace, experience, team, w, l}] for one season (end year)."""
    d = os.path.join(ROOT, str(y))
    out = []
    if not os.path.exists(os.path.join(d, "list.json")):
        return out
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json") or f in ("list.json",) or f.endswith(".rec.json"):
            continue
        c = json.load(open(os.path.join(d, f)))
        if not c:
            continue
        team = ((c.get("team") or {}).get("$ref") or "").split("/teams/")
        tid = team[1].split("?")[0] if len(team) > 1 else None
        rec = {"w": None, "l": None}
        rp = os.path.join(d, f.replace(".json", ".rec.json"))
        if os.path.exists(rp):
            for r in json.load(open(rp)) or []:
                if r and r.get("type") in ("Regular Season", None):
                    st = {s["name"]: s.get("value") for s in r.get("stats", [])}
                    rec = {"w": int(st.get("wins") or 0), "l": int(st.get("losses") or 0)}
        bp = c.get("birthPlace") or {}
        out.append(dict(cid=c["id"], first=c.get("firstName"), last=c.get("lastName"), born=(c.get("dateOfBirth") or "")[:10] or None,
                        birthplace=", ".join(x for x in (bp.get("city"), bp.get("state"), bp.get("country")) if x) or None,
                        experience=c.get("experience"), team=tid, **rec,
                        source=f"{E.CORE}/seasons/{y}/coaches/{c['id']}"))
    return out


def census():
    rows = {}
    for y in range(2003, 2028):
        cs = load_year(y)
        rows[E.season_label(y)] = dict(coaches=len(cs), with_team=sum(1 for c in cs if c["team"]), with_born=sum(1 for c in cs if c["born"]))
    json.dump(rows, open(os.path.join(OUT, "espn-coaches-census.json"), "w"), indent=1)
    for k, v in rows.items():
        print(k, v)
    return rows


if __name__ == "__main__":
    if sys.argv[1] == "pull":
        a, b = int(sys.argv[2]), int(sys.argv[3])
        for y in range(b, a - 1, -1):
            pull_year(y, log=lambda m: print(time.strftime("%H:%M:%S"), m, flush=True))
    elif sys.argv[1] == "census":
        census()
