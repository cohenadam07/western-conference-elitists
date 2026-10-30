"""
refresh_current.py — rebuild the season in progress, alone, into out/current.json.

The full build (savant_engine.py build + build_historical + br_value_modern + ...) remakes all
47 seasons and the 67 MB public/savant-data.json. In season that is the wrong unit of work:
only one season moves. This rebuilds just that season, fresh from stats.nba.com (the disk
cache is bypassed for it — see savant_engine.FRESH_SEASON), and writes it in the archive's own
shape so the page, the connector and the build scripts can lay it over the archive:

    {seasons: [season], generated, source, through, qualify: {season: {...}}, data: {season: {players}}}

Same split as Football Savant: the archive stays static, the season in progress is its own
small file (public/savant-current.json, ~3 MB), and whichever copy of a season is newer wins.

    python refresh_current.py                 # the current season (savant_config.SEASON)
    python refresh_current.py 2025-26         # any season — used to check the path against the archive

Exit codes: 0 = wrote out/current.json, 3 = no regular-season games yet (nothing written),
1 = failure. publish_current.sh treats 3 as a quiet success.

Must run on the home network: stats.nba.com blocks cloud IPs.
"""
import json, math, os, re, sys, datetime as dt
import savant_config as C
import savant_engine as E

OUT = os.path.join("out", "current.json")
GAMES_IN_SEASON = 82


def team_games(season):
    """Median games played across the 30 teams (0 before opening night)."""
    df = E.load_team_opponent(season)
    if df is None or len(df) == 0 or "GP" not in df.columns:
        return 0
    gp = sorted(int(x or 0) for x in df["GP"].tolist())
    return gp[len(gp) // 2]


GAMES_IN = os.path.join("out", "games_in.json")

def game_dates(season):
    """(first, last) regular-season game dates in the data, as YYYY-MM-DD (or None, None).
    Also writes out/games_in.json, the game ids the dashboards include right now, which
    slate_watch.py uses to tell whether tonight's games made it into the published data."""
    try:
        from nba_api.stats.endpoints import leaguegamelog as L
        df = E.call(L.LeagueGameLog, dict(season=season, season_type_all_star=C.SEASON_TYPE,
                                          player_or_team_abbreviation="T"))
        if not len(df):
            return None, None
        ds = [str(x).split("T")[0] for x in df["GAME_DATE"]]
        os.makedirs("out", exist_ok=True)
        json.dump(sorted({str(g).zfill(10) for g in df["GAME_ID"]}), open(GAMES_IN, "w"))
        return min(ds), max(ds)
    except Exception as e:
        print(f"  game dates unavailable ({repr(e)[:80]})")
        return None, None


MIN_GP_FLOOR = 3     # after opening week, never qualify anyone on one or two games
OPENING_WEEK = 7     # days from the first game during which one game is enough (Adam, Oct 14)

def prorated_qualifier(games, first_date=None, through=None):
    """The full-season bar is 20 GP and 15 MPG. Early in the year nobody has 20 games, so the
    games bar scales with the share of the season played (the same idea as Football Savant's
    pro-rated qualifying lines), with a floor of MIN_GP_FLOOR.

    Opening week is the exception: for the first OPENING_WEEK days anyone with a game at 15+
    minutes qualifies, so every card, leaderboard and percentile populates from night one.
    Those numbers rest on one to three games; the "likely to settle" marks on the page and in
    the connector are what keep them honest. MPG is a rate and needs no scaling."""
    frac = min(1.0, games / GAMES_IN_SEASON)
    floor, opening = MIN_GP_FLOOR, False
    if first_date and through:
        d0, d1 = (dt.date.fromisoformat(x) for x in (first_date, through))
        if (d1 - d0).days < OPENING_WEEK:
            floor, opening = 1, True
    q = {"min_gp": max(floor, math.ceil(C.QUALIFY["min_gp"] * frac)),
         "min_mpg": C.QUALIFY["min_mpg"], "team_games": games}
    if opening:
        q["opening_week"] = True
    return q


def attach_value_bars(season, players):
    """PER / WS48 / BPM / OBPM / DBPM / VORP from Basketball Reference (nba_api has none),
    joined on normalized name exactly as br_value_modern does. The cached page is moved aside
    so it is fetched fresh; if the fetch fails the old copy goes back and is used."""
    import br_fetch as BR
    import br_crosswalk as X
    ey = int(season[:4]) + 1
    cp = BR.cache_path(ey, "advanced")
    bak = cp + ".prev"
    if os.path.exists(cp):
        os.replace(cp, bak)
    try:
        badv = BR.load_advanced(ey)
        if os.path.exists(bak):
            os.remove(bak)
    except Exception as e:
        if os.path.exists(bak):
            os.replace(bak, cp)
            print(f"  value bars: live BR fetch failed ({repr(e)[:70]}); using the cached page")
            badv = BR.load_advanced(ey)
        else:
            print(f"  value bars: unavailable ({repr(e)[:70]})")
            return 0
    br_by = {}
    for r in badv.values():
        br_by.setdefault(X._norm(r["name"]), []).append(r)
    nb_by = {}
    for p in players:
        nb_by.setdefault(X._norm(p["name"]), []).append(p)
    n = 0
    for name, brs in br_by.items():
        nbs = nb_by.get(name)
        if not nbs or len(brs) != 1 or len(nbs) != 1:
            continue
        r, p = brs[0], nbs[0]
        for k in ("per", "ws48", "bpm", "obpm", "dbpm", "vorp"):
            if r.get(k) is not None:
                p["m"].setdefault(k, {})["season"] = {"v": r[k], "n": None}
        n += 1
    return n


def strict_json(obj):
    """The engine can emit NaN/Infinity, which JSON.parse rejects; build_page.py rewrites them
    to null and so does this, then proves the result parses strictly."""
    s = json.dumps(obj, separators=(",", ":"))
    s = re.sub(r"-?Infinity", "null", re.sub(r"\bNaN\b", "null", s))
    json.loads(s, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(f"stray {c}")))
    return s


def main(season=None):
    season = season or C.SEASON
    E.FRESH_SEASON = season
    os.makedirs("out", exist_ok=True)
    print(f"--- current-season refresh: {season} ---")

    games = team_games(season)
    if games == 0:
        print(f"  no {season} regular-season games yet — nothing to write")
        return 3
    first_date, through = game_dates(season)
    qualify = prorated_qualifier(games, first_date, through)
    print(f"  {games} team games in; qualifier {qualify['min_gp']} GP / {qualify['min_mpg']:.0f} MPG"
          + (" (opening week)" if qualify.get("opening_week") else ""))

    players, unavailable = E.build_one_season(season, current=season, qualify=qualify)
    if not players:
        print("  engine returned no players — refusing to write an empty season")
        return 1
    if unavailable:
        print(f"  null metrics this run: {sorted(unavailable)}")

    # The full build's post-passes, in the full build's order, applied to this season only:
    # value bars (BR) -> context bars (minutes share, availability, STL%, BLK%) -> defender
    # difficulty (needs DBPM from the value bars). Weakness comps follow once the file is
    # written (they need minutes share for their pool).
    n = attach_value_bars(season, players)
    print(f"  value bars on {n}/{len(players)} players")
    import patch_context_bars, inject_ddiff
    n = patch_context_bars.apply_season(season, players)
    print(f"  context bars on {n}/{len(players)} players")
    if C.season_tier(season) >= 4:
        n = inject_ddiff.apply_season(season, players)
        print(f"  defender difficulty on {n}/{len(players)} players")
    # October 2026 card stats (extras_engine.py, xfg_model.py). Each is optional: a failure
    # costs that stat for the night, never the refresh.
    import extras_engine as X
    # Play types run live=True: in season the percentile is ours, not the NBA's (which is
    # ranked inside its own 10-possession pool — see extras_engine.SAMPLE_FLAG). Whatever
    # this script writes is the season in progress as far as the site is concerned, so a
    # rerun for an older season gets the in-season treatment too, which is the point.
    for name, fn in (("scoring splits", X.apply_scoring), ("luck-adjusted on/off", X.apply_onoff_adj),
                     ("play types", lambda s, ps: X.apply_playtypes(s, ps, live=True)),
                     ("with/without", X.apply_with_without)):
        try:
            print(f"  {name} on {fn(season, players)}/{len(players)} players")
        except Exception as e:
            print(f"  {name}: failed ({repr(e)[:80]})")
    # Shot-making (syn) is a possession-weighted average of play-type percentiles, which the
    # engine took from the NBA's — ranked inside its 10-possession pool. Rebuild it from the
    # panel we just wrote, so the bar rests on the same cutoffs the rows do. Only when the
    # play-type pull actually produced something: a failed pull must not strip the bar.
    if any(p.get("pt") for p in players):
        try:
            print(f"  shot-making rebuilt from play types on {X.apply_syn(players)}/{len(players)} players")
        except Exception as e:
            print(f"  shot-making: failed ({repr(e)[:80]})")
    else:
        print("  shot-making: no play types above the NBA's floor, so nothing to rebuild from")
    try:
        import xfg_model
        print(f"  shot quality on {xfg_model.apply(season, players)}/{len(players)} players")
    except Exception as e:
        print(f"  shot quality: failed ({repr(e)[:80]})")
    # October 2026 additions (ext_engine.py): ~145 card stats and 12 panels. On the Mac only the
    # NBA's tables are requested (that run exists to upload them); the cloud builds everything.
    try:
        import ext_engine as XE
        XE.apply_live(season, players)
    except Exception as e:
        print(f"  ext stats: failed ({repr(e)[:120]})")
    # They ship beside savant-current.json, not in it (public/savant-ext/, see ext_files.py):
    # the page fetches them only for a season a reader opens, so the file every visit loads
    # stays the size it was.
    import ext_files as XFL
    ext_vals, ext_panels = XFL.split(players)

    payload = dict(
        seasons=[season],
        generated=dt.datetime.now(dt.timezone.utc).isoformat(),
        source="nba_api+br",
        through=through,
        # The play-type cutoffs and the pool behind each percentile. Published next to the
        # data so the page and the connector read one source of truth instead of carrying
        # their own copies of 25 and 20 (extras_engine.playtype_meta).
        playtypes=X.playtype_meta(players),
        qualify={season: qualify},
        data={season: dict(players=players)},
    )
    if E.STALE_USED:
        # Tables that timed out tonight and were carried from the last good run. Kept in the
        # file so a stale panel is traceable, and printed so the log says so.
        payload["stale"] = list(E.STALE_USED)
        print(f"  {len(E.STALE_USED)} table(s) carried from the last good run:")
        for s in E.STALE_USED:
            print(f"    {s[:140]}")
    import safe_io
    safe_io.write_text(OUT, strict_json(payload))

    # Weakness comps run as a pass over the written file, same as in the full build. Early in
    # the season the minutes pool is too small and it declines (sys.exit) — that is expected.
    try:
        import gen_weakness_comps as W
        W.build(season, path=OUT)
    except SystemExit as e:
        print(f"  weakness comps: skipped ({e})")
    except Exception as e:
        print(f"  weakness comps: failed ({repr(e)[:80]})")

    # Re-read and re-validate whatever the comps pass wrote, so a bad token never ships.
    safe_io.write_text(OUT, strict_json(json.load(open(OUT))))
    if ext_vals:
        XFL.write(XFL.season_path("out", season),
                  XFL.season_doc(season, ext_vals, C.WINDOWS.keys(), generated=payload["generated"], through=through))
        XFL.write(XFL.panels_path("out", season), XFL.panels_doc(season, ext_panels, generated=payload["generated"]))
        print(f"  ext stats written for {len(ext_vals)} players, panels for {len(ext_panels)}")
    q = sum(1 for p in players if p.get("qualified"))
    print(f"wrote {OUT}: {len(players)} players, {q} qualified, through {payload['through']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
