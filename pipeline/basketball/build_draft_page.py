"""
build_draft_page.py — bake Draft Savant's data into the web page.

Reads:  draft.template.html  (+ out/draft_metrics_config.json, out/draft_players.json)
Writes: draft-savant.html  (fully self-contained — open it directly in a browser)

Run this AFTER `python draft_data.py` so the page reflects the latest dataset:

    python build_draft_page.py
"""
import json, os, sys, shutil

TPL = "draft.template.html"
CFG = os.path.join("out", "draft_metrics_config.json")
DATA = os.path.join("out", "data.json")
OUT = "draft-savant.html"
OUT_DATA = "data.json"                                  # fetched by the page at runtime, alongside OUT

def main():
    for f in (TPL, CFG, DATA):
        if not os.path.exists(f):
            sys.exit(f"missing {f} — run `python draft_data.py` first.")
    tpl = open(TPL).read()
    cfg = open(CFG).read().strip()
    json.loads(cfg); d = json.loads(open(DATA).read())  # validate before injecting/copying
    # Only the (small) metric config is baked inline now; the player dataset is fetched.
    html = tpl.replace("__CFG__", cfg)
    if "__CFG__" in html:
        sys.exit("template placeholders not replaced — check draft.template.html")
    if "__DATA__" in html:
        sys.exit("stale __DATA__ placeholder in template — the page should fetch data.json, not inline it.")
    open(OUT, "w").write(html)
    shutil.copyfile(DATA, OUT_DATA)                      # publish data.json next to the page
    print(f"wrote {OUT} + {OUT_DATA}  ({len(d['players'])} prospects, source={d.get('source')})")

if __name__ == "__main__":
    main()
