"""
ap_check.py — the AP All-America teams, as a check and never a target. Reads the "By player" table of
each year's Wikipedia page (saved in <home>/ref/ap/), keeping players with 1, 2 or 3 in the AP column,
and reports overlap with our national teams. Nothing here feeds the model.

    python3 ap_check.py parse        <home>/ref/ap/ap.json
    python3 ap_check.py overlap      <home>/ap-overlap.json
"""
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))
import cbbd_client as CC  # noqa: E402
from namematch import words  # noqa: E402

DIR = os.path.join(CC.HOME, "ref", "ap")
PUBLIC = os.path.join(HERE, "..", "..", "public")


def link_text(c):
    q = re.search(r"\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)", c, re.I)
    if q:
        return f"{q.group(1).strip()} {q.group(2).strip()}"
    m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", c)
    return (m.group(2) or m.group(1)) if m else re.sub(r"[{}'\[\]]", "", c).strip()


def parse():
    out = {}
    for y in range(2014, 2027):
        t = open(os.path.join(DIR, f"{y}.txt")).read()
        a = t.find("By player")
        if a < 0:
            a = t.find("Individual All-America")
        a = t.find("{|", a)
        tb = t[a:t.find("\n|}", a)]      # on its own line: {{Center|}} inside a row also contains "|}"
        hdr = re.findall(r"^!\s*(?:[^|\n]*\|)?\s*([A-Za-z{}|. ]+)$", tb, re.M)
        names = [re.sub(r"\s+", "", h) for h in re.findall(r"^!(.*)$", tb, re.M)]
        ap = next((i for i, h in enumerate(names) if h.endswith("AP") or h == "AP"), 2)
        rows = {1: [], 2: [], 3: []}
        for r in re.split(r"\n\|-", tb)[1:]:
            cells = re.split(r"\|\||\n\|", re.sub(r"\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)[^}]*\}\}", r"\1 \2", r.strip().lstrip("|")))
            if len(cells) <= ap:
                continue
            c = cells[ap]
            m = re.search(r"\{\{\s*[Cc]enter\s*\|\s*(\d)\s*\}\}|(?:^|\|)\s*(\d)\s*$", c.strip())
            if not m:
                continue
            k = int(m.group(1) or m.group(2))
            if k in rows:
                rows[k].append(link_text(cells[0]).split(" (")[0])
        out[f"{y - 1}-{str(y)[2:]}"] = rows
        print(y, {k: len(v) for k, v in rows.items()}, rows[1][:2])
    json.dump(out, open(os.path.join(DIR, "ap.json"), "w"), indent=1)


def overlap():
    ap = json.load(open(os.path.join(DIR, "ap.json")))
    res, tot = {}, [0, 0, 0, 0]
    for s, teams in sorted(ap.items()):
        d = json.loads(gzip.decompress(open(os.path.join(PUBLIC, "cbb", "allsavant", f"{s}.json.gz"), "rb").read()))
        ours = {}
        for k in ("1", "2", "3"):
            for p in d["national"].get(k, []):
                ours["".join(words(p["name"]))] = int(k)
        all_ap = [(n, int(k)) for k, v in teams.items() for n in v]
        hit = [n for n, _ in all_ap if "".join(words(n)) in ours]
        same_first = [n for n in teams.get("1", []) if ours.get("".join(words(n))) == 1]
        first_any = [n for n in teams.get("1", []) if "".join(words(n)) in ours]
        res[s] = dict(ap=len(all_ap), overlap=len(hit), first_in_ours=len(first_any), first_on_first=len(same_first), missed=[n for n, _ in all_ap if n not in hit], ours_not_ap=[p["name"] for k in ("1", "2", "3") for p in d["national"].get(k, []) if "".join(words(p["name"])) not in {"".join(words(n)) for n, _ in all_ap}])
        tot[0] += len(all_ap); tot[1] += len(hit); tot[2] += len(first_any); tot[3] += len(same_first)
        print(s, len(hit), "of", len(all_ap), "| AP 1st on any of ours", len(first_any), "of", len(teams.get("1", [])), "| on our 1st", len(same_first))
    res["_total"] = dict(ap=tot[0], overlap=tot[1], first_in_ours=tot[2], first_on_first=tot[3])
    print(res["_total"])
    json.dump(res, open(os.path.join(CC.HOME, "ap-overlap.json"), "w"), indent=1)


if __name__ == "__main__":
    {"parse": parse, "overlap": overlap}[sys.argv[1]]()
