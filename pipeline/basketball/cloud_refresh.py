"""
cloud_refresh.py — the Basketball Savant in-season refresh, run in the cloud (GitHub Actions).

    python3 cloud_refresh.py [season] [--through YYYY-MM-DD] [--out DIR] [--public DIR]

Same outputs as the Mac's publish_current.sh, from data a cloud server can reach:
  * the season in progress from ESPN (espn_source -> espn_tables -> espn_shim), so the
    unchanged engine (refresh_current, projections, teams_engine) runs as it does on the Mac;
  * things that don't change in season from seed/ (the Mac's cache for exactly those tables);
  * value bars from basketball-reference.com and injuries from Sleeper, as before.

The NBA's tracking, Synergy and hustle tables can't be reached from the cloud. The Mac uploads
them when it's awake (export_tracking.py / publish_tracking.sh, branch tracking-data) and
--tracking points here at its latest upload; the engine reads them as if it had fetched them,
so drives, potential assists, self-created, rim protection, deflections, gravity, matchups and
play types come out exactly as on the Mac, as of that upload ("tracking" in the season file).
Without an upload those stats are left null.

ESPN identifies players by its own ids. seed/espn_ids.json maps them to NBA person ids; new
players are matched by name and team against the NBA's player index in the seed and the last
published season file, and the map is saved back so a match is made once.
"""
import argparse
import datetime as dt
import gzip
import io
import json
import os
import re
import sys
import unicodedata

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import savant_config as C  # noqa: E402
import savant_engine as E  # noqa: E402
import espn_source as S  # noqa: E402
import espn_tables as T  # noqa: E402
import espn_shim as SH  # noqa: E402

from zoneinfo import ZoneInfo  # noqa: E402

ET = ZoneInfo("America/New_York")
SEED = os.path.join(HERE, "seed")
IDS = os.path.join(SEED, "espn_ids.json")


# ----------------------------------------------------------------------------- names
def norm(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.,'`’\-]", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def read_seed(name, **match):
    """A seed table by endpoint name and parameter match (first hit)."""
    idx = json.load(open(os.path.join(SEED, "index.json")))
    for r in idx:
        if r["name"] == name and all(r["params"].get(k) == v for k, v in match.items()):
            return read_seed_key(r["key"])
    return None


def read_seed_key(key):
    return SH.read_seed_key(SEED, key)


# ----------------------------------------------------------------------------- the player universe
def known_players(season, public_dir):
    """NBA id -> {name, team, pos, ...} from the seed's player index and the published files."""
    known = {}
    idx = read_seed("PlayerIndex", season=season, historical_nullable="1")
    if idx is not None:
        if "STATS_TIMEFRAME" in idx.columns:
            idx = idx[idx.STATS_TIMEFRAME == "Season"]
        for r in idx.itertuples(index=False):
            known[int(r.PERSON_ID)] = dict(name=f"{r.PLAYER_FIRST_NAME} {r.PLAYER_LAST_NAME}".strip(),
                                           team=r.TEAM_ABBREVIATION, src="index")
    for fn in ("savant-current.json",):
        p = os.path.join(public_dir, fn)
        if os.path.exists(p):
            d = json.load(open(p))
            for s in d.get("data", {}).values():
                for pl in s.get("players", []):
                    known.setdefault(int(pl["id"]), dict(name=pl["name"], team=pl.get("team"), src=fn))
    try:
        from nba_api.stats.static import players as SP
        for pl in SP.get_players():
            if pl.get("is_active"):
                known.setdefault(int(pl["id"]), dict(name=pl["full_name"], team=None, src="static"))
    except Exception:  # noqa
        pass
    return known


def build_idmap(games, rosters, known, log=print):
    """ESPN athlete id -> NBA person id. Saved matches first, then name (+ team) matches."""
    saved = json.load(open(IDS)) if os.path.exists(IDS) else {}
    by_name = {}
    for pid, k in known.items():
        by_name.setdefault(norm(k["name"]), []).append((pid, k.get("team")))
    espn = {}
    for g in games:
        for b in g["players"]:
            espn[b["eid"]] = (b["name"], b["team"])
    for eid, r in rosters.items():
        espn.setdefault(eid, (r["name"], r["team"]))
    idmap, unmatched = {}, []
    for eid, (name, team) in espn.items():
        if eid in saved:
            idmap[eid] = int(saved[eid])
            continue
        cands = by_name.get(norm(name), [])
        if len(cands) > 1:
            same = [c for c in cands if c[1] == team]
            cands = same if len(same) == 1 else cands
        if len(cands) == 1:
            idmap[eid] = int(cands[0][0])
        else:
            unmatched.append((eid, name, team, len(cands)))
    # persist what was matched (never overwrite a saved match)
    merged = dict(saved)
    merged.update({k: v for k, v in idmap.items() if k not in saved})
    os.makedirs(SEED, exist_ok=True)
    json.dump(dict(sorted(merged.items())), open(IDS, "w"), indent=0)
    played = {b["eid"] for g in games for b in g["players"] if not b["dnp"]}
    miss_played = [u for u in unmatched if u[0] in played]
    if miss_played:
        log(f"  ESPN ids with no NBA id ({len(miss_played)} who have played): "
            + ", ".join(f"{n} ({t})" for _, n, t, _ in miss_played[:12]))
    return idmap, unmatched


def player_index(season, games, rosters, idmap, known):
    """The NBA's PlayerIndex (historical form) for the season, kept current from ESPN:
      * STATS_TIMEFRAME is "Season" for everyone who has played this season (the engine's
        player list), "Career" for everyone else;
      * ROSTER_STATUS is 1 for everyone on a roster now (the projections' player list);
      * TEAM_ABBREVIATION / TEAM_ID is the team of his latest game, else his roster.
    Rows come from the seed (the NBA's own index: names, positions, draft slot); players
    signed since the seed are added from ESPN's rosters."""
    idx = read_seed("PlayerIndex", season=season, historical_nullable="1")
    cols = ["PERSON_ID", "PLAYER_LAST_NAME", "PLAYER_FIRST_NAME", "TEAM_ID", "TEAM_ABBREVIATION",
            "POSITION", "FROM_YEAR", "TO_YEAR", "DRAFT_NUMBER", "ROSTER_STATUS", "STATS_TIMEFRAME"]
    idx = idx.copy() if idx is not None else pd.DataFrame(columns=cols)
    team_ids = nba_team_ids()
    latest, played = {}, set()
    for g in sorted(games, key=lambda g: g["date"]):
        for b in g["players"]:
            if not b["dnp"] and b["eid"] in idmap:
                latest[idmap[b["eid"]]] = b["team"]
                played.add(idmap[b["eid"]])
    rostered = {}
    for eid, r in rosters.items():
        if eid in idmap:
            rostered[idmap[eid]] = r["team"]
    espn_pos = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C",
                "G-F": "G-F", "F-G": "F-G", "F-C": "F-C", "C-F": "C-F"}
    have = set(int(p) for p in idx.PERSON_ID) if len(idx) else set()
    new = []
    for eid, r in rosters.items():
        pid = idmap.get(eid)
        if pid is None or pid in have:
            continue
        first, _, last = (r["name"] or "").partition(" ")
        new.append(dict(PERSON_ID=pid, PLAYER_FIRST_NAME=first, PLAYER_LAST_NAME=last,
                        POSITION=espn_pos.get(r.get("pos") or "", "F"),
                        FROM_YEAR=int(season[:4]) - int(r.get("exp") or 0), TO_YEAR=int(season[:4]),
                        DRAFT_NUMBER=None))
        have.add(pid)
    if new:
        idx = pd.concat([idx, pd.DataFrame(new)], ignore_index=True)
    pid = idx.PERSON_ID.astype(int)
    team = pid.map(lambda p: latest.get(p) or rostered.get(p))
    idx.loc[team.notna(), "TEAM_ABBREVIATION"] = team[team.notna()]
    idx.loc[team.notna(), "TEAM_ID"] = team[team.notna()].map(team_ids)
    idx["STATS_TIMEFRAME"] = pid.map(lambda p: "Season" if p in played else "Career")
    # Rostered: on an ESPN roster, or rostered in the NBA's index and unknown to ESPN (ESPN's
    # roster pages leave out some two-way players). A player ESPN knows who is on no roster
    # has been waived.
    seed_rostered = set(pid[idx.get("ROSTER_STATUS", pd.Series(dtype=float)).fillna(0).astype(float) == 1]) \
        if "ROSTER_STATUS" in idx.columns else set()
    known_to_espn = set(idmap.values())
    on_roster = set(rostered) | {p for p in seed_rostered if p not in known_to_espn}
    idx["ROSTER_STATUS"] = pid.map(lambda p: 1 if p in on_roster else None)
    return idx, new


def bio_table(season, rosters, idmap):
    bio = read_seed("LeagueDashPlayerBioStats", season=season)
    bio = bio.copy() if bio is not None else pd.DataFrame(columns=["PLAYER_ID", "PLAYER_HEIGHT_INCHES", "PLAYER_WEIGHT", "AGE"])
    have = set(int(p) for p in bio.PLAYER_ID) if len(bio) else set()
    ref = dt.date(int(season[:4]) + 1, 2, 1)
    rows = []
    for eid, r in rosters.items():
        pid = idmap.get(eid)
        if pid is None or pid in have:
            continue
        age = 0
        if r.get("dob"):
            y, m, d = (int(x) for x in r["dob"][:10].split("-"))
            age = int((ref - dt.date(y, m, d)).days / 365.25)
        rows.append(dict(PLAYER_ID=pid, PLAYER_HEIGHT_INCHES=r.get("height") or 0,
                         PLAYER_WEIGHT=r.get("weight") or 0, AGE=age))
    if rows:
        bio = pd.concat([bio, pd.DataFrame(rows)], ignore_index=True)
    return bio


def nba_team_ids():
    from nba_api.stats.static import teams as ST
    return {t["abbreviation"]: t["id"] for t in ST.get_teams()}


def schedule_table(season, log=print):
    """ScheduleLeagueV2's frame 0 (the columns projections and teams_engine read) from ESPN's
    team schedules: every regular-season game, played or not."""
    teams = S._get(f"{S.BASE}/teams")["sports"][0]["leagues"][0]["teams"]
    year = int(season[:4]) + 1
    rows = {}
    for t in teams:
        tid = t["team"]["id"]
        d = S._get(f"{S.BASE}/teams/{tid}/schedule?season={year}&seasontype=2")
        for e in d.get("events", []):
            comp = e["competitions"][0]
            sides = {c["homeAway"]: S.nba_abbr(c["team"]["abbreviation"]) for c in comp["competitors"]}
            when = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(ET)
            rows[e["id"]] = dict(gameId="002" + str(e["id"])[-7:].zfill(7), espnId=e["id"],
                                 gameDateEst=when.strftime("%Y-%m-%dT00:00:00Z"),
                                 gameDate=when.strftime("%m/%d/%Y 00:00:00"),
                                 homeTeam_teamTricode=sides.get("home"), awayTeam_teamTricode=sides.get("away"))
    df = pd.DataFrame(list(rows.values())).sort_values("gameDateEst").reset_index(drop=True)
    log(f"  ESPN schedule: {len(df)} games")
    return df


# ----------------------------------------------------------------------------- CommonPlayerInfo for new players
def install_player_info(shim, rosters, idmap, season):
    """CommonPlayerInfo for a player the seed doesn't have (signed since): from ESPN's roster."""
    rev = {v: k for k, v in idmap.items()}
    orig = shim.seed

    def seed(name, params, frames):
        try:
            return orig(name, params, frames)
        except SH.NotInCloud:
            if name != "CommonPlayerInfo":
                raise
            pid = int(params["player_id"])
            r = rosters.get(rev.get(pid), {})
            exp = r.get("exp")
            df = pd.DataFrame([dict(PERSON_ID=pid, BIRTHDATE=(r.get("dob") or "")[:10] + "T00:00:00" if r.get("dob") else None,
                                    SCHOOL=r.get("college"),
                                    FROM_YEAR=int(season[:4]) - int(exp) if exp is not None else None)])
            return {fr: df for fr in frames}
    shim.seed = seed


# ----------------------------------------------------------------------------- main
def prepare(season, cache_dir, public_dir, through=None, games=None, log=print):
    if games is None:
        games = S.fetch_season(season, cache_dir, through=through, log=log)
    if through:
        games = [g for g in games if g["date"] <= through.isoformat()]
    log("  ESPN rosters ...")
    rosters = S.rosters()
    known = known_players(season, public_dir)
    idmap, unmatched = build_idmap(games, rosters, known, log=log)
    names = {pid: k["name"] for pid, k in known.items()}
    tables = T.SeasonTables(season, games, {k: v for k, v in idmap.items()}, nba_team_ids(), names=names, log=log)
    tables.player_index, new = player_index(season, games, rosters, idmap, known)
    if new:
        log(f"  {len(new)} player(s) added since the seed: " + ", ".join(
            f"{n['PLAYER_FIRST_NAME']} {n['PLAYER_LAST_NAME']}" for n in new[:10]))
    tables.bio = bio_table(season, rosters, idmap)
    tables.ages = {int(r.PLAYER_ID): r.AGE for r in tables.bio.itertuples(index=False)}
    return games, tables, rosters, idmap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("season", nargs="?", default=C.SEASON)
    ap.add_argument("--through")
    ap.add_argument("--cache", default=os.path.join(HERE, ".espn-cache"))
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--skip", default="", help="comma list: projections,teams")
    ap.add_argument("--tracking", default=None, help="the Mac's tracking-table upload (branch tracking-data)")
    a = ap.parse_args()
    season = a.season
    through = dt.date.fromisoformat(a.through) if a.through else None
    print(f"=== cloud refresh {season} ({dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC) ===")
    games, tables, rosters, idmap = prepare(season, os.path.join(a.cache, season), a.public, through)
    if not games:
        print("  no regular-season games yet")
    try:
        tables.schedule = schedule_table(season)
    except Exception as e:  # noqa
        print(f"  schedule: failed ({repr(e)[:80]})")
    tracking = None
    if a.tracking and os.path.exists(os.path.join(a.tracking, "manifest.json")):
        man = json.load(open(os.path.join(a.tracking, "manifest.json")))
        if man.get("season") == season:
            tracking = a.tracking
            print(f"  tracking tables from the Mac: through {man.get('through')} (uploaded {man.get('generated')})")
        else:
            print(f"  the Mac's tracking upload is for {man.get('season')}, not {season}: not used")
    else:
        man = {}
        print("  no tracking upload from the Mac yet")
    shim = SH.install(season, tables, SEED, tracking_dir=tracking)
    install_player_info(shim, rosters, idmap, season)

    import refresh_current as R
    rc = R.main(season)
    if rc == 0 and os.path.exists(R.OUT):
        # Say where the numbers came from (the Mac's runs wrote "nba_api+br").
        d = json.load(open(R.OUT))
        d["source"] = "espn+br"
        # Tracking, Synergy, hustle and matchup stats come from the Mac's last upload: say
        # which games they cover, so a stale panel can be told apart from a fresh one.
        if tracking:
            d["tracking"] = {"through": man.get("through"), "uploaded": man.get("generated")}
        import safe_io
        safe_io.write_text(R.OUT, R.strict_json(d))
    if SH.LOG:
        un = sorted({x for x in SH.LOG if x.startswith("unavailable")})
        if un:
            print(f"  not reachable from the cloud, no Mac copy (left null): {', '.join(u.split(' ', 1)[1] for u in un)}")
        mac = sorted({x for x in SH.LOG if x.startswith("from the Mac")})
        if mac:
            print(f"  from the Mac's upload: {', '.join(u.split(' ', 3)[3] for u in mac)}")
        ns = [x for x in SH.LOG if x.startswith("no seed")]
        if ns:
            print(f"  {len(ns)} request(s) not in the seed, e.g. {ns[0][:140]}")
    if tables.unmapped:
        print(f"  {len(tables.unmapped)} ESPN player id(s) without an NBA id were left out")
    skip = set(filter(None, a.skip.split(",")))
    if rc not in (0, 3):
        return rc
    os.environ.setdefault("SAVANT_PUBLIC", os.path.abspath(a.public))
    if "projections" not in skip:
        try:
            import projections as P
            E.FRESH_SEASON = season
            P.build(season)
        except Exception as e:  # noqa
            print(f"  projections failed: {repr(e)[:120]}")
    if "teams" not in skip:
        try:
            import teams_engine as TE
            E.FRESH_SEASON = season
            os.makedirs(os.path.join("out", "site"), exist_ok=True)
            TE.build_current(os.path.join("out", "site"), season)
        except Exception as e:  # noqa
            print(f"  teams failed: {repr(e)[:120]}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
