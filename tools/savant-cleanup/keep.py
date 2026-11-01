"""br_keep.py and position_labels.py's fallback chain, on made-up rows. Run by check.mjs."""
import copy
import gzip
import json
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline", "basketball"))
import br_keep as K  # noqa: E402
import position_labels as PL  # noqa: E402

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

# the rule's edges: where the minutes are, and how he plays
assert PL.classify([0, 0, 0, 86, 12], "Wing", 0.93) == "Big"     # Giannis, 2020-21
assert PL.classify([0, 0, 0, 96, 4], "Big", 0.34) == "Wing"      # a Randle: PF + C 100, plays like a wing
assert PL.classify([0, 0, 11, 81, 8], "Guard", 0.09) == "Wing"   # DeRozan, 2021-22
assert PL.classify([0, 0, 0, 60, 40], "Wing", 0.10) == "Big"     # a third at center stands alone
assert PL.classify([0, 12, 64, 24, 0], "Guard", 0.9) == "Wing"   # not at the 4-5, whatever the score
assert PL.classify([60, 30, 0, 5, 5], "Big", 0.9) == "Guard"
assert PL.classify([0, 0, 10, 80, 10], "Big") == "Big" and PL.classify([0, 0, 10, 80, 10], "Wing") == "Wing"   # no score

# the score: 0 is the average wing, 1 the average big, and a missing stat is left out
refs = dict(reb75=[6.0, 10.0], tp3r=[40.0, 10.0])
assert abs(PL.raw_score(dict(reb75=10.0, tp3r=10.0), refs) - 1) < 1e-9
assert abs(PL.raw_score(dict(reb75=6.0, tp3r=40.0), refs)) < 1e-9
assert abs(PL.raw_score(dict(reb75=8.0), refs) - 0.5) < 1e-9
assert PL.raw_score({}, refs) is None

# pooling to 400 minutes, with the draft position for what a rookie doesn't have yet
assert abs(PL.pooled_score({"2026-27": [0.41, 187.0]}, "2026-27", "Big") - (0.41 * 187 + 213) / 400) < 1e-9
assert abs(PL.pooled_score({"2026-27": [0.41, 187.0]}, "2026-27", None) - 0.41) < 1e-9
assert abs(PL.pooled_score({"2026-27": [0.2, 100.0], "2025-26": [0.8, 900.0]}, "2026-27") - (0.2 * 100 + 0.8 * 300) / 400) < 1e-9
assert PL.pooled_score({"2026-27": [None, 100.0]}, "2026-27") is None

# one man's shares from what four known men leave open: a center beside four others
mates = {2: [100, 0, 0, 0, 0], 3: [0, 100, 0, 0, 0], 4: [0, 0, 100, 0, 0], 5: [0, 0, 0, 100, 0]}
doc = dict(players=[[1, "A"], [2, "B"], [3, "C"], [4, "D"], [5, "E"]], units=[[[0, 1, 2, 3, 4], 3600, [], [], []]], games=[])
pe, sec = PL.stint_estimate(doc, 1, mates)
assert sec == 3600 and [round(x) for x in pe] == [0, 0, 0, 0, 100]
assert PL.stint_estimate(dict(doc, units=[[[0, 1, 2, 3, 4], 60, [], [], []]]), 1, mates) is None      # too little
assert PL.stint_estimate(doc, 1, {2: mates[2]}) is None                                               # unknown teammates

# the chain: stints, then Draft Savant, then the listed label
with gzip.open(f"{tmp}/bcs/ww/AAA-{SEASON}.json.gz", "wt") as fh:
    json.dump(doc, fh)
json.dump({"players": [{"name": "Rook Draft", "pos": "Big", "draft_year": "2026"}, {"name": "Old Draft", "pos": "Big", "draft_year": "2015"}]},
          open(f"{tmp}/data.json", "w"))
rows = [{"id": 1, "name": "A", "team": "AAA", "pos": "Wing"}, {"id": 9, "name": "Rook Draft", "team": "BBB", "pos": "Wing"},
        {"id": 8, "name": "Nobody", "team": "BBB", "pos": "Guard"}, {"id": 7, "name": "Old Draft", "team": "BBB", "pos": "Guard"}]
tally = PL.apply_fallbacks(SEASON, rows, mates, tmp)
assert tally == dict(stints=1, draft=1, listed=2), tally
assert rows[0]["pos"] == "Big" and rows[0]["posx"]["src"] == "stints" and rows[0]["pos0"] == "Wing"
assert rows[1]["pos"] == "Big" and rows[1]["pos_src"] == "draft"
assert rows[2]["pos"] == "Guard" and rows[3]["pos"] == "Guard"
print("ok")
