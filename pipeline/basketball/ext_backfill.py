"""
ext_backfill.py — the Mac's one-time history pull for the October 2026 additions.

    cd ~/Basketball-Savant && PYTHONPATH=<code>:<repo>/pipeline/basketball \\
        python3 ext_backfill.py <out_dir> 2025-26 1996-97 [phases]

For each season (newest first) it makes every request in ext_fetch.fetch_season, reduces the
season's shot charts to per-player counts (ext_shots) and deletes the raw shot files (they are
100+ MB a season), then copies every table it touched into <out_dir>/tables/ (gzip, under the
engine's cache keys) with a manifest. ext_seed_push.sh commits <out_dir> to the ext-seed branch,
where the build that writes public/savant-ext/ reads it.

It stays out of the nightly tracking job's way: while ~/Basketball-Savant/logs/.publish.lock
exists it waits before each request, so the two never hit stats.nba.com at the same time.
"""
import datetime as dt
import gzip
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import savant_config as C  # noqa: E402
import savant_engine as E  # noqa: E402
import ext_fetch as F  # noqa: E402
import ext_shots as XS  # noqa: E402

out_dir = os.path.abspath(sys.argv[1])
first, last = sys.argv[2], sys.argv[3]
phases = tuple((sys.argv[4] if len(sys.argv) > 4 else "league,teams,players,games,shots").split(","))
LOCK = os.path.join("logs", ".publish.lock")

seen = {}
_call, _call_frames = E.call, E.call_frames


def _wait_for_lock():
    waited = 0
    while os.path.exists(LOCK) and waited < 3 * 3600:
        time.sleep(30)
        waited += 30


def _note(name, params, frames):
    if name == "ShotChartDetail":
        return
    s = next((v for k, v in params.items() if k in ("season", "season_nullable", "season_year")), None)
    for fr in frames:
        seen[E._key(name, params, fr)] = {"name": name, "params": params, "frame": fr, "season": s}


def call(EndpointClass, params, frame=0, use_cache=True):
    _wait_for_lock()
    df = _call(EndpointClass, params, frame, use_cache)
    _note(EndpointClass.__name__, params, [frame])
    return df


def call_frames(EndpointClass, params, frames, use_cache=True):
    _wait_for_lock()
    out = _call_frames(EndpointClass, params, frames, use_cache)
    _note(EndpointClass.__name__, params, list(frames))
    return out


E.call, E.call_frames = call, call_frames


def seasons(a, b):
    ya, yb = int(a[:4]), int(b[:4])
    step = -1 if ya >= yb else 1
    return [f"{y}-{str(y + 1)[2:]}" for y in range(ya, yb + step, step)]


def export(season):
    tdir = os.path.join(out_dir, "tables")
    os.makedirs(tdir, exist_ok=True)
    n = 0
    for key, rec in seen.items():
        if rec.get("season") not in (season, None):
            continue
        src = os.path.join(C.CACHE_DIR, key + ".json")
        dst = os.path.join(tdir, key + ".json.gz")
        if not os.path.exists(src) or os.path.exists(dst):
            continue
        with open(src, "rb") as f, gzip.open(dst, "wb") as g:
            shutil.copyfileobj(f, g)
        n += 1
    man_path = os.path.join(out_dir, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {"tables": {}, "seasons": []}
    for key, rec in seen.items():
        man["tables"][key] = {k: rec[k] for k in ("name", "params", "frame")}
    if season not in man["seasons"]:
        man["seasons"].append(season)
    man["generated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    json.dump(man, open(man_path, "w"), indent=0, sort_keys=True)
    return n


def shots(season):
    agg = {}
    for tid in F.team_ids():
        params = dict(team_id=tid, player_id=0, season_nullable=season,
                      season_type_all_star=C.SEASON_TYPE, context_measure_simple="FGA")
        df = F.shots_team(tid, season)
        XS.reduce_rows(df, agg)
        p = os.path.join(C.CACHE_DIR, E._key("ShotChartDetail", params, 0) + ".json")
        # Keep the disk light: the counts are all we need from a finished season.
        if os.path.exists(p):
            os.remove(p)
    XS.save(agg, os.path.join(out_dir, "shots", f"{season}.json"))
    return len(agg)


os.makedirs(out_dir, exist_ok=True)
print(f"=== ext backfill {first}..{last} phases={phases} ({dt.datetime.now():%Y-%m-%d %H:%M}) ===", flush=True)
for s in seasons(first, last):
    t0 = time.time()
    try:
        for win, ln in C.WINDOWS.items():          # box/adv: the possessions behind every per-75
            E.load_box(ln, s)
            E.load_adv(ln, s)
        F.fetch_season(s, phases=tuple(p for p in phases if p != "shots"),
                       log=lambda m: print(m, flush=True))
        if "shots" in phases:
            print(f"  {s} shots: {shots(s)} players", flush=True)
        print(f"  {s} exported {export(s)} tables ({time.time() - t0:.0f}s)", flush=True)
    except Exception as e:  # noqa
        print(f"  {s} FAILED: {repr(e)[:200]}", flush=True)
print("DONE", flush=True)
