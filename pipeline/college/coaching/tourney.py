"""
tourney.py — the NCAA Tournament, 2002-03 on: every game, its round, both seeds, checked against
the bracket every year; plus the NIT, CBI, CIT, Crown and conference tournaments.

    python3 tourney.py wiki          fetch each year's Wikipedia tournament page (cached, 1 s apart)
    python3 tourney.py build         -> ~/Basketball-Savant/out/cbcs/tourney/{ncaa,other,seed_baseline}.json

Two sources, each doing what it is good at:

  * ESPN (the College Basketball Savant cache): the games themselves, with their ESPN ids, dates
    and scores, and the seed of each team in competitors[].rank (in a tournament game ESPN's
    "rank" is the seed; confirmed per season below).
  * Wikipedia, "<year> NCAA Division I men's basketball tournament": the bracket, which is the
    official record of who was seeded where and who beat whom. Its bracket templates
    ({{2TeamBracket}} for the opening round and First Four, {{16TeamBracket}} per region,
    {{4TeamBracket}} for the Final Four) give every game's seeds, teams and scores, and the
    template slot gives the round exactly.

Why the round comes from the bracket and not from ESPN's note: the notes change every few years
("MEN'S BASKETBALL CHAMPIONSHIP - EAST REGION - 2nd ROUND", region-only "PHOENIX REGION" in
2003-04, blank in seven 2002-03 games) and the same words mean different rounds in different
eras ("1st ROUND" is the First Four in 2010-11 to 2014-15, and the round of 64 after).

The check, every year: every Wikipedia team matches an ESPN team id, every ESPN seed equals the
bracket's, the field has the size its era requires (65 in 2002-03 to 2009-10, 68 from 2010-11),
every team plays exactly one first-round game (First Four aside), and the champion agrees. A game
in the bracket that ESPN never recorded is kept (from the bracket, gid null) so wins stay right,
and is counted in the report. Seeds ESPN left blank (16 team-games in 2002-03) come from the
bracket and are counted as filled, never as matches.
"""
import gzip
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

import pandas as pd

HOME = os.path.expanduser("~/Basketball-Savant")
OUT = os.path.join(os.environ.get("CBCS_OUT") or os.path.join(HOME, "out", "cbcs"), "tourney")
WIKI = os.path.join(OUT, "wiki")
RAW = os.path.join(HOME, "espn-cache", "cbb")
REBUILT = os.path.join(HOME, "out", "cbb", "rebuilt")
LOG = os.path.join(HOME, "logs", "cbcs-tourney.log")
UA = {"User-Agent": "wcehoops.com College Basketball Coaching Savant (research bot; https://wcehoops.com)"}
ROUNDS = ["FF", "R64", "R32", "S16", "E8", "F4", "NC"]
RESULT = {"FF": "First Four", "R64": "Round of 64", "R32": "Round of 32", "S16": "Sweet 16", "E8": "Elite Eight", "F4": "Final Four", "NC": "Runner-up", "CH": "Champion", "NOGAME": "Did not play (no contest)"}
OTHER = re.compile(r"\bNIT\b|CBI|\bCIT\b|CROWN|BASKETBALL CLASSIC|VEGAS 16|COLLEGEINSIDER", re.I)
CONF_TOURNEY = re.compile(r"TOURNAMENT|CHAMPIONSHIP|\bCHAMP\b|\bTR\b|PLAYOFFS", re.I)


def label(y):
    return f"{y - 1}-{str(y)[2:]}"


def log(msg):
    line = time.strftime("%H:%M:%S") + " " + msg
    print(line, flush=True)
    with open(LOG, "a") as fh:
        fh.write(line + "\n")


def page_url(y):
    return f"https://en.wikipedia.org/wiki/{y}_NCAA_Division_I_men%27s_basketball_tournament"


def fetch_wiki(years):
    os.makedirs(WIKI, exist_ok=True)
    for y in years:
        p = os.path.join(WIKI, f"{y}.json")
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            continue
        t = urllib.parse.quote(f"{y}_NCAA_Division_I_men's_basketball_tournament")
        u = f"https://en.wikipedia.org/w/api.php?action=parse&page={t}&prop=wikitext&format=json&formatversion=2&redirects=1"
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30) as r:
            open(p, "wb").write(r.read())
        time.sleep(1)


# ---------------------------------------------------------------- Wikipedia's bracket
def _templates(w, names):
    """[(name, start, body)] for each top-level {{name ...}}, braces balanced."""
    out = []
    for m in re.finditer(r"\{\{\s*(" + "|".join(names) + r")\b", w):
        i, depth = m.start(), 0
        j = i
        while j < len(w):
            if w.startswith("{{", j):
                depth += 1
                j += 2
            elif w.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        out.append((m.group(1), i, w[m.end():j - 2]))
    return out


def _params(body):
    """Split a template body on its top-level pipes -> {name: value}."""
    parts, depth_s, depth_c, cur = [], 0, 0, []
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two == "[[":
            depth_s += 1; cur.append(two); i += 2; continue
        if two == "]]":
            depth_s -= 1; cur.append(two); i += 2; continue
        if two == "{{":
            depth_c += 1; cur.append(two); i += 2; continue
        if two == "}}":
            depth_c -= 1; cur.append(two); i += 2; continue
        if body[i] == "|" and depth_s == 0 and depth_c == 0:
            parts.append("".join(cur)); cur = []; i += 1; continue
        cur.append(body[i]); i += 1
    parts.append("".join(cur))
    d = {}
    for p in parts:
        if "=" in p:
            k, v = p.split("=", 1)
            d[k.strip()] = v.strip()
    return d


def _clean(t):
    t = re.sub(r"\{\{\s*\w+\s*\|([^}|]*)\}\}", r"\1", t or "")
    return re.sub(r"&nbsp;|'{2,3}", " ", t).strip()


def _team(v):
    """'''[[2002–03 UNC Asheville Bulldogs men's basketball team|UNC Asheville]]''' -> (link, display)."""
    v = re.sub(r"<ref.*?(</ref>|/>)", "", v or "", flags=re.S)
    v = re.sub(r"\{\{\s*(?:strikethrough|nowrap|small|s)\s*\|(.*?)\}\}", r"\1", v, flags=re.I | re.S)
    cl = re.search(r"\{\{\s*cbb link\s*\|(.*?)\}\}", v, flags=re.I | re.S)
    if cl:                      # {{cbb link|2003|team=Florida A&M Rattlers men's basketball|title=Florida A&M}}
        kv = dict(x.split("=", 1) for x in cl.group(1).split("|") if "=" in x)
        if kv.get("team"):
            return kv["team"].strip(), (kv.get("title") or kv["team"]).strip()
    m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", v)
    if not m:
        t = _clean(re.sub(r"<[^>]+>|\{\{[^}]*\}\}", "", v))
        return (t, t) if t else (None, None)
    return m.group(1).strip(), (m.group(2) or m.group(1)).strip()


def _score(v):
    v = re.sub(r"<ref.*?(</ref>|/>)|\{\{[^}]*\}\}|<sup>.*?</sup>", " ", v or "", flags=re.S)
    v = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", v)     # a score linked to the game's own article
    m = re.search(r"\d+", re.sub(r"<[^>]+>", " ", v))
    return int(m.group()) if m else None


def _seed(v):
    m = re.search(r"\d+", re.sub(r"<[^>]+>", "", v or ""))
    return int(m.group()) if m else None


DEFAULT_SEEDS = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]
REGION_RX = re.compile(r"\b(East|West|South|Midwest|Southeast|Southwest|Mideast)\b")


def bracket(y):
    """The whole tournament from Wikipedia: [{round, region, a:(link, display, seed, score), b:...}]."""
    d = json.load(open(os.path.join(WIKI, f"{y}.json")))
    w = d["parse"]["wikitext"]
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"\n=+\s*([^=\n]+?)\s*=+", w)]
    games = []
    for name, start, body in _templates(w, ["2TeamBracket", "16TeamBracket", "4TeamBracket"]):
        P = _params(body)
        head = [h for p, h in heads if p < start]
        head = head[-1] if head else ""
        rnd_of = {"2TeamBracket": {1: "FF"}, "16TeamBracket": {1: "R64", 2: "R32", 3: "S16", 4: "E8"}, "4TeamBracket": {1: "F4", 2: "NC"}}[name]
        if name == "2TeamBracket":
            ctx = (P.get("RD1", "") + " " + head + " " + w[max(0, start - 300):start])
            rg = REGION_RX.findall(P.get("RD1", "")) or REGION_RX.findall(w[max(0, start - 300):start]) or REGION_RX.findall(head)
        else:
            rg = REGION_RX.findall(head)
            ctx = head
        region = rg[-1] if rg and name != "4TeamBracket" else ("National" if name == "4TeamBracket" else None)
        slots = defaultdict(dict)
        for k, v in P.items():
            m = re.match(r"RD(\d+)-(seed|team|score)0*(\d+)$", k)
            if m:
                slots[(int(m.group(1)), int(m.group(3)))][m.group(2)] = v
        for (rd, n), s in list(slots.items()):
            if n % 2 == 0 or rd not in rnd_of:
                continue
            o = slots.get((rd, n + 1))
            if not o:
                continue
            a, b = _team(s.get("team")), _team(o.get("team"))
            if not a[0] or not b[0]:
                continue
            if name == "16TeamBracket" and rd == 1:
                # the template's own default when a page leaves the seeds out: slot order 1, 16, 8, 9, ...
                s.setdefault("seed", str(DEFAULT_SEEDS[n - 1]))
                o.setdefault("seed", str(DEFAULT_SEEDS[n]))
            games.append(dict(round=rnd_of[rd], region=region, ctx=ctx[:80],
                              a=(a[0], a[1], _seed(s.get("seed")), _score(s.get("score"))),
                              b=(b[0], b[1], _seed(o.get("seed")), _score(o.get("score")))))
    return games, w


# ---------------------------------------------------------------- matching names to ESPN ids
def _norm(s):
    s = (s or "").lower()
    s = re.sub(r"^\d{4}[–-]\d{2,4}\s+", "", s)
    s = re.sub(r"\s+(men's\s+)?basketball(\s+team)?$", "", s)
    s = s.replace("&amp;", "&").replace("state", "st").replace("saint", "st").replace("st.", "st")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def espn_names(season, gids):
    """{team id: set of normalized names} from the raw summaries of the tournament games."""
    names = defaultdict(set)
    for gid in gids:
        p = os.path.join(RAW, season, "raw", f"{gid}.json.gz")
        if not os.path.exists(p):
            continue
        d = json.loads(gzip.open(p).read(), strict=False)
        for c in d["header"]["competitions"][0]["competitors"]:
            t = c["team"]
            for k in ("displayName", "location", "shortDisplayName", "nickname", "name"):
                if t.get(k):
                    names[c["id"]].add(_norm(t[k]))
            if t.get("location") and t.get("name"):
                names[c["id"]].add(_norm(t["location"] + " " + t["name"]))
    return names


# Wikipedia's name -> ESPN's, where the two never share a word string. Each was checked against
# the bracket's seed and opponent (the game pairs must agree too, below).
ALIAS = {"wku": "western kentucky", "uconn": "connecticut", "ole miss": "mississippi", "lsu": "lsu", "ucf": "ucf",
         "unc wilmington": "uncw", "uncw": "unc wilmington", "smu": "smu", "vcu": "vcu", "byu": "byu", "tcu": "tcu",
         "utep": "utep", "unlv": "unlv", "liu": "long island university", "long island": "long island university",
         "miami fl": "miami", "miami (fl)": "miami", "usc": "usc", "pitt": "pittsburgh", "umbc": "umbc",
         "texas a&m–corpus christi": "texas a m corpus christi", "app st": "appalachian st", "fdu": "fairleigh dickinson",
         "n c central": "north carolina central", "nc central": "north carolina central", "siu edwardsville": "siue",
         "ut arlington": "ut arlington", "north carolina st": "nc st", "iupui": "iu indianapolis", "uc santa barbara": "uc santa barbara", "loyola chicago": "loyola chicago",
         "st mary s": "st mary s", "st peter s": "st peter s", "cal st fullerton": "cal st fullerton", "csun": "cal st northridge"}


def match(wteams, names):
    """{wikipedia link: espn id}: exact normalized name first, then the best word overlap."""
    out = {}
    taken = set()
    def cands(link, disp):
        keys = {_norm(link), _norm(disp)}
        keys |= {ALIAS[k] for k in list(keys) if k in ALIAS}
        return keys
    # pass 1: exact
    for link, disp in wteams:
        ks = cands(link, disp)
        hit = [t for t, ns in names.items() if ks & ns]
        if len(hit) == 1:
            out[link] = hit[0]
            taken.add(hit[0])
    # pass 2: overlap (Jaccard on words) among what is left
    for link, disp in wteams:
        if link in out:
            continue
        ks = cands(link, disp)
        best = None
        for t, ns in names.items():
            if t in taken:
                continue
            for k in ks:
                a = set(k.split())
                for n in ns:
                    b = set(n.split())
                    j = len(a & b) / max(1, len(a | b))
                    if best is None or j > best[0]:
                        best = (j, t)
        if best and best[0] >= 0.5:
            out[link] = best[1]
            taken.add(best[1])
    return out


# ---------------------------------------------------------------- one season
def season_table(y):
    s = label(y)
    # games.pkl is College Basketball Savant's own intermediate table, written by season.py on this
    # Mac; nothing downloaded is ever unpickled.
    G = pd.read_pickle(os.path.join(REBUILT, s, "games.pkl"))
    G["note"] = G.note.fillna("").astype(str)
    post = G[(G.stype == 3) & ~G.note.str.contains(OTHER)]
    wgames, wtext = bracket(y)
    # One key per school. The first mention links the season article, later ones the program
    # article or nothing at all ("Duke" as plain text): a plain name takes the key of the linked
    # entry that showed the same text.
    by_disp = {}
    for g in wgames:
        for k in ("a", "b"):
            link, disp = g[k][0], g[k][1]
            if link != disp:
                by_disp.setdefault(_clean(disp), _norm(link))
    for g in wgames:
        for k in ("a", "b"):
            link, disp = g[k][0], g[k][1]
            key = _norm(link) if link != disp else by_disp.get(_clean(disp), _norm(disp))
            g[k] = (key, _clean(disp)) + tuple(g[k][2:])
    wteams = sorted({(g[k][0], g[k][1]) for g in wgames for k in ("a", "b")})
    wteams = sorted({k: (k, d) for k, d in wteams}.values())
    names = espn_names(s, post.gid.tolist())
    # Teams with no ESPN tournament game (games ESPN never recorded, VCU's 2021 no-contest) still
    # need an id: College Basketball Savant's own team table for the season names every team.
    known = set(names)
    ids = json.load(open(os.path.join(REBUILT, s, "ids.json"))).get("teams", {})
    fallback = defaultdict(set)
    for t, v in ids.items():
        if t not in known:
            for k in ("name", "loc"):
                if (v or {}).get(k):
                    fallback[t].add(_norm(v[k]))
    m = match(wteams, names)
    rest = [t for t in wteams if t[0] not in m]
    if rest:
        m.update(match(rest, fallback))
    unmatched = [t for t in wteams if t[0] not in m]
    seed_w = {}
    for g in wgames:
        for k in ("a", "b"):
            if g[k][2] is not None and g[k][0] in m:
                seed_w.setdefault(m[g[k][0]], g[k][2])
    region_w = {}
    for g in wgames:
        if g["round"] in ("FF", "R64"):
            for k in ("a", "b"):
                if g[k][0] in m and g["region"]:
                    region_w.setdefault(m[g[k][0]], g["region"])
    # ESPN games by unordered team pair
    by_pair = defaultdict(list)
    for r in post.itertuples():
        by_pair[frozenset((r.home, r.away))].append(r)
    field = set(seed_w)
    games, missing, mismatches, filled, espn_seeds = [], 0, [], 0, {}
    used = set()
    for g in sorted(wgames, key=lambda g: ROUNDS.index(g["round"])):
        ta, tb = m.get(g["a"][0]), m.get(g["b"][0])
        if not ta or not tb:
            continue
        cand = [r for r in by_pair.get(frozenset((ta, tb)), []) if r.gid not in used]
        r = cand[0] if cand else None
        sa, sb = g["a"][3], g["b"][3]
        if r is not None:
            used.add(r.gid)
            pa = r.hs if r.home == ta else r.as_
            pb = r.as_ if r.home == ta else r.hs
            d = json.loads(gzip.open(os.path.join(RAW, s, "raw", f"{r.gid}.json.gz")).read(), strict=False)
            for c in d["header"]["competitions"][0]["competitors"]:
                espn_seeds.setdefault(c["id"], []).append((r.gid, c.get("rank")))
            date, gid = r.date, str(r.gid)
            if sa is not None and sb is not None and {sa, sb} != {int(pa), int(pb)}:
                mismatches.append(("score", g["round"], g["a"][1], g["b"][1], (sa, sb), (int(pa), int(pb))))
        else:
            missing += 1
            pa, pb, date, gid = sa, sb, None, None
        if pa is None or pb is None:
            continue
        for team, opp, seed, oseed, pts, opts in ((ta, tb, g["a"][2], g["b"][2], pa, pb), (tb, ta, g["b"][2], g["a"][2], pb, pa)):
            games.append(dict(gid=gid, date=date, round=g["round"], region=g["region"], team=team, opp=opp, seed=seed, opp_seed=oseed,
                              pts=int(pts), opp_pts=int(opts), win=bool(pts > opts)))
    # the seed check, ESPN against the bracket
    for t, lst in espn_seeds.items():
        for gid, rk in lst:
            if rk is None:
                filled += 1
            elif seed_w.get(t) != int(rk):
                mismatches.append(("seed", t, gid, int(rk), seed_w.get(t)))
    # every NCAA game ESPN has must be in the bracket
    extra = [r.gid for r in post.itertuples() if r.gid not in used and r.home in field and r.away in field]
    # teams
    teams = {}
    for t in field:
        mine = [x for x in games if x["team"] == t]
        wins = sum(x["win"] for x in mine)
        last = max(mine, key=lambda x: ROUNDS.index(x["round"])) if mine else None
        # no game at all: VCU 2020-21, in the bracket and withdrawn (COVID no-contest)
        res = "CH" if last and last["round"] == "NC" and last["win"] else (last["round"] if last else "NOGAME")
        teams[t] = dict(seed=seed_w[t], region=region_w.get(t), wins=wins, result=res, result_label=RESULT.get(res), games=[x["gid"] for x in mine])
    r64 = Counter(x["team"] for x in games if x["round"] == "R64")
    nc_opp = {g[k][0] for g in wgames if g["round"] == "R64" for k in ("a", "b") if (g["a"][3] is None or g["b"][3] is None)}
    def no_game(t):             # in the bracket, never played: VCU 2021 (COVID no-contest) and the man it would have met
        return not teams[t]["games"] or t in {m.get(x) for x in nc_opp}
    champ = [t for t, v in teams.items() if v["result"] == "CH"]
    # Wikipedia's champion: the title game's winner by its own scores
    wf = [g for g in wgames if g["round"] == "NC"]
    wchamp = None
    if wf and wf[0]["a"][3] is not None and wf[0]["b"][3] is not None:
        wchamp = m.get(wf[0]["a"][0] if wf[0]["a"][3] > wf[0]["b"][3] else wf[0]["b"][0])
    want = 65 if y <= 2010 else 68
    rep = dict(season=s, teams=len(field), want=want, bracket_games=len(wgames), espn_games=len(used), missing_from_espn=missing,
               extra_espn=len(extra), seed_mismatches=len([x for x in mismatches if x[0] == "seed"]), score_mismatches=len([x for x in mismatches if x[0] == "score"]),
               seeds_filled_from_bracket=filled, unmatched=[u[1] for u in unmatched],
               r64_once=all(r64.get(t, 0) == 1 for t in field if teams[t]["result"] != "FF" and not no_game(t)), champion=champ[0] if len(champ) == 1 else champ, champion_wiki=wchamp,
               champion_ok=len(champ) == 1 and champ[0] == wchamp, mismatch_rows=mismatches[:10])
    return dict(teams=teams, games=sorted(games, key=lambda x: (x["date"] or "", x["gid"] or "", x["team"])), source_url=page_url(y)), rep


# ---------------------------------------------------------------- NIT, CBI, CIT, Crown, conference tournaments
def EVENT(note):
    n = note.upper()
    for k, v in (("CROWN", "College Basketball Crown"), ("CBI", "CBI"), ("CIT", "CIT"), ("COLLEGEINSIDER", "CIT"),
                 ("BASKETBALL CLASSIC", "The Basketball Classic"), ("VEGAS 16", "Vegas 16"), ("NIT", "NIT")):
        if re.search(r"\b" + k + r"\b", n):
            return v
    return None


def other_table(s, ncaa_teams):
    G = pd.read_pickle(os.path.join(REBUILT, s, "games.pkl"))
    G["note"] = G.note.fillna("").astype(str)
    ids = json.load(open(os.path.join(REBUILT, s, "ids.json")))
    conf = {k: (v or {}).get("conf") for k, v in ids.get("teams", {}).items()}
    rows = defaultdict(lambda: dict(event=None, w=0, l=0, champion=False, last=None))
    events = []
    post = G[(G.stype == 3) & G.note.str.contains(OTHER)]
    for r in post.itertuples():
        ev = EVENT(r.note)
        if not ev or "PRESEASON" in r.note.upper():
            continue
        events.append((ev, r))
    end = G.date.max()[:4]
    ct = G[(G.stype == 2) & (G.confgame == True) & (G.date >= f"{end}-02-20") & G.note.str.contains(CONF_TOURNEY) & ~G.note.str.upper().str.contains("PRESEASON")]  # noqa: E712
    for r in ct.itertuples():
        c = conf.get(r.home) or conf.get(r.away)
        events.append((f"conf:{c}", r))
    last_game = {}
    for ev, r in events:
        for t, o, pt, po in ((r.home, r.away, r.hs, r.as_), (r.away, r.home, r.as_, r.hs)):
            if not t:
                continue
            k = (t, ev)
            e = rows[k]
            e["event"] = ev
            e["w" if pt > po else "l"] += 1
        if (ev not in last_game) or (r.date, r.gid) > (last_game[ev].date, last_game[ev].gid):
            last_game[ev] = r
    for ev, r in last_game.items():
        win = r.home if r.hs > r.as_ else r.away
        if (win, ev) in rows:
            rows[(win, ev)]["champion"] = True
    out = defaultdict(list)
    for (t, ev), e in rows.items():
        out[t].append(dict(event="Conference tournament" if ev.startswith("conf:") else ev, conf=ev[5:] if ev.startswith("conf:") else None,
                           w=e["w"], l=e["l"], champion=e["champion"]))
    return dict(out)


def baseline(ncaa):
    by = defaultdict(list)
    for s, d in ncaa.items():
        for t, v in d["teams"].items():
            if v["result"] == "NOGAME":
                continue
            by[v["seed"]].append(v["wins"] - (1 if v["result"] != "FF" and any(g["round"] == "FF" and g["team"] == t for g in d["games"]) else 0))
    out = {}
    for seed in sorted(by):
        x = by[seed]
        mu = sum(x) / len(x)
        sd = math.sqrt(sum((v - mu) ** 2 for v in x) / max(1, len(x) - 1))
        out[str(seed)] = dict(wins=round(mu, 3), n=len(x), se=round(sd / math.sqrt(len(x)), 3))
    return dict(seeds=out, seasons=sorted(ncaa), note="Wins in the bracket proper (a First Four win is not counted), per team, over the seasons on file.")


def build():
    os.makedirs(OUT, exist_ok=True)
    ncaa, other, reps = {}, {}, []
    for y in range(2003, 2027):
        s = label(y)
        if y != 2020:
            t, rep = season_table(y)
            ncaa[s] = t
            reps.append(rep)
        other[s] = other_table(s, set(ncaa.get(s, {}).get("teams", {})))
    json.dump(ncaa, open(os.path.join(OUT, "ncaa.json"), "w"), separators=(",", ":"))
    json.dump(other, open(os.path.join(OUT, "other.json"), "w"), separators=(",", ":"))
    json.dump(baseline(ncaa), open(os.path.join(OUT, "seed_baseline.json"), "w"), indent=1)
    json.dump(reps, open(os.path.join(OUT, "check.json"), "w"), indent=1, default=str)
    log("season   teams want bracket espn missing extra seed_mm score_mm filled r64 champ")
    for r in reps:
        log(f"{r['season']}  {r['teams']:5} {r['want']:4} {r['bracket_games']:7} {r['espn_games']:4} {r['missing_from_espn']:7} {r['extra_espn']:5} {r['seed_mismatches']:7} {r['score_mismatches']:8} {r['seeds_filled_from_bracket']:6} {str(r['r64_once']):5} {r['champion_ok']} {r['unmatched'] or ''}")
        for x in r["mismatch_rows"]:
            log(f"    {x}")
    return reps


if __name__ == "__main__":
    if sys.argv[1] == "wiki":
        fetch_wiki([y for y in range(2003, 2027) if y != 2020])
    elif sys.argv[1] == "build":
        build()
