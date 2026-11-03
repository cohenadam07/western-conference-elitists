"""
identity.py — who everyone is. §4 of the spec, and step 5's checks.

    python3 identity.py 2025-26 2024-25 ...
    python3 identity.py --report

The spine is the ESPN athlete id. One source per field:
    height, weight, class, jersey, birthplace   ESPN's season-scoped athlete record (core v2)
    team, games                                 our own game tables: he played for them
    birthdate (internal only, never written     T-Rank's public file, by name within team-season,
      to public/; only age leaves here)         carried forward by id; then CBBD's
    recruit rank, stars, high school            CBBD recruiting rows (joined on CBBD's id)
    NBA person id                               Basketball Savant's seed/espn_ids.json

Name matching (T-Rank rows have no ESPN id): exact normalized name within the team-season, then
Jaro-Winkler >= 0.92 within the team, Jr./III and initials handled by namematch.words. T-Rank's
school spellings are learned, not typed: each of its teams maps to the ESPN team most of its
players match exactly. pipeline/college/manual/id_fixes.csv overrides any of it, with a source.

Age is a decimal on Feb 1 of the season, labelled that way everywhere.
"""
import concurrent.futures as cf
import csv
import datetime as dt
import gzip
import json
import os
import sys
import time
from collections import Counter, defaultdict

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))

import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402
import season as SZ  # noqa: E402
from namematch import words  # noqa: E402

OUT = os.path.join(CC.HOME, "identity")
BIO = os.path.join(CC.HOME, "bio")
REF = os.path.join(CC.HOME, "ref")
CLASS = {1: "Fr", 2: "So", 3: "Jr", 4: "Sr", 5: "Gr", 6: "Gr"}
C_CURRENT_YEAR = 2027


def jaro_winkler(a, b):
    if a == b:
        return 1.0
    la, lb = len(a), len(b)
    if not la or not lb:
        return 0.0
    w = max(la, lb) // 2 - 1
    ma, mb = [False] * la, [False] * lb
    m = 0
    for i, c in enumerate(a):
        for j in range(max(0, i - w), min(lb, i + w + 1)):
            if not mb[j] and b[j] == c:
                ma[i] = mb[j] = True
                m += 1
                break
    if not m:
        return 0.0
    t, k = 0, 0
    for i in range(la):
        if ma[i]:
            while not mb[k]:
                k += 1
            t += a[i] != b[k]
            k += 1
    jaro = (m / la + m / lb + (m - t / 2) / m) / 3
    p = 0
    for x, y in zip(a[:4], b[:4]):
        if x != y:
            break
        p += 1
    return jaro + p * 0.1 * (1 - jaro)


def fetch_bio(season, eids, log=print):
    """ESPN's season-scoped athlete records, kept small and cached."""
    d = os.path.join(BIO, season)
    os.makedirs(d, exist_ok=True)
    year = E.season_year(season)
    todo = [e for e in eids if not os.path.exists(os.path.join(d, f"{e}.json"))]

    def one(eid):
        try:
            a = E.get(f"{E.CORE}/seasons/{year}/athletes/{eid}")
        except Exception:  # noqa
            return 0
        if a is None:
            json.dump({}, open(os.path.join(d, f"{eid}.json"), "w"))
            return 0
        bp = a.get("birthPlace") or {}
        rec = {"name": a.get("displayName"), "first": a.get("firstName"), "last": a.get("lastName"), "ht": a.get("height"), "wt": a.get("weight"), "jersey": a.get("jersey"),
               "city": bp.get("city"), "state": bp.get("state"), "country": bp.get("country"),
               "exp": (a.get("experience") or {}).get("years"), "exp_text": (a.get("experience") or {}).get("displayValue"),
               "headshot": bool((a.get("headshot") or {}).get("href"))}
        json.dump(rec, open(os.path.join(d, f"{eid}.json"), "w"))
        return 1

    n = 0
    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        for ok in ex.map(one, todo):
            n += ok
    log(f"{season}: {n}/{len(todo)} athlete records fetched ({len(eids)} players)")


def load_bio(season, eid):
    try:
        return json.load(open(os.path.join(BIO, season, f"{eid}.json")))
    except (OSError, ValueError):
        return {}


def cbbd_refs(seasons, log=print):
    """Rosters per season and recruits per class, once each, cached in ref/."""
    os.makedirs(REF, exist_ok=True)
    for s in seasons:
        y = E.season_year(s)
        p = os.path.join(REF, f"roster-{y}.json")
        if not os.path.exists(p):
            r, _ = CC.get("/teams/roster", season=y)
            json.dump(r, open(p, "w"))
    for y in range(2010, max(E.season_year(s) for s in seasons) + 1):
        p = os.path.join(REF, f"recruits-{y}.json")
        if not os.path.exists(p):
            r, _ = CC.get("/recruiting/players", year=y)
            json.dump(r, open(p, "w"))
    log(f"CBBD refs in place; ledger {CC.calls_this_month()}")


def team_map(rows, players):
    """T-Rank's team spelling -> ESPN team id, by which roster its names fall on."""
    by_name = defaultdict(Counter)
    for eid, p in players.items():
        by_name["".join(words(p["name"]))][p["team"]] += 1
    votes = defaultdict(Counter)
    for name, team, dob in rows:
        for t, n in by_name.get("".join(words(name)), {}).items():
            votes[team][t] += 1
    return {k: v.most_common(1)[0][0] for k, v in votes.items() if v.most_common(1)[0][1] >= 3}


def match_torvik(season, players, log=print):
    """{eid: birthdate}. Returns the matches and the log of how each was made."""
    p = os.path.join(CC.HOME, "torvik", f"{season}.json")
    if not os.path.exists(p):
        return {}, Counter()
    rows = json.load(open(p))
    tm = team_map(rows, players)
    by_team = defaultdict(dict)
    for eid, x in players.items():
        by_team[x["team"]]["".join(words(x["name"]))] = eid
    out, how = {}, Counter()
    for name, team, dob in rows:
        if not dob:
            continue
        t = tm.get(team)
        if t is None:
            how["team unknown"] += 1
            continue
        n = "".join(words(name))
        roster = by_team.get(t, {})
        if n in roster:
            out[roster[n]] = dob
            how["exact"] += 1
            continue
        best, bs = None, 0.0
        for cand, eid in roster.items():
            s = jaro_winkler(n, cand)
            if s > bs:
                best, bs = eid, s
        if bs >= 0.92:
            out.setdefault(best, dob)
            how["jaro-winkler"] += 1
        else:
            how["no match"] += 1
    return out, how


def age_on_feb1(dob, season):
    try:
        d = dt.date.fromisoformat(dob) if "-" in dob else dt.datetime.strptime(dob, "%m/%d/%Y").date()
    except ValueError:
        return None
    feb1 = dt.date(int(season[:4]) + 1, 2, 1)
    return round((feb1 - d).days / 365.25, 2)


def current_exp(log=print):
    """Every D1 player's class right now, from today's rosters. One request per team."""
    p = os.path.join(REF, "current-exp.json")
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < 86400 * 6:
        return json.load(open(p))
    teams = E.get(f"{E.SITE}/teams?groups=50&limit=500")["sports"][0]["leagues"][0]["teams"]

    def one(t):
        d = E.get(f"{E.SITE}/teams/{t['team']['id']}/roster") or {}
        return [(a["id"], (a.get("experience") or {}).get("years")) for a in d.get("athletes", [])]

    out = {}
    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        for rows in ex.map(one, teams):
            out.update({k: v for k, v in rows if v})
    os.makedirs(REF, exist_ok=True)
    json.dump(out, open(p, "w"))
    log(f"current classes for {len(out)} players")
    return out


def career_span():
    """{eid: (first season year, last season year)} across every season on file."""
    out = {}
    for s in sorted(os.listdir(SZ.OUT)):
        p = os.path.join(SZ.OUT, s, "ids.json")
        if not os.path.exists(p):
            continue
        y = int(s[:4]) + 1
        for e in json.load(open(p))["pos"].keys() | json.load(open(p))["names"].keys():
            a = out.get(e)
            out[e] = (a[0] if a else y, y)
    return out


def class_in(exp_any, cur, span, eid, year):
    """ESPN's "season-scoped" record returns a player's LATEST class, for every season: Braden Smith
    reads Senior in all four of his years. So class is counted back from an anchor: today's roster for
    a current player, else his last season on file. A fifth-year man, whom ESPN caps at Senior, would
    count back to zero; he counts forward from his first season instead."""
    first, last = span.get(eid, (year, year))
    anchor_year, exp = (C_CURRENT_YEAR, cur[eid]) if eid in cur else (last, exp_any)
    if not exp:
        return None
    n = exp - (anchor_year - year)
    if exp - (anchor_year - first) < 1:
        n = 1 + (year - first)
    return CLASS.get(max(1, min(n, 5)))


def load_ages(season):
    p = os.path.join(OUT, f"ages-{season}.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def fixes():
    p = os.path.join(HERE, "manual", "id_fixes.csv")
    if not os.path.exists(p):
        return {}
    return {r["eid"]: r for r in csv.DictReader(open(p))}


def recruits(seasons):
    """{CBBD athlete id: recruit row}, the most recent class a man appears in."""
    out = {}
    for y in range(2010, max(E.season_year(s) for s in seasons) + 1):
        p = os.path.join(REF, f"recruits-{y}.json")
        if os.path.exists(p):
            for r in json.load(open(p)):
                if r.get("athleteId"):
                    out[r["athleteId"]] = r
    return out


def nba_ids():
    p = os.path.join(HERE, "..", "basketball", "seed", "espn_ids.json")
    try:
        d = json.load(open(p))
    except (OSError, ValueError):
        return {}
    return {str(k): v for k, v in (d.get("ids") or d).items()} if isinstance(d, dict) else {}


def build(seasons, log=print):
    os.makedirs(OUT, exist_ok=True)
    known_dob = {}                      # carried forward by id, oldest season first
    report = {}
    rec = recruits(seasons)
    nba = nba_ids()
    fx = fixes()
    # CBBD rosters: ESPN id -> CBBD id and any birthdate
    cb_id, cb_dob, cb_home = {}, {}, {}
    for s in seasons:
        p = os.path.join(REF, f"roster-{E.season_year(s)}.json")
        if os.path.exists(p):
            for t in json.load(open(p)):
                for x in t["players"]:
                    sid = str(x.get("sourceId"))
                    cb_id[sid] = x["id"]
                    cb_home.setdefault(sid, x.get("hometown") or {})
                    if x.get("dateOfBirth"):
                        cb_dob[sid] = str(x["dateOfBirth"])[:10]
    cur = current_exp(log)
    span = career_span()
    # T-Rank's files for 2013-14 to 2021-22 carried no readable birthdate on Nov 2, 2026, so those
    # seasons take a date from any later season's match, or from Basketball Savant for NBA players.
    nba_dob = {}
    bd = os.path.expanduser("~/Basketball-Savant/aging_birthdates.json")
    if os.path.exists(bd):
        raw = json.load(open(bd))
        rev = {str(v): k for k, v in nba.items()}
        for pid, v in raw.items():
            if str(pid) in rev and v:
                nba_dob[rev[str(pid)]] = str(v)[:10]
    for s in sorted(seasons, reverse=True):              # a first pass, newest first, so dates carry back
        p = os.path.join(SZ.OUT, s, "ids.json")
        if not os.path.exists(os.path.join(CC.HOME, "torvik", f"{s}.json")):
            continue
        ids0 = json.load(open(p))
        pg0 = pd.read_pickle(os.path.join(SZ.OUT, s, "pg.pkl"))[["eid", "team", "min"]]
        m0 = pg0.groupby(["eid", "team"])["min"].sum().reset_index().sort_values("min", ascending=False).drop_duplicates("eid").set_index("eid")["team"].to_dict()
        d0, _ = match_torvik(s, {e: {"name": ids0["names"].get(e, ""), "team": t} for e, t in m0.items()})
        for e, v in d0.items():
            known_dob.setdefault(e, v)
    for e, v in nba_dob.items():
        known_dob.setdefault(e, v)
    for s in sorted(seasons):
        d = os.path.join(SZ.OUT, s)
        pg = pd.read_pickle(os.path.join(d, "pg.pkl"))
        y0 = int(s[:4])
        pp = os.path.join(OUT, f"{y0 - 1}-{str(y0)[2:]}.json")
        prev_age = {e: v.get("age") for e, v in json.load(open(pp)).items()} if os.path.exists(pp) else {}
        ids = json.load(open(os.path.join(d, "ids.json")))
        played = pg[(pg["min"] > 0) | (pg.sec > 0)]
        mins = played.groupby(["eid", "team"])["min"].sum().reset_index().sort_values("min", ascending=False)
        main = mins.drop_duplicates("eid").set_index("eid")["team"].to_dict()
        fetch_bio(s, sorted(main), log=log)
        players = {e: {"name": ids["names"].get(e, ""), "team": t} for e, t in main.items()}
        dob, how = match_torvik(s, players, log=log)
        # T-Rank refuses GitHub's runners, so the Mac sends ages for the season in progress (ages only:
        # this branch is public). cloud_cbb.py ages writes them.
        sent = load_ages(s)
        for e, v in dob.items():
            known_dob.setdefault(e, v)
        rows = {}
        src = Counter()
        ages_bad = []
        for e, t in main.items():
            b = load_bio(s, e)
            age, used = None, None
            v = dob.get(e) or known_dob.get(e)
            if v:
                used = "t-rank" if e in dob else "t-rank (other season)"
            elif cb_dob.get(e):
                v, used = cb_dob[e], "cbbd"
            if v is None and prev_age.get(e):          # the cloud carries ages, never birthdates
                age_c = prev_age[e] + 1.0
                src["last season's age"] += 1
            else:
                age_c = None
            if e in fx and fx[e].get("birthdate"):
                v, used = fx[e]["birthdate"], "manual"
            if v:
                age = age_on_feb1(v, s)
                if age is not None and not 16 <= age <= 27:
                    ages_bad.append([e, players[e]["name"], age])
                    age = None
            if age is None and sent.get(e) is not None:
                age = sent[e]
                src["ages from the Mac"] += 1
            if age is None and age_c is not None:
                age = round(age_c, 2)
            elif age_c is None:
                src[used or "none"] += 1
            r = rec.get(cb_id.get(e))
            exp = class_in(b.get("exp"), cur, span, e, int(s[:4]) + 1)
            rows[e] = {"name": b.get("name") or players[e]["name"], "team": t, "ht": b.get("ht"), "wt": b.get("wt"), "jersey": b.get("jersey"),
                       "cls": exp, "city": b.get("city"), "state": b.get("state"), "country": b.get("country"), "age": age,
                       "headshot": bool(b.get("headshot")), "listed": ids["pos"].get(e),
                       "rec": None if not r else {"stars": r.get("stars"), "rating": r.get("rating"), "rank": r.get("ranking"), "hs": r.get("school"), "year": r.get("year"), "pos": r.get("position")},
                       "nba": nba.get(e)}
        json.dump(rows, open(os.path.join(OUT, f"{s}.json"), "w"), separators=(",", ":"))
        have = sum(1 for r in rows.values() if r["age"] is not None)
        report[s] = dict(players=len(rows), age=have, age_rate=round(have / max(1, len(rows)), 4), sources=dict(src), match=dict(how), ages_out_of_range=ages_bad[:40], n_out=len(ages_bad),
                         cls=sum(1 for r in rows.values() if r["cls"]), ht=sum(1 for r in rows.values() if r["ht"]), recruits=sum(1 for r in rows.values() if r["rec"]), nba=sum(1 for r in rows.values() if r["nba"]))
        log(f"{s}: {report[s]}")
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
    return report


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    logf = lambda m: print(time.strftime("%H:%M:%S"), str(m)[:900], flush=True)  # noqa: E731
    try:
        cbbd_refs(a, log=logf)
    except CC.BudgetExhausted as e:            # bios still build; recruits wait for next month
        logf(f"CBBD refs skipped: {e}")
    build(a, log=logf)
