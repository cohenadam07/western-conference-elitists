"""
build_extras.py — add the October 2026 card stats to every season of an archive file.

    python build_extras.py <path/to/savant-data.json> [--only scoring,onoffadj,playtypes,xfg,ww] [--from 2017-18]

Works on the site's published archive in place (strict JSON out, NaN never written), so the
live file and what this adds stay one thing. Seasons each pass applies to:

    scoring   uast, uast3, ppaint        1996-97 on
    onoffadj  luck-adjusted on/off       1996-97 on   (~60 calls a season, cached)
    playtypes play-type panel            2015-16 on
    xfg       xefg, shotmk               2013-14 on   (needs out/xfg_model.joblib: python xfg_model.py train)
    ww        with/without panel         the newest season only (the card shows it for the latest)

Checkpoints after every season, so an interrupted run loses at most one season.
"""
import json, os, re, sys, time
import extras_engine as X

PASSES = ["scoring", "onoffadj", "playtypes", "xfg", "ww"]


def strict_dump(path, obj):
    s = json.dumps(obj, separators=(",", ":"))
    s = re.sub(r"-?Infinity", "null", re.sub(r"\bNaN\b", "null", s))
    json.loads(s)
    import safe_io
    safe_io.write_text(path, s)


def main(path, only, start=None):
    d = json.load(open(path))
    model = None
    if "xfg" in only:
        import xfg_model
        model = xfg_model.load_model()
    newest = d["seasons"][0]
    for season in d["seasons"]:
        y = int(season[:4])
        if y < 1996 or (start and y > int(start[:4])):
            continue
        ps = d["data"][season]["players"]
        t0 = time.time(); done = []
        if "scoring" in only:
            done.append(f"scoring {X.apply_scoring(season, ps)}")
        if "onoffadj" in only:
            done.append(f"onoffadj {X.apply_onoff_adj(season, ps)}")
        if "playtypes" in only and y >= 2015:
            done.append(f"playtypes {X.apply_playtypes(season, ps)}")
        if "xfg" in only and y >= 2013:
            import xfg_model
            done.append(f"xfg {xfg_model.apply(season, ps, model)}")
        if "ww" in only and season == newest:
            done.append(f"ww {X.apply_with_without(season, ps)}")
        strict_dump(path, d)
        print(f"{season}: {', '.join(done)}  ({time.time() - t0:.0f}s)", flush=True)
    print("done")


if __name__ == "__main__":
    path = sys.argv[1]
    only = PASSES
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
    start = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else None
    main(path, only, start)
