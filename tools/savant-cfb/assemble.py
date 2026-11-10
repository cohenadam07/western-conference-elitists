"""
assemble.py — College Football Savant's page from its sources.

    python3 tools/savant-cfb/assemble.py                 -> public/college-football-savant.html
    python3 tools/savant-cfb/assemble.py --out <file>    -> anywhere else (the check writes to a temp file)

The page is the files in ORDER (page-src/, and tools/themes/ for a 'theme:' entry) concatenated, byte for byte,
nothing added. Edit page-src/ (or the cfb theme), then run this. Never edit public/college-football-savant.html
directly: `npm run check:page-src` fails when the published page and this assembler's output differ by one byte.
"""
import argparse
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# 'theme:<path>' reads tools/themes/<path>: college football's own theme ("Sticker Bomb"), kept apart from the
# page so the next college football page can read the same files.
ORDER = ['00-head.html', 'theme:cfb/fonts.html', '01-style-open.html', 'theme:cfb/tokens.css', 'theme:cfb/sticker.css', '02-page.css',
         '03-body.html', '04-page.js', '05-tail.html']
THEMES = os.path.join(HERE, "..", "themes")
PAGE = os.path.join(HERE, "..", "..", "public", "college-football-savant.html")


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
