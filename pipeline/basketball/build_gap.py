"""
build_gap.py — fill the 1996-97 → 2010-11 window via the existing nba_api pipeline and
merge it into out/players.json, so the index is continuous 1979-80 → present.

These seasons run through the SAME build_one_season() the modern seasons use (so the new
box bars are included); era-gated tracking/hustle/etc. simply come back null and grey out.
Value bars (PER/WS48/BPM/VORP) are NOT in nba_api — br_value_modern.py backfills those for
all 1996+ seasons afterward by joining BR advanced on name+season.

Long, network-bound (home network): each new player triggers a cached CommonPlayerInfo call.
Idempotent — merges these seasons into whatever is already in players.json (modern + BR).

    python build_gap.py
"""
import json, os, time, subprocess
import savant_engine as E

OUT = os.path.join("out", "players.json")
GAP_SEASONS = [f"{y}-{str(y+1)[2:]}" for y in range(2010, 1995, -1)]  # 2010-11 .. 1996-97

def build():
    payload = json.load(open(OUT))
    for season in GAP_SEASONS:
        if season in payload["data"] and payload["data"][season].get("players"):
            print(f"  {season}: already present ({len(payload['data'][season]['players'])}), skipping")
            continue
        print(f"--- {season} ---", flush=True)
        players, unavail = E.build_one_season(season)
        payload["data"][season] = {"players": players}
        print(f"  {season}: {len(players)} players; null: {sorted(unavail)}", flush=True)
        # checkpoint after each season so a mid-run stop doesn't lose work
        _write(payload)
    _write(payload)
    total = sum(len(v["players"]) for v in payload["data"].values())
    print(f"done — {total} rows across {len(payload['seasons'])} seasons")

def _write(payload):
    # keep seasons ordered newest-first by start year (modern, gap, BR all interleave correctly)
    payload["seasons"] = sorted(payload["data"].keys(), key=lambda s: int(s[:4]), reverse=True)
    payload["source"] = "nba_api+br"
    # Atomic write with retry: this dir is iCloud-synced and 40MB writes intermittently time
    # out (Errno 60) when the `bird` daemon is syncing. Write a temp file then os.replace
    # (atomic — never leaves a truncated players.json), and free the daemon between retries.
    body = json.dumps(payload, separators=(",", ":"))
    tmp = OUT + ".tmp"
    for attempt in range(5):
        try:
            with open(tmp, "w") as fh:
                fh.write(body)
            os.replace(tmp, OUT)
            return
        except OSError as e:
            print(f"    write failed ({e}); freeing iCloud daemon, retry {attempt+1}/5", flush=True)
            subprocess.run(["killall", "bird"], stderr=subprocess.DEVNULL)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"could not write {OUT} after retries")

if __name__ == "__main__":
    build()
