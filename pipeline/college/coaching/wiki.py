"""
wiki.py — the Wikipedia layer of the head-coach registry, and the coach biographies.

    python3 wiki.py crawl        fetch every program's pages and every linked coach article (raw cache)
    python3 wiki.py parse        raw cache -> programs.json and coaches.json, then the coverage report
    python3 wiki.py all          both

What it reads. Every ESPN team id in public/cbb/teams/<season>.json.gz. For each program:
  * "<full> men's basketball" (MediaWiki search when that title does not exist)
  * "List of <program> seasons" and "List of <program> head coaches", the titles derived from the
    program article's own title, plus any "List of ... seasons / head coaches" it links to
Then every coach article those pages link to, in batches of 50 titles a request.

What it parses, in order of preference for a season:
  yearly_record  {{CBB Yearly Record Subhead|name=...}} then {{CBB Yearly Record Entry|season=...|overall=W–L}}
                 (the season-by-season results template family). A season under two subheads keeps both
                 coaches with their own records.
  table          a wikitable with Season and Coach columns (rowspans followed)
  coach_list     {{CoachListEntry}} or a wikitable with Tenure/Years and Coach columns: tenures, expanded to
                 seasons only as a fallback. An expansion the page's own season count does not confirm,
                 or a one-year tenure whose season cannot be told, is tagged "unconfirmed".

Facts only, credited: every row carries the URL of the page it came from. Wikipedia text is
CC BY-SA; the registry publishes names, seasons and records (facts) with a link back.

Cache: ~/Basketball-Savant/out/cbcs/wiki/raw/ (one JSON per requested title or search, the API's
answer as given), so a parser change never refetches. One request a second at most, an honest
user agent. Log: ~/Basketball-Savant/logs/cbcs-wiki.log.
"""
import glob
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs"), "wiki")
RAW = os.path.join(OUT, "raw")
LOG = os.path.expanduser("~/Basketball-Savant/logs/cbcs-wiki.log")
API = "https://en.wikipedia.org/w/api.php"
UA = "wcehoops.com College Basketball Coaching Savant (research bot; https://wcehoops.com)"
DELAY = 1.1
CURRENT_END = 2027          # 2026-27 is the season in progress: "present" ends here

if not os.environ.get("SSL_CERT_FILE"):
    try:
        import certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
    except ImportError:
        pass

_last = [0.0]


def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a") as fh:
        fh.write(line + "\n")


def page_url(title):
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="()_,'")


def _api(params):
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                _last[0] = time.time()
                return json.loads(r.read().decode("utf8"))
        except Exception as e:  # noqa
            last = e
            _last[0] = time.time()
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"wikipedia: {last}")


def _key(kind, s):
    return os.path.join(RAW, kind, hashlib.sha1(s.encode()).hexdigest() + ".json")


def cached_title(title):
    p = _key("t", title)
    return json.load(open(p)) if os.path.exists(p) else None


def fetch_titles(titles):
    """{requested title: {"requested", "resolved", "wikitext" or None}}, cached per requested title."""
    os.makedirs(os.path.join(RAW, "t"), exist_ok=True)
    out, need = {}, []
    for t in dict.fromkeys(titles):
        c = cached_title(t)
        if c is not None:
            out[t] = c
        else:
            need.append(t)
    for i in range(0, len(need), 50):
        batch = need[i:i + 50]
        d = _api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": "1", "titles": "|".join(batch)})
        q = d.get("query", {})
        norm = {x["from"]: x["to"] for x in q.get("normalized", [])}
        red = {x["from"]: x["to"] for x in q.get("redirects", [])}
        pages = {p["title"]: p for p in q.get("pages", [])}
        for t in batch:
            r = norm.get(t, t)
            seen = set()
            while r in red and r not in seen:
                seen.add(r)
                r = red[r]
            p = pages.get(r) or {}
            wt = None
            if not p.get("missing") and not p.get("invalid") and p.get("revisions"):
                wt = p["revisions"][0]["slots"]["main"]["content"]
            rec = {"requested": t, "resolved": r if wt is not None else None, "wikitext": wt}
            json.dump(rec, open(_key("t", t), "w"))
            out[t] = rec
        log(f"fetched {min(i + 50, len(need))} of {len(need)} titles")
    return out


def search(q):
    os.makedirs(os.path.join(RAW, "s"), exist_ok=True)
    p = _key("s", q)
    if os.path.exists(p):
        return json.load(open(p))
    d = _api({"action": "query", "list": "search", "srsearch": q, "srlimit": "8"})
    res = [x["title"] for x in d.get("query", {}).get("search", [])]
    json.dump({"q": q, "titles": res}, open(p, "w"))
    return {"q": q, "titles": res}


# ---------------------------------------------------------------- programs
def programs():
    ids = {}
    for f in sorted(glob.glob(os.path.join(REPO, "public", "cbb", "teams", "*.json.gz"))):
        for t in json.loads(gzip.open(f).read())["teams"]:
            ids[t["id"]] = {"name": t["name"], "full": t["full"]}
    return ids


def program_article(team):
    """(requested title, record) for a program's article: the direct title, else the best search hit
    (a basketball program title sharing the team's mascot)."""
    t = f"{team['full']} men's basketball"
    rec = cached_title(t)
    if rec and rec["wikitext"]:
        return t, rec
    mascot = team["full"].split()[-1].lower()
    for q in (f"{team['full']} men's basketball", f"{team['full']} basketball"):
        s = search(q)
        for cand in s["titles"]:
            cl = cand.lower()
            if not cl.endswith("basketball") or re.match(r"^\d{4}", cand) or re.search(r"women|statistical|wahine|list of|football", cl):
                continue
            if mascot in cl:
                r2 = cached_title(cand)
                return cand, (r2 if r2 and r2.get("wikitext") else None)
    return None, None


LIST_LINK = re.compile(r"(?:\[\[|\{\{\s*(?:main|for|see also|further)\s*\|(?:[^|}]*\|)?)\s*(List of [^\]|#}]*basketball (?:seasons|head coaches))", re.I)


def related_titles(article_title, wikitext, full=None):
    base = article_title
    bases = [base]
    if "men's basketball" not in base and base.endswith(" basketball"):
        bases.append(base[:-len(" basketball")] + " men's basketball")
    if full:
        bases.append(f"{full} men's basketball")
    out = []
    for b in dict.fromkeys(bases):
        out += [f"List of {b} seasons", f"List of {b} head coaches"]
    for m in LIST_LINK.finditer(wikitext or ""):
        out.append(m.group(1).strip())
    return list(dict.fromkeys(out))


def crawl():
    P = programs()
    log(f"crawl: {len(P)} programs")
    direct = [f"{t['full']} men's basketball" for t in P.values()]
    fetch_titles(direct)
    found = {}
    extra = []
    for tid, t in P.items():
        req, rec = program_article(t)
        if req and (cached_title(req) is None):
            extra.append(req)
        found[tid] = req
    if extra:
        fetch_titles(extra)
    rel = []
    for tid, req in found.items():
        if not req:
            continue
        rec = cached_title(req)
        if rec and rec["wikitext"]:
            rel.extend(related_titles(rec["resolved"], rec["wikitext"], P[tid]["full"]))
    fetch_titles(rel)
    log(f"programs with an article: {sum(1 for r in found.values() if r and (cached_title(r) or {}).get('wikitext'))}")
    # the coach articles
    progs = parse_programs(P)
    titles = set()
    unlinked = set()
    for pr in progs.values():
        for r in pr["seasons"] + pr["coach_list"]:
            if r.get("coach_title"):
                titles.add(r["coach_title"])
            elif r.get("coach"):
                unlinked.add(clean_name(r["coach"]))
    fetch_titles(sorted(titles))
    fetch_titles(sorted(n for n in unlinked if n and n not in titles))
    log(f"crawl done: {len(titles)} linked coach titles, {len(unlinked)} unlinked names")


# ---------------------------------------------------------------- wikitext tools
def templates(text):
    """Every top-level and nested {{...}}: [(name, params dict, positional list, start, end)]."""
    out = []
    stack = []
    i, n = 0, len(text)
    while i < n - 1:
        two = text[i:i + 2]
        if two == "{{":
            stack.append(i)
            i += 2
            continue
        if two == "}}" and stack:
            s = stack.pop()
            body = text[s + 2:i]
            out.append((s, i + 2, body))
            i += 2
            continue
        i += 1
    res = []
    for s, e, body in out:
        parts = split_top(body)
        if not parts:
            continue
        name = parts[0].strip()
        kw, pos = {}, []
        for p in parts[1:]:
            m = re.match(r"^\s*([^=\[\]{}|]+?)\s*=(.*)$", p, re.S)
            if m:
                kw[m.group(1).strip().lower()] = m.group(2).strip()
            else:
                pos.append(p.strip())
        res.append((name, kw, pos, s, e))
    res.sort(key=lambda x: x[3])
    return res


def split_top(body):
    parts, depth_t, depth_l, cur, i = [], 0, 0, [], 0
    while i < len(body):
        two = body[i:i + 2]
        if two == "{{":
            depth_t += 1; cur.append(two); i += 2; continue
        if two == "}}":
            depth_t -= 1; cur.append(two); i += 2; continue
        if two == "[[":
            depth_l += 1; cur.append(two); i += 2; continue
        if two == "]]":
            depth_l -= 1; cur.append(two); i += 2; continue
        c = body[i]
        if c == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    parts.append("".join(cur))
    return parts


def strip_refs(s):
    s = re.sub(r"<ref[^>]*/>", "", s or "", flags=re.S)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    return s


def first_link(s):
    m = re.search(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]", s or "")
    if m:
        t = m.group(1).strip()
        if not re.match(r"^(File|Image|Category):", t, re.I):
            return t[0].upper() + t[1:] if t else None
    # {{sortname|First|Last|Target}}
    m = re.search(r"\{\{\s*sortname\s*\|([^|}]*)\|([^|}]*)(?:\|([^|}]*))?", s or "", re.I)
    if m:
        tgt = (m.group(3) or "").strip()
        if tgt.lower() in ("nolink",):
            return None
        if tgt and "=" not in tgt:
            return tgt
        if "nolink" in (s or "").lower():
            return None
        return f"{m.group(1).strip()} {m.group(2).strip()}"
    return None


def plain(s):
    s = strip_refs(s or "")
    s = re.sub(r"\{\{\s*sortname\s*\|([^|}]*)\|([^|}]*)[^}]*\}\}", r"\1 \2", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:nowrap|small|nobr|sort)\s*\|(?:[^|}]*\|)?([^}]*)\}\}", r"\1", s, flags=re.I)
    for _ in range(3):
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&nbsp;", " ").replace("†", "").replace("*", "").replace("^", "").replace("#", "")
    return re.sub(r"\s+", " ", s).strip()


def clean_name(s):
    n = plain(s)
    n = re.sub(r"\((?:interim|acting)[^)]*\)", "", n, flags=re.I)
    n = re.sub(r"\b(?:interim|acting)\b", "", n, flags=re.I)
    n = re.sub(r"\s*\[[^\]]*\]", "", n)
    return re.sub(r"\s+", " ", n).strip(" ,;")


def is_interim(*texts):
    return any(re.search(r"\b(interim|acting)\b", t or "", re.I) for t in texts)


SEASON_RX = re.compile(r"(\d{4})\s*[–\-—/]\s*(\d{2,4})")


def season_of(s):
    """'2009–10' -> ('2009-10', certain). A bare year is taken as the season ending in it, uncertain."""
    t = plain(s)
    m = SEASON_RX.search(t)
    if m:
        a = int(m.group(1))
        b = m.group(2)
        b = int(b) if len(b) == 4 else (a // 100 * 100 + int(b))
        if b < a:
            b += 100
        if b == a + 1:
            return f"{a}-{str(a + 1)[2:]}", True
        return f"{a}-{str(a + 1)[2:]}", False
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", t)
    if m:
        y = int(m.group(1))
        return f"{y - 1}-{str(y)[2:]}", False
    return None, False


def wl(s):
    m = re.search(r"(\d+)\s*[–\-—]\s*(\d+)", plain(s))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def label(y):
    return f"{y}-{str(y + 1)[2:]}"


# ---------------------------------------------------------------- the three parsers
def _people(raw):
    """A name field that may hold two coaches ("A<br>B", "A / B")."""
    bits = re.split(r"<br\s*/?>|\s+/\s+|\s*;\s*", raw or "")
    out = []
    for b in bits:
        n = clean_name(b)
        if n and re.search(r"[A-Za-z]", n):
            out.append((n, first_link(b), is_interim(b)))
    return out


def _is_team(name, team):
    tw = {w.lower() for w in re.findall(r"[A-Za-z]+", team or "")}
    nw = {w.lower() for w in re.findall(r"[A-Za-z]+", name or "")}
    return bool(nw) and len(nw & tw) >= max(1, len(nw) - 1)


def parse_yearly(wt, src, team=None):
    rows = []
    coach, ctitle, cint = None, None, False
    for name, kw, pos, s, e in templates(wt):
        nl = name.lower().replace("_", " ")
        nl = re.sub(r"\s+", " ", nl)
        if nl.startswith("cbb yearly record subhead"):
            raw = kw.get("name", "")
            coach = clean_name(raw)
            ctitle = first_link(raw)
            cint = is_interim(raw, kw.get("note", ""))
            if kw.get("interim", "").strip().lower() in ("yes", "y", "true", "1"):
                cint = True
        elif nl.startswith("cbb yearly record entry"):
            ss, sure = season_of(kw.get("season", ""))
            if not ss:
                continue
            ov = kw.get("overall", "")
            w, l_ = wl(ov)
            # the entry's own name: the coach in many season lists, the school in others
            ppl = [x for x in _people(kw.get("name", "")) if not _is_team(x[0], team)]
            if len(ppl) > 1:
                for n, t, it in ppl:
                    row = dict(season=ss, coach=n, coach_title=t, w=None, l=None, interim=it, record_text=plain(ov), split=True,
                               source_url=src, how="yearly_record")
                    rows.append(row)
                continue
            if ppl and (not coach or ppl[0][0].lower() != coach.lower()):
                if not coach:
                    n, t, it = ppl[0]
                else:  # the entry names another man under this subhead: trust the entry, say so
                    n, t, it = ppl[0]
                cn, ct, ci = n, t or (ctitle if coach and n.lower() == coach.lower() else None), it
            elif coach:
                cn, ct, ci = coach, ctitle, cint
            else:
                continue
            row = dict(season=ss, coach=cn, coach_title=ct, w=w, l=l_, interim=ci or is_interim(kw.get("name", "")),
                       record_text=plain(ov), source_url=src, how="yearly_record")
            if not sure:
                row["unconfirmed"] = True
            rows.append(row)
        elif nl.startswith("cbb yearly record start") or nl.startswith("cbb yearly record end"):
            coach, ctitle, cint = None, None, False
    return rows


def parse_coachlist(wt, src):
    out = []
    ents = [(kw, s) for name, kw, pos, s, e in templates(wt) if name.lower().replace("_", " ").strip() == "coachlistentry"]
    for idx, (kw, _) in enumerate(ents):
        raw = kw.get("name", "")
        nm = clean_name(raw)
        if not nm or not re.search(r"[A-Za-z]", nm):
            continue
        w, l_ = (int(kw["wins"]) if kw.get("wins", "").strip().isdigit() else None,
                 int(kw["losses"]) if kw.get("losses", "").strip().isdigit() else None)
        k = 1
        while f"start{k}" in kw or (k == 1 and "start" in kw):
            a = kw.get(f"start{k}", kw.get("start", "")).strip()
            b = kw.get(f"end{k}", kw.get("end", "")).strip()
            ya = re.search(r"\d{4}", plain(a))
            yb = re.search(r"\d{4}", plain(b))
            if ya:
                last = idx == len(ents) - 1 and f"start{k + 1}" not in kw
                if yb:
                    to = int(yb.group(0))
                elif re.search(r"present", b, re.I) or (not b and last):
                    to = CURRENT_END
                else:
                    to = int(ya.group(0))        # no end: a single season
                out.append(dict(coach=nm, coach_title=first_link(raw), frm=int(ya.group(0)), to=to, w=w, l=l_,
                                seasons=int(kw["seasons"]) if kw.get("seasons", "").strip().isdigit() else None,
                                interim=is_interim(raw) or kw.get("interim", "").strip().lower() in ("yes", "y", "true", "1"), source_url=src))
            k += 1
    return out


def wikitables(wt):
    """[(header cells, rows of cells)] with rowspans followed."""
    res = []
    for m in re.finditer(r"\{\|(.*?)\n\|\}", wt, re.S):
        body = m.group(1)
        lines = body.split("\n")
        header, rows, cur, heads = [], [], [], []
        hrows, started = [], [False]

        def close_row():
            # rows of nothing but ! cells, before any data, are the header (stacked rows merged below)
            if cur and all(heads) and not started[0]:
                if len(cur) == 1 and hrows:      # a full-width divider under the header, not a header row
                    rows.append(list(cur))
                else:
                    hrows.append(list(cur))
                    header[:] = merge_header(hrows)
            elif cur:
                rows.append(list(cur))
                if len(cur) > 1:
                    started[0] = True
            cur.clear()
            heads.clear()

        for ln in lines[1:]:
            ls = ln.strip()
            if ls.startswith("|-"):
                close_row()
                continue
            if ls.startswith("|+"):
                continue
            hm = re.match(r"^\{\{\s*(College\w*Header|CBB\w*Header|\w*Header)\s*\|", ls, re.I)
            if hm and not started[0]:
                tl = templates(ls)
                if tl:
                    header[:] = list(tl[0][2])
                    continue
            if ls.startswith("!") or ls.startswith("|"):
                h = ls.startswith("!")
                body_ = ls[1:].replace("!!", "||") if h else ls[1:]
                for c in split_cells(body_):
                    cur.append(_cell(c))
                    heads.append(h)
            elif cur:
                txt, attrs = cur[-1]
                cur[-1] = (txt + "\n" + ln, attrs)
        close_row()
        bold = re.compile(r"\s*'''.*'''\s*")
        if not header and rows and all(bold.fullmatch(c[0] or "") for c in rows[0]):
            header = [c[0] for c in rows[0]]       # a header written as a bold first row
            rows = rows[1:]
        grid, spans = [], {}
        for r in rows:
            out, ci, ri = [], 0, 0
            cells = list(r)
            while cells or ci in spans:
                if ci in spans:
                    txt, left = spans[ci]
                    out.append(txt)
                    if left <= 1:
                        del spans[ci]
                    else:
                        spans[ci] = (txt, left - 1)
                    ci += 1
                    continue
                txt, attrs = cells.pop(0)
                rs = re.search(r"rowspan\s*=\s*\"?(\d+)", attrs or "")
                if rs and int(rs.group(1)) > 1:
                    spans[ci] = (txt, int(rs.group(1)) - 1)
                out.append(txt)
                ci += 1
            if out:
                grid.append(out)
        res.append((header, grid))
    return res


def merge_header(hrows):
    """Stacked header rows -> one label per column: a rowspan cell keeps its own label, a cell under
    a colspan parent takes the lower row's label."""
    cols = {}
    taken = {}
    for ri, row in enumerate(hrows):
        ci = 0
        for txt, attrs in row:
            while taken.get((ri, ci)):
                ci += 1
            cs = re.search(r"colspan\s*=\s*\"?(\d+)", attrs or "")
            rs = re.search(r"rowspan\s*=\s*\"?(\d+)", attrs or "")
            span = int(cs.group(1)) if cs else 1
            down = int(rs.group(1)) if rs else 1
            for k in range(span):
                cols[ci + k] = txt
                for d in range(1, down):
                    taken[(ri + d, ci + k)] = True
            ci += span
    return [cols[i] for i in sorted(cols)]


def split_cells(s):
    # split on || outside of [[ ]] and {{ }}
    parts, cur, dt, dl, i = [], [], 0, 0, 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("{{", "[["):
            if two == "{{": dt += 1
            else: dl += 1
            cur.append(two); i += 2; continue
        if two in ("}}", "]]"):
            if two == "}}": dt -= 1
            else: dl -= 1
            cur.append(two); i += 2; continue
        if two == "||" and dt == 0 and dl == 0:
            parts.append("".join(cur)); cur = []; i += 2; continue
        cur.append(s[i]); i += 1
    parts.append("".join(cur))
    return parts


def _cell(c):
    """(text, attributes): 'style=".." rowspan=3 | text' -> text, attrs."""
    parts = split_top_pipe(c)
    if len(parts) > 1 and re.search(r"(style|rowspan|colspan|align|class|bgcolor|scope|data-sort-value)\s*=", parts[0], re.I):
        return parts[1].strip(), parts[0]
    return c.strip(), ""


def split_top_pipe(c):
    parts, cur, dt, dl, i = [], [], 0, 0, 0
    while i < len(c):
        two = c[i:i + 2]
        if two in ("{{", "[["):
            if two == "{{": dt += 1
            else: dl += 1
            cur.append(two); i += 2; continue
        if two in ("}}", "]]"):
            if two == "}}": dt -= 1
            else: dl -= 1
            cur.append(two); i += 2; continue
        if c[i] == "|" and dt == 0 and dl == 0 and not parts:
            parts.append("".join(cur)); cur = []; i += 1; continue
        cur.append(c[i]); i += 1
    parts.append("".join(cur))
    return parts


def _col(header, *names):
    for i, h in enumerate(header):
        hl = plain(h).lower()
        if any(hl == n or hl.startswith(n) for n in names):
            return i
    return None


DIVIDER = re.compile(r"^(.+?)\s*\((\d{4})\s*[–\-—]\s*(\d{2,4}|present)\)\s*$", re.I)


def divider_seasons(header, grid, cs, src):
    """Season tables grouped under full-width coach rows: 'Coleman Crawford (1992–1995)'."""
    out, coach, ctitle = [], None, None
    co = _col(header, "overall", "record")
    cw, cl = _col(header, "wins", "w", "won"), _col(header, "losses", "l", "lost", "loss")
    for r in grid:
        if len(set(r)) == 1:
            m = DIVIDER.match(plain(r[0]))
            if m:
                coach, ctitle = clean_name(m.group(1)), first_link(r[0])
            continue
        if not coach or cs >= len(r):
            continue
        ss, sure = season_of(r[cs])
        if not ss or not SEASON_RX.search(plain(r[cs])):
            continue
        w = l_ = None
        if co is not None and co < len(r):
            w, l_ = wl(r[co])
        if w is None and cw is not None and cl is not None and max(cw, cl) < len(r):
            a_, b_ = plain(r[cw]), plain(r[cl])
            w = int(a_) if a_.isdigit() else None
            l_ = int(b_) if b_.isdigit() else None
        row = dict(season=ss, coach=coach, coach_title=ctitle, w=w, l=l_, interim=is_interim(r[0], coach), source_url=src, how="table")
        if not sure:
            row["unconfirmed"] = True
        out.append(row)
    return out


def parse_tables(wt, src):
    season_rows, coach_rows = [], []
    for header, grid in wikitables(wt):
        if not header:
            continue
        cs = _col(header, "season", "year")
        cc = _col(header, "coach", "head coach", "head coaches")
        hl = " ".join(plain(h).lower() for h in header)
        cs0 = _col(header, "season")
        if cc is None and cs0 is not None:
            season_rows.extend(divider_seasons(header, grid, cs0, src))
            continue
        if cc is None and re.search(r"\b(wins|record|losses|w–l|pct)\b", hl) and re.search(r"\b(years|tenure|seasons)\b", hl):
            cc = _col(header, "name")
        cells_l = [plain(h).lower().strip() for h in header]
        bad = {"position", "pos", "role", "title", "player", "draft", "draft year", "selection", "designation", "selectors", "graduating year", "overall selection"}
        if cc is None or re.search(r"\bassistant\b", hl) or any(re.sub(r"[^a-z ]", "", c).strip() in bad for c in cells_l):
            continue
        cf_, clast = _col(header, "first year", "first season"), _col(header, "last year", "last season")
        co = _col(header, "overall", "record", "overall record")
        cw, cl = _col(header, "wins", "w", "won"), _col(header, "losses", "l", "lost", "loss")
        ct = _col(header, "tenure", "years active", "term")
        cy = _col(header, "years", "seasons", "yrs")
        hdr_season = cs is not None and plain(header[cs]).lower().startswith("season")
        for r in grid:
            if len(r) <= cc:
                continue
            raw = r[cc]
            nm = clean_name(raw)
            if not nm or len(nm) > 60 or not re.search(r"[A-Za-z]", nm) or re.search(r"\b(total|totals|career)\b", nm, re.I):
                continue
            w = l_ = None
            if co is not None and co < len(r):
                w, l_ = wl(r[co])
            if w is None and cw is not None and cl is not None and max(cw, cl) < len(r):
                a, b = plain(r[cw]), plain(r[cl])
                w = int(a) if a.isdigit() else None
                l_ = int(b) if b.isdigit() else None
            if hdr_season and cs < len(r):
                ss, sure = season_of(r[cs])
                if ss and SEASON_RX.search(plain(r[cs])):
                    row = dict(season=ss, coach=nm, coach_title=first_link(raw), w=w, l=l_, interim=is_interim(raw), source_url=src, how="table")
                    if not sure:
                        row["unconfirmed"] = True
                    season_rows.append(row)
                    continue
            if cf_ is not None and clast is not None and max(cf_, clast) < len(r):
                fa, la = re.search(r"\d{4}", plain(r[cf_])), re.search(r"\d{4}|present", plain(r[clast]), re.I)
                if fa and la:
                    a = int(fa.group(0))
                    b = CURRENT_END if la.group(0).lower() == "present" else int(la.group(0))
                    nn = None
                    if cy is not None and cy < len(r):
                        yy = plain(r[cy])
                        nn = int(yy) if yy.isdigit() else None
                    if nn is not None and b - a + 1 == nn:
                        b += 1                      # the last year is the start of his last season
                    coach_rows.append(dict(coach=nm, coach_title=first_link(raw), frm=a, to=b, w=w, l=l_, seasons=nn, interim=is_interim(raw), source_url=src))
                    continue
            tcol = None
            for c_ in (ct, cs, cy):
                if c_ is not None and c_ < len(r) and re.search(r"\d{4}", plain(r[c_])):
                    tcol = c_
                    break
            if tcol is not None:
                t = plain(r[tcol])
                ys = re.findall(r"\d{4}|\d{2}(?!\d)", t)
                m = re.search(r"(\d{4})\s*[–\-—]\s*(\d{2,4}|present|pres)", t, re.I)
                if m:
                    a = int(m.group(1))
                    b = m.group(2)
                    b = CURRENT_END if b.lower() in ("present", "pres") else (int(b) if len(b) == 4 else a // 100 * 100 + int(b))
                    if b < a:
                        b += 100
                elif re.fullmatch(r"\d{4}", t.strip()):
                    a = b = int(t.strip())
                else:
                    continue
                n = None
                cn_ = _col(header, "seasons", "yrs", "years") if cy == tcol else cy
                if cn_ is not None and cn_ < len(r) and cn_ != tcol:
                    yy = plain(r[cn_])
                    n = int(yy) if yy.isdigit() else None
                coach_rows.append(dict(coach=nm, coach_title=first_link(raw), frm=a, to=b, w=w, l=l_, seasons=n, interim=is_interim(raw), source_url=src))
    return season_rows, coach_rows


def parse_bullets(wt, src):
    """'* [[Name]] (1990–1995)' lines under a Head coaches / Coaches / Coaching history heading."""
    out = []
    for m in re.finditer(r"^(=+)\s*(?:Head\s+)?[Cc]oach(?:es|ing history|ing records|ing)?\s*\1\s*$", wt, re.M):
        level = len(m.group(1))
        rest = wt[m.end():]
        stop = re.search(r"^={1,%d}[^=].*?=+\s*$" % level, rest, re.M)
        body = rest[:stop.start()] if stop else rest
        for ln in body.split("\n"):
            if not re.match(r"^\s*[*#]", ln):
                continue
            t = plain(ln)
            ym = re.search(r"(\d{4})\s*[–\-—]\s*(\d{2,4}|present)", t, re.I)
            one = re.search(r"\((\d{4})\)", t)
            if not ym and not one:
                continue
            raw = ln.lstrip("*# ")
            nm = clean_name(re.split(r"\(|,|\s[–\-—]\s|:", plain(raw))[0])
            if not nm or not re.search(r"[A-Za-z]", nm) or len(nm) > 50:
                continue
            if ym:
                a = int(ym.group(1))
                b = ym.group(2)
                b = CURRENT_END if b.lower() == "present" else (int(b) if len(b) == 4 else a // 100 * 100 + int(b))
                if b < a:
                    b += 100
            else:
                a = b = int(one.group(1))
            w, l_ = None, None
            rm = re.search(r"(\d+)\s*[–\-—]\s*(\d+)\s*(?:\(|$|,|;)", t[ym.end():] if ym else "")
            if rm:
                w, l_ = int(rm.group(1)), int(rm.group(2))
            out.append(dict(coach=nm, coach_title=first_link(raw), frm=a, to=b, w=w, l=l_, seasons=None, interim=is_interim(ln), source_url=src))
    return out


def expand(cl):
    """A tenure -> seasons. frm is the start year of the first season, to the end year of the last."""
    rows = []
    for c in cl:
        a, b = c["frm"], c["to"]
        if b is None or not (1890 <= a <= CURRENT_END) or not (1890 <= b <= CURRENT_END):
            continue
        if b > a:
            yrs = list(range(a, b))
            sure = c.get("seasons") is None or c["seasons"] == len(yrs)
        else:  # one-year tenure: which season is ambiguous
            yrs = [a - 1]
            sure = False
        for y in yrs:
            r = dict(season=label(y), coach=c["coach"], coach_title=c["coach_title"], w=None, l=None, interim=c["interim"], source_url=c["source_url"], how="coach_list")
            if not sure or c.get("seasons") is None:
                r["unconfirmed"] = True
            rows.append(r)
    return rows


def text_interim(name, texts):
    """Does the prose call this man interim or acting? (name within a clause of the word, either order)"""
    n = re.escape(name)
    pats = [rf"{n}[^.;]{{0,80}}\b(?:interim|acting)\b(?:\s+head)?\s+coach", rf"\b(?:interim|acting)\b(?:\s+head)?\s+coach(?:es)?,?\s+(?:\[\[)?{n}"]
    return any(re.search(p, t, re.I) for p in pats for t in texts)


def parse_programs(P=None):
    P = P or programs()
    out = {}
    for tid, t in P.items():
        req, _ = program_article(t)
        rec = cached_title(req) if req else None
        if not rec or not rec.get("wikitext"):
            out[tid] = {"team": t["full"], "article": None, "url": None, "seasons": [], "coach_list": [], "status": "no_article"}
            continue
        title = rec["resolved"]
        pages = []
        for rt in related_titles(title, rec["wikitext"], t["full"]):
            r2 = cached_title(rt)
            if r2 and r2.get("wikitext"):
                pages.append((r2["resolved"], r2["wikitext"]))
        pages.append((title, rec["wikitext"]))
        pages = list({p[0]: p for p in pages}.values())
        # seasons lists first, then the program article, then the head-coach lists
        pages.sort(key=lambda p: (0 if "seasons" in p[0].lower() else 2 if "head coaches" in p[0].lower() else 1))
        by_how = {"yearly_record": {}, "table": {}}
        coach_list = []
        for pt, wt in pages:
            src = page_url(pt)
            yr = parse_yearly(wt, src, t["full"])
            tr, cr = parse_tables(wt, src)
            cl = parse_coachlist(wt, src)
            if not cl and not cr:
                cl = parse_bullets(wt, src)
            for how, rows in (("yearly_record", yr), ("table", tr)):
                got = {}
                for r in rows:
                    got.setdefault(r["season"], []).append(r)
                for s, rs in got.items():
                    by_how[how].setdefault(s, rs)       # first page (by preference) to have the season wins
            coach_list.extend(cl + cr)
        # dedupe coach list
        seen, cl2 = set(), []
        for c in coach_list:
            k = (c["coach"], c["frm"], c["to"])
            if k not in seen:
                seen.add(k)
                cl2.append(c)
        exp = {}
        for r in expand(cl2):
            exp.setdefault(r["season"], []).append(r)
        for s_, rs_ in exp.items():
            if len({r["coach"] for r in rs_}) > 1:
                for r in rs_:
                    r["unconfirmed"] = True
        seasons = []
        allseas = set(by_how["yearly_record"]) | set(by_how["table"]) | set(exp)
        for s in sorted(allseas):
            rs = by_how["yearly_record"].get(s) or by_how["table"].get(s) or exp.get(s)
            # one row per coach a season
            dd = {}
            for r in rs:
                k = r["coach"].lower()
                if k in dd and dd[k]["w"] is not None and r["w"] is not None:
                    dd[k] = dict(dd[k], w=dd[k]["w"] + r["w"], l=(dd[k]["l"] or 0) + (r["l"] or 0))
                else:
                    dd.setdefault(k, r)
            seasons.extend(dd.values())
        prose = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", strip_refs(wt)) for _, wt in pages]
        nseas = {}
        for r in seasons:
            nseas[r["coach"]] = nseas.get(r["coach"], 0) + 1
        for r in seasons:
            if not r["interim"] and nseas[r["coach"]] <= 2 and text_interim(r["coach"], prose):
                r["interim"] = True
                r["interim_basis"] = "text"
                r["unconfirmed"] = True
        cl_out = [dict(coach=c["coach"], coach_title=c["coach_title"], **{"from": c["frm"], "to": c["to"]}, w=c["w"], l=c["l"],
                       interim=c["interim"], source_url=c["source_url"]) for c in cl2]
        out[tid] = {"team": t["full"], "article": title, "url": page_url(title), "seasons": seasons, "coach_list": cl_out,
                    "status": "ok" if seasons else "unparsed"}
    return out


# ---------------------------------------------------------------- biographies
INFOBOX = re.compile(r"^infobox\s+(college coach|basketball biography|college football coach|coach|person|sportsperson|basketball)", re.I)


def birth(kw):
    raw = kw.get("birth_date", "") or kw.get("birthdate", "")
    for name, k2, pos, s, e in templates(raw):
        if name.lower().startswith("birth"):
            nums = [p for p in pos if re.fullmatch(r"\d{1,4}", p.strip())]
            if len(nums) >= 3:
                return f"{int(nums[0]):04d}-{int(nums[1]):02d}-{int(nums[2]):02d}"
            if len(nums) == 1:
                return nums[0]
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", plain(raw))
    return m.group(1) if m else None


def stint_role(team):
    t = team.lower()
    if re.search(r"\b(dbo|dir\.?|director|video|manager|operations|ops|scout|advisor|adviser|consultant|athletic director|coordinator|analyst|executive|gm|general manager|president|staff|special assistant|administrative|admin)\b", t):
        return "other"
    if re.search(r"\b(assistant|asst\.?|associate|assoc\.?|ga|graduate assistant|grad\.? asst)\b", t):
        return "assistant"
    return "head"


def stint_level(team):
    t = team.lower()
    if re.search(r"\b(hs|high school|prep|academy|h\.s\.)\b", t):
        return "high_school"
    if re.search(r"\b(jc|cc|community college|junior college|juco)\b", t):
        return "juco"
    return None


def years_span(y):
    t = plain(y)
    m = re.search(r"(\d{4})\s*[–\-—]\s*(\d{2,4}|present)", t, re.I)
    if m:
        a = int(m.group(1))
        b = m.group(2)
        b = CURRENT_END if b.lower() == "present" else (int(b) if len(b) == 4 else a // 100 * 100 + int(b))
        if b < a:
            b += 100
        return a, b
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", t)
    if m:
        return int(m.group(1)), int(m.group(1))
    return None, None


def pairs(kw, ykeys, tkeys):
    out = []
    nums = set()
    for k in kw:
        m = re.match(r"^(%s)(\d+)$" % "|".join(ykeys + tkeys), k)
        if m:
            nums.add(int(m.group(2)))
    for n in sorted(nums):
        y = next((kw[f"{k}{n}"] for k in ykeys if f"{k}{n}" in kw), "")
        t = next((kw[f"{k}{n}"] for k in tkeys if f"{k}{n}" in kw), "")
        tp = plain(t)
        if not tp:
            continue
        a, b = years_span(y)
        out.append({"years": plain(y), "from": a, "to": b, "team": tp, "team_title": first_link(t)})
    return out


def parse_bio(title, rec):
    wt = rec.get("wikitext") or ""
    box = None
    for name, kw, pos, s, e in templates(wt):
        if INFOBOX.match(name.strip()):
            box = kw
            break
    if box is None:
        return None
    coach = pairs(box, ["coach_years", "coaching_years", "cyears", "coachyears"], ["coach_team", "coaching_team", "cteam", "coachteam"])
    play = pairs(box, ["player_years", "playing_years", "years", "pyears"], ["player_team", "playing_team", "team", "pteam"])
    for c in coach:
        c["role"] = stint_role(c["team"])
        c["interim"] = bool(re.search(r"\b(interim|acting)\b", c["team"], re.I))
        lv = stint_level(c["team"])
        if lv:
            c["level"] = lv
    return {"name": plain(box.get("name", "")) or rec.get("resolved") or title, "resolved_title": rec.get("resolved"), "born": birth(box),
            "birthplace": plain(box.get("birth_place", "")) or None, "stints": coach, "playing": play,
            "source_url": page_url(rec.get("resolved") or title)}


def parse_coaches(progs):
    titles, unlinked = {}, {}
    for tid, pr in progs.items():
        school = pr["team"].split()[0].lower()
        for r in pr["seasons"] + pr["coach_list"]:
            if r.get("coach_title"):
                titles.setdefault(r["coach_title"], set()).add(school)
            elif r.get("coach"):
                unlinked.setdefault(clean_name(r["coach"]), set()).add(school)
    out = {}
    for t in titles:
        rec = cached_title(t)
        if rec and rec.get("wikitext"):
            b = parse_bio(t, rec)
            if b:
                out[t] = b
    for n, schools in unlinked.items():
        if not n or n in out:
            continue
        rec = cached_title(n)
        if rec and rec.get("wikitext"):
            b = parse_bio(n, rec)
            if b and b["stints"]:
                b["resolved_by_name"] = True
                hit = any(any(sc in s["team"].lower() for sc in schools) for s in b["stints"])
                if not hit:
                    b["unconfirmed"] = True
                out[n] = b
    return out


# ---------------------------------------------------------------- report
def report(progs, coaches):
    P = programs()
    with_art = sum(1 for p in progs.values() if p["article"])
    want = [label(y) for y in range(2009, 2026)]
    span = {}
    for f in sorted(glob.glob(os.path.join(REPO, "public", "cbb", "teams", "*.json.gz"))):
        se = os.path.basename(f)[:7]
        for t in json.loads(gzip.open(f).read())["teams"]:
            span.setdefault(t["id"], []).append(se)
    full, gaps = 0, {}
    for tid, p in progs.items():
        have = {r["season"] for r in p["seasons"]}
        sp = span.get(tid) or want
        mine = [s for s in want if min(sp) <= s <= max(sp)]      # the seasons he was D1 in our files
        miss = [s for s in mine if s not in have]
        if not miss:
            full += 1
        else:
            gaps[tid] = (p["team"], miss)
    print(f"programs {len(P)}; with an article {with_art}; every D1 season 2009-10..2025-26 covered {full}")
    hows = {}
    for p in progs.values():
        for r in p["seasons"]:
            if r["season"] in want:
                hows[r["how"]] = hows.get(r["how"], 0) + 1
    print("rows 2009-10..2025-26 by method:", hows, "; unconfirmed:", sum(1 for p in progs.values() for r in p["seasons"] if r["season"] in want and r.get("unconfirmed")))
    print("not fully covered:", len(gaps), "; none covered:", sum(1 for t, (n, m) in gaps.items() if len(m) >= len([x for x in want if min(span.get(t) or want) <= x <= max(span.get(t) or want)])))
    for tid, (name, miss) in sorted(gaps.items(), key=lambda x: -len(x[1][1])):
        print(f"  {tid} {name}: {len(miss)} missing ({miss[0]}..{miss[-1]})")
    with_ast = sum(1 for c in coaches.values() if any(s["role"] == "assistant" for s in c["stints"]))
    print(f"biographies parsed {len(coaches)}; with assistant stints {with_ast}; resolved by name {sum(1 for c in coaches.values() if c.get('resolved_by_name'))}")
    checks = [("150", "2021-22"), ("150", "2022-23"), ("96", "2023-24"), ("8", "2024-25"), ("97", "2017-18"), ("41", "2023-24")]
    for tid, s in checks:
        p = progs.get(tid, {})
        print("check", tid, p.get("team"), s, [(r["coach"], r["w"], r["l"], r["interim"], r["how"]) for r in p.get("seasons", []) if r["season"] == s])


def parse_all():
    progs = parse_programs()
    coaches = parse_coaches(progs)
    os.makedirs(OUT, exist_ok=True)
    json.dump(progs, open(os.path.join(OUT, "programs.json"), "w"), indent=0)
    json.dump(coaches, open(os.path.join(OUT, "coaches.json"), "w"), indent=0)
    report(progs, coaches)
    return progs, coaches


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("crawl", "all"):
        crawl()
    if cmd in ("parse", "all"):
        parse_all()
