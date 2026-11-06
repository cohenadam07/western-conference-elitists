"""
rosters.py — where every player-season came from, and where it went (spec §4 F, build step 3).

    python3 rosters.py           -> <CBCS_OUT>/rosters.json.gz, rosters-check.json

The .pkl files read here are College Savant's own intermediate tables, written by season.py on this
Mac or in the same cloud run; nothing downloaded is ever unpickled.

Membership. Who played for whom each season comes from College Basketball Savant's own player-game
tables (`rebuilt/<season>/pg.pkl`), which exist for every season from 2006-07 even where the box
gate fails, so a 2013-14 player's 2012-13 team is known though 2012-13 is not on the site. CBBD's
season rosters (cached under out/cbb/ref, ESPN ids in `sourceId`) add the men who were on a roster
and did not play: redshirts, injured years, a transfer's sit-out year.

The source label, first rule that fits, for each player-season on the site:
  returning      played for this team in an earlier season (or sat on its roster last season)
  transfer       his last D1 season (up to three back) was for another D1 team, or he was on
                 another D1 team's roster last season
  hs             no D1 past and a high-school recruiting row (CBBD composite, class of this fall
                 or the one before, for a prep year), or a freshman with no row (unrated)
  intl           no D1 past, no recruiting row, and an ESPN hometown outside the United States
  juco           no D1 past, sophomore or older, US hometown: a junior-college or other non-D1
                 transfer. ESPN does not say which, so the label says "JUCO or non-D1".
Every player-season gets one. Rows carry Savant value (points over replacement) and its rate per
100 possessions, from the season files College Savant publishes, and the season's role: minutes
÷ (40 × the team's games), which counts availability.

Next stop: stayed, transferred (and where), or left D1, with NBA games where Basketball Savant has
the same ESPN id (ESPN uses one athlete id for college and the NBA; College Savant checked 219 of
219 linked players by name).

Recruiting: CBBD's composite rows (2007 on) by athlete id -> ESPN id through CBBD's rosters. The
class score is WCE's own: Σ composite rating of a school's signees, best first, each weighted
0.85^(i-1); ranked among D1 schools. CBBD's rows stay on the Mac; only the score, rank and the
player's stars ship.

The check (spec step 3): every player-season has a label; transfers inferred from ESPN box scores
against CBBD's transfer portal (2021 on, no dates) both ways.
"""
import gzip
import json
import os
import re
import sys
from collections import Counter, defaultdict

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "basketball"))

from namematch import words as _words  # noqa: E402


def words(x):
    return tuple(_words(x))

OUT = os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs")
CBB = os.environ.get("COLLEGE_HOME") or os.path.expanduser("~/Basketball-Savant/out/cbb")
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
REF = os.path.join(CBB, "ref")
US = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI".split())
US_NAMES = {"Puerto Rico", "Virgin Islands", "Guam", "USA", "United States"}
CLASS_W = 0.85


def season_label(y):
    return f"{y - 1}-{str(y)[2:]}"


def year_of(season):
    return int(season[:4]) + 1


def all_seasons():
    return [season_label(y) for y in range(2007, 2028)]


def site_seasons():
    d = json.loads(gzip.open(os.path.join(PUBLIC, "cbb", "index.json.gz")).read())
    return [s["season"] for s in d["seasons"]]


def membership():
    """{season: {eid: (team, minutes, games)}} for D1 teams, main team by minutes; and D1 sets."""
    mem, d1 = {}, {}
    for s in all_seasons():
        p = os.path.join(CBB, "rebuilt", s, "pg.pkl")
        if not os.path.exists(p):
            continue
        G = pd.read_pickle(os.path.join(CBB, "rebuilt", s, "games.pkl"))[["gid", "home", "away", "non_d1", "nd"]]
        nd = set()
        for v in G.nd.dropna():
            nd.update(x for x in str(v).split(",") if x)
        teams = (set(G.home) | set(G.away)) - nd - {None}
        d1[s] = teams
        pg = pd.read_pickle(p)[["gid", "eid", "team", "min"]]
        pg = pg[pg.team.isin(teams) & (pg["min"] > 0)]
        agg = pg.groupby(["eid", "team"]).agg(m=("min", "sum"), g=("gid", "nunique")).reset_index().sort_values("m", ascending=False)
        top = agg.drop_duplicates("eid")
        mem[s] = {r.eid: (r.team, float(r.m), int(r.g)) for r in top.itertuples()}
    return mem, d1


def cbbd_rosters():
    """{season: {eid: espn team id}} from CBBD's rosters (they carry ESPN ids), and the id maps."""
    out, aid = {}, {}
    for y in range(2003, 2028):
        p = os.path.join(REF, f"roster-{y}.json")
        if not os.path.exists(p):
            continue
        m = {}
        for t in json.load(open(p)):
            for pl in t.get("players") or []:
                if pl.get("sourceId") and t.get("teamSourceId"):
                    m[str(pl["sourceId"])] = str(t["teamSourceId"])
                    aid[pl["id"]] = str(pl["sourceId"])
        out[season_label(y)] = m
    return out, aid


def recruits(aid):
    """{eid: recruit row (slim)}, and [rows] per (class year, committed school name)."""
    by_eid, rows = {}, []
    for y in range(2007, 2028):
        for d in (os.path.join(OUT, "cbbd"), REF):
            p = os.path.join(d, f"recruits-{y}.json")
            if os.path.exists(p):
                for r in json.load(open(p)) or []:
                    eid = aid.get(r.get("athleteId"))
                    slim = dict(year=r.get("year"), stars=r.get("stars"), rating=r.get("rating"), rank=r.get("ranking"),
                                school=(r.get("committedTo") or {}).get("name"), eid=eid, name=r.get("name"))
                    rows.append(slim)
                    if eid:
                        by_eid[eid] = slim
                break
    return by_eid, rows


def cbbd_team_map():
    """CBBD team id and school name -> ESPN team id."""
    by_id, by_name = {}, {}
    p = os.path.join(REF, "teams-2026.json")
    for t in json.load(open(p)):
        if t.get("sourceId"):
            by_id[t["id"]] = str(t["sourceId"])
            by_name[t.get("school")] = str(t["sourceId"])
    return by_id, by_name


def intl(hometown):
    tail = (hometown or "").split(",")[-1].strip()
    if not tail:
        return None
    return not (tail in US or tail in US_NAMES)


def build(log=print):
    mem, d1 = membership()
    ros, aid = cbbd_rosters()
    rec, rec_rows = recruits(aid)
    seasons = [s for s in site_seasons() if os.path.exists(os.path.join(PUBLIC, "cbb", "s", f"{s}.json.gz"))]
    order = all_seasons()
    games_per_team = {}
    for s in order:
        p = os.path.join(CBB, "rebuilt", s, "games.pkl")
        if os.path.exists(p):
            G = pd.read_pickle(p)
            games_per_team[s] = Counter(list(G.home) + list(G.away))
    # the season in progress: count its games from this pipeline's own parse (games.py), which the nightly
    # refresh keeps current; College Savant's table on the Mac can be days behind (found Nov 6 2026)
    cur = seasons[-1]
    gp_cur = os.path.join(OUT, "games", f"{cur}.json.gz")
    if os.path.exists(gp_cur):
        c = Counter()
        for g in json.loads(gzip.open(gp_cur).read()):
            c[g["home"]] += 1; c[g["away"]] += 1
        games_per_team[cur] = c
    nba = nba_ids()
    out = {}
    labels = Counter()
    for s in seasons:
        d = json.loads(gzip.open(os.path.join(PUBLIC, "cbb", "s", f"{s}.json.gz")).read())
        P = d["players"]
        val = d["values"]["value"]["r"]
        rate = d["vparts"]["rate"]
        poss = d["samples"]["poss"]
        i_s = order.index(s)
        prior = order[max(0, i_s - 3):i_s][::-1]          # up to three seasons back, newest first
        nxt = order[i_s + 1] if i_s + 1 < len(order) else None
        teams = defaultdict(list)
        # a team has played at least as many games as any of its players (the game tables can lag the season file)
        most_gp = defaultdict(int)
        for p in P:
            most_gp[p[2]] = max(most_gp[p[2]], p[8] or 0)
        for i, p in enumerate(P):
            eid, name, team, pos, cls = p[0], p[1], p[2], p[3], p[4]
            mins = p[10] or 0
            prev_team = prev_season = None
            for q in prior:
                hit = mem.get(q, {}).get(eid)
                if hit:
                    prev_team, prev_season = hit[0], q
                    break
            last = order[i_s - 1] if i_s > 0 else None
            ros_last = ros.get(last, {}).get(eid) if last else None
            r = rec.get(eid)
            yr = year_of(s) - 1                            # the fall this season starts
            ht = p[15]
            if prev_team == team or (prev_team is None and ros_last == team):
                src = "returning"
            elif prev_team is not None or (ros_last and ros_last != team and ros_last in d1.get(last, ())):
                src = "transfer"
                if prev_team is None:
                    prev_team, prev_season = ros_last, last
            elif r and r.get("year") in (yr, yr - 1):
                src = "hs"
            elif cls == "Fr" and not intl(ht):
                src = "hs"
            elif intl(ht):
                src = "intl"
            else:
                src = "juco"
            labels[src] += 1
            # next stop
            nx = None
            if nxt and nxt in mem:
                h = mem[nxt].get(eid)
                if h and h[0] == team:
                    nx = {"to": "stayed"}
                elif h:
                    nx = {"to": "transfer", "team": h[0]}
                elif ros.get(nxt, {}).get(eid) == team:
                    nx = {"to": "stayed", "dnp": True}
                else:
                    nx = {"to": "left"}
                    if eid in nba:
                        nx.update(to="nba", nba=nba[eid])
            tg = max(games_per_team.get(s, {}).get(team) or 0, most_gp[team])
            role = round(mins / (40.0 * tg), 4) if tg else None
            teams[team].append(dict(eid=eid, name=name, pos=pos, cls=cls, src=src, prev=prev_team, prev_season=prev_season,
                                    min=mins, gp=p[8], role=role, value=val[i], rate=rate[i], poss=poss[i], qual=p[11],
                                    stars=(r or {}).get("stars"), rrank=(r or {}).get("rank"), rrating=(r or {}).get("rating"),
                                    ryear=(r or {}).get("year"), intl=intl(ht), next=nx))
        out[s] = dict(teams)
        log(f"{s}: {sum(len(v) for v in teams.values())} player-seasons, {len(teams)} teams")
    classes = class_scores(rec_rows)
    check = portal_check(out, mem)
    check["labels"] = dict(labels)
    check["unlabelled"] = sum(1 for s in out.values() for t in s.values() for r in t if not r["src"])
    with open(os.path.join(OUT, "rosters.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps({"seasons": out, "classes": classes}, separators=(",", ":")).encode(), 6, mtime=0))
    json.dump(check, open(os.path.join(OUT, "rosters-check.json"), "w"), indent=1)
    log(json.dumps({k: v for k, v in check.items() if k != "examples"}))
    return out, classes, check


def class_scores(rows):
    """{class year: {school: [score, rank, n, top stars]}}: WCE's class score (docstring)."""
    _, by_name = cbbd_team_map()
    out = {}
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r.get("school") and r.get("rating") is not None:
            by[r["year"]][r["school"]].append(r)
    for y, schools in by.items():
        sc = {}
        for sch, rs in schools.items():
            rs.sort(key=lambda x: -(x["rating"] or 0))
            sc[sch] = (sum((x["rating"] or 0) * CLASS_W ** i for i, x in enumerate(rs)), len(rs), max((x["stars"] or 0) for x in rs))
        ranked = sorted(sc.items(), key=lambda kv: -kv[1][0])
        out[y] = {by_name.get(sch, "?" + sch): [round(v[0], 3), i + 1, v[1], v[2]] for i, (sch, v) in enumerate(ranked)}
    return out


def nba_ids():
    """{ESPN college id: NBA id}: College Savant's own link table (links.json, built from Basketball
    Savant's seed/espn_ids.json), so a player's NBA stop links to Basketball Savant."""
    try:
        return json.loads(gzip.open(os.path.join(PUBLIC, "cbb", "links.json.gz")).read()).get("nba") or {}
    except (OSError, ValueError):
        return {}


def portal_check(out, mem):
    """Transfers inferred from ESPN box scores against CBBD's portal, both ways (2021 on)."""
    by_id, by_name = cbbd_team_map()
    res = {"seasons": {}, "examples": []}
    for y in range(2021, 2028):
        p = os.path.join(OUT, "cbbd", f"portal-{y}.json")
        if not os.path.exists(p):
            continue
        s = season_label(y + 1)               # the class of spring/summer y plays season y-(y+1)
        if s not in out:
            continue
        portal = json.load(open(p)) or []
        ours = {r["eid"]: (t, r) for t, rows in out[s].items() for r in rows if r["src"] == "transfer"}
        names = {}
        for t, rows in out[s].items():
            for r in rows:
                names[(t, words(r["name"] or ""))] = r
        found = agree = 0
        moved = 0
        for x in portal:
            dst = by_id.get((x.get("destination") or {}).get("id"))
            org = by_id.get((x.get("origin") or {}).get("id"))
            if not dst or not org:
                continue
            nm = words(f"{x.get('firstName', '')} {x.get('lastName', '')}")
            r = names.get((dst, nm))
            if not r:
                continue
            moved += 1
            found += r["src"] == "transfer"
            agree += r["src"] == "transfer" and r["prev"] == org
            if r["src"] != "transfer" and len(res["examples"]) < 15:
                res["examples"].append([s, r["name"], dst, org, r["src"], r["prev"]])
        # the other way: our transfers from a D1 team last season that the portal lists
        last = season_label(y)
        in_portal = 0
        keyset = set()
        for x in portal:
            dst = by_id.get((x.get("destination") or {}).get("id"))
            keyset.add((dst, words(f"{x.get('firstName', '')} {x.get('lastName', '')}")))
        recent = [(t, r) for t, r in ours.values() if r["prev_season"] == last]
        for t, r in recent:
            in_portal += (t, words(r["name"] or "")) in keyset
        res["seasons"][s] = dict(portal_rows=len(portal), portal_d1_to_d1_on_site=moved, ours_transfer=found,
                                 ours_same_origin=agree, ours_recent_transfers=len(recent), in_portal=in_portal,
                                 portal_match=round(found / max(1, moved), 4), origin_match=round(agree / max(1, found), 4),
                                 ours_in_portal=round(in_portal / max(1, len(recent)), 4))
    return res


def load():
    return json.loads(gzip.open(os.path.join(OUT, "rosters.json.gz")).read())


if __name__ == "__main__":
    build()
