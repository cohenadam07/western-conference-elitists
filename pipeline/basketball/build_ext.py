"""
build_ext.py — the October 2026 additions for finished seasons: public/savant-ext/ (see
ext_files.py for the files).

    python3 build_ext.py --public ../../public --seed <ext-seed checkout> [--seasons 2024-25,2023-24]

Reads, per season, whatever exists and builds what it can from it:
  <seed>/tables/        the NBA's tables the Mac pulled (ext_backfill.py; branch ext-seed)
  <seed>/shots/         every field-goal attempt, reduced to per-player counts (ext_shots)
  seed/ext-pbp/         ESPN play-by-play counts (espn_history.py), in this repo
  seed/ext-br/          Basketball Reference's play-by-play table (br_ext.py), in this repo
and the season's players from public/savant-data.json (the same rows, ids and positions the
card shows). Per-75 stats divide by the possessions behind the card's own per-75 bars (the
archive's points-per-75 sample), so every /75 number on a card shares one denominator.

No network: a table missing from the seed costs the stats built from it, never the season. The
season in progress is not built here; refresh_current.py writes it after every slate. Player
files (p/<pid>.json) are rebuilt from every season file on disk, so building one season keeps
everyone's career files whole. The ext-build workflow runs this whenever the Mac adds a season
to ext-seed, which is how the history fills in without anyone at a keyboard.
"""
import argparse
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import savant_engine as E  # noqa: E402
import espn_shim as SH  # noqa: E402
import ext_engine as XE  # noqa: E402
import ext_fetch as XF  # noqa: E402
import ext_files as XFL  # noqa: E402
import ext_shots as XS  # noqa: E402

REPO_SEED = os.path.join(HERE, "seed")


class NotInSeed(LookupError):
    pass


def install_seed(tables_dir):
    """E.call / E.call_frames answer from the Mac's exported tables, and only from them."""
    def call(EndpointClass, params, frame=0, use_cache=True):
        df = SH.read_seed_key(tables_dir, E._key(EndpointClass.__name__, params, frame)) if tables_dir else None
        if df is None:
            raise NotInSeed(EndpointClass.__name__)
        return df

    def call_frames(EndpointClass, params, frames, use_cache=True):
        return {fr: call(EndpointClass, params, fr) for fr in frames}

    E.call, E.call_frames = call, call_frames


def _load_json(path):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return None


def build_season(season, archive_players, seed, public, log=print):
    rows = [p for p in archive_players if isinstance(p.get("id"), int)]
    players = [{"id": p["id"], "m": {}} for p in rows]
    poss = {p["id"]: (p["m"].get("pts", {}).get("season") or {}).get("n") for p in rows}
    poss = {k: float(v) for k, v in poss.items() if v}

    def poss_map(ln, s):
        return poss if (ln is None and s == season) else {}
    XE._poss_map = poss_map

    shots = XS.load(os.path.join(seed, "shots", f"{season}.json")) if seed else None
    pbp = _load_json(os.path.join(REPO_SEED, "ext-pbp", f"{season}.json"))
    br = _load_json(os.path.join(REPO_SEED, "ext-br", f"{season}.json"))
    pbp = {int(k): v for k, v in pbp.items()} if pbp else None
    br = {int(k): v for k, v in br.items()} if br else None
    if shots:
        shots = {int(k): v for k, v in shots.items()}

    del XF.MISSES[:]
    got = XE.apply_all(season, players, live=False, shots_agg=shots, pbp_counts=pbp, br_rows=br,
                       log=lambda *_: None)
    vals, panels = XFL.split(players)
    doc = XFL.season_doc(season, vals, ["season"])
    XFL.write(XFL.season_path(public, season), doc)
    XFL.write(XFL.panels_path(public, season), XFL.panels_doc(season, panels))
    filled = defaultdict(int)
    for w in doc["players"].values():
        for i, c in enumerate(w["season"]):
            if c is not None:
                filled[XFL.KEYS[i]] += 1
    info = {"built": XFL.now(), "players": len(doc["players"]), "stats": len(filled),
            "panels": sorted({k for pan in panels.values() for k in pan}),
            "sources": {k: v for k, v in got.items()}}
    log(f"  {season}: {len(doc['players'])} players, {len(filled)}/{len(XFL.KEYS)} stats, "
        f"panels {info['panels']}  {got}")
    return info


def build_players(public, archive, live_season):
    """p/<pid>.json from every finished season's file on disk."""
    by_pid = defaultdict(dict)
    sdir = os.path.join(public, "savant-ext", "s")
    for fn in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        season = fn[:-5]
        if not fn.endswith(".json") or season == live_season:
            continue
        doc = _load_json(os.path.join(sdir, fn))
        sp = archive.get(season, {}).get("players", [])
        if not doc or not sp:
            continue
        if doc.get("keys") != XFL.KEYS:
            print(f"  {season}: built with another stat list, skipped (rebuild it)")
            continue
        for pid, r in XFL.ranked(sp, doc).items():
            by_pid[pid][season] = r
    pdir = os.path.join(public, "savant-ext", "p")
    os.makedirs(pdir, exist_ok=True)
    keep = set()
    for pid, seasons in by_pid.items():
        XFL.write(XFL.player_path(public, pid), {"schema": XFL.SCHEMA, "id": pid, "keys": XFL.KEYS,
                                                 "seasons": dict(sorted(seasons.items(), reverse=True))})
        keep.add(f"{pid}.json")
    for fn in os.listdir(pdir):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(pdir, fn))
    return len(by_pid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--seed", default=None, help="ext-seed checkout (tables/, shots/, manifest.json)")
    ap.add_argument("--seasons", default="all",
                    help="comma list, 'all' (every season with any source) or 'changed' (what the seed added)")
    ap.add_argument("--players-only", action="store_true")
    a = ap.parse_args()
    public = os.path.abspath(a.public)
    t0 = time.time()
    archive = json.load(open(os.path.join(public, "savant-data.json")))
    cur = _load_json(os.path.join(public, "savant-current.json")) or {}
    live = (cur.get("seasons") or [None])[0]
    tables = os.path.join(a.seed, "tables") if a.seed and os.path.isdir(os.path.join(a.seed, "tables")) else None
    install_seed(tables)
    man = _load_json(os.path.join(a.seed, "manifest.json")) if a.seed else None

    idx_path = XFL.index_path(public)
    index = _load_json(idx_path) or {"schema": XFL.SCHEMA, "seasons": {}}
    seed_count = defaultdict(int)          # tables the seed holds per season (what "changed" compares)
    for rec in (man or {}).get("tables", {}).values():
        sv = next((v for k, v in (rec.get("params") or {}).items()
                   if k in ("season", "season_nullable", "season_year")), None)
        if sv:
            seed_count[sv] += 1
    shots_dir = os.path.join(a.seed or "", "shots")
    if not a.players_only:
        if a.seasons == "changed":
            # The ext-build workflow: only seasons the Mac has added to (or first added) since
            # the last build, judged by the seed's table count and shot file for that season.
            seasons = []
            for s in (man or {}).get("seasons", []):
                had = index["seasons"].get(s, {})
                shots_now = os.path.exists(os.path.join(shots_dir, f"{s}.json"))
                if had.get("seed_tables") != seed_count.get(s, 0) or bool(had.get("seed_shots")) != shots_now:
                    seasons.append(s)
        elif a.seasons == "all":
            have = set()
            for d in (os.path.join(REPO_SEED, "ext-pbp"), os.path.join(REPO_SEED, "ext-br"),
                      os.path.join(a.seed or "", "shots")):
                if os.path.isdir(d):
                    have |= {f[:-5] for f in os.listdir(d) if f.endswith(".json")}
            have |= set((man or {}).get("seasons", []))
            seasons = [s for s in archive["seasons"] if s in have]
        else:
            seasons = a.seasons.split(",")
        seasons = [s for s in seasons if s != live and s in archive["data"]]
        print(f"=== savant-ext: {len(seasons)} season(s), seed {'tables' if tables else 'none'} ===")
        for s in seasons:
            info = build_season(s, archive["data"][s]["players"], a.seed, public)
            info["seed_tables"] = seed_count.get(s, 0)
            info["seed_shots"] = os.path.exists(os.path.join(shots_dir, f"{s}.json"))
            index["seasons"][s] = info
        if not seasons:
            print("  nothing new in the seed")
    n = build_players(public, archive["data"], live)
    index["generated"] = XFL.now()
    index["keys"] = len(XFL.KEYS)
    index["seasons"] = dict(sorted(index["seasons"].items(), reverse=True))
    XFL.write(idx_path, index)
    print(f"  player files: {n}; done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
