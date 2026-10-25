"""
career.py — save format, determinism guarantee, records and the trophy case.

Two jobs.

1. THE SAVE. A versioned document that survives across seasons and is shaped for a
   server from day one, even while it runs locally. Nothing about the schema assumes
   the browser is the source of truth.

2. THE DETERMINISM GUARANTEE. Every game is a pure function of (rosters, seed). The save
   stores seeds, not outcomes, so any result can be recomputed and checked. That is what
   makes a leaderboard mean anything: a claimed 73-win season is verifiable rather than
   asserted, and the check costs a replay rather than a trust decision.

Usage:
  python career.py determinism    # prove the sim is reproducible
  python career.py test
"""
import json, sys, hashlib, random, collections, datetime

SAVE_VERSION = 1


# ------------------------------------------------------------------ the save

def new_career(user, team, season, control_surface, seed=None):
    seed = seed if seed is not None else random.randrange(2 ** 31)
    return {
        "schema": SAVE_VERSION,
        "career_id": hashlib.sha1(f"{user}|{team}|{season}|{seed}".encode()).hexdigest()[:16],
        "user": user,
        "franchise": {"team": team, "hired_season": season, "current_season": season},
        "control_surface": control_surface,
        "rng_seed": seed,
        # Seasons store what HAPPENED plus the seed that produced it. Storing the seed
        # rather than only the result is what makes the whole save verifiable.
        "seasons": [],
        "records": blank_records(),
        "badges": [],
        "status": {"employed": True, "owner_confidence": 0.0, "mandate": "playoffs"},
    }


def blank_records():
    return {
        "championships": 0, "finals_appearances": 0, "conference_titles": 0,
        "playoff_series_won": 0, "playoff_appearances": 0,
        "best_record": None, "worst_record": None, "total_wins": 0, "total_losses": 0,
        "seasons_completed": 0, "fastest_title": None,
        "drafted_all_stars": 0, "trades_made": 0,
    }


def record_season(save, *, season, wins, losses, seed, playoff_rounds=0,
                  conference_title=False, champion=False, trades=0, drafted=None):
    """Append a season and roll every all-time record forward."""
    s = {
        "season": season, "wins": wins, "losses": losses, "seed": seed,
        "playoff_rounds": playoff_rounds, "conference_title": conference_title,
        "champion": champion, "trades": trades, "drafted": drafted or [],
    }
    save["seasons"].append(s)
    r = save["records"]
    r["seasons_completed"] += 1
    r["total_wins"] += wins
    r["total_losses"] += losses
    r["trades_made"] += trades
    if playoff_rounds > 0 or wins >= 41:
        pass
    if playoff_rounds >= 1:
        r["playoff_appearances"] += 1
    r["playoff_series_won"] += playoff_rounds
    if conference_title:
        r["conference_titles"] += 1
        r["finals_appearances"] += 1
    if champion:
        r["championships"] += 1
        n = r["seasons_completed"]
        if r["fastest_title"] is None or n < r["fastest_title"]:
            r["fastest_title"] = n
    if r["best_record"] is None or wins > r["best_record"]["wins"]:
        r["best_record"] = {"season": season, "wins": wins, "losses": losses}
    if r["worst_record"] is None or wins < r["worst_record"]["wins"]:
        r["worst_record"] = {"season": season, "wins": wins, "losses": losses}
    save["franchise"]["current_season"] = season
    save["badges"] = earned_badges(save)
    return s


# ---------------------------------------------------------------- trophy case

BADGES = [
    dict(id="champion",     name="Champion",
         test=lambda r, s: r["championships"] >= 1,
         blurb="Won it all."),
    dict(id="dynasty",      name="Dynasty",
         test=lambda r, s: r["championships"] >= 3,
         blurb="Three titles with one franchise."),
    dict(id="repeat",       name="Back-to-Back",
         test=lambda r, s: _consecutive(s, "champion", 2),
         blurb="Titles in consecutive seasons."),
    dict(id="quick_build",  name="Quick Build",
         test=lambda r, s: (r["fastest_title"] or 99) <= 3,
         blurb="A title within three seasons of being hired."),
    dict(id="70_wins",      name="70-Win Season",
         test=lambda r, s: (r["best_record"] or {}).get("wins", 0) >= 70,
         blurb="Seventy regular-season wins."),
    dict(id="perennial",    name="Perennial",
         test=lambda r, s: r["playoff_appearances"] >= 10,
         blurb="Ten playoff appearances."),
    dict(id="500_wins",     name="500 Wins",
         test=lambda r, s: r["total_wins"] >= 500,
         blurb="Five hundred regular-season wins as GM."),
    dict(id="tank_commander", name="Full Teardown",
         test=lambda r, s: (r["worst_record"] or {}).get("wins", 99) <= 15,
         blurb="A fifteen-win season. On purpose, presumably."),
    dict(id="draft_eye",    name="Eye for Talent",
         test=lambda r, s: r["drafted_all_stars"] >= 3,
         blurb="Drafted three players who became All-Stars."),
    dict(id="survivor",     name="Tenured",
         test=lambda r, s: r["seasons_completed"] >= 15,
         blurb="Fifteen seasons in the chair."),
]


def _consecutive(seasons, key, n):
    run = 0
    for s in seasons:
        run = run + 1 if s.get(key) else 0
        if run >= n:
            return True
    return False


def earned_badges(save):
    r, s = save["records"], save["seasons"]
    return [b["id"] for b in BADGES if b["test"](r, s)]


def leaderboard_row(save):
    """The shape a global board reads. Deliberately small and derived — never trusted
    from the client without a replay check."""
    r = save["records"]
    return {
        "career_id": save["career_id"], "user": save["user"],
        "team": save["franchise"]["team"],
        "championships": r["championships"],
        "fastest_title": r["fastest_title"],
        "best_record": (r["best_record"] or {}).get("wins"),
        "total_wins": r["total_wins"],
        "seasons": r["seasons_completed"],
        "badges": len(save["badges"]),
        "verify": integrity_hash(save),
    }


# ------------------------------------------------------------- verifiability

def integrity_hash(save):
    """A hash over the inputs that determine every result — the seeds and the outcomes
    claimed from them. The server recomputes a season from its seed and compares."""
    payload = [save["career_id"], str(save["rng_seed"])]
    for s in save["seasons"]:
        payload.append(f"{s['season']}|{s['seed']}|{s['wins']}|{s['losses']}|"
                       f"{s['playoff_rounds']}|{int(bool(s['champion']))}")
    return hashlib.sha256("||".join(payload).encode()).hexdigest()[:32]


def verify_season(save, index, replay_fn):
    """Recompute one season from its stored seed and compare to the claim.

    replay_fn(seed) -> {'wins': {team: n}, 'champion': team}
    """
    s = save["seasons"][index]
    got = replay_fn(s["seed"])
    team = save["franchise"]["team"]
    ok_w = got["wins"].get(team) == s["wins"]
    ok_c = (got.get("champion") == team) == bool(s["champion"])
    return {"ok": ok_w and ok_c, "claimed_wins": s["wins"],
            "recomputed_wins": got["wins"].get(team),
            "claimed_champion": bool(s["champion"]),
            "recomputed_champion": got.get("champion") == team}


# ====================================================================== CLI

def cmd_determinism():
    """The guarantee the whole leaderboard rests on."""
    import sim_engine as SE, season_engine as SN
    teams = SE.load_league()
    print("determinism — every game must be a pure function of (rosters, seed)\n")

    a = SE.simulate(teams["BOS"], teams["OKC"], 12345)
    b = SE.simulate(teams["BOS"], teams["OKC"], 12345)
    same_score = a[0] == b[0]
    same_box = {k: dict(v) for k, v in a[1].s.items()} == \
               {k: dict(v) for k, v in b[1].s.items()}
    print(f"  same seed, same game       : score {a[0]} vs {b[0]}   "
          f"{'IDENTICAL' if same_score and same_box else 'DIVERGED'}")

    c = SE.simulate(teams["BOS"], teams["OKC"], 12346)
    print(f"  different seed             : {c[0]}   "
          f"{'differs' if c[0] != a[0] else 'SUSPICIOUSLY IDENTICAL'}")

    # a whole season, twice
    s1 = SN.run_season(teams, 999)
    s2 = SN.run_season(teams, 999)
    w1 = {t: s1["wins"][t] for t in SN.TEAMS}
    w2 = {t: s2["wins"][t] for t in SN.TEAMS}
    print(f"  same seed, whole season    : "
          f"{'IDENTICAL' if w1 == w2 else 'DIVERGED'}   "
          f"champion {s1['champion']} / {s2['champion']}")
    print(f"\n  a season replays in full from 4 bytes of seed. That is what lets the")
    print(f"  server verify a claimed 73-win season instead of trusting the client.")
    return same_score and same_box and w1 == w2


def cmd_test():
    T = []

    def ck(name, cond, detail=""):
        T.append((cond, name, detail))

    import franchise as FR
    cs = FR.ControlSurface("guided", {"trades": FR.MANUAL}).to_json()
    sv = new_career("adam", "OKC", "2026-27", cs, seed=7)

    ck("a new career starts empty and employed",
       sv["records"]["seasons_completed"] == 0 and sv["status"]["employed"])
    ck("the save carries a schema version", sv["schema"] == SAVE_VERSION)
    ck("the control surface is stored in the save",
       sv["control_surface"]["levels"]["trades"] == FR.MANUAL)

    record_season(sv, season="2026-27", wins=52, losses=30, seed=111,
                  playoff_rounds=2, conference_title=True, trades=3)
    ck("a season rolls into the all-time records",
       sv["records"]["total_wins"] == 52 and sv["records"]["conference_titles"] == 1)
    ck("best record tracks", sv["records"]["best_record"]["wins"] == 52)

    record_season(sv, season="2027-28", wins=64, losses=18, seed=112,
                  playoff_rounds=4, conference_title=True, champion=True)
    ck("a title is recorded", sv["records"]["championships"] == 1)
    ck("fastest title counts seasons since hire",
       sv["records"]["fastest_title"] == 2, f"{sv['records']['fastest_title']}")
    ck("champion and quick-build badges are earned",
       "champion" in sv["badges"] and "quick_build" in sv["badges"],
       str(sv["badges"]))
    ck("best record updates on a better season",
       sv["records"]["best_record"]["wins"] == 64)

    record_season(sv, season="2028-29", wins=61, losses=21, seed=113,
                  playoff_rounds=4, conference_title=True, champion=True)
    ck("back-to-back is detected", "repeat" in sv["badges"], str(sv["badges"]))
    ck("a dynasty needs three", "dynasty" not in sv["badges"])
    record_season(sv, season="2029-30", wins=58, losses=24, seed=114,
                  playoff_rounds=4, conference_title=True, champion=True)
    ck("three titles earns the dynasty badge", "dynasty" in sv["badges"])

    record_season(sv, season="2030-31", wins=12, losses=70, seed=115)
    ck("a teardown is recorded, not hidden",
       sv["records"]["worst_record"]["wins"] == 12 and "tank_commander" in sv["badges"])
    ck("the best record survives a bad season",
       sv["records"]["best_record"]["wins"] == 64)

    h1 = integrity_hash(sv)
    sv2 = json.loads(json.dumps(sv))
    ck("the integrity hash is stable across a save/load round trip",
       integrity_hash(sv2) == h1)
    sv2["seasons"][0]["wins"] = 82
    ck("editing a result changes the hash", integrity_hash(sv2) != h1)

    # replay verification
    def honest(seed):
        return {"wins": {"OKC": 52}, "champion": None}
    def liar(seed):
        return {"wins": {"OKC": 30}, "champion": None}
    ck("a truthful season verifies",
       verify_season(sv, 0, honest)["ok"])
    ck("a doctored season fails verification",
       not verify_season(sv, 0, liar)["ok"])

    row = leaderboard_row(sv)
    ck("the leaderboard row carries what a board needs",
       row["championships"] == 3 and row["fastest_title"] == 2
       and row["best_record"] == 64 and row["verify"])

    ck("the save is JSON-serialisable end to end",
       isinstance(json.dumps(sv), str))

    ok = sum(1 for c, _, _ in T if c)
    print(f"career persistence — {ok}/{len(T)} behaviours correct\n")
    for good_, name, detail in T:
        print(f"  {'PASS' if good_ else 'FAIL'}  {name}")
        if detail:
            print(f"        {detail}")
    return ok == len(T)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "test"
    {"determinism": cmd_determinism, "test": cmd_test}[cmd]()
