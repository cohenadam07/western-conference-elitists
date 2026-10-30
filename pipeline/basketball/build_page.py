"""
build_page.py — bake the engine's data into the web page.

Reads:  page.template.html  (+ out/metrics_config.json, out/players.json)
Writes: basketball-savant.html  (fully self-contained — open it directly in a browser)

Run this AFTER `python savant_engine.py build` (or after make_fixture.py) so the page
shows the latest data:

    python build_page.py
"""
import json, os, sys, re

TPL = "page.template.html"
CFG = os.path.join("out", "metrics_config.json")
DATA = os.path.join("out", "players.json")
AWARDS = os.path.join("out", "awards.json")     # optional: produced by awards_fetch.py
OUT = "basketball-savant.html"

OUT_DATA = "savant-data.json"   # player dataset, fetched by the page at runtime (alongside OUT).
                                # NOT "data.json": draft-savant.html ships from the same public/ folder
                                # and fetches data.json, so sharing the name makes each deploy clobber
                                # the other page's dataset.

def main():
    for f in (TPL, CFG, DATA):
        if not os.path.exists(f):
            sys.exit(f"missing {f} — run the engine (or make_fixture.py) first.")
    tpl = open(TPL).read()
    cfg = open(CFG).read().strip()
    data = open(DATA).read().strip()
    json.loads(cfg); d = json.loads(data)               # validate before injecting/copying
    # Season honours. Optional: the page degrades to no accolades if awards_fetch.py has not
    # been run, rather than failing the build over a file that needs a home connection.
    if os.path.exists(AWARDS):
        awards = open(AWARDS).read().strip()
        aw = json.loads(awards)
        print(f"  accolades: {len(aw.get('players', {}))} players"
              + (f", {len(aw['failed'])} lookups failed" if aw.get("failed") else ""))
    else:
        awards = '{"labels":{},"players":{}}'
        print("  accolades: out/awards.json missing — building without them")
    # Only the (small) metric config and awards are baked inline; the ~65 MB dataset is fetched.
    html = tpl.replace("__CFG__", cfg).replace("__AWARDS__", awards)
    if "__CFG__" in html or "__AWARDS__" in html:
        sys.exit("template placeholders not replaced — check page.template.html")
    if "__DATA__" in html:
        sys.exit("stale __DATA__ in template — the page should fetch savant-data.json, not inline it.")
    import safe_io
    safe_io.write_text(OUT, html)
    # The engine emits NaN/Infinity (a valid JS literal, which the old inline page relied on) but
    # those are INVALID JSON — JSON.parse() on the fetched file would throw. Rewrite them to null;
    # the page already treats NaN and null identically (both -> "missing"). Then hard-verify it's
    # strict JSON so a bad token can never ship.
    data_json = re.sub(r"-?Infinity", "null", re.sub(r"\bNaN\b", "null", data))
    json.loads(data_json, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(f"stray {c}")))
    safe_io.write_text(OUT_DATA, data_json)             # publish the dataset next to the page
    if "seasons" in d:
        n = sum(len(v.get("players", [])) for v in d["data"].values())
        print(f"wrote {OUT} + {OUT_DATA}  ({n} player-season rows across {len(d['seasons'])} seasons, source={d.get('source')})")
    else:
        print(f"wrote {OUT} + {OUT_DATA}  ({len(d['players'])} players, source={d.get('source')})")

if __name__ == "__main__":
    main()
