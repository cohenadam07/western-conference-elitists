"""
br_value_modern.py — backfill the value bars (PER/WS48/BPM/OBPM/DBPM/VORP) onto the
1996-97 → present seasons by joining Basketball Reference's Advanced table to the nba_api
players on normalized name within each season. nba_api carries none of these, so this is
purely additive; every era then shows the same BR-sourced value bars.

Matching is per-season and unique-both-sides: a BR name that maps to exactly one nba_api
player that season (and vice-versa) attaches; ambiguous or unmatched names are left null
(those bars just render n/a). Run AFTER build_gap so all 1996+ seasons exist in players.json.

    python br_value_modern.py
"""
import json, os
import br_fetch as BR
import br_crosswalk as X   # reuse the same name normalizer

OUT = os.path.join("out", "players.json")
VALUE_KEYS = ["per", "ws48", "bpm", "obpm", "dbpm", "vorp"]

def build():
    payload = json.load(open(OUT))
    attached = seasons_done = 0
    for ey in BR.MODERN_END_YEARS:
        season = BR.season_label(ey)
        sd = payload["data"].get(season)
        if not sd or not sd.get("players"):
            continue
        try:
            badv = BR.load_advanced(ey)   # {br_id: {name, per, ...}}
        except Exception as e:
            print(f"  {season}: BR advanced unavailable ({repr(e)[:70]})"); continue

        # unique normalized-name index on each side
        br_by_name = {}
        for r in badv.values():
            br_by_name.setdefault(X._norm(r["name"]), []).append(r)
        nb_by_name = {}
        for p in sd["players"]:
            nb_by_name.setdefault(X._norm(p["name"]), []).append(p)

        n = 0
        for name, brs in br_by_name.items():
            nbs = nb_by_name.get(name)
            if not nbs or len(brs) != 1 or len(nbs) != 1:
                continue   # ambiguous or unmatched -> skip
            r, p = brs[0], nbs[0]
            for k in VALUE_KEYS:
                if r.get(k) is not None:
                    p["m"].setdefault(k, {})["season"] = {"v": r[k], "n": None}
            n += 1
        attached += n; seasons_done += 1
        print(f"  {season}: attached value bars to {n}/{len(sd['players'])} players")

    import safe_io; safe_io.dump_json(OUT, payload)
    print(f"done — value bars on {attached} player-seasons across {seasons_done} modern seasons")

if __name__ == "__main__":
    build()
