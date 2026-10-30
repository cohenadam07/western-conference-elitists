"""
br_fetch.py — Basketball Reference fetcher for the pre-1996 historical window.

Covers seasons 1979-80 -> 1995-96 (the window nba_api can't serve — verified:
LeagueDashPlayerStats returns 0 rows for 1985-86, 441 for 1996-97). For each season
it downloads the season **Totals** and **Advanced** tables, caches the raw HTML under
cache_br/, and never re-fetches a cached page. Politeness: >=3s between live requests,
browser UA, retry/back-off on 429/5xx (BR bans bulk scrapers).

Parsing is stdlib-only (html.parser) — no bs4/lxml/read_html — so the build stays
dependency-light and robust to BR column renames (we key on `data-stat`, and capture
the BR player id from `data-append-csv`).

Usage:
  python br_fetch.py fetch     # download + cache all 17 seasons x 2 tables (~34 pages)
  python br_fetch.py parse     # parse cache -> print a sample season summary (no network)

Downstream (br_normalize.py) recomputes every advanced bar from these totals via the
site's own formulas; BR's precomputed advanced columns are kept only as a cross-check.
"""
import os, sys, time, re
from html.parser import HTMLParser

BR_CACHE = "cache_br"
BASE = "https://www.basketball-reference.com/leagues/NBA_{year}_{kind}.html"
SEASON_BASE = "https://www.basketball-reference.com/leagues/NBA_{year}.html"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
REQUEST_DELAY = 3.5   # seconds between LIVE requests (>=3s per plan; BR rate-limits hard)
RETRIES = 4

# End years 1980..1996  ->  season labels "1979-80".."1995-96".
BR_END_YEARS = list(range(1980, 1996 + 1))
# Modern window (1996-97 .. current) — we fetch only the Advanced table here, to backfill
# the value bars (PER/WS48/BPM/VORP) that nba_api doesn't carry, joined on name+season.
def _current_end_year():
    import savant_config as _C
    return int(_C.SEASONS[0][:4]) + 1
MODERN_END_YEARS = list(range(1997, _current_end_year() + 1))
def season_label(end_year):    # 1986 -> "1985-86"
    return f"{end_year-1}-{str(end_year)[2:]}"

TABLE_ID = {"totals": "totals_stats", "advanced": "advanced", "season": "advanced-team"}

# team-level tables on the season summary page (NBA_{year}.html). Needed for the
# possession estimate (Pace -> POSS = Pace*MP/48 for the /75 bars) and as the
# team/opponent context for the formula cross-check.
TEAM_TABLES = {"advanced-team": "adv", "totals-team": "tot", "totals-opponent": "opp"}
TEAM_PACE = "pace"  # data-stat on advanced-team

# BR column (data-stat) -> our logical key. Totals feed the engine's formulas;
# Advanced columns are cross-check + the composite value bars taken from BR directly.
TOTALS_COLS = {
    "name_display": "name", "age": "age", "team_name_abbr": "team", "pos": "pos",
    "games": "gp", "games_started": "gs", "mp": "min",
    "fg": "fgm", "fga": "fga", "fg3": "fg3m", "fg3a": "fg3a",
    "ft": "ftm", "fta": "fta", "orb": "orb", "drb": "drb", "trb": "trb",
    "ast": "ast", "stl": "stl", "blk": "blk", "tov": "tov", "pf": "pf", "pts": "pts",
    # BR-precomputed rate on the totals table, kept for cross-check only:
    "efg_pct": "br_efg_pct",
}
ADV_COLS = {
    "team_name_abbr": "team", "mp": "min",
    # composite value bars taken from BR (model estimates — labelled as such):
    "per": "per", "ws": "ws", "ws_per_48": "ws48", "ows": "ows", "dws": "dws",
    "obpm": "obpm", "dbpm": "dbpm", "bpm": "bpm", "vorp": "vorp",
    # BR-precomputed rates -> cross-check our recomputation:
    "ts_pct": "br_ts", "usg_pct": "br_usg", "ast_pct": "br_ast",
    "orb_pct": "br_orb", "drb_pct": "br_drb", "trb_pct": "br_trb",
    "tov_pct": "br_tov", "stl_pct": "br_stl", "blk_pct": "br_blk",
    "fg3a_per_fga_pct": "br_3par", "fta_per_fga_pct": "br_ftr", "pace_dummy": "br_pace",
}

# ---------------------------------------------------------------- fetch
def cache_path(end_year, kind):
    return os.path.join(BR_CACHE, f"NBA_{end_year}_{kind}.html")

def fetch_page(end_year, kind):
    """Return raw HTML for one (season, table), from cache if present else live (cached after).
    kind in {'totals','advanced'} hit the player pages; kind=='season' hits NBA_{year}.html
    (team/opponent/pace tables)."""
    import requests
    cp = cache_path(end_year, kind)
    if os.path.exists(cp):
        return open(cp, encoding="utf-8").read()
    url = SEASON_BASE.format(year=end_year) if kind == "season" else BASE.format(year=end_year, kind=kind)
    last = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            # BR serves UTF-8 but omits charset from Content-Type, so requests falls back
            # to ISO-8859-1 and mojibakes every accented name ("Jokić" -> "JokiÄ\x87"),
            # which then fails the name join in br_value_modern/br_crosswalk. Force UTF-8.
            r.encoding = "utf-8"
            if r.status_code == 200 and "id=\"" + TABLE_ID[kind] + "\"" in r.text:
                os.makedirs(BR_CACHE, exist_ok=True)
                open(cp, "w", encoding="utf-8").write(r.text)
                print(f"  fetched {season_label(end_year)} {kind} ({len(r.text)} bytes)")
                time.sleep(REQUEST_DELAY)
                return r.text
            # a 200 without the table: BR has the page but hasn't posted the stats yet (early in a season)
            last = f"status={r.status_code} ({'no ' + TABLE_ID[kind] + ' table on the page yet' if r.status_code == 200 else 'blocked or unavailable'})"
            # 429 / temporary block -> longer back-off
            time.sleep(REQUEST_DELAY * (attempt + 2))
        except Exception as e:  # noqa
            last = repr(e)[:160]
            time.sleep(REQUEST_DELAY * (attempt + 2))
    raise RuntimeError(f"BR fetch failed {season_label(end_year)} {kind}: {last}")

# ---------------------------------------------------------------- parse
class _TableRows(HTMLParser):
    """Extract rows of a single BR table (by id) as [{data-stat: text, 'br_id': ...}].
    Header/spacer rows (class contains 'thead') and rows without a player id are skipped."""
    def __init__(self, table_id):
        super().__init__(convert_charrefs=True)
        self.table_id = table_id
        self.in_table = False
        self.depth = 0            # table nesting guard
        self.rows = []
        self._row = None
        self._skip_row = False
        self._stat = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            if a.get("id") == self.table_id:
                self.in_table = True; self.depth = 1
            elif self.in_table:
                self.depth += 1
            return
        if not self.in_table:
            return
        if tag == "tr":
            cls = a.get("class", "") or ""
            self._skip_row = "thead" in cls
            self._row = {} if not self._skip_row else None
        elif tag in ("td", "th") and self._row is not None:
            self._stat = a.get("data-stat")
            self._buf = []
            if "data-append-csv" in a:
                self._row["br_id"] = a["data-append-csv"]

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
            self._stat = None; self._buf = []
        elif tag == "tr" and self._row is not None:
            if self._row.get("br_id"):
                self.rows.append(self._row)
            self._row = None

def parse_table(html, kind):
    p = _TableRows(TABLE_ID[kind]); p.feed(html)
    return p.rows

def _num(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except ValueError:
        return None

def load_season(end_year):
    """Parse cached Totals+Advanced for one season into {br_id: {logical: value}}.
    Traded players: BR emits a combined 'nTM' aggregate row FIRST, then per-team split
    rows (same br_id). We key on the aggregate for the season stat line, and pick the
    display team as the split row with the most minutes (nTM stays only if no split rows)."""
    tot = parse_table(fetch_page(end_year, "totals"), "totals")
    adv = parse_table(fetch_page(end_year, "advanced"), "advanced")

    # --- totals: first row per player = full-season line (aggregate if traded) ---
    players = {}
    split_team_mp = {}   # br_id -> [(team, mp)] from non-aggregate split rows
    for r in tot:
        bid = r["br_id"]
        team = r.get("team_name_abbr", "")
        rec = {TOTALS_COLS[k]: (_num(v) if TOTALS_COLS[k] not in ("name", "team", "pos") else v)
               for k, v in r.items() if k in TOTALS_COLS}
        if bid not in players:
            players[bid] = rec           # first row = season aggregate
        elif not re.match(r"\dTM$", team):
            split_team_mp.setdefault(bid, []).append((team, _num(r.get("mp")) or 0))

    # resolve display team for traded (nTM) players -> max-minutes real team
    for bid, rec in players.items():
        if isinstance(rec.get("team"), str) and re.match(r"\dTM$", rec["team"]):
            splits = split_team_mp.get(bid)
            if splits:
                rec["team"] = max(splits, key=lambda t: t[1])[0]

    # --- advanced: merge composite-value + cross-check columns onto the aggregate ---
    adv_first = {}
    for r in adv:
        bid = r["br_id"]
        if bid in adv_first:            # first (aggregate) row only
            continue
        adv_first[bid] = r
        if bid in players:
            for k, logical in ADV_COLS.items():
                if k in r and logical not in ("team", "min"):
                    players[bid][logical] = _num(r[k])
    return players

# ---------------------------------------------------------------- team env
_COMMENT = re.compile(r"<!--|-->")
_TEAM_ABBR = re.compile(r"/teams/([A-Z0-9]{2,3})/")

class _TeamRows(HTMLParser):
    """Rows of a season-summary team table. Captures the team abbreviation from the
    team cell's /teams/{ABBR}/ href (player rows use those same abbreviations)."""
    def __init__(self, table_id):
        super().__init__(convert_charrefs=True)
        self.table_id = table_id
        self.in_table = False; self.depth = 0
        self.rows = []; self._row = None; self._skip = False
        self._stat = None; self._buf = []; self._href = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            if a.get("id") == self.table_id:
                self.in_table = True; self.depth = 1
            elif self.in_table:
                self.depth += 1
            return
        if not self.in_table:
            return
        if tag == "tr":
            self._skip = "thead" in (a.get("class", "") or "")
            self._row = None if self._skip else {}
        elif tag in ("td", "th") and self._row is not None:
            self._stat = a.get("data-stat"); self._buf = []
        elif tag == "a" and self._stat == "team":
            m = _TEAM_ABBR.search(a.get("href", "") or "")
            if m:
                self._row["abbr"] = m.group(1)

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
            self._row[self._stat] = "".join(self._buf).strip(); self._stat = None
        elif tag == "tr" and self._row is not None:
            if self._row.get("abbr"):
                self.rows.append(self._row)
            self._row = None

def load_team_env(end_year):
    """{team_abbr: {'pace','tm_mp','tm_fga','tm_ftm',... 'opp_...'}} for one season.
    Team tables on the season page can be wrapped in HTML comments — strip the markers
    before parsing so the ids become visible to the parser."""
    html = _COMMENT.sub("", fetch_page(end_year, "season"))
    env = {}
    for table_id, tag in TEAM_TABLES.items():
        p = _TeamRows(table_id); p.feed(html)
        for r in p.rows:
            rec = env.setdefault(r["abbr"], {})
            if tag == "adv":
                rec["pace"] = _num(r.get("pace"))
            elif tag == "tot":
                rec["tm_g"] = _num(r.get("g"))
                for c in ("mp", "fg", "fga", "fg3", "fg3a", "ft", "fta", "orb", "drb", "trb",
                          "ast", "stl", "blk", "tov", "pts"):
                    rec["tm_" + c] = _num(r.get(c))
            elif tag == "opp":
                for c in ("fga", "fg3a", "orb", "drb", "trb"):
                    rec["opp_" + c] = _num(r.get("opp_" + c))
    return env

def load_advanced(end_year):
    """{br_id: {'name','per','ws48','bpm','obpm','dbpm','vorp'}} — Advanced table only
    (used for the modern value-bar backfill; aggregate row per player)."""
    adv = parse_table(fetch_page(end_year, "advanced"), "advanced")
    out = {}
    for r in adv:
        bid = r["br_id"]
        if bid in out:
            continue
        out[bid] = {
            "name": r.get("name_display", ""),
            "per": _num(r.get("per")), "ws48": _num(r.get("ws_per_48")),
            "bpm": _num(r.get("bpm")), "obpm": _num(r.get("obpm")),
            "dbpm": _num(r.get("dbpm")), "vorp": _num(r.get("vorp")),
        }
    return out

# ---------------------------------------------------------------- cli
def fetch_all():
    os.makedirs(BR_CACHE, exist_ok=True)
    for ey in BR_END_YEARS:
        for kind in ("totals", "advanced", "season"):
            fetch_page(ey, kind)
    print(f"done — {len(BR_END_YEARS)} seasons cached under {BR_CACHE}/")

def fetch_modern_advanced():
    """Cache the Advanced table for every 1996-97..current season (value-bar backfill)."""
    os.makedirs(BR_CACHE, exist_ok=True)
    for ey in MODERN_END_YEARS:
        fetch_page(ey, "advanced")
    print(f"done — {len(MODERN_END_YEARS)} modern advanced pages cached under {BR_CACHE}/")

def parse_sample():
    for ey in (1986, 1990, 1980, 1996):
        pl = load_season(ey)
        j = pl.get("jordami01") or {}
        b = pl.get("birdla01") or {}
        print(f"{season_label(ey)}: {len(pl)} players | "
              f"Jordan pts={j.get('pts')} min={j.get('min')} PER={j.get('per')} team={j.get('team')} | "
              f"Bird pts={b.get('pts')} ws48={b.get('ws48')} team={b.get('team')}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    {"fetch": fetch_all, "modern": fetch_modern_advanced, "parse": parse_sample}.get(cmd, fetch_all)()
