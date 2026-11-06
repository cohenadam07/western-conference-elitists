"""
wiki_seasons.py — Wikipedia's team-season articles: head coach, interim tag, record and staff.

    python3 wiki_seasons.py fetch        every D1 team-season 2002-03 to 2026-27 (cached, polite)
    python3 wiki_seasons.py parse        -> <CBCS_OUT>/wiki/seasons.json

"2015–16 Saint Mary's Gaels men's basketball team" carries `Infobox NCAA team season` (or `Infobox college sports team season`) with
`head_coach` (an "(Interim)" tag where there was one), `record`, and `assoc_coach` and `asst_coach1..N`: the only free,
season-by-season staff list there is. Titles are tried with ESPN's team name first and the
program article's stem second (wiki.py found the program articles). Requests go through
wiki.fetch_titles: 50 titles a request, at least 1.1 s apart, the honest user agent, raw cached.
Every parsed row keeps its source URL. Facts only; Wikipedia is credited on every page that shows them.
"""
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import wiki as W  # noqa: E402

OUT = os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs")
PUBLIC = os.path.join(HERE, "..", "..", "..", "public")
SEASONS = [f"{y - 1}-{str(y)[2:]}" for y in range(2003, 2028)]


def teams():
    """{team id: full name}, every D1 team in College Savant's team files."""
    out = {}
    for f in sorted(os.listdir(os.path.join(PUBLIC, "cbb", "teams"))):
        for t in json.loads(gzip.open(os.path.join(PUBLIC, "cbb", "teams", f)).read())["teams"]:
            out[t["id"]] = t.get("full") or t.get("name")
    return out


def title(season, name):
    y1 = season[:4]
    return f"{y1}–{season[5:]} {name} men's basketball team"


def candidates():
    P = json.load(open(os.path.join(OUT, "wiki", "programs.json")))
    out = {}
    for tid, full in teams().items():
        stems = [full]
        art = (P.get(tid) or {}).get("article") or ""
        if art.endswith(" men's basketball"):
            stems.append(art[: -len(" men's basketball")])
        out[tid] = list(dict.fromkeys(stems))
    return out


def fetch():
    C = candidates()
    first = [title(s, st[0]) for st in C.values() for s in SEASONS]
    got = W.fetch_titles(first)
    second = []
    for tid, st in C.items():
        for s in SEASONS:
            if not (got.get(title(s, st[0])) or {}).get("wikitext") and len(st) > 1:
                second.append(title(s, st[1]))
    W.fetch_titles(second)
    W.log(f"team-season titles: {len(first)} first, {len(second)} second")


def infobox(wt):
    m = re.search(r"\{\{\s*Infobox (?:NCAA team season|college sports team season)", wt, re.I)
    if not m:
        return None
    i = m.start()
    depth, j = 0, i
    while j < len(wt):
        if wt.startswith("{{", j):
            depth += 1; j += 2; continue
        if wt.startswith("}}", j):
            depth -= 1; j += 2
            if depth == 0:
                break
            continue
        j += 1
    body = wt[i + 2:j - 2]
    out = {}
    for part in W.split_top(body)[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def person(v):
    """(display name, linked title or None, interim?) from an infobox value."""
    if not v:
        return None, None, False
    interim = bool(re.search(r"interim|acting", v, re.I))
    raw = W.strip_refs(v)
    link = W.first_link(raw)
    name = W.clean_name(W.plain(re.sub(r"\((?:interim|acting)\)", "", raw, flags=re.I)))
    name = re.split(r"<br|\n|;| / ", name)[0].strip(" ,")
    return (name or None), link, interim


def parse():
    C = candidates()
    out = {}
    n = ok = 0
    for tid, st in C.items():
        for s in SEASONS:
            rec = None
            for stem in st:
                c = W.cached_title(title(s, stem))
                if c and c.get("wikitext"):
                    rec = c
                    break
            if not rec:
                continue
            n += 1
            ib = infobox(rec["wikitext"])
            if not ib:
                continue
            name, link, interim = person(ib.get("head_coach") or ib.get("hcoach"))
            if not name:
                continue
            ok += 1
            m = re.search(r"(\d+)\s*[–-]\s*(\d+)", W.plain(ib.get("record") or ""))
            asst = []
            for k in [k for k in ("assoc_coach", "assoc_coach1", "assoc_coach2") if k in ib] + sorted((k for k in ib if re.match(r"asst_coach\d+$", k)), key=lambda k: int(k[10:])):
                a, al, _ = person(ib[k])
                if a:
                    asst.append([a, al])
            # a second head coach named in the article's lead: "led by interim head coach X after Y was fired"
            lead = rec["wikitext"][rec["wikitext"].find("'''"):][:2500]
            out.setdefault(tid, {})[s] = dict(coach=name, coach_title=link, interim=interim,
                                             w=int(m.group(1)) if m else None, l=int(m.group(2)) if m else None,
                                             assistants=asst, source_url=W.page_url(rec["resolved"]),
                                             lead_interim=bool(re.search(r"interim head coach|acting head coach", lead, re.I)))
    json.dump(out, open(os.path.join(OUT, "wiki", "seasons.json"), "w"))
    W.log(f"team-season articles: {n} found, {ok} with a head coach")
    return out


if __name__ == "__main__":
    {"fetch": fetch, "parse": parse}[sys.argv[1]]()
