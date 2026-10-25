"""
patch_modern_bars.py — inject the NEW box-derived bars into the existing modern
out/players.json without re-running the heavy full pipeline (comps/onoff/synergy stay
as-is). Purely additive: only the new metric keys are written onto each player, so no
existing bar value or feature changes.

Reads cached box/adv frames per (season, window) — no network if the modern build's
cache is present — and runs the same derive_box the historical path uses.

    python patch_modern_bars.py
"""
import json, os, sys
import savant_engine as E
import savant_config as C

OUT = os.path.join("out", "players.json")
# the bars added to derive_box in this backfill (existing keys are left untouched)
NEW_KEYS = ["efg", "pps", "tp3r", "ftr", "p3pt", "ast75", "asttov", "tov75", "reb75", "stk75", "gmsc"]

def patch():
    payload = json.load(open(OUT))
    seasons = payload["seasons"]
    for season in seasons:
        entries = {p["id"]: p for p in payload["data"][season]["players"]}
        got = 0
        for win, ln in C.WINDOWS.items():
            try:
                box = E.load_box(ln, season); adv = E.load_adv(ln, season)
            except Exception as e:
                print(f"  {season}/{win}: skipped ({repr(e)[:80]})"); continue
            derived = E.derive_box(box, adv)
            for key in NEW_KEYS:
                for pid, (v, n) in derived.get(key, {}).items():
                    p = entries.get(int(pid))
                    if p is not None:
                        p["m"].setdefault(key, {})[win] = {"v": v, "n": n}
                        got += 1
        print(f"  {season}: injected {got} new-bar cells")
    with open(OUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"patched {OUT} with {len(NEW_KEYS)} new bars across {len(seasons)} seasons")

if __name__ == "__main__":
    patch()
