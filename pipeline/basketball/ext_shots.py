"""
ext_shots.py — every field-goal attempt reduced to per-player counts by zone and by shot type.

Input is the NBA's ShotChartDetail rows (one team-season at a time): from stats.nba.com on the
Mac, or rebuilt from ESPN's play-by-play in the cloud (espn_shim.b_ShotChartDetail, which maps
ESPN's shot types onto the NBA's ACTION_TYPE spelling). Output is a small count table, so the
raw shot files (100+ MB a season) can be thrown away once a season is reduced.

    {pid: {"z": {zone: [fga, fgm]}, "a": {family: [fga, fgm]}, "d": total distance, "n": fga}}

Zones are the NBA's SHOT_ZONE_BASIC; families are read off ACTION_TYPE (a "Driving Floating
Bank Jump Shot" counts as a floater; a "Putback Dunk Shot" as a dunk and as a putback).
"""
import json
import os

ZONES = {
    "Restricted Area": "ra", "In The Paint (Non-RA)": "pnt", "Mid-Range": "mid",
    "Left Corner 3": "c3", "Right Corner 3": "c3", "Above the Break 3": "ab3", "Backcourt": "bc",
}

# family -> test on the lower-cased ACTION_TYPE. A shot can belong to several families.
FAMILIES = [
    ("dunk", lambda a: "dunk" in a),
    ("layup", lambda a: "layup" in a or "finger roll" in a),
    ("floater", lambda a: "float" in a),
    ("hook", lambda a: "hook" in a),
    ("stepback", lambda a: "step back" in a or "stepback" in a),
    ("fadeaway", lambda a: "fade" in a),
    ("turnaround", lambda a: "turnaround" in a),
    ("pullup", lambda a: "pull" in a),
    ("alleyoop", lambda a: "alley oop" in a or "alley-oop" in a),
    ("putback", lambda a: "putback" in a or "tip" in a),
    ("cutting", lambda a: "cutting" in a),
    ("driving", lambda a: "driving" in a),
]


def reduce_rows(df, into=None):
    """Add one ShotChartDetail frame's attempts into `into` (a dict keyed by player id)."""
    out = into if into is not None else {}
    if df is None or not len(df):
        return out
    cols = set(df.columns)
    for r in df.itertuples(index=False):
        rd = r._asdict()
        if "SHOT_ATTEMPTED_FLAG" in cols and not int(rd.get("SHOT_ATTEMPTED_FLAG") or 0):
            continue
        pid = int(rd["PLAYER_ID"])
        made = 1 if int(rd.get("SHOT_MADE_FLAG") or 0) else 0
        zone = ZONES.get(str(rd.get("SHOT_ZONE_BASIC") or ""), None)
        act = str(rd.get("ACTION_TYPE") or "").lower()
        dist = float(rd.get("SHOT_DISTANCE") or 0)
        p = out.setdefault(pid, {"z": {}, "a": {}, "d": 0.0, "n": 0})
        p["n"] += 1
        p["d"] += dist
        if zone:
            z = p["z"].setdefault(zone, [0, 0])
            z[0] += 1
            z[1] += made
        for fam, test in FAMILIES:
            if test(act):
                a = p["a"].setdefault(fam, [0, 0])
                a[0] += 1
                a[1] += made
    return out


def save(agg, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({str(k): v for k, v in agg.items()}, f, separators=(",", ":"))


def load(path):
    if not os.path.exists(path):
        return None
    return {int(k): v for k, v in json.load(open(path)).items()}
