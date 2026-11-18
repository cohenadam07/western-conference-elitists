"""
inject_mtchc.py — put Matchup difficulty (creation-weighted) and its parts into the savant-ext
season files without rebuilding the other ~140 stats in them, and lay every season file out on
the current key list (ext_config.KEYS) so the player files and the page line up.

    cd ~/Basketball-Savant && python3 <repo>/pipeline/basketball/inject_mtchc.py [--public <repo>/public]

The Mac tracking lane's job, like mtch: reads the engine's matchup cache (LeagueSeasonMatchups,
the same table and weights mtch uses) from the working directory's cache/, the archive's card
values (public/savant-data.json, savant-current.json for the season in progress) and each season
file's own tracking and gravity values. A season whose matchup table is not in the cache keeps
whatever it had. Then rebuilds the player files and the same-age pools, as build_ext.py does.
The season in progress is rewritten nightly by refresh_current.py from then on.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import savant_config as C  # noqa: E402
import savant_engine as E  # noqa: E402
import ext_files as XFL  # noqa: E402
import threat as TH  # noqa: E402


def relayout(doc):
    """Rows re-ordered from the file's own key list onto XFL.KEYS, by name (new keys empty)."""
    old = doc["keys"]
    if old == XFL.KEYS:
        return doc
    at = {k: i for i, k in enumerate(old)}
    for w in doc["players"].values():
        for wn, row in w.items():
            w[wn] = [row[at[k]] if k in at else None for k in XFL.KEYS]
    doc["keys"] = list(XFL.KEYS)
    return doc


def inject(season, doc, players, team_games=None):
    """mtchc into one season doc (in place). Returns defenders filled, or None if no table."""
    key = E._key("LeagueSeasonMatchups", dict(season=season, season_type_playoffs=C.SEASON_TYPE,
                                               per_mode_simple="Totals"), 0)
    if season < TH.FIRST or not os.path.exists(os.path.join(C.CACHE_DIR, key + ".json")):
        return None
    idx = {k: doc["keys"].index(k) for k in TH.EXT_INPUTS}
    ext = {}
    for pid, w in doc["players"].items():
        r = w.get("season")
        if r:
            ext[int(pid)] = {k: (r[i][0] if r[i] else None) for k, i in idx.items()}
    work = [{"id": p["id"], "pos": p.get("pos"), "m": dict(p.get("m") or {})} for p in players]
    n = TH.apply_season(season, work, TH.pairs_of(E.load_matchups(season)), team_games=team_games,
                        windows=tuple(doc["windows"]), ext=ext)
    out = {k: doc["keys"].index(k) for k in TH.KEYS}
    for w in doc["players"].values():                    # clear, so a rerun never keeps stale cells
        for row in w.values():
            for i in out.values():
                row[i] = None
    for p in work:
        cells = {k: p["m"].get(k) for k in TH.KEYS}
        if not cells["mtchc"]:
            continue
        w = doc["players"].setdefault(str(p["id"]), {})
        for wn in doc["windows"]:
            row = w.setdefault(wn, [None] * len(XFL.KEYS))
            for k, i in out.items():
                c = cells[k][wn]
                row[i] = [c["v"], c["n"]]
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    a = ap.parse_args()
    public = os.path.abspath(a.public)
    archive = json.load(open(os.path.join(public, "savant-data.json")))["data"]
    cur = json.load(open(os.path.join(public, "savant-current.json")))
    live = (cur.get("seasons") or [None])[0]
    sdir = os.path.join(public, "savant-ext", "s")
    for fn in sorted(os.listdir(sdir)):
        if not fn.endswith(".json"):
            continue
        season = fn[:-5]
        path = os.path.join(sdir, fn)
        doc = relayout(json.load(open(path)))
        if season == live:
            players, tg = cur["data"][season]["players"], cur["qualify"][season]["team_games"]
        else:
            players, tg = (archive.get(season) or {}).get("players") or [], None
        n = inject(season, doc, players, tg) if players else None
        XFL.write(path, doc)
        print(f"  {season}: {'mtchc on ' + str(n) + ' defenders' if n is not None else 'laid out, no mtchc'}")
    import build_ext
    print(f"  player files: {build_ext.build_players(public, archive, live)}")
    idx_path = XFL.index_path(public)
    index = json.load(open(idx_path))
    index["keys"] = len(XFL.KEYS)
    XFL.write(idx_path, index)
    import age_pools
    age_pools.build(public)


if __name__ == "__main__":
    main()
