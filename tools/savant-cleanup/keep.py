"""br_keep.py on made-up rows. Run by check.mjs."""
import copy
import json
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
import br_keep as K  # noqa: E402

SEASON = "2026-27"
tmp = tempfile.mkdtemp()
for d in ("savant-ext/s", "savant-ext/panels", "bcs/ww"):
    os.makedirs(os.path.join(tmp, d))
old = {"id": 1, "name": "A", "team": "AAA", "pos": "Wing",
       "m": {"bpm": {"season": {"v": 2.5, "n": None}}, "vorp": {"season": {"v": .1, "n": None}}, "minshare": {"season": {"v": 20, "n": 100}}}}
json.dump({"seasons": [SEASON], "generated": "then", "data": {SEASON: {"players": [old]}}}, open(f"{tmp}/savant-current.json", "w"))
json.dump({"keys": ["offd75", "blka", "pga75", "x"], "players": {"1": {"season": [[1.0, 9], [2.0, 9], [3.0, 9], [4.0, 9]]}}},
          open(f"{tmp}/savant-ext/s/{SEASON}.json", "w"))
json.dump({"players": {"1": {"pe": [0, 0, 0, 0, 100]}}}, open(f"{tmp}/savant-ext/panels/{SEASON}.json", "w"))

# a run with nothing from Basketball Reference
last = K.last_good(SEASON, tmp)
row = copy.deepcopy(old)
row["m"] = {"minshare": old["m"]["minshare"]}
assert K.keep_value_bars([row], last) == 1
assert row["m"]["bpm"]["season"]["v"] == 2.5
kept, stats, missing = K.keep_br_stats([row], last)
assert (kept, stats, missing) == (1, 1, True)
assert row["pe"] == [0, 0, 0, 0, 100]
assert row["m"]["offd75"]["season"] == {"v": 1.0, "n": 9} and "x" not in row["m"]

# a good run keeps its own numbers, and a player missing from a good table gets no old counts
fresh = copy.deepcopy(old)
fresh["m"]["bpm"]["season"]["v"] = 9.0
fresh["pe"] = [0, 0, 0, 50, 50]
gone = {"id": 1, "m": {}}
assert K.keep_value_bars([fresh], last) == 0 and fresh["m"]["bpm"]["season"]["v"] == 9.0
kept, stats, missing = K.keep_br_stats([fresh, gone], last)
assert (kept, stats, missing) == (1, 0, False) and fresh["pe"] == [0, 0, 0, 50, 50] and "offd75" not in gone["m"]

# another season's file is not a last good run
assert K.last_good("2027-28", tmp)["current"] == {}

print("ok")
