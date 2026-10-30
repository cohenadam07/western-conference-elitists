"""trim_lineups.py <public dir>: apply teams_engine's minutes floors to lineup files already built
(the first backfill ran with lower floors). Rewrites lineups/*.json in place."""
import glob, json, os, sys
import teams_engine as TE
import safe_io

pub = sys.argv[1]
for f in sorted(glob.glob(os.path.join(pub, "lineups", "*.json"))):
    d = json.load(open(f))
    if d.get("view_min") or d.get("season") == TE.C.SEASON:
        print(f"{os.path.basename(f)}: season in progress, its floors are pro-rated; left alone")
        continue
    before = os.path.getsize(f)
    for n, floor in TE.LINEUP_MIN.items():
        d["units"][str(n)] = [u for u in d["units"].get(str(n), []) if u["min"] >= floor]
    safe_io.dump_json(f, d)
    print(f"{os.path.basename(f)}: {before/1e6:.2f} -> {os.path.getsize(f)/1e6:.2f} MB, "
          f"{len(d['units']['5'])} 5-man / {len(d['units']['2'])} 2-man")
