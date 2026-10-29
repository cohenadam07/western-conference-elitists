#!/usr/bin/env python3
"""Every coach's photo for every season he coached -> public/bcs/heads.json.

Follows Football Savant's season-photo rules (pipeline/football/heads.py). What the NBA keeps
(found Oct 28, 2026):

  - cdn.nba.com/headshots/nba/<team id>/<start year>/<size>/<COACH_ID>.png: a photo of the
    coach shot for that team and that season, the same per-team-season store Basketball
    Savant draws players from. It begins in 2015-16, and a coach-season has one only when
    the team's media day shot him (about three in four from 2019-20 on, far fewer before).
  - cdn.nba.com/headshots/nba/latest/<size>/<COACH_ID>.png: his newest photo. Most coach
    ids come back as the NBA's blank silhouette; a former player's photo lives under his
    player id instead, which is not his coach id (Kidd is 203456 as a coach, 429 as a
    player), so the player id is tried too.
  - Basketball-Reference's one photo per coach (req/202106291/images/headshots/<slug>.jpg):
    the coach slug for career coaches, the player slug for men who played. One photo, from
    whatever year, so it is a face to crop and never a season's photo.

COACH_IDs come from CommonTeamRoster's Coaches table (the engine cache), matched to our
coaches by name within the team-season; a name that matches nowhere else is taken from any
season. The NBA's staff tables begin in 1996-97, so a coach who stopped before then can only
have a Basketball-Reference face or a badge.

So each coach-season gets one of three things (the same marks as football):

  0  a photo shot that season, for that team, shown as it is
  1  the nearest photo of him there is (another season's, his newest, his playing days, or
     Basketball-Reference's); the page crops it to his face so no jersey or polo shows and
     frames it in that season's team colours
  2  no photo of him anywhere: the page draws a badge in that season's team colours with
     his initials

Output, run-length by season so a career of cropped faces is one entry:
  {"v":1, "live":2016, "p":{"spoeler99c":[[2008,"<key>",1,"MIA"],[2019,"<key>",0,"MIA"], ...]},
   "teams":{"MIA":["#98002E","#F9A01B"], ...}, "alias":{"SFW":"GSW", ...}}
A key is "<team id>/<year>/<coach id>" for a season photo, "<id>" for a latest photo (coach
or player id, same path), "br/<slug>" for Basketball-Reference; the fourth field is the
team whose colours frame it. An entry holds until the coach's next one; a coach with no
seasons (an assistant on the tree) has one entry at 0.

Blank silhouettes are found by fingerprint (the CDN's ETag from a HEAD request, no
download): the blank is the same picture under every id. Fingerprints are kept in
heads_etag.json so a re-run only asks about photos it has not seen; a miss (the CDN's 403)
is kept too, except for the season in progress, which is asked again every run because
media-day photos land during October.

  python3 heads.py                 # every coach, every season
  python3 heads.py --refresh       # ask the CDN again about the season in progress only
  python3 heads.py --skip-br       # don't ask Basketball-Reference this run (one request every 2.5 s)
"""
import concurrent.futures
import glob
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import teams as TM  # noqa: E402
from registry import SAVANT, norm  # noqa: E402

PUB = os.path.normpath(os.path.join(HERE, "..", "..", "..", "public", "bcs"))
OUT = os.path.join(PUB, "heads.json")
CACHE = os.path.join(HERE, "heads_etag.json")
LIVE = 2016                                   # first season with per-team-season photos (none exist for 2015-16, 2017-18 or 2018-19)
CDN = "https://cdn.nba.com/headshots/nba/"
BR = "https://www.basketball-reference.com/req/202106291/images/headshots/"
BLANK = {"7475ba9619305909d7998dd9dba02481", "32994f8c8277c8367aa158ed838c0b43"}   # the NBA's silhouette at 260x190 and 1040x760
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:                           # pragma: no cover
    CTX = ssl.create_default_context()

# a second colour per franchise, for the collar under a cropped face and the hem of a badge
COLORS2 = {
    "ATL": "#FDB927", "BOS": "#BA9653", "BKN": "#FFFFFF", "CHA": "#00788C", "CHI": "#000000", "CLE": "#FDBB30", "DAL": "#002B5E",
    "DEN": "#FEC524", "DET": "#1D42BA", "GSW": "#FFC72C", "HOU": "#000000", "IND": "#FDBB30", "LAC": "#1D428A", "LAL": "#FDB927",
    "MEM": "#12173F", "MIA": "#F9A01B", "MIL": "#EEE1C6", "MIN": "#236192", "NOP": "#C8102E", "NYK": "#006BB6", "OKC": "#EF5133",
    "ORL": "#C4CED4", "PHI": "#ED174C", "PHX": "#E56020", "POR": "#000000", "SAC": "#63727A", "SAS": "#000000", "TOR": "#000000",
    "UTA": "#F9A01B", "WAS": "#E31837",
}
# Basketball-Reference's codes for teams that moved or folded, on top of teams.ALIASES
OLD_CODES = {
    "SFW": "GSW", "PHW": "GSW", "KCK": "SAC", "KCO": "SAC", "CIN": "SAC", "ROC": "SAC", "SDC": "LAC", "BUF": "LAC",
    "MNL": "LAL", "STL": "ATL", "MLH": "ATL", "TRI": "ATL", "SYR": "PHI", "FTW": "DET", "BAL": "WAS", "CHZ": "WAS", "CHP": "WAS",
    "CAP": "WAS", "SDR": "HOU", "NOJ": "UTA", "DNA": "DEN", "DNR": "DEN", "NYN": "BKN", "NYA": "BKN", "INA": "IND", "SAA": "SAS",
    "DLC": "SAS", "TEX": "SAS", "NJA": "BKN", "KEN": "", "VIR": "", "MMS": "", "UTS": "", "SSL": "", "CAR": "", "FLO": "", "MMP": "",
    "MMT": "", "PTC": "", "PTP": "", "MNM": "", "MNP": "", "NOB": "", "OAK": "", "ANA": "", "LAS": "", "HSM": "", "WSA": "", "DET": "DET",
    "SEA": "OKC", "VAN": "MEM", "NJN": "BKN", "NOH": "NOP", "NOK": "NOP", "CHH": "CHA", "WSB": "WAS", "BRK": "BKN", "CHO": "CHA", "PHO": "PHX",
    "NOP": "NOP", "SDS": "", "CLR": "", "PRO": "", "WAT": "", "STB": "", "AND": "", "SHE": "", "INJ": "", "INO": "", "DEF": "", "TOH": "",
    "PIT": "", "CHS": "", "BLB": "", "WAS": "WAS",
}


def franchise(code):
    return TM.ALIASES.get(str(code).upper()) or OLD_CODES.get(str(code).upper()) or ""


def start_year(season):
    return int(str(season)[:4])


def key_url(k, size="260x190"):
    """A key -> the URL the fingerprint is asked about (the page builds the same from the key)."""
    if k.startswith("br/"):
        return BR + k[3:] + ".jpg"
    if "/" in k:
        tid, y, cid = k.split("/")
        return f"{CDN}{tid}/{y}/{size}/{cid}.png"
    return f"{CDN}latest/{size}/{k}.png"


def head(url):
    """(etag, status) for a URL; etag '' when there is no image there."""
    for _ in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=20, context=CTX)
            ct = r.headers.get("Content-Type") or ""
            if not ct.startswith("image"):
                return "", r.status
            return (r.headers.get("ETag") or "").strip('"')[:32] or ("len%s" % r.headers.get("Content-Length")), r.status
        except urllib.error.HTTPError as e:
            return "", e.code
        except Exception:
            time.sleep(0.5)
    return None, 0


# ------------------------------------------------------------------ what we know
def roster_coaches():
    """{season: {franchise: [(name, role, COACH_ID)]}} from every cached CommonTeamRoster."""
    import pandas as pd
    import savant_engine as E
    out = defaultdict(dict)
    for s in [f"{y}-{str(y + 1)[2:]}" for y in range(1996, 2031)]:
        for tid, fr in TM.FRANCHISES.items():
            p = os.path.join(SAVANT, "cache", E._key("CommonTeamRoster", dict(team_id=tid, season=s), 1) + ".json")
            if not os.path.exists(p):
                continue
            try:
                df = pd.read_json(p)
            except ValueError:
                continue
            if not len(df) or "COACH_TYPE" not in df.columns:
                continue
            rows = []
            for r in df.itertuples(index=False):
                if str(r.COACH_TYPE) in ("Head Coach", "Assistant Coach") and str(r.COACH_ID).isdigit():
                    rows.append((norm(r.COACH_NAME), str(r.COACH_TYPE), str(r.COACH_ID)))
            if rows:
                out[s][fr] = rows
    return out


def player_ids():
    """{normalised name: player id} for names that belong to exactly one NBA player."""
    try:
        from nba_api.stats.static import players as SP
    except ImportError:
        return {}
    c = Counter(norm(p["full_name"]) for p in SP.get_players())
    return {norm(p["full_name"]): str(p["id"]) for p in SP.get_players() if c[norm(p["full_name"])] == 1}


def load_coaches():
    """Every coach the page knows: his seasons as a head coach (all-time records, with the
    1996-97-on rows carrying the franchise), his assistant seasons, whether he played."""
    out = {}
    for p in sorted(glob.glob(os.path.join(PUB, "c", "*.json"))):
        d = json.load(open(p))
        seasons = {}
        for r in d.get("records") or []:
            fr = franchise(r.get("team"))
            if r.get("lg") not in (None, "NBA", "BAA"):
                continue
            seasons.setdefault(start_year(r["season"]), fr)
        for r in d.get("seasons") or []:              # the modern rows carry the franchise key
            seasons[start_year(r["season"])] = franchise(r["team"]) or seasons.get(start_year(r["season"]), "")
        ast = [(start_year(r["season"]), franchise(r.get("team"))) for r in (d.get("assistant") or []) if r.get("lg") == "NBA"]
        out[d["id"]] = dict(name=d["name"], seasons=seasons, ast=ast, played=bool((d.get("bio") or {}).get("played")))
    return out


def coach_ids(coaches, rosters):
    """{slug: COACH_ID} by name within the team-season, else a name no one else has."""
    byname = defaultdict(Counter)
    for s, t in rosters.items():
        for fr, rows in t.items():
            for n, role, cid in rows:
                byname[n][cid] += 1
    out = {}
    for slug, c in coaches.items():
        n = norm(c["name"])
        got = Counter()
        spots = [(y, fr, True) for y, fr in c["seasons"].items()] + [(y, fr, False) for y, fr in c["ast"]]
        for y, fr, hc in spots:
            for rn, role, cid in rosters.get(f"{y}-{str(y + 1)[2:]}", {}).get(fr, []):
                if rn == n and (role == "Head Coach") == hc:
                    got[cid] += 2
                elif rn == n:
                    got[cid] += 1
        if not got and len(byname.get(n, {})) == 1:
            got = byname[n]
        if got:
            out[slug] = got.most_common(1)[0][0]
    return out


# ------------------------------------------------------------------ the pick
def main():
    refresh = "--refresh" in sys.argv
    skip_br = "--skip-br" in sys.argv                 # leave Basketball-Reference's photos unasked this run
    coaches = load_coaches()
    rosters = roster_coaches()
    cid = coach_ids(coaches, rosters)
    pid = player_ids()
    newest = max(y for c in coaches.values() for y in c["seasons"]) if coaches else LIVE
    print(f"heads: {len(coaches)} coaches, {len(cid)} with a COACH_ID, {sum(1 for c in coaches.values() if c['played'])} who played; newest season {newest}")

    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    if refresh:
        for k in list(cache):
            if "/" in k and k.split("/")[1] == str(newest):
                cache.pop(k)
    # every photo that could exist: his season photos (2015-16 on), his newest, his playing days, Basketball-Reference's
    want = {}
    for slug, c in coaches.items():
        ks = []
        if slug in cid:
            for y, fr in c["seasons"].items():
                if y >= LIVE and fr in TM.ID_OF:
                    ks.append(f"{TM.ID_OF[fr]}/{y}/{cid[slug]}")
            ks.append(cid[slug])
        if c["played"] and norm(c["name"]) in pid:
            ks.append(pid[norm(c["name"])])
        ks.append("br/" + slug)
        if c["played"] and slug.endswith("c"):
            ks.append("br/" + slug[:-1])
        want[slug] = ks
    todo = sorted({k for ks in want.values() for k in ks if k not in cache})
    cdn = [k for k in todo if not k.startswith("br/")]
    br = [] if skip_br else [k for k in todo if k.startswith("br/")]
    if cdn:
        print(f"  asking the NBA's CDN about {len(cdn)} photos")
        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            for i, (k, (et, st)) in enumerate(zip(cdn, ex.map(lambda k: head(key_url(k)), cdn)), 1):
                if et is not None:
                    cache[k] = et
                if i % 500 == 0:
                    print(f"    {i} / {len(cdn)}")
                    json.dump(dict(sorted(cache.items())), open(CACHE, "w"), separators=(",", ":"))
    if br:
        print(f"  asking Basketball-Reference about {len(br)} photos, one every 2.5 s")
        for i, k in enumerate(br, 1):
            et, st = head(key_url(k))
            if st == 429:
                print("    rate limited; resting two minutes")
                time.sleep(120)
                et, st = head(key_url(k))
            if et is not None:
                cache[k] = et
            if i % 50 == 0:
                print(f"    {i} / {len(br)}")
                json.dump(dict(sorted(cache.items())), open(CACHE, "w"), separators=(",", ":"))
            time.sleep(2.5)
    json.dump(dict(sorted(cache.items())), open(CACHE, "w"), separators=(",", ":"))

    shared = Counter(v for v in cache.values() if v)
    blank = BLANK | {et for et, n in shared.items() if n >= 5}

    def real(k):
        return bool(k) and bool(cache.get(k)) and cache[k] not in blank

    per = {}
    for slug, c in coaches.items():
        ks = want[slug]
        season_keys = {int(k.split("/")[1]): k for k in ks if "/" in k and not k.startswith("br/") and real(k)}
        face = next((k for k in ks if "/" not in k and real(k)), None) or next((k for k in ks if k.startswith("br/") and real(k)), None)

        def pick(y):
            fr = c["seasons"].get(y, "")
            if y in season_keys:
                return season_keys[y], 0, fr
            for d in range(1, 40):
                for z in (y + d, y - d):
                    if z in season_keys:
                        return season_keys[z], 1, fr
            if face:
                # the newest photo of a coach in the season being played is that season's
                return face, (0 if ("/" not in face and not face.startswith("br/") and y == newest and y >= LIVE) else 1), fr
            return "", 2, fr
        ys = sorted(c["seasons"]) or [0]
        per[slug] = {y: pick(y) for y in ys}

    out = {}
    for slug in sorted(per):
        runs, last = [], None
        for y in sorted(per[slug]):
            v = per[slug][y]
            if v != last:
                runs.append([y, v[0], v[1], v[2]])
                last = v
        if runs and not (len(runs) == 1 and runs[0][2] == 2):
            out[slug] = runs
    teams = {k: [TM.COLORS[k], COLORS2.get(k, "#FFFFFF")] for k in TM.COLORS}
    alias = {k: v for k, v in list(TM.ALIASES.items()) + list(OLD_CODES.items()) if v and k != v}
    body = {"v": 1, "live": LIVE, "p": out, "teams": teams, "alias": alias}
    txt = json.dumps(body, separators=(",", ":"))
    old = open(OUT).read() if os.path.exists(OUT) else None
    if txt != old:
        with open(OUT, "w") as f:
            f.write(txt)

    # coverage, by era, over head-coach seasons (every coach-season the page shows)
    eras = [("1946-1995", 0, 1995), ("1996-2014", 1996, 2014), ("2015-2019", 2015, 2019), ("2020-", 2020, 9999)]
    print(f"heads: {sum(len(v) for v in per.values())} coach-seasons · {len(txt) // 1024} KB{'' if txt != old else ' (unchanged)'}")
    print("  era        seasons  own photo   face    badge")
    for label, a, b in eras:
        t = Counter(v[1] for c in per.values() for y, v in c.items() if a <= y <= b and y > 0)
        n = sum(t.values()) or 1
        print(f"  {label:10} {n:7}  {100 * t[0] / n:7.0f}%  {100 * t[1] / n:5.0f}%  {100 * t[2] / n:5.0f}%")
    t = Counter(v[1] for c in per.values() for y, v in c.items() if y > 0)
    n = sum(t.values()) or 1
    print(f"  {'all':10} {n:7}  {100 * t[0] / n:7.0f}%  {100 * t[1] / n:5.0f}%  {100 * t[2] / n:5.0f}%")
    faces = Counter(("season" if "/" in k and not k.startswith("br/") else "br" if k.startswith("br/") else "latest") for c in per.values() for v in c.values() for k in [v[0]] if k)
    print(f"  photos used: {dict(faces)}")
    return per


if __name__ == "__main__":
    main()
