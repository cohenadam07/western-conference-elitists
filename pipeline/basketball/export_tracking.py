"""
export_tracking.py — the Mac's half of the in-season refresh: the NBA tables the cloud can't reach.

    cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball \\
        python3 <repo>/pipeline/basketball/export_tracking.py <out_dir> [season]

stats.nba.com refuses cloud servers, and its tracking (drives, passing, shot defense, gravity,
matchups), Synergy play types and hustle tables have no public twin, so the cloud refresh
(cloud_refresh.py) can't build them. This runs the normal refresh on the Mac (same engine code
as the cloud, from the repo), records every one of those requests, and writes exactly those
responses to <out_dir> under the engine's own cache keys, with a manifest. publish_tracking.sh
pushes them to the tracking-data branch; the next cloud run answers those requests from it, so
everything built on them (play types, matchups, defensive role, Guardometer, weakness comps,
team play types) comes out exactly as on the Mac.

Nothing here publishes to the site: the cloud is the only writer of public/savant-current.json.
"""
import datetime as dt
import gzip
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import savant_config as C  # noqa: E402
import savant_engine as E  # noqa: E402
from espn_shim import UNAVAILABLE  # noqa: E402

out_dir = os.path.abspath(sys.argv[1])
season = sys.argv[2] if len(sys.argv) > 2 else C.SEASON
seen = {}

_call, _call_frames = E.call, E.call_frames


def _note(name, params, frames):
    if name in UNAVAILABLE and any("season" in k and v == season for k, v in params.items()):
        for fr in frames:
            seen[E._key(name, params, fr)] = {"name": name, "params": params, "frame": fr}


def call(EndpointClass, params, frame=0, use_cache=True):
    df = _call(EndpointClass, params, frame, use_cache)
    _note(EndpointClass.__name__, params, [frame])
    return df


def call_frames(EndpointClass, params, frames, use_cache=True):
    out = _call_frames(EndpointClass, params, frames, use_cache)
    _note(EndpointClass.__name__, params, list(frames))
    return out


E.call, E.call_frames = call, call_frames

import refresh_current as R  # noqa: E402

print(f"=== tracking export {season} ({dt.datetime.now():%Y-%m-%d %H:%M}) ===")
rc = R.main(season)
if rc not in (0,):
    print(f"refresh exited {rc}; nothing exported")
    sys.exit(rc)
try:
    import teams_engine as TE
    os.makedirs(os.path.join("out", "site"), exist_ok=True)
    TE.build_current(os.path.join("out", "site"), season)      # team play types
except Exception as e:  # noqa
    print(f"  teams (team play types): failed ({repr(e)[:100]})")

_, through = R.game_dates(season)
shutil.rmtree(out_dir, ignore_errors=True)
os.makedirs(out_dir)
n = 0
stale = set(s.split(" ", 1)[0] for s in E.STALE_USED)
for key, rec in seen.items():
    src = os.path.join(C.CACHE_DIR, key + ".json")
    if not os.path.exists(src):
        continue
    with open(src, "rb") as f, gzip.open(os.path.join(out_dir, key + ".json.gz"), "wb") as g:
        shutil.copyfileobj(f, g)
    n += 1
json.dump({"season": season, "through": through,
           "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "stale": sorted(stale & UNAVAILABLE),
           "tables": sorted(seen.values(), key=lambda r: (r["name"], json.dumps(r["params"], sort_keys=True), r["frame"]))},
          open(os.path.join(out_dir, "manifest.json"), "w"), indent=0)
print(f"exported {n} tables (through {through}) to {out_dir}")
