"""
synergy_ids.py — Synergy rows filed under a player id the NBA's own tables don't know.

The NBA's Synergy feed occasionally files a player under an id that is not his NBA person id
(Milos Teodosic as 267634 in 2017-18 and 2018-19, Mike James as 2229 in 2020-21; found Nov 2026),
so his play types, his Shot-making bar and his defensive play types never reach his card. fix()
maps every such id to the NBA id whose name matches it, if exactly one does, using the season's
own NBA player list (LeagueDashPlayerStats, the box the engine already loads). Ids the NBA list
knows are never touched, and an ambiguous or missing name leaves the row as it was.

Applied where Synergy rows are read: savant_engine.load_synergy (Shot-making), extras_engine
.apply_playtypes (the play-type panel) and ext_fetch.synergy (the defensive play-type panel).

Players the Synergy feed leaves out entirely (Cedi Osman and Thaddeus Young, 2017-18 to 2021-22,
and others) are not an id problem and cannot be fixed here: see ext_files.NOT_IN_SYNERGY.
"""
import unicodedata

REMAPPED = []          # (season, synergy id, nba id, name), for the run's log
_ROSTERS = {}


def norm(name):
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    return " ".join(s.replace(".", "").replace("'", "").replace("-", " ").split())


def _roster(season):
    if season not in _ROSTERS:
        import savant_engine as E
        try:
            box = E.load_box(None, season)
            _ROSTERS[season] = {int(i): norm(n) for i, n in zip(box.index, box["name"])}
        except Exception:  # noqa: no roster, no remap
            _ROSTERS[season] = {}
    return _ROSTERS[season]


NIS_MIN = 500          # minutes: anyone with this much time clears Synergy's 10-possession floor somewhere


def _minutes(p):
    c = ((p.get("m") or {}).get("minshare") or {}).get("season") or {}
    return c.get("n") or 0


def not_in_synergy(season, players):
    """Ids of players with NIS_MIN+ minutes who are in none of the season's Synergy tables
    (offense and defense, every play type, ids already fixed): the NBA's feed left them out, so
    their play-type panels and Shot-making are blank for that reason (Cedi Osman and Thaddeus
    Young, 2017-18 to 2021-22, and others; checked against the live feed, Nov 2026)."""
    import ext_fetch as F
    if not F.has("syn", season):
        return set()
    seen, tables = set(), 0
    for grp, pts in (("defensive", F.SYN_DEF), ("offensive", F.SYN_OFF)):
        for pt in pts:
            t = F.synergy(pt, grp, season)
            if len(t):
                tables += 1
                seen.update(int(x) for x in t["PLAYER_ID"])
    if tables < 10:                       # the tables didn't load: say nothing rather than everyone
        return set()
    return {int(p["id"]) for p in players if _minutes(p) >= NIS_MIN and int(p["id"]) not in seen}


def fix(df, season):
    """df with unknown PLAYER_IDs replaced by the uniquely name-matching NBA id."""
    if df is None or not len(df) or "PLAYER_ID" not in df.columns or "PLAYER_NAME" not in df.columns:
        return df
    known = _roster(season)
    if not known:
        return df
    ids = [int(x) for x in df["PLAYER_ID"]]
    unknown = {i for i in ids if i not in known}
    if not unknown:
        return df
    by_name = {}
    for i, n in known.items():
        by_name.setdefault(n, []).append(i)
    remap = {}
    for pid, name in zip(ids, df["PLAYER_NAME"]):
        if pid in unknown and pid not in remap:
            hit = by_name.get(norm(name)) or []
            if len(hit) == 1:
                remap[pid] = hit[0]
                if (season, pid) not in {(a, b) for a, b, _, _ in REMAPPED}:
                    REMAPPED.append((season, pid, hit[0], name))
    if not remap:
        return df
    df = df.copy()
    df["PLAYER_ID"] = [remap.get(i, i) for i in ids]
    return df
