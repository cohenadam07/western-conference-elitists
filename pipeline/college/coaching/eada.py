"""
eada.py — Equity in Athletics (EADA), U.S. Department of Education: men's basketball money per
D1 program per season, for the resource view (module H).

    python3 -P -E eada.py download          every year's file, once each, into raw/<season>/
    python3 -P -E eada.py extract           the basketball rows of each year -> raw/<season>/basketball.csv
    python3 -P -E eada.py build             match every D1 program, write eada.json, print the checks

(-P -E: the downloads are untrusted files, so the interpreter never puts the current directory
on the import path. -I is not used because the Excel readers xlrd and openpyxl live in the user
site-packages, which -I drops.)

Source. https://ope.ed.gov/athletics/ is an Angular app; its data-file list is the JSON at
`api/dataFiles/fileList` and each file is `api/dataFiles/file?fileName=<FileName>` (measured Nov 6,
2026). One zip per reporting year, 2000-01 to 2024-25; we take 2002-03 on, the plain file for each
year (not the "All Data Combined" SAS/SPSS bundle). The sport-level file has one row per sport per
institution.

Columns change with the years (written to eada.json's "columns" per season):
  2002-03, 2003-04   coded A3..A57: A3 sport (code 2 = Basketball... read from the sheet's own
                     value labels, see SPORT_OLD), A24 men's team head coaches, A42 assistants,
                     A52 men's team revenues, A55 men's team expenses. CLSCODE 1-3 = Division I.
  2004-05 to 2007-08 coded A3..A114 in the same order as the later named columns: A3 sport,
                     A33 men's head coaches, A69 assistants, A97 revenues, A106 expenses.
                     ClassificationCode 1-3 = Division I.
  2008-09 on         named: Sports, MEN_TOTAL_HEADCOACH, MEN_TOTAL_ASSTCOACH, REV_MEN, EXP_MEN,
                     ClassificationCode / classification_name.
`exp` is the men's team's total expenses (EXP_MEN), not the game-day operating expenses
(OPEXPPERTEAM_MEN), which leave out salaries and aid. Coach salaries are reported per institution
for all men's teams together, not per sport, so they are not used.

Reporting years. EADA's year runs July 1 to June 30, and the file for "2022-2023" is that
academic year, so it is season 2022-23. Checked Nov 6, 2026 on programs that moved up: EADA's
classification turns Division I in exactly the season each joined D1 (Merrimack 2019-20,
Bellarmine and Tarleton 2020-21, St. Thomas 2021-22, Queens and Stonehill 2022-23, West Georgia
2024-25). The 2024-25 file is dated April 2026. The newest file is 2024-25, so 2025-26 and
2026-27 have no EADA row yet.

Coverage (build(), Nov 6, 2026): all 371 programs in College Basketball Savant's team files are
matched, no UNITID serves two programs in a season. Not covered: the three service academies
(NOT_COVERED; Army only in 2003-04 and 2004-05), and St. Francis Brooklyn has no 2022-23 row
(the college ended its athletics program after that season and filed no basketball line).
Some schools report revenue equal to expenses (Kentucky 2022-23 and 2024-25): institutional
support booked to balance, so revenue is not a measure of what the program earns.

Caveats the page must carry: EADA misses NIL and collective money, which exist from 2021-22
(July 2021), so 2021-22 on is a weaker read; schools allocate shared costs differently.

The raw files stay on the Mac (~/Basketball-Savant/out/cbcs/eada/raw/). They are public-domain
federal data, but only the computed per-program numbers leave through eada.json.
"""
import glob
import gzip
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile

HOME = os.path.expanduser("~/Basketball-Savant/out/cbcs/eada")
RAW = os.path.join(HOME, "raw")
LOG = os.path.expanduser("~/Basketball-Savant/logs/cbcs-eada.log")
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC_TEAMS = os.path.join(HERE, "..", "..", "..", "public", "cbb", "teams")
CBBD_TEAMS = os.path.expanduser("~/Basketball-Savant/out/cbb/ref/teams-2026.json")
API = "https://ope.ed.gov/athletics/api/dataFiles/"
UA = {"User-Agent": "wcehoops.com College Basketball Coaching Savant (research)"}
FIRST = 2003   # the file for 2002-03


def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with open(LOG, "a") as fh:
        fh.write(line + "\n")


def season_of(file_name):
    y = re.search(r"(\d{4})-(\d{4})", file_name)
    return f"{y.group(1)}-{y.group(2)[2:]}"


def file_list():
    req = urllib.request.Request(API + "fileList", headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def download():
    os.makedirs(RAW, exist_ok=True)
    for f in file_list():
        if f["Year"] < FIRST or "Combined" in f["FileName"]:
            continue
        s = season_of(f["FileName"])
        d = os.path.join(RAW, s)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "eada.zip")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            continue
        url = API + "file?fileName=" + urllib.parse.quote(f["FileName"])
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
        open(p, "wb").write(data)
        json.dump({"file": f["FileName"], "url": url}, open(os.path.join(d, "source.json"), "w"))
        log(f"{s}: {len(data):,} bytes from {url}")
        time.sleep(2)


# ---------------------------------------------------------------- extract
LAYOUTS = {
    "old": dict(sport="A3", hc="A24", asst="A42", rev="A52", exp="A55", cls="CLSCODE", name="INSTNM", city="CITY", state="STATE", unitid="UNITID"),
    "mid": dict(sport="A3", hc="A33", asst="A69", rev="A97", exp="A106", cls="ClassificationCode", name="institution_name", city="city_txt", state="state_cd", unitid="unitid"),
    "named": dict(sport="Sports", hc="MEN_TOTAL_HEADCOACH", asst="MEN_TOTAL_ASSTCOACH", rev="REV_MEN", exp="EXP_MEN", cls="ClassificationCode", name="institution_name", city="city_txt", state="state_cd", unitid="unitid"),
}


def _sport_member(names):
    """The sport-level file inside a year's zip."""
    pri = []
    for n in names:
        b = os.path.basename(n).lower()
        if b.endswith((".doc", ".docx", ".sav", ".pdf")):
            continue
        if "instlevel" in b or "institution--inst" in b or "instleveldata" in b:
            continue
        if not ("multiple" in b or "schools" in b or re.fullmatch(r"eada \d{4}-\d{4}\.xls", b)):
            continue
        score = 0 if b.endswith(".sas7bdat") else 1 if b.endswith(".xlsx") else 2
        pri.append((score, n))
    return sorted(pri)[0][1] if pri else None


def _read(path):
    import pandas as pd
    if path.endswith(".sas7bdat"):
        return pd.read_sas(path, encoding="latin1")
    x = pd.ExcelFile(path)
    # the data sheet: the one with the most columns (others are dictionaries)
    best = None
    for sh in x.sheet_names:
        if "dictionary" in sh.lower():
            continue
        d = x.parse(sh)
        if best is None or d.shape[1] > best.shape[1]:
            best = d
    return best


def _layout(cols):
    if "Sports" in cols or "EXP_MEN" in cols:
        return "named"
    if "A114" in cols:
        return "mid"
    return "old"


def extract(seasons=None):
    import pandas as pd
    for d in sorted(glob.glob(os.path.join(RAW, "*"))):
        s = os.path.basename(d)
        if seasons and s not in seasons:
            continue
        zp = os.path.join(d, "eada.zip")
        if not os.path.exists(zp):
            continue
        z = zipfile.ZipFile(zp)
        member = _sport_member(z.namelist())
        tmp = os.path.join(d, "x")
        os.makedirs(tmp, exist_ok=True)
        path = z.extract(member, tmp)
        df = _read(path)
        lay = _layout(set(df.columns))
        L = LAYOUTS[lay]
        missing = [v for k, v in L.items() if v not in df.columns]
        if missing:
            raise RuntimeError(f"{s}: layout {lay} lacks {missing}")
        sport = df[L["sport"]]
        if not pd.api.types.is_numeric_dtype(sport):
            sp = sport.astype(str).str.strip().str.lower()
            bb = sp == "basketball"
            how = "sport name 'Basketball'"
        else:
            bb = sport == SPORT_CODE_BASKETBALL
            how = f"sport code {SPORT_CODE_BASKETBALL}"
        b = df[bb]
        out = pd.DataFrame({
            "unitid": b[L["unitid"]].astype(int),
            "name": b[L["name"]].astype(str).str.strip(),
            "city": b[L["city"]].astype(str).str.strip(),
            "state": b[L["state"]].astype(str).str.strip(),
            "cls": pd.to_numeric(b[L["cls"]], errors="coerce"),
            "exp": pd.to_numeric(b[L["exp"]], errors="coerce"),
            "rev": pd.to_numeric(b[L["rev"]], errors="coerce"),
            "hc": pd.to_numeric(b[L["hc"]], errors="coerce"),
            "asst": pd.to_numeric(b[L["asst"]], errors="coerce"),
        })
        out.to_csv(os.path.join(d, "basketball.csv"), index=False)
        cols = dict(L, layout=lay, member=os.path.basename(member), basketball=how, rows=len(out), d1=int(out.cls.isin([1, 2, 3]).sum()))
        json.dump(cols, open(os.path.join(d, "columns.json"), "w"), indent=1)
        os.remove(path)
        log(f"{s}: {member} layout={lay} basketball rows {len(out)}, D1 {cols['d1']}")


# 2002-03 to 2007-08 code the sport as a number; the dictionaries' value labels give
# 2 = Basketball (2003-04 sheet: "1 Baseball, 2 Basketball, ..."); confirmed in extract() logs by
# Duke, Kentucky and Gonzaga having exactly one code-2 row each and a men's revenue in the millions.
SPORT_CODE_BASKETBALL = 2


# ---------------------------------------------------------------- matching
STOP = {"university", "of", "the", "college", "at", "and", "in", "main", "campus", "state", "&", "-", "saint", "st", "mount", "a", "institute"}
ABBR = {"st": "state", "univ": "university", "u": "university", "mt": "mount", "ft": "fort", "intl": "international", "so": "southern", "no": "northern"}


def norm(s):
    if not isinstance(s, str):
        return []
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("'", "")
    return [ABBR.get(w, w) for w in re.findall(r"[a-z0-9]+", s)]


def core(words):
    return {w for w in words if w not in STOP}


# ESPN's short names, spelled the way EADA names the institution. Applied before scoring; an exact
# (normalized) hit on an EADA name wins outright.
ALIAS = {
    "UCLA": "University of California-Los Angeles", "USC": "University of Southern California", "LSU": "Louisiana State University and Agricultural & Mechanical College",
    "UCF": "University of Central Florida", "VCU": "Virginia Commonwealth University", "VMI": "Virginia Military Institute",
    "UMBC": "University of Maryland-Baltimore County", "UNLV": "University of Nevada-Las Vegas", "BYU": "Brigham Young University",
    "SMU": "Southern Methodist University", "TCU": "Texas Christian University", "UTSA": "The University of Texas at San Antonio",
    "UTEP": "The University of Texas at El Paso", "UAB": "University of Alabama at Birmingham", "UIC": "University of Illinois Chicago",
    "NJIT": "New Jersey Institute of Technology", "UConn": "University of Connecticut", "Ole Miss": "University of Mississippi",
    "NC State": "North Carolina State University at Raleigh", "App State": "Appalachian State University", "Air Force": "United States Air Force Academy",
    "Navy": "United States Naval Academy", "Army": "United States Military Academy", "UAlbany": "SUNY at Albany", "Pitt": "University of Pittsburgh-Pittsburgh Campus",
    "Penn": "University of Pennsylvania", "Cal Poly": "California Polytechnic State University-San Luis Obispo", "Southern Miss": "University of Southern Mississippi",
    "UL Monroe": "University of Louisiana at Monroe", "SIU Edwardsville": "Southern Illinois University-Edwardsville", "UT Martin": "The University of Tennessee-Martin",
    "UT Arlington": "The University of Texas at Arlington", "UMass Lowell": "University of Massachusetts-Lowell", "UMass": "University of Massachusetts-Amherst",
    "Miami (OH)": "Miami University-Oxford", "Miami": "University of Miami", "Rutgers": "Rutgers University-New Brunswick", "Oklahoma": "University of Oklahoma-Norman Campus",
    "Penn State": "Pennsylvania State University-Main Campus", "Nevada": "University of Nevada-Reno", "California": "University of California-Berkeley",
    "South Carolina": "University of South Carolina-Columbia", "Washington": "University of Washington-Seattle Campus", "Wisconsin": "University of Wisconsin-Madison",
    "Hawai'i": "University of Hawaii at Manoa", "Indiana": "Indiana University-Bloomington", "Southern Illinois": "Southern Illinois University-Carbondale",
    "Southern": "Southern University and A & M College", "Florida": "University of Florida", "Idaho": "University of Idaho", "Rhode Island": "University of Rhode Island",
    "Georgia State": "Georgia State University", "Columbia": "Columbia University in the City of New York", "Fairleigh Dickinson": "Fairleigh Dickinson University-Metropolitan Campus",
    "Florida A&M": "Florida Agricultural and Mechanical University",
    "Virginia Tech": "Virginia Polytechnic Institute and State University", "Georgia Tech": "Georgia Institute of Technology-Main Campus",
    "Tennessee Tech": "Tennessee Technological University", "Charlotte": "University of North Carolina at Charlotte", "West Florida": "University of West Florida",
    "Massachusetts": "University of Massachusetts-Amherst", "Maryland": "University of Maryland-College Park", "Michigan": "University of Michigan-Ann Arbor",
    "North Carolina": "University of North Carolina at Chapel Hill", "Nebraska": "University of Nebraska-Lincoln", "Texas": "The University of Texas at Austin",
    "Louisiana": "University of Louisiana at Lafayette", "Illinois": "University of Illinois Urbana-Champaign", "Colorado": "University of Colorado Boulder", "St. Francis Brooklyn": "St. Francis College", "UC Santa Barbara": "University of California-Santa Barbara",
}


def expand(name, state=None):
    if name in ALIAS:
        return ALIAS[name]
    m = re.match(r"^UC (.+)$", name)
    if m:
        return "University of California-" + m.group(1)
    m = re.match(r"^Cal State (.+)$", name)
    if m:
        return "California State University-" + m.group(1)
    m = re.match(r"^UNC (.+)$", name)
    if m:
        return "University of North Carolina " + m.group(1)
    m = re.match(r"^UT (.+)$", name)
    if m:
        return ("The University of Texas at " if state == "TX" else "The University of Tennessee-") + m.group(1)
    return name


# Programs EADA does not cover, and why. The Equity in Athletics Disclosure Act applies to schools
# that take federal student aid (Title IV); the service academies do not, and file no report
# (Army appears only in 2003-04 and 2004-05).
NOT_COVERED = {"349": "Army: a service academy, outside the EADA (rows only for 2003-04 and 2004-05)",
               "2426": "Navy: a service academy, outside the EADA", "2005": "Air Force: a service academy, outside the EADA"}

# ESPN team id -> EADA UNITID(s), by hand, where neither the name nor the alias settles it (each with why).
HAND = {
    "2545": [160612],   # SE Louisiana = Southeastern Louisiana University; "SE" does not expand, and the fuzzy best was Louisiana Christian
    "85": [151111],     # IU Indianapolis = Indiana University-Purdue University-Indianapolis, renamed Indiana University-Indianapolis in 2024-25 (same UNITID)
    "2113": [158477],
    "213": [214777, 495767],  # Penn State: Pennsylvania State University-Main Campus, filed as "The Pennsylvania State University" (495767) for 2020-21 and 2021-22   # Centenary (LA) = Centenary College of Louisiana (D1 until 2010-11); no CBBD team row, so no state to narrow by
}


def programs():
    progs = {}
    for f in sorted(glob.glob(os.path.join(PUBLIC_TEAMS, "*.json.gz"))):
        s = os.path.basename(f)[:7]
        for t in json.loads(gzip.open(f).read())["teams"]:
            p = progs.setdefault(t["id"], dict(id=t["id"], seasons=[]))
            p.update(name=t["name"], full=t["full"])
            p["seasons"].append(s)
    try:
        for t in json.load(open(CBBD_TEAMS)):
            if t["sourceId"] in progs:
                progs[t["sourceId"]].update(state=t.get("currentState"), city=t.get("currentCity"), school=t.get("school"))
    except OSError:
        pass
    return progs


def load_years():
    import pandas as pd
    out = {}
    for d in sorted(glob.glob(os.path.join(RAW, "*"))):
        p = os.path.join(d, "basketball.csv")
        if os.path.exists(p):
            out[os.path.basename(d)] = pd.read_csv(p)
    return out


def candidates(years):
    """{unitid: {name, names, state, city, d1_years}} over every year."""
    inst = {}
    for s, df in years.items():
        for r in df.itertuples(index=False):
            c = inst.setdefault(int(r.unitid), dict(names=set(), state=r.state, city=r.city, d1=set(), seasons=set()))
            if isinstance(r.name, str):
                c["names"].add(r.name)
                c["name"] = r.name
            c["state"], c["city"] = r.state, r.city
            c["seasons"].add(s)
            if r.cls in (1, 2, 3):
                c["d1"].add(s)
    return inst


def _key(s):
    return " ".join(norm(s))


def score(p, c):
    best = 0.0
    keys = {expand(p["name"], p.get("state")), p.get("school") or p["name"]}
    for k in keys:
        a = core(norm(k))
        aw = norm(k)
        for n in c["names"]:
            if _key(n) == _key(k):
                return 2.0
            b = core(norm(n))
            bw = norm(n)
            if not a or not b:
                continue
            inter = len(a & b)
            v = inter / len(a | b)
            if a <= b:
                v = max(v, 0.6 + 0.4 * inter / len(b))
            # "state" carries meaning in pairs like Ohio vs Ohio State
            if ("state" in aw) != ("state" in bw):
                v -= 0.35
            best = max(best, v)
    return best


def match(progs, inst):
    """{team id: ([unitid, ...], how)}. A program can map to more than one UNITID over time (a
    re-registered institution); each season then uses the one that reported."""
    out, ambiguous, unmatched = {}, [], []
    for tid, p in sorted(progs.items()):
        if tid in HAND:
            out[tid] = (HAND[tid], "hand")
            continue
        st = p.get("state")
        if tid in NOT_COVERED:
            hit = [u for u, c in inst.items() if c["state"] == st and any(_key(n) == _key(expand(p["name"], st)) or "military academy" in _key(n) for n in c["names"])] if tid == "349" else []
            if hit:
                out[tid] = (hit, "name, partial years")
            continue
        pool = []
        for d1_only in (True, False):
            pool = [(score(p, c), u) for u, c in inst.items() if (not st or c["state"] == st) and (c["d1"] if d1_only else True)]
            pool.sort(reverse=True)
            if pool and pool[0][0] >= 0.6:
                break
        how = "name" if d1_only else "name (not D1 in EADA)"
        if not pool or pool[0][0] < 0.6:
            unmatched.append((tid, p["name"], st, [(round(v, 2), u, inst[u]["name"]) for v, u in pool[:3]]))
            continue
        top = [u for v, u in pool if v >= pool[0][0] - 0.05]
        if len(top) > 1:
            # the same institution under two UNITIDs in different years is not ambiguous
            yrs = [inst[u]["seasons"] for u in top]
            if all(not (yrs[i] & yrs[j]) for i in range(len(top)) for j in range(i + 1, len(top))):
                out[tid] = (top, how + ", several UNITIDs")
                continue
            ambiguous.append((tid, p["name"], st, [(round(v, 2), u, inst[u]["name"]) for v, u in pool[:3]]))
            continue
        out[tid] = ([pool[0][1]], how if pool[0][0] >= 2 else how + f", fuzzy {pool[0][0]:.2f}")
    return out, ambiguous, unmatched


def build():
    years = load_years()
    progs = programs()
    inst = candidates(years)
    m, amb, un = match(progs, inst)
    log(f"programs {len(progs)}; matched {len(m)}; ambiguous {len(amb)}; unmatched {len(un)}")
    for a in amb:
        log(f"  AMBIGUOUS {a}")
    for a in un:
        log(f"  UNMATCHED {a}")
    seen = {}
    dup = []
    for tid, (us, how) in m.items():
        for u in us:
            if u in seen:
                dup.append((u, seen[u], tid))
            seen[u] = tid
    for d in dup:
        log(f"  DUPLICATE UNITID {d}")
    seasons = {}
    for s, df in years.items():
        by = {int(r.unitid): r for r in df.itertuples(index=False)}
        rows = {}
        for tid, (us, how) in m.items():
            hit = [by[u] for u in us if u in by]
            if not hit:
                continue
            r = hit[0]
            u = int(r.unitid)
            f = lambda v: None if v != v else int(round(v))  # noqa: E731
            rows[tid] = dict(exp=f(r.exp), rev=f(r.rev), hc=f(r.hc), asst=f(r.asst), unitid=u, d1=bool(r.cls in (1, 2, 3)), site=s in progs[tid]["seasons"])
        seasons[s] = rows
    cols = {s: json.load(open(os.path.join(RAW, s, "columns.json"))) for s in years}
    src = {s: json.load(open(os.path.join(RAW, s, "source.json")))["url"] for s in years if os.path.exists(os.path.join(RAW, s, "source.json"))}
    # programs in a season of ours with no EADA row that season
    missing = {}
    for s in seasons:
        miss = [t for t, p in progs.items() if s in p["seasons"] and t not in seasons[s]]
        if miss:
            missing[s] = miss
    doc = dict(seasons=seasons, columns=cols, crosswalk={t: dict(unitid=us, how=h, eada_name=[inst[u]["name"] for u in us], espn=progs[t]["full"]) for t, (us, h) in m.items()},
               unmatched=[dict(id=t, name=n, state=st, best=b) for t, n, st, b in un + amb], not_covered=NOT_COVERED, duplicates=dup, missing_by_season=missing,
               source=dict(site="https://ope.ed.gov/athletics/", file_list=API + "fileList", files=src),
               note="Men's basketball team expenses and revenues (EXP_MEN, REV_MEN), U.S. Department of Education, Equity in Athletics. Reporting year July 1 to June 30 = the season. Misses NIL and collective money (a weaker read from 2021-22).")
    json.dump(doc, open(os.path.join(HOME, "eada.json"), "w"), indent=0)
    return doc, progs


def sanity(doc, progs, s=None):
    s = s or max(doc["seasons"])
    rows = [(v["exp"], t) for t, v in doc["seasons"][s].items() if v["exp"] and t in progs and s in progs[t]["seasons"]]
    rows.sort()
    import statistics
    log(f"{s}: {len(rows)} D1 programs with expenses; median ${statistics.median(v for v, _ in rows):,.0f}")
    log("  top 5: " + "; ".join(f"{progs[t]['name']} ${v:,.0f}" for v, t in rows[::-1][:5]))
    log("  bottom 5: " + "; ".join(f"{progs[t]['name']} ${v:,.0f}" for v, t in rows[:5]))
    rank = {t: i for i, (_, t) in enumerate(rows[::-1], 1)}
    for want in ("Duke", "Kentucky", "Gonzaga", "Mississippi Valley State", "Chicago State"):
        for t, p in progs.items():
            if p["name"] == want and t in doc["seasons"][s]:
                v = doc["seasons"][s][t]
                log(f"  {want}: exp ${v['exp']:,.0f}, rev ${v['rev']:,.0f}, head {v['hc']}, assistants {v['asst']}, rank {rank.get(t)} of {len(rows)}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "download":
        download()
    elif cmd == "extract":
        extract(sys.argv[2:] or None)
    elif cmd == "build":
        d, p = build()
        sanity(d, p)
