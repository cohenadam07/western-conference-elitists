"""
draft_scrape.py — cached, polite fetcher for the Draft Savant backfill (classes 2010-2020).

Four sources, one on-disk cache dir (cache_draft/). A cached file is NEVER re-fetched, so
re-runs are free and offline. Live requests carry a polite delay and a browser UA (same
discipline as br_fetch.py). Nothing here fabricates a value — a stat a source doesn't carry
comes back as None and is hidden downstream.

Sources
  1. Barttorvik  getadvstats.php?year=Y&csv=1   -> one headerless CSV per season: every
     college player's advanced rate stats, shot-location splits, BPM/OBPM/DBPM, box line,
     class year and Torvik role. Column map verified against 2010 John Wall / Cousins / Turner.
  2. Basketball-Reference  draft/NBA_Y.html      -> the draft board: pick, team, player,
     college, and the player's BR page link (for birthdate).
  3. Basketball-Reference  /players/x/id.html    -> real birthdate (Torvik's is a placeholder).
  4. stats.nba.com  draftcombinestats            -> combine anthro + max vertical. The combine
     for the June-Y draft is labelled SeasonYear "(Y-1)-YY".

CLI:
  python draft_scrape.py fetch 2010            # fetch+cache everything for one class
  python draft_scrape.py fetch 2010 2020       # inclusive range
  python draft_scrape.py torvik-cols 2010      # debug: dump a Torvik row by player name
"""
import os, sys, time, ssl, json, re, csv, io, unicodedata
import urllib.request

CACHE = "cache_draft"
DELAY = 3.5                     # seconds between LIVE requests (cached hits are instant)
_last_fetch = [0.0]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE          # macOS python often lacks a CA bundle; sources are public

NBA_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com",
    "x-nba-stats-origin": "stats", "x-nba-stats-token": "true", "Connection": "keep-alive",
}


def _fetch(url, headers=None, timeout=90):
    """One LIVE GET with polite spacing. Callers cache the result themselves."""
    wait = DELAY - (time.time() - _last_fetch[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as fh:
            return fh.read()
    finally:
        _last_fetch[0] = time.time()


def _cached(path, url, headers=None, binary=True, timeout=90, retries=3):
    """Return cache contents, fetching+persisting on first miss. Never re-fetches a hit."""
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read() if binary else fh.read().decode("utf-8", "replace")
    last = None
    for attempt in range(retries):
        try:
            raw = _fetch(url, headers=headers, timeout=timeout)
            if raw:
                with open(path, "wb") as fh:
                    fh.write(raw)
                return raw if binary else raw.decode("utf-8", "replace")
        except Exception as e:                       # noqa: BLE001 — polite back-off on any transport error
            last = e
            time.sleep(DELAY * (attempt + 1))
    raise RuntimeError(f"fetch failed after {retries} tries: {url} ({last})")


# --------------------------------------------------------------------------- name matching
_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def norm_name(s):
    """Accent-fold, drop punctuation/suffixes, collapse spaces -> a stable match key."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower().replace(".", " ").replace("-", " ").replace("'", "")
    s = _SUFFIX.sub("", s)
    return " ".join(s.split())


# --------------------------------------------------------------------------- 1) Barttorvik
# Verified 67-column layout of getadvstats.php?csv=1 (0-indexed).
T = dict(name=0, team=1, conf=2, g=3, minpct=4, ortg=5, usg=6, efg=7, ts=8,
         orb=9, drb=10, ast=11, tov=12, ftm=13, fta=14, ftpct=15, twopm=16, twopa=17,
         twoppct=18, tpm=19, tpa=20, tppct=21, blk=22, stl=23, ftr=24, cls=25, ht=26,
         num=27, porpag=28, adjoe=29, pfr=30, year=31, pid=32, hometown=33, rec=34,
         rimm=36, rima=37, midm=38, mida=39, rimpct=40, midpct=41,
         bpm=50, obpm=51, dbpm=52, mpg=54, orbpg=57, drbpg=58, trbpg=59, astpg=60,
         stlpg=61, blkpg=62, ppg=63, role=64, bdate=66)


def torvik_year(year):
    """{normalized_name: rawrow[list]} for a season. rowSet is headerless CSV."""
    raw = _cached(os.path.join(CACHE, f"torvik_{year}.csv"),
                  f"https://barttorvik.com/getadvstats.php?year={year}&csv=1",
                  binary=False)
    out = {}
    for row in csv.reader(io.StringIO(raw)):
        if len(row) < 64:
            continue
        out.setdefault(norm_name(row[T["name"]]), row)   # first (higher-minutes) row wins
    return out


def _f(row, key):
    """Float a Torvik cell, or None if blank/unparseable."""
    try:
        v = row[T[key]].strip()
        return float(v) if v not in ("", "-") else None
    except (ValueError, IndexError):
        return None


def torvik_stats(row):
    """Map one Torvik row -> the metric fields Draft Savant renders (page-native scales)."""
    def pct100(k):                      # decimal fraction -> percentage
        v = _f(row, k)
        return round(v * 100, 1) if v is not None else None
    ts = _f(row, "ts")
    twopa, tpa = _f(row, "twopa"), _f(row, "tpa")
    fga = (twopa or 0) + (tpa or 0)
    tp3r = round(100 * tpa / fga, 1) if fga and tpa is not None else None
    return dict(
        ts=round(ts / 100, 4) if ts is not None else None,     # page stores TS as 0-1 decimal
        efg=_f(row, "efg"), usg=_f(row, "usg"), ortg=_f(row, "ortg"),
        ft=pct100("ftpct"), tp3=pct100("tppct"), twop=pct100("twoppct"),
        rimfg=pct100("rimpct"), midfg=pct100("midpct"),
        ast=_f(row, "ast"), tov=_f(row, "tov"), oreb=_f(row, "orb"), dreb=_f(row, "drb"),
        stl=_f(row, "stl"), blk=_f(row, "blk"),
        bpm=_f(row, "bpm"), obpm=_f(row, "obpm"), dbpm=_f(row, "dbpm"),
        tp3r=tp3r, ftr=_f(row, "ftr"),
        # carried for header / derived use, not all rendered as bars:
        gp=int(_f(row, "g")) if _f(row, "g") is not None else None,
        ppg=_f(row, "ppg"), rpg=_f(row, "trbpg"), apg=_f(row, "astpg"),
        cls=row[T["cls"]].strip(), role=row[T["role"]].strip(),
        ht_torvik=row[T["ht"]].strip(),
    )


ROLE_POS = {  # Torvik role -> Draft Savant pos vocabulary {Guard, Wing, Big}
    "Pure PG": "Guard", "Scoring PG": "Guard", "Combo G": "Guard",
    "Wing G": "Wing", "Wing F": "Wing", "Stretch 4": "Big",
    "PF/C": "Big", "C": "Big", "Big": "Big",
}


def role_to_pos(role):
    if role in ROLE_POS:
        return ROLE_POS[role]
    if "PG" in role or "Combo G" in role:
        return "Guard"
    if "Wing" in role:
        return "Wing"
    return "Big"


# --------------------------------------------------------------------------- 2) BR draft board
def br_draft(year):
    """[{pick,team,player,college,link}] for round 1+2 of a draft."""
    raw = _cached(os.path.join(CACHE, f"br_draft_{year}.html"),
                  f"https://www.basketball-reference.com/draft/NBA_{year}.html",
                  binary=False)
    picks = []
    for tr in re.findall(r"<tr[^>]*>.*?</tr>", raw, re.S):
        if 'data-stat="pick_overall"' not in tr or 'scope="col"' in tr:
            continue
        cells = dict(re.findall(r'data-stat="([a-z_]+)"[^>]*>(.*?)</t[dh]>', tr, re.S))
        strip = lambda v: re.sub(r"<[^>]+>", "", v).strip()
        link = re.search(r'''href=["'](/players/[a-z]/[^"']+\.html)["']''', tr)
        pk = strip(cells.get("pick_overall", ""))
        if not pk.isdigit():
            continue
        picks.append(dict(pick=int(pk), team=strip(cells.get("team_id", "")),
                          player=strip(cells.get("player", "")),
                          college=strip(cells.get("college_name", "")),
                          link=link.group(1) if link else None))
    return picks


# --------------------------------------------------------------------------- 3) BR birthdate
def br_birthdate(link):
    """ISO birthdate 'YYYY-MM-DD' from a BR player page, or None."""
    if not link:
        return None
    slug = link.strip("/").replace("/", "_")
    raw = _cached(os.path.join(CACHE, f"br_player_{slug}"),
                  "https://www.basketball-reference.com" + link, binary=False)
    m = re.search(r'''id=["']necro-birth["'][^>]*data-birth=["'](\d{4}-\d{2}-\d{2})["']''', raw)
    return m.group(1) if m else None


# --------------------------------------------------------------------------- 4) NBA combine
def combine_year(draft_year):
    """{normalized_name: {height,weight,wing,reach,vert}} for a draft class (may be empty)."""
    # The May-Y combine is labelled with the UPCOMING season the rookies will play:
    # e.g. the 2010-draft combine is SeasonYear "2010-11" (verified: "2009-10" returns 2009 picks).
    season = f"{draft_year}-{str(draft_year + 1)[2:]}"
    raw = _cached(os.path.join(CACHE, f"combine_{draft_year}.json"),
                  f"https://stats.nba.com/stats/draftcombinestats?LeagueID=00&SeasonYear={season}",
                  headers=NBA_HEADERS, binary=False)
    d = json.loads(raw)
    rs = d["resultSets"][0]
    idx = {h: i for i, h in enumerate(rs["headers"])}
    out = {}

    def num(row, key):
        try:
            v = row[idx[key]]
            return float(v) if v not in (None, "") else None
        except (ValueError, KeyError, IndexError):
            return None
    for row in rs["rowSet"]:
        out[norm_name(row[idx["PLAYER_NAME"]])] = dict(
            height=num(row, "HEIGHT_WO_SHOES"), weight=num(row, "WEIGHT"),
            wing=num(row, "WINGSPAN"), reach=num(row, "STANDING_REACH"),
            vert=num(row, "MAX_VERTICAL_LEAP"))
    return out


# --------------------------------------------------------------------------- CLI
def fetch_class(year):
    """Warm every cache for one class and report coverage."""
    picks = br_draft(year)
    r1 = [p for p in picks if p["pick"] <= 30]
    print(f"[{year}] draft board: {len(picks)} picks ({len(r1)} in top 30)")
    tv = torvik_year(year)
    print(f"[{year}] torvik season: {len(tv)} players")
    try:
        cb = combine_year(year)
        print(f"[{year}] combine: {len(cb)} measured")
    except Exception as e:                              # noqa: BLE001
        print(f"[{year}] combine: FAILED ({e})")
    got = 0
    for p in r1:
        bd = br_birthdate(p["link"])
        if bd:
            got += 1
    print(f"[{year}] birthdates: {got}/{len(r1)}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "torvik-cols":
        yr = int(sys.argv[2])
        tv = torvik_year(yr)
        for nm in sys.argv[3:]:
            row = tv.get(norm_name(nm))
            print(nm, "->", torvik_stats(row) if row else "NOT FOUND")
    elif len(sys.argv) >= 3 and sys.argv[1] == "fetch":
        lo = int(sys.argv[2])
        hi = int(sys.argv[3]) if len(sys.argv) > 3 else lo
        for y in range(lo, hi + 1):
            fetch_class(y)
    else:
        print(__doc__)
