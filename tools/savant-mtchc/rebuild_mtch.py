"""
rebuild_mtch.py — rebuild mtch and oppfg for finished seasons whose LeagueSeasonMatchups the NBA
has revised since the archive was built, with the engine's own code (savant_engine.matchup_stats)
on the Mac's current cached table, so mtch and mtchc stand on the same data.

    python3 tools/savant-mtchc/rebuild_mtch.py --check 2023-24      # an unrevised season: must match exactly
    python3 tools/savant-mtchc/rebuild_mtch.py 2024-25 2025-26      # rewrite mtch in public/savant-data.json
    python3 tools/savant-mtchc/rebuild_mtch.py --keys mtch,oppfg 2024-25 2025-26   # oppfg too

Only mtch is rewritten by default (Adam's 6c). oppfg comes from the same table and the same
function, but the NBA's revision moves it far more (shots defended down ~11%; 2024-25 and
2025-26 oppfg rankings Spearman 0.85-0.86 against the published), so rewriting it is its own call.

Reads the engine's disk cache (~/Basketball-Savant/cache, the same LeagueSeasonMatchups and
LeagueDashPlayerStats requests the build made); no network. Prints how far published mtch moves.
"""
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
import savant_config as C  # noqa: E402
C.CACHE_DIR = os.path.expanduser("~/Basketball-Savant/cache")
import savant_engine as E  # noqa: E402

DATA = os.path.join(ROOT, "public", "savant-data.json")


def compute(season):
    if not os.path.exists(os.path.join(C.CACHE_DIR, E._key("LeagueSeasonMatchups", dict(
            season=season, season_type_playoffs=C.SEASON_TYPE, per_mode_simple="Totals"), 0) + ".json")):
        sys.exit(f"{season}: no cached matchup table; refusing to fetch")
    return E.matchup_stats(E.load_matchups(season), E.load_box(C.WINDOWS["season"], season))


def main():
    args = sys.argv[1:]
    keys = ("mtch",)
    if args and args[0] == "--keys":
        keys, args = tuple(args[1].split(",")), args[2:]
    check = args and args[0] == "--check"
    seasons = args[1:] if check else args
    d = json.load(open(DATA))
    for s in seasons:
        new = compute(s)
        P = d["data"][s]["players"]
        moved = {k: [] for k in ("mtch", "oppfg")}
        same = {k: 0 for k in moved}
        for p in P:
            for k in moved:
                old = ((p["m"].get(k) or {}).get("season") or {})
                nv = new.get(p["id"], {}).get(k)
                if old.get("v") is None and nv is None:
                    continue
                if nv is not None and old.get("v") == nv[0] and old.get("n") == nv[1]:
                    same[k] += 1
                moved[k].append((p, old.get("v"), old.get("n"), nv))
                if not check and k in keys:
                    if nv is None:
                        p["m"].pop(k, None)
                    else:
                        p["m"][k] = {w: {"v": nv[0], "n": nv[1]} for w in C.WINDOWS}
        for k, rows in moved.items():
            both = [(o, nv[0], on, nv[1], p) for p, o, on, nv in rows if o is not None and nv is not None]
            dv = [abs(a - b) for a, b, *_ in both]
            dn = [b / a - 1 for _, _, a, b, _ in both if a]
            q = [x for x in both if x[4].get("qualified")]
            print(f"{s} {k}: {len(rows)} players, {same[k]} unchanged; |change| mean {statistics.fmean(dv):.2f}, "
                  f"max {max(dv):.1f}; sample change median {statistics.median(dn):+.1%}; "
                  f"only before {sum(1 for _, o, _, nv in rows if nv is None)}, only after {sum(1 for _, o, _, nv in rows if o is None)}"
                  + (f"; qualified n={len(q)}" if q else ""))
            if q:
                import pandas as pd
                x = pd.DataFrame([(a, b) for a, b, *_ in q])
                big = sorted(q, key=lambda t: -abs(t[0] - t[1]))[:3]
                print(f"    qualified rank Spearman {x[0].corr(x[1], method='spearman'):.3f}; largest: "
                      + ", ".join(f"{t[4]['name']} {t[0]} -> {t[1]}" for t in big))
    if not check:
        open(DATA, "w").write(json.dumps(d, separators=(",", ":")))
        print("wrote", DATA)


if __name__ == "__main__":
    main()
