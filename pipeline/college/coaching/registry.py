"""
registry.py — who the head coaches are, and who coached every D1 game (spec §4 J, build step 1).

    python3 registry.py          -> <CBCS_OUT>/registry.json, registry-check.json

Three sources, each row keeping its own URL:
  infobox   Wikipedia's team-season article, `Infobox NCAA team season`: head coach, an (Interim)
            tag, the season record, the assistants (wiki_seasons.py)
  program   Wikipedia's program history: yearly records with W-L per coach-season, coach lists by
            tenure (wiki.py; tenure expansions the page does not confirm season by season are tagged
            unconfirmed there)
  espn      ESPN's season coaches (espn_coaches.py): a stable coach id, a birthdate for some, the
            team and W-L. Teams are mapped from 2013-14 on (measured); an entry at 0-0 next to one with
            games is the off-season hire, and is dropped for that season.

One head coach per team-season unless the season was split. Order of trust: the infobox, then a
yearly-record or table row, then ESPN, then a tenure expansion. A season is `confirmed` when a
season-specific source names him (infobox or yearly record) or two sources agree; otherwise it is
`unconfirmed` and listed for review.

Split seasons: when the sources name two coaches with W-L for each, the season's games are cut
where the running record first equals the first man's (Basketball Coaching Savant's rule). Without
both records the cut is unknown: every game goes to the infobox's coach and the season is listed,
unconfirmed. An interim who coached the whole season (Louisville 2017-18) is that season's coach. Where none of the
three covers a team-season, a coach biography's head-coaching stint at that program fills it, unconfirmed.

Records reconcile with the games: each coach-team-season's W-L against the games ESPN has (exact, and
within 1, since ESPN lacks a few games against non-D1 teams); vacated records on Wikipedia are told apart (fewer
wins than played, losses equal: Syracuse 2004-05 and 2006-07, Arizona 2017-18).

Coach ids: the Wikipedia title's slug where there is a linked article, otherwise the name's slug with
the team id. ESPN's coach id is carried as `espn`.
"""
import gzip
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import espn_coaches as EC  # noqa: E402
import games as GM  # noqa: E402
import rosters as RS  # noqa: E402

OUT = RS.OUT
CBB = RS.CBB
SEASONS = [RS.season_label(y) for y in range(2003, 2028)]
HIST_FROM = 1900


def slug(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def nkey(name):
    """A name key for matching across sources: letters only, no suffix, no middle initial."""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    parts = [p for p in re.split(r"[^a-z]+", s) if p and len(p) > 1]
    return (parts[0], parts[-1]) if len(parts) >= 2 else tuple(parts)


BAD = {"first", "second", "third", "tbd", "tba", "vacant", "none", "interim", "head coach", "coach"}


def valid_name(name):
    """A person's name: two words or more, no digits, not a heading or a program title (the table
    parser has returned "First", "Second" and a program article's title as coaches)."""
    n = (name or "").strip()
    if not n or n.lower() in BAD or re.search(r"\d", n) or "basketball" in n.lower() or "season" in n.lower():
        return False
    return len([w for w in re.split(r"\s+", n) if w]) >= 2


def bio_heads(BIO, P):
    """{(team id, season): [(name, title, source url)]} from coach biographies' head stints whose team
    links to the program's article: the fallback for team-seasons no other source covers."""
    art = {}
    for tid, x in P.items():
        if x.get("article"):
            art[x["article"]] = tid
            art[x["article"].replace(" men's basketball", " basketball")] = tid
    out = defaultdict(list)
    for title, b in BIO.items():
        for st in b.get("stints") or []:
            if st.get("role") != "head" or st.get("from") is None:
                continue
            tid = art.get(st.get("team_title") or "")
            if not tid:
                continue
            to = st.get("to") or 2027
            for y in range(st["from"], to):
                out[(tid, f"{y}-{str(y + 1)[2:]}")].append((b.get("name") or title, b.get("resolved_title") or title, b.get("source_url")))
    return out


def team_names():
    out = {}
    d = os.path.join(RS.PUBLIC, "cbb", "teams")
    for f in sorted(os.listdir(d)):
        for t in json.loads(gzip.open(os.path.join(d, f)).read())["teams"]:
            out[t["id"]] = dict(name=t.get("name"), full=t.get("full"), abbr=t.get("abbr"), color=t.get("color"), alt=t.get("alt"))
    return out


def season_games():
    """{season: {team: [(date, gid, won)]}} in date order, every game on file (2002-03 on)."""
    out = {}
    for s in SEASONS:
        p = os.path.join(OUT, "games", f"{s}.json.gz")
        rows = []
        if os.path.exists(p):
            for g in GM.load(s):
                rows.append((g["date"], g["gid"], g["home"], g["away"], g["hs"], g["as_"]))
        else:
            q = os.path.join(CBB, "rebuilt", s, "games.pkl")      # College Savant's own table, written on this Mac
            if not os.path.exists(q):
                continue
            G = pd.read_pickle(q)
            rows = [(r.date, r.gid, r.home, r.away, r.hs, r.as_) for r in G.itertuples()]
        by = defaultdict(list)
        for date, gid, h, a, hs, as_ in rows:
            if hs == as_:
                continue
            by[h].append((date, gid, hs > as_))
            by[a].append((date, gid, as_ > hs))
        for t in by:
            by[t].sort()
        out[s] = dict(by)
    return out


def espn_by_ts():
    out = defaultdict(list)
    for y in range(2014, 2028):
        s = RS.season_label(y)
        for c in EC.load_year(y):
            if c["team"]:
                out[(s, c["team"])].append(c)
    # drop the off-season hire listed at 0-0 beside a man with games
    for k, v in out.items():
        if len(v) > 1 and any((c["w"] or 0) + (c["l"] or 0) > 0 for c in v):
            out[k] = [c for c in v if (c["w"] or 0) + (c["l"] or 0) > 0]
    return out


def build(log=print):
    P = json.load(open(os.path.join(OUT, "wiki", "programs.json")))
    WS = json.load(open(os.path.join(OUT, "wiki", "seasons.json")))
    BIO = json.load(open(os.path.join(OUT, "wiki", "coaches.json")))
    ESP = espn_by_ts()
    for tid in P:
        P[tid]["seasons"] = [r for r in (P[tid].get("seasons") or []) if valid_name(r.get("coach"))]
    for tid in WS:
        WS[tid] = {k: v for k, v in WS[tid].items() if valid_name(v.get("coach"))}
    BH = bio_heads(BIO, P)
    names = team_names()
    games = season_games()
    coaches = {}
    by_title, by_key = {}, defaultdict(set)

    def coach_id(name, title, team):
        """One id per person: the Wikipedia title if linked, else a match by name key among coaches
        already seen at this team or with this exact name, else the name with the team."""
        if title:
            t = title.split("#")[0]
            if t in by_title:
                return by_title[t]
            cid = slug(t)
            by_title[t] = cid
        else:
            k = nkey(name)
            hits = [c for c in by_key.get(k, ()) if team in coaches[c]["teams"]]
            if hits:
                return hits[0]
            hits = list(by_key.get(k, ()))
            cid = hits[0] if len(hits) == 1 else slug(name) + "-" + str(team)
        if cid not in coaches:
            bio = BIO.get(title) if title else None
            coaches[cid] = dict(id=cid, name=name, wiki=title, wiki_url=(bio or {}).get("source_url") or (f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}" if title else None),
                                born=(bio or {}).get("born"), birthplace=(bio or {}).get("birthplace"), espn=None, teams=set())
        coaches[cid]["teams"].add(team)
        by_key[nkey(name)].add(cid)
        return cid

    ts = {}                         # (team, season) -> [rows]
    review = []
    for tid in sorted(set(P) | set(WS) | {k[1] for k in ESP} | {t for t, _ in BH}):
        prog = (P.get(tid) or {}).get("seasons") or []
        by_season = defaultdict(list)
        for r in prog:
            by_season[r["season"]].append(r)
        seasons_here = set(by_season) | set((WS.get(tid) or {}).keys()) | {s for (s, t) in ESP if t == tid} | {s for (t, s) in BH if t == tid}
        for s in sorted(seasons_here):
            if int(s[:4]) < HIST_FROM:
                continue
            ib = (WS.get(tid) or {}).get(s)
            pr = by_season.get(s, [])
            es = ESP.get((s, tid), [])
            firm = [r for r in pr if r.get("how") in ("yearly_record", "table") and not r.get("unconfirmed")]
            rows = []
            if ib and len(firm) >= 2 and any(nkey(r["coach"]) == nkey(ib["coach"]) for r in firm):
                rows = [dict(name=r["coach"], title=r.get("coach_title"), w=r.get("w"), l=r.get("l"), interim=bool(r.get("interim")), src=[r["source_url"], ib["source_url"]]) for r in firm]
            elif ib:
                agree = [r for r in pr if nkey(r["coach"]) == nkey(ib["coach"])]
                ttl = ib.get("coach_title") or next((r.get("coach_title") for r in agree if r.get("coach_title")), None)
                rows = [dict(name=ib["coach"], title=ttl, w=ib.get("w"), l=ib.get("l"), interim=ib["interim"] or any(r.get("interim") for r in agree),
                             src=[ib["source_url"]] + [r["source_url"] for r in agree][:1])]
                others = [r for r in pr if nkey(r["coach"]) != nkey(ib["coach"]) and r.get("how") in ("yearly_record", "table")]
                if others and ib.get("lead_interim"):
                    review.append(dict(team=tid, season=s, why="infobox names one coach, the program list another, the lead mentions an interim",
                                       infobox=ib["coach"], program=[r["coach"] for r in others], src=ib["source_url"]))
            elif firm:
                rows = [dict(name=r["coach"], title=r.get("coach_title"), w=r.get("w"), l=r.get("l"), interim=bool(r.get("interim")), src=[r["source_url"]]) for r in firm]
            elif es:
                rows = [dict(name=f"{c['first']} {c['last']}", title=None, w=c["w"], l=c["l"], interim=False, src=[c["source"]]) for c in es]
            elif pr:
                rows = [dict(name=r["coach"], title=r.get("coach_title"), w=r.get("w"), l=r.get("l"), interim=bool(r.get("interim")), src=[r["source_url"]], unconfirmed=True) for r in pr]
            elif BH.get((tid, s)):
                rows = [dict(name=n, title=t_, w=None, l=None, interim=False, src=[u], unconfirmed=True, how="biography") for n, t_, u in BH[(tid, s)][:2]]
            if not rows:
                continue
            # confirmation and the ESPN id
            for r in rows:
                kinds = set()
                if ib and nkey(ib["coach"]) == nkey(r["name"]):
                    kinds.add("infobox")
                if any(nkey(x["coach"]) == nkey(r["name"]) and x.get("how") == "yearly_record" for x in pr):
                    kinds.add("yearly")
                if any(nkey(x["coach"]) == nkey(r["name"]) for x in pr):
                    kinds.add("program")
                match = [c for c in es if nkey(f"{c['first']} {c['last']}") == nkey(r["name"])]
                if match:
                    kinds.add("espn")
                    r["espn"] = match[0]["cid"]
                    r["espn_w"], r["espn_l"] = match[0]["w"], match[0]["l"]
                    if match[0]["source"] not in r["src"]:
                        r["src"].append(match[0]["source"])
                    r["born"] = match[0]["born"]
                    r["birthplace"] = match[0]["birthplace"]
                r["confirmed"] = bool(kinds & {"infobox", "yearly"}) or len(kinds) >= 2
                if r.get("unconfirmed"):
                    r["confirmed"] = len(kinds) >= 2
                r["sources"] = sorted(kinds)
                if es and not match and s >= "2014-15":
                    review.append(dict(team=tid, season=s, why="ESPN names a different coach", ours=r["name"], espn=[f"{c['first']} {c['last']}" for c in es], src=r["src"][0]))
            # dedupe one person twice
            seen, uniq = set(), []
            for r in rows:
                k = nkey(r["name"])
                if k not in seen:
                    seen.add(k); uniq.append(r)
            rows = uniq
            for r in rows:
                r["coach"] = coach_id(r["name"], r.get("title"), tid)
                c = coaches[r["coach"]]
                if r.get("espn"):
                    c["espn"] = c["espn"] or r["espn"]
                    c["born"] = c["born"] or r.get("born")
                    c["birthplace"] = c["birthplace"] or r.get("birthplace")
            ts[(tid, s)] = rows
    # ---------------------------------------------------------------- one person, one id
    # A season row with no linked article gets its own id (name + team) when it comes first: John
    # Calipari's UMass seasons became "john-calipari-113" beside his linked id. Merge such an id into a
    # linked coach of the same name only when that coach's own biography lists a head-coaching stint at
    # the program in that season, so a namesake is never merged.
    merged = {}
    titled = defaultdict(list)
    for cid, c in coaches.items():
        if c.get("wiki"):
            titled[nkey(c["name"])].append(cid)
    rows_of = defaultdict(list)
    for (tid, s), rows in ts.items():
        for r in rows:
            rows_of[r["coach"]].append((tid, s))
    for cid, c in list(coaches.items()):
        if c.get("wiki"):
            continue
        for cand in titled.get(nkey(c["name"]), []):
            ttl = coaches[cand]["wiki"]
            if any(any(t_ == ttl or n_ == ttl for n_, t_, _ in BH.get(k, [])) for k in rows_of[cid]):
                merged[cid] = cand
                break
    for (tid, s), rows in ts.items():
        for r in rows:
            if r["coach"] in merged:
                r["coach"] = merged[r["coach"]]
    for old, new in merged.items():
        c = coaches.pop(old)
        n = coaches[new]
        n["teams"] |= set(c["teams"])
        n["espn"] = n["espn"] or c["espn"]
        n["born"] = n["born"] or c["born"]
    # ---------------------------------------------------------------- one head coach per team-game
    who = defaultdict(dict)          # season -> gid -> team -> coach
    rec = []
    for (tid, s), rows in ts.items():
        gl = games.get(s, {}).get(tid)
        if not gl:
            continue
        if len(rows) == 1:
            for date, gid, won in gl:
                who[s].setdefault(gid, {})[tid] = rows[0]["coach"]
            rows[0]["games"] = [gl[0][0], gl[-1][0], len(gl), sum(1 for x in gl if x[2]), sum(1 for x in gl if not x[2])]
            continue
        first = rows[0]
        if first.get("w") is not None and first.get("l") is not None and rows[1].get("w") is not None:
            w = l = 0
            cut = None
            for i, (date, gid, won) in enumerate(gl):
                w += won; l += not won
                if w == first["w"] and l == first["l"]:
                    cut = i + 1
                    break
            if cut is None:
                cut = min(len(gl), (first["w"] or 0) + (first["l"] or 0))
                review.append(dict(team=tid, season=s, why="split season: the running record never equals the first coach's", first=first["name"], src=first["src"][0]))
                for r in rows:
                    r["confirmed"] = False
            parts = [gl[:cut], gl[cut:]]
            for r, part in zip(rows[:2], parts):
                for date, gid, won in part:
                    who[s].setdefault(gid, {})[tid] = r["coach"]
                r["games"] = [part[0][0], part[-1][0], len(part), sum(1 for x in part if x[2]), sum(1 for x in part if not x[2])] if part else None
            for r in rows[2:]:
                r["games"] = None
            rows[0]["split"] = rows[1]["split"] = True
        else:
            # the cut is unknown: the infobox's coach (or the first) gets every game; flagged
            main = next((r for r in rows if "infobox" in r["sources"]), rows[0])
            for date, gid, won in gl:
                who[s].setdefault(gid, {})[tid] = main["coach"]
            main["games"] = [gl[0][0], gl[-1][0], len(gl), sum(1 for x in gl if x[2]), sum(1 for x in gl if not x[2])]
            for r in rows:
                r["confirmed"] = False
                r["split_unknown"] = True
            review.append(dict(team=tid, season=s, why="split season without both records: every game to " + main["name"], coaches=[r["name"] for r in rows], src=main["src"][0]))
    # ---------------------------------------------------------------- the checks
    check = dict(team_seasons=len(ts), coaches=len(coaches), merged_ids=len(merged), merged_examples=sorted(merged.items())[:15])
    two = sum(1 for s, gm in who.items() for gid, tm in gm.items() if len(set(tm.values())) != len(tm))
    covered = Counter()
    missing = []
    for s, by in games.items():
        for tid, gl in by.items():
            if tid not in names:
                continue
            n_ok = sum(1 for d, gid, w in gl if who.get(s, {}).get(gid, {}).get(tid))
            covered[s] += n_ok
            covered[s + "_all"] += len(gl)
            if n_ok < len(gl):
                missing.append([s, tid, names[tid]["full"], len(gl) - n_ok])
    check["team_games_with_one_coach"] = {s: round(covered[s] / max(1, covered[s + "_all"]), 4) for s in SEASONS if covered[s + "_all"]}
    check["team_games_missing_coach"] = len(missing)
    check["missing_examples"] = missing[:40]
    check["one_coach_per_team_game"] = two == 0
    exact = within1 = n = vac = 0
    era = [0, 0, 0]
    bad = []
    for (tid, s), rows in ts.items():
        for r in rows:
            g = r.get("games")
            if not g or r.get("w") is None or r.get("split_unknown"):
                continue
            n += 1
            dw, dl = g[3] - r["w"], g[4] - r["l"]
            if dw == 0 and dl == 0:
                exact += 1
            if s >= "2013-14" and not (r["w"] < g[3] and abs(dl) <= 1):
                era[0] += 1; era[1] += dw == 0 and dl == 0; era[2] += abs(dw) <= 1 and abs(dl) <= 1
            if abs(dw) <= 1 and abs(dl) <= 1:
                within1 += 1
            elif (r["w"] == 0 and g[3] > 0) or (r["w"] < g[3] and abs(dl) <= 1):
                vac += 1
                r["vacated"] = True
            else:
                bad.append([s, tid, r["name"], [r["w"], r["l"]], g[3:5], r["src"][0]])
    check["records"] = dict(n=n, exact=round(exact / max(1, n), 4), within1=round(within1 / max(1, n), 4), vacated=vac, off=len(bad), examples=bad[:30])
    rows_all = [r for rows in ts.values() for r in rows]
    check["records_stats_era"] = dict(n=era[0], exact=round(era[1] / max(1, era[0]), 4), within1=round(era[2] / max(1, era[0]), 4),
                                      passes=era[2] / max(1, era[0]) >= 0.97)
    check["sourced"] = all(r.get("src") for r in rows_all)
    check["unconfirmed"] = sum(1 for r in rows_all if not r["confirmed"])
    check["unconfirmed_stats_era"] = sum(1 for (t, s), rows in ts.items() for r in rows if not r["confirmed"] and s >= "2009-10")
    check["interims"] = sum(1 for r in rows_all if r["interim"])
    log(json.dumps({k: v for k, v in check.items() if k not in ("missing_examples",)})[:3000])
    staff = {}
    for tid, by in WS.items():
        for s, ib in by.items():
            if ib.get("assistants"):
                staff.setdefault(tid, {})[s] = dict(rows=ib["assistants"], src=ib["source_url"])
    for c in coaches.values():
        c["teams"] = sorted(c["teams"])
    out = dict(coaches=coaches, seasons={f"{t}|{s}": rows for (t, s), rows in ts.items()}, who={s: dict(v) for s, v in who.items()},
               staff=staff, review=review, names=names)
    json.dump(out, open(os.path.join(OUT, "registry.json"), "w"))
    json.dump(check, open(os.path.join(OUT, "registry-check.json"), "w"), indent=1)
    return out, check


def load():
    return json.load(open(os.path.join(OUT, "registry.json")))


if __name__ == "__main__":
    build()
