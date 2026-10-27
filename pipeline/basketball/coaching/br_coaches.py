"""
br_coaches.py — every NBA (and BAA/ABA) coach Basketball-Reference lists, with his records,
assistant stints, awards and bio, cached as raw HTML and parsed with the standard library.

    python3 br_coaches.py fetch       # the coaches index + one page per coach (441 pages, ~30 min)
    python3 br_coaches.py teams       # team-season pages for every season two or more men coached
    python3 br_coaches.py parse       # cache -> out/bcs/br_coaches.json (no network)

Politeness as br_fetch.py: one request every 3.5 seconds, a browser user agent, back-off on
429/5xx. Every page is cached under cache_br/coaches/ and never re-fetched, except the index
and the current season's team pages, which are re-pulled when older than a day.

What a coach page gives (table id "coach-stats", one row per season per team):
  season, age, team_id, lg_id, role ("Assistant Coach" rows carry no record), g, wins,
  losses, win_loss_pct, rank_team (finish), g_playoffs, wins_playoffs, losses_playoffs,
  coach_remarks. Basketball-Reference warns that assistant records "might not be complete".
Plus "coach-awards" (Coach of the Year, Coach of the Month) and the header's bio: born,
college, whether he has a player page (played in the league) and his high school.
"""
import json
import os
import random
import re
import sys
import time
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
BR = "https://www.basketball-reference.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
CACHE = os.environ.get("BCS_BR_CACHE") or os.path.expanduser("~/Basketball-Savant/cache_br/coaches")
OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
DELAY = 3.5
RETRIES = 5
_last = [0.0]

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass


def _get(url):
    import urllib.request
    import urllib.error
    last = None
    for attempt in range(RETRIES):
        wait = DELAY + random.uniform(0, 0.8) - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=45) as r:
                _last[0] = time.time()
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            _last[0] = time.time()
            last = f"HTTP {e.code}"
            if e.code == 404:
                return None
            time.sleep(60 if e.code == 429 else DELAY * (attempt + 2))
        except Exception as e:  # noqa
            _last[0] = time.time()
            last = repr(e)[:120]
            time.sleep(DELAY * (attempt + 2))
    raise RuntimeError(f"BR fetch failed {url}: {last}")


def page(path, name, max_age_days=None):
    """Cached HTML for a Basketball-Reference path."""
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if os.path.exists(p) and (max_age_days is None or (time.time() - os.path.getmtime(p)) < 86400 * max_age_days):
        return open(p, encoding="utf-8").read()
    html = _get(BR + path)
    if html is None:
        return None
    open(p, "w", encoding="utf-8").write(html)
    return html


# ------------------------------------------------------------------ parsing
class _Table(HTMLParser):
    """Rows of one table (by id) as dicts keyed by data-stat, with the first href in each cell."""

    def __init__(self, table_id):
        super().__init__(convert_charrefs=True)
        self.table_id, self.in_table, self.depth = table_id, False, 0
        self.rows, self._row, self._stat, self._buf, self._href, self._cls = [], None, None, [], None, ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            if a.get("id") == self.table_id:
                self.in_table, self.depth = True, 1
            elif self.in_table:
                self.depth += 1
            return
        if not self.in_table:
            return
        if tag == "tr":
            self._cls = a.get("class", "") or ""
            self._row = {"_class": self._cls}
        elif tag in ("td", "th") and self._row is not None:
            self._stat, self._buf, self._href = a.get("data-stat"), [], None
        elif tag == "a" and self._stat is not None and self._href is None:
            self._href = a.get("href")

    def handle_data(self, data):
        if self._stat is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == "table" and self.in_table:
            self.depth -= 1
            if self.depth == 0:
                self.in_table = False
            return
        if not self.in_table:
            return
        if tag in ("td", "th") and self._row is not None and self._stat is not None:
            self._row[self._stat] = "".join(self._buf).strip()
            if self._href:
                self._row[self._stat + "_href"] = self._href
            self._stat = None
        elif tag == "tr" and self._row is not None:
            if len(self._row) > 1:
                self.rows.append(self._row)
            self._row = None


def table(html, table_id):
    p = _Table(table_id)
    p.feed(html.replace("<!--", "").replace("-->", ""))
    return p.rows


def _int(x):
    try:
        return int(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_index(html):
    out = []
    for r in table(html, "coaches"):
        href = r.get("coach_href")
        if not href or "thead" in r["_class"]:
            continue
        out.append(dict(slug=href.split("/")[-1].replace(".html", ""), name=r["coach"].rstrip("*").strip(), hof="*" in r["coach"],
                        first=_int(r.get("season_min")), last=_int(r.get("season_max")),
                        born=r.get("birth_date") or None, college=r.get("college") or None))
    return out


def season_of(text):
    """'2001-02' -> '2001-02'; '1949-50' stays; summary rows ('2 seasons', 'Career') -> None."""
    return text if re.match(r"^\d{4}-\d{2}$", text or "") else None


MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}


def _iso(text):
    m = re.match(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", text or "")
    return f"{int(m.group(3)):04d}-{MONTHS.get(m.group(1), 0):02d}-{int(m.group(2)):02d}" if m and m.group(1) in MONTHS else None


def parse_coach(html, slug):
    rows, awards = [], []
    for r in table(html, "coach-stats"):
        s = season_of(r.get("season"))
        if not s or "thead" in r["_class"]:
            continue
        team = r.get("team_id")
        role = r.get("role") or ("Head Coach" if _int(r.get("g")) is not None else "")
        rows.append(dict(season=s, age=_int(r.get("age")), team=team, lg=r.get("lg_id"), role=role,
                         g=_int(r.get("g")), w=_int(r.get("wins")), l=_int(r.get("losses")),
                         finish=r.get("rank_team") or None,
                         pg=_int(r.get("g_playoffs")), pw=_int(r.get("wins_playoffs")), pl=_int(r.get("losses_playoffs")),
                         remarks=r.get("coach_remarks") or None,
                         team_href=r.get("team_id_href")))
    for r in table(html, "coach-awards"):
        s = season_of(r.get("season"))
        if s and r.get("award_id"):
            awards.append([s, r.get("lg_id"), r["award_id"]])
    voting = []
    for r in table(html, "coach-of-the-year-voting"):
        s = season_of(r.get("season"))
        if s:
            voting.append([s, r.get("lg_id"), _int(r.get("rank")), _f(r.get("votes_first")), _f(r.get("points_won")), _f(r.get("points_max")), _f(r.get("award_share"))])
    # the header bio: the <div id="meta"> block, which ends at BR's own "div#meta" marker
    h = re.sub(r"<!--.*?-->", " ", html, flags=re.S)          # comments dropped whole (the bio is not inside one)
    i = h.find('<div id="meta"')
    j = h.find('<div class="adblock', i + 10) if i >= 0 else -1
    block = h[i:j] if i >= 0 and j > i else ""
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", block))
    meta = {}
    mm = re.search(r'data-birth="(\d{4}-\d{2}-\d{2})"', block)
    meta["born"] = mm.group(1) if mm else None
    mm = re.search(r"Born:\s*\w+ \d+, \d{4}\s+in\s+(.+?)\s+(?:Died:|High School:|College:|Hall of Fame|As Player|As Executive|$)", txt)
    meta["birthplace"] = mm.group(1).strip(" .") if mm else None
    mm = re.search(r'data-death="(\d{4}-\d{2}-\d{2})"', block)
    meta["died"] = mm.group(1) if mm else None
    mm = re.search(r"College:\s*(.+?)\s+(?:High School:|Hall of Fame|As Player|As Executive|More coach info|relatives|$)", txt)
    meta["college"] = mm.group(1).strip() if mm else None
    mm = re.search(r"High School:\s*(.+?)\s+(?:College:|Hall of Fame|As Player|As Executive|More coach info|$)", txt)
    meta["high_school"] = mm.group(1).strip() if mm else None
    mm = re.search(r'As Player:.{0,400}?href="(/players/[a-z]/[a-z0-9]+\.html)"', block, re.S)
    if not mm:
        mm = re.search(r'href="(/players/[a-z]/[a-z0-9]+\.html)"[^>]*>\s*Full Record', block)
    meta["player_href"] = mm.group(1) if mm else None
    meta["played"] = "As Player:" in txt
    mm = re.search(r"As Player:\s*(\d+) G, ([\d.]+) PPG", txt)
    meta["player_games"] = _int(mm.group(1)) if mm else None
    meta["hof"] = "Hall of Fame: Inducted as Coach" in txt
    mm = re.search(r'<h1[^>]*>\s*<span>([^<]+)</span>', h) or re.search(r"<h1[^>]*>([^<]+)</h1>", h)
    meta["name"] = mm.group(1).strip().rstrip("*").strip() if mm else None
    # transactions: "November 8, 1979: Appointed Interim Head Coach by the Detroit Pistons."
    trans = []
    hh = html.replace("<!--", "").replace("-->", "")
    t0 = hh.find('id="div_coach-transactions"')
    if t0 >= 0:
        t1 = hh.find("</div>", t0 + 30)
        ttxt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", hh[t0:t1 if t1 > t0 else t0 + 20000]))
        for m2 in re.finditer(r"([A-Z][a-z]+ \d{1,2}, \d{4})\s*:\s*(.+?)(?=(?:[A-Z][a-z]+ \d{1,2}, \d{4}\s*:)|$)", ttxt):
            trans.append([_iso(m2.group(1)), re.sub(r"\s+\.", ".", m2.group(2)).strip()])
    meta["transactions"] = trans
    meta["voting"] = voting
    return dict(slug=slug, rows=rows, awards=awards, **meta)


def parse_team_season(html):
    """The 'Coach:' line of a team season page: [(name, slug, w, l)] in order."""
    h = html.replace("<!--", "").replace("-->", "")
    m = re.search(r"<strong>\s*Coach(?:es)?:\s*</strong>(.*?)</p>", h, re.S)
    if not m:
        return []
    out = []
    for name, slug, rec in re.findall(r'<a href="/coaches/([a-z0-9]+)\.html">([^<]+)</a>\s*\((\d+)-(\d+)\)', m.group(1)) and \
            [(x[1], x[0], (x[2], x[3])) for x in re.findall(r'<a href="/coaches/([a-z0-9]+)\.html">([^<]+)</a>\s*\((\d+)-(\d+)\)', m.group(1))]:
        out.append(dict(name=name, slug=slug, w=int(rec[0]), l=int(rec[1])))
    return out


# ------------------------------------------------------------------ commands
def fetch_all(log=print):
    idx = parse_index(page("/coaches/", "index.html", max_age_days=1))
    log(f"{len(idx)} coaches in the index")
    for i, c in enumerate(idx, 1):
        if not os.path.exists(os.path.join(CACHE, c["slug"] + ".html")):
            page(f"/coaches/{c['slug']}.html", c["slug"] + ".html")
            if i % 25 == 0:
                log(f"  {i}/{len(idx)} coach pages")
    log("coach pages cached")


def multi_coach_seasons(coaches, first_year=1997):
    """{(team abbr, end year)} where two or more men were head coach, 1996-97 on."""
    by = {}
    for c in coaches:
        for r in c["rows"]:
            if r["role"] != "Head Coach" or r["lg"] != "NBA" or r["g"] is None:
                continue
            y = int(r["season"][:4]) + 1
            if y >= first_year:
                by.setdefault((r["team"], y), set()).add(c["slug"])
    return sorted(k for k, v in by.items() if len(v) > 1)


def fetch_teams(coaches, log=print):
    keys = multi_coach_seasons(coaches)
    log(f"{len(keys)} team-seasons with more than one head coach")
    for team, y in keys:
        page(f"/teams/{team}/{y}.html", f"team_{team}_{y}.html")
    log("team pages cached")


def parse_all(log=print):
    idx = parse_index(open(os.path.join(CACHE, "index.html"), encoding="utf-8").read())
    coaches = []
    for c in idx:
        p = os.path.join(CACHE, c["slug"] + ".html")
        if not os.path.exists(p):
            continue
        d = parse_coach(open(p, encoding="utf-8").read(), c["slug"])
        d["index"] = c
        coaches.append(d)
    teams = {}
    for f in os.listdir(CACHE):
        m = re.match(r"team_([A-Z]{3})_(\d{4})\.html$", f)
        if m:
            teams[f"{m.group(1)}-{m.group(2)}"] = parse_team_season(open(os.path.join(CACHE, f), encoding="utf-8").read())
    os.makedirs(OUT, exist_ok=True)
    json.dump(dict(coaches=coaches, team_orders=teams), open(os.path.join(OUT, "br_coaches.json"), "w"))
    log(f"parsed {len(coaches)} coaches, {len(teams)} team-season coach orders -> {OUT}/br_coaches.json")
    return coaches


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "parse"
    if cmd == "fetch":
        fetch_all()
        fetch_teams(parse_all())
    elif cmd == "teams":
        fetch_teams(parse_all())
        parse_all()
    else:
        parse_all()
