"""
registry.py — who the coaches are, and who coached each game.

    python3 registry.py            # -> out/bcs/registry.json

Three joins, in this order:
  1. Basketball-Reference (br_coaches.py): every coach since 1946-47 with his head-coaching
     records by season and team, assistant stints, awards, Coach of the Year voting, hire and
     fire dates, and bio. The coach's id everywhere here is his Basketball-Reference slug.
  2. The schedule, 1996-97 on (LeagueGameLog, regular season and playoffs, from the engine's
     cache): one head coach per team-game. A team-season with one head coach is his. With
     two or more, the games are split where the running record first equals the first man's
     Basketball-Reference record (a 20-30 followed by a 14-22 pins the boundary exactly);
     the men are ordered by Basketball-Reference's hire/fire dates, then the team page's own
     "Coach:" line, then by who was there the season before. A split that cannot be pinned
     falls back to the dates and is marked unconfirmed for the review list.
  3. HC_FIXES, hand-entered and sourced: acting coaches the record books credit to the man
     who was absent (Luke Walton's 39-4 in 2015-16 is Steve Kerr's on Basketball-Reference).
     These override the split for the dated games; the absent coach keeps his own page and
     the acting coach gets those games on his.
  4. The NBA's staff tables (CommonTeamRoster -> Coaches, from the engine's cache) merged
     with Basketball-Reference's assistant stints by normalized name, each row tagged with
     the source(s) that have it. Basketball-Reference warns its assistant records may be
     incomplete; the NBA's begin in the 2000s (staff_depth.json, written by nba_pulls.py).
"""
import datetime as dt
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import teams as TM  # noqa: E402

OUT = os.environ.get("BCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/bcs")
SAVANT = os.environ.get("BCS_SAVANT") or os.path.expanduser("~/Basketball-Savant")
FIRST_GAME_SEASON = 1996

# Acting coaches: (season, franchise, first date, last date, acting coach slug, credited coach slug, note, source[, confirmed])
# Every team game in the window goes to the acting coach. The optional ninth field is False where the
# window is reported but a handover inside it is not pinned game by game (those rows are also in
# HC_UNCONFIRMED for the review list). Game counts were checked against the schedule on 2026-10-27.
HC_FIXES = [
    ("2015-16", "GSW", "2015-10-27", "2016-01-20", "waltolu01c", "kerrst01c",
     "Luke Walton coached the first 43 games (39-4) while Steve Kerr recovered from back surgery; the NBA credits the wins to Kerr. Kerr returned on January 22, 2016.",
     "https://www.nba.com/warriors/news/kerr-return-20160122"),
    ("2016-17", "GSW", "2017-04-22", "2017-05-22", "brownmi99c", "kerrst01c",
     "Mike Brown coached the Warriors from Game 3 of the first round through the conference finals (11-0) while Kerr was out; Kerr returned for Game 2 of the Finals.",
     "https://www.espn.com/nba/story/_/id/19527060"),
    ("2017-18", "SAS", "2018-04-19", "2018-04-22", "messiet99c", "popovgr99c",
     "Ettore Messina coached Games 3 and 4 of the first round against Golden State after the death of Erin Popovich.",
     "https://www.espn.com/nba/story/_/id/23228686"),
    ("2017-18", "CLE", "2018-03-19", "2018-04-03", "drewla01c", "luety01c",
     "Larry Drew coached nine games (8-1) during Tyronn Lue's medical leave; Basketball-Reference notes it on Drew's page and credits the games to Lue.",
     "https://www.basketball-reference.com/coaches/drewla01c.html"),
    ("2020-21", "DAL", "2021-04-02", "2021-04-02", "mosleja01c", "carliri01c",
     "Jamahl Mosley coached the April 2, 2021 game at New York after Rick Carlisle tested positive for COVID-19.",
     "https://www.nba.com/news/mavs-coach-rick-carlisle-tests-positive-for-covid-19-out-vs-knicks"),
    ("2021-22", "ATL", "2021-12-01", "2021-12-01", "jentch01c", "mcmilna01c",
     "Chris Jent coached the December 1, 2021 game at Indiana with Nate McMillan out.",
     "https://ajc.com/sports/atlanta-hawks/hawks-escape-with-win-vs-pacers/2SVH7NYEJJB6XHJO3JKP3AJ77Y"),
    ("2021-22", "IND", "2021-12-10", "2021-12-18", "piercll01c", "carliri01c",
     "Lloyd Pierce coached four games (2-2) while Rick Carlisle was in health and safety protocols; Carlisle returned December 19.",
     "https://www.cbssports.com/nba/news/pacers-coach-rick-carlisle-enters-health-and-safety-protocols-will-miss-multiple-games"),
    ("2021-22", "SAC", "2021-12-15", "2021-12-24", "chrisdo01c", "gentral99c",
     "Doug Christie coached five games (2-3) while Alvin Gentry was in health and safety protocols; Gentry returned December 26 against Memphis.",
     "https://hoopsrumors.com/2021/12/alvin-gentry-clears-covid-19-protocols-could-return-sunday.html"),
    ("2021-22", "DET", "2021-12-16", "2021-12-16", "kalamre99c", "caseydw99c",
     "Rex Kalamian coached the December 16, 2021 game at Indiana while Dwane Casey was out for personal reasons.",
     "https://www.nba.com/news/pistons-coach-dwane-casey-out-vs-pacers-due-to-personal-reasons"),
    ("2021-22", "LAL", "2021-12-19", "2021-12-30", "fizdada01c", "vogelfr99c",
     "David Fizdale coached six games (1-5) while Frank Vogel was in health and safety protocols; Vogel returned December 31 against Portland.",
     "https://www.silverscreenandroll.com/2021/12/31/22860027/frank-vogel-cleared-health-safety-protocols-lakers-covid-return-date-david-fizdale"),
    ("2021-22", "CHI", "2021-12-26", "2022-01-01", "flemich99c", "donovbi99c",
     "Chris Fleming coached five games (5-0) while Billy Donovan was in health and safety protocols; Donovan returned January 3 against Orlando.",
     "https://dailyherald.com/?p=49970"),
    ("2021-22", "POR", "2021-12-27", "2022-01-02", "brooksc01c", "billuch01c",
     "Scott Brooks coached three games (0-3) while Chauncey Billups was in health and safety protocols; Billups returned January 3 against Atlanta.",
     "https://www.blazersedge.com/2022/1/2/22863684/portland-trail-blazers-chauncey-billups-clears-health-safety-protocols-covid"),
    ("2021-22", "PHX", "2021-12-27", "2022-01-03", "youngke99c", "willimo01c",
     "Kevin Young coached four games (2-2) while Monty Williams was in health and safety protocols; Williams returned January 4 against New Orleans.",
     "https://arizonasports.com/nba/phoenix-suns/phoenix-suns-coach-monty-williams-reportedly-clears-covid-19-protocols"),
    ("2021-22", "OKC", "2021-12-28", "2021-12-30", "wilksmi99c", "daignma99c",
     "Mike Wilks coached two games (December 28 against Sacramento and December 29 at Phoenix, 0-2) while Mark Daigneault was in health and safety protocols; Daigneault returned December 31 at Minnesota.",
     "https://www.nba.com/news/five-nba-coaches-among-latest-entering-health-and-safety-protocols"),
    ("2021-22", "PHI", "2021-12-30", "2022-01-04", "burkeda99c", "riverdo01c",
     "Dan Burke coached two games (2-0) while Doc Rivers was in health and safety protocols; Rivers returned January 5 against Orlando.",
     "https://inquirer.com/sixers/sixers-doc-rivers-clears-covid-19-protocols-76ers-20220105.html"),
    ("2021-22", "DEN", "2021-12-30", "2022-01-08", "jonespo99c", "malonmi99c",
     "Popeye Jones coached four games (2-2) while Michael Malone was in health and safety protocols from December 30. David Adelman was named first but entered protocols himself before the January 1 game at Houston. Malone returned January 9 at Oklahoma City.",
     "https://www.denvergazette.com/?p=497515"),
    ("2021-22", "LAC", "2021-12-31", "2022-01-04", "shawbr01c", "luety01c",
     "Brian Shaw coached three games (December 31 in Toronto through January 3) while Tyronn Lue was in health and safety protocols; Lue cleared on January 5 after Canada's quarantine and was back for January 6.",
     "https://www.clipsnation.com/2022/1/5/22869564/la-clippers-news-tyronn-lue-clears-health-and-safetly-protocols-missed-games-streak"),
    ("2021-22", "ATL", "2022-01-02", "2022-01-08", "pruntjo01c", "mcmilna01c",
     "Joe Prunty coached three games while Nate McMillan was in health and safety protocols from January 1; Chris Jent is reported to have taken over from the January 9 game against the Clippers. The handover is not pinned game by game.",
     "https://www.espn.com/nba/story/_/id/32974520", False),
    ("2021-22", "ATL", "2022-01-09", "2022-01-11", "jentch01c", "mcmilna01c",
     "Chris Jent coached the January 9 game against the Clippers in McMillan's absence; McMillan returned January 12 against Miami. The Prunty/Jent handover is not pinned game by game.",
     "https://hoopsrumors.com/2022/01/covid-19-updates-malone-budenholzer-hawks-holiday-marjanovic-vincent-nader.html", False),
    ("2021-22", "MIL", "2022-01-05", "2022-01-12", "hamda01c", "budenmi99c",
     "Darvin Ham coached four games while Mike Budenholzer was in health and safety protocols; Budenholzer returned January 13 against Golden State.",
     "https://africa.espn.com/nba/story/_/id/33060120/milwaukee-bucks-mike-budenholzer-returns-four-game-absence-clearing-protocol"),
    ("2021-22", "DAL", "2022-01-07", "2022-01-14", "sweense01c", "kiddja01c",
     "Sean Sweeney coached four games (3-1) while Jason Kidd was in health and safety protocols; Kidd returned January 15 against Orlando.",
     "https://www.espn.com/nba/story/_/id/33072002/dallas-mavericks-get-kristaps-porzingis-coach-jason-kidd-back-health-safety-protocols"),
    ("2021-22", "MEM", "2022-01-08", "2022-01-10", "jonesbr99c", "jenkita01c",
     "Brad Jones coached the first two games of Taylor Jenkins's stay in health and safety protocols (from January 8); Darko Rajakovic is reported to have taken over from January 11. The handover is not pinned game by game.",
     "https://www.espn.com/nba/story/_/id/33019765/memphis-grizzlies-coach-taylor-jenkins-placed-health-safety-protocols", False),
    ("2021-22", "MEM", "2022-01-11", "2022-01-18", "rajakda01c", "jenkita01c",
     "Darko Rajakovic coached the rest of Taylor Jenkins's absence (Memphis went 5-1 over the six games); Jenkins returned January 19 at Milwaukee. The Jones/Rajakovic handover is not pinned game by game.",
     "https://dailymemphian.com/article/26595/taylor-jenkins-returns-health-safety-protocols-grizzlies-bucks", False),
    ("2021-22", "DET", "2022-01-10", "2022-01-10", "kalamre99c", "caseydw99c",
     "Rex Kalamian coached the January 10, 2022 game against Utah while Dwane Casey was in health and safety protocols.",
     "https://clickondetroit.com/sports/2022/01/10/detroit-pistons-coach-dwane-casey-enters-nbas-health-and-safety-protocols"),
    ("2021-22", "WAS", "2022-01-15", "2022-01-15", "delanpa99c", "unselwe02c",
     "Pat Delany coached the January 15, 2022 game while Wes Unseld Jr. was in health and safety protocols.",
     "https://www.nba.com/news/wes-unseld-enters-health-and-safety-protocols"),
    ("2021-22", "WAS", "2022-01-17", "2022-01-21", "blairjo99c", "unselwe02c",
     "Joseph Blair coached three games after Pat Delany also entered health and safety protocols; Unseld returned January 23 against Boston.",
     "https://sportsnaut.com/wizards-forced-to-use-3rd-acting-head-coach"),
    ("2021-22", "ORL", "2022-01-17", "2022-01-20", "mermuje99c", "mosleja01c",
     "Jesse Mermuys coached two games (Portland and Philadelphia) while Jamahl Mosley was in health and safety protocols; Mosley returned January 21.",
     "https://clickorlando.com/news/local/2022/01/21/magic-head-coach-jamahl-mosley-assistant-coach-nate-tibbetts-clear-covid-protocol"),
    ("2021-22", "UTA", "2022-01-30", "2022-02-05", "jenseal99c", "snydequ01c",
     "Alex Jensen coached three games (2-1) while Quin Snyder was in health and safety protocols.",
     "https://africa.espn.com/nba/story/_/id/33182106/utah-jazz-coach-quin-snyder-enters-covid-19-protocols"),
    ("2021-22", "BKN", "2022-02-28", "2022-03-05", "vaughja01c", "nashst01c",
     "Jacque Vaughn coached three games (0-3) while Steve Nash was in health and safety protocols; Nash returned March 6 against Boston.",
     "https://www.sny.tv/articles/steve-nash-clears-protocols-will-return-sunday-against-celtics"),
    ("2022-23", "DEN", "2023-01-17", "2023-01-18", "adelmda01c", "malonmi99c",
     "David Adelman coached January 17 against Portland and January 18 against Minnesota while Michael Malone was in health and safety protocols.",
     "https://www.blazersedge.com/2023/1/17/23559856"),
    ("2023-24", "GSW", "2024-02-12", "2024-02-12", "atkinke01c", "kerrst01c",
     "Kenny Atkinson coached the February 12, 2024 game at Utah while Steve Kerr attended Dejan Milojevic's funeral in Serbia.",
     "https://www.cbssports.com/nba/news/warriors-steve-kerr-attends-dejan-milojevics-funeral-in-serbia-kenny-atkinson-to-coach-vs-jazz-on-monday"),
]
# Unconfirmed: known acting stints not entered because the exact dates were not pinned down
# on this build. Listed for the review list, not applied.
HC_UNCONFIRMED = [
    # Applied in HC_FIXES, with a detail still to confirm (the rows carry confirmed=False)
    ("2021-22", "ATL", "Prunty then Jent for McMillan, Jan 2-11, 2022: the handover before the Jan 9 game is reported, not pinned game by game"),
    ("2021-22", "MEM", "Brad Jones then Rajakovic for Jenkins, Jan 8-18, 2022: the handover before the Jan 11 game is reported, not pinned game by game"),
]


def norm(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.,'`’\-]", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


# ------------------------------------------------------------------ Basketball-Reference
def load_br():
    return json.load(open(os.path.join(OUT, "br_coaches.json")))


# Acting coaches with no Basketball-Reference coach page of their own (never a head coach of record)
STUBS = {
    "messiet99c": dict(name="Ettore Messina", born="1959-09-30", birthplace="Catania, Italy", college=None, played=False,
                       note="No Basketball-Reference coach page: a career head coach in Europe (Virtus Bologna, CSKA Moscow, Real Madrid), an NBA assistant with the Lakers and Spurs. Source: FIBA / Euroleague records."),
    # The 2021-22 Omicron wave's acting coaches who were never a head coach of record. Birth data is left
    # blank rather than typed from memory; the staff tables carry their NBA ids.
    "flemich99c": dict(name="Chris Fleming", played=None, note="No Basketball-Reference coach page: a Bulls assistant, acting head coach for five games in December 2021."),
    "jonespo99c": dict(name="Popeye Jones", played=True, note="No Basketball-Reference coach page: a Nuggets assistant (and an eleven-season NBA forward), acting head coach for four games in January 2022."),
    "youngke99c": dict(name="Kevin Young", played=None, note="No Basketball-Reference coach page: a Suns assistant, acting head coach for four games in December 2021 and January 2022."),
    "wilksmi99c": dict(name="Mike Wilks", played=True, note="No Basketball-Reference coach page: a Thunder assistant (and an NBA guard, 2002-09), acting head coach for two games in December 2021."),
    "burkeda99c": dict(name="Dan Burke", played=None, note="No Basketball-Reference coach page: a 76ers assistant, acting head coach for two games in December 2021 and January 2022."),
    "jonesbr99c": dict(name="Brad Jones", played=None, note="No Basketball-Reference coach page: a Grizzlies assistant, acting head coach for two games in January 2022."),
    "kalamre99c": dict(name="Rex Kalamian", played=None, note="No Basketball-Reference coach page: a Pistons assistant, acting head coach for two games in 2021-22."),
    "delanpa99c": dict(name="Pat Delany", played=None, note="No Basketball-Reference coach page: a Wizards assistant, acting head coach for one game in January 2022."),
    "blairjo99c": dict(name="Joseph Blair", played=None, note="No Basketball-Reference coach page: a Wizards assistant, acting head coach for three games in January 2022."),
    "mermuje99c": dict(name="Jesse Mermuys", played=None, note="No Basketball-Reference coach page: a Magic assistant, acting head coach for two games in January 2022."),
    "jenseal99c": dict(name="Alex Jensen", played=None, note="No Basketball-Reference coach page: a Jazz assistant, acting head coach for three games in January and February 2022."),
}


def coach_rows(br):
    """{slug: coach dict with hc (head-coach seasons) and ast (assistant stints) lists}"""
    out = {}
    for slug, st in STUBS.items():
        out[slug] = dict(id=slug, name=st["name"], born=st.get("born"), birthplace=st.get("birthplace"), died=None, college=st.get("college"), high_school=None,
                         played=st.get("played"), player_href=None, player_games=None, hof=False, awards=[], voting=[], transactions=[], hc=[], ast=[], stub=True, note=st.get("note"))
    for c in br["coaches"]:
        hc, ast = [], []
        for r in c["rows"]:
            year = int(r["season"][:4])
            key = TM.br_franchise(r["team"], year) if r["lg"] == "NBA" else None
            row = dict(r, year=year, franchise=key)
            if r["role"] == "Head Coach" and r["g"] is not None:
                hc.append(row)
            else:
                ast.append(row)
        out[c["slug"]] = dict(
            id=c["slug"], name=c["name"] or c["index"]["name"], born=c.get("born"), birthplace=c.get("birthplace"),
            died=c.get("died"), college=c.get("college"), high_school=c.get("high_school"),
            played=c.get("played"), player_href=c.get("player_href"), player_games=c.get("player_games"),
            hof=bool(c.get("hof") or c["index"].get("hof")), awards=c["awards"], voting=c["voting"],
            transactions=c["transactions"], hc=sorted(hc, key=lambda r: (r["season"], r["team"])), ast=ast,
        )
    return out


def _tx_dates(coach, franchise, year):
    """Hire / fire dates that touch this franchise around this season, from the transactions."""
    hired = fired = None
    for date, text in coach["transactions"]:
        if not date:
            continue
        t = text.lower()
        tkey = None
        for key in TM.NAMES:
            if TM.name(key, year).lower() in t or TM.NAMES[key].lower() in t:
                tkey = key
                break
        for old, nm in TM.OLD_NAMES.items():
            if nm.lower() in t:
                tkey = TM.franchise(old)
        if "bobcats" in t:
            tkey = "CHA"
        if "bullets" in t:
            tkey = "WAS"
        if tkey != franchise:
            continue
        y = int(date[:4]) + (1 if int(date[5:7]) >= 7 else 0)   # the season a date belongs to, as an end year
        if y not in (year + 1, year + 2) and not (y == year + 1):
            continue
        if ("hired" in t or "appointed" in t or "named" in t or "promoted" in t) and "head coach" in t and hired is None:
            hired = date
        if any(w in t for w in ("fired", "resign", "reassigned", "retired", "left", "relieved", "steps down", "stepped down")):
            if fired is None or date > fired:
                fired = date
    return hired, fired


# ------------------------------------------------------------------ the schedule
def game_logs():
    """{season: [team-game rows]} 1996-97 on, regular season and playoffs, from the engine's cache."""
    import pandas as pd
    import savant_engine as E
    out = {}
    y = FIRST_GAME_SEASON
    today = dt.date.today()
    last = today.year if today.month >= 10 else today.year - 1
    for year in range(FIRST_GAME_SEASON, last + 1):
        s = season_label(year)
        rows = []
        for st, tag in (("Regular Season", "RS"), ("Playoffs", "PO")):
            key = E._key("LeagueGameLog", dict(season=s, season_type_all_star=st, player_or_team_abbreviation="T"), 0)
            p = os.path.join(SAVANT, "cache", key + ".json")
            if not os.path.exists(p):
                continue
            df = pd.read_json(p)
            for r in df.itertuples(index=False):
                fr = TM.FRANCHISES.get(int(r.TEAM_ID)) or TM.franchise(r.TEAM_ABBREVIATION)
                m = str(r.MATCHUP)
                home = "vs." in m
                opp_ab = m.split(" ")[-1]
                rows.append(dict(gid=str(r.GAME_ID).zfill(10), date=str(r.GAME_DATE)[:10], team=fr, abbr=str(r.TEAM_ABBREVIATION),
                                 opp=TM.franchise(opp_ab), home=home, wl=str(r.WL), pts=int(r.PTS), type=tag,
                                 pm=int(r.PLUS_MINUS) if r.PLUS_MINUS == r.PLUS_MINUS else None))
        if rows:
            # the NBA logs a few All-Star-week exhibition rows in old seasons with non-team ids; keep real franchises
            rows = [r for r in rows if r["team"] and r["opp"]]
            rows.sort(key=lambda r: (r["date"], r["gid"]))
            out[s] = rows
    return out


def assign_head_coaches(coaches, logs, log=print):
    """{season: {gid: {franchise: slug}}} plus the per-coach-team-season game lists and checks."""
    by_ts = defaultdict(list)                  # (season, franchise) -> [(slug, row)]
    for slug, c in coaches.items():
        for r in c["hc"]:
            if r["franchise"] and r["year"] >= FIRST_GAME_SEASON:
                by_ts[(r["season"], r["franchise"])].append((slug, r))
    assign = defaultdict(lambda: defaultdict(dict))   # season -> gid -> {franchise: slug}
    tenures = []                               # one row per coach-team-season stretch of games
    issues = []
    br_team_orders = load_br().get("team_orders", {})
    for season, rows in logs.items():
        year = int(season[:4])
        by_team = defaultdict(list)
        for r in rows:
            by_team[r["team"]].append(r)
        for fr, games in by_team.items():
            rs = [g for g in games if g["type"] == "RS"]
            po = [g for g in games if g["type"] == "PO"]
            cands = by_ts.get((season, fr), [])
            if not cands:
                issues.append(dict(kind="no_coach", season=season, team=fr, games=len(games)))
                continue
            if len(cands) == 1:
                slug, r = cands[0]
                for g in games:
                    assign[season][g["gid"]][fr] = slug
                w = sum(1 for g in rs if g["wl"] == "W"); l = sum(1 for g in rs if g["wl"] == "L")
                ok = (w, l) == (r["w"], r["l"])
                if not ok:
                    issues.append(dict(kind="record_mismatch", season=season, team=fr, coach=slug, ours=[w, l], br=[r["w"], r["l"]]))
                tenures.append(dict(season=season, team=fr, coach=slug, first=rs[0]["date"] if rs else games[0]["date"], last=rs[-1]["date"] if rs else games[-1]["date"],
                                    g=len(rs), w=w, l=l, pg=len(po), pw=sum(1 for g in po if g["wl"] == "W"), pl=sum(1 for g in po if g["wl"] == "L"),
                                    confirmed=ok, order=0))
                continue
            # several men: order them
            order_key = {}
            page = br_team_orders.get(f"{TM.br_abbr(fr, year)}-{year + 1}") or []
            page_slugs = [x["slug"] for x in page]
            prev = {s for (s, f), v in by_ts.items() if f == fr and s == season_label(year - 1) for _ in v}
            for slug, r in cands:
                hired, fired = _tx_dates(coaches[slug], fr, year)
                k = []
                if slug in page_slugs:
                    k.append(page_slugs.index(slug))
                else:
                    k.append(99)
                k.append(hired or ("0000" if any(sl == slug for sl, _ in [(x[0], None) for x in by_ts.get((season_label(year - 1), fr), [])]) else "9999"))
                order_key[slug] = tuple(k)
            cands.sort(key=lambda x: order_key[x[0]])
            # split the regular season where the running record equals each man's
            i = 0
            confirmed_all = True
            for n, (slug, r) in enumerate(cands):
                need_w, need_l = r["w"], r["l"]
                w = l = 0
                j = i
                found = None
                while j < len(rs):
                    if rs[j]["wl"] == "W":
                        w += 1
                    elif rs[j]["wl"] == "L":
                        l += 1
                    j += 1
                    if (w, l) == (need_w, need_l):
                        found = j
                        # if the very next game would still keep the record (impossible) we stop at the first match
                        break
                if found is None or (n == len(cands) - 1 and found != len(rs)):
                    confirmed_all = False
                    # fall back: proportional to his games
                    found = min(len(rs), i + (r["g"] or 0))
                    issues.append(dict(kind="split_unpinned", season=season, team=fr, coach=slug, br=[need_w, need_l], order=[c[0] for c in cands]))
                mine = rs[i:found]
                for g in mine:
                    assign[season][g["gid"]][fr] = slug
                tenures.append(dict(season=season, team=fr, coach=slug, first=mine[0]["date"] if mine else None, last=mine[-1]["date"] if mine else None,
                                    g=len(mine), w=sum(1 for g in mine if g["wl"] == "W"), l=sum(1 for g in mine if g["wl"] == "L"),
                                    pg=0, pw=0, pl=0, confirmed=found is not None and confirmed_all, order=n))
                i = found
            # playoffs go to the man coaching at the end of the regular season (BR's playoff row says who)
            po_slug = next((slug for slug, r in cands if r.get("pg")), cands[-1][0])
            for g in po:
                assign[season][g["gid"]][fr] = po_slug
            for t in tenures:
                if t["season"] == season and t["team"] == fr and t["coach"] == po_slug:
                    t["pg"] = len(po); t["pw"] = sum(1 for g in po if g["wl"] == "W"); t["pl"] = sum(1 for g in po if g["wl"] == "L")
        # acting coaches
        for fx in HC_FIXES:
            fs, fr, d0, d1, acting, credited, note, src = fx[:8]
            pinned = fx[8] if len(fx) > 8 else True
            if fs != season:
                continue
            n = 0
            for g in by_team.get(fr, []):
                if d0 <= g["date"] <= d1 and assign[season].get(g["gid"], {}).get(fr) == credited:
                    assign[season][g["gid"]][fr] = acting
                    n += 1
            tenures.append(dict(season=season, team=fr, coach=acting, first=d0, last=d1, g=n, acting_for=credited, note=note, source=src, confirmed=pinned,
                                w=sum(1 for g in by_team.get(fr, []) if d0 <= g["date"] <= d1 and g["type"] == "RS" and g["wl"] == "W"),
                                l=sum(1 for g in by_team.get(fr, []) if d0 <= g["date"] <= d1 and g["type"] == "RS" and g["wl"] == "L"),
                                pg=sum(1 for g in by_team.get(fr, []) if d0 <= g["date"] <= d1 and g["type"] == "PO"), pw=0, pl=0, order=-1))
    tenures = tenures_from(assign, logs, tenures)
    return assign, tenures, issues


def tenures_from(assign, logs, built):
    """One row per coach-team-season stretch from the final game assignment (acting stints applied)."""
    meta = {(t["season"], t["team"], t["coach"]): t for t in built}
    acc = {}
    for season, rows in logs.items():
        by_gid = {r["gid"]: None for r in rows}
        for r in rows:
            slug = assign.get(season, {}).get(r["gid"], {}).get(r["team"])
            if not slug:
                continue
            k = (season, r["team"], slug)
            a = acc.setdefault(k, dict(season=season, team=r["team"], coach=slug, first=r["date"], last=r["date"], g=0, w=0, l=0, pg=0, pw=0, pl=0))
            a["first"], a["last"] = min(a["first"], r["date"]), max(a["last"], r["date"])
            if r["type"] == "RS":
                a["g"] += 1; a["w"] += r["wl"] == "W"; a["l"] += r["wl"] == "L"
            else:
                a["pg"] += 1; a["pw"] += r["wl"] == "W"; a["pl"] += r["wl"] == "L"
    out = []
    for k, a in acc.items():
        m = meta.get(k, {})
        a.update(confirmed=m.get("confirmed", True), order=m.get("order", 0), acting_for=m.get("acting_for"), note=m.get("note"), source=m.get("source"))
        out.append(a)
    out.sort(key=lambda a: (a["season"], a["team"], a["first"]))
    return out


# ------------------------------------------------------------------ staff
def nba_staff(seasons):
    """{season: {franchise: [{name, role, head}]}} from CommonTeamRoster's Coaches table (engine cache)."""
    import pandas as pd
    import savant_engine as E
    out = defaultdict(dict)
    for s in seasons:
        for tid, fr in TM.FRANCHISES.items():
            key = E._key("CommonTeamRoster", dict(team_id=tid, season=s), 1)
            p = os.path.join(SAVANT, "cache", key + ".json")
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
                ct = str(r.COACH_TYPE)
                if ct not in ("Head Coach", "Assistant Coach"):
                    continue                        # trainers, strength staff, video
                rows.append(dict(name=str(r.COACH_NAME), role=ct, head=ct == "Head Coach", nba_id=int(r.COACH_ID) if str(r.COACH_ID).isdigit() else None))
            if any(x["head"] for x in rows):
                out[s][fr] = rows
    return out


def build_staff(coaches, nba, seasons):
    """Per team-season: the staff from both sources, merged by name."""
    by_name = defaultdict(list)
    for slug, c in coaches.items():
        by_name[norm(c["name"])].append(slug)
    staff = defaultdict(dict)
    for slug, c in coaches.items():
        for r in c["ast"]:
            if r["lg"] != "NBA" or not r["franchise"]:
                continue
            staff[r["season"]].setdefault(r["franchise"], {})
            staff[r["season"]][r["franchise"]][norm(c["name"])] = dict(name=c["name"], id=slug, role=r["role"], src=["br"])
    for s, teams_ in nba.items():
        for fr, rows in teams_.items():
            d = staff[s].setdefault(fr, {})
            for r in rows:
                if r["head"]:
                    continue
                k = norm(r["name"])
                if k in d:
                    d[k]["src"].append("nba")
                    d[k]["nba_id"] = r["nba_id"]
                else:
                    slugs = by_name.get(k, [])
                    d[k] = dict(name=r["name"], id=slugs[0] if len(slugs) == 1 else None, role=r["role"], src=["nba"], nba_id=r["nba_id"])
    return {s: {fr: sorted(v.values(), key=lambda x: x["name"]) for fr, v in t.items()} for s, t in staff.items()}


def main(log=print):
    br = load_br()
    coaches = coach_rows(br)
    logs = game_logs()
    log(f"{len(coaches)} coaches on Basketball-Reference; schedule {min(logs)}..{max(logs)} ({sum(len(v) for v in logs.values())} team-games)")
    assign, tenures, issues = assign_head_coaches(coaches, logs)
    seasons = sorted(logs)
    nba = nba_staff(seasons)
    staff = build_staff(coaches, nba, seasons)
    # head coach per team-season from the NBA table, as a cross-check on the BR assignment
    cross = []
    for s, teams_ in nba.items():
        for fr, rows in teams_.items():
            heads = [norm(r["name"]) for r in rows if r["head"]]
            ours = {coaches[sl]["name"] for g, m in assign.get(s, {}).items() for f, sl in m.items() if f == fr}
            if heads and not any(norm(o) == h for o in ours for h in heads):
                cross.append(dict(season=s, team=fr, nba=[r["name"] for r in rows if r["head"]], ours=sorted(ours)))
    kinds = defaultdict(int)
    for i in issues:
        kinds[i["kind"]] += 1
    log(f"head coach per game: {sum(len(v) for v in assign.values())} games assigned; issues {dict(kinds)}; NBA-table disagreements {len(cross)}")
    out = dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
               coaches=coaches, assign={s: dict(v) for s, v in assign.items()}, tenures=tenures, staff=staff,
               issues=issues, cross=cross, fixes=[dict(zip(("season", "team", "first", "last", "acting", "credited", "note", "source"), f[:8]), confirmed=(f[8] if len(f) > 8 else True)) for f in HC_FIXES],
               unconfirmed=HC_UNCONFIRMED, nba_staff_seasons=sorted(nba))
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "registry.json"), "w"))
    log(f"wrote {OUT}/registry.json")
    return out


if __name__ == "__main__":
    main()
