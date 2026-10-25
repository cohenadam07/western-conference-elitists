"""
record_tables.py — replay the in-season refresh from the Mac's disk cache only, and export every
table it reads. Used once, to build the reference set the cloud (ESPN) port is checked against,
and to list the prior-season tables the cloud run needs shipped as a seed.

    python3 record_tables.py <season> <export_dir> [--all]

Runs in a scratch copy: no network call is made (every request is served from cache/, or
returns an empty table and is logged as MISSING), nothing in cache/ or out/ is written.
"""
import json, os, shutil, sys, hashlib
import pandas as pd

season, export = sys.argv[1], os.path.abspath(sys.argv[2])
os.makedirs(os.path.join(export, "tables"), exist_ok=True)

import savant_config as C
import savant_engine as E

SRC_CACHE = os.environ.get("SRC_CACHE", os.path.expanduser("~/Basketball-Savant/cache"))
index = []


def _serve(name, params, frames):
    out = {}
    for fr in frames:
        key = E._key(name, params, fr)
        src = os.path.join(SRC_CACHE, key + ".json")
        fresh = any("season" in k and v == season for k, v in params.items())
        rec = {"name": name, "params": params, "frame": fr, "key": key, "fresh": fresh,
               "found": os.path.exists(src)}
        if rec["found"]:
            shutil.copy(src, os.path.join(export, "tables", key + ".json"))
            out[fr] = pd.read_json(src)
        else:
            out[fr] = pd.DataFrame()
        index.append(rec)
    return out


def call(EndpointClass, params, frame=0, use_cache=True):
    return _serve(EndpointClass.__name__, params, [frame])[frame]


def call_frames(EndpointClass, params, frames, use_cache=True):
    return _serve(EndpointClass.__name__, params, frames)


E.call, E.call_frames = call, call_frames

# Run from a scratch working directory (see the shell wrapper): out/ there holds copies of the
# small inputs, so the live ~/Basketball-Savant/out is never written.
import refresh_current as R
mode = sys.argv[3] if len(sys.argv) > 3 else "refresh"
if mode == "refresh":
    try:
        rc = R.main(season)
    except SystemExit as e:
        rc = e.code
    print("refresh rc:", rc)
elif mode == "projections":
    import projections as P
    E.FRESH_SEASON = season
    P.build()
elif mode == "teams":
    import teams_engine as T
    E.FRESH_SEASON = season
    os.makedirs("out/site", exist_ok=True)
    T.build_current("out/site", season)

json.dump(index, open(os.path.join(export, f"index-{mode}.json"), "w"), indent=0)
miss = [r for r in index if not r["found"]]
print(f"{len(index)} table reads, {len(miss)} missing from cache")
for r in miss[:40]:
    print("  MISSING", r["name"], json.dumps(r["params"], sort_keys=True))
