"""
inject_mhunt.py — put Isolation targeting vs expected (mhunt, mhunt_faced, mhunt_exp) into the
savant-ext season files without rebuilding the other stats in them, as inject_mtchc.py does for
mtchc: every season file is laid out on the current key list, the three keys are filled from the
engine's cache (LeagueSeasonMatchups and Synergy's tables), 2023-24 and a gated season in progress
are left withheld with hunt.py's reason, and the player files, the same-age pools and
withheld.json are rebuilt.

    cd ~/Basketball-Savant && python3 <repo>/pipeline/basketball/inject_mhunt.py [--public <repo>/public]

The Mac tracking lane's job. The season in progress is rewritten nightly by refresh_current.py.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import savant_config as C  # noqa: E402
import savant_engine as E  # noqa: E402
import ext_fetch as F  # noqa: E402
import ext_files as XFL  # noqa: E402
import hunt as HU  # noqa: E402
from inject_mtchc import relayout  # noqa: E402


def inject(season, doc, players, live):
    """mhunt into one season doc (in place). Returns (defenders filled, why)."""
    if season < HU.FIRST:
        return None, {}
    key = E._key("LeagueSeasonMatchups", dict(season=season, season_type_playoffs=C.SEASON_TYPE, per_mode_simple="Totals"), 0)
    if not os.path.exists(os.path.join(C.CACHE_DIR, key + ".json")):
        return None, {}
    work = [{"id": p["id"], "pos": p.get("pos"), "qualified": p.get("qualified"), "m": {}} for p in players]
    syn = {pt: HU.synergy_poss(F.synergy(pt, "defensive", season)) for pt in F.SYN_DEF}
    n, why = HU.apply_season(season, work, E.load_matchups(season), HU.synergy_poss(F.synergy("Isolation", "offensive", season)),
                             syn["Isolation"], set().union(*[set(v) for v in syn.values()]), live=live)
    at = {k: doc["keys"].index(k) for k in HU.KEYS}
    for w in doc["players"].values():                # clear, so a rerun never keeps stale cells
        for row in w.values():
            for i in at.values():
                row[i] = None
    for p in work:
        cells = {k: (p["m"].get(k) or {}).get("season") for k in HU.KEYS}
        if not any(cells.values()):
            continue
        row = doc["players"].setdefault(str(p["id"]), {}).setdefault("season", [None] * len(XFL.KEYS))
        for k, i in at.items():
            c = cells[k]
            if c:
                row[i] = [c["v"], c["n"]] + ([c["note"]] if c.get("note") else [])
    if why:
        doc["why"] = dict(why)
    else:
        doc.pop("why", None)
    return n, why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    public = os.path.abspath(ap.parse_args().public)
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
        players = cur["data"][season]["players"] if season == live else (archive.get(season) or {}).get("players") or []
        n, why = inject(season, doc, players, season == live) if players else (None, {})
        XFL.write(path, doc)
        if n is not None or why:
            print(f"  {season}: mhunt on {n} defenders" + (f"; withheld: {next(iter(why.values()))[:90]}" if why else ""))
    print(f"  withheld.json: {XFL.write_withheld(public, live)} seasons")
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
