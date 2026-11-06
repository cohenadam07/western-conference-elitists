"""
polls.py — the AP Top 25, every week, 2002-03 on: context for the roster model, never its baseline.

    python3 polls.py pull 2003 2027      every week of every season (end years), raw cached
    python3 polls.py build               -> ~/Basketball-Savant/out/cbcs/ap/ap.json

Source: ESPN's core API, `seasons/<end year>/types/2/weeks/<n>/rankings/1` (poll id 1 is the AP
Top 25; id 2 is the coaches' poll). Measured on first run (Nov 6, 2026):
  * week 1 of the regular season (type 2) is the preseason poll ("AP Top 25 Preseason"), for
    every season back to 2002-03;
  * the final poll, voted after the tournament, is `types/3/weeks/1/rankings/1` ("AP Top 25
    Final Rankings"); the other postseason weeks have no AP poll;
  * week dates come from the week object (`startDate`), not the poll.

ap.json: {season: {team_id: {"pre", "peak", "final", "weeks_ranked"}}, "_weeks": {season: [dates]}}
pre is the preseason rank, peak the best rank in any regular-season or final poll, final the
post-tournament rank (null when unranked, or for the season in progress). weeks_ranked counts
regular-season polls with the team in the top 25. Team ids are ESPN's.
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.error
import urllib.request

OUT = os.path.join(os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs"), "ap")
RAW = os.path.join(OUT, "raw")
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball"
UA = {"User-Agent": "wcehoops.com College Basketball Coaching Savant (research)"}
WORKERS = 6


def label(y):
    return f"{y - 1}-{str(y)[2:]}"


def fetch(url, tries=5):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode("utf8", "replace"), strict=False)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:  # noqa
            last = e
        time.sleep(min(2 ** i, 20))
    raise RuntimeError(f"ESPN failed: {url}: {last}")


def cached(name, url):
    p = os.path.join(RAW, name)
    if os.path.exists(p):
        return json.load(open(p))
    d = fetch(url)
    json.dump(d, open(p, "w"))
    return d


def pull_year(y, log=print):
    os.makedirs(RAW, exist_ok=True)
    weeks = cached(f"{y}-weeks.json", f"{CORE}/seasons/{y}/types/2/weeks?limit=50") or {}
    nums = [int(i["$ref"].split("/weeks/")[1].split("?")[0]) for i in weeks.get("items", [])]

    def one(n):
        cached(f"{y}-w{n}.json", f"{CORE}/seasons/{y}/types/2/weeks/{n}")
        return cached(f"{y}-w{n}-ap.json", f"{CORE}/seasons/{y}/types/2/weeks/{n}/rankings/1")

    with cf.ThreadPoolExecutor(WORKERS) as ex:
        polls = list(ex.map(one, nums))
    fin = cached(f"{y}-final-ap.json", f"{CORE}/seasons/{y}/types/3/weeks/1/rankings/1")
    log(f"{label(y)}: {len(nums)} weeks, {sum(1 for p in polls if p and p.get('ranks'))} AP polls, final {'yes' if fin and fin.get('ranks') else 'no'}")


def _ranks(p):
    out = {}
    for r in (p or {}).get("ranks") or []:
        tid = r["team"]["$ref"].split("/teams/")[1].split("?")[0]
        out[tid] = int(r["current"])
    return out


def build():
    res, weeks_out = {}, {}
    for f in sorted(os.listdir(RAW)):
        if not f.endswith("-weeks.json"):
            continue
        y = int(f[:4])
        s = label(y)
        wk = json.load(open(os.path.join(RAW, f))) or {}
        nums = sorted(int(i["$ref"].split("/weeks/")[1].split("?")[0]) for i in wk.get("items", []))
        teams, dates = {}, []
        for n in nums:
            p = os.path.join(RAW, f"{y}-w{n}-ap.json")
            if not os.path.exists(p):
                continue
            poll = json.load(open(p))
            rk = _ranks(poll)
            if not rk:
                continue
            w = json.load(open(os.path.join(RAW, f"{y}-w{n}.json"))) or {}
            dates.append((w.get("startDate") or "")[:10])
            pre = "Preseason" in ((poll.get("occurrence") or {}).get("displayValue") or "") or "Preseason" in (poll.get("headline") or "")
            for t, r in rk.items():
                e = teams.setdefault(t, {"pre": None, "peak": None, "final": None, "weeks_ranked": 0})
                e["weeks_ranked"] += 1
                e["peak"] = r if e["peak"] is None else min(e["peak"], r)
                if pre:
                    e["pre"] = r
        fp = os.path.join(RAW, f"{y}-final-ap.json")
        if os.path.exists(fp):
            for t, r in _ranks(json.load(open(fp))).items():
                e = teams.setdefault(t, {"pre": None, "peak": None, "final": None, "weeks_ranked": 0})
                e["final"] = r
                e["peak"] = r if e["peak"] is None else min(e["peak"], r)
        res[s] = teams
        weeks_out[s] = dates
    res["_weeks"] = weeks_out
    # ESPN simply does not hold these AP polls (the season's own poll list, seasons/<y>/rankings/1,
    # stops at the last regular-season week): left null, never filled from another rank.
    res["_missing"] = {s: [k for k, ok in (("pre", any(v["pre"] for v in t.values())), ("final", any(v["final"] for v in t.values()))) if not ok]
                       for s, t in res.items() if not s.startswith("_")}
    res["_missing"] = {s: v for s, v in res["_missing"].items() if v}
    res["_source"] = CORE + "/seasons/<end year>/types/2/weeks/<n>/rankings/1 (final: types/3/weeks/1/rankings/1)"
    json.dump(res, open(os.path.join(OUT, "ap.json"), "w"), indent=0, sort_keys=True)
    for s in sorted(k for k in res if not k.startswith("_")):
        t = res[s]
        print(s, "polls", len(weeks_out[s]), "teams ranked", len(t), "pre", sum(1 for v in t.values() if v["pre"]), "final", sum(1 for v in t.values() if v["final"]))
    return res


if __name__ == "__main__":
    if sys.argv[1] == "pull":
        for y in range(int(sys.argv[2]), int(sys.argv[3]) + 1):
            pull_year(y, log=lambda m: print(time.strftime("%H:%M:%S"), m, flush=True))
    elif sys.argv[1] == "build":
        build()
