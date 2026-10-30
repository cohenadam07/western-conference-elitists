"""
build_historical.py — merge the normalized BR seasons (1979-80 → 1995-96) into the
engine's out/players.json so the front-end sees one continuous index.

Run AFTER `savant_engine.py build` (modern) and after br_fetch has cached the raw pages:
    python build_historical.py

Reads:  out/players.json (modern, nba_api), cache_br/*
Writes: out/players.json (modern + BR seasons), out/metrics_config.json (refreshed)

Canonical ids come from br_crosswalk so cross-1996 careers merge by shared person-id.
A safety pass reverts any within-season id collision (two distinct BR players resolving
to one static NBA id) back to br:<id> so no season carries duplicate ids.
"""
import json, os, sys
import br_fetch as BR
import br_normalize as N
import br_crosswalk as X
import savant_engine as E
import savant_config as C

OUT = os.path.join("out", "players.json")

def _dedupe_ids(entries):
    """Revert within-season canonical-id collisions to br:<id> (keeps ids unique per season)."""
    seen, dups = {}, set()
    for e in entries:
        if isinstance(e["id"], int):
            if e["id"] in seen:
                dups.add(e["id"])
            seen[e["id"]] = 1
    n = 0
    if dups:
        for e in entries:
            if e["id"] in dups:
                e["id"] = f"br:{e['br_id']}"; n += 1
    return n

def build():
    if not os.path.exists(OUT):
        sys.exit(f"missing {OUT} — run `python savant_engine.py build` first.")
    payload = json.load(open(OUT))
    if "data" not in payload:  # legacy single-season shape
        sys.exit("out/players.json is not multi-season — rebuild with the current engine.")

    # refresh metrics config (new bars + tier/since)
    E.write_metrics_config()

    br_seasons = []          # newest-first labels we add
    collisions = 0
    stats_tot = dict(matched=0, ambiguous=0, total=0)
    for ey in sorted(BR.BR_END_YEARS, reverse=True):    # 1996 -> 1980  == 1995-96 -> 1979-80
        season = BR.season_label(ey)
        by_brid = N.normalize_season(ey)
        entries, st = X.apply_crosswalk(by_brid)
        collisions += _dedupe_ids(entries)
        for k in stats_tot: stats_tot[k] += st[k]
        payload["data"][season] = {"players": entries}
        br_seasons.append(season)

    # seasons list: modern (unchanged order) then BR newest-first. (1996-2010 gap filled later.)
    modern = [s for s in payload["seasons"]]
    payload["seasons"] = modern + [s for s in br_seasons if s not in modern]
    payload["source"] = "nba_api+br"

    with open(OUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    total = sum(len(v["players"]) for v in payload["data"].values())
    print(f"merged BR: {stats_tot['total']} historical player-seasons "
          f"({stats_tot['matched']} matched to NBA ids, {stats_tot['ambiguous']} br-only, "
          f"{collisions} collision reverts)")
    print(f"wrote {OUT}: {total} player-season rows across {len(payload['seasons'])} seasons "
          f"({payload['seasons'][0]} … {payload['seasons'][-1]})")

if __name__ == "__main__":
    build()
