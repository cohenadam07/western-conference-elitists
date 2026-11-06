"""
assemble.py — College Basketball Savant's page from its sources.

    python3 tools/savant-cbb/assemble.py                 -> public/college-basketball-savant.html
    python3 tools/savant-cbb/assemble.py --out <file>    -> anywhere else (the check writes to a temp file)

The page is the files in ORDER (page-src/, and tools/themes/ for a 'theme:' entry) concatenated, byte for byte, nothing added. Until Nov 6, 2026 the assembler built the CSS from
design/college-basketball-savant-prototype.html and an excerpt of public/basketball-savant.html, and 1.3.0 and 1.4.0
were edited straight into the published page; page-src was cut from the published page then (README).
Edit page-src/, then run this. Never edit public/college-basketball-savant.html directly: `npm run check:page-src` fails
when the published page and this assembler's output differ by a single byte (page-src/README.md).
"""
import argparse
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# 'theme:<path>' reads tools/themes/<path>: the college theme's tokens and the shared frame and sidebar, which
# College Basketball Coaching Savant reads too (tools/themes/README.md). The rest is this page's own.
ORDER = ['00a-head.html', 'theme:college/fonts.html', '00b-head.html', '01a-prototype.css', 'theme:college/tokens.css', 'theme:shared/base.css', 'theme:shared/frame.css', '01c-blocks.css',
         '02-starting-five.css', '03-extra.css', '04-body.html', '05a-page.js', 'theme:shared/sidebar.js', '05b-page.js', '06-tail.html']
THEMES = os.path.join(HERE, "..", "themes")
PAGE = os.path.join(HERE, "..", "..", "public", "college-basketball-savant.html")


def assemble():
    out = []
    for f in ORDER:
        p = os.path.join(THEMES, f[6:]) if f.startswith("theme:") else os.path.join(HERE, "page-src", f)
        with open(p, encoding="utf-8", newline="") as fh:
            out.append(fh.read())
    return "".join(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=PAGE)
    a = ap.parse_args()
    html = assemble()
    with open(a.out, "w", encoding="utf-8", newline="") as fh:
        fh.write(html)
    print("wrote", os.path.relpath(a.out), len(html.encode()), "bytes")
