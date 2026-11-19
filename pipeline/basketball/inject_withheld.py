"""
inject_withheld.py — bring the published savant-ext files in line with the withheld rule
without rebuilding any stat:

  1. a column the NBA publishes as zero for everyone (ext_config.WITHHELD_WHY keys whose season
     values are all exactly 0: swr, from switchesOn) is blanked in that season's file;
  2. every season file is rewritten through ext_files.write, which stamps "withheld"
     ({key: reason} for the stats nobody has a value for in a season they should exist);
  3. the player files and the same-age pools are rebuilt from the season files, as build_ext.py
     and inject_mtchc.py do.

    python3 pipeline/basketball/inject_withheld.py [--public <repo>/public]

From then on ext_engine leaves swr out at compute time while switchesOn is all zero, and every
writer stamps "withheld", so the nightly refresh keeps the season in progress right by itself.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ext_config as XC  # noqa: E402
import ext_files as XFL  # noqa: E402


def blank_zero_columns(doc):
    """Blank WITHHELD_WHY columns whose every season-window value is 0. Returns the keys blanked."""
    out = []
    for k in XC.WITHHELD_WHY:
        if k not in doc["keys"]:
            continue
        i = doc["keys"].index(k)
        vals = [w["season"][i][0] for w in doc["players"].values() if w.get("season") and w["season"][i]]
        if vals and all(v == 0 for v in vals):
            for w in doc["players"].values():
                for row in w.values():
                    row[i] = None
            out.append(k)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    public = os.path.abspath(ap.parse_args().public)
    archive = json.load(open(os.path.join(public, "savant-data.json")))["data"]
    cur = json.load(open(os.path.join(public, "savant-current.json")))
    live = (cur.get("seasons") or [None])[0]
    sdir = os.path.join(public, "savant-ext", "s")
    for fn in sorted(os.listdir(sdir)):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(sdir, fn)
        doc = json.load(open(path))
        blanked = blank_zero_columns(doc)
        XFL.write(path, doc)
        print(f"  {fn[:-5]}: blanked {blanked or 'nothing'}; withheld {sorted(doc['withheld'])}")
    print(f"  withheld.json: {XFL.write_withheld(public, live)} seasons with a withheld stat")
    import build_ext
    print(f"  player files: {build_ext.build_players(public, archive, live)}")
    import age_pools
    age_pools.build(public)


if __name__ == "__main__":
    main()
